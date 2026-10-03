// Research screen captures (original-style window): boots ?autostart=1, opens the screen from the top bar, hovers the
// current project (hover panel), switches to Energy and to Research Stations.
// Usage: node scripts/research-shots.mjs <baseUrl> <outDir> [w] [h] [dpr] [uiScale%]  (uiScale 200 = the small 1020 × 767 window)
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const [base = 'http://localhost:5173/', outDir = 'shots/research', w = '1920', h = '1080', dpr = '1', ui = ''] = process.argv.slice(2);
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
await page.click('[data-hud="tbtnResearch"]');
await page.waitForSelector('[data-ow="research"] .rs-node');
await page.waitForTimeout(1500);
await page.screenshot({ path: `${outDir}/weapons-${tag}.png` });
// Hover the current project (the node with the current-project border), else the first glowing one.
const cur = page.locator('[data-ow="research"] .rs-border-current').first();
if (await cur.count()) {
    await cur.hover();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${outDir}/hover-${tag}.png` });
}
// Click the current project: the crash-program question (MessageBoxEx), then No.
if (await cur.count()) {
    await cur.click();
    await page.waitForSelector('[data-ow="msgbox"]', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${outDir}/crash-${tag}.png` });
    const no = page.locator('[data-ow="msgbox"] .ow-glass', { hasText: 'No' });
    if (await no.count()) await no.click();
    await page.waitForTimeout(300);
}
// A locked project's hover panel (what it needs first).
const locked = page.locator('[data-ow="research"] .rs-frame-hatched').nth(3);
if (await locked.count()) {
    await locked.hover();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${outDir}/locked-${tag}.png` });
}
await page.locator('[data-ow="research"] .rs-tab').nth(1).click();
await page.waitForTimeout(1200);
await page.screenshot({ path: `${outDir}/energy-${tag}.png` });
await page.locator('[data-ow="research"] .rs-tab').nth(3).click();
await page.waitForTimeout(2500);
await page.screenshot({ path: `${outDir}/stations-${tag}.png` });
console.log(logs.length ? logs.join('\n') : 'no console errors');
await browser.close();
