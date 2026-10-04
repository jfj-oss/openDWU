#!/usr/bin/env node
// Sim worker sync cost on a saved game (docs/sim-worker.md §5): load the save, build the worker-side sync source and a
// main-side replica in this process, then run --steps sim steps and after each one diff + apply the delta. Prints the
// snapshot size / cost, then per step: worker diff ms, delta bytes, main-thread apply ms (mean / p95 / max), hot and
// cold object counts, and the most-changed fields. --verify serializes the replica and the authoritative galaxy after
// a full cold compare and checks that the two save texts are identical.
//
//   node scripts/sync-measure.mjs <save> [--steps 300] [--speed 1] [--warm 60] [--cold-ms 3] [--pump-ms 0.5] [--hot-fields] [--compare-options] [--verify] [--census]
//   node scripts/sync-measure.mjs <save> --client [--steps 300] [--replies 30] [--steps-per-msg 1] [--frames 1] [--verify]   (host + client end to end)
import { build } from 'rolldown';
import { tmpdir } from 'node:os';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
    const { loadGameDataFs } = await load('load');
    const { deserializeGame } = await load('save');
    const { galaxyToJSON } = await load('galaxySave');
    const { runSimFrame, nextFrameMs, schedulerState } = await load('scheduler');
    const { stateDigest } = await load('digest');
    const { GalaxySyncSource, GalaxyReplica } = await load('replica');
    const { installGameStatics, registerGameHooks } = await load('game');
    const gameData = await loadGameDataFs();
    installGameStatics(gameData);
    registerGameHooks();
    let t0 = performance.now();
    const { game } = deserializeGame(readFileSync(file, 'utf8'), gameData);
    const g = game.galaxy;
    console.log(`loaded ${file} in ${(performance.now() - t0).toFixed(0)} ms: ${g.systems.length} systems, ${g.builtObjects.length} built objects, ${g.creatures.length} creatures`);
    const step = () => runSimFrame(g, nextFrameMs(schedulerState(g), speed));
    for (let i = 0; i < warm; i++) step();
    if (arg('client', false) === true) {
        await clientMode(game, gameData, { load, stat, fmt, galaxyToJSON, stateDigest });
        process.exit(process.exitCode ?? 0);
    }

    t0 = performance.now();
    const source = new GalaxySyncSource(g, { coldBudgetMs });
    const snap = source.snapshot();
    if (arg('markdbg', false) === true) {
        console.log(`markdbg: mark right after snapshot dropped ${source.encoder.mark()}`);
        for (let i = 0; i < 50; i++) { step(); source.delta(); }
        console.log(`markdbg: after 50 steps: dropped ${source.encoder.mark()} (live ${source.encoder.size})`);
        source.delta(true);
        console.log(`markdbg: after full: dropped ${source.encoder.mark()} (live ${source.encoder.size})`);
        process.exit(0);
    }
    const tSnap = performance.now() - t0;
    console.log(`snapshot: ${source.encoder.size} objects (${source.encoder.hotCount} hot), ${(snap.stats.bytes / 1048576).toFixed(1)} MB, ${tSnap.toFixed(0)} ms to encode`);
    if (census) {
        const c = source.encoder.census();
        for (const [k, v] of Object.entries(c).sort((a, b) => b[1].hot - a[1].hot || b[1].count - a[1].count).slice(0, 50)) console.log(`  ${String(v.count).padStart(9)} (${String(v.hot).padStart(8)} hot) ${k}`);
    }
    // Structured clone, as postMessage does (minus the transfer of the Float64 streams).
    t0 = performance.now();
    const cloned = structuredClone(snap);
    console.log(`snapshot structuredClone: ${(performance.now() - t0).toFixed(0)} ms`);
    const replica = new GalaxyReplica(gameData, g.baseTechCost);
    t0 = performance.now();
    replica.apply(cloned, true);
    console.log(`snapshot apply (main): ${(performance.now() - t0).toFixed(0)} ms, replica ${replica.decoder.size} objects`);

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
    if (verify) {
        const a = JSON.stringify(galaxyToJSON(g));
        const b = JSON.stringify(galaxyToJSON(replica.galaxy));
        let at = -1;
        for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) { at = i; break; }
        console.log(at < 0 ? `verify: replica save text identical (${(a.length / 1048576).toFixed(0)} MB); digest ${stateDigest(g)} / replica ${stateDigest(replica.galaxy)}` : `verify: MISMATCH at ${at}: auth …${a.slice(Math.max(0, at - 200), at + 100)}…\n replica …${b.slice(Math.max(0, at - 200), at + 100)}…`);
        if (at >= 0) process.exitCode = 1;
    }
} finally {
    rmSync(bundleDir, { recursive: true, force: true });
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
        const a = JSON.stringify(galaxyToJSON(game.galaxy));
        const b = JSON.stringify(galaxyToJSON(client.galaxy));
        let at = -1;
        for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) { at = i; break; }
        console.log(at < 0 ? `verify: replica save text identical (${(a.length / 1048576).toFixed(0)} MB); digest ${stateDigest(game.galaxy)} / replica ${stateDigest(client.galaxy)}` : `verify: MISMATCH at ${at}: auth …${a.slice(Math.max(0, at - 200), at + 100)}…\n replica …${b.slice(Math.max(0, at - 200), at + 100)}…`);
        if (at >= 0 || stateDigest(game.galaxy) !== stateDigest(client.galaxy)) process.exitCode = 1;
    }
    client.dispose();
    host.dispose();
}
