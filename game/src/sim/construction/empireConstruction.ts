// M4i — empire construction AI: state construction (DirectConstruction), retirement / scrapping, design reviews,
// retrofits, defensive bases, monitoring-station locations, plus the shared construction helpers they need.
//
// C# sources (DistantWorlds.Types unless noted):
//   Empire.6.cs 2373 DirectConstruction, 587 RetireOldBuiltObjects, 554 GetPrivateAnnualCashflow, 718
//   ShouldRetireFreighter, 488-586 AssignScrapMission, 842 ObtainBuildResourcesForConstructionShip, 859-1121
//   ProcureConstructionComponents / CheckCargoForComponent(Resource)Supply, 2280 CheckShouldAttemptColonization,
//   2300-2372 RefactorForceStructureProjectionsToCosts, 3340-3704 RetrofitBuiltObjects / DoRetrofit, 3706
//   CalculateRetrofitCosts; Empire.10.cs 3065 ReviewLatestDesigns, 1211 BuildDefensiveBases, 460 CheckThreatIsEnemy,
//   492 CheckSafeToBuildAtLocation, 559 CanBuildBuiltObject, 3640-3677 GenerateAutomationMessage*;
//   Empire.5.cs 3769 DetermineMonitoringStationLocation (+ 3924 CheckCoordsWithinGalaxy, 3937
//   ObtainCoordinatesFromPoint), 13-353 CalculateRetrofitCost / DetermineRetrofitAffordability / AssignRetrofitMission,
//   397 FindNearestShipYard; Empire.1.cs 3403 ReviewDesignsAndRetrofit, 4002 CheckBuildoutResearchCapacityAtColonies;
//   Empire.4.cs 2171 DetermineHabitatsWithBasesIncludingBuilding, 2214 DetermineHabitatsBeingMinedIncluding-
//   BuildingMiningStations, 2312 DetermineHabitatsBeingColonized; Empire.2.cs 625 NewBuiltObjectShouldBeAutomated;
//   Empire.3.cs 4122 CalculateAccurateAnnualCashflow; Empire.9.cs 5342 CalculateSpareAnnualRevenueComplete, 590/620
//   CheckFleetNeedsRetrofit / AssignFleetRetrofit, 3422 FindLongRangeScannerThatCanSeePoint; Empire.cs 2008/2149
//   Annual{State,Private}MaintenanceWithoutRetirees; Galaxy.3.cs 663 FastFindNearestLongRangeScannerBase; Galaxy.7.cs
//   1548 FindNearestUncolonizedExploredSystem; Galaxy.9.cs 252 IdentifyPirateSpaceport; HabitatList.cs 426-499 and
//   BuiltObjectList.cs 232-274 + BaconBuiltObjectList.cs 14 FindShortestConstructionWaitQueue(*); BuiltObjectList.cs 393
//   GetShipsWithoutWarpDrives; BuiltObject.2.cs 7506-7548 QueueMission; Design.cs 1088 GetLeaderMaintenanceBonuses;
//   BaconDesign.cs 163 CalculateMaintenanceCosts.
//
// Rnd (galaxy.rnd, C# order):
//   DirectConstruction: SelectRelativePoint + SelectRandomHeading per queued space port; DetermineOrbitalBaseLocation
//     (≤100 × NextDouble, Next(0, 2), NextDouble) + SelectRandomHeading for a research station; the draws of
//     Galaxy.GenerateBuiltObjectName (galaxy.ts); RefactorForceStructureProjectionsToCosts Next(0, Count) per
//     remaining projection (randomizedOrder: true).
//   BuildDefensiveBases: GenerateBuiltObjectName, then Next(0, 5) name, DetermineOrbitalBaseLocation,
//     SelectRandomHeading per base queued.
//   DetermineMonitoringStationLocation: Next(0, habitats) per chosen system; SelectRandomHeading + 2 × Next(0, 2)
//     (ObtainCoordinatesFromPoint) per fall-back point attempt.
//   Retirement / retrofit / scrapping: none directly (CompleteTeardown / InflictDamage are M4o's).

import { registerTodo, todo } from '../tick/todo';
import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import { AutomationLevel, empireGovernmentAttributes } from '../empire';
import { BuiltObject } from '../builtObject';
import { Habitat, HabitatType, IndustryType } from '../types';
import type { Design } from '../design';
import { SHIP_MARKUP_FACTOR, SHIP_MARKUP_FACTOR_PIRATES, galaxyComponentCurrentPrices } from '../design';
import { BuiltObjectSubRole } from '../builtObjectTypes';
import { BuiltObjectRole } from '../data/designSpecifications';
import type { ComponentDefinition } from '../componentStatic';
import { DEFAULT_BASE_TECH_COST } from '../componentStatic';
import { ComponentStatus } from '../builtObjectComponent';
import { Cargo, CargoList, ResourceRef } from '../cargo';
import { galaxyNow, galaxyStarDate } from '../tick/simTime';
import { REAL_SECONDS_IN_GALACTIC_YEAR } from '../galaxyTime';
import { netSort } from '../netSort';
import { ComponentType } from '../data/components';
import { ShipDesignFocus } from '../researchSystem';
import { findNewestCanBuild, findNewestCanBuildFullEvaluate, canBuildDesign, createNewDesigns } from '../designGeneration';
import {
    SHIP_MAINTENANCE_COST_PER_SIZE_UNIT,
    ALLOWABLE_YEARS_MAINTENANCE_FROM_CASH_ON_HAND,
    annualStateMaintenance,
    annualPrivateMaintenance,
    annualSubjugationTribute,
    annualPirateProtection,
    annualTaxRevenue,
    calculateAccurateAnnualIncome,
    calculateAnnualSubjugationTributeIncome,
    calculateSpareAnnualRevenue,
    calculateSupportCost,
    checkAtWar,
    checkEmpireHasHyperDriveTech,
    currentStateForceStructure,
    estimateForceStructureSupportCost,
    privateAnnualRevenue,
    getPrivateFunds,
    annualPrivateMaintenanceExcludingUnderConstruction,
} from '../forceStructure';
import { annualStateMaintenanceExcludingUnderConstruction } from '../treasury';
import { annualTroopMaintenance, estimatedDefensiveForceRequired } from '../troops';
import { ForceStructureProjection, ForceStructureProjectionList } from '../forceStructureProjection';
import { determineNewSpacePortLocations, analyzeNewResearchFacilities } from '../stationPlacement';
import { determineOrbitalBaseLocation } from '../pirates';
import { AdvisorMessageType, checkTaskAuthorized, formatText, formatThousands, getText, type RefCount } from '../diplomacyTick';
import { gameText } from '../colonyTick';
import { EmpireMessage, EmpireMessageType, sendEmpireMessage } from '../messages';
import { ConstructionQueue, canBuiltObjectColonizeHabitat, resolveBuildSpeed } from './constructionQueue';
import { componentListDiff, resolveComponentList } from './constructionYard';
import { ManufacturingQueue, builtObjectManufacturingQueue, habitatManufacturingQueue } from '../manufacturingQueue';
import { OrderType, empireCreateOrder, performPrivateTransaction } from '../logistics/orders';
import { privateSectorBuildOrRefitInvestInInfrastructure } from './retrofit';
import { pirateEconomyPerformExpense, calculatePirateCashflow } from '../pirates/pirateAI';
import { PirateExpenseType } from '../pirates/pirateEconomy';
import { assignMission, clearPreviousMissionRequirements } from '../missions/assign';
import { BuiltObjectMission, BuiltObjectMissionPriority, BuiltObjectMissionType, builtObjectMission, missionListContainsType, type MissionTarget, type StellarObject } from '../missions/mission';
import { withinFuelRange } from '../movement';
import { builtObjectCompleteTeardown } from '../combat/teardown';
import { identifyPirateSpaceport, inflictDamageFull } from '../combat/damage';
import { determineSpacePortAtColony } from '../combat/attackAI';
import { checkWithinCreatureAttackRange, fastFindNearestColony } from '../combat/threats';
import { checkInStorm, checkNearPirateBase, checkConstructionShipAndMiningStationCanSurviveStorms } from '../resourceTargets';
import { resolveLocationsToDefend } from '../characters';
import { strategicValue } from '../territory';
import { DiplomaticRelationType, DiplomaticStrategy, obtainDiplomaticRelation, obtainEmpireEvaluation } from '../diplomacy';
import { PirateRelationType, obtainPirateRelation } from '../pirateRelations';
import { SystemVisibilityStatus } from '../visibility';
import { isObjectVisibleToThisEmpire } from '../independentTraders';
import { checkColonizationLikeliness } from '../tradeItems';
import { type ShipGroup, empireShipGroups, shipGroupAssignMission } from '../fleets/shipGroup';
import { shipGroupQueueMission } from '../fleets/shipGroupTasks';

// ---------------------------------------------------------------------------------------------------------------
// Constants (Galaxy.3.cs 4996-5138 defaults)
// ---------------------------------------------------------------------------------------------------------------

/** Galaxy.HabitatColonizationThreshhold = 5 (Galaxy.3.cs 4996). */
export const HABITAT_COLONIZATION_THRESHHOLD = 5;
/** Galaxy.MinimumOrderAmount = 60 (Galaxy.3.cs 5028). */
export const MINIMUM_ORDER_AMOUNT = 60;
/** Galaxy.RetirementYears = 20 (Galaxy.3.cs 5031). */
export const RETIREMENT_YEARS = 20;
/** Galaxy.RetrofitYears = 1 (Galaxy.3.cs 5032). */
export const RETROFIT_YEARS = 1;
/** Galaxy.MaximumConstructionQueueWaitTimeYears = 2.5 (Galaxy.3.cs 5033). */
export const MAXIMUM_CONSTRUCTION_QUEUE_WAIT_TIME_YEARS = 2.5;
/** Galaxy.MaxSolarSystemSize = 23000. */
const MAX_SOLAR_SYSTEM_SIZE = 23000;

/** DesignList.FindNewestCanBuild(subRole[, colony]) (DesignList.cs 140/148): the empire is the first design's owner. */
function dlFindNewestCanBuild(designs: Design[], subRole: BuiltObjectSubRole, colony: Habitat | null = null): Design | null {
    let empire: Empire | null = null;
    if (designs.length > 0 && designs[0] != null) empire = designs[0].empire as Empire | null;
    return findNewestCanBuild(designs, subRole, empire, colony);
}

/** Galaxy.ConditionCheckLimit(condition, maximumIterations, ref iterationCount). */
function conditionCheckLimit(condition: boolean, maximumIterations: number, iterationCount: { count: number }): boolean {
    iterationCount.count++;
    if (iterationCount.count > maximumIterations) return false;
    return condition;
}

/** BuiltObjectList.CountResearchStations (BuiltObjectList.cs 176). */
function countResearchStations(list: readonly (BuiltObject | null)[]): number {
    let num = 0;
    for (let i = 0; i < list.length; i++) {
        const b = list[i];
        if (b != null && (b.subRole === BuiltObjectSubRole.EnergyResearchStation || b.subRole === BuiltObjectSubRole.HighTechResearchStation || b.subRole === BuiltObjectSubRole.WeaponsResearchStation)) num++;
    }
    return num;
}

/** BuiltObjectList.CountBySubRole (BuiltObjectList.cs 190). */
function countBySubRole(list: readonly (BuiltObject | null)[], subRole: BuiltObjectSubRole): number {
    let num = 0;
    for (let i = 0; i < list.length; i++) if (list[i] != null && list[i]!.subRole === subRole) num++;
    return num;
}

/** Galaxy.ResolveBuildSpeed(empire, galaxy, builtObject) (considerAllComponents: true). */
function buildSpeed(galaxy: Galaxy, empire: Empire, builtObject: BuiltObject): number {
    return resolveBuildSpeed(empire, galaxy, builtObject).result;
}

/** ConstructionQueue as the typed value of Habitat / BuiltObject .ConstructionQueue (declared `unknown`). */
export function queueOf(o: Habitat | BuiltObject): ConstructionQueue | null {
    return (o.constructionQueue as ConstructionQueue | null) ?? null;
}

/** "ConstructionQueue.ConstructionYards has a yard with ShipUnderConstruction == null" (Empire.5.cs 162-172 and repeats). */
function hasFreeYard(queue: ConstructionQueue | null): boolean {
    if (queue !== null && queue.constructionYards !== null) {
        for (let i = 0; i < queue.constructionYards.length; i++) {
            if (queue.constructionYards[i].shipUnderConstruction === null) return true;
        }
    }
    return false;
}

// ---------------------------------------------------------------------------------------------------------------
// Shared construction helpers
// ---------------------------------------------------------------------------------------------------------------

/** Design.cs 1088 GetLeaderMaintenanceBonuses(design, empire). */
function getLeaderMaintenanceBonuses(design: Design, empire: Empire | null): number {
    let num = 0;
    if (empire !== null) {
        const leader = empire.leader;
        switch (design.role) {
            case BuiltObjectRole.Military:
                if (leader !== null) num += leader.militaryShipMaintenance;
                break;
            case BuiltObjectRole.Base:
                switch (design.subRole) {
                    case BuiltObjectSubRole.SmallSpacePort:
                    case BuiltObjectSubRole.MediumSpacePort:
                    case BuiltObjectSubRole.LargeSpacePort:
                    case BuiltObjectSubRole.DefensiveBase:
                        if (leader !== null) num += leader.militaryBaseMaintenance;
                        break;
                    default:
                        if (leader !== null) num += leader.civilianBaseMaintenance;
                        break;
                }
                break;
            default:
                if (leader !== null) num += leader.civilianShipMaintenance;
                break;
        }
    }
    return num;
}

/** BaconDesign.cs 163 CalculateMaintenanceCosts(design, galaxy, empire) (Design.cs 1132). */
export function designCalculateMaintenanceCosts(galaxy: Galaxy, design: Design, empire: Empire): number {
    const price = design.calculateCurrentPurchasePrice(galaxy);
    const num1 = (empire.pirateEmpireBaseHabitat !== null ? Math.trunc(price / (SHIP_MARKUP_FACTOR_PIRATES * 2.0)) + 1 : Math.trunc(price / SHIP_MARKUP_FACTOR) + 1) + SHIP_MAINTENANCE_COST_PER_SIZE_UNIT * design.size;
    // TODO(port) M4u: Race.ChangePeriodActive && PeriodicRaceEvent == StrengthInNumbersMaintenanceLowerForSmallShips &&
    // Size <= 200 → num2 = 0.25 — periodic race events are not modelled (outside such a period the C# sees 0).
    const num2 = 0.0;
    const num3 = getLeaderMaintenanceBonuses(design, empire) / 100.0;
    const num4 = Math.min(1.0, design.maintenanceSavings + num2 + num3) * num1;
    let num5 = 1.0;
    const gov = empireGovernmentAttributes(empire);
    if (gov !== null) num5 = gov.maintenanceCosts;
    if (empire.pirateEmpireBaseHabitat !== null) {
        // TODO(port): Galaxy.BaseTechCost (game option) is not kept on the TS Galaxy; its default stands in
        // (as in forceStructure.ts calculateSupportCost).
        const num6 = Math.sqrt(DEFAULT_BASE_TECH_COST / 120000.0);
        num5 *= galaxy.pirateShipMaintenanceFactor * num6;
    }
    return (num1 - num4) * num5;
}

/** Empire.10.cs 554/559 CanBuildBuiltObject(builtObject, colony = null). */
export function canBuildBuiltObjectBO(empire: Empire, builtObject: BuiltObject, colony: Habitat | null = null): boolean {
    const S = BuiltObjectSubRole;
    const design = builtObject.design!;
    if (colony !== null) {
        if (builtObject.role === BuiltObjectRole.Base) return true;
        if (builtObject.subRole === S.ColonyShip) {
            if (design.size <= empire.maximumConstructionSizeBase(design.subRole)) {
                // Galaxy.BuildColonyShipPopulationRequirement = 500000000 (Galaxy.3.cs 5001).
                return colony.population != null && colony.population.totalAmount >= 500000000;
            }
            return false;
        }
        if (builtObject.subRole === S.ConstructionShip || builtObject.subRole === S.ResupplyShip) {
            return design.size <= empire.maximumConstructionSizeBase(design.subRole);
        }
        return false;
    }
    if (builtObject.subRole === S.ColonyShip || builtObject.subRole === S.ConstructionShip || builtObject.subRole === S.ResupplyShip) return false;
    if (empire.pirateEmpireBaseHabitat === null && (builtObject.subRole === S.SmallSpacePort || builtObject.subRole === S.MediumSpacePort || builtObject.subRole === S.LargeSpacePort)) return false;
    let num = 0;
    if (builtObject.role !== BuiltObjectRole.Base) {
        num = !design.isPlanetDestroyer ? empire.maximumConstructionSize(builtObject.subRole) : empire.maximumConstructionSizeBase();
    } else {
        num = empire.maximumConstructionSizeBase(builtObject.subRole);
        if (empire.pirateEmpireBaseHabitat !== null && (builtObject.subRole === S.SmallSpacePort || builtObject.subRole === S.MediumSpacePort || builtObject.subRole === S.LargeSpacePort)) num = 2147483647;
    }
    if (design.size <= num) {
        if (builtObject.subRole === S.Carrier) return empire.canBuildCarriers;
        // (Unreachable in the C# too: ResupplyShip returned false above.)
        if ((builtObject.subRole as BuiltObjectSubRole) === S.ResupplyShip) return empire.canBuildResupplyShips;
        return true;
    }
    return false;
}

/** Empire.10.cs 460 CheckThreatIsEnemy(threat). */
export function checkThreatIsEnemy(galaxy: Galaxy, empire: Empire, threat: BuiltObject | null): boolean {
    if (threat !== null && threat.empire !== null) {
        if (threat.empire === empire) return false;
        if (threat.empire === galaxy.independentEmpire) return false;
        if (empire.pirateEmpireBaseHabitat !== null || threat.empire.pirateEmpireBaseHabitat !== null) {
            const pirateRelation = obtainPirateRelation(empire, threat.empire);
            if (pirateRelation.type !== PirateRelationType.Protection) return true;
        } else {
            const diplomaticRelation = obtainDiplomaticRelation(empire, threat.empire);
            if (diplomaticRelation.type === DiplomaticRelationType.War) return true;
        }
    }
    return false;
}

/** Empire.10.cs 492 CheckSafeToBuildAtLocation(habitat). No Rnd. */
export function checkSafeToBuildAtLocation(galaxy: Galaxy, empire: Empire, habitat: Habitat | null): boolean {
    if (habitat !== null) {
        if (habitat.isBlockaded) return false;
        const systemVisibilityList = empire.systemVisibility;
        if (systemVisibilityList != null && habitat.systemIndex >= 0 && habitat.systemIndex < systemVisibilityList.length) {
            const systemVisibility = systemVisibilityList[habitat.systemIndex];
            if (systemVisibility != null && systemVisibility.threats != null && systemVisibility.threats.length > 0) {
                for (let i = 0; i < systemVisibility.threats.length; i++) {
                    const builtObject = systemVisibility.threats[i];
                    if (builtObject == null || builtObject.hasBeenDestroyed || (builtObject.firepowerRaw <= 0 && builtObject.fighterCapacity <= 0)) continue;
                    if (builtObject.role === BuiltObjectRole.Base) {
                        const num = galaxy.calculateDistanceSquared(habitat.xpos, habitat.ypos, builtObject.xpos, builtObject.ypos);
                        if (num < builtObject.maximumWeaponsRange && checkThreatIsEnemy(galaxy, empire, builtObject)) return false;
                    } else if (builtObject.topSpeed > 0 && builtObject.role === BuiltObjectRole.Military && checkThreatIsEnemy(galaxy, empire, builtObject)) {
                        if (builtObject.warpSpeed > 0) return false;
                        const num2 = galaxy.calculateDistanceSquared(habitat.xpos, habitat.ypos, builtObject.xpos, builtObject.ypos);
                        if (num2 < 8000.0) return false;
                    }
                }
            }
        }
        if (galaxy.systems != null && habitat.systemIndex >= 0 && habitat.systemIndex < galaxy.systems.length) {
            const systemInfo = galaxy.systems[habitat.systemIndex];
            if (systemInfo != null && systemInfo.creatures != null && systemInfo.creatures.length > 0) {
                for (let j = 0; j < systemInfo.creatures.length; j++) {
                    const creature = systemInfo.creatures[j];
                    if (creature != null && !creature.hasBeenDestroyed && checkWithinCreatureAttackRange(galaxy, habitat.xpos, habitat.ypos, creature)) return false;
                }
            }
        }
    }
    return true;
}

/** Empire.3.cs 4122 CalculateAccurateAnnualCashflow. */
export function calculateAccurateAnnualCashflow(galaxy: Galaxy, empire: Empire): number {
    if (empire.pirateEmpireBaseHabitat !== null) {
        // Empire.3.cs 4126 CalculatePirateCashflow() (includeShipsUnderConstruction: false) — M4s2 (stub throws).
        return calculatePirateCashflow(galaxy, empire, false);
    }
    let num = annualStateMaintenanceExcludingUnderConstruction(empire) + annualTroopMaintenance(empire) + annualSubjugationTribute(galaxy, empire) + annualPirateProtection(empire);
    const num2 = annualTaxRevenue(galaxy, empire) + calculateAnnualSubjugationTributeIncome(galaxy, empire);
    const gov = empireGovernmentAttributes(empire);
    if (gov !== null && gov.specialFunctionCode === 1) num += annualPrivateMaintenanceExcludingUnderConstruction(empire);
    return num2 - num;
}

/** Empire.9.cs 5342 CalculateSpareAnnualRevenueComplete. */
export function calculateSpareAnnualRevenueComplete(galaxy: Galaxy, empire: Empire): number {
    return calculateSpareAnnualRevenue(galaxy, empire, annualStateMaintenance(empire));
}

/** Empire.2.cs 625 NewBuiltObjectShouldBeAutomated(subRole). */
export function newBuiltObjectShouldBeAutomated(empire: Empire, subRole: BuiltObjectSubRole): boolean {
    switch (subRole) {
        case BuiltObjectSubRole.Escort:
        case BuiltObjectSubRole.Frigate:
        case BuiltObjectSubRole.Destroyer:
        case BuiltObjectSubRole.Cruiser:
        case BuiltObjectSubRole.CapitalShip:
        case BuiltObjectSubRole.TroopTransport:
        case BuiltObjectSubRole.Carrier:
        case BuiltObjectSubRole.ResupplyShip:
        case BuiltObjectSubRole.ExplorationShip:
        case BuiltObjectSubRole.ColonyShip:
        case BuiltObjectSubRole.ConstructionShip:
            return empire.newShipsAutomated;
        default:
            return true;
    }
}

/**
 * HabitatList.cs 454-499 FindShortestConstructionWaitQueue(builtObject, out shortestWaitQueueTime[, allowLongWaitQueues =
 * false[, allowUnsafeLocations = true]]).
 */
export function habitatsFindShortestConstructionWaitQueue(galaxy: Galaxy, list: readonly Habitat[], builtObject: BuiltObject, allowLongWaitQueues = false, allowUnsafeLocations = true): { habitat: Habitat | null; shortestWaitQueueTime: number } {
    let shortestWaitQueueTime = Number.MAX_VALUE;
    let constructionWaitQueue: Habitat | null = null;
    const num1 = 3;
    let habitat1: Habitat | null = null;
    for (const habitat2 of list) {
        const e = habitat2.empire;
        if (e !== null && e !== builtObject.empire!.galaxy.independentEmpire && habitat2.constructionQueue !== null && canBuildBuiltObjectBO(e, builtObject, habitat2) && (allowUnsafeLocations || checkSafeToBuildAtLocation(galaxy, e, habitat2))) {
            let num2 = Number.MAX_VALUE;
            const q = queueOf(habitat2);
            if (q !== null) num2 = q.estimateCurrentWaitQueueTime();
            if (num2 < shortestWaitQueueTime) {
                let flag = false;
                const mq = habitatManufacturingQueue(habitat2);
                if (mq !== null && mq.deficientResources !== null && mq.deficientResources.items.length >= num1) flag = true;
                if (!flag) {
                    shortestWaitQueueTime = num2;
                    constructionWaitQueue = habitat2;
                } else {
                    habitat1 = habitat2;
                }
            }
        }
    }
    if (constructionWaitQueue === null && habitat1 !== null) constructionWaitQueue = habitat1;
    if (!allowLongWaitQueues && constructionWaitQueue !== null) {
        const q = queueOf(constructionWaitQueue);
        if (q !== null && q.constructionWaitQueue !== null && q.constructionWaitQueue.length > 0) constructionWaitQueue = null;
    }
    return { habitat: constructionWaitQueue, shortestWaitQueueTime };
}

/** HabitatList.cs 426 FindShortestConstructionWaitQueueCloseToBuiltObject(builtObject, out shortestWaitQueueTime). */
export function habitatsFindShortestConstructionWaitQueueCloseToBuiltObject(galaxy: Galaxy, list: readonly Habitat[], builtObject: BuiltObject): { habitat: Habitat | null; shortestWaitQueueTime: number } {
    let shortestWaitQueueTime = Number.MAX_VALUE;
    let closeToBuiltObject: Habitat | null = null;
    const boEmpire = builtObject.empire!;
    for (const colony of list) {
        const e = colony.empire;
        if (
            e !== null &&
            (e !== boEmpire.galaxy.independentEmpire || boEmpire.pirateEmpireBaseHabitat !== null) &&
            colony.constructionQueue !== null &&
            canBuildBuiltObjectBO(e, builtObject, colony) &&
            (builtObject.empire === null || builtObject.empire.pirateEmpireBaseHabitat === null || e === boEmpire.galaxy.independentEmpire || e === builtObject.empire)
        ) {
            let num = Number.MAX_VALUE;
            const q = queueOf(colony);
            if (q !== null) num = q.estimateCurrentWaitQueueTime();
            const distance = galaxy.calculateDistance(builtObject.xpos, builtObject.ypos, colony.xpos, colony.ypos);
            if (distance > 0.0) num *= Math.sqrt(distance);
            if (num < shortestWaitQueueTime) {
                shortestWaitQueueTime = num;
                closeToBuiltObject = colony;
            }
        }
    }
    if (closeToBuiltObject !== null) {
        const q = queueOf(closeToBuiltObject);
        if (q !== null && q.constructionWaitQueue !== null && q.constructionWaitQueue.length > 0) closeToBuiltObject = null;
    }
    return { habitat: closeToBuiltObject, shortestWaitQueueTime };
}

/**
 * BuiltObjectList.cs 261-274 FindShortestConstructionWaitQueue(builtObject, out time[, includeVerySmallYards = true[,
 * maximumQueueDepth = int.MaxValue]]) → BaconBuiltObjectList.cs 14.
 */
export function builtObjectsFindShortestConstructionWaitQueue(list: readonly (BuiltObject | null)[], ship: BuiltObject, includeVerySmallYards = true, maximumQueueDepth = 2147483647): { builtObject: BuiltObject | null; shortestWaitQueueTime: number } {
    let shortestWaitQueueTime = Number.MAX_VALUE;
    let constructionWaitQueue: BuiltObject | null = null;
    const num1 = 2;
    let builtObject1: BuiltObject | null = null;
    for (let index = 0; index < list.length; ++index) {
        const builtObject2 = list[index];
        if (builtObject2 != null && builtObject2.isSpacePort && builtObject2.isShipYard) {
            let flag1 = true;
            let num2 = 0;
            const q = queueOf(builtObject2);
            if (q !== null && q.constructionYards !== null) num2 = q.constructionYards.length;
            if (!includeVerySmallYards && builtObject2.extractionGas > 0 && num2 <= 1) flag1 = false;
            // `(ConstructionWaitQueue.Count + (num2 - 1)) / num2` is C# integer division, ConstructionQueue dereferenced
            // unguarded (a ship yard always has ≥ 1 yard; num2 = 0 would throw DivideByZeroException in the C#).
            if (flag1 && canBuildBuiltObjectBO(builtObject2.empire!, ship) && !builtObject2.name.startsWith('--') && Math.trunc((q!.constructionWaitQueue!.length + (num2 - 1)) / num2) <= maximumQueueDepth) {
                let num3 = Number.MAX_VALUE;
                if (q !== null) num3 = q.estimateCurrentWaitQueueTime();
                if (num3 < shortestWaitQueueTime) {
                    let flag2 = false;
                    const mq = builtObjectManufacturingQueue(builtObject2);
                    if (mq !== null && mq.deficientResources !== null && mq.deficientResources.items.length > num1) flag2 = true;
                    if (!flag2) {
                        shortestWaitQueueTime = num3;
                        constructionWaitQueue = builtObject2;
                    } else {
                        builtObject1 = builtObject2;
                    }
                }
            }
        }
    }
    if (constructionWaitQueue === null && builtObject1 !== null) constructionWaitQueue = builtObject1;
    return { builtObject: constructionWaitQueue, shortestWaitQueueTime };
}

/** BuiltObjectList.cs 232 FindShortestConstructionWaitQueueCloseToBuiltObject(builtObject, out shortestWaitQueueTime). */
export function builtObjectsFindShortestConstructionWaitQueueCloseToBuiltObject(galaxy: Galaxy, list: readonly (BuiltObject | null)[], builtObject: BuiltObject): { builtObject: BuiltObject | null; shortestWaitQueueTime: number } {
    let shortestWaitQueueTime = Number.MAX_VALUE;
    let result: BuiltObject | null = null;
    for (let i = 0; i < list.length; i++) {
        const builtObject2 = list[i];
        if (builtObject2 != null && builtObject2.isSpacePort && builtObject2.isShipYard && canBuildBuiltObjectBO(builtObject2.empire!, builtObject)) {
            let num = Number.MAX_VALUE;
            const q = queueOf(builtObject2);
            if (q !== null) num = q.estimateCurrentWaitQueueTime();
            const num2 = galaxy.calculateDistance(builtObject.xpos, builtObject.ypos, builtObject2.xpos, builtObject2.ypos);
            if (num2 > 0.0) num *= Math.sqrt(num2);
            if (num < shortestWaitQueueTime) {
                shortestWaitQueueTime = num;
                result = builtObject2;
            }
        }
    }
    return { builtObject: result, shortestWaitQueueTime };
}

/** BuiltObjectList.cs 393 GetShipsWithoutWarpDrives. */
function getShipsWithoutWarpDrives(list: readonly (BuiltObject | null)[]): BuiltObject[] {
    const builtObjectList: BuiltObject[] = [];
    for (let i = 0; i < list.length; i++) {
        const b = list[i];
        if (b != null && b.role !== BuiltObjectRole.Base && b.warpSpeed <= 0 && b.unbuiltComponentCount <= 0 && b.builtAt === null) builtObjectList.push(b);
    }
    return builtObjectList;
}

/** `new Cargo(new Resource(resourceId), amount, empire[, reserved])`. */
function resourceCargo(resourceId: number, amount: number, empire: Empire, reserved = 0): Cargo {
    return new Cargo(new ResourceRef(resourceId), amount, empire, reserved);
}

/** Empire.6.cs 944 CheckCargoForComponentResourceSupply(builtObjectToBuild, componentsToFind, constructionColony, orderPreciseAmount, out resourcesToOrder). */
function checkCargoForComponentResourceSupplyHabitat(empire: Empire, builtObjectToBuild: BuiltObject | null, componentsToFind: readonly ComponentDefinition[] | null, constructionColony: Habitat | null, orderPreciseAmount: boolean): CargoList {
    const resourcesToOrder = new CargoList();
    if (builtObjectToBuild === null || componentsToFind === null || constructionColony === null) return resourcesToOrder;
    for (let i = 0; i < componentsToFind.length; i++) {
        const component = componentsToFind[i];
        for (let j = 0; j < component.resourceRequirements.length; j++) {
            const componentResource = component.resourceRequirements[j];
            let cargo: Cargo | null = null;
            let num = 0;
            if (constructionColony.cargo === null) continue;
            const num2 = constructionColony.cargo.indexOf(new ResourceRef(componentResource.resourceId), empire);
            if (num2 >= 0) {
                cargo = constructionColony.cargo.items[num2];
                num = Math.max(0, componentResource.amount - Math.max(0, cargo.available));
                cargo.reserved += componentResource.amount;
            }
            if (cargo === null) {
                resourcesToOrder.add(resourceCargo(componentResource.resourceId, !orderPreciseAmount ? Math.max(MINIMUM_ORDER_AMOUNT, componentResource.amount) : componentResource.amount, empire));
                cargo = resourceCargo(componentResource.resourceId, 0, empire, componentResource.amount);
                constructionColony.cargo.add(cargo);
            } else if (num > 0) {
                if (!orderPreciseAmount) num = Math.max(num, MINIMUM_ORDER_AMOUNT);
                resourcesToOrder.add(resourceCargo(componentResource.resourceId, num, empire));
            }
        }
    }
    return resourcesToOrder;
}

/** Empire.6.cs 1004 CheckCargoForComponentResourceSupply(builtObjectToBuild, componentsToFind, constructionYard (BuiltObject), orderPreciseAmount, out resourcesToOrder). */
function checkCargoForComponentResourceSupplyBuiltObject(empire: Empire, builtObjectToBuild: BuiltObject | null, componentsToFind: readonly ComponentDefinition[] | null, constructionYard: BuiltObject | null, orderPreciseAmount: boolean): CargoList {
    const resourcesToOrder = new CargoList();
    if (builtObjectToBuild === null || componentsToFind === null || constructionYard === null) return resourcesToOrder;
    for (let i = 0; i < componentsToFind.length; i++) {
        const component = componentsToFind[i];
        for (let j = 0; j < component.resourceRequirements.length; j++) {
            const componentResource = component.resourceRequirements[j];
            let cargo: Cargo | null = null;
            let num = 0;
            if (constructionYard.cargo !== null) {
                const num2 = constructionYard.cargo.indexOf(new ResourceRef(componentResource.resourceId), empire);
                if (num2 >= 0) {
                    cargo = constructionYard.cargo.items[num2];
                    num = Math.max(0, componentResource.amount - Math.max(0, cargo.available));
                    cargo.reserved += componentResource.amount;
                }
                if (cargo === null) {
                    resourcesToOrder.add(resourceCargo(componentResource.resourceId, componentResource.amount, empire));
                    cargo = resourceCargo(componentResource.resourceId, 0, empire, componentResource.amount);
                    constructionYard.cargo.add(cargo);
                } else if (num > 0) {
                    resourcesToOrder.add(resourceCargo(componentResource.resourceId, num, empire));
                }
            }
        }
    }
    if (orderPreciseAmount) return resourcesToOrder;
    for (const item of resourcesToOrder.items) item.amount = Math.max(item.amount, MINIMUM_ORDER_AMOUNT);
    return resourcesToOrder;
}

/** Empire.6.cs 1096 CheckCargoForComponentSupply(builtObjectToBuild, ref componentsToFind, cargoProvider (BuiltObject)). */
function checkCargoForComponentSupplyBuiltObject(empire: Empire, builtObjectToBuild: BuiltObject | null, componentsToFind: ComponentDefinition[] | null, cargoProvider: BuiltObject | null): boolean {
    let result = false;
    const componentList: { componentId: number }[] = [];
    if (builtObjectToBuild === null || componentsToFind === null || cargoProvider === null || cargoProvider.cargo === null) return false;
    for (let i = 0; i < componentsToFind.length; i++) {
        const component = componentsToFind[i];
        let component2: { componentId: number } | null = null;
        const num = cargoProvider.cargo.indexOfComponent(component.componentId, empire);
        if (num >= 0 && cargoProvider.cargo.items[num].available > 0) {
            cargoProvider.cargo.items[num].reserved++;
            component2 = cargoProvider.cargo.items[num].commodityComponent;
            result = true;
        }
        if (component2 !== null) componentList.push(component2);
    }
    for (const item of componentList) {
        // ComponentList.IndexById(item) / RemoveAt.
        const num2 = componentsToFind.findIndex((c) => c.componentId === item.componentId);
        if (num2 >= 0) componentsToFind.splice(num2, 1);
    }
    return result;
}

/**
 * Empire.6.cs 859-916 ProcureConstructionComponents(builtObjectToBuild, constructionYard (BuiltObject),
 * orderPreciseResourceAmounts, out resourcesToOrder[, components[, forBaseRetrofit = false]]). `components` null = the
 * Unbuilt components of builtObjectToBuild (the four-argument overload). Returns resourcesToOrder.
 */
export function procureConstructionComponentsAtBuiltObject(galaxy: Galaxy, empire: Empire, builtObjectToBuild: BuiltObject | null, constructionYard: BuiltObject | null, orderPreciseResourceAmounts: boolean, components: ComponentDefinition[] | null = null, forBaseRetrofit = false): CargoList {
    void galaxy;
    if (components === null) {
        components = [];
        if (builtObjectToBuild !== null && builtObjectToBuild.components != null) {
            for (const component of builtObjectToBuild.components.items) {
                if (component.status === ComponentStatus.Unbuilt) components.push(component.def);
            }
        }
    }
    let resourcesToOrder = new CargoList();
    const componentsToFind = components;
    if (constructionYard === null) return resourcesToOrder;
    if (constructionYard.subRole === BuiltObjectSubRole.ConstructionShip) {
        checkCargoForComponentSupplyBuiltObject(empire, builtObjectToBuild, componentsToFind, constructionYard);
    }
    if (forBaseRetrofit) {
        const rmq = constructionYard.retrofitBaseManufacturingQueue as ManufacturingQueue | null;
        if (rmq === null || rmq.componentWaitQueue === null) return resourcesToOrder;
        resourcesToOrder = checkCargoForComponentResourceSupplyBuiltObject(empire, builtObjectToBuild, componentsToFind, constructionYard, orderPreciseResourceAmounts);
        for (const item of componentsToFind) rmq.componentWaitQueue.push(item);
        return resourcesToOrder;
    }
    const mq = builtObjectManufacturingQueue(constructionYard);
    if (mq === null || mq.componentWaitQueue === null) return resourcesToOrder;
    resourcesToOrder = checkCargoForComponentResourceSupplyBuiltObject(empire, builtObjectToBuild, componentsToFind, constructionYard, orderPreciseResourceAmounts);
    for (const item2 of componentsToFind) mq.componentWaitQueue.push(item2);
    return resourcesToOrder;
}

/**
 * Empire.6.cs 918-942 ProcureConstructionComponents(builtObjectToBuild, constructionColony, out resourcesToOrder[,
 * components]). `components` null = builtObjectToBuild.Design.Components.Clone(). Returns resourcesToOrder.
 */
export function procureConstructionComponentsAtColony(galaxy: Galaxy, empire: Empire, builtObjectToBuild: BuiltObject, constructionColony: Habitat | null, components: ComponentDefinition[] | null = null): CargoList {
    void galaxy;
    if (components === null) components = builtObjectToBuild.design!.components.slice();
    const resourcesToOrder = checkCargoForComponentResourceSupplyHabitat(empire, builtObjectToBuild, components, constructionColony, true);
    if (constructionColony === null) return resourcesToOrder;
    const mq = habitatManufacturingQueue(constructionColony);
    if (mq === null || mq.componentWaitQueue === null) return resourcesToOrder;
    for (const component of components) mq.componentWaitQueue.push(component);
    return resourcesToOrder;
}

/** `foreach (Cargo c in list) CreateOrder(requester, c.CommodityResource, c.Amount, isState: false, type)`. */
function createOrdersFor(galaxy: Galaxy, empire: Empire, requester: Habitat | BuiltObject, cargo: CargoList, type: OrderType): void {
    for (const item of cargo.items) empireCreateOrder(galaxy, empire, requester, new ResourceRef(item.commodity.resourceId), item.amount, false, type);
}

/** Empire.6.cs 842 ObtainBuildResourcesForConstructionShip(constructionShip, newBuiltObject). No Rnd. */
export function obtainBuildResourcesForConstructionShip(galaxy: Galaxy, empire: Empire, constructionShip: BuiltObject, newBuiltObject: BuiltObject): void {
    if (constructionShip.subRole === BuiltObjectSubRole.ConstructionShip && constructionShip.cargo !== null) {
        for (const item of constructionShip.cargo.items) item.reserved = 0;
    }
    const resourcesToOrder = procureConstructionComponentsAtBuiltObject(galaxy, empire, newBuiltObject, constructionShip, true);
    createOrdersFor(galaxy, empire, constructionShip, resourcesToOrder, OrderType.ConstructionShortageMobile);
}

/**
 * Empire.6.cs 2300-2372 RefactorForceStructureProjectionsToCosts(projections, availableRevenue, otherSupportCosts,
 * otherPurchaseCosts, includeCashflowCheck[, out totalSupportCosts, out totalPurchaseCosts, randomizedOrder = true]).
 * Rnd: Next(0, Count) per iteration when randomizedOrder.
 */
export function refactorForceStructureProjectionsToCosts(galaxy: Galaxy, empire: Empire, projections: ForceStructureProjectionList, availableRevenue: number, otherSupportCosts: number, otherPurchaseCosts: number, includeCashflowCheck: boolean, randomizedOrder = true): { result: ForceStructureProjectionList; totalSupportCosts: number; totalPurchaseCosts: number } {
    const forceStructureProjectionList = new ForceStructureProjectionList();
    let totalSupportCosts = otherSupportCosts;
    let totalPurchaseCosts = otherPurchaseCosts;
    const forceStructureProjectionList2: (ForceStructureProjection | null)[] = [];
    forceStructureProjectionList2.push(...projections.items);
    const iterationCount = { count: 0 };
    while (conditionCheckLimit(forceStructureProjectionList2.length > 0, 100, iterationCount)) {
        const forceStructureProjection = !randomizedOrder ? forceStructureProjectionList2[0] : forceStructureProjectionList2[galaxy.rnd.next(0, forceStructureProjectionList2.length)];
        if (forceStructureProjection != null) {
            const design = dlFindNewestCanBuild(empire.designs, forceStructureProjection.subRole);
            if (design !== null) {
                let num = 0;
                if (forceStructureProjection.amount > 0) {
                    const num2 = design.calculateCurrentPurchasePrice(galaxy);
                    const num3 = calculateSupportCost(galaxy, empire, design);
                    for (let i = 0; i < forceStructureProjection.amount; i++) {
                        if (!(totalPurchaseCosts + num2 <= empire.stateMoney)) break;
                        if (includeCashflowCheck && !(availableRevenue - totalSupportCosts >= num3)) break;
                        totalPurchaseCosts += num2;
                        totalSupportCosts += num3;
                        num++;
                    }
                }
                if (num > 0) forceStructureProjectionList.add(new ForceStructureProjection(forceStructureProjection.subRole, num, forceStructureProjection.projectionDate));
            }
        }
        // SyncList.Remove: the first occurrence.
        const idx = forceStructureProjectionList2.indexOf(forceStructureProjection);
        if (idx >= 0) forceStructureProjectionList2.splice(idx, 1);
    }
    return { result: forceStructureProjectionList, totalSupportCosts, totalPurchaseCosts };
}

/** Empire.6.cs 2280 CheckShouldAttemptColonization(habitat). No Rnd. */
export function checkShouldAttemptColonization(galaxy: Galaxy, empire: Empire, habitat: Habitat): boolean {
    let result = true;
    const dominantEmpire = galaxy.systems[habitat.systemIndex].dominantEmpire ?? null;
    if (dominantEmpire !== null && dominantEmpire.empire !== null && dominantEmpire.empire !== empire && dominantEmpire.totalStrategicValue > 100000 && (habitat.population == null || habitat.population.totalAmount < 20000000)) result = false;
    if (!empire.determineColonizeLowQualityHabitat(habitat)) result = false;
    const num = checkColonizationLikeliness(galaxy, habitat, empire.dominantRace!);
    if (num < -3) result = false;
    return result;
}

/** Empire.4.cs 2312 DetermineHabitatsBeingColonized. */
export function determineHabitatsBeingColonized(empire: Empire): Habitat[] {
    const habitatList: Habitat[] = [];
    const bos = empire.builtObjects as BuiltObject[];
    for (let i = 0; i < bos.length; i++) {
        const builtObject = bos[i];
        const mission = builtObjectMission(builtObject.mission);
        if (builtObject.isColony && mission !== null && mission.type === BuiltObjectMissionType.Colonize && mission.targetHabitat !== null) {
            const targetHabitat = mission.targetHabitat;
            if (!habitatList.includes(targetHabitat)) habitatList.push(targetHabitat);
        }
    }
    return habitatList;
}

/** Empire.4.cs 2171 DetermineHabitatsWithBasesIncludingBuilding(subRoles). No Rnd. */
export function determineHabitatsWithBasesIncludingBuilding(galaxy: Galaxy, empire: Empire, subRoles: readonly BuiltObjectSubRole[]): Habitat[] {
    void galaxy;
    const habitatList: Habitat[] = [];
    const builtObjectList: BuiltObject[] = [];
    builtObjectList.push(...(empire.builtObjects as BuiltObject[]));
    builtObjectList.push(...(empire.privateBuiltObjects as BuiltObject[]));
    for (let i = 0; i < builtObjectList.length; i++) {
        const builtObject = builtObjectList[i];
        if (builtObject == null || builtObject.hasBeenDestroyed) continue;
        switch (builtObject.subRole) {
            case BuiltObjectSubRole.ConstructionShip: {
                const mission = builtObjectMission(builtObject.mission);
                if (mission !== null && mission.type === BuiltObjectMissionType.Build && mission.design !== null && subRoles.includes(mission.design.subRole) && mission.targetHabitat !== null) habitatList.push(mission.targetHabitat);
                break;
            }
            case BuiltObjectSubRole.GasMiningStation:
            case BuiltObjectSubRole.MiningStation:
            case BuiltObjectSubRole.SmallSpacePort:
            case BuiltObjectSubRole.MediumSpacePort:
            case BuiltObjectSubRole.LargeSpacePort:
            case BuiltObjectSubRole.ResortBase:
            case BuiltObjectSubRole.GenericBase:
            case BuiltObjectSubRole.EnergyResearchStation:
            case BuiltObjectSubRole.WeaponsResearchStation:
            case BuiltObjectSubRole.HighTechResearchStation:
            case BuiltObjectSubRole.MonitoringStation:
            case BuiltObjectSubRole.DefensiveBase:
                if (builtObject.parentHabitat !== null) habitatList.push(builtObject.parentHabitat);
                break;
        }
    }
    return habitatList;
}

/** Empire.4.cs 2214 DetermineHabitatsBeingMinedIncludingBuildingMiningStations(includeMiningShips). No Rnd. */
export function determineHabitatsBeingMinedIncludingBuildingMiningStations(galaxy: Galaxy, empire: Empire, includeMiningShips: boolean): Habitat[] {
    void galaxy;
    const habitatList: Habitat[] = [];
    const builtObjectList: BuiltObject[] = [];
    builtObjectList.push(...(empire.builtObjects as BuiltObject[]));
    builtObjectList.push(...(empire.privateBuiltObjects as BuiltObject[]));
    for (let i = 0; i < builtObjectList.length; i++) {
        const builtObject = builtObjectList[i];
        if (builtObject == null || builtObject.hasBeenDestroyed) continue;
        const mission = builtObjectMission(builtObject.mission);
        switch (builtObject.subRole) {
            case BuiltObjectSubRole.ConstructionShip:
                if (mission !== null && mission.type === BuiltObjectMissionType.Build && mission.design !== null && (mission.design.subRole === BuiltObjectSubRole.GasMiningStation || mission.design.subRole === BuiltObjectSubRole.MiningStation) && mission.targetHabitat !== null) habitatList.push(mission.targetHabitat);
                break;
            case BuiltObjectSubRole.GasMiningShip:
            case BuiltObjectSubRole.MiningShip:
                if (includeMiningShips && mission !== null && mission.type === BuiltObjectMissionType.ExtractResources && mission.targetHabitat !== null) habitatList.push(mission.targetHabitat);
                break;
            case BuiltObjectSubRole.GasMiningStation:
            case BuiltObjectSubRole.MiningStation:
                if (builtObject.parentHabitat !== null) habitatList.push(builtObject.parentHabitat);
                break;
            case BuiltObjectSubRole.SmallSpacePort:
            case BuiltObjectSubRole.MediumSpacePort:
            case BuiltObjectSubRole.LargeSpacePort:
                if ((builtObject.extractionGas > 0 || builtObject.extractionMine > 0 || builtObject.extractionLuxury > 0) && builtObject.parentHabitat !== null) habitatList.push(builtObject.parentHabitat);
                break;
        }
    }
    return habitatList;
}

/** Empire.1.cs 4002 CheckBuildoutResearchCapacityAtColonies(out researchStationDesignToBuild, out colonyToBuildAt). No Rnd. */
export function checkBuildoutResearchCapacityAtColonies(galaxy: Galaxy, empire: Empire): { result: boolean; researchStationDesignToBuild: Design | null; colonyToBuildAt: Habitat | null } {
    const analysis = analyzeNewResearchFacilities(empire);
    let design = analysis.result;
    const { weaponsResearchStation, energyResearchStation, highTechResearchStation } = analysis;
    if (design !== null && (empire.researchHabitats == null || empire.researchHabitats.length <= 0 || !checkEmpireHasHyperDriveTech(empire))) {
        const researchFacilities = empire.researchFacilities as (BuiltObject | null)[];
        if (researchFacilities.length <= 0 || countResearchStations(researchFacilities) <= 0) {
            if (!checkEmpireHasHyperDriveTech(empire) && energyResearchStation !== null) design = energyResearchStation;
            const policy = empire.policy!;
            if (policy.researchIndustryFocus !== IndustryType.Undefined) {
                switch (policy.researchIndustryFocus) {
                    case IndustryType.Energy:
                        design = energyResearchStation;
                        break;
                    case IndustryType.HighTech:
                        design = highTechResearchStation;
                        break;
                    case IndustryType.Weapon:
                        design = weaponsResearchStation;
                        break;
                }
            }
        }
        if (design !== null) {
            const num = designCalculateMaintenanceCosts(galaxy, design, empire);
            const num2 = design.calculateCurrentPurchasePrice(galaxy);
            if (num2 <= empire.stateMoney && num <= calculateSpareAnnualRevenueComplete(galaxy, empire)) {
                let habitat: Habitat | null = null;
                for (let i = 0; i < empire.colonies.length; i++) {
                    const habitat2 = empire.colonies[i];
                    if (habitat2 != null && habitat2.basesAtHabitat != null && habitat2.population != null && habitat2.population.totalAmount > 2000000000) {
                        const num3 = countResearchStations(habitat2.basesAtHabitat);
                        if (num3 < 2 && (habitat === null || habitat2.basesAtHabitat.length < habitat.basesAtHabitat.length)) habitat = habitat2;
                    }
                }
                if (habitat !== null) return { result: true, researchStationDesignToBuild: design, colonyToBuildAt: habitat };
            }
        }
    }
    return { result: false, researchStationDesignToBuild: null, colonyToBuildAt: null };
}

// ---- advisor texts (Empire.10.cs 3640-3677). TODO(port) M9: GameText formatting (ResolveDescription, "###,###,##0"
// money) — only the player reads these; the GameText key stands in for the format string. ----

export function formatMoney(value: number): string {
    return Math.round(value).toString();
}

/** Empire.10.cs 3640 GenerateAutomationMessageDefensiveBase(colony, baseDesign). */
function generateAutomationMessageDefensiveBase(galaxy: Galaxy, colony: Habitat, baseDesign: Design): string {
    const habitat = galaxy.determineHabitatSystemStar(colony);
    return formatText(getText('Automation Defensive Base'), colony.name, habitat.name, formatMoney(baseDesign.calculateCurrentPurchasePrice(galaxy)));
}

/** Empire.10.cs 3646 GenerateAutomationMessageColonization(newColony, colonyShip, colonyShipBuildLocation). */
function generateAutomationMessageColonization(galaxy: Galaxy, newColony: Habitat, colonyShip: BuiltObject | null, colonyShipBuildLocation: Habitat | null): string {
    const habitat = galaxy.determineHabitatSystemStar(newColony);
    let result = '';
    if (colonyShip !== null) result = formatText(getText('Automation Colonization Existing Ship'), newColony.type, newColony.category, newColony.name, habitat.name, colonyShip.name);
    else if (colonyShipBuildLocation !== null) result = formatText(getText('Automation Colonization New Ship'), newColony.type, newColony.category, newColony.name, habitat.name, colonyShipBuildLocation.name, galaxy.determineHabitatSystemStar(colonyShipBuildLocation).name);
    return result;
}

/** Empire.10.cs 3662 GenerateAutomationMessageConstruction(builtObject, habitat, cost). */
export function generateAutomationMessageConstruction(galaxy: Galaxy, builtObject: BuiltObject, habitat: Habitat | null, cost: number): string {
    let text = '';
    let text2 = '';
    let text3 = '';
    let text4 = '';
    if (habitat !== null) {
        const habitat2 = galaxy.determineHabitatSystemStar(habitat);
        text3 = habitat.name;
        text = String(habitat.type);
        text2 = String(habitat.category);
        text4 = habitat2.name;
    }
    return formatText(getText('Automation Construction Colony'), builtObject.subRole, builtObject.design!.name, formatMoney(cost), text, text2, text3, text4);
}

// ---------------------------------------------------------------------------------------------------------------
// Mission helpers (queued missions, ship yards, fleets)
// ---------------------------------------------------------------------------------------------------------------

/** BuiltObject.2.cs 7506-7548 QueueMission(missionType, target, target2, [design,] priority): bases never queue. No Rnd. */
export function queueMission(galaxy: Galaxy, bo: BuiltObject, missionType: BuiltObjectMissionType, target: MissionTarget | null, target2: MissionTarget | null, priority: BuiltObjectMissionPriority, design: Design | null = null): void {
    if (bo.role !== BuiltObjectRole.Base) {
        const item = new BuiltObjectMission(galaxy, bo, missionType, target, target2, priority, { design, allowReprocessing: true, allowBuiltObjectChanges: false });
        bo.subsequentMissions.push(item);
    }
}

/** Empire.5.cs 397 FindNearestShipYard(ship, canRepairOrBuild, includeVerySmallYards). No Rnd. */
export function findNearestShipYard(galaxy: Galaxy, empire: Empire, ship: BuiltObject, canRepairOrBuild: boolean, includeVerySmallYards: boolean): StellarObject | null {
    let result: StellarObject | null = null;
    let num = Number.MAX_VALUE;
    let flag = false;
    const actualEmpire = ship.actualEmpire;
    if (actualEmpire !== null && actualEmpire.pirateEmpireBaseHabitat !== null) flag = true;
    const yards = empire.constructionYards as BuiltObject[];
    for (let i = 0; i < yards.length; i++) {
        const builtObject = yards[i];
        if (builtObject.role !== BuiltObjectRole.Base) continue;
        let flag2 = true;
        if (!includeVerySmallYards) {
            let num2 = 0;
            const q = queueOf(builtObject);
            if (q !== null && q.constructionYards !== null) num2 = q.constructionYards.length;
            if (builtObject.extractionGas > 0 && num2 <= 1 && !flag) flag2 = false;
        }
        if (flag2) {
            const num3 = galaxy.calculateDistanceSquared(ship.xpos, ship.ypos, builtObject.xpos, builtObject.ypos);
            if (num3 < num) {
                result = builtObject;
                num = num3;
            }
        }
    }
    if (canRepairOrBuild && (ship.subRole === BuiltObjectSubRole.ColonyShip || ship.subRole === BuiltObjectSubRole.ConstructionShip || ship.subRole === BuiltObjectSubRole.ResupplyShip) && !flag) {
        result = null;
        num = Number.MAX_VALUE;
        for (let j = 0; j < empire.colonies.length; j++) {
            const habitat = empire.colonies[j];
            const num4 = galaxy.calculateDistanceSquared(ship.xpos, ship.ypos, habitat.xpos, habitat.ypos);
            if (num4 < num) {
                result = habitat;
                num = num4;
            }
        }
    }
    return result;
}

// Galaxy.9.cs 252 IdentifyPirateSpaceport: combat/damage.ts.

/** Empire.9.cs 590 CheckFleetNeedsRetrofit(fleet, isAutoRetrofit). No Rnd. */
export function checkFleetNeedsRetrofit(galaxy: Galaxy, empire: Empire, fleet: ShipGroup | null, isAutoRetrofit: boolean): boolean {
    if (fleet !== null && fleet.empire !== null && fleet.empire.designs != null && fleet.ships != null) {
        for (let i = 0; i < fleet.ships.length; i++) {
            const builtObject = fleet.ships[i];
            if (builtObject != null) {
                let flag = true;
                const design = findNewestCanBuildFullEvaluate(fleet.empire.designs, builtObject.subRole, null);
                const num = buildSpeed(galaxy, empire, builtObject);
                if (num > 1.0 && (design === null || design.warpSpeed <= 0 || builtObject.design === null || builtObject.design.warpSpeed > 0)) flag = false;
                if (isAutoRetrofit && builtObject.suppressAutoRetrofit) flag = false;
                if (design !== null && design !== builtObject.design && flag) return true;
            }
        }
    }
    return false;
}

/** Empire.9.cs 620/625 AssignFleetRetrofit(fleet[, shipYard], isAutoRetrofit). */
export function assignFleetRetrofit(galaxy: Galaxy, empire: Empire, fleet: ShipGroup | null, shipYard: StellarObject | null, isAutoRetrofit: boolean): boolean {
    if (fleet !== null) {
        if (shipYard === null) shipYard = findNearestShipYard(galaxy, fleet.empire!, fleet.leadShip!, true, false);
        if (shipYard !== null && shipYard instanceof BuiltObject) {
            let design = findNewestCanBuildFullEvaluate(fleet.empire!.designs, fleet.leadShip!.subRole, null);
            // TODO(port) M4l: ShipGroup.AssignMission(Retrofit, shipYard, null, design, High, manuallyAssigned: true) — the
            // M4l stub has no design parameter (the C# fleet mission carries `design`).
            shipGroupAssignMission(galaxy, fleet, BuiltObjectMissionType.Retrofit, shipYard, null, BuiltObjectMissionPriority.High, true);
            for (let i = 0; i < fleet.ships.length; i++) {
                const builtObject = fleet.ships[i];
                if (builtObject.builtAt === null && builtObject.retrofitDesign === null) {
                    let flag = true;
                    design = findNewestCanBuildFullEvaluate(fleet.empire!.designs, builtObject.subRole, null);
                    const num = buildSpeed(galaxy, empire, builtObject);
                    if (num > 1.0 && (design === null || design.warpSpeed <= 0 || builtObject.design === null || builtObject.design.warpSpeed > 0)) flag = false;
                    if (isAutoRetrofit && builtObject.suppressAutoRetrofit) flag = false;
                    if (design !== null && design !== builtObject.design && flag) {
                        clearPreviousMissionRequirements(galaxy, builtObject);
                        assignRetrofitMission(galaxy, builtObject.empire!, builtObject, design, shipYard, true);
                        builtObject.dateRetrofit = galaxyStarDate(galaxy);
                    } else {
                        clearPreviousMissionRequirements(galaxy, builtObject);
                        assignMission(galaxy, builtObject, BuiltObjectMissionType.Refuel, shipYard, null, BuiltObjectMissionPriority.High);
                    }
                }
            }
            return true;
        }
    }
    return false;
}

// ---------------------------------------------------------------------------------------------------------------
// Scrapping and retirement
// ---------------------------------------------------------------------------------------------------------------

/** Empire.6.cs 488-586 AssignScrapMission(builtObject[, allowImmediateScrappingIfYardsFull = true[, allowImmediateScrappingIfNoWarpSpeed = true]]). */
export function assignScrapMission(galaxy: Galaxy, empire: Empire, builtObject: BuiltObject, allowImmediateScrappingIfYardsFull = true, allowImmediateScrappingIfNoWarpSpeed = true): boolean {
    builtObject.retireForNextMission = false;
    if (builtObject.empire === null || (builtObject.empire === galaxy.independentEmpire && builtObject.pirateEmpireId === 0)) {
        builtObjectCompleteTeardown(galaxy, builtObject);
        return true;
    }
    if (builtObject.role !== BuiltObjectRole.Base && builtObject.topSpeed <= 0) {
        builtObjectCompleteTeardown(galaxy, builtObject);
        return true;
    }
    if (allowImmediateScrappingIfNoWarpSpeed && builtObject.role !== BuiltObjectRole.Base && builtObject.warpSpeed <= 0) {
        builtObjectCompleteTeardown(galaxy, builtObject);
        return true;
    }
    if (builtObject.role === BuiltObjectRole.Base && builtObject.subRole !== BuiltObjectSubRole.SmallSpacePort && builtObject.subRole !== BuiltObjectSubRole.MediumSpacePort && builtObject.subRole !== BuiltObjectSubRole.LargeSpacePort) {
        // builtObject.InflictDamage(builtObject, null, 100000.0, CurrentDateTime, galaxy, 0f, allowRecursion: false, 0.0, allowArmorInvulnerability: false).
        inflictDamageFull(galaxy, builtObject, builtObject, null, 100000.0, galaxyNow(galaxy), 0, false, 0.0, false);
        return true;
    }
    const builtObject2 = builtObjectsFindShortestConstructionWaitQueueCloseToBuiltObject(galaxy, empire.spacePorts, builtObject).builtObject;
    if (builtObject2 !== null) {
        // ConstructionQueue.ConstructionYards dereferenced unguarded (a ship yard).
        const yards = queueOf(builtObject2)!.constructionYards!;
        let flag = false;
        for (let i = 0; i < yards.length; i++) {
            if (yards[i].shipUnderConstruction === null) {
                flag = true;
                break;
            }
        }
        if (flag || !allowImmediateScrappingIfYardsFull) {
            clearPreviousMissionRequirements(galaxy, builtObject);
            assignMission(galaxy, builtObject, BuiltObjectMissionType.Retire, builtObject2, null, BuiltObjectMissionPriority.Normal);
            return true;
        }
        clearPreviousMissionRequirements(galaxy, builtObject);
        builtObjectCompleteTeardown(galaxy, builtObject);
        return true;
    }
    return false;
}

/** Empire.6.cs 718 ShouldRetireFreighter(builtObject, empireOrderCount, empireFreighterCount). */
function shouldRetireFreighter(builtObject: BuiltObject, empireOrderCount: number, empireFreighterCount: number): boolean {
    if (builtObject.role === BuiltObjectRole.Freight && empireOrderCount / empireFreighterCount > 1.5) return false;
    return true;
}

/** BuiltObjectList.Sort (BuiltObject.CompareTo: SortTag). */
function sortBySortTag(list: BuiltObject[]): void {
    netSort(list, (a, b) => (a.sortTag < b.sortTag ? -1 : a.sortTag > b.sortTag ? 1 : 0));
}

/** Empire.cs 2008/2149 Annual{State,Private}MaintenanceWithoutRetirees. */
function maintenanceWithoutRetirees(empire: Empire, list: readonly BuiltObject[]): number {
    let num = 0.0;
    for (let i = 0; i < list.length; i++) {
        const builtObject = list[i];
        const mission = builtObjectMission(builtObject.mission);
        if (!builtObject.retireForNextMission && (mission === null || mission.type !== BuiltObjectMissionType.Retire)) num += builtObject.annualSupportCost;
    }
    const num2 = num * empire.shipMaintenanceSavings;
    return num - num2;
}

/** Empire.6.cs 554-584 GetPrivateAnnualCashflow(excludeRetirees). */
function getPrivateAnnualCashflow(galaxy: Galaxy, empire: Empire, excludeRetirees: boolean): number {
    const gov = empireGovernmentAttributes(empire);
    if (gov !== null && gov.specialFunctionCode === 1) {
        let num = 0.0;
        let num2 = 0.0;
        if (excludeRetirees) {
            num = maintenanceWithoutRetirees(empire, empire.builtObjects as BuiltObject[]);
            num2 = maintenanceWithoutRetirees(empire, empire.privateBuiltObjects as BuiltObject[]);
        } else {
            num = annualStateMaintenance(empire);
            num2 = annualPrivateMaintenance(empire);
        }
        const num3 = num + annualTroopMaintenance(empire);
        const num4 = num2;
        return annualTaxRevenue(galaxy, empire) - (num3 + num4);
    }
    const num5 = !excludeRetirees ? annualPrivateMaintenance(empire) + annualTaxRevenue(galaxy, empire) : maintenanceWithoutRetirees(empire, empire.privateBuiltObjects as BuiltObject[]) + annualTaxRevenue(galaxy, empire);
    return privateAnnualRevenue(galaxy, empire) - num5;
}

/** Empire.6.cs 587 RetireOldBuiltObjects. No Rnd (CompleteTeardown is M4o's). */
export function retireOldBuiltObjects(galaxy: Galaxy, empire: Empire): void {
    const currentStarDate = galaxyStarDate(galaxy);
    const num = REAL_SECONDS_IN_GALACTIC_YEAR * 1000 * RETIREMENT_YEARS;
    let num2 = 0;
    const num3 = getPrivateFunds(empire) / (annualPrivateMaintenance(empire) + 1.0);
    const num4 = empire.stateMoney / (annualStateMaintenance(empire) + 1.0);
    const privateBuiltObjects = empire.privateBuiltObjects as BuiltObject[];
    const builtObjectList: BuiltObject[] = [];
    builtObjectList.push(...privateBuiltObjects);
    const builtObjectList2: BuiltObject[] = [];
    builtObjectList2.push(...(empire.builtObjects as BuiltObject[]));
    const num5 = Math.min(700, 1 + Math.trunc(empire.colonies.length * 1.5));
    const num6 = Math.min(100, 1 + Math.trunc(empire.colonies.length * 0.5));
    const num7 = Math.min(50, 2 + Math.trunc(empire.colonies.length * 0.3));
    const num8 = Math.min(100, 2 + Math.trunc(empire.colonies.length * 0.5));
    if (num3 < ALLOWABLE_YEARS_MAINTENANCE_FROM_CASH_ON_HAND) {
        const privateAnnualCashflow = getPrivateAnnualCashflow(galaxy, empire, true);
        if (privateAnnualCashflow < 0.0) {
            let val = 1.0 - Math.abs(privateAnnualCashflow) / maintenanceWithoutRetirees(empire, privateBuiltObjects);
            val = Math.max(0.0, Math.min(1.0, val));
            num2 = Math.trunc(privateBuiltObjects.length - privateBuiltObjects.length * val);
            for (let i = 0; i < builtObjectList.length; i++) {
                if (builtObjectList[i] != null && builtObjectList[i].design !== null) builtObjectList[i].sortTag = builtObjectList[i].design!.dateCreated;
            }
            sortBySortTag(builtObjectList);
        }
    }
    if (num4 < ALLOWABLE_YEARS_MAINTENANCE_FROM_CASH_ON_HAND) {
        const num9 = calculateSpareAnnualRevenueComplete(galaxy, empire);
        if (num9 < 0.0) {
            // (val2 = 1 - |num9| / AnnualStateMaintenanceWithoutRetirees is computed and never used in the C#.)
            for (let j = 0; j < builtObjectList2.length; j++) {
                if (builtObjectList2[j] != null && builtObjectList2[j].design !== null) builtObjectList2[j].sortTag = builtObjectList2[j].design!.dateCreated;
            }
            sortBySortTag(builtObjectList2);
        }
    }
    // (builtObjectList3 = BuiltObjects + builtObjectList is built and never read in the C#.)
    let empireOrderCount = 0;
    const orders = galaxy.orders.getOrdersForEmpire(empire);
    if (orders !== null) empireOrderCount = orders.count;
    let num10 = 0;
    let num11 = 0;
    let num12 = 0;
    let num13 = 0;
    for (let k = 0; k < privateBuiltObjects.length; k++) {
        const builtObject = privateBuiltObjects[k];
        if (builtObject.unbuiltComponentCount <= 0) {
            if (builtObject.role === BuiltObjectRole.Freight) num10++;
            else if (builtObject.subRole === BuiltObjectSubRole.PassengerShip) num11++;
            else if (builtObject.subRole === BuiltObjectSubRole.MiningShip || builtObject.subRole === BuiltObjectSubRole.GasMiningShip) num12++;
            else if (builtObject.subRole === BuiltObjectSubRole.MiningStation || builtObject.subRole === BuiltObjectSubRole.GasMiningStation) num13++;
        }
    }
    checkAtWar(empire);
    let num14 = 0;
    for (let l = 0; l < builtObjectList.length; l++) {
        const builtObject2 = builtObjectList[l];
        if (!builtObject2.isAutoControlled || builtObject2.retireForNextMission || builtObject2.scrap || (currentStarDate - builtObject2.dateBuilt <= num && num14 >= num2) || !canBuildBuiltObjectBO(empire, builtObject2)) continue;
        if (builtObject2.role === BuiltObjectRole.Freight) {
            if (num10 > 0 && num10 > num5 && shouldRetireFreighter(builtObject2, empireOrderCount, num10)) {
                builtObjectCompleteTeardown(galaxy, builtObject2, true);
                num10--;
                num14++;
            }
        } else if ((builtObject2.subRole !== BuiltObjectSubRole.MiningStation && builtObject2.subRole !== BuiltObjectSubRole.GasMiningStation) || num13 <= num8) {
            if ((builtObject2.subRole === BuiltObjectSubRole.MiningShip || builtObject2.subRole === BuiltObjectSubRole.GasMiningShip) && num12 > num7) {
                builtObjectCompleteTeardown(galaxy, builtObject2, true);
                num12--;
                num14++;
            } else if (builtObject2.subRole === BuiltObjectSubRole.PassengerShip && num11 > num6) {
                builtObjectCompleteTeardown(galaxy, builtObject2, true);
                num11--;
                num14++;
            } else if (builtObject2.role !== BuiltObjectRole.Base || builtObject2.isShipYard || builtObject2.isResourceExtractor) {
                builtObject2.retireForNextMission = true;
                num14++;
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Retrofit
// ---------------------------------------------------------------------------------------------------------------

/** Empire.5.cs 37 DetermineRetrofitAffordability(builtObject, design, out cost, out componentsToProcure). */
function determineRetrofitAffordability(galaxy: Galaxy, empire: Empire, builtObject: BuiltObject | null, design: Design | null): { result: boolean; cost: number; componentsToProcure: ComponentDefinition[] | null } {
    let cost = 0.0;
    let componentsToProcure: ComponentDefinition[] | null = null;
    if (design !== null && builtObject !== null && builtObject.design !== design) {
        componentsToProcure = componentListDiff(resolveComponentList(builtObject.components), design.components);
        const prices = galaxyComponentCurrentPrices(galaxy);
        for (const item of componentsToProcure) cost += prices[item.componentId];
        if (empire.pirateEmpireBaseHabitat !== null) cost *= SHIP_MARKUP_FACTOR_PIRATES;
        else cost *= SHIP_MARKUP_FACTOR;
        if (builtObject.owner === null) {
            if (cost > getPrivateFunds(builtObject.empire!)) return { result: false, cost, componentsToProcure };
        } else if (cost > builtObject.owner.stateMoney) {
            return { result: false, cost, componentsToProcure };
        }
        return { result: true, cost, componentsToProcure };
    }
    return { result: false, cost, componentsToProcure };
}

/** Empire.5.cs 13 CalculateRetrofitCost(builtObject). */
function calculateRetrofitCost(galaxy: Galaxy, empire: Empire, builtObject: BuiltObject): number {
    const design = dlFindNewestCanBuild(empire.designs, builtObject.subRole, builtObject.parentHabitat);
    return determineRetrofitAffordability(galaxy, empire, builtObject, design).cost;
}

/** Empire.6.cs 3706 CalculateRetrofitCosts(builtObjects). */
function calculateRetrofitCosts(galaxy: Galaxy, empire: Empire, builtObjects: readonly BuiltObject[] | null): number {
    let num = 0.0;
    if (builtObjects !== null) {
        for (let i = 0; i < builtObjects.length; i++) {
            const builtObject = builtObjects[i];
            if (builtObject != null && builtObject.retrofitDesign === null && builtObject.builtAt === null) {
                const num2 = buildSpeed(galaxy, empire, builtObject);
                if (num2 <= 1.0 && !builtObject.suppressAutoRetrofit) num += calculateRetrofitCost(galaxy, empire, builtObject);
            }
        }
    }
    return num;
}

/** The three-way retrofit payment of AssignRetrofitMission (Empire.5.cs 175-189, repeated at each site). */
function payForRetrofit(galaxy: Galaxy, builtObject: BuiltObject, cost: number): void {
    const e = builtObject.empire!;
    if (builtObject.empire !== null && builtObject.empire.pirateEmpireBaseHabitat !== null) {
        e.stateMoney -= cost;
        pirateEconomyPerformExpense(galaxy, e, cost, PirateExpenseType.Construction, galaxyStarDate(galaxy));
    } else if (builtObject.owner === null) {
        performPrivateTransaction(galaxy, e, 0.0 - cost);
        e.stateMoney += privateSectorBuildOrRefitInvestInInfrastructure(galaxy, builtObject, cost);
    } else {
        e.stateMoney -= cost;
        pirateEconomyPerformExpense(galaxy, e, cost, PirateExpenseType.Construction, galaxyStarDate(galaxy));
    }
    builtObject.purchasePrice = cost;
}

/**
 * Empire.5.cs 25-353 AssignRetrofitMission(builtObject[, design[, location[, forceUseOfYard = false]]]). `design`
 * undefined = the one-argument overload's Designs.FindNewestCanBuild(builtObject.SubRole, builtObject.ParentHabitat).
 * No Rnd.
 */
export function assignRetrofitMission(galaxy: Galaxy, empire: Empire, builtObject: BuiltObject, design?: Design | null, location: StellarObject | null = null, forceUseOfYard = false): boolean {
    if (design === undefined) design = dlFindNewestCanBuild(empire.designs, builtObject.subRole, builtObject.parentHabitat);
    builtObject.retrofitForNextMission = false;
    if (builtObject.empire === null || (builtObject.empire === galaxy.independentEmpire && builtObject.pirateEmpireId === 0)) return false;
    if (builtObject.role !== BuiltObjectRole.Base && builtObject.topSpeed <= 0) return false;
    if (builtObject.builtAt !== null) return false;
    if (design === null || builtObject.design === design) return false;
    const aff = determineRetrofitAffordability(galaxy, empire, builtObject, design);
    if (!aff.result) return false;
    const cost = aff.cost;
    const componentsToProcure = aff.componentsToProcure;
    if (builtObject.role === BuiltObjectRole.Base) {
        if (builtObject.parentHabitat === null || builtObject.parentHabitat.empire !== builtObject.empire) {
            // 150-190: a base away from its own colony retrofits itself.
            if (builtObject.retrofitBaseManufacturingQueue === null) {
                const manufacturingQueue = ManufacturingQueue.forBuiltObject(builtObject, galaxy);
                manufacturingQueue.redefineBuiltObject(true);
                builtObject.retrofitBaseManufacturingQueue = manufacturingQueue;
            }
            if (builtObject.retrofitBaseConstructionQueue === null) {
                const constructionQueue = new ConstructionQueue(builtObject, galaxy, true);
                constructionQueue.redefineBuiltObject(builtObject, true);
                builtObject.retrofitBaseConstructionQueue = constructionQueue;
            }
            payForRetrofit(galaxy, builtObject, cost);
            const resourcesToOrder = procureConstructionComponentsAtBuiltObject(galaxy, empire, builtObject, builtObject, true, componentsToProcure, true);
            createOrdersFor(galaxy, empire, builtObject, resourcesToOrder, OrderType.RetrofitResourcesForBase);
            const rq = builtObject.retrofitBaseConstructionQueue as ConstructionQueue | null;
            if (rq !== null && rq.addBuiltObjectToRetrofit(builtObject, design)) design.buildCount++;
            return true;
        }
        const parentHabitat = builtObject.parentHabitat;
        if (hasFreeYard(queueOf(parentHabitat)) || forceUseOfYard) {
            payForRetrofit(galaxy, builtObject, cost);
            const resourcesToOrder = procureConstructionComponentsAtColony(galaxy, empire, builtObject, parentHabitat, componentsToProcure);
            createOrdersFor(galaxy, empire, parentHabitat, resourcesToOrder, OrderType.ConstructionShortage);
            const pq = queueOf(builtObject.parentHabitat!);
            if (pq !== null && pq.addBuiltObjectToRetrofit(builtObject, design)) design.buildCount++;
            return true;
        }
    } else if (builtObject.subRole === BuiltObjectSubRole.ColonyShip || builtObject.subRole === BuiltObjectSubRole.ConstructionShip || builtObject.subRole === BuiltObjectSubRole.ResupplyShip) {
        let stellarObject: Habitat | BuiltObject | null = null;
        if (location instanceof Habitat) stellarObject = location;
        else if (location instanceof BuiltObject && empire.pirateEmpireBaseHabitat !== null) stellarObject = location;
        if (stellarObject === null) {
            const r = habitatsFindShortestConstructionWaitQueueCloseToBuiltObject(galaxy, empire.colonies, builtObject);
            stellarObject = r.habitat;
            let num = r.shortestWaitQueueTime / REAL_SECONDS_IN_GALACTIC_YEAR;
            num /= 2000.0;
            if (num >= MAXIMUM_CONSTRUCTION_QUEUE_WAIT_TIME_YEARS && !forceUseOfYard) stellarObject = null;
        }
        if (stellarObject !== null && (hasFreeYard(queueOf(stellarObject)) || forceUseOfYard)) {
            payForRetrofit(galaxy, builtObject, cost);
            if (stellarObject instanceof Habitat) {
                const resourcesToOrder = procureConstructionComponentsAtColony(galaxy, empire, builtObject, stellarObject, componentsToProcure);
                createOrdersFor(galaxy, empire, stellarObject, resourcesToOrder, OrderType.ConstructionShortage);
            } else {
                const resourcesToOrder = procureConstructionComponentsAtBuiltObject(galaxy, empire, builtObject, stellarObject, true, componentsToProcure);
                createOrdersFor(galaxy, empire, stellarObject, resourcesToOrder, OrderType.ConstructionShortage);
            }
            clearPreviousMissionRequirements(galaxy, builtObject);
            assignMission(galaxy, builtObject, BuiltObjectMissionType.Retrofit, stellarObject, null, BuiltObjectMissionPriority.VeryHigh, { design });
            return true;
        }
    } else {
        let builtObject3: BuiltObject | null = null;
        if (location instanceof BuiltObject) builtObject3 = location;
        if (builtObject3 === null) {
            const r = builtObjectsFindShortestConstructionWaitQueueCloseToBuiltObject(galaxy, empire.spacePorts, builtObject);
            builtObject3 = r.builtObject;
            let num2 = r.shortestWaitQueueTime / REAL_SECONDS_IN_GALACTIC_YEAR;
            num2 /= 2000.0;
            if (num2 >= MAXIMUM_CONSTRUCTION_QUEUE_WAIT_TIME_YEARS && !forceUseOfYard) builtObject3 = null;
        }
        if (builtObject3 !== null && (hasFreeYard(queueOf(builtObject3)) || forceUseOfYard)) {
            payForRetrofit(galaxy, builtObject, cost);
            const resourcesToOrder = procureConstructionComponentsAtBuiltObject(galaxy, empire, builtObject, builtObject3, true, componentsToProcure);
            createOrdersFor(galaxy, empire, builtObject3, resourcesToOrder, OrderType.ConstructionShortage);
            clearPreviousMissionRequirements(galaxy, builtObject);
            assignMission(galaxy, builtObject, BuiltObjectMissionType.Retrofit, builtObject3, null, BuiltObjectMissionPriority.VeryHigh, { design });
            return true;
        }
    }
    return false;
}

/** Empire.6.cs 3340/3347 RetrofitBuiltObjects([stateRetrofitAge, privateRetrofitAge, breakthroughInitiated]). No Rnd. */
export function retrofitBuiltObjects(galaxy: Galaxy, empire: Empire, stateRetrofitAge = REAL_SECONDS_IN_GALACTIC_YEAR * 1000 * RETROFIT_YEARS, privateRetrofitAge = REAL_SECONDS_IN_GALACTIC_YEAR * 2000, breakthroughInitiated = false): void {
    const currentStarDate = galaxyStarDate(galaxy);
    const builtObjectList: BuiltObject[] = [];
    builtObjectList.push(...(empire.privateBuiltObjects as BuiltObject[]));
    const builtObjectList2: BuiltObject[] = [];
    let flag = true;
    if (empire === galaxy.playerEmpire) flag = false;
    const policy = empire.policy!;
    if (breakthroughInitiated && policy.researchDesignAutoRetrofit) {
        flag = false;
        const builtObjects = empire.builtObjects as BuiltObject[];
        let builtObjectList3: BuiltObject[] = builtObjects;
        let num = empire.stateMoney * 0.7;
        const recentProjects = empire.research != null ? empire.research.recentProjects : null;
        // ResearchNodeList.ContainsBySpecialFunctionCode(2).
        if (recentProjects != null && recentProjects.some((n) => n.def.specialFunctionCode === 2)) {
            num = empire.stateMoney;
            const subRoles = [BuiltObjectSubRole.ConstructionShip, BuiltObjectSubRole.ExplorationShip, BuiltObjectSubRole.Escort, BuiltObjectSubRole.Frigate, BuiltObjectSubRole.Destroyer];
            // BuiltObjectList.GetBuiltObjectsBySubRole(List<BuiltObjectSubRole>): the matching objects in list order.
            builtObjectList3 = builtObjects.filter((b) => b != null && subRoles.includes(b.subRole));
        } else if (checkEmpireHasHyperDriveTech(empire)) {
            builtObjectList3 = getShipsWithoutWarpDrives(builtObjects);
            if (builtObjectList3.length > 0) num = empire.stateMoney;
            else builtObjectList3 = builtObjects;
        }
        let num2 = calculateRetrofitCosts(galaxy, empire, builtObjectList3);
        if (num2 > 0.0 && num > 0.0 && num2 > num) {
            const num3 = num2 / num;
            if (num3 < 10.0) {
                let num4 = 0.0;
                const num5 = 1 + Math.max(1, Math.trunc(num3 * 8.0 + 0.999));
                const num6 = Math.max(1, Math.trunc(builtObjectList3.length / num5));
                const iterationCount = { count: 0 };
                for (let i = 0; conditionCheckLimit(i < builtObjectList3.length, 200, iterationCount); i += num6) {
                    const count = Math.min(num6, builtObjectList3.length - i);
                    const range = builtObjectList3.slice(i, i + count);
                    const num7 = calculateRetrofitCosts(galaxy, empire, range);
                    if (!(num4 + num7 < num)) break;
                    num4 += num7;
                    builtObjectList2.push(...range);
                }
                num2 = num4;
            }
        } else {
            builtObjectList2.push(...builtObjectList3);
        }
        if (empire === galaxy.playerEmpire) {
            if (empire.stateMoney >= num2) {
                // 3409-3437: the advisor text lists RecentProjects' components. TODO(port) M9: GameText formatting.
                const text = getText(builtObjectList2.length === builtObjects.length ? 'Retrofit Recommendation Explanation' : 'Retrofit Recommendation Explanation Partial');
                const refusalCount: RefCount = { value: 0 };
                if (checkTaskAuthorized(galaxy, empire, empire.controlStateConstruction, refusalCount, formatText(text, formatMoney(Math.max(0.0, num2))), builtObjectList2, AdvisorMessageType.Retrofit)) {
                    flag = true;
                    if (empire.controlStateConstruction !== AutomationLevel.FullyAutomated) stateRetrofitAge = 0;
                }
                if (recentProjects != null) recentProjects.length = 0;
            }
        } else {
            if (num2 < empire.stateMoney * 0.7) {
                flag = true;
                stateRetrofitAge = Math.max(stateRetrofitAge, REAL_SECONDS_IN_GALACTIC_YEAR * 2000);
            }
            if (recentProjects != null) recentProjects.length = 0;
        }
    }
    if (flag) builtObjectList.push(...builtObjectList2);
    doRetrofit(galaxy, empire, builtObjectList, currentStarDate, privateRetrofitAge, stateRetrofitAge, flag, breakthroughInitiated, false);
}

/** Empire.6.cs 3466 DoRetrofit(builtObjects, starDate, privateRetrofitAge, stateRetrofitAge, stateRetrofitPermitted, breakthroughInitiated, manuallyInitiated). No Rnd. */
export function doRetrofit(galaxy: Galaxy, empire: Empire, builtObjects: BuiltObject[], starDate: number, privateRetrofitAge: number, stateRetrofitAge: number, stateRetrofitPermitted: boolean, breakthroughInitiated: boolean, manuallyInitiated: boolean): void {
    const flag = checkAtWar(empire);
    const policy = empire.policy!;
    const num = policy.constructionSpaceportLargeColonyPopulationThreshold * 1000000;
    const num2 = policy.constructionSpaceportMediumColonyPopulationThreshold * 1000000;
    const num3 = policy.constructionSpaceportSmallColonyPopulationThreshold * 1000000;
    const designs = empire.designs;
    if (!flag && stateRetrofitPermitted) {
        const shipGroups = empireShipGroups(empire);
        for (let i = 0; i < shipGroups.length; i++) {
            const shipGroup = shipGroups[i];
            if (shipGroup === null || shipGroup.leadShip === null || (!breakthroughInitiated && !shipGroup.leadShip.isAutoControlled) || starDate - shipGroup.leadShip.dateRetrofit <= stateRetrofitAge || !checkFleetNeedsRetrofit(galaxy, empire, shipGroup, !manuallyInitiated)) continue;
            const mission = shipGroup.mission;
            if (mission === null || mission.type === BuiltObjectMissionType.Undefined || mission.priority === BuiltObjectMissionPriority.Low) {
                if (mission === null || mission.type !== BuiltObjectMissionType.Retrofit) assignFleetRetrofit(galaxy, empire, shipGroup, null, !manuallyInitiated);
            } else if ((mission === null || mission.type !== BuiltObjectMissionType.Retrofit) && !missionListContainsType(shipGroup.subsequentMissions, BuiltObjectMissionType.Retrofit)) {
                shipGroupQueueMission(galaxy, shipGroup, BuiltObjectMissionType.Retrofit, null, null, BuiltObjectMissionPriority.Normal);
            }
        }
    }
    for (let j = 0; j < builtObjects.length; j++) {
        const builtObject = builtObjects[j];
        if ((!builtObject.isAutoControlled && !breakthroughInitiated) || builtObject.retrofitForNextMission || builtObject.retrofitDesign !== null) continue;
        let num4 = stateRetrofitAge;
        if (builtObject.owner === null) num4 = privateRetrofitAge;
        switch (builtObject.subRole) {
            case BuiltObjectSubRole.GasMiningStation:
            case BuiltObjectSubRole.MiningStation:
            case BuiltObjectSubRole.ResortBase:
            case BuiltObjectSubRole.GenericBase:
            case BuiltObjectSubRole.EnergyResearchStation:
            case BuiltObjectSubRole.WeaponsResearchStation:
            case BuiltObjectSubRole.HighTechResearchStation:
            case BuiltObjectSubRole.MonitoringStation:
                num4 = privateRetrofitAge * 2;
                break;
        }
        if (starDate - builtObject.dateRetrofit <= num4 || builtObject.builtAt !== null || builtObject.shipGroup !== null || (builtObject.role === BuiltObjectRole.Military && flag)) continue;
        const num5 = buildSpeed(galaxy, empire, builtObject);
        let flag2 = true;
        if (num5 > 1.0) {
            const design = dlFindNewestCanBuild(designs, builtObject.subRole);
            if (design === null || design.warpSpeed <= 0 || builtObject.design === null || builtObject.design.warpSpeed > 0) flag2 = false;
        }
        if (!flag2 || builtObject.suppressAutoRetrofit) continue;
        if (builtObject.parentHabitat !== null) {
            if (!canBuildBuiltObjectBO(empire, builtObject, builtObject.parentHabitat)) continue;
            builtObject.retrofitForNextMission = true;
            if (builtObject.role === BuiltObjectRole.Base) {
                if (builtObject.subRole === BuiltObjectSubRole.SmallSpacePort || builtObject.subRole === BuiltObjectSubRole.MediumSpacePort || builtObject.subRole === BuiltObjectSubRole.LargeSpacePort) {
                    if (empire.pirateEmpireBaseHabitat !== null) {
                        let design2 = dlFindNewestCanBuild(designs, builtObject.subRole);
                        const builtObject2 = identifyPirateSpaceport(galaxy, empire);
                        if (builtObject === builtObject2) {
                            if (builtObject.subRole === BuiltObjectSubRole.SmallSpacePort) {
                                const design3 = dlFindNewestCanBuild(designs, BuiltObjectSubRole.MediumSpacePort);
                                if (design3 !== null && canBuildDesign(empire, design3)) design2 = design3;
                            } else if (builtObject.subRole === BuiltObjectSubRole.MediumSpacePort) {
                                const design4 = dlFindNewestCanBuild(designs, BuiltObjectSubRole.LargeSpacePort);
                                if (design4 !== null && canBuildDesign(empire, design4)) design2 = design4;
                            }
                        }
                        if (design2 !== null && design2 !== builtObject.design && assignRetrofitMission(galaxy, empire, builtObject, design2, null, true)) builtObject.dateRetrofit = galaxyStarDate(galaxy);
                        builtObject.retrofitForNextMission = false;
                        continue;
                    }
                    let design5 = dlFindNewestCanBuild(designs, builtObject.subRole);
                    const total = builtObject.parentHabitat.population!.totalAmount;
                    if (total > num) {
                        design5 = dlFindNewestCanBuild(designs, BuiltObjectSubRole.LargeSpacePort);
                    } else if (total > num2) {
                        if (builtObject.subRole !== BuiltObjectSubRole.LargeSpacePort) design5 = dlFindNewestCanBuild(designs, BuiltObjectSubRole.MediumSpacePort);
                    } else if (total > num3 && builtObject.subRole !== BuiltObjectSubRole.LargeSpacePort && builtObject.subRole !== BuiltObjectSubRole.MediumSpacePort) {
                        design5 = dlFindNewestCanBuild(designs, BuiltObjectSubRole.SmallSpacePort);
                    }
                    if (design5 !== null && design5 !== builtObject.design && assignRetrofitMission(galaxy, empire, builtObject, design5, null, true)) builtObject.dateRetrofit = galaxyStarDate(galaxy);
                    builtObject.retrofitForNextMission = false;
                } else {
                    const design6 = findNewestCanBuild(designs, builtObject.subRole, builtObject.actualEmpire, builtObject.parentHabitat);
                    if (design6 !== null && design6 !== builtObject.design && assignRetrofitMission(galaxy, empire, builtObject, design6, null, true)) builtObject.dateRetrofit = galaxyStarDate(galaxy);
                }
            } else {
                const m = builtObjectMission(builtObject.mission);
                if ((m === null || m.type === BuiltObjectMissionType.Undefined) && assignRetrofitMission(galaxy, empire, builtObject)) builtObject.dateRetrofit = galaxyStarDate(galaxy);
            }
            continue;
        }
        let flag3 = true;
        switch (builtObject.subRole) {
            case BuiltObjectSubRole.ResupplyShip:
            case BuiltObjectSubRole.ColonyShip:
            case BuiltObjectSubRole.ConstructionShip:
                flag3 = empire.pirateEmpireBaseHabitat !== null || canBuildBuiltObjectBO(empire, builtObject, empire.capital);
                break;
            default:
                flag3 = canBuildBuiltObjectBO(empire, builtObject);
                break;
        }
        if (builtObject.role === BuiltObjectRole.Base) flag3 = canBuildBuiltObjectBO(empire, builtObject, builtObject.parentHabitat);
        if (!flag3) continue;
        builtObject.retrofitForNextMission = true;
        if (builtObject.role === BuiltObjectRole.Base) {
            if (assignRetrofitMission(galaxy, empire, builtObject)) builtObject.dateRetrofit = galaxyStarDate(galaxy);
            continue;
        }
        const mission2 = builtObjectMission(builtObject.mission);
        if (mission2 === null || mission2.type === BuiltObjectMissionType.Undefined) {
            if (assignRetrofitMission(galaxy, empire, builtObject)) builtObject.dateRetrofit = galaxyStarDate(galaxy);
        } else {
            if (mission2.type === BuiltObjectMissionType.Retrofit || missionListContainsType(builtObject.subsequentMissions as BuiltObjectMission[], BuiltObjectMissionType.Retrofit)) continue;
            const design7 = findNewestCanBuild(designs, builtObject.subRole, builtObject.actualEmpire);
            if (design7 !== null && design7 !== builtObject.design) {
                let stellarObject: StellarObject | null = null;
                switch (builtObject.subRole) {
                    case BuiltObjectSubRole.ResupplyShip:
                    case BuiltObjectSubRole.ColonyShip:
                    case BuiltObjectSubRole.ConstructionShip:
                        stellarObject = findNearestShipYard(galaxy, empire, builtObject, true, true);
                        break;
                    default:
                        stellarObject = findNearestShipYard(galaxy, empire, builtObject, true, false);
                        break;
                }
                queueMission(galaxy, builtObject, BuiltObjectMissionType.Retrofit, stellarObject, null, BuiltObjectMissionPriority.Normal, design7);
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Entry points (Empire.DoTasks / DoTasksPirates)
// ---------------------------------------------------------------------------------------------------------------

/** Empire.1.cs 3403 ReviewDesignsAndRetrofit. Rnd: CreateNewDesigns' (designGeneration.ts). */
export function reviewDesignsAndRetrofit(galaxy: Galaxy, empire: Empire): void {
    if (empire.reviewDesignsAndRetrofitFlag) {
        if (empire.controlDesigns) {
            // Empire.CreateNewDesigns(long designDate) → BaconEmpire.CreateNewDesigns(this, designDate, forceUpdate: false).
            const starDate = galaxyStarDate(galaxy);
            createNewDesigns(galaxy, empire, starDate, starDate);
        }
        let privateRetrofitAge = REAL_SECONDS_IN_GALACTIC_YEAR * 1000 * 2;
        if (empire.reviewDesignsAndRetrofitImportantBreakthrough) privateRetrofitAge = 0;
        retrofitBuiltObjects(galaxy, empire, 0, privateRetrofitAge, true);
        empire.reviewDesignsAndRetrofitFlag = false;
        empire.reviewDesignsAndRetrofitImportantBreakthrough = false;
    }
}

/** Empire.10.cs 3065 ReviewLatestDesigns. No Rnd. */
export function reviewLatestDesigns(galaxy: Galaxy, empire: Empire): void {
    void galaxy;
    for (let i = 0; i < empire.designSpecifications.length; i++) {
        const designSpecification = empire.designSpecifications[i]!;
        const design = findNewestCanBuildFullEvaluate(empire.designs, designSpecification.subRole, null, false);
        if (design !== null) empire.latestDesigns[design.subRole] = design;
        else empire.latestDesigns[designSpecification.subRole] = null;
    }
}

/** The (location, resourcesToOrder) pairs DirectConstruction / BuildDefensiveBases collect (C# parallel lists). */
export interface PendingOrders<T> {
    locations: T[];
    cargo: CargoList[];
}

/**
 * Empire.6.cs 2842-2901 / Empire.10.cs 1346-1374: for every distinct location (first-seen order), merge its cargo lists
 * (CargoList.Add) and CreateOrder(location, resource, amount, isState: false, ConstructionShortage) per merged cargo.
 */
export function placeGroupedOrders<T extends Habitat | BuiltObject>(galaxy: Galaxy, empire: Empire, pending: PendingOrders<T>): void {
    const distinct: T[] = [];
    for (const item of pending.locations) if (!distinct.includes(item)) distinct.push(item);
    for (const item2 of distinct) {
        const cargoList = new CargoList();
        for (let n = 0; n < pending.locations.length; n++) {
            if (pending.locations[n] !== item2) continue;
            for (const c of pending.cargo[n].items) cargoList.add(c);
        }
        createOrdersFor(galaxy, empire, item2, cargoList, OrderType.ConstructionShortage);
    }
}

/** Empire.6.cs 2373 DirectConstruction. */
export function directConstruction(galaxy: Galaxy, empire: Empire): void {
    const refusalCount: RefCount = { value: 0 };
    const bases: PendingOrders<BuiltObject> = { locations: [], cargo: [] };
    const colonies: PendingOrders<Habitat> = { locations: [], cargo: [] };
    const currentStarDate = galaxyStarDate(galaxy);
    let num = 0;
    let num2 = 0;
    const builtObjectList2: BuiltObject[] = [];
    builtObjectList2.push(...(empire.builtObjects as BuiltObject[]));
    builtObjectList2.push(...(empire.privateBuiltObjects as BuiltObject[]));
    for (let i = 0; i < builtObjectList2.length; i++) {
        const builtObject = builtObjectList2[i];
        if (builtObject.role === BuiltObjectRole.Military) {
            if (builtObject.unbuiltOrDamagedComponentCount === 0) num2++;
        } else if (builtObject.role === BuiltObjectRole.Freight && builtObject.unbuiltOrDamagedComponentCount === 0) {
            num++;
        }
    }
    let num3 = 0;
    const priv = empire.privateForceStructureProjections;
    if (priv !== null) {
        for (const s of [BuiltObjectSubRole.SmallFreighter, BuiltObjectSubRole.MediumFreighter, BuiltObjectSubRole.LargeFreighter]) {
            const p = priv.getBySubRole(s);
            if (p !== null) num3 += p.amount;
        }
    }
    let num4 = 0;
    const state = empire.stateForceStructureProjections;
    if (state !== null) {
        for (const s of [BuiltObjectSubRole.Escort, BuiltObjectSubRole.Frigate, BuiltObjectSubRole.Destroyer, BuiltObjectSubRole.Cruiser, BuiltObjectSubRole.CapitalShip, BuiltObjectSubRole.Carrier]) {
            const p = state.getBySubRole(s);
            if (p !== null) num4 += p.amount;
        }
    }
    const num5 = Math.trunc(num3 * 0.4);
    const num6 = Math.trunc(num4 * 0.25);
    let flag = false;
    if (num >= num5 && num2 >= num6) flag = true;
    if (empire.dominantRace !== null && !empire.dominantRace.expanding) flag = false;
    // `_ = ThisYearsSpacePortIncome; CalculateAccurateAnnualIncome();` — the result is discarded (no side effects).
    calculateAccurateAnnualIncome(galaxy, empire);
    const current = currentStateForceStructure(empire, currentStarDate);
    const annualSupportCosts = current.annualSupportCosts;
    let num7 = calculateAccurateAnnualCashflow(galaxy, empire);
    const forceStructureProjectionList2 = empire.stateForceStructureProjections!.diff(current.projections);
    netSort(forceStructureProjectionList2.items, (a, b) => a.compareTo(b));
    const num8 = estimateForceStructureSupportCost(galaxy, empire, forceStructureProjectionList2);
    const num9 = annualSupportCosts + num8;
    const num10 = empire.stateMoney / num9;
    let num11 = 5.0;
    if (checkAtWar(empire)) num11 = 2.0;
    if (num10 > num11) num7 = Math.max(num7, num8);
    let num12 = 0.0;
    let num13 = 0.0;
    const policy = empire.policy!;
    // 2476-2585: new space ports.
    if (empire.controlStateConstruction !== AutomationLevel.Undefined) {
        let num14 = 0;
        const bos = empire.builtObjects as BuiltObject[];
        for (let j = 0; j < bos.length; j++) {
            const s = bos[j].subRole;
            if (s === BuiltObjectSubRole.SmallSpacePort || s === BuiltObjectSubRole.MediumSpacePort || s === BuiltObjectSubRole.LargeSpacePort) num14++;
        }
        let val = 1 + Math.trunc(empire.colonies.length / 3.0);
        const val2 = 1 + Math.trunc(empire.totalPopulation / 5000000000);
        val = Math.min(val, val2);
        const newSpacePortAmount = val - num14;
        const habitatList2 = determineNewSpacePortLocations(galaxy, empire, empire.colonies, newSpacePortAmount, true);
        const num15 = policy.constructionSpaceportLargeColonyPopulationThreshold * 1000000;
        const num16 = policy.constructionSpaceportMediumColonyPopulationThreshold * 1000000;
        const num17 = policy.constructionSpaceportSmallColonyPopulationThreshold * 1000000;
        for (const item of habitatList2) {
            if (!checkSafeToBuildAtLocation(galaxy, empire, item)) continue;
            let design: Design | null = null;
            const design2 = dlFindNewestCanBuild(empire.designs, BuiltObjectSubRole.SmallSpacePort);
            const design3 = dlFindNewestCanBuild(empire.designs, BuiltObjectSubRole.MediumSpacePort);
            const design4 = dlFindNewestCanBuild(empire.designs, BuiltObjectSubRole.LargeSpacePort);
            const total = item.population!.totalAmount;
            if (design4 !== null && total > num15) design = design4;
            else if (design3 !== null && total > num16) design = design3;
            else if (design2 !== null && total > num17) design = design2;
            if (design === null) continue;
            let num18 = design.calculateCurrentPurchasePrice(galaxy);
            let num19 = designCalculateMaintenanceCosts(galaxy, design, empire);
            if (num13 + num19 > num7) {
                if (design.subRole === BuiltObjectSubRole.LargeSpacePort) design = dlFindNewestCanBuild(empire.designs, BuiltObjectSubRole.MediumSpacePort);
                else if (design.subRole === BuiltObjectSubRole.MediumSpacePort) design = dlFindNewestCanBuild(empire.designs, BuiltObjectSubRole.SmallSpacePort);
                if (design !== null) {
                    num18 = design.calculateCurrentPurchasePrice(galaxy);
                    num19 = designCalculateMaintenanceCosts(galaxy, design, empire);
                }
            }
            if (design === null || !(num13 + num19 <= num7) || !(num12 + num18 <= empire.stateMoney)) continue;
            design.buildCount++;
            const builtObject3 = new BuiltObject(design, item.name + ' ' + getText('Space Port'), galaxy);
            builtObject3.purchasePrice = num18;
            if (checkTaskAuthorized(galaxy, empire, empire.controlStateConstruction, refusalCount, generateAutomationMessageConstruction(galaxy, builtObject3, item, num18), item, AdvisorMessageType.BuildOneOff, null, design, null)) {
                const q = queueOf(item);
                if (q !== null && q.addBuiltObjectToConstruct(builtObject3)) {
                    builtObject3.parentHabitat = item;
                    // (double)(item.Diameter / 6) + 15.0: Habitat.Diameter is a short → integer division.
                    const range = Math.trunc(item.diameter / 6) + 15.0;
                    const p = galaxy.selectRelativePoint(range);
                    builtObject3.parentOffsetX = p.x;
                    builtObject3.parentOffsetY = p.y;
                    builtObject3.heading = galaxy.selectRandomHeading();
                    builtObject3.targetHeading = builtObject3.heading;
                    builtObject3.nearestSystemStar = galaxy.determineHabitatSystemStar(item);
                    empire.addBuiltObjectToGalaxy(builtObject3, item, false, true);
                    builtObject3.builtAt = item;
                    num12 += num18;
                    num13 += num19;
                    colonies.cargo.push(procureConstructionComponentsAtColony(galaxy, empire, builtObject3, item));
                    colonies.locations.push(item);
                } else {
                    design.buildCount--;
                }
            } else {
                design.buildCount--;
            }
        }
    }
    // 2586-2629: a research station at a colony.
    const buildout = checkBuildoutResearchCapacityAtColonies(galaxy, empire);
    const researchStationDesignToBuild = buildout.researchStationDesignToBuild;
    const colonyToBuildAt = buildout.colonyToBuildAt;
    if (buildout.result && researchStationDesignToBuild !== null && colonyToBuildAt !== null) {
        const num20 = researchStationDesignToBuild.calculateCurrentPurchasePrice(galaxy);
        const num21 = designCalculateMaintenanceCosts(galaxy, researchStationDesignToBuild, empire);
        if (num13 + num21 <= num7 && num12 + num20 <= empire.stateMoney && checkSafeToBuildAtLocation(galaxy, empire, colonyToBuildAt)) {
            researchStationDesignToBuild.buildCount++;
            const name = galaxy.selectUniqueBuiltObjectName(researchStationDesignToBuild, colonyToBuildAt);
            const builtObject4 = new BuiltObject(researchStationDesignToBuild, name, galaxy);
            builtObject4.purchasePrice = num20;
            if (checkTaskAuthorized(galaxy, empire, empire.controlStateConstruction, refusalCount, generateAutomationMessageConstruction(galaxy, builtObject4, colonyToBuildAt, num20), colonyToBuildAt, AdvisorMessageType.BuildOneOff, null, researchStationDesignToBuild, null)) {
                const q = queueOf(colonyToBuildAt);
                if (q !== null && q.addBuiltObjectToConstruct(builtObject4)) {
                    builtObject4.parentHabitat = colonyToBuildAt;
                    const offset = determineOrbitalBaseLocation(galaxy, colonyToBuildAt);
                    builtObject4.parentOffsetX = offset.x;
                    builtObject4.parentOffsetY = offset.y;
                    builtObject4.heading = galaxy.selectRandomHeading();
                    builtObject4.targetHeading = builtObject4.heading;
                    builtObject4.nearestSystemStar = galaxy.determineHabitatSystemStar(colonyToBuildAt);
                    empire.addBuiltObjectToGalaxy(builtObject4, colonyToBuildAt, false, true, Math.trunc(offset.x), Math.trunc(offset.y));
                    builtObject4.builtAt = colonyToBuildAt;
                    num12 += num20;
                    num13 += num21;
                    colonies.cargo.push(procureConstructionComponentsAtColony(galaxy, empire, builtObject4, colonyToBuildAt));
                    colonies.locations.push(colonyToBuildAt);
                } else {
                    researchStationDesignToBuild.buildCount--;
                }
            } else {
                researchStationDesignToBuild.buildCount--;
            }
        }
    }
    // 2630-2735: colonization.
    if (flag && empire.controlColonization !== AutomationLevel.Undefined) {
        const habitatList3 = determineHabitatsBeingColonized(empire);
        // _ColonizationTargets.Sort(); Reverse() — in place (HabitatPrioritization.CompareTo: Priority).
        const targets = empire.colonizationTargets as { habitat: Habitat; priority: number; assignedShip?: unknown }[];
        netSort(targets, (a, b) => (a.priority < b.priority ? -1 : a.priority > b.priority ? 1 : 0));
        targets.reverse();
        const list3 = empire.colonizableHabitatTypesForEmpire();
        for (let k = 0; k < targets.length; k++) {
            const habitatPrioritization = targets[k];
            const target = habitatPrioritization.habitat;
            if (!checkShouldAttemptColonization(galaxy, empire, target) || (habitatPrioritization.assignedShip ?? null) !== null || habitatList3.includes(target) || (target.empire !== null && target.empire !== galaxy.independentEmpire)) continue;
            let flag2 = false;
            const bos = empire.builtObjects as BuiltObject[];
            for (let l = 0; l < bos.length; l++) {
                const builtObject5 = bos[l];
                const m5 = builtObjectMission(builtObject5.mission);
                if (builtObject5.role === BuiltObjectRole.Colony && (m5 === null || m5.type === BuiltObjectMissionType.Undefined)) {
                    if (
                        canBuiltObjectColonizeHabitat(galaxy, empire, builtObject5, target).result &&
                        habitatPrioritization.priority >= HABITAT_COLONIZATION_THRESHHOLD &&
                        withinFuelRange(galaxy, builtObject5, target.xpos, target.ypos, 0.0) &&
                        checkTaskAuthorized(galaxy, empire, empire.controlColonization, refusalCount, generateAutomationMessageColonization(galaxy, target, builtObject5, null), target, AdvisorMessageType.Colonization, null, builtObject5, null)
                    ) {
                        habitatPrioritization.assignedShip = builtObject5;
                        assignMission(galaxy, builtObject5, BuiltObjectMissionType.Colonize, target, null, BuiltObjectMissionPriority.Normal);
                        flag2 = true;
                        break;
                    }
                }
            }
            if (flag2) continue;
            const design5 = dlFindNewestCanBuild(empire.designs, BuiltObjectSubRole.ColonyShip);
            if (design5 === null) continue;
            const flag3 = empire.canDesignColonizeHabitat(design5, target);
            if ((!flag3 && !list3.includes(target.type)) || habitatPrioritization.priority < HABITAT_COLONIZATION_THRESHHOLD) continue;
            const num22 = design5.calculateCurrentPurchasePrice(galaxy);
            if (!(num12 + num22 <= empire.stateMoney)) continue;
            design5.buildCount++;
            const builtObject6 = new BuiltObject(design5, galaxy.generateBuiltObjectName(design5), galaxy);
            builtObject6.purchasePrice = num22;
            let r: { habitat: Habitat | null; shortestWaitQueueTime: number };
            if (flag3) {
                r = habitatsFindShortestConstructionWaitQueue(galaxy, empire.colonies, builtObject6, false, false);
            } else {
                const habitatList4: Habitat[] = [];
                for (const colony of empire.colonies) {
                    const dominantRace = colony.population!.dominantRace;
                    if (dominantRace !== null && dominantRace.nativeHabitatType === target.type) habitatList4.push(colony);
                }
                r = habitatsFindShortestConstructionWaitQueue(galaxy, habitatList4, builtObject6, false, false);
            }
            const habitat = r.habitat;
            const num23 = r.shortestWaitQueueTime / REAL_SECONDS_IN_GALACTIC_YEAR;
            if (habitat !== null && num23 < MAXIMUM_CONSTRUCTION_QUEUE_WAIT_TIME_YEARS) {
                const num24 = galaxy.calculateDistance(target.xpos, target.ypos, habitat.xpos, habitat.ypos);
                if (num24 <= design5.maximumRange()) {
                    if (checkTaskAuthorized(galaxy, empire, empire.controlColonization, refusalCount, generateAutomationMessageColonization(galaxy, target, null, habitat), target, AdvisorMessageType.Colonization, null, habitat, null)) {
                        const q = queueOf(habitat);
                        if (q !== null && q.addBuiltObjectToConstruct(builtObject6)) {
                            builtObject6.name = galaxy.generateBuiltObjectName(design5, habitat);
                            habitatPrioritization.assignedShip = builtObject6;
                            empire.addBuiltObjectToGalaxy(builtObject6, habitat, false, true);
                            num12 += num22;
                            assignMission(galaxy, builtObject6, BuiltObjectMissionType.Colonize, target, null, BuiltObjectMissionPriority.Normal);
                            builtObject6.builtAt = habitat;
                            colonies.cargo.push(procureConstructionComponentsAtColony(galaxy, empire, builtObject6, habitat));
                            colonies.locations.push(habitat);
                        } else {
                            design5.buildCount--;
                        }
                    } else {
                        design5.buildCount--;
                    }
                } else {
                    design5.buildCount--;
                }
            } else {
                design5.buildCount--;
            }
        }
    }
    // 2736-2839: the state force structure.
    if (empire.controlStateConstruction !== AutomationLevel.Undefined) {
        const forceStructureProjectionList3 = refactorForceStructureProjectionsToCosts(galaxy, empire, forceStructureProjectionList2, num7, num13, num12, true).result;
        let num25 = 0.0;
        const hasYards = empire.constructionYards != null && empire.constructionYards.length > 0;
        for (const item2 of forceStructureProjectionList3) {
            const design6 = findNewestCanBuild(empire.designs, item2.subRole, empire, null, false);
            if (design6 !== null && (hasYards || design6.subRole === BuiltObjectSubRole.ColonyShip || design6.subRole === BuiltObjectSubRole.ConstructionShip || design6.subRole === BuiltObjectSubRole.ResupplyShip)) {
                const num26 = design6.calculateCurrentPurchasePrice(galaxy);
                num25 += num26 * item2.amount;
            }
        }
        if (forceStructureProjectionList3.count > 0 && forceStructureProjectionList3.totalAmount > 0) {
            if (empire.controlStateConstruction === AutomationLevel.PartiallyAutomated) {
                const empireMessage = new EmpireMessage(empire, EmpireMessageType.AdvisorSuggestion, null);
                empireMessage.advisorMessageType = AdvisorMessageType.BuildOrder;
                empireMessage.description = formatText(getText('Build new ships for X credits'), formatMoney(num25));
                empireMessage.starDate = currentStarDate;
                sendEmpireMessage(empireMessage, empire);
            } else if (empire.controlStateConstruction === AutomationLevel.FullyAutomated) {
                for (const item3 of forceStructureProjectionList3) {
                    const design7 = findNewestCanBuild(empire.designs, item3.subRole, empire, null, false);
                    if (design7 === null || item3.amount <= 0) continue;
                    for (let m = 0; m < item3.amount; m++) {
                        const num27 = design7.calculateCurrentPurchasePrice(galaxy);
                        const num28 = designCalculateMaintenanceCosts(galaxy, design7, empire);
                        if (!(num13 + num28 <= num7) || !(num12 + num27 <= empire.stateMoney)) continue;
                        design7.buildCount++;
                        const builtObject7 = new BuiltObject(design7, galaxy.generateBuiltObjectName(design7), galaxy);
                        builtObject7.purchasePrice = num27;
                        if (builtObject7.subRole === BuiltObjectSubRole.ConstructionShip || builtObject7.subRole === BuiltObjectSubRole.ResupplyShip) {
                            const rh = habitatsFindShortestConstructionWaitQueue(galaxy, empire.colonies, builtObject7);
                            const habitat2 = rh.habitat;
                            const num29 = rh.shortestWaitQueueTime / REAL_SECONDS_IN_GALACTIC_YEAR;
                            if (habitat2 !== null && num29 < MAXIMUM_CONSTRUCTION_QUEUE_WAIT_TIME_YEARS) {
                                const q = queueOf(habitat2);
                                if (q !== null && q.addBuiltObjectToConstruct(builtObject7)) {
                                    num12 += num27;
                                    num13 += num28;
                                    builtObject7.name = galaxy.generateBuiltObjectName(design7, habitat2);
                                    empire.addBuiltObjectToGalaxy(builtObject7, habitat2, false, true);
                                    builtObject7.builtAt = habitat2;
                                    builtObject7.isAutoControlled = newBuiltObjectShouldBeAutomated(empire, builtObject7.subRole);
                                    colonies.cargo.push(procureConstructionComponentsAtColony(galaxy, empire, builtObject7, habitat2));
                                    colonies.locations.push(habitat2);
                                } else {
                                    design7.buildCount--;
                                }
                            } else {
                                design7.buildCount--;
                            }
                            continue;
                        }
                        const rb = builtObjectsFindShortestConstructionWaitQueue(empire.spacePorts, builtObject7);
                        const builtObject8 = rb.builtObject;
                        const num30 = rb.shortestWaitQueueTime / REAL_SECONDS_IN_GALACTIC_YEAR;
                        if (builtObject8 !== null && num30 < MAXIMUM_CONSTRUCTION_QUEUE_WAIT_TIME_YEARS) {
                            const q = queueOf(builtObject8);
                            if (q !== null && q.addBuiltObjectToConstruct(builtObject7)) {
                                num12 += num27;
                                num13 += num28;
                                if (builtObject8.parentHabitat !== null) builtObject7.name = galaxy.generateBuiltObjectName(design7, builtObject8.parentHabitat);
                                empire.addBuiltObjectToGalaxy(builtObject7, builtObject8, false, true);
                                builtObject7.builtAt = builtObject8;
                                builtObject7.isAutoControlled = newBuiltObjectShouldBeAutomated(empire, builtObject7.subRole);
                                bases.cargo.push(procureConstructionComponentsAtBuiltObject(galaxy, empire, builtObject7, builtObject8, true));
                                bases.locations.push(builtObject8);
                            } else {
                                design7.buildCount--;
                            }
                        } else {
                            design7.buildCount--;
                        }
                    }
                }
            }
        }
    }
    empire.stateMoney -= num12;
    pirateEconomyPerformExpense(galaxy, empire, num12, PirateExpenseType.Construction, currentStarDate);
    placeGroupedOrders(galaxy, empire, bases);
    placeGroupedOrders(galaxy, empire, colonies);
}

/** Empire.10.cs 1211 BuildDefensiveBases. Rnd per queued base: GenerateBuiltObjectName, Next(0, 5), DetermineOrbitalBaseLocation, SelectRandomHeading. */
export function buildDefensiveBases(galaxy: Galaxy, empire: Empire): void {
    const design = findNewestCanBuildFullEvaluate(empire.designs, BuiltObjectSubRole.DefensiveBase, empire.capital);
    if (design === null) return;
    const habitatList: Habitat[] = [];
    const stellarObjectList = resolveLocationsToDefend(galaxy, empire, false) as unknown[];
    const stellarObjectList2: unknown[] = [];
    for (let i = 0; i < stellarObjectList.length; i++) if (!(stellarObjectList[i] instanceof Habitat)) stellarObjectList2.push(stellarObjectList[i]);
    for (let j = 0; j < stellarObjectList2.length; j++) {
        const idx = stellarObjectList.indexOf(stellarObjectList2[j]);
        if (idx >= 0) stellarObjectList.splice(idx, 1);
    }
    for (let k = 0; k < empire.colonies.length; k++) {
        const habitat = empire.colonies[k];
        const sv = strategicValue(habitat);
        if (sv > 250000 && !stellarObjectList.includes(habitat)) stellarObjectList.push(habitat);
    }
    for (let l = 0; l < stellarObjectList.length; l++) {
        const o = stellarObjectList[l];
        if (!(o instanceof Habitat)) continue;
        const habitat2 = o;
        let num = 0;
        for (let m = 0; m < habitat2.basesAtHabitat.length; m++) {
            const b = habitat2.basesAtHabitat[m];
            num = b.unbuiltOrDamagedComponentCount <= 0 ? num + b.firepowerRaw : num + b.design!.firepowerRaw;
        }
        let num2 = Math.trunc(estimatedDefensiveForceRequired(galaxy, habitat2, false, galaxy.difficultyLevel) * 1.2);
        let flag = true;
        if (empire.dominantRace !== null && !empire.dominantRace.expanding) flag = false;
        if (flag) {
            num2 = Math.min(num2, 2000);
            if (empire.colonies.length < 6 || empire.spacePorts.length < 3) num2 = Math.trunc(num2 / 1.7);
            else if (empire.colonies.length < 12 || empire.spacePorts.length < 5) num2 = Math.trunc(num2 / 1.3);
        }
        let num3 = 1;
        const q = queueOf(habitat2);
        if (q !== null) num3 = q.constructionSpeed;
        const num4 = countBySubRole(habitat2.basesAtHabitat, BuiltObjectSubRole.DefensiveBase);
        if (num < num2 && num4 < 4 && num3 >= 100 && (determineSpacePortAtColony(galaxy, habitat2) !== null || empire.colonies.length > 1)) habitatList.push(habitat2);
    }
    if (habitatList.length <= 0) return;
    const num5 = design.calculateCurrentPurchasePrice(galaxy);
    const num6 = calculateSupportCost(galaxy, empire, design);
    const pending: PendingOrders<Habitat> = { locations: [], cargo: [] };
    const refusalCount: RefCount = { value: 0 };
    for (let n = 0; n < habitatList.length; n++) {
        const habitat3 = habitatList[n];
        let flag2 = true;
        const q3 = queueOf(habitat3);
        if (q3 !== null && q3.constructionWaitQueue!.length > 0) flag2 = false;
        if (!flag2) continue;
        const num7 = calculateSpareAnnualRevenueComplete(galaxy, empire);
        if (!(num6 <= num7) || !(num5 <= empire.stateMoney)) continue;
        design.buildCount++;
        const builtObject = new BuiltObject(design, galaxy.generateBuiltObjectName(design), galaxy);
        builtObject.purchasePrice = num5;
        if (checkTaskAuthorized(galaxy, empire, empire.controlStateConstruction, refusalCount, generateAutomationMessageDefensiveBase(galaxy, habitat3, design), habitat3, AdvisorMessageType.BuildOneOff, null, design, null)) {
            if (q3 !== null && q3.addBuiltObjectToConstruct(builtObject)) {
                const array = [getText('Ship SubRole DefensiveBase'), getText('Weapons Platform'), getText('Defense Platform'), getText('Defense Battery'), getText('Orbital Battery')];
                builtObject.name = habitat3.name + ' ' + array[galaxy.rnd.next(0, array.length)];
                const offset = determineOrbitalBaseLocation(galaxy, habitat3);
                builtObject.heading = galaxy.selectRandomHeading();
                builtObject.targetHeading = builtObject.heading;
                empire.addBuiltObjectToGalaxy(builtObject, habitat3, false, true, Math.trunc(offset.x), Math.trunc(offset.y));
                empire.stateMoney -= num5;
                pirateEconomyPerformExpense(galaxy, empire, num5, PirateExpenseType.Construction, galaxyStarDate(galaxy));
                builtObject.builtAt = habitat3;
                pending.cargo.push(procureConstructionComponentsAtColony(galaxy, empire, builtObject, habitat3));
                pending.locations.push(habitat3);
            } else {
                design.buildCount--;
            }
        } else {
            design.buildCount--;
        }
    }
    placeGroupedOrders(galaxy, empire, pending);
}

/** Empire.5.cs 3924 CheckCoordsWithinGalaxy(x, y). */
function checkCoordsWithinGalaxy(galaxy: Galaxy, x: number, y: number): boolean {
    if (x < 0.0 || y < 0.0) return false;
    if (x > galaxy.sizeX || y > galaxy.sizeY) return false;
    return true;
}

/** Empire.5.cs 3937 ObtainCoordinatesFromPoint(angle, startX, startY, distance, out x, out y). Rnd: 2 × Next(0, 2). */
function obtainCoordinatesFromPoint(galaxy: Galaxy, angle: number, startX: number, startY: number, distance: number): { x: number; y: number } {
    let num = Math.cos(angle) * distance;
    let num2 = Math.sin(angle) * distance;
    if (galaxy.rnd.next(0, 2) === 1) num *= -1.0;
    if (galaxy.rnd.next(0, 2) === 1) num2 *= -1.0;
    return { x: startX + num, y: startY + num2 };
}

/** Galaxy.7.cs 1548 FindNearestUncolonizedExploredSystem(x, y, empire). */
function findNearestUncolonizedExploredSystem(galaxy: Galaxy, x: number, y: number, empire: Empire): Habitat | null {
    let num = Number.MAX_VALUE;
    let result: Habitat | null = null;
    const list = empire.systemVisibility;
    for (let i = 0; i < list.length; i++) {
        const systemVisibility = list[i];
        const idx = systemVisibility.systemStar.systemIndex;
        if (empire.visibility.checkSystemVisibilityStatus(idx) === SystemVisibilityStatus.Explored && (galaxy.systems[idx].dominantEmpire ?? null) === null) {
            const num2 = galaxy.calculateDistanceSquared(x, y, systemVisibility.systemStar.xpos, systemVisibility.systemStar.ypos);
            if (num2 < num) {
                result = systemVisibility.systemStar;
                num = num2;
            }
        }
    }
    return result;
}

/** Galaxy.3.cs 663 FastFindNearestLongRangeScannerBase(x, y, empire). */
function fastFindNearestLongRangeScannerBase(galaxy: Galaxy, x: number, y: number, empire: Empire): BuiltObject | null {
    let num = Number.MAX_VALUE;
    let result: BuiltObject | null = null;
    const list = empire.longRangeScanners as (BuiltObject | null)[];
    for (let i = 0; i < list.length; i++) {
        const builtObject = list[i];
        if (builtObject != null && builtObject.role === BuiltObjectRole.Base) {
            const num2 = galaxy.calculateDistanceSquared(x, y, builtObject.xpos, builtObject.ypos);
            if (num2 < num) {
                result = builtObject;
                num = num2;
            }
        }
    }
    return result;
}

/** Empire.9.cs 3422 FindLongRangeScannerThatCanSeePoint(x, y, rangeModifier). */
function findLongRangeScannerThatCanSeePoint(galaxy: Galaxy, empire: Empire, x: number, y: number, rangeModifier: number): BuiltObject | null {
    const list = empire.longRangeScanners as (BuiltObject | null)[];
    if (list != null) {
        for (let i = 0; i < list.length; i++) {
            const builtObject = list[i];
            if (builtObject != null && builtObject.sensorLongRange > 0 && builtObject.currentSpeed === 0) {
                let num = builtObject.sensorLongRange * rangeModifier;
                num *= num;
                const num2 = galaxy.calculateDistanceSquared(x, y, builtObject.xpos, builtObject.ypos);
                if (num2 <= num) return builtObject;
            }
        }
    }
    return null;
}

/** Empire.5.cs 3769 DetermineMonitoringStationLocation. */
export function determineMonitoringStationLocation(galaxy: Galaxy, empire: Empire): void {
    const component = empire.research.evaluateDesiredComponent(ComponentType.SensorLongRange, ShipDesignFocus.Balanced);
    const design = dlFindNewestCanBuild(empire.designs, BuiltObjectSubRole.MonitoringStation);
    if (design === null || design.sensorLongRange <= 0 || component === null) return;
    const flag = checkConstructionShipAndMiningStationCanSurviveStorms(empire);
    const habitatList: Habitat[] = [];
    const list: number[] = [];
    const capital = empire.capital!;
    for (let i = 0; i < galaxy.empires.length; i++) {
        const other = galaxy.empires[i];
        const diplomaticRelation = obtainDiplomaticRelation(empire, other);
        if (diplomaticRelation.type === DiplomaticRelationType.NotMet || other === empire) continue;
        let flag2 = false;
        switch (diplomaticRelation.strategy) {
            case DiplomaticStrategy.Conquer:
            case DiplomaticStrategy.Defend:
            case DiplomaticStrategy.DefendPlacate:
            case DiplomaticStrategy.DefendUndermine:
                flag2 = true;
                break;
        }
        if (other.colonies.length >= 5) {
            const empireEvaluation = obtainEmpireEvaluation(galaxy, other, empire);
            if (empireEvaluation.overallAttitude < 0) flag2 = true;
        }
        if (!flag2) continue;
        const habitat = fastFindNearestColony(galaxy, Math.trunc(capital.xpos), Math.trunc(capital.ypos), other, 0);
        if (habitat !== null) {
            const systemVisibilityStatus = empire.visibility.checkSystemVisibilityStatus(habitat.systemIndex);
            if (systemVisibilityStatus === SystemVisibilityStatus.Explored && !isObjectVisibleToThisEmpire(galaxy, empire, habitat)) {
                const habitat2 = galaxy.determineHabitatSystemStar(habitat);
                habitatList.push(habitat2);
                list.push(galaxy.calculateDistance(capital.xpos, capital.ypos, habitat2.xpos, habitat2.ypos));
            }
        }
    }
    // Array.Sort(keys, items) (introsort, like List.Sort; netSort mirrors it on the key/item pairs).
    const pairs = habitatList.map((h, k) => ({ key: list[k], h }));
    netSort(pairs, (a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    const array = pairs.map((p) => p.h);
    const habitatList2: Habitat[] = [];
    const list2: { x: number; y: number }[] = [];
    // CheckNearPirateBase(Habitat, x, y) → scanRange (int)(MaxSolarSystemSize * 2.1), empireToExclude null.
    const scanRange = Math.trunc(MAX_SOLAR_SYSTEM_SIZE * 2.1);
    for (let j = 0; j < array.length; j++) {
        let flag3 = false;
        const habitat3 = array[j];
        const habitat4 = findNearestUncolonizedExploredSystem(galaxy, habitat3.xpos, habitat3.ypos, empire);
        if (habitat4 !== null) {
            const num = galaxy.calculateDistance(habitat4.xpos, habitat4.ypos, habitat3.xpos, habitat3.ypos);
            if (num < design.sensorLongRange - MAX_SOLAR_SYSTEM_SIZE * 2.1 && galaxy.systems[habitat4.systemIndex].habitats.length > 0 && !checkNearPirateBase(galaxy, empire, habitat4, scanRange, habitat4.xpos, habitat4.ypos, null) && (flag || !checkInStorm(galaxy, habitat4.xpos, habitat4.ypos))) {
                let flag4 = false;
                const builtObject = fastFindNearestLongRangeScannerBase(galaxy, Math.trunc(habitat4.xpos), Math.trunc(habitat4.ypos), empire);
                if (builtObject !== null) {
                    const num2 = galaxy.calculateDistance(habitat4.xpos, habitat4.ypos, builtObject.xpos, builtObject.ypos);
                    if (num2 < MAX_SOLAR_SYSTEM_SIZE * 2.1) flag4 = true;
                }
                if (!flag4) {
                    let flag5 = false;
                    const systemInfo = galaxy.systems[habitat3.systemIndex];
                    let empire2: Empire | null = null;
                    if (systemInfo != null && systemInfo.dominantEmpire != null && systemInfo.dominantEmpire.empire != null) empire2 = systemInfo.dominantEmpire.empire;
                    if (empire2 !== null) {
                        if (isObjectVisibleToThisEmpire(galaxy, empire2, habitat4, false, false)) flag5 = true;
                        else if (findLongRangeScannerThatCanSeePoint(galaxy, empire2, habitat4.xpos, habitat4.ypos, design.stealth) !== null) flag5 = true;
                    }
                    if (!flag5) {
                        flag3 = true;
                        const habitats = galaxy.systems[habitat4.systemIndex].habitats;
                        const index = galaxy.rnd.next(0, habitats.length);
                        habitatList2.push(habitats[index]);
                    }
                }
            }
        }
        if (flag3) continue;
        let angle = galaxy.selectRandomHeading();
        let num3 = design.sensorLongRange - MAX_SOLAR_SYSTEM_SIZE * 2.1;
        num3 -= MAX_SOLAR_SYSTEM_SIZE * 3.0;
        let p = obtainCoordinatesFromPoint(galaxy, angle, habitat3.xpos, habitat3.ypos, num3);
        let num4 = 0;
        let flag6 = false;
        while ((!checkCoordsWithinGalaxy(galaxy, p.x, p.y) || !flag6) && (flag || !checkInStorm(galaxy, p.x, p.y)) && num4 < 20) {
            angle = galaxy.selectRandomHeading();
            p = obtainCoordinatesFromPoint(galaxy, angle, habitat3.xpos, habitat3.ypos, num3);
            num4++;
            flag6 = true;
            const builtObject2 = fastFindNearestLongRangeScannerBase(galaxy, Math.trunc(p.x), Math.trunc(p.y), empire);
            if (builtObject2 !== null) {
                const num5 = galaxy.calculateDistance(builtObject2.xpos, builtObject2.ypos, p.x, p.y);
                if (num5 < MAX_SOLAR_SYSTEM_SIZE * 2.1) flag6 = false;
            }
            if (flag6) {
                const systemInfo2 = galaxy.systems[habitat3.systemIndex];
                let empire3: Empire | null = null;
                if (systemInfo2 != null && systemInfo2.dominantEmpire != null && systemInfo2.dominantEmpire.empire != null) empire3 = systemInfo2.dominantEmpire.empire;
                if (empire3 !== null && findLongRangeScannerThatCanSeePoint(galaxy, empire3, p.x, p.y, design.stealth) !== null) flag6 = false;
            }
        }
        // (Sic, C# 3917: the point is kept only when the last candidate was rejected — `!flag6`.)
        if (checkCoordsWithinGalaxy(galaxy, p.x, p.y) && !flag6) list2.push({ x: Math.trunc(p.x), y: Math.trunc(p.y) });
    }
    empire.monitoringHabitats = habitatList2;
    empire.monitoringPoints = list2;
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

// ---- stub added by M4o (called from combat/damage.ts DetermineScrapDamagedShip, Galaxy.7.cs 2876) ----

const T_findNearestAvailableConstructionShip = registerTodo('M4i', 'findNearestAvailableConstructionShip');
/** Empire.9.cs 4631 FindNearestAvailableConstructionShip(x, y) — stub: null. */
export function findNearestAvailableConstructionShip(galaxy: Galaxy, empire: Empire, x: number, y: number): BuiltObject | null {
    void galaxy; void empire; void x; void y;
    /* TODO(port) M4i */ todo(T_findNearestAvailableConstructionShip);
    return null;
}

// ---------------------------------------------------------------------------------------------------------------
// 17a — the player's Build Order panel (Main.Part2.cs 929-1165) → Empire.6.cs 3017 BuildNewShips.
// Player input only: nothing here runs on the tick path.
// ---------------------------------------------------------------------------------------------------------------

/**
 * Main.Part2.cs 929 method_632 / 950 method_633 / 1112 method_641: the Build Order total — Σ amount ×
 * design.CalculateCurrentPurchasePrice(galaxy) over the panel rows, and the maintenance total, which (method_633's
 * flag) counts every row but SmallFreighter / MediumFreighter / LargeFreighter / MiningShip / GasMiningShip /
 * PassengerShip (method_632 sums those into a discarded second accumulator). `designs` / `amounts` are the rows in
 * panel order (Escort … PassengerShip, method_643's order); the row's sub-role is the design's (method_642 reads the
 * design from that sub-role's drop-down). No Rnd.
 */
export function buildOrderTotalCost(galaxy: Galaxy, empire: Empire, designs: readonly (Design | null)[], amounts: readonly number[]): { total: number; maintenance: number } {
    let num = 0.0;
    let double_7 = 0.0;
    for (let i = 0; i < designs.length && i < amounts.length; i++) {
        const design = designs[i];
        // 952: method_640 — the row's NumericUpDown amount.
        const amount = Math.trunc(amounts[i]);
        // 953: (double)num * method_641 (0 without a design).
        const result = amount * (design != null ? design.calculateCurrentPurchasePrice(galaxy) : 0.0);
        let num2 = 0.0;
        let flag = true;
        // 966-978: civilian rows add no maintenance.
        if (design != null) {
            switch (design.subRole) {
                case BuiltObjectSubRole.SmallFreighter:
                case BuiltObjectSubRole.MediumFreighter:
                case BuiltObjectSubRole.LargeFreighter:
                case BuiltObjectSubRole.PassengerShip:
                case BuiltObjectSubRole.GasMiningShip:
                case BuiltObjectSubRole.MiningShip:
                    flag = false;
                    break;
                default:
                    flag = true;
                    break;
            }
        }
        // 980-984.
        if (flag && design != null) {
            num2 = designCalculateMaintenanceCosts(galaxy, design, empire);
            num2 *= amount;
        }
        double_7 += num2;
        num += result;
    }
    return { total: num, maintenance: double_7 };
}

/** Result of the Build Order purchase (btnBuildOrderPurchase_Click + Empire.BuildNewShips). */
export interface BuildNewShipsResult {
    ok: boolean;
    /** The GameText the original's message box shows (colonyTick gameText encoding; resolveGameText displays it). */
    message?: string;
    /** The message box caption. */
    title?: string;
    /** The BuiltObjects queued, in queueing order. */
    built: BuiltObject[];
}

/**
 * Main.Part2.cs 1135 btnBuildOrderPurchase_Click (the affordability check) then Empire.6.cs 3017 BuildNewShips(designs,
 * amounts). `designs` / `amounts` are method_643's lists (rows with a design and amount > 0, panel order).
 * Rnd per ship queued, C# order: Galaxy.GenerateBuiltObjectName(design) (SelectUniqueBuiltObjectName draws for
 * non-numbered names), then GenerateBuiltObjectName(design, yard colony) again when the yard has a colony (always for a
 * colony-built construction / resupply ship), then AddBuiltObjectToGalaxy (offsetLocationFromParent: false → no draws).
 * A ship the yard refuses still drew its first name.
 */
export function buildNewShips(galaxy: Galaxy, empire: Empire, designs: (Design | null)[], amounts: number[]): BuildNewShipsResult {
    // Main.Part2.cs 1137-1145: method_632 total against StateMoney.
    const num0 = buildOrderTotalCost(galaxy, empire, designs, amounts).total;
    if (num0 > empire.stateMoney) {
        return {
            ok: false,
            message: gameText('Build Order Purchase Cannot Afford', formatThousands(num0), formatThousands(empire.stateMoney)),
            title: gameText('Cannot afford build order'),
            built: [],
        };
    }
    const built: BuiltObject[] = [];
    // Empire.6.cs:3019-3022.
    if (designs == null || designs.length <= 0 || amounts == null || amounts.length <= 0 || designs.length !== amounts.length) {
        return { ok: false, built };
    }
    // Empire.6.cs:3023-3028.
    let num = 0.0;
    const bases: PendingOrders<BuiltObject> = { locations: [], cargo: [] };
    const colonies: PendingOrders<Habitat> = { locations: [], cargo: [] };
    // Empire.6.cs:3029-3106.
    for (let i = 0; i < designs.length; i++) {
        const design = designs[i];
        if (design == null) continue;
        const num2 = amounts[i];
        if (num2 <= 0) continue;
        for (let j = 0; j < num2; j++) {
            // Empire.6.cs:3043-3051.
            const num3 = design.calculateCurrentPurchasePrice(galaxy);
            if (!(num + num3 <= empire.stateMoney)) continue;
            design.buildCount++;
            const builtObject = new BuiltObject(design, galaxy.generateBuiltObjectName(design), galaxy);
            builtObject.purchasePrice = num3;
            // Empire.6.cs:3052-3078: construction / resupply ships are built at colonies (long wait queues allowed).
            if (builtObject.subRole === BuiltObjectSubRole.ConstructionShip || builtObject.subRole === BuiltObjectSubRole.ResupplyShip) {
                const habitat = habitatsFindShortestConstructionWaitQueue(galaxy, empire.colonies, builtObject, true).habitat;
                if (habitat !== null) {
                    const q = queueOf(habitat);
                    if (q !== null && q.addBuiltObjectToConstruct(builtObject)) {
                        num += num3;
                        builtObject.name = galaxy.generateBuiltObjectName(design, habitat);
                        empire.addBuiltObjectToGalaxy(builtObject, habitat, false, true);
                        builtObject.builtAt = habitat;
                        builtObject.isAutoControlled = newBuiltObjectShouldBeAutomated(empire, builtObject.subRole);
                        colonies.cargo.push(procureConstructionComponentsAtColony(galaxy, empire, builtObject, habitat));
                        colonies.locations.push(habitat);
                        built.push(builtObject);
                    } else {
                        design.buildCount--;
                    }
                } else {
                    design.buildCount--;
                }
                continue;
            }
            // Empire.6.cs:3079-3105: everything else at the shortest-wait space port (no very small yards).
            const builtObject2 = builtObjectsFindShortestConstructionWaitQueue(empire.spacePorts, builtObject, false).builtObject;
            if (builtObject2 !== null) {
                const q = queueOf(builtObject2);
                if (q !== null && q.addBuiltObjectToConstruct(builtObject)) {
                    num += num3;
                    if (builtObject2.parentHabitat !== null) builtObject.name = galaxy.generateBuiltObjectName(design, builtObject2.parentHabitat);
                    empire.addBuiltObjectToGalaxy(builtObject, builtObject2, false, true);
                    builtObject.builtAt = builtObject2;
                    builtObject.isAutoControlled = newBuiltObjectShouldBeAutomated(empire, builtObject.subRole);
                    bases.cargo.push(procureConstructionComponentsAtBuiltObject(galaxy, empire, builtObject, builtObject2, true));
                    bases.locations.push(builtObject2);
                    built.push(builtObject);
                } else {
                    design.buildCount--;
                }
            } else {
                design.buildCount--;
            }
        }
    }
    // Empire.6.cs:3107-3108.
    empire.stateMoney -= num;
    pirateEconomyPerformExpense(galaxy, empire, num, PirateExpenseType.Construction, galaxyStarDate(galaxy));
    // Empire.6.cs:3109-3135: shortage orders per distinct space port, then Empire.6.cs:3136-3162 per distinct colony.
    placeGroupedOrders(galaxy, empire, bases);
    placeGroupedOrders(galaxy, empire, colonies);
    return { ok: true, built };
}

// ---------------------------------------------------------------------------------------------------------------
// Empire.6.cs 1991-2180 PurchaseNewBuiltObject — buy one design at a given yard (the player's Build orders,
// Main.Part7.cs 379 / 1180, Main.Part4.cs 2867 method_539, ConstructionYardPurchaser). Player input only here: the
// tick-path caller (BuiltObject.2.cs 1110, cmdTroops Colonize ColonyActionForNewBuildDesign) is still a TODO(port).
// ---------------------------------------------------------------------------------------------------------------

/**
 * Galaxy.6.cs 2737 CalculateAngleFromCoords. Ported here as a free function because Galaxy's private copy
 * (galaxy.ts calculateAngleFromCoords) negates the (x >= centerX, y < centerY) branch, which the C# does not.
 */
function calculateAngleFromCoords(x: number, y: number, centerX: number, centerY: number, distance: number): number {
    const num2 = Math.PI / 2.0;
    const num3 = num2 * -1.0;
    if (x < centerX) {
        if (y < centerY) {
            return num3 - (num2 + Math.asin((y - centerY) / distance));
        }
        return num2 + (num2 - Math.asin((y - centerY) / distance));
    }
    if (y < centerY) {
        return Math.asin((y - centerY) / distance);
    }
    return Math.asin((y - centerY) / distance);
}

/** Empire.7.cs 1565 ColonizableHabitatTypesForEmpireTechOnly(empire). No Rnd. */
export function colonizableHabitatTypesForEmpireTechOnly(empire: Empire): HabitatType[] {
    const list: HabitatType[] = [];
    if (empire.canColonizeContinental) list.push(HabitatType.Continental);
    if (empire.canColonizeMarshySwamp) list.push(HabitatType.MarshySwamp);
    if (empire.canColonizeOcean) list.push(HabitatType.Ocean);
    if (empire.canColonizeDesert) list.push(HabitatType.Desert);
    if (empire.canColonizeIce) list.push(HabitatType.Ice);
    if (empire.canColonizeVolcanic) list.push(HabitatType.Volcanic);
    return list;
}

function isSpacePortSubRole(subRole: BuiltObjectSubRole): boolean {
    return subRole === BuiltObjectSubRole.SmallSpacePort || subRole === BuiltObjectSubRole.MediumSpacePort || subRole === BuiltObjectSubRole.LargeSpacePort;
}

/** Empire.6.cs 2070-2083 / 2155-2168: pay for the purchase (pirate empires and state purchases from StateMoney). */
function payForPurchase(galaxy: Galaxy, empire: Empire, num: number, isStateOwned: boolean): void {
    if (empire.pirateEmpireBaseHabitat !== null) {
        empire.stateMoney -= num;
        pirateEconomyPerformExpense(galaxy, empire, num, PirateExpenseType.Construction, galaxyStarDate(galaxy));
    } else if (isStateOwned) {
        empire.stateMoney -= num;
        pirateEconomyPerformExpense(galaxy, empire, num, PirateExpenseType.Construction, galaxyStarDate(galaxy));
    } else {
        performPrivateTransaction(galaxy, empire, 0.0 - num);
    }
}

/**
 * Empire.6.cs 1991 PurchaseNewBuiltObject(design, Habitat constructionYard, isStateOwned, isAutoControlled) (the
 * habitat overload passes the yard's own (int)Xpos/(int)Ypos, 1993) and Empire.6.cs 2098 PurchaseNewBuiltObject(design,
 * BuiltObject constructionYard, isStateOwned, isAutoControlled). Returns the queued BuiltObject, or null when
 * unaffordable, refused by the yard, or (BuiltObject yard) a space-port design.
 * Rnd: see purchaseNewBuiltObjectAt / purchaseNewBuiltObjectAtBuiltObject.
 */
export function purchaseNewBuiltObject(galaxy: Galaxy, empire: Empire, design: Design, constructionYard: Habitat | BuiltObject, isStateOwned: boolean, isAutoControlled: boolean): BuiltObject | null {
    if (constructionYard instanceof BuiltObject) {
        return purchaseNewBuiltObjectAtBuiltObject(galaxy, empire, design, constructionYard, isStateOwned, isAutoControlled);
    }
    // Empire.6.cs:1993.
    return purchaseNewBuiltObjectAt(galaxy, empire, design, constructionYard, Math.trunc(constructionYard.xpos), Math.trunc(constructionYard.ypos), isStateOwned, isAutoControlled);
}

/**
 * Empire.6.cs 1996 PurchaseNewBuiltObject(design, Habitat constructionYard, int x, int y, isStateOwned, isAutoControlled).
 * (x, y) is the galaxy point the player chose (the yard's own position = "no point": the base goes at a random spot).
 * Rnd, C# order, only when affordable: GenerateBuiltObjectName(design, yard) (space ports: none — "<yard> Space Port");
 * then, when the yard accepts it and it is a base sub-role (space port / research station / monitoring station /
 * defensive / generic base): with (x, y) within 3 of the yard SelectRelativeHabitatSurfacePoint (2 draws) then
 * SelectRelativePoint (space ports, 2 draws) or DetermineOrbitalBaseLocation (other bases); then SelectRandomHeading
 * (1 draw). AddBuiltObjectToGalaxy(offsetLocationFromParent: false) draws nothing.
 */
export function purchaseNewBuiltObjectAt(galaxy: Galaxy, empire: Empire, design: Design, constructionYard: Habitat, x: number, y: number, isStateOwned: boolean, isAutoControlled: boolean): BuiltObject | null {
    // Empire.6.cs:1998-2000.
    let builtObject: BuiltObject | null = null;
    let resourcesToOrder = new CargoList();
    const num = design.calculateCurrentPurchasePrice(galaxy);
    // Empire.6.cs:2001-2012.
    let flag = false;
    if (isStateOwned) {
        if (num <= empire.stateMoney) flag = true;
    } else if (num <= getPrivateFunds(empire)) {
        flag = true;
    }
    if (flag) {
        // Empire.6.cs:2015-2018 (the ternary at 2016).
        design.buildCount++;
        builtObject = !isSpacePortSubRole(design.subRole)
            ? new BuiltObject(design, galaxy.generateBuiltObjectName(design, constructionYard), galaxy)
            : new BuiltObject(design, constructionYard.name + ' ' + getText('Space Port'), galaxy);
        builtObject.isAutoControlled = isAutoControlled;
        builtObject.purchasePrice = num;
        // Empire.6.cs:2019.
        const q = queueOf(constructionYard);
        if (q !== null && q.addBuiltObjectToConstruct(builtObject)) {
            let x2 = 0.0;
            let y2 = 0.0;
            // Empire.6.cs:2023.
            const sr = builtObject.subRole;
            if (
                isSpacePortSubRole(sr) ||
                sr === BuiltObjectSubRole.EnergyResearchStation ||
                sr === BuiltObjectSubRole.WeaponsResearchStation ||
                sr === BuiltObjectSubRole.HighTechResearchStation ||
                sr === BuiltObjectSubRole.MonitoringStation ||
                sr === BuiltObjectSubRole.DefensiveBase ||
                sr === BuiltObjectSubRole.GenericBase
            ) {
                builtObject.parentHabitat = constructionYard;
                // Empire.6.cs:2026-2043: no point chosen — a random spot at the yard.
                if (Math.abs(x - constructionYard.xpos) < 3.0 && Math.abs(y - constructionYard.ypos) < 3.0) {
                    let p = galaxy.selectRelativeHabitatSurfacePoint(constructionYard);
                    x2 = p.x;
                    y2 = p.y;
                    switch (builtObject.subRole) {
                        case BuiltObjectSubRole.SmallSpacePort:
                        case BuiltObjectSubRole.MediumSpacePort:
                        case BuiltObjectSubRole.LargeSpacePort: {
                            // Habitat.Diameter is a short: integer division.
                            const range = Math.trunc(constructionYard.diameter / 6) + 15.0;
                            p = galaxy.selectRelativePoint(range);
                            x2 = p.x;
                            y2 = p.y;
                            break;
                        }
                        default:
                            p = determineOrbitalBaseLocation(galaxy, constructionYard);
                            x2 = p.x;
                            y2 = p.y;
                            break;
                    }
                } else {
                    // Empire.6.cs:2044-2059: the chosen point, pulled in to the yard's range.
                    x2 = x - constructionYard.xpos;
                    y2 = y - constructionYard.ypos;
                    let num2 = Math.trunc(constructionYard.diameter / 2) + 250.0;
                    if (isSpacePortSubRole(builtObject.subRole)) {
                        num2 = Math.trunc(constructionYard.diameter / 8) + 10.0;
                    }
                    const num3 = galaxy.calculateDistance(x2, y2, 0.0, 0.0);
                    if (num3 > num2) {
                        const num4 = calculateAngleFromCoords(x2, y2, 0.0, 0.0, num3);
                        x2 = Math.cos(num4) * num2;
                        y2 = Math.sin(num4) * num2;
                    }
                }
                // Empire.6.cs:2061-2065.
                builtObject.parentOffsetX = x2;
                builtObject.parentOffsetY = y2;
                builtObject.heading = galaxy.selectRandomHeading();
                builtObject.targetHeading = builtObject.heading;
                builtObject.nearestSystemStar = galaxy.determineHabitatSystemStar(constructionYard);
            }
            // Empire.6.cs:2067-2069.
            empire.addBuiltObjectToGalaxy(builtObject, constructionYard, false, isStateOwned, Math.trunc(x2), Math.trunc(y2));
            builtObject.builtAt = constructionYard;
            resourcesToOrder = procureConstructionComponentsAtColony(galaxy, empire, builtObject, constructionYard);
            // Empire.6.cs:2070-2083.
            payForPurchase(galaxy, empire, num, isStateOwned);
        } else {
            // Empire.6.cs:2085-2089 (the yard refused it).
            design.buildCount--;
            builtObject = null;
        }
    }
    // Empire.6.cs:2091-2094.
    createOrdersFor(galaxy, empire, constructionYard, resourcesToOrder, OrderType.ConstructionShortage);
    return builtObject;
}

/**
 * Empire.6.cs 2098 PurchaseNewBuiltObject(design, BuiltObject constructionYard, isStateOwned, isAutoControlled).
 * Rnd, C# order, only when affordable: (mining / gas mining station: none — "<yard> Mining Station") else
 * GenerateBuiltObjectName(design) and, when the yard has a ParentHabitat, GenerateBuiltObjectName(design, parent) again;
 * then, when the yard accepts a mining station, SelectRelativeHabitatSurfacePoint (2) + SelectRandomHeading (1).
 * AddBuiltObjectToGalaxy with a BuiltObject parent draws nothing.
 */
export function purchaseNewBuiltObjectAtBuiltObject(galaxy: Galaxy, empire: Empire, design: Design, constructionYard: BuiltObject, isStateOwned: boolean, isAutoControlled: boolean): BuiltObject | null {
    // Empire.6.cs:2100-2105.
    let builtObject: BuiltObject | null = null;
    let resourcesToOrder = new CargoList();
    if (isSpacePortSubRole(design.subRole)) {
        return null;
    }
    const num = design.calculateCurrentPurchasePrice(galaxy);
    // Empire.6.cs:2107-2118.
    let flag = false;
    if (isStateOwned) {
        if (num <= empire.stateMoney) flag = true;
    } else if (num <= getPrivateFunds(empire)) {
        flag = true;
    }
    if (flag) {
        // Empire.6.cs:2121-2139.
        design.buildCount++;
        if (design.subRole === BuiltObjectSubRole.MiningStation) {
            builtObject = new BuiltObject(design, constructionYard.name + ' ' + getText('Mining Station'), galaxy);
        } else if (design.subRole === BuiltObjectSubRole.GasMiningStation) {
            builtObject = new BuiltObject(design, constructionYard.name + ' ' + getText('Gas Mining Station'), galaxy);
        } else {
            builtObject = new BuiltObject(design, galaxy.generateBuiltObjectName(design), galaxy);
            if (constructionYard.parentHabitat !== null) {
                builtObject.name = galaxy.generateBuiltObjectName(design, constructionYard.parentHabitat);
            }
        }
        builtObject.isAutoControlled = isAutoControlled;
        builtObject.purchasePrice = num;
        // Empire.6.cs:2140.
        const q = queueOf(constructionYard);
        if (q !== null && q.addBuiltObjectToConstruct(builtObject)) {
            // Empire.6.cs:2142-2151 (C# dereferences constructionYard.ParentHabitat without a null check.)
            if (builtObject.subRole === BuiltObjectSubRole.MiningStation || builtObject.subRole === BuiltObjectSubRole.GasMiningStation) {
                builtObject.parentHabitat = constructionYard.parentHabitat;
                const p = galaxy.selectRelativeHabitatSurfacePoint(constructionYard.parentHabitat);
                builtObject.parentOffsetX = p.x;
                builtObject.parentOffsetY = p.y;
                builtObject.heading = galaxy.selectRandomHeading();
                builtObject.targetHeading = builtObject.heading;
                builtObject.nearestSystemStar = galaxy.determineHabitatSystemStar(constructionYard.parentHabitat!);
            }
            // Empire.6.cs:2152-2154.
            empire.addBuiltObjectToGalaxy(builtObject, constructionYard, false, isStateOwned);
            builtObject.builtAt = constructionYard;
            resourcesToOrder = procureConstructionComponentsAtBuiltObject(galaxy, empire, builtObject, constructionYard, true);
            // Empire.6.cs:2155-2168.
            payForPurchase(galaxy, empire, num, isStateOwned);
        } else {
            // Empire.6.cs:2170-2174 (the yard refused it).
            design.buildCount--;
            builtObject = null;
        }
    }
    // Empire.6.cs:2176-2180.
    createOrdersFor(galaxy, empire, constructionYard, resourcesToOrder, OrderType.ConstructionShortage);
    return builtObject;
}
