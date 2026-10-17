// The Beacon's art captures (Giantworks). Usage: node scripts/beacon-shots.mjs <baseUrl> <outDir> [prefix]
// Boots `?autostart=1&scenario=threat-framework&simWorker=0&reveal=1`, pauses the clock and stands in for the Beacon's sim:
// one hull of every Reclaimer role (any empire's designs, handed to a second empire), two Watchers and a Beacon, put in
// the render contract's state bag (threatArt.ts BeaconArtState under BEACON_STATE_KEY), the first Watcher moving (its
// pod stays closed), the second sighted (it unfolds once the camera reaches it). Then: the lineup at close / play zoom,
// a burst of close frames (the beat), the closed pod, the second Watcher opening and open, the Beacon close and far.
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
        w1.currentSpeed = 40;
        const ports = designs.filter((d) => d.role === 8).sort((a, b) => b.size - a.size);
        const b = mk(ports[0] ?? big, cx, cy + 4200);
        galaxy.scenario.state[ta.BEACON_STATE_KEY] = { faction: f, watchers: [w1, w2], sighted: [], beacon: b };
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
await shot('lineup-close.png', at, [1, 0, 0], 4000);
await shot('lineup-mid.png', at, [1 / 1.6, 0, 300]);
await shot('lineup-play.png', at, [1 / 4, 0, 0]);
await shot('lineup-far.png', at, [1 / 10, 0, 1500]);
// The beat: close frames 0.1 s apart.
await page.evaluate(at, [1, 0, 0]);
await page.waitForTimeout(1500);
for (let i = 0; i < 16; i++) {
    await page.screenshot({ path: `${outDir}/${prefix}beat-${String(i).padStart(2, '0')}.png`, clip: { x: 0, y: 380, width: 1600, height: 240 } });
    await page.waitForTimeout(100);
}
console.log(`saved ${outDir}/${prefix}beat-00..15.png`);
await shot('watcher-closed.png', at, [1, -1400, 1600]);
// The second Watcher is sighted: it unfolds over WATCHER_OPEN_S (10 s).
await page.evaluate(() => {
    const ta = window.__dwu.galaxy.scenario.state.beacon;
    ta.sighted = [window.__bc.w2];
});
await shot('watcher-opening.png', at, [1, 1400, 1600], 4200);
await shot('watcher-open.png', at, [1, 1400, 1600], 8500);
await shot('watchers-play.png', at, [1 / 3, 0, 1600]);
await shot('beacon-close.png', at, [1, 0, 4200], 3000);
await shot('beacon-play.png', at, [1 / 3, 0, 4000]);
await browser.close();
for (const l of logs.filter((l) => /error|pageerror/i.test(l)).slice(0, 30)) console.log(l);
