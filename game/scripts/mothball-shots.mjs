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
page.on('console', (m) => {
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
    for (const b of picked) if (b.shipGroup === null) results.push(mb.issueMothball(g, p, b, port).message);
    if (dwu.time) dwu.time.paused = true;
    window.__port = port;
    camera.zoom = camera.clampZoom(1);
    camera.centerOn(port.xpos, port.ypos);
    return { ok: true, port: port.name, portSize: port.size, ships: picked.length, sizes: picked.map((b) => b.size), fleet: fleet?.name, inReserve: picked.filter((b) => b.mothball?.phase === 1).length, results: results.slice(0, 3) };
});
console.log('setup', JSON.stringify(info));
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
