#!/usr/bin/env node
// Dismissing hint / known-location markers: right-click menu entry, the Waypoints list with "Show dismissed".
//   node scripts/dismissmarkers-shots.mjs <base url> [--worker] [--out=shots/dismiss]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const base = process.argv[2] ?? 'http://localhost:5173/';
const worker = process.argv.includes('--worker');
const out = (process.argv.find((a) => a.startsWith('--out=')) ?? '--out=shots/dismiss').slice(6);
mkdirSync(out, { recursive: true });
const prefix = worker ? 'worker-' : '';
const url = `${base}?load=${encodeURIComponent('/dev-saves/late2500.dwusave')}&simWorker=${worker ? 1 : 0}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.stack ?? e.message}`));
const shots = [];
const shot = async (name, wait = 1200) => { await page.waitForTimeout(wait); const p = `${out}/${prefix}${name}.png`; await page.screenshot({ path: p }); shots.push(p); };
const has = (t) => page.evaluate((t) => document.body.innerText.includes(t), t);
try {
    await page.goto(url);
    await page.waitForFunction(() => !!window.__dwu?.game && !!window.__dwu?.view && !!window.__dwuWaypoints, null, { timeout: 900000 });
    await page.evaluate(() => { window.__dwu.time.paused = true; });
    await page.waitForTimeout(3000);
    let known = await page.evaluate(() => window.__dwuWaypoints.known());
    if (known.length === 0) {
        // No hints in the save: give the player one (a hint is plain empire data; this is a screenshot fixture only).
        await page.evaluate(() => { const g = window.__dwu.game.galaxy; const c = g.playerEmpire.capital ?? g.playerEmpire.colonies[0]; g.playerEmpire.locationHints.push({ x: Math.trunc(c.xpos + 15000), y: Math.trunc(c.ypos + 9000) }); });
        await page.waitForTimeout(2000);
        known = await page.evaluate(() => window.__dwuWaypoints.known());
    }
    console.log(`known: ${JSON.stringify(known.slice(0, 6))}`);
    const k = known.find((m) => m.kind === 'hint') ?? known[0];
    await page.evaluate(([x, y]) => { const cam = window.__dwu.camera; cam.centerOn(x, y); cam.zoom = cam.clampZoom(1 / 600); }, [k.x, k.y]);
    await page.waitForTimeout(1800);
    const s = await page.evaluate(([x, y]) => window.__dwu.camera.worldToScreen(x, y), [k.x, k.y]);
    const count = () => page.evaluate(() => `${window.__dwu.view.locationMarkers.markers.filter((m) => m.kind !== 'waypoint').length} on map, ${window.__dwuWaypoints.known().length} listed`);
    console.log(`markers before: ${await count()}`);
    await page.mouse.move(s.x, s.y);
    await page.mouse.click(s.x, s.y, { button: 'right' });
    await shot('menu');
    console.log(`menu has Dismiss marker: ${await has('Dismiss marker')}`);
    await page.getByText('Dismiss marker "', { exact: false }).first().click();
    await page.waitForTimeout(1800);
    console.log(`toast: ${await has('Marker dismissed')}`);
    console.log(`markers after dismiss: ${await count()}`);
    await shot('dismissed-map');
    await page.evaluate(() => window.__dwuWaypoints.openList());
    await shot('list-hidden', 600);
    await page.evaluate(() => { const b = document.querySelector('[data-option="showDismissed"]'); b.click(); });
    await shot('list-shown', 600);
    console.log(`Restore button: ${await has('Restore')}`);
    await page.evaluate(() => document.querySelector('.waypoints-row-dismissed button:last-child')?.click());
    await page.waitForTimeout(1800);
    console.log(`markers after restore: ${await count()}`);
} catch (e) { console.log(`script error: ${e.stack ?? e}`); } finally {
    console.log(`\nshots:\n${shots.join('\n')}\n\nconsole errors (${logs.length}):\n${logs.slice(0, 30).join('\n')}`);
    await browser.close();
}
