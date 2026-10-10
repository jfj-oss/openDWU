// M4b — distress signals and declined tasks: DistressSignal.cs, DistressSignalType.cs, DeclinedTask.cs,
// Empire.3.cs 4898 ClearOutOldDistressSignals / 4915 ProcessDistressSignals, Empire.2.cs 3985 ClearOldDistressSignals,
// Empire.8.cs 4357 ClearExpiredDeclinedTasks, Empire.9.cs 1411 FindNearestFleet, ShipGroupList.cs 16
// DetermineFleetsTravellingToLocation, Galaxy.6.cs 3289 DetermineNearestHabitatIfPossible.
// Rnd: none here (the response fleet's AssignMission draws inside M4l).

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import type { BuiltObject } from '../builtObject';
import type { Habitat } from '../types';
import { BuiltObjectRole } from '../data/designSpecifications';
import { galaxyStarDate } from '../tick/simTime';
import { type ShipGroup, empireShipGroups, shipGroupAssignMission, shipGroupTotalOverallStrengthFactor } from '../fleets/shipGroup';
import { identifyNearestResponseFleet } from '../fleets/militaryAI';
import { determineDefendingStrength } from '../combat/threats';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, isBuiltObject, isCreature, isHabitat, isShipGroup, type StellarObject } from './mission';
import { Empire as EmpireClass } from '../empire';
import { IntelligenceMission } from '../characters';
import { intelligenceMissionTarget } from '../espionage';

// DistressSignalType.cs (declaration order = values).
export enum DistressSignalType {
    UnderAttack,
    NeedRefuelling,
    NeedRepair,
    GalacticDisaster,
    ColonyBombarded,
}

/** DistressSignal.cs. */
export class DistressSignal {
    private _sourceBuiltObject: BuiltObject | null;
    private _sourceHabitat: Habitat | null;
    private _date: number; // long
    private _type: DistressSignalType;
    private _attacker: Empire | null = null;
    attackStrength = 0;

    /** DistressSignal(BuiltObject | Habitat source, type, date). */
    constructor(source: BuiltObject | Habitat, type: DistressSignalType, date: number) {
        if (isBuiltObject(source)) {
            this._sourceBuiltObject = source;
            this._sourceHabitat = null;
        } else {
            this._sourceBuiltObject = null;
            this._sourceHabitat = source;
        }
        this._type = type;
        this._date = date;
    }

    get attacker(): Empire | null { return this._attacker; }
    set attacker(v: Empire | null) { this._attacker = v; }
    get date(): number { return this._date; }
    set date(v: number) { this._date = v; }
    get type(): DistressSignalType { return this._type; }
    set type(v: DistressSignalType) { this._type = v; }
    /** Source: the BuiltObject if set, else the Habitat, else null. */
    get source(): BuiltObject | Habitat | null {
        if (this._sourceBuiltObject !== null) return this._sourceBuiltObject;
        return this._sourceHabitat !== null ? this._sourceHabitat : null;
    }

    /** IComparable<DistressSignal>.CompareTo: by Date. */
    compareTo(other: DistressSignal): number {
        return this._date < other._date ? -1 : this._date > other._date ? 1 : 0;
    }
}

/** Galaxy.3.cs 5049 DistressSignalDateRange = 90000. */
export const DISTRESS_SIGNAL_DATE_RANGE = 90000;

/** DeclinedTask.cs (task target: BuiltObject | Habitat | IntelligenceMission | Empire, or an attack-empire target). */
export class DeclinedTask {
    private _expiryDate: number; // long
    private _taskTarget: unknown = null;
    private _attackEmpireTarget: Empire | null = null;

    constructor(expiryDate: number, taskTarget: unknown = null, attackEmpireTarget: Empire | null = null) {
        this._expiryDate = expiryDate;
        this._taskTarget = taskTarget;
        this._attackEmpireTarget = attackEmpireTarget;
    }

    get expiryDate(): number { return this._expiryDate; }
    set expiryDate(v: number) { this._expiryDate = v; }
    get attackEmpireTarget(): Empire | null { return this._attackEmpireTarget; }
    set attackEmpireTarget(v: Empire | null) { this._attackEmpireTarget = v; }
    get taskTarget(): unknown { return this._taskTarget; }
}

/** Empire.DistressSignals as the typed list (empire.ts declares it `unknown[]`). */
export function empireDistressSignals(empire: Empire): DistressSignal[] {
    return empire.distressSignals as DistressSignal[];
}

/** Empire.3.cs 4898 ClearOutOldDistressSignals: drop signals older than 50 000 star-date ms. */
export function clearOutOldDistressSignals(galaxy: Galaxy, empire: Empire): void {
    const distressSignals = empireDistressSignals(empire);
    const num = galaxyStarDate(galaxy) - 50000;
    const distressSignalList: DistressSignal[] = [];
    for (let i = 0; i < distressSignals.length; i++) {
        if (distressSignals[i].date < num) {
            distressSignalList.push(distressSignals[i]);
        }
    }
    for (let j = 0; j < distressSignalList.length; j++) {
        const index = distressSignals.indexOf(distressSignalList[j]);
        if (index >= 0) distressSignals.splice(index, 1);
    }
}

/** Empire.2.cs 3985 ClearOldDistressSignals: drop signals older than DistressSignalDateRange. */
export function clearOldDistressSignals(galaxy: Galaxy, empire: Empire): void {
    const distressSignals = empireDistressSignals(empire);
    const currentStarDate = galaxyStarDate(galaxy);
    const num = currentStarDate - DISTRESS_SIGNAL_DATE_RANGE;
    const distressSignalList: DistressSignal[] = [];
    for (let i = 0; i < distressSignals.length; i++) {
        const distressSignal = distressSignals[i];
        if (distressSignal.date < num) {
            distressSignalList.push(distressSignal);
        }
    }
    for (const item of distressSignalList) {
        const index = distressSignals.indexOf(item);
        if (index >= 0) distressSignals.splice(index, 1);
    }
}

/**
 * Leak fix (not in the C#): drop the distress signals of an empire whose DoTasks never clears them — a pirate faction
 * (DoTasksPirates, Empire.1.cs 4095, has no ClearOldDistressSignals / ClearOutOldDistressSignals) and the independent
 * empire (no DoTasks at all). Their lists are only read by CheckForMatchingSignal / CheckForMatchingSignalSameTargetType
 * (Galaxy.7.cs 2907 / 2942), which skip every signal with Date <= CurrentStarDate - DistressSignalDateRange; a skipped
 * signal stays skipped (the date never changes, time only grows), so removing exactly those changes nothing — but in the
 * original they and their source ships (often long destroyed) pile up all game. ProcessDistressSignals never runs for
 * them (pirates stay pirates, Empire.1.cs 4965 only moves the base; the independent empire is never queued, Main.Part12.cs
 * 3717 / 3736). Called from the galaxy long block (galaxyTick.ts). No Rnd.
 */
export function pruneUnreadDistressSignals(galaxy: Galaxy, empire: Empire): void {
    const distressSignals = empireDistressSignals(empire);
    const num = galaxyStarDate(galaxy) - DISTRESS_SIGNAL_DATE_RANGE;
    let j = 0;
    for (let i = 0; i < distressSignals.length; i++) {
        const distressSignal = distressSignals[i];
        if (distressSignal == null || distressSignal.date > num) distressSignals[j++] = distressSignal;
    }
    distressSignals.length = j;
}

/** Empire.8.cs 4357 ClearExpiredDeclinedTasks. */
export function clearExpiredDeclinedTasks(galaxy: Galaxy, empire: Empire): void {
    const declinedTasks = empire.declinedTasks;
    const currentStarDate = galaxyStarDate(galaxy);
    const declinedTaskList: DeclinedTask[] = [];
    for (let i = 0; i < declinedTasks.length; i++) {
        if (declinedTasks[i].expiryDate < currentStarDate) {
            declinedTaskList.push(declinedTasks[i]);
        }
    }
    for (const item of declinedTaskList) {
        const index = declinedTasks.indexOf(item);
        if (index >= 0) declinedTasks.splice(index, 1);
    }
}

// DeclinedTaskList.cs (SyncList<DeclinedTask>; Empire.DeclinedTasks is a plain DeclinedTask[] here).

/** DeclinedTaskList.cs IndexOf(object taskTarget): the first entry whose TaskTarget is the same BuiltObject / ShipGroup /
 *  Habitat / Empire, or — for an IntelligenceMission — an entry with the same TargetEmpire and Type whose Target is the
 *  same object or null. No Rnd. */
export function declinedTaskIndexOf(list: readonly DeclinedTask[], taskTarget: unknown): number {
    if (isBuiltObject(taskTarget)) {
        for (let index = 0; index < list.length; ++index) {
            if (isBuiltObject(list[index].taskTarget) && list[index].taskTarget === taskTarget) return index;
        }
    }
    if (isShipGroup(taskTarget)) {
        for (let index = 0; index < list.length; ++index) {
            if (isShipGroup(list[index].taskTarget) && list[index].taskTarget === taskTarget) return index;
        }
    }
    if (isHabitat(taskTarget)) {
        for (let index = 0; index < list.length; ++index) {
            if (isHabitat(list[index].taskTarget) && list[index].taskTarget === taskTarget) return index;
        }
    }
    if (taskTarget instanceof IntelligenceMission) {
        const intelligenceMission = taskTarget;
        for (let index = 0; index < list.length; ++index) {
            const t = list[index].taskTarget;
            if (t instanceof IntelligenceMission) {
                const taskTarget1 = t;
                const target1 = intelligenceMissionTarget(taskTarget1);
                if (
                    taskTarget1.targetEmpire === intelligenceMission.targetEmpire &&
                    taskTarget1.type === intelligenceMission.type &&
                    ((target1 !== null && target1 === intelligenceMissionTarget(intelligenceMission)) || target1 === null)
                ) {
                    return index;
                }
            }
        }
    }
    if (taskTarget instanceof EmpireClass) {
        for (let index = 0; index < list.length; ++index) {
            if (list[index].taskTarget instanceof EmpireClass && list[index].taskTarget === taskTarget) return index;
        }
    }
    return -1;
}

/** DeclinedTaskList.cs FindIndexForAttackEmpireTarget(attackEmpireTarget). No Rnd. */
export function declinedTaskFindIndexForAttackEmpireTarget(list: readonly DeclinedTask[], attackEmpireTarget: Empire): number {
    for (let index = 0; index < list.length; ++index) {
        if (list[index].attackEmpireTarget === attackEmpireTarget) return index;
    }
    return -1;
}

/** DeclinedTaskList.cs CheckTaskTargetValid(taskTarget, starDate): false while a matching entry has not expired. */
export function declinedTasksCheckTaskTargetValid(list: readonly DeclinedTask[], taskTarget: unknown, starDate: number): boolean {
    let flag = true;
    if (taskTarget != null) {
        const index = declinedTaskIndexOf(list, taskTarget);
        if (index >= 0 && list[index].expiryDate >= starDate) flag = false;
    }
    return flag;
}

/** DeclinedTaskList.cs CheckAttackEmpireTargetValid(attackEmpireTarget, starDate). */
export function declinedTasksCheckAttackEmpireTargetValid(list: readonly DeclinedTask[], attackEmpireTarget: Empire | null, starDate: number): boolean {
    let flag = true;
    if (attackEmpireTarget != null) {
        const index = declinedTaskFindIndexForAttackEmpireTarget(list, attackEmpireTarget);
        if (index >= 0 && list[index].expiryDate >= starDate) flag = false;
    }
    return flag;
}

/** The declined-task windows in star-date units (Empire.8.cs 4428 / 4433, Main.Part2.cs 2744 / 2751). */
export const DECLINED_ATTACK_EMPIRE_WINDOW = 240000;
export const DECLINED_TASK_TARGET_WINDOW = 600000;

/**
 * The `_DeclinedTasks.Add(...)` block shared by Empire.8.cs 4425-4449 (CheckTaskAuthorized) and Main.Part2.cs 2742-2767
 * (btnAdvisorSuggestionDecline_Click): an attack-empire entry for 240 000, and a task-target entry for 600 000 when the
 * target is a BuiltObject / Habitat / IntelligenceMission / Empire (other targets — ShipGroup, BuiltObjectList — record
 * nothing).
 */
export function addDeclinedTasks(declinedTasks: DeclinedTask[], currentStarDate: number, taskTarget: unknown, attackEmpireTarget: Empire | null): void {
    if (attackEmpireTarget != null) {
        const expiryDate = currentStarDate + DECLINED_ATTACK_EMPIRE_WINDOW;
        declinedTasks.push(new DeclinedTask(expiryDate, null, attackEmpireTarget));
    }
    if (taskTarget != null) {
        const expiryDate2 = currentStarDate + DECLINED_TASK_TARGET_WINDOW;
        if (isBuiltObject(taskTarget) || isHabitat(taskTarget) || taskTarget instanceof IntelligenceMission || taskTarget instanceof EmpireClass) {
            declinedTasks.push(new DeclinedTask(expiryDate2, taskTarget));
        }
    }
}

/** Galaxy.6.cs 3289 DetermineNearestHabitatIfPossible(target). */
export function determineNearestHabitatIfPossible(galaxy: Galaxy, target: StellarObject): StellarObject {
    void galaxy;
    let result: StellarObject = target;
    if (isHabitat(target)) {
        result = target;
    } else if (isBuiltObject(target)) {
        const builtObject = target;
        result = builtObject.parentHabitat !== null ? builtObject.parentHabitat : builtObject.nearestSystemStar === null ? builtObject : builtObject.nearestSystemStar;
    } else if (isCreature(target)) {
        const creature = target;
        result = creature.parentHabitat !== null ? creature.parentHabitat : creature.nearestSystemStar === null ? creature : creature.nearestSystemStar;
    }
    return result;
}

/** ShipGroupList.cs 16 DetermineFleetsTravellingToLocation(x, y, acceptableRange). */
export function determineFleetsTravellingToLocation(shipGroups: readonly (ShipGroup | null)[], x: number, y: number, acceptableRange: number): ShipGroup[] {
    const num1 = Math.trunc(x - acceptableRange);
    const num2 = Math.trunc(x + acceptableRange);
    const num3 = Math.trunc(y - acceptableRange);
    const num4 = Math.trunc(y + acceptableRange);
    const travellingToLocation: ShipGroup[] = [];
    for (let index = 0; index < shipGroups.length; ++index) {
        const shipGroup = shipGroups[index]!;
        if (shipGroup.mission !== null && shipGroup.mission.type !== BuiltObjectMissionType.Undefined) {
            const xpos = Math.trunc(shipGroup.leadShip!.xpos);
            const ypos = Math.trunc(shipGroup.leadShip!.ypos);
            if (xpos <= num1 || xpos >= num2 || ypos <= num3 || ypos >= num4) {
                const point = shipGroup.mission.resolveTargetCoordinates(shipGroup.mission);
                if (point.x > num1 && point.x < num2 && point.y > num3 && point.y < num4) travellingToLocation.push(shipGroup);
            }
        }
    }
    return travellingToLocation;
}

/** ShipGroupList.cs 74 CountTotalOverallStrengthFactor (ShipGroup.TotalOverallStrengthFactor is M4l). */
export function countTotalOverallStrengthFactor(galaxy: Galaxy, shipGroups: readonly ShipGroup[]): number {
    let num = 0;
    for (let index = 0; index < shipGroups.length; ++index) num += shipGroupTotalOverallStrengthFactor(galaxy, shipGroups[index]);
    return num;
}

/** Empire.9.cs 1411 FindNearestFleet(x, y). */
export function findNearestFleet(galaxy: Galaxy, empire: Empire, x: number, y: number): ShipGroup | null {
    let result: ShipGroup | null = null;
    let num = Number.MAX_VALUE;
    const shipGroups = empireShipGroups(empire);
    if (shipGroups !== null) {
        for (let i = 0; i < shipGroups.length; i++) {
            const shipGroup = shipGroups[i]!;
            if (shipGroup.leadShip !== null) {
                const num2 = galaxy.calculateDistance(x, y, shipGroup.leadShip.xpos, shipGroup.leadShip.ypos);
                if (num2 < num) {
                    result = shipGroup;
                    num = num2;
                }
            }
        }
    }
    return result;
}

/** Empire.3.cs 4915 ProcessDistressSignals. Galaxy.DistressSignalResponseMaximumDistance = SectorSize (Galaxy.3.cs 5030). */
export function processDistressSignals(galaxy: Galaxy, empire: Empire): void {
    const distressSignals = empireDistressSignals(empire);
    const shipGroups = empireShipGroups(empire);
    const distressSignalResponseMaximumDistance = galaxy.sectorSize;
    for (let i = 0; i < distressSignals.length; i++) {
        const distressSignal = distressSignals[i];
        const source = distressSignal.source;
        if (isBuiltObject(source)) {
            const builtObject = source;
            if (builtObject.role !== BuiltObjectRole.Base) {
                continue;
            }
            let num = determineDefendingStrength(galaxy, builtObject, empire);
            const shipGroupList = determineFleetsTravellingToLocation(shipGroups, builtObject.xpos, builtObject.ypos, 48000.0);
            num += countTotalOverallStrengthFactor(galaxy, shipGroupList);
            const num2 = Math.trunc(distressSignal.attackStrength * 0.75);
            if (num >= num2) {
                continue;
            }
            const shipGroup = identifyNearestResponseFleet(galaxy, empire, builtObject.xpos, builtObject.ypos, true, 0.1, 48000.0);
            if (shipGroup === null) {
                continue;
            }
            let flag = true;
            const num3 = galaxy.calculateDistance(builtObject.xpos, builtObject.ypos, shipGroup.leadShip!.xpos, shipGroup.leadShip!.ypos);
            if (num3 > distressSignalResponseMaximumDistance) {
                const shipGroup2 = findNearestFleet(galaxy, empire, builtObject.xpos, builtObject.ypos);
                if (shipGroup2 !== null && shipGroup2 !== shipGroup) {
                    flag = false;
                }
            }
            if (num3 > galaxy.sectorSize * 2) {
                flag = false;
            }
            if (flag) {
                const stellarObject = determineNearestHabitatIfPossible(galaxy, builtObject);
                if (stellarObject === null) {
                    shipGroupAssignMission(galaxy, shipGroup, BuiltObjectMissionType.Move, null, null, BuiltObjectMissionPriority.High, false, { x: builtObject.xpos, y: builtObject.ypos });
                } else {
                    shipGroupAssignMission(galaxy, shipGroup, BuiltObjectMissionType.Move, stellarObject, null, BuiltObjectMissionPriority.High, false);
                }
                shipGroup.allowImmediateThreatEvaluation = true;
                shipGroup.attackRangeSquared = Math.fround(Math.fround(empire.attackRangeAttack) * Math.fround(empire.attackRangeAttack));
            }
        } else {
            if (!isHabitat(source)) {
                continue;
            }
            const habitat = source;
            galaxy.determineHabitatSystemStar(habitat);
            let num4 = determineDefendingStrength(galaxy, habitat, empire);
            const shipGroupList2 = determineFleetsTravellingToLocation(shipGroups, habitat.xpos, habitat.ypos, 48000.0);
            num4 += countTotalOverallStrengthFactor(galaxy, shipGroupList2);
            const num5 = Math.trunc(distressSignal.attackStrength * 0.75);
            if (num4 >= num5) {
                continue;
            }
            const shipGroup3 = identifyNearestResponseFleet(galaxy, empire, habitat.xpos, habitat.ypos, true, 0.1, 48000.0);
            if (shipGroup3 === null) {
                continue;
            }
            let flag2 = true;
            const num6 = galaxy.calculateDistance(habitat.xpos, habitat.ypos, shipGroup3.leadShip!.xpos, shipGroup3.leadShip!.ypos);
            if (num6 > distressSignalResponseMaximumDistance) {
                const shipGroup4 = findNearestFleet(galaxy, empire, habitat.xpos, habitat.ypos);
                if (shipGroup4 !== null && shipGroup4 !== shipGroup3) {
                    flag2 = false;
                }
            }
            if (num6 > galaxy.sectorSize * 2) {
                flag2 = false;
            }
            if (flag2) {
                const stellarObject2 = determineNearestHabitatIfPossible(galaxy, habitat);
                if (stellarObject2 === null) {
                    shipGroupAssignMission(galaxy, shipGroup3, BuiltObjectMissionType.Move, habitat, null, BuiltObjectMissionPriority.High, false);
                } else {
                    shipGroupAssignMission(galaxy, shipGroup3, BuiltObjectMissionType.Move, stellarObject2, null, BuiltObjectMissionPriority.High, false);
                }
                shipGroup3.allowImmediateThreatEvaluation = true;
                shipGroup3.attackRangeSquared = Math.fround(Math.fround(empire.attackRangeAttack) * Math.fround(empire.attackRangeAttack));
            }
        }
    }
}
