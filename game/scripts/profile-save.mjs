#!/usr/bin/env node
// Profile the sim from a saved game (serializeGame text, e.g. from scripts/lategame-start.mjs --save --save-out): load it,
// optionally warm up, then run --seconds game seconds at --speed and print ms per sim step (wall and process CPU), the
// per-pass tick profile (setTickProfile) and the state digest (so a behaviour-preserving optimisation can be checked:
// the digest after the run must not change).
//
//   node [--cpu-prof --cpu-prof-dir=DIR] scripts/profile-save.mjs <save> [--warm 5] [--seconds 30] [--speed 1]
//        [--passes 25] [--keep-bundle DIR] [--alloc-prof out.heapprofile] [--save-hash] [--digest-every N]
// A scenario / composite add-on save is loaded with its overlay applied (as main.ts gameDataForSave).
// --save-hash: print a sha256 of serializeGame(game) after the run (save-text identity check).
// --alloc-prof: sampling allocation profile of the measured run, including objects already collected (allocation
// throughput by site, not just what is still live); summarise with scripts/heapprofile-summary.mjs.
// Summarise a .cpuprofile with scripts/cpuprofile-summary.mjs <file> --under runGameSeconds.
import { build } from 'rolldown';
import { tmpdir } from 'node:os';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function arg(name, fallback) {
    const i = process.argv.indexOf(`--${name}`);
    if (i < 0) return fallback;
    const v = process.argv[i + 1];
    return v === undefined || v.startsWith('--') ? true : v;
}
const file = process.argv[2];
if (!file || file.startsWith('--')) throw new Error('usage: profile-save.mjs <save> [--seconds 30]');
const warm = Number(arg('warm', 5));
const seconds = Number(arg('seconds', 30));
const speed = Number(arg('speed', 1));
const nPasses = Number(arg('passes', 25));
const keepBundle = arg('keep-bundle', null);
const allocProf = arg('alloc-prof', null);
const saveHash = arg('save-hash', false);
// --digest-every N: print the state digest every N steps of the measured run (outcome-identity check of an optimisation).
const digestEvery = Number(arg('digest-every', 0));
// --offscreen original|higher|adaptive[:batch]: set the game's off-screen update rate (the setOffscreenUpdateRate
// command's effect, applied after loading) before the run.
const offscreen = arg('offscreen', null);
// --spikes N: list the N slowest steps of the measured run with their per-pass wall ms.
const spikes = Number(arg('spikes', 0));

const MODULES = { game: '/src/sim/game.ts', load: '/test/helpers/loadGameDataFs.ts', harness: '/src/sim/tick/harness.ts', save: '/src/sim/save/gameSave.ts', digest: '/src/sim/tick/digest.ts',
    scen: '/test/helpers/scenarioGame.ts', addons: '/src/sim/scenario/addons.ts', overlay: '/src/sim/scenario/overlay.ts' };
const bundleDir = mkdtempSync(resolve(tmpdir(), 'dwu-profile-sim-'));
try {
    await build({ cwd: root, input: Object.fromEntries(Object.entries(MODULES).map(([k, v]) => [k, '.' + v])), platform: 'node',
        transform: { define: { __dirname: JSON.stringify(resolve(root, 'test/helpers')) } },
        output: { dir: bundleDir, format: 'esm', preserveModules: true, preserveModulesRoot: root }, write: true, logLevel: 'warn' });
    const load = (key) => import(resolve(bundleDir, key + '.js'));
    const { installGameStatics, registerGameHooks } = await load('game'); // first: module-cycle entry as in the app
    const { loadGameDataFs } = await load('load');
    const { runGameSeconds } = await load('harness');
    const { deserializeGame } = await load('save');
    const { stateDigest, stateCounts } = await load('digest');
    const { savedScenarioId, savedScenarioInclude } = await load('save');
    const { scenarioOverlaysFs } = await load('scen');
    const { scenarioOverlayFor, COMPOSITE_SCENARIO_ID } = await load('addons');
    const { applyScenarioOverlay } = await load('overlay');
    const t0 = performance.now();
    const obj = JSON.parse(readFileSync(file, 'utf8'));
    // Mod layer: the save's scenario overlay (a composite add-on save is rebuilt from its include list), as main.ts gameDataForSave.
    let gameData = await loadGameDataFs();
    const scenId = savedScenarioId(obj);
    if (scenId !== null) gameData = applyScenarioOverlay(gameData, scenarioOverlayFor(scenId, scenId === COMPOSITE_SCENARIO_ID ? savedScenarioInclude(obj) : null, scenarioOverlaysFs()));
    installGameStatics(gameData);
    registerGameHooks();
    const { game, time, startOptions } = deserializeGame(obj, gameData);
    const g = game.galaxy;
    console.log(`loaded ${file} in ${(performance.now() - t0).toFixed(0)} ms: ${g.systems.length} systems, ${g.empires.length} empires, ${g.builtObjects.length} built objects; digest ${stateDigest(g)}`);
    if (offscreen !== null) {
        const { applyOffscreenUpdateCommand } = await import(resolve(bundleDir, 'src/sim/tick/offscreenUpdate.js'));
        const [mode, batch] = String(offscreen).split(':');
        console.log(`off-screen update rate ${mode}: ${applyOffscreenUpdateCommand(g, mode, batch === undefined ? undefined : Number(batch))} per frame`);
    }
    if (warm > 0) runGameSeconds(game, warm, { speed });
    let session = null;
    if (allocProf !== null) {
        const { Session } = await import('node:inspector/promises');
        session = new Session();
        session.connect();
        await session.post('HeapProfiler.enable');
        await session.post('HeapProfiler.startSampling', { samplingInterval: 16384, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
    }
    const cpu0 = process.cpuUsage();
    const w0 = performance.now();
    const stepMs = [];
    const timings = {};
    let prevTimings = {};
    const slow = [];
    let last = performance.now();
    const onFrame = (gal, n) => {
        const now = performance.now();
        stepMs.push(now - last);
        if (spikes > 0) {
            const d = {};
            for (const [k, v] of Object.entries(timings)) { const x = v - (prevTimings[k] ?? 0); if (x >= 0.5) d[k] = +x.toFixed(1); }
            prevTimings = { ...timings };
            slow.push({ n, ms: now - last, d });
            if (slow.length > 4 * spikes) { slow.sort((a, b) => b.ms - a.ms); slow.length = spikes; }
        }
        if (digestEvery > 0 && n % digestEvery === 0) console.log(`  step ${n} digest ${stateDigest(gal)} rnd ${gal.rnd.drawCount}`);
        last = performance.now();
    };
    const r = runGameSeconds(game, seconds, { speed, profileClock: () => performance.now(), onFrame, timings });
    const wall = performance.now() - w0;
    const c = process.cpuUsage(cpu0);
    if (session !== null) {
        const { profile } = await session.post('HeapProfiler.stopSampling');
        (await import('node:fs')).writeFileSync(String(allocProf), JSON.stringify(profile));
        session.disconnect();
    }
    const cpu = (c.user + c.system) / 1000;
    console.log(`ran ${seconds} game s at ${speed}x: ${r.frames} steps, ${(wall / r.frames).toFixed(2)} wall ms/step, ${(cpu / r.frames).toFixed(2)} cpu ms/step (${(wall / 1000).toFixed(1)} s wall)`);
    const sorted = [...stepMs].sort((a, b) => a - b);
    const q = (f) => sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))];
    console.log(`step ms: mean ${(stepMs.reduce((a, b) => a + b, 0) / stepMs.length).toFixed(2)} p50 ${q(0.5).toFixed(2)} p95 ${q(0.95).toFixed(2)} p99 ${q(0.99).toFixed(2)} max ${sorted[sorted.length - 1].toFixed(2)}`);
    if (spikes > 0) {
        slow.sort((a, b) => b.ms - a.ms);
        for (const x of slow.slice(0, spikes)) console.log(`  slow step ${x.n}: ${x.ms.toFixed(1)} ms ${JSON.stringify(x.d)}`);
    }
    const total = Object.values(r.timings).reduce((a, b) => a + b, 0);
    console.log(`tick passes (wall, ${total.toFixed(0)} ms total, may nest):`);
    for (const [k, v] of Object.entries(r.timings).sort((a, b) => b[1] - a[1]).slice(0, nPasses))
        console.log(`  ${v.toFixed(0).padStart(7)} ms ${((100 * v) / wall).toFixed(1).padStart(5)}%  ${(v / r.frames).toFixed(3)} ms/step  ${k}`);
    if (globalThis.__c) console.log("COUNTERS", JSON.stringify(globalThis.__c));
    console.log(`digest ${stateDigest(g)} rnd ${g.rnd.drawCount} counts ${JSON.stringify(stateCounts(g))}`);
    if (saveHash) {
        const { serializeGame } = await load('save');
        const { createHash } = await import('node:crypto');
        console.log(`save sha256 ${createHash('sha256').update(serializeGame(game, time, startOptions)).digest('hex')}`);
    }
} finally {
    if (keepBundle) cpSync(bundleDir, String(keepBundle), { recursive: true });
    rmSync(bundleDir, { recursive: true, force: true });
}
