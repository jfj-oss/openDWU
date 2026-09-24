// M4e — refuelling.
//
// Stubs created by M4a (tasks/M4-plan.md §3.1): the tick skeletons in src/sim/tick/ call these entry points in C#
// order. Each is a no-op that does NOT draw Galaxy.Rnd (a `RND:` note marks C# draw sites that are skipped until the
// owning package ports the body) and records a TODO hit (tick/todo.ts). The owning package replaces the bodies in
// place, keeping the signatures (or adjusting the skeleton call in the same change).

import type { Galaxy } from '../galaxy';
import type { BuiltObject } from '../builtObject';
import { registerTodo, todo } from '../tick/todo';

const T_checkForRefuelling = registerTodo('M4e', 'checkForRefuelling');
/** BuiltObject.cs 4940 CheckForRefuelling(useCachedRefuellingLocation). */
export function checkForRefuelling(galaxy: Galaxy, builtObject: BuiltObject, useCachedRefuellingLocation: boolean): void {
    /* TODO(port) M4e */ todo(T_checkForRefuelling);
}

const T_checkForFuelOrdering = registerTodo('M4e', 'checkForFuelOrdering');
/** BuiltObject.cs 4697 CheckForFuelOrdering. */
export function checkForFuelOrdering(galaxy: Galaxy, builtObject: BuiltObject): void {
    /* TODO(port) M4e */ todo(T_checkForFuelOrdering);
}
