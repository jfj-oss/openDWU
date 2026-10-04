// Custom galaxy size captures (wip/customsize): the New Game wizard's Galaxy page with the star-count box and the
// "Sectors: W × H" boxes (presets, a 90 × 90 / 4000-star custom size, a sparse-density warning), the Jump Start page's
// copy of the controls, and a started 90 × 90 / 4000-star game: the Main View zoomed all the way out and in on the far
// corner, and the Galaxy Map. A second, smaller 90 × 90 game (500 stars) runs with the sim in the worker (?simWorker=1).
// Usage: node scripts/customsize-shots.mjs <baseUrl> <outDir> [w] [h]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const [base = 'http://localhost:5173/', outDir = 'shots/customsize', w = '1600', h = '900'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const failures = [];
const check = (cond, what) => {
    console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`);
    if (!cond) failures.push(what);
};
const newPage = async () => {
    const logs = [];
    const page = await browser.newPage({ viewport: { width: +w, height: +h } });
    page.on('console', (m) => {
        if (m.type() === 'error') logs.push(`[${m.type()}] ${m.text()}`);
    });
    page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
    const shot = async (name, wait = 700) => {
        await page.waitForTimeout(wait);
        const path = `${outDir}/${name}.png`;
        await page.screenshot({ path });
        console.log(`saved ${path}`);
    };
    return { page, logs, shot };
};
const base1 = base.replace(/\/$/, '') + '/';

// ---- 1. The wizard.
{
    const { page, logs, shot } = await newPage();
    await page.goto(`${base1}?screen=wizard`);
    await page.waitForSelector('.wizard-window', { state: 'visible', timeout: 60000 });
    await page.click('.wizard-type-custom .wizard-type-btn');
    await page.waitForSelector('.wizard-sectors-w:visible', { timeout: 10000 });
    // The Galaxy and Jump Start pages each have the controls; read the visible ones.
    const read = () => page.evaluate(() => {
        const q = (sel) => [...document.querySelectorAll(sel)].find((e) => e.closest('.wizard-page')?.offsetParent != null);
        const warn = q('.wizard-density-warning');
        return {
            stars: q('.wizard-star-count').value,
            w: q('.wizard-sectors-w').value,
            h: q('.wizard-sectors-h').value,
            starPreset: q('.wizard-star-preset').selectedOptions[0]?.textContent,
            sizePreset: q('.wizard-sectors-preset').selectedOptions[0]?.textContent,
            warning: warn.hidden ? '' : warn.textContent,
        };
    });
    const d = await read();
    check(d.stars === '700' && d.w === '10' && d.h === '10' && d.starPreset === 'Standard 700' && d.sizePreset === 'Large 10×10', `wizard defaults: ${JSON.stringify(d)}`);
    await shot('wizard-galaxy-default');
    const type = async (sel, v) => {
        await page.fill(`${sel}:visible`, String(v));
        await page.press(`${sel}:visible`, 'Tab');
    };
    await type('.wizard-sectors-w', 90);
    await type('.wizard-sectors-h', 90);
    await type('.wizard-star-count', 4000);
    const c = await read();
    check(c.stars === '4000' && c.w === '90' && c.h === '90' && c.starPreset === 'Custom' && c.sizePreset === 'Custom' && c.warning === '', `custom 90×90 / 4000: ${JSON.stringify(c)}`);
    await shot('wizard-galaxy-custom-90x90-4000');
    await type('.wizard-star-count', 500);
    const s = await read();
    check(s.warning.startsWith('Very sparse'), `sparse warning: ${s.warning}`);
    await shot('wizard-galaxy-sparse-warning');
    await type('.wizard-sectors-w', 2);
    await type('.wizard-sectors-h', 2);
    await type('.wizard-star-count', 9999);
    const dense = await read();
    check(dense.stars === '400' && dense.warning.startsWith('Very dense'), `2×2 clamps the star count to the density cap and warns: ${JSON.stringify(dense)}`);
    await shot('wizard-galaxy-dense-warning');
    // Back to the presets.
    await page.selectOption('.wizard-sectors-preset:visible', { label: 'Large 10×10' });
    await page.selectOption('.wizard-star-preset:visible', { label: 'Standard 700' });
    const back = await read();
    check(back.stars === '700' && back.w === '10' && back.starPreset === 'Standard 700', `presets restore: ${JSON.stringify(back)}`);
    check(logs.length === 0, `wizard console errors: ${logs.join(' | ') || 'none'}`);
    await page.close();
}

// ---- 2. Jump Start page.
{
    const { page, logs, shot } = await newPage();
    await page.goto(`${base1}?screen=wizard`);
    await page.waitForSelector('.wizard-window', { state: 'visible', timeout: 60000 });
    await page.click('.wizard-type-eras .wizard-type-btn:not([disabled])');
    await page.waitForSelector('.wizard-sectors-w:visible', { timeout: 10000 });
    await shot('wizard-jumpstart');
    check(logs.length === 0, `jump start console errors: ${logs.join(' | ') || 'none'}`);
    await page.close();
}

// ---- 3. A started 90 × 90 / 4000-star game (in-thread) and a 90 × 90 / 500-star one in the worker.
for (const [mode, stars] of [['inthread', 4000], ['worker', 500]]) {
    const { page, logs, shot } = await newPage();
    const ng = encodeURIComponent(JSON.stringify({ seed: 1, customSectorWidth: 90, customSectorHeight: 90, customStarCount: stars, otherEmpires: { empireCount: 9 } }));
    const t0 = Date.now();
    await page.goto(`${base1}?newgame=${ng}&intro=0&simWorker=${mode === 'worker' ? 1 : 0}`);
    await page.waitForFunction(() => window.__dwu?.game?.playerEmpire !== undefined, null, { timeout: 900000 });
    console.log(`  ${mode}: game started in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    const info = await page.evaluate(() => {
        const g = window.__dwu.galaxy;
        return { sw: g.sectorWidth, sh: g.sectorHeight, stars: g.starCount, worker: window.__dwu.simWorker != null };
    });
    check(info.sw === 90 && info.sh === 90 && info.stars === stars, `${mode}: galaxy ${JSON.stringify(info)}`);
    await page.evaluate(() => {
        for (const el of document.querySelectorAll('[data-ow="introduction"] button')) if (el.textContent.includes('Start')) el.click();
    });
    await shot(`game-90x90-${stars}-start-${mode}`, 2500);
    // All the way out.
    await page.evaluate(() => {
        const cam = window.__dwu.camera;
        const g = window.__dwu.galaxy;
        cam.x = g.sizeX / 2;
        cam.y = g.sizeY / 2;
        cam.zoom = cam.minZoom;
    });
    await shot(`game-90x90-${stars}-zoomed-out-${mode}`, 2500);
    if (mode === 'inthread') {
        // In close on the far corner's last system (the largest coordinates the renderer sees).
        await page.evaluate(() => {
            const cam = window.__dwu.camera;
            const g = window.__dwu.galaxy;
            let best = g.systems[0].systemStar;
            for (const s of g.systems) if (s.systemStar.xpos + s.systemStar.ypos > best.xpos + best.ypos) best = s.systemStar;
            cam.x = best.xpos;
            cam.y = best.ypos;
            cam.zoom = 0.05;
        });
        await shot(`game-90x90-${stars}-far-corner-system-${mode}`, 2500);
        await page.evaluate(() => window.__dwu.galaxyMap.open());
        await shot(`game-90x90-${stars}-galaxy-map-${mode}`, 2500);
        await page.keyboard.press('Escape');
    }
    // Let it run a little.
    await page.evaluate(() => {
        window.__dwu.time.speed = 8;
        window.__dwu.time.paused = false;
    });
    await page.waitForTimeout(8000);
    check(logs.length === 0, `${mode}: console errors: ${logs.slice(0, 5).join(' | ') || 'none'}`);
    await page.close();
}

await browser.close();
console.log(failures.length === 0 ? 'ALL OK' : `${failures.length} FAILED`);
process.exit(failures.length === 0 ? 0 : 1);
