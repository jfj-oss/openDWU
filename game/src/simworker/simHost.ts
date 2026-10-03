// Sim worker: the worker-side host of the authoritative game (docs/sim-worker.md §2, §4, §5). DOM-free and
// transport-free — worker.ts feeds it messages and a timer, the tests drive it in-process — so the step loop, the
// command path and the sync channel are the same code under test and in the browser.
//
// The step loop is the in-thread one (simLoop.ts createSimLoop) without the view: per tick, drain the command boundary,
// journal the speed, then SimFrameBudget.run(SimDriver, realDtMs, speed, paused) — the same fixed steps of
// FRAME_REAL_MS, the same wall-clock budget, the same pause probe and error containment — then one replica diff.
// So a game run here takes exactly the frames, commands and boundaries it would in-thread, and its state digest is
// the same (test/simWorker.test.ts).

import type { Game } from '../sim/game';
import type { Galaxy } from '../sim/galaxy';
import { Empire as EmpireClass, type Empire } from '../sim/empire';
import { GalaxyTime } from '../sim/galaxyTime';
import type { StartGameOptions } from '../sim/startGameOptions';
import { SimDriver, schedulerState } from '../sim/tick/scheduler';
import { drainCommandBoundary } from '../sim/tick/commandBoundary';
import { issuePlayerCommand, noteSimSpeed, noteSimView } from '../sim/player/playerCommands';
import type { PlayerOpName } from '../sim/player/playerOps';
import { serializeGame } from '../sim/save/gameSave';
import { galaxyExternals, saveClassPrototypes } from '../sim/save/galaxySave';
import { stateDigest } from '../sim/tick/digest';
import { setGameEndHandler, doGameEnd } from '../sim/victory';
import { reviewAchievements } from '../sim/achievements';
import { registerLocationPingedHook } from '../sim/story/eventActions';
import { SimFrameBudget } from '../simFrameBudget';
import { GalaxySyncSource } from './replicaGalaxy';
import { TRADE_FLOWS_SIDE_KEY, TradeFlowSyncSource } from './tradeFlowSync';
import { installRimAtmosphereData } from '../render/rimAtmosphereWiring';
import { RemoteValues, decodeRemoteArg, encodeRemoteArg, type RemoteArg, type RemoteNaming } from './remoteArgs';
import { runSimQuery, type SimQueryName } from './simQuery';
import { runHostOp } from './hostOps';
import { drainVoiceCues } from '../sim/scenario/llm/voiceCues';
import { PlayerMessagePipeline, applyPlayerMessageUiOp, attachPlayerRecipients, restorePlayerRecipients, withRecipientsAsSaved, type PlayerMessageBatch } from '../ui/messagePipeline';
import type { ClockMessage, CommandMessage, DebugReply, DebugRequest, FromWorker, HostOpMessage, QueryMessage, RefreshRequest, SnapshotMessage, StepMessage, TradeFlowsMessage, UiOpMessage, WorkerEvent } from './protocol';
import { commandLog, copyCommandLogEntry, type CommandLogEntry } from '../sim/player/commandLog';
import type { ReplicaEncoderOptions } from './replicaSync';

export interface SimHostOptions {
    /** Wall clock (performance.now in the worker; a fake one in tests). */
    now?: () => number;
    sync?: Partial<Pick<ReplicaEncoderOptions, 'coldBudgetMs' | 'coldMaxSets' | 'markBudgetMs'>>;
    /**
     * Run the player's message pipeline here (ui/messagePipeline.ts, docs/sim-worker.md §9 chunk 4): the worker is the
     * player's message / event recipient and does the UI's sim writes (star dates, history, advisor queue, defeat game
     * end, event messages) after each tick, as the in-thread UI timers do; the main thread gets 'playerMessages'
     * events. The browser worker turns it on (the in-thread app always has these UI timers); headless runs leave it off.
     */
    playerMessages?: boolean;
}

/**
 * Sim state the in-thread app writes from the view's set-up (MainView.init), before the first tick: in worker mode it is
 * written here, on the authoritative galaxy, after create / load and before the SimHost (and its snapshot) exists.
 * - 19i rim atmosphere (scenario flag `rimAtmosphere`): the per-system rim weights and rim name overrides that sim
 *   message code reads (render/rimAtmosphereWiring.ts installRimAtmosphereData; idempotent, a no-op off the flag).
 */
export function installWorkerBootState(galaxy: Galaxy): void {
    installRimAtmosphereData(galaxy);
}

export class SimHost {
    readonly galaxy: Galaxy;
    readonly time: GalaxyTime;
    readonly driver: SimDriver;
    readonly budget: SimFrameBudget;
    readonly sync: GalaxySyncSource;
    /** Trade-flow recording and its ledger's side-table view (tradeFlowSync.ts). */
    readonly tradeFlows: TradeFlowSyncSource;
    private stepSerial = 0;
    /** Steps run outside tick() (the `__dwu.sim.advance` debug call), reported with the next step message. */
    private extraSteps = 0;
    private clockSeq = 0;
    /** By-value command arguments decoded recently, by main-thread value id (remoteArgs.ts RemoteValues). */
    private readonly commandValues = new RemoteValues();
    private results: StepMessage['results'] = [];
    private events: WorkerEvent[] = [];
    private readonly naming: RemoteNaming;
    private readonly externalsByRef: Map<string, object>;
    private readonly now: () => number;
    /** Something changed outside a step (a command, the clock): send a delta even if no step ran. */
    private dirty = true;
    private settleUntilCycle = 0;
    /**
     * Objects to compare before this tick's delta (compareNow): what the commands applied at this tick's boundary
     * touched (arguments, results, the issuing empire) and what refresh requests named — so their changes reach the
     * replica with the command's reply instead of a cold cycle later.
     */
    private freshRoots: object[] = [];
    /** Graph objects the commands since the last tick named or returned, with how deep to compare them (encoder
     *  compareNow) in that tick's delta: the issuing empire 1 (its lists), arguments and results 2 (a colony's
     *  construction queue and its wait list, a ship's mission and queued missions). */
    private readonly touched = new Map<object, number>();
    private readonly graphProtos = new Set<object>(Object.values(saveClassPrototypes()));
    /** The player's message pipeline (opts.playerMessages), else null. */
    readonly pipeline: PlayerMessagePipeline | null = null;

    constructor(readonly game: Game, time: GalaxyTime, private readonly startOptions: StartGameOptions, opts: SimHostOptions = {}) {
        this.galaxy = game.galaxy;
        this.now = opts.now ?? (() => performance.now());
        // The clock is a view over galaxy.nowMs, as in-thread (simLoop.ts createSimLoop).
        this.time = time;
        time.bindGalaxy(this.galaxy);
        this.driver = new SimDriver(this.galaxy, time.speed, time.paused);
        this.budget = new SimFrameBudget(this.now);
        const ext = galaxyExternals(this.galaxy);
        this.externalsByRef = ext.byRef;
        // Before the sync first looks at the empire: the recipients are hidden fields, so the replica never has them.
        const player = this.galaxy.playerEmpire;
        if (opts.playerMessages === true && player !== null) {
            this.pipeline = new PlayerMessagePipeline(this.galaxy, player);
            attachPlayerRecipients(player, this.pipeline);
        }
        this.sync = new GalaxySyncSource(this.galaxy, opts.sync ?? {});
        this.tradeFlows = new TradeFlowSyncSource(this.galaxy, (view) => this.sync.setSideTable(TRADE_FLOWS_SIDE_KEY, view));
        // Replies and events name graph objects by sync id (a new one is born in the delta that carries the reply);
        // anything else (a ShipActionResult, menu items, a ShipAction) travels by value, as command arguments do.
        this.naming = {
            syncId: (o) => {
                const enc = this.sync.encoder;
                if (enc.knownId(o) >= 0) return enc.ensureId(o);
                const proto = Object.getPrototypeOf(o) as object | null;
                return proto !== null && this.graphProtos.has(proto) ? enc.ensureId(o) : -1;
            },
            external: (o) => ext.byObject.get(o),
        };
        // Sim → UI hooks that change sim state run here, on the authoritative game; the main thread gets an event.
        // Main.Part12.cs DoGameEnd (ui/screens/empireComparison.ts installGameEndHandler): pause, end the game, review
        // achievements — the banner is the main thread's.
        setGameEndHandler(this.galaxy, (e) => {
            this.time.paused = true;
            doGameEnd(this.galaxy, e);
            reviewAchievements(this.galaxy);
            this.events.push({ kind: 'gameEnd', args: { victor: this.encodeOrNull(e.victorEmpire), outcome: e.outcomeForPlayer, description: e.description, code: e.code } });
            this.dirty = true;
        });
        registerLocationPingedHook((target) => {
            this.events.push({ kind: 'locationPinged', target: encodeRemoteArg(target, this.naming) });
        });
    }

    /** The first sync message: the whole replica. */
    snapshot(): SnapshotMessage {
        return {
            type: 'snapshot',
            delta: this.sync.snapshot(),
            baseTechCost: this.galaxy.baseTechCost,
            viewX: this.game.viewX,
            viewY: this.game.viewY,
            clock: { speed: this.time.speed, paused: this.time.paused },
            stepSerial: this.stepSerial,
            startOptions: this.startOptions,
        };
    }

    clock(m: ClockMessage): void {
        this.time.speed = m.speed;
        this.time.paused = m.paused;
        this.clockSeq = m.seq;
        this.dirty = true;
    }

    /** The main thread switched trade-flow recording (the freight overlay / Trade Flows panel). */
    setTradeFlowRecording(m: TradeFlowsMessage): void {
        this.tradeFlows.setRecording(m.record);
        this.dirty = true;
    }

    /** Queue a player command on the authoritative galaxy (applied at the next boundary, journaled as in-thread). */
    command(m: CommandMessage): void {
        const resolving = {
            object: (id: number) => this.sync.encoder.objectOf(id),
            external: (kind: string, key: string | number) => this.externalsByRef.get(`${kind}:${key}`),
            values: this.commandValues,
        };
        try {
            const empire = resolving.object(m.empire) as Empire | null;
            if (empire === null) throw new Error(`command ${m.op}: issuing empire (sync id ${m.empire}) is not in the game`);
            const args = m.args.map((a) => decodeRemoteArg(a, resolving));
            this.touched.set(empire, Math.max(1, this.touched.get(empire) ?? 0));
            for (const a of args) this.touch(a, 2);
            // And, bounded, what they reach (screens refresh from the reply: a new fleet template's list, a colony's
            // queues): compareReach.
            for (const a of args) this.noteFresh(a);
            this.noteFresh(empire);
            issuePlayerCommand(this.galaxy, empire, m.op as PlayerOpName, args as never, m.id === 0 ? undefined : (result: unknown) => {
                this.touch(result, 2);
                this.noteFresh(result);
                let encoded: RemoteArg = null;
                let error: string | undefined;
                try {
                    encoded = encodeRemoteArg(result, this.naming);
                } catch (err) {
                    error = `result not sendable: ${err instanceof Error ? err.message : String(err)}`;
                }
                this.results.push(error === undefined ? { id: m.id, result: encoded } : { id: m.id, result: null, error });
            });
        } catch (err) {
            if (m.id !== 0) this.results.push({ id: m.id, result: null, error: err instanceof Error ? err.message : String(err) });
            else console.error('sim worker: command failed', err);
        }
        this.dirty = true;
    }

    /** Compare these replica objects (sync ids) and what they reach before the next delta; reply to `m.id` with it. */
    refresh(m: RefreshRequest): void {
        for (const id of m.objects) {
            const o = this.sync.encoder.objectOf(id);
            if (o !== null) this.freshRoots.push(o);
        }
        if (m.id !== 0) this.results.push({ id: m.id, result: null });
        this.dirty = true;
    }

    /** Note an object (or the objects of an argument / result array or plain object, one level) for compareNow. */
    private noteFresh(v: unknown): void {
        if (v === null || typeof v !== 'object') return;
        if (this.sync.encoder.knownId(v) >= 0) {
            this.freshRoots.push(v);
            return;
        }
        const items = Array.isArray(v) ? v : Object.getPrototypeOf(v) === Object.prototype ? Object.values(v as Record<string, unknown>) : [];
        for (const x of items) if (x !== null && typeof x === 'object' && this.sync.encoder.knownId(x) >= 0) this.freshRoots.push(x);
    }

    /**
     * Run a read-only sim query (simQuery.ts) on the authoritative galaxy now, between ticks — where in-thread play
     * runs it, between frames, in order with the commands (its galaxy.rnd draws land in the same place). The reply
     * goes out with the next message (flush() sends one at once).
     */
    query(m: QueryMessage): void {
        const resolving = {
            object: (id: number) => this.sync.encoder.objectOf(id),
            external: (kind: string, key: string | number) => this.externalsByRef.get(`${kind}:${key}`),
        };
        try {
            const empire = resolving.object(m.empire) as Empire | null;
            if (empire === null) throw new Error(`query ${m.op}: asking empire (sync id ${m.empire}) is not in the game`);
            const args = m.args.map((a) => decodeRemoteArg(a, resolving));
            const result = runSimQuery(this.galaxy, empire, m.op as SimQueryName, args as never);
            this.results.push({ id: m.id, result: encodeRemoteArg(result, this.naming), query: true });
        } catch (err) {
            this.results.push({ id: m.id, result: null, error: err instanceof Error ? err.message : String(err), query: true });
        }
        this.dirty = true;
    }

    /**
     * A UI-side sim write from the main thread (ui/messagePipeline.ts applyPlayerMessageUiOp): applied now, between
     * ticks, and not journaled — the in-thread UI writes these directly from its timers and handlers.
     */
    uiOp(m: UiOpMessage): void {
        const resolving = {
            object: (id: number) => this.sync.encoder.objectOf(id),
            external: (kind: string, key: string | number) => this.externalsByRef.get(`${kind}:${key}`),
        };
        try {
            const args = m.args.map((a) => decodeRemoteArg(a, resolving));
            for (const a of args) this.touch(a, 2);
            if (!applyPlayerMessageUiOp(this.pipeline, m.op, args)) console.warn(`sim worker: unknown UI op ${m.op}`);
        } catch (err) {
            console.error(`sim worker: UI op ${m.op} failed`, err);
        }
        this.dirty = true;
    }

    /** encodeRemoteArg, or null when the value cannot cross (an unregistered class): an event field, not a command. */
    private encodeOrNull(v: unknown): RemoteArg {
        try {
            return encodeRemoteArg(v, this.naming);
        } catch (err) {
            console.warn('sim worker: event value not sendable', err);
            return null;
        }
    }

    /** The player's message pipeline after a tick: its sim writes, then one event for the main thread. */
    private pumpPlayerMessages(): void {
        const pipeline = this.pipeline;
        if (pipeline === null) return;
        let batch: PlayerMessageBatch | null = null;
        try {
            batch = pipeline.pump();
        } catch (err) {
            // As an exception in an in-thread UI timer: logged, the game goes on.
            console.error('sim worker: player message pipeline failed', err);
        }
        if (batch === null) return;
        // Encoded after every write of the pump, so a new message is born on the main thread with its final contents.
        this.events.push({
            kind: 'playerMessages',
            receipts: batch.receipts.map((r) => ({
                m: this.encodeOrNull(r.message),
                ticker: r.ticker,
                popupPass: r.popupPass,
                advisor: r.advisor,
                route: r.route === null ? null : { ...r.route },
                action: r.action,
            })),
            events: batch.events.map((e) => ({
                type: e.type,
                title: String(e.title ?? ''),
                message: String(e.message ?? ''),
                data: this.encodeOrNull(e.additionalData),
                location: this.encodeOrNull(e.location),
            })),
        });
    }

    /**
     * Run a host op (hostOps.ts) on the authoritative galaxy now — between two ticks, where its in-thread caller runs
     * it (a promise continuation between frames). The result goes back in the next step message; what the op's
     * arguments and result name is compared in that delta, as for a command.
     */
    hostOp(m: HostOpMessage): void {
        const resolving = {
            object: (id: number) => this.sync.encoder.objectOf(id),
            external: (kind: string, key: string | number) => this.externalsByRef.get(`${kind}:${key}`),
        };
        try {
            const args = m.args.map((a) => decodeRemoteArg(a, resolving));
            for (const a of args) this.touch(a, 2);
            const result = runHostOp(this.galaxy, m.op, args);
            this.touch(result, 2);
            if (m.id !== 0) {
                try {
                    this.results.push({ id: m.id, result: encodeRemoteArg(result, this.naming) });
                } catch (err) {
                    this.results.push({ id: m.id, result: null, error: `result not sendable: ${err instanceof Error ? err.message : String(err)}` });
                }
            }
        } catch (err) {
            if (m.id !== 0) this.results.push({ id: m.id, result: null, error: err instanceof Error ? err.message : String(err) });
            else console.error(`sim worker: host op ${m.op} failed`, err);
        }
        this.dirty = true;
    }

    /**
     * 19s-2 voices: the cues the sim left during this tick (a module WeakMap of the worker's galaxy, never state) go to
     * the main thread's voice job as an event, as llm/voiceJob.ts poll drained them in-thread. Drained every tick, voices
     * on or not (in-thread the job drains them too; off, noteVoiceCue records nothing).
     */
    private drainVoiceCues(): void {
        const cues = drainVoiceCues(this.galaxy);
        if (cues.length === 0) return;
        const encoded: RemoteArg[] = [];
        for (const cue of cues) {
            try {
                encoded.push(encodeRemoteArg(cue, this.naming));
            } catch (err) {
                // Voices are best-effort (MAX_PENDING drops the oldest in-thread too).
                console.warn('sim worker: voice cue not sendable', err);
            }
        }
        if (encoded.length > 0) this.events.push({ kind: 'voiceCues', cues: encoded });
    }

    /** Collect the graph objects in a command argument / result (through arrays, plain objects, by-value classes). */
    private touch(v: unknown, depth: number): void {
        if (v === null || typeof v !== 'object') return;
        const proto = Object.getPrototypeOf(v) as object | null;
        if (proto !== null && this.graphProtos.has(proto)) {
            // An empire named as an argument stays at its lists (depth 2 would compare every ship of it).
            if (v !== this.galaxy) this.touched.set(v, v instanceof EmpireClass ? 1 : 2);
            return;
        }
        if (depth <= 0) return;
        if (Array.isArray(v)) for (const x of v) this.touch(x, depth - 1);
        else for (const k of Object.keys(v)) this.touch((v as Record<string, unknown>)[k], depth - 1);
    }

    /**
     * One worker tick with `realDtMs` of real time since the last: the in-thread frame driver (simLoop.ts tick) minus
     * the view, then the replica diff. Returns the step message, or null when nothing changed (paused, idle).
     */
    tick(realDtMs: number, forceDelta = false): StepMessage | null {
        const t0 = this.now();
        let steps = 0;
        const driver = this.driver;
        const time = this.time;
        driver.speed = time.speed;
        driver.paused = time.paused;
        driver.isPaused = () => time.paused;
        try {
            drainCommandBoundary(this.galaxy);
            // The queued commands have been applied with their by-value arguments.
            this.commandValues.boundary();
            if (!time.paused) {
                noteSimSpeed(this.galaxy, time.speed);
                noteSimView(this.galaxy, false);
            }
            steps = this.budget.run(driver, realDtMs, time.speed, time.paused);
        } catch (err) {
            // As in-thread: drop the half-drained tick queue, pause, and tell the player.
            console.error('Simulation error (paused):', err);
            schedulerState(this.galaxy).queue.length = 0;
            this.budget.backlogMs = 0;
            time.paused = true;
            this.events.push({ kind: 'simError', message: err instanceof Error ? err.message : String(err) });
            this.dirty = true;
        }
        this.drainVoiceCues();
        // Between frames, as the in-thread UI timers run: the player's message pipeline.
        this.pumpPlayerMessages();
        steps += this.extraSteps;
        this.extraSteps = 0;
        this.stepSerial += steps;
        const t1 = this.now();
        // After the last change (a step, a command, the clock), keep diffing until a whole cold cycle has passed, so a
        // paused game's replica becomes exact (every cold object compared since); then go quiet.
        const changed = steps > 0 || this.dirty || this.results.length > 0 || this.events.length > 0;
        if (changed) this.settleUntilCycle = this.sync.encoder.cycleCount + 2;
        if (!changed && !forceDelta && this.sync.encoder.cycleCount >= this.settleUntilCycle) return null;
        this.dirty = false;
        if (this.freshRoots.length > 0) {
            this.sync.encoder.compareReach(this.freshRoots);
            this.freshRoots = [];
        }
        // What this tick's commands touched is compared now, so its effect travels in this delta, ahead of the
        // command replies (the main thread runs onApplied with the replica as of this boundary or later).
        this.tradeFlows.refresh();
        for (const [o, depth] of this.touched) this.sync.encoder.compareNow(o, depth);
        this.touched.clear();
        return this.message(steps, t1 - t0);
    }

    /**
     * A message now, without draining the boundary or stepping (a query's reply: the main thread need not wait for the
     * next tick). Read-only, like every delta.
     */
    flush(): StepMessage {
        this.settleUntilCycle = this.sync.encoder.cycleCount + 2;
        this.dirty = false;
        return this.message(0, 0);
    }

    private message(steps: number, stepMs: number): StepMessage {
        const delta = this.sync.delta();
        const msg: StepMessage = {
            type: 'step',
            delta,
            stepSerial: this.stepSerial,
            steps,
            nowMs: this.galaxy.nowMs,
            backlogMs: this.budget.backlogMs,
            speed: this.time.speed,
            paused: this.time.paused,
            clockSeq: this.clockSeq,
            stepMs,
            diffMs: delta.stats.diffMs,
            results: this.results,
            events: this.events,
        };
        this.results = [];
        this.events = [];
        return msg;
    }

    /** serializeGame of the authoritative game (between ticks: queued commands apply first, as in-thread). */
    save(): string {
        const player = this.galaxy.playerEmpire;
        const save = (): string => serializeGame(this.game, this.time, this.startOptions);
        return this.pipeline !== null && player !== null ? withRecipientsAsSaved(player, save) : save();
    }

    digest(): string {
        return stateDigest(this.galaxy);
    }

    /** [simworker chunk 1] The authoritative command log (`__dwu.commands.log()`), as a copy (plain data). */
    commandLog(): CommandLogEntry[] {
        return commandLog(this.galaxy).map(copyCommandLogEntry);
    }

    /**
     * [simworker chunk 1] `__dwu.sim` / `__dwu.simBudget` in worker mode: read, write or call a member of the worker's
     * SimDriver / SimFrameBudget, as the console does in-thread. Steps a call runs (`advance`) count as steps of the
     * next step message, so the replica's render serial follows. The reply carries the target's plain fields.
     */
    debug(m: DebugRequest): DebugReply {
        const target = (m.target === 'sim' ? this.driver : this.budget) as unknown as Record<string, unknown>;
        let value: unknown;
        let error: string | undefined;
        try {
            if (m.op === 'get') value = m.name === undefined ? undefined : target[m.name];
            else if (m.op === 'set') {
                if (m.name === undefined) throw new Error('set: no member name');
                target[m.name] = m.value;
            } else {
                const fn = m.name === undefined ? undefined : target[m.name];
                if (typeof fn !== 'function') throw new Error(`${m.target}.${String(m.name)} is not a function`);
                value = (fn as (...a: unknown[]) => unknown).apply(target, m.args ?? []);
                if (m.target === 'sim' && m.name === 'advance' && typeof value === 'number') this.extraSteps += value;
            }
        } catch (err) {
            error = err instanceof Error ? err.message : String(err);
        }
        this.dirty = true;
        const state: DebugReply['state'] = {};
        for (const k of Object.keys(target)) {
            const v = target[k];
            if (v === null || typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') state[k] = v;
        }
        return { type: 'debug', id: m.id, value: plainValue(value), state, ...(error === undefined ? {} : { error }) };
    }

    get serial(): number {
        return this.stepSerial;
    }

    dispose(): void {
        if (this.pipeline !== null) restorePlayerRecipients(this.pipeline.player);
        this.tradeFlows.dispose();
        setGameEndHandler(this.galaxy, null);
        registerLocationPingedHook(null);
    }
}

/** A value that survives postMessage (functions and class instances become plain data or a string). */
function plainValue(v: unknown): unknown {
    if (v === undefined || v === null || typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return v;
    if (typeof v === 'function') return `[function ${v.name}]`;
    try {
        return JSON.parse(JSON.stringify(v)) as unknown;
    } catch {
        return String(v);
    }
}

/** A FromWorker message's transferable buffers. */
export type { FromWorker };
