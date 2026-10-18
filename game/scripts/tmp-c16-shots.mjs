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
// concept 7 previews the bare frame: the parked concept-6 extras (chains, plumes, glyphs, glow, opening) not loaded
if (process.env.BARE) await page.route(/art\/beacon\/watcher-reaper-[a-z]+\.png/, (r) => r.abort());
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




const mode = process.env.MODE || 'stills';
await page.evaluate(async (on) => {
    (await import('/src/render/threatArt.ts')).setWatcherFrame('reaper');
    (await import('/src/render/beaconReaperMotion.ts')).REAPER_HAZE.on = on;
}, process.env.HAZE !== '0');
const W = 1600, H = 1000;
const at = async (z, who) => page.evaluate(([z, who]) => {
    const { camera } = window.__dwu;
    camera.zoomAt(z, camera.width / 2, camera.height / 2);
    const b = who === 'cap' ? window.__bc.made[4] : window.__bc.w1;
    camera.centerOn(b.xpos, b.ypos);
}, [z, who]);
let i = 0;
if (mode === 'stills') {
    for (const who of ['w1', 'cap']) {
        for (const [z, tag] of [[1, 'close'], [0.25, 'play']]) {
            await at(z, who);
            await page.waitForTimeout(3500);
            await page.screenshot({ path: `${outDir}/${prefix}c16-${who}-${tag}.png` });
        }
    }
    // the capital next to the rest of the fleet (play zoom)
    await page.evaluate(() => { const { camera } = window.__dwu; camera.zoomAt(0.5, camera.width / 2, camera.height / 2); camera.centerOn(window.__bc.cx, window.__bc.cy); });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${outDir}/${prefix}c16-lineup.png` });
} else if (mode === 'haze') {
    const CW = 760;
    const clip = { x: (W - CW) / 2, y: (H - CW) / 2, width: CW, height: CW };
    await at(0.6, 'w1');
    await page.waitForTimeout(2500);
    const follow = () => page.evaluate(() => { const b = window.__bc.w1; window.__dwu.camera.centerOn(b.xpos, b.ypos); });
    const order = (dx, dy) => page.evaluate(async ([dx, dy]) => {
        const { galaxy } = window.__dwu;
        const as = await import('/src/sim/missions/assign.ts');
        const mt = await import('/src/sim/missions/mission.ts');
        const roq = await import('/src/sim/readOnlyQuery.ts');
        const bo = window.__bc.w1;
        roq.withSimWrites(() => as.assignMission(galaxy, bo, mt.BuiltObjectMissionType.Move, null, null, mt.BuiltObjectMissionPriority.High, { x: bo.xpos + dx, y: bo.ypos + dy, manuallyAssigned: true }));
        window.__dwu.time.paused = false;
    }, [dx, dy]);
    const snap = async (tag) => { await follow(); await page.screenshot({ path: `${outDir}/${prefix}haze-${String(i++).padStart(3, '0')}-${tag}.png`, clip }); };
    for (let k = 0; k < 6; k++) { await snap('rest'); await page.waitForTimeout(100); }
    await order(2600, -200);
    for (let k = 0; k < 70; k++) { await snap('go'); await page.waitForTimeout(100); }
    await order(-300, 2400);
    for (let k = 0; k < 60; k++) { await snap('turn'); await page.waitForTimeout(100); }
} else if (mode === 'perf') {
    const res = await page.evaluate(async () => {
        const { galaxy } = window.__dwu;
        const ta = await import('/src/render/threatArt.ts');
        const m = await import('/src/render/beaconReaperMotion.ts');
        const as = await import('/src/sim/missions/assign.ts');
        const mt = await import('/src/sim/missions/mission.ts');
        const roq = await import('/src/sim/readOnlyQuery.ts');
        const st = galaxy.scenario.state[ta.BEACON_STATE_KEY];
        const ships = [window.__bc.w1, window.__bc.w2, window.__bc.made[4], window.__bc.made[5]];
        roq.withSimWrites(() => ships.forEach((b, k) => { b.xpos = window.__bc.cx - 1500 + k * 1000; b.ypos = window.__bc.cy + 900; }));
        st.watchers = ships.map((ship) => ({ ship, mode: 'travel', knowledge: [], dead: false }));
        const { camera } = window.__dwu;
        camera.zoomAt(0.33, camera.width / 2, camera.height / 2);
        camera.centerOn(window.__bc.cx, window.__bc.cy + 900);
        window.__dwu.time.paused = false;
        roq.withSimWrites(() => ships.forEach((b) => as.assignMission(galaxy, b, mt.BuiltObjectMissionType.Move, null, null, mt.BuiltObjectMissionPriority.High, { x: b.xpos + 1500, y: b.ypos, manuallyAssigned: true })));
        await new Promise((r) => setTimeout(r, 2500));
        const measure = (ms) => new Promise((res) => { const d = []; let last = performance.now(); const t0 = last; const f = (t) => { d.push(t - last); last = t; if (t - t0 < ms) requestAnimationFrame(f); else res(d); }; requestAnimationFrame(f); });
        const stat = (d) => { const s = d.slice(1).sort((a, b) => a - b); const avg = s.reduce((a, b) => a + b, 0) / s.length; return { avg: +avg.toFixed(2), p95: +s[Math.floor(s.length * 0.95)].toFixed(2), max: +s[s.length - 1].toFixed(2) }; };
        const out = {};
        for (const [name, on] of [['off', false], ['haze', true], ['off2', false]]) {
            m.REAPER_HAZE.on = on;
            await new Promise((r) => setTimeout(r, 400));
            out[name] = stat(await measure(2500));
        }
        out.speeds = ships.map((b) => Math.round(b.currentSpeed));
        return out;
    });
    console.log('perf', JSON.stringify(res));
}
await browser.close();
for (const l of logs.filter((l) => /error|pageerror/i.test(l) && !/stall/.test(l)).slice(0, 20)) console.log(l.slice(0, 600));
