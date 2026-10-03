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
import type { ClockMessage, CommandMessage, FromWorker, QueryMessage, SnapshotMessage, StepMessage, TradeFlowsMessage, WorkerEvent } from './protocol';
import type { ReplicaEncoderOptions } from './replicaSync';

export interface SimHostOptions {
    /** Wall clock (performance.now in the worker; a fake one in tests). */
    now?: () => number;
    sync?: Partial<Pick<ReplicaEncoderOptions, 'coldBudgetMs' | 'coldMaxSets' | 'markBudgetMs'>>;
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
    /** Graph objects the commands since the last tick named or returned, with how deep to compare them (encoder
     *  compareNow) in that tick's delta: the issuing empire 1 (its lists), arguments and results 2 (a colony's
     *  construction queue and its wait list, a ship's mission and queued missions). */
    private readonly touched = new Map<object, number>();
    private readonly graphProtos = new Set<object>(Object.values(saveClassPrototypes()));

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
            this.events.push({ kind: 'gameEnd' });
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
            issuePlayerCommand(this.galaxy, empire, m.op as PlayerOpName, args as never, m.id === 0 ? undefined : (result: unknown) => {
                this.touch(result, 2);
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
        this.stepSerial += steps;
        const t1 = this.now();
        // After the last change (a step, a command, the clock), keep diffing until a whole cold cycle has passed, so a
        // paused game's replica becomes exact (every cold object compared since); then go quiet.
        const changed = steps > 0 || this.dirty || this.results.length > 0 || this.events.length > 0;
        if (changed) this.settleUntilCycle = this.sync.encoder.cycleCount + 2;
        if (!changed && !forceDelta && this.sync.encoder.cycleCount >= this.settleUntilCycle) return null;
        this.dirty = false;
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
        return serializeGame(this.game, this.time, this.startOptions);
    }

    digest(): string {
        return stateDigest(this.galaxy);
    }

    get serial(): number {
        return this.stepSerial;
    }

    dispose(): void {
        this.tradeFlows.dispose();
        setGameEndHandler(this.galaxy, null);
        registerLocationPingedHook(null);
    }
}

/** A FromWorker message's transferable buffers. */
export type { FromWorker };
