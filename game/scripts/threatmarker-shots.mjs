// Threat-site marker captures in a real game (artBundleLayer updateThreats / threatMarkers.ts drawThreatMarker): every
// marker kind on the planets of the player's home system (suspected and confirmed), a sleeper ship, the Compact's
// emblem over a big world; close planet zoom (z = 1), mid (system) and far zoom. Each kind is drawn at its real galaxy
// coordinates, so a precision or tessellation problem at large world coordinates shows.
// Usage: node scripts/threatmarker-shots.mjs [base=http://localhost:5173/] [outDir=shots] [prefix=]
// Headless Chromium on the GPU (ANGLE / Vulkan), never SwiftShader.
import { chromium } from 'playwright-core';
const [base = 'http://localhost:5173/', outDir = 'shots', prefix = ''] = process.argv.slice(2);
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
    args: ['--use-gl=angle', '--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`${base}?autostart=1&scenario=threat-framework&simWorker=0&reveal=1&stars=300&seed=3`);
await page.waitForFunction(() => window.__dwu?.game?.playerEmpire !== undefined, null, { timeout: 240000 });
await page.waitForTimeout(3000);

const setup = await page.evaluate(async () => {
    const { galaxy, game } = window.__dwu;
    window.__dwu.time.paused = true;
    const abl = await import('/src/render/artBundleLayer.ts');
    const emp = game.playerEmpire;
    const home = emp.capital ?? galaxy.habitats.find((h) => h.owner === emp);
    const sys = galaxy.habitats.filter((h) => h.category === 1 && h.systemIndex === home.systemIndex);
    const big = [...sys].sort((a, b) => b.diameter - a.diameter);
    const pick = (i) => big[i % big.length];
    const ship = galaxy.builtObjects.find((b) => b.empire === emp && b.role !== 8) ?? galaxy.builtObjects[0];
    const rows = [
        { threat: 'darkFarms', kind: 'colony', target: pick(0), level: 2, label: '' },
        { threat: 'giantworksCompact', kind: 'colony', target: pick(0), level: 2, label: '' },
        { threat: 'darkFarms', kind: 'colony', target: pick(1), level: 3, label: '' },
        { threat: 'giantworksCompact', kind: 'colony', target: pick(1), level: 1, label: '' },
        { threat: 'cult', kind: 'colony', target: pick(2), level: 2, label: '' },
        { threat: 'hive', kind: 'colony', target: pick(3), level: 3, label: '' },
        { threat: 'greyTide', kind: 'colony', target: pick(4), level: 2, label: '' },
        { threat: 'silence', kind: 'colony', target: pick(5), level: 3, label: '' },
        { threat: 'exchange', kind: 'colony', target: pick(6), level: 2, label: '' },
        { threat: 'unknownThreat', kind: 'colony', target: pick(7), level: 3, label: '' },
        { threat: 'doppelgangers', kind: 'ship', target: ship, level: 2, label: '' },
    ];
    abl.setThreatSitesSource(() => rows);
    return {
        home: { x: home.xpos, y: home.ypos },
        planets: big.slice(0, 8).map((h) => ({ x: h.xpos, y: h.ypos, d: h.diameter, name: h.name })),
        ship: ship !== undefined ? { x: ship.xpos, y: ship.ypos } : null,
        star: galaxy.habitats.find((h) => h.category === 0 && h.systemIndex === home.systemIndex) ?? null,
    };
});
console.log('setup', JSON.stringify({ home: setup.home, planets: setup.planets, ship: setup.ship }));

async function shot(file, z, x, y, wait = 1500) {
    await page.evaluate(([z, x, y]) => {
        const { camera } = window.__dwu;
        camera.zoomAt(z, camera.width / 2, camera.height / 2);
        camera.centerOn(x, y);
    }, [z, x, y]);
    await page.waitForTimeout(wait);
    await page.screenshot({ path: `${outDir}/${prefix}${file}` });
    console.log(`saved ${outDir}/${prefix}${file}`);
}

const [p0, p1] = setup.planets;
await shot('close-p0.png', 1, p0.x, p0.y);
await shot('close-p0-b.png', 1, p0.x, p0.y, 400); // a second frame (pulse / flicker phase)
await shot('close-p1.png', 1, p1.x, p1.y);
for (let i = 2; i < setup.planets.length; i++) await shot(`close-p${i}.png`, 1, setup.planets[i].x, setup.planets[i].y);
if (setup.ship !== null) await shot('close-ship.png', 1, setup.ship.x, setup.ship.y);
await shot('mid-p0.png', 0.35, p0.x, p0.y);
await shot('system.png', 0.04, setup.home.x, setup.home.y);
await shot('far.png', 0.006, setup.home.x, setup.home.y);
// The Beacon: its worlds get no map marker (a Reclaimer-held world and a harvest core row on the home planet), and a
// Watcher's diamond shows only while the viewer sees it: A (beside home, uncloaked, seen) has one, B (beside home, cloaked,
// undetected) and C (an alien ship left where it is, in the fog) none.
const bc = await page.evaluate(async () => {
    const { galaxy, game } = window.__dwu;
    const abl = await import('/src/render/artBundleLayer.ts');
    const emp = game.playerEmpire;
    const home = emp.capital ?? galaxy.habitats.find((h) => h.owner === emp);
    const alien = galaxy.builtObjects.filter((b) => b.empire !== null && b.empire !== emp && !b.hasBeenDestroyed && b.role !== 8);
    const far = alien.filter((b) => galaxy.calculateDistance(b.xpos, b.ypos, home.xpos, home.ypos) > 2e6);
    if (alien.length < 3 || far.length < 1) return { err: 'not enough alien ships' };
    // A: one of the viewer's own ships (always seen; a moved alien ship's fog answer is stale while the clock is paused)
    const a = galaxy.builtObjects.find((x) => x.empire === emp && x.role !== 8 && !x.hasBeenDestroyed);
    const b = alien.find((x) => !far.includes(x)) ?? alien[1];
    const c = far[0];
    for (const [s, dx] of [[a, 2200], [b, -2200]]) {
        s.xpos = home.xpos + dx;
        s.ypos = home.ypos + 900;
        s.targetX = s.xpos;
        s.targetY = s.ypos;
        s.currentSpeed = 0;
    }
    b.cloaked = true;
    const rec = (ship) => ({ ship, mode: 'travel', knowledge: [], dead: false });
    galaxy.scenario.state.beacon = { faction: b.empire, watchers: [rec(a), rec(b), rec(c)], beacon: null, corrupted: [], season: null, processing: [], phase: 'watch', stats: {} };
    abl.setThreatSitesSource(() => [
        { threat: 'beacon', kind: 'colony', target: home, level: 3, label: '' },
        ...[a, b, c].map((s) => ({ threat: 'beacon', kind: 'ship', target: s, level: 3, label: '' })),
    ]);
    const fog = await import('/src/render/fog.ts');
    const cfx = await import('/src/render/beaconCloakFx.ts');
    const seen = [a, b, c].map((s) => ({ visible: fog.builtObjectVisibleToPlayer(galaxy, emp, s), cloakedContact: cfx.isCloakedContact(s, emp) }));
    return { home: { x: home.xpos, y: home.ypos }, c: { x: c.xpos, y: c.ypos }, seen };
});
console.log('beacon', JSON.stringify(bc));
if (bc.err === undefined) {
    await shot('beacon-home.png', 0.25, bc.home.x, bc.home.y + 600);
    await shot('beacon-fogged-watcher.png', 0.5, bc.c.x, bc.c.y);
}
for (const l of logs) if (l.startsWith('[error]') || l.startsWith('[pageerror]')) console.log(l);
await browser.close();
