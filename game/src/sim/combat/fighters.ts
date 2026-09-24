// M4p — fighters and carriers.
//
// Stubs created by M4a (tasks/M4-plan.md §3.1): the tick skeletons in src/sim/tick/ call these entry points in C#
// order. Each is a no-op that does NOT draw Galaxy.Rnd (a `RND:` note marks C# draw sites that are skipped until the
// owning package ports the body) and records a TODO hit (tick/todo.ts). The owning package replaces the bodies in
// place, keeping the signatures (or adjusting the skeleton call in the same change).

import type { Galaxy } from '../galaxy';
import type { BuiltObject } from '../builtObject';
import { registerTodo, todo } from '../tick/todo';

const T_fighterDoTasks = registerTodo('M4p', 'fighterDoTasks');
/** Fighter.cs 256 DoTasks(galaxy, time, inView) → BaconFighter.cs 155 DoTasks. */
export function fighterDoTasks(galaxy: Galaxy, fighter: unknown, time: number, inView: boolean): void {
    // RND: draws in callees (d≤3), +clock — not drawn until M4p.
    /* TODO(port) M4p */ todo(T_fighterDoTasks);
}

const T_launchAllFighters = registerTodo('M4p', 'launchAllFighters');
/** BuiltObject.cs 1818 LaunchAllFighters. */
export function launchAllFighters(galaxy: Galaxy, builtObject: BuiltObject): void {
    // RND: draws in callees (d≤3) — not drawn until M4p.
    /* TODO(port) M4p */ todo(T_launchAllFighters);
}

const T_checkFightersNeedUpgrading = registerTodo('M4p', 'checkFightersNeedUpgrading');
/** BuiltObject.cs 3548 / BaconBuiltObject.cs 5308 CheckFightersNeedUpgrading. */
export function checkFightersNeedUpgrading(galaxy: Galaxy, builtObject: BuiltObject): void {
    // RND: +clock×3 — not drawn until M4p.
    /* TODO(port) M4p */ todo(T_checkFightersNeedUpgrading);
}

const T_buildNewFighters = registerTodo('M4p', 'buildNewFighters');
/** BuiltObject.cs 1896 / BaconBuiltObject.cs 3151 BuildNewFighters. */
export function buildNewFighters(galaxy: Galaxy, builtObject: BuiltObject): void {
    /* TODO(port) M4p */ todo(T_buildNewFighters);
}

const T_manufactureRepairFighters = registerTodo('M4p', 'manufactureRepairFighters');
/** BuiltObject.cs 1901 / BaconBuiltObject.cs 3241 ManufactureRepairFighters(timePassed). */
export function manufactureRepairFighters(galaxy: Galaxy, builtObject: BuiltObject, timePassed: number): void {
    /* TODO(port) M4p */ todo(T_manufactureRepairFighters);
}

const T_fireAtNearbyFighters = registerTodo('M4p', 'fireAtNearbyFighters');
/** BuiltObject.cs 4274 FireAtNearbyFighters(time, inView). */
export function fireAtNearbyFighters(galaxy: Galaxy, builtObject: BuiltObject, time: number, inView: boolean): void {
    // RND: draws in callees (d≤3) — not drawn until M4p.
    /* TODO(port) M4p */ todo(T_fireAtNearbyFighters);
}
