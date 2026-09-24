// M4g — resource extraction, industrial processing, manufacturing queues, empire resource needs.
//
// Ports (tasks/M4-plan.md §3.3 M4g):
//   Empire.2.cs 4023-4170 PrioritizeEmpireResourceNeeds (all overloads) + Empire.3.cs 16-99
//     IdentifyDeficientEmpireResources + Empire.4.cs 2262 DetermineHabitatsBeingMined;
//   BuiltObject.2.cs 7805-8129 IndustrialProcessing (+ BaconEmpire.cs 340 MaxResourceExtractionRate);
//   Habitat.cs 2827 ExtractResources; Habitat.cs 1477 → ManufacturingQueue.DoManufacturing (manufacturingQueue.ts);
//   Habitat.cs 1899 ReviewManufacturedResources.
// Shared helpers used here: HabitatResource.Extract (HabitatResource.cs), HabitatResourceList counts/Clone.
//
// Rnd: ReviewManufacturedResources draws Next(0, candidates) + NextDouble per prevalence entry + Next(min, max) when a
// colony-manufactured resource appears (Habitat.cs 1931/1943/1951). DoManufacturing draws Next(0, manufacturers) per
// call (manufacturingQueue.ts). IndustrialProcessing / ExtractResources / PrioritizeEmpireResourceNeeds: none.
//
// C# oddity (not reproduced): HabitatResourceList.RemoveAt (HabitatResourceList.cs 99) clears the removed id's slot in
// the private `_Index` array but does not shift the slots of the later entries, so after ReviewManufacturedResources
// removes a resource, IndexOf(id, 0) returns stale (one-too-high) positions for the entries behind it until the list
// is rebuilt (Clone, save/load). The TS HabitatResourceList is a plain array searched by id (findIndex), which is the
// intended behaviour; see the note at the RemoveAt site.

import type { Galaxy } from './galaxy';
import type { Empire } from './empire';
import type { BuiltObject } from './builtObject';
import type { Habitat } from './types';
import type { Character } from './characters';
import type { Resource } from './data/resources';
import { HabitatCategoryType } from './types';
import { BuiltObjectSubRole } from './builtObjectTypes';
import { BuiltObjectRole } from './data/designSpecifications';
import { ComponentCategoryType } from './data/policies';
import { ComponentType } from './data/components';
import { Cargo, ResourceRef } from './cargo';
import { csInt } from './builtObjectComponent';
import { CharacterSkillType, getHighestSkillLevel, getHighestSkillLevelExcludeLeaders, stellarObjectCharacters } from './characters';
import { galaxyResourceCurrentPrices } from './design';
import { habitatDevelopmentLevel } from './developmentLevel';
import { checkEmpireHasHyperDriveTech } from './forceStructure';
import { cargoAvailable, cargoGetCargo, cargoGetExists, cargoIndexOf, cargoIndexOfById, cargoRemove } from './logistics/orders';
import { BuiltObjectMissionType, builtObjectMission } from './missions/mission';
import { ResourceGroup, resourceGroupOf } from './resourceSystem';
import { HabitatPrioritization, checkEmpireTerritoryCanBuildAtHabitat, determineHabitatsBuildingMiningStations, habitatPrioritizationIndexOf } from './resourceTargets';
import { checkResourceSupplyMeetsExpectedBool, fastFindNearestSpacePort } from './stationPlacement';
import { netSort } from './netSort';
import { builtObjectManufacturingQueue, componentCargoNotModelled, habitatManufacturingQueue, listAddComponentToManufacture, type ManufacturedComponent, type Manufacturer, type ManufacturingQueue } from './manufacturingQueue';
import type { CargoList } from './cargo';
import { IndustryType } from './types';
import { EmpireMessageType, sendMessageToEmpire } from './messages';
import { gameText } from './colonyTick';
import { conditionCheckLimit } from './tick/builtObjectTick';
import { doConstructionBuiltObject, resetProcessTimeBuiltObject } from './construction/constructionQueue';
import { REAL_SECONDS_IN_GALACTIC_YEAR, galaxyStarDate } from './tick/simTime';

// ---------------------------------------------------------------------------------------------------------------
// HabitatResource / HabitatResourceList helpers (the TS Habitat.Resources is `{ resourceId, abundance }[]`).
// ---------------------------------------------------------------------------------------------------------------

type HabitatResource = { resourceId: number; abundance: number };

function resourceDefinition(galaxy: Galaxy, resourceId: number): Resource {
    return galaxy.resourceSystem.byId.get(resourceId)!;
}

/** Resource.Group (Resource.cs 24). */
function groupOf(galaxy: Galaxy, resourceId: number): ResourceGroup {
    return resourceGroupOf(resourceDefinition(galaxy, resourceId));
}

/** HabitatResource.Extract(extractionVolume) (HabitatResource.cs): Math.Max(1, (int)(volume / (1000.0 / Abundance))). */
export function habitatResourceExtract(habitatResource: HabitatResource, extractionVolume: number): number {
    return Math.max(1, csInt(extractionVolume / (1000.0 / habitatResource.abundance)));
}

/** HabitatResourceList.Clone() (HabitatResourceList.cs 64): new HabitatResource(id, abundance) per non-null entry. */
function cloneHabitatResources(list: readonly HabitatResource[]): HabitatResource[] {
    const out: HabitatResource[] = [];
    for (const r of list) {
        // HabitatResourceList.Add skips duplicate ids.
        if (r !== null && !out.some((o) => o.resourceId === r.resourceId)) out.push({ resourceId: r.resourceId, abundance: r.abundance });
    }
    return out;
}

/** HabitatResourceList.IndexOf(resourceId, startIndex) (125). */
function habitatResourceIndexOf(list: readonly HabitatResource[], resourceId: number, startIndex: number): number {
    const num = list.findIndex((r) => r.resourceId === resourceId);
    return num >= startIndex ? num : -1;
}

/** HabitatResourceList.CountLuxuryResources / CountGasResources / CountMineralResources (168-202). */
function countGroup(galaxy: Galaxy, list: readonly HabitatResource[], group: ResourceGroup): number {
    let num = 0;
    for (const r of list) if (r !== null && groupOf(galaxy, r.resourceId) === group) ++num;
    return num;
}

/** HabitatResourceList.CountColonyManufacturedResources (204). */
function countColonyManufacturedResources(galaxy: Galaxy, list: readonly HabitatResource[]): number {
    let num = 0;
    for (const r of list) if (r !== null && resourceDefinition(galaxy, r.resourceId).colonyManufacturingLevel > 0) ++num;
    return num;
}

/** Empire.MiningRate (Empire.cs 415 = Galaxy.MiningRateDefault 1.0; BaconGalaxy.SetEmpireDifficultyFactors). */
function empireMiningRate(empire: Empire): number {
    return empire.difficultyFactors?.miningRate ?? 1.0;
}

// ---------------------------------------------------------------------------------------------------------------
// Empire.2.cs 4023-4170 PrioritizeEmpireResourceNeeds
// ---------------------------------------------------------------------------------------------------------------

/** ResourceList entry of IdentifyDeficientEmpireResources: Resource + SortTag. */
export interface DeficientResource {
    resourceId: number;
    sortTag: number;
    isLuxuryResource: boolean;
}

/** Empire.3.cs 21 IdentifyDeficientEmpireResources(includeLuxuryResources, minimumDemand). No Rnd. */
export function identifyDeficientEmpireResources(galaxy: Galaxy, empire: Empire, includeLuxuryResources: boolean, minimumDemand: number): DeficientResource[] {
    const rs = galaxy.resourceSystem;
    const orders = galaxy.orders.getOrdersForEmpire(empire);
    const array = new Array<number>(rs.resources.length).fill(0);
    for (let i = 0; i < orders.length; i++) {
        const item = orders.at(i);
        if (item.commodityResource !== null && item.amountOutstandingToContract > 0) {
            const commodityResource = item.commodityResource;
            array[commodityResource.resourceId] = (array[commodityResource.resourceId] + item.amountOutstandingToContract) | 0;
        }
    }
    const array2 = new Array<number>(rs.resources.length).fill(0);
    for (let i = 0; i < empire.spacePorts.length; i++) {
        const builtObject = empire.spacePorts[i];
        if (builtObject.cargo === null) continue;
        for (const item2 of builtObject.cargo.items) {
            // item2.CommodityResource != null: the TS cargo only holds resources.
            if (cargoAvailable(item2) > 0) {
                array2[item2.commodity.resourceId] = (array2[item2.commodity.resourceId] + cargoAvailable(item2)) | 0;
            }
        }
    }
    if (checkEmpireHasHyperDriveTech(empire)) {
        for (let j = 0; j < empire.miningStations.length; j++) {
            const builtObject2 = empire.miningStations[j];
            if (builtObject2.cargo === null) continue;
            for (const item3 of builtObject2.cargo.items) {
                if (cargoAvailable(item3) > 0) {
                    array2[item3.commodity.resourceId] = (array2[item3.commodity.resourceId] + cargoAvailable(item3)) | 0;
                }
            }
        }
    }
    for (let k = 0; k < array2.length; k++) {
        const resourceId = rs.resources[k].resourceId;
        let isCriticalEmpireResource = false;
        // DominantRace.CriticalResources.GetBonusByResourceType(id) != null.
        if (empire.dominantRace !== null && empire.dominantRace.criticalResources.some((b) => b != null && b.resourceId === resourceId)) {
            isCriticalEmpireResource = true;
        }
        if (checkResourceSupplyMeetsExpectedBool(galaxy, empire, resourceId, isCriticalEmpireResource, 1.5)) {
            array2[k] = Math.max(10000, Math.max((array2[k] * 2) | 0, (array[k] * 5) | 0));
        }
    }
    const resourceList: DeficientResource[] = [];
    for (let l = 0; l < rs.resources.length; l++) {
        const def = rs.resources[l];
        const isLuxuryResource = resourceGroupOf(def) === ResourceGroup.Luxury;
        let val = 0.0;
        if (includeLuxuryResources) {
            val = array[l] / Math.max(1.0, array2[l]);
        } else if (!isLuxuryResource) {
            val = array[l] / Math.max(1.0, array2[l]);
        }
        resourceList.push({ resourceId: def.resourceId, sortTag: Math.max(minimumDemand, val), isLuxuryResource });
    }
    // ResourceList.Sort() → Resource.CompareTo (Resource.cs 44): SortTag > double.MinValue ⇒ SortTag.CompareTo (always here).
    netSort(resourceList, (a, b) => (a.sortTag < b.sortTag ? -1 : a.sortTag > b.sortTag ? 1 : 0));
    resourceList.reverse();
    return resourceList;
}

/** Empire.4.cs 2262 DetermineHabitatsBeingMined(minedHabitats, builtObjects). */
export function determineHabitatsBeingMined(minedHabitats: Habitat[], builtObjects: readonly BuiltObject[]): Habitat[] {
    for (let i = 0; i < builtObjects.length; i++) {
        const builtObject = builtObjects[i];
        const mission = builtObjectMission(builtObject.mission);
        if (builtObject.isResourceExtractor && mission !== null && mission.type === BuiltObjectMissionType.ExtractResources && mission.targetHabitat !== null) {
            minedHabitats.push(mission.targetHabitat);
        }
        if ((builtObject.subRole === BuiltObjectSubRole.GasMiningStation || builtObject.subRole === BuiltObjectSubRole.MiningStation) && builtObject.parentHabitat !== null) {
            minedHabitats.push(builtObject.parentHabitat);
        }
    }
    return minedHabitats;
}

/**
 * Empire.2.cs 4023/4028/4033/4038 PrioritizeEmpireResourceNeeds([includeLuxuryResources = false, topResourceCount = 5,
 * minimumValue = 1.0, filterOutHabitatsWithMiningStationsUnderConstruction = true, includeAsteroids = true]). No Rnd.
 */
export function prioritizeEmpireResourceNeeds(
    galaxy: Galaxy,
    empire: Empire,
    includeLuxuryResources = false,
    topResourceCount = 5,
    minimumValue = 1.0,
    filterOutHabitatsWithMiningStationsUnderConstruction = true,
    includeAsteroids = true,
): HabitatPrioritization[] {
    const habitatPrioritizationList: HabitatPrioritization[] = [];
    const resourceList = identifyDeficientEmpireResources(galaxy, empire, includeLuxuryResources, minimumValue);
    const flag = true;
    let flag2 = true;
    if (empire.research !== null && empire.research.researchedComponents !== null && empire.research.researchedComponents.filter((c) => c.category === ComponentCategoryType.HyperDrive).length <= 0) {
        flag2 = false;
        topResourceCount = Math.max(10, resourceList.length);
    }
    let minedHabitats: Habitat[] = [];
    minedHabitats = determineHabitatsBeingMined(minedHabitats, empire.builtObjects);
    minedHabitats = determineHabitatsBeingMined(minedHabitats, empire.privateBuiltObjects);
    let habitatPrioritizationList2: HabitatPrioritization[] = [];
    if (includeLuxuryResources) {
        habitatPrioritizationList2 = determineHabitatsBuildingMiningStations(empire);
    }
    for (let i = 0; i < empire.systemVisibility.length; i++) {
        if (!empire.visibility.checkSystemExplored(i)) continue;
        // SystemVisibility[i].SystemStar; _Galaxy.FastFindNearestSpacePort(star.Xpos, star.Ypos, this).
        const systemStar = galaxy.systems[i].systemStar;
        const builtObject = fastFindNearestSpacePort(galaxy, systemStar.xpos, systemStar.ypos, empire);
        const habitats = galaxy.systemHabitatsOf(systemStar.systemIndex);
        for (let j = 0; j < habitats.length; j++) {
            const habitat = habitats[j];
            if (habitat.resources.length <= 0) continue;
            let num = 0.0;
            if (!empire.resourceMap.checkResourcesKnown(habitat) || (!includeAsteroids && habitat.category === HabitatCategoryType.Asteroid) || (habitat.owner !== null && habitat.owner !== galaxy.independentEmpire)) {
                continue;
            }
            let flag3 = true;
            let assignedShip: unknown = null;
            const num2 = habitatPrioritizationIndexOf(habitatPrioritizationList2, habitat);
            if (num2 >= 0) {
                if (filterOutHabitatsWithMiningStationsUnderConstruction) {
                    flag3 = false;
                } else {
                    assignedShip = habitatPrioritizationList2[num2].assignedShip;
                }
            }
            if (flag3) {
                if (empire.pirateEmpireBaseHabitat === null) {
                    flag3 = checkEmpireTerritoryCanBuildAtHabitat(galaxy, empire, habitat);
                } else {
                    const bySystemIndex = galaxy.systems[habitat.systemIndex] ?? null;
                    if (bySystemIndex !== null && bySystemIndex.dominantEmpire != null && bySystemIndex.dominantEmpire.empire != null && bySystemIndex.dominantEmpire.empire !== empire) {
                        flag3 = false;
                    }
                }
            }
            if (!flag3) continue;
            const habitat2 = habitat;
            for (let k = 0; k < topResourceCount && k < resourceList.length; k++) {
                const num3 = habitatResourceIndexOf(habitat2.resources, resourceList[k].resourceId, 0);
                if (num3 < 0) continue;
                if (resourceList[k].isLuxuryResource) {
                    if (flag) num += resourceList[k].sortTag * 1000.0;
                } else {
                    num += resourceList[k].sortTag * 1000.0;
                }
            }
            if (!flag2) {
                if (builtObject !== null) {
                    num /= Math.sqrt(galaxy.calculateDistance(builtObject.xpos, builtObject.ypos, habitat2.xpos, habitat2.ypos));
                    num *= 100.0;
                } else if (empire.capital !== null) {
                    num /= Math.sqrt(galaxy.calculateDistance(empire.capital.xpos, empire.capital.ypos, habitat2.xpos, habitat2.ypos));
                    num *= 100.0;
                }
            } else if (builtObject !== null) {
                num /= Math.sqrt(Math.sqrt(galaxy.calculateDistance(builtObject.xpos, builtObject.ypos, habitat2.xpos, habitat2.ypos)));
            } else if (empire.capital !== null) {
                num /= Math.sqrt(Math.sqrt(galaxy.calculateDistance(empire.capital.xpos, empire.capital.ypos, habitat2.xpos, habitat2.ypos)));
            }
            if (num > 1.0) {
                const habitatPrioritization = new HabitatPrioritization(habitat2, csInt(num));
                habitatPrioritization.assignedShip = assignedShip;
                habitatPrioritizationList.push(habitatPrioritization);
            }
        }
    }
    const habitatPrioritizationList3: HabitatPrioritization[] = [];
    for (const item of habitatPrioritizationList) {
        if (item.habitat !== null && minedHabitats.includes(item.habitat)) habitatPrioritizationList3.push(item);
    }
    for (const item2 of habitatPrioritizationList3) {
        const index = habitatPrioritizationList.indexOf(item2);
        if (index >= 0) habitatPrioritizationList.splice(index, 1);
    }
    netSort(habitatPrioritizationList, (a, b) => a.compareTo(b));
    habitatPrioritizationList.reverse();
    return habitatPrioritizationList;
}

// ---------------------------------------------------------------------------------------------------------------
// BuiltObject.2.cs 7805-8129 IndustrialProcessing
// ---------------------------------------------------------------------------------------------------------------

/**
 * BaconEmpire.cs 340 MaxResourceExtractionRate(ship, resourceType) — 0 mine, 1 luxury, 2 gas. The C# takes the first
 * non-null entry of `ship.Empire.Research.ComponentImprovements` (an array indexed by ComponentID) whose improved
 * component has the extractor type, i.e. the one with the lowest component id.
 */
export function maxResourceExtractionRate(ship: BuiltObject, resourceType: number): number {
    if (ship.actualEmpire !== null && ship.actualEmpire.name.includes('Romulan')) return 40000.0;
    let num = 4.0;
    const firstImprovement = (type: ComponentType): { value2: number } | null => {
        let best: { value2: number; id: number } | null = null;
        for (const [id, ci] of ship.empire!.research.componentImprovements) {
            if (ci != null && ci.improvedComponent != null && ci.improvedComponent.type === type && (best === null || id < best.id)) best = { value2: ci.value2, id };
        }
        return best;
    };
    switch (resourceType) {
        case 0: {
            const componentImprovement1 = firstImprovement(ComponentType.ExtractorMine);
            if (componentImprovement1 !== null) num = componentImprovement1.value2;
            if (num < 12.0) num = 12.0;
            break;
        }
        case 1: {
            const componentImprovement2 = firstImprovement(ComponentType.ExtractorLuxury);
            if (componentImprovement2 !== null) num = componentImprovement2.value2;
            if (num < 12.0) num = 12.0;
            break;
        }
        case 2: {
            const componentImprovement3 = firstImprovement(ComponentType.ExtractorGasExtractor);
            if (componentImprovement3 !== null) num = componentImprovement3.value2;
            if (num < 12.0) num = 40.0;
            break;
        }
    }
    return num;
}

/** Cargo.GetTotalResourceAmount(resource, empireId) (CargoList.cs 535). */
function totalResourceAmount(bo: BuiltObject, resourceId: number, empire: Empire): number {
    const index = cargoIndexOfById(bo.cargo!, resourceId, empire.empireId);
    return index >= 0 ? bo.cargo!.items[index].amount : 0;
}

/**
 * BuiltObject.2.cs 7805 IndustrialProcessing(timePassed, galaxy, time) — `timePassed` in seconds, `time` game ms. Stopped
 * extractors mine their (unowned) parent habitat into cargo; stopped manufacturers and yards run their queues.
 * No direct Rnd (DoManufacturing draws, manufacturingQueue.ts; DoConstruction is M4h's).
 */
export function industrialProcessing(galaxy: Galaxy, builtObject: BuiltObject, timePassed: number, time: number): void {
    const bo = builtObject;
    if (bo.empire === null) return;
    const actualEmpire = bo.actualEmpire;
    if (actualEmpire === null) return;
    bo.doingMining = false;
    bo.doingGasMining = false;
    bo.doingConstruction = false;
    const rs = galaxy.resourceSystem;
    const counters = actualEmpire.counters;
    let num = 0;
    if (bo.role === BuiltObjectRole.Base) num = 500;
    if (bo.currentSpeed === 0) {
        // 7826-7858: energy-to-fuel conversion near a star.
        if (bo.energyToFuelRate > 0 && bo.nearestSystemStar !== null) {
            const star = bo.nearestSystemStar;
            const num2 = 0.01 * (star.solarRadiation + star.microwaveRadiation + star.xrayRadiation);
            const num3 = galaxy.calculateDistance(bo.xpos, bo.ypos, star.xpos, star.ypos);
            let num4 = 1.0 - num3 / galaxy.maxSolarSystemSize;
            num4 *= num4;
            const num5 = num2 * num4;
            const num6 = bo.energyToFuelRate;
            const num7 = num6 * num5;
            const num8 = num7 * timePassed;
            if (bo.cargo !== null) {
                const num9 = bo.cargoSpace / bo.cargoCapacity;
                if (num9 > 0.25) {
                    const num10 = Math.min(120000, Math.trunc(bo.cargoCapacity / 4));
                    const amount = csInt(num8 / rs.fuelResources.length);
                    for (let i = 0; i < rs.fuelResources.length; i++) {
                        const def = rs.fuelResources[i];
                        if (def != null) {
                            if (totalResourceAmount(bo, def.resourceId, actualEmpire) < num10) {
                                // new Cargo(resource, amount, actualEmpire.EmpireId).
                                bo.cargo.add(new Cargo(new ResourceRef(def.resourceId), amount, actualEmpire));
                            }
                        }
                    }
                }
            }
        }
        // 7859-8115: extraction from an unowned parent habitat.
        const parentHabitat = bo.parentHabitat;
        if ((bo.extractionGas > 0 || bo.extractionLuxury > 0 || bo.extractionMine > 0) && parentHabitat !== null && (parentHabitat.empire === null || parentHabitat.empire === galaxy.independentEmpire)) {
            let habitatResourceList: HabitatResource[] = [];
            if (parentHabitat.resources != null) habitatResourceList = cloneHabitatResources(parentHabitat.resources);
            if (bo.isResourceExtractor && (bo.subRole !== BuiltObjectSubRole.ResupplyShip || bo.isDeployed)) {
                let num11 = bo.cargoCapacity - num;
                if (habitatResourceList !== null && habitatResourceList.length > 0) {
                    num11 = Math.min(120000, csInt((bo.cargoCapacity - num) / habitatResourceList.length + 0.99999));
                    let num12 = 0;
                    if (bo.extractionLuxury <= 0) num12 += countGroup(galaxy, habitatResourceList, ResourceGroup.Luxury);
                    if (bo.extractionGas <= 0) num12 += countGroup(galaxy, habitatResourceList, ResourceGroup.Gas);
                    if (bo.extractionMine <= 0) num12 += countGroup(galaxy, habitatResourceList, ResourceGroup.Mineral);
                    if (num12 > 0) {
                        const num13 = Math.max(0, habitatResourceList.length - num12);
                        num11 = num13 > 0 ? Math.min(120000, Math.trunc((bo.cargoCapacity - num) / num13)) : 0;
                    }
                }
                // 7896-7932: a full extractor dumps half of every other resource when a local fuel is short.
                if (bo.cargo !== null && bo.cargoCapacity > 0 && bo.cargoSpace <= num) {
                    let flag = false;
                    const num14 = Math.trunc(bo.cargoCapacity / 8);
                    let item = 255;
                    for (let j = 0; j < rs.fuelResources.length; j++) {
                        const def2 = rs.fuelResources[j];
                        if (def2 != null && habitatResourceIndexOf(habitatResourceList, def2.resourceId, 0) >= 0) {
                            let num15 = 0;
                            const num16 = cargoIndexOf(bo.cargo, def2.resourceId, actualEmpire);
                            if (num16 >= 0) num15 = bo.cargo.items[num16].amount;
                            if (num15 < num14) {
                                flag = true;
                                item = def2.resourceId;
                            }
                        }
                    }
                    if (flag) {
                        const list = [item];
                        for (let k = 0; k < bo.cargo.items.length; k++) {
                            const c = bo.cargo.items[k];
                            // Cargo[k].CommodityIsResource: the TS cargo only holds resources.
                            if (!list.includes(c.commodity.resourceId) && cargoAvailable(c) > 0) {
                                c.amount -= Math.trunc(cargoAvailable(c) / 2);
                            }
                        }
                    }
                }
                if (bo.cargo !== null && bo.cargoSpace > num) {
                    let num17 = 1.0;
                    if (actualEmpire !== null && actualEmpire !== galaxy.independentEmpire) {
                        num17 *= 1.0 + bo.empire.resourceExtractionBonus;
                        num17 *= empireMiningRate(actualEmpire);
                    }
                    if (actualEmpire !== null && actualEmpire.leader !== null) {
                        num17 *= 1.0 + actualEmpire.leader.miningRate / 100.0;
                    }
                    const characters = bo.characters as Character[] | null;
                    if (characters !== null && characters.length > 0) {
                        const highestSkillLevel = getHighestSkillLevel(characters, CharacterSkillType.MiningRate);
                        num17 *= 1.0 + highestSkillLevel / 100.0;
                    }
                    let flag2 = false;
                    const num18 = 1.0;
                    const prices = galaxyResourceCurrentPrices(galaxy);
                    const num19 = (bo.cargoSpace - num) / bo.cargoCapacity;
                    // 7956-8028: a nearly full mining station keeps extracting only the scarce (< 30 %) priced fuel resources.
                    if (num19 < 0.25 && (bo.subRole === BuiltObjectSubRole.GasMiningStation || bo.subRole === BuiltObjectSubRole.MiningStation)) {
                        if (bo.extractionGas > 0) {
                            let val = bo.extractionGas * num17 * timePassed;
                            val = Math.min(val, timePassed * maxResourceExtractionRate(bo, 2));
                            for (let l = 0; l < rs.fuelResources.length; l++) {
                                const def3 = rs.fuelResources[l];
                                if (def3 == null || resourceGroupOf(def3) !== ResourceGroup.Gas) continue;
                                const num20 = habitatResourceIndexOf(habitatResourceList, def3.resourceId, 0);
                                if (num20 >= 0 && prices[def3.resourceId] > num18) {
                                    const num21 = cargoIndexOf(bo.cargo, def3.resourceId, actualEmpire);
                                    let num22 = 0.0;
                                    if (num21 >= 0) num22 = bo.cargo.items[num21].amount / (bo.cargoCapacity - 200);
                                    if (num22 < 0.3) {
                                        const num23 = habitatResourceExtract(habitatResourceList[num20], val);
                                        counters.miningExtractionGas = (counters.miningExtractionGas + num23) | 0;
                                        bo.cargo.add(new Cargo(new ResourceRef(def3.resourceId), num23, actualEmpire));
                                        flag2 = true;
                                        bo.doingGasMining = true;
                                    }
                                }
                            }
                        }
                        if (bo.extractionMine > 0) {
                            let val2 = bo.extractionMine * num17 * timePassed;
                            val2 = Math.min(val2, timePassed * maxResourceExtractionRate(bo, 0));
                            for (let m = 0; m < rs.fuelResources.length; m++) {
                                const def4 = rs.fuelResources[m];
                                if (def4 == null || resourceGroupOf(def4) !== ResourceGroup.Mineral) continue;
                                const num24 = habitatResourceIndexOf(habitatResourceList, def4.resourceId, 0);
                                if (num24 < 0 || !(prices[def4.resourceId] > num18)) continue;
                                const num25 = cargoIndexOf(bo.cargo, def4.resourceId, actualEmpire);
                                let num26 = 0.0;
                                if (num25 >= 0) num26 = bo.cargo.items[num25].amount / (bo.cargoCapacity - 200);
                                if (num26 < 0.3) {
                                    const num27 = habitatResourceExtract(habitatResourceList[num24], val2);
                                    counters.miningExtractionStrategic = (counters.miningExtractionStrategic + num27) | 0;
                                    if (resourceDefinition(galaxy, habitatResourceList[num24].resourceId).colonyManufacturingLevel > 0) {
                                        counters.miningExtractionColonyManufactured = (counters.miningExtractionColonyManufactured + num27) | 0;
                                    }
                                    bo.cargo.add(new Cargo(new ResourceRef(def4.resourceId), num27, actualEmpire));
                                    flag2 = true;
                                    bo.doingMining = true;
                                }
                            }
                        }
                    }
                    if (!flag2) {
                        // 8031-8050: luxury extraction.
                        if (bo.extractionLuxury > 0) {
                            let val3 = bo.extractionLuxury * num17 * timePassed;
                            val3 = Math.min(val3, timePassed * maxResourceExtractionRate(bo, 1));
                            for (let n = 0; n < habitatResourceList.length; n++) {
                                const habitatResource = habitatResourceList[n];
                                if (habitatResource !== null && groupOf(galaxy, habitatResource.resourceId) === ResourceGroup.Luxury) {
                                    if (totalResourceAmount(bo, habitatResource.resourceId, actualEmpire) < num11) {
                                        const num28 = habitatResourceExtract(habitatResource, val3);
                                        counters.miningExtractionLuxury = (counters.miningExtractionLuxury + num28) | 0;
                                        bo.cargo.add(new Cargo(new ResourceRef(habitatResource.resourceId), num28, actualEmpire));
                                    }
                                }
                            }
                        }
                        // 8051-8090: gas extraction (a resupply ship takes every fuel resource).
                        if (bo.extractionGas > 0) {
                            bo.doingGasMining = true;
                            let val4 = bo.extractionGas * num17 * timePassed;
                            val4 = Math.min(val4, timePassed * maxResourceExtractionRate(bo, 2));
                            if (bo.subRole === BuiltObjectSubRole.ResupplyShip) {
                                for (let num29 = 0; num29 < habitatResourceList.length; num29++) {
                                    const habitatResource2 = habitatResourceList[num29];
                                    if (habitatResource2 !== null && resourceDefinition(galaxy, habitatResource2.resourceId).isFuel) {
                                        if (totalResourceAmount(bo, habitatResource2.resourceId, actualEmpire) < num11) {
                                            const num30 = habitatResourceExtract(habitatResource2, val4);
                                            counters.miningExtractionGas = (counters.miningExtractionGas + num30) | 0;
                                            bo.cargo.add(new Cargo(new ResourceRef(habitatResource2.resourceId), num30, actualEmpire));
                                        }
                                    }
                                }
                            } else {
                                for (let num31 = 0; num31 < habitatResourceList.length; num31++) {
                                    const habitatResource3 = habitatResourceList[num31];
                                    if (habitatResource3 !== null && groupOf(galaxy, habitatResource3.resourceId) === ResourceGroup.Gas) {
                                        if (totalResourceAmount(bo, habitatResource3.resourceId, actualEmpire) < num11) {
                                            const num32 = habitatResourceExtract(habitatResource3, val4);
                                            counters.miningExtractionGas = (counters.miningExtractionGas + num32) | 0;
                                            bo.cargo.add(new Cargo(new ResourceRef(habitatResource3.resourceId), num32, actualEmpire));
                                        }
                                    }
                                }
                            }
                        }
                        // 8091-8113: mineral extraction.
                        if (bo.extractionMine > 0) {
                            bo.doingMining = true;
                            let val5 = bo.extractionMine * num17 * timePassed;
                            val5 = Math.min(val5, timePassed * maxResourceExtractionRate(bo, 0));
                            for (let num33 = 0; num33 < habitatResourceList.length; num33++) {
                                const habitatResource4 = habitatResourceList[num33];
                                if (habitatResource4 === null || groupOf(galaxy, habitatResource4.resourceId) !== ResourceGroup.Mineral) continue;
                                if (totalResourceAmount(bo, habitatResource4.resourceId, actualEmpire) < num11) {
                                    const num34 = habitatResourceExtract(habitatResource4, val5);
                                    counters.miningExtractionStrategic = (counters.miningExtractionStrategic + num34) | 0;
                                    if (resourceDefinition(galaxy, habitatResource4.resourceId).colonyManufacturingLevel > 0) {
                                        counters.miningExtractionColonyManufactured = (counters.miningExtractionColonyManufactured + num34) | 0;
                                    }
                                    bo.cargo.add(new Cargo(new ResourceRef(habitatResource4.resourceId), num34, actualEmpire));
                                }
                            }
                        }
                    }
                }
            }
        }
        // 8116-8123.
        const manufacturingQueue = builtObjectManufacturingQueue(bo);
        if (bo.isManufacturer && manufacturingQueue !== null) {
            manufacturingQueueDoManufacturing(manufacturingQueue, galaxy, time, galaxyStarDate(galaxy));
        }
        if (bo.isShipYard && bo.constructionQueue !== null) {
            // RND: ConstructionQueue.DoConstruction draws — not drawn until M4h.
            doConstructionBuiltObject(galaxy, bo, time);
        }
    } else if (bo.constructionQueue !== null) {
        // 8125-8128 ConstructionQueue.ResetProcessTime(time) (M4h).
        resetProcessTimeBuiltObject(galaxy, bo, time);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Habitat.cs 2827 ExtractResources
// ---------------------------------------------------------------------------------------------------------------

/** Habitat.cs 2827 ExtractResources(timePassed): a colony mines its own resources into its cargo. No Rnd. */
export function extractResources(galaxy: Galaxy, habitat: Habitat, timePassed: number): void {
    if (habitat.cargo === null) return;
    const habitatResourceList = cloneHabitatResources(habitat.resources);
    let num = 1.0;
    if (habitat.owner !== null && habitat.owner !== galaxy.independentEmpire) {
        num = 1.0 + habitat.owner.resourceExtractionBonus;
    }
    if (habitat.empire !== null && habitat.empire.leader !== null) {
        num *= 1.0 + habitat.empire.leader.miningRate / 100.0;
    }
    const characters = stellarObjectCharacters(habitat);
    if (characters !== null && characters.length > 0) {
        const highestSkillLevelExcludeLeaders = getHighestSkillLevelExcludeLeaders(characters, CharacterSkillType.MiningRate);
        num *= 1.0 + highestSkillLevelExcludeLeaders / 100.0;
    }
    let num2 = Math.min(9.0, Math.max(3.0, habitat.population.totalAmount / 100000000.0));
    num2 *= num;
    if (habitat.owner === null || habitat.owner === galaxy.independentEmpire) {
        num2 *= 1.0;
    }
    if (habitat.empire !== null && habitat.empire !== galaxy.independentEmpire) {
        num2 *= empireMiningRate(habitat.empire);
    }
    let num3 = Math.max(1, csInt(num2 * timePassed));
    if (habitat.population.totalAmount <= 0) num3 = 0;
    if (num3 <= 0) return;
    let empire = habitat.empire;
    if (empire === null) empire = galaxy.independentEmpire!;
    const counters = empire.counters;
    for (let i = 0; i < habitatResourceList.length; i++) {
        const habitatResource = habitatResourceList[i];
        if (habitatResource !== null && groupOf(galaxy, habitatResource.resourceId) === ResourceGroup.Luxury) {
            const num4 = habitatResourceExtract(habitatResource, num3);
            counters.miningExtractionLuxury = (counters.miningExtractionLuxury + num4) | 0;
            habitat.cargo.add(new Cargo(new ResourceRef(habitatResource.resourceId), num4, empire));
        }
    }
    for (let j = 0; j < habitatResourceList.length; j++) {
        const habitatResource2 = habitatResourceList[j];
        if (habitatResource2 !== null && groupOf(galaxy, habitatResource2.resourceId) === ResourceGroup.Gas) {
            const num5 = habitatResourceExtract(habitatResource2, num3);
            counters.miningExtractionGas = (counters.miningExtractionGas + num5) | 0;
            habitat.cargo.add(new Cargo(new ResourceRef(habitatResource2.resourceId), num5, empire));
        }
    }
    for (let k = 0; k < habitatResourceList.length; k++) {
        const habitatResource3 = habitatResourceList[k];
        if (habitatResource3 !== null && groupOf(galaxy, habitatResource3.resourceId) === ResourceGroup.Mineral) {
            const num6 = habitatResourceExtract(habitatResource3, num3);
            counters.miningExtractionStrategic = (counters.miningExtractionStrategic + num6) | 0;
            if (resourceDefinition(galaxy, habitatResource3.resourceId).colonyManufacturingLevel > 0) {
                counters.miningExtractionColonyManufactured = (counters.miningExtractionColonyManufactured + num6) | 0;
            }
            habitat.cargo.add(new Cargo(new ResourceRef(habitatResource3.resourceId), num6, empire));
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// ManufacturingQueue.cs 152-376: the processing half of ManufacturingQueue (model in manufacturingQueue.ts)
// ---------------------------------------------------------------------------------------------------------------

/** ComponentResource (ResourceID + Quantity) — a component's resource requirement. */
interface ComponentResource {
    resourceId: number;
    quantity: number;
}

/**
 * CargoList.GetResourcesForManufacturing(component, empire, out manufacturingResources, out deficientResourceId,
 * ref resourceAmounts) (CargoList.cs 547). `resourceAmounts` is indexed by resource id (-1 = not looked up yet).
 */
export function getResourcesForManufacturing(
    cargoList: CargoList,
    componentToBeManufactured: ManufacturedComponent,
    empire: Empire | null,
    resourceAmounts: number[],
): { ok: boolean; manufacturingResources: ComponentResource[]; deficientResourceId: number } {
    const manufacturingResources: ComponentResource[] = [];
    let deficientResourceId = 255;
    for (const req of componentToBeManufactured.resourceRequirements) {
        const requiredResource: ComponentResource = { resourceId: req.resourceId, quantity: req.amount };
        if (resourceAmounts[requiredResource.resourceId] === -1) {
            if (cargoGetExists(cargoList, requiredResource.resourceId)) {
                const index = cargoIndexOf(cargoList, requiredResource.resourceId, empire);
                if (index >= 0) {
                    const cargo = cargoList.items[index];
                    resourceAmounts[requiredResource.resourceId] = cargo.amount;
                    if (cargo.amount >= requiredResource.quantity) {
                        manufacturingResources.push(requiredResource); // AddWithoutCheck
                    } else {
                        deficientResourceId = requiredResource.resourceId;
                        return { ok: false, manufacturingResources, deficientResourceId };
                    }
                } else {
                    resourceAmounts[requiredResource.resourceId] = 0;
                    deficientResourceId = requiredResource.resourceId;
                    return { ok: false, manufacturingResources, deficientResourceId };
                }
            } else {
                resourceAmounts[requiredResource.resourceId] = 0;
                deficientResourceId = requiredResource.resourceId;
                return { ok: false, manufacturingResources, deficientResourceId };
            }
        } else if (resourceAmounts[requiredResource.resourceId] >= requiredResource.quantity) {
            // ComponentResourceList.Add (ComponentResourceList.cs 75) throws on a duplicate resource id.
            if (manufacturingResources.some((r) => r.resourceId === requiredResource.resourceId)) throw new Error("Can't add the same resource twice to a component");
            manufacturingResources.push(requiredResource);
        } else {
            deficientResourceId = requiredResource.resourceId;
        }
    }
    for (let index = 0; index < manufacturingResources.length; ++index) {
        resourceAmounts[manufacturingResources[index].resourceId] -= manufacturingResources[index].quantity;
    }
    return { ok: true, manufacturingResources, deficientResourceId };
}

/** ManufacturingQueue.cs 152 ProcessWaitQueue(parentCargo, empire, starDate). */
function processWaitQueue(queue: ManufacturingQueue, parentCargo: CargoList | null, empire: Empire | null, starDate: number): void {
    const componentList: ManufacturedComponent[] = [];
    const waitQueue = queue._componentWaitQueue!;
    if (waitQueue.length > 0 && parentCargo !== null && (queue._slotsAvailableEnergy > 0 || queue._slotsAvailableHighTech > 0 || queue._slotsAvailableWeapons > 0)) {
        // bool[Galaxy.ComponentDefinitionsStatic.Length] initialised true: the ids set false.
        const blockedComponentIds = new Set<number>();
        const resourceAmounts = new Array<number>(queue._galaxy.resourceSystem.resources.length).fill(-1);
        for (let index = 0; index < waitQueue.length; ++index) {
            const componentWait = waitQueue[index];
            if (componentWait !== null && !blockedComponentIds.has(componentWait.componentId)) {
                let num = 0;
                switch (componentWait.industry) {
                    case IndustryType.Weapon:
                        num = queue._slotsAvailableWeapons;
                        break;
                    case IndustryType.Energy:
                        num = queue._slotsAvailableEnergy;
                        break;
                    case IndustryType.HighTech:
                        num = queue._slotsAvailableHighTech;
                        break;
                }
                if (num > 0) {
                    const r = getResourcesForManufacturing(parentCargo, componentWait, empire, resourceAmounts);
                    if (r.ok) {
                        queue.deficientResources.clearResources(r.manufacturingResources);
                        if (listAddComponentToManufacture(queue._manufacturerList!, componentWait)) {
                            for (const componentResource of r.manufacturingResources) {
                                if (componentResource !== null) {
                                    const cargo = cargoGetCargo(parentCargo, componentResource.resourceId, empire);
                                    if (cargo !== null) {
                                        cargo.amount -= componentResource.quantity;
                                        cargo.reserved -= componentResource.quantity;
                                        if (cargo.amount <= 0 && cargo.reserved <= 0) cargoRemove(parentCargo, cargo);
                                    }
                                }
                            }
                            componentList.push(componentWait);
                            switch (componentWait.industry) {
                                case IndustryType.Weapon:
                                    --queue._slotsAvailableWeapons;
                                    continue;
                                case IndustryType.Energy:
                                    --queue._slotsAvailableEnergy;
                                    continue;
                                case IndustryType.HighTech:
                                    --queue._slotsAvailableHighTech;
                                    continue;
                                default:
                                    continue;
                            }
                        }
                    } else if (r.deficientResourceId !== 255) {
                        blockedComponentIds.add(componentWait.componentId);
                        queue.deficientResources.checkAddResource(r.deficientResourceId, starDate);
                    }
                } else {
                    blockedComponentIds.add(componentWait.componentId);
                    if (queue._slotsAvailableEnergy <= 0 && queue._slotsAvailableHighTech <= 0 && queue._slotsAvailableWeapons <= 0) break;
                }
            }
        }
        // ComponentList.Remove: first entry with the same reference.
        for (const component of componentList) {
            const i = waitQueue.indexOf(component);
            if (i >= 0) waitQueue.splice(i, 1);
        }
    }
    if (waitQueue.length > 0) return;
    queue.deficientResources.clear();
}

/** ManufacturingQueue.cs 239 ProcessManufacturing(timePassed, starDate, parentCargo, parentEmpire, ref completedComponents). Rnd: Next(0, Count). */
function processManufacturing(queue: ManufacturingQueue, timePassedMs: number, starDate: number, parentCargo: CargoList, parentEmpire: Empire | null, completedComponents: ManufacturedComponent[]): void {
    const list = queue._manufacturerList!;
    const num = queue._galaxy.rnd.next(0, list.length);
    for (let index = num; index < list.length; ++index) processSingleManufacturer(queue, list[index], timePassedMs, starDate, parentCargo, parentEmpire, completedComponents);
    for (let index = 0; index < num; ++index) processSingleManufacturer(queue, list[index], timePassedMs, starDate, parentCargo, parentEmpire, completedComponents);
}

/** ManufacturingQueue.cs 254 ProcessSingleManufacturer. */
function processSingleManufacturer(queue: ManufacturingQueue, manufacturer: Manufacturer, timePassedMs: number, starDate: number, parentCargo: CargoList, parentEmpire: Empire | null, completedComponents: ManufacturedComponent[]): void {
    if (manufacturer.component !== null) {
        const num = (timePassedMs / 1000.0) * (manufacturer.manufacturingSpeed / 1000.0);
        manufacturer.progress = Math.fround(manufacturer.progress + Math.fround(num));
        const iterationCount = { count: 0 };
        while (conditionCheckLimit(manufacturer.component !== null && manufacturer.progress >= manufacturer.component.size, 1000, iterationCount)) {
            completedComponents.push(manufacturer.component!);
            // parentCargo.Add(new Cargo(manufacturer.Component, 1, parentEmpire, 1)).
            componentCargoNotModelled();
            const industry = manufacturer.component!.industry;
            manufacturer.progress = Math.fround(manufacturer.progress - Math.fround(manufacturer.component!.size));
            manufacturer.component = null;
            switch (industry) {
                case IndustryType.Weapon:
                    ++queue._slotsAvailableWeapons;
                    break;
                case IndustryType.Energy:
                    ++queue._slotsAvailableEnergy;
                    break;
                case IndustryType.HighTech:
                    ++queue._slotsAvailableHighTech;
                    break;
            }
            processWaitQueue(queue, parentCargo, parentEmpire, starDate);
        }
    } else {
        manufacturer.progress = 0.0;
    }
}

/** ManufacturingQueue.cs 338 NotifyResourceShortages(starDate, date). */
function notifyResourceShortages(queue: ManufacturingQueue, starDate: number, date: number): void {
    if ((date - queue._lastResourceShortageNotification) / 1000 <= 600.0) return;
    const resourcesOlderThanAge = queue.deficientResources.getResourcesOlderThanAge(starDate, Math.trunc(REAL_SECONDS_IN_GALACTIC_YEAR * 1000.0 * 0.6));
    if (resourcesOlderThanAge.length <= 0) return;
    const galaxy = queue._galaxy;
    let recipientEmpire: Empire | null = null;
    let subject: Habitat | BuiltObject | null = null;
    const parentBuiltObject = queue._parentBuiltObject;
    const parentHabitat = queue._parentHabitat;
    if (parentBuiltObject !== null && parentBuiltObject.actualEmpire !== null && parentBuiltObject.actualEmpire !== galaxy.independentEmpire) {
        recipientEmpire = parentBuiltObject.actualEmpire;
        subject = parentBuiltObject;
    } else if (parentHabitat !== null && parentHabitat.empire !== null && parentHabitat.empire !== galaxy.independentEmpire) {
        recipientEmpire = parentHabitat.empire;
        subject = parentHabitat;
    }
    if (recipientEmpire === null || subject === null) return;
    let empty = '';
    for (let index = 0; index < resourcesOlderThanAge.length; ++index) {
        if (index > 0) empty += ', ';
        empty += resourceDefinition(galaxy, resourcesOlderThanAge[index].resourceId).name;
    }
    const description = gameText('Construction Resource Shortage Message', subject.name, empty);
    sendMessageToEmpire(recipientEmpire, recipientEmpire, EmpireMessageType.ConstructionResourceShortage, subject, description);
    queue._lastResourceShortageNotification = date;
}

/** ManufacturingQueue.cs 305 DoManufacturing(galaxy, tempNow, starDate) → completed components. `tempNow` in game ms. */
export function manufacturingQueueDoManufacturing(queue: ManufacturingQueue, galaxy: Galaxy, tempNow: number, starDate: number): ManufacturedComponent[] {
    void galaxy;
    const completedComponents: ManufacturedComponent[] = [];
    const timePassedMs = tempNow - queue._lastProcessed;
    let cargo: CargoList | null;
    let empire: Empire | null;
    if (queue._parentBuiltObject !== null) {
        cargo = queue._parentBuiltObject.cargo;
        empire = queue._parentBuiltObject.empire;
    } else {
        cargo = queue._parentHabitat!.cargo;
        empire = queue._parentHabitat!.empire;
    }
    if (cargo !== null) {
        processWaitQueue(queue, cargo, empire, starDate);
        processManufacturing(queue, timePassedMs, starDate, cargo, empire, completedComponents);
        processWaitQueue(queue, cargo, empire, starDate);
    }
    if ((tempNow - queue._lastProcessedLong) / 1000 > 120.0) {
        notifyResourceShortages(queue, starDate, tempNow);
        queue._lastProcessedLong = tempNow;
    }
    queue._lastProcessed = tempNow;
    return completedComponents;
}

// ---------------------------------------------------------------------------------------------------------------
// Habitat.cs 1477 _ManufacturingQueue.DoManufacturing(_Galaxy, time, _Galaxy.CurrentStarDate)
// ---------------------------------------------------------------------------------------------------------------

/** Habitat.cs 1477: DoManufacturing on the colony's queue. Rnd: Next(0, 3) when the colony has cargo. */
export function doManufacturing(galaxy: Galaxy, habitat: Habitat, time: number, starDate: number): void {
    manufacturingQueueDoManufacturing(habitatManufacturingQueue(habitat)!, galaxy, time, starDate);
}

// ---------------------------------------------------------------------------------------------------------------
// Habitat.cs 1899 ReviewManufacturedResources
// ---------------------------------------------------------------------------------------------------------------

/** ResourcePrevalanceList.GetByPlanetOrMoonType(type) (ResourcePrevalanceList.cs 15) over the resource's distributions. */
function getByPlanetOrMoonType(galaxy: Galaxy, def: Resource, habitat: Habitat): Resource['distributions'] | null {
    if (def.distributions == null) return null;
    // ResourcePrevalence (ResourceSystem.cs 571-587): Type 0 = planet/moon (neither asteroid nor gas cloud); SubType →
    // Galaxy.ResolveHabitatTypeByIndexIncludeGasClouds.
    return def.distributions.filter((d) => d != null && d.type === 0 && galaxy['resolveHabitatTypeByIndexIncludeGasClouds'](d.subType) === habitat.type);
}

/**
 * Habitat.cs 1899 ReviewManufacturedResources: a developed, populous colony may gain a colony-manufactured resource;
 * one whose development falls below 67 % of a resource's level loses it.
 * Rnd: Next(0, candidates) [+ NextDouble per planet/moon prevalence entry until one hits, + Next(min*1000, max*1000)].
 */
export function reviewManufacturedResources(galaxy: Galaxy, habitat: Habitat): void {
    const rs = galaxy.resourceSystem;
    if (rs.colonyManufacturedResources == null || rs.colonyManufacturedResources.length <= 0) return;
    let num = 0;
    if (habitat.owner !== null && habitat.population !== null) {
        const num2 = csInt(Math.trunc(habitat.population.totalAmount / 1000000000));
        num = habitatDevelopmentLevel(habitat) * num2;
        if (habitat.resources.length < 8) {
            const num3 = Math.max(1, Math.trunc(rs.colonyManufacturedResources.length / 2));
            const num4 = countColonyManufacturedResources(galaxy, habitat.resources);
            if (num4 < num3) {
                const resourceDefinitionList: Resource[] = [];
                for (let i = 0; i < rs.colonyManufacturedResources.length; i++) {
                    const def = rs.colonyManufacturedResources[i];
                    if (habitatResourceIndexOf(habitat.resources, def.resourceId, 0) < 0 && num >= def.colonyManufacturingLevel) {
                        const byPlanetOrMoonType = getByPlanetOrMoonType(galaxy, def, habitat);
                        if (byPlanetOrMoonType !== null && byPlanetOrMoonType.length > 0) resourceDefinitionList.push(def);
                    }
                }
                if (resourceDefinitionList.length > 0) {
                    const index = galaxy.rnd.next(0, resourceDefinitionList.length);
                    const def2 = resourceDefinitionList[index];
                    if (def2 != null) {
                        const byPlanetOrMoonType2 = getByPlanetOrMoonType(galaxy, def2, habitat);
                        if (byPlanetOrMoonType2 !== null && byPlanetOrMoonType2.length > 0) {
                            for (let j = 0; j < byPlanetOrMoonType2.length; j++) {
                                const resourcePrevalence = byPlanetOrMoonType2[j];
                                if (resourcePrevalence == null) continue;
                                const num5 = Math.fround(galaxy.rnd.nextDouble());
                                if (!(Math.fround(resourcePrevalence.prevalence) >= num5)) continue;
                                const num6 = habitatResourceIndexOf(habitat.resources, def2.resourceId, 0);
                                if (num6 < 0) {
                                    const abundance = galaxy.rnd.next(Math.trunc(Math.fround(Math.fround(resourcePrevalence.abundanceMin) * 1000)), Math.trunc(Math.fround(Math.fround(resourcePrevalence.abundanceMax) * 1000)));
                                    // Resources.Add(new HabitatResource(id, abundance)): Abundance = (short)abundance.
                                    habitat.resources.push({ resourceId: def2.resourceId, abundance: (abundance << 16) >> 16 });
                                    // Galaxy.DetermineHabitatSystemStar + Owner.SendEventMessageToEmpire(ResourceAppearance, …): UI-only
                                    // (Empire.EventMessageRecipient, Empire.7.cs 3400) — nothing to port.
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    if (habitat.category !== HabitatCategoryType.Planet && habitat.category !== HabitatCategoryType.Moon) return;
    // HabitatResourceList.GetColonyManufacturedResources (216).
    const colonyManufacturedResources = habitat.resources.filter((r) => r !== null && resourceDefinition(galaxy, r.resourceId).colonyManufacturingLevel > 0);
    if (colonyManufacturedResources.length <= 0) return;
    for (let k = 0; k < colonyManufacturedResources.length; k++) {
        const habitatResource = colonyManufacturedResources[k];
        if (habitatResource == null) continue;
        const num7 = csInt(resourceDefinition(galaxy, habitatResource.resourceId).colonyManufacturingLevel * 0.67);
        if (num >= num7) continue;
        // NOTE (C# oddity, see header): after an earlier RemoveAt in this loop the C# IndexOf reads a stale `_Index`.
        const num8 = habitatResourceIndexOf(habitat.resources, habitatResource.resourceId, 0);
        if (num8 >= 0) {
            habitat.resources.splice(num8, 1);
            // Owner.SendEventMessageToEmpire(ResourceDepletion, …): UI-only — nothing to port.
        }
    }
}
