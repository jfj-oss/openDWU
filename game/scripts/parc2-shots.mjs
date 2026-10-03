// Parity batch C2 captures: the game-start Introduction panel (pnlIntroduction), the Game Options window + Your Empire
// Settings (and the new-game defaults it saves on close), and the Game End panel (outcome over the Empire Comparison's
// Achievements tab + pnlGameEnd's Continue / Exit to main menu) — in-thread and with ?simWorker=1.
// Usage: node scripts/parc2-shots.mjs <baseUrl> <outDir> [w] [h]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const [base = 'http://localhost:5173/', outDir = 'shots/parc2', w = '1920', h = '1080'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const failures = [];
const check = (cond, what) => {
    console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`);
    if (!cond) failures.push(what);
};

for (const mode of ['inthread', 'worker']) {
    const page = await browser.newPage({ viewport: { width: +w, height: +h } });
    const logs = [];
    page.on('console', (m) => {
        if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
    });
    page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
    const shot = async (name) => {
        await page.waitForTimeout(700);
        const path = `${outDir}/${name}-${mode}.png`;
        await page.screenshot({ path });
        console.log(`saved ${path}`);
    };
    try {
        await page.goto(`${base}?autostart=1&intro=1${mode === 'worker' ? '&simWorker=1' : '&simWorker=0'}`);
        await page.waitForFunction(() => window.__dwu?.game?.playerEmpire !== undefined, null, { timeout: 300000 });
        if (mode === 'worker') check(await page.evaluate(() => window.__dwu.simWorker !== null), `${mode}: the sim runs in a worker`);

        // --- Introduction (Main.Part12.cs method_81): shown paused; Start Playing resumes (method_82).
        await page.waitForSelector('[data-ow="introduction"]', { timeout: 60000 });
        await page.waitForTimeout(1500);
        await shot('introduction');
        check(await page.evaluate(() => window.__dwu.time.paused === true), `${mode}: the Introduction pauses the game`);
        await page.locator('[data-ow="introduction"] button', { hasText: 'Start Playing' }).click();
        await page.waitForTimeout(500);
        check((await page.locator('[data-ow="introduction"]').count()) === 0, `${mode}: Start Playing closes the panel`);
        check(await page.evaluate(() => window.__dwu.time.paused === false), `${mode}: Start Playing resumes the game`);

        // --- Game Options + Your Empire Settings; closing saves the new-game defaults (YxwyUefOyQ / method_257).
        await page.evaluate(() => (window.__dwu.time.paused = true));
        await page.keyboard.press('o');
        await page.waitForSelector('[data-ow="gameoptions"]');
        await shot('options');
        await page.locator('[data-ow="gameoptions"] button', { hasText: 'Empire Settings' }).click();
        await page.waitForSelector('[data-ow="gameoptions-empire"]');
        // Patrol (auto) → "Engage when attacked" (index 1 → attack range 0): a journaled setEmpireSetting command.
        await page.locator('[data-ow="gameoptions-empire"] select').first().selectOption('1');
        await shot('empire-settings');
        await page.keyboard.press('Escape'); // Empire Settings
        await page.waitForTimeout(200);
        await page.keyboard.press('Escape'); // Options
        await page.waitForTimeout(800);
        const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('dwu-ui-settings') ?? '{}').newGameOptions ?? null);
        check(saved !== null && saved.attackRangePatrol === 0, `${mode}: closing Options saved the new-game defaults (attackRangePatrol ${saved?.attackRangePatrol})`);
        await page.evaluate(() => (window.__dwu.time.paused = false));
        await page.waitForTimeout(1500);
        check(await page.evaluate(() => window.__dwu.game.playerEmpire.attackRangePatrol === 0), `${mode}: the command reached the empire`);
        const log = await page.evaluate(async () => {
            const l = await window.__dwu.commands.log();
            return l.filter((e) => e.op === 'setEmpireSetting').map((e) => e.args);
        });
        check(log.some((a) => a[0] === 'attackRangePatrol' && a[1] === 0), `${mode}: setEmpireSetting is in the command journal`);

        // --- Game End (DoGameEnd → method_436): the outcome over the Achievements tab + pnlGameEnd.
        const end = async (outcome, description) =>
            page.evaluate(
                async ([o, d]) => {
                    const ec = await import('/src/ui/screens/empireComparison.ts');
                    const v = await import('/src/sim/victory.ts');
                    const g = window.__dwu.galaxy;
                    window.__dwu.time.paused = true; // DoGameEnd's method_154
                    ec.presentGameEnd(g, window.__dwu.time, new v.GameEndEventArgs(o === 1 ? g.playerEmpire : null, o, d, 0));
                },
                [outcome, description],
            );
        await end(1, 'You have achieved victory by reaching the victory conditions!');
        await page.waitForSelector('[data-ow="gameend"]');
        await shot('gameend-victory');
        check((await page.locator('.empire-comparison-overlay-line', { hasText: 'VICTORY!' }).count()) === 1, `${mode}: the outcome is drawn over the Achievements tab`);
        await page.locator('[data-ow="gameend"] button', { hasText: 'Continue Playing...' }).click();
        await page.waitForTimeout(500);
        check((await page.locator('[data-ow="gameend"]').count()) === 0, `${mode}: Continue Playing closes the panel`);
        check(await page.evaluate(() => window.__dwu.time.paused === false), `${mode}: Continue Playing resumes`);
        await page.keyboard.press('Escape'); // the comparison window
        await end(2, 'The Galactic Empire has won the game');
        await page.waitForSelector('[data-ow="gameend"]');
        await shot('gameend-defeat');
        await page.locator('[data-ow="gameend"] button', { hasText: 'Exit to main menu' }).click();
        await page.waitForSelector('.main-menu', { timeout: 30000 });
        await shot('gameend-exit-mainmenu');
        check((await page.locator('[data-ow="gameend"]').count()) === 0, `${mode}: Exit to main menu leaves the game`);
    } catch (e) {
        console.log(logs.join('\n'));
        await page.screenshot({ path: `${outDir}/failure-${mode}.png` });
        await browser.close();
        throw e;
    }
    console.log(logs.length ? logs.join('\n') : `${mode}: no console errors`);
    await page.close();
}
await browser.close();
if (failures.length > 0) {
    console.log(`${failures.length} check(s) failed`);
    process.exit(1);
}
