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

/** Galaxy.humanEmpires: the human-controlled empires, primary human (galaxy.playerEmpire) first. */
export function humanEmpires(galaxy: Galaxy): readonly Empire[] {
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
    return list.includes(empire);
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
