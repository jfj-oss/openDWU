// Usage: node scripts/shot.mjs <url> <out.png> [waitMs] [w] [h] [dpr]
//   dpr = device scale factor (2 with w=1920 h=1080 captures a true 3840x2160 frame, as on a 4K screen).
// Headless screenshot of the running dev server (uses system Chromium).
import { chromium } from 'playwright-core';
const [url = 'http://localhost:5173/', out = 'shots/shot.png', wait = '2500', w = '1600', h = '900', dpr = '1'] = process.argv.slice(2);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: +dpr });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url);
await page.waitForTimeout(+wait);
await page.screenshot({ path: out });
await browser.close();
for (const l of logs) console.log(l);
console.log(`saved ${out}`);
