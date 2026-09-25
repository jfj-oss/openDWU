// M4s (s2) — pirate ship mission AI: Empire.1.cs 4385 PirateAssignShipMissions / 4424-5505 PirateAssignShipMission and
// the Galaxy searches it uses (Galaxy.7.cs 1126 FindNearestKnownBaseForPirateAttack, 1051/1056
// FindNearestKnownBaseOfEmpireForPirateAttack, 1210 FindNearestBaseForPirateAttack, Galaxy.6.cs 3536
// FastFindNearestUncolonizedOwnedSystem, Galaxy.9.cs 126 IdentifyPirateNewHomeLocation, Galaxy.7.cs 2409
// FastFindNearestFuelHabitatAlternate), Empire.8.cs 1364 CalculateDefendingStrength (BuiltObject target) and
// Empire.2.cs 723 CalculateCashReservesForNewPirateFacilities.
//
// Free functions, C# `this` first (plan §3.1). Every Galaxy.Rnd draw is on galaxy.rnd in C# order.

import { calculateDefendingStrength, fastFindNearestFuelHabitatAlternate } from '../fleets/militaryAI';
import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import type { BuiltObject } from '../builtObject';
import type { Design } from '../design';
import { HabitatType, type Habitat } from '../types';
import { BuiltObjectSubRole } from '../builtObjectTypes';
import { BuiltObjectRole } from '../data/designSpecifications';
import { ResourceGroup, resourceGroupOf } from '../resourceSystem';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, builtObjectMission } from '../missions/mission';
import { assignMission } from '../missions/assign';
import { leaveShipGroup } from '../fleets/shipGroup';
import { shipGroupOf, fastFindNearestColony, determineDefendingStrength } from '../combat/threats';
import { determineDestroyOrCaptureTarget } from '../combat/attackAI';
import { MAX_SOLAR_SYSTEM_SIZE, withinFuelRange, withinFuelRangeAndRefuel } from '../movement';
import { setupRefuelling } from '../logistics/refuel';
import { assignRepairMission } from '../construction/repair';
import {
    assignRetrofitMission,
    assignScrapMission,
    calculateAccurateAnnualCashflow,
    calculateSpareAnnualRevenueComplete,
    designCalculateMaintenanceCosts,
    determineHabitatsBeingMinedIncludingBuildingMiningStations,
    determineHabitatsWithBasesIncludingBuilding,
} from '../construction/empireConstruction';
import {
    MINING_STATION_RESOURCE_THRESHHOLD,
    assignBuildResortBaseMissionToBuiltObject,
    assignMigrationMissionToBuiltObject,
    assignTourismMissionToBuiltObject,
    buildStrategicResourceSupply,
    checkMiningStationForResourceClearance,
    checkShipCanSurviveStorms,
    checkWhetherAtLocation,
    countBuiltObjectsWithTargetHabitat,
    determineWhetherShouldRepair,
    findNextHabitatToExplore,
    findUnexploredRuinsOrLocations,
    selectBestSalvageableShip,
} from '../civilianAI';
import { checkInStorm, checkNearPirateBase, determineMiningStationAtHabitat } from '../resourceTargets';
import { checkAlreadyHaveMiningStationAtHabitat } from '../missions/cmdConstruction';
import { identifyDeficientEmpireResources } from '../industry';
import { MINIMUM_DISTANCE_BETWEEN_BASES, checkSystemOwnership, fastFindNearestSpacePort } from '../stationPlacement';
import { SECTOR_SIZE } from '../logistics/orders';
import { calculateSupportCost, checkEmpireHasHyperDriveTech, totalMobileMilitaryFirepower } from '../forceStructure';
import { findNewestCanBuild } from '../designGeneration';
import { latestDesignsFindNewestCanBuild, findNearestPirateFaction } from '../pirates';
import { isObjectVisibleToThisEmpire } from '../independentTraders';
import { identifyPirateBase } from '../characters';
import { GalaxyLocationType, type GalaxyLocation } from '../galaxyLocation';
import { SystemVisibilityStatus } from '../visibility';
import { conditionCheckLimit } from '../tick/builtObjectTick';
import { REAL_SECONDS_IN_GALACTIC_YEAR, galaxyStarDate } from '../tick/simTime';
import { PirateRelationType, obtainPirateRelation } from '../pirateRelations';
import { PiratePlayStyle } from '../pirates';
import { PlanetaryFacilityType } from '../researchSystem';
import { calculatePlanetaryFacilityCost, countPirateCriminalNetworks, definitionsFindFacilityByType, facilitiesCountCompletedByType, planetaryFacilityDefinitionsStatic } from '../construction/facilities';
import { EmpireActivityType } from './empireActivity';
import { calculateOverallStrengthFactor } from './missionsMarket';
import { pirateControlCheckEmpireHasRelationTypeWithAny } from './pirateAI';

const f = Math.fround;

function missionOf(bo: BuiltObject): ReturnType<typeof builtObjectMission> {
    return builtObjectMission(bo.mission);
}

/** HabitatResourceList.ContainsGroup (HabitatResourceList.cs 241). */
function resourcesContainsGroup(galaxy: Galaxy, habitat: Habitat, group: ResourceGroup): boolean {
    for (const r of habitat.resources) {
        if (r != null && resourceGroupOf(galaxy.resourceSystem.resources[r.resourceId]) === group) return true;
    }
    return false;
}

/** DesignList.FindNewestCanBuild(subRole) (DesignList.cs 148: the list's first design's empire). */
function designsFindNewestCanBuild(designs: Design[], subRole: BuiltObjectSubRole): Design | null {
    const listEmpire = designs.length > 0 && designs[0] != null ? (designs[0].empire as Empire | null) : null;
    return findNewestCanBuild(designs, subRole, listEmpire);
}

/** BuiltObjectList.cs 162 CountSpaceports. */
export function countSpaceports(list: readonly (BuiltObject | null)[]): number {
    let num = 0;
    for (let i = 0; i < list.length; i++) {
        const builtObject = list[i];
        if (builtObject != null && (builtObject.subRole === BuiltObjectSubRole.SmallSpacePort || builtObject.subRole === BuiltObjectSubRole.MediumSpacePort || builtObject.subRole === BuiltObjectSubRole.LargeSpacePort)) num++;
    }
    return num;
}

/** BuiltObjectList.cs 539 GetShipsAtHabitatNotLeaving(habitat, range). No Rnd. */
export function getShipsAtHabitatNotLeaving(list: readonly (BuiltObject | null)[], habitat: Habitat, range: number): BuiltObject[] {
    const builtObjectList: BuiltObject[] = [];
    const num = range * range;
    for (let i = 0; i < list.length; i++) {
        const builtObject = list[i];
        if (builtObject == null || builtObject.hasBeenDestroyed || builtObject.role === BuiltObjectRole.Base) continue;
        const dx = habitat.xpos - builtObject.xpos;
        const dy = habitat.ypos - builtObject.ypos;
        const num2 = dx * dx + dy * dy;
        if (!(num2 < num)) continue;
        const mission = missionOf(builtObject);
        if (mission === null || mission.type === BuiltObjectMissionType.Undefined) {
            builtObjectList.push(builtObject);
            continue;
        }
        const point = mission.resolveTargetCoordinates(mission);
        const ex = habitat.xpos - point.x;
        const ey = habitat.ypos - point.y;
        const num3 = ex * ex + ey * ey;
        if (num3 < num) builtObjectList.push(builtObject);
    }
    return builtObjectList;
}

/** Galaxy.7.cs 1126 FindNearestKnownBaseForPirateAttack(attackingPirateEmpire, x, y) + InIndex 1170. No Rnd. */
export function findNearestKnownBaseForPirateAttackOwn(galaxy: Galaxy, attackingPirateEmpire: Empire, x: number, y: number): BuiltObject | null {
    const empireList = attackingPirateEmpire.pirateRelations.resolveEmpiresWithProtection();
    if (!empireList.includes(attackingPirateEmpire)) empireList.push(attackingPirateEmpire);
    return galaxy.ringSearch<BuiltObject>(Math.trunc(x), Math.trunc(y), (cx, cy) => {
        let builtObject: BuiltObject | null = null;
        const array = galaxy.builtObjectIndexGrid[cx][cy].slice();
        let distance = Number.MAX_VALUE;
        for (const builtObject2 of array) {
            if (builtObject2 == null || builtObject2.hasBeenDestroyed || builtObject2.role !== BuiltObjectRole.Base || empireListContains(empireList, builtObject2.empire) || builtObject2.empire === galaxy.independentEmpire || builtObject2.empire === null) continue;
            const num = galaxy.calculateDistanceSquared(x, y, builtObject2.xpos, builtObject2.ypos);
            if (!(num < distance) || !isObjectVisibleToThisEmpire(galaxy, attackingPirateEmpire, builtObject2, true, false)) continue;
            const firstByTargetAndType = attackingPirateEmpire.pirateMissions.getFirstByTargetAndType(builtObject2, EmpireActivityType.Defend);
            if (firstByTargetAndType !== null) continue;
            let flag = true;
            if (builtObject2.empire !== null && builtObject2.empire !== attackingPirateEmpire && attackingPirateEmpire.pirateEmpireBaseHabitat !== null) {
                const pirateRelation = obtainPirateRelation(attackingPirateEmpire, builtObject2.empire);
                if (pirateRelation.type === PirateRelationType.Protection) flag = false;
            }
            if (flag) {
                builtObject = builtObject2;
                distance = num;
            }
        }
        if (builtObject !== null) distance = galaxy.calculateDistance(x, y, builtObject.xpos, builtObject.ypos);
        return { item: builtObject, distance };
    });
}

function empireListContains(list: readonly Empire[], empire: Empire | null): boolean {
    return empire !== null && list.includes(empire);
}

/** Galaxy.7.cs 1056 FindNearestKnownBaseOfEmpireForPirateAttack(attackingPirateEmpire, x, y, targetEmpire, attackStrength) + InIndex 1091. No Rnd. */
export function findNearestKnownBaseOfEmpireForPirateAttackOwn(galaxy: Galaxy, attackingEmpire: Empire, x: number, y: number, targetEmpire: Empire | null, attackStrength = 2147483647): BuiltObject | null {
    return galaxy.ringSearch<BuiltObject>(Math.trunc(x), Math.trunc(y), (cx, cy) => {
        let builtObject: BuiltObject | null = null;
        const builtObjectList = galaxy.builtObjectIndexGrid[cx][cy];
        let distance = Number.MAX_VALUE;
        for (let i = 0; i < builtObjectList.length; i++) {
            const builtObject2 = builtObjectList[i];
            if (builtObject2 == null || builtObject2.hasBeenDestroyed || builtObject2.role !== BuiltObjectRole.Base || builtObject2.empire !== targetEmpire) continue;
            const num = galaxy.calculateDistanceSquared(x, y, builtObject2.xpos, builtObject2.ypos);
            if (num < distance && isObjectVisibleToThisEmpire(galaxy, attackingEmpire, builtObject2, true, false)) {
                let num2 = 0;
                if (attackStrength < 2147483647) num2 = calculateDefendingStrength(galaxy, attackingEmpire, builtObject2).strength;
                if (attackStrength >= num2) {
                    builtObject = builtObject2;
                    distance = num;
                }
            }
        }
        if (builtObject !== null) distance = galaxy.calculateDistance(x, y, builtObject.xpos, builtObject.ypos);
        return { item: builtObject, distance };
    });
}

/** Galaxy.7.cs 1210 FindNearestBaseForPirateAttack(x, y, empireToExclude) + InIndex 1245. No Rnd. */
export function findNearestBaseForPirateAttackOwn(galaxy: Galaxy, x: number, y: number, empireToExclude: Empire | null): BuiltObject | null {
    return galaxy.ringSearch<BuiltObject>(Math.trunc(x), Math.trunc(y), (cx, cy) => {
        let builtObject: BuiltObject | null = null;
        const builtObjectList = galaxy.builtObjectIndexGrid[cx][cy];
        let distance = Number.MAX_VALUE;
        for (let i = 0; i < builtObjectList.length; i++) {
            const builtObject2 = builtObjectList[i];
            if (builtObject2 != null && builtObject2.role === BuiltObjectRole.Base && builtObject2.empire !== empireToExclude && builtObject2.empire !== galaxy.independentEmpire && builtObject2.empire !== null) {
                const num = galaxy.calculateDistanceSquared(x, y, builtObject2.xpos, builtObject2.ypos);
                if (num < distance) {
                    builtObject = builtObject2;
                    distance = num;
                }
            }
        }
        if (builtObject !== null) distance = galaxy.calculateDistance(x, y, builtObject.xpos, builtObject.ypos);
        return { item: builtObject, distance };
    });
}

/** Galaxy.6.cs 3536 FastFindNearestUncolonizedOwnedSystem(x, y) + FindNearestOwnedUncolonizedSystemInIndex 3571. No Rnd. */
export function fastFindNearestUncolonizedOwnedSystem(galaxy: Galaxy, x: number, y: number): Habitat | null {
    const ix = Math.trunc(x);
    const iy = Math.trunc(y);
    return galaxy.ringSearch<Habitat>(ix, iy, (cx, cy) => {
        let systemStar: Habitat | null = null;
        const systemInfoList = galaxy.systemsIndexGrid[cx][cy];
        let distance = Number.MAX_VALUE;
        for (let i = 0; i < systemInfoList.length; i++) {
            const owner = checkSystemOwnership(galaxy, systemInfoList[i].systemStar).empire;
            if (owner === null) continue;
            const systemInfo2 = galaxy.systems[systemInfoList[i].systemStar.systemIndex];
            if (systemInfo2 == null || (systemInfo2.dominantEmpire != null && systemInfo2.dominantEmpire.empire != null)) continue;
            let flag = true;
            // Empires.GetByEmpireId(num): only the normal empires list.
            if (galaxy.empires.includes(owner) && owner.reclusive) flag = false;
            if (flag) {
                const num2 = galaxy.calculateDistanceSquared(ix, iy, systemInfoList[i].systemStar.xpos, systemInfoList[i].systemStar.ypos);
                if (num2 < distance) {
                    systemStar = systemInfoList[i].systemStar;
                    distance = num2;
                }
            }
        }
        if (systemStar !== null) distance = galaxy.calculateDistance(ix, iy, systemStar.xpos, systemStar.ypos);
        return { item: systemStar, distance };
    });
}

/** Galaxy.9.cs 126 IdentifyPirateNewHomeLocation(pirateFaction). Rnd: 2 NextDouble per attempt (≤ 50 attempts). */
export function identifyPirateNewHomeLocation(galaxy: Galaxy, pirateFaction: Empire | null): Habitat | null {
    let habitat: Habitat | null = null;
    if (pirateFaction !== null) {
        let num = Math.trunc(galaxy.sizeX / 2);
        let num2 = Math.trunc(galaxy.sizeY / 2);
        let systemToExclude: Habitat | null = null;
        if (pirateFaction.pirateEmpireBaseHabitat !== null) {
            num = pirateFaction.pirateEmpireBaseHabitat.xpos;
            num2 = pirateFaction.pirateEmpireBaseHabitat.ypos;
            systemToExclude = galaxy.determineHabitatSystemStar(pirateFaction.pirateEmpireBaseHabitat);
        }
        const subRoles = [
            BuiltObjectSubRole.SmallSpacePort,
            BuiltObjectSubRole.MediumSpacePort,
            BuiltObjectSubRole.LargeSpacePort,
            BuiltObjectSubRole.MiningStation,
            BuiltObjectSubRole.GasMiningStation,
            BuiltObjectSubRole.EnergyResearchStation,
            BuiltObjectSubRole.HighTechResearchStation,
            BuiltObjectSubRole.WeaponsResearchStation,
            BuiltObjectSubRole.ResortBase,
            BuiltObjectSubRole.MonitoringStation,
            BuiltObjectSubRole.DefensiveBase,
        ];
        const habitatList = determineHabitatsWithBasesIncludingBuilding(galaxy, pirateFaction, subRoles);
        let resourceID = galaxy.resourceSystem.fuelResources[0].resourceId;
        const design = latestDesignsFindNewestCanBuild(pirateFaction, BuiltObjectSubRole.Frigate);
        if (design !== null && design.fuelType !== null) resourceID = design.fuelType.resourceId;
        let num3 = 0;
        let flag = false;
        let num4 = num;
        let num5 = num2;
        while (!flag && num3 < 50) {
            const num6 = 400000.0 + galaxy.rnd.nextDouble() * 400000.0;
            const num7 = galaxy.rnd.nextDouble() * Math.PI * 2.0;
            num4 += Math.sin(num7) * num6;
            num5 += Math.cos(num7) * num6;
            habitat = fastFindNearestFuelHabitatAlternate(galaxy, num4, num5, resourceID, pirateFaction.pirateEmpireBaseHabitat, pirateFaction, systemToExclude, false);
            if (habitat !== null) {
                const habitat2 = galaxy.findNearestColony(habitat.xpos, habitat.ypos, null, false);
                let num8 = Number.MAX_VALUE;
                if (habitat2 !== null) num8 = galaxy.calculateDistance(habitat.xpos, habitat.ypos, habitat2.xpos, habitat2.ypos);
                if (num8 > 500000.0) {
                    let flag2 = false;
                    const empire = findNearestPirateFaction(galaxy, habitat.xpos, habitat.ypos, pirateFaction, true);
                    if (empire !== null && empire.pirateEmpireBaseHabitat !== null) {
                        const num9 = galaxy.calculateDistance(habitat.xpos, habitat.ypos, empire.pirateEmpireBaseHabitat.xpos, empire.pirateEmpireBaseHabitat.ypos);
                        if (num9 < 1000000.0) flag2 = true;
                    }
                    if (!flag2 && (habitat.basesAtHabitat == null || habitat.basesAtHabitat.length <= 0) && !habitatList.includes(habitat)) flag = true;
                }
            }
            num3++;
        }
    }
    return habitat;
}

/** Empire.2.cs 723 CalculateCashReservesForNewPirateFacilities. No Rnd. */
export function calculateCashReservesForNewPirateFacilities(galaxy: Galaxy, empire: Empire): number {
    let num = 0.0;
    if (empire.pirateEmpireBaseHabitat !== null) {
        const defs = planetaryFacilityDefinitionsStatic(galaxy);
        // PlanetaryFacilityDefinitionsStatic[25] / [26] / [32]: the PirateBase / PirateFortress / PirateCriminalNetwork definitions.
        const planetaryFacility = definitionsFindFacilityByType(defs, PlanetaryFacilityType.PirateBase);
        const planetaryFacility2 = definitionsFindFacilityByType(defs, PlanetaryFacilityType.PirateFortress);
        const planetaryFacility3 = definitionsFindFacilityByType(defs, PlanetaryFacilityType.PirateCriminalNetwork);
        for (let i = 0; i < empire.colonies.length; i++) {
            const habitat = empire.colonies[i];
            if (habitat == null || habitat.hasBeenDestroyed || habitat.empire === empire) continue;
            const byFacilityControl = habitat.pirateColonyControl.getByFacilityControl();
            if (byFacilityControl === null) {
                const byFaction = habitat.pirateColonyControl.getByFaction(empire);
                if (byFaction !== null && byFaction.controlLevel >= f(0.5)) num = Math.max(num, calculatePlanetaryFacilityCost(planetaryFacility, empire));
            } else if (byFacilityControl.empireId === empire.empireId) {
                const facilities = habitat.facilities ?? [];
                const num2 = facilitiesCountCompletedByType(facilities, PlanetaryFacilityType.PirateBase);
                const num3 = facilitiesCountCompletedByType(facilities, PlanetaryFacilityType.PirateFortress);
                const num4 = facilitiesCountCompletedByType(facilities, PlanetaryFacilityType.PirateCriminalNetwork);
                if (num2 > 0 && num3 <= 0) num = Math.max(num, calculatePlanetaryFacilityCost(planetaryFacility2, empire));
                else if (num3 > 0 && num4 <= 0 && countPirateCriminalNetworks(galaxy, empire) <= 0) num = Math.max(num, calculatePlanetaryFacilityCost(planetaryFacility3, empire));
            }
        }
    }
    return num;
}

/** Empire.1.cs 4385 PirateAssignShipMissions(starDate). Rnd: PirateAssignShipMission's, per ship. */
export function pirateAssignShipMissionsCore(galaxy: Galaxy, empire: Empire, starDate: number): void {
    for (let i = 0; i < empire.builtObjects.length; i++) empire.builtObjects[i].currentEscortForceAssigned = 0;
    for (let j = 0; j < empire.privateBuiltObjects.length; j++) empire.privateBuiltObjects[j].currentEscortForceAssigned = 0;
    for (let k = 0; k < empire.builtObjects.length; k++) {
        const builtObject3 = empire.builtObjects[k];
        const m = missionOf(builtObject3);
        if (m !== null && (m.type === BuiltObjectMissionType.Escort || m.type === BuiltObjectMissionType.Patrol) && m.targetBuiltObject !== null) {
            const targetBuiltObject = m.targetBuiltObject;
            targetBuiltObject.currentEscortForceAssigned += builtObject3.firepowerRaw;
        }
    }
    for (let l = 0; l < empire.builtObjects.length; l++) {
        const builtObject4 = empire.builtObjects[l];
        if (builtObject4 != null && !builtObject4.hasBeenDestroyed) pirateAssignShipMissionCore(galaxy, empire, builtObject4, starDate);
    }
    for (let m = 0; m < empire.privateBuiltObjects.length; m++) {
        const builtObject5 = empire.privateBuiltObjects[m];
        if (builtObject5 != null && !builtObject5.hasBeenDestroyed) pirateAssignShipMissionCore(galaxy, empire, builtObject5, starDate);
    }
}

/** MoveAndWait with a waiting star date and allowReprocessing: false (Empire.1.cs 4611-4648 / 4692). */
function assignMoveAndWait(galaxy: Galaxy, ship: BuiltObject, target: Habitat, starDate2: number): void {
    assignMission(galaxy, ship, BuiltObjectMissionType.MoveAndWait, target, null, BuiltObjectMissionPriority.Normal, { x: -2000000001.0, y: -2000000001.0, starDate: starDate2, allowReprocessing: false });
}

/** Empire.1.cs 4424 PirateAssignShipMission(ship, starDate). Rnd: see the per-sub-role blocks. */
export function pirateAssignShipMissionCore(galaxy: Galaxy, empire: Empire, ship: BuiltObject | null, starDate: number): void {
    void starDate;
    if (ship === null || ship.hasBeenDestroyed || ship.role === BuiltObjectRole.Base || ship.topSpeed <= 0 || ship.builtAt !== null || !ship.isAutoControlled) return;
    {
        const m = missionOf(ship);
        if (m !== null && m.type !== BuiltObjectMissionType.Undefined) return;
    }
    // 4430-4448
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
    // 4449-4463
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
    // 4464-4478
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
    // 4479-4496
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
    switch (ship.subRole) {
        case BuiltObjectSubRole.ExplorationShip:
            pirateAssignExplorationShip(galaxy, empire, ship);
            break;
        case BuiltObjectSubRole.Escort:
        case BuiltObjectSubRole.Frigate:
        case BuiltObjectSubRole.Destroyer:
        case BuiltObjectSubRole.Cruiser:
        case BuiltObjectSubRole.CapitalShip:
        case BuiltObjectSubRole.Carrier:
            pirateAssignMilitaryShip(galaxy, empire, ship);
            break;
        case BuiltObjectSubRole.SmallFreighter:
        case BuiltObjectSubRole.MediumFreighter:
        case BuiltObjectSubRole.LargeFreighter:
            pirateAssignFreighter(galaxy, empire, ship);
            break;
        case BuiltObjectSubRole.ConstructionShip:
            pirateAssignConstructionShip(galaxy, empire, ship);
            break;
        case BuiltObjectSubRole.GasMiningShip:
        case BuiltObjectSubRole.MiningShip:
            pirateAssignMiningShip(galaxy, empire, ship);
            break;
        case BuiltObjectSubRole.PassengerShip:
            pirateAssignPassengerShip(galaxy, empire, ship);
            break;
        case BuiltObjectSubRole.TroopTransport:
        case BuiltObjectSubRole.ResupplyShip:
        case BuiltObjectSubRole.ColonyShip:
            break;
    }
}

/** Empire.1.cs 4499-4525 case ExplorationShip. Rnd: Next(0, 10) when nothing to explore (+ callees). */
function pirateAssignExplorationShip(galaxy: Galaxy, empire: Empire, ship: BuiltObject): void {
    const r = findNextHabitatToExplore(galaxy, ship.xpos, ship.ypos, ship.actualEmpire, ship);
    const habitat10 = r.habitat;
    const location = r.location;
    const locationEmpty = location.x === 0 && location.y === 0;
    if (!locationEmpty) {
        assignMission(galaxy, ship, BuiltObjectMissionType.Move, null, null, BuiltObjectMissionPriority.Normal, { x: location.x, y: location.y });
    } else if (habitat10 !== null) {
        assignMission(galaxy, ship, BuiltObjectMissionType.Explore, habitat10, null, BuiltObjectMissionPriority.Normal);
    }
    if (habitat10 === null && locationEmpty && galaxy.rnd.next(0, 10) === 1) {
        const r2 = findUnexploredRuinsOrLocations(galaxy, ship.xpos, ship.ypos, ship.empire!);
        const habitat11 = r2.habitat;
        const location2 = r2.location;
        if (habitat11 !== null) {
            assignMission(galaxy, ship, BuiltObjectMissionType.Move, habitat11, null, BuiltObjectMissionPriority.Normal);
        } else if (location2 !== null) {
            const c = location2.resolveLocationCenter();
            assignMission(galaxy, ship, BuiltObjectMissionType.Move, null, null, BuiltObjectMissionPriority.Normal, { x: c.x, y: c.y });
        }
    }
}

/** System threat check shared by the colonisation-target and colony loops (Empire.1.cs 4588-4617 / 4665-4693). */
function systemNeedsDefence(galaxy: Galaxy, empire: Empire, ship: BuiltObject, habitat: Habitat, requireThreatListForRaid: boolean): boolean {
    const systemVisibility = empire.visibility.systemVisibility[habitat.systemIndex];
    let flag = false;
    if (systemVisibility.status !== SystemVisibilityStatus.Visible) {
        flag = true;
    } else if (systemVisibility.empireStrength <= 0) {
        flag = true;
    } else {
        const shipsAtHabitatNotLeaving = getShipsAtHabitatNotLeaving(empire.builtObjects, habitat, 1500.0);
        const idx = shipsAtHabitatNotLeaving.indexOf(ship);
        if (idx >= 0) shipsAtHabitatNotLeaving.splice(idx, 1);
        const num5 = totalMobileMilitaryFirepower(shipsAtHabitatNotLeaving, empire);
        if (num5 <= 0) {
            flag = true;
        } else if (!requireThreatListForRaid || (systemVisibility.threats != null && systemVisibility.threats.length > 0)) {
            const threats = systemVisibility.threats!;
            for (let l = 0; l < threats.length; l++) {
                if (threats[l].role !== BuiltObjectRole.Base && threats[l].firepowerRaw > 0) {
                    flag = true;
                    break;
                }
            }
        }
    }
    return flag;
}

/** Empire.1.cs 4527-4895 case Escort … Carrier. Rnd: Next(0, 2), Next(0, relations), Next(0, 3|4|5), Next(0, 3), Next(0, 5), Next(0, habitats). */
function pirateAssignMilitaryShip(galaxy: Galaxy, empire: Empire, ship: BuiltObject): void {
    if (shipGroupOf(ship) !== null) return;
    const colonizationTargets = empire.colonizationTargets;
    if (colonizationTargets != null && colonizationTargets.length > 0) {
        const num2 = 2250000.0;
        // 4538-4558
        for (let i = 0; i < colonizationTargets.length; i++) {
            const habitat = colonizationTargets[i].habitat;
            if (habitat == null || habitat.hasBeenDestroyed) continue;
            let flag5 = true;
            const byFacilityControl = habitat.pirateColonyControl.getByFacilityControl();
            if (byFacilityControl !== null) flag5 = false;
            if (flag5) {
                const num3 = galaxy.calculateDistanceSquared(ship.xpos, ship.ypos, habitat.xpos, habitat.ypos);
                if (num3 < num2) return;
            }
        }
        // 4559-4579
        for (let j = 0; j < empire.colonies.length; j++) {
            const habitat2 = empire.colonies[j];
            if (habitat2 == null || habitat2.hasBeenDestroyed) continue;
            let flag6 = true;
            const byFacilityControl2 = habitat2.pirateColonyControl.getByFacilityControl();
            if (byFacilityControl2 !== null) flag6 = false;
            if (flag6) {
                const num4 = galaxy.calculateDistanceSquared(ship.xpos, ship.ypos, habitat2.xpos, habitat2.ypos);
                if (num4 < num2) return;
            }
        }
        // 4580-4659
        for (let k = 0; k < colonizationTargets.length; k++) {
            const habitat3 = colonizationTargets[k].habitat;
            if (habitat3 == null || habitat3.hasBeenDestroyed) continue;
            const systemVisibility = empire.visibility.systemVisibility[habitat3.systemIndex];
            if (systemVisibility == null || (systemVisibility.status === SystemVisibilityStatus.Visible && (systemVisibility.threats == null || systemVisibility.threats.length <= 0))) continue;
            const flag7 = systemNeedsDefence(galaxy, empire, ship, habitat3, false);
            if (!flag7 || !withinFuelRange(galaxy, ship, habitat3.xpos, habitat3.ypos, 0.1)) continue;
            const starDate2 = galaxyStarDate(galaxy) + Math.trunc(0.5 * REAL_SECONDS_IN_GALACTIC_YEAR * 1000.0);
            const firstByTargetAndType = empire.pirateMissions.getFirstByTargetAndType(habitat3, EmpireActivityType.Defend);
            if (firstByTargetAndType === null && ship.assaultStrength > 0) {
                const byFaction = habitat3.pirateColonyControl.getByFaction(empire);
                if (byFaction === null || byFaction.controlLevel < f(0.5)) {
                    if (pirateControlCheckEmpireHasRelationTypeWithAny(galaxy, habitat3.pirateColonyControl, empire, PirateRelationType.Protection)) {
                        assignMoveAndWait(galaxy, ship, habitat3, starDate2);
                        return;
                    }
                    let flag8 = true;
                    if (habitat3.owner !== null && habitat3.owner !== empire) {
                        const pirateRelation = obtainPirateRelation(empire, habitat3.owner);
                        if (pirateRelation.type === PirateRelationType.Protection) flag8 = false;
                    }
                    if (flag8) {
                        assignMission(galaxy, ship, BuiltObjectMissionType.Raid, habitat3, null, BuiltObjectMissionPriority.Normal, { manuallyAssigned: false });
                    } else {
                        assignMoveAndWait(galaxy, ship, habitat3, starDate2);
                    }
                } else {
                    assignMoveAndWait(galaxy, ship, habitat3, starDate2);
                }
            } else {
                assignMoveAndWait(galaxy, ship, habitat3, starDate2);
            }
            return;
        }
    }
    // 4661-4697
    if (empire.colonies != null && empire.colonies.length > 0) {
        for (let m = 0; m < empire.colonies.length; m++) {
            const habitat4 = empire.colonies[m];
            if (habitat4 == null || habitat4.hasBeenDestroyed) continue;
            const systemVisibility2 = empire.visibility.systemVisibility[habitat4.systemIndex];
            if (systemVisibility2 == null) continue;
            const flag9 = systemNeedsDefence(galaxy, empire, ship, habitat4, true);
            if (flag9 && withinFuelRange(galaxy, ship, habitat4.xpos, habitat4.ypos, 0.1)) {
                const starDate3 = galaxyStarDate(galaxy) + Math.trunc(0.5 * REAL_SECONDS_IN_GALACTIC_YEAR * 1000.0);
                assignMoveAndWait(galaxy, ship, habitat4, starDate3);
                return;
            }
        }
    }
    // 4698-4730
    if (galaxy.rnd.next(0, 2) === 1 && empire.pirateEmpireBaseHabitat !== null && empire.pirateRelations != null) {
        const num7 = galaxy.rnd.next(0, empire.pirateRelations.count);
        const tryRelation = (index: number): boolean => {
            const pirateRelation2 = empire.pirateRelations.get(index);
            if (pirateRelation2 != null && pirateRelation2.type === PirateRelationType.Protection && pirateRelation2.otherEmpire !== null && pirateRelation2.evaluation >= f(5) && !checkEmpireHasHyperDriveTech(pirateRelation2.otherEmpire)) {
                const habitat5 = fastFindNearestColony(galaxy, empire.pirateEmpireBaseHabitat!.xpos, empire.pirateEmpireBaseHabitat!.ypos, pirateRelation2.otherEmpire, 0);
                if (habitat5 !== null && withinFuelRange(galaxy, ship, habitat5.xpos, habitat5.ypos, 0.1)) {
                    assignMission(galaxy, ship, BuiltObjectMissionType.Patrol, habitat5, null, BuiltObjectMissionPriority.Normal, { manuallyAssigned: false });
                    return true;
                }
            }
            return false;
        };
        for (let num8 = num7; num8 < empire.pirateRelations.count; num8++) {
            if (tryRelation(num8)) return;
        }
        for (let num9 = 0; num9 < num7; num9++) {
            if (tryRelation(num9)) return;
        }
    }
    // 4731-4772
    const builtObject = findNearestKnownBaseForPirateAttackOwn(galaxy, empire, ship.xpos, ship.ypos);
    if (builtObject !== null && withinFuelRange(galaxy, ship, builtObject.xpos, builtObject.ypos, 0.1)) {
        let num10 = calculateOverallStrengthFactor(builtObject);
        if (builtObject.nearestSystemStar !== null && empire.visibility.checkSystemVisible(builtObject.nearestSystemStar.systemIndex)) {
            num10 = calculateDefendingStrength(galaxy, empire, builtObject).strength;
        }
        if (calculateOverallStrengthFactor(ship) >= num10) {
            let maxValue = 3;
            if (empire.piratePlayStyle === PiratePlayStyle.Pirate) maxValue = 5;
            else if (empire.piratePlayStyle === PiratePlayStyle.Mercenary) maxValue = 4;
            switch (galaxy.rnd.next(0, maxValue)) {
                case 0:
                case 1: {
                    const missionType = determineDestroyOrCaptureTarget(galaxy, empire, ship, builtObject, false);
                    assignMission(galaxy, ship, missionType, builtObject, null, BuiltObjectMissionPriority.Normal);
                    break;
                }
                default: {
                    if (builtObject.raidCountdown <= 0) {
                        assignMission(galaxy, ship, BuiltObjectMissionType.Raid, builtObject, null, BuiltObjectMissionPriority.Normal);
                        break;
                    }
                    const missionType = determineDestroyOrCaptureTarget(galaxy, empire, ship, builtObject, false);
                    assignMission(galaxy, ship, missionType, builtObject, null, BuiltObjectMissionPriority.Normal);
                    break;
                }
            }
            return;
        }
    }
    // 4773-4808
    const builtObject2 = identifyPirateBase(empire);
    let habitat7: Habitat | null = null;
    let builtObject3: BuiltObject | null = null;
    if (empire !== galaxy.playerEmpire && builtObject2 !== null) {
        const bx = Math.trunc(builtObject2.xpos);
        const by = Math.trunc(builtObject2.ypos);
        switch (galaxy.rnd.next(0, 3)) {
            case 0:
                builtObject3 = galaxy.findNearestBuiltObjectOfSubRole(bx, by, BuiltObjectSubRole.MiningStation, false);
                break;
            case 1:
                builtObject3 = galaxy.findNearestBuiltObjectOfSubRole(bx, by, BuiltObjectSubRole.GasMiningStation, false);
                break;
            case 2:
                switch (galaxy.rnd.next(0, 5)) {
                    case 0:
                        builtObject3 = galaxy.findNearestBuiltObjectOfSubRole(bx, by, BuiltObjectSubRole.WeaponsResearchStation, false);
                        break;
                    case 1:
                        builtObject3 = galaxy.findNearestBuiltObjectOfSubRole(bx, by, BuiltObjectSubRole.EnergyResearchStation, false);
                        break;
                    case 2:
                        builtObject3 = galaxy.findNearestBuiltObjectOfSubRole(bx, by, BuiltObjectSubRole.HighTechResearchStation, false);
                        break;
                    case 3:
                        builtObject3 = galaxy.findNearestBuiltObjectOfSubRole(bx, by, BuiltObjectSubRole.ResortBase, false);
                        break;
                    case 4:
                        builtObject3 = galaxy.findNearestBuiltObjectOfSubRole(bx, by, BuiltObjectSubRole.MonitoringStation, false);
                        break;
                }
                break;
        }
    }
    // 4809-4817
    if (builtObject3 !== null && builtObject3.nearestSystemStar !== null) {
        const num11 = galaxy.calculateDistance(builtObject3.xpos, builtObject3.ypos, ship.xpos, ship.ypos);
        habitat7 = !(num11 < SECTOR_SIZE) ? fastFindNearestUncolonizedOwnedSystem(galaxy, ship.xpos, ship.ypos) : builtObject3.nearestSystemStar;
    } else {
        habitat7 = fastFindNearestUncolonizedOwnedSystem(galaxy, ship.xpos, ship.ypos);
    }
    // 4818-4858
    if (habitat7 !== null) {
        const systemVisibilityStatus = empire.visibility.checkSystemVisibilityStatus(habitat7.systemIndex);
        if (systemVisibilityStatus === SystemVisibilityStatus.Explored) {
            const systemInfo = galaxy.systems[habitat7.systemIndex];
            if (systemInfo != null && systemInfo.habitats != null && systemInfo.habitats.length > 0) {
                const index = galaxy.rnd.next(0, systemInfo.habitats.length);
                const habitat8 = systemInfo.habitats[index];
                if (habitat8 != null && withinFuelRange(galaxy, ship, habitat8.xpos, habitat8.ypos, 0.1)) {
                    assignMission(galaxy, ship, BuiltObjectMissionType.Move, habitat8, null, BuiltObjectMissionPriority.Normal);
                    return;
                }
            } else if (withinFuelRange(galaxy, ship, habitat7.xpos, habitat7.ypos, 0.1)) {
                assignMission(galaxy, ship, BuiltObjectMissionType.Move, habitat7, null, BuiltObjectMissionPriority.Normal);
                return;
            }
        } else {
            habitat7 = galaxy.fastFindNearestUnexploredSystem(ship.xpos, ship.ypos, empire);
            if (habitat7 !== null && withinFuelRange(galaxy, ship, habitat7.xpos, habitat7.ypos, 0.1)) {
                assignMission(galaxy, ship, BuiltObjectMissionType.Move, habitat7, null, BuiltObjectMissionPriority.Normal);
                return;
            }
        }
    } else {
        habitat7 = galaxy.fastFindNearestUnexploredSystem(ship.xpos, ship.ypos, empire);
        if (habitat7 !== null && withinFuelRange(galaxy, ship, habitat7.xpos, habitat7.ypos, 0.1)) {
            assignMission(galaxy, ship, BuiltObjectMissionType.Move, habitat7, null, BuiltObjectMissionPriority.Normal);
            return;
        }
    }
    // 4859-4863
    if (builtObject2 !== null && builtObject2.currentEscortForceAssigned <= 0 && withinFuelRange(galaxy, ship, builtObject2.xpos, builtObject2.ypos, 0.1)) {
        assignMission(galaxy, ship, BuiltObjectMissionType.Patrol, builtObject2, null, BuiltObjectMissionPriority.Normal);
        builtObject2.currentEscortForceAssigned += ship.firepowerRaw;
    }
}

/** Empire.1.cs 4896-4941 case SmallFreighter / MediumFreighter / LargeFreighter. Rnd: Next(0, 2), Next(0, mining stations). */
function pirateAssignFreighter(galaxy: Galaxy, empire: Empire, ship: BuiltObject): void {
    if (galaxy.rnd.next(0, 2) === 1) {
        let flag10 = false;
        const num12 = galaxy.rnd.next(0, empire.miningStations.length);
        // Empire.3.cs 16 IdentifyDeficientEmpireResources() → (includeLuxuryResources: false, 0.0).
        const empireDeficientResources = identifyDeficientEmpireResources(galaxy, empire, false, 0.0).map((r) => r.resourceId);
        for (let num13 = num12; num13 < empire.miningStations.length; num13++) {
            if (checkMiningStationForResourceClearance(galaxy, empire, ship, empire.miningStations[num13], empireDeficientResources)) {
                flag10 = true;
                break;
            }
        }
        if (!flag10) {
            for (let num14 = 0; num14 < num12; num14++) {
                if (checkMiningStationForResourceClearance(galaxy, empire, ship, empire.miningStations[num14], empireDeficientResources)) {
                    flag10 = true;
                    break;
                }
            }
        }
    }
    const actualEmpire = ship.actualEmpire!;
    const builtObject4 = fastFindNearestSpacePort(galaxy, Math.trunc(ship.xpos), Math.trunc(ship.ypos), actualEmpire);
    if (builtObject4 !== null) {
        const num15 = galaxy.calculateDistance(ship.xpos, ship.ypos, builtObject4.xpos, builtObject4.ypos);
        if (num15 > SECTOR_SIZE * 2.5) {
            assignMission(galaxy, ship, BuiltObjectMissionType.Move, builtObject4, null, BuiltObjectMissionPriority.Normal);
            return;
        }
    }
    const habitat9 = fastFindNearestColony(galaxy, Math.trunc(ship.xpos), Math.trunc(ship.ypos), actualEmpire, 0);
    if (habitat9 !== null) {
        const num16 = galaxy.calculateDistance(ship.xpos, ship.ypos, habitat9.xpos, habitat9.ypos);
        if (num16 > SECTOR_SIZE * 2.5) {
            assignMission(galaxy, ship, BuiltObjectMissionType.Move, habitat9, null, BuiltObjectMissionPriority.Normal);
        }
    }
}

/** Empire.1.cs 4942-5116 case ConstructionShip. Rnd: IdentifyPirateNewHomeLocation, SelectRelativeHabitatSurfacePoint, Next(0, 3) (several), Next(0, list), Next(0, 2). */
function pirateAssignConstructionShip(galaxy: Galaxy, empire: Empire, ship: BuiltObject): void {
    let stateMoney = empire.stateMoney;
    stateMoney -= calculateCashReservesForNewPirateFacilities(galaxy, empire);
    const num17 = countSpaceports(empire.builtObjects);
    const num18 = 1 + Math.trunc(empire.builtObjects.length / 20);
    // 4948-4969
    if (num17 < num18) {
        const design = latestDesignsFindNewestCanBuild(empire, BuiltObjectSubRole.SmallSpacePort);
        if (design !== null) {
            const num19 = design.calculateCurrentPurchasePrice(galaxy);
            if (num19 < stateMoney) {
                const habitat12 = identifyPirateNewHomeLocation(galaxy, empire);
                if (habitat12 !== null) {
                    const p = galaxy.selectRelativeHabitatSurfacePoint(habitat12);
                    assignMission(galaxy, ship, BuiltObjectMissionType.Build, habitat12, null, BuiltObjectMissionPriority.Normal, { design, x: p.x, y: p.y });
                    if (num17 === 0) empire.pirateEmpireBaseHabitat = habitat12;
                    return;
                }
            }
        }
    }
    const constructionShips = empire.constructionShips as BuiltObject[];
    // 4970-4993
    let galaxyLocation: GalaxyLocation | null = checkWhetherAtLocation(empire, ship.xpos, ship.ypos);
    if ((galaxyLocation !== null && galaxyLocation.type === GalaxyLocationType.DebrisField) || (galaxy.rnd.next(0, 3) === 1 && constructionShips != null && constructionShips.length > 1)) {
        if (galaxyLocation === null) {
            const known = empire.visibility.knownGalaxyLocations;
            for (let num20 = 0; num20 < known.length; num20++) {
                if (known[num20].type === GalaxyLocationType.DebrisField) {
                    galaxyLocation = known[num20];
                    break;
                }
            }
        }
        if (galaxyLocation !== null) {
            const builtObject5 = selectBestSalvageableShip(galaxy, galaxyLocation);
            if (builtObject5 !== null && withinFuelRange(galaxy, ship, builtObject5.xpos, builtObject5.ypos, 0.1)) {
                assignMission(galaxy, ship, BuiltObjectMissionType.Build, null, builtObject5, BuiltObjectMissionPriority.High, { x: builtObject5.xpos, y: builtObject5.ypos });
                return;
            }
        }
    }
    // 4994-5020
    const galaxyLocationList = empire.visibility.knownGalaxyLocations.filter((l) => l.type === GalaxyLocationType.PlanetDestroyer);
    if (galaxyLocationList.length > 0) {
        for (let num21 = 0; num21 < galaxyLocationList.length; num21++) {
            const relatedBuiltObject = galaxyLocationList[num21].relatedBuiltObject;
            if (relatedBuiltObject === null || relatedBuiltObject.unbuiltComponentCount <= 0 || relatedBuiltObject.builtAt !== null || relatedBuiltObject.empire !== null || relatedBuiltObject.hasBeenDestroyed) continue;
            let flag11 = false;
            for (let num22 = 0; num22 < constructionShips.length; num22++) {
                const builtObject6 = constructionShips[num22];
                const m6 = missionOf(builtObject6);
                if (m6 !== null && (m6.type === BuiltObjectMissionType.Build || m6.type === BuiltObjectMissionType.BuildRepair || m6.type === BuiltObjectMissionType.Repair) && m6.secondaryTargetBuiltObject === relatedBuiltObject) {
                    flag11 = true;
                    break;
                }
            }
            if (!flag11 && galaxy.rnd.next(0, 3) === 1 && constructionShips != null && constructionShips.length > 1 && withinFuelRange(galaxy, ship, relatedBuiltObject.xpos, relatedBuiltObject.ypos, 0.1)) {
                assignMission(galaxy, ship, BuiltObjectMissionType.Build, null, relatedBuiltObject, BuiltObjectMissionPriority.High, { x: relatedBuiltObject.xpos, y: relatedBuiltObject.ypos });
                return;
            }
        }
    }
    // 5021-5045
    const builtObjectList: BuiltObject[] = [];
    builtObjectList.push(...empire.builtObjects);
    builtObjectList.push(...empire.privateBuiltObjects);
    if (galaxy.rnd.next(0, 3) === 1) {
        const num23 = galaxy.rnd.next(0, builtObjectList.length);
        for (let num24 = num23; num24 < builtObjectList.length; num24++) {
            const builtObject7 = builtObjectList[num24];
            if (builtObject7 != null && builtObject7.actualEmpire === empire && determineWhetherShouldRepair(galaxy, empire, ship, builtObject7) && withinFuelRange(galaxy, ship, builtObject7.xpos, builtObject7.ypos, 0.1)) {
                assignMission(galaxy, ship, BuiltObjectMissionType.BuildRepair, null, builtObject7, BuiltObjectMissionPriority.Normal);
                return;
            }
        }
        for (let num25 = 0; num25 < num23; num25++) {
            const builtObject8 = builtObjectList[num25];
            if (builtObject8 != null && builtObject8.actualEmpire === empire && determineWhetherShouldRepair(galaxy, empire, ship, builtObject8) && withinFuelRange(galaxy, ship, builtObject8.xpos, builtObject8.ypos, 0.1)) {
                assignMission(galaxy, ship, BuiltObjectMissionType.BuildRepair, null, builtObject8, BuiltObjectMissionPriority.Normal);
                return;
            }
        }
    }
    // 5046-5054
    const habitatList = determineHabitatsBeingMinedIncludingBuildingMiningStations(galaxy, empire, false);
    if (empire.resourceTargets != null && empire.resourceTargets.length > 0) {
        const num26 = calculateAccurateAnnualCashflow(galaxy, empire);
        if (num26 > 0.0 && empire.stateMoney > 0.0 && buildStrategicResourceSupply(galaxy, empire, ship, habitatList)) return;
    }
    // 5055-5108
    const empireResourceTargets = empire.empireResourceTargets;
    if (empireResourceTargets != null && empireResourceTargets.length > 0) {
        const num27 = calculateAccurateAnnualCashflow(galaxy, empire);
        let num28 = 0;
        let design2: Design | null = null;
        const iterationCount = { count: 0 };
        while (conditionCheckLimit(design2 === null && num28 < empireResourceTargets.length, 1500, iterationCount)) {
            const habitatPrioritization = empireResourceTargets[num28];
            if (habitatPrioritization != null) {
                const habitat13 = habitatPrioritization.habitat;
                if (habitat13 != null && !habitatList.includes(habitat13) && (habitat13.empire === null || habitat13.empire === galaxy.independentEmpire)) {
                    if (resourcesContainsGroup(galaxy, habitat13, ResourceGroup.Gas)) design2 = designsFindNewestCanBuild(empire.designs, BuiltObjectSubRole.GasMiningStation);
                    if (resourcesContainsGroup(galaxy, habitat13, ResourceGroup.Mineral)) design2 = designsFindNewestCanBuild(empire.designs, BuiltObjectSubRole.MiningStation);
                    if (design2 === null && resourcesContainsGroup(galaxy, habitat13, ResourceGroup.Luxury)) design2 = designsFindNewestCanBuild(empire.designs, BuiltObjectSubRole.MiningStation);
                    if (design2 !== null) {
                        const num29 = designCalculateMaintenanceCosts(galaxy, design2, empire);
                        const num30 = design2.calculateCurrentPurchasePrice(galaxy);
                        if (empire.stateMoney > num30 && num27 > num29 && habitatPrioritization.priority > MINING_STATION_RESOURCE_THRESHHOLD && !checkNearPirateBase(galaxy, empire, habitatPrioritization.habitat, Math.trunc(MAX_SOLAR_SYSTEM_SIZE * 2.1), habitatPrioritization.habitat!.xpos, habitatPrioritization.habitat!.ypos, empire)) {
                            const builtObject9 = determineMiningStationAtHabitat(habitat13);
                            if (builtObject9 == null) {
                                let p = galaxy.selectRelativeHabitatSurfacePoint(habitat13);
                                let x3 = p.x;
                                let y3 = p.y;
                                let builtObject10 = galaxy.findNearestBuiltObject(Math.trunc(habitat13.xpos + x3), Math.trunc(habitat13.ypos + y3), BuiltObjectRole.Base);
                                let num31 = Number.MAX_VALUE;
                                if (builtObject10 !== null) num31 = galaxy.calculateDistance(habitat13.xpos + x3, habitat13.ypos + y3, builtObject10.xpos, builtObject10.ypos);
                                let num32 = 0;
                                while (num31 < MINIMUM_DISTANCE_BETWEEN_BASES) {
                                    p = galaxy.selectRelativeHabitatSurfacePoint(habitat13);
                                    x3 = p.x;
                                    y3 = p.y;
                                    builtObject10 = galaxy.findNearestBuiltObject(Math.trunc(habitat13.xpos + x3), Math.trunc(habitat13.ypos + y3), BuiltObjectRole.Base);
                                    num31 = galaxy.calculateDistance(habitat13.xpos + x3, habitat13.ypos + y3, builtObject10!.xpos, builtObject10!.ypos);
                                    num32++;
                                    if (num32 > 5) break;
                                }
                                assignMission(galaxy, ship, BuiltObjectMissionType.Build, habitat13, null, BuiltObjectMissionPriority.Normal, { design: design2, x: x3, y: y3 });
                                habitatList.push(habitat13);
                                empireResourceTargets.splice(num28, 1);
                                return;
                            }
                        }
                    }
                }
            }
            num28++;
            design2 = null;
        }
    }
    // 5109-5126
    if (empire.resortBaseBuildLocations == null || empire.resortBaseBuildLocations.length <= 0 || !empire.policy!.engageInTourism || galaxy.rnd.next(0, 2) !== 1) return;
    let num33 = Math.min(20, 1 + Math.trunc(empire.colonies.length / 6));
    num33 = Math.trunc(num33 * empire.policy!.tourismPriority);
    if (empire.resortBases.length >= num33) return;
    const design3 = designsFindNewestCanBuild(empire.designs, BuiltObjectSubRole.ResortBase);
    if (design3 !== null) {
        const num34 = calculateSupportCost(galaxy, empire, design3);
        const num35 = design3.calculateCurrentPurchasePrice(galaxy);
        if (num35 <= stateMoney && num34 <= calculateSpareAnnualRevenueComplete(galaxy, empire)) {
            assignBuildResortBaseMissionToBuiltObject(galaxy, empire, ship, design3);
        }
    }
}

/** The per-habitat-type extractor match of the mining-ship case (Empire.1.cs 5153-5285 / 5321-5465). */
function extractorMatchesHabitat(galaxy: Galaxy, ship: BuiltObject, habitat: Habitat): boolean {
    const mineral = (): boolean => ship.extractionMine > 0 && resourcesContainsGroup(galaxy, habitat, ResourceGroup.Mineral);
    const gas = (): boolean => ship.extractionGas > 0 && resourcesContainsGroup(galaxy, habitat, ResourceGroup.Gas);
    const luxury = (): boolean => ship.extractionLuxury > 0 && resourcesContainsGroup(galaxy, habitat, ResourceGroup.Luxury);
    switch (habitat.type) {
        case HabitatType.BarrenRock:
        case HabitatType.Volcanic:
        case HabitatType.Continental:
        case HabitatType.MarshySwamp:
        case HabitatType.Ocean:
        case HabitatType.Desert:
            return mineral() || gas() || luxury();
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
        case HabitatType.Ice:
            return gas() || mineral() || luxury();
        default:
            return false;
    }
}

/** Empire.1.cs 5118-5480 case GasMiningShip / MiningShip. No Rnd. */
function pirateAssignMiningShip(galaxy: Galaxy, empire: Empire, ship: BuiltObject): void {
    const flag12 = checkShipCanSurviveStorms(ship);
    const subRoles = [BuiltObjectSubRole.MiningShip, BuiltObjectSubRole.GasMiningShip];
    const empireResourceTargets = empire.empireResourceTargets;
    if (empireResourceTargets != null && empireResourceTargets.length > 0) {
        let flag13 = false;
        let num36 = 0;
        const iterationCount2 = { count: 0 };
        for (; conditionCheckLimit(!flag13 && num36 < empireResourceTargets.length, 1500, iterationCount2); num36++) {
            if (!ship.isResourceExtractor) continue;
            const habitat14 = empireResourceTargets[num36].habitat!;
            if (!flag12 && checkInStorm(galaxy, habitat14.xpos, habitat14.ypos)) continue;
            flag13 = extractorMatchesHabitat(galaxy, ship, habitat14);
            if (!flag13) continue;
            if (withinFuelRangeAndRefuel(galaxy, ship, habitat14.xpos, habitat14.ypos, 0.0)) {
                const num37 = countBuiltObjectsWithTargetHabitat(empire.privateBuiltObjects, habitat14, subRoles);
                if (num37 < 3) {
                    assignMission(galaxy, ship, BuiltObjectMissionType.ExtractResources, habitat14, null, BuiltObjectMissionPriority.Normal);
                    empireResourceTargets.splice(num36, 1);
                }
            } else {
                flag13 = false;
            }
        }
    }
    {
        const m = missionOf(ship);
        if ((m !== null && m.type !== BuiltObjectMissionType.Undefined) || empire.resourceTargets == null || empire.resourceTargets.length <= 0) return;
    }
    let flag14 = false;
    let num38 = 0;
    const iterationCount3 = { count: 0 };
    for (; conditionCheckLimit(!flag14 && num38 < empire.resourceTargets.length, 1000, iterationCount3); num38++) {
        const habitatPrioritization2 = empire.resourceTargets[num38];
        const hp = habitatPrioritization2.habitat!;
        if (!ship.isResourceExtractor || checkNearPirateBase(galaxy, empire, hp, Math.trunc(MAX_SOLAR_SYSTEM_SIZE * 2.1), hp.xpos, hp.ypos, null) || (!flag12 && checkInStorm(galaxy, hp.xpos, hp.ypos))) continue;
        const habitat15 = empire.resourceTargets[num38].habitat;
        if (habitat15 == null || checkAlreadyHaveMiningStationAtHabitat(habitat15, empire)) continue;
        flag14 = extractorMatchesHabitat(galaxy, ship, habitat15);
        if (!flag14) continue;
        if (withinFuelRangeAndRefuel(galaxy, ship, habitat15.xpos, habitat15.ypos, 0.0)) {
            const num39 = countBuiltObjectsWithTargetHabitat(empire.privateBuiltObjects, habitat15, subRoles);
            if (num39 < 3) assignMission(galaxy, ship, BuiltObjectMissionType.ExtractResources, habitat15, null, BuiltObjectMissionPriority.Normal);
        } else {
            flag14 = false;
        }
    }
}

/** Empire.1.cs 5481-5500 case PassengerShip. Rnd: Next(0, 2), Next(0, 3) (short-circuited as in C#). */
function pirateAssignPassengerShip(galaxy: Galaxy, empire: Empire, ship: BuiltObject): void {
    let flag2 = false;
    let flag3 = false;
    if (empire.migrationDestinations != null && empire.migrationDestinations.length > 0 && empire.migrationSources.length > 0) flag2 = true;
    if (empire.tourismDestinations != null && empire.tourismSources != null && empire.tourismDestinations.length > 0 && empire.tourismSources.length > 0 && empire.policy!.engageInTourism) flag3 = true;
    if ((!flag2 || (flag3 && galaxy.rnd.next(0, 2) !== 1) || !assignMigrationMissionToBuiltObject(galaxy, empire, ship)) && flag3) {
        let flag4 = false;
        if ((!flag2 || galaxy.rnd.next(0, 3) > 0) && assignTourismMissionToBuiltObject(galaxy, empire, ship)) {
            flag4 = true;
        } else if (!flag4 && flag2) {
            assignMigrationMissionToBuiltObject(galaxy, empire, ship);
        }
    }
}
