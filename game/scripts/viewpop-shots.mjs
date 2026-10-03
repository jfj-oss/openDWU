// Bottom-right "View" popup captures: closed, then opened.
// Usage: node scripts/viewpop-shots.mjs <baseUrl> <outDir> [w] [h]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const [base = 'http://localhost:5173/', outDir = 'shots/viewpop', w = '1920', h = '1080'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
await page.goto(`${base}?autostart=1`);
await page.waitForFunction(() => window.__dwu?.game?.playerEmpire !== undefined, null, { timeout: 240000 });
await page.waitForTimeout(4000);
await page.screenshot({ path: `${outDir}/closed.png` });
await page.click('.hud-options-toggle');
await page.waitForTimeout(500);
await page.screenshot({ path: `${outDir}/open.png` });
await page.mouse.click(+w / 2, +h / 2);
await page.waitForTimeout(500);
console.log('open after outside click:', await page.$eval('.hud-options-pop', (e) => e.classList.contains('open')));
await browser.close();
