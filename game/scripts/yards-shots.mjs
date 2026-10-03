// Construction Yards screen captures (original-style window): boots ?autostart=1, opens the screen from the top bar,
// selects a yard with work, the design picker, the Fleet Builds / Construction Jobs tabs and the remove-ship question.
// Usage: node scripts/yards-shots.mjs <baseUrl> <outDir> [w] [h] [dpr]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const [base = 'http://localhost:5173/', outDir = 'shots/yards', w = '1920', h = '1080', dpr = '1'] = process.argv.slice(2);
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
await page.click('[data-hud="tbtnConstructionYards"]');
await page.waitForSelector('[data-ow="yards"] .ow-grid-row');
await page.waitForTimeout(2000);
await page.screenshot({ path: `${outDir}/open-${tag}.png` });
// Buy a ship at the first yard so the queue has content, twice (one may go to a slipway, one waits).
const buy = page.locator('[data-ow="yards"] .ow-glass', { hasText: 'Purchase' });
for (let i = 0; i < 3; i++) {
    if (await buy.isEnabled()) {
        await buy.click();
        await page.waitForTimeout(400);
        const box = page.locator('[data-ow="msgbox"] .ow-glass', { hasText: 'Leave on' });
        if (await box.count()) await box.click();
        await page.waitForTimeout(600);
    }
}
await page.waitForTimeout(1500);
await page.screenshot({ path: `${outDir}/bought-${tag}.png` });
// Run the clock a while so the yards start building (progress bars), then pause again.
const play = page.locator('[data-hud-ctl="playPause"]');
if (await play.count()) {
    await play.click({ force: true });
    await page.waitForTimeout(12000);
    await play.click({ force: true });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${outDir}/building-${tag}.png` });
}
// Select the first waiting ship, then ask to remove it (screenshot the question, answer No).
const waitRow = page.locator('[data-ow="yards"] .cy-page:not([hidden]) .ow-grid').nth(1).locator('.ow-grid-row').first();
if (await waitRow.count()) {
    await waitRow.click();
    await page.waitForTimeout(300);
    await page.locator('[data-ow="yards"] .ow-glass', { hasText: 'Remove Ship' }).click();
    await page.waitForSelector('[data-ow="msgbox"]', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${outDir}/remove-${tag}.png` });
    for (const label of ['No', 'OK']) {
        const b = page.locator('[data-ow="msgbox"] .ow-glass', { hasText: label });
        if (await b.count()) await b.first().click();
    }
    await page.waitForTimeout(300);
}
// A ship under construction: the construction summary.
const yardRow = page.locator('[data-ow="yards"] .cy-page:not([hidden]) .ow-grid').nth(0).locator('.ow-grid-row').first();
if (await yardRow.count()) {
    await yardRow.click();
    await page.waitForTimeout(300);
    const sum = page.locator('[data-ow="yards"] .ow-glass', { hasText: 'Show Construction Summary' });
    if (await sum.isEnabled()) {
        await sum.click();
        await page.waitForTimeout(1200);
        await page.screenshot({ path: `${outDir}/summary-${tag}.png` });
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
    }
}
// A colony row (the last rows of the list).
const rows = page.locator('[data-ow="yards"] .ow-grid').first().locator('.ow-grid-row');
const n = await rows.count();
if (n > 1) {
    await rows.nth(n - 1).click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${outDir}/colony-${tag}.png` });
    await rows.nth(0).click();
    await page.waitForTimeout(500);
}
await page.locator('[data-ow="yards"] .ow-tab').nth(1).click();
await page.waitForTimeout(1000);
await page.screenshot({ path: `${outDir}/fleets-${tag}.png` });
await page.locator('[data-ow="yards"] .ow-tab').nth(2).click();
await page.waitForTimeout(1000);
await page.screenshot({ path: `${outDir}/jobs-${tag}.png` });
console.log(logs.length ? logs.join('\n') : 'no console errors');
await browser.close();
