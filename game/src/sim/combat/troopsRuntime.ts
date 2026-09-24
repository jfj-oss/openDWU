// M4q — troop recruitment/disbanding, healing, garrison pickup, troop missions.
//
// Stubs created by M4a (tasks/M4-plan.md §3.1): the tick skeletons in src/sim/tick/ call these entry points in C#
// order. Each is a no-op that does NOT draw Galaxy.Rnd (a `RND:` note marks C# draw sites that are skipped until the
// owning package ports the body) and records a TODO hit (tick/todo.ts). The owning package replaces the bodies in
// place, keeping the signatures (or adjusting the skeleton call in the same change).

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import type { BuiltObject } from '../builtObject';
import type { Habitat } from '../types';
import type { ShipGroup } from '../fleets/shipGroup';
import { registerTodo, todo } from '../tick/todo';

const T_recruitAttackTroops = registerTodo('M4q', 'recruitAttackTroops');
/** Empire.4.cs 3908 RecruitAttackTroops. */
export function recruitAttackTroops(galaxy: Galaxy, empire: Empire): void {
    /* TODO(port) M4q */ todo(T_recruitAttackTroops);
}

const T_disbandExcessTroops = registerTodo('M4q', 'disbandExcessTroops');
/** Empire.4.cs 1627 DisbandExcessTroops. */
export function disbandExcessTroops(galaxy: Galaxy, empire: Empire): void {
    /* TODO(port) M4q */ todo(T_disbandExcessTroops);
}

const T_healTroops = registerTodo('M4q', 'healTroops');
/** BuiltObject.cs 4047 HealTroops(timePassed). */
export function healTroops(galaxy: Galaxy, builtObject: BuiltObject, timePassed: number): void {
    /* TODO(port) M4q */ todo(T_healTroops);
}

const T_independentColoniesRecruitAndTrainTroops = registerTodo('M4q', 'independentColoniesRecruitAndTrainTroops');
/** Habitat.cs 2914 IndependentColoniesRecruitAndTrainTroops(timePassed). */
export function independentColoniesRecruitAndTrainTroops(galaxy: Galaxy, habitat: Habitat, timePassed: number): void {
    /* TODO(port) M4q */ todo(T_independentColoniesRecruitAndTrainTroops);
}

const T_clearTroopsAwaitingPickup = registerTodo('M4q', 'clearTroopsAwaitingPickup');
/** Habitat.cs 2599 ClearTroopsAwaitingPickup. */
export function clearTroopsAwaitingPickup(galaxy: Galaxy, habitat: Habitat): void {
    /* TODO(port) M4q */ todo(T_clearTroopsAwaitingPickup);
}

const T_checkAssignUnloadTroopsAtColonyNeedingThemMission = registerTodo('M4q', 'checkAssignUnloadTroopsAtColonyNeedingThemMission');
/** Empire.5.cs 727 CheckAssignUnloadTroopsAtColonyNeedingThemMission(fleet). */
export function checkAssignUnloadTroopsAtColonyNeedingThemMission(galaxy: Galaxy, empire: Empire, shipGroup: ShipGroup): boolean {
    /* TODO(port) M4q */ todo(T_checkAssignUnloadTroopsAtColonyNeedingThemMission);
    return false;
}

const T_loadTroopsIfNecessaryAndPossible = registerTodo('M4q', 'loadTroopsIfNecessaryAndPossible');
/** ShipGroup.cs 124 LoadTroopsIfNecessaryAndPossible. */
export function loadTroopsIfNecessaryAndPossible(galaxy: Galaxy, shipGroup: ShipGroup): void {
    // RND: Next(0,2) per eligible ship — not drawn until M4q.
    /* TODO(port) M4q */ todo(T_loadTroopsIfNecessaryAndPossible);
}

const T_baconHabitatHandlePrisoners = registerTodo('M4q', 'baconHabitatHandlePrisoners');
/**
 * BaconHabitat.cs 575 HandlePlayerPrisoners / 608 HandleAIPrisoners (captured spies, BaconValues "capturedSpies"; clock
 * Randoms only). Added by M4j (BaconHabitat.HugeProcessingSpanActions, colonyTick.ts).
 */
export function baconHabitatHandlePrisoners(galaxy: Galaxy, habitat: Habitat, isPlayer: boolean): void {
    /* TODO(port) M4q */ todo(T_baconHabitatHandlePrisoners);
}
