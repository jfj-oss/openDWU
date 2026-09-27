// 19r "Art bundle 2" captures (render-only ?artGallery=<view> boards drawn with the layers' own generators): 4K frames
// of the damage overlay, liveries, threat markers, derived flags and herder identity. The wreck-field and league
// captures need the 19e-7 / 19k-3 state, which this branch does not have (the layer reads it by presence).
// Usage: node scripts/art-bundle-shots.mjs [base=http://localhost:5173/] [outDir=shots] [views=damage,liveries,...]
// Prints the page's [artGallery] console lines, errors and the gallery notes.
import { chromium } from 'playwright-core';
const [base = 'http://localhost:5173/', outDir = 'shots', only = ''] = process.argv.slice(2);
const views = [
    ['damage', 'damage-ships.png'],
    ['liveries', 'liveries.png'],
    ['threats', 'threat-markers.png'],
    ['flags', 'derived-flags.png'],
    ['herders', 'herder-identity.png'],
];
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
for (const [view, file] of views) {
    if (only !== '' && !only.split(',').includes(view)) continue;
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
    const logs = [];
    page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
    page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
    await page.goto(`${base}?autostart=1&artGallery=${view}`);
    await page.waitForFunction(() => window.__artGallery !== undefined && window.__artGallery.ready, null, { timeout: 240000 });
    // The board covers the map; hide the DOM HUD over it.
    await page.evaluate(() => {
        const canvas = document.querySelector('canvas');
        for (const el of document.body.children) if (!(canvas && el.contains(canvas)) && el !== canvas) el.style.display = 'none';
    });
    await page.waitForTimeout(view === 'liveries' ? 6000 : 2500);
    const notes = await page.evaluate(() => [...window.__artGallery.notes, `frames ${window.__artGallery.frames}`]);
    await page.screenshot({ path: `${outDir}/${file}` });
    for (const l of logs) if (process.env.ALL_LOGS || l.includes('artGallery') || l.startsWith('[error]') || l.startsWith('[pageerror]')) console.log(l);
    console.log(`${view}: notes ${JSON.stringify(notes)} -> saved ${outDir}/${file}`);
    await page.close();
}
await browser.close();
