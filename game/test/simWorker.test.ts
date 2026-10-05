// Sim worker (docs/sim-worker.md §6): the worker host + replica client, driven in-process, against the in-thread loop.
// - the scripted player (helpers/commandScript.ts, 60 s scale) issuing its commands on the REPLICA, forwarded to the
//   host and applied on the authoritative game, gives the same state digest and command log as the same commands
//   issued in-thread through simLoop.ts createSimLoop — tick for tick;
// - after a full compare the replica's save text is identical to the authoritative game's (every object, every field,
//   the side tables, the territory grid);
// - a save taken from the host loads into a new host that continues identically; the replica built from it matches.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import { commandScript, createdFleets, dueSteps, issueStep, setRunId } from './helpers/commandScript';
import type { GameData } from '../src/sim/data/gameData';
import type { Game } from '../src/sim/game';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { FRAME_REAL_MS } from '../src/sim/tick/scheduler';
import { stateDigest } from '../src/sim/tick/digest';
import { commandLog } from '../src/sim/player/commandLog';
import { createSimLoop } from '../src/simLoop';
import { deserializeGame } from '../src/sim/save/gameSave';
import { galaxyToJSON } from '../src/sim/save/galaxySave';
import { ShipGroup } from '../src/sim/fleets/shipGroup';
import type { Camera } from '../src/render/camera';
import type { StartGameOptions } from '../src/sim/startGameOptions';
import { SimHost } from '../src/simworker/simHost';
import { SimClientCore } from '../src/simworker/clientCore';
import type { ToWorker } from '../src/simworker/protocol';
import { reviveCreateOptions, workerCreateOptions } from '../src/simworker/bootOptions';
import { tickGameOptions } from './helpers/tickGame';
import { createGame } from '../src/sim/game';
import { VictoryConditions } from '../src/sim/victory';
import { serializeGame } from '../src/sim/save/gameSave';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

const SCRIPT = commandScript(0.1);
const END_MS = 60_000;
const START_OPTIONS = {} as StartGameOptions;

/** A fake wall clock: each tick is exactly one step's worth of real time, so the budget runs one step per tick. */
function fakeClock(): () => number {
    let t = 0;
    return () => (t += 0.001);
}

/** Host + client wired in-process (messages passed directly; deltas structured-cloned as postMessage would). */
function connect(game: Game, time: GalaxyTime): { host: SimHost; client: SimClientCore; tick: () => void; time: GalaxyTime } {
    const host = new SimHost(game, time, START_OPTIONS, { now: fakeClock() });
    const snap = structuredClone(host.snapshot());
    const toHost = (m: ToWorker): void => {
        const c = structuredClone(m);
        if (c.type === 'command') host.command(c);
        else if (c.type === 'clock') host.clock(c);
    };
    const client = new SimClientCore(gameData, snap, { post: toHost, now: fakeClock() });
    const uiTime = new GalaxyTime();
    uiTime.bindGalaxy(client.galaxy);
    uiTime.speed = time.speed;
    uiTime.paused = time.paused;
    const tick = (): void => {
        client.syncClock(uiTime);
        const m = host.tick(FRAME_REAL_MS);
        if (m !== null) client.receive(structuredClone(m));
        client.frame(uiTime);
    };
    return { host, client, tick, time: uiTime };
}

describe('sim worker: host + replica vs the in-thread loop', () => {
    it('scripted commands issued on the replica give the in-thread digest and command log, tick for tick', () => {
        // In-thread reference: the real app loop (simLoop.ts), one render frame of exactly FRAME_REAL_MS per tick.
        const ref = cachedTickGame(gameData);
        setRunId(ref.galaxy, 'sw-ref');
        const refTime = new GalaxyTime();
        refTime.paused = false;
        const loop = createSimLoop(ref.galaxy, refTime, {} as Camera, false);
        (loop.budget as { now: () => number }).now = fakeClock();
        let ticks = 0;
        while (ref.galaxy.nowMs < END_MS) {
            for (const s of dueSteps(SCRIPT, ref.galaxy)) issueStep(ref.galaxy, ref.playerEmpire, s);
            refTime.speed = SCRIPT.speedAt(ref.galaxy.nowMs);
            loop.tick(FRAME_REAL_MS);
            ticks++;
        }

        // Worker: the same game, the scripted player reading and ordering on the replica.
        const game = cachedTickGame(gameData);
        const time = new GalaxyTime();
        time.paused = false;
        const w = connect(game, time);
        const rg = w.client.galaxy;
        setRunId(rg, 'sw-worker');
        let wTicks = 0;
        while (game.galaxy.nowMs < END_MS) {
            const due = dueSteps(SCRIPT, rg);
            if (due.length > 0) {
                // Resolve the script's targets on an exactly-current replica (a full compare), as the in-thread script does.
                w.client.replica.apply(structuredClone(w.host.sync.delta(true)), true);
                expect(rg.nowMs).toBe(game.galaxy.nowMs);
                for (const s of due) issueStep(rg, w.client.game.playerEmpire, s);
            }
            w.time.speed = SCRIPT.speedAt(rg.nowMs);
            w.tick();
            wTicks++;
            expect(rg.nowMs).toBe(game.galaxy.nowMs);
        }
        expect(wTicks).toBe(ticks);
        expect(game.galaxy.nowMs).toBe(ref.galaxy.nowMs);
        expect(JSON.stringify(commandLog(game.galaxy))).toBe(JSON.stringify(commandLog(ref.galaxy)));
        expect(w.host.digest()).toBe(stateDigest(ref.galaxy));
        // The 'create a fleet' reply came back as a replica ShipGroup (of the replica's player empire; the AI may have
        // merged the fleet away since, so it need not be live now).
        const fleet = createdFleets.get(rg);
        expect(fleet).toBeInstanceOf(ShipGroup);
        expect(fleet!.empire).toBe(w.client.game.playerEmpire);

        // Replica fidelity: after a full compare its save text is the authoritative game's.
        w.client.replica.apply(structuredClone(w.host.sync.delta(true)), true);
        expect(JSON.stringify(galaxyToJSON(rg)) === JSON.stringify(galaxyToJSON(game.galaxy))).toBe(true);
        expect(stateDigest(rg)).toBe(w.host.digest());
        w.client.dispose();
        w.host.dispose();
    }, 600000);

    it('a paused game settles to the exact game without a full compare (side tables included)', () => {
        // docs/sim-worker.md §8 "Cold staleness": after the last change the worker keeps comparing for two cold cycles,
        // then goes quiet; the replica must then be the authoritative game — also the side tables (Random draw counts,
        // prices, characters). They went onto the replica's objects only every 60th apply, so once the stream stopped
        // the last values never landed (GalaxyReplica now also applies them when the stream goes idle); and the worker
        // recollected them at the delta after a cold cycle wrapped, after the new cycle had already compared them.
        const game = cachedTickGame(gameData);
        const time = new GalaxyTime();
        time.paused = false;
        time.speed = 4;
        const w = connect(game, time);
        w.time.speed = 4;
        w.time.paused = false;
        while (game.galaxy.nowMs < 20_000) w.tick();
        w.time.paused = true;
        let quiet = 0;
        let ticks = 0;
        while (quiet < 20 && ticks < 20000) {
            w.client.syncClock(w.time);
            const m = w.host.tick(FRAME_REAL_MS);
            if (m !== null) {
                w.client.receive(structuredClone(m));
                quiet = 0;
            } else quiet++;
            w.client.frame(w.time);
            ticks++;
        }
        // The cold queue pumped out.
        for (let i = 0; i < 200; i++) w.client.frame(w.time);
        expect(quiet).toBe(20);
        const rep = JSON.stringify(galaxyToJSON(w.client.galaxy));
        const auth = JSON.stringify(galaxyToJSON(game.galaxy));
        if (rep !== auth) {
            // Name the first difference (a side table is at the end of the text).
            let i = 0;
            while (i < rep.length && rep[i] === auth[i]) i++;
            console.log(`replica / game differ at ${i}: ${rep.slice(i - 160, i + 60)} ||| ${auth.slice(i - 160, i + 60)}`);
        }
        expect(rep === auth).toBe(true);
        expect(stateDigest(w.client.galaxy)).toBe(w.host.digest());
        w.client.dispose();
        w.host.dispose();
    }, 600000);

    it('with no render frames (a hidden window) the step messages are applied as they arrive, not piled up', () => {
        // SimWorkerClient's glue (workerClient.ts onMessage 'step'): received, then frame(time, true) while the render
        // frames have stopped. An alt-tabbed late game queued every delta in the inbox until the window came back.
        const game = cachedTickGame(gameData);
        const time = new GalaxyTime();
        time.speed = 4;
        time.paused = false;
        const { host, client, time: uiTime } = connect(game, time);
        expect(client.renderFramesStalled(250)).toBe(true); // (no frame yet)
        for (let i = 0; i < 120; i++) {
            client.syncClock(uiTime);
            const m = host.tick(FRAME_REAL_MS);
            if (m === null) continue;
            client.receive(structuredClone(m));
            if (client.renderFramesStalled(250)) client.frame(uiTime, true);
            expect(client.inboxLength).toBe(0);
            expect(client.replica.decoder.coldBacklog).toBe(0);
        }
        expect(client.galaxy.nowMs).toBe(game.galaxy.nowMs);
        expect(client.galaxy.nowMs).toBeGreaterThan(0);
        // A render frame: no longer stalled.
        client.frame(uiTime);
        expect(client.renderFramesStalled(250)).toBe(false);
    });

    it('a save from the host loads into a new host that continues identically', () => {
        const game = cachedTickGame(gameData);
        const time = new GalaxyTime();
        time.paused = false;
        time.speed = 2;
        const a = connect(game, time);
        for (let i = 0; i < 300; i++) a.tick();
        const text = a.host.save();
        // Round trip: the loaded game re-serializes to the same text.
        const loaded = deserializeGame(text, gameData);
        expect(new SimHost(loaded.game, loaded.time, START_OPTIONS).save()).toBe(text);
        const again = deserializeGame(text, gameData);
        const b = connect(again.game, again.time);
        expect(b.time.speed).toBe(2);
        expect(b.time.paused).toBe(false);
        for (let i = 0; i < 300; i++) {
            a.tick();
            b.tick();
        }
        expect(b.host.digest()).toBe(a.host.digest());
        b.client.replica.apply(structuredClone(b.host.sync.delta(true)), true);
        expect(stateDigest(b.client.galaxy)).toBe(a.host.digest());
        for (const c of [a, b]) {
            c.client.dispose();
            c.host.dispose();
        }
    }, 600000);

    it('createGame options cloned into the worker build the identical game', () => {
        const opts = { ...tickGameOptions(gameData), victoryConditions: Object.assign(new VictoryConditions(), { territory: true, territoryPercent: 0.4 }) };
        const here = createGame(opts);
        const there = createGame(reviveCreateOptions(structuredClone(workerCreateOptions(opts)), gameData));
        const t = (g: Game): string => serializeGame(g, new GalaxyTime().bindGalaxy(g.galaxy), START_OPTIONS);
        expect(t(there) === t(here)).toBe(true);
    }, 600000);
});
