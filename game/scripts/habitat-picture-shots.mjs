#!/usr/bin/env node
// Habitat pictures (Habitat.PictureRef → HabitatImageCache, GalaxyImages.cs 11-58) and the race-on-native-landscape
// composite (Main.Part11.cs method_119 / method_121):
//   - "planet-<type>": one planet / moon of each type (and one asteroid of each kind) at system zoom
//     (hud.SYSTEM_LEVEL_ZOOM) and selected, so the Main View sprite and the selection panel picture both show; also a
//     600 × 600 close-up crop of the view centre;
//   - "talk": the diplomacy talk panel's race picture (Main.Part8.cs 499 method_118, 280 × 280);
//   - "wizard-race" / "wizard-pirate" / "jumpstart": the new-game wizard's race picture (Start.1.cs 4189), the pirate
//     playstyle picture (Start.2.cs 3201) and the Jump Start race picture (Start.cs 5152).
// Prints each habitat's PictureRef and the sprite URL shown.
//   node scripts/habitat-picture-shots.mjs <base url> [--out=shots/habitatpics] [--tag=after] [--seed=1] [--only=planets|race]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5173/';
const opt = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const out = opt('out', 'shots/habitatpics');
const tag = opt('tag', 'after');
const seed = opt('seed', '1');
const only = opt('only', '');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const logs = [];
const shots = [];
let failed = 0;
async function newPage() {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    page.on('console', (m) => {
        if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
    });
    page.on('pageerror', (e) => logs.push(`[pageerror] ${e.stack ?? e.message}`));
    return page;
}
/** The opaque-pixel share and the mean colour of the visible composite canvas inside `selector` (null: no canvas). */
const canvasStats = (page, selector) =>
    page.evaluate((sel) => {
        const c = [...document.querySelectorAll(`${sel} canvas, canvas${sel}`)].find((x) => x.getBoundingClientRect().width > 0);
        if (!c) return null;
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let opaque = 0;
        const sum = [0, 0, 0];
        for (let i = 0; i < d.length; i += 4) {
            if (d[i + 3] > 200) opaque++;
            sum[0] += d[i];
            sum[1] += d[i + 1];
            sum[2] += d[i + 2];
        }
        const n = d.length / 4;
        return `${c.width}x${c.height} opaque ${Math.round((100 * opaque) / n)}% mean rgb(${sum.map((v) => Math.round(v / n)).join(',')})`;
    }, selector);
const shoot = async (page, name, clip) => {
    const path = `${out}/${tag}-${name}.png`;
    await page.screenshot(clip ? { path, clip } : { path });
    shots.push(path);
};

// [label, category filter, HabitatType] (sim/types.ts HabitatCategoryType / HabitatType values).
const TARGETS = [
    ['barrenrock', 'body', 13], ['continental', 'body', 11], ['ice', 'body', 14], ['marshyswamp', 'body', 10], ['ocean', 'body', 12],
    ['desert', 'body', 9], ['volcanic', 'body', 8], ['gasgiant', 'body', 15], ['frozengasgiant', 'body', 16],
    ['asteroid-rocky', 'asteroid', 13], ['asteroid-ice', 'asteroid', 14], ['asteroid-metal', 'asteroid', 25],
];

if (only === '' || only === 'planets') try {
    const page = await newPage();
    await page.goto(`${base}?autostart=1&seed=${seed}&simWorker=0`);
    await page.waitForFunction(() => window.__dwu?.time !== undefined && window.__dwu?.galaxy?.playerEmpire, null, { timeout: 900000 });
    await page.evaluate(() => {
        window.__dwu.time.paused = true;
    });
    await page.waitForTimeout(4000);
    for (const [name, kind, type] of TARGETS) {
        const info = await page.evaluate(async ([kind, type]) => {
            const d = window.__dwu;
            const g = d.galaxy;
            const hud = await import('/src/ui/hud.ts');
            const sel = await import('/src/ui/selectionInfo.ts');
            const vis = g.playerEmpire.visibility;
            const explored = (i) => i >= 0 && i < vis.systemVisibility.length && vis.checkSystemExplored(i);
            const cands = g.habitats.filter((h) => (kind === 'asteroid' ? h.category === 3 : h.category === 1 || h.category === 2) && h.type === type);
            const h = cands.find((x) => explored(x.systemIndex)) ?? cands[0];
            if (!h) return null;
            // Screenshot harness only: mark the system explored so the selection panel shows the habitat.
            if (!explored(h.systemIndex)) vis.systemVisibility[h.systemIndex].status = 2;
            d.camera.centerOn(h.xpos, h.ypos);
            d.camera.zoomAt(hud.SYSTEM_LEVEL_ZOOM, d.camera.width / 2, d.camera.height / 2);
            hud.selectHabitat(h, false);
            return { name: h.name, index: h.habitatIndex, category: h.category, type: h.type, pictureRef: h.pictureRef, url: sel.habitatImageUrl(h) };
        }, [kind, type]);
        if (info === null) {
            console.log(`---- ${name}: none`);
            continue;
        }
        await page.waitForTimeout(2500);
        const ok = info.url !== null;
        if (!ok) failed++;
        console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: #${info.index} ${info.name} (category ${info.category}, type ${info.type}) pictureRef ${info.pictureRef} -> ${info.url}`);
        await shoot(page, `planet-${name}`);
        await shoot(page, `planet-${name}-close`, { x: 500, y: 150, width: 600, height: 600 });
    }
    await page.close();
} catch (e) {
    failed++;
    console.log(`FAIL ${e.stack ?? e}`);
}

if (only === '' || only === 'race') {
    // Diplomacy talk panel (the first met AI empire, and a pirate faction).
    try {
        const page = await newPage();
        await page.goto(`${base}?autostart=1&seed=${seed}&simWorker=0`);
        await page.waitForFunction(() => window.__dwu?.game?.playerEmpire !== undefined, null, { timeout: 900000 });
        await page.waitForTimeout(3000);
        const races = await page.evaluate(() => {
            const g = window.__dwu.galaxy;
            const p = g.playerEmpire;
            window.__dwu.time.paused = true;
            const out = [];
            for (const r of p.diplomaticRelations) {
                if (r.type === 0 && r.otherEmpire && r.otherEmpire.pirateEmpireBaseHabitat === null) {
                    r.type = 1;
                    const t = r.otherEmpire.diplomaticRelations.byEmpire(p);
                    if (t) t.type = 1;
                }
            }
            for (const r of p.pirateRelations ?? []) if (r.type === 0) r.type = 1;
            for (const r of p.diplomaticRelations) if (r.otherEmpire) out.push(`${r.otherEmpire.name}: ${r.otherEmpire.dominantRace?.name} (native ${r.otherEmpire.dominantRace?.nativeHabitatType}, picture ${r.otherEmpire.dominantRace?.pictureIndex})`);
            return out;
        });
        for (const r of races) console.log(`     ${r}`);
        await page.click('[data-hud="tbtnEmpires"]');
        await page.waitForSelector('[data-ow="diplomacy"]');
        await page.waitForTimeout(1500);
        const n = await page.locator('[data-ow="diplomacy"] .ow-grid-row').count();
        for (const [label, row] of [['talk', 1], ['talk-last', n - 1]]) {
            await page.locator('[data-ow="diplomacy"] .ow-grid-row').nth(row).click();
            await page.waitForTimeout(600);
            await page.locator('[data-ow="diplomacy"] .ow-glass', { hasText: 'Speak with' }).click();
            await page.waitForTimeout(2000);
            await shoot(page, label);
            console.log(`     ${label} composite: ${await canvasStats(page, '.dip-talk-race')}`);
            const box = await page.locator('.dip-talk-race').first().boundingBox().catch(() => null);
            if (box) await shoot(page, `${label}-picture`, { x: Math.max(0, box.x - 10), y: Math.max(0, box.y - 10), width: box.width + 20, height: box.height + 20 });
        }
        await page.close();
    } catch (e) {
        failed++;
        console.log(`FAIL talk: ${e.stack ?? e}`);
    }
    // The wizard pages.
    for (const [label, query, selector] of [
        ['wizard-race', 'page=race', '.wizard-race-portrait-wrap'],
        ['wizard-pirate', 'page=empire&type=CustomPirate', '.wizard-pirate-playstyle-img'],
        ['jumpstart', 'page=jumpstart&type=ClassicEra', '.wizard-jumpstart-race-img'],
    ]) {
        try {
            const page = await newPage();
            await page.goto(`${base}?screen=wizard&${query}`);
            await page.waitForTimeout(5000);
            await shoot(page, label);
            console.log(`     ${label} composite: ${await canvasStats(page, selector)}`);
            const box = await page.locator(`${selector}:visible`).first().boundingBox().catch(() => null);
            if (box) await shoot(page, `${label}-picture`, { x: Math.max(0, box.x - 10), y: Math.max(0, box.y - 10), width: box.width + 20, height: box.height + 20 });
            else console.log(`---- ${label}: no ${selector}`);
            await page.close();
        } catch (e) {
            failed++;
            console.log(`FAIL ${label}: ${e.stack ?? e}`);
        }
    }
}

await browser.close();
for (const l of logs) console.log(l);
for (const s of shots) console.log(`saved ${s}`);
process.exit(failed > 0 ? 1 : 0);
