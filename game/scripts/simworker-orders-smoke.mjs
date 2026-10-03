#!/usr/bin/env node
// Sim worker chunk 5 smoke (docs/sim-worker.md §4.4): against a running dev server, boot a game (?simWorker=1, or
// --inthread) in headless Chromium and give orders through the real HUD: the selection panel's buttons for a ship, a
// real right-click at galaxy zoom over a home body (the action menu with "Build here", built by a query), a pick from
// it, the capital's Build page and one of its build buttons, the dispatch slots of an unowned body, and the money panel.
// Saves screenshots of the menu and the button pages.
//   node scripts/simworker-orders-smoke.mjs <base url> [--out=shots/simworker-orders] [--inthread]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5173/';
const opt = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const inThread = process.argv.includes('--inthread');
const out = opt('out', `shots/simworker-orders${inThread ? '-inthread' : ''}`);
mkdirSync(out, { recursive: true });
const url = `${base}?autostart=1&simWorker=${inThread ? 0 : 1}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.stack ?? e.message}`));
let failed = 0;
const check = (ok, what) => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
    if (!ok) failed++;
};
const wait = (ms) => page.waitForTimeout(ms);
const enabledButtons = () => page.evaluate(() => [...document.querySelectorAll('.order-actions .order-action-btn')].filter((b) => !b.classList.contains('order-action-empty') && !b.classList.contains('order-action-extra')).map((b) => ({ title: b.title, disabled: b.disabled, cls: b.className })));
try {
    await page.goto(url);
    await page.waitForFunction(() => window.__dwu?.time !== undefined && window.__dwu?.view !== undefined, null, { timeout: 600000 });
    check(inThread === (await page.evaluate(() => window.__dwu.simWorker === null)), inThread ? 'game runs in-thread' : 'game runs in the worker');
    await page.evaluate(() => { window.__dwu.time.paused = true; });
    await wait(1000);

    // 1. A construction ship selected: its eight buttons.
    const ship = await page.evaluate(async () => {
        const hud = await import('/src/ui/hud.ts');
        window.__subRoleConstruction = (await import('/src/sim/builtObjectTypes.ts')).BuiltObjectSubRole.ConstructionShip;
        const p = window.__dwu.game.playerEmpire;
        const s = p.builtObjects.find((b) => b && b.subRole === window.__subRoleConstruction && b.builtAt === null && b.topSpeed > 0) ?? p.builtObjects.find((b) => b && b.builtAt === null && b.topSpeed > 0 && b.role !== 0);
        window.__ship = s;
        hud.selectStellarObject(s, true);
        return { name: s.name, subRole: s.subRole, mission: s.mission?.type ?? null, design: s.mission?.design?.name ?? null, target: s.mission?.target?.name ?? null };
    });
    await wait(1500);
    const shipButtons = await enabledButtons();
    check(shipButtons.length > 0, `ship ${ship.name}: ${shipButtons.length} action buttons (${shipButtons.map((b) => b.title.split('\n')[0].slice(0, 30)).join(' / ')})`);
    await page.screenshot({ path: `${out}/ship-buttons.png` });

    // 2. A real right-click at galaxy zoom over an unowned home body: the action menu (a query in worker mode).
    const at = await page.evaluate(() => {
        const d = window.__dwu;
        const p = d.game.playerEmpire;
        const sys = d.galaxy.systems[p.capital.systemIndex];
        const h = sys.habitats.find((x) => x.empire === null && x.category !== 0) ?? sys.systemStar;
        d.camera.centerOn(h.xpos, h.ypos);
        d.camera.zoom = d.camera.clampZoom(1 / 200);
        window.__body = h;
        const s = d.camera.worldToScreen(h.xpos, h.ypos);
        const r = document.querySelector('canvas').getBoundingClientRect();
        return { x: r.left + s.x, y: r.top + s.y, name: h.name, zoomFactor: d.view.zoomFactor };
    });
    await wait(500);
    // Ctrl-right-click: the menu opens instead of the default order.
    await page.mouse.move(at.x, at.y);
    await page.keyboard.down('Control');
    await page.mouse.down({ button: 'right' });
    await page.mouse.up({ button: 'right' });
    await page.keyboard.up('Control');
    await page.waitForSelector('.order-menu-root .order-menu-item', { timeout: 10000 }).catch(() => {});
    const menu = await page.evaluate(() => [...document.querySelectorAll('.order-menu-root .order-menu-panel:first-child .order-menu-item .order-menu-label')].map((e) => e.textContent));
    check(menu.length > 0, `right-click over ${at.name} at zoom factor ${at.zoomFactor.toFixed(0)}: menu ${JSON.stringify(menu)}`);
    await page.screenshot({ path: `${out}/action-menu.png` });
    const buildRow = await page.$$('.order-menu-root .order-menu-panel:first-child .order-menu-item');
    let picked = null;
    for (const row of buildRow) {
        const t = await row.textContent();
        if (t && /Build here/.test(t)) {
            await row.hover();
            await wait(300);
            const sub = await page.$$('.order-menu-root .order-menu-panel:nth-child(2) .order-menu-item:not(.order-menu-disabled)');
            if (sub.length > 0) {
                picked = await sub[0].textContent();
                await sub[0].click();
            }
            break;
        }
    }
    if (picked === null) {
        // No "Build here" (e.g. not a construction ship): pick any enabled leaf.
        const leaf = await page.$('.order-menu-root .order-menu-panel:first-child .order-menu-item:not(.order-menu-disabled):not(:has(.order-menu-arrow))');
        if (leaf) {
            picked = await leaf.textContent();
            await leaf.click();
        }
    }
    check(picked !== null, `picked "${picked}"`);
    await page.evaluate(() => { window.__dwu.time.paused = false; });
    await wait(2500);
    await page.evaluate(() => { window.__dwu.time.paused = true; });
    const after = await page.evaluate(() => ({ toasts: [...document.querySelectorAll('.dwu-toast')].map((t) => t.textContent), target: window.__ship.mission?.target?.name ?? null, design: window.__ship.mission?.design?.name ?? null, mission: window.__ship.mission?.type ?? null, queued: window.__ship.subsequentMissions?.length ?? 0, board: window.__dwu.game.playerEmpire.constructionBoard?.jobs.length ?? 0 }));
    console.log(`     before: ${JSON.stringify(ship)}`);
    check(after.mission !== ship.mission || after.design !== ship.design || after.queued > 0 || after.board > 0, `the order landed: mission ${ship.mission} → ${after.mission} (${after.design} at ${after.target}), queued ${after.queued}, board jobs ${after.board}, toasts ${JSON.stringify(after.toasts)}`);

    // 3. The capital: Build Options page, then a build button.
    const before = await page.evaluate(async () => {
        const hud = await import('/src/ui/hud.ts');
        const cap = window.__dwu.game.playerEmpire.capital;
        hud.selectStellarObject(cap, true);
        return cap.constructionQueue?.constructionWaitQueue?.length ?? 0;
    });
    await wait(1500);
    const capButtons = await enabledButtons();
    check(capButtons.length > 0, `capital: ${capButtons.length} buttons`);
    const buildOpts = await page.$('.order-actions .order-action-btn.order-style-build:not([disabled])');
    if (buildOpts) await buildOpts.click();
    await wait(1500);
    const page2 = await enabledButtons();
    console.log(`     build page buttons: ${JSON.stringify(page2.map((b) => `${b.cls}:${b.title.slice(0, 30)}`))}`);
    await page.screenshot({ path: `${out}/build-page.png` });
    const build = await page.$('.order-actions .order-action-btn.order-style-build:not([disabled]) img[style*="rotate"]');
    check(build !== null, `build page: ${page2.length} buttons (${page2.filter((b) => !b.disabled).length} enabled)`);
    if (build) await build.click();
    await page.evaluate(() => { window.__dwu.time.paused = false; });
    await wait(2500);
    await page.evaluate(() => { window.__dwu.time.paused = true; });
    const queued = await page.evaluate(() => window.__dwu.game.playerEmpire.capital.constructionQueue?.constructionWaitQueue?.length ?? 0);
    const building = await page.evaluate(() => (window.__dwu.game.playerEmpire.capital.constructionQueue?.constructionYards ?? []).filter((y) => y.shipUnderConstruction).length);
    check(queued > before || building > 0, `capital build: wait list ${before} → ${queued}, yards building ${building}`);

    // 4. An unowned home body: dispatch slots and its buttons (a page that draws galaxy.rnd).
    await page.evaluate(async () => {
        const hud = await import('/src/ui/hud.ts');
        hud.selectStellarObject(window.__body, true);
    });
    await wait(1500);
    const extras = await page.evaluate(() => [...document.querySelectorAll('.order-action-extra, .sel-extra-row button')].map((b) => b.title || b.textContent));
    const bodyButtons = await enabledButtons();
    check(bodyButtons.length + extras.length > 0, `${at.name}: ${bodyButtons.length} buttons, extras ${JSON.stringify(extras.map((x) => x.slice(0, 40)))}`);
    await page.screenshot({ path: `${out}/body-buttons.png` });
    // A dispatch slot (re-resolved by a query at click time, then a command): its reply shows a toast.
    const slot = await page.$('.order-actions .order-action-extra:not([disabled])');
    if (slot) await slot.click();
    await page.evaluate(() => { window.__dwu.time.paused = false; });
    await page.waitForFunction(() => [...document.querySelectorAll('.dwu-toast')].some((t) => /sent|job|No available|not possible/.test(t.textContent ?? '')), null, { timeout: 8000 }).catch(() => {});
    await page.evaluate(() => { window.__dwu.time.paused = true; });
    const toasts = await page.evaluate(() => [...document.querySelectorAll('.dwu-toast')].map((t) => t.textContent));
    check(slot !== null && toasts.some((t) => /sent|job|No available|not possible/.test(t ?? '')), `dispatch: ${JSON.stringify(toasts)}`);

    // 5. The money panel (a query in worker mode).
    const money = await page.evaluate(() => [...document.querySelectorAll('.top-money-small')].map((e) => e.textContent));
    check(money.some((t) => t && t.length > 2), `money panel: ${JSON.stringify(money)}`);
} finally {
    await browser.close();
    const errors = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]') || /sim worker: .*dropped|command reply/.test(l));
    for (const l of errors.slice(0, 30)) console.log(l);
    if (errors.length > 0) failed++;
    console.log(failed === 0 ? 'SMOKE OK' : `SMOKE FAILED (${failed})`);
    process.exitCode = failed === 0 ? 0 : 1;
}
