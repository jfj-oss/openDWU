// M4z3 — the scripted game-event interpreter (tasks/M4-deferred-plan.md row M4z3). Ports of Galaxy.9.cs:
//   1179-1268 GetMatchingGameEventId{DiplomaticRelationChange, EmpireEncounter, ResearchBreakthrough,
//             PlanetDestroyerConstructionCompleted, EmpireEliminated, CharacterAppears, CharacterKilled}
//   1270 CheckTriggerEvent, 1399/1408 DoGameEvent, 1439 ExecuteOrDelayEventAction, 1466 AddDelayedEventAction,
//   1474 ProcessDelayedEventActions, 1503-2860 ExecuteEventAction
// and BaconGalaxy.cs 308 ExecuteEventAction (the Bacon mod's scripted "Delayed" actions, called at the end of the base one).
//
// A generated game defines no GameEvents (only the scenario editor adds them) and the TS never queues a Bacon action, so in a
// normal game Galaxy.DelayedActions stays empty and ProcessDelayedEventActions returns at once (no Rnd).
//
// Galaxy.Rnd draws, in C# order:
//   DoGameEvent: Next(0, Actions.Count) for ExecuteSingleRandomAction with more than one action.
//   ExecuteOrDelayEventAction: RandomDelay → Next(0, max(0, DelayDaysMaximum − DelayDaysMinimum)).
//   ExecuteEventAction: GenerateNewEmpire Next(0, governments) + GenerateEmpire's; GenerateNewPirateFaction
//     SelectRelativeHabitatSurfacePoint + SelectRandomPiratePlaystyle + GeneratePirateEmpire's; GeneratePirateAmbush
//     NextDouble ×2 per relocation try + GeneratePirateShip's (name, heading); GenerateRefugeeFleet SelectRandomRace(75) when no
//     race + GenerateAbandonedBuiltObject's; GenerateCreatureSwarm per creature; GenerateResourceAtHabitat Next(300, 700);
//     StartPlague / DisasterAtColony the empire events'; SplitEmpire* NextDouble (+ InitiateEmpireSplit, unported);
//     ResearchBonusInProject NextDouble; IntergalacticConvoy* the convoy generators'; CharacterGenerate GenerateNewCharacter's.
//   BaconGalaxy.ExecuteEventAction: "ProcessEmpireScienceShips" ProcessScienceShips' GetRandomResearchNode Next(0, n) per
//     lab without a current project, then Next(26, 35).
//
// UI-only statements are TODO(port) M9 notes: Galaxy.LocationPinged (RevealObject), OnCharacterImageChanged,
// ShipImageHelper picture picks (ShipImageHelper._Rnd, not Galaxy.Rnd).

import { executeProcessEmpireScienceShips } from '../baconScienceShips';
import { baconSettings } from '../data/baconSettings';
import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import { Empire as EmpireClass } from '../empire';
import { planetsOf, type Habitat } from '../types';
import type { BuiltObject } from '../builtObject';
import { BuiltObject as BuiltObjectClass } from '../builtObject';
import type { Creature } from '../creature';
import { CreatureType } from '../creature';
import type { Character } from '../characters';
import { CharacterEventType, CharacterRole, applyRandomCharacterSkillsTraits, doCharacterEvent, generateNewCharacterRandom, identifyPirateBase, raceAvailableCharacters } from '../characters';
import type { Race } from '../data/races';
import { isBuiltObject, isCreature, isHabitat, BuiltObjectMissionType, BuiltObjectMissionPriority, type BuiltObjectMission } from '../missions/mission';
import { assignMission } from '../missions/assign';
import {
    EventAction,
    EventActionExecutionPackage,
    EventActionExecutionType,
    EventActionType,
    EventTriggerType,
    GameEvent,
    MultipleEventActionType,
    registerStellarObjectKinds,
    shortCast,
    type EventStellarObject,
} from './gameEventModel';
import { REAL_SECONDS_IN_GALACTIC_YEAR, galaxyNow, galaxyStarDate } from '../tick/simTime';
import { gameText } from '../colonyTick';
import { resolveDescription } from '../messages';
import { sendEventMessageToEmpire } from '../events';
import { EventMessageType } from '../eventTypes';
import { galaxyPlagues } from '../eventTypes';
import { BuiltObjectRole } from '../data/designSpecifications';
import { BuiltObjectSubRole } from '../builtObjectTypes';
import { HabitatCategoryType, HabitatType } from '../types';
import { takeOwnershipOfBuiltObject, takeOwnershipOfColonyFull } from '../combat/ownership';
import { inflictDamageFull, identifyPirateSpaceport, pirateFactionJoinsEmpire } from '../combat/damage';
import { checkRemoveFacilityTracking, planetaryFacilityDefinitionsStatic, queueFacilityConstruction, queueWonderConstruction, reviewPlanetaryFacilities, type PlanetaryFacility } from '../construction/facilities';
import { PlanetaryFacilityType, facilityType } from '../researchSystem';
import { findNodeById } from '../researchSystem';
import { habitatCompareTo, fastFindNearestSpacePort } from '../stationPlacement';
import { netSort } from '../netSort';
import { getGovernmentsStatic } from '../empire';
import { changeGovernment, haveRevolution } from '../treasury';
import { raceBiasesGetBias, raceBiasesSetBias } from '../raceBias';
import { SystemVisibilityStatus } from '../visibility';
import { declareWar, changeDiplomaticRelation } from '../diplomacyTick';
import { DiplomaticRelationType, obtainDiplomaticRelation, obtainEmpireEvaluation, type EmpireEvaluation } from '../diplomacy';
import {
    empireEventColonyNaturalDisaster,
    empireEventColonyResourceAppearance,
    empireEventColonyResourceDepletion,
    empireEventPlague,
    empireEventRogueFleetDefectsTo,
    initiateEmpireSplit,
    randomEventRareResourceInterceptedAt,
    resolveSectorDescription,
} from '../empireEvents';
import { getLowestEvaluationKnownEmpire } from '../pirates/missionsMarket';
import { PirateRelationType, changePirateRelation, obtainPirateRelation } from '../pirateRelations';
import { PirateIncomeType } from '../pirates/pirateEconomy';
import { generateDesignFromSpec } from '../designGeneration';
import { BuiltObjectEncounterAction, generateAbandonedBuiltObject } from '../gameStartTail';
import { determineMostSuitableGovernmentTypes } from '../game';
import { generateEmpire } from '../empireGeneration';
import { findNearestPirateFaction, generatePirateEmpire, selectRandomPiratePlaystyle, selectRandomRace } from '../pirates';
import { raceDesignPictureFamilyIndexPirates } from '../empire';
import { makeHabitatIntoColonyRuntime } from '../missions/cmdTroops';
import { addLocationHint } from '../tradeItems';
import { fastFindNearestUnexploredHabitat } from '../civilianAI';
import { doResearchBreakthrough, reviewDesignsBuiltObjectsImprovedComponents } from '../researchTick';
import { Population, PopulationList } from '../population';
import { identifyNearestAvailableFleet } from '../fleets/militaryAI';
import { shipGroupAssignMission } from '../fleets/shipGroup';
import { withinFuelRangeAndRefuel } from '../movement';
import { generateCivilianConvoy, generateMilitaryConvoy } from './storyEvents';
import type { Design } from '../design';

registerStellarObjectKinds({ isHabitat, isBuiltObject, isCreature });

// ---------------------------------------------------------------------------
// Galaxy.9.cs 1179-1268 GetMatchingGameEventId*
// ---------------------------------------------------------------------------

/** Galaxy.9.cs 1179 GetMatchingGameEventIdDiplomaticRelationChange(empire1, empire2, relationType). No Rnd. */
export function getMatchingGameEventIdDiplomaticRelationChange(galaxy: Galaxy, empire1: Empire | null, empire2: Empire | null, relationType: DiplomaticRelationType): number {
    const list = galaxy.gameEvents.items;
    for (let i = 0; i < list.length; i++) {
        const gameEvent = list[i];
        if (gameEvent != null && !gameEvent.hasBeenTriggered && gameEvent.triggerType === EventTriggerType.DiplomaticRelationChange && gameEvent.empire === empire1 && gameEvent.empireOther === empire2 && gameEvent.diplomaticRelationType === relationType) {
            return gameEvent.gameEventId;
        }
    }
    return -1;
}

/** Galaxy.9.cs 1192 GetMatchingGameEventIdEmpireEncounter(empire1, empire2). No Rnd. */
export function getMatchingGameEventIdEmpireEncounter(galaxy: Galaxy, empire1: Empire | null, empire2: Empire | null): number {
    const list = galaxy.gameEvents.items;
    for (let i = 0; i < list.length; i++) {
        const gameEvent = list[i];
        if (gameEvent != null && !gameEvent.hasBeenTriggered && gameEvent.triggerType === EventTriggerType.EmpireEncounter && gameEvent.empire === empire1 && gameEvent.empireOther === empire2) {
            return gameEvent.gameEventId;
        }
    }
    return -1;
}

/** Galaxy.9.cs 1205 GetMatchingGameEventIdResearchBreakthrough(empire1, researchProjectId). No Rnd. */
export function getMatchingGameEventIdResearchBreakthrough(galaxy: Galaxy, empire1: Empire | null, researchProjectId: number): number {
    const list = galaxy.gameEvents.items;
    for (let i = 0; i < list.length; i++) {
        const gameEvent = list[i];
        if (gameEvent != null && !gameEvent.hasBeenTriggered && gameEvent.triggerType === EventTriggerType.ResearchBreakthrough && gameEvent.empire === empire1 && gameEvent.researchProjectId === researchProjectId) {
            return gameEvent.gameEventId;
        }
    }
    return -1;
}

/** Galaxy.9.cs 1218 GetMatchingGameEventIdPlanetDestroyerConstructionCompleted(empire1). No Rnd. */
export function getMatchingGameEventIdPlanetDestroyerConstructionCompleted(galaxy: Galaxy, empire1: Empire | null): number {
    const list = galaxy.gameEvents.items;
    for (let i = 0; i < list.length; i++) {
        const gameEvent = list[i];
        if (gameEvent != null && !gameEvent.hasBeenTriggered && gameEvent.triggerType === EventTriggerType.PlanetDestroyerConstructionCompleted && gameEvent.empire === empire1) {
            return gameEvent.gameEventId;
        }
    }
    return -1;
}

/** Galaxy.9.cs 1231 GetMatchingGameEventIdEmpireEliminated(empire, eliminatingEmpire). No Rnd. */
export function getMatchingGameEventIdEmpireEliminated(galaxy: Galaxy, empire: Empire | null, eliminatingEmpire: Empire | null): number {
    const list = galaxy.gameEvents.items;
    for (let i = 0; i < list.length; i++) {
        const gameEvent = list[i];
        if (gameEvent != null && !gameEvent.hasBeenTriggered && gameEvent.triggerType === EventTriggerType.EmpireEliminated && gameEvent.empire === empire && (gameEvent.empireOther === null || gameEvent.empireOther === eliminatingEmpire)) {
            return gameEvent.gameEventId;
        }
    }
    return -1;
}

/** Galaxy.9.cs 1244 GetMatchingGameEventIdCharacterAppears(character). No Rnd. */
export function getMatchingGameEventIdCharacterAppears(galaxy: Galaxy, character: Character | null): number {
    const list = galaxy.gameEvents.items;
    for (let i = 0; i < list.length; i++) {
        const gameEvent = list[i];
        if (gameEvent != null && !gameEvent.hasBeenTriggered && gameEvent.triggerType === EventTriggerType.CharacterAppears && gameEvent.character === character) {
            return gameEvent.gameEventId;
        }
    }
    return -1;
}

/** Galaxy.9.cs 1257 GetMatchingGameEventIdCharacterKilled(character). No Rnd. */
export function getMatchingGameEventIdCharacterKilled(galaxy: Galaxy, character: Character | null): number {
    const list = galaxy.gameEvents.items;
    for (let i = 0; i < list.length; i++) {
        const gameEvent = list[i];
        if (gameEvent != null && !gameEvent.hasBeenTriggered && gameEvent.triggerType === EventTriggerType.CharacterKilled && gameEvent.character === character) {
            return gameEvent.gameEventId;
        }
    }
    return -1;
}

// ---------------------------------------------------------------------------
// Galaxy.9.cs 1270 CheckTriggerEvent / 1399-1437 DoGameEvent
// ---------------------------------------------------------------------------

/** `X.GameEventId *= -1` on a C# short (short.MinValue stays short.MinValue). */
function negateGameEventId(o: { gameEventId: number }): void {
    o.gameEventId = shortCast(o.gameEventId * -1);
}

/** `X.GameEventId = Math.Abs(X.GameEventId)` (Math.Abs(short.MinValue) throws OverflowException in C#). */
function absGameEventId(o: { gameEventId: number }): void {
    if (o.gameEventId === -32768) throw new Error('OverflowException: Math.Abs(short.MinValue) (Galaxy.9.cs CheckTriggerEvent)');
    o.gameEventId = Math.abs(o.gameEventId);
}

/**
 * Galaxy.9.cs 1270 CheckTriggerEvent(gameEventId, triggerEmpire, triggerType, additionalData): runs the matching untriggered
 * event of that trigger type. The trigger object's / ruin's GameEventId is negated while the event runs and restored when it
 * did not trigger. Rnd: DoGameEvent's.
 */
export function checkTriggerEvent(galaxy: Galaxy, gameEventId: number, triggerEmpire: Empire | null, triggerType: EventTriggerType, additionalData: unknown): boolean {
    if (gameEventId >= 0) {
        const byId = galaxy.gameEvents.getById(gameEventId);
        if (byId !== null && !byId.hasBeenTriggered && byId.triggerType === triggerType) {
            switch (triggerType) {
                case EventTriggerType.Investigate: {
                    if (byId.triggerRuin !== null) {
                        negateGameEventId(byId.triggerRuin);
                        doGameEvent(galaxy, byId, triggerEmpire);
                        if (byId.hasBeenTriggered) return true;
                        absGameEventId(byId.triggerRuin);
                        return false;
                    }
                    if (byId.triggerObject === null || !isBuiltObject(byId.triggerObject)) break;
                    const builtObject2 = byId.triggerObject;
                    if (builtObject2.owner === null) {
                        negateGameEventId(byId.triggerObject);
                        doGameEvent(galaxy, byId, triggerEmpire);
                        if (byId.hasBeenTriggered) return true;
                        absGameEventId(byId.triggerObject);
                        return false;
                    }
                    break;
                }
                case EventTriggerType.DiplomaticRelationChange:
                case EventTriggerType.EmpireEncounter:
                case EventTriggerType.ResearchBreakthrough:
                case EventTriggerType.PlanetDestroyerConstructionCompleted:
                case EventTriggerType.EmpireEliminated:
                case EventTriggerType.CharacterAppears:
                case EventTriggerType.CharacterKilled:
                    doGameEvent(galaxy, byId, triggerEmpire);
                    if (byId.hasBeenTriggered) return true;
                    break;
                case EventTriggerType.Destroy:
                case EventTriggerType.Capture:
                    if (byId.triggerObject !== null) {
                        negateGameEventId(byId.triggerObject);
                        doGameEvent(galaxy, byId, triggerEmpire);
                        if (byId.hasBeenTriggered) return true;
                        absGameEventId(byId.triggerObject);
                        return false;
                    }
                    break;
                case EventTriggerType.Build: {
                    if (byId.triggerObject === null || !isHabitat(byId.triggerObject)) break;
                    if (byId.triggerFacility !== null) {
                        if (additionalData == null || !isPlanetaryFacility(additionalData)) break;
                        const planetaryFacility = additionalData;
                        if (planetaryFacility.planetaryFacilityDefinitionId === byId.triggerFacility.facilityId) {
                            negateGameEventId(byId.triggerObject);
                            doGameEvent(galaxy, byId, triggerEmpire);
                            if (byId.hasBeenTriggered) return true;
                            absGameEventId(byId.triggerObject);
                            return false;
                        }
                    } else {
                        if (byId.triggerBuiltObjectSubRole === BuiltObjectSubRole.Undefined || additionalData == null || !isBuiltObject(additionalData)) break;
                        const builtObject = additionalData;
                        if (builtObject.subRole === byId.triggerBuiltObjectSubRole) {
                            negateGameEventId(byId.triggerObject);
                            doGameEvent(galaxy, byId, triggerEmpire);
                            if (byId.hasBeenTriggered) return true;
                            absGameEventId(byId.triggerObject);
                            return false;
                        }
                    }
                    break;
                }
            }
        }
    }
    return false;
}

function isPlanetaryFacility(o: unknown): o is PlanetaryFacility {
    return typeof o === 'object' && o !== null && 'def' in o && 'planetaryFacilityDefinitionId' in (o as object);
}

/** Galaxy.9.cs 1399 DoGameEvent(gameEventId, triggerEmpire). */
export function doGameEventById(galaxy: Galaxy, gameEventId: number, triggerEmpire: Empire | null): void {
    if (gameEventId >= 0 && gameEventId < galaxy.gameEvents.count) {
        const byId = galaxy.gameEvents.getById(gameEventId);
        doGameEvent(galaxy, byId, triggerEmpire);
    }
}

/**
 * Galaxy.9.cs 1408 DoGameEvent(gameEvent, triggerEmpire): marks the event triggered and executes (or delays) its actions —
 * one random action (Rnd.Next(0, count)) for ExecuteSingleRandomAction with several actions, else all in order.
 */
export function doGameEvent(galaxy: Galaxy, gameEvent: GameEvent | null, triggerEmpire: Empire | null): void {
    if (gameEvent === null || gameEvent.hasBeenTriggered || (gameEvent.canOnlyBeTriggeredByPlayer && triggerEmpire !== galaxy.playerEmpire)) return;
    gameEvent.hasBeenTriggered = true;
    if (gameEvent.actions === null || gameEvent.actions.count <= 0) return;
    const currentStarDate = galaxyStarDate(galaxy);
    if (gameEvent.actions.count > 1) {
        if (gameEvent.actions.executionType === MultipleEventActionType.ExecuteSingleRandomAction) {
            const index = galaxy.rnd.next(0, gameEvent.actions.count);
            executeOrDelayEventAction(galaxy, gameEvent.actions.items[index], triggerEmpire, gameEvent, currentStarDate);
            return;
        }
        for (let i = 0; i < gameEvent.actions.count; i++) {
            executeOrDelayEventAction(galaxy, gameEvent.actions.items[i], triggerEmpire, gameEvent, currentStarDate);
        }
    } else {
        executeOrDelayEventAction(galaxy, gameEvent.actions.items[0], triggerEmpire, gameEvent, currentStarDate);
    }
}

/**
 * Galaxy.9.cs 1439 ExecuteOrDelayEventAction(eventAction, triggerEmpire, gameEvent, starDate). One game day is
 * RealSecondsInGalacticYear * 1000 / 360 (long division) star-date ms. Rnd: Next(0, max(0, max − min)) for RandomDelay.
 */
export function executeOrDelayEventAction(galaxy: Galaxy, eventAction: EventAction | null, triggerEmpire: Empire | null, gameEvent: GameEvent | null, starDate: number): void {
    if (eventAction === null) return;
    const num = Math.trunc((REAL_SECONDS_IN_GALACTIC_YEAR * 1000) / 360);
    switch (eventAction.executionType) {
        case EventActionExecutionType.Immediately:
            executeEventAction(galaxy, eventAction, triggerEmpire, gameEvent);
            break;
        case EventActionExecutionType.Delay:
            eventAction.executionDate = starDate + eventAction.delayDaysMinimum * num;
            addDelayedEventAction(galaxy, eventAction, triggerEmpire, gameEvent);
            break;
        case EventActionExecutionType.RandomDelay: {
            const num2 = galaxy.rnd.next(0, Math.max(0, eventAction.delayDaysMaximum - eventAction.delayDaysMinimum));
            eventAction.executionDate = starDate + (eventAction.delayDaysMinimum + num2) * num;
            addDelayedEventAction(galaxy, eventAction, triggerEmpire, gameEvent);
            break;
        }
    }
}

/** Galaxy.9.cs 1466 AddDelayedEventAction (lock → single-threaded TS). */
export function addDelayedEventAction(galaxy: Galaxy, eventAction: EventAction, triggerEmpire: Empire | null, gameEvent: GameEvent | null): void {
    galaxy.delayedActions.push(new EventActionExecutionPackage(eventAction, gameEvent, triggerEmpire));
}

/**
 * Galaxy.9.cs 1474 ProcessDelayedEventActions(starDate): runs every queued action whose ExecutionDate has come (over a copy
 * of the list, in list order), then removes the executed packages (List.Remove: first occurrence). No Rnd of its own.
 */
export function processDelayedEventActions(galaxy: Galaxy, starDate: number): void {
    if (galaxy.delayedActions.length <= 0) return;
    const eventActionExecutionPackageList: EventActionExecutionPackage[] = [];
    const array = galaxy.delayedActions.slice();
    for (const eventActionExecutionPackage of array) {
        if (eventActionExecutionPackage != null && eventActionExecutionPackage.action !== null && eventActionExecutionPackage.action.executionDate <= starDate) {
            executeEventAction(galaxy, eventActionExecutionPackage.action, eventActionExecutionPackage.triggerEmpire, eventActionExecutionPackage.gameEvent);
            eventActionExecutionPackageList.push(eventActionExecutionPackage);
        }
    }
    for (let j = 0; j < eventActionExecutionPackageList.length; j++) {
        const idx = galaxy.delayedActions.indexOf(eventActionExecutionPackageList[j]);
        if (idx >= 0) galaxy.delayedActions.splice(idx, 1);
    }
}

// ---------------------------------------------------------------------------
// Small C# list helpers used by ExecuteEventAction
// ---------------------------------------------------------------------------

/** HabitatList.cs 541 GetOwnedColonies(empire). */
function getOwnedColonies(colonies: readonly Habitat[], empire: Empire): Habitat[] {
    const ownedColonies: Habitat[] = [];
    for (let index = 0; index < colonies.length; ++index) {
        const habitat = colonies[index];
        if (habitat != null && habitat.owner === empire) ownedColonies.push(habitat);
    }
    return ownedColonies;
}

/** PlanetaryFacilityList.GetById(planetaryFacilityDefinitionId): first facility of that definition. */
function facilitiesGetById(facilities: readonly PlanetaryFacility[] | null, planetaryFacilityDefinitionId: number): PlanetaryFacility | null {
    if (facilities == null) return null;
    for (let i = 0; i < facilities.length; i++) {
        const f = facilities[i];
        if (f != null && f.planetaryFacilityDefinitionId === planetaryFacilityDefinitionId) return f;
    }
    return null;
}

/** HabitatList.cs 117 FindColonyWithFacilityId(planetaryFacilityDefinitionId). */
function findColonyWithFacilityId(colonies: readonly Habitat[], planetaryFacilityDefinitionId: number): Habitat | null {
    for (let index = 0; index < colonies.length; ++index) {
        const h = colonies[index];
        if (h != null && !h.hasBeenDestroyed && h.facilities != null && facilitiesGetById(h.facilities, planetaryFacilityDefinitionId) !== null) return h;
    }
    return null;
}

/** DesignSpecificationList.GetBySubRole(subRole): first specification of that sub-role. */
function designSpecificationsGetBySubRole(empire: Empire, subRole: BuiltObjectSubRole) {
    for (let i = 0; i < empire.designSpecifications.length; i++) {
        const s = empire.designSpecifications[i];
        if (s !== null && s.subRole === subRole) return s;
    }
    return null;
}

/** Empire.10.cs 3372 ObtainDesignSpec(subRole) — same lookup as GetBySubRole on Empire._DesignSpecifications. */
function obtainDesignSpec(empire: Empire, subRole: BuiltObjectSubRole) {
    return designSpecificationsGetBySubRole(empire, subRole);
}

/** BuiltObjectList.cs 114 GetFirstAvailableWithinRange(role, x, y, fuelPortionMargin, includeLowAndNormalPriorityMissions). */
export function getFirstAvailableWithinRange(galaxy: Galaxy, list: readonly BuiltObject[], role: BuiltObjectRole, x: number, y: number, fuelPortionMargin: number, includeLowAndNormalPriorityMissions: boolean): BuiltObject | null {
    for (let i = 0; i < list.length; i++) {
        const bo = list[i];
        const mission = bo != null ? (bo.mission as BuiltObjectMission | null) : null;
        if (
            bo != null &&
            !bo.hasBeenDestroyed &&
            bo.role === role &&
            bo.builtAt === null &&
            bo.unbuiltComponentCount <= 0 &&
            (mission === null ||
                mission.type === BuiltObjectMissionType.Undefined ||
                (includeLowAndNormalPriorityMissions && (mission.priority === BuiltObjectMissionPriority.Low || mission.priority === BuiltObjectMissionPriority.Normal))) &&
            withinFuelRangeAndRefuel(galaxy, bo, x, y, fuelPortionMargin)
        ) {
            return bo;
        }
    }
    return null;
}

/** BuiltObjectList.cs 477 GetNearestBuiltObjectCompleteUndamaged(x, y, role, builtObjectToExclude). */
function getNearestBuiltObjectCompleteUndamaged(list: readonly BuiltObject[], x: number, y: number, role: BuiltObjectRole, builtObjectToExclude: BuiltObject | null): BuiltObject | null {
    let result: BuiltObject | null = null;
    let num = Number.MAX_VALUE;
    for (let i = 0; i < list.length; i++) {
        const bo = list[i];
        if (bo != null && bo !== builtObjectToExclude && bo.role === role && bo.unbuiltOrDamagedComponentCount <= 0 && bo.builtAt === null) {
            const dx = x - bo.xpos;
            const dy = y - bo.ypos;
            const num2 = dx * dx + dy * dy; // Galaxy.CalculateDistanceSquaredStatic
            if (num2 < num) {
                num = num2;
                result = bo;
            }
        }
    }
    return result;
}

/**
 * Galaxy.8.cs 2745 GeneratePirateShip(pirateEmpire, subRole, habitat): the first design of that sub-role, fully built, at the
 * habitat. Rnd: SelectRandomUniqueMilitaryShipName, SelectRandomHeading, AddBuiltObjectToGalaxy (offset from parent).
 */
export function generatePirateShip(galaxy: Galaxy, pirateEmpire: Empire, subRole: BuiltObjectSubRole, habitat: Habitat): BuiltObject | null {
    let design: Design | null = null;
    for (let i = 0; i < pirateEmpire.designs.length; i++) {
        const design2 = pirateEmpire.designs[i];
        if (design2.subRole === subRole) {
            design = design2;
            break;
        }
    }
    if (design !== null) {
        design.buildCount++;
        const name = galaxy.selectRandomUniqueMilitaryShipName();
        const builtObject = new BuiltObjectClass(design, name, galaxy, true);
        builtObject.empire = pirateEmpire;
        builtObject.heading = galaxy.selectRandomHeading();
        builtObject.targetHeading = builtObject.heading;
        builtObject.reDefine();
        builtObject.currentFuel = builtObject.fuelCapacity;
        builtObject.currentShields = builtObject.shieldsCapacity;
        pirateEmpire.addBuiltObjectToGalaxy(builtObject, habitat, true, true);
        return builtObject;
    }
    return null;
}

/**
 * Empire.6.cs 4386 GenerateNewCharacterFromCustom(character, location): activates a character of the dominant race's
 * AvailableCharacters (CharacterList.ActivateAndRemoveCharacter) and fires its CharacterStart event and CharacterAppears game
 * event. No Rnd of its own (DoCharacterEvent's).
 */
export function generateNewCharacterFromCustom(galaxy: Galaxy, empire: Empire, character: Character, location: EventStellarObject | null): boolean {
    const available = empire.dominantRace !== null ? raceAvailableCharacters(galaxy, empire.dominantRace) : null;
    if (empire.dominantRace !== null && available !== null) {
        // CharacterList.cs 17 ActivateAndRemoveCharacter(character, galaxy, empire, location).
        const idx = available.indexOf(character);
        if (idx >= 0) {
            character.activate(galaxy, empire, location as Habitat | BuiltObject | null);
            available.splice(available.indexOf(character), 1);
            if (character.role === CharacterRole.Leader || character.role === CharacterRole.Scientist || character.role === CharacterRole.PirateLeader) {
                character.bonusesKnown = true;
            }
            doCharacterEvent(galaxy, CharacterEventType.CharacterStart, character, character);
            const matchingGameEventIdCharacterAppears = getMatchingGameEventIdCharacterAppears(galaxy, character);
            checkTriggerEvent(galaxy, matchingGameEventIdCharacterAppears, empire, EventTriggerType.CharacterAppears, character);
            return true;
        }
    }
    return false;
}

function subRoleText(subRole: BuiltObjectSubRole): string {
    return resolveDescription(BuiltObjectSubRole as unknown as Record<number, string>, subRole);
}

// ---------------------------------------------------------------------------
// Galaxy.9.cs 1503 ExecuteEventAction
// ---------------------------------------------------------------------------

/**
 * Galaxy.9.cs 1503 ExecuteEventAction(eventAction, triggerEmpire, gameEvent): performs one action, builds its message, lets
 * BaconGalaxy.ExecuteEventAction (2837) handle the Bacon scripted actions, then sends the GeneralDiscovery message to the
 * action's empire (or the trigger empire). Rnd: see the file header.
 */
export function executeEventAction(galaxy: Galaxy, eventAction: EventAction, triggerEmpire: Empire | null, gameEvent: GameEvent | null): void {
    let empire: Empire | null = null;
    let flag = false;
    let title = '';
    let text = '';
    let additionalData: unknown = null;
    let location: unknown = null;
    let builtObject: BuiltObject | null = null;
    let habitat: Habitat | null = null;
    let creature: Creature | null = null;
    const target = eventAction.target;
    const facilityDefs = planetaryFacilityDefinitionsStatic(galaxy);
    const governments = getGovernmentsStatic();
    const researchNodeDefinitionsCount = galaxy.researchStatic?.definitions.length ?? 0;
    const resources = galaxy.resourceSystem.resources;
    switch (eventAction.type) {
        case EventActionType.AcquireBuiltObject: {
            if (target === null || !isBuiltObject(target)) break;
            builtObject = target;
            if (!builtObject.hasBeenDestroyed && builtObject.actualEmpire !== triggerEmpire && triggerEmpire !== null) {
                takeOwnershipOfBuiltObject(galaxy, triggerEmpire, builtObject, triggerEmpire, true, true);
                let text3 = '';
                if (builtObject.nearestSystemStar !== null) text3 = builtObject.nearestSystemStar.name;
                if (builtObject.role === BuiltObjectRole.Base) {
                    text = gameText('GameEventAction Description AcquireBuiltObject Base', builtObject.name, text3);
                    title = gameText('GameEventAction Title AcquireBuiltObject Base');
                } else {
                    text = gameText('GameEventAction Description AcquireBuiltObject Ship', subRoleText(builtObject.subRole).toLowerCase(), builtObject.name, text3);
                    title = gameText('GameEventAction Title AcquireBuiltObject Ship');
                }
                additionalData = builtObject;
                location = builtObject;
                flag = true;
            }
            break;
        }
        case EventActionType.AcquireHabitat:
            if (target !== null && isHabitat(target)) {
                habitat = target;
                if (!habitat.hasBeenDestroyed && habitat.empire !== triggerEmpire && habitat.population != null && habitat.population.totalAmount > 0 && triggerEmpire !== null) {
                    takeOwnershipOfColonyFull(galaxy, triggerEmpire, habitat, triggerEmpire, false, false);
                    const habitat23 = galaxy.determineHabitatSystemStar(habitat);
                    text = gameText('GameEventAction Description AcquireHabitat', resolveDescription(HabitatType as unknown as Record<number, string>, habitat.type).toLowerCase(), habitat.name, habitat23.name);
                    title = gameText('GameEventAction Title AcquireHabitat');
                    additionalData = habitat;
                    location = habitat;
                    flag = true;
                }
            }
            break;
        case EventActionType.BuildPlanetaryFacility:
            if (target !== null && isHabitat(target) && target.population != null && target.population.totalAmount > 0) {
                habitat = target;
                if (eventAction.value >= 0 && eventAction.value < facilityDefs.length) {
                    const habitat13 = galaxy.determineHabitatSystemStar(habitat);
                    const def = facilityDefs[eventAction.value];
                    if (planetaryFacilityDefType(def) === PlanetaryFacilityType.Wonder) {
                        queueWonderConstruction(galaxy, habitat, def, true);
                    } else {
                        queueFacilityConstruction(galaxy, habitat, planetaryFacilityDefType(def), true);
                    }
                    text = gameText('GameEventAction Description BuildPlanetaryFacility', def.name, habitat.name, habitat13.name);
                    title = gameText('GameEventAction Title BuildPlanetaryFacility', def.name);
                    additionalData = def;
                    location = habitat;
                    flag = true;
                }
            } else {
                if (triggerEmpire === null) break;
                if (triggerEmpire.capital !== null) {
                    habitat = triggerEmpire.capital;
                } else {
                    const ownedColonies = getOwnedColonies(triggerEmpire.colonies, triggerEmpire);
                    if (ownedColonies.length > 0) {
                        netSort(ownedColonies, habitatCompareTo);
                        habitat = ownedColonies[0];
                    }
                }
                if (habitat !== null && eventAction.value >= 0 && eventAction.value < facilityDefs.length) {
                    const habitat14 = galaxy.determineHabitatSystemStar(habitat);
                    const def2 = facilityDefs[eventAction.value];
                    queueFacilityConstruction(galaxy, habitat, planetaryFacilityDefType(def2), true);
                    text = gameText('GameEventAction Description BuildPlanetaryFacility', def2.name, habitat.name, habitat14.name);
                    title = gameText('GameEventAction Title BuildPlanetaryFacility', def2.name);
                    additionalData = def2;
                    location = habitat;
                    flag = true;
                }
            }
            break;
        case EventActionType.DestroyPlanetaryFacility:
            if (target !== null && isHabitat(target) && target.population != null && target.population.totalAmount > 0) {
                habitat = target;
                if (eventAction.value >= 0 && eventAction.value < facilityDefs.length) {
                    const byId = facilitiesGetById(habitat.facilities, facilityDefs[eventAction.value].facilityId);
                    if (byId !== null) {
                        const habitat24 = galaxy.determineHabitatSystemStar(habitat);
                        habitat.facilities!.splice(habitat.facilities!.indexOf(byId), 1);
                        checkRemoveFacilityTracking(habitat, byId);
                        reviewPlanetaryFacilities(galaxy, habitat, habitat.empire);
                        text = gameText('GameEventAction Description DestroyPlanetaryFacility', byId.name, habitat.name, habitat24.name);
                        title = gameText('GameEventAction Title DestroyPlanetaryFacility', byId.name);
                        additionalData = byId;
                        location = habitat;
                        flag = true;
                    }
                }
            } else {
                if (triggerEmpire === null || eventAction.value < 0 || eventAction.value >= facilityDefs.length) break;
                const ownedColonies2 = getOwnedColonies(triggerEmpire.colonies, triggerEmpire);
                if (ownedColonies2.length > 0) habitat = findColonyWithFacilityId(ownedColonies2, facilityDefs[eventAction.value].facilityId);
                if (habitat !== null) {
                    const byId2 = facilitiesGetById(habitat.facilities, facilityDefs[eventAction.value].facilityId);
                    if (byId2 !== null) {
                        const habitat25 = galaxy.determineHabitatSystemStar(habitat);
                        habitat.facilities!.splice(habitat.facilities!.indexOf(byId2), 1);
                        checkRemoveFacilityTracking(habitat, byId2);
                        reviewPlanetaryFacilities(galaxy, habitat, habitat.empire);
                        text = gameText('GameEventAction Description DestroyPlanetaryFacility', byId2.name, habitat.name, habitat25.name);
                        title = gameText('GameEventAction Title DestroyPlanetaryFacility', byId2.name);
                        additionalData = byId2;
                        location = habitat;
                        flag = true;
                    }
                }
            }
            break;
        case EventActionType.ChangeEmpireGovernment:
            if (eventAction.empire !== null && eventAction.value >= 0 && eventAction.value < governments.length) {
                const governmentAttributes2 = governments[eventAction.value]!;
                changeGovernment(galaxy, eventAction.empire, governmentAttributes2.governmentId);
                text = gameText('GameEventAction Description ChangeEmpireGovernment', eventAction.empire.name, governmentAttributes2.name);
                title = gameText('GameEventAction Title ChangeEmpireGovernment');
                additionalData = eventAction.empire;
                location = eventAction.empire.capital;
                flag = true;
            }
            break;
        case EventActionType.ChangeRaceBias: {
            if (eventAction.race === null || eventAction.raceOther === null || eventAction.race === eventAction.raceOther) break;
            let bias = raceBiasesGetBias(eventAction.race, eventAction.raceOther);
            bias += eventAction.value;
            raceBiasesSetBias(eventAction.race, eventAction.raceOther.name, bias);
            for (let n = 0; n < galaxy.empires.length; n++) {
                const empire7 = galaxy.empires[n];
                if (empire7 == null || !empire7.active || empire7.empireEvaluations == null || empire7.dominantRace === null || empire7.dominantRace !== eventAction.race) continue;
                const evaluations = empire7.empireEvaluations as (EmpireEvaluation | null)[];
                for (let num8 = 0; num8 < evaluations.length; num8++) {
                    const empireEvaluation2 = evaluations[num8];
                    if (empireEvaluation2 != null && empireEvaluation2.empire !== null && empireEvaluation2.empire.dominantRace !== null && empireEvaluation2.empire.dominantRace === eventAction.raceOther) {
                        empireEvaluation2.bias = empireEvaluation2.biasRaw + eventAction.value;
                    }
                }
            }
            text = gameText('GameEventAction Description ChangeRaceBias', eventAction.race.name, eventAction.raceOther.name, String(eventAction.value));
            title = gameText('GameEventAction Title ChangeRaceBias');
            additionalData = eventAction.race;
            location = null;
            flag = true;
            break;
        }
        case EventActionType.RevealObject:
            if (target === null || triggerEmpire === null) break;
            if (isBuiltObject(target)) {
                builtObject = target;
                // TODO(port) M9: `triggerEmpire == PlayerEmpire && LocationPinged != null` → LocationPinged(builtObject) (UI event).
                let text2 = '';
                if (builtObject.nearestSystemStar !== null) text2 = builtObject.nearestSystemStar.name;
                if (builtObject.role === BuiltObjectRole.Base) {
                    text = gameText('GameEventAction Description RevealObject Base', builtObject.name, text2);
                    title = gameText('GameEventAction Title RevealObject Base');
                } else {
                    text = gameText('GameEventAction Description RevealObject Ship', subRoleText(builtObject.subRole), builtObject.name, text2);
                    title = gameText('GameEventAction Title RevealObject Ship');
                }
                additionalData = builtObject;
                location = builtObject;
                flag = true;
            } else if (isHabitat(target)) {
                habitat = target;
                const habitat6 = galaxy.determineHabitatSystemStar(habitat);
                const systemVisibilityStatus = triggerEmpire.visibility.checkSystemVisibilityStatus(habitat6.systemIndex);
                if (systemVisibilityStatus === SystemVisibilityStatus.Unexplored || systemVisibilityStatus === SystemVisibilityStatus.Undefined) {
                    triggerEmpire.visibility.setSystemVisibility(habitat6, SystemVisibilityStatus.Explored);
                }
                // TODO(port) M9: LocationPinged(habitat) for the player (UI event).
                const cat = resolveDescription(HabitatCategoryType as unknown as Record<number, string>, habitat.category);
                text = gameText('GameEventAction Description RevealObject Planet', cat, habitat.name, habitat6.name);
                title = gameText('GameEventAction Title RevealObject Planet', cat);
                additionalData = habitat;
                location = habitat;
                flag = true;
            }
            break;
        case EventActionType.DestroyBuiltObject:
            if (target === null || !isBuiltObject(target)) break;
            builtObject = target;
            if (!builtObject.hasBeenDestroyed) {
                inflictDamageFull(galaxy, builtObject, builtObject, null, 1000000.0, galaxyNow(galaxy), 0, false, 0.0, false);
                let text4 = '';
                if (builtObject.nearestSystemStar !== null) text4 = builtObject.nearestSystemStar.name;
                if (builtObject.role === BuiltObjectRole.Base) {
                    text = gameText('GameEventAction Description DestroyBuiltObject Base', builtObject.name, text4);
                    title = gameText('GameEventAction Title DestroyBuiltObject Base');
                } else {
                    text = gameText('GameEventAction Description DestroyBuiltObject Ship', subRoleText(builtObject.subRole).toLowerCase(), builtObject.name, text4);
                    title = gameText('GameEventAction Title DestroyBuiltObject Ship');
                }
                additionalData = builtObject;
                location = builtObject;
                flag = true;
            }
            break;
        case EventActionType.DisasterAtColony:
            if (target !== null && isHabitat(target)) {
                habitat = target;
                if (!habitat.hasBeenDestroyed && habitat.population != null && habitat.population.totalAmount > 0 && habitat.empire !== null) {
                    const habitat2 = galaxy.determineHabitatSystemStar(habitat);
                    empireEventColonyNaturalDisaster(galaxy, habitat.empire, habitat);
                    text = gameText('GameEventAction Description DisasterAtColony', habitat.name, habitat2.name);
                    title = gameText('GameEventAction Title DisasterAtColony');
                    additionalData = habitat;
                    location = habitat;
                    flag = true;
                }
            }
            break;
        case EventActionType.EmpireDeclaresWarOnTriggerEmpire:
            if (eventAction.empire !== null && eventAction.empire.pirateEmpireBaseHabitat === null && triggerEmpire !== null && triggerEmpire.pirateEmpireBaseHabitat === null && eventAction.empire !== triggerEmpire) {
                declareWar(galaxy, eventAction.empire, triggerEmpire);
                text = gameText('GameEventAction Description EmpireDeclaresWarOnTriggerEmpire', eventAction.empire.name);
                title = gameText('GameEventAction Title EmpireDeclaresWarOnTriggerEmpire', eventAction.empire.name);
                additionalData = eventAction.empire;
                location = null;
                flag = true;
            }
            break;
        case EventActionType.PirateFactionJoinsTriggerEmpire:
            if (eventAction.empire !== null && triggerEmpire !== null && eventAction.empire !== triggerEmpire && eventAction.empire.pirateEmpireBaseHabitat !== null) {
                pirateFactionJoinsEmpire(galaxy, triggerEmpire, eventAction.empire);
                text = gameText('GameEventAction Description PirateFactionJoinsTriggerEmpire', eventAction.empire.name);
                title = gameText('GameEventAction Title PirateFactionJoinsTriggerEmpire', eventAction.empire.name);
                additionalData = eventAction.empire;
                location = null;
                flag = true;
            }
            break;
        case EventActionType.StartPlague:
            if (target !== null && isHabitat(target)) {
                habitat = target;
                if (habitat.population != null && habitat.population.totalAmount > 0 && habitat.owner !== null) {
                    const habitat10 = galaxy.determineHabitatSystemStar(habitat);
                    empireEventPlague(galaxy, habitat.owner, habitat);
                    text = gameText('GameEventAction Description StartPlague', habitat.name, habitat10.name);
                    title = gameText('GameEventAction Title StartPlague', habitat.name);
                    additionalData = habitat;
                    location = habitat;
                    flag = true;
                }
            }
            break;
        case EventActionType.EndPlague:
            if (target !== null && isHabitat(target)) {
                habitat = target;
                if (habitat.population != null && habitat.population.totalAmount > 0 && habitat.owner !== null && habitat.plagueTimeRemaining > 0 && habitat.plagueId >= 0) {
                    const plague = galaxyPlagues(galaxy)[habitat.plagueId];
                    if (plague != null) {
                        const habitat15 = galaxy.determineHabitatSystemStar(habitat);
                        text = gameText('GameEventAction Description EndPlague', plague.name, habitat.name, habitat15.name);
                        habitat.plagueId = -1;
                        habitat.plagueTimeRemaining = 0;
                        title = gameText('GameEventAction Title EndPlague', habitat.name);
                        additionalData = habitat;
                        location = habitat;
                        flag = true;
                    }
                }
            } else {
                if (triggerEmpire === null || triggerEmpire.colonies == null) break;
                for (let j = 0; j < triggerEmpire.colonies.length; j++) {
                    const habitat16 = triggerEmpire.colonies[j];
                    if (habitat16 != null && !habitat16.hasBeenDestroyed && habitat16.plagueTimeRemaining > 0 && habitat16.plagueId >= 0) {
                        // C# reads `habitat` (still null here — the target was not a habitat): Plagues[habitat.PlagueId] throws
                        // NullReferenceException for the first plagued colony.
                        const habitatRead = habitat as Habitat | null;
                        if (habitatRead === null) throw new Error('NullReferenceException: Galaxy.9.cs 1869 Plagues[habitat.PlagueId] with habitat null (EndPlague without a target)');
                        const plague2 = galaxyPlagues(galaxy)[habitatRead.plagueId];
                        if (plague2 != null) {
                            const habitat17 = galaxy.determineHabitatSystemStar(habitatRead);
                            text = gameText('GameEventAction Description EndPlague', plague2.name, habitatRead.name, habitat17.name);
                            habitat16.plagueId = -1;
                            habitat16.plagueTimeRemaining = 0;
                            title = gameText('GameEventAction Title EndPlague', habitatRead.name);
                            additionalData = habitatRead;
                            location = habitatRead;
                            flag = true;
                        }
                    }
                }
            }
            break;
        case EventActionType.EnemyFleetDefectsToTriggerEmpire: {
            if (triggerEmpire === null) break;
            if (triggerEmpire.pirateEmpireBaseHabitat === null) {
                const lowest = getLowestEvaluationKnownEmpire(triggerEmpire, []);
                if (lowest !== null && lowest.empire !== triggerEmpire) {
                    const shipGroup2 = empireEventRogueFleetDefectsTo(galaxy, lowest.empire, triggerEmpire);
                    if (shipGroup2 !== null) {
                        text = gameText('GameEventAction Description EnemyFleetDefectsToTriggerEmpire', shipGroup2.name, lowest.empire.name);
                        title = gameText('GameEventAction Title EnemyFleetDefectsToTriggerEmpire');
                        additionalData = shipGroup2;
                        location = null;
                        flag = true;
                    }
                }
                break;
            }
            const relationWithLowestEvaluation = triggerEmpire.pirateRelations.getRelationWithLowestEvaluation();
            if (relationWithLowestEvaluation !== null && relationWithLowestEvaluation.otherEmpire !== triggerEmpire) {
                const other = relationWithLowestEvaluation.otherEmpire!;
                const shipGroup3 = empireEventRogueFleetDefectsTo(galaxy, other, triggerEmpire);
                if (shipGroup3 !== null) {
                    text = gameText('GameEventAction Description EnemyFleetDefectsToTriggerEmpire', shipGroup3.name, other.name);
                    title = gameText('GameEventAction Title EnemyFleetDefectsToTriggerEmpire');
                    additionalData = shipGroup3;
                    location = null;
                    flag = true;
                }
            }
            break;
        }
        case EventActionType.FindMoneyTreasure:
            if (eventAction.moneyAmount > 0.0 && triggerEmpire !== null) {
                triggerEmpire.stateMoney += eventAction.moneyAmount;
                triggerEmpire.pirateEconomy.performIncome(eventAction.moneyAmount, PirateIncomeType.Undefined, galaxyStarDate(galaxy));
                text = gameText('GameEventAction Description FindMoneyTreasure', eventAction.moneyAmount.toFixed(0));
                title = gameText('GameEventAction Title FindMoneyTreasure');
                additionalData = null;
                location = null;
                flag = true;
            }
            break;
        case EventActionType.GenerateBuiltObject: {
            if (target === null || !isHabitat(target)) break;
            habitat = target;
            if (eventAction.builtObjectSubRole === BuiltObjectSubRole.Undefined) break;
            let empire3 = triggerEmpire;
            if (empire3 === null && galaxy.empires.length > 0) empire3 = galaxy.empires[0];
            if (empire3 !== null) {
                const design = generateDesignFromSpec(galaxy, empire3, designSpecificationsGetBySubRole(empire3, eventAction.builtObjectSubRole), eventAction.techLevel, galaxyStarDate(galaxy));
                if (design !== null) {
                    // TODO(port) M9: design.PictureRef = ShipImageHelper.ResolveMinorShipImageIndex(SubRole, largeShips: true)
                    // (ShipImageHelper._Rnd, not Galaxy.Rnd) — the picture stays the generated one.
                    const habitat7 = galaxy.determineHabitatSystemStar(habitat);
                    builtObject = generateAbandonedBuiltObject(galaxy, habitat, design, false, false, BuiltObjectEncounterAction.Notify);
                    text = gameText('GameEventAction Description GenerateBuiltObject', subRoleText(builtObject.subRole).toLowerCase(), builtObject.name, habitat.name, habitat7.name);
                    title = gameText('GameEventAction Title GenerateBuiltObject', subRoleText(builtObject.subRole));
                    additionalData = builtObject;
                    location = habitat;
                    flag = true;
                }
            }
            break;
        }
        case EventActionType.GenerateCreatureSwarm:
            if (target !== null && isHabitat(target) && eventAction.creatureType !== CreatureType.Undefined && eventAction.value > 0) {
                habitat = target;
                const num7 = Math.min(50, eventAction.value);
                for (let m = 0; m < num7; m++) {
                    const habitat21 = galaxy.determineHabitatSystemStar(habitat);
                    creature = galaxy.generateCreatureAtHabitat(eventAction.creatureType, habitat, false);
                    const ct = resolveDescription(CreatureType as unknown as Record<number, string>, eventAction.creatureType);
                    text = gameText('GameEventAction Description GenerateCreatureSwarm', ct, habitat.name, habitat21.name);
                    title = gameText('GameEventAction Title GenerateCreatureSwarm', ct);
                    additionalData = creature;
                    location = habitat;
                    flag = true;
                }
            }
            break;
        case EventActionType.GenerateNewEmpire: {
            if (eventAction.race === null || target === null || !isHabitat(target)) break;
            habitat = target;
            if (habitat === null || habitat.hasBeenDestroyed || (habitat.empire !== null && habitat.empire !== galaxy.independentEmpire)) break;
            let governmentId: number | null = null;
            const list = EmpireClass.resolveDefaultAllowableGovernmentTypes(eventAction.race);
            const governmentAttributesList2 = determineMostSuitableGovernmentTypes(eventAction.race, list);
            if (governmentAttributesList2 != null && governmentAttributesList2.length > 0) {
                const index = galaxy.rnd.next(0, governmentAttributesList2.length);
                governmentId = governmentAttributesList2[index].governmentId;
                if (eventAction.race.preferredStartingGovernment >= 0 && list.includes(eventAction.race.preferredStartingGovernment)) {
                    governmentId = governments[eventAction.race.preferredStartingGovernment]!.governmentId;
                }
            }
            // C# governmentAttributes3.GovernmentId with no suitable government: NullReferenceException.
            if (governmentId === null) throw new Error('NullReferenceException: Galaxy.9.cs 1988 governmentAttributes3 is null (GenerateNewEmpire)');
            const empire6 = generateEmpire(galaxy, false, '', habitat, eventAction.race, eventAction.race.designsPictureFamilyIndex, governmentId, 1.0, 'Normal', 1, 0.5, 1.0).empire;
            if (empire6 !== null) {
                const habitat26 = galaxy.determineHabitatSystemStar(habitat);
                text = gameText('GameEventAction Description GenerateNewEmpire', eventAction.race.name, empire6.name, habitat.name, habitat26.name);
                title = gameText('GameEventAction Title GenerateNewEmpire');
                additionalData = empire6;
                location = habitat;
                flag = true;
            }
            break;
        }
        case EventActionType.GenerateNewPirateFaction: {
            if (eventAction.race === null || target === null || !isHabitat(target)) break;
            habitat = target;
            if (habitat !== null && !habitat.hasBeenDestroyed && (habitat.empire === null || habitat.empire === galaxy.independentEmpire) && galaxy.nextEmpireId < galaxy.maximumEmpireCount) {
                const p = galaxy.selectRelativeHabitatSurfacePoint(habitat);
                const piratePlaystyle = selectRandomPiratePlaystyle(galaxy);
                const ctx = { independentColonies: galaxy.independentColonies, startingAge: galaxy.startingAge, difficultyLevel: galaxy.difficultyLevel };
                const empire4 = generatePirateEmpire(galaxy, ctx, habitat, Math.trunc(p.x), Math.trunc(p.y), eventAction.race, raceDesignPictureFamilyIndexPirates(eventAction.race), 0.5, piratePlaystyle, false, false);
                if (empire4 !== null) {
                    const habitat12 = galaxy.determineHabitatSystemStar(habitat);
                    text = gameText('GameEventAction Description GenerateNewPirateFaction', eventAction.race.name, empire4.name, habitat.name, habitat12.name);
                    title = gameText('GameEventAction Title GenerateNewPirateFaction');
                    additionalData = empire4;
                    location = habitat;
                    flag = true;
                }
            }
            break;
        }
        case EventActionType.GeneratePirateAmbush: {
            if (target === null || !isHabitat(target)) break;
            habitat = target;
            const empire2 = findNearestPirateFaction(galaxy, habitat.xpos, habitat.ypos, triggerEmpire, false);
            if (empire2 !== null) {
                const num = Math.min(50, eventAction.value);
                let habitat3: Habitat | null = habitat;
                let num2 = habitat.xpos;
                let num3 = habitat.ypos;
                let num4 = 0;
                const habitat4 = galaxy.determineHabitatSystemStar(habitat);
                while (habitat3 === habitat4 && num4 < 20) {
                    num2 += galaxy.rnd.nextDouble() * 200000.0 - 100000.0;
                    num3 += galaxy.rnd.nextDouble() * 200000.0 - 100000.0;
                    habitat3 = galaxy.findNearestSystemGasCloudAsteroid(num2, num3);
                    num4++;
                }
                for (let i = 0; i < num; i++) {
                    const builtObject2 = generatePirateShip(galaxy, empire2, BuiltObjectSubRole.Frigate, habitat3!);
                    if (builtObject2 === null) throw new Error('NullReferenceException: Galaxy.9.cs 2069 GeneratePirateShip returned null (no Frigate design)');
                    assignMission(galaxy, builtObject2, BuiltObjectMissionType.Move, habitat, null, BuiltObjectMissionPriority.High, { manuallyAssigned: false });
                    text = gameText('GameEventAction Description GeneratePirateAmbush', empire2.name, habitat3!.name);
                    title = gameText('GameEventAction Title GeneratePirateAmbush');
                    additionalData = empire2;
                    location = habitat3;
                    flag = true;
                }
            }
            break;
        }
        case EventActionType.GenerateRefugeeFleet:
            if (target !== null && isHabitat(target)) {
                habitat = target;
                let race: Race | null = null;
                race = eventAction.race === null ? selectRandomRace(galaxy, 75) : eventAction.race;
                let empire5 = triggerEmpire;
                if (empire5 === null && galaxy.empires.length > 0) empire5 = galaxy.empires[0];
                if (empire5 !== null) {
                    const starDate = galaxyStarDate(galaxy);
                    const design2 = generateDesignFromSpec(galaxy, empire5, obtainDesignSpec(empire5, BuiltObjectSubRole.ColonyShip), 3.0, starDate);
                    const design3 = generateDesignFromSpec(galaxy, empire5, obtainDesignSpec(empire5, BuiltObjectSubRole.Frigate), 3.0, starDate);
                    const design4 = generateDesignFromSpec(galaxy, empire5, obtainDesignSpec(empire5, BuiltObjectSubRole.Cruiser), 3.0, starDate);
                    if (design2 === null || design3 === null || design4 === null) throw new Error('NullReferenceException: Galaxy.9.cs 2094 GenerateDesignFromSpec returned null (GenerateRefugeeFleet)');
                    // TODO(port) M9: design{2,3,4}.PictureRef = ShipImageHelper.ResolveNewShipImageIndex(subRole, race, isPirates: false)
                    // (ShipImageHelper._Rnd, not Galaxy.Rnd).
                    const builtObject5 = generateAbandonedBuiltObject(galaxy, habitat, design2, false, false, BuiltObjectEncounterAction.Notify);
                    builtObject5.name = gameText('Refugee SHIPTYPE', subRoleText(BuiltObjectSubRole.ColonyShip));
                    builtObject5.nativeRace = race;
                    const builtObject6 = generateAbandonedBuiltObject(galaxy, habitat, design3, false, false, BuiltObjectEncounterAction.Notify);
                    builtObject6.name = gameText('Refugee SHIPTYPE', subRoleText(BuiltObjectSubRole.Frigate));
                    const builtObject7 = generateAbandonedBuiltObject(galaxy, habitat, design4, false, false, BuiltObjectEncounterAction.Notify);
                    builtObject7.name = gameText('Refugee SHIPTYPE', subRoleText(BuiltObjectSubRole.Cruiser));
                    const habitat22 = galaxy.determineHabitatSystemStar(habitat);
                    if (race === null) throw new Error('NullReferenceException: Galaxy.9.cs 2107 race.Name (no race of intelligence >= 75)');
                    text = gameText('GameEventAction Description GenerateRefugeeFleet', race.name, habitat22.name);
                    title = gameText('GameEventAction Title GenerateRefugeeFleet');
                    additionalData = race;
                    location = habitat;
                    flag = true;
                }
            }
            break;
        case EventActionType.GenerateResourceAtHabitat:
            if (target !== null && isHabitat(target) && eventAction.value >= 0 && eventAction.value < resources.length) {
                habitat = target;
                if (!habitat.hasBeenDestroyed) {
                    const resourceId = resources[eventAction.value].resourceId;
                    empireEventColonyResourceAppearance(galaxy, habitat, resourceId, triggerEmpire);
                    const habitat11 = galaxy.determineHabitatSystemStar(habitat);
                    const resName = resources[eventAction.value].name;
                    text = gameText('GameEventAction Description GenerateResourceAtHabitat', resName, habitat.name, habitat11.name);
                    title = gameText('GameEventAction Title GenerateResourceAtHabitat', resName);
                    additionalData = resourceId;
                    location = habitat;
                    flag = true;
                }
            }
            break;
        case EventActionType.RemoveResourceAtHabitat:
            if (target !== null && isHabitat(target) && eventAction.value >= 0 && eventAction.value < resources.length) {
                habitat = target;
                if (!habitat.hasBeenDestroyed) {
                    const resourceId = resources[eventAction.value].resourceId;
                    empireEventColonyResourceDepletion(galaxy, habitat, resourceId, triggerEmpire);
                    const habitat5 = galaxy.determineHabitatSystemStar(habitat);
                    const resName = resources[eventAction.value].name;
                    text = gameText('GameEventAction Description RemoveResourceAtHabitat', resName, habitat.name, habitat5.name);
                    title = gameText('GameEventAction Title RemoveResourceAtHabitat', resName);
                    additionalData = resourceId;
                    location = habitat;
                    flag = true;
                }
            }
            break;
        case EventActionType.InterceptResource:
            if (triggerEmpire !== null && eventAction.value >= 0 && eventAction.value < resources.length) {
                const resourceId = resources[eventAction.value].resourceId;
                let x2 = 0.0;
                let y2 = 0.0;
                if (triggerEmpire.capital !== null) {
                    x2 = triggerEmpire.capital.xpos;
                    y2 = triggerEmpire.capital.ypos;
                } else if (triggerEmpire.pirateEmpireBaseHabitat !== null) {
                    x2 = triggerEmpire.pirateEmpireBaseHabitat.xpos;
                    y2 = triggerEmpire.pirateEmpireBaseHabitat.ypos;
                }
                if (gameEvent !== null && gameEvent.triggerObject !== null) {
                    x2 = gameEvent.triggerObject.xpos;
                    y2 = gameEvent.triggerObject.ypos;
                }
                const builtObject4 = fastFindNearestSpacePort(galaxy, x2, y2, triggerEmpire);
                randomEventRareResourceInterceptedAt(galaxy, triggerEmpire, resourceId, builtObject4, null);
                if (builtObject4 === null) throw new Error('NullReferenceException: Galaxy.9.cs 2176 builtObject4.NearestSystemStar (no space port)');
                let arg2 = '';
                if (builtObject4.nearestSystemStar !== null) arg2 = builtObject4.nearestSystemStar.name;
                const resName = resources[eventAction.value].name;
                text = gameText('GameEventAction Description InterceptResource', resName, arg2, builtObject4.name);
                title = gameText('GameEventAction Title InterceptResource', resName);
                additionalData = resourceId;
                location = builtObject4;
                flag = true;
            }
            break;
        case EventActionType.LearnAboutLostColony:
            if (target === null || !isHabitat(target) || eventAction.race === null || eventAction.value <= 0 || triggerEmpire === null) break;
            habitat = target;
            if (habitat.owner === null) {
                switch (habitat.type) {
                    case HabitatType.Volcanic:
                    case HabitatType.Desert:
                    case HabitatType.MarshySwamp:
                    case HabitatType.Continental:
                    case HabitatType.Ocean:
                    case HabitatType.Ice: {
                        const habitat9 = galaxy.determineHabitatSystemStar(habitat);
                        const newPopulationAmount = Math.min(20000000000, eventAction.value * 1000000);
                        // Empire.1.cs 16 MakeHabitatIntoColony(habitat, empire: null, race, amount): the C# passes a null empire,
                        // so TakeOwnershipOfColony(habitat, null) runs and the colony stays unowned.
                        makeHabitatIntoColonyRuntime(galaxy, triggerEmpire, habitat, null as unknown as Empire, eventAction.race, newPopulationAmount);
                        text = gameText('GameEventAction Description LearnAboutLostColony', eventAction.race.name, habitat.name, habitat9.name);
                        title = gameText('GameEventAction Title LearnAboutLostColony');
                        additionalData = eventAction.race;
                        location = habitat;
                        flag = true;
                        break;
                    }
                }
            }
            break;
        case EventActionType.LearnAboutSpecialLocation:
            if (eventAction.location !== null && triggerEmpire !== null && !triggerEmpire.visibility.knownGalaxyLocations.includes(eventAction.location)) {
                const loc = eventAction.location;
                const arg = resolveSectorDescription(galaxy, loc.xpos, loc.ypos);
                triggerEmpire.visibility.knownGalaxyLocations.push(loc);
                if (triggerEmpire === galaxy.playerEmpire) {
                    addLocationHint(triggerEmpire, { x: Math.trunc(loc.xpos) + Math.trunc(Math.trunc(loc.width) / 2), y: Math.trunc(loc.ypos) + Math.trunc(Math.trunc(loc.height) / 2) });
                }
                text = gameText('GameEventAction Description LearnAboutSpecialLocation', loc.name, arg);
                title = gameText('GameEventAction Title LearnAboutSpecialLocation');
                additionalData = loc;
                location = loc;
                flag = true;
            }
            break;
        case EventActionType.LearnExplorationInfo: {
            if (eventAction.value <= 0 || triggerEmpire === null || gameEvent === null || (gameEvent.triggerObject === null && gameEvent.triggerRuin === null)) break;
            let x3 = 0.0;
            let y3 = 0.0;
            if (gameEvent.triggerObject !== null) {
                x3 = gameEvent.triggerObject.xpos;
                y3 = gameEvent.triggerObject.ypos;
            } else if (gameEvent.triggerRuin !== null) {
                habitat = findHabitatWithRuin(galaxy.ruinsHabitats, gameEvent.triggerRuin);
                if (habitat !== null) {
                    x3 = habitat.xpos;
                    y3 = habitat.xpos; // sic: the C# reads Xpos for both (Galaxy.9.cs 2241)
                }
            }
            const habitat18 = galaxy.findNearestSystemGasCloudAsteroid(x3, y3);
            const num6 = Math.min(50, eventAction.value);
            for (let k = 0; k < num6; k++) {
                const habitat19 = fastFindNearestUnexploredHabitat(galaxy, x3, y3, triggerEmpire);
                if (habitat19 === null) break;
                triggerEmpire.visibility.systemVisibility[habitat19.systemIndex].totallyExplored = true;
                if (triggerEmpire.resourceMap != null) {
                    const sys = galaxy.systems[habitat19.systemIndex];
                    // Galaxy.9.cs 2269 Systems[].Habitats (no star; the star is set on its own below).
                    const sysHabitats = planetsOf(sys);
                    for (let l = 0; l < sysHabitats.length; l++) {
                        triggerEmpire.resourceMap.setResourcesKnown(sysHabitats[l], true);
                    }
                    if (sys.systemStar != null) triggerEmpire.resourceMap.setResourcesKnown(sys.systemStar, true);
                }
                const status = triggerEmpire.visibility.systemVisibility[habitat19.systemIndex].status;
                if (status === SystemVisibilityStatus.Unexplored || status === SystemVisibilityStatus.Undefined) {
                    triggerEmpire.visibility.systemVisibility[habitat19.systemIndex].status = SystemVisibilityStatus.Explored;
                }
            }
            if (habitat18 === null) throw new Error('NullReferenceException: Galaxy.9.cs 2275 habitat18.Name (no system near the trigger)');
            text = gameText('GameEventAction Description LearnExplorationInfo', String(num6), habitat18.name);
            title = gameText('GameEventAction Title LearnExplorationInfo');
            additionalData = null;
            location = habitat18;
            flag = true;
            break;
        }
        case EventActionType.LearnGovernmentType: {
            if (triggerEmpire === null || triggerEmpire.pirateEmpireBaseHabitat !== null || eventAction.value < 0 || eventAction.value >= governments.length) break;
            const governmentAttributes = governments[eventAction.value];
            if (governmentAttributes == null) break;
            if (!triggerEmpire.allowableGovernmentTypes.includes(governmentAttributes.governmentId)) {
                triggerEmpire.allowableGovernmentTypes.push(governmentAttributes.governmentId);
            }
            if (triggerEmpire !== galaxy.playerEmpire) {
                const governmentAttributesList = determineMostSuitableGovernmentTypes(triggerEmpire.dominantRace!, triggerEmpire.allowableGovernmentTypes);
                const governmentId = governmentAttributesList[0].governmentId;
                if (governmentId === governmentAttributes.governmentId) {
                    haveRevolution(galaxy, triggerEmpire, triggerEmpire.dominantRace, governmentId, 1.0);
                }
            }
            text = gameText('GameEventAction Description LearnGovernmentType', governmentAttributes.name);
            title = gameText('GameEventAction Title LearnGovernmentType');
            additionalData = governmentAttributes;
            location = null;
            flag = true;
            break;
        }
        case EventActionType.LearnTech:
            if (triggerEmpire !== null && eventAction.value >= 0 && eventAction.value < researchNodeDefinitionsCount) {
                const researchNode = findNodeById(triggerEmpire.research.techTree, eventAction.value);
                if (researchNode !== null && !researchNode.isResearched) {
                    doResearchBreakthrough(galaxy, triggerEmpire, researchNode, true, true, true);
                    triggerEmpire.research.update(triggerEmpire.dominantRace);
                    reviewDesignsBuiltObjectsImprovedComponents(triggerEmpire);
                    triggerEmpire.reviewResearchAbilities();
                    text = gameText('GameEventAction Description LearnTech', researchNode.def.name);
                    title = gameText('GameEventAction Title LearnTech');
                    additionalData = researchNode;
                    location = null;
                    flag = true;
                }
            }
            break;
        case EventActionType.UnlockTech:
            if (triggerEmpire !== null && eventAction.value >= 0 && eventAction.value < researchNodeDefinitionsCount) {
                const researchNode4 = findNodeById(triggerEmpire.research.techTree, eventAction.value);
                if (researchNode4 !== null && !researchNode4.isEnabled) {
                    researchNode4.isEnabled = true;
                    text = gameText('GameEventAction Description UnlockTech', researchNode4.def.name);
                    title = gameText('GameEventAction Title UnlockTech', researchNode4.def.name);
                    additionalData = researchNode4;
                    location = null;
                    flag = true;
                }
            }
            break;
        case EventActionType.MakeEmpireContact:
            if (eventAction.empire === null || triggerEmpire === null || eventAction.empire === triggerEmpire) break;
            if (eventAction.empire.pirateEmpireBaseHabitat === null && triggerEmpire.pirateEmpireBaseHabitat === null) {
                let diplomaticRelation7 = obtainDiplomaticRelation(triggerEmpire, eventAction.empire);
                if (diplomaticRelation7.type === DiplomaticRelationType.NotMet) {
                    diplomaticRelation7.type = DiplomaticRelationType.None;
                    diplomaticRelation7 = obtainDiplomaticRelation(eventAction.empire, triggerEmpire);
                    diplomaticRelation7.type = DiplomaticRelationType.None;
                    text = gameText('GameEventAction Description MakeEmpireContact', eventAction.empire.name);
                    title = gameText('GameEventAction Title MakeEmpireContact', eventAction.empire.name);
                    additionalData = eventAction.empire;
                    location = null;
                    flag = true;
                }
            } else {
                const pirateRelation = obtainPirateRelation(triggerEmpire, eventAction.empire);
                if (pirateRelation.type === PirateRelationType.NotMet) {
                    changePirateRelation(triggerEmpire, eventAction.empire, PirateRelationType.None, galaxyStarDate(galaxy));
                    text = gameText('GameEventAction Description MakeEmpireContact', eventAction.empire.name);
                    title = gameText('GameEventAction Title MakeEmpireContact', eventAction.empire.name);
                    additionalData = eventAction.empire;
                    location = null;
                    flag = true;
                }
            }
            break;
        case EventActionType.SleepingRaceAwokenAtHabitat:
            if (target === null || !isHabitat(target) || eventAction.race === null || eventAction.value <= 0) break;
            habitat = target;
            if (habitat.owner === null) {
                const amount = Math.min(20000000000, eventAction.value * 1000000);
                const population = new Population(eventAction.race, amount);
                if (habitat.population == null) habitat.population = new PopulationList();
                habitat.population.add(population);
                const independent = galaxy.independentEmpire!;
                takeOwnershipOfColonyFull(galaxy, independent, habitat, independent, false, false);
                const habitat8 = galaxy.determineHabitatSystemStar(habitat);
                text = gameText('GameEventAction Description SleepingRaceAwokenAtHabitat', eventAction.race.name, habitat.name, habitat8.name);
                title = gameText('GameEventAction Title SleepingRaceAwokenAtHabitat', eventAction.race.name);
                additionalData = eventAction.race;
                location = habitat;
                flag = true;
            }
            break;
        case EventActionType.SplitEmpireCivilWar:
            if (eventAction.empire !== null) {
                const splinterPortion2 = 0.3 + galaxy.rnd.nextDouble() * 0.25;
                initiateEmpireSplit(galaxy, eventAction.empire, splinterPortion2, true);
                text = gameText('GameEventAction Description SplitEmpireCivilWar', eventAction.empire.name);
                title = gameText('GameEventAction Title SplitEmpireCivilWar', eventAction.empire.name);
                additionalData = eventAction.empire;
                location = null;
                flag = true;
            }
            break;
        case EventActionType.SplitEmpirePeacefully:
            if (eventAction.empire !== null) {
                const splinterPortion = 0.3 + galaxy.rnd.nextDouble() * 0.25;
                initiateEmpireSplit(galaxy, eventAction.empire, splinterPortion, false);
                text = gameText('GameEventAction Description SplitEmpirePeacefully', eventAction.empire.name);
                title = gameText('GameEventAction Title SplitEmpirePeacefully', eventAction.empire.name);
                additionalData = eventAction.empire;
                location = null;
                flag = true;
            }
            break;
        case EventActionType.UnlockTechForEmpire:
            if (eventAction.empire !== null && eventAction.value >= 0 && eventAction.value < researchNodeDefinitionsCount) {
                const researchNode2 = findNodeById(eventAction.empire.research.techTree, eventAction.value);
                if (researchNode2 !== null && !researchNode2.isEnabled) {
                    researchNode2.isEnabled = true;
                    text = gameText('GameEventAction Description UnlockTechForEmpire', researchNode2.def.name);
                    title = gameText('GameEventAction Title UnlockTechForEmpire', researchNode2.def.name);
                    additionalData = researchNode2;
                    location = null;
                    flag = true;
                    empire = eventAction.empire;
                }
            }
            break;
        case EventActionType.ChangeEmpireReputation:
            if (eventAction.empire !== null && eventAction.value !== 0) {
                eventAction.empire.civilityRating += eventAction.value;
                if (eventAction.value >= 0) {
                    text = gameText('GameEventAction Description ChangeEmpireReputation Better');
                    title = gameText('GameEventAction Title ChangeEmpireReputation Better');
                } else {
                    text = gameText('GameEventAction Description ChangeEmpireReputation Worse');
                    title = gameText('GameEventAction Title ChangeEmpireReputation Worse');
                }
                additionalData = null;
                location = null;
                flag = true;
                empire = eventAction.empire;
            }
            break;
        case EventActionType.ChangeEmpireEvaluation:
            if (eventAction.empire !== null && eventAction.empireOther !== null && eventAction.empire !== eventAction.empireOther && eventAction.value !== 0) {
                const empireEvaluation = obtainEmpireEvaluation(galaxy, eventAction.empire, eventAction.empireOther);
                if (empireEvaluation != null) {
                    empireEvaluation.incidentEvaluation = empireEvaluation.incidentEvaluationRaw + eventAction.value;
                    text =
                        eventAction.value < 0
                            ? gameText('GameEventAction Description ChangeEmpireEvaluation Worse', eventAction.empire.name)
                            : gameText('GameEventAction Description ChangeEmpireEvaluation Better', eventAction.empire.name);
                    title = gameText('GameEventAction Title ChangeEmpireEvaluation', eventAction.empire.name);
                    additionalData = null;
                    location = null;
                    flag = true;
                    empire = eventAction.empireOther;
                }
            }
            break;
        case EventActionType.InitiateTreaty: {
            if (
                eventAction.empire === null ||
                eventAction.empireOther === null ||
                eventAction.empire === eventAction.empireOther ||
                (eventAction.diplomaticRelationType !== DiplomaticRelationType.FreeTradeAgreement &&
                    eventAction.diplomaticRelationType !== DiplomaticRelationType.Protectorate &&
                    eventAction.diplomaticRelationType !== DiplomaticRelationType.MutualDefensePact)
            ) {
                break;
            }
            const diplomaticRelation2 = obtainDiplomaticRelation(eventAction.empire, eventAction.empireOther);
            if (diplomaticRelation2 == null) break;
            if (diplomaticRelation2.type !== eventAction.diplomaticRelationType) {
                changeDiplomaticRelation(galaxy, eventAction.empire, diplomaticRelation2, eventAction.diplomaticRelationType, false, eventAction.lockedAlliance, eventAction.allianceName ?? '');
                const rt = resolveDescription(DiplomaticRelationType as unknown as Record<number, string>, eventAction.diplomaticRelationType);
                text = gameText('GameEventAction Description InitiateTreaty', rt, eventAction.empire.name);
                title = gameText('GameEventAction Title InitiateTreaty', rt);
                additionalData = null;
                location = null;
                flag = true;
                empire = eventAction.empireOther;
                break;
            }
            if (eventAction.lockedAlliance && !diplomaticRelation2.locked) {
                diplomaticRelation2.locked = true;
                const diplomaticRelation3 = obtainDiplomaticRelation(eventAction.empireOther, eventAction.empire);
                if (diplomaticRelation3 != null) diplomaticRelation3.locked = true;
            }
            if (eventAction.allianceName !== null && eventAction.allianceName !== '' && diplomaticRelation2.allianceName !== eventAction.allianceName) {
                diplomaticRelation2.allianceName = eventAction.allianceName;
                const diplomaticRelation4 = obtainDiplomaticRelation(eventAction.empireOther, eventAction.empire);
                if (diplomaticRelation4 != null) diplomaticRelation4.allianceName = eventAction.allianceName;
            }
            break;
        }
        case EventActionType.BreakTreaty:
            if (eventAction.empire !== null && eventAction.empireOther !== null && eventAction.empire !== eventAction.empireOther) {
                const diplomaticRelation = obtainDiplomaticRelation(eventAction.empire, eventAction.empireOther);
                if (
                    diplomaticRelation != null &&
                    (diplomaticRelation.type === DiplomaticRelationType.FreeTradeAgreement || diplomaticRelation.type === DiplomaticRelationType.Protectorate || diplomaticRelation.type === DiplomaticRelationType.MutualDefensePact)
                ) {
                    const type = diplomaticRelation.type;
                    changeDiplomaticRelation(galaxy, eventAction.empire, diplomaticRelation, DiplomaticRelationType.None);
                    const rt = resolveDescription(DiplomaticRelationType as unknown as Record<number, string>, type);
                    text = gameText('GameEventAction Description BreakTreaty', rt, eventAction.empire.name);
                    title = gameText('GameEventAction Title BreakTreaty', rt);
                    additionalData = null;
                    location = null;
                    flag = true;
                    empire = eventAction.empireOther;
                }
            }
            break;
        case EventActionType.StartTradingSuperLuxuryResources:
            if (eventAction.empire !== null && eventAction.empireOther !== null && eventAction.empire !== eventAction.empireOther) {
                const diplomaticRelation9 = obtainDiplomaticRelation(eventAction.empire, eventAction.empireOther);
                if (diplomaticRelation9 != null && !diplomaticRelation9.supplyRestrictedResources) {
                    diplomaticRelation9.supplyRestrictedResources = true;
                    text = gameText('GameEventAction Description StartTradingSuperLuxuryResources', eventAction.empire.name);
                    title = gameText('GameEventAction Title StartTradingSuperLuxuryResources');
                    additionalData = null;
                    location = null;
                    flag = true;
                    empire = eventAction.empireOther;
                }
            }
            break;
        case EventActionType.StopTradingSuperLuxuryResources:
            if (eventAction.empire !== null && eventAction.empireOther !== null && eventAction.empire !== eventAction.empireOther) {
                const diplomaticRelation8 = obtainDiplomaticRelation(eventAction.empire, eventAction.empireOther);
                if (diplomaticRelation8 != null && diplomaticRelation8.supplyRestrictedResources) {
                    diplomaticRelation8.supplyRestrictedResources = false;
                    text = gameText('GameEventAction Description StopTradingSuperLuxuryResources', eventAction.empire.name);
                    title = gameText('GameEventAction Title StopTradingSuperLuxuryResources');
                    additionalData = null;
                    location = null;
                    flag = true;
                    empire = eventAction.empireOther;
                }
            }
            break;
        case EventActionType.GeneralMessageToEmpire:
            if (eventAction.empire !== null && !isNullOrWhiteSpace(eventAction.messageText)) {
                text = eventAction.messageText!;
                title = gameText('GameEventAction Title GeneralMessageToEmpire');
                additionalData = eventAction;
                location = null;
                flag = true;
                empire = eventAction.empire;
            }
            break;
        case EventActionType.EmpireMessageToEmpire:
            if (eventAction.empire !== null && eventAction.empireOther !== null && !isNullOrWhiteSpace(eventAction.messageText)) {
                text = eventAction.messageText!;
                title = gameText('GameEventAction Title EmpireMessageToEmpire', eventAction.empire.name);
                additionalData = eventAction;
                location = null;
                flag = true;
                empire = eventAction.empireOther;
            }
            break;
        case EventActionType.ResearchBonusInProject:
            if (eventAction.value >= 0 && eventAction.value < researchNodeDefinitionsCount) {
                // C# triggerEmpire.Research with a null trigger empire: NullReferenceException.
                if (triggerEmpire === null) throw new Error('NullReferenceException: Galaxy.9.cs 2604 triggerEmpire.Research (ResearchBonusInProject)');
                const researchNode3 = findNodeById(triggerEmpire.research.techTree, eventAction.value);
                if (researchNode3 !== null && !researchNode3.isResearched) {
                    const cost = researchNode3.cost;
                    const num5 = Math.fround(galaxy.rnd.nextDouble() * cost);
                    researchNode3.progress = Math.fround(researchNode3.progress + num5);
                    text = gameText('GameEventAction Description ResearchBonusInProject', researchNode3.def.name);
                    title = gameText('GameEventAction Title ResearchBonusInProject', researchNode3.def.name);
                    additionalData = null;
                    location = null;
                    flag = true;
                }
            }
            break;
        case EventActionType.VictoryConditionBonus:
            if (eventAction.empire !== null) {
                eventAction.empire.victoryBonus = Math.fround(eventAction.empire.victoryBonus + Math.fround(eventAction.value / 100));
                text = gameText('GameEventAction Description VictoryConditionBonus', (eventAction.value >= 0 ? '+' : '-') + String(Math.abs(eventAction.value)) + '%');
                title = gameText('GameEventAction Title VictoryConditionBonus');
                additionalData = eventAction.empire;
                location = null;
                flag = true;
                empire = eventAction.empire;
            }
            break;
        case EventActionType.EmpireDeclaresWarOnOtherEmpire:
            if (eventAction.empire === null || eventAction.empireOther === null || eventAction.empire === eventAction.empireOther) break;
            if (eventAction.diplomaticRelationType !== DiplomaticRelationType.War) {
                declareWar(galaxy, eventAction.empire, eventAction.empireOther, null, eventAction.lockedAlliance, false);
                text = gameText('GameEventAction Description EmpireDeclaresWarOnOtherEmpire', eventAction.empire.name);
                title = gameText('GameEventAction Title EmpireDeclaresWarOnOtherEmpire', eventAction.empire.name, eventAction.empireOther.name);
                additionalData = null;
                location = null;
                flag = true;
                empire = eventAction.empireOther;
            } else {
                if (!eventAction.lockedAlliance) break;
                const diplomaticRelation5 = obtainDiplomaticRelation(eventAction.empire, eventAction.empireOther);
                if (diplomaticRelation5 != null && !diplomaticRelation5.locked) {
                    diplomaticRelation5.locked = true;
                    const diplomaticRelation6 = obtainDiplomaticRelation(eventAction.empireOther, eventAction.empire);
                    if (diplomaticRelation6 != null) diplomaticRelation6.locked = true;
                }
            }
            break;
        case EventActionType.SendFleetAttack:
            if (target !== null && eventAction.empire !== null && eventAction.empireOther !== null && eventAction.empire !== eventAction.empireOther && stellarEmpire(target) === eventAction.empireOther) {
                let shipGroup = identifyNearestAvailableFleet(galaxy, eventAction.empire, target.xpos, target.ypos, true, true, 0.0, 0.0, false, true, 10);
                if (shipGroup === null) shipGroup = identifyNearestAvailableFleet(galaxy, eventAction.empire, target.xpos, target.ypos, true, true, 0.0, 0.0, false, true, 0);
                if (shipGroup !== null) {
                    shipGroupAssignMission(galaxy, shipGroup, BuiltObjectMissionType.Attack, target, null, BuiltObjectMissionPriority.High, false);
                    text = gameText('GameEventAction Description SendFleetAttack', target.name, eventAction.empire.name);
                    title = gameText('GameEventAction Title SendFleetAttack', target.name);
                    additionalData = target;
                    location = target;
                    flag = true;
                    empire = eventAction.empire;
                }
            }
            break;
        case EventActionType.SendPlanetDestroyerAttack:
            if (
                target !== null &&
                isHabitat(target) &&
                eventAction.empire !== null &&
                eventAction.empireOther !== null &&
                eventAction.empire !== eventAction.empireOther &&
                target.empire === eventAction.empireOther &&
                eventAction.empire.planetDestroyers != null &&
                eventAction.empire.planetDestroyers.length > 0
            ) {
                let builtObject8 = getFirstAvailableWithinRange(galaxy, eventAction.empire.planetDestroyers as BuiltObject[], BuiltObjectRole.Military, target.xpos, target.ypos, 0.0, true);
                if (builtObject8 === null) builtObject8 = getNearestBuiltObjectCompleteUndamaged(eventAction.empire.planetDestroyers as BuiltObject[], target.xpos, target.ypos, BuiltObjectRole.Military, null);
                if (builtObject8 !== null && builtObject8.isPlanetDestroyer) {
                    assignMission(galaxy, builtObject8, BuiltObjectMissionType.Attack, target, null, BuiltObjectMissionPriority.High, { manuallyAssigned: false });
                    text = gameText('GameEventAction Description SendPlanetDestroyerAttack', target.name, eventAction.empire.name);
                    title = gameText('GameEventAction Title SendPlanetDestroyerAttack', target.name);
                    additionalData = target;
                    location = target;
                    flag = true;
                    empire = eventAction.empire;
                }
            }
            break;
        case EventActionType.IntergalacticConvoyMilitary:
            if (eventAction.empire !== null && eventAction.value > 0 && eventAction.empire.active) {
                generateMilitaryConvoy(galaxy, eventAction.empire, eventAction.value, 1);
                text = '';
                flag = true;
            }
            break;
        case EventActionType.IntergalacticConvoyCivilian:
            if (eventAction.empire !== null && eventAction.value > 0 && eventAction.empire.active) {
                generateCivilianConvoy(galaxy, eventAction.empire, eventAction.value, 1, '');
                text = '';
                flag = true;
            }
            break;
        case EventActionType.CharacterGenerate:
            if (eventAction.empire === null || target === null || (stellarEmpire(target) !== eventAction.empire && stellarEmpire(target) !== galaxy.independentEmpire)) break;
            if (eventAction.character !== null && !eventAction.character.active) {
                if (generateNewCharacterFromCustom(galaxy, eventAction.empire, eventAction.character, target)) {
                    const role = resolveDescription(CharacterRole as unknown as Record<number, string>, eventAction.character.role);
                    text = gameText('GameEventAction Description CharacterGenerate', role, eventAction.character.name, target.name);
                    title = gameText('GameEventAction Title CharacterGenerate', role);
                    additionalData = eventAction.character;
                    location = target;
                    flag = true;
                    empire = eventAction.empire;
                }
            } else if (eventAction.characterRole !== CharacterRole.Undefined) {
                const character = generateNewCharacterRandom(galaxy, eventAction.empire, eventAction.characterRole, target as Habitat | BuiltObject, true);
                if (character !== null) {
                    const role = resolveDescription(CharacterRole as unknown as Record<number, string>, character.role);
                    text = gameText('GameEventAction Description CharacterGenerate', role, character.name, target.name);
                    title = gameText('GameEventAction Title CharacterGenerate', role);
                    additionalData = character;
                    location = target;
                    flag = true;
                    empire = eventAction.empire;
                }
            }
            break;
        case EventActionType.CharacterKill:
            if (eventAction.empire !== null && eventAction.character !== null && eventAction.character.active) {
                const role = resolveDescription(CharacterRole as unknown as Record<number, string>, eventAction.character.role);
                text = gameText('GameEventAction Description CharacterKill', role, eventAction.character.name);
                title = gameText('GameEventAction Title CharacterKill', role);
                additionalData = eventAction.character;
                location = eventAction.character.location;
                flag = true;
                empire = eventAction.empire;
                eventAction.character.kill(galaxy);
            }
            break;
        case EventActionType.CharacterChangeEmpire: {
            if (eventAction.empire === null || eventAction.character === null || !eventAction.character.active || eventAction.empireOther === null || eventAction.empire === eventAction.empireOther) break;
            const character = eventAction.character;
            character.completeEmpireChange(eventAction.empireOther);
            if (eventAction.empireOther.pirateEmpireBaseHabitat !== null) {
                let builtObject3 = identifyPirateSpaceport(galaxy, eventAction.empireOther);
                if (builtObject3 !== null) {
                    character.completeLocationTransfer(builtObject3, galaxy);
                } else {
                    builtObject3 = identifyPirateBase(eventAction.empireOther);
                    if (builtObject3 !== null) character.completeLocationTransfer(builtObject3, galaxy);
                }
            } else if (eventAction.empireOther.capital !== null) {
                character.completeLocationTransfer(eventAction.empireOther.capital, galaxy);
            }
            const role = resolveDescription(CharacterRole as unknown as Record<number, string>, character.role);
            text = gameText('GameEventAction Description CharacterChangeEmpire', role, character.name, eventAction.empire.name, eventAction.empireOther.name);
            title = gameText('GameEventAction Title CharacterChangeEmpire', role);
            additionalData = character;
            location = character.location;
            flag = true;
            empire = eventAction.empire;
            break;
        }
        case EventActionType.CharacterChangeRole:
            if (eventAction.empire !== null && eventAction.character !== null && eventAction.character.active && eventAction.characterRole !== CharacterRole.Undefined) {
                const character = eventAction.character;
                const roleOld = resolveDescription(CharacterRole as unknown as Record<number, string>, character.role);
                const roleNew = resolveDescription(CharacterRole as unknown as Record<number, string>, eventAction.characterRole);
                text = gameText('GameEventAction Description CharacterChangeRole', roleOld, character.name, roleNew);
                title = gameText('GameEventAction Title CharacterChangeRole', roleOld, roleNew);
                additionalData = character;
                location = character.location;
                flag = true;
                empire = eventAction.empire;
                character.removeAllSkillsAndTraits();
                character.role = eventAction.characterRole;
                applyRandomCharacterSkillsTraits(galaxy, character.empire!, character, false);
                // TODO(port) M9: OnCharacterImageChanged(new CharacterImageChangedEventArgs(character)) (UI event).
            }
            break;
        case EventActionType.CharacterChangeImage:
            if (eventAction.empire !== null && eventAction.character !== null && eventAction.character.active && eventAction.imageFilename !== null && eventAction.imageFilename !== '') {
                text = '';
                additionalData = eventAction.character;
                location = eventAction.character.location;
                flag = true;
                empire = eventAction.empire;
                eventAction.character.pictureFilename = eventAction.imageFilename;
                // TODO(port) M9: OnCharacterImageChanged (UI event).
            }
            break;
    }
    void builtObject;
    void creature;
    if (gameEvent !== null) {
        if (!isNullOrWhiteSpace(gameEvent.title)) title = gameEvent.title;
        if (!isNullOrWhiteSpace(gameEvent.description)) {
            text += '\n\n';
            text += gameEvent.description;
        }
    }
    if (!baconGalaxyExecuteEventAction(galaxy, eventAction, triggerEmpire, gameEvent, flag)) return;
    if (!isNullOrWhiteSpace(eventAction.messageTitle)) title = eventAction.messageTitle!;
    if (!isNullOrWhiteSpace(eventAction.messageText)) text = eventAction.messageText!;
    if (text !== '') {
        if (empire !== null) {
            sendEventMessageToEmpire(empire, EventMessageType.GeneralDiscovery, title, text, additionalData, location);
        } else if (triggerEmpire !== null) {
            sendEventMessageToEmpire(triggerEmpire, EventMessageType.GeneralDiscovery, title, text, additionalData, location);
        }
    }
}

/** HabitatList.FindHabitatWithRuin(ruin): first habitat whose Ruin is that ruin. */
function findHabitatWithRuin(list: readonly Habitat[], ruin: unknown): Habitat | null {
    for (let i = 0; i < list.length; i++) {
        const h = list[i];
        if (h != null && h.ruin === ruin) return h;
    }
    return null;
}

/** StellarObject.Empire for a Habitat / BuiltObject / Creature (a creature has none). */
function stellarEmpire(o: EventStellarObject): Empire | null {
    if (isCreature(o)) return null;
    return (o as Habitat | BuiltObject).empire;
}

function planetaryFacilityDefType(def: import('../data/facilities').Facility): PlanetaryFacilityType {
    return facilityType(def);
}

/** string.IsNullOrWhiteSpace. */
function isNullOrWhiteSpace(s: string | null | undefined): boolean {
    return s === null || s === undefined || s.trim() === '';
}

// ---------------------------------------------------------------------------
// BaconGalaxy.cs 308 ExecuteEventAction
// ---------------------------------------------------------------------------

/**
 * BaconGalaxy.cs 308 ExecuteEventAction(galaxy, eventAction, targetEmpire, gameEvent, flag): the Bacon mod's repeating
 * "delayed" actions, recognised by MessageTitle. Each handled one clears `flag` (no GeneralDiscovery message) and, for the
 * periodic ones, re-queues itself. `BaconBuiltObject.myMain != null` holds in a running game (the TS has no Main; it is
 * treated as set). "SaveStats", "ProcessEmpireScienceShips" and "ClearShipsAboutToBeDestroyed" are queued by baconSettings.ts
 * (BaconMain.cs 686-697 / 700-715 / 1075); nothing in the TS queues the others yet (BaconEmpire loans, BaconHabitat
 * scientific missions — both UI-driven). Returns the updated flag.
 */
export function baconGalaxyExecuteEventAction(galaxy: Galaxy, eventAction: EventAction, targetEmpire: Empire | null, gameEvent: GameEvent | null, flag: boolean): boolean {
    void targetEmpire;
    const day = Math.trunc((REAL_SECONDS_IN_GALACTIC_YEAR * 1000) / 360);
    const messageTitle = eventAction.messageTitle;
    if (messageTitle === 'SaveStats') {
        // TODO(port) M9: BaconMain.ProcessGameStats(myMain) (stats files — UI / IO; no Rnd; achievements.ts processGameStats).
        flag = false;
        // BaconGalaxy.cs 319: + RealSecondsInGalacticYear * 1000 / 360 * (int)BaconMain.statSaveIntervalInGameDays.
        eventAction.executionDate = galaxyStarDate(galaxy) + day * baconSettings.statSaveIntervalInGameDays;
        galaxy.delayedActions.push(new EventActionExecutionPackage(eventAction, gameEvent, galaxy.playerEmpire));
    } else if (messageTitle === 'ProcessEmpireScienceShips') {
        // BaconGalaxy.cs 322-329: BaconEmpire.ProcessScienceShips(myMain), then re-queue Next(26, 35) days later.
        executeProcessEmpireScienceShips(galaxy, eventAction, gameEvent);
        flag = false;
    } else if (messageTitle === 'missionExploreRuins') {
        throw new Error('TODO(port): BaconHabitat.ResolveScientificMissionExploreRuins (BaconGalaxy.cs 334)');
    } else if (messageTitle === 'missionProspectForResources') {
        throw new Error('TODO(port): BaconHabitat.ResolveScientificMissionProspectForResources (BaconGalaxy.cs 339)');
    } else if (messageTitle !== null && messageTitle.includes('loan')) {
        throw new Error('TODO(port): BaconEmpire.MakeLoanPayment (BaconGalaxy.cs 343)');
    } else if (messageTitle !== null && messageTitle.includes('ClearShipsAboutToBeDestroyed')) {
        baconClearShipsAboutToBeDestroyed(galaxy, eventAction, gameEvent);
        flag = false;
    }
    return flag;
}

/** BaconGalaxy.cs 355 ClearShipsAboutToBeDestroyed(eventAction, gameEvent): clears the static list and re-queues in 10 days. No Rnd. */
export function baconClearShipsAboutToBeDestroyed(galaxy: Galaxy, eventAction: EventAction, gameEvent: GameEvent | null): void {
    if (galaxy.baconShipsToBeDestroyed != null) galaxy.baconShipsToBeDestroyed.clear();
    eventAction.executionDate = galaxyStarDate(galaxy) + Math.trunc((REAL_SECONDS_IN_GALACTIC_YEAR * 1000) / 360) * 10;
    galaxy.delayedActions.push(new EventActionExecutionPackage(eventAction, gameEvent, galaxy.playerEmpire));
}

export { EventAction, GameEvent, EventActionType, EventActionExecutionType, EventTriggerType, MultipleEventActionType };
