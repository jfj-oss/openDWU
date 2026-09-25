// 17c captures: the order menu over an enemy colony with a fleet selected, and the selection panel buttons for a
// ship and a colony. Usage: node scripts/ordermenu-shots.mjs <baseUrl> <outDir>
import { chromium } from 'playwright-core';
const [base = 'http://localhost:5173/', outDir = 'shots'] = process.argv.slice(2);
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`${base}?autostart=1`);
await page.waitForFunction(() => window.__dwu?.game?.playerEmpire !== undefined, null, { timeout: 120000 });
await page.waitForTimeout(3000);

// Set up: a player fleet and an explored enemy colony; select the fleet and look at the colony at system zoom.
const pt = await page.evaluate(async () => {
    const dwu = window.__dwu;
    const { galaxy, camera } = dwu;
    const player = galaxy.playerEmpire;
    const exec = await import('/src/sim/player/executeShipAction.ts');
    const sa = await import('/src/sim/player/shipAction.ts');
    const hud = await import('/src/ui/hud.ts');
    const vis = await import('/src/sim/visibility.ts');
    const ships = player.builtObjects.filter((b) => b.role !== 0 && b.builtAt === null && b.topSpeed > 0 && b.firepowerRaw > 0);
    exec.executeShipAction(galaxy, player, ships.slice(0, 2), sa.createShipAction(sa.ShipActionType.CreateNewFleet, null), true);
    const fleet = ships[0].shipGroup;
    const enemy = galaxy.empires.find((e) => e !== player && e.capital !== null && e.pirateEmpireBaseHabitat === null && e !== galaxy.independentEmpire);
    const colony = enemy.capital;
    player.visibility.setSystemVisibility(galaxy.systems[colony.systemIndex].systemStar, vis.SystemVisibilityStatus.Explored);
    hud.selectShipGroup(fleet, false);
    camera.centerOn(colony.xpos, colony.ypos);
    camera.zoomAt(hud.SYSTEM_LEVEL_ZOOM, camera.width / 2, camera.height / 2);
    const s = camera.worldToScreen(colony.xpos, colony.ypos);
    const rect = document.querySelector('canvas').getBoundingClientRect();
    window.__om = { colonyName: colony.name, fleet: fleet.name };
    return { x: rect.left + s.x, y: rect.top + s.y, colony: colony.name, fleet: fleet.name };
});
console.log('setup', JSON.stringify(pt));
await page.waitForTimeout(1500);
await page.mouse.move(pt.x, pt.y);
await page.waitForTimeout(400);
await page.keyboard.down('Control');
await page.mouse.down({ button: 'right' });
await page.mouse.up({ button: 'right' });
await page.keyboard.up('Control');
await page.waitForTimeout(500);
const rows = await page.evaluate(() => Array.from(document.querySelectorAll('.order-menu-item')).map((r) => r.textContent));
console.log('menu', JSON.stringify(rows));
// Open the Refuel sub-menu for the capture.
const refuel = page.locator('.order-menu-item', { hasText: 'Refuel all ships' });
if ((await refuel.count()) > 0) await refuel.first().hover();
await page.waitForTimeout(400);
await page.screenshot({ path: `${outDir}/ordermenu-fleet-enemy-colony.png` });
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');

// Selection panel buttons: a ship, then the player's capital.
await page.evaluate(async () => {
    const { galaxy, camera } = window.__dwu;
    const player = galaxy.playerEmpire;
    const hud = await import('/src/ui/hud.ts');
    const ship = player.builtObjects.find((b) => b.role !== 0 && b.builtAt === null && b.topSpeed > 0 && b.firepowerRaw > 0 && b.shipGroup === null) ?? player.builtObjects.find((b) => b.topSpeed > 0);
    hud.selectStellarObject(ship, false);
    camera.centerOn(ship.xpos, ship.ypos);
    camera.zoomAt(hud.SYSTEM_LEVEL_ZOOM, camera.width / 2, camera.height / 2);
});
await page.waitForTimeout(1200);
const shipBtns = await page.evaluate(() => Array.from(document.querySelectorAll('.order-action-btn')).map((b) => `${b.textContent}${b.disabled ? ' [off]' : ''} | ${b.title}`));
console.log('ship buttons', JSON.stringify(shipBtns));
await page.screenshot({ path: `${outDir}/ordermenu-selection-ship.png` });
await page.evaluate(async () => {
    const { galaxy, camera } = window.__dwu;
    const hud = await import('/src/ui/hud.ts');
    const cap = galaxy.playerEmpire.capital;
    hud.selectStellarObject(cap, false);
    camera.centerOn(cap.xpos, cap.ypos);
    camera.zoomAt(hud.SYSTEM_LEVEL_ZOOM, camera.width / 2, camera.height / 2);
});
await page.waitForTimeout(1200);
const colBtns = await page.evaluate(() => Array.from(document.querySelectorAll('.order-action-btn')).map((b) => `${b.textContent}${b.disabled ? ' [off]' : ''} | ${b.title}`));
console.log('colony buttons', JSON.stringify(colBtns));
await page.screenshot({ path: `${outDir}/ordermenu-selection-colony.png` });
await browser.close();
for (const l of logs) console.log(l);
