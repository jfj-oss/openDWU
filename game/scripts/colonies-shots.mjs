// Colonies screen captures (original-style window): boots a game, opens the screen from the top bar, then visits
// every detail tab.
// Usage: node scripts/colonies-shots.mjs <baseUrl> <outDir> [w] [h] [dpr] [newgameJson]
//   newgameJson: the ?newgame= wizard overrides (default: a Mature player empire so there are several colonies).
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const [base = 'http://localhost:5173/', outDir = 'shots/colonies', w = '1920', h = '1080', dpr = '1', ng = '{"seed":1,"empireExpansionIndex":3,"galaxyExpansionIndex":2}'] = process.argv.slice(2);
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
await page.goto(`${base}?newgame=${encodeURIComponent(ng)}`);
await page.waitForFunction(() => window.__dwu?.game?.playerEmpire !== undefined, null, { timeout: 400000 });
await page.waitForTimeout(4000);
const tag = `${w}x${h}@${dpr}`;
await page.click('[data-hud="tbtnColonies"]');
await page.waitForSelector('[data-ow="colonies"] .ow-grid-row');
await page.waitForTimeout(1500);
await page.screenshot({ path: `${outDir}/population-${tag}.png` });
const tabs = ['cargo', 'resources', 'troops', 'construction', 'docking', 'facilities'];
for (let i = 0; i < tabs.length; i++) {
    await page.locator('[data-ow="colonies"] .ow-tab').nth(i + 1).click();
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${outDir}/${tabs[i]}-${tag}.png` });
}
// Sort by population (header click twice: descending) and pick the third row.
await page.locator('[data-ow="colonies"] .col-grid .ow-grid-hcell').nth(8).click();
await page.locator('[data-ow="colonies"] .col-grid .ow-grid-hcell').nth(8).click();
await page.locator('[data-ow="colonies"] .col-grid .ow-grid-row').nth(2).click();
await page.locator('[data-ow="colonies"] .ow-tab').nth(0).click();
await page.waitForTimeout(1000);
await page.screenshot({ path: `${outDir}/sorted-${tag}.png` });
console.log(logs.length ? logs.join('\n') : 'no console errors');
await browser.close();
