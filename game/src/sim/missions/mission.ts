// M4b — BuiltObjectMission / Command model: BuiltObjectMission.cs (1033), Command.cs (324), CommandQueue.cs,
// BuiltObjectMissionType.cs, CommandAction.cs, BuiltObjectMissionPriority.cs, BuiltObjectMissionList.cs, Sector.
//
// Statement-for-statement port. C# `float` fields (mission X/Y, command Xpos/Ypos/TargetRelative*) are kept as
// float32 values (Math.fround); the C# "unset" sentinels differ between the two classes and are kept exactly:
//   BuiltObjectMission: -2.00001E+09f  (float ⇒ -2000009984)   tests are `> -2E+09f` / `> -2000000000.0`
//   Command:            -2.00000013E+09f (float ⇒ -2000000128) tests are `> -2E+09f` / `> -2000000001.0`
// The command queue (CommandQueue : Queue<Command>) is an array: Peek = [0], Dequeue = shift, Enqueue = push.
// No Galaxy.Rnd in this file except GenerateParkCommand (→ Galaxy.SelectRelativeParkingPoint, 3 draws).
// ResolveCommandsForMission (BaconBuiltObjectMission.cs) lives in resolveCommands.ts.

import { BuiltObject } from '../builtObject';
import { Habitat } from '../types';
import { Creature } from '../creature';
import { ShipGroup } from '../fleets/shipGroup';
import { BuiltObjectRole } from '../data/designSpecifications';
import { Cargo, CargoList, TroopList } from '../cargo';
import { Population, PopulationList } from '../population';
import type { Design } from '../design';
import type { Empire } from '../empire';
import type { Galaxy } from '../galaxy';
import { clearPreviousMissionRequirements } from './assign';
import { loadMoreCargo, resolveCommandsForMission } from './resolveCommands';

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

// CommandAction.cs (enum : byte, declaration order = values).
export enum CommandAction {
    Hold,
    ImpulseTo,
    MoveTo,
    SprintTo,
    HyperTo,
    ConditionalHyperTo,
    Escort,
    Dock,
    Undock,
    Load,
    Unload,
    Attack,
    Refuel,
    Build,
    Scrap,
    Retrofit,
    Repair,
    SelfDestruct,
    RepeatSubsequentCommands,
    EvaluateThreats,
    SelectTargetToAttack,
    ReassignMission,
    SetParent,
    ClearParent,
    ClearAttackers,
    Blockade,
    Colonize,
    ExtractResources,
    ScanArea,
    Deploy,
    Undeploy,
    Bombard,
    Capture,
    Raid,
    HoldSyncFleet,
}

// BuiltObjectMissionPriority.cs (enum : byte).
export enum BuiltObjectMissionPriority {
    Undefined,
    Low,
    Normal,
    High,
    VeryHigh,
    Unavailable,
}

/** Sector.cs (X, Y sector coordinates). */
export class Sector {
    x: number;
    y: number;
    constructor(x: number, y: number) {
        this.x = x;
        this.y = y;
    }
}

/** C# StellarObject as the mission/command target base (BuiltObject | Habitat | Creature). */
export type StellarObject = BuiltObject | Habitat | Creature;
/** `object target` of the mission constructors / AssignMission overloads. */
export type MissionTarget = StellarObject | ShipGroup | Sector;

/** BuiltObjectMission.cs 52-53 `-2.00001E+09f` as the float32 it is. */
export const MISSION_COORD_UNSET = Math.fround(-2.00001e9);
/** Command.cs `-2.00000013E+09f` as the float32 it is. */
export const COMMAND_COORD_UNSET = Math.fround(-2.00000013e9);
/** `-2000000001.0` / `-2000000000.0` thresholds used by the C# comparisons. */
export const COORD_UNSET_DOUBLE = -2000000001.0;

export function isBuiltObject(o: unknown): o is BuiltObject {
    return o instanceof BuiltObject;
}
export function isHabitat(o: unknown): o is Habitat {
    return o instanceof Habitat;
}
export function isCreature(o: unknown): o is Creature {
    return o instanceof Creature;
}
export function isShipGroup(o: unknown): o is ShipGroup {
    return o instanceof ShipGroup;
}
export function isSector(o: unknown): o is Sector {
    return o instanceof Sector;
}

/** CargoList.Clone (CargoList.cs 767): resource entries cloned with amount, empire and reserved. TODO(port) M4d: component cargo. */
export function cloneCargoList(list: CargoList): CargoList {
    const cargoList = new CargoList();
    for (let index = 0; index < list.items.length; ++index) {
        const cargo2 = list.items[index];
        cargoList.add(new Cargo(cargo2.commodity, cargo2.amount, cargo2.empire, cargo2.reserved));
    }
    return cargoList;
}

/** PopulationList.Clone (PopulationList.cs 16). */
export function clonePopulationList(list: PopulationList): PopulationList {
    const populationList = new PopulationList();
    for (const population of list.items) {
        populationList.add(new Population(population.race, population.amount));
    }
    populationList.recalculateTotalAmount();
    return populationList;
}

// ---------------------------------------------------------------------------------------------------------------
// Command.cs
// ---------------------------------------------------------------------------------------------------------------

/** Command.cs — one step of a mission's command queue. */
export class Command {
    private _action: CommandAction;
    private _xpos = 0; // float
    private _ypos = 0; // float
    private _targetRelativeXpos = 0; // float
    private _targetRelativeYpos = 0; // float
    private _starDate = 0; // long
    private _targetStellarObject: StellarObject | null = null;
    private _targetShipGroup: ShipGroup | null = null;
    private _commodities: CargoList | null = null;
    private _design: Design | null = null;
    private _troops: TroopList | null = null;
    private _population: PopulationList | null = null;

    /**
     * Command.cs 118 `Command(CommandAction action)`: Xpos/Ypos unset, StarDate -1. The other C# constructors are
     * the static factories below (all set the same defaults then one extra field).
     */
    constructor(action: CommandAction) {
        this._action = action;
        this._xpos = COMMAND_COORD_UNSET;
        this._ypos = COMMAND_COORD_UNSET;
        this._starDate = -1;
    }

    /** Command.cs 92 twelve-argument constructor (used by Clone). */
    static full(
        action: CommandAction,
        x: number,
        y: number,
        relativeX: number,
        relativeY: number,
        starDate: number,
        targetStellarObject: StellarObject | null,
        targetShipGroup: ShipGroup | null,
        cargoList: CargoList | null,
        design: Design | null,
        troops: TroopList | null,
        population: PopulationList | null,
    ): Command {
        const c = new Command(action);
        c._xpos = Math.fround(x);
        c._ypos = Math.fround(y);
        c._targetRelativeXpos = Math.fround(relativeX);
        c._targetRelativeYpos = Math.fround(relativeY);
        c._starDate = starDate;
        c._targetStellarObject = targetStellarObject;
        c._targetShipGroup = targetShipGroup;
        c._commodities = cargoList;
        c._design = design;
        c._troops = troops;
        c._population = population;
        return c;
    }

    /** Command.cs 126 `Command(action, CargoList)`. */
    static withCargo(action: CommandAction, cargoList: CargoList | null): Command {
        const c = new Command(action);
        c._commodities = cargoList;
        return c;
    }

    /**
     * Command.cs 134-166 `Command(action, BuiltObject | Habitat | ShipGroup | Creature target)`: the target setter
     * chosen by the static type (a null target stays a plain command).
     */
    static forTarget(action: CommandAction, target: StellarObject | ShipGroup | null): Command {
        const c = new Command(action);
        if (target === null) return c;
        if (isShipGroup(target)) {
            c.targetShipGroup = target;
        } else {
            // TargetBuiltObject / TargetHabitat / TargetCreature setters all do the same assignment.
            c.setTargetStellarObject(target);
        }
        return c;
    }

    /** Command.cs 174 `Command(action, long starDate)`. */
    static withStarDate(action: CommandAction, starDate: number): Command {
        const c = new Command(action);
        c._starDate = starDate;
        return c;
    }

    /** Command.cs 182 `Command(action, Design)`. */
    static withDesign(action: CommandAction, design: Design | null): Command {
        const c = new Command(action);
        c._design = design;
        return c;
    }

    /** Command.cs 191 `Command(action, TroopList)`. */
    static withTroops(action: CommandAction, troops: TroopList | null): Command {
        const c = new Command(action);
        c._troops = troops;
        return c;
    }

    /** Command.cs 200 `Command(action, PopulationList)`. */
    static withPopulation(action: CommandAction, population: PopulationList | null): Command {
        const c = new Command(action);
        c._population = population;
        return c;
    }

    /** Command.cs 209 `Command(action, double x, double y)`: `<= -2000000001.0` → unset. */
    static at(action: CommandAction, x: number, y: number): Command {
        const c = new Command(action);
        c._xpos = Math.fround(x);
        c._ypos = Math.fround(y);
        if (x <= -2000000001.0) c._xpos = COMMAND_COORD_UNSET;
        if (y <= -2000000001.0) c._ypos = COMMAND_COORD_UNSET;
        c._starDate = -1;
        return c;
    }

    /** Command.cs 90 Clone(): same fields (target / cargo / design references shared). */
    clone(): Command {
        return Command.full(this._action, this._xpos, this._ypos, this._targetRelativeXpos, this._targetRelativeYpos, this._starDate, this._targetStellarObject, this._targetShipGroup, this._commodities, this._design, this._troops, this._population);
    }

    get xpos(): number { return this._xpos; }
    set xpos(v: number) { this._xpos = Math.fround(v); }
    get ypos(): number { return this._ypos; }
    set ypos(v: number) { this._ypos = Math.fround(v); }

    /** Command.cs 233: values `<= -2000000000.0` are stored as the unset sentinel. */
    get targetRelativeXpos(): number { return this._targetRelativeXpos; }
    set targetRelativeXpos(value: number) {
        this._targetRelativeXpos = Math.fround(value);
        if (value > -2000000000.0) return;
        this._targetRelativeXpos = COMMAND_COORD_UNSET;
    }
    get targetRelativeYpos(): number { return this._targetRelativeYpos; }
    set targetRelativeYpos(value: number) {
        this._targetRelativeYpos = Math.fround(value);
        if (value > -2000000000.0) return;
        this._targetRelativeYpos = COMMAND_COORD_UNSET;
    }

    get action(): CommandAction { return this._action; }
    set action(v: CommandAction) { this._action = v; }
    get commodities(): CargoList | null { return this._commodities; }
    set commodities(v: CargoList | null) { this._commodities = v; }
    get troops(): TroopList | null { return this._troops; }
    set troops(v: TroopList | null) { this._troops = v; }
    get population(): PopulationList | null { return this._population; }
    set population(v: PopulationList | null) { this._population = v; }
    get design(): Design | null { return this._design; }
    set design(v: Design | null) { this._design = v; }
    get starDate(): number { return this._starDate; }
    set starDate(v: number) { this._starDate = v; }

    /** The raw StellarObject target (C# private _TargetStellarObject). */
    get targetStellarObject(): StellarObject | null { return this._targetStellarObject; }

    /** Command.cs 281-300 TargetBuiltObject / TargetCreature / TargetHabitat setters (clear the ship-group target). */
    setTargetStellarObject(value: StellarObject | null): void {
        this._targetStellarObject = value;
        this._targetShipGroup = null;
    }

    get targetBuiltObject(): BuiltObject | null {
        return isBuiltObject(this._targetStellarObject) ? this._targetStellarObject : null;
    }
    set targetBuiltObject(value: BuiltObject | null) { this.setTargetStellarObject(value); }
    get targetCreature(): Creature | null {
        return isCreature(this._targetStellarObject) ? this._targetStellarObject : null;
    }
    set targetCreature(value: Creature | null) { this.setTargetStellarObject(value); }
    get targetHabitat(): Habitat | null {
        return isHabitat(this._targetStellarObject) ? this._targetStellarObject : null;
    }
    set targetHabitat(value: Habitat | null) { this.setTargetStellarObject(value); }
    get targetShipGroup(): ShipGroup | null { return this._targetShipGroup; }
    set targetShipGroup(value: ShipGroup | null) {
        this._targetStellarObject = null;
        this._targetShipGroup = value;
    }
}

// ---------------------------------------------------------------------------------------------------------------
// BuiltObjectMission.cs
// ---------------------------------------------------------------------------------------------------------------

/** Options for the 15-argument constructor (BuiltObjectMission.cs 442); every C# overload is a subset. */
export interface MissionArgs {
    cargo?: CargoList | null;
    troops?: TroopList | null;
    population?: PopulationList | null;
    design?: Design | null;
    x?: number;
    y?: number;
    starDate?: number;
    allowReprocessing?: boolean;
    allowBuiltObjectChanges?: boolean;
    specifiedAsFleetMission?: boolean;
}

export class BuiltObjectMission {
    _builtObject: BuiltObject | null;
    _galaxy: Galaxy;
    /** C# private CommandQueue _Commands (never null after construction; ReplaceCommandStack may pass any queue). */
    private _commands: Command[] = [];
    private _missionTargetStellarObject: StellarObject | null = null;
    private _missionTargetShipGroup: ShipGroup | null = null;
    private _missionTargetStellarObject2: StellarObject | null = null;
    private _missionTargetShipGroup2: ShipGroup | null = null;
    private _missionTargetIsBuiltObject = false;
    private _missionTarget2IsBuiltObject = false;
    private _missionCargo: CargoList | null = null;
    private _missionDesign: Design | null = null;
    private _missionTroopList: TroopList | null = null;
    private _missionPopulationList: PopulationList | null = null;
    private _missionXCoord = MISSION_COORD_UNSET; // float
    private _missionYCoord = MISSION_COORD_UNSET; // float
    private _missionPriority: BuiltObjectMissionPriority = BuiltObjectMissionPriority.Undefined;
    private _starDate = 0; // long
    private _manuallyAssigned = false;
    private _repeatCommands = false;
    private _isShipGroupMission = false;
    type: BuiltObjectMissionType = BuiltObjectMissionType.Undefined;
    previousType: BuiltObjectMissionType = BuiltObjectMissionType.Undefined;
    private _targetSector: Sector | null = null;

    get isShipGroupMission(): boolean { return this._isShipGroupMission; }
    set isShipGroupMission(v: boolean) { this._isShipGroupMission = v; }
    get manuallyAssigned(): boolean { return this._manuallyAssigned; }
    set manuallyAssigned(v: boolean) { this._manuallyAssigned = v; }
    get repeatCommands(): boolean { return this._repeatCommands; }
    set repeatCommands(v: boolean) { this._repeatCommands = v; }
    get cargo(): CargoList | null { return this._missionCargo; }
    get troops(): TroopList | null { return this._missionTroopList; }
    get population(): PopulationList | null { return this._missionPopulationList; }
    get design(): Design | null { return this._missionDesign; }
    get x(): number { return this._missionXCoord; }
    get y(): number { return this._missionYCoord; }
    get starDate(): number { return this._starDate; }
    get priority(): BuiltObjectMissionPriority { return this._missionPriority; }

    /** BuiltObjectMission.cs 124 Target: the stellar object if any, else the ship group, else null. */
    get target(): StellarObject | ShipGroup | null {
        if (this._missionTargetStellarObject !== null) return this._missionTargetStellarObject;
        if (this._missionTargetShipGroup !== null) return this._missionTargetShipGroup;
        return null;
    }

    /** BuiltObjectMission.cs 140 SecondaryTarget. */
    get secondaryTarget(): StellarObject | ShipGroup | null {
        if (this._missionTargetStellarObject2 !== null) return this._missionTargetStellarObject2;
        if (this._missionTargetShipGroup2 !== null) return this._missionTargetShipGroup2;
        return null;
    }

    get targetSector(): Sector | null { return this._targetSector; }

    /** BuiltObjectMission.cs 158 TargetBuiltObject (getter keyed on the _MissionTargetIsBuiltObject flag). */
    get targetBuiltObject(): BuiltObject | null {
        if (this._missionTargetIsBuiltObject) return this._missionTargetStellarObject as BuiltObject;
        return null;
    }
    set targetBuiltObject(value: BuiltObject | null) {
        this._missionTargetStellarObject = value;
        this._missionTargetIsBuiltObject = true;
        this._missionTargetShipGroup = null;
        this._missionXCoord = MISSION_COORD_UNSET;
        this._missionYCoord = MISSION_COORD_UNSET;
    }

    get targetHabitat(): Habitat | null {
        return isHabitat(this._missionTargetStellarObject) ? this._missionTargetStellarObject : null;
    }
    set targetHabitat(value: Habitat | null) {
        this._missionTargetStellarObject = value;
        this._missionTargetIsBuiltObject = false;
        this._missionTargetShipGroup = null;
        this._missionXCoord = MISSION_COORD_UNSET;
        this._missionYCoord = MISSION_COORD_UNSET;
    }

    get targetCreature(): Creature | null {
        return isCreature(this._missionTargetStellarObject) ? this._missionTargetStellarObject : null;
    }
    set targetCreature(value: Creature | null) {
        this._missionTargetStellarObject = value;
        this._missionTargetIsBuiltObject = false;
        this._missionTargetShipGroup = null;
        this._missionXCoord = MISSION_COORD_UNSET;
        this._missionYCoord = MISSION_COORD_UNSET;
    }

    get targetShipGroup(): ShipGroup | null { return this._missionTargetShipGroup; }
    set targetShipGroup(value: ShipGroup | null) {
        this._missionTargetStellarObject = null;
        this._missionTargetIsBuiltObject = false;
        this._missionTargetShipGroup = value;
        this._missionXCoord = MISSION_COORD_UNSET;
        this._missionYCoord = MISSION_COORD_UNSET;
    }

    get secondaryTargetBuiltObject(): BuiltObject | null {
        if (this._missionTarget2IsBuiltObject) return this._missionTargetStellarObject2 as BuiltObject;
        return null;
    }
    set secondaryTargetBuiltObject(value: BuiltObject | null) {
        this._missionTargetStellarObject2 = value;
        this._missionTarget2IsBuiltObject = true;
        this._missionTargetShipGroup2 = null;
    }

    get secondaryTargetHabitat(): Habitat | null {
        return isHabitat(this._missionTargetStellarObject2) ? this._missionTargetStellarObject2 : null;
    }
    set secondaryTargetHabitat(value: Habitat | null) {
        this._missionTargetStellarObject2 = value;
        this._missionTarget2IsBuiltObject = false;
        this._missionTargetShipGroup2 = null;
    }

    get secondaryTargetCreature(): Creature | null {
        return isCreature(this._missionTargetStellarObject2) ? this._missionTargetStellarObject2 : null;
    }
    set secondaryTargetCreature(value: Creature | null) {
        this._missionTargetStellarObject2 = value;
        this._missionTarget2IsBuiltObject = false;
        this._missionTargetShipGroup2 = null;
    }

    get secondaryTargetShipGroup(): ShipGroup | null { return this._missionTargetShipGroup2; }
    set secondaryTargetShipGroup(value: ShipGroup | null) {
        this._missionTargetStellarObject2 = null;
        this._missionTarget2IsBuiltObject = false;
        this._missionTargetShipGroup2 = value;
    }

    /** The raw C# _MissionTargetStellarObject (read by ResolveTargetCoordinates). */
    get missionTargetStellarObject(): StellarObject | null { return this._missionTargetStellarObject; }

    /**
     * BuiltObjectMission.cs 442 (the 15-argument constructor; 387-440 are the overloads, expressed through
     * `MissionArgs` defaults: cargo/troops/population/design null, x/y -2000000001.0, starDate -1,
     * allowReprocessing false, allowBuiltObjectChanges true, specifiedAsFleetMission false).
     */
    constructor(galaxy: Galaxy, builtObject: BuiltObject | null, missionType: BuiltObjectMissionType, target: MissionTarget | null, target2: MissionTarget | null, priority: BuiltObjectMissionPriority, args: MissionArgs = {}) {
        const cargo = args.cargo ?? null;
        const troops = args.troops ?? null;
        const population = args.population ?? null;
        const design = args.design ?? null;
        const x = args.x ?? COORD_UNSET_DOUBLE;
        const y = args.y ?? COORD_UNSET_DOUBLE;
        const starDate = args.starDate ?? -1;
        const allowReprocessing = args.allowReprocessing ?? false;
        const allowBuiltObjectChanges = args.allowBuiltObjectChanges ?? true;
        const specifiedAsFleetMission = args.specifiedAsFleetMission ?? false;
        this._galaxy = galaxy;
        this._builtObject = builtObject;
        // 446-473
        if (target !== null) {
            if (isBuiltObject(target)) {
                this.targetBuiltObject = target;
            } else if (isHabitat(target)) {
                this.targetHabitat = target;
            } else if (isCreature(target)) {
                this.targetCreature = target;
            } else if (isShipGroup(target)) {
                this.targetShipGroup = target;
            } else if (isSector(target)) {
                this._targetSector = target;
            }
        } else {
            this._missionTargetStellarObject = null;
            this._missionTargetShipGroup = null;
        }
        // 474-497
        if (target2 !== null) {
            if (isBuiltObject(target2)) {
                this.secondaryTargetBuiltObject = target2;
            } else if (isHabitat(target2)) {
                this.secondaryTargetHabitat = target2;
            } else if (isCreature(target2)) {
                this.secondaryTargetCreature = target2;
            } else if (isShipGroup(target2)) {
                this.secondaryTargetShipGroup = target2;
            }
        } else {
            this._missionTargetStellarObject2 = null;
            this._missionTargetShipGroup2 = null;
        }
        // 498-518
        this._missionCargo = cargo;
        this._missionTroopList = troops;
        this._missionPopulationList = population;
        if (this._missionPopulationList !== null) {
            this._missionPopulationList.recalculateTotalAmount();
        }
        this._missionDesign = design;
        this._missionXCoord = Math.fround(x);
        this._missionYCoord = Math.fround(y);
        if (x <= -2000000000.0) {
            this._missionXCoord = MISSION_COORD_UNSET;
        }
        if (y <= -2000000000.0) {
            this._missionYCoord = MISSION_COORD_UNSET;
        }
        this._starDate = starDate;
        this._missionPriority = priority;
        this.type = missionType;
        // 519-521
        const resolved = resolveCommandsForMission(this, this, allowReprocessing, specifiedAsFleetMission);
        // C# `_Commands = ResolveCommandsForMission(...)` may store null (Build on a non-shipyard, 262); the
        // queue accessors are null-tolerant in C#, so an empty array stands in for null here.
        this._commands = resolved.commands ?? [];
        loadMoreCargo(this, builtObject);
        // 522-530
        if (!resolved.couldResolveCommands) {
            if (this._builtObject !== null && allowBuiltObjectChanges) {
                clearPreviousMissionRequirements(galaxy, this._builtObject);
            }
            this.clear();
            return;
        }
        // 531-538 (C# dereferences builtObject here: a null builtObject with resolvable commands throws in C#).
        if (builtObject!.role !== BuiltObjectRole.Base && allowBuiltObjectChanges) {
            this._builtObject!.parentBuiltObject = null;
            this._builtObject!.parentHabitat = null;
            this._builtObject!.parentOffsetX = -2000000001.0;
            this._builtObject!.parentOffsetY = -2000000001.0;
        }
        this._repeatCommands = false;
    }

    /** BuiltObjectMission.cs 541 ResolveMissionTargetEmpire. */
    static resolveMissionTargetEmpire(mission: BuiltObjectMission): Empire | null {
        let result: Empire | null = null;
        if (mission.targetBuiltObject !== null) {
            result = mission.targetBuiltObject.empire;
        } else if (mission.targetHabitat !== null) {
            result = mission.targetHabitat.empire;
        } else if (mission.targetShipGroup !== null) {
            result = mission.targetShipGroup.empire;
        }
        return result;
    }

    /** BuiltObjectMission.cs 562 ResolveMissionSecondaryTargetEmpire. */
    static resolveMissionSecondaryTargetEmpire(mission: BuiltObjectMission): Empire | null {
        let result: Empire | null = null;
        if (mission.secondaryTargetBuiltObject !== null) {
            result = mission.secondaryTargetBuiltObject.empire;
        } else if (mission.secondaryTargetHabitat !== null) {
            result = mission.secondaryTargetHabitat.empire;
        } else if (mission.secondaryTargetShipGroup !== null) {
            result = mission.secondaryTargetShipGroup.empire;
        }
        return result;
    }

    /** BuiltObjectMission.cs 583 Clone(): re-resolves commands (allowReprocessing, no ship changes), then copies the stack. */
    clone(): BuiltObjectMission {
        const builtObjectMission = new BuiltObjectMission(this._galaxy, this._builtObject, this.type, this.target, this.secondaryTarget, this.priority, {
            cargo: this.cargo,
            troops: this.troops,
            population: this.population,
            design: this.design,
            x: this.x,
            y: this.y,
            starDate: this.starDate,
            allowReprocessing: true,
            allowBuiltObjectChanges: false,
        });
        builtObjectMission.setTargetSector(this.targetSector);
        builtObjectMission.replaceCommandStack(this._commands);
        builtObjectMission.repeatCommands = this._repeatCommands;
        return builtObjectMission;
    }

    /** BuiltObjectMission.cs 592 Clear(). */
    clear(): void {
        if (this._commands !== null) {
            this._commands.length = 0;
        }
        this.type = BuiltObjectMissionType.Undefined;
        this._missionPriority = BuiltObjectMissionPriority.Undefined;
        this.targetBuiltObject = null;
        this.secondaryTargetBuiltObject = null;
        this._missionDesign = null;
        this._missionCargo = null;
        this._missionTroopList = new TroopList();
        this._missionPopulationList = new PopulationList();
        this._repeatCommands = false;
        this._starDate = 0;
        this._missionXCoord = MISSION_COORD_UNSET;
        this._missionYCoord = MISSION_COORD_UNSET;
        this._manuallyAssigned = false;
        this._repeatCommands = false;
    }

    /** BuiltObjectMission.cs 617 CompleteCommandIfMatchesAction. */
    completeCommandIfMatchesAction(matchAction: CommandAction): boolean {
        let result = false;
        if (this._commands.length > 0) {
            const command = this._commands[0];
            if (command != null && command.action === matchAction) {
                this._commands.shift();
                result = true;
            }
        }
        if (this._commands.length === 0) {
            this.previousType = this.type;
            this.type = BuiltObjectMissionType.Undefined;
        }
        return result;
    }

    /** BuiltObjectMission.cs 645/650 CompleteCommand([ignoreRepeatCommands]). */
    completeCommand(ignoreRepeatCommands = false): void {
        if (this._commands.length > 0) {
            const item = this._commands.shift()!;
            if (!ignoreRepeatCommands && this._repeatCommands) {
                this._commands.push(item);
            }
        }
        if (this._commands.length === 0) {
            this.previousType = this.type;
            this.type = BuiltObjectMissionType.Undefined;
        }
    }

    /** BuiltObjectMission.cs 670 FastPeekCurrentCommand. */
    fastPeekCurrentCommand(): Command | null {
        if (this._commands !== null && this._commands.length > 0) {
            return this._commands[0];
        }
        return null;
    }

    /** BuiltObjectMission.cs 682 ShowCurrentCommand. */
    showCurrentCommand(): Command | null {
        if (this._commands === null) return null;
        if (this._commands.length <= 0) return null;
        return this._commands[0];
    }

    /** BuiltObjectMission.cs 703 ShowNextCommand. */
    showNextCommand(): Command | null {
        if (this._commands.length > 1) return this._commands[1];
        return null;
    }

    /** BuiltObjectMission.cs 720 ShowAllCommands (a copy, as ToArray). */
    showAllCommands(): Command[] {
        return this._commands.slice();
    }

    /** BuiltObjectMission.cs 733 InsertCommandAtTop. */
    insertCommandAtTop(command: Command): void {
        this._commands.unshift(command);
    }

    /** BuiltObjectMission.cs 754 AddCommandToEnd. */
    addCommandToEnd(command: Command): void {
        this._commands.push(command);
    }

    /** BuiltObjectMission.cs 766 ReplaceCommandStack: the queue object itself is shared (C# assigns the reference). */
    replaceCommandStack(commands: Command[]): void {
        this._commands = commands;
    }

    /** BuiltObjectMission.cs 774 CheckCommandsPastPrimaryTarget. */
    checkCommandsPastPrimaryTarget(primaryTarget: BuiltObject | null): boolean {
        if (this._commands !== null) {
            for (const command of this._commands) {
                if (command != null && command.targetBuiltObject === primaryTarget) {
                    return false;
                }
            }
        }
        return true;
    }

    /** BuiltObjectMission.cs 792/810 CheckCommandsForAction(action[, maxSteps]). */
    checkCommandsForAction(action: CommandAction, maxSteps?: number): boolean {
        if (this._commands !== null) {
            if (maxSteps === undefined) {
                for (const command of this._commands) {
                    if (command != null && command.action === action) return true;
                }
            } else {
                let num = 0;
                for (const command of this._commands) {
                    num++;
                    if (num <= maxSteps) {
                        if (command != null && command.action === action) return true;
                        continue;
                    }
                    break;
                }
            }
        }
        return false;
    }

    /** BuiltObjectMission.cs 835 GetNextDockCommand (sic: it returns the first Undock command). */
    getNextDockCommand(): Command | null {
        if (this._commands !== null) {
            for (const command of this._commands) {
                if (command != null && command.action === CommandAction.Undock) return command;
            }
        }
        return null;
    }

    /** BuiltObjectMission.cs 853 CheckCommandsForUndock. */
    checkCommandsForUndock(): boolean {
        if (this._commands !== null) {
            for (const command of this._commands) {
                if (command != null && command.action === CommandAction.Undock) return true;
            }
        }
        return false;
    }

    /** BuiltObjectMission.cs 871 CheckCommandsForHyperjump. */
    checkCommandsForHyperjump(): boolean {
        if (this._commands !== null) {
            for (const command of this._commands) {
                if (command != null && command.action === CommandAction.HyperTo) return true;
            }
        }
        return false;
    }

    /** BuiltObjectMission.cs 889 CheckCommandsForHyperjumpOrConditionalJump. */
    checkCommandsForHyperjumpOrConditionalJump(): boolean {
        if (this._commands !== null) {
            for (const command of this._commands) {
                // C#: `(command != null && Action == HyperTo) || command.Action == ConditionalHyperTo` (null → throws).
                if ((command != null && command.action === CommandAction.HyperTo) || command.action === CommandAction.ConditionalHyperTo) return true;
            }
        }
        return false;
    }

    /** BuiltObjectMission.cs 907 EnsureCoordsInGalaxy (Galaxy.SizeX/SizeY statics → galaxy fields). */
    ensureCoordsInGalaxy(x: number, y: number): { x: number; y: number } {
        return ensureCoordsInGalaxy(this._galaxy, x, y);
    }

    /** BuiltObjectMission.cs 913 ResolveTargetCoordinatesCurrentCommand → Point ((int)x, (int)y) or Point.Empty. */
    resolveTargetCoordinatesCurrentCommand(): { x: number; y: number } {
        const command = this.fastPeekCurrentCommand();
        if (command !== null) {
            let x = -1.0;
            let y = -1.0;
            if (command.targetBuiltObject !== null) {
                x = command.targetBuiltObject.xpos;
                y = command.targetBuiltObject.ypos;
            } else if (command.targetHabitat !== null) {
                x = command.targetHabitat.xpos;
                y = command.targetHabitat.ypos;
            } else if (command.targetCreature !== null) {
                x = command.targetCreature.xpos;
                y = command.targetCreature.ypos;
            } else if (command.targetShipGroup !== null) {
                if (command.targetShipGroup.leadShip !== null) {
                    x = command.targetShipGroup.leadShip.xpos;
                    y = command.targetShipGroup.leadShip.ypos;
                }
            } else if (command.xpos > -2000000001.0 && command.ypos > -2000000001.0) {
                x = command.xpos;
                y = command.ypos;
            }
            const p = this.ensureCoordsInGalaxy(x, y);
            return { x: Math.trunc(p.x), y: Math.trunc(p.y) };
        }
        return { x: 0, y: 0 };
    }

    /** BuiltObjectMission.cs 954 ResolveMissionTargetHabitatIfPossible. */
    resolveMissionTargetHabitatIfPossible(): StellarObject | null {
        let result: StellarObject | null = null;
        const targetHabitat = this.targetHabitat;
        const targetBuiltObject = this.targetBuiltObject;
        const targetCreature = this.targetCreature;
        const targetShipGroup = this.targetShipGroup;
        if (targetHabitat !== null) {
            result = targetHabitat;
        } else if (targetBuiltObject !== null) {
            result = targetBuiltObject.parentHabitat !== null ? targetBuiltObject.parentHabitat : targetBuiltObject.nearestSystemStar === null ? targetBuiltObject : targetBuiltObject.nearestSystemStar;
        } else if (targetCreature !== null) {
            result = targetCreature.parentHabitat !== null ? targetCreature.parentHabitat : targetCreature.nearestSystemStar === null ? targetCreature : targetCreature.nearestSystemStar;
        } else if (targetShipGroup !== null) {
            const leadShip = targetShipGroup.leadShip;
            if (leadShip !== null && leadShip.parentHabitat !== null) {
                result = leadShip.parentHabitat;
            } else if (leadShip !== null && leadShip.nearestSystemStar !== null) {
                result = leadShip.nearestSystemStar;
            }
        }
        return result;
    }

    /** BuiltObjectMission.cs 988 ResolveTargetCoordinates(mission) → Point ((int)x, (int)y). */
    resolveTargetCoordinates(mission: BuiltObjectMission): { x: number; y: number } {
        let x = -1.0;
        let y = -1.0;
        if (this._missionTargetStellarObject !== null) {
            x = this._missionTargetStellarObject.xpos;
            y = this._missionTargetStellarObject.ypos;
        } else if (this._missionTargetShipGroup !== null) {
            if (this._missionTargetShipGroup.leadShip !== null) {
                x = this._missionTargetShipGroup.leadShip.xpos;
                y = this._missionTargetShipGroup.leadShip.ypos;
            }
        } else if (mission.x > -2e9 && mission.y > -2e9) {
            x = mission.x;
            y = mission.y;
        }
        const p = this.ensureCoordsInGalaxy(x, y);
        return { x: Math.trunc(p.x), y: Math.trunc(p.y) };
    }

    /** BuiltObjectMission.cs 1014 GenerateParkCommand — Rnd: SelectRelativeParkingPoint (NextDouble, Next(0,2), NextDouble). */
    generateParkCommand(): Command {
        const command = new Command(CommandAction.MoveTo);
        const p = this._galaxy.selectRelativeParkingPoint();
        command.targetRelativeXpos = p.x;
        command.targetRelativeYpos = p.y;
        return command;
    }

    /** BuiltObjectMission.cs 1028 SetTargetSector. */
    setTargetSector(sector: Sector | null): void {
        this._targetSector = sector;
    }
}

/** BuiltObjectMission.cs 907 EnsureCoordsInGalaxy: clamp to [0, SizeX-1] × [0, SizeY-1]. */
export function ensureCoordsInGalaxy(galaxy: Galaxy, x: number, y: number): { x: number; y: number } {
    return {
        x: Math.max(0.0, Math.min(galaxy.sizeX - 1.0, x)),
        y: Math.max(0.0, Math.min(galaxy.sizeY - 1.0, y)),
    };
}

/** BuiltObjectMissionList.ContainsType (BuiltObjectMissionList.cs 12). */
export function missionListContainsType(list: readonly (BuiltObjectMission | null)[], missionType: BuiltObjectMissionType): boolean {
    for (let index = 0; index < list.length; ++index) {
        const builtObjectMission = list[index];
        if (builtObjectMission != null && builtObjectMission.type === missionType) return true;
    }
    return false;
}

/** BuiltObject.Mission as the typed value (builtObject.ts declares it `unknown`). */
export function builtObjectMission(mission: unknown): BuiltObjectMission | null {
    return (mission as BuiltObjectMission | null) ?? null;
}

/** BuiltObject.SubsequentMissions as the typed list (builtObject.ts declares it `unknown[]`). */
export function builtObjectSubsequentMissions(builtObject: BuiltObject): BuiltObjectMission[] {
    return builtObject.subsequentMissions as BuiltObjectMission[];
}
