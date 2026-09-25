// M4m — military AI (objectives, fleet tasking, threats response, UI fleet warnings).
//
// Stubs created by M4a (tasks/M4-plan.md §3.1): the tick skeletons in src/sim/tick/ call these entry points in C#
// order. Each is a no-op that does NOT draw Galaxy.Rnd (a `RND:` note marks C# draw sites that are skipped until the
// owning package ports the body) and records a TODO hit (tick/todo.ts). The owning package replaces the bodies in
// place, keeping the signatures (or adjusting the skeleton call in the same change).

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import type { BuiltObject } from '../builtObject';
import type { Habitat } from '../types';
import type { ShipGroup } from './shipGroup';
import type { StellarObject } from '../missions/mission';
import type { FuelTypeRef } from '../movement';
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

// ---- stubs added by M4b (called from missions/*.ts) ----

const T_implementBlockade = registerTodo('M4m', 'implementBlockade');
/** Empire.ImplementBlockade(BuiltObject | Habitat target, bool, bool) — stub. */
export function implementBlockade(galaxy: Galaxy, empire: Empire, target: BuiltObject | Habitat, arg2: boolean, arg3: boolean): void {
    /* TODO(port) M4m */ todo(T_implementBlockade);
}

const T_identifyNearestResponseFleet = registerTodo('M4m', 'identifyNearestResponseFleet');
/** Empire.3.cs 5182 IdentifyNearestResponseFleet(x, y, mustBeWithinFuelRange, fuelPortionMargin, excludeRange) — stub: null (no fleet responds). */
export function identifyNearestResponseFleet(galaxy: Galaxy, empire: Empire, x: number, y: number, mustBeWithinFuelRange: boolean, fuelPortionMargin: number, excludeRange: number): ShipGroup | null {
    /* TODO(port) M4m */ todo(T_identifyNearestResponseFleet);
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

// ---- stubs added by M4e (logistics/docking.ts CheckMissionStillValid, BuiltObject.1.cs 4527-4600; the C# block that
// reads them is unreachable, see checkMissionStillValid) ----

const T_galaxyBlockadeFor = registerTodo('M4m', 'galaxyBlockadeFor');
/** Galaxy.Blockades[target] (BlockadeList.cs 14/28 indexers) — stub: null (no Blockade model before M4m). */
export function galaxyBlockadeFor(galaxy: Galaxy, target: BuiltObject | Habitat): { initiator: Empire | null } | null {
    /* TODO(port) M4m */ todo(T_galaxyBlockadeFor);
    return null;
}

const T_determineBuiltObjectStrengthAtLocation = registerTodo('M4m', 'determineBuiltObjectStrengthAtLocation');
/** Galaxy.7.cs 117 DetermineBuiltObjectStrengthAtLocation(x, y, empire, unarmedStrength, includeAllies, out ships) — stub: 0. */
export function determineBuiltObjectStrengthAtLocation(galaxy: Galaxy, x: number, y: number, empire: Empire | null, unarmedStrength: number, includeAllies: boolean): number {
    /* TODO(port) M4m */ todo(T_determineBuiltObjectStrengthAtLocation);
    return 0;
}

const T_calculateCautionFactor = registerTodo('M4m', 'calculateCautionFactor');
/** Empire.2.cs 4380 CalculateCautionFactor() — stub: 1.0. */
export function calculateCautionFactor(galaxy: Galaxy, empire: Empire): number {
    /* TODO(port) M4m */ todo(T_calculateCautionFactor);
    return 1.0;
}

// ---- Stubs added by M4l (callees of ShipGroup.cs / MaintainShipGroups; fleet tasking owned by M4m) ----

const T_assignFleetRefuelling = registerTodo('M4m', 'assignFleetRefuelling');
/**
 * Empire.9.cs 672 AssignFleetRefuelling(refuelFleet, requiredFuel) (DecideBestFleetRefuelPoint 265 + ShipGroup.AssignMission
 * Refuel) — stub: false (the fleet is not sent to refuel). Called by ShipGroup.CheckForMissionCompletion / CheckRefuelRepairAttack.
 */
export function assignFleetRefuelling(galaxy: Galaxy, empire: Empire, refuelFleet: ShipGroup, requiredFuel: FuelTypeRef[]): boolean {
    // RND: ShipGroup.AssignMission(Refuel) → per-ship SelectRelativePoint + ResolveCommandsForMission — not drawn until M4m.
    /* TODO(port) M4m */ todo(T_assignFleetRefuelling);
    return false;
}

const T_coordinateFleetAttacksWithAllies = registerTodo('M4m', 'coordinateFleetAttacksWithAllies');
/** Empire.1.cs 3730 CoordinateFleetAttacksWithAllies(fleet) — stub: false. Called by ShipGroup.CheckRefuelRepairAttack. */
export function coordinateFleetAttacksWithAllies(galaxy: Galaxy, empire: Empire, fleet: ShipGroup): boolean {
    // RND: fleet.AssignMission(Attack) in the 3-argument overload — not drawn until M4m.
    /* TODO(port) M4m */ todo(T_coordinateFleetAttacksWithAllies);
    return false;
}

const T_coordinateFleetAttacksWithAlliesOf = registerTodo('M4m', 'coordinateFleetAttacksWithAlliesOf');
/** Empire.1.cs 3750 CoordinateFleetAttacksWithAllies(fleet, empire, enemies) — stub: false. Called by ShipGroup.CheckRefuelRepairAttack. */
export function coordinateFleetAttacksWithAlliesOf(galaxy: Galaxy, self: Empire, fleet: ShipGroup, empire: Empire, enemies: Empire[] | null): boolean {
    // RND: fleet.AssignMission(Attack) — not drawn until M4m.
    /* TODO(port) M4m */ todo(T_coordinateFleetAttacksWithAlliesOf);
    return false;
}

const T_selectFleetWarAttackTarget = registerTodo('M4m', 'selectFleetWarAttackTarget');
/** Empire.8.cs 1146 SelectFleetWarAttackTarget(fleet, otherEmpire, out waypointing) — stub: no target, not waypointing. */
export function selectFleetWarAttackTarget(galaxy: Galaxy, empire: Empire, fleet: ShipGroup, otherEmpire: Empire): { target: StellarObject | null; waypointing: boolean } {
    // RND: waypoint / gather missions in callees — not drawn until M4m.
    /* TODO(port) M4m */ todo(T_selectFleetWarAttackTarget);
    return { target: null, waypointing: false };
}

const T_checkBombardEnemyColony = registerTodo('M4m', 'checkBombardEnemyColony');
/** Empire.8.cs 4504 CheckBombardEnemyColony(enemyColony, attackFleet) — stub: false (attack, not bombard). */
export function checkBombardEnemyColony(galaxy: Galaxy, empire: Empire, enemyColony: Habitat, attackFleet: ShipGroup): boolean {
    /* TODO(port) M4m */ todo(T_checkBombardEnemyColony);
    return false;
}

const T_identifyEmpireStrikePoints = registerTodo('M4m', 'identifyEmpireStrikePoints');
/** Empire.9.cs 3704 IdentifyEmpireStrikePoints(empire) → PrioritizedTargetList — stub: empty list. */
export function identifyEmpireStrikePoints(galaxy: Galaxy, empire: Empire, targetEmpire: Empire): unknown[] {
    /* TODO(port) M4m */ todo(T_identifyEmpireStrikePoints);
    return [];
}

const T_assignFleetAttackMission = registerTodo('M4m', 'assignFleetAttackMission');
/** Empire.8.cs 4521 AssignFleetAttackMission(fleet, ref targets, ref refusalCount) — stub: false (no mission assigned). */
export function assignFleetAttackMission(galaxy: Galaxy, empire: Empire, fleet: ShipGroup, targets: unknown[], refusalCount: { value: number }): boolean {
    // RND: fleet.AssignMission(Attack / Bombard / gather) — not drawn until M4m.
    /* TODO(port) M4m */ todo(T_assignFleetAttackMission);
    return false;
}

// Empire.9.cs 620/625 AssignFleetRetrofit: construction/empireConstruction.ts (M4i).

const T_selectDefensiveFleetBase = registerTodo('M4m', 'selectDefensiveFleetBase');
/** Empire.9.cs 2007 SelectDefensiveFleetBase(fleet, defendLocations, moveToLocationIfAvailable) — stub: null. */
export function selectDefensiveFleetBase(galaxy: Galaxy, empire: Empire, fleet: ShipGroup, defendLocations: StellarObject[], moveToLocationIfAvailable: boolean): StellarObject | null {
    /* TODO(port) M4m */ todo(T_selectDefensiveFleetBase);
    return null;
}

const T_ensureSingleStellarObjectPerSystem = registerTodo('M4m', 'ensureSingleStellarObjectPerSystem');
/** Galaxy.7.cs 579 EnsureSingleStellarObjectPerSystem(stellarObjects) (needs Habitat.StrategicValue / StellarObject.SortStellarObject) — stub: the list unchanged. */
export function ensureSingleStellarObjectPerSystem(galaxy: Galaxy, stellarObjects: StellarObject[]): StellarObject[] {
    /* TODO(port) M4m */ todo(T_ensureSingleStellarObjectPerSystem);
    return stellarObjects;
}

// ---- stub added by M4q (Empire.4.cs 4449 InvadeUnwillingColonizationTargets) ----

const T_findNearestAvailableFleet = registerTodo('M4m', 'findNearestAvailableFleet');
/**
 * Empire.9.cs 1457-1492 FindNearestAvailableFleet(x, y, maximumPriority, overallStrength, posture[, mustBeWithinFuelRange,
 * fuelPortionMargin, mustBeAutomated, shouldBeSmallFleet, gatherPointMustBeBlank, mustBeWithinPostureRange,
 * minimumTroopStrength, minimumBoardingStrength]) — stub: null (no fleet). No Rnd in the C#.
 */
export function findNearestAvailableFleet(
    galaxy: Galaxy,
    empire: Empire,
    x: number,
    y: number,
    maximumPriority: number,
    overallStrength: number,
    posture: number,
    mustBeWithinFuelRange = false,
    fuelPortionMargin = 0.0,
    mustBeAutomated = false,
    shouldBeSmallFleet = false,
    gatherPointMustBeBlank = false,
    mustBeWithinPostureRange = false,
    minimumTroopStrength = 0,
    minimumBoardingStrength = 0,
): ShipGroup | null {
    /* TODO(port) M4m */ todo(T_findNearestAvailableFleet);
    return null;
}
