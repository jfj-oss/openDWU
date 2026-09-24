// M4d — colony consumption and independent colony fuel.
//
// Stubs created by M4a (tasks/M4-plan.md §3.1): the tick skeletons in src/sim/tick/ call these entry points in C#
// order. Each is a no-op that does NOT draw Galaxy.Rnd (a `RND:` note marks C# draw sites that are skipped until the
// owning package ports the body) and records a TODO hit (tick/todo.ts). The owning package replaces the bodies in
// place, keeping the signatures (or adjusting the skeleton call in the same change).

import type { Galaxy } from '../galaxy';
import type { Habitat } from '../types';
import { registerTodo, todo } from '../tick/todo';

const T_maintainIndependentColonyFuelLevels = registerTodo('M4d', 'maintainIndependentColonyFuelLevels');
/** Galaxy.cs 1682 MaintainIndependentColonyFuelLevels. */
export function maintainIndependentColonyFuelLevels(galaxy: Galaxy): void {
    /* TODO(port) M4d */ todo(T_maintainIndependentColonyFuelLevels);
}

const T_consumeResources = registerTodo('M4d', 'consumeResources');
/** Habitat.cs 2758 ConsumeResources(timePassed). */
export function consumeResources(galaxy: Galaxy, habitat: Habitat, timePassed: number): void {
    /* TODO(port) M4d */ todo(T_consumeResources);
}

const T_consumeAndOrderStrategicResourceSupply = registerTodo('M4d', 'consumeAndOrderStrategicResourceSupply');
/** Habitat.cs 7293 ConsumeAndOrderStrategicResourceSupply(timePassed). */
export function consumeAndOrderStrategicResourceSupply(galaxy: Galaxy, habitat: Habitat, timePassed: number): void {
    /* TODO(port) M4d */ todo(T_consumeAndOrderStrategicResourceSupply);
}
