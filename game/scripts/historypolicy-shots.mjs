// Message History / Galactic History (incl. the Battle Reports tab) and Empire Policy captures (UI style audit WP4).
// Works against the old and the new DOM (it opens the screens by hotkey / top-bar button and finds controls by text),
// so the same script takes the before and the after shots.
// 1. In-thread (?simWorker=0): H (Messages), the filter on Galactic History, the Battle Reports tab (a synthetic report
//    is added to the side table so the tab has a row — screenshot staging only), the ticker's message history, the
//    Empire Policy screen (top, the design pickers, Load list, Save form).
// 2. Worker mode (?simWorker=1): H + Battle Reports tab, Empire Policy (a combo change goes through the command queue).
// Usage: node scripts/historypolicy-shots.mjs <baseUrl> <outDir> [tag] [w] [h]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const [base = 'http://localhost:5173/', outDir = 'shots/historypolicy', tag = 'after', w = '1920', h = '1080'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const logs = [];
const shots = [];
async function newPage(mode) {
    const page = await browser.newPage({ viewport: { width: +w, height: +h } });
    page.on('console', (m) => {
        if (m.type() === 'error') logs.push(`[${mode} ${m.type()}] ${m.text()}`);
    });
    page.on('pageerror', (e) => logs.push(`[${mode} pageerror] ${e.message}`));
    return page;
}
const shot = async (page, name) => {
    const p = `${outDir}/${tag}-${name}-${w}x${h}.png`;
    await page.waitForTimeout(500);
    await page.screenshot({ path: p });
    shots.push(p);
    console.log('saved', p);
};
const menuOpen = (page) => page.evaluate(() => {
    const m = document.getElementById('game-menu-overlay');
    return m !== null && m.offsetParent !== null;
});
const esc = async (page) => {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    // An Escape with nothing left to close opens the game menu: close it again.
    if (await menuOpen(page)) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
    }
};
/** The select of the open history screen whose options include `text`; set it to that option. */
const pickOption = (page, text) =>
    page.evaluate((t) => {
        for (const s of document.querySelectorAll('select')) {
            const i = [...s.options].findIndex((o) => o.text === t);
            if (i >= 0 && s.offsetParent !== null) {
                s.selectedIndex = i;
                s.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
            }
        }
        return false;
    }, text);
const clickText = async (page, sel, text) => {
    const l = page.locator(sel, { hasText: text }).first();
    if ((await l.count()) === 0) return false;
    await l.click();
    await page.waitForTimeout(400);
    return true;
};

async function start(mode) {
    const page = await newPage(mode);
    await page.goto(`${base}?autostart=1&simWorker=${mode === 'worker' ? 1 : 0}`);
    await page.waitForFunction(() => window.__dwu?.game?.playerEmpire !== undefined || window.__dwu?.galaxy?.playerEmpire !== undefined, null, { timeout: 240000 });
    await page.waitForTimeout(3000);
    // A few game seconds so the message lists have rows, then pause.
    await page.evaluate(() => {
        const t = window.__dwu.time;
        t.speed = 4;
        t.paused = false;
    });
    await page.waitForTimeout(8000);
    await page.evaluate(() => void (window.__dwu.time.paused = true));
    await page.waitForTimeout(500);
    return page;
}

async function history(page, mode) {
    await page.mouse.move(Number(w) / 2, Number(h) / 2);
    await page.keyboard.press('h');
    await page.waitForTimeout(1200);
    await shot(page, `${mode}-h-messages`);
    // Select the second row (the detail panel follows the selection).
    const rows = page.locator('[data-ow="galacticHistory"] .ow-grid-row, .galactic-history-row');
    if ((await rows.count()) > 1) {
        await rows.nth(1).click();
        await shot(page, `${mode}-h-messages-row2`);
    }
    if (await pickOption(page, 'Show Galactic History Messages')) await shot(page, `${mode}-h-galactic-history`);
    if (await clickText(page, 'button', 'Battle Reports')) await shot(page, `${mode}-h-battle-reports`);
    await esc(page);
}

// ---- 1. in-thread
const page = await start('thread');
const staged = await page.evaluate(async () => {
    const g = window.__dwu.game.galaxy;
    const { battleReportState, restoreBattleReportState } = await import('/src/sim/battleReports/battleReports.ts');
    const { galaxyStarDate } = await import('/src/sim/tick/simTime.ts');
    if (battleReportState(g) === undefined) restoreBattleReportState(g, { version: 1, nextId: 1, serial: 0, open: [], reports: [], skirmishes: [] });
    const st = battleReportState(g);
    const player = g.playerEmpire;
    const pir = g.pirateEmpires[0] ?? null;
    const ship = player.builtObjects.find((b) => b != null && b.role === 1) ?? player.builtObjects.find((b) => b != null);
    const sys = g.systems[0];
    const unit = (side, name, subRole, fate) => ({
        kind: 'ship', id: 1, name, side, subRole, creatureType: -1, designName: name, joinedMs: 0, engaged: true, estimated: false,
        startFirepower: 40, endFirepower: fate === 'destroyed' ? 0 : 30, startStrength: 60, endStrength: fate === 'destroyed' ? 0 : 45,
        startDamage: 0, endDamage: fate === 'destroyed' ? 10 : 2, startFighters: 0, endFighters: 0, startPopulation: 0, endPopulation: 0,
        startTroops: 0, endTroops: 0, fate, capturedBy: '', withdrew: false, x: sys.systemStar.xpos, y: sys.systemStar.ypos,
    });
    const side = (e, kind, camp) => ({ key: `e${e.empireId}`, name: e.name, kind, empireId: e.empireId, color: e.mainColor, camp, units: 1, firepowerStart: 40, firepowerEnd: kind === 'player' ? 30 : 0, strengthStart: 60, strengthEnd: kind === 'player' ? 45 : 0, fightersStart: 0, fightersEnd: 0, destroyed: kind === 'player' ? 0 : 1, captured: 0, disabled: 0, damaged: kind === 'player' ? 1 : 0, withdrew: 0 });
    const enemy = pir ?? g.empires.find((e) => e !== player);
    const now = galaxyStarDate(g);
    const mk = (id, minor, result) => ({
        id, minor, startMs: 0, endMs: 60000, startStarDate: now, endStarDate: now, systemIndex: 0, locationName: sys.systemStar.name, deepSpace: false, nearName: '',
        x: Math.trunc(sys.systemStar.xpos), y: Math.trunc(sys.systemStar.ypos), result,
        sides: [side(player, 'player', 'player'), side(enemy, enemy.pirateEmpireBaseHabitat != null ? 'pirate' : 'empire', 'enemy')],
        units: [unit(`e${player.empireId}`, ship?.name ?? 'Escort', ship?.subRole ?? 1, 'damaged'), unit(`e${enemy.empireId}`, 'Raider', 1, 'destroyed')],
    });
    st.reports.push(mk(900001, false, 'victory'), mk(900002, false, 'defeat'));
    st.skirmishes.push(mk(900003, true, 'draw'));
    return 'staged 3 synthetic reports';
});
console.log(staged);
await history(page, 'thread');
// The ticker's message history (click on the top-middle message panel).
const ticker = page.locator('[data-hud="lstMessages"]').first();
if ((await ticker.count()) > 0) {
    await ticker.click();
    await page.waitForTimeout(600);
    await shot(page, 'thread-ticker-history');
    await esc(page);
} else {
    await page.evaluate(async () => (await import('/src/ui/screens/messageHistory.ts')).toggleMessageHistory());
    await page.waitForTimeout(600);
    await shot(page, 'thread-ticker-history');
    await page.evaluate(async () => (await import('/src/ui/screens/messageHistory.ts')).closeMessageHistory());
}
// Empire Policy.
await page.click('button[title^="Open Empire Policy"]');
await page.waitForTimeout(1200);
await shot(page, 'thread-policy-top');
await page.locator('.policy-design').first().scrollIntoViewIfNeeded().catch(() => {});
await shot(page, 'thread-policy-designs');
await page.locator('.policy-row', { hasText: 'Military construction proportion: Escorts' }).first().scrollIntoViewIfNeeded().catch(() => {});
await shot(page, 'thread-policy-construction');
await page.click('.policy-load');
await page.waitForTimeout(600);
await shot(page, 'thread-policy-load');
await esc(page);
if ((await page.locator('.policy-window').count()) === 0) await page.click('button[title^="Open Empire Policy"]');
await page.waitForTimeout(400);
await page.click('.policy-save');
await page.waitForTimeout(600);
await shot(page, 'thread-policy-save');
await esc(page);
await esc(page);
await page.close();

// ---- 2. worker mode
const wp = await start('worker');
await history(wp, 'worker');
await wp.click('button[title^="Open Empire Policy"]');
await wp.waitForTimeout(1200);
const changed = await wp.evaluate(() => {
    const s = [...document.querySelectorAll('.policy-window select.policy-select')].find((x) => !x.closest('.policy-band-auto') && x.options.length > 1);
    if (!s) return null;
    s.selectedIndex = s.selectedIndex === 0 ? 1 : 0;
    s.dispatchEvent(new Event('change', { bubbles: true }));
    return s.options[s.selectedIndex].text;
});
console.log('worker policy combo ->', changed);
await wp.waitForTimeout(1500);
await shot(wp, 'worker-policy');
await browser.close();
console.log(logs.length > 0 ? logs.slice(0, 40).join('\n') : 'no console errors');
console.log('shots:\n' + shots.join('\n'));
