// M4k — research progress (tasks/M4-plan.md §3.3 row M4k).
//
// Ports of
//   Empire.3.cs 1756 PerformResearch → 1890 PerformResearchProjects (queue progress, completion, research events),
//     1391 SelectNextResearchProject (next-project AI), 3214 DeterminePreferredEmpireResearchFocuses,
//     Empire.10.cs 3221 DetermineTechForUnbuildableOptimizedDesigns,
//     ResearchSystem.cs 290 ResolveEssentialProjects_NEW (+ IdentifyLaggingProject*, SelectBestProject(type),
//     CalculateOrderedValueByType), 877 RemoveNonRaceSpecificProjectTypes, 818-876 tech category helpers,
//     ResearchNodeDefinitionList.cs 1271 ResolveRaceSpecificComponents;
//   Empire.3.cs 2495-2655 DoResearchBreakthrough, 2069 DoResearchAbilityBreakthrough,
//     2043 ReviewDesignsBuiltObjectsImprovedComponents;
//   Empire.3.cs 2732 ReviewResearchStationBonuses, 2818 CalculateResearchOutputBonuses, 2886 GetResearchResourceBonus,
//     2915 CalculateResearchTotal, 2657 CalculatePirateResearchBonusFromFacilities; Empire.cs 1817-1920
//     AnnualResearchPotential / Research*Potential;
//   Empire.3.cs 3093 DoCrashResearch, 3023 SelectResearchNodeToCrash, 3005 ResolveEmpireRaceTendency,
//     3204 InitiateCrashResearchProgram; Galaxy.6.cs 848 CalculateCrashResearchProgramCost;
//   Galaxy.2.cs 4852-4980 ChanceScientistPromotion / ChanceNewScientist / ChanceNewScientistCriticalSuccess;
//   Empire.7.cs 2986-3398 SendNewsBroadcast (the ResearchBreakthrough case, run synchronously);
//   CharacterList.cs 369-520 (GetFirstCharacterWithSkill/Trait, GetScientistsAtResearchStations,
//     TotalDiminishingResearchBonuses*).
// The ResearchNode / ResearchNodeList model and ResearchSystem.Update live in researchSystem.ts.
//
// Bacon overrides: BaconResearchSystem.DetermineComponentImprovements (called at the end of PerformResearch) has an
// empty body. BaconEmpire.ProcessScienceShips (lab progress on exploration ships) runs from the scripted game event
// "ProcessEmpireScienceShips" (BaconGalaxy.ExecuteEventAction 324), not from the empire tick — deferred with game
// events (ProcessDelayedEventActions).
//
// Galaxy.Rnd draws, in C# order:
//   PerformResearchProjects: SelectNextResearchProject → SelectRandomLowestProject Next(0, n) (when a queue is
//     empty); per completion ChanceNewScientist Next(0, num); research events Next(0, num4), then Next(0, 3),
//     then NextDouble (critical failure) or ChanceNewScientistCriticalSuccess Next(0, num).
//   DoCrashResearch: Next(0, 2), SelectResearchNodeToCrash Next(0, count) ×≤2 per call, tendency 0: Next(0, count),
//     Next(0, 2).
//   Callees not drawn until their packages land: DoCharacterEvent (M4u) for CriticalResearch*/ResearchAdvance*
//     with a non-empty character list; GenerateNewCharacter draws itself (ported, characters.ts).

import { checkTriggerEvent, getMatchingGameEventIdResearchBreakthrough } from './story/eventActions';
import { EventTriggerType } from './story/gameEventModel';
import type { Galaxy } from './galaxy';
import { checkGenerateAncientHelpers } from './story/storyEvents';
import { empireGovernmentAttributes, type Empire } from './empire';
import type { BuiltObject } from './builtObject';
import { RaceVictoryConditionType, type Race } from './data/races';
import type { Facility } from './data/facilities';
import { ComponentType } from './data/components';
import { ComponentCategoryType } from './data/policies';
import { HabitatType, IndustryType } from './types';
import { BuiltObjectRole } from './data/designSpecifications';
import { BuiltObjectSubRole } from './builtObjectTypes';
import { TroopType } from './cargo';
import { resolveComponentCategory, componentImprovementFromComponent, type ComponentDefinition, type ComponentImprovementEntry } from './componentStatic';
import {
    ResearchAbilityType,
    ShipDesignFocus,
    abilityRelatedSubRole,
    abilityRelatedTroopType,
    abilityTypeFromFile,
    checkContainsAnyNodeId,
    containsById,
    findNodeById,
    findNodesByIdsUnresearched,
    getCurrentPath,
    getHighestProjectForCategory,
    getHighestProjectForComponent,
    getHighestProjectForTypeAny,
    getHighestResearchedProjectForIndustry,
    getLowestProjectForDedicatedCarriers,
    getLowestProjectForPlanetaryFacilityType,
    getLowestProjectForTroopType,
    getLowestProjectForTypeAnyIn,
    getLowestProjectForWonderType,
    getLowestTechLevel,
    getLowestUnresearchedProjectForRaceForCategory,
    getLowestUnresearchedProjectForRaceForTypeAny,
    getLowestUnresearchedProjectForTypeAny,
    getProjectByFacility,
    getProjectsAtTechLevel,
    getProjectsByAbility,
    getProjectsByCategory,
    getProjectsByIndustry,
    getProjectsByType,
    getSecondLowestProjectForTypeAny,
    getTechLevelRange,
    indexBySpecialFunctionCode,
    intersectNodes,
    listRemove,
    mergeNodes,
    nodeCategory,
    nodeIndustry,
    notIntersectNodes,
    PlanetaryFacilityType,
    removeProjectsWithTechLevelHigherThan,
    resolveResearchAbilityType,
    selectRandomLowestProject,
    stripProjectsAboveTechLevel,
    stripProjectsByAbility,
    stripProjectsByType,
    WonderType,
    facilityType,
    type ResearchSystem,
    type TechNode,
} from './researchSystem';
import { EmpireMessage, EmpireMessageType, resolveDescription, sendEmpireMessage, sendMessageToEmpire, sendMessageToEmpireWithTitle } from './messages';
import {
    CharacterEventType,
    CharacterRole,
    CharacterSkillType,
    CharacterTraitType,
    checkCharactersForTrait,
    doCharacterEventForList,
    empireLeader,
    generateNewCharacter,
    getCharactersByRole,
    getEmpireCharacters,
    getNonTransferringCharacters,
    stellarObjectCharacters,
    type Character,
} from './characters';
import { charactersCanGenerateAmountNonIntelligenceAgent } from './troops';
import { ColonyResourceEffect, resourceBonusTotalByEffectType } from './developmentLevel';
import { reviewDesignComponentsAvailable, canBuildDesign } from './designGeneration';
import { obtainPirateRelation } from './pirateRelations';
import { checkWonderBuilt } from './construction/wonders';
import { checkSendPreWarpProgressEventMessage } from './events';
import { PreWarpProgressEventType } from './exploration';
import { disbandShipGroup, empireShipGroups, shipGroupWarpSpeed, type ShipGroup } from './fleets/shipGroup';
import { REAL_SECONDS_IN_GALACTIC_YEAR } from './tick/simTime';
import { netSort } from './netSort';
import { gameText } from './colonyTick';
import { registerTodo, todo } from './tick/todo';
import { galaxyStarDate } from './tick/simTime';
import { PirateExpenseType } from './pirates/pirateEconomy';

// ---------------------------------------------------------------------------
// Small C# semantics helpers
// ---------------------------------------------------------------------------

/** C# (int) of a double (x64 .NET: out-of-range and NaN give int.MinValue). */
function csDoubleToInt(v: number): number {
    if (!Number.isFinite(v) || v >= 2147483648 || v <= -2147483649) return -2147483648;
    return Math.trunc(v);
}

// Galaxy.7.cs ConditionCheckLimit(condition, maximumIterations, ref iterationCount) (569).
function conditionCheckLimit(condition: boolean, maximumIterations: number, iterationCount: { value: number }): boolean {
    if (iterationCount.value >= maximumIterations) return false;
    iterationCount.value++;
    return condition;
}


/** Component.TypesIntersect (Component.cs 108). */
function typesIntersect(types1: readonly ComponentType[], types2: readonly ComponentType[]): boolean {
    for (let i = 0; i < types1.length; i++) if (types2.includes(types1[i])) return true;
    return false;
}

/** Component.CategoriesIntersect (Component.cs 118). */
function categoriesIntersect(categories1: readonly ComponentCategoryType[], categories2: readonly ComponentCategoryType[]): boolean {
    for (let i = 0; i < categories1.length; i++) if (categories2.includes(categories1[i])) return true;
    return false;
}

/**
 * Empire fields owned by other packages that the research formulas read. They are declared by their owners
 * (M4j: Empire.cs 396 _ResearchBonus via ReviewEmpireAbilityBonuses, _SpecialBonusResearch* via
 * ReviewSpecialBonusesRuinsWonders; M4u: _RaceEventType). Until those land the C# value is the field default (0 /
 * RaceEventType.Undefined), which is what `?? 0` reads.
 */
interface ResearchBonusFieldsOwnedElsewhere {
    researchBonus?: number;
    specialBonusResearchWeapons?: number;
    specialBonusResearchEnergy?: number;
    specialBonusResearchHighTech?: number;
    /** RaceEventType as its numeric value. */
    raceEventType?: number;
}
/** RaceEventType.cs HistoricalDiscoveryExploreRuinsForResearchBoost (the 30th member, value 29). */
const RACE_EVENT_HISTORICAL_DISCOVERY_EXPLORE_RUINS_FOR_RESEARCH_BOOST = 29;

// ---------------------------------------------------------------------------
// CharacterList helpers (CharacterList.cs)
// ---------------------------------------------------------------------------

// CharacterList.GetFirstCharacterWithSkill (369).
function getFirstCharacterWithSkill(list: readonly Character[], skillType: CharacterSkillType): Character | null {
    for (const c of list) if (c !== null && c.skills.getSkillByType(skillType) !== null) return c;
    return null;
}

// CharacterList.GetFirstCharacterWithTrait (380).
function getFirstCharacterWithTrait(list: readonly Character[], trait: CharacterTraitType): Character | null {
    for (const c of list) if (c !== null && c.traits.includes(trait)) return c;
    return null;
}

function isBuiltObject(o: unknown): o is BuiltObject {
    return o !== null && typeof o === 'object' && (o as BuiltObject).builtObjectID !== undefined && (o as BuiltObject).design !== undefined;
}

// CharacterList.GetScientistsAtResearchStations(industry) (405).
function getScientistsAtResearchStations(list: readonly Character[], industry: IndustryType): Character[] {
    const out: Character[] = [];
    for (const character of list) {
        if (character !== null && character.role === CharacterRole.Scientist && character.location !== null && isBuiltObject(character.location)) {
            const location = character.location;
            if (industry === IndustryType.Undefined) {
                if (location.researchWeapons > 0 || location.researchEnergy > 0 || location.researchHighTech > 0) out.push(character);
            } else {
                if (industry === IndustryType.Weapon && location.researchWeapons > 0) out.push(character);
                if (industry === IndustryType.Energy && location.researchEnergy > 0) out.push(character);
                if (industry === IndustryType.HighTech && location.researchHighTech > 0) out.push(character);
            }
        }
    }
    return out;
}

// CharacterList.TotalDiminishingResearchBonusesWeapons/Energy/HighTech (460-520): Array.Sort(int keys, Character[])
// (keyed introsort = netSort over (key, item) pairs), Reverse, then sum value / (index + 1), / 100.
function totalDiminishingResearchBonuses(list: readonly Character[], skill: (c: Character) => number): number {
    let num = 0.0;
    if (list.length > 0) {
        const pairs = list.map((c) => ({ k: skill(c), c }));
        netSort(pairs, (a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
        pairs.reverse();
        for (let i = 0; i < pairs.length; i++) num += skill(pairs[i].c) / (i + 1);
        num /= 100.0;
    }
    return num;
}

// ---------------------------------------------------------------------------
// Research totals and bonuses
// ---------------------------------------------------------------------------

/** Empire.ResearchRate (Galaxy.SetEmpireDifficultyFactors; C# default 1.0). */
function researchRate(empire: Empire): number {
    return empire.difficultyFactors?.researchRate ?? 1.0;
}

/** Empire.ResearchWeaponsFactor / ResearchEnergyFactor / ResearchHighTechFactor (Empire.cs 443-449: 1.0, pirate play-style modifiers). */
function researchFactor(empire: Empire, industry: IndustryType): number {
    const mods = empire.pirateFactionModifiers;
    if (mods === null) return 1.0;
    switch (industry) {
        case IndustryType.Weapon: return mods.researchWeaponsFactor;
        case IndustryType.Energy: return mods.researchEnergyFactor;
        default: return mods.researchHighTechFactor;
    }
}

// Empire.3.cs CalculatePirateResearchBonusFromFacilities (2657). PirateColonyControl lookup ported by M4s2.
export function calculatePirateResearchBonusFromFacilities(empire: Empire): number {
    let num = 1.0;
    for (let i = 0; i < empire.colonies.length; i++) {
        const habitat = empire.colonies[i];
        if (habitat === null || habitat.hasBeenDestroyed) continue;
        const byFacilityControl = habitat.pirateColonyControl.getByFacilityControl();
        if (byFacilityControl === null || byFacilityControl.empireId !== empire.empireId || habitat.facilities === null) continue;
        for (let j = 0; j < habitat.facilities.length; j++) {
            const planetaryFacility = habitat.facilities[j];
            if (planetaryFacility != null && planetaryFacility.constructionProgress >= 1) {
                switch (planetaryFacility.type) {
                    case PlanetaryFacilityType.PirateBase:
                    case PlanetaryFacilityType.PirateFortress:
                    case PlanetaryFacilityType.PirateCriminalNetwork:
                        num += planetaryFacility.value1 / 100.0;
                        break;
                }
            }
        }
    }
    return num;
}

// Empire.cs AnnualResearchPotential (1817).
export function annualResearchPotential(empire: Empire): number {
    if (empire.pirateEmpireBaseHabitat !== null) {
        let num = 0.0;
        if (empire.builtObjects.length > 0) num = Math.sqrt(empire.builtObjects.length) * 10000.0;
        const researchFacilities = empire.researchFacilities as (BuiltObject | null)[];
        if (researchFacilities !== null && researchFacilities.length > 0) {
            let num2 = 0.0;
            for (let i = 0; i < researchFacilities.length; i++) {
                const builtObject = researchFacilities[i];
                if (
                    builtObject !== null &&
                    !builtObject.hasBeenDestroyed &&
                    (builtObject.subRole === BuiltObjectSubRole.WeaponsResearchStation || builtObject.subRole === BuiltObjectSubRole.EnergyResearchStation || builtObject.subRole === BuiltObjectSubRole.HighTechResearchStation)
                ) {
                    num2 += 0.5 * (builtObject.researchEnergy + builtObject.researchHighTech + builtObject.researchWeapons);
                }
            }
            num += num2;
        }
        const num3 = calculatePirateResearchBonusFromFacilities(empire);
        num *= num3;
        num *= empire.economyEfficiency;
        if (checkCharactersForTrait(getEmpireCharacters(empire), CharacterRole.Scientist, CharacterTraitType.UltraGenius)) num *= 1.2;
        return num * researchRate(empire);
    }
    let num4 = Math.sqrt(Math.sqrt(empire.totalPopulation / 1000.0)) * 10000.0;
    num4 *= empire.economyEfficiency;
    if (checkCharactersForTrait(getEmpireCharacters(empire), CharacterRole.Scientist, CharacterTraitType.UltraGenius)) num4 *= 1.2;
    return num4 * researchRate(empire);
}

// Empire.cs ResearchEnergyPotential / ResearchHighTechPotential / ResearchWeaponsPotential (1860 / 1881 / 1902).
export function researchPotential(empire: Empire, industry: IndustryType): number {
    let num = 0.0;
    const builtObjectList: BuiltObject[] = [];
    builtObjectList.push(...empire.builtObjects);
    builtObjectList.push(...empire.privateBuiltObjects);
    for (const item of builtObjectList) {
        if (item !== null && item.isResearchLab) {
            switch (industry) {
                case IndustryType.Energy: num += item.researchEnergy; break;
                case IndustryType.HighTech: num += item.researchHighTech; break;
                default: num += item.researchWeapons; break;
            }
        }
    }
    const val = Math.max(12000.0, Math.trunc(empire.totalPopulation / 1000000) * 3.0);
    num = Math.max(val, num);
    return num * researchFactor(empire, industry);
}

// Empire.3.cs CalculateResearchTotal (2915).
export function calculateResearchTotal(empire: Empire): { researchEnergy: number; researchHighTech: number; researchWeapons: number } {
    let researchEnergy = researchPotential(empire, IndustryType.Energy);
    let researchWeapons = researchPotential(empire, IndustryType.Weapon);
    let researchHighTech = researchPotential(empire, IndustryType.HighTech);
    const num = 1.0 + researchEnergy + researchHighTech + researchWeapons;
    const annual = annualResearchPotential(empire);
    const num2 = annual / num;
    if (num2 < 1.0) {
        researchEnergy *= num2;
        researchWeapons *= num2;
        researchHighTech *= num2;
    }
    return { researchEnergy, researchHighTech, researchWeapons };
}

// Empire.3.cs GetResearchResourceBonus (2886).
export function getResearchResourceBonus(empire: Empire, industry: IndustryType): number {
    let num = 0.0;
    if (empire.colonies !== null) {
        for (let i = 0; i < empire.colonies.length; i++) {
            const habitat = empire.colonies[i];
            switch (industry) {
                case IndustryType.Energy:
                    num += resourceBonusTotalByEffectType(habitat, ColonyResourceEffect.ResearchEnergy) / 100.0;
                    break;
                case IndustryType.HighTech:
                    num += resourceBonusTotalByEffectType(habitat, ColonyResourceEffect.ResearchHighTech) / 100.0;
                    break;
                case IndustryType.Weapon:
                    num += resourceBonusTotalByEffectType(habitat, ColonyResourceEffect.ResearchWeapons) / 100.0;
                    break;
            }
        }
        num = Math.min(1.0, num);
    }
    return num;
}

// Empire.3.cs CalculateResearchOutputBonuses (2818).
export function calculateResearchOutputBonuses(empire: Empire, industry: IndustryType): number {
    const other = empire as Empire & ResearchBonusFieldsOwnedElsewhere;
    let num = 1.0;
    const researchBonus = other.researchBonus ?? 0.0;
    if (researchBonus > 0.0) num *= 1.0 + researchBonus;
    const governmentAttributes = empireGovernmentAttributes(empire);
    if (governmentAttributes !== null) num *= governmentAttributes.researchSpeed;
    switch (industry) {
        case IndustryType.Weapon: {
            const s = other.specialBonusResearchWeapons ?? 0.0;
            if (s > 0.0) num *= 1.0 + s;
            if (empire.researchBonusWeapons > 0) num *= Math.fround(1 + empire.researchBonusWeapons);
            break;
        }
        case IndustryType.Energy: {
            const s = other.specialBonusResearchEnergy ?? 0.0;
            if (s > 0.0) num *= 1.0 + s;
            if (empire.researchBonusEnergy > 0) num *= Math.fround(1 + empire.researchBonusEnergy);
            break;
        }
        case IndustryType.HighTech: {
            const s = other.specialBonusResearchHighTech ?? 0.0;
            if (s > 0.0) num *= 1.0 + s;
            if (empire.researchBonusHighTech > 0) num *= Math.fround(1 + empire.researchBonusHighTech);
            break;
        }
    }
    const researchResourceBonus = getResearchResourceBonus(empire, industry);
    num *= 1.0 + researchResourceBonus;
    if ((other.raceEventType ?? 0) === RACE_EVENT_HISTORICAL_DISCOVERY_EXPLORE_RUINS_FOR_RESEARCH_BOOST) num *= 1.1;
    const leader = empireLeader(empire);
    if (leader !== null) {
        switch (industry) {
            case IndustryType.Weapon:
                num *= 1.0 + leader.researchWeapons / 100.0;
                break;
            case IndustryType.Energy:
                num *= 1.0 + leader.researchEnergy / 100.0;
                break;
            case IndustryType.HighTech:
                num *= 1.0 + leader.researchHighTech / 100.0;
                break;
        }
    }
    return num;
}

/** Research-bonus fraction of a station's ParentHabitat / NearestSystemStar for `industry` (ReviewResearchStationBonuses 2757-2764 etc.). */
function stationLocationResearchBonus(b: BuiltObject, industry: IndustryType): number {
    if (b.parentHabitat !== null && b.parentHabitat.researchBonusIndustry === industry && b.parentHabitat.researchBonus > 0) {
        return Math.fround(Math.trunc(b.parentHabitat.researchBonus) / 100);
    }
    if (b.nearestSystemStar !== null && b.nearestSystemStar.researchBonusIndustry === industry && b.nearestSystemStar.researchBonus > 0) {
        return Math.fround(Math.trunc(b.nearestSystemStar.researchBonus) / 100);
    }
    return 0;
}

/** Empire.3.cs 2732 ReviewResearchStationBonuses. No Rnd. */
export function reviewResearchStationBonuses(galaxy: Galaxy, empire: Empire): void {
    void galaxy;
    let researchBonusWeaponsStation: BuiltObject | null = null;
    let num = 0;
    let researchBonusEnergyStation: BuiltObject | null = null;
    let num2 = 0;
    let researchBonusHighTechStation: BuiltObject | null = null;
    let num3 = 0;
    for (let i = 0; i < empire.builtObjects.length; i++) {
        const builtObject = empire.builtObjects[i];
        if (builtObject.role !== BuiltObjectRole.Base || (builtObject.researchWeapons <= 0 && builtObject.researchEnergy <= 0 && builtObject.researchHighTech <= 0)) continue;
        let characterList: Character[] = [];
        const chars = stellarObjectCharacters(builtObject);
        if (chars !== null) characterList = getNonTransferringCharacters(chars, CharacterRole.Scientist);
        const num4 = Math.fround(totalDiminishingResearchBonuses(characterList, (c) => c.researchWeapons));
        const num5 = Math.fround(totalDiminishingResearchBonuses(characterList, (c) => c.researchEnergy));
        const num6 = Math.fround(totalDiminishingResearchBonuses(characterList, (c) => c.researchHighTech));
        if (builtObject.researchWeapons > 0) {
            const num8 = Math.fround(num4 + stationLocationResearchBonus(builtObject, IndustryType.Weapon));
            if (num8 > num) {
                num = num8;
                researchBonusWeaponsStation = builtObject;
            }
        }
        if (builtObject.researchEnergy > 0) {
            const num10 = Math.fround(num5 + stationLocationResearchBonus(builtObject, IndustryType.Energy));
            if (num10 > num2) {
                num2 = num10;
                researchBonusEnergyStation = builtObject;
            }
        }
        if (builtObject.researchHighTech > 0) {
            const num12 = Math.fround(num6 + stationLocationResearchBonus(builtObject, IndustryType.HighTech));
            if (num12 > num3) {
                num3 = num12;
                researchBonusHighTechStation = builtObject;
            }
        }
    }
    empire.researchBonusWeaponsStation = researchBonusWeaponsStation;
    empire.researchBonusWeapons = num;
    empire.researchBonusEnergyStation = researchBonusEnergyStation;
    empire.researchBonusEnergy = num2;
    empire.researchBonusHighTechStation = researchBonusHighTechStation;
    empire.researchBonusHighTech = num3;
}

// ---------------------------------------------------------------------------
// Scientist appearance / promotion (Galaxy.2.cs 4852-4980)
// ---------------------------------------------------------------------------

/** Race.CharacterRandomAppearanceChanceScientist (Race.cs 156, default 1.0; LoadFromFile 1444 clamps to [0, 5]). */
function raceCharacterRandomAppearanceChanceScientist(race: Race): number {
    const raw = race.extra?.['CharacterRandomAppearanceChanceScientist'];
    if (raw === undefined || raw.trim() === '') return 1.0;
    return Math.min(5.0, Math.max(0.0, Number(raw.trim())));
}

function researchBonusStationFor(empire: Empire, industry: IndustryType): BuiltObject | null {
    switch (industry) {
        case IndustryType.Weapon: return empire.researchBonusWeaponsStation;
        case IndustryType.Energy: return empire.researchBonusEnergyStation;
        case IndustryType.HighTech: return empire.researchBonusHighTechStation;
        default: return null;
    }
}

// Galaxy.2.cs ChanceNewScientist (4890) / ChanceNewScientistCriticalSuccess (4935): base chance 25 / 6.
function chanceNewScientistCore(galaxy: Galaxy, empire: Empire | null, researchProject: TechNode | null, baseChance: number, textKey: string): boolean {
    if (empire !== null && researchProject !== null) {
        let num = baseChance;
        if (empire.dominantRace !== null) num = Math.max(2, csDoubleToInt(num / raceCharacterRandomAppearanceChanceScientist(empire.dominantRace)));
        if (galaxy.rnd.next(0, num) === 1 && charactersCanGenerateAmountNonIntelligenceAgent(empire) > 0) {
            let character: Character | null = null;
            const station = researchBonusStationFor(empire, nodeIndustry(researchProject));
            if (station !== null && stellarObjectCharacters(station) !== null) {
                character = generateNewCharacter(galaxy, empire, CharacterRole.Scientist, station).character;
            }
            if (character !== null) {
                const title = gameText('New Character Event Title', resolveDescription(CharacterRole, character.role));
                const description = gameText(textKey, researchProject.def.name, character.name);
                sendMessageToEmpireWithTitle(empire, empire, EmpireMessageType.CharacterAppearance, character, description, title);
                return true;
            }
        }
    }
    return false;
}
export function chanceNewScientist(galaxy: Galaxy, empire: Empire | null, researchProject: TechNode | null): boolean {
    return chanceNewScientistCore(galaxy, empire, researchProject, 25, 'New Character Event Scientist');
}
export function chanceNewScientistCriticalSuccess(galaxy: Galaxy, empire: Empire | null, researchProject: TechNode | null): boolean {
    return chanceNewScientistCore(galaxy, empire, researchProject, 6, 'New Character Event Scientist Critical Success');
}

/**
 * Galaxy.1.cs DoCharacterEvent(eventType, eventData, CharacterList sourceCharacters) (3781) for the research events
 * (includeLeader false). The skill-progress cases of these events are still an M4u stub in characters.ts (TODO hit,
 * no Rnd): RND: Next(0,5), Next(0,20), Next(0,80) per character not drawn until M4u.
 */
function doResearchCharacterEvent(galaxy: Galaxy, eventType: CharacterEventType, eventData: unknown, characters: Character[]): void {
    doCharacterEventForList(galaxy, eventType, eventData, characters, false, null);
}

// Galaxy.2.cs ChanceScientistPromotion (4852).
export function chanceScientistPromotion(galaxy: Galaxy, empire: Empire | null, researchProject: TechNode | null): void {
    if (empire === null || researchProject === null) return;
    let characterList: Character[] = [];
    let eventType = CharacterEventType.ResearchAdvanceEnergy;
    const industry = nodeIndustry(researchProject);
    const station = researchBonusStationFor(empire, industry);
    const chars = station !== null ? stellarObjectCharacters(station) : null;
    if (station !== null && chars !== null) {
        characterList = getCharactersByRole(chars, CharacterRole.Scientist);
        switch (industry) {
            case IndustryType.Weapon: eventType = CharacterEventType.ResearchAdvanceWeapons; break;
            case IndustryType.Energy: eventType = CharacterEventType.ResearchAdvanceEnergy; break;
            case IndustryType.HighTech: eventType = CharacterEventType.ResearchAdvanceHighTech; break;
        }
    }
    if (characterList.length > 0) doResearchCharacterEvent(galaxy, eventType, researchProject, characterList);
}

// ---------------------------------------------------------------------------
// Galactic NewsNet (Empire.7.cs 2986 SendNewsBroadcast → SendNewsBroadcastCore 3008), ResearchBreakthrough case.
// ---------------------------------------------------------------------------

/**
 * SendNewsBroadcast(EventMessageType.Undefined, researchNode, DisasterEventType.Undefined, false, false,
 * EmpireMessageType.ResearchBreakthrough, this). C# queues SendNewsBroadcastCore on the ThreadPool; the port runs it
 * synchronously (single-threaded scheduler). With eventType Undefined and no war/wonder flag, no empire in
 * DiplomaticRelations qualifies; every active pirate faction gets the message (ObtainPirateRelation may create the
 * relation).
 */
function sendNewsBroadcastResearchBreakthrough(galaxy: Galaxy, empire: Empire, researchNode: TechNode): void {
    const text = gameText('The EMPIRE has made a breakthrough in the key technology of X', empire.name, researchNode.def.name);
    for (let j = 0; j < galaxy.pirateEmpires.length; j++) {
        const empire7 = galaxy.pirateEmpires[j];
        if (empire7 === null || !empire7.active || empire7.pirateEmpireBaseHabitat === null) continue;
        obtainPirateRelation(empire, empire7);
        const newsNet = gameText('Galactic NewsNet').toUpperCase();
        const empireMessage2 = new EmpireMessage(empire, EmpireMessageType.GalacticNewsNet, researchNode);
        empireMessage2.description = newsNet + ': ' + empire.name + ' - ' + text;
        empireMessage2.title = newsNet + ': ' + empire.name;
        sendEmpireMessage(empireMessage2, empire7);
    }
}

// ---------------------------------------------------------------------------
// Breakthroughs
// ---------------------------------------------------------------------------

// Empire.3.cs ReviewDesignsBuiltObjectsImprovedComponents (2043).
export function reviewDesignsBuiltObjectsImprovedComponents(empire: Empire): void {
    for (let i = 0; i < empire.designs.length; i++) empire.designs[i].reDefine();
    for (let j = 0; j < empire.builtObjects.length; j++) empire.builtObjects[j].reDefine();
    for (let k = 0; k < empire.privateBuiltObjects.length; k++) empire.privateBuiltObjects[k].reDefine();
}

/** Empire.3.cs ReviewColonizationTypes / ReviewPopulationGrowthRates / ReviewMaximumConstructionSize / ReviewCanBuildShipTypes / ReviewTroopTypes. */
function reviewResearchAbilityEffects(empire: Empire): void {
    empire.reviewColonizationTypes();
    empire.reviewPopulationGrowthRates();
    empire.reviewMaximumConstructionSize(() => {});
    empire.reviewCanBuildShipTypes();
    empire.reviewTroopTypes();
}

/** ColonizeHabitatType / PopulationGrowthRate ability value 1-6 → HabitatType (DoResearchAbilityBreakthrough switches). */
const HABITAT_TYPE_BY_ABILITY_VALUE: HabitatType[] = [HabitatType.Undefined, HabitatType.Continental, HabitatType.MarshySwamp, HabitatType.Ocean, HabitatType.Desert, HabitatType.Ice, HabitatType.Volcanic];

// Empire.3.cs DoResearchAbilityBreakthrough(researchProject, out relatedObject) (2069).
export function doResearchAbilityBreakthrough(empire: Empire, researchProject: TechNode): { text: string; relatedObject: unknown } {
    let text = '';
    let relatedObject: unknown = null;
    reviewResearchAbilityEffects(empire);
    const abilities = researchProject.def.abilities;
    if (abilities.length > 0) {
        for (let i = 0; i < abilities.length; i++) {
            const a = abilities[i];
            const value = a.value;
            switch (abilityTypeFromFile(a.type)) {
                case ResearchAbilityType.Boarding:
                    if (a.value > 0) text += gameText('Improved Boarding attack strength').toLowerCase();
                    else if (a.value < 0) text += gameText('Improved Boarding defense strength').toLowerCase();
                    break;
                case ResearchAbilityType.Troop: {
                    const troopType = abilityRelatedTroopType(a);
                    if (troopType !== null) {
                        if (troopType !== TroopType.Undefined) {
                            const d = resolveDescription(TroopType, troopType);
                            text =
                                a.value > 0
                                    ? text + ' ' + gameText('Increases the Attack Strength of newly recruited TROOPTYPE', d).toLowerCase()
                                    : a.value >= 0
                                      ? text + ' ' + gameText('the ability to recruit TROOPTYPE', d)
                                      : text + ' ' + gameText('Increases the Defend Strength of newly recruited TROOPTYPE', d).toLowerCase();
                            relatedObject = troopType;
                        } else {
                            text = text + ' ' + gameText('Lowers the maintenance costs of all troops').toLowerCase();
                        }
                    } else {
                        text = text + ' ' + gameText('Lowers the maintenance costs of all troops').toLowerCase();
                    }
                    break;
                }
                case ResearchAbilityType.EnableShipSubRole: {
                    const subRole = abilityRelatedSubRole(a);
                    if (subRole !== null) {
                        text = text + ' ' + gameText('the ability to build SHIPTYPE', resolveDescription(BuiltObjectSubRole, subRole));
                        relatedObject = subRole;
                    }
                    break;
                }
                case ResearchAbilityType.ColonizeHabitatType:
                    if (value >= 1 && value <= 6) {
                        const h = HABITAT_TYPE_BY_ABILITY_VALUE[value];
                        text = text + ' ' + gameText('the ability to colonize PLANETTYPE planets and moons', resolveDescription(HabitatType, h));
                        relatedObject = h;
                    }
                    break;
                case ResearchAbilityType.ConstructionSize:
                    text = text + ' ' + gameText('an increase to the maximum construction sizes of ships and bases', value.toString(), (value * 3).toString());
                    break;
                case ResearchAbilityType.PopulationGrowthRate:
                    if (value >= 1 && value <= 6) {
                        text = text + ' ' + gameText('double population growth rate at all of our PLANETTYPE colonies', resolveDescription(HabitatType, HABITAT_TYPE_BY_ABILITY_VALUE[value]));
                    }
                    break;
            }
        }
    }
    return { text, relatedObject };
}


// Empire.3.cs DoResearchBreakthrough(researchProject, selfResearched, blockMessages, suppressUpdate) (2500).
export function doResearchBreakthrough(galaxy: Galaxy, empire: Empire, researchProject: TechNode, selfResearched: boolean, blockMessages = false, suppressUpdate = false): void {
    const research = empire.research;
    researchProject.isResearched = true;
    researchProject.selfResearched = selfResearched;
    researchProject.progress = researchProject.cost;
    // 2505-2506 GetMatchingGameEventIdResearchBreakthrough + CheckTriggerEvent (story/eventActions.ts, M4z3).
    const matchingGameEventIdResearchBreakthrough = getMatchingGameEventIdResearchBreakthrough(galaxy, empire, researchProject.def.projectId);
    checkTriggerEvent(galaxy, matchingGameEventIdResearchBreakthrough, empire, EventTriggerType.ResearchBreakthrough, null);
    const def = researchProject.def;
    if (def.components.length > 0 || (def.abilities.length > 0 && abilityTypeFromFile(def.abilities[0].type) === ResearchAbilityType.ConstructionSize)) {
        empire.reviewDesignsAndRetrofitFlag = true;
        let flag = false;
        if (nodeCategory(researchProject) === ComponentCategoryType.HyperDrive) {
            const latestComponent = research.getLatestComponent(ComponentType.HyperDrive);
            if (latestComponent !== null && latestComponent.value1 < 5000 && def.components.length > 0) {
                for (let i = 0; i < def.components.length; i++) {
                    const component = research.definitionFor(def.components[i]);
                    if (component !== undefined && component.type === ComponentType.HyperDrive && component.value1 >= 5000) {
                        flag = true;
                        break;
                    }
                }
            }
        }
        if (def.specialFunctionCode === 2 || flag) empire.reviewDesignsAndRetrofitImportantBreakthrough = true;
    }
    if (def.specialFunctionCode === 2 && empire.controlMilitaryFleets && empire.shipGroups !== null) {
        // 2532-2551: disband auto-controlled fleets whose WarpSpeed <= 0 (DisbandShipGroup; ported by M4l).
        const shipGroups = empireShipGroups(empire);
        const shipGroupList: ShipGroup[] = [];
        for (let j = 0; j < shipGroups.length; j++) {
            const shipGroup = shipGroups[j];
            if (shipGroup !== null && shipGroup.leadShip !== null && shipGroup.leadShip.isAutoControlled && shipGroupWarpSpeed(shipGroup) <= 0) {
                shipGroupList.push(shipGroup);
            }
        }
        for (let k = 0; k < shipGroupList.length; k++) {
            const shipGroup2 = shipGroupList[k];
            if (shipGroup2 !== null) {
                disbandShipGroup(galaxy, empire, shipGroup2);
            }
        }
    }
    research.recentProjects.push(researchProject);
    const queue = research.researchQueueFor(nodeIndustry(researchProject));
    if (queue !== null && queue.includes(researchProject)) listRemove(queue, researchProject);
    let relatedObject: unknown = null;
    let text = '';
    if (def.abilities.length > 0) {
        const r = doResearchAbilityBreakthrough(empire, researchProject);
        relatedObject = r.relatedObject;
        text = r.text + ', ';
    }
    if (def.specialFunctionCode === 2) {
        if (checkSendPreWarpProgressEventMessage(galaxy, empire, PreWarpProgressEventType.DiscoverHyperspaceTech, researchProject) && empire === galaxy.playerEmpire) {
            checkGenerateAncientHelpers(galaxy); // Galaxy.8.cs 1889 (story/storyEvents.ts, M4z3; returns unless the Shakturi story is on)
        }
    } else if (def.specialFunctionCode === 4) {
        checkSendPreWarpProgressEventMessage(galaxy, empire, PreWarpProgressEventType.DiscoverColonizationTech, researchProject);
    }
    if (!blockMessages) {
        if (def.components.length > 0) {
            const c0 = research.definitionFor(def.components[0]);
            text = text + ' ' + gameText('the new component X for our ships and bases', c0?.name ?? '') + ', ';
            relatedObject = c0 ?? null;
        }
        if (def.componentImprovements.length > 0) {
            const ci0 = def.componentImprovements[0];
            const existing = research.componentImprovements.get(ci0.componentId);
            const improved = research.definitionFor(ci0.componentId);
            if (existing === undefined) {
                text = text + ' ' + gameText('improvements to the existing component X', improved?.name ?? '') + ', ';
                relatedObject = improved ?? null;
            } else if (ci0.techLevel > existing.techLevel) {
                text = text + ' ' + gameText('improvements to the existing component X', improved?.name ?? '') + ', ';
                relatedObject = improved ?? null;
            }
        }
        const facility = research.planetaryFacilityOf(researchProject);
        if (facility !== null && !research.buildablePlanetaryFacilities.includes(facility)) {
            text = text + ' ' + gameText('the ability to build a new planetary facility X', facility.name) + ', ';
            relatedObject = facility;
        }
        if (def.plagueChange !== null) {
            const plagueId = def.plagueChange.plagueId;
            const plagueName = galaxy.researchStatic?.plagues[plagueId]?.name ?? '';
            text = !research.enabledPlagues.some((p) => p.plagueId === plagueId) ? text + ' ' + gameText('creates the new PLAGUE', plagueName) + ', ' : text + ' ' + gameText('changes to PLAGUE', plagueName) + ', ';
        }
        if (def.fighters.length > 0) {
            for (let l = 0; l < def.fighters.length; l++) {
                if (!research.researchedFighters.some((f) => f.fighterId === def.fighters[l])) {
                    const f = galaxy.researchStatic?.fighters.find((x) => x.fighterId === def.fighters[l]) ?? null;
                    text = text + ' ' + gameText('access to a new fighter type X', f?.name ?? '') + ', ';
                    relatedObject = f;
                }
            }
        }
        let text2 = gameText('Our engineers have completed research in RESEARCHPROJECT', def.name);
        if (text.length > 0) {
            text2 = text2 + '. ' + gameText('This breakthrough provides BENEFITS', text);
            text2 = text2.substring(0, text2.length - 2);
        }
        void relatedObject; // UI-only (message subject in C# is the research node).
        sendMessageToEmpire(empire, empire, EmpireMessageType.ResearchBreakthrough, researchProject, text2);
    }
    if (!suppressUpdate && research !== null) {
        research.update(empire.dominantRace);
        reviewDesignsBuiltObjectsImprovedComponents(empire);
        reviewResearchAbilityEffects(empire);
    }
}

// ---------------------------------------------------------------------------
// Next-project AI
// ---------------------------------------------------------------------------

// ResearchSystem.cs DetermineTechCategoryType (855).
export function determineTechCategoryType(componentType: ComponentType): { category: ComponentCategoryType; type: ComponentType } {
    switch (componentType) {
        case ComponentType.WeaponBeam:
        case ComponentType.WeaponTorpedo:
        case ComponentType.Shields:
        case ComponentType.HyperDrive:
        case ComponentType.Reactor:
            return { category: resolveComponentCategory(componentType), type: ComponentType.Undefined };
        default:
            return { category: ComponentCategoryType.Undefined, type: componentType };
    }
}

/** Race.SpecialComponent (component id; -1 = none) as its definition. */
function raceSpecialComponent(rs: ResearchSystem, race: Race | null): ComponentDefinition | null {
    if (race === null || race.specialComponent < 0) return null;
    return rs.definitionFor(race.specialComponent) ?? null;
}

// ResearchNodeDefinitionList.ResolveRaceSpecificComponents(race, includeImprovements) (1271). The C# improvement loop
// bounds index2 by this[index2].ComponentImprovements.Count (not this[index1]) — kept verbatim.
export function resolveRaceSpecificComponents(rs: ResearchSystem, galaxy: Galaxy, race: Race, includeImprovements: boolean): ComponentDefinition[] {
    const list: ComponentDefinition[] = [];
    const stat = galaxy.researchStatic;
    const defs = stat?.definitions ?? [];
    for (let index1 = 0; index1 < defs.length; index1++) {
        const allowed = stat!.allowedRaces.get(defs[index1].projectId);
        if (allowed !== undefined && allowed.size > 0 && allowed.has(race.name)) {
            for (const id of defs[index1].components) {
                const d = rs.definitionFor(id);
                if (d !== undefined) list.push(d);
            }
            if (includeImprovements && defs[index1].componentImprovements.length > 0) {
                for (let index2 = 0; index2 < defs[index2].componentImprovements.length; ++index2) {
                    const ci = defs[index1].componentImprovements[index2];
                    if (ci === undefined) throw new Error(`ResolveRaceSpecificComponents: ArgumentOutOfRange (ComponentImprovements[${index2}] of project ${index1})`);
                    const improved = rs.definitionFor(ci.componentId);
                    if (improved !== undefined && !list.some((c) => c.componentId === improved.componentId)) list.push(improved);
                }
            }
        }
    }
    return list;
}

// Empire.10.cs DetermineTechForUnbuildableOptimizedDesigns (3221).
function determineTechForUnbuildableOptimizedDesigns(empire: Empire): { categories: ComponentCategoryType[]; types: ComponentType[] } {
    const categories: ComponentCategoryType[] = [];
    const types: ComponentType[] = [];
    // DesignList.ResolveOptimizedDesigns (305).
    const designList = empire.designs.filter((d) => d !== null && d.optimizedDesign > 0);
    if (designList.length > 0) {
        // DesignList.GetUnbuildableNonObsoleteDesigns (317).
        const unbuildable = designList.filter((d) => d !== null && !d.isObsolete && !canBuildDesign(empire, d));
        if (unbuildable.length > 0) {
            // DesignList.DetermineUniqueUnbuildableComponents (348) via DetermineUniqueComponents (329).
            const unique: ComponentDefinition[] = [];
            for (const d of unbuildable) for (const c of d.components) if (c !== null && !unique.some((u) => u.componentId === c.componentId)) unique.push(c);
            const componentList: ComponentDefinition[] = [];
            for (const c of unique) if (c !== null && !empire.research.checkComponentResearched(c) && !componentList.some((u) => u.componentId === c.componentId)) componentList.push(c);
            for (const c of componentList) if (!types.includes(c.type)) types.push(c.type);
        }
    }
    for (let j = 0; j < types.length; j++) {
        const { category } = determineTechCategoryType(types[j]);
        if (category !== ComponentCategoryType.Undefined && !categories.includes(category)) categories.push(category);
    }
    return { categories, types };
}

interface ResearchFocuses {
    targettedCategories: ComponentCategoryType[];
    targettedTypes: ComponentType[];
    optimizedDesignCategories: ComponentCategoryType[];
    optimizedDesignTypes: ComponentType[];
    raceAllowedComponents: ComponentDefinition[];
}

// Empire.3.cs DeterminePreferredEmpireResearchFocuses (3214).
function determinePreferredEmpireResearchFocuses(galaxy: Galaxy, empire: Empire): ResearchFocuses {
    const targettedCategories: ComponentCategoryType[] = [];
    const targettedTypes: ComponentType[] = [];
    let raceAllowedComponents: ComponentDefinition[] = [];
    const policy = empire.policy;
    if (policy !== null) {
        const list: ComponentCategoryType[] = [];
        const list2: ComponentType[] = [];
        for (const f of [policy.researchDesignTechFocus1, policy.researchDesignTechFocus2, policy.researchDesignTechFocus3, policy.researchDesignTechFocus4, policy.researchDesignTechFocus5, policy.researchDesignTechFocus6]) {
            if (f !== ComponentCategoryType.Undefined && !list.includes(f)) list.push(f);
        }
        for (const t of [policy.researchDesignTechFocusType1, policy.researchDesignTechFocusType2, policy.researchDesignTechFocusType3, policy.researchDesignTechFocusType4, policy.researchDesignTechFocusType5, policy.researchDesignTechFocusType6]) {
            if (t !== ComponentType.Undefined && !list2.includes(t)) list2.push(t);
        }
        targettedCategories.length = 0;
        targettedTypes.length = 0;
        if (list.length > 0) targettedCategories.push(...list);
        if (list2.length > 0) targettedTypes.push(...list2);
    }
    const { categories: optimizedDesignCategories, types: optimizedDesignTypes } = determineTechForUnbuildableOptimizedDesigns(empire);
    if (optimizedDesignCategories.length > 0) targettedCategories.push(...optimizedDesignCategories);
    if (optimizedDesignTypes.length > 0) targettedTypes.push(...optimizedDesignTypes);
    const special = raceSpecialComponent(empire.research, empire.dominantRace);
    if (special !== null && !targettedTypes.includes(special.type)) targettedTypes.push(special.type);
    if (empire.dominantRace !== null) {
        raceAllowedComponents = resolveRaceSpecificComponents(empire.research, galaxy, empire.dominantRace, true);
        if (raceAllowedComponents.length > 0) {
            // ComponentList.ResolveComponentTypes (282).
            const list3: ComponentType[] = [];
            for (const c of raceAllowedComponents) if (c !== null && !list3.includes(c.type)) list3.push(c.type);
            for (let i = 0; i < list3.length; i++) if (!targettedTypes.includes(list3[i])) targettedTypes.push(list3[i]);
        }
    }
    return { targettedCategories, targettedTypes, optimizedDesignCategories, optimizedDesignTypes, raceAllowedComponents };
}

// ResearchSystem.cs CalculateOrderedValueByType (1993).
export function calculateOrderedValueByType(rs: ResearchSystem, researchProject: TechNode, designFocus: ShipDesignFocus): number {
    let v = 0.0;
    let ci: ComponentImprovementEntry | null = null;
    if (researchProject.def.components.length > 0) {
        const d = rs.definitionFor(researchProject.def.components[0]);
        if (d !== undefined) ci = componentImprovementFromComponent(d);
    } else if (researchProject.def.componentImprovements.length > 0) {
        const raw = researchProject.def.componentImprovements[0];
        const d = rs.definitionFor(raw.componentId);
        if (d !== undefined) ci = { improvedComponent: d, techLevel: raw.techLevel, value1: raw.value1, value2: raw.value2, value3: raw.value3, value4: raw.value4, value5: raw.value5, value6: raw.value6, value7: raw.value7 };
    }
    if (ci === null) return v;
    const T = ComponentType;
    const t = ci.improvedComponent.type;
    const f = Math.fround;
    const isWeaponLike = t === T.WeaponBeam || t === T.WeaponTorpedo || t === T.WeaponMissile || t === T.WeaponIonCannon || t === T.WeaponIonPulse || t === T.WeaponAreaDestruction || t === T.WeaponPhaser || t === T.WeaponRailGun;
    switch (designFocus) {
        case ShipDesignFocus.Balanced:
        case ShipDesignFocus.Power:
            if (isWeaponLike || t === T.Shields || t === T.EngineMainThrust || t === T.EngineVectoring || t === T.HyperDrive || t === T.Reactor) v = f(ci.value1);
            break;
        case ShipDesignFocus.SpeedAgility:
            if (isWeaponLike || t === T.Shields) v = f(ci.value2);
            else if (t === T.EngineMainThrust || t === T.EngineVectoring || t === T.Reactor) v = f(ci.value1);
            else if (t === T.HyperDrive) v = f(100 / f(ci.value3));
            break;
        case ShipDesignFocus.Efficiency:
            if (isWeaponLike) v = f(ci.value1);
            else if (t === T.Shields) v = f(ci.value2);
            else if (t === T.EngineMainThrust || t === T.EngineVectoring || t === T.HyperDrive) v = f(100.0 / (ci.value1 / ci.value2));
            else if (t === T.Reactor) v = f(100.0 / (ci.value3 / ci.value2));
            break;
    }
    return v;
}

// ResearchSystem.cs SelectBestProject(ComponentType, availableProjects, designFocus) (1970): SortTag = ordered value,
// List.Sort (float CompareTo) + Reverse, first.
function selectBestProjectByType(rs: ResearchSystem, type: ComponentType, availableProjects: TechNode[], designFocus: ShipDesignFocus): TechNode | null {
    const list: TechNode[] = [];
    for (const p of availableProjects) {
        const types = rs.componentTypesAll(p);
        if (types.length >= 0 && types.includes(type)) {
            list.push(p);
            p.sortTag = calculateOrderedValueByType(rs, p, designFocus);
        }
    }
    if (list.length <= 0) return null;
    netSort(list, (a, b) => (a.sortTag < b.sortTag ? -1 : a.sortTag > b.sortTag ? 1 : 0));
    list.reverse();
    return list[0];
}

// ResearchSystem.cs IdentifyLaggingProject(ComponentType, …) (1943) + IdentifyBestNextProject (1961).
function identifyLaggingProjectType(rs: ResearchSystem, type: ComponentType, race: Race | null, highest: number, gap: number, industryNextProjects: TechNode[], focus: ShipDesignFocus): TechNode | null {
    const p = getLowestUnresearchedProjectForTypeAny(rs, rs.techTree, type, race);
    if (p !== null && containsById(industryNextProjects, p.def.projectId) && highest - p.def.techLevel >= gap) {
        const best = selectBestProjectByType(rs, type, getProjectsByType(rs, industryNextProjects, type), focus);
        if (best !== null && !best.isResearched) return best;
    }
    return null;
}

// ResearchSystem.cs ResolveEssentialProjects_NEW (290).
export function resolveEssentialProjectsNew(
    galaxy: Galaxy,
    empire: Empire | null,
    rs: ResearchSystem,
    industry: IndustryType,
    industryNextProjects: TechNode[],
    techComponentFocuses: ComponentType[],
    techCategoryFocuses: ComponentCategoryType[],
): (TechNode | null)[] {
    const tree = rs.techTree;
    const T = ComponentType;
    const projects: (TechNode | null)[] = [];
    const p1 = getLowestProjectForTypeAnyIn(rs, tree, T.WeaponPointDefense);
    const p2 = getLowestProjectForTypeAnyIn(rs, tree, T.ComputerCountermeasures);
    const p3 = getLowestProjectForTypeAnyIn(rs, tree, T.ComputerTargetting);
    const p4 = getLowestProjectForTypeAnyIn(rs, tree, T.SensorLongRange);
    const p5 = getLowestProjectForTypeAnyIn(rs, tree, T.Armor);
    const p6 = getLowestProjectForTypeAnyIn(rs, tree, T.FighterBay);
    if (p1 !== null) projects.push(p1);
    if (p2 !== null) projects.push(p2);
    if (p3 !== null) projects.push(p3);
    if (p4 !== null) projects.push(p4);
    if (p5 !== null && !containsById(projects, p5.def.projectId)) projects.push(p5);
    if (p6 !== null) projects.push(p6);
    if (empire === null) return projects;
    if (empire.pirateEmpireBaseHabitat !== null) {
        projects.push(getHighestProjectForTypeAny(rs, tree, T.AssaultPod));
        projects.push(getHighestProjectForTypeAny(rs, tree, T.WeaponTractorBeam));
        projects.push(getHighestProjectForTypeAny(rs, tree, T.SensorScannerJammer));
        return projects;
    }
    const W = WonderType;
    const armoredFactory = getLowestProjectForPlanetaryFacilityType(rs, tree, PlanetaryFacilityType.ArmoredFactory);
    const dedicatedCarriers = getLowestProjectForDedicatedCarriers(tree);
    const w1 = getLowestProjectForWonderType(rs, tree, W.EmpireIncome);
    const w2 = getLowestProjectForWonderType(rs, tree, W.ColonyIncome);
    const w3 = getLowestProjectForWonderType(rs, tree, W.EmpireHappiness);
    const w4 = getLowestProjectForWonderType(rs, tree, W.ColonyHappiness);
    const w5 = getLowestProjectForWonderType(rs, tree, W.EmpireResearchEnergy);
    const w6 = getLowestProjectForWonderType(rs, tree, W.EmpireResearchHighTech);
    const w7 = getLowestProjectForWonderType(rs, tree, W.EmpireResearchWeapons);
    const regionalCapital = getLowestProjectForPlanetaryFacilityType(rs, tree, PlanetaryFacilityType.RegionalCapital);
    const w8 = getLowestProjectForWonderType(rs, tree, W.ColonyConstructionSpeed);
    if (armoredFactory !== null) projects.push(armoredFactory);
    const gap = 2;
    const projectForIndustry = getHighestResearchedProjectForIndustry(tree, industry);
    let highest = 0;
    if (projectForIndustry !== null) highest = projectForIndustry.def.techLevel;
    const policy = empire.policy!;
    const race = empire.dominantRace;
    const focus = policy.researchDesignOverallFocus;
    // IdentifyLaggingProjectAndAdd overloads (1865-1941).
    const addLaggingType = (type: ComponentType) => {
        const r = identifyLaggingProjectType(rs, type, race, highest, gap, industryNextProjects, focus);
        if (r !== null) projects.push(r);
    };
    const addLaggingFacility = (type: PlanetaryFacilityType) => {
        const r = getLowestProjectForPlanetaryFacilityType(rs, tree, type, true);
        if (r !== null && highest - r.def.techLevel > gap) projects.push(r);
    };
    const addLaggingWonder = (type: WonderType) => {
        const r = getLowestProjectForWonderType(rs, tree, type, true);
        if (r !== null && highest - r.def.techLevel > gap) projects.push(r);
    };
    const addLaggingTroop = (type: TroopType) => {
        const r = getLowestProjectForTroopType(tree, type, true);
        if (r !== null && highest - r.def.techLevel > gap) projects.push(r);
    };
    addLaggingType(T.Shields);
    addLaggingType(T.EngineMainThrust);
    addLaggingType(T.EngineVectoring);
    addLaggingType(T.HyperDrive);
    addLaggingType(T.Reactor);
    addLaggingType(T.Armor);
    addLaggingType(T.DamageControl);
    const facilities = galaxy.researchStatic?.facilities ?? [];
    // PlanetaryFacilityDefinitionList.FindWonderByType (352).
    const findWonderByType = (type: WonderType): Facility | null => facilities.find((fd) => facilityType(fd) === PlanetaryFacilityType.Wonder && fd.wonderType === type) ?? null;
    const governmentAttributes = empireGovernmentAttributes(empire)!;
    if (race !== null) {
        // TODO(port) M4j: Race.CautionLevel / AggressionLevel return the periodic levels while a race change period is
        // active (Race.cs 350-377, ReviewRacePeriodicChanges); the base levels are read here.
        if (race.caution >= 100) {
            addLaggingFacility(PlanetaryFacilityType.FortifiedBunker);
            addLaggingTroop(TroopType.Artillery);
            if (race.caution >= 110) {
                addLaggingFacility(PlanetaryFacilityType.PlanetaryShield);
                addLaggingType(T.ComputerCountermeasuresFleet);
            }
        }
        if (race.aggression >= 110) {
            addLaggingTroop(TroopType.SpecialForces);
            if (race.aggression >= 115) {
                addLaggingType(T.WeaponBombard);
                addLaggingType(T.ComputerTargettingFleet);
            }
        }
        if (race.intelligence >= 100) {
            const wonderByType = findWonderByType(W.ColonyConstructionSpeed);
            if (!checkWonderBuilt(galaxy, wonderByType)) {
                if (w8 !== null && (techComponentFocuses.includes(T.ConstructionBuild) || techCategoryFocuses.includes(ComponentCategoryType.Construction))) projects.push(w8);
                else addLaggingWonder(W.ColonyConstructionSpeed);
            }
            if (dedicatedCarriers !== null) projects.push(dedicatedCarriers);
            if (regionalCapital !== null && empire.colonies !== null && empire.colonies.length > 1) projects.push(regionalCapital);
        }
        if (race.researchBonus > 0 || governmentAttributes.researchSpeed > 1.0) {
            switch (policy.researchIndustryFocus) {
                case IndustryType.Weapon:
                    if (w7 !== null && !checkWonderBuilt(galaxy, findWonderByType(W.EmpireResearchWeapons))) projects.push(w7);
                    break;
                case IndustryType.Energy:
                    if (w5 !== null && !checkWonderBuilt(galaxy, findWonderByType(W.EmpireResearchEnergy))) projects.push(w5);
                    break;
                case IndustryType.HighTech:
                    if (w6 !== null && !checkWonderBuilt(galaxy, findWonderByType(W.EmpireResearchHighTech))) projects.push(w6);
                    break;
            }
        }
        if (raceSpecialComponent(rs, race) !== null) projects.push(getHighestProjectForComponent(tree, race.specialComponent));
        const wonder = raceBuildWonderVictoryFacility(galaxy, race);
        if (wonder !== null) {
            const projectByFacility = getProjectByFacility(rs, tree, wonder);
            if (projectByFacility !== null && !checkWonderBuilt(galaxy, wonder)) projects.push(projectByFacility);
        }
    }
    // C# dereferences DominantRace here without a null check.
    if (governmentAttributes.tradeBonus > 1.0 || race!.tradeBonus > 0) {
        if (w2 !== null && !checkWonderBuilt(galaxy, findWonderByType(W.ColonyIncome))) projects.push(w2);
        if ((governmentAttributes.tradeBonus >= 1.15 || race!.tradeBonus >= 15) && w1 !== null && !checkWonderBuilt(galaxy, findWonderByType(W.EmpireIncome))) projects.push(w1);
    }
    if (governmentAttributes.approvalRating > 1.0 || race!.satisfactionModifier > 0) {
        if (w4 !== null && !checkWonderBuilt(galaxy, findWonderByType(W.ColonyHappiness))) projects.push(w4);
        if ((governmentAttributes.approvalRating >= 1.15 || race!.satisfactionModifier >= 15) && w3 !== null && !checkWonderBuilt(galaxy, findWonderByType(W.EmpireHappiness))) projects.push(w3);
    }
    return projects;
}

/** RaceVictoryConditionType.BuildWonder (enum value 24). */
const RACE_VICTORY_CONDITION_BUILD_WONDER = 24;
/** RaceVictoryConditionType.cs member count (Enum.IsDefined range 0..70). */
const RACE_VICTORY_CONDITION_TYPE_COUNT = 71;

/**
 * Race.VictoryConditions.GetRaceVictoryConditionByType(BuildWonder).AdditionalData (Race.cs LoadFromFile 967-1160,
 * ParseConditionAdditionalData 1168): conditions 1-5 with a defined non-zero type, sorted by Proportion (List.Sort) and
 * reversed; the first BuildWonder's AdditionalData is PlanetaryFacilityDefinitionsStatic[index] (or null).
 */
export function raceBuildWonderVictoryFacility(galaxy: Galaxy, race: Race): Facility | null {
    // race.victoryConditions is Race.cs LoadFromFile's VictoryConditions list, already sorted by
    // Proportion (netSort) and reversed (data/races.ts parseVictoryConditions); BuildWonder's
    // additionalData is the raw facilities.txt index (ParseConditionAdditionalData).
    const c = (race.victoryConditions ?? []).find((x) => x.type === RaceVictoryConditionType.BuildWonder);
    if (c === undefined || c.additionalData === null) return null;
    const facilities = galaxy.researchStatic?.facilities ?? [];
    return c.additionalData >= 0 && c.additionalData < facilities.length ? facilities[c.additionalData] : null;
}

// ResearchSystem.cs RemoveNonRaceSpecificProjectTypes (877). Mutates `projects` and `optimizedDesignCategories`.
export function removeNonRaceSpecificProjectTypes(
    rs: ResearchSystem,
    race: Race | null,
    techTree: TechNode[],
    projects: TechNode[],
    optimizedDesignCategories: ComponentCategoryType[],
    optimizedDesignTypes: ComponentType[],
    raceAllowedComponents: ComponentDefinition[],
): TechNode[] {
    const special = raceSpecialComponent(rs, race);
    if (race !== null && projects !== null && (special !== null || (raceAllowedComponents !== null && raceAllowedComponents.length > 0))) {
        // DetermineRaceSpecialTechCategoryType (818).
        let type1 = ComponentType.Undefined;
        let category1 = ComponentCategoryType.Undefined;
        if (special !== null) {
            const r = determineTechCategoryType(special.type);
            category1 = r.category;
            type1 = r.type;
        }
        // DetermineAllowedRaceTechCategoryTypes (830).
        const categories: ComponentCategoryType[] = [];
        const types: ComponentType[] = [];
        for (const c of raceAllowedComponents) {
            if (c === null) continue;
            const r = determineTechCategoryType(c.type);
            if (r.category !== ComponentCategoryType.Undefined && !categories.includes(r.category)) categories.push(r.category);
            else if (r.type !== ComponentType.Undefined && !types.includes(r.type)) types.push(r.type);
        }
        if (type1 !== ComponentType.Undefined && !types.includes(type1)) types.push(type1);
        if (category1 !== ComponentCategoryType.Undefined && !categories.includes(category1)) categories.push(category1);
        for (let i = 0; i < optimizedDesignTypes.length; i++) {
            const { category: category2 } = determineTechCategoryType(optimizedDesignTypes[i]);
            if (category2 !== ComponentCategoryType.Undefined && !optimizedDesignCategories.includes(category2)) optimizedDesignCategories.push(category2);
        }
        const toRemove: TechNode[] = [];
        for (let index1 = 0; index1 < projects.length; index1++) {
            const project = projects[index1];
            if (project === null) continue;
            let flag1 = false;
            if (rs.allowedRacesCount(project) > 0 && rs.allowedRacesContains(project, race)) flag1 = true;
            if (flag1) continue;
            if (types.length > 0) {
                const types2 = rs.componentTypesAll(project);
                if (types2.length > 0 && typesIntersect(types, types2) && !typesIntersect(optimizedDesignTypes, types2)) {
                    let flag2 = false;
                    for (let index2 = 0; index2 < types.length; index2++) {
                        const type3 = types[index2];
                        if (type3 === ComponentType.Undefined) continue;
                        const forRace = getLowestUnresearchedProjectForRaceForTypeAny(rs, techTree, type3, race);
                        if (forRace !== null) {
                            const currentPath = getCurrentPath(rs, forRace, race);
                            if (currentPath !== null && containsById(currentPath, project.def.projectId)) {
                                flag2 = true;
                                break;
                            }
                        }
                    }
                    if (!flag2) toRemove.push(project);
                }
            } else if (categories.length > 0 && categories.includes(nodeCategory(project)) && !categoriesIntersect(optimizedDesignCategories, categories)) {
                let flag3 = false;
                for (let index3 = 0; index3 < categories.length; index3++) {
                    const category3 = categories[index3];
                    if (category3 === ComponentCategoryType.Undefined) continue;
                    const forRace = getLowestUnresearchedProjectForRaceForCategory(rs, techTree, category3, race);
                    if (forRace !== null) {
                        const currentPath = getCurrentPath(rs, forRace, race);
                        if (currentPath !== null && containsById(currentPath, project.def.projectId)) {
                            flag3 = true;
                            break;
                        }
                    }
                }
                if (!flag3) toRemove.push(project);
            }
        }
        for (const n of toRemove) listRemove(projects, n);
    }
    return projects;
}

// Empire.3.cs GenerateResearchProjectIdListFromProjects (1377).
function generateResearchProjectIdListFromProjects(projects: (TechNode | null)[]): number[] {
    const list: number[] = [];
    for (const n of projects) if (n !== null && !list.includes(n.def.projectId)) list.push(n.def.projectId);
    return list;
}

/** The current path to `node` including `node` itself (the recurring GetCurrentPath + ContainsById/Add pattern). */
function currentPathIncluding(rs: ResearchSystem, node: TechNode, race: Race | null): (TechNode | null)[] {
    const path = getCurrentPath(rs, node, race);
    if (!containsById(path, node.def.projectId)) path.push(node);
    return path;
}

// ComponentList.GetFirstWeaponOrFighter (113).
function firstWeaponOrFighter(components: readonly ComponentDefinition[]): ComponentDefinition | null {
    const C = ComponentCategoryType;
    for (const c of components) {
        if (c === null) continue;
        switch (c.category) {
            case C.WeaponBeam:
            case C.WeaponTorpedo:
            case C.WeaponArea:
            case C.Fighter:
            case C.WeaponSuperBeam:
            case C.WeaponSuperArea:
            case C.WeaponSuperTorpedo:
                return c;
            case C.WeaponIon:
                if (c.type === ComponentType.WeaponIonCannon || c.type === ComponentType.WeaponIonPulse) return c;
                continue;
        }
    }
    return null;
}

// Empire.3.cs SelectNextResearchProject(industry, researchQueue) (1391).
export function selectNextResearchProject(galaxy: Galaxy, empire: Empire, industry: IndustryType, researchQueue: TechNode[]): void {
    const rs = empire.research;
    const tree = rs.techTree;
    const race = empire.dominantRace;
    const T = ComponentType;
    const C = ComponentCategoryType;
    const { targettedCategories, targettedTypes, optimizedDesignCategories, optimizedDesignTypes, raceAllowedComponents } = determinePreferredEmpireResearchFocuses(galaxy, empire);
    if (rs.latestProjects === null || rs.nextProjects === null) rs.refreshLatestNextProjects(race);
    const projectsByIndustry = getProjectsByIndustry(rs.nextProjects!, industry);
    if (race !== null) {
        let list: number[] = [];
        switch (industry) {
            case IndustryType.Weapon: list = race.weaponsResearchProjectOrder; break;
            case IndustryType.Energy: list = race.energyResearchProjectOrder; break;
            case IndustryType.HighTech: list = race.highTechResearchProjectOrder; break;
        }
        if (list !== null) {
            for (let i = 0; i < list.length; i++) {
                const n = findNodeById(tree, list[i]);
                if (n !== null && !n.isResearched && rs.canResearchNode(n) && containsById(projectsByIndustry, n.def.projectId) && !researchQueue.includes(n)) {
                    researchQueue.push(n);
                    return;
                }
            }
        }
    }
    let researchNodeList: TechNode[] = [];
    for (let j = 0; j < targettedCategories.length; j++) {
        const cat = targettedCategories[j];
        if (cat === C.Undefined) continue;
        const highest = getHighestProjectForCategory(tree, cat);
        if (highest !== null && !highest.isResearched) {
            const l2 = intersectNodes(projectsByIndustry, currentPathIncluding(rs, highest, race));
            if (l2.length > 0) researchNodeList.push(...l2);
        }
    }
    for (let k = 0; k < targettedTypes.length; k++) {
        const type = targettedTypes[k];
        if (type === T.Undefined) continue;
        const highest = getHighestProjectForTypeAny(rs, tree, type);
        if (highest !== null && !highest.isResearched) {
            const l3 = intersectNodes(projectsByIndustry, currentPathIncluding(rs, highest, race));
            if (l3.length > 0) researchNodeList.push(...l3);
        }
    }
    const essential = resolveEssentialProjectsNew(galaxy, empire, rs, industry, projectsByIndustry, targettedTypes, targettedCategories);
    for (let l = 0; l < essential.length; l++) {
        const n2 = essential[l];
        if (n2 !== null && !n2.isResearched) {
            const l5 = intersectNodes(projectsByIndustry, currentPathIncluding(rs, n2, race));
            if (l5.length > 0) researchNodeList = mergeNodes(researchNodeList, l5) as TechNode[];
        }
    }
    if (industry === IndustryType.Energy) {
        const byAbility = getProjectsByAbility(projectsByIndustry, ResearchAbilityType.ConstructionSize);
        if (byAbility.length > 0 && researchNodeList.length > 0 && !containsById(researchNodeList, byAbility[0].def.projectId)) {
            let num = 0;
            const h = getHighestResearchedProjectForIndustry(tree, industry);
            if (h !== null) num = h.def.techLevel;
            if (num >= byAbility[0].def.techLevel) researchNodeList.push(byAbility[0]);
        }
    }
    if (industry === IndustryType.HighTech && researchNodeList.length > 0) {
        let num2 = 0;
        if (empire.canColonizeContinental) num2++;
        if (empire.canColonizeMarshySwamp) num2++;
        if (empire.canColonizeOcean) num2++;
        if (empire.canColonizeDesert) num2++;
        if (empire.canColonizeIce) num2++;
        if (empire.canColonizeVolcanic) num2++;
        let num3 = 0.99;
        if (num2 >= 2) num3 = 1.0;
        const list6: TechNode[] = [];
        const policy = empire.policy!;
        const byPriority: [number, HabitatType][] = [
            [policy.colonizeContinentalPriority, HabitatType.Continental],
            [policy.colonizeMarshySwampPriority, HabitatType.MarshySwamp],
            [policy.colonizeOceanPriority, HabitatType.Ocean],
            [policy.colonizeDesertPriority, HabitatType.Desert],
            [policy.colonizeIcePriority, HabitatType.Ice],
            [policy.colonizeVolcanicPriority, HabitatType.Volcanic],
        ];
        for (const [priority, habitatType] of byPriority) {
            if (priority > num3) {
                const p = rs.getLowestProjectForColonization(tree, habitatType);
                if (p !== null && !containsById(list6, p.def.projectId)) list6.push(p);
            }
        }
        for (let m = 0; m < Math.min(2, list6.length); m++) {
            const n3 = list6[m];
            if (n3 !== null && !n3.isResearched) {
                const l7 = intersectNodes(projectsByIndustry, currentPathIncluding(rs, n3, race));
                if (l7.length > 0) researchNodeList = mergeNodes(researchNodeList, l7) as TechNode[];
            }
        }
    }
    let researchNodeList8 = notIntersectNodes(projectsByIndustry, researchNodeList);
    const lo = (type: ComponentType) => getLowestProjectForTypeAnyIn(rs, tree, type);
    const lBeam = lo(T.WeaponBeam);
    const lGravity = lo(T.WeaponGravityBeam);
    const lRail = lo(T.WeaponRailGun);
    const lMissile = lo(T.WeaponMissile);
    const lTorpedo = lo(T.WeaponTorpedo);
    const lArea = lo(T.WeaponAreaDestruction);
    const lInfantry = getLowestProjectForTroopType(tree, TroopType.Infantry);
    const lHyper = lo(T.HyperDrive);
    const lMine = lo(T.ExtractorMine);
    const lCollector = lo(T.EnergyCollector);
    const lShields = lo(T.Shields);
    const lBuild = lo(T.ConstructionBuild);
    const lReactor = lo(T.Reactor);
    const lThrust = lo(T.EngineMainThrust);
    const lVector = lo(T.EngineVectoring);
    const l2Hyper = getSecondLowestProjectForTypeAny(rs, tree, T.HyperDrive);
    const l2Build = getSecondLowestProjectForTypeAny(rs, tree, T.ConstructionBuild);
    const lCommand = lo(T.ComputerCommandCenter);
    const lDocking = lo(T.StorageDockingBay);
    const lCommerce = lo(T.ComputerCommerceCenter);
    const lEnergyLab = lo(T.LabsEnergyLab);
    const lTroopStorage = lo(T.StorageTroop);
    const lCargo = lo(T.StorageCargo);
    const lResourceSensor = lo(T.SensorResourceProfileSensor);
    const lCargo2 = lo(T.StorageCargo);
    const lFuel = lo(T.StorageFuel);
    const lLifeSupport = lo(T.HabitationLifeSupport);
    const lHabModule = lo(T.HabitationHabModule);
    const lColonization = lo(T.HabitationColonization);
    let list2: number[] = [];
    let list3: number[] = [];
    let list4: number[] = [];
    const ids = generateResearchProjectIdListFromProjects;
    switch (industry) {
        case IndustryType.Weapon:
            list2 = targettedTypes.includes(T.WeaponGravityBeam)
                ? ids([lGravity])
                : targettedTypes.includes(T.WeaponRailGun)
                  ? ids([lRail])
                  : targettedTypes.includes(T.WeaponMissile)
                    ? ids([lMissile])
                    : targettedCategories.includes(C.WeaponBeam)
                      ? ids([lBeam])
                      : targettedCategories.includes(C.WeaponTorpedo)
                        ? ids([lTorpedo])
                        : !targettedCategories.includes(C.WeaponArea)
                          ? ids([lBeam])
                          : ids([lArea]);
            list3 = ids([lInfantry]);
            break;
        case IndustryType.Energy:
            list2 = ids([lHyper]);
            list3 = ids([lMine, lCollector, lShields, lBuild, lReactor, lThrust, lVector]);
            list4 = ids([l2Hyper, l2Build]);
            break;
        case IndustryType.HighTech:
            list2 = ids([lCommand, lDocking, lCommerce, lEnergyLab, lTroopStorage, lCargo, lResourceSensor, lCargo2, lFuel, lLifeSupport, lHabModule]);
            if (empire.pirateEmpireBaseHabitat === null) list3 = ids([lColonization]);
            break;
    }
    let flag = false;
    if (checkContainsAnyNodeId(projectsByIndustry, list2)) {
        researchNodeList = findNodesByIdsUnresearched(projectsByIndustry, list2);
        flag = true;
    } else if (checkContainsAnyNodeId(projectsByIndustry, list3)) {
        researchNodeList = findNodesByIdsUnresearched(projectsByIndustry, list3);
        flag = true;
    } else if (checkContainsAnyNodeId(projectsByIndustry, list4)) {
        researchNodeList = findNodesByIdsUnresearched(projectsByIndustry, list4);
        flag = true;
    }
    if (industry === IndustryType.Weapon && firstWeaponOrFighter(rs.researchedComponents) === null) {
        let byCategory = getProjectsByCategory(researchNodeList, C.Armor);
        if (byCategory.length > 0 && researchNodeList.length > byCategory.length) {
            for (let n = 0; n < byCategory.length; n++) listRemove(researchNodeList, byCategory[n]);
        }
        byCategory = getProjectsByCategory(researchNodeList8, C.Armor);
        if (byCategory.length > 0 && researchNodeList8.length > byCategory.length) {
            for (let n = 0; n < byCategory.length; n++) listRemove(researchNodeList8, byCategory[n]);
        }
    }
    if (raceSpecialComponent(rs, race) !== null || (raceAllowedComponents !== null && raceAllowedComponents.length > 0)) {
        researchNodeList = removeNonRaceSpecificProjectTypes(rs, race, tree, researchNodeList, optimizedDesignCategories, optimizedDesignTypes, raceAllowedComponents);
        researchNodeList8 = removeNonRaceSpecificProjectTypes(rs, race, tree, researchNodeList8, optimizedDesignCategories, optimizedDesignTypes, raceAllowedComponents);
    }
    if (empire.pirateEmpireBaseHabitat !== null) {
        stripProjectsByType(rs, researchNodeList, T.HabitationColonization);
        stripProjectsByType(rs, researchNodeList8, T.HabitationColonization);
        stripProjectsByAbility(researchNodeList, ResearchAbilityType.ColonizeHabitatType);
        stripProjectsByAbility(researchNodeList8, ResearchAbilityType.ColonizeHabitatType);
        stripProjectsByAbility(researchNodeList, ResearchAbilityType.Troop);
        stripProjectsByAbility(researchNodeList8, ResearchAbilityType.Troop);
    }
    let lowest = getLowestTechLevel(projectsByIndustry);
    const techLevel = (lowest + 3) | 0;
    if (researchNodeList !== null && researchNodeList.length > 0) researchNodeList = removeProjectsWithTechLevelHigherThan(researchNodeList, techLevel);
    if (researchNodeList8 !== null && researchNodeList8.length > 0) researchNodeList8 = removeProjectsWithTechLevelHigherThan(researchNodeList8, techLevel);
    if (researchNodeList8 !== null && researchNodeList8.length > 0) {
        const range = getTechLevelRange(researchNodeList8);
        lowest = range.lowest;
        if (lowest < range.highest) researchNodeList8 = getProjectsAtTechLevel(researchNodeList8, lowest);
    }
    stripProjectsAboveTechLevel(researchNodeList8, 99);
    stripProjectsAboveTechLevel(researchNodeList, 99);
    stripProjectsAboveTechLevel(projectsByIndustry, 99);
    let researchNode4: TechNode | null = null;
    if (!flag && researchNodeList8 !== null && researchNodeList8.length > 0 && researchNodeList.length === 0) researchNode4 = selectRandomLowestProject(galaxy.rnd, researchNodeList8);
    else if (researchNodeList !== null && researchNodeList.length > 0) researchNode4 = selectRandomLowestProject(galaxy.rnd, researchNodeList);
    else if (projectsByIndustry !== null && projectsByIndustry.length > 0) researchNode4 = selectRandomLowestProject(galaxy.rnd, projectsByIndustry);
    if (researchNode4 !== null && !researchNode4.isResearched && !researchQueue.includes(researchNode4)) researchQueue.push(researchNode4);
}

// ---------------------------------------------------------------------------
// PerformResearch
// ---------------------------------------------------------------------------

// Empire.3.cs PerformResearchProjects(timePassed, projects, researchPower, industry, allowResearchEvents) (1890).
function performResearchProjects(galaxy: Galaxy, empire: Empire, timePassed: number, projects: TechNode[] | null, researchPower: number, industry: IndustryType, allowResearchEvents: boolean): void {
    if (projects === null) return;
    if (empire.controlResearch && projects.length <= 0) selectNextResearchProject(galaxy, empire, industry, projects);
    let num = ((researchPower * timePassed) / REAL_SECONDS_IN_GALACTIC_YEAR) * galaxy.researchSpeedModifier;
    const num2 = calculateResearchOutputBonuses(empire, industry);
    num *= num2;
    const iterationCount = { value: 0 };
    while (conditionCheckLimit(num > 0.0, 50, iterationCount)) {
        if (projects === null || projects.length <= 0) break;
        const researchNode = projects[0];
        const progress = researchNode.progress;
        let num3 = Math.fround(num);
        if (researchNode.isRushing) num3 = Math.fround(num3 * 3);
        researchNode.progress = Math.fround(researchNode.progress + num3);
        if (researchNode.progress >= researchNode.cost) {
            doResearchBreakthrough(galaxy, empire, researchNode, true);
            num -= Math.fround(researchNode.cost - progress);
            if (empire.controlResearch && projects.length <= 0) selectNextResearchProject(galaxy, empire, industry, projects);
            if (!chanceNewScientist(galaxy, empire, researchNode)) chanceScientistPromotion(galaxy, empire, researchNode);
            if (researchNode.def.specialFunctionCode === 2 || researchNode.def.specialFunctionCode === 4) sendNewsBroadcastResearchBreakthrough(galaxy, empire, researchNode);
        } else {
            num = 0.0;
        }
    }
    if (!allowResearchEvents) return;
    let num4 = Math.max(4, csDoubleToInt(6000.0 / timePassed));
    if (projects !== null && projects.length > 0) {
        const num5 = Math.max(6000.0, Math.sqrt(projects[0].cost) * 10.0);
        num4 = Math.max(6, csDoubleToInt(num5 / timePassed));
    }
    let character: Character | null = null;
    let characterList: Character[] = [];
    const characters = getEmpireCharacters(empire);
    if (characters !== null) {
        characterList = getScientistsAtResearchStations(characters, industry);
        character = getFirstCharacterWithTrait(characterList, CharacterTraitType.Creative);
        let skillType = CharacterSkillType.ResearchEnergy;
        switch (industry) {
            case IndustryType.Energy: skillType = CharacterSkillType.ResearchEnergy; break;
            case IndustryType.HighTech: skillType = CharacterSkillType.ResearchHighTech; break;
            case IndustryType.Weapon: skillType = CharacterSkillType.ResearchWeapons; break;
        }
        if (character === null || character.skills.getSkillByType(skillType) === null) character = getFirstCharacterWithSkill(characterList, skillType);
        if (checkCharactersForTrait(characterList, CharacterRole.Scientist, CharacterTraitType.Creative)) num4 = Math.trunc(num4 / 2);
        else if (checkCharactersForTrait(characterList, CharacterRole.Scientist, CharacterTraitType.Methodical)) num4 = (num4 * 2) | 0;
    }
    if (galaxy.rnd.next(0, num4) !== 1) return;
    let researchNode2: TechNode | null = null;
    if (projects !== null && projects.length > 0) {
        researchNode2 = projects[0];
        if (researchNode2 !== null && researchNode2.isRushing) researchNode2 = null;
    }
    if (researchNode2 === null) return;
    const locationName = (c: Character): string => {
        const loc = c.location as { name?: string } | null;
        return loc !== null && loc.name !== undefined ? loc.name : '';
    };
    if (galaxy.rnd.next(0, 3) === 1) {
        const num6 = Math.fround(0.5 + galaxy.rnd.nextDouble() * 0.5);
        const num7 = Math.max(0, Math.min(researchNode2.progress, Math.fround(researchNode2.progress * num6)));
        researchNode2.progress = Math.fround(researchNode2.progress - num7);
        doResearchCharacterEvent(galaxy, CharacterEventType.CriticalResearchFailure, researchNode2, characterList);
        const text =
            character !== null
                ? gameText('Research Critical Failure SCIENTIST LOCATION RESEARCHPROJECT', character.name, locationName(character), researchNode2.def.name)
                : gameText('Research Critical Failure RESEARCHPROJECT', researchNode2.def.name);
        sendMessageToEmpire(empire, empire, EmpireMessageType.ResearchCriticalFailure, researchNode2, text);
        return;
    }
    researchNode2.isRushing = true;
    doResearchCharacterEvent(galaxy, CharacterEventType.CriticalResearchSuccess, researchNode2, characterList);
    const text2 =
        character !== null
            ? gameText('Research Critical Success SCIENTIST LOCATION RESEARCHPROJECT', character.name, locationName(character), researchNode2.def.name)
            : gameText('Research Critical Success RESEARCHPROJECT', researchNode2.def.name);
    sendMessageToEmpire(empire, empire, EmpireMessageType.ResearchCriticalBreakthrough, researchNode2, text2);
    chanceNewScientistCriticalSuccess(galaxy, empire, researchNode2);
}

/** Empire.3.cs 1756 PerformResearch(timePassed, allowResearchEvents). */
export function performResearch(galaxy: Galaxy, empire: Empire, timePassed: number, allowResearchEvents: boolean): void {
    const { researchEnergy, researchHighTech, researchWeapons } = calculateResearchTotal(empire);
    const research = empire.research;
    performResearchProjects(galaxy, empire, timePassed, research.researchQueueEnergy, researchEnergy, IndustryType.Energy, allowResearchEvents);
    performResearchProjects(galaxy, empire, timePassed, research.researchQueueHighTech, researchHighTech, IndustryType.HighTech, allowResearchEvents);
    performResearchProjects(galaxy, empire, timePassed, research.researchQueueWeapons, researchWeapons, IndustryType.Weapon, allowResearchEvents);
    research.update(empire.dominantRace);
    // BaconResearchSystem.DetermineComponentImprovements(this): empty body in the Bacon mod.
    reviewDesignComponentsAvailable(empire);
}

// ---------------------------------------------------------------------------
// Crash research
// ---------------------------------------------------------------------------

// Empire.3.cs ResolveEmpireRaceTendency (3005).
export function resolveEmpireRaceTendency(race: Race): number {
    // TODO(port) M4j: Race.AggressionLevel / CautionLevel periodic levels (Race.cs 350-377); base levels read here.
    if (race.aggression > race.caution && race.aggression > race.intelligence) return 3;
    if (race.caution > race.aggression && race.caution > race.intelligence) return 2;
    if (race.intelligence > race.caution && race.intelligence > race.aggression) return 1;
    return 0;
}

/** SelectResearchNodeToCrash's per-project type list: ResolveComponentTypesAll, or the ability stand-in type. */
function crashProjectTypes(rs: ResearchSystem, p: TechNode): ComponentType[] {
    const list = rs.componentTypesAll(p);
    if (list.length <= 0) {
        switch (resolveResearchAbilityType(p)) {
            case ResearchAbilityType.ColonizeHabitatType:
                list.push(ComponentType.HabitationColonization);
                break;
            case ResearchAbilityType.ConstructionSize:
                list.push(ComponentType.ConstructionBuild);
                break;
        }
    }
    return list;
}

// Empire.3.cs SelectResearchNodeToCrash (3023).
function selectResearchNodeToCrash(galaxy: Galaxy, rs: ResearchSystem, potentialCrashProjects: TechNode[] | null, targettedCategories: ComponentCategoryType[], targettedTypes: ComponentType[]): TechNode | null {
    if (potentialCrashProjects !== null) {
        if (targettedTypes !== null && targettedTypes.length > 0) {
            const num = galaxy.rnd.next(0, potentialCrashProjects.length);
            for (let i = num; i < potentialCrashProjects.length; i++) {
                const list = crashProjectTypes(rs, potentialCrashProjects[i]);
                if (list.length > 0 && typesIntersect(list, targettedTypes)) return potentialCrashProjects[i];
            }
            for (let j = 0; j < num; j++) {
                const list2 = crashProjectTypes(rs, potentialCrashProjects[j]);
                if (list2.length > 0 && typesIntersect(list2, targettedTypes)) return potentialCrashProjects[j];
            }
        }
        if (targettedCategories !== null && targettedCategories.length > 0) {
            const num2 = galaxy.rnd.next(0, potentialCrashProjects.length);
            for (let k = num2; k < potentialCrashProjects.length; k++) if (targettedCategories.includes(nodeCategory(potentialCrashProjects[k]))) return potentialCrashProjects[k];
            for (let l = 0; l < num2; l++) if (targettedCategories.includes(nodeCategory(potentialCrashProjects[l]))) return potentialCrashProjects[l];
        }
    }
    return null;
}

// Galaxy.6.cs CalculateCrashResearchProgramCost (848).
export function calculateCrashResearchProgramCost(empire: Empire, project: TechNode | null): number {
    void empire;
    let result = 0.0;
    if (project !== null) {
        result = Math.fround(project.cost - project.progress);
        result /= 4.0;
    }
    return result;
}

// Empire.3.cs InitiateCrashResearchProgram (3204).
export function initiateCrashResearchProgram(galaxy: Galaxy, empire: Empire, project: TechNode, cost: number): void {
    if (empire.stateMoney >= cost) {
        project.isRushing = true;
        empire.stateMoney -= cost;
        // Empire.3.cs 3210 (wired by M4s1).
        empire.pirateEconomy.performExpense(cost, PirateExpenseType.CrashResearch, galaxyStarDate(galaxy));
    }
}

/** Empire.3.cs 3093 DoCrashResearch. */
export function doCrashResearch(galaxy: Galaxy, empire: Empire): void {
    if (empire === galaxy.playerEmpire) return;
    const rs = empire.research;
    let researchNode: TechNode | null = null;
    const researchNodeList: TechNode[] = [];
    if (rs.researchQueueEnergy !== null && rs.researchQueueEnergy.length > 0 && !rs.researchQueueEnergy[0].isRushing) researchNodeList.push(rs.researchQueueEnergy[0]);
    if (rs.researchQueueHighTech !== null && rs.researchQueueHighTech.length > 0 && !rs.researchQueueHighTech[0].isRushing) researchNodeList.push(rs.researchQueueHighTech[0]);
    if (rs.researchQueueWeapons !== null && rs.researchQueueWeapons.length > 0 && !rs.researchQueueWeapons[0].isRushing) researchNodeList.push(rs.researchQueueWeapons[0]);
    if (researchNodeList.length <= 0 || galaxy.rnd.next(0, 2) !== 1) return;
    const { targettedCategories, targettedTypes, raceAllowedComponents } = determinePreferredEmpireResearchFocuses(galaxy, empire);
    for (let i = 0; i < raceAllowedComponents.length; i++) {
        const component = raceAllowedComponents[i];
        if (component !== null && !targettedTypes.includes(component.type)) targettedTypes.push(component.type);
    }
    researchNode = selectResearchNodeToCrash(galaxy, rs, researchNodeList, targettedCategories, targettedTypes);
    const num = indexBySpecialFunctionCode(researchNodeList, 2);
    if (num >= 0) researchNode = researchNodeList[num];
    if (researchNode === null) {
        // C# dereferences DominantRace without a null check.
        switch (resolveEmpireRaceTendency(empire.dominantRace!)) {
            case 0: {
                const index = galaxy.rnd.next(0, researchNodeList.length);
                researchNode = researchNodeList[index];
                if (galaxy.rnd.next(0, 2) === 1) researchNode = null;
                break;
            }
            case 1:
                targettedCategories.push(ComponentCategoryType.Reactor, ComponentCategoryType.Construction);
                targettedTypes.push(ComponentType.EngineMainThrust, ComponentType.EngineVectoring, ComponentType.ComputerTargetting, ComponentType.ComputerCountermeasures);
                researchNode = selectResearchNodeToCrash(galaxy, rs, researchNodeList, targettedCategories, targettedTypes);
                break;
            case 2:
                targettedCategories.push(ComponentCategoryType.Shields, ComponentCategoryType.Sensor, ComponentCategoryType.WeaponPointDefense);
                targettedTypes.push(ComponentType.Armor);
                researchNode = selectResearchNodeToCrash(galaxy, rs, researchNodeList, targettedCategories, targettedTypes);
                break;
            case 3:
                targettedCategories.push(ComponentCategoryType.HyperDrive, ComponentCategoryType.WeaponBeam, ComponentCategoryType.WeaponTorpedo, ComponentCategoryType.Fighter);
                researchNode = selectResearchNodeToCrash(galaxy, rs, researchNodeList, targettedCategories, targettedTypes);
                break;
        }
    }
    if (researchNode !== null) {
        const num2 = calculateCrashResearchProgramCost(empire, researchNode);
        let num3 = empire.stateMoney * 0.7;
        if (empire.difficultyLevel < 1.0) num3 /= empire.difficultyLevel;
        num3 = Math.min(num3, empire.stateMoney);
        if (num2 <= num3 && empire !== galaxy.playerEmpire && empire.initiateConstruction) initiateCrashResearchProgram(galaxy, empire, researchNode, num2);
    }
}
