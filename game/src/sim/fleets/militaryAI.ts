// M4m — military AI: objectives, fleet tasking, responses to threats, UI fleet warnings.
//
// Ports (C# file:line above each function): Empire.8.cs 4266 IdentifyMilitaryObjectives + 4845 ForSingleEmpire, 3335-3610
// AssignFleet{WaitAndAttack,GatherAttack,WaypointAttack}Mission / DetermineLatestArrivalAtDestination, 4159-4265 fleet
// counts, 4504 CheckBombardEnemyColony, 4521 AssignFleetAttackMission, 4712 SelectWayPointOnTheWay, 4755-4845
// GenerateOrderedFleets*, 1146-1420 SelectFleetWarAttackTarget / CheckFleetCanAttackTarget / CalculateDefendingStrength;
// Empire.9.cs 16 DetermineFuelRequiredForFleet, 52 TaskResupplyShips, 265 DecideBestFleetRefuelPoint, 672-903 fleet
// refuelling / attack-point / defend-fleet assignments, 1162 TaskShipGroups (+ EnsureColonyDefendedByFleet,
// FindNearest*Fleet, HuntPirates), 1917 ReviewDefensiveFleetLocations, 2007 SelectDefensiveFleetBase, 2370-2453
// IsShipGroupAvailable / FindAvailableShipGroup, 3492 GenerateDistanceOrderedFleetList, 3704 IdentifyEmpireStrikePoints,
// 3935 IdentifyThreatenedSystemsPrioritized, 4163 ReviewSystemThreats, 4481 SendScoutsToSingleEnemyEmpire;
// Empire.1.cs 3198 RespondToIncomingEnemyFleetsAndPlanetDestroyers, 3730/3750 CoordinateFleetAttacksWithAllies;
// Empire.10.cs 727-935 CheckTemptingTargets; Empire.5.cs 908-1040 SendAvailableFleetsToGuardStrategicLocations;
// Empire.2.cs 4373-4700 DetermineRandomAttacks / IdentifyDesiredForeignColonies / CalculateCautionFactor / ShouldProvoke;
// Empire.3.cs 3399-3470 CancelAttacksAgainstEmpire (mission part), 5047-5245 IdentifyNearest{Available,Response}Fleet;
// Empire.7.cs 4828 SendAttackFleets; Empire.6.cs 1776 WarnOfIncomingEnemyFleetsAndPlanetDestroyers; Galaxy.4.cs 609-700
// CheckUse{PlanetDestroyer,Bombardment}AgainstEmpire / SortEmpiresByMilitaryPriority; Galaxy.5.cs 123
// DetermineRequiredTroopStrength; Galaxy.7.cs 117 DetermineBuiltObjectStrengthAtLocation, 579 EnsureSingleStellarObjectPerSystem;
// Galaxy.8.cs 1619 IdentifyMechanoidEmpire; Galaxy.3.cs 723-760 resupply-ship destinations, 878 ObtainAvailableMilitaryShips.
// Blockades are in fleets/blockades.ts. Free functions, C# `this` first (plan §3.1 rule 2).
//
// Rnd (galaxy.rnd, C# order): IdentifyMilitaryObjectives Next(0, EmpireEvaluations.Count) (+ SendScoutShipsToEnemyLocations,
// IdentifyEmpireStrikePoints Next(0, 3) for aggressive races, ForSingleEmpire blockade rolls Next(0, 30) / Next(0, 3));
// TaskResupplyShips SelectRelativePoint (NextDouble ×2) per fuel-habitat probe, SelectRelativeParkingPoint;
// TaskShipGroups → HuntPirates Next(0, 3); ReviewSystemThreats SelectRelativeParkingPoint per ship sent; CheckTemptingTargets
// Next(0, Empires.Count), Next(0, Colonies.Count), Next(0, ConstructionShips.Count), CheckAttackTemptingTarget
// Next(0, 15) + Next(0, 3); SendAvailableFleetsToGuard Next(400000, 550000); DetermineRandomAttacks
// Next(0, EmpiresWithDesiredColonies.Count), ShouldProvoke NextDouble ×2 + Next(0, 4); plus every mission constructor
// (ResolveCommandsForMission) and ShipGroup.AssignMission these assign.
//
// Automation advisor texts (Empire.10.cs 3697-4137): only the player's semi-automated prompts read them; as in
// construction/empireConstruction.ts the GameText key stands in for the format string and enum values for
// Galaxy.ResolveDescription (TODO(port) M9 GameText formatting).

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import type { BuiltObject } from '../builtObject';
import type { Habitat } from '../types';
import type { ShipGroup } from './shipGroup';
import type { FuelTypeRef } from '../movement';
import type { EmpireEvaluation } from '../diplomacy';
import type { GalaxyLocation } from '../galaxyLocation';
import { galaxyStarDate } from '../tick/simTime';
import {
    BuiltObjectMissionPriority,
    BuiltObjectMissionType,
    CommandAction,
    BuiltObjectMission,
    builtObjectMission,
    isBuiltObject,
    isCreature,
    isHabitat,
    isShipGroup,
    type MissionTarget,
    type StellarObject,
} from '../missions/mission';
import { assignMission, initiateUndeploy, recordRevertMission } from '../missions/assign';
import { BuiltObjectRole } from '../data/designSpecifications';
import { BuiltObjectSubRole } from '../builtObjectTypes';
import { HabitatCategoryType } from '../types';
import { netSort } from '../netSort';
import { AutomationLevel } from '../empire';
import { DiplomaticRelationType, DiplomaticStrategy, WarObjective, obtainDiplomaticRelation, obtainEmpireEvaluation } from '../diplomacy';
import {
    AdvisorMessageType,
    FleetPosture,
    aggressionLevel,
    cautionLevel,
    checkTaskAuthorized,
    compareDouble,
    countEmpiresWeDeclaredWarOn,
    countEmpiresWhoDeclaredWarOnUs,
    determineEmpireDominatedSystems,
    determineFriendsAndEnemies,
    formatText,
    getText,
    identifyEmpireWarObjectives,
    sendScoutShipsToEnemyLocations,
    loyaltyLevel,
    militaryPotency,
    weightedMilitaryPotency,
    type RefCount,
} from '../diplomacyTick';
import { PirateRelationType, obtainPirateRelation } from '../pirateRelations';
import { EmpireActivityType } from '../pirates/empireActivity';
import { EmpireMessageType, sendMessageToEmpire, sendMessageToEmpireWithTitle } from '../messages';
import { isObjectVisibleToThisEmpire } from '../independentTraders';
import { arraySortKeysItems, currentRange, getNearestBuiltObjectWithinRange, sortStellarObjectsByDistance, ultraFastFindNearestRefuellingLocation, withinFuelRangeAndRefuel } from '../movement';
import {
    calculateOverallStrengthFactor,
    determineBaseStrengthAtHabitat,
    determineDefendingStrength,
    determineDefendingStrengthFleet,
    fastFindNearestColony,
    THREAT_RANGE,
    warpSpeedWithBonuses,
} from '../combat/threats';
import { checkSystemOwnershipId, determineAngle, determineDestroyOrCaptureTarget, determineSpacePortAtColony } from '../combat/attackAI';
import { clearAllMissionsForTargetEmpire } from '../combat/teardown';
import { estimatedDefensiveForceRequired, troopLevelMinimum, troopLevelRequired } from '../troops';
import { strategicValue } from '../territory';
import { colonyFillRatio } from '../pirates';
import { determineColonizationValue } from '../tradeItems';
import { identifyDeficientEmpireResources } from '../industry';
import { PrioritizedTarget, identifyColonizationTargetsFull, prioritizedTargetListAdd, sortPrioritizedTargets } from '../civilianAI';
import { HabitatPrioritization } from '../resourceTargets';
import { findNewestCanBuild } from '../designGeneration';
import { determineEmpireSystems, totalColonyStrategicValue } from '../forceStructure';
import { fastFindNearestSpacePort as fastFindNearestSpacePortOf, habitatCompareTo } from '../stationPlacement';
import { findLonelyHabitatAt } from '../gameStartTail';
import { addWarObjectivesToList, resolveLocationsToDefend } from '../characters';
import { ComponentType } from '../data/components';
import { SystemVisibilityStatus } from '../visibility';
import { GalaxyLocationEffectType, GalaxyLocationType } from '../galaxyLocation';
import {
    compareShipGroups,
    determineDestroyOrCaptureTargetForFleet,
    empireFindNearestRefuellingPoint,
    forceCompleteMission,
    identifyTargetEmpires,
    selectFleetBase,
    shipGroupAssignMission,
    shipGroupAssignMissionFull,
    shipGroupCalculateRefuellingPortion,
    shipGroupCalculateRequiredFuel,
    shipGroupCalculateTimeToArrivalAtDestination,
    shipGroupCheckFleetTargetWithinFuelRange,
    shipGroupCheckFleetTargetWithinFuelRangeAndRefuel,
    shipGroupCheckNeedGatherBeforeAttack,
    shipGroupCheckNeedRefuelBeforeAttack,
    shipGroupCheckRefuelLocationRangeAcceptable,
    shipGroupCheckShipsRequiringRefuelling,
    shipGroupClearAllMissionsForTargetEmpire,
    shipGroupCompleteMissionWith,
    shipGroupDetermineApproximateActualFleetLocation,
    shipGroupIdentifyFleetGatherLocation,
    shipGroupIdentifyFleetSystem,
    shipGroupIsShipAvailable,
    shipGroupListClearSortTags,
    shipGroupListCountLargeFleets,
    shipGroupListCountTotalOverallStrengthFactor,
    shipGroupListDetermineFleetsTravellingToLocation,
    shipGroupListResolveFleetsWithAttackTarget,
    shipGroupMaximumRange,
    shipGroupTotalBombardPower,
    shipGroupTotalFighterCount,
    shipGroupTotalOverallStrengthFactor,
    shipGroupTotalTroopAttackStrengthNearby,
    shipGroupTotalTroopDefendStrength,
    shipGroupWarpSpeed,
} from './shipGroupTasks';
import { empireShipGroups } from './shipGroup';
import {
    blockadeFor,
    cancelInactiveBlockadesImpl,
    conditionCheckLimit,
    implementBlockadeBuiltObject,
    implementBlockadeColony,
} from './blockades';

// ---------------------------------------------------------------------------------------------------------------
// Constants (Galaxy.3.cs 4972-5120 static values)
// ---------------------------------------------------------------------------------------------------------------

/** Galaxy.ParentRelativeRange (Galaxy.3.cs 4988) / HyperJumpThreshhold / EscortRange (4977). */
export const PARENT_RELATIVE_RANGE = 700;
export const HYPER_JUMP_THRESHHOLD = 12000;
export const ESCORT_RANGE = 200;
/** Galaxy.SectorSize / IndexSize. */
const SECTOR_SIZE = 100000;
const INDEX_SIZE = 400000;
/** Galaxy.MajorColonyStrategicThreshhold (5035). */
const MAJOR_COLONY_STRATEGIC_THRESHHOLD = 20000;
/** Galaxy.AttackOnPiratesRange (5060). */
const ATTACK_ON_PIRATES_RANGE = 6000000.0;
/** Galaxy.DesiredForeignColony{Strategic,Resource}Threshhold (5105-5106). */
const DESIRED_FOREIGN_COLONY_STRATEGIC_THRESHHOLD = 60;
const DESIRED_FOREIGN_COLONY_RESOURCE_THRESHHOLD = 40;
/** Galaxy.ResupplyShipMinimumDistance (5109). */
const RESUPPLY_SHIP_MINIMUM_DISTANCE = 1000000.0;
/** Galaxy.FleetAssembleAttackWaitPeriodPerShip (5116, long ms). */
const FLEET_ASSEMBLE_ATTACK_WAIT_PERIOD_PER_SHIP = 25000;
/** 2.304E+09 (48000²) — PostureRangeSquared for attack / blockade points (double). */
const POSTURE_RANGE_SQUARED_ATTACK_POINT = 2304000000.0;
/** 250000000000.0 (500000²) — PostureRangeSquared of defend fleets. */
const POSTURE_RANGE_SQUARED_DEFEND = 250000000000.0;

// ---------------------------------------------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------------------------------------------

function shipGroupsOf(empire: Empire): ShipGroup[] {
    return empireShipGroups(empire) as ShipGroup[];
}

function missionOf(bo: BuiltObject | null): BuiltObjectMission | null {
    return bo === null ? null : builtObjectMission(bo.mission);
}

function planetDestroyersOf(empire: Empire): BuiltObject[] {
    return empire.planetDestroyers as BuiltObject[];
}

function empireEvaluationsOf(empire: Empire): EmpireEvaluation[] {
    return empire.empireEvaluations as EmpireEvaluation[];
}

/** C# (long)double: truncation; a non-finite value becomes long.MinValue (x64 cvttsd2si). */
function csDoubleToLong(value: number): number {
    if (!Number.isFinite(value)) return -9223372036854775808;
    return Math.trunc(value);
}

/** C# (int)double: truncation; out-of-range / NaN → int.MinValue (x64 cvttsd2si). */
function csDoubleToInt(value: number): number {
    if (!Number.isFinite(value) || value >= 2147483648 || value <= -2147483649) return -2147483648;
    return Math.trunc(value);
}

/** Galaxy.cs 1165 IntoleranceLevel => Max(0, Min(1, 1 - ColonyFillRatio)). */
export function galaxyIntoleranceLevel(galaxy: Galaxy): number {
    return Math.max(0.0, Math.min(1.0, 1.0 - colonyFillRatio(galaxy)));
}

/** Galaxy.4.cs 3545 CalculateDistanceFactor(distance). */
export function calculateDistanceFactor(distance: number): number {
    return Math.max(1000000000.0, Math.pow(distance, 1.8)) / 1000000000.0;
}

/** Galaxy.CalculateDistanceStatic. */
function calculateDistanceStatic(x1: number, y1: number, x2: number, y2: number): number {
    const dx = x1 - x2;
    const dy = y1 - y2;
    return Math.sqrt(dy * dy + dx * dx);
}

/** EmpireList.GetByEmpireId(empireId). */
function empiresGetByEmpireId(galaxy: Galaxy, empireId: number): Empire | null {
    for (let i = 0; i < galaxy.empires.length; i++) {
        const e = galaxy.empires[i];
        if (e != null && e.empireId === empireId) return e;
    }
    return null;
}

/** Empire.9.cs 1375 CheckAtWar(). */
export function checkAtWar(self: Empire): boolean {
    for (let i = 0; i < self.diplomaticRelations.count; i++) {
        if (self.diplomaticRelations.at(i).type === DiplomaticRelationType.War) return true;
    }
    return false;
}

/** Empire.9.cs 2908 CheckSystemVisible(Habitat systemStar). */
function checkSystemVisibleStar(self: Empire, systemStar: Habitat | null): boolean {
    return systemStar !== null ? self.visibility.checkSystemVisible(systemStar.systemIndex) : false;
}

/** Empire.9.cs 2998 CheckSystemExplored(int systemIndex). */
function checkSystemExplored(self: Empire, systemIndex: number): boolean {
    return self.visibility.checkSystemExplored(systemIndex);
}

/** Galaxy.7.cs 669 DetermineHabitatSystemStar(habitat) (null for a habitat of no system). */
function determineHabitatSystemStar(habitat: Habitat | null): Habitat | null {
    let result: Habitat | null = null;
    if (habitat !== null) {
        switch (habitat.category) {
            case HabitatCategoryType.Planet:
            case HabitatCategoryType.Asteroid:
                result = habitat.parent;
                break;
            case HabitatCategoryType.Moon:
                result = habitat.parent!.parent;
                break;
            case HabitatCategoryType.Star:
            case HabitatCategoryType.GasCloud:
                result = habitat;
                break;
            default:
                result = null;
                break;
        }
    }
    return result;
}

/** Galaxy.7.cs 665 DetermineHabitatSystemStarForStellarObject(stellarObject). */
function determineHabitatSystemStarForStellarObject(stellarObject: StellarObject): Habitat | null {
    let result: Habitat | null = null;
    if (isHabitat(stellarObject)) result = determineHabitatSystemStar(stellarObject);
    else if (isBuiltObject(stellarObject)) result = stellarObject.nearestSystemStar;
    return result;
}

/** StellarObject.Empire for a habitat / ship / creature. */
function stellarObjectEmpire(o: StellarObject): Empire | null {
    if (isHabitat(o)) return o.empire;
    if (isBuiltObject(o)) return o.empire;
    return null;
}

/** StellarObject.DockingBays (null for a creature). */
function stellarDockingBays(o: StellarObject): unknown[] | null {
    if (isHabitat(o) || isBuiltObject(o)) return o.dockingBays;
    return null;
}

/** StellarObject.IsRefuellingDepot (false for a creature). */
function stellarIsRefuellingDepot(o: StellarObject): boolean {
    if (isHabitat(o) || isBuiltObject(o)) return o.isRefuellingDepot;
    return false;
}

/** BuiltObject.1.cs 3377 CountAssaultPods. */
function countAssaultPods(bo: BuiltObject): number {
    let num = 0;
    if (bo.assaultRange > 0 && bo.assaultStrength > 0 && bo.weapons !== null) {
        for (let i = 0; i < bo.weapons.length; i++) {
            const weapon = bo.weapons[i];
            if (weapon != null && weapon.component != null && weapon.component.type === ComponentType.AssaultPod) num++;
        }
    }
    return num;
}

/** ShipGroup.cs 3150 TotalAssaultPodCount. */
function shipGroupTotalAssaultPodCount(shipGroup: ShipGroup): number {
    let total = 0;
    for (let index = 0; index < shipGroup.ships.length; ++index) {
        const ship = shipGroup.ships[index];
        if (ship != null && !ship.hasBeenDestroyed) total += countAssaultPods(ship);
    }
    return total;
}

/** ShipGroup.TotalTroopAttackStrength (ShipGroup.cs 2967; shipGroup.ts). */
function shipGroupTotalTroopAttackStrength(shipGroup: ShipGroup): number {
    return shipGroup.totalTroopAttackStrength;
}

/** Galaxy.5.cs 123 DetermineRequiredTroopStrength(empire, target). */
export function determineRequiredTroopStrength(galaxy: Galaxy, empire: Empire | null, target: unknown): number {
    let num = 0;
    const num2 = 35000;
    let num3 = 0;
    if (target != null && isHabitat(target)) {
        const habitat = target;
        num3 = calculatePopulationStrength(habitat);
        if (isObjectVisibleToThisEmpire(galaxy, empire!, habitat)) {
            if (habitat.troops !== null) {
                num = habitat.troops.totalDefendStrength + num2 + num3;
                if (habitat.defensiveFortressBonus > 0) num = csDoubleToInt(num * (1.0 + Math.trunc(habitat.defensiveFortressBonus) / 10.0));
            }
        } else {
            num = troopLevelRequired(galaxy, habitat, galaxy.difficultyLevel) * 100 + num2 + num3;
            if (habitat.defensiveFortressBonus > 0) num = csDoubleToInt(num * (1.0 + Math.trunc(habitat.defensiveFortressBonus) / 10.0));
        }
    }
    if (empire !== null) num = csDoubleToInt(num * empire.policy!.invasionOverkillFactor);
    return num;
}

/** Habitat.cs 4317 CalculatePopulationStrength(out isDefending) — the strength part (isDefending is not read by callers here). */
function calculatePopulationStrength(habitat: Habitat): number {
    let result = 0;
    if (habitat.population !== null && habitat.population.dominantRace !== null) {
        result = Math.imul(Math.trunc(habitat.population.totalAmount / 5000000) | 0, habitat.population.dominantRace.aggression);
    }
    return result;
}

/** Galaxy.4.cs 609 CheckUsePlanetDestroyerAgainstEmpire(attacker, target). */
export function checkUsePlanetDestroyerAgainstEmpire(galaxy: Galaxy, attacker: Empire | null, target: Empire | null): boolean {
    let result = false;
    if (attacker !== null && attacker.policy !== null && target !== null) {
        switch (attacker.policy.warAttacksAllowPlanetDestroying) {
            case 0:
                result = true;
                break;
            case 1: {
                const empireEvaluation = obtainEmpireEvaluation(galaxy, attacker, target);
                if (empireEvaluation.overallAttitude <= -80) result = true;
                break;
            }
            case 2:
                if (target.civilityRating <= -50.0) result = true;
                break;
            case 3:
                result = false;
                break;
        }
    }
    return result;
}

/** Galaxy.4.cs 642 CheckUseBombardmentAgainstEmpire(attacker, target). */
export function checkUseBombardmentAgainstEmpire(galaxy: Galaxy, attacker: Empire | null, target: Empire | null): boolean {
    let result = false;
    if (attacker !== null && attacker.policy !== null && target !== null) {
        switch (attacker.policy.warAttacksAllowColonyBombardment) {
            case 0:
                result = true;
                break;
            case 1: {
                const empireEvaluation = obtainEmpireEvaluation(galaxy, attacker, target);
                if (empireEvaluation.overallAttitude <= -80) result = true;
                break;
            }
            case 2:
                if (target.civilityRating <= -50.0) result = true;
                break;
            case 3:
                result = false;
                break;
        }
    }
    return result;
}

/** Galaxy.4.cs 675 SortEmpiresByMilitaryPriority(empire, targetEmpires): Array.Sort(keys, items) then Array.Reverse. */
export function sortEmpiresByMilitaryPriority(galaxy: Galaxy, empire: Empire, targetEmpires: Empire[]): Empire[] {
    const array: number[] = new Array<number>(targetEmpires.length).fill(0);
    const array2: (Empire | null)[] = new Array<Empire | null>(targetEmpires.length).fill(null);
    for (let i = 0; i < targetEmpires.length; i++) {
        const empire2 = targetEmpires[i];
        if (empire2 != null) {
            let num = Math.trunc(totalColonyStrategicValue(empire2) / 1000);
            const empireEvaluation = obtainEmpireEvaluation(galaxy, empire, empire2);
            num *= empireEvaluation.overallAttitude * -1;
            if (empire2 === galaxy.playerEmpire && empire !== galaxy.playerEmpire) num *= 2.0;
            array[i] = num;
            array2[i] = targetEmpires[i];
        }
    }
    arraySortKeysItems(array, array2);
    array2.reverse();
    return array2 as Empire[];
}

/** Galaxy.3.cs 878 ObtainAvailableMilitaryShips(empire, minimumFirepower, includeUnAutomatedShips, allowShipsInFleets, includeBusyShips). */
export function obtainAvailableMilitaryShips(galaxy: Galaxy, empire: Empire, minimumFirepower: number, includeUnAutomatedShips: boolean, allowShipsInFleets: boolean, includeBusyShips: boolean): BuiltObject[] {
    void galaxy;
    const builtObjectList: BuiltObject[] = [];
    for (let i = 0; i < empire.builtObjects.length; i++) {
        const builtObject = empire.builtObjects[i];
        if (
            builtObject.role !== BuiltObjectRole.Military ||
            builtObject.firepowerRaw < minimumFirepower ||
            builtObject.unbuiltComponentCount > 0 ||
            builtObject.builtAt !== null ||
            builtObject.subRole === BuiltObjectSubRole.TroopTransport ||
            builtObject.subRole === BuiltObjectSubRole.ResupplyShip ||
            !builtObject.isFunctional ||
            (!allowShipsInFleets && builtObject.shipGroup !== null) ||
            (!builtObject.isAutoControlled && !includeUnAutomatedShips)
        ) {
            continue;
        }
        let flag = false;
        const mission = missionOf(builtObject);
        if (mission !== null && (mission.type === BuiltObjectMissionType.Attack || mission.priority === BuiltObjectMissionPriority.VeryHigh || mission.priority === BuiltObjectMissionPriority.High)) flag = true;
        if (!includeBusyShips && mission !== null && mission.type !== BuiltObjectMissionType.Undefined) {
            if (mission.type === BuiltObjectMissionType.Refuel || mission.type === BuiltObjectMissionType.Repair || mission.type === BuiltObjectMissionType.Retrofit) flag = true;
            if (mission.priority === BuiltObjectMissionPriority.High || mission.priority === BuiltObjectMissionPriority.VeryHigh || mission.priority === BuiltObjectMissionPriority.Unavailable) flag = true;
        }
        if (!flag) builtObjectList.push(builtObject);
    }
    return builtObjectList;
}

/** BuiltObjectList.cs 343 GetNearestBuiltObjectWithinRange(x, y, fuelPortionMargin, out index) (mustBeAvailable false). */
function getNearestBuiltObjectWithinRangeIndexed(galaxy: Galaxy, list: BuiltObject[], x: number, y: number, fuelPortionMargin: number): { builtObject: BuiltObject | null; index: number } {
    const builtObject = getNearestBuiltObjectWithinRange(galaxy, list, x, y, fuelPortionMargin, false);
    return { builtObject, index: builtObject === null ? -1 : list.indexOf(builtObject) };
}

/** Galaxy.7.cs 197 DetermineBuiltObjectStrengthAtLocation(x, y, empire, unarmedStrength, ref ships). */
function determineBuiltObjectStrengthAtLocationCore(galaxy: Galaxy, x: number, y: number, empire: Empire | null, unarmedStrength: number, ships: BuiltObject[]): number {
    let num = 0;
    if (empire !== null) {
        const threatRange = THREAT_RANGE;
        const num2 = threatRange * threatRange;
        if (empire.builtObjects !== null) {
            for (let i = 0; i < empire.builtObjects.length; i++) {
                const builtObject = empire.builtObjects[i];
                if (builtObject != null && galaxy.calculateDistanceSquared(x, y, builtObject.xpos, builtObject.ypos) <= num2) {
                    const firepowerRaw = builtObject.firepowerRaw;
                    num += Math.max(unarmedStrength, firepowerRaw);
                    if (firepowerRaw > unarmedStrength) ships.push(builtObject);
                }
            }
        }
        if (unarmedStrength > 0 && empire.privateBuiltObjects !== null) {
            for (let j = 0; j < empire.privateBuiltObjects.length; j++) {
                const builtObject2 = empire.privateBuiltObjects[j];
                if (builtObject2 != null && galaxy.calculateDistanceSquared(x, y, builtObject2.xpos, builtObject2.ypos) <= num2) {
                    const firepowerRaw2 = builtObject2.firepowerRaw;
                    num += Math.max(unarmedStrength, firepowerRaw2);
                    if (firepowerRaw2 > unarmedStrength) ships.push(builtObject2);
                }
            }
        }
    }
    return num;
}

/** Galaxy.7.cs 117 DetermineBuiltObjectStrengthAtLocation(int x, int y, empire, unarmedStrength, includeAllies, out ships). */
export function determineBuiltObjectStrengthAtLocationWithShips(galaxy: Galaxy, x: number, y: number, empire: Empire | null, unarmedStrength: number, includeAllies: boolean): { strength: number; ships: BuiltObject[] } {
    const ships: BuiltObject[] = [];
    // C# parameters are int (callers pass (int) coordinates or Point members).
    const ix = Math.trunc(x);
    const iy = Math.trunc(y);
    let num = determineBuiltObjectStrengthAtLocationCore(galaxy, ix, iy, empire, unarmedStrength, ships);
    if (includeAllies && empire !== null && empire.diplomaticRelations !== null) {
        for (let i = 0; i < empire.diplomaticRelations.count; i++) {
            const diplomaticRelation = empire.diplomaticRelations.at(i);
            if (diplomaticRelation != null && (diplomaticRelation.type === DiplomaticRelationType.MutualDefensePact || (diplomaticRelation.type === DiplomaticRelationType.Protectorate && diplomaticRelation.initiator !== empire))) {
                num += determineBuiltObjectStrengthAtLocationCore(galaxy, ix, iy, diplomaticRelation.otherEmpire, unarmedStrength, ships);
            }
        }
    }
    return { strength: num, ships };
}

/** Galaxy.7.cs 117 DetermineBuiltObjectStrengthAtLocation — the int result (docking.ts, M4e). */
export function determineBuiltObjectStrengthAtLocation(galaxy: Galaxy, x: number, y: number, empire: Empire | null, unarmedStrength: number, includeAllies: boolean): number {
    return determineBuiltObjectStrengthAtLocationWithShips(galaxy, x, y, empire, unarmedStrength, includeAllies).strength;
}

/** Galaxy.Blockades[target] (BlockadeList.cs 14/28) — docking.ts (M4e) reads the initiator. */
export function galaxyBlockadeFor(galaxy: Galaxy, target: BuiltObject | Habitat): { initiator: Empire | null } | null {
    return blockadeFor(galaxy, target);
}

/** Empire.2.cs 4373 CalculateAggressionFactor. */
export function calculateAggressionFactor(galaxy: Galaxy, empire: Empire): number {
    let num = aggressionLevel(empire) / 100.0;
    num *= num;
    return num * galaxy.aggressionLevel;
}

/** Empire.2.cs 4380 CalculateCautionFactor. */
export function calculateCautionFactor(galaxy: Galaxy, empire: Empire): number {
    void galaxy;
    let num = cautionLevel(empire) / 100.0;
    num *= num;
    return Math.max(1.0, num);
}

/** Galaxy.8.cs 1619 IdentifyMechanoidEmpire. */
export function identifyMechanoidEmpire(galaxy: Galaxy): Empire | null {
    let result: Empire | null = null;
    for (let i = 0; i < galaxy.empires.length; i++) {
        const e = galaxy.empires[i];
        if (e.pirateEmpireBaseHabitat === null && e.dominantRace !== null && e.dominantRace.name.toLowerCase() === 'mechanoid') {
            result = e;
            break;
        }
    }
    return result;
}

// ---------------------------------------------------------------------------------------------------------------
// Advisor texts (Empire.10.cs 3697-4137)
// ---------------------------------------------------------------------------------------------------------------

/** Empire.10.cs 3697/3702 GenerateAutomationMessageAttackForcesInOurSystem(systemStar, otherEmpire[, enemyFleet, ourFleet]). */
function generateAutomationMessageAttackForcesInOurSystem(systemStar: Habitat, otherEmpire: Empire | null): string {
    return formatText(getText('Automation Attack Forces In Our System'), otherEmpire!.name, systemStar.name);
}

/** Empire.10.cs 3762 GenerateAutomationMessageRaid(targetEmpire). */
function generateAutomationMessageRaid(targetEmpire: Empire): string {
    return formatText(getText('Automation Raid'), targetEmpire.name);
}

/** Empire.10.cs 3807 GenerateAutomationMessageAttackEnemy(ShipGroup shipGroup, ShipGroup attackFleet). */
function generateAutomationMessageAttackEnemyFleet(shipGroup: ShipGroup, attackFleet: ShipGroup): string {
    let arg = '';
    if (shipGroup !== null && shipGroup.empire !== null) arg = shipGroup.empire.name;
    return formatText(getText('Automation Attack Enemy Fleet'), shipGroup.name, arg, attackFleet.name);
}

/** Empire.10.cs 3886 GenerateAutomationMessageAttackPirateBase(pirateBase, attackFleet). */
function generateAutomationMessageAttackPirateBase(pirateBase: BuiltObject, attackFleet: ShipGroup): string {
    let text = '';
    if (pirateBase.parentHabitat !== null) {
        const habitat = determineHabitatSystemStar(pirateBase.parentHabitat);
        text = habitat!.name;
    }
    return formatText(getText('Automation Attack Pirate Base'), pirateBase.name, pirateBase.empire!.name, text, attackFleet.name);
}

/** Empire.10.cs 3960/3965 GenerateAutomationMessageAttackEnemy(BuiltObject builtObject[, blockade], attackFleet). */
export function generateAutomationMessageAttackEnemyBase(galaxy: Galaxy, builtObject: BuiltObject, blockade: boolean, attackFleet: ShipGroup | null): string {
    let text = '';
    if (builtObject.nearestSystemStar !== null) {
        text = builtObject.nearestSystemStar.name;
    } else {
        const habitat = galaxy.fastFindNearestSystem(builtObject.xpos, builtObject.ypos);
        if (habitat !== null) text = habitat.name;
    }
    let text2 = '';
    if (attackFleet !== null) text2 = attackFleet.name ?? '';
    let text3 = '';
    if (builtObject !== null && builtObject.empire !== null) text3 = builtObject.empire.name;
    if (blockade) return formatText(getText('Automation Blockade Enemy Base'), builtObject.name, text3, text, text2);
    return formatText(getText('Automation Attack Enemy Base'), builtObject.name, text3, text, text2);
}

/** Empire.10.cs 3998/4117 GenerateAutomationMessageAttackEnemy(Habitat habitat[, blockade], attackFleet). */
export function generateAutomationMessageAttackEnemyColony(galaxy: Galaxy, habitat: Habitat, blockade: boolean, attackFleet: ShipGroup | null): string {
    void galaxy;
    let text = '';
    if (attackFleet !== null) text = attackFleet.name ?? '';
    const habitat2 = determineHabitatSystemStar(habitat);
    let text2 = '';
    if (habitat !== null && habitat.empire !== null) text2 = habitat.empire.name;
    if (blockade) return formatText(getText('Automation Blockade Enemy Colony'), habitat.type, habitat.category, habitat.name, text2, habitat2!.name, text);
    return formatText(getText('Automation Attack Enemy Colony'), habitat.type, habitat.category, habitat.name, text2, habitat2!.name, text);
}

/** Empire.10.cs 4050 GenerateAutomationMessageDestroyPlanet(habitat, planetDestroyer). */
function generateAutomationMessageDestroyPlanet(habitat: Habitat, planetDestroyer: BuiltObject): string {
    const habitat2 = determineHabitatSystemStar(habitat);
    let text = '';
    if (habitat !== null && habitat.empire !== null) text = habitat.empire.name;
    return formatText(getText('Automation Destroy Planet'), habitat.type, habitat.category, habitat.name, text, habitat2!.name, planetDestroyer.name);
}

/** Empire.10.cs 4061 GenerateAutomationMessageBombardColony(habitat, attackFleet). */
function generateAutomationMessageBombardColony(habitat: Habitat, attackFleet: ShipGroup): string {
    const habitat2 = determineHabitatSystemStar(habitat);
    let text = '';
    if (habitat.population !== null && habitat.population.dominantRace !== null) text = habitat.population.dominantRace.name;
    return formatText(getText('Automation Bombard Colony'), habitat.type, habitat.category, habitat.name, habitat.empire!.name, habitat2!.name, text, attackFleet.name);
}

/** Empire.10.cs 4072 GenerateAutomationMessageAttackEnemyWithWaypoint(target, blockade, attackFleet, waypoint). */
function generateAutomationMessageAttackEnemyWithWaypoint(target: StellarObject, blockade: boolean, attackFleet: ShipGroup | null, waypoint: StellarObject): string {
    let text = '';
    if (attackFleet !== null) text = attackFleet.name ?? '';
    const targetEmpireName = stellarObjectEmpire(target)!.name;
    if (blockade) {
        if (isHabitat(target)) {
            const habitat2 = determineHabitatSystemStar(target);
            return formatText(getText('Automation Blockade Enemy Colony With Waypoint'), target.type, target.category, target.name, targetEmpireName, habitat2!.name, text, waypoint.name);
        }
        let text2 = '';
        if (isBuiltObject(target) && target.nearestSystemStar !== null) text2 = target.nearestSystemStar.name;
        return formatText(getText('Automation Blockade Enemy Base With Waypoint'), target.name, targetEmpireName, text2, text, waypoint.name);
    }
    if (isHabitat(target)) {
        const habitat4 = determineHabitatSystemStar(target);
        return formatText(getText('Automation Attack Enemy Colony With Waypoint'), target.type, target.category, target.name, targetEmpireName, habitat4!.name, text, waypoint.name);
    }
    let text3 = '';
    if (isBuiltObject(target) && target.nearestSystemStar !== null) text3 = target.nearestSystemStar.name;
    return formatText(getText('Automation Attack Enemy Base With Waypoint'), target.name, targetEmpireName, text3, text, waypoint.name);
}

// ---------------------------------------------------------------------------------------------------------------
// Fleet availability and searches (Empire.9.cs 1411-1602, 2370-2453, 3492; Empire.3.cs 5047-5245)
// ---------------------------------------------------------------------------------------------------------------

/** Empire.9.cs 2379 IsShipGroupAvailableWithAttackStrength(shipGroup, maximumPriority, overallStrength). */
function isShipGroupAvailableWithAttackStrength(galaxy: Galaxy, shipGroup: ShipGroup, maximumPriority: BuiltObjectMissionPriority, overallStrength: number): boolean {
    return shipGroupTotalOverallStrengthFactor(galaxy, shipGroup) >= overallStrength && (shipGroup.mission === null || shipGroup.mission.type === BuiltObjectMissionType.Undefined || shipGroup.mission.priority <= maximumPriority);
}

/** Empire.9.cs 2401 IsShipGroupAvailable(shipGroup, maximumPriorityToInclude, minimumTroopLevel). */
export function isShipGroupAvailable(galaxy: Galaxy, shipGroup: ShipGroup, maximumPriorityToInclude: BuiltObjectMissionPriority, minimumTroopLevel: number): boolean {
    return (minimumTroopLevel <= 0 || shipGroupTotalTroopAttackStrengthNearby(galaxy, shipGroup, 0.3) >= minimumTroopLevel) && (shipGroup.mission === null || shipGroup.mission.type === BuiltObjectMissionType.Undefined || shipGroup.mission.priority <= maximumPriorityToInclude);
}

/** Empire.9.cs 2410/2415 FindAvailableShipGroup(maximumPriorityToInclude, minimumTroopLevel, posture[, shipGroupMustBeAutomated]). */
function findAvailableShipGroup(galaxy: Galaxy, self: Empire, maximumPriorityToInclude: BuiltObjectMissionPriority, minimumTroopLevel: number, posture: FleetPosture, shipGroupMustBeAutomated = false): ShipGroup | null {
    const shipGroups = shipGroupsOf(self);
    for (let i = 0; i < shipGroups.length; i++) {
        const shipGroup = shipGroups[i];
        if ((!shipGroupMustBeAutomated || shipGroup.leadShip!.isAutoControlled) && shipGroup.posture === posture && isShipGroupAvailable(galaxy, shipGroup, maximumPriorityToInclude, minimumTroopLevel)) return shipGroup;
    }
    return null;
}

/** Empire.9.cs 1434 FindNearestDefensiveFleet(x, y). */
function findNearestDefensiveFleet(galaxy: Galaxy, self: Empire, x: number, y: number): ShipGroup | null {
    let result: ShipGroup | null = null;
    let num = Number.MAX_VALUE;
    const shipGroups = shipGroupsOf(self);
    if (shipGroups !== null) {
        for (let i = 0; i < shipGroups.length; i++) {
            const shipGroup = shipGroups[i];
            if (shipGroup.leadShip !== null && shipGroup.posture === FleetPosture.Defend) {
                const num2 = galaxy.calculateDistance(x, y, shipGroup.leadShip.xpos, shipGroup.leadShip.ypos);
                if (num2 < num) {
                    result = shipGroup;
                    num = num2;
                }
            }
        }
    }
    return result;
}

/**
 * Empire.9.cs 1492 FindNearestAvailableFleet(x, y, maximumPriority, overallStrength, posture, mustBeWithinFuelRange,
 * fuelPortionMargin, mustBeAutomated, shouldBeSmallFleet, gatherPointMustBeBlank, mustBeWithinPostureRange,
 * minimumTroopStrength, minimumBoardingStrength) and the overloads 1457-1487. The overloads pass fuelPortionMargin 0.0
 * down the chain whatever the caller gave (C# quirk: 1467-1487 forward `0.0`, not the parameter).
 */
export function findNearestAvailableFleet(
    galaxy: Galaxy,
    self: Empire,
    x: number,
    y: number,
    maximumPriority: BuiltObjectMissionPriority,
    overallStrength: number,
    posture: FleetPosture,
    mustBeWithinFuelRange = false,
    fuelPortionMargin = 0.0,
    mustBeAutomated = false,
    shouldBeSmallFleet = false,
    gatherPointMustBeBlank = false,
    mustBeWithinPostureRange = false,
    minimumTroopStrength = 0,
    minimumBoardingStrength = 0,
): ShipGroup | null {
    // Every C# overload that has a fuelPortionMargin parameter forwards the literal 0.0 (1467/1472/1477/1482/1487).
    void fuelPortionMargin;
    fuelPortionMargin = 0.0;
    let result: ShipGroup | null = null;
    let num = Number.MAX_VALUE;
    const shipGroups = shipGroupsOf(self);
    if (shipGroups !== null) {
        for (let i = 0; i < shipGroups.length; i++) {
            const shipGroup = shipGroups[i];
            if (
                shipGroup.leadShip === null ||
                !isShipGroupAvailableWithAttackStrength(galaxy, shipGroup, maximumPriority, overallStrength) ||
                (gatherPointMustBeBlank && shipGroup.gatherPoint !== null) ||
                (shouldBeSmallFleet && (shipGroup.shipTargetAmount >= 10 || shipGroup.ships.length >= 10))
            ) {
                continue;
            }
            if (mustBeWithinFuelRange) {
                if (!shipGroupCheckFleetTargetWithinFuelRangeAndRefuel(galaxy, shipGroup, x, y, fuelPortionMargin) || (mustBeAutomated && !shipGroup.leadShip.isAutoControlled) || shipGroup.posture !== posture || shipGroupTotalTroopAttackStrength(shipGroup) < minimumTroopStrength) {
                    continue;
                }
                const num2 = shipGroupTotalAssaultPodCount(shipGroup) * 6000;
                if (num2 < minimumBoardingStrength) continue;
                let flag = true;
                if (mustBeWithinPostureRange) {
                    flag = false;
                    if (shipGroup.posture === FleetPosture.Defend && shipGroup.gatherPoint !== null) {
                        const num3 = galaxy.calculateDistanceSquared(x, y, shipGroup.gatherPoint.xpos, shipGroup.gatherPoint.ypos);
                        if (shipGroup.postureRangeSquared >= num3) flag = true;
                    } else if (shipGroup.posture === FleetPosture.Attack) {
                        if (shipGroup.attackPoint !== null) {
                            const num4 = galaxy.calculateDistanceSquared(x, y, shipGroup.attackPoint.xpos, shipGroup.attackPoint.ypos);
                            if (shipGroup.postureRangeSquared >= num4) flag = true;
                        } else {
                            flag = true;
                        }
                    }
                }
                if (flag) {
                    const num5 = galaxy.calculateDistance(x, y, shipGroup.leadShip.xpos, shipGroup.leadShip.ypos);
                    if (num5 < num) {
                        result = shipGroup;
                        num = num5;
                    }
                }
            } else {
                if ((mustBeAutomated && !shipGroup.leadShip.isAutoControlled) || shipGroup.posture !== posture || shipGroupTotalTroopAttackStrength(shipGroup) < minimumTroopStrength) continue;
                let flag2 = true;
                if (mustBeWithinPostureRange) {
                    flag2 = false;
                    if (shipGroup.posture === FleetPosture.Defend && shipGroup.gatherPoint !== null) {
                        const num6 = galaxy.calculateDistanceSquared(x, y, shipGroup.gatherPoint.xpos, shipGroup.gatherPoint.ypos);
                        if (shipGroup.postureRangeSquared >= num6) flag2 = true;
                    } else if (shipGroup.posture === FleetPosture.Attack) {
                        if (shipGroup.attackPoint !== null) {
                            const num7 = galaxy.calculateDistanceSquared(x, y, shipGroup.attackPoint.xpos, shipGroup.attackPoint.ypos);
                            if (shipGroup.postureRangeSquared >= num7) flag2 = true;
                        } else {
                            flag2 = true;
                        }
                    }
                }
                if (flag2) {
                    const num8 = galaxy.calculateDistance(x, y, shipGroup.leadShip.xpos, shipGroup.leadShip.ypos);
                    if (num8 < num) {
                        result = shipGroup;
                        num = num8;
                    }
                }
            }
        }
    }
    return result;
}

/** Empire.9.cs 3505 GenerateDistanceOrderedFleetList(targetX, targetY, fleets). */
function generateDistanceOrderedFleetList(galaxy: Galaxy, targetX: number, targetY: number, fleets: readonly ShipGroup[]): ShipGroup[] {
    const shipGroupList: ShipGroup[] = fleets.slice();
    for (let i = 0; i < shipGroupList.length; i++) {
        const shipGroup = shipGroupList[i];
        shipGroup.sortTag = galaxy.calculateDistance(shipGroup.leadShip!.xpos, shipGroup.leadShip!.ypos, targetX, targetY);
    }
    netSort(shipGroupList, compareShipGroups);
    shipGroupListClearSortTags(shipGroupList);
    return shipGroupList;
}

/** Empire.3.cs 5153/5158 CheckFleetDefenseReponse(fleet, attackX, attackY, atWar). */
function checkFleetDefenseReponse(galaxy: Galaxy, fleet: ShipGroup | null, attackX: number, attackY: number, atWar: boolean): boolean {
    if (
        fleet !== null &&
        fleet.leadShip !== null &&
        (fleet.posture === FleetPosture.Defend || !atWar) &&
        (fleet.mission === null || fleet.mission.type === BuiltObjectMissionType.Undefined || fleet.mission.priority === BuiltObjectMissionPriority.Low)
    ) {
        if (fleet.posture === FleetPosture.Attack) return true;
        let xpos = fleet.leadShip.xpos;
        let ypos = fleet.leadShip.ypos;
        if (fleet.gatherPoint !== null) {
            xpos = fleet.gatherPoint.xpos;
            ypos = fleet.gatherPoint.ypos;
        }
        const num = galaxy.calculateDistanceSquared(xpos, ypos, attackX, attackY);
        if (fleet.postureRangeSquared >= num) return true;
    }
    return false;
}

/**
 * Empire.3.cs 5067 IdentifyNearestAvailableFleet(x, y, mustBeAutomated, mustBeWithinFuelRange, fuelPortionMargin,
 * excludeRange, defendFleetsMustBeWithinPostureRange, forceFleetUse, minimumShipCount) and the overloads 5047-5065.
 */
export function identifyNearestAvailableFleet(
    galaxy: Galaxy,
    self: Empire,
    x: number,
    y: number,
    mustBeAutomated: boolean,
    mustBeWithinFuelRange = false,
    fuelPortionMargin = 0.0,
    excludeRange = 0.0,
    defendFleetsMustBeWithinPostureRange = true,
    forceFleetUse = false,
    minimumShipCount = 0,
): ShipGroup | null {
    const num = excludeRange * excludeRange;
    const atWar = checkAtWar(self);
    const shipGroupList = generateDistanceOrderedFleetList(galaxy, x, y, shipGroupsOf(self));
    for (let i = 0; i < shipGroupList.length; i++) {
        const shipGroup = shipGroupList[i];
        if (shipGroup === null || shipGroup.leadShip === null) continue;
        let flag = true;
        if (mustBeAutomated && !shipGroup.leadShip.isAutoControlled) flag = false;
        if (!flag || shipGroup.ships.length < minimumShipCount || (!forceFleetUse && !checkFleetDefenseReponse(galaxy, shipGroup, x, y, atWar))) continue;
        let flag2 = true;
        if (shipGroup.mission !== null) {
            if (forceFleetUse) {
                if (shipGroup.mission.priority === BuiltObjectMissionPriority.High || shipGroup.mission.priority === BuiltObjectMissionPriority.VeryHigh || shipGroup.mission.priority === BuiltObjectMissionPriority.Unavailable) flag2 = false;
            } else {
                flag2 = false;
                if (
                    shipGroup.mission.type === BuiltObjectMissionType.Undefined ||
                    shipGroup.mission.type === BuiltObjectMissionType.MoveAndWait ||
                    shipGroup.mission.type === BuiltObjectMissionType.Hold ||
                    (shipGroup.mission.type === BuiltObjectMissionType.Patrol && shipGroup.mission.priority === BuiltObjectMissionPriority.Low)
                ) {
                    flag2 = true;
                }
            }
        }
        if (!flag2) continue;
        let flag3 = false;
        if (excludeRange > 0.0) {
            const num2 = galaxy.calculateDistanceSquared(x, y, shipGroup.leadShip.xpos, shipGroup.leadShip.ypos);
            if (num2 < num) flag3 = true;
        }
        if (flag3) continue;
        let flag4 = true;
        if (!forceFleetUse && defendFleetsMustBeWithinPostureRange && shipGroup.posture === FleetPosture.Defend) {
            flag4 = false;
            if (shipGroup.gatherPoint !== null) {
                const num3 = galaxy.calculateDistanceSquared(x, y, shipGroup.gatherPoint.xpos, shipGroup.gatherPoint.ypos);
                if (shipGroup.postureRangeSquared >= num3) flag4 = true;
            }
        }
        if (flag4) {
            if (!mustBeWithinFuelRange) return shipGroup;
            if (shipGroupCheckFleetTargetWithinFuelRangeAndRefuel(galaxy, shipGroup, x, y, fuelPortionMargin)) return shipGroup;
        }
    }
    return null;
}

/** Empire.3.cs 5182 IdentifyNearestResponseFleet(x, y, mustBeWithinFuelRange, fuelPortionMargin, excludeRange). */
export function identifyNearestResponseFleet(galaxy: Galaxy, empire: Empire, x: number, y: number, mustBeWithinFuelRange: boolean, fuelPortionMargin: number, excludeRange: number): ShipGroup | null {
    let shipGroup: ShipGroup | null = null;
    const num = excludeRange * excludeRange;
    const atWar = checkAtWar(empire);
    const shipGroupList = generateDistanceOrderedFleetList(galaxy, x, y, shipGroupsOf(empire));
    for (let i = 0; i < shipGroupList.length; i++) {
        const shipGroup2 = shipGroupList[i];
        if (shipGroup2 === null || shipGroup2.leadShip === null) continue;
        let flag = true;
        if (shipGroup2.posture === FleetPosture.Attack && !shipGroup2.leadShip.isAutoControlled) flag = false;
        const m = shipGroup2.mission;
        if (
            !flag ||
            !checkFleetDefenseReponse(galaxy, shipGroup2, x, y, atWar) ||
            (m !== null &&
                m.type !== BuiltObjectMissionType.Undefined &&
                m.type !== BuiltObjectMissionType.MoveAndWait &&
                m.type !== BuiltObjectMissionType.Hold &&
                (m.type !== BuiltObjectMissionType.Patrol || m.priority !== BuiltObjectMissionPriority.Low))
        ) {
            continue;
        }
        let flag2 = false;
        if (excludeRange > 0.0) {
            const num2 = galaxy.calculateDistanceSquared(x, y, shipGroup2.leadShip.xpos, shipGroup2.leadShip.ypos);
            if (num2 < num) flag2 = true;
        }
        if (flag2) continue;
        let flag3 = false;
        if (mustBeWithinFuelRange) {
            if (shipGroupCheckFleetTargetWithinFuelRangeAndRefuel(galaxy, shipGroup2, x, y, fuelPortionMargin)) flag3 = true;
        } else {
            flag3 = true;
        }
        if (flag3) {
            if (shipGroup2.posture === FleetPosture.Defend) return shipGroup2;
            if (shipGroup === null) shipGroup = shipGroup2;
        }
    }
    if (shipGroup !== null) return shipGroup;
    return null;
}

/** Empire.8.cs 4828 GenerateOrderedFleetsForTarget(x, y, includeSmallFleets). */
function generateOrderedFleetsForTarget(galaxy: Galaxy, self: Empire, x: number, y: number, includeSmallFleets: boolean): ShipGroup[] {
    const shipGroupList: ShipGroup[] = [];
    const shipGroups = shipGroupsOf(self);
    for (let i = 0; i < shipGroups.length; i++) {
        if ((includeSmallFleets || shipGroups[i].shipTargetAmount >= 10 || shipGroups[i].ships.length >= 10) && shipGroups[i].leadShip !== null) {
            const sortTag = galaxy.calculateDistance(x, y, shipGroups[i].leadShip!.xpos, shipGroups[i].leadShip!.ypos);
            shipGroups[i].sortTag = sortTag;
            shipGroupList.push(shipGroups[i]);
        }
    }
    netSort(shipGroupList, compareShipGroups);
    shipGroupListClearSortTags(shipGroupList);
    return shipGroupList;
}

/** Empire.8.cs 4815 GenerateOrderedFleetsForEmpireTargets(targetEmpire, includeSmallFleets). */
function generateOrderedFleetsForEmpireTargets(galaxy: Galaxy, self: Empire, targetEmpire: Empire, includeSmallFleets: boolean): ShipGroup[] {
    if (targetEmpire.capital !== null) return generateOrderedFleetsForTarget(galaxy, self, targetEmpire.capital.xpos, targetEmpire.capital.ypos, includeSmallFleets);
    if (targetEmpire.pirateEmpireBaseHabitat !== null) return generateOrderedFleetsForTarget(galaxy, self, targetEmpire.pirateEmpireBaseHabitat.xpos, targetEmpire.pirateEmpireBaseHabitat.ypos, includeSmallFleets);
    // Galaxy.SizeX / 2 (int division of the static int size).
    return generateOrderedFleetsForTarget(galaxy, self, Math.trunc(galaxy.sizeX / 2), Math.trunc(galaxy.sizeY / 2), includeSmallFleets);
}

// Empire.8.cs 4755-4800 GenerateOrderedFleetsBy{OverallStrength,FighterStrength,TroopAttackStrength,TroopDefendStrength}:
// fleets/fleetOrdering.ts (one copy, kept from M4y at the M4m merge).

/** Empire.8.cs 4236 CountShipGroupsAssignedToEmpire(empire, includeSmallFleets). */
function countShipGroupsAssignedToEmpire(self: Empire, empire: Empire, includeSmallFleets: boolean): number {
    let num = 0;
    const shipGroups = shipGroupsOf(self);
    for (let i = 0; i < shipGroups.length; i++) {
        const shipGroup = shipGroups[i];
        if ((includeSmallFleets || shipGroup.shipTargetAmount >= 10 || shipGroup.ships.length >= 10) && shipGroup.mission !== null && shipGroup.mission.type !== BuiltObjectMissionType.Undefined) {
            let empire2: Empire | null = null;
            if (shipGroup.mission.targetBuiltObject !== null) empire2 = shipGroup.mission.targetBuiltObject.empire;
            else if (shipGroup.mission.targetHabitat !== null) empire2 = shipGroup.mission.targetHabitat.empire;
            else if (shipGroup.mission.targetShipGroup !== null) empire2 = shipGroup.mission.targetShipGroup.empire;
            if (empire2 === empire) num++;
        }
    }
    return num;
}

function isAttackLikeFleetMission(type: BuiltObjectMissionType): boolean {
    return type === BuiltObjectMissionType.Attack || type === BuiltObjectMissionType.Blockade || type === BuiltObjectMissionType.WaitAndAttack || type === BuiltObjectMissionType.Bombard || type === BuiltObjectMissionType.WaitAndBombard;
}

/** Empire.8.cs 4159 CountFleetAttackStrengthAssignedToTarget(StellarObject target, out troopStrengthAssigned). */
function countFleetAttackStrengthAssignedToTargetObject(galaxy: Galaxy, self: Empire, target: StellarObject | null): { strength: number; troopStrengthAssigned: number } {
    let num = 0;
    let troopStrengthAssigned = 0;
    if (target !== null) {
        const shipGroups = shipGroupsOf(self);
        for (let i = 0; i < shipGroups.length; i++) {
            const shipGroup = shipGroups[i];
            if (shipGroup.mission === null || shipGroup.mission.type === BuiltObjectMissionType.Undefined || !isAttackLikeFleetMission(shipGroup.mission.type)) continue;
            if (shipGroup.mission.targetBuiltObject !== null && isBuiltObject(target)) {
                if (target === shipGroup.mission.targetBuiltObject) {
                    num += shipGroupTotalOverallStrengthFactor(galaxy, shipGroup);
                    troopStrengthAssigned += shipGroupTotalTroopAttackStrength(shipGroup);
                }
            } else if (shipGroup.mission.targetHabitat !== null && isHabitat(target)) {
                if (target === shipGroup.mission.targetHabitat) {
                    num += shipGroupTotalOverallStrengthFactor(galaxy, shipGroup);
                    troopStrengthAssigned += shipGroupTotalTroopAttackStrength(shipGroup);
                }
            }
        }
    }
    return { strength: num, troopStrengthAssigned };
}

/** Empire.8.cs 4195 CountFleetAttackStrengthAssignedToTarget(PrioritizedTarget target). */
function countFleetAttackStrengthAssignedToTarget(galaxy: Galaxy, self: Empire, target: PrioritizedTarget): number {
    let num = 0;
    const t = target.target;
    if (t !== null) {
        const shipGroups = shipGroupsOf(self);
        for (let i = 0; i < shipGroups.length; i++) {
            const shipGroup = shipGroups[i];
            if (shipGroup.mission === null || shipGroup.mission.type === BuiltObjectMissionType.Undefined || !isAttackLikeFleetMission(shipGroup.mission.type)) continue;
            if (shipGroup.mission.targetBuiltObject !== null && isBuiltObject(t)) {
                if (t === shipGroup.mission.targetBuiltObject) num += shipGroupTotalOverallStrengthFactor(galaxy, shipGroup);
            } else if (shipGroup.mission.targetHabitat !== null && isHabitat(t)) {
                if (t === shipGroup.mission.targetHabitat) num += shipGroupTotalOverallStrengthFactor(galaxy, shipGroup);
            } else if (shipGroup.mission.targetShipGroup !== null && isShipGroup(t)) {
                if (t === shipGroup.mission.targetShipGroup) num += shipGroupTotalOverallStrengthFactor(galaxy, shipGroup);
            }
        }
    }
    return num;
}

// ---------------------------------------------------------------------------------------------------------------
// Fleet fuel, refuelling and waypoints (Empire.9.cs 16, 265, 672-713; Empire.8.cs 3335-3610, 4712-4753, 5159)
// ---------------------------------------------------------------------------------------------------------------

/** Empire.9.cs 16 DetermineFuelRequiredForFleet(fleet, setFuelLevelToZero, out fleetFuelCapacity) (and the 1-argument overload: false). */
export function determineFuelRequiredForFleet(fleet: ShipGroup | null, setFuelLevelToZero = false): { requiredFuel: FuelTypeRef[]; fleetFuelCapacity: number } {
    const resourceList: FuelTypeRef[] = [];
    let fleetFuelCapacity = 0;
    if (fleet !== null && fleet.ships !== null) {
        for (let i = 0; i < fleet.ships.length; i++) {
            const builtObject = fleet.ships[i];
            if (builtObject != null && builtObject.fuelType !== null) {
                let num2 = 1;
                if (!setFuelLevelToZero) num2 = builtObject.fuelCapacity - Math.trunc(builtObject.currentFuel);
                let num3 = -1;
                for (let k = 0; k < resourceList.length; k++) {
                    if (resourceList[k].resourceId === builtObject.fuelType.resourceId) {
                        num3 = k;
                        break;
                    }
                }
                if (num3 >= 0) resourceList[num3].sortTag += num2;
                else resourceList.push({ resourceId: builtObject.fuelType.resourceId, sortTag: num2 });
                fleetFuelCapacity += builtObject.fuelCapacity;
            }
        }
    }
    return { requiredFuel: resourceList, fleetFuelCapacity };
}

/**
 * Empire.9.cs 265 DecideBestFleetRefuelPoint(x, y, empire, requiredFuel, empireToExclude) on `self`: the refuelling
 * search (UltraFastFindNearestRefuellingLocation) runs on `self`; `empire` only supplies the ship to refuel.
 */
export function decideBestFleetRefuelPoint(galaxy: Galaxy, self: Empire, x: number, y: number, empire: Empire, requiredFuel: readonly FuelTypeRef[], empireToExclude: Empire | null): StellarObject | null {
    void empireToExclude;
    let shipToRefuel: BuiltObject | null = null;
    for (let i = 0; i < empire.builtObjects.length; i++) {
        if (empire.builtObjects[i].role === BuiltObjectRole.Military) {
            shipToRefuel = empire.builtObjects[i];
            break;
        }
    }
    return ultraFastFindNearestRefuellingLocation(galaxy, self, x, y, requiredFuel, shipToRefuel, false, true, 10);
}

/** Empire.9.cs 672 AssignFleetRefuelling(refuelFleet, requiredFuel). */
export function assignFleetRefuelling(galaxy: Galaxy, empire: Empire, refuelFleet: ShipGroup, requiredFuel: FuelTypeRef[]): boolean {
    if (requiredFuel !== null && requiredFuel.length > 0) {
        for (let i = 0; i < requiredFuel.length; i++) requiredFuel[i].sortTag = Math.trunc(requiredFuel[i].sortTag * 1.2);
    }
    const point = shipGroupDetermineApproximateActualFleetLocation(galaxy, refuelFleet);
    const stellarObject = decideBestFleetRefuelPoint(galaxy, empire, point.x, point.y, refuelFleet.empire!, requiredFuel, null);
    if (stellarObject !== null && shipGroupCheckRefuelLocationRangeAcceptable(galaxy, refuelFleet, stellarObject)) {
        shipGroupAssignMission(galaxy, refuelFleet, BuiltObjectMissionType.Refuel, stellarObject, null, BuiltObjectMissionPriority.Unavailable, true);
        return true;
    }
    return false;
}

/**
 * Empire.9.cs 691 AssignFleetRefuellingExcludeGatheringShips(refuelFleet, requiredFuel). The C# ship loop's condition is
 * `j > refuelFleet.Ships.Count` (0 > Count is never true), so no ship is sent; ported as written.
 */
export function assignFleetRefuellingExcludeGatheringShips(galaxy: Galaxy, self: Empire, refuelFleet: ShipGroup, requiredFuel: FuelTypeRef[]): boolean {
    for (let i = 0; i < requiredFuel.length; i++) requiredFuel[i].sortTag = Math.trunc(requiredFuel[i].sortTag * 1.2);
    const point = shipGroupDetermineApproximateActualFleetLocation(galaxy, refuelFleet);
    const stellarObject = decideBestFleetRefuelPoint(galaxy, self, point.x, point.y, refuelFleet.empire!, requiredFuel, null);
    if (stellarObject !== null) {
        for (let j = 0; j > refuelFleet.ships.length; j++) {
            const builtObject = refuelFleet.ships[j];
            const m = missionOf(builtObject);
            if (
                shipGroupIsShipAvailable(builtObject) &&
                (m === null || (m.type !== BuiltObjectMissionType.MoveAndWait && m.type !== BuiltObjectMissionType.Move) || m.targetHabitat !== refuelFleet.gatherPoint) &&
                (m === null || m.type !== BuiltObjectMissionType.Refuel)
            ) {
                assignMission(galaxy, builtObject, BuiltObjectMissionType.Refuel, stellarObject, null, BuiltObjectMissionPriority.Unavailable, { manuallyAssigned: true });
            }
        }
        return true;
    }
    return false;
}

/** Empire.8.cs 5159 SelectWayPoint(target, requiredFuel). */
function selectWayPoint(galaxy: Galaxy, self: Empire, target: PrioritizedTarget, requiredFuel: FuelTypeRef[]): StellarObject | null {
    const p = target.resolveTargetCoordinates();
    return decideBestFleetRefuelPoint(galaxy, self, p.x, p.y, self, requiredFuel, target.empire);
}

/** Empire.8.cs 4712 SelectWayPointOnTheWay(fleet, targetX, targetY, targetEmpire). */
export function selectWayPointOnTheWayFleet(galaxy: Galaxy, self: Empire, fleet: ShipGroup, targetX: number, targetY: number, targetEmpire: Empire | null): StellarObject | null {
    if (fleet.leadShip !== null) {
        const maxFuelRange = currentRange(fleet.leadShip);
        return selectWayPointOnTheWay(galaxy, self, fleet.leadShip.xpos, fleet.leadShip.ypos, targetX, targetY, fleet.empire!, targetEmpire, maxFuelRange, fleet);
    }
    return null;
}

/** Empire.8.cs 4722 SelectWayPointOnTheWay(x, y, targetX, targetY, empire, empireToExclude, fuelType, maxFuelRange, fleet) (fuelType unused). */
export function selectWayPointOnTheWay(galaxy: Galaxy, self: Empire, x: number, y: number, targetX: number, targetY: number, empire: Empire, empireToExclude: Empire | null, maxFuelRange: number, fleet: ShipGroup | null): StellarObject | null {
    let stellarObject: StellarObject | null = null;
    const requiredFuel = determineFuelRequiredForFleet(fleet).requiredFuel;
    let num = maxFuelRange;
    const num2 = determineAngle(x, y, targetX, targetY);
    let num3 = 0;
    while (stellarObject === null && num3 < 5) {
        num *= 0.67;
        const x2 = x + Math.cos(num2) * num;
        const y2 = y + Math.sin(num2) * num;
        stellarObject = decideBestFleetRefuelPoint(galaxy, self, x2, y2, empire, requiredFuel, empireToExclude);
        if (stellarObject !== null) {
            const num4 = galaxy.calculateDistance(x, y, stellarObject.xpos, stellarObject.ypos);
            if (num4 < maxFuelRange) {
                if (fleet !== null && !shipGroupCheckFleetTargetWithinFuelRange(galaxy, fleet, stellarObject.xpos, stellarObject.ypos, 0.0)) stellarObject = null;
            } else {
                stellarObject = null;
            }
        }
        num3++;
    }
    return stellarObject;
}

/** Empire.8.cs 3582/3587 DetermineLatestArrivalAtDestination(fleet, x, y). */
function determineLatestArrivalAtDestination(galaxy: Galaxy, fleet: ShipGroup, x: number, y: number): number {
    const currentStarDate = galaxyStarDate(galaxy);
    let num = currentStarDate;
    const val = shipGroupWarpSpeed(fleet);
    for (let i = 0; i < fleet.ships.length; i++) {
        const builtObject = fleet.ships[i];
        if (shipGroupIsShipAvailable(builtObject)) {
            const num2 = galaxy.calculateDistance(builtObject.xpos, builtObject.ypos, x, y);
            const num3 = csDoubleToLong((num2 / Math.min(warpSpeedWithBonuses(builtObject), val)) * 1000.0);
            const num4 = 12000;
            const num5 = currentStarDate + num3 + num4;
            if (num5 > num) num = num5;
        }
    }
    return num;
}

/** Galaxy.DetermineGalaxyLocationsAtPoint(x, y, NebulaCloud)[0].Effect == MovementSlowed. */
function nebulaSlowsMovementAt(galaxy: Galaxy, x: number, y: number): boolean {
    const galaxyLocationList: GalaxyLocation[] = galaxy.determineGalaxyLocationsAtPoint(x, y, GalaxyLocationType.NebulaCloud);
    return galaxyLocationList.length > 0 && galaxyLocationList[0].effect === GalaxyLocationEffectType.MovementSlowed;
}

/** Empire.8.cs 3379 AssignFleetGatherAttackMission(fleet, target, gatherX, gatherY, missionType). */
function assignFleetGatherAttackMission(galaxy: Galaxy, self: Empire, fleet: ShipGroup, target: MissionTarget | null, gatherX: number, gatherY: number, missionType: BuiltObjectMissionType): boolean {
    void self;
    let result = false;
    // 3382-3404: the target's position is read and discarded.
    let num = 30000;
    if (nebulaSlowsMovementAt(galaxy, gatherX, gatherY)) num = csDoubleToLong(num * 1.333);
    const starDate = determineLatestArrivalAtDestination(galaxy, fleet, gatherX, gatherY) + num;
    const assign = (t: MissionTarget): void => {
        switch (missionType) {
            case BuiltObjectMissionType.Attack:
            case BuiltObjectMissionType.WaitAndAttack:
                result = shipGroupAssignMissionFull(galaxy, fleet, BuiltObjectMissionType.WaitAndAttack, t, null, null, null, gatherX, gatherY, starDate, BuiltObjectMissionPriority.High, false);
                break;
            case BuiltObjectMissionType.WaitAndBombard:
            case BuiltObjectMissionType.Bombard:
                result = shipGroupAssignMissionFull(galaxy, fleet, BuiltObjectMissionType.WaitAndBombard, t, null, null, null, gatherX, gatherY, starDate, BuiltObjectMissionPriority.High, false);
                break;
        }
    };
    if (isHabitat(target)) {
        forceCompleteMission(galaxy, fleet);
        assign(target);
    } else if (isBuiltObject(target)) {
        forceCompleteMission(galaxy, fleet);
        assign(target);
    } else if (isShipGroup(target)) {
        const shipGroup2 = target;
        if (shipGroup2.leadShip!.currentSpeed < Math.fround(shipGroup2.leadShip!.warpSpeed) && !shipGroup2.leadShip!.hyperjumpPrepare) {
            forceCompleteMission(galaxy, fleet);
            assign(shipGroup2);
        }
    }
    return result;
}

/** Empire.8.cs 3470 AssignFleetWaypointAttackMission(fleet, target, missionType). */
function assignFleetWaypointAttackMission(galaxy: Galaxy, self: Empire, fleet: ShipGroup, target: MissionTarget | null, missionType: BuiltObjectMissionType): boolean {
    let result = false;
    let x = 0.0;
    let y = 0.0;
    let empireToExclude: Empire | null = null;
    if (target !== null) {
        if (isBuiltObject(target)) {
            x = target.xpos;
            y = target.ypos;
            empireToExclude = target.empire;
        } else if (isHabitat(target)) {
            x = target.xpos;
            y = target.ypos;
            empireToExclude = target.empire;
        } else if (isCreature(target)) {
            x = target.xpos;
            y = target.ypos;
        } else if (isShipGroup(target)) {
            if (target.leadShip !== null) {
                x = target.leadShip.xpos;
                y = target.leadShip.ypos;
                empireToExclude = target.empire;
            }
        }
    }
    const requiredFuel = determineFuelRequiredForFleet(fleet).requiredFuel;
    const stellarObject = decideBestFleetRefuelPoint(galaxy, self, x, y, self, requiredFuel, empireToExclude);
    if (stellarObject !== null) {
        let num = 2;
        if (stellarDockingBays(stellarObject) != null) num = stellarDockingBays(stellarObject)!.length;
        let val = Math.trunc((fleet.ships.length * FLEET_ASSEMBLE_ATTACK_WAIT_PERIOD_PER_SHIP) / num);
        val = Math.max(val, FLEET_ASSEMBLE_ATTACK_WAIT_PERIOD_PER_SHIP);
        let num2 = 45000;
        // C# `num2 *= (long)((double)num2 * 1.333)` (multiplies, not scales) — ported as written.
        if (nebulaSlowsMovementAt(galaxy, stellarObject.xpos, stellarObject.ypos)) num2 *= csDoubleToLong(num2 * 1.333);
        const starDate = determineLatestArrivalAtDestination(galaxy, fleet, stellarObject.xpos, stellarObject.ypos) + num2 + val;
        const assign = (t: MissionTarget): void => {
            switch (missionType) {
                case BuiltObjectMissionType.Attack:
                case BuiltObjectMissionType.WaitAndAttack:
                    result = shipGroupAssignMission(galaxy, fleet, BuiltObjectMissionType.WaitAndAttack, t, stellarObject, BuiltObjectMissionPriority.High, false, null, starDate);
                    break;
                case BuiltObjectMissionType.WaitAndBombard:
                case BuiltObjectMissionType.Bombard:
                    result = shipGroupAssignMission(galaxy, fleet, BuiltObjectMissionType.WaitAndBombard, t, stellarObject, BuiltObjectMissionPriority.High, false, null, starDate);
                    break;
            }
        };
        if (isHabitat(target)) {
            forceCompleteMission(galaxy, fleet);
            assign(target);
        } else if (isBuiltObject(target)) {
            forceCompleteMission(galaxy, fleet);
            assign(target);
        } else if (isShipGroup(target)) {
            const shipGroup2 = target;
            if (shipGroup2.leadShip!.currentSpeed < Math.fround(shipGroup2.leadShip!.warpSpeed) && !shipGroup2.leadShip!.hyperjumpPrepare) {
                forceCompleteMission(galaxy, fleet);
                assign(shipGroup2);
            }
        }
    }
    return result;
}

/**
 * Empire.8.cs 3335 CheckAssignFleetWaitAndAttackMission(fleet, ref missionType, target, priority): returns
 * { assigned, missionType } (the `ref` result).
 */
export function checkAssignFleetWaitAndAttackMission(galaxy: Galaxy, self: Empire, fleet: ShipGroup, missionType: BuiltObjectMissionType, target: MissionTarget | null, priority: BuiltObjectMissionPriority): { assigned: boolean; missionType: BuiltObjectMissionType } {
    void self;
    void priority;
    if (missionType === BuiltObjectMissionType.WaitAndAttack || missionType === BuiltObjectMissionType.WaitAndBombard) {
        if (shipGroupCheckNeedRefuelBeforeAttack(galaxy, fleet, target)) {
            if (assignFleetWaypointAttackMission(galaxy, fleet.empire!, fleet, target, missionType)) return { assigned: true, missionType };
        } else {
            const g = shipGroupCheckNeedGatherBeforeAttack(galaxy, fleet, target);
            if (g.result) {
                const gp = shipGroupIdentifyFleetGatherLocation(galaxy, fleet, g.targetX, g.targetY, g.targetGatherRange);
                if (assignFleetGatherAttackMission(galaxy, fleet.empire!, fleet, target, gp.gatherX, gp.gatherY, missionType)) return { assigned: true, missionType };
            } else if (missionType === BuiltObjectMissionType.WaitAndAttack) {
                missionType = BuiltObjectMissionType.Attack;
            } else if (missionType === BuiltObjectMissionType.WaitAndBombard) {
                missionType = BuiltObjectMissionType.Bombard;
            }
        }
    }
    if (missionType === BuiltObjectMissionType.WaitAndAttack) missionType = BuiltObjectMissionType.Attack;
    else if (missionType === BuiltObjectMissionType.WaitAndBombard) missionType = BuiltObjectMissionType.Bombard;
    return { assigned: false, missionType };
}

// ---------------------------------------------------------------------------------------------------------------
// War targets (Empire.8.cs 1146-1420, 4504; Empire.9.cs 3704)
// ---------------------------------------------------------------------------------------------------------------

/** Empire.8.cs 1358/1364 CalculateDefendingStrength(target, out troopStrength). */
export function calculateDefendingStrength(galaxy: Galaxy, self: Empire, target: StellarObject): { strength: number; troopStrength: number } {
    let result = 0;
    let troopStrength = 0;
    if (isHabitat(target)) {
        const habitat = target;
        result = estimatedDefensiveForceRequired(galaxy, habitat, true, galaxy.difficultyLevel);
        troopStrength = determineRequiredTroopStrength(galaxy, self, habitat);
        if (self.visibility.checkSystemVisible(habitat.systemIndex)) result = determineDefendingStrength(galaxy, habitat, habitat.empire!);
        else if (checkSystemExplored(self, habitat.systemIndex)) result = determineBaseStrengthAtHabitat(galaxy, habitat, habitat.empire);
    } else if (isBuiltObject(target)) {
        const builtObject = target;
        result = calculateOverallStrengthFactor(builtObject);
        troopStrength = 0;
        if (isObjectVisibleToThisEmpire(galaxy, self, builtObject)) result = determineDefendingStrength(galaxy, builtObject, builtObject.empire!);
        result = Math.max(1, result);
    } else if (isCreature(target)) {
        result = target.attackStrength * 5;
    }
    return { strength: result, troopStrength };
}

/** Empire.8.cs 1322/1327 CheckFleetCanAttackTarget(fleet, target, supportingOtherAttack). */
function checkFleetCanAttackTarget(galaxy: Galaxy, self: Empire, fleet: ShipGroup, target: StellarObject, supportingOtherAttack = false): boolean {
    let num = 0.85;
    if (supportingOtherAttack) num = 0.35;
    const d = calculateDefendingStrength(galaxy, self, target);
    const num2 = d.strength;
    const num3 = shipGroupTotalOverallStrengthFactor(galaxy, fleet) / num2;
    if (num3 < num) return false;
    if (isHabitat(target)) {
        let num4 = 1.2;
        if (supportingOtherAttack) num4 = 0.5;
        const totalTroopAttackStrength = shipGroupTotalTroopAttackStrength(fleet);
        if (totalTroopAttackStrength > csDoubleToInt(d.troopStrength * num4)) return true;
        return false;
    }
    return true;
}

/** Empire.8.cs 1394 CheckTargetRequiresMoreAttackFleets(target, targetEmpire, out fleetAlreadyAssigned). */
function checkTargetRequiresMoreAttackFleets(galaxy: Galaxy, self: Empire, target: StellarObject): { result: boolean; fleetAlreadyAssigned: boolean } {
    let fleetAlreadyAssigned = false;
    const c = countFleetAttackStrengthAssignedToTargetObject(galaxy, self, target);
    const num = c.strength;
    if (num > 0) fleetAlreadyAssigned = true;
    const d = calculateDefendingStrength(galaxy, self, target);
    const num2 = d.strength;
    if (num < num2 || c.troopStrengthAssigned < csDoubleToInt(d.troopStrength * 1.7)) return { result: true, fleetAlreadyAssigned };
    return { result: false, fleetAlreadyAssigned };
}

/** Empire.8.cs 1412 CheckWarObjectiveStillValid(target, targetEmpire). */
function checkWarObjectiveStillValid(target: StellarObject | null, targetEmpire: Empire): boolean {
    if (target === null || target.hasBeenDestroyed || stellarObjectEmpire(target) !== targetEmpire) return false;
    return true;
}

/** Galaxy.6.cs 4651 SortHabitatsByDistanceThreadsafe / SortBuiltObjectsByDistanceThreadsafe (squared distance, Array.Sort(keys, items)). */
function sortByDistanceThreadsafe<T extends { xpos: number; ypos: number }>(galaxy: Galaxy, x: number, y: number, items: readonly T[]): T[] {
    return sortStellarObjectsByDistance(galaxy, x, y, items);
}

/** Empire.8.cs 1146/1152 SelectFleetWarAttackTarget(fleet, otherEmpire, out waypointing[, out attackPointClearedForReassignment]). */
export function selectFleetWarAttackTarget(galaxy: Galaxy, empire: Empire, fleet: ShipGroup, otherEmpire: Empire): { target: StellarObject | null; waypointing: boolean; attackPointClearedForReassignment: boolean } {
    const self = empire;
    let waypointing = false;
    let attackPointClearedForReassignment = false;
    const ret = (target: StellarObject | null) => ({ target, waypointing, attackPointClearedForReassignment });
    if (fleet.leadShip !== null && fleet.leadShip.isAutoControlled && fleet.posture === FleetPosture.Attack) {
        const diplomaticRelation = obtainDiplomaticRelation(self, otherEmpire);
        if (diplomaticRelation !== null && diplomaticRelation.warObjective === WarObjective.CaptureObjectives) {
            const bigFleetWithTroops = (): boolean => (fleet.shipTargetAmount >= 10 || fleet.ships.length >= 10) && shipGroupTotalTroopAttackStrength(fleet) > 0;
            if (fleet.attackPoint === null) {
                if (bigFleetWithTroops()) {
                    const array = sortByDistanceThreadsafe(galaxy, fleet.leadShip.xpos, fleet.leadShip.ypos, diplomaticRelation.warObjectiveColonies);
                    for (const habitat of array) {
                        if (!checkWarObjectiveStillValid(habitat, otherEmpire)) continue;
                        const r = checkTargetRequiresMoreAttackFleets(galaxy, self, habitat);
                        if (!r.result || !checkFleetCanAttackTarget(galaxy, self, fleet, habitat, r.fleetAlreadyAssigned)) continue;
                        if (shipGroupCheckFleetTargetWithinFuelRangeAndRefuel(galaxy, fleet, habitat.xpos, habitat.ypos, 0.0)) {
                            fleet.attackPoint = habitat;
                            return ret(habitat);
                        }
                        const requiredFuel = determineFuelRequiredForFleet(fleet).requiredFuel;
                        const stellarObject = decideBestFleetRefuelPoint(galaxy, self, habitat.xpos, habitat.ypos, self, requiredFuel, otherEmpire);
                        if (stellarObject !== null) {
                            const num = shipGroupMaximumRange(fleet);
                            const num2 = galaxy.calculateDistance(stellarObject.xpos, stellarObject.ypos, habitat.xpos, habitat.ypos);
                            if (num2 < num * 0.45 && shipGroupCheckFleetTargetWithinFuelRange(galaxy, fleet, stellarObject.xpos, stellarObject.ypos, 0.1)) {
                                waypointing = true;
                                fleet.gatherPoint = stellarObject;
                                fleet.attackPoint = habitat;
                                fleet.postureRangeSquared = POSTURE_RANGE_SQUARED_ATTACK_POINT;
                                shipGroupAssignMission(galaxy, fleet, BuiltObjectMissionType.Refuel, stellarObject, null, BuiltObjectMissionPriority.Unavailable, true);
                                return ret(habitat);
                            }
                        }
                    }
                }
                const array2 = sortByDistanceThreadsafe(galaxy, fleet.leadShip.xpos, fleet.leadShip.ypos, diplomaticRelation.warObjectiveBases);
                for (const builtObject of array2) {
                    if (!checkWarObjectiveStillValid(builtObject, otherEmpire)) continue;
                    const r2 = checkTargetRequiresMoreAttackFleets(galaxy, self, builtObject);
                    if (!r2.result || !checkFleetCanAttackTarget(galaxy, self, fleet, builtObject, r2.fleetAlreadyAssigned)) continue;
                    if (shipGroupCheckFleetTargetWithinFuelRangeAndRefuel(galaxy, fleet, builtObject.xpos, builtObject.ypos, 0.0)) {
                        fleet.attackPoint = builtObject;
                        return ret(builtObject);
                    }
                    const requiredFuel2 = determineFuelRequiredForFleet(fleet).requiredFuel;
                    const stellarObject2 = decideBestFleetRefuelPoint(galaxy, self, builtObject.xpos, builtObject.ypos, self, requiredFuel2, otherEmpire);
                    if (stellarObject2 !== null) {
                        const num3 = shipGroupMaximumRange(fleet);
                        const num4 = galaxy.calculateDistance(stellarObject2.xpos, stellarObject2.ypos, builtObject.xpos, builtObject.ypos);
                        if (num4 < num3 * 0.45 && shipGroupCheckFleetTargetWithinFuelRange(galaxy, fleet, stellarObject2.xpos, stellarObject2.ypos, 0.1)) {
                            waypointing = true;
                            fleet.gatherPoint = stellarObject2;
                            fleet.attackPoint = builtObject;
                            fleet.postureRangeSquared = POSTURE_RANGE_SQUARED_ATTACK_POINT;
                            shipGroupAssignMission(galaxy, fleet, BuiltObjectMissionType.Refuel, stellarObject2, null, BuiltObjectMissionPriority.Unavailable, true);
                            return ret(builtObject);
                        }
                    }
                }
                fleet.attackPoint = null;
            } else if (checkWarObjectiveStillValid(fleet.attackPoint, otherEmpire)) {
                if (checkFleetCanAttackTarget(galaxy, self, fleet, fleet.attackPoint)) return ret(fleet.attackPoint);
                fleet.attackPoint = null;
                attackPointClearedForReassignment = true;
            } else {
                let array3: Habitat[] = [];
                if (bigFleetWithTroops()) array3 = sortByDistanceThreadsafe(galaxy, fleet.leadShip.xpos, fleet.leadShip.ypos, diplomaticRelation.warObjectiveColonies);
                if (bigFleetWithTroops()) {
                    for (const habitat2 of array3) {
                        if (!checkWarObjectiveStillValid(habitat2, otherEmpire)) continue;
                        const num5 = galaxy.calculateDistanceSquared(fleet.attackPoint.xpos, fleet.attackPoint.ypos, habitat2.xpos, habitat2.ypos);
                        if (num5 <= fleet.postureRangeSquared) {
                            const r3 = checkTargetRequiresMoreAttackFleets(galaxy, self, habitat2);
                            if (r3.result && checkFleetCanAttackTarget(galaxy, self, fleet, habitat2, r3.fleetAlreadyAssigned) && shipGroupCheckFleetTargetWithinFuelRangeAndRefuel(galaxy, fleet, habitat2.xpos, habitat2.ypos, 0.0)) return ret(habitat2);
                        }
                    }
                }
                const array4 = sortByDistanceThreadsafe(galaxy, fleet.leadShip.xpos, fleet.leadShip.ypos, diplomaticRelation.warObjectiveBases);
                for (const builtObject2 of array4) {
                    if (!checkWarObjectiveStillValid(builtObject2, otherEmpire)) continue;
                    const num6 = galaxy.calculateDistanceSquared(fleet.attackPoint.xpos, fleet.attackPoint.ypos, builtObject2.xpos, builtObject2.ypos);
                    if (num6 <= fleet.postureRangeSquared) {
                        const r4 = checkTargetRequiresMoreAttackFleets(galaxy, self, builtObject2);
                        if (r4.result && checkFleetCanAttackTarget(galaxy, self, fleet, builtObject2, r4.fleetAlreadyAssigned) && shipGroupCheckFleetTargetWithinFuelRangeAndRefuel(galaxy, fleet, builtObject2.xpos, builtObject2.ypos, 0.0)) return ret(builtObject2);
                    }
                }
                if (bigFleetWithTroops()) {
                    for (const habitat3 of array3) {
                        if (checkWarObjectiveStillValid(habitat3, otherEmpire)) {
                            const r5 = checkTargetRequiresMoreAttackFleets(galaxy, self, habitat3);
                            if (r5.result && checkFleetCanAttackTarget(galaxy, self, fleet, habitat3, r5.fleetAlreadyAssigned) && shipGroupCheckFleetTargetWithinFuelRangeAndRefuel(galaxy, fleet, habitat3.xpos, habitat3.ypos, 0.0)) {
                                fleet.attackPoint = habitat3;
                                return ret(habitat3);
                            }
                        }
                    }
                }
                for (const builtObject3 of array4) {
                    if (checkWarObjectiveStillValid(builtObject3, otherEmpire)) {
                        const r6 = checkTargetRequiresMoreAttackFleets(galaxy, self, builtObject3);
                        if (r6.result && checkFleetCanAttackTarget(galaxy, self, fleet, builtObject3, r6.fleetAlreadyAssigned) && shipGroupCheckFleetTargetWithinFuelRangeAndRefuel(galaxy, fleet, builtObject3.xpos, builtObject3.ypos, 0.0)) {
                            fleet.attackPoint = builtObject3;
                            return ret(builtObject3);
                        }
                    }
                }
                fleet.attackPoint = null;
            }
        }
    }
    return ret(null);
}

/** Empire.8.cs 4504 CheckBombardEnemyColony(enemyColony, attackFleet). */
export function checkBombardEnemyColony(galaxy: Galaxy, empire: Empire, enemyColony: Habitat, attackFleet: ShipGroup): boolean {
    let result = false;
    if (enemyColony.empire !== empire && enemyColony.population !== null && enemyColony.population.totalAmount > 0) {
        if (shipGroupTotalBombardPower(attackFleet) > 0) result = checkUseBombardmentAgainstEmpire(galaxy, empire, enemyColony.empire);
        if (enemyColony.planetaryShieldPresent) result = false;
    }
    return result;
}

/** Empire.9.cs 3704 IdentifyEmpireStrikePoints(empire). Rnd: Next(0, 3) when DominantRace.AggressionLevel > 115. */
export function identifyEmpireStrikePoints(galaxy: Galaxy, self: Empire, empire: Empire): PrioritizedTarget[] {
    const prioritizedTargetList: PrioritizedTarget[] = [];
    const num = 1.0;
    const num2 = 1.0;
    const num3 = 1.0;
    const num4 = 1.0;
    const targetHabitat = self.targetHabitat;
    if (targetHabitat !== null && checkSystemExplored(self, targetHabitat.systemIndex) && targetHabitat.empire !== null && targetHabitat.empire === empire && !targetHabitat.hasBeenDestroyed) {
        prioritizedTargetListAdd(prioritizedTargetList, new PrioritizedTarget(targetHabitat, 1000000000));
    }
    if (!self.reclusive && empire.colonies !== null) {
        for (let i = 0; i < empire.colonies.length; i++) {
            const habitat = empire.colonies[i];
            if (checkSystemExplored(self, habitat.systemIndex) || isObjectVisibleToThisEmpire(galaxy, self, habitat)) {
                const priority = Math.trunc(1050000.0 * num);
                prioritizedTargetListAdd(prioritizedTargetList, new PrioritizedTarget(habitat, priority));
            }
        }
    }
    if (empire.spacePorts !== null) {
        for (let j = 0; j < empire.spacePorts.length; j++) {
            const builtObject = empire.spacePorts[j];
            if (isObjectVisibleToThisEmpire(galaxy, self, builtObject) && builtObject.parentHabitat !== null) {
                let priority2 = Math.trunc(1000000.0 * num2);
                let prioritizedTarget3 = new PrioritizedTarget(builtObject.parentHabitat, priority2);
                if (self.reclusive) prioritizedTarget3 = new PrioritizedTarget(builtObject, priority2);
                if (builtObject.parentHabitat.empire === null) {
                    priority2 = Math.trunc(20000.0 * num2);
                    prioritizedTarget3 = new PrioritizedTarget(builtObject, priority2);
                }
                prioritizedTargetListAdd(prioritizedTargetList, prioritizedTarget3);
            }
        }
    }
    if (empire.miningStations !== null) {
        for (let k = 0; k < empire.miningStations.length; k++) {
            const builtObject2 = empire.miningStations[k];
            if (isObjectVisibleToThisEmpire(galaxy, self, builtObject2)) prioritizedTargetListAdd(prioritizedTargetList, new PrioritizedTarget(builtObject2, Math.trunc(1000000.0 * num3)));
        }
    }
    if (empire.researchFacilities !== null) {
        const researchFacilities = empire.researchFacilities as BuiltObject[];
        for (let l = 0; l < researchFacilities.length; l++) {
            const builtObject3 = researchFacilities[l];
            if (isObjectVisibleToThisEmpire(galaxy, self, builtObject3)) prioritizedTargetListAdd(prioritizedTargetList, new PrioritizedTarget(builtObject3, 500000));
        }
    }
    if (aggressionLevel(self) > 115 && galaxy.rnd.next(0, 3) === 1 && empire.resortBases !== null) {
        const resortBases = empire.resortBases as BuiltObject[];
        for (let m = 0; m < resortBases.length; m++) {
            const builtObject4 = resortBases[m];
            if (isObjectVisibleToThisEmpire(galaxy, self, builtObject4)) prioritizedTargetListAdd(prioritizedTargetList, new PrioritizedTarget(builtObject4, 500000));
        }
    }
    if (empire.longRangeScanners !== null) {
        const longRangeScanners = empire.longRangeScanners as BuiltObject[];
        for (let n = 0; n < longRangeScanners.length; n++) {
            const builtObject5 = longRangeScanners[n];
            if (builtObject5.subRole !== BuiltObjectSubRole.SmallSpacePort && builtObject5.subRole !== BuiltObjectSubRole.MediumSpacePort && builtObject5.subRole !== BuiltObjectSubRole.LargeSpacePort && isObjectVisibleToThisEmpire(galaxy, self, builtObject5)) {
                prioritizedTargetListAdd(prioritizedTargetList, new PrioritizedTarget(builtObject5, 500000));
            }
        }
    }
    const targetShipGroups = shipGroupsOf(empire);
    if (targetShipGroups !== null) {
        for (let num5 = 0; num5 < targetShipGroups.length; num5++) {
            const shipGroup = targetShipGroups[num5];
            if (shipGroup.leadShip !== null && isObjectVisibleToThisEmpire(galaxy, self, shipGroup.leadShip) && shipGroup.leadShip.currentSpeed < Math.fround(shipGroup.leadShip.warpSpeed)) {
                prioritizedTargetListAdd(prioritizedTargetList, new PrioritizedTarget(shipGroup, Math.trunc(1000000.0 * num4)));
            }
        }
    }
    sortPrioritizedTargets(prioritizedTargetList);
    prioritizedTargetList.reverse();
    for (let num6 = 0; num6 < prioritizedTargetList.length; num6++) {
        const prioritizedTarget9 = prioritizedTargetList[num6];
        let num7 = 0;
        let distanceFromAttackingEmpire = 1000000.0;
        let habitat3: Habitat | null = null;
        const strategicValueThreshhold = 1000000;
        const t = prioritizedTarget9.target;
        if (isHabitat(t)) {
            const habitat4 = t;
            habitat3 = fastFindNearestColony(galaxy, habitat4.xpos, habitat4.ypos, self, strategicValueThreshhold);
            if (habitat3 === null) habitat3 = self.capital;
            if (habitat3 !== null) {
                distanceFromAttackingEmpire = galaxy.calculateDistance(habitat3.xpos, habitat3.ypos, habitat4.xpos, habitat4.ypos);
                const habitat2 = determineHabitatSystemStar(habitat4);
                if (habitat2 !== null) {
                    if (checkSystemVisibleStar(self, habitat2)) {
                        num7 += determineDefendingStrength(galaxy, habitat4, empire);
                    } else {
                        num7 = csDoubleToInt(estimatedDefensiveForceRequired(galaxy, habitat4, true, galaxy.difficultyLevel) * 1.5);
                        const builtObject6 = determineSpacePortAtColony(galaxy, habitat4);
                        if (builtObject6 !== null) {
                            num7 = csDoubleToInt(estimatedDefensiveForceRequired(galaxy, habitat4, true, galaxy.difficultyLevel) * 1.0);
                            num7 += calculateOverallStrengthFactor(builtObject6);
                        }
                    }
                } else {
                    num7 = csDoubleToInt(estimatedDefensiveForceRequired(galaxy, habitat4, true, galaxy.difficultyLevel) * 1.5);
                }
            } else {
                num7 = csDoubleToInt(estimatedDefensiveForceRequired(galaxy, habitat4, true, galaxy.difficultyLevel) * 1.5);
            }
        } else if (isBuiltObject(t)) {
            const builtObject7 = t;
            habitat3 = fastFindNearestColony(galaxy, builtObject7.xpos, builtObject7.ypos, self, strategicValueThreshhold);
            if (habitat3 === null) habitat3 = self.capital;
            if (habitat3 !== null) {
                distanceFromAttackingEmpire = galaxy.calculateDistance(habitat3.xpos, habitat3.ypos, builtObject7.xpos, builtObject7.ypos);
                num7 =
                    builtObject7.nearestSystemStar === null
                        ? calculateOverallStrengthFactor(builtObject7)
                        : !self.visibility.checkSystemVisible(builtObject7.nearestSystemStar.systemIndex)
                          ? builtObject7.parentHabitat === null
                              ? calculateOverallStrengthFactor(builtObject7)
                              : csDoubleToInt(estimatedDefensiveForceRequired(galaxy, builtObject7.parentHabitat, true, galaxy.difficultyLevel) * 1.5)
                          : determineDefendingStrength(galaxy, builtObject7, empire);
            } else {
                num7 = calculateOverallStrengthFactor(builtObject7);
            }
        } else if (isShipGroup(t)) {
            const shipGroup2 = t;
            if (shipGroup2.leadShip !== null) {
                habitat3 = fastFindNearestColony(galaxy, shipGroup2.leadShip.xpos, shipGroup2.leadShip.ypos, self, strategicValueThreshhold);
                if (habitat3 === null) habitat3 = self.capital;
                if (habitat3 !== null) {
                    distanceFromAttackingEmpire = galaxy.calculateDistance(habitat3.xpos, habitat3.ypos, shipGroup2.leadShip.xpos, shipGroup2.leadShip.ypos);
                    num7 =
                        shipGroup2.leadShip.nearestSystemStar === null
                            ? shipGroupTotalOverallStrengthFactor(galaxy, shipGroup2)
                            : !self.visibility.checkSystemVisible(shipGroup2.leadShip.nearestSystemStar.systemIndex)
                              ? shipGroupTotalOverallStrengthFactor(galaxy, shipGroup2)
                              : determineDefendingStrengthFleet(galaxy, shipGroup2, empire);
                } else {
                    num7 = shipGroupTotalOverallStrengthFactor(galaxy, shipGroup2);
                }
            }
        }
        num7 = Math.max(50, num7);
        prioritizedTarget9.locationStrength = num7;
        prioritizedTarget9.distanceFromAttackingEmpire = distanceFromAttackingEmpire;
    }
    sortPrioritizedTargets(prioritizedTargetList);
    prioritizedTargetList.reverse();
    return prioritizedTargetList;
}

/** PrioritizedTargetList.cs 60 IdentifyBestTargetFromLocation(empire, x, y, troopStrengthAvailable, firePowerAvailable, targetsToExclude). */
function identifyBestTargetFromLocation(galaxy: Galaxy, list: readonly PrioritizedTarget[], empire: Empire, x: number, y: number, troopStrengthAvailable: number, firePowerAvailable: number, targetsToExclude: PrioritizedTarget[] | null): PrioritizedTarget | null {
    let prioritizedTarget1: PrioritizedTarget | null = null;
    let num1 = 0.0;
    if (targetsToExclude === null) targetsToExclude = [];
    let num2 = 0;
    for (let index = 0; index < list.length; ++index) {
        const prioritizedTarget2 = list[index];
        if (!targetsToExclude.includes(prioritizedTarget2)) {
            let x2 = -1.0;
            let y2 = -1.0;
            const t = prioritizedTarget2.target;
            if (isBuiltObject(t)) {
                x2 = t.xpos;
                y2 = t.ypos;
                num2 = 0;
            } else if (isHabitat(t)) {
                x2 = t.xpos;
                y2 = t.ypos;
                num2 = determineRequiredTroopStrength(galaxy, empire, t);
            } else if (isShipGroup(t)) {
                if (t.leadShip !== null) {
                    x2 = t.leadShip.xpos;
                    y2 = t.leadShip.ypos;
                }
                num2 = 0;
            }
            if (x2 >= 0.0 && y2 >= 0.0 && troopStrengthAvailable >= num2 && firePowerAvailable >= csDoubleToInt(prioritizedTarget2.locationStrength * 0.75)) {
                const distanceFactor = calculateDistanceFactor(calculateDistanceStatic(x, y, x2, y2));
                const num3 = prioritizedTarget2.priority / distanceFactor;
                if (num3 > num1) {
                    num1 = num3;
                    prioritizedTarget1 = prioritizedTarget2;
                }
            }
        }
    }
    return prioritizedTarget1;
}

/** Empire.8.cs 4521 AssignFleetAttackMission(fleet, ref targets, ref refusalCount). */
export function assignFleetAttackMission(galaxy: Galaxy, empire: Empire, fleet: ShipGroup, targets: PrioritizedTarget[], refusalCount: RefCount): boolean {
    const self = empire;
    let flag = false;
    let flag2 = false;
    if (isShipGroupAvailableWithAttackStrength(galaxy, fleet, BuiltObjectMissionPriority.Normal, 0)) {
        const prioritizedTargetList: PrioritizedTarget[] = [];
        let prioritizedTarget: PrioritizedTarget | null = null;
        const iterationCount = { value: 0 };
        const autoOrSemi = (): boolean => fleet.leadShip!.isAutoControlled || self.controlMilitaryAttacks === AutomationLevel.PartiallyAutomated;
        while (conditionCheckLimit(!flag && !flag2, 200, iterationCount)) {
            prioritizedTarget = identifyBestTargetFromLocation(galaxy, targets, self, fleet.leadShip!.xpos, fleet.leadShip!.ypos, shipGroupTotalTroopAttackStrengthNearby(galaxy, fleet, 0.3), shipGroupTotalOverallStrengthFactor(galaxy, fleet), prioritizedTargetList);
            if (prioritizedTarget !== null) {
                prioritizedTargetListAdd(prioritizedTargetList, prioritizedTarget);
                const num = countFleetAttackStrengthAssignedToTarget(galaxy, self, prioritizedTarget);
                if (prioritizedTarget.locationStrength < num) continue;
                const pt = prioritizedTarget.target;
                if (isShipGroup(pt)) {
                    const shipGroup = pt;
                    if (shipGroup.leadShip!.currentSpeed < Math.fround(shipGroup.leadShip!.warpSpeed) && !shipGroup.leadShip!.hyperjumpPrepare) {
                        const locationStrength = prioritizedTarget.locationStrength;
                        if (
                            shipGroupTotalOverallStrengthFactor(galaxy, fleet) > locationStrength &&
                            shipGroupCheckFleetTargetWithinFuelRangeAndRefuel(galaxy, fleet, shipGroup.leadShip!.xpos, shipGroup.leadShip!.ypos, 0.0) &&
                            autoOrSemi() &&
                            checkTaskAuthorized(galaxy, self, self.controlMilitaryAttacks, refusalCount, generateAutomationMessageAttackEnemyFleet(shipGroup, fleet), shipGroup, AdvisorMessageType.EnemyAttack, null, fleet, null)
                        ) {
                            forceCompleteMission(galaxy, fleet);
                            shipGroupAssignMission(galaxy, fleet, BuiltObjectMissionType.Attack, shipGroup, null, BuiltObjectMissionPriority.High, false);
                            flag = true;
                        }
                    }
                    continue;
                }
                const num2 = determineRequiredTroopStrength(galaxy, self, pt);
                if (shipGroupTotalTroopAttackStrengthNearby(galaxy, fleet, 0.3) < num2) continue;
                let builtObjectMissionType = BuiltObjectMissionType.Attack;
                let advisorMessageType = AdvisorMessageType.EnemyAttack;
                let num3 = -1.0;
                let num4 = -1.0;
                if (isBuiltObject(pt)) {
                    num3 = pt.xpos;
                    num4 = pt.ypos;
                } else if (isHabitat(pt)) {
                    num3 = pt.xpos;
                    num4 = pt.ypos;
                    if (checkBombardEnemyColony(galaxy, self, pt, fleet)) {
                        builtObjectMissionType = BuiltObjectMissionType.Bombard;
                        advisorMessageType = AdvisorMessageType.EnemyBombard;
                    }
                }
                if (shipGroupCheckFleetTargetWithinFuelRangeAndRefuel(galaxy, fleet, num3, num4, 0.0)) {
                    if (isHabitat(pt)) {
                        const habitat2 = pt;
                        let taskDescription = generateAutomationMessageAttackEnemyColony(galaxy, habitat2, false, fleet);
                        if (builtObjectMissionType === BuiltObjectMissionType.Bombard) taskDescription = generateAutomationMessageBombardColony(habitat2, fleet);
                        if (autoOrSemi() && checkTaskAuthorized(galaxy, self, self.controlMilitaryAttacks, refusalCount, taskDescription, habitat2, advisorMessageType, null, fleet, null)) {
                            forceCompleteMission(galaxy, fleet);
                            shipGroupAssignMission(galaxy, fleet, builtObjectMissionType, habitat2, null, BuiltObjectMissionPriority.High, false);
                            flag = true;
                        }
                    } else if (isBuiltObject(pt)) {
                        const builtObject2 = pt;
                        if (autoOrSemi() && checkTaskAuthorized(galaxy, self, self.controlMilitaryAttacks, refusalCount, generateAutomationMessageAttackEnemyBase(galaxy, builtObject2, false, fleet), builtObject2, advisorMessageType, null, fleet, null)) {
                            forceCompleteMission(galaxy, fleet);
                            shipGroupAssignMission(galaxy, fleet, builtObjectMissionType, builtObject2, null, BuiltObjectMissionPriority.High, false);
                            flag = true;
                        }
                    } else if (isShipGroup(pt as unknown)) {
                        // Unreachable (fleet targets `continue` above), as in the C#.
                        const shipGroup2 = pt as unknown as ShipGroup;
                        if (
                            shipGroup2.leadShip!.currentSpeed < Math.fround(shipGroup2.leadShip!.warpSpeed) &&
                            !shipGroup2.leadShip!.hyperjumpPrepare &&
                            autoOrSemi() &&
                            checkTaskAuthorized(galaxy, self, self.controlMilitaryAttacks, refusalCount, generateAutomationMessageAttackEnemyFleet(shipGroup2, fleet), shipGroup2, advisorMessageType, null, fleet, null)
                        ) {
                            forceCompleteMission(galaxy, fleet);
                            shipGroupAssignMission(galaxy, fleet, builtObjectMissionType, shipGroup2, null, BuiltObjectMissionPriority.High, false);
                            flag = true;
                        }
                    }
                } else {
                    if (shipGroupWarpSpeed(fleet) <= 0) continue;
                    const requiredFuel = determineFuelRequiredForFleet(fleet).requiredFuel;
                    let stellarObject = selectWayPoint(galaxy, self, prioritizedTarget, requiredFuel);
                    if (stellarObject === null || stellarDockingBays(stellarObject) == null || stellarDockingBays(stellarObject)!.length <= 0) continue;
                    const num5 = shipGroupMaximumRange(fleet);
                    const num6 = galaxy.calculateDistance(stellarObject.xpos, stellarObject.ypos, num3, num4);
                    if (!(num6 < num5 * 0.45)) continue;
                    let num7 = 2;
                    if (stellarDockingBays(stellarObject) != null) num7 = Math.max(1, stellarDockingBays(stellarObject)!.length);
                    const num8 = Math.trunc((fleet.ships.length * FLEET_ASSEMBLE_ATTACK_WAIT_PERIOD_PER_SHIP) / num7);
                    const starDate = determineLatestArrivalAtDestination(galaxy, fleet, stellarObject.xpos, stellarObject.ypos) + num8;
                    if (!shipGroupCheckFleetTargetWithinFuelRange(galaxy, fleet, stellarObject.xpos, stellarObject.ypos, 0.1)) stellarObject = null;
                    if (stellarObject === null) continue;
                    if (isHabitat(pt)) {
                        const habitat3 = pt;
                        if (autoOrSemi() && checkTaskAuthorized(galaxy, self, self.controlMilitaryAttacks, refusalCount, generateAutomationMessageAttackEnemyWithWaypoint(habitat3, false, fleet, stellarObject), habitat3, AdvisorMessageType.EnemyAttack, null, fleet, stellarObject)) {
                            forceCompleteMission(galaxy, fleet);
                            shipGroupAssignMission(galaxy, fleet, BuiltObjectMissionType.WaitAndAttack, habitat3, stellarObject, BuiltObjectMissionPriority.High, false, null, starDate);
                            flag = true;
                        }
                    } else if (isBuiltObject(pt)) {
                        const builtObject3 = pt;
                        if (autoOrSemi() && checkTaskAuthorized(galaxy, self, self.controlMilitaryAttacks, refusalCount, generateAutomationMessageAttackEnemyWithWaypoint(builtObject3, false, fleet, stellarObject), builtObject3, AdvisorMessageType.EnemyAttack, null, fleet, stellarObject)) {
                            forceCompleteMission(galaxy, fleet);
                            shipGroupAssignMission(galaxy, fleet, BuiltObjectMissionType.WaitAndAttack, builtObject3, stellarObject, BuiltObjectMissionPriority.High, false, null, starDate);
                            flag = true;
                        }
                    } else if (isShipGroup(pt as unknown)) {
                        // Unreachable (fleet targets `continue` above), as in the C#.
                        const shipGroup3 = pt as unknown as ShipGroup;
                        if (
                            shipGroup3.leadShip!.currentSpeed < Math.fround(shipGroup3.leadShip!.warpSpeed) &&
                            !shipGroup3.leadShip!.hyperjumpPrepare &&
                            autoOrSemi() &&
                            checkTaskAuthorized(galaxy, self, self.controlMilitaryAttacks, refusalCount, generateAutomationMessageAttackEnemyFleet(shipGroup3, fleet), shipGroup3, AdvisorMessageType.EnemyAttack, null, fleet, stellarObject)
                        ) {
                            forceCompleteMission(galaxy, fleet);
                            shipGroupAssignMission(galaxy, fleet, BuiltObjectMissionType.WaitAndAttack, shipGroup3, stellarObject, BuiltObjectMissionPriority.High, false, null, starDate);
                            flag = true;
                        }
                    } else if (autoOrSemi() && checkTaskAuthorized(galaxy, self, self.controlMilitaryAttacks, refusalCount, '', null, AdvisorMessageType.EnemyAttack, prioritizedTarget.empire)) {
                        forceCompleteMission(galaxy, fleet);
                        shipGroupAssignMission(galaxy, fleet, BuiltObjectMissionType.WaitAndAttack, pt, stellarObject, BuiltObjectMissionPriority.High, false, null, starDate);
                        flag = true;
                    }
                    if (flag && fleet.leadShip!.isAutoControlled && isBuiltObject(stellarObject)) {
                        const builtObject4 = stellarObject;
                        if (
                            builtObject4.parentHabitat !== null &&
                            (builtObject4.subRole === BuiltObjectSubRole.SmallSpacePort || builtObject4.subRole === BuiltObjectSubRole.MediumSpacePort || builtObject4.subRole === BuiltObjectSubRole.LargeSpacePort)
                        ) {
                            fleet.gatherPoint = builtObject4.parentHabitat;
                        }
                    }
                }
            } else {
                flag2 = true;
            }
        }
        if (flag && !flag2 && prioritizedTarget !== null && prioritizedTarget.locationStrength < shipGroupTotalOverallStrengthFactor(galaxy, fleet)) {
            const i = targets.indexOf(prioritizedTarget);
            if (i >= 0) targets.splice(i, 1);
        }
    }
    return flag;
}

// ---------------------------------------------------------------------------------------------------------------
// Incoming enemy fleets (FleetAttack.cs; Empire.6.cs 1776; Empire.1.cs 3198)
// ---------------------------------------------------------------------------------------------------------------

/** FleetAttack.cs: an incoming enemy fleet or planet destroyer and its target. */
export class FleetAttack {
    fleet: ShipGroup | null = null;
    warningDate: number;
    private _target: unknown = null;
    planetDestroyer: BuiltObject | null = null;

    /** FleetAttack(ShipGroup fleet, object target, long starDate) / FleetAttack(BuiltObject planetDestroyer, object target, long starDate). */
    constructor(attacker: ShipGroup | BuiltObject, target: unknown, starDate: number) {
        if (isShipGroup(attacker)) this.fleet = attacker;
        else this.planetDestroyer = attacker;
        this.target = target;
        this.warningDate = starDate;
    }

    /** Target setter: BuiltObject / Habitat / ShipGroup / Creature, anything else null. */
    get target(): unknown {
        return this._target;
    }
    set target(value: unknown) {
        this._target = isBuiltObject(value) || isHabitat(value) || isShipGroup(value) || isCreature(value) ? value : null;
    }

    /** IComparable<FleetAttack>.CompareTo: planet destroyers first. */
    compareTo(other: FleetAttack): number {
        if (this.planetDestroyer !== null && other.planetDestroyer === null) return -1;
        return this.planetDestroyer === null && other.planetDestroyer !== null ? 1 : 0;
    }
}

function incomingOf(empire: Empire): FleetAttack[] {
    return empire.incomingEnemyFleetsAndPlanetDestroyers as FleetAttack[];
}

/** FleetAttackList.cs IndexOf(ShipGroup fleet) / IndexOf(BuiltObject planetDestroyer). */
function fleetAttackIndexOf(list: readonly FleetAttack[], attacker: ShipGroup | BuiltObject): number {
    for (let index = 0; index < list.length; ++index) {
        const fleetAttack = list[index];
        if (fleetAttack == null) continue;
        if (isShipGroup(attacker) ? fleetAttack.fleet === attacker : fleetAttack.planetDestroyer === attacker) return index;
    }
    return -1;
}

/** Empire.6.cs 1932 ResolveAttackWarningDescription(fleetAttack, targetEmpire). */
function resolveAttackWarningDescription(fleetAttack: FleetAttack): string {
    let result = '';
    const describeTarget = (m: BuiltObjectMission): string => {
        let arg = '';
        if (m.targetBuiltObject !== null) arg = m.targetBuiltObject.name;
        else if (m.targetCreature !== null) arg = m.targetCreature.name;
        else if (m.targetHabitat !== null) {
            const targetHabitat = m.targetHabitat;
            const habitat = determineHabitatSystemStar(targetHabitat);
            // TODO(port) M9: Galaxy.ResolveSectorDescription(ResolveSector(x, y)) and ResolveDescription(Type/Category) text.
            arg = formatText(getText('Location Planet'), targetHabitat.type, targetHabitat.category, targetHabitat.name, habitat!.name, '');
        } else if (m.targetShipGroup !== null) arg = m.targetShipGroup.name ?? '';
        return arg;
    };
    if (fleetAttack.fleet !== null && fleetAttack.fleet.mission !== null) {
        result = formatText(getText('Incoming Enemy Fleet'), fleetAttack.fleet.name, fleetAttack.fleet.empire!.name, describeTarget(fleetAttack.fleet.mission));
    } else if (fleetAttack.planetDestroyer !== null && missionOf(fleetAttack.planetDestroyer) !== null) {
        result = formatText(getText('Incoming Enemy Planet Destroyer'), fleetAttack.planetDestroyer.name, fleetAttack.planetDestroyer.empire!.name, describeTarget(missionOf(fleetAttack.planetDestroyer)!));
    }
    return result;
}

/**
 * Empire.6.cs 1776 WarnOfIncomingEnemyFleetsAndPlanetDestroyers(attackedEmpire) on `empire` — called every frame by the
 * frame driver (Main.Part12.cs 3559-3571, tick/scheduler.ts). Fills the attacked empire's
 * IncomingEnemyFleetsAndPlanetDestroyers list (read by RespondToIncomingEnemyFleetsAndPlanetDestroyers) and sends
 * IncomingEnemyFleet messages. Galaxy.GlobalVictoryConditions (DefendHabitat / TargetHabitat) are not modelled
 * (deferred victory conditions, plan §0.3): null, so flag2 stays false. No Rnd.
 */
export function warnOfIncomingEnemyFleetsAndPlanetDestroyers(galaxy: Galaxy, empire: Empire, empireToWarn: Empire | null): void {
    const self = empire;
    const attackedEmpire = empireToWarn;
    // The C# frame driver always has a player empire; a headless galaxy without one has nobody to warn.
    if (attackedEmpire === null) return;
    if (obtainDiplomaticRelation(self, attackedEmpire).type !== DiplomaticRelationType.War) return;
    const planetDestroyers = planetDestroyersOf(self);
    if (planetDestroyers !== null) {
        for (let i = 0; i < planetDestroyers.length; i++) {
            const builtObject = planetDestroyers[i];
            const mission = missionOf(builtObject);
            let flag = false;
            if (mission !== null) {
                if (mission.type === BuiltObjectMissionType.Attack) {
                    flag = true;
                } else if (mission.type === BuiltObjectMissionType.WaitAndAttack) {
                    const command = mission.fastPeekCurrentCommand();
                    if (command !== null && command.action === CommandAction.Attack) flag = true;
                }
            }
            if (!flag) continue;
            const empire2 = BuiltObjectMission.resolveMissionTargetEmpire(mission!);
            if (empire2 !== attackedEmpire) continue;
            // 1811-1822 GlobalVictoryConditions: not modelled (null) → flag2 = false.
            const flag2 = false;
            const incoming = incomingOf(empire2);
            const num = fleetAttackIndexOf(incoming, builtObject);
            if (num >= 0) {
                const fleetAttack = incoming[num];
                if (fleetAttack.target === mission!.target || mission!.target === null || obtainDiplomaticRelation(empire2, builtObject.empire).type !== DiplomaticRelationType.War || !isObjectVisibleToThisEmpire(galaxy, empire2, builtObject)) continue;
                fleetAttack.target = mission!.target;
                fleetAttack.warningDate = galaxyStarDate(galaxy);
                const description = resolveAttackWarningDescription(fleetAttack);
                sendMessageToEmpire(empire2, empire2, EmpireMessageType.IncomingEnemyFleet, builtObject, description);
                if (!flag2) continue;
            } else {
                if (obtainDiplomaticRelation(empire2, builtObject.empire).type !== DiplomaticRelationType.War || !isObjectVisibleToThisEmpire(galaxy, empire2, builtObject)) continue;
                const fleetAttack2 = new FleetAttack(builtObject, mission!.target, galaxyStarDate(galaxy));
                incoming.push(fleetAttack2);
                const description2 = resolveAttackWarningDescription(fleetAttack2);
                sendMessageToEmpire(empire2, empire2, EmpireMessageType.IncomingEnemyFleet, builtObject, description2);
                if (!flag2) continue;
            }
        }
    }
    const shipGroups = shipGroupsOf(self);
    for (let l = 0; l < shipGroups.length; l++) {
        const shipGroup = shipGroups[l];
        if (shipGroup.mission === null || shipGroup.leadShip === null) continue;
        let flag3 = false;
        if (shipGroup.mission.type === BuiltObjectMissionType.Attack || shipGroup.mission.type === BuiltObjectMissionType.Bombard) {
            flag3 = true;
        } else if (shipGroup.mission.type === BuiltObjectMissionType.WaitAndAttack || shipGroup.mission.type === BuiltObjectMissionType.WaitAndBombard) {
            const command2 = missionOf(shipGroup.leadShip)!.fastPeekCurrentCommand();
            if (command2 !== null && command2.action === CommandAction.Attack) flag3 = true;
        }
        if (!flag3) continue;
        const empire3 = BuiltObjectMission.resolveMissionTargetEmpire(shipGroup.mission);
        if (empire3 !== attackedEmpire) continue;
        const incoming2 = incomingOf(empire3);
        const num2 = fleetAttackIndexOf(incoming2, shipGroup);
        if (num2 >= 0) {
            const fleetAttack3 = incoming2[num2];
            if (fleetAttack3.target !== shipGroup.mission.target && shipGroup.mission.target !== null && obtainDiplomaticRelation(empire3, shipGroup.empire).type === DiplomaticRelationType.War && isObjectVisibleToThisEmpire(galaxy, empire3, shipGroup.leadShip)) {
                fleetAttack3.target = shipGroup.mission.target;
                fleetAttack3.warningDate = galaxyStarDate(galaxy);
                const description3 = resolveAttackWarningDescription(fleetAttack3);
                sendMessageToEmpire(empire3, empire3, EmpireMessageType.IncomingEnemyFleet, shipGroup, description3);
            }
        } else if (obtainDiplomaticRelation(empire3, shipGroup.empire).type === DiplomaticRelationType.War && isObjectVisibleToThisEmpire(galaxy, empire3, shipGroup.leadShip)) {
            const fleetAttack4 = new FleetAttack(shipGroup, shipGroup.mission.target, galaxyStarDate(galaxy));
            incoming2.push(fleetAttack4);
            const description4 = resolveAttackWarningDescription(fleetAttack4);
            sendMessageToEmpire(empire3, empire3, EmpireMessageType.IncomingEnemyFleet, shipGroup, description4);
        }
    }
}

function isAttackOrBombardMission(type: BuiltObjectMissionType): boolean {
    return type === BuiltObjectMissionType.Attack || type === BuiltObjectMissionType.WaitAndAttack || type === BuiltObjectMissionType.Bombard || type === BuiltObjectMissionType.WaitAndBombard;
}

/**
 * Empire.1.cs 3198 RespondToIncomingEnemyFleetsAndPlanetDestroyers. GlobalVictoryConditions are not modelled (null), so
 * the planet-destroyer "defend the victory habitat" exception never applies. Rnd: the MoveAndWait fleet missions.
 */
export function respondToIncomingEnemyFleetsAndPlanetDestroyers(galaxy: Galaxy, empire: Empire): void {
    const self = empire;
    const currentStarDate = galaxyStarDate(galaxy);
    const fleetAttackList: FleetAttack[] = [];
    const incoming = incomingOf(self);
    if (incoming.length > 0) {
        netSort(incoming, (a, b) => a.compareTo(b));
        for (let i = 0; i < incoming.length; i++) {
            const fleetAttack = incoming[i];
            if (fleetAttack.planetDestroyer !== null) {
                const pd = fleetAttack.planetDestroyer;
                const pdMission = missionOf(pd);
                if (pdMission === null || !isAttackOrBombardMission(pdMission.type)) {
                    fleetAttackList.push(fleetAttack);
                    continue;
                }
                const empire2 = BuiltObjectMission.resolveMissionTargetEmpire(pdMission);
                if (empire2 !== self) {
                    // 3218-3230: the MutualDefensePact / Protectorate exception needs GlobalVictoryConditions (null here).
                    const flag = true;
                    obtainDiplomaticRelation(self, empire2);
                    if (flag) {
                        fleetAttackList.push(fleetAttack);
                        continue;
                    }
                }
                const point = pdMission.resolveTargetCoordinates(pdMission);
                let num = determineBuiltObjectStrengthAtLocationWithShips(galaxy, point.x, point.y, self, 0, false).strength;
                const shipGroupList = shipGroupListDetermineFleetsTravellingToLocation(shipGroupsOf(self), point.x, point.y, 2000.0);
                num += shipGroupListCountTotalOverallStrengthFactor(galaxy, shipGroupList);
                const num2 = builtObjectCalculateTimeToArrivalAtDestination(galaxy, pd);
                const starDate = currentStarDate + num2 + 20000;
                const num3 = 10000;
                if (num >= num3) continue;
                const shipGroup = identifyNearestAvailableFleet(galaxy, self, point.x, point.y, true, true, 0.0, 48000.0);
                if (shipGroup !== null) {
                    const stellarObject = missionOf(pd)!.resolveMissionTargetHabitatIfPossible();
                    if (stellarObject === null) {
                        shipGroupAssignMissionFull(galaxy, shipGroup, BuiltObjectMissionType.MoveAndWait, null, null, null, null, point.x, point.y, starDate, BuiltObjectMissionPriority.High, false);
                    } else {
                        shipGroupAssignMissionFull(galaxy, shipGroup, BuiltObjectMissionType.MoveAndWait, stellarObject, null, null, null, -2000000001.0, -2000000001.0, starDate, BuiltObjectMissionPriority.High, false);
                    }
                    shipGroup.allowImmediateThreatEvaluation = true;
                    shipGroup.attackRangeSquared = Math.fround(Math.fround(self.attackRangeAttack) * Math.fround(self.attackRangeAttack));
                    shipGroup.gatherPoint = empireFindNearestRefuellingPoint(galaxy, self, point.x, point.y, shipGroup.leadShip!.fuelType, 4);
                }
            } else {
                if (fleetAttack.fleet === null) continue;
                const fleet = fleetAttack.fleet;
                if (fleet.mission === null || !isAttackOrBombardMission(fleet.mission.type)) {
                    fleetAttackList.push(fleetAttack);
                    continue;
                }
                const empire3 = BuiltObjectMission.resolveMissionTargetEmpire(fleet.mission);
                if (empire3 !== self) {
                    fleetAttackList.push(fleetAttack);
                    continue;
                }
                const point2 = fleet.mission.resolveTargetCoordinates(fleet.mission);
                let num4 = determineBuiltObjectStrengthAtLocationWithShips(galaxy, point2.x, point2.y, self, 0, false).strength;
                const shipGroupList2 = shipGroupListDetermineFleetsTravellingToLocation(shipGroupsOf(self), point2.x, point2.y, 2000.0);
                num4 += shipGroupListCountTotalOverallStrengthFactor(galaxy, shipGroupList2);
                const num5 = shipGroupCalculateTimeToArrivalAtDestination(galaxy, fleet);
                const starDate2 = currentStarDate + num5 + 20000;
                const num6 = csDoubleToInt(shipGroupTotalOverallStrengthFactor(galaxy, fleet) * 1.3);
                if (num4 >= num6) continue;
                const shipGroup2 = identifyNearestAvailableFleet(galaxy, self, point2.x, point2.y, true, true, 0.0, 48000.0);
                if (shipGroup2 !== null) {
                    const stellarObject4 = fleet.mission.resolveMissionTargetHabitatIfPossible();
                    if (stellarObject4 === null) {
                        shipGroupAssignMissionFull(galaxy, shipGroup2, BuiltObjectMissionType.MoveAndWait, null, null, null, null, point2.x, point2.y, starDate2, BuiltObjectMissionPriority.High, false);
                    } else {
                        // C# passes x = +2000000001.0 here (y = -2000000001.0) — ported as written.
                        shipGroupAssignMissionFull(galaxy, shipGroup2, BuiltObjectMissionType.MoveAndWait, stellarObject4, null, null, null, 2000000001.0, -2000000001.0, starDate2, BuiltObjectMissionPriority.High, false);
                    }
                    shipGroup2.allowImmediateThreatEvaluation = true;
                    shipGroup2.attackRangeSquared = Math.fround(Math.fround(self.attackRangeAttack) * Math.fround(self.attackRangeAttack));
                    shipGroup2.gatherPoint = empireFindNearestRefuellingPoint(galaxy, self, point2.x, point2.y, shipGroup2.leadShip!.fuelType, 4);
                }
            }
        }
    }
    for (let j = 0; j < fleetAttackList.length; j++) {
        const k = incoming.indexOf(fleetAttackList[j]);
        if (k >= 0) incoming.splice(k, 1);
    }
}

/** BuiltObject.cs 3553 CalculateTimeToArrivalAtDestination (long ms). */
function builtObjectCalculateTimeToArrivalAtDestination(galaxy: Galaxy, bo: BuiltObject): number {
    let result = 0;
    const mission = missionOf(bo);
    if (mission !== null && mission.type !== BuiltObjectMissionType.Undefined) {
        const point = mission.resolveTargetCoordinates(mission);
        if (point.x > 0 && point.y > 0) {
            const num = galaxy.calculateDistance(bo.xpos, bo.ypos, point.x, point.y);
            result = csDoubleToLong((num / bo.warpSpeed) * 1000.0);
        }
    }
    return result;
}

// ---------------------------------------------------------------------------------------------------------------
// IdentifyMilitaryObjectives (Empire.8.cs 4266 / 4845)
// ---------------------------------------------------------------------------------------------------------------

/** Empire.8.cs 4266 IdentifyMilitaryObjectives. Rnd: Next(0, EmpireEvaluations.Count) after the war targets. */
export function identifyMilitaryObjectives(galaxy: Galaxy, empire: Empire): void {
    const self = empire;
    const refusalCount: RefCount = { value: 0 };
    const intoleranceLevel = galaxyIntoleranceLevel(galaxy);
    let num = 0;
    let num2 = 0;
    let empireList: Empire[] = [];
    for (let i = 0; i < self.diplomaticRelations.count; i++) {
        const diplomaticRelation = self.diplomaticRelations.at(i);
        if (diplomaticRelation.type === DiplomaticRelationType.War) {
            empireList.push(diplomaticRelation.otherEmpire!);
            num2++;
            if (diplomaticRelation.initiator === self) num++;
        }
    }
    if (num2 > 3) num2 = 3;
    const num3 = shipGroupListCountLargeFleets(shipGroupsOf(self));
    let num4 = 0;
    if (self.planetDestroyers !== null) num4 = self.planetDestroyers.length;
    let maximumAttacksForEmpireWeDeclaredWarOn = num3;
    let maximumAttacksForEmpire = num3;
    let maximumBlockadesForEmpire = num3;
    let maximumPreparationsForEmpire = num3;
    let maximumPlanetDestroyerAttacksForEmpire = num4;
    if (num2 > 0) {
        maximumAttacksForEmpire = 1 + Math.trunc(num3 / num2);
        maximumPlanetDestroyerAttacksForEmpire = 1 + Math.trunc(num4 / num2);
        maximumBlockadesForEmpire = 0;
        maximumPreparationsForEmpire = 0;
        if (num > 0) {
            maximumAttacksForEmpireWeDeclaredWarOn = 1 + Math.trunc(num3 / num);
            if (num3 > num) {
                maximumAttacksForEmpire = 1;
                // 4318-4327: both branches set 0.
                maximumBlockadesForEmpire = 0;
                maximumPreparationsForEmpire = 0;
            } else {
                maximumAttacksForEmpire = 0;
                maximumBlockadesForEmpire = 0;
                maximumPreparationsForEmpire = 0;
            }
        }
    }
    void maximumPreparationsForEmpire;
    if (self.controlMilitaryAttacks !== AutomationLevel.Undefined && self.policy!.useExplorationShipsToScoutEnemySystems) {
        sendScoutShipsToEnemyLocations(galaxy, self, empireList);
    }
    if (empireList !== null && empireList.length > 0) {
        empireList = sortEmpiresByMilitaryPriority(galaxy, self, empireList);
        for (let j = 0; j < empireList.length; j++) {
            const empireEvaluation = obtainEmpireEvaluation(galaxy, self, empireList[j]);
            if (!identifyMilitaryObjectivesForSingleEmpire(galaxy, self, empireList[j], empireEvaluation.overallAttitude, maximumAttacksForEmpireWeDeclaredWarOn, maximumAttacksForEmpire, maximumPlanetDestroyerAttacksForEmpire, maximumBlockadesForEmpire, maximumPreparationsForEmpire, intoleranceLevel, refusalCount)) {
                break;
            }
        }
    }
    const evaluations = empireEvaluationsOf(self);
    const num5 = galaxy.rnd.next(0, evaluations.length);
    for (let k = num5; k < evaluations.length && (empireList.includes(evaluations[k].empire!) || identifyMilitaryObjectivesForSingleEmpire(galaxy, self, evaluations[k].empire!, evaluations[k].overallAttitude, maximumAttacksForEmpireWeDeclaredWarOn, maximumAttacksForEmpire, maximumPlanetDestroyerAttacksForEmpire, maximumBlockadesForEmpire, maximumPreparationsForEmpire, intoleranceLevel, refusalCount)); k++) {
        // empty body (C#)
    }
    for (let l = 0; l < num5 && (empireList.includes(evaluations[l].empire!) || identifyMilitaryObjectivesForSingleEmpire(galaxy, self, evaluations[l].empire!, evaluations[l].overallAttitude, maximumAttacksForEmpireWeDeclaredWarOn, maximumAttacksForEmpire, maximumPlanetDestroyerAttacksForEmpire, maximumBlockadesForEmpire, maximumPreparationsForEmpire, intoleranceLevel, refusalCount)); l++) {
        // empty body (C#)
    }
}

/** Empire.8.cs 4845 IdentifyMilitaryObjectivesForSingleEmpire(...). */
function identifyMilitaryObjectivesForSingleEmpire(
    galaxy: Galaxy,
    self: Empire,
    empire: Empire,
    overallAttitude: number,
    maximumAttacksForEmpireWeDeclaredWarOn: number,
    maximumAttacksForEmpire: number,
    maximumPlanetDestroyerAttacksForEmpire: number,
    maximumBlockadesForEmpire: number,
    maximumPreparationsForEmpire: number,
    galaxyIntoleranceLevel: number,
    refusalCount: RefCount,
): boolean {
    void overallAttitude;
    void maximumPreparationsForEmpire;
    void galaxyIntoleranceLevel;
    const diplomaticRelation = obtainDiplomaticRelation(self, empire);
    const shipGroups = shipGroupsOf(self);
    if (diplomaticRelation.type === DiplomaticRelationType.War) {
        let flag = false;
        if (diplomaticRelation.initiator === self) flag = true;
        const targets = identifyEmpireStrikePoints(galaxy, self, empire);
        const prioritizedTargetList: PrioritizedTarget[] = [];
        const planetDestroyers = planetDestroyersOf(self);
        if (planetDestroyers.length > 0 && checkUsePlanetDestroyerAgainstEmpire(galaxy, self, empire)) {
            let num = 0;
            for (let i = 0; i < targets.length; i++) {
                const prioritizedTarget = targets[i];
                if (prioritizedTarget === null || !isHabitat(prioritizedTarget.target)) continue;
                const habitat = prioritizedTarget.target;
                for (let j = 0; j < planetDestroyers.length; j++) {
                    const builtObject = planetDestroyers[j];
                    if (builtObject != null && builtObject.builtAt === null) {
                        let flag2 = false;
                        const m = missionOf(builtObject);
                        if (m === null || m.type === BuiltObjectMissionType.Undefined || m.priority === BuiltObjectMissionPriority.Low) flag2 = true;
                        if (
                            flag2 &&
                            withinFuelRangeAndRefuel(galaxy, builtObject, habitat.xpos, habitat.ypos, 0.1) &&
                            (builtObject.isAutoControlled || self.controlMilitaryAttacks === AutomationLevel.PartiallyAutomated) &&
                            checkTaskAuthorized(galaxy, self, self.controlMilitaryAttacks, refusalCount, generateAutomationMessageDestroyPlanet(habitat, builtObject), habitat, AdvisorMessageType.EnemyAttackPlanetDestroyer, null, builtObject, null)
                        ) {
                            assignMission(galaxy, builtObject, BuiltObjectMissionType.Attack, prioritizedTarget.target, null, BuiltObjectMissionPriority.Normal);
                            prioritizedTargetListAdd(prioritizedTargetList, prioritizedTarget);
                            num++;
                            break;
                        }
                    }
                }
                if (num >= maximumPlanetDestroyerAttacksForEmpire) break;
            }
        }
        for (const item of prioritizedTargetList) {
            const k = targets.indexOf(item);
            if (k >= 0) targets.splice(k, 1);
        }
        prioritizedTargetList.length = 0;
        if (diplomaticRelation.warObjective === WarObjective.CaptureObjectives) {
            for (let k = 0; k < shipGroups.length; k++) {
                const shipGroup = shipGroups[k];
                if (shipGroup.leadShip === null || !shipGroup.leadShip.isAutoControlled || shipGroup.posture !== FleetPosture.Attack) continue;
                if (shipGroup.attackPoint === null) {
                    if (shipGroup.mission !== null && shipGroup.mission.type !== BuiltObjectMissionType.Undefined && shipGroup.mission.priority !== BuiltObjectMissionPriority.Low) continue;
                    const r = selectFleetWarAttackTarget(galaxy, self, shipGroup, empire);
                    const stellarObject = r.target;
                    if (stellarObject === null || r.waypointing) continue;
                    let missionType = BuiltObjectMissionType.Attack;
                    if (isHabitat(stellarObject) && checkBombardEnemyColony(galaxy, self, stellarObject, shipGroup)) missionType = BuiltObjectMissionType.Bombard;
                    shipGroupAssignMission(galaxy, shipGroup, missionType, stellarObject, null, BuiltObjectMissionPriority.High, false);
                } else {
                    if (shipGroup.attackPoint === null || stellarObjectEmpire(shipGroup.attackPoint) !== empire || (shipGroup.mission !== null && shipGroup.mission.type !== BuiltObjectMissionType.Undefined && shipGroup.mission.priority !== BuiltObjectMissionPriority.Low)) continue;
                    if (checkFleetCanAttackTarget(galaxy, self, shipGroup, shipGroup.attackPoint)) {
                        let missionType2 = BuiltObjectMissionType.Attack;
                        if (isHabitat(shipGroup.attackPoint) && checkBombardEnemyColony(galaxy, self, shipGroup.attackPoint, shipGroup)) missionType2 = BuiltObjectMissionType.Bombard;
                        shipGroupAssignMission(galaxy, shipGroup, missionType2, shipGroup.attackPoint, null, BuiltObjectMissionPriority.High, false);
                        continue;
                    }
                    const r2 = selectFleetWarAttackTarget(galaxy, self, shipGroup, empire);
                    const stellarObject2 = r2.target;
                    if (stellarObject2 === null || r2.waypointing) continue;
                    let missionType3 = BuiltObjectMissionType.Attack;
                    if (isHabitat(stellarObject2) && checkBombardEnemyColony(galaxy, self, stellarObject2, shipGroup)) missionType3 = BuiltObjectMissionType.Bombard;
                    shipGroupAssignMission(galaxy, shipGroup, missionType3, stellarObject2, null, BuiltObjectMissionPriority.High, false);
                }
            }
        }
        let num2 = maximumAttacksForEmpire;
        if (flag) num2 = maximumAttacksForEmpireWeDeclaredWarOn;
        const shipGroupList = generateOrderedFleetsForEmpireTargets(galaxy, self, empire, false);
        for (let l = 0; l < shipGroupList.length; l++) {
            const shipGroup2 = shipGroupList[l];
            if (shipGroup2.posture === FleetPosture.Attack) {
                if (countShipGroupsAssignedToEmpire(self, empire, false) >= num2) return true;
                assignFleetAttackMission(galaxy, self, shipGroup2, targets, refusalCount);
            }
        }
    } else if (
        diplomaticRelation.type === DiplomaticRelationType.TradeSanctions &&
        self.policy!.diplomacyTradeSanctionsUseBlockades &&
        maximumBlockadesForEmpire > 0 &&
        (diplomaticRelation.strategy === DiplomaticStrategy.Conquer || diplomaticRelation.strategy === DiplomaticStrategy.Punish || diplomaticRelation.strategy === DiplomaticStrategy.Undermine)
    ) {
        if (diplomaticRelation.warObjective === WarObjective.Undefined) {
            const objectives = identifyEmpireWarObjectives(galaxy, self, diplomaticRelation.otherEmpire!);
            if (objectives.colonies.length > 0 || objectives.bases.length > 0) {
                diplomaticRelation.warObjective = WarObjective.CaptureObjectives;
                diplomaticRelation.warObjectiveColonies = objectives.colonies;
                diplomaticRelation.warObjectiveBases = objectives.bases;
            } else {
                diplomaticRelation.warObjective = WarObjective.EndWar;
                diplomaticRelation.warObjectiveColonies = [];
                diplomaticRelation.warObjectiveBases = [];
            }
        }
        if (diplomaticRelation.warObjectiveColonies.length > 0 || diplomaticRelation.warObjectiveBases.length > 0) {
            for (let m = 0; m < diplomaticRelation.warObjectiveColonies.length; m++) {
                const habitat2 = diplomaticRelation.warObjectiveColonies[m];
                if (habitat2 != null && !habitat2.hasBeenDestroyed && habitat2.empire !== null && habitat2.empire === empire) {
                    const shipGroupList2 = generateOrderedFleetsForTarget(galaxy, self, habitat2.xpos, habitat2.ypos, false);
                    if (shipGroupList2.length > 0) {
                        for (let n = 0; n < shipGroupList2.length; n++) {
                            const shipGroup3 = shipGroupList2[n];
                            if (
                                shipGroup3.leadShip !== null &&
                                shipGroup3.leadShip.isAutoControlled &&
                                shipGroup3.ships.length >= 10 &&
                                shipGroup3.posture === FleetPosture.Attack &&
                                shipGroup3.attackPoint === null &&
                                (shipGroup3.mission === null || shipGroup3.mission.type === BuiltObjectMissionType.Undefined || shipGroup3.mission.priority === BuiltObjectMissionPriority.Low) &&
                                shipGroupCheckFleetTargetWithinFuelRangeAndRefuel(galaxy, shipGroup3, habitat2.xpos, habitat2.ypos, 0.2)
                            ) {
                                const requiredFuel = determineFuelRequiredForFleet(shipGroup3).requiredFuel;
                                shipGroup3.gatherPoint = decideBestFleetRefuelPoint(galaxy, self, habitat2.xpos, habitat2.ypos, self, requiredFuel, empire);
                                shipGroup3.attackPoint = habitat2;
                                shipGroup3.postureRangeSquared = POSTURE_RANGE_SQUARED_ATTACK_POINT;
                                if (implementBlockadeColony(galaxy, self, habitat2, true, true, { value: 0 }, shipGroup3)) break;
                            }
                        }
                    }
                }
                if (countShipGroupsAssignedToEmpire(self, empire, true) >= maximumBlockadesForEmpire) break;
            }
            for (let num3 = 0; num3 < diplomaticRelation.warObjectiveBases.length; num3++) {
                const builtObject2 = diplomaticRelation.warObjectiveBases[num3];
                if (
                    builtObject2 != null &&
                    !builtObject2.hasBeenDestroyed &&
                    builtObject2.empire !== null &&
                    builtObject2.empire === empire &&
                    (builtObject2.parentHabitat === null || builtObject2.parentHabitat.empire === null || builtObject2.parentHabitat.empire === galaxy.independentEmpire)
                ) {
                    const shipGroupList3 = generateOrderedFleetsForTarget(galaxy, self, builtObject2.xpos, builtObject2.ypos, false);
                    if (shipGroupList3.length > 0) {
                        for (let num4 = 0; num4 < shipGroupList3.length; num4++) {
                            const shipGroup4 = shipGroupList3[num4];
                            if (
                                shipGroup4.leadShip !== null &&
                                shipGroup4.leadShip.isAutoControlled &&
                                shipGroup4.posture === FleetPosture.Attack &&
                                shipGroup4.attackPoint === null &&
                                (shipGroup4.mission === null || shipGroup4.mission.type === BuiltObjectMissionType.Undefined || shipGroup4.mission.priority === BuiltObjectMissionPriority.Low) &&
                                shipGroupCheckFleetTargetWithinFuelRangeAndRefuel(galaxy, shipGroup4, builtObject2.xpos, builtObject2.ypos, 0.2)
                            ) {
                                const requiredFuel2 = determineFuelRequiredForFleet(shipGroup4).requiredFuel;
                                shipGroup4.gatherPoint = decideBestFleetRefuelPoint(galaxy, self, builtObject2.xpos, builtObject2.ypos, self, requiredFuel2, empire);
                                shipGroup4.attackPoint = builtObject2;
                                shipGroup4.postureRangeSquared = POSTURE_RANGE_SQUARED_ATTACK_POINT;
                                if (implementBlockadeBuiltObject(galaxy, self, builtObject2, true, true, { value: 0 }, shipGroup4)) break;
                            }
                        }
                    }
                }
                if (countShipGroupsAssignedToEmpire(self, empire, true) >= maximumBlockadesForEmpire) break;
            }
        } else {
            const shipGroupList4 = generateOrderedFleetsForEmpireTargets(galaxy, self, empire, false);
            for (let num5 = 0; num5 < shipGroupList4.length; num5++) {
                const shipGroup5 = shipGroupList4[num5];
                if (shipGroup5.posture !== FleetPosture.Attack || !isShipGroupAvailable(galaxy, shipGroup5, BuiltObjectMissionPriority.Normal, 0) || shipGroup5.leadShip === null || !shipGroup5.leadShip.isAutoControlled) continue;
                if (countShipGroupsAssignedToEmpire(self, empire, true) >= maximumBlockadesForEmpire) return true;
                if (aggressionLevel(self) <= 105 + galaxy.rnd.next(0, 30)) continue;
                let num6 = 0.0;
                let habitat3: Habitat | null = null;
                for (let num7 = 0; num7 < empire.colonies.length; num7++) {
                    const habitat4 = empire.colonies[num7];
                    if (checkSystemExplored(self, habitat4.systemIndex)) {
                        const builtObject3 = determineSpacePortAtColony(galaxy, habitat4);
                        if (builtObject3 !== null && builtObject3.currentYearsIncome > num6) {
                            num6 = builtObject3.currentYearsIncome;
                            habitat3 = habitat4;
                        }
                    }
                }
                let flag3 = false;
                if (habitat3 !== null && !habitat3.hasBeenDestroyed && habitat3.empire !== null && habitat3.empire === empire && shipGroupCheckFleetTargetWithinFuelRangeAndRefuel(galaxy, shipGroup5, habitat3.xpos, habitat3.ypos, 0.2)) {
                    flag3 = implementBlockadeColony(galaxy, self, habitat3, true, true, { value: 0 }, shipGroup5);
                }
                if (!flag3) {
                    for (let num8 = 0; num8 < empire.colonies.length; num8++) {
                        const habitat5 = empire.colonies[num8];
                        if (habitat5 == null || habitat5.hasBeenDestroyed || habitat5.empire === null || habitat5.empire !== empire || !checkSystemExplored(self, habitat5.systemIndex)) continue;
                        const builtObject4 = determineSpacePortAtColony(galaxy, habitat5);
                        if (builtObject4 !== null && galaxy.rnd.next(0, 3) === 1 && shipGroupCheckFleetTargetWithinFuelRangeAndRefuel(galaxy, shipGroup5, habitat5.xpos, habitat5.ypos, 0.2)) {
                            flag3 = implementBlockadeColony(galaxy, self, habitat5, true, true, { value: 0 }, shipGroup5);
                            if (flag3) break;
                        }
                    }
                }
                if (flag3) continue;
                for (let num9 = 0; num9 < empire.miningStations.length; num9++) {
                    const builtObject5 = empire.miningStations[num9];
                    if (
                        builtObject5 != null &&
                        !builtObject5.hasBeenDestroyed &&
                        builtObject5.empire !== null &&
                        builtObject5.empire === empire &&
                        builtObject5.parentHabitat !== null &&
                        checkSystemExplored(self, builtObject5.parentHabitat.systemIndex) &&
                        shipGroupCheckFleetTargetWithinFuelRangeAndRefuel(galaxy, shipGroup5, builtObject5.xpos, builtObject5.ypos, 0.2) &&
                        implementBlockadeBuiltObject(galaxy, self, builtObject5, true, true, { value: 0 }, shipGroup5)
                    ) {
                        break;
                    }
                }
            }
        }
    }
    return true;
}

// ---------------------------------------------------------------------------------------------------------------
// Blockade entry points (fleets/blockades.ts)
// ---------------------------------------------------------------------------------------------------------------

/** Empire.ImplementBlockade(BuiltObject | Habitat target, sendFleet, performAuthorizationCheck) (Empire.8.cs 3731 / 3801). */
export function implementBlockade(galaxy: Galaxy, empire: Empire, target: BuiltObject | Habitat, sendFleet: boolean, performAuthorizationCheck: boolean): boolean {
    if (isHabitat(target)) return implementBlockadeColony(galaxy, empire, target, sendFleet, performAuthorizationCheck);
    return implementBlockadeBuiltObject(galaxy, empire, target, sendFleet, performAuthorizationCheck);
}

/** Empire.2.cs 3938 CancelInactiveBlockades. */
export function cancelInactiveBlockades(galaxy: Galaxy, empire: Empire): void {
    cancelInactiveBlockadesImpl(galaxy, empire);
}

// ---------------------------------------------------------------------------------------------------------------
// Resupply ships (Empire.9.cs 52 / 61; Galaxy.3.cs 723 / 740; Galaxy.7.cs 2404)
// ---------------------------------------------------------------------------------------------------------------

/** Empire.9.cs 52 TaskResupplyShips. */
export function taskResupplyShips(galaxy: Galaxy, empire: Empire): void {
    const targetEmpires = identifyTargetEmpires(empire);
    const resupplyShips = empire.resupplyShips as BuiltObject[];
    for (let i = 0; i < resupplyShips.length; i++) taskResupplyShip(galaxy, empire, resupplyShips[i], targetEmpires);
}

/** Galaxy.3.cs 723 DetermineResupplyShipLocationByDestination(resupplyShip, out x, out y). */
function determineResupplyShipLocationByDestination(resupplyShip: BuiltObject): { x: number; y: number } {
    let x = resupplyShip.xpos;
    let y = resupplyShip.ypos;
    const mission = missionOf(resupplyShip);
    if (resupplyShip.isFunctional && mission !== null && mission.type === BuiltObjectMissionType.Deploy) {
        const point = mission.resolveTargetCoordinates(mission);
        x = point.x;
        y = point.y;
    } else if (resupplyShip.isDeployed && resupplyShip.isFunctional) {
        x = resupplyShip.xpos;
        y = resupplyShip.ypos;
    }
    return { x, y };
}

/** Galaxy.3.cs 740 FastFindNearestResupplyShipByDestination(x, y, empire, resupplyShipToExclude). */
function fastFindNearestResupplyShipByDestination(galaxy: Galaxy, x: number, y: number, empire: Empire, resupplyShipToExclude: BuiltObject | null): BuiltObject | null {
    let num = Number.MAX_VALUE;
    let result: BuiltObject | null = null;
    const resupplyShips = empire.resupplyShips as BuiltObject[];
    for (let i = 0; i < resupplyShips.length; i++) {
        const builtObject = resupplyShips[i];
        const m = missionOf(builtObject);
        if (builtObject != null && builtObject !== resupplyShipToExclude && (builtObject.isDeployed || (m !== null && m.type === BuiltObjectMissionType.Deploy))) {
            const p = determineResupplyShipLocationByDestination(builtObject);
            const num2 = galaxy.calculateDistanceSquared(x, y, p.x, p.y);
            if (num2 < num) {
                result = builtObject;
                num = num2;
            }
        }
    }
    return result;
}

/** Galaxy.7.cs 2404/2409 FastFindNearestFuelHabitatAlternate(x, y, resourceId, habitatToExclude, empire[, systemToExclude = null, allowBases = true]). */
export function fastFindNearestFuelHabitatAlternate(galaxy: Galaxy, x: number, y: number, resourceId: number, habitatToExclude: Habitat | null, empire: Empire | null, systemToExclude: Habitat | null = null, allowBases = true): Habitat | null {
    let result: Habitat | null = null;
    let num = Number.MAX_VALUE;
    if (empire !== null && empire.fuelSystemsSources !== null) {
        let fuelSourceSystemList = null;
        for (let i = 0; i < empire.fuelSystemsSources.length; i++) {
            const fuelSourceSystemList2 = empire.fuelSystemsSources[i];
            if (fuelSourceSystemList2 != null && fuelSourceSystemList2.resourceId === resourceId) {
                fuelSourceSystemList = fuelSourceSystemList2;
                break;
            }
        }
        if (fuelSourceSystemList !== null) {
            for (let j = 0; j < fuelSourceSystemList.items.length; j++) {
                const fuelSourceSystem = fuelSourceSystemList.items[j];
                if (fuelSourceSystem == null) continue;
                for (let k = 0; k < fuelSourceSystem.knownFuelSources.length; k++) {
                    const habitat = fuelSourceSystem.knownFuelSources[k];
                    if (habitat === habitatToExclude || (!allowBases && habitat.basesAtHabitat != null && habitat.basesAtHabitat.length > 0)) continue;
                    const num2 = galaxy.calculateDistanceSquared(x, y, habitat.xpos, habitat.ypos);
                    if (num2 < num) {
                        let flag = true;
                        if (systemToExclude !== null && habitat.systemIndex === systemToExclude.systemIndex) flag = false;
                        if (flag) {
                            result = habitat;
                            num = num2;
                        }
                    }
                }
            }
        }
    }
    return result;
}

/** PrioritizedTargetList.cs 24 ResolveStellarObjects. */
function resolveStellarObjects(list: readonly PrioritizedTarget[]): StellarObject[] {
    const stellarObjectList: StellarObject[] = [];
    for (let index = 0; index < list.length; ++index) {
        const t = list[index].target;
        if (isHabitat(t)) stellarObjectList.push(t);
        else if (isBuiltObject(t)) stellarObjectList.push(t);
        else if (isCreature(t)) stellarObjectList.push(t);
    }
    return stellarObjectList;
}

/** The war-target list of TaskResupplyShip for one target empire (Empire.9.cs 89-101 / 140-152). */
function resupplyTargetObjects(galaxy: Galaxy, self: Empire, targetEmpire: Empire): StellarObject[] {
    let stellarObjectList: StellarObject[] = [];
    if (self.pirateEmpireBaseHabitat !== null) {
        const prioritizedTargetList = identifyEmpireStrikePoints(galaxy, self, targetEmpire);
        stellarObjectList = resolveStellarObjects(prioritizedTargetList);
    } else {
        const relation = obtainDiplomaticRelation(self, targetEmpire);
        addWarObjectivesToList(galaxy, relation, stellarObjectList as (BuiltObject | Habitat)[], false, true);
    }
    return stellarObjectList;
}

/** Empire.9.cs 61 TaskResupplyShip(resupplyShip, targetEmpires). */
function taskResupplyShip(galaxy: Galaxy, self: Empire, resupplyShip: BuiltObject, targetEmpires: Empire[]): void {
    const rsMission = missionOf(resupplyShip);
    if (!resupplyShip.isFunctional || !resupplyShip.isAutoControlled || (rsMission !== null && rsMission.type !== BuiltObjectMissionType.Undefined) || resupplyShip.unbuiltOrDamagedComponentCount !== 0 || resupplyShip.builtAt !== null) return;
    const num = 2500000.0;
    if (resupplyShip.isDeployed) {
        let flag = true;
        const shipGroups = shipGroupsOf(self);
        for (let i = 0; i < shipGroups.length; i++) {
            const shipGroup = shipGroups[i];
            if (shipGroup.mission !== null && (shipGroup.mission.targetBuiltObject === resupplyShip || shipGroup.mission.secondaryTargetBuiltObject === resupplyShip)) {
                flag = false;
                break;
            }
        }
        if (!flag) return;
        let flag2 = true;
        let num2 = Number.MAX_VALUE;
        if (targetEmpires.length > 0) {
            for (let j = 0; j < targetEmpires.length; j++) {
                const stellarObjectList = resupplyTargetObjects(galaxy, self, targetEmpires[j]);
                if (stellarObjectList.length <= 0) continue;
                const count = stellarObjectList.length;
                for (let k = 0; k < count; k++) {
                    const num3 = galaxy.calculateDistance(resupplyShip.xpos, resupplyShip.ypos, stellarObjectList[k].xpos, stellarObjectList[k].ypos);
                    if (num3 < num2) num2 = num3;
                    if (num2 < num) {
                        flag2 = false;
                        break;
                    }
                }
                if (!flag2) break;
            }
        }
        if (flag2) initiateUndeploy(galaxy, resupplyShip);
    } else {
        if (resupplyShip.deployProgress !== 0.0) return;
        let habitat: Habitat | null = null;
        if (targetEmpires.length > 0) {
            for (let l = 0; l < targetEmpires.length; l++) {
                const stellarObjectList2 = resupplyTargetObjects(galaxy, self, targetEmpires[l]);
                if (stellarObjectList2.length > 0) {
                    for (let m = 0; m < stellarObjectList2.length; m++) {
                        const xpos = stellarObjectList2[m].xpos;
                        const ypos = stellarObjectList2[m].ypos;
                        let builtObject = fastFindNearestResupplyShipByDestination(galaxy, xpos, ypos, self, resupplyShip);
                        const builtObject2 = fastFindNearestSpacePortOf(galaxy, xpos, ypos, self);
                        let num4 = Number.MAX_VALUE;
                        if (builtObject !== null) {
                            const p = determineResupplyShipLocationByDestination(builtObject);
                            num4 = galaxy.calculateDistance(xpos, ypos, p.x, p.y);
                        }
                        let num5 = Number.MAX_VALUE;
                        if (builtObject2 !== null) num5 = galaxy.calculateDistance(xpos, ypos, builtObject2.xpos, builtObject2.ypos);
                        if (num4 > RESUPPLY_SHIP_MINIMUM_DISTANCE && num5 > RESUPPLY_SHIP_MINIMUM_DISTANCE) {
                            let num6 = xpos;
                            let num7 = ypos;
                            let resourceId = 0;
                            const shipGroups2 = shipGroupsOf(self);
                            if (shipGroups2 !== null && shipGroups2.length > 0 && shipGroups2[0].leadShip !== null && shipGroups2[0].leadShip.fuelType !== null) resourceId = shipGroups2[0].leadShip.fuelType.resourceId;
                            let num8 = 0;
                            while (habitat === null && num8 < 50) {
                                const habitat2 = fastFindNearestFuelHabitatAlternate(galaxy, num6, num7, resourceId, null, self);
                                if (habitat2 !== null && !isObjectVisibleToThisEmpire(galaxy, targetEmpires[l], habitat2)) {
                                    const dom = galaxy.systems[habitat2.systemIndex].dominantEmpire;
                                    if (dom == null || dom.empire == null) {
                                        builtObject = fastFindNearestResupplyShipByDestination(galaxy, habitat2.xpos, habitat2.ypos, self, resupplyShip);
                                        num4 = Number.MAX_VALUE;
                                        if (builtObject !== null) {
                                            const p2 = determineResupplyShipLocationByDestination(builtObject);
                                            num4 = galaxy.calculateDistance(habitat2.xpos, habitat2.ypos, p2.x, p2.y);
                                        }
                                        if (num4 > RESUPPLY_SHIP_MINIMUM_DISTANCE) {
                                            const num9 = galaxy.calculateDistance(xpos, ypos, habitat2.xpos, habitat2.ypos);
                                            if (num9 < num && num5 > num9) {
                                                habitat = habitat2;
                                                break;
                                            }
                                        }
                                    }
                                }
                                const p3 = galaxy.selectRelativePoint(300000.0);
                                num6 += p3.x;
                                num7 += p3.y;
                                num8++;
                            }
                        }
                        if (habitat !== null) break;
                    }
                }
                if (habitat !== null) break;
            }
        }
        if (habitat !== null) {
            assignMission(galaxy, resupplyShip, BuiltObjectMissionType.Deploy, habitat, null, BuiltObjectMissionPriority.High);
            return;
        }
        let flag3 = false;
        if (resupplyShip.parentHabitat !== null && resupplyShip.parentHabitat.basesAtHabitat !== null && resupplyShip.parentHabitat.basesAtHabitat.length > 0) {
            for (const item of resupplyShip.parentHabitat.basesAtHabitat) {
                if (item.subRole === BuiltObjectSubRole.SmallSpacePort || item.subRole === BuiltObjectSubRole.MediumSpacePort || item.subRole === BuiltObjectSubRole.LargeSpacePort) {
                    flag3 = true;
                    break;
                }
            }
        }
        if (self.spacePorts.length <= 0 || flag3) return;
        const builtObject3 = fastFindNearestSpacePortOf(galaxy, resupplyShip.xpos, resupplyShip.ypos, self);
        if (builtObject3 !== null) {
            const num10 = resupplyShip.currentFuel / Math.max(1.0, resupplyShip.fuelCapacity);
            if (num10 < 0.5) {
                assignMission(galaxy, resupplyShip, BuiltObjectMissionType.Refuel, builtObject3, null, BuiltObjectMissionPriority.Unavailable);
                return;
            }
            const p4 = galaxy.selectRelativeParkingPoint();
            assignMission(galaxy, resupplyShip, BuiltObjectMissionType.Move, builtObject3, null, BuiltObjectMissionPriority.Low, { x: p4.x, y: p4.y });
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// TaskShipGroups (Empire.9.cs 1162) and its callees
// ---------------------------------------------------------------------------------------------------------------

/** Empire.9.cs 1314 EnsureColonyDefendedByFleet(colony). */
function ensureColonyDefendedByFleet(galaxy: Galaxy, self: Empire, colony: Habitat): void {
    let flag = false;
    const shipGroup = findNearestDefensiveFleet(galaxy, self, colony.xpos, colony.ypos);
    if (shipGroup !== null) {
        const num = galaxy.calculateDistance(shipGroup.leadShip!.xpos, shipGroup.leadShip!.ypos, colony.xpos, colony.ypos);
        if (num > 5000.0) {
            let flag2 = false;
            const shipGroups = shipGroupsOf(self);
            if (shipGroups !== null) {
                for (let i = 0; i < shipGroups.length; i++) {
                    const shipGroup2 = shipGroups[i];
                    if (shipGroup2.mission !== null && shipGroup2.mission.type !== BuiltObjectMissionType.Undefined && shipGroup2.mission.targetHabitat !== null && shipGroup2.mission.targetHabitat === colony) {
                        flag2 = true;
                        break;
                    }
                }
            }
            if (!flag2) flag = true;
        }
    } else {
        flag = true;
    }
    if (flag) {
        const fleet = findNearestAvailableFleet(galaxy, self, colony.xpos, colony.ypos, BuiltObjectMissionPriority.Normal, 0, FleetPosture.Defend, false, 0.0, true);
        if (fleet !== null) shipGroupAssignMission(galaxy, fleet, BuiltObjectMissionType.Move, colony, null, BuiltObjectMissionPriority.Normal, false);
    }
}

/** HabitatPrioritizationList.cs 14 ResolveSystems. */
function resolveSystems(list: readonly { habitat: Habitat | null }[]): Habitat[] {
    const habitatList: Habitat[] = [];
    for (let index = 0; index < list.length; ++index) {
        const habitatSystemStar = determineHabitatSystemStar(list[index].habitat);
        // HabitatList.Contains(null) is true once a null was added (List<T>.Contains).
        if (!habitatList.includes(habitatSystemStar as Habitat)) habitatList.push(habitatSystemStar as Habitat);
    }
    return habitatList;
}

/** BuiltObjectList.cs 96 GenerateDistanceOrderedList(x, y, systemPriorities): writes each ship's SortTag, List.Sort by SortTag. */
function generateDistanceOrderedList(list: readonly BuiltObject[], x: number, y: number, systemPriorities: readonly Habitat[]): BuiltObject[] {
    const builtObjectList = list.slice();
    for (let i = 0; i < builtObjectList.length; i++) {
        const builtObject = builtObjectList[i];
        let num = calculateDistanceStatic(builtObject.xpos, builtObject.ypos, x, y);
        if (builtObject.nearestSystemStar !== null && systemPriorities.includes(builtObject.nearestSystemStar)) num /= 3.0;
        builtObject.sortTag = num;
    }
    netSort(builtObjectList, (a, b) => compareDouble(a.sortTag, b.sortTag));
    return builtObjectList;
}

/** Empire.9.cs 1603 HuntPirates. Rnd: Next(0, 3). */
function huntPirates(galaxy: Galaxy, self: Empire): void {
    const refusalCount: RefCount = { value: 0 };
    if (self.knownPirateBases.length <= 0 || self.reclusive || galaxy.rnd.next(0, 3) <= 0 || checkAtWar(self)) return;
    const shipGroup = findAvailableShipGroup(galaxy, self, BuiltObjectMissionPriority.Low, 0, FleetPosture.Attack);
    if (shipGroup === null) return;
    let systemPriorities: Habitat[] = [];
    const habitatPrioritizationList = identifyColonizationTargetsFull(galaxy, self, false, 0, 2147483647, false, false);
    if (habitatPrioritizationList !== null) systemPriorities = resolveSystems(habitatPrioritizationList);
    const builtObjectList = generateDistanceOrderedList(self.knownPirateBases, self.capital!.xpos, self.capital!.ypos, systemPriorities);
    for (let i = 0; i < builtObjectList.length; i++) {
        const builtObject = builtObjectList[i];
        const pirateRelation = obtainPirateRelation(builtObject.empire!, self);
        const num = builtObject.empire!.pirateMissions.indexOfRequester(self, EmpireActivityType.Attack);
        if (num >= 0 || pirateRelation.type === PirateRelationType.Protection) continue;
        let num2 = calculateOverallStrengthFactor(builtObject);
        if (checkSystemVisibleStar(self, builtObject.nearestSystemStar)) num2 = calculateDefendingStrength(galaxy, self, builtObject).strength;
        let shipGroup2 = findNearestAvailableFleet(galaxy, self, builtObject.xpos, builtObject.ypos, BuiltObjectMissionPriority.Low, num2, FleetPosture.Attack, true, 0.1, false, false, false, true);
        if (shipGroup2 === null) shipGroup2 = findNearestAvailableFleet(galaxy, self, builtObject.xpos, builtObject.ypos, BuiltObjectMissionPriority.Low, num2, FleetPosture.Defend, true, 0.1, false, false, false, true);
        if (shipGroup2 === null) continue;
        const num3 = galaxy.calculateDistance(shipGroup2.leadShip!.xpos, shipGroup2.leadShip!.ypos, builtObject.xpos, builtObject.ypos);
        if (!(num3 < ATTACK_ON_PIRATES_RANGE) || !shipGroupCheckFleetTargetWithinFuelRangeAndRefuel(galaxy, shipGroup2, builtObject.xpos, builtObject.ypos, 0.1)) continue;
        let num4 = 0;
        for (let j = 0; j < self.builtObjects.length; j++) {
            const builtObject2 = self.builtObjects[j];
            const m = missionOf(builtObject2);
            if (builtObject2.role === BuiltObjectRole.Military && m !== null && m.type === BuiltObjectMissionType.Attack && m.targetBuiltObject !== null) {
                if (m.targetBuiltObject === builtObject) num4 += calculateOverallStrengthFactor(builtObject2);
            }
        }
        if (
            num4 < csDoubleToInt(num2 * 1.5) &&
            (shipGroup2.leadShip!.isAutoControlled || self.controlMilitaryAttacks === AutomationLevel.PartiallyAutomated) &&
            checkTaskAuthorized(galaxy, self, self.controlMilitaryAttacks, refusalCount, generateAutomationMessageAttackPirateBase(builtObject, shipGroup2), builtObject, AdvisorMessageType.EnemyAttack, null, shipGroup2, null)
        ) {
            const missionType = determineDestroyOrCaptureTargetForFleet(galaxy, self, shipGroup2, builtObject);
            shipGroupAssignMission(galaxy, shipGroup2, missionType, builtObject, null, BuiltObjectMissionPriority.High, true);
            break;
        }
    }
}

/**
 * Empire.9.cs 3935 IdentifyThreatenedSystemsPrioritized(x, y, includePirateBaseSystems, excludeSystemsWithFleetsPresentOrEnRoute,
 * excludeSystemsOfOtherEmpires).
 */
export function identifyThreatenedSystemsPrioritized(galaxy: Galaxy, self: Empire, x: number, y: number, includePirateBaseSystems: boolean, excludeSystemsWithFleetsPresentOrEnRoute: boolean, excludeSystemsOfOtherEmpires: boolean): HabitatPrioritization[] {
    const habitatPrioritizationList: HabitatPrioritization[] = [];
    const habitatList: Habitat[] = [];
    if (!includePirateBaseSystems) {
        for (let i = 0; i < self.knownPirateBases.length; i++) {
            const builtObject = self.knownPirateBases[i];
            if (builtObject != null && !builtObject.hasBeenDestroyed && builtObject.nearestSystemStar !== null && !habitatList.includes(builtObject.nearestSystemStar)) habitatList.push(builtObject.nearestSystemStar);
        }
    }
    const habitatList2: Habitat[] = [];
    if (excludeSystemsWithFleetsPresentOrEnRoute) {
        const shipGroups = shipGroupsOf(self);
        for (let j = 0; j < shipGroups.length; j++) {
            const shipGroup = shipGroups[j];
            if (shipGroup != null) {
                const habitat = shipGroupIdentifyFleetSystem(galaxy, shipGroup);
                if (habitat !== null && !habitatList2.includes(habitat)) habitatList2.push(habitat);
            }
        }
    }
    const systemVisibility = self.visibility.systemVisibility;
    for (let k = 0; k < systemVisibility.length; k++) {
        const sv = systemVisibility[k];
        if (sv == null || sv.status === SystemVisibilityStatus.Unexplored || sv.systemStar == null || (!includePirateBaseSystems && habitatList.includes(sv.systemStar))) continue;
        const num = checkSystemOwnershipId(galaxy, sv.systemStar);
        if (excludeSystemsOfOtherEmpires && num >= 0 && num !== self.empireId) continue;
        let num2 = 0;
        if (sv.threats !== null && sv.threats.length > 0) {
            for (let l = 0; l < sv.threats.length; l++) {
                const builtObject2 = sv.threats[l];
                if (builtObject2 == null || builtObject2.hasBeenDestroyed || builtObject2.role !== BuiltObjectRole.Military) continue;
                const actualEmpire = builtObject2.actualEmpire;
                if (actualEmpire === null || actualEmpire === galaxy.independentEmpire) continue;
                if (self.pirateEmpireBaseHabitat !== null || actualEmpire.pirateEmpireBaseHabitat !== null) {
                    const pirateRelation = obtainPirateRelation(self, actualEmpire);
                    if (pirateRelation.type !== PirateRelationType.Protection) num2 += builtObject2.firepowerRaw;
                } else {
                    const diplomaticRelation = obtainDiplomaticRelation(self, actualEmpire);
                    if (diplomaticRelation.type === DiplomaticRelationType.War) num2 += builtObject2.firepowerRaw;
                }
            }
        }
        if (sv.status === SystemVisibilityStatus.Visible) {
            const creatures = galaxy.systems[sv.systemStar.systemIndex].creatures ?? [];
            for (let m = 0; m < creatures.length; m++) {
                const creature = creatures[m];
                if (creature.isVisible && creature.attackStrength > 0) num2 += creature.attackStrength;
            }
        }
        if (num2 > 0 && (!excludeSystemsWithFleetsPresentOrEnRoute || !habitatList2.includes(sv.systemStar))) {
            const num3 = galaxy.calculateDistance(x, y, sv.systemStar.xpos, sv.systemStar.ypos);
            const priority = csDoubleToInt((num2 * 1000.0) / (num3 / 10000.0));
            habitatPrioritizationList.push(new HabitatPrioritization(sv.systemStar, priority));
        }
    }
    netSort(habitatPrioritizationList, (a, b) => a.compareTo(b));
    habitatPrioritizationList.reverse();
    return habitatPrioritizationList;
}

/** Empire.9.cs 1162 TaskShipGroups. GlobalVictoryConditions are not modelled (null). Rnd: HuntPirates, fleet missions. */
export function taskShipGroups(galaxy: Galaxy, empire: Empire): void {
    const self = empire;
    const shipGroups = shipGroupsOf(self);
    for (let i = 0; i < shipGroups.length; i++) {
        const shipGroup = shipGroups[i];
        if (
            isShipGroupAvailable(galaxy, shipGroup, BuiltObjectMissionPriority.Low, 0) &&
            shipGroup.leadShip!.isAutoControlled &&
            (shipGroupWarpSpeed(shipGroup) <= 0 || shipGroup.leadShip!.currentSpeed < Math.fround(shipGroupWarpSpeed(shipGroup)))
        ) {
            let num = shipGroupCalculateRefuellingPortion(galaxy, shipGroup);
            if (shipGroup.leadShip!.parentHabitat !== null && shipGroup.leadShip!.parentHabitat === shipGroup.gatherPoint) num = Math.max(num, 0.7);
            const num2 = shipGroupCheckShipsRequiringRefuelling(shipGroup, num).count;
            if (num2 > Math.trunc(shipGroup.ships.length * 0.0)) {
                const requiredFuel = shipGroupCalculateRequiredFuel(shipGroup);
                assignFleetRefuellingExcludeGatheringShips(galaxy, self, shipGroup, requiredFuel);
            }
        }
    }
    const habitatList: Habitat[] = [];
    // 1185-1195 GlobalVictoryConditions (DefendHabitat / TargetHabitat): not modelled (null).
    if (checkAtWar(self)) {
        const habitatList2: Habitat[] = self.colonies.slice();
        netSort(habitatList2, habitatCompareTo);
        habitatList2.reverse();
        const num3 = 500000;
        for (let j = 0; j < habitatList2.length; j++) {
            if (strategicValue(habitatList2[j]) > num3 && !habitatList.includes(habitatList2[j])) habitatList.push(habitatList2[j]);
        }
        if (habitatList.length === 0) {
            if (self.homeWorld !== null && self.homeWorld.empire === self && self.policy!.homeworldDefensePriority > 1.0) habitatList.push(self.homeWorld);
            if (!habitatList.includes(self.capital as Habitat) && self.capital !== null) habitatList.push(self.capital);
        }
    }
    const num4 = Math.max(1, Math.trunc(shipGroups.length * 0.2));
    for (let k = 0; k < habitatList.length; k++) {
        if (habitatList[k] != null) {
            if (k >= num4) break;
            ensureColonyDefendedByFleet(galaxy, self, habitatList[k]);
        }
    }
    if (self.knownPirateBases.length > 0) huntPirates(galaxy, self);
    const shipGroupList: ShipGroup[] = [];
    for (let l = 0; l < shipGroups.length; l++) {
        const shipGroup2 = shipGroups[l];
        if (shipGroup2 != null && (shipGroup2.mission === null || shipGroup2.mission.type === BuiltObjectMissionType.Undefined || shipGroup2.mission.priority === BuiltObjectMissionPriority.Low)) shipGroupList.push(shipGroup2);
    }
    if (shipGroupList.length <= 0) return;
    let num5 = shipGroupList.length;
    const habitatPrioritizationList = identifyThreatenedSystemsPrioritized(galaxy, self, self.capital!.xpos, self.capital!.ypos, false, true, true);
    if (habitatPrioritizationList.length <= 0) return;
    for (let m = 0; m < habitatPrioritizationList.length; m++) {
        const habitatPrioritization = habitatPrioritizationList[m];
        if (habitatPrioritization == null || habitatPrioritization.habitat === null) continue;
        const shipGroup3 = identifyNearestResponseFleet(galaxy, self, habitatPrioritization.habitat.xpos, habitatPrioritization.habitat.ypos, true, 0.1, 50000.0);
        if (shipGroup3 !== null && shipGroup3.leadShip !== null && shipGroup3.leadShip.isAutoControlled) {
            shipGroupAssignMission(galaxy, shipGroup3, BuiltObjectMissionType.Move, habitatPrioritization.habitat, null, BuiltObjectMissionPriority.Normal, false);
            num5--;
            if (num5 <= 0) break;
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// ReviewSystemThreats (Empire.9.cs 4163)
// ---------------------------------------------------------------------------------------------------------------

/** Empire.9.cs 4163 ReviewSystemThreats. Rnd: SelectRelativeParkingPoint per ship sent to shadow intruders; mission constructors. */
export function reviewSystemThreats(galaxy: Galaxy, empire: Empire): void {
    const self = empire;
    const systemVisibility = self.visibility.systemVisibility;
    if (systemVisibility === null || self.builtObjects === null || self.dominantRace === null) return;
    for (let i = 0; i < systemVisibility.length; i++) {
        const sv = systemVisibility[i];
        if (sv != null) sv.empireStrength = 0;
    }
    for (let j = 0; j < self.builtObjects.length; j++) {
        const builtObject = self.builtObjects[j];
        if (builtObject != null && builtObject.firepowerRaw > 0 && builtObject.nearestSystemStar !== null && builtObject.nearestSystemStar.systemIndex >= 0 && builtObject.nearestSystemStar.systemIndex < systemVisibility.length) {
            systemVisibility[builtObject.nearestSystemStar.systemIndex].empireStrength += builtObject.firepowerRaw;
        }
    }
    const evaluations = empireEvaluationsOf(self);
    if (evaluations !== null) {
        for (let k = 0; k < evaluations.length; k++) evaluations[k].militaryForcesInSystems = 0;
    }
    const currentStarDate = galaxyStarDate(galaxy);
    const refusalCount: RefCount = { value: 0 };
    const num = SECTOR_SIZE * SECTOR_SIZE;
    const num2 = 30;
    let val = 3.33 * (1.5 - Math.max(aggressionLevel(self), cautionLevel(self)) / 100.0);
    val = Math.min(1.0, Math.max(0.0, val));
    const num3 = Math.trunc(Math.max(0.0, num2 * val));
    const militaryPotencyValue = militaryPotency(self);
    const num4 = 1.0 + Math.max(0.0, (aggressionLevel(self) - cautionLevel(self)) / 100.0);
    const habitatList = determineEmpireDominatedSystems(galaxy, self, true);
    const builtObjectList = obtainAvailableMilitaryShips(galaxy, self, 1, false, false, false);
    for (const item of habitatList) {
        let flag = false;
        const defendHabitat = self.defendHabitat;
        if (defendHabitat !== null && !defendHabitat.hasBeenDestroyed && defendHabitat.empire !== null && defendHabitat.empire === self && item.systemIndex === defendHabitat.systemIndex) flag = true;
        let systemVisibility2 = null;
        if (item.systemIndex >= 0 && item.systemIndex < systemVisibility.length) systemVisibility2 = systemVisibility[item.systemIndex];
        if (systemVisibility2 === null || systemVisibility2.threats === null || systemVisibility2.threatLevels === null || systemVisibility2.threats.length <= 0) continue;
        const threats = systemVisibility2.threats;
        const array = new Array<number>(galaxy.nextEmpireId + 1).fill(0);
        let num5 = -1;
        let builtObject2: BuiltObject | null = null;
        for (let l = 0; l < threats.length; l++) {
            const builtObject3 = threats[l];
            if (
                builtObject3 == null ||
                builtObject3.role !== BuiltObjectRole.Military ||
                builtObject3.empire === null ||
                builtObject3.empire === galaxy.independentEmpire ||
                builtObject3.empire.pirateEmpireBaseHabitat !== null ||
                (builtObject3.firepowerRaw <= 0 && builtObject3.fighterCapacity <= 0) ||
                (builtObject3.owner === null && (builtObject3.weapons === null || builtObject3.weapons.length <= 1)) ||
                builtObject3.hasBeenDestroyed ||
                builtObject3.nearestSystemStar !== item ||
                (missionOf(builtObject3) !== null && missionOf(builtObject3)!.type === BuiltObjectMissionType.Blockade)
            ) {
                continue;
            }
            const diplomaticRelation = obtainDiplomaticRelation(self, threats[l].empire);
            if (diplomaticRelation === null || diplomaticRelation.type === DiplomaticRelationType.War || diplomaticRelation.militaryRefuelingToOther || builtObject3.subRole === BuiltObjectSubRole.ResortBase) continue;
            const num6 = Math.max(builtObject3.firepowerRaw, builtObject3.fighterCapacity * 10);
            array[builtObject3.empire.empireId] += num6;
            if (num5 < 0) {
                num5 = builtObject3.empire.empireId;
                builtObject2 = builtObject3;
            } else {
                if (array[builtObject3.empire.empireId] < array[num5]) continue;
                if (num5 !== builtObject3.empire.empireId) {
                    builtObject2 = builtObject3;
                } else if (builtObject2 === null) {
                    builtObject2 = builtObject3;
                } else {
                    const num7 = Math.max(builtObject2.firepowerRaw, builtObject2.fighterCapacity * 10);
                    if (num6 > num7) builtObject2 = builtObject3;
                }
                num5 = builtObject3.empire.empireId;
            }
        }
        if (num5 < 0 || (array[num5] < num3 && !flag)) continue;
        const byEmpireId = empiresGetByEmpireId(galaxy, num5);
        const empireEvaluation2 = obtainEmpireEvaluation(galaxy, self, byEmpireId);
        const num8 = Math.max(1, Math.min(20, Math.trunc((array[num5] - num3) / 5)));
        empireEvaluation2.militaryForcesInSystems -= num8;
        const num9 = currentStarDate - empireEvaluation2.lastSystemWarningDate;
        if (num9 < 90000 && byEmpireId !== null) {
            const militaryPotency2 = militaryPotency(byEmpireId);
            let num10 = militaryPotencyValue / militaryPotency2;
            num10 *= num4;
            if (num10 >= 0.85) {
                if (builtObject2 === null) continue;
                const bo2Group = builtObject2.shipGroup as ShipGroup | null;
                if (bo2Group !== null && bo2Group.leadShip !== null) {
                    const num11 = galaxy.calculateDistanceSquared(builtObject2.xpos, builtObject2.ypos, bo2Group.leadShip.xpos, bo2Group.leadShip.ypos);
                    if (num11 < 9000000.0) {
                        const overallStrength = csDoubleToInt(shipGroupTotalOverallStrengthFactor(galaxy, bo2Group) * 0.75);
                        const shipGroup = findNearestAvailableFleet(galaxy, self, bo2Group.leadShip.xpos, bo2Group.leadShip.ypos, BuiltObjectMissionPriority.Low, overallStrength, FleetPosture.Attack, true, 0.1, false);
                        const shipGroup2 = findNearestAvailableFleet(galaxy, self, bo2Group.leadShip.xpos, bo2Group.leadShip.ypos, BuiltObjectMissionPriority.Low, overallStrength, FleetPosture.Defend, true, 0.1, false, false, false, true);
                        let shipGroup3: ShipGroup | null = null;
                        let num12 = Number.MAX_VALUE;
                        let num13 = Number.MAX_VALUE;
                        if (shipGroup !== null && shipGroup.leadShip !== null) num12 = galaxy.calculateDistanceSquared(bo2Group.leadShip.xpos, bo2Group.leadShip.ypos, shipGroup.leadShip.xpos, shipGroup.leadShip.ypos);
                        if (shipGroup2 !== null && shipGroup2.leadShip !== null) num13 = galaxy.calculateDistanceSquared(bo2Group.leadShip.xpos, bo2Group.leadShip.ypos, shipGroup2.leadShip.xpos, shipGroup2.leadShip.ypos);
                        if (num13 < num12 && shipGroup2 !== null) shipGroup3 = shipGroup2;
                        else if (num12 < num13 && shipGroup !== null) shipGroup3 = shipGroup;
                        if (
                            shipGroup3 !== null &&
                            shipGroup3.leadShip !== null &&
                            (shipGroup3.leadShip.isAutoControlled || self.controlMilitaryAttacks === AutomationLevel.PartiallyAutomated) &&
                            checkTaskAuthorized(galaxy, self, self.controlMilitaryAttacks, refusalCount, generateAutomationMessageAttackForcesInOurSystem(item, byEmpireId), bo2Group, AdvisorMessageType.DefendTerritory, builtObject2.empire, shipGroup3, null)
                        ) {
                            shipGroupAssignMission(galaxy, shipGroup3, BuiltObjectMissionType.Attack, bo2Group, null, BuiltObjectMissionPriority.High, false);
                        }
                    }
                } else {
                    const near = getNearestBuiltObjectWithinRangeIndexed(galaxy, builtObjectList, builtObject2.xpos, builtObject2.ypos, 0.2);
                    const nearestBuiltObjectWithinRange = near.builtObject;
                    if (
                        nearestBuiltObjectWithinRange !== null &&
                        withinFuelRangeAndRefuel(galaxy, nearestBuiltObjectWithinRange, builtObject2.xpos, builtObject2.ypos, 0.1) &&
                        checkTaskAuthorized(galaxy, self, self.controlMilitaryAttacks, refusalCount, generateAutomationMessageAttackForcesInOurSystem(item, byEmpireId), builtObject2, AdvisorMessageType.DefendTerritory, builtObject2.empire, nearestBuiltObjectWithinRange, null)
                    ) {
                        const builtObjectMissionType = determineDestroyOrCaptureTarget(galaxy, self, nearestBuiltObjectWithinRange, builtObject2, true);
                        recordRevertMission(galaxy, nearestBuiltObjectWithinRange, builtObjectMissionType, true);
                        assignMission(galaxy, nearestBuiltObjectWithinRange, builtObjectMissionType, builtObject2, null, BuiltObjectMissionPriority.High);
                        builtObjectList.splice(near.index, 1);
                    }
                }
                continue;
            }
            shadowIntruders(galaxy, self, systemVisibility2.empireStrength, array[num5], builtObject2, builtObjectList, num);
            continue;
        }
        if (num9 > 240000 && self.controlDiplomacyTreaties !== AutomationLevel.Undefined) {
            const description = formatText(getText('Your forces intrude in our territory'), item.name);
            sendMessageToEmpire(self, byEmpireId, EmpireMessageType.RemoveForcesFromSystem, item, description);
            empireEvaluation2.lastSystemWarningDate = currentStarDate;
            empireEvaluation2.lastSystemWarningIndex = item.systemIndex;
        }
        shadowIntruders(galaxy, self, systemVisibility2.empireStrength, array[num5], builtObject2, builtObjectList, num);
    }
}

/**
 * Empire.9.cs 4345-4377 / 4386-4418 (the two identical blocks): up to 3 available ships Move to a parking point beside the
 * strongest intruder until our strength in the system matches theirs.
 */
function shadowIntruders(galaxy: Galaxy, self: Empire, empireStrength: number, intruderStrength: number, builtObject2: BuiltObject | null, builtObjectList: BuiltObject[], num: number): void {
    void self;
    let num14 = 0;
    if (empireStrength >= intruderStrength) return;
    let num15 = intruderStrength - empireStrength;
    const iterationCount = { value: 0 };
    while (conditionCheckLimit(num15 > 0 && builtObject2 !== null && num14 < 3, 100, iterationCount)) {
        const near = getNearestBuiltObjectWithinRangeIndexed(galaxy, builtObjectList, builtObject2!.xpos, builtObject2!.ypos, 0.2);
        const nearest = near.builtObject;
        if (nearest === null || !withinFuelRangeAndRefuel(galaxy, nearest, builtObject2!.xpos, builtObject2!.ypos, 0.1)) break;
        const num16 = galaxy.calculateDistanceSquared(nearest.xpos, nearest.ypos, builtObject2!.xpos, builtObject2!.ypos);
        if (!(num16 < num)) break;
        let obj: Habitat | null = null;
        const p = galaxy.selectRelativeParkingPoint();
        let x = p.x;
        let y = p.y;
        if (builtObject2!.parentHabitat !== null) {
            obj = builtObject2!.parentHabitat;
        } else {
            obj = null;
            x += builtObject2!.xpos;
            y += builtObject2!.ypos;
        }
        assignMission(galaxy, nearest, BuiltObjectMissionType.Move, obj, null, BuiltObjectMissionPriority.High, { x, y, manuallyAssigned: false });
        num15 -= nearest.firepowerRaw;
        num14++;
        builtObjectList.splice(near.index, 1);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// CheckTemptingTargets (Empire.10.cs 727-935)
// ---------------------------------------------------------------------------------------------------------------

/** Empire.10.cs 727 CheckAttackTemptingTarget(target). Rnd: Next(0, 15), then Next(0, 3) when aggressive enough. */
function checkAttackTemptingTarget(galaxy: Galaxy, self: Empire, target: StellarObject): boolean {
    const num = 95 + galaxy.rnd.next(0, 15);
    if (aggressionLevel(self) >= num && galaxy.rnd.next(0, 3) === 1) {
        let val = 0.6 + (cautionLevel(self) - 100) / 50.0;
        val = Math.min(1.2, Math.max(0.01, val));
        const targetEmpire = stellarObjectEmpire(target);
        if (targetEmpire !== null && weightedMilitaryPotency(self) > weightedMilitaryPotency(targetEmpire) * val) {
            if (isHabitat(target)) {
                const habitat = target;
                const minimumTroopStrength = determineRequiredTroopStrength(galaxy, self, habitat);
                const shipGroup = findNearestAvailableFleet(galaxy, self, habitat.xpos, habitat.ypos, BuiltObjectMissionPriority.Low, 0, FleetPosture.Attack, true, 0.1, true, false, false, true, minimumTroopStrength);
                if (shipGroup !== null) {
                    shipGroupAssignMission(galaxy, shipGroup, BuiltObjectMissionType.Attack, habitat, null, BuiltObjectMissionPriority.Normal, false);
                    return true;
                }
            } else if (isBuiltObject(target)) {
                const builtObject = target;
                let overallStrength = calculateOverallStrengthFactor(builtObject);
                if (checkSystemVisibleStar(self, builtObject.nearestSystemStar)) overallStrength = calculateDefendingStrength(galaxy, self, builtObject).strength;
                const shipGroup2 = findNearestAvailableFleet(galaxy, self, builtObject.xpos, builtObject.ypos, BuiltObjectMissionPriority.Low, overallStrength, FleetPosture.Attack, true, 0.1, true, false, false, true, 0);
                if (shipGroup2 !== null) {
                    const missionType = determineDestroyOrCaptureTargetForFleet(galaxy, self, shipGroup2, builtObject);
                    shipGroupAssignMission(galaxy, shipGroup2, missionType, builtObject, null, BuiltObjectMissionPriority.Normal, false);
                    return true;
                }
                for (let i = 0; i < self.builtObjects.length; i++) {
                    const builtObject2 = self.builtObjects[i];
                    const m = missionOf(builtObject2);
                    if (
                        builtObject2.isAutoControlled &&
                        builtObject2.shipGroup === null &&
                        builtObject2.builtAt === null &&
                        builtObject2.unbuiltOrDamagedComponentCount === 0 &&
                        (builtObject2.subRole === BuiltObjectSubRole.Destroyer || builtObject2.subRole === BuiltObjectSubRole.Cruiser || builtObject2.subRole === BuiltObjectSubRole.CapitalShip) &&
                        (m === null || m.type === BuiltObjectMissionType.Undefined || m.priority === BuiltObjectMissionPriority.Low)
                    ) {
                        const missionType2 = determineDestroyOrCaptureTarget(galaxy, self, builtObject2, builtObject, false);
                        assignMission(galaxy, builtObject2, missionType2, builtObject, null, BuiltObjectMissionPriority.Normal);
                        return true;
                    }
                }
            }
        }
    }
    return false;
}

/** Empire.10.cs 781 CheckTemptingTargetColony(colony). */
function checkTemptingTargetColony(galaxy: Galaxy, self: Empire, colony: Habitat): boolean {
    if (isObjectVisibleToThisEmpire(galaxy, self, colony)) {
        const num = determineColonizationValue(galaxy, self, colony);
        if (num > 1000) {
            const num2 = colony.troops!.totalDefendStrength + colony.troopsToRecruit!.totalDefendStrength;
            if (num2 < troopLevelMinimum(galaxy, colony, galaxy.difficultyLevel) * 100) {
                let num3 = 0;
                if (colony.basesAtHabitat !== null) {
                    for (const item of colony.basesAtHabitat) {
                        if (item.isFunctional) num3 += item.firepowerRaw;
                    }
                }
                const design = findNewestCanBuild(self.designs, BuiltObjectSubRole.MediumSpacePort, self);
                let num4 = 100;
                if (design !== null) num4 = design.firepowerRaw;
                if (num3 < num4 && checkAttackTemptingTarget(galaxy, self, colony)) return true;
            }
        }
    }
    return false;
}

/** Empire.10.cs 814 CheckTemptingTargetShip(constructionShip). */
function checkTemptingTargetShip(galaxy: Galaxy, self: Empire, constructionShip: BuiltObject): boolean {
    const m = missionOf(constructionShip);
    if (isObjectVisibleToThisEmpire(galaxy, self, constructionShip) && m !== null && m.type === BuiltObjectMissionType.Repair) {
        const targetBuiltObject = m.targetBuiltObject;
        if (targetBuiltObject !== null && targetBuiltObject.builtAt === constructionShip) {
            let flag = false;
            let flag2 = false;
            const galaxyLocationList = galaxy.determineGalaxyLocationsAtPoint(targetBuiltObject.xpos, targetBuiltObject.ypos);
            for (const item of galaxyLocationList) {
                if (item.type === GalaxyLocationType.DebrisField) flag2 = true;
                else if (item.type === GalaxyLocationType.PlanetDestroyer) flag = true;
            }
            if ((flag2 || flag) && checkAttackTemptingTarget(galaxy, self, targetBuiltObject)) return true;
        }
    }
    return false;
}

/** Empire.10.cs 845 CheckTemptingTargetsInEmpire(empire). Rnd: Next(0, Colonies.Count), Next(0, ConstructionShips.Count). */
function checkTemptingTargetsInEmpire(galaxy: Galaxy, self: Empire, empire: Empire): void {
    if (empire === self) return;
    const diplomaticRelation = obtainDiplomaticRelation(self, empire);
    if (diplomaticRelation.type === DiplomaticRelationType.NotMet || diplomaticRelation.type === DiplomaticRelationType.War || (diplomaticRelation.strategy !== DiplomaticStrategy.Conquer && diplomaticRelation.strategy !== DiplomaticStrategy.Punish)) return;
    let flag = false;
    if (empire.colonies.length > 0) {
        const num = galaxy.rnd.next(0, empire.colonies.length);
        if (!flag) {
            for (let i = num; i < empire.colonies.length; i++) {
                if (checkTemptingTargetColony(galaxy, self, empire.colonies[i])) {
                    flag = true;
                    break;
                }
            }
        }
        if (!flag) {
            for (let j = 0; j < num; j++) {
                if (checkTemptingTargetColony(galaxy, self, empire.colonies[j])) {
                    flag = true;
                    break;
                }
            }
        }
    }
    const constructionShips = empire.constructionShips as BuiltObject[];
    if (constructionShips.length <= 0) return;
    const num2 = galaxy.rnd.next(0, constructionShips.length);
    if (!flag) {
        for (let k = num2; k < constructionShips.length; k++) {
            if (checkTemptingTargetShip(galaxy, self, constructionShips[k])) {
                flag = true;
                break;
            }
        }
    }
    if (flag) return;
    for (let l = 0; l < num2; l++) {
        if (checkTemptingTargetShip(galaxy, self, constructionShips[l])) {
            flag = true;
            break;
        }
    }
}

/** Empire.10.cs 913 CheckTemptingTargets. Rnd: Next(0, Empires.Count). */
export function checkTemptingTargets(galaxy: Galaxy, empire: Empire): void {
    if (empire !== galaxy.playerEmpire && empire.controlMilitaryAttacks === AutomationLevel.FullyAutomated) {
        const num = galaxy.rnd.next(0, galaxy.empires.length);
        for (let i = num; i < galaxy.empires.length; i++) checkTemptingTargetsInEmpire(galaxy, empire, galaxy.empires[i]);
        for (let j = 0; j < num; j++) checkTemptingTargetsInEmpire(galaxy, empire, galaxy.empires[j]);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// SendAvailableFleetsToGuardStrategicLocations (Empire.5.cs 908-1040)
// ---------------------------------------------------------------------------------------------------------------

/** Empire.5.cs 908 FindShipGroupAssignedNearPoint(x, y). */
function findShipGroupAssignedNearPoint(self: Empire, x: number, y: number): ShipGroup | null {
    const num = 1000.0;
    const num2 = x - num;
    const num3 = x + num;
    const num4 = y - num;
    const num5 = y + num;
    const shipGroups = shipGroupsOf(self);
    for (let i = 0; i < shipGroups.length; i++) {
        const shipGroup = shipGroups[i];
        if (shipGroup.mission !== null && shipGroup.mission.type !== BuiltObjectMissionType.Undefined) {
            const point = shipGroup.mission.resolveTargetCoordinates(shipGroup.mission);
            if (point.x > num2 && point.x < num3 && point.y > num4 && point.y < num5) return shipGroup;
        }
    }
    return null;
}

/** Empire.9.cs 876 SetDefendFleetForLocation(x, y). */
function setDefendFleetForLocation(galaxy: Galaxy, self: Empire, x: number, y: number): boolean {
    let result = false;
    let flag = true;
    let shipGroup = findNearestAvailableFleet(galaxy, self, x, y, BuiltObjectMissionPriority.Low, 0, FleetPosture.Attack, false, 0.0, true, true);
    if (shipGroup === null) {
        shipGroup = findNearestAvailableFleet(galaxy, self, x, y, BuiltObjectMissionPriority.Unavailable, 0, FleetPosture.Attack, false, 0.0, true, true);
        flag = false;
    }
    if (shipGroup !== null) {
        const stellarObject = empireFindNearestRefuellingPoint(galaxy, self, x, y, shipGroup.leadShip!.fuelType, 3);
        if (stellarObject !== null) {
            shipGroup.gatherPoint = stellarObject;
            shipGroup.posture = FleetPosture.Defend;
            shipGroup.postureRangeSquared = POSTURE_RANGE_SQUARED_ATTACK_POINT;
            if (flag) shipGroupAssignMission(galaxy, shipGroup, BuiltObjectMissionType.Move, null, null, BuiltObjectMissionPriority.Normal, false, { x, y });
            result = true;
        }
    }
    return result;
}

/** Empire.5.cs 954 SendAvailableFleetsToGuardSingleStrategicLocation(x, y). Rnd: Next(400000, 550000) when a fleet goes. */
function sendAvailableFleetsToGuardSingleStrategicLocation(galaxy: Galaxy, self: Empire, x: number, y: number): void {
    if (!self.controlMilitaryFleets) return;
    let shipGroup = findShipGroupAssignedNearPoint(self, x, y);
    if (shipGroup !== null) return;
    const habitat = fastFindNearestColony(galaxy, x, y, self, 0);
    if (habitat === null) return;
    const num = galaxy.calculateDistance(x, y, habitat.xpos, habitat.ypos);
    if (!(num < SECTOR_SIZE * 2)) return;
    shipGroup = findNearestAvailableFleet(galaxy, self, x, y, BuiltObjectMissionPriority.Low, 0, FleetPosture.Defend, true, 0.1, true, false, false, true, 0);
    if (shipGroup === null) shipGroup = findNearestAvailableFleet(galaxy, self, x, y, BuiltObjectMissionPriority.Low, 0, FleetPosture.Defend, true, 0.1, true, false, false, false, 0);
    if (shipGroup !== null) {
        let habitat2 = findLonelyHabitatAt(galaxy, x, y);
        if (habitat2 !== null) {
            const num2 = galaxy.calculateDistance(habitat2.xpos, habitat2.ypos, x, y);
            if (num2 > 1000.0) habitat2 = null;
        }
        const starDate = galaxyStarDate(galaxy) + galaxy.rnd.next(400000, 550000);
        if (habitat2 !== null) {
            shipGroupAssignMission(galaxy, shipGroup, BuiltObjectMissionType.MoveAndWait, habitat2, null, BuiltObjectMissionPriority.Normal, false, null, starDate);
        } else {
            shipGroupAssignMissionFull(galaxy, shipGroup, BuiltObjectMissionType.MoveAndWait, null, null, null, null, x, y, starDate, BuiltObjectMissionPriority.Normal, false);
        }
    } else {
        setDefendFleetForLocation(galaxy, self, x, y);
    }
}

/** BuiltObjectList.cs 427 GetConstructionShipsBuildingPlanetDestroyers. */
function getConstructionShipsBuildingPlanetDestroyers(list: readonly BuiltObject[]): BuiltObject[] {
    const builtObjectList: BuiltObject[] = [];
    for (let i = 0; i < list.length; i++) {
        const builtObject = list[i];
        const queue = builtObject?.constructionQueue as { constructionYards: { shipUnderConstruction: BuiltObject | null }[] | null; constructionWaitQueue: BuiltObject[] | null } | null;
        if (builtObject != null && builtObject.subRole === BuiltObjectSubRole.ConstructionShip && queue != null && queue.constructionYards !== null && queue.constructionWaitQueue !== null) {
            const m = missionOf(builtObject);
            if (queue.constructionWaitQueue.length > 0 && queue.constructionWaitQueue.filter((b) => b != null && b.design != null && b.design.isPlanetDestroyer).length > 0) {
                builtObjectList.push(builtObject);
            } else if (queue.constructionYards.filter((y) => y.shipUnderConstruction !== null && y.shipUnderConstruction.design.isPlanetDestroyer).length > 0) {
                builtObjectList.push(builtObject);
            } else if (m !== null && m.type === BuiltObjectMissionType.Build && m.design !== null && m.design.isPlanetDestroyer) {
                builtObjectList.push(builtObject);
            }
        }
    }
    return builtObjectList;
}

/** Empire.5.cs 1007 SendAvailableFleetsToGuardStrategicLocations. */
export function sendAvailableFleetsToGuardStrategicLocations(galaxy: Galaxy, empire: Empire): void {
    const self = empire;
    const shipGroups = shipGroupsOf(self);
    if (shipGroups !== null && shipGroups.length > 3 && self.policy!.buildPlanetDestroyers) {
        const constructionShipsBuildingPlanetDestroyers = getConstructionShipsBuildingPlanetDestroyers(self.constructionShips as BuiltObject[]);
        for (let i = 0; i < constructionShipsBuildingPlanetDestroyers.length; i++) {
            const builtObject = constructionShipsBuildingPlanetDestroyers[i];
            const m = missionOf(builtObject);
            if (builtObject != null && m !== null) {
                const point = m.resolveTargetCoordinates(m);
                sendAvailableFleetsToGuardSingleStrategicLocation(galaxy, self, point.x, point.y);
            }
        }
    }
    if (checkAtWar(self)) return;
    const knownGalaxyLocations = self.visibility.knownGalaxyLocations;
    for (let j = 0; j < knownGalaxyLocations.length; j++) {
        if (knownGalaxyLocations[j] != null && knownGalaxyLocations[j].type === GalaxyLocationType.DebrisField) {
            const c = knownGalaxyLocations[j].resolveLocationCenter();
            sendAvailableFleetsToGuardSingleStrategicLocation(galaxy, self, c.x, c.y);
        }
    }
    for (let k = 0; k < knownGalaxyLocations.length; k++) {
        if (knownGalaxyLocations[k] != null && knownGalaxyLocations[k].type === GalaxyLocationType.PlanetDestroyer) {
            const c2 = knownGalaxyLocations[k].resolveLocationCenter();
            sendAvailableFleetsToGuardSingleStrategicLocation(galaxy, self, c2.x, c2.y);
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// DetermineRandomAttacks (Empire.2.cs 4373-4700)
// ---------------------------------------------------------------------------------------------------------------

/** Empire.9.cs 1672 ResolveEmpiresAtWarWithOrPreparingToConquer. */
function resolveEmpiresAtWarWithOrPreparingToConquer(self: Empire): Empire[] {
    const empireList: Empire[] = [];
    for (let i = 0; i < self.diplomaticRelations.count; i++) {
        const diplomaticRelation = self.diplomaticRelations.at(i);
        if (diplomaticRelation == null) continue;
        if (diplomaticRelation.type === DiplomaticRelationType.War) {
            empireList.push(diplomaticRelation.otherEmpire!);
            continue;
        }
        if (diplomaticRelation.strategy === DiplomaticStrategy.Conquer) empireList.push(diplomaticRelation.otherEmpire!);
    }
    return empireList;
}

/** Empire.8.cs 2974 CheckWhetherHaveEnoughFleetsForWar(empiresAtWarWith). */
function checkWhetherHaveEnoughFleetsForWar(self: Empire, empiresAtWarWith: number): boolean {
    let result = false;
    const shipGroups = shipGroupsOf(self);
    if (shipGroups !== null) {
        switch (empiresAtWarWith) {
            case 0:
                if (shipGroups.length > 0) result = true;
                break;
            case 1:
                if (shipGroups.length > 2) result = true;
                break;
        }
    }
    return result;
}

/** Empire.2.cs 4387 ShouldProvoke(targetEmpire, ourMilitaryPotency, aggressionFactor, cautionFactor, galaxyIntoleranceLevel, provokeWithRaids). */
function shouldProvoke(galaxy: Galaxy, self: Empire, targetEmpire: Empire, ourMilitaryPotency: number, aggressionFactor: number, cautionFactor: number, galaxyIntoleranceLevelValue: number, provokeWithRaids: boolean): boolean {
    void provokeWithRaids;
    let flag = false;
    if (targetEmpire.reclusive || self.reclusive) return false;
    let val = Math.max(1, csDoubleToInt(aggressionFactor));
    val = Math.min(val, 2);
    void val;
    const num = countEmpiresWeDeclaredWarOn(self) + countEmpiresWhoDeclaredWarOnUs(self);
    if (num >= 1) return false;
    const empireList = resolveEmpiresAtWarWithOrPreparingToConquer(self);
    if (empireList.length > 1 && !empireList.includes(targetEmpire)) return false;
    if (!checkWhetherHaveEnoughFleetsForWar(self, num)) return false;
    const diplomaticRelation = obtainDiplomaticRelation(self, targetEmpire);
    switch (diplomaticRelation.strategy) {
        case DiplomaticStrategy.Undefined:
        case DiplomaticStrategy.Befriend:
        case DiplomaticStrategy.Placate:
        case DiplomaticStrategy.Defend:
        case DiplomaticStrategy.Ally:
        case DiplomaticStrategy.Undermine:
        case DiplomaticStrategy.DefendPlacate:
        case DiplomaticStrategy.DefendUndermine:
            return false;
        default: {
            const empireEvaluation = obtainEmpireEvaluation(galaxy, self, targetEmpire);
            let num2 = -45.0 / aggressionFactor;
            num2 *= cautionFactor;
            if (empireEvaluation.overallAttitude <= num2) flag = true;
            if (flag) {
                let num3 = csDoubleToInt(ourMilitaryPotency * aggressionFactor);
                num3 = csDoubleToInt(num3 / cautionFactor);
                const num4 = 0.95 + galaxy.rnd.nextDouble() * (1.4 * galaxyIntoleranceLevelValue * aggressionFactor);
                num3 = csDoubleToInt(num3 * num4);
                num3 = csDoubleToInt(num3 * (galaxy.aggressionLevel * galaxy.aggressionLevel));
                if (num3 >= weightedMilitaryPotency(targetEmpire)) {
                    const num5 = (loyaltyLevel(self) / 100.0 + (galaxy.rnd.nextDouble() - 0.5) * 0.2) * 100.0;
                    const diplomaticRelation2 = self.diplomaticRelations.byEmpire(targetEmpire);
                    if (diplomaticRelation2 !== null) {
                        switch (diplomaticRelation2.type) {
                            case DiplomaticRelationType.None:
                                if (galaxy.rnd.next(0, 4) > 0) return true;
                                break;
                            case DiplomaticRelationType.TradeSanctions:
                            case DiplomaticRelationType.War:
                                return true;
                            case DiplomaticRelationType.FreeTradeAgreement:
                                if (num5 < 100.0) return true;
                                break;
                            case DiplomaticRelationType.MutualDefensePact:
                            case DiplomaticRelationType.Protectorate:
                                if (num5 < 95.0) return true;
                                break;
                            case DiplomaticRelationType.SubjugatedDominion:
                            case DiplomaticRelationType.Truce:
                                if (num5 < 110.0) return true;
                                break;
                        }
                    } else if (galaxy.rnd.next(0, 4) > 0) {
                        return true;
                    }
                }
            }
            return false;
        }
    }
}

/** Empire.2.cs 4488 DetermineAttackOnSingleEmpire(empire, ourMilitaryPotency, aggression, caution, galaxyIntoleranceLevel, ref refusalCount). */
function determineAttackOnSingleEmpire(galaxy: Galaxy, self: Empire, empire: Empire, ourMilitaryPotency: number, aggression: number, caution: number, galaxyIntoleranceLevelValue: number, refusalCount: RefCount): boolean {
    let result = false;
    if (self.policy!.warAttacksHarassEnemies && shouldProvoke(galaxy, self, empire, ourMilitaryPotency, aggression, caution, galaxyIntoleranceLevelValue, true) && !self.empiresToAttack.includes(empire)) {
        let flag = false;
        for (let i = 0; i < empire.proposedDiplomaticRelations.count; i++) {
            const diplomaticRelation = empire.proposedDiplomaticRelations.at(i);
            if (diplomaticRelation.initiator === self) {
                flag = true;
                break;
            }
        }
        if (!flag && checkTaskAuthorized(galaxy, self, self.controlMilitaryAttacks, refusalCount, generateAutomationMessageRaid(empire), empire, AdvisorMessageType.PrepareRaid)) {
            self.empiresToAttack.push(empire);
            result = true;
        }
    }
    return result;
}

/** Empire.2.cs 4512 DetermineRandomAttacks. Rnd: Next(0, EmpiresWithDesiredColonies.Count), ShouldProvoke draws. */
export function determineRandomAttacks(galaxy: Galaxy, empire: Empire): void {
    const self = empire;
    identifyDesiredForeignColonies(galaxy, self);
    const refusalCount: RefCount = { value: 0 };
    const weightedMilitaryPotencyValue = weightedMilitaryPotency(self);
    let num = 0;
    const aggression = calculateAggressionFactor(galaxy, self);
    const caution = calculateCautionFactor(galaxy, self);
    const intoleranceLevel = galaxyIntoleranceLevel(galaxy);
    const empires = self.empiresWithDesiredColonies;
    const num2 = galaxy.rnd.next(0, empires.length);
    for (let i = num2; i < empires.length; i++) {
        if (num >= 1) break;
        const diplomaticRelation = obtainDiplomaticRelation(self, empires[i]);
        if (diplomaticRelation.type !== DiplomaticRelationType.War) {
            let flag = false;
            const strategy = diplomaticRelation.strategy;
            if (strategy === DiplomaticStrategy.Conquer || strategy === DiplomaticStrategy.Punish) flag = true;
            if (flag && determineAttackOnSingleEmpire(galaxy, self, empires[i], weightedMilitaryPotencyValue, aggression, caution, intoleranceLevel, refusalCount)) num++;
        }
    }
    for (let j = 0; j < num2; j++) {
        if (num >= 1) break;
        const diplomaticRelation2 = obtainDiplomaticRelation(self, empires[j]);
        if (diplomaticRelation2.type !== DiplomaticRelationType.War) {
            let flag2 = false;
            const strategy2 = diplomaticRelation2.strategy;
            if (strategy2 === DiplomaticStrategy.Conquer || strategy2 === DiplomaticStrategy.Punish) flag2 = true;
            if (flag2 && determineAttackOnSingleEmpire(galaxy, self, empires[j], weightedMilitaryPotencyValue, aggression, caution, intoleranceLevel, refusalCount)) num++;
        }
    }
}

/** Empire.2.cs 4566 IdentifyDesiredForeignColonies: fills Empire._DesiredForeignColonies / _EmpiresWithDesiredColonies. No Rnd. */
export function identifyDesiredForeignColonies(galaxy: Galaxy, self: Empire): void {
    self.desiredForeignColonies.length = 0;
    self.empiresWithDesiredColonies.length = 0;
    const resourceList = identifyDeficientEmpireResources(galaxy, self, false, 0.0);
    let num = galaxy.sizeX;
    let num2 = 0.0;
    let num3 = galaxy.sizeY;
    let num4 = 0.0;
    for (let i = 0; i < self.colonies.length; i++) {
        const habitat = self.colonies[i];
        if (habitat != null) {
            if (habitat.xpos < num) num = habitat.xpos;
            if (habitat.xpos > num2) num2 = habitat.xpos;
            if (habitat.ypos < num3) num3 = habitat.ypos;
            if (habitat.ypos > num4) num4 = habitat.ypos;
        }
    }
    num -= INDEX_SIZE;
    num2 += INDEX_SIZE;
    num3 -= INDEX_SIZE;
    num4 += INDEX_SIZE;
    const num5 = calculateAggressionFactor(galaxy, self);
    calculateCautionFactor(galaxy, self);
    const intoleranceLevel = galaxyIntoleranceLevel(galaxy);
    for (let j = 0; j < galaxy.empires.length; j++) {
        if (galaxy.empires[j] === self) continue;
        const empireEvaluation = obtainEmpireEvaluation(galaxy, self, galaxy.empires[j]);
        const num6 = 1.0 + Math.max(0.0, empireEvaluation.bias / -10.0);
        const otherColonies = galaxy.empires[j].colonies;
        for (let k = 0; k < otherColonies.length; k++) {
            const c = otherColonies[k];
            if (c == null || !(c.xpos > num) || !(c.xpos < num2) || !(c.ypos > num3) || !(c.ypos < num4)) continue;
            let num7 = 0.0;
            const habitat2 = c;
            if (!checkSystemExplored(self, habitat2.systemIndex)) continue;
            const habitat3 = habitat2;
            let d = strategicValue(habitat3);
            d = Math.sqrt(d);
            d *= 220.0;
            if (self.visibility.resourceMap.checkResourcesKnown(habitat2)) {
                for (let l = 0; l < 5 && l < resourceList.length; l++) {
                    const num8 = habitat3.resources.findIndex((r) => r.resourceId === resourceList[l].resourceId);
                    if (num8 >= 0) num7 += resourceList[l].sortTag * 10000.0;
                }
            }
            num7 = Math.min(num7, 220000.0);
            const ruin = habitat2.ruin;
            if (ruin !== null && (ruin.bonusDefensive > 0.0 || ruin.bonusDiplomacy > 0.0 || ruin.bonusHappiness > 0.0 || ruin.bonusResearchEnergy > 0.0 || ruin.bonusResearchHighTech > 0.0 || ruin.bonusResearchWeapons > 0.0 || ruin.bonusWealth > 0.0)) d *= 10.0;
            const habitat4 = fastFindNearestColony(galaxy, Math.trunc(habitat3.xpos), Math.trunc(habitat3.ypos), self, MAJOR_COLONY_STRATEGIC_THRESHHOLD);
            if (habitat4 !== null) {
                let num9 = Math.sqrt(galaxy.calculateDistance(habitat4.xpos, habitat4.ypos, habitat3.xpos, habitat3.ypos));
                num9 /= num6;
                num9 /= num5;
                num9 /= 1.0 + 3.0 * intoleranceLevel;
                d /= num9;
                num7 /= num9;
            } else {
                let num10 = Math.sqrt(galaxy.calculateDistance(self.capital!.xpos, self.capital!.ypos, habitat3.xpos, habitat3.ypos));
                num10 /= num6;
                num10 /= num5;
                num10 /= 1.0 + 3.0 * intoleranceLevel;
                d /= num10;
                num7 /= num10;
            }
            d *= galaxy.aggressionLevel;
            num7 *= galaxy.aggressionLevel;
            d = d * 0.3 + d * 0.7 * intoleranceLevel;
            num7 = num7 * 0.3 + num7 * 0.7 * intoleranceLevel;
            d = Math.min(d, 1000.0);
            num7 = Math.min(num7, 1000.0);
            if (d > DESIRED_FOREIGN_COLONY_STRATEGIC_THRESHHOLD) self.desiredForeignColonies.push(new HabitatPrioritization(habitat3, csDoubleToInt(d)));
            else if (num7 > DESIRED_FOREIGN_COLONY_RESOURCE_THRESHHOLD) self.desiredForeignColonies.push(new HabitatPrioritization(habitat3, csDoubleToInt(num7)));
        }
    }
    netSort(self.desiredForeignColonies, (a, b) => a.compareTo(b));
    self.desiredForeignColonies.reverse();
    for (let m = 0; m < self.desiredForeignColonies.length; m++) {
        const habitatPrioritization = self.desiredForeignColonies[m];
        const owner = habitatPrioritization.habitat!.owner;
        if (owner !== null && !self.empiresWithDesiredColonies.includes(owner)) self.empiresWithDesiredColonies.push(owner);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Fleet postures for diplomacy (Empire.9.cs 714-903, 1917-2037; Empire.7.cs 4828; Empire.3.cs 3399-3470)
// ---------------------------------------------------------------------------------------------------------------

/** Empire.9.cs 714/719 ClearAttackFleetAssignments([targetEmpire]) — null = every attack fleet. */
export function clearAttackFleetAssignments(galaxy: Galaxy, empire: Empire, targetEmpire: Empire | null): void {
    void galaxy;
    const shipGroups = shipGroupsOf(empire);
    if (!empire.controlMilitaryFleets || shipGroups === null) return;
    for (let i = 0; i < shipGroups.length; i++) {
        const shipGroup = shipGroups[i];
        if (shipGroup != null && shipGroup.leadShip !== null && shipGroup.posture === FleetPosture.Attack && shipGroup.attackPoint !== null && shipGroup.leadShip.isAutoControlled && (targetEmpire === null || stellarObjectEmpire(shipGroup.attackPoint) === targetEmpire)) {
            shipGroup.attackPoint = null;
            shipGroup.postureRangeSquared = Number.MAX_VALUE;
        }
    }
}

/** Empire.9.cs 736 CheckAttackFleetTargets(targetEmpires). Rnd: SelectFleetBase. */
export function checkAttackFleetTargets(galaxy: Galaxy, empire: Empire, targetEmpires: Empire[]): void {
    const shipGroups = shipGroupsOf(empire);
    if (!empire.controlMilitaryFleets || shipGroups === null) return;
    for (let i = 0; i < shipGroups.length; i++) {
        const shipGroup = shipGroups[i];
        if (shipGroup != null && shipGroup.leadShip !== null && shipGroup.posture === FleetPosture.Attack && shipGroup.attackPoint !== null && shipGroup.leadShip.isAutoControlled) {
            const ap = shipGroup.attackPoint;
            const apEmpire = stellarObjectEmpire(ap);
            if (ap.hasBeenDestroyed || apEmpire === null || !targetEmpires.includes(apEmpire)) {
                shipGroup.attackPoint = null;
                shipGroup.postureRangeSquared = Number.MAX_VALUE;
                const stellarObject = selectFleetBase(galaxy, empire, shipGroup);
                if (stellarObject !== null) shipGroup.gatherPoint = stellarObject;
            }
        }
    }
}

/**
 * Empire.9.cs 758 ClearDefendFleets. C# passes LeadShip.Xpos twice to FindNearestRefuellingPoint (x, x) — ported as
 * written.
 */
export function clearDefendFleets(galaxy: Galaxy, empire: Empire): void {
    if (!empire.controlMilitaryFleets) return;
    const empireList = resolveEmpiresAtWarWithOrPreparingToConquer(empire);
    if (empireList.length > 0) return;
    const shipGroups = shipGroupsOf(empire);
    for (let i = 0; i < shipGroups.length; i++) {
        const shipGroup = shipGroups[i];
        if (shipGroup == null || shipGroup.leadShip === null || !shipGroup.leadShip.isAutoControlled || shipGroup.posture !== FleetPosture.Defend) continue;
        shipGroup.posture = FleetPosture.Attack;
        const stellarObject = empireFindNearestRefuellingPoint(galaxy, empire, shipGroup.leadShip.xpos, shipGroup.leadShip.xpos, shipGroup.leadShip.fuelType, 4);
        if (shipGroup.gatherPoint === null || shipGroup.gatherPoint !== stellarObject) {
            shipGroup.gatherPoint = stellarObject;
            if (shipGroup.gatherPoint !== null && (shipGroup.mission === null || shipGroup.mission.type === BuiltObjectMissionType.Undefined || shipGroup.mission.priority === BuiltObjectMissionPriority.Low)) {
                shipGroupAssignMission(galaxy, shipGroup, BuiltObjectMissionType.Move, shipGroup.gatherPoint, null, BuiltObjectMissionPriority.Normal, false);
            }
        }
    }
}

/** Galaxy.7.cs 637 RemoveObjectsWithSystemStar(stellarObjects, systemStar). */
function removeObjectsWithSystemStar(stellarObjects: StellarObject[], systemStar: Habitat | null): StellarObject[] {
    const stellarObjectList: StellarObject[] = [];
    for (let i = 0; i < stellarObjects.length; i++) {
        const habitat = determineHabitatSystemStarForStellarObject(stellarObjects[i]);
        if (habitat !== systemStar) stellarObjectList.push(stellarObjects[i]);
    }
    return stellarObjectList;
}

/** Empire.9.cs 789/794 SetDefendFleets([defendingFromAttack, assignMovement]). */
export function setDefendFleets(galaxy: Galaxy, empire: Empire, defendingFromAttack: boolean, assignMovement: boolean): void {
    if (!empire.controlMilitaryFleets) return;
    const shipGroups = shipGroupsOf(empire);
    let num = 10;
    let val = 1;
    if (shipGroups.length <= 1) val = 0;
    if (defendingFromAttack) {
        num = 1000;
        val = 1;
    }
    let stellarObjects: StellarObject[] = resolveLocationsToDefend(galaxy, empire, true);
    stellarObjects = ensureSingleStellarObjectPerSystem(galaxy, stellarObjects);
    for (let i = 0; i < shipGroups.length; i++) {
        const shipGroup = shipGroups[i];
        if (shipGroup != null && shipGroup.leadShip !== null && shipGroup.leadShip.isAutoControlled && shipGroup.gatherPoint !== null && shipGroup.posture === FleetPosture.Defend) {
            let idx: number;
            while ((idx = stellarObjects.indexOf(shipGroup.gatherPoint)) >= 0) stellarObjects.splice(idx, 1);
            const systemStar = determineHabitatSystemStarForStellarObject(shipGroup.gatherPoint);
            stellarObjects = removeObjectsWithSystemStar(stellarObjects, systemStar);
        }
    }
    const shipGroupList: ShipGroup[] = [];
    let num2 = 0;
    for (let j = 0; j < shipGroups.length; j++) {
        if (shipGroups[j].ships.length < num) shipGroupList.push(shipGroups[j]);
        if (shipGroups[j].posture === FleetPosture.Defend) num2++;
    }
    let num3 = shipGroupList.length - Math.trunc(shipGroupList.length * 0.25);
    if (shipGroupList.length > 0) num3 = Math.max(val, num3);
    if (num2 >= num3) return;
    for (let k = 0; k < stellarObjects.length; k++) {
        const stellarObject = stellarObjects[k];
        let flag = assignMovement;
        let shipGroup2 = findNearestAvailableFleet(galaxy, empire, stellarObject.xpos, stellarObject.ypos, BuiltObjectMissionPriority.Low, 0, FleetPosture.Attack, false, 0.0, true, true);
        if (shipGroup2 === null) {
            shipGroup2 = findNearestAvailableFleet(galaxy, empire, stellarObject.xpos, stellarObject.ypos, BuiltObjectMissionPriority.Unavailable, 0, FleetPosture.Attack, false, 0.0, true, true);
            flag = false;
        }
        if (shipGroup2 !== null) {
            shipGroup2.gatherPoint = stellarObject;
            shipGroup2.posture = FleetPosture.Defend;
            shipGroup2.postureRangeSquared = POSTURE_RANGE_SQUARED_DEFEND;
            if (flag && shipGroup2.gatherPoint !== null) shipGroupAssignMission(galaxy, shipGroup2, BuiltObjectMissionType.Move, shipGroup2.gatherPoint, null, BuiltObjectMissionPriority.Normal, false);
            num2++;
        }
        if (num2 >= num3) break;
    }
}

/** Empire.9.cs 1917 ReviewDefensiveFleetLocations. Rnd: SelectFleetBase, fleet missions. */
export function reviewDefensiveFleetLocations(galaxy: Galaxy, empire: Empire): void {
    const shipGroups = shipGroupsOf(empire);
    if (!empire.controlMilitaryFleets || shipGroups === null) return;
    const stellarObjectList: (StellarObject | null)[] = [];
    for (let i = 0; i < shipGroups.length; i++) {
        const shipGroup = shipGroups[i];
        stellarObjectList.push(shipGroup.gatherPoint);
        if (shipGroup != null && shipGroup.leadShip !== null && shipGroup.posture === FleetPosture.Defend && shipGroup.leadShip.isAutoControlled) shipGroup.gatherPoint = null;
    }
    let stellarObjects: StellarObject[] = resolveLocationsToDefend(galaxy, empire, true);
    stellarObjects = ensureSingleStellarObjectPerSystem(galaxy, stellarObjects);
    for (let j = 0; j < stellarObjects.length; j++) {
        const stellarObject = stellarObjects[j];
        if (stellarObject == null || stellarObject.hasBeenDestroyed) continue;
        const shipGroup2 = findNearestAvailableFleet(galaxy, empire, stellarObject.xpos, stellarObject.ypos, BuiltObjectMissionPriority.Unavailable, 0, FleetPosture.Defend, false, 0.0, true, true, true);
        if (shipGroup2 !== null) {
            shipGroup2.gatherPoint = stellarObject;
            shipGroup2.postureRangeSquared = POSTURE_RANGE_SQUARED_DEFEND;
            let stellarObject2: StellarObject | null = null;
            const num = shipGroups.indexOf(shipGroup2);
            if (num >= 0 && num < stellarObjectList.length) stellarObject2 = stellarObjectList[num];
            if (shipGroup2.gatherPoint !== stellarObject2 && shipGroup2.mission !== null && shipGroup2.mission.type === BuiltObjectMissionType.Move && shipGroup2.mission.target === stellarObject2) shipGroupCompleteMissionWith(galaxy, shipGroup2, true);
        }
    }
    for (let k = 0; k < shipGroups.length; k++) {
        const shipGroup3 = shipGroups[k];
        if (shipGroup3 == null || shipGroup3.leadShip === null || shipGroup3.posture !== FleetPosture.Defend || shipGroup3.gatherPoint !== null || !shipGroup3.leadShip.isAutoControlled) continue;
        shipGroup3.posture = FleetPosture.Attack;
        shipGroup3.postureRangeSquared = Number.MAX_VALUE;
        const stellarObject3 = selectFleetBase(galaxy, empire, shipGroup3);
        if (stellarObject3 === null) continue;
        shipGroup3.gatherPoint = stellarObject3;
        if (
            (shipGroup3.mission !== null && shipGroup3.mission.type !== BuiltObjectMissionType.Undefined && shipGroup3.mission.priority !== BuiltObjectMissionPriority.Low) ||
            (shipGroup3.mission !== null && shipGroup3.mission.type === BuiltObjectMissionType.Move && shipGroup3.mission.target === shipGroup3.gatherPoint)
        ) {
            continue;
        }
        const num2 = galaxy.calculateDistance(shipGroup3.leadShip.xpos, shipGroup3.leadShip.ypos, stellarObject3.xpos, stellarObject3.ypos);
        if (!(num2 > 2000.0)) continue;
        let stellarObject4: StellarObject = stellarObject3;
        if (isHabitat(stellarObject3)) {
            const builtObject = determineSpacePortAtColony(galaxy, stellarObject3);
            if (builtObject !== null) stellarObject4 = builtObject;
        }
        if (stellarObject4 !== null && stellarIsRefuellingDepot(stellarObject4)) shipGroupAssignMission(galaxy, shipGroup3, BuiltObjectMissionType.Refuel, stellarObject4, null, BuiltObjectMissionPriority.Unavailable, false);
        else shipGroupAssignMission(galaxy, shipGroup3, BuiltObjectMissionType.Move, stellarObject3, null, BuiltObjectMissionPriority.Normal, false);
    }
}

/** Empire.9.cs 2007 SelectDefensiveFleetBase(fleet, defendLocations, moveToLocationIfAvailable). */
export function selectDefensiveFleetBase(galaxy: Galaxy, empire: Empire, fleet: ShipGroup, defendLocations: StellarObject[], moveToLocationIfAvailable: boolean): StellarObject | null {
    void empire;
    let stellarObject: StellarObject | null = null;
    let num = 0;
    let flag = false;
    const iterationCount = { value: 0 };
    while (conditionCheckLimit(!flag, 100, iterationCount) && num < defendLocations.length) {
        if (shipGroupCheckFleetTargetWithinFuelRangeAndRefuel(galaxy, fleet, defendLocations[num].xpos, defendLocations[num].ypos, 0.0)) {
            stellarObject = defendLocations[num];
            defendLocations.splice(num, 1);
            num--;
            if (
                stellarObject !== null &&
                moveToLocationIfAvailable &&
                (fleet.mission === null || fleet.mission.type === BuiltObjectMissionType.Undefined || fleet.mission.priority === BuiltObjectMissionPriority.Low) &&
                (fleet.mission === null || fleet.mission.type !== BuiltObjectMissionType.Move || fleet.mission.target !== stellarObject)
            ) {
                if (stellarIsRefuellingDepot(stellarObject)) shipGroupAssignMission(galaxy, fleet, BuiltObjectMissionType.Refuel, stellarObject, null, BuiltObjectMissionPriority.Unavailable, false);
                else shipGroupAssignMission(galaxy, fleet, BuiltObjectMissionType.Move, stellarObject, null, BuiltObjectMissionPriority.High, false);
            }
            flag = true;
        }
        num++;
    }
    return stellarObject;
}

/**
 * Galaxy.7.cs 579 EnsureSingleStellarObjectPerSystem(stellarObjects): keeps the largest object per system (SortTag =
 * BuiltObject.Size, or Max(StrategicValue / 10, StellarObject.Size) for a habitat — Habitat.Size is never assigned in
 * the C#, so 0 —, 1.0 otherwise), sorted with StellarObject.SortStellarObject (SortTag) then reversed. The SortTags are
 * local keys here (the C# writes StellarObject.SortTag; nothing reads a habitat's SortTag afterwards).
 */
export function ensureSingleStellarObjectPerSystem(galaxy: Galaxy, stellarObjects: StellarObject[]): StellarObject[] {
    void galaxy;
    const habitatList: Habitat[] = [];
    for (let i = 0; i < stellarObjects.length; i++) {
        const habitat = determineHabitatSystemStarForStellarObject(stellarObjects[i]);
        if (habitat !== null && !habitatList.includes(habitat)) habitatList.push(habitat);
    }
    for (let i = 0; i < habitatList.length; i++) {
        const systemStar = habitatList[i];
        const stellarObjectList: { o: StellarObject; sortTag: number }[] = [];
        for (let k = 0; k < stellarObjects.length; k++) {
            if (determineHabitatSystemStarForStellarObject(stellarObjects[k]) === systemStar) stellarObjectList.push({ o: stellarObjects[k], sortTag: 0 });
        }
        if (stellarObjectList.length <= 1) continue;
        for (let j = 0; j < stellarObjectList.length; j++) {
            const entry = stellarObjectList[j];
            const stellarObject = entry.o;
            if (isBuiltObject(stellarObject)) {
                entry.sortTag = stellarObject.size;
                stellarObject.sortTag = stellarObject.size;
            } else if (isHabitat(stellarObject)) {
                entry.sortTag = Math.max(strategicValue(stellarObject) / 10.0, 0);
            } else {
                entry.sortTag = 1.0;
            }
        }
        netSort(stellarObjectList, (a, b) => compareDouble(a.sortTag, b.sortTag));
        stellarObjectList.reverse();
        if (stellarObjectList.length > 1) {
            for (let k = 1; k < stellarObjectList.length; k++) {
                const idx = stellarObjects.indexOf(stellarObjectList[k].o);
                if (idx >= 0) stellarObjects.splice(idx, 1);
            }
        }
    }
    return stellarObjects;
}

/** Empire.9.cs 1276 EnsureBaseDefendedByFleet(builtObject) (M4s2's caller: PirateTaskFleets; ported at the M4m merge). */
export function ensureBaseDefendedByFleet(galaxy: Galaxy, self: Empire, builtObject: BuiltObject): void {
    let flag = false;
    const shipGroup = findNearestDefensiveFleet(galaxy, self, builtObject.xpos, builtObject.ypos);
    if (shipGroup !== null) {
        const num = galaxy.calculateDistance(shipGroup.leadShip!.xpos, shipGroup.leadShip!.ypos, builtObject.xpos, builtObject.ypos);
        if (num > 5000.0) {
            let flag2 = false;
            const shipGroups = shipGroupsOf(self);
            if (shipGroups !== null) {
                for (let i = 0; i < shipGroups.length; i++) {
                    const shipGroup2 = shipGroups[i];
                    if (shipGroup2.mission !== null && shipGroup2.mission.type !== BuiltObjectMissionType.Undefined && shipGroup2.mission.targetBuiltObject !== null && shipGroup2.mission.targetBuiltObject === builtObject) {
                        flag2 = true;
                        break;
                    }
                }
            }
            if (!flag2) flag = true;
        }
    } else {
        flag = true;
    }
    if (flag) {
        const fleet = findNearestAvailableFleet(galaxy, self, builtObject.xpos, builtObject.ypos, BuiltObjectMissionPriority.Normal, 0, FleetPosture.Defend, false, 0.0, true);
        if (fleet !== null) shipGroupAssignMission(galaxy, fleet, BuiltObjectMissionType.Move, builtObject, null, BuiltObjectMissionPriority.Normal, false);
    }
}

/** Empire.7.cs 4828 SendAttackFleets(targetEmpire). */
export function sendAttackFleets(galaxy: Galaxy, empire: Empire, targetEmpire: Empire): void {
    const shipGroups = shipGroupsOf(empire);
    for (let i = 0; i < shipGroups.length; i++) {
        const shipGroup = shipGroups[i];
        if (
            shipGroup.leadShip === null ||
            !shipGroup.leadShip.isAutoControlled ||
            shipGroup.attackPoint === null ||
            shipGroup.posture !== FleetPosture.Attack ||
            stellarObjectEmpire(shipGroup.attackPoint) !== targetEmpire ||
            (shipGroup.mission !== null && shipGroup.mission.type !== BuiltObjectMissionType.Undefined && shipGroup.mission.priority !== BuiltObjectMissionPriority.Low)
        ) {
            continue;
        }
        if (isHabitat(shipGroup.attackPoint)) {
            const habitat = shipGroup.attackPoint;
            if (!shipGroupCheckFleetTargetWithinFuelRangeAndRefuel(galaxy, shipGroup, habitat.xpos, habitat.ypos, 0.0)) {
                const requiredFuel = shipGroupCheckShipsRequiringRefuelling(shipGroup, 0.6, true).requiredFuel;
                assignFleetRefuelling(galaxy, empire, shipGroup, requiredFuel);
            } else if (checkBombardEnemyColony(galaxy, empire, habitat, shipGroup)) {
                shipGroupAssignMission(galaxy, shipGroup, BuiltObjectMissionType.Bombard, habitat, null, BuiltObjectMissionPriority.High, false);
            } else {
                shipGroupAssignMission(galaxy, shipGroup, BuiltObjectMissionType.Attack, habitat, null, BuiltObjectMissionPriority.High, false);
            }
        } else if (!shipGroupCheckFleetTargetWithinFuelRangeAndRefuel(galaxy, shipGroup, shipGroup.attackPoint.xpos, shipGroup.attackPoint.ypos, 0.0)) {
            const requiredFuel2 = shipGroupCheckShipsRequiringRefuelling(shipGroup, 0.6, true).requiredFuel;
            assignFleetRefuelling(galaxy, empire, shipGroup, requiredFuel2);
        } else {
            shipGroupAssignMission(galaxy, shipGroup, BuiltObjectMissionType.Attack, shipGroup.attackPoint, null, BuiltObjectMissionPriority.High, false);
        }
    }
}

/** Empire.3.cs 3399 ClearAttackersFromEmpire(ship, empire). */
function clearAttackersFromEmpire(ship: BuiltObject, empire: Empire): void {
    const attackers = (ship.attackers ?? []) as StellarObject[];
    const stellarObjectList: StellarObject[] = [];
    for (const attacker of attackers) {
        if (isBuiltObject(attacker) && attacker.empire === empire) stellarObjectList.push(attacker);
    }
    for (const item of stellarObjectList) {
        const i = attackers.indexOf(item);
        if (i >= 0) attackers.splice(i, 1);
    }
}

const ATTACK_MISSION_TYPES_TO_CANCEL = (): BuiltObjectMissionType[] => [
    BuiltObjectMissionType.Attack,
    BuiltObjectMissionType.WaitAndAttack,
    BuiltObjectMissionType.Bombard,
    BuiltObjectMissionType.WaitAndBombard,
    BuiltObjectMissionType.Capture,
    BuiltObjectMissionType.Raid,
];

/**
 * Empire.3.cs 3443 CancelAttacksAgainstEmpire(empire), mission part (3419 CancelAttackMissionAgainstEmpireForSingleShip for
 * every state and private ship, 3430 ...ForSingleShipGroup for every fleet); ClearOutlawsFromEmpire is in diplomacyTick.ts.
 */
export function cancelAttackMissionsAgainstEmpire(galaxy: Galaxy, empire: Empire, targetEmpire: Empire): void {
    const types = ATTACK_MISSION_TYPES_TO_CANCEL();
    const forShip = (ship: BuiltObject): void => {
        for (const t of types) clearAllMissionsForTargetEmpire(galaxy, ship, ship, targetEmpire, t, true);
        clearAttackersFromEmpire(ship, targetEmpire);
    };
    for (let i = 0; i < empire.builtObjects.length; i++) forShip(empire.builtObjects[i]);
    for (let j = 0; j < empire.privateBuiltObjects.length; j++) forShip(empire.privateBuiltObjects[j]);
    const shipGroups = shipGroupsOf(empire);
    if (shipGroups !== null) {
        for (let k = 0; k < shipGroups.length; k++) {
            const shipGroup = shipGroups[k];
            if (shipGroup.mission !== null) {
                for (const t of types) shipGroupClearAllMissionsForTargetEmpire(galaxy, shipGroup, targetEmpire, t);
            }
        }
    }
}

/** Empire.9.cs 4613 FindAvailableExplorationShip. */
function findAvailableExplorationShip(self: Empire): BuiltObject | null {
    let result: BuiltObject | null = null;
    for (let i = 0; i < self.builtObjects.length; i++) {
        if (self.builtObjects[i].subRole === BuiltObjectSubRole.ExplorationShip) {
            const builtObject = self.builtObjects[i];
            const m = missionOf(builtObject);
            if (
                builtObject.builtAt === null &&
                builtObject.isAutoControlled &&
                (m === null || m.type === BuiltObjectMissionType.Undefined || m.priority === BuiltObjectMissionPriority.Undefined || m.priority === BuiltObjectMissionPriority.Low || m.priority === BuiltObjectMissionPriority.Normal)
            ) {
                result = builtObject;
                break;
            }
        }
    }
    return result;
}

/** Empire.9.cs 4481 SendScoutsToSingleEnemyEmpire(enemyEmpire, availableScouts): scouts sent (MoveAndWait missions). */
export function sendScoutsToSingleEnemyEmpire(galaxy: Galaxy, empire: Empire, enemyEmpire: Empire, availableScouts: number): number {
    let num = 0;
    const habitatList = determineEmpireSystems(galaxy, enemyEmpire, false);
    const systemInfoDistanceList: { systemInfo: (typeof galaxy.systems)[number]; distance: number }[] = [];
    for (const item of habitatList) {
        const systemInfo = galaxy.systems[item.systemIndex];
        let distance = 0.0;
        if (systemInfo.dominantEmpire != null && systemInfo.dominantEmpire.empire != null && systemInfo.dominantEmpire.empire === enemyEmpire) {
            distance = systemInfo.dominantEmpire.totalStrategicValue;
        } else if (systemInfo.otherEmpires != null && systemInfo.otherEmpires.length > 0) {
            for (let i = 0; i < systemInfo.otherEmpires.length; i++) {
                if (systemInfo.otherEmpires[i].empire === enemyEmpire) {
                    distance = systemInfo.otherEmpires[i].totalStrategicValue;
                    break;
                }
            }
        }
        systemInfoDistanceList.push({ systemInfo, distance });
    }
    netSort(systemInfoDistanceList, (a, b) => compareDouble(a.distance, b.distance));
    systemInfoDistanceList.reverse();
    for (let j = 0; j < systemInfoDistanceList.length; j++) {
        if (availableScouts <= 0) break;
        if (empire.visibility.checkSystemVisibilityStatus(systemInfoDistanceList[j].systemInfo.systemStar.systemIndex) !== SystemVisibilityStatus.Explored) continue;
        const builtObject = findAvailableExplorationShip(empire);
        if (builtObject === null) continue;
        let habitat: Habitat | null = null;
        const habitats = systemInfoDistanceList[j].systemInfo.habitats;
        if (habitats == null || habitats.length <= 0) continue;
        let num2 = 0;
        let num3 = habitats.length - 1;
        while (habitat === null && num2 < 30 && num3 >= 0) {
            habitat = habitats[num3];
            let flag = true;
            if (habitat != null) {
                const builtObject2 = galaxy.findNearestBuiltObjectOfEmpire(Math.trunc(habitat.xpos), Math.trunc(habitat.ypos), enemyEmpire);
                if (builtObject2 !== null) {
                    const num4 = galaxy.calculateDistance(builtObject2.xpos, builtObject2.ypos, habitat.xpos, habitat.ypos);
                    if (num4 < 2500.0) flag = false;
                }
                if (!flag) habitat = null;
            }
            num3--;
            num2++;
        }
        if (habitat !== null && withinFuelRangeAndRefuel(galaxy, builtObject, habitat.xpos, habitat.ypos, 0.1)) {
            const starDate = galaxyStarDate(galaxy) + 180000;
            assignMission(galaxy, builtObject, BuiltObjectMissionType.MoveAndWait, habitat, null, BuiltObjectMissionPriority.High, { x: -2000000001.0, y: -2000000001.0, starDate, allowReprocessing: true });
            availableScouts--;
            num++;
        }
    }
    return num;
}

// ---------------------------------------------------------------------------------------------------------------
// Coordinated attacks with allies (Empire.1.cs 3730 / 3750)
// ---------------------------------------------------------------------------------------------------------------

/** Empire.1.cs 3730 CoordinateFleetAttacksWithAllies(fleet). */
export function coordinateFleetAttacksWithAllies(galaxy: Galaxy, empire: Empire, fleet: ShipGroup): boolean {
    if (empire !== galaxy.playerEmpire && empire.controlMilitaryAttacks === AutomationLevel.FullyAutomated && fleet !== null && fleet.ships !== null && fleet.ships.length >= 10 && fleet.posture === FleetPosture.Attack && fleet.leadShip !== null && fleet.leadShip.isAutoControlled) {
        const fe = determineFriendsAndEnemies(empire);
        const closeFriends = fe.closeFriends;
        const severeEnemies = fe.severeEnemies;
        if (closeFriends.length > 0 && severeEnemies.length > 0) {
            for (let i = 0; i < closeFriends.length; i++) {
                const empire2 = closeFriends[i];
                if (empire2 !== null && empire2.shipGroups !== null && empire2.shipGroups.length > 0 && coordinateFleetAttacksWithAlliesOf(galaxy, empire, fleet, empire2, severeEnemies)) return true;
            }
        }
    }
    return false;
}

/** Empire.1.cs 3750 CoordinateFleetAttacksWithAllies(fleet, empire, enemies). Rnd: fleet.AssignMission(Attack). */
export function coordinateFleetAttacksWithAlliesOf(galaxy: Galaxy, self: Empire, fleet: ShipGroup, empire: Empire, enemies: Empire[] | null): boolean {
    const allyGroups = shipGroupsOf(empire);
    if (fleet !== null && empire !== null && allyGroups !== null && allyGroups.length > 0) {
        for (let i = 0; i < allyGroups.length; i++) {
            const shipGroup = allyGroups[i];
            if (shipGroup == null || shipGroup === fleet || shipGroup.ships === null || shipGroup.ships.length < 10) continue;
            const mission = shipGroup.mission;
            if (mission === null) continue;
            if (mission.type !== BuiltObjectMissionType.Attack) continue;
            const empire2 = BuiltObjectMission.resolveMissionTargetEmpire(mission);
            if (enemies !== null && !enemies.includes(empire2 as Empire)) continue;
            const point = mission.resolveTargetCoordinates(mission);
            const leadShip = fleet.leadShip;
            if (leadShip === null || !shipGroupCheckFleetTargetWithinFuelRange(galaxy, fleet, point.x, point.y, 0.2)) continue;
            const num = calculateDistanceStatic(point.x, point.y, leadShip.xpos, leadShip.ypos);
            if (!(num < SECTOR_SIZE * 3.0)) continue;
            const r = shipGroupListResolveFleetsWithAttackTarget(shipGroupsOf(self), mission.target);
            const shipGroupList = r.fleets;
            const num2 = num / r.nearestDistance;
            if ((shipGroupList.length > 0 && (shipGroupList.length >= 3 || !(num2 < 0.5))) || !shipGroupAssignMission(galaxy, fleet, BuiltObjectMissionType.Attack, mission.target, null, BuiltObjectMissionPriority.High, false)) continue;
            if (empire !== self) {
                let arg = '';
                if (mission.targetBuiltObject !== null) arg = mission.targetBuiltObject.name;
                else if (mission.targetHabitat !== null) arg = mission.targetHabitat.name;
                else if (mission.targetShipGroup !== null) arg = mission.targetShipGroup.name ?? '';
                else if (mission.targetCreature !== null) arg = mission.targetCreature.name;
                const description = formatText(getText('We are sending our FLEET to join your attack on TARGET of EMPIRE'), fleet.name, arg, empire2!.name);
                const title = formatText(getText('EMPIRE sends fleet to join our attack on TARGET'), self.name, arg);
                sendMessageToEmpireWithTitle(self, empire, EmpireMessageType.BattleAttacking, mission.target, description, title);
            }
            return true;
        }
    }
    return false;
}

// ---------------------------------------------------------------------------------------------------------------
// Fleet side of the war preparation (Empire.8.cs 1014 PrepareFleetsForWar, 1428 CheckReadyForWar) — the diplomacy
// halves are in diplomacyTick.ts (M4r), which calls these for WarObjective.CaptureObjectives.
// ---------------------------------------------------------------------------------------------------------------

/** Empire.8.cs 1025-1140 PrepareFleetsForWar CaptureObjectives branch: fleets given an attack point. Rnd: Refuel missions. */
export function prepareFleetsForWarCaptureObjectives(galaxy: Galaxy, self: Empire, otherEmpire: Empire): number {
    let num = 0;
    const diplomaticRelation = obtainDiplomaticRelation(self, otherEmpire);
    for (let i = 0; i < diplomaticRelation.warObjectiveColonies.length; i++) {
        const habitat = diplomaticRelation.warObjectiveColonies[i];
        if (habitat == null) continue;
        let num2 = estimatedDefensiveForceRequired(galaxy, habitat, true, galaxy.difficultyLevel);
        const num3 = determineRequiredTroopStrength(galaxy, self, habitat);
        if (self.visibility.checkSystemVisible(habitat.systemIndex)) num2 = determineDefendingStrength(galaxy, habitat, otherEmpire);
        const shipGroupList = generateOrderedFleetsForTarget(galaxy, self, habitat.xpos, habitat.ypos, false);
        if (shipGroupList.length <= 0) continue;
        let num4 = 0;
        let num5 = 0;
        for (let j = 0; j < shipGroupList.length; j++) {
            const shipGroup = shipGroupList[j];
            if (shipGroup != null && shipGroup.leadShip !== null && shipGroup.leadShip.isAutoControlled && shipGroup.ships.length >= 10 && shipGroup.posture === FleetPosture.Attack && shipGroup.attackPoint === null && shipGroupTotalTroopAttackStrength(shipGroup) >= Math.trunc(num3 / 2)) {
                let flag = false;
                if (shipGroup.mission === null || shipGroup.mission.type === BuiltObjectMissionType.Undefined || shipGroup.mission.priority === BuiltObjectMissionPriority.Low) flag = true;
                const requiredFuel = determineFuelRequiredForFleet(shipGroup).requiredFuel;
                const stellarObject = decideBestFleetRefuelPoint(galaxy, self, habitat.xpos, habitat.ypos, self, requiredFuel, otherEmpire);
                if (stellarObject !== null && shipGroupCheckFleetTargetWithinFuelRangeAndRefuel(galaxy, shipGroup, stellarObject.xpos, stellarObject.ypos, 0.0)) {
                    const num6 = shipGroupMaximumRange(shipGroup);
                    const num7 = galaxy.calculateDistance(stellarObject.xpos, stellarObject.ypos, habitat.xpos, habitat.ypos);
                    if (num7 < num6 * 0.45) {
                        shipGroup.gatherPoint = stellarObject;
                        shipGroup.attackPoint = habitat;
                        shipGroup.postureRangeSquared = POSTURE_RANGE_SQUARED_ATTACK_POINT;
                        if (flag && stellarObject !== null) shipGroupAssignMission(galaxy, shipGroup, BuiltObjectMissionType.Refuel, stellarObject, null, BuiltObjectMissionPriority.Unavailable, true);
                        num4 += shipGroupTotalOverallStrengthFactor(galaxy, shipGroup);
                        num5 += shipGroupTotalTroopAttackStrength(shipGroup);
                        num++;
                    }
                }
            }
            if (num4 >= num2 && num5 >= num3) break;
        }
    }
    for (let k = 0; k < diplomaticRelation.warObjectiveBases.length; k++) {
        const builtObject = diplomaticRelation.warObjectiveBases[k];
        if (builtObject == null) continue;
        let val = calculateOverallStrengthFactor(builtObject);
        if (isObjectVisibleToThisEmpire(galaxy, self, builtObject)) val = determineDefendingStrength(galaxy, builtObject, otherEmpire);
        val = Math.max(1, val);
        const num8 = 0;
        const shipGroupList2 = generateOrderedFleetsForTarget(galaxy, self, builtObject.xpos, builtObject.ypos, true);
        if (shipGroupList2.length <= 0) continue;
        let num9 = 0;
        let num10 = 0;
        for (let l = 0; l < shipGroupList2.length; l++) {
            const shipGroup2 = shipGroupList2[l];
            if (shipGroup2 != null && shipGroup2.leadShip !== null && shipGroup2.leadShip.isAutoControlled && shipGroup2.posture === FleetPosture.Attack && shipGroup2.attackPoint === null) {
                let flag2 = false;
                if (shipGroup2.mission === null || shipGroup2.mission.type === BuiltObjectMissionType.Undefined || shipGroup2.mission.priority === BuiltObjectMissionPriority.Low) flag2 = true;
                const requiredFuel2 = determineFuelRequiredForFleet(shipGroup2).requiredFuel;
                const stellarObject2 = decideBestFleetRefuelPoint(galaxy, self, builtObject.xpos, builtObject.ypos, self, requiredFuel2, otherEmpire);
                if (stellarObject2 !== null && shipGroupCheckFleetTargetWithinFuelRangeAndRefuel(galaxy, shipGroup2, stellarObject2.xpos, stellarObject2.ypos, 0.0)) {
                    const num11 = shipGroupMaximumRange(shipGroup2);
                    const num12 = galaxy.calculateDistance(stellarObject2.xpos, stellarObject2.ypos, builtObject.xpos, builtObject.ypos);
                    if (num12 < num11 * 0.45) {
                        shipGroup2.gatherPoint = stellarObject2;
                        shipGroup2.attackPoint = builtObject;
                        shipGroup2.postureRangeSquared = POSTURE_RANGE_SQUARED_ATTACK_POINT;
                        if (flag2 && stellarObject2 !== null) shipGroupAssignMission(galaxy, shipGroup2, BuiltObjectMissionType.Refuel, stellarObject2, null, BuiltObjectMissionPriority.Unavailable, true);
                        num9 += shipGroupTotalOverallStrengthFactor(galaxy, shipGroup2);
                        num10 += shipGroupTotalTroopAttackStrength(shipGroup2);
                        num++;
                    }
                }
            }
            if (num9 >= val && num10 >= num8) break;
        }
    }
    return num;
}

/** Empire.8.cs 1451-1504 CheckReadyForWar CaptureObjectives branch: false while an attack fleet is still refuelling / gathering. */
export function checkReadyForWarCaptureObjectives(galaxy: Galaxy, self: Empire): boolean {
    let result = true;
    const shipGroups = shipGroupsOf(self);
    for (let j = 0; j < shipGroups.length; j++) {
        const shipGroup2 = shipGroups[j];
        if (shipGroup2.posture !== FleetPosture.Attack || shipGroup2.attackPoint === null || shipGroup2.leadShip === null || !shipGroup2.leadShip.isAutoControlled || shipGroup2.gatherPoint === null) continue;
        if (shipGroup2.mission !== null && shipGroup2.mission.type === BuiltObjectMissionType.Refuel) {
            result = false;
        } else if (shipGroup2.mission === null || shipGroup2.mission.type === BuiltObjectMissionType.Undefined) {
            const num2 = galaxy.calculateDistance(shipGroup2.leadShip.xpos, shipGroup2.leadShip.ypos, shipGroup2.gatherPoint.xpos, shipGroup2.gatherPoint.ypos);
            const d = determineFuelRequiredForFleet(shipGroup2);
            const fleetFuelCapacity = d.fleetFuelCapacity;
            let num3 = 0;
            for (let k = 0; k < d.requiredFuel.length; k++) num3 += Math.trunc(d.requiredFuel[k].sortTag);
            const num4 = (fleetFuelCapacity - num3) / fleetFuelCapacity;
            if (num2 > 48000.0 && shipGroup2.gatherPoint !== null) {
                shipGroupAssignMission(galaxy, shipGroup2, BuiltObjectMissionType.Refuel, shipGroup2.gatherPoint, null, BuiltObjectMissionPriority.Unavailable, true);
                result = false;
            } else if ((!(num2 <= 48000.0) || !(num4 > 0.75)) && shipGroup2.gatherPoint !== null) {
                shipGroupAssignMission(galaxy, shipGroup2, BuiltObjectMissionType.Refuel, shipGroup2.gatherPoint, null, BuiltObjectMissionPriority.Unavailable, true);
                result = false;
            }
        } else if (shipGroup2.mission !== null && shipGroup2.mission.priority === BuiltObjectMissionPriority.Low && shipGroup2.mission.type === BuiltObjectMissionType.Move && shipGroup2.mission.target === shipGroup2.gatherPoint) {
            result = false;
        } else if (shipGroup2.mission !== null && shipGroup2.mission.type === BuiltObjectMissionType.Blockade && shipGroup2.mission.target !== null) {
            const point = shipGroup2.mission.resolveTargetCoordinates(shipGroup2.mission);
            const num5 = galaxy.calculateDistance(shipGroup2.leadShip.xpos, shipGroup2.leadShip.ypos, point.x, point.y);
            if (num5 > 48000.0) result = false;
        } else if (shipGroup2.gatherPoint !== null && self !== galaxy.playerEmpire) {
            result = false;
        }
    }
    return result;
}
