// BaconEmpire.cs 170-275 ProcessScienceShips (lab research on exploration ships) and its callees, and its scheduling:
// BaconMain.cs 700-715 (BaconInitialize queues a "ProcessEmpireScienceShips" delayed EventAction when researchPerLab > 0)
// and BaconGalaxy.cs 322-329 (ExecuteEventAction runs it and re-queues it Next(26, 35) days later).

import type { Galaxy } from './galaxy';
import type { Empire } from './empire';
import type { BuiltObject } from './builtObject';
import type { Habitat } from './types';
import { IndustryType } from './types';
import { BuiltObjectSubRole } from './builtObjectTypes';
import { ComponentType } from './data/components';
import { ComponentStatus } from './builtObjectComponent';
import { EmpireMessageType, sendMessageToEmpire } from './messages';
import { nodeIndustry, type TechNode } from './researchSystem';
import { baconSettings } from './data/baconSettings';
import { EventAction, EventActionExecutionPackage, EventActionType, GameEvent } from './story/gameEventModel';
import { REAL_SECONDS_IN_GALACTIC_YEAR, galaxyStarDate } from './tick/simTime';

/** The .NET exceptions the C# try/catch of ProcessScienceShips swallows (KeyNotFoundException on a Dictionary indexer). */
class CsKeyNotFound extends Error {}

/** Dictionary<string, object> indexer get: KeyNotFoundException when absent. */
function dictGet(values: Map<string, unknown>, key: string): unknown {
    if (!values.has(key)) throw new CsKeyNotFound(key);
    return values.get(key);
}

/** BaconMain.cs 709 / BaconGalaxy.cs 325: Galaxy.RealSecondsInGalacticYear * 1000 / 360 (int arithmetic) — one game day. */
const GAME_DAY_MS = Math.trunc((REAL_SECONDS_IN_GALACTIC_YEAR * 1000) / 360);

export const PROCESS_EMPIRE_SCIENCE_SHIPS = 'ProcessEmpireScienceShips';

/**
 * BaconMain.cs 704-715 (inside BaconInitialize, after the SaveStats action and before AddOtherDelayedEvents): when
 * BaconEmpire.researchPerLab > 0 and no delayed action's MessageTitle contains "ProcessEmpireScienceShips", queue one
 * (EventActionType.StartPlague, no target) executing Galaxy.Rnd.Next(26, 35) game days from now for the player empire.
 * RND: one Next(26, 35) when queued. (C# `x.Action.MessageTitle.Contains` would throw on a queued action without a title;
 * the TS treats such an action as no match.)
 */
export function scheduleProcessEmpireScienceShips(galaxy: Galaxy): void {
    if (!(baconSettings.researchPerLab > 0)) return;
    const existing = galaxy.delayedActions.find((x) => x.action !== null && x.action.messageTitle !== null && x.action.messageTitle.includes(PROCESS_EMPIRE_SCIENCE_SHIPS));
    if (existing !== undefined) return;
    const eventAction = new EventAction(null, EventActionType.StartPlague);
    eventAction.messageTitle = PROCESS_EMPIRE_SCIENCE_SHIPS;
    eventAction.executionDate = galaxyStarDate(galaxy) + GAME_DAY_MS * galaxy.rnd.next(26, 35);
    const gameEvent = new GameEvent(galaxy, 0, null);
    galaxy.delayedActions.push(new EventActionExecutionPackage(eventAction, gameEvent, galaxy.playerEmpire));
}

/** BaconGalaxy.cs 322-329: run ProcessScienceShips and re-queue the action Next(26, 35) days later. */
export function executeProcessEmpireScienceShips(galaxy: Galaxy, eventAction: EventAction, gameEvent: GameEvent | null): void {
    processScienceShips(galaxy);
    eventAction.executionDate = galaxyStarDate(galaxy) + GAME_DAY_MS * galaxy.rnd.next(26, 35);
    galaxy.delayedActions.push(new EventActionExecutionPackage(eventAction, gameEvent, galaxy.playerEmpire));
}

/** BaconEmpire.cs 170 ProcessScienceShips(main): the normal empires, then the pirate empires. */
export function processScienceShips(galaxy: Galaxy): void {
    processScienceShipsOf(galaxy, galaxy.empires);
    processScienceShipsOf(galaxy, galaxy.pirateEmpires);
}

/** BaconEmpire.cs 176 ProcessScienceShips(main, empiresAndPirates). RND: GetRandomResearchNode draws Next(0, count). */
export function processScienceShipsOf(galaxy: Galaxy, empiresAndPirates: Empire[]): void {
    const industryTypeList: IndustryType[] = [IndustryType.Weapon, IndustryType.Energy, IndustryType.HighTech];
    try {
        for (const empiresAndPirate of empiresAndPirates) {
            for (const ship of empiresAndPirate.builtObjects) {
                if (ship.subRole !== BuiltObjectSubRole.ExplorationShip) continue;
                if (ship.baconValues !== null) {
                    if (!ship.baconValues.has('scientificData') && (ship.baconValues.has('lab0') || ship.baconValues.has('lab1') || ship.baconValues.has('lab2'))) {
                        ship.baconValues.set('scientificData', 0);
                    }
                    const baconValue = dictGet(ship.baconValues, 'scientificData') as number;
                    if (baconValue > 110) storeScientificData(ship);
                    if (baconValue < 3) tryRefillScientifiData(ship);
                }
                const hasLab = (type: ComponentType): boolean => ship.components.items.some((x) => x.type === type && x.status === ComponentStatus.Normal);
                const boolList = [hasLab(ComponentType.LabsWeaponsLab), hasLab(ComponentType.LabsEnergyLab), hasLab(ComponentType.LabsHighTechLab)];
                for (let index = 0; index < boolList.length; index++) {
                    if (!boolList[index]) continue;
                    let subject = getCurrentResearchNode(ship, index);
                    if (subject !== null && subject.isResearched) subject = null;
                    if (subject === null) subject = getRandomResearchNode(galaxy, empiresAndPirate, empiresAndPirate.research.techTree, industryTypeList[index]);
                    if (subject === null) continue;
                    const values = ship.baconValues!;
                    if (values.has('scientificData') && (values.get('scientificData') as number) > 0) {
                        // subject.Progress += researchPerLab * (float)(1.0 + ResearchBonus): float arithmetic.
                        subject.progress = Math.fround(subject.progress + Math.fround(Math.fround(baconSettings.researchPerLab) * Math.fround(1.0 + empiresAndPirate.researchBonus)));
                        values.set('scientificData', (values.get('scientificData') as number) - 1);
                    }
                    values.set('lab' + index, subject);
                    if (subject.progress >= subject.cost) {
                        if (!subject.isResearched) {
                            sendMessageToEmpire(empiresAndPirate, empiresAndPirate, EmpireMessageType.ResearchBreakthrough, subject, ship.name + ' completed research on ' + subject.def.name, { x: 0, y: 0 }, 'scienceResearchComplete');
                        }
                        subject.isResearched = true;
                    }
                }
            }
        }
    } catch (e) {
        // BaconEmpire.cs 232-234: `catch (Exception ex) { }` — the rest of this empire list is skipped.
        if (!(e instanceof CsKeyNotFound)) throw e;
    }
}

/** BaconEmpire.cs 238 GetCurrentResearchNode(ship, industryType): creates BaconValues; a missing key → null (caught). */
export function getCurrentResearchNode(ship: BuiltObject, industryType: number): TechNode | null {
    if (ship.baconValues === null) ship.baconValues = new Map<string, unknown>();
    const key = 'lab' + industryType;
    if (!ship.baconValues.has(key)) return null;
    return ship.baconValues.get(key) as TechNode | null;
}

/** BaconEmpire.cs 253 GetRandomResearchNode(empire, researchQueue, industryType). RND: Next(0, count) when non-empty. */
export function getRandomResearchNode(galaxy: Galaxy, empire: Empire, researchQueue: TechNode[], industryType: IndustryType): TechNode | null {
    let randomResearchNode: TechNode | null = null;
    const nodesForIndustryType = getAllPotentialResearchNodesForIndustryType(galaxy, empire, researchQueue, industryType);
    if (nodesForIndustryType.length > 0) randomResearchNode = nodesForIndustryType[galaxy.rnd.next(0, nodesForIndustryType.length)];
    return randomResearchNode;
}

/**
 * BaconEmpire.cs 273 GetAllPotentialResearchNodesForIndustryType(empire, researchQueue, industryType). ResearchNode.AllowedRaces /
 * DisallowedRaces are null unless SetResearchRaceSpecialProjects filled them (researchSystem.ts keeps only filled sets).
 */
export function getAllPotentialResearchNodesForIndustryType(galaxy: Galaxy, empire: Empire, researchQueue: TechNode[], industryType: IndustryType): TechNode[] {
    const nodesForIndustryType: TechNode[] = [];
    const rs = empire.research;
    for (const research of researchQueue) {
        let flag1 = true;
        let flag2 = false;
        if (rs.canResearchNode(research) && !research.isResearched && nodeIndustry(research) === industryType && rs.canResearchNode(research)) {
            if (research.parentNodes.length > 0) {
                flag1 = true;
                for (let index = 0; index < research.parentNodes.length; index++) {
                    if (!research.parentNodes[index].isResearched) flag1 = false;
                }
            }
            const allowed = galaxy.researchStatic?.allowedRaces.get(research.def.projectId);
            const race = empire.dominantRace;
            if (allowed !== undefined && allowed.size > 0 && !(race !== null && allowed.has(race.name))) flag2 = true;
            const disallowed = galaxy.researchStatic?.disallowedRaces.get(research.def.projectId);
            if (disallowed !== undefined && disallowed.size > 0 && race !== null && disallowed.has(race.name)) flag2 = true;
            if (flag1 && (empire.name.toLowerCase().includes('romulan') || !flag2)) nodesForIndustryType.push(research);
        }
    }
    return nodesForIndustryType;
}

/** BaconHabitat.cs 1259 / BaconBuiltObject.cs 5096 CheckAndCreateBaconValuesKey(o, key): sets "scientificData" (not `key`) = 0 when absent. */
function checkAndCreateBaconValuesKey(o: Habitat | BuiltObject, keyToFind: string): boolean {
    if (o.baconValues === null) o.baconValues = new Map<string, unknown>();
    if (o.baconValues.has(keyToFind)) return true;
    o.baconValues.set('scientificData', 0);
    return false;
}

/** BaconEmpire.cs 1342 TryRefillScientifiData(main, ship): up to 100 from the capital (pirates: their first ship). No Rnd. */
export function tryRefillScientifiData(ship: BuiltObject): void {
    const actualEmpire = ship.actualEmpire;
    if (actualEmpire === null) return;
    const values = ship.baconValues!;
    if (actualEmpire.pirateEmpireBaseHabitat === null) {
        const capital = actualEmpire.capital;
        if (capital === null || !checkAndCreateBaconValuesKey(capital, 'scientificData')) return;
        const num = Math.min(dictGet(capital.baconValues!, 'scientificData') as number, 100);
        if (num <= 0) return;
        values.set('scientificData', (dictGet(values, 'scientificData') as number) + num);
        capital.baconValues!.set('scientificData', (capital.baconValues!.get('scientificData') as number) - num);
    } else {
        if (actualEmpire.builtObjects == null || actualEmpire.builtObjects.length < 1) return;
        const builtObject = actualEmpire.builtObjects[0];
        if (builtObject == null || !checkAndCreateBaconValuesKey(builtObject, 'scientificData')) return;
        const num = Math.min(dictGet(builtObject.baconValues!, 'scientificData') as number, 100);
        if (num <= 0) return;
        values.set('scientificData', (dictGet(values, 'scientificData') as number) + num);
        builtObject.baconValues!.set('scientificData', (builtObject.baconValues!.get('scientificData') as number) - num);
    }
}

/** BaconEmpire.cs 1373 StoreScientificData(main, ship): everything above 100 goes to the capital (pirates: their first ship). No Rnd. */
export function storeScientificData(ship: BuiltObject): void {
    const actualEmpire = ship.actualEmpire;
    if (actualEmpire === null) return;
    const values = ship.baconValues!;
    if (actualEmpire.pirateEmpireBaseHabitat === null) {
        const capital = actualEmpire.capital;
        if (capital === null) return;
        checkAndCreateBaconValuesKey(capital, 'scientificData');
        const num = Math.max((dictGet(values, 'scientificData') as number) - 100, 0);
        if (num <= 0) return;
        values.set('scientificData', (values.get('scientificData') as number) - num);
        capital.baconValues!.set('scientificData', (dictGet(capital.baconValues!, 'scientificData') as number) + num);
    } else {
        if (actualEmpire.builtObjects == null || actualEmpire.builtObjects.length < 1) return;
        const builtObject = actualEmpire.builtObjects[0];
        if (builtObject == null) return;
        checkAndCreateBaconValuesKey(builtObject, 'scientificData');
        const num = Math.max((dictGet(values, 'scientificData') as number) - 100, 0);
        if (num <= 0) return;
        values.set('scientificData', (values.get('scientificData') as number) - num);
        builtObject.baconValues!.set('scientificData', (dictGet(builtObject.baconValues!, 'scientificData') as number) + num);
    }
}
