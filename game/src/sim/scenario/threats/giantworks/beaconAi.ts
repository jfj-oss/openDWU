// The Beacon, part 4: the galaxy's answer (flag gwBeacon). Not a port: new scenario behaviour composed of ported functions.
//
// The stock AI treats the Reclaimers as one more empire at war, which is not enough against a machine faction whose waves spawn from
// nothing, whose strike groups come out of deep space and whose Beacon is plated like a fortress: no single empire's fleet will
// out-gun the Beacon, nobody sees a staging fleet, and a world under attack is defended only by whatever happens to be near it.
// This module is the AI empires' joint answer (a coalition: AI members share what any of them knows, as the Purifier's hunters do;
// a human is never told through it, and never ordered). Every AI empire at war with the Reclaimers takes part (not one under a dark
// bargain). Every beaconAiPeriodDays it sums the free warships of ALL members within reach and, in this order of urgency:
//   RELIEF   - a strike group on its way to (or besieging) a world: members' free fleets Patrol that world's star (the stock defence
//              fights beside them) once their force with the owner's own defenders is beaconAiReliefPct % of the group's;
//   STAGING  - a staging fleet any member has noticed (waves gathering at a staging point): a strike Attack on its lead ship, when
//              the fleets that can arrive before the departure are beaconAiRatioPct % of the gathered force;
//   WATCHER  - a Watcher whose cloak has lapsed for a member (it was spotted or is fighting): same;
//   BEACON   - the Beacon and its guard: the members' free fleets gather at the nearest member colony system outside its guns
//              (Patrol), and only when beaconAiGatherPct % of the force beaconAiRatioPct % of the defence needs is there do they all
//              Attack together, never piecemeal.
// And against the harvest (beaconHarvest.ts), first of all:
//   RETAKE   - Smarter AI members value the harvest cores above every other world: each core near one of them is made a war objective of
//              its war with the Reclaimers (the stock war AI then builds and sends invasion fleets), and the nearest available fleet
//              that carries the troops a core needs and can face its defence is sent to invade it at once (the stock invasion path);
//   CORES    - a harvester (and the Reclaimer warships at its core): gather-then-strike as the Beacon's, at beaconAiCoreRatioPct %;
//   CATTLE   - a cattle ship on a run (outbound, loading or laden; not one waiting at its core) a member can see, within beaconAiCattleReachSectors of a free unit that can catch it before it docks: that unit
//              Attacks it (its captives die; the coalition starves the Reclaimers knowingly), at most beaconAiCattleMax a pass.
// No member gives more than beaconAiSharePct % of its military to the coalition at once (the rest keep their home). Units that are
// repairing, refitting, refuelling, invading or escorting are never called. Rnd: none (the stock mission assignments draw as usual).

import type { Galaxy } from '../../../galaxy';
import type { Empire } from '../../../empire';
import type { BuiltObject } from '../../../builtObject';
import type { Habitat } from '../../../types';
import { BuiltObjectRole } from '../../../data/designSpecifications';
import { BuiltObjectSubRole } from '../../../builtObjectTypes';
import { galaxyStarDate } from '../../../tick/simTime';
import { FleetPosture } from '../../../diplomacyTick';
import { calculateOverallStrengthFactor } from '../../../combat/threats';
import { DiplomaticRelationType } from '../../../diplomacy';
import { assignMission } from '../../../missions/assign';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, builtObjectMission } from '../../../missions/mission';
import { empireShipGroups, shipGroupAssignMission, type ShipGroup } from '../../../fleets/shipGroup';
import { forceCompleteMission, shipGroupCheckFleetTargetWithinFuelRangeAndRefuel } from '../../../fleets/shipGroupTasks';
import { clearPreviousMissionRequirements } from '../../../missions/assign';
import { isHumanEmpire } from '../../../humanEmpires';
import { GAME_DAY_LENGTH, registerScenarioPeriodic } from '../../hooks';
import { scenarioText as T } from '../../messages';
import { KNOWLEDGE_CONFIRMED, arcNews, knowledgeLevel, normalEmpires, revealTo } from '../framework';
import { BEACON_FLAG, P, SYSTEM_RADIUS, aliveShips, cloakLapsedFor, peekBeaconState, type BeaconState, type StrikeGroup } from './beaconState';
import { eliminatedPct, travelDays, watcherFleetStrengthOf } from './beaconFleet';
import { cattleOf, inField, liveCores, phaseOf } from './beaconHarvest';
import { isObjectVisibleToThisEmpire } from '../../../independentTraders';
import { WarObjective, obtainDiplomaticRelation } from '../../../diplomacy';
import { calculateDefendingStrength, determineRequiredTroopStrength, findNearestAvailableFleet } from '../../../fleets/militaryAI';
import { shipGroupTotalOverallStrengthFactor } from '../../../fleets/shipGroup';
import { isAiControlled } from '../../../missions/playerOrder';
import { isSmarterAIStrategist } from '../../smarterAI/common';

const TAG = 'Beacon';
const STAGE_RANGE = 250000;
const STAGE_MIN_DIST = 150000;
/** Reclaimer ships this near a target (the Beacon, a staging point) are its guard. */
const GUARD_RADIUS = 90000;
/** A staging fleet is this wide. */
const STAGING_RADIUS = 30000;

type OpRec = NonNullable<BeaconState['ai']>['ops'][string];

type OnOrder = (m: { type: BuiltObjectMissionType; targetBuiltObject?: unknown; targetHabitat?: unknown; x?: number; y?: number } | null) => boolean;

// ---------------------------------------------------------------------------------------------------------------
// Members and units
// ---------------------------------------------------------------------------------------------------------------

function underBargain(st: BeaconState, e: Empire): boolean {
    return st.bargains.some((b) => b.empireId === e.empireId && !b.ended);
}

/** The AI empires that take part: not human, at war with the Reclaimers, not in a bargain with them, with a colony. Pure. */
export function coalitionMembers(galaxy: Galaxy, st: BeaconState): Empire[] {
    const faction = st.faction;
    if (faction === null) return [];
    return normalEmpires(galaxy, faction).filter(
        (e) => !isHumanEmpire(galaxy, e) && e.colonies.length > 0 && !underBargain(st, e) && e.diplomaticRelations.byEmpire(faction)?.type === DiplomaticRelationType.War,
    );
}

/** Missions of a warship that is free to be called away (it is not repairing, refitting, refuelling, invading or escorting). */
function freeMission(type: BuiltObjectMissionType): boolean {
    return (
        type === BuiltObjectMissionType.Undefined ||
        type === BuiltObjectMissionType.Hold ||
        type === BuiltObjectMissionType.Patrol ||
        type === BuiltObjectMissionType.Move ||
        type === BuiltObjectMissionType.MoveAndWait ||
        type === BuiltObjectMissionType.WaitAndAttack ||
        type === BuiltObjectMissionType.Blockade ||
        type === BuiltObjectMissionType.Waypoint
    );
}

interface Unit {
    owner: Empire;
    sg: ShipGroup | null;
    bo: BuiltObject | null;
    /** Overall strength (with shields). */
    f: number;
    lead: BuiltObject;
    /** The slowest warp speed among its ships. */
    speed: number;
    /** On a coalition order already (it is counted first and not given to another operation this pass). */
    committed: boolean;
}

/** Warship classes a member may give as a single ship (escorts and frigates keep guarding what they guard). */
const MAJOR_WARSHIPS: ReadonlySet<BuiltObjectSubRole> = new Set([BuiltObjectSubRole.Destroyer, BuiltObjectSubRole.Cruiser, BuiltObjectSubRole.CapitalShip, BuiltObjectSubRole.Carrier]);

/**
 * Every member's free warship or fleet (one list, owner order then fleet order). The fleets on Defend posture (the guards of the
 * members' colonies) and the lighter single ships stay where they are, or the coalition would strip the worlds the Reclaimers are
 * coming for; once the galaxy is losing (`allHands`) every free warship is called.
 */
function freeUnits(galaxy: Galaxy, members: readonly Empire[], onOrder: OnOrder, allHands: boolean): Unit[] {
    void galaxy;
    const out: Unit[] = [];
    for (const e of members) {
        for (const sg of empireShipGroups(e)) {
            if (sg === null || sg.ships.length === 0 || sg.leadShip === null || sg.leadShip.hasBeenDestroyed) continue;
            const m = sg.mission;
            const committed = onOrder(m);
            if (m !== null && !committed && !freeMission(m.type)) continue;
            if (sg.posture === FleetPosture.Defend && !committed && !allHands) continue;
            let f = 0;
            let speed = Infinity;
            let troops = false;
            for (const b of sg.ships) {
                if (b.hasBeenDestroyed) continue;
                if (b.subRole === BuiltObjectSubRole.TroopTransport) troops = true;
                f += calculateOverallStrengthFactor(b);
                if (b.warpSpeed > 0) speed = Math.min(speed, b.warpSpeed);
            }
            if (troops || !(f > 0) || !Number.isFinite(speed)) continue;
            out.push({ owner: e, sg, bo: null, f, lead: sg.leadShip, speed, committed });
        }
        for (const b of e.builtObjects) {
            if (b.hasBeenDestroyed || b.role !== BuiltObjectRole.Military || b.topSpeed <= 0 || b.warpSpeed <= 0 || b.shipGroup !== null || b.subRole === BuiltObjectSubRole.TroopTransport) continue;
            const m = builtObjectMission(b.mission);
            const committed = onOrder(m);
            if (m !== null && !committed && !freeMission(m.type)) continue;
            if (!committed && !allHands && !MAJOR_WARSHIPS.has(b.subRole)) continue;
            const f = calculateOverallStrengthFactor(b);
            if (!(f > 0)) continue;
            out.push({ owner: e, sg: null, bo: b, f, lead: b, speed: b.warpSpeed, committed });
        }
    }
    return out;
}

function dist(galaxy: Galaxy, a: { xpos: number; ypos: number }, x: number, y: number): number {
    return galaxy.calculateDistance(a.xpos, a.ypos, x, y);
}

function strengthOf(bo: BuiltObject): number {
    return Math.max(0, calculateOverallStrengthFactor(bo));
}

// ---------------------------------------------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------------------------------------------

type Target = { kind: 'ship'; ship: BuiltObject } | { kind: 'patrol'; where: Habitat } | { kind: 'move'; x: number; y: number };

function order(p: Pass, u: Unit, t: Target): boolean {
    const galaxy = p.galaxy;
    p.ordered.add(u.lead);
    // The coalition's strikes (the Beacon, a staging fleet, a Watcher) are one-way trips into deep space, past every member's last refuelling
    // port: the members' tankers meet the fleets, so every ship of the unit is topped up when the order is given and no range check is made.
    // (Relief fleets sail to a member's own territory and keep the stock fuel check.)
    const tanked = t.kind !== 'patrol';
    if (tanked) {
        const ships = u.sg !== null ? u.sg.ships : [u.bo!];
        for (const b of ships) if (!b.hasBeenDestroyed && b.fuelCapacity > 0 && b.currentFuel < b.fuelCapacity) b.currentFuel = b.fuelCapacity;
    }
    if (t.kind === 'move') {
        const sameSpot = (m: { type: BuiltObjectMissionType; x?: number; y?: number } | null): boolean => m !== null && m.type === BuiltObjectMissionType.Move && Math.abs((m.x ?? 1e12) - t.x) < 2 && Math.abs((m.y ?? 1e12) - t.y) < 2;
        if (u.sg !== null) {
            if (sameSpot(u.sg.mission)) return true;
            return shipGroupAssignMission(galaxy, u.sg, BuiltObjectMissionType.Move, null, null, BuiltObjectMissionPriority.High, true, { x: t.x, y: t.y });
        }
        if (sameSpot(builtObjectMission(u.bo!.mission))) return true;
        assignMission(galaxy, u.bo!, BuiltObjectMissionType.Move, null, null, BuiltObjectMissionPriority.High, { x: t.x, y: t.y, manuallyAssigned: true });
        return true;
    }
    if (u.sg !== null) {
        const m = u.sg.mission;
        if (t.kind === 'ship') {
            if (m !== null && m.type === BuiltObjectMissionType.Attack && m.targetBuiltObject === t.ship) return true;
            return shipGroupAssignMission(galaxy, u.sg, BuiltObjectMissionType.Attack, t.ship, null, BuiltObjectMissionPriority.High, true);
        }
        if (m !== null && m.type === BuiltObjectMissionType.Patrol && m.targetHabitat === t.where) return true;
        if (!shipGroupCheckFleetTargetWithinFuelRangeAndRefuel(galaxy, u.sg, t.where.xpos, t.where.ypos, 0.1)) return false;
        return shipGroupAssignMission(galaxy, u.sg, BuiltObjectMissionType.Patrol, t.where, null, BuiltObjectMissionPriority.High, true);
    }
    const b = u.bo!;
    const m = builtObjectMission(b.mission);
    if (t.kind === 'ship') {
        if (m !== null && m.type === BuiltObjectMissionType.Attack && m.targetBuiltObject === t.ship) return true;
        assignMission(galaxy, b, BuiltObjectMissionType.Attack, t.ship, null, BuiltObjectMissionPriority.High, { manuallyAssigned: true });
        return true;
    }
    if (m !== null && m.type === BuiltObjectMissionType.Patrol && m.targetHabitat === t.where) return true;
    assignMission(galaxy, b, BuiltObjectMissionType.Patrol, t.where, null, BuiltObjectMissionPriority.High, { manuallyAssigned: true });
    return true;
}

// ---------------------------------------------------------------------------------------------------------------
// The allocator
// ---------------------------------------------------------------------------------------------------------------

interface Pass {
    galaxy: Galaxy;
    st: BeaconState;
    members: Empire[];
    units: Unit[];
    /** Units already given to an operation this pass. */
    used: Set<Unit>;
    /** Per member: strength committed this pass, and its cap (beaconAiSharePct % of its military). */
    committed: Map<Empire, number>;
    cap: Map<Empire, number>;
    /** The lead ships of the units ordered this pass (the rest of last pass's are released). */
    ordered: Set<BuiltObject>;
    /** How desperate the galaxy is, 0 (no one lost yet) to 1 (beaconAiUrgencyPct % of the people gone): the force asked for shrinks by up to 30 % and the members give more. */
    urg: number;
}

/**
 * The units for an operation at (x, y) needing `need` strength: those already on a coalition order first, then the nearest that
 * can arrive within `maxDays` (null: no limit) and are within `reach`; each member within its cap. Returns the chosen units and
 * their sum, or null when the sum falls short of `minFrac` x `need`.
 */
function pick(p: Pass, x: number, y: number, need: number, reach: number, maxDays: number | null, minFrac = 1): { units: Unit[]; sum: number } | null {
    const cands = p.units
        .filter((u) => !p.used.has(u))
        .map((u) => ({ u, d: dist(p.galaxy, u.lead, x, y) }))
        .filter((c) => c.d <= reach && (maxDays === null || travelDays(c.u.speed, c.d) <= maxDays))
        .sort((a, b) => Number(b.u.committed) - Number(a.u.committed) || a.d - b.d);
    const chosen: Unit[] = [];
    const spent = new Map<Empire, number>();
    let sum = 0;
    for (const c of cands) {
        const cap = p.cap.get(c.u.owner) ?? Infinity;
        const have = (p.committed.get(c.u.owner) ?? 0) + (spent.get(c.u.owner) ?? 0);
        if (!c.u.committed && have + c.u.f > cap) continue;
        chosen.push(c.u);
        spent.set(c.u.owner, (spent.get(c.u.owner) ?? 0) + c.u.f);
        sum += c.u.f;
        if (sum >= need) break;
    }
    if (sum < need * minFrac) return null;
    return { units: chosen, sum };
}

function take(p: Pass, us: readonly Unit[]): void {
    for (const u of us) {
        p.used.add(u);
        p.committed.set(u.owner, (p.committed.get(u.owner) ?? 0) + u.f);
    }
}

function starOf(galaxy: Galaxy, h: Habitat): Habitat {
    return galaxy.determineHabitatSystemStar(h) ?? h;
}

// ---------------------------------------------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------------------------------------------

/** The coalition's pooled knowledge: a member that knows a staging point tells the rest (a human is never told this way). */
function poolKnowledge(galaxy: Galaxy, st: BeaconState, members: readonly Empire[]): void {
    const season = st.season;
    if (season === null || season.phase !== 'prep') return;
    for (const sp of season.staging) {
        if (!members.some((e) => knowledgeLevel(sp, e) >= KNOWLEDGE_CONFIRMED)) continue;
        for (const e of members) revealTo(galaxy, sp, e, KNOWLEDGE_CONFIRMED);
    }
}

function groupsInFlight(st: BeaconState): StrikeGroup[] {
    const out: StrikeGroup[] = [];
    for (const s of st.seasons) for (const g of s.groups) if (g.target !== null && (g.state === 'travel' || g.state === 'siege') && g.ships.some((b) => !b.hasBeenDestroyed)) out.push(g);
    return out;
}

function relief(p: Pass): number {
    const { galaxy, st } = p;
    let sent = 0;
    const ratio = P.aiReliefPct(galaxy) / 100;
    for (const g of groupsInFlight(st)) {
        const t = g.target!;
        const owner = t.empire;
        if (owner === null || owner === galaxy.independentEmpire || owner === st.faction) continue;
        let enemy = 0;
        for (const b of aliveShips(g.ships, st.faction)) enemy += strengthOf(b);
        if (!(enemy > 0)) continue;
        // the owner's own defenders already there count on the coalition's side
        let own = 0;
        for (const b of owner.builtObjects) if (!b.hasBeenDestroyed && b.role === BuiltObjectRole.Military && b.topSpeed > 0 && dist(galaxy, b, t.xpos, t.ypos) <= 30000) own += strengthOf(b);
        const need = Math.max(0, enemy * ratio * (1 - 0.3 * p.urg) - own);
        const star = starOf(galaxy, t);
        // the group is expected within about a month of its lead's arrival: only forces that arrive by then count
        const lead = g.lead ?? g.ships.find((b) => !b.hasBeenDestroyed)!;
        const eta = Math.max(20, travelDays(Math.max(1, lead.warpSpeed), dist(galaxy, lead, t.xpos, t.ypos)) + 30);
        if (need <= 0) continue;
        const got = pick(p, t.xpos, t.ypos, need, P.aiReachSectors(galaxy) * galaxy.sectorSize, eta);
        if (got === null) continue;
        let ok = 0;
        for (const u of got.units) if (order(p, u, { kind: 'patrol', where: star })) ok++;
        take(p, got.units);
        if (ok > 0) {
            sent++;
            st.stats.aiRelief = (st.stats.aiRelief ?? 0) + 1;
        }
    }
    return sent;
}

function opState(st: BeaconState, key: string): OpRec {
    const ai = (st.ai ??= { launches: 0, ops: {} });
    ai.ops ??= {};
    return (ai.ops[key] ??= { go: false, rally: -1 });
}

/** Where a force waits before it strikes `target`: STANDOFF short of it, on the side its units come from. */
const STANDOFF = 300000;
function waypointFor(galaxy: Galaxy, units: readonly Unit[], target: { xpos: number; ypos: number }): { x: number; y: number } {
    let cx = 0;
    let cy = 0;
    for (const u of units) {
        cx += u.lead.xpos;
        cy += u.lead.ypos;
    }
    cx /= Math.max(1, units.length);
    cy /= Math.max(1, units.length);
    let dx = cx - target.xpos;
    let dy = cy - target.ypos;
    const len = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    dx /= len;
    dy /= len;
    return { x: Math.min(galaxy.sizeX - 1000, Math.max(1000, target.xpos + dx * STANDOFF)), y: Math.min(galaxy.sizeY - 1000, Math.max(1000, target.ypos + dy * STANDOFF)) };
}

/**
 * A gather-then-strike operation: the chosen units Move to a waypoint short of the target (the same one every pass); once
 * `gatherPct` % of the force (half of it once the strike is on) is within STAGE_RANGE of it, every unit Attacks `target` together,
 * never piecemeal. Returns true when the strike is on.
 */
function gatherAndStrike(p: Pass, key: string, units: readonly Unit[], need: number, target: BuiltObject, gatherPct: number): boolean {
    const { galaxy } = p;
    const op = opState(p.st, key);
    if (op.wx === undefined || op.wy === undefined) {
        const w = waypointFor(galaxy, units, target);
        op.wx = w.x;
        op.wy = w.y;
        op.since = galaxyStarDate(galaxy);
    }
    let there = 0;
    for (const u of units) if (dist(galaxy, u.lead, op.wx, op.wy) <= STAGE_RANGE || dist(galaxy, u.lead, target.xpos, target.ypos) <= STAGE_RANGE) there += u.f;
    op.there = Math.round(there);
    op.need = Math.round(need);
    const go = op.go ? there >= need * 0.5 : there >= need * (gatherPct / 100);
    take(p, units);
    if (!go) {
        op.go = false;
        for (const u of units) order(p, u, { kind: 'move', x: op.wx, y: op.wy });
        return false;
    }
    let ok = 0;
    for (const u of units) if (order(p, u, { kind: 'ship', ship: target })) ok++;
    op.go = ok > 0;
    return ok > 0;
}

function staging(p: Pass): number {
    const { galaxy, st } = p;
    const season = st.season;
    if (season === null || season.phase !== 'prep') return 0;
    const now = galaxyStarDate(galaxy);
    let sent = 0;
    for (const sp of season.staging) {
        if (!p.members.some((e) => knowledgeLevel(sp, e) >= KNOWLEDGE_CONFIRMED)) continue;
        // the lead ship: the strongest warship gathered there
        let lead: BuiltObject | null = null;
        let enemy = 0;
        for (const b of st.faction!.builtObjects) {
            if (b.hasBeenDestroyed || b.role !== BuiltObjectRole.Military || b.subRole === BuiltObjectSubRole.TroopTransport || dist(galaxy, b, sp.x, sp.y) > STAGING_RADIUS) continue;
            const f = strengthOf(b);
            enemy += f;
            if (lead === null || f > strengthOf(lead)) lead = b;
        }
        if (lead === null || !(enemy > 0)) continue;
        const key = `staging:${season.n}:${sp.index}`;
        // what can arrive before the departure (plus the grace the departure may wait)
        const daysLeft = Math.max(5, (season.end + 60 * GAME_DAY_LENGTH - now) / GAME_DAY_LENGTH);
        const need = (enemy * P.aiStagingRatioPct(galaxy) * (1 - 0.3 * p.urg)) / 100;
        // only fleets that can gather at the rally and still strike before the departure (a staging fleet is near some colonies, not the whole galaxy)
        const op = opState(st, key);
        const active = op.wx !== undefined;
        if (!active && op.cooldown !== undefined && now < op.cooldown) continue;
        const got = pick(p, sp.x, sp.y, need, Math.min(P.aiReachSectors(galaxy), P.aiStagingReachSectors(galaxy)) * galaxy.sectorSize, daysLeft, active ? 0.4 : 1);
        if (got === null) {
            abort(op, now, false);
            continue;
        }
        const was = opState(st, key).go;
        if (gatherAndStrike(p, key, got.units, need, lead, P.aiStagingGatherPct(galaxy))) {
            sent++;
            if (!was) {
                st.stats.aiStrikes = (st.stats.aiStrikes ?? 0) + 1;
                arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Coalition Staging', onceKey: `CoalitionStaging${season.n}:${sp.index}`, textTag: `${TAG} Coalition Staging News`, args: [sp.name] });
            }
        }
    }
    return sent;
}

function watchers(p: Pass): number {
    const { galaxy, st } = p;
    const now = galaxyStarDate(galaxy);
    let sent = 0;
    for (const w of st.watchers) {
        const ship = w.ship;
        if (w.dead || ship === null || ship.hasBeenDestroyed) continue;
        // the coalition shares sightings: it can act if the cloak has lapsed for ANY member
        if (!p.members.some((e) => cloakLapsedFor(ship, e, now))) continue;
        // a Watcher leading a fleet (from the Reclamation on) comes with its escorts: the coalition sizes up the whole fleet
        const enemy = Math.max(strengthOf(ship), watcherFleetStrengthOf(st, ship) ?? 0);
        const got = pick(p, ship.xpos, ship.ypos, (enemy * P.aiWatcherRatioPct(galaxy) * (1 - 0.3 * p.urg)) / 100, P.aiReachSectors(galaxy) * galaxy.sectorSize, 40);
        if (got === null) continue;
        let ok = 0;
        for (const u of got.units) if (order(p, u, { kind: 'ship', ship })) ok++;
        take(p, got.units);
        if (ok > 0) {
            sent++;
            st.stats.aiStrikes = (st.stats.aiStrikes ?? 0) + 1;
        }
    }
    return sent;
}

/** An operation that has been gathering for this long without going in gives up and rests (the force goes home; the target outgrew it). */
const PATIENCE_DAYS = 900;
const COOLDOWN_DAYS = 300;

function abort(op: OpRec, now: number, cool: boolean): void {
    op.go = false;
    delete op.wx;
    delete op.wy;
    delete op.since;
    if (cool) op.cooldown = now + COOLDOWN_DAYS * GAME_DAY_LENGTH;
}

function beaconOp(p: Pass): number {
    const { galaxy, st } = p;
    const beacon = st.beacon;
    const op = opState(st, 'beacon');
    const now = galaxyStarDate(galaxy);
    if (beacon === null || beacon.hasBeenDestroyed || st.beaconDestroyed) {
        abort(op, now, false);
        return 0;
    }
    const active = op.wx !== undefined;
    if (!active && op.cooldown !== undefined && now < op.cooldown) return 0;
    // What stands at the Beacon: the Beacon and its guard (the waves that spawn there fly off to their staging points within days; chasing them would put the goal out of reach)
    let enemy = strengthOf(beacon);
    for (const b of st.guards) if (!b.hasBeenDestroyed && dist(galaxy, b, beacon.xpos, beacon.ypos) <= 2 * GUARD_RADIUS) enemy += strengthOf(b);
    const need = (enemy * P.aiRatioPct(galaxy) * (1 - 0.3 * p.urg)) / 100;
    // an operation under way keeps the force it has while at least 40 % of what the target now needs can be had; it starts only with all of it
    const got = pick(p, beacon.xpos, beacon.ypos, need, P.aiReachSectors(galaxy) * galaxy.sectorSize, null, active ? 0.4 : 1);
    const ai0 = (st.ai ??= { launches: 0, ops: {} });
    let free = 0;
    for (const u of p.units) if (!p.used.has(u)) free += u.f;
    ai0.last = { members: p.members.length, units: p.units.length, free: Math.round(free), need: Math.round(need), sum: got === null ? 0 : Math.round(got.sum) };
    if (got === null) {
        abort(op, now, active);
        return 0;
    }
    if (active && !op.go && op.since !== undefined && now - op.since > PATIENCE_DAYS * GAME_DAY_LENGTH) {
        abort(op, now, true);
        return 0;
    }
    const was = op.go;
    if (!gatherAndStrike(p, 'beacon', got.units, need, beacon, P.aiGatherPct(galaxy))) return 0;
    if (!was) {
        const ai = st.ai!;
        ai.launches++;
        st.stats.aiStrikes = (st.stats.aiStrikes ?? 0) + 1;
        arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Coalition Beacon', onceKey: `CoalitionBeacon${ai.launches}`, textTag: `${TAG} Coalition Beacon News`, args: [ai.launches] });
    }
    return 1;
}

/** Reclaimer warships within `r` of (x, y), their strength. */
function factionStrengthNear(p: Pass, x: number, y: number, r: number): number {
    let s = 0;
    for (const b of p.st.faction!.builtObjects) if (!b.hasBeenDestroyed && b.role === BuiltObjectRole.Military && b.topSpeed > 0 && dist(p.galaxy, b, x, y) <= r) s += strengthOf(b);
    return s;
}

/** CORES: a harvester and the warships at its core, struck as the Beacon is (gather, then all at once). Returns the strikes on. */
function cores(p: Pass): number {
    const { galaxy, st } = p;
    const now = galaxyStarDate(galaxy);
    let sent = 0;
    const live = new Set<string>();
    for (const c of liveCores(st)) {
        const hv = c.harvester;
        if (hv === null || hv.hasBeenDestroyed) continue;
        const key = `core:${c.colony.habitatIndex}`;
        live.add(key);
        const op = opState(st, key);
        const active = op.wx !== undefined;
        if (!active && op.cooldown !== undefined && now < op.cooldown) continue;
        const enemy = strengthOf(hv) + factionStrengthNear(p, hv.xpos, hv.ypos, GUARD_RADIUS);
        const need = (enemy * P.aiCoreRatioPct(galaxy) * (1 - 0.3 * p.urg)) / 100;
        const got = pick(p, hv.xpos, hv.ypos, need, P.aiReachSectors(galaxy) * galaxy.sectorSize, null, active ? 0.4 : 1);
        if (got === null) {
            abort(op, now, active);
            continue;
        }
        if (active && !op.go && op.since !== undefined && now - op.since > PATIENCE_DAYS * GAME_DAY_LENGTH) {
            abort(op, now, true);
            continue;
        }
        const was = op.go;
        if (gatherAndStrike(p, key, got.units, need, hv, P.aiStagingGatherPct(galaxy))) {
            sent++;
            if (!was) {
                st.stats.aiCore = (st.stats.aiCore ?? 0) + 1;
                st.stats.aiStrikes = (st.stats.aiStrikes ?? 0) + 1;
                arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Coalition Core', onceKey: `CoalitionCore:${c.colony.habitatIndex}:${st.stats.aiCore}`, textTag: `${TAG} Coalition Core News`, args: [c.colony.name] });
            }
        }
    }
    // operations against cores that are gone
    for (const k of Object.keys(st.ai?.ops ?? {})) if (k.startsWith('core:') && !live.has(k)) delete st.ai!.ops[k];
    return sent;
}

/** CATTLE: free units near a cattle ship a member can see, that can catch it before it docks, are sent at it (one per ship). */
function cattle(p: Pass): number {
    const { galaxy, st } = p;
    if (P.aiCattleOn(galaxy) <= 0) return 0;
    const max = P.aiCattleMax(galaxy);
    const reach = P.aiCattleReachSectors(galaxy) * galaxy.sectorSize;
    let sent = 0;
    for (const c of cattleOf(st)) {
        if (sent >= max) break;
        const ship = c.ship;
        // the pool ships at their core (idle, mending, on their way home) are under the harvester's guns: only the ships on a run are chased
        if (!inField(c) || ship.hasBeenDestroyed || !p.members.some((e) => isObjectVisibleToThisEmpire(galaxy, e, ship))) continue;
        // already chased: the unit on it stays on it
        const left = travelDays(Math.max(1, ship.warpSpeed), dist(galaxy, ship, (phaseOf(c) === 'in' ? c.core : c.from).xpos, (phaseOf(c) === 'in' ? c.core : c.from).ypos)) + 5;
        const got = pick(p, ship.xpos, ship.ypos, strengthOf(ship) * 1.5, reach, left);
        if (got === null) continue;
        let ok = 0;
        let fresh = false;
        for (const u of got.units) {
            if (!u.committed) fresh = true;
            if (order(p, u, { kind: 'ship', ship })) ok++;
        }
        take(p, got.units);
        if (ok > 0) {
            sent++;
            if (fresh) st.stats.aiCattle = (st.stats.aiCattle ?? 0) + 1;
        }
    }
    return sent;
}

/**
 * RETAKE (Smarter AI members only): every core within reach of a member is a war objective of its war with the Reclaimers, and the nearest
 * available invasion fleet of the member that carries the troops and the strength the core needs is sent to invade it (one per core a pass).
 */
function retake(p: Pass): number {
    const { galaxy, st } = p;
    if (P.aiRetakeOn(galaxy) <= 0) return 0;
    const faction = st.faction!;
    const reach = P.aiReachSectors(galaxy) * galaxy.sectorSize;
    let sent = 0;
    const cs = liveCores(st).map((c) => c.colony);
    if (cs.length === 0) return 0;
    for (const e of p.members) {
        if (!isSmarterAIStrategist(galaxy, e)) continue;
        const near = cs.filter((h) => e.colonies.some((c) => galaxy.calculateDistance(c.xpos, c.ypos, h.xpos, h.ypos) <= reach));
        if (near.length === 0) continue;
        const rel = obtainDiplomaticRelation(e, faction);
        if (rel.warObjective !== WarObjective.TotalConquest) {
            rel.warObjective = WarObjective.CaptureObjectives;
            for (const h of near) if (!rel.warObjectiveColonies.includes(h)) rel.warObjectiveColonies.push(h);
        }
        for (const h of near) {
            // already on its way
            if (empireShipGroups(e).some((sg) => sg !== null && sg.mission !== null && sg.mission.type === BuiltObjectMissionType.Attack && sg.mission.targetHabitat === h)) continue;
            const required = determineRequiredTroopStrength(galaxy, e, h);
            const fleet = findNearestAvailableFleet(galaxy, e, h.xpos, h.ypos, BuiltObjectMissionPriority.Low, 0, FleetPosture.Attack, true, 0.1, false, false, false, false, Math.trunc(required * 1.2));
            if (fleet === null || fleet.leadShip === null || !isAiControlled(fleet.leadShip)) continue;
            const defence = Math.max(1, calculateDefendingStrength(galaxy, e, h).strength);
            if (shipGroupTotalOverallStrengthFactor(galaxy, fleet) / defence < 0.85) continue;
            if (!shipGroupAssignMission(galaxy, fleet, BuiltObjectMissionType.Attack, h, null, BuiltObjectMissionPriority.High, false)) continue;
            sent++;
            st.stats.aiRetake = (st.stats.aiRetake ?? 0) + 1;
        }
    }
    return sent;
}

/** The coalition's pass (every beaconAiPeriodDays). Returns the operations ordered. */
export function coalitionPass(galaxy: Galaxy): number {
    const st = peekBeaconState(galaxy);
    if (st === null || st.phase !== 'reclamation' || st.ended || st.faction === null || !st.faction.active || P.aiOn(galaxy) <= 0) return 0;
    const members = coalitionMembers(galaxy, st);
    if (members.length === 0) return 0;
    poolKnowledge(galaxy, st, members);
    if (st.ai !== undefined && st.season !== null) {
        // operations of earlier seasons are over
        for (const k of Object.keys(st.ai.ops ?? {})) {
            const m = /^staging:(\d+):/.exec(k);
            if (m !== null && Number(m[1]) < st.season.n) delete st.ai.ops[k];
        }
    }
    const urg = P.aiUrgencyPct(galaxy) > 0 ? Math.min(1, eliminatedPct(st) / P.aiUrgencyPct(galaxy)) : 0;
    const share = Math.min(1, (P.aiSharePct(galaxy) / 100) * (1 + urg));
    const cap = new Map<Empire, number>();
    for (const e of members) {
        let total = 0;
        for (const b of e.builtObjects) if (!b.hasBeenDestroyed && b.role === BuiltObjectRole.Military && b.topSpeed > 0) total += calculateOverallStrengthFactor(b);
        cap.set(e, total * share);
    }
    const beacon = st.beacon;
    const stageTargets = st.season !== null && st.season.phase === 'prep' ? st.season.staging : [];
    // Units already on a coalition order (their mission targets one of the operations' objects) are counted first and kept.
    const watcherShips = new Set<BuiltObject>(st.watchers.map((w) => w.ship).filter((b): b is BuiltObject => b !== null));
    const leads = new Set<BuiltObject>();
    for (const b of st.faction.builtObjects) if (!b.hasBeenDestroyed && stageTargets.some((sp) => dist(galaxy, b, sp.x, sp.y) <= STAGING_RADIUS)) leads.add(b);
    const targets = new Set<unknown>([...watcherShips, ...leads]);
    for (const c of liveCores(st)) if (c.harvester !== null) targets.add(c.harvester);
    for (const c of cattleOf(st)) targets.add(c.ship);
    if (beacon !== null) targets.add(beacon);
    for (const g of groupsInFlight(st)) if (g.target !== null) targets.add(starOf(galaxy, g.target));
    for (const op of Object.values(st.ai?.ops ?? {})) {
        const star = op.rally >= 0 ? galaxy.systems[op.rally]?.systemStar ?? null : null;
        if (star !== null) targets.add(star);
    }
    const waypoints = Object.values(st.ai?.ops ?? {}).filter((o) => o.wx !== undefined && o.wy !== undefined);
    const onOrder = (m: { type: BuiltObjectMissionType; targetBuiltObject?: unknown; targetHabitat?: unknown; x?: number; y?: number } | null): boolean =>
        m !== null &&
        ((m.type === BuiltObjectMissionType.Attack && targets.has(m.targetBuiltObject)) ||
            (m.type === BuiltObjectMissionType.Patrol && targets.has(m.targetHabitat)) ||
            (m.type === BuiltObjectMissionType.Move && waypoints.some((o) => Math.abs((m.x ?? 1e12) - o.wx!) < 2 && Math.abs((m.y ?? 1e12) - o.wy!) < 2)));
    const p: Pass = { galaxy, st, members, units: freeUnits(galaxy, members, onOrder, urg >= 0.5), used: new Set(), committed: new Map(), cap, ordered: new Set(), urg };
    let n = 0;
    n += retake(p);
    if (p.units.length > 0) {
        n += cores(p);
        n += beaconOp(p);
        n += staging(p);
        n += relief(p);
        n += cattle(p);
        n += watchers(p);
    }
    releaseIdle(galaxy, st, p, onOrder);
    return n;
}

/**
 * The units ordered last pass and not this one are free again: an operation that ended (or was given up) must not leave a member's
 * fleets parked on the coalition's High-priority Patrol for good, out of the stock AI's reach. Only a mission still the coalition's own
 * (one the pass would recognise) is cleared; one the stock AI has since replaced is left alone.
 */
function releaseIdle(galaxy: Galaxy, st: BeaconState, p: Pass, onOrder: OnOrder): void {
    const ai = (st.ai ??= { launches: 0, ops: {} });
    for (const lead of ai.held ?? []) {
        if (p.ordered.has(lead) || lead.hasBeenDestroyed) continue;
        const sg = lead.shipGroup as ShipGroup | null;
        if (sg !== null && sg !== undefined) {
            if (onOrder(sg.mission)) forceCompleteMission(galaxy, sg);
        } else {
            const m = builtObjectMission(lead.mission);
            if (m !== null && onOrder(m)) {
                clearPreviousMissionRequirements(galaxy, lead);
                m.clear();
            }
        }
    }
    ai.held = [...p.ordered].filter((b) => !b.hasBeenDestroyed);
}

export function registerBeaconAi(): void {
    registerScenarioPeriodic({ id: 'beacon.ai', flag: BEACON_FLAG, order: 24, periodDays: 10, run: (g) => void coalitionPass(g) });
}

void SYSTEM_RADIUS;
void T;
