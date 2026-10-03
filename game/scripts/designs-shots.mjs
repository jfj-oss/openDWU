// Designs screen captures (original-style window): boots ?autostart=1, opens the Designs window from the top bar,
// shows all designs, then opens the Design Editor on the first design (Copy As New) and its picture chooser.
// Usage: node scripts/designs-shots.mjs <baseUrl> <outDir> [w] [h] [dpr]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const [base = 'http://localhost:5173/', outDir = 'shots/designs', w = '1920', h = '1080', dpr = '1'] = process.argv.slice(2);
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
// The player does not automate design here (no automation question in the way).
await page.evaluate(() => { window.__dwu.galaxy.playerEmpire.controlDesigns = false; });
const tag = `${w}x${h}@${dpr}`;
await page.click('[data-hud="tbtnDesigns"]');
await page.waitForSelector('[data-ow="designs"]');
await page.waitForTimeout(1500);
await page.screenshot({ path: `${outDir}/list-${tag}.png` });
await page.locator('[data-ow="designs"] select').first().selectOption('4');
await page.waitForTimeout(500);
await page.locator('[data-ow="designs"] .ow-grid-row').nth(2).click();
await page.locator('[data-ow="designs"] .ow-grid-row').nth(4).click({ modifiers: ['Control'] });
await page.waitForTimeout(600);
await page.screenshot({ path: `${outDir}/all-${tag}.png` });
await page.locator('[data-ow="designs"] .ow-grid-row').nth(0).click();
await page.locator('[data-ow="designs"] .ow-glass', { hasText: 'Copy As New' }).click();
await page.waitForSelector('[data-ow="design-editor"]');
await page.waitForTimeout(1500);
await page.locator('[data-ow="design-editor"] .ow-grid').first().locator('.ow-grid-row').nth(3).click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${outDir}/editor-${tag}.png` });
await page.locator('[data-ow="design-editor"] .dsgx-picture').click();
await page.waitForTimeout(1500);
await page.screenshot({ path: `${outDir}/picture-${tag}.png` });
console.log(logs.length ? logs.join('\n') : 'no console errors');
await browser.close();
