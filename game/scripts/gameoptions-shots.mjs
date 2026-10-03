// Game Options captures (original-style windows): boots ?autostart=1, opens Options with O, then each sub-window
// (Empire Settings, Message Settings, Advanced Display Settings), and the Escape menu's Options entry.
// Usage: node scripts/gameoptions-shots.mjs <baseUrl> <outDir> [w] [h] [dpr]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const [base = 'http://localhost:5173/', outDir = 'shots/gameoptions', w = '1920', h = '1080', dpr = '1'] = process.argv.slice(2);
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
await page.goto(`${base}?autostart=1`);
await page.waitForFunction(() => window.__dwu?.game?.playerEmpire !== undefined, null, { timeout: 240000 });
await page.waitForTimeout(3000);
const tag = `${w}x${h}@${dpr}`;
const shot = async (name) => {
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${outDir}/${name}-${tag}.png` });
};
const closeTop = async () => {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
};
try {
await page.mouse.move(+w / 2, +h / 2);
// Zoom Speed 12 (default): one wheel notch out multiplies the zoom factor by 1.12 (Main.Part13.cs OnMouseWheel).
const z0 = await page.evaluate(() => window.__dwu.camera.zoom);
await page.mouse.wheel(0, 100);
await page.waitForTimeout(300);
const z1 = await page.evaluate(() => window.__dwu.camera.zoom);
console.log(`wheel notch out: zoom ${z0.toPrecision(5)} -> ${z1.toPrecision(5)} (ratio ${(z0 / z1).toFixed(4)}, expected 1.1200)`);
await page.mouse.wheel(0, -100);
await page.waitForTimeout(300);
await page.keyboard.press('o');
await page.waitForSelector('[data-ow="gameoptions"]');
await shot('options');
await page.locator('[data-ow="gameoptions"] button', { hasText: 'Empire Settings' }).click();
await page.waitForSelector('[data-ow="gameoptions-empire"]');
await shot('empire');
await closeTop();
await page.locator('[data-ow="gameoptions"] button', { hasText: 'Show Message Settings' }).click();
await page.waitForSelector('[data-ow="gameoptions-messages"]');
await shot('messages');
await closeTop();
await page.locator('[data-ow="gameoptions"] button', { hasText: 'Advanced Settings' }).click();
await page.waitForSelector('[data-ow="gameoptions-advanced"]');
await shot('advanced');
// Maximum Framerate: untick Unlimited -> the ticker caps at the spinner's 50 fps.
await page.locator('[data-ow="gameoptions-advanced"] label', { hasText: 'Unlimited' }).click();
await page.waitForTimeout(200);
console.log(`ticker maxFPS after unticking Unlimited: ${await page.evaluate(() => window.__dwu.app.ticker.maxFPS)}`);
await page.locator('[data-ow="gameoptions-advanced"] label', { hasText: 'Unlimited' }).click();
await page.waitForTimeout(200);
console.log(`ticker maxFPS after ticking it again: ${await page.evaluate(() => window.__dwu.app.ticker.maxFPS)}`);
await closeTop();
// Automation mode preset: Expert (none) sets every control to manual.
await page.locator('[data-ow="gameoptions"] select[data-go="mode"]').selectOption('2');
await shot('options-expert');
await page.locator('[data-ow="gameoptions"] select[data-go="mode"]').selectOption('1');
await closeTop();
// Escape menu → Options.
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
await page.locator('.game-menu-btn', { hasText: 'Options' }).click();
await page.waitForSelector('[data-ow="gameoptions"]');
await shot('from-game-menu');
} catch (e) {
    console.log(logs.join('\n'));
    await page.screenshot({ path: `${outDir}/failure-${tag}.png` });
    throw e;
}
console.log(logs.length ? logs.join('\n') : 'no console errors');
await browser.close();
