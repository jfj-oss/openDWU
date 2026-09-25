// M4u — Empire random / empire / race events and disasters (tasks/M4-plan.md §3.3 row M4u), run from the Empire huge
// block (Empire.1.cs 3708-3726: ResetRaceEvents, ReviewRandomEvents, ReviewEmpireEvents) and the pirate huge block
// (Empire.1.cs 4267: PirateReviewRandomEvents). Free functions, C# `this` first (plan §3.1 rule 2); the tick entry
// points in events.ts delegate here.
//
// Ported here:
//   Empire.1.cs 1092/1102 InitiateEmpireSplit, 1204 RandomEventPirateControlledColonyGivesShip,
//     1300/1322 RandomEventRareResourceIntercepted, 1358 RandomEventUncoverKnownLocations,
//     1535 ExposePlanetDestroyerConstruction, 1590 RandomEventUncoverPirateAttackFunding,
//     1637/1666 EmpireEventRogueFleetDefects, 1698 DefectFleet, 1731 PirateReviewRandomEvents, 1758 ReviewRandomEvents,
//     1788 RandomEventRestrictedZoneRevealed, 1792/1799 EmpireEventPlague, 1867/1888 EmpireEventColonyResourceDepletion,
//     1912/1954 EmpireEventColonyResourceAppearance, 1988 EmpireEventEconomicCrisis,
//     1999/2031 EmpireEventColonyNaturalDisaster, 2094 ResetRaceEvents, 2130 DoRaceEvent, 2149 InitiateRaceEvent,
//     2800 SetRaceEventForAllColonies, 2811 ReviewEmpireEvents, 2883 SplinterEmpire, 3031 ConsiderTakeoverOfBuiltObject
//   Empire.7.cs 4120 CalculateRelativeEmpireMilitaryStrength, 4342-4398 DetermineEmpires*; Empire.9.cs 1388
//     FindNearestResortBase; Empire.cs 1799 ColonyApprovalAverage; Galaxy.cs 1181 TotalStateMoneyInGalaxy;
//   Galaxy.4.cs 3248 ResolveValidResourcesForHabitatTypeExcludeManufactured; Galaxy.3.cs 683
//     FastFindNearestLongRangeScanner; Galaxy.7.cs 1319 FindNearestBuiltObject(x, y, empire, subRole, fullyFunctional),
//     1496/1508/1532 ResolveSectorDescription / ResolveSector; HabitatList.cs GetRandomHabitatPopulationAnotherRace,
//     GetRandomHabitatPopulationBelowThreshold, GetHabitatsWithResource; CharacterList.cs 340 GetCharactersWithTraits;
//   ResearchSystem.cs 764-816 ResolveNextProjects, 975 DetermineLowestNextProject; Race.cs 1075-1083 RaceEvents.

import type { Galaxy } from './galaxy';
import type { Empire } from './empire';
import type { BuiltObject } from './builtObject';
import type { Habitat } from './types';
import type { Race } from './data/races';
import { HabitatType, Habitat as HabitatClass } from './types';
import { Creature as CreatureClass, type Creature } from './creature';
import { Empire as EmpireClass, empireGovernmentAttributes } from './empire';
import { PreWarpProgressEventType } from './exploration';
import { GalaxyLocationType, type GalaxyLocation } from './galaxyLocation';
import { BuiltObjectSubRole } from './builtObjectTypes';
import { gameText, raceChangePeriodActive } from './colonyTick';
import { galaxyStarDate, REAL_SECONDS_IN_GALACTIC_YEAR } from './tick/simTime';
import { EmpireMessageType, resolveDescription, sendMessageToEmpire } from './messages';
import { DiplomaticRelationType, obtainDiplomaticRelation, obtainEmpireEvaluation, empireEvaluationsOf, FIRST_CONTACT_PENALTY_START_AMOUNT } from './diplomacy';
import { obtainPirateRelation, PirateRelationType, changePirateEvaluation, PirateRelationEvaluationType } from './pirateRelations';
import { EmpireActivityType } from './pirates/empireActivity';
import { militaryPotency } from './treasury';
import { calculateRelativeEmpireSize, checkEmpireSuppliesRestrictedResources } from './diplomacyTick';
import { calculateRacialReputationConcern, empireApprovalRating } from './taxes';
import { fastFindNearestSpacePort } from './stationPlacement';
import { Cargo, ResourceRef } from './cargo';
import { findNewestCanBuild } from './designGeneration';
import { generateBuiltObjectFromDesign, doEmpireEncounter } from './exploration';
import { BuiltObject as BuiltObjectClass, determineBuiltObjectIsState } from './builtObject';
import { giveTerritoryMap, addLocationHint } from './tradeItems';
import { habitatGenerateNewTroop, identifyStrongestRaceAttackTroop } from './troops';
import { TroopType } from './cargo';
import {
    Character,
    CharacterEventType,
    CharacterRole,
    CharacterTraitType,
    determineValidTraitsForRole,
    generateNewCharacter,
    getCharactersByRole,
    getEmpireCharacters,
    stellarObjectCharacters,
    type StellarObject,
} from './characters';
import { BuiltObjectMissionType, type BuiltObjectMission } from './missions/mission';
import { nextAllowableLeaderChangeDate } from './characterRuntime';
import { doCharacterEventRuntime, EventMessageType, DisasterEventType, RaceEventType, sendEventMessageToEmpire, sendNewsBroadcast, galaxyPlagues } from './events';
import { empireShipGroups, forceCompleteMission, type ShipGroup } from './fleets/shipGroup';
import { compareShipGroups, selectFleetBase } from './fleets/shipGroupTasks';
import { takeOwnershipOfBuiltObject } from './combat/ownership';
import { netSort } from './netSort';
import { nodeCategory, nodeIndustry, type TechNode } from './researchSystem';
import { removeNonRaceSpecificProjectTypes, resolveRaceSpecificComponents } from './researchTick';
import { IndustryType } from './types';
import { ColonyPopulationPolicy, ComponentCategoryType } from './data/policies';

// ---------------------------------------------------------------------------
// Race / list / galaxy helpers
// ---------------------------------------------------------------------------

/** RaceEvent.cs (Type, Frequency). */
export interface RaceEvent {
    type: RaceEventType;
    frequency: number;
}

const raceEventsCache = new WeakMap<Race, RaceEvent[]>();

/**
 * Race.RaceEvents (Race.cs 1075-1083): RaceEvent1Type/Frequency then RaceEvent2Type/Frequency, each added when the type is
 * defined and not Undefined. Type: (byte)ParseIntValue (int.TryParse, 0 on failure) + Enum.IsDefined; Frequency:
 * ParseDoubleValue (default 1.0). Read from Race.extra (races.ts keeps unknown keys there).
 */
export function raceEvents(race: Race): RaceEvent[] {
    let list = raceEventsCache.get(race);
    if (list !== undefined) return list;
    list = [];
    const parseType = (raw: string | undefined): RaceEventType => {
        if (raw === undefined) return RaceEventType.Undefined;
        const t = raw.trim();
        const n = /^[+-]?\d+$/.test(t) ? parseInt(t, 10) : 0;
        const b = ((n % 256) + 256) % 256;
        return RaceEventType[b] !== undefined ? (b as RaceEventType) : RaceEventType.Undefined;
    };
    const parseFreq = (raw: string | undefined): number => (raw === undefined ? 1.0 : parseFloat(raw.trim()));
    const t1 = parseType(race.extra['RaceEvent1Type']);
    const t2 = parseType(race.extra['RaceEvent2Type']);
    const f1 = parseFreq(race.extra['RaceEvent1Frequency']);
    const f2 = parseFreq(race.extra['RaceEvent2Frequency']);
    if (t1 !== RaceEventType.Undefined) list.push({ type: t1, frequency: f1 });
    if (t2 !== RaceEventType.Undefined) list.push({ type: t2, frequency: f2 });
    raceEventsCache.set(race, list);
    return list;
}

/** RaceEventList.ContainsEventType(type). */
export function raceEventsContainsEventType(race: Race, type: RaceEventType): boolean {
    return raceEvents(race).some((e) => e != null && e.type === type);
}

/** Empire.7.cs 4120 CalculateRelativeEmpireMilitaryStrength. No Rnd. */
export function calculateRelativeEmpireMilitaryStrength(galaxy: Galaxy, empire: Empire): number {
    let num = 0.0;
    for (let i = 0; i < galaxy.empires.length; i++) {
        const empire2 = galaxy.empires[i];
        if (empire2 !== empire) num += Math.max(1, militaryPotency(galaxy, empire2));
    }
    const num2 = num / (galaxy.empires.length - 1);
    return Math.max(1, militaryPotency(galaxy, empire)) / num2;
}

/** Empire.cs 1799 ColonyApprovalAverage. */
export function colonyApprovalAverage(galaxy: Galaxy, empire: Empire): number {
    let num = 0.0;
    for (let i = 0; i < empire.colonies.length; i++) num += empireApprovalRating(galaxy, empire.colonies[i]);
    return num / empire.colonies.length;
}

/** Galaxy.cs 1181 TotalStateMoneyInGalaxy. */
export function totalStateMoneyInGalaxy(galaxy: Galaxy): number {
    let num = 0.0;
    for (let i = 0; i < galaxy.empires.length; i++) {
        const empire = galaxy.empires[i];
        if (empire.pirateEmpireBaseHabitat === null && empire !== galaxy.independentEmpire && empire.active) num += empire.stateMoney;
    }
    return num;
}

/** Galaxy.4.cs 3248 ResolveValidResourcesForHabitatTypeExcludeManufactured(habitatType, allowSuperLuxuryResources). No Rnd. */
export function resolveValidResourcesForHabitatTypeExcludeManufactured(galaxy: Galaxy, habitatType: HabitatType, allowSuperLuxuryResources: boolean): number[] {
    const list: number[] = [];
    const resources = galaxy.resourceSystem.resources;
    for (let i = 0; i < resources.length; i++) {
        const resourceDefinition = resources[i];
        if (resourceDefinition == null || (!allowSuperLuxuryResources && resourceDefinition.superLuxuryBonusAmount > 0) || resourceDefinition.colonyManufacturingLevel > 0 || resourceDefinition.distributions == null || resourceDefinition.distributions.length <= 0) continue;
        for (let j = 0; j < resourceDefinition.distributions.length; j++) {
            const resourcePrevalence = resourceDefinition.distributions[j];
            // ResourcePrevalence.HabitatType (ResourceSystem.cs 588: SubType → Galaxy.ResolveHabitatTypeByIndexIncludeGasClouds).
            if (resourcePrevalence != null && galaxy['resolveHabitatTypeByIndexIncludeGasClouds'](resourcePrevalence.subType) === habitatType && !list.includes(resourceDefinition.resourceId)) list.push(resourceDefinition.resourceId);
        }
    }
    return list;
}

/** Galaxy.7.cs 1532 ResolveSector(x, y) → 1508 ResolveSectorDescription(sector): column letter + row number. */
export function resolveSectorDescription(galaxy: Galaxy, x: number, y: number): string {
    let x2 = Math.trunc(Math.trunc(x) / galaxy.sectorSize);
    let y2 = Math.trunc(Math.trunc(y) / galaxy.sectorSize);
    // CorrectSectorCoords (Galaxy.7.cs): clamp to [0, SectorWidth-1] × [0, SectorHeight-1].
    x2 = Math.max(0, Math.min(x2, galaxy.sectorWidth - 1));
    y2 = Math.max(0, Math.min(y2, galaxy.sectorHeight - 1));
    return String.fromCharCode(x2 + 65) + String(y2 + 1);
}

/** Galaxy.3.cs 683 FastFindNearestLongRangeScanner(x, y, empire). No Rnd. */
export function fastFindNearestLongRangeScanner(galaxy: Galaxy, x: number, y: number, empire: Empire): BuiltObject | null {
    let num = Number.MAX_VALUE;
    let result: BuiltObject | null = null;
    const scanners = empire.longRangeScanners as BuiltObject[];
    for (let i = 0; i < scanners.length; i++) {
        const builtObject = scanners[i];
        if (builtObject != null) {
            const num2 = galaxy.calculateDistanceSquared(x, y, builtObject.xpos, builtObject.ypos);
            if (num2 < num) {
                result = builtObject;
                num = num2;
            }
        }
    }
    return result;
}

/** Galaxy.7.cs 1319 FindNearestBuiltObject(int x, int y, empire, subRole, fullyFunctional) (+ 1355 InIndex). No Rnd. */
export function findNearestBuiltObjectOfEmpire(galaxy: Galaxy, x: number, y: number, empire: Empire | null, subRole: BuiltObjectSubRole, fullyFunctional: boolean): BuiltObject | null {
    return galaxy.ringSearch(x, y, (cx, cy) => {
        let builtObject: BuiltObject | null = null;
        const builtObjectList = galaxy.builtObjectIndexGrid[cx][cy];
        let distance = Number.MAX_VALUE;
        for (let i = 0; i < builtObjectList.length; i++) {
            const builtObject2 = builtObjectList[i];
            if (builtObject2 == null) continue;
            const num = galaxy.calculateDistanceSquared(x, y, builtObject2.xpos, builtObject2.ypos);
            if (!(num < distance)) continue;
            let flag = true;
            if (fullyFunctional && (builtObject2.builtAt != null || builtObject2.unbuiltOrDamagedComponentCount > 0)) flag = false;
            if (!flag) continue;
            let flag2 = true;
            if (empire !== null && builtObject2.empire !== empire) flag2 = false;
            if (!flag2) continue;
            if (subRole !== BuiltObjectSubRole.Undefined) {
                if (builtObject2.subRole === subRole) {
                    builtObject = builtObject2;
                    distance = num;
                }
            } else {
                builtObject = builtObject2;
                distance = num;
            }
        }
        if (builtObject !== null) distance = galaxy.calculateDistance(x, y, builtObject.xpos, builtObject.ypos);
        return { item: builtObject, distance };
    });
}

/** HabitatList.cs 48 GetHabitatsPopulationAnotherRace(race) → 15 GetRandomHabitatPopulationAnotherRace. Rnd: Next(0, n) when non-empty. */
function getRandomHabitatPopulationAnotherRace(galaxy: Galaxy, list: Habitat[], race: Race | null): Habitat | null {
    const populationAnotherRace: Habitat[] = [];
    for (let index1 = 0; index1 < list.length; index1++) {
        const habitat = list[index1];
        for (let index2 = 0; index2 < habitat.population.items.length; index2++) {
            const population = habitat.population.items[index2];
            if (population != null && population.race !== race) {
                populationAnotherRace.push(habitat);
                break;
            }
        }
    }
    if (populationAnotherRace.length <= 0) return null;
    const index = galaxy.rnd.next(0, populationAnotherRace.length);
    return populationAnotherRace[index];
}

/** HabitatList.cs 258 GetHabitatsPopulationBelowThreshold → 284 GetRandomHabitatPopulationBelowThreshold. Rnd: Next(0, n) when non-empty. */
function getRandomHabitatPopulationBelowThreshold(galaxy: Galaxy, list: Habitat[], maxPopulationAmount: number, type: HabitatType): Habitat | null {
    const populationBelowThreshold: Habitat[] = [];
    for (let index = 0; index < list.length; index++) {
        if ((type === HabitatType.Undefined || list[index].type === type) && (list[index].population == null || list[index].population.totalAmount < maxPopulationAmount)) populationBelowThreshold.push(list[index]);
    }
    if (populationBelowThreshold.length <= 0) return null;
    const index = galaxy.rnd.next(0, populationBelowThreshold.length);
    return populationBelowThreshold[index];
}

/** HabitatList.cs 318 GetHabitatsWithResource(resourceId). */
function getHabitatsWithResource(list: Habitat[], resourceId: number): Habitat[] {
    const result: Habitat[] = [];
    for (let index = 0; index < list.length; index++) {
        const habitat = list[index];
        if (habitat != null && habitat.resources != null && habitat.resources.findIndex((r) => r.resourceId === resourceId) >= 0) result.push(habitat);
    }
    return result;
}

/** CharacterList.cs 340 GetCharactersWithTraits(traits): a character is added once per matching trait. */
function getCharactersWithTraits(list: Character[], traits: CharacterTraitType[]): Character[] {
    const result: Character[] = [];
    for (let index1 = 0; index1 < list.length; index1++) {
        const character = list[index1];
        if (character != null) {
            for (let index2 = 0; index2 < traits.length; index2++) {
                if (character.traits.includes(traits[index2])) result.push(character);
            }
        }
    }
    return result;
}

/** Empire.7.cs 4358 DetermineEmpiresKnownNotAtWarWith. */
function determineEmpiresKnownNotAtWarWith(empire: Empire): Empire[] {
    const empireList: Empire[] = [];
    for (let i = 0; i < empire.diplomaticRelations.count; i++) {
        const diplomaticRelation = empire.diplomaticRelations.at(i);
        const other = diplomaticRelation.otherEmpire!;
        if (other !== empire && other.pirateEmpireBaseHabitat === null && diplomaticRelation.type !== DiplomaticRelationType.NotMet && diplomaticRelation.type !== DiplomaticRelationType.War && !empireList.includes(other)) empireList.push(other);
    }
    return empireList;
}

/** Empire.7.cs 4342 DetermineEmpiresNotAtWarWithNoAmbassador. */
function determineEmpiresNotAtWarWithNoAmbassador(empire: Empire): Empire[] {
    const empireList: Empire[] = [];
    const empireList2 = determineEmpiresKnownNotAtWarWith(empire);
    const characters = getEmpireCharacters(empire) ?? [];
    for (let i = 0; i < empireList2.length; i++) {
        const empire2 = empireList2[i];
        // CharacterList.FindCharactersAtLocationNotTransferring(location) (CharacterList.cs 113).
        const characterList = characters.filter((c) => c != null && c.location === empire2.capital && c.transferDestination === null);
        if (characterList.length === 0) empireList.push(empire2);
    }
    return empireList;
}

/** Empire.7.cs 4372 DetermineEmpiresNotKnown. */
function determineEmpiresNotKnown(empire: Empire): Empire[] {
    const empireList: Empire[] = [];
    for (let i = 0; i < empire.diplomaticRelations.count; i++) {
        const diplomaticRelation = empire.diplomaticRelations.at(i);
        const other = diplomaticRelation.otherEmpire!;
        if (other !== empire && diplomaticRelation.type === DiplomaticRelationType.NotMet && other.pirateEmpireBaseHabitat === null && !empireList.includes(other)) empireList.push(other);
    }
    return empireList;
}

/** Empire.7.cs 4386 DetermineEmpiresKnown. */
function determineEmpiresKnown(empire: Empire): Empire[] {
    const empireList: Empire[] = [];
    for (let i = 0; i < empire.diplomaticRelations.count; i++) {
        const diplomaticRelation = empire.diplomaticRelations.at(i);
        const other = diplomaticRelation.otherEmpire!;
        if (other !== empire && diplomaticRelation.type !== DiplomaticRelationType.NotMet && other.pirateEmpireBaseHabitat === null && !empireList.includes(other)) empireList.push(other);
    }
    return empireList;
}

/** Empire.9.cs 1388 FindNearestResortBase(x, y). */
function findNearestResortBase(galaxy: Galaxy, empire: Empire, x: number, y: number): BuiltObject | null {
    let result: BuiltObject | null = null;
    let num = Number.MAX_VALUE;
    const resortBases = empire.resortBases as BuiltObject[];
    if (resortBases != null) {
        for (let i = 0; i < resortBases.length; i++) {
            const builtObject = resortBases[i];
            if (builtObject != null && !builtObject.hasBeenDestroyed) {
                const num2 = galaxy.calculateDistanceSquared(x, y, builtObject.xpos, builtObject.ypos);
                if (num2 < num) {
                    result = builtObject;
                    num = num2;
                }
            }
        }
    }
    return result;
}

/** Empire.7.cs 1275/1280 GenerateNewBuiltObject(design, parentHabitat). Rnd: SelectRelativeParkingPoint(400) + SelectRandomHeading (+ GenerateBuiltObjectFromDesign's). */
export function generateNewBuiltObject(galaxy: Galaxy, empire: Empire, design: import('./design').Design, parentHabitat: Habitat | null, x = 0.0, y = 0.0): BuiltObject {
    design.buildCount++;
    const isState = determineBuiltObjectIsState(design.subRole);
    const name = galaxy.generateBuiltObjectName(design, parentHabitat);
    if (parentHabitat !== null) {
        x = parentHabitat.xpos;
        y = parentHabitat.ypos;
    }
    const builtObject = generateBuiltObjectFromDesign(galaxy, empire, design, name, isState, x, y);
    builtObject.dateBuilt = galaxyStarDate(galaxy);
    builtObject.dateRetrofit = galaxyStarDate(galaxy);
    if (parentHabitat !== null) {
        builtObject.parentHabitat = parentHabitat;
        const p = galaxy.selectRelativeParkingPoint(400.0);
        builtObject.parentOffsetX = p.x;
        builtObject.parentOffsetY = p.y;
    }
    builtObject.heading = galaxy.selectRandomHeading();
    builtObject.targetHeading = builtObject.heading;
    builtObject.reDefine();
    builtObject.currentFuel = builtObject.fuelCapacity;
    builtObject.currentShields = builtObject.shieldsCapacity;
    if (builtObject.troopCapacity > 0 && empire.policy != null) builtObject.setTroopLoadoutsFromPolicy(empire.policy);
    return builtObject;
}

/** Empire.6.cs 727 GenerateNewShip(subRole, location). Rnd: GenerateBuiltObjectName (twice) + GenerateNewBuiltObject's. */
function generateNewShip(galaxy: Galaxy, empire: Empire, subRole: BuiltObjectSubRole, location: Habitat): BuiltObject | null {
    // Designs.FindNewestCanBuild(subRole, location) (DesignList.cs 148: the list's first design's empire).
    const listEmpire = empire.designs.length > 0 && empire.designs[0] != null ? (empire.designs[0].empire as Empire | null) : null;
    const design = findNewestCanBuild(empire.designs, subRole, listEmpire, location);
    if (design !== null) {
        const purchasePrice = design.calculateCurrentPurchasePrice(galaxy);
        design.buildCount++;
        // `new BuiltObject(design, _Galaxy.GenerateBuiltObjectName(design), _Galaxy) { PurchasePrice = … }` — built and discarded.
        const discarded = new BuiltObjectClass(design, galaxy.generateBuiltObjectName(design), galaxy);
        discarded.purchasePrice = purchasePrice;
        return generateNewBuiltObject(galaxy, empire, design, location);
    }
    return null;
}

// ---------------------------------------------------------------------------
// Empire.1.cs 1731 PirateReviewRandomEvents / 1758 ReviewRandomEvents and their events
// ---------------------------------------------------------------------------

/** Empire.1.cs 1731 PirateReviewRandomEvents. Rnd: Next(0, 7), Next(0, max(5, 8 − colonies)), then Next(0, 7) / Next(0, 10). */
export function pirateReviewRandomEvents(galaxy: Galaxy, empire: Empire): void {
    if (galaxy.rnd.next(0, 7) === 1) {
        randomEventUncoverPirateAttackFunding(galaxy, empire);
        return;
    }
    const maxValue = Math.max(5, 8 - empire.colonies.length);
    if (galaxy.rnd.next(0, maxValue) === 1) {
        randomEventPirateControlledColonyGivesShip(galaxy, empire);
        return;
    }
    const num = calculateRelativeEmpireSize(galaxy, empire);
    if (num < 1.0) {
        if (galaxy.rnd.next(0, 7) === 1) randomEventUncoverKnownLocations(galaxy, empire);
        else if (galaxy.rnd.next(0, 10) === 1) randomEventRareResourceIntercepted(galaxy, empire);
    }
}

/** Empire.1.cs 1758 ReviewRandomEvents. Rnd: Next(0, 10), Next(0, 20), then up to three more. */
export function reviewRandomEvents(galaxy: Galaxy, empire: Empire): void {
    if (galaxy.rnd.next(0, 10) === 1) {
        randomEventUncoverPirateAttackFunding(galaxy, empire);
        return;
    }
    if (galaxy.rnd.next(0, 20) === 1) {
        randomEventRestrictedZoneRevealed(galaxy, empire);
        return;
    }
    const num = (calculateRelativeEmpireSize(galaxy, empire) + calculateRelativeEmpireMilitaryStrength(galaxy, empire)) / 2.0;
    if (num < 1.0) {
        if (galaxy.rnd.next(0, 10) === 1) randomEventUncoverKnownLocations(galaxy, empire);
        else if (galaxy.rnd.next(0, 20) === 1) randomEventRareResourceIntercepted(galaxy, empire);
        else if (galaxy.rnd.next(0, 20) === 1 && galaxy.gameDisasterEventsEnabled) empireEventColonyResourceAppearanceRandom(galaxy, empire);
    }
}

/** Empire.1.cs 1788 RandomEventRestrictedZoneRevealed (empty in the C#). */
function randomEventRestrictedZoneRevealed(galaxy: Galaxy, empire: Empire): void {
    void galaxy;
    void empire;
}

/** Empire.1.cs 1204 RandomEventPirateControlledColonyGivesShip. Rnd: Next(0, colonies), Next(0, 5), Next(0, 2) + generation draws. */
function randomEventPirateControlledColonyGivesShip(galaxy: Galaxy, empire: Empire): void {
    if (empire.pirateEmpireBaseHabitat === null) return;
    let habitat: Habitat | null = null;
    if (empire.colonies.length > 0) habitat = empire.colonies[galaxy.rnd.next(0, empire.colonies.length)];
    if (habitat === null) return;
    // TODO(port) M4s2: habitat.GetPirateControl().CheckFactionHasControl(this) (PirateColonyControl is not modelled; pirate
    // factions own no colonies yet — characters.ts ResolveLocationsToDefend throws on them too).
    throw new Error('TODO(port) M4s2: Habitat.GetPirateControl (Empire.1.cs 1215 RandomEventPirateControlledColonyGivesShip)');
}

/** Empire.1.cs 1300 RandomEventRareResourceIntercepted(). No Rnd. */
function randomEventRareResourceIntercepted(galaxy: Galaxy, empire: Empire): void {
    let flag = false;
    let resource = 255;
    let empire2: Empire | null = null;
    for (let i = 0; i < galaxy.empires.length; i++) {
        const empire3 = galaxy.empires[i];
        if (empire3 !== empire && !empire3.reclusive) {
            const r = checkEmpireSuppliesRestrictedResources(galaxy, empire3);
            if (r >= 0) {
                resource = r;
                flag = true;
                empire2 = empire3;
                break;
            }
            resource = 255;
        }
    }
    if (flag && resource !== 255 && empire2 !== null && empire2.capital !== null) {
        const spaceport = fastFindNearestSpacePort(galaxy, empire2.capital.xpos, empire2.capital.ypos, empire);
        randomEventRareResourceInterceptedAt(galaxy, empire, resource, spaceport, empire2);
    }
}

/** Empire.1.cs 1322 RandomEventRareResourceIntercepted(resource, spaceport, supplyingEmpire). No Rnd. */
export function randomEventRareResourceInterceptedAt(galaxy: Galaxy, empire: Empire, resourceId: number, spaceport: BuiltObject | null, supplyingEmpire: Empire | null): void {
    if (spaceport === null) return;
    // spaceport.Cargo.Add(new Cargo(resource, 200, this)).
    spaceport.cargo!.add(new Cargo(new ResourceRef(resourceId), 200, empire));
    const resourceName = galaxy.resourceSystem.byId.get(resourceId)?.name ?? '';
    let text = gameText('Intercept Resource RESOURCE SYSTEM SPACEPORT', resourceName, spaceport.nearestSystemStar === null ? empire.capital!.name : spaceport.nearestSystemStar.name, spaceport.name);
    let flag = false;
    if (supplyingEmpire !== null) {
        if (empire.pirateEmpireBaseHabitat === null) {
            const diplomaticRelation = obtainDiplomaticRelation(empire, supplyingEmpire);
            if (diplomaticRelation.type !== DiplomaticRelationType.NotMet) flag = true;
        } else {
            const pirateRelation = obtainPirateRelation(empire, supplyingEmpire);
            if (pirateRelation.type !== PirateRelationType.None) flag = true;
        }
    }
    if (!flag) text = text + '\n\n' + gameText('Intercept Resource unclear origin', resourceName);
    sendEventMessageToEmpire(empire, EventMessageType.RareResourceIntercepted, gameText('Rare Resource Intercepted'), text, resourceId, spaceport);
}

/** The "Communications Intercept ..." prefix of RandomEventUncoverKnownLocations (Empire.1.cs 1405-1418 / 1466-1478 / 1507-1519). */
function interceptSource(galaxy: Galaxy, empire: Empire, other: Empire, item: GalaxyLocation): { scanner: BuiltObject | null; text: string } {
    let text = '';
    let builtObject2 = fastFindNearestLongRangeScanner(galaxy, Math.trunc(item.xpos), Math.trunc(item.ypos), empire);
    if (builtObject2 === null) {
        builtObject2 = findNearestBuiltObjectOfEmpire(galaxy, Math.trunc(item.xpos), Math.trunc(item.ypos), empire, BuiltObjectSubRole.ExplorationShip, true);
        if (builtObject2 !== null) text = gameText('Communications Intercept SHIPNAME EMPIRE', builtObject2.name, other.name) + '.\n\n';
    } else {
        text = gameText('Communications Intercept MONITORINGSTATION EMPIRE', builtObject2.name, other.name) + '.\n\n';
    }
    return { scanner: builtObject2, text };
}

/** Empire.1.cs 1358 RandomEventUncoverKnownLocations. No Rnd. */
function randomEventUncoverKnownLocations(galaxy: Galaxy, empire: Empire): void {
    const known = empire.visibility.knownGalaxyLocations;
    for (let i = 0; i < galaxy.empires.length; i++) {
        const empire2 = galaxy.empires[i];
        if (empire2 === empire || empire2 == null) continue;
        let flag = false;
        if (empire2.pirateEmpireBaseHabitat === null && empire.pirateEmpireBaseHabitat === null) {
            const diplomaticRelation = obtainDiplomaticRelation(empire, empire2);
            if (diplomaticRelation.type !== DiplomaticRelationType.NotMet) flag = true;
        } else {
            const pirateRelation = obtainPirateRelation(empire, empire2);
            if (pirateRelation.type !== PirateRelationType.None) flag = true;
        }
        if (!flag) continue;
        const otherKnown = empire2.visibility.knownGalaxyLocations;
        let galaxyLocationList = otherKnown.filter((l) => l.type === GalaxyLocationType.PlanetDestroyer);
        if (galaxyLocationList.length > 0) {
            for (let j = 0; j < empire2.builtObjects.length; j++) {
                const builtObject = empire2.builtObjects[j];
                const mission = builtObject.mission as BuiltObjectMission | null;
                if (builtObject.subRole !== BuiltObjectSubRole.ConstructionShip || mission == null || (mission.type !== BuiltObjectMissionType.Build && mission.type !== BuiltObjectMissionType.BuildRepair)) continue;
                for (const item of galaxyLocationList) {
                    if (known.includes(item) || mission.targetBuiltObject !== item.relatedBuiltObject) continue;
                    const relatedBuiltObject = item.relatedBuiltObject!;
                    const { scanner: builtObject2, text } = interceptSource(galaxy, empire, empire2, item);
                    if (builtObject2 === null) continue;
                    const nearestStar = relatedBuiltObject.nearestSystemStar!;
                    const message = text + gameText('Communications Intercept Planet Destroyer', nearestStar.name, resolveSectorDescription(galaxy, relatedBuiltObject.xpos, relatedBuiltObject.ypos), empire2.name);
                    known.push(item);
                    addLocationHint(empire, { x: Math.trunc(item.xpos) + Math.trunc(item.width) / 2 | 0, y: Math.trunc(item.ypos) + Math.trunc(item.height) / 2 | 0 });
                    const additionalData = [empire2, item];
                    sendEventMessageToEmpire(empire, EventMessageType.UncoverPlanetDestroyerConstruction, gameText('Secret Construction Project Revealed'), message, additionalData, relatedBuiltObject);
                    if (empire === galaxy.playerEmpire) return;
                    let flag2 = false;
                    if (empire.pirateEmpireBaseHabitat === null && empire2.pirateEmpireBaseHabitat === null) {
                        const diplomaticRelation2 = obtainDiplomaticRelation(empire, empire2);
                        if (diplomaticRelation2.type === DiplomaticRelationType.MutualDefensePact || diplomaticRelation2.type === DiplomaticRelationType.Protectorate || diplomaticRelation2.type === DiplomaticRelationType.FreeTradeAgreement) flag2 = true;
                    } else {
                        const pirateRelation2 = obtainPirateRelation(empire, empire2);
                        if (pirateRelation2.type === PirateRelationType.Protection) flag2 = true;
                    }
                    if (!flag2) {
                        // (double)MilitaryPotency / (double)empire.MilitaryPotency (int properties).
                        const num = militaryPotency(galaxy, empire) / militaryPotency(galaxy, empire2);
                        const num2 = 0.3 * (empire.dominantRace!.caution / 100.0);
                        if (num > num2) exposePlanetDestroyerConstruction(galaxy, empire2, item, empire);
                    }
                    return;
                }
            }
        }
        galaxyLocationList = otherKnown.filter((l) => l.type === GalaxyLocationType.DebrisField);
        if (galaxyLocationList.length > 0) {
            for (const item2 of galaxyLocationList) {
                if (known.includes(item2)) continue;
                const { scanner: builtObject3, text: text2 } = interceptSource(galaxy, empire, empire2, item2);
                if (builtObject3 !== null) {
                    const habitat = galaxy.fastFindNearestSystem(item2.xpos, item2.ypos)!;
                    const message2 = text2 + gameText('Communications Intercept Debris Field', empire2.name, habitat.name, resolveSectorDescription(galaxy, item2.xpos, item2.ypos));
                    known.push(item2);
                    const point = { x: Math.trunc(item2.xpos) + (Math.trunc(Math.trunc(item2.width) / 2)), y: Math.trunc(item2.ypos) + (Math.trunc(Math.trunc(item2.height) / 2)) };
                    addLocationHint(empire, point);
                    sendEventMessageToEmpire(empire, EventMessageType.UncoverKnownLocation, gameText('Debris Field Revealed'), message2, item2, point);
                    return;
                }
            }
        }
        galaxyLocationList = otherKnown.filter((l) => l.type === GalaxyLocationType.RestrictedArea);
        if (galaxyLocationList.length <= 0) continue;
        for (const item3 of galaxyLocationList) {
            if (known.includes(item3)) continue;
            const { scanner: builtObject4, text: text3 } = interceptSource(galaxy, empire, empire2, item3);
            if (builtObject4 !== null) {
                const habitat2 = galaxy.fastFindNearestSystem(item3.xpos, item3.ypos)!;
                const message3 = text3 + gameText('Communications Intercept Restricted Area', empire2.name, habitat2.name, resolveSectorDescription(galaxy, item3.xpos, item3.ypos));
                known.push(item3);
                const point2 = { x: Math.trunc(item3.xpos) + Math.trunc(Math.trunc(item3.width) / 2), y: Math.trunc(item3.ypos) + Math.trunc(Math.trunc(item3.height) / 2) };
                addLocationHint(empire, point2);
                sendEventMessageToEmpire(empire, EventMessageType.UncoverKnownLocation, gameText('Restricted Area Revealed'), message3, item3, point2);
                return;
            }
        }
    }
}

/** Empire.1.cs 1535 ExposePlanetDestroyerConstruction(planetDestroyerBuilder, planetDestroyerLocation, exposer). No Rnd. */
export function exposePlanetDestroyerConstruction(galaxy: Galaxy, planetDestroyerBuilder: Empire, planetDestroyerLocation: GalaxyLocation, exposer: Empire): void {
    if (planetDestroyerBuilder.pirateEmpireBaseHabitat !== null) return;
    const habitat = galaxy.fastFindNearestSystem(planetDestroyerLocation.xpos, planetDestroyerLocation.ypos)!;
    const description = gameText('Warning Planet Destroyer Construction', planetDestroyerBuilder.name, habitat.name, resolveSectorDescription(galaxy, habitat.xpos, habitat.ypos));
    if (exposer.pirateEmpireBaseHabitat === null) {
        for (let i = 0; i < exposer.diplomaticRelations.count; i++) {
            const diplomaticRelation = exposer.diplomaticRelations.at(i);
            const other = diplomaticRelation.otherEmpire!;
            if (diplomaticRelation.type !== DiplomaticRelationType.NotMet && other !== planetDestroyerBuilder) {
                const empireEvaluation = obtainEmpireEvaluation(galaxy, other, planetDestroyerBuilder);
                empireEvaluation.incidentEvaluation = empireEvaluation.incidentEvaluationRaw - 12.0;
                if (!other.visibility.knownGalaxyLocations.includes(planetDestroyerLocation)) other.visibility.knownGalaxyLocations.push(planetDestroyerLocation);
                sendMessageToEmpire(exposer, other, EmpireMessageType.GeneralWarning, planetDestroyerLocation.relatedBuiltObject, description);
            }
        }
    } else {
        for (let j = 0; j < exposer.pirateRelations.count; j++) {
            const pirateRelation = exposer.pirateRelations.get(j);
            const other = pirateRelation.otherEmpire!;
            if (pirateRelation.type !== PirateRelationType.None && other !== planetDestroyerBuilder && other.pirateEmpireBaseHabitat === null) {
                const empireEvaluation2 = obtainEmpireEvaluation(galaxy, other, planetDestroyerBuilder);
                empireEvaluation2.incidentEvaluation = empireEvaluation2.incidentEvaluationRaw - 12.0;
                if (!other.visibility.knownGalaxyLocations.includes(planetDestroyerLocation)) other.visibility.knownGalaxyLocations.push(planetDestroyerLocation);
                sendMessageToEmpire(exposer, other, EmpireMessageType.GeneralWarning, planetDestroyerLocation.relatedBuiltObject, description);
            }
        }
    }
    planetDestroyerBuilder.civilityRating -= 7.0;
    if (exposer.pirateEmpireBaseHabitat === null) {
        const empireEvaluation3 = obtainEmpireEvaluation(galaxy, planetDestroyerBuilder, exposer);
        empireEvaluation3.incidentEvaluation = empireEvaluation3.incidentEvaluationRaw - 20.0;
    } else {
        changePirateEvaluation(planetDestroyerBuilder, exposer, Math.fround(-20), PirateRelationEvaluationType.DetectedIntelligenceMissions);
    }
}

/** Empire.1.cs 1590 RandomEventUncoverPirateAttackFunding. No Rnd. */
function randomEventUncoverPirateAttackFunding(galaxy: Galaxy, empire: Empire): void {
    for (let i = 0; i < galaxy.pirateEmpires.length; i++) {
        const empire2 = galaxy.pirateEmpires[i];
        if (!empire.knownPirateEmpires.includes(empire2)) continue;
        const empireActivityList = empire2.pirateMissions.resolveActivitiesByType(EmpireActivityType.Attack);
        if (empireActivityList == null || empireActivityList.count <= 0) continue;
        for (let j = 0; j < empireActivityList.count; j++) {
            const empireActivity = empireActivityList.at(j)!;
            if (empireActivity.requestingEmpire === empire || empireActivity.assignedEmpire !== empire2) continue;
            if (empireActivity.targetEmpire === empire) {
                const message = gameText('Uncover Pirate Attack Funding Against Us', empireActivity.requestingEmpire!.name, empire2.name);
                sendEventMessageToEmpire(empire, EventMessageType.UncoverPirateAttackFundingYourEmpire, gameText('Pirates secretly funded to attack us'), message, empireActivity, null);
                const empireEvaluation = obtainEmpireEvaluation(galaxy, empire, empireActivity.requestingEmpire);
                empireEvaluation.incidentEvaluation = empireEvaluation.incidentEvaluationRaw - 15.0;
                empireActivity.requestingEmpire!.civilityRating -= 3.0;
                if (empire !== galaxy.playerEmpire) {
                    const description = gameText('Uncover Pirate Attack Funding Against Us Threaten', empire2.name);
                    sendMessageToEmpire(empire, empireActivity.requestingEmpire, EmpireMessageType.GeneralWarning, null, description);
                }
                return;
            }
            const diplomaticRelation = obtainDiplomaticRelation(empire, empireActivity.targetEmpire);
            const diplomaticRelation2 = obtainDiplomaticRelation(empire, empireActivity.requestingEmpire);
            if (diplomaticRelation.type !== DiplomaticRelationType.NotMet && diplomaticRelation2.type !== DiplomaticRelationType.NotMet) {
                const message2 = gameText('Uncover Pirate Attack Funding Against Other', empireActivity.requestingEmpire!.name, empire2.name, empireActivity.targetEmpire!.name);
                sendEventMessageToEmpire(empire, EventMessageType.UncoverPirateAttackFundingAnotherEmpire, gameText('Pirates secretly funded to attack empire'), message2, empireActivity, null);
                return;
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Empire.1.cs 1637-1730 rogue fleets
// ---------------------------------------------------------------------------

/** Empire.1.cs 1637 EmpireEventRogueFleetDefects(). No Rnd (DefectFleet's callees aside). */
function empireEventRogueFleetDefects(galaxy: Galaxy, empire: Empire): void {
    let empireToDefectTo: Empire | null = null;
    let num = Number.MAX_VALUE;
    for (let i = 0; i < empire.diplomaticRelations.count; i++) {
        const diplomaticRelation = empire.diplomaticRelations.at(i);
        const other = diplomaticRelation.otherEmpire!;
        if (diplomaticRelation.type === DiplomaticRelationType.NotMet || other === empire) continue;
        let num2: number;
        switch (diplomaticRelation.type) {
            case DiplomaticRelationType.War:
                num2 = 2.0;
                break;
            case DiplomaticRelationType.TradeSanctions:
                num2 = 1.5;
                break;
            case DiplomaticRelationType.None:
                num2 = 1.2;
                break;
            default:
                num2 = 1.0;
                break;
        }
        if (other.civilityRating >= -5.0) {
            const d = other.civilityRating + 6.0;
            num2 *= Math.sqrt(Math.sqrt(d));
            let num3 = galaxy.calculateDistance(empire.capital!.xpos, empire.capital!.ypos, other.capital!.xpos, other.capital!.ypos);
            num3 /= num2;
            if (num3 < num) {
                empireToDefectTo = other;
                num = num3;
            }
        }
    }
    empireEventRogueFleetDefectsTo(galaxy, empire, empireToDefectTo);
}

/** Empire.1.cs 1666 EmpireEventRogueFleetDefects(empireToDefectTo). */
export function empireEventRogueFleetDefectsTo(galaxy: Galaxy, empire: Empire, empireToDefectTo: Empire | null): ShipGroup | null {
    let result: ShipGroup | null = null;
    const shipGroups = empireShipGroups(empire) as ShipGroup[];
    if (shipGroups.length > 1) {
        if (empireToDefectTo !== null) {
            let shipGroup: ShipGroup | null = null;
            let num = Number.MAX_VALUE;
            for (let i = 0; i < shipGroups.length; i++) {
                const shipGroup2 = shipGroups[i];
                const num2 = galaxy.calculateDistance(empireToDefectTo.capital!.xpos, empireToDefectTo.capital!.ypos, shipGroup2.leadShip!.xpos, shipGroup2.leadShip!.ypos);
                if (num2 < num) {
                    shipGroup = shipGroup2;
                    num = num2;
                }
            }
            if (shipGroup !== null) {
                result = shipGroup;
                defectFleet(galaxy, empireToDefectTo, shipGroup, empireToDefectTo);
            }
        }
        empire.lastDisasterDate = galaxyStarDate(galaxy);
    }
    return result;
}

/**
 * Empire.1.cs 1698 DefectFleet(fleet, newEmpire): incident evaluation −25, event message to the fleet's empire, a warning to
 * the new empire, SubsequentMissions.Clear, ForceCompleteMission, move the fleet (TakeOwnershipOfBuiltObject per ship,
 * ShipGroups.Add + Sort), GatherPoint = SelectFleetBase. No Rnd of its own. (Ported by M4q, with the ownership transfer.)
 */
export function defectFleet(galaxy: Galaxy, empire: Empire, fleet: ShipGroup, newEmpire: Empire): void {
    void empire;
    const fleetEmpire = fleet.empire!;
    const empireEvaluation = obtainEmpireEvaluation(galaxy, fleetEmpire, newEmpire);
    empireEvaluation.incidentEvaluation = empireEvaluation.incidentEvaluationRaw - 25.0;
    const message = gameText('Rogue Fleet Defects Detail', fleet.name, newEmpire.name);
    const text = gameText('Rogue Fleet Defects!');
    sendEventMessageToEmpire(fleetEmpire, EventMessageType.RogueFleetDefectsFromUs, text, message, newEmpire, fleet.leadShip);
    if (fleetEmpire !== galaxy.playerEmpire) {
        const description = gameText('Rogue Fleet Defects Warning', fleet.name);
        sendMessageToEmpire(fleetEmpire, newEmpire, EmpireMessageType.GeneralWarning, fleet, description);
    }
    fleet.subsequentMissions.length = 0;
    forceCompleteMission(galaxy, fleet);
    const groups = empireShipGroups(fleetEmpire);
    const idx = groups.indexOf(fleet);
    if (idx >= 0) groups.splice(idx, 1);
    for (let i = 0; i < fleet.ships.length; i++) {
        const builtObject = fleet.ships[i];
        takeOwnershipOfBuiltObject(galaxy, newEmpire, builtObject, newEmpire, true, false);
    }
    const newGroups = empireShipGroups(newEmpire);
    if (!newGroups.includes(fleet)) {
        newGroups.push(fleet);
        netSort(newGroups, compareShipGroups);
    }
    fleet.empire = newEmpire;
    fleet.gatherPoint = selectFleetBase(galaxy, newEmpire, fleet);
}

// ---------------------------------------------------------------------------
// Empire.1.cs 1792-2092 empire events (disasters)
// ---------------------------------------------------------------------------

/** Empire.1.cs 1792 EmpireEventPlague(). Rnd: Next(0, colonies) + EmpireEventPlague(colony). */
function empireEventPlagueRandom(galaxy: Galaxy, empire: Empire): void {
    const index = galaxy.rnd.next(0, empire.colonies.length);
    const colony = empire.colonies[index];
    empireEventPlague(galaxy, empire, colony);
}

/**
 * Empire.1.cs 1799 EmpireEventPlague(colony). Rnd: Next(0, 2) when the race can avert disasters; Next(0, occurrence total)
 * and NextDouble when a plague is chosen.
 */
export function empireEventPlague(galaxy: Galaxy, empire: Empire, colony: Habitat | null): void {
    if (colony === null || colony.population == null || colony.population.items.length <= 0 || colony.hasBeenDestroyed) return;
    if (empire.raceEventType === RaceEventType.PredictiveHistory || (raceEventsContainsEventType(empire.dominantRace!, RaceEventType.LuckyAvertColonyDisaster) && galaxy.rnd.next(0, 2) === 1)) {
        const habitat = galaxy.determineHabitatSystemStar(colony);
        const title = gameText('Avert Disaster') + '!';
        const message = gameText('Avert Plague Description', colony.name, habitat.name);
        sendEventMessageToEmpire(empire, EventMessageType.RaceEvent, title, message, RaceEventType.LuckyAvertColonyDisaster, colony);
    } else {
        const plagues = galaxyPlagues(galaxy);
        let plague: (typeof plagues)[number] | null = null;
        let num = 0;
        for (let i = 0; i < plagues.length; i++) num += plagues[i].naturalOccurrenceLevel;
        if (num > 0) {
            const num2 = galaxy.rnd.next(0, num);
            let num3 = 0;
            for (let j = 0; j < plagues.length; j++) {
                const plague2 = plagues[j];
                if (plague2 != null) {
                    const num4 = num3;
                    const num5 = num3 + plague2.naturalOccurrenceLevel;
                    if (num2 >= num4 && num2 < num5) {
                        plague = plague2;
                        break;
                    }
                    num3 += plague2.naturalOccurrenceLevel;
                }
            }
        }
        if (plague !== null) {
            colony.plagueId = plague.plagueId;
            colony.plagueTimeRemaining = Math.fround(Math.fround(plague.duration) + Math.fround((galaxy.rnd.nextDouble() - 0.5) * (Math.fround(plague.duration) * 0.3)));
            if (colony.population != null) {
                for (let k = 0; k < colony.population.items.length; k++) {
                    const population = colony.population.items[k];
                    if (population != null) population.growthRate = 1;
                }
            }
            const habitat2 = galaxy.determineHabitatSystemStar(colony);
            const description = plague.description;
            const title2 = gameText('Colony Disaster Plague') + '!';
            let text = gameText('Colony Disaster Plague Description', plague.name, colony.name, habitat2.name, description);
            text = text + '\n\n' + gameText('Plague Warn Spread') + '...';
            sendEventMessageToEmpire(empire, EventMessageType.DisasterEvent, title2, text, DisasterEventType.Plague, colony);
            sendNewsBroadcast(empire, EventMessageType.DisasterEvent, colony, DisasterEventType.Plague, false, false);
        }
    }
    empire.lastDisasterDate = galaxyStarDate(galaxy);
}

/**
 * Empire.1.cs 1867 EmpireEventColonyResourceDepletion(). Rnd: Next(0, colonies), Next(0, resources) when the colony has
 * resources. `habitat.DoingTasks` wait loop: the TS scheduler is single-threaded, so the colony is never mid-tick here.
 */
function empireEventColonyResourceDepletionRandom(galaxy: Galaxy, empire: Empire): void {
    const index = galaxy.rnd.next(0, empire.colonies.length);
    const habitat = empire.colonies[index];
    if (habitat != null && habitat.resources != null && habitat.resources.length > 0 && !habitat.hasBeenDestroyed) {
        if (!habitat.doingTasks) {
            const index2 = galaxy.rnd.next(0, habitat.resources.length);
            const resourceId = habitat.resources[index2].resourceId;
            empireEventColonyResourceDepletion(galaxy, habitat, resourceId, empire);
        }
    }
}

/** Empire.1.cs 1888 EmpireEventColonyResourceDepletion(habitat, resource, empire, galaxy). No Rnd. */
export function empireEventColonyResourceDepletion(galaxy: Galaxy, habitat: Habitat | null, resourceId: number, empire: Empire | null): void {
    if (habitat === null || habitat.resources == null || habitat.resources.length <= 0 || habitat.hasBeenDestroyed) return;
    if (!habitat.doingTasks) {
        const num = habitat.resources.findIndex((r) => r.resourceId === resourceId);
        if (num >= 0) {
            habitat.resources.splice(num, 1);
            const habitat2 = galaxy.determineHabitatSystemStar(habitat);
            const resourceName = galaxy.resourceSystem.byId.get(resourceId)?.name ?? '';
            const title = gameText('Resource Depletion', resourceName) + '!';
            const message = gameText('Resource Depletion Description', resourceName, habitat.name, habitat2.name);
            if (empire !== null) sendEventMessageToEmpire(empire, EventMessageType.ResourceDepletion, title, message, resourceId, habitat);
        }
    }
    if (empire !== null) empire.lastDisasterDate = galaxyStarDate(galaxy);
}

/** Empire.1.cs 1912 EmpireEventColonyResourceAppearance(). Rnd: Next(0, colonies), then Next(0, valid) up to 21 times. */
function empireEventColonyResourceAppearanceRandom(galaxy: Galaxy, empire: Empire): void {
    if (empire.colonies.length <= 0) return;
    const num = galaxy.rnd.next(0, empire.colonies.length);
    if (num < 0 || num >= empire.colonies.length) return;
    const habitat = empire.colonies[num];
    if (habitat == null || habitat.resources == null || habitat.resources.length >= 5 || habitat.hasBeenDestroyed) return;
    if (!habitat.doingTasks) {
        const list = resolveValidResourcesForHabitatTypeExcludeManufactured(galaxy, habitat.type, false);
        let num2 = 0;
        let index = galaxy.rnd.next(0, list.length);
        let num3 = habitat.resources.findIndex((r) => r.resourceId === list[index]);
        while (num3 >= 0 && num2 < 20) {
            index = galaxy.rnd.next(0, list.length);
            num3 = habitat.resources.findIndex((r) => r.resourceId === list[index]);
            num2++;
        }
        if (num3 < 0) empireEventColonyResourceAppearance(galaxy, habitat, list[index], empire);
    }
}

/** Empire.1.cs 1954 EmpireEventColonyResourceAppearance(habitat, resource, empire). Rnd: Next(300, 700) when the resource is added. */
export function empireEventColonyResourceAppearance(galaxy: Galaxy, habitat: Habitat | null, resourceId: number | undefined, empire: Empire | null): void {
    // `resource == null`: an empty valid list makes list[index] throw in the C# (ArgumentOutOfRange); resourceId undefined here.
    if (resourceId === undefined) throw new Error('Empire.1.cs 1935: list[index] out of range (no valid resources for the habitat type)');
    if (habitat === null) return;
    if (habitat.resources == null || habitat.resources.length >= 5 || habitat.hasBeenDestroyed) return;
    if (!habitat.doingTasks) {
        const num2 = habitat.resources.findIndex((r) => r.resourceId === resourceId);
        if (num2 < 0) {
            habitat.resources.push({ resourceId, abundance: shortCast(galaxy.rnd.next(300, 700)) });
            const habitat2 = galaxy.determineHabitatSystemStar(habitat);
            const resourceName = galaxy.resourceSystem.byId.get(resourceId)?.name ?? '';
            const title = gameText('Resource Appearance', resourceName) + '!';
            const message = gameText('Resource Appearance Description', resourceName, habitat.name, habitat2.name);
            if (empire !== null) sendEventMessageToEmpire(empire, EventMessageType.ResourceAppearance, title, message, resourceId, habitat);
        }
    }
}

/** Empire.1.cs 1988 EmpireEventEconomicCrisis. Rnd: NextDouble. */
function empireEventEconomicCrisis(galaxy: Galaxy, empire: Empire): void {
    const num = empire.stateMoney * (0.4 + galaxy.rnd.nextDouble() * 0.2);
    empire.stateMoney -= num;
    const title = gameText('Empire Disaster Economic Crisis') + '!';
    const message = gameText('Empire Disaster Economic Crisis Description', formatThousands(num));
    sendEventMessageToEmpire(empire, EventMessageType.DisasterEvent, title, message, DisasterEventType.EconomicCrisis, null);
    sendNewsBroadcast(empire, EventMessageType.DisasterEvent, null, DisasterEventType.EconomicCrisis, false, false);
    empire.lastDisasterDate = galaxyStarDate(galaxy);
}

/** (short) int cast (HabitatResource.Abundance). */
function shortCast(v: number): number {
    return (v << 16) >> 16;
}

/** `num.ToString("###,###,###,##0")`: rounded (away from zero), comma-grouped. */
function formatThousands(v: number): string {
    const r = Math.sign(v) * Math.round(Math.abs(v));
    return r.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

/** HabitatType → DisasterEventType (Empire.1.cs 2008-2017 / 2045-2083). */
function disasterEventTypeForHabitat(type: HabitatType): DisasterEventType {
    switch (type) {
        case HabitatType.Continental:
            return DisasterEventType.Earthquake;
        case HabitatType.MarshySwamp:
            return DisasterEventType.Sinkhole;
        case HabitatType.Ocean:
            return DisasterEventType.Tsunami;
        case HabitatType.Desert:
            return DisasterEventType.Sandstorm;
        case HabitatType.Ice:
            return DisasterEventType.Blizzard;
        case HabitatType.Volcanic:
            return DisasterEventType.Eruption;
        default:
            return DisasterEventType.Earthquake;
    }
}

/** Empire.1.cs 1999 EmpireEventColonyNaturalDisaster(). Rnd: Next(0, colonies), Next(0, 2) (averting race), or the disaster's. */
function empireEventColonyNaturalDisasterRandom(galaxy: Galaxy, empire: Empire): void {
    const index = galaxy.rnd.next(0, empire.colonies.length);
    const habitat = empire.colonies[index];
    if (habitat != null && !habitat.hasBeenDestroyed) {
        if (empire.raceEventType === RaceEventType.PredictiveHistory || (raceEventsContainsEventType(empire.dominantRace!, RaceEventType.LuckyAvertColonyDisaster) && galaxy.rnd.next(0, 2) === 1)) {
            const habitat2 = galaxy.determineHabitatSystemStar(habitat);
            const arg = resolveDescription(DisasterEventType as unknown as Record<number, string>, disasterEventTypeForHabitat(habitat.type));
            const title = gameText('Avert Disaster') + '!';
            const message = gameText('Avert Disaster Description', arg, habitat.name, habitat2.name);
            sendEventMessageToEmpire(empire, EventMessageType.RaceEvent, title, message, RaceEventType.LuckyAvertColonyDisaster, habitat);
        } else {
            empireEventColonyNaturalDisaster(galaxy, empire, habitat);
        }
        empire.lastDisasterDate = galaxyStarDate(galaxy);
    }
}

const DISASTER_TEXT_KEYS: Record<number, string> = {
    [DisasterEventType.Earthquake]: 'Earthquake',
    [DisasterEventType.Sinkhole]: 'Sinkhole',
    [DisasterEventType.Tsunami]: 'Tsunami',
    [DisasterEventType.Sandstorm]: 'Sandstorm',
    [DisasterEventType.Blizzard]: 'Blizzard',
    [DisasterEventType.Eruption]: 'Eruption',
};

/** Empire.1.cs 2031 EmpireEventColonyNaturalDisaster(colony). Rnd: NextDouble, Next(12, 21), NextDouble (populated colony). */
export function empireEventColonyNaturalDisaster(galaxy: Galaxy, empire: Empire, colony: Habitat): void {
    const f = Math.fround;
    const num = f(0.2 + galaxy.rnd.nextDouble() * 0.1);
    colony.damage = f(colony.damage + num);
    colony.damage = Math.min(1, colony.damage);
    // colony.RecalculateQuality(): the TS Quality is a live getter over BaseQuality and Damage (types.ts).
    const num2 = galaxy.rnd.next(12, 21);
    const developmentLevel = Math.max(0, colony.developmentLevel - num2);
    colony.setDevelopmentLevel(developmentLevel);
    doCharacterEventRuntime(galaxy, CharacterEventType.ColonyDevelopmentDecrease, colony, stellarObjectCharacters(colony), true, colony.empire);
    if (colony.population != null && colony.population.items.length > 0 && colony.population.totalAmount > 0) {
        const num3 = Math.trunc(colony.population.items[0].amount * (0.15 + galaxy.rnd.nextDouble() * 0.08));
        colony.population.items[0].amount -= num3;
        colony.population.recalculateTotalAmount();
    }
    const disasterEventType = disasterEventTypeForHabitat(colony.type);
    const habitat = galaxy.determineHabitatSystemStar(colony);
    const key = DISASTER_TEXT_KEYS[disasterEventType];
    const empty = gameText(`Colony Disaster ${key}`) + '!';
    const empty2 = gameText(`Colony Disaster ${key} Description`, colony.name, habitat.name);
    sendEventMessageToEmpire(empire, EventMessageType.DisasterEvent, empty, empty2, disasterEventType, colony);
    sendNewsBroadcast(empire, EventMessageType.DisasterEvent, colony, disasterEventType, false, false);
    empire.lastDisasterDate = galaxyStarDate(galaxy);
}

// ---------------------------------------------------------------------------
// Empire.1.cs 2094-2810 race events
// ---------------------------------------------------------------------------

/** Empire.1.cs 2094 ResetRaceEvents. No Rnd. */
export function resetRaceEvents(galaxy: Galaxy, empire: Empire): void {
    if (empire.raceEventEndDate <= 0 || galaxyStarDate(galaxy) <= empire.raceEventEndDate) return;
    for (let i = 0; i < empire.colonies.length; i++) {
        const habitat = empire.colonies[i];
        if (habitat == null || habitat.hasBeenDestroyed) continue;
        if (habitat.raceEventType !== RaceEventType.Undefined) {
            switch (habitat.raceEventType) {
                case RaceEventType.AntiXenoRiotsExterminate:
                case RaceEventType.DeathCultExterminate:
                case RaceEventType.XenophobiaNoAssimilate:
                    // C# derefs Policy (every normal empire has one).
                    habitat.colonyPopulationPolicy = empire.policy!.newColonyPopulationPolicyAllRaces;
                    habitat.colonyPopulationPolicyRaceFamily = empire.policy!.newColonyPopulationPolicyYourRaceFamily;
                    break;
            }
        }
        habitat.raceEventType = RaceEventType.Undefined;
    }
    empire.raceEventType = RaceEventType.Undefined;
    empire.raceEventEndDate = 0;
}

/** Empire.1.cs 2130 DoRaceEvent(race). Rnd: Next(0, events), NextDouble, + InitiateRaceEvent's. */
function doRaceEvent(galaxy: Galaxy, empire: Empire, race: Race | null): void {
    if (race === null) return;
    const events = raceEvents(race);
    if (events.length <= 0) return;
    const index = galaxy.rnd.next(0, events.length);
    const raceEvent = events[index];
    if (raceEvent != null) {
        let num = galaxy.rnd.nextDouble();
        num *= 20.0;
        if (num < raceEvent.frequency) initiateRaceEvent(galaxy, empire, race, raceEvent);
    }
}

/** Empire.1.cs 2800 SetRaceEventForAllColonies(raceEventType). */
function setRaceEventForAllColonies(empire: Empire, raceEventType: RaceEventType): void {
    if (empire.colonies != null) {
        for (let i = 0; i < empire.colonies.length; i++) empire.colonies[i].raceEventType = raceEventType;
    }
}

/** `x.ToString("0,K")`: the value scaled by 1000 (the trailing comma), rounded half away from zero, then "K". */
function formatThousandsK(v: number): string {
    const r = Math.sign(v) * Math.floor(Math.abs(v) / 1000 + 0.5);
    return `${r === 0 ? 0 : r}K`;
}

/** ResearchSystem.cs 975 DetermineLowestNextProject(galaxy, race, industry, optimizedDesignCategories, optimizedDesignTypes). Rnd: Next(0, n). */
function determineLowestNextProject(galaxy: Galaxy, empire: Empire, race: Race | null, industry: IndustryType): TechNode | null {
    const rs = empire.research;
    let lowestNextProject: TechNode | null = null;
    if (rs.nextProjects !== null && rs.nextProjects.length > 0) {
        const arrayThreadSafe = rs.nextProjects.slice();
        const raceAllowedComponents = race !== null ? resolveRaceSpecificComponents(rs, galaxy, race, true) : [];
        const projects: TechNode[] = [];
        projects.push(...arrayThreadSafe);
        const researchNodeList = removeNonRaceSpecificProjectTypes(rs, race, rs.techTree, projects, [], [], raceAllowedComponents);
        if (researchNodeList.length > 0) {
            const num = galaxy.rnd.next(0, researchNodeList.length);
            for (let index = num; index < researchNodeList.length; index++) {
                const researchNode = researchNodeList[index];
                if (researchNode != null && nodeIndustry(researchNode) === industry && (lowestNextProject === null || researchNode.def.techLevel < lowestNextProject.def.techLevel)) lowestNextProject = researchNode;
            }
            for (let index = 0; index < num; index++) {
                const researchNode = researchNodeList[index];
                if (researchNode != null && nodeIndustry(researchNode) === industry && (lowestNextProject === null || researchNode.def.techLevel < lowestNextProject.def.techLevel)) lowestNextProject = researchNode;
            }
        }
    }
    return lowestNextProject;
}

/** ResearchSystem.cs 764/781 ResolveNextProjects(galaxy, race, industry) (empty optimized lists, maxTechGap −1). Rnd: DetermineLowestNextProject's. */
function resolveNextProjects(galaxy: Galaxy, empire: Empire, race: Race | null, industry: IndustryType): TechNode[] {
    const rs = empire.research;
    const researchNodeList: TechNode[] = [];
    let num1 = 0;
    const num2 = 2147483647;
    const lowestNextProject = determineLowestNextProject(galaxy, empire, race, industry);
    if (lowestNextProject !== null) num1 = lowestNextProject.def.techLevel;
    if (rs.nextProjects !== null) {
        for (let index = 0; index < rs.nextProjects.length; index++) {
            const n = rs.nextProjects[index];
            if (nodeIndustry(n) !== industry) continue;
            const allowed = galaxy.researchStatic?.allowedRaces.get(n.def.projectId);
            if (allowed !== undefined && allowed.size > 0) {
                if (n.def.techLevel <= num1 + 2) researchNodeList.push(n);
            } else {
                const category = nodeCategory(n);
                if (n.def.techLevel <= num2 && category !== ComponentCategoryType.WeaponSuperArea && category !== ComponentCategoryType.WeaponSuperBeam && category !== ComponentCategoryType.WeaponSuperTorpedo) researchNodeList.push(n);
            }
        }
    }
    return researchNodeList;
}

/** The three research queues' first node by Rnd.Next(0, 3) (Empire.1.cs 2553-2574 / 2625-2646). */
function randomQueueHead(galaxy: Galaxy, empire: Empire): TechNode | null {
    const research = empire.research;
    let researchNode: TechNode | null = null;
    switch (galaxy.rnd.next(0, 3)) {
        case 0:
            if (research.researchQueueWeapons.length > 0) researchNode = research.researchQueueWeapons[0];
            break;
        case 1:
            if (research.researchQueueEnergy.length > 0) researchNode = research.researchQueueEnergy[0];
            break;
        case 2:
            if (research.researchQueueHighTech.length > 0) researchNode = research.researchQueueHighTech[0];
            break;
    }
    return researchNode;
}

/** Random trait for a character (Empire.1.cs 2222-2234 / 2487-2498): up to 20 × Next(0, valid) until CheckNewTraitValid. */
function pickNewValidTrait(galaxy: Galaxy, character: Character): CharacterTraitType {
    let characterTraitType = CharacterTraitType.Undefined;
    const list = determineValidTraitsForRole(character.role, false, false);
    if (list.length > 0) {
        let num = 0;
        while (characterTraitType === CharacterTraitType.Undefined && num < 20) {
            characterTraitType = list[galaxy.rnd.next(0, list.length)];
            if (!character.checkNewTraitValid(characterTraitType)) characterTraitType = CharacterTraitType.Undefined;
            num++;
        }
    }
    return characterTraitType;
}

/** `Galaxy.ResolveDescription(role).ToLower(CultureInfo.InvariantCulture)`. */
function roleLower(role: CharacterRole): string {
    return resolveDescription(CharacterRole, role).toLowerCase();
}

/** Empire.1.cs 2149 InitiateRaceEvent(race, raceEvent). Rnd per event type (see the cases). */
function initiateRaceEvent(galaxy: Galaxy, empire: Empire, race: Race | null, raceEvent: RaceEvent | null): void {
    if (race === null || raceEvent === null) return;
    const f = Math.fround;
    let title = '';
    let text = '';
    let stellarObject: StellarObject | null = null;
    let habitatList: Habitat[] | null = null;
    let habitat: Habitat | null = null;
    let num = 0;
    let researchNode: TechNode | null = null;
    const currentStarDate = galaxyStarDate(galaxy);
    const raceEventEndDate = currentStarDate + REAL_SECONDS_IN_GALACTIC_YEAR * 1000;
    const raceEventEndDate2 = currentStarDate + Math.trunc((REAL_SECONDS_IN_GALACTIC_YEAR * 1000) / 12);
    const characters = getEmpireCharacters(empire);
    const eventTitle = (): string => resolveDescription(RaceEventType as unknown as Record<number, string>, raceEvent.type);
    switch (raceEvent.type) {
        case RaceEventType.AntiXenoRiotsExterminate:
            if (empire.colonies != null) {
                habitat = empire.colonies[galaxy.rnd.next(0, empire.colonies.length)];
                if (habitat != null) {
                    const habitat4 = galaxy.determineHabitatSystemStar(habitat);
                    habitat.colonyPopulationPolicy = ColonyPopulationPolicy.Exterminate;
                    habitat.colonyPopulationPolicyRaceFamily = ColonyPopulationPolicy.Enslave;
                    habitat.raceEventType = RaceEventType.AntiXenoRiotsExterminate;
                    empire.raceEventEndDate = raceEventEndDate2;
                    stellarObject = habitat;
                    title = eventTitle();
                    text = gameText('Race Event Description AntiXenoRiotsExterminate', habitat.name, habitat4.name);
                }
            }
            break;
        case RaceEventType.CannibalismPopulationShrinks:
            if (raceChangePeriodActive(galaxy, race) && empire.colonies != null) {
                const habitat2 = empire.colonies[galaxy.rnd.next(0, empire.colonies.length)];
                if (habitat2 != null && habitat2.population != null && habitat2.population.items.length > 0) {
                    let amount = habitat2.population.items[0].amount;
                    // (int)Math.Min(20000000L, Amount / 50) (long division).
                    const maxValue = Math.min(20000000, Math.trunc(habitat2.population.items[0].amount / 50));
                    amount = Math.trunc(amount / 50) + galaxy.rnd.next(0, maxValue);
                    habitat2.population.items[0].amount -= amount;
                    habitat2.population.recalculateTotalAmount();
                    stellarObject = habitat2;
                    title = eventTitle();
                    text = gameText('Race Event Description CannibalismPopulationShrinks', habitat2.name);
                }
            }
            break;
        case RaceEventType.CreativeReengineeringFreeCrashResearch:
            if (empire.research != null && empire.research.researchQueueHighTech != null && empire.research.researchQueueHighTech.length > 0) {
                researchNode = empire.research.researchQueueHighTech[0];
                if (researchNode != null && !researchNode.isRushing && researchNode.progress < f(researchNode.cost * f(0.6))) {
                    researchNode.isRushing = true;
                    title = eventTitle();
                    text = gameText('Race Event Description CreativeReengineeringFreeCrashResearch', researchNode.def.name);
                }
            }
            break;
        case RaceEventType.DeathCultExterminate:
            if (empire.colonies != null) {
                habitat = getRandomHabitatPopulationAnotherRace(galaxy, empire.colonies, empire.dominantRace);
                if (habitat !== null && habitat.colonyPopulationPolicy !== ColonyPopulationPolicy.Exterminate && habitat.colonyPopulationPolicyRaceFamily !== ColonyPopulationPolicy.Exterminate) {
                    habitat.colonyPopulationPolicyRaceFamily = ColonyPopulationPolicy.Exterminate;
                    habitat.colonyPopulationPolicy = ColonyPopulationPolicy.Exterminate;
                    habitat.raceEventType = RaceEventType.DeathCultExterminate;
                    empire.raceEventType = RaceEventType.DeathCultExterminate;
                    empire.raceEventEndDate = raceEventEndDate;
                    stellarObject = habitat;
                    title = eventTitle();
                    text = gameText('Race Event Description DeathCultExterminate', habitat.name, empire.dominantRace!.name);
                }
            }
            break;
        case RaceEventType.DestinyCharacterTraits: {
            if (characters == null || characters.length <= 0) break;
            const character5 = characters[galaxy.rnd.next(0, characters.length)];
            if (character5 == null || !character5.active || !character5.bonusesKnown) break;
            const characterTraitType3 = pickNewValidTrait(galaxy, character5);
            if (characterTraitType3 !== CharacterTraitType.Undefined && character5.addTrait(characterTraitType3, false, galaxy)) {
                stellarObject = character5.location;
                empire.raceEventData = character5;
                title = eventTitle();
                text = gameText('Race Event Description DestinyCharacterTraits', roleLower(character5.role), character5.name, resolveDescription(CharacterTraitType, characterTraitType3));
            }
            break;
        }
        case RaceEventType.ForcedRetirementLeaderReplaced: {
            if (characters == null) break;
            const charactersByRole2 = getCharactersByRole(characters, CharacterRole.Leader);
            if (charactersByRole2.length > 0 && galaxyStarDate(galaxy) > nextAllowableLeaderChangeDate(empire)) {
                const character6 = generateNewCharacter(galaxy, empire, CharacterRole.Leader, empire.capital).character;
                let text3 = '';
                if (charactersByRole2[0].location !== null) text3 = charactersByRole2[0].location.name;
                title = eventTitle();
                empire.raceEventData = charactersByRole2[0];
                text = gameText('Race Event Description ForcedRetirementLeaderReplaced', roleLower(charactersByRole2[0].role), charactersByRole2[0].name, text3, character6.name);
                charactersByRole2[0].kill(galaxy);
                stellarObject = empire.capital;
                empire.leader = character6;
                empire.lastLeaderChangeDate = galaxyStarDate(galaxy);
                break;
            }
            const charactersByRole3 = getCharactersByRole(characters, CharacterRole.ColonyGovernor);
            if (charactersByRole3.length > 0) {
                stellarObject = charactersByRole3[0].location;
                let text4 = '';
                if (stellarObject !== null) text4 = stellarObject.name;
                title = eventTitle();
                const character7 = generateNewCharacter(galaxy, empire, CharacterRole.ColonyGovernor, stellarObject).character;
                text = gameText('Race Event Description ForcedRetirementLeaderReplaced', roleLower(charactersByRole3[0].role), charactersByRole3[0].name, text4, character7.name);
                charactersByRole3[0].kill(galaxy);
            }
            break;
        }
        case RaceEventType.FriendsInManyPlacesRevealTerritory: {
            const resortBases = empire.resortBases as BuiltObject[];
            if (resortBases == null || resortBases.length <= 0) break;
            let flag = false;
            for (let m = 0; m < resortBases.length; m++) {
                if (galaxy.rnd.next(0, 3) === 1) {
                    switch (galaxy.rnd.next(0, 3)) {
                        case 0:
                        case 1: {
                            const empireList2 = determineEmpiresKnown(empire);
                            if (empireList2.length > 0) {
                                num = galaxy.rnd.next(0, empireList2.length);
                                let builtObject3: BuiltObject | null = null;
                                if (empireList2[num].capital !== null) builtObject3 = findNearestResortBase(galaxy, empire, empireList2[num].capital!.xpos, empireList2[num].capital!.ypos);
                                giveTerritoryMap(galaxy, empireList2[num], empire);
                                stellarObject = builtObject3;
                                let arg4 = '';
                                if (builtObject3 !== null) arg4 = builtObject3.name;
                                flag = true;
                                title = eventTitle();
                                text = gameText('Race Event Description FriendsInManyPlacesRevealTerritory', arg4, empireList2[num].name);
                            }
                            break;
                        }
                        case 2: {
                            const empireList = determineEmpiresNotKnown(empire);
                            if (empireList.length <= 0) break;
                            num = galaxy.rnd.next(0, empireList.length);
                            const empire2 = empireList[num];
                            if (empire2 != null && empire2.active) {
                                let builtObject2: BuiltObject | null = null;
                                if (empire2.capital !== null) builtObject2 = findNearestResortBase(galaxy, empire, empire2.capital.xpos, empire2.capital.ypos);
                                doEmpireEncounter(galaxy, empire, empire2, builtObject2);
                                stellarObject = builtObject2;
                                let arg3 = '';
                                if (builtObject2 !== null) arg3 = builtObject2.name;
                                flag = true;
                                title = eventTitle();
                                text = gameText('Race Event Description FriendsInManyPlacesNewEmpire', arg3, empire2.name);
                            }
                            break;
                        }
                    }
                }
                if (flag) break;
            }
            break;
        }
        case RaceEventType.GrandPerformanceDiplomacyBonus: {
            const empireList3 = determineEmpiresNotAtWarWithNoAmbassador(empire);
            if (empireList3 == null || empireList3.length <= 0) break;
            num = galaxy.rnd.next(0, empireList3.length);
            const empire2 = empireList3[num];
            if (empire2 != null) {
                const empireEvaluation2 = obtainEmpireEvaluation(galaxy, empire, empire2);
                if (empireEvaluation2 != null) {
                    empireEvaluation2.diplomacyFactor *= 1.1;
                    empire.raceEventType = RaceEventType.GrandPerformanceDiplomacyBonus;
                    empire.raceEventEndDate = raceEventEndDate;
                    title = eventTitle();
                    text = gameText('Race Event Description GrandPerformanceDiplomacyBonus', race.name, empire2.name);
                }
            }
            break;
        }
        case RaceEventType.GreatHuntStrongTroops:
            if (empire.capital !== null) {
                empire.capital.raceEventType = RaceEventType.GreatHuntStrongTroops;
                empire.raceEventEndDate = raceEventEndDate;
                stellarObject = empire.capital;
                title = eventTitle();
                text = gameText('Race Event Description GreatHuntStrongTroops', empire.capital.name);
            }
            break;
        case RaceEventType.HistoricalKnowledgeUncoverHiddenLocation: {
            // _Galaxy.GalaxyLocations.FindLocations(RestrictedArea) (list order).
            const galaxyLocationList = galaxy.galaxyLocations.filter((l) => l.type === GalaxyLocationType.RestrictedArea);
            const known = empire.visibility.knownGalaxyLocations;
            if (galaxyLocationList == null || galaxyLocationList.length <= 0 || known == null) break;
            let num3 = 0;
            let galaxyLocation: GalaxyLocation | null = null;
            while (galaxyLocation === null && num3 < 50) {
                num = galaxy.rnd.next(0, galaxyLocationList.length);
                if (!known.includes(galaxyLocationList[num])) galaxyLocation = galaxyLocationList[num];
                num3++;
            }
            if (galaxyLocation !== null) {
                known.push(galaxyLocation);
                if (galaxyLocation.relatedBuiltObject !== null) stellarObject = galaxyLocation.relatedBuiltObject;
                const arg = resolveSectorDescription(galaxy, galaxyLocation.xpos, galaxyLocation.ypos);
                const arg2 = formatThousandsK(galaxyLocation.xpos) + ', ' + formatThousandsK(galaxyLocation.ypos);
                title = eventTitle();
                text = gameText('Race Event Description HistoricalKnowledgeUncoverHiddenLocation', galaxyLocation.name, arg, arg2);
            }
            break;
        }
        case RaceEventType.IsolationistsResetFirstContactPenalty: {
            const evaluations = empireEvaluationsOf(empire);
            if (evaluations != null) {
                for (let j = 0; j < evaluations.length; j++) {
                    const empireEvaluation = evaluations[j];
                    if (empireEvaluation != null) {
                        const diplomaticRelation = obtainDiplomaticRelation(empire, empireEvaluation.empire);
                        if (diplomaticRelation != null && diplomaticRelation.type !== DiplomaticRelationType.NotMet) empireEvaluation.firstContactPenalty = FIRST_CONTACT_PENALTY_START_AMOUNT * galaxy.aggressionLevel;
                    }
                }
            }
            title = eventTitle();
            text = gameText('Race Event Description IsolationistsResetFirstContactPenalty');
            break;
        }
        case RaceEventType.MetamorphosisCharacterChange: {
            if (!raceChangePeriodActive(galaxy, race) || characters == null || characters.length <= 0) break;
            const character3 = characters[galaxy.rnd.next(0, characters.length)];
            if (character3 == null || !character3.active) break;
            stellarObject = character3.location;
            let text2 = '';
            if (character3.location !== null) text2 = character3.location.name;
            title = eventTitle();
            if (character3.traits != null && character3.traits.length > 0 && galaxy.rnd.next(0, 2) === 1) {
                const characterTraitType = character3.traits[galaxy.rnd.next(0, character3.traits.length)];
                if (character3.removeTrait(characterTraitType)) {
                    text = gameText('Race Event Description MetamorphosisCharacterChange LoseTrait', character3.name, resolveDescription(CharacterRole, character3.role), text2, resolveDescription(CharacterTraitType, characterTraitType));
                }
                break;
            }
            const characterTraitType2 = pickNewValidTrait(galaxy, character3);
            if (characterTraitType2 !== CharacterTraitType.Undefined && character3.addTrait(characterTraitType2, false, galaxy)) {
                text = gameText('Race Event Description MetamorphosisCharacterChange NewTrait', character3.name, resolveDescription(CharacterRole, character3.role), text2, resolveDescription(CharacterTraitType, characterTraitType2));
            }
            break;
        }
        case RaceEventType.NaturalHarmonyColonyQualityIncreased:
            if (empire.colonies != null) {
                habitat = getRandomHabitatPopulationBelowThreshold(galaxy, empire.colonies, Number.MAX_SAFE_INTEGER, HabitatType.Continental);
                if (habitat !== null && habitat.baseQuality < 1) {
                    const habitat3 = galaxy.determineHabitatSystemStar(habitat);
                    habitat.baseQuality = f(habitat.baseQuality + f(0.01));
                    stellarObject = habitat;
                    title = eventTitle();
                    text = gameText('Race Event Description NaturalHarmonyColonyQualityIncreased', resolveDescription(HabitatType as unknown as Record<number, string>, habitat.type).toLowerCase(), habitat.name, habitat3.name);
                }
            }
            break;
        case RaceEventType.NepthysWineVintage: {
            // new Resource(ResourceSystem.Resources.GetByName("Nepthys Wine").ResourceID) (NullReference if absent).
            const def = galaxy.resourceSystem.resources.find((r) => r != null && r.name === 'Nepthys Wine');
            if (def === undefined) throw new Error('Empire.1.cs 2517: ResourceSystem.Resources.GetByName("Nepthys Wine") returned null');
            const resourceId = def.resourceId;
            if (empire.colonies != null) {
                habitatList = getHabitatsWithResource(empire.colonies, resourceId);
                for (let n = 0; n < habitatList.length; n++) habitatList[n].raceEventType = RaceEventType.NepthysWineVintage;
                empire.raceEventEndDate = raceEventEndDate;
                title = eventTitle();
                text = gameText('Race Event Description NepthysWineVintage');
            }
            break;
        }
        case RaceEventType.PredictiveHistory:
            empire.raceEventType = RaceEventType.PredictiveHistory;
            empire.raceEventEndDate = raceEventEndDate;
            title = eventTitle();
            text = gameText('Race Event Description PredictiveHistory');
            break;
        case RaceEventType.ScientificBreakthroughResearchProgress:
            if (empire.research == null || empire.research.researchQueueEnergy == null || empire.research.researchQueueHighTech == null || empire.research.researchQueueWeapons == null) break;
            researchNode = randomQueueHead(galaxy, empire);
            if (researchNode !== null) {
                researchNode.progress = f(researchNode.progress + f(researchNode.cost * f(0.1)));
                if (researchNode.progress >= researchNode.cost) researchNode.progress = f(researchNode.cost - 1);
                title = eventTitle();
                text = gameText('Race Event Description ScientificBreakthroughResearchProgress', researchNode.def.name);
            }
            break;
        case RaceEventType.SecurityConcernsCharacterReplaced: {
            if (characters == null || characters.length <= 0) break;
            const characterList: Character[] = [];
            characterList.push(...characters);
            if (characterList.length <= 0) break;
            const traits = [
                CharacterTraitType.Drunk,
                CharacterTraitType.Addict,
                CharacterTraitType.Corrupt,
                CharacterTraitType.ForeignSpy,
                CharacterTraitType.DoubleAgent,
                CharacterTraitType.IntelligenceAddict,
                CharacterTraitType.IntelligenceCorrupt,
                CharacterTraitType.Lazy,
            ];
            const charactersWithTraits = getCharactersWithTraits(characterList, traits);
            const character = charactersWithTraits.length <= 0 ? characterList[galaxy.rnd.next(0, characterList.length)] : charactersWithTraits[galaxy.rnd.next(0, charactersWithTraits.length)];
            if (character != null && character.active && (character.role !== CharacterRole.Leader || galaxyStarDate(galaxy) > nextAllowableLeaderChangeDate(empire))) {
                const character2 = generateNewCharacter(galaxy, empire, CharacterRole.IntelligenceAgent, empire.capital).character;
                stellarObject = empire.capital;
                empire.raceEventData = character;
                title = eventTitle();
                text = gameText('Race Event Description SecurityConcernsCharacterReplaced', roleLower(character.role), character.name, character2.name);
                if (character.role === CharacterRole.Leader) empire.lastLeaderChangeDate = galaxyStarDate(galaxy);
                character.kill(galaxy);
            }
            break;
        }
        case RaceEventType.ShakturiArtifactWeaponResearch:
            if (empire.research != null) {
                const researchNodeList = resolveNextProjects(galaxy, empire, empire.dominantRace, IndustryType.Weapon);
                if (researchNodeList != null && researchNodeList.length > 0) {
                    num = galaxy.rnd.next(0, researchNodeList.length);
                    const n = researchNodeList[num];
                    n.progress = f(n.progress + f(f(n.cost - n.progress) / 2));
                    title = eventTitle();
                    text = gameText('Race Event Description ShakturiArtifactWeaponResearch', n.def.name);
                }
            }
            break;
        case RaceEventType.SuppressedKnowledgeLoseResearch:
            if (empire.research == null || empire.research.researchQueueEnergy == null || empire.research.researchQueueHighTech == null || empire.research.researchQueueWeapons == null) break;
            researchNode = randomQueueHead(galaxy, empire);
            if (researchNode !== null) {
                researchNode.progress = f(researchNode.progress / 2);
                title = eventTitle();
                text = gameText('Race Event Description SuppressedKnowledgeLoseResearch', researchNode.def.name);
            }
            break;
        case RaceEventType.SupremeWarriorNewGeneral: {
            if (characters == null || empire.capital === null || empire.colonies == null) break;
            const charactersByRole = getCharactersByRole(characters, CharacterRole.TroopGeneral);
            if (charactersByRole.length < Math.trunc(empire.colonies.length / 3)) {
                const character4 = generateNewCharacter(galaxy, empire, CharacterRole.TroopGeneral, empire.capital).character;
                const list4 = [
                    CharacterTraitType.InspiringPresence,
                    CharacterTraitType.GoodTactician,
                    CharacterTraitType.Energetic,
                    CharacterTraitType.StrongGroundAttacker,
                    CharacterTraitType.StrongGroundDefender,
                    CharacterTraitType.ToughDiscipline,
                    CharacterTraitType.GoodGroundLogistician,
                    CharacterTraitType.NaturalGroundLeader,
                    CharacterTraitType.GoodRecruiter,
                ];
                const num5 = Math.min(3, list4.length);
                for (let l = 0; l < num5; l++) {
                    const trait = list4[galaxy.rnd.next(0, list4.length)];
                    character4.addTrait(trait, true, null);
                }
                stellarObject = character4.location;
                empire.raceEventData = character4;
                title = eventTitle();
                text = gameText('Race Event Description SupremeWarriorNewGeneral', character4.name);
            }
            break;
        }
        case RaceEventType.SwarmsFullTroopTransport: {
            if (!raceChangePeriodActive(galaxy, race) || empire.capital === null) break;
            const builtObject = generateNewShip(galaxy, empire, BuiltObjectSubRole.TroopTransport, empire.capital);
            if (builtObject === null) break;
            const num2 = Math.trunc(builtObject.troopCapacity / 100);
            for (let k = 0; k < num2; k++) {
                // Capital.GenerateNewTroop() → GenerateNewTroop(IdentifyStrongestRaceAttackTroop(), false) (Habitat.cs 7011).
                const capital = empire.capital;
                const troop = habitatGenerateNewTroop(galaxy, capital, TroopType.Infantry, capital.empire !== null ? identifyStrongestRaceAttackTroop(capital.empire) : null, false);
                if (troop !== null) {
                    (troop.colony as Habitat).troops!.remove(troop);
                    troop.readiness = 100;
                    troop.builtObject = builtObject;
                    builtObject.troops!.add(troop);
                    if (!empire.troops.items.includes(troop)) empire.troops.add(troop);
                }
            }
            stellarObject = builtObject;
            title = eventTitle();
            text = gameText('Race Event Description SwarmsFullTroopTransport', empire.capital.name);
            break;
        }
        case RaceEventType.TodashGalacticChampionships:
            empire.raceEventType = RaceEventType.TodashGalacticChampionships;
            empire.raceEventEndDate = raceEventEndDate;
            setRaceEventForAllColonies(empire, RaceEventType.TodashGalacticChampionships);
            title = eventTitle();
            text = gameText('Race Event Description TodashGalacticChampionships', empire.capital!.name);
            break;
        case RaceEventType.UnderwaterLeviathan:
            if (empire.colonies != null) {
                habitat = getRandomHabitatPopulationBelowThreshold(galaxy, empire.colonies, 100000000, HabitatType.Ocean);
                if (habitat !== null && habitat.population != null && habitat.population.items.length > 0) {
                    let amount2 = habitat.population.items[0].amount;
                    amount2 = Math.trunc(amount2 / 6) + galaxy.rnd.next(0, Math.trunc(amount2 / 6));
                    habitat.population.items[0].amount -= amount2;
                    habitat.population.recalculateTotalAmount();
                    habitat.damage = f(habitat.damage + f(f(0.05) + f(galaxy.rnd.nextDouble() * 0.05)));
                    stellarObject = habitat;
                    title = eventTitle();
                    text = gameText('Race Event Description UnderwaterLeviathan', habitat.name);
                }
            }
            break;
        case RaceEventType.WarriorWaveTroopRecruitment:
            setRaceEventForAllColonies(empire, RaceEventType.WarriorWaveTroopRecruitment);
            empire.raceEventEndDate = raceEventEndDate;
            title = eventTitle();
            text = gameText('Race Event Description WarriorWaveTroopRecruitment');
            break;
        case RaceEventType.XenophobiaNoAssimilate: {
            if (empire.colonies == null) break;
            empire.raceEventType = RaceEventType.XenophobiaNoAssimilate;
            empire.raceEventEndDate = raceEventEndDate;
            for (let i = 0; i < empire.colonies.length; i++) {
                empire.colonies[i].raceEventType = RaceEventType.XenophobiaNoAssimilate;
                if (empire.colonies[i].colonyPopulationPolicy === ColonyPopulationPolicy.Assimilate) empire.colonies[i].colonyPopulationPolicy = ColonyPopulationPolicy.DoNotAccept;
                if (empire.colonies[i].colonyPopulationPolicyRaceFamily === ColonyPopulationPolicy.Assimilate) empire.colonies[i].colonyPopulationPolicyRaceFamily = ColonyPopulationPolicy.DoNotAccept;
            }
            title = eventTitle();
            text = gameText('Race Event Description XenophobiaNoAssimilate');
            break;
        }
    }
    void habitatList;
    if (text !== '') sendEventMessageToEmpire(empire, EventMessageType.RaceEvent, title, text, raceEvent.type, stellarObject);
}

// ---------------------------------------------------------------------------
// Empire.1.cs 2811 ReviewEmpireEvents / 1092 InitiateEmpireSplit
// ---------------------------------------------------------------------------

/**
 * Empire.1.cs 2811 ReviewEmpireEvents. Rnd: DoRaceEvent (when race events are enabled and none is running), then the split /
 * rogue-fleet rolls (big unhappy empires, 4 years after the last disaster), the disaster rolls (Next(0, 20), Next(0, 15) ×3)
 * and a final Next(0, 20) resource appearance.
 */
export function reviewEmpireEvents(galaxy: Galaxy, empire: Empire): void {
    // DominantRace == _Galaxy.ShakturiActualRace: the Shakturi story race is only set by story events (deferred, plan §0.3);
    // null otherwise, and DominantRace is never null for a normal empire.
    const shakturiActualRace: Race | null = null;
    if (empire.dominantRace === shakturiActualRace) return;
    if (galaxy.gameRaceSpecificEventsEnabled && empire.raceEventEndDate < galaxyStarDate(galaxy)) doRaceEvent(galaxy, empire, empire.dominantRace);
    const num = (calculateRelativeEmpireSize(galaxy, empire) + calculateRelativeEmpireMilitaryStrength(galaxy, empire)) / 2.0;
    const currentStarDate = galaxyStarDate(galaxy);
    const num2 = empire.lastDisasterDate + REAL_SECONDS_IN_GALACTIC_YEAR * 1000 * 4;
    if (num > 2.5 && empire.colonies.length > 5 && currentStarDate > num2) {
        const colonyApproval = colonyApprovalAverage(galaxy, empire);
        let num3 = 1.0;
        if (empire.dominantRace !== null) num3 = calculateRacialReputationConcern(empire.dominantRace);
        const num4 = empire.civilityRating / 2.0 / num3;
        let num5 = num4 + colonyApproval;
        const gov = empireGovernmentAttributes(empire);
        if (gov !== null) num5 += 5.0 * (gov.stability - 1.0);
        if (num5 < -3.0 && galaxy.rnd.next(0, 5) === 1) {
            const splinterPortion = 0.2 + galaxy.rnd.nextDouble() * 0.25;
            initiateEmpireSplitRandom(galaxy, empire, splinterPortion);
            return;
        }
        if (num5 < 0.0 && galaxy.rnd.next(0, 5) === 1) {
            empireEventRogueFleetDefects(galaxy, empire);
            return;
        }
    }
    if (num > 1.0 && empire.colonies.length > 5 && galaxy.gameDisasterEventsEnabled && currentStarDate > num2) {
        if (galaxy.rnd.next(0, 20) === 1) {
            empireEventPlagueRandom(galaxy, empire);
            return;
        }
        if (galaxy.rnd.next(0, 15) === 1) {
            empireEventColonyNaturalDisasterRandom(galaxy, empire);
            return;
        }
        if (galaxy.rnd.next(0, 15) === 1) {
            empireEventColonyResourceDepletionRandom(galaxy, empire);
            return;
        }
        if (empire.stateMoney > 0.0) {
            const num6 = (empire.stateMoney / totalStateMoneyInGalaxy(galaxy)) * galaxy.empires.length;
            if (num6 > 4.0 && galaxy.rnd.next(0, 15) === 1) {
                empireEventEconomicCrisis(galaxy, empire);
                return;
            }
        }
    }
    if (galaxy.rnd.next(0, 20) === 1 && galaxy.gameDisasterEventsEnabled) empireEventColonyResourceAppearanceRandom(galaxy, empire);
}

/** Empire.1.cs 1092 InitiateEmpireSplit(splinterPortion). Rnd: Next(0, 4) + InitiateEmpireSplit(portion, declareWar)'s. */
function initiateEmpireSplitRandom(galaxy: Galaxy, empire: Empire, splinterPortion: number): void {
    let declareWar = false;
    if (galaxy.rnd.next(0, 4) > 0) declareWar = true;
    initiateEmpireSplit(galaxy, empire, splinterPortion, declareWar);
}

/**
 * Empire.1.cs 1102 InitiateEmpireSplit(splinterPortion, declareWar) → 2883 SplinterEmpire: a new empire is created at runtime
 * around the colony nearest a random point ≥ 4.5 sectors from the capital (ObtainRandomGalaxyCoordinates Rnd), takes a share
 * of the colonies, ships (ConsiderTakeoverOfBuiltObject Rnd per ship) and fleets (NextDouble per fleet), then war / incident
 * penalties and messages. TODO(port) M4u: runtime empire creation (the ownership transfers it needs — TakeOwnershipOfColony /
 * TakeOwnershipOfBuiltObject, combat/ownership.ts — are ported by M4q), Research.Clone,
 * MergeGalaxyMap, ChangeGovernment / GenerateEmpireName — reached only 4+ years in, by very unhappy large empires.
 */
export function initiateEmpireSplit(galaxy: Galaxy, empire: Empire, splinterPortion: number, declareWar: boolean): void {
    void galaxy;
    void empire;
    void splinterPortion;
    void declareWar;
    throw new Error('TODO(port) M4q/M4l: Empire.1.cs 1102 InitiateEmpireSplit / 2883 SplinterEmpire (runtime empire creation)');
}

// ---------------------------------------------------------------------------
// Empire.7.cs 3408-3834 special pirate / pre-warp progress events
// ---------------------------------------------------------------------------

/**
 * Empire.PreWarpProgressEventOccurred<event> (Empire.cs, 13 bools). TS: per-event flags in
 * empire.preWarpProgressEventOccurredFlags, or all of them when the game-start aggregate `preWarpProgressEventsOccurred`
 * is set (Start.2.cs 1122-1137 / pirate generation set all 13).
 */
export function preWarpProgressEventOccurred(empire: Empire, eventType: PreWarpProgressEventType): boolean {
    return empire.preWarpProgressEventsOccurred || empire.preWarpProgressEventOccurredFlags[eventType] === true;
}

function setPreWarpProgressEventOccurred(empire: Empire, eventType: PreWarpProgressEventType): void {
    empire.preWarpProgressEventOccurredFlags[eventType] = true;
}

/** Empire.7.cs 3408 CheckReviewSpecialPirateEvents. Rnd: none on its own (the FirstPirateRaid case draws none). */
export function checkReviewSpecialPirateEvents(galaxy: Galaxy, empire: Empire): void {
    if (empire.pirateExtortionOfferMade && !preWarpProgressEventOccurred(empire, PreWarpProgressEventType.FirstPirateRaid) && empire.capital !== null) {
        checkSendPreWarpProgressEventMessage(galaxy, empire, PreWarpProgressEventType.FirstPirateRaid, empire.capital, null, 'avoid');
    }
}

/** ResearchNode.Components[0] / ComponentImprovements[0].ImprovedComponent (Empire.7.cs 3470-3480) as { name }. */
function researchNodeComponent(galaxy: Galaxy, researchNode: TechNode): { componentId: number; name: string } | null {
    let id = -1;
    if (researchNode.def.components != null && researchNode.def.components.length > 0) id = researchNode.def.components[0];
    else if (researchNode.def.componentImprovements != null && researchNode.def.componentImprovements.length > 0) id = researchNode.def.componentImprovements[0].componentId;
    if (id < 0) return null;
    const c = galaxy.researchStatic?.componentsById.get(id);
    return { componentId: id, name: c?.name ?? '' };
}

/**
 * Empire.7.cs 3416/3421/3426 CheckSendPreWarpProgressEventMessage(eventType, subject[, empire[, hint]]). Rnd:
 * BuildFirstResearchStation Next(0, 2), DiscoverHyperspaceTech Next(0, 3) (+ GenerateNewCharacter's); the story branches
 * (Galaxy.StoryShadowsEnabled) are deferred (plan §0.3) and throw when enabled.
 */
export function checkSendPreWarpProgressEventMessage(galaxy: Galaxy, self: Empire, eventType: PreWarpProgressEventType, subject: unknown, empire: Empire | null = null, hint = ''): boolean {
    if (self === galaxy.independentEmpire) return false;
    let stellarObject: StellarObject | null = null;
    let builtObject: BuiltObject | null = null;
    let habitat: Habitat | null = null;
    let creature: Creature | null = null;
    let component: { componentId: number; name: string } | null = null;
    if (subject instanceof BuiltObjectClass) {
        builtObject = subject;
        stellarObject = subject;
    } else if (subject instanceof HabitatClass) {
        habitat = subject;
        stellarObject = subject;
    } else if (subject instanceof CreatureClass) {
        creature = subject;
        stellarObject = subject as unknown as StellarObject;
    } else if (subject instanceof EmpireClass) {
        empire = subject;
    } else if (subject !== null && typeof subject === 'object' && 'def' in subject && 'isResearched' in subject) {
        component = researchNodeComponent(galaxy, subject as TechNode);
    }
    switch (eventType) {
        case PreWarpProgressEventType.FirstPirateRaid:
            if (preWarpProgressEventOccurred(self, eventType)) break;
            if (habitat !== null) {
                let arg = '';
                if (empire !== null) arg = empire.name;
                const text16 = gameText('PreWarpProgressEvent Title ExperienceFirstPirateRaid');
                let message11 = gameText('PreWarpProgressEvent Message ExperienceFirstPirateRaid', habitat.name, arg);
                if (hint === 'avoid') message11 = gameText('PreWarpProgressEvent Message AvoidFirstPirateRaid', habitat.name);
                sendEventMessageToEmpire(self, EventMessageType.GeneralDiscovery, text16, message11, subject, subject);
            }
            setPreWarpProgressEventOccurred(self, eventType);
            return true;
        case PreWarpProgressEventType.BuildFirstMiningStation:
            if (!preWarpProgressEventOccurred(self, eventType)) {
                if (builtObject !== null && builtObject.parentHabitat !== null) {
                    self.economyEfficiency += 0.25;
                    const text15 = gameText('PreWarpProgressEvent Title BuildFirstMiningStation');
                    const message10 = gameText('PreWarpProgressEvent Message BuildFirstMiningStation', builtObject.name, builtObject.parentHabitat.name);
                    sendEventMessageToEmpire(self, EventMessageType.GeneralDiscovery, text15, message10, subject, subject);
                }
                setPreWarpProgressEventOccurred(self, eventType);
                return true;
            }
            break;
        case PreWarpProgressEventType.BuildFirstResearchStation:
            if (preWarpProgressEventOccurred(self, eventType)) break;
            if (builtObject !== null) {
                if (galaxy.rnd.next(0, 2) > 0) {
                    const character = generateNewCharacter(galaxy, self, CharacterRole.Scientist, builtObject).character;
                    const text5 = gameText('PreWarpProgressEvent Title BuildFirstResearchStation');
                    const message4 = gameText('PreWarpProgressEvent Message BuildFirstResearchStation New Scientist', character.name);
                    sendEventMessageToEmpire(self, EventMessageType.GeneralDiscovery, text5, message4, character, character);
                } else {
                    self.economyEfficiency += 0.15;
                    const text6 = gameText('PreWarpProgressEvent Title BuildFirstResearchStation');
                    const message5 = gameText('PreWarpProgressEvent Message BuildFirstResearchStation', builtObject.name);
                    sendEventMessageToEmpire(self, EventMessageType.GeneralDiscovery, text6, message5, subject, subject);
                }
            }
            setPreWarpProgressEventOccurred(self, eventType);
            return true;
        case PreWarpProgressEventType.BuildFirstMilitaryShip:
            if (preWarpProgressEventOccurred(self, eventType)) break;
            if (builtObject !== null) {
                const text18 = gameText('PreWarpProgressEvent Title BuildFirstMilitaryShip');
                const message13 = gameText('PreWarpProgressEvent Message BuildFirstMilitaryShip', builtObject.name);
                sendEventMessageToEmpire(self, EventMessageType.GeneralDiscovery, text18, message13, subject, subject);
                if (galaxy.storyShadowsEnabled) {
                    // Empire.7.cs 3555-3611: pirate raid on the first colony / mining station (story "Shadows").
                    throw new Error('TODO(port) deferred (story events, plan §0.3): Empire.7.cs 3555 BuildFirstMilitaryShip Shadows raid');
                }
            }
            setPreWarpProgressEventOccurred(self, eventType);
            return true;
        case PreWarpProgressEventType.BuildFirstShip:
            if (!preWarpProgressEventOccurred(self, eventType)) {
                if (builtObject !== null) {
                    const text17 = gameText('PreWarpProgressEvent Title BuildFirstShip');
                    const message12 = gameText('PreWarpProgressEvent Message BuildFirstShip', builtObject.name);
                    sendEventMessageToEmpire(self, EventMessageType.GeneralDiscovery, text17, message12, subject, subject);
                }
                setPreWarpProgressEventOccurred(self, eventType);
                return true;
            }
            break;
        case PreWarpProgressEventType.BuildFirstSpaceport:
            if (!preWarpProgressEventOccurred(self, eventType)) {
                if (builtObject !== null) {
                    self.economyEfficiency += 0.25;
                    const text12 = gameText('PreWarpProgressEvent Title BuildFirstSpaceport');
                    const text13 = gameText('PreWarpProgressEvent Message BuildFirstSpaceport');
                    sendEventMessageToEmpire(self, EventMessageType.GeneralDiscovery, text12, text13, subject, subject);
                }
                setPreWarpProgressEventOccurred(self, eventType);
                return true;
            }
            break;
        case PreWarpProgressEventType.DiscoverColonizationTech:
            if (!preWarpProgressEventOccurred(self, eventType)) {
                if (component !== null) {
                    self.economyEfficiency += 0.5;
                    const text4 = gameText('PreWarpProgressEvent Title DiscoverColonizationTech');
                    const message3 = gameText('PreWarpProgressEvent Message DiscoverColonizationTech', component.name);
                    sendEventMessageToEmpire(self, EventMessageType.GeneralDiscovery, text4, message3, component, component);
                }
                setPreWarpProgressEventOccurred(self, eventType);
                return true;
            }
            break;
        case PreWarpProgressEventType.DiscoverHyperspaceTech:
            if (!preWarpProgressEventOccurred(self, eventType)) {
                if (galaxy.rnd.next(0, 3) > 0) {
                    const character2 = generateNewCharacter(galaxy, self, CharacterRole.Scientist, self.capital).character;
                    const text9 = gameText('PreWarpProgressEvent Title DiscoverHyperspaceTech');
                    const message8 = gameText('PreWarpProgressEvent Message DiscoverHyperspaceTech New Scientist', character2.name);
                    sendEventMessageToEmpire(self, EventMessageType.GeneralDiscovery, text9, message8, character2, character2);
                } else {
                    self.economyEfficiency += 0.15;
                    const text10 = gameText('PreWarpProgressEvent Title DiscoverHyperspaceTech');
                    const text11 = gameText('PreWarpProgressEvent Message DiscoverHyperspaceTech');
                    sendEventMessageToEmpire(self, EventMessageType.GeneralDiscovery, text10, text11, component, component);
                }
                setPreWarpProgressEventOccurred(self, eventType);
                return true;
            }
            break;
        case PreWarpProgressEventType.EncounterFirstKaltor:
            if (preWarpProgressEventOccurred(self, eventType)) break;
            if (creature !== null) {
                const habitat6 = galaxy.findNearestHabitatOfType(creature.xpos, creature.ypos, HabitatType.Undefined);
                if (habitat6 !== null) {
                    const text14 = gameText('PreWarpProgressEvent Title EncounterFirstKaltor');
                    const message9 = gameText('PreWarpProgressEvent Message EncounterFirstKaltor', habitat6.name);
                    sendEventMessageToEmpire(self, EventMessageType.GeneralDiscovery, text14, message9, subject, subject);
                }
            }
            setPreWarpProgressEventOccurred(self, eventType);
            return true;
        case PreWarpProgressEventType.FirstContactNormalEmpire:
            if (preWarpProgressEventOccurred(self, eventType)) break;
            if (empire !== null) {
                const flag = false;
                if (galaxy.storyShadowsEnabled && empire.pirateEmpireBaseHabitat === null) {
                    // Empire.7.cs 3702-3717: a hostile neighbour declares war (story "Shadows").
                    throw new Error('TODO(port) deferred (story events, plan §0.3): Empire.7.cs 3702 FirstContactNormalEmpire Shadows war');
                }
                if (flag) {
                    // (the Shadows war message; unreachable while the branch above is deferred)
                } else {
                    const text8 = gameText('PreWarpProgressEvent Title FirstContactNormalEmpire');
                    const message7 = gameText('PreWarpProgressEvent Message FirstContactNormalEmpire', empire.name, empire.dominantRace!.name);
                    sendEventMessageToEmpire(self, EventMessageType.GeneralDiscovery, text8, message7, subject, subject);
                }
            }
            setPreWarpProgressEventOccurred(self, eventType);
            return true;
        case PreWarpProgressEventType.FirstContactPirateOrIndependent:
            if (!preWarpProgressEventOccurred(self, eventType) && empire !== null && stellarObject !== null && empire === galaxy.independentEmpire) {
                const text19 = gameText('PreWarpProgressEvent Title FirstContactIndependent');
                if ((stellarObject as { empire: Empire | null }).empire === empire) {
                    const message14 = gameText('PreWarpProgressEvent Message FirstContactIndependent', stellarObject.name);
                    sendEventMessageToEmpire(self, EventMessageType.GeneralDiscovery, text19, message14, stellarObject, stellarObject);
                } else {
                    const text20 = gameText('PreWarpProgressEvent Message FirstContactIndependent NoShip');
                    sendEventMessageToEmpire(self, EventMessageType.GeneralDiscovery, text19, text20, null, stellarObject);
                }
                setPreWarpProgressEventOccurred(self, eventType);
                return true;
            }
            break;
        case PreWarpProgressEventType.FirstHyperjump:
            if (preWarpProgressEventOccurred(self, eventType)) break;
            if (builtObject !== null) {
                const habitat2: Habitat | null = null;
                if (galaxy.storyShadowsEnabled) {
                    // Empire.7.cs 3764-3809: Kaltor outbreak site, pirate raids on the capital, the player warning (story "Shadows").
                    throw new Error('TODO(port) deferred (story events, plan §0.3): Empire.7.cs 3764 FirstHyperjump Shadows events');
                }
                // habitat2 stays null without the story branch, so the creature-outbreak message (3810-3820) is not reached.
                void habitat2;
                const text3 = gameText('PreWarpProgressEvent Title FirstHyperjump');
                const message2 = gameText('PreWarpProgressEvent Message FirstHyperjump', builtObject.name);
                sendEventMessageToEmpire(self, EventMessageType.GeneralDiscovery, text3, message2, subject, subject);
            }
            setPreWarpProgressEventOccurred(self, eventType);
            return true;
    }
    return false;
}
