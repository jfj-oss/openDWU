// Starting bases (task M3d). Ports of
//   Empire.6.cs  DetermineNewSpacePortLocations(colonies, newSpacePortAmount,
//                excludeColoniesWithEnemiesPresent) (3205-3334)
//   Galaxy.8.cs  CreateSpacePorts (1216) + BuildSpacePortAtColony (1224-1273)
//   Empire.5.cs  DetermineResearchStationLocation(allowOccupiedSystems,
//                mustHaveBuildableResearchStationDesign[, assignToResearchHabitats = true])
//                (3575-3669) + CheckResearchStationAtLocation (3671-3700)
//                + AnalyzeNewResearchFacilities(out ×3) (3495-3572)
//   Galaxy.8.cs  CreateResearchStations (1035-1214)
//   Galaxy.8.cs  CreateMiningStations (804-833) + CreateMiningStation (835-897)
//   Empire.6.cs  CheckResourceSupplyMeetsExpected(resource[, isCritical[, factor]]) (1535-1600)
//                and the Habitat-returning overloads (1602-1653)
//                + IdentifyStrategicResourceSupplySource (1755)
//   Galaxy.8.cs  SetLuxuryResourcesAtColonies (899-919)
//                + Empire.4.cs IdentifyUnavailableLuxuryResources / CheckResourceAvailable /
//                CheckResourceSelfSupplied (1827-1909), Habitat.cs RecalculateDevelopmentLevelBaseline (5575)
//   Empire.4.cs  CheckColoniesForBaseFacilities (2570) + Habitat.cs CheckForSpacePortFacilities
//                (2729) + Galaxy.7.cs DetermineColonyBaseInfo (257)
// and the small Galaxy helpers they call: Galaxy.cs CheckSystemOwnership(star[, out disputed])
// (3569/3583) + EmpireTerritory.CheckSystemOwnership (47), Galaxy.3.cs FastFindNearestSpacePort
// (703), Galaxy.5.cs GetBuiltObjectsAtLocation (3117) + Galaxy.7.cs DetermineClosestIndexEdgesCustom
// (2667), Galaxy.7.cs DetermineNonMiningBaseAtHabitat (327), CountResourceSourcesForEmpire (445),
// Galaxy.cs ResolveRetrofitResourcesForBase / CalculateResourceLevelStockForBaseRetrofit (1634/1647).
//
// Start.2.cs call order per empire (1113-1318): CheckColoniesForBaseFacilities;
// [tech > 0] DetermineNewSpacePortLocations(Colonies, 1 + (int)(Colonies.Count / 4.5), false) →
// CreateSpacePorts → SetColonyResources(hasSpacePort: true) per port colony;
// CheckColoniesForBaseFacilities; … DetermineResearchStationLocation(false, true);
// [tech > 0] CreateResearchStations(allowSameSystem = bool_6); [tech > 0]
// CreateMiningStations(false); SetLuxuryResourcesAtColonies.
//
// Rnd (exact order):
//   BuildSpacePortAtColony, per port built:  SelectRelativePoint = NextDouble (range) +
//     SelectRandomHeading NextDouble; then SelectRandomHeading NextDouble (Heading).
//     Name "<colony> Space Port": no Rnd. (No draw when no design fits the population.)
//   CreateMiningStation, per candidate that passes the ownership/territory/no-station checks
//     and has a design: SelectRelativeHabitatSurfacePoint = 2× NextDouble (drawn even when a
//     base already sits at the habitat and nothing is built); if built, SelectRandomHeading
//     NextDouble. Name "<habitat> Mining Station"/"… Gas Mining Station": no Rnd.
//   CreateResearchStations, per candidate with a design:
//     star target with an own asteroid field: Next(0, field.Count) per try (≤ 20, until an
//       asteroid ≥ 200 from the nearest base is found) — then SelectRelativeHabitatSurfacePoint
//       (2× NextDouble) on it; star without a usable field: SelectRelativeParkingPoint(d) =
//       NextDouble, Next(0,2), NextDouble; other habitats: SelectRelativeHabitatSurfacePoint.
//     While the point is < MinimumDistanceBetweenBases (120) from a base: another
//       SelectRelativeHabitatSurfacePoint (≤ 50 tries, ≤ 6 with a base found).
//     If built: name Next(0, 4) ("<star> Research Center|Station|Research Station|Research
//       Facility"), then SelectRandomHeading NextDouble.
//   DetermineNewSpacePortLocations, DetermineResearchStationLocation, CheckResourceSupplyMeetsExpected,
//   SetLuxuryResourcesAtColonies, CheckColoniesForBaseFacilities: none.
// AddBuiltObjectToGalaxy draws nothing here (offsetLocationFromParent: false).

import { BuiltObject } from './builtObject';
import { BuiltObjectSubRole } from './builtObjectTypes';
import { BuiltObjectMissionType, builtObjectMission } from './missions/mission';
import { Cargo, CargoList, ResourceRef } from './cargo';
import { ComponentType } from './data/components';
import { BuiltObjectRole } from './data/designSpecifications';
import type { Design } from './design';
import { findNewestCanBuild } from './designGeneration';
import { COLONY_ANNUAL_LUXURY_RESOURCE_CONSUMPTION_RATE, MINIMUM_LUXURY_RESOURCE_REORDER_AMOUNT, type Empire } from './empire';
import { checkEmpireHasHyperDriveTech } from './forceStructure';
import { DiplomaticRelationType, obtainDiplomaticRelation } from './diplomacy';
import { PirateRelationType, obtainPirateRelation } from './pirateRelations';
import type { Galaxy } from './galaxy';
import { netSort } from './netSort';
import { ShipDesignFocus } from './researchSystem';
import { annualResearchPotential, researchPotential } from './researchTick';
import type { ConstructionQueue } from './construction/constructionQueue';
import { ResourceGroup, resourceGroupOf } from './resourceSystem';
import {
    checkConstructionShipAndMiningStationCanSurviveStorms,
    checkEmpireTerritoryCanBuildAtHabitat,
    checkInStorm,
    checkNearPirateBase,
    determineMiningStationAtHabitatForEmpire,
    habitatPrioritizationIndexOf,
    identifyResourceCentres,
} from './resourceTargets';
import { habitatDevelopmentLevel, recalculateDevelopmentLevelBaseline } from './developmentLevel';
import { HabitatCategoryType, HabitatType, IndustryType, type Habitat } from './types';

// Galaxy.3.cs InitializeStatics (4998-5029).
export const HABITAT_SMALL_SPACE_PORT_POPULATION_REQUIREMENT = 1000000; // long
export const HABITAT_MEDIUM_SPACE_PORT_POPULATION_REQUIREMENT = 500000000; // long
export const HABITAT_LARGE_SPACE_PORT_POPULATION_REQUIREMENT = 3000000000; // long
export const MINIMUM_DISTANCE_BETWEEN_BASES = 120; // int
// Galaxy.IndexSize (Galaxy.3.cs).
const INDEX_SIZE = 400000;

const S = BuiltObjectSubRole;
const isSpacePortSubRole = (s: BuiltObjectSubRole) => s === S.SmallSpacePort || s === S.MediumSpacePort || s === S.LargeSpacePort;

// Galaxy.7.cs ConditionCheckLimit(condition, maximumIterations, ref iterationCount) (569).
function conditionCheckLimit(condition: boolean, maximumIterations: number, iterationCount: { value: number }): boolean {
    if (iterationCount.value >= maximumIterations) return false;
    iterationCount.value++;
    return condition;
}

// Galaxy.7.cs static DetermineHabitatSystemStar(habitat) (679): null for a null habitat.
function systemStarOf(galaxy: Galaxy, habitat: Habitat | null): Habitat | null {
    return habitat !== null ? galaxy.determineHabitatSystemStar(habitat) : null;
}

// DesignList.cs FindNewestCanBuild(subRole) (140): the list owner is Designs[0].Empire.
export function designsFindNewestCanBuild(designs: Design[], subRole: BuiltObjectSubRole): Design | null {
    let empire: Empire | null = null;
    if (designs.length > 0 && designs[0] != null) empire = designs[0].empire as Empire | null;
    return findNewestCanBuild(designs, subRole, empire);
}

// Habitat.cs StrategicValue (309): DevelopmentLevel (the property) * (int)(TotalAmount / 1000000).
function habitatStrategicValue(h: Habitat): number {
    const val = habitatDevelopmentLevel(h) * Math.trunc(h.population.totalAmount / 1000000);
    return Math.max(10000, val);
}

// Habitat.cs CompareTo(Habitat) (8023) — Comparer<Habitat>.Default for HabitatList.Sort().
export function habitatCompareTo(a: Habitat, b: Habitat): number {
    const sa = habitatStrategicValue(a);
    const sb = habitatStrategicValue(b);
    if (sa === sb) {
        if (a.population != null && a.population.items.length > 0 && b.population != null && b.population.items.length > 0) {
            const x = a.population.totalAmount;
            const y = b.population.totalAmount;
            return x < y ? -1 : x > y ? 1 : 0;
        }
        return 0;
    }
    return sa < sb ? -1 : 1;
}

// Galaxy.cs CheckSystemOwnership(systemStar, out disputed) (3583) + EmpireTerritory.cs
// CheckSystemOwnership (47) + EmpireList.GetByEmpireId (Galaxy.Empires: no pirate factions).
export function checkSystemOwnership(galaxy: Galaxy, systemStar: Habitat | null): { empire: Empire | null; disputed: boolean } {
    let disputed = false;
    if (systemStar !== null) {
        let num: number;
        const bySystemIndex = galaxy.systems[systemStar.systemIndex] ?? null;
        if (bySystemIndex === null || bySystemIndex.dominantEmpire == null || bySystemIndex.dominantEmpire.empire == null) {
            num = galaxy.empireTerritory.checkLocationOwnership(galaxy, systemStar.xpos, systemStar.ypos);
        } else {
            if (bySystemIndex.otherEmpires != null && bySystemIndex.otherEmpires.length > 0) disputed = true;
            num = bySystemIndex.dominantEmpire.empire.empireId;
        }
        if (num >= 0) {
            return { empire: galaxy.empires.find((e) => e.empireId === num) ?? null, disputed };
        }
    }
    return { empire: null, disputed };
}

// Galaxy.3.cs FastFindNearestSpacePort(x, y, empire) (703).
export function fastFindNearestSpacePort(galaxy: Galaxy, x: number, y: number, empire: Empire): BuiltObject | null {
    let num = Number.MAX_VALUE;
    let result: BuiltObject | null = null;
    for (let i = 0; i < empire.spacePorts.length; i++) {
        const builtObject = empire.spacePorts[i];
        if (builtObject != null) {
            const num2 = galaxy.calculateDistanceSquared(x, y, builtObject.xpos, builtObject.ypos);
            if (num2 < num && builtObject.isSpacePort) {
                result = builtObject;
                num = num2;
            }
        }
    }
    return result;
}

// Galaxy.7.cs DetermineClosestIndexEdgesCustom (2667). int math.
export function determineClosestIndexEdgesCustom(galaxy: Galaxy, x: number, y: number, indexBoundLeft: number, indexBoundRight: number, indexBoundTop: number, indexBoundBottom: number): { d: number; nearestX: number; nearestY: number } {
    const indexMaxX = galaxy.indexMaxX;
    const indexMaxY = galaxy.indexMaxY;
    let num = x - INDEX_SIZE * indexBoundLeft;
    if (num < 1 || INDEX_SIZE * indexBoundLeft <= 0) num = 536870911;
    let num2 = INDEX_SIZE * (indexBoundRight + 1) - x;
    if (num2 > indexMaxX * INDEX_SIZE || INDEX_SIZE * (indexBoundRight + 1) >= indexMaxX * INDEX_SIZE) num2 = 536870911;
    let num3 = y - INDEX_SIZE * indexBoundTop;
    if (num3 < 1 || INDEX_SIZE * indexBoundTop <= 0) num3 = 536870911;
    let num4 = INDEX_SIZE * (indexBoundBottom + 1) - y;
    if (num4 > indexMaxY * INDEX_SIZE || INDEX_SIZE * (indexBoundBottom + 1) >= indexMaxY * INDEX_SIZE) num4 = 536870911;
    let val: number;
    let nearestX: number;
    if (num < num2) {
        val = num;
        nearestX = -1;
    } else {
        val = num2;
        nearestX = 1;
    }
    let val2: number;
    let nearestY: number;
    if (num3 < num4) {
        val2 = num3;
        nearestY = -1;
    } else {
        val2 = num4;
        nearestY = 1;
    }
    if (indexBoundLeft <= 0 && nearestX === -1) nearestX = 1;
    if (indexBoundLeft >= indexMaxX && nearestX === 1) nearestX = -1;
    if (indexBoundBottom <= 0 && nearestY === -1) nearestY = 1;
    if (indexBoundBottom >= indexMaxY && nearestY === 1) nearestY = 1;
    return { d: Math.min(val, val2), nearestX, nearestY };
}

// Galaxy.5.cs GetBuiltObjectsAtLocation(x, y, range) (3117).
export function getBuiltObjectsAtLocation(galaxy: Galaxy, x: number, y: number, range: number): BuiltObject[] {
    const builtObjectList: BuiltObject[] = [];
    const idx = galaxy.resolveIndex(x, y); // (int)x / IndexSize + CorrectIndexCoords
    const x2 = idx.x;
    const y2 = idx.y;
    const grid = galaxy.builtObjectIndexGrid;
    builtObjectList.push(...grid[x2][y2]);
    const e = determineClosestIndexEdgesCustom(galaxy, Math.trunc(x), Math.trunc(y), x2, x2, y2, y2);
    if (e.d < range) {
        const num2 = x2 + e.nearestX;
        const num3 = y2 + e.nearestY;
        if (num3 < galaxy.indexMaxY && num3 >= 0) builtObjectList.push(...grid[x2][num3]);
        if (num2 < galaxy.indexMaxX && num2 >= 0) builtObjectList.push(...grid[num2][y2]);
        if (num2 < galaxy.indexMaxX && num2 >= 0 && num3 < galaxy.indexMaxY && num3 >= 0) builtObjectList.push(...grid[num2][num3]);
    }
    return builtObjectList;
}

// Galaxy.7.cs DetermineNonMiningBaseAtHabitat (327).
export function determineNonMiningBaseAtHabitat(habitat: Habitat): BuiltObject | null {
    for (let i = 0; i < habitat.basesAtHabitat.length; i++) {
        const builtObject = habitat.basesAtHabitat[i];
        if (
            builtObject != null &&
            (builtObject.subRole === S.GenericBase ||
                builtObject.subRole === S.EnergyResearchStation ||
                builtObject.subRole === S.WeaponsResearchStation ||
                builtObject.subRole === S.HighTechResearchStation ||
                builtObject.subRole === S.ResortBase ||
                builtObject.subRole === S.MonitoringStation ||
                builtObject.subRole === S.DefensiveBase)
        ) {
            return builtObject;
        }
    }
    return null;
}

// HabitatResourceList.IndexOf(resourceId, 0) >= 0 (125) / ContainsId (239).
function habitatHasResource(habitat: Habitat, resourceId: number): boolean {
    return habitat.resources.some((r) => r.resourceId === resourceId);
}

// HabitatResourceList.ContainsGroup (241).
export function habitatResourcesContainsGroup(galaxy: Galaxy, habitat: Habitat, group: ResourceGroup): boolean {
    for (const r of habitat.resources) {
        if (r != null && resourceGroupOf(galaxy.resourceSystem.resources[r.resourceId]) === group) return true;
    }
    return false;
}

// Galaxy.7.cs CountResourceSourcesForEmpire(empire, resourceId, includeConstructionShipsBuildingMiningStations) (445).
export function countResourceSourcesForEmpire(empire: Empire | null, resourceId: number, includeConstructionShipsBuildingMiningStations = false): number {
    let num = 0;
    const habitatList: Habitat[] = [];
    if (empire !== null) {
        if (empire.colonies != null) {
            for (let i = 0; i < empire.colonies.length; i++) {
                const habitat = empire.colonies[i];
                if (habitat != null && habitat.resources != null && habitatHasResource(habitat, resourceId)) {
                    habitatList.push(habitat);
                    num++;
                }
            }
        }
        if (empire.miningStations != null) {
            for (let j = 0; j < empire.miningStations.length; j++) {
                const builtObject = empire.miningStations[j];
                if (builtObject == null) continue;
                const parentHabitat = builtObject.parentHabitat;
                if (parentHabitat !== null && parentHabitat.resources != null && habitatHasResource(parentHabitat, resourceId)) {
                    habitatList.push(parentHabitat);
                    num++;
                }
            }
        }
        if (includeConstructionShipsBuildingMiningStations && empire.constructionShips != null) {
            // Galaxy.7.cs 487-503 (ported by M4g now that missions exist, missions/mission.ts).
            for (let k = 0; k < empire.constructionShips.length; k++) {
                const builtObject2 = empire.constructionShips[k] as BuiltObject | null;
                if (builtObject2 == null) continue;
                const mission = builtObjectMission(builtObject2.mission);
                if (mission !== null && mission.type === BuiltObjectMissionType.Build && mission.targetHabitat !== null) {
                    const targetHabitat = mission.targetHabitat;
                    if (targetHabitat !== null && !habitatList.includes(targetHabitat) && targetHabitat.resources != null && habitatHasResource(targetHabitat, resourceId)) {
                        num++;
                    }
                }
            }
        }
    }
    return num;
}

// Galaxy.cs ResolveRetrofitResourcesForBase (1634) + CalculateResourceLevelStockForBaseRetrofit (1647).
export function resolveRetrofitResourcesForBase(galaxy: Galaxy, empire: Empire): CargoList {
    const cargoList = new CargoList();
    const rs = galaxy.resourceSystem;
    for (let i = 0; i < rs.strategicResourcesOrderedByRelativeImportance.length; i++) {
        const resourceDefinition = rs.strategicResourcesOrderedByRelativeImportance[i];
        if (resourceDefinition != null) {
            let result = 0;
            const def = rs.resources[resourceDefinition.resourceId];
            if (def != null) {
                const imp = rs.relativeImportance.get(def.resourceId) ?? 0;
                result = !def.isFuel ? (!(imp > Math.fround(0.25)) ? 25 : 50) : 0;
            }
            cargoList.add(new Cargo(new ResourceRef(resourceDefinition.resourceId), result, empire));
        }
    }
    return cargoList;
}

// ---------------------------------------------------------------------------
// Space ports
// ---------------------------------------------------------------------------

// Empire.6.cs DetermineNewSpacePortLocations(colonies, newSpacePortAmount, excludeColoniesWithEnemiesPresent) (3205).
export function determineNewSpacePortLocations(galaxy: Galaxy, empire: Empire, colonies: Habitat[], newSpacePortAmount: number, excludeColoniesWithEnemiesPresent: boolean): Habitat[] {
    const habitatList: Habitat[] = [];
    if (newSpacePortAmount > 0) {
        const habitatList2: Habitat[] = [];
        habitatList2.push(...colonies);
        netSort(habitatList2, habitatCompareTo);
        habitatList2.reverse();
        const habitatList3: Habitat[] = [];
        for (let i = 0; i < empire.spacePorts.length; i++) {
            const builtObject = empire.spacePorts[i];
            if (builtObject.parentHabitat !== null) {
                const habitat = systemStarOf(galaxy, builtObject.parentHabitat);
                if (habitat !== null && !habitatList3.includes(habitat)) habitatList3.push(habitat);
            }
        }
        for (let j = 0; j < colonies.length; j++) {
            // TODO(port): Habitat.ConstructionQueue.ConstructionWaitQueue (ConstructionQueue.cs) is not
            // ported; no colony has anything queued at game start, so no space port is waiting.
            void colonies[j];
        }
        for (let k = 0; k < empire.builtObjects.length; k++) {
            const builtObject2 = empire.builtObjects[k];
            if (isSpacePortSubRole(builtObject2.subRole)) {
                const habitat4 = systemStarOf(galaxy, builtObject2.parentHabitat);
                if (habitat4 !== null && !habitatList3.includes(habitat4)) habitatList3.push(habitat4);
            }
        }
        const habitatList4: Habitat[] = [];
        for (const item3 of habitatList2) {
            const item = systemStarOf(galaxy, item3);
            if (habitatList3.includes(item as Habitat)) habitatList4.push(item3);
        }
        for (const item4 of habitatList4) {
            const index = habitatList2.indexOf(item4);
            if (index >= 0) habitatList2.splice(index, 1);
        }
        let num = 0;
        const num2 = empire.policy!.constructionSpaceportMinimumDistance * 1000.0; // C# dereferences Policy unguarded
        for (const item5 of habitatList2) {
            const builtObject3 = fastFindNearestSpacePort(galaxy, item5.xpos, item5.ypos, empire);
            if (builtObject3 !== null) {
                let num3 = galaxy.calculateDistance(item5.xpos, item5.ypos, builtObject3.xpos, builtObject3.ypos);
                if (!(num3 > num2)) continue;
                let flag = false;
                for (const item6 of habitatList) {
                    num3 = galaxy.calculateDistance(item5.xpos, item5.ypos, item6.xpos, item6.ypos);
                    if (num3 <= num2) {
                        flag = true;
                        break;
                    }
                }
                if (!flag) {
                    let flag2 = true;
                    if (excludeColoniesWithEnemiesPresent) {
                        flag2 = false;
                        const num4 = checkSystemEnemyShipLevel(empire, item5.systemIndex);
                        if (num4 <= 0 && (item5.invadingTroops === null || item5.invadingTroops.items.length <= 0)) flag2 = true;
                    }
                    if (flag2) {
                        habitatList.push(item5);
                        num++;
                    }
                }
                if (num >= newSpacePortAmount) return habitatList;
                continue;
            }
            let flag3 = true;
            if (excludeColoniesWithEnemiesPresent) {
                flag3 = false;
                const num5 = checkSystemEnemyShipLevel(empire, item5.systemIndex);
                if (num5 <= 0 && (item5.invadingTroops === null || item5.invadingTroops.items.length <= 0)) flag3 = true;
            }
            if (flag3) {
                habitatList.push(item5);
                num++;
            }
            if (num >= newSpacePortAmount) return habitatList;
        }
        return habitatList;
    }
    return habitatList;
}

// Port of Empire.6.cs CheckSystemEnemyShipLevel(SystemVisibility[systemIndex]) (3165): the raw firepower of the mobile,
// functional, foreign non-base ships among the system's cached threats (SystemVisibility.Threats, written by the threat
// evaluations — combat/threats.ts) that belong to a pirate faction we don't pay protection to, or to an empire we are at
// war with. No Rnd (ObtainPirateRelation / ObtainDiplomaticRelation may add a relation, as in the C#).
export function checkSystemEnemyShipLevel(empire: Empire, systemIndex: number): number {
    let num = 0;
    const system = systemIndex >= 0 ? empire.visibility.systemVisibility[systemIndex] : undefined;
    if (system != null && system.threats != null) {
        for (let i = 0; i < system.threats.length; i++) {
            const builtObject = system.threats[i];
            if (!(builtObject instanceof BuiltObject)) continue;
            if (builtObject.role === BuiltObjectRole.Base || builtObject.topSpeed <= 0 || !builtObject.isFunctional || builtObject.empire == null || builtObject.empire === empire) continue;
            if (builtObject.empire.pirateEmpireBaseHabitat !== null) {
                const pirateRelation = obtainPirateRelation(empire, builtObject.empire);
                if (pirateRelation != null && pirateRelation.type !== PirateRelationType.Protection) num += builtObject.firepowerRaw;
                continue;
            }
            const diplomaticRelation = obtainDiplomaticRelation(empire, builtObject.empire);
            if (diplomaticRelation != null && diplomaticRelation.type === DiplomaticRelationType.War) num += builtObject.firepowerRaw;
        }
    }
    return num;
}

// Galaxy.8.cs CreateSpacePorts(galaxy, empire, spacePortColonies) (1216).
export function createSpacePorts(galaxy: Galaxy, empire: Empire, spacePortColonies: Habitat[]): void {
    for (const spacePortColony of spacePortColonies) {
        buildSpacePortAtColony(galaxy, empire, spacePortColony);
    }
}

// Galaxy.8.cs BuildSpacePortAtColony(galaxy, empire, colony) (1224). Returns the port (C#: void).
export function buildSpacePortAtColony(galaxy: Galaxy, empire: Empire, colony: Habitat): BuiltObject | null {
    let design: Design | null = null;
    let num = HABITAT_LARGE_SPACE_PORT_POPULATION_REQUIREMENT;
    let num2 = HABITAT_MEDIUM_SPACE_PORT_POPULATION_REQUIREMENT;
    let num3 = HABITAT_SMALL_SPACE_PORT_POPULATION_REQUIREMENT;
    if (empire !== null && empire.policy !== null) {
        num = empire.policy.constructionSpaceportLargeColonyPopulationThreshold * 1000000;
        num2 = empire.policy.constructionSpaceportMediumColonyPopulationThreshold * 1000000;
        num3 = empire.policy.constructionSpaceportSmallColonyPopulationThreshold * 1000000;
    }
    if (colony.population.totalAmount > num) {
        design = designsFindNewestCanBuild(empire.designs, S.LargeSpacePort);
    } else if (colony.population.totalAmount > num2) {
        design = designsFindNewestCanBuild(empire.designs, S.MediumSpacePort);
    } else if (colony.population.totalAmount > num3) {
        design = designsFindNewestCanBuild(empire.designs, S.SmallSpacePort);
    }
    if (empire.colonies.length === 1 && design !== null && design.subRole === S.LargeSpacePort) {
        design = designsFindNewestCanBuild(empire.designs, S.MediumSpacePort);
    }
    if (design !== null) {
        design.buildCount++;
        const purchasePrice = design.calculateCurrentPurchasePrice(galaxy);
        const name = galaxy.generateBuiltObjectName(design, colony);
        const builtObject = new BuiltObject(design, name, galaxy, true);
        builtObject.purchasePrice = purchasePrice;
        builtObject.parentHabitat = colony;
        // C#: (double)(colony.Diameter / 6) + 15.0 — int division.
        const range = Math.trunc(colony.diameter / 6) + 15.0;
        const p = galaxy.selectRelativePoint(range);
        builtObject.parentOffsetX = p.x;
        builtObject.parentOffsetY = p.y;
        builtObject.heading = galaxy.selectRandomHeading();
        builtObject.targetHeading = builtObject.heading;
        builtObject.reDefine();
        builtObject.currentFuel = builtObject.fuelCapacity;
        builtObject.currentShields = builtObject.shieldsCapacity;
        builtObject.nearestSystemStar = systemStarOf(galaxy, colony);
        empire.addBuiltObjectToGalaxy(builtObject, colony, false, true, Math.trunc(builtObject.parentOffsetX), Math.trunc(builtObject.parentOffsetY));
        return builtObject;
    }
    return null;
}

// ---------------------------------------------------------------------------
// Base facilities
// ---------------------------------------------------------------------------

// Galaxy.7.cs DetermineColonyBaseInfo(colony, out hasSpacePort, out happinessModifier) (257).
function determineColonyBaseInfo(colony: Habitat): { hasSpacePort: boolean; happinessModifier: number } {
    let hasSpacePort = false;
    let happinessModifier = 0.0;
    if (colony.basesAtHabitat == null || colony.basesAtHabitat.length <= 0) return { hasSpacePort, happinessModifier };
    for (let i = 0; i < colony.basesAtHabitat.length; i++) {
        const builtObject = colony.basesAtHabitat[i];
        if (builtObject != null) {
            happinessModifier = Math.max(happinessModifier, (builtObject.medicalCapacity + builtObject.recreationCapacity) / 30.0);
            if (isSpacePortSubRole(builtObject.subRole)) hasSpacePort = true;
        }
    }
    return { hasSpacePort, happinessModifier };
}

// Habitat.cs CheckForSpacePortFacilities(galaxy) (2729).
export function checkForSpacePortFacilities(habitat: Habitat): void {
    habitat.hasSpacePort = false;
    if (habitat.population.totalAmount > 0) {
        const info = determineColonyBaseInfo(habitat);
        habitat.hasSpacePort = info.hasSpacePort;
        habitat.happinessModifier = Math.fround(info.happinessModifier);
    } else {
        habitat.happinessModifier = 0;
    }
    if (habitat.basesAtHabitat == null || habitat.basesAtHabitat.length <= 0) return;
    for (let i = 0; i < habitat.basesAtHabitat.length; i++) {
        const builtObject = habitat.basesAtHabitat[i];
        if (builtObject != null && !builtObject.hasBeenDestroyed && isSpacePortSubRole(builtObject.subRole)) habitat.hasSpacePort = true;
    }
}

// Empire.4.cs CheckColoniesForBaseFacilities (2570).
export function checkColoniesForBaseFacilities(empire: Empire): void {
    for (let i = 0; i < empire.colonies.length; i++) {
        const habitat = empire.colonies[i];
        checkForSpacePortFacilities(habitat);
    }
}

// ---------------------------------------------------------------------------
// Research stations
// ---------------------------------------------------------------------------

// Empire.5.cs CheckResearchStationAtLocation(habitat) (3671).
export function checkResearchStationAtLocation(galaxy: Galaxy, habitat: Habitat): boolean {
    if (habitat.category === HabitatCategoryType.Asteroid) habitat = galaxy.determineHabitatSystemStar(habitat);
    if (habitat.category === HabitatCategoryType.Star) {
        const builtObjectsAtLocation = getBuiltObjectsAtLocation(galaxy, habitat.xpos, habitat.ypos, Math.trunc(galaxy.maxSolarSystemSize * 2.1));
        for (let i = 0; i < builtObjectsAtLocation.length; i++) {
            const builtObject = builtObjectsAtLocation[i];
            // Operator precedence as in the C#: (bo != null && W > 0) || E > 0 || H > 0.
            if (
                ((builtObject != null && builtObject.researchWeapons > 0) || builtObject.researchEnergy > 0 || builtObject.researchHighTech > 0) &&
                builtObject.role === BuiltObjectRole.Base &&
                builtObject.subRole !== S.SmallSpacePort &&
                builtObject.subRole !== S.MediumSpacePort &&
                builtObject.subRole !== S.LargeSpacePort &&
                builtObject.nearestSystemStar === habitat
            ) {
                return true;
            }
        }
    } else if (habitat.basesAtHabitat != null && habitat.basesAtHabitat.length > 0) {
        for (let j = 0; j < habitat.basesAtHabitat.length; j++) {
            const b = habitat.basesAtHabitat[j];
            if (b.researchWeapons > 0 || b.researchEnergy > 0 || b.researchHighTech > 0) return true;
        }
    }
    return false;
}

// Empire.5.cs DetermineResearchStationLocation(allowOccupiedSystems, mustHaveBuildableResearchStationDesign,
// assignToResearchHabitats = true) (3575/3580). No Rnd.
export function determineResearchStationLocation(galaxy: Galaxy, empire: Empire, allowOccupiedSystems: boolean, mustHaveBuildableResearchStationDesign: boolean, assignToResearchHabitats = true): Habitat[] {
    if (mustHaveBuildableResearchStationDesign) {
        const design = designsFindNewestCanBuild(empire.designs, S.EnergyResearchStation);
        const design2 = designsFindNewestCanBuild(empire.designs, S.WeaponsResearchStation);
        const design3 = designsFindNewestCanBuild(empire.designs, S.HighTechResearchStation);
        if (design === null && design3 === null && design2 === null) return [];
    }
    const flag = checkConstructionShipAndMiningStationCanSurviveStorms(empire);
    const habitatList: Habitat[] = [];
    const list: number[] = [];
    for (let i = 0; i < galaxy.systems.length; i++) {
        const systemInfo = galaxy.systems[i];
        if (!systemInfo.hasResearchBonus || !empire.visibility.checkSystemExplored(systemInfo.systemStar.systemIndex)) continue;
        let flag2 = true;
        const empire2 = checkSystemOwnership(galaxy, systemInfo.systemStar).empire;
        if (empire2 !== null && empire2 !== empire) flag2 = false;
        if (allowOccupiedSystems) flag2 = true;
        const star = systemInfo.systemStar;
        if (!flag2 || checkNearPirateBase(galaxy, empire, star, Math.trunc(galaxy.maxSolarSystemSize * 2.1), star.xpos, star.ypos, null) || (!flag && checkInStorm(galaxy, star.xpos, star.ypos))) continue;
        const habitatList2: Habitat[] = [];
        const list2: number[] = [];
        // C# SystemInfo.Habitats (the star is not in it).
        const habitats = galaxy.systemHabitatsOf(i);
        for (let j = 0; j < habitats.length; j++) {
            if (habitats[j].researchBonus > 0) {
                habitatList2.push(habitats[j]);
                list2.push(habitats[j].researchBonus / 100.0);
            }
        }
        if (habitatList2.length <= 0 && star.researchBonus > 0) {
            habitatList2.push(star);
            list2.push(star.researchBonus / 100.0);
        }
        for (let k = 0; k < habitatList2.length; k++) {
            const habitat = habitatList2[k];
            let num = list2[k];
            if (habitat === null || checkResearchStationAtLocation(galaxy, habitat) || !checkEmpireTerritoryCanBuildAtHabitat(galaxy, empire, habitat)) continue;
            if (empire.policy!.researchIndustryFocus !== IndustryType.Undefined) {
                switch (habitat.researchBonusIndustry) {
                    case IndustryType.Weapon:
                        if (empire.policy!.researchIndustryFocus === IndustryType.Weapon) num *= 1.5;
                        break;
                    case IndustryType.Energy:
                        if (empire.policy!.researchIndustryFocus === IndustryType.Energy) num *= 1.5;
                        break;
                    case IndustryType.HighTech:
                        if (empire.policy!.researchIndustryFocus === IndustryType.HighTech) num *= 1.5;
                        break;
                }
            }
            const item = 1.0 - num;
            list.push(item);
            habitatList.push(habitat);
        }
    }
    // Array.Sort(keys, items): the keyed introsort moves items with their keys.
    const pairs = habitatList.map((h, n) => ({ key: list[n], item: h }));
    netSort(pairs, (a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    const habitatList3 = pairs.map((p) => p.item);
    if (assignToResearchHabitats) empire.researchHabitats = habitatList3;
    return habitatList3;
}

// Empire.cs AnnualResearchPotential / Research{Energy,HighTech,Weapons}Potential: researchTick.ts (M4k).

// Empire.5.cs AnalyzeNewResearchFacilities(out weapons, out energy, out highTech) (3495).
export function analyzeNewResearchFacilities(empire: Empire): { result: Design | null; weaponsResearchStation: Design | null; energyResearchStation: Design | null; highTechResearchStation: Design | null } {
    let result: Design | null = null;
    const energyResearchStation = designsFindNewestCanBuild(empire.designs, S.EnergyResearchStation);
    const weaponsResearchStation = designsFindNewestCanBuild(empire.designs, S.WeaponsResearchStation);
    const highTechResearchStation = designsFindNewestCanBuild(empire.designs, S.HighTechResearchStation);
    let num = researchPotential(empire, IndustryType.Energy);
    let num2 = researchPotential(empire, IndustryType.HighTech);
    let num3 = researchPotential(empire, IndustryType.Weapon);
    // Empire.5.cs 3504-3517: construction ships building a research base / GenericBase.
    const constructionShips = empire.constructionShips as BuiltObject[];
    for (let i = 0; i < constructionShips.length; i++) {
        const builtObject = constructionShips[i];
        const mission = builtObjectMission(builtObject.mission);
        if (mission !== null && mission.type !== BuiltObjectMissionType.Undefined && mission.type === BuiltObjectMissionType.Build && mission.design !== null) {
            const design = mission.design;
            if (design.subRole === S.GenericBase || design.subRole === S.EnergyResearchStation || design.subRole === S.WeaponsResearchStation || design.subRole === S.HighTechResearchStation) {
                num += design.researchEnergy;
                num2 += design.researchHighTech;
                num3 += design.researchWeapons;
            }
        }
    }
    // Empire.5.cs 3518-3548: research bases / generic bases / space ports under construction at colonies.
    const subRoles = [S.EnergyResearchStation, S.HighTechResearchStation, S.WeaponsResearchStation, S.GenericBase, S.SmallSpacePort, S.MediumSpacePort, S.LargeSpacePort];
    for (let j = 0; j < empire.colonies.length; j++) {
        const habitat = empire.colonies[j];
        if (habitat === null || habitat.constructionQueue === null) continue;
        const underConstruction = (habitat.constructionQueue as ConstructionQueue).getUnderConstruction(subRoles);
        if (underConstruction === null || underConstruction.length <= 0) continue;
        for (let k = 0; k < underConstruction.length; k++) {
            const builtObject2 = underConstruction[k];
            if (builtObject2 !== null && builtObject2.design !== null) {
                num += builtObject2.design.researchEnergy;
                num2 += builtObject2.design.researchHighTech;
                num3 += builtObject2.design.researchWeapons;
            }
        }
    }
    const num4 = num + num2 + num3;
    let num5 = annualResearchPotential(empire) * 1.25;
    num5 *= empire.policy!.researchPriority;
    if (num5 > num4) {
        if (empire.policy!.researchIndustryFocus !== IndustryType.Undefined) {
            switch (empire.policy!.researchIndustryFocus) {
                case IndustryType.Weapon:
                    num3 /= 2.0;
                    break;
                case IndustryType.Energy:
                    num /= 2.0;
                    break;
                case IndustryType.HighTech:
                    num2 /= 2.0;
                    break;
            }
        }
        result = num <= num3 && num <= num2 ? energyResearchStation : !(num3 <= num) || !(num3 <= num2) ? highTechResearchStation : weaponsResearchStation;
    }
    return { result, weaponsResearchStation, energyResearchStation, highTechResearchStation };
}

// Galaxy.8.cs CreateResearchStations(galaxy, empire, allowEmpiresToStartInSameSystem) (1035). Rnd: see header.
export function createResearchStations(galaxy: Galaxy, empire: Empire, allowEmpiresToStartInSameSystem: boolean): void {
    const num = 1 + Math.trunc(empire.colonies.length * 0.35);
    let num2 = 0;
    if (empire.researchHabitats.length > 0 && num > 0) {
        let num3 = 0;
        let design: Design | null = null;
        const num4 = Math.trunc(empire.researchHabitats.length / num);
        let num5 = 0;
        while (design === null && num5 < empire.researchHabitats.length && num5 < 200) {
            num5++;
            const num6 = 0;
            while (num3 >= empire.researchHabitats.length && num6 < 10) {
                num3 -= empire.researchHabitats.length;
            }
            let habitat = empire.researchHabitats[num3];
            const own = checkSystemOwnership(galaxy, galaxy.systems[habitat.systemIndex].systemStar);
            const empire2 = own.empire;
            const disputed = own.disputed;
            if (
                (allowEmpiresToStartInSameSystem || empire2 === null || empire2 === empire || disputed) &&
                checkEmpireTerritoryCanBuildAtHabitat(galaxy, empire, habitat) &&
                determineMiningStationAtHabitatForEmpire(habitat, empire) === null &&
                determineNonMiningBaseAtHabitat(habitat) === null &&
                (habitat.empire === null || habitat.empire === galaxy.independentEmpire)
            ) {
                const analysis = analyzeNewResearchFacilities(empire);
                design = analysis.result;
                switch (habitat.researchBonusIndustry) {
                    case IndustryType.Weapon:
                        design = analysis.weaponsResearchStation;
                        break;
                    case IndustryType.Energy:
                        design = analysis.energyResearchStation;
                        break;
                    case IndustryType.HighTech:
                        design = analysis.highTechResearchStation;
                        break;
                }
                // (C# 1076-1090: TextResolver.GetText of the station kind, result unused.)
                if (design !== null) {
                    let x: number;
                    let y: number;
                    if (habitat.category === HabitatCategoryType.Star) {
                        let num7 = 0.0;
                        let habitat2: Habitat | null = null;
                        for (const asteroidField of galaxy.asteroidFields) {
                            if (asteroidField.length <= 0 || asteroidField[0].parent !== habitat) continue;
                            let num8 = 0;
                            while (habitat2 === null && num8 < 20) {
                                habitat2 = asteroidField[galaxy.rnd.next(0, asteroidField.length)];
                                const builtObject = galaxy.findNearestBuiltObject(Math.trunc(habitat2.xpos), Math.trunc(habitat2.ypos), BuiltObjectRole.Base);
                                if (builtObject !== null) {
                                    const num9 = galaxy.calculateDistance(habitat2.xpos, habitat2.ypos, builtObject.xpos, builtObject.ypos);
                                    if (num9 < 200.0) habitat2 = null;
                                }
                                num8++;
                            }
                        }
                        if (habitat2 !== null) {
                            habitat = habitat2;
                            const p = galaxy.selectRelativeHabitatSurfacePoint(habitat);
                            x = p.x;
                            y = p.y;
                        } else {
                            num7 = habitat.diameter;
                            if (habitat.type === HabitatType.BlackHole) num7 = habitat.diameter * 0.7;
                            else if (habitat.type === HabitatType.SuperNova) num7 = habitat.diameter * 0.1;
                            else if (habitat.type === HabitatType.Neutron) num7 = habitat.diameter * 2.0;
                            const p = galaxy.selectRelativeParkingPoint(num7);
                            x = p.x;
                            y = p.y;
                        }
                    } else {
                        const p = galaxy.selectRelativeHabitatSurfacePoint(habitat);
                        x = p.x;
                        y = p.y;
                    }
                    let builtObject2 = galaxy.findNearestBuiltObject(Math.trunc(habitat.xpos + x), Math.trunc(habitat.ypos + y), BuiltObjectRole.Base);
                    let num10 = Number.MAX_VALUE;
                    if (builtObject2 !== null) num10 = galaxy.calculateDistance(habitat.xpos + x, habitat.ypos + y, builtObject2.xpos, builtObject2.ypos);
                    let num11 = 0;
                    const iterationCount = { value: 0 };
                    while (conditionCheckLimit(num10 < MINIMUM_DISTANCE_BETWEEN_BASES, 50, iterationCount)) {
                        const p = galaxy.selectRelativeHabitatSurfacePoint(habitat);
                        x = p.x;
                        y = p.y;
                        builtObject2 = galaxy.findNearestBuiltObject(Math.trunc(habitat.xpos + x), Math.trunc(habitat.ypos + y), BuiltObjectRole.Base);
                        if (builtObject2 !== null) {
                            num10 = galaxy.calculateDistance(habitat.xpos + x, habitat.ypos + y, builtObject2.xpos, builtObject2.ypos);
                            num11++;
                            if (num11 > 5) break;
                        } else {
                            num10 = Number.MAX_VALUE;
                        }
                    }
                    if (num10 >= MINIMUM_DISTANCE_BETWEEN_BASES) {
                        design.buildCount++;
                        const purchasePrice = design.calculateCurrentPurchasePrice(galaxy);
                        const name = galaxy.generateBuiltObjectName(design, habitat);
                        const builtObject3 = new BuiltObject(design, name, galaxy, true);
                        builtObject3.purchasePrice = purchasePrice;
                        builtObject3.parentHabitat = habitat;
                        builtObject3.parentOffsetX = x;
                        builtObject3.parentOffsetY = y;
                        builtObject3.heading = galaxy.selectRandomHeading();
                        builtObject3.targetHeading = builtObject3.heading;
                        builtObject3.reDefine();
                        builtObject3.currentFuel = builtObject3.fuelCapacity;
                        builtObject3.currentShields = builtObject3.shieldsCapacity;
                        builtObject3.nearestSystemStar = systemStarOf(galaxy, habitat);
                        empire.addBuiltObjectToGalaxy(builtObject3, habitat, false, true, Math.trunc(builtObject3.parentOffsetX), Math.trunc(builtObject3.parentOffsetY));
                        if ((habitat === null || habitat.empire !== empire) && builtObject3.cargo !== null) {
                            const cargoList = resolveRetrofitResourcesForBase(galaxy, empire);
                            for (let i = 0; i < cargoList.items.length; i++) builtObject3.cargo.add(cargoList.items[i]);
                        }
                        num2++;
                        num3 += num4;
                        const num12 = 0;
                        while (num3 >= empire.researchHabitats.length && num12 < 10) {
                            num3 -= empire.researchHabitats.length;
                        }
                        if (num2 >= num) break;
                    }
                    design = null;
                }
            }
            num3++;
        }
    }
    determineResearchStationLocation(galaxy, empire, false, true);
}

// ---------------------------------------------------------------------------
// Mining stations
// ---------------------------------------------------------------------------

// Empire.6.cs CheckResourceSupplyMeetsExpected(resource, isCriticalEmpireResource, oversupplyFactor = 1.0) (1535/1540).
export function checkResourceSupplyMeetsExpectedBool(galaxy: Galaxy, empire: Empire, resourceId: number, isCriticalEmpireResource: boolean, oversupplyFactor = 1.0): boolean {
    const def = galaxy.resourceSystem.resources[resourceId];
    const isFuel = def.isFuel; // Resource.IsFuel
    const relativeImportance = galaxy.resourceSystem.relativeImportance.get(resourceId) ?? 0; // Resource.RelativeImportance (float)
    let num = 1;
    if (empire.pirateEmpireBaseHabitat === null) {
        let num2 = 3;
        let num3 = 3;
        let num4 = 2;
        if (!checkEmpireHasHyperDriveTech(empire)) {
            num2 = 2;
            num3 = 1;
            num4 = 1;
        }
        if (isFuel) {
            num = num2 + Math.trunc(empire.colonies.length / 2.0);
            num = Math.min(50, num);
        } else if (relativeImportance > 0.5) {
            num = num3 + Math.trunc(empire.colonies.length / 3.0);
            num = Math.min(50, num);
        } else if (relativeImportance > 0.25) {
            num = num4 + Math.trunc(empire.colonies.length / 4.0);
            num = Math.min(50, num);
        } else {
            num = 1 + Math.trunc(empire.colonies.length / 6);
        }
        if (isCriticalEmpireResource) {
            num = Math.max(num, num4 + Math.trunc(empire.colonies.length / 3));
            num = Math.min(40, num);
        }
    } else if (isFuel) {
        num = 2 + Math.trunc(empire.spacePorts.length / 2.0);
        num = Math.min(50, num);
    } else if (relativeImportance > 0.5) {
        num = 1 + Math.trunc(empire.spacePorts.length / 4.0);
        num = Math.min(50, num);
    } else {
        num = 1;
    }
    num = Math.trunc(num * oversupplyFactor);
    const num5 = countResourceSourcesForEmpire(empire, resourceId, true);
    if (num5 < num) return false;
    return true;
}

// Empire.6.cs IdentifyStrategicResourceSupplySource(resource) (1755).
export function identifyStrategicResourceSupplySource(empire: Empire, resourceId: number): Habitat | null {
    let num = 0;
    let result: Habitat | null = null;
    for (let i = 0; i < empire.resourceTargets.length; i++) {
        const habitatPrioritization = empire.resourceTargets[i];
        if (habitatPrioritization != null && habitatPrioritization.habitat !== null && habitatPrioritization.habitat.resources != null) {
            if (habitatHasResource(habitatPrioritization.habitat, resourceId) && habitatPrioritization.priority > num) {
                num = habitatPrioritization.priority;
                result = habitatPrioritization.habitat;
                break;
            }
        }
    }
    return result;
}

// ResourceTargets.IndexOf(habitat) / RemoveAt.
function removeResourceTarget(empire: Empire, habitat: Habitat): void {
    const index = habitatPrioritizationIndexOf(empire.resourceTargets, habitat);
    if (index >= 0) empire.resourceTargets.splice(index, 1);
}

// Empire.6.cs CheckResourceSupplyMeetsExpected(resource) (1602) →
// (resource, isCriticalEmpireResource = false, empireHabitatsBeingMined = null) (1607).
export function checkResourceSupplyMeetsExpected(galaxy: Galaxy, empire: Empire, resourceId: number, isCriticalEmpireResource = false, empireHabitatsBeingMined: Habitat[] | null = null): Habitat | null {
    let habitat: Habitat | null = null;
    if (!checkResourceSupplyMeetsExpectedBool(galaxy, empire, resourceId, isCriticalEmpireResource)) {
        let num = 0;
        while (habitat === null && num < 50) {
            habitat = identifyStrategicResourceSupplySource(empire, resourceId);
            if (habitat === null) break;
            // Empire.5.cs CheckNearPirateBase(Habitat, x, y) (3440): public overload, empireToExclude = null.
            if (checkNearPirateBase(galaxy, empire, habitat, Math.trunc(galaxy.maxSolarSystemSize * 2.1), habitat.xpos, habitat.ypos, null)) {
                removeResourceTarget(empire, habitat);
                habitat = null;
            } else if (empireHabitatsBeingMined === null) {
                if (determineMiningStationAtHabitatForEmpire(habitat, empire) !== null) {
                    removeResourceTarget(empire, habitat);
                    habitat = null;
                }
            } else if (empireHabitatsBeingMined.includes(habitat)) {
                removeResourceTarget(empire, habitat);
                habitat = null;
            }
            num++;
        }
    }
    return habitat;
}

// Galaxy.8.cs CreateMiningStations(galaxy, empire, allowEmpiresToStartInSameSystem) (804). Rnd: see header.
export function createMiningStations(galaxy: Galaxy, empire: Empire, allowEmpiresToStartInSameSystem: boolean): void {
    let val = Math.trunc(empire.colonies.length * 1.5);
    let num = 0;
    if (galaxy.startingAge === 0 && empire.colonies.length === 1) val = 6;
    val = Math.max(6, val);
    empire.resourceTargets = identifyResourceCentres(galaxy, empire);
    let num2 = 0;
    const ordered = galaxy.resourceSystem.strategicResourcesOrderedByRelativeImportance;
    for (let i = 0; i < ordered.length; i++) {
        num2 = 0;
        const resourceId = ordered[i].resourceId;
        while (num < val && createMiningStation(galaxy, checkResourceSupplyMeetsExpected(galaxy, empire, resourceId), empire, allowEmpiresToStartInSameSystem) && num2 < 50) {
            num++;
            num2++;
        }
    }
    const iterationCount = { value: 0 };
    while (conditionCheckLimit(empire.resourceTargets.length > 0 && num < val, 50, iterationCount)) {
        if (createMiningStation(galaxy, empire.resourceTargets[0].habitat, empire, allowEmpiresToStartInSameSystem)) num++;
    }
}

// Galaxy.8.cs CreateMiningStation(galaxy, habitat, empire, allowEmpiresToStartInSameSystem) (835). Rnd: see header.
export function createMiningStation(galaxy: Galaxy, habitat: Habitat | null, empire: Empire, allowEmpiresToStartInSameSystem: boolean): boolean {
    if (habitat !== null) {
        const systemStar = systemStarOf(galaxy, habitat);
        const own = checkSystemOwnership(galaxy, systemStar);
        const empire2 = own.empire;
        const disputed = own.disputed;
        if ((allowEmpiresToStartInSameSystem || empire2 === null || empire2 === empire || disputed) && checkEmpireTerritoryCanBuildAtHabitat(galaxy, empire, habitat) && determineMiningStationAtHabitatForEmpire(habitat, empire) === null && habitat.empire === null) {
            let design: Design | null = null;
            if (habitatResourcesContainsGroup(galaxy, habitat, ResourceGroup.Gas)) design = designsFindNewestCanBuild(empire.designs, S.GasMiningStation);
            if (habitatResourcesContainsGroup(galaxy, habitat, ResourceGroup.Mineral)) design = designsFindNewestCanBuild(empire.designs, S.MiningStation);
            if (design !== null) {
                const p = galaxy.selectRelativeHabitatSurfacePoint(habitat);
                const x = p.x;
                const y = p.y;
                let flag = false;
                if (habitat.basesAtHabitat != null && habitat.basesAtHabitat.length > 0) flag = true;
                if (!flag) {
                    design.buildCount++;
                    const purchasePrice = design.calculateCurrentPurchasePrice(galaxy);
                    const name = galaxy.generateBuiltObjectName(design, habitat);
                    const builtObject = new BuiltObject(design, name, galaxy, true);
                    builtObject.purchasePrice = purchasePrice;
                    builtObject.parentHabitat = habitat;
                    builtObject.parentOffsetX = x;
                    builtObject.parentOffsetY = y;
                    builtObject.heading = galaxy.selectRandomHeading();
                    builtObject.targetHeading = builtObject.heading;
                    builtObject.reDefine();
                    builtObject.currentFuel = builtObject.fuelCapacity;
                    builtObject.currentShields = builtObject.shieldsCapacity;
                    builtObject.nearestSystemStar = systemStarOf(galaxy, habitat);
                    empire.addBuiltObjectToGalaxy(builtObject, habitat, false, false, Math.trunc(builtObject.parentOffsetX), Math.trunc(builtObject.parentOffsetY));
                    if ((habitat === null || habitat.empire !== empire) && builtObject.cargo !== null) {
                        const cargoList = resolveRetrofitResourcesForBase(galaxy, empire);
                        for (let i = 0; i < cargoList.items.length; i++) builtObject.cargo.add(cargoList.items[i]);
                    }
                    return true;
                }
            }
        }
        removeResourceTarget(empire, habitat);
    }
    return false;
}

// ---------------------------------------------------------------------------
// Luxury resources
// ---------------------------------------------------------------------------

// Empire.4.cs CheckResourceSelfSupplied(resourceId, canExtract) (1886).
function checkResourceSelfSupplied(empire: Empire, resourceId: number, canExtract: boolean): boolean {
    for (let i = 0; i < empire.colonies.length; i++) {
        if (habitatHasResource(empire.colonies[i], resourceId)) return true;
    }
    if (canExtract) {
        for (let j = 0; j < empire.miningStations.length; j++) {
            const builtObject = empire.miningStations[j];
            if (builtObject.parentHabitat !== null && habitatHasResource(builtObject.parentHabitat, resourceId)) return true;
        }
    }
    return false;
}

// Empire.4.cs CheckResourceAvailable(resourceId, canExtract) (1851).
function checkResourceAvailable(empire: Empire, resourceId: number, canExtract: boolean): boolean {
    if (checkResourceSelfSupplied(empire, resourceId, canExtract)) {
        (empire.selfSuppliedLuxuryResources as ResourceRef[]).push(new ResourceRef(resourceId));
        return true;
    }
    for (let i = 0; i < empire.resourceTargets.length; i++) {
        const habitatPrioritization = empire.resourceTargets[i];
        const h = habitatPrioritization.habitat as Habitat;
        if (!canExtract) {
            if (h.population != null && h.population.totalAmount > 0) {
                if (habitatHasResource(h, resourceId)) return true;
            }
        } else if (habitatHasResource(h, resourceId)) {
            return true;
        }
    }
    return false;
}

// Empire.4.cs IdentifyUnavailableLuxuryResources (1827).
export function identifyUnavailableLuxuryResources(galaxy: Galaxy, empire: Empire): void {
    let canExtract = false;
    if (empire.research != null && empire.research.evaluateDesiredComponent(ComponentType.ExtractorLuxury, ShipDesignFocus.Balanced) !== null) canExtract = true;
    if (empire.selfSuppliedLuxuryResources === null) empire.selfSuppliedLuxuryResources = [];
    empire.selfSuppliedLuxuryResources.length = 0;
    empire.unavailableLuxuryResources.length = 0;
    const lux = galaxy.resourceSystem.luxuryResources;
    // Perf: checkResourceAvailable scans every colony, mining station and resource target per luxury resource. The
    // loop only appends to the two lists above, so the resource ids those scans can find are gathered once (as sets)
    // and each resource is answered by lookup: the same true/false and the same pushes in the same order. A null
    // entry (where the scan would throw) sends the whole call through the original per-resource scans.
    const available = luxuryAvailabilitySets(empire, canExtract);
    for (let i = 0; i < lux.length; i++) {
        const resourceDefinition = lux[i];
        if (resourceDefinition == null) continue;
        const resourceId = resourceDefinition.resourceId;
        let ok: boolean;
        if (available === null) {
            ok = checkResourceAvailable(empire, resourceId, canExtract);
        } else if (available.selfSupplied.has(resourceId)) {
            (empire.selfSuppliedLuxuryResources as ResourceRef[]).push(new ResourceRef(resourceId));
            ok = true;
        } else {
            ok = available.targets.has(resourceId);
        }
        if (!ok) empire.unavailableLuxuryResources.push(new ResourceRef(resourceId));
    }
}

/**
 * Resource ids checkResourceSelfSupplied / the resource-target loop of checkResourceAvailable would find for this
 * empire, or null when a colony / station parent / target habitat entry is null or has a null resource (the scans
 * would throw on it; the caller then runs them as they are).
 */
function luxuryAvailabilitySets(empire: Empire, canExtract: boolean): { selfSupplied: Set<number>; targets: Set<number> } | null {
    const selfSupplied = new Set<number>();
    const targets = new Set<number>();
    const addAll = (h: Habitat | null | undefined, into: Set<number>): boolean => {
        if (h == null || h.resources == null) return false;
        for (const r of h.resources) {
            if (r == null) return false;
            into.add(r.resourceId);
        }
        return true;
    };
    for (let i = 0; i < empire.colonies.length; i++) if (!addAll(empire.colonies[i], selfSupplied)) return null;
    if (canExtract) {
        for (let j = 0; j < empire.miningStations.length; j++) {
            const builtObject = empire.miningStations[j];
            if (builtObject == null) return null;
            if (builtObject.parentHabitat !== null && !addAll(builtObject.parentHabitat, selfSupplied)) return null;
        }
    }
    for (let i = 0; i < empire.resourceTargets.length; i++) {
        const habitatPrioritization = empire.resourceTargets[i];
        if (habitatPrioritization == null) return null;
        const h = habitatPrioritization.habitat as Habitat | null;
        if (h == null) return null;
        if (!canExtract) {
            if (h.population != null && h.population.totalAmount > 0 && !addAll(h, targets)) return null;
        } else if (!addAll(h, targets)) {
            return null;
        }
    }
    return { selfSupplied, targets };
}

// Habitat.cs RecalculateDevelopmentLevelBaseline (5575): developmentLevel.ts.

// Galaxy.8.cs SetLuxuryResourcesAtColonies(galaxy, empire) (899). No Rnd.
export function setLuxuryResourcesAtColonies(galaxy: Galaxy, empire: Empire): void {
    identifyUnavailableLuxuryResources(galaxy, empire);
    const selfSuppliedLuxuryResources = empire.selfSuppliedLuxuryResources as ResourceRef[];
    for (let i = 0; i < empire.colonies.length; i++) {
        const habitat = empire.colonies[i];
        const num = Math.max(500000000, habitat.population.totalAmount);
        const cautionLevel = (habitat.population.dominantRace as NonNullable<typeof habitat.population.dominantRace>).caution; // Race.CautionLevel
        let num2 = Math.trunc(COLONY_ANNUAL_LUXURY_RESOURCE_CONSUMPTION_RATE * num * (cautionLevel / 100.0) * 5.0);
        num2 = Math.max(num2 * 3, MINIMUM_LUXURY_RESOURCE_REORDER_AMOUNT);
        num2 = Math.max(400, num2);
        // (int)Math.Sqrt(TotalAmount / 100000000) — long division first.
        let val = 3 + Math.trunc(Math.sqrt(Math.trunc(habitat.population.totalAmount / 100000000)));
        val = Math.min(val, Math.min(10, selfSuppliedLuxuryResources.length));
        for (let j = 0; j < val; j++) {
            const resource = selfSuppliedLuxuryResources[j];
            const cargo = new Cargo(new ResourceRef(resource.resourceId), num2, empire);
            // Habitat.Cargo is created by TakeOwnershipOfColony; colonies always have one.
            (habitat.cargo as CargoList).add(cargo);
        }
        recalculateDevelopmentLevelBaseline(habitat);
        // Habitat.SetDevelopmentLevel clamps to [0, 50]; val * 5 <= 50 here.
        habitat.setDevelopmentLevel(val * 5);
    }
}
