// Known-core marker captures (Giantworks Beacon, render/threatMarkers.ts coreMark). Usage: node scripts/corekey-shots.mjs <baseUrl> <outDir> [prefix]
// Boots `?autostart=1&scenario=threat-framework&simWorker=0&reveal=1`, pauses the clock and marks two of the player's own worlds as
// known harvest cores (artBundleLayer setThreatSitesSource, glyph 'core'), then shoots the system view (zoomed on one) and the galaxy view.
// Headless Chromium on the GPU (ANGLE / Vulkan), never SwiftShader.
import { chromium } from 'playwright-core';
const [base = 'http://localhost:5173/', outDir = 'shots', prefix = ''] = process.argv.slice(2);
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
    args: ['--use-gl=angle', '--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`${base}?autostart=1&scenario=threat-framework&simWorker=0&reveal=1&stars=300&seed=3`);
await page.waitForFunction(() => window.__dwu?.game?.playerEmpire !== undefined, null, { timeout: 240000 });
await page.waitForTimeout(3000);
console.log('gpu', await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
}));
const setup = await page.evaluate(async () => {
    const { galaxy, game } = window.__dwu;
    window.__dwu.time.paused = true;
    const abl = await import('/src/render/artBundleLayer.ts');
    const emp = game.playerEmpire;
    const cols = emp.colonies.filter((c) => c !== emp.capital).slice(0, 2);
    const worlds = cols.length >= 2 ? cols : emp.colonies.slice(0, 2);
    abl.setThreatSitesSource(() => worlds.map((h) => ({ threat: 'beacon', kind: 'colony', target: h, level: 3, label: h.name, glyph: 'core' })));
    window.__ck = worlds.map((h) => ({ x: h.xpos, y: h.ypos, name: h.name }));
    return window.__ck;
});
console.log('setup', JSON.stringify(setup));
async function shot(file, fn, arg, wait = 2500) {
    await page.evaluate(fn, arg);
    await page.waitForTimeout(wait);
    await page.screenshot({ path: `${outDir}/${prefix}${file}` });
    console.log(`saved ${outDir}/${prefix}${file}`);
}
const at = ([z, i]) => {
    const { camera } = window.__dwu;
    const w = window.__ck[i];
    camera.zoomAt(z, camera.width / 2, camera.height / 2);
    camera.centerOn(w.x, w.y);
};
await shot('system-close.png', at, [1, 0], 3500);
await shot('system-mid.png', at, [1 / 4, 0]);
await shot('system-wide.png', at, [1 / 12, 0]);
await shot('galaxy.png', at, [1 / 80, 0]);
await shot('galaxy-far.png', at, [1 / 400, 0]);
await browser.close();
for (const l of logs.filter((l) => /error|pageerror/i.test(l)).slice(0, 30)) console.log(l);
