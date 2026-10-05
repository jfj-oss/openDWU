// Sim worker: the main-thread side of the protocol, without the Worker / DOM (docs/sim-worker.md §2, §4): the replica,
// command forwarding with onApplied replies, the clock hand-off, and render timing. workerClient.ts wraps it around a
// real Worker; the tests drive it against an in-process SimHost.
// No DOM / Pixi imports.

import type { Empire } from '../sim/empire';
import type { Galaxy } from '../sim/galaxy';
import type { GameData } from '../sim/data/gameData';
import type { Game } from '../sim/game';
import { setRemoteCommandSink } from '../sim/player/playerCommands';
import { setRemoteWaypoints, type WaypointState } from '../sim/player/waypoints';
import { FRAME_REAL_MS } from '../sim/tick/scheduler';
import { createRenderTime, updateRenderTime, type RenderTime } from '../render/renderInterp';
import { GalaxyReplica } from './replicaGalaxy';
import { ReplicaTradeFlows } from './tradeFlowSync';
import { RemoteArgError, decodeRemoteArg, encodeRemoteArg, type RemoteArg, type RemoteNaming, type RemoteResolving } from './remoteArgs';
import { BuiltObject } from '../sim/builtObject';
import { Creature } from '../sim/creature';
import { Fighter } from '../sim/combat/fighters';
import { ShipGroup } from '../sim/fleets/shipGroup';
import { Empire as EmpireClass } from '../sim/empire';
import { Habitat } from '../sim/types';
import type { ClockMessage, CommandMessage, HostOpMessage, RefreshRequest, SnapshotMessage, StepMessage, ToWorker, WorkerEvent } from './protocol';
import { setRemoteSimHost, type RemoteSimHost } from './remoteHost';
import { commandFailureMessage, commandFailureValue } from './commandFailure';
import { setRemoteRefreshSink } from './refresh';
import { markReadOnlyGalaxy } from '../sim/readOnlyQuery';
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
 * Objects that only ever exist in the game graph. One the replica no longer knows (destroyed and dropped by the sync's
 * mark, while the HUD or a list still held it) cannot be named to the worker, and must not travel by value (the worker
 * would act on a copy): the command is dropped instead.
 */
const IDENTITY_PROTOS: ReadonlySet<object> = new Set<object>([BuiltObject.prototype, Habitat.prototype, ShipGroup.prototype, Creature.prototype, Fighter.prototype, EmpireClass.prototype]);

/**
 * The command deadline (real ms after it is sent; docs/sim-worker.md §4.4 "Failed commands", the timeout policy): every
 * command carries `deadline = now + REPLY_TIMEOUT_MS` and the worker applies it only at a frame boundary that starts by
 * then — a later one rejects it (`expired`: not applied, not journaled, the callback gets the op's failure value). So the
 * worker decides, once, and the main thread delivers its verdict: a command is never reported failed and then applied
 * after all. Replies normally come with the next tick (tens of ms; a few seconds while the worker saves a late game).
 */
export const REPLY_TIMEOUT_MS = 30000;

/**
 * The backstop: a request still unanswered REPLY_TIMEOUT_MS + REPLY_GRACE_MS after it was sent means the worker is not
 * running its frames at all (hung, or a lost message): it is declared stopped (`onUnresponsive`: SimWorkerClient
 * terminates it), so it can never apply anything later, every waiting request fails, and the restart is offered.
 */
export const REPLY_GRACE_MS = 30000;

/** A request to the worker that waits for its reply in a step message's `results`. */
interface Waiting {
    kind: 'command' | 'refresh' | 'hostOp';
    op: string;
    /** Main-thread time it was posted (now()). */
    sentAt: number;
    /** The reply callback: a command's onApplied, a refresh's onFresh, a promise's resolve. */
    reply?: (r: unknown) => void;
    /** Promised replies (remoteHost.ts): a failure rejects instead. */
    reject?: (err: Error) => void;
    /** A command's arguments (a few failure values name them: commandFailure.ts). */
    args?: readonly unknown[];
    /**
     * A command's outcome, once known: its callbacks run in ISSUE order (drainCommands), as in-thread, where one
     * boundary applies the queued commands in order — so a command that fails at once (an argument gone) is not
     * answered before the commands issued ahead of it.
     */
    outcome?: { ok: true; value: unknown } | { ok: false; reason: string; threw: boolean };
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
    /**
     * Wall ms per render frame for the cold parts a command reply waits for (default 4): a reply's callback reads the
     * replica as of the boundary that applied it, so it runs once the cold parts through its delta are applied —
     * spread over frames instead of all at once (docs/sim-worker.md §4.3).
     */
    replyBudgetMs?: number;
    /** Wall ms per render frame for the cold births a hot part depends on (default 4; the message waits meanwhile). */
    depBudgetMs?: number;
    /** The command deadline (default REPLY_TIMEOUT_MS). */
    replyTimeoutMs?: number;
    /** The backstop after the deadline (default REPLY_GRACE_MS). */
    replyGraceMs?: number;
    /** Epoch wall clock for the deadlines (default `performance.timeOrigin + performance.now()`, as in the worker). */
    wallNow?: () => number;
    /**
     * The backstop fired: the worker is unresponsive. SimWorkerClient terminates it and calls workerFailed; without
     * this hook (tests) the core calls workerFailed itself.
     */
    onUnresponsive?: (reason: string) => void;
    onEvent?: (e: WorkerEvent, resolve: (a: unknown) => unknown) => void;
    /** Longest the optimistic pause holds the replica without the worker's ack (default 500 ms; then deltas apply). */
    pauseHoldMaxMs?: number;
}

export class SimClientCore {
    readonly replica: GalaxyReplica;
    readonly stats = createSyncStats();
    readonly renderTime: RenderTime = createRenderTime();
    readonly game: Game;
    /** Requests waiting for their reply, by id (commands with a callback, queries, refreshes, host ops). */
    private readonly waiting = new Map<number, Waiting>();
    /** Why the worker is gone (workerFailed), else null: requests fail at once. */
    private stopped: string | null = null;
    private warnedUnavailable = false;
    private readonly replyTimeoutMs: number;
    private readonly replyGraceMs: number;
    private readonly wallNow: () => number;
    /** Commands the worker rejected for their deadline (tests, the smoke). */
    expiredCommands = 0;
    /** Main-thread identity of the by-value objects sent in commands (remoteArgs.ts valueId). */
    private readonly valueIds = new WeakMap<object, number>();
    private nextValueId = 0;
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
    /**
     * Applied step messages whose replies and events wait for the cold parts through their delta (in order): the
     * replies' callbacks read the replica as of their boundary, and the events stay behind them (the in-thread order).
     */
    private readonly settling: { seq: number; results: StepMessage['results']; events: WorkerEvent[] }[] = [];
    /** Main-thread arrival time of each inbox message. */
    private readonly naming: RemoteNaming;
    private readonly resolving: RemoteResolving;
    private readonly now: () => number;
    private readonly coldBudgetMs: number;
    private readonly replyBudgetMs: number;
    private readonly depBudgetMs: number;
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
        this.replyBudgetMs = opts.replyBudgetMs ?? 4;
        this.depBudgetMs = opts.depBudgetMs ?? 4;
        this.pauseHoldMaxMs = opts.pauseHoldMaxMs ?? 500;
        this.replyTimeoutMs = opts.replyTimeoutMs ?? REPLY_TIMEOUT_MS;
        this.replyGraceMs = opts.replyGraceMs ?? REPLY_GRACE_MS;
        this.wallNow = opts.wallNow ?? (() => performance.timeOrigin + performance.now());
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
            // A dropped object in a ships list / selection is left out of it (remoteArgs.ts RemoteNaming.gone).
            gone: (o) => this.replica.decoder.idOf(o) < 0 && IDENTITY_PROTOS.has(Object.getPrototypeOf(o) as object),
            dropped: (path, o) => {
                const name = (o as { name?: unknown }).name;
                console.warn(`sim worker: argument ${path} (${(o as object).constructor.name}${typeof name === 'string' ? ` ${name}` : ''}) is no longer in the game: left out of the list`);
            },
            // By-value identity across commands (remoteArgs.ts RemoteValues).
            valueId: (o) => {
                let v = this.valueIds.get(o);
                if (v === undefined) {
                    v = this.nextValueId++;
                    this.valueIds.set(o, v);
                }
                return v;
            },
        };
        this.resolving = { object: (id) => this.replica.decoder.object(id), external: (kind, key) => this.replica.staticByRef.get(`${kind}:${key}`) };
        setRemoteCommandSink(galaxy, (empire, op, args, onApplied) => this.sendCommand(empire, op, args, onApplied));
        setRemoteRefreshSink(galaxy, (objects, onFresh) => this.requestRefresh(objects, onFresh));
        // The sim's lazy "obtain" lookups never write the replica, whoever queries it (sim/readOnlyQuery.ts).
        markReadOnlyGalaxy(galaxy);
        this.tradeFlows = new ReplicaTradeFlows(
            galaxy,
            () => this.replica.decoder.object(1) as Record<string, unknown> | null,
            (record) => this.opts.post({ type: 'tradeFlows', record }),
        );
        setRemoteSimHost(galaxy, this.remoteHost());
        // The player's waypoints (a side table, sim/player/waypoints.ts): read straight from the synced side-tables root,
        // which the worker freshens with each waypoint command's delta (the replica's own copy lands only with the
        // periodic side-table apply).
        setRemoteWaypoints(galaxy, () => ((this.replica.decoder.object(1) as Record<string, unknown> | null)?.waypoints as WaypointState | null | undefined) ?? null);
    }

    /** The replica's handle for the local-model paths (remoteHost.ts): commands and host ops with promised results. */
    private remoteHost(): RemoteSimHost {
        return {
            command: (empire, op, args) =>
                new Promise((resolve, reject) => this.sendCommand(empire, op, args as unknown[], resolve as (r: unknown) => void, reject)) as never,
            hostOp: (op, args) =>
                new Promise((resolve, reject) => {
                    if (this.unavailable() !== null) {
                        reject(new Error(`sim worker: host op ${op}: ${this.unavailable()}`));
                        return;
                    }
                    const encoded = (args as unknown[]).map((a) => encodeRemoteArg(a, this.naming));
                    const id = this.expect({ kind: 'hostOp', op, reply: resolve as (r: unknown) => void, reject });
                    const msg: HostOpMessage = { type: 'hostOp', id, op, args: encoded };
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
            // As a reply the worker could not give: no callback (docs/sim-worker.md §4.4).
            console.warn(`sim worker: ${what} dropped: ${err.message}`);
            return null;
        }
    }

    /** Warn about a command that could not be sent (once only while the game is closed / the worker stopped: the UI
     *  timers keep issuing). */
    private warnNotSent(op: string, reason: string): void {
        if (this.unavailable() !== null) {
            if (this.warnedUnavailable) return;
            this.warnedUnavailable = true;
        }
        console.warn(`sim worker: command ${op} not sent: ${reason}`);
    }

    /** Why requests cannot reach the worker now (closed, or the worker stopped), else null. */
    private unavailable(): string | null {
        if (this.disposed) return 'the game was closed';
        return this.stopped;
    }

    /** Register a request that waits for a reply; returns its id. */
    private expect(w: Omit<Waiting, 'sentAt'>): number {
        const id = this.nextCommandId++;
        this.waiting.set(id, { ...w, sentAt: this.now() });
        return id;
    }

    /** Requests waiting for their reply (tests, the smoke). */
    get pendingReplies(): number {
        return this.waiting.size;
    }

    /**
     * A request that will not get its reply (docs/sim-worker.md §4.4 "Failed commands"). A promised reply rejects. A
     * command's callback gets the op's failure value (commandFailure.ts: the value its executor returns when it refuses
     * the order), so the UI leaves its waiting state on its own refusal path — except when the executor threw
     * (`threw`): in-thread the boundary's exception then stops the frame (pause, "Simulation error" toast) and the
     * callback never runs, and the worker did the same. A refresh's `onFresh` does not run: an in-thread refresh never
     * calls `onFresh`.
     */
    private fail(w: Waiting, reason: string, threw = false): void {
        if (w.reject !== undefined) {
            w.reject(new Error(`sim worker: ${w.kind} ${w.op}: ${reason}`));
            return;
        }
        if (w.kind !== 'command' || threw || w.reply === undefined) return;
        this.deliverFailure(w.op, w.args ?? [], reason, w.reply);
    }

    /** Call a command's callback with its failure value (an exception in it surfaces as an in-thread one does). */
    private deliverFailure(op: string, args: readonly unknown[], reason: string, reply: (r: unknown) => void): void {
        const value = commandFailureValue(op, commandFailureMessage(reason), args);
        try {
            reply(value);
        } catch (err) {
            queueMicrotask(() => {
                throw err;
            });
        }
    }

    /**
     * Every waiting request fails with `reason` (the worker stopped, the game was closed): commands get their failure
     * value, promises reject (see fail). Each at most once; none is left behind.
     */
    private failAll(reason: string): void {
        // In issue order, each at most once (an outcome already known is delivered as it was).
        for (const [id, w] of this.waiting) {
            this.waiting.delete(id);
            this.deliver(w, w.outcome ?? { ok: false, reason, threw: false });
        }
    }

    /** Run a request's callback for `outcome` (exceptions in it surface as in-thread: rethrown in a microtask). */
    private deliver(w: Waiting, outcome: NonNullable<Waiting['outcome']>): void {
        try {
            if (!outcome.ok) this.fail(w, outcome.reason, outcome.threw);
            else w.reply?.(outcome.value);
        } catch (err) {
            queueMicrotask(() => {
                throw err;
            });
        }
    }

    /**
     * A request's outcome is known. A refresh / host op is answered now; a command when every command issued
     * before it has been answered (drainCommands).
     */
    private finish(id: number, w: Waiting, outcome: NonNullable<Waiting['outcome']>): void {
        if (w.kind !== 'command') {
            this.waiting.delete(id);
            this.deliver(w, outcome);
            return;
        }
        w.outcome = outcome;
        this.drainCommands();
    }

    /** Answer the commands whose outcome is known, in issue order, up to the first still waiting for its reply. A
     *  command an answered callback issues joins the same pass (as in-thread, the same boundary). */
    private drainCommands(): void {
        for (const [id, w] of this.waiting) {
            if (w.kind !== 'command') continue;
            if (w.outcome === undefined) return;
            this.waiting.delete(id);
            this.deliver(w, w.outcome);
        }
    }

    /**
     * The worker is gone for good (worker.ts reported a fatal error, it crashed, or a message from it was lost):
     * every waiting request fails, later ones fail at once, and the app is told (a `workerStopped` event).
     */
    workerFailed(reason: string): void {
        if (this.disposed || this.stopped !== null) return;
        this.stopped = `the simulation worker stopped (${reason})`;
        // Replies already received are answered as they came (their cold parts applied now), before the rest fail.
        while (this.settling.length > 0) {
            const seq = this.settling[0].seq;
            this.replica.pumpCold(Infinity, this.now, seq, false);
            if (!this.replica.decoder.coldThrough(seq)) break;
            this.settleApplied();
        }
        console.error(`sim worker: STOPPED — ${reason}. ${this.waiting.size} waiting request(s) fail; the game cannot continue in this session.`);
        this.failAll(this.stopped);
        const e: WorkerEvent = { kind: 'workerStopped', message: reason };
        this.emit(e);
    }

    /** Whether the worker stopped (workerFailed). */
    get workerStopped(): boolean {
        return this.stopped !== null;
    }

    private emit(e: WorkerEvent): void {
        const resolve = (a: unknown): unknown => this.resolve(a);
        try {
            this.opts.onEvent?.(e, resolve);
        } catch (err) {
            queueMicrotask(() => {
                throw err;
            });
        }
        for (const l of this.listeners) {
            try {
                l(e, resolve);
            } catch (err) {
                queueMicrotask(() => {
                    throw err;
                });
            }
        }
    }

    /**
     * Send a player command (the replica's remote command sink). Never throws and never calls back inside this call
     * (in-thread the callback runs at the next boundary): a command that cannot be sent — an argument the replica no
     * longer knows, the worker gone — fails in a microtask (see fail). `onFailed`: a promised reply (remoteHost.ts),
     * which rejects instead.
     */
    private sendCommand(empire: Empire, op: string, args: unknown[], onApplied?: (r: unknown) => void, onFailed?: (err: Error) => void): void {
        const failSoon = (reason: string): void => {
            this.warnNotSent(op, reason);
            if (onApplied === undefined && onFailed === undefined) return;
            // Answered in issue order, after the commands still in flight ahead of it, and never inside this call.
            const id = this.expect({ kind: 'command', op, reply: onApplied, reject: onFailed, args });
            this.waiting.get(id)!.outcome = { ok: false, reason, threw: false };
            queueMicrotask(() => this.drainCommands());
        };
        const gone = this.unavailable();
        if (gone !== null) {
            failSoon(gone);
            return;
        }
        let encoded: RemoteArg[];
        try {
            if (this.replica.decoder.idOf(empire) < 0) throw new RemoteArgError(`the issuing empire is not in the replica`);
            encoded = args.map((a) => encodeRemoteArg(a, this.naming));
        } catch (err) {
            // RemoteArgError: an argument left the game (destroyed, dropped by the sync) or cannot be sent; anything
            // else is a bug in the codec — logged as an error, the command still fails cleanly.
            if (!(err instanceof RemoteArgError)) console.error(`sim worker: command ${op}: encoding its arguments failed`, err);
            failSoon(err instanceof Error ? err.message : String(err));
            return;
        }
        const empireId = this.replica.decoder.idOf(empire);
        const id = onApplied === undefined && onFailed === undefined ? 0 : this.expect({ kind: 'command', op, reply: onApplied, reject: onFailed, args });
        // The deadline (the timeout policy): past it the worker rejects the command instead of applying it.
        const msg: CommandMessage = { type: 'command', id, empire: empireId, op, args: encoded, deadline: this.wallNow() + this.replyTimeoutMs };
        this.opts.post(msg);
    }

    /**
     * Ask the worker to compare `objects` (replica objects) and what they reach now (refresh.ts requestSimRefresh);
     * `onFresh` runs once the delta that carries them is applied.
     */
    requestRefresh(objects: readonly object[], onFresh?: () => void): void {
        if (this.unavailable() !== null) return;
        const ids: number[] = [];
        for (const o of objects) {
            const id = this.replica.decoder.idOf(o);
            if (id >= 0) ids.push(id);
        }
        const id = onFresh === undefined ? 0 : this.expect({ kind: 'refresh', op: 'refresh', reply: () => onFresh() });
        const m: RefreshRequest = { type: 'refresh', id, objects: ids };
        this.opts.post(m);
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
        this.inbox.push(m);
    }

    /** Main-thread time of the last render frame (frame() not draining; -Infinity before the first). */
    private lastRenderFrameAt = -Infinity;

    /**
     * Whether the render frames have stopped (none for `ms`): a hidden or minimised window runs no requestAnimationFrame,
     * but the worker keeps stepping (the game runs on unfocused, as the original does) — its messages must then be
     * applied as they arrive (SimWorkerClient: frame(time, drain)), or they pile up in the inbox, each with its delta,
     * until the window comes back: an alt-tabbed late game filled the heap and the sim worker died of it.
     */
    renderFramesStalled(ms: number): boolean {
        return this.now() - this.lastRenderFrameAt > ms;
    }

    /** Step messages received and not applied yet (tests, the smoke). */
    get inboxLength(): number {
        return this.inbox.length;
    }

    /**
     * Once per render frame: apply the step messages received since the last frame (hot parts at once), pump the cold
     * queue for its budget (and, under replyBudgetMs, the cold parts the waiting command replies need), answer the
     * replies whose cold parts are all applied, adopt the worker's pause / speed when our last clock change has reached
     * it, and refresh renderTime. Returns the sim steps that landed. `drain`: not a render frame — the frames have
     * stopped (a hidden window) and a message arrived: the same, with every cold part pumped (nothing to keep smooth).
     */
    frame(time: ClockControls, drain = false): number {
        const t0 = this.now();
        if (!drain) this.lastRenderFrameAt = t0;
        this.syncClock(time);
        let steps = 0;
        let hotMs = 0;
        // Optimistic pause: hold every step message until the one that acknowledges the pause (they are in order; the
        // ack follows the steps that were in flight), or until the hold times out (a stalled worker).
        let holding = false;
        if (this.holdSeq !== 0) {
            const acked = this.inbox.some((m) => m.clockSeq >= this.holdSeq);
            if (acked || t0 - this.holdSince > this.pauseHoldMaxMs) {
                if (acked) this.stats.lastPauseAckMs = t0 - this.holdSince;
                let inFlight = 0;
                for (const m of this.inbox) if (m.clockSeq < this.holdSeq) inFlight += m.steps;
                this.stats.lastPauseInFlightSteps = inFlight;
                this.holdSeq = 0;
            } else holding = true;
        }
        // Every message received is applied now, its hot part at once (smoothing the drawn time over uneven arrivals is
        // the render side's job: renderInterp.ts PresentationClock, in MainView) — except when its hot part names objects
        // born in cold parts not applied yet: their births are applied first, under depBudgetMs per frame, and the
        // message (with those after it) waits for the next frame meanwhile.
        const take = holding ? 0 : this.inbox.length;
        let applied = 0;
        for (let k = 0; k < take; k++) {
            const m = this.inbox[k];
            const st: ApplyStats = this.replica.apply(m.delta, false, this.depBudgetMs, this.now);
            hotMs += st.applyMs;
            if (st.pending) break;
            applied++;
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
            // Replies (their onApplied reads the replica as of the boundary that applied the commands, so the cold parts
            // through this delta — which carry what the commands changed, simHost.ts touched — come first) and events,
            // in order.
            if (m.results.length > 0 || m.events.length > 0) this.settling.push({ seq: m.delta.seq, results: m.results, events: m.events });
        }
        const last = applied > 0 ? this.inbox[applied - 1] : null;
        this.inbox.splice(0, applied);
        // Events (and replies whose cold parts are in) now, as their message lands; then the cold parts the waiting
        // replies need, under their own budget, then the regular pump. A waiting entry bounds the pumps: a message's
        // events are delivered before its own cold part applies (its drops among them), a reply after it.
        this.settleApplied();
        let coldMs = 0;
        const replyDeadline = this.now() + this.replyBudgetMs;
        while (this.settling.length > 0) {
            const seq = this.settling[0].seq;
            const left = replyDeadline - this.now();
            if (left <= 0) break;
            coldMs += this.replica.pumpCold(left, this.now, seq, false).applyMs;
            if (!this.replica.decoder.coldThrough(seq)) break;
            this.settleApplied();
        }
        coldMs += this.replica.pumpCold(drain ? Infinity : this.coldBudgetMs, this.now, this.settling.length > 0 ? this.settling[0].seq : Infinity).applyMs;
        this.settleApplied();
        if (this.waiting.size > 0) this.checkReplyTimeouts(t0);
        const t2 = this.now();
        // A held pause is drawn as paused from the frame it was pressed, as the in-thread loop does (the presentation
        // clock stands still from that frame; the steps in flight then land without moving the picture).
        const pausedNow = this.paused || holding;
        // updateRenderTime adds `steps`: land on the worker's cumulative serial.
        if (last !== null) this.renderTime.stepSerial = last.stepSerial - steps;
        // Render alpha: the worker's backlog after its last tick plus the real time since we applied it (raw: MainView's
        // presentation clock evens it out).
        const backlog = pausedNow ? 0 : Math.min(FRAME_REAL_MS, this.lastBacklogMs + (t0 - this.lastStepAt));
        updateRenderTime(this.renderTime, this.galaxy.nowMs, backlog, this.speed, pausedNow, steps);
        const s = this.stats;
        s.renderFrames++;
        s.simFrames += steps;
        s.hotApplyMs += hotMs;
        s.coldPumpMs += coldMs;
        if (hotMs > s.maxHotApplyMs) s.maxHotApplyMs = hotMs;
        if (coldMs > s.maxColdPumpMs) s.maxColdPumpMs = coldMs;
        const dt = t2 - t0;
        s.simWallMs += dt;
        s.avgSyncMsPerRenderFrame += (dt - s.avgSyncMsPerRenderFrame) * 0.05;
        s.avgSimMsPerRenderFrame = s.avgSyncMsPerRenderFrame;
        if (dt > s.maxSimMsPerRenderFrame) s.maxSimMsPerRenderFrame = dt;
        s.coldBacklog = this.replica.decoder.coldBacklog;
        return steps;
    }

    /** Deliver the replies and events of the applied messages whose cold parts are all applied (in order). */
    private settleApplied(): void {
        while (this.settling.length > 0) {
            const e = this.settling[0];
            if (e.results.length > 0 && !this.replica.decoder.coldThrough(e.seq)) return;
            this.settling.shift();
            for (const r of e.results) this.settle(r);
            for (const ev of e.events) this.emit(ev);
        }
    }

    /** Messages applied whose replies / events wait for cold parts (tests, the smoke). */
    get settlingMessages(): number {
        return this.settling.length;
    }

    /** A reply from a step message (its delta applied): the waiting request's callback, once. */
    private settle(r: StepMessage['results'][number]): void {
        const w = this.waiting.get(r.id);
        if (w === undefined) {
            // Answered already (the worker stopped or the game was closed meanwhile: failed then).
            if (this.unavailable() === null) console.warn(`sim worker: reply ${r.id} for no waiting request; dropped`);
            return;
        }
        if (w.outcome !== undefined) return; // failed already, waiting for its turn
        if (r.error !== undefined) {
            if (r.expired === true) {
                // The worker's verdict on a command that reached it after its deadline: never applied (the timeout policy).
                this.expiredCommands++;
                console.warn(`sim worker: ${w.kind} ${w.op} (request ${r.id}) was not applied: ${r.error}`);
            } else if (r.threw === true) console.error(`sim worker: ${w.kind} ${w.op}: ${r.error}`);
            else console.warn(`sim worker: ${w.kind} ${w.op} failed: ${r.error}`);
            this.finish(r.id, w, { ok: false, reason: r.error, threw: r.threw === true });
            return;
        }
        let value: unknown;
        try {
            value = this.resolve(r.result);
        } catch (err) {
            const why = `its reply could not be resolved on the replica (${err instanceof Error ? err.message : String(err)})`;
            console.error(`sim worker: ${w.kind} ${w.op}: ${why}`);
            this.finish(r.id, w, { ok: false, reason: why, threw: false });
            return;
        }
        // An exception in the callback (deliver) must not stop the other replies, as in-thread (applyLive).
        this.finish(r.id, w, { ok: true, value });
    }

    /**
     * The backstop: a request older than the deadline plus the grace with no reply in the inbox means the worker runs no
     * frames (the worker answers every command by its first boundary after the deadline: applied or expired). The
     * worker is declared unresponsive — terminated by onUnresponsive, so it cannot apply anything later — and every
     * waiting request fails (workerFailed), loudly.
     */
    private checkReplyTimeouts(nowMs: number): void {
        let inInbox: Set<number> | null = null;
        let late: { id: number; w: Waiting } | null = null;
        for (const [id, w] of this.waiting) {
            if (w.outcome !== undefined || nowMs - w.sentAt < this.replyTimeoutMs + this.replyGraceMs) continue;
            // (A reply received and waiting for its cold parts, settling, is not late.)
            inInbox ??= new Set([...this.inbox, ...this.settling].flatMap((m) => m.results.map((r) => r.id)));
            if (!inInbox.has(id)) {
                late = { id, w };
                break;
            }
        }
        if (late === null) return;
        const s = Math.round((nowMs - late.w.sentAt) / 1000);
        const reason = `no reply from the simulation worker after ${s} s (${late.w.kind} ${late.w.op}, request ${late.id}): it is not running`;
        console.error(`sim worker: ${reason} — stopping it (a hung worker or a lost message is a bug: please report it)`);
        if (this.opts.onUnresponsive !== undefined) this.opts.onUnresponsive(reason);
        else this.workerFailed(reason);
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        // A game closed (main menu, new game, load) with orders in flight: their callbacks get the failure value now,
        // promises reject — nothing is left waiting on a game that is gone.
        if (this.waiting.size > 0) console.warn(`sim worker: the game was closed with ${this.waiting.size} request(s) waiting for the worker; they fail`);
        // In a microtask: after the teardown that called dispose() (main.ts closes the screens first), not inside it.
        queueMicrotask(() => this.failAll('the game was closed'));
        this.unbindClock?.();
        // The command sink stays: a command issued on this closed replica (a screen of the old game still open) fails
        // cleanly through sendCommand instead of waiting in a local queue nothing drains.
        setRemoteSimHost(this.galaxy, null);
        setRemoteRefreshSink(this.galaxy, null);
        markReadOnlyGalaxy(this.galaxy, false);
        this.tradeFlows.dispose();
        this.listeners.clear();
    }
}
