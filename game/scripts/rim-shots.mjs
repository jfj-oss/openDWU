// 19i captures (rim atmosphere): galaxy zoom at the core vs the rim, a rim system, the unexplored-rim murk, eyes in
// the dark at system zoom.
// Usage: node scripts/rim-shots.mjs <baseUrl> <outDir>   (4K: 1920x1080 at device scale 2)
import { chromium } from 'playwright-core';
const [base = 'http://localhost:5173/', outDir = 'shots'] = process.argv.slice(2);
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`${base}?autostart=1&scenario=rim-atmosphere`);
await page.waitForFunction(() => window.__dwu?.game?.playerEmpire !== undefined, null, { timeout: 180000 });
await page.waitForTimeout(4000);

const info = await page.evaluate(() => {
    const { galaxy, view } = window.__dwu;
    const rim = view.rimLayer;
    window.__rim = rim;
    return {
        active: rim?.active ?? false,
        geo: rim?.geo ?? null,
        scenario: galaxy.scenario?.id ?? null,
        murk: rim?.murk?.length ?? 0,
        derelicts: rim?.derelicts?.length ?? 0,
        eyes: rim?.eyes?.length ?? 0,
    };
});
console.log('rim', JSON.stringify(info));

async function shot(name, setup) {
    const where = await page.evaluate(setup);
    await page.waitForTimeout(2500);
    const path = `${outDir}/${name}.png`;
    await page.screenshot({ path });
    console.log(`saved ${path} ${JSON.stringify(where)}`);
}

// Whole galaxy, centred (wash, dust lanes; eyes in the dark are system-zoom only, so none here).
await shot('rim-galaxy-whole', () => {
    const { camera } = window.__dwu;
    const g = window.__rim.geo;
    camera.centerOn(g.cx, g.cy);
    camera.zoom = camera.minZoom;
    return { zoom: camera.zoom };
});
// Sector-ish zoom at the core vs at the rim (same zoom).
await shot('rim-galaxy-core', () => {
    const { camera } = window.__dwu;
    const g = window.__rim.geo;
    camera.centerOn(g.cx, g.cy);
    camera.zoom = camera.minZoom * 3.5;
    return { zoom: camera.zoom };
});
await shot('rim-galaxy-rim', () => {
    const { camera } = window.__dwu;
    const g = window.__rim.geo;
    camera.centerOn(g.cx + g.radius * 0.88, g.cy + g.radius * 0.12);
    camera.zoom = camera.minZoom * 3.5;
    return { zoom: camera.zoom };
});
// A rim system with a derelict nearby, at system zoom.
await shot('rim-system', () => {
    const { camera, galaxy } = window.__dwu;
    const rim = window.__rim;
    const d = rim.derelicts[0];
    let best = null;
    let bd = Infinity;
    for (const s of galaxy.systems) {
        const dx = s.systemStar.xpos - d.x;
        const dy = s.systemStar.ypos - d.y;
        const dd = dx * dx + dy * dy;
        if (dd < bd) {
            bd = dd;
            best = s;
        }
    }
    const st = best.systemStar;
    camera.centerOn((st.xpos + d.x) / 2, (st.ypos + d.y) / 2);
    camera.zoom = Math.min(0.2, camera.height / (Math.sqrt(bd) * 2.6));
    return { system: best.name, dist: Math.sqrt(bd), zoom: camera.zoom, weight: rim.weightAt(st.xpos, st.ypos) };
});
// Eyes in the dark: a rim system at system zoom, framing an eye pair and its star.
await shot('rim-eyes-system', () => {
    const { camera, galaxy } = window.__dwu;
    const rim = window.__rim;
    const e = rim.eyes[0];
    let best = null;
    let bd = Infinity;
    for (const s of galaxy.systems) {
        const dx = s.systemStar.xpos - e.x;
        const dy = s.systemStar.ypos - e.y;
        const dd = dx * dx + dy * dy;
        if (dd < bd) {
            bd = dd;
            best = s;
        }
    }
    const st = best.systemStar;
    camera.centerOn((st.xpos + e.x) / 2, (st.ypos + e.y) / 2);
    camera.zoom = Math.max(0.02, camera.height / (Math.sqrt(bd) * 2.2));
    return { system: best.name, dist: Math.sqrt(bd), zoom: camera.zoom, eyes: rim.eyes.length, weight: rim.weightAt(st.xpos, st.ypos) };
});
// Murk over an unexplored rim system (mid zoom so neighbouring patches show).
await shot('rim-murk', () => {
    const { camera } = window.__dwu;
    const rim = window.__rim;
    const m = rim.murk.reduce((a, b) => (b.w > a.w ? b : a), rim.murk[0]);
    camera.centerOn(m.x, m.y);
    camera.zoom = camera.height / (rim.murkSize * 3);
    return { murkPatches: rim.murk.length, zoom: camera.zoom };
});
// Perf: the layer's per-frame update cost at the rim (murk + derelicts + grain), 300 calls.
const perf = await page.evaluate(() => {
    const { camera } = window.__dwu;
    const rim = window.__rim;
    const t0 = performance.now();
    for (let i = 0; i < 300; i++) rim.update(camera.zoom, camera, 1);
    return { msPerUpdate: (performance.now() - t0) / 300 };
});
console.log('perf', JSON.stringify(perf));
await browser.close();
for (const l of logs) if (!l.startsWith('[log]') && !l.startsWith('[debug]')) console.log(l);
