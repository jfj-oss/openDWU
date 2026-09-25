// M4u — events, disasters, location effects, rebellion, plague, creatures, character runtime. Also the
// DEFERRED stubs (not M4, tasks/M4-plan.md §3.3 "Deferred"): story events, scripted game events,
// espionage, achievements / victory. They stay no-ops that count as TODO hits.
//
// Stubs created by M4a (tasks/M4-plan.md §3.1): the tick skeletons in src/sim/tick/ call these entry points in C#
// order. Each is a no-op that does NOT draw Galaxy.Rnd (a `RND:` note marks C# draw sites that are skipped until the
// owning package ports the body) and records a TODO hit (tick/todo.ts). The owning package replaces the bodies in
// place, keeping the signatures (or adjusting the skeleton call in the same change).

import type { Galaxy } from './galaxy';
import type { Empire } from './empire';
import type { BuiltObject } from './builtObject';
import type { Habitat } from './types';
import { registerTodo, todo } from './tick/todo';
import { GalaxyLocationEffectType, GalaxyLocationType, type GalaxyLocation } from './galaxyLocation';
import { getBuiltObjectsAtLocation } from './stationPlacement';
import { BuiltObjectRole } from './data/designSpecifications';
import { builtObjectInflictDamage } from './combat/damage';
import { determineAngle } from './creature';
import { doCharacterEventForList, type Character, type CharacterEventType } from './characters';
import * as characterRuntime from './characterRuntime';

/** EventMessageType.cs (enum, declaration order). */
export enum EventMessageType {
    Undefined, NewEmpireRaceAbility, ExoticTechDiscovered, SpecialGovernmentType, CreatureOutbreak, GalacticRefugees, SleepersAwake,
    NewEmpireEmerges, OriginsDiscovery, LostBuiltObjectCoordinates, LostColonyCoordinates, FreeSuperShip, PirateFactionJoinsYou,
    TreasureFound, LostColonyFound, AncientBattleDebrisField, IndependentPopulation, GeneralRuinsDiscovery, EncounterRuins,
    EncounterBuiltObject, BuiltObjectExplodes, PirateAmbush, CreatureSwarm, StoryClue, SpecialArea, RestrictedResourceDiscovered,
    RuinsEmpireBonus, RogueFleetDefectsToUs, RogueFleetDefectsFromUs, EmpireSplits, UncoverPirateAttackFundingAnotherEmpire,
    UncoverPirateAttackFundingYourEmpire, UncoverPlanetDestroyerConstruction, UncoverKnownLocation, RareResourceIntercepted,
    GeneralDiscovery, DisasterEvent, ResourceAppearance, ResourceDepletion, RaceEvent, WonderBuilt, CharacterEvent, PhantomPirates,
    LeaderChange,
}

/** DisasterEventType.cs (enum, declaration order). */
export enum DisasterEventType {
    Undefined, Earthquake, Sinkhole, Tsunami, Sandstorm, Blizzard, Eruption, Plague, EconomicCrisis,
}

/** RaceEventType.cs (byte enum, declaration order). */
export enum RaceEventType {
    Undefined, NepthysWineVintage, UnderwaterLeviathan, GreatHuntStrongTroops, SuppressedKnowledgeLoseResearch,
    ShakturiArtifactWeaponResearch, WarriorWaveTroopRecruitment, SwarmsFullTroopTransport, CannibalismPopulationShrinks,
    MetamorphosisCharacterChange, StrengthInNumbersMaintenanceLowerForSmallShips, AntiXenoRiotsExterminate, XenophobiaNoAssimilate,
    DestinyCharacterTraits, NaturalHarmonyColonyQualityIncreased, SecurityConcernsCharacterReplaced, NeverSurrenderWarWearinessReset,
    ScientificBreakthroughResearchProgress, ForcedRetirementLeaderReplaced, TodashGalacticChampionships,
    HistoricalKnowledgeUncoverHiddenLocation, IsolationistsResetFirstContactPenalty, GrandPerformanceDiplomacyBonus,
    FriendsInManyPlacesRevealTerritory, LuckyAvertColonyDisaster, SupremeWarriorNewGeneral, DeathCultExterminate,
    CreativeReengineeringFreeCrashResearch, PredictiveHistory, HistoricalDiscoveryExploreRuinsForResearchBoost,
}

/** Empire.7.cs 3400 SendEventMessageToEmpire(eventMessageType, title, message, additionalData, location): only the attached UI recipient sees it. */
export function sendEventMessageToEmpire(empire: Empire, eventMessageType: EventMessageType, title: string, message: string, additionalData: unknown, location: unknown): void {
    if (empire.eventMessageRecipient !== null) {
        empire.eventMessageRecipient.receiveEventMessage(eventMessageType, title, message, additionalData, location);
    }
}

const T_sendNewsBroadcast = registerTodo('deferred', 'SendNewsBroadcast (GalacticNewsNet messages, UI)');
/**
 * Empire.7.cs 2961-2990 SendNewsBroadcast(eventType, subject[, disasterType, warStartEnd, wonderBegun[, messageType], extraData])
 * → ThreadPool SendNewsBroadcastCore (3008): GalacticNewsNet messages to every empire; no Rnd. TODO(port) M9: news broadcasts.
 */
export function sendNewsBroadcast(empire: Empire, eventType: EventMessageType, subject: unknown, disasterType: DisasterEventType = DisasterEventType.Undefined, warStartEnd = false, wonderBegun = false, messageType = 0, extraData: unknown = null): void {
    void empire; void eventType; void subject; void disasterType; void warStartEnd; void wonderBegun; void messageType; void extraData;
    todo(T_sendNewsBroadcast);
}

/** Galaxy.5.cs 3372 FindAbandonedShipsInDebrisField(location). */
export function findAbandonedShipsInDebrisField(galaxy: Galaxy, location: GalaxyLocation | null): BuiltObject[] {
    const builtObjectList: BuiltObject[] = [];
    if (location !== null && location.type === GalaxyLocationType.DebrisField) {
        const num = location.width / 2.0;
        const num2 = location.height / 2.0;
        const range = Math.trunc(Math.max(location.width / 2.0, location.height / 2.0));
        const builtObjectsAtLocation = getBuiltObjectsAtLocation(galaxy, location.xpos + num, location.ypos + num2, range);
        const num3 = location.xpos - location.width / 2.0;
        const num4 = location.xpos + location.width / 2.0;
        const num5 = location.ypos - location.height / 2.0;
        const num6 = location.ypos + location.height / 2.0;
        for (let i = 0; i < builtObjectsAtLocation.length; i++) {
            const builtObject = builtObjectsAtLocation[i];
            if (builtObject != null && builtObject.empire === null && builtObject.xpos > num3 && builtObject.xpos < num4 && builtObject.ypos > num5 && builtObject.ypos < num6 && !builtObjectList.includes(builtObject)) {
                builtObjectList.push(builtObject);
            }
        }
    }
    return builtObjectList;
}

/** Galaxy.5.cs 2893-2920 / 2867-2890 tail: drop a location from every empire's KnownGalaxyLocations, the index and the list. */
function removeGalaxyLocation(galaxy: Galaxy, item: GalaxyLocation): void {
    for (let j = 0; j < galaxy.empires.length; j++) {
        const empire = galaxy.empires[j];
        const known = empire.visibility.knownGalaxyLocations;
        if (known.includes(item)) {
            known.splice(known.indexOf(item), 1);
        }
    }
    galaxy.removeGalaxyLocationIndex(item);
    const idx = galaxy.galaxyLocations.indexOf(item);
    if (idx >= 0) galaxy.galaxyLocations.splice(idx, 1);
}

/** Galaxy.5.cs 2893 ClearEmptyDebrisFields. */
export function clearEmptyDebrisFields(galaxy: Galaxy): void {
    const galaxyLocationList: GalaxyLocation[] = [];
    for (let i = 0; i < galaxy.galaxyLocations.length; i++) {
        const galaxyLocation = galaxy.galaxyLocations[i];
        if (galaxyLocation.type === GalaxyLocationType.DebrisField) {
            const builtObjectList = findAbandonedShipsInDebrisField(galaxy, galaxyLocation);
            if (builtObjectList.length === 0) {
                galaxyLocationList.push(galaxyLocation);
            }
        }
    }
    for (const item of galaxyLocationList) {
        removeGalaxyLocation(galaxy, item);
    }
}

/** Empire.6.cs 3941 ProcessCharacters(timePassed) → Character.cs 4277 DoTasks(galaxy) → ProcessTransfer. */
export function processCharacters(galaxy: Galaxy, empire: Empire, timePassed: number): void {
    void timePassed;
    const characters = empire.characters as Character[] | null;
    if (characters != null) {
        for (let i = 0; i < characters.length; i++) {
            const character = characters[i];
            character.doTasks(galaxy);
        }
    }
}

const T_checkReviewSpecialPirateEvents = registerTodo('M4u', 'checkReviewSpecialPirateEvents');
/** Empire.7.cs 3408 CheckReviewSpecialPirateEvents. */
export function checkReviewSpecialPirateEvents(galaxy: Galaxy, empire: Empire): void {
    // RND: draws in callees (d≤3) — not drawn until M4u.
    /* TODO(port) M4u */ todo(T_checkReviewSpecialPirateEvents);
}

/** Empire.6.cs 3990 CheckForCharacterAppearance (characterRuntime.ts). */
export function checkForCharacterAppearance(galaxy: Galaxy, empire: Empire): void {
    characterRuntime.checkForCharacterAppearance(galaxy, empire);
}
/** Empire.6.cs 4769 ReviewCharacterLeaderChange(timePassed) (characterRuntime.ts). */
export function reviewCharacterLeaderChange(galaxy: Galaxy, empire: Empire, timePassed: number): void {
    characterRuntime.reviewCharacterLeaderChange(galaxy, empire, timePassed);
}
/** Empire.6.cs 5084 ProcessLeaderChangeInfluence(timePassed) (characterRuntime.ts). */
export function processLeaderChangeInfluence(galaxy: Galaxy, empire: Empire, timePassed: number): void {
    characterRuntime.processLeaderChangeInfluence(galaxy, empire, timePassed);
}
/** Empire.6.cs 4716 ReviewCharacterBonusesKnown (characterRuntime.ts). */
export function reviewCharacterBonusesKnown(galaxy: Galaxy, empire: Empire): void {
    characterRuntime.reviewCharacterBonusesKnown(galaxy, empire);
}
/** Empire.7.cs 16 ReviewCharacterTraits (characterRuntime.ts). */
export function reviewCharacterTraits(galaxy: Galaxy, empire: Empire): void {
    characterRuntime.reviewCharacterTraits(galaxy, empire);
}
/** Empire.7.cs 319 ReviewDemoralizingCharacters (characterRuntime.ts). */
export function reviewDemoralizingCharacters(galaxy: Galaxy, empire: Empire): void {
    characterRuntime.reviewDemoralizingCharacters(galaxy, empire);
}
/** Empire.7.cs 348 ReviewCharacterLocations (characterRuntime.ts; per character = characters.ts reviewCharacterLocation). */
export function reviewCharacterLocations(galaxy: Galaxy, empire: Empire): void {
    characterRuntime.reviewCharacterLocations(galaxy, empire);
}
const T_resetRaceEvents = registerTodo('M4u', 'resetRaceEvents');
/** Empire.1.cs 2094 ResetRaceEvents. */
export function resetRaceEvents(galaxy: Galaxy, empire: Empire): void {
    /* TODO(port) M4u */ todo(T_resetRaceEvents);
}

const T_reviewRandomEvents = registerTodo('M4u', 'reviewRandomEvents');
/** Empire.1.cs 1758 ReviewRandomEvents. */
export function reviewRandomEvents(galaxy: Galaxy, empire: Empire): void {
    // RND: 5 direct — not drawn until M4u.
    /* TODO(port) M4u */ todo(T_reviewRandomEvents);
}

const T_reviewEmpireEvents = registerTodo('M4u', 'reviewEmpireEvents');
/** Empire.1.cs 2811 ReviewEmpireEvents. */
export function reviewEmpireEvents(galaxy: Galaxy, empire: Empire): void {
    // RND: 8 direct, +clock×1 — not drawn until M4u.
    /* TODO(port) M4u */ todo(T_reviewEmpireEvents);
}

const T_pirateReviewRandomEvents = registerTodo('M4u', 'pirateReviewRandomEvents');
/** Empire.1.cs 1731 PirateReviewRandomEvents. */
export function pirateReviewRandomEvents(galaxy: Galaxy, empire: Empire): void {
    // RND: 4 direct — not drawn until M4u.
    /* TODO(port) M4u */ todo(T_pirateReviewRandomEvents);
}

/** BuiltObject.cs 3448 DoLocationEffects(timePassed, time). */
export function doLocationEffects(galaxy: Galaxy, builtObject: BuiltObject, timePassed: number, time: number): void {
    if (builtObject.shipDamageAmountLocation > 0) {
        const hitPower = builtObject.shipDamageAmountLocation * timePassed;
        // TODO(port) M4o: InflictDamage (BuiltObject.2.cs 6221) — stub, no damage applied.
        builtObjectInflictDamage(galaxy, builtObject, builtObject, null, hitPower, time, 0, false, -Number.MAX_VALUE, false);
    }
    if (builtObject.shipPullAmountLocation > 0) {
        const num = builtObject.shipPullAmountLocation * timePassed;
        builtObject.xpos += Math.cos(builtObject.shipPullAngleLocation) * num;
        builtObject.ypos += Math.sin(builtObject.shipPullAngleLocation) * num;
        if (builtObject.parentHabitat !== null) {
            builtObject.parentOffsetX += Math.cos(builtObject.shipPullAngleLocation) * num;
            builtObject.parentOffsetY += Math.sin(builtObject.shipPullAngleLocation) * num;
        }
        if (builtObject.role !== BuiltObjectRole.Base && builtObject.topSpeed > 0) {
            // TargetHeading = _ShipPullAngleLocation + (float)Math.PI (float + float).
            builtObject.targetHeading = Math.fround(builtObject.shipPullAngleLocation + Math.fround(Math.PI));
            builtObject.targetSpeed = builtObject.topSpeed;
        }
    }
}

/** BuiltObject.cs 3934 ApplyLocationEffects(timePassed, time). */
export function applyLocationEffects(galaxy: Galaxy, builtObject: BuiltObject, timePassed: number, time: number): void {
    const f = Math.fround;
    const locations = galaxy.determineGalaxyLocationsAtPoint(builtObject.xpos, builtObject.ypos, GalaxyLocationType.Undefined);
    const flag = locations.length > 0;
    let flag2 = false;
    let flag3 = false;
    let flag4 = false;
    let flag5 = false;
    let hyperjumpDisabledLocation = false;
    let num = 0.0;
    let flag6 = false;
    let num2 = 0.0;
    let num3 = 0.0;
    builtObject.locationEffects.length = 0;
    if (flag) {
        for (let i = 0; i < locations.length; i++) {
            const galaxyLocation = locations[i];
            switch (galaxyLocation.effect) {
                case GalaxyLocationEffectType.LightningDamage:
                    builtObject.locationEffects.push(GalaxyLocationEffectType.LightningDamage);
                    flag2 = true;
                    break;
                case GalaxyLocationEffectType.MovementSlowed:
                    builtObject.locationEffects.push(GalaxyLocationEffectType.MovementSlowed);
                    flag3 = true;
                    break;
                case GalaxyLocationEffectType.ShieldReduction:
                    builtObject.locationEffects.push(GalaxyLocationEffectType.ShieldReduction);
                    flag4 = true;
                    break;
                case GalaxyLocationEffectType.HyperjumpDisabled:
                    builtObject.locationEffects.push(GalaxyLocationEffectType.HyperjumpDisabled);
                    hyperjumpDisabledLocation = true;
                    break;
                case GalaxyLocationEffectType.ShipDamage:
                    builtObject.locationEffects.push(GalaxyLocationEffectType.ShipDamage);
                    flag5 = true;
                    num = galaxyLocation.effectAmount;
                    break;
                case GalaxyLocationEffectType.ShipPull: {
                    builtObject.locationEffects.push(GalaxyLocationEffectType.ShipPull);
                    flag6 = true;
                    const x = galaxyLocation.xpos + galaxyLocation.width / 2.0;
                    const y = galaxyLocation.ypos + galaxyLocation.height / 2.0;
                    const num4 = galaxy.calculateDistance(builtObject.xpos, builtObject.ypos, x, y);
                    const num5 = galaxyLocation.width / 2.0 / num4;
                    num2 = galaxyLocation.effectAmount * num5;
                    const num6 = determineAngle(builtObject.xpos, builtObject.ypos, x, y);
                    num3 = num6;
                    break;
                }
            }
        }
    }
    if (flag2 && builtObject.currentSpeed <= builtObject.topSpeed) {
        const totalSeconds = (time - builtObject.lastLocationEffectTouch) / 1000;
        const num7 = galaxy.rnd.nextDouble() * totalSeconds;
        if (num7 > 7.0) {
            let num8 = 20.0 + galaxy.rnd.nextDouble() * 70.0;
            if (builtObject.currentShields <= num8) {
                builtObject.currentShields = 0;
                num8 = galaxy.rnd.nextDouble() * 5.0;
            }
            // TODO(port) M4o: InflictDamage (BuiltObject.2.cs 6221) — stub, no damage applied.
            builtObjectInflictDamage(galaxy, builtObject, builtObject, null, num8, time, 0, false, -Number.MAX_VALUE, true);
            builtObject.lastLocationEffectTouch = time;
        }
    }
    if (flag5) {
        builtObject.shipDamageAmountLocation = f(num);
    } else {
        builtObject.shipDamageAmountLocation = 0;
    }
    if (flag6) {
        builtObject.shipPullAmountLocation = f(num2);
        builtObject.shipPullAngleLocation = f(num3);
    } else {
        builtObject.shipPullAmountLocation = 0;
        builtObject.shipPullAngleLocation = 0;
    }
    builtObject.hyperjumpDisabledLocation = hyperjumpDisabledLocation;
    if (flag3 && !builtObject._fuelHandicapped && builtObject.currentSpeed < builtObject.warpSpeed) {
        builtObject.cruiseSpeed = Math.trunc(builtObject.cruiseSpeedBase * 0.75);
        builtObject.topSpeed = Math.trunc(builtObject.topSpeedBase * 0.75);
    } else if (!flag3 && builtObject.movementSlowedLocation) {
        builtObject.cruiseSpeed = builtObject.cruiseSpeedBase;
        builtObject.topSpeed = builtObject.topSpeedBase;
    }
    builtObject.movementSlowedLocation = flag3;
    if (flag4) {
        let val = (3.0 + galaxy.rnd.nextDouble() * 0.5) * timePassed;
        val = Math.min(builtObject.currentShields, val);
        builtObject.currentShields = f(builtObject.currentShields - f(val));
    }
    builtObject.shieldsReducedLocation = flag4;
}

const T_processPlague = registerTodo('M4u', 'processPlague');
/** Habitat.cs 1678 ProcessPlague(timePassed). */
export function processPlague(galaxy: Galaxy, habitat: Habitat, timePassed: number): void {
    // RND: 2 direct, +clock×1 — not drawn until M4u.
    /* TODO(port) M4u */ todo(T_processPlague);
}

const T_checkHabitatIsEmpire = registerTodo('M4u', 'checkHabitatIsEmpire');
/** Habitat.cs 5230 CheckHabitatIsEmpire(galaxy). */
export function checkHabitatIsEmpire(galaxy: Galaxy, habitat: Habitat): void {
    // RND: 1 direct, +clock×2 — not drawn until M4u.
    /* TODO(port) M4u */ todo(T_checkHabitatIsEmpire);
}

/** Galaxy.2.cs 4784 ChanceColonyGovernorPromotion(empire, colony) (characterRuntime.ts). */
export function chanceColonyGovernorPromotion(galaxy: Galaxy, empire: Empire, habitat: Habitat): void {
    characterRuntime.chanceColonyGovernorPromotion(galaxy, empire, habitat);
}
const T_spawnCreatures = registerTodo('M4u', 'spawnCreatures');
/** Habitat.cs 1619 SpawnCreatures. */
export function spawnCreatures(galaxy: Galaxy, habitat: Habitat): void {
    // RND: draws in callees (d≤3) — not drawn until M4u.
    /* TODO(port) M4u */ todo(T_spawnCreatures);
}

const T_doPlanetRemove = registerTodo('M4u', 'doPlanetRemove');
/** Habitat.cs 6379 DoPlanetRemove (a new Thread in C#, synchronous in TS). */
export function doPlanetRemove(galaxy: Galaxy, habitat: Habitat): void {
    /* TODO(port) M4u */ todo(T_doPlanetRemove);
}

const T_clearCompletedPlanetDestroyerProjects = registerTodo('M4u', 'clearCompletedPlanetDestroyerProjects');
/** Galaxy.5.cs 2867 ClearCompletedPlanetDestroyerProjects (planet destroyer runtime: deferred). */
export function clearCompletedPlanetDestroyerProjects(galaxy: Galaxy): void {
    /* TODO(port) M4u */ todo(T_clearCompletedPlanetDestroyerProjects);
}

const T_processDelayedEventActions = registerTodo('deferred', 'processDelayedEventActions');
/** Galaxy.9.cs 1474 ProcessDelayedEventActions(starDate) — scripted game events (DelayedActions is empty in a normal game). */
export function processDelayedEventActions(galaxy: Galaxy, starDate: number): void {
    // RND: draws in callees (d≤3), +clock×6 — not drawn until ported.
    /* TODO(port) deferred (not M4) */ todo(T_processDelayedEventActions);
}

const T_shakturiSendConvoy = registerTodo('deferred', 'shakturiSendConvoy');
/** Empire.2.cs 3487 ShakturiSendConvoy (story). */
export function shakturiSendConvoy(galaxy: Galaxy, empire: Empire): void {
    // RND: 1 direct — not drawn until ported.
    /* TODO(port) deferred (not M4) */ todo(T_shakturiSendConvoy);
}

const T_checkOfferStoryHint = registerTodo('deferred', 'checkOfferStoryHint');
/** Empire.2.cs 3508 CheckOfferStoryHint (story). */
export function checkOfferStoryHint(galaxy: Galaxy, empire: Empire): void {
    // RND: 1 direct — not drawn until ported.
    /* TODO(port) deferred (not M4) */ todo(T_checkOfferStoryHint);
}

const T_checkSendShipConvoysViaGateway = registerTodo('deferred', 'checkSendShipConvoysViaGateway');
/** Empire.1.cs 3899 CheckSendShipConvoysViaGateway(timePassed) (story). */
export function checkSendShipConvoysViaGateway(galaxy: Galaxy, empire: Empire, timePassed: number): void {
    // RND: 4 direct — not drawn until ported.
    /* TODO(port) deferred (not M4) */ todo(T_checkSendShipConvoysViaGateway);
}

const T_assignSpecialMissions = registerTodo('deferred', 'assignSpecialMissions');
/** Empire.5.cs 5401 AssignSpecialMissions (espionage). */
export function assignSpecialMissions(galaxy: Galaxy, empire: Empire): void {
    // RND: 3 direct — not drawn until ported.
    /* TODO(port) deferred (not M4) */ todo(T_assignSpecialMissions);
}

const T_performIntelligenceMissions = registerTodo('deferred', 'performIntelligenceMissions');
/** Empire.5.cs 5597 PerformIntelligenceMissions (espionage). */
export function performIntelligenceMissions(galaxy: Galaxy, empire: Empire): void {
    // RND: 6 direct, +clock×3 — not drawn until ported.
    /* TODO(port) deferred (not M4) */ todo(T_performIntelligenceMissions);
}

const T_reviewAchievements = registerTodo('deferred', 'reviewAchievements');
/** Galaxy.1.cs 2935 ReviewAchievements. */
export function reviewAchievements(galaxy: Galaxy): void {
    /* TODO(port) deferred (not M4) */ todo(T_reviewAchievements);
}

const T_checkVictoryConditions = registerTodo('deferred', 'checkVictoryConditions');
/** Galaxy.1.cs 88 CheckVictoryConditions(playerEmpire, globalVictoryConditions, playerConditionsToAchieve, playerConditionsToPrevent). */
export function checkVictoryConditions(galaxy: Galaxy, playerEmpire: Empire | null): void {
    // RND: draws in callees (d≤3) — not drawn until ported.
    /* TODO(port) deferred (not M4) */ todo(T_checkVictoryConditions);
}

const T_updateAchievements = registerTodo('deferred', 'updateAchievements');
/** Empire.1.cs 3969 UpdateAchievements. */
export function updateAchievements(galaxy: Galaxy, empire: Empire): void {
    /* TODO(port) deferred (not M4) */ todo(T_updateAchievements);
}

const T_checkSendPreWarpProgressEventMessage = registerTodo('M4u', 'checkSendPreWarpProgressEventMessage');
/**
 * Empire.7.cs 3426 CheckSendPreWarpProgressEventMessage(eventType, subject, empire, hint). Stub added by M4t
 * (Galaxy.7.cs 3957 DoEmpireEncounter). `eventType` is a PreWarpProgressEventType (exploration.ts). Returns false.
 */
export function checkSendPreWarpProgressEventMessage(galaxy: Galaxy, empire: Empire, eventType: number, subject: unknown, otherEmpire: Empire | null = null, hint = ''): boolean {
    // RND: 7 direct — not drawn until M4u.
    /* TODO(port) M4u */ todo(T_checkSendPreWarpProgressEventMessage);
    return false;
}

const T_leaveEmpire = registerTodo('M4u', 'leaveEmpire');
/**
 * Habitat.cs 5947 LeaveEmpire (rebellion: IdentifyLeavingEmpire → TakeOwnershipOfColony + messages + ability review).
 * Added by M4j (CheckSatisfaction, Empire.HaveRevolution).
 */
export function leaveEmpire(galaxy: Galaxy, habitat: Habitat): void {
    /* TODO(port) M4u */ todo(T_leaveEmpire);
}

/**
 * Galaxy.1.cs 3781 DoCharacterEvent(eventType, eventData, sourceCharacters, includeLeader, leaderEmpire) — runtime entry
 * used by M4j (ColonyDevelopmentIncrease/Decrease from EvaluateColonyVariables and HaveRevolution), M4r (TreatySigned /
 * TreatyBroken / WarStarted from ChangeDiplomaticRelation) and M4d (TradeIncome from DiplomaticRelation.
 * PerformTradeTransaction). `eventType` is a characters.ts CharacterEventType. Ported in characters.ts
 * (doCharacterEventForList, with DetermineCharacterSkillsAffectedByEvent, the BonusesKnown trait cases and skill progress).
 */
export function doCharacterEventRuntime(galaxy: Galaxy, eventType: number, eventData: unknown, sourceCharacters: readonly unknown[] | null, includeLeader: boolean, leaderEmpire: Empire | null): void {
    doCharacterEventForList(galaxy, eventType as CharacterEventType, eventData, sourceCharacters as Character[] | null, includeLeader, leaderEmpire);
}

/** Galaxy.2.cs 4819 ChanceNewAmbassador(empire, newRelationType, otherEmpire) (characterRuntime.ts). */
export function chanceNewAmbassador(galaxy: Galaxy, empire: Empire, newRelationType: number, otherEmpire: Empire): boolean {
    return characterRuntime.chanceNewAmbassador(galaxy, empire, newRelationType, otherEmpire);
}
