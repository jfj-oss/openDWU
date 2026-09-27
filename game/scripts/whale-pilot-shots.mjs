// Art pilot captures (render-only ?whalePilot=1 prototype): 4K frames of the void whales next to an original Kaltor.
// Usage: node scripts/whale-pilot-shots.mjs [base=http://localhost:5173/] [outDir=shots]
// Prints the page's [whalePilot] console lines (palette / contrast stats, framing) and each creature's drawn length.
import { chromium } from 'playwright-core';
const [base = 'http://localhost:5173/', outDir = 'shots'] = process.argv.slice(2);
const views = [
    ['system', 'whale-pilot-system.png'],
    ['closeA', 'whale-pilot-close.png'],
    ['closeB', 'whale-pilot-close-b.png'],
    ['sector', 'whale-pilot-sector.png'],
    ['systemWide', 'whale-pilot-system-wide.png'],
    ['galaxy', 'whale-pilot-galaxy.png'],
];
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
let printedStats = false;
for (const [view, file] of views) {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
    const logs = [];
    page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
    page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
    await page.goto(`${base}?autostart=1&whalePilot=1&whaleView=${view}`);
    await page.waitForFunction(() => window.__whalePilot?.layer?.ready === true, null, { timeout: 180000 });
    await page.waitForTimeout(4000);
    const drawn = await page.evaluate(() => window.__whalePilot.layer.drawnLengths());
    await page.screenshot({ path: `${outDir}/${file}` });
    for (const l of logs) {
        if (l.includes('[whalePilot] stats') && printedStats) continue;
        if (l.includes('whalePilot') || l.startsWith('[error]') || l.startsWith('[pageerror]')) console.log(l);
    }
    printedStats = true;
    console.log(`${view}: drawn length css px ${JSON.stringify(drawn)} (x2 device px) -> saved ${outDir}/${file}`);
    await page.close();
}
await browser.close();
