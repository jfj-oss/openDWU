// Orbital superiority, the AI side (scenarios/orbital-superiority, flag orbitalSuperiority; rules in
// orbitalSuperiority.ts). Not a port. AI empires only (never a human empire); pirates keep the stock AI.
//
// - Target choice (query invasionTargetOrbitOk; fleets/militaryAI.ts checkFleetCanAttackTarget and combat/invasion.ts
//   invadeUnwillingColonizationTargets): a fleet only takes a colony as an invasion target when its firepower (plus the
//   empire's armed objects already in that orbit) is more than orbitalSuperiorityRatio × the defenders' armed firepower
//   within orbitalAiThreatRange of the planet (the system around it), and not within orbitalAiHoldDays × 3 of a
//   withdrawal from it.
// - Daily review (periodic handler, in this order):
//   1. ended invasions: the defender's relief fleet (still patrolling the colony) is released;
//   2. held landings (AI troops kept aboard by a contested / defender-held orbit): after orbitalAiHoldDays, or
//      orbitalAiLosingDays in a defender-held orbit, the invader's fleets bound for the colony withdraw (Move to its
//      nearest colony, the troops still aboard) and the colony is off its target list for a while;
//   3. invasions in progress, the invader: its fleets in that orbit or with it as attack point keep (or get back to)
//      an Attack mission on it until the invasion ends (High priority, over routine reassignments); after
//      orbitalAiLosingDays of a contested / defender-held orbit it sends its nearest routine fleet that would win the
//      orbit (firepower ≥ ratio × defenders − its own there), else withdraws its fleets;
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
import { galaxyStarDate } from '../../tick/simTime';
import { GAME_DAY_LENGTH, registerScenarioPeriodic, registerScenarioQuery } from '../hooks';
import { scenarioParam } from '../state';
import {
    ORBIT_RANGE,
    ORBITAL_SUPERIORITY_FLAG,
    classifyOrbit,
    empireFirepowerNear,
    landingOrbitStrengths,
    orbitalRatio,
    orbitalState,
    type OrbitalInvasion,
    type OrbitalSuperiorityState,
} from './orbitalSuperiority';

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

/** Whether `fleet` of `empire` could hold the orbit of `target` against the defenders near it. Pure. */
export function canHoldOrbit(galaxy: Galaxy, empire: Empire, fleet: ShipGroup, target: Habitat): boolean {
    const defender = target.empire;
    if (defender === null || defender === empire) return true;
    const range = Math.max(ORBIT_RANGE, scenarioParam(galaxy, 'orbitalAiThreatRange', 23000));
    const d = empireFirepowerNear(galaxy, target.xpos, target.ypos, range, defender);
    if (d <= 0) return true;
    const own = empireFirepowerNear(galaxy, target.xpos, target.ypos, ORBIT_RANGE, empire);
    return fleetFirepower(fleet) + own > orbitalRatio(galaxy) * d;
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
        const ok = !onCooldown(g, st, target, empire) && canHoldOrbit(g, empire, fleet, target);
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
    const cool = scenarioParam(galaxy, 'orbitalAiHoldDays', 20) * 3 * GAME_DAY_LENGTH;
    st.cooldowns.push({ h: h.habitatIndex, e: empire.empireId, until: galaxyStarDate(galaxy) + cool });
    if (n > 0) st.stats.withdrawals++;
    return n;
}

/** The nearest routine AI fleet of `empire` within the relief range with firepower ≥ `need`, not in `used`. */
function nearestFleet(galaxy: Galaxy, empire: Empire, h: Habitat, need: number, used: Set<ShipGroup>): ShipGroup | null {
    const range = scenarioParam(galaxy, 'orbitalAiReliefRange', 4000000);
    let best: ShipGroup | null = null;
    let bestD = range * range;
    for (const fleet of fleetsOf(empire)) {
        if (used.has(fleet) || !aiFleet(fleet) || !routine(fleet)) continue;
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

function reviewHolds(galaxy: Galaxy, st: OrbitalSuperiorityState, now: number): void {
    const holdDays = scenarioParam(galaxy, 'orbitalAiHoldDays', 20);
    const losingDays = scenarioParam(galaxy, 'orbitalAiLosingDays', 4);
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
        const state = classifyOrbit(s.d, s.a, orbitalRatio(galaxy));
        if (days >= holdDays || (state === 'defender' && days >= losingDays)) {
            withdrawFrom(galaxy, st, e, h);
            st.holds.splice(st.holds.indexOf(hold), 1);
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
        if (!routine(fleet)) continue;
        shipGroupAssignMission(galaxy, fleet, BuiltObjectMissionType.Attack, h, null, BuiltObjectMissionPriority.High, false);
        st.stats.escortsHeld++;
    }
    // Ground down without the orbit: reinforce the orbit, or pull back.
    const losingDays = scenarioParam(galaxy, 'orbitalAiLosingDays', 4) * GAME_DAY_LENGTH;
    if ((inv.state === 'contested' || inv.state === 'defender') && now - inv.since >= losingDays && now - inv.reviewed >= losingDays) {
        inv.reviewed = now;
        const d = Math.max(0, h.invasionSpaceControlStrengthDefenders);
        const a = Math.max(0, h.invasionSpaceControlStrengthAttackers);
        const need = orbitalRatio(galaxy) * d - a;
        const fleet = nearestFleet(galaxy, e, h, need, used);
        if (fleet !== null) {
            used.add(fleet);
            fleet.attackPoint = h;
            shipGroupAssignMission(galaxy, fleet, BuiltObjectMissionType.Attack, h, null, BuiltObjectMissionPriority.High, false);
            st.stats.reinforcements++;
        } else {
            withdrawFrom(galaxy, st, e, h);
            inv.withdrawn = true;
        }
    }
}

function reviewDefenders(galaxy: Galaxy, st: OrbitalSuperiorityState, used: Set<ShipGroup>): void {
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
    reviewHolds(galaxy, st, now);
    const used = new Set<ShipGroup>();
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
