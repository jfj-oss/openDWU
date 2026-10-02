// Fleets window "Fleet Designs" tab: create a design, add rows, then Build Fleet.
// Usage: node scripts/fleetdesigns-shots.mjs <baseUrl> <outDir>
import { chromium } from 'playwright-core';
const [base = 'http://localhost:5173/', outDir = 'shots'] = process.argv.slice(2);
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`${base}?autostart=1`);
await page.waitForFunction(() => window.__dwu?.game?.playerEmpire !== undefined, null, { timeout: 120000 });
await page.waitForTimeout(3000);

await page.keyboard.press('F12');
await page.waitForSelector('.fleets-list-window');
await page.click('.fleets-list-tab:has-text("Fleet Designs")');
await page.click('.fleets-detail-button:has-text("New Fleet Design")');
await page.waitForSelector('.fleet-designs-row');
await page.click('.fleets-detail-button:has-text("Add Design")');
await page.waitForTimeout(300);
await page.click('.fleets-detail-button:has-text("Add Design")');
await page.waitForTimeout(300);
await page.click('.fleet-designs-count .fleets-detail-button:has-text("+")');
await page.waitForTimeout(300);
await page.screenshot({ path: `${outDir}/fleetdesigns-template.png` });
await page.click('.fleets-detail-button:has-text("Build Fleet")');
const prompt = await page.waitForSelector('.order-confirm-button', { timeout: 2000 }).catch(() => null);
if (prompt !== null) await page.click('.order-confirm-button:has-text("Turn off automation")');
await page.waitForTimeout(1500);
await page.screenshot({ path: `${outDir}/fleetdesigns-build.png` });
console.log('report:', await page.locator('.fleet-designs-report').textContent().catch(() => null));
console.log('orders:', await page.locator('.fleet-designs-orders').textContent().catch(() => null));
for (const l of logs) if (!l.startsWith('[log]') && !l.startsWith('[debug]') && !l.startsWith('[info]')) console.log(l);
await browser.close();
