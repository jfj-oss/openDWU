// M4t — visibility, exploration, scanning, territory scheduling.
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

const T_clearExpiredViewableEmpires = registerTodo('M4t', 'clearExpiredViewableEmpires');
/** Empire.2.cs 3918 ClearExpiredViewableEmpires. */
export function clearExpiredViewableEmpires(galaxy: Galaxy, empire: Empire): void {
    /* TODO(port) M4t */ todo(T_clearExpiredViewableEmpires);
}

const T_updateSystemExplorationStatus = registerTodo('M4t', 'updateSystemExplorationStatus');
/** Empire.2.cs 3880 UpdateSystemExplorationStatus. */
export function updateSystemExplorationStatus(galaxy: Galaxy, empire: Empire): void {
    /* TODO(port) M4t */ todo(T_updateSystemExplorationStatus);
}

const T_checkKnownPirateBases = registerTodo('M4t', 'checkKnownPirateBases');
/** Empire.1.cs 979 CheckKnownPirateBases. */
export function checkKnownPirateBases(galaxy: Galaxy, empire: Empire): void {
    /* TODO(port) M4t */ todo(T_checkKnownPirateBases);
}

const T_mergeGalaxyMapsForSharedVisibilityEmpires = registerTodo('M4t', 'mergeGalaxyMapsForSharedVisibilityEmpires');
/** Empire.1.cs 1060 MergeGalaxyMapsForSharedVisibilityEmpires (per-pair merge = visibility.ts mergeGalaxyMap). */
export function mergeGalaxyMapsForSharedVisibilityEmpires(galaxy: Galaxy, empire: Empire): void {
    // RND: draws in callees (d≤3) — not drawn until M4t.
    /* TODO(port) M4t */ todo(T_mergeGalaxyMapsForSharedVisibilityEmpires);
}

const T_mergeKnownPirateBasesForSharedVisibilityEmpires = registerTodo('M4t', 'mergeKnownPirateBasesForSharedVisibilityEmpires');
/** Empire.1.cs 1072 MergeKnownPirateBasesForSharedVisibilityEmpires. */
export function mergeKnownPirateBasesForSharedVisibilityEmpires(galaxy: Galaxy, empire: Empire): void {
    /* TODO(port) M4t */ todo(T_mergeKnownPirateBasesForSharedVisibilityEmpires);
}

const T_exertCulturalInfluence = registerTodo('M4t', 'exertCulturalInfluence');
/** Empire.cs 4734 ExertCulturalInfluence. */
export function exertCulturalInfluence(galaxy: Galaxy, empire: Empire): void {
    // RND: 1 direct — not drawn until M4t.
    /* TODO(port) M4t */ todo(T_exertCulturalInfluence);
}

const T_scanArea = registerTodo('M4t', 'scanArea');
/** BuiltObject.1.cs 2034 ScanArea(galaxy). */
export function scanArea(galaxy: Galaxy, builtObject: BuiltObject): void {
    // RND: 2 direct, +clock×1 — not drawn until M4t.
    /* TODO(port) M4t */ todo(T_scanArea);
}

const T_scanForLocations = registerTodo('M4t', 'scanForLocations');
/** BuiltObject.1.cs 1935 ScanForLocations. */
export function scanForLocations(galaxy: Galaxy, builtObject: BuiltObject): void {
    /* TODO(port) M4t */ todo(T_scanForLocations);
}

const T_reviewSystemVisibilityForPreWarpShip = registerTodo('M4t', 'reviewSystemVisibilityForPreWarpShip');
/** BuiltObject.cs 3855 ReviewSystemVisibilityForPreWarpShip. */
export function reviewSystemVisibilityForPreWarpShip(galaxy: Galaxy, builtObject: BuiltObject): void {
    /* TODO(port) M4t */ todo(T_reviewSystemVisibilityForPreWarpShip);
}

const T_checkForShipsDiscoveringRuins = registerTodo('M4t', 'checkForShipsDiscoveringRuins');
/** Habitat.cs 2504 CheckForShipsDiscoveringRuins. */
export function checkForShipsDiscoveringRuins(galaxy: Galaxy, habitat: Habitat): void {
    // RND: draws in callees (d≤3) — not drawn until M4t.
    /* TODO(port) M4t */ todo(T_checkForShipsDiscoveringRuins);
}

const T_checkForShipsOfNewEmpiresInSystem = registerTodo('M4t', 'checkForShipsOfNewEmpiresInSystem');
/** Habitat.cs 2615 CheckForShipsOfNewEmpiresInSystem(galaxy, time). */
export function checkForShipsOfNewEmpiresInSystem(galaxy: Galaxy, habitat: Habitat, time: number): void {
    /* TODO(port) M4t */ todo(T_checkForShipsOfNewEmpiresInSystem);
}

const T_reviewEmpireTerritorySystemsOnly = registerTodo('M4t', 'reviewEmpireTerritorySystemsOnly');
/** Galaxy.cs 3376 ReviewEmpireTerritory(onlySystems: true) → 3384 ReviewEmpireTerritoryCore(true) (ThreadPool in C#, synchronous in TS); territory.ts has only the full rebuild. */
export function reviewEmpireTerritorySystemsOnly(galaxy: Galaxy): void {
    /* TODO(port) M4t */ todo(T_reviewEmpireTerritorySystemsOnly);
}
