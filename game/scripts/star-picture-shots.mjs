#!/usr/bin/env node
// Star pictures (Habitat.MapPictureRef → bitmap_196, Main.Part13.cs LoadMapStars; Galaxy.5.cs SetupSun 1328
// SelectHabitatPictures, Galaxy.6.cs 2214-2237): one star of each type, selected, at
//   - "close"  : zoom factor 20 (the rotating discs + corona of every disc type, tinted by the map star's centre pixel),
//   - "system" : hud.SYSTEM_LEVEL_ZOOM (factor 50),
//   - "sector" : factor 500 (the small map-star icon),
//   - "galaxy" : the whole galaxy (camera min zoom),
// with the selection panel showing the star's picture. Prints each star's MapPictureRef / PictureRef and the picture
// URLs the Main View (and the habitat panel) and the lists use.
//   node scripts/star-picture-shots.mjs <base url> [--out=shots/starpics] [--tag=after] [--seed=1]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5173/';
const opt = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const out = opt('out', 'shots/starpics');
const tag = opt('tag', 'after');
const seed = opt('seed', '1');
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

// sim/types.ts HabitatType: MainSequence 1 … SuperNova 7.
const TYPES = [['mainsequence', 1], ['redgiant', 2], ['supergiant', 3], ['whitedwarf', 4], ['neutron', 5], ['blackhole', 6], ['supernova', 7]];
const ZOOMS = [['close', 20], ['system', 50], ['sector', 500]];

try {
    await page.goto(`${base}?autostart=1&seed=${seed}&simWorker=0`);
    await page.waitForFunction(() => window.__dwu?.time !== undefined && window.__dwu?.galaxy?.playerEmpire, null, { timeout: 900000 });
    await page.evaluate(() => {
        window.__dwu.time.paused = true;
    });
    await page.waitForTimeout(4000);
    for (const [name, type] of TYPES) {
        for (const [zoomName, factor] of ZOOMS) {
            const info = await page.evaluate(async ([type, factor]) => {
                const d = window.__dwu;
                const g = d.galaxy;
                const hud = await import('/src/ui/hud.ts');
                const sel = await import('/src/ui/selectionInfo.ts');
                const assets = await import('/src/render/assets.ts');
                // A module instance of its own (the app's import may carry a Vite ?t= stamp): its own manifest copy.
                if (assets.mapStarImageUrls === undefined || assets.mapStarImageUrls().length === 0) await assets.loadManifest();
                const vis = g.playerEmpire.visibility;
                const explored = (i) => i >= 0 && i < vis.systemVisibility.length && vis.checkSystemExplored(i);
                const cands = g.habitats.filter((h) => h.category === 0 && h.type === type);
                const h = cands.find((x) => explored(x.systemIndex)) ?? cands[0];
                if (!h) return null;
                // Screenshot harness only: mark the system explored so the selection panel shows the star.
                if (!explored(h.systemIndex)) vis.systemVisibility[h.systemIndex].status = 2;
                d.camera.centerOn(h.xpos, h.ypos);
                d.camera.zoomAt(1 / factor, d.camera.width / 2, d.camera.height / 2);
                hud.selectHabitat(h, false);
                return { name: h.name, index: h.habitatIndex, type: h.type, pictureRef: h.pictureRef, mapPictureRef: h.mapPictureRef, map: (assets.starPictureUrls ?? assets.mapStarUrls)(h)[0] ?? null, panel: sel.habitatImageUrl(h) };
            }, [type, factor]);
            if (info === null) {
                console.log(`---- ${name}: none in this galaxy`);
                break;
            }
            await page.waitForTimeout(2500);
            const ok = info.panel !== null && info.map !== null;
            if (!ok) failed++;
            console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} ${zoomName}: #${info.index} ${info.name} pictureRef ${info.pictureRef} mapPictureRef ${info.mapPictureRef} main view ${info.map} list ${info.panel}`);
            await shoot(`${name}-${zoomName}`);
        }
    }
    // The whole galaxy.
    await page.evaluate(() => {
        const d = window.__dwu;
        d.camera.centerOn(d.galaxy.sizeX / 2, d.galaxy.sizeY / 2);
        d.camera.zoomAt(d.camera.minZoom, d.camera.width / 2, d.camera.height / 2);
    });
    await page.waitForTimeout(2500);
    await shoot('galaxy');
} catch (e) {
    failed++;
    console.log(`FAIL ${e.stack ?? e}`);
}
await browser.close();
for (const l of logs) console.log(l);
for (const s of shots) console.log(`saved ${s}`);
process.exit(failed > 0 ? 1 : 0);
