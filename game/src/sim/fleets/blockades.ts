// M4m — blockades: Blockade.cs / BlockadeList.cs (Galaxy.cs 580 Galaxy.Blockades), Empire.8.cs 3610-3955
// (CanSendShipToBlockade*, SetupBlockade, ImplementBlockade overloads, CancelBlockades, CancelBlockade) and Empire.2.cs
// 3938 CancelInactiveBlockades. Free functions, C# `this` first (plan §3.1 rule 2). No Rnd in this module (the fleet
// search FindNearestAvailableFleet and ShipGroup.AssignMission draw through their own callees).

import { isAiControlled } from '../missions/playerOrder';
import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import type { BuiltObject } from '../builtObject';
import type { Habitat } from '../types';
import type { ShipGroup } from './shipGroup';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, builtObjectMission, isHabitat } from '../missions/mission';
import { galaxyStarDate } from '../tick/simTime';
import { EmpireMessageType, sendMessageToEmpire } from '../messages';
import { AdvisorMessageType, FleetPosture, checkTaskAuthorized, formatText, getText } from '../diplomacyTick';
import { AutomationLevel } from '../empire';
import { clearAllMissionsForTargetEmpire } from '../combat/teardown';
import {
    shipGroupAssignMission,
    shipGroupClearAllMissionsForTargetBuiltObject,
    shipGroupClearAllMissionsForTargetEmpire,
    shipGroupClearAllMissionsForTargetHabitat,
} from './shipGroupTasks';
import { empireShipGroups } from './shipGroup';
import { determineSpacePortAtColony } from '../combat/attackAI';
import { findNearestAvailableFleet, generateAutomationMessageAttackEnemyBase, generateAutomationMessageAttackEnemyColony } from './militaryAI';

/** Blockade.cs. */
export class Blockade {
    private _colony: Habitat | null;
    private _builtObject: BuiltObject | null;
    private _initiator: Empire | null;
    private _blockadedEmpire: Empire | null;
    private _dateInitiated: number;
    private _targetIsColony: boolean;

    /** Blockade(BuiltObject, initiator, dateInitiated) / Blockade(Habitat, initiator, dateInitiated). */
    constructor(target: BuiltObject | Habitat, initiator: Empire | null, dateInitiated: number) {
        if (isHabitat(target)) {
            this._colony = target;
            this._targetIsColony = true;
            this._builtObject = null;
            this._blockadedEmpire = this._colony.empire;
        } else {
            this._builtObject = target;
            this._targetIsColony = false;
            this._colony = null;
            this._blockadedEmpire = this._builtObject.empire;
        }
        this._initiator = initiator;
        this._dateInitiated = dateInitiated;
    }

    get targetIsColony(): boolean { return this._targetIsColony; }
    get colony(): Habitat | null { return this._colony; }
    get builtObject(): BuiltObject | null { return this._builtObject; }
    get initiator(): Empire | null { return this._initiator; }
    get blockadedEmpire(): Empire | null { return this._blockadedEmpire; }
    get dateInitiated(): number { return this._dateInitiated; }
}

/** Galaxy.Blockades (Galaxy.cs 580 BlockadeList). */
export function galaxyBlockades(galaxy: Galaxy): Blockade[] {
    return galaxy.blockades as Blockade[];
}

/** BlockadeList.cs 14 this[Habitat colony] / 28 this[BuiltObject builtObject]. */
export function blockadeFor(galaxy: Galaxy, target: BuiltObject | Habitat): Blockade | null {
    const list = galaxyBlockades(galaxy);
    const colonyTarget = isHabitat(target);
    for (let index = 0; index < list.length; ++index) {
        const blockade = list[index];
        if (colonyTarget) {
            if (blockade.targetIsColony && blockade.colony === target) return blockade;
        } else if (!blockade.targetIsColony && blockade.builtObject === target) {
            return blockade;
        }
    }
    return null;
}

/** BlockadeList.cs 42 GetBlockadesAgainstEmpire(target). */
export function getBlockadesAgainstEmpire(galaxy: Galaxy, target: Empire | null): Blockade[] {
    const list = galaxyBlockades(galaxy);
    const result: Blockade[] = [];
    for (let index = 0; index < list.length; ++index) {
        if (list[index].blockadedEmpire === target) result.push(list[index]);
    }
    return result;
}

/** BlockadeList.cs 54 GetBlockadesForEmpire(initiator). */
export function getBlockadesForEmpire(galaxy: Galaxy, initiator: Empire | null): Blockade[] {
    const list = galaxyBlockades(galaxy);
    const result: Blockade[] = [];
    for (let index = 0; index < list.length; ++index) {
        if (list[index].initiator === initiator) result.push(list[index]);
    }
    return result;
}

function removeBlockade(galaxy: Galaxy, blockade: Blockade): void {
    const list = galaxyBlockades(galaxy);
    const i = list.indexOf(blockade);
    if (i >= 0) list.splice(i, 1);
}

/** Empire.8.cs 3615 CanSendShipToBlockadeColony(colony). */
export function canSendShipToBlockadeColony(galaxy: Galaxy, self: Empire, colony: Habitat): boolean {
    if (!colony.isBlockaded) {
        const builtObject = determineSpacePortAtColony(galaxy, colony);
        if (builtObject !== null) {
            if (!builtObject.isBlockaded) return true;
            const blockade = blockadeFor(galaxy, builtObject);
            // C# dereferences the blockade unguarded (NullReferenceException when a port is flagged without one).
            if (blockade!.initiator === self) return true;
            return false;
        }
        return true;
    }
    const blockade2 = blockadeFor(galaxy, colony);
    if (blockade2!.initiator === self) return true;
    return false;
}

/** Empire.8.cs 3643 CanSendShipToBlockadeBuiltObject(builtObject). */
export function canSendShipToBlockadeBuiltObject(galaxy: Galaxy, self: Empire, builtObject: BuiltObject): boolean {
    const blockade = blockadeFor(galaxy, builtObject);
    if (blockade === null) return true;
    if (blockade.initiator === self) return true;
    return false;
}

/** Empire.8.cs 3657 SetupBlockade(Habitat colony). */
export function setupBlockadeColony(galaxy: Galaxy, self: Empire, colony: Habitat | null): boolean {
    if (colony !== null && !colony.isBlockaded) {
        let blockade = blockadeFor(galaxy, colony);
        if (blockade === null) {
            blockade = new Blockade(colony, self, galaxyStarDate(galaxy));
            const builtObjectList: BuiltObject[] = [];
            if (colony.empire !== null && colony.empire !== galaxy.independentEmpire && colony.basesAtHabitat !== null) {
                for (let i = 0; i < colony.basesAtHabitat.length; i++) {
                    const builtObject: BuiltObject = colony.basesAtHabitat[i];
                    if (builtObject != null && builtObject.parentHabitat === colony) builtObjectList.push(builtObject);
                }
            }
            const blockadeList: Blockade[] = [];
            if (builtObjectList.length > 0) {
                for (let j = 0; j < builtObjectList.length; j++) {
                    const builtObject2 = builtObjectList[j];
                    if (builtObject2 != null) {
                        let blockade2 = blockadeFor(galaxy, builtObject2);
                        if (blockade2 !== null) return false;
                        blockade2 = new Blockade(builtObject2, self, galaxyStarDate(galaxy));
                        blockadeList.push(blockade2);
                    }
                }
            }
            galaxyBlockades(galaxy).push(blockade);
            colony.isBlockaded = true;
            if (blockadeList.length > 0) {
                for (let k = 0; k < blockadeList.length; k++) {
                    galaxyBlockades(galaxy).push(blockadeList[k]);
                    blockadeList[k].builtObject!.isBlockaded = true;
                }
            }
            const description = formatText(getText('We are initiating a general blockade of your colony at X'), colony.name);
            sendMessageToEmpire(self, colony.empire, EmpireMessageType.BlockadeInitiated, colony, description);
            return true;
        }
    }
    return false;
}

/** Empire.8.cs 3713 SetupBlockade(BuiltObject builtObject). */
export function setupBlockadeBuiltObject(galaxy: Galaxy, self: Empire, builtObject: BuiltObject | null): boolean {
    if (builtObject !== null && !builtObject.isBlockaded) {
        let blockade = blockadeFor(galaxy, builtObject);
        if (blockade === null) {
            blockade = new Blockade(builtObject, self, galaxyStarDate(galaxy));
            galaxyBlockades(galaxy).push(blockade);
            builtObject.isBlockaded = true;
            const description = formatText(getText('We are initiating a general blockade of SPACEPORT'), builtObject.name);
            sendMessageToEmpire(self, builtObject.empire, EmpireMessageType.BlockadeInitiated, builtObject, description);
            return true;
        }
    }
    return false;
}

/**
 * Empire.8.cs 3748 ImplementBlockade(Habitat colony, sendFleet, performAuthorizationCheck, ref refusalCount, fleet) and
 * the shorter overloads 3610 / 3731 / 3737 / 3743 (refusal counter 0, fleet null unless given).
 */
export function implementBlockadeColony(galaxy: Galaxy, self: Empire, colony: Habitat, sendFleet: boolean, performAuthorizationCheck: boolean, refusalCount: { value: number } = { value: 0 }, fleet: ShipGroup | null = null): boolean {
    if (!colony.isBlockaded) {
        if (sendFleet) {
            if (fleet === null) {
                fleet = findNearestAvailableFleet(galaxy, self, colony.xpos, colony.ypos, BuiltObjectMissionPriority.Normal, 0, FleetPosture.Attack, true);
            }
            if (fleet === null) return false;
            let flag = true;
            if (performAuthorizationCheck && (isAiControlled(fleet.leadShip!) || self.controlMilitaryAttacks === AutomationLevel.PartiallyAutomated)) {
                flag = checkTaskAuthorized(galaxy, self, self.controlMilitaryAttacks, refusalCount, generateAutomationMessageAttackEnemyColony(galaxy, colony, true, fleet), colony, AdvisorMessageType.EnemyBlockade, null, fleet, null);
            }
            if (flag) {
                shipGroupAssignMission(galaxy, fleet, BuiltObjectMissionType.Blockade, colony, null, BuiltObjectMissionPriority.High, false);
                return true;
            }
        } else {
            let flag2 = true;
            if (performAuthorizationCheck) {
                flag2 = checkTaskAuthorized(galaxy, self, self.controlMilitaryAttacks, { value: 0 }, generateAutomationMessageAttackEnemyColony(galaxy, colony, true, null), colony, AdvisorMessageType.EnemyBlockade);
            }
            if (flag2) return true;
        }
        return false;
    }
    return false;
}

/**
 * Empire.8.cs 3812 ImplementBlockade(BuiltObject builtObject, sendFleet, performAuthorizationCheck, ref refusalCount, fleet)
 * and the overloads 3790 / 3795 / 3801 / 3807.
 */
export function implementBlockadeBuiltObject(galaxy: Galaxy, self: Empire, builtObject: BuiltObject, sendFleet: boolean, performAuthorizationCheck: boolean, refusalCount: { value: number } = { value: 0 }, fleet: ShipGroup | null = null): boolean {
    const blockade = blockadeFor(galaxy, builtObject);
    if (blockade === null) {
        if (sendFleet) {
            if (fleet === null) {
                fleet = findNearestAvailableFleet(galaxy, self, builtObject.xpos, builtObject.ypos, BuiltObjectMissionPriority.Normal, 0, FleetPosture.Attack, true);
            }
            if (fleet === null) return false;
            let flag = true;
            if (performAuthorizationCheck && (isAiControlled(fleet.leadShip!) || self.controlMilitaryAttacks === AutomationLevel.PartiallyAutomated)) {
                flag = checkTaskAuthorized(galaxy, self, self.controlMilitaryAttacks, refusalCount, generateAutomationMessageAttackEnemyBase(galaxy, builtObject, true, fleet), builtObject, AdvisorMessageType.EnemyBlockade, null, fleet, null);
            }
            if (flag) {
                shipGroupAssignMission(galaxy, fleet, BuiltObjectMissionType.Blockade, builtObject, null, BuiltObjectMissionPriority.High, false);
                return true;
            }
        } else {
            let flag2 = true;
            if (performAuthorizationCheck) {
                flag2 = checkTaskAuthorized(galaxy, self, self.controlMilitaryAttacks, { value: 0 }, generateAutomationMessageAttackEnemyBase(galaxy, builtObject, true, null), builtObject, AdvisorMessageType.EnemyBlockade);
            }
            if (flag2) return true;
        }
        return false;
    }
    return false;
}

/** Empire.8.cs 3855 CancelBlockades(targetEmpire). */
export function cancelBlockades(galaxy: Galaxy, self: Empire, targetEmpire: Empire): void {
    const blockadesForEmpire = getBlockadesForEmpire(galaxy, self);
    const blockadeList: Blockade[] = [];
    for (const item of blockadesForEmpire) {
        if (item.blockadedEmpire === targetEmpire) blockadeList.push(item);
    }
    const shipGroups = empireShipGroups(self);
    for (const item2 of blockadeList) {
        for (let i = 0; i < shipGroups.length; i++) {
            const shipGroup = shipGroups[i];
            shipGroupClearAllMissionsForTargetEmpire(galaxy, shipGroup, item2.blockadedEmpire, BuiltObjectMissionType.Blockade);
        }
        for (let j = 0; j < self.builtObjects.length; j++) {
            const builtObject = self.builtObjects[j];
            if (builtObject != null && !builtObject.hasBeenDestroyed) {
                clearAllMissionsForTargetEmpire(galaxy, builtObject, builtObject, item2.blockadedEmpire, BuiltObjectMissionType.Blockade, true);
            }
        }
        if (item2.targetIsColony) {
            item2.colony!.isBlockaded = false;
            const description = formatText(getText('We are lifting our blockade of your colony at X'), item2.colony!.name);
            sendMessageToEmpire(self, item2.colony!.empire, EmpireMessageType.BlockadeCancelled, item2.colony, description);
        } else {
            item2.builtObject!.isBlockaded = false;
            const description2 = formatText(getText('We are lifting our blockade of SPACEPORT'), item2.builtObject!.name);
            sendMessageToEmpire(self, item2.builtObject!.empire, EmpireMessageType.BlockadeCancelled, item2.builtObject, description2);
        }
        removeBlockade(galaxy, item2);
    }
}

/** Galaxy.7.cs 569 ConditionCheckLimit(condition, maximumIterations, ref iterationCount). */
export function conditionCheckLimit(condition: boolean, maximumIterations: number, iterationCount: { value: number }): boolean {
    if (iterationCount.value >= maximumIterations) return false;
    iterationCount.value++;
    return condition;
}

/** Empire.8.cs 3897 CancelBlockade(BuiltObject builtObject). */
export function cancelBlockadeBuiltObject(galaxy: Galaxy, self: Empire, builtObject: BuiltObject): void {
    void self;
    let blockade = blockadeFor(galaxy, builtObject);
    const iterationCount = { value: 0 };
    while (conditionCheckLimit(blockade !== null, 50, iterationCount)) {
        const b = blockade!;
        if (b.initiator !== null && b.initiator.shipGroups !== null) {
            for (const shipGroup of empireShipGroups(b.initiator)) {
                shipGroupClearAllMissionsForTargetBuiltObject(galaxy, shipGroup, builtObject, BuiltObjectMissionType.Blockade);
            }
        }
        if (b.builtObject !== null) {
            b.builtObject.isBlockaded = false;
            const description = formatText(getText('The blockade of X has ended'), b.builtObject.name);
            if (b.builtObject.empire !== null) {
                sendMessageToEmpire(b.builtObject.empire, b.builtObject.empire, EmpireMessageType.BlockadeCancelled, b.builtObject, description);
            }
        }
        removeBlockade(galaxy, b);
        blockade = blockadeFor(galaxy, builtObject);
    }
}

/** Empire.8.cs 3924 CancelBlockade(Habitat colony). */
export function cancelBlockadeColony(galaxy: Galaxy, self: Empire, colony: Habitat): void {
    let blockade = blockadeFor(galaxy, colony);
    const iterationCount = { value: 0 };
    while (conditionCheckLimit(blockade !== null, 50, iterationCount)) {
        const b = blockade!;
        const builtObject = determineSpacePortAtColony(galaxy, colony);
        if (builtObject !== null) cancelBlockadeBuiltObject(galaxy, self, builtObject);
        if (b.initiator !== null && b.initiator.shipGroups !== null && b.initiator.shipGroups !== null) {
            for (const shipGroup of empireShipGroups(b.initiator)) {
                shipGroupClearAllMissionsForTargetHabitat(galaxy, shipGroup, colony, BuiltObjectMissionType.Blockade);
            }
        }
        if (b.colony !== null) {
            b.colony.isBlockaded = false;
            const description = formatText(getText('The blockade of X has ended'), b.colony.name);
            if (b.colony.empire !== null) {
                sendMessageToEmpire(b.colony.empire, b.colony.empire, EmpireMessageType.BlockadeCancelled, b.colony, description);
            }
        }
        removeBlockade(galaxy, b);
        blockade = blockadeFor(galaxy, colony);
    }
}

/** Empire.2.cs 3938 CancelInactiveBlockades. */
export function cancelInactiveBlockadesImpl(galaxy: Galaxy, self: Empire): void {
    const blockadesForEmpire = getBlockadesForEmpire(galaxy, self);
    for (const item of blockadesForEmpire) {
        let flag = false;
        for (let i = 0; i < self.builtObjects.length; i++) {
            const builtObject = self.builtObjects[i];
            const mission = builtObjectMission(builtObject.mission);
            if (mission === null || mission.type !== BuiltObjectMissionType.Blockade) continue;
            if (item.targetIsColony) {
                if (mission.targetHabitat !== null && mission.targetHabitat === item.colony) {
                    flag = true;
                    break;
                }
                continue;
            }
            if (mission.targetBuiltObject !== null && mission.targetBuiltObject === item.builtObject) {
                flag = true;
                break;
            }
            if (mission.targetHabitat !== null && item.builtObject!.parentHabitat !== null && item.builtObject!.parentHabitat === mission.targetHabitat) {
                flag = true;
                break;
            }
        }
        if (!flag) {
            if (item.targetIsColony) cancelBlockadeColony(galaxy, self, item.colony!);
            else cancelBlockadeBuiltObject(galaxy, self, item.builtObject!);
        }
    }
}
