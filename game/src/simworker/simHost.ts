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
import type { Empire } from '../sim/empire';
import { GalaxyTime } from '../sim/galaxyTime';
import type { StartGameOptions } from '../sim/startGameOptions';
import { SimDriver, schedulerState } from '../sim/tick/scheduler';
import { drainCommandBoundary } from '../sim/tick/commandBoundary';
import { issuePlayerCommand, noteSimSpeed, noteSimView } from '../sim/player/playerCommands';
import type { PlayerOpName } from '../sim/player/playerOps';
import { serializeGame } from '../sim/save/gameSave';
import { galaxyExternals } from '../sim/save/galaxySave';
import { stateDigest } from '../sim/tick/digest';
import { setGameEndHandler, doGameEnd } from '../sim/victory';
import { reviewAchievements } from '../sim/achievements';
import { registerLocationPingedHook } from '../sim/story/eventActions';
import { SimFrameBudget } from '../simFrameBudget';
import { GalaxySyncSource } from './replicaGalaxy';
import { TRADE_FLOWS_SIDE_KEY, TradeFlowSyncSource } from './tradeFlowSync';
import { installRimAtmosphereData } from '../render/rimAtmosphereWiring';
import { decodeRemoteArg, encodeRemoteArg, type RemoteArg, type RemoteNaming } from './remoteArgs';
import type { ClockMessage, CommandMessage, FromWorker, SnapshotMessage, StepMessage, TradeFlowsMessage, WorkerEvent } from './protocol';
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
    private results: StepMessage['results'] = [];
    private events: WorkerEvent[] = [];
    private readonly naming: RemoteNaming;
    private readonly externalsByRef: Map<string, object>;
    private readonly now: () => number;
    /** Something changed outside a step (a command, the clock): send a delta even if no step ran. */
    private dirty = true;
    private settleUntilCycle = 0;

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
        this.naming = {
            syncId: (o) => this.sync.encoder.ensureId(o),
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
        };
        try {
            const empire = resolving.object(m.empire) as Empire | null;
            if (empire === null) throw new Error(`command ${m.op}: issuing empire (sync id ${m.empire}) is not in the game`);
            const args = m.args.map((a) => decodeRemoteArg(a, resolving));
            issuePlayerCommand(this.galaxy, empire, m.op as PlayerOpName, args as never, m.id === 0 ? undefined : (result: unknown) => {
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
        this.tradeFlows.refresh();
        const delta = this.sync.delta();
        const msg: StepMessage = {
            type: 'step',
            delta,
            stepSerial: this.stepSerial,
            steps,
            nowMs: this.galaxy.nowMs,
            backlogMs: this.budget.backlogMs,
            speed: time.speed,
            paused: time.paused,
            clockSeq: this.clockSeq,
            stepMs: t1 - t0,
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
