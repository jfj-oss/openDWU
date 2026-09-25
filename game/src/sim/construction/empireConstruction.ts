// M4i — empire construction AI (designs, retirement, defensive bases, monitoring stations).
//
// Stubs created by M4a (tasks/M4-plan.md §3.1): the tick skeletons in src/sim/tick/ call these entry points in C#
// order. Each is a no-op that does NOT draw Galaxy.Rnd (a `RND:` note marks C# draw sites that are skipped until the
// owning package ports the body) and records a TODO hit (tick/todo.ts). The owning package replaces the bodies in
// place, keeping the signatures (or adjusting the skeleton call in the same change).

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import type { BuiltObject } from '../builtObject';
import type { Habitat } from '../types';
import type { BuiltObjectSubRole } from '../builtObjectTypes';
import { registerTodo, todo } from '../tick/todo';

const T_reviewDesignsAndRetrofit = registerTodo('M4i', 'reviewDesignsAndRetrofit');
/** Empire.1.cs 3403 ReviewDesignsAndRetrofit. */
export function reviewDesignsAndRetrofit(galaxy: Galaxy, empire: Empire): void {
    // RND: draws in callees (d≤3), +clock×1 — not drawn until M4i.
    /* TODO(port) M4i */ todo(T_reviewDesignsAndRetrofit);
}

const T_reviewLatestDesigns = registerTodo('M4i', 'reviewLatestDesigns');
/** Empire.10.cs 3065 ReviewLatestDesigns. */
export function reviewLatestDesigns(galaxy: Galaxy, empire: Empire): void {
    /* TODO(port) M4i */ todo(T_reviewLatestDesigns);
}

const T_directConstruction = registerTodo('M4i', 'directConstruction');
/** Empire.6.cs 2373 DirectConstruction. */
export function directConstruction(galaxy: Galaxy, empire: Empire): void {
    // RND: draws in callees (d≤3) — not drawn until M4i.
    /* TODO(port) M4i */ todo(T_directConstruction);
}

const T_retireOldBuiltObjects = registerTodo('M4i', 'retireOldBuiltObjects');
/** Empire.6.cs 587 RetireOldBuiltObjects. */
export function retireOldBuiltObjects(galaxy: Galaxy, empire: Empire): void {
    // RND: draws in callees (d≤3), +clock×3 — not drawn until M4i.
    /* TODO(port) M4i */ todo(T_retireOldBuiltObjects);
}

const T_buildDefensiveBases = registerTodo('M4i', 'buildDefensiveBases');
/** Empire.10.cs 1211 BuildDefensiveBases. */
export function buildDefensiveBases(galaxy: Galaxy, empire: Empire): void {
    // RND: 1 direct — not drawn until M4i.
    /* TODO(port) M4i */ todo(T_buildDefensiveBases);
}

const T_determineMonitoringStationLocation = registerTodo('M4i', 'determineMonitoringStationLocation');
/** Empire.5.cs 3769 DetermineMonitoringStationLocation. */
export function determineMonitoringStationLocation(galaxy: Galaxy, empire: Empire): void {
    // RND: 1 direct — not drawn until M4i.
    /* TODO(port) M4i */ todo(T_determineMonitoringStationLocation);
}

// ---- stubs added by M4b (called from missions/assign.ts) ----

const T_assignRetrofitMission = registerTodo('M4i', 'assignRetrofitMission');
/** Empire.5.cs 126 AssignRetrofitMission(ship) — stub. */
export function assignRetrofitMission(galaxy: Galaxy, empire: Empire, ship: BuiltObject): void {
    /* TODO(port) M4i */ todo(T_assignRetrofitMission);
}

const T_determineHabitatsWithBasesIncludingBuilding = registerTodo('M4i', 'determineHabitatsWithBasesIncludingBuilding');
/** Empire.4.cs 2171 DetermineHabitatsWithBasesIncludingBuilding(subRoles) — stub: []. */
export function determineHabitatsWithBasesIncludingBuilding(galaxy: Galaxy, empire: Empire, subRoles: readonly BuiltObjectSubRole[]): Habitat[] {
    /* TODO(port) M4i */ todo(T_determineHabitatsWithBasesIncludingBuilding);
    return [];
}

const T_determineHabitatsBeingMinedIncludingBuildingMiningStations = registerTodo('M4i', 'determineHabitatsBeingMinedIncludingBuildingMiningStations');
/** Empire.4.cs 2214 DetermineHabitatsBeingMinedIncludingBuildingMiningStations(includeMiningShips) — stub: []. */
export function determineHabitatsBeingMinedIncludingBuildingMiningStations(galaxy: Galaxy, empire: Empire, includeMiningShips: boolean): Habitat[] {
    /* TODO(port) M4i */ todo(T_determineHabitatsBeingMinedIncludingBuildingMiningStations);
    return [];
}

// ---- stubs added by M4h (called from missions/cmdConstruction.ts) ----

const T_obtainBuildResourcesForConstructionShip = registerTodo('M4i', 'obtainBuildResourcesForConstructionShip');
/**
 * Empire.6.cs 842 ObtainBuildResourcesForConstructionShip(constructionShip, newBuiltObject): clears the construction
 * ship's cargo reservations, ProcureConstructionComponents (component wait queue on its ManufacturingQueue, M4g) and
 * CreateOrder(ConstructionShortageMobile) per missing resource (M4d) — stub.
 */
export function obtainBuildResourcesForConstructionShip(galaxy: Galaxy, empire: Empire, constructionShip: BuiltObject, newBuiltObject: BuiltObject): void {
    /* TODO(port) M4i */ todo(T_obtainBuildResourcesForConstructionShip);
}

// ---- stub added by M4u (Habitat.cs 5424 CheckHabitatIsEmpire: a new empire secures its fuel / strategic supply) ----

const T_ensureStrategicResourceSupply = registerTodo('M4i', 'ensureStrategicResourceSupply');
/**
 * Empire.6.cs 1656 EnsureStrategicResourceSupply: ForceResourceSupply / CheckResourceSupply per fuel resource, then
 * construction ships are sent to build mining stations at the chosen habitats — stub.
 */
export function ensureStrategicResourceSupply(galaxy: Galaxy, empire: Empire): void {
    // RND: draws in callees (ForceResourceSupply / mission assignment) — not drawn until M4i.
    /* TODO(port) M4i */ todo(T_ensureStrategicResourceSupply);
}
