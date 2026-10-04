#!/usr/bin/env node
// The remade HUD system map (hudSystemMap.ts): full and small size, zoomed into a system and out to the region, the
// View popup open, and the T cycle's 'nomap' step. Checks the strip's images, the View button's anchor above the
// map's top-right corner, the size toggle's persistence and that the map stays clear of the selection frame.
//   node scripts/minimap-shots.mjs <base url> [--out=shots/minimap] [--inthread]
// Worker mode (default, ?simWorker=1) turns on the replica write detector: a write from the HUD fails.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5173/';
const opt = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const inThread = process.argv.includes('--inthread');
const out = opt('out', 'shots/minimap');
mkdirSync(out, { recursive: true });
const url = `${base}?autostart=1&simWorker=${inThread ? 0 : 1}${inThread ? '' : '&detectWrites=1'}`;
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
    const path = `${out}/${name}.png`;
    await page.screenshot({ path });
    shots.push(path);
};
const MAP = '[data-hud="pnlSystemMap"]';
const VIEW = '[data-hud="pnlOptionsList"] .hud-options-toggle';

async function viewCapital(factor) {
    await page.evaluate((f) => {
        const d = window.__dwu;
        const p = d.galaxy.playerEmpire;
        const c = p.capital ?? p.colonies[0];
        d.camera.centerOn(c.xpos, c.ypos);
        d.camera.zoomAt(1 / f, d.camera.width / 2, d.camera.height / 2);
        d.camera.centerOn(c.xpos, c.ypos);
    }, factor);
    await page.waitForTimeout(1200);
}

async function geometry(tag) {
    const g = await page.evaluate(([m, v]) => {
        const r = (s) => document.querySelector(s)?.getBoundingClientRect().toJSON() ?? null;
        const imgs = [...document.querySelectorAll(`${m} .sysmap-btn img`)].map((i) => i.complete && i.naturalWidth > 0);
        return { map: r(`${m} .hud-sysmap-panel`), strip: r(`${m} [data-sysmap="btnZoomSelection"]`), view: r(v), sel: r('[data-hud="pnlSelection"]'), imgs, w: innerWidth };
    }, [MAP, VIEW]);
    check(g.map !== null && g.view !== null && g.view.bottom <= g.map.top + 0.5 && g.map.top - g.view.bottom < 12, `${tag}: View button just above the map (${g.view?.bottom?.toFixed(1)} vs ${g.map?.top?.toFixed(1)})`);
    check(g.map !== null && g.view !== null && Math.abs(g.view.right - g.map.right) < 1, `${tag}: View button at the map's right edge`);
    check(g.strip !== null && g.sel !== null && g.strip.left > g.sel.right, `${tag}: map clear of the selection frame`);
    check(g.imgs.length === 9 && g.imgs.every(Boolean), `${tag}: strip images loaded (${g.imgs.join(',')})`);
    return g;
}

try {
    await page.goto(url);
    await page.evaluate(() => localStorage.removeItem('dwu.systemMapSmall'));
    await page.reload();
    await page.waitForFunction(() => window.__dwu?.time !== undefined && window.__dwu?.view !== undefined && window.__dwu?.galaxy?.playerEmpire, null, { timeout: 900000 });
    await page.evaluate(() => {
        window.__dwu.time.paused = false;
        window.__dwu.time.speed = 4;
    });
    await page.waitForTimeout(6000);
    await page.evaluate(() => {
        window.__dwu.time.paused = true;
    });
    await page.waitForTimeout(2000);

    const full = await geometry('full');
    console.log(`full map panel ${full.map.width.toFixed(1)} x ${full.map.height.toFixed(1)}`);
    await viewCapital(20);
    await shot('full-system');
    await viewCapital(3000);
    await shot('full-region');
    await page.locator(VIEW).click();
    await page.waitForTimeout(400);
    await shot('full-view-popup');
    await page.mouse.click(900, 500);
    await page.waitForTimeout(300);

    // Zoom buttons.
    await viewCapital(20);
    await page.locator(`${MAP} [data-sysmap="btnZoomSector"]`).click();
    await page.waitForTimeout(300);
    const f1 = await page.evaluate(() => 1 / window.__dwu.camera.zoom);
    check(Math.abs(f1 - 3000) < 1, `Zoom to Sector -> factor ${f1.toFixed(1)}`);
    await page.locator(`${MAP} [data-sysmap="btnZoomIn"]`).click();
    await page.waitForTimeout(300);
    const f2 = await page.evaluate(() => 1 / window.__dwu.camera.zoom);
    check(f2 < f1 && f2 > f1 * 0.5, `Zoom In -> factor ${f2.toFixed(1)}`);

    // Small size.
    await page.locator(`${MAP} [data-sysmap="btnSystemMapSize"]`).click();
    await page.waitForTimeout(600);
    const small = await geometry('small');
    check(Math.abs(small.map.width / full.map.width - 0.6) < 0.01, `small size is 0.6 x (${small.map.width.toFixed(1)})`);
    check((await page.evaluate(() => localStorage.getItem('dwu.systemMapSmall'))) === '1', 'small size persisted');
    await viewCapital(20);
    await shot('small-system');
    await viewCapital(3000);
    await shot('small-region');
    await page.locator(VIEW).click();
    await page.waitForTimeout(400);
    await shot('small-view-popup');
    await page.mouse.click(900, 500);
    await page.waitForTimeout(300);

    // T: 'nomap' hides the whole map (size toggle included) and drops the View button to the corner.
    await page.keyboard.press('t');
    await page.waitForTimeout(400);
    const nomap = await page.evaluate(([m, v]) => ({ panels: document.body.dataset.panels, shown: document.querySelector(m)?.getClientRects().length ?? 0, view: document.querySelector(v)?.getBoundingClientRect().toJSON() }), [MAP, VIEW]);
    check(nomap.panels === 'nomap' && nomap.shown === 0, `T: nomap hides the map (${nomap.panels})`);
    check(nomap.view !== undefined && Math.abs(1080 - nomap.view.bottom - 10) < 2, `T: View button in the corner (bottom ${nomap.view?.bottom})`);
    await shot('t-nomap');
    await page.keyboard.press('t');
    await page.keyboard.press('t');
    await page.waitForTimeout(400);

    // Back to the full size (and it persists '0').
    await page.locator(`${MAP} [data-sysmap="btnSystemMapSize"]`).click();
    await page.waitForTimeout(400);
    check((await page.evaluate(() => localStorage.getItem('dwu.systemMapSmall'))) === '0', 'full size persisted');

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
