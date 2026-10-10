// Mining targets (task M3b). Port of Empire.4.cs IdentifyResourceCentres
// (1948/1953/1958) and what it calls: HabitatPrioritization(.cs /List.cs),
// CheckConstructionShipAndMiningStationCanSurviveStorms (Empire.4.cs 4535),
// DetermineHabitatsBuildingMiningStations (2279), Galaxy.3.cs CheckInStorm
// (1043), Empire.5.cs CheckNearPirateBase (3430-3484) + Galaxy.8.cs
// FindNearestPirateFaction (2872), Galaxy.cs CheckEmpireTerritoryCanBuildAtHabitat
// (3637) + EmpireTerritory.CheckSystemOwnershipWithOthers (60) +
// BaconGalaxy.CheckEmpireTerritoryCanBuildAtHabitat (157), Galaxy.7.cs
// DetermineMiningStationAtHabitat(ForEmpire) (417/340), Empire.9.cs
// CheckWhetherHabitatIsDangerous (4035) and Habitat.cs
// CalculateCurrentStrategicResourceValue / CalculateCurrentCompleteResourceValue
// (5551/5529).
//
// Rnd: none. Unported subsystems it reads, all empty at game start (the first
// Empire.DoTasks inside Galaxy.GenerateEmpire): construction ships and their missions,
// KnownPirateBases (never filled yet), SystemVisibility.Threats, DiplomaticRelations.
// Habitat.BasesAtHabitat is the real list (filled by Empire.addBuiltObjectToGalaxy).

import { raceAggressionLevel, raceCautionLevel } from './racePeriodic';
import { BuiltObjectMissionType, builtObjectMission, builtObjectSubsequentMissions } from './missions/mission';
import { crisesMiningPriority } from './scenario/emergent/crisesCore';
import type { Galaxy } from './galaxy';
import { HabitatCategoryType, type Habitat } from './types';
import type { Empire } from './empire';
import { BuiltObjectSubRole } from './builtObjectTypes';
import { ComponentCategoryType } from './data/policies';
import { findNewest } from './design';
import { GalaxyLocationEffectType, GalaxyLocationType } from './galaxyLocation';
import { netSort } from './netSort';
import { csToInt32, resourceCurrentPrice, type BuiltObjectView } from './forceStructure';
import { findNearestPirateFaction } from './pirates';
import { obtainDiplomaticRelation } from './diplomacy';
import { determineDefendingFirepower } from './pirates/pirateEmpireAI';
import { obtainPirateRelation, PirateRelationType } from './pirateRelations';
import { BuiltObjectRole } from './data/designSpecifications';
import type { BuiltObject } from './builtObject';
import { isHumanEmpire } from './humanEmpires';

// Galaxy.MaxSolarSystemSize (Galaxy.3.cs InitializeStatics).
const MAX_SOLAR_SYSTEM_SIZE = 23000;

// Port of HabitatPrioritization.cs.
export class HabitatPrioritization {
    habitat: Habitat | null;
    priority: number; // C#: int
    /** C#: BuiltObject AssignedShip (typed loosely; callers cast to BuiltObject). */
    assignedShip: unknown = null;

    constructor(habitat: Habitat, priority: number) {
        this.habitat = habitat;
        this.priority = priority;
    }

    // HabitatPrioritization.cs CompareTo (int.CompareTo of Priority).
    compareTo(other: HabitatPrioritization): number {
        return this.priority < other.priority ? -1 : this.priority > other.priority ? 1 : 0;
    }
}

// HabitatPrioritizationList.cs IndexOf(Habitat) (34).
export function habitatPrioritizationIndexOf(list: HabitatPrioritization[], habitat: Habitat): number {
    for (let index = 0; index < list.length; ++index) {
        if (list[index].habitat === habitat) return index;
    }
    return -1;
}

interface Positioned {
    xpos: number;
    ypos: number;
}

// StellarObjectList.cs FindNearest(x, y) (50).
function findNearest(list: Positioned[], x: number, y: number): Positioned | null {
    let nearest: Positioned | null = null;
    let num = Number.MAX_VALUE;
    for (const stellarObject of list) {
        if (stellarObject != null) {
            // Galaxy.CalculateDistanceSquaredStatic: num2 * num2 + num * num.
            const dx = x - stellarObject.xpos;
            const dy = y - stellarObject.ypos;
            const distanceSquaredStatic = dy * dy + dx * dx;
            if (nearest === null || distanceSquaredStatic < num) {
                nearest = stellarObject;
                num = distanceSquaredStatic;
            }
        }
    }
    return nearest;
}

const isSpacePort = (s: BuiltObjectSubRole) => s === BuiltObjectSubRole.SmallSpacePort || s === BuiltObjectSubRole.MediumSpacePort || s === BuiltObjectSubRole.LargeSpacePort;

// Habitat.BasesAtHabitat (Empire.AddBuiltObjectToGalaxy adds every Base parented to the habitat).
function basesAtHabitat(habitat: Habitat): BuiltObject[] {
    return habitat.basesAtHabitat;
}

// Galaxy.7.cs DetermineMiningStationAtHabitat (417).
export function determineMiningStationAtHabitat(habitat: Habitat): unknown {
    for (const builtObject of basesAtHabitat(habitat)) {
        switch (builtObject.subRole) {
            case BuiltObjectSubRole.GasMiningStation:
            case BuiltObjectSubRole.MiningStation:
                return builtObject;
            case BuiltObjectSubRole.SmallSpacePort:
            case BuiltObjectSubRole.MediumSpacePort:
            case BuiltObjectSubRole.LargeSpacePort:
                if (builtObject.extractionGas > 0 || builtObject.extractionMine > 0) return builtObject;
                break;
        }
    }
    return null;
}

// Galaxy.7.cs DetermineMiningStationAtHabitatForEmpire (340).
export function determineMiningStationAtHabitatForEmpire(habitat: Habitat, empire: Empire): unknown {
    for (const builtObject of basesAtHabitat(habitat)) {
        if (builtObject == null || builtObject.empire !== empire) continue;
        switch (builtObject.subRole) {
            case BuiltObjectSubRole.GasMiningStation:
            case BuiltObjectSubRole.MiningStation:
                return builtObject;
            case BuiltObjectSubRole.SmallSpacePort:
            case BuiltObjectSubRole.MediumSpacePort:
            case BuiltObjectSubRole.LargeSpacePort:
                if (builtObject.extractionGas > 0 || builtObject.extractionMine > 0) return builtObject;
                break;
        }
    }
    return null;
}

// Galaxy.3.cs CheckInStorm (1043).
export function checkInStorm(galaxy: Galaxy, x: number, y: number): boolean {
    const galaxyLocationList = galaxy.determineGalaxyLocationsAtPoint(x, y, GalaxyLocationType.NebulaCloud);
    for (const galaxyLocation of galaxyLocationList) {
        if (galaxyLocation != null && galaxyLocation.effect === GalaxyLocationEffectType.LightningDamage) return true;
    }
    return false;
}

// Galaxy.8.cs FindNearestPirateFaction (2872): pirates.ts findNearestPirateFaction.

// Empire.5.cs CheckNearPirateBase(stellarObject, scanRange, x, y, empireToExclude) (3457).
// The overloads: (Habitat, x, y) (3440) and (stellarObject, x, y, empireToExclude) (3451)
// pass scanRange = (int)(MaxSolarSystemSize * 2.1); (Habitat, x, y) passes empireToExclude = null.
export function checkNearPirateBase(galaxy: Galaxy, owner: Empire, stellarObject: Positioned | null, scanRange: number, x: number, y: number, empireToExclude: Empire | null): boolean {
    const empire = findNearestPirateFaction(galaxy, x, y, empireToExclude, true);
    if (empire !== null && empire.pirateEmpireBaseHabitat !== null) {
        let builtObject: BuiltObject | null = null;
        const bases = empire.pirateEmpireBaseHabitat.basesAtHabitat;
        if (bases != null && bases.length > 0) {
            for (let i = 0; i < bases.length; i++) {
                const builtObject2 = bases[i];
                if (builtObject2 != null && builtObject2.empire === empire && isSpacePort(builtObject2.subRole)) {
                    builtObject = builtObject2;
                    break;
                }
            }
        }
        // Empire.KnownPirateBases: filled by PirateBaseDiscovery (BuiltObject.1.cs 1889, pirates/pirateAI.ts), shared
        // visibility (Empire.1.cs 1072) and trades (Galaxy.4.cs 3798).
        if (owner.knownPirateBases != null && builtObject !== null && owner.knownPirateBases.includes(builtObject) && stellarObject !== null) {
            const num = galaxy.calculateDistance(stellarObject.xpos, stellarObject.ypos, builtObject.xpos, builtObject.ypos);
            if (num < scanRange) return true;
        }
    }
    return false;
}

// Galaxy.cs CheckEmpireTerritoryCanBuildAtHabitat (3637).
export function checkEmpireTerritoryCanBuildAtHabitat(galaxy: Galaxy, empire: Empire, habitat: Habitat): boolean {
    if (habitat.owner === empire) return true;
    let disputed = false;
    const systemStar = galaxy.determineHabitatSystemStar(habitat);
    // EmpireTerritory.CheckSystemOwnershipWithOthers (EmpireTerritory.cs 60).
    let num: number;
    const sys = galaxy.systems[systemStar.systemIndex];
    if (sys === undefined || sys.dominantEmpire == null || sys.dominantEmpire.empire == null) {
        num = galaxy.empireTerritory.checkLocationOwnership(galaxy, systemStar.xpos, systemStar.ypos);
    } else {
        if (sys.otherEmpires != null && sys.otherEmpires.length > 0) disputed = true;
        num = sys.dominantEmpire.empire.empireId;
    }
    if (disputed) return true;
    if (num >= 0 && num !== empire.empireId) {
        // Galaxy.Empires.GetByEmpireId (pirate factions live only in PirateEmpires).
        let byEmpireId: Empire | null = null; // first match, as Array.find (plain loop: no closure per call)
        for (let i = 0; i < galaxy.empires.length; i++) {
            if (galaxy.empires[i].empireId === num) {
                byEmpireId = galaxy.empires[i];
                break;
            }
        }
        if (byEmpireId !== null) {
            if (empire.pirateEmpireBaseHabitat !== null || byEmpireId.pirateEmpireBaseHabitat !== null) return true;
            // Galaxy.cs 3659-3663: ObtainDiplomaticRelation (Empire.4.cs 140; creates a NotMet relation on first contact).
            const diplomaticRelation = obtainDiplomaticRelation(byEmpireId, empire);
            if (diplomaticRelation != null && diplomaticRelation.miningRightsToOther) return true;
        }
        // Galaxy.cs 3665 → BaconGalaxy.cs 157 CheckEmpireTerritoryCanBuildAtHabitat: buildAnywhere (false) ||
        // (empire == PlayerEmpire && DetermineDefendingFirepower(habitat, empire) > 300) (Galaxy.6.cs 4696).
        const buildAnywhere = false;
        return buildAnywhere || (isHumanEmpire(galaxy, empire) && determineDefendingFirepower(galaxy, habitat, empire) > 300);
    }
    return true;
}

// Habitat.cs CalculateCurrentCompleteResourceValue (5529).
export function calculateCurrentCompleteResourceValue(galaxy: Galaxy, habitat: Habitat): number {
    let num = 0.0;
    for (const r of habitat.resources.slice()) {
        let val = resourceCurrentPrice(galaxy, r.resourceId);
        val = Math.max(1.0, val);
        const num3 = val * val;
        let d = r.abundance;
        d = Math.sqrt(d) * 100.0;
        num += (num3 / 100.0) * d;
    }
    if (habitat.category === HabitatCategoryType.GasCloud) num *= 6.0;
    return num * 100.0;
}

// Habitat.cs CalculateCurrentStrategicResourceValue (5551).
export function calculateCurrentStrategicResourceValue(galaxy: Galaxy, habitat: Habitat): number {
    let num = 0.0;
    for (const r of habitat.resources.slice()) {
        // Resource.IsLuxuryResource: Resources[ResourceID].Group == Luxury (resources.txt type 2).
        if (galaxy.resourceSystem.resources[r.resourceId].type !== 2) {
            let val = resourceCurrentPrice(galaxy, r.resourceId);
            val = Math.max(1.0, val);
            const num3 = val * val * val;
            const num4 = r.abundance * 100.0;
            num += (num3 / 100.0) * num4;
        }
    }
    if (habitat.category === HabitatCategoryType.GasCloud) num *= 6.0;
    return num * 100.0;
}

// Empire.4.cs CheckConstructionShipAndMiningStationCanSurviveStorms (4535).
export function checkConstructionShipAndMiningStationCanSurviveStorms(empire: Empire): boolean {
    let builtObject: BuiltObject | null = null;
    if (empire.constructionShips.length > 0) builtObject = empire.constructionShips[empire.constructionShips.length - 1] as BuiltObject;
    const design = findNewest(empire.designs, BuiltObjectSubRole.MiningStation);
    // Design.ArmorReactive / BuiltObject.ArmorReactive are set by ReDefine (design.ts / builtObject.ts).
    if (design !== null && builtObject !== null && design.armorReactive >= 5 && builtObject.armorReactive >= 5) {
        return true;
    }
    return false;
}

// Empire.4.cs DetermineHabitatsBuildingMiningStations (2279).
export function determineHabitatsBuildingMiningStations(empire: Empire): HabitatPrioritization[] {
    const habitatPrioritizationList: HabitatPrioritization[] = [];
    for (let i = 0; i < empire.constructionShips.length; i++) {
        const builtObject = empire.constructionShips[i] as BuiltObject;
        // Empire.4.cs 2284-2307 (ported by M4g now that missions exist, missions/mission.ts).
        const mission = builtObjectMission(builtObject.mission);
        if (mission === null || mission.type !== BuiltObjectMissionType.Build) {
            continue;
        }
        if (mission.targetHabitat !== null) {
            const habitatPrioritization = new HabitatPrioritization(mission.targetHabitat, 0);
            habitatPrioritization.assignedShip = builtObject;
            habitatPrioritizationList.push(habitatPrioritization);
        }
        const subsequentMissions = builtObjectSubsequentMissions(builtObject);
        if (subsequentMissions == null || subsequentMissions.length <= 0) {
            continue;
        }
        for (const subsequentMission of subsequentMissions) {
            if (subsequentMission != null && subsequentMission.type === BuiltObjectMissionType.Build && subsequentMission.targetHabitat !== null) {
                const habitatPrioritization2 = new HabitatPrioritization(subsequentMission.targetHabitat, 0);
                habitatPrioritization2.assignedShip = builtObject;
                habitatPrioritizationList.push(habitatPrioritization2);
            }
        }
    }
    return habitatPrioritizationList;
}

// Empire.9.cs CheckWhetherHabitatIsDangerous (4035): pirate military ships among the system's cached threats
// (SystemVisibility.Threats, written by the threat evaluations — combat/threats.ts), unless we pay them protection,
// and visible attacking creatures in range. No Rnd (ObtainPirateRelation may add a relation).
export function checkWhetherHabitatIsDangerous(galaxy: Galaxy, empire: Empire, habitat: Habitat): boolean {
    if (habitat != null) {
        const habitat2 = galaxy.determineHabitatSystemStar(habitat);
        const threats = habitat2 != null ? empire.visibility.systemVisibility[habitat2.systemIndex].threats : null;
        if (habitat2 != null && threats != null && threats.length > 0) {
            for (let i = 0; i < threats.length; i++) {
                const builtObject = threats[i];
                if (builtObject == null || builtObject.empire == null || builtObject.empire.pirateEmpireBaseHabitat === null || builtObject.role !== BuiltObjectRole.Military) {
                    continue;
                }
                const pirateRelation = obtainPirateRelation(empire, builtObject.empire);
                if (pirateRelation.type === PirateRelationType.Protection) {
                    continue;
                }
                // (Unreachable in C# too: Role is Military here.)
                if ((builtObject.role as BuiltObjectRole) === BuiltObjectRole.Base) {
                    const num = galaxy.calculateDistanceSquared(habitat.xpos, habitat.ypos, builtObject.xpos, builtObject.ypos);
                    if (num < 1000000.0) return true;
                    continue;
                }
                if (builtObject.warpSpeed > 0) return true;
                if (builtObject.topSpeed > 0) {
                    const num2 = galaxy.calculateDistanceSquared(habitat.xpos, habitat.ypos, builtObject.xpos, builtObject.ypos);
                    if (num2 < 4000000.0) return true;
                }
            }
        }
        if (habitat2 != null && empire.visibility.checkSystemVisible(habitat2.systemIndex)) {
            const creatures = galaxy.systems[habitat2.systemIndex].creatures ?? [];
            for (let j = 0; j < creatures.length; j++) {
                const creature = creatures[j];
                if (creature.isVisible && creature.attackStrength > 0) {
                    const num3 = galaxy.calculateDistance(habitat.xpos, habitat.ypos, creature.xpos, creature.ypos);
                    if (num3 < creature.attackRange * 2) return true;
                }
            }
        }
    }
    return false;
}

// Empire.4.cs IdentifyResourceCentres(galaxy, filterOutAssignedHabitats = true,
// filterOutDangerousTargets = true, includeAsteroids = true) (1958).
export function identifyResourceCentres(galaxy: Galaxy, empire: Empire, filterOutAssignedHabitats = true, filterOutDangerousTargets = true, includeAsteroids = true): HabitatPrioritization[] {
    const habitatPrioritizationList: HabitatPrioritization[] = [];
    const stellarObjectList: Positioned[] = [];
    if (empire.pirateEmpireBaseHabitat !== null) {
        // Empire.4.cs 1964: stellarObjectList.AddRange(SpacePorts).
        stellarObjectList.push(...(empire.spacePorts as Positioned[]));
    } else {
        for (const builtObject of empire.builtObjects as (BuiltObjectView & Positioned)[]) {
            if (builtObject != null && !builtObject.hasBeenDestroyed && isSpacePort(builtObject.subRole)) stellarObjectList.push(builtObject);
        }
        for (const habitat of empire.colonies) {
            // Empire.4.cs 1975. Habitat.HasSpacePort is the field set by CheckForSpacePortFacilities
            // (stationPlacement.ts checkColoniesForBaseFacilities).
            const hasSpacePort = habitat.hasSpacePort;
            if (habitat != null && !habitat.hasBeenDestroyed && !hasSpacePort && habitat.population != null && habitat.population.totalAmount >= 500000000) stellarObjectList.push(habitat);
        }
    }
    const design = findNewest(empire.designs, BuiltObjectSubRole.MiningStation);
    let num = 0;
    if (design !== null) num = design.extractionLuxury;
    const flag = checkConstructionShipAndMiningStationCanSurviveStorms(empire);
    let flag2 = true;
    // ResearchedComponents.CountByCategory(HyperDrive) <= 0.
    if (empire.research.researchedComponents.filter((c) => c.category === ComponentCategoryType.HyperDrive).length <= 0) flag2 = false;
    let num2 = 1.0;
    let num3 = 1.0;
    if (empire.dominantRace !== null) {
        num2 = raceAggressionLevel(galaxy, empire.dominantRace) / 100.0; // Race.AggressionLevel (periodic, Race.cs 350)
        num3 = raceCautionLevel(galaxy, empire.dominantRace) / 100.0; // Race.CautionLevel (periodic, Race.cs 368)
    }
    const num4 = csToInt32(1000.0 / ((num2 * num2 * num2) / (num3 * num3 * num3)));
    const habitatPrioritizationList2 = determineHabitatsBuildingMiningStations(empire);
    for (let k = 0; k < empire.systemVisibility.length; k++) {
        if (!empire.visibility.checkSystemExplored(k)) continue;
        const systemInfo = galaxy.systems.length > k ? galaxy.systems[k] : null;
        if (systemInfo == null || systemInfo.systemStar == null) continue;
        const star = systemInfo.systemStar;
        let flag3 = false;
        if (empire.pirateEmpireBaseHabitat === null && systemInfo.dominantEmpire != null && systemInfo.dominantEmpire.empire != null && systemInfo.dominantEmpire.empire !== empire) flag3 = true;
        let flag4 = false;
        let flag5 = false;
        if (filterOutDangerousTargets) {
            flag4 = checkInStorm(galaxy, star.xpos, star.ypos);
            if (flag4 && flag) flag4 = false;
            flag5 = checkNearPirateBase(galaxy, empire, star, csToInt32(MAX_SOLAR_SYSTEM_SIZE * 2.1), star.xpos, star.ypos, empire);
        }
        if (flag4 || flag5) continue;
        let habitatList = galaxy.systemHabitatsOf(k);
        // Perf: FindNearest over the empire's ports / large colonies (O(colonies)) is only needed for a habitat that
        // passes every filter below, so it is computed on first use. It reads only stellarObjectList (local, not changed
        // after it is built) and positions, which nothing in this loop moves — same value as computing it here.
        let stellarObject: Positioned | null = null;
        let stellarObjectDone = false;
        let flag6 = false;
        if (star.category === HabitatCategoryType.GasCloud) {
            habitatList = [star];
            flag6 = true;
        }
        for (const habitat2 of habitatList) {
            let num5 = 0.0;
            if (
                habitat2 == null ||
                habitat2.resources == null ||
                habitat2.resources.length <= 0 ||
                !empire.resourceMap.checkResourcesKnown(habitat2) ||
                (!includeAsteroids && habitat2.category === HabitatCategoryType.Asteroid) ||
                (habitat2.owner !== null && habitat2.owner !== galaxy.independentEmpire)
            ) {
                continue;
            }
            let flag7 = true;
            if (flag6) {
                if (determineMiningStationAtHabitatForEmpire(habitat2, empire) === null) flag7 = false;
            } else if (determineMiningStationAtHabitat(habitat2) === null) {
                flag7 = false;
            }
            if (flag7) continue;
            let flag8 = true;
            let assignedShip: unknown = null;
            const num6 = habitatPrioritizationIndexOf(habitatPrioritizationList2, habitat2);
            if (num6 >= 0) {
                if (filterOutAssignedHabitats) flag8 = false;
                else assignedShip = habitatPrioritizationList2[num6].assignedShip;
            }
            if (empire.pirateEmpireBaseHabitat === null && flag8) flag8 = checkEmpireTerritoryCanBuildAtHabitat(galaxy, empire, habitat2);
            if (!flag8) continue;
            const habitat3 = habitat2;
            num5 = num <= 0 ? calculateCurrentStrategicResourceValue(galaxy, habitat3) : calculateCurrentCompleteResourceValue(galaxy, habitat3);
            let x = 0.0;
            let y = 0.0;
            if (!stellarObjectDone) {
                stellarObject = findNearest(stellarObjectList, star.xpos, star.ypos);
                stellarObjectDone = true;
            }
            if (stellarObject !== null) {
                x = stellarObject.xpos;
                y = stellarObject.ypos;
            } else if (empire.pirateEmpireBaseHabitat !== null) {
                x = empire.pirateEmpireBaseHabitat.xpos;
                y = empire.pirateEmpireBaseHabitat.ypos;
            } else if (empire.capital !== null) {
                x = empire.capital.xpos;
                y = empire.capital.ypos;
            }
            if (!flag2) {
                const d = galaxy.calculateDistance(x, y, habitat3.xpos, habitat3.ypos);
                const num7 = Math.max(1.0, Math.sqrt(d) / 10.0);
                num5 /= num7;
            } else {
                let num8 = galaxy.calculateDistance(x, y, habitat3.xpos, habitat3.ypos);
                num8 -= MAX_SOLAR_SYSTEM_SIZE * 4;
                num8 = Math.max(1.0, num8);
                const num9 = Math.max(1.0, num8 / 10000.0);
                num5 /= num9;
            }
            if (num5 > 1.0) {
                let flag9 = true;
                if (flag3 && filterOutDangerousTargets && num5 < num4) flag9 = false;
                if (filterOutDangerousTargets && checkWhetherHabitatIsDangerous(galaxy, empire, habitat3)) flag9 = false;
                if (flag9) {
                    const habitatPrioritization = new HabitatPrioritization(habitat3, csToInt32(num5));
                    habitatPrioritization.assignedShip = assignedShip;
                    habitatPrioritizationList.push(habitatPrioritization);
                }
            }
        }
    }
    netSort(habitatPrioritizationList, (a, b) => a.compareTo(b));
    habitatPrioritizationList.reverse();
    // 19d2 AI rule 2 (scenario flag): sources of a luxury the empire lost widely go first (stable reorder, no Rnd).
    if (galaxy.scenario !== null) {
        const priority = crisesMiningPriority(galaxy, empire);
        if (priority.length > 0) {
            const first = habitatPrioritizationList.filter((p) => p.habitat !== null && p.habitat.resources.some((r) => priority.includes(r.resourceId)));
            if (first.length > 0) return [...first, ...habitatPrioritizationList.filter((p) => !first.includes(p))];
        }
    }
    return habitatPrioritizationList;
}
