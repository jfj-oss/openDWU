// Build Queue captures (original-style window, an extension reached from the Build Order window's header): boots
// ?autostart=1, opens Build Order from the top bar, orders a few ships, lets the yards start, then opens the Build Queue.
// Usage: node scripts/buildqueue-shots.mjs <baseUrl> <outDir> [w] [h] [dpr]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const [base = 'http://localhost:5173/', outDir = 'shots/buildqueue', w = '1920', h = '1080', dpr = '1'] = process.argv.slice(2);
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
// Order ships through the Build Order screen (whichever implementation is mounted: number inputs).
await page.click('[data-hud="btnBuildOrder"]');
await page.waitForSelector('.bq-launcher');
await page.waitForTimeout(800);
await page.screenshot({ path: `${outDir}/buildorder-${tag}.png` });
const inputs = page.locator('input[type="number"]:not([disabled]), .ow-spin-input:not([disabled])');
const n = await inputs.count();
for (let i = 0; i < Math.min(n, 3); i++) {
    await inputs.nth(i).fill('1');
    await inputs.nth(i).dispatchEvent('change');
}
await page.waitForTimeout(300);
const purchase = page.locator('button', { hasText: /Purchase for/ }).first();
if (await purchase.count()) await purchase.click();
await page.waitForTimeout(500);
// Let the yards start (the autostart game runs; log the sim clock to show it advanced).
await page.evaluate(() => document.activeElement?.blur?.());
await page.keyboard.press('Space');
const t0 = await page.evaluate(() => window.__dwu?.galaxy?.nowMs ?? window.__dwu?.game?.galaxy?.nowMs ?? null);
await page.waitForTimeout(20000);
const t1 = await page.evaluate(() => window.__dwu?.galaxy?.nowMs ?? window.__dwu?.game?.galaxy?.nowMs ?? null);
console.log(`sim clock ${t0} -> ${t1}`);
await page.keyboard.press('Space');
// Re-open Build Order and follow its header launcher to the Build Queue.
if ((await page.locator('.bq-launcher').count()) === 0) await page.click('[data-hud="btnBuildOrder"]');
await page.waitForSelector('.bq-launcher');
await page.click('.bq-launcher');
await page.waitForSelector('[data-ow="buildQueue"] .ow-grid-row', { timeout: 10000 }).catch(() => {});
await page.waitForTimeout(1500);
await page.screenshot({ path: `${outDir}/queue-${tag}.png` });
const waiting = page.locator('[data-ow="buildQueue"] .ow-grid-row', { hasText: 'Waiting' }).nth(1);
if (await waiting.count()) {
    await waiting.click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${outDir}/queue-selected-${tag}.png` });
}
console.log(logs.length ? logs.join('\n') : 'no console errors');
await browser.close();
