// Expansion Planner captures (original-style window): boots ?autostart=1, opens the planner from the top bar, selects
// the first target, switches to the resource modes and to Your Empire Resource Locations.
// Usage: node scripts/expansion-shots.mjs <baseUrl> <outDir> [w] [h] [dpr]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const [base = 'http://localhost:5173/', outDir = 'shots/expansion', w = '1920', h = '1080', dpr = '1'] = process.argv.slice(2);
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
await page.goto(`${base}?autostart=1`);
await page.waitForFunction(() => window.__dwu?.game?.playerEmpire !== undefined, null, { timeout: 240000 });
await page.waitForTimeout(3000);
const tag = `${w}x${h}@${dpr}`;
await page.click('[data-hud="btnExpansionPlanner"]');
await page.waitForSelector('[data-ow="expansion"] .ep-targets');
await page.waitForTimeout(2000);
await page.screenshot({ path: `${outDir}/colonies-${tag}.png` });
// Show low-quality colonies (an early game often has no others).
await page.locator('[data-ow="expansion"] .ow-check', { hasText: 'low-quality' }).click();
await page.waitForTimeout(1500);
const first = page.locator('[data-ow="expansion"] .ep-targets .ow-grid-row').first();
if (await first.count()) {
    await first.click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${outDir}/colonies-selected-${tag}.png` });
}
const mode = page.locator('[data-ow="expansion"] .ep-mode');
for (const m of ['resourcesyou', 'resourcesgalaxy', 'resourcessupply']) {
    await mode.selectOption(m);
    await page.waitForTimeout(1500);
    const r = page.locator('[data-ow="expansion"] .ep-targets .ow-grid-row').first();
    if (await r.count()) await r.click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${outDir}/${m}-${tag}.png` });
}
await mode.selectOption('colonies');
await page.waitForTimeout(500);
console.log(logs.length ? logs.join('\n') : 'no console errors');
await browser.close();
