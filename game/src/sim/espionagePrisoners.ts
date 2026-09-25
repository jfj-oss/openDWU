// M4z2 — the Bacon mod's captured spies: BaconCharacter.Kill's capture / ransom branch (reached only when the caller two
// frames up is Empire.PerformIntelligenceMissions), the "capturedSpies" prison lists (Habitat / BuiltObject BaconValues)
// and their escape / defection / ransom handling.
//
// C# sources: BaconCharacter.cs 31 Kill, 112 GetCharacterValue, 125 GetSpyTargetEmpire, 142 AddEventToCharacter;
//   BaconHabitat.cs 566 GetSpiesInPrison, 575 HandlePlayerPrisoners, 608 HandleAIPrisoners, 654 ShouldRansomSpy,
//   662 SpyEscaped, 703 SpyDefected; BaconBuiltObject.cs 4097-4260 (the same for ships).
//
// Every `new Random()` here is clock-seeded in the C#; they share one galaxy-seed-derived stream (plan §0):
// galaxy.baconSpyClockRnd. All handlers keep the C# try/catch semantics: a NullReferenceException (or the
// InvalidOperationException of a `foreach` over a list modified inside the loop) ends the handler silently.

import type { Galaxy } from './galaxy';
import type { Empire } from './empire';
import type { BuiltObject } from './builtObject';
import type { Habitat } from './types';
import { Random } from './random';
import { Character, CharacterEvent, CharacterEventType, CharacterRole, ensureStellarObjectCharacters, getEmpireCharacters, stellarObjectCharacters } from './characters';
import { EmpireMessageType, sendMessageToEmpire } from './messages';
import { galaxyCurrentStarDate } from './pirateRelations';
import { DiplomaticRelationType, obtainDiplomaticRelation } from './diplomacy';
import { csInt } from './builtObjectComponent';
import { characterMission, intelligenceMissionTarget, newCounterIntelligenceMission } from './espionage';
import { BuiltObject as BuiltObjectClass } from './builtObject';
import { Habitat as HabitatClass } from './types';

/** BaconCharacter.cs 18-21 (BaconSettings.txt keys spyCaptureChance / spyBaseValue / capturedSpyEscapeChance / capturedSpyDefectChance; defaults kept). */
export const SPY_CAPTURE_CHANCE = Math.fround(1);
export const SPY_BASE_VALUE = 25000;
export const SPY_BASE_ESCAPE_CHANCE = 0.02;
export const SPY_BASE_DEFECT_CHANCE = 0.02;

/** A C# exception inside a Bacon try block (caught and ignored by the caller). */
class CsException extends Error {}
function nre(): never {
    throw new CsException('NullReferenceException');
}

/** The clock-seeded `new Random()` instances of the spy code: one galaxy-seed-derived stream (plan §0). */
function spyClockRnd(galaxy: Galaxy): Random {
    if (galaxy.baconSpyClockRnd === null) galaxy.baconSpyClockRnd = new Random((galaxy.randomSeed ^ 0x05b1ca7e) | 0);
    return galaxy.baconSpyClockRnd;
}

// ---------------------------------------------------------------------------------------------------------------
// List<Character> version tracking (List<T>.Enumerator.MoveNext throws InvalidOperationException after a modification)
// ---------------------------------------------------------------------------------------------------------------

const listVersions = new WeakMap<Character[], number>();
function version(list: Character[]): number {
    return listVersions.get(list) ?? 0;
}
function bump(list: Character[]): void {
    listVersions.set(list, version(list) + 1);
}
function listAdd(list: Character[], c: Character): void {
    list.push(c);
    bump(list);
}
/** List<T>.Remove: removes the first match; the version changes only when something was removed. */
function listRemove(list: Character[], c: Character): boolean {
    const i = list.indexOf(c);
    if (i < 0) return false;
    list.splice(i, 1);
    bump(list);
    return true;
}
/** C# `foreach (var c in list)`: throws (InvalidOperationException) on MoveNext once the list was modified. */
function csForEach(list: Character[], body: (c: Character) => void): void {
    const v = version(list);
    for (let i = 0; ; i++) {
        if (version(list) !== v) throw new CsException('InvalidOperationException');
        if (i >= list.length) break;
        body(list[i]);
    }
}

type Prison = Habitat | BuiltObject;

/** BaconHabitat.cs 566 / BaconBuiltObject.cs 4097 GetSpiesInPrison: BaconValues["capturedSpies"] or null. */
export function getSpiesInPrison(o: { baconValues: Map<string, unknown> | null }): Character[] | null {
    if (o.baconValues === null) return null;
    const baconValues = o.baconValues;
    return !baconValues.has('capturedSpies') ? null : (baconValues.get('capturedSpies') as Character[]);
}

/** `x.BaconValues["capturedSpies"]` as an indexer read (KeyNotFoundException / NullReferenceException when absent). */
function prisonListStrict(o: Prison | null | undefined): Character[] {
    if (o == null || o.baconValues === null) nre();
    if (!o.baconValues.has('capturedSpies')) throw new CsException('KeyNotFoundException');
    return o.baconValues.get('capturedSpies') as Character[];
}

/** `if (o.BaconValues == null) o.BaconValues = new Dictionary(); list = has ? get : new List()`. */
function obtainPrisonList(o: Prison): Character[] {
    if (o.baconValues === null) o.baconValues = new Map<string, unknown>();
    return !o.baconValues.has('capturedSpies') ? [] : (o.baconValues.get('capturedSpies') as Character[]);
}

/** Empire.BuiltObjects[0] (ArgumentOutOfRangeException when empty). */
function firstBuiltObject(empire: Empire | null): BuiltObject {
    if (empire === null) nre();
    if (empire.builtObjects.length === 0) throw new CsException('ArgumentOutOfRangeException');
    return empire.builtObjects[0];
}

// ---------------------------------------------------------------------------------------------------------------
// BaconCharacter.cs
// ---------------------------------------------------------------------------------------------------------------

/** BaconCharacter.cs 112 GetCharacterValue(character): the ransom price. */
export function getCharacterValue(character: Character): number {
    let num = Math.fround(0);
    if (character.empire === null) nre();
    let d = character.empire.stateMoney / SPY_BASE_VALUE;
    if (d > 1.0) d = Math.sqrt(d);
    for (const skill of character.skills.items) num = Math.fround(num + skill.level);
    return Math.max(Math.trunc(SPY_BASE_VALUE / 2), csInt((1.0 + num / 100.0) * d * SPY_BASE_VALUE));
}

/** BaconCharacter.cs 125 GetSpyTargetEmpire(spy). */
export function getSpyTargetEmpire(spy: Character): Empire | null {
    let spyTargetEmpire: Empire | null = null;
    const mission = characterMission(spy);
    if (mission === null) return spyTargetEmpire;
    const target = intelligenceMissionTarget(mission);
    if (mission.targetEmpire !== null) spyTargetEmpire = mission.targetEmpire;
    else if (target instanceof BuiltObjectClass) spyTargetEmpire = target.actualEmpire;
    else if (target instanceof Character) spyTargetEmpire = target.empire;
    else if (target instanceof HabitatClass) spyTargetEmpire = target.empire;
    return spyTargetEmpire;
}

/** BaconCharacter.cs 142 AddEventToCharacter(title, description, character): an IntelligenceAgentOursCaptured event with a "spyMessage". */
export function addEventToCharacter(galaxy: Galaxy, title: string, description: string, character: Character): CharacterEvent {
    void character;
    const data = new Map<string, unknown>([['spyMessage', [title, description]]]);
    return new CharacterEvent(CharacterEventType.IntelligenceAgentOursCaptured, data, galaxyCurrentStarDate(galaxy));
}

/** Remove a captured spy from its empire's and its location's character lists (BaconCharacter.cs 78-81 / 94-97). */
function removeFromEmpireAndLocation(character: Character): void {
    if (character.empire !== null) {
        const ec = getEmpireCharacters(character.empire);
        const i = ec.indexOf(character);
        if (i >= 0) ec.splice(i, 1);
    }
    if (character.location !== null) {
        const lc = stellarObjectCharacters(character.location);
        if (lc !== null) {
            const j = lc.indexOf(character);
            if (j >= 0) lc.splice(j, 1);
        }
    }
}

/**
 * Character.Kill(galaxy) called from Empire.PerformIntelligenceMissions: BaconCharacter.cs 31 Kill with
 * `new StackFrame(2).GetMethod().Name == "PerformIntelligenceMissions"`. Between two AI empires the spy's empire pays a
 * ransom to the target (and the spy lives on with its mission); when the player is either side the spy goes to the
 * target's prison (capital, or the pirate faction's first ship) instead of dying. Otherwise Character.Kill completes.
 * Rnd: one draw on the spy clock stream (spyCaptureChance 1f > NextDouble — always true at the default).
 */
export function characterKillFromPerformIntelligenceMissions(galaxy: Galaxy, character: Character): void {
    let flag1 = true;
    if (character.empire !== null && character.empire.name.includes('Romulan')) {
        if (character.role === CharacterRole.IntelligenceAgent) flag1 = false;
        else if (character.role === CharacterRole.Leader) {
            character.role = CharacterRole.ColonyGovernor;
            flag1 = false;
        }
    }
    try {
        if (SPY_CAPTURE_CHANCE > spyClockRnd(galaxy).nextDouble()) {
            const flag2 = true; // the caller is PerformIntelligenceMissions
            let flag3 = false;
            let flag4 = false;
            const spyTargetEmpire = getSpyTargetEmpire(character);
            if (character.empire === galaxy.playerEmpire) flag3 = true;
            if (galaxy.playerEmpire === spyTargetEmpire) flag4 = true;
            if (flag2) {
                if (!flag3 && !flag4) {
                    const characterValue = getCharacterValue(character);
                    const empire = character.empire!;
                    if (spyTargetEmpire !== null && empire.stateMoney > characterValue) {
                        spyTargetEmpire.stateMoney += characterValue;
                        empire.stateMoney -= characterValue;
                        flag1 = false;
                    }
                } else {
                    if (spyTargetEmpire === null) nre();
                    const prison: Prison = spyTargetEmpire.pirateEmpireBaseHabitat !== null ? firstBuiltObject(spyTargetEmpire) : (spyTargetEmpire.capital ?? nre());
                    const characterList = obtainPrisonList(prison);
                    if (!characterList.includes(character)) listAdd(characterList, character);
                    prison.baconValues!.set('capturedSpies', characterList);
                    removeFromEmpireAndLocation(character);
                    flag1 = false;
                }
                if (spyTargetEmpire === null) nre();
                const character1 = addEventToCharacter(galaxy, 'Agent Captured', character.name + ' was captured by ' + spyTargetEmpire.name, character);
                character.eventHistory.push(character1);
            }
        }
    } catch (e) {
        if (!(e instanceof CsException)) throw e;
    }
    // Character.Kill (Character.cs 4546) completes only when BaconCharacter.Kill returned true; its own BaconCharacter.Kill
    // re-check has no further effect here (the Romulan cases already returned false).
    if (flag1) character.kill(galaxy);
}

// ---------------------------------------------------------------------------------------------------------------
// Escape / defection / ransom (BaconHabitat.cs 575-735, BaconBuiltObject.cs 4105-4260)
// ---------------------------------------------------------------------------------------------------------------

/** The prison list SpyEscaped / SpyDefected remove from: planet.Empire.Capital (habitat) / ship.Empire.BuiltObjects[0] (ship). */
function ownPrisonList(prison: Prison): Character[] {
    if (prison instanceof HabitatClass) {
        if (prison.empire === null) nre();
        return prisonListStrict(prison.empire.capital);
    }
    return prisonListStrict(firstBuiltObject((prison as BuiltObject).empire));
}

/** BaconHabitat.cs 662 / BaconBuiltObject.cs 4198 SpyEscaped(prison, spy): the spy returns home on counter-intelligence. */
export function spyEscaped(galaxy: Galaxy, prison: Prison, spy: Character): boolean {
    try {
        const baseEscapeChance = SPY_BASE_ESCAPE_CHANCE;
        if (spyClockRnd(galaxy).nextDouble() > baseEscapeChance) return false;
        if (spy.empire === null) nre();
        getEmpireCharacters(spy.empire).push(spy);
        if (spy.empire.pirateEmpireBaseHabitat === null) {
            ensureStellarObjectCharacters(spy.empire.capital ?? nre()).push(spy);
        } else {
            const bo = firstBuiltObject(spy.empire);
            ensureStellarObjectCharacters(bo).push(spy);
            if (!(prison instanceof HabitatClass)) spy.location = bo; // BaconBuiltObject.cs 4221 only
        }
        spy.mission = newCounterIntelligenceMission(galaxy, spy.empire, spy);
        listRemove(ownPrisonList(prison), spy);
        if (prison instanceof HabitatClass && (spy.empire === galaxy.playerEmpire || prison.empire === galaxy.playerEmpire)) {
            // BaconHabitat.cs 690-694 only.
            const description = spy.name + ' has escaped from ' + prison.name;
            sendMessageToEmpire(galaxy.playerEmpire, galaxy.playerEmpire, EmpireMessageType.Undefined, null, description, { x: 0, y: 0 }, 'prisonbreak');
        }
    } catch (e) {
        if (!(e instanceof CsException)) throw e;
    }
    return true;
}

/** BaconHabitat.cs 703 / BaconBuiltObject.cs 4232 SpyDefected(prison, spy): the spy joins the jailer's empire. */
export function spyDefected(galaxy: Galaxy, prison: Prison, spy: Character): boolean {
    try {
        const baseDefectChance = SPY_BASE_DEFECT_CHANCE;
        if (spyClockRnd(galaxy).nextDouble() > baseDefectChance) return false;
        if (prison instanceof HabitatClass) {
            const pe = prison.empire ?? nre();
            getEmpireCharacters(pe).push(spy);
            const capital = pe.capital ?? nre();
            ensureStellarObjectCharacters(capital).push(spy);
            spy.location = capital;
            spy.empire = pe;
        } else {
            const ship = prison as BuiltObject;
            const se = ship.empire ?? nre();
            getEmpireCharacters(se).push(spy);
            const bo = firstBuiltObject(se);
            ensureStellarObjectCharacters(bo).push(spy);
            spy.location = bo;
            spy.empire = ship.actualEmpire;
        }
        spy.mission = newCounterIntelligenceMission(galaxy, spy.empire, spy);
        listRemove(ownPrisonList(prison), spy);
        return true;
    } catch (e) {
        if (!(e instanceof CsException)) throw e;
        return false;
    }
}

/** BaconHabitat.cs 654 / BaconBuiltObject.cs 4190 ShouldRansomSpy(prison, spy): not at war with the player. */
function shouldRansomSpy(galaxy: Galaxy, prison: Prison, spy: Character): boolean {
    void spy;
    let flag = false;
    const e = prison.empire ?? nre();
    if (obtainDiplomaticRelation(e, galaxy.playerEmpire).type !== DiplomaticRelationType.War) flag = true;
    return flag;
}

function playerMessage(galaxy: Galaxy, description: string, hint = ''): void {
    const player = galaxy.playerEmpire ?? nre();
    sendMessageToEmpire(player, player, EmpireMessageType.Undefined, null, description, { x: 0, y: 0 }, hint);
}

/**
 * BaconHabitat.cs 575 HandlePlayerPrisoners(planet) / BaconBuiltObject.cs 4105 HandlePlayerPrisoners(ship): foreign spies
 * in the player's prison may escape or defect (the first one that does ends the loop: the list changed under the foreach).
 */
export function handlePlayerPrisoners(galaxy: Galaxy, prison: Prison): void {
    try {
        if (prison.baconValues === null) return;
        const spiesInPrison = getSpiesInPrison(prison);
        if (spiesInPrison === null) return;
        if (!(prison instanceof HabitatClass) && spiesInPrison.length === 0) return;
        csForEach(spiesInPrison, (character1) => {
            if (character1.empire !== galaxy.playerEmpire) {
                if (spyEscaped(galaxy, prison, character1)) {
                    playerMessage(galaxy, character1.name + ' has escaped from ' + prison.name, 'prisonbreak');
                    const character2 = addEventToCharacter(galaxy, 'Escaped', character1.name + ' escaped from ' + prison.name, character1);
                    character1.eventHistory.push(character2);
                } else if (spyDefected(galaxy, prison, character1)) {
                    playerMessage(galaxy, character1.name + ' has agreed to join our empire.', 'defect');
                    const character3 = addEventToCharacter(galaxy, 'Defected', character1.name + ' defected to ' + prison.name, character1);
                    character1.eventHistory.push(character3);
                }
            }
        });
    } catch (e) {
        if (!(e instanceof CsException)) throw e;
    }
}

/**
 * BaconHabitat.cs 608 HandleAIPrisoners(planet) / BaconBuiltObject.cs 4138 HandleAIPrisoners(ship): the player's spies in
 * an AI prison may escape, defect, or (when not at war) be offered for ransom (moved to the player's capital / first ship).
 */
export function handleAIPrisoners(galaxy: Galaxy, prison: Prison): void {
    try {
        const prisonEmpire = prison instanceof HabitatClass ? prison.empire : (prison as BuiltObject).actualEmpire;
        if (prisonEmpire === galaxy.playerEmpire || prison.baconValues === null) return;
        const spiesInPrison = getSpiesInPrison(prison);
        if (spiesInPrison === null || spiesInPrison.length === 0) return;
        const player = galaxy.playerEmpire ?? nre();
        const playerPrison: Prison = prison instanceof HabitatClass ? (player.capital ?? nre()) : firstBuiltObject(player);
        if (playerPrison.baconValues === null) playerPrison.baconValues = new Map<string, unknown>();
        let characterList1: Character[] = [];
        if (playerPrison.baconValues.has('capturedSpies')) characterList1 = playerPrison.baconValues.get('capturedSpies') as Character[];
        const characterList2: Character[] = [];
        const prisonEmpireName = (): string => (prison.empire ?? nre()).name;
        csForEach(spiesInPrison, (character1) => {
            if (spyEscaped(galaxy, prison, character1)) {
                characterList2.push(character1);
                playerMessage(galaxy, character1.name + ' has escaped from ' + prison.name, 'prisonbreak');
                const character2 = addEventToCharacter(galaxy, 'Escaped', character1.name + ' escaped from ' + prison.name, character1);
                character1.eventHistory.push(character2);
            } else if (spyDefected(galaxy, prison, character1)) {
                characterList2.push(character1);
                playerMessage(galaxy, character1.name + ' has joined ' + prisonEmpireName(), 'defect');
                const character3 = addEventToCharacter(galaxy, 'Escaped', character1.name + ' defected to ' + prison.name, character1);
                character1.eventHistory.push(character3);
            } else if (shouldRansomSpy(galaxy, prison, character1)) {
                listAdd(characterList1, character1);
                playerMessage(galaxy, prisonEmpireName() + ' is willing to ransom our agent ' + character1.name);
                characterList2.push(character1);
            }
        });
        for (const character of characterList2) listRemove(spiesInPrison, character);
        playerPrison.baconValues.set('capturedSpies', characterList1);
    } catch (e) {
        if (!(e instanceof CsException)) throw e;
    }
}
