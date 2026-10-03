#!/usr/bin/env node
// Parity batch D1 screenshots: the HUD system mini-map (system and region views, with the "View" popup open), the
// Galaxy Map's system view / landscape / Back-Forward, the mini maps with nebulae (Troops, Expansion Planner), and
// every Empire Comparison tab. Also times the HUD map and the Galaxy Map on a big save.
//   node scripts/parD1-shots.mjs <base url> [--out=shots/parD1] [--inthread] [--load=/dev-saves/late2500.dwusave]
// Worker mode (default) turns on the replica write detector (?detectWrites=1): a write from these screens fails.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5173/';
const opt = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const inThread = process.argv.includes('--inthread');
const load = opt('load', '');
const tag = `${load ? 'late' : 'new'}-${inThread ? 'inthread' : 'worker'}`;
const out = opt('out', 'shots/parD1');
mkdirSync(out, { recursive: true });
const url = `${base}?${load ? `load=${encodeURIComponent(load)}` : 'autostart=1'}&simWorker=${inThread ? 0 : 1}${inThread ? '' : '&detectWrites=1'}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const logs = [];
page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.stack ?? e.message}`));
let failed = 0;
const check = (ok, what) => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
    if (!ok) failed++;
};
const shots = [];
const shot = async (name) => {
    const path = `${out}/${tag}-${name}.png`;
    await page.screenshot({ path });
    shots.push(path);
};

/** Centre the camera on the player's capital at a zoom factor (world units per pixel). */
async function viewCapital(factor) {
    await page.evaluate((f) => {
        const d = window.__dwu;
        const p = d.galaxy.playerEmpire;
        const c = p.capital ?? p.colonies[0];
        d.camera.centerOn(c.xpos, c.ypos);
        d.camera.zoomAt(1 / f, d.camera.width / 2, d.camera.height / 2);
        d.camera.centerOn(c.xpos, c.ypos);
    }, factor);
    await page.waitForTimeout(1500);
}

try {
    await page.goto(url);
    await page.waitForFunction(() => window.__dwu?.time !== undefined && window.__dwu?.view !== undefined && window.__dwu?.galaxy?.playerEmpire, null, { timeout: 900000 });
    await page.evaluate(() => {
        window.__dwu.time.paused = false;
        window.__dwu.time.speed = 4;
    });
    await page.waitForTimeout(load ? 4000 : 8000);
    await page.evaluate(() => {
        window.__dwu.time.paused = true;
    });
    await page.waitForTimeout(3000);

    // --- HUD system mini-map ---
    check((await page.locator('[data-hud="pnlSystemMap"] canvas').count()) === 1, 'HUD mini-map present');
    check((await page.locator('[data-hud="pnlOptionsList"] .hud-options-toggle').count()) === 1, 'View button kept');
    const boxes = await page.evaluate(() => {
        const r = (s) => document.querySelector(s)?.getBoundingClientRect().toJSON() ?? null;
        return { map: r('[data-hud="pnlSystemMap"]'), view: r('[data-hud="pnlOptionsList"] .hud-options-toggle') };
    });
    check(boxes.map !== null && boxes.view !== null && boxes.view.bottom <= boxes.map.top + 0.5, `View button above the mini-map (${JSON.stringify(boxes)})`);
    await viewCapital(20);
    await shot('hud-minimap-system');
    await viewCapital(3000);
    await shot('hud-minimap-region');
    await page.locator('[data-hud="pnlOptionsList"] .hud-options-toggle').click();
    await page.waitForTimeout(400);
    await shot('hud-minimap-view-popup');
    await page.mouse.click(900, 500);
    await page.waitForTimeout(300);
    // Cost of one HUD map draw at both zooms (an offscreen 280 px canvas).
    const hudCost = await page.evaluate(async () => {
        const { drawHudSystemMap } = await import('/src/ui/hudSystemMap.ts');
        const d = window.__dwu;
        const c = document.createElement('canvas');
        c.width = c.height = 280;
        const ctx = c.getContext('2d');
        const res = {};
        for (const f of [20, 3000, 30000]) {
            d.camera.zoomAt(1 / f, d.camera.width / 2, d.camera.height / 2);
            drawHudSystemMap(ctx, d.galaxy, d.camera);
            const t0 = performance.now();
            for (let i = 0; i < 10; i++) drawHudSystemMap(ctx, d.galaxy, d.camera);
            res[f] = +((performance.now() - t0) / 10).toFixed(2);
        }
        return res;
    });
    console.log(`HUD map draw ms by zoom factor: ${JSON.stringify(hudCost)}`);
    // Click on the map moves the view (picSystem_MouseUp).
    await viewCapital(20);
    const before = await page.evaluate(() => ({ x: window.__dwu.camera.x, y: window.__dwu.camera.y }));
    const mb = await page.locator('[data-hud="pnlSystemMap"] canvas').boundingBox();
    await page.mouse.click(mb.x + mb.width * 0.75, mb.y + mb.height / 2);
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => ({ x: window.__dwu.camera.x, y: window.__dwu.camera.y }));
    check(after.x > before.x && Math.abs(after.y - before.y) < Math.abs(after.x - before.x) / 4, `mini-map click moves the view right (${Math.round(before.x)} -> ${Math.round(after.x)})`);

    // --- Galaxy Map: system view, landscape, Back / Forward ---
    const t0 = Date.now();
    await page.keyboard.press('g');
    await page.waitForSelector('.gmap-overlay:not([hidden])', { timeout: 15000 });
    console.log(`galaxy map open: ${Date.now() - t0} ms`);
    const pick = await page.evaluate(() => {
        const d = window.__dwu;
        const p = d.galaxy.playerEmpire;
        const c = p.capital ?? p.colonies[0];
        const cv = document.querySelector('.gmap-canvas').getBoundingClientRect();
        const s = d.galaxy.sizeX / cv.width;
        const star = c.parent?.category === 0 || !c.parent ? c.parent ?? c : c.parent;
        return { x: cv.left + c.xpos / s, y: cv.top + c.ypos / s, star: star.name, capital: c.name };
    });
    await page.mouse.click(pick.x, pick.y);
    await page.waitForTimeout(800);
    await shot('galaxymap-system');
    // Click the capital in the system map.
    const capPx = await page.evaluate(() => {
        const d = window.__dwu;
        const p = d.galaxy.playerEmpire;
        const c = p.capital ?? p.colonies[0];
        const star = d.galaxyMap.selectedSystem;
        const r = document.querySelector('.gmap-system-map').getBoundingClientRect();
        const scale = Math.trunc((d.galaxy.maxSolarSystemSize * 2) / 250);
        const k = r.width / 250;
        return { x: r.left + (Math.trunc((c.xpos - star.xpos) / scale) + 125) * k, y: r.top + (Math.trunc((c.ypos - star.ypos) / scale) + 125) * k };
    });
    await page.mouse.click(capPx.x, capPx.y);
    await page.waitForTimeout(800);
    const sel = await page.evaluate(() => ({ h: window.__dwu.galaxyMap.selectedHabitat?.name ?? null, bg: document.querySelector('.gmap-landscape').style.backgroundImage }));
    check(sel.h === pick.capital, `system-map click selects the capital (${sel.h})`);
    check(sel.bg.includes('landscape'), `landscape picture shown (${sel.bg.slice(0, 80)})`);
    await shot('galaxymap-habitat-landscape');
    // Another system, then Back.
    await page.mouse.click(pick.x + 120, pick.y + 60);
    await page.waitForTimeout(500);
    await page.locator('[data-gmap="back"]').click();
    await page.waitForTimeout(500);
    const backTo = await page.evaluate(() => window.__dwu.galaxyMap.selectedHabitat?.name ?? null);
    check(backTo === pick.capital, `Back returns to the capital (${backTo})`);
    await shot('galaxymap-back');
    await page.locator('[data-gmap="forward"]').click();
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // --- Mini maps with nebulae ---
    for (const [name, hud, sel2] of [['troops', 'tbtnTroops', '[data-ow="troops"]'], ['expansion-planner', 'btnExpansionPlanner', '[data-ow="expansion"]']]) {
        const btn = page.locator(`[data-hud="${hud}"]`).first();
        if ((await btn.count()) === 0) {
            check(false, `${name}: no ${hud} button`);
            continue;
        }
        await btn.click();
        const ok = await page.waitForSelector(sel2, { timeout: 15000 }).then(() => true, () => false);
        check(ok, `${name} opens`);
        await page.waitForTimeout(3000);
        await shot(`minimap-${name}`);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(600);
    }

    // --- Empire Comparison / Victory: every tab ---
    await page.keyboard.press('v');
    const ecOk = await page.waitForSelector('[data-ow="empireComparison"]', { timeout: 15000 }).then(() => true, () => false);
    check(ecOk, 'Empire Comparison opens (V)');
    if (ecOk) {
        const tabs = await page.locator('[data-ow="empireComparison"] .ow-tab').allTextContents();
        check(tabs.length === 8, `8 tabs: ${tabs.join(' | ')}`);
        for (const [i, label] of tabs.entries()) {
            await page.locator('[data-ow="empireComparison"] .ow-tab').nth(i).click();
            await page.waitForTimeout(1500);
            if (i === 0) {
                // Hover the first bar row for the detail panel.
                const row = page.locator('[data-ow="empireComparison"] .ec-vrow').first();
                if ((await row.count()) > 0) {
                    await row.hover();
                    await page.waitForTimeout(500);
                }
            }
            await shot(`comparison-${i + 1}-${label.replace(/[^A-Za-z]+/g, '-').toLowerCase()}`);
        }
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
    }

    // Worker mode: no replica writes from these screens.
    const writes = await page.evaluate(() => {
        const det = window.__dwuWriteDetector;
        if (!det) return null;
        det.checkAll();
        return det.unexpected().filter((w) => !/^(Empire\.messageHistory|Empire\.advisorSuggestions|Empire\.eventMessageRecipient|EmpireMessage\.)/.test(w.key)).map((w) => `${w.key} ×${w.count} ${w.detail}`).join('\n');
    });
    if (writes !== null) check(writes === '', `no replica writes${writes ? `:\n${writes}` : ''}`);
} catch (e) {
    check(false, `run: ${e.stack ?? e}`);
} finally {
    await browser.close();
}
for (const l of logs) console.log(l);
for (const s of shots) console.log(`saved ${s}`);
console.log(failed === 0 ? 'ALL OK' : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
