// M4e — refuelling.
//
// Stubs created by M4a (tasks/M4-plan.md §3.1): the tick skeletons in src/sim/tick/ call these entry points in C#
// order. Each is a no-op that does NOT draw Galaxy.Rnd (a `RND:` note marks C# draw sites that are skipped until the
// owning package ports the body) and records a TODO hit (tick/todo.ts). The owning package replaces the bodies in
// place, keeping the signatures (or adjusting the skeleton call in the same change).

import type { Galaxy } from '../galaxy';
import type { BuiltObject } from '../builtObject';
import type { Habitat } from '../types';
import type { Creature } from '../creature';
import type { Empire } from '../empire';
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

// ---- stubs added by M4b (called from missions/assign.ts) ----

const T_checkCancelRefuelData = registerTodo('M4e', 'checkCancelRefuelData');
/** BuiltObject.2.cs 7029 CheckCancelRefuelData — stub: false (the C# releases the reserved fuel at the refuelling point). */
export function checkCancelRefuelData(galaxy: Galaxy, builtObject: BuiltObject): boolean {
    /* TODO(port) M4e */ todo(T_checkCancelRefuelData);
    return false;
}

const T_initiateRefuelData = registerTodo('M4e', 'initiateRefuelData');
/** BuiltObject.2.cs 7097 InitiateRefuelData(refuelLocation) → reserved fuel amount — stub: 0. */
export function initiateRefuelData(galaxy: Galaxy, builtObject: BuiltObject, refuelLocation: BuiltObject | Habitat | Creature): number {
    /* TODO(port) M4e */ todo(T_initiateRefuelData);
    return 0;
}

const T_autoRefuelRepairShip = registerTodo('M4e', 'autoRefuelRepairShip');
/** BuiltObject.2.cs 4706 AutoRefuelRepairShip(useCachedRefuellingLocation) — stub: false (no refuel/repair mission queued). */
export function autoRefuelRepairShip(galaxy: Galaxy, builtObject: BuiltObject, useCachedRefuellingLocation: boolean): boolean {
    /* TODO(port) M4e */ todo(T_autoRefuelRepairShip);
    return false;
}

// ---- stub added by M4s (Empire.2.cs 1365/1452 ReviewPirateSmugglingMissions / MakeSmugglingOffersToPirates) ----
const T_thisYearsPrivateFuelCosts = registerTodo('M4e', 'thisYearsPrivateFuelCosts');
/**
 * Empire.ThisYearsPrivateFuelCosts (Empire.cs 2336: _ThisYearsPrivateFuelCosts, accumulated by Empire.6.cs 2266
 * PurchasePrivateFuel). Stub: 0 (no private fuel purchases are recorded until M4e ports refuelling payments).
 */
export function thisYearsPrivateFuelCosts(galaxy: Galaxy, empire: Empire): number {
    /* TODO(port) M4e */ todo(T_thisYearsPrivateFuelCosts);
    return 0.0;
}

// ---- stub added by M4f (called from civilianAI.ts AssignMissionToBuiltObject, Empire.5.cs 1445) ----

const T_setupRefuelling = registerTodo('M4e', 'setupRefuelling');
/** BuiltObject.cs 4774 SetupRefuelling() — stub: no refuel mission assigned (the C# assigns a Refuel mission or an order). */
export function setupRefuelling(galaxy: Galaxy, builtObject: BuiltObject): void {
    /* TODO(port) M4e */ todo(T_setupRefuelling);
}
