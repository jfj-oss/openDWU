// Galactopedia + Tutorials picker captures (main menu): Usage: node scripts/galactopedia-shots.mjs <baseUrl> <outDir> <tag>
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const [base = 'http://localhost:5173/', outDir = 'shots/galactopedia', tag = 'after'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('console', (m) => (m.type() === 'error' ? console.log(`[error] ${m.text()}`) : undefined));
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
await page.goto(base);
await page.waitForSelector('.main-menu-item[data-id="tutorials"]', { timeout: 120000 });
await page.waitForTimeout(1500);
await page.click('.main-menu-item[data-id="tutorials"]');
await page.waitForTimeout(1200);
await page.screenshot({ path: `${outDir}/tutorials-${tag}.png` });
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await page.click('.main-menu-galactopedia');
await page.waitForSelector('#galactopedia .gp-cat', { timeout: 60000 });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${outDir}/galactopedia-home-${tag}.png` });
await page.locator('#galactopedia .gp-cat', { hasText: 'Races' }).first().click();
await page.waitForTimeout(500);
await page.locator('#galactopedia .gp-topic').first().click();
await page.waitForTimeout(1500);
await page.screenshot({ path: `${outDir}/galactopedia-topic-${tag}.png` });
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
console.log('open after close:', await page.locator('#galactopedia').count());
await browser.close();
