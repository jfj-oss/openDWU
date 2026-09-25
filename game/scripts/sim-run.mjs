#!/usr/bin/env node
// Headless sim run (tasks/M4-plan.md §5.2, §5.3.7): createGame + runGameSeconds, then print the state digest, entity
// counts, Galaxy.Rnd draws, TODO(port) stubs reached, wall ms, and (with --profile) ms per frame-driver pass plus ms
// per tick entry point / subsystem (V8 sampling profiler over the run only — no code in src/sim is touched).
//
//   node --expose-gc scripts/sim-run.mjs --seed 1 --stars 700 --empires 10 --seconds 600
//        [--age 1] [--tech 0.5] [--pirates 1] [--chunk 60] [--profile] [--top 15] [--json out.json]
//
// Defaults match test/helpers/tickGame.ts (age 1, tech 0.5, pirates 1) so `--stars 300 --empires 4 --seconds 600`
// reproduces the tickDeterminism pin. The run is driven in `--chunk`-second runGameSeconds calls (chunking is
// digest-neutral, see test/tickDeterminism.test.ts); an exception inside a chunk is recorded with its stack and the
// driver continues with the next chunk (soak mode — the sim itself is not wrapped). With `--split a,b` the run is two
// runGameSeconds calls of a and b seconds (determinism check: 300,300 vs 600).
//
// The TS sources are bundled with rolldown (Vite's bundler) into a temp dir and imported as plain ESM, so cross-module
// calls are direct like in the app build. `--loader vite` uses Vite's SSR module loader instead (as vitest does): every
// imported binding is then read through a getter on the module namespace, which inflates per-call cost ~1.5x and skews
// the profile toward call-heavy functions.
import { createServer } from 'vite';
import { build } from 'rolldown';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { Session } from 'node:inspector/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, fallback) {
    const i = process.argv.indexOf(`--${name}`);
    if (i < 0) return fallback;
    const v = process.argv[i + 1];
    return v === undefined || v.startsWith('--') ? true : v;
}

const seed = Number(arg('seed', 1));
const stars = Number(arg('stars', 700));
const empires = Number(arg('empires', 10));
const seconds = Number(arg('seconds', 600));
const tech = Number(arg('tech', 0.5));
const age = Number(arg('age', 1));
const pirates = Number(arg('pirates', 1));
const chunk = Number(arg('chunk', 60));
const split = arg('split', null);
const profile = arg('profile', false) === true;
const top = Number(arg('top', 15));
const jsonOut = arg('json', null);
const loader = String(arg('loader', 'bundle'));
const sectors = Math.max(4, Math.min(15, Math.round(Math.sqrt(stars / 4.7))));

const heap = { peak: 0, sample() { const h = process.memoryUsage().heapUsed; if (h > this.peak) this.peak = h; return h; } };
const mb = (b) => (b / 1048576).toFixed(0) + ' MB';

// --- V8 CPU profile → ms per function (inclusive, recursion counted once) and per tick entry point.
const TICK_ROOTS = new Set(['empireDoTasks', 'empirePirateDoTasks', 'galaxyDoTasks', 'galaxyDoTasksTimeSensitive', 'builtObjectDoTasks',
    'habitatDoTasks', 'shipGroupDoTasks', 'creatureDoTasks', 'backgroundPass', 'drainQueue', 'runSimFrame']);
function analyseProfile(p) {
    const byId = new Map(p.nodes.map((n) => [n.id, n]));
    const parent = new Map();
    for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
    const dt = new Map();
    for (let i = 0; i < p.samples.length; i++) dt.set(p.samples[i], (dt.get(p.samples[i]) ?? 0) + (p.timeDeltas[i] ?? 0) / 1000);
    const label = (n) => { const f = n.callFrame; const file = f.url.replace(/^.*\/src\//, 'src/').replace(/^file:\/\//, ''); return `${f.functionName || '(anon)'} ${file}:${f.lineNumber + 1}`; };
    const self = new Map(), incl = new Map(), entry = new Map();
    for (const [id, ms] of dt) {
        let n = byId.get(id);
        self.set(label(n), (self.get(label(n)) ?? 0) + ms);
        const seen = new Set();
        let tickEntry = null;
        for (let cur = n; cur; cur = byId.get(parent.get(cur.id))) {
            const l = label(cur);
            if (!seen.has(l)) { seen.add(l); incl.set(l, (incl.get(l) ?? 0) + ms); }
            const par = byId.get(parent.get(cur.id));
            // Nearest call below a tick root = the subsystem entry point (e.g. "empireDoTasks > assignShipMissions").
            if (tickEntry === null && par && TICK_ROOTS.has(par.callFrame.functionName) && !TICK_ROOTS.has(cur.callFrame.functionName)) {
                tickEntry = `${par.callFrame.functionName} > ${cur.callFrame.functionName || '(anon)'}`;
            }
        }
        if (tickEntry !== null) entry.set(tickEntry, (entry.get(tickEntry) ?? 0) + ms);
    }
    const sorted = (m, filter = () => true) => [...m].filter(([k]) => filter(k)).sort((a, b) => b[1] - a[1]);
    return { entry: sorted(entry), self: sorted(self, (k) => !k.startsWith('(')), incl: sorted(incl, (k) => k.includes('src/sim/')) };
}

const MODULES = { game: '/src/sim/game.ts', types: '/src/sim/types.ts', load: '/test/helpers/loadGameDataFs.ts', harness: '/src/sim/tick/harness.ts',
    scheduler: '/src/sim/tick/scheduler.ts', digest: '/src/sim/tick/digest.ts' };
// test/helpers/loadGameDataFs.ts (the Node game-data loader the tests use) reads __dirname, which neither loader provides.
const dirnameDefine = { __dirname: JSON.stringify(resolve(root, 'test/helpers')) };
let server = null, bundleDir = null;
let load;
if (loader === 'vite') {
    server = await createServer({ root, logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', optimizeDeps: { noDiscovery: true }, define: dirnameDefine });
    load = (key) => server.ssrLoadModule(MODULES[key]);
} else {
    bundleDir = mkdtempSync(resolve(tmpdir(), 'dwu-sim-run-'));
    await build({ cwd: root, input: Object.fromEntries(Object.entries(MODULES).map(([k, v]) => [k, '.' + v])), platform: 'node', transform: { define: dirnameDefine },
        output: { dir: bundleDir, format: 'esm' }, write: true, logLevel: 'warn' });
    load = (key) => import(resolve(bundleDir, key + '.js'));
}
const out = { loader, seed, stars, empires, seconds, age, pirates, exceptions: [] };
try {
    const { createGame } = await load('game');
    const { GalaxyShape } = await load('types');
    const { loadGameDataFs } = await load('load');
    const { runGameSeconds } = await load('harness');
    const { schedulerState } = await load('scheduler');
    const { stateDigest, stateCounts } = await load('digest');

    const gameData = await loadGameDataFs();
    const s = (race) => ({ race, homeSystemFavourability: 'Normal', proximityDistance: 'Random', startLocation: '(Random)', age, techLevel: tech });
    let t = performance.now();
    const game = createGame({
        seed, shape: GalaxyShape.Spiral, starCount: stars, sectorWidth: sectors, sectorHeight: sectors,
        systemNames: Array.from({ length: stars }, (_, i) => `S${i}`), gameData, galaxyAge: age,
        player: s('Human'), aiEmpires: Array.from({ length: Math.max(0, empires - 1) }, () => s('(Random)')),
        piratePrevalence: pirates,
    });
    const createMs = performance.now() - t;
    const g = game.galaxy;
    console.log(`[${loader}] createGame: seed ${seed}, ${stars} stars (${sectors}x${sectors}), ${empires} empires, age ${age}, pirates ${pirates} — ${createMs.toFixed(0)} ms`);
    console.log('start digest', stateDigest(g), JSON.stringify(stateCounts(g)));
    globalThis.gc?.();
    const heapStart = heap.sample();

    let session = null;
    if (profile) {
        session = new Session();
        session.connect();
        await session.post('Profiler.enable');
        await session.post('Profiler.setSamplingInterval', { interval: 500 });
        await session.post('Profiler.start');
    }
    const plan = split !== null && split !== true ? String(split).split(',').map(Number) : [];
    if (plan.length === 0) for (let left = seconds; left > 0; left -= chunk) plan.push(Math.min(chunk, left));
    const timings = {}, todo = {}, chunks = [];
    let frames = 0, draws = 0;
    t = performance.now();
    for (const secs of plan) {
        const c0 = performance.now(), f0 = schedulerState(g).frames, d0 = g.rnd.drawCount;
        try {
            const r = runGameSeconds(g, secs, profile ? { profileClock: () => performance.now() } : {});
            for (const [k, v] of Object.entries(r.timings)) timings[k] = (timings[k] ?? 0) + v;
            for (const [k, v] of Object.entries(r.todoHits)) todo[k] = (todo[k] ?? 0) + v;
        } catch (e) {
            // Soak driver only: record, drop the half-drained worker queue, continue with the next chunk.
            out.exceptions.push({ atMs: g.nowMs, stack: String(e?.stack ?? e) });
            console.log(`EXCEPTION at game ms ${g.nowMs}:\n${e?.stack ?? e}`);
            schedulerState(g).queue.length = 0;
        }
        const f = schedulerState(g).frames - f0;
        frames += f; draws += g.rnd.drawCount - d0;
        const ms = performance.now() - c0;
        chunks.push({ endS: g.nowMs / 1000, frames: f, ms, msPerFrame: ms / Math.max(1, f), heap: heap.sample(), bo: g.builtObjects.length });
    }
    const runMs = performance.now() - t;
    let prof = null;
    if (session !== null) {
        const { profile: p } = await session.post('Profiler.stop');
        session.disconnect();
        prof = analyseProfile(p);
    }
    globalThis.gc?.();
    const heapEnd = heap.sample();

    const digest = stateDigest(g), counts = stateCounts(g);
    console.log(`ran ${seconds} game-s: ${frames} frames in ${runMs.toFixed(0)} ms (${(runMs / frames).toFixed(3)} ms/frame), Rnd draws ${draws}`);
    console.log('digest', digest, JSON.stringify(counts));
    const first = chunks[0], last = chunks[chunks.length - 1];
    console.log(`ms/frame first chunk ${first.msPerFrame.toFixed(3)} (to ${first.endS}s), last chunk ${last.msPerFrame.toFixed(3)} (to ${last.endS}s); builtObjects ${first.bo} → ${last.bo}`);
    console.log(`heap: start ${mb(heapStart)}, peak sampled ${mb(heap.peak)}, end after gc ${mb(heapEnd)}${globalThis.gc ? '' : ' (run with --expose-gc for gc-settled numbers)'}`);
    console.log(`exceptions: ${out.exceptions.length}`);
    const hits = Object.entries(todo).sort((a, b) => b[1] - a[1]);
    console.log(`TODO(port) stubs reached: ${hits.length}`);
    for (const [k, v] of hits.slice(0, 25)) console.log(`  ${String(v).padStart(10)}  ${k}`);
    if (profile) {
        console.log('wall ms per frame-driver pass (timer):');
        for (const [k, v] of Object.entries(timings).sort((a, b) => b[1] - a[1])) console.log(`  ${v.toFixed(1).padStart(10)}  ${k}`);
        console.log(`top ${top} tick entry points (sampled ms, inclusive):`);
        for (const [k, v] of prof.entry.slice(0, top)) console.log(`  ${v.toFixed(0).padStart(10)}  ${k}`);
        console.log(`top ${top} src/sim functions (sampled ms, inclusive):`);
        for (const [k, v] of prof.incl.slice(0, top)) console.log(`  ${v.toFixed(0).padStart(10)}  ${k}`);
        console.log(`top ${top} functions (sampled ms, self):`);
        for (const [k, v] of prof.self.slice(0, top)) console.log(`  ${v.toFixed(0).padStart(10)}  ${k}`);
    }
    Object.assign(out, { createMs, digest, counts, frames, rndDraws: draws, runMs, heapStart, heapPeak: heap.peak, heapEnd, todo, timings, chunks,
        profile: prof && { entry: prof.entry.slice(0, 60), incl: prof.incl.slice(0, 60), self: prof.self.slice(0, 60) } });
    if (jsonOut !== null) writeFileSync(String(jsonOut), JSON.stringify(out, null, 1));
} finally {
    await server?.close();
    if (bundleDir !== null) rmSync(bundleDir, { recursive: true, force: true });
}
