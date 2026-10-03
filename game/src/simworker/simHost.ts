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
import { decodeRemoteArg, encodeRemoteArg, type RemoteArg, type RemoteNaming } from './remoteArgs';
import { PlayerMessagePipeline, applyPlayerMessageUiOp, attachPlayerRecipients, restorePlayerRecipients, withRecipientsAsSaved, type PlayerMessageBatch } from '../ui/messagePipeline';
import type { ClockMessage, CommandMessage, FromWorker, SnapshotMessage, StepMessage, UiOpMessage, WorkerEvent } from './protocol';
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

export class SimHost {
    readonly galaxy: Galaxy;
    readonly time: GalaxyTime;
    readonly driver: SimDriver;
    readonly budget: SimFrameBudget;
    readonly sync: GalaxySyncSource;
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
        // Between frames, as the in-thread UI timers run: the player's message pipeline.
        this.pumpPlayerMessages();
        const t1 = this.now();
        // After the last change (a step, a command, the clock), keep diffing until a whole cold cycle has passed, so a
        // paused game's replica becomes exact (every cold object compared since); then go quiet.
        const changed = steps > 0 || this.dirty || this.results.length > 0 || this.events.length > 0;
        if (changed) this.settleUntilCycle = this.sync.encoder.cycleCount + 2;
        if (!changed && !forceDelta && this.sync.encoder.cycleCount >= this.settleUntilCycle) return null;
        this.dirty = false;
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
        const player = this.galaxy.playerEmpire;
        const save = (): string => serializeGame(this.game, this.time, this.startOptions);
        return this.pipeline !== null && player !== null ? withRecipientsAsSaved(player, save) : save();
    }

    digest(): string {
        return stateDigest(this.galaxy);
    }

    get serial(): number {
        return this.stepSerial;
    }

    dispose(): void {
        if (this.pipeline !== null) restorePlayerRecipients(this.pipeline.player);
        setGameEndHandler(this.galaxy, null);
        registerLocationPingedHook(null);
    }
}

/** A FromWorker message's transferable buffers. */
export type { FromWorker };
