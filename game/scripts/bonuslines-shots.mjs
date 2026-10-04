#!/usr/bin/env node
// Screenshots for the bonus-lines / layer-order / message-ping / faction-ring batch (prints console errors only):
//   1. close zoom on a player ship with a travel vector: the vector and overlay layer above the ship art;
//   2. a message stub hovered (method_242 ping: eventLocations count printed, yellow ping on the map);
//   3. galaxy zoom f = 160: faction rings at full alpha (the C# int_15 = 255) - and f = 300 for comparison.
//
//   node scripts/bonuslines-shots.mjs <base url> [--out=shots/bonuslines] [--inthread]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5173/';
const opt = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const inThread = process.argv.includes('--inthread');
const out = opt('out', 'shots/bonuslines');
mkdirSync(out, { recursive: true });
const tag = inThread ? 'inthread' : 'worker';
const url = `${base}?autostart=1&simWorker=${inThread ? 0 : 1}&overlays=travelVectorsState,travelVectorsPrivate,fleetPostures`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const logs = [];
page.on('console', (m) => {
    if (m.type() === 'error') logs.push(`[error] ${m.text()}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.stack ?? e.message}`));
const shot = async (name, wait = 1800) => {
    await page.waitForTimeout(wait);
    const path = `${out}/${tag}-${name}.png`;
    await page.screenshot({ path });
    console.log(`shot ${path}`);
};
const view = (x, y, f) =>
    page.evaluate(([x, y, f]) => {
        const cam = window.__dwu.camera;
        cam.centerOn(x, y);
        cam.zoom = cam.clampZoom(1 / f);
    }, [x, y, f]);
try {
    await page.goto(url);
    await page.waitForFunction(() => window.__dwu?.time !== undefined && window.__dwu?.view?.galaxyMarkers && window.__dwu?.galaxy?.playerEmpire, null, { timeout: 900000 });
    await page.evaluate(() => {
        window.__dwu.time.paused = false;
        window.__dwu.time.speed = 4;
    });
    await page.waitForTimeout(25000);
    await page.evaluate(() => {
        window.__dwu.time.paused = true;
    });
    await page.waitForTimeout(2000);

    // 1. A moving player ship at close zoom with its vector.
    const ship = await page.evaluate(() => {
        const p = window.__dwu.galaxy.playerEmpire;
        const s = p.builtObjects.find((b) => b && !b.hasBeenDestroyed && b.currentSpeed > 0 && b.role !== 4) ?? p.builtObjects.find((b) => b && !b.hasBeenDestroyed);
        if (!s) return null;
        window.__dwu.view.onBuiltObjectSelect?.(s);
        return { x: s.xpos, y: s.ypos, speed: s.currentSpeed };
    });
    console.log('ship', JSON.stringify(ship));
    if (ship) {
        await view(ship.x, ship.y, 8);
        await shot('close-ship-vector');
        const order = await page.evaluate(() => {
            const w = window.__dwu.view.world;
            const o = window.__dwu.view.overlayLayer;
            const kids = w.children;
            return { last: kids.at(-1) === o.root, prev: kids.at(-2) === o.postureRoot, ships: kids.indexOf(window.__dwu.view.builtObjectLayer.root), root: kids.indexOf(o.root) };
        });
        console.log('layer order (root last, posture before it, ships index < root index):', JSON.stringify(order));
    }

    // 2. A message stub hover.
    const stub = await page.$('.message-stub');
    console.log('message stub present:', stub !== null);
    if (stub) {
        await stub.hover();
        await shot('message-hover-ping', 600);
        await page.mouse.move(800, 450);
        await page.waitForTimeout(300);
    }

    // 3. Faction rings at f = 160 (just past the 150 gate) and 300.
    const cap = await page.evaluate(() => {
        const p = window.__dwu.galaxy.playerEmpire;
        const c = p.capital ?? p.colonies[0];
        return { x: c.xpos, y: c.ypos };
    });
    await view(cap.x, cap.y, 160);
    await shot('faction-rings-f160');
    await view(cap.x, cap.y, 300);
    await shot('faction-rings-f300');
} finally {
    console.log(logs.length ? `console errors:\n${logs.join('\n')}` : 'no console errors');
    await browser.close();
}
