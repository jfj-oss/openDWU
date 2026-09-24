// M4m — military AI (objectives, fleet tasking, threats response, UI fleet warnings).
//
// Stubs created by M4a (tasks/M4-plan.md §3.1): the tick skeletons in src/sim/tick/ call these entry points in C#
// order. Each is a no-op that does NOT draw Galaxy.Rnd (a `RND:` note marks C# draw sites that are skipped until the
// owning package ports the body) and records a TODO hit (tick/todo.ts). The owning package replaces the bodies in
// place, keeping the signatures (or adjusting the skeleton call in the same change).

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import { registerTodo, todo } from '../tick/todo';

const T_respondToIncomingEnemyFleetsAndPlanetDestroyers = registerTodo('M4m', 'respondToIncomingEnemyFleetsAndPlanetDestroyers');
/** Empire.1.cs 3198 RespondToIncomingEnemyFleetsAndPlanetDestroyers. */
export function respondToIncomingEnemyFleetsAndPlanetDestroyers(galaxy: Galaxy, empire: Empire): void {
    // RND: draws in callees (d≤3) — not drawn until M4m.
    /* TODO(port) M4m */ todo(T_respondToIncomingEnemyFleetsAndPlanetDestroyers);
}

const T_identifyMilitaryObjectives = registerTodo('M4m', 'identifyMilitaryObjectives');
/** Empire.8.cs 4266 IdentifyMilitaryObjectives. */
export function identifyMilitaryObjectives(galaxy: Galaxy, empire: Empire): void {
    // RND: 1 direct — not drawn until M4m.
    /* TODO(port) M4m */ todo(T_identifyMilitaryObjectives);
}

const T_cancelInactiveBlockades = registerTodo('M4m', 'cancelInactiveBlockades');
/** Empire.2.cs 3938 CancelInactiveBlockades. */
export function cancelInactiveBlockades(galaxy: Galaxy, empire: Empire): void {
    /* TODO(port) M4m */ todo(T_cancelInactiveBlockades);
}

const T_taskShipGroups = registerTodo('M4m', 'taskShipGroups');
/** Empire.9.cs 1162 TaskShipGroups. */
export function taskShipGroups(galaxy: Galaxy, empire: Empire): void {
    // RND: draws in callees (d≤3) — not drawn until M4m.
    /* TODO(port) M4m */ todo(T_taskShipGroups);
}

const T_taskResupplyShips = registerTodo('M4m', 'taskResupplyShips');
/** Empire.9.cs 52 TaskResupplyShips. */
export function taskResupplyShips(galaxy: Galaxy, empire: Empire): void {
    // RND: draws in callees (d≤3) — not drawn until M4m.
    /* TODO(port) M4m */ todo(T_taskResupplyShips);
}

const T_reviewSystemThreats = registerTodo('M4m', 'reviewSystemThreats');
/** Empire.9.cs 4163 ReviewSystemThreats. */
export function reviewSystemThreats(galaxy: Galaxy, empire: Empire): void {
    // RND: draws in callees (d≤3) — not drawn until M4m.
    /* TODO(port) M4m */ todo(T_reviewSystemThreats);
}

const T_checkTemptingTargets = registerTodo('M4m', 'checkTemptingTargets');
/** Empire.10.cs 913 CheckTemptingTargets. */
export function checkTemptingTargets(galaxy: Galaxy, empire: Empire): void {
    // RND: 1 direct — not drawn until M4m.
    /* TODO(port) M4m */ todo(T_checkTemptingTargets);
}

const T_sendAvailableFleetsToGuardStrategicLocations = registerTodo('M4m', 'sendAvailableFleetsToGuardStrategicLocations');
/** Empire.5.cs 1007 SendAvailableFleetsToGuardStrategicLocations. */
export function sendAvailableFleetsToGuardStrategicLocations(galaxy: Galaxy, empire: Empire): void {
    // RND: draws in callees (d≤3) — not drawn until M4m.
    /* TODO(port) M4m */ todo(T_sendAvailableFleetsToGuardStrategicLocations);
}

const T_determineRandomAttacks = registerTodo('M4m', 'determineRandomAttacks');
/** Empire.2.cs 4512 DetermineRandomAttacks. */
export function determineRandomAttacks(galaxy: Galaxy, empire: Empire): void {
    // RND: 1 direct — not drawn until M4m.
    /* TODO(port) M4m */ todo(T_determineRandomAttacks);
}

const T_warnOfIncomingEnemyFleetsAndPlanetDestroyers = registerTodo('M4m', 'warnOfIncomingEnemyFleetsAndPlanetDestroyers');
/** Empire.6.cs 1776 WarnOfIncomingEnemyFleetsAndPlanetDestroyers(empireToWarn) — UI warnings, called every frame by Main.Part12.cs 3559-3571. */
export function warnOfIncomingEnemyFleetsAndPlanetDestroyers(galaxy: Galaxy, empire: Empire, empireToWarn: Empire | null): void {
    /* TODO(port) M4m */ todo(T_warnOfIncomingEnemyFleetsAndPlanetDestroyers);
}

const T_identifyMechanoidEmpire = registerTodo('M4m', 'identifyMechanoidEmpire');
/** Galaxy.8.cs 1619 IdentifyMechanoidEmpire. */
export function identifyMechanoidEmpire(galaxy: Galaxy): Empire | null {
    /* TODO(port) M4m */ todo(T_identifyMechanoidEmpire);
    return null;
}

// ---- Stubs added by M4r (callees of the diplomacy runtime; fleet side effects owned by M4m) ----

const T_setDefendFleets = registerTodo('M4m', 'setDefendFleets');
/** Empire.9.cs 789/794 SetDefendFleets([defendingFromAttack, assignMovement]) — called by ReviewDiplomaticStrategies / DeclareWar (M4r). */
export function setDefendFleets(galaxy: Galaxy, empire: Empire, defendingFromAttack: boolean, assignMovement: boolean): void {
    /* TODO(port) M4m */ todo(T_setDefendFleets);
}

const T_clearAttackFleetAssignments = registerTodo('M4m', 'clearAttackFleetAssignments');
/** Empire.9.cs 714/719 ClearAttackFleetAssignments([targetEmpire]) — null = every attack fleet. */
export function clearAttackFleetAssignments(galaxy: Galaxy, empire: Empire, targetEmpire: Empire | null): void {
    /* TODO(port) M4m */ todo(T_clearAttackFleetAssignments);
}

const T_checkAttackFleetTargets = registerTodo('M4m', 'checkAttackFleetTargets');
/** Empire.9.cs 736 CheckAttackFleetTargets(targetEmpires). */
export function checkAttackFleetTargets(galaxy: Galaxy, empire: Empire, targetEmpires: Empire[]): void {
    /* TODO(port) M4m */ todo(T_checkAttackFleetTargets);
}

const T_sendAttackFleets = registerTodo('M4m', 'sendAttackFleets');
/** Empire.7.cs 4828 SendAttackFleets(targetEmpire) — called by DeclareWar (M4r). */
export function sendAttackFleets(galaxy: Galaxy, empire: Empire, targetEmpire: Empire): void {
    /* TODO(port) M4m */ todo(T_sendAttackFleets);
}

const T_reviewDefensiveFleetLocations = registerTodo('M4m', 'reviewDefensiveFleetLocations');
/** Empire.9.cs 1917 ReviewDefensiveFleetLocations — called by DeclareWar (M4r). */
export function reviewDefensiveFleetLocations(galaxy: Galaxy, empire: Empire): void {
    /* TODO(port) M4m */ todo(T_reviewDefensiveFleetLocations);
}

const T_sendScoutsToSingleEnemyEmpire = registerTodo('M4m', 'sendScoutsToSingleEnemyEmpire');
/** Empire.9.cs 4481 SendScoutsToSingleEnemyEmpire(enemyEmpire, availableScouts): scouts sent (MoveAndWait missions). The stub sends none. */
export function sendScoutsToSingleEnemyEmpire(galaxy: Galaxy, empire: Empire, enemyEmpire: Empire, availableScouts: number): number {
    /* TODO(port) M4m */ todo(T_sendScoutsToSingleEnemyEmpire);
    return 0;
}

const T_cancelAttackMissionsAgainstEmpire = registerTodo('M4m', 'cancelAttackMissionsAgainstEmpire');
/**
 * Empire.3.cs 3443 CancelAttacksAgainstEmpire(empire), mission part: CancelAttackMissionAgainstEmpireForSingleShip for every
 * state and private ship and CancelAttackMissionAgainstEmpireForSingleShipGroup for every fleet (the trailing
 * ClearOutlawsFromEmpire is ported in diplomacyTick.ts). Called by ProcessEndOfWarWithEmpire (M4r).
 */
export function cancelAttackMissionsAgainstEmpire(galaxy: Galaxy, empire: Empire, targetEmpire: Empire): void {
    /* TODO(port) M4m */ todo(T_cancelAttackMissionsAgainstEmpire);
}

const T_clearDefendFleets = registerTodo('M4m', 'clearDefendFleets');
/** Empire.9.cs 758 ClearDefendFleets — called by ProcessEndOfWarWithEmpire (M4r). */
export function clearDefendFleets(galaxy: Galaxy, empire: Empire): void {
    /* TODO(port) M4m */ todo(T_clearDefendFleets);
}
