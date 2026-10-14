// openDWU command (not in the original): Intercept / Defend / Watch system.
//
// - Intercept: the player selects a ship, fleet, base or space creature that is not theirs and sends "the best free
//   force" to destroy it. The force is picked by a weighted score (interceptCandidates: strength ratio as a hard filter,
//   then ETA, spare strength, fuel and damage), the target's course is predicted from its mission commands (and its
//   hyperjump, if any), and the force is sent to the lead-pursuit point where it arrives at the same time as the
//   target (solveIntercept), so it does not trail behind. The order is re-solved every few game seconds
//   (processIntercepts) and becomes a normal Attack mission once the force is in engagement range.
// - Defend: the same pick for a star system (no target strength: the strongest hostile presence seen there, if any);
//   the force gets the original's system patrol order (Empire.9.cs AssignFleetSystemPatrol / AssignShipSystemPatrol).
// - Watch system: a manual (automation off) fleet keeps patrolling a system for good; it leaves only to refuel at the
//   best refuel point and then comes back (processSystemWatches). A new player order or automation on clears it.
//
// State: `empire.intercepts` (the open intercept orders) and `fleet.watch`, both absent until used, so games and saves
// that never use the commands are unchanged. Orders arrive as journaled player commands (playerOps.ts 'intercept',
// 'defendSystem', 'fleetWatch'); the candidate lists are read-only queries for the UI. No galaxy.rnd draws of its own
// (the missions it assigns draw what any player order draws). No transcendental Math functions (bit-identical sims).
// Headless: no DOM / Pixi.

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import type { BuiltObject } from '../builtObject';
import { scenarioQuery } from '../scenario/hooks';
import { Habitat, type SystemInfo } from '../types';
import { Creature, CreatureType } from '../creature';
import { ShipGroup, empireShipGroups, shipGroupAssignMission, shipGroupWarpSpeed } from '../fleets/shipGroup';
import { BuiltObjectRole } from '../data/designSpecifications';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, CommandAction, builtObjectMission, type BuiltObjectMission } from '../missions/mission';
import { assignMission } from '../missions/assign';
import { markFleetPlayerOrder, markPlayerOrder } from '../missions/playerOrder';
import { calculateOverallStrengthFactor } from '../combat/threats';
import { baconMovementSettings, warpSpeedWithBonuses, withinFuelRangeAndRefuel } from '../movement';
import { shipGroupCalculateRequiredFuel, shipGroupCheckFleetTargetWithinFuelRangeAndRefuel, shipGroupCruiseSpeed, shipGroupIsShipAvailable } from '../fleets/shipGroupTasks';
import { decideBestFleetRefuelPoint } from '../fleets/militaryAI';
import { assignFleetSystemPatrol, assignShipSystemPatrol } from './executeShipAction';
import { DiplomaticRelationType } from '../diplomacy';
import { PirateRelationType } from '../pirateRelations';
import { isObjectVisibleToThisEmpire } from '../independentTraders';
import { EmpireMessageType, sendMessageToEmpire } from '../messages';
import { galaxyStarDate } from '../tick/simTime';
import { humanEmpires } from '../humanEmpires';
import { fleetMothballed, isMothballed } from '../scenario/mothballing/types';

// ---------------------------------------------------------------------------------------------------------------
// Tuning (named weights; costs are in game seconds — lower is better)
// ---------------------------------------------------------------------------------------------------------------

/** Our strength must be at least this multiple of the target's (hard filter). */
export const INTERCEPT_MIN_STRENGTH_RATIO = 1.5;
/** Cost per second of ETA (the dominant term). */
export const INTERCEPT_WEIGHT_ETA = 1.0;
/** Cost per unit of spare strength ratio above the minimum (ratio / min − 1, capped): prefer the smallest sufficient force. */
export const INTERCEPT_WEIGHT_EXCESS_STRENGTH = 15.0;
/** Spare strength counted at most this many times the minimum. */
export const INTERCEPT_EXCESS_STRENGTH_CAP = 8.0;
/** Cost for an empty tank (scaled by the lowest ship's missing fuel portion). */
export const INTERCEPT_WEIGHT_FUEL = 30.0;
/** Cost for a fully damaged force (scaled by the damaged share of its components). */
export const INTERCEPT_WEIGHT_DAMAGE = 60.0;
/** Re-solve the intercept every this many game ms. */
export const INTERCEPT_RESOLVE_MS = 3000;
/** Switch to the normal Attack order within this distance of the target. */
export const INTERCEPT_ENGAGE_RANGE = 6000;
/** Re-issue the move when the aim point moved more than max(this, share × remaining distance). */
export const INTERCEPT_REAIM_MIN = 1500;
export const INTERCEPT_REAIM_SHARE = 0.1;
/** The target's predicted course: at most this many legs. */
const MAX_LEGS = 10;
/** Watch: check the fleet every this many game ms; go refuel when a ship's tank is below this portion. */
export const WATCH_CHECK_MS = 2000;
export const WATCH_REFUEL_PORTION = 0.25;

// ---------------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------------

export type InterceptTarget = BuiltObject | ShipGroup | Creature;
export type InterceptForce = ShipGroup | BuiltObject;

/** One open intercept order of the player. */
export interface InterceptOrder {
    target: InterceptTarget;
    force: InterceptForce;
    /** 0 pursuing (moving to the intercept point), 1 attacking (the normal Attack mission). */
    phase: 0 | 1;
    aimX: number;
    aimY: number;
    /** The mission this order gave the force (a different one means someone else gave it an order). */
    mission: BuiltObjectMission | null;
    nextMs: number;
    /** The target went out of sight: the force flies to the last aim point, then the order ends. */
    lost: boolean;
}

/** A fleet's system watch. */
export interface SystemWatch {
    system: Habitat;
    /** The mission the watch gave the fleet (patrol or refuel). */
    mission: BuiltObjectMission | null;
    nextMs: number;
}

declare module '../empire' {
    interface Empire {
        /** openDWU command (not in the original): open intercept orders (player/intercept.ts); absent until used. */
        intercepts?: InterceptOrder[];
    }
}
declare module '../fleets/shipGroup' {
    interface ShipGroup {
        /** openDWU command (not in the original): the fleet's system watch (player/intercept.ts); absent = none. */
        watch?: SystemWatch;
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------------------------

function dist(x1: number, y1: number, x2: number, y2: number): number {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return Math.sqrt(dx * dx + dy * dy);
}

function isFleet(o: unknown): o is ShipGroup {
    return o instanceof ShipGroup;
}

function leadOf(o: InterceptTarget | InterceptForce): BuiltObject | null {
    if (isFleet(o)) return o.leadShip !== null ? o.leadShip : o.ships.length > 0 ? o.ships[0] : null;
    if (o instanceof Creature) return null;
    return o;
}

function posOf(o: InterceptTarget | InterceptForce): { x: number; y: number } {
    if (o instanceof Creature) return { x: o.xpos, y: o.ypos };
    const b = leadOf(o);
    return b !== null ? { x: b.xpos, y: b.ypos } : { x: 0, y: 0 };
}

function nameOfObj(o: unknown): string {
    const n = (o as { name?: string | null } | null)?.name;
    return n ?? '';
}

/** Gone: destroyed, or a fleet with no ships left. */
export function interceptTargetGone(t: InterceptTarget): boolean {
    if (isFleet(t)) return t.ships.length === 0 || t.ships.every((s) => s.hasBeenDestroyed);
    return t.hasBeenDestroyed;
}

function forceGone(f: InterceptForce): boolean {
    if (isFleet(f)) return f.ships.length === 0 || f.leadShip === null;
    return f.hasBeenDestroyed;
}

function missionOfForce(f: InterceptForce): BuiltObjectMission | null {
    return isFleet(f) ? f.mission : builtObjectMission(f.mission);
}

function idleMission(m: BuiltObjectMission | null): boolean {
    return m === null || m.type === BuiltObjectMissionType.Undefined;
}

/** The empire that owns the target (null: a creature or an unowned object). */
function ownerOf(t: InterceptTarget): Empire | null {
    if (t instanceof Creature) return null;
    if (isFleet(t)) return t.empire;
    return t.empire;
}

// ---------------------------------------------------------------------------------------------------------------
// Strength
// ---------------------------------------------------------------------------------------------------------------

/** The AI's strength measure (BuiltObject.1.cs 2268 CalculateOverallStrengthFactor: shields / 20 + firepower + fighters). */
export function interceptForceStrength(f: InterceptForce): number {
    if (!isFleet(f)) return calculateOverallStrengthFactor(f);
    let s = 0;
    for (const b of f.ships) if (!b.hasBeenDestroyed && shipGroupIsShipAvailable(b)) s += calculateOverallStrengthFactor(b);
    return s;
}

/** The target's strength as BuiltObject.1.cs 930 EvaluateAdequateAttackers rates it (a creature: AttackStrength × 5, × 4 Silver Mist). */
export function interceptTargetStrength(t: InterceptTarget): number {
    if (t instanceof Creature) return t.attackStrength * 5 * (t.type === CreatureType.SilverMist ? 4 : 1);
    if (isFleet(t)) {
        let s = 0;
        for (const b of t.ships) if (!b.hasBeenDestroyed) s += calculateOverallStrengthFactor(b);
        return s;
    }
    return calculateOverallStrengthFactor(t);
}

// ---------------------------------------------------------------------------------------------------------------
// Who may be attacked
// ---------------------------------------------------------------------------------------------------------------

/**
 * Why the player may not send a force against `target` (null: allowed). Creatures, independents and unowned objects
 * always; a pirate faction unless the player has an agreement with it (protection); another empire only at war. Reads
 * the relation lists directly (no lazy NotMet record is created).
 */
export function interceptForbiddenReason(galaxy: Galaxy, empire: Empire, target: InterceptTarget): string | null {
    const owner = ownerOf(target);
    if (owner === null || owner === galaxy.independentEmpire) return null;
    if (owner === empire) return 'Your own';
    if (owner.pirateEmpireBaseHabitat !== null || empire.pirateEmpireBaseHabitat !== null) {
        const pr = empire.pirateRelations.getRelationByOtherEmpire(owner);
        if (pr !== null && pr.type === PirateRelationType.Protection) return `Agreement with ${owner.name}`;
        return null;
    }
    const rel = empire.diplomaticRelations?.byEmpire(owner) ?? null;
    if (rel === null || rel.type !== DiplomaticRelationType.War) return `Not at war with ${owner.name}`;
    return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Motion: the target's predicted course and our travel time
// ---------------------------------------------------------------------------------------------------------------

/** One straight leg of the predicted course: from (x0, y0) at t0 to (x1, y1) at t1 (ms from now). A wait has x0 = x1. */
export interface PathLeg {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    t0: number;
    t1: number;
}
export interface TargetPath {
    legs: PathLeg[];
    /** Where the target ends up (after the last leg; also its position when it does not move). */
    endX: number;
    endY: number;
}

/** The target's position `t` ms from now on `path`. */
export function pathPositionAt(path: TargetPath, t: number): { x: number; y: number } {
    for (const l of path.legs) {
        if (t <= l.t1) {
            const span = l.t1 - l.t0;
            const f = span > 0 ? Math.max(0, Math.min(1, (t - l.t0) / span)) : 1;
            return { x: l.x0 + (l.x1 - l.x0) * f, y: l.y0 + (l.y1 - l.y0) * f };
        }
    }
    return { x: path.endX, y: path.endY };
}

function pathEndTime(path: TargetPath): number {
    return path.legs.length > 0 ? path.legs[path.legs.length - 1].t1 : 0;
}

/** Build legs: a wait of `waitMs`, then a straight move to (x, y) at `speed` (units / s). */
function pushMove(legs: PathLeg[], cur: { x: number; y: number; t: number }, x: number, y: number, speed: number, waitMs: number): void {
    if (waitMs > 0) {
        legs.push({ x0: cur.x, y0: cur.y, x1: cur.x, y1: cur.y, t0: cur.t, t1: cur.t + waitMs });
        cur.t += waitMs;
    }
    const d = dist(cur.x, cur.y, x, y);
    if (d <= 0 || speed <= 0) return;
    const t1 = cur.t + (d / speed) * 1000;
    legs.push({ x0: cur.x, y0: cur.y, x1: x, y1: y, t0: cur.t, t1 });
    cur.x = x;
    cur.y = y;
    cur.t = t1;
}

/** Where a movement command points (BuiltObjectMission.ResolveTargetCoordinatesCurrentCommand, any command). */
function commandPoint(cmd: { targetBuiltObject: BuiltObject | null; targetHabitat: Habitat | null; targetCreature: Creature | null; targetShipGroup: ShipGroup | null; xpos: number; ypos: number }): { x: number; y: number } | null {
    if (cmd.targetBuiltObject !== null) return { x: cmd.targetBuiltObject.xpos, y: cmd.targetBuiltObject.ypos };
    if (cmd.targetHabitat !== null) return { x: cmd.targetHabitat.xpos, y: cmd.targetHabitat.ypos };
    if (cmd.targetCreature !== null) return { x: cmd.targetCreature.xpos, y: cmd.targetCreature.ypos };
    if (cmd.targetShipGroup !== null) return cmd.targetShipGroup.leadShip !== null ? { x: cmd.targetShipGroup.leadShip.xpos, y: cmd.targetShipGroup.leadShip.ypos } : null;
    if (cmd.xpos > -2000000001.0 && cmd.ypos > -2000000001.0) return { x: cmd.xpos, y: cmd.ypos };
    return null;
}

/** Bookkeeping commands a moving ship passes through without stopping. */
function isPassThrough(a: CommandAction): boolean {
    return a === CommandAction.Undock || a === CommandAction.EvaluateThreats || a === CommandAction.SetParent || a === CommandAction.ClearParent || a === CommandAction.ClearAttackers;
}

/**
 * The predicted course of a ship (or a fleet's lead ship) from its mission's command queue, as the sim moves it
 * (missions/cmdMovement.ts): in hyperspace it flies on at its current speed to the jump target; a HyperTo /
 * ConditionalHyperTo beyond the hyperjump threshold waits for the jump countdown (HyperjumpInitiate) then flies at warp
 * speed; other moves go at cruise speed. The course stops at the first command that is not a move (Hold, Dock, Attack …).
 */
function shipPath(galaxy: Galaxy, bo: BuiltObject): TargetPath {
    const legs: PathLeg[] = [];
    const cur = { x: bo.xpos, y: bo.ypos, t: 0 };
    const done = (): TargetPath => ({ legs, endX: cur.x, endY: cur.y });
    if (bo.role === BuiltObjectRole.Base || bo.topSpeed <= 0) return done();
    const mission = builtObjectMission(bo.mission);
    if (mission === null || mission.type === BuiltObjectMissionType.Undefined) return done();
    const fleet = bo.shipGroup as ShipGroup | null;
    let warp = warpSpeedWithBonuses(bo);
    if (fleet !== null && mission.isShipGroupMission && shipGroupWarpSpeed(fleet) > 0) warp = Math.min(warp, shipGroupWarpSpeed(fleet));
    const cruise = Math.max(1, bo.cruiseSpeed);
    const threshold = baconMovementSettings.hyperJumpThreshhold;
    const starDate = galaxyStarDate(galaxy);
    const cmds = mission.showAllCommands();
    let first = true;
    for (const cmd of cmds) {
        if (legs.length >= MAX_LEGS) break;
        if (cmd === null || cmd === undefined) continue;
        const a = cmd.action;
        if (isPassThrough(a)) continue;
        const moving = a === CommandAction.MoveTo || a === CommandAction.ImpulseTo || a === CommandAction.SprintTo || a === CommandAction.HyperTo || a === CommandAction.ConditionalHyperTo;
        if (!moving) break;
        const p = commandPoint(cmd);
        if (p === null) break;
        const d = dist(cur.x, cur.y, p.x, p.y);
        const hyper = a === CommandAction.HyperTo || a === CommandAction.ConditionalHyperTo;
        if (first && bo.currentSpeed > bo.topSpeed) {
            // Already in hyperspace: on to the jump's exit point at the current speed.
            const ex = hyper && (bo.hyperjumpX !== -1.0 || bo.hyperjumpY !== -1.0) ? { x: p.x + bo.hyperjumpX, y: p.y + bo.hyperjumpY } : p;
            pushMove(legs, cur, ex.x, ex.y, bo.currentSpeed, 0);
        } else if (hyper && warp > 0 && d > threshold) {
            let wait = Math.max(0, bo.hyperjumpInitiate) * 1000;
            // Mod layer (slow hyperdrive / jump interdiction): the spool's total factor (a field only where it is now; an open
            // spool's countdown already has it).
            if (galaxy.scenario !== null) wait *= scenarioQuery(galaxy, 'hyperjumpSpoolFactor', 1, { ship: bo, here: first });
            if (first && !bo.firstExecutionOfCommand) wait = Math.max(0, bo.hyperjumpCountdown - starDate);
            pushMove(legs, cur, p.x, p.y, warp, wait);
        } else {
            pushMove(legs, cur, p.x, p.y, first ? Math.max(cruise, Math.min(bo.currentSpeed, bo.topSpeed)) : cruise, 0);
        }
        first = false;
    }
    return done();
}

/** A creature's course (Creature.cs Move): toward its target / parent habitat / anchor; a far one hyper-lunges. */
function creaturePath(c: Creature): TargetPath {
    const legs: PathLeg[] = [];
    const cur = { x: c.xpos, y: c.ypos, t: 0 };
    const done = (): TargetPath => ({ legs, endX: cur.x, endY: cur.y });
    if (!(c.targetSpeed > 0 || c.currentSpeed > 0)) return done();
    let p: { x: number; y: number } | null = null;
    if (!c.isBenign && c.currentTarget !== null) p = { x: c.currentTarget.xpos, y: c.currentTarget.ypos };
    else if (c.parentHabitat !== null) p = { x: c.parentHabitat.xpos + c.parentOffsetX, y: c.parentHabitat.ypos + c.parentOffsetY };
    else if (c.anchorPoint !== null) p = { x: c.anchorPoint.x + c.parentOffsetX, y: c.anchorPoint.y + c.parentOffsetY };
    if (p === null) return done();
    const d = dist(cur.x, cur.y, p.x, p.y);
    if (c.currentSpeed > c.movementSpeed && c.currentSpeed > c.lungeSpeed) pushMove(legs, cur, p.x, p.y, c.currentSpeed, 0);
    else if (c.hyperSpeed > 0 && d > baconMovementSettings.hyperJumpThreshhold && c.movementSpeed < c.hyperSpeed) pushMove(legs, cur, p.x, p.y, c.hyperSpeed, c.hyperCountdown > 0 ? c.hyperCountdown : 11000);
    else pushMove(legs, cur, p.x, p.y, Math.max(1, c.movementSpeed), 0);
    return done();
}

/** The target's predicted course (a base / parked ship: no legs, it stays where it is). */
export function predictTargetPath(galaxy: Galaxy, target: InterceptTarget): TargetPath {
    if (target instanceof Creature) return creaturePath(target);
    const b = leadOf(target);
    if (b === null) return { legs: [], endX: 0, endY: 0 };
    return shipPath(galaxy, b);
}

/** How our force travels: from (x, y), sublight `cruise`, `warp` (0: none) after `initiateMs` beyond the jump threshold. */
export interface ForceMotion {
    x: number;
    y: number;
    cruise: number;
    warp: number;
    initiateMs: number;
}

export function forceMotion(f: InterceptForce, galaxy: Galaxy | null = null): ForceMotion {
    const p = posOf(f);
    // Mod layer (slow hyperdrive / jump interdiction): our own spool's total factor (a hostile field where it is now).
    const k = (b: BuiltObject): number => (galaxy !== null && galaxy.scenario !== null ? scenarioQuery(galaxy, 'hyperjumpSpoolFactor', 1, { ship: b, here: true }) : 1);
    if (isFleet(f)) {
        let initiate = 0;
        for (const b of f.ships) initiate = Math.max(initiate, b.hyperjumpInitiate * k(b));
        return { x: p.x, y: p.y, cruise: Math.max(1, shipGroupCruiseSpeed(f)), warp: shipGroupWarpSpeed(f), initiateMs: initiate * 1000 };
    }
    return { x: p.x, y: p.y, cruise: Math.max(1, f.cruiseSpeed), warp: f.warpSpeed > 0 ? warpSpeedWithBonuses(f) : 0, initiateMs: Math.max(0, f.hyperjumpInitiate) * 1000 * k(f) };
}

/** Our travel time (ms) to a point `d` away (the sim's model, as player/constructionBoard.ts estimateTravelMs). */
export function forceTravelMs(m: ForceMotion, d: number): number {
    if (d <= 0) return 0;
    if (m.warp > 0 && d > baconMovementSettings.hyperJumpThreshhold) return (d / m.warp) * 1000 + m.initiateMs;
    return (d / m.cruise) * 1000;
}

export interface InterceptSolution {
    x: number;
    y: number;
    /** Our travel time to (x, y), ms. */
    etaMs: number;
    /** When the target is at (x, y), ms from now (≤ etaMs only when we must wait at its end point). */
    targetMs: number;
}

/**
 * Lead pursuit: the earliest t at which our travel time to the target's predicted position P(t) is ≤ t (we are there
 * when it is). Each leg is sampled, then the first bracket is bisected. When no such t exists before the end of the
 * predicted course, we go to its end point (we arrive after the target and catch it there).
 */
export function solveIntercept(path: TargetPath, m: ForceMotion): InterceptSolution {
    const f = (t: number): number => {
        const p = pathPositionAt(path, t);
        return forceTravelMs(m, dist(m.x, m.y, p.x, p.y)) - t;
    };
    const at = (t: number): InterceptSolution => {
        const p = pathPositionAt(path, t);
        return { x: p.x, y: p.y, etaMs: forceTravelMs(m, dist(m.x, m.y, p.x, p.y)), targetMs: t };
    };
    if (f(0) <= 0) return at(0);
    let prev = 0;
    const SAMPLES = 48;
    for (const l of path.legs) {
        for (let i = 1; i <= SAMPLES; i++) {
            const t = l.t0 + ((l.t1 - l.t0) * i) / SAMPLES;
            if (t <= prev) continue;
            if (f(t) <= 0) {
                let lo = prev;
                let hi = t;
                for (let k = 0; k < 40; k++) {
                    const mid = (lo + hi) / 2;
                    if (f(mid) <= 0) hi = mid;
                    else lo = mid;
                }
                return at(hi);
            }
            prev = t;
        }
    }
    const end = pathEndTime(path);
    const eta = forceTravelMs(m, dist(m.x, m.y, path.endX, path.endY));
    return { x: path.endX, y: path.endY, etaMs: eta, targetMs: end };
}

// ---------------------------------------------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------------------------------------------

export interface InterceptCandidate {
    force: InterceptForce;
    isFleet: boolean;
    name: string;
    strength: number;
    /** Our strength / the target's (Infinity: an unarmed target). */
    ratio: number;
    etaMs: number;
    aimX: number;
    aimY: number;
    /** The weighted cost (lower is better). */
    score: number;
}

/** Mission types a force may be taken off (idle or routine duty). */
function freeMission(m: BuiltObjectMission | null): boolean {
    if (m === null) return true;
    switch (m.type) {
        case BuiltObjectMissionType.Undefined:
        case BuiltObjectMissionType.Move:
        case BuiltObjectMissionType.MoveAndWait:
        case BuiltObjectMissionType.Hold:
        case BuiltObjectMissionType.Patrol:
            return true;
    }
    return false;
}

function busyWithOrder(empire: Empire, f: InterceptForce): boolean {
    for (const o of empire.intercepts ?? []) if (o.force === f) return true;
    return false;
}

function fuelPortion(b: BuiltObject): number {
    return b.fuelCapacity > 0 ? Math.max(0, Math.min(1, b.currentFuel / b.fuelCapacity)) : 1;
}

function readiness(ships: readonly BuiltObject[]): { fuel: number; damaged: number } {
    let fuel = 1;
    let damaged = 0;
    let total = 0;
    for (const b of ships) {
        fuel = Math.min(fuel, fuelPortion(b));
        damaged += b.damagedComponentCount;
        total += Math.max(1, b.components.count);
    }
    return { fuel, damaged: total > 0 ? damaged / total : 0 };
}

/** The weighted cost of a candidate (lower is better; game seconds). */
export function interceptCost(ratio: number, etaMs: number, ships: readonly BuiltObject[]): number {
    const r = readiness(ships);
    const excess = Math.min(ratio / INTERCEPT_MIN_STRENGTH_RATIO, INTERCEPT_EXCESS_STRENGTH_CAP) - 1;
    return INTERCEPT_WEIGHT_ETA * (etaMs / 1000) + INTERCEPT_WEIGHT_EXCESS_STRENGTH * Math.max(0, excess) + INTERCEPT_WEIGHT_FUEL * (1 - r.fuel) + INTERCEPT_WEIGHT_DAMAGE * r.damaged;
}

function tieId(f: InterceptForce): number {
    const b = leadOf(f);
    return b !== null ? b.builtObjectID : 0;
}

/**
 * The player's forces that could take the order, best first: free fleets (idle or on routine duty, not on another
 * intercept or a system watch) that are strong enough (ratio ≥ INTERCEPT_MIN_STRENGTH_RATIO) and have the fuel for the
 * trip and back to a refuel point, by weighted cost; then the same for single armed warships outside fleets. `path`
 * null = a stationary point (Defend). Ties by lead ship id. Read-only.
 */
function rankForces(galaxy: Galaxy, empire: Empire, path: TargetPath, need: number): InterceptCandidate[] {
    const fleets: InterceptCandidate[] = [];
    const ships: InterceptCandidate[] = [];
    const ratioOf = (s: number): number => (need > 0 ? s / need : Number.POSITIVE_INFINITY);
    for (const g of empireShipGroups(empire)) {
        if (g === null || g.leadShip === null || g.ships.length === 0 || g.watch !== undefined) continue;
        if (fleetMothballed(g)) continue; // mothballing add-on: on its way to, in or leaving reserve
        if (!freeMission(g.mission) || busyWithOrder(empire, g)) continue;
        if (g.leadShip.topSpeed <= 0) continue;
        const strength = interceptForceStrength(g);
        if (strength <= 0) continue;
        const ratio = ratioOf(strength);
        if (ratio < INTERCEPT_MIN_STRENGTH_RATIO) continue;
        const sol = solveIntercept(path, forceMotion(g, galaxy));
        if (!shipGroupCheckFleetTargetWithinFuelRangeAndRefuel(galaxy, g, sol.x, sol.y, 0.0)) continue;
        fleets.push({ force: g, isFleet: true, name: g.name ?? '', strength, ratio, etaMs: sol.etaMs, aimX: sol.x, aimY: sol.y, score: interceptCost(ratio, sol.etaMs, g.ships) });
    }
    for (const b of empire.builtObjects) {
        if (b === null || b.hasBeenDestroyed || b.role !== BuiltObjectRole.Military || b.shipGroup !== null) continue;
        if (b.builtAt !== null || b.retrofitDesign !== null || b.topSpeed <= 0 || b.firepowerRaw <= 0) continue;
        if (isMothballed(b)) continue; // mothballing add-on
        if (!freeMission(builtObjectMission(b.mission)) || busyWithOrder(empire, b)) continue;
        const strength = calculateOverallStrengthFactor(b);
        const ratio = ratioOf(strength);
        if (ratio < INTERCEPT_MIN_STRENGTH_RATIO) continue;
        const sol = solveIntercept(path, forceMotion(b, galaxy));
        if (!withinFuelRangeAndRefuel(galaxy, b, sol.x, sol.y, 0.0)) continue;
        ships.push({ force: b, isFleet: false, name: b.name, strength, ratio, etaMs: sol.etaMs, aimX: sol.x, aimY: sol.y, score: interceptCost(ratio, sol.etaMs, [b]) });
    }
    const order = (a: InterceptCandidate, c: InterceptCandidate): number => a.score - c.score || tieId(a.force) - tieId(c.force);
    fleets.sort(order);
    ships.sort(order);
    return fleets.concat(ships);
}

/** The forces that can intercept `target`, best first (empty when none, or when attacking it is not allowed). Read-only. */
export function interceptCandidates(galaxy: Galaxy, empire: Empire, target: InterceptTarget): InterceptCandidate[] {
    if (interceptTargetGone(target) || interceptForbiddenReason(galaxy, empire, target) !== null) return [];
    return rankForces(galaxy, empire, predictTargetPath(galaxy, target), interceptTargetStrength(target));
}

/** The hostile strength the player can see in the system (ships of empires at war / unagreed pirates, hostile creatures). Read-only. */
export function systemHostileStrength(galaxy: Galaxy, empire: Empire, star: Habitat): number {
    let s = 0;
    for (const b of galaxy.builtObjects) {
        if (b === null || b.hasBeenDestroyed || b.nearestSystemStar !== star || b.empire === empire || b.firepowerRaw <= 0) continue;
        if (b.empire === null || b.empire === galaxy.independentEmpire) continue;
        if (interceptForbiddenReason(galaxy, empire, b) !== null) continue;
        if (!isObjectVisibleToThisEmpire(galaxy, empire, b)) continue;
        s += calculateOverallStrengthFactor(b);
    }
    const sys = galaxy.systems[star.systemIndex] as SystemInfo | undefined;
    for (const c of sys?.creatures ?? []) {
        if (c.hasBeenDestroyed || c.isBenign || !empire.visibility.isCreatureVisible(c)) continue;
        s += interceptTargetStrength(c);
    }
    return s;
}

/** The system star of a selection (the star itself, or a habitat's system star). */
export function systemStarOf(galaxy: Galaxy, h: Habitat): Habitat | null {
    const sys = galaxy.systems[h.systemIndex] as SystemInfo | undefined;
    return sys?.systemStar ?? null;
}

/** The forces that can defend the system of `star`, best first. Read-only. */
export function defendCandidates(galaxy: Galaxy, empire: Empire, star: Habitat): InterceptCandidate[] {
    return rankForces(galaxy, empire, { legs: [], endX: star.xpos, endY: star.ypos }, systemHostileStrength(galaxy, empire, star));
}

// ---------------------------------------------------------------------------------------------------------------
// Orders (player commands)
// ---------------------------------------------------------------------------------------------------------------

function isCandidate(list: readonly InterceptCandidate[], f: InterceptForce | null): InterceptCandidate | null {
    if (list.length === 0) return null;
    if (f === null) return list[0];
    return list.find((c) => c.force === f) ?? null;
}

function moveForce(galaxy: Galaxy, f: InterceptForce, x: number, y: number): BuiltObjectMission | null {
    if (isFleet(f)) {
        shipGroupAssignMission(galaxy, f, BuiltObjectMissionType.Move, null, null, BuiltObjectMissionPriority.High, true, { x, y });
        markFleetPlayerOrder(f);
    } else {
        assignMission(galaxy, f, BuiltObjectMissionType.Move, null, null, BuiltObjectMissionPriority.High, { x, y, manuallyAssigned: true });
        markPlayerOrder(f);
    }
    return missionOfForce(f);
}

function attackWith(galaxy: Galaxy, f: InterceptForce, target: InterceptTarget): BuiltObjectMission | null {
    const t = target as BuiltObject | ShipGroup | Creature;
    if (isFleet(f)) {
        shipGroupAssignMission(galaxy, f, BuiltObjectMissionType.Attack, t, null, BuiltObjectMissionPriority.High, true);
        markFleetPlayerOrder(f);
    } else {
        assignMission(galaxy, f, BuiltObjectMissionType.Attack, t, null, BuiltObjectMissionPriority.High, { manuallyAssigned: true });
        markPlayerOrder(f);
    }
    return missionOfForce(f);
}

function stationary(path: TargetPath): boolean {
    return path.legs.length === 0;
}

export interface InterceptCommandResult {
    ok: boolean;
    message: string;
    force: InterceptForce | null;
}

/**
 * Player command 'intercept': send `force` (null: the best candidate) against `target`. The force must be one of
 * interceptCandidates at the time the command is applied.
 */
export function issueIntercept(galaxy: Galaxy, empire: Empire, target: InterceptTarget, force: InterceptForce | null): InterceptCommandResult {
    if (interceptTargetGone(target)) return { ok: false, message: 'The target is gone', force: null };
    const why = interceptForbiddenReason(galaxy, empire, target);
    if (why !== null) return { ok: false, message: why, force: null };
    const c = isCandidate(interceptCandidates(galaxy, empire, target), force);
    if (c === null) return { ok: false, message: 'No free fleet or warship strong enough', force: null };
    // A newer intercept of the same force replaces the old one.
    const list = (empire.intercepts ??= []);
    const order: InterceptOrder = { target, force: c.force, phase: 0, aimX: c.aimX, aimY: c.aimY, mission: null, nextMs: galaxy.nowMs + INTERCEPT_RESOLVE_MS, lost: false };
    const path = predictTargetPath(galaxy, target);
    const p = posOf(c.force);
    if (stationary(path) || dist(p.x, p.y, posOf(target).x, posOf(target).y) <= INTERCEPT_ENGAGE_RANGE) {
        order.phase = 1;
        order.mission = attackWith(galaxy, c.force, target);
    } else {
        order.mission = moveForce(galaxy, c.force, c.aimX, c.aimY);
    }
    if (isFleet(c.force)) delete c.force.watch;
    list.push(order);
    return { ok: true, message: `${c.name} sent to intercept ${nameOfObj(target)}`, force: c.force };
}

/** Player command 'defendSystem': send `force` (null: the best candidate) to patrol the system of `star`. */
export function issueDefendSystem(galaxy: Galaxy, empire: Empire, star: Habitat, force: InterceptForce | null): InterceptCommandResult {
    const sys = galaxy.systems[star.systemIndex] as SystemInfo | undefined;
    if (sys === undefined) return { ok: false, message: 'No system', force: null };
    const c = isCandidate(defendCandidates(galaxy, empire, sys.systemStar), force);
    if (c === null) return { ok: false, message: 'No free fleet or warship available', force: null };
    if (isFleet(c.force)) {
        assignFleetSystemPatrol(galaxy, empire, c.force, sys);
        markFleetPlayerOrder(c.force);
        if (c.force.watch !== undefined && c.force.watch.system !== sys.systemStar) delete c.force.watch;
    } else {
        assignShipSystemPatrol(galaxy, empire, c.force, sys, true);
        markPlayerOrder(c.force);
    }
    return { ok: true, message: `${c.name} sent to defend ${sys.systemStar.name}`, force: c.force };
}

function finish(empire: Empire, o: InterceptOrder, text: string | null): void {
    const list = empire.intercepts;
    if (list !== undefined) {
        const i = list.indexOf(o);
        if (i >= 0) list.splice(i, 1);
        if (list.length === 0) delete empire.intercepts;
    }
    if (text !== null) sendMessageToEmpire(empire, empire, EmpireMessageType.GeneralNeutralEvent, o.force, text);
}

function targetVisible(galaxy: Galaxy, empire: Empire, t: InterceptTarget): boolean {
    if (t instanceof Creature) return empire.visibility.isCreatureVisible(t);
    const b = leadOf(t);
    return b !== null && isObjectVisibleToThisEmpire(galaxy, empire, b);
}

function inHyperspace(f: InterceptForce): boolean {
    const ships = isFleet(f) ? f.ships : [f];
    for (const b of ships) if (b.currentSpeed > b.topSpeed || b.hyperjumpPrepare) return true;
    return false;
}

/** One step of an open intercept order (every INTERCEPT_RESOLVE_MS). */
function stepIntercept(galaxy: Galaxy, empire: Empire, o: InterceptOrder): void {
    o.nextMs = galaxy.nowMs + INTERCEPT_RESOLVE_MS;
    const tName = nameOfObj(o.target);
    const fName = nameOfObj(o.force);
    if (interceptTargetGone(o.target)) return finish(empire, o, `Intercept over: ${tName} has been destroyed`);
    if (forceGone(o.force)) return finish(empire, o, `Intercept of ${tName} cancelled: ${fName} is gone`);
    if (interceptForbiddenReason(galaxy, empire, o.target) !== null) return finish(empire, o, `Intercept of ${tName} cancelled: no longer hostile`);
    const m = missionOfForce(o.force);
    if (m !== o.mission && !idleMission(m)) {
        // Someone else gave the force an order: the player (a player order) ends the intercept; a refuel / repair stop
        // is waited out; an AI reassignment of an automated force is overridden again.
        if (m!.playerOrdered === true) return finish(empire, o, null);
        if (m!.type === BuiltObjectMissionType.Refuel || m!.type === BuiltObjectMissionType.Repair) return;
        o.mission = null;
        o.phase = 0;
    }
    const idle = idleMission(m) || o.mission === null;
    const visible = targetVisible(galaxy, empire, o.target);
    if (!visible) {
        if (!o.lost) {
            // Out of sight: on to the last predicted point (an Attack mission would stop chasing a target it cannot see).
            o.lost = true;
            if (o.phase === 1 || idle) o.mission = moveForce(galaxy, o.force, o.aimX, o.aimY);
            o.phase = 0;
            return;
        }
        if (idle) return finish(empire, o, `Intercept of ${tName} abandoned: contact lost`);
        return;
    }
    o.lost = false;
    const tp = posOf(o.target);
    const fp = posOf(o.force);
    if (dist(fp.x, fp.y, tp.x, tp.y) <= INTERCEPT_ENGAGE_RANGE) {
        if (o.phase !== 1 || idle) {
            o.phase = 1;
            o.mission = attackWith(galaxy, o.force, o.target);
        }
        return;
    }
    if (o.phase === 1 && !idle) return; // the Attack mission chases it
    const path = predictTargetPath(galaxy, o.target);
    if (stationary(path)) {
        o.phase = 1;
        o.mission = attackWith(galaxy, o.force, o.target);
        return;
    }
    const sol = solveIntercept(path, forceMotion(o.force, galaxy));
    const moved = dist(sol.x, sol.y, o.aimX, o.aimY);
    const remaining = dist(fp.x, fp.y, sol.x, sol.y);
    o.phase = 0;
    if (idle || (moved > Math.max(INTERCEPT_REAIM_MIN, INTERCEPT_REAIM_SHARE * remaining) && !inHyperspace(o.force))) {
        o.aimX = sol.x;
        o.aimY = sol.y;
        o.mission = moveForce(galaxy, o.force, sol.x, sol.y);
    }
}

/** Per frame (tick/scheduler.ts): the human empires' open intercept orders. O(1) per human without any. */
export function processIntercepts(galaxy: Galaxy): void {
    for (const empire of humanEmpires(galaxy)) {
        const list = empire.intercepts;
        if (list === undefined) continue;
        for (const o of list.slice()) {
            if (galaxy.nowMs >= o.nextMs) stepIntercept(galaxy, empire, o);
        }
    }
}

/** The open intercept order of a force (UI). */
export function interceptOrderOf(empire: Empire, force: InterceptForce): InterceptOrder | null {
    for (const o of empire.intercepts ?? []) if (o.force === force) return o;
    return null;
}

// ---------------------------------------------------------------------------------------------------------------
// System watch
// ---------------------------------------------------------------------------------------------------------------

/** The system a fleet would watch: its patrol / move target's system, else the system it is in. */
export function watchSystemFor(galaxy: Galaxy, fleet: ShipGroup): Habitat | null {
    if (fleet.watch !== undefined) return fleet.watch.system;
    const m = fleet.mission;
    if (m !== null && m.type !== BuiltObjectMissionType.Undefined) {
        const t = m.target;
        if (t instanceof Habitat) return systemStarOf(galaxy, t);
        if (t !== null && !(t instanceof ShipGroup) && (t as BuiltObject).nearestSystemStar !== undefined) {
            const s = (t as BuiltObject).nearestSystemStar as Habitat | null;
            if (s !== null) return s;
        }
    }
    const lead = fleet.leadShip;
    return lead !== null ? (lead.nearestSystemStar as Habitat | null) : null;
}

/** Why the fleet cannot start a watch (null: it can). */
export function watchUnavailableReason(galaxy: Galaxy, empire: Empire, fleet: ShipGroup): string | null {
    if (fleet.empire !== empire || fleet.leadShip === null) return 'Not your fleet';
    if (fleet.leadShip.isAutoControlled) return 'Turn the fleet\'s automation off first';
    if (fleetMothballed(fleet)) return 'The fleet is mothballed';
    if (watchSystemFor(galaxy, fleet) === null) return 'Not in or bound for a system';
    return null;
}

function fleetNeedsFuel(fleet: ShipGroup): boolean {
    for (const b of fleet.ships) if (b.fuelCapacity > 0 && fuelPortion(b) < WATCH_REFUEL_PORTION) return true;
    return false;
}

function patrolSystem(galaxy: Galaxy, empire: Empire, fleet: ShipGroup, star: Habitat): BuiltObjectMission | null {
    const sys = galaxy.systems[star.systemIndex] as SystemInfo | undefined;
    if (sys === undefined) return null;
    assignFleetSystemPatrol(galaxy, empire, fleet, sys);
    markFleetPlayerOrder(fleet);
    return fleet.mission;
}

/** Player command 'fleetWatch': start (patrolling the system now) or stop a fleet's system watch. */
export function setFleetWatch(galaxy: Galaxy, empire: Empire, fleet: ShipGroup, on: boolean): boolean {
    if (!on) {
        if (fleet.watch === undefined) return false;
        delete fleet.watch;
        return true;
    }
    if (watchUnavailableReason(galaxy, empire, fleet) !== null) return false;
    const star = watchSystemFor(galaxy, fleet)!;
    const w: SystemWatch = { system: star, mission: null, nextMs: galaxy.nowMs + WATCH_CHECK_MS };
    fleet.watch = w;
    const o = interceptOrderOf(empire, fleet);
    if (o !== null) finish(empire, o, null);
    const m = fleet.mission;
    const t = m !== null && m.type === BuiltObjectMissionType.Patrol ? m.target : null;
    if (t instanceof Habitat && systemStarOf(galaxy, t) === star) w.mission = m;
    else w.mission = patrolSystem(galaxy, empire, fleet, star);
    return true;
}

function stepWatch(galaxy: Galaxy, empire: Empire, fleet: ShipGroup, w: SystemWatch): void {
    w.nextMs = galaxy.nowMs + WATCH_CHECK_MS;
    const lead = fleet.leadShip;
    if (lead === null || fleet.ships.length === 0 || lead.isAutoControlled) {
        delete fleet.watch;
        return;
    }
    const m = fleet.mission;
    if (m !== w.mission && !idleMission(m)) {
        // A refuel / repair stop of the fleet itself is waited out; any other new order ends the watch.
        if (m!.type === BuiltObjectMissionType.Refuel || m!.type === BuiltObjectMissionType.Repair) return;
        delete fleet.watch;
        return;
    }
    if (!idleMission(m) && m!.type === BuiltObjectMissionType.Refuel) return; // our refuel trip
    if (fleetNeedsFuel(fleet)) {
        const point = decideBestFleetRefuelPoint(galaxy, empire, lead.xpos, lead.ypos, empire, shipGroupCalculateRequiredFuel(fleet), null);
        if (point !== null) {
            shipGroupAssignMission(galaxy, fleet, BuiltObjectMissionType.Refuel, point, null, BuiltObjectMissionPriority.Unavailable, true);
            markFleetPlayerOrder(fleet);
            w.mission = fleet.mission;
            return;
        }
    }
    if (idleMission(m)) w.mission = patrolSystem(galaxy, empire, fleet, w.system);
}

/** Per frame (tick/scheduler.ts): the human empires' fleets on a system watch. */
export function processSystemWatches(galaxy: Galaxy): void {
    for (const empire of humanEmpires(galaxy)) {
        for (const g of empireShipGroups(empire)) {
            if (g === null || g.watch === undefined || galaxy.nowMs < g.watch.nextMs) continue;
            stepWatch(galaxy, empire, g, g.watch);
        }
    }
}

/** The watch line for the selection panel ("Watching Sol"), or ''. */
export function watchStatusText(fleet: ShipGroup | null): string {
    if (fleet === null || fleet.watch === undefined) return '';
    const m = fleet.mission;
    if (m !== null && m.type === BuiltObjectMissionType.Refuel) return `Watching ${fleet.watch.system.name} (refuelling)`;
    return `Watching ${fleet.watch.system.name}`;
}
