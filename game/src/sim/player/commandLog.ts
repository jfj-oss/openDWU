// The external command log (tasks/M4-agent-brief.md "Command log"): player commands (player/playerCommands.ts) and,
// since 18c, decisions that reach the sim from outside the tick (here: the local model's
// strategic decisions for AI empires, player/strategicDecisions.ts) are journaled with the star date they were applied
// at, so seed + command log replays the game (tasks/18-local-llm-diplomacy.md hard rule; REVIEW-player-layer
// 2026-09-25 "advisor-issued commands must be journaled for replay"). The entries are saved with the game
// (save/gameSave.ts `commandLog`, written only when non-empty, so saves without such commands are unchanged).
//
// Kept beside the galaxy (a WeakMap), not on it: the galaxy graph, its save format and the state digest are untouched
// when nothing is logged. Headless: no DOM / Pixi.

import type { Galaxy } from '../galaxy';

/** A resolved strategic command, re-applicable without the brief (player/strategicDecisions.ts applyStrategicCommand). */
export interface StrategicCommand {
    kind: string;
    /** Empire.empireId of the other empire (empire decisions). */
    target?: number;
    /** SetTechFocus: 1-based slot and the Galaxy.4.cs ResolveTechFocus index. */
    slot?: number;
    focus?: number;
    /** SetPolicy: the policy field (C# name) and its new value. */
    field?: string;
    value?: number;
    /** SendGift: GiveGiftWhenSufficientTimePassed's `small`. */
    small?: boolean;
}

/** A strategic decision the local model made for an AI empire (18c; player/strategicDecisions.ts). */
export interface AdvisorLogEntry {
    /** Galaxy star date (ms) and galaxy.nowMs when the command was applied. */
    starDate: number;
    nowMs: number;
    /** Who issued it: 'ai-advisor' = the local model deciding for an AI empire. */
    source: 'ai-advisor';
    /** Empire.empireId of the empire the command was applied for. */
    empireId: number;
    /** The decision id from the brief. */
    decisionId: string;
    command: StrategicCommand;
    /** What the sim did with it: 'applied' (took effect) or 'blocked' (a C# gate declined it). */
    status: 'applied' | 'blocked';
    /** The model's stated reason (transparency; not needed for replay). */
    rationale?: string;
}

/** A player command (player/playerOps.ts), applied at a frame boundary by player/playerCommands.ts. */
export interface PlayerLogEntry {
    /** Galaxy star date (ms) and galaxy.nowMs of the frame boundary it was applied at. */
    starDate: number;
    nowMs: number;
    source: 'player';
    /** Index of the issuing empire in the flat empire list (save/galaxySave.ts flatEmpireList). */
    empire: number;
    /** PLAYER_OPS key. */
    op: string;
    /** The op's arguments after (galaxy, empire), player/commandCodec.ts encoding. */
    args: unknown[];
    /** Set when an argument could not be encoded (the order was applied; a replay stops here). */
    error?: string;
}

/** The game speed frames run at from this boundary on (the frame length is a sim input: scheduler nextFrameMs). */
export interface ClockLogEntry {
    starDate: number;
    nowMs: number;
    source: 'clock';
    speed: number;
}

export type CommandLogEntry = AdvisorLogEntry | PlayerLogEntry | ClockLogEntry;

const logs = new WeakMap<Galaxy, CommandLogEntry[]>();

/** The galaxy's command log (empty when nothing was issued). */
export function commandLog(galaxy: Galaxy): readonly CommandLogEntry[] {
    return logs.get(galaxy) ?? [];
}

/** A deep copy of one entry (the log is data; saves and loads never share objects with the live log). */
export function copyCommandLogEntry(e: CommandLogEntry): CommandLogEntry {
    if (e.source === 'player') return JSON.parse(JSON.stringify(e)) as PlayerLogEntry;
    if (e.source === 'clock') return { ...e };
    return { ...e, command: { ...e.command } };
}

export function appendCommandLog(galaxy: Galaxy, entry: CommandLogEntry): void {
    let list = logs.get(galaxy);
    if (list === undefined) {
        list = [];
        logs.set(galaxy, list);
    }
    list.push(entry);
}

/** Replace the galaxy's log (loading a save). */
export function restoreCommandLog(galaxy: Galaxy, entries: readonly CommandLogEntry[] | undefined): void {
    if (entries === undefined || entries.length === 0) logs.delete(galaxy);
    else logs.set(galaxy, entries.map(copyCommandLogEntry));
}
