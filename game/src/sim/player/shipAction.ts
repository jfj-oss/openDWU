// 17b — the player's order object: ShipAction (DistantWorlds.Types/ShipAction.cs), ShipActionType
// (DistantWorlds.Types/ShipActionType.cs) and the Main.Part8.cs 1496-1536 factories method_313/314/315 the order menu
// builds them with. ShipAction is a transient UI object ([Serializable] but never stored on Galaxy/Empire), so it is
// not registered with the save codec. Headless: no DOM / Pixi. No Rnd.

import type { Design } from '../design';
import { BuiltObjectMissionType } from '../missions/mission';
import type { SystemInfo } from '../types';
import { Habitat } from '../types';
import { Creature } from '../creature';

// ShipActionType.cs (enum, declaration order = values).
export enum ShipActionType {
    Undefined,
    RecruitTroops,
    AutomateShip,
    JoinShipGroup,
    LeaveShipGroup,
    SetAsLeadShipInGroup,
    AssignShipGroupHomeColony,
    ClearQueuedMissions,
    InvestigateRuins,
    InvestigateBuiltObject,
    ColonyTaxUp1,
    ColonyTaxUp5,
    ColonyTaxDown1,
    ColonyTaxDown5,
    BuildColonize,
    FighterOptions,
    FighterBuildFighter,
    FighterBuildBomber,
    FighterLaunchFighters,
    FighterLaunchBombers,
    FighterRetrieveFighters,
    FighterRetrieveBombers,
    BuildOptions,
    ReturnToTop,
    UnautomateShip,
    CreateNewFleet,
    ColonyBuildOptions,
    BuildPlanetaryFacility,
    AssignAttack,
    FighterUpgradeAll,
    SetFleetPosture,
    SetFleetRange,
    SetFleetAttackPoint,
    SetFleetHomeBase,
    TransferCharacter,
    ColonyBuildWonder,
    BuildOptionsPrivate,
    GeneratePirateMissionAttack,
    GeneratePirateMissionDefend,
    GeneratePirateMissionSmuggling,
    GiveBuiltObject,
    DeployVirus,
    DisbandShipGroup,
    ChangePirateHomeBase,
    /** Mod layer (19b/19f): a scenario threat's player action (extraData = the action kind, e.g. "darkFarms.purge"). */
    ScenarioThreatAction,
}

/** System.Drawing.Point (int X, int Y); `IsEmpty` is X == 0 && Y == 0. */
export interface Point {
    x: number;
    y: number;
}

/** ShipAction.cs `object Target` / `Target2`: BuiltObject, Habitat, Creature, SystemInfo, ShipGroup, Empire, Character, Troop, Plague, PlanetaryFacilityDefinition, a resource id byte, … */
export type ShipActionTarget = unknown;

// ShipAction.cs 12.
export class ShipAction {
    private _missionType: BuiltObjectMissionType;
    private _actionType: ShipActionType;
    private _target: ShipActionTarget;
    private _target2: ShipActionTarget;
    private _position: Point;
    private _design: Design | null;
    private _isSubsequentAction = false;
    enabled = true;
    hint: string | null = null;
    extraData: string | null = null;

    /**
     * The four C# constructors (ShipAction.cs 25-67) in one: (missionType, target, target2) / (actionType, target) /
     * (missionType, target, offset, design) / (missionType, target). Use the static factories below.
     */
    private constructor(missionType: BuiltObjectMissionType, actionType: ShipActionType, target: ShipActionTarget, target2: ShipActionTarget, position: Point, design: Design | null) {
        this._missionType = missionType;
        this._actionType = actionType;
        this._target = target;
        this._target2 = target2;
        this._position = position;
        this._design = design;
    }

    /** ShipAction.cs 25 ShipAction(missionType, target, target2). */
    static forMission(missionType: BuiltObjectMissionType, target: ShipActionTarget, target2: ShipActionTarget = null): ShipAction {
        return new ShipAction(missionType, ShipActionType.Undefined, target, target2, { x: 0, y: 0 }, null);
    }

    /** ShipAction.cs 35 ShipAction(actionType, target). */
    static forAction(actionType: ShipActionType, target: ShipActionTarget): ShipAction {
        return new ShipAction(BuiltObjectMissionType.Undefined, actionType, target, null, { x: 0, y: 0 }, null);
    }

    /** ShipAction.cs 45 ShipAction(missionType, target, offset, design). */
    static forMissionAt(missionType: BuiltObjectMissionType, target: ShipActionTarget, offset: Point, design: Design | null): ShipAction {
        return new ShipAction(missionType, ShipActionType.Undefined, target, null, { x: offset.x, y: offset.y }, design);
    }

    get missionType(): BuiltObjectMissionType { return this._missionType; }
    /** ShipAction.cs 71 SetMissionType. */
    setMissionType(missionType: BuiltObjectMissionType): void { this._missionType = missionType; }
    get actionType(): ShipActionType { return this._actionType; }
    set actionType(value: ShipActionType) { this._actionType = value; }
    get target(): ShipActionTarget { return this._target; }
    set target(value: ShipActionTarget) { this._target = value; }
    get target2(): ShipActionTarget { return this._target2; }
    set target2(value: ShipActionTarget) { this._target2 = value; }
    get position(): Point { return this._position; }
    set position(value: Point) { this._position = value; }
    get design(): Design | null { return this._design; }
    set design(value: Design | null) { this._design = value; }
    /** Shift-click: queue the mission after the current one (BuiltObject.QueueMission) instead of replacing it. */
    get isSubsequentAction(): boolean { return this._isSubsequentAction; }
    set isSubsequentAction(value: boolean) { this._isSubsequentAction = value; }

    /** ShipAction.cs 109 Clone(): the (missionType, target, position, design) constructor + ActionType + IsSubsequentAction (Target2 is not copied). */
    clone(): ShipAction {
        const a = ShipAction.forMissionAt(this._missionType, this._target, this._position, this._design);
        a.actionType = this._actionType;
        a.isSubsequentAction = this._isSubsequentAction;
        return a;
    }
}

/** A SystemInfo target (types.ts interface: systemStar + habitats). */
export function isSystemInfo(o: unknown): o is SystemInfo {
    return o !== null && typeof o === 'object' && !(o instanceof Habitat) && (o as SystemInfo).systemStar instanceof Habitat && Array.isArray((o as SystemInfo).habitats);
}

// ---------------------------------------------------------------------------------------------------------------
// Factories (Main.Part8.cs 1496-1536)
// ---------------------------------------------------------------------------------------------------------------

/** Main.Part8.cs 1496 method_313(actionType, target): `new ShipAction(actionType, target)`. */
export function createShipAction(actionType: ShipActionType, target: ShipActionTarget): ShipAction {
    return ShipAction.forAction(actionType, target);
}

/** Main.Part8.cs 1501 method_314(missionType): `new ShipAction(missionType, null, new Point(0, 0), null)`. */
export function createMissionShipAction(missionType: BuiltObjectMissionType): ShipAction {
    return ShipAction.forMissionAt(missionType, null, { x: 0, y: 0 }, null);
}

/**
 * Main.Part8.cs 1506 method_315(missionType, target): the mission order for the thing under the cursor. `cursorX/Y`
 * are the C# int_15/int_16 — the right-click point in galaxy coordinates (ints). With a Habitat / SystemInfo /
 * Creature target the Position is the click offset from the target ((int) cast of its position); a SystemInfo target
 * becomes its SystemStar. With no target the Position is the click point itself; any other target type gets (0, 0).
 */
export function createMissionShipActionAt(missionType: BuiltObjectMissionType, target: ShipActionTarget, cursorX: number, cursorY: number): ShipAction {
    if (target !== null && target !== undefined) {
        let num = 0;
        let num2 = 0;
        if (target instanceof Habitat) {
            num = cursorX - Math.trunc(target.xpos);
            num2 = cursorY - Math.trunc(target.ypos);
        } else if (isSystemInfo(target)) {
            num = cursorX - Math.trunc(target.systemStar.xpos);
            num2 = cursorY - Math.trunc(target.systemStar.ypos);
            target = target.systemStar;
        } else if (target instanceof Creature) {
            num = cursorX - Math.trunc(target.xpos);
            num2 = cursorY - Math.trunc(target.ypos);
        }
        const offset: Point = { x: num, y: num2 };
        return ShipAction.forMissionAt(missionType, target, offset, null);
    }
    const num3 = cursorX;
    const num4 = cursorY;
    const offset2: Point = { x: num3, y: num4 };
    return ShipAction.forMissionAt(missionType, null, offset2, null);
}
