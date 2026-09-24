// M4o — weapons fire, shields, point defence.
//
// Stubs created by M4a (tasks/M4-plan.md §3.1): the tick skeletons in src/sim/tick/ call these entry points in C#
// order. Each is a no-op that does NOT draw Galaxy.Rnd (a `RND:` note marks C# draw sites that are skipped until the
// owning package ports the body) and records a TODO hit (tick/todo.ts). The owning package replaces the bodies in
// place, keeping the signatures (or adjusting the skeleton call in the same change).

import type { Galaxy } from '../galaxy';
import type { BuiltObject } from '../builtObject';
import type { Habitat } from '../types';
import { registerTodo, todo } from '../tick/todo';

const T_handleWeaponsFiringBuiltObject = registerTodo('M4o', 'handleWeaponsFiringBuiltObject');
/** BuiltObject.1.cs 3737 HandleWeaponsFiring(timePassed, time, galaxy). */
export function handleWeaponsFiringBuiltObject(galaxy: Galaxy, builtObject: BuiltObject, timePassed: number, time: number): void {
    // RND: 9 direct, +clock×3 — not drawn until M4o.
    /* TODO(port) M4o */ todo(T_handleWeaponsFiringBuiltObject);
}

const T_handleWeaponsFiringHabitat = registerTodo('M4o', 'handleWeaponsFiringHabitat');
/** Habitat.cs 2267 HandleWeaponsFiring(timePassed, time, galaxy). */
export function handleWeaponsFiringHabitat(galaxy: Galaxy, habitat: Habitat, timePassed: number, time: number): void {
    // RND: draws in callees (d≤3) — not drawn until M4o.
    /* TODO(port) M4o */ todo(T_handleWeaponsFiringHabitat);
}

const T_rechargeShields = registerTodo('M4o', 'rechargeShields');
/** BuiltObject.1.cs 2225 RechargeShields(timePassed). */
export function rechargeShields(galaxy: Galaxy, builtObject: BuiltObject, timePassed: number): void {
    /* TODO(port) M4o */ todo(T_rechargeShields);
}

const T_checkForPlanetDestroyerWeaponFiringDelayOnHyperExit = registerTodo('M4o', 'checkForPlanetDestroyerWeaponFiringDelayOnHyperExit');
/** BuiltObject.1.cs 1815 CheckForPlanetDestroyerWeaponFiringDelayOnHyperExit(time). */
export function checkForPlanetDestroyerWeaponFiringDelayOnHyperExit(galaxy: Galaxy, builtObject: BuiltObject, time: number): void {
    /* TODO(port) M4o */ todo(T_checkForPlanetDestroyerWeaponFiringDelayOnHyperExit);
}

const T_checkShieldAreaRechargeReset = registerTodo('M4o', 'checkShieldAreaRechargeReset');
/** BuiltObject.cs 1930 CheckShieldAreaRechargeReset(time). */
export function checkShieldAreaRechargeReset(galaxy: Galaxy, builtObject: BuiltObject, time: number): void {
    /* TODO(port) M4o */ todo(T_checkShieldAreaRechargeReset);
}

const T_checkNearbyBuiltObjectsForShieldAreaRecharge = registerTodo('M4o', 'checkNearbyBuiltObjectsForShieldAreaRecharge');
/** BuiltObject.cs 1947 CheckNearbyBuiltObjectsForShieldAreaRecharge(time). */
export function checkNearbyBuiltObjectsForShieldAreaRecharge(galaxy: Galaxy, builtObject: BuiltObject, time: number): void {
    // RND: 1 direct — not drawn until M4o.
    /* TODO(port) M4o */ todo(T_checkNearbyBuiltObjectsForShieldAreaRecharge);
}

const T_defendBase = registerTodo('M4o', 'defendBase');
/** BuiltObject.cs 4557 DefendBase(time). */
export function defendBase(galaxy: Galaxy, builtObject: BuiltObject, time: number): void {
    // RND: draws in callees (d≤3) — not drawn until M4o.
    /* TODO(port) M4o */ todo(T_defendBase);
}

const T_defendShipFromAttackers = registerTodo('M4o', 'defendShipFromAttackers');
/** BuiltObject.cs 4448 DefendShipFromAttackers(time). */
export function defendShipFromAttackers(galaxy: Galaxy, builtObject: BuiltObject, time: number): void {
    // RND: draws in callees (d≤3) — not drawn until M4o.
    /* TODO(port) M4o */ todo(T_defendShipFromAttackers);
}

const T_interceptMissiles = registerTodo('M4o', 'interceptMissiles');
/** BaconBuiltObject.cs 5032 InterceptMissiles(ship, time, inView). */
export function interceptMissiles(galaxy: Galaxy, builtObject: BuiltObject, time: number, inView: boolean): void {
    /* TODO(port) M4o */ todo(T_interceptMissiles);
}

const T_attackEnemyTargets = registerTodo('M4o', 'attackEnemyTargets');
/** Habitat.cs 2640 AttackEnemyTargets(time). */
export function attackEnemyTargets(galaxy: Galaxy, habitat: Habitat, time: number): void {
    // RND: draws in callees (d≤3) — not drawn until M4o.
    /* TODO(port) M4o */ todo(T_attackEnemyTargets);
}
