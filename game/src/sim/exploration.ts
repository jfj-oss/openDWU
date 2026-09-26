// M4t — visibility, exploration, scanning, first contact, territory scheduling (tasks/M4-plan.md §3.3 row M4t).
//
// Ports (C# `this` first, free functions):
//   Empire.2.cs 3880 UpdateSystemExplorationStatus, 3918 ClearExpiredViewableEmpires, Empire.9.cs 4568
//   CountExplorationShips; Empire.1.cs 979 CheckKnownPirateBases, 1060 MergeGalaxyMapsForSharedVisibilityEmpires,
//   1072 MergeKnownPirateBasesForSharedVisibilityEmpires; Empire.cs 4734 ExertCulturalInfluence;
//   BuiltObject.1.cs 2034 ScanArea, 1935 ScanForLocations; BuiltObject.cs 3855 ReviewSystemVisibilityForPreWarpShip;
//   Habitat.cs 2504 CheckForShipsDiscoveringRuins, 2615 CheckForShipsOfNewEmpiresInSystem (+ 2623
//   PerformThreatEvaluation); Galaxy.7.cs 3957 DoEmpireEncounter / 3982 DoSingleEmpireEncounter; Galaxy.4.cs 3700
//   MergeGalaxyMap (Empire-level, with the first-contact and pirate-base parts visibility.ts leaves out);
//   Galaxy.5.cs 3951 CheckRuinsHaveBenefit, 3942 CheckRuinBonuses; Galaxy.5.cs 3166 GetHabitatsAtLocation;
//   Galaxy.cs 3376-3423 ReviewEmpireTerritory / ReviewEmpireTerritoryCore (synchronous here); Empire.4.cs 4408-4447
//   CanEmpireColonizeHabitat(+Range) (read by Galaxy.UpdateSystemInfo(playerEmpire)); Empire.cs 4341
//   GenerateBuiltObjectFromDesign; Empire.10.cs 3372 ObtainDesignSpec; BaconBuiltObject.cs 3536 AddScientificData.
//
// Messages: Empire.SendEventMessageToEmpire (Empire.7.cs 3400) only forwards to the UI's EventMessageRecipient (null
// headless); InvestigateRuins calls it (events.ts), the other entry points omit those calls (no state, no Rnd).
// Empire.SendMessageToEmpire calls are kept (messages.ts queue) with GameText keys as descriptions (TextResolver is not
// ported; M9). Scripted game events: CheckTriggerEvent / GetMatchingGameEventId* are story/eventActions.ts.

import { doSingleEmpireEncounterShakturiStory, checkForStoryLocationHint, investigateRuinsStoryClue, investigateRuinsStoryEvent } from './story/storyEvents';
import { resolveDescription } from './messages';
import { EventMessageType, DisasterEventType, RaceEventType } from './eventTypes';
import { sendEventMessageToEmpire, sendNewsBroadcast } from './events';
import { pirateEconomyPerformIncome } from './pirates/pirateAI';
import { PirateIncomeType } from './pirates/pirateEconomy';
import { selectRandomNextResearchProjectExcludeSuperWeapons } from './construction/constructionQueue';
import { doResearchBreakthrough, reviewDesignsBuiltObjectsImprovedComponents } from './researchTick';
import { fastFindNearestUnexploredHabitat, findLonelyColonyLocation } from './civilianAI';
import { CreatureType } from './creature';
import { findNearestPirateFaction } from './pirates';
import { generatePirateShip } from './story/eventActions';
import { assignMission } from './missions/assign';
import { BuiltObjectMissionPriority, BuiltObjectMissionType } from './missions/mission';
import { findNodeById } from './researchSystem';
import { getGovernmentsStatic } from './empire';
import { determineMostSuitableGovernmentTypes } from './game';
import { haveRevolution } from './treasury';
import { generateAbandonedBuiltObject, BuiltObjectEncounterAction } from './gameStartTail';
import { resolveSectorDescription, raceEventsContainsEventType } from './empireEvents';
import { addLocationHint } from './tradeItems';
import { makeHabitatIntoColonyRuntime } from './missions/cmdTroops';
import { Population, PopulationList } from './population';
import { takeOwnershipOfColonyFull } from './combat/ownership';
import { REAL_SECONDS_IN_GALACTIC_YEAR } from './tick/simTime';
import { resolveSubRoleDescription } from './designGeneration';
import { checkTriggerEvent, getMatchingGameEventIdEmpireEncounter } from './story/eventActions';
import { EventTriggerType } from './story/gameEventModel';
import type { Galaxy } from './galaxy';
import type { Empire } from './empire';
import { BuiltObject } from './builtObject';
import type { Design } from './design';
import { HabitatCategoryType, planetsOf, type Habitat, type HabitatType } from './types';
import { registerTodo, todo } from './tick/todo';
import { galaxyStarDate } from './tick/simTime';
import { MAX_SOLAR_SYSTEM_SIZE, SystemVisibilityStatus } from './visibility';
import { getBuiltObjectsAtLocation, determineClosestIndexEdgesCustom } from './stationPlacement';
import { BuiltObjectSubRole } from './builtObjectTypes';
import { ComponentType } from './data/components';
import { RuinType, type Ruin } from './ruins';
import { DiplomaticRelation, DiplomaticRelationType, obtainDiplomaticRelation } from './diplomacy';
import { PirateRelationType, changePirateRelation, changePirateRelationThisSideOnly, obtainPirateRelation } from './pirateRelations';
import { empireApprovalRating, obtainEmpireEvaluation, type EmpireEvaluation } from './taxes';
import { EmpireMessageType, sendMessageToEmpire } from './messages';
import { changeDiplomaticRelation } from './diplomacyTick';
import { checkSendPreWarpProgressEventMessage } from './events';
import { evaluateSystemThreats, fastFindNearestColony } from './combat/threats';
import { reviewEmpireAbilityBonuses } from './treasury';
import { determineEmpireSystems } from './forceStructure';
import { strategicValue } from './territory';
import { generateDesignFromSpec } from './designGeneration';
import { selectRandomRace } from './pirates';
import { gameText } from './colonyTick';
import { baconSettings } from './data/baconSettings';

// ---------------------------------------------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------------------------------------------

/** PreWarpProgressEventType.cs (byte enum, declaration order). */
export enum PreWarpProgressEventType {
    Undefined,
    FirstContactPirateOrIndependent,
    FirstContactNormalEmpire,
    BuildFirstShip,
    BuildFirstSpaceport,
    BuildFirstMiningStation,
    BuildFirstResearchStation,
    DiscoverHyperspaceTech,
    DiscoverColonizationTech,
    FirstHyperjump,
    EncounterFirstKaltor,
    BuildFirstMilitaryShip,
    FirstPirateRaid,
}

// Galaxy.cs 729 ColonizationRangeEnforceLimit = true / 732 ColonizationRange = 3000000f (game options).
// TODO(port): these are Galaxy game options; createGame does not expose them yet — the C# defaults are used.
const COLONIZATION_RANGE_ENFORCE_LIMIT = true;
const COLONIZATION_RANGE = 3000000;

/** Galaxy.3.cs 5008 HabitatToEmpireMinimumIntelligence. */
const HABITAT_TO_EMPIRE_MINIMUM_INTELLIGENCE = 69;

/** EmpireEvaluation.cs 49 FirstContactPenaltyStartAmount. */
const FIRST_CONTACT_PENALTY_START_AMOUNT = -15.0;

// BaconBuiltObject.cs 58-59 scientificDataForResourceSurvey / scientificDataForRuins: BaconSettings.txt statics
// (BaconMain.cs 750 / 754), read from `baconSettings`.

/**
 * ComponentStatus.Normal (ComponentStatus.cs: Unbuilt 0, Normal 1, Damaged 2). Combat verification 2026-09-26: this was 0
 * (Unbuilt), so every ship from GenerateBuiltObjectFromDesign (Empire.cs 4346 sets Normal) was born with all components
 * unbuilt — no engines, reactor, weapons or troop bays.
 */
const COMPONENT_STATUS_NORMAL = 1;


// ---------------------------------------------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------------------------------------------

/**
 * Galaxy.5.cs 3166 GetHabitatsAtLocation(x, y, range): the index cell of (x, y), plus — when the nearest cell edge
 * is closer than `range` — the adjacent cells towards it. Without the extra cells the C# returns the index list
 * itself (callers only read it); so does the TS.
 */
export function getHabitatsAtLocation(galaxy: Galaxy, x: number, y: number, range: number): Habitat[] {
    const idx = galaxy.resolveIndex(x, y); // (int)x / IndexSize + CorrectIndexCoords
    const x2 = idx.x;
    const y2 = idx.y;
    const grid = galaxy.habitatIndexGrid;
    let habitatList: Habitat[] = grid[x2][y2];
    const e = determineClosestIndexEdgesCustom(galaxy, Math.trunc(x), Math.trunc(y), x2, x2, y2, y2);
    if (e.d < range) {
        const num2 = x2 + e.nearestX;
        const num3 = y2 + e.nearestY;
        habitatList = [];
        habitatList.push(...grid[x2][y2]);
        if (num3 < galaxy.indexMaxY && num3 >= 0) habitatList.push(...grid[x2][num3]);
        if (num2 < galaxy.indexMaxX && num2 >= 0) habitatList.push(...grid[num2][y2]);
        if (num2 < galaxy.indexMaxX && num2 >= 0 && num3 < galaxy.indexMaxY && num3 >= 0) habitatList.push(...grid[num2][num3]);
    }
    return habitatList;
}

/** HabitatResourceList.cs 146 HasSuperLuxuryResources: any resource with IsRestrictedResource. */
export function habitatResourcesHaveSuperLuxury(galaxy: Galaxy, habitat: Habitat): boolean {
    for (let index = 0; index < habitat.resources.length; index++) {
        const r = habitat.resources[index];
        if (r != null && isRestrictedResource(galaxy, r.resourceId)) return true;
    }
    return false;
}

/** Resource.cs 34 IsRestrictedResource (SuperLuxuryBonusAmount > 0). */
function isRestrictedResource(galaxy: Galaxy, resourceId: number): boolean {
    return galaxy.resourceSystem.resources[resourceId].superLuxuryBonusAmount > 0;
}

/** Empire.4.cs 4408 CanEmpireColonizeHabitatRange(empire, habitat). */
export function canEmpireColonizeHabitatRange(galaxy: Galaxy, empire: Empire, habitat: Habitat): boolean {
    let result = false;
    if (COLONIZATION_RANGE_ENFORCE_LIMIT) {
        const habitat2 = fastFindNearestColony(galaxy, habitat.xpos, habitat.ypos, empire, 0);
        if (habitat2 !== null) {
            const num = galaxy.calculateDistance(habitat.xpos, habitat.ypos, habitat2.xpos, habitat2.ypos);
            if (num <= COLONIZATION_RANGE) result = true;
        } else {
            result = true;
        }
    } else {
        result = true;
    }
    return result;
}

/**
 * Empire.4.cs 4434/4439 CanEmpireColonizeHabitat(empire, habitat, colonizableHabitatTypes, latestColonyShip,
 * checkRange = true). `self` is the C# `this` (the design and range checks use it; the rest reads `empire`).
 */
export function canEmpireColonizeHabitat(
    galaxy: Galaxy,
    self: Empire,
    empire: Empire,
    habitat: Habitat,
    colonizableHabitatTypes: readonly HabitatType[],
    latestColonyShip: Design | null,
    checkRange = true,
): boolean {
    let result = false;
    if (
        empire.visibility.checkSystemExplored(habitat.systemIndex) &&
        (habitat.owner === null || habitat.owner === galaxy.independentEmpire) &&
        galaxy.checkEmpireTerritoryCanColonizeHabitat(empire, habitat) &&
        ((latestColonyShip !== null && self.canDesignColonizeHabitat(latestColonyShip, habitat)) || colonizableHabitatTypes.includes(habitat.type)) &&
        (habitat.category === HabitatCategoryType.Planet || habitat.category === HabitatCategoryType.Moon)
    ) {
        result = !checkRange || canEmpireColonizeHabitatRange(galaxy, self, habitat);
    }
    return result;
}

/** FastFindNearestSystem + the `> MaxSolarSystemSize * 2.1` discard (Galaxy.7.cs 4004-4014 / 4211-4221): the name. */
function nearestSystemNameForDiscovery(galaxy: Galaxy, discoveryLocation: DiscoveryLocation | null): string {
    let habitat: Habitat | null = null;
    if (discoveryLocation !== null) {
        habitat = galaxy.fastFindNearestSystem(discoveryLocation.xpos, discoveryLocation.ypos);
        if (habitat !== null) {
            const num = galaxy.calculateDistance(habitat.xpos, habitat.ypos, discoveryLocation.xpos, discoveryLocation.ypos);
            if (num > MAX_SOLAR_SYSTEM_SIZE * 2.1) habitat = null;
        }
    }
    return habitat !== null ? habitat.name : '';
}

/** EmpireEvaluation.FirstContactPenalty (double, EmpireEvaluation.cs 35; diplomacy.ts EmpireEvaluation). */
function setFirstContactPenalty(evaluation: EmpireEvaluation, value: number): void {
    evaluation.firstContactPenalty = value;
}

/** BaconBuiltObject.cs 3536 AddScientificData(ship, planet, eventType). No Rnd. */
function addScientificData(ship: BuiltObject, planet: Habitat, eventType: 'scanArea' | 'scientificData'): void {
    const hasLab = (type: ComponentType): boolean => ship.components.items.some((x) => x.type === type);
    // C# precedence: A || (B && C) || (D && E) || (!lab1 && !lab2 && !lab3).
    if (
        ship.subRole !== BuiltObjectSubRole.ExplorationShip ||
        (eventType === 'scanArea' && planet.resources == null) ||
        (planet.resources != null && planet.resources.length === 0) ||
        (!hasLab(ComponentType.LabsWeaponsLab) && !hasLab(ComponentType.LabsEnergyLab) && !hasLab(ComponentType.LabsHighTechLab))
    ) {
        return;
    }
    if (ship.baconValues === null) ship.baconValues = new Map<string, unknown>();
    if (!ship.baconValues.has('scientificData')) ship.baconValues.set('scientificData', 0);
    const baconValue = ship.baconValues.get('scientificData') as number;
    let num: number;
    switch (eventType) {
        case 'scanArea':
            ship.baconValues.set('scientificData', planet.resources.length * baconSettings.scientificDataForResourceSurvey + baconValue);
            return;
        case 'scientificData':
            num = planet.ruin !== null ? (!planet.ruin.playerEmpireEncountered ? 1 : 0) : 0;
            break;
        default:
            num = 0;
            break;
    }
    if (num === 0) return;
    ship.baconValues.set('scientificData', baconSettings.scientificDataForRuins + baconValue);
}

/** Empire.10.cs 3372 ObtainDesignSpec(subRole): the first of Empire._DesignSpecifications with that sub-role. */
function obtainDesignSpec(empire: Empire, subRole: BuiltObjectSubRole) {
    for (let i = 0; i < empire.designSpecifications.length; i++) {
        const designSpecification = empire.designSpecifications[i];
        if (designSpecification !== null && designSpecification.subRole === subRole) return designSpecification;
    }
    return null;
}

/**
 * Empire.cs 4341 GenerateBuiltObjectFromDesign(design, name, isState, x, y). Rnd: a colony ship draws
 * SelectRandomRace(HabitatToEmpireMinimumIntelligence).
 */
export function generateBuiltObjectFromDesign(galaxy: Galaxy, empire: Empire, design: Design, name: string, isState: boolean, x: number, y: number): BuiltObject {
    const builtObject = new BuiltObject(design, name, galaxy);
    for (let i = 0; i < builtObject.components.count; i++) {
        builtObject.components.items[i].status = COMPONENT_STATUS_NORMAL;
    }
    builtObject.builtObjectID = galaxy.getNextBuiltObjectID();
    builtObject.empire = empire;
    builtObject.xpos = x;
    builtObject.ypos = y;
    if (design.subRole === BuiltObjectSubRole.ColonyShip) {
        builtObject.nativeRace = selectRandomRace(galaxy, HABITAT_TO_EMPIRE_MINIMUM_INTELLIGENCE);
    }
    builtObject.reDefine();
    builtObject.currentFuel = builtObject.fuelCapacity;
    if (isState) {
        builtObject.owner = empire;
        empire.builtObjects.push(builtObject);
    } else {
        empire.privateBuiltObjects.push(builtObject);
    }
    galaxy.builtObjects.push(builtObject);
    const idx = galaxy.resolveIndex(x, y);
    galaxy.builtObjectIndexGrid[idx.x][idx.y].push(builtObject);
    const habitat = galaxy.fastFindNearestSystem(builtObject.xpos, builtObject.ypos);
    if (habitat !== null) {
        const num = galaxy.calculateDistance(builtObject.xpos, builtObject.ypos, habitat.xpos, habitat.ypos);
        if (num < MAX_SOLAR_SYSTEM_SIZE + 500.0) builtObject.nearestSystemStar = habitat;
    }
    builtObject.reDefine();
    return builtObject;
}

// ---------------------------------------------------------------------------------------------------------------
// Empire entry points
// ---------------------------------------------------------------------------------------------------------------

/** Empire.2.cs 3918 ClearExpiredViewableEmpires. No Rnd. */
export function clearExpiredViewableEmpires(galaxy: Galaxy, empire: Empire): void {
    const currentStarDate = galaxyStarDate(galaxy);
    const list: number[] = [];
    for (let i = 0; i < empire.empiresViewable.length; i++) {
        if (empire.empiresViewableExpiry[i] < currentStarDate) list.push(i);
    }
    // list.Sort(); list.Reverse() — the indices are collected ascending and distinct.
    list.reverse();
    for (const item of list) {
        empire.empiresViewable.splice(item, 1);
        empire.empiresViewableExpiry.splice(item, 1);
    }
}

/** Empire.9.cs 4568 CountExplorationShips. */
function countExplorationShips(empire: Empire): number {
    let num = 0;
    for (let i = 0; i < empire.builtObjects.length; i++) {
        if (empire.builtObjects[i].subRole === BuiltObjectSubRole.ExplorationShip && empire.builtObjects[i].builtAt == null) num++;
    }
    return num;
}

/** Empire.2.cs 3880 UpdateSystemExplorationStatus. No Rnd. */
export function updateSystemExplorationStatus(galaxy: Galaxy, empire: Empire): void {
    let num = 0;
    const resourceMap = empire.resourceMap;
    const systemVisibility = empire.systemVisibility;
    for (let i = 0; i < systemVisibility.length; i++) {
        const sv = systemVisibility[i];
        if (sv.status === SystemVisibilityStatus.Explored || sv.status === SystemVisibilityStatus.Visible) num++;
        if (sv.totallyExplored || (sv.status !== SystemVisibilityStatus.Visible && sv.status !== SystemVisibilityStatus.Explored)) continue;
        const systemInfo = galaxy.systems[sv.systemStar.systemIndex];
        let flag = true;
        if (resourceMap != null && !resourceMap.checkResourcesKnown(systemInfo.systemStar)) flag = false;
        if (flag) {
            const habitats = galaxy.systemHabitatsOf(systemInfo.systemStar.systemIndex);
            for (let j = 0; j < habitats.length; j++) {
                if (resourceMap != null && !resourceMap.checkResourcesKnown(habitats[j])) {
                    flag = false;
                    break;
                }
            }
        }
        sv.totallyExplored = flag;
    }
    empire.systemExploredCount = num;
    empire.explorationShipCount = countExplorationShips(empire);
}

/** Empire.1.cs 979 CheckKnownPirateBases. No Rnd. */
export function checkKnownPirateBases(galaxy: Galaxy, empire: Empire): void {
    const builtObjectList: BuiltObject[] = [];
    for (let i = 0; i < empire.knownPirateBases.length; i++) {
        const builtObject = empire.knownPirateBases[i];
        const owner = builtObject.empire as Empire | null;
        if (!galaxy.pirateEmpires.includes(owner as Empire) || owner === null || owner === galaxy.independentEmpire) {
            builtObjectList.push(builtObject);
        }
    }
    for (const item of builtObjectList) {
        const i = empire.knownPirateBases.indexOf(item);
        if (i >= 0) empire.knownPirateBases.splice(i, 1);
    }
}

/** Empire._EmpiresSharedVisibility as Empires (visibility.ts keeps the EmpireVisibility objects). */
export function empiresSharedVisibility(galaxy: Galaxy, empire: Empire): Empire[] {
    const result: Empire[] = [];
    for (const v of empire.visibility.empiresSharedVisibility) {
        const owner = findEmpireByVisibility(galaxy, v);
        if (owner !== null) result.push(owner);
    }
    return result;
}

function findEmpireByVisibility(galaxy: Galaxy, v: Empire['visibility']): Empire | null {
    for (const e of galaxy.empires) if (e.visibility === v) return e;
    for (const e of galaxy.pirateEmpires) if (e.visibility === v) return e;
    if (galaxy.independentEmpire !== null && galaxy.independentEmpire.visibility === v) return galaxy.independentEmpire;
    return null;
}

/**
 * Empire.1.cs 1060 MergeGalaxyMapsForSharedVisibilityEmpires.
 * Rnd: only what ChangeDiplomaticRelation (diplomacyTick.ts) draws inside MergeGalaxyMap's first-contact block.
 */
export function mergeGalaxyMapsForSharedVisibilityEmpires(galaxy: Galaxy, empire: Empire): void {
    const shared = empiresSharedVisibility(galaxy, empire);
    for (let i = 0; i < shared.length; i++) {
        const other = shared[i];
        if (other.active) mergeGalaxyMap(galaxy, other, empire);
    }
}

/** Empire.1.cs 1072 MergeKnownPirateBasesForSharedVisibilityEmpires. No Rnd. */
export function mergeKnownPirateBasesForSharedVisibilityEmpires(galaxy: Galaxy, empire: Empire): void {
    const shared = empiresSharedVisibility(galaxy, empire);
    for (let i = 0; i < shared.length; i++) {
        const other = shared[i];
        if (!other.active) continue;
        for (let j = 0; j < other.knownPirateBases.length; j++) {
            const builtObject = other.knownPirateBases[j];
            if (!empire.knownPirateBases.includes(builtObject) && !builtObject.hasBeenDestroyed) empire.knownPirateBases.push(builtObject);
        }
    }
}

/** Galaxy.4.cs 3700 MergeGalaxyMap(giver, receiver): the receiver learns the giver's surveyed habitats and systems. */
export function mergeGalaxyMap(galaxy: Galaxy, giver: Empire | null, receiver: Empire | null): void {
    if (giver === null || receiver === null || giver.visibility == null || receiver.visibility == null) return;
    receiver.resourceMap.mergeMap(giver.resourceMap.resourcesKnown);
    const giverSv = giver.systemVisibility;
    const receiverSv = receiver.systemVisibility;
    for (let i = 0; i < giverSv.length; i++) {
        const status = giverSv[i].status;
        if (status !== SystemVisibilityStatus.Explored && status !== SystemVisibilityStatus.Visible) continue;
        const status2 = receiverSv[i].status;
        if (status2 !== SystemVisibilityStatus.Unexplored && status2 !== SystemVisibilityStatus.Undefined) continue;
        receiverSv[i].status = SystemVisibilityStatus.Explored;
        const systemInfo = galaxy.systems[receiverSv[i].systemStar.systemIndex];
        if (systemInfo != null) {
            const dominant = systemInfo.dominantEmpire ?? null;
            if (dominant !== null && dominant.empire !== null) {
                contactFromGalaxyMap(galaxy, receiver, dominant.empire, dominant.empire);
            }
            const others = systemInfo.otherEmpires ?? null;
            if (others !== null && others.length > 0) {
                for (let j = 0; j < others.length; j++) {
                    const empireSystemSummary = others[j];
                    if (empireSystemSummary == null || empireSystemSummary.empire === null) continue;
                    // C# (Galaxy.4.cs 3753-3771): the pirate branch tests the other empire's relation but changes the
                    // one with the DOMINANT empire; both branches message the dominant empire.
                    contactFromGalaxyMap(galaxy, receiver, empireSystemSummary.empire, dominant!.empire);
                }
            }
        }
        if (!receiver.visibility.systemsVisible.includes(receiverSv[i].systemStar)) {
            receiver.visibility.systemsVisible.push(receiverSv[i].systemStar);
        }
    }
    for (let k = 0; k < giver.visibility.knownGalaxyLocations.length; k++) {
        const item = giver.visibility.knownGalaxyLocations[k];
        if (!receiver.visibility.knownGalaxyLocations.includes(item)) receiver.visibility.knownGalaxyLocations.push(item);
    }
    if (giver.knownPirateBases != null && receiver.knownPirateBases != null) {
        for (let l = 0; l < giver.knownPirateBases.length; l++) {
            const builtObject = giver.knownPirateBases[l];
            if (builtObject != null && !builtObject.hasBeenDestroyed && !receiver.knownPirateBases.includes(builtObject)) receiver.knownPirateBases.push(builtObject);
        }
    }
    if (receiver === galaxy.playerEmpire) {
        reviewEmpireTerritory(galaxy, true);
    }
}

/**
 * Galaxy.4.cs 3722-3771 "Empire Contact From Galaxy Map": `tested` is the empire whose relation is tested,
 * `dominant` the system's dominant empire (changed in the pirate branch, messaged in both).
 */
function contactFromGalaxyMap(galaxy: Galaxy, receiver: Empire, tested: Empire, dominant: Empire): void {
    if (receiver.pirateEmpireBaseHabitat !== null) {
        const pirateRelation = obtainPirateRelation(receiver, tested);
        if (pirateRelation.type === PirateRelationType.NotMet) {
            changePirateRelation(receiver, dominant, PirateRelationType.None, galaxyStarDate(galaxy));
            sendMessageToEmpire(dominant, dominant, EmpireMessageType.EmpireDiscovered, receiver, gameText('Empire Contact From Galaxy Map', receiver.name));
        }
    } else {
        const diplomaticRelation = obtainDiplomaticRelation(receiver, tested);
        if (diplomaticRelation.type === DiplomaticRelationType.NotMet) {
            changeDiplomaticRelation(galaxy, receiver, diplomaticRelation, DiplomaticRelationType.None);
            sendMessageToEmpire(dominant, dominant, EmpireMessageType.EmpireDiscovered, receiver, gameText('Empire Contact From Galaxy Map', receiver.name));
        }
    }
}

/**
 * Empire.cs 4734 ExertCulturalInfluence: per system with our colonies, sets our colonies' CulturalDistressFactor
 * from the other empires' strategic weight there, and may flip a rebelling foreign colony to us.
 * Rnd: one NextDouble per rebelling foreign colony in such a system while our troop ratio num8 < 40.
 */
export function exertCulturalInfluence(galaxy: Galaxy, empire: Empire): void {
    const habitatList = determineEmpireSystems(galaxy, empire);
    for (let i = 0; i < habitatList.length; i++) {
        const habitat = habitatList[i];
        let num = 0;
        for (let j = 0; j < empire.colonies.length; j++) {
            const habitat2 = empire.colonies[j];
            switch (habitat2.category) {
                case HabitatCategoryType.Planet:
                case HabitatCategoryType.Asteroid:
                    if (habitat2.parent === habitat) num = (num + strategicValue(habitat2)) | 0;
                    break;
                case HabitatCategoryType.Moon:
                    if (habitat2.parent!.parent === habitat) num = (num + strategicValue(habitat2)) | 0;
                    break;
                default:
                    if (habitat2 === habitat) num = (num + strategicValue(habitat2)) | 0;
                    break;
            }
        }
        const empireList: Empire[] = [];
        const list: number[] = [];
        const habitats = galaxy.systemHabitatsOf(habitat.systemIndex);
        for (let k = 0; k < habitats.length; k++) {
            const habitat3 = habitats[k];
            if (habitat3.empire === null || habitat3.empire === empire) continue;
            if (!empireList.includes(habitat3.empire)) {
                empireList.push(habitat3.empire);
                list.push(strategicValue(habitat3));
                continue;
            }
            const num2 = empireList.indexOf(habitat3.empire);
            if (num2 >= 0) list[num2] = (list[num2] + strategicValue(habitat3)) | 0;
        }
        let num3 = 0;
        for (const item of list) num3 = (num3 + item) | 0;
        for (let l = 0; l < habitats.length; l++) {
            const habitat4 = habitats[l];
            if (habitat4.empire !== null && habitat4.empire === empire) {
                const num4 = strategicValue(habitat4) / (num3 / 5.0);
                if (num4 < 1.0) {
                    habitat4.culturalDistressFactor = Math.fround((1.0 - num4) * 30.0);
                } else {
                    habitat4.culturalDistressFactor = 0;
                }
                continue;
            }
            if (habitat4.empire === null || habitat4.empire === empire || !habitat4.rebelling) continue;
            const num5 = empireList.indexOf(habitat4.empire);
            if (num5 < 0) continue;
            let num6 = 1.0;
            const otherRace = empireList[num5].dominantRace;
            if (otherRace !== null) {
                num6 = Math.pow(otherRace.loyalty / 100.0, 2.0);
                num6 += empireApprovalRating(galaxy, habitat4) / 100.0;
            }
            // Empire.cs 4826: 1.0 − CivilityRating / 100.0 (this empire's reputation, Empire.cs 1430).
            const num7 = 1.0 - empire.civilityRating / 100.0;
            let num8 = 0;
            if (habitat4.troops != null && habitat4.troops.items.length > 0 && habitat4.troops.totalDefendStrength > 0 && habitat4.population != null && habitat4.population.totalAmount > 0) {
                const num9 = Math.trunc(Math.sqrt(habitat4.population.totalAmount) / 10.0);
                if (num9 > 0) {
                    // C# divides the EMPIRE's troop strength (this.Troops.TotalDefendStrength), not the colony's.
                    num8 = Math.trunc(empire.troops.totalDefendStrength / num9);
                }
            }
            let num10 = list[num5] / (num / 10.0);
            num10 *= num6;
            num10 *= num7;
            if (num8 >= 40 || !(galaxy.rnd.nextDouble() > num10)) continue;
            const previousOwner = empireList[num5];
            empire.takeOwnershipOfColony(habitat4, empire);
            habitat4.culturalDistressFactor = 0;
            const text = gameText('There has been a revolution on X', habitat4.name);
            sendMessageToEmpire(empire, empire, EmpireMessageType.ColonyGained, habitat4, text + ' - ' + gameText('the inhabitants have switched allegiance and joined us!'));
            sendMessageToEmpire(previousOwner, previousOwner, EmpireMessageType.ColonyLost, habitat4, text + ' - ' + gameText('the inhabitants have treacherously betrayed us and joined the X', empire.name));
            if (habitat4.population == null || habitat4.population.dominantRace === null) continue;
            // Empire.cs 2891 ReviewEmpireAbilityBonuses(out newAbilityRaces, out raceChanged) (M4j). Its returned list
            // only feeds a UI event message (SendEventMessageToEmpire NewEmpireRaceAbility).
            reviewEmpireAbilityBonuses(galaxy, empire);
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// First contact
// ---------------------------------------------------------------------------------------------------------------

/** A StellarObject discovery location (Habitat / BuiltObject / Fighter / Creature): the fields DoEmpireEncounter reads. */
export interface DiscoveryLocation {
    xpos: number;
    ypos: number;
}

/**
 * Galaxy.7.cs 3957 DoEmpireEncounter(discoverer, otherEmpire, discoveryLocation).
 * Rnd: CheckSendPreWarpProgressEventMessage's (empireEvents.ts) draws.
 */
export function doEmpireEncounter(galaxy: Galaxy, discoverer: Empire | null, otherEmpire: Empire | null, discoveryLocation: DiscoveryLocation | null): void {
    if (otherEmpire === galaxy.independentEmpire) {
        if (discoverer !== null) checkSendPreWarpProgressEventMessage(galaxy, discoverer, PreWarpProgressEventType.FirstContactPirateOrIndependent, discoveryLocation, otherEmpire);
    } else if (discoverer === galaxy.independentEmpire) {
        if (otherEmpire !== null) checkSendPreWarpProgressEventMessage(galaxy, otherEmpire, PreWarpProgressEventType.FirstContactPirateOrIndependent, discoveryLocation, discoverer);
    } else {
        doSingleEmpireEncounter(galaxy, discoverer, otherEmpire, discoveryLocation);
        doSingleEmpireEncounter(galaxy, otherEmpire, discoverer, discoveryLocation);
        // C# dereferences otherEmpire / discoverer here unguarded.
        if (otherEmpire!.pirateEmpireBaseHabitat !== null) {
            if (discoverer !== null) checkSendPreWarpProgressEventMessage(galaxy, discoverer, PreWarpProgressEventType.FirstContactPirateOrIndependent, discoveryLocation, otherEmpire);
        }
        if (discoverer!.pirateEmpireBaseHabitat !== null) {
            if (otherEmpire !== null) checkSendPreWarpProgressEventMessage(galaxy, otherEmpire, PreWarpProgressEventType.FirstContactPirateOrIndependent, discoveryLocation, discoverer);
        }
    }
}

/** Galaxy.7.cs 3982 DoSingleEmpireEncounter(discoverer, otherEmpire, discoveryLocation). No direct Rnd. */
function doSingleEmpireEncounter(galaxy: Galaxy, discoverer: Empire | null, otherEmpire: Empire | null, discoveryLocation: DiscoveryLocation | null): void {
    if (discoverer === null || otherEmpire === null) return;
    const location = discoveryLocation !== null ? { x: Math.trunc(discoveryLocation.xpos), y: Math.trunc(discoveryLocation.ypos) } : null;
    if (discoverer.pirateEmpireBaseHabitat === null && otherEmpire.pirateEmpireBaseHabitat === null) {
        if (discoverer.diplomaticRelations == null) return;
        let diplomaticRelation = discoverer.diplomaticRelations.byEmpire(otherEmpire);
        if (diplomaticRelation === null) {
            diplomaticRelation = new DiplomaticRelation(DiplomaticRelationType.NotMet, discoverer, discoverer, otherEmpire, false);
            discoverer.diplomaticRelations.add(diplomaticRelation);
        }
        if (diplomaticRelation.type !== DiplomaticRelationType.NotMet || galaxy.pirateEmpires.includes(otherEmpire) || otherEmpire === galaxy.independentEmpire) return;
        const systemName = nearestSystemNameForDiscovery(galaxy, discoveryLocation);
        let flag = true;
        if (galaxy.storyReturnOfTheShakturiEnabled) {
            // Galaxy.7.cs 4018-4139: Mechanoid / Erutkah encounters and the Shakturi bias adjustments (story/storyEvents.ts, M4z3).
            flag = doSingleEmpireEncounterShakturiStory(galaxy, discoverer, otherEmpire, discoveryLocation, systemName);
        }
        diplomaticRelation.type = DiplomaticRelationType.None;
        // Galaxy.7.cs 4141-4142: scripted game events (story/eventActions.ts, M4z3).
        const matchingGameEventIdEmpireEncounter = getMatchingGameEventIdEmpireEncounter(galaxy, discoverer, otherEmpire);
        checkTriggerEvent(galaxy, matchingGameEventIdEmpireEncounter, discoverer, EventTriggerType.EmpireEncounter, null);
        if (flag) {
            if (discoverer.dominantRace !== otherEmpire.dominantRace) {
                const empireEvaluation5 = obtainEmpireEvaluation(galaxy, discoverer, otherEmpire);
                setFirstContactPenalty(empireEvaluation5, FIRST_CONTACT_PENALTY_START_AMOUNT * galaxy.aggressionLevel);
            }
        } else {
            const empireEvaluation6 = obtainEmpireEvaluation(galaxy, discoverer, otherEmpire);
            setFirstContactPenalty(empireEvaluation6, 0.0);
        }
        let text = gameText('We have encountered a new empire', systemName, otherEmpire.name);
        if (otherEmpire.dominantRace !== null && discoverer.dominantRace !== null && otherEmpire.dominantRace === discoverer.dominantRace) {
            text += '. ' + gameText('This empire is predominantly composed of SAME RACE', otherEmpire.dominantRace.name);
        } else if (otherEmpire.dominantRace !== null && discoverer.dominantRace !== null && otherEmpire.dominantRace.raceFamily === discoverer.dominantRace.raceFamily) {
            text += '. ' + gameText('This empire is predominantly composed of SAME RACE FAMILY', otherEmpire.dominantRace.name);
        }
        if (location !== null) {
            sendMessageToEmpire(discoverer, discoverer, EmpireMessageType.EmpireDiscovered, otherEmpire, text, location, '');
        } else {
            sendMessageToEmpire(discoverer, discoverer, EmpireMessageType.EmpireDiscovered, otherEmpire, text);
        }
    } else {
        if (discoverer.pirateRelations == null) return;
        const pirateRelation = obtainPirateRelation(discoverer, otherEmpire);
        if (pirateRelation.type !== PirateRelationType.NotMet) return;
        // Galaxy.7.cs 4192-4201: both branches of the C# if/else are identical.
        changePirateRelationThisSideOnly(discoverer, otherEmpire, PirateRelationType.None, galaxyStarDate(galaxy));
        if (otherEmpire.pirateEmpireBaseHabitat !== null && discoverer.knownPirateEmpires != null && !discoverer.knownPirateEmpires.includes(otherEmpire)) {
            discoverer.knownPirateEmpires.push(otherEmpire);
        }
        if (discoverer.pirateEmpireBaseHabitat !== null && otherEmpire.knownPirateEmpires != null && !otherEmpire.knownPirateEmpires.includes(discoverer)) {
            otherEmpire.knownPirateEmpires.push(discoverer);
        }
        const systemName = nearestSystemNameForDiscovery(galaxy, discoveryLocation);
        const description = gameText('We have encountered a new empire', systemName, otherEmpire.name);
        if (location !== null) {
            sendMessageToEmpire(discoverer, discoverer, EmpireMessageType.EmpireDiscovered, otherEmpire, description, location, '');
        } else {
            sendMessageToEmpire(discoverer, discoverer, EmpireMessageType.EmpireDiscovered, otherEmpire, description);
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// BuiltObject entry points
// ---------------------------------------------------------------------------------------------------------------

/**
 * BuiltObject.1.cs 2034 ScanArea(galaxy): surveys habitats within the resource-profile sensor range (first contact
 * with owners inside the scan box), and for an unowned planet/moon newly surveyed draws the 1-in-800 deserted ship.
 * Rnd: DoEmpireEncounter callees (M4u); per newly surveyed habitat whose Empire is not the independent empire one
 * Next(0, 800); on a hit that passes the checks: SelectRandomUniqueMilitaryShipName, Next(0, 5),
 * [SelectRandomUniqueStandardShipName], GenerateDesignFromSpec, [SelectRandomRace], SelectRelativeParkingPoint,
 * SelectRandomHeading.
 */
export function scanArea(galaxy: Galaxy, builtObject: BuiltObject): void {
    if (builtObject.sensorResourceProfileSensorRange <= 0) return;
    const empireOfShip = builtObject.empire as Empire;
    const sensorRange = builtObject.sensorResourceProfileSensorRange;
    const range = sensorRange + MAX_SOLAR_SYSTEM_SIZE * 2;
    const habitatsAtLocation = getHabitatsAtLocation(galaxy, builtObject.xpos, builtObject.ypos, range);
    const num = sensorRange * sensorRange;
    const num2 = Math.trunc(builtObject.xpos) - sensorRange;
    const num3 = Math.trunc(builtObject.xpos) + sensorRange;
    const num4 = Math.trunc(builtObject.ypos) - sensorRange;
    const num5 = Math.trunc(builtObject.ypos) + sensorRange;
    for (let i = 0; i < habitatsAtLocation.length; i++) {
        const habitat = habitatsAtLocation[i];
        if (!(habitat.xpos >= num2) || !(habitat.xpos <= num3) || !(habitat.ypos >= num4) || !(habitat.ypos <= num5)) continue;
        const empire = habitat.empire;
        if (empire !== null && empire !== empireOfShip) {
            doEmpireEncounter(galaxy, empireOfShip, empire, habitat);
        }
        if (empireOfShip.resourceMap == null || empireOfShip.resourceMap.checkResourcesKnown(habitat) || !(galaxy.calculateDistanceSquared(habitat.xpos, habitat.ypos, builtObject.xpos, builtObject.ypos) <= num)) {
            continue;
        }
        addScientificData(builtObject, habitat, 'scanArea');
        empireOfShip.resourceMap.setResourcesKnown(habitat, true);
        builtObject.scanHabitatIndex = habitat.habitatIndex;
        builtObject.lastScanTime = galaxyStarDate(galaxy);
        // 2069-2089: restricted-resource discovery messages (SendEventMessageToEmpire) — UI only.
        if (empire === galaxy.independentEmpire) {
            // 2090-2098: independent colony report (SendEventMessageToEmpire IndependentPopulation) — UI only.
            continue;
        }
        if (galaxy.rnd.next(0, 800) !== 1 || (habitat.category !== HabitatCategoryType.Planet && habitat.category !== HabitatCategoryType.Moon) || habitat.empire !== null) {
            continue;
        }
        let flag = false;
        const habitat3 = galaxy.determineHabitatSystemStar(habitat);
        if (habitat3 !== null) {
            const systemInfo = galaxy.systems[habitat3.systemIndex];
            if (systemInfo != null && systemInfo.dominantEmpire != null && systemInfo.dominantEmpire.empire !== null && systemInfo.dominantEmpire.empire !== empireOfShip) {
                flag = true;
            }
        }
        if (flag) continue;
        const num6 = 1 + Math.trunc(empireOfShip.colonies.length / 6);
        // Empire.BuiltObjects.GetBuiltObjectsBySubRole([Cruiser, CapitalShip]).Count.
        let count = 0;
        for (const b of empireOfShip.builtObjects) {
            if (b.subRole === BuiltObjectSubRole.Cruiser || b.subRole === BuiltObjectSubRole.CapitalShip) count++;
        }
        if (count < num6) {
            generateDesertedShip(galaxy, empireOfShip, habitat);
        }
    }
}

/** BuiltObject.1.cs 2127-2209: the deserted ship found on a surveyed planet/moon (state-owned, obsolete design). */
function generateDesertedShip(galaxy: Galaxy, empire: Empire, habitat: Habitat): void {
    let designSpecification = null;
    let text3 = galaxy.selectRandomUniqueMilitaryShipName(habitat);
    switch (galaxy.rnd.next(0, 5)) {
        case 0:
        case 1:
            designSpecification = obtainDesignSpec(empire, BuiltObjectSubRole.Cruiser);
            break;
        case 2:
            designSpecification = obtainDesignSpec(empire, BuiltObjectSubRole.CapitalShip);
            break;
        case 3:
        case 4:
            designSpecification = obtainDesignSpec(empire, BuiltObjectSubRole.ColonyShip);
            text3 = galaxy.selectRandomUniqueStandardShipName(habitat);
            break;
    }
    // TODO(port) M9: design.PictureRef = ShipImageHelper.ResolveMajorShipImageIndex(FreedomAllianceFamily, subRole,
    // aged) / ResolveMinorShipImageIndex(subRole, largeShips) — ShipImageHelper draws on its own clock-seeded Random
    // (not Galaxy.Rnd); visual only. The design keeps the picture GenerateDesignFromSpec gave it.
    // C# dereferences designSpecification / design unguarded (NullReferenceException).
    const design = generateDesignFromSpec(galaxy, empire, designSpecification!, 3.0, galaxyStarDate(galaxy))!;
    design.buildCount++;
    const builtObject = generateBuiltObjectFromDesign(galaxy, empire, design, text3, true, habitat.xpos, habitat.ypos);
    design.isObsolete = true;
    builtObject.parentHabitat = habitat;
    builtObject.dateBuilt = galaxyStarDate(galaxy);
    builtObject.dateRetrofit = galaxyStarDate(galaxy);
    // SelectRelativeParkingPoint(habitat.Diameter / 2, out x, out y): int division.
    const p = galaxy.selectRelativeParkingPoint(Math.trunc(habitat.diameter / 2));
    builtObject.parentOffsetX = p.x;
    builtObject.parentOffsetY = p.y;
    builtObject.heading = galaxy.selectRandomHeading();
    builtObject.targetHeading = builtObject.heading;
    builtObject.supportCostFactor = 0.5;
    // 2190-2208: race report / tech-bonus text + SendEventMessageToEmpire FreeSuperShip — UI only.
}

/**
 * BuiltObject.1.cs 1935 ScanForLocations: drops location hints the ship has reached and discovers GalaxyLocations in
 * sensor range (visibility.ts discoverGalaxyLocations). No Rnd.
 */
export function scanForLocations(galaxy: Galaxy, builtObject: BuiltObject): void {
    const empire = builtObject.empire as Empire | null;
    if (empire === null || empire === galaxy.independentEmpire) return;
    if (empire.locationHints.length > 0) {
        const list: number[] = [];
        for (let i = 0; i < empire.locationHints.length; i++) {
            let num = 25000000.0;
            if (builtObject.nearestSystemStar !== null) num = 2116000000.0;
            const num2 = galaxy.calculateDistanceSquared(builtObject.xpos, builtObject.ypos, empire.locationHints[i].x, empire.locationHints[i].y);
            if (num2 < num) list.push(i);
        }
        if (list.length > 0) {
            for (let num3 = list.length - 1; num3 >= 0; num3--) empire.locationHints.splice(list[num3], 1);
        }
    }
    // 1968-1986 (visibility.ts). 1987-2031: per new location, SendEventMessageToEmpire (SpecialArea /
    // AncientBattleDebrisField / FreeSuperShip) — UI only.
    empire.visibility.discoverGalaxyLocations(builtObject);
}

/** BuiltObject.cs 3855 ReviewSystemVisibilityForPreWarpShip. No Rnd. */
export function reviewSystemVisibilityForPreWarpShip(galaxy: Galaxy, builtObject: BuiltObject): void {
    const actualEmpire = builtObject.actualEmpire;
    if (builtObject.warpSpeed > 0 || actualEmpire === null) return;
    const habitat = galaxy.fastFindNearestSystem(builtObject.xpos, builtObject.ypos);
    if (habitat !== null) {
        const num = galaxy.calculateDistance(builtObject.xpos, builtObject.ypos, habitat.xpos, habitat.ypos);
        builtObject.nearestSystemStar = num < MAX_SOLAR_SYSTEM_SIZE + 500.0 ? habitat : null;
    }
    // Empire.9.cs 4651 ResolveSystemVisibility(this, excludeBuiltObject: false) (skips the independent empire).
    actualEmpire.visibility.resolveSystemVisibilityForUnit(builtObject, false);
}

// ---------------------------------------------------------------------------------------------------------------
// Habitat entry points
// ---------------------------------------------------------------------------------------------------------------

/** Galaxy.5.cs 3942 CheckRuinBonuses(ruin). */
export function checkRuinBonuses(ruin: Ruin | null): boolean {
    return (
        ruin !== null &&
        (ruin.bonusDefensive > 0.0 ||
            ruin.bonusDiplomacy > 0.0 ||
            ruin.bonusHappiness > 0.0 ||
            ruin.bonusResearchEnergy > 0.0 ||
            ruin.bonusResearchHighTech > 0.0 ||
            ruin.bonusResearchWeapons > 0.0 ||
            ruin.bonusWealth > 0.0)
    );
}

/** Galaxy.5.cs 3951 CheckRuinsHaveBenefit(ruin, empire). No Rnd. */
export function checkRuinsHaveBenefit(galaxy: Galaxy, ruin: Ruin | null, empire: Empire | null): boolean {
    let result = false;
    if (ruin !== null) {
        if (empire !== null && empire.pirateEmpireBaseHabitat !== null && empire !== galaxy.independentEmpire) return false;
        if (ruin.gameEventId >= 0) return true;
        if (ruin.researchBonus > 0 || ruin.mapSystemReveal > 0 || ruin.moneyBonus > 0.0) result = true;
        if (empire === galaxy.playerEmpire && ruin.storyClueLevel >= 0) result = true;
        switch (ruin.type) {
            case RuinType.CreatureSwarm:
            case RuinType.CreatureSwarmSilverMist:
                if (!ruin.creatureSwarmGenerated) result = true;
                break;
            case RuinType.PirateAmbush:
                if (!ruin.pirateAmbushGenerated) result = true;
                break;
            case RuinType.Component:
            case RuinType.UnlockResearchProject:
                if (ruin.researchProjectId >= 0) {
                    result = true;
                    if (ruin.type === RuinType.UnlockResearchProject && empire !== null && empire.research != null && techTreeNodeEnabled(empire, ruin.researchProjectId)) {
                        result = false;
                    }
                }
                break;
            case RuinType.Government:
                if (ruin.specialGovernmentId >= 0) result = true;
                break;
            case RuinType.NewPopulation:
                if (ruin.habitatNewRace !== null) result = true;
                break;
            case RuinType.Origins:
                if (ruin.originsApprovalRatingBonus !== 0) result = true;
                break;
            case RuinType.Refugees:
                if (!ruin.refugeesGenerated) result = true;
                break;
            case RuinType.LostBuiltObject:
                if (!ruin.lostBuiltObjectGenerated) result = true;
                break;
            case RuinType.LostColony:
                if (!ruin.lostColonyGenerated) result = true;
                break;
            case RuinType.StoryEvent:
                if (ruin.storyEventData > 0) result = true;
                break;
        }
    }
    return result;
}

/** Research.TechTree[researchProjectId].IsEnabled (ResearchNodeList = SyncList: the list indexer, by position). */
function techTreeNodeEnabled(empire: Empire, researchProjectId: number): boolean {
    return empire.research.techTree[researchProjectId].isEnabled;
}

/** .NET `ToString("#%")` for the ruin bonus texts (message text only). */
function percentText(value: number): string {
    return String(Math.round(value * 100.0)) + '%';
}

/** HabitatCategoryType description, lower-cased (ResolveDescription(category).ToLower(InvariantCulture)). */
function categoryText(habitat: Habitat): string {
    return resolveDescription(HabitatCategoryType as unknown as Record<number, string>, habitat.category).toLowerCase();
}

/**
 * Galaxy.5.cs 4672 SelectRandomEmpire(): a random active non-pirate, non-independent empire (ConditionCheckLimit 200).
 * Rnd: Next(0, Empires.Count) per try.
 */
export function selectRandomEmpire(galaxy: Galaxy): Empire | null {
    let empire: Empire | null = null;
    let iterationCount = 0;
    while (iterationCount < 200 && (iterationCount++, empire === null)) {
        const num = galaxy.rnd.next(0, galaxy.empires.length);
        empire = galaxy.empires[num];
        if (empire.pirateEmpireBaseHabitat !== null || empire === galaxy.independentEmpire || !empire.active) empire = null;
    }
    return empire;
}

/**
 * Galaxy.5.cs 4045 InvestigateRuins(investigatingEmpire, ruinsHabitat): the story hint (player), then — for a ruin with a
 * benefit or colony bonuses — story clue, scripted event, treasure, research, map reveal and the per-RuinType outcome,
 * then Ruin.ClearBonuses; otherwise the race event / "ruins are silent" message.
 * Rnd (in order): player story hint Next(0,2) (only when a hint exists); SelectRandomNextResearchProjectExcludeSuperWeapons;
 * Kaltor Next(3,6); ambush Next(3,5) + NextDouble ×2 per relocation try; lost ship Next(0,2) + FindLonelyColonyLocation +
 * SelectRandomEmpire; lost colony FindLonelyColonyLocation + NextDouble (quality) + SelectRandomRace; refugees
 * SelectRandomRace; StoryEvent NextDouble ×2; race event Next(0,2); plus the callees' own draws.
 * ShipImageHelper picture choices use ShipImageHelper's own clock-seeded Random (not Galaxy.Rnd) —
 * TODO(port) M9: design.PictureRef (visual only).
 */
export function investigateRuins(galaxy: Galaxy, investigatingEmpire: Empire | null, ruinsHabitat: Habitat | null): void {
    if (ruinsHabitat === null || investigatingEmpire === null) return;
    const ruin = ruinsHabitat.ruin;
    if (ruin === null) return;
    let text = '';
    let text2 = '';
    if (investigatingEmpire === galaxy.playerEmpire) {
        const text3 = checkForStoryLocationHint(galaxy);
        if (text3 !== '' && galaxy.rnd.next(0, 2) === 1) {
            text2 = '\n\n';
            text2 = text2 + '*** ' + gameText('A datacore recovered from the ruins NAVIGATIONAL DIRECTIONS') + ':';
            text2 += text3;
            text2 += '. ***\n\n';
            text2 += gameText('We should send a ship to investigate this location.');
        }
    }
    if (checkRuinsHaveBenefit(galaxy, ruin, investigatingEmpire) || checkRuinBonuses(ruin)) {
        // Galaxy.5.cs 4072-4081: story clue (story/storyEvents.ts).
        text = investigateRuinsStoryClue(galaxy, investigatingEmpire, ruinsHabitat, text);
        if (ruin.gameEventId >= 0) {
            checkTriggerEvent(galaxy, ruin.gameEventId, investigatingEmpire, EventTriggerType.Investigate, null);
        }
        if (ruin.moneyBonus > 0.0) {
            investigatingEmpire.stateMoney += ruin.moneyBonus;
            pirateEconomyPerformIncome(galaxy, investigatingEmpire, ruin.moneyBonus, PirateIncomeType.Undefined, galaxyStarDate(galaxy));
            text += gameText('Ruins Discovery Money', ruin.name, String(ruin.moneyBonus));
            text += text2;
            sendEventMessageToEmpire(investigatingEmpire, EventMessageType.GeneralRuinsDiscovery, gameText('Treasure Recovered'), text, ruin, ruinsHabitat);
        }
        if (ruin.researchBonus > 0 && investigatingEmpire.research != null) {
            const researchNode = selectRandomNextResearchProjectExcludeSuperWeapons(galaxy, investigatingEmpire);
            if (researchNode !== null) {
                researchNode.progress = Math.fround(researchNode.progress + ruin.researchBonus);
                if (researchNode.progress >= researchNode.cost) {
                    text += gameText('Ruins Discovery Research', ruin.name, researchNode.def.name);
                    doResearchBreakthrough(galaxy, investigatingEmpire, researchNode, true, true, true);
                    investigatingEmpire.research.update(investigatingEmpire.dominantRace);
                    reviewDesignsBuiltObjectsImprovedComponents(investigatingEmpire);
                    investigatingEmpire.reviewResearchAbilities();
                } else {
                    text += gameText('Ruins Discovery Research', ruin.name, researchNode.def.name);
                }
                text += text2;
                sendEventMessageToEmpire(investigatingEmpire, EventMessageType.GeneralRuinsDiscovery, gameText('Technology Recovered'), text, ruin, ruinsHabitat);
            }
        }
        if (ruin.mapSystemReveal > 0) {
            const mapSystemReveal = ruin.mapSystemReveal;
            ruin.mapSystemReveal = 0;
            if (investigatingEmpire.systemVisibility != null && investigatingEmpire.resourceMap != null) {
                for (let i = 0; i < mapSystemReveal; i++) {
                    const habitat = fastFindNearestUnexploredHabitat(galaxy, ruinsHabitat.xpos, ruinsHabitat.ypos, investigatingEmpire);
                    if (habitat === null) break;
                    const systemInfo = galaxy.systems[habitat.systemIndex];
                    if (systemInfo == null || systemInfo.habitats == null) continue;
                    investigatingEmpire.systemVisibility[habitat.systemIndex].totallyExplored = true;
                    if (investigatingEmpire.resourceMap != null) {
                        // Galaxy.5.cs 4137 systemInfo.Habitats: the star is not in it (set on its own below).
                        const sysHabitats = planetsOf(systemInfo);
                        for (let j = 0; j < sysHabitats.length; j++) {
                            const habitat2 = sysHabitats[j];
                            if (habitat2 != null) investigatingEmpire.resourceMap.setResourcesKnown(habitat2, true);
                        }
                        if (systemInfo.systemStar != null) investigatingEmpire.resourceMap.setResourcesKnown(systemInfo.systemStar, true);
                    }
                    const status = investigatingEmpire.systemVisibility[habitat.systemIndex].status;
                    if (status === SystemVisibilityStatus.Unexplored || status === SystemVisibilityStatus.Undefined) {
                        investigatingEmpire.systemVisibility[habitat.systemIndex].status = SystemVisibilityStatus.Explored;
                    }
                }
                text += gameText('Ruins Discovery Maps', ruin.name, String(mapSystemReveal));
                text += text2;
                sendEventMessageToEmpire(investigatingEmpire, EventMessageType.GeneralRuinsDiscovery, gameText('System Maps Recovered'), text, ruin, ruinsHabitat);
            }
        }
        let empty = '';
        let empty2 = '';
        switch (ruin.type) {
            case RuinType.EmpireBonus: {
                empty = gameText('Empire Bonus when Colonized');
                text = gameText('Ruins Empire Bonus', ruin.name, categoryText(ruinsHabitat));
                text += ':\n\n';
                let text4 = '';
                if (ruin.bonusDefensive > 0.0) {
                    text += gameText('Ruins Bonus Defensive', categoryText(ruinsHabitat), percentText(ruin.bonusDefensive));
                } else {
                    if (ruin.bonusDiplomacy > 0.0) text4 = gameText('Ruins Bonus Diplomacy', percentText(ruin.bonusDiplomacy));
                    else if (ruin.bonusHappiness > 0.0) text4 = gameText('Ruins Bonus Happiness', percentText(ruin.bonusHappiness));
                    else if (ruin.bonusResearchEnergy > 0.0) text4 = gameText('Ruins Bonus Energy Research', percentText(ruin.bonusResearchEnergy));
                    else if (ruin.bonusResearchHighTech > 0.0) text4 = gameText('Ruins Bonus HighTech Research', percentText(ruin.bonusResearchHighTech));
                    else if (ruin.bonusResearchWeapons > 0.0) text4 = gameText('Ruins Bonus Weapons Research', percentText(ruin.bonusResearchWeapons));
                    else if (ruin.bonusWealth > 0.0) text4 = gameText('Ruins Bonus Colony Income', percentText(ruin.bonusWealth));
                    text += text4;
                    text += '\n\n';
                }
                text += gameText('We should immediately send a colony ship to colonize this extremely valuable world');
                sendEventMessageToEmpire(investigatingEmpire, EventMessageType.RuinsEmpireBonus, empty, text, ruin, ruinsHabitat);
                break;
            }
            case RuinType.CreatureSwarmSilverMist: {
                empty = gameText('SilverMist Released');
                text = gameText('Ruins SilverMist', ruin.name);
                const creature = galaxy.generateCreatureAtHabitat(CreatureType.SilverMist, ruinsHabitat, false);
                sendEventMessageToEmpire(investigatingEmpire, EventMessageType.CreatureOutbreak, empty, text, creature, ruinsHabitat);
                sendNewsBroadcast(investigatingEmpire, EventMessageType.CreatureOutbreak, creature, DisasterEventType.Undefined, false, false, 0, ruinsHabitat);
                break;
            }
            case RuinType.CreatureSwarm: {
                empty = gameText('Kaltor Swarm Released');
                text = gameText('Ruins Kaltor Swarm', ruin.name);
                const num4 = galaxy.rnd.next(3, 6);
                for (let l = 0; l < num4; l++) galaxy.generateCreatureAtHabitat(CreatureType.Kaltor, ruinsHabitat, false);
                sendEventMessageToEmpire(investigatingEmpire, EventMessageType.CreatureOutbreak, empty, text, ruin, ruinsHabitat);
                break;
            }
            case RuinType.PirateAmbush: {
                empty = gameText('Pirate Ambush') + '!';
                const empire2 = findNearestPirateFaction(galaxy, ruinsHabitat.xpos, ruinsHabitat.ypos, galaxy.playerEmpire, false);
                if (empire2 !== null) {
                    text = gameText('Ruins Pirate Ambush', ruin.name, empire2.name);
                    const num5 = galaxy.rnd.next(3, 5);
                    let habitat10: Habitat | null = ruinsHabitat;
                    let num6 = ruinsHabitat.xpos;
                    let num7 = ruinsHabitat.ypos;
                    let num8 = 0;
                    const habitat11 = galaxy.determineHabitatSystemStar(ruinsHabitat);
                    while (habitat10 === habitat11 && num8 < 20) {
                        num6 += galaxy.rnd.nextDouble() * 200000.0 - 100000.0;
                        num7 += galaxy.rnd.nextDouble() * 200000.0 - 100000.0;
                        habitat10 = galaxy.findNearestSystemGasCloudAsteroid(num6, num7);
                        num8++;
                    }
                    for (let m = 0; m < num5; m++) {
                        // C# passes habitat10 unguarded (a null from the relocation would throw inside GeneratePirateShip).
                        const ship = generatePirateShip(galaxy, empire2, BuiltObjectSubRole.Frigate, habitat10!);
                        if (ship !== null) assignMission(galaxy, ship, BuiltObjectMissionType.Move, ruinsHabitat, null, BuiltObjectMissionPriority.High, { manuallyAssigned: false });
                    }
                    sendEventMessageToEmpire(investigatingEmpire, EventMessageType.PirateAmbush, empty, text, ruin, ruinsHabitat);
                }
                break;
            }
            case RuinType.UnlockResearchProject:
                if (investigatingEmpire.research != null && investigatingEmpire.research.techTree != null) {
                    const researchNode3 = findNodeById(investigatingEmpire.research.techTree, ruin.researchProjectId);
                    if (researchNode3 !== null && !researchNode3.isEnabled) {
                        empty = gameText('Ancient Knowledge Cache Discovered');
                        const name = researchNode3.def.name;
                        text += gameText('Ruins Ancient Knowledge Cache Discovered', ruin.name, name);
                        text += '.\n\n';
                        researchNode3.isEnabled = true;
                        sendEventMessageToEmpire(investigatingEmpire, EventMessageType.ExoticTechDiscovered, empty, text, ruin, ruinsHabitat);
                    } else {
                        text = gameText('Our survey team found nothing of interest in the RUINNAME', ruin.name);
                        sendEventMessageToEmpire(investigatingEmpire, EventMessageType.GeneralRuinsDiscovery, gameText('Ruins are Silent'), text, ruin, ruinsHabitat);
                    }
                }
                break;
            case RuinType.Component: {
                if (investigatingEmpire.research == null || investigatingEmpire.research.techTree == null) break;
                const researchNode2 = findNodeById(investigatingEmpire.research.techTree, ruin.researchProjectId);
                empty = gameText('Secret Super Weapon Discovered');
                let arg = '';
                if (researchNode2 !== null) {
                    const def = researchNode2.def;
                    if (def.components != null && def.components.length > 0) {
                        arg = galaxy.researchStatic?.componentsById.get(def.components[0])?.name ?? '';
                    } else if (def.componentImprovements != null && def.componentImprovements.length > 0) {
                        const improved = galaxy.researchStatic?.componentsById.get(def.componentImprovements[0].componentId) ?? null;
                        if (improved !== null) arg = improved.name;
                    } else {
                        arg = def.name;
                    }
                }
                text += gameText('Ruins Secret Super Weapon Discovered', ruin.name, arg);
                text += '.\n\n';
                // C# calls DoResearchBreakthrough(researchNode2, …) unguarded (a missing node would throw); guarded here.
                if (researchNode2 !== null) doResearchBreakthrough(galaxy, investigatingEmpire, researchNode2, true, true, true);
                investigatingEmpire.research.update(investigatingEmpire.dominantRace);
                reviewDesignsBuiltObjectsImprovedComponents(investigatingEmpire);
                investigatingEmpire.reviewResearchAbilities();
                sendEventMessageToEmpire(investigatingEmpire, EventMessageType.ExoticTechDiscovered, empty, text, ruin, ruinsHabitat);
                break;
            }
            case RuinType.Government: {
                if (investigatingEmpire.allowableGovernmentTypes == null) break;
                empty = gameText('Secret Form of Government Revealed');
                if (!investigatingEmpire.allowableGovernmentTypes.includes(ruin.specialGovernmentId)) investigatingEmpire.allowableGovernmentTypes.push(ruin.specialGovernmentId);
                const governmentAttributes = getGovernmentsStatic()[ruin.specialGovernmentId]!;
                text += gameText('Ruins Secret Form of Government Revealed', ruin.name, governmentAttributes.name);
                let text6 = '';
                switch (governmentAttributes.availability) {
                    case 3:
                        text6 = gameText('Government Description Way of Darkness');
                        text6 += '\n\n';
                        break;
                    case 2:
                        text6 = gameText('Government Description Way of the Ancients');
                        text6 += '\n\n';
                        break;
                }
                text += text6;
                text += gameText('Ruins Secret Form of Government Revealed Adoption');
                sendEventMessageToEmpire(investigatingEmpire, EventMessageType.SpecialGovernmentType, empty, text, ruin, ruinsHabitat);
                if (investigatingEmpire === galaxy.playerEmpire) break;
                const governmentAttributesList = determineMostSuitableGovernmentTypes(investigatingEmpire.dominantRace!, investigatingEmpire.allowableGovernmentTypes);
                if (governmentAttributesList != null && governmentAttributesList.length > 0) {
                    const governmentId = governmentAttributesList[0].governmentId;
                    if (governmentId === ruin.specialGovernmentId) {
                        haveRevolution(galaxy, investigatingEmpire, investigatingEmpire.dominantRace, governmentId, 1.0);
                    }
                }
                break;
            }
            case RuinType.LostBuiltObject: {
                let subRole = BuiltObjectSubRole.Undefined;
                switch (galaxy.rnd.next(0, 2)) {
                    case 0:
                        subRole = BuiltObjectSubRole.Cruiser;
                        break;
                    case 1:
                        subRole = BuiltObjectSubRole.CapitalShip;
                        break;
                }
                const designSpecification4 = obtainDesignSpec(investigatingEmpire, subRole);
                if (designSpecification4 === null) break;
                const habitat6 = findLonelyColonyLocation(galaxy, investigatingEmpire);
                if (habitat6 === null) break;
                // C# dereferences SelectRandomEmpire() unguarded.
                const empire = selectRandomEmpire(galaxy)!;
                const design4 = generateDesignFromSpec(galaxy, empire, designSpecification4, 4.0, galaxyStarDate(galaxy));
                if (design4 === null) break;
                // TODO(port) M9: design4.PictureRef = ShipImageHelper.ResolveMinorShipImageIndex(design4.SubRole, largeShips: true)
                // (ShipImageHelper's own Random; visual only).
                const builtObject4 = generateAbandonedBuiltObject(galaxy, habitat6, design4);
                if (builtObject4 !== null) {
                    empty = gameText('Lost Ship Location Revealed');
                    const habitat7 = galaxy.determineHabitatSystemStar(habitat6);
                    empty2 = resolveSectorDescription(galaxy, habitat6.xpos, habitat6.ypos);
                    text += gameText('Ruins Lost Ship Location', ruin.name, builtObject4.name, categoryText(habitat6), habitat6.name, habitat7.name, empty2);
                    sendEventMessageToEmpire(investigatingEmpire, EventMessageType.LostBuiltObjectCoordinates, empty, text, ruin, ruinsHabitat);
                    if (investigatingEmpire === galaxy.playerEmpire) addLocationHint(galaxy.playerEmpire, { x: Math.trunc(habitat6.xpos), y: Math.trunc(habitat6.ypos) });
                }
                break;
            }
            case RuinType.LostColony: {
                empty = gameText('Lost Colony Location Revealed');
                const habitat8 = findLonelyColonyLocation(galaxy, investigatingEmpire);
                if (habitat8 !== null) {
                    if (habitat8.quality < Math.fround(0.65)) {
                        habitat8.baseQuality = Math.fround(0.65 + galaxy.rnd.nextDouble() * 0.35);
                    }
                    let race2 = investigatingEmpire.dominantRace;
                    if (race2 === null || !race2.playable) race2 = selectRandomRace(galaxy, 75);
                    makeHabitatIntoColonyRuntime(galaxy, investigatingEmpire, habitat8, null as unknown as Empire, race2!, 2000000000);
                    const habitat9 = galaxy.determineHabitatSystemStar(habitat8);
                    empty2 = resolveSectorDescription(galaxy, habitat8.xpos, habitat8.ypos);
                    text += gameText('Ruins Lost Colony Location Revealed', ruin.name, categoryText(habitat8), habitat8.name, habitat9.name, empty2);
                    sendEventMessageToEmpire(investigatingEmpire, EventMessageType.LostColonyCoordinates, empty, text, habitat8, ruinsHabitat);
                    if (investigatingEmpire === galaxy.playerEmpire) addLocationHint(galaxy.playerEmpire, { x: Math.trunc(habitat8.xpos), y: Math.trunc(habitat8.ypos) });
                }
                break;
            }
            case RuinType.NewPopulation:
                if (ruin.habitatNewRace !== null) {
                    empty = gameText('Sleeping Alien Race Awoken');
                    const population = new Population(ruin.habitatNewRace, 200000000);
                    if (ruinsHabitat.population == null) ruinsHabitat.population = new PopulationList();
                    ruinsHabitat.population.add(population);
                    takeOwnershipOfColonyFull(galaxy, galaxy.independentEmpire!, ruinsHabitat, galaxy.independentEmpire, false, false);
                    text += gameText('Ruins Sleeping Alien Race Awoken', ruin.name, ruin.habitatNewRace.name, resolveDescription(HabitatCategoryType as unknown as Record<number, string>, ruinsHabitat.category));
                    sendEventMessageToEmpire(investigatingEmpire, EventMessageType.SleepersAwake, empty, text, ruin.habitatNewRace, ruinsHabitat);
                }
                break;
            case RuinType.Origins: {
                let empty3 = '';
                if (ruin.originsRace === null) break;
                const originsRace = ruin.originsRace;
                empty3 = ruin.originsApprovalRatingBonus < 0 ? empty3 + gameText('Ruins Origins Negative', originsRace.name) : empty3 + gameText('Ruins Origins Positive', originsRace.name);
                switch (originsRace.name) {
                    case 'Human':
                        empty3 = gameText('Ruins Origins Human');
                        break;
                    case 'Boskara':
                        empty3 = gameText('Ruins Origins Negative', originsRace.name);
                        break;
                    case 'Kiadian':
                        empty3 = gameText('Ruins Origins Kiadian');
                        break;
                    case 'Sluken':
                        empty3 = gameText('Ruins Origins Negative', originsRace.name);
                        break;
                    case 'Ackdarian':
                        empty3 = gameText('Ruins Origins Ackdarian');
                        break;
                    case 'Gizurean':
                        empty3 = gameText('Ruins Origins Negative', originsRace.name);
                        break;
                }
                // Galaxy.5.cs 4472 `ruin.OriginsRace.SatisfactionModifier += ruin.OriginsApprovalRatingBonus` (int): the
                // galaxy's own Race object (cloneGalaxyRaces; saved in the raceFields side table), not the GameData race.
                originsRace.satisfactionModifier = (originsRace.satisfactionModifier + ruin.originsApprovalRatingBonus) | 0;
                text += gameText('Ruins Origins', ruin.name, originsRace.name);
                text += '\n\n';
                text += empty3;
                text = ruin.originsApprovalRatingBonus < 0 ? text + '\n\n' + gameText('Ruins Origins Negative Effect', originsRace.name) : text + '\n\n' + gameText('Ruins Origins Positive Effect', originsRace.name);
                empty = gameText('History of the RACE', originsRace.name);
                sendEventMessageToEmpire(investigatingEmpire, EventMessageType.OriginsDiscovery, empty, text, originsRace, ruinsHabitat);
                for (let n = 0; n < galaxy.empires.length; n++) {
                    const empire3 = galaxy.empires[n];
                    if (empire3 != null && empire3 !== investigatingEmpire && empire3.dominantRace != null && empire3.dominantRace === originsRace) {
                        let text5 = gameText('Ruins Origins Discovery Other', originsRace.name);
                        text5 += '\n\n';
                        text5 += empty3;
                        text5 = ruin.originsApprovalRatingBonus < 0 ? text5 + '\n\n' + gameText('Ruins Origins Negative Effect', originsRace.name) : text5 + '\n\n' + gameText('Ruins Origins Positive Effect', originsRace.name);
                        sendEventMessageToEmpire(empire3, EventMessageType.OriginsDiscovery, empty, text5, originsRace, ruinsHabitat);
                    }
                }
                break;
            }
            case RuinType.Refugees: {
                let habitat4: Habitat | null = null;
                // Galaxy.5.cs 4496 Systems[ruinsHabitat.SystemIndex].Habitats — the star is not a refugee target.
                const sysHabitats = planetsOf(galaxy.systems[ruinsHabitat.systemIndex]);
                if (sysHabitats != null) {
                    for (let k = 0; k < sysHabitats.length; k++) {
                        const habitat5 = sysHabitats[k];
                        if (habitat5 != null) {
                            const num3 = galaxy.calculateDistance(ruinsHabitat.xpos, ruinsHabitat.ypos, habitat5.xpos, habitat5.ypos);
                            if (num3 > 400.0) {
                                habitat4 = habitat5;
                                break;
                            }
                        }
                    }
                }
                let flag = true;
                if (ruin.refugeesGenerated || habitat4 === null) flag = false;
                if (flag) {
                    const designSpecification = obtainDesignSpec(investigatingEmpire, BuiltObjectSubRole.ColonyShip);
                    const designSpecification2 = obtainDesignSpec(investigatingEmpire, BuiltObjectSubRole.Frigate);
                    const designSpecification3 = obtainDesignSpec(investigatingEmpire, BuiltObjectSubRole.Cruiser);
                    if (designSpecification === null || designSpecification2 === null || designSpecification3 === null) break;
                    const design = generateDesignFromSpec(galaxy, investigatingEmpire, designSpecification, 3.0, galaxyStarDate(galaxy));
                    const design2 = generateDesignFromSpec(galaxy, investigatingEmpire, designSpecification2, 3.0, galaxyStarDate(galaxy));
                    const design3 = generateDesignFromSpec(galaxy, investigatingEmpire, designSpecification3, 3.0, galaxyStarDate(galaxy));
                    const race = selectRandomRace(galaxy, 75);
                    if (design !== null && design2 !== null && design3 !== null) {
                        // TODO(port) M9: PictureRef = ShipImageHelper.ResolveNewShipImageIndex(subRole, race, isPirates: false) ×3
                        // (ShipImageHelper's own Random; visual only).
                        const builtObject = generateAbandonedBuiltObject(galaxy, habitat4!, design, false, false, BuiltObjectEncounterAction.Notify);
                        if (builtObject !== null) {
                            builtObject.name = gameText('Refugee SHIPTYPE', resolveSubRoleDescription(BuiltObjectSubRole.ColonyShip));
                            builtObject.nativeRace = race;
                        }
                        const builtObject2 = generateAbandonedBuiltObject(galaxy, habitat4!, design2, false, false, BuiltObjectEncounterAction.Notify);
                        if (builtObject2 !== null) builtObject2.name = gameText('Refugee SHIPTYPE', resolveSubRoleDescription(BuiltObjectSubRole.Frigate));
                        const builtObject3 = generateAbandonedBuiltObject(galaxy, habitat4!, design3, false, false, BuiltObjectEncounterAction.Notify);
                        if (builtObject3 !== null) builtObject3.name = gameText('Refugee SHIPTYPE', resolveSubRoleDescription(BuiltObjectSubRole.Cruiser));
                        // C# reads race.Name unguarded.
                        text += gameText('Ruins Refugees', ruin.name, race!.name, categoryText(habitat4!), habitat4!.name);
                        empty = gameText('Galactic Refugees Encountered');
                        sendEventMessageToEmpire(investigatingEmpire, EventMessageType.GalacticRefugees, empty, text, ruin, ruinsHabitat);
                    }
                } else {
                    text = text + ' ' + gameText('Our survey team found nothing of interest in the ruins.');
                    sendMessageToEmpire(investigatingEmpire, investigatingEmpire, EmpireMessageType.ExplorationRuins, galaxy, text);
                }
                break;
            }
            case RuinType.StoryEvent:
                // Galaxy.5.cs 4563-4598 (lock StoryLock): the Beacon of Shaktur (story/storyEvents.ts).
                investigateRuinsStoryEvent(galaxy, investigatingEmpire, ruinsHabitat, text);
                break;
        }
        void empty;
        void empty2;
        ruin.clearBonuses();
    } else if (
        investigatingEmpire.dominantRace != null &&
        raceEventsContainsEventType(investigatingEmpire.dominantRace, RaceEventType.HistoricalDiscoveryExploreRuinsForResearchBoost) &&
        investigatingEmpire.raceEventType === RaceEventType.Undefined &&
        galaxy.rnd.next(0, 2) === 1
    ) {
        investigatingEmpire.raceEventType = RaceEventType.HistoricalDiscoveryExploreRuinsForResearchBoost;
        investigatingEmpire.raceEventEndDate = galaxyStarDate(galaxy) + Math.trunc((REAL_SECONDS_IN_GALACTIC_YEAR * 1000) / 2);
        text = gameText('Our survey team made a discovery of galactic significance in the RUINNAME', ruin.name);
        // C# appends text2 only when it is empty (kept).
        if (text2 === '') text += text2;
        sendEventMessageToEmpire(investigatingEmpire, EventMessageType.GeneralRuinsDiscovery, gameText('Unusual Technology Discovered'), text, ruin, ruinsHabitat);
    } else if (text2 === '') {
        text = gameText('Our survey team found nothing of interest in the RUINNAME', ruin.name);
        sendEventMessageToEmpire(investigatingEmpire, EventMessageType.GeneralRuinsDiscovery, gameText('Ruins are Silent'), text, ruin, ruinsHabitat);
    } else {
        text = text2;
        sendEventMessageToEmpire(investigatingEmpire, EventMessageType.GeneralRuinsDiscovery, gameText('Navigational Coordinates'), text, ruin, ruinsHabitat);
    }
}

/**
 * Habitat.cs 2504 CheckForShipsDiscoveringRuins: empire ships (not independent/pirate) within 500 of a ruin with a
 * benefit investigate it (the player is asked unless DiscoveryActionRuin is set). Rnd: only inside InvestigateRuins.
 */
export function checkForShipsDiscoveringRuins(galaxy: Galaxy, habitat: Habitat): void {
    const ruin = habitat.ruin;
    if (ruin === null || (!checkRuinsHaveBenefit(galaxy, ruin, null) && ruin.storyClueLevel < 0 && ruin.playerEmpireEncountered)) return;
    const builtObjectsAtLocation = getBuiltObjectsAtLocation(galaxy, habitat.xpos, habitat.ypos, 500);
    for (let i = 0; i < builtObjectsAtLocation.length; i++) {
        const builtObject = builtObjectsAtLocation[i];
        if (builtObject == null) continue;
        const boEmpire = builtObject.empire as Empire | null;
        if (boEmpire === null || boEmpire === galaxy.independentEmpire || boEmpire.pirateEmpireBaseHabitat !== null) continue;
        const num = galaxy.calculateDistanceSquared(habitat.xpos, habitat.ypos, builtObject.xpos, builtObject.ypos);
        if (!(num < 250000.0)) continue;
        let flag = false;
        let flag2 = false;
        addScientificData(builtObject, habitat, 'scientificData');
        if (boEmpire === galaxy.playerEmpire) {
            flag2 = true;
            if (ruin.playerEmpireEncountered) flag = true;
            else ruin.playerEmpireEncountered = true;
        }
        if (flag) continue;
        const flag3 = checkRuinsHaveBenefit(galaxy, ruin, boEmpire);
        if (flag2) {
            // Habitat.cs 2545: _Galaxy.PlayerEmpire.DiscoveryActionRuin (GameOptions; > 0 investigates without asking).
            if (galaxy.playerEmpire!.discoveryActionRuin > 0) {
                if (flag3) investigateRuins(galaxy, boEmpire, habitat);
                continue;
            }
            // 2553-2563: "We have discovered ancient ruins" + SendEventMessageToEmpire EncounterRuins — UI only.
        } else if (flag3 && !boEmpire.reclusive) {
            investigateRuins(galaxy, boEmpire, habitat);
        }
    }
}

/**
 * Habitat.cs 2615 CheckForShipsOfNewEmpiresInSystem(galaxy, time) → 2623 PerformThreatEvaluation(time): refreshes the
 * owner's per-system threat cache at most every 5 s. EvaluateSystemThreats is combat/threats.ts; no Rnd.
 */
export function checkForShipsOfNewEmpiresInSystem(galaxy: Galaxy, habitat: Habitat, time: number): void {
    if (habitat.owner !== null && habitat.owner !== galaxy.independentEmpire) {
        performThreatEvaluation(galaxy, habitat, time);
    }
}

/** Habitat.cs 2623 PerformThreatEvaluation(time). */
function performThreatEvaluation(galaxy: Galaxy, habitat: Habitat, time: number): void {
    const empire = habitat.empire;
    if (empire !== null && empire !== galaxy.independentEmpire) {
        const dateTime = time - 5000; // time.Subtract(new TimeSpan(0, 0, 5))
        const sv = empire.systemVisibility[habitat.systemIndex];
        if (sv.latestThreatEvaluation < dateTime) {
            const systemStar = galaxy.determineHabitatSystemStar(habitat);
            const result = evaluateSystemThreats(galaxy, systemStar, empire);
            sv.threats = result.threats;
            sv.threatLevels = result.threatLevels;
            sv.latestThreatEvaluation = time;
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Territory scheduling
// ---------------------------------------------------------------------------------------------------------------

/**
 * Galaxy.cs 3376 ReviewEmpireTerritory(onlySystems) → 3384 ReviewEmpireTerritoryCore(onlySystems). In C# the core
 * runs on the ThreadPool (a review requested while one runs sets _RegenerateEmpireTerritoryAgain and is re-run once);
 * the TS runs it synchronously (plan §4), so the re-run path only triggers on re-entry. OnRefreshView is UI. No Rnd.
 */
export function reviewEmpireTerritory(galaxy: Galaxy, onlySystems: boolean): void {
    if (galaxy.regeneratingEmpireTerritory) {
        galaxy.regenerateEmpireTerritoryAgain = true;
        return;
    }
    galaxy.regeneratingEmpireTerritory = true;
    try {
        galaxy.empireTerritory.reviewEmpireTerritoryOnlySystems(galaxy, onlySystems);
        if (galaxy.regenerateEmpireTerritoryAgain) {
            galaxy.regenerateEmpireTerritoryAgain = false;
            galaxy.empireTerritory.reviewEmpireTerritoryOnlySystems(galaxy, onlySystems);
        }
    } finally {
        galaxy.regeneratingEmpireTerritory = false;
    }
}

/** Galaxy.cs 3376 ReviewEmpireTerritory(onlySystems: true) (Galaxy.DoTasks long block, Galaxy.cs 3124). */
export function reviewEmpireTerritorySystemsOnly(galaxy: Galaxy): void {
    reviewEmpireTerritory(galaxy, true);
}
