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
import { ReplicaTradeFlows } from './tradeFlowSync';
import { RemoteArgError, decodeRemoteArg, encodeRemoteArg, type RemoteArg, type RemoteNaming, type RemoteResolving } from './remoteArgs';
import { setRemoteQuerySink, type SimQueryName } from './simQuery';
import { BuiltObject } from '../sim/builtObject';
import { Creature } from '../sim/creature';
import { Fighter } from '../sim/combat/fighters';
import { ShipGroup } from '../sim/fleets/shipGroup';
import { Empire as EmpireClass } from '../sim/empire';
import { Habitat } from '../sim/types';
import type { ClockMessage, CommandMessage, HostOpMessage, QueryMessage, SnapshotMessage, StepMessage, ToWorker, WorkerEvent } from './protocol';
import { setRemoteSimHost, type RemoteSimHost } from './remoteHost';
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
    /** [simworker chunk 1] Optimistic pause holds: how many, the last one's wall ms from the press to the worker's ack,
     *  and the steps that were in flight (applied at the ack). */
    pauseHolds: number;
    lastPauseAckMs: number;
    lastPauseInFlightSteps: number;
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
        pauseHolds: 0,
        lastPauseAckMs: 0,
        lastPauseInFlightSteps: 0,
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
    private readonly lateness: number[] = [];
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
        const late = this.lateness;
        late.length = 0;
        for (const a of w) late.push(a.at - (first.at + (a.serial - a.steps + 1 - first.serial) * msPerStep));
        late.sort((x, y) => x - y);
        // The spread without the latest 5 % (one stall must not hold a big buffer for the whole window: a message later
        // than the buffer only stands the drawn position still until it lands).
        const spread = late[Math.min(late.length - 1, Math.floor(late.length * 0.95))] - late[0];
        const want = Math.min(StepPacer.MAX_TARGET, Math.max(StepPacer.MIN_TARGET, spread / msPerStep + 1));
        // Up fast, down within a few dozen arrivals (the window itself holds a late spell for its length).
        this.target += (want - this.target) * (want > this.target ? 0.5 : 0.1);
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

    /** Skip ahead to at least `minDrawn` (messages applied ahead of the drawn position: a reply that waited); returns it. */
    catchUp(minDrawn: number): number {
        if (!(this.drawn >= minDrawn)) this.drawn = minDrawn;
        return this.drawn;
    }

    /**
     * Paused (or holding an optimistic pause): the drawn position stands where it was when the pause began (never past
     * the latest applied step; the committed state before anything was drawn; `atApplied`: exactly at it), and the
     * arrival measurements start over when the steps resume. Returns it.
     */
    hold(applied: number, nowMs: number, atApplied = false): number {
        if (Number.isNaN(this.drawn)) this.drawn = applied - 1;
        else if (this.drawn > applied || atApplied) this.drawn = applied;
        this.window.length = 0;
        this.lastFrame = nowMs;
        return this.drawn;
    }
}

/**
 * Objects that only ever exist in the game graph. One the replica no longer knows (destroyed and dropped by the sync's
 * mark, while the HUD or a list still held it) cannot be named to the worker, and must not travel by value (the worker
 * would act on a copy): the command or query is dropped instead.
 */
const IDENTITY_PROTOS: ReadonlySet<object> = new Set<object>([BuiltObject.prototype, Habitat.prototype, ShipGroup.prototype, Creature.prototype, Fighter.prototype, EmpireClass.prototype]);

/** Longest a step message carrying a command / query reply is held by the pacer (real ms since it arrived). */
export const REPLY_WAIT_MS = 50;

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
    /** Longest the optimistic pause holds the replica without the worker's ack (default 500 ms; then deltas apply). */
    pauseHoldMaxMs?: number;
}

export class SimClientCore {
    readonly replica: GalaxyReplica;
    readonly stats = createSyncStats();
    readonly renderTime: RenderTime = createRenderTime();
    readonly game: Game;
    private readonly pending = new Map<number, (r: unknown) => void>();
    /** Replies awaited as promises (remoteHost.ts): rejected when the worker reports an error. */
    private readonly failing = new Map<number, (err: Error) => void>();
    private readonly listeners = new Set<(e: WorkerEvent, resolve: (a: unknown) => unknown) => void>();
    private nextCommandId = 1;
    private clockSeq = 0;
    private sent: ClockControls;
    /** The last step message's backlog and the main-thread time it was applied (render alpha). */
    private lastBacklogMs = 0;
    private lastStepAt = 0;
    private paused: boolean;
    private speed: number;
    private readonly inbox: StepMessage[] = [];
    /** Main-thread arrival time of each inbox message. */
    private readonly arrivals: number[] = [];
    readonly pacer = new StepPacer();
    /** Steps applied by the last frame that applied any (how far back alpha may reach: StepPacer). */
    private lastSteps = 1;
    private readonly naming: RemoteNaming;
    private readonly resolving: RemoteResolving;
    private readonly now: () => number;
    private readonly coldBudgetMs: number;
    private disposed = false;
    /**
     * [simworker chunk 1] Optimistic pause: the clock seq of a pause sent and not yet acknowledged (0: none). While it
     * is set, step messages are held, not applied: the replica (nowMs, positions) and the render time stand still from
     * the frame the player paused, as in-thread, instead of running on for the round trip. The worker's ack (a step
     * message whose clockSeq reaches it) releases them, with the steps that were already in flight.
     */
    private holdSeq = 0;
    private holdSince = 0;
    private readonly pauseHoldMaxMs: number;
    private unbindClock: (() => void) | null = null;
    /** The replica's trade-flow ledger hooks (recording runs in the worker; tradeFlowSync.ts). */
    readonly tradeFlows: ReplicaTradeFlows;

    constructor(gameData: GameData, snapshot: SnapshotMessage, private readonly opts: ClientCoreOptions) {
        this.now = opts.now ?? (() => performance.now());
        this.coldBudgetMs = opts.coldBudgetMs ?? 0.5;
        this.pauseHoldMaxMs = opts.pauseHoldMaxMs ?? 500;
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
        this.naming = {
            syncId: (o) => {
                const id = this.replica.decoder.idOf(o);
                if (id < 0 && IDENTITY_PROTOS.has(Object.getPrototypeOf(o) as object)) {
                    const name = (o as { name?: unknown }).name;
                    throw new RemoteArgError(`${(o as object).constructor.name}${typeof name === 'string' ? ` ${name}` : ''} is no longer in the game`);
                }
                return id;
            },
            external: (o) => byObject.get(o),
        };
        this.resolving = { object: (id) => this.replica.decoder.object(id), external: (kind, key) => this.replica.staticByRef.get(`${kind}:${key}`) };
        setRemoteCommandSink(galaxy, (empire, op, args, onApplied) => this.sendCommand(empire, op, args, onApplied));
        setRemoteQuerySink(galaxy, (empire, op, args, done) => this.sendQuery(empire, op, args, done));
        this.tradeFlows = new ReplicaTradeFlows(
            galaxy,
            () => this.replica.decoder.object(1) as Record<string, unknown> | null,
            (record) => this.opts.post({ type: 'tradeFlows', record }),
        );
        setRemoteSimHost(galaxy, this.remoteHost());
    }

    /** The replica's handle for the local-model paths (remoteHost.ts): commands and host ops with promised results. */
    private remoteHost(): RemoteSimHost {
        return {
            command: (empire, op, args) =>
                new Promise((resolve, reject) => this.sendCommand(empire, op, args as unknown[], resolve as (r: unknown) => void, reject)) as never,
            hostOp: (op, args) =>
                new Promise((resolve, reject) => {
                    const encoded = (args as unknown[]).map((a) => encodeRemoteArg(a, this.naming));
                    const id = this.nextCommandId++;
                    const msg: HostOpMessage = { type: 'hostOp', id, op, args: encoded };
                    this.pending.set(id, resolve as (r: unknown) => void);
                    this.failing.set(id, reject);
                    this.opts.post(msg);
                }) as never,
            subscribe: (listener) => {
                this.listeners.add(listener);
                return () => this.listeners.delete(listener);
            },
        };
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

    /** The arguments for the worker, or null (with a warning) when one cannot be named any more. */
    private encodeArgs(what: string, args: unknown[]): RemoteArg[] | null {
        try {
            return args.map((a) => encodeRemoteArg(a, this.naming));
        } catch (err) {
            if (!(err instanceof RemoteArgError)) throw err;
            // As a reply the worker could not give: no callback (docs/sim-worker.md §4.3).
            console.warn(`sim worker: ${what} dropped: ${err.message}`);
            return null;
        }
    }

    /** `onFailed` (a promised reply, remoteHost.ts): errors reject instead of throwing / dropping with a warning. */
    private sendCommand(empire: Empire, op: string, args: unknown[], onApplied?: (r: unknown) => void, onFailed?: (err: Error) => void): void {
        let encoded: RemoteArg[] | null;
        try {
            const empireId0 = this.replica.decoder.idOf(empire);
            if (empireId0 < 0) throw new Error(`sim worker: command ${op} from an empire that is not in the replica`);
            encoded = onFailed !== undefined ? args.map((a) => encodeRemoteArg(a, this.naming)) : this.encodeArgs(`command ${op}`, args);
        } catch (err) {
            if (onFailed === undefined) throw err;
            onFailed(err instanceof Error ? err : new Error(String(err)));
            return;
        }
        if (encoded === null) return;
        const empireId = this.replica.decoder.idOf(empire);
        const id = onApplied === undefined ? 0 : this.nextCommandId++;
        const msg: CommandMessage = { type: 'command', id, empire: empireId, op, args: encoded };
        if (onApplied !== undefined) this.pending.set(id, onApplied);
        if (onFailed !== undefined) this.failing.set(id, onFailed);
        this.opts.post(msg);
    }

    /** A sim query (simQuery.ts) for the worker; `done` runs when its reply has been applied (in frame()). */
    private sendQuery(empire: Empire, op: SimQueryName, args: unknown[], done: (r: unknown) => void): void {
        const empireId = this.replica.decoder.idOf(empire);
        if (empireId < 0) throw new Error(`sim worker: query ${op} from an empire that is not in the replica`);
        const encoded = this.encodeArgs(`query ${op}`, args);
        if (encoded === null) return;
        const id = this.nextCommandId++;
        const msg: QueryMessage = { type: 'query', id, empire: empireId, op, args: encoded };
        this.pending.set(id, done);
        this.opts.post(msg);
    }

    /** Hand the worker the HUD clock's pause / speed when they changed. */
    syncClock(time: ClockControls): void {
        if (this.disposed) return;
        if (time.speed === this.sent.speed && time.paused === this.sent.paused) return;
        const pausing = time.paused && !this.sent.paused;
        this.sent = { speed: time.speed, paused: time.paused };
        const m: ClockMessage = { type: 'clock', seq: ++this.clockSeq, speed: time.speed, paused: time.paused };
        if (pausing) {
            this.holdSeq = m.seq;
            this.holdSince = this.now();
            this.stats.pauseHolds++;
        } else if (!time.paused) this.holdSeq = 0; // resumed before the ack: nothing to hold
        this.opts.post(m);
    }

    /** Whether a pause is waiting for the worker's ack (the replica is held). */
    get pauseHeld(): boolean {
        return this.holdSeq !== 0;
    }

    /**
     * [simworker chunk 1] Make every write to `time.paused` / `time.speed` post the clock at once (the HUD buttons,
     * keyboard, game menu, auto-pause, tutorials, the action menu and the console all write these fields), instead of
     * at the next frame(). The fields become accessors on this instance; dispose() turns them back into plain fields.
     */
    bindClock(time: ClockControls): void {
        this.unbindClock?.();
        let paused = time.paused;
        let speed = time.speed;
        const define = (name: 'paused' | 'speed', get: () => unknown, set: (v: never) => void): void => {
            Object.defineProperty(time, name, { configurable: true, enumerable: true, get, set });
        };
        define('paused', () => paused, (v: boolean) => {
            paused = v;
            this.syncClock(time);
        });
        define('speed', () => speed, (v: number) => {
            speed = v;
            this.syncClock(time);
        });
        this.unbindClock = () => {
            Object.defineProperty(time, 'paused', { configurable: true, enumerable: true, writable: true, value: paused });
            Object.defineProperty(time, 'speed', { configurable: true, enumerable: true, writable: true, value: speed });
            this.unbindClock = null;
        };
    }

    /** A step message arrived (applied in a later frame(), so all main-thread sync work happens inside frames). */
    receive(m: StepMessage): void {
        const at = this.now();
        this.inbox.push(m);
        this.arrivals.push(at);
        this.pacer.arrived(m.paused ? 0 : m.steps, m.stepSerial, at);
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
        // Optimistic pause: hold every step message until the one that acknowledges the pause (they are in order; the
        // ack follows the steps that were in flight), or until the hold times out (a stalled worker).
        let holding = false;
        /** Paced: the messages through a pause's ack, applied now (the drawn position must not run on through them). */
        let flush = 0;
        if (this.holdSeq !== 0) {
            const ackAt = this.inbox.findIndex((m) => m.clockSeq >= this.holdSeq);
            const acked = ackAt >= 0;
            if (acked || t0 - this.holdSince > this.pauseHoldMaxMs) {
                if (acked) this.stats.lastPauseAckMs = t0 - this.holdSince;
                let inFlight = 0;
                for (const m of this.inbox) if (m.clockSeq < this.holdSeq) inFlight += m.steps;
                this.stats.lastPauseInFlightSteps = inFlight;
                this.holdSeq = 0;
                if (acked) flush = ackAt + 1;
            } else holding = true;
        }
        const pace = this.opts.pace === true;
        let take = holding ? 0 : this.inbox.length;
        let drawn = Number.NaN;
        let forced = false;
        if (pace && flush > 0) take = flush;
        else if (pace && !holding && !this.paused) {
            // Paced: the messages up to the step the drawn position needs (a message without steps — a query reply,
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
            // A command / query reply waits at most REPLY_WAIT_MS for the drawn position: the UI must not lag behind the
            // buffer (the drawn position then skips ahead to the reply's step).
            for (let k = this.inbox.length - 1; k >= take; k--) {
                if (this.inbox[k].results.length > 0 && t0 - this.arrivals[k] >= REPLY_WAIT_MS) {
                    take = k + 1;
                    forced = true;
                    break;
                }
            }
        }
        for (let k = 0; k < take; k++) {
            const m = this.inbox[k];
            // Command replies: their onApplied reads the replica, so the cold parts through this delta (which carry
            // what the commands changed, simHost.ts touched) are applied first.
            const fresh = m.results.some((r) => r.query !== true);
            const st: ApplyStats = fresh ? this.replica.applyThrough(m.delta) : this.replica.apply(m.delta);
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
                    // Set `sent` first: with bindClock these writes would otherwise post the worker's own state back.
                    this.sent = { speed: m.speed, paused: m.paused };
                    time.paused = m.paused;
                    time.speed = m.speed;
                }
            }
            for (const r of m.results) {
                const cb = this.pending.get(r.id);
                const fail = this.failing.get(r.id);
                this.pending.delete(r.id);
                this.failing.delete(r.id);
                if (r.error !== undefined) {
                    if (fail !== undefined) fail(new Error(r.error));
                    else console.warn(`sim worker: command reply ${r.id}: ${r.error}`);
                } else if (cb !== undefined) {
                    let value: unknown;
                    try {
                        value = this.resolve(r.result);
                    } catch (err) {
                        if (fail !== undefined) fail(err instanceof Error ? err : new Error(String(err)));
                        else
                            queueMicrotask(() => {
                                throw err;
                            });
                        continue;
                    }
                    try {
                        cb(value);
                    } catch (err) {
                        queueMicrotask(() => {
                            throw err;
                        });
                    }
                }
            }
            for (const e of m.events) {
                this.opts.onEvent?.(e, (a) => this.resolve(a));
                for (const l of this.listeners) {
                    try {
                        l(e, (a) => this.resolve(a));
                    } catch (err) {
                        queueMicrotask(() => {
                            throw err;
                        });
                    }
                }
            }
        }
        const last = take > 0 ? this.inbox[take - 1] : null;
        this.inbox.splice(0, take);
        this.arrivals.splice(0, take);
        const cold = this.replica.pumpCold(this.coldBudgetMs);
        const t2 = this.now();
        // A held pause draws as paused (alpha 0) from the frame it was pressed, as the in-thread loop does.
        const pausedNow = this.paused || holding;
        // updateRenderTime adds `steps`: land on the worker's cumulative serial.
        if (last !== null) this.renderTime.stepSerial = last.stepSerial - steps;
        if (steps > 0) this.lastSteps = steps;
        if (pace) {
            // Render alpha: the drawn position's place between the last two applied steps. It may lie before the
            // earlier of the two after a frame that applied several steps: the interpolator's previous position is then
            // the linear estimate one step back on the line from where the object was, so a negative alpha follows the
            // same line further back (to −(steps − 1)). Paused (or holding a pause), the drawn position stands still
            // where the pause found it — the steps in flight and in the buffer land without moving the picture.
            const applied = this.renderTime.stepSerial + steps;
            // Holding an optimistic pause, the picture moves to the latest applied step and stays there: the steps that
            // land with the ack are then applied in one frame, whose interpolation line starts exactly there.
            if (pausedNow) drawn = this.pacer.hold(applied, t0, holding);
            else if (forced) drawn = this.pacer.catchUp(applied - this.lastSteps);
            const alpha = drawn - (applied - 1);
            updateRenderTime(this.renderTime, this.galaxy.nowMs, Math.max(0, Math.min(1, alpha)) * FRAME_REAL_MS, this.speed, false, steps);
            if (alpha < 0) {
                const a = Math.max(alpha, -Math.min(StepPacer.MAX_TARGET + StepPacer.MAX_LAG, this.lastSteps - 1));
                this.renderTime.alpha = a;
                this.renderTime.renderNowMs = this.galaxy.nowMs + a * this.renderTime.stepGameMs;
            }
        } else {
            // Render alpha: the worker's backlog after its last tick plus the real time since we applied it.
            const backlog = pausedNow ? 0 : Math.min(FRAME_REAL_MS, this.lastBacklogMs + (t0 - this.lastStepAt));
            updateRenderTime(this.renderTime, this.galaxy.nowMs, backlog, this.speed, pausedNow, steps);
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
        this.unbindClock?.();
        setRemoteCommandSink(this.galaxy, null);
        setRemoteQuerySink(this.galaxy, null);
        setRemoteSimHost(this.galaxy, null);
        this.tradeFlows.dispose();
        this.pending.clear();
        const failing = [...this.failing.values()];
        this.failing.clear();
        this.listeners.clear();
        for (const f of failing) f(new Error('sim worker: the game was closed'));
    }
}
