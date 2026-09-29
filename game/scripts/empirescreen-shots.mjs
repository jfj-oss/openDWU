// Empires (diplomacy) screen and a ship's selection panel.
// Usage: node scripts/empirescreen-shots.mjs <baseUrl> <outDir>
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

// Ship selection panel: pick a military ship through the Ships and Bases list.
await page.keyboard.press('F11');
await page.waitForSelector('.ships-list-window');
await page.selectOption('.ships-list-filter', 'Military Ships');
await page.locator('.ships-list-row').nth(0).click();
await page.locator('.ships-list-row').nth(0).dblclick();
await page.waitForTimeout(500);
await page.screenshot({ path: `${outDir}/selection-panel-ship.png` });

// Meet the first AI empire (relation None) so the diplomacy screen lists it.
await page.evaluate(() => {
    const g = window.__dwu.galaxy;
    const p = g.playerEmpire;
    const ai = g.empires.find((e) => e !== p && e !== g.independentEmpire && e.pirateEmpireBaseHabitat === null && e.active);
    for (const r of p.diplomaticRelations) if (r.otherEmpire === ai && r.type === 0) r.type = 1;
});
await page.click('button[title="Empires"]');
await page.waitForSelector('.diplomacy-window');
await page.waitForTimeout(800);
await page.screenshot({ path: `${outDir}/empires-diplomacy-screen.png` });
for (const l of logs) console.log(l);
await browser.close();
