#!/usr/bin/env node
// Improvements map overlays (Distant Worlds 2-inspired; ui/improvements.ts): Resources (all, filtered, system zoom),
// Fuel Range (a selected fleet, the network with nothing selected), Colony Target Scores, the View popup's Improvements
// section with the resource picker, and the Game Options Improvements window. Also measures the overlay layer's per-frame
// cost with each overlay on. Saves PNGs and prints the page's console errors and the timings — it does not judge them.
//
//   node scripts/dw2overlays-shots.mjs <base url> [--load=/dev-saves/late2500.dwusave] [--out=shots/dw2overlays] [--worker]
//                                      [--colonies]
//
// --worker boots ?simWorker=1 (the replica is read-only: the script only views and selects). --colonies runs a new
// seed game (?autostart=1) in-thread instead and STAGES three colonization targets on it (test staging only: the
// seed-1 player can colonize one habitat type and has no target of its own), then shoots Colony Target Scores.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5173/';
const opt = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const worker = process.argv.includes('--worker');
const colonies = process.argv.includes('--colonies');
const load = opt('load', '/dev-saves/late2500.dwusave');
const out = opt('out', 'shots/dw2overlays');
mkdirSync(out, { recursive: true });
const prefix = colonies ? 'colonies-' : worker ? 'worker-' : '';
const url = colonies
    ? `${base}?autostart=1&simWorker=0&overlays=potentialColonies`
    : `${base}?load=${encodeURIComponent(load)}&simWorker=${worker ? 1 : 0}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const logs = [];
page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.stack ?? e.message}`));
const shots = [];
const shot = async (name, wait = 2500) => {
    await page.waitForTimeout(wait);
    const path = `${out}/${prefix}${name}.png`;
    await page.screenshot({ path });
    shots.push(path);
    const st = await page.evaluate(() => {
        const l = window.__dwu.view.overlayLayer;
        const vis = (pool) => pool.root.children.filter((c) => c.visible);
        const icons = vis(l.resources.icons);
        return {
            resIcons: icons.length,
            resArt: icons.filter((c) => c.texture.label !== 'WHITE').length,
            resRings: vis(l.resources.rings).length,
            resRows: l.resources.clusters.length,
            fuelPoints: l.fuel.drawnPoints.length,
            fuelLabel: l.fuel.label?.visible ? l.fuel.labelText : '',
            colonyRings: l.colonyScores.drawn.length,
        };
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
/** Set overlay flags in the shared state (what the View popup's rows toggle). */
const overlays = (flags) =>
    page.evaluate((flags) => {
        const s = window.__dwu.view.overlays;
        Object.assign(s, flags);
    }, flags);
/** Average ms per frame of the overlay layer's update over `frames` frames. */
const timeOverlay = (frames) =>
    page.evaluate(
        (frames) =>
            new Promise((resolve) => {
                const layer = window.__dwu.view.overlayLayer;
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
const timings = {};
try {
    await page.goto(url);
    await page.waitForFunction(() => !!window.__dwu?.game && !!window.__dwu?.time && !!window.__dwu?.view, null, { timeout: 900000 });
    await page.evaluate(() => {
        window.__dwu.time.paused = true;
    });
    await page.waitForTimeout(3000);
    const home = await page.evaluate(() => {
        const p = window.__dwu.game.galaxy.playerEmpire;
        const c = p.capital ?? p.colonies[0];
        return { x: c.xpos, y: c.ypos, name: c.name, systemIndex: c.systemIndex };
    });
    console.log(`home: ${JSON.stringify(home)}`);

    if (colonies) {
        // STAGING (in-thread, test only): three unowned planets in explored systems become the player's habitat type.
        const staged = await page.evaluate(() => {
            const g = window.__dwu.game.galaxy;
            const p = g.playerEmpire;
            const type = p.colonizableHabitatTypesForEmpire()[0];
            const out = [];
            for (let i = 0; i < g.systems.length && out.length < 5; i++) {
                if (!p.visibility.checkSystemExplored(i)) continue;
                for (const h of g.systemHabitatsOf(i)) {
                    if (out.length >= 5 || h.category !== 1 || h.owner !== null || h.empire !== null) continue;
                    h.type = type;
                    h.baseQuality = 0.55 + 0.1 * out.length;
                    out.push({ name: h.name, x: h.xpos, y: h.ypos, sys: i });
                }
            }
            return out;
        });
        console.log(`staged targets: ${JSON.stringify(staged)}`);
        // On only now: its list is cached until an input it watches changes (staged type / quality are not among them).
        await overlays({ colonyScores: true });
        if (staged.length > 0) {
            await view(staged[0].x, staged[0].y, 30);
            await shot('colony-scores-system');
            await view(home.x, home.y, 600);
            await shot('colony-scores-galaxy');
            timings.colonyScoresGalaxy = await timeOverlay(120);
        }
    } else {
        // Resources: galaxy / sector zoom around home, all known resources.
        await overlays({ resources: true });
        await view(home.x, home.y, 500);
        await shot('resources-sector');
        timings.resourcesSector = await timeOverlay(120);
        await view(home.x, home.y, 2500);
        await shot('resources-galaxy');
        timings.resourcesGalaxy = await timeOverlay(120);
        // Filtered: the most widely known very rare / rare resource, else any (the picker's choice, set directly).
        const pick = await page.evaluate(() => {
            const g = window.__dwu.game.galaxy;
            const p = g.playerEmpire;
            const counts = new Map();
            for (const h of g.habitats) {
                if (h.resources.length === 0 || !p.resourceMap.checkResourcesKnown(h)) continue;
                for (const r of h.resources) counts.set(r.resourceId, (counts.get(r.resourceId) ?? 0) + 1);
            }
            const byName = (n) => g.resourceSystem.resources.find((r) => r.name === n);
            const cas = byName('Caslon');
            const id = cas && counts.has(cas.resourceId) ? cas.resourceId : [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
            return id === null ? null : { id, name: g.resourceSystem.byId.get(id).name, habitats: counts.get(id) };
        });
        console.log(`filter: ${JSON.stringify(pick)}`);
        if (pick !== null) {
            // Through the HUD: the View popup's Improvements section, the Resources row's "…" picker.
            await page.click('.hud-options-toggle');
            await page.waitForTimeout(300);
            await page.click('.hud-option-row[data-overlay="resources"] .hud-option-more');
            await page.waitForTimeout(300);
            await page.selectOption('select.hud-option-select', String(pick.id));
            await shot('view-popup-resource-picker', 800);
            await page.click('.hud-options-toggle');
            await view(home.x, home.y, 1500);
            await shot(`resources-filter-${pick.name.toLowerCase().replace(/\W+/g, '-')}`);
            timings.resourcesFiltered = await timeOverlay(120);
            // Back to all.
            await page.click('.hud-options-toggle');
            await page.waitForTimeout(200);
            await page.selectOption('select.hud-option-select', '');
            await page.click('.hud-options-toggle');
        }
        // System zoom on the known system with the most resource habitats.
        const rich = await page.evaluate(() => {
            const g = window.__dwu.game.galaxy;
            const p = g.playerEmpire;
            const n = new Map();
            for (const h of g.habitats) if (h.resources.length > 0 && p.resourceMap.checkResourcesKnown(h)) n.set(h.systemIndex, (n.get(h.systemIndex) ?? 0) + 1);
            const best = [...n.entries()].sort((a, b) => b[1] - a[1])[0];
            if (!best) return null;
            const s = g.systems[best[0]].systemStar;
            return { x: s.xpos, y: s.ypos, name: s.name, n: best[1] };
        });
        console.log(`rich system: ${JSON.stringify(rich)}`);
        if (rich !== null) {
            await view(rich.x, rich.y, 25);
            await shot('resources-system');
            timings.resourcesSystem = await timeOverlay(120);
        }
        await overlays({ resources: false });

        // Fuel Range: nothing selected (the network), then a fleet.
        await overlays({ fuelRange: true });
        await view(home.x, home.y, 1500);
        await shot('fuel-network');
        timings.fuelNetwork = await timeOverlay(120);
        const fleet = await page.evaluate(() => {
            const p = window.__dwu.game.galaxy.playerEmpire;
            const sg = p.shipGroups.filter((s) => s?.leadShip && !s.leadShip.hasBeenDestroyed && s.leadShip.warpSpeed > 0).sort((a, b) => a.leadShip.currentFuel / a.leadShip.fuelCapacity - b.leadShip.currentFuel / b.leadShip.fuelCapacity)[0] ?? null;
            if (sg === null) return null;
            window.__dwu.view.onShipGroupSelect?.(sg);
            return { x: sg.leadShip.xpos, y: sg.leadShip.ypos, name: sg.name, fuel: sg.leadShip.currentFuel / sg.leadShip.fuelCapacity };
        });
        console.log(`fleet: ${JSON.stringify(fleet)}`);
        if (fleet !== null) {
            await view(fleet.x, fleet.y, 2500);
            await shot('fuel-fleet');
            timings.fuelFleet = await timeOverlay(120);
            await view(fleet.x, fleet.y, 400);
            await shot('fuel-fleet-close');
        }
        // Everything on at once (worst case), sector zoom.
        await overlays({ resources: true, fuelRange: true, colonyScores: true, potentialColonies: true });
        await view(home.x, home.y, 800);
        timings.allOn = await timeOverlay(180);
        await overlays({ resources: false, fuelRange: false, colonyScores: false, potentialColonies: false });
        timings.allOff = await timeOverlay(180);

        // Game Options → Improvements...
        await page.keyboard.press('o');
        await page.waitForTimeout(800);
        const adv = page.getByText('Improvements...', { exact: true });
        if ((await adv.count()) > 0) {
            await adv.first().click();
            await shot('game-options-improvements', 1200);
        } else console.log('Improvements... button not found');
    }
    console.log(`timings (overlayLayer.update ms/frame): ${JSON.stringify(timings)}`);
} catch (e) {
    console.log(`script error: ${e.stack ?? e}`);
} finally {
    console.log(`console errors / warnings (${logs.length}):`);
    for (const l of logs.slice(0, 40)) console.log(`  ${l}`);
    console.log(`shots:\n${shots.map((s) => `  ${s}`).join('\n')}`);
    await browser.close();
}
