// Characters screen captures (original-style window): boots ?autostart=1, opens the screen from the top bar, selects
// an intelligence agent (mission panel), filters by a role, opens the event history.
// Usage: node scripts/characters-shots.mjs <baseUrl> <outDir> [w] [h] [dpr]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const [base = 'http://localhost:5173/', outDir = 'shots/characters', w = '1920', h = '1080', dpr = '1'] = process.argv.slice(2);
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
const W = '[data-ow="characters"]';
await page.click('[data-hud="tbtnIntelligenceAgents"]');
await page.waitForSelector(`${W} .ow-grid-row`);
await page.waitForTimeout(1500);
await page.screenshot({ path: `${outDir}/list-${tag}.png` });
// Filter by intelligence agents (last role toggle) and select the first one: the mission panel.
await page.locator(`${W} .ch-role-btn`).last().click();
await page.waitForTimeout(500);
const row = page.locator(`${W} .ow-grid-row`).first();
if (await row.count()) await row.click();
await page.waitForTimeout(800);
await page.screenshot({ path: `${outDir}/agent-${tag}.png` });
// Mission type: Steal Galaxy Map (index 5) to show the estimate.
await page.locator(`${W} .ch-mission select`).nth(1).selectOption('5').catch(() => {});
await page.waitForTimeout(500);
await page.screenshot({ path: `${outDir}/mission-${tag}.png` });
// Back to all, select the leader (first role) and show the event history.
await page.locator(`${W} .ch-role-btn`).last().click();
await page.locator(`${W} .ch-role-btn`).nth(0).click();
await page.waitForTimeout(400);
const r2 = page.locator(`${W} .ow-grid-row`).first();
if (await r2.count()) await r2.click();
await page.waitForTimeout(600);
await page.screenshot({ path: `${outDir}/governor-${tag}.png` });
await page.locator(`${W} .ow-glass`, { hasText: 'Show Event History' }).click();
await page.waitForTimeout(800);
await page.screenshot({ path: `${outDir}/history-${tag}.png` });
console.log(logs.length ? logs.join('\n') : 'no console errors');
await browser.close();
