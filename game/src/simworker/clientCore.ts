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

/**
 * Render pacing for worker steps (docs/sim-worker.md §9 chunk 2: interpolation timing under jitter). In-thread, a step
 * runs inside the render frame and the frame's alpha is the budget's backlog, so the drawn game time advances with the
 * wall clock. Worker steps land whenever their message does — after the worker's step and diff (10-30 ms, varying), a
 * postMessage hop and the frame in progress — and, when the worker falls behind real time, several steps at once.
 * Taking alpha from each message's own backlog at the frame it is applied makes the drawn time stand still and jump by
 * that variation every step (the interpolator keeps only the last two steps).
 *
 * The pacer is a playout buffer in step units: a drawn position (cumulative step serial, fractional) that advances
 * with the wall clock at the rate steps have been arriving (over the last two seconds: 1 while the worker keeps real
 * time, less when it falls behind, more while it catches up), a little faster or slower to stay `target` steps behind
 * the latest step received, and never past it. `target` covers the arrival jitter measured over the same window (how
 * late each message's first step came against the steady rate: a burst of k steps is k − 1 steps late for its first),
 * plus one step for the interpolated pair; it grows at once, shrinks slowly, and grows again when the drawn position
 * catches up with the latest step anyway. A step message is applied once the drawn position needs it; alpha is the
 * drawn position's place between the last two applied steps (negative within a burst: see SimClientCore.frame). Far
 * behind (a stall), it skips ahead.
 */
export class StepPacer {
    static readonly MIN_TARGET = 1;
    static readonly MAX_TARGET = 12;
    /** Steps beyond `target` the drawn position may fall behind before it skips ahead. */
    static readonly MAX_LAG = 12;
    /** Real ms of arrivals the rate and the jitter are measured over. */
    static readonly WINDOW_MS = 2000;
    /** Speed-up / slow-down per step the buffer is above / below `target` (bounded; low, so arrival jitter and
     *  bursts do not modulate the drawn speed — tuned on test/simWorkerPacing.test.ts's arrival patterns). */
    static readonly GAIN_ABOVE = 0.03;
    static readonly GAIN_BELOW = 0.06;
    /** Drawn position, in steps (alpha = drawn − (latest applied − 1)); NaN until the first advance. */
    drawn = Number.NaN;
    /** Steps the drawn position aims to stay behind the latest step received. */
    target = 2;
    /** Steps arriving per FRAME_REAL_MS of real time (over the window; 1 while the worker keeps real time). */
    rate = 1;
    /** Cumulative serial of the latest step received. */
    received = 0;
    /** Recent arrivals: time, steps, serial after. */
    private readonly window: { at: number; steps: number; serial: number }[] = [];
    private lastFrame = Number.NaN;

    /** A step message arrived at `atMs` with `steps` steps, bringing the serial to `serial`. */
    arrived(steps: number, serial: number, atMs: number): void {
        if (serial > this.received) this.received = serial;
        if (steps <= 0) return;
        const w = this.window;
        w.push({ at: atMs, steps, serial });
        while (w.length > 2 && atMs - w[0].at > StepPacer.WINDOW_MS) w.shift();
        if (w.length < 2) return;
        // Rate: the steps after the first arrival over the time since it.
        const first = w[0];
        const span = Math.max(1, atMs - first.at);
        this.rate = Math.min(8, Math.max(0.05, ((serial - first.serial) * FRAME_REAL_MS) / span));
        // Jitter: how late each message's FIRST step came against the line through the window at that rate (a burst
        // of k steps is k − 1 steps late for its first one). The buffer must cover the spread, plus the pair.
        const msPerStep = FRAME_REAL_MS / this.rate;
        let lo = Infinity;
        let hi = -Infinity;
        for (const a of w) {
            const late = a.at - (first.at + (a.serial - a.steps + 1 - first.serial) * msPerStep);
            if (late < lo) lo = late;
            if (late > hi) hi = late;
        }
        const want = Math.min(StepPacer.MAX_TARGET, Math.max(StepPacer.MIN_TARGET, (hi - lo) / msPerStep + 1));
        // Up fast, down slowly.
        this.target += (want - this.target) * (want > this.target ? 0.5 : 0.02);
    }

    /** Advance the drawn position to frame time `nowMs` (`applied`: the latest applied step's serial); returns it. */
    advance(nowMs: number, applied: number): number {
        if (Number.isNaN(this.drawn)) this.drawn = applied - 1;
        const dt = Number.isNaN(this.lastFrame) ? 0 : Math.min(100, Math.max(0, nowMs - this.lastFrame));
        this.lastFrame = nowMs;
        const ahead = this.received - this.drawn;
        if (ahead > this.target + StepPacer.MAX_LAG) {
            this.drawn = this.received - this.target;
        } else {
            // A little faster / slower to hold the buffer at `target` (more so when it runs low).
            const e = ahead - this.target;
            const gain = e < 0 ? Math.max(-0.6, e * StepPacer.GAIN_BELOW) : Math.min(0.4, e * StepPacer.GAIN_ABOVE);
            const next = this.drawn + (dt / FRAME_REAL_MS) * this.rate * (1 + gain);
            if (next > this.received) {
                // Starved: the next step is later than the buffer allowed for.
                this.drawn = this.received;
                this.target = Math.min(StepPacer.MAX_TARGET, this.target + 0.25);
            } else this.drawn = next;
        }
        return this.drawn;
    }

    /** Paused (or resuming): draw the committed state and start the measurements over. */
    hold(applied: number, nowMs: number): void {
        this.drawn = applied - 1;
        this.window.length = 0;
        this.lastFrame = nowMs;
    }
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
    /**
     * Pace step messages (StepPacer: the drawn game time follows the wall clock under arrival jitter; the browser
     * client). Off (tests, tools): every message received is applied at the next frame().
     */
    pace?: boolean;
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
    readonly pacer = new StepPacer();
    /** Steps of the last applied step message (how far back alpha may reach: StepPacer). */
    private lastSteps = 1;
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

    /** A step message arrived (applied in a later frame(), so all main-thread sync work happens inside frames). */
    receive(m: StepMessage): void {
        this.inbox.push(m);
        this.pacer.arrived(m.paused ? 0 : m.steps, m.stepSerial, this.now());
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
        const pace = this.opts.pace === true;
        let take = this.inbox.length;
        let drawn = Number.NaN;
        if (pace && !this.paused) {
            // Paced: the messages up to the step the drawn position needs (a message without steps — a command reply,
            // the clock while paused — goes as soon as those before it have).
            drawn = this.pacer.advance(t0, this.renderTime.stepSerial);
            let serial = this.renderTime.stepSerial;
            take = 0;
            while (take < this.inbox.length) {
                const m = this.inbox[take];
                if (m.steps > 0 && serial >= drawn) break;
                serial = m.stepSerial;
                take++;
            }
        }
        for (let k = 0; k < take; k++) {
            const m = this.inbox[k];
            if (m.steps > 0) this.lastSteps = m.steps;
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
        const last = take > 0 ? this.inbox[take - 1] : null;
        this.inbox.splice(0, take);
        const cold = this.replica.pumpCold(this.coldBudgetMs);
        const t2 = this.now();
        // updateRenderTime adds `steps`: land on the worker's cumulative serial.
        if (last !== null) this.renderTime.stepSerial = last.stepSerial - steps;
        if (pace && !this.paused) {
            // Render alpha: the drawn position's place between the last two applied steps. It may lie before the
            // earlier of the two when one message brought several steps (the interpolator's previous position is the
            // linear estimate one step back, so a negative alpha follows the same line further back).
            const alpha = drawn - (this.renderTime.stepSerial + steps - 1);
            updateRenderTime(this.renderTime, this.galaxy.nowMs, Math.max(0, Math.min(1, alpha)) * FRAME_REAL_MS, this.speed, false, steps);
            if (alpha < 0) {
                const a = Math.max(alpha, -Math.min(StepPacer.MAX_TARGET + StepPacer.MAX_LAG, this.lastSteps - 1));
                this.renderTime.alpha = a;
                this.renderTime.renderNowMs = this.galaxy.nowMs + a * this.renderTime.stepGameMs;
            }
        } else {
            if (pace) this.pacer.hold(this.renderTime.stepSerial + steps, t0);
            // Render alpha: the worker's backlog after its last tick plus the real time since we applied it.
            const backlog = this.paused ? 0 : Math.min(FRAME_REAL_MS, this.lastBacklogMs + (t0 - this.lastStepAt));
            updateRenderTime(this.renderTime, this.galaxy.nowMs, backlog, this.speed, this.paused, steps);
        }
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
