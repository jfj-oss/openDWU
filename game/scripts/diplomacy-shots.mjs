// Diplomacy screen captures (original-style window): boots ?autostart=1, meets every AI empire and pirate faction,
// opens the screen from the top bar, selects an AI empire, then opens its talk panel.
// Usage: node scripts/diplomacy-shots.mjs <baseUrl> <outDir> [w] [h] [dpr]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const [base = 'http://localhost:5173/', outDir = 'shots/diplomacy', w = '1920', h = '1080', dpr = '1'] = process.argv.slice(2);
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
await page.evaluate(() => {
    const g = window.__dwu.galaxy;
    const p = g.playerEmpire;
    let n = 0;
    for (const r of p.diplomaticRelations) {
        if (r.type === 0 && r.otherEmpire && r.otherEmpire.pirateEmpireBaseHabitat === null) {
            r.type = n === 1 ? 2 : n === 2 ? 7 : 1;
            const t = r.otherEmpire.diplomaticRelations.byEmpire(p);
            if (t) t.type = r.type;
            n++;
        }
    }
    for (const r of p.pirateRelations ?? []) if (r.type === 0) r.type = 1;
});
const t0 = Date.now();
await page.click('[data-hud="tbtnEmpires"]');
await page.waitForSelector('[data-ow="diplomacy"]');
await page.waitForTimeout(1500);
const tag = `${w}x${h}@${dpr}`;
await page.screenshot({ path: `${outDir}/player-${tag}.png` });
await page.locator('[data-ow="diplomacy"] .ow-grid-row').nth(1).click();
await page.waitForTimeout(1500);
await page.screenshot({ path: `${outDir}/empire-${tag}.png` });
const n = await page.locator('[data-ow="diplomacy"] .ow-grid-row').count();
await page.locator('[data-ow="diplomacy"] .ow-grid-row').nth(n - 1).click();
await page.waitForTimeout(1200);
await page.screenshot({ path: `${outDir}/last-${tag}.png` });
await page.locator('[data-ow="diplomacy"] .ow-grid-row').nth(1).click();
await page.waitForTimeout(500);
await page.locator('[data-ow="diplomacy"] .ow-glass', { hasText: 'Speak with' }).click();
await page.waitForTimeout(1500);
await page.screenshot({ path: `${outDir}/talk-${tag}.png` });
console.log(`rows ${n}, ${Date.now() - t0} ms`);
console.log(logs.length ? logs.join('\n') : 'no console errors');
await browser.close();
