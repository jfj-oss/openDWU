// The Interstellar Diet: vote weights, AI votes and AI proposals (docs/CHARACTERS_AND_VICTORY.md §7.3-7.5). Not a
// port; the inputs are the real fields (Race.cs AggressionLevel / CautionLevel / FriendlinessLevel / LoyaltyLevel /
// IntelligenceLevel / TradeBonus / FreeTradeIncomeFactor / TourismIncomeFactor / MigrationFactor /
// WarWearinessAttenuation; GovernmentAttributes.cs WarWeariness / ConcernForOwnReputation /
// ImportanceOfOthersReputations / Stability / Corruption; EmpirePolicy.cs DiplomacySendGiftsUpToAmount and
// IntelligenceAllowMission*; CharacterTraitType.cs leader traits; Galaxy.1.cs 2863 CalculateEmpireScore; the
// diplomatic relations and evaluations). Everything here is pure: no Rnd, no state change.

import type { Galaxy } from '../../../galaxy';
import type { Empire } from '../../../empire';
import type { Habitat } from '../../../types';
import { DiplomaticRelationType } from '../../../diplomacy';
import { aggressionLevel, cautionLevel, friendlinessLevel, intelligenceLevel, loyaltyLevel, militaryPotency } from '../../../diplomacyTick';
import { empireGovernmentAttributes } from '../../../empire';
import { CharacterTraitType } from '../../../characters';
import { PirateRelationType } from '../../../pirateRelations';
import { calculateEmpireScore } from '../../../achievements';
import { identifyMechanoidEmpire } from '../../../fleets/militaryAI';
import { strategicValue } from '../../../territory';
import { YEAR_LENGTH } from '../../../galaxyTime';
import { galaxyStarDate } from '../../../tick/simTime';
import { isHumanEmpire } from '../../../humanEmpires';
import { empireSpyCrises } from '../../emergent/espionage';
import {
    attitudeOf,
    blocOf,
    hasMet,
    motionCandidates,
    tradeInterest,
    voteScore,
    type Council,
    type Motion,
    type MotionKind,
} from '../../emergent/council';
import { EMPEROR_AI_CHECK_CHANCE, EMPEROR_AI_CHECK_DAYS, EMPEROR_AI_LEAD_RATIO, EMPEROR_AI_MIL_RATIO, EMPEROR_AI_MIN_SHARE, type DietLaw, type DietMotion, type DietMotionKind, type DietState, STOCK_KINDS, byId, dietMotionKindDef, dietParam, dietSeatExcluded, lawInForce, registeredDietKinds } from './dietState';
import { scenarioQuery } from '../../hooks';

// ---------------------------------------------------------------------------------------------------------------
// Personality (real stats, normalised around 0)
// ---------------------------------------------------------------------------------------------------------------

export interface Personality {
    /** Race levels (50..150) as (level − 100) / 50: −1..+1. */
    aggression: number;
    caution: number;
    friendliness: number;
    loyalty: number;
    intelligence: number;
    /** Race TradeBonus / 100 (0..5), FreeTradeIncomeFactor / TourismIncomeFactor / MigrationFactor − 1, WarWearinessAttenuation / 100. */
    trade: number;
    freeTrade: number;
    tourism: number;
    migration: number;
    warWearinessAttenuation: number;
    /** Government factors − 1 (≈ −0.5..+0.6). */
    warWeariness: number;
    ownReputation: number;
    othersReputation: number;
    stability: number;
    corruption: number;
    /** Policy: gift budget (log10 scale) and the share of allowed intelligence missions (0..1). */
    gifts: number;
    spying: number;
    traits: Set<CharacterTraitType>;
}

const lvl = (v: number): number => (v - 100) / 50;

/**
 * The Diet's members: the council's members but the Ancient Guardians (the story's Mechanoids, Galaxy
 * IdentifyMechanoidEmpire), who stay out of the Diet altogether — no seat, delegate, vote or dues.
 */
export function dietMembership(galaxy: Galaxy, c: Council): Empire[] {
    const guardians = identifyMechanoidEmpire(galaxy);
    return guardians === null ? c.members : c.members.filter((m) => m !== guardians);
}

/** `e` is a member of the Diet (dietMembership). */
export function inDiet(galaxy: Galaxy, c: Council, e: Empire | null): boolean {
    return e !== null && c.members.includes(e) && e !== identifyMechanoidEmpire(galaxy);
}

export function personality(e: Empire): Personality {
    const r = e.dominantRace!;
    const gov = empireGovernmentAttributes(e);
    const p = e.policy!;
    const allowed = p === null ? 0 : [
        p.intelligenceAllowMissionSabotageConstruction,
        p.intelligenceAllowMissionStealTerritoryMap,
        p.intelligenceAllowMissionStealGalaxyMap,
        p.intelligenceAllowMissionStealOperationsMap,
        p.intelligenceAllowMissionStealTechData,
        p.intelligenceAllowMissionSabotageColony,
        p.intelligenceAllowMissionDeepCover,
        p.intelligenceAllowMissionInciteRevolution,
        p.intelligenceAllowMissionAssassinateCharacter,
        p.intelligenceAllowMissionDestroyBase,
    ].filter((x) => x).length;
    const giftBudget = p === null ? 0 : p.diplomacySendGiftsUpToAmount;
    const leader = e.leader;
    return {
        aggression: lvl(aggressionLevel(e)),
        caution: lvl(cautionLevel(e)),
        friendliness: lvl(friendlinessLevel(e)),
        loyalty: lvl(loyaltyLevel(e)),
        intelligence: lvl(intelligenceLevel(e)),
        trade: Math.min(5, (r.tradeBonus ?? 0) / 100),
        freeTrade: (r.freeTradeIncomeFactor ?? 1) - 1,
        tourism: (r.tourismIncomeFactor ?? 1) - 1,
        migration: (r.migrationFactor ?? 1) - 1,
        warWearinessAttenuation: (r.warWearinessAttenuation ?? 0) / 100,
        warWeariness: (gov?.warWeariness ?? 1) - 1,
        ownReputation: (gov?.concernForOwnReputation ?? 1) - 1,
        othersReputation: (gov?.importanceOfOthersReputations ?? 1) - 1,
        stability: (gov?.stability ?? 1) - 1,
        corruption: (gov?.corruption ?? 1) - 1,
        gifts: Math.log10(1 + Math.max(0, giftBudget ?? 0)) / 6,
        spying: allowed / 10,
        traits: new Set(leader !== null && leader.active ? leader.traits : []),
    };
}

const has = (p: Personality, t: CharacterTraitType): number => (p.traits.has(t) ? 1 : 0);

function relType(a: Empire, b: Empire): DiplomaticRelationType {
    const r = a.diplomaticRelations?.byEmpire(b) ?? null;
    return r === null ? DiplomaticRelationType.NotMet : r.type;
}

export function atWar(a: Empire, b: Empire): boolean {
    return relType(a, b) === DiplomaticRelationType.War;
}

// ---------------------------------------------------------------------------------------------------------------
// Vote weights: size and strength (CalculateEmpireScore), standing (relations), gifts and spies
// ---------------------------------------------------------------------------------------------------------------

export interface WeightParts {
    base: number;
    standing: number;
    gifts: number;
    spies: number;
    lesser: number;
    weight: number;
}

/** Galaxy.1.cs 2863 CalculateEmpireScore of each member (one call per member and use). */
export function memberScores(galaxy: Galaxy, members: readonly Empire[]): Map<Empire, number> {
    const m = new Map<Empire, number>();
    for (const e of members) m.set(e, Math.max(1, calculateEmpireScore(galaxy, e).score));
    return m;
}

/**
 * A member's vote weight: 10 × √(score / mean member score) × (1 + standing + gifts + spies) × the lesser-delegate
 * factor. Standing: the other members' mean attitude to it / 200 (±0.25). Gifts: the share of members it gave a gift
 * to in the last two years × 0.25. Spies: its successful intelligence missions against members (decaying) × 0.05, at
 * most 0.25.
 */
export function voteWeight(galaxy: Galaxy, st: DietState, members: readonly Empire[], scores: Map<Empire, number>, e: Empire, lesser: boolean): WeightParts {
    let total = 0;
    for (const m of members) total += scores.get(m) ?? 1;
    const mean = members.length > 0 ? total / members.length : 1;
    const base = 10 * Math.sqrt((scores.get(e) ?? 1) / Math.max(1, mean));
    const others = members.filter((m) => m !== e);
    const now = galaxyStarDate(galaxy);
    let att = 0;
    let gifts = 0;
    let spies = 0;
    for (const m of others) {
        att += attitudeOf(m, e);
        const r = e.diplomaticRelations?.byEmpire(m) ?? null;
        if (r !== null && r.lastGiftDate > 0 && now - r.lastGiftDate <= 2 * YEAR_LENGTH) gifts++;
        spies += st.spies[`${e.empireId}:${m.empireId}`] ?? 0;
    }
    const standing = others.length > 0 ? Math.max(-0.25, Math.min(0.25, att / others.length / 200)) : 0;
    const g = others.length > 0 ? (0.25 * gifts) / others.length : 0;
    const s = Math.min(0.25, spies * 0.05);
    const lesserF = lesser ? dietParam(galaxy, 'dietLesserDelegatePct') / 100 : 1;
    // [colonyEconomy] Senate Hall: a factor on the weight (1 without the add-on).
    const econ = scenarioQuery(galaxy, 'dietVoteWeightFactor', 1, { empire: e });
    const weight = Math.round(base * (1 + standing + g + s) * lesserF * econ * 10) / 10;
    return { base, standing, gifts: g, spies: s, lesser: lesserF, weight: Math.max(0.1, weight) };
}

// ---------------------------------------------------------------------------------------------------------------
// AI vote = the motion's effect on the voter's empire + personality
// ---------------------------------------------------------------------------------------------------------------

/** The council.ts Motion shape of a stock-kind Diet motion (voteScore / applyMotion / recordLosses take it). */
export function asCouncilMotion(m: DietMotion, year: number, starDate: number): Motion {
    return {
        id: m.id,
        kind: m.kind as MotionKind,
        proposer: m.proposer,
        target: m.target ?? m.proposer,
        other: m.other,
        resourceId: m.resourceId,
        text: m.text,
        year,
        proposedStarDate: starDate,
        status: 'voting',
        votes: m.votes.map((v) => ({ empire: v.empire, vote: v.vote, score: v.score, coordinated: false })),
        decisionId: 0,
    };
}

/** Pirates attacking `e` lately (the Diet's raid record). */
function raidsOn(st: DietState, pirate: Empire, e: Empire): number {
    return st.raids?.[`${pirate.empireId}:${e.empireId}`] ?? 0;
}

function hasPlanetDestroyers(e: Empire): boolean {
    return e.planetDestroyers.length > 0;
}

/** Independent colonies `e` could take: in its colonisation targets. */
function eyesIndependents(galaxy: Galaxy, e: Empire): number {
    let n = 0;
    for (const t of e.colonizationTargets ?? []) if (t?.habitat?.empire === galaxy.independentEmpire) n++;
    return Math.min(5, n);
}

/**
 * The voter's score on a Diet motion (≥ +5 yes, ≤ −5 no, else abstain, as the council's councilVoteThreshold). The
 * stock kinds start from the galactic council's own voteScore (attitude, trade, borders, war, blocs, extensions).
 */
export function dietVoteScore(galaxy: Galaxy, c: Council, st: DietState, voter: Empire, m: DietMotion): number {
    const p = personality(voter);
    const t = m.target;
    if (m.kind === 'repeal') {
        const law = st.laws.find((l) => l.id === m.resourceId) ?? null;
        return law === null ? 0 : -lawScore(galaxy, c, st, voter, law, p);
    }
    if (STOCK_KINDS.has(m.kind)) {
        const now = galaxyStarDate(galaxy);
        let s = voteScore(galaxy, c, voter, asCouncilMotion(m, 0, now));
        const hostile = m.kind !== 'lift' && m.kind !== 'recognise';
        if (t !== null && voter !== t && voter !== m.proposer) {
            const sign = hostile ? 1 : -1;
            // Personality: aggressive and reputation-minded governments punish; diplomats, free traders and the friendly hesitate.
            s += sign * (10 * (p.aggression - p.friendliness) + 15 * p.othersReputation + 5 * has(p, CharacterTraitType.Paranoid) - 5 * has(p, CharacterTraitType.Diplomat) - 5 * has(p, CharacterTraitType.Trusting));
            if (m.kind === 'sanction' || m.kind === 'embargo') s += sign * (5 * has(p, CharacterTraitType.Protectionist) - 10 * has(p, CharacterTraitType.FreeTrader) - 8 * p.trade);
            // Crimes and defiance weigh on everyone (the Diet's grievance record).
            s += sign * Math.min(40, (st.grievances[t.empireId] ?? 0) / 2);
        }
        return s;
    }
    if (voter === m.proposer && m.kind !== 'expel') return 100;
    switch (m.kind) {
        case 'truce': {
            const a = t!;
            const b = m.other!;
            if (voter === a || voter === b) {
                const enemy = voter === a ? b : a;
                const ratio = Math.max(1, militaryPotency(voter)) / Math.max(1, militaryPotency(enemy));
                return (ratio < 1 ? 30 : -15) + 30 * p.warWeariness - 25 * p.warWearinessAttenuation - 20 * p.aggression + 15 * has(p, CharacterTraitType.Pacifist) - 10 * has(p, CharacterTraitType.PeaceThroughStrength);
            }
            return 10 + 15 * p.friendliness - 15 * p.aggression + 10 * has(p, CharacterTraitType.Pacifist) + 0.2 * (Math.max(attitudeOf(voter, a), attitudeOf(voter, b))) - (atWar(voter, a) || atWar(voter, b) ? 20 : 0);
        }
        case 'freeTrade':
            return 14 + 40 * p.freeTrade + 15 * p.trade + 25 * has(p, CharacterTraitType.FreeTrader) - 25 * has(p, CharacterTraitType.Protectionist) - 15 * has(p, CharacterTraitType.Isolationist) - 10 * has(p, CharacterTraitType.Xenophobic) + 5 * has(p, CharacterTraitType.Tolerant) - 5 * dietMembership(galaxy, c).filter((x) => x !== voter && atWar(voter, x)).length;
        case 'banPlanetDestroyers':
            return 10 + 15 * p.caution - 15 * p.aggression + 15 * has(p, CharacterTraitType.Pacifist) + 10 * p.othersReputation - (hasPlanetDestroyers(voter) ? 45 : 0) + (dietMembership(galaxy, c).some((x) => x !== voter && hasPlanetDestroyers(x)) ? 15 : 0);
        case 'banBombard':
            return 5 + 10 * p.friendliness - 15 * p.aggression + 10 * p.othersReputation + ((voter.policy?.warAttacksAllowColonyBombardment ?? 0) >= 2 ? -20 : 8) + 10 * has(p, CharacterTraitType.Pacifist);
        case 'outlawPirates': {
            const pr = voter.pirateRelations?.getRelationByOtherEmpire(t!) ?? null;
            const protectedBy = pr !== null && pr.type === PirateRelationType.Protection;
            return 12 + 10 * p.caution + Math.min(40, 4 * raidsOn(st, t!, voter)) - (protectedBy ? 40 : 0) + 5 * p.aggression - 10 * has(p, CharacterTraitType.Paranoid) - 10 * has(p, CharacterTraitType.Isolationist);
        }
        case 'protectIndependents':
            return 15 * p.friendliness - 20 * p.aggression + 10 * has(p, CharacterTraitType.Tolerant) - 15 * has(p, CharacterTraitType.Expansionist) - 6 * eyesIndependents(galaxy, voter) + 5 * p.othersReputation;
        case 'openIndependents':
            return 20 * p.aggression - 10 * p.friendliness + 15 * has(p, CharacterTraitType.Expansionist) - 5 * has(p, CharacterTraitType.Tolerant) + 6 * eyesIndependents(galaxy, voter);
        case 'claim': {
            const owner = m.colony?.empire ?? null;
            if (owner === voter) return -100;
            if (owner === null) return 0;
            let s = 0.4 * attitudeOf(voter, m.proposer) - 0.4 * attitudeOf(voter, owner) - 10 * p.othersReputation + 5 * p.aggression;
            if (atWar(voter, owner)) s += 20;
            const rt = relType(voter, owner);
            if (rt === DiplomaticRelationType.MutualDefensePact || rt === DiplomaticRelationType.Protectorate) s -= 30;
            return s;
        }
        case 'expel': {
            if (voter === t) return -100;
            if (voter === m.proposer) return 100;
            return -0.5 * attitudeOf(voter, t!) + 0.3 * attitudeOf(voter, m.proposer) + Math.min(40, (st.grievances[t!.empireId] ?? 0) / 2) + 10 * p.othersReputation - 10 * p.loyalty - (blocOf(c, voter)?.members.includes(t!) ? 25 : 0) - 10;
        }
        case 'regent': {
            if (voter === t) return 100;
            const scores = memberScores(galaxy, dietMembership(galaxy, c));
            let total = 0;
            for (const v of scores.values()) total += v;
            const share = (scores.get(t!) ?? 0) / Math.max(1, total);
            // The seat must be filled (+10); only a dominant candidate (over 35 % of the score) is feared.
            return 10 + (t === st.host ? 10 : 0) + 0.5 * attitudeOf(voter, t!) + 0.5 * tradeInterest(voter, t!) - (share > 0.35 ? 15 * (p.caution + 0.5) : 0) + 5 * has(p, CharacterTraitType.Trusting) - 10 * has(p, CharacterTraitType.Paranoid) + (blocOf(c, voter)?.members.includes(t!) ? 20 : 0) - (atWar(voter, t!) ? 60 : 0);
        }
        default: {
            const def = dietMotionKindDef(m.kind);
            return def !== null ? def.voteScore(galaxy, st, voter, m) : 0;
        }
    }
}

/** How much `voter` likes law `law` staying in force (the score it would give the motion that made it). */
function lawScore(galaxy: Galaxy, c: Council, st: DietState, voter: Empire, law: DietLaw, p: Personality): number {
    void p;
    const pseudo: DietMotion = { id: -1, kind: law.kind, proposer: law.empire ?? voter, target: law.kind === 'outlawPirates' || law.kind === 'truce' ? law.empire : law.kind === 'claim' ? law.empire : null, other: law.other, colony: law.colony, resourceId: -1, text: '', votes: [], status: 'voting', yes: 0, no: 0 };
    if (law.kind === 'claim' && law.empire === voter) return 100;
    return dietVoteScore(galaxy, c, st, voter, pseudo);
}

// ---------------------------------------------------------------------------------------------------------------
// AI proposals: every member moves what serves it
// ---------------------------------------------------------------------------------------------------------------

export interface DietCandidate {
    kind: DietMotionKind;
    proposer: Empire;
    target: Empire | null;
    other: Empire | null;
    colony: Habitat | null;
    resourceId: number;
    weight: number;
}

function normalEmpireForDiet(galaxy: Galaxy, e: Empire | null): e is Empire {
    return e !== null && e.active && e !== galaxy.independentEmpire && e.pirateEmpireBaseHabitat === null && e.dominantRace !== null;
}

/** The candidate motions of member `a` (the stock grievances through council.ts motionCandidates, then the Diet's own). */
export function memberCandidates(galaxy: Galaxy, c: Council, st: DietState, a: Empire, stock: readonly { kind: MotionKind; proposer: Empire; target: Empire; other: Empire | null; resourceId: number; weight: number }[]): DietCandidate[] {
    const out: DietCandidate[] = [];
    for (const s of stock) {
        if (s.proposer !== a) continue;
        // A recognised claim blocks condemnations of the claimant's war on the colony's owner (§7.4).
        if (s.kind === 'condemn' && st.laws.some((l) => l.kind === 'claim' && l.empire === s.target && l.other === s.other)) continue;
        out.push({ kind: s.kind, proposer: a, target: s.target, other: s.other, colony: null, resourceId: s.resourceId, weight: s.weight });
    }
    const p = personality(a);
    const members = dietMembership(galaxy, c);
    // Crimes, defiance and violations: an automatic sanction case against the offender.
    for (const e of members) {
        if (e === a) continue;
        const g = st.grievances[e.empireId] ?? 0;
        if (g >= 30 && !c.sanctions.some((x) => x.target === e && x.kind === 'sanction')) out.push({ kind: 'sanction', proposer: a, target: e, other: null, colony: null, resourceId: -1, weight: 60 + g / 2 });
        if (g >= 80 && st.expelled[e.empireId] === undefined) out.push({ kind: 'expel', proposer: a, target: e, other: null, colony: null, resourceId: -1, weight: 30 + g / 4 });
    }
    // Truce: a member losing a war with another member.
    for (const e of members) {
        if (e === a || !atWar(a, e) || lawInForce(st, 'truce', a) !== null) continue;
        const ratio = Math.max(1, militaryPotency(a)) / Math.max(1, militaryPotency(e));
        if (ratio < 0.8 || p.warWeariness > 0.2) out.push({ kind: 'truce', proposer: a, target: a, other: e, colony: null, resourceId: -1, weight: 45 + 20 * (1 - Math.min(1, ratio)) });
    }
    const mk = (kind: DietMotionKind, target: Empire | null = null): DietMotion => ({ id: -1, kind, proposer: a, target, other: null, colony: null, resourceId: -1, text: '', votes: [], status: 'voting', yes: 0, no: 0 });
    // Galaxy-wide measures, moved when this member's own case for them is strong.
    const self = (kind: DietMotionKind, target: Empire | null = null): number => {
        const m = mk(kind, target);
        // The proposer's own interest, without the "proposer votes yes" shortcut.
        const pseudo = { ...m, proposer: members.find((x) => x !== a) ?? a };
        return dietVoteScore(galaxy, c, st, a, pseudo);
    };
    if (lawInForce(st, 'freeTrade') === null) {
        const s = self('freeTrade');
        if (s >= 18) out.push({ kind: 'freeTrade', proposer: a, target: null, other: null, colony: null, resourceId: -1, weight: 15 + s / 3 });
    }
    if (lawInForce(st, 'banPlanetDestroyers') === null && !hasPlanetDestroyers(a) && members.some((x) => x !== a && hasPlanetDestroyers(x))) {
        const s = self('banPlanetDestroyers');
        if (s >= 15) out.push({ kind: 'banPlanetDestroyers', proposer: a, target: null, other: null, colony: null, resourceId: -1, weight: 35 + s / 4 });
    }
    if (lawInForce(st, 'banBombard') === null) {
        const bombed = st.bombarded?.[a.empireId] ?? 0;
        const s = self('banBombard');
        if (bombed > 0 || s >= 18) out.push({ kind: 'banBombard', proposer: a, target: null, other: null, colony: null, resourceId: -1, weight: (bombed > 0 ? 40 : 12) + s / 4 });
    }
    for (const pirate of galaxy.pirateEmpires) {
        if (pirate === null || !pirate.active || lawInForce(st, 'outlawPirates', pirate) !== null) continue;
        const raids = raidsOn(st, pirate, a);
        if (raids < 3) continue;
        const s = self('outlawPirates', pirate);
        if (s >= 15) out.push({ kind: 'outlawPirates', proposer: a, target: pirate, other: null, colony: null, resourceId: -1, weight: 25 + Math.min(30, raids * 2) });
    }
    const protect = lawInForce(st, 'protectIndependents');
    const open = lawInForce(st, 'openIndependents');
    if (protect === null) {
        const s = self('protectIndependents');
        if (s >= 15) out.push({ kind: 'protectIndependents', proposer: a, target: null, other: null, colony: null, resourceId: -1, weight: 12 + s / 4 });
    }
    if (open === null) {
        const s = self('openIndependents');
        if (s >= 15) out.push({ kind: 'openIndependents', proposer: a, target: null, other: null, colony: null, resourceId: -1, weight: (protect !== null ? 25 : 10) + s / 4 });
    }
    // A claim: a colony of a disliked or warring neighbour that lies inside our territory.
    if (!st.laws.some((l) => l.kind === 'claim' && l.empire === a)) {
        let best: Habitat | null = null;
        let bv = 0;
        for (const e of galaxy.empires) {
            if (!normalEmpireForDiet(galaxy, e) || e === a || !hasMet(a, e)) continue;
            if (!(atWar(a, e) || attitudeOf(a, e) <= -30)) continue;
            for (const h of e.colonies) {
                if (galaxy.checkEmpireTerritoryIdAtLocation(h.xpos, h.ypos) !== a.empireId) continue;
                const v = strategicValue(h);
                if (v > bv || (v === bv && best !== null && h.habitatIndex < best.habitatIndex)) {
                    bv = v;
                    best = h;
                }
            }
        }
        if (best !== null) out.push({ kind: 'claim', proposer: a, target: best.empire, other: null, colony: best, resourceId: -1, weight: 28 + 10 * p.aggression });
    }
    // The Regent: the strongest members put themselves forward when the seat is empty or its term ends.
    const now = galaxyStarDate(galaxy);
    if (st.regent === null || !st.regent.active || now >= st.regentUntil || !members.includes(st.regent)) {
        const scores = memberScores(galaxy, members);
        // The Ancient Guardians (the story's Mechanoids) never stand for the Regency.
        const guardians = identifyMechanoidEmpire(galaxy);
        const ranked = [...members].filter((x) => x !== guardians && !dietSeatExcluded(galaxy, x)).sort((x, y) => (scores.get(y) ?? 0) - (scores.get(x) ?? 0) || byId(x, y));
        // An empty seat is the Diet's first business: it outweighs the members' other cases.
        if (ranked.indexOf(a) >= 0 && ranked.indexOf(a) < 2) out.push({ kind: 'regent', proposer: a, target: a, other: null, colony: null, resourceId: -1, weight: 85 + 10 * p.aggression - 5 * ranked.indexOf(a) });
    }
    // Registered kinds (other add-ons' motions).
    for (const def of registeredDietKinds()) if (def.candidates !== undefined) out.push(...def.candidates(galaxy, st, a));
    // Repeal what hurts us.
    for (const law of st.laws) {
        if (law.kind === 'truce') continue;
        const s = lawScore(galaxy, c, st, a, law, p);
        if (s <= -30) out.push({ kind: 'repeal', proposer: a, target: null, other: null, colony: null, resourceId: law.id, weight: 20 + Math.min(30, -s / 3) });
    }
    return out;
}

/** Every AI member's candidates, best first (ties by proposer / target id, kind). */
export function dietCandidates(galaxy: Galaxy, c: Council, st: DietState, year: number): DietCandidate[] {
    const stock = motionCandidates(galaxy, c, year);
    const out: DietCandidate[] = [];
    for (const a of [...dietMembership(galaxy, c)].sort(byId)) {
        if (isHumanEmpire(galaxy, a) || st.expelled[a.empireId] !== undefined) continue;
        out.push(...memberCandidates(galaxy, c, st, a, stock));
    }
    out.sort((x, y) => y.weight - x.weight || byId(x.proposer, y.proposer) || (x.target?.empireId ?? -1) - (y.target?.empireId ?? -1) || (x.kind < y.kind ? -1 : x.kind > y.kind ? 1 : 0));
    return out;
}

/** The AI member's personal emergency case: its heaviest own candidate when ≥ 60 (a crime, a spy crisis, a war on it). */
export function emergencyCase(galaxy: Galaxy, c: Council, st: DietState, a: Empire, year: number): DietCandidate | null {
    const own = memberCandidates(galaxy, c, st, a, motionCandidates(galaxy, c, year)).filter((x) => x.kind !== 'regent' && x.kind !== 'repeal');
    own.sort((x, y) => y.weight - x.weight || (x.target?.empireId ?? -1) - (y.target?.empireId ?? -1));
    const best = own[0] ?? null;
    if (best === null || best.weight < 60) return null;
    // A spy crisis or war against us is a fair emergency; plain dislike is not.
    if (best.kind === 'sanction' && best.target !== null && (st.grievances[best.target.empireId] ?? 0) < 30 && !empireSpyCrises(galaxy, a).some((cr) => cr.offender === best.target)) return null;
    return best;
}

/** The empires that count in the race for the throne: the active major empires (no independents, pirates, enforcers, the Guardians). */
export function emperorContenders(galaxy: Galaxy, st: DietState): Empire[] {
    const guardians = identifyMechanoidEmpire(galaxy);
    return galaxy.empires.filter((x): x is Empire => x !== null && x.active && x !== galaxy.independentEmpire && x.pirateEmpireBaseHabitat === null && x.dominantRace !== null && x !== st.faction && x !== guardians);
}

/** Game years since the game began (a bid opens at dietEmperorMinYear). */
export function emperorYearsElapsed(galaxy: Galaxy): number {
    return galaxy.nowMs / YEAR_LENGTH;
}

/** Deterministic roll in [0, 1) from the galaxy seed, an empire and a time slot: no draw from the game's random stream. */
function bidRoll(galaxy: Galaxy, e: Empire, slot: number): number {
    let h = (Math.imul(galaxy.randomSeed | 0, 0x9e3779b1) ^ Math.imul(e.empireId + 1, 0x85ebca6b) ^ Math.imul(slot + 7, 0xc2b2ae35)) | 0;
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * The AI Regent's Emperor bid: only from year dietEmperorMinYear, with a Regent who holds its capital, has not failed a
 * bid lately, is not a pacifist, and is overwhelmingly ahead: its score is at least EMPEROR_AI_LEAD_RATIO times the next
 * empire's and EMPEROR_AI_MIN_SHARE of the whole galaxy's, its military EMPEROR_AI_MIL_RATIO times the next's. Even then
 * it only rolls EMPEROR_AI_CHECK_CHANCE once per EMPEROR_AI_CHECK_DAYS.
 */
export function wantsEmperorBid(galaxy: Galaxy, c: Council, st: DietState, regent: Empire): boolean {
    return emperorBidBlock(galaxy, c, st, regent) === '';
}

/** Why the AI Regent does not bid now ('' = it bids). Pure. */
export function emperorBidBlock(galaxy: Galaxy, c: Council, st: DietState, regent: Empire): string {
    void c;
    const early = emperorBidBlockHard(galaxy, st, regent);
    if (early !== '') return early;
    const rivals = emperorContenders(galaxy, st);
    if (!rivals.includes(regent)) return 'notContender';
    const scores = memberScores(galaxy, rivals);
    let total = 0;
    let nextScore = 1;
    let nextMil = 1;
    for (const m of rivals) {
        const v = scores.get(m) ?? 0;
        total += v;
        if (m !== regent) {
            nextScore = Math.max(nextScore, v);
            nextMil = Math.max(nextMil, militaryPotency(m));
        }
    }
    const mine = scores.get(regent) ?? 0;
    if (mine < EMPEROR_AI_LEAD_RATIO * nextScore) return 'notFarAhead';
    if (mine / Math.max(1, total) < EMPEROR_AI_MIN_SHARE) return 'smallShare';
    if (militaryPotency(regent) < EMPEROR_AI_MIL_RATIO * nextMil) return 'weakMilitary';
    const p = personality(regent);
    if (has(p, CharacterTraitType.Pacifist) > 0 || p.aggression + 0.5 * has(p, CharacterTraitType.Expansionist) < -0.8) return 'peaceful';
    const slot = Math.floor(galaxyStarDate(galaxy) / (EMPEROR_AI_CHECK_DAYS * (YEAR_LENGTH / 360)));
    if (bidRoll(galaxy, regent, slot) >= EMPEROR_AI_CHECK_CHANCE) return 'reluctant';
    return '';
}

/** The rules every bidder (player or AI) meets: not before year dietEmperorMinYear, a capital, no failed bid in the last ten years. */
export function emperorBidBlockHard(galaxy: Galaxy, st: DietState, e: Empire): string {
    if (emperorYearsElapsed(galaxy) < dietParam(galaxy, 'dietEmperorMinYear')) return 'tooEarly';
    if (st.world === null) return 'notHost';
    if (e.capital === null || e.capital.empire !== e) return 'noCapital';
    const failed = st.emperorFailedAt?.[e.empireId];
    if (failed !== undefined && galaxyStarDate(galaxy) - failed < 10 * YEAR_LENGTH) return 'failedRecently';
    return '';
}

/** An AI member attacks an enemy member's delegate: aggressive, careless of its reputation, at war with the delegate's empire. */
export function attacksDelegates(e: Empire): boolean {
    const p = personality(e);
    return p.aggression - p.caution > 0.1 && p.ownReputation <= 0.1;
}
