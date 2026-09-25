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

import type { Galaxy } from './galaxy';
import type { Empire } from './empire';
import type { BuiltObject } from './builtObject';
import type { Habitat } from './types';
import { registerTodo, todo } from './tick/todo';
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
import { doCharacterEventForList, type Character, type CharacterEventType } from './characters';
import * as characterRuntime from './characterRuntime';
import { EventMessageType, DisasterEventType, RaceEventType, raceImmuneToPlagues, galaxyPlagues, getPlagueUnhappinessFactorWithPlague } from './eventTypes';
export { EventMessageType, DisasterEventType, RaceEventType, raceImmuneToPlagues, galaxyPlagues, getPlagueUnhappinessFactorWithPlague };
import * as empireEvents from './empireEvents';
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
import { HabitatCategoryType } from './types';
import type { PlagueStatic } from './researchSystem';
import type { Population } from './population';
import { gameText } from './colonyTick';
import { CreatureType } from './creature';
import { REAL_SECONDS_IN_GALACTIC_YEAR, galaxyNow } from './tick/simTime';
import { EmpireMessageType, sendMessageToEmpire } from './messages';
import { clearColony } from './combat/invasion';

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
        // TODO(port) M4o: InflictDamage (BuiltObject.2.cs 6221) — stub, no damage applied.
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
            // TODO(port) M4o: InflictDamage (BuiltObject.2.cs 6221) — stub, no damage applied.
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
                        // TODO(port) M4o: InflictDamage (BuiltObject.2.cs 6221) — stub, no damage applied (the C# destroys the base).
                        inflictDamageFull(galaxy, builtObject2, builtObject2, null, 1000000.0, galaxyNow(galaxy), 0, false, 0.0, false);
                    }
                    for (let n = 0; n < habitat.basesAtHabitat.length; n++) {
                        const builtObject3 = habitat.basesAtHabitat[n];
                        // TODO(port) M4o: InflictDamage (BuiltObject.2.cs 6221) — stub, no damage applied.
                        if (builtObject3 != null) inflictDamageFull(galaxy, builtObject3, builtObject3, null, 1000000.0, galaxyNow(galaxy), 0, false, 0.0, false);
                    }
                    // TODO(port) M4q: ClearColony(null, sendMessages: true, removeEmpireWhenNoColonies: true) (Habitat.cs 7450) — stub.
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
    // TODO(port) M4q: ClearColony(TeardownEmpire) (Habitat.cs 7450) — stub.
    clearColony(galaxy, habitat, habitat.teardownEmpire);
    galaxy.orders.updateHabitatIndexes(habitat.habitatIndex, -1);
    for (let i = 0; i < galaxy.builtObjects.length; i++) {
        const builtObject = galaxy.builtObjects[i];
        if (builtObject != null && builtObject.parentHabitat === habitat) {
            if (builtObject.role === BuiltObjectRole.Base || builtObject.dockedAt === habitat || builtObject.builtAt === habitat) {
                clearPreviousMissionRequirements(galaxy, builtObject);
                // TODO(port) M4o: BuiltObject.CompleteTeardown(galaxy, removeFromEmpire: true) — stub.
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
                // TODO(port) M4l: ShipGroup.CompleteMission — stub.
                if (mission.targetHabitat !== null && mission.targetHabitat === habitat) shipGroupCompleteMission(galaxy, shipGroup);
                if (mission.secondaryTargetHabitat !== null && mission.secondaryTargetHabitat === habitat) shipGroupCompleteMission(galaxy, shipGroup);
            }
        }
    }
    for (let m = 0; m < galaxy.builtObjects.length; m++) {
        const builtObject2 = galaxy.builtObjects[m];
        if (builtObject2 == null) continue;
        // TODO(port) M4b: BuiltObject.ClearAllMissionsForTarget(builtObject2, this, Undefined, dropOutOfHyperspace: true) — stub.
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
            // Habitat.cs 7903-7988: a system star's teardown (SystemsIndex, per-empire SystemVisibility / SystemsVisible).
            // Only Galaxy.RemoveSystem tears a star down (RemoveHabitat refuses stars) — not reachable from M4u.
            throw new Error('TODO(port): Habitat.cs 7903 CompleteTeardown of a system star (Galaxy.RemoveSystem)');
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
 * Empire.cs 4874/4879 CompleteTeardown(conqueror[, removeFromGalaxy, sendMessages]) — an eliminated empire: news broadcast,
 * relations / evaluations / pirate relations removed from every other empire, blockades and attacks cancelled, fleets
 * dissolved, ships and cargo handed to the conqueror, colonies / characters / research cleaned up, removal from the galaxy
 * lists. TODO(port) M4u: not ported — its only caller, Empire.TakeOwnershipOfColony's "last colony lost" branch
 * (Empire.1.cs 216/221), is itself unported (M4q), and most of what it touches (EmpireCounters.ProcessEmpireElimination,
 * CancelBlockades, ClearPirateColonyFacilities, TakeOwnershipOfCargo / TakeOwnershipOfBuiltObject, ShipGroup.GatherPoint)
 * has no TS model yet. Throws so a caller cannot silently leave a defeated empire active.
 */
export function empireCompleteTeardown(galaxy: Galaxy, empire: Empire, conqueror: Empire | null, removeFromGalaxy = true, sendMessages = true): void {
    void galaxy;
    void empire;
    void conqueror;
    void removeFromGalaxy;
    void sendMessages;
    throw new Error('TODO(port) M4u: Empire.cs 4879 CompleteTeardown (empire elimination)');
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

/**
 * Galaxy.9.cs 1474 ProcessDelayedEventActions(starDate): returns at once while Galaxy.DelayedActions is empty. Only scripted
 * game events (deferred, plan §0.3) fill that list, so it is always empty here.
 */
const T_processDelayedEventActions = registerTodo('deferred', 'processDelayedEventActions');
export function processDelayedEventActions(galaxy: Galaxy, starDate: number): void {
    void galaxy;
    void starDate;
    // Counted as a deferred hit (the ExecuteEventAction half, Galaxy.9.cs 1503-2860, is not ported); the tick-structure
    // tests use the count as the DoTasksTimeSensitive marker.
    todo(T_processDelayedEventActions);
}

/**
 * Empire.2.cs 3487 ShakturiSendConvoy (story): returns before its Rnd.Next(0, 3) unless this empire is the Shakturi story
 * empire (Galaxy.IdentifyShakturiEmpire needs Galaxy.ShakturiActualRace, only set by the "Return of the Shakturi" story —
 * deferred, plan §0.3). Throws if the story were enabled.
 */
export function shakturiSendConvoy(galaxy: Galaxy, empire: Empire): void {
    void empire;
    if (galaxy.storyReturnOfTheShakturiEnabled) throw new Error('TODO(port) deferred (story events, plan §0.3): Empire.2.cs 3487 ShakturiSendConvoy');
}

/**
 * Empire.2.cs 3508 CheckOfferStoryHint (story): returns at once unless the "Return of the Shakturi" or "Distant Worlds"
 * story is enabled (deferred, plan §0.3; throws if enabled).
 */
export function checkOfferStoryHint(galaxy: Galaxy, empire: Empire): void {
    if ((!galaxy.storyReturnOfTheShakturiEnabled && !galaxy.storyDistantWorldsEnabled) || galaxy.playerEmpire === null || empire.dominantRace === null) return;
    throw new Error('TODO(port) deferred (story events, plan §0.3): Empire.2.cs 3508 CheckOfferStoryHint');
}

/**
 * Port of Empire.1.cs 3899 CheckSendShipConvoysViaGateway(timePassed): only a colony with a RaceAchievement wonder whose Value2
 * is 3 (the story gateway) sends convoys. Without one the C# returns before any draw. With one it draws Rnd.Next(0, 10) etc.
 * and calls Galaxy.GenerateMilitaryConvoy / GenerateCivilianConvoy (story content, deferred per plan §0.3), so that branch
 * throws.
 */
export function checkSendShipConvoysViaGateway(galaxy: Galaxy, empire: Empire, timePassed: number): void {
    void galaxy;
    void timePassed;
    let flag = false;
    if (empire.colonies != null) {
        for (let i = 0; i < empire.colonies.length; i++) {
            const habitat = empire.colonies[i];
            if (habitat == null || habitat.facilities == null) continue;
            for (let j = 0; j < habitat.facilities.length; j++) {
                const planetaryFacility = habitat.facilities[j];
                if (planetaryFacility != null && planetaryFacility.type === PlanetaryFacilityType.Wonder && planetaryFacility.wonderType === WonderType.RaceAchievement && planetaryFacility.value2 === 3) {
                    flag = true;
                    break;
                }
            }
            if (flag) break;
        }
    }
    if (!flag) return;
    // Empire.1.cs 3931-3955: supportCostFactor (Shakturi 0.2), Rnd.Next(0, 10) < 8 → Rnd.Next(0, 3) → Rnd.Next(7, 22) convoy.
    throw new Error('TODO(port) deferred (story events, plan §0.3): Empire.1.cs 3937 GenerateMilitaryConvoy/GenerateCivilianConvoy (gateway convoys)');
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

/**
 * Empire.7.cs 3426 CheckSendPreWarpProgressEventMessage(eventType, subject, empire, hint) (empireEvents.ts). `eventType` is a
 * PreWarpProgressEventType (exploration.ts).
 */
export function checkSendPreWarpProgressEventMessage(galaxy: Galaxy, empire: Empire, eventType: number, subject: unknown, otherEmpire: Empire | null = null, hint = ''): boolean {
    return empireEvents.checkSendPreWarpProgressEventMessage(galaxy, empire, eventType, subject, otherEmpire, hint);
}

/** Habitat.cs 5888 IdentifyLeavingEmpire. No Rnd. */
function identifyLeavingEmpire(galaxy: Galaxy, habitat: Habitat): Empire | null {
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
// AttackTarget). Creature times are game seconds (creature.ts); DamageTarget is combat damage (M4o stub).
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
        // TODO(port) M4o: Creature.cs 1347 DamageTarget — stub (no damage, never destroys the target).
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
            // Galaxy.CheckTriggerEvent(CurrentTarget.GameEventId, null, Destroy, null): scripted game events are deferred
            // (plan §0.3; no object carries a GameEventId in a normal game).
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

// ---- stubs added by M4o (called from combat/damage.ts and combat/teardown.ts) ----

const T_doPlanetDestroyAsteroidField = registerTodo('M4u', 'doPlanetDestroyAsteroidField');
/** Habitat.cs DoPlanetDestroyAsteroidField (started on a Thread by DoExplosion, Habitat.cs 6365) — stub. */
export function doPlanetDestroyAsteroidField(galaxy: Galaxy, habitat: Habitat): void {
    // RND: asteroid field generation draws — not drawn until M4u.
    /* TODO(port) M4u */ todo(T_doPlanetDestroyAsteroidField);
}

const T_chanceRaceEvent = registerTodo('M4u', 'chanceRaceEvent');
/** Galaxy.9.cs ChanceRaceEvent(builtObjectDestroyed, destroyer) (BuiltObject.2.cs 6577; race events, Empire.1.cs 1731-2881) — stub. */
export function chanceRaceEvent(galaxy: Galaxy, builtObjectDestroyed: BuiltObject, destroyer: BuiltObject): void {
    void galaxy; void builtObjectDestroyed; void destroyer;
    // RND: race event chance draws — not drawn until M4u.
    /* TODO(port) M4u */ todo(T_chanceRaceEvent);
}

const T_chanceNewShipCaptain = registerTodo('M4u', 'chanceNewShipCaptain');
/** Galaxy.2.cs 5022 ChanceNewShipCaptain(targetDestroyed, empire, location) → 5027 — stub: false (no captain appears). */
export function chanceNewShipCaptain(galaxy: Galaxy, targetDestroyed: BuiltObject, empire: Empire | null, location: BuiltObject | Habitat | null): boolean {
    void galaxy; void targetDestroyed; void empire; void location;
    // RND: Rnd.Next(0, num) — not drawn until M4u.
    /* TODO(port) M4u */ todo(T_chanceNewShipCaptain);
    return false;
}

const T_chanceNewFleetAdmiral = registerTodo('M4u', 'chanceNewFleetAdmiral');
/** Galaxy.2.cs 5092 ChanceNewFleetAdmiral(targetDestroyed, empire, location) → 5097 — stub: false. */
export function chanceNewFleetAdmiral(galaxy: Galaxy, targetDestroyed: BuiltObject, empire: Empire | null, location: BuiltObject | Habitat | null): boolean {
    void galaxy; void targetDestroyed; void empire; void location;
    // RND: Rnd.Next(0, num) — not drawn until M4u.
    /* TODO(port) M4u */ todo(T_chanceNewFleetAdmiral);
    return false;
}
