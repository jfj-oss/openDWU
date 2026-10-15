// Mothballing captures (scenarios/mothballing): boots ?autostart=1&scenario=mothballing&simWorker=0, gives the player
// ~20 warships of mixed sizes (its own plus AI empires' escorts .. capital ships, TakeOwnershipOfBuiltObject), forms one
// fleet of five, puts everything into reserve at one space port (the parking rings), then shoots the port zoomed in and
// wider, the Fleets screen with the reserve fleet selected and the Ships and Bases screen on its In Reserve filter.
// Usage: node scripts/mothball-shots.mjs <baseUrl> <outDir> [w] [h]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const [base = 'http://localhost:5173/', outDir = 'shots/mothball', w = '1920', h = '1080'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
    args: ['--use-gl=angle', '--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu'],
});
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const logs = [];
page.on('console', (m) => { if (m.text().startsWith('DBG3')) console.log(m.text());
    if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`${base}?autostart=1&scenario=mothballing&simWorker=0`);
await page.waitForFunction(() => window.__dwu?.game?.playerEmpire !== undefined, null, { timeout: 240000 });
await page.waitForTimeout(3000);
const info = await page.evaluate(async () => {
    const dwu = window.__dwu;
    const { game, camera } = dwu;
    const g = game.galaxy;
    const p = game.playerEmpire;
    const mb = await import('/src/sim/scenario/mothballing/mothballing.ts');
    const { executeShipAction } = await import('/src/sim/player/executeShipAction.ts');
    const { ShipActionType, createShipAction } = await import('/src/sim/player/shipAction.ts');
    (await import('/src/sim/readOnlyQuery.ts')).markUiGalaxy(g, false); // the script writes the galaxy directly
    g.scenario.params.mothballPortCapacity = 40;
    const port = p.spacePorts.find((x) => x && !x.hasBeenDestroyed);
    if (!port) return { ok: false, why: 'no port' };
    // Warships by sub-role: Escort 1, Frigate 2, Destroyer 3, Cruiser 4, CapitalShip 5 (BuiltObjectSubRole): new ships
    // of the biggest design of each class any empire has (dietEnforcers.ts placeShip), at the port's planet.
    const { BuiltObject } = await import('/src/sim/builtObject.ts');
    const want = { 1: 5, 2: 5, 3: 4, 4: 3, 5: 3 };
    const world = port.parentHabitat ?? p.capital;
    const picked = [];
    for (const sr of [1, 2, 3, 4, 5]) {
        const designs = [];
        for (const e of [p, ...g.empires.filter((x) => x && x !== p)]) for (const d of e.designs ?? []) if (d && d.subRole === sr) designs.push(d);
        designs.sort((a, b) => b.size - a.size);
        const design = designs.find((d) => p.designs.includes(d)) ?? designs[0];
        if (!design) continue;
        for (let i = 0; i < want[sr]; i++) {
            design.buildCount++;
            const bo = new BuiltObject(design, g.generateBuiltObjectName(design, world), g, true);
            bo.empire = p;
            bo.purchasePrice = design.calculateCurrentPurchasePrice(g);
            bo.reDefine();
            bo.currentFuel = bo.fuelCapacity;
            bo.nearestSystemStar = g.determineHabitatSystemStar(world);
            p.addBuiltObjectToGalaxy(bo, world, false, true, Math.trunc(port.xpos - world.xpos + 400), Math.trunc(port.ypos - world.ypos + 400), false);
            bo.xpos = port.xpos + 400;
            bo.ypos = port.ypos + 400;
            picked.push(bo);
        }
    }
    // One fleet of five mixed ships (one of each size class), the rest as lone warships.
    const fleetShips = [1, 2, 3, 4, 5].map((sr) => picked.find((b) => b.subRole === sr)).filter((b) => b);
    const fleet = executeShipAction(g, p, fleetShips, createShipAction(ShipActionType.CreateNewFleet, null), true).select;
    const results = [];
    if (fleet) results.push(mb.issueMothball(g, p, fleet, port).message);
    for (const b of picked) if (b.shipGroup === null) { results.push(mb.issueMothball(g, p, b, port).message); console.log('DBG3 issue ' + b.mothball?.phase + ' slot ' + b.mothball?.slot + ' reg ' + mb.peekMothballState(g)?.ships.length); }
    if (dwu.time) { dwu.time.speed = 4; dwu.time.paused = false; }
    window.__port = port; window.__picked = picked; window.__mb = mb;
    camera.zoom = camera.clampZoom(1);
    camera.centerOn(port.xpos, port.ypos);
    return { ok: true, port: port.name, portSize: port.size, ships: picked.length, sizes: picked.map((b) => b.size), fleet: fleet?.name, inReserve: picked.filter((b) => b.mothball?.phase === 1).length, results: results.slice(0, 3) };
});
console.log('setup', JSON.stringify(info));
// Run until every ship has arrived and parked (or 4 minutes), then pause and measure the formation.
for (let i = 0; i < 240; i++) {
    const n = await page.evaluate(() => { const s = window.__dwu.game.galaxy; const mb = window.__mbState?.(); return mb ?? -1; }).catch(() => -1);
    const done = await page.evaluate(async () => {
        return window.__picked.every((b) => b.mothball && b.mothball.phase === 1 && b.mothball.slot !== undefined);
    });
    if (done) break;
    await page.waitForTimeout(1000);
}
await page.evaluate(() => { window.__dwu.time.paused = true; });
await page.waitForTimeout(500);
const form = await page.evaluate(async () => {
    const mb = window.__mb;
    const g = window.__dwu.game.galaxy, port = window.__port;
    const all = window.__picked; console.log('DBG2', window.__picked.map((b) => (b.mothball ? b.mothball.phase : 'x') + (b.hasBeenDestroyed ? 'D' : '')).join(',')); console.log('DBG', JSON.stringify(Object.keys(g.scenario.state||{})), all.length, all.filter((b) => b.mothball && b.mothball.port === port).length);
    const ships = all.filter((b) => b.mothball && b.mothball.port === port);
    const layer = window.__dwuShipLayer, zz = window.__dwu.camera.zoom;
    const planet = port.parentHabitat;
    const rings = new Map();
    let minGap = Infinity, worstHead = 0, planetClear = Infinity, portClear = Infinity;
    for (const b of ships) {
        const dx = b.xpos - port.xpos, dy = b.ypos - port.ypos, r = Math.hypot(dx, dy);
        const pt = { ring: Math.round(r / 50) };
        (rings.get(pt.ring) ?? rings.set(pt.ring, []).get(pt.ring)).push({ a: Math.atan2(dy, dx), r });
        const bearing = Math.atan2(-dy, -dx);
        let e = Math.abs(b.heading - bearing); if (e > Math.PI) e = 2 * Math.PI - e;
        worstHead = Math.max(worstHead, e);
        if (planet) planetClear = Math.min(planetClear, Math.hypot(b.xpos - planet.xpos, b.ypos - planet.ypos) - planet.diameter / 2 - layer.drawnSizePx(b) / zz / 2);
        portClear = Math.min(portClear, r - layer.drawnSizePx(port) / zz / 2 - layer.drawnSizePx(b) / zz / 2);
        for (const c of ships) if (c !== b) minGap = Math.min(minGap, Math.hypot(b.xpos - c.xpos, b.ypos - c.ypos) - (layer.drawnSizePx(b) + layer.drawnSizePx(c)) / zz / 2);
    }
    console.log('DBG3 planet ' + JSON.stringify([planet && planet.diameter, planet && Math.round(Math.hypot(planet.xpos - port.xpos, planet.ypos - port.ypos)), port.size, layer.drawnSizePx(port) / zz, zz]));
    console.log('DBG3 side ' + JSON.stringify(ships.map((b) => [b.size, Math.round(layer.drawnSizePx(b) / zz)])));
    console.log('DBG3 ' + JSON.stringify(ships.map((b) => [b.mothball.slot, b.subRole, Math.round(Math.hypot(b.xpos - port.xpos, b.ypos - port.ypos)), Math.round(Math.atan2(b.ypos - port.ypos, b.xpos - port.xpos) * 573) / 10, Math.round(layer.drawnSizePx(b) / zz)])));
    const out = [];
    for (const [k, v] of rings) {
        v.sort((x, y) => x.a - y.a);
        const rs = v.map((q) => q.r), mean = rs.reduce((x, y) => x + y, 0) / rs.length;
        const gaps = v.map((q, i) => (((v[(i + 1) % v.length].a - q.a) + 2 * Math.PI) % (2 * Math.PI)));
        out.push({ ring: k, n: v.length, radius: Math.round(mean), radDev: +Math.max(...rs.map((r) => Math.abs(r - mean))).toFixed(3), angStepDeg: v.length > 1 ? +(Math.min(...gaps) * 57.2958).toFixed(2) : 0, angStepMaxDeg: v.length > 1 ? +(Math.max(...gaps) * 57.2958).toFixed(2) : 0 });
    }
    return { ships: ships.length, inReserve: ships.filter((b) => b.mothball.phase === 1).length, rings: out, minClearanceBetweenHulls: +minGap.toFixed(1), clearanceToPlanetDisc: +planetClear.toFixed(1), clearanceToPortSprite: +portClear.toFixed(1), worstHeadingErrDeg: +(worstHead * 57.2958).toFixed(3), sizes: [...new Set(ships.map((b) => b.subRole))] };
});
console.log('formation', JSON.stringify(form));
const shot = async (zoom, name) => {
    await page.evaluate((z) => {
        const { camera } = window.__dwu;
        camera.zoom = camera.clampZoom(z);
        camera.centerOn(window.__port.xpos, window.__port.ypos);
    }, zoom);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${outDir}/${name}.png` });
};
await shot(1.0, 'rings-port');
await shot(0.4, 'rings-wide');
// Fleets screen: the reserve fleet selected (Mission "Reserve (<port>)", the Reactivate button in the orders row).
await page.click('[data-hud="tbtnShipGroups"]');
await page.waitForSelector('[data-ow="fleets"] .ow-grid');
await page.waitForTimeout(800);
const frow = page.locator('[data-ow="fleets"] .ow-grid-row', { hasText: 'Reserve' }).first();
if (await frow.count()) await frow.click();
await page.waitForTimeout(1000);
await page.screenshot({ path: `${outDir}/fleets-screen.png` });
console.log('fleets row:', (await frow.count()) ? (await frow.innerText()).replace(/\s+/g, ' ') : '(none)');
console.log('fleets buttons:', (await page.locator('[data-ow="fleets"] .fl-order').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ')).join(' | '));
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
// Ships and Bases screen: In Reserve filter, one row selected.
await page.keyboard.press('F11');
await page.waitForSelector('[data-ow="ships"] .ow-grid-row');
await page.waitForTimeout(800);
const sel = page.locator('[data-ow="ships"] select').first();
if (await sel.count()) await sel.selectOption({ label: 'In Reserve (mothballed)' }).catch(() => {});
await page.waitForTimeout(800);
const srow = page.locator('[data-ow="ships"] .ships-grid .ow-grid-row').first();
if (await srow.count()) await srow.click();
await page.waitForTimeout(1000);
await page.screenshot({ path: `${outDir}/ships-screen.png` });
console.log('ships rows:', await page.locator('[data-ow="ships"] .ships-grid .ow-grid-row').count(), (await srow.count()) ? (await srow.innerText()).replace(/\s+/g, ' ') : '(none)');
console.log('ships buttons:', (await page.locator('[data-ow="ships"] .ow-glass').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ')).join(' | '));
console.log(logs.length ? logs.join('\n') : 'no console errors');
await browser.close();
