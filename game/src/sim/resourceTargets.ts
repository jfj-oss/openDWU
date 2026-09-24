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
// Empire.DoTasks inside Galaxy.GenerateEmpire): built objects (space ports,
// construction ships and their missions, mining stations — Habitat.BasesAtHabitat),
// KnownPirateBases, SystemVisibility.Threats, DiplomaticRelations.

import type { Galaxy } from './galaxy';
import { HabitatCategoryType, type Habitat } from './types';
import type { Empire } from './empire';
import { BuiltObjectSubRole } from './builtObjectTypes';
import { ComponentCategoryType } from './data/policies';
import { findNewest } from './design';
import { GalaxyLocationEffectType, GalaxyLocationType } from './galaxyLocation';
import { netSort } from './netSort';
import { csToInt32, resourceCurrentPrice, type BuiltObjectView } from './forceStructure';

// Galaxy.MaxSolarSystemSize (Galaxy.3.cs InitializeStatics).
const MAX_SOLAR_SYSTEM_SIZE = 23000;

// Port of HabitatPrioritization.cs.
export class HabitatPrioritization {
    habitat: Habitat | null;
    priority: number; // C#: int
    /** C#: BuiltObject AssignedShip. TODO(port): BuiltObject type (src/sim/builtObject.ts). */
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

// TODO(port): Habitat.BasesAtHabitat (built objects parented to the habitat) is
// not modeled; no bases exist before Galaxy.CreateSpacePorts / CreateMiningStations.
function basesAtHabitat(_habitat: Habitat): (BuiltObjectView & { extractionGas: number; extractionMine: number })[] {
    return [];
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

// Galaxy.8.cs FindNearestPirateFaction(x, y, pirateFactionToExclude, includeSuperPirates) (2872).
function findNearestPirateFaction(galaxy: Galaxy, x: number, y: number, pirateFactionToExclude: Empire | null, includeSuperPirates: boolean): Empire | null {
    let num = Number.MAX_VALUE;
    let result: Empire | null = null;
    for (const empire of galaxy.pirateEmpires) {
        if (empire == null || empire.pirateEmpireBaseHabitat === null || empire.builtObjects == null || !empire.active || (pirateFactionToExclude !== null && empire === pirateFactionToExclude) || (!includeSuperPirates && empire.pirateEmpireSuperPirates)) continue;
        const num2 = galaxy.calculateDistanceSquared(x, y, empire.pirateEmpireBaseHabitat.xpos, empire.pirateEmpireBaseHabitat.ypos);
        if (!(num2 < num)) continue;
        let flag = false;
        for (const builtObject of empire.builtObjects as BuiltObjectView[]) {
            if (builtObject != null && (builtObject.subRole === BuiltObjectSubRole.GenericBase || isSpacePort(builtObject.subRole))) {
                flag = true;
                break;
            }
        }
        if (flag) {
            result = empire;
            num = num2;
        }
    }
    return result;
}

// Empire.5.cs CheckNearPirateBase(stellarObject, x, y, empireToExclude) (3451) →
// (stellarObject, scanRange, x, y, empireToExclude) (3456).
function checkNearPirateBase(galaxy: Galaxy, _stellarObject: Positioned | null, x: number, y: number, empireToExclude: Empire | null): boolean {
    const scanRange = csToInt32(MAX_SOLAR_SYSTEM_SIZE * 2.1);
    void scanRange;
    const empire = findNearestPirateFaction(galaxy, x, y, empireToExclude, true);
    if (empire !== null && empire.pirateEmpireBaseHabitat !== null) {
        // The pirate base = the faction's space port among PirateEmpireBaseHabitat.BasesAtHabitat;
        // then `KnownPirateBases.Contains(builtObject)`.
        // TODO(port): Empire.KnownPirateBases (BuiltObjectList) and BasesAtHabitat are
        // not modeled; both are empty at game start, so the check is false.
        const builtObject = basesAtHabitat(empire.pirateEmpireBaseHabitat).find((b) => b != null && b.empire === empire && isSpacePort(b.subRole)) ?? null;
        if (builtObject !== null) throw new Error('TODO(port): Empire.KnownPirateBases');
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
        const byEmpireId = galaxy.empires.find((e) => e.empireId === num) ?? null;
        if (byEmpireId !== null) {
            if (empire.pirateEmpireBaseHabitat !== null || byEmpireId.pirateEmpireBaseHabitat !== null) return true;
            // TODO(port): byEmpireId.ObtainDiplomaticRelation(empire) (Empire.4.cs 140) —
            // creates a NotMet DiplomaticRelation on first contact (side effect not
            // modeled); its MiningRightsToOther is false for a new relation.
            const miningRightsToOther = false;
            if (miningRightsToOther) return true;
        }
        // BaconGalaxy.CheckEmpireTerritoryCanBuildAtHabitat: buildAnywhere (false) ||
        // (empire == PlayerEmpire && DetermineDefendingFirepower(habitat, empire) > 300).
        // TODO(port): Galaxy.DetermineDefendingFirepower (Galaxy.6.cs 4696: ships near the
        // habitat + BasesAtHabitat firepower) — 0 before any built object exists.
        const buildAnywhere = false;
        const defendingFirepower = 0;
        return buildAnywhere || (empire === galaxy.playerEmpire && defendingFirepower > 300);
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
function checkConstructionShipAndMiningStationCanSurviveStorms(empire: Empire): boolean {
    let builtObject: unknown = null;
    if (empire.constructionShips.length > 0) builtObject = empire.constructionShips[empire.constructionShips.length - 1];
    const design = findNewest(empire.designs, BuiltObjectSubRole.MiningStation);
    if (design !== null && builtObject !== null) {
        // TODO(port): Design.ArmorReactive / BuiltObject.ArmorReactive (ReDefine) — no
        // construction ships exist at game start.
        throw new Error('TODO(port): ArmorReactive (Design/BuiltObject ReDefine)');
    }
    return false;
}

// Empire.4.cs DetermineHabitatsBuildingMiningStations (2279).
function determineHabitatsBuildingMiningStations(empire: Empire): HabitatPrioritization[] {
    const habitatPrioritizationList: HabitatPrioritization[] = [];
    if (empire.constructionShips.length > 0) {
        // TODO(port): BuiltObject.Mission / SubsequentMissions (Build targets).
        throw new Error('TODO(port): construction ship missions (BuiltObjectMission)');
    }
    return habitatPrioritizationList;
}

// Empire.9.cs CheckWhetherHabitatIsDangerous (4035).
function checkWhetherHabitatIsDangerous(galaxy: Galaxy, _empire: Empire, habitat: Habitat): boolean {
    const habitat2 = galaxy.determineHabitatSystemStar(habitat);
    // TODO(port): SystemVisibility[].Threats (pirate military ships/bases seen in the
    // system, ReviewSystemThreats) — empty at game start.
    void habitat2;
    return false;
}

// Empire.4.cs IdentifyResourceCentres(galaxy, filterOutAssignedHabitats = true,
// filterOutDangerousTargets = true, includeAsteroids = true) (1958).
export function identifyResourceCentres(galaxy: Galaxy, empire: Empire, filterOutAssignedHabitats = true, filterOutDangerousTargets = true, includeAsteroids = true): HabitatPrioritization[] {
    const habitatPrioritizationList: HabitatPrioritization[] = [];
    const stellarObjectList: Positioned[] = [];
    if (empire.pirateEmpireBaseHabitat !== null) {
        // TODO(port): BuiltObject positions (Empire.SpacePorts).
        stellarObjectList.push(...(empire.spacePorts as Positioned[]));
    } else {
        for (const builtObject of empire.builtObjects as (BuiltObjectView & Positioned)[]) {
            if (builtObject != null && !builtObject.hasBeenDestroyed && isSpacePort(builtObject.subRole)) stellarObjectList.push(builtObject);
        }
        for (const habitat of empire.colonies) {
            // TODO(port): Habitat.HasBeenDestroyed (false) / Habitat.HasSpacePort (a space
            // port in BasesAtHabitat — none before Galaxy.CreateSpacePorts).
            const hasSpacePort = false;
            if (habitat != null && !hasSpacePort && habitat.population != null && habitat.population.totalAmount >= 500000000) stellarObjectList.push(habitat);
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
        num2 = empire.dominantRace.aggression / 100.0;
        num3 = empire.dominantRace.caution / 100.0;
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
            flag5 = checkNearPirateBase(galaxy, star, star.xpos, star.ypos, empire);
        }
        if (flag4 || flag5) continue;
        let habitatList = galaxy.systemHabitatsOf(k);
        const stellarObject = findNearest(stellarObjectList, star.xpos, star.ypos);
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
    return habitatPrioritizationList;
}
