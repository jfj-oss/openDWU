// The Purifier art captures. Usage: node scripts/purifier-shots.mjs <baseUrl> <outDir> [prefix]
// Boots `?autostart=1&scenario=threat-framework,purifier&simWorker=0&reveal=1`, pauses the clock, opens the anchorage
// and wakes the Purifier directly (purifierWake, as the threat test forces it), adds one escort of every subRole the
// group lacks (frigate, carrier, troop transport), then lines the fleet up (heading up) for close / play-zoom shots of
// the live ship layer: the escort lineup, the Purifier (its planet destroyer) close up and among its escorts, and the
// dock (its repair station).
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
await page.goto(`${base}?autostart=1&scenario=threat-framework,purifier&simWorker=0&reveal=1&stars=300&seed=3`);
await page.waitForFunction(() => window.__dwu?.game?.playerEmpire !== undefined, null, { timeout: 240000 });
await page.waitForTimeout(3000);

const setup = await page.evaluate(async () => {
    const { galaxy, game } = window.__dwu;
    window.__dwu.time.paused = true;
    const pu = await import('/src/sim/scenario/threats/purifier.ts');
    const roq = await import('/src/sim/readOnlyQuery.ts');
    const fw = await import('/src/sim/scenario/threats/framework.ts');
    const ev = await import('/src/sim/empireEvents.ts');
    const own = await import('/src/sim/combat/ownership.ts');
    const dg = await import('/src/sim/designGeneration.ts');
    const gst = await import('/src/sim/gameStartTail.ts');
    return roq.withSimWrites(() => {
        const ts = fw.peekThreatState(galaxy, 'threats');
        if (ts !== null) ts.exists.purifier = true;
        Object.assign(galaxy.scenario.params, { purifierExistChancePct: 100, purifierMinYear: 0, purifierYear: 0 });
        const st = pu.purifierState(galaxy);
        if (st.phase === 'waiting') pu.purifierPeriodic(galaxy);
        if (st.anchorage === null) st.anchorage = pu.purifierAnchorage(galaxy);
        if (st.anchorage === null) return { err: 'no anchorage' };
        if (st.phase !== 'awake' && !pu.purifierWake(galaxy, st, game.playerEmpire)) return { err: 'wake failed' };
        const f = st.faction;
        const have = new Set(f.builtObjects.filter((b) => !b.hasBeenDestroyed).map((b) => b.subRole));
        const extra = [];
        for (const sub of [2, 6, 7, 3, 4, 5]) {
            if (have.has(sub)) continue;
            let d = f.designs.find((x) => x.subRole === sub && !x.isPlanetDestroyer) ?? null;
            if (d === null) {
                const spec = f.designSpecifications.find((s) => s !== null && s.subRole === sub) ?? gst.galaxyDesignSpecificationBySubRole(sub);
                try {
                    d = spec ? dg.generateDesignFromSpec(galaxy, f, spec, 6, 0) : null;
                } catch (e) {
                    extra.push(`fail ${sub}: ${e}`);
                }
            }
            if (d === null) continue;
            const bo = ev.generateNewBuiltObject(galaxy, f, d, null, st.dockX + 900, st.dockY);
            own.takeOwnershipOfBuiltObject(galaxy, f, bo, f, false);
            have.add(sub);
            extra.push(sub);
        }
        window.__pu = { st };
        const objs = f.builtObjects.filter((b) => !b.hasBeenDestroyed);
        return { extra, objs: objs.map((b) => `${b.name}|role ${b.role}|sub ${b.subRole}|size ${b.size}|pd ${b.isPlanetDestroyer}`) };
    });
});
console.log('setup', JSON.stringify(setup, null, 1));

async function shot(file, fn, arg, wait = 3500) {
    await page.evaluate(fn, arg);
    await page.waitForTimeout(wait);
    await page.screenshot({ path: `${outDir}/${prefix}${file}` });
    console.log(`saved ${outDir}/${prefix}${file}`);
}

// The dock in place first (its own station art), close and at play zoom.
const atDock = async ([z, dx, dy]) => {
    const { camera } = window.__dwu;
    const st = window.__pu.st;
    const { identifyPirateBase } = await import('/src/sim/characters.ts');
    const dock = identifyPirateBase(st.faction);
    const x = dock ? dock.xpos : st.dockX;
    const y = dock ? dock.ypos : st.dockY;
    camera.zoomAt(z, camera.width / 2, camera.height / 2);
    camera.centerOn(x + dx, y + dy);
};

// Line up in empty space: the planet destroyer in the middle, one ship of each subRole in a row above it (heading up,
// smallest first), the rest of the group round it; the dock (and any other base) beside the row.
await page.evaluate(async () => {
    const st = window.__pu.st;
    const { identifyPirateBase } = await import('/src/sim/characters.ts');
    const dock = identifyPirateBase(st.faction);
    const pd = st.destroyer;
    // warships only (the faction's stock explorer / construction ship keep their race's art and stay home)
    const all = st.faction.builtObjects.filter((b) => !b.hasBeenDestroyed && b !== pd && b.role !== 8 && b.subRole >= 1 && b.subRole <= 7);
    const cx = pd.xpos + 70000;
    const cy = pd.ypos + 70000;
    const place = (b, x, y, h = -Math.PI / 2) => {
        b.xpos = x;
        b.ypos = y;
        b.heading = h;
        b.targetHeading = h;
    };
    place(pd, cx, cy + 300);
    const ships = all.sort((a, b) => a.size - b.size || a.subRole - b.subRole);
    const seen = new Set();
    const uniq = ships.filter((b) => (seen.has(b.subRole) ? false : (seen.add(b.subRole), true)));
    uniq.forEach((b, i) => place(b, cx + (i - (uniq.length - 1) / 2) * 200, cy - 260));
    ships.filter((b) => !uniq.includes(b)).forEach((b, i, arr) => {
        const a = (i / Math.max(1, arr.length)) * Math.PI * 2;
        place(b, cx + Math.cos(a) * 520, cy + 300 + Math.sin(a) * 360, -Math.PI / 2 + 0.25 * Math.sin(i));
    });
    window.__pu.line = { cx, cy, uniq: uniq.map((b) => `${b.subRole}:${b.size}`), dock: dock ? [dock.size, dock.subRole] : null };
});
console.log('line', JSON.stringify(await page.evaluate(() => window.__pu.line)));

const at = async ([z, dx, dy]) => {
    const { camera } = window.__dwu;
    const { cx, cy } = window.__pu.line;
    camera.zoomAt(z, camera.width / 2, camera.height / 2);
    camera.centerOn(cx + dx, cy + dy);
};
await shot('lineup-close.png', at, [1, 0, -260]);
await shot('lineup-mid.png', at, [1 / 2, 0, -40]);
await shot('lineup-play.png', at, [1 / 4, 0, 0]);
await shot('purifier-close.png', at, [1, 0, 300]);
await shot('destroyer-escorts.png', at, [1 / 2, 0, 300]);
await shot('destroyer-escorts-play.png', at, [1 / 4, 0, 200]);
await shot('dock-close.png', atDock, [1, 0, 0]);
await shot('dock-mid.png', atDock, [1 / 2, 0, 0]);
await shot('dock-play.png', atDock, [1 / 4, 0, 0]);
await browser.close();
for (const l of logs.filter((l) => /error|pageerror/i.test(l)).slice(0, 30)) console.log(l);
