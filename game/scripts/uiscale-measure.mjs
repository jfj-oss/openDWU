// UI-scale overlap probe: for each viewport x GUI scale, boots ?autostart=1, selects a planet (or a ship), measures the HUD blocks'
// screen rects in the page and lists overlaps / off-screen parts; saves a screenshot per case (never opened by the script).
// Usage: node scripts/uiscale-measure.mjs <baseUrl> <outDir> [sizes=1920x1080,2560x1440,3840x2160] [scales=150,166,200,250]
//   KIND=planet|ship (default both). TEXT=<Text size %> sets the textScale setting.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const [base = 'http://localhost:5173/', outDir = 'shots/uiscale', sizes = '1920x1080,2560x1440,3840x2160', scales = '150,166,200,250'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
    // Playwright's default --hide-scrollbars would hide every scroll bar in the screenshots (and make them 0 px wide).
    ignoreDefaultArgs: ['--hide-scrollbars'],
    args: ['--use-gl=angle', '--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu'],
});
const kinds = (process.env.KIND ?? 'planet,ship').split(',');
const NAMES = {
    money: '[data-hud="pnlMoney"]', stubs: '.message-stubs', messages: '[data-hud="lstMessages"]',
    selection: '[data-hud="pnlSelection"]', map: '[data-hud="pnlSystemMap"]', options: '[data-hud="pnlOptionsList"] .hud-options-toggle', optionsMenu: '[data-hud="pnlOptionsList"] .hud-options-menu',
    sidebar: '.ls-root',
};
// Pseudo-rects computed in the page: the union of the sidebar's laid-out children (the root itself is a 0-height anchor), the top button row,
// and the stub list at its tallest (every visible row plus the "N more" line).
const UNIONS = { sidebar: '.ls-root *', topLeft: '[data-hud="pnlTopLeftBar"] button, [data-hud="pnlTopLeftBar"] .hud-date' };
for (const size of sizes.split(',')) {
    const [w, h] = size.split('x').map(Number);
    for (const scale of scales.split(',').map(Number)) {
        const page = await browser.newPage({ viewport: { width: w, height: h } });
        const logs = [];
        page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
        await page.addInitScript(([sc, tx]) => {
            try {
                const cur = JSON.parse(localStorage.getItem('dwu-ui-settings') ?? '{}');
                cur.uiScale = sc;
                if (tx) cur.textScale = tx;
                localStorage.setItem('dwu-ui-settings', JSON.stringify(cur));
            } catch {}
        }, [scale, process.env.TEXT ? +process.env.TEXT : 0]);
        await page.goto(`${base}?autostart=1`);
        await page.waitForFunction(() => window.__dwu?.game?.playerEmpire !== undefined, null, { timeout: 240000 });
        await page.waitForTimeout(3000);
        await page.evaluate(() => { const { time } = window.__dwu; if (time) time.paused = true; });
        for (const kind of kinds) {
            await page.evaluate(async (kind) => {
                const { galaxy, camera } = window.__dwu;
                const hud = await import('/src/ui/hud.ts');
                const player = galaxy.playerEmpire;
                const cap = player.capital;
                camera.centerOn(cap.xpos, cap.ypos);
                camera.zoomAt(hud.SYSTEM_LEVEL_ZOOM, camera.width / 2, camera.height / 2);
                if (kind === 'planet') hud.selectHabitat(cap, false);
                else {
                    const own = player.builtObjects.filter((b) => !b.hasBeenDestroyed && b.role === 1 && b.unbuiltComponentCount === 0);
                    hud.selectStellarObject(own[0] ?? player.builtObjects[0], false);
                }
            }, kind);
            let openState = '';
            if (process.env.OPEN) {
                // A sidebar category panel and the View popup open (the tallest HUD state), by real clicks; verified in the DOM.
                await page.locator('.ls-button').nth(1).click({ force: true }).catch(() => {});
                await page.locator('[data-hud="pnlOptionsList"] .hud-options-toggle').click({ force: true }).catch(() => {});
                await page.waitForTimeout(600);
                const st = await page.evaluate(() => {
                    const vis = (e) => { const r = e?.getBoundingClientRect(); return !!r && r.width > 4 && r.height > 4; };
                    const pop = document.querySelector('[data-hud="pnlOptionsList"] .hud-options-pop, [data-hud="pnlOptionsList"].hud-options-pop');
                    return { sidebarPanel: vis(document.querySelector('.ls-title')) || vis(document.querySelector('.ls-panel > *')), viewList: !!pop?.classList.contains('open') && vis(document.querySelector('.hud-options-menu')) };
                });
                openState = ` open[sidebarPanel=${st.sidebarPanel} viewList=${st.viewList}]`;
                if (!st.sidebarPanel || !st.viewList) openState += ' NOT-OPEN';
            }
            await page.waitForTimeout(800);
            const res = await page.evaluate(async ([NAMES, UNIONS, W, H]) => {
                const rects = {};
                const { stubListMaxHeightPx } = await import('/src/ui/messageStubs.ts');
                const { TOP_ROW_BUTTONS } = await import('/src/ui/topBar.ts');
                const { STUB_LIST_W } = await import('/src/ui/messageStubList.ts');
                const { stubListTopPx, stubListLeftPx } = await import('/src/ui/hudFit.ts');
                const { getSettings, uiScaleFactor } = await import('/src/ui/settings.ts');
                for (const [k, sel] of Object.entries(UNIONS)) {
                    let u = null;
                    for (const e of document.querySelectorAll(sel)) {
                        const r = e.getBoundingClientRect();
                        if (r.width < 1 || r.height < 1) continue;
                        u = u ? { x: Math.min(u.x, r.x), y: Math.min(u.y, r.y), r: Math.max(u.r, r.right), b: Math.max(u.b, r.bottom) } : { x: r.x, y: r.y, r: r.right, b: r.bottom };
                    }
                    if (u) rects[k] = { x: Math.round(u.x), y: Math.round(u.y), r: Math.round(u.r), b: Math.round(u.b) };
                }
                for (const b of TOP_ROW_BUTTONS) {
                    const r = document.querySelector(`[data-hud="${b.name}"]`)?.getBoundingClientRect();
                    if (r && r.width >= 1) rects['row:' + b.name] = { x: Math.round(r.x), y: Math.round(r.y), r: Math.round(r.right), b: Math.round(r.bottom) };
                }
                {
                    const m = document.querySelector('[data-hud="pnlMoney"]').getBoundingClientRect();
                    const st = document.querySelector('.message-stubs')?.getBoundingClientRect();
                    const s = uiScaleFactor();
                    const top = stubListTopPx(W, H, s, m.bottom, stubListLeftPx(W, s));
                    rects.stubsMax = { x: Math.round(m.right - STUB_LIST_W * s), y: Math.round(top), r: Math.round(m.right), b: Math.round(top + stubListMaxHeightPx(getSettings().messageStubsVisible) * s) };
                }
                for (const [k, sel] of Object.entries(NAMES)) {
                    const e = document.querySelector(sel);
                    if (!e) continue;
                    const r = e.getBoundingClientRect();
                    if (r.width < 1 || r.height < 1) continue;
                    rects[k] = { x: Math.round(r.x), y: Math.round(r.y), r: Math.round(r.right), b: Math.round(r.bottom) };
                }
                const keys = Object.keys(rects);
                const overlaps = [];
                const skip = new Set(['options|optionsMenu', 'money|stubs', 'stubsMax|stubs']);
                if (document.body.classList.contains('hud-view-covers-stubs')) skip.add('stubsMax|optionsMenu'); // the open View list hides the stub list
                for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
                    if (skip.has(keys[i] + '|' + keys[j])) continue;
                    const a = rects[keys[i]], b = rects[keys[j]];
                    const ox = Math.min(a.r, b.r) - Math.max(a.x, b.x), oy = Math.min(a.b, b.b) - Math.max(a.y, b.y);
                    if (ox > 1 && oy > 1) overlaps.push(`${keys[i]} x ${keys[j]} (${ox}x${oy})`);
                }
                const off = keys.filter((k) => rects[k].x < -1 || rects[k].y < -1 || rects[k].r > W + 1 || rects[k].b > H + 1).map((k) => `${k} ${JSON.stringify(rects[k])}`);
                const btn = document.querySelector('.ls-button')?.getBoundingClientRect();
                const ico = document.querySelector('.ls-button-icon')?.getBoundingClientRect();
                const sc = document.querySelector('.sel-scroll');
                const selScroll = sc ? `scroll ${sc.clientWidth}x${sc.clientHeight} content ${sc.scrollWidth}x${sc.scrollHeight} fontPx ${Math.round(parseFloat(getComputedStyle(sc.querySelector('.sel-row') ?? sc).fontSize) * (parseFloat(sc.style.zoom) || 1) * 10) / 10}` : 'no sel-scroll';
                return { rects, overlaps, off, btn: btn ? Math.round(btn.width) : 0, ico: ico ? Math.round(ico.width) : 0, selScroll };
            }, [NAMES, UNIONS, w, h]);
            const file = `${outDir}/${w}x${h}-s${scale}${process.env.TEXT ? '-t' + process.env.TEXT : ''}${process.env.OPEN ? '-open' : ''}-${kind}.png`;
            await page.screenshot({ path: file });
            console.log(`${w}x${h} @${scale}% ${kind}: sidebarButton=${res.btn}px icon=${res.ico}px${openState} selection[${res.selScroll}] overlaps=${res.overlaps.length ? res.overlaps.join('; ') : 'none'} | offscreen=${res.off.length ? res.off.join('; ') : 'none'} -> ${file}`);
            if (process.env.VERBOSE) console.log(JSON.stringify(res.rects));
        }
        for (const l of logs) console.log(l);
        await page.close();
    }
}
await browser.close();
