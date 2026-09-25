// M4u — events, disasters, location effects, rebellion, plague, creatures, character runtime (tasks/M4-plan.md §3.3 row
// M4u). The tick skeletons in src/sim/tick/ call these entry points in C# order; the Empire event bodies live in
// empireEvents.ts, the character reviews in characterRuntime.ts (the per-character model in characters.ts), the event enums
// and plague lookups in eventTypes.ts. Also the DEFERRED stubs (plan §0.3): story events, scripted game events, espionage,
// achievements / victory — no-ops that count as TODO hits (their story branches throw only when enabled).
//
// Ported here: Galaxy.5.cs 2867 ClearCompletedPlanetDestroyerProjects, 2893 ClearEmptyDebrisFields, 3372
// FindAbandonedShipsInDebrisField; BuiltObject.cs 3448 DoLocationEffects, 3934 ApplyLocationEffects; Habitat.cs 1619
// SpawnCreatures, 1678 ProcessPlague, 1838 InfectWithPlague, 5230 CheckHabitatIsEmpire, 5888 IdentifyLeavingEmpire, 5948
// LeaveEmpire, 6379 DoPlanetRemove, 7613 CompleteTeardown; Galaxy.9.cs 3124 RemoveHabitat; Galaxy.3.cs 1568/1659
// FindNearestColonyInSystem / FindNearestInfectableColonyWithNoPlague; Galaxy.6.cs 2838 FastFindNearestShipInSystem;
// Galaxy.8.cs 1287 FindNearestEmpireCapital; Empire.6.cs 3941 ProcessCharacters; Creature.cs 1196-1345 creature combat.

import { EventTriggerType } from './story/gameEventModel';
import { shipGroupOf as shipGroupOfBuiltObject } from './combat/threats';
import { empireWarWeariness } from './taxes';
import { charactersCanGenerateAmountNonIntelligenceAgent } from './troops';
import { CharacterRole, CharacterTraitType, generateNewCharacter } from './characters';
import type { Galaxy } from './galaxy';
import type { Empire } from './empire';
import type { BuiltObject } from './builtObject';
import type { Habitat } from './types';
import { GalaxyLocationEffectType, GalaxyLocationType, type GalaxyLocation } from './galaxyLocation';
import { getBuiltObjectsAtLocation } from './stationPlacement';
import { MAX_SOLAR_SYSTEM_SIZE } from './visibility';
import { BuiltObjectRole } from './data/designSpecifications';
import { creatureDamageTarget, inflictDamageFull } from './combat/damage';
import { builtObjectCompleteTeardown } from './combat/teardown';
import { clearAllMissionsForTargetHabitat, clearPreviousMissionRequirements } from './missions/assign';
import { BuiltObjectMissionType } from './missions/mission';
import { empireShipGroups, shipGroupCompleteMission } from './fleets/shipGroup';
import { yardsIndexOfShip } from './construction/constructionYard';
import type { ConstructionQueue } from './construction/constructionQueue';
import { determineAngle, type Creature } from './creature';
import { isBuiltObject, isCreature, isHabitat, type StellarObject } from './missions/mission';
import { notifyOfAttackBuiltObject, notifyOfAttackHabitat } from './combat/attackAI';
import { stellarAttackers, stellarPursuers } from './combat/threats';
import { Character, doCharacterEventForList, type CharacterEventType } from './characters';
import * as characterRuntime from './characterRuntime';
import { EventMessageType, DisasterEventType, RaceEventType, raceImmuneToPlagues, galaxyPlagues, getPlagueUnhappinessFactorWithPlague } from './eventTypes';
export { EventMessageType, DisasterEventType, RaceEventType, raceImmuneToPlagues, galaxyPlagues, getPlagueUnhappinessFactorWithPlague };
import * as empireEvents from './empireEvents';
import * as storyEventActions from './story/eventActions';
import * as storyEvents from './story/storyEvents';
import { Empire as EmpireClass, AutomationLevel } from './empire';
import { BuiltObjectSubRole } from './builtObjectTypes';
import { findNewest } from './design';
import { generateBuiltObjectFromDesign } from './exploration';
import { determineMostSuitableGovernmentTypes } from './game';
import { loadEmpirePolicy, PlanetaryFacilityType, WonderType } from './researchSystem';
import { checkEmpireHasHyperDriveTech } from './forceStructure';
import { empireDoTasks } from './tick/empireTick';
import { ensureStrategicResourceSupply } from './construction/empireConstruction';
import { galaxyStarDate } from './tick/simTime';
import { DiplomaticRelationType } from './diplomacy';
import { fastFindNearestColony } from './diplomacyTick';
import { reviewEmpireAbilityBonusesFull } from './treasury';
import { resolveDescription } from './messages';
import { HabitatCategoryType, HabitatType, type SystemInfo } from './types';
import type { PlagueStatic } from './researchSystem';
import type { Population } from './population';
import { gameText } from './colonyTick';
import { CreatureType } from './creature';
import { REAL_SECONDS_IN_GALACTIC_YEAR, galaxyNow } from './tick/simTime';
import { EmpireMessage, EmpireMessageType, sendEmpireMessage, sendMessageToEmpire, sendMessageToEmpireWithTitle } from './messages';
import { clearColony } from './combat/invasion';
import { DiplomaticRelation, obtainDiplomaticRelation, obtainEmpireEvaluation, processRelationChange, type EmpireEvaluation } from './diplomacy';
import { obtainPirateRelation, PirateRelationType } from './pirateRelations';
import { PlanetaryFacility } from './construction/facilities';
import type { Facility } from './data/facilities';
import type { Plague } from './data/plagues';
import { facilityType, type TechNode } from './researchSystem';
import { cancelBlockades, cancelBlockadeBuiltObject, cancelBlockadeColony, conditionCheckLimit, getBlockadesForEmpire } from './fleets/blockades';
import { cancelAttacksAgainstEmpire } from './pirates/pirateRelationsAI';
import { clearPirateColonyFacilities } from './pirates/pirateGalaxyTick';
import { leaveShipGroup, type ShipGroup } from './fleets/shipGroup';
import { takeOwnershipOfBuiltObject, takeOwnershipOfCargo } from './combat/ownership';
import { identifyMechanoidEmpire } from './fleets/militaryAI';
import { totalColonyStrategicValue } from './forceStructure';
import type { IntelligenceMission } from './characters';
import type { GalaxyResourceMap } from './visibility';

/** Empire.7.cs 3400 SendEventMessageToEmpire(eventMessageType, title, message, additionalData, location): only the attached UI recipient sees it. */
export function sendEventMessageToEmpire(empire: Empire, eventMessageType: EventMessageType, title: string, message: string, additionalData: unknown, location: unknown): void {
    if (empire.eventMessageRecipient !== null) {
        empire.eventMessageRecipient.receiveEventMessage(eventMessageType, title, message, additionalData, location);
    }
}

// ---------------------------------------------------------------------------
// Galactic NewsNet — Empire.7.cs 2961-3398 SendNewsBroadcast* / SendNewsBroadcastCore. No Rnd anywhere in the path.
// ---------------------------------------------------------------------------

/** Galaxy.2.cs 2472 ResolveDescription(DisasterEventType) (messages.ts resolveDescription / enumText.ts DISASTER_EVENT). */
export function resolveDisasterDescription(disasterType: DisasterEventType): string {
    return resolveDescription(DisasterEventType as unknown as Record<number, string>, disasterType);
}

/** `subject is PlanetaryFacilityDefinition` (the TS definition is the plain facilities.txt record). */
function isPlanetaryFacilityDefinition(o: unknown): o is Facility {
    return typeof o === 'object' && o !== null && !(o instanceof PlanetaryFacility) && 'facilityId' in o && 'wonderType' in o;
}

/** `subject is ResearchNode` (the TS node is the TechNode record; Name = def.name). */
function isResearchNode(o: unknown): o is TechNode {
    return typeof o === 'object' && o !== null && 'def' in o && 'isResearched' in o;
}

/** `extraData is Plague` (plain plagues.txt record). */
function isPlague(o: unknown): o is Plague {
    return typeof o === 'object' && o !== null && 'plagueId' in o && 'mortalityRate' in o;
}

/** Empire.7.cs 2961 SendNewsBroadcast(eventType, subject) and the 2976 / 2981 / 2986 overloads (defaults = the C# chain). */
export function sendNewsBroadcast(
    empire: Empire,
    eventType: EventMessageType,
    subject: unknown,
    disasterType: DisasterEventType = DisasterEventType.Undefined,
    warStartEnd = false,
    wonderBegun = false,
    messageType: EmpireMessageType = EmpireMessageType.Undefined,
    extraData: unknown = null,
): void {
    // Empire.7.cs 2986-2990: the C# queues SendNewsBroadcastCallback (2992) on the ThreadPool; the port runs
    // SendNewsBroadcastCore synchronously at the call site (single-threaded sim; the Core draws no Rnd).
    sendNewsBroadcastCore(empire, eventType, subject, disasterType, warStartEnd, wonderBegun, messageType, extraData);
}

/** Empire.7.cs 2966 SendNewsBroadcastWarStartEnd(relation). */
export function sendNewsBroadcastWarStartEnd(empire: Empire, relation: DiplomaticRelation): void {
    sendNewsBroadcast(empire, EventMessageType.Undefined, relation, DisasterEventType.Undefined, true, false);
}

/** Empire.7.cs 2971 SendNewsBroadcastWonderBegin(wonder, colony). */
export function sendNewsBroadcastWonderBegin(empire: Empire, wonder: Facility, colony: Habitat): void {
    sendNewsBroadcast(empire, EventMessageType.Undefined, wonder, DisasterEventType.Undefined, false, true, EmpireMessageType.Undefined, colony);
}

/** Empire.7.cs 3008-3398 SendNewsBroadcastCore. `this` = empire; `_Galaxy` = empire.galaxy. */
export function sendNewsBroadcastCore(
    empire: Empire,
    eventType: EventMessageType,
    subject: unknown,
    disasterType: DisasterEventType,
    warStartEnd: boolean,
    wonderBegun: boolean,
    messageType: EmpireMessageType,
    extraData: unknown,
): void {
    const galaxy = empire.galaxy;
    let text = '';
    // 3011-3268: build the news text.
    switch (messageType) {
        case EmpireMessageType.EmpireDefeated: {
            // 3013-3029
            if (!(subject instanceof EmpireClass)) break;
            const empire5 = subject;
            let empire6: Empire | null = null;
            if (extraData != null && extraData instanceof EmpireClass) empire6 = extraData;
            text = empire6 != null ? gameText('X has been defeated by Y', empire5.name, empire6.name) : gameText('X has been defeated', empire5.name);
            break;
        }
        case EmpireMessageType.ResearchBreakthrough: {
            // 3031-3047
            if (subject == null || !isResearchNode(subject)) break;
            const researchNode = subject;
            let empire4: Empire | null = null;
            if (extraData != null && extraData instanceof EmpireClass) empire4 = extraData;
            text = empire4 != null
                ? gameText('The EMPIRE has made a breakthrough in the key technology of X', empire4.name, researchNode.def.name)
                : gameText('An empire has made a breakthrough in the key technology of X', researchNode.def.name);
            break;
        }
        default:
            if (warStartEnd) {
                // 3049-3066
                if (!(subject instanceof DiplomaticRelation)) break;
                const diplomaticRelation = subject;
                const empire1 = diplomaticRelation.initiator;
                const empire2 = diplomaticRelation.thisEmpire !== empire1 ? diplomaticRelation.thisEmpire : diplomaticRelation.otherEmpire;
                if (empire1 != null && empire2 != null) {
                    text = diplomaticRelation.type !== DiplomaticRelationType.War
                        ? gameText('The war between X and Y has ended', empire1.name, empire2.name)
                        : gameText('X has declared war on Y', empire1.name, empire2.name);
                }
            } else if (wonderBegun) {
                // 3067-3093
                if (!isPlanetaryFacilityDefinition(subject)) break;
                const planetaryFacilityDefinition = subject;
                if (facilityType(planetaryFacilityDefinition) !== PlanetaryFacilityType.Wonder) break;
                if (extraData != null && isHabitat(extraData)) {
                    const habitat = extraData;
                    const habitat2 = galaxy.determineHabitatSystemStar(habitat);
                    text = gameText('Wonder construction begun WONDER COLONY SYSTEM', planetaryFacilityDefinition.name, habitat.name, habitat2.name);
                } else {
                    text = gameText('Wonder construction begun WONDER', planetaryFacilityDefinition.name);
                }
            } else {
                // 3094-3266
                if (eventType === EventMessageType.Undefined) break;
                switch (eventType) {
                    case EventMessageType.CreatureOutbreak: {
                        // 3102-3119
                        if (subject == null || !isCreature(subject)) break;
                        const creature = subject;
                        if (creature.type === CreatureType.SilverMist && extraData != null && isHabitat(extraData)) {
                            const habitat3 = extraData;
                            const habitat4 = galaxy.determineHabitatSystemStar(habitat3);
                            const arg = empireEvents.resolveSectorDescription(galaxy, habitat3.xpos, habitat3.ypos);
                            text = gameText('SilverMist Released Broadcast', habitat3.name, habitat4.name, arg);
                        }
                        break;
                    }
                    case EventMessageType.DisasterEvent:
                        // 3120-3153
                        if (disasterType === DisasterEventType.EconomicCrisis) {
                            text = resolveDisasterDescription(disasterType);
                        } else {
                            if (subject == null || !isHabitat(subject)) break;
                            const habitat7 = subject;
                            if (messageType === EmpireMessageType.ColonyLost && disasterType === DisasterEventType.Plague) {
                                let arg2 = '';
                                let arg3 = '';
                                if (habitat7.empire != null) arg2 = habitat7.empire.name;
                                if (extraData != null && isPlague(extraData)) arg3 = extraData.name;
                                text = gameText('News EMPIRE COLONY has been completely wiped out by PLAGUE', arg2, habitat7.name, arg3);
                            } else {
                                text = gameText('Disaster at COLONY', resolveDisasterDescription(disasterType), habitat7.name);
                            }
                        }
                        break;
                    case EventMessageType.WonderBuilt: {
                        // 3154-3183
                        if (!(subject instanceof PlanetaryFacility)) break;
                        const planetaryFacility = subject;
                        if (planetaryFacility.type !== PlanetaryFacilityType.Wonder) break;
                        if (extraData != null && isHabitat(extraData)) {
                            const habitat5 = extraData;
                            const habitat6 = galaxy.determineHabitatSystemStar(habitat5);
                            text = gameText('Wonder construction completed WONDER COLONY SYSTEM', planetaryFacility.name, habitat5.name, habitat6.name);
                        } else {
                            text = gameText('Wonder construction completed WONDER', planetaryFacility.name);
                        }
                        break;
                    }
                    case EventMessageType.LeaderChange:
                        // 3184-3193
                        if (subject != null && subject instanceof Character) {
                            const character2 = subject;
                            if (character2.role === CharacterRole.Leader) text = gameText('Empire Leader Replaced', empire.name, character2.name);
                        }
                        break;
                    case EventMessageType.PhantomPirates:
                        // 3194-3202
                        if (subject != null && subject instanceof EmpireClass) text = gameText('Phantom Pirates encountered', subject.name);
                        break;
                    case EventMessageType.CharacterEvent:
                        // 3203-3212
                        if (subject != null && subject instanceof Character) {
                            const character = subject;
                            if (character.role === CharacterRole.Leader || character.role === CharacterRole.PirateLeader) text = gameText('Empire Leader killed', empire.name, character.name);
                        }
                        break;
                }
            }
            break;
    }
    // 3269-3334: every met, non-pirate empire in this empire's DiplomaticRelations.
    const newsNet = gameText('Galactic NewsNet').toUpperCase(); // .ToUpper(CultureInfo.InvariantCulture)
    if (empire.diplomaticRelations != null) {
        const relations = empire.diplomaticRelations;
        for (let i = 0; i < relations.count; i++) {
            const diplomaticRelation2 = relations.at(i);
            if (diplomaticRelation2 == null || diplomaticRelation2.type === DiplomaticRelationType.NotMet || diplomaticRelation2.otherEmpire == null || diplomaticRelation2.otherEmpire === empire || diplomaticRelation2.otherEmpire.pirateEmpireBaseHabitat != null) continue;
            const otherEmpire = diplomaticRelation2.otherEmpire;
            let flag = false;
            if (messageType === EmpireMessageType.EmpireDefeated) flag = true;
            else if (warStartEnd) flag = true;
            else if (wonderBegun) flag = true;
            else if (eventType !== EventMessageType.Undefined) {
                switch (eventType) {
                    case EventMessageType.DisasterEvent:
                        if (disasterType === DisasterEventType.EconomicCrisis) {
                            flag = true;
                        } else if (isHabitat(subject)) {
                            if (otherEmpire.visibility.checkSystemExplored(subject.systemIndex)) flag = true;
                        }
                        break;
                    case EventMessageType.WonderBuilt:
                    case EventMessageType.CreatureOutbreak:
                    case EventMessageType.PhantomPirates:
                    case EventMessageType.LeaderChange:
                        flag = true;
                        break;
                    case EventMessageType.CharacterEvent:
                        if (text !== '') flag = true;
                        break;
                }
            }
            if (flag) {
                const empireMessage = new EmpireMessage(empire, EmpireMessageType.GalacticNewsNet, subject);
                empireMessage.description = newsNet + ': ' + empire.name + ' - ' + text;
                empireMessage.title = newsNet + ': ' + empire.name;
                sendEmpireMessage(empireMessage, diplomaticRelation2.otherEmpire);
            }
        }
    }
    // 3335-3397: every active pirate faction, filtered by this empire's pirate relation with it.
    for (let j = 0; j < galaxy.pirateEmpires.length; j++) {
        const empire7 = galaxy.pirateEmpires[j];
        if (empire7 == null || !empire7.active || empire7.pirateEmpireBaseHabitat == null) continue;
        const pirateRelation = obtainPirateRelation(empire, empire7); // may AddPirateRelation (NotMet), as in the C#
        const met = pirateRelation.type !== PirateRelationType.NotMet;
        let flag2 = false;
        switch (messageType) {
            case EmpireMessageType.EmpireDefeated:
                if (met) flag2 = true;
                break;
            case EmpireMessageType.ResearchBreakthrough:
                flag2 = true;
                break;
            default:
                if (warStartEnd) {
                    if (met) flag2 = true;
                } else if (wonderBegun) {
                    if (met) flag2 = true;
                } else {
                    if (eventType === EventMessageType.Undefined) break;
                    switch (eventType) {
                        case EventMessageType.DisasterEvent:
                            if (disasterType === DisasterEventType.EconomicCrisis) {
                                if (met) flag2 = true;
                            } else if (isHabitat(subject)) {
                                if (empire7.visibility.checkSystemExplored(subject.systemIndex)) flag2 = true;
                            }
                            break;
                        case EventMessageType.WonderBuilt:
                        case EventMessageType.CreatureOutbreak:
                        case EventMessageType.LeaderChange:
                            if (met) flag2 = true;
                            break;
                        case EventMessageType.PhantomPirates:
                            flag2 = true;
                            break;
                        case EventMessageType.CharacterEvent:
                            if (text !== '' && met) flag2 = true;
                            break;
                    }
                }
                break;
        }
        if (flag2) {
            const empireMessage2 = new EmpireMessage(empire, EmpireMessageType.GalacticNewsNet, subject);
            empireMessage2.description = newsNet + ': ' + empire.name + ' - ' + text;
            empireMessage2.title = newsNet + ': ' + empire.name;
            sendEmpireMessage(empireMessage2, empire7);
        }
    }
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

/** Empire.7.cs 3408 CheckReviewSpecialPirateEvents (empireEvents.ts). */
export function checkReviewSpecialPirateEvents(galaxy: Galaxy, empire: Empire): void {
    empireEvents.checkReviewSpecialPirateEvents(galaxy, empire);
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
/** Empire.1.cs 2094 ResetRaceEvents (empireEvents.ts). */
export function resetRaceEvents(galaxy: Galaxy, empire: Empire): void {
    empireEvents.resetRaceEvents(galaxy, empire);
}

/** Empire.1.cs 1758 ReviewRandomEvents (empireEvents.ts). */
export function reviewRandomEvents(galaxy: Galaxy, empire: Empire): void {
    empireEvents.reviewRandomEvents(galaxy, empire);
}

/** Empire.1.cs 2811 ReviewEmpireEvents (empireEvents.ts). */
export function reviewEmpireEvents(galaxy: Galaxy, empire: Empire): void {
    empireEvents.reviewEmpireEvents(galaxy, empire);
}

/** Empire.1.cs 1731 PirateReviewRandomEvents (empireEvents.ts). */
export function pirateReviewRandomEvents(galaxy: Galaxy, empire: Empire): void {
    empireEvents.pirateReviewRandomEvents(galaxy, empire);
}

/** BuiltObject.cs 3448 DoLocationEffects(timePassed, time). */
export function doLocationEffects(galaxy: Galaxy, builtObject: BuiltObject, timePassed: number, time: number): void {
    if (builtObject.shipDamageAmountLocation > 0) {
        const hitPower = builtObject.shipDamageAmountLocation * timePassed;
        // BuiltObject.2.cs 6221 InflictDamage (combat/damage.ts; applies the damage, Rnd per its callees).
        inflictDamageFull(galaxy, builtObject, builtObject, null, hitPower, time, 0, false, -Number.MAX_VALUE, false);
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
            // BuiltObject.2.cs 6221 InflictDamage (combat/damage.ts; applies the damage, Rnd per its callees).
            inflictDamageFull(galaxy, builtObject, builtObject, null, num8, time, 0, false, -Number.MAX_VALUE, true);
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

/** Galaxy.3.cs 1693 FindNearestInfectableColonyInIndexWithNoPlague(x, y, index, out distance). */
function findNearestInfectableColonyInIndexWithNoPlague(galaxy: Galaxy, x: number, y: number, cx: number, cy: number): { item: Habitat | null; distance: number } {
    let habitat: Habitat | null = null;
    const habitatList = galaxy.habitatIndexGrid[cx][cy];
    let distance = Number.MAX_VALUE;
    for (let i = 0; i < habitatList.length; i++) {
        const habitat2 = habitatList[i];
        if (habitat2 == null || habitat2.population == null || habitat2.population.items.length <= 0) continue;
        let flag = false;
        for (let j = 0; j < habitat2.population.items.length; j++) {
            const population = habitat2.population.items[j];
            if (population != null && population.race != null && !raceImmuneToPlagues(population.race)) {
                flag = true;
                break;
            }
        }
        if (flag && habitat2.plagueId < 0 && habitat2.plagueTimeRemaining <= 0) {
            const num = galaxy.calculateDistanceSquared(x, y, habitat2.xpos, habitat2.ypos);
            if (num < distance) {
                distance = num;
                habitat = habitat2;
            }
        }
    }
    if (habitat !== null) distance = galaxy.calculateDistance(x, y, habitat.xpos, habitat.ypos);
    return { item: habitat, distance };
}

/** Galaxy.3.cs 1659 FindNearestInfectableColonyWithNoPlague(x, y) (the shared sector ring search). No Rnd. */
export function findNearestInfectableColonyWithNoPlague(galaxy: Galaxy, x: number, y: number): Habitat | null {
    return galaxy.ringSearch(x, y, (cx, cy) => findNearestInfectableColonyInIndexWithNoPlague(galaxy, x, y, cx, cy));
}

/** Habitat.cs 1838 InfectWithPlague(plague, infectingColony). Rnd: NextDouble when a population can be infected. */
export function infectWithPlague(galaxy: Galaxy, habitat: Habitat, plague: PlagueStatic, infectingColony: Habitat | null): void {
    let flag = false;
    for (let i = 0; i < habitat.population.items.length; i++) {
        const population = habitat.population.items[i];
        if (population != null && population.race != null && !raceImmuneToPlagues(population.race)) {
            flag = true;
            break;
        }
    }
    if (!flag) return;
    habitat.plagueId = plague.plagueId;
    // PlagueTimeRemaining = plague.Duration + (float)((Rnd.NextDouble() - 0.5) * ((double)plague.Duration * 0.3)) (float field).
    habitat.plagueTimeRemaining = Math.fround(Math.fround(plague.duration) + Math.fround((galaxy.rnd.nextDouble() - 0.5) * (Math.fround(plague.duration) * 0.3)));
    const habitat2 = galaxy.determineHabitatSystemStar(habitat);
    galaxy.systems[habitat2.systemIndex].plagueId = plague.plagueId;
    const description = plague.description;
    let title = gameText('Colony Disaster Plague Spreads') + '!';
    if (infectingColony === null) title = gameText('Colony Disaster Plague') + '!';
    const empty = infectingColony !== null
        ? gameText('Colony Disaster Plague Spreads Description', plague.name, infectingColony.name, habitat.name, habitat2.name, description)
        : gameText('Colony Disaster Plague Description', plague.name, habitat.name, habitat2.name, description);
    // C# derefs Empire (the caller only infects owned colonies).
    sendEventMessageToEmpire(habitat.empire!, EventMessageType.DisasterEvent, title, empty, DisasterEventType.Plague, habitat);
    sendNewsBroadcast(habitat.empire!, EventMessageType.DisasterEvent, habitat, DisasterEventType.Plague, false, false);
}

/**
 * Habitat.cs 1678 ProcessPlague(timePassed). Rnd: Next(0, 1000) per call while plagued; InfectWithPlague's NextDouble and
 * Next(10, 16) (special function 1: Kaltor outbreak) when the plague spreads.
 */
export function processPlague(galaxy: Galaxy, habitat: Habitat, timePassed: number): void {
    if (habitat.plagueId < 0 || !(habitat.plagueTimeRemaining > 0)) return;
    let num = 0.0;
    let num2 = 1000;
    const plague = galaxyPlagues(galaxy)[habitat.plagueId];
    if (plague != null) {
        num = plague.mortalityRate;
        num2 = plague.infectionChance;
        let num3 = num2;
        if (plague.exceptionRaceName !== '') {
            const dominantRace = habitat.population.dominantRace;
            if (dominantRace !== null && dominantRace.name === plague.exceptionRaceName) num3 = plague.exceptionInfectionChance;
        }
        const num4 = galaxy.rnd.next(0, 1000);
        if (num4 > 1000 - num3) {
            const habitat2 = findNearestInfectableColonyWithNoPlague(galaxy, habitat.xpos, habitat.ypos);
            if (habitat2 !== null) {
                const num5 = galaxy.calculateDistance(habitat.xpos, habitat.ypos, habitat2.xpos, habitat2.ypos);
                let num6 = galaxy.sectorSize * 0.8;
                num6 += galaxy.sectorSize * 2.0 * (Math.sqrt(num3) / Math.sqrt(1000.0));
                if (num5 < num6 && habitat2.population != null && habitat2.empire !== null && (habitat2.empire !== galaxy.independentEmpire || plague.specialFunctionCode === 1)) {
                    infectWithPlague(galaxy, habitat2, plague, habitat);
                    if (plague.specialFunctionCode === 1) {
                        galaxy.allowGiantKaltorGeneration = true;
                        const num7 = galaxy.rnd.next(10, 16);
                        for (let i = 0; i < num7; i++) galaxy.generateCreatureAtHabitat(CreatureType.Kaltor, habitat2, false);
                    }
                }
            }
        }
        if (habitat.population != null) {
            let num8 = num;
            if (plague.exceptionRaceName !== '') {
                const dominantRace2 = habitat.population.dominantRace;
                if (dominantRace2 !== null && dominantRace2.name === plague.exceptionRaceName) num8 = plague.exceptionMortalityRate;
            }
            const num9 = habitat.population.totalAmount;
            let val = num8 * (timePassed / REAL_SECONDS_IN_GALACTIC_YEAR) * num9;
            let num10 = 10000000.0;
            if (num8 > 1.0) num10 *= num8;
            val = Math.max(num10, val);
            if (num9 > num10 || plague.canCompletelyEliminatePopulation) {
                const populationList: Population[] = [];
                for (let j = 0; j < habitat.population.items.length; j++) {
                    const population = habitat.population.items[j];
                    if (population == null) continue;
                    let num11 = num;
                    let num12 = val;
                    if (plague.exceptionRaceName !== '' && population.race != null && population.race.name === plague.exceptionRaceName) {
                        num11 = plague.exceptionMortalityRate;
                        num12 = plague.exceptionMortalityRate * (timePassed / REAL_SECONDS_IN_GALACTIC_YEAR) * num9;
                    }
                    if (!raceImmuneToPlagues(population.race)) {
                        const num13 = population.amount / num9;
                        let val2 = num12 * num13;
                        let num14 = 5000000.0;
                        if (num11 > 1.0) num14 *= num11;
                        val2 = Math.max(num14, val2);
                        let num15 = population.amount - csDoubleToLong(val2);
                        if (!plague.canCompletelyEliminatePopulation) num15 = Math.max(num15, 1000000);
                        population.amount = num15;
                        if (population.amount <= 0) {
                            population.amount = 0;
                            populationList.push(population);
                        }
                    }
                }
                for (let k = 0; k < populationList.length; k++) habitat.population.remove(populationList[k]);
                habitat.population.recalculateTotalAmount();
                if (habitat.population.totalAmount <= 0 || habitat.population.items.length <= 0) {
                    if (habitat.empire !== null) {
                        const title = gameText('COLONY wiped out by PLAGUE', habitat.name, plague.name);
                        const description = gameText('Our colony COLONY has been completely wiped out by PLAGUE', habitat.name, plague.name);
                        sendMessageToEmpire(habitat.empire, habitat.empire, EmpireMessageType.ColonyLost, habitat, description, { x: Math.trunc(habitat.xpos), y: Math.trunc(habitat.ypos) }, '', title);
                        sendNewsBroadcast(habitat.empire, EventMessageType.DisasterEvent, habitat, DisasterEventType.Plague, false, false, EmpireMessageType.ColonyLost, plague);
                    }
                    const builtObjectList: BuiltObject[] = [];
                    if (habitat.empire !== null && habitat.empire.builtObjects != null) {
                        for (let l = 0; l < habitat.empire.builtObjects.length; l++) {
                            const builtObject = habitat.empire.builtObjects[l];
                            if (builtObject != null && builtObject.role === BuiltObjectRole.Base && builtObject.parentHabitat === habitat) builtObjectList.push(builtObject);
                        }
                    }
                    for (let m = 0; m < builtObjectList.length; m++) {
                        const builtObject2 = builtObjectList[m];
                        // BuiltObject.2.cs 6221 InflictDamage (combat/damage.ts): 1 000 000 damage destroys the base, as in the C#.
                        inflictDamageFull(galaxy, builtObject2, builtObject2, null, 1000000.0, galaxyNow(galaxy), 0, false, 0.0, false);
                    }
                    for (let n = 0; n < habitat.basesAtHabitat.length; n++) {
                        const builtObject3 = habitat.basesAtHabitat[n];
                        // BuiltObject.2.cs 6221 InflictDamage (combat/damage.ts): 1 000 000 damage destroys the base, as in the C#.
                        if (builtObject3 != null) inflictDamageFull(galaxy, builtObject3, builtObject3, null, 1000000.0, galaxyNow(galaxy), 0, false, 0.0, false);
                    }
                    // Habitat.cs 7450 ClearColony(null, sendMessages: true, removeEmpireWhenNoColonies: true) (combat/ownership.ts).
                    clearColony(galaxy, habitat, null);
                    habitat.plagueId = -1;
                    habitat.plagueTimeRemaining = 0;
                }
            }
        }
    }
    const num16 = Math.fround(habitat.plagueTimeRemaining - Math.fround(timePassed));
    if (num16 <= 0) {
        habitat.plagueId = -1;
        habitat.plagueTimeRemaining = 0;
    } else {
        habitat.plagueTimeRemaining = num16;
    }
}

/** C# (long)double: truncation toward zero (values here stay far inside the long range). */
function csDoubleToLong(v: number): number {
    return Math.trunc(v);
}

/** Galaxy.3.cs 5007-5008 HabitatToEmpireThreshhold / HabitatToEmpireMinimumIntelligence. */
const HABITAT_TO_EMPIRE_THRESHHOLD = 270000000000;
const HABITAT_TO_EMPIRE_MINIMUM_INTELLIGENCE = 69;

/** Galaxy.8.cs 1287 FindNearestEmpireCapital(x, y, empiresToExclude). No Rnd. */
function findNearestEmpireCapital(galaxy: Galaxy, x: number, y: number, empiresToExclude: Empire[] | null): Empire | null {
    let result: Empire | null = null;
    let num = Number.MAX_VALUE;
    for (let i = 0; i < galaxy.empires.length; i++) {
        const e = galaxy.empires[i];
        if (e.active && e.pirateEmpireBaseHabitat === null && (empiresToExclude === null || !empiresToExclude.includes(e)) && e.capital !== null) {
            const num2 = galaxy.calculateDistance(x, y, e.capital.xpos, e.capital.ypos);
            if (num2 < num) {
                result = e;
                num = num2;
            }
        }
    }
    return result;
}

/** One starting ship for a new empire (Habitat.cs 5315-5413: FindNewest, BuildCount++, GenerateBuiltObjectFromDesign, parking point). */
function newEmpireStartingShip(galaxy: Galaxy, empire: Empire, habitat: Habitat, subRole: BuiltObjectSubRole, isState: boolean, x: number, y: number): void {
    const design = findNewest(empire.designs, subRole);
    if (design !== null) {
        design.buildCount++;
        const builtObject = generateBuiltObjectFromDesign(galaxy, empire, design, galaxy.generateBuiltObjectName(design, habitat), isState, x, y);
        builtObject.parentHabitat = habitat;
        builtObject.dateBuilt = galaxyStarDate(galaxy);
        builtObject.dateRetrofit = galaxyStarDate(galaxy);
        const p = galaxy.selectRelativeParkingPoint();
        builtObject.parentOffsetX = p.x;
        builtObject.parentOffsetY = p.y;
        builtObject.heading = galaxy.selectRandomHeading();
    }
}

/**
 * Habitat.cs 5230 CheckHabitatIsEmpire(galaxy): a populous, intelligent independent colony becomes a new empire.
 * Rnd: Next(0, 5) once the population / empire-count gates pass; then the new empire's generation draws (Empire ctor,
 * SetTechTreeLevel, its first Empire.DoTasks, ship names / parking points / headings).
 */
export function checkHabitatIsEmpire(galaxy: Galaxy, habitat: Habitat): void {
    if (galaxy.nextEmpireId >= galaxy.maximumEmpireCount || habitat.owner !== galaxy.independentEmpire) return;
    let num = 0;
    if (habitat.population == null || habitat.population.items.length <= 0 || habitat.population.dominantRace === null || habitat.population.dominantRace.intelligence < HABITAT_TO_EMPIRE_MINIMUM_INTELLIGENCE) return;
    for (let i = 0; i < habitat.population.items.length; i++) {
        const population = habitat.population.items[i];
        if (population != null && population.race != null) num += population.race.intelligence * population.amount;
    }
    if (num < HABITAT_TO_EMPIRE_THRESHHOLD || galaxy.empires.length >= galaxy.maximumEmpireAmount || galaxy.rnd.next(0, 5) !== 2) return;
    const race = habitat.population.dominantRace;
    const governmentAttributesList = determineMostSuitableGovernmentTypes(race, EmpireClass.resolveDefaultAllowableGovernmentTypes(race));
    const policy = loadEmpirePolicy(galaxy.researchStatic, race, false);
    const empire = new EmpireClass(galaxy, '', habitat, race, governmentAttributesList[0].governmentId, 1.0, policy);
    habitat.isRefuellingDepot = true;
    let num2 = 1;
    let num3 = 2;
    let num4 = 1;
    let num5 = 5;
    const num6 = 0;
    let num7 = 1;
    const empiresToExclude: Empire[] = [];
    const empire2 = findNearestEmpireCapital(galaxy, habitat.xpos, habitat.ypos, empiresToExclude);
    if (empire2 !== null && empire2.research != null && !checkEmpireHasHyperDriveTech(empire2)) {
        if (galaxy.researchStatic !== null) empire.research.setTechTreeLevel(galaxy.rnd, empire.dominantRace, 0.0, false);
        // TechTree.FindNodeBySpecialFunctionCode(2).IsEnabled = true (the first node with that code).
        const researchNode = empire.research.techTree.find((n) => n.def.specialFunctionCode === 2) ?? null;
        if (researchNode !== null) researchNode.isEnabled = true;
        empire.research.update(empire.dominantRace);
        empire.reviewResearchAbilities();
        empire.reviewDesignsBuiltObjectsImprovedComponents();
        num2 = 0;
        num3 = 0;
        num4 = 0;
        num5 = 0;
        num7 = 0;
    }
    empire.takeOwnershipOfColony(habitat, empire);
    empire.controlColonization = AutomationLevel.FullyAutomated;
    empire.controlColonyDevelopment = true;
    empire.controlColonyStockLevels = true;
    empire.controlColonyTaxRates = true;
    empire.controlDesigns = true;
    empire.controlDiplomacyGifts = AutomationLevel.FullyAutomated;
    empire.controlDiplomacyOffense = AutomationLevel.FullyAutomated;
    empire.controlDiplomacyTreaties = AutomationLevel.FullyAutomated;
    empire.controlMilitaryAttacks = AutomationLevel.FullyAutomated;
    empire.controlMilitaryFleets = true;
    empire.controlStateConstruction = AutomationLevel.FullyAutomated;
    empire.controlTroopGeneration = true;
    empire.controlAgentAssignment = AutomationLevel.FullyAutomated;
    empire.controlResearch = true;
    empire.controlPopulationPolicy = true;
    empire.controlColonyFacilities = AutomationLevel.FullyAutomated;
    empire.controlCharacterLocations = true;
    empire.controlOfferPirateMissions = AutomationLevel.FullyAutomated;
    if (habitat.population.dominantRace !== null) empire.designPictureFamilyIndex = habitat.population.dominantRace.designsPictureFamilyIndex;
    empire.generateDesignSpecifications(galaxy, habitat.population.dominantRace!, false, habitat.population.dominantRace!.name);
    empire.initiateConstruction = false;
    empireDoTasks(galaxy, empire);
    empire.initiateConstruction = true;
    for (let j = 0; j < num2; j++) newEmpireStartingShip(galaxy, empire, habitat, BuiltObjectSubRole.GasMiningShip, false, habitat.xpos + 100.0, habitat.ypos - 50.0);
    for (let k = 0; k < num2; k++) newEmpireStartingShip(galaxy, empire, habitat, BuiltObjectSubRole.MiningShip, false, habitat.xpos + 50.0, habitat.ypos + 100.0);
    for (let l = 0; l < num3; l++) newEmpireStartingShip(galaxy, empire, habitat, BuiltObjectSubRole.ConstructionShip, true, habitat.xpos, habitat.ypos);
    for (let m = 0; m < num4; m++) newEmpireStartingShip(galaxy, empire, habitat, BuiltObjectSubRole.ExplorationShip, true, habitat.xpos, habitat.ypos);
    for (let n = 0; n < num5; n++) newEmpireStartingShip(galaxy, empire, habitat, BuiltObjectSubRole.SmallFreighter, false, habitat.xpos - 50.0, habitat.ypos - 100.0);
    for (let num8 = 0; num8 < num6; num8++) newEmpireStartingShip(galaxy, empire, habitat, BuiltObjectSubRole.MediumFreighter, false, habitat.xpos - 50.0, habitat.ypos - 100.0);
    if (num7 > 0) {
        const design = findNewest(empire.designs, BuiltObjectSubRole.MediumSpacePort);
        if (design !== null) {
            design.buildCount++;
            const builtObject = generateBuiltObjectFromDesign(galaxy, empire, design, empire.capital!.name + ' ' + gameText('Space Port'), true, habitat.xpos, habitat.ypos);
            builtObject.parentHabitat = habitat;
            builtObject.dateBuilt = galaxyStarDate(galaxy);
            builtObject.dateRetrofit = galaxyStarDate(galaxy);
            const p = galaxy.selectRelativeHabitatSurfacePoint(habitat);
            builtObject.parentOffsetX = p.x;
            builtObject.parentOffsetY = p.y;
            builtObject.heading = galaxy.selectRandomHeading();
            builtObject.reDefine();
            if (!empire.spacePorts.includes(builtObject)) empire.spacePorts.push(builtObject);
            if (!empire.constructionYards.includes(builtObject)) empire.constructionYards.push(builtObject);
            if (!empire.manufacturers.includes(builtObject)) empire.manufacturers.push(builtObject);
            if (!empire.refuellingDepots.includes(builtObject)) empire.refuellingDepots.push(builtObject);
            builtObject.reDefine();
        }
    }
    // TODO(port) M4i: EnsureStrategicResourceSupply (Empire.6.cs 1656) — stub.
    ensureStrategicResourceSupply(galaxy, empire);
    empire.resolveSystemVisibility(habitat.xpos, habitat.ypos);
    galaxy.empires.push(empire);
}

/** Galaxy.2.cs 4784 ChanceColonyGovernorPromotion(empire, colony) (characterRuntime.ts). */
export function chanceColonyGovernorPromotion(galaxy: Galaxy, empire: Empire, habitat: Habitat): void {
    characterRuntime.chanceColonyGovernorPromotion(galaxy, empire, habitat);
}
/** Habitat.cs 1619 SpawnCreatures. Rnd: GenerateCreatureAtHabitat's draws when no desert slug is left at the habitat. */
export function spawnCreatures(galaxy: Galaxy, habitat: Habitat): void {
    // Resources.ContainsName("Korabbian Spice").
    if (!habitat.resources.some((r) => galaxy.resourceSystem.byId.get(r.resourceId)?.name === 'Korabbian Spice')) return;
    let num = 0;
    const creatures = galaxy.systems[habitat.systemIndex].creatures ?? [];
    if (creatures.length > 0) {
        for (let i = 0; i < creatures.length; i++) {
            const creature = creatures[i];
            if (creature != null && !creature.hasBeenDestroyed && creature.parentHabitat === habitat && creature.type === CreatureType.DesertSpaceSlug) num++;
        }
    }
    if (num <= 0) galaxy.generateCreatureAtHabitat(CreatureType.DesertSpaceSlug, habitat, true);
}

/**
 * Habitat.cs 6379 DoPlanetRemove (a new Thread in C#, synchronous in TS): Galaxy.RemoveHabitat when the habitat is still at
 * its index. The DoingTasks wait loop never spins single-threaded. No Rnd.
 */
export function doPlanetRemove(galaxy: Galaxy, habitat: Habitat): void {
    habitat.doingRemove = true;
    if (galaxy.habitats.includes(habitat) && galaxy.habitats.length > habitat.habitatIndex && galaxy.habitats[habitat.habitatIndex] === habitat) {
        removeHabitat(galaxy, habitat);
    }
    habitat.doingRemove = false;
}

/** Galaxy.9.cs 3124 RemoveHabitat(habitat). No Rnd. */
export function removeHabitat(galaxy: Galaxy, habitat: Habitat): boolean {
    if (habitat.category === HabitatCategoryType.Star || habitat.category === HabitatCategoryType.GasCloud) return false;
    // 3133-3142: the moons of a destroyed planet are only read (`_ = Habitats[i].HasBeenDestroyed`).
    habitatCompleteTeardown(galaxy, habitat); // RemoveSingleHabitat
    const num = habitat.habitatIndex;
    const num2 = galaxy.habitats.length - 1;
    const movement = -1;
    galaxy['fixResourceMaps'](num, num2, movement, null);
    removeNullBuiltObjects(galaxy);
    return true;
}

/**
 * Galaxy.9.cs 3151 RemoveSystem(system) (M4z1): tears down the ships whose nearest star it is, its creatures, its habitats and
 * star (RemoveSingleHabitat → Habitat.CompleteTeardown), drops the SystemInfo, re-indexes habitats (FixResourceMaps) and
 * system indexes (CompactSystemIndexes). No Rnd. Only the galaxy editor (Main.Part10.cs 2648/2696) and BaconGalaxy
 * RemoveAllGasClouds (no caller) reach it. The TS SystemInfo.habitats also holds the star, so the C# movement
 * -(Habitats.Count + 1) is -(habitats.length) here.
 */
export function removeSystem(galaxy: Galaxy, system: SystemInfo): void {
    const systemStar = system.systemStar;
    const builtObjectList: BuiltObject[] = [];
    for (const builtObject of galaxy.builtObjects) {
        if (builtObject != null && builtObject.nearestSystemStar === system.systemStar) builtObjectList.push(builtObject);
    }
    for (const item of builtObjectList) {
        clearPreviousMissionRequirements(galaxy, item);
        builtObjectCompleteTeardown(galaxy, item, true);
    }
    const array = (system.creatures ?? []).slice();
    for (const creature of array) creature.completeTeardown();
    if (system.creatures !== undefined) system.creatures.length = 0;
    const systemIndex = systemStar.systemIndex;
    const habitatIndex = system.systemStar.habitatIndex;
    const movement = -1 * system.habitats.length;
    const array3 = system.habitats.slice();
    for (const habitat of array3) {
        if (habitat.category !== HabitatCategoryType.Star && habitat.category !== HabitatCategoryType.GasCloud) habitatCompleteTeardown(galaxy, habitat);
    }
    habitatCompleteTeardown(galaxy, system.systemStar);
    if (systemIndex >= 0) galaxy.systems.splice(systemIndex, 1);
    const endIndex = galaxy.habitats.length - 1;
    galaxy['fixResourceMaps'](habitatIndex, endIndex, movement, null);
    system.habitats.length = 0;
    system.dominantEmpire = null;
    system.otherEmpires = null;
    (system as { sector: { x: number; y: number } | null }).sector = null;
    (system as { systemStar: Habitat | null }).systemStar = null;
    compactSystemIndexes(galaxy, systemIndex, systemIndex);
    removeNullBuiltObjects(galaxy);
}

/** Galaxy.9.cs 3583 CompactSystemIndexes(startIndex, endIndex). */
function compactSystemIndexes(galaxy: Galaxy, startIndex: number, endIndex: number): void {
    const num = endIndex - startIndex + 1;
    for (let i = 0; i < galaxy.habitats.length; i++) {
        if (galaxy.habitats[i].systemIndex >= startIndex) galaxy.habitats[i].systemIndex -= num;
    }
}

/** Galaxy.9.cs 2862 RemoveNullBuiltObjects. */
function removeNullBuiltObjects(galaxy: Galaxy): void {
    const list: number[] = [];
    for (let i = 0; i < galaxy.builtObjects.length; i++) {
        if (galaxy.builtObjects[i] == null) list.push(i);
    }
    for (let num = list.length - 1; num >= 0; num--) galaxy.builtObjects.splice(list[num], 1);
}

/** HabitatPrioritizationList purge (Habitat.cs 8005 PurgeHabitatPrioritizations): drop the entries for `habitat`. */
function purgeHabitatPrioritizations<T extends { habitat: Habitat | null }>(list: T[] | null, habitat: Habitat): void {
    if (list == null) return;
    const toRemove = list.filter((p) => p.habitat === habitat);
    for (const item of toRemove) {
        const i = list.indexOf(item);
        if (i >= 0) list.splice(i, 1);
    }
}

/**
 * Habitat.cs 7613 CompleteTeardown: clears the colony, tears down bases / docked / under-construction ships, detaches ships and
 * creatures, completes fleet missions against it, and removes the habitat from the galaxy lists, indexes and empire target
 * lists. No Rnd of its own. The TS Empire has no MonitoringHabitats / DangerousHabitats / ResortHabitats /
 * MigrationSources / MigrationDestinations / TourismSources / TourismDestinations / ResortBaseBuildLocations lists (their
 * owners are unported), so there is nothing to purge there.
 */
export function habitatCompleteTeardown(galaxy: Galaxy, habitat: Habitat): void {
    let num = -1;
    // Habitat.cs 7450 ClearColony(TeardownEmpire) (combat/ownership.ts).
    clearColony(galaxy, habitat, habitat.teardownEmpire);
    galaxy.orders.updateHabitatIndexes(habitat.habitatIndex, -1);
    for (let i = 0; i < galaxy.builtObjects.length; i++) {
        const builtObject = galaxy.builtObjects[i];
        if (builtObject != null && builtObject.parentHabitat === habitat) {
            if (builtObject.role === BuiltObjectRole.Base || builtObject.dockedAt === habitat || builtObject.builtAt === habitat) {
                clearPreviousMissionRequirements(galaxy, builtObject);
                // BuiltObject.CompleteTeardown(galaxy, removeFromEmpire: true) (combat/teardown.ts).
                builtObjectCompleteTeardown(galaxy, builtObject, true);
            } else {
                builtObject.parentHabitat = null;
                builtObject.parentOffsetX = -2000000001.0;
                builtObject.parentOffsetY = -2000000001.0;
            }
        }
    }
    const creatureList: Creature[] = [];
    for (let j = 0; j < galaxy.creatures.length; j++) {
        const creature = galaxy.creatures[j];
        if (creature != null && creature.parentHabitat === habitat) {
            if (creature.type === CreatureType.RockSpaceSlug || creature.type === CreatureType.DesertSpaceSlug) creatureList.push(creature);
            else creature.parentHabitat = null;
        }
    }
    for (const item of creatureList) item.completeTeardown();
    if (habitat.dockingBays !== null) {
        for (const dockingBay of habitat.dockingBays) {
            if (dockingBay.dockedShip !== null) builtObjectCompleteTeardown(galaxy, dockingBay.dockedShip, true);
            dockingBay.dockedShip = null;
        }
    }
    for (let k = 0; k < galaxy.empires.length; k++) {
        const empire = galaxy.empires[k];
        if (empire == null || empire.shipGroups == null) continue;
        const shipGroups = empireShipGroups(empire);
        for (let l = 0; l < shipGroups.length; l++) {
            const shipGroup = shipGroups[l];
            if (shipGroup == null) continue;
            const mission = shipGroup.mission;
            if (mission !== null) {
                // ShipGroup.CompleteMission (fleets/shipGroup.ts).
                if (mission.targetHabitat !== null && mission.targetHabitat === habitat) shipGroupCompleteMission(galaxy, shipGroup);
                if (mission.secondaryTargetHabitat !== null && mission.secondaryTargetHabitat === habitat) shipGroupCompleteMission(galaxy, shipGroup);
            }
        }
    }
    for (let m = 0; m < galaxy.builtObjects.length; m++) {
        const builtObject2 = galaxy.builtObjects[m];
        if (builtObject2 == null) continue;
        // BuiltObject.ClearAllMissionsForTarget(builtObject2, this, Undefined, dropOutOfHyperspace: true) (missions/assign.ts).
        clearAllMissionsForTargetHabitat(galaxy, builtObject2, builtObject2, habitat, BuiltObjectMissionType.Undefined, true);
        if (builtObject2.nearestSystemStar === habitat) {
            clearPreviousMissionRequirements(galaxy, builtObject2);
            builtObjectCompleteTeardown(galaxy, builtObject2, true);
            continue;
        }
        if (builtObject2.dockedAt === habitat) {
            num = -1;
            if (habitat.dockingBays !== null) num = habitat.dockingBays.findIndex((bay) => bay.dockedShip === builtObject2);
            if (num >= 0) {
                const docked = habitat.dockingBays![num].dockedShip;
                if (docked !== null) builtObjectCompleteTeardown(galaxy, docked, true);
                continue;
            }
        }
        const queue = habitat.constructionQueue as ConstructionQueue | null;
        if (builtObject2.builtAt === habitat && queue !== null && queue.constructionYards !== null) {
            num = yardsIndexOfShip(queue.constructionYards, builtObject2);
            if (num >= 0) {
                const underConstruction = queue.constructionYards[num].shipUnderConstruction;
                if (underConstruction !== null) builtObjectCompleteTeardown(galaxy, underConstruction, true);
            }
        }
    }
    const ri = galaxy.ruinsHabitats.indexOf(habitat);
    if (ri >= 0) galaxy.ruinsHabitats.splice(ri, 1);
    if (galaxy.systems != null && habitat.systemIndex >= 0 && habitat.systemIndex < galaxy.systems.length) {
        const systemInfo = galaxy.systems[habitat.systemIndex];
        // Systems[i].Habitats (the TS SystemInfo.habitats also holds the star at [0]; RemoveAt(IndexOf(this)) is the same).
        if (systemInfo != null && systemInfo.habitats != null) {
            num = systemInfo.habitats.indexOf(habitat);
            if (num >= 0) systemInfo.habitats.splice(num, 1);
        }
    }
    for (let n = 0; n < galaxy.empires.length; n++) {
        const empire2 = galaxy.empires[n];
        if (empire2 == null) continue;
        purgeHabitatPrioritizations(empire2.resourceTargets, habitat);
        purgeHabitatPrioritizations(empire2.colonizationTargets, habitat);
        purgeHabitatPrioritizations(empire2.desiredForeignColonies, habitat);
        purgeHabitatPrioritizations(empire2.empireResourceTargets, habitat);
    }
    if (habitat.systemIndex >= 0 && galaxy.systems.length > habitat.systemIndex) {
        const systemInfo2 = galaxy.systems[habitat.systemIndex];
        if (systemInfo2 != null && systemInfo2.systemStar === habitat) {
            // Habitat.cs 7909-7985 (M4z1): a system star's teardown. Only Galaxy.RemoveSystem tears a star down
            // (RemoveHabitat refuses stars).
            const galaxyIndex2 = galaxy.resolveIndex(habitat.xpos, habitat.ypos);
            const systemsCell = galaxy.systemsIndexGrid[galaxyIndex2.x][galaxyIndex2.y];
            if (systemsCell.includes(systemInfo2)) systemsCell.splice(systemsCell.indexOf(systemInfo2), 1);
            const removeStarVisibility = (e: Empire): void => {
                const systemVisibility = e.visibility.systemVisibility;
                if (systemVisibility != null) {
                    for (let num2 = 0; num2 < systemVisibility.length; num2++) {
                        if (systemVisibility[num2].systemStar === habitat) {
                            systemVisibility.splice(num2, 1);
                            break;
                        }
                    }
                }
            };
            const removeStarVisible = (e: Empire): void => {
                if (e.visibility.systemsVisible != null) {
                    num = e.visibility.systemsVisible.indexOf(systemInfo2.systemStar);
                    if (num >= 0) e.visibility.systemsVisible.splice(num, 1);
                }
            };
            for (const empire3 of galaxy.empires) {
                if (empire3 == null) continue;
                removeStarVisibility(empire3);
                removeStarVisible(empire3);
            }
            for (const pirateEmpire of galaxy.pirateEmpires) {
                if (pirateEmpire == null) continue;
                removeStarVisibility(pirateEmpire);
                removeStarVisible(pirateEmpire);
            }
            if (galaxy.independentEmpire !== null) removeStarVisibility(galaxy.independentEmpire);
            removeStarVisible(galaxy.independentEmpire!);
            (systemInfo2 as { systemStar: Habitat | null }).systemStar = null;
        }
    }
    for (let num5 = 0; num5 < galaxy.indexMaxX; num5++) {
        for (let num6 = 0; num6 < galaxy.indexMaxY; num6++) {
            const cell = galaxy.habitatIndexGrid[num5][num6];
            num = cell.indexOf(habitat);
            if (num >= 0) cell.splice(num, 1);
        }
    }
    const hi = galaxy.habitats.indexOf(habitat);
    if (hi >= 0) galaxy.habitats.splice(hi, 1);
}

/**
 * EmpireCounters.cs 119 ProcessEmpireElimination(empire, galaxy, thisEmpire) (`counters` is thisEmpire.Counters). No Rnd.
 * Galaxy.IdentifyShakturiEmpire needs Galaxy.ShakturiActualRace, set only by the Return of the Shakturi story (deferred,
 * plan §0.3) → null.
 */
export function processEmpireElimination(galaxy: Galaxy, thisEmpire: Empire | null, empire: Empire | null): void {
    if (empire === null) return;
    const empire1 = identifyMechanoidEmpire(galaxy);
    const empire2: Empire | null = null; // Galaxy.8.cs 1633 IdentifyShakturiEmpire (story, deferred).
    if (empire1 !== null && empire === empire1 && thisEmpire !== null) thisEmpire.haveDefeatedAncientGuardians = true;
    if (empire2 !== null && empire === empire2 && thisEmpire !== null) thisEmpire.haveDefeatedShakturi = true;
    const counters = thisEmpire!.counters;
    if (empire.pirateEmpireBaseHabitat === null) {
        counters.eliminateEmpireCount = (counters.eliminateEmpireCount + 1) | 0;
        counters.eliminateEmpireStrategicValue = (counters.eliminateEmpireStrategicValue + totalColonyStrategicValue(empire)) | 0;
    } else {
        counters.eliminatePirateEmpireCount = (counters.eliminatePirateEmpireCount + 1) | 0;
    }
}

/** Empire.cs 4874 CompleteTeardown(conqueror) → CompleteTeardown(conqueror, removeFromGalaxy: true, sendMessages: true). */
export function empireCompleteTeardown(galaxy: Galaxy, empire: Empire, conqueror: Empire | null, removeFromGalaxy = true, sendMessages = true): void {
    empireCompleteTeardownFull(galaxy, empire, conqueror, removeFromGalaxy, sendMessages);
}

/**
 * Empire.cs 4879 CompleteTeardown(conqueror, removeFromGalaxy, sendMessages) — an eliminated empire: news broadcast,
 * relations / evaluations / pirate relations removed from every other empire, blockades and attacks cancelled, fleets
 * dissolved, ships and cargo handed to the conqueror (or torn down), troops / characters / targets cleared, removal from
 * the galaxy lists. No Rnd of its own (TakeOwnershipOfBuiltObject / BuiltObject.CompleteTeardown / Character.Kill draw
 * none either). `self` is the C# `this`.
 */
function empireCompleteTeardownFull(galaxy: Galaxy, self: Empire, conqueror: Empire | null, removeFromGalaxy: boolean, sendMessages: boolean): void {
    // 4881-4882: Galaxy.GetMatchingGameEventIdEmpireEliminated (Galaxy.9.cs 1231) scans Galaxy.GameEvents — only scenario
    // game events fill it (deferred, plan §0.3), so the id is -1 and CheckTriggerEvent(-1, ...) returns at once.
    if (conqueror !== null && conqueror.counters !== null) processEmpireElimination(galaxy, conqueror, self);
    self.active = false;
    sendNewsBroadcast(self, EventMessageType.Undefined, self, DisasterEventType.Undefined, false, false, EmpireMessageType.EmpireDefeated, conqueror);
    const empireList: (Empire | null)[] = [];
    empireList.push(galaxy.independentEmpire);
    for (const e of galaxy.empires) empireList.push(e);
    for (const e of galaxy.pirateEmpires) empireList.push(e);
    const currentStarDate = galaxyStarDate(galaxy);
    for (let i = 0; i < empireList.length; i++) {
        const empire = empireList[i];
        if (empire == null || empire === self) continue;
        if (self.pirateEmpireBaseHabitat === null && empire.pirateEmpireBaseHabitat === null) {
            // 4900: ObtainDiplomaticRelation never adds here (Active is already false) — the independent empire gets a
            // detached None relation.
            const diplomaticRelation = obtainDiplomaticRelation(empire, self);
            if (diplomaticRelation != null) {
                if (sendMessages && conqueror !== null) {
                    switch (diplomaticRelation.type) {
                        case DiplomaticRelationType.TradeSanctions:
                        case DiplomaticRelationType.War:
                        case DiplomaticRelationType.Truce:
                            if (conqueror !== empire && conqueror !== galaxy.independentEmpire) {
                                sendMessageToEmpire(conqueror, empire, EmpireMessageType.EmpireDefeated, self, gameText('We have wiped out your enemy, the X', self.name));
                            }
                            break;
                        case DiplomaticRelationType.MutualDefensePact:
                        case DiplomaticRelationType.Protectorate:
                            if (conqueror !== empire && conqueror !== galaxy.independentEmpire) {
                                sendMessageToEmpire(conqueror, empire, EmpireMessageType.EmpireDefeated, self, gameText('We have wiped out your allies, the X', self.name));
                            }
                            break;
                        case DiplomaticRelationType.SubjugatedDominion:
                            if (diplomaticRelation.initiator === self) {
                                if (conqueror !== empire && conqueror !== galaxy.independentEmpire) {
                                    sendMessageToEmpire(conqueror, empire, EmpireMessageType.EmpireDefeated, self, gameText('We have liberated you from the X', self.name));
                                }
                            } else if (conqueror !== empire && conqueror !== galaxy.independentEmpire) {
                                sendMessageToEmpire(conqueror, empire, EmpireMessageType.EmpireDefeated, self, gameText('We have eliminated your slaves, the X', self.name));
                            }
                            break;
                        case DiplomaticRelationType.None:
                        case DiplomaticRelationType.FreeTradeAgreement:
                            if (conqueror !== empire && conqueror !== galaxy.independentEmpire) {
                                sendMessageToEmpire(conqueror, empire, EmpireMessageType.EmpireDefeated, self, gameText('We have wiped out the X', self.name));
                            }
                            break;
                    }
                }
                // 4952: `Type != 0` (NotMet is 0).
                if (diplomaticRelation.type !== DiplomaticRelationType.NotMet) {
                    processRelationChange(empire.diplomacyCounters, empire, diplomaticRelation, self, DiplomaticRelationType.None, currentStarDate);
                }
                empire.diplomaticRelations.remove(diplomaticRelation);
            }
            if (empire.empireEvaluations != null) {
                // 4960: ObtainEmpireEvaluation never adds here either (Active is false).
                const empireEvaluation = obtainEmpireEvaluation(galaxy, empire, self);
                if (empireEvaluation != null) {
                    const evaluations = empire.empireEvaluations as EmpireEvaluation[];
                    const idx = evaluations.indexOf(empireEvaluation);
                    if (idx >= 0) evaluations.splice(idx, 1);
                }
            }
            if (empire.pirateRelations != null) {
                // 4968: ObtainPirateRelation adds a NotMet relation when missing (AddPirateRelation) — removed again at once.
                const pirateRelation = obtainPirateRelation(empire, self);
                if (pirateRelation != null) empire.pirateRelations.remove(pirateRelation);
            }
        } else if (empire.pirateRelations != null) {
            const pirateRelation2 = obtainPirateRelation(empire, self);
            if (pirateRelation2 != null) empire.pirateRelations.remove(pirateRelation2);
        }
        const shared = empire.visibility.empiresSharedVisibility;
        if (shared != null && shared.includes(self.visibility)) shared.splice(shared.indexOf(self.visibility), 1);
        if (empire.characters != null && empire.characters.length > 0) {
            for (const character2 of empire.characters as Character[]) {
                if (character2 == null) continue;
                // Character.Mission (IntelligenceMission; espionage runtime is deferred, so missions are rare).
                const mission = character2.mission as IntelligenceMission | null;
                if (mission != null && mission.type !== 0 && mission.targetEmpire === self) {
                    // 5007-5014: both branches (DeepCover SucceedNotDetect or not) clear the mission.
                    character2.mission = null;
                }
            }
        }
        if (empire.empiresViewable != null) {
            for (let num = empire.empiresViewable.indexOf(self); num >= 0; num = empire.empiresViewable.indexOf(self)) {
                empire.empiresViewable.splice(num, 1);
                empire.empiresViewableExpiry.splice(num, 1);
            }
        }
        cancelBlockades(galaxy, empire, self);
        cancelAttacksAgainstEmpire(galaxy, empire, self);
        if (empire.pirateMissions != null) {
            const iterationCount = { value: 0 };
            while (conditionCheckLimit(empire.pirateMissions.containsEmpire(self), 1000, iterationCount)) {
                const num2 = empire.pirateMissions.indexOfEmpire(self);
                if (num2 >= 0) empire.pirateMissions.items.splice(num2, 1);
            }
        }
        if (empire.knownPirateEmpires != null && empire.knownPirateEmpires.includes(self)) {
            empire.knownPirateEmpires.splice(empire.knownPirateEmpires.indexOf(self), 1);
        }
    }
    clearPirateColonyFacilities(galaxy, self, conqueror);
    if (self.shipGroups != null) {
        const shipGroupList = (self.shipGroups as ShipGroup[]).slice();
        for (let j = 0; j < shipGroupList.length; j++) {
            const shipGroup = shipGroupList[j];
            if (shipGroup == null) continue;
            if (shipGroup.ships != null) {
                const builtObjectList = shipGroup.ships.slice();
                for (let k = 0; k < builtObjectList.length; k++) {
                    const builtObject = builtObjectList[k];
                    leaveShipGroup(galaxy, builtObject);
                }
                shipGroup.ships.length = 0;
            }
            shipGroup.empire = null;
            shipGroup.gatherPoint = null;
            shipGroup.leadShip = null;
            shipGroup.mission = null;
            shipGroup.attackPoint = null;
        }
        self.shipGroups.length = 0;
    }
    if (conqueror !== null && conqueror !== galaxy.independentEmpire) {
        let builtObjectList2: BuiltObject[] = [];
        if (self.privateBuiltObjects != null) {
            builtObjectList2 = self.privateBuiltObjects.slice();
            for (let l = 0; l < builtObjectList2.length; l++) {
                const builtObject2 = builtObjectList2[l];
                if (builtObject2 == null) continue;
                takeOwnershipOfCargo(galaxy, builtObject2.cargo, self, conqueror);
                if (builtObject2.empire !== conqueror) {
                    if (builtObject2.mission !== null) {
                        clearPreviousMissionRequirements(galaxy, builtObject2);
                        builtObject2.subsequentMissions.length = 0;
                    }
                    takeOwnershipOfBuiltObject(galaxy, self, builtObject2, conqueror, true);
                }
            }
            self.privateBuiltObjects.length = 0;
        }
        builtObjectList2.length = 0;
        if (self.builtObjects != null) {
            builtObjectList2 = self.builtObjects.slice();
            for (let m = 0; m < builtObjectList2.length; m++) {
                const builtObject3 = builtObjectList2[m];
                if (builtObject3 == null) continue;
                takeOwnershipOfCargo(galaxy, builtObject3.cargo, self, conqueror);
                if (builtObject3.empire !== conqueror) {
                    if (builtObject3.mission !== null) {
                        clearPreviousMissionRequirements(galaxy, builtObject3);
                        builtObject3.subsequentMissions.length = 0;
                    }
                    takeOwnershipOfBuiltObject(galaxy, self, builtObject3, conqueror, true);
                }
            }
            self.builtObjects.length = 0;
        }
    } else {
        let builtObjectList3: BuiltObject[] = [];
        if (self.privateBuiltObjects != null) {
            builtObjectList3 = self.privateBuiltObjects.slice();
            for (let n = 0; n < builtObjectList3.length; n++) {
                const builtObject4 = builtObjectList3[n];
                if (builtObject4 != null) {
                    builtObjectCompleteTeardown(galaxy, builtObject4, false);
                    removeFromGalaxyBuiltObjects(galaxy, builtObject4);
                }
            }
            self.privateBuiltObjects.length = 0;
        }
        builtObjectList3.length = 0;
        if (self.builtObjects != null) {
            builtObjectList3 = self.builtObjects.slice();
            for (let num3 = 0; num3 < builtObjectList3.length; num3++) {
                const builtObject5 = builtObjectList3[num3];
                if (builtObject5 != null) {
                    builtObjectCompleteTeardown(galaxy, builtObject5, false);
                    removeFromGalaxyBuiltObjects(galaxy, builtObject5);
                }
            }
            self.builtObjects.length = 0;
        }
    }
    if (self.shipGroups != null) self.shipGroups.length = 0;
    const blockadesForEmpire = getBlockadesForEmpire(galaxy, self);
    if (blockadesForEmpire != null) {
        for (const item of blockadesForEmpire) {
            if (item != null) {
                if (item.targetIsColony) cancelBlockadeColony(galaxy, self, item.colony!);
                else cancelBlockadeBuiltObject(galaxy, self, item.builtObject!);
            }
        }
    }
    // 5170-5174: _ResourceMap._ResourcesKnown = null; _ResourceMap = null.
    if (self.visibility.resourceMap != null) {
        (self.visibility.resourceMap as { resourcesKnown: Uint8Array | null }).resourcesKnown = null;
        (self.visibility as { resourceMap: GalaxyResourceMap | null }).resourceMap = null;
    }
    if (self.troops != null) {
        for (let num4 = 0; num4 < self.troops.count; num4++) {
            const troop = self.troops.items[num4];
            if (troop == null) continue;
            if (conqueror !== null && conqueror.counters !== null) conqueror.counters.processTroopDestruction(troop);
            const troopBuiltObject = troop.builtObject as BuiltObject | null;
            if (troopBuiltObject !== null) {
                if (troopBuiltObject.troops != null) troopBuiltObject.troops.remove(troop);
                troop.builtObject = null;
            }
            const troopColony = troop.colony as Habitat | null;
            if (troopColony !== null) {
                if (troopColony.troops != null) troopColony.troops.remove(troop);
                if (troopColony.troopsToRecruit != null) troopColony.troopsToRecruit.remove(troop);
                if (troopColony.invadingTroops != null) troopColony.invadingTroops.remove(troop);
                troop.colony = null;
            }
            troop.empire = null;
        }
        self.troops.clear();
    }
    if (self.characters != null) {
        const array = (self.characters as Character[]).slice();
        for (const character of array) {
            if (character != null) {
                if (conqueror !== null && conqueror.counters !== null) conqueror.counters.processCharacterDeath(character);
                character.kill(galaxy);
            }
        }
    }
    if (self.outlaws != null) self.outlaws.length = 0;
    self.researchBonusWeaponsStation = null;
    self.researchBonusEnergyStation = null;
    self.researchBonusHighTechStation = null;
    if (self.empireEvaluations != null) {
        const evaluations = self.empireEvaluations as (EmpireEvaluation | null)[];
        for (let num6 = 0; num6 < evaluations.length; num6++) evaluations[num6]?.clear();
        evaluations.length = 0;
    }
    if (self.pirateRelations != null) self.pirateRelations.clear();
    if (self.colonizationTargets != null) {
        for (let num7 = 0; num7 < self.colonizationTargets.length; num7++) habitatPrioritizationClear(self.colonizationTargets[num7]);
        self.colonizationTargets.length = 0;
    }
    if (self.resourceTargets != null) {
        for (let num8 = 0; num8 < self.resourceTargets.length; num8++) habitatPrioritizationClear(self.resourceTargets[num8]);
        self.resourceTargets.length = 0;
    }
    if (self.desiredForeignColonies != null) {
        for (let num9 = 0; num9 < self.desiredForeignColonies.length; num9++) habitatPrioritizationClear(self.desiredForeignColonies[num9]);
        self.desiredForeignColonies.length = 0;
    }
    if (self.empiresWithDesiredColonies != null) self.empiresWithDesiredColonies.length = 0;
    if (self.empiresToAttack != null) self.empiresToAttack.length = 0;
    if (!removeFromGalaxy) return;
    if (galaxy.empires.includes(self)) {
        galaxy.empires.splice(galaxy.empires.indexOf(self), 1);
        if (!galaxy.defeatedEmpires.includes(self)) galaxy.defeatedEmpires.push(self);
    }
    if (galaxy.pirateEmpires.includes(self)) galaxy.pirateEmpires.splice(galaxy.pirateEmpires.indexOf(self), 1);
}

/** HabitatPrioritization.cs 18 Clear(): Habitat = null, AssignedShip = null. */
function habitatPrioritizationClear(item: { habitat: Habitat | null; assignedShip?: unknown } | null): void {
    if (item == null) return;
    item.habitat = null;
    item.assignedShip = null;
}

/** Galaxy.BuiltObjects.Remove(builtObject) (List.Remove: first occurrence; CompleteTeardown already nulled its slot). */
function removeFromGalaxyBuiltObjects(galaxy: Galaxy, builtObject: BuiltObject): void {
    const idx = galaxy.builtObjects.indexOf(builtObject);
    if (idx >= 0) galaxy.builtObjects.splice(idx, 1);
}

/** Galaxy.5.cs 2867 ClearCompletedPlanetDestroyerProjects: drop planet-destroyer project locations whose ship is built or gone. No Rnd. */
export function clearCompletedPlanetDestroyerProjects(galaxy: Galaxy): void {
    const galaxyLocationList: GalaxyLocation[] = [];
    for (let i = 0; i < galaxy.galaxyLocations.length; i++) {
        const galaxyLocation = galaxy.galaxyLocations[i];
        if (galaxyLocation.type === GalaxyLocationType.PlanetDestroyer && galaxyLocation.relatedBuiltObject !== null && (galaxyLocation.relatedBuiltObject.unbuiltComponentCount === 0 || galaxyLocation.relatedBuiltObject.hasBeenDestroyed)) {
            galaxyLocationList.push(galaxyLocation);
        }
    }
    for (const item of galaxyLocationList) removeGalaxyLocation(galaxy, item);
}

/** Galaxy.9.cs 1474 ProcessDelayedEventActions(starDate): story/eventActions.ts (M4z3). */
export function processDelayedEventActions(galaxy: Galaxy, starDate: number): void {
    storyEventActions.processDelayedEventActions(galaxy, starDate);
}

/** Empire.2.cs 3487 ShakturiSendConvoy: story/storyEvents.ts (M4z3). */
export function shakturiSendConvoy(galaxy: Galaxy, empire: Empire): void {
    storyEvents.shakturiSendConvoy(galaxy, empire);
}

/** Empire.2.cs 3508 CheckOfferStoryHint: story/storyEvents.ts (M4z3). */
export function checkOfferStoryHint(galaxy: Galaxy, empire: Empire): void {
    storyEvents.checkOfferStoryHint(galaxy, empire);
}

/** Empire.1.cs 3899 CheckSendShipConvoysViaGateway(timePassed): story/storyEvents.ts (M4z3). */
export function checkSendShipConvoysViaGateway(galaxy: Galaxy, empire: Empire, timePassed: number): void {
    storyEvents.checkSendShipConvoysViaGateway(galaxy, empire, timePassed);
}

// Empire.5.cs 5401 AssignSpecialMissions / 5597 PerformIntelligenceMissions (espionage): ported by M4z2 in espionage.ts.
export { assignSpecialMissions, performIntelligenceMissions } from './espionage';

// Galaxy.1.cs 2935 ReviewAchievements, Galaxy.1.cs 88 CheckVictoryConditions, Empire.1.cs 3969 UpdateAchievements:
// ported by M4z4 in achievements.ts / victory.ts (re-exported here for the tick skeletons).
export { reviewAchievements, updateAchievements } from './achievements';
export { checkVictoryConditions } from './victory';

/**
 * Empire.7.cs 3426 CheckSendPreWarpProgressEventMessage(eventType, subject, empire, hint) (empireEvents.ts). `eventType` is a
 * PreWarpProgressEventType (exploration.ts).
 */
export function checkSendPreWarpProgressEventMessage(galaxy: Galaxy, empire: Empire, eventType: number, subject: unknown, otherEmpire: Empire | null = null, hint = ''): boolean {
    return empireEvents.checkSendPreWarpProgressEventMessage(galaxy, empire, eventType, subject, otherEmpire, hint);
}

/** Habitat.cs 5888 IdentifyLeavingEmpire. No Rnd. */
export function identifyLeavingEmpire(galaxy: Galaxy, habitat: Habitat): Empire | null {
    let result = galaxy.independentEmpire;
    if (habitat.quality > 0.5) {
        if (habitat.invadingTroops !== null && habitat.invadingTroops.count > 0) {
            for (let i = 0; i < habitat.invadingTroops.count; i++) {
                const troop = habitat.invadingTroops.items[i];
                if (troop != null && troop.empire !== null && troop.empire !== galaxy.independentEmpire) {
                    result = troop.empire as Empire;
                    break;
                }
            }
        } else {
            const empireList: Empire[] = [];
            const owner = habitat.owner!;
            for (const diplomaticRelation of owner.diplomaticRelations) {
                const other = diplomaticRelation.otherEmpire!;
                if (diplomaticRelation.type === DiplomaticRelationType.FreeTradeAgreement || diplomaticRelation.type === DiplomaticRelationType.Protectorate || diplomaticRelation.type === DiplomaticRelationType.MutualDefensePact) {
                    if (other !== owner) empireList.push(other);
                } else if (habitat.population != null && habitat.population.dominantRace !== null && other.dominantRace === habitat.population.dominantRace && other !== owner) {
                    empireList.push(other);
                }
            }
            if (empireList.length > 0) {
                let num = Number.MAX_VALUE;
                let habitat3: Habitat | null = null;
                for (const item of empireList) {
                    const habitat2 = fastFindNearestColony(galaxy, Math.trunc(habitat.xpos), Math.trunc(habitat.ypos), item, 0);
                    if (habitat2 !== null) {
                        const num2 = galaxy.calculateDistance(habitat2.xpos, habitat2.ypos, habitat.xpos, habitat.ypos);
                        if (num2 < num) {
                            num = num2;
                            habitat3 = habitat2;
                        }
                    }
                }
                if (habitat3 !== null && num < galaxy.sectorSize * 0.8) result = habitat3.empire;
            }
        }
    }
    return result;
}

/**
 * Habitat.cs 5948 LeaveEmpire (rebellion: the colony joins a friendly / same-race neighbour or becomes independent). No Rnd
 * of its own (TakeOwnershipOfColony / ReviewEmpireAbilityBonuses callees). Called by M4j (CheckSatisfaction, HaveRevolution).
 */
export function leaveEmpire(galaxy: Galaxy, habitat: Habitat): void {
    if (habitat.owner === null || habitat.owner === galaxy.independentEmpire || (habitat.invadingTroops !== null && habitat.invadingTroops.count !== 0)) return;
    habitat.culturalDistressFactor = 0;
    habitat.rebelling = false;
    const empire = identifyLeavingEmpire(galaxy, habitat);
    if (empire !== galaxy.independentEmpire) {
        let description = gameText('Colony Leaves Empire', habitat.name, empire!.name);
        sendMessageToEmpire(habitat.owner, habitat.owner, EmpireMessageType.ColonyLost, habitat, description);
        empire!.takeOwnershipOfColony(habitat, empire);
        description = gameText('Colony Leaves Empire Joins Us', habitat.name);
        sendMessageToEmpire(empire, empire, EmpireMessageType.ColonyGained, habitat, description);
        if (habitat.population == null || habitat.population.dominantRace === null) return;
        const r = reviewEmpireAbilityBonusesFull(galaxy, empire!);
        const list = r.descriptions;
        const raceChanged = r.raceChanged;
        if (list.length <= 0 || raceChanged === null) return;
        let text = gameText('Revolt New Race Ability', resolveDescription(HabitatCategoryType as unknown as Record<number, string>, habitat.category).toLowerCase(), habitat.name, raceChanged.name);
        text += '\n';
        for (const item of list) text = text + '\n' + item;
        const text2 = gameText('New Ability for our Empire');
        sendEventMessageToEmpire(empire!, EventMessageType.NewEmpireRaceAbility, text2, text, raceChanged, habitat);
    } else {
        const description2 = gameText('Colony Leaves Empire Independent', habitat.name);
        sendMessageToEmpire(habitat.owner, habitat.owner, EmpireMessageType.ColonyLost, habitat, description2);
        // TODO(port) M4q: TakeOwnershipOfColony(this, IndependentEmpire, destroyAllBuiltObjectsAndTroopsAtColony: true) — the TS
        // takeOwnershipOfColony has no destroy-bases/troops branch yet (Empire.1.cs 64-370 TODO in empire.ts).
        galaxy.independentEmpire!.takeOwnershipOfColony(habitat, galaxy.independentEmpire);
    }
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

// ---------------------------------------------------------------------------
// Creature.cs 1196-1345 creature combat (CheckForAttackers, CheckForTargets, ScanForTarget, CheckTargetInRange,
// AttackTarget). Creature times are game seconds (creature.ts); DamageTarget is combat damage (combat/damage.ts creatureDamageTarget).
// ---------------------------------------------------------------------------

// StellarObject.Attackers / Pursuers: combat/threats.ts stellarAttackers / stellarPursuers.

/** StellarObject.CurrentSpeed (float; a habitat's is never set → 0). */
function stellarCurrentSpeed(o: StellarObject): number {
    if (isBuiltObject(o) || isCreature(o)) return o.currentSpeed;
    return 0;
}

/** StellarObject.CurrentTarget setter for an attacker (BuiltObject / Creature; habitats never attack). */
function setStellarCurrentTarget(o: StellarObject, target: StellarObject | null): void {
    if (isBuiltObject(o)) o.currentTarget = target;
    else if (isCreature(o)) o.currentTarget = target;
}

/** List.Remove (first occurrence). */
function removeFirstOf<T>(list: T[], item: T): void {
    const i = list.indexOf(item);
    if (i >= 0) list.splice(i, 1);
}

/** Creature.cs 1196 CheckForAttackers. No Rnd. */
export function creatureCheckForAttackers(galaxy: Galaxy, creature: Creature): void {
    void galaxy;
    if (creature.attackers.length <= 0) return;
    creature.currentTarget = creature.attackers[0];
    const pursuers = stellarPursuers(creature.currentTarget);
    if (pursuers !== null && pursuers.indexOf(creature) < 0) pursuers.push(creature);
    creature.targetSpeed = Math.fround(creature.movementSpeed);
}

/** Creature.cs 1206 CheckForTargets. No Rnd (NotifyOfAttack's callees aside). */
export function creatureCheckForTargets(galaxy: Galaxy, creature: Creature): void {
    if (creature.currentTarget !== null || galaxy.deferEventsForGameStart) return;
    const stellarObject = creatureScanForTarget(galaxy, creature);
    if (stellarObject === null) return;
    if (creature.currentTarget !== null) {
        const t = creature.currentTarget as StellarObject;
        const p = stellarPursuers(t);
        if (p !== null) removeFirstOf(p, creature as StellarObject);
        const a = stellarAttackers(t);
        if (a !== null) removeFirstOf(a, creature as StellarObject);
    }
    creature.currentTarget = stellarObject;
    if (isHabitat(stellarObject)) {
        const num1 = creature.xpos - stellarObject.xpos;
        const num2 = creature.ypos - stellarObject.ypos;
        creature.parentHabitat = stellarObject;
        creature.anchorHabitat = creature.parentHabitat;
        creature.parentX = num1;
        creature.parentY = num2;
        creature.parentOffsetX = num1;
        creature.parentOffsetY = num2;
    }
    const pursuers = stellarPursuers(creature.currentTarget);
    if (pursuers !== null && pursuers.indexOf(creature) < 0) pursuers.push(creature);
    creature.targetSpeed = Math.fround(creature.movementSpeed);
    if (isBuiltObject(stellarObject)) notifyOfAttackBuiltObject(galaxy, creature, null, stellarObject, true);
    else if (isHabitat(stellarObject)) notifyOfAttackHabitat(galaxy, creature, null, stellarObject, false, true, true);
}

/** Galaxy.3.cs 1568 FindNearestColonyInSystem(system, x, y). No Rnd. */
function findNearestColonyInSystem(galaxy: Galaxy, systemIndex: number, x: number, y: number): Habitat | null {
    let num = Number.MAX_VALUE;
    let result: Habitat | null = null;
    const habitats = galaxy.systemHabitatsOf(systemIndex);
    for (let i = 0; i < habitats.length; i++) {
        const habitat = habitats[i];
        if (habitat != null && !habitat.hasBeenDestroyed && habitat.empire !== null && habitat.population != null && habitat.population.items.length > 0) {
            const num2 = galaxy.calculateDistance(x, y, habitat.xpos, habitat.ypos);
            if (num2 < num) {
                result = habitat;
                num = num2;
            }
        }
    }
    return result;
}

/** Galaxy.6.cs 2838 FastFindNearestShipInSystem(x, y, systemStar). No Rnd. */
function fastFindNearestShipInSystem(galaxy: Galaxy, x: number, y: number, systemStar: Habitat): BuiltObject | null {
    let result: BuiltObject | null = null;
    let num = Number.MAX_VALUE;
    const builtObjectsAtLocation = getBuiltObjectsAtLocation(galaxy, x, y, MAX_SOLAR_SYSTEM_SIZE * 2);
    for (let i = 0; i < builtObjectsAtLocation.length; i++) {
        const builtObject = builtObjectsAtLocation[i];
        if (builtObject != null && builtObject.nearestSystemStar === systemStar) {
            const num2 = galaxy.calculateDistanceSquared(x, y, builtObject.xpos, builtObject.ypos);
            if (num2 < num) {
                num = num2;
                result = builtObjectsAtLocation[i];
            }
        }
    }
    return result;
}

/** Creature.cs 1245 ScanForTarget. No Rnd. */
function creatureScanForTarget(galaxy: Galaxy, creature: Creature): StellarObject | null {
    if (creature.currentSpeed > creature.movementSpeed) return null;
    let target: StellarObject | null = null;
    if (creature.nearestSystemStar === null) {
        // FindNearestBuiltObject((int)Xpos, (int)Ypos, (Empire)null) (Galaxy.7.cs 795): every built object.
        target = galaxy.findNearestBuiltObject(Math.trunc(creature.xpos), Math.trunc(creature.ypos));
    } else if (creature.type === CreatureType.SilverMist) {
        if (creature.nearestSystemStar.systemIndex >= 0 && creature.nearestSystemStar.systemIndex < galaxy.systems.length) {
            const system = galaxy.systems[creature.nearestSystemStar.systemIndex];
            if (system != null && ((system.independentColonyCount ?? 0) > 0 || (system.dominantEmpire != null && system.dominantEmpire.empire != null))) {
                target = findNearestColonyInSystem(galaxy, creature.nearestSystemStar.systemIndex, creature.xpos, creature.ypos);
            }
        }
        if (target === null) target = fastFindNearestShipInSystem(galaxy, creature.xpos, creature.ypos, creature.nearestSystemStar);
    } else {
        target = fastFindNearestShipInSystem(galaxy, creature.xpos, creature.ypos, creature.nearestSystemStar);
    }
    return target !== null && (target as { empire: Empire | null }).empire !== null && creatureCheckTargetInRange(galaxy, creature, target) ? target : null;
}

/** Creature.cs 1268 CheckTargetInRange(target). No Rnd. */
export function creatureCheckTargetInRange(galaxy: Galaxy, creature: Creature, target: StellarObject): boolean {
    let val2 = creature.anchorRange;
    let num1: number;
    if (target !== null && (!creature.locationLocked || (creature.anchorHabitat === null && creature.anchorPoint === null))) {
        num1 = galaxy.calculateDistance(creature.xpos, creature.ypos, target.xpos, target.ypos);
    } else if (creature.anchorHabitat !== null) {
        num1 = galaxy.calculateDistance(creature.anchorHabitat.xpos, creature.anchorHabitat.ypos, target.xpos, target.ypos);
        if (creature.anchorHabitat.category === HabitatCategoryType.GasCloud) val2 = Math.trunc(creature.anchorHabitat.diameter / 2);
    } else {
        num1 = creature.anchorPoint === null ? galaxy.calculateDistance(creature.xpos, creature.ypos, target.xpos, target.ypos) : galaxy.calculateDistance(creature.anchorPoint.x, creature.anchorPoint.y, target.xpos, target.ypos);
    }
    const num2 = Math.max(creature.attackRange, val2);
    if (num1 < num2) {
        creature.targetSpeed = num1 >= 30.0 ? Math.fround(creature.movementSpeed) : stellarCurrentSpeed(target);
        return true;
    }
    if (creature.currentTarget !== null) {
        const t = creature.currentTarget as StellarObject;
        const p = stellarPursuers(t);
        if (p !== null) removeFirstOf(p, creature as StellarObject);
        const a = stellarAttackers(t);
        if (a !== null) removeFirstOf(a, creature as StellarObject);
    }
    return false;
}

/**
 * Creature.cs 1299 AttackTarget(timePassed, tempNow). `tempNow` in game seconds (creature.ts clock). No Rnd of its own
 * (DamageTarget is M4o's).
 */
export function creatureAttackTarget(galaxy: Galaxy, creature: Creature, timePassed: number, tempNow: number): void {
    creature.isVisible = true;
    if (creature.currentTarget === null || creature.attackStrength <= 0) return;
    let target = creature.currentTarget as StellarObject;
    creature.distanceToTarget = galaxy.calculateDistance(creature.xpos, creature.ypos, target.xpos, target.ypos);
    if (creature.distanceToTarget <= 50.0) {
        creature.targetSpeed = isHabitat(target) ? Math.fround(target.orbitSpeed + 3) : stellarCurrentSpeed(target);
        // Creature.cs 1347 DamageTarget (combat/damage.ts creatureDamageTarget; applies the damage and may destroy the target).
        if (creatureDamageTarget(galaxy, creature, target, Math.max(1, Math.trunc(creature.attackStrength * timePassed)), Math.round(tempNow * 1000), timePassed)) {
            if (!isHabitat(target)) {
                const size = target.size;
                if (creature.size < creature.maxSize) {
                    let num1 = Math.min(4, Math.trunc(size / 50.0));
                    let num2 = Math.trunc(size / 10.0);
                    if (creature.type === CreatureType.SilverMist) {
                        num1 = Math.min(40, Math.trunc(size / 25.0));
                        num2 = Math.trunc(size / 5.0);
                    }
                    creature.attackStrength += num1;
                    creature.size += num2;
                    creature.size = Math.min(creature.size, creature.maxSize);
                    creature.damageKillThreshold += Math.trunc(size / 10.0);
                    creature.damageKillThreshold = Math.min(creature.damageKillThreshold, Math.trunc(creature.size * 3.0));
                }
            }
            // Creature.cs 1329 Galaxy.CheckTriggerEvent(CurrentTarget.GameEventId, null, Destroy, null) (story/eventActions.ts, M4z3).
            storyEventActions.checkTriggerEvent(galaxy, target.gameEventId, null, EventTriggerType.Destroy, null);
            creature.distanceToTarget = Number.MAX_VALUE;
            const attackers = stellarAttackers(target);
            if (attackers !== null) {
                for (const attacker of attackers) setStellarCurrentTarget(attacker, null);
            }
            creature.currentTarget = null;
            creature.parentHabitat = creature.anchorHabitat;
        }
        if (creature.currentTarget === null) return;
        target = creature.currentTarget as StellarObject;
        const targetAttackers = stellarAttackers(target);
        if (targetAttackers === null || targetAttackers.indexOf(creature) >= 0) return;
        targetAttackers.push(creature);
    } else {
        creature.targetSpeed = Math.fround(creature.movementSpeed);
    }
}

// ---- entry points added by M4o (called from combat/damage.ts and combat/teardown.ts); ported ----

/**
 * Habitat.cs 6399 DoPlanetDestroyAsteroidField (started on a Thread by DoExplosion, Habitat.cs 6361; run inline in TS, plan §0):
 * a destroyed non-asteroid habitat leaves an asteroid field of Diameter/2 + (int)(NextDouble × Diameter × 0.125) asteroids,
 * rounded up to the next multiple of 8, in the orbit of the nearest system, inserted next to the destroyed habitat's star.
 * Rnd: NextDouble; GenerateAsteroidField (per asteroid Next(10,25), Next(0,30)[, Next(26,45)], Next(0,10), NextDouble ×4
 * [+ NextDouble ×2], GenerateCodeName, SelectResources, SelectHabitatPictures, Next(0,1300)[→ treasure]). The resource
 * order is shuffled on Galaxy.CryptoRnd (ResourceSystem.cs 225), not Galaxy.Rnd.
 */
export function doPlanetDestroyAsteroidField(galaxy: Galaxy, habitat: Habitat): void {
    // lock (_Galaxy._LockObject): no-op single-threaded.
    if (habitat.category !== HabitatCategoryType.Asteroid) {
        let num = Math.trunc(habitat.diameter / 2) + Math.trunc(galaxy.rnd.nextDouble() * habitat.diameter * 0.125);
        num = (Math.trunc(num / 8) + 1) * 8;
        const nearestSystemStar = galaxy.determineHabitatSystemStar(habitat);
        const randomOrderedResources = galaxy['generateRandomOrderedResources']();
        const habitatList = generateAsteroidFieldNearestSystem(galaxy, num, habitat.xpos, habitat.ypos, habitat.orbitDirection, habitat.orbitSpeed, 1.3, 0.8, randomOrderedResources);
        galaxy.addAsteroidField(habitatList, nearestSystemStar);
        // _Galaxy.OnRefreshView(new RefreshViewEventArgs(Xpos, Ypos, habitatList, false)): UI event, no sim effect.
    }
}

/**
 * Galaxy.9.cs 3463 GenerateAsteroidField(asteroidCount, x, y, orbitDirection, orbitSpeed, distanceSpreadFactor,
 * arcSpreadFactor, randomOrderedResources): orbit the nearest parentless habitat (FindNearestSystemGasCloudAsteroid) at
 * its (int) distance, BarrenRock, then the 3482 overload. Rnd: as the 3482 overload.
 */
function generateAsteroidFieldNearestSystem(galaxy: Galaxy, asteroidCount: number, x: number, y: number, orbitDirection: boolean, orbitSpeed: number, distanceSpreadFactor: number, arcSpreadFactor: number, randomOrderedResources: ReturnType<Galaxy['generateRandomOrderedResources']>): Habitat[] {
    const habitat = findNearestSystemGasCloudAsteroid(galaxy, x, y)!;
    const orbitDistance = Math.trunc(galaxy.calculateDistance(habitat.xpos, habitat.ypos, x, y));
    return galaxy['generateAsteroidFieldAt'](asteroidCount, x, y, habitat, orbitDirection, orbitSpeed, orbitDistance, distanceSpreadFactor, arcSpreadFactor, HabitatType.BarrenRock, randomOrderedResources);
}

/**
 * Galaxy.6.cs 3714 FindNearestSystemGasCloudAsteroid(double x, double y) + 2814 FindNearestSystemGasCloudAsteroidInIndex:
 * ring search of HabitatIndex for the nearest habitat with Parent == null (stars, gas clouds, system-level asteroid
 * fields), distances from the (int)-truncated point. No Rnd. (galaxy.ts has a private generation-time stand-in of the same
 * name that filters on GasCloud/Asteroid category instead; this is the C# runtime search.)
 */
export function findNearestSystemGasCloudAsteroid(galaxy: Galaxy, x: number, y: number): Habitat | null {
    const ix = Math.trunc(x);
    const iy = Math.trunc(y);
    if (galaxy.habitatIndexGrid.length === 0) {
        // Galaxies built without the index grids (unit-test fixtures): same nearest-parentless search, linear.
        let best: Habitat | null = null;
        let bestDistance = Number.MAX_VALUE;
        for (const h of galaxy.habitats) {
            if (h.parent !== null) continue;
            const d = galaxy.calculateDistanceSquared(ix, iy, h.xpos, h.ypos);
            if (d < bestDistance) {
                best = h;
                bestDistance = d;
            }
        }
        return best;
    }
    return galaxy.ringSearch<Habitat>(x, y, (cx, cy) => {
        let habitat: Habitat | null = null;
        let distance = Number.MAX_VALUE;
        const habitatList = galaxy.habitatIndexGrid[cx][cy];
        for (let i = 0; i < habitatList.length; i++) {
            if (habitatList[i].parent === null) {
                const num = galaxy.calculateDistanceSquared(ix, iy, habitatList[i].xpos, habitatList[i].ypos);
                if (num < distance) {
                    habitat = habitatList[i];
                    distance = num;
                }
            }
        }
        if (habitat !== null) distance = galaxy.calculateDistance(ix, iy, habitat.xpos, habitat.ypos);
        return { item: habitat, distance };
    });
}

/**
 * Galaxy.2.cs 4980 ChanceRaceEvent(targetDestroyed, destroyer) (BuiltObject.2.cs 6577; ported at the wave-4 merge, when the
 * merged harness first destroyed a warship). Rnd: Next(0, num) [+ NextDouble].
 */
export function chanceRaceEvent(galaxy: Galaxy, targetDestroyed: BuiltObject | null, destroyer: BuiltObject | null): boolean {
    if (targetDestroyed !== null && destroyer !== null && shipGroupOfBuiltObject(destroyer) !== null) {
        let num = 0;
        if (targetDestroyed.subRole === BuiltObjectSubRole.MediumSpacePort) num = 6;
        if (targetDestroyed.subRole === BuiltObjectSubRole.LargeSpacePort) num = 3;
        if (targetDestroyed.subRole === BuiltObjectSubRole.Carrier) num = 10;
        else if (targetDestroyed.subRole === BuiltObjectSubRole.ResupplyShip) num = 6;
        else if (targetDestroyed.subRole === BuiltObjectSubRole.CapitalShip) {
            num = 8;
            if (targetDestroyed.isPlanetDestroyer || targetDestroyed.size > 2000) num = 2;
        }
        const destroyerEmpire = destroyer.empire;
        if (
            num > 0 &&
            galaxy.rnd.next(0, num) === 1 &&
            destroyerEmpire !== null &&
            empireWarWeariness(destroyerEmpire) !== 0.0 &&
            destroyerEmpire.dominantRace !== null &&
            empireEvents.raceEventsContainsEventType(destroyerEmpire.dominantRace, RaceEventType.NeverSurrenderWarWearinessReset)
        ) {
            const num2 = 0.4 + galaxy.rnd.nextDouble() * 0.2;
            destroyerEmpire.warWearinessRaw *= num2;
            const title = resolveDescription(RaceEventType as unknown as Record<number, string>, RaceEventType.NeverSurrenderWarWearinessReset);
            const message = gameText('Race Event Description NeverSurrenderWarWearinessReset', shipGroupOfBuiltObject(destroyer)!.name);
            sendEventMessageToEmpire(destroyerEmpire, EventMessageType.RaceEvent, title, message, RaceEventType.NeverSurrenderWarWearinessReset, destroyer);
            return true;
        }
    }
    return false;
}

/**
 * Galaxy.2.cs 5022 ChanceNewShipCaptain(targetDestroyed, empire, location) → 5027 (…, targetCaptured, smuggler) (ported at the
 * wave-4 merge; the captured overload is M4q's boarding caller). Rnd: Next(0, num) [+ GenerateNewCharacter draws].
 */
export function chanceNewShipCaptain(galaxy: Galaxy, targetDestroyed: BuiltObject | null, empire: Empire | null, location: BuiltObject | Habitat | null, targetCaptured = false, smuggler = false): boolean {
    if (targetDestroyed !== null && empire !== null && location !== null && !location.hasBeenDestroyed) {
        let num = 0;
        if (targetDestroyed.role === BuiltObjectRole.Base && targetDestroyed.size > 500) num = 7;
        if (targetDestroyed.subRole === BuiltObjectSubRole.MediumSpacePort) num = 6;
        if (targetDestroyed.subRole === BuiltObjectSubRole.LargeSpacePort) num = 3;
        if (targetDestroyed.subRole === BuiltObjectSubRole.Carrier) num = 8;
        else if (targetDestroyed.subRole === BuiltObjectSubRole.Cruiser) num = 11;
        else if (targetDestroyed.subRole === BuiltObjectSubRole.Destroyer) num = 25;
        else if (targetDestroyed.subRole === BuiltObjectSubRole.ResupplyShip) num = 7;
        else if (targetDestroyed.subRole === BuiltObjectSubRole.CapitalShip) {
            num = 5;
            if (targetDestroyed.isPlanetDestroyer || targetDestroyed.size > 2000) num = 2;
        }
        if (num > 0) {
            if (empire.dominantRace !== null) num = Math.max(2, csDoubleToIntEv(num / empire.dominantRace.characterRandomAppearanceChanceShipCaptain));
            if (galaxy.rnd.next(0, num) === 1 && charactersCanGenerateAmountNonIntelligenceAgent(empire) > 0) {
                const character = generateNewCharacter(galaxy, empire, CharacterRole.ShipCaptain, location).character;
                if (smuggler) character.addTrait(CharacterTraitType.Smuggler, true, galaxy);
                const title = gameText('New Character Event Title', resolveDescription(CharacterRole as unknown as Record<number, string>, character.role));
                const description = !targetCaptured
                    ? gameText('New Character Event Ship Captain', targetDestroyed.name, character.name)
                    : !smuggler
                      ? gameText('New Character Event Ship Captain Capture', targetDestroyed.name, character.name)
                      : gameText('New Character Event Ship Captain Smuggler Capture', targetDestroyed.name, character.name);
                sendMessageToEmpireWithTitle(empire, empire, EmpireMessageType.CharacterAppearance, character, description, title);
                return true;
            }
        }
    }
    return false;
}

/**
 * Galaxy.2.cs 5092 ChanceNewFleetAdmiral(targetDestroyed, empire, location) → 5097 (…, targetCaptured) (ported at the wave-4
 * merge). Rnd: Next(0, num) [+ GenerateNewCharacter draws].
 */
export function chanceNewFleetAdmiral(galaxy: Galaxy, targetDestroyed: BuiltObject | null, empire: Empire | null, location: BuiltObject | Habitat | null, targetCaptured = false): boolean {
    if (targetDestroyed !== null && empire !== null && location !== null && !location.hasBeenDestroyed) {
        let num = 0;
        if (targetDestroyed.role === BuiltObjectRole.Base && targetDestroyed.empire !== null && targetDestroyed.empire.pirateEmpireBaseHabitat !== null) num = 10;
        if (targetDestroyed.subRole === BuiltObjectSubRole.MediumSpacePort) num = 8;
        if (targetDestroyed.subRole === BuiltObjectSubRole.LargeSpacePort) num = 4;
        if (targetDestroyed.subRole === BuiltObjectSubRole.Carrier) num = 12;
        else if (targetDestroyed.subRole === BuiltObjectSubRole.Cruiser) num = 16;
        else if (targetDestroyed.subRole === BuiltObjectSubRole.Destroyer) num = 40;
        else if (targetDestroyed.subRole === BuiltObjectSubRole.ResupplyShip) num = 10;
        else if (targetDestroyed.subRole === BuiltObjectSubRole.CapitalShip) {
            num = 8;
            if (targetDestroyed.isPlanetDestroyer || targetDestroyed.size > 2000) num = 2;
        }
        if (num > 0 && galaxy.rnd.next(0, num) === 1 && charactersCanGenerateAmountNonIntelligenceAgent(empire) > 0) {
            const character = generateNewCharacter(galaxy, empire, CharacterRole.FleetAdmiral, location).character;
            const title = gameText('New Character Event Title', resolveDescription(CharacterRole as unknown as Record<number, string>, character.role));
            const description = !targetCaptured
                ? gameText('New Character Event Fleet Admiral', targetDestroyed.name, character.name)
                : gameText('New Character Event Fleet Admiral Capture', targetDestroyed.name, character.name);
            sendMessageToEmpireWithTitle(empire, empire, EmpireMessageType.CharacterAppearance, character, description, title);
            return true;
        }
    }
    return false;
}

/** C# (int)double: truncation (the operands here are finite and small). */
function csDoubleToIntEv(v: number): number {
    return Math.trunc(v);
}
