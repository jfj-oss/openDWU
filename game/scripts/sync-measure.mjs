#!/usr/bin/env node
// Sim worker sync cost on a saved game (docs/sim-worker.md §5): load the save, build the worker-side sync source and a
// main-side replica in this process, then run --steps sim steps and after each one diff + apply the delta. Prints the
// snapshot size / cost, then per step: worker diff ms, delta bytes, main-thread apply ms (mean / p95 / max), hot and
// cold object counts, and the most-changed fields. --verify serializes the replica and the authoritative galaxy after
// a full cold compare and checks that the two galaxies' save bytes (format 3) and state digests are identical. The
// snapshot is taken as the worker takes it (streamed in chunks, each cloned with its transfers; --whole: one delta),
// with its encode / apply time, GC, and the heap of each side (run node with --expose-gc for exact heap figures).
//
//   node scripts/sync-measure.mjs <save> --resave <out>   (write the loaded game in the current save format and exit)
//   node --expose-gc scripts/sync-measure.mjs <save> [--steps 300] [--speed 1] [--warm 60] [--cold-ms 3] [--pump-ms 0.5] [--hot-fields] [--compare-options] [--verify] [--census]
//        [--whole] [--chunk-codes N] [--strstats]
//   node scripts/sync-measure.mjs <save> --client [--steps 300] [--replies 30] [--steps-per-msg 1] [--frames 1] [--verify]   (host + client end to end)
import { build } from 'rolldown';
import { tmpdir } from 'node:os';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** Compare a replica galaxy with the authoritative one (set once the modules are loaded). */
let verifyReplica = null;
function arg(name, fallback) {
    const i = process.argv.indexOf(`--${name}`);
    if (i < 0) return fallback;
    const v = process.argv[i + 1];
    return v === undefined || v.startsWith('--') ? true : v;
}
const file = process.argv[2];
if (!file || file.startsWith('--')) throw new Error('usage: sync-measure.mjs <save> [--steps 300]');
const steps = Number(arg('steps', 300));
const speed = Number(arg('speed', 1));
const warm = Number(arg('warm', 0));
const coldBudgetMs = Number(arg('cold-ms', 3));
const pumpMs = Number(arg('pump-ms', 0.5));
const verify = arg('verify', false) === true;
const census = arg('census', false) === true;

const MODULES = {
    game: '/src/sim/game.ts',
    scen: '/test/helpers/scenarioGame.ts',
    addons: '/src/sim/scenario/addons.ts',
    overlay: '/src/sim/scenario/overlay.ts',
    sync: '/src/simworker/replicaSync.ts',
    load: '/test/helpers/loadGameDataFs.ts',
    save: '/src/sim/save/gameSave.ts',
    galaxySave: '/src/sim/save/galaxySave.ts',
    scheduler: '/src/sim/tick/scheduler.ts',
    digest: '/src/sim/tick/digest.ts',
    replica: '/src/simworker/replicaGalaxy.ts',
    host: '/src/simworker/simHost.ts',
    client: '/src/simworker/clientCore.ts',
    commands: '/src/sim/player/playerCommands.ts',
    galaxyTime: '/src/sim/galaxyTime.ts',
};
const bundleDir = mkdtempSync(resolve(tmpdir(), 'dwu-sync-measure-'));
const stat = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    const mean = s.reduce((a, b) => a + b, 0) / Math.max(1, s.length);
    return { mean, p50: s[Math.floor(s.length * 0.5)] ?? 0, p95: s[Math.floor(s.length * 0.95)] ?? 0, max: s[s.length - 1] ?? 0 };
};
const fmt = (o, d = 2) => `mean ${o.mean.toFixed(d)} p50 ${o.p50.toFixed(d)} p95 ${o.p95.toFixed(d)} max ${o.max.toFixed(d)}`;
try {
    await build({ cwd: root, input: Object.fromEntries(Object.entries(MODULES).map(([k, v]) => [k, '.' + v])), platform: 'node',
        transform: { define: { __dirname: JSON.stringify(resolve(root, 'test/helpers')) } },
        output: { dir: bundleDir, format: 'esm', preserveModules: true, preserveModulesRoot: root }, write: true, logLevel: 'warn' });
    const load = (key) => import(resolve(bundleDir, key + '.js'));
    const { installGameStatics, registerGameHooks } = await load('game'); // first: module-cycle entry as in the app
    const { loadGameDataFs } = await load('load');
    const { deserializeGame } = await load('save');
    const { galaxyToJSON, galaxyToSaveChunks } = await load('galaxySave');
    verifyReplica = (auth, rep) => {
        // The galaxies' save bytes (format 3) — identical when the replica is exact — and their state digests.
        const bytes = (gx) => Buffer.concat(galaxyToSaveChunks(gx));
        const a = bytes(auth);
        const b = bytes(rep);
        let at = -1;
        const n = Math.min(a.length, b.length);
        for (let i = 0; i < n; i++) if (a[i] !== b[i]) { at = i; break; }
        if (at < 0 && a.length !== b.length) at = n;
        const da = stateDigest(auth);
        const db = stateDigest(rep);
        console.log(at < 0 && da === db ? `verify: replica save bytes identical (${(a.length / 1048576).toFixed(0)} MB); digest ${da} / replica ${db}` : `verify: MISMATCH at byte ${at} (digest ${da} / replica ${db}): auth …${a.subarray(Math.max(0, at - 200), at + 100).toString()}…\n replica …${b.subarray(Math.max(0, at - 200), at + 100).toString()}…`);
        if (at >= 0 || da !== db) process.exitCode = 1;
    };
    const { runSimFrame, nextFrameMs, schedulerState } = await load('scheduler');
    const { stateDigest } = await load('digest');
    const { GalaxySyncSource, GalaxyReplica } = await load('replica');
    const { savedScenarioId, savedScenarioInclude } = await load('save');
    const { scenarioOverlaysFs } = await load('scen');
    const { scenarioOverlayFor, COMPOSITE_SCENARIO_ID } = await load('addons');
    const { applyScenarioOverlay } = await load('overlay');
    const { deltaTransferables } = await load('sync');
    let t0 = performance.now();
    // A .dwusave / in-game save is gzip since saveCompression.ts (magic bytes 1f 8b); older ones are plain JSON.
    const raw = readFileSync(file);
    let saveObj = JSON.parse((raw.length >= 2 && raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw).toString('utf8'));
    let gameData = await loadGameDataFs();
    const scenId = savedScenarioId(saveObj);
    if (scenId !== null) gameData = applyScenarioOverlay(gameData, scenarioOverlayFor(scenId, scenId === COMPOSITE_SCENARIO_ID ? savedScenarioInclude(saveObj) : null, scenarioOverlaysFs()));
    installGameStatics(gameData);
    registerGameHooks();
    const { game, time: savedTime, startOptions: savedStart } = deserializeGame(saveObj, gameData);
    saveObj = null;
    if (typeof arg('resave', false) === 'string') {
        // --resave <file>: write the loaded game in the current save format (format 3), plain text.
        const { serializeGameChunks } = await load('save');
        writeFileSync(arg('resave'), Buffer.concat(serializeGameChunks(game, savedTime, savedStart)));
        console.log(`resaved to ${arg('resave')}`);
        process.exit(0);
    }
    const g = game.galaxy;
    console.log(`loaded ${file} in ${(performance.now() - t0).toFixed(0)} ms: ${g.systems.length} systems, ${g.builtObjects.length} built objects, ${g.creatures.length} creatures`);
    const step = () => runSimFrame(g, nextFrameMs(schedulerState(g), speed));
    for (let i = 0; i < warm; i++) step();
    if (arg('client', false) === true) {
        await clientMode(game, gameData, { load, stat, fmt, galaxyToJSON, stateDigest });
        process.exit(process.exitCode ?? 0);
    }

    const { PerformanceObserver } = await import('node:perf_hooks');
    let gcMs = 0;
    new PerformanceObserver((list) => { for (const e of list.getEntries()) gcMs += e.duration; }).observe({ entryTypes: ['gc'] });
    const gcNow = async () => { await new Promise((r) => setTimeout(r, 0)); const x = gcMs; gcMs = 0; return x; };
    await gcNow();
    const cpu = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };
    let c0 = cpu();
    const cpuSince = () => { const c = cpu(); const d = c - c0; c0 = c; return d.toFixed(0); };
    const mem = () => { globalThis.gc?.(); const m = process.memoryUsage(); return { heap: m.heapUsed / 1048576, ext: (m.external + m.arrayBuffers) / 1048576 }; };
    const fmtMem = (m) => `heap ${m.heap.toFixed(0)} MB, external+buffers ${m.ext.toFixed(0)} MB`;
    const memBefore = mem();
    // The snapshot as the worker posts it: in chunks (--whole: one delta), each structured-cloned with its transfers.
    const chunked = arg('whole', false) !== true;
    const chunks = [];
    let chunkMs = 0;
    let snapBytes = 0;
    let snapShapes = 0;
    const emit = (d) => {
        const a = performance.now();
        snapBytes += d.stats.bytes;
        snapShapes += d.shapes.length;
        chunks.push(structuredClone(d, { transfer: deltaTransferables(d) }));
        chunkMs += performance.now() - a;
    };
    await gcNow();
    cpuSince();
    t0 = performance.now();
    const source = new GalaxySyncSource(g, { coldBudgetMs, ...(chunked ? { snapshotChunks: { codes: Number(arg('chunk-codes', 1 << 22)), emit } } : {}) });
    const tCtor = performance.now() - t0 - chunkMs;
    const snap = source.snapshot(true);
    const tEnc = performance.now() - t0 - chunkMs;
    snapBytes += snap.stats.bytes;
    snapShapes += snap.shapes.length;
    console.log(`snapshot encode: ${tEnc.toFixed(0)} ms (discovery walk ${tCtor.toFixed(0)} ms, snapshot() ${(tEnc - tCtor).toFixed(0)} ms), GC ${(await gcNow()).toFixed(0)} ms, process CPU ${cpuSince()} ms; ${chunks.length + 1} part(s), ${(snapBytes / 1048576).toFixed(0)} MB, ${snapShapes} shapes; clone of the chunks ${chunkMs.toFixed(0)} ms`);
    const memEnc = mem();
    console.log(`  worker side after the encode (game + encoder${chunked ? ' + the chunks in flight' : ''}): ${fmtMem(memEnc)} (encoder +${(memEnc.heap - memBefore.heap).toFixed(0)} MB heap)`);
    if (arg('markdbg', false) === true) {
        console.log(`markdbg: mark right after snapshot dropped ${source.encoder.mark()}`);
        for (let i = 0; i < 50; i++) { step(); source.delta(); }
        console.log(`markdbg: after 50 steps: dropped ${source.encoder.mark()} (live ${source.encoder.size})`);
        source.delta(true);
        console.log(`markdbg: after full: dropped ${source.encoder.mark()} (live ${source.encoder.size})`);
        process.exit(0);
    }
    const tSnap = tEnc;
    console.log(`snapshot: ${source.encoder.size} objects (${source.encoder.hotCount} hot), ${(snapBytes / 1048576).toFixed(1)} MB, ${tSnap.toFixed(0)} ms to encode`);
    if (arg('strstats', false) === true) {
        const all = [...snap.hot.strs, ...snap.cold.strs];
        const freq = new Map();
        let chars = 0;
        for (const x of all) { chars += x.length; freq.set(x, (freq.get(x) ?? 0) + 1); }
        console.log(`strings: ${all.length}, unique ${freq.size}, chars ${chars}; top: ${[...freq].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => `${JSON.stringify(k.slice(0, 30))} ${v}`).join(', ')}`);
        const kinds = [0, 0, 0, 0, 0, 0];
        for (const sh of [snap.hot.shells, snap.cold.shells]) for (let i = 0; i < sh.length; ) { const k = sh[i]; kinds[k]++; i += k === 5 ? 4 : k === 3 || k === 4 ? 2 : 3; }
        console.log(`shells by kind (class plain array map set typed): ${kinds.join(' ')}`);
        const tl = [...snap.hot.typed, ...snap.cold.typed];
        console.log(`typed: ${tl.length}, bytes ${tl.reduce((a, t) => a + t.byteLength, 0)}; shells ${snap.hot.shells.length + snap.cold.shells.length}, births ${snap.hot.births.length + snap.cold.births.length} codes, birthNums ${snap.hot.birthNums.length + snap.cold.birthNums.length}, body ${snap.hot.body.length + snap.cold.body.length}, bodyNums ${snap.hot.bodyNums.length + snap.cold.bodyNums.length}`);
    }
    if (census) {
        const c = source.encoder.census();
        for (const [k, v] of Object.entries(c).sort((a, b) => b[1].hot - a[1].hot || b[1].count - a[1].count).slice(0, 50)) console.log(`  ${String(v.count).padStart(9)} (${String(v.hot).padStart(8)} hot) ${k}`);
    }
    // Structured clone, as postMessage does (minus the transfer of the Float64 streams).
    t0 = performance.now();
    cpuSince();
    const cloned = structuredClone(snap, { transfer: deltaTransferables(snap) });
    console.log(`snapshot structuredClone (with transfers, as postMessage): ${(performance.now() - t0).toFixed(0)} ms`);
    const replica = new GalaxyReplica(gameData, g.baseTechCost);
    await gcNow();
    cpuSince();
    t0 = performance.now();
    let chunkApplyMs = 0;
    while (chunks.length > 0) {
        const a = performance.now();
        replica.applyChunk(chunks.shift());
        chunkApplyMs = Math.max(chunkApplyMs, performance.now() - a);
    }
    replica.apply(cloned, true);
    const tApply = performance.now() - t0;
    console.log(`snapshot apply (main): ${tApply.toFixed(0)} ms (GC ${(await gcNow()).toFixed(0)} ms; process CPU ${cpuSince()} ms; longest chunk ${chunkApplyMs.toFixed(0)} ms), replica ${replica.decoder.size} objects`);
    const memApp = mem();
    console.log(`  main side: replica +${(memApp.heap - memEnc.heap).toFixed(0)} MB heap; both sides now ${fmtMem(memApp)}, max RSS ${(process.resourceUsage().maxRSS / 1024).toFixed(0)} MB`);

    if (arg('compare-options', false) === true) {
        // Option A (naive): compare the WHOLE graph after every step.
        const fullDiff = [], fullApply = [], fullKB = [];
        for (let i = 0; i < 10; i++) {
            step();
            const d = source.delta(true);
            fullDiff.push(d.stats.diffMs);
            fullKB.push(d.stats.bytes / 1024);
            fullApply.push(replica.apply(structuredClone(d), true).applyMs);
        }
        console.log(`option A-naive, full compare every step (10 steps): worker diff ms ${fmt(stat(fullDiff))}; delta KB ${fmt(stat(fullKB), 0)}; main apply ms ${fmt(stat(fullApply))}`);
        // Option B: typed-array snapshot of the hot per-frame fields (ships, creatures, fighters, shots).
        const packMs = [], unpackMs = [], snapKB = [];
        for (let i = 0; i < 30; i++) {
            step();
            const t1 = performance.now();
            const bos = g.builtObjects.filter((b) => b != null);
            const shots = [];
            const fighters = [];
            for (const b of bos) {
                for (const w of b.weapons ?? []) shots.push(w);
                for (const f of b.fighters ?? []) fighters.push(f);
            }
            const N = bos.length, C = g.creatures.length, F = fighters.length, W = shots.length;
            const buf = new Float64Array(N * 12 + C * 10 + F * 8 + W * 6);
            let k = 0;
            for (const b of bos) { buf[k++] = b.builtObjectID; buf[k++] = b.xpos; buf[k++] = b.ypos; buf[k++] = b._heading; buf[k++] = b.currentSpeed; buf[k++] = b._targetSpeed; buf[k++] = b.targetHeading; buf[k++] = b.lastTouch; buf[k++] = b.parentOffsetX; buf[k++] = b.parentOffsetY; buf[k++] = b.hasBeenDestroyed ? 1 : 0; buf[k++] = b.hyperjumpCountdown; }
            for (const c of g.creatures) { buf[k++] = c.xpos; buf[k++] = c.ypos; buf[k++] = c.currentHeading; buf[k++] = c.currentSpeed; buf[k++] = c.targetHeading; buf[k++] = c.targetSpeed; buf[k++] = c.lastTouch; buf[k++] = c.parentX; buf[k++] = c.parentY; buf[k++] = c.hasBeenDestroyed ? 1 : 0; }
            for (const f of fighters) { buf[k++] = f.xpos; buf[k++] = f.ypos; buf[k++] = f.heading; buf[k++] = f.currentSpeed; buf[k++] = f.targetHeading; buf[k++] = f.lastTouch; buf[k++] = f.onboardCarrier ? 1 : 0; buf[k++] = f.hasBeenDestroyed ? 1 : 0; }
            for (const w of shots) { buf[k++] = w.x; buf[k++] = w.y; buf[k++] = w.heading; buf[k++] = w.distanceTravelled; buf[k++] = w.lastFired; buf[k++] = w._resetNext ? 1 : 0; }
            packMs.push(performance.now() - t1);
            snapKB.push(buf.byteLength / 1024);
            const t2 = performance.now();
            const moved = structuredClone(buf, { transfer: [buf.buffer] });
            let acc = 0;
            for (let j = 0; j < moved.length; j++) acc += moved[j];
            unpackMs.push(performance.now() - t2 + (acc === 1e300 ? 1 : 0));
        }
        console.log(`option B, typed-array snapshot of hot fields: worker pack ms ${fmt(stat(packMs))}; KB ${fmt(stat(snapKB), 0)}; main transfer+read ms ${fmt(stat(unpackMs))} (every consumer must be ported to read it)`);
        console.log(`option C, full replica refresh at 4-10 Hz: ${tSnap.toFixed(0)} ms encode + ${(snap.stats.bytes / 1048576).toFixed(0)} MB + main rebuild (snapshot lines above) per refresh; a delta refresh at that rate costs the full compare above per refresh`);
    }
    const forced = [], born = [], hotKB = [], pumpMsS = [], backlog = [], gated = [], hotMs = [], diffMs = [], applyMs = [], cloneMs = [], bytes = [], sets = [], fresh = [], stepMs = [];
    source.encoder.profile = {};
    for (let i = 0; i < steps; i++) {
        const s0 = performance.now();
        step();
        stepMs.push(performance.now() - s0);
        const before = { ...source.encoder.profile };
        const d = source.delta();
        if (d.stats.newObjects > (globalThis.__maxNew ?? 0)) {
            globalThis.__maxNew = d.stats.newObjects;
            globalThis.__maxNewProf = Object.entries(source.encoder.profile).map(([k, v]) => [k, v - (before[k] ?? 0)]).filter((x) => x[1] > 0 && x[0].startsWith('new')).sort((a, b) => b[1] - a[1]).slice(0, 12);
        }
        if (d.stats.sets > (globalThis.__maxSets ?? 0)) {
            globalThis.__maxSets = d.stats.sets;
            globalThis.__maxProf = Object.entries(source.encoder.profile).map(([k, v]) => [k, v - (before[k] ?? 0)]).filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 12);
        }
        diffMs.push(d.stats.diffMs);
        hotMs.push(d.stats.hotMs);
        gated.push(d.stats.gated);
        bytes.push(d.stats.bytes);
        sets.push(d.stats.sets);
        fresh.push(d.stats.newObjects);
        const c0 = performance.now();
        const dc = structuredClone(d);
        cloneMs.push(performance.now() - c0);
        const st = replica.apply(dc);
        if (st.applyMs > (globalThis.__maxHot ?? 0)) {
            globalThis.__maxHot = st.applyMs;
            globalThis.__maxHotInfo = `${st.applyMs.toFixed(1)} ms: ${st.newObjects} new, ${st.sets} sets, ${st.coldParts} forced cold parts, ${st.bornParts ?? 0} forced births, hot ${(d.stats.hotBytes / 1024).toFixed(0)} KB`;
        }
        applyMs.push(st.applyMs);
        forced.push(st.coldParts);
        born.push(st.bornParts ?? 0);
        hotKB.push(d.stats.hotBytes / 1024);
        // Four render frames per step at 240 Hz, each pumping the cold queue for --pump-ms.
        let pm = 0;
        for (let f = 0; f < 4; f++) {
            const ps = replica.pumpCold(pumpMs);
            pm = Math.max(pm, ps.applyMs);
        }
        pumpMsS.push(pm);
        backlog.push(replica.decoder.coldBacklog);
    }
    console.log(`${steps} steps at ${speed}x (cold budget ${coldBudgetMs} ms/step; ${source.encoder.cycleCount} cold cycles, last mark dropped ${source.encoder.lastDropped}):`);
    console.log(`  sim step ms      ${fmt(stat(stepMs))}`);
    console.log(`  worker diff ms   ${fmt(stat(diffMs))}`);
    console.log(`  of which hot ms  ${fmt(stat(hotMs))}`);
    console.log(`  gated (touched)  ${fmt(stat(gated), 0)}`);
    console.log(`  delta KB         ${fmt(stat(bytes.map((b) => b / 1024)), 1)}`);
    console.log(`  clone ms         ${fmt(stat(cloneMs))}`);
    console.log(`  main hot apply ms ${fmt(stat(applyMs))}  (cold parts forced by deps: ${fmt(stat(forced), 0)}; births only: ${fmt(stat(born), 0)})`);
    console.log(`  worst hot apply: ${globalThis.__maxHotInfo}`);
    console.log(`  hot part KB      ${fmt(stat(hotKB), 1)}`);
    console.log(`  main cold pump ms per frame (budget ${pumpMs}) ${fmt(stat(pumpMsS))}; cold backlog parts ${fmt(stat(backlog), 0)}`);
    console.log(`  field sets       ${fmt(stat(sets), 0)}`);
    console.log(`  new objects      ${fmt(stat(fresh), 0)}`);
    console.log(`  live objects ${source.encoder.size}, hot ${source.encoder.hotCount}`);
    const prof = Object.entries(source.encoder.profile).sort((a, b) => b[1] - a[1]).slice(0, 40);
    console.log('  most-set fields (per step):');
    for (const [k, v] of prof) console.log(`    ${(v / steps).toFixed(1).padStart(9)}  ${k}`);
    source.encoder.profile = null;
    console.log(`  most new objects (${globalThis.__maxNew}): ${globalThis.__maxNewProf.map(([k, v]) => `${k} ${v}`).join(', ')}`);
    console.log(`  biggest step (${globalThis.__maxSets} sets): ${globalThis.__maxProf.map(([k, v]) => `${k} ${v}`).join(', ')}`);
    if (arg('hot-fields', false) === true) for (const [k, v] of Object.entries(source.encoder.hotFields())) console.log(`  hot ${k}: ${v.length} fields: ${v.join(' ')}`);
    t0 = performance.now();
    const dropped = source.encoder.mark();
    console.log(`mark: ${(performance.now() - t0).toFixed(0)} ms, dropped ${dropped}`);
    t0 = performance.now();
    const reshaped = source.encoder.revalidateShapes();
    console.log(`revalidate shapes: ${(performance.now() - t0).toFixed(0)} ms, ${reshaped} reshaped`);
    t0 = performance.now();
    const full = source.delta(true);
    console.log(`full cold compare: ${(performance.now() - t0).toFixed(0)} ms, ${(full.stats.bytes / 1024).toFixed(0)} KB`);
    replica.apply(structuredClone(full), true);
    if (verify) verifyReplica(g, replica.galaxy);
} finally {
    if (process.env.SYNC_MEASURE_KEEP_BUNDLE) console.log(`bundle kept: ${bundleDir}`);
    else rmSync(bundleDir, { recursive: true, force: true });
}

/**
 * --client: the whole pipeline in this process, as the browser runs it — SimHost (the worker side: tick, diff, the step
 * message) and SimClientCore (the main thread: frame() applies the message, pumps the cold queue, settles command
 * replies), each message structured-cloned as postMessage copies it. Every --replies steps the replica's player issues
 * a command with a reply (obtainUiRecords, which changes nothing), as the HUD does. Reports the main thread's work per
 * render frame (frame() wall ms: hot apply + cold pump + replies + side tables), the spikes, the reply latency, and the
 * worker's diff / bytes per message. --steps-per-msg K: the worker runs K steps per tick (it is behind); --frames N:
 * render frames per message.
 */
async function clientMode(game, gameData, { load, stat, fmt, galaxyToJSON, stateDigest }) {
    const { SimHost } = await load('host');
    const { SimClientCore } = await load('client');
    const { issuePlayerCommand } = await load('commands');
    const { GalaxyTime } = await load('galaxyTime');
    const { FRAME_REAL_MS } = await load('scheduler');
    const k = Number(arg('steps-per-msg', 1));
    const framesPerMsg = Number(arg('frames', 1));
    const replyEvery = Number(arg('replies', 30));
    const msgs = Math.ceil(steps / k);
    let ft = 0;
    const fake = () => (ft += 0.001);
    const time = new GalaxyTime();
    time.paused = false;
    time.speed = speed;
    const host = new SimHost(game, time, {}, { now: fake, sync: { coldBudgetMs } });
    let t0 = performance.now();
    const snap = host.snapshot();
    console.log(`client mode: snapshot ${(performance.now() - t0).toFixed(0)} ms encode`);
    const toHost = (m) => {
        const c = structuredClone(m);
        if (c.type === 'command') host.command(c);
        else if (c.type === 'clock') host.clock(c);
        else if (c.type === 'refresh') host.refresh(c);
    };
    t0 = performance.now();
    const client = new SimClientCore(gameData, structuredClone(snap), { post: toHost, coldBudgetMs: pumpMs });
    console.log(`client mode: replica built in ${(performance.now() - t0).toFixed(0)} ms`);
    const ui = new GalaxyTime();
    ui.bindGalaxy(client.galaxy);
    ui.speed = speed;
    ui.paused = false;
    client.bindClock(ui);
    const frameMs = [], hotMs = [], coldMs = [], tickMs = [], diffMs = [], workerHotMs = [], hotKB = [], kb = [], backlog = [], replyFrames = [], replyFrameMs = [];
    let frame = 0;
    let issued = 0, answered = 0;
    const s = client.stats;
    for (let i = 0; i < msgs; i++) {
        if (replyEvery > 0 && i % replyEvery === 0) {
            const at = frame;
            issued++;
            issuePlayerCommand(client.galaxy, client.game.playerEmpire, 'obtainUiRecords', [[]], () => {
                answered++;
                replyFrames.push(frame - at);
                replyFrameMs.push(-1);
            });
        }
        const w0 = performance.now();
        const m = host.tick(FRAME_REAL_MS * k);
        tickMs.push(performance.now() - w0);
        if (m !== null) {
            diffMs.push(m.diffMs);
            workerHotMs.push(m.delta.stats.hotMs);
            hotKB.push(m.delta.stats.hotBytes / 1024);
            kb.push(m.delta.stats.bytes / 1024);
            client.receive(structuredClone(m));
        }
        for (let f = 0; f < framesPerMsg; f++) {
            frame++;
            const h0 = s.hotApplyMs, c0 = s.coldPumpMs;
            const a = performance.now();
            client.frame(ui);
            const dt = performance.now() - a;
            frameMs.push(dt);
            hotMs.push(s.hotApplyMs - h0);
            coldMs.push(s.coldPumpMs - c0);
            backlog.push(client.replica.decoder.coldBacklog);
            for (let r = 0; r < replyFrameMs.length; r++) if (replyFrameMs[r] < 0) replyFrameMs[r] = dt;
        }
    }
    // Let the last replies land.
    for (let f = 0; f < 600 && answered < issued; f++) {
        frame++;
        client.frame(ui);
    }
    const over = (xs, ms) => xs.filter((x) => x > ms).length;
    console.log(`${msgs} messages × ${k} step(s), ${framesPerMsg} frame(s) per message, a reply every ${replyEvery} messages (${answered}/${issued} answered):`);
    console.log(`  worker tick ms (step + diff) ${fmt(stat(tickMs))}`);
    console.log(`  worker diff ms   ${fmt(stat(diffMs))}`);
    console.log(`  of which hot ms  ${fmt(stat(workerHotMs))}`);
    console.log(`  delta KB         ${fmt(stat(kb), 1)}`);
    console.log(`  hot part KB      ${fmt(stat(hotKB), 1)}`);
    console.log(`  main frame() ms  ${fmt(stat(frameMs))}; frames over 4 / 8 / 16 ms: ${over(frameMs, 4)} / ${over(frameMs, 8)} / ${over(frameMs, 16)} of ${frameMs.length}`);
    console.log(`  of which hot apply ms ${fmt(stat(hotMs))}`);
    console.log(`  of which cold pump ms ${fmt(stat(coldMs))}`);
    console.log(`  cold backlog parts ${fmt(stat(backlog), 0)}`);
    console.log(`  reply latency frames ${fmt(stat(replyFrames), 1)}; frame() ms of the frame that answered ${fmt(stat(replyFrameMs))}`);
    if (verify) {
        const full = host.sync.delta(true);
        client.replica.apply(structuredClone(full), true);
        verifyReplica(game.galaxy, client.galaxy);
    }
    client.dispose();
    host.dispose();
}
