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
// headless) — those calls and the text they format are omitted (no state, no Rnd). Empire.SendMessageToEmpire calls
// are kept (messages.ts queue) with GameText keys as descriptions (TextResolver is not ported; M9).
// Scripted game events (GameEvents) are empty in a normal game (plan §0.3): GetMatchingGameEventIdEmpireEncounter
// returns no id and CheckTriggerEvent does nothing — omitted with TODO(port) notes.

import type { Galaxy } from './galaxy';
import type { Empire } from './empire';
import { BuiltObject } from './builtObject';
import type { Design } from './design';
import { HabitatCategoryType, type Habitat, type HabitatType } from './types';
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
import { evaluateSystemThreats } from './combat/threats';
import { reviewEmpireAbilityBonuses } from './treasury';
import { determineEmpireSystems } from './forceStructure';
import { strategicValue } from './territory';
import { generateDesignFromSpec } from './designGeneration';
import { selectRandomRace } from './pirates';

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

/** BaconBuiltObject.cs 58-59 scientificDataForResourceSurvey / scientificDataForRuins. */
const SCIENTIFIC_DATA_FOR_RESOURCE_SURVEY = 3;
const SCIENTIFIC_DATA_FOR_RUINS = 90;

/** ComponentStatus.Normal (ComponentStatus.cs). */
const COMPONENT_STATUS_NORMAL = 0;

/** GameText keys (TextResolver.GetText, not ported — M9) with their arguments, as message descriptions. */
function gameText(key: string, ...args: string[]): string {
    return args.length > 0 ? `${key}: ${args.join(', ')}` : key;
}

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

/** Galaxy.3.cs 1621 FastFindNearestColony(x, y, empire, strategicValueThreshhold, colonyToExclude = null). */
function fastFindNearestColony(galaxy: Galaxy, x: number, y: number, empire: Empire, strategicValueThreshhold: number): Habitat | null {
    let num = Number.MAX_VALUE;
    let result: Habitat | null = null;
    for (let i = 0; i < empire.colonies.length; i++) {
        if (strategicValue(empire.colonies[i]) >= strategicValueThreshhold) {
            const num2 = galaxy.calculateDistanceSquared(x, y, empire.colonies[i].xpos, empire.colonies[i].ypos);
            if (num2 < num) {
                result = empire.colonies[i];
                num = num2;
            }
        }
    }
    return result;
}

/** Empire.4.cs 4408 CanEmpireColonizeHabitatRange(empire, habitat). */
function canEmpireColonizeHabitatRange(galaxy: Galaxy, empire: Empire, habitat: Habitat): boolean {
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

/**
 * EmpireEvaluation.FirstContactPenalty (double, EmpireEvaluation.cs 35). TODO(port) M4r: the TS EmpireEvaluation
 * (taxes.ts) has no FirstContactPenalty field yet; the value is written onto the evaluation object for M4r's model.
 */
function setFirstContactPenalty(evaluation: EmpireEvaluation, value: number): void {
    (evaluation as EmpireEvaluation & { firstContactPenalty?: number }).firstContactPenalty = value;
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
            ship.baconValues.set('scientificData', planet.resources.length * SCIENTIFIC_DATA_FOR_RESOURCE_SURVEY + baconValue);
            return;
        case 'scientificData':
            num = planet.ruin !== null ? (!planet.ruin.playerEmpireEncountered ? 1 : 0) : 0;
            break;
        default:
            num = 0;
            break;
    }
    if (num === 0) return;
    ship.baconValues.set('scientificData', SCIENTIFIC_DATA_FOR_RUINS + baconValue);
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
function empiresSharedVisibility(galaxy: Galaxy, empire: Empire): Empire[] {
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
 * RND: ChangeDiplomaticRelation (M4r, 1 draw) inside MergeGalaxyMap — not drawn until M4r.
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
            // TODO(port) M4r: Empire._CivilityRating (reputation model) — 0.0 until ported (taxes.ts reads it the same way).
            const civilityRating = 0.0;
            const num7 = 1.0 - civilityRating / 100.0;
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
 * RND: CheckSendPreWarpProgressEventMessage (M4u, 7 draws) — not drawn until M4u.
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
        const flag = true;
        if (galaxy.storyReturnOfTheShakturiEnabled) {
            // TODO(port) M4u (story, deferred): Galaxy.7.cs 4016-4140 — Mechanoid / Erutkah encounters (flag = false for
            // a Mechanoid discoverer; player messages, +10000 money) and the Shakturi bias adjustments. Only reachable
            // with the Return of the Shakturi story enabled (off in a normal game).
        }
        diplomaticRelation.type = DiplomaticRelationType.None;
        // TODO(port) M4u: GetMatchingGameEventIdEmpireEncounter + CheckTriggerEvent(EmpireEncounter) (Galaxy.7.cs 4143) —
        // GameEvents is empty in a normal game, so no event fires.
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

const T_investigateRuins = registerTodo('M4t', 'investigateRuins');
/**
 * Galaxy.5.cs 4045 InvestigateRuins(investigatingEmpire, ruinsHabitat) — NOT PORTED YET (remaining M4t work):
 * treasure (+ PirateEconomy.PerformIncome, M4s), research breakthrough (SelectRandomNextResearchProject… /
 * DoResearchBreakthrough, M4k), map reveal (FastFindNearestUnexploredHabitat, M4f), the ruin-type outcomes
 * (creatures, pirate ambush, lost ship / colony, refugees, government revolution, origins, new population),
 * Ruin.ClearBonuses, and the race-event branch.
 * RND: story-hint Next(0,2), research project choice, Kaltor Next(3,6), ambush Next(3,5)/NextDouble, lost-object
 * Next(0,2), lost-colony NextDouble, SelectRandomRace/Empire, race-event Next(0,2) — not drawn until ported.
 */
export function investigateRuins(galaxy: Galaxy, investigatingEmpire: Empire | null, ruinsHabitat: Habitat | null): void {
    /* TODO(port) M4t */ todo(T_investigateRuins);
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
            // Empire.DiscoveryActionRuin (player preference; > 0 investigates automatically).
            // TODO(port): the TS Empire has no DiscoveryActionRuin preference yet — 0, the C# default (ask the player).
            const discoveryActionRuin = 0;
            if (discoveryActionRuin > 0) {
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
 * owner's per-system threat cache at most every 5 s. RND: EvaluateSystemThreats (M4n) — not drawn until M4n.
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
