// Galaxy-zoom captures for the overlay fixes: gas clouds with Faction markers off, civilian fade at galaxy zoom, station presence with territory on.
// Usage: node scripts/overlayfixes-shots.mjs <baseUrl> <outDir> [tag]      (GPU Chromium: ANGLE/Vulkan, never SwiftShader)
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const [base = 'http://localhost:5173/', outDir = 'shots/overlayfixes', tag = 'after'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
    args: ['--use-gl=angle', '--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu'],
});
const cases = {
    'factionoff': 'overlays=-factionMarkers,-stationPresence',
    'faction-on': 'overlays=factionMarkers',
    'fade-off': 'overlays=factionMarkers,-stationPresence&zoom=150',
    'fade-on': 'overlays=factionMarkers,-stationPresence,fadeCivilianShips&zoom=150',
    'presence-territory': 'overlays=-factionMarkers,stationPresence,territory',
};
for (const [name, q] of Object.entries(cases)) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    page.on('console', (m) => { if (m.type() === 'error') console.log(`  [${name} error] ${m.text()}`); });
    page.on('pageerror', (e) => console.log(`  [${name} pageerror] ${e.message}`));
    await page.goto(`${base}?autostart=1&simWorker=0&${q}`);
    await page.waitForFunction(() => window.__dwu?.game?.playerEmpire !== undefined, null, { timeout: 240000 });
    await page.waitForTimeout(6000);
    const out = `${outDir}/${tag}-${name}.png`;
    await page.screenshot({ path: out });
    console.log('saved', out);
    await page.close();
}
await browser.close();
