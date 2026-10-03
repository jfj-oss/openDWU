// M4f — civilian mission AI (private sector): Empire.5.cs 1361-2801 AssignMissionsToBuiltObjectList /
// AssignMissionToBuiltObject, Empire.4.cs 4796 AssignShipMissions, Empire.5.cs 2859-3400 resort / migration / tourism
// missions and destinations, ReviewMigrationTourism 3128, Empire.5.cs 1298 ReviewIndependentColonyTargets,
// Empire.4.cs 4652 IdentifyColonizationTargets, Empire.6.cs 741 DirectPrivateConstruction, and the Galaxy exploration
// searches (Galaxy.6.cs 4019 FindNextSystemToScout, 4089 FindUnexploredRuinsOrLocations, 4152 FindNextHabitatToExplore,
// 4256 / 4360 FastFindNearestUnexploredHabitat[InSector], 3848 / 4567 FindNearestUnexploredHabitatInSystem).
//
// Free functions, C# `this` first (tasks/M4-plan.md §3.1 rule 2). Every Galaxy.Rnd draw is on `galaxy.rnd` in C# order.
// Cross-package callees that are still stubs are called through their owner's stub (assignScrapMission /
// assignRepairMission / assignRetrofitMission / procureConstructionComponents /
// determineHabitatsBeingMinedIncludingBuildingMiningStations (M4i), setupRefuelling (M4e), assignLoadTroopsMission and
// the troop-transport checks (M4q)).

import { raceAggressionLevel, raceCautionLevel } from './racePeriodic';
import { isAiControlled } from './missions/playerOrder';
import type { Galaxy } from './galaxy';
import type { Empire } from './empire';
import { AutomationLevel, empireGovernmentAttributes } from './empire';
import { BuiltObject } from './builtObject';
import type { DockingBay } from './builtObject';
import { HabitatCategoryType, HabitatType, IndustryType, planetsOf, type Habitat, type SystemInfo } from './types';
import type { Race } from './data/races';
import type { Design } from './design';
import { findNewest } from './design';
import { BuiltObjectSubRole } from './builtObjectTypes';
import { BuiltObjectRole } from './data/designSpecifications';
import { ResourceGroup, resourceGroupOf } from './resourceSystem';
import {
    BuiltObjectMission,
    BuiltObjectMissionPriority,
    BuiltObjectMissionType,
    Command,
    CommandAction,
    Sector,
    builtObjectMission,
    builtObjectSubsequentMissions,
    isBuiltObject,
    isHabitat,
    type StellarObject,
} from './missions/mission';
import type { ShipGroup } from './fleets/shipGroup';
import { leaveShipGroup } from './fleets/shipGroup';
import { assignMission, clearPreviousMissionRequirements } from './missions/assign';
import { fastFindNearestColony, shipGroupOf } from './combat/threats';
import { determineAngle } from './combat/attackAI';
import {
    MAX_SOLAR_SYSTEM_SIZE,
    distanceWithinRange,
    fastFindNearestRefuellingPoint,
    maximumFuelRange,
    withinFuelRange,
    withinFuelRangeAndRefuel,
    withinFuelRangeAndRefuelAt,
} from './movement';
import {
    assignRetrofitMission,
    assignScrapMission,
    calculateSpareAnnualRevenueComplete,
    designCalculateMaintenanceCosts,
    determineHabitatsBeingMinedIncludingBuildingMiningStations,
    procureConstructionComponentsAtBuiltObject,
} from './construction/empireConstruction';
import { assignRepairMission } from './construction/repair';
import { determineFuelRequired, setupRefuelling } from './logistics/refuel';
import { findAbandonedShipsInDebrisField } from './events';
import { assignLoadTroopsMission, checkAssignGarrisonTroopsAtPenalColonyMission, checkAssignUnloadTroopsAtColonyNeedingThemMissionShip } from './combat/troopsRuntime';
import { identifyDeficientEmpireResources } from './industry';
import { addChainMigrationDestinations, addChainMigrationSources, spawnRefugeeFlows } from './scenario/emergent/demographics';
import { removeQuarantinedDestinations } from './scenario/security/registry';
import {
    HabitatPrioritization,
    calculateCurrentCompleteResourceValue,
    calculateCurrentStrategicResourceValue,
    checkConstructionShipAndMiningStationCanSurviveStorms,
    checkEmpireTerritoryCanBuildAtHabitat,
    checkInStorm,
    checkNearPirateBase,
    checkWhetherHabitatIsDangerous,
    determineHabitatsBuildingMiningStations,
    habitatPrioritizationIndexOf,
} from './resourceTargets';
import { canBuiltObjectColonizeHabitat, type ConstructionQueue } from './construction/constructionQueue';
import { AdvisorMessageType, checkTaskAuthorized, getAmbassadorsForEmpire, type RefCount } from './diplomacyTick';
import {
    annualStateMaintenance,
    annualTaxRevenue,
    annualTroopMaintenance,
    calculateSupportCost,
    canBuildBuiltObject,
    checkEmpireHasHyperDriveTech,
    currentPrivateForceStructure,
    getPrivateFunds,
    privateAnnualRevenue,
} from './forceStructure';
import { estimatedDefensiveForceRequired } from './troops';
import { conditionCheckLimit } from './tick/builtObjectTick';
import { REAL_SECONDS_IN_GALACTIC_YEAR, galaxyStarDate } from './tick/simTime';
import { canBuildDesign, findNewestCanBuild, findNewestPlanetDestroyer } from './designGeneration';
import { MINIMUM_DISTANCE_BETWEEN_BASES, analyzeNewResearchFacilities, habitatCompareTo, checkResearchStationAtLocation, checkResourceSupplyMeetsExpected, checkSystemOwnership, fastFindNearestSpacePort } from './stationPlacement';
import { checkAlreadyHaveMiningStationAtHabitat, checkForeignBaseAtHabitat } from './missions/cmdConstruction';
import { SystemVisibilityStatus, determineGalaxyLocationsInRangeAtPoint } from './visibility';
import { canEmpireColonizeHabitat, canEmpireColonizeHabitatRange, checkRuinsHaveBenefit, habitatResourcesHaveSuperLuxury, ruinAwaitsPlayerDecision } from './exploration';
import { RuinType } from './ruins';
import { DiplomaticRelationType, obtainDiplomaticRelation } from './diplomacy';
import { PirateRelationType, obtainPirateRelation } from './pirateRelations';
import { addResortIncome, determineEmpiresAtWarWith, performPrivateTransaction } from './treasury';
import { CharacterEventType, CharacterSkillType, doCharacterEventForList, empireLeader, getHighestSkillLevel, getHighestSkillLevelExcludeLeaders, stellarObjectCharacters, type Character } from './characters';
import { colonyIncomeFactor, pirateEmpireById, smugglingIncomeFactor } from './missions/cmdDocking';
import { PirateIncomeType } from './pirates/pirateEconomy';
import { OrderType, SECTOR_SIZE, applyCorruptionToIncome, empireCreateOrder } from './logistics/orders';
import { Contract, performFinancialTransaction } from './logistics/contracts';
import { calculateMinimumLuxuryResourceLevel, calculateMinimumLuxuryResourceLevelRestricted, calculateResourceLevelHabitat } from './logistics/colonySupply';
import { Cargo, CargoList, ResourceRef } from './cargo';
import { Population, PopulationList } from './population';
import { ColonyPopulationPolicy } from './data/policy';
import { ComponentCategoryType } from './data/policies';
import { ShipDesignFocus } from './researchSystem';
import { LazyNetSortOrder, netSort } from './netSort';
import { GalaxyLocationType, type GalaxyLocation } from './galaxyLocation';
import { ForceStructureProjectionList } from './forceStructureProjection';
import type { ManufacturingQueue } from './manufacturingQueue';
import { determineColonizationValue } from './tradeItems';
import { baconSettings } from './data/baconSettings';
import { scenarioEmit, scenarioQuery } from './scenario/hooks';

// ---------------------------------------------------------------------------------------------------------------
// Galaxy statics (Galaxy.3.cs 4996-5033) and Bacon settings used here.
// ---------------------------------------------------------------------------------------------------------------

/** Galaxy.3.cs 4996 HabitatColonizationThreshhold. */
export const HABITAT_COLONIZATION_THRESHHOLD = 5;
/** Galaxy.3.cs 4997 MiningStationResourceThreshhold. */
export const MINING_STATION_RESOURCE_THRESHHOLD = 10;
/** Galaxy.3.cs 5023 MiningStationResourceTransportThreshhold. */
export const MINING_STATION_RESOURCE_TRANSPORT_THRESHHOLD = 1000;
/** Galaxy.3.cs 5024 ColonyResourceTransportThreshhold. */
export const COLONY_RESOURCE_TRANSPORT_THRESHHOLD = 300;
/** Galaxy.3.cs 5033 MaximumConstructionQueueWaitTimeYears. */
export const MAXIMUM_CONSTRUCTION_QUEUE_WAIT_TIME_YEARS = 2.5;

/** System.Drawing.Point as the C# uses it here: Point.Empty is (0, 0) and IsEmpty tests exactly that. */
export interface Point {
    x: number;
    y: number;
}
const POINT_EMPTY: Point = { x: 0, y: 0 };
function pointIsEmpty(p: Point): boolean {
    return p.x === 0 && p.y === 0;
}

// ---------------------------------------------------------------------------------------------------------------
// PrioritizedTarget.cs / PrioritizedTargetList.cs
// ---------------------------------------------------------------------------------------------------------------

export type PrioritizedTargetObject = Habitat | BuiltObject | ShipGroup;

/** PrioritizedTarget.cs. */
export class PrioritizedTarget {
    private _priority: number; // int
    private _locationStrength = 0; // int
    private _weightedPriority: number; // int
    private _habitat: Habitat | null = null;
    private _builtObject: BuiltObject | null = null;
    private _shipGroup: ShipGroup | null = null;
    private _distanceFromAttackingEmpire = 100000.0;

    /** PrioritizedTarget(Habitat | BuiltObject | ShipGroup, int priority). */
    constructor(target: PrioritizedTargetObject, priority: number) {
        if (isHabitat(target)) this._habitat = target;
        else if (isBuiltObject(target)) this._builtObject = target;
        else this._shipGroup = target;
        this._priority = priority;
        this._locationStrength = 0;
        this._weightedPriority = this._priority;
    }

    /** ResolveTargetCoordinates(out x, out y). */
    resolveTargetCoordinates(): Point {
        if (this._habitat !== null) return { x: this._habitat.xpos, y: this._habitat.ypos };
        if (this._builtObject !== null) return { x: this._builtObject.xpos, y: this._builtObject.ypos };
        if (this._shipGroup === null || this._shipGroup.leadShip === null) return { x: 0.0, y: 0.0 };
        return { x: this._shipGroup.leadShip.xpos, y: this._shipGroup.leadShip.ypos };
    }

    /** Target (Habitat, else ShipGroup, else BuiltObject). */
    get target(): PrioritizedTargetObject | null {
        if (this._habitat !== null) return this._habitat;
        return this._shipGroup !== null ? this._shipGroup : this._builtObject;
    }

    get empire(): Empire | null {
        if (this._habitat !== null) return this._habitat.owner;
        return this._shipGroup !== null ? this._shipGroup.empire : this._builtObject!.empire;
    }

    get priority(): number {
        return this._priority;
    }
    set priority(value: number) {
        this._priority = value;
        if (this._locationStrength > 0) this._weightedPriority = Math.trunc(this._priority / this._locationStrength);
        else this._weightedPriority = this._priority;
    }

    /** Galaxy.4.cs 3545 CalculateDistanceFactor(distance) = Max(1e9, distance^1.8) / 1e9. */
    private calculateWeightedPriority(): void {
        const distanceFactor = Math.max(1000000000.0, Math.pow(this._distanceFromAttackingEmpire, 1.8)) / 1000000000.0;
        this._weightedPriority = Math.max(1, Math.trunc(this._priority / distanceFactor));
    }

    get distanceFromAttackingEmpire(): number {
        return this._distanceFromAttackingEmpire;
    }
    set distanceFromAttackingEmpire(value: number) {
        this._distanceFromAttackingEmpire = value;
        this.calculateWeightedPriority();
    }

    get locationStrength(): number {
        return this._locationStrength;
    }
    set locationStrength(value: number) {
        this._locationStrength = value;
        this.calculateWeightedPriority();
    }

    get weightedPriority(): number {
        return this._weightedPriority;
    }

    /** CompareTo: WeightedPriority.CompareTo. */
    compareTo(other: PrioritizedTarget): number {
        return this._weightedPriority < other._weightedPriority ? -1 : this._weightedPriority > other._weightedPriority ? 1 : 0;
    }
}

/** PrioritizedTargetList.Add: skipped when an entry already has the same Target. */
export function prioritizedTargetListAdd(list: PrioritizedTarget[], prioritizedTarget: PrioritizedTarget): void {
    for (const existing of list) {
        if (existing.target === prioritizedTarget.target) return;
    }
    list.push(prioritizedTarget);
}

/** List<PrioritizedTarget>.Sort() (.NET introsort on CompareTo). */
export function sortPrioritizedTargets(list: PrioritizedTarget[]): void {
    netSort(list, (a, b) => a.compareTo(b));
}

/** Empire._ColonizationTargets entries (HabitatPrioritization: Habitat, Priority, AssignedShip). */
export interface ColonizationTarget {
    habitat: Habitat;
    priority: number;
    assignedShip?: BuiltObject | null;
}

/** HabitatPrioritizationList.IndexOf(Habitat) on the colonization list. */
function colonizationTargetIndexOf(list: readonly ColonizationTarget[], habitat: Habitat): number {
    for (let index = 0; index < list.length; ++index) {
        if (list[index].habitat === habitat) return index;
    }
    return -1;
}

// ---------------------------------------------------------------------------------------------------------------
// Small shared helpers (HabitatResourceList / BuiltObjectList / Habitat / list predicates).
// ---------------------------------------------------------------------------------------------------------------

/** HabitatResourceList.cs 241 ContainsGroup. */
function habitatResourcesContainGroup(galaxy: Galaxy, habitat: Habitat, group: ResourceGroup): boolean {
    for (const r of habitat.resources) {
        if (r != null && resourceGroupOf(galaxy.resourceSystem.resources[r.resourceId]) === group) return true;
    }
    return false;
}

/** HabitatResourceList.cs 157 HasLuxuryResources (Resource.IsLuxuryResource: Group == Luxury). */
function habitatResourcesHaveLuxury(galaxy: Galaxy, habitat: Habitat): boolean {
    return habitatResourcesContainGroup(galaxy, habitat, ResourceGroup.Luxury);
}

/** HabitatResourceList.cs 135 HasFuelResources. */
function habitatResourcesHaveFuel(galaxy: Galaxy, habitat: Habitat): boolean {
    for (const r of habitat.resources) {
        if (r != null && galaxy.resourceSystem.resources[r.resourceId].isFuel) return true;
    }
    return false;
}

/** HabitatResourceList.cs 239 ContainsId. */
function habitatResourcesContainId(habitat: Habitat, resourceId: number): boolean {
    for (const r of habitat.resources) {
        if (r != null && r.resourceId === resourceId) return true;
    }
    return false;
}

/** Empire.4.cs 4487 CheckShipCanSurviveStorms(ship). */
export function checkShipCanSurviveStorms(ship: BuiltObject | null): boolean {
    return ship !== null && ship.armorReactive >= 5;
}

/** Empire.4.cs 4496 CheckPassengerShipsCanSurviveStorms. */
export function checkPassengerShipsCanSurviveStorms(empire: Empire): boolean {
    let builtObject: BuiltObject | null = null;
    for (let num = empire.privateBuiltObjects.length - 1; num >= 0; num--) {
        builtObject = empire.privateBuiltObjects[num];
        if (builtObject.unbuiltOrDamagedComponentCount === 0 && builtObject.subRole === BuiltObjectSubRole.PassengerShip) break;
    }
    return builtObject !== null && builtObject.armorReactive >= 5;
}

/** Empire.4.cs 4550 CheckEmpireTechCanSurviveStorms: desired armor component Value2 >= 5. */
export function checkEmpireTechCanSurviveStorms(empire: Empire): boolean {
    const component = empire.research.evaluateDesiredComponentByCategory(ComponentCategoryType.Armor, ShipDesignFocus.Balanced);
    return component !== null && component.value2 >= 5;
}

/** BuiltObjectList.cs 452 CountBuiltObjectsWithTargetHabitat(habitat, subRoles). */
export function countBuiltObjectsWithTargetHabitat(list: readonly BuiltObject[], habitat: Habitat, subRoles: readonly BuiltObjectSubRole[]): number {
    let num = 0;
    for (let i = 0; i < list.length; i++) {
        const builtObject = list[i];
        if (builtObject == null) continue;
        if (builtObject.parentHabitat === habitat) {
            if (subRoles.includes(builtObject.subRole)) num++;
        } else {
            const mission = builtObjectMission(builtObject.mission);
            if (mission !== null && mission.targetHabitat !== null && mission.targetHabitat === habitat && subRoles.includes(builtObject.subRole)) num++;
        }
    }
    return num;
}

/** BuiltObjectList.cs 421/427 CountConstructionShipsBuildingPlanetDestroyers. */
function countConstructionShipsBuildingPlanetDestroyers(list: readonly BuiltObject[]): number {
    let count = 0;
    for (let i = 0; i < list.length; i++) {
        const builtObject = list[i];
        if (builtObject == null || builtObject.subRole !== BuiltObjectSubRole.ConstructionShip) continue;
        const queue = builtObject.constructionQueue as ConstructionQueue | null;
        if (queue === null || queue.constructionYards === null || queue.constructionWaitQueue === null) continue;
        if (queue.constructionWaitQueue.length > 0 && queue.constructionWaitQueue.filter((b) => b != null && b.design != null && b.design.isPlanetDestroyer).length > 0) {
            count++;
        } else if (queue.constructionYards.filter((y) => y.shipUnderConstruction !== null && y.shipUnderConstruction.design.isPlanetDestroyer).length > 0) {
            // ConstructionYardList.CountPlanetDestroyersUnderConstruction.
            count++;
        } else {
            const mission = builtObjectMission(builtObject.mission);
            if (mission !== null && mission.type === BuiltObjectMissionType.Build && mission.design !== null && mission.design.isPlanetDestroyer) count++;
        }
    }
    return count;
}

/** DockingBayList.CountDocked. */
function countDocked(bays: readonly DockingBay[]): number {
    let n = 0;
    for (const bay of bays) if (bay.dockedShip !== null) n++;
    return n;
}

/** Habitat.cs 1116/1122 CalculateScenicFactorIncludingRuinsWonders (the feature name is UI-only). */
export function calculateScenicFactorIncludingRuinsWonders(habitat: Habitat): number {
    let num = 0.0;
    if (habitat.scenicFactor > 0) num = Math.max(num, habitat.scenicFactor);
    if (habitat.ruin !== null && habitat.ruin.developmentBonus > num) num = habitat.ruin.developmentBonus;
    // TODO(port) M4i: Wonders (Habitat.Facilities with a scenic wonder bonus) are not on the TS habitat yet — the C#
    // continues with `if (Facilities != null) foreach wonder ... num = Math.Max(num, wonder.ScenicBonus)`; no facility
    // wonders are built until M4i lands, so the value the C# sees is the one above.
    return num;
}

/** Habitat.cs 5624 AcceptsPopulation(empire, race). */
export function acceptsPopulation(galaxy: Galaxy, habitat: Habitat, empire: Empire | null, race: Race | null): boolean {
    if (empire !== null && race !== null) {
        if (habitat.empire === null) return false;
        if (habitat.empire === galaxy.independentEmpire) return true;
        const dominantRace = habitat.empire.dominantRace;
        if (dominantRace !== null) {
            if (race === dominantRace) return true;
            let colonyPopulationPolicy = habitat.colonyPopulationPolicy as ColonyPopulationPolicy;
            if (race.raceFamily === dominantRace.raceFamily) colonyPopulationPolicy = habitat.colonyPopulationPolicyRaceFamily as ColonyPopulationPolicy;
            if (colonyPopulationPolicy === ColonyPopulationPolicy.Assimilate || (colonyPopulationPolicy === ColonyPopulationPolicy.Enslave && habitat.empire === empire)) return true;
            return false;
        }
    }
    return false;
}

/** Habitat.cs 5658 HasPopulationToResettle(out race, out amount). */
export function hasPopulationToResettle(habitat: Habitat): { result: boolean; race: Race | null; amount: number } {
    if ((habitat.colonyPopulationPolicyRaceFamily as ColonyPopulationPolicy) === ColonyPopulationPolicy.Resettle || (habitat.colonyPopulationPolicy as ColonyPopulationPolicy) === ColonyPopulationPolicy.Resettle) {
        let race2: Race | null = null;
        if (habitat.empire !== null) race2 = habitat.empire.dominantRace;
        if (race2 !== null && habitat.population.totalAmount > 30000000) {
            for (let i = 0; i < habitat.population.items.length; i++) {
                const population = habitat.population.items[i];
                if (population != null && population.race !== race2) {
                    let colonyPopulationPolicy = habitat.colonyPopulationPolicy as ColonyPopulationPolicy;
                    if (population.race.raceFamily === race2.raceFamily) colonyPopulationPolicy = habitat.colonyPopulationPolicyRaceFamily as ColonyPopulationPolicy;
                    if (colonyPopulationPolicy === ColonyPopulationPolicy.Resettle) {
                        return { result: true, race: population.race, amount: population.amount };
                    }
                }
            }
        }
    }
    return { result: false, race: null, amount: 0 };
}

/** PopulationList[Race] indexer: the Population entry of that race (null when absent — the C# indexer returns null too). */
function populationOfRace(list: PopulationList, race: Race): Population | null {
    for (const p of list.items) if (p.race === race) return p;
    return null;
}

/** Empire.CheckSystemExplored(int systemIndex). */
function checkSystemExplored(empire: Empire, systemIndex: number): boolean {
    return empire.visibility.checkSystemExplored(systemIndex);
}

function missionOf(bo: BuiltObject | null): BuiltObjectMission | null {
    return bo === null ? null : builtObjectMission(bo.mission);
}

/** `list.Remove(item)` (first occurrence). */
function removeFromList<T>(list: T[], item: T): boolean {
    const i = list.indexOf(item);
    if (i < 0) return false;
    list.splice(i, 1);
    return true;
}

// ---------------------------------------------------------------------------------------------------------------
// Empire.4.cs 4796 AssignShipMissions / Empire.5.cs 1361 AssignMissionsToBuiltObjectList
// ---------------------------------------------------------------------------------------------------------------

/** Empire.4.cs 4796 AssignShipMissions. Sorts Empire.Colonies in place (4816-4817). */
export function assignShipMissions(galaxy: Galaxy, empire: Empire): void {
    for (let i = 0; i < empire.colonies.length; i++) {
        empire.colonies[i].currentDefensiveForceAssigned = 0;
    }
    for (let j = 0; j < empire.builtObjects.length; j++) {
        const builtObject = empire.builtObjects[j];
        const mission = missionOf(builtObject);
        if (builtObject.role === BuiltObjectRole.Base && builtObject.parentHabitat !== null && builtObject.parentHabitat.empire === empire) {
            builtObject.parentHabitat.currentDefensiveForceAssigned += builtObject.firepowerRaw;
        } else if (mission !== null && mission.type === BuiltObjectMissionType.Patrol && mission.targetHabitat !== null) {
            mission.targetHabitat.currentDefensiveForceAssigned += builtObject.firepowerRaw;
        }
    }
    netSort(empire.colonies, habitatCompareTo);
    empire.colonies.reverse();
    for (let k = 0; k < empire.privateBuiltObjects.length; k++) {
        const builtObject2 = empire.privateBuiltObjects[k];
        if (builtObject2.isColony || builtObject2.isResourceExtractor) builtObject2.currentEscortForceAssigned = 0;
    }
    for (let l = 0; l < empire.builtObjects.length; l++) {
        const builtObject3 = empire.builtObjects[l];
        if (builtObject3.isColony || builtObject3.isResourceExtractor) builtObject3.currentEscortForceAssigned = 0;
    }
    for (let m = 0; m < empire.privateBuiltObjects.length; m++) {
        const builtObject4 = empire.privateBuiltObjects[m];
        const mission = missionOf(builtObject4);
        if (mission !== null && (mission.type === BuiltObjectMissionType.Escort || mission.type === BuiltObjectMissionType.Patrol) && mission.targetBuiltObject !== null) {
            mission.targetBuiltObject.currentEscortForceAssigned += builtObject4.firepowerRaw;
        }
    }
    for (let n = 0; n < empire.builtObjects.length; n++) {
        const builtObject5 = empire.builtObjects[n];
        const mission = missionOf(builtObject5);
        if (mission !== null && (mission.type === BuiltObjectMissionType.Escort || mission.type === BuiltObjectMissionType.Patrol) && mission.targetBuiltObject !== null) {
            mission.targetBuiltObject.currentEscortForceAssigned += builtObject5.firepowerRaw;
        }
    }
    const empireList = determineEmpiresAtWarWith(galaxy, empire).empires;
    let atWar = false;
    if (empireList.length > 0) atWar = true;
    const patrolMiningStations = resolvePrioritizedPatrolMiningStations(galaxy, empire);
    assignMissionsToBuiltObjectList(galaxy, empire, empire.builtObjects, atWar, patrolMiningStations);
    assignMissionsToBuiltObjectList(galaxy, empire, empire.privateBuiltObjects, atWar, patrolMiningStations);
}

/** Empire.5.cs 1361 AssignMissionsToBuiltObjectList(builtObjectList, atWar, patrolMiningStations). */
export function assignMissionsToBuiltObjectList(galaxy: Galaxy, empire: Empire, builtObjectList: readonly BuiltObject[], atWar: boolean, patrolMiningStations: BuiltObject[] | null): void {
    for (let i = 0; i < builtObjectList.length; i++) {
        const ship = builtObjectList[i];
        assignMissionToBuiltObject(galaxy, empire, ship, atWar, patrolMiningStations);
    }
}

/** Empire.5.cs 1331 ResolvePrioritizedPatrolMiningStations. Sets BuiltObject.SortTag. */
export function resolvePrioritizedPatrolMiningStations(galaxy: Galaxy, empire: Empire): BuiltObject[] {
    const builtObjectList: BuiltObject[] = [];
    const flag = checkEmpireHasHyperDriveTech(empire);
    for (let i = 0; i < empire.miningStations.length; i++) {
        const builtObject = empire.miningStations[i];
        if (builtObject != null && (builtObject.subRole === BuiltObjectSubRole.MiningStation || builtObject.subRole === BuiltObjectSubRole.GasMiningStation) && builtObject.parentHabitat !== null) {
            let num = 0.0;
            num = builtObject.extractionLuxury <= 0 ? calculateCurrentStrategicResourceValue(galaxy, builtObject.parentHabitat) : calculateCurrentCompleteResourceValue(galaxy, builtObject.parentHabitat);
            if (habitatResourcesHaveFuel(galaxy, builtObject.parentHabitat)) num *= 5.0;
            else if (!flag) num /= 5.0;
            num /= 50.0;
            num = Math.min(num, 60.0);
            // mod layer: miningStationPatrolPriority (19g-7 stations under herd pressure); no-op without a scenario.
            if (galaxy.scenario !== null) num = scenarioQuery(galaxy, 'miningStationPatrolPriority', num, { builtObject, empire });
            if (builtObject.currentEscortForceAssigned < Math.trunc(num)) {
                builtObject.sortTag = num;
                builtObjectList.push(builtObject);
            }
        }
    }
    // BuiltObject.2.cs 8156 CompareTo: SortTag.CompareTo.
    netSort(builtObjectList, (a, b) => (a.sortTag < b.sortTag ? -1 : a.sortTag > b.sortTag ? 1 : 0));
    builtObjectList.reverse();
    return builtObjectList;
}

// ---------------------------------------------------------------------------------------------------------------
// Empire.5.cs 1370 AssignMissionToBuiltObject(ship, atWar, patrolMiningStations)
// ---------------------------------------------------------------------------------------------------------------

/** Extraction sub-roles counted against a habitat by the mining-ship case (Empire.5.cs 1882-1885). */
const MINING_SHIP_SUB_ROLES: readonly BuiltObjectSubRole[] = [BuiltObjectSubRole.MiningShip, BuiltObjectSubRole.GasMiningShip];

/**
 * Empire.5.cs 1899-1970 / 2030-2120: the per-HabitatType switch of the mining-ship case. Every listed type tests the
 * same three (extractor, resource group) pairs — only the order of the else-if chain differs between types and between
 * the two loops, which cannot change the resulting flag — so one predicate stands in for both switches. Unlisted types
 * (stars, gas clouds, asteroids ...) leave the flag false.
 */
function extractorMatchesHabitat(galaxy: Galaxy, ship: BuiltObject, habitat: Habitat): boolean {
    switch (habitat.type) {
        case HabitatType.BarrenRock:
        case HabitatType.GasGiant:
        case HabitatType.FrozenGasGiant:
        case HabitatType.Hydrogen:
        case HabitatType.Helium:
        case HabitatType.Argon:
        case HabitatType.Ammonia:
        case HabitatType.CarbonDioxide:
        case HabitatType.Oxygen:
        case HabitatType.NitrogenOxygen:
        case HabitatType.Chlorine:
        case HabitatType.Volcanic:
        case HabitatType.Continental:
        case HabitatType.Ice:
        case HabitatType.MarshySwamp:
        case HabitatType.Ocean:
        case HabitatType.Desert:
            if (ship.extractionMine > 0 && habitatResourcesContainGroup(galaxy, habitat, ResourceGroup.Mineral)) return true;
            if (ship.extractionGas > 0 && habitatResourcesContainGroup(galaxy, habitat, ResourceGroup.Gas)) return true;
            if (ship.extractionLuxury > 0 && habitatResourcesContainGroup(galaxy, habitat, ResourceGroup.Luxury)) return true;
            return false;
        default:
            return false;
    }
}

/** Empire.5.cs 1370 AssignMissionToBuiltObject(ship, atWar, patrolMiningStations). 22 Rnd sites, in C# order. */
export function assignMissionToBuiltObject(galaxy: Galaxy, empire: Empire, ship: BuiltObject | null, atWar: boolean, patrolMiningStations: BuiltObject[] | null): void {
    const refusalCount: RefCount = { value: 0 };
    if (ship === null || ship.topSpeed <= 0 || ship.builtAt !== null || !isAiControlled(ship)) {
        return;
    }
    {
        const m = missionOf(ship);
        if (m !== null && m.type !== BuiltObjectMissionType.Undefined) return;
    }
    // 1377-1428
    if (ship.empire !== null && ship.empire !== galaxy.independentEmpire && !galaxy.pirateEmpires.includes(ship.empire)) {
        if (ship.retireForNextMission) {
            const shipGroup = shipGroupOf(ship);
            if (shipGroup !== null) {
                if (shipGroup.mission === null || shipGroup.mission.type === BuiltObjectMissionType.Undefined || shipGroup.mission.priority === BuiltObjectMissionPriority.Undefined || shipGroup.mission.priority === BuiltObjectMissionPriority.Low) {
                    leaveShipGroup(galaxy, ship);
                    if (assignScrapMission(galaxy, empire, ship)) {
                        ship.retireForNextMission = false;
                        return;
                    }
                }
            } else if (assignScrapMission(galaxy, empire, ship)) {
                ship.retireForNextMission = false;
                return;
            }
        }
        if (ship.retrofitForNextMission) {
            const shipGroup = shipGroupOf(ship);
            if (shipGroup !== null) {
                if ((shipGroup.mission === null || shipGroup.mission.type === BuiltObjectMissionType.Undefined || shipGroup.mission.priority === BuiltObjectMissionPriority.Undefined || shipGroup.mission.priority === BuiltObjectMissionPriority.Low) && assignRetrofitMission(galaxy, empire, ship)) {
                    ship.retrofitForNextMission = false;
                    return;
                }
            } else if (assignRetrofitMission(galaxy, empire, ship)) {
                ship.retrofitForNextMission = false;
                return;
            }
        }
        if (ship.repairForNextMission) {
            if (ship.damagedComponentCount > 0) {
                if (assignRepairMission(galaxy, empire, ship)) {
                    ship.repairForNextMission = false;
                    return;
                }
            } else {
                ship.repairForNextMission = false;
            }
        }
    }
    // 1429-1447
    if (ship.refuelForNextMission) {
        let flag = true;
        if (shipGroupOf(ship) !== null) {
            flag = false;
            const num = ship.currentFuel / Math.max(1.0, ship.fuelCapacity);
            if (num < 0.05) flag = true;
        }
        if (flag) {
            setupRefuelling(galaxy, ship);
            return;
        }
    }
    // 1448-1460
    if (ship.empire === null || ship.empire === galaxy.independentEmpire || galaxy.pirateEmpires.includes(ship.empire)) {
        return;
    }
    let flag2 = true;
    if (empire.dominantRace !== null) flag2 = empire.dominantRace.expanding;
    if (shipGroupOf(ship) !== null) {
        return;
    }
    const shipEmpire = ship.empire;
    switch (ship.subRole) {
        case BuiltObjectSubRole.SmallFreighter:
        case BuiltObjectSubRole.MediumFreighter:
        case BuiltObjectSubRole.LargeFreighter: {
            assignMissionFreighter(galaxy, empire, ship, shipEmpire);
            break;
        }
        case BuiltObjectSubRole.ColonyShip: {
            assignMissionColonyShip(galaxy, empire, ship, refusalCount);
            break;
        }
        case BuiltObjectSubRole.Escort:
        case BuiltObjectSubRole.Frigate:
        case BuiltObjectSubRole.Destroyer:
        case BuiltObjectSubRole.Cruiser:
        case BuiltObjectSubRole.CapitalShip:
        case BuiltObjectSubRole.Carrier: {
            assignMissionMilitary(galaxy, empire, ship, shipEmpire, atWar, patrolMiningStations);
            break;
        }
        case BuiltObjectSubRole.TroopTransport:
            // 1878-1883
            if (!checkAssignUnloadTroopsAtColonyNeedingThemMissionShip(galaxy, empire, ship) && !checkAssignGarrisonTroopsAtPenalColonyMission(galaxy, empire, ship) && ship.troops !== null && ship.troopCapacity - ship.troops.totalSize >= 100) {
                assignLoadTroopsMission(galaxy, empire, ship);
            }
            break;
        case BuiltObjectSubRole.GasMiningShip:
        case BuiltObjectSubRole.MiningShip: {
            assignMissionMiningShip(galaxy, empire, ship);
            break;
        }
        case BuiltObjectSubRole.ConstructionShip: {
            assignMissionConstructionShip(galaxy, empire, ship, flag2);
            // mod layer (19e-7): Empire.5.cs 2669, end of case ConstructionShip — the ship found no stock task.
            if (galaxy.scenario !== null && (missionOf(ship) === null || missionOf(ship)!.type === BuiltObjectMissionType.Undefined)) scenarioEmit(galaxy, 'constructionShipIdle', { empire, ship });
            break;
        }
        case BuiltObjectSubRole.PassengerShip: {
            assignMissionPassengerShip(galaxy, empire, ship, flag2);
            break;
        }
        case BuiltObjectSubRole.ExplorationShip: {
            assignMissionExplorationShip(galaxy, empire, ship, shipEmpire);
            break;
        }
        case BuiltObjectSubRole.ResupplyShip:
            break;
    }
}

/** Empire.5.cs 1462-1573 case SmallFreighter / MediumFreighter / LargeFreighter. Rnd: NextDouble, Next(0, colonies), Next(0, mining stations). */
function assignMissionFreighter(galaxy: Galaxy, empire: Empire, ship: BuiltObject, shipEmpire: Empire): void {
    let num5 = Math.fround(1);
    if (empire.freighters != null) {
        num5 = Math.fround(Math.fround(Math.max(1, empire.freighters.length)) / Math.fround(Math.max(1, empire.empireOrderCount)));
    }
    let num6 = 0.67;
    if (ship.warpSpeed > 0) num6 = 0.33;
    num6 /= Math.sqrt(Math.max(0.25, num5));
    num6 = Math.max(0.25, Math.min(0.8, num6));
    let flag4 = false;
    if (galaxy.rnd.nextDouble() > num6) flag4 = true;
    let flag5 = false;
    if (flag4) {
        let num7 = 0;
        const habitatList: Habitat[] = [];
        const habitatList2: Habitat[] = [];
        for (let k = 0; k < empire.spacePorts.length; k++) {
            const builtObject3 = empire.spacePorts[k];
            if (builtObject3 != null && builtObject3.isSpacePort && builtObject3.parentHabitat !== null) {
                habitatList2.push(builtObject3.parentHabitat);
            }
        }
        for (let l = 0; l < empire.colonies.length; l++) {
            const item = empire.colonies[l];
            if (!habitatList2.includes(item)) habitatList.push(item);
        }
        num7 = galaxy.rnd.next(0, habitatList.length);
        for (let m = num7; m < habitatList.length; m++) {
            if (checkColonyForResourceClearance(galaxy, empire, ship, habitatList[m])) {
                flag5 = true;
                break;
            }
        }
        if (!flag5) {
            for (let n = 0; n < num7; n++) {
                if (checkColonyForResourceClearance(galaxy, empire, ship, habitatList[n])) {
                    flag5 = true;
                    break;
                }
            }
        }
        if (!flag5) {
            // Empire.3.cs 16 IdentifyDeficientEmpireResources() → (includeLuxuryResources: false, 0.0).
            const empireDeficientResources = identifyDeficientEmpireResources(galaxy, empire, false, 0.0).map((r) => r.resourceId);
            num7 = galaxy.rnd.next(0, empire.miningStations.length);
            for (let num8 = num7; num8 < empire.miningStations.length; num8++) {
                const builtObject4 = empire.miningStations[num8];
                if (builtObject4 != null && builtObject4.isSpacePort && builtObject4.isResourceExtractor && checkMiningStationForResourceClearance(galaxy, empire, ship, builtObject4, empireDeficientResources)) {
                    flag5 = true;
                    break;
                }
            }
            if (!flag5) {
                for (let num9 = 0; num9 < num7; num9++) {
                    const builtObject5 = empire.miningStations[num9];
                    if (builtObject5 != null && builtObject5.isSpacePort && builtObject5.isResourceExtractor && checkMiningStationForResourceClearance(galaxy, empire, ship, builtObject5, empireDeficientResources)) {
                        flag5 = true;
                        break;
                    }
                }
            }
        }
    }
    {
        const m = missionOf(ship);
        if (flag5 || (m !== null && m.type !== BuiltObjectMissionType.Undefined)) return;
    }
    let stellarObject2: StellarObject | null = fastFindNearestColony(galaxy, Math.trunc(ship.xpos), Math.trunc(ship.ypos), shipEmpire, 0);
    if (stellarObject2 === null) return;
    let num10 = galaxy.calculateDistance(ship.xpos, ship.ypos, stellarObject2.xpos, stellarObject2.ypos);
    let num11 = SECTOR_SIZE * 2.5;
    if (ship.warpSpeed <= 0) {
        const stellarObject3 = findNearestStationaryStellarObject(galaxy, ship.xpos, ship.ypos, shipEmpire);
        num11 = 2000.0;
        if (stellarObject3 !== null) {
            num10 = galaxy.calculateDistance(ship.xpos, ship.ypos, stellarObject3.xpos, stellarObject3.ypos);
            stellarObject2 = stellarObject3;
        }
    }
    if (num10 > num11 && stellarObject2 !== null && withinFuelRange(galaxy, ship, stellarObject2.xpos, stellarObject2.ypos, 0.0)) {
        assignMission(galaxy, ship, BuiltObjectMissionType.Move, stellarObject2, null, BuiltObjectMissionPriority.Normal);
    }
}

/** Empire.5.cs 1574-1616 case ColonyShip. No Rnd. Sorts Empire._ColonizationTargets in place. */
function assignMissionColonyShip(galaxy: Galaxy, empire: Empire, ship: BuiltObject, refusalCount: RefCount): void {
    if (empire.dominantRace === null || !empire.dominantRace.expanding) return;
    const targets = empire.colonizationTargets as ColonizationTarget[];
    netSort(targets, (a, b) => (a.priority < b.priority ? -1 : a.priority > b.priority ? 1 : 0));
    targets.reverse();
    for (let num12 = 0; num12 < targets.length; num12++) {
        const habitatPrioritization = targets[num12];
        const assignedShip = habitatPrioritization.assignedShip ?? null;
        if (assignedShip !== null) {
            if (assignedShip.builtAt === null || assignedShip === ship) continue;
            if (
                canBuiltObjectColonizeHabitat(galaxy, empire, ship, habitatPrioritization.habitat).result &&
                habitatPrioritization.priority >= HABITAT_COLONIZATION_THRESHHOLD &&
                empire.determineColonizeLowQualityHabitat(habitatPrioritization.habitat) &&
                withinFuelRange(galaxy, ship, habitatPrioritization.habitat.xpos, habitatPrioritization.habitat.ypos, 0.0) &&
                empire.controlColonization === AutomationLevel.FullyAutomated
            ) {
                if (habitatPrioritization.assignedShip != null) {
                    const m = missionOf(habitatPrioritization.assignedShip);
                    if (m !== null) m.clear();
                }
                assignMission(galaxy, ship, BuiltObjectMissionType.Colonize, habitatPrioritization.habitat, null, BuiltObjectMissionPriority.Normal);
                habitatPrioritization.assignedShip = ship;
                break;
            }
        } else if (
            canBuiltObjectColonizeHabitat(galaxy, empire, ship, habitatPrioritization.habitat).result &&
            habitatPrioritization.priority >= HABITAT_COLONIZATION_THRESHHOLD &&
            empire.determineColonizeLowQualityHabitat(habitatPrioritization.habitat) &&
            withinFuelRange(galaxy, ship, habitatPrioritization.habitat.xpos, habitatPrioritization.habitat.ypos, 0.0) &&
            checkColonizingHabitat(empire, habitatPrioritization.habitat) === null &&
            checkTaskAuthorized(galaxy, empire, empire.controlColonization, refusalCount, generateAutomationMessageColonization(galaxy, habitatPrioritization.habitat, ship, null), habitatPrioritization.habitat, AdvisorMessageType.Colonization, null, ship, null)
        ) {
            assignMission(galaxy, ship, BuiltObjectMissionType.Colonize, habitatPrioritization.habitat, null, BuiltObjectMissionPriority.Normal);
            habitatPrioritization.assignedShip = ship;
            break;
        }
    }
}

/**
 * Empire.10.cs 3646 GenerateAutomationMessageColonization(newColony, colonyShip, colonyShipBuildLocation).
 * TODO(port) M9 (UI): the TextResolver strings ("Automation Colonization Existing Ship" / "New Ship") are UI text; the
 * message only feeds the player's advisor prompt, so the names are joined without the localized template.
 */
function generateAutomationMessageColonization(galaxy: Galaxy, newColony: Habitat, colonyShip: BuiltObject | null, colonyShipBuildLocation: Habitat | null): string {
    const habitat = galaxy.determineHabitatSystemStar(newColony);
    let result = '';
    if (colonyShip !== null) {
        result = `${newColony.name} ${habitat.name} ${colonyShip.name}`;
    } else if (colonyShipBuildLocation !== null) {
        const habitat2 = galaxy.determineHabitatSystemStar(colonyShipBuildLocation);
        result = `${newColony.name} ${habitat.name} ${colonyShipBuildLocation.name} ${habitat2.name}`;
    }
    return result;
}

/** Empire.4.cs 4776 CheckColonizingHabitat(habitat). */
export function checkColonizingHabitat(empire: Empire, habitat: Habitat): BuiltObject | null {
    let result: BuiltObject | null = null;
    for (let i = 0; i < empire.builtObjects.length; i++) {
        const builtObject = empire.builtObjects[i];
        const m = missionOf(builtObject);
        if (builtObject.subRole === BuiltObjectSubRole.ColonyShip && m !== null && m.type === BuiltObjectMissionType.Colonize && m.targetHabitat === habitat) {
            result = builtObject;
            break;
        }
    }
    return result;
}

/**
 * Empire.5.cs 1617-1877 case Escort / Frigate / Destroyer / Cruiser / CapitalShip / Carrier.
 * Rnd: Next(0, 2) [planet destroyer], Next(0, habitats), Next(0, 2) + Next(0, dangerous), Next(0, 2) [troops],
 * Next(0, 8), Next(0, colonies) (patrol).
 */
function assignMissionMilitary(galaxy: Galaxy, empire: Empire, ship: BuiltObject, shipEmpire: Empire, atWar: boolean, patrolMiningStations: BuiltObject[] | null): void {
    if (ship.isPlanetDestroyer && shipGroupOf(ship) === null) {
        if (galaxy.rnd.next(0, 2) === 1) {
            const habitat12 = fastFindNearestColony(galaxy, Math.trunc(ship.xpos), Math.trunc(ship.ypos), shipEmpire, 0);
            if (habitat12 !== null) {
                const p = galaxy.selectRelativeParkingPoint(250.0);
                assignMission(galaxy, ship, BuiltObjectMissionType.Move, habitat12, null, BuiltObjectMissionPriority.Low, { x: p.x, y: p.y });
            }
            return;
        }
        const habitat13 = findNearestUncolonizedExploredSystem(galaxy, ship.xpos, ship.ypos, shipEmpire);
        if (habitat13 !== null) {
            let habitat14: Habitat | null = null;
            // Empire.5.cs 1646 Systems[].Habitats — the C# list excludes the star (Galaxy.6.cs 4611 DetermineHabitatsInSystem).
            const habitats = galaxy.systemHabitatsOf(habitat13.systemIndex);
            if (habitats != null && habitats.length > 0) {
                habitat14 = habitats[galaxy.rnd.next(0, habitats.length)];
            }
            if (habitat14 !== null) {
                const p = galaxy.selectRelativeParkingPoint(250.0);
                assignMission(galaxy, ship, BuiltObjectMissionType.Move, habitat14, null, BuiltObjectMissionPriority.Low, { x: p.x, y: p.y });
            }
        }
        return;
    }
    if (empire.dangerousHabitats != null && empire.dangerousHabitats.length > 0 && galaxy.rnd.next(0, 2) === 1) {
        const index = galaxy.rnd.next(0, empire.dangerousHabitats.length);
        const habitat15 = empire.dangerousHabitats[index];
        if (habitat15 != null && withinFuelRangeAndRefuel(galaxy, ship, habitat15.xpos, habitat15.ypos, 0.1) && checkMilitaryShipWelcomeAtTerritoryLocation(galaxy, habitat15.xpos, habitat15.ypos, shipEmpire)) {
            const starDate = galaxyStarDate(galaxy) + Math.trunc(REAL_SECONDS_IN_GALACTIC_YEAR * 0.25 * 1000.0);
            assignMission(galaxy, ship, BuiltObjectMissionType.MoveAndWait, habitat15, null, BuiltObjectMissionPriority.Normal, { x: -2000000001.0, y: -2000000001.0, starDate, allowReprocessing: false });
            removeFromList(empire.dangerousHabitats, habitat15);
            return;
        }
    }
    if (empire.independentColonyTargets.length > 0) {
        for (let num51 = 0; num51 < empire.independentColonyTargets.length; num51++) {
            const habitatPrioritization4 = empire.independentColonyTargets[num51];
            const h = habitatPrioritization4.habitat;
            if (habitatPrioritization4.assignedShip === null && h !== null && checkMilitaryShipWelcomeAtTerritoryLocation(galaxy, h.xpos, h.ypos, shipEmpire) && withinFuelRangeAndRefuel(galaxy, ship, h.xpos, h.ypos, 0.1)) {
                const starDate2 = galaxyStarDate(galaxy) + Math.trunc(REAL_SECONDS_IN_GALACTIC_YEAR * 0.5 * 1000.0);
                assignMission(galaxy, ship, BuiltObjectMissionType.MoveAndWait, h, null, BuiltObjectMissionPriority.Low, { x: -2000000001.0, y: -2000000001.0, starDate: starDate2, allowReprocessing: false });
                habitatPrioritization4.assignedShip = ship;
                return;
            }
        }
    }
    if (empire.empiresToAttack.length > 0) {
        const habitat16 = fastFindNearestColony(galaxy, Math.trunc(ship.xpos), Math.trunc(ship.ypos), empire.empiresToAttack[0], 100);
        if (habitat16 !== null && checkSystemExplored(empire, habitat16.systemIndex) && withinFuelRangeAndRefuel(galaxy, ship, habitat16.xpos, habitat16.ypos, 0.1)) {
            assignMission(galaxy, ship, BuiltObjectMissionType.Move, habitat16, null, BuiltObjectMissionPriority.Normal);
            return;
        }
    }
    if (!empire.reclusive && ship.troops !== null && ship.troopCapacity - ship.troops.totalSize >= 100 && galaxy.rnd.next(0, 2) === 1 && assignLoadTroopsMission(galaxy, empire, ship)) {
        return;
    }
    let num52 = galaxy.rnd.next(0, 8);
    if ((ship.subRole === BuiltObjectSubRole.Cruiser || ship.subRole === BuiltObjectSubRole.CapitalShip || ship.subRole === BuiltObjectSubRole.Carrier) && num52 < 3) {
        num52 = 4;
    }
    const flag15 = checkEmpireHasHyperDriveTech(empire);
    if (!flag15) num52 = 4;
    if (atWar) {
        num52 += 2;
        num52 = Math.min(num52, 7);
    }
    switch (num52) {
        case 0:
        case 1:
        case 2: {
            // 1716-1760 escort a colony ship / construction ship / resource extractor.
            const tryEscort = (list: readonly BuiltObject[], pick: (b: BuiltObject) => boolean, sizeDivisor: number): boolean => {
                for (let i = 0; i < list.length; i++) {
                    const b = list[i];
                    const m = missionOf(b);
                    if (pick(b) && m !== null && m.type !== BuiltObjectMissionType.Undefined && b.currentEscortForceAssigned < Math.trunc(b.size / sizeDivisor) && b !== ship && withinFuelRangeAndRefuel(galaxy, ship, b.xpos, b.ypos, 0.1) && (ship.warpSpeed > 0 || b.warpSpeed <= 0)) {
                        const point = m.resolveTargetCoordinates(m);
                        if (checkMilitaryShipWelcomeAtTerritoryLocation(galaxy, point.x, point.y, shipEmpire)) {
                            assignMission(galaxy, ship, BuiltObjectMissionType.Escort, b, null, BuiltObjectMissionPriority.Normal);
                            b.currentEscortForceAssigned += ship.firepowerRaw;
                            return true;
                        }
                    }
                }
                return false;
            };
            // Each C# loop `break`s only out of its own for; the next loop still runs (a second Escort assignment is
            // blocked by nothing but the target checks) — kept as three sequential loops.
            tryEscort(empire.builtObjects, (b) => b.isColony, 50);
            tryEscort(empire.builtObjects, (b) => b.subRole === BuiltObjectSubRole.ConstructionShip, 10);
            tryEscort(empire.resourceExtractors as BuiltObject[], (b) => b.isResourceExtractor, 50);
            break;
        }
        case 3:
        case 4:
        case 5:
        case 6:
        case 7: {
            const m = missionOf(ship);
            if (m !== null && m.type === BuiltObjectMissionType.Patrol) break;
            let flag16 = false;
            const tryPatrolStation = (b: BuiltObject | null): boolean => {
                if (b != null && b.currentEscortForceAssigned < Math.trunc(b.sortTag) && withinFuelRangeAndRefuel(galaxy, ship, b.xpos, b.ypos, 0.1) && checkMilitaryShipWelcomeAtTerritoryLocation(galaxy, b.xpos, b.ypos, shipEmpire)) {
                    assignMission(galaxy, ship, BuiltObjectMissionType.Patrol, b, null, BuiltObjectMissionPriority.Low);
                    b.currentEscortForceAssigned += ship.firepowerRaw;
                    return true;
                }
                return false;
            };
            const tryPatrolColony = (h: Habitat | null): boolean => {
                if (h != null && h.currentDefensiveForceAssigned < estimatedDefensiveForceRequired(galaxy, h, atWar, galaxy.difficultyLevel) && withinFuelRangeAndRefuel(galaxy, ship, h.xpos, h.ypos, 0.1)) {
                    assignMission(galaxy, ship, BuiltObjectMissionType.Patrol, h, null, BuiltObjectMissionPriority.Low);
                    h.currentDefensiveForceAssigned += ship.firepowerRaw;
                    return true;
                }
                return false;
            };
            if (flag15) {
                if (patrolMiningStations === null) patrolMiningStations = resolvePrioritizedPatrolMiningStations(galaxy, empire);
                for (let num53 = 0; num53 < patrolMiningStations.length; num53++) {
                    if (tryPatrolStation(patrolMiningStations[num53])) {
                        flag16 = true;
                        break;
                    }
                }
                if (flag16) break;
                const num54 = galaxy.rnd.next(0, empire.colonies.length);
                for (let num55 = num54; num55 < empire.colonies.length; num55++) {
                    if (tryPatrolColony(empire.colonies[num55])) {
                        flag16 = true;
                        break;
                    }
                }
                if (flag16) break;
                for (let num56 = 0; num56 < num54; num56++) {
                    if (tryPatrolColony(empire.colonies[num56])) break;
                }
                break;
            }
            const num57 = galaxy.rnd.next(0, empire.colonies.length);
            for (let num58 = num57; num58 < empire.colonies.length; num58++) {
                if (tryPatrolColony(empire.colonies[num58])) {
                    flag16 = true;
                    break;
                }
            }
            if (!flag16) {
                for (let num59 = 0; num59 < num57; num59++) {
                    if (tryPatrolColony(empire.colonies[num59])) {
                        flag16 = true;
                        break;
                    }
                }
            }
            if (flag16) break;
            if (patrolMiningStations === null) patrolMiningStations = resolvePrioritizedPatrolMiningStations(galaxy, empire);
            for (let num60 = 0; num60 < patrolMiningStations.length; num60++) {
                if (tryPatrolStation(patrolMiningStations[num60])) {
                    flag16 = true;
                    break;
                }
            }
            break;
        }
    }
}

/** Empire.5.cs 1884-2128 case GasMiningShip / MiningShip. No Rnd. */
function assignMissionMiningShip(galaxy: Galaxy, empire: Empire, ship: BuiltObject): void {
    const flag6 = checkShipCanSurviveStorms(ship);
    const subRoles = MINING_SHIP_SUB_ROLES;
    if (empire.empireResourceTargets != null && empire.empireResourceTargets.length > 0) {
        let flag7 = false;
        let num13 = 0;
        const iterationCount = { count: 0 };
        for (; conditionCheckLimit(!flag7 && num13 < empire.empireResourceTargets.length, 1000, iterationCount); num13++) {
            if (!ship.isResourceExtractor) continue;
            const habitat4 = empire.empireResourceTargets[num13].habitat!;
            if (!flag6 && checkInStorm(galaxy, habitat4.xpos, habitat4.ypos)) continue;
            flag7 = extractorMatchesHabitat(galaxy, ship, habitat4);
            if (!flag7) continue;
            if (withinFuelRangeAndRefuel(galaxy, ship, habitat4.xpos, habitat4.ypos, 0.1)) {
                const num14 = countBuiltObjectsWithTargetHabitat(empire.privateBuiltObjects, habitat4, subRoles);
                if (num14 < 3) {
                    assignMission(galaxy, ship, BuiltObjectMissionType.ExtractResources, habitat4, null, BuiltObjectMissionPriority.Normal);
                    empire.empireResourceTargets.splice(num13, 1);
                }
            } else {
                flag7 = false;
            }
        }
    }
    {
        const m = missionOf(ship);
        if ((m !== null && m.type !== BuiltObjectMissionType.Undefined) || empire.resourceTargets == null || empire.resourceTargets.length <= 0) return;
    }
    let flag8 = false;
    let num15 = 0;
    const iterationCount2 = { count: 0 };
    for (; conditionCheckLimit(!flag8 && num15 < empire.resourceTargets.length, 1000, iterationCount2); num15++) {
        const habitatPrioritization2 = empire.resourceTargets[num15];
        const ph = habitatPrioritization2.habitat!;
        if (!ship.isResourceExtractor || checkNearPirateBase(galaxy, empire, ph, Math.trunc(MAX_SOLAR_SYSTEM_SIZE * 2.1), ph.xpos, ph.ypos, null) || (!flag6 && checkInStorm(galaxy, ph.xpos, ph.ypos))) {
            continue;
        }
        const habitat5 = empire.resourceTargets[num15].habitat;
        if (habitat5 === null || checkAlreadyHaveMiningStationAtHabitat(habitat5, empire)) continue;
        flag8 = extractorMatchesHabitat(galaxy, ship, habitat5);
        if (!flag8) continue;
        if (withinFuelRangeAndRefuel(galaxy, ship, habitat5.xpos, habitat5.ypos, 0.1)) {
            const num16 = countBuiltObjectsWithTargetHabitat(empire.privateBuiltObjects, habitat5, subRoles);
            if (num16 < 3) {
                assignMission(galaxy, ship, BuiltObjectMissionType.ExtractResources, habitat5, null, BuiltObjectMissionPriority.Normal);
            }
        } else {
            flag8 = false;
        }
    }
}

/**
 * Empire.5.cs 2129-2669 case ConstructionShip.
 * Rnd: Next(0, 2) [debris field], Next(0, 2) + Next(0, all ships) [repair], Next(0, 2) / Next(0, 4) [research
 * priority], Next(0, asteroids) x<=20 [research at star], Next(0, 2) [resort], Next(0, 2) [monitoring].
 */
function assignMissionConstructionShip(galaxy: Galaxy, empire: Empire, ship: BuiltObject, flag2: boolean): void {
    if (flag2) {
        if (empire.policy!.buildPlanetDestroyers) {
            const design = findNewestPlanetDestroyer(empire.designs);
            if (design !== null && canBuildDesign(empire, design)) {
                const constructionShips = empire.constructionShips as BuiltObject[];
                const num17 = countConstructionShipsBuildingPlanetDestroyers(constructionShips);
                const num18 = Math.min(5, Math.max(2, Math.trunc(constructionShips.length * 0.3)));
                if (num17 < num18) {
                    const rp = galaxy.selectRelativePoint(2000000.0);
                    const habitat6 = findNearestLonelyHabitat(galaxy, empire.capital!.xpos + rp.x, empire.capital!.ypos + rp.y, empire);
                    if (habitat6 !== null) {
                        const p = galaxy.selectRelativeParkingPoint(Math.max(200.0, habitat6.diameter * 0.7));
                        assignMission(galaxy, ship, BuiltObjectMissionType.Build, habitat6, null, BuiltObjectMissionPriority.High, { design, x: p.x, y: p.y });
                        return;
                    }
                }
            }
        }
        let galaxyLocation = checkWhetherAtLocation(empire, ship.xpos, ship.ypos);
        if (galaxyLocation !== null && galaxyLocation.type === GalaxyLocationType.DebrisField && galaxy.rnd.next(0, 2) === 1) {
            if (galaxyLocation === null) {
                for (let num19 = 0; num19 < empire.visibility.knownGalaxyLocations.length; num19++) {
                    if (empire.visibility.knownGalaxyLocations[num19].type === GalaxyLocationType.DebrisField) {
                        galaxyLocation = empire.visibility.knownGalaxyLocations[num19];
                        break;
                    }
                }
            }
            if (galaxyLocation !== null) {
                const builtObject6 = selectBestSalvageableShip(galaxy, galaxyLocation);
                if (builtObject6 !== null && withinFuelRangeAndRefuel(galaxy, ship, builtObject6.xpos, builtObject6.ypos, 0.1)) {
                    assignMission(galaxy, ship, BuiltObjectMissionType.Build, null, builtObject6, BuiltObjectMissionPriority.High, { x: builtObject6.xpos, y: builtObject6.ypos });
                    return;
                }
            }
        }
        // GalaxyLocationList.FindLocations(PlanetDestroyer).
        const galaxyLocationList = empire.visibility.knownGalaxyLocations.filter((l) => l.type === GalaxyLocationType.PlanetDestroyer);
        if (galaxyLocationList.length > 0) {
            for (let num20 = 0; num20 < galaxyLocationList.length; num20++) {
                // GalaxyLocation.RelatedBuiltObject: the unfinished planet destroyer (set by cmdConstruction.ts, BuiltObject.2.cs 1601).
                const relatedBuiltObject = galaxyLocationList[num20].relatedBuiltObject;
                if (relatedBuiltObject == null || relatedBuiltObject.unbuiltComponentCount <= 0 || relatedBuiltObject.builtAt !== null || relatedBuiltObject.empire !== null || relatedBuiltObject.hasBeenDestroyed) {
                    continue;
                }
                let flag12 = false;
                const constructionShips = empire.constructionShips as BuiltObject[];
                for (let num21 = 0; num21 < constructionShips.length; num21++) {
                    const builtObject7 = constructionShips[num21];
                    const m = missionOf(builtObject7);
                    if (m !== null && (m.type === BuiltObjectMissionType.Build || m.type === BuiltObjectMissionType.BuildRepair || m.type === BuiltObjectMissionType.Repair) && m.secondaryTargetBuiltObject === relatedBuiltObject) {
                        flag12 = true;
                        break;
                    }
                }
                if (!flag12 && withinFuelRangeAndRefuel(galaxy, ship, relatedBuiltObject.xpos, relatedBuiltObject.ypos, 0.1)) {
                    assignMission(galaxy, ship, BuiltObjectMissionType.Build, null, relatedBuiltObject, BuiltObjectMissionPriority.High, { x: relatedBuiltObject.xpos, y: relatedBuiltObject.ypos });
                    return;
                }
            }
        }
    }
    const builtObjectList2: BuiltObject[] = [];
    builtObjectList2.push(...empire.builtObjects);
    builtObjectList2.push(...empire.privateBuiltObjects);
    if (galaxy.rnd.next(0, 2) === 1) {
        const num22 = galaxy.rnd.next(0, builtObjectList2.length);
        for (let num23 = num22; num23 < builtObjectList2.length; num23++) {
            const builtObject8 = builtObjectList2[num23];
            if (determineWhetherShouldRepair(galaxy, empire, ship, builtObject8) && withinFuelRangeAndRefuel(galaxy, ship, builtObject8.xpos, builtObject8.ypos, 0.1)) {
                assignMission(galaxy, ship, BuiltObjectMissionType.BuildRepair, null, builtObject8, BuiltObjectMissionPriority.Normal);
                return;
            }
        }
        for (let num24 = 0; num24 < num22; num24++) {
            const builtObject9 = builtObjectList2[num24];
            if (determineWhetherShouldRepair(galaxy, empire, ship, builtObject9) && withinFuelRangeAndRefuel(galaxy, ship, builtObject9.xpos, builtObject9.ypos, 0.1)) {
                assignMission(galaxy, ship, BuiltObjectMissionType.BuildRepair, null, builtObject9, BuiltObjectMissionPriority.Normal);
                return;
            }
        }
    }
    if (empire.researchHabitats != null && empire.researchHabitats.length > 0) {
        let flag13 = false;
        if (empire.policy!.researchPriority < 1.0) {
            if (galaxy.rnd.next(0, 2) === 1) flag13 = true;
        } else if (empire.policy!.researchPriority === 1.0) {
            if (galaxy.rnd.next(0, 4) > 0) flag13 = true;
        } else if (empire.policy!.researchPriority > 1.0) {
            flag13 = true;
        }
        if (flag13) {
            const analysis = analyzeNewResearchFacilities(empire);
            let design2 = analysis.result;
            if (design2 !== null) {
                let industryType = IndustryType.Undefined;
                if (design2.subRole === BuiltObjectSubRole.WeaponsResearchStation) industryType = IndustryType.Weapon;
                else if (design2.subRole === BuiltObjectSubRole.EnergyResearchStation) industryType = IndustryType.Energy;
                else if (design2.subRole === BuiltObjectSubRole.HighTechResearchStation) industryType = IndustryType.HighTech;
                const num25 = calculateSupportCost(galaxy, empire, design2);
                const num26 = design2.calculateCurrentPurchasePrice(galaxy);
                if (num26 <= empire.stateMoney && num25 <= calculateSpareAnnualRevenueComplete(galaxy, empire)) {
                    let habitat7: Habitat | null = null;
                    for (let num27 = 0; num27 < empire.researchHabitats.length; num27++) {
                        const rh = empire.researchHabitats[num27];
                        if (rh.researchBonusIndustry === industryType && withinFuelRangeAndRefuel(galaxy, ship, rh.xpos, rh.ypos, 0.0)) {
                            habitat7 = rh;
                            break;
                        }
                    }
                    if (habitat7 !== null && withinFuelRangeAndRefuel(galaxy, ship, habitat7.xpos, habitat7.ypos, 0.0)) {
                        const num28 = Math.fround(Math.fround(habitat7.researchBonus) / Math.fround(100));
                        switch (habitat7.researchBonusIndustry) {
                            case IndustryType.Weapon:
                                if (num28 > empire.researchBonusWeapons) design2 = analysis.weaponsResearchStation;
                                break;
                            case IndustryType.Energy:
                                if (num28 > empire.researchBonusEnergy) design2 = analysis.energyResearchStation;
                                break;
                            case IndustryType.HighTech:
                                if (num28 > empire.researchBonusHighTech) design2 = analysis.highTechResearchStation;
                                break;
                        }
                        let x3: number;
                        let y3: number;
                        if (habitat7.category === HabitatCategoryType.Star) {
                            let num29 = 0.0;
                            let habitat8: Habitat | null = null;
                            for (let num30 = 0; num30 < galaxy.asteroidFields.length; num30++) {
                                const habitatList3 = galaxy.asteroidFields[num30];
                                if (habitatList3.length <= 0 || habitatList3[0].parent !== habitat7) continue;
                                let num31 = 0;
                                while (habitat8 === null && num31 < 20) {
                                    habitat8 = habitatList3[galaxy.rnd.next(0, habitatList3.length)];
                                    const builtObject10 = galaxy.findNearestBuiltObject(Math.trunc(habitat8.xpos), Math.trunc(habitat8.ypos), BuiltObjectRole.Base);
                                    if (builtObject10 !== null) {
                                        const num32 = galaxy.calculateDistance(habitat8.xpos, habitat8.ypos, builtObject10.xpos, builtObject10.ypos);
                                        if (num32 < 200.0) habitat8 = null;
                                    }
                                    num31++;
                                }
                            }
                            if (habitat8 !== null) {
                                habitat7 = habitat8;
                                const p = galaxy.selectRelativeHabitatSurfacePoint(habitat7);
                                x3 = p.x;
                                y3 = p.y;
                            } else {
                                num29 = habitat7.diameter;
                                if (habitat7.type === HabitatType.BlackHole) num29 = habitat7.diameter * 0.7;
                                else if (habitat7.type === HabitatType.SuperNova) num29 = habitat7.diameter * 0.1;
                                else if (habitat7.type === HabitatType.Neutron) num29 = habitat7.diameter * 2.0;
                                const p = galaxy.selectRelativeParkingPoint(num29);
                                x3 = p.x;
                                y3 = p.y;
                            }
                        } else {
                            const p = galaxy.selectRelativeHabitatSurfacePoint(habitat7);
                            x3 = p.x;
                            y3 = p.y;
                        }
                        if (!checkResearchStationAtLocation(galaxy, habitat7)) {
                            let flag14 = false;
                            const designList = checkBasesToBeBuiltAtHabitat(empire, habitat7);
                            if (designList != null && designList.length > 0) {
                                for (let num33 = 0; num33 < designList.length; num33++) {
                                    if (designList[num33].subRole === BuiltObjectSubRole.EnergyResearchStation || designList[num33].subRole === BuiltObjectSubRole.HighTechResearchStation || designList[num33].subRole === BuiltObjectSubRole.WeaponsResearchStation) {
                                        flag14 = true;
                                        break;
                                    }
                                }
                            }
                            removeFromList(empire.researchHabitats, habitat7);
                            if (!flag14) {
                                assignMission(galaxy, ship, BuiltObjectMissionType.Build, habitat7, null, BuiltObjectMissionPriority.Normal, { design: design2, x: x3, y: y3 });
                                return;
                            }
                        }
                    }
                }
            }
        }
    }
    const habitatList4 = determineHabitatsBeingMinedIncludingBuildingMiningStations(galaxy, empire, false);
    if (empire.resourceTargets != null && empire.resourceTargets.length > 0 && buildStrategicResourceSupply(galaxy, empire, ship, habitatList4)) {
        return;
    }
    if (empire.resortBaseBuildLocations != null && empire.resortBaseBuildLocations.length > 0 && empire.policy!.engageInTourism && flag2 && galaxy.rnd.next(0, 2) === 1) {
        let num34 = Math.min(20, 1 + Math.trunc(empire.colonies.length / 6));
        num34 = Math.trunc(num34 * empire.policy!.tourismPriority);
        if (empire.resortBases.length < num34) {
            const design3 = findNewestCanBuild(empire.designs, BuiltObjectSubRole.ResortBase, empire);
            if (design3 !== null) {
                const num35 = calculateSupportCost(galaxy, empire, design3);
                const num36 = design3.calculateCurrentPurchasePrice(galaxy);
                if (num36 <= empire.stateMoney && num35 <= calculateSpareAnnualRevenueComplete(galaxy, empire) && assignBuildResortBaseMissionToBuiltObject(galaxy, empire, ship, design3)) {
                    return;
                }
            }
        }
    }
    if (empire.monitoringHabitats != null && empire.monitoringPoints != null && (empire.monitoringHabitats.length > 0 || empire.monitoringPoints.length > 0)) {
        const design4 = findNewestCanBuild(empire.designs, BuiltObjectSubRole.MonitoringStation, empire);
        if (design4 !== null && galaxy.rnd.next(0, 2) === 1) {
            const num37 = calculateSupportCost(galaxy, empire, design4);
            const num38 = design4.calculateCurrentPurchasePrice(galaxy);
            if (num38 <= empire.stateMoney && num37 <= calculateSpareAnnualRevenueComplete(galaxy, empire)) {
                const num39 = Math.min(40, Math.max(1, Math.trunc(empire.colonies.length / 3)));
                if (empire.longRangeScanners.length < num39) {
                    if (empire.monitoringHabitats.length > empire.monitoringPoints.length) {
                        let habitat9: Habitat | null = null;
                        for (let num40 = 0; num40 < empire.monitoringHabitats.length; num40++) {
                            const habitat10 = empire.monitoringHabitats[num40];
                            if (!withinFuelRangeAndRefuel(galaxy, ship, habitat10.xpos, habitat10.ypos, 0.0)) continue;
                            let num41 = Number.MAX_VALUE;
                            const builtObject11 = fastFindNearestLongRangeScannerBase(galaxy, Math.trunc(habitat10.xpos), Math.trunc(habitat10.ypos), empire);
                            if (builtObject11 !== null) {
                                num41 = galaxy.calculateDistance(habitat10.xpos, habitat10.ypos, builtObject11.xpos, builtObject11.ypos);
                            }
                            if (num41 > MAX_SOLAR_SYSTEM_SIZE * 2.1) {
                                const designList2 = checkBasesToBeBuiltAtHabitat(empire, habitat10);
                                if (designList2 == null || designList2.length <= 0) {
                                    habitat9 = habitat10;
                                    break;
                                }
                            }
                        }
                        if (habitat9 !== null) {
                            let x4: number;
                            let y4: number;
                            if (habitat9.category === HabitatCategoryType.Star) {
                                const p = galaxy.selectRelativeParkingPoint(habitat9.diameter);
                                x4 = p.x;
                                y4 = p.y;
                            } else {
                                const p = galaxy.selectRelativeHabitatSurfacePoint(habitat9);
                                x4 = p.x;
                                y4 = p.y;
                            }
                            let builtObject12 = galaxy.findNearestBuiltObject(Math.trunc(habitat9.xpos + x4), Math.trunc(habitat9.ypos + y4), BuiltObjectRole.Base);
                            let num42 = Number.MAX_VALUE;
                            if (builtObject12 !== null) {
                                num42 = galaxy.calculateDistance(habitat9.xpos + x4, habitat9.ypos + y4, builtObject12.xpos, builtObject12.ypos);
                            }
                            let num43 = 0;
                            while (num42 < MINIMUM_DISTANCE_BETWEEN_BASES) {
                                const p = galaxy.selectRelativeHabitatSurfacePoint(habitat9);
                                x4 = p.x;
                                y4 = p.y;
                                builtObject12 = galaxy.findNearestBuiltObject(Math.trunc(habitat9.xpos + x4), Math.trunc(habitat9.ypos + y4), BuiltObjectRole.Base);
                                // The C# dereferences builtObject12 unguarded (it was non-null to enter the loop and a base still exists).
                                num42 = builtObject12 !== null ? galaxy.calculateDistance(habitat9.xpos + x4, habitat9.ypos + y4, builtObject12.xpos, builtObject12.ypos) : Number.MAX_VALUE;
                                num43++;
                                if (num43 > 5) break;
                            }
                            assignMission(galaxy, ship, BuiltObjectMissionType.Build, habitat9, null, BuiltObjectMissionPriority.Normal, { design: design4, x: x4, y: y4 });
                            removeFromList(empire.monitoringHabitats, habitat9);
                            return;
                        }
                    } else {
                        let item2: Point | null = null; // Point.Empty
                        for (let num44 = 0; num44 < empire.monitoringPoints.length; num44++) {
                            const point = empire.monitoringPoints[num44];
                            if (withinFuelRangeAndRefuel(galaxy, ship, point.x, point.y, 0.0)) {
                                let num45 = Number.MAX_VALUE;
                                const builtObject13 = fastFindNearestLongRangeScannerBase(galaxy, point.x, point.y, empire);
                                if (builtObject13 !== null) {
                                    num45 = galaxy.calculateDistance(point.x, point.y, builtObject13.xpos, builtObject13.ypos);
                                }
                                if (num45 > MAX_SOLAR_SYSTEM_SIZE * 2.1) {
                                    item2 = point;
                                    break;
                                }
                            }
                        }
                        if (item2 !== null && !pointIsEmpty(item2)) {
                            // C# oddity (Empire.5.cs 2555-2556): the mission goes to _MonitoringPoints[0] while item2 is the point removed.
                            assignMission(galaxy, ship, BuiltObjectMissionType.Build, null, null, BuiltObjectMissionPriority.Normal, { design: design4, x: empire.monitoringPoints[0].x, y: empire.monitoringPoints[0].y });
                            removeFromList(empire.monitoringPoints, item2);
                            return;
                        }
                    }
                }
            }
        }
    }
    if (!flag2 || empire.resourceTargets == null || empire.resourceTargets.length <= 0) return;
    let stellarObject4: StellarObject | null = fastFindNearestSpacePort(galaxy, ship.xpos, ship.ypos, empire);
    if (stellarObject4 === null) {
        stellarObject4 = empire.pirateEmpireBaseHabitat !== null ? empire.pirateEmpireBaseHabitat : empire.capital;
    }
    const privateAnnualCashflow = getPrivateAnnualCashflow(galaxy, empire);
    let num46 = 0;
    let design5: Design | null = null;
    const iterationCount3 = { count: 0 };
    for (; conditionCheckLimit(design5 === null && num46 < empire.resourceTargets.length, 1000, iterationCount3); num46++) {
        const habitatPrioritization3 = empire.resourceTargets[num46];
        const habitat11 = empire.resourceTargets[num46].habitat!;
        if (habitatList4.includes(habitat11) || (habitat11.empire !== null && habitat11.empire !== galaxy.independentEmpire) || !habitatResourcesHaveLuxury(galaxy, habitat11) || stellarObject4 === null || !distanceWithinRange(galaxy, ship, stellarObject4.xpos, stellarObject4.ypos, habitat11.xpos, habitat11.ypos, 0.1)) {
            continue;
        }
        if (habitatResourcesContainGroup(galaxy, habitat11, ResourceGroup.Gas)) design5 = findNewestCanBuild(empire.designs, BuiltObjectSubRole.GasMiningStation, empire);
        if (habitatResourcesContainGroup(galaxy, habitat11, ResourceGroup.Mineral)) design5 = findNewestCanBuild(empire.designs, BuiltObjectSubRole.MiningStation, empire);
        if (design5 === null && habitatResourcesContainGroup(galaxy, habitat11, ResourceGroup.Luxury)) design5 = findNewestCanBuild(empire.designs, BuiltObjectSubRole.MiningStation, empire);
        if (design5 === null) continue;
        const num47 = designCalculateMaintenanceCosts(galaxy, design5, empire);
        const num48 = design5.calculateCurrentPurchasePrice(galaxy);
        if (!(empire.privateMoney > num48) || !(privateAnnualCashflow > num47) || habitatPrioritization3.priority <= MINING_STATION_RESOURCE_THRESHHOLD || checkNearPirateBase(galaxy, empire, habitat11, Math.trunc(MAX_SOLAR_SYSTEM_SIZE * 2.1), habitat11.xpos, habitat11.ypos, null)) {
            continue;
        }
        let p = galaxy.selectRelativeHabitatSurfacePoint(habitat11);
        let x5 = p.x;
        let y5 = p.y;
        let builtObject14 = galaxy.findNearestBuiltObject(Math.trunc(habitat11.xpos + x5), Math.trunc(habitat11.ypos + y5), BuiltObjectRole.Base);
        let num49 = Number.MAX_VALUE;
        if (builtObject14 !== null) {
            num49 = galaxy.calculateDistance(habitat11.xpos + x5, habitat11.ypos + y5, builtObject14.xpos, builtObject14.ypos);
        }
        let num50 = 0;
        while (num49 < MINIMUM_DISTANCE_BETWEEN_BASES) {
            p = galaxy.selectRelativeHabitatSurfacePoint(habitat11);
            x5 = p.x;
            y5 = p.y;
            builtObject14 = galaxy.findNearestBuiltObject(Math.trunc(habitat11.xpos + x5), Math.trunc(habitat11.ypos + y5), BuiltObjectRole.Base);
            num49 = builtObject14 !== null ? galaxy.calculateDistance(habitat11.xpos + x5, habitat11.ypos + y5, builtObject14.xpos, builtObject14.ypos) : Number.MAX_VALUE;
            num50++;
            if (num50 > 5) break;
        }
        assignMission(galaxy, ship, BuiltObjectMissionType.Build, habitat11, null, BuiltObjectMissionPriority.Normal, { design: design5, x: x5, y: y5 });
        habitatList4.push(habitat11);
        empire.resourceTargets.splice(num46, 1);
    }
}

/** Empire.5.cs 2670-2695 case PassengerShip. Rnd: Next(0, 2), Next(0, 3) (short-circuit order as in the C#). */
function assignMissionPassengerShip(galaxy: Galaxy, empire: Empire, ship: BuiltObject, flag2: boolean): void {
    let flag9 = false;
    let flag10 = false;
    if (empire.migrationDestinations != null && empire.migrationSources != null && empire.migrationDestinations.length > 0 && empire.migrationSources.length > 0 && flag2) flag9 = true;
    if (empire.tourismDestinations != null && empire.tourismSources != null && empire.tourismDestinations.length > 0 && empire.tourismSources.length > 0 && empire.policy!.engageInTourism && flag2) flag10 = true;
    if ((!flag9 || (flag10 && galaxy.rnd.next(0, 2) !== 1) || !assignMigrationMissionToBuiltObject(galaxy, empire, ship)) && flag10) {
        let flag11 = false;
        if ((!flag9 || galaxy.rnd.next(0, 3) > 0) && assignTourismMissionToBuiltObject(galaxy, empire, ship)) {
            flag11 = true;
        } else if (!flag11 && flag9 && !assignMigrationMissionToBuiltObject(galaxy, empire, ship)) {
            // (empty in the C#)
        }
    }
}

/** Empire.5.cs 2696-2799 case ExplorationShip. Rnd: Next(0, 10) [ruins/locations] plus the draws inside the searches. */
function assignMissionExplorationShip(galaxy: Galaxy, empire: Empire, ship: BuiltObject, shipEmpire: Empire): void {
    if (empire.systemScouts === null) empire.systemScouts = [];
    let num2 = Math.max(1, Math.trunc(empire.explorationShipCount * 0.38));
    if (empire.explorationShipCount <= 1) num2 = 0;
    const builtObjectList: (BuiltObject | null)[] = [];
    for (let i = 0; i < empire.systemScouts.length; i++) {
        const builtObject = empire.systemScouts[i];
        if (builtObject == null || builtObject.hasBeenDestroyed || !builtObject.isFunctional || builtObject.topSpeed <= 0 || builtObject.warpSpeed <= 0 || !isAiControlled(builtObject)) {
            builtObjectList.push(builtObject);
        } else if (builtObject != null && empire.systemScouts.length - builtObjectList.length > num2) {
            builtObjectList.push(builtObject);
        }
    }
    for (let j = 0; j < builtObjectList.length; j++) {
        const builtObject2 = builtObjectList[j];
        if (builtObject2 != null) removeFromList(empire.systemScouts, builtObject2);
    }
    if (empire.systemScouts.length < num2 && !empire.systemScouts.includes(ship) && ship != null && !ship.hasBeenDestroyed && ship.isFunctional && ship.topSpeed > 0 && ship.warpSpeed > 0 && isAiControlled(ship)) {
        empire.systemScouts.push(ship);
    }
    let location: Point = POINT_EMPTY;
    if (empire.systemScouts.includes(ship)) {
        const num3 = empire.systemExploredCount / galaxy.starCount;
        if (num3 > 0.015 && num3 < 0.4 && empire.explorationShipCount > 1) {
            const r = findNextSystemToScout(galaxy, empire, ship);
            const habitat = r.habitat;
            location = r.location;
            if (!pointIsEmpty(location)) {
                if (withinFuelRangeAndRefuel(galaxy, ship, location.x, location.y, 0.0)) {
                    assignMission(galaxy, ship, BuiltObjectMissionType.Move, null, null, BuiltObjectMissionPriority.Normal, { x: location.x, y: location.y });
                    missionOf(ship)?.addCommandToEnd(new Command(CommandAction.ReassignMission));
                    return;
                }
            } else if (habitat !== null && withinFuelRangeAndRefuel(galaxy, ship, habitat.xpos, habitat.ypos, 0.0)) {
                assignMission(galaxy, ship, BuiltObjectMissionType.Move, habitat, null, BuiltObjectMissionPriority.Normal);
                missionOf(ship)?.addCommandToEnd(new Command(CommandAction.ReassignMission));
                return;
            }
        }
    }
    let flag3 = false;
    location = POINT_EMPTY;
    const r2 = findNextHabitatToExplore(galaxy, ship.xpos, ship.ypos, shipEmpire, ship);
    const habitat2 = r2.habitat;
    location = r2.location;
    if (!pointIsEmpty(location)) {
        if (withinFuelRangeAndRefuel(galaxy, ship, location.x, location.y, 0.0)) {
            assignMission(galaxy, ship, BuiltObjectMissionType.Move, null, null, BuiltObjectMissionPriority.Normal, { x: location.x, y: location.y });
            flag3 = true;
        }
    } else if (habitat2 !== null && withinFuelRangeAndRefuel(galaxy, ship, habitat2.xpos, habitat2.ypos, 0.0)) {
        assignMission(galaxy, ship, BuiltObjectMissionType.Explore, habitat2, null, BuiltObjectMissionPriority.Normal);
        flag3 = true;
    }
    if (habitat2 === null && pointIsEmpty(location) && galaxy.rnd.next(0, 10) === 1) {
        const r3 = findUnexploredRuinsOrLocations(galaxy, ship.xpos, ship.ypos, shipEmpire);
        const habitat3 = r3.habitat;
        const location2 = r3.location;
        if (habitat3 !== null) {
            assignMission(galaxy, ship, BuiltObjectMissionType.Move, habitat3, null, BuiltObjectMissionPriority.Normal);
            flag3 = true;
        } else if (location2 !== null) {
            const c = location2.resolveLocationCenter();
            assignMission(galaxy, ship, BuiltObjectMissionType.Move, null, null, BuiltObjectMissionPriority.Normal, { x: c.x, y: c.y });
            flag3 = true;
        }
    }
    if (flag3) return;
    const num4 = ship.currentFuel / ship.fuelCapacity;
    if (num4 < 0.9) {
        const fuelTypes = determineFuelRequired(ship);
        const stellarObject = fastFindNearestRefuellingPoint(galaxy, ship.xpos, ship.ypos, fuelTypes, empire, ship);
        if (stellarObject !== null) {
            assignMission(galaxy, ship, BuiltObjectMissionType.Refuel, stellarObject, null, BuiltObjectMissionPriority.Unavailable);
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Empire.5.cs 3955 / 4063 freighter resource clearance
// ---------------------------------------------------------------------------------------------------------------

/** Empire.5.cs 4063 CheckColonyForResourceClearance(ship, colony). No Rnd. */
function checkColonyForResourceClearance(galaxy: Galaxy, empire: Empire, ship: BuiltObject, colony: Habitat): boolean {
    const result = false;
    const cargo = colony.cargo;
    if (cargo !== null) {
        // WithinFuelRangeAndRefuel(x, y, 0.0, ship.CachedRefuellingLocation) (BuiltObject.1.cs 2490): the margin is the
        // distance to the cached refuelling point. TODO(port) M4e: BuiltObject._RefuellingLocation (CheckForRefuelling)
        // is not on the TS BuiltObject yet — null, which the C# reads as a 0 margin.
        if (!withinFuelRangeAndRefuelAt(galaxy, ship, colony.xpos, colony.ypos, 0.0, null)) {
            return false;
        }
        for (const item2 of cargo.items) {
            // Cargo.EmpireId != EmpireId || CommodityResource == null
            if ((item2.empire as Empire | null)?.empireId !== empire.empireId || !item2.commodityIsResource) continue;
            const commodityResource = item2.commodity;
            const def = galaxy.resourceSystem.resources[commodityResource.resourceId];
            const isLuxuryResource = resourceGroupOf(def) === ResourceGroup.Luxury;
            const isRestrictedResource = def.superLuxuryBonusAmount > 0;
            let num = 0;
            // Galaxy.cs 1527 CalculateResourceLevel(cargo, colony) → (resource, colony, isMiningStation: false, isIndependent: false).
            num = !isLuxuryResource
                ? item2.available - calculateResourceLevelHabitat(galaxy, commodityResource.resourceId, colony, false, false)
                : !isRestrictedResource
                  ? item2.available - calculateMinimumLuxuryResourceLevel(colony)
                  : item2.available - calculateMinimumLuxuryResourceLevelRestricted(colony);
            if (num <= COLONY_RESOURCE_TRANSPORT_THRESHHOLD) continue;
            const val = num;
            const num2 = Math.min(val, ship.cargoSpace);
            if (num2 <= 0) continue;
            let num3 = Number.MAX_VALUE;
            let builtObject: BuiltObject | null = null;
            const spacePorts = colony.empire!.spacePorts;
            for (let i = 0; i < spacePorts.length; i++) {
                const builtObject2 = spacePorts[i];
                if (builtObject2.isSpacePort && builtObject2.cargo !== null && builtObject2.cargoSpace >= Math.trunc(builtObject2.cargoCapacity / 4)) {
                    const num4 = galaxy.calculateDistanceSquared(builtObject2.xpos, builtObject2.ypos, colony.xpos, colony.ypos);
                    if (num4 < num3) {
                        num3 = num4;
                        builtObject = builtObject2;
                    }
                }
            }
            if (builtObject !== null) {
                const cargoList = new CargoList();
                cargoList.add(new Cargo(new ResourceRef(commodityResource.resourceId), num2, empire));
                item2.reserved += num2;
                const item = new Contract(colony, num2, commodityResource.resourceId, -1, empire.empireId);
                ship.contractsToFulfill.push(item);
                assignMission(galaxy, ship, BuiltObjectMissionType.Transport, colony, builtObject, BuiltObjectMissionPriority.Normal, { cargo: cargoList });
                return true;
            }
        }
        return result;
    }
    return result;
}

/** CargoList.cs 482 GetTotalUnitsAvailable(empire, HabitatResourceList) / 510 GetTotalUnits(empire). */
function cargoTotalUnitsAvailableOfHabitatResources(cargo: CargoList, empire: Empire, habitat: Habitat | null): number {
    let total = 0;
    for (const c of cargo.items) {
        if ((c.empire as Empire | null)?.empireId === empire.empireId && c.commodityIsResource && habitat !== null && habitatResourcesContainId(habitat, c.commodity.resourceId)) total += c.available;
    }
    return total;
}
function cargoTotalUnits(cargo: CargoList, empire: Empire): number {
    let total = 0;
    for (const c of cargo.items) {
        if ((c.empire as Empire | null)?.empireId === empire.empireId) total += c.amount;
    }
    return total;
}

/** Empire.5.cs 3955 CheckMiningStationForResourceClearance(ship, miningStation, empireDeficientResources). No Rnd. */
export function checkMiningStationForResourceClearance(galaxy: Galaxy, empire: Empire, ship: BuiltObject, miningStation: BuiltObject, empireDeficientResources: readonly number[]): boolean {
    if (miningStation.empire === null) return false;
    let result = false;
    if (miningStation != null && miningStation.role === BuiltObjectRole.Base && miningStation.isResourceExtractor && miningStation.subRole !== BuiltObjectSubRole.SmallSpacePort && miningStation.subRole !== BuiltObjectSubRole.MediumSpacePort && miningStation.subRole !== BuiltObjectSubRole.LargeSpacePort) {
        if (!withinFuelRangeAndRefuel(galaxy, ship, miningStation.xpos, miningStation.ypos, 0.0)) return false;
        // HabitatResourceList of the parent habitat (an empty list when there is no parent / resources).
        const habitatResources = miningStation.parentHabitat === null || miningStation.parentHabitat.resources == null ? null : miningStation.parentHabitat;
        const cargo = miningStation.cargo;
        let num = 0;
        if (cargo !== null) num = cargoTotalUnitsAvailableOfHabitatResources(cargo, empire, habitatResources);
        let num2 = MINING_STATION_RESOURCE_TRANSPORT_THRESHHOLD;
        if (cargo !== null) num2 = Math.max(num2, Math.trunc(cargoTotalUnits(miningStation.cargo!, empire) / 4));
        if (num > 0 && num >= num2) {
            let num3 = Number.MAX_VALUE;
            let builtObject: BuiltObject | null = null;
            const spacePorts = miningStation.empire.spacePorts;
            for (let i = 0; i < spacePorts.length; i++) {
                const builtObject2 = spacePorts[i];
                if (builtObject2 != null && builtObject2 !== miningStation && builtObject2.isSpacePort && builtObject2.cargo !== null && builtObject2.cargoSpace >= Math.trunc(builtObject2.cargoCapacity / 4)) {
                    const num4 = galaxy.calculateDistanceSquared(builtObject2.xpos, builtObject2.ypos, miningStation.xpos, miningStation.ypos);
                    if (num4 < num3) {
                        num3 = num4;
                        builtObject = builtObject2;
                    }
                }
            }
            if (builtObject !== null && cargo !== null) {
                const cargoList = new CargoList();
                let cargo2: Cargo | null = null;
                for (const item2 of cargo.items) {
                    if ((item2.empire as Empire | null)?.empireId === empire.empireId && item2.commodityIsResource && item2.available > 0 && habitatResources !== null && habitatResourcesContainId(habitatResources, item2.commodity.resourceId)) {
                        const num5 = empireDeficientResources.indexOf(item2.commodity.resourceId);
                        if (num5 >= 0 && num5 < 5) cargo2 = item2;
                    }
                }
                if (cargo2 !== null) {
                    const commodityResource = cargo2.commodity;
                    const num6 = Math.min(cargo2.available, ship.cargoSpace);
                    if (num6 > 0) {
                        const cargo3 = new Cargo(new ResourceRef(commodityResource.resourceId), num6, miningStation.empire);
                        cargoList.add(cargo3);
                        cargo2.reserved += num6;
                    }
                } else {
                    let num7 = ship.cargoSpace / cargoTotalUnitsAvailableOfHabitatResources(cargo, empire, habitatResources);
                    if (num7 > 1.0) num7 = 1.0;
                    for (const item3 of cargo.items) {
                        if ((item3.empire as Empire | null)?.empireId === empire.empireId && item3.commodityIsResource && habitatResources !== null && habitatResourcesContainId(habitatResources, item3.commodity.resourceId)) {
                            const commodityResource2 = item3.commodity;
                            let val = Math.trunc(item3.available * num7);
                            val = Math.min(val, item3.available);
                            if (val > 0) {
                                const cargo4 = new Cargo(new ResourceRef(commodityResource2.resourceId), val, miningStation.empire);
                                cargoList.add(cargo4);
                                item3.reserved += val;
                            }
                        }
                    }
                }
                for (let j = 0; j < cargoList.items.length; j++) {
                    const cargo5 = cargoList.items[j];
                    if (cargo5 != null) {
                        const item = new Contract(miningStation, cargo5.amount, cargo5.commodity.resourceId, -1, empire.empireId);
                        ship.contractsToFulfill.push(item);
                    }
                }
                assignMission(galaxy, ship, BuiltObjectMissionType.Transport, miningStation, builtObject, BuiltObjectMissionPriority.Normal, { cargo: cargoList });
                result = true;
            }
        }
    }
    return result;
}

// ---------------------------------------------------------------------------------------------------------------
// Empire.5.cs 2802-3400 resort bases, migration, tourism
// ---------------------------------------------------------------------------------------------------------------

/** Empire.5.cs 2802 DetermineResortBaseBuildLocations. No Rnd. */
export function determineResortBaseBuildLocations(galaxy: Galaxy, empire: Empire): PrioritizedTarget[] {
    const prioritizedTargetList: PrioritizedTarget[] = [];
    const flag = checkConstructionShipAndMiningStationCanSurviveStorms(empire);
    for (let i = 0; i < galaxy.systems.length; i++) {
        const systemInfo = galaxy.systems[i];
        if (!(systemInfo.hasScenery ?? false) || !checkSystemExplored(empire, systemInfo.systemStar.systemIndex)) continue;
        // Empire.5.cs 2815-2816: Add(SystemStar); AddRange(Habitats) — C# Habitats excludes the star (TS habitats has it at [0]).
        const habitatList: Habitat[] = [systemInfo.systemStar, ...galaxy.systemHabitatsOf(i)];
        for (let j = 0; j < habitatList.length; j++) {
            const habitat = habitatList[j];
            const num = calculateScenicFactorIncludingRuinsWonders(habitat);
            if (!(num > 0.0) || (!flag && checkInStorm(galaxy, habitat.xpos, habitat.ypos)) || !checkEmpireTerritoryCanBuildAtHabitat(galaxy, empire, habitat)) continue;
            if (habitat.category === HabitatCategoryType.Star || habitat.category === HabitatCategoryType.GasCloud) {
                let flag2 = true;
                for (let k = 0; k < empire.tourismDestinations.length; k++) {
                    const prioritizedTarget = empire.tourismDestinations[k];
                    const t = prioritizedTarget.target;
                    if (isBuiltObject(t)) {
                        if (t.nearestSystemStar === habitat) {
                            flag2 = false;
                            break;
                        }
                    }
                }
                if (determineResortBaseAtHabitat(habitat) !== null) flag2 = false;
                if (flag2) prioritizedTargetListAdd(prioritizedTargetList, new PrioritizedTarget(habitat, Math.trunc(num * 1000.0)));
            } else if ((habitat.empire === null || habitat.empire === galaxy.independentEmpire) && habitat.basesAtHabitat.filter((b) => b.subRole === BuiltObjectSubRole.ResortBase).length === 0 && !checkForeignBaseAtHabitat(habitat, empire)) {
                prioritizedTargetListAdd(prioritizedTargetList, new PrioritizedTarget(habitat, Math.trunc(num * 1000.0)));
            }
        }
    }
    return prioritizedTargetList;
}

/** Galaxy.7.cs 404 DetermineResortBaseAtHabitat. */
export function determineResortBaseAtHabitat(habitat: Habitat): BuiltObject | null {
    for (let i = 0; i < habitat.basesAtHabitat.length; i++) {
        const builtObject = habitat.basesAtHabitat[i];
        if (builtObject.subRole === BuiltObjectSubRole.ResortBase) return builtObject;
    }
    return null;
}

/** Empire.5.cs 2859 AssignBuildResortBaseMissionToBuiltObject(builtObject, resortBaseDesign). Rnd: Next(0, min(5, sources)), NextDouble per candidate. */
export function assignBuildResortBaseMissionToBuiltObject(galaxy: Galaxy, empire: Empire, builtObject: BuiltObject, resortBaseDesign: Design | null): boolean {
    if (builtObject.subRole === BuiltObjectSubRole.ConstructionShip && resortBaseDesign !== null && empire.policy!.engageInTourism && empire.resortBaseBuildLocations.length > 0 && empire.tourismSources.length > 0) {
        const maxValue = Math.min(5, empire.tourismSources.length);
        const index = galaxy.rnd.next(0, maxValue);
        const habitat = empire.tourismSources[index].target as Habitat;
        let prioritizedTarget: PrioritizedTarget | null = null;
        const habitatPrioritizationList = determineHabitatsBuildingMiningStations(empire);
        const num = SECTOR_SIZE * 3.0;
        const num2 = 0.0;
        for (let i = 0; i < 10 && i < empire.resortBaseBuildLocations.length; i++) {
            let num3 = 0.0;
            let num4 = 0.0;
            let habitat2: Habitat | null = null;
            const t = empire.resortBaseBuildLocations[i].target;
            if (isHabitat(t)) {
                habitat2 = t;
                num3 = habitat2.xpos;
                num4 = habitat2.ypos;
            }
            const num5 = galaxy.calculateDistance(num3, num4, habitat.xpos, habitat.ypos);
            if (!(num5 <= num)) continue;
            let num6 = Math.sqrt(num - num5) * empire.resortBaseBuildLocations[i].priority;
            num6 *= 0.9 + galaxy.rnd.nextDouble() * 0.2;
            if (!(num6 > num2)) continue;
            let flag = false;
            if (habitat2 !== null) {
                const num7 = habitatPrioritizationIndexOf(habitatPrioritizationList, habitat2);
                if (num7 >= 0) flag = true;
            }
            if (!flag && withinFuelRangeAndRefuel(galaxy, builtObject, num3, num4, 0.1)) {
                // C# oddity (Empire.5.cs 2897): `num6 = num2` — the best score is never raised, so the last qualifying
                // location wins.
                num6 = num2;
                prioritizedTarget = empire.resortBaseBuildLocations[i];
            }
        }
        if (prioritizedTarget !== null && isHabitat(prioritizedTarget.target)) {
            const habitat3 = prioritizedTarget.target;
            let x: number;
            let y: number;
            if (habitat3.category === HabitatCategoryType.Star) {
                let num8 = 0.0;
                num8 = habitat3.diameter;
                if (habitat3.type === HabitatType.BlackHole) num8 = habitat3.diameter * 0.7;
                else if (habitat3.type === HabitatType.SuperNova) num8 = habitat3.diameter * 0.1;
                else if (habitat3.type === HabitatType.Neutron) num8 = habitat3.diameter * 2.0;
                const p = galaxy.selectRelativeParkingPoint(num8);
                x = p.x;
                y = p.y;
            } else {
                const p = galaxy.selectRelativeHabitatSurfacePoint(habitat3);
                x = p.x;
                y = p.y;
            }
            clearPreviousMissionRequirements(galaxy, builtObject);
            assignMission(galaxy, builtObject, BuiltObjectMissionType.Build, habitat3, null, BuiltObjectMissionPriority.Normal, { design: resortBaseDesign, x, y });
            removeFromList(empire.resortBaseBuildLocations, prioritizedTarget);
            return true;
        }
    }
    return false;
}

/** Empire.5.cs 2947 AssignMigrationMissionToBuiltObject(builtObject). Rnd: Next(0, 2), Next(0, resettle) | Next(0, destinations) + NextDouble per source. */
export function assignMigrationMissionToBuiltObject(galaxy: Galaxy, empire: Empire, builtObject: BuiltObject): boolean {
    if (builtObject.subRole === BuiltObjectSubRole.PassengerShip) {
        let num = 0;
        if (empire.resettleSources.length > 0 && empire.migrationSources.length > 0 && empire.migrationDestinations.length > 0) {
            num = galaxy.rnd.next(0, 2);
        } else if (empire.migrationSources.length > 0 && empire.migrationDestinations.length > 0) {
            num = 0;
        } else if (empire.resettleSources.length > 0) {
            num = 1;
        }
        if (num === 1 && empire.resettleSources.length > 0) {
            const index = galaxy.rnd.next(0, empire.resettleSources.length);
            let habitat: Habitat | null = null;
            const t = empire.resettleSources[index].target;
            if (isHabitat(t)) habitat = t;
            if (habitat !== null && withinFuelRangeAndRefuel(galaxy, builtObject, habitat.xpos, habitat.ypos, 0.0)) {
                const r = hasPopulationToResettle(habitat);
                if (r.result) {
                    const habitat2 = determineResettleDestination(galaxy, empire, r.race!, builtObject, habitat);
                    if (habitat2 !== null) {
                        const amount2 = Math.min(builtObject.populationCapacity, r.amount);
                        const populationList = new PopulationList();
                        populationList.add(new Population(r.race!, amount2, galaxy));
                        assignMission(galaxy, builtObject, BuiltObjectMissionType.Transport, habitat, habitat2, BuiltObjectMissionPriority.Normal, { population: populationList });
                        return true;
                    }
                }
            }
        } else if (num === 0 && empire.migrationDestinations.length > 0 && empire.migrationSources.length > 0) {
            const populationList2 = new PopulationList();
            const index2 = galaxy.rnd.next(0, empire.migrationDestinations.length);
            const habitat3 = empire.migrationDestinations[index2].target as Habitat;
            let prioritizedTarget: PrioritizedTarget | null = null;
            const num2 = SECTOR_SIZE * 3.0;
            const num3 = 0.0;
            for (let i = 0; i < 10 && i < empire.migrationSources.length; i++) {
                let num4 = 0.0;
                let num5 = 0.0;
                const t = empire.migrationSources[i].target;
                if (isHabitat(t)) {
                    const habitat4 = t;
                    num4 = habitat4.xpos;
                    num5 = habitat4.ypos;
                    if (habitat4.population != null && habitat4.population.dominantRace !== null && !acceptsPopulation(galaxy, habitat3, builtObject.empire, habitat4.population.dominantRace)) continue;
                }
                if (!withinFuelRangeAndRefuel(galaxy, builtObject, num4, num5, 0.0)) continue;
                const num6 = galaxy.calculateDistance(num4, num5, habitat3.xpos, habitat3.ypos);
                if (num6 <= num2) {
                    let num7 = Math.sqrt(num2 - num6) * empire.migrationSources[i].priority;
                    num7 *= 0.75 + galaxy.rnd.nextDouble() * 0.5;
                    // C# oddity (Empire.5.cs 3021): `num7 < num3` with num3 = 0 — only a negative score (negative
                    // MigrationFactor priorities) qualifies; num7 = num3 never raises the bar.
                    if (num7 < num3) {
                        num7 = num3;
                        prioritizedTarget = empire.migrationSources[i];
                    }
                }
            }
            if (prioritizedTarget !== null && isHabitat(prioritizedTarget.target)) {
                const habitat5 = prioritizedTarget.target;
                if (habitat5 != null && habitat5.population != null && habitat5.population.items.length > 0 && habitat5.population.dominantRace !== null) {
                    const dominantRace = habitat5.population.dominantRace;
                    const amount3 = Math.min(builtObject.populationCapacity, Math.trunc(populationOfRace(habitat5.population, dominantRace)!.amount / 50));
                    populationList2.add(new Population(dominantRace, amount3, galaxy));
                    assignMission(galaxy, builtObject, BuiltObjectMissionType.Transport, habitat5, habitat3, BuiltObjectMissionPriority.Normal, { population: populationList2 });
                    return true;
                }
            }
        }
    }
    return false;
}

/** Empire.5.cs 3040 AssignTourismMissionToBuiltObject(builtObject). Rnd: Next(0, sources), NextDouble per destination. */
export function assignTourismMissionToBuiltObject(galaxy: Galaxy, empire: Empire, builtObject: BuiltObject): boolean {
    if (builtObject.subRole === BuiltObjectSubRole.PassengerShip && empire.tourismDestinations.length > 0 && empire.tourismSources.length > 0) {
        const populationList = new PopulationList();
        const index = galaxy.rnd.next(0, empire.tourismSources.length);
        const habitat = empire.tourismSources[index].target as Habitat;
        let prioritizedTarget: PrioritizedTarget | null = null;
        if (!habitat.hasBeenDestroyed) {
            const num = SECTOR_SIZE * 5.0;
            let num2 = 0.0;
            for (let i = 0; i < 50 && i < empire.tourismDestinations.length; i++) {
                let stellarObject: BuiltObject | Habitat | null = null;
                const t = empire.tourismDestinations[i].target;
                if (isBuiltObject(t)) stellarObject = t;
                else if (isHabitat(t)) stellarObject = t;
                if (stellarObject === null || !withinFuelRangeAndRefuel(galaxy, builtObject, stellarObject.xpos, stellarObject.ypos, 0.0)) continue;
                const num3 = galaxy.calculateDistance(stellarObject.xpos, stellarObject.ypos, habitat.xpos, habitat.ypos);
                if (!(num3 <= num)) continue;
                let flag = true;
                // StellarObject.DockingBays.CountDocked >= DockingBays.Count (a null DockingBays would throw in the C#;
                // a target without bays is left eligible here).
                if (stellarObject.dockingBays !== null && countDocked(stellarObject.dockingBays) >= stellarObject.dockingBays.length) flag = false;
                if (flag) {
                    let num4 = (Math.sqrt(num) - Math.sqrt(num3)) * Math.sqrt(empire.tourismDestinations[i].priority);
                    num4 *= 0.1 + galaxy.rnd.nextDouble() * 1.8;
                    if (num4 > num2) {
                        num2 = num4;
                        prioritizedTarget = empire.tourismDestinations[i];
                    }
                }
            }
            if (prioritizedTarget !== null) {
                const t = prioritizedTarget.target;
                if (isBuiltObject(t)) {
                    const builtObject2 = t;
                    if (builtObject2.isFunctional && builtObject2.populationCapacity > 0) {
                        const dominantRace = habitat.population.dominantRace;
                        if (dominantRace !== null) {
                            let val = Math.min(Math.trunc(builtObject.populationCapacity / 100), Math.trunc(populationOfRace(habitat.population, dominantRace)!.amount / 50));
                            val = Math.min(20000, val);
                            populationList.add(new Population(dominantRace, val, galaxy));
                            clearPreviousMissionRequirements(galaxy, builtObject);
                            assignMission(galaxy, builtObject, BuiltObjectMissionType.Transport, habitat, builtObject2, BuiltObjectMissionPriority.Normal, { population: populationList });
                            return true;
                        }
                    }
                } else if (isHabitat(t)) {
                    const target = t;
                    const dominantRace2 = habitat.population.dominantRace;
                    if (dominantRace2 !== null) {
                        let val2 = Math.min(Math.trunc(builtObject.populationCapacity / 100), Math.trunc(populationOfRace(habitat.population, dominantRace2)!.amount / 50));
                        val2 = Math.min(20000, val2);
                        populationList.add(new Population(dominantRace2, val2, galaxy));
                        clearPreviousMissionRequirements(galaxy, builtObject);
                        assignMission(galaxy, builtObject, BuiltObjectMissionType.Transport, habitat, target, BuiltObjectMissionPriority.Normal, { population: populationList });
                        return true;
                    }
                }
            }
        }
    }
    return false;
}

/** Empire.5.cs 3128 ReviewMigrationTourism. No Rnd. */
export function reviewMigrationTourism(galaxy: Galaxy, empire: Empire): void {
    empire.resettleSources = determineResettleSources(empire);
    empire.migrationDestinations = determineMigrationDestinations(empire);
    empire.migrationSources = determineMigrationSources(galaxy, empire);
    // mod layer (19d4 §2.9): chain migration follows the migration-link graph on top of the ported target lists.
    if (galaxy.scenario !== null) {
        addChainMigrationDestinations(galaxy, empire, empire.migrationDestinations);
        addChainMigrationSources(galaxy, empire, empire.migrationSources);
        removeQuarantinedDestinations(galaxy, empire.migrationDestinations); // 19m quarantine (flag-gated)
    }
    empire.tourismDestinations = determineTourismDestinations(galaxy, empire);
    empire.tourismSources = determineTourismSources(galaxy, empire);
    empire.resortBaseBuildLocations = determineResortBaseBuildLocations(galaxy, empire);
    // mod layer (19d4 §2.2): refugee flows start within the empire's own migration cadence, not a year later.
    if (galaxy.scenario !== null) spawnRefugeeFlows(galaxy, empire);
}

/** Empire.5.cs 3138 DetermineTourismDestinations. */
export function determineTourismDestinations(galaxy: Galaxy, empire: Empire): PrioritizedTarget[] {
    const prioritizedTargetList: PrioritizedTarget[] = [];
    if (empire.policy!.engageInTourism) {
        const flag = checkPassengerShipsCanSurviveStorms(empire);
        for (let i = 0; i < galaxy.empires.length; i++) {
            const other = galaxy.empires[i];
            const diplomaticRelation = obtainDiplomaticRelation(empire, other);
            if (other !== empire && (diplomaticRelation.type === DiplomaticRelationType.NotMet || diplomaticRelation.type === DiplomaticRelationType.War || diplomaticRelation.type === DiplomaticRelationType.TradeSanctions)) continue;
            for (let j = 0; j < other.colonies.length; j++) {
                const habitat = other.colonies[j];
                if (habitat == null || habitat.hasBeenDestroyed) continue;
                const systemStar = galaxy.determineHabitatSystemStar(habitat);
                if (!checkSystemExplored(empire, systemStar.systemIndex)) continue;
                let num = 0;
                const num2 = calculateScenicFactorIncludingRuinsWonders(habitat);
                if (num2 > 0.0) {
                    if (flag || !checkInStorm(galaxy, habitat.xpos, habitat.ypos)) num = Math.trunc(num2 * 1000.0);
                    if (num > 0) prioritizedTargetListAdd(prioritizedTargetList, new PrioritizedTarget(habitat, num));
                }
            }
            const resortBases = other.resortBases as BuiltObject[];
            for (let k = 0; k < resortBases.length; k++) {
                const builtObject = resortBases[k];
                if (!builtObject.isFunctional || builtObject.populationCapacity <= 0 || builtObject.nearestSystemStar === null || !checkSystemExplored(empire, builtObject.nearestSystemStar.systemIndex)) continue;
                let num3 = 0;
                if (builtObject.parentHabitat !== null) {
                    const num4 = calculateScenicFactorIncludingRuinsWonders(builtObject.parentHabitat);
                    if (num4 > 0.0 && (flag || !checkInStorm(galaxy, builtObject.xpos, builtObject.ypos))) num3 = Math.trunc(num4 * 1000.0);
                } else if (builtObject.nearestSystemStar.scenicFactor > 0 && (flag || !checkInStorm(galaxy, builtObject.xpos, builtObject.ypos))) {
                    num3 = Math.trunc(builtObject.nearestSystemStar.scenicFactor * 1000.0);
                }
                if (num3 > 0) prioritizedTargetListAdd(prioritizedTargetList, new PrioritizedTarget(builtObject, num3));
            }
        }
        for (let l = 0; l < galaxy.pirateEmpires.length; l++) {
            const empire2 = galaxy.pirateEmpires[l];
            if (empire2 == null || empire2.resortBases == null) continue;
            const resortBases = empire2.resortBases as BuiltObject[];
            for (let m = 0; m < resortBases.length; m++) {
                const builtObject2 = resortBases[m];
                if (builtObject2 == null || !builtObject2.isFunctional || builtObject2.populationCapacity <= 0 || builtObject2.nearestSystemStar === null || !checkSystemExplored(empire, builtObject2.nearestSystemStar.systemIndex)) continue;
                let num5 = 0;
                if (builtObject2.parentHabitat !== null) {
                    const num6 = calculateScenicFactorIncludingRuinsWonders(builtObject2.parentHabitat);
                    if (num6 > 0.0 && (flag || !checkInStorm(galaxy, builtObject2.xpos, builtObject2.ypos))) num5 = Math.trunc(num6 * 1000.0);
                } else if (builtObject2.nearestSystemStar.scenicFactor > 0 && (flag || !checkInStorm(galaxy, builtObject2.xpos, builtObject2.ypos))) {
                    num5 = Math.trunc(builtObject2.nearestSystemStar.scenicFactor * 1000.0);
                }
                if (num5 > 0) prioritizedTargetListAdd(prioritizedTargetList, new PrioritizedTarget(builtObject2, num5));
            }
        }
        sortPrioritizedTargets(prioritizedTargetList);
        prioritizedTargetList.reverse();
    }
    return prioritizedTargetList;
}

/** Empire.5.cs 3235 DetermineTourismSources. */
export function determineTourismSources(galaxy: Galaxy, empire: Empire): PrioritizedTarget[] {
    const prioritizedTargetList: PrioritizedTarget[] = [];
    for (let i = 0; i < empire.colonies.length; i++) {
        const habitat = empire.colonies[i];
        if (habitat != null && habitat.developmentLevel >= 70 && habitat.population.totalAmount >= 300000000) {
            const priority = habitat.developmentLevel * Math.trunc(habitat.population.totalAmount / 10000000);
            prioritizedTargetListAdd(prioritizedTargetList, new PrioritizedTarget(habitat, priority));
        }
    }
    if (empire.pirateEmpireBaseHabitat !== null) {
        for (let j = 0; j < galaxy.independentColonies.length; j++) {
            const habitat2 = galaxy.independentColonies[j];
            if (habitat2 != null && checkSystemExplored(empire, habitat2.systemIndex)) {
                const priority2 = habitat2.developmentLevel * Math.trunc(habitat2.population.totalAmount / 10000000);
                prioritizedTargetListAdd(prioritizedTargetList, new PrioritizedTarget(habitat2, priority2));
            }
        }
    }
    sortPrioritizedTargets(prioritizedTargetList);
    prioritizedTargetList.reverse();
    return prioritizedTargetList;
}

/** Empire.5.cs 3264 DetermineMigrationSources (sorted ascending — the priorities are negative MigrationFactors). */
export function determineMigrationSources(galaxy: Galaxy, empire: Empire): PrioritizedTarget[] {
    const prioritizedTargetList: PrioritizedTarget[] = [];
    const flag = checkPassengerShipsCanSurviveStorms(empire);
    for (let i = 0; i < galaxy.empires.length; i++) {
        const other = galaxy.empires[i];
        const diplomaticRelation = obtainDiplomaticRelation(empire, other);
        if ((other !== empire && (diplomaticRelation.type === DiplomaticRelationType.NotMet || diplomaticRelation.type === DiplomaticRelationType.War || diplomaticRelation.type === DiplomaticRelationType.TradeSanctions)) || other.dominantRace === null || !other.dominantRace.expanding) continue;
        for (let j = 0; j < other.colonies.length; j++) {
            const habitat = other.colonies[j];
            if (checkSystemExplored(empire, habitat.systemIndex) && habitat.migrationFactor < 0 && (flag || !checkInStorm(galaxy, habitat.xpos, habitat.ypos))) {
                prioritizedTargetListAdd(prioritizedTargetList, new PrioritizedTarget(habitat, Math.trunc(habitat.migrationFactor * 1000.0)));
            }
        }
    }
    for (let k = 0; k < galaxy.independentColonies.length; k++) {
        const habitat2 = galaxy.independentColonies[k];
        if (checkSystemExplored(empire, habitat2.systemIndex) && habitat2.migrationFactor < 0 && (flag || !checkInStorm(galaxy, habitat2.xpos, habitat2.ypos))) {
            prioritizedTargetListAdd(prioritizedTargetList, new PrioritizedTarget(habitat2, Math.trunc(habitat2.migrationFactor * 1000.0)));
        }
    }
    for (let l = 0; l < galaxy.pirateEmpires.length; l++) {
        const empire2 = galaxy.pirateEmpires[l];
        if (empire2 == null) continue;
        const pirateRelation = obtainPirateRelation(empire, empire2);
        if ((empire2 !== empire && pirateRelation.type !== PirateRelationType.Protection) || empire2.dominantRace === null || !empire2.dominantRace.expanding) continue;
        for (let m = 0; m < empire2.colonies.length; m++) {
            const habitat3 = empire2.colonies[m];
            if (habitat3 != null && habitat3.empire === empire2 && checkSystemExplored(empire, habitat3.systemIndex) && habitat3.migrationFactor < 0 && (flag || !checkInStorm(galaxy, habitat3.xpos, habitat3.ypos))) {
                prioritizedTargetListAdd(prioritizedTargetList, new PrioritizedTarget(habitat3, Math.trunc(habitat3.migrationFactor * 1000.0)));
            }
        }
    }
    sortPrioritizedTargets(prioritizedTargetList);
    return prioritizedTargetList;
}

/** Empire.5.cs 3326 DetermineResettleDestination → BaconEmpire.cs 1269. No Rnd. */
export function determineResettleDestination(galaxy: Galaxy, empire: Empire, race: Race, passengerShip: BuiltObject, sourceColony: Habitat): Habitat | null {
    const source: PrioritizedTarget[] = [];
    const flag = checkShipCanSurviveStorms(passengerShip);
    const num1 = maximumFuelRange(passengerShip);
    const num2 = num1 * num1;
    for (let index1 = 0; index1 < galaxy.empires.length; index1++) {
        const other = galaxy.empires[index1];
        const diplomaticRelation = obtainDiplomaticRelation(empire, other);
        if ((other === empire || (diplomaticRelation.type !== DiplomaticRelationType.NotMet && diplomaticRelation.type !== DiplomaticRelationType.War && diplomaticRelation.type !== DiplomaticRelationType.TradeSanctions)) && other.dominantRace !== null && other.dominantRace.expanding) {
            for (let index2 = 0; index2 < other.colonies.length; index2++) {
                const colony = other.colonies[index2];
                if (colony.population != null) {
                    const totalAmount = colony.population.totalAmount;
                    if (colony.maxPopulation === totalAmount) continue;
                }
                if (checkSystemExplored(empire, colony.systemIndex) && acceptsPopulation(galaxy, colony, empire, race) && (flag || !checkInStorm(galaxy, colony.xpos, colony.ypos))) {
                    const distanceSquared = galaxy.calculateDistanceSquared(colony.xpos, colony.ypos, sourceColony.xpos, sourceColony.ypos);
                    if (distanceSquared < num2) prioritizedTargetListAdd(source, new PrioritizedTarget(colony, Math.trunc(distanceSquared / 1000000.0)));
                }
            }
        }
    }
    for (let index = 0; index < galaxy.independentColonies.length; index++) {
        const independentColony = galaxy.independentColonies[index];
        if (checkSystemExplored(empire, independentColony.systemIndex) && acceptsPopulation(galaxy, independentColony, empire, race) && (flag || !checkInStorm(galaxy, independentColony.xpos, independentColony.ypos))) {
            const distanceSquared = galaxy.calculateDistanceSquared(independentColony.xpos, independentColony.ypos, sourceColony.xpos, sourceColony.ypos);
            if (distanceSquared < num2) prioritizedTargetListAdd(source, new PrioritizedTarget(independentColony, Math.trunc(distanceSquared / 1000000.0)));
        }
    }
    sortPrioritizedTargets(source);
    return source.length > 0 ? (source[0].target as Habitat) : null;
}

/** Empire.5.cs 3331 DetermineResettleSources. */
export function determineResettleSources(empire: Empire): PrioritizedTarget[] {
    const prioritizedTargetList: PrioritizedTarget[] = [];
    for (let i = 0; i < empire.colonies.length; i++) {
        const habitat = empire.colonies[i];
        if (habitat != null && habitat.empire === empire) {
            const r = hasPopulationToResettle(habitat);
            if (r.result) prioritizedTargetListAdd(prioritizedTargetList, new PrioritizedTarget(habitat, Math.trunc(r.amount / 1000000)));
        }
    }
    sortPrioritizedTargets(prioritizedTargetList);
    prioritizedTargetList.reverse();
    return prioritizedTargetList;
}

/** Empire.5.cs 3352 DetermineMigrationDestinations → BaconEmpire.cs 1317. */
export function determineMigrationDestinations(empire: Empire): PrioritizedTarget[] {
    const migrationDestinations: PrioritizedTarget[] = [];
    for (let index = 0; index < empire.colonies.length; index++) {
        const colony = empire.colonies[index];
        if (colony != null && colony.empire === empire) {
            if (colony.population != null) {
                const totalAmount = colony.population.totalAmount;
                if (colony.maxPopulation === totalAmount) continue;
            }
            if (colony.migrationFactor > 0.0) prioritizedTargetListAdd(migrationDestinations, new PrioritizedTarget(colony, Math.trunc(colony.migrationFactor * 1000.0)));
            else if (empire.penalColonies.includes(colony)) prioritizedTargetListAdd(migrationDestinations, new PrioritizedTarget(colony, 500));
        }
    }
    sortPrioritizedTargets(migrationDestinations);
    migrationDestinations.reverse();
    return migrationDestinations;
}

// ---------------------------------------------------------------------------------------------------------------
// Empire.5.cs 3357 DetermineWhetherShouldRepair / 3397 CheckTargetOfRepairMission / 1042-1075 debris field helpers
// ---------------------------------------------------------------------------------------------------------------

/** Empire.5.cs 3357 DetermineWhetherShouldRepair(repairShip, builtObject). */
export function determineWhetherShouldRepair(galaxy: Galaxy, empire: Empire, repairShip: BuiltObject, builtObject: BuiltObject): boolean {
    // Empire.5.cs 3432 CheckNearPirateBase(ship, x, y): scanRange = Max(SensorProximityArrayRange, (int)(MaxSolarSystemSize * 2.1)).
    const scanRange = Math.max(repairShip.sensorProximityArrayRange, Math.trunc(MAX_SOLAR_SYSTEM_SIZE * 2.1));
    if (builtObject.unbuiltOrDamagedComponentCount > 0 && builtObject.role === BuiltObjectRole.Base && builtObject.builtAt === null) {
        if (builtObject.parentHabitat !== null && builtObject.parentHabitat.owner === empire) return false;
        if (checkTargetOfRepairMission(empire, builtObject)) return false;
        if (checkNearPirateBase(galaxy, empire, repairShip, scanRange, builtObject.xpos, builtObject.ypos, null)) return false;
        if (!checkShipCanSurviveStorms(repairShip) && checkInStorm(galaxy, builtObject.xpos, builtObject.ypos)) return false;
        return true;
    }
    const m = missionOf(builtObject);
    if (builtObject.damagedComponentCount > 0 && builtObject.role !== BuiltObjectRole.Base && builtObject.builtAt === null && builtObject.warpSpeed <= 0 && builtObject.currentSpeed <= 0 && (m === null || m.type === BuiltObjectMissionType.Undefined)) {
        if (checkTargetOfRepairMission(empire, builtObject)) return false;
        if (checkNearPirateBase(galaxy, empire, repairShip, scanRange, builtObject.xpos, builtObject.ypos, null)) return false;
        return true;
    }
    return false;
}

/** Empire.5.cs 3397 CheckTargetOfRepairMission(target). */
export function checkTargetOfRepairMission(empire: Empire, target: BuiltObject): boolean {
    const constructionShips = empire.constructionShips as BuiltObject[];
    for (let i = 0; i < constructionShips.length; i++) {
        const builtObject = constructionShips[i];
        const m = missionOf(builtObject);
        if (m !== null) {
            if (m.type === BuiltObjectMissionType.BuildRepair && m.secondaryTargetBuiltObject === target) return true;
            if (m.type === BuiltObjectMissionType.Build && m.secondaryTargetBuiltObject === target) return true;
        }
        const subsequent = builtObjectSubsequentMissions(builtObject);
        if (subsequent == null || subsequent.length <= 0) continue;
        for (let j = 0; j < subsequent.length; j++) {
            const builtObjectMission = subsequent[j];
            if (builtObjectMission.type === BuiltObjectMissionType.BuildRepair && builtObjectMission.secondaryTargetBuiltObject === target) return true;
            if (builtObjectMission.type === BuiltObjectMissionType.Build && builtObjectMission.secondaryTargetBuiltObject === target) return true;
        }
    }
    return false;
}

/** Empire.5.cs 1042 CheckWhetherAtLocation(x, y). */
export function checkWhetherAtLocation(empire: Empire, x: number, y: number): GalaxyLocation | null {
    for (let i = 0; i < empire.visibility.knownGalaxyLocations.length; i++) {
        const l = empire.visibility.knownGalaxyLocations[i];
        const num = l.xpos - l.width / 2.0;
        const num2 = l.xpos + l.width / 2.0;
        const num3 = l.ypos - l.height / 2.0;
        const num4 = l.ypos + l.height / 2.0;
        if (x > num && x < num2 && y > num3 && y < num4) return l;
    }
    return null;
}

/** Empire.5.cs 1058 SelectBestSalvageableShip(location). */
export function selectBestSalvageableShip(galaxy: Galaxy, location: GalaxyLocation | null): BuiltObject | null {
    let builtObject: BuiltObject | null = null;
    if (location !== null && location.type === GalaxyLocationType.DebrisField) {
        const builtObjectList = findAbandonedShipsInDebrisField(galaxy, location);
        for (let i = 0; i < builtObjectList.length; i++) {
            if (builtObjectList[i].builtAt === null) {
                if (builtObject === null) builtObject = builtObjectList[i];
                else if (builtObjectList[i].size > builtObject.size) builtObject = builtObjectList[i];
            }
        }
    }
    return builtObject;
}

/** Empire.3.cs 5022 CheckBasesToBeBuiltAtHabitat(habitat). */
export function checkBasesToBeBuiltAtHabitat(empire: Empire, habitat: Habitat): Design[] {
    const designList: Design[] = [];
    const constructionShips = empire.constructionShips as BuiltObject[];
    for (let i = 0; i < constructionShips.length; i++) {
        const builtObject = constructionShips[i];
        const m = missionOf(builtObject);
        if (m !== null && m.type === BuiltObjectMissionType.Build && m.targetHabitat === habitat && m.design !== null) designList.push(m.design);
        const subsequent = builtObjectSubsequentMissions(builtObject);
        if (subsequent == null || subsequent.length <= 0) continue;
        for (let j = 0; j < subsequent.length; j++) {
            const s = subsequent[j];
            if (s != null && s.type === BuiltObjectMissionType.Build && s.targetHabitat === habitat && s.design !== null) designList.push(s.design);
        }
    }
    return designList;
}

/** Empire.6.cs 1450 BuildStrategicResourceSupply(constructionShip, empireHabitatsBeingMined). No Rnd. */
export function buildStrategicResourceSupply(galaxy: Galaxy, empire: Empire, constructionShip: BuiltObject, empireHabitatsBeingMined: Habitat[]): boolean {
    let stellarObject: StellarObject | null = fastFindNearestSpacePort(galaxy, constructionShip.xpos, constructionShip.ypos, empire);
    if (stellarObject === null) stellarObject = empire.pirateEmpireBaseHabitat !== null ? empire.pirateEmpireBaseHabitat : empire.capital;
    for (let i = 0; i < galaxy.resourceSystem.fuelResources.length; i++) {
        const resourceDefinition = galaxy.resourceSystem.fuelResources[i];
        if (resourceDefinition != null && checkResourceAssignBuild(galaxy, empire, constructionShip, resourceDefinition.resourceId, empireHabitatsBeingMined, stellarObject)) return true;
    }
    const resourceList: number[] = [];
    if (empire.pirateEmpireBaseHabitat === null && empire.dominantRace !== null && empire.dominantRace.criticalResources.length > 0) {
        // ResourceBonusList.ResolveResources: the resource ids of the race's critical resources.
        for (const bonus of empire.dominantRace.criticalResources) resourceList.push(bonus.resourceId);
    }
    for (let j = 0; j < resourceList.length; j++) {
        if (checkResourceAssignBuild(galaxy, empire, constructionShip, resourceList[j], empireHabitatsBeingMined, stellarObject)) return true;
    }
    const resourceList2 = resolveOrderedNonFuelNonCriticalResources(galaxy, resourceList);
    for (let k = 0; k < resourceList2.length; k++) {
        if (checkResourceAssignBuild(galaxy, empire, constructionShip, resourceList2[k], empireHabitatsBeingMined, stellarObject)) return true;
    }
    return false;
}

/** Empire.6.cs 1431 ResolveOrderedNonFuelNonCriticalResources(criticalResources). */
function resolveOrderedNonFuelNonCriticalResources(galaxy: Galaxy, criticalResources: readonly number[]): number[] {
    const resourceList: number[] = [];
    const ordered = galaxy.resourceSystem.strategicResourcesOrderedByRelativeImportance;
    for (let i = 0; i < ordered.length; i++) {
        const resourceDefinition = ordered[i];
        if (resourceDefinition != null && !resourceDefinition.isFuel) {
            if (!criticalResources.includes(resourceDefinition.resourceId)) resourceList.push(resourceDefinition.resourceId);
        }
    }
    return resourceList;
}

/** Empire.6.cs 1488/1493 CheckResourceAssignBuild(constructionShip, resource, empireHabitatsBeingMined, buildResourcePickupPoint[, isCriticalEmpireResource: false]). */
function checkResourceAssignBuild(galaxy: Galaxy, empire: Empire, constructionShip: BuiltObject, resourceId: number, empireHabitatsBeingMined: Habitat[], buildResourcePickupPoint: StellarObject | null): boolean {
    const habitat = checkResourceSupplyMeetsExpected(galaxy, empire, resourceId, false, empireHabitatsBeingMined);
    if (habitat !== null && buildResourcePickupPoint !== null && distanceWithinRange(galaxy, constructionShip, buildResourcePickupPoint.xpos, buildResourcePickupPoint.ypos, habitat.xpos, habitat.ypos, 0.1) && !empireHabitatsBeingMined.includes(habitat)) {
        const m = missionOf(constructionShip);
        if (constructionShip.subRole === BuiltObjectSubRole.ConstructionShip && isAiControlled(constructionShip) && constructionShip.isShipYard && (m === null || m.type === BuiltObjectMissionType.Undefined)) {
            let design: Design | null = null;
            if (habitatResourcesContainGroup(galaxy, habitat, ResourceGroup.Gas)) design = findNewestCanBuild(empire.designs, BuiltObjectSubRole.GasMiningStation, empire);
            if (habitatResourcesContainGroup(galaxy, habitat, ResourceGroup.Mineral)) design = findNewestCanBuild(empire.designs, BuiltObjectSubRole.MiningStation, empire);
            if (design === null && habitatResourcesContainGroup(galaxy, habitat, ResourceGroup.Luxury)) design = findNewestCanBuild(empire.designs, BuiltObjectSubRole.MiningStation, empire);
            if (design !== null) {
                const p = galaxy.selectRelativeHabitatSurfacePoint(habitat);
                assignMission(galaxy, constructionShip, BuiltObjectMissionType.Build, habitat, null, BuiltObjectMissionPriority.Normal, { design, x: p.x, y: p.y });
                const num = habitatPrioritizationIndexOf(empire.resourceTargets, habitat);
                if (num >= 0) empire.resourceTargets.splice(num, 1);
                empireHabitatsBeingMined.push(habitat);
                return true;
            }
        }
    }
    return false;
}

// ---------------------------------------------------------------------------------------------------------------
// Empire.5.cs 1298 ReviewIndependentColonyTargets / Empire.4.cs 4652 IdentifyColonizationTargets
// ---------------------------------------------------------------------------------------------------------------

/** Empire.5.cs 1298 ReviewIndependentColonyTargets. */
export function reviewIndependentColonyTargets(galaxy: Galaxy, empire: Empire): void {
    const habitatPrioritizationList: HabitatPrioritization[] = [];
    const habitatList = determineHabitatsBeingColonized(empire);
    for (let i = 0; i < habitatList.length; i++) {
        const habitat = habitatList[i];
        if (habitat.empire === galaxy.independentEmpire) {
            const habitatPrioritization = new HabitatPrioritization(habitat, 0);
            habitatPrioritization.assignedShip = determineShipGuarding(empire, habitat);
            habitatPrioritizationList.push(habitatPrioritization);
        }
    }
    empire.independentColonyTargets = habitatPrioritizationList;
}

/** Empire.5.cs 1316 DetermineShipGuarding(habitat). */
function determineShipGuarding(empire: Empire, habitat: Habitat): BuiltObject | null {
    for (let i = 0; i < empire.builtObjects.length; i++) {
        const builtObject = empire.builtObjects[i];
        const m = missionOf(builtObject);
        if (builtObject.role === BuiltObjectRole.Military && m !== null && m.type === BuiltObjectMissionType.MoveAndWait && m.targetHabitat === habitat) return builtObject;
    }
    return null;
}

/** Empire.4.cs 2312 DetermineHabitatsBeingColonized. */
function determineHabitatsBeingColonized(empire: Empire): Habitat[] {
    const habitatList: Habitat[] = [];
    for (let i = 0; i < empire.builtObjects.length; i++) {
        const builtObject = empire.builtObjects[i];
        const m = missionOf(builtObject);
        if (builtObject.isColony && m !== null && m.type === BuiltObjectMissionType.Colonize && m.targetHabitat !== null) {
            const targetHabitat = m.targetHabitat;
            if (!habitatList.includes(targetHabitat)) habitatList.push(targetHabitat);
        }
    }
    return habitatList;
}

/** Empire.7.cs 1544 ColonizableHabitatTypesFromColonyShips(empire, empireHabitatTypes) → 1676 ColonizableHabitatTypesForBuiltObject (NativeRace.NativeHabitatType). */
function colonizableHabitatTypesFromColonyShips(empire: Empire, empireHabitatTypes: HabitatType[]): HabitatType[] {
    for (let i = 0; i < empire.builtObjects.length; i++) {
        const builtObject = empire.builtObjects[i];
        if (builtObject.subRole !== BuiltObjectSubRole.ColonyShip) continue;
        const list: HabitatType[] = [];
        if (builtObject.nativeRace !== null && !list.includes(builtObject.nativeRace.nativeHabitatType)) list.push(builtObject.nativeRace.nativeHabitatType);
        for (const item of list) {
            if (!empireHabitatTypes.includes(item)) empireHabitatTypes.push(item);
        }
    }
    return empireHabitatTypes;
}

/** Empire.4.cs 4652 IdentifyColonizationTargets(galaxy) → (filterOutDangerousTargets: true, 1, int.MaxValue, includeLowQualityTargets: true, includeDistantTargets: false). */
export function identifyColonizationTargets(galaxy: Galaxy, empire: Empire): ColonizationTarget[] {
    return identifyColonizationTargetsFull(galaxy, empire, true, 1, 2147483647, true, false);
}

/** Empire.4.cs 4662 IdentifyColonizationTargets(galaxy, filterOutDangerousTargets, thresholdValue, maximumListSize, includeLowQualityTargets, includeDistantTargets). No Rnd. */
export function identifyColonizationTargetsFull(galaxy: Galaxy, empire: Empire, filterOutDangerousTargets: boolean, thresholdValue: number, maximumListSize: number, includeLowQualityTargets: boolean, includeDistantTargets: boolean): ColonizationTarget[] {
    let habitatPrioritizationList: ColonizationTarget[] = [];
    let design = findNewestCanBuild(empire.designs, BuiltObjectSubRole.ColonyShip, empire);
    if (design === null) design = findNewest(empire.designs, BuiltObjectSubRole.ColonyShip);
    let flag = false;
    if (filterOutDangerousTargets) flag = checkEmpireTechCanSurviveStorms(empire);
    // Race.AggressionLevel / CautionLevel: periodic levels while the race's change period is active (Race.cs 350-377).
    const num = raceAggressionLevel(galaxy, empire.dominantRace!) / 100.0;
    const num2 = raceCautionLevel(galaxy, empire.dominantRace!) / 100.0;
    const num3 = Math.trunc(2000.0 / ((num * num) / (num2 * num2)));
    let empireHabitatTypes = empire.colonizableHabitatTypesForEmpire();
    empireHabitatTypes = colonizableHabitatTypesFromColonyShips(empire, empireHabitatTypes);
    const systemVisibility = empire.systemVisibility;
    for (let i = 0; i < systemVisibility.length; i++) {
        if (!checkSystemExplored(empire, i)) continue;
        let flag2 = false;
        const sys = galaxy.systems[i];
        if (sys.dominantEmpire != null && sys.dominantEmpire.empire != null && sys.dominantEmpire.empire !== empire) flag2 = true;
        if (!flag2 && sys.systemStar != null) {
            const ownership = checkSystemOwnership(galaxy, sys.systemStar);
            if (ownership.empire !== null && ownership.empire !== empire) flag2 = true;
        }
        let flag3 = false;
        if (filterOutDangerousTargets) {
            flag3 = checkInStorm(galaxy, sys.systemStar.xpos, sys.systemStar.ypos);
            if (flag3 && flag) flag3 = false;
        }
        if (flag3) continue;
        const habitats = planetsOf(galaxy.systems[systemVisibility[i].systemStar.systemIndex]); // Empire.4.cs 4713 Systems[].Habitats: no star
        for (let j = 0; j < habitats.length; j++) {
            const habitat = habitats[j];
            if (
                (habitat.category !== HabitatCategoryType.Planet && habitat.category !== HabitatCategoryType.Moon) ||
                habitat.type === HabitatType.BarrenRock ||
                habitat.type === HabitatType.FrozenGasGiant ||
                habitat.type === HabitatType.GasGiant ||
                (!includeLowQualityTargets &&
                    !(habitat.quality >= 0.5) &&
                    (empire.resourceMap == null || !empire.resourceMap.checkResourcesKnown(habitat) || habitat.resources == null || !habitatResourcesHaveSuperLuxury(galaxy, habitat)) &&
                    (habitat.ruin === null || !habitat.ruin.playerEmpireEncountered || (!(habitat.ruin.bonusDefensive > 0.0) && !(habitat.ruin.bonusDiplomacy > 0.0) && !(habitat.ruin.bonusHappiness > 0.0) && !(habitat.ruin.bonusResearchEnergy > 0.0) && !(habitat.ruin.bonusResearchHighTech > 0.0) && !(habitat.ruin.bonusResearchWeapons > 0.0) && !(habitat.ruin.bonusWealth > 0.0))))
            ) {
                continue;
            }
            let num5 = 0.0;
            if (
                ((habitat.empire !== galaxy.independentEmpire || habitat.population == null || habitat.population.totalAmount <= 0) && !canEmpireColonizeHabitat(galaxy, empire, empire, habitat, empireHabitatTypes, design, false)) ||
                (!includeDistantTargets && !canEmpireColonizeHabitatRange(galaxy, empire, habitat)) ||
                !galaxy.checkEmpireTerritoryCanColonizeHabitat(empire, habitat) ||
                colonizationTargetIndexOf(habitatPrioritizationList, habitat) >= 0 ||
                (filterOutDangerousTargets && checkNearPirateBase(galaxy, empire, habitat, Math.trunc(MAX_SOLAR_SYSTEM_SIZE * 2.1), habitat.xpos, habitat.ypos, null))
            ) {
                continue;
            }
            const habitat2 = habitat;
            num5 = determineColonizationValue(galaxy, empire, habitat2);
            if (!(num5 >= thresholdValue)) continue;
            let flag4 = true;
            if (flag2 && filterOutDangerousTargets && num5 < num3) flag4 = false;
            if (filterOutDangerousTargets && checkWhetherHabitatIsDangerous(galaxy, empire, habitat2)) {
                flag4 = false;
                if (empire.dangerousHabitats == null) empire.dangerousHabitats = [];
                if (empire.dangerousHabitats.length < 20 && !empire.dangerousHabitats.includes(habitat2)) empire.dangerousHabitats.push(habitat2);
            }
            if (flag4) habitatPrioritizationList.push({ habitat: habitat2, priority: Math.trunc(num5), assignedShip: null });
        }
    }
    netSort(habitatPrioritizationList, (a, b) => (a.priority < b.priority ? -1 : a.priority > b.priority ? 1 : 0));
    habitatPrioritizationList.reverse();
    for (let k = 0; k < empire.builtObjects.length; k++) {
        const builtObject = empire.builtObjects[k];
        const m = missionOf(builtObject);
        if (m !== null && m.type === BuiltObjectMissionType.Colonize && m.targetHabitat !== null) {
            const targetHabitat = m.targetHabitat;
            const num6 = colonizationTargetIndexOf(habitatPrioritizationList, targetHabitat);
            if (num6 >= 0) habitatPrioritizationList[num6].assignedShip = builtObject;
        }
    }
    if (maximumListSize < 2147483647 && habitatPrioritizationList.length > maximumListSize) {
        habitatPrioritizationList = habitatPrioritizationList.slice(0, maximumListSize);
    }
    return habitatPrioritizationList;
}

// ---------------------------------------------------------------------------------------------------------------
// Empire.6.cs 741 DirectPrivateConstruction and the money helpers it needs
// ---------------------------------------------------------------------------------------------------------------

/** Empire.cs 2116 AnnualPrivateMaintenance. */
function annualPrivateMaintenance(empire: Empire): number {
    let num = 0.0;
    for (let i = 0; i < empire.privateBuiltObjects.length; i++) num += empire.privateBuiltObjects[i].annualSupportCost;
    const num2 = num * empire.shipMaintenanceSavings;
    return num - num2;
}

/** Empire.6.cs 556 GetPrivateAnnualCashflow() → (excludeRetirees: false). */
export function getPrivateAnnualCashflow(galaxy: Galaxy, empire: Empire): number {
    const gov = empireGovernmentAttributes(empire);
    if (gov !== null && gov.specialFunctionCode === 1) {
        const num = annualStateMaintenance(empire);
        const num2 = annualPrivateMaintenance(empire);
        const num3 = num + annualTroopMaintenance(empire);
        const num4 = num2;
        const taxRevenue = annualTaxRevenue(galaxy, empire);
        return taxRevenue - (num3 + num4);
    }
    let num5 = 0.0;
    num5 = annualPrivateMaintenance(empire) + annualTaxRevenue(galaxy, empire);
    return privateAnnualRevenue(galaxy, empire) - num5;
}

/** BaconBuiltObjectList.cs 14 FindShortestConstructionWaitQueue(bol, ship, out shortestWaitQueueTime, includeVerySmallYards: true, maximumQueueDepth: int.MaxValue). */
export function findShortestConstructionWaitQueue(galaxy: Galaxy, bol: readonly BuiltObject[], ship: BuiltObject, includeVerySmallYards = true, maximumQueueDepth = 2147483647): { yard: BuiltObject | null; shortestWaitQueueTime: number } {
    void galaxy;
    let shortestWaitQueueTime = Number.MAX_VALUE;
    let constructionWaitQueue: BuiltObject | null = null;
    const num1 = 2;
    let builtObject1: BuiltObject | null = null;
    for (let index = 0; index < bol.length; ++index) {
        const builtObject2 = bol[index];
        if (builtObject2 != null && builtObject2.isSpacePort && builtObject2.isShipYard) {
            let flag1 = true;
            let num2 = 0;
            const queue = builtObject2.constructionQueue as ConstructionQueue | null;
            if (queue !== null && queue.constructionYards !== null) num2 = queue.constructionYards.length;
            if (!includeVerySmallYards && builtObject2.extractionGas > 0 && num2 <= 1) flag1 = false;
            // Empire.CanBuildBuiltObject(ship) (forceStructure.ts canBuildBuiltObject takes the design).
            if (flag1 && canBuildBuiltObject(builtObject2.empire!, ship.design) && !builtObject2.name.startsWith('--') && Math.trunc(((queue?.constructionWaitQueue?.length ?? 0) + (num2 - 1)) / num2) <= maximumQueueDepth) {
                let num3 = Number.MAX_VALUE;
                if (queue !== null) num3 = queue.estimateCurrentWaitQueueTime();
                if (num3 < shortestWaitQueueTime) {
                    let flag2 = false;
                    const mq = builtObject2.manufacturingQueue as ManufacturingQueue | null;
                    if (mq !== null && mq.deficientResources != null && mq.deficientResources.items.length > num1) flag2 = true;
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
    return { yard: constructionWaitQueue, shortestWaitQueueTime };
}

/** Empire.9.cs 2344 SelectRandomSpacePortColony(coloniesToExclude). Rnd: Next(0, SpacePorts.Count). */
function selectRandomSpacePortColony(galaxy: Galaxy, empire: Empire, coloniesToExclude: readonly (Habitat | BuiltObject)[]): Habitat | null {
    const num = galaxy.rnd.next(0, empire.spacePorts.length);
    for (let i = num; i < empire.spacePorts.length; i++) {
        const ph = empire.spacePorts[i].parentHabitat;
        if (ph !== null && !coloniesToExclude.includes(ph)) return ph;
    }
    for (let j = 0; j < num; j++) {
        const ph = empire.spacePorts[j].parentHabitat;
        if (ph !== null && !coloniesToExclude.includes(ph)) return ph;
    }
    return null;
}

/**
 * BaconEmpire.cs 1406 PrivateConstructionAddToInfrastructure(empire, cost): (1 - privateBuildCostToStateMoney) * cost
 * goes to a random space-port colony's "infrastructure" BaconValue, the rest is returned to the state. Draws Rnd
 * (SelectRandomSpacePortColony) even though the default setting makes the infrastructure share 0.
 */
function privateConstructionAddToInfrastructure(galaxy: Galaxy, empire: Empire, cost: number): number {
    const num = (1.0 - baconSettings.privateBuildCostToStateMoney) * cost;
    const infrastructure = baconSettings.privateBuildCostToStateMoney * cost;
    const coloniesToExclude: (Habitat | BuiltObject)[] = [];
    for (const spacePort of empire.spacePorts) {
        if (spacePort.name.startsWith('--')) coloniesToExclude.push(spacePort);
    }
    const habitat = selectRandomSpacePortColony(galaxy, empire, coloniesToExclude);
    if (habitat !== null) {
        if (habitat.baconValues === null) habitat.baconValues = new Map();
        const values = habitat.baconValues;
        const current = values.get('infrastructure');
        if (current !== undefined) values.set('infrastructure', (current as number) + Math.trunc(num));
        else values.set('infrastructure', Math.trunc(num));
    }
    return infrastructure;
}

/** Empire.6.cs 741 DirectPrivateConstruction. Rnd: Next(0, SpacePorts.Count) (PrivateConstructionAddToInfrastructure), plus GenerateBuiltObjectName. */
export function directPrivateConstruction(galaxy: Galaxy, empire: Empire): void {
    const list: CargoList[] = [];
    const builtObjectList: BuiltObject[] = [];
    let resourcesToOrder: CargoList | null = null;
    const privateAnnualCashflow = getPrivateAnnualCashflow(galaxy, empire);
    const current = currentPrivateForceStructure(empire, galaxyStarDate(galaxy));
    const forceStructureProjectionList = current.projections;
    // _PrivateForceStructureProjections is set by ProjectPrivateForceStructure earlier in the same long block; a null
    // list (never projected) diffs like an empty one.
    const forceStructureProjectionList2 = (empire.privateForceStructureProjections ?? new ForceStructureProjectionList()).diff(forceStructureProjectionList);
    netSort(forceStructureProjectionList2.items, (a, b) => a.compareTo(b));
    let num = 0.0;
    let num2 = 0.0;
    for (const item2 of forceStructureProjectionList2) {
        const design = findNewestCanBuild(empire.designs, item2.subRole, empire);
        if (design === null || item2.amount <= 0) continue;
        for (let i = 0; i < item2.amount; i++) {
            const num3 = design.calculateCurrentPurchasePrice(galaxy);
            const num4 = designCalculateMaintenanceCosts(galaxy, design, empire);
            if (!(num2 + num4 <= privateAnnualCashflow) || !(num + num3 <= getPrivateFunds(empire))) continue;
            design.buildCount++;
            const builtObject = new BuiltObject(design, galaxy.generateBuiltObjectName(design), galaxy);
            builtObject.purchasePrice = num3;
            const found = findShortestConstructionWaitQueue(galaxy, empire.spacePorts, builtObject);
            const builtObject2 = found.yard;
            const num5 = found.shortestWaitQueueTime / REAL_SECONDS_IN_GALACTIC_YEAR;
            if (builtObject2 !== null && num5 < MAXIMUM_CONSTRUCTION_QUEUE_WAIT_TIME_YEARS) {
                const queue = builtObject2.constructionQueue as ConstructionQueue | null;
                if (queue !== null) {
                    if (queue.addBuiltObjectToConstruct(builtObject)) {
                        if (builtObject2.parentHabitat !== null) {
                            const habitat = galaxy.determineHabitatSystemStar(builtObject2.parentHabitat);
                            builtObject.name = galaxy.generateBuiltObjectName(design, habitat);
                        }
                        empire.addBuiltObjectToGalaxy(builtObject, builtObject2, false, false);
                        num += num3;
                        num2 += num4;
                        performFinancialTransaction(builtObject2, num3, galaxyStarDate(galaxy), false);
                        builtObject.builtAt = builtObject2;
                        resourcesToOrder = procureConstructionComponentsAtBuiltObject(galaxy, empire, builtObject, builtObject2, true);
                        list.push(resourcesToOrder);
                        builtObjectList.push(builtObject2);
                    } else {
                        design.buildCount--;
                    }
                } else {
                    design.buildCount--;
                }
            } else {
                design.buildCount--;
            }
        }
    }
    const builtObjectList2: BuiltObject[] = [];
    for (let j = 0; j < builtObjectList.length; j++) {
        const item = builtObjectList[j];
        if (!builtObjectList2.includes(item)) builtObjectList2.push(item);
    }
    for (const item3 of builtObjectList2) {
        const cargoList = new CargoList();
        for (let k = 0; k < builtObjectList.length; k++) {
            if (builtObjectList[k] !== item3) continue;
            for (const item4 of list[k].items) cargoList.add(item4);
        }
        for (const item5 of cargoList.items) {
            empireCreateOrder(galaxy, empire, item3, item5.commodity, item5.amount, false, OrderType.ConstructionShortage);
        }
    }
    empire.stateMoney += privateConstructionAddToInfrastructure(galaxy, empire, num);
    performPrivateTransaction(empire, 0.0 - num);
}

// ---------------------------------------------------------------------------------------------------------------
// Galaxy.6.cs / Galaxy.7.cs exploration searches and territory / base lookups
// ---------------------------------------------------------------------------------------------------------------

/** Galaxy.7.cs 1527 ResolveSector(x, y) + Galaxy.6.cs 3822 CorrectSectorCoords. */
export function resolveSector(galaxy: Galaxy, x: number, y: number): Sector {
    let x2 = Math.trunc(Math.trunc(x) / SECTOR_SIZE) | 0; // int division (no -0)
    let y2 = Math.trunc(Math.trunc(y) / SECTOR_SIZE) | 0;
    if (x2 < 0) x2 = 0;
    else if (x2 >= galaxy.sectorWidth) x2 = galaxy.sectorWidth - 1;
    if (y2 < 0) y2 = 0;
    else if (y2 >= galaxy.sectorHeight) y2 = galaxy.sectorHeight - 1;
    return new Sector(x2, y2);
}

/** Galaxy.cs 3699 CheckMilitaryShipWelcomeAtTerritoryLocation(x, y, empire). */
export function checkMilitaryShipWelcomeAtTerritoryLocation(galaxy: Galaxy, x: number, y: number, empire: Empire | null): boolean {
    if (empire !== null) {
        const num = galaxy.empireTerritory.checkLocationOwnership(galaxy, x, y);
        if (num < 0 || num === empire.empireId) return true;
        // Empires.GetByEmpireId(num): the (non-pirate) empire list.
        const byEmpireId = galaxy.empires.find((e) => e.empireId === num) ?? null;
        if (byEmpireId !== null) {
            const diplomaticRelation = obtainDiplomaticRelation(byEmpireId, empire);
            if (diplomaticRelation.militaryRefuelingToOther) return true;
        }
    }
    return false;
}

/** Galaxy.3.cs 663 FastFindNearestLongRangeScannerBase(x, y, empire). */
export function fastFindNearestLongRangeScannerBase(galaxy: Galaxy, x: number, y: number, empire: Empire): BuiltObject | null {
    let num = Number.MAX_VALUE;
    let result: BuiltObject | null = null;
    const scanners = empire.longRangeScanners as BuiltObject[];
    for (let i = 0; i < scanners.length; i++) {
        const builtObject = scanners[i];
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

/** Galaxy.7.cs 1271 FindNearestStationaryStellarObject(x, y, empire): nearest of the empire's colonies and state / private bases. */
export function findNearestStationaryStellarObject(galaxy: Galaxy, x: number, y: number, empire: Empire | null): StellarObject | null {
    if (empire !== null) {
        let num = Number.MAX_VALUE;
        let num2 = Number.MAX_VALUE;
        let num3 = Number.MAX_VALUE;
        let builtObject: BuiltObject | null = null;
        let builtObject2: BuiltObject | null = null;
        const habitat = galaxy.findNearestColony(x, y, empire, false);
        if (habitat !== null) num3 = galaxy.calculateDistanceSquared(x, y, habitat.xpos, habitat.ypos);
        if (empire.builtObjects != null && empire.privateBuiltObjects != null) {
            // GetBuiltObjectsByRole([Base]) + FindNearestBuiltObjectInSet.
            const nearestInSet = (set: readonly BuiltObject[]): BuiltObject | null => {
                let best: BuiltObject | null = null;
                let bestDistance = Number.MAX_VALUE;
                for (const b of set) {
                    if (b == null || b.role !== BuiltObjectRole.Base) continue;
                    const d = galaxy.calculateDistanceSquared(x, y, b.xpos, b.ypos);
                    if (d < bestDistance) {
                        bestDistance = d;
                        best = b;
                    }
                }
                return best;
            };
            builtObject = nearestInSet(empire.builtObjects);
            if (builtObject !== null) num = galaxy.calculateDistanceSquared(x, y, builtObject.xpos, builtObject.ypos);
            builtObject2 = nearestInSet(empire.privateBuiltObjects);
            if (builtObject2 !== null) num2 = galaxy.calculateDistanceSquared(x, y, builtObject2.xpos, builtObject2.ypos);
        }
        // Galaxy.7.cs 1300-1316: the closest of the three (colony first on ties).
        if (habitat !== null && num3 <= num && num3 <= num2) return habitat;
        if (builtObject !== null && num <= num2) return builtObject;
        if (builtObject2 !== null) return builtObject2;
        return habitat;
    }
    return null;
}

/** Galaxy.7.cs 1548 FindNearestUncolonizedExploredSystem(x, y, empire). */
export function findNearestUncolonizedExploredSystem(galaxy: Galaxy, x: number, y: number, empire: Empire): Habitat | null {
    let num = Number.MAX_VALUE;
    let result: Habitat | null = null;
    const systemVisibility = empire.systemVisibility;
    for (let i = 0; i < systemVisibility.length; i++) {
        const sv = systemVisibility[i];
        if (empire.visibility.checkSystemVisibilityStatus(sv.systemStar.systemIndex) === SystemVisibilityStatus.Explored && galaxy.systems[sv.systemStar.systemIndex].dominantEmpire == null) {
            const num2 = galaxy.calculateDistanceSquared(x, y, sv.systemStar.xpos, sv.systemStar.ypos);
            if (num2 < num) {
                result = sv.systemStar;
                num = num2;
            }
        }
    }
    return result;
}

/** Galaxy.7.cs 1568 FindNearestLonelyHabitat(x, y, empire) + 1603 FindNearestLonelyHabitatInIndex. */
export function findNearestLonelyHabitat(galaxy: Galaxy, x: number, y: number, empire: Empire): Habitat | null {
    const ix = Math.trunc(x);
    const iy = Math.trunc(y);
    return galaxy.ringSearch<Habitat>(ix, iy, (cx, cy) => {
        let habitat: Habitat | null = null;
        const habitatList = galaxy.habitatIndexGrid[cx][cy];
        let distance = Number.MAX_VALUE;
        let num = -1;
        let flag = false;
        for (let i = 0; i < habitatList.length; i++) {
            const h = habitatList[i];
            // `Category != 0` — HabitatCategoryType 0 is Star (the enum has no Undefined member).
            if (h.category !== HabitatCategoryType.Star && h.category !== HabitatCategoryType.Planet && h.category !== HabitatCategoryType.Moon) continue;
            if (num !== h.systemIndex) {
                const dominantEmpire = galaxy.systems[h.systemIndex].dominantEmpire;
                flag = dominantEmpire != null && dominantEmpire.empire != null ? true : false;
                num = h.systemIndex;
            }
            if (flag) continue;
            const num2 = galaxy.checkEmpireTerritoryIdAtLocation(ix, iy);
            if ((num2 >= 0 && num2 !== empire.empireId) || (h.empire !== null && h.empire !== galaxy.independentEmpire && h.empire !== empire)) continue;
            const num3 = galaxy.calculateDistanceSquared(ix, iy, h.xpos, h.ypos);
            if (!(num3 < distance)) continue;
            const star = galaxy.systems[h.systemIndex].systemStar;
            // FindNearestBuiltObject((int)x, (int)y, (Empire)null).
            const builtObject = galaxy.findNearestBuiltObjectOfEmpire(Math.trunc(star.xpos), Math.trunc(star.ypos), null);
            if (builtObject !== null && builtObject.empire !== null) {
                const num4 = galaxy.calculateDistance(star.xpos, star.ypos, builtObject.xpos, builtObject.ypos);
                if (num4 < MAX_SOLAR_SYSTEM_SIZE * 2.1) continue;
            }
            habitat = h;
            distance = num3;
        }
        if (habitat !== null) distance = galaxy.calculateDistance(ix, iy, habitat.xpos, habitat.ypos);
        return { item: habitat, distance };
    });
}

/** Galaxy.5.cs 4769 FindUnownedBuiltObjectInSystem(systemStar). */
export function findUnownedBuiltObjectInSystem(galaxy: Galaxy, systemStar: Habitat): BuiltObject | null {
    for (let i = 0; i < galaxy.abandonedBuiltObjects.length; i++) {
        const builtObject = galaxy.abandonedBuiltObjects[i];
        if (builtObject != null && builtObject.nearestSystemStar === systemStar && builtObject.unbuiltOrDamagedComponentCount <= 0 && builtObject.empire === null && !builtObject.hasBeenDestroyed) return builtObject;
    }
    return null;
}

/** Galaxy.6.cs 3954 UltraFastFindNearestUnexploredSystem(x, y, empire) + 3990 ...InIndex. */
export function ultraFastFindNearestUnexploredSystem(galaxy: Galaxy, x: number, y: number, empire: Empire): Habitat | null {
    const systemInfo = galaxy.ringSearch<SystemInfo>(x, y, (cx, cy) => {
        let found: SystemInfo | null = null;
        const systemInfoList = galaxy.systemsIndexGrid[cx][cy];
        let distance = Number.MAX_VALUE;
        for (let i = 0; i < systemInfoList.length; i++) {
            let systemVisibilityStatus = SystemVisibilityStatus.Unexplored;
            if (systemInfoList[i].systemStar != null) {
                systemVisibilityStatus = empire.visibility.checkSystemVisibilityStatus(systemInfoList[i].systemStar.systemIndex);
            }
            if (systemVisibilityStatus === SystemVisibilityStatus.Unexplored || systemVisibilityStatus === SystemVisibilityStatus.Undefined) {
                const num = galaxy.calculateDistanceSquared(x, y, systemInfoList[i].systemStar.xpos, systemInfoList[i].systemStar.ypos);
                if (num < distance) {
                    found = systemInfoList[i];
                    distance = num;
                }
            }
        }
        if (found !== null) distance = galaxy.calculateDistance(x, y, found.systemStar.xpos, found.systemStar.ypos);
        return { item: found, distance };
    });
    return systemInfo === null ? null : systemInfo.systemStar;
}

/** Galaxy.6.cs 4019 FindNextSystemToScout(empire, explorationShip, out location). Rnd: Next(0, 20) when a nearest unexplored system exists. */
export function findNextSystemToScout(galaxy: Galaxy, empire: Empire, explorationShip: BuiltObject): { habitat: Habitat | null; location: Point } {
    let location: Point = POINT_EMPTY;
    if (explorationShip.nearestSystemStar !== null) {
        const systemInfo = galaxy.systems[explorationShip.nearestSystemStar.systemIndex];
        if (systemInfo.hasRuins ?? false) {
            const sysHabitats = planetsOf(systemInfo); // Galaxy.6.cs 4027 systemInfo.Habitats: no star
            for (let i = 0; i < sysHabitats.length; i++) {
                const habitat = sysHabitats[i];
                // DEVIATION (exploration.ts ruinAwaitsPlayerDecision): not a ruin the player's ships already found.
                if (habitat.ruin === null || empire.reclusive || ruinAwaitsPlayerDecision(galaxy, habitat.ruin, empire)) continue;
                let flag = false;
                if (habitat.ruin.type === RuinType.UnlockResearchProject) {
                    if (!empire.resourceMap.checkResourcesKnown(habitat)) flag = true;
                } else if (checkRuinsHaveBenefit(galaxy, habitat.ruin, empire)) {
                    flag = true;
                }
                if (flag) return { habitat, location };
            }
        }
        const galaxyLocationList = determineGalaxyLocationsInRangeAtPoint(galaxy, explorationShip.nearestSystemStar.xpos, explorationShip.nearestSystemStar.ypos, MAX_SOLAR_SYSTEM_SIZE * 2.1, GalaxyLocationType.Undefined);
        for (let j = 0; j < galaxyLocationList.length; j++) {
            const galaxyLocation = galaxyLocationList[j];
            if ((galaxyLocation.type === GalaxyLocationType.DebrisField || galaxyLocation.type === GalaxyLocationType.PlanetDestroyer || galaxyLocation.type === GalaxyLocationType.RestrictedArea) && !empire.visibility.knownGalaxyLocations.includes(galaxyLocation)) {
                location = { x: Math.trunc(galaxyLocation.xpos + galaxyLocation.width / 2.0), y: Math.trunc(galaxyLocation.ypos + galaxyLocation.height / 2.0) };
                return { habitat: null, location };
            }
        }
        if (!empire.reclusive) {
            const builtObject = findUnownedBuiltObjectInSystem(galaxy, explorationShip.nearestSystemStar);
            if (builtObject !== null) {
                location = { x: Math.trunc(builtObject.xpos), y: Math.trunc(builtObject.ypos) };
                return { habitat: null, location };
            }
        }
    }
    let habitat2 = ultraFastFindNearestUnexploredSystem(galaxy, explorationShip.xpos, explorationShip.ypos, empire);
    let flag2 = false;
    if (habitat2 !== null) {
        const num = galaxy.calculateDistance(habitat2.xpos, habitat2.ypos, explorationShip.xpos, explorationShip.ypos);
        if (num > SECTOR_SIZE * 0.6 || galaxy.rnd.next(0, 20) === 1) flag2 = true;
    }
    if (flag2) habitat2 = ultraFastFindNearestUnexploredSystem(galaxy, empire.capital!.xpos, empire.capital!.ypos, empire);
    return { habitat: habitat2, location };
}

/** Galaxy.6.cs 4089 FindUnexploredRuinsOrLocations(x, y, empire, out location). No Rnd. */
export function findUnexploredRuinsOrLocations(galaxy: Galaxy, x: number, y: number, empire: Empire): { habitat: Habitat | null; location: GalaxyLocation | null } {
    let habitat: Habitat | null = null;
    let num = Number.MAX_VALUE;
    if (!empire.reclusive) {
        for (let i = 0; i < galaxy.ruinsHabitats.length; i++) {
            const habitat2 = galaxy.ruinsHabitats[i];
            // DEVIATION (exploration.ts ruinAwaitsPlayerDecision): not a ruin the player's ships already found.
            if (habitat2 == null || habitat2.ruin === null || ruinAwaitsPlayerDecision(galaxy, habitat2.ruin, empire)) continue;
            let flag = false;
            if (habitat2.ruin.type === RuinType.UnlockResearchProject) {
                const id = habitat2.ruin.researchProjectId;
                const techTree = empire.research.techTree;
                if (id >= 0 && empire.research != null && techTree != null && techTree.length > id && techTree[id] != null && !techTree[id].isEnabled) flag = true;
            } else if (checkRuinsHaveBenefit(galaxy, habitat2.ruin, empire) && (habitat2.ruin.storyClueLevel < 0 || (habitat2.ruin.storyClueLevel >= 0 && empire === galaxy.playerEmpire))) {
                flag = true;
            }
            if (flag) {
                const num2 = galaxy.calculateDistanceSquared(x, y, habitat2.xpos, habitat2.ypos);
                if (num2 < num) {
                    habitat = habitat2;
                    num = num2;
                }
            }
        }
        if (habitat !== null) return { habitat, location: null };
    }
    for (let j = 0; j < galaxy.galaxyLocations.length; j++) {
        const galaxyLocation = galaxy.galaxyLocations[j];
        if ((galaxyLocation.type !== GalaxyLocationType.DebrisField && galaxyLocation.type !== GalaxyLocationType.PlanetDestroyer && galaxyLocation.type !== GalaxyLocationType.RestrictedArea) || empire.visibility.knownGalaxyLocations.includes(galaxyLocation)) continue;
        const c = galaxyLocation.resolveLocationCenter();
        const habitat3 = galaxy.fastFindNearestSystem(x, y);
        if (habitat3 !== null) {
            const num3 = galaxy.calculateDistance(habitat3.xpos, habitat3.ypos, c.x, c.y);
            if (num3 < 25000.0) return { habitat: null, location: galaxyLocation };
        }
    }
    return { habitat: null, location: null };
}

/** Galaxy.6.cs 3848 FindNearestUnexploredHabitatInSystem(x, y, systemStar, empire, asteroidRangeFactor) (private overload). */
function findNearestUnexploredHabitatInSystemRanged(galaxy: Galaxy, x: number, y: number, systemStar: Habitat | null, empire: Empire, asteroidRangeFactor: number): Habitat | null {
    let num = Number.MAX_VALUE;
    let result: Habitat | null = null;
    const num2 = asteroidRangeFactor * asteroidRangeFactor;
    if (systemStar !== null && empire.resourceMap != null) {
        // Galaxy.6.cs 3855 Systems[].Habitats (excludes the star; Galaxy.6.cs 4611 DetermineHabitatsInSystem).
        const habitats = galaxy.systemHabitatsOf(systemStar.systemIndex);
        for (let i = 0; i < habitats.length; i++) {
            const habitat = habitats[i];
            let flag = false;
            if (!empire.resourceMap.checkResourcesKnown(habitat)) {
                flag = true;
            } else if (!empire.reclusive && habitat.ruin !== null && !ruinAwaitsPlayerDecision(galaxy, habitat.ruin, empire)) {
                // DEVIATION (exploration.ts ruinAwaitsPlayerDecision): the `&& !ruinAwaitsPlayerDecision` above.
                if (habitat.ruin.type === RuinType.UnlockResearchProject) {
                    const id = habitat.ruin.researchProjectId;
                    const techTree = empire.research.techTree;
                    if (id >= 0 && empire.research != null && techTree != null && techTree.length > id && techTree[id] != null && !techTree[id].isEnabled) flag = true;
                } else if (checkRuinsHaveBenefit(galaxy, habitat.ruin, empire) && (habitat.ruin.storyClueLevel < 0 || (habitat.ruin.storyClueLevel >= 0 && empire === galaxy.playerEmpire))) {
                    flag = true;
                }
            }
            if (flag) {
                let num3 = galaxy.calculateDistanceSquared(x, y, habitat.xpos, habitat.ypos);
                if (habitat.category === HabitatCategoryType.Asteroid) num3 *= num2;
                if (num3 < num) {
                    result = habitat;
                    num = num3;
                }
            }
        }
    }
    return result;
}

/** Galaxy.6.cs 4567 FindNearestUnexploredHabitatInSystem(int x, int y, sun, empire, includeAsteroids): walks the habitat index cell after the sun. */
export function findNearestUnexploredHabitatInSystem(galaxy: Galaxy, x: number, y: number, sun: Habitat, empire: Empire, includeAsteroids: boolean): Habitat | null {
    let habitat: Habitat | null = null;
    const idx = galaxy.resolveIndex(sun.xpos, sun.ypos);
    const habitatList = galaxy.habitatIndexGrid[idx.x][idx.y];
    let num = habitatList.indexOf(sun);
    num++;
    let habitat2: Habitat | null = null;
    if (num < habitatList.length) habitat2 = habitatList[num];
    const iterationCount = { count: 0 };
    while (conditionCheckLimit(habitat2 !== null && habitat2.parent !== null, 2000, iterationCount)) {
        let flag = true;
        if (!includeAsteroids && habitat2!.category === HabitatCategoryType.Asteroid) flag = false;
        if (flag) {
            if (habitat !== null) {
                const num2 = Math.trunc(galaxy.calculateDistance(x, y, habitat2!.xpos, habitat2!.ypos));
                const num3 = Math.trunc(galaxy.calculateDistance(x, y, habitat.xpos, habitat.ypos));
                if (num2 < num3 && empire.resourceMap != null && !empire.resourceMap.checkResourcesKnown(habitat2!)) habitat = habitat2;
            } else if (empire.resourceMap != null && !empire.resourceMap.checkResourcesKnown(habitat2!)) {
                habitat = habitat2;
            }
        }
        num++;
        habitat2 = num >= habitatList.length ? null : habitatList[num];
    }
    return habitat;
}

/**
 * Galaxy.6.cs 4152 FindNextHabitatToExplore(x, y, empire, explorationShip, out location).
 * Rnd: NextDouble x2 (jitter when the nearest target is far), then per crowded target Next(0, 2) + NextDouble (<= 30).
 */
export function findNextHabitatToExplore(galaxy: Galaxy, x: number, y: number, empire: Empire | null, explorationShip: BuiltObject | null): { habitat: Habitat | null; location: Point } {
    const location: Point = POINT_EMPTY;
    let num = 0.0;
    if (empire === null || explorationShip === null) return { habitat: null, location };
    let habitat: Habitat | null = null;
    if (explorationShip.nearestSystemStar !== null) {
        habitat = findNearestUnexploredHabitatInSystemRanged(galaxy, x, y, explorationShip.nearestSystemStar, empire, 3.0);
    }
    if (habitat === null && explorationShip.nearestSystemStar !== null) {
        const galaxyLocationList = determineGalaxyLocationsInRangeAtPoint(galaxy, explorationShip.nearestSystemStar.xpos, explorationShip.nearestSystemStar.ypos, MAX_SOLAR_SYSTEM_SIZE * 2.1, GalaxyLocationType.Undefined);
        for (let i = 0; i < galaxyLocationList.length; i++) {
            const galaxyLocation = galaxyLocationList[i];
            if ((galaxyLocation.type === GalaxyLocationType.DebrisField || galaxyLocation.type === GalaxyLocationType.PlanetDestroyer || galaxyLocation.type === GalaxyLocationType.RestrictedArea) && !empire.visibility.knownGalaxyLocations.includes(galaxyLocation)) {
                return { habitat: null, location: { x: Math.trunc(galaxyLocation.xpos + galaxyLocation.width / 2.0), y: Math.trunc(galaxyLocation.ypos + galaxyLocation.height / 2.0) } };
            }
        }
        if (!empire.reclusive) {
            const builtObject = findUnownedBuiltObjectInSystem(galaxy, explorationShip.nearestSystemStar);
            if (builtObject !== null) return { habitat: null, location: { x: Math.trunc(builtObject.xpos), y: Math.trunc(builtObject.ypos) } };
        }
    }
    if (habitat === null) habitat = fastFindNearestUnexploredHabitat(galaxy, x, y, empire);
    if (habitat === null) return { habitat: null, location };
    const num2 = galaxy.calculateDistance(explorationShip.xpos, explorationShip.ypos, habitat.xpos, habitat.ypos);
    if (num2 > MAX_SOLAR_SYSTEM_SIZE * 2.1) {
        x += galaxy.rnd.nextDouble() * 400000.0 - 200000.0;
        y += galaxy.rnd.nextDouble() * 400000.0 - 200000.0;
        habitat = fastFindNearestUnexploredHabitat(galaxy, x, y, empire);
    }
    if (habitat !== null && empire.builtObjects != null) {
        let range = MAX_SOLAR_SYSTEM_SIZE * 2.1 * 2.0;
        if (explorationShip.warpSpeed <= 0) range = 2000.0;
        const habitatList: Habitat[] = [];
        for (let j = 0; j < empire.builtObjects.length; j++) {
            const builtObject2 = empire.builtObjects[j];
            const m = missionOf(builtObject2);
            if (builtObject2 !== explorationShip && builtObject2 != null && builtObject2.role === BuiltObjectRole.Exploration && m !== null && (m.type === BuiltObjectMissionType.Explore || m.type === BuiltObjectMissionType.Move) && m.targetHabitat !== null && !habitatList.includes(m.targetHabitat)) {
                habitatList.push(m.targetHabitat);
            }
        }
        let num3 = 0;
        let firstHabitatWithinRange = getFirstHabitatWithinRange(habitatList, habitat.xpos, habitat.ypos, range);
        while (firstHabitatWithinRange !== null && num3 < 30) {
            const num4 = determineAngle(firstHabitatWithinRange.xpos, firstHabitatWithinRange.ypos, habitat!.xpos, habitat!.ypos);
            let num5 = (Math.PI * 2.0) / 5.0;
            if (galaxy.rnd.next(0, 2) === 1) num5 *= -1.0;
            const num6 = num4 + num5 + (0.5 - galaxy.rnd.nextDouble() * 1.0);
            if (explorationShip.warpSpeed <= 0) {
                num = !(num <= 0.0) ? num + 5000.0 : 5000.0;
                num = Math.min(num, 50000.0);
            } else {
                num += 1000000.0;
            }
            x += Math.cos(num6) * num;
            y += Math.sin(num6) * num;
            habitat = fastFindNearestUnexploredHabitat(galaxy, x, y, empire);
            if (habitat === null) break;
            firstHabitatWithinRange = getFirstHabitatWithinRange(habitatList, habitat.xpos, habitat.ypos, range);
            num3++;
        }
        if (firstHabitatWithinRange !== null) return { habitat: null, location };
    }
    return { habitat, location };
}

/** HabitatList.cs 508 GetFirstHabitatWithinRange(x, y, range). */
function getFirstHabitatWithinRange(list: readonly Habitat[], x: number, y: number, range: number): Habitat | null {
    const num = range * range;
    for (let index = 0; index < list.length; ++index) {
        const h = list[index];
        if (h != null) {
            const dx = x - h.xpos;
            const dy = y - h.ypos;
            if (dy * dy + dx * dx < num) return h;
        }
    }
    return null;
}

/**
 * Array.Sort(keys, items) on the candidate stars (.NET introsort over the keys, items moved along) as positions into
 * the item list, lazily (LazyNetSortOrder: same order as the full netSort, which it falls back to at the first tie).
 * Perf: the callers stop at the first system with a result.
 */
function lazyHabitatOrder(keys: number[]): LazyNetSortOrder {
    return new LazyNetSortOrder(keys, () => {
        const pairs = keys.map((k, i) => ({ i, k }));
        netSort(pairs, (a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
        return pairs.map((p) => p.i);
    });
}

/**
 * Galaxy.6.cs 4360 FastFindNearestUnexploredHabitat(x, y, empire). No Rnd. Sets SystemVisibility.TotallyExplored on
 * systems found to have nothing left to explore.
 */
export function fastFindNearestUnexploredHabitat(galaxy: Galaxy, x: number, y: number, empire: Empire | null): Habitat | null {
    if (empire !== null) {
        const habitatList: Habitat[] = [];
        const list: number[] = [];
        let num = Number.MAX_VALUE;
        const systemVisibility = empire.systemVisibility;
        for (let i = 0; i < galaxy.systems.length; i++) {
            const systemInfo = galaxy.systems[i];
            if (systemInfo == null || systemInfo.systemStar == null) continue;
            const sv = systemVisibility[systemInfo.systemStar.systemIndex];
            if (sv == null) continue;
            if (sv.status === SystemVisibilityStatus.Unexplored || sv.status === SystemVisibilityStatus.Undefined) {
                const num2 = galaxy.calculateDistanceSquared(x, y, systemInfo.systemStar.xpos, systemInfo.systemStar.ypos);
                if (num2 < num) {
                    num = num2;
                    list.push(num2);
                    habitatList.push(systemInfo.systemStar);
                }
            } else if (!sv.totallyExplored) {
                const item = galaxy.calculateDistanceSquared(x, y, systemInfo.systemStar.xpos, systemInfo.systemStar.ypos);
                list.push(item);
                habitatList.push(systemInfo.systemStar);
            }
        }
        const order = lazyHabitatOrder(list);
        for (let j = order.next(); j >= 0; j = order.next()) {
            let habitat: Habitat | null = null;
            let num3 = Number.MAX_VALUE;
            const habitat2 = habitatList[j];
            if (habitat2 == null) continue;
            const systemInfo2 = galaxy.systems[habitat2.systemIndex];
            if (systemInfo2 == null || systemInfo2.systemStar == null || systemInfo2.habitats == null) continue;
            // C# Systems[].Habitats excludes the star (Galaxy.6.cs 4611 DetermineHabitatsInSystem); the TS list has it at
            // [0], so a star-only system must take the Count == 0 branch, not the per-habitat one (whose known star
            // marked the system TotallyExplored and left the nearest-unexplored search empty).
            const systemHabitats2 = galaxy.systemHabitatsOf(habitat2.systemIndex);
            if (systemInfo2.systemStar.category === HabitatCategoryType.Star && systemHabitats2.length === 0) {
                const status = systemVisibility[habitat2.systemIndex].status;
                if (status === SystemVisibilityStatus.Unexplored || status === SystemVisibilityStatus.Undefined) {
                    const systemStar = systemInfo2.systemStar;
                    const num4 = galaxy.calculateDistanceSquared(x, y, systemStar.xpos, systemStar.ypos);
                    if (num4 < num3) {
                        habitat = systemStar;
                        num3 = num4;
                    }
                } else {
                    systemVisibility[habitat2.systemIndex].totallyExplored = true;
                }
            } else if (systemInfo2.systemStar.category === HabitatCategoryType.GasCloud) {
                const status2 = systemVisibility[habitat2.systemIndex].status;
                if (status2 === SystemVisibilityStatus.Unexplored || status2 === SystemVisibilityStatus.Undefined) {
                    const systemStar2 = systemInfo2.systemStar;
                    const num5 = galaxy.calculateDistanceSquared(x, y, systemStar2.xpos, systemStar2.ypos);
                    if (num5 < num3) {
                        habitat = systemStar2;
                        num3 = num5;
                    }
                } else {
                    systemVisibility[habitat2.systemIndex].totallyExplored = true;
                }
            } else {
                let flag = false;
                for (let k = 0; k < systemHabitats2.length; k++) {
                    const habitat3 = systemHabitats2[k];
                    if (
                        habitat3 != null &&
                        ((empire.resourceMap != null && !empire.resourceMap.checkResourcesKnown(habitat3) && habitat3.ruin === null) ||
                            // DEVIATION (exploration.ts ruinAwaitsPlayerDecision): `&& !ruinAwaitsPlayerDecision`.
                            (!empire.reclusive && habitat3.ruin !== null && !ruinAwaitsPlayerDecision(galaxy, habitat3.ruin, empire) && ((habitat3.ruin.type === RuinType.UnlockResearchProject && !empire.resourceMap.checkResourcesKnown(habitat3)) || (habitat3.ruin.type !== RuinType.UnlockResearchProject && checkRuinsHaveBenefit(galaxy, habitat3.ruin, empire)))))
                    ) {
                        flag = true;
                        const habitat4 = habitat3;
                        const num6 = galaxy.calculateDistanceSquared(x, y, habitat4.xpos, habitat4.ypos);
                        if (num6 < num3) {
                            habitat = habitat4;
                            num3 = num6;
                        }
                    }
                }
                if (!flag) systemVisibility[habitat2.systemIndex].totallyExplored = true;
            }
            if (habitat !== null) return habitat;
        }
    }
    return null;
}

/** Galaxy.6.cs 4256 FastFindNearestUnexploredHabitatInSector(x, y, empire, sector). No Rnd. */
export function fastFindNearestUnexploredHabitatInSector(galaxy: Galaxy, x: number, y: number, empire: Empire, sector: Sector): Habitat | null {
    const habitatList: Habitat[] = [];
    const list: number[] = [];
    let num = Number.MAX_VALUE;
    const systemVisibility = empire.systemVisibility;
    for (let i = 0; i < galaxy.systems.length; i++) {
        const systemInfo = galaxy.systems[i];
        const sector2 = resolveSector(galaxy, systemInfo.systemStar.xpos, systemInfo.systemStar.ypos);
        if (sector.x !== sector2.x || sector.y !== sector2.y) continue;
        const sv = systemVisibility[systemInfo.systemStar.systemIndex];
        if (sv.status === SystemVisibilityStatus.Unexplored || sv.status === SystemVisibilityStatus.Undefined) {
            const num2 = galaxy.calculateDistanceSquared(x, y, systemInfo.systemStar.xpos, systemInfo.systemStar.ypos);
            if (num2 < num) {
                num = num2;
                list.push(num2);
                habitatList.push(systemInfo.systemStar);
            }
        } else if (!sv.totallyExplored) {
            const item = galaxy.calculateDistanceSquared(x, y, systemInfo.systemStar.xpos, systemInfo.systemStar.ypos);
            list.push(item);
            habitatList.push(systemInfo.systemStar);
        }
    }
    const order = lazyHabitatOrder(list);
    for (let j0 = order.next(); j0 >= 0; j0 = order.next()) {
        const star = habitatList[j0];
        let habitat: Habitat | null = null;
        let num3 = Number.MAX_VALUE;
        const sys = galaxy.systems[star.systemIndex];
        const sysHabitats = galaxy.systemHabitatsOf(star.systemIndex); // C# Systems[].Habitats (no star), as in fastFindNearestUnexploredHabitat
        if (sys.systemStar.category === HabitatCategoryType.Star && sysHabitats.length === 0) {
            const status = systemVisibility[star.systemIndex].status;
            if (status === SystemVisibilityStatus.Unexplored || status === SystemVisibilityStatus.Undefined) {
                const systemStar = sys.systemStar;
                const num4 = galaxy.calculateDistanceSquared(x, y, systemStar.xpos, systemStar.ypos);
                if (num4 < num3) {
                    habitat = systemStar;
                    num3 = num4;
                }
            } else {
                systemVisibility[star.systemIndex].totallyExplored = true;
            }
        } else if (sys.systemStar.category === HabitatCategoryType.GasCloud) {
            const status2 = systemVisibility[star.systemIndex].status;
            if (status2 === SystemVisibilityStatus.Unexplored || status2 === SystemVisibilityStatus.Undefined) {
                const systemStar2 = sys.systemStar;
                const num5 = galaxy.calculateDistanceSquared(x, y, systemStar2.xpos, systemStar2.ypos);
                if (num5 < num3) {
                    habitat = systemStar2;
                    num3 = num5;
                }
            } else {
                systemVisibility[star.systemIndex].totallyExplored = true;
            }
        } else {
            let flag = false;
            for (let k = 0; k < sysHabitats.length; k++) {
                const h = sysHabitats[k];
                // DEVIATION (exploration.ts ruinAwaitsPlayerDecision): `&& !ruinAwaitsPlayerDecision`.
                if ((empire.resourceMap != null && !empire.resourceMap.checkResourcesKnown(h)) || (checkRuinsHaveBenefit(galaxy, h.ruin, empire) && !ruinAwaitsPlayerDecision(galaxy, h.ruin!, empire))) {
                    flag = true;
                    const habitat2 = h;
                    const num6 = galaxy.calculateDistanceSquared(x, y, habitat2.xpos, habitat2.ypos);
                    if (num6 < num3) {
                        habitat = habitat2;
                        num3 = num6;
                    }
                }
            }
            if (!flag) systemVisibility[star.systemIndex].totallyExplored = true;
        }
        if (habitat !== null) return habitat;
    }
    return null;
}

// ---- ProcessTourists (called from missions/cmdDocking.ts case Unload, BuiltObject.2.cs 3973) ----

/** The C# tourism-income body shared by both DockedAt branches (BuiltObject.2.cs 4837-4879 / 4889-4936). */
function processTourismIncomeAt(galaxy: Galaxy, builtObject: BuiltObject, amount: number, dockEmpire: Empire | null, dockOwner: Empire, dockCharacters: Character[] | null, colony: boolean): void {
    let num = amount;
    if (dockEmpire !== null) {
        const leader = empireLeader(dockEmpire);
        if (leader !== null) {
            num *= 1.0 + leader.tourismIncome / 100.0;
        }
        if (dockCharacters !== null && dockCharacters.length > 0) {
            // 4847 base: GetHighestSkillLevel; 4899 colony: GetHighestSkillLevelExcludeLeaders.
            const highestSkillLevel = colony
                ? getHighestSkillLevelExcludeLeaders(dockCharacters, CharacterSkillType.TourismIncome)
                : getHighestSkillLevel(dockCharacters, CharacterSkillType.TourismIncome);
            num *= 1.0 + highestSkillLevel / 100.0;
        }
        if (dockEmpire.dominantRace !== null) {
            num *= dockEmpire.dominantRace.tourismIncomeFactor;
        }
        dockEmpire.counters.processTourismIncome(num);
        addResortIncome(galaxy, dockEmpire, num);
        const ambassadorsForEmpire = getAmbassadorsForEmpire(dockEmpire.characters as Character[], builtObject.empire);
        // CharacterList.AddRange(Characters): the C# would throw on a null list; a null list adds nothing here.
        if (dockCharacters !== null) ambassadorsForEmpire.push(...dockCharacters);
        doCharacterEventForList(galaxy, CharacterEventType.TourismIncome, null, ambassadorsForEmpire, true, dockEmpire);
    }
    if (builtObject.pirateEmpireId > 0) {
        const byEmpireId = pirateEmpireById(galaxy, builtObject.pirateEmpireId);
        if (byEmpireId !== null) {
            let num2 = 1.0;
            const characters = builtObject.characters as Character[] | null;
            if (characters !== null && characters.length > 0) {
                num2 += 0.01 * getHighestSkillLevel(characters, CharacterSkillType.SmugglingIncome);
            }
            let num3 = num * 0.25 * colonyIncomeFactor(byEmpireId) * smugglingIncomeFactor(byEmpireId);
            num3 *= num2;
            num3 = applyCorruptionToIncome(byEmpireId, num3);
            byEmpireId.stateMoney += num3;
            byEmpireId.pirateEconomy.performIncome(num3, PirateIncomeType.Smuggling, galaxyStarDate(galaxy));
            byEmpireId.counters.pirateSmugglingIncome += num3;
        }
    }
    num = applyCorruptionToIncome(dockOwner, num);
    dockOwner.stateMoney += num;
    dockOwner.pirateEconomy.performIncome(num, PirateIncomeType.Resort, galaxyStarDate(galaxy));
}

/**
 * Port of BuiltObject.2.cs 4825 ProcessTourists(tourists): tourism income when passengers unload at a resort base
 * (4831-4881) or at a scenic colony (4882-4937) — the dock's empire gains Counters.TourismIncome and resort income
 * (leader / characters / race factors), a pirate carrier skims 25% as smuggling income, and the dock owner banks the
 * (corruption-reduced) amount as state money. RND: DoCharacterEvent(TourismIncome, …) (4857 / 4909).
 */
export function processTourists(galaxy: Galaxy, builtObject: BuiltObject, tourists: Population): void {
    const dockedAt = builtObject.dockedAt;
    if (dockedAt === null || dockedAt.owner === null) {
        return;
    }
    if (isBuiltObject(dockedAt)) {
        const builtObject2 = dockedAt;
        if (builtObject2.subRole !== BuiltObjectSubRole.ResortBase) {
            return;
        }
        const num = tourists.amount / 8.0;
        processTourismIncomeAt(galaxy, builtObject, num, builtObject2.empire, dockedAt.owner, builtObject2.characters as Character[] | null, false);
    } else {
        if (!isHabitat(dockedAt)) {
            return;
        }
        const habitat = dockedAt;
        const num4 = calculateScenicFactorIncludingRuinsWonders(habitat);
        if (!(num4 > 0.0) || tourists.amount >= 1000000) {
            return;
        }
        const num5 = tourists.amount / 8.0;
        processTourismIncomeAt(galaxy, builtObject, num5, habitat.empire, dockedAt.owner, stellarObjectCharacters(habitat), true);
    }
}

// ---- stub added by M4o (called from combat/damage.ts ProvideBonusFromPirateBase, BuiltObject.2.cs 4991) ----

/**
 * Galaxy.3.cs 1542 FindLonelyColonyLocation(empire): a random offset (±300 000) from the capital, clamped to the galaxy,
 * then FindNearestColonizableHabitatEmptySystem / UnoccupiedSystem / any, else FindNearestUncolonizedHabitat(Ice).
 * Rnd: NextDouble ×2. (C# dereferences empire.Capital unguarded.)
 */
export function findLonelyColonyLocation(galaxy: Galaxy, empire: Empire): Habitat | null {
    let xpos = empire.capital!.xpos;
    let ypos = empire.capital!.ypos;
    const num = galaxy.rnd.nextDouble() * 600000.0 - 300000.0;
    const num2 = galaxy.rnd.nextDouble() * 600000.0 - 300000.0;
    xpos += num;
    ypos += num2;
    xpos = Math.max(0.0, Math.min(galaxy.sizeX, xpos));
    ypos = Math.max(0.0, Math.min(galaxy.sizeY, ypos));
    let habitat = findNearestColonizableHabitatEmptySystem(galaxy, xpos, ypos, empire);
    if (habitat === null) habitat = galaxy.findNearestColonizableHabitatUnoccupiedSystem(xpos, ypos, empire);
    if (habitat === null) habitat = galaxy.findNearestColonizableHabitat(xpos, ypos, empire);
    if (habitat === null) habitat = galaxy.findNearestUncolonizedHabitat(xpos, ypos, HabitatType.Ice);
    return habitat;
}

/**
 * Galaxy.7.cs 1820 FindNearestColonizableHabitatEmptySystem(x, y, empire) + 2172 FindNearestColonizableHabitatEmptySystemInIndex:
 * the nearest free habitat the newest colony-ship design can colonize, in a system no other empire dominates and with no
 * built object within 2.1 system sizes of its star. No Rnd.
 */
export function findNearestColonizableHabitatEmptySystem(galaxy: Galaxy, x: number, y: number, empire: Empire): Habitat | null {
    const ix = Math.trunc(x);
    const iy = Math.trunc(y);
    const design = findNewestCanBuild(empire.designs, BuiltObjectSubRole.ColonyShip, empire.designs.length > 0 ? (empire.designs[0].empire as Empire | null) : null);
    if (design === null) return null;
    return galaxy.ringSearch(x, y, (cx, cy) => {
        let habitat: Habitat | null = null;
        let distance = Number.MAX_VALUE;
        let num = -1;
        let flag = false;
        const habitatList = galaxy.habitatIndexGrid[cx][cy];
        for (let i = 0; i < habitatList.length; i++) {
            const h = habitatList[i];
            if (num !== h.systemIndex) {
                const dominantEmpire = galaxy.systems[h.systemIndex].dominantEmpire ?? null;
                flag = dominantEmpire !== null && dominantEmpire.empire !== null && dominantEmpire.empire !== empire;
                num = h.systemIndex;
            }
            if (flag || (h.empire !== null && h.empire !== galaxy.independentEmpire)) continue;
            const num2 = galaxy.calculateDistanceSquared(ix, iy, h.xpos, h.ypos);
            if (!(num2 < distance) || !empire.canDesignColonizeHabitat(design, h)) continue;
            const star = galaxy.systems[h.systemIndex].systemStar;
            const builtObject = galaxy.findNearestBuiltObjectOfEmpire(Math.trunc(star.xpos), Math.trunc(star.ypos), null);
            if (builtObject !== null) {
                const num3 = galaxy.calculateDistance(star.xpos, star.ypos, builtObject.xpos, builtObject.ypos);
                if (num3 < galaxy.maxSolarSystemSize * 2.1) continue;
            }
            habitat = h;
            distance = num2;
        }
        if (habitat !== null) distance = galaxy.calculateDistance(ix, iy, habitat.xpos, habitat.ypos);
        return { item: habitat, distance };
    });
}
