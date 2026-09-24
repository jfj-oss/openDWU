// M4o — explosions, disabled components, self-destruct.
//
// Stubs created by M4a (tasks/M4-plan.md §3.1): the tick skeletons in src/sim/tick/ call these entry points in C#
// order. Each is a no-op that does NOT draw Galaxy.Rnd (a `RND:` note marks C# draw sites that are skipped until the
// owning package ports the body) and records a TODO hit (tick/todo.ts). The owning package replaces the bodies in
// place, keeping the signatures (or adjusting the skeleton call in the same change).

import type { Galaxy } from '../galaxy';
import type { BuiltObject } from '../builtObject';
import type { Habitat } from '../types';
import type { Creature } from '../creature';
import type { ShipGroup } from '../fleets/shipGroup';
import { registerTodo, todo } from '../tick/todo';

const T_doExplosionsBuiltObject = registerTodo('M4o', 'doExplosionsBuiltObject');
/** BuiltObject.1.cs 14 DoExplosions(galaxy). */
export function doExplosionsBuiltObject(galaxy: Galaxy, builtObject: BuiltObject): void {
    // RND: +clock×3 — not drawn until M4o.
    /* TODO(port) M4o */ todo(T_doExplosionsBuiltObject);
}

const T_doExplosionHabitat = registerTodo('M4o', 'doExplosionHabitat');
/** Habitat.cs 6341 DoExplosion. */
export function doExplosionHabitat(galaxy: Galaxy, habitat: Habitat): void {
    /* TODO(port) M4o */ todo(T_doExplosionHabitat);
}

const T_doExplosionsHabitat = registerTodo('M4o', 'doExplosionsHabitat');
/** Habitat.cs 6309 DoExplosions. */
export function doExplosionsHabitat(galaxy: Galaxy, habitat: Habitat): void {
    /* TODO(port) M4o */ todo(T_doExplosionsHabitat);
}

const T_reviewDisabledComponents = registerTodo('M4o', 'reviewDisabledComponents');
/** BuiltObject.2.cs 6084 ReviewDisabledComponents(timePassed). */
export function reviewDisabledComponents(galaxy: Galaxy, builtObject: BuiltObject, timePassed: number): void {
    // RND: +clock×1 — not drawn until M4o.
    /* TODO(port) M4o */ todo(T_reviewDisabledComponents);
}

const T_checkSelfDestruct = registerTodo('M4o', 'checkSelfDestruct');
/** BuiltObject.2.cs 4816 CheckSelfDestruct. */
export function checkSelfDestruct(galaxy: Galaxy, builtObject: BuiltObject): void {
    // RND: draws in callees (d≤3), +clock×2 — not drawn until M4o.
    /* TODO(port) M4o */ todo(T_checkSelfDestruct);
}

// ---- stubs added by M4b (called from missions/*.ts) ----

const T_startNewBattleStats = registerTodo('M4o', 'startNewBattleStats');
/** BuiltObject.2.cs 7643-7644: BaconSpaceBattleStats.AddLatestCombatStats(this, BattleStats); BattleStats = new SpaceBattleStats() — stub: BattleStats stays null. */
export function startNewBattleStats(galaxy: Galaxy, builtObject: BuiltObject): void {
    /* TODO(port) M4o */ todo(T_startNewBattleStats);
}

const T_finalizeBattleStats = registerTodo('M4o', 'finalizeBattleStats');
/**
 * BuiltObject.2.cs 4517-4522 / 4527-4531: AddLatestCombatStats + BattleStats.Location = ResolveNearestLocation(attackedTarget,
 * this, out nearby) + DoCharacterEvent(SpaceBattle, BattleStats, Characters) — stub (only reachable once BattleStats is non-null).
 */
export function finalizeBattleStats(galaxy: Galaxy, builtObject: BuiltObject, attackedTarget: BuiltObject | Habitat | Creature | null): void {
    // RND: DoCharacterEvent(SpaceBattle) draws — not drawn until M4o.
    /* TODO(port) M4o */ todo(T_finalizeBattleStats);
}

// ---- stubs added by M4n ----

const T_startNewShipGroupBattleStats = registerTodo('M4o', 'startNewShipGroupBattleStats');
/** `ShipGroup.BattleStats = new SpaceBattleStats()` (BuiltObject.1.cs 318 / 501 / 572; the fleet stats object is M4o's) — stub: stays null. */
export function startNewShipGroupBattleStats(galaxy: Galaxy, shipGroup: ShipGroup): void {
    /* TODO(port) M4o */ todo(T_startNewShipGroupBattleStats);
}
