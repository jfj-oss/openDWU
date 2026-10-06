// Sim worker: the worker-side host of the authoritative game (docs/sim-worker.md §2, §4, §5). DOM-free and
// transport-free — worker.ts feeds it messages and a timer, the tests drive it in-process — so the step loop, the
// command path and the sync channel are the same code under test and in the browser.
//
// The step loop is the in-thread one (simLoop.ts createSimLoop): per tick, drain the command boundary, journal the
// speed and the camera the main thread last sent (ViewMessage; none: no LOD pass), then SimFrameBudget.run(SimDriver, realDtMs, speed, paused) — the same fixed steps of
// FRAME_REAL_MS, the same wall-clock budget, the same pause probe and error containment — then one replica diff.
// So a game run here takes exactly the frames, commands and boundaries it would in-thread, and its state digest is
// the same (test/simWorker.test.ts).

import type { Game } from '../sim/game';
import type { Galaxy } from '../sim/galaxy';
import { Empire as EmpireClass, type Empire } from '../sim/empire';
import { GalaxyTime } from '../sim/galaxyTime';
import type { StartGameOptions } from '../sim/startGameOptions';
import { SimDriver, schedulerState, type SimView } from '../sim/tick/scheduler';
import { drainCommandBoundary } from '../sim/tick/commandBoundary';
import { issuePlayerCommand, loggedSimViewRect, noteSimSpeed, noteSimViewRect, pendingPlayerCommands } from '../sim/player/playerCommands';
import type { PlayerOpName } from '../sim/player/playerOps';
import { serializeGame } from '../sim/save/gameSave';
import { serializeGameBlob } from '../saveData';
import { galaxyExternals, saveClassPrototypes } from '../sim/save/galaxySave';
import { stateDigest } from '../sim/tick/digest';
import { setGameEndHandler } from '../sim/victory';
import { registerLocationPingedHook } from '../sim/story/eventActions';
import { SimFrameBudget } from '../simFrameBudget';
import { commandFreshRoots } from './commandReach';
import { hintSubjectsRevision, liveHintSubjects } from '../sim/player/hintSubjects';
import { WAYPOINT_OPS, liveWaypointState } from '../sim/player/waypoints';
import { GalaxySyncSource } from './replicaGalaxy';
import { TRADE_FLOWS_SIDE_KEY, TradeFlowSyncSource } from './tradeFlowSync';
import { installRimAtmosphereData } from '../render/rimAtmosphereWiring';
import { RemoteValues, decodeRemoteArg, encodeRemoteArg, encodeRemoteResult, type RemoteArg, type RemoteNaming } from './remoteArgs';
import { runHostOp } from './hostOps';
import { drainVoiceCues } from '../sim/scenario/llm/voiceCues';
import { setPlayerMessageListener, type PlayerMessageNote } from '../sim/playerMessages';
import type { ClockMessage, CommandMessage, DebugReply, DebugRequest, FromWorker, HostOpMessage, RefreshRequest, SnapshotMessage, StepMessage, TradeFlowsMessage, ViewMessage, WorkerEvent } from './protocol';
import { commandLog, copyCommandLogEntry, type CommandLogEntry } from '../sim/player/commandLog';
import type { ReplicaEncoderOptions } from './replicaSync';

export interface SimHostOptions {
    /** Wall clock (performance.now in the worker; a fake one in tests). */
    now?: () => number;
    /**
     * Epoch wall clock for command deadlines (CommandMessage.deadline; default `performance.timeOrigin +
     * performance.now()`, the main thread's clock too). Read once per frame boundary.
     */
    wallNow?: () => number;
    sync?: Partial<Pick<ReplicaEncoderOptions, 'coldBudgetMs' | 'coldMaxSets' | 'markBudgetMs'>>;
    /**
     * Send the main thread what the player's message pipeline handled ('playerMessages' events: each message's receipt
     * and each event, for the ticker, popups, stubs and the event panel; docs/sim-worker.md §4.5). The pipeline itself
     * is sim code (sim/playerMessages.ts) and runs in every mode; this only decides whether the UI hears about it. The
     * browser worker turns it on; headless hosts leave it off.
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
    /** Commands issued on the galaxy's player queue and not applied yet, in issue order (settleCommands). */
    private readonly queued: { id: number; op: string; done: boolean }[] = [];
    /**
     * Commands received (decoded) and not yet admitted to the player queue: admitCommands hands them on at the next
     * frame boundary, after the deadline check (the timeout policy, docs/sim-worker.md §4.4).
     */
    private readonly arrived: { m: CommandMessage; empire: Empire; args: unknown[] }[] = [];
    private readonly wallNow: () => number;
    /** Commands rejected for their deadline so far (tests, the smoke). */
    expiredCommands = 0;
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
    /** A waypoint op was applied since the last delta (player/waypoints.ts: a side table, freshened before the next one). */
    private waypointsFresh = false;
    private hintSubjectsSeen = 0;
    /** Graph objects the commands since the last tick named or returned, with how deep to compare them (encoder
     *  compareNow) in that tick's delta: the issuing empire 1 (its lists), arguments and results 2 (a colony's
     *  construction queue and its wait list, a ship's mission and queued missions). */
    private readonly touched = new Map<object, number>();
    private readonly graphProtos = new Set<object>(Object.values(saveClassPrototypes()));
    /** What the player's message pipeline handled since the last step message (opts.playerMessages), in order. */
    private playerNotes: PlayerMessageNote[] = [];
    private readonly sendPlayerMessages: boolean;

    constructor(readonly game: Game, time: GalaxyTime, private readonly startOptions: StartGameOptions, opts: SimHostOptions = {}) {
        this.galaxy = game.galaxy;
        this.now = opts.now ?? (() => performance.now());
        this.wallNow = opts.wallNow ?? (() => performance.timeOrigin + performance.now());
        // The clock is a view over galaxy.nowMs, as in-thread (simLoop.ts createSimLoop).
        this.time = time;
        time.bindGalaxy(this.galaxy);
        this.driver = new SimDriver(this.galaxy, time.speed, time.paused);
        this.budget = new SimFrameBudget(this.now);
        const ext = galaxyExternals(this.galaxy);
        this.externalsByRef = ext.byRef;
        // The player's message pipeline runs in the sim (sim/playerMessages.ts); its receipts go to the main thread.
        this.sendPlayerMessages = opts.playerMessages === true;
        if (this.sendPlayerMessages) setPlayerMessageListener(this.galaxy, (note) => void this.playerNotes.push(note));
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
        // Main.Part12.cs DoGameEnd (ui/screens/empireComparison.ts installGameEndHandler): the sim has ended the game and
        // reviewed the achievements (victory.ts onGameEnd); the pause is the clock's, here; the banner is the main thread's.
        setGameEndHandler(this.galaxy, (e) => {
            this.time.paused = true;
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

    /** The main thread's camera for the LOD pass (journaled at the next boundary that steps; null: no pass). */
    private wantView: SimView | null = null;

    setView(m: ViewMessage): void {
        this.wantView = m.view;
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

    /**
     * Queue a player command on the authoritative galaxy (applied at the next boundary, journaled as in-thread). Every
     * command with a reply id gets exactly one entry in a later step message's `results` (docs/sim-worker.md §4.4
     * "Failed commands"): its result once applied; an error when it could not be queued (the issuing empire or an
     * argument is no longer in the game, an unknown static / class); or, when its executor threw at the boundary,
     * an error marked `threw` (settleCommands) — the in-thread loop then pauses with a simulation error and never calls
     * the callback, and so does the main thread.
     */
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
            // Queued on the galaxy at the next frame boundary (admitCommands), unless its deadline has passed by then.
            this.arrived.push({ m, empire, args });
        } catch (err) {
            if (m.id !== 0) this.results.push({ id: m.id, result: null, error: err instanceof Error ? err.message : String(err) });
            else console.error('sim worker: command failed', err);
        }
        this.dirty = true;
    }

    /**
     * The frame boundary's admission (the timeout policy, docs/sim-worker.md §4.4 "Failed commands"): the commands
     * received since the last boundary go to the galaxy's player queue in arrival order — and are applied by the
     * drain that follows, exactly where they were applied before — except those whose deadline (CommandMessage.deadline,
     * the main thread's REPLY_TIMEOUT_MS after it sent them) has passed at this boundary: they are rejected, not
     * applied and not journaled (seed + command log replays the game without them), with an `expired` reply that the
     * main thread delivers as the op's failure value, and a warning here. The wall clock is read once per boundary.
     */
    private admitCommands(): void {
        if (this.arrived.length === 0) return;
        const wall = this.wallNow();
        for (const { m, empire, args } of this.arrived.splice(0)) {
            if (m.deadline !== undefined && wall > m.deadline) {
                this.expiredCommands++;
                const late = Math.round(wall - m.deadline);
                console.warn(`sim worker: command ${m.op}${m.id !== 0 ? ` (request ${m.id})` : ''} rejected: it reached a frame boundary ${late} ms after its deadline (not applied, not journaled)`);
                if (m.id !== 0) this.results.push({ id: m.id, result: null, error: `not applied: it reached the simulation ${late} ms after its deadline`, expired: true });
                continue;
            }
            const entry = { id: m.id, op: m.op, done: false };
            // A callback even without a reply id: settleCommands tells an applied command from one whose executor threw.
            // (It changes nothing in the sim: applyLive calls it after the executor, as it calls the in-thread UI's.)
            issuePlayerCommand(this.galaxy, empire, m.op as PlayerOpName, args as never, (result: unknown) => {
                entry.done = true;
                // What the op changed past its arguments' reach (an id into a book: commandReach.ts), read now that
                // the executor ran, for this tick's delta.
                for (const o of commandFreshRoots(m.op, empire)) this.noteFresh(o);
                // The waypoints live in a side table (outside the graph): freshened before this tick's delta.
                if (WAYPOINT_OPS.has(m.op)) this.waypointsFresh = true;
                if (m.id !== 0) this.results.push(this.commandReply(m.id, m.op, result));
            });
            this.queued.push(entry);
        }
        this.dirty = true;
    }

    /** The reply to an applied command: its result for the main thread (never lost: see encodeRemoteResult). */
    private commandReply(id: number, op: string, result: unknown): StepMessage['results'][number] {
        try {
            this.touch(result, 2);
            this.noteFresh(result);
            return { id, result: this.encodeResult(`command ${op}`, result) };
        } catch (err) {
            console.error(`sim worker: command ${op}: its result could not be sent`, err);
            return { id, result: null, error: `result not sendable: ${err instanceof Error ? err.message : String(err)}` };
        }
    }

    /** encodeRemoteResult with the parts that could not cross exactly logged loudly (a result type to make sendable). */
    private encodeResult(what: string, result: unknown): RemoteArg {
        return encodeRemoteResult(result, this.naming, (problems) => console.error(`sim worker: ${what}: result sent with parts made plain (make its type sendable): ${problems.join('; ')}`));
    }

    /**
     * After a boundary may have run (a tick, a save, a debug advance): the commands the player queue took off since the
     * last call (it applies them in issue order, and only this host issues commands on its galaxy) are settled. One whose
     * callback did not run had its executor throw (the boundary stopped there; the commands after it stay queued for the
     * next boundary, as in-thread): its reply is an error marked `threw`.
     */
    private settleCommands(err?: unknown): void {
        const taken = this.queued.length - pendingPlayerCommands(this.galaxy);
        if (taken <= 0) return;
        const why = err === undefined ? 'see the worker console' : err instanceof Error ? err.message : String(err);
        for (const e of this.queued.splice(0, taken)) {
            if (!e.done && e.id !== 0) this.results.push({ id: e.id, result: null, error: `command ${e.op} failed in the game: ${why}`, threw: true });
        }
        this.dirty = true;
    }

    /** Commands queued on the galaxy that have no reply yet (tests). */
    get commandsInFlight(): number {
        return this.queued.length + this.arrived.length;
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

    /** encodeRemoteArg, or null when the value cannot cross (an unregistered class): an event field, not a command. */
    private encodeOrNull(v: unknown): RemoteArg {
        try {
            return encodeRemoteArg(v, this.naming);
        } catch (err) {
            console.warn('sim worker: event value not sendable', err);
            return null;
        }
    }

    /**
     * What the player's message pipeline handled since the last step message (in the frames, at the command
     * boundaries, in a save's drain), as one event for the main thread. Encoded now, after the tick: a message the
     * pipeline stamped or recorded is born on the main thread with its final contents.
     */
    private sendPlayerNotes(): void {
        if (this.playerNotes.length === 0) return;
        const notes = this.playerNotes;
        this.playerNotes = [];
        const receipts: Extract<WorkerEvent, { kind: 'playerMessages' }>['receipts'] = [];
        const events: Extract<WorkerEvent, { kind: 'playerMessages' }>['events'] = [];
        for (const n of notes) {
            if (n.receipt !== undefined) {
                const r = n.receipt;
                receipts.push({ m: this.encodeOrNull(r.message), ticker: r.ticker, advisor: r.advisor, route: r.route === null ? null : { ...r.route }, action: r.action });
            } else {
                const e = n.event;
                events.push({ type: e.type, title: String(e.title ?? ''), message: String(e.message ?? ''), data: this.encodeOrNull(e.additionalData), location: this.encodeOrNull(e.location) });
            }
        }
        this.events.push({ kind: 'playerMessages', receipts, events });
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
                    this.results.push({ id: m.id, result: this.encodeResult(`host op ${m.op}`, result) });
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
        let failure: unknown;
        try {
            this.admitCommands();
            drainCommandBoundary(this.galaxy);
            // The queued commands have been applied with their by-value arguments.
            this.commandValues.boundary();
            if (!time.paused) {
                noteSimSpeed(this.galaxy, time.speed);
                // The camera is a sim input too: journal it and run with exactly the journaled one (simLoop.ts).
                noteSimViewRect(this.galaxy, this.wantView);
            }
            const view = loggedSimViewRect(this.galaxy);
            steps = this.budget.run(driver, realDtMs, time.speed, time.paused, view !== null ? { view } : {});
        } catch (err) {
            failure = err;
            // As in-thread: drop the half-drained tick queue, pause, and tell the player.
            console.error('Simulation error (paused):', err);
            schedulerState(this.galaxy).queue.length = 0;
            this.budget.backlogMs = 0;
            time.paused = true;
            this.events.push({ kind: 'simError', message: err instanceof Error ? err.message : String(err) });
            this.dirty = true;
        }
        this.settleCommands(failure);
        this.drainVoiceCues();
        this.sendPlayerNotes();
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
        if (hintSubjectsRevision !== this.hintSubjectsSeen) {
            this.hintSubjectsSeen = hintSubjectsRevision;
            this.sync.freshenSideTable('hintSubjects', liveHintSubjects(this.galaxy), 1);
        }
        if (this.waypointsFresh) {
            this.waypointsFresh = false;
            this.sync.freshenSideTable('waypoints', liveWaypointState(this.galaxy));
        }
        for (const [o, depth] of this.touched) this.sync.encoder.compareNow(o, depth);
        this.touched.clear();
        return this.message(steps, t1 - t0);
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
        return this.saveWith((g, t, o) => serializeGame(g, t, o));
    }

    /** save() as a Blob of the text's UTF-8 bytes (saveData.ts serializeGameBlob): what the worker sends — the text is
     *  never one string in the worker's heap, and the Blob reaches the page by reference, not as a copy. */
    saveBlob(): Blob {
        return this.saveWith(serializeGameBlob);
    }

    private saveWith<T>(serialize: (game: Game, time: GalaxyTime, startOptions: StartGameOptions) => T): T {
        // serializeGame applies the queued commands first (a boundary): admit what arrived, as a tick would.
        this.admitCommands();
        try {
            const text = serialize(this.game, this.time, this.startOptions);
            this.settleCommands();
            return text;
        } catch (err) {
            // serializeGame applies the queued commands first: one may have thrown (the save fails, as in-thread).
            this.settleCommands(err);
            throw err;
        }
    }

    /**
     * The game's save for the restart after a fatal error (worker.ts fatal; restart.ts): the state as of the last frame,
     * WITHOUT the commands that have not been applied — the main thread fails every order still on its way when the
     * worker stops, so they must not be in the save either. The commands received since the last boundary are dropped;
     * if some were already handed to the galaxy's queue (the stop came inside a boundary), a consistent save cannot be
     * made: null (the restart then uses the replica or the autosave).
     */
    rescueSave(): string | null {
        return this.rescueWith(() => this.save());
    }

    /** rescueSave as a Blob (what the worker sends with its fatal error: saveBlob). */
    rescueSaveBlob(): Blob | null {
        return this.rescueWith(() => this.saveBlob());
    }

    private rescueWith<T>(save: () => T): T | null {
        this.arrived.length = 0;
        if (pendingPlayerCommands(this.galaxy) > 0) return null;
        return save();
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
        // `advance` runs frames (boundaries): admit what arrived first, as a tick would.
        this.admitCommands();
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
        // `advance` runs frames, whose boundaries apply the queued commands.
        this.settleCommands(error);
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
        if (this.sendPlayerMessages) setPlayerMessageListener(this.galaxy, null);
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
