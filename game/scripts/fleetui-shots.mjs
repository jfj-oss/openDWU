// Queued-orders path + fleet-member highlight captures (worker mode, seed game).
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const [base = 'http://localhost:5185/', outDir = 'shots/fleet-ui'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`${base}?autostart=1`);
await page.waitForFunction(() => window.__dwu?.game?.playerEmpire != null && window.__dwu?.view != null, null, { timeout: 300000 });
await page.waitForTimeout(3000);
console.log('worker mode:', await page.evaluate(() => window.__dwu.simWorker != null));
await page.evaluate(() => { window.__dwu.time.paused = true; });

// Pick a ship with a hyperdrive and three destinations in nearby systems.
const info = await page.evaluate(async () => {
    const hud = await import('/src/ui/hud.ts');
    const om = await import('/src/ui/orderMenu.ts');
    const d = window.__dwu;
    const p = d.game.playerEmpire;
    const g = d.galaxy;
    const ship = p.builtObjects.find((b) => b && b.role !== 0 && b.shipGroup == null && b.warpSpeed > 0 && b.topSpeed > 0 && b.builtAt === null) ?? p.builtObjects.find((b) => b && b.warpSpeed > 0 && b.topSpeed > 0);
    if (!ship) return { err: 'no ship' };
    hud.selectStellarObject(ship, false);
    await new Promise((r) => setTimeout(r, 800));
    const cap = p.capital;
    const stars = g.systems.map((s) => s.systemStar).filter((s) => s && s.systemIndex !== cap.systemIndex)
        .sort((a, b) => Math.hypot(a.xpos - cap.xpos, a.ypos - cap.ypos) - Math.hypot(b.xpos - cap.xpos, b.ypos - cap.ypos)).slice(0, 3);
    for (let i = 0; i < stars.length; i++) {
        const a = d.commands.moveOrder(stars[i]);
        if (i > 0) a.isSubsequentAction = true;
        await om.performAction(a, true);
        await new Promise((r) => setTimeout(r, 800));
    }
    const xs = [ship.xpos, ...stars.map((s) => s.xpos)];
    const ys = [ship.ypos, ...stars.map((s) => s.ypos)];
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1);
    d.camera.centerOn(cx, cy);
    d.camera.zoom = d.camera.clampZoom(700 / span);
    return { ship: ship.name, stars: stars.map((s) => s.name) };
});
console.log('queue:', JSON.stringify(info));
await page.waitForTimeout(2500);
const panel = await page.evaluate(() => document.body.innerText.split('\n').filter((l) => l.startsWith('Then:')).join(' | '));
console.log('panel:', panel);
const queued = await page.evaluate(() => { const s = window.__dwu.game.playerEmpire.builtObjects.find((b) => b && b.subsequentMissions?.length > 0); return s ? `${s.name}: ${s.subsequentMissions.length} queued on the replica` : 'none queued on the replica'; });
console.log(queued);
console.log('path key:', await page.evaluate(() => JSON.stringify(window.__dwu.view.selectionPaths.pathKey)));
await page.screenshot({ path: `${outDir}/queued-orders.png` });

// A scattered fleet: form one from the player's military ships, send half of them off one by one, run a while.
const f = await page.evaluate(async () => {
    const { issuePlayerCommand } = await import('/src/sim/player/playerCommands.ts');
    const hud = await import('/src/ui/hud.ts');
    const om = await import('/src/ui/orderMenu.ts');
    const d = window.__dwu;
    const p = d.game.playerEmpire;
    const g = d.galaxy;
    let mil = p.builtObjects.filter((b) => b && b.role === 1 && b.warpSpeed > 0);
    if (mil.length < 3) mil = p.builtObjects.filter((b) => b && b.warpSpeed > 0 && b.topSpeed > 0 && b.role !== 0).slice(0, 6);
    await new Promise((r) => issuePlayerCommand(g, p, 'setShipsFleet', [mil, 'new'], r));
    await new Promise((r) => setTimeout(r, 1500));
    const cap = p.capital;
    const stars = g.systems.map((s) => s.systemStar).filter((s) => s && s.systemIndex !== cap.systemIndex)
        .sort((a, b) => Math.hypot(a.xpos - cap.xpos, a.ypos - cap.ypos) - Math.hypot(b.xpos - cap.xpos, b.ypos - cap.ypos)).slice(0, 4);
    const sent = [];
    for (let i = 1; i < mil.length && sent.length < 4; i++) {
        hud.selectStellarObject(mil[i], false);
        await new Promise((r) => setTimeout(r, 200));
        await om.performAction(d.commands.moveOrder(stars[sent.length % stars.length]), true);
        sent.push(mil[i].name);
        await new Promise((r) => setTimeout(r, 300));
    }
    return { members: mil.length, sent };
});
console.log('fleet:', JSON.stringify(f));
await page.evaluate(() => { window.__dwu.time.speed = 8; window.__dwu.time.paused = false; });
await page.waitForTimeout(12000);
await page.evaluate(async () => {
    const hud = await import('/src/ui/hud.ts');
    const d = window.__dwu;
    d.time.paused = true;
    const p = d.game.playerEmpire;
    const sg = (p.shipGroups ?? []).filter((x) => x && x.ships.length > 1).sort((a, b) => b.ships.length - a.ships.length)[0];
    if (!sg) return;
    hud.selectShipGroup(sg, false);
    const xs = sg.ships.map((s) => s.xpos);
    const ys = sg.ships.map((s) => s.ypos);
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1);
    d.camera.centerOn((Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2);
    d.camera.zoom = d.camera.clampZoom(600 / span);
});
await page.waitForTimeout(2500);
console.log('fleet key:', await page.evaluate(() => JSON.stringify(window.__dwu.view.selectionPaths.fleetKey)));
await page.screenshot({ path: `${outDir}/fleet-scattered.png` });
// Same fleet at close (system) zoom on its lead.
await page.evaluate(() => { const d = window.__dwu; const sg = (d.game.playerEmpire.shipGroups ?? []).filter((x) => x && x.ships.length > 1).sort((a, b) => b.ships.length - a.ships.length)[0]; if (sg?.leadShip) { d.camera.centerOn(sg.leadShip.xpos, sg.leadShip.ypos); d.camera.zoom = d.camera.clampZoom(1 / 60); } });
await page.waitForTimeout(2000);
console.log('fleet key (close):', await page.evaluate(() => JSON.stringify(window.__dwu.view.selectionPaths.fleetKey)));
await page.screenshot({ path: `${outDir}/fleet-close.png` });
console.log(logs.length ? logs.join('\n') : 'no console errors');
await browser.close();
