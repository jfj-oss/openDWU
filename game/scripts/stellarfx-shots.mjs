#!/usr/bin/env node
// Black holes, super novae and gas clouds in the Main View at every zoom band (task: stellar effects):
//   - "galaxy" : zoom factor 3000 (the galaxy pass: map-star icon / nova picture / gas-cloud cross),
//   - "sector" : factor 400 (galaxy-pass art plus the system pass, f < 500),
//   - "system" : factor 60 (system pass only: the black hole's rotating layers + accretion frames, the gas cloud's
//                 generated cloud, a super nova's pulsing location fill),
//   - "close"  : factor 12.
// For a gas cloud it also hovers the cloud at system zoom and prints the tooltip text.
//   node scripts/stellarfx-shots.mjs <base url> [--out=shots/stellarfx] [--tag=after] [--seed=1] [--worker=0|1] [--load=<save url>]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5173/';
const opt = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const out = opt('out', 'shots/stellarfx');
const tag = opt('tag', 'after');
const seed = opt('seed', '1');
const worker = opt('worker', '0');
// --load=/dev-saves/late2500.dwusave boots a save (main.ts ?load=) instead of a new seed-`seed` game.
const load = opt('load', '');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const logs = [];
const shots = [];
let failed = 0;
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.stack ?? e.message}`));
const shoot = async (name) => {
    const path = `${out}/${tag}-${name}.png`;
    await page.screenshot({ path });
    shots.push(path);
};

// [label, HabitatCategoryType, HabitatType] (sim/types.ts: Star 0 / GasCloud 4; BlackHole 6, SuperNova 7).
const TARGETS = [['blackhole', 0, 6], ['supernova', 0, 7], ['gascloud', 4, -1]];
const ZOOMS = [['galaxy', 3000], ['sector', 400], ['system', 60], ['close', 12]];

try {
    await page.goto(load !== '' ? `${base}?load=${encodeURIComponent(load)}&simWorker=${worker}` : `${base}?autostart=1&seed=${seed}&simWorker=${worker}`);
    await page.waitForFunction(() => window.__dwu?.time !== undefined && window.__dwu?.galaxy?.playerEmpire, null, { timeout: 900000 });
    await page.waitForTimeout(4000);
    // The black hole's layers and accretion frames run on game time (Galaxy.CurrentDateTime): unpause.
    await page.evaluate(() => {
        window.__dwu.time.paused = false;
    });
    for (const [name, category, type] of TARGETS) {
        for (const [zoomName, factor] of ZOOMS) {
            const info = await page.evaluate(([category, type, factor]) => {
                const d = window.__dwu;
                const g = d.galaxy;
                const cands = g.habitats.filter((x) => x.category === category && (type < 0 || x.type === type));
                // Prefer one the player has explored (the hover names it; an unexplored one is "(Unexplored Gas Cloud)").
                const vis = g.playerEmpire?.visibility;
                const explored = (x) => vis !== undefined && vis.checkSystemVisibilityStatus(x.systemIndex) >= 2;
                const h = cands.find(explored) ?? cands[0];
                if (!h) return null;
                d.camera.centerOn(h.xpos, h.ypos);
                d.camera.zoomAt(1 / factor, d.camera.width / 2, d.camera.height / 2);
                return { name: h.name, index: h.habitatIndex, type: h.type, diameter: h.diameter, nova: h.novaProgression };
            }, [category, type, factor]);
            if (info === null) {
                console.log(`---- ${name}: none in this galaxy`);
                break;
            }
            // Let the lazy art (accretion frames, generated cloud) load and the animation run.
            await page.waitForTimeout(zoomName === 'system' ? 4000 : 2500);
            console.log(`ok   ${name} ${zoomName} (f ${factor}): #${info.index} ${info.name} type ${info.type} diameter ${info.diameter}${info.nova ? ` nova ${Math.round(info.nova)}` : ''}`);
            await shoot(`${name}-${zoomName}`);
            if (name === 'blackhole' && zoomName === 'system') {
                // A second frame: the layers rotate and the accretion frames advance with game time.
                await page.waitForTimeout(1500);
                await shoot(`${name}-${zoomName}-later`);
            }
            if (name === 'gascloud' && (zoomName === 'system' || zoomName === 'galaxy')) {
                await page.mouse.move(790, 440);
                await page.mouse.move(800, 450, { steps: 4 });
                await page.waitForTimeout(900);
                const tip = await page.evaluate(() => document.querySelector('.dwu-map-tooltip')?.textContent ?? null);
                console.log(`     tooltip at ${zoomName}: ${JSON.stringify(tip)}`);
                await page.mouse.move(1100, 300); // away from the edges (edge scrolling)
            }
        }
    }
} catch (e) {
    failed++;
    console.log(`FAIL ${e.stack ?? e}`);
}
await browser.close();
for (const l of logs) console.log(l);
for (const s of shots) console.log(`saved ${s}`);
process.exit(failed > 0 ? 1 : 0);
