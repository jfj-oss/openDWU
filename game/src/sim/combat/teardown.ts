// M4o — BuiltObject teardown, mission clearing for a destroyed target, invalid-ship cleanup.
//
// Ports (statement for statement): BuiltObject.2.cs 5150 CheckCancelContracts, 5166 / 5171 CompleteTeardown,
// 5557 / 5562 ClearAllMissionsForTarget(builtObject, Empire target, …), 5635 / 5640 ClearAllMissionsForTarget(builtObject,
// BuiltObject target, …), Empire.8.cs 2896 CleanupInvalidShips, Galaxy.6.cs 3802 CorrectIndexCoords. No Galaxy.Rnd here.

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import type { BuiltObject } from '../builtObject';
import type { Habitat } from '../types';
import type { ShipGroup } from '../fleets/shipGroup';
import type { Contract } from '../logistics/contracts';
import { BuiltObjectRole } from '../data/designSpecifications';
import { BuiltObjectMission, BuiltObjectMissionType, CommandAction, builtObjectMission, isBuiltObject, isHabitat, type StellarObject } from '../missions/mission';
import { clearPreviousMissionRequirements } from '../missions/assign';
import { cancelContract } from '../logistics/contracts';
import { forceCompleteMission, leaveShipGroup } from '../fleets/shipGroup';
import { checkCancelAttackMissionsForBuiltObject } from '../pirates/missionsMarket';
import { stellarObjectCharacters } from '../characters';
import { characterSendDeathMessageAndKill } from '../events';
import { galaxyNow } from '../tick/simTime';
import { stellarAttackers, stellarPursuers } from './threats';
import { inflictDamageFull, type FighterLike } from './damage';
import { checkForPlanetDestroyerWeaponFiringDelayOnHyperExit } from './weapons';
import { updatePosition } from '../movement';

/** Galaxy.3.cs 4959 IndexSize (galaxy.ts / movement.ts keep private copies). */
const INDEX_SIZE = 400_000;

/** Galaxy.6.cs 3802 CorrectIndexCoords(ref x, ref y): clamp into [0, IndexMaxX-1] (both axes use IndexMaxX). */
export function correctIndexCoords(galaxy: Galaxy, x: number, y: number): { x: number; y: number } {
    const indexMaxX = galaxy.indexMaxX;
    if (x < 0) x = 0;
    else if (x >= indexMaxX) x = indexMaxX - 1;
    if (y < 0) y = 0;
    else if (y >= indexMaxX) y = indexMaxX - 1;
    return { x, y };
}

/** The ConstructionQueue members touched here (construction/constructionYard.ts; `unknown` on the owning classes). */
interface QueueLike {
    constructionYards: { shipUnderConstruction: BuiltObject | null }[] | null;
    constructionWaitQueue: BuiltObject[] | null;
}
function queueOf(o: { constructionQueue: unknown }): QueueLike | null {
    return o.constructionQueue as QueueLike | null;
}
function removeAll<T>(list: T[], item: T): void {
    for (let i = list.indexOf(item); i >= 0; i = list.indexOf(item)) list.splice(i, 1);
}
function removeFirst(list: unknown[] | null, item: unknown): void {
    if (list === null) return;
    const i = list.indexOf(item);
    if (i >= 0) list.splice(i, 1);
}

/** BuiltObject.2.cs 5150 CheckCancelContracts. */
export function checkCancelContracts(galaxy: Galaxy, builtObject: BuiltObject): void {
    const contractsToFulfill = builtObject.contractsToFulfill as Contract[];
    if (contractsToFulfill === null || contractsToFulfill.length <= 0) return;
    for (let i = 0; i < contractsToFulfill.length; i++) {
        const contract = contractsToFulfill[i];
        if (contract != null) cancelContract(galaxy, contract);
    }
    contractsToFulfill.length = 0;
}

/**
 * BuiltObject.2.cs 5562 ClearAllMissionsForTarget(builtObject, Empire target, missionType, dropOutOfHyperspace).
 * TODO(port) M4p: the Fighters loop (AbandonAttackTarget / EvaluateThreats / MissionType = Patrol) — no fighters exist yet.
 */
export function clearAllMissionsForTargetEmpire(galaxy: Galaxy, self: BuiltObject, builtObject: BuiltObject, target: Empire | null, missionType: BuiltObjectMissionType, dropOutOfHyperspace: boolean): void {
    void self;
    let empire: Empire | null = null;
    const mission = builtObjectMission(builtObject.mission);
    if (mission !== null && (missionType === BuiltObjectMissionType.Undefined || mission.type === missionType)) {
        empire = BuiltObjectMission.resolveMissionTargetEmpire(mission);
        if (empire === target) {
            clearPreviousMissionRequirements(galaxy, builtObject);
            if (dropOutOfHyperspace && builtObject.currentSpeed > Math.fround(builtObject.topSpeed)) {
                builtObject.currentSpeed = builtObject.cruiseSpeed;
                builtObject.targetSpeed = builtObject.cruiseSpeed;
                updatePosition(galaxy, builtObject);
                checkForPlanetDestroyerWeaponFiringDelayOnHyperExit(galaxy, builtObject, galaxyNow(galaxy));
            }
        }
        empire = BuiltObjectMission.resolveMissionSecondaryTargetEmpire(mission);
        if (empire === target) {
            clearPreviousMissionRequirements(galaxy, builtObject);
            if (dropOutOfHyperspace && builtObject.currentSpeed > Math.fround(builtObject.topSpeed)) {
                builtObject.currentSpeed = builtObject.cruiseSpeed;
                builtObject.targetSpeed = builtObject.cruiseSpeed;
                updatePosition(galaxy, builtObject);
                checkForPlanetDestroyerWeaponFiringDelayOnHyperExit(galaxy, builtObject, galaxyNow(galaxy));
            }
        }
    }
    const subsequentMissions = builtObject.subsequentMissions as BuiltObjectMission[];
    const builtObjectMissionList: BuiltObjectMission[] = [];
    for (let i = 0; i < subsequentMissions.length; i++) {
        const m = subsequentMissions[i];
        if (m != null && (missionType === BuiltObjectMissionType.Undefined || m.type === missionType)) {
            empire = BuiltObjectMission.resolveMissionTargetEmpire(m);
            if (empire === target) builtObjectMissionList.push(m);
            empire = BuiltObjectMission.resolveMissionSecondaryTargetEmpire(m);
            if (empire === target) builtObjectMissionList.push(m);
        }
    }
    for (let j = 0; j < builtObjectMissionList.length; j++) removeFirst(subsequentMissions, builtObjectMissionList[j]);
    if (builtObject.fighters === null || builtObject.fighters.length <= 0) return;
    // TODO(port) M4p: Fighter.AbandonAttackTarget / EvaluateThreats / MissionType (Fighter.cs 1992 / 518).
}

/** BuiltObject.2.cs 5635 ClearAllMissionsForTarget(builtObject, BuiltObject target) = (…, Undefined, dropOutOfHyperspace: false). */
export function clearAllMissionsForTarget(galaxy: Galaxy, self: BuiltObject, builtObject: BuiltObject | null, target: BuiltObject): void {
    clearAllMissionsForTargetBuiltObject(galaxy, self, builtObject, target, BuiltObjectMissionType.Undefined, false);
}

/**
 * BuiltObject.2.cs 5640 ClearAllMissionsForTarget(builtObject, BuiltObject target, missionType, dropOutOfHyperspace).
 * TODO(port) M4p: the Fighters loop (AbandonAttackTarget / EvaluateThreats / MissionType = Patrol) — no fighters exist yet.
 */
export function clearAllMissionsForTargetBuiltObject(galaxy: Galaxy, self: BuiltObject, builtObject: BuiltObject | null, target: BuiltObject, missionType: BuiltObjectMissionType, dropOutOfHyperspace: boolean): void {
    void self;
    if (builtObject === null) return;
    const mission = builtObjectMission(builtObject.mission);
    if (mission !== null && mission.type !== BuiltObjectMissionType.Undefined && (missionType === BuiltObjectMissionType.Undefined || mission.type === missionType)) {
        let targetBuiltObject = mission.targetBuiltObject;
        if (targetBuiltObject !== null && targetBuiltObject === target) {
            let flag = true;
            const type = mission.type;
            if (type === BuiltObjectMissionType.Transport) flag = !mission.checkCommandsPastPrimaryTarget(targetBuiltObject);
            if (flag) {
                clearPreviousMissionRequirements(galaxy, builtObject);
                if (dropOutOfHyperspace && builtObject.currentSpeed > Math.fround(builtObject.topSpeed)) {
                    builtObject.currentSpeed = builtObject.cruiseSpeed;
                    builtObject.targetSpeed = builtObject.cruiseSpeed;
                    checkForPlanetDestroyerWeaponFiringDelayOnHyperExit(galaxy, builtObject, galaxyNow(galaxy));
                }
            }
        }
        targetBuiltObject = mission.secondaryTargetBuiltObject;
        if (targetBuiltObject !== null && targetBuiltObject === target) {
            clearPreviousMissionRequirements(galaxy, builtObject);
            if (dropOutOfHyperspace && builtObject.currentSpeed > Math.fround(builtObject.topSpeed)) {
                builtObject.currentSpeed = builtObject.cruiseSpeed;
                builtObject.targetSpeed = builtObject.cruiseSpeed;
                checkForPlanetDestroyerWeaponFiringDelayOnHyperExit(galaxy, builtObject, galaxyNow(galaxy));
            }
        }
    }
    const revertMission = builtObject.revertMission;
    if (revertMission !== null && revertMission.type !== BuiltObjectMissionType.Undefined && (missionType === BuiltObjectMissionType.Undefined || revertMission.type === missionType)) {
        if (revertMission.targetBuiltObject !== null && revertMission.targetBuiltObject === target) builtObject.revertMission = null;
        else if (revertMission.secondaryTargetBuiltObject !== null && revertMission.secondaryTargetBuiltObject === target) builtObject.revertMission = null;
    }
    const subsequentMissions = builtObject.subsequentMissions as BuiltObjectMission[];
    let builtObjectMissionList: BuiltObjectMission[] | null = null;
    for (let i = 0; i < subsequentMissions.length; i++) {
        const m = subsequentMissions[i];
        if (m == null || m.type === BuiltObjectMissionType.Undefined || (missionType !== BuiltObjectMissionType.Undefined && m.type !== missionType)) continue;
        let targetBuiltObject2 = m.targetBuiltObject;
        if (targetBuiltObject2 !== null && targetBuiltObject2 === target) {
            if (builtObjectMissionList === null) builtObjectMissionList = [];
            builtObjectMissionList.push(m);
        }
        targetBuiltObject2 = m.secondaryTargetBuiltObject;
        if (targetBuiltObject2 !== null && targetBuiltObject2 === target) {
            if (builtObjectMissionList === null) builtObjectMissionList = [];
            builtObjectMissionList.push(m);
        }
    }
    if (builtObjectMissionList !== null) {
        for (let j = 0; j < builtObjectMissionList.length; j++) removeFirst(subsequentMissions, builtObjectMissionList[j]);
    }
    const fighters = builtObject.fighters;
    if (fighters === null || fighters.length <= 0) return;
    // TODO(port) M4p: Fighter.AbandonAttackTarget / EvaluateThreats / MissionType (Fighter.cs 1992 / 518).
}

/**
 * BuiltObject.2.cs 5171 CompleteTeardown(galaxy, removeFromEmpire) (5166: removeFromEmpire = true). No Rnd.
 * Detaches the destroyed ship / base from every list and back-reference (contracts, orders, outlaws, troops, characters,
 * target, fleet, docking, construction, parent, mission wait queues, fighters, fleet missions, empire lists, children,
 * galaxy index, galaxy / empire lists, pirate attack missions, system visibility).
 */
export function builtObjectCompleteTeardown(galaxy: Galaxy, builtObject: BuiltObject, removeFromEmpire = true): void {
    const self = builtObject;
    self.hasBeenDestroyed = true;
    if (self.contractsToFulfill.length > 0) checkCancelContracts(galaxy, self);
    const orders = galaxy.orders.getOrdersForBuiltObject(self);
    if (orders.items.length > 0) {
        const list = orders.items.slice();
        for (let i = 0; i < list.length; i++) galaxy.orders.remove(list[i]);
    }
    let num = 0;
    for (let j = 0; j < galaxy.empires.length; j++) {
        const outlaws = galaxy.empires[j].outlaws;
        if (outlaws !== null) {
            num = outlaws.indexOf(self);
            if (num >= 0) outlaws.splice(num, 1);
        }
    }
    if (self.troops !== null && self.troops.count > 0) {
        for (let k = 0; k < self.troops.count; k++) {
            const troop = self.troops.items[k];
            if (self.empire !== null && self.empire.troops !== null) self.empire.troops.remove(troop);
            troop.empire = null;
            troop.colony = null;
            troop.builtObject = null;
        }
        self.troops.clear();
    }
    const characters = stellarObjectCharacters(self);
    if (characters !== null && characters.length > 0) {
        const array = characters.slice();
        for (const character of array) {
            characterSendDeathMessageAndKill(galaxy, character, self.role === BuiltObjectRole.Base ? 'BaseDestroyed' : 'ShipDestroyed');
        }
    }
    const currentTarget = self.currentTarget as StellarObject | null;
    if (currentTarget !== null) {
        if (isHabitat(currentTarget)) {
            // Habitat.Attackers (types.ts, M4o field); Habitat.Pursuers is not modelled.
            removeFirst(currentTarget.attackers, self);
        } else {
            removeFirst(stellarAttackers(currentTarget), self);
            removeFirst(stellarPursuers(currentTarget), self);
        }
    }
    if (self.shipGroup !== null) leaveShipGroup(galaxy, self);
    if (self.dockingBayWaitQueue !== null) {
        for (let m = 0; m < self.dockingBayWaitQueue.length; m++) {
            if (self.dockingBayWaitQueue[m] != null) self.dockingBayWaitQueue[m].dockedAt = null;
        }
        self.dockingBayWaitQueue.length = 0;
    }
    if (self.dockingBays !== null) {
        for (let n = 0; n < self.dockingBays.length; n++) {
            const dockingBay = self.dockingBays[n];
            if (dockingBay.dockedShip !== null) dockingBay.dockedShip.dockedAt = null;
            dockingBay.dockedShip = null;
        }
    }
    const constructionQueue = queueOf(self);
    if (constructionQueue !== null) {
        const yards = constructionQueue.constructionYards ?? [];
        for (let num2 = 0; num2 < yards.length; num2++) {
            const constructionYard = yards[num2];
            if (constructionYard.shipUnderConstruction !== null) constructionYard.shipUnderConstruction.builtAt = null;
            constructionYard.shipUnderConstruction = null;
        }
        const waitQueue = constructionQueue.constructionWaitQueue ?? [];
        for (let num3 = 0; num3 < waitQueue.length; num3++) waitQueue[num3].builtAt = null;
        waitQueue.length = 0;
    }
    if (self.parentHabitat !== null) {
        const parentQueue = queueOf(self.parentHabitat);
        if (parentQueue !== null) {
            const yards2 = parentQueue.constructionYards ?? [];
            for (let num4 = 0; num4 < yards2.length; num4++) {
                const constructionYard2 = yards2[num4];
                if (constructionYard2.shipUnderConstruction === self) {
                    constructionYard2.shipUnderConstruction = null;
                    break;
                }
            }
            if (parentQueue.constructionWaitQueue !== null) removeAll(parentQueue.constructionWaitQueue, self);
        }
        if (self.parentHabitat.basesAtHabitat.includes(self)) removeFirst(self.parentHabitat.basesAtHabitat, self);
        self.parentHabitat = null;
    }
    const dockedAt = self.dockedAt;
    if (dockedAt !== null && dockedAt.dockingBays !== null && dockedAt.dockingBayWaitQueue !== null) {
        for (let num5 = 0; num5 < dockedAt.dockingBays.length; num5++) {
            const dockingBay2 = dockedAt.dockingBays[num5];
            if (dockingBay2.dockedShip === self) dockingBay2.dockedShip = null;
        }
        if (dockedAt.dockingBayWaitQueue.includes(self)) removeFirst(dockedAt.dockingBayWaitQueue, self);
    }
    self.dockedAt = null;
    const mission = builtObjectMission(self.mission);
    if (mission !== null) {
        const command = mission.fastPeekCurrentCommand();
        if (command !== null && command.action === CommandAction.Dock) {
            if (command.targetBuiltObject !== null) {
                if (command.targetBuiltObject.dockingBayWaitQueue !== null && command.targetBuiltObject.dockingBayWaitQueue.includes(self)) removeFirst(command.targetBuiltObject.dockingBayWaitQueue, self);
            } else if (command.targetHabitat !== null && command.targetHabitat.dockingBayWaitQueue !== null && command.targetHabitat.dockingBayWaitQueue.includes(self)) {
                removeFirst(command.targetHabitat.dockingBayWaitQueue, self);
            }
        }
    }
    const builtAt = self.builtAt as BuiltObject | Habitat | null;
    if (builtAt !== null && queueOf(builtAt) !== null) {
        const builtAtQueue = queueOf(builtAt)!;
        const yards3 = builtAtQueue.constructionYards ?? [];
        for (let num6 = 0; num6 < yards3.length; num6++) {
            const constructionYard3 = yards3[num6];
            if (constructionYard3.shipUnderConstruction === self) constructionYard3.shipUnderConstruction = null;
        }
        if (builtAtQueue.constructionWaitQueue !== null && builtAtQueue.constructionWaitQueue.includes(self)) removeFirst(builtAtQueue.constructionWaitQueue, self);
        self.builtAt = null;
    }
    if (self.fighters !== null && self.fighters.length > 0) {
        const currentDateTime = galaxyNow(galaxy);
        const fighters = self.fighters as FighterLike[];
        for (let num7 = 0; num7 < fighters.length; num7++) {
            const abstractTarget = fighters[num7];
            inflictDamageFull(galaxy, self, abstractTarget, null, 1000.0, currentDateTime, 0, false, 0.0, false);
        }
    }
    for (let num8 = 0; num8 < galaxy.empires.length; num8++) {
        const empire = galaxy.empires[num8];
        const shipGroups = empire.shipGroups as ShipGroup[] | null;
        if (shipGroups === null) continue;
        for (let num9 = 0; num9 < shipGroups.length; num9++) {
            const shipGroup = shipGroups[num9];
            if (shipGroup.mission !== null) {
                if (shipGroup.mission !== null && shipGroup.mission.targetBuiltObject !== null && shipGroup.mission !== null && shipGroup.mission.targetBuiltObject === self) forceCompleteMission(galaxy, shipGroup);
                if (shipGroup.mission !== null && shipGroup.mission.secondaryTargetBuiltObject !== null && shipGroup.mission !== null && shipGroup.mission.secondaryTargetBuiltObject === self) forceCompleteMission(galaxy, shipGroup);
            }
        }
    }
    const actualEmpire = self.actualEmpire;
    if (actualEmpire !== null) {
        if (self.role === BuiltObjectRole.Base && actualEmpire.pirateEmpireBaseHabitat !== null) {
            for (let num10 = 0; num10 < galaxy.empires.length; num10++) {
                const e = galaxy.empires[num10];
                if (e != null && e.knownPirateBases !== null && e.knownPirateBases.includes(self)) removeFirst(e.knownPirateBases, self);
            }
        }
        removeFirst(actualEmpire.manufacturers, self);
        removeFirst(actualEmpire.refuellingDepots, self);
        removeFirst(actualEmpire.resourceExtractors, self);
        removeFirst(actualEmpire.miningStations, self);
        removeFirst(actualEmpire.spacePorts, self);
        removeFirst(actualEmpire.constructionYards, self);
        removeFirst(actualEmpire.freighters, self);
        removeFirst(actualEmpire.constructionShips, self);
        removeFirst(actualEmpire.researchFacilities, self);
        removeFirst(actualEmpire.resortBases, self);
        removeFirst(actualEmpire.planetDestroyers, self);
        // LongRangeScanners: the player's OnRefreshView is UI only.
        removeFirst(actualEmpire.longRangeScanners, self);
    }
    const builtObjects = galaxy.builtObjects as (BuiltObject | null)[];
    // 5474-5487: ParentHabitat was nulled at 5311, so the re-parenting branch is dead in the C# too (kept verbatim).
    const selfParentHabitat = self.parentHabitat as Habitat | null;
    for (let num11 = 0; num11 < builtObjects.length; num11++) {
        const other = builtObjects[num11];
        if (other == null) continue;
        if (other.parentBuiltObject === self) {
            if (selfParentHabitat !== null) {
                other.parentHabitat = selfParentHabitat;
                other.parentOffsetX = other.xpos - selfParentHabitat.xpos;
                other.parentOffsetY = other.ypos - selfParentHabitat.ypos;
            } else {
                other.parentBuiltObject = null;
                other.parentOffsetX = -2000000001.0;
                other.parentOffsetY = -2000000001.0;
            }
        }
        clearAllMissionsForTarget(galaxy, self, other, self);
    }
    let x = Math.trunc(Math.trunc(self.xpos) / INDEX_SIZE);
    let y = Math.trunc(Math.trunc(self.ypos) / INDEX_SIZE);
    const corrected = correctIndexCoords(galaxy, x, y);
    x = corrected.x;
    y = corrected.y;
    const galaxyIndexList: { x: number; y: number }[] = [];
    galaxyIndexList.push({ x, y });
    let num12 = x;
    let num13 = y;
    num12 = !(self.xpos % INDEX_SIZE > Math.trunc(INDEX_SIZE / 2)) ? x - 1 : x + 1;
    num13 = !(self.ypos % INDEX_SIZE > Math.trunc(INDEX_SIZE / 2)) ? y - 1 : y + 1;
    num12 = Math.max(0, Math.min(galaxy.indexMaxX - 1, num12));
    num13 = Math.max(0, Math.min(galaxy.indexMaxX - 1, num13));
    galaxyIndexList.push({ x, y: num13 });
    galaxyIndexList.push({ x: num12, y });
    galaxyIndexList.push({ x: num12, y: num13 });
    for (let num14 = 0; num14 < galaxyIndexList.length; num14++) {
        const cell = galaxy.builtObjectIndexGrid[galaxyIndexList[num14].x][galaxyIndexList[num14].y];
        removeAll(cell, self);
    }
    const num15 = builtObjects.indexOf(self);
    if (num15 >= 0) builtObjects[num15] = null;
    if (removeFromEmpire && self.empire !== null) {
        if (self.empire.builtObjects !== null && self.empire.builtObjects.includes(self)) removeFirst(self.empire.builtObjects, self);
        else if (self.empire.privateBuiltObjects !== null && self.empire.privateBuiltObjects.includes(self)) removeFirst(self.empire.privateBuiltObjects, self);
        if (self.actualEmpire !== null && self.actualEmpire !== self.empire) {
            if (self.actualEmpire.privateBuiltObjects !== null && self.actualEmpire.privateBuiltObjects.includes(self)) removeFirst(self.actualEmpire.privateBuiltObjects, self);
            if (self.actualEmpire.builtObjects !== null && self.actualEmpire.builtObjects.includes(self)) removeFirst(self.actualEmpire.builtObjects, self);
        }
    }
    checkCancelAttackMissionsForBuiltObject(galaxy, self, null);
    if (self.empire !== null && self.empire !== galaxy.independentEmpire && self.empire.pirateEmpireBaseHabitat === null) {
        self.empire.visibility.resolveSystemVisibilityForUnit(self, true);
    } else if (self.actualEmpire !== null && self.actualEmpire !== galaxy.independentEmpire) {
        self.actualEmpire.visibility.resolveSystemVisibilityForUnit(self, true);
    }
}

/** Empire.8.cs 2896 CleanupInvalidShips: tear down destroyed / non-functional / immobile auto-controlled ships (not in view). No Rnd. */
export function cleanupInvalidShips(galaxy: Galaxy, empire: Empire): void {
    const builtObjectList: BuiltObject[] = [];
    const builtObjectList2: BuiltObject[] = [];
    builtObjectList2.push(...empire.builtObjects);
    builtObjectList2.push(...empire.privateBuiltObjects);
    for (let i = 0; i < builtObjectList2.length; i++) {
        const builtObject = builtObjectList2[i];
        if (builtObject == null || builtObject.inView || !builtObject.isAutoControlled) continue;
        if (builtObject.hasBeenDestroyed) builtObjectList.push(builtObject);
        if (builtObject.owner !== null && builtObject.owner === galaxy.playerEmpire && !builtObject.hasBeenDestroyed) continue;
        if (!builtObject.isFunctional && builtObject.builtAt === null && builtObject.role !== BuiltObjectRole.Base) builtObjectList.push(builtObject);
        if (builtObject.role !== BuiltObjectRole.Base && builtObject.builtAt === null && builtObject.topSpeed <= 0) builtObjectList.push(builtObject);
        if (builtObject.dockingBays !== null && builtObject.dockingBays.length > 0) {
            for (const dockingBay of builtObject.dockingBays) {
                if (dockingBay.dockedShip !== null && dockingBay.dockedShip.dockedAt === null) dockingBay.dockedShip = null;
            }
            if (builtObject.dockingBayWaitQueue !== null) {
                for (const item of builtObject.dockingBayWaitQueue) {
                    const itemMission = builtObjectMission(item.mission);
                    if (itemMission !== null && itemMission.type !== BuiltObjectMissionType.Undefined) {
                        if (!item.isFunctional && !builtObjectList.includes(item)) builtObjectList.push(item);
                        if (item.topSpeed <= 0 && !builtObjectList.includes(item)) builtObjectList.push(item);
                    } else {
                        clearPreviousMissionRequirements(galaxy, item);
                    }
                }
            }
        }
        const constructionQueue = queueOf(builtObject);
        if (constructionQueue === null || constructionQueue.constructionYards === null || constructionQueue.constructionYards.length <= 0) continue;
        for (const constructionYard of constructionQueue.constructionYards) {
            if (constructionYard.shipUnderConstruction !== null && constructionYard.shipUnderConstruction.builtAt === null) constructionYard.shipUnderConstruction = null;
        }
    }
    for (const item2 of builtObjectList) builtObjectCompleteTeardown(galaxy, item2, true);
}
