// The Beacon's art captures (Giantworks). Usage: node scripts/beacon-shots.mjs <baseUrl> <outDir> [prefix]
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
const KB = process.env.KB_FRAME;
if (KB) await page.route('**/art/beacon/watcher-reaper.png*', (r) => r.fulfill({ path: KB, contentType: 'image/png' }));
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



const at = async ([z, x, y]) => {
    const { camera } = window.__dwu;
    camera.zoomAt(z, camera.width / 2, camera.height / 2);
    camera.centerOn(x, y);
};
// A REAL jump: the ship (a Reclaimer cruiser, made[3], or the first Watcher) is ordered to a point across the system
// with the clock running; frames of its spool and departure at the start, then of its arrival at the end.
const Z = Number(process.env.WARP_Z || 1);
const who = process.env.WARP_WHO || 'cruiser';
const CW = Number(process.env.WARP_CLIP || 640);
const W = 1600, H = 1000;
const clip = { x: (W - CW) / 2, y: (H - CH()) / 2, width: CW, height: CH() };
function CH() { return CW; }
if (process.env.KB_FRAME) {
    await page.evaluate(async (sc) => (await import('/src/render/threatArt.ts')).setWatcherFrame('reaper', sc), Number(process.env.KB_SCALE || 1));
}
if (process.env.OLDCHAIN) await page.evaluate(async () => Object.assign((await import('/src/render/beaconReaperFx.ts')).CHAIN_MOTION, { damp: 0.04, pull: 1.2, sway: 0.18 }));
const plan = await page.evaluate(async (who) => {
    const { galaxy } = window.__dwu;
    const roq = await import('/src/sim/readOnlyQuery.ts');
    const bo = who === 'watcher' ? window.__bc.w1 : who === 'capital' ? window.__bc.made.find((b) => b.subRole === 5) : ({ frigate: 2, destroyer: 3, cruiser: 4, carrier: 7, cattle: 15 })[who] !== undefined ? window.__bc.made.find((b) => b.subRole === ({ frigate: 2, destroyer: 3, cruiser: 4, carrier: 7, cattle: 15 })[who]) : window.__bc.made[3];
    window.__warpBo = bo;
    if (who === 'cattle') { const ta = await import('/src/render/threatArt.ts'); window.__dwu.galaxy.scenario.state[ta.BEACON_STATE_KEY].cattle = [{ ship: bo }]; }
    // the fork Watcher is sized against its faction's capital design (as tmp-fork-shots.mjs); it starts at rest
    const cap = window.__bc.made.find((b) => b.subRole === 5);
    roq.withSimWrites(() => { if (cap && !bo.actualEmpire.designs.includes(cap.design)) bo.actualEmpire.designs.push(cap.design); bo.currentSpeed = 0; });
    // on its own, clear of the others (they may be given jumps of their own once the clock runs)
    roq.withSimWrites(() => {
        bo.xpos += who === 'watcher' ? 0 : 0;
        bo.ypos += who === 'watcher' ? 6000 : 9000;
    });
    return { x: bo.xpos, y: bo.ypos, dx: bo.xpos + 52000, dy: bo.ypos + 26000, id: bo.builtObjectID };
}, who);
await page.evaluate(at, [Z, plan.x, plan.y]);
await page.waitForTimeout(2500);
await page.evaluate(async (plan) => {
    const { galaxy } = window.__dwu;
    const as = await import('/src/sim/missions/assign.ts');
    const mt = await import('/src/sim/missions/mission.ts');
    const roq = await import('/src/sim/readOnlyQuery.ts');
    const bo = window.__warpBo;
    const M = mt.BuiltObjectMissionType;
    const P = mt.BuiltObjectMissionPriority;
    roq.withSimWrites(() => as.assignMission(galaxy, bo, M.Move, null, null, P.High, { x: plan.dx, y: plan.dy, manuallyAssigned: true }));
    window.__dwu.time.paused = false;
}, plan);
let i = 0;
const t0 = Date.now();
let follow = true;
const snap = async (tag) => {
    if (follow) await page.evaluate(() => { const b = window.__warpBo; window.__dwu.camera.centerOn(b.xpos, b.ypos); });
    // the capture's stand-in Beacon state: keep the Watcher listed (the sim may rewrite the record list)
    await page.evaluate(async () => {
        const ta = await import('/src/render/threatArt.ts');
        const st = window.__dwu.galaxy.scenario.state[ta.BEACON_STATE_KEY];
        const b = window.__warpBo;
        if (st && st.watchers && !st.watchers.some((w) => w.ship === b) && window.__bc.w1 === b) st.watchers.push({ ship: b, mode: 'travel', knowledge: [], dead: false });
    });
    await page.screenshot({ path: `${outDir}/${prefix}warp-${String(i++).padStart(2, '0')}-${tag}.png`, clip });
};
const state = () => page.evaluate(async (plan) => {
    const bo = window.__warpBo;
    const st = await import('/src/sim/tick/simTime.ts');
    return { left: bo.hyperjumpCountdown - st.galaxyStarDate(window.__dwu.galaxy), frame: (await import('/src/render/threatArt.ts')).getWatcherFrame(), x: bo.xpos, y: bo.ypos, enter: bo.hyperEnterStartAnimation, exit: bo.hyperExitStartAnimation, just: bo.hyperjumpJustExited, d0: Math.hypot(bo.xpos - plan.x, bo.ypos - plan.y), d1: Math.hypot(bo.xpos - plan.dx, bo.ypos - plan.dy) };
}, plan);
// the spool and the departure: until the ship has left (+1.6 s)
let goneAt = 0;
for (let k = 0; k < 170; k++) {
    const s = await state();
    if (k === 0) console.log('frame', s.frame);
    // hold the camera where the ship jumps from (its jump-out lingers there)
    if (s.enter && s.left < 250) follow = false;
    await snap(goneAt ? 'after' : s.enter ? 'spool' : 'turn');
    if (!goneAt && !s.enter && s.d0 > 2500) {
        goneAt = Date.now();
        follow = false;
    }
    if (goneAt && Date.now() - goneAt > 1700) break;
    await page.waitForTimeout(s.enter ? 60 : 90);
}
console.log('departed', Math.round((goneAt - t0) / 100) / 10, 's', JSON.stringify(await state()));
// the arrival: the camera at the destination, frames from just before it lands
await page.evaluate(at, [Z, plan.dx, plan.dy]);
follow = false;
let landAt = 0;
for (let k = 0; k < 400 && !landAt; k++) {
    const s = await state();
    if (s.d1 < 12000 || s.exit || s.just) { landAt = Date.now(); console.log('land', JSON.stringify(s)); }
    else await page.waitForTimeout(40);
}
follow = true;
for (let k = 0; k < 26; k++) {
    await snap('arrive');
    await page.waitForTimeout(90);
}
console.log('arrived', JSON.stringify(await state()), 'frames', i, 'art', await page.evaluate(async () => {
    const ta = await import('/src/render/threatArt.ts');
    const L = ta.threatLooks(window.__dwu.galaxy);
    const b = window.__warpBo;
    return [ta.beaconArtFile(b, L), L.watchers.length, L.reclaimers ? L.reclaimers.name : null, b.actualEmpire ? b.actualEmpire.name : null, b.subRole, b === window.__bc.w1].join(' ');
}));
await browser.close();
for (const l of logs.filter((l) => /error|pageerror|warpdbg/i.test(l)).slice(0, 60)) console.log(l);
