// Generation Ships art captures. Usage: node scripts/genships-shots.mjs <baseUrl> <outDir> [prefix]
// Boots `?autostart=1&scenario=threat-framework,generation-ships&simWorker=0&reveal=1`, pauses the clock, brings the
// first world ship in at the player (genShipsSpawnNow, as the Game Editor does), adds one hull of every faction design
// the escort lacks, then lines the fleet up (heading up) for close / play-zoom shots of the live ship layer, the world
// ship among its escorts, a zoomed-out view, and a burst of frames of the blinking red positional lights.
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
await page.goto(`${base}?autostart=1&scenario=threat-framework,generation-ships&simWorker=0&reveal=1&stars=300&seed=3`);
await page.waitForFunction(() => window.__dwu?.game?.playerEmpire !== undefined, null, { timeout: 240000 });
await page.waitForTimeout(3000);

const setup = await page.evaluate(async () => {
    const { galaxy, game } = window.__dwu;
    window.__dwu.time.paused = true;
    const gs = await import('/src/sim/scenario/threats/generationShips.ts');
    const roq = await import('/src/sim/readOnlyQuery.ts');
    const fw = await import('/src/sim/scenario/threats/framework.ts');
    const ev = await import('/src/sim/empireEvents.ts');
    const own = await import('/src/sim/combat/ownership.ts');
    return roq.withSimWrites(() => {
        const ts = fw.peekThreatState(galaxy, 'threats');
        if (ts !== null) ts.exists.generationShips = true;
        if (!gs.genShipsSpawnNow(galaxy, game.playerEmpire)) return { err: 'spawn failed' };
        const st = gs.peekGenShipsState(galaxy);
        if (st === null || st.worldShip === null) return { err: 'no world ship' };
        const f = st.faction;
        const have = new Set(f.builtObjects.filter((b) => !b.hasBeenDestroyed).map((b) => b.subRole));
        const extra = [];
        for (const d of f.designs) {
            if (have.has(d.subRole) || d.role === 8) continue;
            const bo = ev.generateNewBuiltObject(galaxy, f, d, null, st.worldShip.xpos + 900, st.worldShip.ypos);
            own.takeOwnershipOfBuiltObject(galaxy, f, bo, f, false);
            have.add(d.subRole);
            extra.push(d.subRole);
        }
        window.__gs = { st };
        const objs = f.builtObjects.filter((b) => !b.hasBeenDestroyed);
        return { ws: [st.worldShip.size, st.worldShip.subRole], extra, objs: objs.map((b) => `${b.name}|sub ${b.subRole}|size ${b.size}`) };
    });
});
console.log('setup', JSON.stringify(setup, null, 1));

async function shot(file, fn, arg, wait = 3500) {
    await page.evaluate(fn, arg);
    await page.waitForTimeout(wait);
    await page.screenshot({ path: `${outDir}/${prefix}${file}` });
    console.log(`saved ${outDir}/${prefix}${file}`);
}

// Line up in empty space: the world ship in the middle, one ship of each subRole in a row above it (heading up,
// smallest first), the rest of the fleet in a block beside it.
await page.evaluate(() => {
    const st = window.__gs.st;
    const ws = st.worldShip;
    const all = st.faction.builtObjects.filter((b) => !b.hasBeenDestroyed && b !== ws);
    const cx = ws.xpos + 70000;
    const cy = ws.ypos + 70000;
    const place = (b, x, y, h = -Math.PI / 2) => {
        b.xpos = x;
        b.ypos = y;
        b.heading = h;
        b.targetHeading = h;
    };
    place(ws, cx, cy + 260);
    const ships = all.sort((a, b) => a.size - b.size || a.subRole - b.subRole);
    const seen = new Set();
    const uniq = ships.filter((b) => (seen.has(b.subRole) ? false : (seen.add(b.subRole), true)));
    uniq.forEach((b, i) => place(b, cx + (i - (uniq.length - 1) / 2) * 190, cy - 260));
    // the escort block round the world ship (the "with its escorts" shot)
    ships.filter((b) => !uniq.includes(b)).forEach((b, i) => {
        const a = (i / Math.max(1, ships.length - uniq.length)) * Math.PI * 2;
        place(b, cx + Math.cos(a) * 760, cy + 260 + Math.sin(a) * 560, -Math.PI / 2 + 0.25 * Math.sin(i));
    });
    window.__gs.line = { cx, cy, uniq: uniq.map((b) => `${b.subRole}:${b.size}`) };
});
console.log('line', JSON.stringify(await page.evaluate(() => window.__gs.line)));

const at = (dx, dy) => async ([z, dx, dy]) => {
    const { camera } = window.__dwu;
    const { cx, cy } = window.__gs.line;
    camera.zoomAt(z, camera.width / 2, camera.height / 2);
    camera.centerOn(cx + dx, cy + dy);
};
await shot('lineup-close.png', at(), [1, 0, -260]);
await shot('lineup-mid.png', at(), [1 / 2, 0, -40]);
await shot('lineup-play.png', at(), [1 / 4, 0, 0]);
await shot('worldship-close.png', at(), [1, 0, 260]);
await shot('worldship-escorts.png', at(), [1 / 2.5, 0, 260]);
await shot('fleet-far.png', at(), [1 / 10, 0, 100]);
await shot('fleet-veryfar.png', at(), [1 / 25, 0, 100]);
// The blink: frames of the lineup at play-mid zoom about 0.12 s apart.
await page.evaluate(at(), [1 / 1.5, 0, -260]);
await page.waitForTimeout(3000);
for (let i = 0; i < 12; i++) {
    await page.screenshot({ path: `${outDir}/${prefix}blink-${i}.png`, clip: { x: 200, y: 300, width: 1200, height: 400 } });
    await page.waitForTimeout(120);
}
console.log(`saved ${outDir}/${prefix}blink-0..11.png`);
await browser.close();
for (const l of logs.filter((l) => /error|pageerror/i.test(l)).slice(0, 30)) console.log(l);
