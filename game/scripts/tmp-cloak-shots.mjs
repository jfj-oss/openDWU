// The Watchers' cloak captures (Giantworks; beaconCloakFx.ts). Usage: node scripts/tmp-cloak-shots.mjs <baseUrl> <outDir>
// Frames: the first Watcher cloaked and detected (the shimmer, the bent stars), its decloak, a re-cloak (undetected: it
// fades out), then the sighted marker at play zoom. Adapted from tmp-fork-shots.mjs.
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
    args: ['--use-gl=angle', '--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu', '--autoplay-policy=no-user-gesture-required'],
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


const at = async ([z, x, y]) => {
    const { camera } = window.__dwu;
    camera.zoomAt(z, camera.width / 2, camera.height / 2);
    camera.centerOn(x, y);
};
await page.evaluate(async () => {
    const roq = await import('/src/sim/readOnlyQuery.ts');
    const { made, w1 } = window.__bc;
    const cap = made.find((b) => b.subRole === 5);
    roq.withSimWrites(() => { if (cap && !w1.actualEmpire.designs.includes(cap.design)) w1.actualEmpire.designs.push(cap.design); w1.currentSpeed = 0; });
});
const W = await page.evaluate(() => ({ x: window.__bc.w1.xpos, y: window.__bc.w1.ypos }));
const Z = Number(process.env.Z || 1), CW = Number(process.env.CLIP || 640);
const clip = { x: (1600 - CW) / 2, y: (1000 - CW) / 2, width: CW, height: CW };
let i = 0;
const snap = async (tag) => { await page.screenshot({ path: `${outDir}/cloak-${String(i++).padStart(3, '0')}-${tag}.png`, clip }); };
const setCloak = (cloaked, detected) => page.evaluate(async ([c, d]) => {
    const roq = await import('/src/sim/readOnlyQuery.ts');
    const st = await import('/src/sim/tick/simTime.ts');
    const { galaxy, game } = window.__dwu;
    const w = window.__bc.w1;
    const now = st.galaxyStarDate(galaxy);
    roq.withSimWrites(() => {
        w.cloaked = c;
        // detected: the viewer's empire in cloakSeenBy (a sighting lasting a while); undetected: none
        w.cloakSeenBy = d ? [{ empireId: game.playerEmpire.empireId, until: now + Number(d) }] : [];
    });
}, [cloaked, detected]);
// the sighting's span (star date units) for the marker's fade; the shimmer shots use a long one
const SPAN = Number(process.env.SPAN || 1e9);
await page.evaluate(at, [Z, W.x, W.y]);
await setCloak(true, SPAN);
await page.waitForTimeout(3500);
let t0 = Date.now();
if (!process.env.PULSE_ONLY) {
console.log('lens', JSON.stringify(await page.evaluate(async () => { const c = await import('/src/render/beaconCloakFx.ts'); return { ...c.cloakLensDebug }; })));
for (let k = 0; k < 40; k++) { await snap('cloaked'); await page.waitForTimeout(150); }
await setCloak(false, SPAN);
// the decloak (10 s), frames by the clock
t0 = Date.now();
while (Date.now() - t0 < 10800) { await snap('decloak'); await page.waitForTimeout(40); }
for (let k = 0; k < 6; k++) { await snap('open'); await page.waitForTimeout(150); }
await setCloak(true, 0);
t0 = Date.now();
while (Date.now() - t0 < 5000) { await snap('recloak'); await page.waitForTimeout(40); }
}
// the pulse: a second decloak watched from far out (the ring across the map, the screen-edge dark), full screen
const log = () => page.evaluate(async () => ({ ...(await import('/src/audio/beaconDecloak.ts')).watcherSoundLog }));
// the popup sound: a Watcher message card opened (as a first encounter's), held, then closed
const opened = await page.evaluate(async () => {
    const ms = await import('/src/sim/messages.ts');
    const tr = await import('/src/sim/textResolver.ts');
    const ui = await import('/src/ui/messagePopups.ts');
    const { game } = window.__dwu;
    const m = new ms.EmpireMessage(null, ms.EmpireMessageType.GeneralWarning, window.__bc.w1);
    m.title = tr.tryGetText('Beacon Msg Detect Title') ?? 'Something in the dark';
    m.description = tr.tryGetText('Beacon Msg Detect First') ?? '...';
    m.scenarioPopup = 'force';
    window.__wmsg = m;
    ui.openMessageCard(m);
    return { title: m.title, open: ui.openMessageKey() === m };
});
console.log('popup opened', JSON.stringify(opened));
// (the card hidden from the pulse frames: it stays open)
await page.addStyleTag({ content: '.msg-card { visibility: hidden !important; }' });
await page.waitForTimeout(1500);
console.log('popup open while the decloak sound plays (ducked)', JSON.stringify(await log()));
await setCloak(true, SPAN);
await page.evaluate(at, [Number(process.env.ZFAR || 0.02), W.x, W.y]);
await page.waitForTimeout(6000);
await setCloak(false, SPAN);
t0 = Date.now();
while (Date.now() - t0 < 7000) {
    await page.screenshot({ path: `${outDir}/pulse-${String(i++).padStart(3, '0')}.png` });
    await page.waitForTimeout(60);
}
console.log('audio after the pulse', JSON.stringify(await log()));
console.log('pulse debug', JSON.stringify(await page.evaluate(async () => {
    const c = await import('/src/render/beaconCloakFx.ts');
    const ta = await import('/src/render/threatArt.ts');
    const out = [];
    const n = c.decloaksSince(0, out);
    const L = ta.lastThreatLooks();
    const { galaxy, camera, game } = window.__dwu;
    const e = out[out.length - 1];
    const homes = game.playerEmpire.colonies;
    return { n, events: out.length, watchers: L.watchers?.length, zoom: camera.zoom, level: e ? c.pulseLevel(e.x, e.y, camera.x, camera.y, homes, galaxy.sectorSize) : null, homes: homes.length, sector: galaxy.sectorSize };
})));
await page.waitForTimeout(9000);
console.log('later: the decloak sound has ended (unducked)', JSON.stringify(await log()));
await page.evaluate(async () => (await import('/src/ui/messagePopups.ts')).closeMessageCardFor(window.__wmsg));
await page.waitForTimeout(1500);
console.log('audio after popup closed', JSON.stringify(await log()));

await page.evaluate(async () => { const roq = await import('/src/sim/readOnlyQuery.ts'); const w = window.__bc.w1; roq.withSimWrites(() => { w.xpos += 90000; }); });
await page.evaluate(at, [1 / 4, W.x, W.y]);
await page.waitForTimeout(2500);
for (let k = 0; k < 6; k++) { await page.screenshot({ path: `${outDir}/marker-${k}.png` }); await page.waitForTimeout(200); }
await browser.close();
for (const l of logs.filter((l) => /error|pageerror|warn/i.test(l)).slice(0, 30)) console.log(l);
