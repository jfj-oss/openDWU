// M4h — construction queues and yards.
//
// Stubs created by M4a (tasks/M4-plan.md §3.1): the tick skeletons in src/sim/tick/ call these entry points in C#
// order. Each is a no-op that does NOT draw Galaxy.Rnd (a `RND:` note marks C# draw sites that are skipped until the
// owning package ports the body) and records a TODO hit (tick/todo.ts). The owning package replaces the bodies in
// place, keeping the signatures (or adjusting the skeleton call in the same change).

import type { Galaxy } from '../galaxy';
import type { Habitat } from '../types';
import type { BuiltObject } from '../builtObject';
import { registerTodo, todo } from '../tick/todo';

const T_doConstruction = registerTodo('M4h', 'doConstruction');
/** ConstructionQueue.cs 1196 DoConstruction(galaxy, time). */
export function doConstruction(galaxy: Galaxy, habitat: Habitat, time: number): void {
    // RND: 1 direct — not drawn until M4h.
    /* TODO(port) M4h */ todo(T_doConstruction);
}

const T_reviewConstructionSpeed = registerTodo('M4h', 'reviewConstructionSpeed');
/** ConstructionQueue.cs 66 / BaconConstructionQueue.cs 45 ReviewConstructionSpeed. */
export function reviewConstructionSpeed(galaxy: Galaxy, habitat: Habitat): void {
    /* TODO(port) M4h */ todo(T_reviewConstructionSpeed);
}

// Stubs added by M4g for BuiltObject.IndustrialProcessing (BuiltObject.2.cs 8120-8127), which drives a built
// object's own yard queue. `bo.constructionQueue` stays null until M4h creates it in ReDefine.
const T_doConstructionBuiltObject = registerTodo('M4h', 'doConstructionBuiltObject');
/** ConstructionQueue.cs 1196 DoConstruction(galaxy, time) on a built object's ConstructionQueue. */
export function doConstructionBuiltObject(galaxy: Galaxy, builtObject: BuiltObject, time: number): void {
    // RND: 1 direct — not drawn until M4h.
    /* TODO(port) M4h */ todo(T_doConstructionBuiltObject);
}

const T_resetProcessTime = registerTodo('M4h', 'resetProcessTime');
/** ConstructionQueue.ResetProcessTime(time) on a built object's ConstructionQueue (BuiltObject.2.cs 8127). */
export function resetProcessTimeBuiltObject(galaxy: Galaxy, builtObject: BuiltObject, time: number): void {
    /* TODO(port) M4h */ todo(T_resetProcessTime);
}
