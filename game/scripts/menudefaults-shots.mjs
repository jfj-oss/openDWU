// Main menu Options -> new-game defaults, and the Empire Policy screen's GameOptions persistence (in-thread and ?simWorker=1).
// Usage: node scripts/menudefaults-shots.mjs <baseUrl> <outDir>
import { chromium } from 'playwright-core';
const [base = 'http://localhost:5173/', outDir = 'shots'] = process.argv.slice(2);
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const logs = [];
let failed = false;
const check = (ok, what) => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
    if (!ok) failed = true;
};
const saved = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('dwu-ui-settings') ?? '{}').newGameOptions ?? null);
const watch = (page, tag) => {
    page.on('console', (m) => m.type() === 'error' && logs.push(`[${tag}] ${m.text()}`));
    page.on('pageerror', (e) => logs.push(`[${tag} pageerror] ${e.message}`));
};

// 1. Main menu Options.
{
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const page = await ctx.newPage();
    watch(page, 'menu');
    await page.goto(base);
    await page.waitForSelector('.main-menu-item[data-id="options"]', { timeout: 120000 });
    await page.click('.main-menu-item[data-id="options"]');
    // The main menu's Options window (Start.1.cs method_153) holds the new-game Automation group itself.
    await page.waitForSelector('[data-ow="gameoptions"] .go-mode-panel');
    await page.screenshot({ path: `${outDir}/menudefaults-1-options.png` });
    const mode = page.locator('select[data-go="mode"]');
    await mode.selectOption({ label: 'Expert (none)' });
    const s = await saved(page);
    check(s !== null && s.controlColonizationDefault === 0 && s.controlResearchDefault === false, 'Expert (none) saved into settings.newGameOptions');
    await page.screenshot({ path: `${outDir}/menudefaults-2-expert.png` });
    await page.getByRole('button', { name: 'Empire Settings' }).click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${outDir}/menudefaults-3-empire-settings.png` });
    await ctx.close();
}

// 2. Empire Policy in a started game, both modes: an apply saves the defaults; the new game reads them back.
for (const [tag, qs] of [['thread', '?autostart=1'], ['worker', '?autostart=1&simWorker=1']]) {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const page = await ctx.newPage();
    watch(page, tag);
    await page.goto(`${base}${qs}`);
    await page.waitForFunction(() => window.__dwu?.game?.playerEmpire !== undefined || window.__dwu?.galaxy?.playerEmpire !== undefined, null, { timeout: 180000 });
    await page.waitForTimeout(3000);
    await page.click('button[title^="Open Empire Policy"]');
    await page.waitForSelector('.policy-window');
    // Flip the first design-upgrade check box and the first automation combo.
    const firstCombo = page.locator('.policy-band-auto .policy-select').first();
    const before = await firstCombo.evaluate((s) => s.selectedIndex);
    await firstCombo.selectOption({ index: (before + 1) % 3 });
    const label = page.locator('.policy-explanation + .policy-row input.policy-check').first();
    const hadChecks = (await label.count()) > 0;
    if (hadChecks) await label.scrollIntoViewIfNeeded();
    if (hadChecks) await label.click();
    await page.waitForTimeout(800);
    const s = await saved(page);
    check(s !== null && typeof s.controlColonizationDefault === 'number', `${tag}: policy apply saved the Control*Default fields`);
    if (hadChecks) check(Object.keys(s ?? {}).some((k) => k.startsWith('designUpgrade') && s[k] === false), `${tag}: a design-upgrade flag saved as false`);
    await page.screenshot({ path: `${outDir}/menudefaults-4-policy-${tag}.png` });
    await ctx.close();
}
for (const l of logs) console.log(l);
await browser.close();
process.exit(failed ? 1 : 0);
