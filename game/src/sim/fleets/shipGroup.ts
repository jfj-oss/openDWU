// M4l — ShipGroup model, fleet maintenance, fleet bonuses, ShipGroup.DoTasks callees.
//
// Stubs created by M4a (tasks/M4-plan.md §3.1): the tick skeletons in src/sim/tick/ call these entry points in C#
// order. Each is a no-op that does NOT draw Galaxy.Rnd (a `RND:` note marks C# draw sites that are skipped until the
// owning package ports the body) and records a TODO hit (tick/todo.ts). The owning package replaces the bodies in
// place, keeping the signatures (or adjusting the skeleton call in the same change).

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import type { BuiltObject } from '../builtObject';
import { registerTodo, todo } from '../tick/todo';
import { MIN_TIME } from '../tick/simTime';
import type { BuiltObjectMission, BuiltObjectMissionPriority, BuiltObjectMissionType, MissionTarget, StellarObject } from '../missions/mission';
import { BuiltObjectRole } from '../data/designSpecifications';

// ShipGroup.cs (fleet). Minimal model created by M4a so the fleet tick (tick/shipGroupTick.ts) and the Empire /
// Galaxy ticks can iterate Empire.ShipGroups; M4l ports the rest of ShipGroup.cs (3,578 lines: missions, lead ship,
// fuel range, bonuses) into this class. Free functions, C# `this` first (plan §3.1 rule 2).
export class ShipGroup {
    /** ShipGroup.cs _Galaxy. */
    galaxy: Galaxy;
    /** ShipGroup.Empire. */
    empire: Empire | null = null;
    /** ShipGroup.cs _Ships (BuiltObjectList). */
    ships: BuiltObject[] = [];
    /** ShipGroup.LeadShip. */
    leadShip: BuiltObject | null = null;
    /** ShipGroup.Mission (BuiltObjectMission, M4b). */
    mission: BuiltObjectMission | null = null;
    // ---- M4a fields (tick core) ----
    /** ShipGroup.cs 60/61 _LastTouch / _LastPeriodicTouch (game ms): C# default DateTime.MinValue. */
    lastTouch = MIN_TIME;
    lastPeriodicTouch = MIN_TIME;
    // ---- M4l fields ----
    /** ShipGroup.AllowImmediateThreatEvaluation / AttackRangeSquared (float) — set by Empire.ProcessDistressSignals (added by M4b). */
    allowImmediateThreatEvaluation = false;
    attackRangeSquared = 0;
    /** ShipGroup.cs _ShipEnergyUsageBonus / _ShipEnergyUsageBonusExtra (ShipEnergyUsageBonus => sum; read by BuiltObject.DoTasks 3828). */
    shipEnergyUsageBonusBase = 1.0;
    shipEnergyUsageBonusExtra = 0.0;
    // ---- fields added by M4n (read by combat/threats.ts, attackAI.ts, cmdAttack.ts) ----
    /** ShipGroup.BattleStats (SpaceBattleStats, M4o owns the type; null until a combat mission starts it). */
    battleStats: unknown = null;
    /** ShipGroup.cs 38/49 _WeaponsRangeBonus = 1.0 / _WeaponsRangeBonusExtra (WeaponsRangeBonus => sum; M4l ReviewFleetBonuses sets them). */
    weaponsRangeBonusBase = 1.0;
    weaponsRangeBonusExtra = 0.0;

    // ShipGroup(Galaxy galaxy) (ShipGroup.cs 89).
    constructor(galaxy: Galaxy) {
        this.galaxy = galaxy;
        this.ships = [];
    }

    /** ShipGroup.ShipEnergyUsageBonus => _ShipEnergyUsageBonus + _ShipEnergyUsageBonusExtra. */
    get shipEnergyUsageBonus(): number {
        return this.shipEnergyUsageBonusBase + this.shipEnergyUsageBonusExtra;
    }
}

/** Empire.ShipGroups as the typed list (empire.ts declares it `unknown[]`). */
export function empireShipGroups(empire: Empire): (ShipGroup | null)[] {
    return empire.shipGroups as (ShipGroup | null)[];
}

const T_checkForMissionCompletion = registerTodo('M4l', 'checkForMissionCompletion');
/** ShipGroup.cs 516 CheckForMissionCompletion. */
export function checkForMissionCompletion(galaxy: Galaxy, shipGroup: ShipGroup): void {
    // RND: draws in callees (d≤3) — not drawn until M4l.
    /* TODO(port) M4l */ todo(T_checkForMissionCompletion);
}

const T_checkForCompletedBattle = registerTodo('M4l', 'checkForCompletedBattle');
/** ShipGroup.cs 191 CheckForCompletedBattle. */
export function checkForCompletedBattle(galaxy: Galaxy, shipGroup: ShipGroup): void {
    // RND: draws in callees (d≤3) — not drawn until M4l.
    /* TODO(port) M4l */ todo(T_checkForCompletedBattle);
}

const T_checkRefuelManual = registerTodo('M4l', 'checkRefuelManual');
/** ShipGroup.cs 1597 CheckRefuelManual. */
export function checkRefuelManual(galaxy: Galaxy, shipGroup: ShipGroup): void {
    // RND: draws in callees (d≤3) — not drawn until M4l.
    /* TODO(port) M4l */ todo(T_checkRefuelManual);
}

const T_checkRefuelRepairAttack = registerTodo('M4l', 'checkRefuelRepairAttack');
/** ShipGroup.cs 1670 CheckRefuelRepairAttack(bool, Empire). */
export function checkRefuelRepairAttack(galaxy: Galaxy, shipGroup: ShipGroup, forceRefuel: boolean, empireToAttack: Empire | null): void {
    // RND: draws in callees (d≤3) — not drawn until M4l.
    /* TODO(port) M4l */ todo(T_checkRefuelRepairAttack);
}

const T_checkSendForAttack = registerTodo('M4l', 'checkSendForAttack');
/** ShipGroup.cs 170 CheckSendForAttack. */
export function checkSendForAttack(galaxy: Galaxy, shipGroup: ShipGroup): void {
    // RND: draws in callees (d≤3) — not drawn until M4l.
    /* TODO(port) M4l */ todo(T_checkSendForAttack);
}

const T_reviewCharacterLocationBonuses = registerTodo('M4l', 'reviewCharacterLocationBonuses');
/** ShipGroup.cs 316 ReviewCharacterLocationBonuses. */
export function reviewCharacterLocationBonuses(galaxy: Galaxy, shipGroup: ShipGroup): void {
    /* TODO(port) M4l */ todo(T_reviewCharacterLocationBonuses);
}

const T_maintainShipGroups = registerTodo('M4l', 'maintainShipGroups');
/** Empire.9.cs 2472 MaintainShipGroups. */
export function maintainShipGroups(galaxy: Galaxy, empire: Empire): void {
    // RND: draws in callees (d≤3) — not drawn until M4l.
    /* TODO(port) M4l */ todo(T_maintainShipGroups);
}

const T_updateFleetLeadShips = registerTodo('M4l', 'updateFleetLeadShips');
/** Empire.9.cs 2460 UpdateFleetLeadShips. */
export function updateFleetLeadShips(galaxy: Galaxy, empire: Empire): void {
    /* TODO(port) M4l */ todo(T_updateFleetLeadShips);
}

const T_reviewFleetPostures = registerTodo('M4l', 'reviewFleetPostures');
/** Empire.9.cs 2454 ReviewFleetPostures. */
export function reviewFleetPostures(galaxy: Galaxy, empire: Empire): void {
    // RND: draws in callees (d≤3) — not drawn until M4l.
    /* TODO(port) M4l */ todo(T_reviewFleetPostures);
}

const T_reviewFleetAdmiralBonuses = registerTodo('M4l', 'reviewFleetAdmiralBonuses');
/** Empire.2.cs 2944 ReviewFleetAdmiralBonuses. */
export function reviewFleetAdmiralBonuses(galaxy: Galaxy, empire: Empire): void {
    /* TODO(port) M4l */ todo(T_reviewFleetAdmiralBonuses);
}

const T_reviewFleetBonuses = registerTodo('M4l', 'reviewFleetBonuses');
/** BuiltObject.cs 1906 ReviewFleetBonuses. */
export function reviewFleetBonuses(galaxy: Galaxy, builtObject: BuiltObject): void {
    /* TODO(port) M4l */ todo(T_reviewFleetBonuses);
}

const T_performFleetTasks = registerTodo('M4l', 'performFleetTasks');
/** BuiltObject.cs 3503 PerformFleetTasks. */
export function performFleetTasks(galaxy: Galaxy, builtObject: BuiltObject): void {
    // RND: draws in callees (d≤3) — not drawn until M4l.
    /* TODO(port) M4l */ todo(T_performFleetTasks);
}

// ---- stubs added by M4b (called from missions/*.ts) ----

const T_forceCompleteMission = registerTodo('M4l', 'forceCompleteMission');
/** ShipGroup.cs 1422 ForceCompleteMission — stub. */
export function forceCompleteMission(galaxy: Galaxy, shipGroup: ShipGroup): void {
    /* TODO(port) M4l */ todo(T_forceCompleteMission);
}

const T_determineActualFleetLocation = registerTodo('M4l', 'determineActualFleetLocation');
/** ShipGroup.cs 2581 DetermineActualFleetLocation → Point — stub: the lead ship's position (or 0,0). */
export function determineActualFleetLocation(galaxy: Galaxy, shipGroup: ShipGroup): { x: number; y: number } {
    /* TODO(port) M4l */ todo(T_determineActualFleetLocation);
    const lead = shipGroup.leadShip;
    return lead !== null ? { x: Math.trunc(lead.xpos), y: Math.trunc(lead.ypos) } : { x: 0, y: 0 };
}

const T_shipGroupTotalOverallStrengthFactor = registerTodo('M4l', 'shipGroupTotalOverallStrengthFactor');
/** ShipGroup.TotalOverallStrengthFactor — stub: 0. */
export function shipGroupTotalOverallStrengthFactor(galaxy: Galaxy, shipGroup: ShipGroup): number {
    /* TODO(port) M4l */ todo(T_shipGroupTotalOverallStrengthFactor);
    return 0;
}

const T_shipGroupAssignMission = registerTodo('M4l', 'shipGroupAssignMission');
/** ShipGroup.cs 2028+ AssignMission(missionType, target, target2[, x, y], priority, manuallyAssigned) — stub. */
export function shipGroupAssignMission(
    galaxy: Galaxy,
    shipGroup: ShipGroup,
    missionType: BuiltObjectMissionType,
    target: MissionTarget | null,
    target2: MissionTarget | null,
    priority: BuiltObjectMissionPriority,
    manuallyAssigned: boolean,
    coords: { x: number; y: number } | null = null,
): void {
    // RND: fleet mission resolution draws (ResolveCommandsForMission per ship) — not drawn until M4l.
    /* TODO(port) M4l */ todo(T_shipGroupAssignMission);
}

const T_disbandShipGroup = registerTodo('M4l', 'disbandShipGroup');
/** Empire.8.cs 5145 DisbandShipGroup(shipGroup). Stub added by M4k (DoResearchBreakthrough hyperspace tech). */
export function disbandShipGroup(galaxy: Galaxy, empire: Empire, shipGroup: ShipGroup): void {
    void galaxy;
    void empire;
    void shipGroup;
    /* TODO(port) M4l */ todo(T_disbandShipGroup);
}

// ---- stubs added by M4h (called from construction/*.ts) ----

const T_assignFleetWaypointMission = registerTodo('M4l', 'assignFleetWaypointMission');
/**
 * Galaxy.7.cs 4597 AssignFleetWaypointMission(builtObject, allowMissionOverride, waypoint). The guard is ported (a ship
 * without a fleet returns false, as every newly built AI ship does until fleets are ported); the fleet branch (lead ship
 * / gather point target, SelectRelativeParkingPoint, ClearPreviousMissionRequirements, AssignMission Move) is a stub that
 * returns true like the C# branch.
 */
export function assignFleetWaypointMission(galaxy: Galaxy, builtObject: BuiltObject | null, allowMissionOverride: boolean, waypoint: StellarObject | null): boolean {
    if (builtObject !== null && builtObject.shipGroup !== null && builtObject.topSpeed > 0 && builtObject.role !== BuiltObjectRole.Base) {
        const mission = builtObject.mission as BuiltObjectMission | null;
        // BuiltObjectMissionType.Undefined = 0.
        if (allowMissionOverride || mission === null || (mission !== null && (mission.type as number) === 0)) {
            // RND: SelectRelativeParkingPoint (NextDouble, Next(0, 2), NextDouble) + AssignMission — not drawn until M4l.
            void waypoint;
            /* TODO(port) M4l */ todo(T_assignFleetWaypointMission);
            return true;
        }
    }
    return false;
}

const T_shipGroupRepairBonus = registerTodo('M4l', 'shipGroupRepairBonus');
/** ShipGroup.RepairBonus => _RepairBonus (1.0 until ReviewCharacterLocationBonuses) + _RepairBonusExtra (0) — stub: 1.0. */
export function shipGroupRepairBonus(shipGroup: ShipGroup): number {
    void shipGroup;
    /* TODO(port) M4l */ todo(T_shipGroupRepairBonus);
    return 1.0;
}

// ---- stub added by M4c (movement.ts shipGroupRemoveShipsWithoutHyperdrive) ----

const T_leaveShipGroup = registerTodo('M4l', 'leaveShipGroup');
/** BuiltObject LeaveShipGroup (removes the ship from its fleet) — stub: the ship stays in the group. */
export function leaveShipGroup(galaxy: Galaxy, builtObject: BuiltObject): void {
    /* TODO(port) M4l */ todo(T_leaveShipGroup);
}

// ---- stub added by M4s (Empire.8.cs 2440 CancelPirateDefendMissions) ----
const T_shipGroupCompleteMission = registerTodo('M4l', 'shipGroupCompleteMission');
/** ShipGroup.cs 1837 CompleteMission() → CompleteMission(true) — stub. */
export function shipGroupCompleteMission(galaxy: Galaxy, shipGroup: ShipGroup): boolean {
    // RND: mission completion / reassignment draws in callees — not drawn until M4l.
    /* TODO(port) M4l */ todo(T_shipGroupCompleteMission);
    return false;
}

// ---- stubs added by M4i (Empire.6.cs 3466 DoRetrofit) ----
const T_shipGroupSubsequentMissionsContainsType = registerTodo('M4l', 'shipGroupSubsequentMissionsContainsType');
/** ShipGroup.SubsequentMissions.ContainsType(missionType) — stub: false (the model has no SubsequentMissions yet). */
export function shipGroupSubsequentMissionsContainsType(galaxy: Galaxy, shipGroup: ShipGroup, missionType: BuiltObjectMissionType): boolean {
    /* TODO(port) M4l */ todo(T_shipGroupSubsequentMissionsContainsType);
    return false;
}

const T_shipGroupQueueMission = registerTodo('M4l', 'shipGroupQueueMission');
/** ShipGroup.cs 2392 QueueMission(missionType, target, target2, priority) — stub (nothing is queued). */
export function shipGroupQueueMission(galaxy: Galaxy, shipGroup: ShipGroup, missionType: BuiltObjectMissionType, target: MissionTarget | null, target2: MissionTarget | null, priority: BuiltObjectMissionPriority): boolean {
    /* TODO(port) M4l */ todo(T_shipGroupQueueMission);
    return false;
}
