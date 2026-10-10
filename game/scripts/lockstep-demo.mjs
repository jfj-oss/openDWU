#!/usr/bin/env node
// Lockstep demo (docs/MULTIPLAYER.md "Lockstep core"): two headless sims in two processes, connected by a WebSocket on
// localhost, run one game in lockstep (src/net/lockstep.ts + src/net/lockstepSim.ts). Not a test: it prints what it
// did and the numbers.
//
//   nice -n 19 taskset -c 4-7 node scripts/lockstep-demo.mjs [--seed 1] [--stars 300] [--empires 4] [--minutes 4]
//        [--speed 4] [--delay 4] [--digest 60] [--burst 1000] [--no-join] [--keep]
//   ... --memory [--frames 600]: the in-memory transport instead (host and client sessions in one process).
//
// What happens (frames are 1/60 s of real time; game ms per frame = 1000 x speed / 60):
//   1. Both processes build the game from the same seed. The client says so in its hello (its digest at frame 0), so
//      the host skips the save. Both make the host's empire and one AI empire human (setHumanEmpires): peer 0
//      commands the primary human, peer 1 the second one; a command for anyone else's empire is refused on every peer.
//   2. Frames 0-300 run in real time (60 fps): the host sets the speed, each side issues a few commands (rename and
//      retire ships, a waypoint), and the command latency at real pace is measured.
//   3. From frame 300 on the sims run as fast as the inputs allow. A burst of --burst commands from each side, then
//      20 commands per frame per side for 300 frames, measure throughput.
//   4. The client corrupts its own state (adds money to an empire outside the sim). The next digest check detects it;
//      the host sends a save and the client reloads it and continues; the digests match again.
//   5. The client asks the host to pause; the host pauses, then resumes 120 frames later.
//   6. A third process joins mid-game (it gets the host's save and input buffer), runs a while, tries a command for an
//      empire it does not control (refused everywhere), then drops. The session goes on.
//   7. Everyone stops at the same frame and prints its digest; the parent checks they match.
//
// The TS sources are bundled with rolldown (as scripts/sim-run.mjs does) into a temp dir, removed at the end.
import { build } from 'rolldown';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const self = fileURLToPath(import.meta.url);

function arg(name, fallback) {
    const i = process.argv.indexOf(`--${name}`);
    if (i < 0) return fallback;
    const v = process.argv[i + 1];
    return v === undefined || v.startsWith('--') ? true : v;
}

const role = String(arg('role', 'parent'));
const cfg = {
    seed: Number(arg('seed', 1)),
    stars: Number(arg('stars', 300)),
    empires: Number(arg('empires', 4)),
    minutes: Number(arg('minutes', 4)),
    speed: Number(arg('speed', 4)),
    delay: Number(arg('delay', 4)),
    digest: Number(arg('digest', 60)),
    burst: Number(arg('burst', 1000)),
    join: arg('no-join', false) !== true,
};
const REALTIME_UNTIL = 300;
const FRAME_REAL_MS = 1000 / 60;
// Game ms per frame at cfg.speed after the speed change (frames 0..delay run at 1x).
const T = {
    hostCmds: [60, 180], clientCmds: [90, 240],
    burst: 480, sustainFrom: 540, sustainTo: 840,
    corrupt: 900,
    pauseAsk: 1110, pauseLen: 120,
    joinAt: 1400, joinerRuns: 600,
};
// The last frame (a digest frame): --minutes of game time at --speed, plus the paused stretch and the first frames at 1x.
const endFrame = Math.ceil(((cfg.minutes * 60000) / ((1000 * cfg.speed) / 60) + T.pauseLen + cfg.delay) / cfg.digest) * cfg.digest;

const wallNow = () => performance.timeOrigin + performance.now();
const yieldIo = () => new Promise((r) => setImmediate(r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// =====================================================================================================================
// Parent: bundle, spawn host + client (+ joiner), print their output and the summary.
// =====================================================================================================================
if (role === 'parent') {
    const MODULES = {
        lockstep: '/src/net/lockstep.ts', lockstepSim: '/src/net/lockstepSim.ts', wsTransport: '/src/net/wsTransport.ts', transport: '/src/net/transport.ts',
        game: '/src/sim/game.ts', types: '/src/sim/types.ts', load: '/test/helpers/loadGameDataFs.ts', digest: '/src/sim/tick/digest.ts',
        galaxyTime: '/src/sim/galaxyTime.ts', startOptions: '/src/sim/startGameOptions.ts', humans: '/src/sim/humanEmpires.ts',
        galaxySave: '/src/sim/save/galaxySave.ts', scheduler: '/src/sim/tick/scheduler.ts', commands: '/src/sim/player/playerCommands.ts', commandLog: '/src/sim/player/commandLog.ts',
    };
    const bundleDir = mkdtempSync(resolve(tmpdir(), 'dwu-lockstep-demo-'));
    const exit = (code) => {
        if (arg('keep', false) !== true) rmSync(bundleDir, { recursive: true, force: true });
        process.exit(code);
    };
    const t0 = performance.now();
    await build({
        cwd: root, input: Object.fromEntries(Object.entries(MODULES).map(([k, v]) => [k, '.' + v])), platform: 'node',
        transform: { define: { __dirname: JSON.stringify(resolve(root, 'test/helpers')) } },
        output: { dir: bundleDir, format: 'esm', preserveModules: true, preserveModulesRoot: root }, write: true, logLevel: 'warn',
    });
    console.log(`bundled in ${(performance.now() - t0).toFixed(0)} ms; game: seed ${cfg.seed}, ${cfg.stars} stars, ${cfg.empires} empires; ${cfg.minutes} game minutes at ${cfg.speed}x = ${endFrame} frames; input delay ${cfg.delay}, digest every ${cfg.digest} frames`);

    if (arg('memory', false) === true) {
        // In-memory transport: host and client sessions in this one process (two games), no sockets.
        const code = await new Promise((r) => {
            const child = spawn(process.execPath, [self, '--role', 'memory', '--bundle', bundleDir, ...process.argv.slice(2)], { stdio: 'inherit' });
            child.on('exit', r);
        });
        exit(code ?? 1);
    }
    const results = {};
    const children = [];
    const run = (who, extra, onLine) => new Promise((resolveRun) => {
        const child = spawn(process.execPath, [self, '--role', who, '--bundle', bundleDir, ...process.argv.slice(2), ...extra], { stdio: ['ignore', 'pipe', 'pipe'] });
        children.push(child);
        let buf = '';
        const line = (l) => {
            if (l.startsWith('RESULT ')) results[who] = JSON.parse(l.slice(7));
            else if (l.startsWith('PORT ') || l.startsWith('AT ')) onLine?.(l);
            else console.log(`[${who.padEnd(6)}] ${l}`);
        };
        child.stdout.on('data', (d) => {
            buf += d;
            let i;
            while ((i = buf.indexOf('\n')) >= 0) {
                line(buf.slice(0, i));
                buf = buf.slice(i + 1);
            }
        });
        child.stderr.on('data', (d) => process.stderr.write(`[${who.padEnd(6)}!] ${d}`));
        child.on('exit', (code) => resolveRun(code));
    });

    let port = null;
    let joinerDone = Promise.resolve(0);
    let joinerStarted = false;
    const hostDone = run('host', [], (l) => {
        if (l.startsWith('PORT ')) {
            port = Number(l.slice(5));
            clientDone = run('client', ['--port', String(port)]);
        } else if (l.startsWith('AT ') && cfg.join && !joinerStarted && Number(l.slice(3)) >= T.joinAt) {
            joinerStarted = true;
            joinerDone = run('joiner', ['--port', String(port)]);
        }
    });
    let clientDone = null;
    const killAll = setTimeout(() => {
        console.error('demo timed out after 15 minutes');
        for (const c of children) c.kill();
    }, 15 * 60000);
    const codes = [await hostDone];
    while (clientDone === null) await sleep(10);
    codes.push(await clientDone, await joinerDone);
    clearTimeout(killAll);

    // ---- summary
    const h = results.host, c = results.client, j = results.joiner;
    if (h === undefined || c === undefined) {
        console.log('a process failed (no result)', codes);
        exit(1);
    }
    const ms = (x) => (x === null || x === undefined ? '-' : `${x.toFixed(1)} ms`);
    console.log('\n================ lockstep demo summary ================');
    console.log(`final frame ${h.frame}: host digest ${h.digest}, client digest ${c.digest} -> ${h.digest === c.digest ? 'MATCH' : 'MISMATCH'}`);
    console.log(`game time ${(h.nowMs / 60000).toFixed(2)} min (client ${(c.nowMs / 60000).toFixed(2)}), command-log player entries host ${h.playerLog} / client ${c.playerLog}`);
    console.log(`digest checks on the host: ${h.stats.digestChecks}, mismatches ${h.stats.digestMismatches} (the injected one), resyncs ${h.stats.resyncs}`);
    if (h.desync !== null) console.log(`  desync injected at client frame ${c.corruptFrame}; detected at frame ${h.desync.frame}; save ${(h.desync.bytes / 1e6).toFixed(2)} MB; client reloaded in ${ms(c.reloadMs)}; every later check matched: ${h.cleanAfterResync}`);
    console.log(`digest timeline: ${c.digests.length} client checkpoints, ${c.digests.filter((d) => h.digestsByFrame[d.frame] === d.digest).length} equal to the host's (the rest are the corrupted stretch before the reload)`);
    console.log(`pause: requested by the client at frame ${T.pauseAsk}, paused frames host ${h.pausedFrames} / client ${c.pausedFrames}`);
    console.log(`ping RTT host<->client over WebSocket: ${ms(c.pingMs)}`);
    console.log('command latency, issue -> applied (wall clock):');
    for (const [label, s] of [['real-time 60 fps, own command', c.lat.rtLocal], ['real-time 60 fps, other peer\'s', c.lat.rtRemote], ['unthrottled, own', c.lat.fastLocal], ['unthrottled, other peer\'s', c.lat.fastRemote]]) {
        console.log(`  ${label.padEnd(32)} n=${String(s.n).padStart(6)}  median ${ms(s.p50)}  p95 ${ms(s.p95)}  max ${ms(s.max)}`);
    }
    console.log(`  (input delay ${cfg.delay} frames = ${(cfg.delay * FRAME_REAL_MS).toFixed(1)} ms at 60 fps)`);
    console.log(`  issue -> arrival at the host (client commands): median ${ms(h.arrival.p50)}, p95 ${ms(h.arrival.p95)}`);
    console.log('throughput:');
    console.log(`  idle unthrottled: ${h.idleFps.toFixed(0)} frames/s (solo sim on this machine: ${h.soloFps.toFixed(0)} frames/s)`);
    console.log(`  burst of ${cfg.burst} commands per side: all ${cfg.burst * 2} applied on both peers within ${ms(h.burstMs)} (host) / ${ms(c.burstMs)} (client)`);
    console.log(`  sustained 20 commands/frame/side for ${T.sustainTo - T.sustainFrom} frames: ${h.sustain.fps.toFixed(0)} frames/s, ${h.sustain.cps.toFixed(0)} commands/s applied`);
    console.log(`  traffic host: sent ${h.stats.messagesSent} msgs / ${(h.stats.bytesSent / 1e6).toFixed(2)} MB, received ${h.stats.messagesReceived} / ${(h.stats.bytesReceived / 1e6).toFixed(2)} MB`);
    console.log(`  stalls (waiting for the other peer): host ${h.stats.stalls} (${ms(h.stats.stallMs)}), client ${c.stats.stalls} (${ms(c.stats.stallMs)})`);
    if (j !== undefined) {
        const jc = h.checksByPeer[2] ?? { checked: 0, ok: 0 };
        console.log(`join/leave: joiner welcomed at frame ${j.joinedAt} with a ${(j.saveBytes / 1e6).toFixed(2)} MB save (loaded in ${ms(j.loadMs)}); its digests matched the host's ${jc.ok}/${jc.checked}; it left at frame ${j.frame}`);
        console.log(`  its command for an empire it does not control: refused on host ${h.refused}, client ${c.refused}, joiner ${j.refused}`);
        console.log(`  host saw it leave from frame ${h.leftFrom}; host and client went on to frame ${h.frame}`);
    }
    const jc2 = h.checksByPeer[2];
    const ok = h.digest === c.digest && h.cleanAfterResync && h.stats.digestMismatches === 1 && (j === undefined || (jc2 !== undefined && jc2.checked > 0 && jc2.ok === jc2.checked));
    console.log(ok ? 'RESULT: OK' : 'RESULT: FAILED');
    exit(ok && codes.every((x) => x === 0) ? 0 : 1);
}

// =====================================================================================================================
// Children: host, client, joiner.
// =====================================================================================================================
const bundleDir = String(arg('bundle', ''));
const load = (key) => import(resolve(bundleDir, key + '.js'));
const { LockstepSession } = await load('lockstep');
const { GalaxyLockstepSim } = await load('lockstepSim');
const { wrapSocket, connectWebSocket } = await load('wsTransport');
const { createGame } = await load('game');
const { GalaxyShape } = await load('types');
const { loadGameDataFs } = await load('load');
const { GalaxyTime } = await load('galaxyTime');
const { defaultStartGameOptions } = await load('startOptions');
const { setHumanEmpires, humanEmpires } = await load('humans');
const { flatEmpireList } = await load('galaxySave');
const { issuePlayerCommand } = await load('commands');
const { commandLog } = await load('commandLog');
const { listenWebSocket } = await import('./lib/wsServer.mjs');
const { MemoryListener } = await load('transport');

const out = (s) => console.log(s);
const gameData = await loadGameDataFs();
const startOptions = { ...defaultStartGameOptions(), seed: cfg.seed };

/** Build the game from the seed (host and client), with two humans. */
function buildGame() {
    const sectors = Math.max(4, Math.min(15, Math.round(Math.sqrt(cfg.stars / 4.7))));
    const s = (race) => ({ race, homeSystemFavourability: 'Normal', proximityDistance: 'Random', startLocation: '(Random)', age: 1, techLevel: 0.5 });
    const t = performance.now();
    const game = createGame({
        seed: cfg.seed, shape: GalaxyShape.Spiral, starCount: cfg.stars, sectorWidth: sectors, sectorHeight: sectors,
        systemNames: Array.from({ length: cfg.stars }, (_, i) => `S${i}`), gameData, galaxyAge: 1,
        player: s('Human'), aiEmpires: Array.from({ length: cfg.empires - 1 }, () => s('(Random)')), piratePrevalence: 1,
    });
    out(`built the game from seed ${cfg.seed} in ${(performance.now() - t).toFixed(0)} ms`);
    return game;
}

/** The two humans: peer 0 commands the primary human, peer 1 the second (the set list travels in the save). */
function makeHumans(galaxy) {
    const second = galaxy.empires.find((e) => e !== galaxy.playerEmpire && e.builtObjects.length > 2);
    setHumanEmpires(galaxy, [galaxy.playerEmpire, second]);
}

/** flatEmpireList indices of [primary human, second human]. */
function humanIndices(galaxy) {
    const list = flatEmpireList(galaxy);
    return humanEmpires(galaxy).map((e) => list.indexOf(e));
}

const stats = (arr) => {
    if (arr.length === 0) return { n: 0, p50: null, p95: null, max: null };
    const a = [...arr].sort((x, y) => x - y);
    return { n: a.length, p50: a[Math.floor(a.length * 0.5)], p95: a[Math.min(a.length - 1, Math.floor(a.length * 0.95))], max: a[a.length - 1] };
};

/** Shared per-process state for the hooks. */
const S = {
    lat: { rtLocal: [], rtRemote: [], fastLocal: [], fastRemote: [] }, arrival: [], refused: 0, pausedFrames: 0,
    burstTarget: null, burstApplied: 0, burstStart: 0, burstMs: null, digests: [],
};
let session = null;
let sim = null;

function makeSim(game, time) {
    return new GalaxyLockstepSim(game, time, {
        gameData, startOptions,
        authorize: (peer, empireIndex) => {
            const [p, s] = humanIndices(sim.galaxy);
            return (peer === 0 && empireIndex === p) || (peer === 1 && empireIndex === s);
        },
        onApplied: (cmd, frame, local) => {
            const lat = wallNow() - cmd.sentAt;
            const fast = frame >= REALTIME_UNTIL;
            (fast ? (local ? S.lat.fastLocal : S.lat.fastRemote) : (local ? S.lat.rtLocal : S.lat.rtRemote)).push(lat);
            if (cmd.op === 'renameShip' && S.burstTarget !== null && frame >= T.burst && frame < T.sustainFrom) {
                if (++S.burstApplied === S.burstTarget) S.burstMs = wallNow() - S.burstStart;
            }
        },
        onDropped: (cmd, reason) => {
            S.refused++;
            out(`refused at frame ${session?.frame}: peer ${cmd.peer} ${cmd.op} (${reason})`);
        },
    });
}

function myEmpire(peer) {
    const idx = humanIndices(sim.galaxy)[peer];
    return flatEmpireList(sim.galaxy)[idx];
}

/** Issue `op` through the normal command API (issuePlayerCommand): the sink routes it to the session. */
function issue(empire, op, args) {
    issuePlayerCommand(sim.galaxy, empire, op, args);
}

function someShips(empire, n) {
    return empire.builtObjects.filter((b) => b != null).slice(0, n);
}

/** The actions this peer takes at boundary `frame` (deterministic schedule; they all go through the session). */
function actionsAt(frame, peer) {
    const me = peer <= 1 ? myEmpire(peer) : null;
    if (peer === 0 && frame === 0) session.setSpeed(cfg.speed);
    const mine = peer === 0 ? T.hostCmds : peer === 1 ? T.clientCmds : [];
    if (mine.includes(frame)) {
        const ships = someShips(me, 3);
        issue(me, 'renameShip', [ships[0], `${peer === 0 ? 'Host' : 'Client'} flagship @${frame}`]);
        issue(me, 'addWaypoint', [ships[0].xpos ?? 0, ships[0].ypos ?? 0, `wp-${peer}-${frame}`]);
        if (frame === mine[1]) issue(me, 'retireShips', [[ships[ships.length - 1]]]);
        out(`frame ${frame}: issued renameShip, addWaypoint${frame === mine[1] ? ', retireShips' : ''} for empire ${me.name}`);
    }
    if (peer <= 1 && frame === T.burst) {
        const ship = someShips(me, 1)[0];
        S.burstTarget = cfg.burst * 2;
        S.burstStart = wallNow();
        for (let i = 0; i < cfg.burst; i++) issue(me, 'renameShip', [ship, `burst ${peer}-${i}`]);
        out(`frame ${frame}: burst of ${cfg.burst} commands`);
    }
    if (peer <= 1 && frame >= T.sustainFrom && frame < T.sustainTo) {
        const ship = someShips(me, 1)[0];
        for (let i = 0; i < 20; i++) issue(me, 'renameShip', [ship, `s${peer}-${frame}-${i}`]);
    }
    if (peer === 1 && frame === T.corrupt) {
        const victim = sim.galaxy.empires[0];
        victim.stateMoney += 12345;
        S.corruptFrame = frame;
        out(`frame ${frame}: DESYNC INJECTED (added 12345 to ${victim.name}'s money outside the sim)`);
    }
    if (peer === 1 && frame === T.pauseAsk) {
        session.requestPause(true);
        out(`frame ${frame}: asked the host to pause`);
    }
}

/** Drive the session to `target`: real time (60 fps) until REALTIME_UNTIL, then as fast as the inputs allow. The
 *  peer's scheduled actions run once at each boundary, before its frame. */
async function drive(peer, target, onFrame = () => {}) {
    let acted = -1;
    let last = performance.now();
    let owed = 0;
    let n = 0;
    while (session.active && session.frame < target) {
        const f = session.frame;
        if (acted < f) {
            acted = f;
            actionsAt(f, peer);
            onFrame(f);
        }
        if (f < REALTIME_UNTIL) {
            const now = performance.now();
            owed = Math.min(owed + (now - last), FRAME_REAL_MS * 4);
            last = now;
            if (owed >= FRAME_REAL_MS && session.step()) {
                owed -= FRAME_REAL_MS;
                afterStep();
                continue;
            }
            await sleep(1);
            continue;
        }
        if (session.step()) {
            afterStep();
            if (++n % 2 === 0) await yieldIo();
        } else {
            await yieldIo();
        }
    }
}

function afterStep() {
    if (session.clock.paused) S.pausedFrames++;
    if (session.frame % cfg.digest === 0) S.digests.push({ frame: session.frame, digest: sim.digest() });
}

// ---------------------------------------------------------------------------------------------------- host
if (role === 'host') {
    const game = buildGame();
    makeHumans(game.galaxy);
    const time = new GalaxyTime();
    sim = makeSim(game, time);
    let hostDesync = null;
    let mismatchSeen = false;
    let cleanAfterResync = true;
    const digestsByFrame = {};
    let leftFrom = null;
    const checksByPeer = {};
    session = LockstepSession.host(sim, {
        name: 'host', inputDelay: cfg.delay, digestInterval: cfg.digest,
        hooks: {
            log: (m) => out(m),
            onDigest: (frame, peer, ok) => {
                const c = (checksByPeer[peer] ??= { checked: 0, ok: 0 });
                c.checked++;
                if (ok) c.ok++;
                if (!ok) {
                    mismatchSeen = true;
                    out(`frame ${frame}: digest MISMATCH from peer ${peer} -> resync`);
                } else if (mismatchSeen && peer === 1 && frame % (cfg.digest * 10) === 0) out(`frame ${frame}: digests match (peer ${peer})`);
                if (!ok && hostDesync !== null) cleanAfterResync = false;
            },
            onResync: (frame, peer, bytes) => {
                if (hostDesync === null) hostDesync = { frame, peer, bytes };
            },
            onInput: (input, now) => {
                if (input.peer === 1) for (const c of input.cmds) S.arrival.push(now - c.sentAt);
            },
            onPeerLeft: (peer) => {
                if (peer.id === 2) leftFrom = peer.leftFrom;
                out(`peer ${peer.id} disconnected; its empire would go to the AI here (Phase 4 hook)`);
            },
        },
    });
    sim.attach(session);
    let pausedAt = null;
    const server = await listenWebSocket({ port: 0, host: '127.0.0.1' }, (socket) => session.accept(wrapSocket(socket)));
    out(`listening on ws://127.0.0.1:${server.port}`);
    out(`PORT ${server.port}`);
    while (session.peerList().length < 2) await sleep(5);

    // Idle-unthrottled and solo speeds are measured inside the run (frames 300..480 have no commands).
    let idleT0 = 0, sustainT0 = 0, sustainCmds0 = 0;
    const res = {};
    await drive(0, endFrame, (f) => {
        if (f % 100 === 0) out(`AT ${f}`);
        if (f === REALTIME_UNTIL) idleT0 = performance.now();
        if (f === T.burst) res.idleFps = (T.burst - REALTIME_UNTIL) / ((performance.now() - idleT0) / 1000);
        if (f === T.sustainFrom) { sustainT0 = performance.now(); sustainCmds0 = session.stats.commandsApplied; }
        if (f === T.sustainTo) {
            const dt = (performance.now() - sustainT0) / 1000;
            res.sustain = { fps: (T.sustainTo - T.sustainFrom) / dt, cps: (session.stats.commandsApplied - sustainCmds0) / dt };
        }
        if (session.clock.paused && pausedAt === null) pausedAt = f;
        if (pausedAt !== null && f === pausedAt + T.pauseLen && session.clock.paused) {
            session.setPaused(false);
            out(`frame ${f}: host resumes`);
        }
    });
    for (const d of S.digests) digestsByFrame[d.frame] = d.digest;
    // Solo baseline: the same sim alone, no session, for 180 frames from here (after the result is taken).
    const digest = sim.digest();
    const frame = session.frame;
    const nowMs = sim.galaxy.nowMs;
    const playerLog = commandLog(sim.galaxy).filter((e) => e.source === 'player').length;
    await sleep(300); // let the client's last digest arrive before the link closes
    const st = { ...session.stats };
    session.close('demo over');
    server.close();
    // Solo baseline: the same sim alone (no session) for 180 more frames, after the result was taken.
    const sched = await load('scheduler');
    const t = performance.now();
    for (let i = 0; i < 180; i++) sched.runSimFrame(sim.galaxy, sched.nextFrameMs(sched.schedulerState(sim.galaxy), cfg.speed));
    const soloFps = 180 / ((performance.now() - t) / 1000);
    out(`RESULT ${JSON.stringify({
        frame, digest, nowMs, playerLog, stats: st, desync: hostDesync, cleanAfterResync, digestsByFrame,
        arrival: stats(S.arrival), idleFps: res.idleFps ?? 0, soloFps, sustain: res.sustain ?? { fps: 0, cps: 0 }, burstMs: S.burstMs,
        pausedFrames: S.pausedFrames, refused: S.refused, leftFrom, checksByPeer,
    })}`);
    process.exit(0);
}

// ---------------------------------------------------------------------------------------------------- client
if (role === 'client') {
    const port = Number(arg('port', 0));
    const game = buildGame();
    makeHumans(game.galaxy);
    const time = new GalaxyTime();
    sim = makeSim(game, time);
    const link = await connectWebSocket(`ws://127.0.0.1:${port}`);
    let reloadMs = null;
    const realLoad = sim.load.bind(sim);
    sim.load = (save) => {
        const t = performance.now();
        realLoad(save);
        reloadMs = performance.now() - t;
    };
    session = await LockstepSession.join(link, sim, {
        name: 'client', have: { frame: 0, digest: sim.digest() },
        hooks: { log: (m) => out(m), onHostLost: (r) => out(`host gone: ${r}`) },
    });
    sim.attach(session);
    const pings = [];
    for (let i = 0; i < 20; i++) pings.push(await session.ping());
    await drive(1, endFrame);
    // The host stops at endFrame too; wait for the last frames' inputs to have been sent.
    const res = {
        frame: session.frame, digest: sim.digest(), nowMs: sim.galaxy.nowMs,
        playerLog: commandLog(sim.galaxy).filter((e) => e.source === 'player').length,
        stats: { ...session.stats }, digests: S.digests, corruptFrame: S.corruptFrame ?? null, reloadMs,
        pingMs: stats(pings).p50,
        lat: Object.fromEntries(Object.entries(S.lat).map(([k, v]) => [k, stats(v)])), burstMs: S.burstMs, pausedFrames: S.pausedFrames, refused: S.refused,
    };
    out(`RESULT ${JSON.stringify(res)}`);
    await sleep(300);
    link.close('done');
    process.exit(0);
}

// ---------------------------------------------------------------------------------------------------- joiner
if (role === 'joiner') {
    const port = Number(arg('port', 0));
    // No game of its own: the host's welcome brings the save (GalaxyLockstepSim.load).
    sim = makeSim(null, null);
    let saveBytes = 0, loadMs = null;
    const realLoad = sim.load.bind(sim);
    sim.load = (save) => {
        const t = performance.now();
        realLoad(save);
        loadMs = performance.now() - t;
        saveBytes = save.length;
    };
    const link = await connectWebSocket(`ws://127.0.0.1:${port}`);
    session = await LockstepSession.join(link, sim, { name: 'joiner', hooks: { log: (m) => out(m) } });
    sim.attach(session);
    const joinedAt = session.frame;
    await drive(2, joinedAt + T.joinerRuns, (f) => {
        if (f === joinedAt + 60) {
            const victim = flatEmpireList(sim.galaxy)[humanIndices(sim.galaxy)[0]];
            issue(victim, 'renameShip', [someShips(victim, 1)[0], 'joiner was here']);
            out(`frame ${f}: tried to command the host's empire (must be refused on every peer)`);
        }
    });
    // Let the last digest reach the host before dropping.
    await sleep(100);
    out(`RESULT ${JSON.stringify({ joinedAt, frame: session.frame, saveBytes, loadMs, resyncs: session.stats.resyncs, refused: S.refused })}`);
    link.close('joiner leaves');
    await sleep(100);
    process.exit(0);
}

// ---------------------------------------------------------------------------------------------------- memory
if (role === 'memory') {
    // Two sessions, two games, one process, over the in-memory transport (transport.ts MemoryListener). A short run:
    // each side issues commands for its own empire; the digests are compared every --digest frames by the host.
    const frames = Number(arg('frames', 600));
    const mk = () => {
        const game = buildGame();
        makeHumans(game.galaxy);
        return new GalaxyLockstepSim(game, new GalaxyTime(), { gameData, startOptions });
    };
    const hostSim = mk(), clientSim = mk();
    let checks = 0, bad = 0;
    const host = LockstepSession.host(hostSim, { inputDelay: cfg.delay, digestInterval: cfg.digest, hooks: { onDigest: (_f, _p, ok) => { checks++; if (!ok) bad++; } } });
    hostSim.attach(host);
    const listener = new MemoryListener();
    listener.onLink = (link) => host.accept(link);
    const client = await LockstepSession.join(listener.connect(), clientSim, { have: { frame: 0, digest: clientSim.digest() } });
    clientSim.attach(client);
    const t = performance.now();
    while (client.frame < frames || host.frame < frames) {
        for (const [sess, s, peer] of [[host, hostSim, 0], [client, clientSim, 1]]) {
            if (sess.frame >= frames) continue;
            if (sess.frame % 50 === 10) {
                const me = flatEmpireList(s.galaxy)[humanIndices(s.galaxy)[peer]];
                issuePlayerCommand(s.galaxy, me, 'renameShip', [someShips(me, 1)[0], `mem ${peer} @${sess.frame}`]);
            }
            sess.step();
        }
        await yieldIo();
    }
    await yieldIo();
    const dh = hostSim.digest(), dc = clientSim.digest();
    const sec = (performance.now() - t) / 1000;
    out(`in-memory transport: ${frames} frames in ${sec.toFixed(1)} s (${(frames / sec).toFixed(0)} frames/s, both sims in one process); host ${dh}, client ${dc} -> ${dh === dc ? 'MATCH' : 'MISMATCH'}; digest checks ${checks}, mismatches ${bad}; commands applied ${host.stats.commandsApplied}`);
    host.close();
    process.exit(dh === dc && bad === 0 && checks > 0 ? 0 : 1);
}
