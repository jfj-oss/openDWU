// Ships and Bases window captures (original-style window): boots ?autostart=1, opens the screen with F11, multi-selects
// military ships, switches tabs, opens the Retrofit dialog and the Scrap question, forms a fleet with Set Fleet.
// Usage: node scripts/shipsscreen-shots.mjs <baseUrl> <outDir> [w] [h] [dpr]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const [base = 'http://localhost:5173/', outDir = 'shots/ships', w = '1920', h = '1080', dpr = '1'] = process.argv.slice(2);
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
const win = '[data-ow="ships"]';

await page.keyboard.press('F11');
await page.waitForSelector(`${win} .ow-grid-row`);
await page.waitForTimeout(1200);
await page.screenshot({ path: `${outDir}/all-${tag}.png` });

// One ship selected: the InfoPanel, the name box and the map crosshair.
const rows = page.locator(`${win} .ships-grid .ow-grid-row`);
await rows.nth(0).click();
await page.waitForTimeout(1200);
await page.screenshot({ path: `${outDir}/one-${tag}.png` });

// Military filter + Shift / Ctrl multi-select.
await page.selectOption(`${win} .ships-filter`, 'Military Ships');
await page.waitForTimeout(500);
console.log('military rows', await rows.count());
await rows.nth(0).click();
await rows.nth(2).click({ modifiers: ['Shift'] });
await rows.nth(4).click({ modifiers: ['Control'] }).catch(() => {});
await page.waitForTimeout(800);
await page.screenshot({ path: `${outDir}/military-multi-${tag}.png` });

// Tabs of a single ship.
await rows.nth(0).click();
for (const [i, name] of [[1, 'components'], [5, 'weapons'], [6, 'jobs']]) {
    await page.locator(`${win} .ships-tabs .ow-tab`).nth(i).click();
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${outDir}/tab-${name}-${tag}.png` });
}

// Retrofit dialog (pnlRetrofit).
await page.locator(`${win} .ow-glass`, { hasText: /^Retrofit$/ }).click();
await page.waitForSelector('[data-ow="retrofit"]');
await page.waitForTimeout(500);
await page.screenshot({ path: `${outDir}/retrofit-${tag}.png` });
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

// Scrap question (MessageBoxEx), answered No.
await page.locator(`${win} .ow-glass`, { hasText: /^Scrap$/ }).click();
await page.waitForSelector('[data-ow="msgbox"]');
await page.waitForTimeout(400);
await page.screenshot({ path: `${outDir}/scrap-${tag}.png` });
await page.locator('[data-ow="msgbox"] .ow-glass', { hasText: 'No' }).click();
await page.waitForTimeout(300);

// Set Fleet -> (New Fleet) through the command queue (Fleet Formation automation prompt first).
await page.selectOption(`${win} .ships-setfleet`, { label: '(New Fleet)' });
const prompt = await page.waitForSelector('.order-confirm-button', { timeout: 3000 }).catch(() => null);
if (prompt) await page.click('.order-confirm-button:has-text("Turn off automation")');
await page.waitForTimeout(1000);
await page.screenshot({ path: `${outDir}/after-fleet-${tag}.png` });

console.log(logs.length ? logs.join('\n') : 'no console errors');
await browser.close();
