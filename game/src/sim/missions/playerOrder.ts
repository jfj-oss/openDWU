// Player orders on automated ships and fleets (a deliberate deviation from DW:U, requested by the user).
//
// In the original a manual order (move / attack / patrol / escort / colonize / build / load troops / ...) also turns
// the ship's or fleet's automation off (IsAutoControlled = false). Here IsAutoControlled only changes through the
// explicit Automate / Unautomate toggle; a manual order instead marks the mission it creates as `playerOrdered`.
// While such a mission is the ship's (or its fleet's) current, unfinished mission the ship counts as manually
// controlled everywhere the sim asks "is this ship automated?" (isAiControlled below), exactly as an unautomated ship
// did in the original — so the empire AI leaves it alone and it carries out the order. Once the mission completes (or
// is replaced), the ship is automated again and the AI gives it new work.
//
// AI empires never issue player orders, so for them isAiControlled(ship) === ship.isAutoControlled always.
//
// Leaf module: type-only imports, so any sim module (including ones evaluated while empire.ts initialises) may import it.

import type { BuiltObject } from '../builtObject';
import type { ShipGroup } from '../fleets/shipGroup';
import type { BuiltObjectMission } from './mission';

/** BuiltObjectMissionType.Undefined (0) — kept as a literal so this module has no value imports. */
const MISSION_TYPE_UNDEFINED = 0;

function activePlayerOrder(mission: BuiltObjectMission | null | undefined): boolean {
    return mission != null && mission.playerOrdered === true && (mission.type as number) !== MISSION_TYPE_UNDEFINED;
}

/** True while the ship's own mission (current, queued or to revert to), or its fleet's mission, is an unfinished player order. */
export function hasActivePlayerOrder(ship: BuiltObject): boolean {
    if (activePlayerOrder(ship.mission as BuiltObjectMission | null) || queuedPlayerOrder(ship.subsequentMissions as BuiltObjectMission[])) return true;
    // A player order interrupted by a diversion (threat response, refuel, repair) that the ship will revert to.
    if (activePlayerOrder(ship.revertMission as BuiltObjectMission | null)) return true;
    const fleet = ship.shipGroup as ShipGroup | null;
    return fleet !== null && (activePlayerOrder(fleet.mission) || queuedPlayerOrder(fleet.subsequentMissions));
}

/** A player order still waiting in the queue (shift-queued orders) keeps the ship out of the AI's hands too. */
function queuedPlayerOrder(queue: readonly BuiltObjectMission[] | null | undefined): boolean {
    if (queue == null) return false;
    for (let i = 0; i < queue.length; i++) {
        if (queue[i] != null && queue[i].playerOrdered === true) return true;
    }
    return false;
}

/**
 * The sim's "is this ship automated?" test: IsAutoControlled, except while it carries out a player order. Use this
 * (not the raw flag) wherever automation decides what the ship does; keep the raw flag for the Automate toggle itself.
 */
export function isAiControlled(ship: BuiltObject): boolean {
    return ship.isAutoControlled && !hasActivePlayerOrder(ship);
}

/** Mark the ship's current mission (just assigned by a player command) as a player order. */
export function markPlayerOrder(ship: BuiltObject): void {
    const mission = ship.mission as BuiltObjectMission | null;
    if (mission != null && (mission.type as number) !== MISSION_TYPE_UNDEFINED) mission.playerOrdered = true;
}

/** Mark a fleet's current mission (and its ships' missions) as a player order. */
export function markFleetPlayerOrder(fleet: ShipGroup): void {
    const mission = fleet.mission;
    if (mission != null && (mission.type as number) !== MISSION_TYPE_UNDEFINED) mission.playerOrdered = true;
    for (const ship of fleet.ships) markPlayerOrder(ship);
}

/** The missions a ship / fleet holds before a player command runs (see snapshotOrders / markNewOrders). */
interface MissionHolderSnapshot {
    mission: BuiltObjectMission | null;
    queued: Set<BuiltObjectMission>;
}
export interface OrderSnapshot {
    ships: Map<BuiltObject, MissionHolderSnapshot>;
    fleets: Map<ShipGroup, MissionHolderSnapshot>;
}

function snapshotOf(mission: BuiltObjectMission | null, queue: readonly BuiltObjectMission[] | null | undefined): MissionHolderSnapshot {
    return { mission, queued: new Set(queue ?? []) };
}

/** Record the current and queued missions of the ships / fleets a player command is about to order. */
export function snapshotOrders(ships: readonly BuiltObject[], fleets: readonly ShipGroup[] = []): OrderSnapshot {
    const snap: OrderSnapshot = { ships: new Map(), fleets: new Map() };
    const addShip = (b: BuiltObject): void => {
        if (!snap.ships.has(b)) snap.ships.set(b, snapshotOf(b.mission as BuiltObjectMission | null, b.subsequentMissions as BuiltObjectMission[]));
    };
    for (const b of ships) addShip(b);
    for (const f of fleets) {
        if (!snap.fleets.has(f)) snap.fleets.set(f, snapshotOf(f.mission, f.subsequentMissions));
        for (const b of f.ships) addShip(b);
    }
    return snap;
}

function markNew(before: MissionHolderSnapshot, mission: BuiltObjectMission | null, queue: readonly BuiltObjectMission[] | null | undefined): void {
    if (mission != null && mission !== before.mission && (mission.type as number) !== MISSION_TYPE_UNDEFINED) mission.playerOrdered = true;
    if (queue == null) return;
    for (const m of queue) {
        if (m != null && !before.queued.has(m)) m.playerOrdered = true;
    }
}

/** Mark every mission the player command created (a new current mission or a newly queued one) as a player order. */
export function markNewOrders(snap: OrderSnapshot): void {
    for (const [b, before] of snap.ships) markNew(before, b.mission as BuiltObjectMission | null, b.subsequentMissions as BuiltObjectMission[]);
    for (const [f, before] of snap.fleets) markNew(before, f.mission, f.subsequentMissions);
}

function unmark(mission: BuiltObjectMission | null | undefined): void {
    if (mission != null && mission.playerOrdered !== undefined) delete mission.playerOrdered;
}

/**
 * The player clicked Automate: whatever the ship was doing for the player is handed to the AI (as the C#'s
 * IsAutoControlled = true does), so its current, queued and revert missions stop being player orders.
 */
export function clearPlayerOrders(ship: BuiltObject): void {
    unmark(ship.mission as BuiltObjectMission | null);
    for (const m of ship.subsequentMissions as BuiltObjectMission[]) unmark(m);
    unmark(ship.revertMission as BuiltObjectMission | null);
}

/** Automate on a fleet: clearPlayerOrders for the fleet's own missions and every ship. */
export function clearFleetPlayerOrders(fleet: ShipGroup): void {
    unmark(fleet.mission);
    for (const m of fleet.subsequentMissions) unmark(m);
    for (const ship of fleet.ships) clearPlayerOrders(ship);
}
