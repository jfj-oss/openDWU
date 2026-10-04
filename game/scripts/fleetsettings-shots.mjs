#!/usr/bin/env node
// Fleet Settings panel captures (an Improvement: src/ui/screens/fleetSettings.ts). Against a running dev server, boots
// ?autostart=1 (sim worker by default, --inthread for the in-thread game), makes sure the player has a fleet, selects
// it and opens the panel from the selection panel's "Settings" button; clicks Defend, a range step, a stance and the
// troop loadout box and checks the sim took them (in worker mode the replica after the replies); opens the panel from
// the Fleets window and with Q; shows the shortcuts overlay and the Game Options "Improvements" group, switches the
// improvement off and checks the button and the Q key are gone.
//   node scripts/fleetsettings-shots.mjs <base url> [--out=shots/fleetsettings] [--inthread] [--w=1920] [--h=1080]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5173/';
const opt = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const inThread = process.argv.includes('--inthread');
const out = opt('out', `shots/fleetsettings${inThread ? '-inthread' : ''}`);
const w = +opt('w', 1920);
const h = +opt('h', 1080);
mkdirSync(out, { recursive: true });
const url = `${base}?autostart=1&simWorker=${inThread ? 0 : 1}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: w, height: h } });
const logs = [];
page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.stack ?? e.message}`));
let failed = 0;
const check = (ok, what) => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
    if (!ok) failed++;
};
const wait = (ms) => page.waitForTimeout(ms);
const shots = [];
const shot = async (name) => {
    const p = `${out}/${name}.png`;
    await page.screenshot({ path: p });
    shots.push(p);
};
const panel = '[data-ow="fleetsettings"]';
/** The fleet as the UI reads it (the replica in worker mode). */
const fleetState = () =>
    page.evaluate(() => {
        const sg = window.__fsFleet;
        return { posture: sg.posture, range: sg.postureRangeSquared, stance: sg.attackRangeSquared, loadout: [sg.troopLoadoutInfantry, sg.troopLoadoutArmored] };
    });
try {
    await page.goto(url);
    await page.waitForFunction(() => window.__dwu?.time !== undefined && window.__dwu?.game?.playerEmpire !== undefined, null, { timeout: 600000 });
    check(inThread === (await page.evaluate(() => window.__dwu.simWorker === null)), inThread ? 'game runs in-thread' : 'game runs in the worker');
    await page.evaluate(() => { window.__dwu.time.paused = true; });
    await wait(1500);
    // A fleet: the player's first, else one formed from two free warships (Set Fleet → (New Fleet)).
    const fleetName = await page.evaluate(async () => {
        const { issuePlayerCommand } = await import('/src/sim/player/playerCommands.ts');
        const game = window.__dwu.game;
        const p = game.playerEmpire;
        const groups = () => (p.shipGroups ?? []).filter((g) => g != null);
        if (groups().length === 0) {
            const mil = (p.builtObjects ?? []).filter((b) => b != null && b.role === 1 && b.shipGroup == null && b.builtAt == null).slice(0, 2);
            issuePlayerCommand(p.galaxy, p, 'setShipsFleet', [mil, 'new']);
            window.__dwu.time.paused = false;
            for (let i = 0; i < 40 && groups().length === 0; i++) await new Promise((r) => setTimeout(r, 250));
            window.__dwu.time.paused = true;
        }
        const sg = groups()[0] ?? null;
        window.__fsFleet = sg;
        if (sg === null) return null;
        const hud = await import('/src/ui/hud.ts');
        hud.selectShipGroup(sg, true);
        return sg.name;
    });
    check(fleetName !== null, `a player fleet: ${fleetName}`);
    await wait(1500);
    await shot('selection-panel');
    const settingsBtn = page.locator('.sel-extra-btn', { hasText: 'Settings' });
    check((await settingsBtn.count()) === 1, 'the selection panel offers "Settings" for the fleet');
    await settingsBtn.first().click();
    await page.waitForSelector(panel);
    await wait(1200);
    await shot('panel');

    // Controls: Defend, range Sector, stance System targets, troop loadouts on (quick clicks on each).
    const seg = (text) => page.locator(`${panel} .fs-seg`, { hasText: text });
    await seg('Defend').first().click();
    await seg('Sector').first().click();
    await seg('System targets').first().click();
    // "Use Troop Loadouts": a fleet starts with its empire policy's loadout (on); off then on again (two quick clicks) → 100 % infantry.
    const use = page.locator(`${panel} label.ow-check`, { hasText: 'Use Troop Loadouts' }).locator('input');
    if (await use.isChecked()) await use.click();
    await use.click();
    await wait(300);
    // Shown at once (the pending value), before the reply in worker mode.
    const lit = await page.evaluate((sel) => [...document.querySelectorAll(`${sel} .fs-seg.fs-on`)].map((b) => b.textContent), panel);
    check(lit.includes('Defend') && lit.includes('Sector') && lit.includes('System targets'), `the clicked values are lit at once (${lit.join(', ')})`);
    await page.evaluate(() => { window.__dwu.time.paused = false; });
    await wait(2500);
    await page.evaluate(() => { window.__dwu.time.paused = true; });
    await wait(800);
    const after = await fleetState();
    check(after.posture === 1, `posture is Defend (${after.posture})`);
    check(after.range === 1000000000000, `range is Sector (${after.range})`);
    check(after.stance === 2304000000, `stance is System targets (${after.stance})`);
    check(after.loadout[0] === 100, `troop loadout on: 100% infantry (${after.loadout.join('/')})`);
    await shot('panel-after-clicks');
    await page.keyboard.press('Escape');
    await wait(500);
    check((await page.locator(panel).count()) === 0, 'Escape closes the panel');

    // From the Fleets window's orders row.
    await page.click('[data-hud="tbtnShipGroups"]');
    await page.waitForSelector('[data-ow="fleets"] .ow-grid');
    await wait(600);
    await page.locator('[data-ow="fleets"] .ow-grid-row').first().click();
    await wait(800);
    const flBtn = page.locator('[data-ow="fleets"] .fl-order', { hasText: 'Settings' });
    check((await flBtn.count()) === 1, 'the Fleets window has a "Settings" order button');
    await shot('fleets-window');
    await flBtn.first().click();
    await page.waitForSelector(panel);
    await wait(800);
    await shot('panel-from-fleets-window');
    await page.keyboard.press('Escape');
    await wait(300);
    await page.keyboard.press('Escape');
    await wait(500);

    // Q (with the fleet selected).
    await page.mouse.move(5, h / 2);
    await page.keyboard.press('q');
    await wait(800);
    check((await page.locator(panel).count()) === 1, 'Q opens the panel');
    await page.keyboard.press('q');
    await wait(500);
    check((await page.locator(panel).count()) === 0, 'Q again closes it');

    // The shortcuts overlay lists Q.
    await page.keyboard.press('?');
    await wait(500);
    const qRow = await page.evaluate(() => [...document.querySelectorAll('#keyboard-shortcuts-overlay .hud-keyboard-row')].some((r) => r.textContent.startsWith('Q') && r.textContent.includes('Fleet Settings')));
    check(qRow, 'the shortcuts overlay lists Q → Fleet Settings');
    await shot('shortcuts-overlay');
    await page.keyboard.press('Escape');
    await wait(400);

    // Game Options → Improvements: switch it off.
    await page.keyboard.press('o');
    await page.waitForSelector('[data-ow="gameoptions"]');
    await wait(800);
    await shot('game-options-improvements');
    const box = page.locator('[data-ow="gameoptions"] [data-improvement="fleetSettings"] input');
    check((await box.count()) === 1 && (await box.isChecked()), 'Game Options → Improvements → Fleet Settings panel: on by default');
    await box.click();
    await wait(300);
    await page.keyboard.press('Escape');
    await wait(600);
    check((await page.locator('.sel-extra-btn', { hasText: 'Settings' }).count()) === 0, 'off: the selection panel button is gone');
    await page.keyboard.press('q');
    await wait(600);
    check((await page.locator(panel).count()) === 0, 'off: Q does nothing');
    await page.keyboard.press('?');
    await wait(400);
    const qRowOff = await page.evaluate(() => [...document.querySelectorAll('#keyboard-shortcuts-overlay .hud-keyboard-row')].some((r) => r.textContent.includes('Fleet Settings')));
    check(!qRowOff, 'off: the shortcuts overlay does not list it');
    await page.keyboard.press('Escape');
    await wait(300);
    await shot('improvement-off');
    // Back on (the setting persists in localStorage).
    await page.evaluate(async () => (await import('/src/ui/improvements.ts')).setImprovementEnabled('fleetSettings', true));
} catch (e) {
    failed++;
    console.log(`FAIL ${e.stack ?? e}`);
}
console.log('screenshots:\n' + shots.map((s) => `  ${s}`).join('\n'));
console.log(logs.length ? logs.join('\n') : 'no console errors');
await browser.close();
process.exit(failed > 0 ? 1 : 0);
