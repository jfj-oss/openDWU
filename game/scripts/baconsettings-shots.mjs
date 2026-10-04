// Game Options → Bacon Mod Settings captures: boots ?autostart=1 (plus extra query, e.g. "simWorker=1"), opens Options
// with O, then Bacon Mod Settings...; edits Ship Markup Factor and Use Star Gravity Wells, applies, and reads the game's
// stored overrides back (Galaxy.baconSettingsOverrides via the journaled setBaconSettings command).
// Usage: node scripts/baconsettings-shots.mjs <baseUrl> <outDir> [extraQuery] [w] [h]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const [base = 'http://localhost:5173/', outDir = 'shots/baconsettings', extra = '', w = '1920', h = '1080'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const logs = [];
page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`${base}?autostart=1${extra ? `&${extra}` : ''}`);
await page.waitForFunction(() => window.__dwu?.game?.playerEmpire !== undefined, null, { timeout: 240000 });
await page.waitForTimeout(3000);
const tag = `${extra ? extra.replace(/[^a-z0-9]+/gi, '-') : 'inthread'}-${w}x${h}`;
const shot = async (name) => {
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${outDir}/${name}-${tag}.png` });
    console.log(`saved ${outDir}/${name}-${tag}.png`);
};
try {
    await page.keyboard.press('o');
    await page.waitForSelector('[data-ow="gameoptions"]');
    await shot('options');
    await page.locator('[data-ow="gameoptions"] button', { hasText: 'Bacon Mod Settings' }).click();
    await page.waitForSelector('[data-ow="bacon-settings"]');
    await shot('bacon-settings');
    const win = page.locator('[data-ow="bacon-settings"]');
    const row = (name) => win.locator('.bs-row', { has: page.locator('.bs-name', { hasText: new RegExp(`^${name}$`) }) });
    await row('Ship Markup Factor').locator('input').fill('7');
    await row('Use Star Gravity Wells').locator('input[type=checkbox]').click();
    await shot('bacon-settings-edited');
    await win.locator('button', { hasText: 'Apply' }).click();
    await page.waitForTimeout(1500);
    const stored = await page.evaluate(() => JSON.stringify(window.__dwu.game.galaxy.baconSettingsOverrides ?? null));
    console.log(`stored overrides after Apply: ${stored}`);
    await shot('bacon-settings-applied');
    await win.locator('.bs-list').evaluate((e) => (e.scrollTop = e.scrollHeight / 2));
    await shot('bacon-settings-scrolled');
    await win.locator('button', { hasText: 'File Values' }).click();
    await page.waitForTimeout(1500);
    console.log(`stored overrides after File Values: ${await page.evaluate(() => JSON.stringify(window.__dwu.game.galaxy.baconSettingsOverrides ?? null))}`);
} catch (e) {
    console.log(logs.join('\n'));
    await page.screenshot({ path: `${outDir}/failure-${tag}.png` });
    throw e;
}
console.log(logs.length ? logs.join('\n') : 'no console errors');
await browser.close();
