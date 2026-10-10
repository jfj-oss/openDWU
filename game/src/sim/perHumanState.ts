// Per-human copies of the C#'s per-player state (multiplayer decision §4.7, docs/MULTIPLAYER.md). DW:U keeps one copy,
// for the one player: Ruin.PlayerEmpireEncountered, BuiltObject.PlayerEmpireEncounterAction, the Game Options message
// settings (Galaxy.messageOptions), the unlocked achievements (Galaxy.unlockedAchievementNames), the smuggling-report
// counters (EmpireActivity.playerAmountDelivered / playerIncomeEarned) and the location-hint subjects. The primary human
// (galaxy.playerEmpire) keeps using those fields; every OTHER human's copy lives here, beside the galaxy graph. So a
// one-human game never writes here, and saves the same text as before; the save writes this as the side table
// `perHuman` only when something is in it (galaxySave.ts).
//
// The accessors take the empire the state is for. An AI empire (or no empire) reads and writes the primary's fields,
// as the C# does (it reads the player's copy wherever an AI asks).
//
// Headless: no DOM / Pixi. No Rnd.

import type { BuiltObject } from './builtObject';
import type { Empire } from './empire';
import type { Galaxy } from './galaxy';
import type { MessageOptions } from './messageRouting';
import type { EmpireActivity } from './pirates/empireActivity';
import type { Ruin } from './ruins';
import type { BuiltObjectEncounterAction } from './gameStartTail';
import { humanEmpires, isHumanEmpire } from './humanEmpires';

/** The saved / synced shape (plain data and graph references; galaxySave encodes it with the graph's ids). */
export interface PerHumanState {
    /** Ruins each non-primary human has encountered. */
    ruins: Map<Empire, Ruin[]>;
    /** Each non-primary human's encounter action per object (absent: the object's own, see `initialActions`). */
    actions: Map<Empire, Map<BuiltObject, BuiltObjectEncounterAction>>;
    /** An object's encounter action before the primary human consumed it (what the other humans still see). */
    initialActions: Map<BuiltObject, BuiltObjectEncounterAction | undefined>;
    /** Each non-primary human's Game Options message settings (absent: the primary's). */
    messageOptions: Map<Empire, MessageOptions>;
    /** Each non-primary human's unlocked achievement names. */
    achievements: Map<Empire, string[]>;
    /** Each non-primary human's smuggling-report counters per mission: [amountDelivered, incomeEarned]. */
    smuggling: Map<Empire, Map<EmpireActivity, [number, number]>>;
    /** Each non-primary human's location-hint subjects (player/hintSubjects.ts' table). */
    hintSubjects: Map<Empire, Record<string, unknown>>;
}

const states = new WeakMap<Galaxy, PerHumanState>();

function emptyState(): PerHumanState {
    return { ruins: new Map(), actions: new Map(), initialActions: new Map(), messageOptions: new Map(), achievements: new Map(), smuggling: new Map(), hintSubjects: new Map() };
}

function stateOf(galaxy: Galaxy): PerHumanState {
    let s = states.get(galaxy);
    if (s === undefined) {
        s = emptyState();
        states.set(galaxy, s);
    }
    return s;
}

/** True when `empire` is a human other than the primary: its copy is kept here. */
function isOtherHuman(galaxy: Galaxy, empire: Empire | null | undefined): empire is Empire {
    return empire != null && empire !== galaxy.playerEmpire && isHumanEmpire(galaxy, empire);
}

// ---- Ruin.PlayerEmpireEncountered ----

/** Whether `empire` has encountered `ruin` (the primary human, an AI or null: Ruin.playerEmpireEncountered). */
export function ruinEncounteredBy(galaxy: Galaxy, ruin: Ruin, empire: Empire | null | undefined): boolean {
    if (!isOtherHuman(galaxy, empire)) return ruin.playerEmpireEncountered;
    return states.get(galaxy)?.ruins.get(empire)?.includes(ruin) ?? false;
}

/** Mark `ruin` encountered by `empire` (see ruinEncounteredBy). */
export function setRuinEncounteredBy(galaxy: Galaxy, ruin: Ruin, empire: Empire | null | undefined): void {
    if (!isOtherHuman(galaxy, empire)) {
        ruin.playerEmpireEncountered = true;
        return;
    }
    const s = stateOf(galaxy);
    let list = s.ruins.get(empire);
    if (list === undefined) s.ruins.set(empire, (list = []));
    if (!list.includes(ruin)) list.push(ruin);
}

/** Every human has encountered `ruin` (with one human: Ruin.playerEmpireEncountered). */
export function ruinEncounteredByAllHumans(galaxy: Galaxy, ruin: Ruin): boolean {
    if (!ruin.playerEmpireEncountered) return false;
    for (const h of humanEmpires(galaxy)) if (h !== galaxy.playerEmpire && !ruinEncounteredBy(galaxy, ruin, h)) return false;
    return true;
}

// ---- BuiltObject.PlayerEmpireEncounterAction ----

/** `empire`'s encounter action for `builtObject` (the primary human, an AI or null: the object's field). */
export function encounterActionFor(galaxy: Galaxy, builtObject: BuiltObject, empire: Empire | null | undefined): BuiltObjectEncounterAction | undefined {
    if (!isOtherHuman(galaxy, empire)) return builtObject.playerEmpireEncounterAction;
    const s = states.get(galaxy);
    const own = s?.actions.get(empire)?.get(builtObject);
    if (own !== undefined) return own;
    if (s !== undefined && s.initialActions.has(builtObject)) return s.initialActions.get(builtObject);
    return builtObject.playerEmpireEncounterAction;
}

/** Set `empire`'s encounter action for `builtObject` (see encounterActionFor). */
export function setEncounterActionFor(galaxy: Galaxy, builtObject: BuiltObject, empire: Empire | null | undefined, action: BuiltObjectEncounterAction): void {
    if (!isOtherHuman(galaxy, empire)) {
        // The other humans keep seeing the action the object had before the primary consumed it.
        if (humanEmpires(galaxy).length > 1) {
            const s = stateOf(galaxy);
            if (!s.initialActions.has(builtObject)) s.initialActions.set(builtObject, builtObject.playerEmpireEncounterAction);
        }
        builtObject.playerEmpireEncounterAction = action;
        return;
    }
    const s = stateOf(galaxy);
    let m = s.actions.get(empire);
    if (m === undefined) s.actions.set(empire, (m = new Map()));
    m.set(builtObject, action);
}

/** The object's encounter action was set afresh for everyone (it became abandoned again): forget the per-human copies. */
export function resetEncounterActions(galaxy: Galaxy, builtObject: BuiltObject): void {
    const s = states.get(galaxy);
    if (s === undefined) return;
    s.initialActions.delete(builtObject);
    for (const m of s.actions.values()) m.delete(builtObject);
}

// ---- Galaxy.messageOptions (the Game Options message settings) ----

/** `empire`'s message settings, or undefined for the primary's (Galaxy.messageOptions). */
export function humanMessageOptions(galaxy: Galaxy, empire: Empire | null | undefined): MessageOptions | undefined {
    return isOtherHuman(galaxy, empire) ? states.get(galaxy)?.messageOptions.get(empire) : undefined;
}

/** Store a non-primary human's message settings; false for the primary / an AI (the caller sets Galaxy.messageOptions). */
export function setHumanMessageOptions(galaxy: Galaxy, empire: Empire | null | undefined, options: MessageOptions): boolean {
    if (!isOtherHuman(galaxy, empire)) return false;
    stateOf(galaxy).messageOptions.set(empire, options);
    return true;
}

// ---- Galaxy.unlockedAchievementNames ----

/** Add an unlocked achievement for a non-primary human; false for the primary / an AI (the caller uses the galaxy's list). */
export function addHumanAchievement(galaxy: Galaxy, empire: Empire | null | undefined, name: string): boolean {
    if (!isOtherHuman(galaxy, empire)) return false;
    const s = stateOf(galaxy);
    let list = s.achievements.get(empire);
    if (list === undefined) s.achievements.set(empire, (list = []));
    if (!list.includes(name)) list.push(name);
    return true;
}

/** The achievements `empire` unlocked (the primary: Galaxy.unlockedAchievementNames). */
export function unlockedAchievementsOf(galaxy: Galaxy, empire: Empire | null | undefined): readonly string[] {
    if (!isOtherHuman(galaxy, empire)) return galaxy.unlockedAchievementNames;
    return states.get(galaxy)?.achievements.get(empire) ?? [];
}

// ---- EmpireActivity.playerAmountDelivered / playerIncomeEarned ----

/** Count a smuggling delivery for a non-primary human. */
export function addHumanSmuggling(galaxy: Galaxy, empire: Empire, activity: EmpireActivity, amount: number, income: number): void {
    const s = stateOf(galaxy);
    let m = s.smuggling.get(empire);
    if (m === undefined) s.smuggling.set(empire, (m = new Map()));
    const v = m.get(activity) ?? [0, 0];
    m.set(activity, [v[0] + amount, v[1] + income]);
}

/** `empire`'s smuggling-report counters for `activity` (the primary: the activity's fields). */
export function smugglingOf(galaxy: Galaxy, empire: Empire | null | undefined, activity: EmpireActivity): { amountDelivered: number; incomeEarned: number } {
    if (!isOtherHuman(galaxy, empire)) return { amountDelivered: activity.playerAmountDelivered, incomeEarned: activity.playerIncomeEarned };
    const v = states.get(galaxy)?.smuggling.get(empire)?.get(activity) ?? [0, 0];
    return { amountDelivered: v[0], incomeEarned: v[1] };
}

// ---- location-hint subjects (player/hintSubjects.ts keeps the live tables; these are the saved copies) ----

/** The saved hint-subject tables of the non-primary humans (set by galaxySave from hintSubjects.ts at save time). */
export function perHumanHintSubjects(galaxy: Galaxy): Map<Empire, Record<string, unknown>> {
    return stateOf(galaxy).hintSubjects;
}

// ---- save / sync ----

function isEmpty(s: PerHumanState): boolean {
    return s.ruins.size === 0 && s.actions.size === 0 && s.initialActions.size === 0 && s.messageOptions.size === 0 && s.achievements.size === 0 && s.smuggling.size === 0 && s.hintSubjects.size === 0;
}

/** What the save writes: the state, or undefined (no key) while nothing is in it — every one-human game. */
export function savedPerHumanState(galaxy: Galaxy): PerHumanState | undefined {
    const s = states.get(galaxy);
    return s === undefined || isEmpty(s) ? undefined : s;
}

/** A loaded save's / synced table (undefined or null: none). */
export function restorePerHumanState(galaxy: Galaxy, t: PerHumanState | null | undefined): void {
    if (t == null) states.delete(galaxy);
    else states.set(galaxy, { ...emptyState(), ...t });
}
