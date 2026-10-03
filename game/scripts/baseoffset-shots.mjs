// Visual check for "a mining station way too far off the centre of its moon": runs the in-page game for a while so
// construction ships build stations, then frames the mining station at a moon whose centre is farthest out (relative
// to the moon's radius) at full zoom (factor 1, as in the report) and at factor 2.
// Usage: node scripts/baseoffset-shots.mjs <baseUrl> <outDir> [tag] [gameSeconds] [moonName]
import { chromium } from 'playwright-core';
const [base = 'http://localhost:5173/', outDir = 'shots', tag = 'now', seconds = '600', moonName = ''] = process.argv.slice(2);
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`${base}?autostart=1`);
await page.waitForFunction(() => window.__dwu?.game?.playerEmpire !== undefined, null, { timeout: 180000 });
await page.waitForTimeout(3000);

const info = await page.evaluate(async ([secs, moonName]) => {
    const dwu = window.__dwu;
    const { galaxy, camera, game } = dwu;
    if (dwu.time) dwu.time.paused = true;
    const harness = await import('/src/sim/tick/harness.ts');
    harness.runGameSeconds(game, secs);
    // (Gas) mining stations at moons (HabitatCategoryType.Moon = 2), farthest out (offset / radius) first.
    const rows = [];
    for (const b of galaxy.builtObjects) {
        if (!b || !b.parentHabitat || b.role === undefined) continue;
        const h = b.parentHabitat;
        if (h.category !== 2) continue;
        if (!/Mining Station/.test(b.name)) continue;
        const d = Math.hypot(b.parentOffsetX, b.parentOffsetY);
        rows.push({ b, h, d, ratio: d / (h.diameter / 2) });
    }
    rows.sort((a, b) => b.ratio - a.ratio);
    const pick = moonName ? rows.find((r) => r.h.name === moonName) : rows[0];
    if (!pick) return { ok: false, count: rows.length };
    window.__pick = pick.b;
    camera.zoom = camera.clampZoom(1);
    camera.centerOn(pick.h.xpos, pick.h.ypos);
    return {
        ok: true,
        count: rows.length,
        base: pick.b.name,
        size: pick.b.size,
        moon: pick.h.name,
        diameter: pick.h.diameter,
        offset: [pick.b.parentOffsetX, pick.b.parentOffsetY],
        dist: +pick.d.toFixed(1),
        ratio: +pick.ratio.toFixed(2),
        surfaceRange: Math.max(pick.h.diameter - 10, 1) / 2,
        top: rows.slice(0, 6).map((r) => `${r.h.name} d=${r.h.diameter} off=${r.d.toFixed(1)} ratio=${r.ratio.toFixed(2)}`),
    };
}, [+seconds, moonName]);
console.log('setup', JSON.stringify(info, null, 1));
const follow = async (zoom) => {
    await page.evaluate((z) => {
        const { camera } = window.__dwu;
        const b = window.__pick;
        camera.zoom = camera.clampZoom(z);
        if (b) camera.centerOn(b.parentHabitat.xpos, b.parentHabitat.ypos);
    }, zoom);
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
        const { camera } = window.__dwu;
        const b = window.__pick;
        if (b) camera.centerOn(b.parentHabitat.xpos, b.parentHabitat.ypos);
    });
    await page.waitForTimeout(300);
};
await follow(1);
await page.screenshot({ path: `${outDir}/baseoffset-${tag}-f1.png` });
console.log(`saved ${outDir}/baseoffset-${tag}-f1.png`);
await follow(0.5);
await page.screenshot({ path: `${outDir}/baseoffset-${tag}-f2.png` });
console.log(`saved ${outDir}/baseoffset-${tag}-f2.png`);
await browser.close();
for (const l of logs.filter((l) => /error|pageerror/i.test(l))) console.log(l);
console.log('done');
