// Characters & Victory: VIP shuttles, escorts and decoys (docs/CHARACTERS_AND_VICTORY.md §4). Not a port; every stock
// call it makes is ported code: the ship spawn is Empire.7.cs 1280 GenerateNewBuiltObject (empireEvents.ts), the
// flight a Move mission (BuiltObject.2.cs 7620 AssignMission), the escort the stock Escort mission with the
// Empire.5.cs 1370 AssignMissionToBuiltObject gates (WithinFuelRangeAndRefuel, CheckMilitaryShipWelcomeAtTerritoryLocation),
// the arrival Character.cs 4305 CompleteLocationTransfer, and a passenger's death the stock ShipDestroyed / ShipCaptured
// paths (combat/teardown.ts, combat/boarding.ts) — the VIP is aboard the shuttle.
//
// Rnd: galaxy.rnd is drawn only inside the gated handlers (the spawn's name / heading / parking point as
// GenerateNewBuiltObject draws, the shuttle design's naming, the decoy shuffle). Queries never draw.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Habitat } from '../../types';
import { BuiltObject } from '../../builtObject';
import { BuiltObjectSubRole } from '../../builtObjectTypes';
import { BuiltObjectRole } from '../../data/designSpecifications';
import { type Character, CharacterRole, isBuiltObjectLocation } from '../../characters';
import { CharacterDeathType, characterSendDeathMessage } from '../../characterRuntime';
import { generateNewBuiltObject } from '../../empireEvents';
import { assignMission, clearPreviousMissionRequirements } from '../../missions/assign';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, builtObjectMission } from '../../missions/mission';
import { builtObjectCompleteTeardown } from '../../combat/teardown';
import { leaveShipGroup, type ShipGroup } from '../../fleets/shipGroup';
import { shipGroupAddShipToFleet } from '../../fleets/shipGroupTasks';
import { checkMilitaryShipWelcomeAtTerritoryLocation } from '../../civilianAI';
import { withinFuelRangeAndRefuel } from '../../movement';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../../diplomacy';
import { EmpireMessageType } from '../../messages';
import { IntelligenceMissionOutcome, IntelligenceMissionType } from '../../espionage';
import { strategicValue } from '../../territory';
import { galaxyStarDate } from '../../tick/simTime';
import { isHumanEmpire } from '../../humanEmpires';
import { registerScenarioEvent, registerScenarioQuery, scenarioEmit } from '../hooks';
import { scenarioMessage, scenarioText } from '../messages';
import { applyReputation } from '../reputation/ledger';
import {
    CV_DECOY_FLAG,
    CV_ESCORT_FLAG,
    CV_FLAG,
    CV_VIP_FLAG,
    DAY,
    type CvState,
    type VipTrip,
    cvEmpire,
    cvOn,
    cvParam,
    cvState,
    isCvEmpire,
    markTripsChanged,
    peekCvState,
    tripOfCharacter,
    tripOfShuttle,
} from './common';
import { ensureVipDesign } from './shuttleDesign';

/** A shuttle has arrived when this close to its destination (world units). */
export const VIP_ARRIVE_RANGE = 3000;
/** Escorts count as joined within this distance of the shuttle. */
const ESCORT_JOIN_RANGE = 40000;
/** Route samples every this many world units (the galaxy index cell). */
const ROUTE_STEP = 400000;
/** Hostile firepower per danger point. */
const DANGER_FIREPOWER = 400;

// ---------------------------------------------------------------------------------------------------------------
// Importance and route danger (pure)
// ---------------------------------------------------------------------------------------------------------------

/** 0..10: how much an empire cares about getting `c` there safely (§4.4). Pure. */
export function characterImportance(galaxy: Galaxy, c: Character): number {
    const skills = Math.max(0, c.getSkillLevelTotal());
    switch (c.role) {
        case CharacterRole.Leader:
            return 10;
        case CharacterRole.ColonyGovernor: {
            const e = c.empire;
            const dest = c.transferDestination ?? c.location;
            let share = 0;
            if (e !== null && dest !== null && !isBuiltObjectLocation(dest)) {
                let top = 1;
                for (const h of e.colonies) top = Math.max(top, strategicValue(h));
                share = Math.min(1, strategicValue(dest as Habitat) / top);
            }
            return Math.min(10, 2 + 6 * share);
        }
        case CharacterRole.FleetAdmiral:
            return Math.min(10, 3 + skills / 40);
        case CharacterRole.Scientist:
        case CharacterRole.TroopGeneral:
            return Math.min(10, 2 + skills / 40);
        case CharacterRole.Ambassador:
            return 2;
        default:
            return 1;
    }
}

function hostileTo(empire: Empire, other: Empire | null, galaxy: Galaxy): boolean {
    if (other === null || other === empire || other === galaxy.independentEmpire) return false;
    if (other.pirateEmpireBaseHabitat !== null) return true;
    return obtainDiplomaticRelation(empire, other).type === DiplomaticRelationType.War;
}

/** 0..3: hostile armed ships near the straight route, plus 0.25 outside our territory (§4.4). Pure. */
export function routeDanger(galaxy: Galaxy, empire: Empire, fromX: number, fromY: number, toX: number, toY: number): number {
    const dist = galaxy.calculateDistance(fromX, fromY, toX, toY);
    const n = Math.max(1, Math.ceil(dist / ROUTE_STEP));
    const seen = new Set<string>();
    let firepower = 0;
    let outside = false;
    for (let i = 0; i <= n; i++) {
        const x = fromX + ((toX - fromX) * i) / n;
        const y = fromY + ((toY - fromY) * i) / n;
        if (!outside && galaxy.checkEmpireTerritoryIdAtLocation(x, y) !== empire.empireId) outside = true;
        const ix = galaxy.resolveIndex(x, y);
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                const cx = ix.x + dx;
                const cy = ix.y + dy;
                if (cx < 0 || cy < 0 || cx >= galaxy.indexMaxX || cy >= galaxy.indexMaxY) continue;
                const key = `${cx},${cy}`;
                if (seen.has(key)) continue;
                seen.add(key);
                const cell = galaxy.builtObjectIndexGrid[cx]?.[cy];
                if (cell === undefined) continue;
                for (const b of cell) {
                    if (b === null || b.hasBeenDestroyed || b.firepowerRaw <= 0) continue;
                    if (hostileTo(empire, b.actualEmpire, galaxy)) firepower += b.firepowerRaw;
                }
            }
        }
    }
    return Math.min(3, firepower / DANGER_FIREPOWER + (outside ? 0.25 : 0));
}

// ---------------------------------------------------------------------------------------------------------------
// Trips
// ---------------------------------------------------------------------------------------------------------------

let ownAssign = false;

/** assignMission for the add-on's own orders (the shuttle refuses every other one). */
function vipAssign(galaxy: Galaxy, bo: BuiltObject, type: BuiltObjectMissionType, target: BuiltObject | Habitat | null): void {
    ownAssign = true;
    try {
        assignMission(galaxy, bo, type, target, null, BuiltObjectMissionPriority.High);
    } finally {
        ownAssign = false;
    }
}

/** The stock transfer timer in star-date ms (Character.cs 4425: 30 s + distance / SectorSize × 90 s). */
function stockTransferMs(galaxy: Galaxy, fromX: number, fromY: number, to: { xpos: number; ypos: number }): number {
    const d = galaxy.calculateDistance(fromX, fromY, to.xpos, to.ypos);
    return (30 + (d / galaxy.sectorSize) * 90) * 1000;
}

/** Spawns a shuttle of `empire`'s VIP design at (x, y). Draws Rnd (GenerateNewBuiltObject). */
function spawnShuttle(galaxy: Galaxy, empire: Empire, x: number, y: number, tripId: number): BuiltObject | null {
    const design = ensureVipDesign(galaxy, empire);
    if (design === null) return null;
    const p = galaxy.selectRelativeParkingPoint();
    const bo = generateNewBuiltObject(galaxy, empire, design, null, x + p.x, y + p.y);
    const i = empire.privateBuiltObjects.indexOf(bo);
    if (i >= 0) empire.privateBuiltObjects.splice(i, 1);
    if (!empire.builtObjects.includes(bo)) empire.builtObjects.push(bo);
    bo.owner = empire;
    bo.isAutoControlled = false;
    bo.supportCostFactor = 0;
    bo.name = scenarioText('CV Shuttle Name', tripId);
    return bo;
}

/** Despawns a shuttle that arrived (no passenger aboard any more). */
function despawn(galaxy: Galaxy, bo: BuiltObject): void {
    if (bo.hasBeenDestroyed) return;
    builtObjectCompleteTeardown(galaxy, bo);
}

function releaseEscorts(galaxy: Galaxy, t: VipTrip): void {
    for (let i = 0; i < t.escorts.length; i++) {
        const e = t.escorts[i];
        if (e.hasBeenDestroyed) continue;
        const m = builtObjectMission(e.mission);
        if (m === null || m.type !== BuiltObjectMissionType.Escort || m.targetBuiltObject !== t.shuttle) continue;
        clearPreviousMissionRequirements(galaxy, e);
        m.clear();
        // Back to the fleet it came from, if that still exists.
        const fleet = t.escortFleets?.[i] ?? null;
        if (fleet !== null && e.shipGroup === null && e.actualEmpire === t.empire && (t.empire.shipGroups as (ShipGroup | null)[]).includes(fleet)) shipGroupAddShipToFleet(galaxy, fleet, e);
    }
    t.escorts = [];
    t.escortFleets = [];
}

function removeTrip(st: CvState, t: VipTrip): void {
    const i = st.trips.indexOf(t);
    if (i >= 0) st.trips.splice(i, 1);
    markTripsChanged(st);
}

function originOf(c: Character): { xpos: number; ypos: number } | null {
    return c.location;
}

/**
 * Starts (or re-targets) a VIP trip for `c` to `destination` with tag `reason`. Returns the trip, or null when no
 * shuttle could be made (the stock timer then runs). The stock transfer must already be set
 * (Character.transferToNewLocation) — sendVip does that for callers that have not.
 */
export function startVipTrip(galaxy: Galaxy, c: Character, destination: BuiltObject | Habitat, reason = 'transfer'): VipTrip | null {
    const empire = c.empire;
    if (!cvOn(galaxy, CV_VIP_FLAG) || !isCvEmpire(galaxy, empire)) return null;
    const st = cvState(galaxy);
    const now = galaxyStarDate(galaxy);
    const existing = tripOfCharacter(galaxy, c);
    if (existing !== null) {
        existing.destination = destination;
        existing.reason = reason;
        c.retargetTransfer(destination);
        existing.deadline = Math.max(existing.deadline, now + tripDeadlineMs(galaxy, existing.shuttle.xpos, existing.shuttle.ypos, destination));
        if (existing.waitUntil === 0) vipAssign(galaxy, existing.shuttle, BuiltObjectMissionType.Move, destination);
        return existing;
    }
    const from = originOf(c);
    if (from === null || from === destination) return null;
    const id = st.nextTripId++;
    const shuttle = spawnShuttle(galaxy, empire, from.xpos, from.ypos, id);
    if (shuttle === null) return null;
    c.boardVessel(shuttle);
    const t: VipTrip = {
        id,
        empire,
        character: c,
        shuttle,
        destination,
        reason,
        started: now,
        deadline: now + tripDeadlineMs(galaxy, from.xpos, from.ypos, destination),
        escorts: [],
        escortWanted: 0,
        waitUntil: 0,
        importance: characterImportance(galaxy, c),
        danger: routeDanger(galaxy, empire, from.xpos, from.ypos, destination.xpos, destination.ypos),
        decoyOf: 0,
        revealedTo: [],
    };
    st.trips.push(t);
    markTripsChanged(st);
    st.counters.tripsStarted++;
    cvEmpire(galaxy, empire).stats.trips++;
    if (cvOn(galaxy, CV_ESCORT_FLAG)) assignEscorts(galaxy, t);
    if (t.waitUntil === 0) vipAssign(galaxy, shuttle, BuiltObjectMissionType.Move, destination);
    if (c.role === CharacterRole.Leader && cvOn(galaxy, CV_DECOY_FLAG)) spawnDecoys(galaxy, t, from);
    if (c.role === CharacterRole.Leader && isHumanEmpire(galaxy, empire)) {
        scenarioMessage(galaxy, empire, scenarioText('CV Ruler Trip Title'), scenarioText('CV Ruler Trip', c.name, destination.name), { type: EmpireMessageType.CharacterAppearance, subject: shuttle });
    }
    return t;
}

function tripDeadlineMs(galaxy: Galaxy, fromX: number, fromY: number, to: BuiltObject | Habitat): number {
    return Math.max(120 * DAY, cvParam(galaxy, 'cvTripTimeoutFactor') * stockTransferMs(galaxy, fromX, fromY, to));
}

/** Decoys for a ruler's trip: identical shuttles to the same destination; the real one's place among them is drawn. Draws. */
function spawnDecoys(galaxy: Galaxy, t: VipTrip, from: { xpos: number; ypos: number }): void {
    const n = Math.trunc(cvParam(galaxy, 'cvRulerDecoyCount'));
    if (n <= 0) return;
    const st = cvState(galaxy);
    // The real shuttle took the next id; give the decoys ids around it so the order says nothing (a drawn slot).
    const slot = galaxy.rnd.next(0, n + 1);
    const ids: number[] = [];
    for (let i = 0; i < n + 1; i++) ids.push(t.id + i);
    const realId = ids[slot];
    const decoyIds = ids.filter((x) => x !== realId);
    st.nextTripId = t.id + n + 1;
    t.shuttle.name = scenarioText('CV Shuttle Name', realId);
    for (const did of decoyIds) {
        const bo = spawnShuttle(galaxy, t.empire, from.xpos, from.ypos, did);
        if (bo === null) continue;
        const d: VipTrip = { ...t, id: did, character: null, shuttle: bo, escorts: [], escortFleets: [], escortWanted: 0, decoyOf: t.id, revealedTo: [] };
        st.trips.push(d);
        if (d.waitUntil === 0) vipAssign(galaxy, bo, BuiltObjectMissionType.Move, t.destination);
    }
    markTripsChanged(st);
}

// ---------------------------------------------------------------------------------------------------------------
// Escorts
// ---------------------------------------------------------------------------------------------------------------

/** A fleet with no mission (waiting at its base): idle. */
function fleetIdle(g: ShipGroup): boolean {
    const m = builtObjectMission(g.mission);
    return m === null || m.type === BuiltObjectMissionType.Undefined;
}

/**
 * Idle state warships that may escort: automated, armed, with a hyperdrive; loose ones with no mission or on the
 * stock patrol of a place that is not threatened (the defence floor: a threatened colony keeps its guard), then
 * members (never the lead ship) of a fleet with no mission. Loose ships first.
 */
function idleWarships(galaxy: Galaxy, empire: Empire): BuiltObject[] {
    const loose: BuiltObject[] = [];
    const fleeted: BuiltObject[] = [];
    const threatened = new Map<unknown, boolean>();
    for (const b of empire.builtObjects) {
        if (b === null || b.hasBeenDestroyed || b.role !== BuiltObjectRole.Military || !b.isAutoControlled) continue;
        if (b.subRole === BuiltObjectSubRole.TroopTransport || b.subRole === BuiltObjectSubRole.ResupplyShip) continue;
        if (b.firepowerRaw <= 0 || b.warpSpeed <= 0 || b.builtAt !== null) continue;
        const sg = b.shipGroup as ShipGroup | null;
        if (sg !== null) {
            if (sg.leadShip === b || !fleetIdle(sg) || sg.ships.length < 2) continue;
            fleeted.push(b);
            continue;
        }
        const m = builtObjectMission(b.mission);
        if (m !== null && m.type === BuiltObjectMissionType.Patrol) {
            const at = m.target as { xpos: number; ypos: number } | null;
            if (at === null) continue;
            let th = threatened.get(at);
            if (th === undefined) threatened.set(at, (th = routeDanger(galaxy, empire, at.xpos, at.ypos, at.xpos, at.ypos) >= 0.5));
            if (th) continue;
        } else if (m !== null && m.type !== BuiltObjectMissionType.Undefined) continue;
        loose.push(b);
    }
    return [...loose, ...fleeted];
}

/** Ships of `empire` escorting VIP trips now. */
function escortsInUse(st: CvState, empire: Empire): number {
    let n = 0;
    for (const t of st.trips) if (t.empire === empire) n += t.escorts.length;
    return n;
}

/** Required escort firepower = importance × danger × cvEscortFirepowerPerPoint × the empire's escort level (§4.4). */
export function escortWanted(galaxy: Galaxy, t: VipTrip): number {
    const ce = cvEmpire(galaxy, t.empire);
    const level = isHumanEmpire(galaxy, t.empire) ? (ce.automateEscorts ? ce.escortLevel : 0) : 1;
    return t.importance * t.danger * cvParam(galaxy, 'cvEscortFirepowerPerPoint') * level;
}

/** Assigns escorts to `t` (nearest idle warships first, within the cap and above the defence floor). No Rnd. */
export function assignEscorts(galaxy: Galaxy, t: VipTrip): void {
    const want = escortWanted(galaxy, t);
    t.escortWanted = want;
    const st = cvState(galaxy);
    if (t.danger > 0) st.counters.dangerousTrips = (st.counters.dangerousTrips ?? 0) + 1;
    if (want <= 0) return;
    const idle = idleWarships(galaxy, t.empire);
    const cap = Math.floor((idle.length + escortsInUse(st, t.empire)) * cvParam(galaxy, 'cvEscortCapPct') / 100) - escortsInUse(st, t.empire);
    const floor = Math.max(1, Math.ceil(idle.length * 0.1));
    let room = Math.min(cap, idle.length - floor);
    if (room <= 0) {
        st.counters.escortUnfilled = (st.counters.escortUnfilled ?? 0) + 1;
        if (t.importance >= 6 && t.danger > 0) t.waitUntil = galaxyStarDate(galaxy) + cvParam(galaxy, 'cvEscortWaitDays') * DAY;
        return;
    }
    const sx = t.shuttle.xpos;
    const sy = t.shuttle.ypos;
    idle.sort((a, b) => galaxy.calculateDistance(a.xpos, a.ypos, sx, sy) - galaxy.calculateDistance(b.xpos, b.ypos, sx, sy) || a.builtObjectID - b.builtObjectID);
    let got = 0;
    for (const b of idle) {
        if (got >= want || room <= 0) break;
        if (!withinFuelRangeAndRefuel(galaxy, b, sx, sy, 0.1)) continue;
        if (!checkMilitaryShipWelcomeAtTerritoryLocation(galaxy, t.destination.xpos, t.destination.ypos, t.empire)) break;
        const fleet = b.shipGroup as ShipGroup | null;
        if (fleet !== null) leaveShipGroup(galaxy, b);
        assignMission(galaxy, b, BuiltObjectMissionType.Escort, t.shuttle, null, BuiltObjectMissionPriority.High);
        t.escorts.push(b);
        (t.escortFleets ??= []).push(fleet);
        got += b.firepowerRaw;
        room--;
    }
    if (t.escorts.length === 0) st.counters.escortUnfilled = (st.counters.escortUnfilled ?? 0) + 1;
    if (t.escorts.length > 0) {
        st.counters.escortedTrips++;
        st.counters.escortShips += t.escorts.length;
        const ce = cvEmpire(galaxy, t.empire);
        ce.stats.escorts++;
        ce.stats.escortShips += t.escorts.length;
    }
    // An important trip on a dangerous route waits for its escort to join (or for more to free up).
    if (t.importance >= 6 && t.danger > 0) t.waitUntil = galaxyStarDate(galaxy) + cvParam(galaxy, 'cvEscortWaitDays') * DAY;
}

function escortsJoined(galaxy: Galaxy, t: VipTrip): boolean {
    for (const e of t.escorts) {
        if (e.hasBeenDestroyed) continue;
        if (galaxy.calculateDistance(e.xpos, e.ypos, t.shuttle.xpos, t.shuttle.ypos) > ESCORT_JOIN_RANGE) return false;
    }
    return true;
}

// ---------------------------------------------------------------------------------------------------------------
// The per-empire trip review (every short block, Empire.1.cs DoTasks)
// ---------------------------------------------------------------------------------------------------------------

function destinationValid(t: VipTrip): boolean {
    const d = t.destination;
    if (isBuiltObjectLocation(d)) return !d.hasBeenDestroyed && d.actualEmpire === t.empire;
    const h = d as Habitat;
    // Ambassadors travel to foreign capitals; everyone else to their own colonies (or uncolonised places).
    if (t.character !== null && t.character.role === CharacterRole.Ambassador) return h.empire !== null;
    return h.empire === null || h.empire === t.empire;
}

function rerouteHome(galaxy: Galaxy, t: VipTrip): void {
    const e = t.empire;
    let to: Habitat | null = e.capital;
    if (to === null || to.empire !== e) {
        let best: Habitat | null = null;
        let bd = Infinity;
        for (const h of e.colonies) {
            const d = galaxy.calculateDistance(h.xpos, h.ypos, t.shuttle.xpos, t.shuttle.ypos);
            if (d < bd) {
                bd = d;
                best = h;
            }
        }
        to = best;
    }
    if (to === null) return;
    t.destination = to;
    if (t.character !== null) t.character.retargetTransfer(to);
    if (t.waitUntil === 0) vipAssign(galaxy, t.shuttle, BuiltObjectMissionType.Move, to);
}

function arrive(galaxy: Galaxy, st: CvState, t: VipTrip): void {
    const c = t.character;
    releaseEscorts(galaxy, t);
    removeTrip(st, t);
    if (c !== null && c.active && c.location === t.shuttle) {
        c.completeLocationTransfer(t.destination, galaxy);
        c.resetTransfer();
        st.counters.tripsArrived++;
        cvEmpire(galaxy, t.empire).stats.arrived++;
        scenarioEmit(galaxy, 'vipTripArrived', { character: c, destination: t.destination, reason: t.reason });
    }
    despawn(galaxy, t.shuttle);
}

function fail(galaxy: Galaxy, st: CvState, t: VipTrip, cause: string): void {
    releaseEscorts(galaxy, t);
    removeTrip(st, t);
    if (t.character !== null) {
        st.counters.tripsLost++;
        cvEmpire(galaxy, t.empire).stats.lost++;
        scenarioEmit(galaxy, 'vipTripFailed', { character: t.character, destination: t.destination, reason: t.reason, cause });
    }
}

/** Reviews `empire`'s trips: departures, arrivals, reroutes, losses, stuck trips. */
export function reviewTrips(galaxy: Galaxy, empire: Empire): void {
    const st = peekCvState(galaxy);
    if (st === null || st.trips.length === 0) return;
    const now = galaxyStarDate(galaxy);
    for (const t of st.trips.filter((x) => x.empire === empire)) {
        const s = t.shuttle;
        if (s.hasBeenDestroyed || s.actualEmpire !== empire) {
            fail(galaxy, st, t, s.hasBeenDestroyed ? 'destroyed' : 'captured');
            continue;
        }
        const c = t.character;
        if (t.decoyOf === 0 && (c === null || !c.active || c.location !== s)) {
            // The passenger left (killed by another path, defected, dismissed): the shuttle goes home empty.
            fail(galaxy, st, t, 'removed');
            despawn(galaxy, s);
            continue;
        }
        if (c !== null && c.transferDestination === null) {
            // Something reset the transfer (the stock boarding reset of a captured destination): back to the capital.
            rerouteHome(galaxy, t);
        }
        if (!destinationValid(t)) rerouteHome(galaxy, t);
        s.currentFuel = s.fuelCapacity;
        if (t.waitUntil > 0) {
            if (now < t.waitUntil && !(t.escorts.length > 0 && escortsJoined(galaxy, t))) continue;
            t.waitUntil = 0;
            vipAssign(galaxy, s, BuiltObjectMissionType.Move, t.destination);
        }
        const d = galaxy.calculateDistance(s.xpos, s.ypos, t.destination.xpos, t.destination.ypos);
        if (d <= VIP_ARRIVE_RANGE || now >= t.deadline) {
            if (t.decoyOf !== 0) {
                removeTrip(st, t);
                despawn(galaxy, s);
            } else arrive(galaxy, st, t);
            continue;
        }
        const m = builtObjectMission(s.mission);
        if (m === null || m.type === BuiltObjectMissionType.Undefined || (m.type === BuiltObjectMissionType.Move && m.target !== t.destination)) {
            vipAssign(galaxy, s, BuiltObjectMissionType.Move, t.destination);
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Event / query handlers
// ---------------------------------------------------------------------------------------------------------------

/** characterTransferStarted: every non-instant transfer of a normal empire's character becomes a VIP trip. */
function onTransferStarted(galaxy: Galaxy, ev: { character: Character; destination: BuiltObject | Habitat }): void {
    if (!cvOn(galaxy, CV_VIP_FLAG)) return;
    startVipTrip(galaxy, ev.character, ev.destination, 'transfer');
}

/** A shuttle's other owner changes (not the boarding path, which already killed the passengers): the passengers die. */
function onOwnerChanged(galaxy: Galaxy, ev: { builtObject: BuiltObject; from: Empire | null; to: Empire | null }): void {
    const t = tripOfShuttle(galaxy, ev.builtObject);
    if (t === null || ev.to === t.empire) return;
    if (t.character !== null && t.character.active && t.character.location === ev.builtObject) {
        characterSendDeathMessage(galaxy, t.character, CharacterDeathType.ShipCaptured);
        t.character.kill(galaxy);
    }
    fail(galaxy, cvState(galaxy), t, 'captured');
}

/** builtObjectKilledBy: destroying another empire's VIP shuttle costs attitude with the victim (§4.5). */
function onKilledBy(galaxy: Galaxy, ev: { builtObject: BuiltObject; destroyer: Empire | null }): void {
    const t = tripOfShuttle(galaxy, ev.builtObject);
    if (t === null) return;
    const killer = ev.destroyer;
    if (killer !== null && killer !== t.empire && isCvEmpire(galaxy, killer)) {
        const ruler = t.character !== null && t.character.role === CharacterRole.Leader;
        applyReputation(galaxy, t.empire, killer, ruler ? -40 : -15, { cause: 'vipAttacked', labelKey: 'CV Reputation VIP Attacked', source: 'charactersVictory' });
    }
    // The passenger's death message is the stock one (Character.cs SendDeathMessage ShipDestroyed, from the teardown).
}

/** intelMissionCompleted: a successful Steal Operations Map against an empire whose ruler travels reveals the real shuttle. */
function onIntelCompleted(galaxy: Galaxy, ev: { empire: Empire; mission: unknown; outcome: unknown }): void {
    const m = ev.mission as { type: number; targetEmpire: Empire | null } | null;
    if (m === null || m.type !== IntelligenceMissionType.StealOperationsMap || m.targetEmpire === null) return;
    if (ev.outcome !== IntelligenceMissionOutcome.SucceedNotDetect && ev.outcome !== IntelligenceMissionOutcome.SucceedDetect) return;
    const st = peekCvState(galaxy);
    if (st === null) return;
    for (const t of st.trips) {
        if (t.empire !== m.targetEmpire || t.decoyOf !== 0 || t.character === null || t.character.role !== CharacterRole.Leader) continue;
        if (!st.trips.some((d) => d.decoyOf === t.id)) continue;
        if (!t.revealedTo.includes(ev.empire.empireId)) t.revealedTo.push(ev.empire.empireId);
        if (isHumanEmpire(galaxy, ev.empire)) {
            scenarioMessage(galaxy, ev.empire, scenarioText('CV Ruler Revealed Title'), scenarioText('CV Ruler Revealed', t.character.name, t.empire.name, t.shuttle.name), { type: EmpireMessageType.GeneralGoodEvent, subject: t.shuttle });
        }
    }
}

/** Is `bo` a VIP shuttle (a passenger or a decoy)? Pure. */
export function isVipShuttle(galaxy: Galaxy, bo: BuiltObject): boolean {
    return tripOfShuttle(galaxy, bo) !== null;
}

registerScenarioEvent({ id: 'charactersVictory.vipStart', flag: CV_FLAG, event: 'characterTransferStarted', run: onTransferStarted });
registerScenarioEvent({ id: 'charactersVictory.vipReview', flag: CV_FLAG, event: 'charactersProcessed', run: (g, ev) => reviewTrips(g, ev.empire) });
registerScenarioEvent({ id: 'charactersVictory.vipOwner', flag: CV_FLAG, event: 'builtObjectOwnerChanged', run: onOwnerChanged });
registerScenarioEvent({ id: 'charactersVictory.vipKilled', flag: CV_FLAG, event: 'builtObjectKilledBy', run: onKilledBy });
registerScenarioEvent({ id: 'charactersVictory.vipReveal', flag: CV_FLAG, event: 'intelMissionCompleted', run: onIntelCompleted });
registerScenarioQuery({
    id: 'charactersVictory.vipOrders',
    flag: CV_FLAG,
    query: 'assignMissionAllowed',
    run: (g, v, a) => (v && !ownAssign && isVipShuttle(g, a.builtObject) ? false : v),
});
registerScenarioQuery({
    id: 'charactersVictory.vipCommands',
    flag: CV_FLAG,
    query: 'playerCommandArgs',
    run: (g, v) => {
        if (peekCvState(g) === null || peekCvState(g)!.trips.length === 0) return v;
        let changed = false;
        const out = v.map((a) => {
            if (!Array.isArray(a) || !a.some((x) => x instanceof BuiltObject && isVipShuttle(g, x))) return a;
            changed = true;
            return a.filter((x) => !(x instanceof BuiltObject && isVipShuttle(g, x)));
        });
        return changed ? out : v;
    },
});
registerScenarioQuery({ id: 'charactersVictory.vipFuel', flag: CV_FLAG, query: 'builtObjectSelfFuelling', run: (g, v, a) => v || isVipShuttle(g, a.builtObject) });
registerScenarioQuery({ id: 'charactersVictory.vipNoExplore', flag: CV_FLAG, query: 'unitGrantsSystemVisibility', run: (g, v, a) => v && !isVipShuttle(g, a.builtObject) });

// ---------------------------------------------------------------------------------------------------------------
// Read-only views (map markers, UI)
// ---------------------------------------------------------------------------------------------------------------

export interface VipMarker {
    shuttle: BuiltObject;
    /** The passenger's name for the owner; for others "VIP shuttle" (or "Ruler aboard" once revealed). */
    label: string;
    own: boolean;
    destination: { x: number; y: number } | null;
}

/** The VIP shuttles `viewer` may see marked (own, or foreign and visible per `visible`). Pure. */
export function vipMarkers(galaxy: Galaxy, viewer: Empire | null, visible: (bo: BuiltObject) => boolean): VipMarker[] {
    const st = peekCvState(galaxy);
    if (st === null || st.trips.length === 0) return [];
    const out: VipMarker[] = [];
    for (const t of st.trips) {
        const s = t.shuttle;
        if (s.hasBeenDestroyed) continue;
        const own = viewer !== null && t.empire === viewer;
        if (!own && !visible(s)) continue;
        let label: string;
        if (own) label = t.character !== null ? `${t.character.name} (${scenarioText('CV Role ' + CharacterRole[t.character.role])})` : scenarioText('CV Decoy');
        else if (viewer !== null && t.character !== null && t.character.role === CharacterRole.Leader && t.revealedTo.includes(viewer.empireId)) label = scenarioText('CV Ruler Aboard', t.character.name);
        else label = scenarioText('CV VIP Shuttle');
        out.push({ shuttle: s, label, own, destination: own ? { x: t.destination.xpos, y: t.destination.ypos } : null });
    }
    return out;
}

/** UI: the trip of a character (ETA = straight-line distance / cruise speed, else the deadline). Pure. */
export function vipTripView(galaxy: Galaxy, c: Character): { trip: VipTrip; etaStarDate: number } | null {
    const t = tripOfCharacter(galaxy, c);
    if (t === null) return null;
    const now = galaxyStarDate(galaxy);
    const d = galaxy.calculateDistance(t.shuttle.xpos, t.shuttle.ypos, t.destination.xpos, t.destination.ypos);
    const speed = Math.max(1, t.shuttle.warpSpeed > 0 ? t.shuttle.warpSpeed : t.shuttle.cruiseSpeed);
    const eta = Math.min(t.deadline, now + Math.max(0, t.waitUntil - now) + (d / speed) * 1000);
    return { trip: t, etaStarDate: eta };
}

export { tripOfCharacter, tripOfShuttle };
export type { BuiltObject };
