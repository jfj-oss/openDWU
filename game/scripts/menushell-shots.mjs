// Menu shell captures (UI style WP2): the main menu corners, its Options, the Check for Updates notice, the Credits,
// the main-menu Load Game panel, then (in a started game, in-thread and with ?simWorker=1) the loading overlay, the
// Escape Game Menu, Save / Load and Options from the game menu. Selectors go by visible text, so the same script
// captures the old and the restyled shell (before / after shots).
// Usage: node scripts/menushell-shots.mjs <baseUrl> <outDir> [tag] [w] [h]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const [base = 'http://localhost:5173/', outDir = 'shots/menushell', tag = 'after', w = '1600', h = '900'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
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
const watch = (page, t) => {
    page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && logs.push(`[${t} ${m.type()}] ${m.text()}`));
    page.on('pageerror', (e) => logs.push(`[${t} pageerror] ${e.message}`));
};
const saved = [];
const shot = async (page, name) => {
    await page.waitForTimeout(600);
    const path = `${outDir}/${tag}-${name}.png`;
    await page.screenshot({ path });
    saved.push(path);
};
const button = (page, name) => page.getByRole('button', { name, exact: true }).first();

// 1. Main menu: corners, Options, Updates, Credits, Load Game.
{
    const ctx = await browser.newContext({ viewport: { width: +w, height: +h } });
    const page = await ctx.newPage();
    watch(page, 'menu');
    try {
        await page.goto(base);
        await page.waitForSelector('.main-menu-item[data-id="options"]', { timeout: 120000 });
        await shot(page, '01-main-menu');
        await page.click('.main-menu-item[data-id="options"]');
        await shot(page, '02-menu-options');
        // The recreation's toggles must still be there: Multithreading and the Map Display group.
        const adv = page.getByRole('button', { name: /Advanced Settings/ }).first();
        if ((await adv.count()) > 0) {
            await adv.click();
            await shot(page, '03-menu-options-advanced');
            check((await page.getByText('Multithreading (next game)').count()) > 0, 'Advanced Settings holds Multithreading (next game)');
            check((await page.getByText('Show system names').count()) > 0, 'Advanced Settings holds Show system names');
            await page.keyboard.press('Escape');
            await page.waitForTimeout(200);
        }
        const imp = page.getByRole('button', { name: /^Improvements/ }).first();
        if ((await imp.count()) > 0) {
            await imp.click();
            await shot(page, '04-menu-options-improvements');
            await page.keyboard.press('Escape');
            await page.waitForTimeout(200);
        }
        // Message Settings and Empire Settings work without a game (they edit what the next new game starts with).
        await page.getByRole('button', { name: 'Show Message Settings' }).first().click();
        await page.waitForSelector('[data-ow="gameoptions-messages"]');
        await shot(page, '04b-menu-options-messages');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
        await page.getByRole('button', { name: 'Empire Settings' }).first().click();
        await page.waitForSelector('[data-ow="newgame-defaults-empire"]');
        await shot(page, '04c-menu-options-empire');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        await page.click('.main-menu-updates button');
        await shot(page, '05-menu-updates');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(3200); // the old toast fades by itself
        await page.click('.main-menu-credits');
        await page.waitForTimeout(14000); // the column starts below the bottom edge and scrolls 30 px/s
        await shot(page, '06-menu-credits');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        await page.click('.main-menu-item[data-id="loadGame"]');
        // The game data loads first (main.ts ensureStaticData), then the panel opens.
        await page.waitForSelector('.save-load-file-input', { state: 'attached', timeout: 120000 });
        await page.waitForTimeout(500);
        await shot(page, '07-menu-load');
    } catch (e) {
        console.log(`menu: ${e.message}`);
        failed = true;
        await page.screenshot({ path: `${outDir}/${tag}-failure-menu.png` });
    }
    await ctx.close();
}

// 2. In a game, both sim modes.
for (const [mode, qs] of [['thread', '?autostart=1'], ['worker', '?autostart=1&simWorker=1']]) {
    const ctx = await browser.newContext({ viewport: { width: +w, height: +h } });
    const page = await ctx.newPage();
    watch(page, mode);
    try {
        await page.goto(`${base}${qs}`);
        // The loading overlay while the galaxy is built.
        await page.waitForSelector('.dwu-loading', { timeout: 120000 });
        await page.waitForTimeout(400);
        if (mode === 'thread') {
            const path = `${outDir}/${tag}-10-loading.png`;
            await page.screenshot({ path });
            saved.push(path);
        }
        await page.waitForFunction(() => window.__dwu?.game?.playerEmpire !== undefined || window.__dwu?.galaxy?.playerEmpire !== undefined, null, { timeout: 240000 });
        await page.waitForSelector('.dwu-loading', { state: 'detached', timeout: 120000 });
        await page.waitForTimeout(2500);
        await page.mouse.move(+w / 2, +h / 2);
        await page.keyboard.press('Escape');
        await shot(page, `11-game-menu-${mode}`);
        const editor = page.getByRole('button', { name: 'Enter Game Editor', exact: true });
        if ((await editor.count()) > 0) check(await editor.isDisabled(), `${mode}: Enter Game Editor is disabled`);
        await button(page, 'Save Game').click();
        await page.waitForTimeout(500);
        await page.locator('.save-load-name-input, [data-ow="saveload"] input[type="text"]').first().fill('menushell');
        await shot(page, `12-save-${mode}`);
        const saveBtn = page.locator('.save-load-btn').filter({ hasText: /^Save$/ }).first();
        await saveBtn.click();
        await page.waitForTimeout(2500);
        await shot(page, `13-saved-${mode}`);
        const listed = await page.getByText('menushell', { exact: true }).count();
        check(listed > 0, `${mode}: the new save is listed`);
        // Escape closes the panel; the game menu stays open behind it.
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        await button(page, 'Load Game').click();
        await shot(page, `14-load-${mode}`);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        await button(page, 'Options').click();
        await page.waitForSelector('[data-ow="gameoptions"]');
        await shot(page, `15-game-options-${mode}`);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        // Round trip: Exit to Main Menu (MessageBoxEx Yes / No), Load Game, double-click the save.
        await page.keyboard.press('Escape');
        await button(page, 'Exit to Main Menu').click();
        await page.waitForTimeout(400);
        await shot(page, `16-exit-confirm-${mode}`);
        await page.locator('[data-ow="msgbox"] button', { hasText: 'Yes' }).click();
        await page.waitForSelector('.main-menu-item[data-id="loadGame"]', { timeout: 60000 });
        const prevGame = await page.evaluate(() => (window.__dwu.__menushell = Math.random()));
        await page.click('.main-menu-item[data-id="loadGame"]');
        const row = page.locator('#save-load-overlay .ow-grid-row', { hasText: 'menushell' }).first();
        await row.waitFor({ timeout: 120000 });
        await row.dblclick();
        await page.waitForFunction((p) => window.__dwu?.__menushell !== p && (window.__dwu?.game?.playerEmpire !== undefined), prevGame, { timeout: 240000 });
        await page.waitForSelector('.dwu-loading', { state: 'detached', timeout: 120000 });
        await page.waitForTimeout(2000);
        await page.mouse.move(+w / 2, +h / 2);
        await page.keyboard.press('Escape');
        await button(page, 'Save Game').click();
        await page.waitForTimeout(400);
        const prefill = await page.locator('.save-load-name-input').inputValue();
        check(prefill === 'menushell', `${mode}: after loading, Save Game starts from the loaded save's name (got "${prefill}")`);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
        await button(page, 'Save Game As').click();
        await page.waitForTimeout(400);
        const blank = await page.locator('.save-load-name-input').inputValue();
        check(blank === '', `${mode}: Save Game As starts empty`);
    } catch (e) {
        console.log(`${mode}: ${e.message}`);
        failed = true;
        await page.screenshot({ path: `${outDir}/${tag}-failure-${mode}.png` });
    }
    await ctx.close();
}
console.log(logs.length ? logs.join('\n') : 'no console errors');
for (const p of saved) console.log(`saved ${p}`);
await browser.close();
process.exit(failed ? 1 : 0);
