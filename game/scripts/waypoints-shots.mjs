#!/usr/bin/env node
// Waypoints & Known Locations (an Improvement; ui/waypoints.ts, render/locationMarkers.ts): waypoints placed through
// the journaled player command (the dev hook issues the same op the menu / W key does), the markers at sector / galaxy
// / system zoom, a marker's hover tooltip, the right-click "Add Waypoint here…" menu, the W name dialog, the View
// popup's row with its "…" panel, the Waypoints list and the Galaxy Map window. Also times the marker layer's update
// per frame. Saves PNGs and prints the page's console errors — it does not judge them.
//
//   node scripts/waypoints-shots.mjs <base url> [--load=/dev-saves/late2500.dwusave] [--out=shots/waypoints] [--worker]
//
// --worker boots ?simWorker=1 (the commands run in the worker; the markers read the replica's synced side table).
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5173/';
const opt = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const worker = process.argv.includes('--worker');
const load = opt('load', '/dev-saves/late2500.dwusave');
const out = opt('out', 'shots/waypoints');
mkdirSync(out, { recursive: true });
const prefix = worker ? 'worker-' : '';
const url = `${base}?load=${encodeURIComponent(load)}&simWorker=${worker ? 1 : 0}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const logs = [];
page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.stack ?? e.message}`));
const shots = [];
const shot = async (name, wait = 2000) => {
    await page.waitForTimeout(wait);
    const path = `${out}/${prefix}${name}.png`;
    await page.screenshot({ path });
    shots.push(path);
    const st = await page.evaluate(() => {
        const l = window.__dwu.view.locationMarkers;
        const ms = l?.markers ?? [];
        return { markers: ms.length, waypoints: ms.filter((m) => m.kind === 'waypoint').length, known: ms.filter((m) => m.kind !== 'waypoint').length };
    });
    console.log(`shot ${path} ${JSON.stringify(st)}`);
};
const view = (x, y, f) =>
    page.evaluate(
        ([x, y, f]) => {
            const cam = window.__dwu.camera;
            cam.centerOn(x, y);
            cam.zoom = cam.clampZoom(1 / f);
        },
        [x, y, f],
    );
/** Average ms per frame of the marker layer's update over `frames` frames. */
const timeMarkers = (frames) =>
    page.evaluate(
        (frames) =>
            new Promise((resolve) => {
                const layer = window.__dwu.view.locationMarkers;
                const orig = layer.update;
                let n = 0;
                let total = 0;
                let max = 0;
                layer.update = function (...a) {
                    const t = performance.now();
                    orig.apply(this, a);
                    const d = performance.now() - t;
                    total += d;
                    max = Math.max(max, d);
                    if (++n >= frames) {
                        layer.update = orig;
                        resolve({ avg: +(total / n).toFixed(3), max: +max.toFixed(2), frames: n });
                    }
                };
            }),
        frames,
    );
try {
    await page.goto(url);
    await page.waitForFunction(() => !!window.__dwu?.game && !!window.__dwu?.time && !!window.__dwu?.view && !!window.__dwuWaypoints, null, { timeout: 900000 });
    await page.evaluate(() => {
        window.__dwu.time.paused = true;
    });
    await page.waitForTimeout(3000);
    const home = await page.evaluate(() => {
        const p = window.__dwu.game.galaxy.playerEmpire;
        const c = p.capital ?? p.colonies[0];
        return { x: c.xpos, y: c.ypos, name: c.name };
    });
    console.log(`home: ${JSON.stringify(home)}`);
    const known = await page.evaluate(() => window.__dwuWaypoints.known());
    console.log(`known locations: ${known.length} (${known.filter((k) => k.kind === 'hint').length} hints): ${JSON.stringify(known.slice(0, 8))}`);

    // Three waypoints around home (the addWaypoint op, as the menu / W key issue it).
    await page.evaluate(([x, y]) => {
        const w = window.__dwuWaypoints;
        w.add(x + 12000, y - 9000, 'Rally point');
        w.add(x - 30000, y + 18000, 'Pirate ambush seen here');
        w.add(x + 60000, y + 40000, 'Ruins to revisit');
    }, [home.x, home.y]);
    await page.waitForTimeout(1500);
    console.log(`waypoints: ${JSON.stringify(await page.evaluate(() => window.__dwuWaypoints.list()))}`);

    await view(home.x, home.y, 600);
    await shot('sector');
    await view(home.x, home.y, 1e9);
    await shot('galaxy');
    await view(home.x + 12000, home.y - 9000, 40);
    await shot('system');

    // Hover the "Rally point" pennant: its tooltip.
    await view(home.x, home.y, 600);
    await page.waitForTimeout(1500);
    const rally = await page.evaluate(([x, y]) => window.__dwu.camera.worldToScreen(x, y), [home.x + 12000, home.y - 9000]);
    await page.mouse.move(rally.x + 3, rally.y - 12);
    await page.waitForTimeout(200);
    await page.mouse.move(rally.x + 4, rally.y - 11);
    await shot('tooltip', 800);
    const has = (t) => page.evaluate((t) => document.body.innerText.includes(t), t);
    console.log(`tooltip shows the waypoint: ${await has('Your waypoint')}`);
    // Right-click it: Rename / Delete on top of the action menu.
    await page.mouse.click(rally.x + 4, rally.y - 11, { button: 'right' });
    await shot('waypoint-menu', 1200);
    console.log(`waypoint menu has Rename / Delete: ${await has('Rename Waypoint')} / ${await has('Delete Waypoint')}`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);

    // Right-click empty space: "Add Waypoint here…".
    await page.mouse.click(1100, 250, { button: 'right' });
    await shot('empty-menu', 1200);
    console.log(`empty-space menu has Add Waypoint: ${await has('Add Waypoint here')}`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);

    // W at the cursor: the name dialog; type a name and confirm.
    await page.mouse.move(500, 600);
    await page.waitForTimeout(300);
    await page.keyboard.press('w');
    await page.waitForTimeout(500);
    await page.keyboard.type(' (scouted)');
    await shot('name-dialog', 500);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1500);
    await shot('after-w', 1000);

    // The View popup: the Improvements row and its "…" panel.
    await page.evaluate(() => {
        const pop = document.querySelector('.hud-options-pop');
        if (pop !== null && !pop.classList.contains('open')) pop.querySelector('.hud-options-toggle')?.click();
    });
    await page.waitForTimeout(400);
    await page.evaluate(() => {
        const row = document.querySelector('.hud-option-row[data-overlay="waypoints"]');
        row?.querySelector('.hud-option-more')?.click();
        row?.scrollIntoView();
    });
    await shot('view-popup', 800);

    // The Waypoints list.
    await page.evaluate(() => window.__dwuWaypoints.openList());
    await shot('list', 800);
    console.log(`list rows: ${await page.evaluate(() => document.querySelectorAll('.waypoints-row').length)}`);
    await page.evaluate(() => document.querySelector('.waypoints-close')?.click());

    // Shift+W hides the overlay.
    await page.mouse.move(800, 450);
    await page.keyboard.press('Shift+W');
    await shot('hidden', 1000);
    await page.keyboard.press('Shift+W');
    await page.waitForTimeout(600);

    // The Galaxy Map window (G).
    await page.keyboard.press('g');
    await shot('galaxy-map', 2500);
    await page.keyboard.press('g');
    await page.waitForTimeout(500);

    await view(home.x, home.y, 600);
    console.log(`marker layer, sector zoom: ${JSON.stringify(await timeMarkers(120))}`);
    await view(home.x, home.y, 1e9);
    console.log(`marker layer, galaxy zoom: ${JSON.stringify(await timeMarkers(120))}`);
} catch (e) {
    console.log(`script error: ${e.stack ?? e}`);
} finally {
    console.log(`\nshots:\n${shots.join('\n')}`);
    console.log(`\nconsole errors / warnings (${logs.length}):\n${logs.slice(0, 40).join('\n')}`);
    await browser.close();
}
