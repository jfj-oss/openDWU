// M4e — docking bays, wait queues.
//
// Stubs created by M4a (tasks/M4-plan.md §3.1): the tick skeletons in src/sim/tick/ call these entry points in C#
// order. Each is a no-op that does NOT draw Galaxy.Rnd (a `RND:` note marks C# draw sites that are skipped until the
// owning package ports the body) and records a TODO hit (tick/todo.ts). The owning package replaces the bodies in
// place, keeping the signatures (or adjusting the skeleton call in the same change).

import type { Galaxy } from '../galaxy';
import type { BuiltObject } from '../builtObject';
import type { Habitat } from '../types';
import { registerTodo, todo } from '../tick/todo';

const T_checkClearDocking = registerTodo('M4e', 'checkClearDocking');
/** BuiltObject.1.cs 1275 CheckClearDocking([forceUndock]) (`forceUndock` added by M4c: HyperTo passes true). */
export function checkClearDocking(galaxy: Galaxy, builtObject: BuiltObject, forceUndock = false): void {
    /* TODO(port) M4e */ todo(T_checkClearDocking);
}

const T_checkForShipsNoLongerDockingBuiltObject = registerTodo('M4e', 'checkForShipsNoLongerDockingBuiltObject');
/** BuiltObject.cs 3903 CheckForShipsNoLongerDocking. */
export function checkForShipsNoLongerDockingBuiltObject(galaxy: Galaxy, builtObject: BuiltObject): void {
    /* TODO(port) M4e */ todo(T_checkForShipsNoLongerDockingBuiltObject);
}

const T_checkForShipsNoLongerDockingHabitat = registerTodo('M4e', 'checkForShipsNoLongerDockingHabitat');
/** Habitat.cs 2464 CheckForShipsNoLongerDocking. */
export function checkForShipsNoLongerDockingHabitat(galaxy: Galaxy, habitat: Habitat): void {
    /* TODO(port) M4e */ todo(T_checkForShipsNoLongerDockingHabitat);
}

const T_checkRemoveInvalidDockingShipsFromWaitQueue = registerTodo('M4e', 'checkRemoveInvalidDockingShipsFromWaitQueue');
/** Galaxy.cs 3540 CheckRemoveInvalidDockingShipsFromWaitQueue(stellarObject). */
export function checkRemoveInvalidDockingShipsFromWaitQueue(galaxy: Galaxy, stellarObject: BuiltObject | Habitat): void {
    /* TODO(port) M4e */ todo(T_checkRemoveInvalidDockingShipsFromWaitQueue);
}

// ---- stub added by M4c (missions/cmdMovement.ts HyperTo arrival) ----

const T_checkMissionStillValid = registerTodo('M4e', 'checkMissionStillValid');
/**
 * BuiltObject.1.cs 4496 CheckMissionStillValid(time) (also read by case Dock 2733) — stub: valid (true). The C# may clear
 * the mission for Refuel/Transport/Build/LoadTroops/UnloadTroops missions whose dock target became unusable.
 */
export function checkMissionStillValid(galaxy: Galaxy, builtObject: BuiltObject, time: number): boolean {
    // RND: Galaxy.Rnd.NextDouble() when the dock target is blockaded (4596) — not drawn until M4e.
    /* TODO(port) M4e */ todo(T_checkMissionStillValid);
    return true;
}
