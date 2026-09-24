// M4c — movement, hyperjump, gravity wells, fuel ranges, energy, index upkeep, system links / fuel status.
//
// Stubs created by M4a (tasks/M4-plan.md §3.1): the tick skeletons in src/sim/tick/ call these entry points in C#
// order. Each is a no-op that does NOT draw Galaxy.Rnd (a `RND:` note marks C# draw sites that are skipped until the
// owning package ports the body) and records a TODO hit (tick/todo.ts). The owning package replaces the bodies in
// place, keeping the signatures (or adjusting the skeleton call in the same change).

import type { Galaxy } from './galaxy';
import type { Empire } from './empire';
import type { BuiltObject } from './builtObject';
import type { Habitat } from './types';
import { registerTodo, todo } from './tick/todo';

const T_doDeployment = registerTodo('M4c', 'doDeployment');
/** BuiltObject.cs 3473 DoDeployment(timePassed). */
export function doDeployment(galaxy: Galaxy, builtObject: BuiltObject, timePassed: number): void {
    /* TODO(port) M4c */ todo(T_doDeployment);
}

const T_updateIndexesForMovement = registerTodo('M4c', 'updateIndexesForMovement');
/** BuiltObject.2.cs 7163 UpdateIndexesForMovement(x, y, galaxy, performIndexCheck). */
export function updateIndexesForMovement(galaxy: Galaxy, builtObject: BuiltObject, indexX: number, indexY: number, performIndexCheck: boolean): void {
    /* TODO(port) M4c */ todo(T_updateIndexesForMovement);
}

const T_checkHyperjumpPending = registerTodo('M4c', 'checkHyperjumpPending');
/** BaconBuiltObject.cs 2539 CheckHyperjumpPending. */
export function checkHyperjumpPending(galaxy: Galaxy, builtObject: BuiltObject): boolean {
    /* TODO(port) M4c */ todo(T_checkHyperjumpPending);
    return false;
}

const T_detectHyperDeny = registerTodo('M4c', 'detectHyperDeny');
/** BuiltObject.1.cs 1737 DetectHyperDeny(galaxy) — stub: no hyperdeny in range. */
export function detectHyperDeny(galaxy: Galaxy, builtObject: BuiltObject): boolean {
    /* TODO(port) M4c */ todo(T_detectHyperDeny);
    return false;
}

const T_performEnergyCollection = registerTodo('M4c', 'performEnergyCollection');
/** BuiltObject.2.cs 7765 PerformEnergyCollection(timePassed). */
export function performEnergyCollection(galaxy: Galaxy, builtObject: BuiltObject, timePassed: number): void {
    /* TODO(port) M4c */ todo(T_performEnergyCollection);
}

const T_rechargeReactors = registerTodo('M4c', 'rechargeReactors');
/** BuiltObject.1.cs 2509 RechargeReactors(timePassed). */
export function rechargeReactors(galaxy: Galaxy, builtObject: BuiltObject, timePassed: number): void {
    /* TODO(port) M4c */ todo(T_rechargeReactors);
}

const T_evaluateSystemLinks = registerTodo('M4c', 'evaluateSystemLinks');
/** Empire.9.cs 3273 EvaluateSystemLinks. */
export function evaluateSystemLinks(galaxy: Galaxy, empire: Empire): void {
    // RND: 1 direct — not drawn until M4c.
    /* TODO(port) M4c */ todo(T_evaluateSystemLinks);
}

const T_updateSystemRefuellingStatus = registerTodo('M4c', 'updateSystemRefuellingStatus');
/** Empire.2.cs 3856 UpdateSystemRefuellingStatus. */
export function updateSystemRefuellingStatus(galaxy: Galaxy, empire: Empire): void {
    /* TODO(port) M4c */ todo(T_updateSystemRefuellingStatus);
}

const T_checkForStrandedShips = registerTodo('M4c', 'checkForStrandedShips');
/** Empire.4.cs 2516 CheckForStrandedShips. */
export function checkForStrandedShips(galaxy: Galaxy, empire: Empire): void {
    /* TODO(port) M4c */ todo(T_checkForStrandedShips);
}

const T_updateSystemFuelSourceStatus = registerTodo('M4c', 'updateSystemFuelSourceStatus');
/** Empire.2.cs 3784 UpdateSystemFuelSourceStatus. */
export function updateSystemFuelSourceStatus(galaxy: Galaxy, empire: Empire): void {
    /* TODO(port) M4c */ todo(T_updateSystemFuelSourceStatus);
}

const T_reviewWhetherRefuellingDepot = registerTodo('M4c', 'reviewWhetherRefuellingDepot');
/** Habitat.cs 2007 ReviewWhetherRefuellingDepot. */
export function reviewWhetherRefuellingDepot(galaxy: Galaxy, habitat: Habitat): void {
    /* TODO(port) M4c */ todo(T_reviewWhetherRefuellingDepot);
}

// ---- stubs added by M4b (called from missions/*.ts) ----

const T_accelerateToTargetSpeed = registerTodo('M4c', 'accelerateToTargetSpeed');
/** BuiltObject.2.cs 7334 AccelerateToTargetSpeed(timePassed) — stub: speed unchanged. */
export function accelerateToTargetSpeed(galaxy: Galaxy, builtObject: BuiltObject, timePassed: number): void {
    /* TODO(port) M4c */ todo(T_accelerateToTargetSpeed);
}

const T_calculateCurrentHeading = registerTodo('M4c', 'calculateCurrentHeading');
/** BuiltObject.2.cs 7433 CalculateCurrentHeading(timePassed) — stub: heading unchanged. */
export function calculateCurrentHeading(galaxy: Galaxy, builtObject: BuiltObject, timePassed: number): void {
    /* TODO(port) M4c */ todo(T_calculateCurrentHeading);
}

const T_updatePosition = registerTodo('M4c', 'updatePosition');
/** BaconBuiltObject.cs 4329 UpdatePosition (BuiltObject.UpdatePosition) — stub: position unchanged. */
export function updatePosition(galaxy: Galaxy, builtObject: BuiltObject): void {
    /* TODO(port) M4c */ todo(T_updatePosition);
}

const T_withinFuelRange = registerTodo('M4c', 'withinFuelRange');
/** BuiltObject.1.cs 2373 WithinFuelRange(destinationX, destinationY, fuelPortionMargin) — stub: true (the C# checks fuel vs distance). */
export function withinFuelRange(galaxy: Galaxy, builtObject: BuiltObject, destinationX: number, destinationY: number, fuelPortionMargin: number): boolean {
    /* TODO(port) M4c */ todo(T_withinFuelRange);
    return true;
}

const T_withinFuelRangeAndRefuel = registerTodo('M4c', 'withinFuelRangeAndRefuel');
/** BuiltObject.1.cs 2479 WithinFuelRangeAndRefuel(destinationX, destinationY, extraFuelPortionMargin) — stub: true (the C# may queue a Refuel mission). */
export function withinFuelRangeAndRefuel(galaxy: Galaxy, builtObject: BuiltObject, destinationX: number, destinationY: number, extraFuelPortionMargin: number): boolean {
    /* TODO(port) M4c */ todo(T_withinFuelRangeAndRefuel);
    return true;
}
