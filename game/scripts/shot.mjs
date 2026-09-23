// Usage: node scripts/shot.mjs <url> <out.png> [waitMs] [w] [h]
// Headless screenshot of the running dev server (uses system Chromium).
import { chromium } from 'playwright-core';
const [url = 'http://localhost:5173/', out = 'shots/shot.png', wait = '2500', w = '1600', h = '900'] = process.argv.slice(2);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url);
await page.waitForTimeout(+wait);
await page.screenshot({ path: out });
await browser.close();
for (const l of logs) console.log(l);
console.log(`saved ${out}`);
