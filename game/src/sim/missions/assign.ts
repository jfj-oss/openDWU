// M4b — BuiltObject.AssignMission (BuiltObject.2.cs 7550-7732) and ClearPreviousMissionRequirements.
//
// Minimal stub added by M4d (freighter transport missions, logistics/freight.ts) while M4b ports the real body in
// parallel: the full C# overload (BuiltObject.2.cs 7620) with the defaults the short overloads pass
// (x = y = -2000000001.0, starDate = -1, allowReprocessing = true, manuallyAssigned = false). M4b replaces this file.

import type { Galaxy } from '../galaxy';
import type { BuiltObject } from '../builtObject';
import { BuiltObjectRole } from '../data/designSpecifications';
import { registerTodo, todo } from '../tick/todo';
import { BuiltObjectMission, type BuiltObjectMissionType } from './mission';

// BuiltObjectMissionPriority.cs (byte enum, declaration order = values).
export enum BuiltObjectMissionPriority {
    Undefined,
    Low,
    Normal,
    High,
    VeryHigh,
    Unavailable,
}

/** The x / y the short AssignMission overloads pass (BuiltObject.2.cs 7552-7607). */
export const ASSIGN_MISSION_NO_POSITION = -2000000001.0;

const T_assignMission = registerTodo('M4b', 'assignMission');
/**
 * BuiltObject.2.cs 7620 AssignMission(missionType, target, target2, cargo, troops, population, design, x, y, starDate,
 * priority, allowReprocessing, manuallyAssigned).
 *
 * Stub: only `if (Role == Base) return;` and `Mission = new BuiltObjectMission(...)` (7707-7709) are done, so a ship
 * given a mission is no longer idle for the idle-ship scans (DetermineAvailableFreighters etc.).
 * TODO(port) M4b: BaconBuiltObject.AssignMissionCheckPreconditions, RevertMission, hyperjump flags, battle stats,
 * pursuers, InitiateUndeploy, InitiateRefuelData, the mission's targets / cargo / commands, FirstExecutionOfCommand,
 * AttackRangeSquared.
 */
export function assignMission(
    galaxy: Galaxy,
    builtObject: BuiltObject,
    missionType: BuiltObjectMissionType,
    target: unknown,
    target2: unknown,
    cargo: unknown,
    troops: unknown,
    population: unknown,
    design: unknown,
    x: number,
    y: number,
    starDate: number,
    priority: BuiltObjectMissionPriority,
    allowReprocessing = true,
    manuallyAssigned = false,
): void {
    if (builtObject.role === BuiltObjectRole.Base) return;
    /* TODO(port) M4b */ todo(T_assignMission);
    builtObject.mission = new BuiltObjectMission(missionType);
}
