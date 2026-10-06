// The player command queue and the command-log replay (tasks/M4-agent-brief.md "Command log").
//
// Contract: every change the player (or the local advisor acting for the player) makes to the sim is a command
// (player/playerOps.ts). The UI never calls an executor directly: it issues the command here, the queue holds it, and
// the scheduler applies it at the next frame boundary (tick/commandBoundary.ts: the start of runSimFrame before the
// clock advances; the app loop also drains once per render frame, so orders land within one frame, paused or not).
// Applying journals it in the command log (player/commandLog.ts) with the sim time of that boundary (galaxy.nowMs /
// star date, never a wall clock) and its arguments encoded (player/commandCodec.ts). Seed + log therefore replays the
// game: replayCommandLog builds a fresh game from the same options and applies each entry at the boundary it names.
// Game-speed changes are journaled too ('clock' entries): the frame length is a sim input.
//
// Headless: no DOM / Pixi. Not reachable from the tick path (the scheduler only calls the boundary hook).

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import { createGame, type CreateGameOptions, type Game } from '../game';
import { galaxyStarDate } from '../tick/simTime';
import { inSimFrame, setCommandDrainer } from '../tick/commandBoundary';
import { nextFrameMs, runSimFrame, schedulerState, type SimView } from '../tick/scheduler';
import { flatEmpireList } from '../save/galaxySave';
import { appendCommandLog, commandLog, copyCommandLogEntry, type CommandLogEntry, type PlayerLogEntry } from './commandLog';
import { CommandEncodeError, decodeCommandArg, encodeCommandArg, type EncodedArg } from './commandCodec';
import { PLAYER_OPS, type PlayerOpArgs, type PlayerOpName, type PlayerOpResult } from './playerOps';
import { applyStrategicCommand } from './strategicDecisions';
import { noteConstructionBoardCommand } from './constructionBoard';
import { setUiRecordSender, withSimWrites } from '../readOnlyQuery';
import { ensurePlayerInbox, processPlayerMessages } from '../playerMessages';
import { applyAddonsLogEntry } from '../scenario/addToSave';

interface Pending {
    empire: Empire;
    op: PlayerOpName;
    args: unknown[];
    onApplied?: (result: unknown) => void;
    onFailed?: (reason: string) => void;
}

interface QueueState {
    /** Commands issued since the last boundary, in issue order. */
    pending: Pending[];
    /** Replay: log entries still to apply, in log order. */
    scheduled: CommandLogEntry[];
    draining: boolean;
}

const queues = new WeakMap<Galaxy, QueueState>();

/**
 * Sim worker (docs/sim-worker.md §4): a REPLICA galaxy on the main thread forwards its player commands to the worker
 * that runs the authoritative game, instead of queueing them here. The sink gets the command as issued; the worker
 * queues it on the real galaxy (issuePlayerCommand there), so it is applied and journaled exactly as in-thread.
 */
export type RemoteCommandSink = (empire: Empire, op: PlayerOpName, args: unknown[], onApplied?: (result: unknown) => void, onFailed?: (reason: string) => void) => void;
const remoteSinks = new WeakMap<Galaxy, RemoteCommandSink>();

/** Route `galaxy`'s player commands to `sink` (a sim-worker replica), or back to the local queue (null). */
export function setRemoteCommandSink(galaxy: Galaxy, sink: RemoteCommandSink | null): void {
    if (sink === null) remoteSinks.delete(galaxy);
    else remoteSinks.set(galaxy, sink);
}

/** Whether `galaxy` is a sim-worker replica whose commands go to the worker. */
export function hasRemoteCommandSink(galaxy: Galaxy): boolean {
    return remoteSinks.has(galaxy);
}

function queueOf(galaxy: Galaxy): QueueState {
    let q = queues.get(galaxy);
    if (q === undefined) {
        q = { pending: [], scheduled: [], draining: false };
        queues.set(galaxy, q);
        setCommandDrainer(galaxy, drain);
    }
    return q;
}

/**
 * Issue a player command: it is applied at the next frame boundary (see the file header) and journaled. `onApplied`
 * gets the executor's result then (synchronously, inside the boundary; it must not change the sim itself — issue
 * another command instead, which applies in the same boundary pass).
 *
 * `onFailed` runs instead of `onApplied` when the command produced no result: its executor threw (in-thread the
 * boundary's exception then stops the frame; in sim-worker mode the worker pauses with a simulation error), or the
 * remote sink could not take it. With both given, exactly one of them runs for every command, so a UI that holds a
 * control busy until the reply (ui/pendingCommands.ts) can always release it. A worker-mode command that could not be
 * sent, expired or met a stopped worker still gets `onApplied` with the op's failure value (simworker/commandFailure.ts).
 */
export function issuePlayerCommand<K extends PlayerOpName>(
    galaxy: Galaxy,
    empire: Empire,
    op: K,
    args: PlayerOpArgs<K>,
    onApplied?: (result: PlayerOpResult<K>) => void,
    onFailed?: (reason: string) => void,
): void {
    if (inSimFrame()) throw new Error(`player command ${op} issued inside a sim frame (commands apply only at frame boundaries)`);
    const remote = remoteSinks.get(galaxy);
    if (remote !== undefined) {
        try {
            remote(empire, op, args as unknown[], onApplied as ((r: unknown) => void) | undefined, onFailed);
        } catch (err) {
            // The sink never throws by contract (clientCore.ts sendCommand); if it does, the caller still hears of it,
            // never inside this call.
            if (onFailed === undefined) throw err;
            const reason = err instanceof Error ? err.message : String(err);
            queueMicrotask(() => onFailed(reason));
        }
        return;
    }
    queueOf(galaxy).pending.push({ empire, op, args: args as unknown[], onApplied: onApplied as ((r: unknown) => void) | undefined, onFailed });
}

/** Commands issued and not applied yet. */
export function pendingPlayerCommands(galaxy: Galaxy): number {
    return queues.get(galaxy)?.pending.length ?? 0;
}

/**
 * Apply the queued commands now. Only between frames (a boundary): the app loop, a save, a test harness, or an async
 * caller that needs the result at once (the advisor chat) — all at the same galaxy.nowMs the next frame would use.
 */
export function flushPlayerCommands(galaxy: Galaxy): void {
    if (inSimFrame()) throw new Error('flushPlayerCommands inside a sim frame');
    if (queues.has(galaxy)) drain(galaxy);
}

/** Issue and apply at once (between frames only); returns the executor's result. */
export function runPlayerCommand<K extends PlayerOpName>(galaxy: Galaxy, empire: Empire, op: K, args: PlayerOpArgs<K>): PlayerOpResult<K> {
    if (remoteSinks.has(galaxy)) throw new Error(`runPlayerCommand(${op}) needs the result at once, which a sim-worker replica cannot give: issue it with issuePlayerCommand and an onApplied callback`);
    let result: PlayerOpResult<K> | undefined;
    let applied = false;
    issuePlayerCommand(galaxy, empire, op, args, (r) => {
        result = r;
        applied = true;
    });
    flushPlayerCommands(galaxy);
    if (!applied) throw new Error(`player command ${op} was not applied`);
    return result as PlayerOpResult<K>;
}

function drain(galaxy: Galaxy): void {
    const q = queues.get(galaxy);
    if (q === undefined || q.draining) return;
    ensurePlayerInbox(galaxy);
    q.draining = true;
    try {
        while (q.scheduled.length > 0 && q.scheduled[0].nowMs <= galaxy.nowMs) {
            const e = q.scheduled.shift()!;
            if (e.nowMs !== galaxy.nowMs) {
                q.scheduled.length = 0;
                throw new Error(`command log replay: entry at ${e.nowMs} ms missed (galaxy at ${galaxy.nowMs} ms: different frame boundaries)`);
            }
            replayEntry(galaxy, e);
        }
        // Commands issued by an onApplied callback join this pass (same boundary).
        while (q.pending.length > 0) {
            const p = q.pending.shift()!;
            applyLive(galaxy, p);
        }
    } finally {
        q.draining = false;
    }
}

function applyOp(galaxy: Galaxy, empire: Empire, op: PlayerOpName, args: unknown[]): unknown {
    const fn = PLAYER_OPS[op] as unknown as (g: Galaxy, e: Empire, ...a: unknown[]) => unknown;
    if (fn === undefined) throw new Error(`command log: unknown player op ${String(op)}`);
    // The executor is sim code: the lazy lookups write (readOnlyQuery.ts); the onApplied callbacks are UI code and
    // run outside it.
    const result = withSimWrites(() => fn(galaxy, empire, ...args));
    // Any order may have replaced a construction-board job: re-check the board at the next frame (no-op without jobs).
    noteConstructionBoardCommand(galaxy, empire);
    // What the order sent the player is handled before the next command, as the C# UI thread handles its BeginInvoke
    // queue after the click handler returns (playerMessages.ts). Live and replayed alike, so seed + log replays it.
    processPlayerMessages(galaxy);
    return result;
}

// The records the C# UI's lookups add (readOnlyQuery.ts requestUiRecord) arrive as one journaled command per UI task.
setUiRecordSender((galaxy, requests) => {
    const player = galaxy.playerEmpire;
    if (player !== null) issuePlayerCommand(galaxy, player, 'obtainUiRecords', [requests]);
});

function encodeArgs(galaxy: Galaxy, args: readonly unknown[]): EncodedArg[] {
    return args.map((a) => encodeCommandArg(galaxy, a));
}

function applyLive(galaxy: Galaxy, p: Pending): void {
    let result: unknown;
    try {
        result = applyJournaled(galaxy, p);
    } catch (err) {
        // The executor (or the journal) threw: the boundary's exception stops the frame as before; the issuer hears of
        // it after the boundary (UI code never runs inside it).
        const onFailed = p.onFailed;
        if (onFailed !== undefined) {
            const reason = err instanceof Error ? err.message : String(err);
            queueMicrotask(() => onFailed(reason));
        }
        throw err;
    }
    if (p.onApplied !== undefined) {
        try {
            p.onApplied(result);
        } catch (err) {
            // A UI follow-up failing must not stop the other commands of this boundary.
            queueMicrotask(() => {
                throw err;
            });
        }
    }
}

function applyJournaled(galaxy: Galaxy, p: Pending): unknown {
    const empireIndex = flatEmpireList(galaxy).indexOf(p.empire);
    const entry: PlayerLogEntry = { starDate: galaxyStarDate(galaxy), nowMs: galaxy.nowMs, source: 'player', empire: empireIndex, op: p.op, args: [] };
    try {
        entry.args = encodeArgs(galaxy, p.args);
    } catch (err) {
        if (!(err instanceof CommandEncodeError)) throw err;
        // The order still lands; the log says why a replay cannot reproduce it.
        entry.error = err.message;
    }
    appendCommandLog(galaxy, entry);
    return applyOp(galaxy, p.empire, p.op, p.args);
}

function replayEntry(galaxy: Galaxy, e: CommandLogEntry): void {
    switch (e.source) {
        case 'player': {
            if (e.error !== undefined) throw new Error(`command log replay: ${e.op} at ${e.nowMs} ms was not journaled replayably (${e.error})`);
            const empire = flatEmpireList(galaxy)[e.empire];
            if (empire === undefined) throw new Error(`command log replay: no empire ${e.empire}`);
            const args = e.args.map((a) => decodeCommandArg(galaxy, a as EncodedArg));
            // Determinism check: the decoded arguments must encode back to the journaled ones.
            const again = JSON.stringify(encodeArgs(galaxy, args));
            if (again !== JSON.stringify(e.args)) throw new Error(`command log replay: ${e.op} at ${e.nowMs} ms resolves to different objects`);
            appendCommandLog(galaxy, copyCommandLogEntry(e));
            applyOp(galaxy, empire, e.op as PlayerOpName, args);
            return;
        }
        case 'ai-advisor': {
            const empire = flatEmpireList(galaxy).find((x) => x.empireId === e.empireId);
            if (empire === undefined) throw new Error(`command log replay: no empire id ${e.empireId}`);
            const r = withSimWrites(() => applyStrategicCommand(galaxy, empire, e.command));
            processPlayerMessages(galaxy); // as applyStrategicDecisions does after each command
            appendCommandLog(galaxy, { ...(copyCommandLogEntry(e) as typeof e), status: r.status });
            return;
        }
        case 'clock':
        case 'view':
            appendCommandLog(galaxy, copyCommandLogEntry(e));
            return;
        case 'addons':
            // Add-ons switched on at a load (scenario/addToSave.ts): the same switch change at the same boundary.
            applyAddonsLogEntry(galaxy, e);
            appendCommandLog(galaxy, copyCommandLogEntry(e));
            return;
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Game speed (a frame-length input)
// ---------------------------------------------------------------------------------------------------------------

/** The speed the log says frames run at now (the last 'clock' entry; 1 without one). */
export function loggedSimSpeed(galaxy: Galaxy): number {
    const log = commandLog(galaxy);
    for (let i = log.length - 1; i >= 0; i--) {
        const e = log[i];
        if (e.source === 'clock') return e.speed;
    }
    return 1;
}

/** Journal the game speed the next frames run at when it changed (the app loop calls this before stepping). */
export function noteSimSpeed(galaxy: Galaxy, speed: number): void {
    if (inSimFrame()) throw new Error('noteSimSpeed inside a sim frame');
    if (loggedSimSpeed(galaxy) === speed) return;
    appendCommandLog(galaxy, { starDate: galaxyStarDate(galaxy), nowMs: galaxy.nowMs, source: 'clock', speed });
}

/** Whether the log says the camera LOD pass is on now (the last 'view' entry; off without one). */
export function loggedSimView(galaxy: Galaxy): boolean {
    const log = commandLog(galaxy);
    for (let i = log.length - 1; i >= 0; i--) {
        const e = log[i];
        if (e.source === 'view') return e.on;
    }
    return false;
}

/** Journal the camera LOD pass (?simView=1) being switched on / off (the app loop calls this before stepping). */
export function noteSimView(galaxy: Galaxy, on: boolean): void {
    if (inSimFrame()) throw new Error('noteSimView inside a sim frame');
    if (loggedSimView(galaxy) === on) return;
    appendCommandLog(galaxy, { starDate: galaxyStarDate(galaxy), nowMs: galaxy.nowMs, source: 'view', on });
}

/** The camera the log says the LOD pass runs with now (the last 'view' entry's `view`; null when off, or when it was
 *  switched on without a journaled camera — a replay runs that stretch without a view). */
export function loggedSimViewRect(galaxy: Galaxy): SimView | null {
    const log = commandLog(galaxy);
    for (let i = log.length - 1; i >= 0; i--) {
        const e = log[i];
        if (e.source === 'view') return e.on && e.view !== undefined ? e.view : null;
    }
    return null;
}

function sameSimView(a: SimView, b: SimView): boolean {
    return a.x === b.x && a.y === b.y && a.viewWidth === b.viewWidth && a.viewHeight === b.viewHeight && a.clientWidth === b.clientWidth && a.zoomFactor === b.zoomFactor;
}

/**
 * Journal the camera the LOD pass runs with from this boundary on (null: no pass) when it differs from the logged one,
 * and return the logged camera — the frames must run with exactly that (the app loop calls this before stepping and
 * passes the result to the scheduler), so a replay of the log runs the same pass.
 */
export function noteSimViewRect(galaxy: Galaxy, view: SimView | null): SimView | null {
    if (inSimFrame()) throw new Error('noteSimViewRect inside a sim frame');
    const logged = loggedSimViewRect(galaxy);
    if (view === null) {
        if (loggedSimView(galaxy)) appendCommandLog(galaxy, { starDate: galaxyStarDate(galaxy), nowMs: galaxy.nowMs, source: 'view', on: false });
        return null;
    }
    if (logged !== null && sameSimView(logged, view)) return logged;
    const v = { ...view };
    appendCommandLog(galaxy, { starDate: galaxyStarDate(galaxy), nowMs: galaxy.nowMs, source: 'view', on: true, view: v });
    return v;
}

/** Why a replay of `log` cannot be exact (empty when it can): stretches run with the camera LOD pass on and no journaled
 *  camera. */
export function commandLogReplayWarnings(log: readonly CommandLogEntry[]): string[] {
    const out: string[] = [];
    for (const e of log) {
        if (e.source === 'addons' && e.withData === true) out.push(`add-ons ${e.added.join(', ')} switched on at ${e.nowMs} ms carry data files: replay with game data that has their overlays (the switches are applied at that boundary)`);
        if (e.source === 'view' && e.on && e.view === undefined) out.push(`camera level-of-detail pass (?simView=1) on from ${e.nowMs} ms: the camera is not journaled, the replay runs without it and may differ`);
    }
    return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------------------------------------------

/** Apply `entries` (a command log) to `galaxy` as the frames reach their boundaries. */
export function scheduleCommandLog(galaxy: Galaxy, entries: readonly CommandLogEntry[]): void {
    const q = queueOf(galaxy);
    let last = -Infinity;
    for (const e of entries) {
        if (e.nowMs < last) throw new Error('command log: entries out of time order');
        last = e.nowMs;
        q.scheduled.push(copyCommandLogEntry(e));
    }
}

/** Run `galaxy` until `untilMs`, at the speeds the scheduled 'clock' entries name and with the cameras the 'view' entries
 *  journal (headless — no view — where there is none). */
export function runScheduledUntil(galaxy: Galaxy, untilMs: number): void {
    queueOf(galaxy);
    const state = schedulerState(galaxy);
    let speed = loggedSimSpeed(galaxy);
    while (galaxy.nowMs < untilMs) {
        // The boundary's entries (incl. a speed change) apply before the frame length is chosen, as in the app loop.
        flushPlayerCommands(galaxy);
        speed = loggedSimSpeed(galaxy);
        // The journaled camera (if any) runs the same LOD pass the app ran.
        const view = loggedSimViewRect(galaxy);
        runSimFrame(galaxy, nextFrameMs(state, speed), view !== null ? { view } : undefined);
    }
    flushPlayerCommands(galaxy);
}

/**
 * Seed + command log → the game: createGame({ ...options, seed }) and apply every log entry at its frame boundary,
 * running until `untilMs` (headless, or with the cameras its 'view' entries journal) (default: the last entry's time). The result's own log equals
 * `log` (each applied entry is journaled again, after checking it resolves to the same objects).
 */
export function replayCommandLog(
    seed: number,
    options: Omit<CreateGameOptions, 'seed'>,
    log: readonly CommandLogEntry[],
    untilMs?: number,
    onWarning: (message: string) => void = (m) => console.warn(`command log replay: ${m}`),
): Game {
    for (const w of commandLogReplayWarnings(log)) onWarning(w);
    const game = createGame({ ...options, seed } as CreateGameOptions);
    scheduleCommandLog(game.galaxy, log);
    runScheduledUntil(game.galaxy, untilMs ?? (log.length > 0 ? log[log.length - 1].nowMs : 0));
    const left = queues.get(game.galaxy)?.scheduled.length ?? 0;
    if (left > 0) throw new Error(`command log replay: ${left} entries after ${untilMs} ms not applied`);
    return game;
}
