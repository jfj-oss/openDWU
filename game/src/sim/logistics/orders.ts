// M4d — orders, contracts, freighter assignment, trade bonuses, unowned cargo.
//
// Stubs created by M4a (tasks/M4-plan.md §3.1): the tick skeletons in src/sim/tick/ call these entry points in C#
// order. Each is a no-op that does NOT draw Galaxy.Rnd (a `RND:` note marks C# draw sites that are skipped until the
// owning package ports the body) and records a TODO hit (tick/todo.ts). The owning package replaces the bodies in
// place, keeping the signatures (or adjusting the skeleton call in the same change).

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import type { BuiltObject } from '../builtObject';
import type { Habitat } from '../types';
import { registerTodo, todo } from '../tick/todo';

const T_checkMarketOrders = registerTodo('M4d', 'checkMarketOrders');
/** Empire.4.cs 720 CheckMarketOrders. */
export function checkMarketOrders(galaxy: Galaxy, empire: Empire): void {
    /* TODO(port) M4d */ todo(T_checkMarketOrders);
}

const T_processTradeBonuses = registerTodo('M4d', 'processTradeBonuses');
/** Empire.1.cs 1029 ProcessTradeBonuses(timePassed). */
export function processTradeBonuses(galaxy: Galaxy, empire: Empire, timePassed: number): void {
    /* TODO(port) M4d */ todo(T_processTradeBonuses);
}

const T_reviewRestrictedResourceTrading = registerTodo('M4d', 'reviewRestrictedResourceTrading');
/** Empire.4.cs 4311 ReviewRestrictedResourceTrading. */
export function reviewRestrictedResourceTrading(galaxy: Galaxy, empire: Empire): void {
    /* TODO(port) M4d */ todo(T_reviewRestrictedResourceTrading);
}

const T_maintainBaseResourceLevels = registerTodo('M4d', 'maintainBaseResourceLevels');
/** Empire.1.cs 4275 MaintainBaseResourceLevels. */
export function maintainBaseResourceLevels(galaxy: Galaxy, empire: Empire): void {
    /* TODO(port) M4d */ todo(T_maintainBaseResourceLevels);
}

const T_checkForUnownedCargoBuiltObject = registerTodo('M4d', 'checkForUnownedCargoBuiltObject');
/** BuiltObject.cs 3568 CheckForUnownedCargo. */
export function checkForUnownedCargoBuiltObject(galaxy: Galaxy, builtObject: BuiltObject): void {
    /* TODO(port) M4d */ todo(T_checkForUnownedCargoBuiltObject);
}

const T_checkForUnownedCargoHabitat = registerTodo('M4d', 'checkForUnownedCargoHabitat');
/** Habitat.cs 1558 CheckForUnownedCargo. */
export function checkForUnownedCargoHabitat(galaxy: Galaxy, habitat: Habitat): void {
    /* TODO(port) M4d */ todo(T_checkForUnownedCargoHabitat);
}

const T_countResourceSupplyLocations = registerTodo('M4d', 'countResourceSupplyLocations');
/**
 * Empire.CountResourceSupplyLocations(resourceId, includeUnderConstruction) (added by M4j: BaconHabitat
 * CalculateResourcePriceEnvironmentalFactors). Stub returns 0.
 */
export function countResourceSupplyLocations(galaxy: Galaxy, empire: Empire, resourceId: number, includeUnderConstruction: boolean): number {
    /* TODO(port) M4d */ todo(T_countResourceSupplyLocations);
    return 0;
}
