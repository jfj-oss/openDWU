// Empire Summary screen captures (original-style window): boots ?autostart=1, lets the game run a little, opens the
// screen from the top bar's flag button, picks another government in the combo (the preview column).
// Usage: node scripts/summary-shots.mjs <baseUrl> <outDir> [w] [h] [dpr] [uiScale%]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const [base = 'http://localhost:5173/', outDir = 'shots/summary', w = '1920', h = '1080', dpr = '1', ui = ''] = process.argv.slice(2);
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
if (ui !== '') await page.addInitScript((v) => localStorage.setItem('dwu-ui-settings', JSON.stringify({ uiScale: v })), +ui);
await page.goto(`${base}?autostart=1`);
await page.waitForFunction(() => window.__dwu?.game?.playerEmpire !== undefined, null, { timeout: 240000 });
await page.waitForTimeout(3000);
const tag = `${w}x${h}@${dpr}${ui !== '' ? `-ui${ui}` : ''}`;
await page.click('[data-hud="btnEmpireSummary"]');
await page.waitForSelector('[data-ow="summary"]');
await page.waitForTimeout(1500);
await page.screenshot({ path: `${outDir}/summary-${tag}.png` });
const combo = page.locator('[data-ow="summary"] .es-gov-combo');
if (await combo.count()) {
    const values = await combo.locator('option').evaluateAll((os) => os.map((o) => o.value));
    if (values.length > 2) {
        await combo.selectOption(values[2]);
        await page.waitForTimeout(600);
        await page.screenshot({ path: `${outDir}/government-${tag}.png` });
    }
}
console.log(logs.length ? logs.join('\n') : 'no console errors');
await browser.close();
