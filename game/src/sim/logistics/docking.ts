// M4e — docking bays, wait queues.
//
// Ports:
//   BuiltObject.1.cs 1275/1284 CheckClearDocking() / CheckClearDocking(forceUndock)
//   BuiltObject.cs 3903 CheckForShipsNoLongerDocking (BuiltObject), Habitat.cs 2464 CheckForShipsNoLongerDocking (Habitat)
//   Galaxy.cs 3540 CheckRemoveInvalidDockingShipsFromWaitQueue(stellarObject)
//   BuiltObject.1.cs 5347/5364 DetectShipsDockingAtSpacePort / DetectShipsDockingAtHabitat (called by case Blockade, M4m)
//   BuiltObject.1.cs 4496 CheckMissionStillValid(time) (read by cases Dock 2733 and HyperTo 3196)
//   (the habitat docking-bay / wait-queue creation at the C# habitat sites is in dockingBays.ts)
// Rnd: CheckMissionStillValid 4596 (NextDouble, blockaded dock target) — unreachable in the C# (see there). No other draws.

import type { Galaxy } from '../galaxy';
import type { BuiltObject, DockingBay } from '../builtObject';
import type { Habitat } from '../types';
import type { TroopList } from '../cargo';
import { BuiltObjectSubRole } from '../builtObjectTypes';
import { DiplomaticRelationType, obtainDiplomaticRelation, type DiplomaticRelation } from '../diplomacy';
import { obtainPirateRelation, PirateRelationType, type PirateRelation } from '../pirateRelations';
import type { Empire } from '../empire';
import { threatEvaluation } from '../combat/threats';
import { calculateCautionFactor, determineBuiltObjectStrengthAtLocation, galaxyBlockadeFor } from '../fleets/militaryAI';
import { clearPreviousMissionRequirements } from '../missions/assign';
import { BuiltObjectMissionType, CommandAction, builtObjectMission } from '../missions/mission';

/** DockingBayList.IndexOf(BuiltObject) (DockingBayList.cs 109): the bay holding the ship, or -1. */
export function dockingBayIndexOfShip(bays: readonly DockingBay[], builtObject: BuiltObject): number {
    for (let index = 0; index < bays.length; index++) {
        if (builtObject === bays[index].dockedShip) return index;
    }
    return -1;
}

/** List<T>.Remove: removes the first occurrence. */
export function removeFirst<T>(list: T[], item: T): boolean {
    const index = list.indexOf(item);
    if (index < 0) return false;
    list.splice(index, 1);
    return true;
}

/** One of the three repeated blocks of CheckClearDocking(true) (1290-1350): leave the host's wait queue and bays. */
function clearFromHost(host: BuiltObject | Habitat, builtObject: BuiltObject): boolean {
    let result = false;
    if (host.dockingBayWaitQueue !== null && host.dockingBayWaitQueue.includes(builtObject)) {
        removeFirst(host.dockingBayWaitQueue, builtObject);
        result = true;
    }
    if (host.dockingBays !== null) {
        for (let i = 0; i < host.dockingBays.length; i++) {
            const dockingBay = host.dockingBays[i];
            if (dockingBay.dockedShip === builtObject) {
                dockingBay.dockedShip = null;
                result = true;
            }
        }
    }
    return result;
}

/**
 * BuiltObject.1.cs 1275 CheckClearDocking() (no argument: only at hyperjump speed → CheckClearDocking(true)) and
 * 1284 CheckClearDocking(forceUndock). `forceUndock` undefined selects the no-argument overload.
 */
export function checkClearDocking(galaxy: Galaxy, builtObject: BuiltObject, forceUndock?: boolean): boolean {
    if (forceUndock === undefined) {
        // 1277: CurrentSpeed (float) >= (float)WarpSpeed.
        if (builtObject.warpSpeed > 0 && builtObject.currentSpeed >= Math.fround(builtObject.warpSpeed)) {
            return checkClearDocking(galaxy, builtObject, true);
        }
        return false;
    }
    let result = false;
    if (forceUndock) {
        const dockedAt = builtObject.dockedAt;
        if (dockedAt !== null) {
            if (clearFromHost(dockedAt, builtObject)) result = true;
        }
        builtObject.dockedAt = null;
        const parentHabitat = builtObject.parentHabitat;
        if (parentHabitat !== null) {
            if (clearFromHost(parentHabitat, builtObject)) result = true;
        }
        const parentBuiltObject = builtObject.parentBuiltObject;
        if (parentBuiltObject !== null) {
            if (clearFromHost(parentBuiltObject, builtObject)) result = true;
        }
    }
    return result;
}

/** BuiltObject.cs 3903 CheckForShipsNoLongerDocking (BuiltObject). */
export function checkForShipsNoLongerDockingBuiltObject(galaxy: Galaxy, builtObject: BuiltObject): void {
    const queue = builtObject.dockingBayWaitQueue;
    if (queue !== null && queue.length > 0) {
        const builtObjectList: BuiltObject[] = [];
        for (let i = 0; i < queue.length; i++) {
            const builtObject2 = queue[i];
            if (builtObject2.parentBuiltObject !== builtObject) {
                builtObjectList.push(builtObject2);
            }
        }
        for (let j = 0; j < builtObjectList.length; j++) {
            removeFirst(queue, builtObjectList[j]);
        }
    }
    const bays = builtObject.dockingBays;
    if (bays === null) {
        return;
    }
    for (let k = 0; k < bays.length; k++) {
        const dockedShip = bays[k].dockedShip;
        if (dockedShip !== null && dockedShip.dockedAt !== builtObject) {
            bays[k].dockedShip = null;
        }
    }
}

/** Habitat.cs 2464 CheckForShipsNoLongerDocking (Habitat). */
export function checkForShipsNoLongerDockingHabitat(galaxy: Galaxy, habitat: Habitat): void {
    const queue = habitat.dockingBayWaitQueue;
    if (queue === null || queue.length <= 0) {
        return;
    }
    const builtObjectList: BuiltObject[] = [];
    for (let i = 0; i < queue.length; i++) {
        const builtObject = queue[i];
        if (builtObject.parentHabitat !== habitat) {
            builtObjectList.push(builtObject);
        }
    }
    for (let j = 0; j < builtObjectList.length; j++) {
        removeFirst(queue, builtObjectList[j]);
    }
}

/** Galaxy.cs 3540 CheckRemoveInvalidDockingShipsFromWaitQueue(stellarObject). */
export function checkRemoveInvalidDockingShipsFromWaitQueue(galaxy: Galaxy, stellarObject: BuiltObject | Habitat | null): boolean {
    if (stellarObject !== null) {
        const dockingBayWaitQueue = stellarObject.dockingBayWaitQueue;
        if (dockingBayWaitQueue !== null) {
            const builtObjectList: BuiltObject[] = [];
            for (let i = 0; i < dockingBayWaitQueue.length; i++) {
                const builtObject = dockingBayWaitQueue[i];
                if (builtObject != null) {
                    const mission = builtObjectMission(builtObject.mission);
                    if (builtObject.hasBeenDestroyed || !builtObject.isFunctional || builtObject.topSpeed === 0 || mission === null || mission.type === BuiltObjectMissionType.Undefined) {
                        builtObjectList.push(builtObject);
                    }
                }
            }
            if (builtObjectList.length > 0) {
                for (let j = 0; j < builtObjectList.length; j++) {
                    removeFirst(dockingBayWaitQueue, builtObjectList[j]);
                }
                return true;
            }
        }
    }
    return false;
}

/** BuiltObject.1.cs 5347 DetectShipsDockingAtSpacePort(spacePort): wait-queue ships whose current command docks at it. */
export function detectShipsDockingAtSpacePort(spacePort: BuiltObject): BuiltObject[] {
    const builtObjectList: BuiltObject[] = [];
    const queue = spacePort.dockingBayWaitQueue!;
    for (let i = 0; i < queue.length; i++) {
        const builtObject = queue[i];
        const mission = builtObjectMission(builtObject.mission);
        if (mission !== null) {
            const command = mission.fastPeekCurrentCommand();
            if (command !== null && command.action === CommandAction.Dock && command.targetBuiltObject !== null && command.targetBuiltObject === spacePort) {
                builtObjectList.push(builtObject);
            }
        }
    }
    return builtObjectList;
}

/** BuiltObject.1.cs 5364 DetectShipsDockingAtHabitat(habitat). */
export function detectShipsDockingAtHabitat(habitat: Habitat): BuiltObject[] {
    const builtObjectList: BuiltObject[] = [];
    const queue = habitat.dockingBayWaitQueue!;
    for (let i = 0; i < queue.length; i++) {
        const builtObject = queue[i];
        const mission = builtObjectMission(builtObject.mission);
        if (mission !== null) {
            const command = mission.fastPeekCurrentCommand();
            if (command !== null && command.action === CommandAction.Dock && command.targetHabitat !== null && command.targetHabitat === habitat) {
                builtObjectList.push(builtObject);
            }
        }
    }
    return builtObjectList;
}

/** `habitat.InvadingTroops != null && habitat.InvadingTroops.Count > 0 && habitat.InvadingTroops[0].Empire == empire`. */
function invadingTroopsLedBy(habitat: Habitat, empire: Empire | null): boolean {
    const invadingTroops: TroopList | null = habitat.invadingTroops;
    return invadingTroops !== null && invadingTroops.count > 0 && invadingTroops.items[0].empire === empire;
}

/**
 * BuiltObject.1.cs 4496 CheckMissionStillValid(time).
 *
 * C# oddity: BuiltObjectMission.GetNextDockCommand (BuiltObjectMission.cs 835) returns the first *Undock* command, so
 * the `nextDockCommand.Action == CommandAction.Dock` block (4507-4631, incl. the Rnd draw at 4596) never runs, and in
 * the LoadTroops/UnloadTroops branch (4633) a mission without an Undock command throws a NullReferenceException in the
 * C# (`nextDockCommand2.Action` on null) — mirrored here by the non-null assertion.
 */
export function checkMissionStillValid(galaxy: Galaxy, builtObject: BuiltObject, time: number): boolean {
    let flag = true;
    const mission = builtObjectMission(builtObject.mission);
    if (mission !== null && (mission.type === BuiltObjectMissionType.Refuel || mission.type === BuiltObjectMissionType.Transport || mission.type === BuiltObjectMissionType.Build)) {
        if (mission.type === BuiltObjectMissionType.Refuel && mission.targetBuiltObject !== null && mission.targetBuiltObject.subRole === BuiltObjectSubRole.ResupplyShip && !mission.targetBuiltObject.isDeployed) {
            clearPreviousMissionRequirements(galaxy, builtObject);
            return false;
        }
        const nextDockCommand = mission.getNextDockCommand();
        if (nextDockCommand !== null && nextDockCommand.action === CommandAction.Dock && (nextDockCommand.targetHabitat !== null || nextDockCommand.targetBuiltObject !== null || nextDockCommand.targetCreature !== null || nextDockCommand.targetShipGroup !== null)) {
            let diplomaticRelation: DiplomaticRelation | null = null;
            let empire: Empire | null = null;
            let blockade: { initiator: Empire | null } | null = null;
            let x = 0;
            let y = 0;
            let habitat: Habitat | null = null;
            const selfEmpire = builtObject.empire!;
            if (nextDockCommand.targetBuiltObject !== null) {
                const targetBuiltObject = nextDockCommand.targetBuiltObject;
                // 4518-4526: a fuel-cargo lookup whose Available is discarded (`_ = ...`).
                empire = targetBuiltObject.empire;
                diplomaticRelation = obtainDiplomaticRelation(selfEmpire, targetBuiltObject.empire);
                if (targetBuiltObject.isBlockaded) {
                    blockade = galaxyBlockadeFor(galaxy, targetBuiltObject);
                }
                x = Math.trunc(targetBuiltObject.xpos);
                y = Math.trunc(targetBuiltObject.ypos);
            } else if (nextDockCommand.targetHabitat !== null) {
                const targetHabitat = nextDockCommand.targetHabitat;
                empire = targetHabitat.empire;
                diplomaticRelation = obtainDiplomaticRelation(selfEmpire, targetHabitat.empire);
                if (targetHabitat.isBlockaded) {
                    blockade = galaxyBlockadeFor(galaxy, targetHabitat);
                }
                x = Math.trunc(targetHabitat.xpos);
                y = Math.trunc(targetHabitat.ypos);
                habitat = nextDockCommand.targetHabitat;
            }
            const actualEmpire = builtObject.actualEmpire;
            if (builtObject.pirateEmpireId > 0 && actualEmpire !== null && actualEmpire.pirateEmpireBaseHabitat !== null && empire !== galaxy.independentEmpire && builtObject.empire !== galaxy.independentEmpire) {
                let pirateRelation: PirateRelation | null = null;
                if (empire !== null) {
                    pirateRelation = obtainPirateRelation(actualEmpire, empire);
                }
                if (pirateRelation === null || pirateRelation.type !== PirateRelationType.Protection) {
                    clearPreviousMissionRequirements(galaxy, builtObject);
                    builtObject.refuelForNextMission = true;
                    flag = false;
                }
            }
            if (habitat !== null && (habitat.population === null || habitat.population.items.length <= 0 || habitat.population.totalAmount <= 0)) {
                clearPreviousMissionRequirements(galaxy, builtObject);
                builtObject.refuelForNextMission = true;
                flag = false;
            }
            if (diplomaticRelation !== null && (diplomaticRelation.type === DiplomaticRelationType.War || diplomaticRelation.type === DiplomaticRelationType.TradeSanctions)) {
                let flag2 = false;
                const m = builtObjectMission(builtObject.mission);
                if (m !== null && m.type === BuiltObjectMissionType.LoadTroops && builtObject.troopCapacityRemaining >= 100 && habitat !== null && habitat.empire !== builtObject.empire && invadingTroopsLedBy(habitat, builtObject.empire)) {
                    flag2 = true;
                }
                if (!flag2) {
                    clearPreviousMissionRequirements(galaxy, builtObject);
                    threatEvaluation(galaxy, builtObject, time);
                    flag = false;
                }
            }
            if (blockade !== null) {
                flag = false;
                const diplomaticRelation2 = obtainDiplomaticRelation(selfEmpire, blockade.initiator);
                if (diplomaticRelation2.type === DiplomaticRelationType.War || diplomaticRelation2.type === DiplomaticRelationType.TradeSanctions || diplomaticRelation2.type === DiplomaticRelationType.NotMet || diplomaticRelation2.type === DiplomaticRelationType.None) {
                    const num3 = determineBuiltObjectStrengthAtLocation(galaxy, x, y, blockade.initiator, 0, false);
                    const num4 = determineBuiltObjectStrengthAtLocation(galaxy, x, y, builtObject.empire, 0, false);
                    if (num3 <= num4) {
                        let num5 = 1.0;
                        if (builtObject.empire !== null && builtObject.empire !== galaxy.independentEmpire) {
                            num5 = calculateCautionFactor(galaxy, builtObject.empire);
                        }
                        if (galaxy.rnd.nextDouble() + 0.7 > num5) {
                            flag = true;
                        }
                    }
                }
                if (!flag) {
                    clearPreviousMissionRequirements(galaxy, builtObject);
                }
            }
        }
    } else if (mission !== null && (mission.type === BuiltObjectMissionType.LoadTroops || mission.type === BuiltObjectMissionType.UnloadTroops)) {
        const nextDockCommand2 = mission.getNextDockCommand()!;
        if (nextDockCommand2.action === CommandAction.Dock) {
            if (nextDockCommand2.targetHabitat !== null) {
                const targetHabitat2 = nextDockCommand2.targetHabitat;
                let flag3 = false;
                const m = builtObjectMission(builtObject.mission);
                if (m !== null && m.type === BuiltObjectMissionType.LoadTroops && builtObject.troopCapacityRemaining >= 100 && targetHabitat2 !== null && targetHabitat2.empire !== builtObject.empire && invadingTroopsLedBy(targetHabitat2, builtObject.empire)) {
                    flag3 = true;
                }
                if (!flag3 && targetHabitat2.empire !== builtObject.empire) {
                    flag = false;
                }
            } else {
                flag = false;
            }
        }
        if (!flag) {
            clearPreviousMissionRequirements(galaxy, builtObject);
        }
    }
    return flag;
}
