// The human-controlled empires of a game (multiplayer Phase 1, docs/MULTIPLAYER.md). Not in the C#: DW:U has exactly
// one human, Galaxy.PlayerEmpire. Here a game has a SET of human empires; galaxy.playerEmpire stays as the primary
// human (the single-player alias, and the first entry of the set), so the ported code and the save keep reading as
// the C# does.
//
// - Sim rules that mean "a human controls this empire" (AI-only branches, human-only features, "the human decides"
//   prompts) ask isHumanEmpire(galaxy, empire).
// - What the person at this screen sees (UI, render, fog) is the local viewer (src/localViewer.ts), not this set.
//
// While no list was set (every game today), the set is [galaxy.playerEmpire] (or empty without a player), so
// isHumanEmpire(galaxy, e) is exactly `e === galaxy.playerEmpire` for a non-null e. A set list is kept beside the
// galaxy graph (not a Galaxy field), so a one-human game saves the same text as before; the save writes a set list as
// the side table `humanEmpires` (galaxySave.ts), which older releases ignore (they load the game with its primary human).
//
// Headless: no DOM / Pixi. No Rnd.

import type { Empire } from './empire';
import type { Galaxy } from './galaxy';

/** Lists set with setHumanEmpires (primary human first). Absent: the default [galaxy.playerEmpire]. */
const explicit = new WeakMap<Galaxy, readonly Empire[]>();
/** The default list per galaxy, rebuilt when galaxy.playerEmpire changes (so humanEmpires() allocates nothing). */
const defaults = new WeakMap<Galaxy, { player: Empire | null; list: readonly Empire[] }>();
const EMPTY: readonly Empire[] = Object.freeze([]);

/**
 * Multiplayer Phase 4 (docs/MULTIPLAYER.md §12): human seats whose player left and whose empire the AI runs until they
 * return (the `setSeatAi` command, journaled; host only). Such an empire is not a human empire — isHumanEmpire is false
 * and humanEmpires leaves it out, so every AI branch decides for it — but it keeps its seat (humanSeats, the stable list
 * the session maps players to), and the game stays a multiplayer one (isMultiHuman counts seats). Absent: none (every
 * game that never had a player leave), so nothing changes for any other game.
 */
const aiSeats = new WeakMap<Galaxy, ReadonlySet<Empire>>();
/** humanEmpires' list while some seats are AI-run (the explicit list without them), rebuilt on change. */
const withoutAi = new WeakMap<Galaxy, { seats: readonly Empire[]; ai: ReadonlySet<Empire>; list: readonly Empire[] }>();

/** Galaxy.humanEmpires: the human-controlled empires, primary human (galaxy.playerEmpire) first. */
export function humanEmpires(galaxy: Galaxy): readonly Empire[] {
    const list = explicit.get(galaxy);
    if (list !== undefined) {
        const ai = aiSeats.get(galaxy);
        if (ai === undefined) return list;
        const c = withoutAi.get(galaxy);
        if (c !== undefined && c.seats === list && c.ai === ai) return c.list;
        const fresh = Object.freeze(list.filter((e) => !ai.has(e)));
        withoutAi.set(galaxy, { seats: list, ai, list: fresh });
        return fresh;
    }
    return humanSeats(galaxy);
}

/**
 * The human seats: every empire a human player plays in this game, primary first, including those the AI runs while
 * their player is away (isAiSeat). Without AI seats it is humanEmpires. The multiplayer session maps its players to
 * these by index.
 */
export function humanSeats(galaxy: Galaxy): readonly Empire[] {
    const list = explicit.get(galaxy);
    if (list !== undefined) return list;
    const player = galaxy.playerEmpire ?? null;
    const d = defaults.get(galaxy);
    if (d !== undefined && d.player === player) return d.list;
    const fresh = player === null ? EMPTY : Object.freeze([player]);
    defaults.set(galaxy, { player, list: fresh });
    return fresh;
}

/** True when a human controls `empire` (false for null). With one human: `empire === galaxy.playerEmpire`. */
export function isHumanEmpire(galaxy: Galaxy, empire: Empire | null | undefined): boolean {
    if (empire == null) return false;
    const list = explicit.get(galaxy);
    if (list === undefined) return empire === galaxy.playerEmpire;
    return list.includes(empire) && aiSeats.get(galaxy)?.has(empire) !== true;
}

/** True when more than one human plays (a multiplayer game). Every multiplayer-only rule asks this, so a one-human game
 *  runs exactly as before. Seats the AI runs for a while count: the game stays a multiplayer one. */
export function isMultiHuman(galaxy: Galaxy): boolean {
    return humanSeats(galaxy).length > 1;
}

/** True when `empire` is a human seat the AI runs while its player is away (setAiSeat). */
export function isAiSeat(galaxy: Galaxy, empire: Empire | null | undefined): boolean {
    return empire != null && aiSeats.get(galaxy)?.has(empire) === true;
}

/**
 * Hand a human seat to the AI (`ai`) or back to its player. Any seat of the explicit list (a multiplayer game); the
 * primary human's too, since a host migration (docs/MULTIPLAYER.md §16) lets the lobby's host leave a running game.
 * Returns whether anything changed. Sim state: only through the journaled `setSeatAi` command, at a frame boundary, so
 * every peer changes it at the same frame.
 */
export function setAiSeat(galaxy: Galaxy, empire: Empire, ai: boolean): boolean {
    const list = explicit.get(galaxy);
    if (list === undefined || !list.includes(empire)) return false;
    const cur = aiSeats.get(galaxy);
    if ((cur?.has(empire) === true) === ai) return false;
    const next = new Set(cur ?? []);
    if (ai) next.add(empire);
    else next.delete(empire);
    if (next.size === 0) aiSeats.delete(galaxy);
    else aiSeats.set(galaxy, next);
    return true;
}

/** What the save writes (galaxySave.ts side table `aiSeats`): the AI-run seats in seat order, or undefined (no key). */
export function savedAiSeats(galaxy: Galaxy): Empire[] | undefined {
    const ai = aiSeats.get(galaxy);
    if (ai === undefined) return undefined;
    return humanSeats(galaxy).filter((e) => ai.has(e));
}

/** A loaded save's / synced side table (undefined or null: none). After restoreHumanEmpires. */
export function restoreAiSeats(galaxy: Galaxy, list: readonly Empire[] | null | undefined): void {
    aiSeats.delete(galaxy);
    for (const e of list ?? []) if (e != null) setAiSeat(galaxy, e, true);
}

/**
 * The human a galaxy event aimed at "the player" targets (decision §4.5): the primary human; with more than one human,
 * one of them picked with galaxy.rnd (the same on every client). A one-human game draws nothing, as before.
 */
export function targetHuman(galaxy: Galaxy): Empire | null {
    const humans = humanEmpires(galaxy);
    if (humans.length <= 1) return galaxy.playerEmpire ?? null;
    return humans[galaxy.rnd.next(0, humans.length)];
}

/** True when any human empire sees system `systemIndex` (decision §4.6: "not visible to the player" is to no human). */
export function systemVisibleToAnyHuman(galaxy: Galaxy, systemIndex: number): boolean {
    for (const h of humanEmpires(galaxy)) if (h.visibility.checkSystemVisible(systemIndex)) return true;
    return false;
}

/**
 * Set the human empires (multiplayer setup / a loaded multi-human save). galaxy.playerEmpire stays the primary human:
 * it is moved to the front, or added when missing. A list of just the primary human (or nothing, without a player)
 * clears the setting, so the game saves exactly as a single-player game.
 */
export function setHumanEmpires(galaxy: Galaxy, empires: readonly Empire[]): void {
    const player = galaxy.playerEmpire ?? null;
    const list: Empire[] = player === null ? [] : [player];
    for (const e of empires) if (e != null && !list.includes(e)) list.push(e);
    if (list.length <= 1 && (list.length === 0 ? player === null : list[0] === player)) explicit.delete(galaxy);
    else explicit.set(galaxy, Object.freeze(list));
}

/** What the save writes (galaxySave.ts side table): the set list, or undefined (no key) for the default. */
export function savedHumanEmpires(galaxy: Galaxy): Empire[] | undefined {
    const list = explicit.get(galaxy);
    return list === undefined ? undefined : [...list];
}

/** The replica sync's value (galaxySave.ts replicaSideTables): the set list, or null for the default. */
export function liveHumanEmpires(galaxy: Galaxy): Empire[] | null {
    return savedHumanEmpires(galaxy) ?? null;
}

/** A loaded save's / synced side table (undefined or null: the default, as in every save before the table). */
export function restoreHumanEmpires(galaxy: Galaxy, list: readonly Empire[] | null | undefined): void {
    if (list == null) explicit.delete(galaxy);
    else setHumanEmpires(galaxy, list);
}
