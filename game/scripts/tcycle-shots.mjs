// T key cycle captures: all → no map → none → all.
// Usage: node scripts/tcycle-shots.mjs <baseUrl> <outDir>
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const [base = 'http://localhost:5173/', outDir = 'shots/tcycle'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
await page.goto(`${base}?autostart=1`);
await page.waitForFunction(() => window.__dwu?.game?.playerEmpire !== undefined, null, { timeout: 240000 });
await page.waitForTimeout(3000);
await page.mouse.click(960, 540);
for (const step of ['1-all', '2-nomap', '3-none', '4-all']) {
    await page.screenshot({ path: `${outDir}/${step}.png` });
    console.log(step, await page.evaluate(() => document.body.dataset.panels ?? 'all'));
    await page.keyboard.press('t');
    await page.waitForTimeout(400);
}
await browser.close();
