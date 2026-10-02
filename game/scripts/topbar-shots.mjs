// Top HUD captures: boots ?autostart=1, lets the sim run so the ticker, money and research readouts fill, then saves
// the full frame and a crop of the top strip. Usage: node scripts/topbar-shots.mjs <baseUrl> <outDir> [w] [h] [dpr]
// Env: RUN_MS (sim run before the capture, default 8000), HOVER=<data-hud name> (hover that control first),
// MORE=1 (open the top-bar overflow menu), ZOOM=system (zoom onto the capital so the system name shows).
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const [base = 'http://localhost:5173/', outDir = 'shots/topbar', w = '1920', h = '1080', dpr = '1'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: +dpr });
const logs = [];
page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`${base}?autostart=1${process.env.QUERY ?? ''}`);
await page.waitForFunction(() => window.__dwu?.game?.playerEmpire !== undefined, null, { timeout: 240000 });
await page.waitForTimeout(3000);
await page.evaluate(() => {
    const { time } = window.__dwu;
    if (time) {
        time.paused = false;
        time.speed = 4;
    }
});
await page.waitForTimeout(+(process.env.RUN_MS ?? 8000));
await page.evaluate(async (zoom) => {
    const { time, galaxy, camera } = window.__dwu;
    const hud = await import('/src/ui/hud.ts');
    // A few ticker lines (one with a go-to) so the box shows several rows.
    const cap = galaxy.playerEmpire.capital;
    hud.pushHudMessage('Our explorers have discovered the ruins of an ancient civilization');
    hud.pushHudMessage(`New colony founded at ${cap?.name ?? 'Home'}`, '', () => true);
    hud.pushHudMessage('Research completed: Ion Cannon');
    if (zoom === 'system' && cap) {
        camera.centerOn(cap.xpos, cap.ypos);
        camera.zoomAt(hud.SYSTEM_LEVEL_ZOOM, camera.width / 2, camera.height / 2);
    }
    if (time) time.paused = false;
}, process.env.ZOOM ?? '');
await page.waitForTimeout(1500);
if (process.env.HOVER) await page.hover(`[data-hud="${process.env.HOVER}"]`);
if (process.env.MORE) await page.click('[data-hud="btnTopMore"]');
await page.waitForTimeout(400);
const tag = `${w}x${h}@${dpr}${process.env.TAG ?? ''}`;
await page.screenshot({ path: `${outDir}/full-${tag}.png` });
await page.screenshot({ path: `${outDir}/top-${tag}.png`, clip: { x: 0, y: 0, width: +w, height: Math.round(+h * 0.3) } });
const info = await page.evaluate(() => {
    const out = {};
    for (const el of document.querySelectorAll('#hud [data-hud]')) {
        const r = el.getBoundingClientRect();
        out[el.dataset.hud] = [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
    }
    return out;
});
console.log(JSON.stringify(info));
console.log(logs.length ? logs.join('\n') : 'no console errors');
await browser.close();
