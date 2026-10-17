// Giantworks art captures. Usage: node scripts/giantworks-shots.mjs <baseUrl> <outDir> [prefix]
// Boots `?autostart=1&scenario=threat-framework&simWorker=0&reveal=1`, pauses the clock and stands up one Great Work site
// per look in empty space beside the player's home (scaffold stages 0-3, the Gilded Orbit, the Ultramind alone, the
// Leviathan Sanctuary) plus an Ultramind wrapping a planet of the home system, as render-only state
// (galaxy.scenario.state.giantworks.sites: threatArt.ts GIANTWORKS_STATE_KEY; the bases are plain player bases), and
// marks the site / founders on the map (artBundleLayer setThreatSitesSource). Then close and play-zoom shots of each,
// two Sanctuary frames ~2 s apart (the whales swim), the wrapped planet, the map glyphs, and a burst of light frames;
// then the Gilded Orbit animated: casino-anim-<i>.png (close zoom, cropped, timestamps in casino-anim.json, for a strip
// and a GIF) and casino-play-anim-<i>.png (play zoom), the same for the casino that is a pirate den (casino-pirate-*).
// GW_ONLY=casino,casino-pirate: only those looks' shots.
// Headless Chromium on the GPU (ANGLE / Vulkan), never SwiftShader.
import { writeFileSync } from 'node:fs';
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
    const roq = await import('/src/sim/readOnlyQuery.ts');
    const ev = await import('/src/sim/empireEvents.ts');
    const own = await import('/src/sim/combat/ownership.ts');
    const abl = await import('/src/render/artBundleLayer.ts');
    return roq.withSimWrites(() => {
        const emp = game.playerEmpire;
        const design = emp.designs.find((d) => d.role === 8) ?? galaxy.empires.flatMap((e) => e.designs).find((d) => d.role === 8);
        if (design === undefined) return { err: 'no base design' };
        const home = emp.capital ?? galaxy.habitats.find((h) => h.owner === emp);
        const cx = home.xpos + 70000;
        const cy = home.ypos + 70000;
        const looks = [
            { stage: 0, wonder: 'sanctuary', progress: 0.12 },
            { stage: 1, wonder: 'casino', progress: 0.38 },
            { stage: 2, wonder: 'ultramind', progress: 0.61 },
            { stage: 3, wonder: 'sanctuary', progress: 0.87 },
            { stage: 4, wonder: 'casino', progress: 1 },
            { stage: 4, wonder: 'ultramind', progress: 1 },
            { stage: 4, wonder: 'sanctuary', progress: 1, whales: 5 },
            { stage: 4, wonder: 'casino', progress: 1, den: true },
        ];
        const sites = [];
        const spots = [];
        looks.forEach((l, i) => {
            const x = cx + (i % 4) * 900;
            const y = cy + Math.floor(i / 4) * 900;
            const bo = ev.generateNewBuiltObject(galaxy, emp, design, null, x, y);
            own.takeOwnershipOfBuiltObject(galaxy, emp, bo, emp, false);
            bo.xpos = x;
            bo.ypos = y;
            // a finished wonder's base is built and idle (else the construction reveal and sparks play over its art)
            if (l.stage >= 4) {
                bo.unbuiltComponentCount = 0;
                bo.doingConstruction = false;
            }
            // knowledge / seenBy: the add-on's known-site readers (overlay rows) walk them
            sites.push({ id: i, base: bo, habitat: null, knowledge: [], seenBy: [], ...l });
            spots.push({ x, y, name: l.stage < 4 ? `scaffold-${l.stage}` : l.den === true ? 'casino-pirate' : l.wonder });
        });
        // An Ultramind round a planet of the home system (its uplink node beside it).
        const planet = galaxy.habitats.find((h) => h.parent === home.parent && h !== home && h.category === 1 && h.diameter > 150) ?? galaxy.habitats.find((h) => h.category === 1 && h !== home && h.diameter > 150);
        let planetSpot = null;
        if (planet !== undefined) {
            const bo = ev.generateNewBuiltObject(galaxy, emp, design, null, planet.xpos + 420, planet.ypos - 260);
            own.takeOwnershipOfBuiltObject(galaxy, emp, bo, emp, false);
            sites.push({ id: 9, base: bo, habitat: planet, stage: 4, wonder: 'ultramind', progress: 1, knowledge: [], seenBy: [] });
            planetSpot = { x: planet.xpos, y: planet.ypos, d: planet.diameter, name: planet.name };
        }
        galaxy.scenario.state.giantworks = { sites };
        // The last casino is a pirate den: its smugglers' front is out (the casino sim's record, render-only here).
        const den = sites.find((s) => s.den === true);
        galaxy.scenario.state.giantworksCasino = { sites: den !== undefined ? [{ workId: den.id, phase: 'revealed', faction: null }] : [], faction: null };
        // The map: the scaffold site as a known Great Work, three nearby worlds as Compact founders (one at rumour level).
        const founders = galaxy.habitats.filter((h) => h.category === 1 && h !== home).slice(0, 3);
        abl.setThreatSitesSource(() => [
            ...sites.slice(0, 4).map((s) => ({ threat: 'giantworks', kind: 'ship', target: s.base, level: 1, label: '' })),
            ...founders.map((h, k) => ({ threat: 'giantworksCompact', kind: 'colony', target: h, level: k === 0 ? 1 : 2, label: '' })),
        ]);
        window.__gw = { spots, planetSpot, founders: founders.map((h) => ({ x: h.xpos, y: h.ypos })) };
        return { design: design.name, spots, planetSpot };
    });
});
console.log('setup', JSON.stringify(setup));

async function shot(file, z, x, y, wait = 2500, clip) {
    await page.evaluate(([z, x, y]) => {
        const { camera } = window.__dwu;
        camera.zoomAt(z, camera.width / 2, camera.height / 2);
        camera.centerOn(x, y);
    }, [z, x, y]);
    await page.waitForTimeout(wait);
    await page.screenshot({ path: `${outDir}/${prefix}${file}`, clip });
    console.log(`saved ${outDir}/${prefix}${file}`);
}

const spots = await page.evaluate(() => window.__gw.spots);
const only = (process.env.GW_ONLY ?? '').split(',').filter((v) => v !== '');
for (const s of spots) {
    if (only.length > 0 && !only.includes(s.name)) continue;
    await shot(`${s.name}-close.png`, 1, s.x, s.y, 3500);
    await shot(`${s.name}-play.png`, 1 / 4, s.x, s.y, 1500);
}
async function casinoAnim(name) {
    const c = spots.find((s) => s.name === name);
    const times = [];
    await shot(`${name}-anim-0.png`, 1, c.x, c.y, 3000, { x: 500, y: 200, width: 600, height: 600 });
    times.push(await page.evaluate(() => performance.now()));
    for (let i = 1; i < 40; i++) {
        await page.waitForTimeout(60);
        await page.screenshot({ path: `${outDir}/${prefix}${name}-anim-${i}.png`, clip: { x: 500, y: 200, width: 600, height: 600 } });
        times.push(await page.evaluate(() => performance.now()));
    }
    writeFileSync(`${outDir}/${prefix}${name}-anim.json`, JSON.stringify(times));
    await shot(`${name}-play-anim-0.png`, 1 / 4, c.x, c.y, 2000, { x: 700, y: 400, width: 200, height: 200 });
    for (let i = 1; i < 12; i++) {
        await page.waitForTimeout(250);
        await page.screenshot({ path: `${outDir}/${prefix}${name}-play-anim-${i}.png`, clip: { x: 700, y: 400, width: 200, height: 200 } });
    }
    console.log(`saved ${outDir}/${prefix}${name}-anim-0..39.png, ${name}-play-anim-0..11.png`);
}
for (const name of ['casino', 'casino-pirate']) if (only.length === 0 || only.includes(name)) await casinoAnim(name);
if (only.length > 0) {
    await browser.close();
    for (const l of logs.filter((l) => /error|pageerror|warn/i.test(l)).slice(0, 30)) console.log(l);
    process.exit(0);
}
await shot('lineup-mid.png', 1 / 3, spots[0].x + 1350, spots[0].y + 450, 2500);
// The whales swim: two frames of the Sanctuary ~4 s apart.
const sanct = spots[spots.length - 1];
await shot('sanctuary-whales-a.png', 1, sanct.x, sanct.y, 3000, { x: 500, y: 200, width: 600, height: 600 });
await page.waitForTimeout(4000);
await page.screenshot({ path: `${outDir}/${prefix}sanctuary-whales-b.png`, clip: { x: 500, y: 200, width: 600, height: 600 } });
console.log(`saved ${outDir}/${prefix}sanctuary-whales-b.png`);
const ps = await page.evaluate(() => window.__gw.planetSpot);
if (ps !== null) {
    await shot('ultramind-planet-close.png', 1, ps.x + 200, ps.y - 100, 3500);
    await shot('ultramind-planet-play.png', 1 / 4, ps.x + 200, ps.y - 100, 2000);
}
// The map glyphs: the site's stage arcs, the Compact's seal over its founders.
await shot('glyphs-site.png', 1 / 40, spots[1].x, spots[1].y, 2500);
const f0 = await page.evaluate(() => window.__gw.founders[1] ?? null);
if (f0 !== null) await shot('glyphs-founder.png', 1 / 12, f0.x, f0.y, 2500);
// Light burst on the casino and the Superstructure stage.
const casino = spots.find((s) => s.name === 'casino');
await shot('casino-burst-0.png', 1 / 1.5, casino.x, casino.y, 2500, { x: 450, y: 150, width: 700, height: 700 });
for (let i = 1; i < 6; i++) {
    await page.waitForTimeout(180);
    await page.screenshot({ path: `${outDir}/${prefix}casino-burst-${i}.png`, clip: { x: 450, y: 150, width: 700, height: 700 } });
}
console.log(`saved ${outDir}/${prefix}casino-burst-0..5.png`);
await browser.close();
for (const l of logs.filter((l) => /error|pageerror|warn/i.test(l)).slice(0, 30)) console.log(l);
