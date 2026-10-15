// 19g-7b new fauna captures (render-only ?faunaGallery=1 stand-ins drawn by the creature layer): 4K frames of the eight
// variants at 100 % zoom, a tamed whale + hunters with harness and work lights (close, and at zoom factor 3), and the
// lantern shoal.
// Usage: node scripts/fauna-shots.mjs [base=http://localhost:5173/] [outDir=shots] [views=comma list, e.g. leviathan,leviathanMid]
// Prints the page's [faunaGallery] / [newFauna] console lines, errors, and each drawn view (look, harness, px).
import { chromium } from 'playwright-core';
const [base = 'http://localhost:5173/', outDir = 'shots', only = ''] = process.argv.slice(2);
const allViews = [
    ['gallery', 'fauna-gallery.png'],
    ['tamed', 'fauna-tamed.png'],
    ['tamedMid', 'fauna-tamed-mid.png'],
    ['shoal', 'fauna-shoal.png'],
    // Void Whale threat (the Leviathan): unhurt / wounded / healed / mid-swallow / jumping, close, mid and far.
    ['leviathan', 'leviathan-close.png'],
    ['leviathanMid', 'leviathan-mid.png'],
    ['leviathanFar', 'leviathan-far.png'],
    ['leviathanGalaxy', 'leviathan-galaxy.png'],
];
const views = only === '' ? allViews.filter(([v]) => !v.startsWith('leviathan')) : allViews.filter(([v]) => only.split(',').includes(v));
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
    args: ['--use-gl=angle', '--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu'],
});
for (const [view, file] of views) {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
    const logs = [];
    page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
    page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
    await page.goto(`${base}?autostart=1&faunaGallery=1&faunaView=${view}`);
    await page.waitForFunction(
        (need) => {
            const g = window.__faunaGallery;
            return g !== undefined && g.gallery.ready && g.layer.faunaDebug().length >= Math.min(need, g.gallery.count());
        },
        view.startsWith('leviathan') ? 4 : 99, // the close Leviathan view cuts off the outer whales
        { timeout: 240000 },
    );
    await page.waitForTimeout(4000);
    const drawn = await page.evaluate(() => window.__faunaGallery.layer.faunaDebug());
    await page.screenshot({ path: `${outDir}/${file}` });
    for (const l of logs) if (l.includes('faunaGallery') || l.includes('newFauna') || l.startsWith('[error]') || l.startsWith('[pageerror]')) console.log(l);
    console.log(`${view}: ${JSON.stringify(drawn.map((d) => [d.look, d.harness, d.px]))} -> saved ${outDir}/${file}`);
    await page.close();
}
await browser.close();
