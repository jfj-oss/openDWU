// M4b — BuiltObjectMission / Command model (BuiltObjectMission.cs, Command.cs, BuiltObjectMissionType.cs).
//
// Created by M4a with only what the tick skeletons read (BuiltObject.cs 3669: Mission.Type for the InBattle flag and
// the idle-speed clamp, ShipGroup.Mission). M4b ports the rest (targets, command queue, AssignMission overloads,
// ClearPreviousMissionRequirements) into this module.

// BuiltObjectMissionType.cs (enum : byte, declaration order = values).
export enum BuiltObjectMissionType {
    Undefined,
    Explore,
    Build,
    BuildRepair,
    Transport,
    Patrol,
    Escort,
    Rescue,
    Blockade,
    Attack,
    Escape,
    Retire,
    Retrofit,
    Colonize,
    Waypoint,
    Hold,
    WaitAndAttack,
    WaitAndBombard,
    MoveAndWait,
    Refuel,
    ExtractResources,
    LoadTroops,
    UnloadTroops,
    Deploy,
    Undeploy,
    Repair,
    Move,
    Bombard,
    Capture,
    Reinforce,
    Raid,
}

/** BuiltObjectMission.cs (skeleton). TODO(port) M4b: targets, commands, priority, starDate, … */
export class BuiltObjectMission {
    type: BuiltObjectMissionType;

    constructor(type: BuiltObjectMissionType = BuiltObjectMissionType.Undefined) {
        this.type = type;
    }
}

/** BuiltObject.Mission as the typed value (builtObject.ts declares it `unknown`). */
export function builtObjectMission(mission: unknown): BuiltObjectMission | null {
    return (mission as BuiltObjectMission | null) ?? null;
}
