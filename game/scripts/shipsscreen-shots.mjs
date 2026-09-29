// Ships and Bases window (role filter + multi-select + Set Fleet) and the Fleets window detail panel.
// Usage: node scripts/shipsscreen-shots.mjs <baseUrl> <outDir>
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

await page.keyboard.press('F11');
await page.waitForSelector('.ships-list-window');
await page.selectOption('.ships-list-filter', 'Military Ships');
const rows = page.locator('.ships-list-row');
console.log('military rows', await rows.count());
await rows.nth(0).click();
await rows.nth(2).click({ modifiers: ['Shift'] });
await rows.nth(4).click({ modifiers: ['Control'] });
await page.waitForTimeout(300);
await page.screenshot({ path: `${outDir}/shipsscreen-filter-multiselect.png` });

// Form a fleet from the selection (Set Fleet -> (New Fleet)), through the command queue.
await page.selectOption('.ships-list-setfleet', 'new');
// Fleet Formation is automated for the player: the original asks first (GenerateAutomationMessageBox).
await page.waitForSelector('.order-confirm-button');
await page.screenshot({ path: `${outDir}/shipsscreen-fleet-formation-prompt.png` });
await page.click('.order-confirm-button:has-text("Turn off automation")');
await page.waitForTimeout(800);
await page.screenshot({ path: `${outDir}/shipsscreen-after-form-fleet.png` });

// View Fleet -> the Fleets window with the fleet's settings.
await page.click('.ships-list-button:has-text("View Fleet")');
await page.waitForSelector('.fleets-detail-button');
await page.waitForTimeout(300);
await page.click('.fleets-detail-button:has-text("Posture")');
await page.waitForTimeout(600);
await page.screenshot({ path: `${outDir}/fleet-panel.png` });
for (const l of logs) console.log(l);
await browser.close();
