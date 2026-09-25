// M4l — ShipGroup model (ShipGroup.cs 15-95, 2457-2753 fields and properties) and the fleet entry points other
// packages and the tick skeletons call.
//
// This module stays light: it only imports types from the sim modules, because empire.ts → pirateRelations.ts →
// fleets/shipGroup.ts is evaluated while empire.ts is still initialising (a value import of missions / movement /
// combat / diplomacy from here would evaluate taxes.ts, diplomacyTick.ts, ... against an uninitialised empire.ts).
// The ported bodies live in fleets/shipGroupTasks.ts, which registers them here at load; tick/shipGroupTick.ts imports
// it, so every sim path has them. The entry points below forward to the registered bodies.

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import type { BuiltObject } from '../builtObject';
import type { EmpirePolicy } from '../data/policies';
import type { FleetPosture } from '../diplomacyTick';
import type { BuiltObjectMission, BuiltObjectMissionPriority, BuiltObjectMissionType, MissionTarget, StellarObject } from '../missions/mission';
import { MIN_TIME } from '../tick/simTime';
import { BuiltObjectRole } from '../data/designSpecifications';

/** 2.304E+09f (48000²) as the float32 it is. */
const ATTACK_RANGE_SQUARED_DEFAULT = Math.fround(2.304e9);
/** FleetPosture.Attack / Defend (FleetPosture.cs, byte enum; the enum lives in diplomacyTick.ts). */
const FLEET_POSTURE_ATTACK = 0 as FleetPosture;

// ShipGroup.cs 15 (fleet). Free functions take it first (plan §3.1 rule 2).
export class ShipGroup {
    /** ShipGroup.cs 59 _Galaxy. */
    galaxy: Galaxy;
    /** ShipGroup.cs 20 _Empire (setter side effects: ShipGroup.cs 2740). */
    private _empire: Empire | null = null;
    /** ShipGroup.cs 17 _Ships (BuiltObjectList). */
    ships: BuiltObject[] = [];
    /** ShipGroup.cs 21 _LeadShip. */
    leadShip: BuiltObject | null = null;
    /** ShipGroup.cs 27 _Mission (BuiltObjectMission, M4b). */
    mission: BuiltObjectMission | null = null;
    // ---- M4a fields (tick core) ----
    /** ShipGroup.cs 60/61 _LastTouch / _LastPeriodicTouch (game ms): C# default DateTime.MinValue. */
    lastTouch = MIN_TIME;
    lastPeriodicTouch = MIN_TIME;
    // ---- M4l fields ----
    /** ShipGroup.cs 18 _Role / 19 _Name. */
    role: BuiltObjectRole = BuiltObjectRole.Undefined;
    name: string | null = null;
    /** ShipGroup.cs 22 _AttackPoint / 23 _GatherPoint. */
    attackPoint: StellarObject | null = null;
    gatherPoint: StellarObject | null = null;
    /** ShipGroup.cs 24 AttackRangeSquared (float) / 29 AllowImmediateThreatEvaluation (Empire.ProcessDistressSignals, M4b). */
    attackRangeSquared = 0;
    allowImmediateThreatEvaluation = false;
    /** ShipGroup.cs 25 ShipTargetAmount / 26 TroopTargetStrength. */
    shipTargetAmount = 0;
    troopTargetStrength = 0;
    /** ShipGroup.cs 28 _SubsequentMissions (BuiltObjectMissionList). */
    subsequentMissions: BuiltObjectMission[] = [];
    /** ShipGroup.cs 30 Posture (FleetPosture, default Attack) / 31 PostureRangeSquared = double.MaxValue. */
    posture: FleetPosture = FLEET_POSTURE_ATTACK;
    postureRangeSquared = Number.MAX_VALUE;
    /** ShipGroup.cs 32-42 admiral bonuses (_X = 1.0, ReviewAdmiralBonuses) and 43-53 local-defense extras (_XExtra = 0). */
    targetingBonusBase = 1.0;
    countermeasuresBonusBase = 1.0;
    shipManeuveringBonusBase = 1.0;
    fightersBonusBase = 1.0;
    shipEnergyUsageBonusBase = 1.0;
    weaponsDamageBonusBase = 1.0;
    weaponsRangeBonusBase = 1.0;
    shieldRechargeRateBonusBase = 1.0;
    damageControlBonusBase = 1.0;
    repairBonusBase = 1.0;
    hyperjumpSpeedBonusBase = 1.0;
    targetingBonusExtra = 0.0;
    countermeasuresBonusExtra = 0.0;
    shipManeuveringBonusExtra = 0.0;
    fightersBonusExtra = 0.0;
    shipEnergyUsageBonusExtra = 0.0;
    weaponsDamageBonusExtra = 0.0;
    weaponsRangeBonusExtra = 0.0;
    shieldRechargeRateBonusExtra = 0.0;
    damageControlBonusExtra = 0.0;
    repairBonusExtra = 0.0;
    hyperjumpSpeedBonusExtra = 0.0;
    /** ShipGroup.cs 54-57 TroopLoadout* (byte; 255 = unset). */
    troopLoadoutInfantry = 0;
    troopLoadoutArmored = 0;
    troopLoadoutArtillery = 0;
    troopLoadoutSpecialForces = 0;
    /** ShipGroup.cs 58 BattleStats (SpaceBattleStats, M4o owns the type; null until a combat mission starts it). */
    battleStats: unknown = null;
    /** ShipGroup.cs 63 SortTag ([NonSerialized] double). */
    sortTag = 0.0;

    // ShipGroup(Galaxy galaxy) (ShipGroup.cs 89).
    constructor(galaxy: Galaxy) {
        this.galaxy = galaxy;
        this.ships = [];
    }

    /** ShipGroup.cs 2740 Empire. */
    get empire(): Empire | null {
        return this._empire;
    }
    set empire(value: Empire | null) {
        this._empire = value;
        if (this._empire === null) {
            return;
        }
        this.attackRangeSquared =
            this._empire.attackRangeOther < 0
                ? this.leadShip === null
                    ? ATTACK_RANGE_SQUARED_DEFAULT
                    : Math.fround(Math.fround(this.leadShip.sensorProximityArrayRange) * Math.fround(this.leadShip.sensorProximityArrayRange))
                : Math.fround(Math.fround(this._empire.attackRangeOther) * Math.fround(this._empire.attackRangeOther));
        if (this._empire.policy === null) {
            return;
        }
        shipGroupSetTroopLoadoutsFromPolicy(this, this._empire.policy);
    }

    /** ShipGroup.cs 65 LocalDefenseTacticsApply. */
    get localDefenseTacticsApply(): boolean {
        return this.targetingBonusExtra > 0.0 || this.countermeasuresBonusExtra > 0.0;
    }
    /** ShipGroup.cs 67-87 X => _X + _XExtra. */
    get targetingBonus(): number { return this.targetingBonusBase + this.targetingBonusExtra; }
    get countermeasuresBonus(): number { return this.countermeasuresBonusBase + this.countermeasuresBonusExtra; }
    get shipManeuveringBonus(): number { return this.shipManeuveringBonusBase + this.shipManeuveringBonusExtra; }
    get fightersBonus(): number { return this.fightersBonusBase + this.fightersBonusExtra; }
    get shipEnergyUsageBonus(): number { return this.shipEnergyUsageBonusBase + this.shipEnergyUsageBonusExtra; }
    get weaponsDamageBonus(): number { return this.weaponsDamageBonusBase + this.weaponsDamageBonusExtra; }
    get weaponsRangeBonus(): number { return this.weaponsRangeBonusBase + this.weaponsRangeBonusExtra; }
    get shieldRechargeRateBonus(): number { return this.shieldRechargeRateBonusBase + this.shieldRechargeRateBonusExtra; }
    get damageControlBonus(): number { return this.damageControlBonusBase + this.damageControlBonusExtra; }
    get repairBonus(): number { return this.repairBonusBase + this.repairBonusExtra; }
    get hyperjumpSpeedBonus(): number { return this.hyperjumpSpeedBonusBase + this.hyperjumpSpeedBonusExtra; }

    /** ShipGroup.cs 2967 TotalTroopAttackStrength (also read by diplomacyTick.ts through its fleet view). */
    get totalTroopAttackStrength(): number {
        let total = 0;
        for (let index = 0; index < this.ships.length; ++index) {
            const ship = this.ships[index];
            if (ship.troops !== null && ship.troops.totalAttackStrength > 0) total += ship.troops.totalAttackStrength;
        }
        return total;
    }
}

/** Empire.ShipGroups as the typed list (empire.ts declares it `unknown[]`). */
export function empireShipGroups(empire: Empire): (ShipGroup | null)[] {
    return empire.shipGroups as (ShipGroup | null)[];
}

/** ShipGroup.cs 137 SetTroopLoadoutsFromPolicy(policy). */
export function shipGroupSetTroopLoadoutsFromPolicy(shipGroup: ShipGroup, policy: EmpirePolicy | null): void {
    if (policy === null) {
        return;
    }
    if (policy.troopUseDefaultTransportLoadout) {
        const inf = Math.fround(policy.troopDefaultTransportLoadoutInfantry);
        const arm = Math.fround(policy.troopDefaultTransportLoadoutArmor);
        const art = Math.fround(policy.troopDefaultTransportLoadoutArtillery);
        const sf = Math.fround(policy.troopDefaultTransportLoadoutSpecialForces);
        const num = Math.fround(1 / Math.fround(Math.fround(Math.fround(inf + arm) + art) + sf));
        // (byte) casts: truncation, unchecked wrap.
        shipGroup.troopLoadoutInfantry = Math.trunc(100.0 * inf * num) & 0xff;
        shipGroup.troopLoadoutArmored = Math.trunc(100.0 * arm * num) & 0xff;
        shipGroup.troopLoadoutArtillery = Math.trunc(100.0 * art * num) & 0xff;
        shipGroup.troopLoadoutSpecialForces = Math.trunc(100.0 * sf * num) & 0xff;
    } else {
        shipGroup.troopLoadoutInfantry = 255;
        shipGroup.troopLoadoutArmored = 255;
        shipGroup.troopLoadoutArtillery = 255;
        shipGroup.troopLoadoutSpecialForces = 255;
    }
}

/** ShipGroup.cs 3241 WarpSpeed. */
export function shipGroupWarpSpeed(shipGroup: ShipGroup): number {
    if (shipGroup.ships.length <= 0) return 0;
    let num = 536870911;
    for (let index = 0; index < shipGroup.ships.length; ++index) {
        const ship = shipGroup.ships[index];
        if (ship.builtAt === null && ship.warpSpeed < num) num = ship.warpSpeed;
    }
    return Math.trunc(num * shipGroup.hyperjumpSpeedBonus);
}

/** ShipGroup.RepairBonus => _RepairBonus + _RepairBonusExtra (ShipGroup.cs 85). */
export function shipGroupRepairBonus(shipGroup: ShipGroup): number {
    return shipGroup.repairBonus;
}

// ---------------------------------------------------------------------------------------------------------------
// Entry points forwarded to fleets/shipGroupTasks.ts
// ---------------------------------------------------------------------------------------------------------------

/** The bodies fleets/shipGroupTasks.ts registers (C# file:line on each implementation there). */
export interface ShipGroupTasks {
    checkForMissionCompletion(galaxy: Galaxy, shipGroup: ShipGroup): void;
    checkForCompletedBattle(galaxy: Galaxy, shipGroup: ShipGroup): boolean;
    checkRefuelManual(galaxy: Galaxy, shipGroup: ShipGroup): boolean;
    checkRefuelRepairAttack(galaxy: Galaxy, shipGroup: ShipGroup, completedAttackMission: boolean, attackEmpire: Empire | null): boolean;
    checkSendForAttack(galaxy: Galaxy, shipGroup: ShipGroup): boolean;
    reviewCharacterLocationBonuses(galaxy: Galaxy, shipGroup: ShipGroup): void;
    maintainShipGroups(galaxy: Galaxy, empire: Empire): void;
    updateFleetLeadShips(galaxy: Galaxy, empire: Empire): void;
    reviewFleetPostures(galaxy: Galaxy, empire: Empire): void;
    reviewFleetAdmiralBonuses(galaxy: Galaxy, empire: Empire): void;
    reviewFleetBonuses(galaxy: Galaxy, builtObject: BuiltObject): void;
    performFleetTasks(galaxy: Galaxy, builtObject: BuiltObject): void;
    forceCompleteMission(galaxy: Galaxy, shipGroup: ShipGroup): void;
    determineActualFleetLocation(galaxy: Galaxy, shipGroup: ShipGroup): { x: number; y: number };
    shipGroupTotalOverallStrengthFactor(galaxy: Galaxy, shipGroup: ShipGroup): number;
    shipGroupAssignMission(
        galaxy: Galaxy,
        shipGroup: ShipGroup,
        missionType: BuiltObjectMissionType,
        target: MissionTarget | null,
        target2: MissionTarget | null,
        priority: BuiltObjectMissionPriority,
        manuallyAssigned: boolean,
        coords?: { x: number; y: number } | null,
        starDate?: number,
    ): boolean;
    disbandShipGroup(galaxy: Galaxy, empire: Empire, shipGroup: ShipGroup): void;
    assignFleetWaypointMission(galaxy: Galaxy, builtObject: BuiltObject | null, allowMissionOverride: boolean, waypoint: StellarObject | null): boolean;
    leaveShipGroup(galaxy: Galaxy, builtObject: BuiltObject): void;
    shipGroupCompleteMission(galaxy: Galaxy, shipGroup: ShipGroup): boolean;
}

let shipGroupTasks: ShipGroupTasks | null = null;
/** Called once by fleets/shipGroupTasks.ts at module load. */
export function registerShipGroupTasks(tasks: ShipGroupTasks): void {
    shipGroupTasks = tasks;
}
function tasks(): ShipGroupTasks {
    if (shipGroupTasks === null) throw new Error('fleets/shipGroup: import fleets/shipGroupTasks first (it registers the ShipGroup bodies)');
    return shipGroupTasks;
}

/** ShipGroup.cs 516 CheckForMissionCompletion. */
export function checkForMissionCompletion(galaxy: Galaxy, shipGroup: ShipGroup): void {
    tasks().checkForMissionCompletion(galaxy, shipGroup);
}
/** ShipGroup.cs 191 CheckForCompletedBattle. */
export function checkForCompletedBattle(galaxy: Galaxy, shipGroup: ShipGroup): boolean {
    return tasks().checkForCompletedBattle(galaxy, shipGroup);
}
/** ShipGroup.cs 1595 CheckRefuelManual. */
export function checkRefuelManual(galaxy: Galaxy, shipGroup: ShipGroup): boolean {
    return tasks().checkRefuelManual(galaxy, shipGroup);
}
/** ShipGroup.cs 1670 CheckRefuelRepairAttack(completedAttackMission, attackEmpire). */
export function checkRefuelRepairAttack(galaxy: Galaxy, shipGroup: ShipGroup, completedAttackMission: boolean, attackEmpire: Empire | null): boolean {
    return tasks().checkRefuelRepairAttack(galaxy, shipGroup, completedAttackMission, attackEmpire);
}
/** ShipGroup.cs 170 CheckSendForAttack. */
export function checkSendForAttack(galaxy: Galaxy, shipGroup: ShipGroup): boolean {
    return tasks().checkSendForAttack(galaxy, shipGroup);
}
/** ShipGroup.cs 316 ReviewCharacterLocationBonuses. */
export function reviewCharacterLocationBonuses(galaxy: Galaxy, shipGroup: ShipGroup): void {
    tasks().reviewCharacterLocationBonuses(galaxy, shipGroup);
}
/** Empire.9.cs 2472 MaintainShipGroups. */
export function maintainShipGroups(galaxy: Galaxy, empire: Empire): void {
    tasks().maintainShipGroups(galaxy, empire);
}
/** Empire.9.cs 2460 UpdateFleetLeadShips. */
export function updateFleetLeadShips(galaxy: Galaxy, empire: Empire): void {
    tasks().updateFleetLeadShips(galaxy, empire);
}
/** Empire.9.cs 2454 ReviewFleetPostures. */
export function reviewFleetPostures(galaxy: Galaxy, empire: Empire): void {
    tasks().reviewFleetPostures(galaxy, empire);
}
/** Empire.2.cs 2944 ReviewFleetAdmiralBonuses. */
export function reviewFleetAdmiralBonuses(galaxy: Galaxy, empire: Empire): void {
    tasks().reviewFleetAdmiralBonuses(galaxy, empire);
}
/** BuiltObject.cs 1906 ReviewFleetBonuses. */
export function reviewFleetBonuses(galaxy: Galaxy, builtObject: BuiltObject): void {
    tasks().reviewFleetBonuses(galaxy, builtObject);
}
/** BuiltObject.cs 3503 PerformFleetTasks. */
export function performFleetTasks(galaxy: Galaxy, builtObject: BuiltObject): void {
    tasks().performFleetTasks(galaxy, builtObject);
}
/** ShipGroup.cs 1422 ForceCompleteMission. */
export function forceCompleteMission(galaxy: Galaxy, shipGroup: ShipGroup): void {
    tasks().forceCompleteMission(galaxy, shipGroup);
}
/** ShipGroup.cs 2581 DetermineActualFleetLocation → Point. */
export function determineActualFleetLocation(galaxy: Galaxy, shipGroup: ShipGroup): { x: number; y: number } {
    return tasks().determineActualFleetLocation(galaxy, shipGroup);
}
/** ShipGroup.cs 3059 TotalOverallStrengthFactor. */
export function shipGroupTotalOverallStrengthFactor(galaxy: Galaxy, shipGroup: ShipGroup): number {
    return tasks().shipGroupTotalOverallStrengthFactor(galaxy, shipGroup);
}
/** ShipGroup.cs 2028-2084 AssignMission overloads (missionType, target, target2[, x, y | starDate], priority, manuallyAssigned). */
export function shipGroupAssignMission(
    galaxy: Galaxy,
    shipGroup: ShipGroup,
    missionType: BuiltObjectMissionType,
    target: MissionTarget | null,
    target2: MissionTarget | null,
    priority: BuiltObjectMissionPriority,
    manuallyAssigned: boolean,
    coords: { x: number; y: number } | null = null,
    starDate = -1,
): boolean {
    return tasks().shipGroupAssignMission(galaxy, shipGroup, missionType, target, target2, priority, manuallyAssigned, coords, starDate);
}
/** Empire.8.cs 5145 DisbandShipGroup(shipGroup). */
export function disbandShipGroup(galaxy: Galaxy, empire: Empire, shipGroup: ShipGroup): void {
    tasks().disbandShipGroup(galaxy, empire, shipGroup);
}
/** Galaxy.7.cs 4597 AssignFleetWaypointMission(builtObject, allowMissionOverride, waypoint). */
export function assignFleetWaypointMission(galaxy: Galaxy, builtObject: BuiltObject | null, allowMissionOverride: boolean, waypoint: StellarObject | null): boolean {
    return tasks().assignFleetWaypointMission(galaxy, builtObject, allowMissionOverride, waypoint);
}
/** BuiltObject.1.cs 42 LeaveShipGroup. */
export function leaveShipGroup(galaxy: Galaxy, builtObject: BuiltObject): void {
    tasks().leaveShipGroup(galaxy, builtObject);
}
/** ShipGroup.cs 1837 CompleteMission() → CompleteMission(true). */
export function shipGroupCompleteMission(galaxy: Galaxy, shipGroup: ShipGroup): boolean {
    return tasks().shipGroupCompleteMission(galaxy, shipGroup);
}
