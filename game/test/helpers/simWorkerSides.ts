// Sim worker test sides (docs/sim-worker.md §9): the same game played in-thread (the app loop, simLoop.ts) or in
// worker mode (SimHost + SimClientCore wired in-process, messages structured-cloned as postMessage would), driven tick
// for tick; and the setup the chunk-7 tests share (the player meets everyone).
import { expect } from 'vitest';
import type { GameData } from '../../src/sim/data/gameData';
import type { Game } from '../../src/sim/game';
import type { Galaxy } from '../../src/sim/galaxy';
import type { Empire } from '../../src/sim/empire';
import type { Camera } from '../../src/render/camera';
import type { StartGameOptions } from '../../src/sim/startGameOptions';
import { GalaxyTime } from '../../src/sim/galaxyTime';
import { FRAME_REAL_MS } from '../../src/sim/tick/scheduler';
import { stateDigest } from '../../src/sim/tick/digest';
import { commandLog } from '../../src/sim/player/commandLog';
import { createSimLoop } from '../../src/simLoop';
import { SimHost } from '../../src/simworker/simHost';
import { SimClientCore } from '../../src/simworker/clientCore';
import type { ToWorker } from '../../src/simworker/protocol';
import { installReplicaWriteDetector, type ReplicaWriteDetector } from '../../src/simworker/writeDetector';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../../src/sim/diplomacy';
import { PirateRelationType, obtainPirateRelation } from '../../src/sim/pirateRelations';

const START = {} as StartGameOptions;

/** A fake wall clock: each tick is exactly one step's worth of real time (the budget runs one step per tick). */
export function fakeClock(): () => number {
    let t = 0;
    return () => (t += 0.001);
}

/** One way of playing the game: in-thread (the app loop) or worker (host + replica client, wired in-process). */
export interface Side {
    worker: boolean;
    /** The galaxy the UI reads and orders on: the game itself, or the replica. */
    galaxy: Galaxy;
    player: Empire;
    /** The authoritative galaxy (the game in-thread; the host's in worker mode). */
    real: Galaxy;
    tick(): void;
    /** Worker: bring the replica exactly up to date (a full compare), as the test reads it like a screen would. */
    settle(): void;
    digest(): string;
    dispose(): void;
}

export function inThread(game: Game): Side {
    const time = new GalaxyTime();
    time.paused = false;
    const loop = createSimLoop(game.galaxy, time, {} as Camera, false);
    (loop.budget as { now: () => number }).now = fakeClock();
    return {
        worker: false,
        galaxy: game.galaxy,
        player: game.playerEmpire,
        real: game.galaxy,
        tick: () => loop.tick(FRAME_REAL_MS),
        settle: () => undefined,
        digest: () => stateDigest(game.galaxy),
        dispose: () => undefined,
    };
}

export interface WorkerSide extends Side {
    host: SimHost;
    client: SimClientCore;
    /** The replica write detector (chunk 0, src/simworker/writeDetector.ts), installed from the start. */
    detector: ReplicaWriteDetector;
    /** checkAll, then the keys written on the main thread that are not on the allow-list ([] = none). */
    replicaWrites(): string[];
}

export function inWorker(game: Game, gameData: GameData): WorkerSide {
    const time = new GalaxyTime();
    time.paused = false;
    const host = new SimHost(game, time, START, { now: fakeClock() });
    const toHost = (m: ToWorker): void => {
        const c = structuredClone(m);
        if (c.type === 'command') host.command(c);
        else if (c.type === 'clock') host.clock(c);
    };
    const client = new SimClientCore(gameData, structuredClone(host.snapshot()), { post: toHost, now: fakeClock() });
    // Every main-thread write to the replica (the screens' code included) is found; nothing reported while quiet.
    const detector = installReplicaWriteDetector(client.replica, { warn: () => undefined, sweepBudgetMs: 0 });
    const uiTime = new GalaxyTime();
    uiTime.bindGalaxy(client.galaxy);
    uiTime.speed = time.speed;
    uiTime.paused = time.paused;
    return {
        worker: true,
        galaxy: client.galaxy,
        player: client.game.playerEmpire,
        real: game.galaxy,
        host,
        client,
        tick: () => {
            client.syncClock(uiTime);
            const m = host.tick(FRAME_REAL_MS);
            if (m !== null) client.receive(structuredClone(m));
            client.frame(uiTime);
        },
        settle: () => client.replica.apply(structuredClone(host.sync.delta(true)), true),
        digest: () => host.digest(),
        detector,
        replicaWrites: () => {
            detector.checkAll();
            return detector.unexpected().map((x) => `${x.key} (${x.detail})`);
        },
        dispose: () => {
            detector.dispose();
            client.dispose();
            host.dispose();
        },
    };
}

/** The same empire / object on the other side (by its stable keys). */
export function empireOn(side: Side, e: Empire): Empire {
    return [...side.galaxy.empires, ...side.galaxy.pirateEmpires].find((x) => x !== null && x.empireId === e.empireId)!;
}

export function normalAis(g: Galaxy): Empire[] {
    return g.empires.filter((e) => e !== null && e.active && e !== g.playerEmpire && e !== g.independentEmpire && e.pirateEmpireBaseHabitat === null);
}

export function setRelation(a: Empire, b: Empire, type: DiplomaticRelationType): void {
    for (const [x, y] of [[a, b], [b, a]] as const) {
        const r = obtainDiplomaticRelation(x, y);
        r.type = type;
        r.initiator = a;
        r.locked = false;
    }
}

/** The player has met every empire (one relation type each, cycling) and every pirate faction. */
export function meetAll(g: Galaxy): void {
    const player = g.playerEmpire!;
    const types = [DiplomaticRelationType.None, DiplomaticRelationType.FreeTradeAgreement, DiplomaticRelationType.War, DiplomaticRelationType.TradeSanctions];
    normalAis(g).forEach((e, i) => setRelation(player, e, types[i % types.length]));
    for (const p of g.pirateEmpires) {
        if (p === null) continue;
        obtainPirateRelation(player, p).type = PirateRelationType.None;
        obtainPirateRelation(p, player).type = PirateRelationType.None;
    }
    for (const a of normalAis(g)) for (const b of normalAis(g)) if (a !== b && obtainDiplomaticRelation(a, b).type === DiplomaticRelationType.NotMet) setRelation(a, b, DiplomaticRelationType.None);
}

export function expectSameGame(a: Side, w: Side): void {
    expect(a.real.nowMs).toBe(w.real.nowMs);
    expect(JSON.stringify(commandLog(w.real))).toBe(JSON.stringify(commandLog(a.real)));
    expect(w.digest()).toBe(a.digest());
}

/** Drive both sides tick for tick; `step(side, i)` plays the UI's part on each before tick i. */
export function drive(sides: Side[], ticks: number, step: (side: Side, i: number) => void): void {
    for (let i = 0; i < ticks; i++) {
        for (const s of sides) {
            s.settle();
            step(s, i);
        }
        for (const s of sides) s.tick();
    }
}
