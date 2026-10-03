// Troops screen captures (original-style window): boots ?autostart=1, opens the screen from the top bar, selects a
// troop (detail + mini-map crosshair), filters by the first colony (recruit options) and multi-selects.
// Usage: node scripts/troops-shots.mjs <baseUrl> <outDir> [w] [h] [dpr]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const [base = 'http://localhost:5173/', outDir = 'shots/troops', w = '1920', h = '1080', dpr = '1'] = process.argv.slice(2);
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
await page.click('[data-hud="tbtnTroops"]');
await page.waitForSelector('[data-ow="troops"] .ow-grid-row');
await page.waitForTimeout(1500);
await page.screenshot({ path: `${outDir}/all-${tag}.png` });
await page.locator('[data-ow="troops"] .ow-grid-row').first().click();
await page.waitForTimeout(800);
await page.screenshot({ path: `${outDir}/selected-${tag}.png` });
// Filter by the first colony.
const sel = page.locator('[data-ow="troops"] select');
const colonyValue = await sel.evaluate((s) => [...s.options].map((o) => o.value).find((v) => v.startsWith('colony:')) ?? '');
if (colonyValue) {
    await sel.selectOption(colonyValue);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${outDir}/colony-${tag}.png` });
    const rows = page.locator('[data-ow="troops"] .ow-grid-row');
    if ((await rows.count()) >= 2) {
        await rows.nth(0).click();
        await rows.nth(1).click({ modifiers: ['Control'] });
        await page.waitForTimeout(600);
        await page.screenshot({ path: `${outDir}/multi-${tag}.png` });
    }
}
console.log(logs.length ? logs.join('\n') : 'no console errors');
await browser.close();
