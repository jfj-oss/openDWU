#!/usr/bin/env node
// Dismissing hint / known-location markers: right-click menu entry, the Waypoints list with "Show dismissed".
//   node scripts/dismissmarkers-shots.mjs <base url> [--worker] [--out=shots/markerlabels]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const base = process.argv[2] ?? 'http://localhost:5173/';
const worker = process.argv.includes('--worker');
const out = (process.argv.find((a) => a.startsWith('--out=')) ?? '--out=shots/markerlabels').slice(6);
mkdirSync(out, { recursive: true });
const prefix = worker ? 'worker-' : '';
const url = `${base}?newgame=${encodeURIComponent(JSON.stringify({ seed: 1, starCountIndex: 0, dimensionIndex: 0 }))}&simWorker=${worker ? 1 : 0}`;
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
    await page.waitForFunction(() => !!window.__dwu?.game && !!window.__dwu?.view && !!window.__dwuWaypoints, null, { timeout: 400000 });
    await page.evaluate(() => { window.__dwu.time.paused = true; });
    await page.waitForTimeout(3000);
    await page.evaluate(async () => {
        const g = window.__dwu.game.galaxy; const p = g.playerEmpire; const c = p.capital ?? p.colonies[0];
        const mod = await import('/src/sim/player/hintSubjects.ts');
        const pt = { x: Math.trunc(c.xpos + 15000), y: Math.trunc(c.ypos + 9000) };
        p.locationHints.push(pt);
        mod.recordHintSubject(p, pt, 'Abandoned Destroyer: ISV Ranger', 'Pirates (bought from the Dread Moon Prowlers)');
        const pt2 = { x: pt.x + 30000, y: pt.y };
        p.locationHints.push(pt2); // no record: the lookup
    });
    await page.waitForTimeout(2000);
    const known = await page.evaluate(() => window.__dwuWaypoints.known());
    console.log(`known: ${JSON.stringify(known.filter((m) => m.kind === 'hint'))}`);
    const k = known.find((m) => m.kind === 'hint');
    await page.evaluate(([x, y]) => { const cam = window.__dwu.camera; cam.centerOn(x + 15000, y); cam.zoom = cam.clampZoom(1 / 600); }, [k.x, k.y]);
    await page.waitForTimeout(1800);
    console.log(`labels: ${JSON.stringify(await page.evaluate(() => window.__dwu.view.locationMarkers.markers.filter((m) => m.kind === 'hint').map((m) => m.name)))}`);
    await shot('map');
    await page.evaluate(() => window.__dwuWaypoints.openList());
    await shot('list', 600);
    console.log(`list has subject+source: ${await has('Pirates (bought from')}`);
} catch (e) { console.log(`script error: ${e.stack ?? e}`); } finally {
    console.log(`\nshots:\n${shots.join('\n')}\n\nconsole errors (${logs.length}):\n${logs.slice(0, 30).join('\n')}`);
    await browser.close();
}
