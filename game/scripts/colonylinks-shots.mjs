#!/usr/bin/env node
// System link lines (render/systemLinks.ts, MainView.2.cs method_250 5237-5336) screenshots and timings: the Main View
// around the player's capital at zoom factors 140 (below the f > 150 gate: no lines), 200, 600, 2000 and 6000, and the
// whole galaxy; then the cost of collecting the network and of rebuilding the dash pieces at each zoom.
//   node scripts/colonylinks-shots.mjs <base url> [--out=shots/colonylinks] [--inthread] [--load=/dev-saves/late2500.dwusave]
//                                      [--newgame=<json>] [--tag=<name>]
// Default: a fresh ?autostart=1 game. Worker mode (default) turns on the replica write detector (?detectWrites=1).
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5173/';
const opt = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const inThread = process.argv.includes('--inthread');
const load = opt('load', '');
const newGame = opt('newgame', '');
const tag = `${opt('tag', load ? 'late' : newGame ? 'mature' : 'new')}-${inThread ? 'inthread' : 'worker'}`;
const out = opt('out', 'shots/colonylinks');
mkdirSync(out, { recursive: true });
const start = load ? `load=${encodeURIComponent(load)}` : newGame ? `newgame=${encodeURIComponent(newGame)}` : 'autostart=1';
const url = `${base}?${start}&simWorker=${inThread ? 0 : 1}${inThread ? '' : '&detectWrites=1'}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const logs = [];
page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.stack ?? e.message}`));
let failed = 0;
const check = (ok, what) => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
    if (!ok) failed++;
};
const shots = [];
const shot = async (name) => {
    const path = `${out}/${tag}-${name}.png`;
    await page.screenshot({ path });
    shots.push(path);
};

/** Centre on the player's capital (or the galaxy centre) at zoom factor f (world units per px); returns the stats. */
async function view(f, where = 'capital') {
    await page.evaluate(
        ({ f, where }) => {
            const d = window.__dwu;
            const p = d.galaxy.playerEmpire;
            const c = where === 'capital' ? (p.capital ?? p.colonies[0]) : { xpos: d.galaxy.sizeX / 2, ypos: d.galaxy.sizeY / 2 };
            d.camera.centerOn(c.xpos, c.ypos);
            d.camera.zoomAt(f === 'min' ? d.camera.minZoom : 1 / f, d.camera.width / 2, d.camera.height / 2);
            d.camera.centerOn(c.xpos, c.ypos);
        },
        { f, where },
    );
    await page.waitForTimeout(1600);
    return page.evaluate(() => ({ ...window.__dwu.view.galaxyMarkers.links.stats, visible: window.__dwu.view.galaxyMarkers.links.root.visible, f: 1 / window.__dwu.camera.zoom }));
}

try {
    await page.goto(url);
    await page.waitForFunction(() => window.__dwu?.time !== undefined && window.__dwu?.view?.galaxyMarkers && window.__dwu?.galaxy?.playerEmpire, null, { timeout: 900000 });
    await page.evaluate(() => {
        window.__dwu.time.paused = false;
        window.__dwu.time.speed = 4;
    });
    // Long enough for every empire's first long-processing pass (EvaluateSystemLinks) on a new game.
    await page.waitForTimeout(load ? 5000 : 20000);
    await page.evaluate(() => {
        window.__dwu.time.paused = true;
    });
    await page.waitForTimeout(3000);

    const census = await page.evaluate(() => {
        const g = window.__dwu.galaxy;
        let links = 0;
        let between = 0;
        const empires = new Set();
        for (const e of g.empires) {
            if (e === null) continue;
            for (const sv of e.systemVisibility) {
                for (const h of sv.linkSystemStars ?? []) {
                    if (h == null) continue;
                    links++;
                    if (h !== sv.systemStar) {
                        between++;
                        empires.add(e.empireId);
                    }
                }
            }
        }
        return { systems: g.systems.length, empires: g.empires.filter((e) => e !== null).length, links, between, linkingEmpires: empires.size };
    });
    console.log(`network on the ${inThread ? 'in-thread game' : 'replica'}: ${JSON.stringify(census)}`);

    const below = await view(140);
    check(!below.visible, `f = 140: no lines (f > 150 gate) ${JSON.stringify(below)}`);
    await shot('f140');
    for (const f of [200, 600, 2000, 6000]) {
        const s = await view(f);
        check(s.visible, `f = ${f}: lines shown, ${s.drawn} lines / ${s.pieces} pieces (network ${s.network})`);
        await shot(`f${f}`);
    }
    const whole = await view('min', 'centre');
    console.log(`whole galaxy (f = ${Math.round(whole.f)}): ${whole.drawn} lines / ${whole.pieces} pieces`);
    await shot('galaxy');
    if (census.between > 0) check(whole.drawn > 0, 'whole galaxy: some lines drawn');

    // --- timings ---
    const perf = await page.evaluate(async () => {
        const d = window.__dwu;
        const layer = d.view.galaxyMarkers.links;
        const cam = d.camera;
        const res = {};
        const t0 = performance.now();
        for (let i = 0; i < 20; i++) layer.refresh();
        res.collectMs = +((performance.now() - t0) / 20).toFixed(3);
        res.network = layer.stats.network;
        const p = d.galaxy.playerEmpire;
        const c = p.capital ?? p.colonies[0];
        res.build = {};
        for (const f of [200, 600, 2000, 6000, 'min']) {
            cam.centerOn(f === 'min' ? d.galaxy.sizeX / 2 : c.xpos, f === 'min' ? d.galaxy.sizeY / 2 : c.ypos);
            cam.zoomAt(f === 'min' ? cam.minZoom : 1 / f, cam.width / 2, cam.height / 2);
            const z = cam.zoom;
            const ff = 1 / z;
            let worst = 0;
            const t1 = performance.now();
            for (let i = 0; i < 20; i++) {
                layer.key.z = NaN; // force a rebuild
                const a = performance.now();
                layer.update(ff, z, cam, true);
                worst = Math.max(worst, performance.now() - a);
            }
            res.build[f === 'min' ? `min(${Math.round(ff)})` : f] = { avgMs: +((performance.now() - t1) / 20).toFixed(3), worstMs: +worst.toFixed(3), lines: layer.stats.drawn, pieces: layer.stats.pieces };
        }
        // A continuous zoom sweep (what a mouse-wheel zoom costs per frame): 120 frames from f = 160 to the whole galaxy.
        cam.centerOn(c.xpos, c.ypos);
        const builds0 = layer.stats.builds;
        let sweepWorst = 0;
        let sweepSum = 0;
        const fMin = 1 / cam.minZoom;
        for (let i = 0; i < 120; i++) {
            const ff = 160 * Math.pow(fMin / 160, i / 119);
            cam.zoomAt(1 / ff, cam.width / 2, cam.height / 2);
            const a = performance.now();
            layer.update(1 / cam.zoom, cam.zoom, cam, true);
            const ms = performance.now() - a;
            sweepSum += ms;
            sweepWorst = Math.max(sweepWorst, ms);
        }
        res.sweep = { frames: 120, builds: layer.stats.builds - builds0, avgMs: +(sweepSum / 120).toFixed(3), worstMs: +sweepWorst.toFixed(3) };
        // An unchanged frame (no rebuild).
        const t2 = performance.now();
        for (let i = 0; i < 200; i++) layer.update(1 / cam.zoom, cam.zoom, cam, true);
        res.idleFrameMs = +((performance.now() - t2) / 200).toFixed(4);
        return res;
    });
    console.log(`perf: ${JSON.stringify(perf)}`);
    await page.waitForTimeout(500);
} catch (e) {
    console.log(`FAIL ${e.stack ?? e}`);
    failed++;
} finally {
    const bad = logs.filter((l) => !/GPU stall|WebGL|swiftshader|Automatic fallback/i.test(l));
    for (const l of bad.slice(0, 30)) console.log(l);
    console.log(`console errors/warnings: ${bad.length}`);
    console.log(`shots:\n${shots.join('\n')}`);
    await browser.close();
    process.exit(failed > 0 ? 1 : 0);
}
