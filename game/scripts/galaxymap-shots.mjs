// Galaxy Map window captures (in-thread and ?simWorker=1): default view, a filtered view (match list column) and the Map Key.
// Usage: node scripts/galaxymap-shots.mjs <baseUrl> <outDir> [w] [h]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const [base = 'http://localhost:5173/', outDir = 'shots/galaxymap', w = '1920', h = '1080'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const logs = [];
const saved = [];
for (const mode of ['thread', 'worker']) {
    const page = await browser.newPage({ viewport: { width: +w, height: +h } });
    page.on('console', (m) => {
        if (m.type() === 'error') logs.push(`[${mode}] [error] ${m.text()}`);
    });
    page.on('pageerror', (e) => logs.push(`[${mode}] [pageerror] ${e.message}`));
    await page.goto(`${base}?autostart=1&simWorker=${mode === 'worker' ? 1 : 0}`);
    await page.waitForFunction(() => window.__dwu?.galaxyMap !== undefined, null, { timeout: 240000 });
    await page.waitForTimeout(4000);
    const shot = async (name) => {
        const p = `${outDir}/${mode}-${name}-${w}x${h}.png`;
        await page.screenshot({ path: p });
        saved.push(p);
        console.log('saved', p);
    };
    await page.evaluate(() => window.__dwu.galaxyMap.open());
    await page.waitForTimeout(2500);
    await shot('open');
    // Select a system near the middle of the galaxy, then show the filtered view.
    await page.evaluate(() => {
        const g = window.__dwu.galaxyMap;
        const c = window.__dwu.game?.galaxy;
        g.selectAt(c ? c.sizeX / 2 : 0, c ? c.sizeY / 2 : 0);
    });
    await page.evaluate(() => window.__dwu.galaxyMap.setViewMode(1));
    await page.waitForTimeout(1500);
    await shot('ourSystems');
    await page.evaluate(() => window.__dwu.galaxyMap.setViewMode(0));
    await page.waitForTimeout(500);
    const keyBtn = page.locator('.gmap-overlay .ow-glass', { hasText: 'Map Key' }).first();
    if (await keyBtn.count()) {
        await keyBtn.click();
        await page.waitForTimeout(700);
        await shot('key');
    }
    await page.evaluate(() => window.__dwu.galaxyMap.close());
    await page.close();
}
await browser.close();
console.log(logs.length ? logs.join('\n') : 'no console errors');
console.log(saved.join('\n'));
