// M4d — colony consumption and independent colony fuel.
//
// Stubs created by M4a (tasks/M4-plan.md §3.1): the tick skeletons in src/sim/tick/ call these entry points in C#
// order. Each is a no-op that does NOT draw Galaxy.Rnd (a `RND:` note marks C# draw sites that are skipped until the
// owning package ports the body) and records a TODO hit (tick/todo.ts). The owning package replaces the bodies in
// place, keeping the signatures (or adjusting the skeleton call in the same change).

import type { Galaxy } from '../galaxy';
import type { Habitat } from '../types';
import type { Empire } from '../empire';
import type { BuiltObject } from '../builtObject';
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

// ---- Added by M4j: the order-side parts of Empire.4.cs EvaluateColonyVariables (2943) / EvaluateColonyVariablesPirate
// (2579). None of them draws Galaxy.Rnd; none affects the growth / development state M4j computes.

const T_prepareColonyLuxuryResourceLists = registerTodo('M4d', 'prepareColonyLuxuryResourceLists');
/**
 * Empire.4.cs 2958-2982 (2589-2613 pirate): resourceList = Galaxy.ShowCheapestLuxuryResources(), resourceList2/3 =
 * ShowAvailableRestrictedResourcesForEmpire(SelfSupplied)(this), `_SelfSuppliedLuxuryResources ??= new ResourceList()`,
 * then the self-supplied-first / unavailable-last reorder. Returns an opaque bundle for orderColonyLuxuryResources.
 */
export function prepareColonyLuxuryResourceLists(galaxy: Galaxy, empire: Empire): unknown {
    /* TODO(port) M4d */ todo(T_prepareColonyLuxuryResourceLists);
    return null;
}

const T_maintainColonyCriticalResourceLevels = registerTodo('M4d', 'maintainColonyCriticalResourceLevels');
/** Empire.MaintainColonyCriticalResourceLevels(spacePort, colony) (called when _ControlColonyStockLevels). */
export function maintainColonyCriticalResourceLevels(galaxy: Galaxy, empire: Empire, spacePort: BuiltObject | null, colony: Habitat): void {
    /* TODO(port) M4d */ todo(T_maintainColonyCriticalResourceLevels);
}

const T_maintainColonyResourceLevels = registerTodo('M4d', 'maintainColonyResourceLevels');
/** Empire.MaintainColonyResourceLevels(spacePort, colony) (called when _ControlColonyStockLevels). */
export function maintainColonyResourceLevels(galaxy: Galaxy, empire: Empire, spacePort: BuiltObject | null, colony: Habitat): void {
    /* TODO(port) M4d */ todo(T_maintainColonyResourceLevels);
}

const T_calculateMaximumOrderFulfillmentDistance = registerTodo('M4d', 'calculateMaximumOrderFulfillmentDistance');
/** Galaxy.CalculateMaximumOrderFulfillmentDistance(habitat). */
export function calculateMaximumOrderFulfillmentDistance(galaxy: Galaxy, habitat: Habitat): void {
    /* TODO(port) M4d */ todo(T_calculateMaximumOrderFulfillmentDistance);
}

const T_orderColonyLuxuryResources = registerTodo('M4d', 'orderColonyLuxuryResources');
/**
 * Empire.4.cs 3183-3301 (2814-2932 pirate): OrderList orders = Galaxy.Orders.GetOrders(habitat) (+ the space port's),
 * CheckResourcesMeetingMinimumLevel(Luxury, num6 = habitat.CalculateMinimumLuxuryResourceLevel()), and when
 * _ControlColonyDevelopment the luxury / restricted (num7 = CalculateMinimumLuxuryResourceLevelRestricted()) CreateOrder
 * loop. `lists` is prepareColonyLuxuryResourceLists' result.
 */
export function orderColonyLuxuryResources(galaxy: Galaxy, empire: Empire, habitat: Habitat, spacePort: BuiltObject | null, lists: unknown): void {
    /* TODO(port) M4d */ todo(T_orderColonyLuxuryResources);
}
