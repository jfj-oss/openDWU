// "Move together": a per-fleet toggle for the player's fleets. openDWU rule (not in the original).
//
// In the C# every fleet member gets its own copy of the fleet order (ShipGroup.AssignMissionToShips) and flies alone
// at its own speed; during a hyperjump the members are held to the fleet's slowest warp speed, but each starts its jump
// on its own random timer (BuiltObject.2.cs 3027 HyperjumpInitiate * 1000 + Rnd.Next(0, 2000) - 1000). The original's
// own fly-together code (ExecutingShipGroupCommand) never switches on; only the Alt-click attack / bombard
// (WaitAndAttack / WaitAndBombard with HoldSyncFleet) gathers first.
//
// With the toggle on (ShipGroup.moveTogether, off by default), a move / attack / patrol-type order the player gives
// the fleet:
//   1. Gathers first, at the lead ship (or at the centre of most members when the lead is far off), unless the fleet
//      is already together (every member within MOVE_TOGETHER.gatherRadius). The members get ClearParent,
//      ConditionalHyperTo / MoveTo the gather point and the stock HoldSyncFleet command (BuiltObject.2.cs 1159) in
//      front of their own copy of the order; HoldSyncFleet releases them all in the same step.
//   2. Travels as one: the members held together fly at the slowest of their sublight cruise and warp speeds and start
//      every hyperjump at the same moment — one shared start time derived from the members (no extra Rnd draws):
//      the latest of (each member's entry into HyperTo + its HyperjumpInitiate seconds).
//   3. Leaves stragglers behind: badly damaged members, members with failed engines or hyperdrive, low on fuel, or
//      still far away after a short wait do not hold the fleet up. They keep the stock order and follow on their own,
//      and rejoin the group when they catch up (at the next jump).
//   4. Urgent orders skip it: defending a colony or base under attack, intercepting an attacker, escape.
// The AI never sets the toggle, so AI fleets are unchanged; with it off nothing here runs (no state, no Rnd).
//
// State: ShipGroup.moveTogether (saved; absent = off) and ShipGroup.together (the current order's run: saved, so a
// save mid-gather resumes). Both are `declare`d on ShipGroup, so a fleet that never used the toggle saves exactly as
// before.

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import type { BuiltObject } from '../builtObject';
import type { ShipGroup } from './shipGroup';
import { BuiltObjectMissionType, Command, CommandAction, builtObjectMission, isBuiltObject, isCreature, isHabitat, isShipGroup, type BuiltObjectMission } from '../missions/mission';
import { warpSpeedWithBonuses } from '../movement';
import { galaxyStarDate } from '../tick/simTime';
import { isHumanEmpire } from '../humanEmpires';

/** The rule's constants (game ms / world units / portions). */
export const MOVE_TOGETHER = {
    /** Every member within this distance of the gather anchor: the fleet is together (no gather). */
    gatherRadius: 4000,
    /** Members within this distance of each other count as one cluster (where the fleet gathers when the lead is far off). */
    clusterRadius: 6000,
    /** After the first member reaches the gather point, members still far away (see farDistance) after this long plus
     *  the slowest member's hyperjump initiation time are left behind. */
    holdWaitMs: 15_000,
    /** "Still far away": farther than this from the gather point (a member closer than this is on its final approach). */
    farDistance: 15_000,
    /** The whole gather gives up after this long from the order (members not yet at the gather point are left behind). */
    gatherMaxMs: 90_000,
    /** At a hyperjump, members not yet ready to jump this long after the first one are left behind. */
    jumpWaitMs: 15_000,
    /** A member with more than this portion of its components damaged is left behind (below 50 % health). */
    maxDamagedPortion: 0.5,
    /** A member with less than this portion of its fuel capacity is left behind. */
    minFuelPortion: 0.25,
} as const;

/** One order's run (ShipGroup.together). Plain data: saved with the fleet. */
export interface MoveTogetherState {
    /** The fleet mission this run belongs to (a new fleet mission ends the run). */
    mission: BuiltObjectMission;
    /** 0 gathering, 1 travelling together. */
    phase: 0 | 1;
    /** The members held together. */
    core: BuiltObject[];
    /** The members left behind (stragglers: they follow with the stock order). */
    left: BuiltObject[];
    /** The member the fleet gathers at (the others fly to it; it holds where it is). */
    anchor: BuiltObject;
    /** Star date of the order. */
    orderedAt: number;
    /** Star date the first member began holding at the gather point (-1: none yet). */
    holdSince: number;
    /** The gather commands put in front of the members' orders (removed again from a member left behind). */
    gatherCommands: Command[];
    /** The current hyperjump: the members that entered HyperTo and when (star date), the first entry, the shared start. */
    jumpMembers: BuiltObject[];
    jumpEnteredAt: number[];
    jumpFirst: number;
    jumpAt: number;
}

function distanceSquared(bo: BuiltObject, x: number, y: number): number {
    const dx = bo.xpos - x;
    const dy = bo.ypos - y;
    return dx * dx + dy * dy;
}

/** The fleet members' typed mission. */
function missionOf(bo: BuiltObject): BuiltObjectMission | null {
    return builtObjectMission(bo.mission);
}

function fleetOf(bo: BuiltObject): ShipGroup | null {
    return bo.shipGroup as ShipGroup | null;
}

/** The order types the rule applies to (move / attack / patrol-type). WaitAndAttack / WaitAndBombard gather already. */
function isMoveTogetherMissionType(t: BuiltObjectMissionType): boolean {
    switch (t) {
        case BuiltObjectMissionType.Move:
        case BuiltObjectMissionType.MoveAndWait:
        case BuiltObjectMissionType.Patrol:
        case BuiltObjectMissionType.Attack:
        case BuiltObjectMissionType.Bombard:
        case BuiltObjectMissionType.Capture:
        case BuiltObjectMissionType.Raid:
        case BuiltObjectMissionType.Blockade:
            return true;
        default:
            return false;
    }
}

function empireOf(o: unknown): Empire | null {
    return o !== null && typeof o === 'object' ? (((o as { empire?: Empire | null }).empire ?? null) as Empire | null) : null;
}

/** A hostile object currently attacking something of `empire`'s (its current target is ours). */
function attacksUs(o: unknown, empire: Empire): boolean {
    if (isBuiltObject(o)) return o.empire !== empire && empireOf(o.currentTarget) === empire;
    if (isCreature(o)) return empireOf(o.currentTarget) === empire;
    if (isShipGroup(o)) return o.empire !== empire && o.leadShip !== null && empireOf(o.leadShip.currentTarget) === empire;
    return false;
}

/** Something of `empire`'s with attackers on it. */
function ourUnderAttack(o: unknown, empire: Empire): boolean {
    if (!isHabitat(o) && !isBuiltObject(o)) return false;
    if (empireOf(o) !== empire) return false;
    const attackers = o.attackers;
    if (attackers === null) return false;
    for (let i = 0; i < attackers.length; i++) {
        const a = attackers[i];
        if (a != null && empireOf(a) !== empire) return true;
    }
    return false;
}

/**
 * Orders that go straight away: escape / retreat, defending a colony or base under attack, intercepting an attacker.
 * Pure (reads the fleet mission and its target).
 */
export function isUrgentFleetOrder(fleet: ShipGroup, mission: BuiltObjectMission): boolean {
    if (mission.type === BuiltObjectMissionType.Escape || mission.type === BuiltObjectMissionType.Retire) return true;
    const empire = fleet.empire;
    if (empire === null) return true;
    const target = mission.target;
    if (target === null) return false;
    return ourUnderAttack(target, empire) || attacksUs(target, empire);
}

/** Why a member cannot keep up (null: it can): badly damaged, failed engines / hyperdrive, low fuel. Pure. */
export function moveTogetherUnfitReason(bo: BuiltObject, fleetHasWarp: boolean): 'damaged' | 'engines' | 'hyperdrive' | 'fuel' | null {
    const components = bo.components?.count ?? 0;
    if (components > 0 && bo.damagedComponentCount / components > MOVE_TOGETHER.maxDamagedPortion) return 'damaged';
    if (bo.topSpeed <= 0 || bo.cruiseSpeed <= 0) return 'engines';
    if (fleetHasWarp && bo.warpSpeed <= 0) return 'hyperdrive';
    if (bo.fuelCapacity > 0 && bo.currentFuel / bo.fuelCapacity < MOVE_TOGETHER.minFuelPortion) return 'fuel';
    return null;
}

/** A member carrying out the fleet order (its own copy of it). */
function carriesFleetOrder(bo: BuiltObject, fleet: ShipGroup, mission: BuiltObjectMission): boolean {
    if (bo.hasBeenDestroyed || bo.builtAt !== null || bo.shipGroup !== fleet) return false;
    const m = missionOf(bo);
    return m !== null && m.isShipGroupMission && m.type === mission.type;
}

/** The current run, or null (dropped when the fleet mission changed or the toggle is off). */
function stateOf(fleet: ShipGroup | null): MoveTogetherState | null {
    if (fleet === null) return null;
    const st = fleet.together;
    if (st === undefined) return null;
    if (fleet.moveTogether !== true || fleet.mission !== st.mission) {
        delete fleet.together;
        return null;
    }
    return st;
}

/**
 * Who to gather at: the lead ship, or — when fewer than half the members are near the lead — the member nearest the
 * centre of the largest cluster. `together`: every member already within the gather radius of it.
 */
function gatherAnchor(galaxy: Galaxy, fleet: ShipGroup, core: readonly BuiltObject[]): { anchor: BuiltObject; together: boolean } {
    const lead = fleet.leadShip !== null && core.includes(fleet.leadShip) ? fleet.leadShip : core[0];
    const r2 = MOVE_TOGETHER.clusterRadius * MOVE_TOGETHER.clusterRadius;
    const near = (a: BuiltObject, b: BuiltObject): boolean => galaxy.calculateDistanceSquared(a.xpos, a.ypos, b.xpos, b.ypos) <= r2;
    let anchor = lead;
    let nearLead = 0;
    for (const b of core) if (near(b, lead)) nearLead++;
    if (nearLead * 2 < core.length) {
        // The lead is far off: the member with the most others near it (first on ties) ...
        let best = -1;
        let densest = lead;
        for (const a of core) {
            let n = 0;
            for (const b of core) if (near(a, b)) n++;
            if (n > best) {
                best = n;
                densest = a;
            }
        }
        // ... and the member nearest the centre of its cluster.
        let sx = 0;
        let sy = 0;
        let n = 0;
        for (const b of core) {
            if (!near(densest, b)) continue;
            sx += b.xpos;
            sy += b.ypos;
            n++;
        }
        const cx = sx / n;
        const cy = sy / n;
        let bestD = Number.MAX_VALUE;
        for (const b of core) {
            if (!near(densest, b)) continue;
            const d = distanceSquared(b, cx, cy);
            if (d < bestD) {
                bestD = d;
                anchor = b;
            }
        }
    }
    const g2 = MOVE_TOGETHER.gatherRadius * MOVE_TOGETHER.gatherRadius;
    let together = true;
    for (const b of core) {
        if (distanceSquared(b, anchor.xpos, anchor.ypos) > g2) {
            together = false;
            break;
        }
    }
    return { anchor, together };
}

/**
 * A fleet order was just assigned to `fleet`'s members (ShipGroup.AssignMission, or a queued order becoming the fleet
 * mission). Starts the run for a player's order of a move / attack / patrol type that is not urgent; otherwise ends any
 * previous run. Only called while the fleet's toggle is on.
 */
export function moveTogetherOnFleetOrder(galaxy: Galaxy, fleet: ShipGroup, playerOrder: boolean): void {
    delete fleet.together;
    const mission = fleet.mission;
    if (!playerOrder || mission === null || fleet.empire === null || !isMoveTogetherMissionType(mission.type) || isUrgentFleetOrder(fleet, mission)) return;
    const starDate = galaxyStarDate(galaxy);
    const members: BuiltObject[] = [];
    for (const bo of fleet.ships) if (carriesFleetOrder(bo, fleet, mission)) members.push(bo);
    let fleetHasWarp = false;
    for (const bo of members) if (bo.warpSpeed > 0) fleetHasWarp = true;
    const core: BuiltObject[] = [];
    const left: BuiltObject[] = [];
    for (const bo of members) (moveTogetherUnfitReason(bo, fleetHasWarp) === null ? core : left).push(bo);
    if (core.length < 2) return;
    const g = gatherAnchor(galaxy, fleet, core);
    const st: MoveTogetherState = {
        mission,
        phase: g.together ? 1 : 0,
        core,
        left,
        anchor: g.anchor,
        orderedAt: starDate,
        holdSince: -1,
        gatherCommands: [],
        jumpMembers: [],
        jumpEnteredAt: [],
        jumpFirst: -1,
        jumpAt: -1,
    };
    if (!g.together) {
        for (const bo of core) {
            const m = missionOf(bo)!;
            const all = m.showAllCommands();
            // Keep a leading Undock first (a docked ship cannot move before it).
            let i = 0;
            while (i < all.length && all[i].action === CommandAction.Undock) i++;
            // The gather commands target the anchor ship (not a point): Bacon's CheckNearTarget re-aims a coordinate
            // HyperTo at the mission target (combat/attackAI.ts checkNearTarget), but keeps one aimed at its own target.
            const gather =
                bo === g.anchor
                    ? [Command.withStarDate(CommandAction.HoldSyncFleet, starDate)]
                    : [
                          new Command(CommandAction.ClearParent),
                          Command.forTarget(CommandAction.ConditionalHyperTo, g.anchor),
                          Command.forTarget(CommandAction.MoveTo, g.anchor),
                          Command.withStarDate(CommandAction.HoldSyncFleet, starDate),
                      ];
            st.gatherCommands.push(...gather);
            m.replaceCommandStack([...all.slice(0, i), ...gather, ...all.slice(i)]);
            if (i === 0) bo.firstExecutionOfCommand = true;
        }
    }
    fleet.together = st;
}

/** Take `bo`'s remaining gather commands out of its order: it carries on with the stock order. */
function stripGather(st: MoveTogetherState, bo: BuiltObject): void {
    const m = missionOf(bo);
    if (m === null) return;
    const all = m.showAllCommands();
    const kept = all.filter((c) => !st.gatherCommands.includes(c));
    if (kept.length === all.length) return;
    if (all.length > 0 && st.gatherCommands.includes(all[0])) bo.firstExecutionOfCommand = true;
    m.replaceCommandStack(kept);
}

/** Leave `bo` behind: out of the group, back to the stock order. */
function leaveBehind(st: MoveTogetherState, bo: BuiltObject): void {
    const i = st.core.indexOf(bo);
    if (i >= 0) st.core.splice(i, 1);
    if (!st.left.includes(bo)) st.left.push(bo);
    stripGather(st, bo);
}

/** Ends the gather everywhere (the toggle switched off mid-gather): every member carries on with its order. */
function releaseGather(st: MoveTogetherState): void {
    for (const bo of [...st.core, ...st.left]) stripGather(st, bo);
}

/**
 * HoldSyncFleet step of a member (cmdHoldSyncFleet, before the stock check): leaves behind the members still on the way
 * once the wait is over, so the members already holding are released.
 */
export function moveTogetherHold(fleet: ShipGroup, bo: BuiltObject, starDate: number): void {
    const st = stateOf(fleet);
    if (st === null || st.phase !== 0) return;
    if (st.holdSince < 0) st.holdSince = starDate;
    const overall = starDate - st.orderedAt >= MOVE_TOGETHER.gatherMaxMs;
    let initiate = 0;
    for (const b of st.core) initiate = Math.max(initiate, b.hyperjumpInitiate);
    if (!overall && starDate - st.holdSince < MOVE_TOGETHER.holdWaitMs + initiate * 1000) return;
    const far2 = MOVE_TOGETHER.farDistance * MOVE_TOGETHER.farDistance;
    for (const other of [...st.core]) {
        if (other === bo) continue;
        const c = missionOf(other)?.fastPeekCurrentCommand() ?? null;
        if (c !== null && c.action === CommandAction.HoldSyncFleet) continue;
        // Past the wait: the ones still far away; past the overall limit: every one not holding yet.
        if (overall || st.anchor.hasBeenDestroyed || distanceSquared(other, st.anchor.xpos, st.anchor.ypos) > far2) leaveBehind(st, other);
    }
}

/** HoldSyncFleet released the members (cmdHoldSyncFleet): the gathered fleet travels together. */
export function moveTogetherReleased(fleet: ShipGroup): void {
    const st = stateOf(fleet);
    if (st !== null && st.phase === 0) st.phase = 1;
}

/** The run `bo` travels together in (phase 1, `bo` held together), or null. */
function travellingTogether(bo: BuiltObject): MoveTogetherState | null {
    const st = stateOf(fleetOf(bo));
    if (st === null || st.phase !== 1 || !st.core.includes(bo)) return null;
    const m = missionOf(bo);
    return m !== null && m.isShipGroupMission ? st : null;
}

/** The sublight speed `bo` flies at while together (the slowest member's cruise speed), or -1 (stock). */
export function moveTogetherCruiseSpeed(bo: BuiltObject): number {
    const st = travellingTogether(bo);
    if (st === null) return -1;
    let speed = 536870911;
    for (const b of st.core) if (Math.trunc(b.cruiseSpeed) < speed) speed = Math.trunc(b.cruiseSpeed);
    return speed;
}

/** The warp speed `bo` jumps at while together (the slowest member's), or -1 (stock). */
export function moveTogetherWarpSpeed(bo: BuiltObject): number {
    const st = travellingTogether(bo);
    if (st === null) return -1;
    let speed = 536870911;
    for (const b of st.core) {
        const w = warpSpeedWithBonuses(b);
        if (w > 0 && w < speed) speed = w;
    }
    return speed === 536870911 ? -1 : speed;
}

/** Fix the shared jump start once every member is ready (or the wait is over: the rest are left behind). */
function decideJump(st: MoveTogetherState, starDate: number): void {
    if (st.jumpAt >= 0 || st.jumpFirst < 0) return;
    const pending = st.core.filter((b) => !st.jumpMembers.includes(b));
    if (pending.length > 0 && starDate - st.jumpFirst < MOVE_TOGETHER.jumpWaitMs) return;
    for (const b of pending) leaveBehind(st, b);
    let at = 0;
    for (let i = 0; i < st.jumpMembers.length; i++) at = Math.max(at, st.jumpEnteredAt[i] + Math.max(0, st.jumpMembers[i].hyperjumpInitiate) * 1000);
    st.jumpAt = at;
}

/**
 * HyperTo's first step for `bo` (cmdHyperTo, after the stock countdown): `bo` joins the fleet's current jump. Members
 * left behind that caught up (fit again and near the joining member) rejoin the group here.
 */
export function moveTogetherJumpEntered(galaxy: Galaxy, bo: BuiltObject, starDate: number): void {
    const fleet = fleetOf(bo);
    const st = stateOf(fleet);
    if (st === null || st.phase !== 1) return;
    if (st.jumpAt >= 0 && starDate > st.jumpAt) {
        // The previous jump has started: this is the next one.
        st.jumpMembers = [];
        st.jumpEnteredAt = [];
        st.jumpFirst = -1;
        st.jumpAt = -1;
    }
    if (st.jumpFirst < 0 && st.core.includes(bo)) {
        // A new jump: stragglers that caught up rejoin.
        const r2 = MOVE_TOGETHER.gatherRadius * MOVE_TOGETHER.gatherRadius;
        let fleetHasWarp = false;
        for (const b of st.core) if (b.warpSpeed > 0) fleetHasWarp = true;
        for (const b of [...st.left]) {
            if (!carriesFleetOrder(b, fleet!, st.mission) || moveTogetherUnfitReason(b, fleetHasWarp) !== null) continue;
            if (galaxy.calculateDistanceSquared(b.xpos, b.ypos, bo.xpos, bo.ypos) > r2) continue;
            st.left.splice(st.left.indexOf(b), 1);
            st.core.push(b);
        }
    }
    if (!st.core.includes(bo) || st.jumpAt >= 0 || st.jumpMembers.includes(bo)) return;
    if (st.jumpFirst < 0) st.jumpFirst = starDate;
    st.jumpMembers.push(bo);
    st.jumpEnteredAt.push(starDate);
    decideJump(st, starDate);
}

/**
 * Every HyperTo step of `bo` before the jump check (cmdHyperTo): the shared start time, or a hold while the others get
 * ready. No-op for a member outside the current jump (its stock countdown stands).
 */
export function moveTogetherJumpCountdown(bo: BuiltObject, starDate: number): void {
    const st = stateOf(fleetOf(bo));
    if (st === null || st.phase !== 1 || !st.jumpMembers.includes(bo) || !st.core.includes(bo)) return;
    decideJump(st, starDate);
    // Undecided: keep the countdown ahead (the ship spins up but does not jump yet).
    bo.hyperjumpCountdown = st.jumpAt >= 0 ? st.jumpAt : starDate + MOVE_TOGETHER.jumpWaitMs;
}

/** The player's "Move together" toggle (journaled op fleetMoveTogether). Off ends a gather in progress. */
export function setFleetMoveTogether(galaxy: Galaxy, empire: Empire, fleet: ShipGroup | null, on: boolean): boolean {
    if (fleet === null || !isHumanEmpire(galaxy, empire) || fleet.empire !== empire || !(empire.shipGroups as unknown[]).includes(fleet)) return false;
    if (on) {
        fleet.moveTogether = true;
        return true;
    }
    const st = fleet.together;
    if (st !== undefined) releaseGather(st);
    delete fleet.together;
    delete fleet.moveTogether;
    return true;
}

/** For the UI: the toggle and what the current run is doing. Pure. */
export function moveTogetherStatus(fleet: ShipGroup | null): { on: boolean; text: string } {
    if (fleet === null || fleet.moveTogether !== true) return { on: false, text: '' };
    const st = fleet.together;
    if (st === undefined || fleet.mission !== st.mission) return { on: true, text: 'Next order: gather, then travel as one' };
    const behind = st.left.filter((b) => !b.hasBeenDestroyed && b.shipGroup === fleet).length;
    const tail = behind > 0 ? ` · ${behind} left behind` : '';
    return { on: true, text: `${st.phase === 0 ? 'Gathering' : 'Travelling together'} (${st.core.length} ships)${tail}` };
}
