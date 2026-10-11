// Cross-machine lockstep session (docs/MULTIPLAYER.md "Cross-platform determinism check"): one peer per machine over
// WebSocket (src/net/lockstep.ts + lockstepSim.ts). scripts/determinism-check.mjs --lockstep bundles this file into
// one ESM file, like runner.ts, so a machine needs only the app binary (ELECTRON_RUN_AS_NODE=1) and the DW:U data.
//
//   host:   peer.mjs --role host --data <DW:U folder> --peers 3 [--port 47811] [--frames 7200] [--speed 4]
//   client: peer.mjs --role client --data <DW:U folder> --peers 3 --url ws://<host>:47811 --peer-name mac
// (--peers must be the same on every peer: it sets how many empires are human, so it is part of the game state)
//
// Every peer builds seed 1 (300 stars, 4 empires) itself and joins with its frame-0 digest (no save is sent). Peer i
// commands human empire i (the player's empire + the first AI empires with ships); every 120 frames each peer renames
// one of its ships and adds a waypoint, every 900 frames it retires a ship, and every 1500 frames it orders a ship to
// move; peer 1 asks for a pause once (the host resumes it 120 frames later). Frames run at up to 60 fps (the session
// waits for the slowest peer). The host compares every client's digest every 60 frames; a mismatch would trigger a
// resync, so the result line counts them: digest checks, mismatches, resyncs, and the final digest of every peer.
import wsServer from '../../desktop/wsServer.cjs';
import { LockstepSession } from '../../src/net/lockstep';
import { GalaxyLockstepSim } from '../../src/net/lockstepSim';
import { connectWebSocket, wrapSocket } from '../../src/net/wsTransport';
import { createGame } from '../../src/sim/game';
import { GalaxyShape } from '../../src/sim/types';
import { GalaxyTime } from '../../src/sim/galaxyTime';
import { defaultStartGameOptions } from '../../src/sim/startGameOptions';
import { humanEmpires, setHumanEmpires } from '../../src/sim/humanEmpires';
import { flatEmpireList } from '../../src/sim/save/galaxySave';
import { issuePlayerCommand } from '../../src/sim/player/playerCommands';
import { commandLog } from '../../src/sim/player/commandLog';
import { createMissionShipActionAt } from '../../src/sim/player/shipAction';
import { BuiltObjectMissionType } from '../../src/sim/missions/mission';
import type { Empire } from '../../src/sim/empire';
import { loadData } from './dataFs';

function arg(name: string, fallback: string): string {
    const i = process.argv.indexOf(`--${name}`);
    return i < 0 || process.argv[i + 1] === undefined ? fallback : process.argv[i + 1];
}
const role = arg('role', 'host');
const peers = Number(arg('peers', '2'));
const frames = Number(arg('frames', '7200'));
const speed = Number(arg('speed', '4'));
const DIGEST = 60;
const out = (s: string) => console.log(`[${arg('peer-name', role)}] ${s}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const { data, fingerprint } = await loadData(arg('data', '.'));
out(`${process.platform}-${process.arch} v8 ${process.versions.v8}; data ${fingerprint.slice(0, 12)}`);
const s = (race: string) => ({ race, homeSystemFavourability: 'Normal' as const, proximityDistance: 'Random', startLocation: '(Random)', age: 1, techLevel: 0.5 });
const game = createGame({
    seed: 1, shape: GalaxyShape.Spiral, starCount: 300, sectorWidth: 8, sectorHeight: 8,
    systemNames: Array.from({ length: 300 }, (_, i) => `S${i}`), gameData: data, galaxyAge: 1,
    player: s('Human'), aiEmpires: [s('(Random)'), s('(Random)'), s('(Random)')], piratePrevalence: 1,
});
const g0 = game.galaxy;
setHumanEmpires(g0, [g0.playerEmpire!, ...g0.empires.filter((e) => e !== g0.playerEmpire && e.builtObjects.length > 2).slice(0, peers - 1)]);

let refused = 0;
const sim: GalaxyLockstepSim = new GalaxyLockstepSim(game, new GalaxyTime(), {
    gameData: data, startOptions: { ...defaultStartGameOptions(), seed: 1 },
    authorize: (peer, empireIndex) => flatEmpireList(sim.galaxy).indexOf(humanEmpires(sim.galaxy)[peer]) === empireIndex,
    onDropped: (cmd, reason) => {
        refused++;
        out(`refused: peer ${cmd.peer} ${cmd.op} (${reason})`);
    },
});
const myEmpire = (peer: number): Empire => humanEmpires(sim.galaxy)[peer];

let session: LockstepSession;
const checks: Record<number, { checked: number; ok: number }> = {};
let mismatches = 0;
let resyncs = 0;
let peerId = 0;
let pausedAt: number | null = null;

/** This peer's orders at boundary `frame` (all through issuePlayerCommand → the session). */
function actionsAt(frame: number): void {
    if (role === 'host' && frame === 0) session.setSpeed(speed);
    const me = myEmpire(peerId);
    const ships = me.builtObjects.filter((b) => b != null && !b.hasBeenDestroyed);
    if (ships.length === 0) return;
    const at = (n: number) => frame > 0 && frame % n === (peerId * 7) % n;
    if (at(120)) {
        issuePlayerCommand(sim.galaxy, me, 'renameShip', [ships[frame % ships.length], `p${peerId} @${frame}`]);
        issuePlayerCommand(sim.galaxy, me, 'addWaypoint', [Math.trunc(ships[0].xpos), Math.trunc(ships[0].ypos), `wp-${peerId}-${frame}`]);
    }
    if (at(900) && ships.length > 3) issuePlayerCommand(sim.galaxy, me, 'retireShips', [[ships[ships.length - 1]]]);
    if (at(1500)) {
        const target = sim.galaxy.habitats[(frame * 31 + peerId * 97) % sim.galaxy.habitats.length];
        const order = createMissionShipActionAt(BuiltObjectMissionType.Move, target, Math.trunc(target.xpos), Math.trunc(target.ypos));
        issuePlayerCommand(sim.galaxy, me, 'rightClickOrder', [ships[0], order, { ctrl: false, alt: false }, 1]);
    }
    if (role !== 'host' && peerId === 1 && frame === 1800) session.requestPause(true);
    if (role === 'host') {
        if (session.clock.paused && pausedAt === null) pausedAt = frame;
        if (pausedAt !== null && frame === pausedAt + 120 && session.clock.paused) session.setPaused(false);
    }
}

/** Up to 60 fps (a frame owed every 1000/60 ms of real time), as the app runs. */
async function drive(target: number): Promise<void> {
    let acted = -1, owed = 0, last = performance.now();
    while (session.active && session.frame < target) {
        const f = session.frame;
        if (acted < f) {
            acted = f;
            actionsAt(f);
            if (f % 1200 === 0) out(`frame ${f}, game ${(sim.galaxy.nowMs / 1000).toFixed(0)} s, digest ${sim.digest()}`);
        }
        const now = performance.now();
        owed = Math.min(owed + (now - last), 1000 / 15);
        last = now;
        if (owed >= 1000 / 60 && session.step()) {
            owed -= 1000 / 60;
            continue;
        }
        await sleep(1);
    }
}

const t0 = performance.now();
if (role === 'host') {
    session = LockstepSession.host(sim, {
        name: 'host', digestInterval: DIGEST,
        hooks: {
            log: (m) => out(m),
            onDigest: (frame, peer, ok, h, c) => {
                const k = (checks[peer] ??= { checked: 0, ok: 0 });
                k.checked++;
                if (ok) k.ok++;
                else {
                    mismatches++;
                    out(`frame ${frame}: DIGEST MISMATCH from peer ${peer}: host ${h} client ${c}`);
                }
            },
            onResync: () => { resyncs++; },
            onPeerJoined: (p) => out(`peer ${p.id} (${p.name}) joined from frame ${p.fromFrame}`),
            onPeerLeft: (p, r) => out(`peer ${p.id} left: ${r}`),
        },
    });
    sim.attach(session);
    const port = Number(arg('port', '47811'));
    const server = await wsServer.listenWebSocket({ port, host: arg('host', '0.0.0.0') }, (socket: unknown) => session.accept(wrapSocket(socket as never)));
    out(`listening on port ${server.port}; waiting for ${peers - 1} client(s)`);
    while (session.peerList().length < peers) await sleep(20);
    await drive(frames);
    await sleep(2000); // the clients' last digests
    const st = session.stats;
    out(`RESULT ${JSON.stringify({ frame: session.frame, gameS: sim.galaxy.nowMs / 1000, digest: sim.digest(), checks, mismatches, resyncs, digestMismatches: st.digestMismatches, commandsApplied: st.commandsApplied, playerLog: commandLog(sim.galaxy).filter((e) => e.source === 'player').length, refused, stalls: st.stalls, wallS: (performance.now() - t0) / 1000 })}`);
    session.close('done');
    server.close();
} else {
    const link = await connectWebSocket(arg('url', 'ws://127.0.0.1:47811'));
    session = await LockstepSession.join(link, sim, {
        name: arg('peer-name', 'client'), have: { frame: 0, digest: sim.digest() },
        hooks: { log: (m) => out(m), onResync: () => { resyncs++; }, onHostLost: (r) => out(`host gone: ${r}`) },
    });
    peerId = session.localPeer;
    sim.attach(session);
    out(`joined as peer ${peerId}, commanding ${myEmpire(peerId).name}`);
    await drive(frames);
    out(`RESULT ${JSON.stringify({ peer: peerId, frame: session.frame, gameS: sim.galaxy.nowMs / 1000, digest: sim.digest(), resyncs, commandsApplied: session.stats.commandsApplied, playerLog: commandLog(sim.galaxy).filter((e) => e.source === 'player').length, refused, wallS: (performance.now() - t0) / 1000 })}`);
    await sleep(3000);
    link.close('done');
}
process.exit(0);
