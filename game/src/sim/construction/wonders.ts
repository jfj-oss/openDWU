// M4i — wonders: Empire.3.cs 114 ReviewColonyWonders (+ BuildWonderAtFirstAvailableColony 210, CheckBuildWonder 222),
// Galaxy.5.cs 165 CheckCancelWonderBuilding, 322 CheckWonderBuilt, 334 ReviewWondersBuilt; HabitatList.cs 368
// OrderByPopulationProportion, 399 OrderByRevenue; ResearchSystem.cs 696 SelectRandomNextResearchProjectExcludeSuperWeapons
// (industry overload).
//
// Rnd: CheckCancelWonderBuilding draws in SelectRandomNextResearchProjectExcludeSuperWeapons (Next(0, count)) and then
// NextDouble() for the research substitute of a cancelled research-type wonder.

import { inReadOnlyQuery } from '../readOnlyQuery';
import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import type { Habitat } from '../types';
import type { Facility } from '../data/facilities';
import { PlanetaryFacilityType, WonderType, facilityType, getProjectsByIndustry, type TechNode } from '../researchSystem';
import { IndustryType } from '../types';
import { ComponentCategoryType } from '../data/policies';
import { netSort } from '../netSort';
import { habitatAnnualRevenue } from '../forceStructure';
import { AdvisorMessageType, checkTaskAuthorized, type RefCount } from '../diplomacyTick';
import { gameText } from '../colonyTick';
import { EmpireMessageType, sendMessageToEmpire } from '../messages';
import { galaxyStarDate } from '../tick/simTime';
import { sendNewsBroadcastWonderBegin } from '../events';
import { doResearchBreakthrough } from '../researchTick';
import { pirateEconomyPerformExpense } from '../pirates/pirateAI';
import { PirateExpenseType } from '../pirates/pirateEconomy';
import { selectRandomNextResearchProjectExcludeSuperWeaponsByCategory } from './constructionQueue';
import {
    type PlanetaryFacility,
    calculateAccurateAnnualCashflowIncludingUnderConstruction,
    calculatePlanetaryFacilityCost,
    canBuildWonder,
    checkRemoveFacilityTracking,
    definitionsGetWonders,
    facilitiesFindByType,
    generateAutomationMessageColonyFacility,
    listRemove,
    planetaryFacilityDefinitionsStatic,
    queueFacilityConstruction,
    queueWonderConstruction,
    refreshColonyFacilityInfo,
    reviewPlanetaryFacilities,
    sortedHabitatsDescending,
} from './facilities';

// ---------------------------------------------------------------------------------------------------------------
// Galaxy._WondersBuilt
// ---------------------------------------------------------------------------------------------------------------

/** Galaxy.cs 822 _WondersBuilt = new bool[PlanetaryFacilityDefinitionsStatic.Count] (created on first use). */
function wondersBuilt(galaxy: Galaxy): boolean[] {
    // A screen's read-only query (readOnlyQuery.ts): an unbuilt list, detached.
    if (galaxy.wondersBuilt === null && inReadOnlyQuery(galaxy)) return new Array<boolean>(planetaryFacilityDefinitionsStatic(galaxy).length).fill(false);
    if (galaxy.wondersBuilt === null) galaxy.wondersBuilt = new Array<boolean>(planetaryFacilityDefinitionsStatic(galaxy).length).fill(false);
    return galaxy.wondersBuilt;
}

/** Galaxy.5.cs 322 CheckWonderBuilt(wonder). */
export function checkWonderBuilt(galaxy: Galaxy, wonder: { facilityId: number } | null): boolean {
    if (wonder !== null) {
        return wondersBuilt(galaxy)[wonder.facilityId];
    }
    return false;
}

/** CheckWonderBuilt for a definition (the facilities.ts callers). */
export function checkWonderBuiltDef(galaxy: Galaxy, wonder: Facility | null): boolean {
    return checkWonderBuilt(galaxy, wonder);
}

/** Galaxy.5.cs 334 ReviewWondersBuilt. */
export function reviewWondersBuilt(galaxy: Galaxy): void {
    const built = new Array<boolean>(planetaryFacilityDefinitionsStatic(galaxy).length).fill(false);
    galaxy.wondersBuilt = built;
    for (let i = 0; i < galaxy.empires.length; i++) {
        const empire = galaxy.empires[i];
        if (empire === null || !empire.active) continue;
        for (let j = 0; j < empire.colonies.length; j++) {
            const habitat = empire.colonies[j];
            if (habitat === null || habitat.hasBeenDestroyed) continue;
            // C# reads habitat.Facilities.Count unguarded (TakeOwnershipOfColony creates the list, Empire.1.cs 104).
            const facilities = habitat.facilities!;
            for (let k = 0; k < facilities.length; k++) {
                const planetaryFacility = facilities[k];
                if (planetaryFacility !== null && planetaryFacility.constructionProgress >= 1 && planetaryFacility.type === PlanetaryFacilityType.Wonder) {
                    built[planetaryFacility.planetaryFacilityDefinitionId] = true;
                }
            }
        }
    }
    for (let l = 0; l < galaxy.pirateEmpires.length; l++) {
        const empire2 = galaxy.pirateEmpires[l];
        if (empire2 === null || !empire2.active) continue;
        for (let m = 0; m < empire2.colonies.length; m++) {
            const habitat2 = empire2.colonies[m];
            if (habitat2 === null || habitat2.hasBeenDestroyed || habitat2.owner !== empire2) continue;
            const facilities = habitat2.facilities!;
            for (let n = 0; n < facilities.length; n++) {
                const planetaryFacility2 = facilities[n];
                if (planetaryFacility2 !== null && planetaryFacility2.constructionProgress >= 1 && planetaryFacility2.type === PlanetaryFacilityType.Wonder) {
                    built[planetaryFacility2.planetaryFacilityDefinitionId] = true;
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// CheckCancelWonderBuilding
// ---------------------------------------------------------------------------------------------------------------

/** ResearchSystem.cs 696 SelectRandomNextResearchProjectExcludeSuperWeapons(galaxy, industry). Rnd: Next(0, count). */
function selectRandomNextResearchProjectExcludeSuperWeaponsByIndustry(galaxy: Galaxy, empire: Empire, industry: IndustryType): TechNode | null {
    let researchNode: TechNode | null = null;
    // C# reads NextProjects unguarded; StripProjectsById({272, 273, 274}).
    const projectsByIndustry = getProjectsByIndustry(empire.research.nextProjects!, industry).filter((n) => !(n != null && [272, 273, 274].includes(n.def.projectId)));
    if (projectsByIndustry.length > 0) {
        const index = galaxy.rnd.next(0, projectsByIndustry.length);
        researchNode = projectsByIndustry[index];
    }
    return researchNode;
}

/** Research substitute (Galaxy.5.cs 199-209 / 250-298): progress += (float)(base + NextDouble() * spread). */
function substituteResearch(galaxy: Galaxy, empire: Empire, researchNode: TechNode | null, base: number, spread: number): string {
    let text = '';
    if (researchNode !== null) {
        text = gameText('Wonder Cancel Substitute Research', researchNode.def.name);
        const num = Math.fround(base + galaxy.rnd.nextDouble() * spread);
        researchNode.progress = Math.fround(researchNode.progress + num);
        if (researchNode.progress >= researchNode.cost) {
            doResearchBreakthrough(galaxy, empire, researchNode, true);
        }
    }
    return text;
}

/** Galaxy.5.cs 165 CheckCancelWonderBuilding(completedWonder). */
export function checkCancelWonderBuilding(galaxy: Galaxy, completedWonder: PlanetaryFacility): void {
    for (let i = 0; i < galaxy.empires.length; i++) {
        const empire = galaxy.empires[i];
        if (empire === null || !empire.active) continue;
        for (let j = 0; j < empire.colonies.length; j++) {
            const habitat = empire.colonies[j];
            if (habitat === null || habitat.hasBeenDestroyed) continue;
            const planetaryFacilityList: PlanetaryFacility[] = [];
            const facilities = habitat.facilities!;
            for (let k = 0; k < facilities.length; k++) {
                const planetaryFacility = facilities[k];
                if (planetaryFacility === null || !(planetaryFacility.constructionProgress < 1) || planetaryFacility.type !== PlanetaryFacilityType.Wonder || planetaryFacility.planetaryFacilityDefinitionId !== completedWonder.planetaryFacilityDefinitionId) {
                    continue;
                }
                let researchNode: TechNode | null = null;
                let num = 0.0;
                let text = '';
                switch (planetaryFacility.wonderType) {
                    case WonderType.ColonyConstructionSpeed: {
                        text = gameText('Wonder Cancel Substitute Research');
                        researchNode = selectRandomNextResearchProjectExcludeSuperWeaponsByCategory(galaxy, empire, ComponentCategoryType.Construction);
                        const t = substituteResearch(galaxy, empire, researchNode, 60000.0, 20000.0);
                        if (researchNode !== null) text = t;
                        break;
                    }
                    case WonderType.ColonyDefense: {
                        const planetaryFacility2 = facilitiesFindByType(habitat.facilities!, PlanetaryFacilityType.FortifiedBunker);
                        if (planetaryFacility2 === null) {
                            queueFacilityConstruction(galaxy, habitat, PlanetaryFacilityType.FortifiedBunker);
                            const planetaryFacility3 = facilitiesFindByType(habitat.facilities!, PlanetaryFacilityType.FortifiedBunker);
                            if (planetaryFacility3 !== null) {
                                planetaryFacility3.constructionProgress = 1;
                                reviewPlanetaryFacilities(galaxy, habitat, habitat.empire);
                                refreshColonyFacilityInfo(galaxy, habitat.empire!);
                                text = gameText('Wonder Cancel Substitute Facility', planetaryFacility3.name);
                            }
                        } else {
                            num = 25000.0;
                            empire.stateMoney += num;
                            text = gameText('Wonder Cancel Substitute Money', num);
                        }
                        break;
                    }
                    case WonderType.ColonyHappiness:
                    case WonderType.ColonyIncome:
                    case WonderType.ColonyPopulationGrowth:
                        num = 25000.0;
                        empire.stateMoney += num;
                        text = gameText('Wonder Cancel Substitute Money', num);
                        break;
                    case WonderType.EmpireHappiness:
                    case WonderType.EmpireIncome:
                    case WonderType.EmpirePopulationGrowth:
                        num = 50000.0;
                        empire.stateMoney += num;
                        text = gameText('Wonder Cancel Substitute Money', num);
                        break;
                    case WonderType.EmpireResearchEnergy:
                        researchNode = selectRandomNextResearchProjectExcludeSuperWeaponsByIndustry(galaxy, empire, IndustryType.Energy);
                        text = substituteResearch(galaxy, empire, researchNode, 100000.0, 40000.0);
                        break;
                    case WonderType.EmpireResearchHighTech:
                        researchNode = selectRandomNextResearchProjectExcludeSuperWeaponsByIndustry(galaxy, empire, IndustryType.HighTech);
                        text = substituteResearch(galaxy, empire, researchNode, 100000.0, 40000.0);
                        break;
                    case WonderType.EmpireResearchWeapons:
                        researchNode = selectRandomNextResearchProjectExcludeSuperWeaponsByIndustry(galaxy, empire, IndustryType.Weapon);
                        text = substituteResearch(galaxy, empire, researchNode, 100000.0, 40000.0);
                        break;
                }
                const byId = planetaryFacility.def;
                let text2 = gameText('Construction of the WONDER at COLONY has been cancelled', planetaryFacility.name, habitat.name);
                if (text !== '') text2 = text2 + '. ' + text;
                sendMessageToEmpire(empire, empire, EmpireMessageType.ColonyFacilityCancelled, byId, text2, { x: Math.trunc(habitat.xpos), y: Math.trunc(habitat.ypos) }, '');
                planetaryFacilityList.push(planetaryFacility);
            }
            for (let l = 0; l < planetaryFacilityList.length; l++) {
                listRemove(habitat.facilities!, planetaryFacilityList[l]);
                checkRemoveFacilityTracking(habitat, planetaryFacilityList[l]);
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// ReviewColonyWonders
// ---------------------------------------------------------------------------------------------------------------

/** Array.Sort(double[] keys, Habitat[] items) + Array.Reverse (the paired .NET introsort swaps keys and items together). */
function sortByKeysDescending(keys: number[], items: Habitat[]): Habitat[] {
    const pairs = keys.map((k, i) => ({ k, h: items[i] }));
    netSort(pairs, (a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
    pairs.reverse();
    return pairs.map((p) => p.h);
}

/** HabitatList.cs 399 OrderByRevenue. */
export function orderByRevenue(galaxy: Galaxy, colonies: readonly Habitat[]): Habitat[] {
    const doubleList: number[] = [];
    for (let index = 0; index < colonies.length; ++index) doubleList.push(habitatAnnualRevenue(galaxy, colonies[index]));
    return sortByKeysDescending(doubleList, colonies.slice());
}

/** HabitatList.cs 368 OrderByPopulationProportion(populationProportionThresholdRatio, minimumPopulation). */
export function orderByPopulationProportion(colonies: readonly Habitat[], populationProportionThresholdRatio: number, minimumPopulation: number): Habitat[] {
    const habitatList2: Habitat[] = [];
    const doubleList: number[] = [];
    for (let index = 0; index < colonies.length; ++index) {
        const habitat = colonies[index];
        if (habitat.population !== null) {
            const totalAmount = habitat.population.totalAmount;
            if (totalAmount >= minimumPopulation) {
                const num = totalAmount / habitat.maxPopulation;
                if (num <= populationProportionThresholdRatio) {
                    doubleList.push(num);
                    habitatList2.push(habitat);
                }
            }
        }
    }
    return sortByKeysDescending(doubleList, habitatList2);
}

/** Empire.3.cs 222 CheckBuildWonder(wonder, colony, ref refusalCount). */
function checkBuildWonder(galaxy: Galaxy, empire: Empire, wonder: Facility | null, colony: Habitat | null, refusalCount: RefCount): Habitat | null {
    if (wonder !== null && colony !== null && !colony.hasBeenDestroyed && colony.facilities !== null) {
        const num = calculatePlanetaryFacilityCost(wonder, empire);
        if (empire.stateMoney >= num) {
            let flag = false;
            if (colony.facilities.length > 0) {
                const planetaryFacility = colony.facilities[colony.facilities.length - 1];
                if (planetaryFacility !== null && planetaryFacility.type === PlanetaryFacilityType.Wonder && planetaryFacility.constructionProgress < 1) {
                    flag = true;
                }
            }
            if (!flag && canBuildWonder(galaxy, colony, wonder)) {
                const num2 = calculateAccurateAnnualCashflowIncludingUnderConstruction(galaxy, empire).cashflow;
                if (
                    num2 > wonder.maintenanceCost &&
                    checkTaskAuthorized(galaxy, empire, empire.controlColonyFacilities, refusalCount, generateAutomationMessageColonyFacility(galaxy, colony, wonder), colony, AdvisorMessageType.ColonyFacility, null, wonder, null) &&
                    queueWonderConstruction(galaxy, colony, wonder)
                ) {
                    empire.stateMoney -= num;
                    pirateEconomyPerformExpense(galaxy, empire, num, PirateExpenseType.FacilityConstruction, galaxyStarDate(galaxy));
                    return colony;
                }
            }
        }
    }
    return null;
}

/** Empire.3.cs 210 BuildWonderAtFirstAvailableColony(wonder, orderedColonies, ref refusalCount). */
function buildWonderAtFirstAvailableColony(galaxy: Galaxy, empire: Empire, wonder: Facility, orderedColonies: readonly Habitat[], refusalCount: RefCount): Habitat | null {
    for (let i = 0; i < orderedColonies.length; i++) {
        const habitat = checkBuildWonder(galaxy, empire, wonder, orderedColonies[i], refusalCount);
        if (habitat !== null) return habitat;
    }
    return null;
}

/** Empire.3.cs 114 ReviewColonyWonders. */
export function reviewColonyWonders(galaxy: Galaxy, empire: Empire): void {
    if (empire.dominantRace === null || !empire.dominantRace.expanding) return;
    const wonders = definitionsGetWonders(empire.research.buildablePlanetaryFacilities.slice());
    const planetaryFacilityDefinitionList2: Facility[] = [];
    for (let i = 0; i < wonders.length; i++) {
        if (checkWonderBuilt(galaxy, wonders[i])) {
            planetaryFacilityDefinitionList2.push(wonders[i]);
            continue;
        }
        for (let j = 0; j < empire.colonies.length; j++) {
            const habitat = empire.colonies[j];
            if (habitat === null || habitat.facilities === null || habitat.hasBeenDestroyed) continue;
            for (let k = 0; k < habitat.facilities.length; k++) {
                const planetaryFacility = habitat.facilities[k];
                if (planetaryFacility !== null && planetaryFacility.planetaryFacilityDefinitionId === wonders[i].facilityId) {
                    planetaryFacilityDefinitionList2.push(wonders[i]);
                }
            }
        }
    }
    for (let l = 0; l < planetaryFacilityDefinitionList2.length; l++) listRemove(wonders, planetaryFacilityDefinitionList2[l]);
    const refusalCount: RefCount = { value: 0 };
    const num = calculateAccurateAnnualCashflowIncludingUnderConstruction(galaxy, empire).cashflow;
    const habitatList = sortedHabitatsDescending(empire.colonies);
    const policy = empire.policy!;
    for (let m = 0; m < wonders.length; m++) {
        const planetaryFacilityDefinition = wonders[m];
        if (planetaryFacilityDefinition === null || facilityType(planetaryFacilityDefinition) !== PlanetaryFacilityType.Wonder) continue;
        let num2 = empire.stateMoney / 1.5;
        if (policy.prioritizeBuildWonderId >= 0 && planetaryFacilityDefinition.facilityId === policy.prioritizeBuildWonderId) {
            num2 = empire.stateMoney;
        }
        const num3 = calculatePlanetaryFacilityCost(planetaryFacilityDefinition, empire);
        if (num3 < num2 && num > planetaryFacilityDefinition.maintenanceCost) {
            let habitat2: Habitat | null = null;
            switch (planetaryFacilityDefinition.wonderType as WonderType) {
                case WonderType.ColonyIncome: {
                    const orderedColonies2 = orderByRevenue(galaxy, empire.colonies);
                    habitat2 = buildWonderAtFirstAvailableColony(galaxy, empire, planetaryFacilityDefinition, orderedColonies2, refusalCount);
                    break;
                }
                case WonderType.ColonyPopulationGrowth: {
                    const orderedColonies = orderByPopulationProportion(empire.colonies, 0.5, 1000000000);
                    habitat2 = buildWonderAtFirstAvailableColony(galaxy, empire, planetaryFacilityDefinition, orderedColonies, refusalCount);
                    break;
                }
                case WonderType.EmpirePopulationGrowth:
                case WonderType.EmpireHappiness:
                case WonderType.EmpireResearchWeapons:
                case WonderType.EmpireResearchEnergy:
                case WonderType.EmpireResearchHighTech:
                case WonderType.EmpireIncome:
                case WonderType.ColonyHappiness:
                case WonderType.ColonyDefense:
                case WonderType.ColonyConstructionSpeed:
                case WonderType.RaceAchievement:
                    habitat2 = buildWonderAtFirstAvailableColony(galaxy, empire, planetaryFacilityDefinition, habitatList, refusalCount);
                    break;
            }
            if (habitat2 !== null) {
                sendNewsBroadcastWonderBegin(empire, planetaryFacilityDefinition, habitat2); // Empire.3.cs 203
            }
        }
    }
}
