// Dead Probe Swarm art captures. Usage: node scripts/probeswarm-shots.mjs <baseUrl> <outDir> [prefix]
// Boots `?autostart=1&scenario=threat-framework,probe-swarm&simWorker=0&reveal=1`, pauses the clock, wakes the swarm
// directly (probeSwarmWake at probeSwarmHomeSite, as the threat test forces it), lets it build a few stations, then
// lines its ships up beside the mothercore (heading up) for close / play-zoom shots of the live ship layer.
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
await page.goto(`${base}?autostart=1&scenario=threat-framework,probe-swarm&simWorker=0&reveal=1&stars=300&seed=3`);
await page.waitForFunction(() => window.__dwu?.game?.playerEmpire !== undefined, null, { timeout: 240000 });
await page.waitForTimeout(3000);

const setup = await page.evaluate(async () => {
    const { galaxy, time } = window.__dwu;
    time.paused = true;
    const ps = await import('/src/sim/scenario/threats/probeSwarm.ts');
    const sch = await import('/src/sim/tick/scheduler.ts');
    // The UI's galaxy is read-only outside a sim frame (readOnlyQuery.ts): the forced wake writes as a command would.
    const roq = await import('/src/sim/readOnlyQuery.ts');
    const fw = await import('/src/sim/scenario/threats/framework.ts');
    const visMod = await import('/src/sim/visibility.ts');
    return roq.withSimWrites(() => {
    const ts = fw.peekThreatState(galaxy, 'threats');
    if (ts !== null) ts.exists.probeSwarm = true;
    Object.assign(galaxy.scenario.params, { probeSwarmYear: 0, probeSwarmMinYear: 0, probeSwarmExistChancePct: 100, probeSwarmStationDays: 1, probeSwarmStationMinDays: 1, probeSwarmStartShips: 10, probeSwarmExpandRangePct: 30, probeSwarmMinCapitalDistancePct: 0 });
    const st = ps.probeSwarmState(galaxy);
    if (st.phase === 'waiting') {
        const home = ps.probeSwarmHomeSite(galaxy);
        if (home === null) return { err: 'no home' };
        ps.probeSwarmWake(galaxy, st, home);
    }
    if (ps.peekProbeSwarmState(galaxy) === null) return { err: 'swarm state not stored' };
    for (let k = 0; k < 6; k++) {
        st.budget = 5e6;
        ps.probeSwarmPeriodic(galaxy);
        for (let i = 0; i < 40; i++) sch.runSimFrame(galaxy, sch.nextFrameMs(sch.schedulerState(galaxy), 4));
    }
    // Every system explored by the player, so the galaxy map shows the swarm's presence discs.
    for (const v of window.__dwu.game.playerEmpire.visibility?.systemVisibility ?? []) v.status = visMod.SystemVisibilityStatus.Explored;
    const mc = st.mothercore;
    const objs = galaxy.builtObjects.filter((b) => b !== null && !b.hasBeenDestroyed && b.empire === st.faction);
    window.__swarm = { st };
    return {
        mothercore: mc ? [Math.round(mc.xpos), Math.round(mc.ypos), mc.size, mc.subRole] : null,
        objs: objs.map((b) => `${b.name}|role ${b.role}|sub ${b.subRole}|size ${b.size}|pic ${b.pictureRef ?? b.design?.pictureRef}`),
    };
    });
});
console.log('setup', JSON.stringify(setup, null, 1));

async function shot(file, fn, arg, wait = 3500) {
    await page.evaluate(fn, arg);
    await page.waitForTimeout(wait);
    await page.screenshot({ path: `${outDir}/${prefix}${file}` });
    console.log(`saved ${outDir}/${prefix}${file}`);
}

// In place first: the Mothercore among its ships in its home system, and the galaxy-map presence marker.
await page.evaluate(() => {
    const { galaxy } = window.__dwu;
    const st = window.__swarm.st;
    const mc = st.mothercore;
    const all = galaxy.builtObjects.filter((b) => b !== null && !b.hasBeenDestroyed && b.empire === st.faction && b.role !== 8);
    all.forEach((b, i) => {
        const a = (i / all.length) * Math.PI * 2;
        b.xpos = mc.xpos + Math.cos(a) * (500 + (i % 3) * 180);
        b.ypos = mc.ypos + Math.sin(a) * (420 + (i % 2) * 160);
        b.heading = a + Math.PI / 2;
        b.targetHeading = b.heading;
    });
});
for (const [file, z] of [['home-close.png', 1], ['home-mid.png', 1 / 2.5], ['home-system.png', 1 / 12]]) {
    await shot(file, async (z) => {
        const { camera } = window.__dwu;
        const mc = window.__swarm.st.mothercore;
        camera.zoomAt(z, camera.width / 2, camera.height / 2);
        camera.centerOn(mc.xpos, mc.ypos);
    }, z);
}
await shot('map.png', async () => {
    const { camera } = window.__dwu;
    const mc = window.__swarm.st.mothercore;
    camera.zoomAt(1 / 1500, camera.width / 2, camera.height / 2);
    await new Promise((r) => setTimeout(r, 4000));
    camera.centerOn(mc.xpos, mc.ypos);
}, null);

// Line up, in empty space off the swarm's home system: the Mothercore in the middle, one ship of each role in a row
// above it (heading up, smallest first), one station of each kind below.
await page.evaluate(() => {
    const st = window.__swarm.st;
    const mc = st.mothercore;
    const all = window.__dwu.galaxy.builtObjects.filter((b) => b !== null && !b.hasBeenDestroyed && b.empire === st.faction);
    const cx = mc.xpos + 60000;
    const cy = mc.ypos + 60000;
    const place = (b, x, y) => {
        b.xpos = x;
        b.ypos = y;
        b.heading = -Math.PI / 2;
        b.targetHeading = -Math.PI / 2;
    };
    place(mc, cx, cy);
    const ships = all.filter((b) => b.role !== 8).sort((a, b) => a.size - b.size || a.subRole - b.subRole);
    const seen = new Set();
    const uniq = ships.filter((b) => (seen.has(b.subRole) ? false : (seen.add(b.subRole), true)));
    uniq.forEach((b, i) => place(b, cx + (i - (uniq.length - 1) / 2) * 210, cy - 330));
    ships.filter((b) => !uniq.includes(b)).forEach((b, i) => place(b, cx + 30000 + (i % 8) * 200, cy + Math.floor(i / 8) * 220));
    const bases = all.filter((b) => b.role === 8 && b !== mc);
    const seenB = new Set();
    const uniqB = bases.filter((b) => (seenB.has(b.subRole) ? false : (seenB.add(b.subRole), true)));
    uniqB.forEach((b, i) => place(b, cx + (i === 0 ? -440 : 440), cy + 20));
    window.__swarm.line = { cx, cy, uniq: uniq.map((b) => `${b.subRole}:${b.size}`), bases: uniqB.map((b) => `${b.subRole}:${b.size}`) };
});
const line = await page.evaluate(() => window.__swarm.line);
console.log('line', JSON.stringify(line));

const centre = (zoom) => async (z) => {
    const { camera } = window.__dwu;
    const { cx, cy } = window.__swarm.line;
    camera.zoomAt(z, camera.width / 2, camera.height / 2);
    camera.centerOn(cx, cy - 40);
};
await shot('lineup-close.png', centre(), 1);
await shot('lineup-mid.png', centre(), 1 / 2);
await shot('lineup-play.png', centre(), 1 / 4);
await shot('lineup-far.png', centre(), 1 / 10);
// The mothercore alone, closest zoom.
await shot('mothercore-close.png', async () => {
    const { camera } = window.__dwu;
    const { cx, cy } = window.__swarm.line;
    camera.zoomAt(1, camera.width / 2, camera.height / 2);
    camera.centerOn(cx, cy);
}, null);
await browser.close();
for (const l of logs.filter((l) => /error|pageerror/i.test(l)).slice(0, 30)) console.log(l);
