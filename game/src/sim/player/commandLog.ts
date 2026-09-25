// 18c — the external command log: decisions that reach the sim from outside the tick (here: the local model's
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

export interface CommandLogEntry {
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

const logs = new WeakMap<Galaxy, CommandLogEntry[]>();

/** The galaxy's command log (empty when nothing was issued). */
export function commandLog(galaxy: Galaxy): readonly CommandLogEntry[] {
    return logs.get(galaxy) ?? [];
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
    else logs.set(galaxy, entries.map((e) => ({ ...e, command: { ...e.command } })));
}
