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
import { EventMessageType, DisasterEventType, RaceEventType, raceImmuneToPlagues, galaxyPlagues, getPlagueUnhappinessFactorWithPlague } from './eventTypes';
export { EventMessageType, DisasterEventType, RaceEventType, raceImmuneToPlagues, galaxyPlagues, getPlagueUnhappinessFactorWithPlague };
import * as empireEvents from './empireEvents';
import type { Race } from './data/races';
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
                        builtObjectInflictDamage(galaxy, builtObject2, builtObject2, null, 1000000.0, galaxyNow(galaxy), 0, false, 0.0, false);
                    }
                    for (let n = 0; n < habitat.basesAtHabitat.length; n++) {
                        const builtObject3 = habitat.basesAtHabitat[n];
                        // TODO(port) M4o: InflictDamage (BuiltObject.2.cs 6221) — stub, no damage applied.
                        if (builtObject3 != null) builtObjectInflictDamage(galaxy, builtObject3, builtObject3, null, 1000000.0, galaxyNow(galaxy), 0, false, 0.0, false);
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

/**
 * Empire.7.cs 3426 CheckSendPreWarpProgressEventMessage(eventType, subject, empire, hint) (empireEvents.ts). `eventType` is a
 * PreWarpProgressEventType (exploration.ts).
 */
export function checkSendPreWarpProgressEventMessage(galaxy: Galaxy, empire: Empire, eventType: number, subject: unknown, otherEmpire: Empire | null = null, hint = ''): boolean {
    return empireEvents.checkSendPreWarpProgressEventMessage(galaxy, empire, eventType, subject, otherEmpire, hint);
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
