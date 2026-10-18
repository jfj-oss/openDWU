// The fork Watcher's captures (Giantworks; the Beacon's default Watcher look). Usage: node scripts/tmp-fork-shots.mjs <baseUrl> <outDir> [prefix]
// (adapted from tmp-watcherb-shots.mjs): the Watcher close and at play zoom, and the Reclaimer fleet's line-up with the
// second Watcher at its end.
// Boots `?autostart=1&scenario=threat-framework&simWorker=0&reveal=1`, pauses the clock and stands in for the Beacon's sim:
// one hull of every Reclaimer role (any empire's designs, handed to a second empire), two Watchers and a Beacon, put in
// the render contract's state bag (threatArt.ts BeaconArtState under BEACON_STATE_KEY), the first Watcher travelling
// (it stays closed), the second sighted (it opens once the camera reaches it). Then: the lineup at close / play zoom,
// a burst of close frames (the breath), the closed Watcher, the second Watcher opening and open, the Beacon close and far.
// Headless Chromium on the GPU (ANGLE / Vulkan), never SwiftShader.
import { chromium } from 'playwright-core';
const [base = 'http://localhost:5173/', outDir = 'shots', prefix = ''] = process.argv.slice(2);
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
    args: ['--use-gl=angle', '--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu'],
});
const page0 = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
const page = page0;
// FORK_FRAME / FORK_FX: preview another fork Watcher frame (the base + extras variant) in place of watcher-fork.png
if (process.env.FORK_FRAME) await page.route('**/art/beacon/watcher-fork.png*', (r) => r.fulfill({ path: process.env.FORK_FRAME, contentType: 'image/png' }));
if (process.env.FORK_FX) await page.route('**/art/beacon/watcher-fork-fx.png*', (r) => r.fulfill({ path: process.env.FORK_FX, contentType: 'image/png' }));
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
// The Watcher's horn (src/audio/beaconHorn.ts): its file is fetched on the first opening heard.
page.on('requestfinished', (r) => {
    if (r.url().includes('/audio/beacon/')) console.log('horn fetched', r.url());
});
await page.goto(`${base}?autostart=1&scenario=threat-framework&simWorker=0&reveal=1&stars=300&seed=3`);
await page.waitForFunction(() => window.__dwu?.game?.playerEmpire !== undefined, null, { timeout: 240000 });
await page.waitForTimeout(3000);
// The GPU in use (must be ANGLE / Vulkan on the real GPU, never SwiftShader).
console.log('gpu', await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
}));

const setup = await page.evaluate(async () => {
    const { galaxy, game } = window.__dwu;
    window.__dwu.time.paused = true;
    const roq = await import('/src/sim/readOnlyQuery.ts');
    const ev = await import('/src/sim/empireEvents.ts');
    const own = await import('/src/sim/combat/ownership.ts');
    const ta = await import('/src/render/threatArt.ts');
    return roq.withSimWrites(() => {
        const player = game.playerEmpire;
        const f = galaxy.empires.find((e) => e !== player && e.builtObjects.length > 0);
        if (f === undefined) return { err: 'no second empire' };
        // subRoles: Escort 1, Frigate 2, Destroyer 3, Cruiser 4, CapitalShip 5, Carrier 7, TroopTransport 6, ConstructionShip 15
        const roles = [1, 2, 3, 4, 5, 7, 6, 15];
        const designs = galaxy.empires.flatMap((e) => e.designs);
        const pick = (sr) => designs.filter((d) => d.subRole === sr).sort((a, b) => b.size - a.size)[0];
        const home = player.capital ?? player.builtObjects[0];
        const cx = home.xpos + 60000;
        const cy = home.ypos + 60000;
        const made = [];
        const mk = (d, x, y) => {
            const bo = ev.generateNewBuiltObject(galaxy, f, d, null, x, y);
            own.takeOwnershipOfBuiltObject(galaxy, f, bo, f, false);
            bo.heading = bo.targetHeading = -Math.PI / 2;
            bo.currentSpeed = 0;
            return bo;
        };
        roles.forEach((sr, i) => {
            // No empire has a carrier design at the start: a capital ship stands in (the art only reads the subRole).
            const d = pick(sr) ?? pick(5);
            if (d === undefined) return;
            const bo = mk(d, cx + (i - (roles.length - 1) / 2) * 175, cy);
            bo.subRole = sr;
            made.push(bo);
        });
        const big = pick(5);
        const w1 = mk(big, cx - 1400, cy + 1600);
        const w2 = mk(big, cx + 1400, cy + 1600);
        w2.currentSpeed = 40;
        w1.currentSpeed = 40;
        const ports = designs.filter((d) => d.role === 8).sort((a, b) => b.size - a.size);
        const b = mk(ports[0] ?? big, cx, cy + 4200);
        // the sim's own record shape (beaconState.ts), so its known-sites listing reads it too
        const rec = (ship, mode) => ({ ship, mode, knowledge: [], dead: false });
        galaxy.scenario.state[ta.BEACON_STATE_KEY] = { faction: f, watchers: [rec(w1, 'travel'), rec(w2, 'travel')], beacon: b, corrupted: [], season: null, processing: [], phase: 'watch' };
        window.__bc = { cx, cy, made, w1, w2, b };
        return { faction: f.name, ships: made.map((s) => `${s.subRole}:${s.size}`), watcher: w1.size, beacon: `${b.role}:${b.size}` };
    });
});
console.log('setup', JSON.stringify(setup));


async function shot(file, fn, arg, wait = 2500) {
    await page.evaluate(fn, arg);
    await page.waitForTimeout(wait);
    await page.screenshot({ path: `${outDir}/${prefix}${file}` });
    console.log(`saved ${outDir}/${prefix}${file}`);
}
const at = async ([z, dx, dy]) => {
    const { camera } = window.__dwu;
    const { cx, cy } = window.__bc;
    camera.zoomAt(z, camera.width / 2, camera.height / 2);
    camera.centerOn(cx + dx, cy + dy);
};
// the fork is sized against its faction's biggest capital design: give the faction the line-up's capital design, so
// the line-up shows the Watcher beside the very capital ship it is measured by
await page.evaluate(async () => {
    const roq = await import('/src/sim/readOnlyQuery.ts');
    const { made, w1 } = window.__bc;
    const cap = made.find((b) => b.subRole === 5);
    roq.withSimWrites(() => { if (cap && !w1.actualEmpire.designs.includes(cap.design)) w1.actualEmpire.designs.push(cap.design); });
});
// SUBJECT=capital: the line-up's capital ship takes the first Watcher's place (the Watcher moved far off) for the
// close / play stills and the ramp
if (process.env.SUBJECT === 'capital' || process.env.SUBJECT === 'frigate') await page.evaluate(async (sr) => {
    const roq = await import('/src/sim/readOnlyQuery.ts');
    const { made, w1 } = window.__bc;
    const cap = made.find((b) => b.subRole === sr);
    roq.withSimWrites(() => { cap.xpos = w1.xpos; cap.ypos = w1.ypos; w1.xpos += 40000; w1.ypos += 40000; });
    window.__bc.w1 = cap;
}, process.env.SUBJECT === 'frigate' ? 2 : 5);
const FRAME = process.env.FRAME || 'fork';
const SCALE = process.env.SCALE ? Number(process.env.SCALE) : undefined;
console.log('frame', await page.evaluate(async ([f, sc]) => { const ta = await import('/src/render/threatArt.ts'); ta.setWatcherFrame(f, sc); return [ta.getWatcherFrame(), ta.threatDrawScale(ta.threatLooks(window.__dwu.galaxy), window.__bc.w1)]; }, [FRAME, SCALE]));
// the second Watcher at the end of the fleet's line, still
await page.evaluate(async () => {
    const roq = await import('/src/sim/readOnlyQuery.ts');
    const { cx, cy, w2 } = window.__bc;
    roq.withSimWrites(() => { w2.xpos = cx + 4 * 175 + 330; w2.ypos = cy - 20; w2.currentSpeed = 0; });
});
const tag = process.env.TAG || FRAME;
// the stills: the first Watcher at its cruise speed (the plumes at full length)
console.log('cruise', await page.evaluate(async () => {
    const roq = await import('/src/sim/readOnlyQuery.ts');
    const b = window.__bc.w1;
    const v = b.cruiseSpeed > 0 ? b.cruiseSpeed : b.topSpeed;
    roq.withSimWrites(() => { b.currentSpeed = v; });
    return v;
}));
// RAMP: the first Watcher (clock paused) at rest, run up to cruise speed and back, moving ahead as it goes: frames of
// its plumes ramping and its lights blinking (the render reads currentSpeed; the clock stays paused)
if (process.env.RAMP) {
    const Z = Number(process.env.Z || 1.5), CW = Number(process.env.CLIP || 560), N = Number(process.env.RAMP);
    await page.evaluate(at, [Z, -1400, 1600]);
    await page.waitForTimeout(3000);
    const info = await page.evaluate(() => { const b = window.__bc.w1; return { cruise: b.cruiseSpeed > 0 ? b.cruiseSpeed : b.topSpeed, x: b.xpos, y: b.ypos }; });
    for (let k = 0; k < N; k++) {
        const u = k / (N - 1);
        // rest (0-15 %), up to cruise (15-45 %), cruise, back down (70-90 %), rest
        const f = process.env.HOLD ? Number(process.env.HOLD) : u < 0.15 ? 0 : u < 0.45 ? (u - 0.15) / 0.3 : u < 0.7 ? 1 : u < 0.9 ? 1 - (u - 0.7) / 0.2 : 0;
        await page.evaluate(async ([v, k]) => {
            const roq = await import('/src/sim/readOnlyQuery.ts');
            const b = window.__bc.w1;
            roq.withSimWrites(() => { b.currentSpeed = v; });
            window.__dwu.camera.centerOn(b.xpos, b.ypos);
        }, [f * info.cruise, k]);
        await page.waitForTimeout(90);
        await page.screenshot({ path: `${outDir}/${prefix}${tag}-ramp-${String(k).padStart(3, '0')}.png`, clip: { x: (1600 - CW) / 2, y: (1000 - CW) / 2, width: CW, height: CW } });
    }
    await browser.close();
    process.exit(0);
}
await shot(`${tag}-close.png`, at, [1, -1400, 1600], 4000);
await shot(`${tag}-close2.png`, at, [Number(process.env.Z2 || 1.6), -1400, 1600], 3000);
await shot(`${tag}-play.png`, at, [1 / 4, -1400, 1600], 3000);
await shot(`${tag}-lineup-play.png`, at, [1 / 3, 330, 0], 3000);
await shot(`${tag}-lineup-close.png`, at, [0.75, 330, 0], 3000);
await browser.close();
for (const l of logs.filter((l) => /error|pageerror/i.test(l)).slice(0, 30)) console.log(l);
