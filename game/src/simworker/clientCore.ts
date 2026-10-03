// Sim worker: the main-thread side of the protocol, without the Worker / DOM (docs/sim-worker.md §2, §4): the replica,
// command forwarding with onApplied replies, the clock hand-off, and render timing. workerClient.ts wraps it around a
// real Worker; the tests drive it against an in-process SimHost.
// No DOM / Pixi imports.

import type { Empire } from '../sim/empire';
import type { Galaxy } from '../sim/galaxy';
import type { GameData } from '../sim/data/gameData';
import type { Game } from '../sim/game';
import { setRemoteCommandSink } from '../sim/player/playerCommands';
import { FRAME_REAL_MS } from '../sim/tick/scheduler';
import { createRenderTime, updateRenderTime, type RenderTime } from '../render/renderInterp';
import { GalaxyReplica } from './replicaGalaxy';
import { decodeRemoteArg, encodeRemoteArg, type RemoteNaming, type RemoteResolving } from './remoteArgs';
import type { ClockMessage, CommandMessage, SnapshotMessage, StepMessage, ToWorker, WorkerEvent } from './protocol';
import type { ApplyStats } from './replicaSync';

/** Main-thread sync cost readout (window.__dwu.simStats in worker mode). */
export interface SyncStats {
    renderFrames: number;
    simFrames: number;
    /** Step messages applied. */
    deltas: number;
    /** Main-thread wall ms: applying hot parts (+ forced cold), pumping cold parts. */
    hotApplyMs: number;
    coldPumpMs: number;
    maxHotApplyMs: number;
    maxColdPumpMs: number;
    /** Average main-thread sync ms per render frame (hot + cold), EMA. */
    avgSyncMsPerRenderFrame: number;
    /** Kept for in-thread compatibility (perf-render reads it): the main thread's sim+sync ms per render frame. */
    avgSimMsPerRenderFrame: number;
    maxSimMsPerRenderFrame: number;
    simWallMs: number;
    /** Worker readouts from the last step message. */
    workerStepMs: number;
    workerDiffMs: number;
    deltaBytes: number;
    hotBytes: number;
    coldBacklog: number;
    reset(): void;
}

function createSyncStats(): SyncStats {
    return {
        renderFrames: 0,
        simFrames: 0,
        deltas: 0,
        hotApplyMs: 0,
        coldPumpMs: 0,
        maxHotApplyMs: 0,
        maxColdPumpMs: 0,
        avgSyncMsPerRenderFrame: 0,
        avgSimMsPerRenderFrame: 0,
        maxSimMsPerRenderFrame: 0,
        simWallMs: 0,
        workerStepMs: 0,
        workerDiffMs: 0,
        deltaBytes: 0,
        hotBytes: 0,
        coldBacklog: 0,
        reset() {
            this.renderFrames = 0;
            this.simFrames = 0;
            this.deltas = 0;
            this.hotApplyMs = 0;
            this.coldPumpMs = 0;
            this.maxHotApplyMs = 0;
            this.maxColdPumpMs = 0;
            this.avgSyncMsPerRenderFrame = 0;
            this.avgSimMsPerRenderFrame = 0;
            this.maxSimMsPerRenderFrame = 0;
            this.simWallMs = 0;
        },
    };
}

/** Clock controls the main thread hands the worker (GalaxyTime's pause / speed). */
export interface ClockControls {
    speed: number;
    paused: boolean;
}

export interface ClientCoreOptions {
    post: (m: ToWorker) => void;
    now?: () => number;
    /** Wall ms per render frame for applying queued cold parts (default 0.5; grows with the backlog). */
    coldBudgetMs?: number;
    onEvent?: (e: WorkerEvent, resolve: (a: unknown) => unknown) => void;
}

export class SimClientCore {
    readonly replica: GalaxyReplica;
    readonly stats = createSyncStats();
    readonly renderTime: RenderTime = createRenderTime();
    readonly game: Game;
    private readonly pending = new Map<number, (r: unknown) => void>();
    private nextCommandId = 1;
    private clockSeq = 0;
    private sent: ClockControls;
    /** The last step message's backlog and the main-thread time it was applied (render alpha). */
    private lastBacklogMs = 0;
    private lastStepAt = 0;
    private paused: boolean;
    private speed: number;
    private readonly inbox: StepMessage[] = [];
    private readonly naming: RemoteNaming;
    private readonly resolving: RemoteResolving;
    private readonly now: () => number;
    private readonly coldBudgetMs: number;
    private disposed = false;

    constructor(gameData: GameData, snapshot: SnapshotMessage, private readonly opts: ClientCoreOptions) {
        this.now = opts.now ?? (() => performance.now());
        this.coldBudgetMs = opts.coldBudgetMs ?? 0.5;
        this.replica = new GalaxyReplica(gameData, snapshot.baseTechCost);
        this.replica.apply(snapshot.delta, true);
        const galaxy = this.replica.galaxy;
        if (galaxy === null) throw new Error('sim worker: the snapshot has no galaxy');
        this.game = { galaxy, playerEmpire: galaxy.playerEmpire as Empire, viewX: snapshot.viewX, viewY: snapshot.viewY };
        this.sent = { ...snapshot.clock };
        this.paused = snapshot.clock.paused;
        this.speed = snapshot.clock.speed;
        this.renderTime.stepSerial = snapshot.stepSerial;
        updateRenderTime(this.renderTime, galaxy.nowMs, 0, this.speed, true, 0);
        const byObject = new Map<object, { kind: string; key: string | number }>();
        // The replica's own static tables (the externals the sync stream resolves), by object.
        for (const [k, o] of this.staticEntries()) {
            if (!byObject.has(o)) {
                const at = k.indexOf(':');
                const key = k.slice(at + 1);
                byObject.set(o, { kind: k.slice(0, at), key: /^-?\d+$/.test(key) ? Number(key) : key });
            }
        }
        this.naming = { syncId: (o) => this.replica.decoder.idOf(o), external: (o) => byObject.get(o) };
        this.resolving = { object: (id) => this.replica.decoder.object(id), external: (kind, key) => this.replica.staticByRef.get(`${kind}:${key}`) };
        setRemoteCommandSink(galaxy, (empire, op, args, onApplied) => this.sendCommand(empire, op, args, onApplied));
    }

    private *staticEntries(): Iterable<[string, object]> {
        yield* this.replica.staticByRef;
    }

    /** The clock controls as last agreed with the worker. */
    get clock(): ClockControls {
        return { speed: this.speed, paused: this.paused };
    }

    get galaxy(): Galaxy {
        return this.game.galaxy;
    }

    /** Resolve a RemoteArg from the worker (results, events) against the replica. */
    resolve(a: unknown): unknown {
        return decodeRemoteArg(a as never, this.resolving);
    }

    private sendCommand(empire: Empire, op: string, args: unknown[], onApplied?: (r: unknown) => void): void {
        const id = onApplied === undefined ? 0 : this.nextCommandId++;
        const empireId = this.replica.decoder.idOf(empire);
        if (empireId < 0) throw new Error(`sim worker: command ${op} from an empire that is not in the replica`);
        const msg: CommandMessage = { type: 'command', id, empire: empireId, op, args: args.map((a) => encodeRemoteArg(a, this.naming)) };
        if (onApplied !== undefined) this.pending.set(id, onApplied);
        this.opts.post(msg);
    }

    /** Hand the worker the HUD clock's pause / speed when they changed. */
    syncClock(time: ClockControls): void {
        if (time.speed === this.sent.speed && time.paused === this.sent.paused) return;
        this.sent = { speed: time.speed, paused: time.paused };
        const m: ClockMessage = { type: 'clock', seq: ++this.clockSeq, speed: time.speed, paused: time.paused };
        this.opts.post(m);
    }

    /** A step message arrived (applied at the next frame(), so all main-thread sync work happens inside frames). */
    receive(m: StepMessage): void {
        this.inbox.push(m);
    }

    /**
     * Once per render frame: apply the step messages received since the last frame (hot parts at once), pump the cold
     * queue for its budget, adopt the worker's pause / speed when our last clock change has reached it, and refresh
     * renderTime. Returns the sim steps that landed.
     */
    frame(time: ClockControls): number {
        const t0 = this.now();
        this.syncClock(time);
        let steps = 0;
        let hotMs = 0;
        for (let k = 0; k < this.inbox.length; k++) {
            const m = this.inbox[k];
            const st: ApplyStats = this.replica.apply(m.delta);
            hotMs += st.applyMs;
            steps += m.steps;
            this.stats.deltas++;
            this.stats.workerStepMs = m.stepMs;
            this.stats.workerDiffMs = m.diffMs;
            this.stats.deltaBytes = m.delta.stats.bytes;
            this.stats.hotBytes = m.delta.stats.hotBytes;
            this.lastBacklogMs = m.backlogMs;
            this.lastStepAt = t0;
            if (m.clockSeq === this.clockSeq) {
                // The worker has every clock change we sent: its pause / speed are current (a game end may have paused).
                this.paused = m.paused;
                this.speed = m.speed;
                if (time.paused !== m.paused || time.speed !== m.speed) {
                    time.paused = m.paused;
                    time.speed = m.speed;
                    this.sent = { speed: m.speed, paused: m.paused };
                }
            }
            for (const r of m.results) {
                const cb = this.pending.get(r.id);
                this.pending.delete(r.id);
                if (r.error !== undefined) console.warn(`sim worker: command reply ${r.id}: ${r.error}`);
                else if (cb !== undefined) {
                    try {
                        cb(this.resolve(r.result));
                    } catch (err) {
                        queueMicrotask(() => {
                            throw err;
                        });
                    }
                }
            }
            for (const e of m.events) this.opts.onEvent?.(e, (a) => this.resolve(a));
        }
        const last = this.inbox.length > 0 ? this.inbox[this.inbox.length - 1] : null;
        this.inbox.length = 0;
        const cold = this.replica.pumpCold(this.coldBudgetMs);
        const t2 = this.now();
        // Render alpha: the worker's backlog after its last tick plus the real time since we applied it.
        const backlog = this.paused ? 0 : Math.min(FRAME_REAL_MS, this.lastBacklogMs + (t0 - this.lastStepAt));
        // updateRenderTime adds `steps`: land on the worker's cumulative serial.
        if (last !== null) this.renderTime.stepSerial = last.stepSerial - steps;
        updateRenderTime(this.renderTime, this.galaxy.nowMs, backlog, this.speed, this.paused, steps);
        const s = this.stats;
        s.renderFrames++;
        s.simFrames += steps;
        s.hotApplyMs += hotMs;
        s.coldPumpMs += cold.applyMs;
        if (hotMs > s.maxHotApplyMs) s.maxHotApplyMs = hotMs;
        if (cold.applyMs > s.maxColdPumpMs) s.maxColdPumpMs = cold.applyMs;
        const dt = t2 - t0;
        s.simWallMs += dt;
        s.avgSyncMsPerRenderFrame += (dt - s.avgSyncMsPerRenderFrame) * 0.05;
        s.avgSimMsPerRenderFrame = s.avgSyncMsPerRenderFrame;
        if (dt > s.maxSimMsPerRenderFrame) s.maxSimMsPerRenderFrame = dt;
        s.coldBacklog = this.replica.decoder.coldBacklog;
        return steps;
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        setRemoteCommandSink(this.galaxy, null);
        this.pending.clear();
    }
}
