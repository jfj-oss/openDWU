// M4u — character runtime (tasks/M4-plan.md §3.3 row M4u): the Empire character reviews run by the Empire / pirate
// ticks (Empire.1.cs 3615-3622, 4214-4220), leader changes, random character appearance, governor promotion and new
// ambassadors. Free functions, C# `this` first (plan §3.1 rule 2). The per-character model (Character, CharacterList
// helpers, DoCharacterEvent, ReviewCharacterLocation) is in characters.ts.
//
// Ported here:
//   Empire.6.cs 3990 CheckForCharacterAppearance, 3952-3988 CharactersCanGenerateAmount*, 4716 ReviewCharacterBonusesKnown,
//     4757 NextAllowableLeaderChangeDatePortion, 4769 ReviewCharacterLeaderChange, 4873/4878 PerformChangeLeader,
//     4927 ChangeLeader, 5084 ProcessLeaderChangeInfluence
//   Empire.7.cs 16 ReviewCharacterTraits, 319 ReviewDemoralizingCharacters, 348 ReviewCharacterLocations,
//     363 ApplyCharacterLocationBonusToOtherCharacters, 4461 CountEmpiresWeHaveMet
//   Empire.cs 2218 MaximumAgentCount, 2338 NextAllowableLeaderChangeDate
//   Empire.2.cs 2955-3095 Average* (per empire), Galaxy.cs 1791-1965 CalculateAverage* (galaxy)
//   Empire.3.cs 4122 CalculateAccurateAnnualCashflow, 4142 CalculatePirateCashflow / CalculatePirateExpenses,
//     823 CumulateFacilityValue1
//   Galaxy.2.cs 4784 ChanceColonyGovernorPromotion, 4819 ChanceNewAmbassador; Galaxy.1.cs 2737
//     DetermineCharacterEventIsPublic, 3756 DoCharacterEventLeader
//   Character.cs 4472 SendDeathMessage; CharacterEventList.cs 63 CountEventsByType, 75 GetDateOfMostRecentEventByType
//   Habitat.cs 1194 StartRebelling

import type { Galaxy } from './galaxy';
import type { Empire } from './empire';
import { Habitat as HabitatClass, type Habitat } from './types';
import {
    Character,
    CharacterEventType,
    CharacterRole,
    CharacterTraitType,
    IntelligenceMission,
    applyRandomCharacterSkillsTraits,
    countCharactersByRole,
    determineValidTraitsForRole,
    doCharacterEvent,
    doCharacterEventForList,
    generateAgentName,
    generateNewCharacter,
    getCharactersByRole,
    getEmpireCharacters,
    identifyPirateBase,
    intersectTraitLists,
    isBuiltObjectLocation,
    raceIntelligenceAgentAdditional,
    reviewCharacterLocation,
    stellarObjectCharacters,
    type CharacterEvent,
    type StellarObject,
} from './characters';
import { EmpireMessageType, resolveDescription, sendMessageToEmpire, sendMessageToEmpireWithTitle } from './messages';
import { gameText } from './colonyTick';
import { galaxyCurrentStarDate, PirateRelationType } from './pirateRelations';
import { netSort } from './netSort';
import { BuiltObjectRole } from './data/designSpecifications';
import { BuiltObjectSubRole } from './builtObjectTypes';
import { ColonyPopulationPolicy } from './data/policies';
import { RaceVictoryConditionType } from './data/races';
import { DiplomaticRelationType } from './diplomacy';
import { PlanetaryFacilityType } from './researchSystem';
import { findNewestCanBuild } from './designGeneration';
import { empireApprovalRating, empireWarWeariness } from './taxes';
import { annualTaxRevenue, habitatCorruption } from './forceStructure';
import { annualStateMaintenanceExcludingUnderConstruction } from './treasury';
import { calculateAccurateAnnualCashflow } from './construction/empireConstruction';
import { empireGovernmentAttributes } from './empire';
import { charactersCanGenerateAmountNonIntelligenceAgent } from './troops';
import { EventMessageType, sendEventMessageToEmpire, sendNewsBroadcast } from './events';
import { REAL_SECONDS_IN_GALACTIC_YEAR } from './tick/simTime';

/** long.MinValue as a JS number (CharacterEventList.GetDateOfMostRecentEventByType's "none" result, Empire.LastDisasterDate default). */
const LONG_MIN_VALUE = -9223372036854775808;
/** int.MinValue (PerformChangeLeader's "no override"). */
const INT_MIN_VALUE = -2147483648;

/** CharacterDeathType.cs (byte enum, declaration order). */
export enum CharacterDeathType {
    Undefined,
    GenericDeath,
    Assassination,
    ShipDestroyed,
    BaseDestroyed,
    ColonyInvasion,
    ColonyBombardment,
    Disaster,
    ShipCaptured,
    BaseCaptured,
    Dismissed,
}

// ---------------------------------------------------------------------------
// CharacterEventList / Galaxy helpers
// ---------------------------------------------------------------------------

/** CharacterEventList.cs 63 CountEventsByType(eventType). */
export function countEventsByType(list: CharacterEvent[], eventType: CharacterEventType): number {
    let num = 0;
    for (let index = 0; index < list.length; ++index) {
        const characterEvent = list[index];
        if (characterEvent != null && characterEvent.type === eventType) ++num;
    }
    return num;
}

/**
 * CharacterEventList.cs 75 GetDateOfMostRecentEventByType(eventType): `this.Sort(); this.Reverse();` — sorts the list in
 * place (List.Sort → netSort, CharacterEvent.CompareTo = StarDate.CompareTo) and reverses it, then returns the first match.
 */
export function getDateOfMostRecentEventByType(list: CharacterEvent[], eventType: CharacterEventType): number {
    netSort(list, (a, b) => (a.starDate < b.starDate ? -1 : a.starDate > b.starDate ? 1 : 0));
    list.reverse();
    for (let index = 0; index < list.length; ++index) {
        const characterEvent = list[index];
        if (characterEvent != null && characterEvent.type === eventType) return characterEvent.starDate;
    }
    return LONG_MIN_VALUE;
}

/** Galaxy.1.cs 2737 DetermineCharacterEventIsPublic(eventType). */
export function determineCharacterEventIsPublic(eventType: CharacterEventType): boolean {
    switch (eventType) {
        case CharacterEventType.TreatySigned:
        case CharacterEventType.WarStarted:
        case CharacterEventType.WarEnded:
        case CharacterEventType.CashNegative:
        case CharacterEventType.TroopComplete:
        case CharacterEventType.IntelligenceMissionSucceedEspionage:
        case CharacterEventType.IntelligenceMissionSucceedSabotage:
        case CharacterEventType.IntelligenceMissionFailEspionage:
        case CharacterEventType.IntelligenceMissionFailSabotage:
        case CharacterEventType.IntelligenceMissionInterceptEnemy:
        case CharacterEventType.IntelligenceAgentOursCaptured:
        case CharacterEventType.IntelligenceAgentRecruited:
        case CharacterEventType.ResearchAdvanceWeapons:
        case CharacterEventType.ResearchAdvanceEnergy:
        case CharacterEventType.ResearchAdvanceHighTech:
        case CharacterEventType.BuildColonyShip:
        case CharacterEventType.BuildMilitaryBase:
        case CharacterEventType.BuildSpaceport:
        case CharacterEventType.BuildResearchStationWeapons:
        case CharacterEventType.BuildResearchStationEnergy:
        case CharacterEventType.BuildResearchStationHighTech:
        case CharacterEventType.BuildMiningStation:
        case CharacterEventType.BuildResortBase:
        case CharacterEventType.BuildOtherBase:
        case CharacterEventType.BuildFacility:
        case CharacterEventType.BuildWonder:
        case CharacterEventType.SpaceBattle:
        case CharacterEventType.GroundInvasion:
        case CharacterEventType.TargetOfFailedAssassination:
        case CharacterEventType.AmbassadorAssignedToEmpire:
        case CharacterEventType.CriticalResearchSuccess:
        case CharacterEventType.CriticalResearchFailure:
        case CharacterEventType.CharacterStart:
        case CharacterEventType.CharacterTraitGain:
        case CharacterEventType.CharacterSkillGain:
        case CharacterEventType.CharacterSkillProgress:
        case CharacterEventType.CharacterTransferLocation:
        case CharacterEventType.Boarding:
        case CharacterEventType.Raid:
        case CharacterEventType.SmugglingSuccess:
        case CharacterEventType.SmugglingDetection:
            return true;
        default:
            return false;
    }
}

/** Galaxy.1.cs 3756 DoCharacterEventLeader(eventType, eventData, leaderEmpire): an empty source list, so DoCharacterEvent returns at once. */
export function doCharacterEventLeader(galaxy: Galaxy, eventType: CharacterEventType, eventData: unknown, leaderEmpire: Empire | null): void {
    const sourceCharacters: Character[] = [];
    doCharacterEventForList(galaxy, eventType, eventData, sourceCharacters, true, leaderEmpire);
}

/** CharacterList.cs 101 FindCharactersAtLocation(location). */
function findCharactersAtLocation(list: Character[], location: StellarObject | null): Character[] {
    const result: Character[] = [];
    for (let index = 0; index < list.length; ++index) {
        const character = list[index];
        if (character != null && character.location === location) result.push(character);
    }
    return result;
}

/** CharacterList.cs 297 GetFleetAdmiralsAndGenerals(fleet). */
function getFleetAdmiralsAndGenerals(list: Character[], fleet: unknown): Character[] {
    const result: Character[] = [];
    if (fleet != null) {
        for (let index = 0; index < list.length; ++index) {
            const character = list[index];
            if (character != null && (character.role === CharacterRole.FleetAdmiral || character.role === CharacterRole.TroopGeneral || character.role === CharacterRole.PirateLeader) && character.location !== null && isBuiltObjectLocation(character.location) && character.location.shipGroup === fleet) {
                result.push(character);
            }
        }
    }
    return result;
}

function removeFirst<T>(list: T[], item: T): void {
    const i = list.indexOf(item);
    if (i >= 0) list.splice(i, 1);
}

// ---------------------------------------------------------------------------
// Character.cs 4472 SendDeathMessage / Habitat.cs 1194 StartRebelling
// ---------------------------------------------------------------------------

/** Character.cs 4472 SendDeathMessage(deathType, galaxy). No Rnd. */
export function characterSendDeathMessage(galaxy: Galaxy | null, character: Character, deathType: CharacterDeathType): void {
    const empire = character.empire;
    if (empire === null || galaxy === null) return;
    let text = '';
    let text2 = '';
    const location = character.location;
    if (location !== null) text = location.name;
    const role = resolveDescription(CharacterRole, character.role);
    let title = gameText('Character Death Title', character.name);
    let text3 = gameText('Character Death Description', role, character.name, text);
    switch (deathType) {
        case CharacterDeathType.Assassination:
            title = gameText('Character Death Assassination Title', character.name);
            text3 = gameText('Character Death Assassination Description', role, character.name, text);
            break;
        case CharacterDeathType.ColonyBombardment:
            text3 = gameText('Character Death Bombardment Description', role, character.name, text);
            break;
        case CharacterDeathType.ColonyInvasion:
            text3 = gameText('Character Death Invasion Description', role, character.name, text);
            break;
        case CharacterDeathType.Disaster:
            text3 = gameText('Character Death Disaster Description', role, character.name, text);
            break;
        case CharacterDeathType.GenericDeath:
            text3 = gameText('Character Death Description', role, character.name, text);
            break;
        case CharacterDeathType.ShipDestroyed:
        case CharacterDeathType.ShipCaptured:
            if (location !== null && isBuiltObjectLocation(location)) {
                const builtObject = location;
                if (builtObject.parentHabitat !== null) text2 = builtObject.parentHabitat.name;
                else if (builtObject.nearestSystemStar !== null) text2 = builtObject.nearestSystemStar.name;
                else {
                    const habitat = galaxy.fastFindNearestSystem(builtObject.xpos, builtObject.ypos);
                    if (habitat !== null) text2 = habitat.name;
                }
            }
            text3 = deathType !== CharacterDeathType.ShipCaptured
                ? gameText('Character Death Ship Destroyed Description', role, character.name, text, text2)
                : gameText('Character Death Ship Captured Description', role, character.name, text, text2);
            break;
        case CharacterDeathType.BaseDestroyed:
            text3 = gameText('Character Death Base Destroyed Description', role, character.name, text);
            break;
        case CharacterDeathType.BaseCaptured:
            text3 = gameText('Character Death Base Captured Description', role, character.name, text);
            break;
        case CharacterDeathType.Dismissed:
            text3 = gameText('Character Death Dismiss Description', role, character.name, text);
            break;
    }
    if (deathType !== CharacterDeathType.Dismissed) text3 = text3 + '\n\n' + gameText('Character Death Great Loss', role);
    sendEventMessageToEmpire(empire, EventMessageType.CharacterEvent, title, text3, character, location);
    sendNewsBroadcast(empire, EventMessageType.CharacterEvent, character);
}

/** Habitat.cs 1194 StartRebelling. */
export function habitatStartRebelling(habitat: Habitat): void {
    if (!habitat.rebelling) {
        const description = gameText('Colony Rebelling', habitat.name);
        sendMessageToEmpire(habitat.owner, habitat.owner, EmpireMessageType.ColonyRebelling, habitat, description);
        habitat.rebelling = true;
    }
}

// ---------------------------------------------------------------------------
// Empire counts / limits
// ---------------------------------------------------------------------------

/** Empire.cs 2218 MaximumAgentCount. */
export function maximumAgentCount(empire: Empire): number {
    const race = empire.dominantRace;
    if (empire.pirateEmpireBaseHabitat === null) {
        let val = Math.trunc(empire.colonies.length / 3);
        val = Math.max(2, val);
        if (race !== null && !race.expanding) val = 6;
        val = Math.min(6, val);
        if (race !== null) val += raceIntelligenceAgentAdditional(race);
        return val;
    }
    let val2 = Math.trunc(Math.sqrt(empire.builtObjects.length) + 1.0);
    val2 = Math.max(1, val2);
    if (race !== null && !race.expanding) val2 = 6;
    val2 = Math.min(6, val2);
    if (race !== null) val2 += raceIntelligenceAgentAdditional(race);
    return val2;
}

/** Empire.6.cs 3958 CharactersCanGenerateAmountIntelligenceAgent(out agentCount). */
export function charactersCanGenerateAmountIntelligenceAgent(empire: Empire): { result: number; agentCount: number } {
    const agentCount = countCharactersByRole(getEmpireCharacters(empire), CharacterRole.IntelligenceAgent);
    const maxAgents = maximumAgentCount(empire);
    return { result: maxAgents - agentCount, agentCount };
}

/** Empire.7.cs 4461 CountEmpiresWeHaveMet. */
export function countEmpiresWeHaveMet(empire: Empire): number {
    let num = 0;
    const relations = empire.diplomaticRelations;
    if (relations != null) {
        for (let i = 0; i < relations.count; i++) {
            const diplomaticRelation = relations.at(i);
            if (diplomaticRelation.type !== DiplomaticRelationType.NotMet && diplomaticRelation.otherEmpire != null && diplomaticRelation.otherEmpire.active) num++;
        }
    }
    return num;
}

/**
 * Empire.3.cs 823 CumulateFacilityValue1(facilityType, mustBeCompleted): the Value1 total of the colonies' facilities of the type
 * (PlanetaryFacilityList.cs 243 CumulateValue1ByType / 254 CumulateValue1ByTypeCompleted: ConstructionProgress >= 1). No Rnd.
 * (M4z3: reached once a colony with facilities — e.g. the story's Ancient Guardians — reviews its characters.)
 */
export function cumulateFacilityValue1(empire: Empire, facilityType: PlanetaryFacilityType, mustBeCompleted: boolean): number {
    let num = 0;
    for (let i = 0; i < empire.colonies.length; i++) {
        const habitat = empire.colonies[i];
        if (habitat != null && habitat.facilities != null) {
            for (let index = 0; index < habitat.facilities.length; ++index) {
                const f = habitat.facilities[index];
                if (f.type === facilityType && (!mustBeCompleted || f.constructionProgress >= 1.0)) num += f.value1;
            }
        }
    }
    return num;
}

/** Empire.cs 2338 NextAllowableLeaderChangeDate. */
export function nextAllowableLeaderChangeDate(empire: Empire): number {
    let val = 1.0;
    const gov = empireGovernmentAttributes(empire);
    if (gov !== null) val = gov.leaderReplacementLikeliness;
    const num = 3.0 * (1.0 / Math.max(0.001, val));
    return empire.lastLeaderChangeDate + Math.trunc(REAL_SECONDS_IN_GALACTIC_YEAR * 1000.0 * num);
}

/** Empire.6.cs 4757 NextAllowableLeaderChangeDatePortion(portion). */
export function nextAllowableLeaderChangeDatePortion(empire: Empire, portion: number): number {
    const next = nextAllowableLeaderChangeDate(empire);
    const num = next - empire.lastLeaderChangeDate;
    if (num > 0 && portion > 0.0) {
        const num2 = Math.trunc(num * portion);
        return empire.lastLeaderChangeDate + num2;
    }
    return next;
}

// ---------------------------------------------------------------------------
// Cashflow and averages (ReviewCharacterTraits inputs)
// ---------------------------------------------------------------------------

// Empire.3.cs 4122 CalculateAccurateAnnualCashflow: construction/empireConstruction.ts (CalculatePirateCashflow: pirates/pirateAI.ts).

/** Empire.2.cs 2955 AverageStateCashPerPopulation. */
function averageStateCashPerPopulation(empire: Empire): number {
    return empire.stateMoney / Math.max(1, empire.totalPopulation);
}

/** Empire.2.cs 2960 AverageCashflowPerPopulation. */
function averageCashflowPerPopulation(galaxy: Galaxy, empire: Empire): number {
    const num = calculateAccurateAnnualCashflow(galaxy, empire);
    return num / Math.max(1, empire.totalPopulation);
}

/** Empire.2.cs 2966 AverageShipMaintenancePerPopulation. */
function averageShipMaintenancePerPopulation(empire: Empire): number {
    const m = annualStateMaintenanceExcludingUnderConstruction(empire);
    return m / Math.max(1, empire.totalPopulation);
}

/** Empire.2.cs 2978 / 2993 / 3008 Average{Spaceports,ResearchStations,MiningStations}PerColony. */
function averagePerColony(count: number, empire: Empire): number {
    const val = empire.colonies !== null ? empire.colonies.length : 0.01;
    return count / Math.max(1.0, val);
}

/** Empire.2.cs 3023 / 3047 Average{CapitalShips,ConstructionShips}PerColony. */
function averageSubRolePerColony(empire: Empire, subRole: BuiltObjectSubRole): number {
    let num2 = 0;
    for (let i = 0; i < empire.builtObjects.length; i++) {
        const builtObject = empire.builtObjects[i];
        if (builtObject != null && !builtObject.hasBeenDestroyed && builtObject.unbuiltComponentCount <= 0 && builtObject.subRole === subRole) num2++;
    }
    return averagePerColony(num2, empire);
}

/**
 * Empire.2.cs 3071 AverageHappiness: population-weighted running mean. `double num3 = totalAmount / Math.Max(1L, num2)` is
 * a long division (0 or 1) — ported as is.
 */
function averageHappiness(galaxy: Galaxy, empire: Empire): number {
    let num = 0.0;
    let num2 = 0;
    for (let i = 0; i < empire.colonies.length; i++) {
        const habitat = empire.colonies[i];
        if (habitat != null && habitat.population != null) {
            if (i > 0) {
                const totalAmount = habitat.population.totalAmount;
                num2 += totalAmount;
                const rating = empireApprovalRating(galaxy, habitat);
                const num3 = Math.trunc(totalAmount / Math.max(1, num2));
                num += (rating - num) * num3;
            } else {
                num2 = habitat.population.totalAmount;
                num = empireApprovalRating(galaxy, habitat);
            }
        }
    }
    return num;
}

/** Galaxy.cs 1791-1965 CalculateAverage*: mean over the active empires (C# divides by the count even when it is 0). */
function galaxyAverage(galaxy: Galaxy, f: (e: Empire) => number): number {
    let num = 0.0;
    let num2 = 0;
    for (let i = 0; i < galaxy.empires.length; i++) {
        const empire = galaxy.empires[i];
        if (empire != null && empire.active) {
            num += f(empire);
            num2++;
        }
    }
    return num / num2;
}

// ---------------------------------------------------------------------------
// Empire.6.cs 4716 ReviewCharacterBonusesKnown
// ---------------------------------------------------------------------------

/** Empire.6.cs 4716 ReviewCharacterBonusesKnown. No Rnd. */
export function reviewCharacterBonusesKnown(galaxy: Galaxy, empire: Empire): void {
    const characters = getEmpireCharacters(empire);
    if (characters == null) return;
    const currentStarDate = galaxyCurrentStarDate(galaxy);
    const num = currentStarDate - REAL_SECONDS_IN_GALACTIC_YEAR * 1000;
    for (let i = 0; i < characters.length; i++) {
        const character = characters[i];
        if (character == null || character.bonusesKnown) continue;
        switch (character.role) {
            case CharacterRole.Ambassador:
                if (character.location !== null && character.location instanceof HabitatClass) {
                    const habitat2 = character.location;
                    if (habitat2.empire !== character.empire && habitat2.empire !== null && habitat2.empire.capital !== null && habitat2.empire.capital === habitat2 && character.transferArrivalDate < num) {
                        character.bonusesKnown = true;
                    }
                }
                break;
            case CharacterRole.ColonyGovernor:
                if (character.location !== null && character.location instanceof HabitatClass) {
                    const habitat = character.location;
                    if (habitat.empire === character.empire && character.transferArrivalDate < num) {
                        character.bonusesKnown = true;
                    }
                }
                break;
        }
    }
}

// ---------------------------------------------------------------------------
// Empire.7.cs 16 ReviewCharacterTraits
// ---------------------------------------------------------------------------

/** Empire.7.cs 16 ReviewCharacterTraits. Rnd: Next(0, count); per bonuses-known character Next(0, 90) [+ Next(0, n) trait pick]. */
export function reviewCharacterTraits(galaxy: Galaxy, empire: Empire): void {
    const characters = getEmpireCharacters(empire);
    if (characters == null) return;
    const currentStarDate = galaxyCurrentStarDate(galaxy);
    const stateMoney = empire.stateMoney;
    const num = calculateAccurateAnnualCashflow(galaxy, empire);
    const num2 = averageHappiness(galaxy, empire);
    const num3 = averageStateCashPerPopulation(empire);
    const num4 = averageCashflowPerPopulation(galaxy, empire);
    const num5 = averageShipMaintenancePerPopulation(empire);
    const num6 = averagePerColony(empire.spacePorts !== null ? empire.spacePorts.length : 0.0, empire);
    const num7 = averagePerColony(empire.researchFacilities !== null ? empire.researchFacilities.length : 0.0, empire);
    const num8 = averageSubRolePerColony(empire, BuiltObjectSubRole.CapitalShip);
    const num9 = averagePerColony(empire.miningStations !== null ? empire.miningStations.length : 0.0, empire);
    const num10 = averageSubRolePerColony(empire, BuiltObjectSubRole.ConstructionShip);
    const num11 = galaxyAverage(galaxy, (e) => averageHappiness(galaxy, e));
    const num12 = galaxyAverage(galaxy, (e) => averageCashflowPerPopulation(galaxy, e));
    const num13 = galaxyAverage(galaxy, (e) => averageStateCashPerPopulation(e));
    const num14 = galaxyAverage(galaxy, (e) => averageShipMaintenancePerPopulation(e));
    const num15 = galaxyAverage(galaxy, (e) => averagePerColony(e.spacePorts !== null ? e.spacePorts.length : 0.0, e));
    const num16 = galaxyAverage(galaxy, (e) => averagePerColony(e.researchFacilities !== null ? e.researchFacilities.length : 0.0, e));
    const num17 = galaxyAverage(galaxy, (e) => averageSubRolePerColony(e, BuiltObjectSubRole.CapitalShip));
    const num18 = galaxyAverage(galaxy, (e) => averagePerColony(e.miningStations !== null ? e.miningStations.length : 0.0, e));
    const num19 = galaxyAverage(galaxy, (e) => averageSubRolePerColony(e, BuiltObjectSubRole.ConstructionShip));
    const num20 = galaxyAverage(galaxy, (e) => e.corruption);
    const characterList: Character[] = [];
    const num21 = galaxy.rnd.next(0, characters.length);
    for (let i = num21; i < characters.length; i++) characterList.push(characters[i]);
    for (let j = 0; j < num21; j++) characterList.push(characters[j]);
    const year = REAL_SECONDS_IN_GALACTIC_YEAR * 1000;
    for (let k = 0; k < characterList.length; k++) {
        const character = characterList[k];
        if (character == null || !character.bonusesKnown) continue;
        if (galaxy.rnd.next(0, 90) === 1) {
            const traits = determineValidTraitsForRole(character.role);
            let num22 = 0.0;
            let num23 = 0.0;
            let num24 = 0.0;
            let num25 = 0.0;
            let num26 = 0.0;
            let num27 = 0.0;
            let flag = true;
            let val = currentStarDate;
            let num28 = 0;
            let val2 = currentStarDate;
            let val3 = currentStarDate;
            switch (character.role) {
                case CharacterRole.PirateLeader:
                    num22 = num;
                    break;
                case CharacterRole.Leader:
                    num23 = num2;
                    num22 = num;
                    num24 = num4;
                    num25 = num3;
                    num26 = num5;
                    num27 = empire.corruption;
                    break;
                case CharacterRole.ColonyGovernor:
                    if (character.location !== null && character.location instanceof HabitatClass) {
                        const habitat2 = character.location;
                        if (habitat2 !== null && habitat2.empire === character.empire && habitat2.population != null) {
                            num23 = empireApprovalRating(galaxy, habitat2);
                            num22 = habitat2.annualTaxRevenue;
                            num24 = num22 / habitat2.population.totalAmount;
                            num25 = num3;
                            num26 = num5;
                            num27 = habitatCorruption(galaxy, habitat2);
                        }
                    }
                    val3 = getDateOfMostRecentEventByType(character.eventHistory, CharacterEventType.TroopComplete);
                    break;
                case CharacterRole.Ambassador:
                    flag = false;
                    if (character.location !== null && character.location instanceof HabitatClass) {
                        const habitat = character.location;
                        if (habitat !== null && habitat.empire !== null && habitat.empire !== character.empire && habitat.empire.capital !== null && habitat.empire.capital === habitat) flag = true;
                    }
                    break;
                case CharacterRole.FleetAdmiral:
                    val = getDateOfMostRecentEventByType(character.eventHistory, CharacterEventType.SpaceBattle);
                    num28 = countEventsByType(character.eventHistory, CharacterEventType.HyperjumpExit);
                    val2 = getDateOfMostRecentEventByType(character.eventHistory, CharacterEventType.HyperjumpExit);
                    break;
                case CharacterRole.ShipCaptain:
                    val = getDateOfMostRecentEventByType(character.eventHistory, CharacterEventType.SpaceBattle);
                    num28 = countEventsByType(character.eventHistory, CharacterEventType.HyperjumpExit);
                    val2 = getDateOfMostRecentEventByType(character.eventHistory, CharacterEventType.HyperjumpExit);
                    break;
                case CharacterRole.TroopGeneral:
                    val = getDateOfMostRecentEventByType(character.eventHistory, CharacterEventType.GroundInvasion);
                    val3 = getDateOfMostRecentEventByType(character.eventHistory, CharacterEventType.TroopComplete);
                    break;
            }
            const list: CharacterTraitType[] = [];
            if (empire.pirateEmpireBaseHabitat !== null) {
                if (stateMoney > 0.0 && num22 > 5000.0) list.push(CharacterTraitType.GoodAdministrator);
                else if (stateMoney < 0.0 && num22 < 0.0) list.push(CharacterTraitType.PoorAdministrator);
                if (Math.max(val, character.startDate) < currentStarDate - year * 3) list.push(CharacterTraitType.Drunk);
                if (num28 > 15 && Math.max(val2, character.startDate) > currentStarDate - Math.trunc(REAL_SECONDS_IN_GALACTIC_YEAR * 1000.0 * 0.5)) {
                    list.push(CharacterTraitType.SkilledNavigator);
                    list.push(CharacterTraitType.GoodSpaceLogistician);
                } else if (Math.max(val2, character.startDate) < currentStarDate - year * 2) {
                    list.push(CharacterTraitType.PoorNavigator);
                    list.push(CharacterTraitType.PoorSpaceLogistician);
                }
            } else {
                if (num23 > num11 * 1.5) list.push(CharacterTraitType.Famous);
                else if (num23 < num11 * 0.4) list.push(CharacterTraitType.Disliked);
                if (num25 > num13 * 1.3 && num24 > num12 * 1.3) list.push(CharacterTraitType.GoodAdministrator);
                else if (stateMoney < 0.0 && num22 < 0.0) list.push(CharacterTraitType.PoorAdministrator);
                if (num26 > num14 * 1.3 && num22 > 0.0) list.push(CharacterTraitType.BeanCounter);
                else if (num26 < num14 * 0.7 && num22 > 0.0) list.push(CharacterTraitType.Generous);
                if ((empire.designs != null && designsFindNewestCanBuild(empire, BuiltObjectSubRole.CapitalShip) && num8 < num17 * 0.33) || num6 < num15 * 0.4 || num7 < num16 * 0.33) {
                    list.push(CharacterTraitType.Luddite);
                }
                if (num10 < num19 * 0.5 || num9 < num18 * 0.5) list.push(CharacterTraitType.Environmentalist);
                else if (num10 > num19 * 1.5 || num9 > num18 * 1.5) list.push(CharacterTraitType.Industrialist);
                if (num5 < num14 * 0.4 && num22 > 0.0) list.push(CharacterTraitType.Disorganized);
                if (num27 > num20 * 1.5) {
                    list.push(CharacterTraitType.Measured);
                    list.push(CharacterTraitType.IntelligenceMeasured);
                    if (num27 > num20 * 2.2) {
                        list.push(CharacterTraitType.Addict);
                        list.push(CharacterTraitType.Corrupt);
                        list.push(CharacterTraitType.IntelligenceAddict);
                        list.push(CharacterTraitType.IntelligenceCorrupt);
                    }
                } else if (num27 < num20 * 0.5) {
                    list.push(CharacterTraitType.Sober);
                    list.push(CharacterTraitType.IntelligenceSober);
                }
                if (num23 > num11 * 1.7 && num25 > num13 * 1.7 && num22 > 0.0) {
                    list.push(CharacterTraitType.Uninhibited);
                    list.push(CharacterTraitType.Addict);
                    list.push(CharacterTraitType.IntelligenceUninhibited);
                    list.push(CharacterTraitType.IntelligenceAddict);
                } else if (num23 < num11 * 0.5) {
                    list.push(CharacterTraitType.Measured);
                    list.push(CharacterTraitType.Sober);
                    list.push(CharacterTraitType.PoorSpeaker);
                    list.push(CharacterTraitType.IntelligenceMeasured);
                    list.push(CharacterTraitType.IntelligenceSober);
                    list.push(CharacterTraitType.IntelligencePoorSpeaker);
                }
                const policyAll = empire.policy!.newColonyPopulationPolicyAllRaces;
                if (policyAll === ColonyPopulationPolicy.Assimilate) {
                    list.push(CharacterTraitType.Tolerant);
                    list.push(CharacterTraitType.IntelligenceTolerant);
                } else if (policyAll === ColonyPopulationPolicy.Enslave || policyAll === ColonyPopulationPolicy.Exterminate) {
                    list.push(CharacterTraitType.Xenophobic);
                    list.push(CharacterTraitType.IntelligenceXenophobic);
                }
                if (num25 > num13 * 2.2 && num22 > 0.0) {
                    list.push(CharacterTraitType.Corrupt);
                    list.push(CharacterTraitType.IntelligenceCorrupt);
                } else if (num27 < num20 * 0.7) {
                    list.push(CharacterTraitType.Lawful);
                    list.push(CharacterTraitType.IntelligenceLawful);
                }
                if (num23 > num11 * 3.0) list.push(CharacterTraitType.Lazy);
                if (!flag) list.push(CharacterTraitType.TongueTied);
                if (Math.max(val, character.startDate) < currentStarDate - year * 3) list.push(CharacterTraitType.Drunk);
                if (num28 > 15 && Math.max(val2, character.startDate) > currentStarDate - Math.trunc(REAL_SECONDS_IN_GALACTIC_YEAR * 1000.0 * 0.5)) {
                    list.push(CharacterTraitType.SkilledNavigator);
                    list.push(CharacterTraitType.GoodSpaceLogistician);
                } else if (Math.max(val2, character.startDate) < currentStarDate - year * 2) {
                    list.push(CharacterTraitType.PoorNavigator);
                    list.push(CharacterTraitType.PoorSpaceLogistician);
                }
                if (Math.max(val3, character.startDate) < currentStarDate - year * 2) {
                    list.push(CharacterTraitType.PoorRecruiter);
                    if (Math.max(val, character.startDate) < currentStarDate - year * 3) list.push(CharacterTraitType.PoorGroundLogistician);
                }
            }
            const list2 = intersectTraitLists(list, traits);
            if (list2 !== null && list2.length > 0) {
                const characterTraitType = list2[galaxy.rnd.next(0, list2.length)];
                if (character.addTrait(characterTraitType, false, galaxy)) {
                    const description = gameText('Character New Trait Review', resolveDescription(CharacterRole, character.role), character.name, resolveDescription(CharacterTraitType, characterTraitType));
                    sendMessageToEmpire(character.empire, character.empire, EmpireMessageType.CharacterSkillTraitChange, character, description);
                    // Empire.7.cs 282: `break` leaves the character loop.
                    break;
                }
            }
        }
        if (character.eventHistory.length <= 30) continue;
        const num29 = character.eventHistory.length - 30;
        const num30 = galaxyCurrentStarDate(galaxy) - year * 3;
        const characterEventList: CharacterEvent[] = [];
        for (let l = 0; l < character.eventHistory.length; l++) {
            if (characterEventList.length < num29) {
                const characterEvent = character.eventHistory[l];
                if (characterEvent != null && !determineCharacterEventIsPublic(characterEvent.type) && characterEvent.starDate < num30) characterEventList.push(characterEvent);
            }
        }
        for (let m = 0; m < characterEventList.length; m++) removeFirst(character.eventHistory, characterEventList[m]);
    }
}

/** DesignList.cs 140 FindNewestCanBuild(subRole) (empire = the list's first design's empire) != null. */
function designsFindNewestCanBuild(empire: Empire, subRole: BuiltObjectSubRole): boolean {
    const designs = empire.designs;
    let listEmpire: Empire | null = null;
    if (designs.length > 0 && designs[0] != null) listEmpire = designs[0].empire as Empire | null;
    return findNewestCanBuild(designs, subRole, listEmpire) !== null;
}

// ---------------------------------------------------------------------------
// Empire.7.cs 319 ReviewDemoralizingCharacters / 348 ReviewCharacterLocations
// ---------------------------------------------------------------------------

/** Empire.7.cs 319 ReviewDemoralizingCharacters. Rnd: Next(15, 30) per Demoralizing character. */
export function reviewDemoralizingCharacters(galaxy: Galaxy, empire: Empire): void {
    if (!empire.controlCharacterLocations) return;
    const characterList: Character[] = [];
    const characters = getEmpireCharacters(empire);
    if (characters != null) {
        for (let i = 0; i < characters.length; i++) {
            const character = characters[i];
            if (character.traits.includes(CharacterTraitType.Demoralizing)) characterList.push(character);
        }
    }
    for (let j = 0; j < characterList.length; j++) {
        const character2 = characterList[j];
        if (character2 != null && character2.getSkillLevelTotal() < galaxy.rnd.next(15, 30)) {
            characterSendDeathMessage(galaxy, character2, CharacterDeathType.Dismissed);
            character2.kill(galaxy);
        }
    }
}

/** Empire.7.cs 348 ReviewCharacterLocations. */
export function reviewCharacterLocations(galaxy: Galaxy, empire: Empire): void {
    const characters = getEmpireCharacters(empire);
    if (characters == null) return;
    for (let i = 0; i < characters.length; i++) {
        const character = characters[i];
        if (empire.controlCharacterLocations) reviewCharacterLocation(galaxy, empire, character, true);
        applyCharacterLocationBonusToOtherCharacters(galaxy, character);
    }
}

/** Empire.7.cs 363 ApplyCharacterLocationBonusToOtherCharacters(character). Rnd: Next(0, skills) per other character. */
export function applyCharacterLocationBonusToOtherCharacters(galaxy: Galaxy, character: Character | null): void {
    if (character === null || character.location === null || character.empire === null || getEmpireCharacters(character.empire) == null) return;
    const flag = character.traits.includes(CharacterTraitType.InspiringPresence);
    const flag2 = character.traits.includes(CharacterTraitType.Demoralizing);
    if (!flag && !flag2) return;
    const characterList: Character[] = [];
    const empireChars = getEmpireCharacters(character.empire);
    switch (character.role) {
        case CharacterRole.FleetAdmiral:
        case CharacterRole.TroopGeneral:
            if (isBuiltObjectLocation(character.location)) {
                const builtObject = character.location;
                if (builtObject !== null) {
                    if (builtObject.shipGroup != null) characterList.push(...getFleetAdmiralsAndGenerals(empireChars, builtObject.shipGroup));
                    else characterList.push(...(stellarObjectCharacters(builtObject) ?? []));
                }
            } else {
                characterList.push(...findCharactersAtLocation(empireChars, character.location));
            }
            break;
        default:
            characterList.push(...findCharactersAtLocation(empireChars, character.location));
            break;
    }
    if (characterList.includes(character)) removeFirst(characterList, character);
    for (let i = 0; i < characterList.length; i++) {
        const other = characterList[i];
        if (other.skills === null || other.skills.count <= 0) continue;
        const characterSkill = other.skills.items[galaxy.rnd.next(0, other.skills.count)];
        if (characterSkill != null) {
            if (flag) other.incrementSkillProgress(characterSkill.type, Math.fround(0.05), galaxy);
            else if (flag2) other.incrementSkillProgress(characterSkill.type, Math.fround(-0.05), galaxy);
        }
    }
}

// ---------------------------------------------------------------------------
// Empire.6.cs 3990 CheckForCharacterAppearance
// ---------------------------------------------------------------------------

/** Empire.6.cs 3990 CheckForCharacterAppearance. Rnd: Next(0, num17); up to 20 × NextDouble; GenerateNewCharacter draws. */
export function checkForCharacterAppearance(galaxy: Galaxy, empire: Empire): void {
    const characters = getEmpireCharacters(empire);
    const race = empire.dominantRace;
    if (characters == null || race === null || empire === galaxy.independentEmpire || galaxy.deferEventsForGameStart) return;
    // CharactersCanGenerateAmountNonIntelligenceAgent(out otherCharacterCount).
    const agentsNow = countCharactersByRole(characters, CharacterRole.IntelligenceAgent);
    const otherCharacterCount = characters.length - agentsNow;
    const num = charactersCanGenerateAmountNonIntelligenceAgent(empire);
    // CharactersCanGenerateAmountIntelligenceAgent(out agentCount): only agentCount (the current agent count) is used.
    const agentCount = charactersCanGenerateAmountIntelligenceAgent(empire).agentCount;
    if (num <= 0 && agentCount <= 0) return;
    let num2 = 11.5;
    let num3 = 1.0;
    let num4 = 1.0;
    let num5 = 2.0;
    let num6 = 2.0;
    let num7 = 1.0;
    let num8 = 1.0;
    let num9 = 3.5;
    let num10 = 1.0;
    if (race !== null) {
        num3 = empire.pirateEmpireBaseHabitat !== null ? num3 * race.characterRandomAppearanceChancePirateLeader : num3 * race.characterRandomAppearanceChanceLeader;
        num4 *= race.characterRandomAppearanceChanceAmbassador;
        num5 *= race.characterRandomAppearanceChanceGovernor;
        num6 *= race.characterRandomAppearanceChanceAdmiral;
        num7 *= race.characterRandomAppearanceChanceGeneral;
        num8 *= race.characterRandomAppearanceChanceScientist;
        num9 *= race.characterRandomAppearanceChanceIntelligenceAgent;
        num10 *= race.characterRandomAppearanceChanceShipCaptain;
    }
    const num11 = Math.min(2.0, 1.0 + cumulateFacilityValue1(empire, PlanetaryFacilityType.MilitaryAcademy, true) / 100.0);
    const num12 = Math.min(2.0, 1.0 + cumulateFacilityValue1(empire, PlanetaryFacilityType.NavalAcademy, true) / 100.0);
    const num13 = Math.min(2.0, 1.0 + cumulateFacilityValue1(empire, PlanetaryFacilityType.ScienceAcademy, true) / 100.0);
    const num14 = Math.min(2.0, 1.0 + cumulateFacilityValue1(empire, PlanetaryFacilityType.SpyAcademy, true) / 100.0);
    num7 *= num11;
    num6 *= num12;
    num8 *= num13;
    num9 *= num14;
    const num15 = empire.pirateEmpireBaseHabitat !== null ? countCharactersByRole(characters, CharacterRole.PirateLeader) : countCharactersByRole(characters, CharacterRole.Leader);
    if (num15 > 0) num3 = 0.0;
    if (countCharactersByRole(characters, CharacterRole.Ambassador) <= 0) num4 *= 1.3;
    if (countCharactersByRole(characters, CharacterRole.ColonyGovernor) <= 0) num5 *= 1.3;
    if (countCharactersByRole(characters, CharacterRole.FleetAdmiral) <= 0) num6 *= 1.3;
    if (countCharactersByRole(characters, CharacterRole.TroopGeneral) <= 0) num7 *= 1.3;
    if (countCharactersByRole(characters, CharacterRole.Scientist) <= 0) num8 *= 1.3;
    if (countCharactersByRole(characters, CharacterRole.IntelligenceAgent) <= 0) num9 *= 1.8;
    let flag = false;
    if (empire.diplomaticRelations != null) {
        for (let i = 0; i < empire.diplomaticRelations.count; i++) {
            if (empire.diplomaticRelations.at(i).type !== DiplomaticRelationType.NotMet) {
                flag = true;
                break;
            }
        }
    }
    if (empire.pirateRelations != null) {
        for (let j = 0; j < empire.pirateRelations.count; j++) {
            if (empire.pirateRelations.get(j).type !== PirateRelationType.None) {
                flag = true;
                break;
            }
        }
    }
    if (!flag) {
        num4 = 0.0;
        num9 = 0.0;
        num2 -= 4.5;
    }
    if (empire.builtObjects.filter((b) => b.role === BuiltObjectRole.Military).length <= 0) {
        num6 = 0.0;
        num2 -= 2.0;
    }
    if (empire.colonies !== null && empire.colonies.length < 2) {
        num5 = 0.0;
        num2 -= 2.0;
    }
    if (empire.pirateEmpireBaseHabitat !== null) {
        num3 = 0.0;
        num4 = 0.0;
        num5 = 0.0;
        num6 = 2.0;
        num7 = 0.0;
        num8 = 1.0;
        num9 = 5.0;
        num10 = 5.0;
        num6 *= race.characterRandomAppearanceChanceAdmiral;
        num8 *= race.characterRandomAppearanceChanceScientist;
        num9 *= race.characterRandomAppearanceChanceIntelligenceAgent;
        num10 *= race.characterRandomAppearanceChanceShipCaptain;
        num2 = 13.0;
    }
    const num16 = num3 + num4 + num5 + num6 + num7 + num8 + num9 + num10;
    let num17 = 25;
    num17 = Math.min(num17, Math.max(2, csDoubleToInt(num17 / (num16 / num2))));
    if (galaxy.rnd.next(0, num17) !== 1) return;
    let characterRole = CharacterRole.Undefined;
    let num18 = 0;
    const num19 = 20;
    while (characterRole === CharacterRole.Undefined && num18 < num19) {
        const num20 = 0.0;
        const num21 = num3;
        const num22 = num21;
        const num23 = num22 + num4;
        const num24 = num23;
        const num25 = num24 + num5;
        const num26 = num25;
        const num27 = num26 + num6;
        const num28 = num27;
        const num29 = num28 + num7;
        const num30 = num29;
        const num31 = num30 + num8;
        const num32 = num31;
        const num33 = num32 + num9;
        const num34 = num33;
        const num35 = num34 + num10;
        const num36 = galaxy.rnd.nextDouble() * num16;
        let num37 = 0;
        if (num36 >= num20 && num36 < num21) {
            characterRole = CharacterRole.Leader;
            num37 = 1;
        } else if (num36 >= num22 && num36 < num23) {
            characterRole = CharacterRole.Ambassador;
            num37 = Math.max(1, Math.trunc(countEmpiresWeHaveMet(empire) * 0.2));
        } else if (num36 >= num24 && num36 < num25) {
            characterRole = CharacterRole.ColonyGovernor;
            num37 = Math.max(1, Math.trunc(empire.colonies.length * 0.34));
        } else if (num36 >= num26 && num36 < num27) {
            characterRole = CharacterRole.FleetAdmiral;
            num37 = Math.max(1, Math.trunc(empire.colonies.length * 0.34));
        } else if (num36 >= num28 && num36 < num29) {
            characterRole = CharacterRole.TroopGeneral;
            num37 = Math.max(1, Math.trunc(empire.colonies.length * 0.34));
        } else if (num36 >= num30 && num36 < num31) {
            characterRole = CharacterRole.Scientist;
            num37 = Math.max(1, Math.trunc(empire.colonies.length * 0.25));
        } else if (num36 >= num32 && num36 < num33) {
            characterRole = CharacterRole.IntelligenceAgent;
            num37 = maximumAgentCount(empire);
        } else if (num36 >= num34 && num36 < num35) {
            characterRole = CharacterRole.ShipCaptain;
            num37 = Math.max(1, Math.trunc(Math.sqrt(empire.builtObjects.length) + 1.0));
        }
        const num38 = countCharactersByRole(characters, characterRole);
        if (num38 >= num37) {
            characterRole = CharacterRole.Undefined;
        } else {
            const num39 = num38 / otherCharacterCount;
            if (num39 > 0.4) characterRole = CharacterRole.Undefined;
        }
        num18++;
    }
    if (characterRole === CharacterRole.Undefined) return;
    const character = generateNewCharacter(galaxy, empire, characterRole, null, false).character;
    let stellarObject: StellarObject | null = empire.capital;
    switch (characterRole as CharacterRole) {
        case CharacterRole.Leader:
            stellarObject = empire.capital;
            break;
        case CharacterRole.Ambassador:
            stellarObject = empire.capital;
            break;
        case CharacterRole.ColonyGovernor:
            stellarObject = reviewCharacterLocation(galaxy, empire, character, false);
            break;
        case CharacterRole.FleetAdmiral:
            stellarObject = reviewCharacterLocation(galaxy, empire, character, false);
            break;
        case CharacterRole.TroopGeneral:
            stellarObject = reviewCharacterLocation(galaxy, empire, character, false);
            break;
        case CharacterRole.IntelligenceAgent: {
            if (empire.pirateEmpireBaseHabitat === null) {
                stellarObject = empire.capital;
                break;
            }
            const builtObject2 = identifyPirateBase(empire);
            if (builtObject2 !== null && !builtObject2.hasBeenDestroyed) {
                stellarObject = builtObject2;
                break;
            }
            for (let k = 0; k < empire.builtObjects.length; k++) {
                const builtObject3 = empire.builtObjects[k];
                if (builtObject3 != null && !builtObject3.hasBeenDestroyed && builtObject3.role === BuiltObjectRole.Base) {
                    stellarObject = builtObject3;
                    break;
                }
            }
            break;
        }
        case CharacterRole.Scientist:
            stellarObject = reviewCharacterLocation(galaxy, empire, character, false);
            break;
        case CharacterRole.PirateLeader: {
            const builtObject = identifyPirateBase(empire);
            if (builtObject !== null && !builtObject.hasBeenDestroyed) stellarObject = builtObject;
            break;
        }
        case CharacterRole.ShipCaptain:
            stellarObject = reviewCharacterLocation(galaxy, empire, character, false);
            break;
    }
    if (stellarObject === null) {
        if (empire.pirateEmpireBaseHabitat === null) {
            stellarObject = empire.capital;
        } else {
            if (empire.builtObjects.length > 0) stellarObject = empire.builtObjects[0];
            if (stellarObject === null && empire.privateBuiltObjects.length > 0) stellarObject = empire.privateBuiltObjects[0];
        }
    }
    if (stellarObject !== null) {
        character.activate(galaxy, empire, stellarObject);
        doCharacterEvent(galaxy, CharacterEventType.CharacterStart, character, character);
        if (character.role === CharacterRole.IntelligenceAgent) {
            doCharacterEventLeader(galaxy, CharacterEventType.IntelligenceAgentRecruited, character, empire);
            const intelligenceMission = new IntelligenceMission(empire, character, galaxyCurrentStarDate(galaxy));
            intelligenceMission.timeLength = Math.trunc((REAL_SECONDS_IN_GALACTIC_YEAR * 1000) / 4);
            character.mission = intelligenceMission;
        }
        const description = gameText('New Character Appeared Message ROLE NAME LOCATION', resolveDescription(CharacterRole, character.role), character.name, stellarObject.name);
        sendMessageToEmpire(empire, empire, EmpireMessageType.CharacterAppearance, character, description);
    } else {
        character.kill(galaxy);
    }
}

/** C# (int)double: truncation toward zero, int.MinValue for NaN / out of range (x64 cvttsd2si). */
function csDoubleToInt(v: number): number {
    if (!Number.isFinite(v) || v >= 2147483648 || v < -2147483648) return INT_MIN_VALUE;
    return Math.trunc(v);
}

// ---------------------------------------------------------------------------
// Empire.6.cs 4769 ReviewCharacterLeaderChange / PerformChangeLeader / ChangeLeader / ProcessLeaderChangeInfluence
// ---------------------------------------------------------------------------

function raceKeepLeaderAlive(empire: Empire): boolean {
    const race = empire.dominantRace!;
    return (race.victoryConditions ?? []).some((c) => c.type === RaceVictoryConditionType.KeepLeaderAlive);
}

/** Empire.6.cs 4769 ReviewCharacterLeaderChange(timePassed). Rnd: NextDouble (leader present) + PerformChangeLeader draws. */
export function reviewCharacterLeaderChange(galaxy: Galaxy, empire: Empire, timePassed: number): void {
    const characters = getEmpireCharacters(empire);
    if (characters == null || galaxy.deferEventsForGameStart) return;
    const gov = empireGovernmentAttributes(empire);
    if (empire.leader === null) {
        if (empire.dominantRace !== null && empire.dominantRace.victoryConditions != null && !raceKeepLeaderAlive(empire)) {
            let num = 0.0;
            let leaderChangeInfluence = 0.0;
            if (gov !== null) {
                leaderChangeInfluence = gov.leaderReplacementBoost;
                num = gov.leaderReplacementDisruptionLevel;
            }
            if (num > 0.0) empire.leaderChangeInfluence = num * -1.0;
            else empire.leaderChangeInfluence = leaderChangeInfluence;
            performChangeLeader(galaxy, empire, 2);
        }
        return;
    }
    if (empire.dominantRace === null || empire.dominantRace.victoryConditions == null || raceKeepLeaderAlive(empire) || empire.leaderChangeInfluence !== 0.0) return;
    let num2 = 1.0;
    let num3 = 0;
    if (gov !== null) {
        num2 = gov.leaderReplacementLikeliness;
        num3 = gov.leaderReplacementCharacterPool;
    }
    num2 *= 0.2;
    num2 *= timePassed / REAL_SECONDS_IN_GALACTIC_YEAR;
    switch (num3) {
        case 1: {
            const num9 = Math.max(0.1, empire.colonies.length * 0.34);
            const num10 = Math.max(0.1, countCharactersByRole(characters, CharacterRole.ColonyGovernor) / num9);
            num2 *= num10;
            break;
        }
        case 2: {
            const num6 = Math.max(0.1, empire.colonies.length * 0.4);
            const num7 = countCharactersByRole(characters, CharacterRole.FleetAdmiral) + countCharactersByRole(characters, CharacterRole.TroopGeneral);
            const num8 = Math.max(0.1, num7 / num6);
            num2 *= num8;
            break;
        }
        case 3: {
            const num4 = Math.max(0.1, empire.colonies.length * 0.34);
            const num5 = Math.max(0.1, countCharactersByRole(characters, CharacterRole.Scientist) / num4);
            num2 *= num5;
            break;
        }
    }
    const warWeariness = empireWarWeariness(empire);
    if (warWeariness > 0.0) {
        const num11 = 1.0 + warWeariness / 15.0;
        num2 *= num11;
    }
    const num12 = Math.max(1, empire.leader.getSkillLevelTotal());
    const num13 = Math.min(2.5, 50.0 / num12);
    num2 *= num13;
    if (empire.leader.traits.includes(CharacterTraitType.Demoralizing)) num2 *= 3.0;
    if (galaxy.rnd.nextDouble() * 2.0 < num2 && galaxyCurrentStarDate(galaxy) > nextAllowableLeaderChangeDate(empire)) {
        performChangeLeader(galaxy, empire);
        let num14 = 0.0;
        let leaderChangeInfluence2 = 0.0;
        if (gov !== null) {
            num14 = gov.leaderReplacementDisruptionLevel;
            leaderChangeInfluence2 = gov.leaderReplacementBoost;
        }
        if (num14 > 0.0) empire.leaderChangeInfluence = num14 * -1.0;
        else empire.leaderChangeInfluence = leaderChangeInfluence2;
    }
}

/** Empire.6.cs 4873 / 4878 PerformChangeLeader([changeTypeOverride]). Rnd: Next(0, 3) when the manner is -1, + ChangeLeader. */
export function performChangeLeader(galaxy: Galaxy, empire: Empire, changeTypeOverride = INT_MIN_VALUE): Character | null {
    const characters = getEmpireCharacters(empire);
    let characterList: Character[] = [];
    let characterTraitType = CharacterTraitType.Undefined;
    let num = 1;
    const gov = empireGovernmentAttributes(empire);
    if (gov !== null) {
        switch (gov.leaderReplacementTypicalManner) {
            case 0:
                num = 0;
                break;
            case 1:
                num = -1;
                break;
            case 2:
                num = 1;
                break;
        }
        switch (gov.leaderReplacementCharacterPool) {
            case 1:
                characterList = getCharactersByRole(characters, CharacterRole.ColonyGovernor);
                break;
            case 2:
                characterList = getCharactersByRole(characters, CharacterRole.FleetAdmiral);
                characterList.push(...getCharactersByRole(characters, CharacterRole.TroopGeneral));
                break;
            case 3:
                characterList = getCharactersByRole(characters, CharacterRole.Scientist);
                break;
        }
    }
    if (num === -1 && galaxy.rnd.next(0, 3) === 1) characterTraitType = CharacterTraitType.Courageous;
    if (empire.pirateEmpireBaseHabitat !== null) {
        characterList = getCharactersByRole(characters, CharacterRole.FleetAdmiral);
        characterList.push(...getCharactersByRole(characters, CharacterRole.ShipCaptain));
        num = -1;
    }
    if (changeTypeOverride !== INT_MIN_VALUE) num = changeTypeOverride;
    const character = changeLeader(galaxy, empire, characterList, num);
    if (character !== null && characterTraitType !== CharacterTraitType.Undefined) character.addTrait(characterTraitType, true, null);
    empire.lastLeaderChangeDate = galaxyCurrentStarDate(galaxy);
    return character;
}

/** Empire.6.cs 4927 ChangeLeader(newLeaderPool, changeType). Rnd: Next(0, pool) or GenerateNewCharacter draws. */
export function changeLeader(galaxy: Galaxy, empire: Empire, newLeaderPool: Character[] | null, changeType: number): Character | null {
    const leader = empire.leader;
    let text = '';
    if (leader !== null) text = leader.name;
    if (empire.leader !== null) {
        empire.leader.kill(galaxy);
        empire.leader = null;
    }
    if (newLeaderPool !== null && newLeaderPool.length > 0) {
        const character = newLeaderPool[galaxy.rnd.next(0, newLeaderPool.length)];
        const role = character.role;
        if (empire.pirateEmpireBaseHabitat !== null) {
            const builtObject = identifyPirateBase(empire);
            if (builtObject !== null) character.completeLocationTransfer(builtObject, galaxy);
            else if (empire.builtObjects.length > 0) character.completeLocationTransfer(empire.builtObjects[0], galaxy);
            else if (empire.privateBuiltObjects.length > 0) character.completeLocationTransfer(empire.privateBuiltObjects[0], galaxy);
        } else {
            character.completeLocationTransfer(empire.capital, galaxy);
        }
        if (empire.pirateEmpireBaseHabitat === null || role !== CharacterRole.FleetAdmiral) character.removeAllSkillsAndTraits();
        if (empire.pirateEmpireBaseHabitat !== null) character.role = CharacterRole.PirateLeader;
        else character.role = CharacterRole.Leader;
        applyRandomCharacterSkillsTraits(galaxy, empire, character, true);
        character.bonusesKnown = true;
        empire.leader = character;
        const roleText = resolveDescription(CharacterRole, role);
        switch (changeType) {
            case -1:
                sendEventMessageToEmpire(empire, EventMessageType.LeaderChange, gameText('Leader Change Coup Title'), gameText('Leader Change Coup From Existing', text, character.name, roleText), character, empire.capital);
                break;
            case 0:
                sendEventMessageToEmpire(empire, EventMessageType.LeaderChange, gameText('Leader Change Replaced Title'), gameText('Leader Change Replaced From Existing', text, character.name, roleText), character, empire.capital);
                break;
            case 1:
                sendEventMessageToEmpire(empire, EventMessageType.LeaderChange, gameText('Leader Change Election Title'), gameText('Leader Change Election From Existing', text, character.name, roleText), character, empire.capital);
                break;
            default:
                sendEventMessageToEmpire(empire, EventMessageType.LeaderChange, gameText('Leader New Title'), gameText('Leader New From Existing', character.name, roleText), character, empire.capital);
                break;
        }
        return character;
    }
    let character2: Character | null = null;
    if (empire.pirateEmpireBaseHabitat !== null) {
        const builtObject2 = identifyPirateBase(empire);
        if (builtObject2 !== null) character2 = generateNewCharacter(galaxy, empire, CharacterRole.PirateLeader, builtObject2).character;
        else if (empire.builtObjects.length > 0) character2 = generateNewCharacter(galaxy, empire, CharacterRole.PirateLeader, empire.builtObjects[0]).character;
        else if (empire.privateBuiltObjects.length > 0) character2 = generateNewCharacter(galaxy, empire, CharacterRole.PirateLeader, empire.privateBuiltObjects[0]).character;
    } else {
        character2 = generateNewCharacter(galaxy, empire, CharacterRole.Leader, empire.capital).character;
    }
    if (character2 !== null) {
        let num = 0;
        while (character2.name === text && num < 20) {
            character2.name = generateAgentName(galaxy, empire);
            num++;
        }
        empire.leader = character2;
        switch (changeType) {
            case -1:
                sendEventMessageToEmpire(empire, EventMessageType.LeaderChange, gameText('Leader Change Coup Title'), gameText('Leader Change Coup', text, character2.name), character2, empire.capital);
                break;
            case 0:
                sendEventMessageToEmpire(empire, EventMessageType.LeaderChange, gameText('Leader Change Replaced Title'), gameText('Leader Change Replaced', text, character2.name), character2, empire.capital);
                break;
            case 1:
                sendEventMessageToEmpire(empire, EventMessageType.LeaderChange, gameText('Leader Change Election Title'), gameText('Leader Change Election', text, character2.name), character2, empire.capital);
                break;
            default:
                sendEventMessageToEmpire(empire, EventMessageType.LeaderChange, gameText('Leader New Title'), gameText('Leader New', character2.name), character2, empire.capital);
                break;
        }
        return character2;
    }
    return null;
}

/** Empire.6.cs 5084 ProcessLeaderChangeInfluence(timePassed). Rnd while the influence is negative. */
export function processLeaderChangeInfluence(galaxy: Galaxy, empire: Empire, timePassed: number): void {
    const num = timePassed / (REAL_SECONDS_IN_GALACTIC_YEAR / 2.0);
    if (empire.leaderChangeInfluence < 0.0) {
        if (empire.pirateEmpireBaseHabitat === null && empire.colonies !== null && empire.colonies.length > 1) {
            for (let i = 0; i < empire.colonies.length; i++) {
                const habitat = empire.colonies[i];
                if (habitat != null && !habitat.rebelling && galaxy.rnd.nextDouble() * 2.0 < Math.abs(empire.leaderChangeInfluence) && galaxy.rnd.next(0, 2) === 1) {
                    habitat.happinessModifier = Math.fround(-15.0 + galaxy.rnd.nextDouble() * -15.0);
                    habitatStartRebelling(habitat);
                    const description = gameText('Leader Change Disruption Colony Rebel', habitat.name);
                    sendMessageToEmpire(empire, empire, EmpireMessageType.ColonyRebelling, habitat, description);
                }
            }
        }
        const num2 = empire.lastLeaderChangeDate + Math.trunc(REAL_SECONDS_IN_GALACTIC_YEAR * 1000.0 * 0.5);
        if (galaxyCurrentStarDate(galaxy) > num2 && galaxy.rnd.nextDouble() * 10.0 < Math.abs(empire.leaderChangeInfluence)) {
            changeLeader(galaxy, empire, null, -1);
        }
        empire.leaderChangeInfluence += num;
        if (empire.leaderChangeInfluence >= 0.0) empire.leaderChangeInfluence = 0.0;
    } else {
        if (!(empire.leaderChangeInfluence > 0.0)) return;
        if (empire.warWearinessRaw > 0.0) {
            const num3 = (timePassed / REAL_SECONDS_IN_GALACTIC_YEAR) * 15.0 * empire.leaderChangeInfluence;
            empire.warWearinessRaw -= num3;
            if (empire.warWearinessRaw < 0.0) empire.warWearinessRaw = 0.0;
        }
        empire.leaderChangeInfluence -= num;
        if (empire.leaderChangeInfluence <= 0.0) empire.leaderChangeInfluence = 0.0;
    }
}

// ---------------------------------------------------------------------------
// Galaxy.2.cs 4784 ChanceColonyGovernorPromotion / 4819 ChanceNewAmbassador
// ---------------------------------------------------------------------------

/** Galaxy.2.cs 4784 ChanceColonyGovernorPromotion(empire, colony): the picked governor is unused; always false. */
export function chanceColonyGovernorPromotion(galaxy: Galaxy, empire: Empire | null, colony: Habitat | null): boolean {
    if (empire !== null && colony !== null && stellarObjectCharacters(colony) !== null && galaxy.rnd.next(0, 40) === 1) {
        const charactersByRole = getCharactersByRole(stellarObjectCharacters(colony)!, CharacterRole.ColonyGovernor);
        if (charactersByRole.length > 0) {
            const index = galaxy.rnd.next(0, charactersByRole.length);
            void charactersByRole[index];
        }
    }
    return false;
}

/** Galaxy.2.cs 4819 ChanceNewAmbassador(empire, newRelationType, otherEmpire). Rnd: Next(0, num) only when num < 100. */
export function chanceNewAmbassador(galaxy: Galaxy, empire: Empire | null, newRelationType: DiplomaticRelationType, otherEmpire: Empire | null): boolean {
    if (empire !== null && otherEmpire !== null) {
        let num = 1000;
        switch (newRelationType) {
            case DiplomaticRelationType.FreeTradeAgreement:
                num = 20;
                break;
            case DiplomaticRelationType.Protectorate:
                num = 10;
                break;
            case DiplomaticRelationType.MutualDefensePact:
                num = 6;
                break;
        }
        if (empire.dominantRace !== null) num = Math.max(2, csDoubleToInt(num / empire.dominantRace.characterRandomAppearanceChanceAmbassador));
        if (num < 100 && galaxy.rnd.next(0, num) === 1 && charactersCanGenerateAmountNonIntelligenceAgent(empire) > 0 && otherEmpire !== null && otherEmpire.capital !== null) {
            const character = generateNewCharacter(galaxy, empire, CharacterRole.Ambassador, otherEmpire.capital).character;
            const title = gameText('New Character Event Title', resolveDescription(CharacterRole, character.role));
            const description = gameText('New Character Event Ambassador', resolveDescription(DiplomaticRelationType as unknown as Record<number, string>, newRelationType), otherEmpire.name, character.name);
            sendMessageToEmpireWithTitle(empire, empire, EmpireMessageType.CharacterAppearance, character, description, title);
            return true;
        }
    }
    return false;
}
