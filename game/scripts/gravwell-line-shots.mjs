// Gravity-well travel line captures: turns on the Bacon useStarGravityWells setting (the journaled setBaconSettings
// command), orders a player warp ship sitting inside its star's gravity well to a destination in another system,
// selects it at system zoom and traces the selected ship's yellow travel vector every frame (ship position, current
// command, arrowhead end, the line's world bounds), with start / end screenshots. In-thread (simWorker 0) the ship is
// first moved to 88% of its well's radius so the exit, the jump and the arrival all fall inside the trace.
// Modes: point (empty space beside a far star, default), star (the far star), reorder (a second order 4 s in),
// fleet (two player warships in a new fleet; needs warships), click (a real right click; experimental).
// Usage: node scripts/gravwell-line-shots.mjs <baseUrl> <outDir> [simWorker 0|1] [tag] [mode]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const [base = 'http://localhost:5173/', outDir = 'shots/gravwell-line', worker = '0', tag = 'run', mode = 'point'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const logs = [];
page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`${base}?autostart=1&simWorker=${worker}`);
await page.waitForFunction(() => window.__dwu?.game?.playerEmpire !== undefined, null, { timeout: 240000 });
await page.waitForTimeout(3000);
const name = (s) => `${outDir}/${s}-${mode}-w${worker}-${tag}.png`;
try {
    await page.evaluate(async () => {
        const { galaxy } = window.__dwu;
        const pc = await import('/src/sim/player/playerCommands.ts');
        await new Promise((res) => pc.issuePlayerCommand(galaxy, galaxy.playerEmpire, 'setBaconSettings', [{ useStarGravityWells: true }], res, res));
    });
    await page.waitForTimeout(500);
    const setup = await page.evaluate(async (mode) => {
        const { galaxy, camera } = window.__dwu;
        const player = galaxy.playerEmpire;
        const pc = await import('/src/sim/player/playerCommands.ts');
        const sa = await import('/src/sim/player/shipAction.ts');
        const ms = await import('/src/sim/missions/mission.ts');
        const hud = await import('/src/ui/hud.ts');
        const mv = await import('/src/sim/movement.ts');
        const exec = await import('/src/sim/player/executeShipAction.ts');
        let ships = player.builtObjects.filter((b) => b.role !== 0 && b.builtAt === null && b.topSpeed > 0 && b.warpSpeed > 0 && b.nearestSystemStar !== null && b.shipGroup === null && b.subRole !== undefined && !String(b.name).startsWith('ATS') && !mv.isOutsideStarGravityWell(galaxy, b));
        let fleet = null;
        if (mode === 'fleet') {
            // Player warships (in or out of fleets) inside a well: put two of them in a new fleet.
            const war = player.builtObjects.filter((b) => b.role !== 0 && !String(b.name).startsWith('AT') && b.builtAt === null && b.topSpeed > 0 && b.warpSpeed > 0 && b.firepowerRaw > 0);
            window.__warN = war.map((b) => `${b.name}:${b.role}:${b.shipGroup?.name ?? '-'}:${Math.round(b.xpos)},${Math.round(b.ypos)}`);
            if (war.length < 2) return { err: 'no warships', n: war.length, war: window.__warN };
            await new Promise((res) => pc.issuePlayerCommand(galaxy, player, 'shipAction', [war.slice(0, 2), sa.createShipAction(sa.ShipActionType.CreateNewFleet, null), true], res, res));
            fleet = war[0].shipGroup;
            ships = [fleet.leadShip ?? war[0]];
            window.__fleetInfo = war.slice(0, 2).map((b) => `${b.name} r${b.role}`);
        }
        if (mode !== 'fleet') ships.sort((a, b) => b.cruiseSpeed - a.cruiseSpeed);
        const ship = ships[0];
        if (ship === undefined) return { err: 'no ship in a well', useWells: mv.baconMovementSettings.useStarGravityWells };
        const here = ship.nearestSystemStar;
        const far = galaxy.systems.map((s) => s.systemStar).filter((s) => s !== null && s !== here).sort((a, b) => Math.hypot(a.xpos - here.xpos, a.ypos - here.ypos) - Math.hypot(b.xpos - here.xpos, b.ypos - here.ypos))[2];
        // mode 'point': an empty-space point beside the far star (no target); 'star': the far star itself.
        const px = Math.trunc(far.xpos + 40000);
        const py = Math.trunc(far.ypos - 30000);
        const action = mode === 'star' || mode === 'fleetstar' ? sa.createMissionShipActionAt(ms.BuiltObjectMissionType.Move, far, Math.trunc(far.xpos), Math.trunc(far.ypos)) : sa.createMissionShipActionAt(ms.BuiltObjectMissionType.Move, null, px, py);
        if (location.search.includes('simWorker=0') && mode !== 'click' && mode !== 'reorder') {
            // In-thread only: start the ship near its well's edge (88% of the radius, same bearing) so the sublight leg,
            // the well exit and the jump all happen within the trace.
            const r = mv.calculateGravityWellSize(ship);
            const a = Math.atan2(ship.ypos - here.ypos, ship.xpos - here.xpos);
            ship.xpos = here.xpos + Math.cos(a) * r * 0.88;
            ship.ypos = here.ypos + Math.sin(a) * r * 0.88;
            ship.parentHabitat = null;
        }
        if (mode === 'fleet') {
            await new Promise((res) => pc.issuePlayerCommand(galaxy, player, 'shipAction', [fleet, action, false], res, res));
            hud.selectShipGroup(fleet, false);
        } else {
            if (mode !== 'click') await new Promise((res) => pc.issuePlayerCommand(galaxy, player, 'shipAction', [ship, action, false], res, res));
            hud.selectStellarObject(ship, false);
        }
        camera.centerOn(ship.xpos, ship.ypos);
        camera.zoomAt(hud.SYSTEM_LEVEL_ZOOM, camera.width / 2, camera.height / 2);
        window.__gw = ship;
        if (mode === 'reorder') {
            // A second order to another empty-space point beside a different far star, given once the first has the ship
            // preparing its jump inside the well.
            const far2 = galaxy.systems.map((s) => s.systemStar).filter((s) => s !== null && s !== here && s !== far).sort((a, b) => Math.hypot(a.xpos - here.xpos, a.ypos - here.ypos) - Math.hypot(b.xpos - here.xpos, b.ypos - here.ypos))[4];
            window.__reorder = async () => {
                const a2 = sa.createMissionShipActionAt(ms.BuiltObjectMissionType.Move, null, Math.trunc(far2.xpos + 30000), Math.trunc(far2.ypos + 20000));
                await new Promise((res) => pc.issuePlayerCommand(galaxy, player, 'shipAction', [ship, a2, false], res, res));
            };
        }
        if (mode === 'click') {
            // Zoom out to show both, and give the screen point of the empty-space destination for a real right click.
            camera.centerOn((ship.xpos + px) / 2, (ship.ypos + py) / 2);
            camera.zoomAt(1 / 400, camera.width / 2, camera.height / 2);
            const sp = camera.worldToScreen(px, py);
            const rect = document.querySelector('canvas').getBoundingClientRect();
            window.__click = { x: rect.left + sp.x, y: rect.top + sp.y };
        }
        window.__dwu.time.paused = false;
        window.__dwu.time.speed = 4;
        return { fleetInfo: window.__fleetInfo ?? null, ship: ship.name, cruise: ship.cruiseSpeed, role: ship.role, parent: ship.parentHabitat?.name ?? null, n: ships.length, star: here.name, ship0: [ship.xpos, ship.ypos], starPos: [here.xpos, here.ypos], target: far.name, targetPos: [far.xpos, far.ypos], useWells: mv.baconMovementSettings.useStarGravityWells, mode };
    }, mode);
    console.log('setup', JSON.stringify(setup));
    if (mode === 'click') {
        await page.waitForTimeout(800);
        const c = await page.evaluate(() => window.__click);
        await page.mouse.move(c.x, c.y);
        await page.waitForTimeout(300);
        await page.mouse.down({ button: 'right' });
        await page.mouse.up({ button: 'right' });
        await page.waitForTimeout(800);
        console.log('clicked', JSON.stringify(c), await page.evaluate(() => { const m = window.__gw.mission; return m ? `mission ${m.type} target=${m.target?.name ?? null} xy=${m.x},${m.y}` : 'no mission'; }));
        await page.evaluate(async () => {
            const hud = await import('/src/ui/hud.ts');
            const { camera } = window.__dwu;
            camera.centerOn(window.__gw.xpos, window.__gw.ypos);
            camera.zoomAt(hud.SYSTEM_LEVEL_ZOOM, camera.width / 2, camera.height / 2);
        });
    }
    await page.waitForTimeout(1200);
    await page.evaluate(() => window.__dwu.camera.centerOn(window.__gw.xpos, window.__gw.ypos));
    await page.waitForTimeout(100);
    await page.screenshot({ path: name('gravwell-line-start') });
    console.log(`saved ${name('gravwell-line-start')}`);
    // Dense trace: every animation frame for ~25 s, logging each frame where the command or the vector end changes, and
    // the vector end's screen position relative to the ship's.
    const trace = await page.evaluate(async () => {
        const { camera, view } = window.__dwu;
        const ship = window.__gw;
        const ol = view.overlayLayer;
        const out = [];
        let last = '';
        const t0 = performance.now();
        let frames = 0;
        let reordered = false;
        while (performance.now() - t0 < 60000) {
            if (!reordered && window.__reorder !== undefined && performance.now() - t0 > 4000) {
                reordered = true;
                await window.__reorder();
                out.push({ reorder: Math.round(performance.now() - t0) });
            }
            await new Promise((r) => requestAnimationFrame(r));
            frames++;
            camera.centerOn(ship.xpos, ship.ypos);
            const c = ship.mission?.fastPeekCurrentCommand?.() ?? null;
            const arrow = ol.selArrow;
            const vis = ol.selVector.visible && arrow?.visible;
            const d = ol.drawnPos(ship);
            const ds = camera.worldToScreen(d.x, d.y);
            const es = vis ? camera.worldToScreen(arrow.position.x, arrow.position.y) : null;
            const cmd = c ? `${c.action}@${Math.round(c.xpos)},${Math.round(c.ypos)}` : 'none';
            const b = vis ? ol.selVector.getLocalBounds() : null;
            const gp = ol.selVector.position;
            const bb = b ? [Math.round(b.minX + gp.x), Math.round(b.minY + gp.y), Math.round(b.maxX + gp.x), Math.round(b.maxY + gp.y)] : null;
            const key = `${cmd}|${vis ? `${Math.round(arrow.position.x / 50)},${Math.round(arrow.position.y / 50)}` : '-'}`;
            if (key !== last || frames % 40 === 0) {
                last = key;
                out.push({ t: Math.round(performance.now() - t0), f: frames, pos: [Math.round(ship.xpos), Math.round(ship.ypos)], spd: Math.round(ship.currentSpeed), prep: ship.hyperjumpPrepare, cmd, end: vis ? [Math.round(arrow.position.x), Math.round(arrow.position.y)] : null, endRel: es ? [Math.round(es.x - ds.x), Math.round(es.y - ds.y)] : null, bb });
                if (out.length > 300) break;
            }
        }
        return { frames, out };
    });
    console.log('frames', trace.frames);
    for (const r of trace.out) console.log(JSON.stringify(r));
    await page.screenshot({ path: name('gravwell-line-end') });
    console.log(`saved ${name('gravwell-line-end')}`);
} finally {
    for (const l of logs.slice(0, 20)) console.log(l);
    await browser.close();
}
