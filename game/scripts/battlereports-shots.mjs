// Battle reports (an Improvement inspired by Distant Worlds 2; src/sim/battleReports, src/ui/battleReports.ts) captures.
// 1. In-thread (?simWorker=0, so the page can stage on the live game through Vite's module URLs): the player's first
//    armed ship and an unarmed pirate ship (engines out) are put side by side in empty space and the ship is ordered to
//    Attack — the test/battleReports.test.ts staging. The game runs at 4× until the report is written; the save of the
//    game in the middle of the fight is kept for step 2. Shots: the ticker line + stub, the report window, Galactic
//    History → Battle Reports, Game Options → Improvements.
// 2. Worker mode (?simWorker=1): that save is loaded from public/dev-saves/ (gitignored); the fight ends in the worker and
//    the report reaches the replica. Shots: the stub / ticker and the report window.
// Usage: node scripts/battlereports-shots.mjs <baseUrl> <outDir> [w] [h]
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
const [base = 'http://localhost:5173/', outDir = 'shots/battlereports', w = '1920', h = '1080'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
mkdirSync('public/dev-saves', { recursive: true });
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const logs = [];
async function newPage() {
    const page = await browser.newPage({ viewport: { width: +w, height: +h } });
    page.on('console', (m) => {
        if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
    });
    page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
    return page;
}
const shots = [];
const shot = async (page, name) => {
    const p = `${outDir}/${name}-${w}x${h}.png`;
    await page.screenshot({ path: p });
    shots.push(p);
    console.log('saved', p);
};
const reportsCount = (page) => page.evaluate(async () => (await import('/src/sim/battleReports/battleReports.ts')).battleReports(window.__dwu.game.galaxy).length);
async function waitForReport(page, label) {
    for (let i = 0; i < 240; i++) {
        if ((await reportsCount(page)) > 0) return true;
        await page.waitForTimeout(1000);
    }
    console.log(`${label}: no report after 240 s`);
    return false;
}

// ---- 1. in-thread
const page = await newPage();
await page.goto(`${base}?autostart=1&simWorker=0`);
await page.waitForFunction(() => window.__dwu?.game?.playerEmpire !== undefined, null, { timeout: 240000 });
await page.waitForTimeout(3000);
const staged = await page.evaluate(async () => {
    const g = window.__dwu.game.galaxy;
    const { updateIndexesForMovement, updatePosition } = await import('/src/sim/movement.ts');
    const { executeShipAction } = await import('/src/sim/player/executeShipAction.ts');
    const { createMissionShipActionAt } = await import('/src/sim/player/shipAction.ts');
    const { BuiltObjectMissionType, builtObjectMission } = await import('/src/sim/missions/mission.ts');
    const { ComponentStatus } = await import('/src/sim/builtObjectComponent.ts');
    const { ComponentCategoryType } = await import('/src/sim/data/policies.ts');
    const { BuiltObjectFleeWhen, BattleTactics } = await import('/src/sim/data/designSpecifications.ts');
    const { BuiltObjectSubRole } = await import('/src/sim/builtObjectTypes.ts');
    const player = g.playerEmpire;
    const live = (l) => l.filter((b) => b != null && !b.hasBeenDestroyed);
    const ships = live(player.builtObjects).filter((b) => b.role === 1 && b.firepowerRaw > 0 && b.topSpeed > 0 && b.builtAt == null).sort((a, b) => b.firepowerRaw - a.firepowerRaw);
    const esc = ships[0];
    const pir = g.pirateEmpires.flatMap((e) => live(e.builtObjects)).find((b) => b.firepowerRaw === 0 && b.subRole === BuiltObjectSubRole.ExplorationShip);
    if (!esc || !pir) return null;
    let spot = null;
    for (let x = 200000; x < g.sizeX && spot === null; x += 100000)
        for (let y = 200000; y < g.sizeY && spot === null; y += 100000)
            if (g.habitats.every((hb) => Math.hypot(hb.xpos - x, hb.ypos - y) > 300000) && g.builtObjects.every((b) => b === null || Math.hypot(b.xpos - x, b.ypos - y) > 300000)) spot = { x, y };
    const place = (b, x, y) => {
        const ix = Math.trunc(Math.trunc(b.xpos) / 400000), iy = Math.trunc(Math.trunc(b.ypos) / 400000);
        b.parentBuiltObject = null; b.parentHabitat = null; b.parentOffsetX = -2000000001.0; b.parentOffsetY = -2000000001.0;
        b.xpos = x; b.ypos = y;
        updateIndexesForMovement(g, b, ix, iy, true);
        updatePosition(g, b);
    };
    builtObjectMission(pir.mission)?.clear();
    pir.isAutoControlled = false;
    pir.fleeWhen = BuiltObjectFleeWhen.Never;
    pir.design.fleeWhen = BuiltObjectFleeWhen.Never;
    pir.targetSpeed = 0; pir.preferredSpeed = 0; pir.currentSpeed = 0;
    for (const c of pir.components.items) if (c.category === ComponentCategoryType.Engine) c.status = ComponentStatus.Damaged;
    pir.reDefine();
    place(esc, spot.x, spot.y);
    place(pir, spot.x + 60, spot.y);
    esc.currentEnergy = esc.reactorStorageCapacity;
    esc.design.tacticsWeakerShips = BattleTactics.PointBlank;
    esc.design.tacticsStrongerShips = BattleTactics.PointBlank;
    const r = executeShipAction(g, player, esc, createMissionShipActionAt(BuiltObjectMissionType.Attack, pir, Math.trunc(pir.xpos), Math.trunc(pir.ypos)), true);
    window.__dwu.camera.centerOn(spot.x, spot.y);
    const t = window.__dwu.time;
    t.speed = 4;
    t.paused = false;
    return { ok: r.ok, esc: esc.name, pir: `${pir.name} (${pir.empire.name})` };
});
console.log('staged', staged);
// The mid-fight save for the worker run.
await page.waitForTimeout(4000);
const text = await page.evaluate(async () => {
    const t = await window.__dwu.serialize();
    return t == null ? t : await (await import('/src/saveData.ts')).saveTextString(t); // a gzip Blob (src/saveData.ts)
});
writeFileSync('public/dev-saves/battlereports-midfight.dwusave', text ?? '');
console.log('saved mid-fight game', (text ?? '').length, 'chars');
if (await waitForReport(page, 'in-thread')) {
    await page.waitForTimeout(1500);
    await page.evaluate(() => void (window.__dwu.time.paused = true));
    await page.waitForTimeout(500);
    await shot(page, 'ticker-stub');
    await page.locator('.message-stub-battle').first().click();
    await page.waitForSelector('[data-ow="battleReport"]');
    await page.waitForTimeout(800);
    await shot(page, 'report-window');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await page.keyboard.press('H');
    await page.waitForSelector('.galactic-history-window');
    await page.locator('.galactic-history-tab', { hasText: 'Battle Reports' }).click();
    await page.waitForTimeout(600);
    await shot(page, 'galactic-history-battles');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await page.keyboard.press('o').catch(() => {});
    await page.waitForTimeout(800);
    const imp = page.locator('.ow-glass', { hasText: 'Improvements...' });
    if ((await imp.count()) > 0) {
        await imp.first().click();
        await page.waitForTimeout(800);
        await shot(page, 'game-options-improvements');
    } else console.log('no Improvements... button (Game Options did not open on "o")');
}
await page.close();

// ---- 2. worker mode, from the mid-fight save
const wp = await newPage();
await wp.goto(`${base}?load=${encodeURIComponent('/dev-saves/battlereports-midfight.dwusave')}&simWorker=1`);
await wp.waitForFunction(() => window.__dwu?.game?.playerEmpire !== undefined, null, { timeout: 240000 });
await wp.waitForTimeout(2000);
await wp.evaluate(() => {
    const t = window.__dwu.time;
    t.speed = 4;
    t.paused = false;
});
if (await waitForReport(wp, 'worker')) {
    await wp.waitForTimeout(2500);
    await wp.evaluate(() => void (window.__dwu.time.paused = true));
    await wp.waitForTimeout(800);
    await shot(wp, 'worker-ticker-stub');
    const stub = wp.locator('.message-stub-battle').first();
    if ((await stub.count()) > 0) await stub.click();
    else await wp.evaluate(async () => (await import('/src/ui/screens/battleReport.ts')).openBattleReport((await import('/src/sim/battleReports/battleReports.ts')).battleReports(window.__dwu.game.galaxy)[0]));
    await wp.waitForSelector('[data-ow="battleReport"]');
    await wp.waitForTimeout(800);
    await shot(wp, 'worker-report-window');
}
await browser.close();
console.log(logs.length > 0 ? logs.slice(0, 40).join('\n') : 'no console errors / warnings');
console.log('shots:\n' + shots.join('\n'));
