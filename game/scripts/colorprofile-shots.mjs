// Before/after screenshots for the raw-colour art decode (scripts/colorprofile-verify.mjs checks the pixels).
// Usage: node scripts/colorprofile-shots.mjs <baseUrl> <outDir> <tag>
// Saves <outDir>/cp-<tag>-<name>.png at 1920x1080, dpr 1, seed-1 autostart galaxy, sim paused:
//   galaxy / sector / system / planet — Main View centred on the player's capital (system = F 50 as
//   scripts/perf-render.mjs; galaxy and sector show the grey-profile nebulae and map stars),
//   empires / designs — the Empires (F5) and Ship Designs (F8) screens,
//   mainmenu / galactopedia — ?screen= boots.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const [base = 'http://localhost:5173/', outDir = 'shots', tag = 'now'] = process.argv.slice(2);
const b = base.replace(/\/$/, '');
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => {
    if (m.type() === 'error') logs.push(`[console.error] ${m.text()}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const saved = [];
const shot = async (name) => {
    const path = `${outDir}/cp-${tag}-${name}.png`;
    await page.screenshot({ path });
    saved.push(path);
};

await page.goto(`${b}/?autostart=1`);
await page.waitForFunction(() => !!window.__dwu?.game && !!window.__dwu?.time && window.__dwu.view?.deepStarfield?.ready === true, null, { timeout: 180000 });
await page.evaluate(() => {
    window.__dwu.time.paused = true;
});
await page.waitForTimeout(2000);
for (const [name, F] of [['galaxy', null], ['sector', 3000], ['system', 50], ['planet', 1]]) {
    await page.evaluate((F) => {
        const d = window.__dwu;
        const cam = d.camera;
        const g = d.game.galaxy;
        const cap = d.game.playerEmpire?.capital ?? null;
        const star = cap !== null ? g.systems[cap.systemIndex]?.systemStar ?? cap : null;
        if (F === null || star === null) {
            cam.centerOn(g.sizeX / 2, g.sizeY / 2);
            cam.zoom = cam.minZoom;
        } else {
            cam.centerOn(star.xpos, star.ypos);
            cam.zoom = cam.clampZoom(1 / F);
        }
    }, F);
    await page.waitForTimeout(2500);
    await shot(name);
}
for (const [name, key] of [['empires', 'F5'], ['designs', 'F8']]) {
    const before = await page.evaluate(() => document.querySelectorAll('body *').length);
    await page.keyboard.press(key);
    await page.waitForTimeout(1500);
    const after = await page.evaluate(() => document.querySelectorAll('body *').length);
    if (after <= before) logs.push(`[shots] ${key}: no screen opened`);
    await shot(name);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
}
for (const screen of ['mainmenu', 'galactopedia']) {
    await page.goto(screen === 'mainmenu' ? `${b}/` : `${b}/?screen=${screen}`);
    await page.waitForTimeout(3500);
    await shot(screen);
}
await browser.close();
for (const l of logs) console.log(l);
for (const p of saved) console.log(`saved ${p}`);
