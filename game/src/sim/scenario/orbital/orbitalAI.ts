// Orbital superiority, the AI side (scenarios/orbital-superiority, flag orbitalSuperiority; rules in
// orbitalSuperiority.ts). Not a port. AI empires only (never a human empire); pirates keep the stock AI.
//
// - Target choice (query invasionTargetOrbitOk; fleets/militaryAI.ts checkFleetCanAttackTarget and combat/invasion.ts
//   invadeUnwillingColonizationTargets): the AI attacks for the orbit instead of skipping it. A fleet takes a colony as an
//   invasion target when its firepower, plus the empire's armed ships already in that orbit and the routine fleets it
//   can gather within orbitalAiReliefRange, reaches orbitalAiParityRatio (1) × the defenders' armed firepower in the
//   orbit (ships and bases within 2000); it skips the target only when it cannot reach parity, or for
//   orbitalAiCooldownDays after withdrawing from it.
// - Landing: AI troops wait aboard only while the orbit is defender-held or contested with the AI losing it
//   (its strength there < orbitalAiLandRatio × the defenders'); they land as soon as that changes (orbitalSuperiority.ts).
// - Daily review (periodic handler, in this order):
//   1. ended invasions: the defender's relief fleet (still patrolling the colony) is released;
//   2. held landings: every orbitalAiLosingDays the invader sends one more fleet to the orbit fight (the nearest routine
//      fleet with the firepower still missing, else its strongest one within reach; Attack, Normal priority); it
//      withdraws (Move to its nearest colony, troops aboard; cooldown) only after orbitalAiHoldDays without the orbit
//      or when parity is out of reach;
//   3. invasions in progress, the invader: its idle fleets in that orbit or with it as attack point get a Low-priority
//      Attack on it (they stay over the planet, but the stock AI may still send them on its next strike); after
//      orbitalAiLosingDays of a contested / defender-held orbit it reinforces the same way, and withdraws only from a
//      defender-held orbit it cannot reach parity in;
//   4. invasions in progress, the defender: the colonies in order of (winnability × strategicValue) — winnability =
//      min(3, fleet firepower / attackers' Space Control strength) — get the nearest routine fleet (no mission, or Low /
//      Normal priority) within orbitalAiReliefRange with firepower ≥ orbitalAiReliefMinRatio × the attackers'
//      strength: a High-priority Patrol of the colony (over routine patrols), one fleet per colony.
// Strength measure: firepowerRaw, the original Space Control measure. Rnd: only the fleet mission assignments' own
// draws (shipGroupAssignMission), only with the flag on.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Habitat } from '../../types';
import type { ShipGroup } from '../../fleets/shipGroup';
import { shipGroupAssignMission, shipGroupCompleteMission } from '../../fleets/shipGroup';
import { shipGroupTotalTroopAttackStrength } from '../../fleets/shipGroupTasks';
import { BuiltObjectMissionPriority, BuiltObjectMissionType } from '../../missions/mission';
import { isAiControlled } from '../../missions/playerOrder';
import { isHumanEmpire } from '../../humanEmpires';
import { getEmpireById } from '../../logistics/contracts';
import { strategicValue } from '../../territory';
import { getNearbyBuiltObjects } from '../../pirates/pirateAI';
import { BuiltObjectRole } from '../../data/designSpecifications';
import { galaxyStarDate } from '../../tick/simTime';
import { GAME_DAY_LENGTH, registerScenarioPeriodic, registerScenarioQuery } from '../hooks';
import { scenarioParam } from '../state';
import {
    ORBIT_RANGE,
    classifyOrbit,
    empireFirepowerNear,
    landingOrbitStrengths,
    orbitalRatio,
    orbitalState,
    type OrbitalInvasion,
    type OrbitalSuperiorityState,
} from './orbitalSuperiority';
import { ORBITAL_SUPERIORITY_FLAG } from './orbitalFlags';

function aiEmpire(galaxy: Galaxy, e: Empire | null): e is Empire {
    return e !== null && e !== galaxy.independentEmpire && e.pirateEmpireBaseHabitat === null && !isHumanEmpire(galaxy, e);
}

export function fleetFirepower(fleet: ShipGroup): number {
    let t = 0;
    for (const s of fleet.ships) if (!s.hasBeenDestroyed) t += s.firepowerRaw;
    return t;
}

function fleetsOf(empire: Empire): ShipGroup[] {
    return empire.shipGroups as ShipGroup[];
}

function fleetAlive(empire: Empire | null, fleet: ShipGroup | null): fleet is ShipGroup {
    return empire !== null && fleet !== null && fleet.ships.length > 0 && fleetsOf(empire).includes(fleet);
}

/** No mission, or a routine (Low / Normal) one: free for this review to retask. */
function routine(fleet: ShipGroup): boolean {
    const m = fleet.mission;
    return m === null || m.type === BuiltObjectMissionType.Undefined || m.priority === BuiltObjectMissionPriority.Low || m.priority === BuiltObjectMissionPriority.Normal;
}

/** No mission at all (or an Undefined one): the fleet is not doing anything the stock AI gave it. */
function idle(fleet: ShipGroup): boolean {
    const m = fleet.mission;
    return m === null || m.type === BuiltObjectMissionType.Undefined;
}

function aiFleet(fleet: ShipGroup): boolean {
    return fleet.leadShip !== null && isAiControlled(fleet.leadShip) && fleet.ships.length > 0;
}

function distSq(galaxy: Galaxy, fleet: ShipGroup, h: Habitat): number {
    const l = fleet.leadShip!;
    return galaxy.calculateDistanceSquared(l.xpos, l.ypos, h.xpos, h.ypos);
}

function onCooldown(galaxy: Galaxy, st: OrbitalSuperiorityState, h: Habitat, e: Empire): boolean {
    const now = galaxyStarDate(galaxy);
    for (const c of st.cooldowns) if (c.h === h.habitatIndex && c.e === e.empireId && c.until > now) return true;
    return false;
}

// ---------------------------------------------------------------------------------------------------------------
// Target choice
// ---------------------------------------------------------------------------------------------------------------

/** Firepower of `empire`'s routine AI fleets (not `except`, not in `used`) within the relief range of `h`: what it can gather. */
export function gatherableFirepower(galaxy: Galaxy, empire: Empire, h: Habitat, except: ShipGroup | null, used: Set<ShipGroup> | null = null): number {
    const range = scenarioParam(galaxy, 'orbitalAiReliefRange', 4000000);
    let t = 0;
    for (const f of fleetsOf(empire)) {
        if (f === except || (used !== null && used.has(f)) || !aiFleet(f) || !routine(f)) continue;
        if (distSq(galaxy, f, h) <= range * range) t += fleetFirepower(f);
    }
    return t;
}

/**
 * Whether `fleet` of `empire` (with the empire's armed ships already in that orbit and the routine fleets it can gather
 * within the relief range) reaches parity — orbitalAiParityRatio × the defenders' armed strength in the orbit of
 * `target` (their ships and bases within 2000, the Space Control measure). The AI then goes and fights for the orbit;
 * it skips the target only when it cannot reach parity. Pure.
 */
export function canContestOrbit(galaxy: Galaxy, empire: Empire, fleet: ShipGroup, target: Habitat): boolean {
    const defender = target.empire;
    if (defender === null || defender === empire) return true;
    const d = empireFirepowerNear(galaxy, target.xpos, target.ypos, ORBIT_RANGE, defender);
    if (d <= 0) return true;
    const need = scenarioParam(galaxy, 'orbitalAiParityRatio', 1) * d;
    let have = fleetFirepower(fleet) + empireFirepowerNear(galaxy, target.xpos, target.ypos, ORBIT_RANGE, empire);
    if (have >= need) return true;
    have += gatherableFirepower(galaxy, empire, target, fleet);
    return have >= need;
}

/** Kept for the other add-ons (blockades) that ask whether a fleet could hold an orbit: the same parity test. */
export const canHoldOrbit = canContestOrbit;

/**
 * Measurement only (scripts/orbital-soak-hook.mjs sets `globalThis.__orbitalDiag`): one record per invasion candidate
 * (fleet, target, game day) the target query judged — the fleet's ships and firepower, the defenders' armed strength in
 * orbit split into ships and bases, what the AI could gather, and the verdict. Never read by the sim.
 */
interface CandidateDiag {
    seen: Set<string>;
    records: { day: number; ships: number; fleetFp: number; defShips: number; defBases: number; gather: number; verdict: string }[];
}
const diag = (): CandidateDiag | null => (globalThis as { __orbitalDiag?: CandidateDiag }).__orbitalDiag ?? null;

function noteCandidate(g: Galaxy, empire: Empire, fleet: ShipGroup, target: Habitat, verdict: string): void {
    const d = diag()!;
    const day = Math.floor(g.nowMs / GAME_DAY_LENGTH);
    const key = `${empire.empireId}:${fleet.leadShip?.builtObjectID ?? 0}:${target.habitatIndex}:${Math.floor(day / 30)}`;
    if (d.seen.has(key) || d.records.length >= 20000) return;
    d.seen.add(key);
    let defShips = 0;
    let defBases = 0;
    for (const b of getNearbyBuiltObjects(g, target.xpos, target.ypos, ORBIT_RANGE)) {
        if (b == null || b.hasBeenDestroyed || b.firepowerRaw <= 0 || b.owner !== target.empire) continue;
        if (b.role === BuiltObjectRole.Base) defBases += b.firepowerRaw;
        else defShips += b.firepowerRaw;
    }
    d.records.push({ day, ships: fleet.ships.length, fleetFp: fleetFirepower(fleet), defShips, defBases, gather: gatherableFirepower(g, empire, target, fleet), verdict });
}

registerScenarioQuery({
    id: 'orbitalSuperiority.target',
    flag: ORBITAL_SUPERIORITY_FLAG,
    query: 'invasionTargetOrbitOk',
    run: (g, v, { empire, fleet, target }) => {
        if (!v || !aiEmpire(g, empire)) return v;
        const st = orbitalState(g);
        // An invasion of ours already under way there: the escort's review (below) decides.
        for (const inv of st.invasions) if (inv.h === target.habitatIndex && inv.inv === empire.empireId) return !inv.withdrawn;
        const cool = onCooldown(g, st, target, empire);
        const ok = !cool && canContestOrbit(g, empire, fleet, target);
        if (diag() !== null) noteCandidate(g, empire, fleet, target, cool ? 'cooldown' : ok ? 'go' : 'short');
        return ok;
    },
});

// ---------------------------------------------------------------------------------------------------------------
// Daily review
// ---------------------------------------------------------------------------------------------------------------

/** The empire colony nearest `h` (its retreat point), or its capital. */
function retreatPoint(galaxy: Galaxy, empire: Empire, h: Habitat): Habitat | null {
    let best: Habitat | null = null;
    let bestD = Number.MAX_VALUE;
    for (const c of empire.colonies) {
        if (c === h) continue;
        const d = galaxy.calculateDistanceSquared(c.xpos, c.ypos, h.xpos, h.ypos);
        if (d < bestD) {
            bestD = d;
            best = c;
        }
    }
    return best ?? empire.capital;
}

/** The invader's fleets bound for / over `h` pull back, troops aboard. Returns the number of fleets withdrawn. */
function withdrawFrom(galaxy: Galaxy, st: OrbitalSuperiorityState, empire: Empire, h: Habitat): number {
    const to = retreatPoint(galaxy, empire, h);
    let n = 0;
    for (const fleet of fleetsOf(empire).slice()) {
        if (!aiFleet(fleet)) continue;
        const m = fleet.mission;
        const bound = fleet.attackPoint === h || (m !== null && m.targetHabitat === h) || distSq(galaxy, fleet, h) <= ORBIT_RANGE * ORBIT_RANGE * 4;
        if (!bound) continue;
        if (shipGroupTotalTroopAttackStrength(fleet) > 0) st.stats.landingsAborted++;
        fleet.attackPoint = null;
        if (to !== null) shipGroupAssignMission(galaxy, fleet, BuiltObjectMissionType.Move, to, null, BuiltObjectMissionPriority.High, false);
        n++;
    }
    const cool = scenarioParam(galaxy, 'orbitalAiCooldownDays', 15) * GAME_DAY_LENGTH;
    st.cooldowns.push({ h: h.habitatIndex, e: empire.empireId, until: galaxyStarDate(galaxy) + cool });
    if (n > 0) st.stats.withdrawals++;
    return n;
}

/**
 * The nearest routine AI fleet of `empire` within the relief range (or `range`) with firepower ≥ `need`, not in
 * `used`, passing `accept` (Blockades that bite reuses it for its relief and blockade fleets).
 */
export function nearestFleet(galaxy: Galaxy, empire: Empire, h: Habitat, need: number, used: Set<ShipGroup>, range = scenarioParam(galaxy, 'orbitalAiReliefRange', 4000000), accept: ((fleet: ShipGroup) => boolean) | null = null): ShipGroup | null {
    let best: ShipGroup | null = null;
    let bestD = range * range;
    for (const fleet of fleetsOf(empire)) {
        if (used.has(fleet) || !aiFleet(fleet) || !routine(fleet) || (accept !== null && !accept(fleet))) continue;
        const fp = fleetFirepower(fleet);
        if (fp <= 0 || fp < need) continue;
        const d = distSq(galaxy, fleet, h);
        if (d <= bestD) {
            if (d === bestD && best !== null) continue;
            bestD = d;
            best = fleet;
        }
    }
    return best;
}

/**
 * Brings more strength to `h`'s orbit: the nearest routine fleet with the firepower still missing, else (gathering)
 * the strongest one within reach. Returns the fleet sent, or null when there is none.
 */
function sendReinforcement(galaxy: Galaxy, st: OrbitalSuperiorityState, e: Empire, h: Habitat, need: number, used: Set<ShipGroup>): ShipGroup | null {
    let fleet = nearestFleet(galaxy, e, h, need, used);
    if (fleet === null) {
        const range = scenarioParam(galaxy, 'orbitalAiReliefRange', 4000000);
        let bestFp = 0;
        for (const f of fleetsOf(e)) {
            if (used.has(f) || !aiFleet(f) || !routine(f) || distSq(galaxy, f, h) > range * range) continue;
            const fp = fleetFirepower(f);
            if (fp > bestFp) {
                bestFp = fp;
                fleet = f;
            }
        }
    }
    if (fleet === null) return null;
    used.add(fleet);
    fleet.attackPoint = h;
    // Normal priority: over routine work, but not pinned against the stock AI's own strikes and defence.
    shipGroupAssignMission(galaxy, fleet, BuiltObjectMissionType.Attack, h, null, BuiltObjectMissionPriority.Normal, false);
    st.stats.reinforcements++;
    return fleet;
}

/** Whether `e` can still reach parity in `h`'s orbit (strength there + what it can gather ≥ parity × defenders). */
function parityReachable(galaxy: Galaxy, e: Empire, h: Habitat, d: number, a: number, used: Set<ShipGroup>): boolean {
    return a + gatherableFirepower(galaxy, e, h, null, used) >= scenarioParam(galaxy, 'orbitalAiParityRatio', 1) * d;
}

function reviewHolds(galaxy: Galaxy, st: OrbitalSuperiorityState, now: number, used: Set<ShipGroup>): void {
    const holdDays = scenarioParam(galaxy, 'orbitalAiHoldDays', 30);
    const losingDays = scenarioParam(galaxy, 'orbitalAiLosingDays', 10);
    for (const hold of st.holds.slice()) {
        const h = galaxy.habitats[hold.h];
        const e = getEmpireById(galaxy, hold.e);
        // Stale (no refused landing for 3 days: the ships went elsewhere, or landed after all).
        if (h === undefined || e === null || now - hold.last > 3 * GAME_DAY_LENGTH || h.empire === null || h.empire === e) {
            st.holds.splice(st.holds.indexOf(hold), 1);
            continue;
        }
        const days = (now - hold.since) / GAME_DAY_LENGTH;
        const s = landingOrbitStrengths(galaxy, h, h.empire, e);
        // Waiting troops: every orbitalAiLosingDays bring more strength to the orbit fight; withdraw only past
        // orbitalAiHoldDays or when parity is out of reach.
        if (days >= losingDays && now - hold.reviewed >= losingDays * GAME_DAY_LENGTH) {
            hold.reviewed = now;
            const sent = sendReinforcement(galaxy, st, e, h, orbitalRatio(galaxy) * s.d - s.a, used);
            if (days >= holdDays || (sent === null && !parityReachable(galaxy, e, h, s.d, s.a, used))) {
                withdrawFrom(galaxy, st, e, h);
                st.holds.splice(st.holds.indexOf(hold), 1);
            }
        }
    }
}

function reviewInvader(galaxy: Galaxy, st: OrbitalSuperiorityState, inv: OrbitalInvasion, h: Habitat, now: number, used: Set<ShipGroup>): void {
    const e = getEmpireById(galaxy, inv.inv);
    if (!aiEmpire(galaxy, e) || inv.withdrawn) return;
    // Escorts stay over the planet until the invasion ends.
    for (const fleet of fleetsOf(e)) {
        if (!aiFleet(fleet) || fleetFirepower(fleet) <= 0) continue;
        const m = fleet.mission;
        const near = distSq(galaxy, fleet, h) <= ORBIT_RANGE * ORBIT_RANGE * 4;
        if (!(fleet.attackPoint === h || near)) continue;
        used.add(fleet);
        if (m !== null && m.targetHabitat === h && m.type === BuiltObjectMissionType.Attack) continue;
        if (!idle(fleet)) continue;
        // Low priority: an idle fleet stays over the planet, but the stock AI may still send it on its next strike.
        shipGroupAssignMission(galaxy, fleet, BuiltObjectMissionType.Attack, h, null, BuiltObjectMissionPriority.Low, false);
        st.stats.escortsHeld++;
    }
    // Ground down without the orbit: reinforce the orbit; pull back only from a defender-held orbit it cannot reach
    // parity in.
    const losingDays = scenarioParam(galaxy, 'orbitalAiLosingDays', 10) * GAME_DAY_LENGTH;
    if ((inv.state === 'contested' || inv.state === 'defender') && now - inv.since >= losingDays && now - inv.reviewed >= losingDays) {
        inv.reviewed = now;
        const d = Math.max(0, h.invasionSpaceControlStrengthDefenders);
        const a = Math.max(0, h.invasionSpaceControlStrengthAttackers);
        const sent = sendReinforcement(galaxy, st, e, h, orbitalRatio(galaxy) * d - a, used);
        if (sent === null && inv.state === 'defender' && !parityReachable(galaxy, e, h, d, a, used)) {
            withdrawFrom(galaxy, st, e, h);
            inv.withdrawn = true;
        }
    }
}

function reviewDefenders(galaxy: Galaxy, st: OrbitalSuperiorityState, used: Set<ShipGroup>): void {
    if (scenarioParam(galaxy, 'orbitalAiReliefFleets', 1) <= 0) return;
    const minRatio = scenarioParam(galaxy, 'orbitalAiReliefMinRatio', 1);
    const picks: { inv: OrbitalInvasion; h: Habitat; e: Empire; priority: number }[] = [];
    for (const inv of st.invasions) {
        const e = getEmpireById(galaxy, inv.def);
        const h = galaxy.habitats[inv.h];
        if (!aiEmpire(galaxy, e) || h === undefined || h.empire !== e) continue;
        if (fleetAlive(e, inv.relief)) {
            used.add(inv.relief);
            continue;
        }
        inv.relief = null;
        if (inv.state === 'defender') continue;
        const a = Math.max(1, h.invasionSpaceControlStrengthAttackers);
        const fleet = nearestFleet(galaxy, e, h, minRatio * a, used);
        if (fleet === null) continue;
        picks.push({ inv, h, e, priority: Math.min(3, fleetFirepower(fleet) / a) * strategicValue(h) });
    }
    picks.sort((x, y) => y.priority - x.priority || x.inv.h - y.inv.h);
    for (const p of picks) {
        const a = Math.max(1, p.h.invasionSpaceControlStrengthAttackers);
        const fleet = nearestFleet(galaxy, p.e, p.h, minRatio * a, used);
        if (fleet === null) continue;
        used.add(fleet);
        shipGroupAssignMission(galaxy, fleet, BuiltObjectMissionType.Patrol, p.h, null, BuiltObjectMissionPriority.High, false);
        p.inv.relief = fleet;
        p.inv.reliefSent = true;
        st.stats.reliefsSent++;
    }
}

/** Release the relief fleets of ended invasions (a High Patrol of the colony would otherwise never end). */
function releaseEnded(galaxy: Galaxy, st: OrbitalSuperiorityState): void {
    for (const inv of st.ended) {
        const e = getEmpireById(galaxy, inv.def);
        const h = galaxy.habitats[inv.h];
        if (fleetAlive(e, inv.relief) && h !== undefined) {
            const m = inv.relief.mission;
            if (m !== null && m.type === BuiltObjectMissionType.Patrol && m.targetHabitat === h) shipGroupCompleteMission(galaxy, inv.relief);
        }
        inv.relief = null;
    }
    st.ended.length = 0;
}

export function orbitalAiReview(galaxy: Galaxy): void {
    const st = orbitalState(galaxy);
    const now = galaxyStarDate(galaxy);
    releaseEnded(galaxy, st);
    for (let i = st.cooldowns.length - 1; i >= 0; i--) if (st.cooldowns[i].until <= now) st.cooldowns.splice(i, 1);
    // Relief fleets stay referenced only while alive (no references to disbanded fleets in the save).
    for (const inv of st.invasions) if (inv.relief !== null && !fleetAlive(getEmpireById(galaxy, inv.def), inv.relief)) inv.relief = null;
    const used = new Set<ShipGroup>();
    reviewHolds(galaxy, st, now, used);
    for (const inv of st.invasions.slice()) {
        const h = galaxy.habitats[inv.h];
        if (h !== undefined) reviewInvader(galaxy, st, inv, h, now, used);
    }
    reviewDefenders(galaxy, st, used);
}

registerScenarioPeriodic({
    id: 'orbitalSuperiority.ai',
    flag: ORBITAL_SUPERIORITY_FLAG,
    periodDays: 1,
    run: (g) => orbitalAiReview(g),
});
