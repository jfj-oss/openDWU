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
import { nextFrameMs, runSimFrame, schedulerState } from '../tick/scheduler';
import { flatEmpireList } from '../save/galaxySave';
import { appendCommandLog, commandLog, copyCommandLogEntry, type CommandLogEntry, type PlayerLogEntry } from './commandLog';
import { CommandEncodeError, decodeCommandArg, encodeCommandArg, type EncodedArg } from './commandCodec';
import { PLAYER_OPS, type PlayerOpArgs, type PlayerOpName, type PlayerOpResult } from './playerOps';
import { applyStrategicCommand } from './strategicDecisions';

interface Pending {
    empire: Empire;
    op: PlayerOpName;
    args: unknown[];
    onApplied?: (result: unknown) => void;
}

interface QueueState {
    /** Commands issued since the last boundary, in issue order. */
    pending: Pending[];
    /** Replay: log entries still to apply, in log order. */
    scheduled: CommandLogEntry[];
    draining: boolean;
}

const queues = new WeakMap<Galaxy, QueueState>();

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
 */
export function issuePlayerCommand<K extends PlayerOpName>(galaxy: Galaxy, empire: Empire, op: K, args: PlayerOpArgs<K>, onApplied?: (result: PlayerOpResult<K>) => void): void {
    if (inSimFrame()) throw new Error(`player command ${op} issued inside a sim frame (commands apply only at frame boundaries)`);
    queueOf(galaxy).pending.push({ empire, op, args: args as unknown[], onApplied: onApplied as ((r: unknown) => void) | undefined });
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
    return fn(galaxy, empire, ...args);
}

function encodeArgs(galaxy: Galaxy, args: readonly unknown[]): EncodedArg[] {
    return args.map((a) => encodeCommandArg(galaxy, a));
}

function applyLive(galaxy: Galaxy, p: Pending): void {
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
    const result = applyOp(galaxy, p.empire, p.op, p.args);
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
            const r = applyStrategicCommand(galaxy, empire, e.command);
            appendCommandLog(galaxy, { ...(copyCommandLogEntry(e) as typeof e), status: r.status });
            return;
        }
        case 'clock':
        case 'view':
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

/** Why a replay of `log` cannot be exact (empty when it can): stretches run with the camera LOD pass on. */
export function commandLogReplayWarnings(log: readonly CommandLogEntry[]): string[] {
    const out: string[] = [];
    for (const e of log) {
        if (e.source === 'view' && e.on) out.push(`camera level-of-detail pass (?simView=1) on from ${e.nowMs} ms: the camera is not journaled, the replay runs without it and may differ`);
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

/** Run `galaxy` headless (no view) until `untilMs`, at the speeds the scheduled 'clock' entries name. */
export function runScheduledUntil(galaxy: Galaxy, untilMs: number): void {
    queueOf(galaxy);
    const state = schedulerState(galaxy);
    let speed = loggedSimSpeed(galaxy);
    while (galaxy.nowMs < untilMs) {
        // The boundary's entries (incl. a speed change) apply before the frame length is chosen, as in the app loop.
        flushPlayerCommands(galaxy);
        speed = loggedSimSpeed(galaxy);
        runSimFrame(galaxy, nextFrameMs(state, speed));
    }
    flushPlayerCommands(galaxy);
}

/**
 * Seed + command log → the game: createGame({ ...options, seed }) and apply every log entry at its frame boundary,
 * running headless (no camera view) until `untilMs` (default: the last entry's time). The result's own log equals
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
