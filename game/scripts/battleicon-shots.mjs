// Galaxy-view "fighting here" crossed-swords marker (render/battleIcons.ts): forces combat activity on a player ship in
// the home system (a fresh shield strike each frame, game paused) and captures the galaxy view at two zooms, each with a
// close-up crop of the marker.
// Usage: node scripts/battleicon-shots.mjs <url> <outDir> [prefix] [dpr]   (dpr 3 = magnified close-ups)
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const [url = 'http://localhost:5173/?autostart=1', out = 'shots/battleicon', prefix = '', dpr = '1'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: +dpr });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error') logs.push(`[error] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.stack ?? e.message}`));
const shots = [];
try {
    await page.goto(url);
    await page.waitForFunction(() => !!window.__dwu?.game && !!window.__dwu?.view, null, { timeout: 400000 });
    await page.evaluate(() => { window.__dwu.time.paused = true; });
    await page.waitForTimeout(3000);
    const ok = await page.evaluate(() => {
        const g = window.__dwu.game.galaxy; const p = g.playerEmpire; const c = p.capital ?? p.colonies[0];
        const bo = g.builtObjects.find((b) => b && !b.hasBeenDestroyed && b.empire === p && b.nearestSystemStar !== null && b.nearestSystemStar.systemIndex === c.systemIndex);
        if (!bo) return false;
        const tick = () => { bo.lastShieldStrike = g.nowMs; requestAnimationFrame(tick); };
        tick();
        const star = bo.nearestSystemStar; window.__biStar = { x: star.xpos, y: star.ypos };
        return true;
    });
    console.log('forced combat on a home-system ship:', ok);
    for (const f of [2500, 5000]) {
        const at = await page.evaluate((f) => {
            const cam = window.__dwu.camera; const s = window.__biStar;
            cam.zoom = cam.clampZoom(1 / f); cam.centerOn(s.x, s.y);
            return { ...cam.worldToScreen(s.x, s.y), f: Math.round(1 / cam.zoom) };
        }, f);
        console.log(`f=${at.f}: star at ${Math.round(at.x)},${Math.round(at.y)}`);
        await page.waitForTimeout(2000);
        const p = `${out}/${prefix}galaxy-f${f}.png`;
        await page.screenshot({ path: p }); shots.push(p);
        const c = `${out}/${prefix}galaxy-f${f}-crop.png`;
        await page.screenshot({ path: c, clip: { x: Math.max(0, Math.round(at.x) - 50), y: Math.max(0, Math.round(at.y) - 50), width: 120, height: 120 } }); shots.push(c);
    }
} finally {
    await browser.close();
}
console.log(logs.length ? logs.join('\n') : 'no console errors');
console.log(shots.join('\n'));
