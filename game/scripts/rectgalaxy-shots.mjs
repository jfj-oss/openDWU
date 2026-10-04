// Non-square custom galaxy captures (wip/rectgalaxy): a 10 × 90 / 700-star game in-thread and with the sim in the worker
// (?simWorker=1): the Main View at start and zoomed all the way out, the far (bottom) end of the strip, the HUD system
// map (region view) and the Galaxy Map window; then it runs a while at speed and reports console errors.
// Usage: node scripts/rectgalaxy-shots.mjs <baseUrl> <outDir> [sectorsW] [sectorsH] [stars] [w] [h]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const [base = 'http://localhost:5173/', outDir = 'shots/rectgalaxy', sw = '10', sh = '90', starsArg = '700', w = '1600', h = '900'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const SW = +sw;
const SH = +sh;
const STARS = +starsArg;
const tag = `${SW}x${SH}`;
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const failures = [];
const check = (cond, what) => {
    console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`);
    if (!cond) failures.push(what);
};
const base1 = base.replace(/\/$/, '') + '/';

for (const mode of ['inthread', 'worker']) {
    const logs = [];
    const page = await browser.newPage({ viewport: { width: +w, height: +h } });
    page.on('console', (m) => {
        if (m.type() === 'error') logs.push(`[${m.type()}] ${m.text()}`);
    });
    page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
    const shot = async (name, wait = 2500) => {
        await page.waitForTimeout(wait);
        const path = `${outDir}/${name}.png`;
        await page.screenshot({ path });
        console.log(`saved ${path}`);
    };
    const ng = encodeURIComponent(JSON.stringify({ seed: 7, customSectorWidth: SW, customSectorHeight: SH, customStarCount: STARS, otherEmpires: { empireCount: 9 } }));
    const t0 = Date.now();
    await page.goto(`${base1}?newgame=${ng}&intro=0&simWorker=${mode === 'worker' ? 1 : 0}`);
    await page.waitForFunction(() => window.__dwu?.game?.playerEmpire !== undefined, null, { timeout: 900000 });
    console.log(`  ${mode}: game started in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    const info = await page.evaluate(() => {
        const g = window.__dwu.galaxy;
        return { sw: g.sectorWidth, sh: g.sectorHeight, stars: g.starCount, worker: window.__dwu.simWorker != null };
    });
    check(info.sw === SW && info.sh === SH && info.stars === STARS && info.worker === (mode === 'worker'), `${mode}: galaxy ${JSON.stringify(info)}`);
    await page.evaluate(() => {
        for (const el of document.querySelectorAll('[data-ow="introduction"] button')) if (el.textContent.includes('Start')) el.click();
    });
    await shot(`game-${tag}-start-${mode}`);
    // All the way out (the minimap shows the region view at this zoom).
    await page.evaluate(() => {
        const cam = window.__dwu.camera;
        const g = window.__dwu.galaxy;
        cam.x = g.sizeX / 2;
        cam.y = g.sizeY / 2;
        cam.zoom = cam.minZoom;
    });
    await shot(`game-${tag}-zoomed-out-${mode}`);
    const bounds = await page.evaluate(() => {
        const cam = window.__dwu.camera;
        const g = window.__dwu.galaxy;
        const a = cam.worldToScreen(0, 0);
        const b = cam.worldToScreen(g.sizeX, g.sizeY);
        return { a, b, vw: cam.width, vh: cam.height };
    });
    check(bounds.a.x >= -1 && bounds.a.y >= -1 && bounds.b.x <= bounds.vw + 1 && bounds.b.y <= bounds.vh + 1, `${mode}: the whole galaxy fits the zoomed-out view ${JSON.stringify(bounds)}`);
    const sysmap = await page.$('.hud-sysmap');
    if (sysmap !== null) {
        await sysmap.screenshot({ path: `${outDir}/minimap-${tag}-zoomed-out-${mode}.png` });
        console.log(`saved ${outDir}/minimap-${tag}-zoomed-out-${mode}.png`);
    }
    // The far end of the strip: the system with the largest x + y, at sector zoom; then the minimap there.
    await page.evaluate(() => {
        const cam = window.__dwu.camera;
        const g = window.__dwu.galaxy;
        let best = g.systems[0].systemStar;
        for (const s of g.systems) if (s.systemStar.xpos + s.systemStar.ypos > best.xpos + best.ypos) best = s.systemStar;
        cam.x = best.xpos;
        cam.y = best.ypos;
        cam.zoom = 1 / 3000;
    });
    await shot(`game-${tag}-far-end-sector-${mode}`);
    if (sysmap !== null) {
        await sysmap.screenshot({ path: `${outDir}/minimap-${tag}-far-end-${mode}.png` });
        console.log(`saved ${outDir}/minimap-${tag}-far-end-${mode}.png`);
    }
    if (mode === 'inthread') {
        await page.evaluate(() => window.__dwu.galaxyMap.open());
        await shot(`game-${tag}-galaxy-map-${mode}`);
        await page.keyboard.press('Escape');
    } else {
        await page.keyboard.press('g');
        await shot(`game-${tag}-galaxy-map-${mode}`);
        await page.keyboard.press('Escape');
    }
    // Let it run a while.
    await page.evaluate(() => {
        window.__dwu.time.speed = 8;
        window.__dwu.time.paused = false;
    });
    await page.waitForTimeout(15000);
    await shot(`game-${tag}-after-run-${mode}`, 500);
    check(logs.length === 0, `${mode}: console errors: ${logs.slice(0, 5).join(' | ') || 'none'}`);
    await page.close();
}

await browser.close();
console.log(failures.length === 0 ? 'ALL OK' : `${failures.length} FAILED`);
process.exit(failures.length === 0 ? 0 : 1);
