// Left sidebar captures: boots ?autostart=1, lets the sim run, then opens each category panel of the Empire
// Navigation Tool and saves the left part of the screen (plus one full frame).
// Usage: node scripts/leftsidebar-shots.mjs <baseUrl> <outDir> [w] [h] [dpr]
//   PANELS=colonies,constructionShips  limits the panels captured.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const [base = 'http://localhost:5173/', outDir = 'shots/leftsidebar', w = '1920', h = '1080', dpr = '1'] = process.argv.slice(2);
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
await page.addInitScript(() => {
    try {
        localStorage.removeItem('dwu.itemList.open');
        if (localStorage.getItem('dwu.itemList.size') === null) localStorage.setItem('dwu.itemList.size', '1');
    } catch {}
});
await page.goto(`${base}?autostart=1${process.env.QUERY ?? ''}`);
await page.waitForFunction(() => window.__dwu?.game?.playerEmpire !== undefined, null, { timeout: 240000 });
await page.waitForTimeout(4000);
await page.evaluate(() => {
    const { time } = window.__dwu;
    if (time) time.paused = false;
});
await page.waitForTimeout(+(process.env.RUN_MS ?? 8000));
await page.evaluate(() => {
    const { time } = window.__dwu;
    if (time) time.paused = true;
});
await page.screenshot({ path: `${outDir}/full-closed.png` });
const ids = await page.$$eval('.ls-button', (bs) => bs.map((b) => b.dataset.panel));
const want = process.env.PANELS ? process.env.PANELS.split(',') : ids;
const clip = { x: 0, y: 0, width: Math.min(+w, Math.round(+h * 0.62)), height: +h };
for (const id of want) {
    await page.click(`.ls-button[data-panel="${id}"]`);
    await page.waitForTimeout(1200);
    await page.mouse.move(+w / 2, +h / 2);
    await page.screenshot({ path: `${outDir}/${id}.png`, clip });
    const n = await page.$$eval('.ls-row', (r) => r.length);
    const title = await page.$eval('.ls-title-text', (t) => t.textContent).catch(() => '');
    console.log(`${id}: "${title}" rows=${n}`);
}
// Hover the first row of the last panel to show the hover state, then a full frame with a panel open.
if (want.includes('constructionShips')) {
    await page.click('.ls-button[data-panel="constructionShips"]');
    await page.waitForTimeout(800);
}
const row = await page.$('.ls-row');
if (row) {
    const b = await row.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.waitForTimeout(700);
}
await page.screenshot({ path: `${outDir}/full-open.png` });
await browser.close();
for (const l of logs.slice(0, 40)) console.log(l);
console.log(`saved to ${outDir}`);
