// Build Order screen captures (original-style window): boots ?autostart=1, opens the screen from the top bar's
// btnBuildOrder, sets a few Order Amounts, opens a design drop-down, and tries an unaffordable order (message box).
// Usage: node scripts/buildorder-shots.mjs <baseUrl> <outDir> [w] [h] [dpr] [uiScale%]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const [base = 'http://localhost:5173/', outDir = 'shots/buildorder', w = '1920', h = '1080', dpr = '1', ui = ''] = process.argv.slice(2);
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
if (ui !== '') await page.addInitScript((v) => localStorage.setItem('dwu-ui-settings', JSON.stringify({ uiScale: v })), +ui);
await page.goto(`${base}?autostart=1`);
await page.waitForFunction(() => window.__dwu?.game?.playerEmpire !== undefined, null, { timeout: 240000 });
await page.waitForTimeout(3000);
const tag = `${w}x${h}@${dpr}${ui !== '' ? `-ui${ui}` : ''}`;
await page.click('[data-hud="btnBuildOrder"]');
await page.waitForSelector('[data-ow="buildorder"] .ow-spin');
await page.waitForTimeout(1500);
await page.screenshot({ path: `${outDir}/open-${tag}.png` });
// Order 2 escorts and 1 construction ship (enabled spinners only).
const spins = page.locator('[data-ow="buildorder"] .ow-spin-input:not([disabled])');
const n = await spins.count();
if (n > 0) {
    await spins.nth(0).fill('2');
    await spins.nth(0).press('Tab');
}
if (n > 2) {
    await spins.nth(2).fill('1');
    await spins.nth(2).press('Tab');
}
await page.waitForTimeout(400);
await page.screenshot({ path: `${outDir}/amounts-${tag}.png` });
const combo = page.locator('[data-ow="buildorder"] .ow-combo').first();
if (await combo.count()) {
    await combo.click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${outDir}/dropdown-${tag}.png` });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
}
// An unaffordable order: the "Cannot afford build order" message box.
if (n > 0) {
    await spins.nth(0).fill('1000');
    await spins.nth(0).press('Tab');
    await page.waitForTimeout(300);
    await page.locator('[data-ow="buildorder"] .ow-glass').nth(1).click();
    await page.waitForSelector('[data-ow="msgbox"]', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${outDir}/cannotafford-${tag}.png` });
}
console.log(logs.length ? logs.join('\n') : 'no console errors');
await browser.close();
