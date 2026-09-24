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
