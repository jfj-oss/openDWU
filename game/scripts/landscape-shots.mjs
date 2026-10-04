#!/usr/bin/env node
// Galaxy Map habitat landscape (pnlGalaxyMapHabitatPicture, bitmap_29[Habitat.LandscapePictureRef]) for one habitat of
// each planet type: opens the Galaxy Map on it (GalaxyMapScreen.open(habitat)) and saves the overlay. Prints each
// habitat's type, LandscapePictureRef and the landscape URL shown.
//   node scripts/landscape-shots.mjs <base url> [--out=shots/landscape] [--tag=after] [--seed=1] [--indices=12,34]
// --indices: also shoot these habitats (galaxy.habitats indices), e.g. ones whose picture differs between two builds.
// --reveal: mark each --indices habitat's system Explored first (screenshot harness only: the Galaxy Map shows a
//           landscape only for explored systems).
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5173/';
const opt = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const out = opt('out', 'shots/landscape');
const tag = opt('tag', 'after');
const seed = opt('seed', '1');
const indices = opt('indices', '').split(',').filter((x) => x !== '').map(Number);
const reveal = process.argv.includes('--reveal');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const logs = [];
page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.stack ?? e.message}`));
let failed = 0;
const shots = [];
// HabitatType (sim/types.ts) of the planet types with landscapes.
const TYPES = { Volcanic: 8, Desert: 9, MarshySwamp: 10, Continental: 11, Ocean: 12, BarrenRock: 13, Ice: 14, GasGiant: 15, FrozenGasGiant: 16 };
try {
    await page.goto(`${base}?autostart=1&seed=${seed}&simWorker=0`);
    await page.waitForFunction(() => window.__dwu?.time !== undefined && window.__dwu?.galaxy?.playerEmpire && window.__dwu?.galaxyMap, null, { timeout: 900000 });
    await page.evaluate(() => {
        window.__dwu.time.paused = true;
    });
    await page.waitForTimeout(3000);
    const targets = [...Object.entries(TYPES).map(([name, type]) => [name, { type }]), ...indices.map((i) => [`habitat${i}`, { index: i, reveal }])];
    for (const [name, target] of targets) {
        // The first planet / moon of the type (by habitat index) in a system the player has explored, else any; or the
        // habitat at the given index.
        const info = await page.evaluate((t) => {
            const d = window.__dwu;
            const g = d.galaxy;
            const vis = g.playerEmpire.visibility;
            const explored = (i) => i >= 0 && i < vis.systemVisibility.length && vis.checkSystemExplored(i);
            const cands = g.habitats.filter((h) => (h.category === 1 || h.category === 2) && h.type === t.type);
            const h = t.index !== undefined ? g.habitats[t.index] : (cands.find((x) => explored(x.systemIndex)) ?? cands[0]);
            if (!h) return null;
            if (t.reveal && !explored(h.systemIndex)) vis.systemVisibility[h.systemIndex].status = 2; // SystemVisibilityStatus.Explored
            // GalaxyMapScreen.open(selected) is a no-op while open: close, then open on the habitat.
            d.galaxyMap.close();
            d.galaxyMap.open(h);
            return { name: h.name, ref: h.landscapePictureRef, explored: explored(h.systemIndex), type: h.type, category: h.category };
        }, target);
        if (info === null) {
            console.log(`---- ${name}: no habitat of this type`);
            continue;
        }
        await page.waitForTimeout(1200);
        const bg = await page.evaluate(() => document.querySelector('.gmap-landscape')?.style.backgroundImage ?? '');
        const shown = /landscapes\//.test(bg);
        if (info.explored && !shown) failed++;
        console.log(`${info.explored && !shown ? 'FAIL' : 'ok  '} ${name}: ${info.name} (category ${info.category}, type ${info.type}) ref ${info.ref}${info.explored ? '' : ' (unexplored)'} -> ${bg || '(none)'}`);
        const path = `${out}/${tag}-${name}.png`;
        await page.screenshot({ path });
        shots.push(path);
    }
} catch (e) {
    failed++;
    console.log(`FAIL ${e.stack ?? e}`);
} finally {
    await browser.close();
}
for (const l of logs) console.log(l);
for (const s of shots) console.log(`saved ${s}`);
process.exit(failed > 0 ? 1 : 0);
