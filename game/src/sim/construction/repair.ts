// M4h — repairs.
//
// Stubs created by M4a (tasks/M4-plan.md §3.1): the tick skeletons in src/sim/tick/ call these entry points in C#
// order. Each is a no-op that does NOT draw Galaxy.Rnd (a `RND:` note marks C# draw sites that are skipped until the
// owning package ports the body) and records a TODO hit (tick/todo.ts). The owning package replaces the bodies in
// place, keeping the signatures (or adjusting the skeleton call in the same change).

import type { Galaxy } from '../galaxy';
import type { BuiltObject } from '../builtObject';
import { registerTodo, todo } from '../tick/todo';

const T_doRepairs = registerTodo('M4h', 'doRepairs');
/** BuiltObject.cs 3498 / BaconBuiltObject.cs 4763 DoRepairs(timePassed). */
export function doRepairs(galaxy: Galaxy, builtObject: BuiltObject, timePassed: number): void {
    // RND: 1 direct, +clock×2 — not drawn until M4h.
    /* TODO(port) M4h */ todo(T_doRepairs);
}

const T_checkRepairMissionStillValid = registerTodo('M4h', 'checkRepairMissionStillValid');
/** BuiltObject.1.cs 4474 CheckRepairMissionStillValid. */
export function checkRepairMissionStillValid(galaxy: Galaxy, builtObject: BuiltObject): void {
    /* TODO(port) M4h */ todo(T_checkRepairMissionStillValid);
}

const T_checkForRepairs = registerTodo('M4h', 'checkForRepairs');
/** BuiltObject.cs 4077 CheckForRepairs. */
export function checkForRepairs(galaxy: Galaxy, builtObject: BuiltObject): void {
    /* TODO(port) M4h */ todo(T_checkForRepairs);
}
