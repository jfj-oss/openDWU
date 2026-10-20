// The Beacon, part 5: the Galactic Diet's research moratorium (registerDietMotionKind; Giantworks wonder, flag gwBeacon, Characters & Victory's Diet on).
// Once the Beacon threat is known to someone, any member may move a moratorium: galaxy-wide research is slowed by beaconMoratoriumPct for
// beaconMoratoriumDays (the researchPowerFactor query). The AI members that fear the Beacon vote yes; those racing for tech vote no, and may
// BREAK it (their research is not slowed). Each month a breaker is in breach: the Diet's violation path (reputation, grievances); at the
// beaconMoratoriumSanctionAfter-th breach the Diet's own sanction path (automatic sanctions with enforcers). Humans comply (no new menus).
//
// Evacuate the worlds near the Great Work (kind beaconEvacuate; proposable while the work is built or before the first beam): when it passes, each
// member places relocation orders (beaconRelocation.ts: its plan, cost, carriers and income rule) for its own colonies within beaconEvacSectors of
// the site, the densest first, each to the nearest member colony outside the zone with room. No migration boosts or bookkeeping of its own.
// Rnd: none.

import type { Galaxy } from '../../../galaxy';
import type { Empire } from '../../../empire';
import type { Habitat } from '../../../types';
import { aggressionLevel, cautionLevel, friendlinessLevel } from '../../../diplomacyTick';
import { galaxyStarDate } from '../../../tick/simTime';
import { isHumanEmpire } from '../../../humanEmpires';
import { dietCouncil, dietLawViolation, dietSanctionOffender } from '../../charactersVictory/diet/diet';
import { dietMembership } from '../../charactersVictory/diet/dietAi';
import { dietOn, lawInForce, peekDietState, registerDietMotionKind, type DietKindCandidate } from '../../charactersVictory/diet/dietState';
import { GAME_DAY_LENGTH, registerScenarioPeriodic, registerScenarioQuery } from '../../hooks';
import { SECTOR_SIZE } from '../../../logistics/orders';
import { scenarioNews, scenarioText } from '../../messages';
import { scenarioFlag, scenarioParam } from '../../state';
import { KNOWLEDGE_CONFIRMED, KNOWLEDGE_SUSPECTED, knowledgeLevel } from '../framework';
import { empireTechLevel } from '../robotMutiny';
import { BEACON_FLAG, P, beaconPosition, peekBeaconState, type BeaconState } from './beaconState';
import { relocationTargets, startRelocation } from './beaconRelocation';

export const LAW_MORATORIUM = 'beaconMoratorium';
export const MOTION_MORATORIUM = 'beaconMoratorium';
const TAG = 'Beacon';

function on(g: Galaxy): boolean {
    return scenarioFlag(g, BEACON_FLAG) && dietOn(g);
}

function p(e: Empire): { caution: number; friendly: number; aggression: number } {
    return { caution: (cautionLevel(e) - 100) / 50, friendly: (friendlinessLevel(e) - 100) / 50, aggression: (aggressionLevel(e) - 100) / 50 };
}

/** `e` has reason to fear the Beacon: it saw a Watcher for what it is, found a corrupted world, or the Beacon is awake. Pure. */
export function knowsBeacon(st: BeaconState, e: Empire): boolean {
    if (st.phase === 'reclamation') return true;
    if (knowledgeLevel({ knowledge: st.beaconKnowledge }, e) >= KNOWLEDGE_SUSPECTED) return true;
    if (st.watchers.some((w) => !w.dead && knowledgeLevel({ knowledge: w.knowledge }, e) >= KNOWLEDGE_SUSPECTED)) return true;
    return st.corrupted.some((c) => c.ended === null && knowledgeLevel({ knowledge: c.knowledge }, e) >= KNOWLEDGE_CONFIRMED);
}

/** The Beacon threat is known to some empire. Pure. */
export function beaconKnownToAnyone(g: Galaxy, st: BeaconState): boolean {
    return g.empires.some((e) => e !== null && e.active && e !== g.independentEmpire && e.pirateEmpireBaseHabitat === null && e !== st.faction && knowsBeacon(st, e));
}

function members(g: Galaxy): Empire[] {
    const c = dietCouncil(g);
    return c === null ? [] : dietMembership(g, c);
}

function topTech(g: Galaxy, st: BeaconState): number {
    let m = 1;
    for (const e of members(g)) if (e !== st.faction) m = Math.max(m, empireTechLevel(e));
    return m;
}

/** `e` is racing for tech: it trails the leader and does not fear the Beacon, or it is aggressive and ahead. Pure. */
export function racingForTech(g: Galaxy, st: BeaconState, e: Empire): boolean {
    const pr = p(e);
    const behind = empireTechLevel(e) < topTech(g, st);
    return (behind && !knowsBeacon(st, e)) || pr.aggression > 0.35;
}

/** `e` (an AI member) will break the moratorium. Pure. */
export function willBreak(g: Galaxy, st: BeaconState, e: Empire): boolean {
    return !isHumanEmpire(g, e) && racingForTech(g, st, e) && !knowsBeacon(st, e);
}

function candidate(proposer: Empire, weight: number): DietKindCandidate {
    return { kind: MOTION_MORATORIUM, proposer, target: null, other: null, colony: null, resourceId: -1, weight };
}

registerDietMotionKind({
    kind: MOTION_MORATORIUM,
    label: 'Research moratorium',
    needs: 'none',
    proposable: (g) => {
        const st = peekBeaconState(g);
        return on(g) && st !== null && st.phase === 'watching' && beaconKnownToAnyone(g, st) && lawInForce(peekDietState(g), LAW_MORATORIUM) === null;
    },
    text: () => scenarioText(`${TAG} Diet Moratorium`),
    effect: () => scenarioText(`${TAG} Diet Moratorium Effect`),
    apply: (g, st, m, addLaw) => {
        const b = peekBeaconState(g);
        const now = galaxyStarDate(g);
        const until = now + P.moratoriumDays(g) * GAME_DAY_LENGTH;
        addLaw(LAW_MORATORIUM, null, null, null, until);
        if (b !== null) {
            b.moratorium = { since: now, until, proposer: m.proposer.empireId, breakers: members(g).filter((e) => willBreak(g, b, e)).map((e) => e.empireId), breaches: {}, sanctioned: [], lastCheck: now };
            b.stats.moratoriums = (b.stats.moratoriums ?? 0) + 1;
        }
        void st;
        scenarioNews(g, null, scenarioText(`${TAG} Diet Moratorium News`, P.moratoriumPct(g), Math.round(P.moratoriumDays(g) / 30)));
    },
    voteScore: (g, _st, voter, m) => {
        if (voter === m.proposer) return 100;
        const b = peekBeaconState(g);
        if (b === null) return 0;
        const pr = p(voter);
        const knows = knowsBeacon(b, voter);
        let s = 2 + 14 * pr.caution + 8 * pr.friendly - 14 * pr.aggression;
        if (knows) s += 38;
        if (racingForTech(g, b, voter)) s -= 40;
        return s;
    },
    candidates: (g, _st, a) => {
        const b = peekBeaconState(g);
        if (!on(g) || b === null || b.phase !== 'watching' || lawInForce(peekDietState(g), LAW_MORATORIUM) !== null) return [];
        if (!knowsBeacon(b, a) || racingForTech(g, b, a)) return [];
        return [candidate(a, 16 + 28 * p(a).caution + 10)];
    },
});

/** Factor on an empire's research: the moratorium slows it unless the empire is a breaker. Pure. */
export function moratoriumFactor(g: Galaxy, e: Empire): number {
    const st = peekBeaconState(g);
    if (st === null || st.moratorium === undefined || lawInForce(peekDietState(g), LAW_MORATORIUM) === null) return 1;
    if (st.moratorium.breakers.includes(e.empireId)) return 1;
    return 1 - P.moratoriumPct(g) / 100;
}

/** Monthly: each breaker still breaking is in breach; the Diet answers (violation, then sanctions). */
export function moratoriumMonthly(g: Galaxy): void {
    const st = peekBeaconState(g);
    const law = lawInForce(peekDietState(g), LAW_MORATORIUM);
    if (st === null || st.moratorium === undefined || law === null) return;
    const m = st.moratorium;
    const now = galaxyStarDate(g);
    m.lastCheck = now;
    for (const id of m.breakers) {
        const e = g.empires.find((x) => x !== null && x.empireId === id);
        if (e === undefined || e === null || !e.active) continue;
        const n = (m.breaches[String(id)] = (m.breaches[String(id)] ?? 0) + 1);
        st.stats.moratoriumBreaches = (st.stats.moratoriumBreaches ?? 0) + 1;
        dietLawViolation(g, e, law);
        if (n >= P.moratoriumSanctionAfter(g) && !m.sanctioned.includes(id)) {
            m.sanctioned.push(id);
            dietSanctionOffender(g, e, scenarioText(`${TAG} Diet Moratorium Broken`));
        }
    }
}

registerScenarioQuery({ id: 'beacon.moratorium', flag: BEACON_FLAG, query: 'researchPowerFactor', run: (g, v, a) => v * moratoriumFactor(g, a.empire) });
registerScenarioPeriodic({ id: 'beacon.moratoriumMonthly', flag: BEACON_FLAG, order: 24, periodDays: 30, run: (g) => moratoriumMonthly(g) });


// --- Evacuate the worlds near the Great Work -----------------------------------------------------------------------

export const LAW_EVACUATE = 'beaconEvacuate';
export const MOTION_EVACUATE = 'beaconEvacuate';

export const EVAC = {
    /** The zone: member colonies within this many sectors of the Great Work. */
    sectors: (g: Galaxy) => Math.max(1, scenarioParam(g, 'beaconEvacSectors', 4)),
    days: (g: Galaxy) => Math.max(30, scenarioParam(g, 'beaconEvacDays', 1080)),
};

/** The evacuation may be moved: the Great Work is being built or the Beacon has not fired its first beam. Pure. */
export function evacuationWindowOpen(st: BeaconState): boolean {
    return st.phase === 'watching' || (st.phase === 'reclamation' && (st.launches ?? 0) === 0);
}

/** `h` is a member's colony inside the evacuation zone. Pure (no zone: false). */
export function inEvacuationZone(g: Galaxy, h: Habitat): boolean {
    const st = peekBeaconState(g);
    if (st === null || h.empire === null) return false;
    const pos = beaconPosition(st);
    if (pos === null) return false;
    const reach = EVAC.sectors(g) * SECTOR_SIZE;
    if (g.calculateDistanceSquared(h.xpos, h.ypos, pos.x, pos.y) > reach * reach) return false;
    return members(g).includes(h.empire);
}

/** The share of `e`'s colonies inside the zone (0 without a site). Pure. */
function zoneShare(g: Galaxy, e: Empire): number {
    if (e.colonies.length === 0) return 0;
    let n = 0;
    for (const h of e.colonies) if (inEvacuationZone(g, h)) n++;
    return n / e.colonies.length;
}

/** Each member places relocation orders for its own colonies inside the zone, the densest first (each to the nearest colony outside the zone that has room). Funds and room permitting. */
export function orderEvacuations(g: Galaxy): void {
    for (const e of members(g)) {
        if (isHumanEmpire(g, e)) continue; // a human player decides its own relocations (the colony screen's order)
        const zone = e.colonies.filter((h) => !h.hasBeenDestroyed && inEvacuationZone(g, h)).sort((a, c) => (c.population?.totalAmount ?? 0) - (a.population?.totalAmount ?? 0) || a.habitatIndex - c.habitatIndex);
        for (const h of zone) {
            const to = relocationTargets(g, e, h).find((t) => !inEvacuationZone(g, t.habitat));
            if (to !== undefined) startRelocation(g, e, h, to.habitat, to.max);
        }
    }
}

registerDietMotionKind({
    kind: MOTION_EVACUATE,
    label: 'Evacuate the worlds near the Great Work',
    needs: 'none',
    proposable: (g) => {
        const st = peekBeaconState(g);
        return on(g) && st !== null && evacuationWindowOpen(st) && beaconPosition(st) !== null && lawInForce(peekDietState(g), LAW_EVACUATE) === null;
    },
    text: () => scenarioText(`${TAG} Diet Evacuate`),
    effect: () => scenarioText(`${TAG} Diet Evacuate Effect`),
    apply: (g, _st, _m, addLaw) => {
        const b = peekBeaconState(g);
        addLaw(LAW_EVACUATE, null, null, null, galaxyStarDate(g) + EVAC.days(g) * GAME_DAY_LENGTH);
        if (b !== null) b.stats.evacuations = (b.stats.evacuations ?? 0) + 1;
        orderEvacuations(g);
        scenarioNews(g, null, scenarioText(`${TAG} Diet Evacuate News`, EVAC.sectors(g), Math.round(EVAC.days(g) / 30)));
    },
    voteScore: (g, _st, voter, m) => {
        if (voter === m.proposer) return 100;
        const b = peekBeaconState(g);
        if (b === null) return 0;
        const pr = p(voter);
        let s = 4 + 12 * pr.caution + 6 * pr.friendly - 8 * pr.aggression;
        if (knowsBeacon(b, voter)) s += 26;
        // The people to move are its own (the cost of moving them falls on the owner).
        s -= 70 * zoneShare(g, voter);
        s -= 6 * (1 - zoneShare(g, voter));
        return s;
    },
    candidates: (g, _st, a) => {
        const b = peekBeaconState(g);
        if (!on(g) || b === null || !evacuationWindowOpen(b) || beaconPosition(b) === null || lawInForce(peekDietState(g), LAW_EVACUATE) !== null) return [];
        if (!knowsBeacon(b, a) || zoneShare(g, a) > 0.3) return [];
        if (!members(g).some((e) => e !== a && zoneShare(g, e) > 0)) return [];
        return [candidate(a, 10 + 22 * p(a).caution)];
    },
});
