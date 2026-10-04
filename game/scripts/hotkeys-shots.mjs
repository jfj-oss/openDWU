// Hotkeys screen captures: Options -> HotKeys, a remap, a conflict, and the "?" overlay with the current keys.
// Usage: node scripts/hotkeys-shots.mjs <baseUrl> <outDir> [w] [h] [dpr]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const [base = 'http://localhost:5173/', outDir = 'shots/hotkeys', w = '1920', h = '1080', dpr = '1'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: +dpr });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`${base}?autostart=1`);
await page.waitForFunction(() => window.__dwu?.game?.playerEmpire !== undefined, null, { timeout: 240000 });
await page.waitForTimeout(3000);
const shot = async (name) => { await page.waitForTimeout(500); await page.screenshot({ path: `${outDir}/${name}-${w}x${h}@${dpr}.png` }); };
try {
    await page.keyboard.press('o');
    await page.waitForSelector('[data-ow="gameoptions"]');
    await page.locator('[data-ow="gameoptions"] button', { hasText: 'HotKeys' }).click();
    await page.waitForSelector('[data-ow="hotkeys"]');
    await shot('hotkeys-defaults');
    const rowKey = (desc) => page.locator('.hk-row', { hasText: desc }).first().locator('.hk-key');
    // Remap Galaxy Map (G) to J.
    await rowKey('Galaxy Map screen').click();
    await page.keyboard.press('j');
    console.log('G row now:', await rowKey('Galaxy Map screen').innerText());
    // Conflict: give Message History (H) the J key as well.
    await rowKey('Message History').click();
    await page.keyboard.press('j');
    await shot('hotkeys-conflict');
    console.log('conflict rows:', await page.locator('.hk-row-conflict').count());
    await page.keyboard.press('Escape'); // nothing is capturing: closes the window
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    await page.keyboard.press('?');
    await shot('shortcuts-overlay');
    console.log('persisted:', await page.evaluate(() => localStorage.getItem('dwu-ui-settings')?.match(/keyBindingOverrides.{0,200}/)?.[0]));
} finally {
    console.log(logs.length ? logs.join('\n') : 'no console errors');
    await browser.close();
}
