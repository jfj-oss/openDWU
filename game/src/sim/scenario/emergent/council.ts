// 19d8 — Galactic institutions: a council of empires votes sanctions / embargoes / condemnations each year, and the
// outvoted drift into blocs (tasks/19-mod-layer-scenarios.md §19d item 8). Not a port: a scenario package on the mod
// layer (tasks/MODLAYER-DESIGN.md), gated by the scenario flag `galacticCouncil` (scenario `galactic-council`).
//
// Every effect goes through the ported diplomacy: trade sanctions via StartTradeSanctions (Empire.8.cs 1586) for AI
// members and the player's TRADESANCTIONS_IMPOSE path (Main.Part10.cs 4591: ChangeDiplomaticRelation → TradeSanctions),
// lifting via EndTradeSanctions (Empire.8.cs 1623) / TRADESANCTIONS_LIFT (Main.Part10.cs 4609); the embargo of restricted
// resources via the relation's SupplyRestrictedResources switch as CheckCancelRestrictedResourceTrading
// (Empire.8.cs 1712); attitude changes on EmpireEvaluation.IncidentEvaluation (EmpireEvaluation.cs 185, as
// StartTradeSanctions' `-20`), the aggressor's reputation via the CivilityRating setter (Empire.cs 1430); trade
// interest as CalculateTradeVolume (Empire.7.cs 2905); recognition introduces unmet members as Start.2.cs 1376-1427
// (NotMet → None on both sides).
//
// Rnd: none. Every rule is deterministic (ties by empireId), so the package never touches galaxy.rnd.
//
// State: scenarioState(galaxy, 'council') — plain objects holding Empire graph references (saved as-is).

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import {
    DiplomaticRelation,
    DiplomaticRelationType,
    empireEvaluationByEmpire,
    empireEvaluationsOf,
    obtainDiplomaticRelation,
    obtainEmpireEvaluation,
} from '../../diplomacy';
import {
    aggressionLevel,
    cautionLevel,
    changeDiplomaticRelation,
    determineResourcesEmpireSupplies,
    endTradeSanctions,
    friendlinessLevel,
    setCivilityRating,
    startTradeSanctions,
} from '../../diplomacyTick';
import { EmpireMessageType, sendMessageToEmpire } from '../../messages';
import { galaxyStarDate } from '../../tick/simTime';
import { GAME_DAY_LENGTH, gameYear, registerScenarioYearly } from '../hooks';
import { scenarioFlag, scenarioParam, scenarioState } from '../state';
import { scenarioMessage, scenarioNews } from '../messages';
import { noteVoiceCue, voicesOn } from '../llm/voiceCues';
import { raiseScenarioDecision, registerScenarioDecision, type ScenarioDecision } from '../decisions';
import { empireSpyCrises } from './espionage';
import { peekPoliticsState } from './politics';
import { allCharters } from '../charteredCompanies/charters';

export const COUNCIL_FLAG = 'galacticCouncil';
export const COUNCIL_VOTE_DECISION = 'council.vote';
export const COUNCIL_LEAVE_DECISION = 'council.leave';

// ---------------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------------

export type MotionKind = 'sanction' | 'embargo' | 'condemn' | 'lift' | 'recognise' | 'threat';
export type Vote = 'yes' | 'no' | 'abstain';

export interface CouncilVote {
    empire: Empire;
    vote: Vote;
    /** The voter's own score (before bloc coordination). */
    score: number;
    /** True when the bloc line replaced the voter's own choice. */
    coordinated: boolean;
}

export interface Motion {
    id: number;
    kind: MotionKind;
    proposer: Empire;
    target: Empire;
    /** condemn: the victim of the war; otherwise the member whose grievance raised it (or null). */
    other: Empire | null;
    /** embargo: the restricted resource named in the motion (-1 = none). */
    resourceId: number;
    text: string;
    year: number;
    proposedStarDate: number;
    status: 'voting' | 'passed' | 'failed';
    votes: CouncilVote[];
    /** The player's pending vote decision id (0 = none). */
    decisionId: number;
}

export interface MotionResult {
    motionId: number;
    year: number;
    kind: MotionKind;
    text: string;
    passed: boolean;
    yes: number;
    no: number;
    abstain: number;
    proposer: Empire;
    target: Empire;
}

export interface Bloc {
    id: number;
    name: string;
    founder: Empire;
    members: Empire[];
    formedYear: number;
    /** Years the bloc has held (hardening). */
    hardness: number;
}

export interface CouncilSanction {
    target: Empire;
    kind: 'sanction' | 'embargo';
    resourceId: number;
    year: number;
}

export interface Council {
    id: number;
    name: string;
    foundedYear: number;
    members: Empire[];
    chair: Empire | null;
    motion: Motion | null;
    /** Resolved motions, oldest first (last 20). */
    results: MotionResult[];
    blocs: Bloc[];
    /** "loserIdA:loserIdB" (ascending ids) → motions both ended on the losing side of. */
    coLosses: Record<string, number>;
    /** empireId → motions lost (UI). */
    losses: Record<number, number>;
    sanctions: CouncilSanction[];
    threats: Empire[];
    recognised: Empire[];
    /** empireId → game year of the last condemnation. */
    condemned: Record<number, number>;
    /** Council this one split from (0 = none). */
    splitFrom: number;
}

export interface CouncilState {
    councils: Council[];
    nextId: number;
    /** empireId → game year it left a council. */
    leftYear: Record<number, number>;
}

export function councilState(galaxy: Galaxy): CouncilState {
    return scenarioState<CouncilState>(galaxy, 'council', () => ({ councils: [], nextId: 1, leftYear: {} }));
}

/** The state without creating it (UI / accessors). */
export function peekCouncilState(galaxy: Galaxy): CouncilState | null {
    const s = galaxy.scenario;
    if (s === null || !('council' in s.state)) return null;
    return s.state.council as CouncilState;
}

export function councilOn(galaxy: Galaxy | null): boolean {
    return galaxy !== null && scenarioFlag(galaxy, COUNCIL_FLAG);
}

// ---------------------------------------------------------------------------------------------------------------
// Params
// ---------------------------------------------------------------------------------------------------------------

const P = {
    foundingMembers: (g: Galaxy) => Math.max(2, Math.trunc(scenarioParam(g, 'councilFoundingMembers', 3))),
    joinThreshold: (g: Galaxy) => scenarioParam(g, 'councilJoinThreshold', 60),
    leaveThreshold: (g: Galaxy) => scenarioParam(g, 'councilLeaveThreshold', 10),
    rejoinYears: (g: Galaxy) => scenarioParam(g, 'councilRejoinYears', 5),
    leavePenalty: (g: Galaxy) => scenarioParam(g, 'councilLeavePenalty', 10),
    voteDays: (g: Galaxy) => scenarioParam(g, 'councilVoteDays', 60),
    voteThreshold: (g: Galaxy) => scenarioParam(g, 'councilVoteThreshold', 5),
    grievanceAttitude: (g: Galaxy) => scenarioParam(g, 'councilGrievanceAttitude', -40),
    embargoAttitude: (g: Galaxy) => scenarioParam(g, 'councilEmbargoAttitude', -20),
    condemnPenalty: (g: Galaxy) => scenarioParam(g, 'councilCondemnPenalty', 15),
    sanctionMinYears: (g: Galaxy) => scenarioParam(g, 'councilSanctionMinYears', 3),
    blocLosses: (g: Galaxy) => scenarioParam(g, 'councilBlocLosses', 3),
    blocVoteWeight: (g: Galaxy) => scenarioParam(g, 'councilBlocVoteWeight', 20),
    blocAttitudeBonus: (g: Galaxy) => scenarioParam(g, 'councilBlocAttitudeBonus', 3),
    blocCoordinationYears: (g: Galaxy) => scenarioParam(g, 'councilBlocCoordinationYears', 2),
    splitYears: (g: Galaxy) => scenarioParam(g, 'councilSplitYears', 6),
    threatBonus: (g: Galaxy) => scenarioParam(g, 'councilThreatBonus', 5),
};

// ---------------------------------------------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------------------------------------------

const byId = (a: Empire, b: Empire): number => a.empireId - b.empireId;
const nowYear = (galaxy: Galaxy): number => gameYear(galaxyStarDate(galaxy));

/** A normal, active empire (not a pirate faction, not the independents). */
export function isCouncilEmpire(galaxy: Galaxy, e: Empire | null): e is Empire {
    return e !== null && e !== galaxy.independentEmpire && e.pirateEmpireBaseHabitat === null && e.active;
}

/** `a` has met `b` (a relation other than NotMet), without creating a relation. */
export function hasMet(a: Empire, b: Empire): boolean {
    if (a === b) return true;
    const r = a.diplomaticRelations?.byEmpire(b) ?? null;
    return r !== null && r.type !== DiplomaticRelationType.NotMet;
}

function relType(a: Empire, b: Empire): DiplomaticRelationType {
    const r = a.diplomaticRelations?.byEmpire(b) ?? null;
    return r === null ? DiplomaticRelationType.NotMet : r.type;
}

/** a's overall attitude to b from an existing evaluation (0 when none; never creates one). */
export function attitudeOf(a: Empire, b: Empire): number {
    if (a === b) return 0;
    const ev = empireEvaluationByEmpire(empireEvaluationsOf(a), b);
    return ev === null ? 0 : ev.overallAttitude;
}

/** IncidentEvaluation change of a's evaluation of b (as StartTradeSanctions' `IncidentEvaluation = raw - 20`). */
function addIncident(galaxy: Galaxy, a: Empire, b: Empire, delta: number): void {
    if (a === b || a.pirateEmpireBaseHabitat !== null || b.pirateEmpireBaseHabitat !== null) return;
    const ev = obtainEmpireEvaluation(galaxy, a, b);
    ev.incidentEvaluation = ev.incidentEvaluationRaw + delta;
}

/** Empire.7.cs 2905 CalculateTradeVolume: min(25, trunc(NormalizedAnnualTradeValue / 4000)) (0 without a relation). */
export function tradeInterest(a: Empire, b: Empire): number {
    const r = a.diplomaticRelations?.byEmpire(b) ?? null;
    return r === null ? 0 : Math.min(25, Math.trunc(r.normalizedAnnualTradeValue / 4000.0));
}

/** Shared-border pressure: the (negative) SystemCompetition of a's evaluation of b, as a positive number. */
export function borderPressure(a: Empire, b: Empire): number {
    const ev = empireEvaluationByEmpire(empireEvaluationsOf(a), b);
    return ev === null ? 0 : Math.max(0, -ev.systemCompetition);
}

/** Traits: friendliness + caution − aggression (Race.cs 350-400 levels). AI empires join when ≥ councilJoinThreshold. */
export function joinScore(e: Empire): number {
    return friendlinessLevel(e) + cautionLevel(e) - aggressionLevel(e);
}

export function councilOf(galaxy: Galaxy, e: Empire): Council | null {
    return peekCouncilState(galaxy)?.councils.find((c) => c.members.includes(e)) ?? null;
}

export function blocOf(c: Council, e: Empire): Bloc | null {
    return c.blocs.find((b) => b.members.includes(e)) ?? null;
}

function pairKey(a: Empire, b: Empire): string {
    return a.empireId < b.empireId ? `${a.empireId}:${b.empireId}` : `${b.empireId}:${a.empireId}`;
}

/** Prestige = colony share + population share of the council (0..100 each half). */
export function prestige(c: Council, e: Empire): number {
    let colonies = 0;
    let pop = 0;
    const popOf = (x: Empire): number => x.colonies.reduce((s, h) => s + (h?.population?.totalAmount ?? 0), 0);
    for (const m of c.members) {
        colonies += m.colonies.length;
        pop += popOf(m);
    }
    return (colonies > 0 ? (50 * e.colonies.length) / colonies : 0) + (pop > 0 ? (50 * popOf(e)) / pop : 0);
}

/** A new state the council may recognise: a seceded empire (19d1) or a chartered company (19c). */
export function isNewState(galaxy: Galaxy, e: Empire): boolean {
    const pol = peekPoliticsState(galaxy);
    if (pol !== null && pol.events.some((ev) => ev.kind === 'secession' && ev.success && ev.other === e)) return true;
    return allCharters(galaxy).some((ch) => ch.companyId === e.empireId);
}

/** A threat: the 19f Dark Farms faction, or an empire at locked war with a member (19f lockWar). */
export function isThreatTo(galaxy: Galaxy, e: Empire, member: Empire): boolean {
    if (!e.active || e === member) return false;
    const df = galaxy.scenario?.state.darkFarms as { faction?: Empire | null } | undefined;
    if (df?.faction === e) return true;
    const r = member.diplomaticRelations?.byEmpire(e) ?? null;
    return r !== null && r.type === DiplomaticRelationType.War && r.locked;
}

/** The first restricted (super-luxury) resource the other members supply and the target does not (-1: none). */
export function embargoResource(galaxy: Galaxy, c: Council, target: Empire): number {
    const own = new Set(determineResourcesEmpireSupplies(target));
    const offered = new Set<number>();
    for (const m of c.members) if (m !== target) for (const id of determineResourcesEmpireSupplies(m)) offered.add(id);
    const ids = [...offered].filter((id) => !own.has(id) && (galaxy.resources[id]?.superLuxuryBonusAmount ?? 0) > 0).sort((a, b) => a - b);
    return ids.length > 0 ? ids[0] : -1;
}

function resourceName(galaxy: Galaxy, id: number): string {
    return galaxy.resources[id]?.name ?? 'restricted resources';
}

export function motionText(galaxy: Galaxy, kind: MotionKind, target: Empire, other: Empire | null, resourceId: number): string {
    switch (kind) {
        case 'sanction':
            return `Impose trade sanctions on the ${target.name}`;
        case 'embargo':
            return `Embargo ${resourceName(galaxy, resourceId)} and other restricted resources to the ${target.name}`;
        case 'condemn':
            return `Condemn the ${target.name}'s war${other !== null ? ` against the ${other.name}` : ''}`;
        case 'lift':
            return `Lift the council's sanctions on the ${target.name}`;
        case 'recognise':
            return `Recognise the ${target.name} as a sovereign state`;
        case 'threat':
            return `Declare the ${target.name} a threat to the galaxy`;
    }
}

const HOSTILE: ReadonlySet<MotionKind> = new Set(['sanction', 'embargo', 'condemn', 'threat']);

// ---------------------------------------------------------------------------------------------------------------
// Founding, joining, leaving
// ---------------------------------------------------------------------------------------------------------------

const COUNCIL_NAMES = ['Galactic Concord', 'Assembly of Stars', 'Council of Worlds', 'Stellar Congress', 'Union of Suns', 'Galactic Senate'];
const BLOC_WORDS = ['Entente', 'Compact', 'Accord', 'League', 'Pact', 'Coalition'];

function willingToJoin(galaxy: Galaxy, e: Empire, year: number): boolean {
    if (e === galaxy.playerEmpire) return true;
    const left = peekCouncilState(galaxy)?.leftYear[e.empireId];
    if (left !== undefined && year - left < P.rejoinYears(galaxy)) return false;
    return joinScore(e) >= P.joinThreshold(galaxy);
}

/**
 * The founding group: greedy mutual-contact cliques (seed = each willing empire by id; add every willing empire by
 * id that has met all current members); the first reaching councilFoundingMembers founds. null = not yet.
 */
export function foundingGroup(galaxy: Galaxy, year: number): Empire[] | null {
    const n = P.foundingMembers(galaxy);
    const cands = galaxy.empires.filter((e) => isCouncilEmpire(galaxy, e) && willingToJoin(galaxy, e, year) && !isNewState(galaxy, e)).sort(byId);
    for (const seed of cands) {
        const group = [seed];
        for (const e of cands) if (e !== seed && group.every((m) => hasMet(m, e) && hasMet(e, m))) group.push(e);
        if (group.length >= n) return group.sort(byId);
    }
    return null;
}

function foundCouncil(galaxy: Galaxy, st: CouncilState, members: Empire[], year: number): Council {
    const seed = members.reduce((s, m) => s + m.empireId, 0);
    const c: Council = {
        id: st.nextId++,
        name: COUNCIL_NAMES[seed % COUNCIL_NAMES.length],
        foundedYear: year,
        members: [...members],
        chair: null,
        motion: null,
        results: [],
        blocs: [],
        coLosses: {},
        losses: {},
        sanctions: [],
        threats: [],
        recognised: [],
        condemned: {},
        splitFrom: 0,
    };
    st.councils.push(c);
    electChair(c);
    const names = members.map((m) => m.name).join(', ');
    scenarioNews(galaxy, null, `The ${c.name} is founded by the ${names}. The ${c.chair?.name ?? ''} take the first chair.`);
    for (const m of members) {
        scenarioMessage(galaxy, m, `${c.name} founded`, `We have a seat on the ${c.name} with the ${names}. Each year the council votes on one motion; the ${c.chair?.name ?? ''} hold the chair.`, { type: EmpireMessageType.GeneralGoodEvent });
    }
    return c;
}

/** The yearly chair: the highest-prestige member other than last year's chair (rotation), ties by empireId. */
export function electChair(c: Council): Empire | null {
    const ranked = [...c.members].sort((a, b) => prestige(c, b) - prestige(c, a) || byId(a, b));
    const next = ranked.find((m) => m !== c.chair || ranked.length === 1) ?? null;
    c.chair = next;
    return next;
}

export function joinCouncil(galaxy: Galaxy, c: Council, e: Empire): void {
    if (c.members.includes(e)) return;
    c.members.push(e);
    c.members.sort(byId);
    scenarioNews(galaxy, null, `The ${e.name} take a seat on the ${c.name}.`);
    scenarioMessage(galaxy, e, `${c.name}`, `We have taken a seat on the ${c.name}.`, { type: EmpireMessageType.GeneralNeutralEvent });
}

/** A member leaves: every remaining member resents it (−councilLeavePenalty incident). */
export function leaveCouncil(galaxy: Galaxy, c: Council, e: Empire, year: number): void {
    const i = c.members.indexOf(e);
    if (i < 0) return;
    c.members.splice(i, 1);
    for (const b of c.blocs) {
        const j = b.members.indexOf(e);
        if (j >= 0) b.members.splice(j, 1);
    }
    c.blocs = c.blocs.filter((b) => b.members.length >= 2);
    if (c.chair === e) electChair(c);
    councilState(galaxy).leftYear[e.empireId] = year;
    const pen = P.leavePenalty(galaxy);
    for (const m of c.members) addIncident(galaxy, m, e, -pen);
    scenarioNews(galaxy, e, `The ${e.name} walk out of the ${c.name}.`);
    for (const m of c.members) scenarioMessage(galaxy, m, `${c.name}`, `The ${e.name} have left the ${c.name}.`, { type: EmpireMessageType.GeneralBadEvent, subject: e });
    scenarioMessage(galaxy, e, `${c.name}`, `We have left the ${c.name}.`, { type: EmpireMessageType.GeneralWarning });
}

/** Leave score of a sanctioned AI member: aggression − caution − average attitude to the other members. */
export function leaveScore(c: Council, e: Empire): number {
    const others = c.members.filter((m) => m !== e);
    const avg = others.length > 0 ? others.reduce((s, m) => s + attitudeOf(e, m), 0) / others.length : 0;
    return aggressionLevel(e) - cautionLevel(e) - avg;
}

function underCouncilSanction(c: Council, e: Empire): boolean {
    return c.sanctions.some((s) => s.target === e);
}

function reviewMembership(galaxy: Galaxy, st: CouncilState, year: number): void {
    // Leaving (sanctioned members, by traits). The player is asked when sanctioned (COUNCIL_LEAVE_DECISION).
    for (const c of st.councils) {
        for (const m of [...c.members]) {
            if (!isCouncilEmpire(galaxy, m)) {
                c.members.splice(c.members.indexOf(m), 1);
                for (const b of c.blocs) if (b.members.includes(m)) b.members.splice(b.members.indexOf(m), 1);
                if (c.chair === m) c.chair = null;
                continue;
            }
            if (m === galaxy.playerEmpire || !underCouncilSanction(c, m)) continue;
            if (leaveScore(c, m) >= P.leaveThreshold(galaxy)) leaveCouncil(galaxy, c, m, year);
        }
        c.blocs = c.blocs.filter((b) => b.members.length >= 2);
    }
    st.councils = st.councils.filter((c) => {
        if (c.members.length >= 2) return true;
        scenarioNews(galaxy, null, `The ${c.name} is dissolved.`);
        return false;
    });
    // Joining on contact (new states only once recognised).
    for (const e of galaxy.empires.filter((x) => isCouncilEmpire(galaxy, x)).sort(byId)) {
        if (st.councils.some((c) => c.members.includes(e))) continue;
        if (!willingToJoin(galaxy, e, year)) continue;
        let best: Council | null = null;
        let bestScore = -Infinity;
        for (const c of st.councils) {
            if (!c.members.some((m) => hasMet(e, m))) continue;
            if (c.members.some((m) => isThreatTo(galaxy, e, m))) continue;
            if (isNewState(galaxy, e) && !c.recognised.includes(e)) continue;
            const known = c.members.filter((m) => hasMet(e, m));
            const score = known.reduce((s, m) => s + attitudeOf(e, m), 0) / known.length;
            if (score > bestScore) {
                best = c;
                bestScore = score;
            }
        }
        if (best !== null) joinCouncil(galaxy, best, e);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Motions
// ---------------------------------------------------------------------------------------------------------------

export interface MotionCandidate {
    kind: MotionKind;
    proposer: Empire;
    target: Empire;
    other: Empire | null;
    resourceId: number;
    weight: number;
}

/**
 * Every member's grievances (19d3 spy crises, wars declared on it, attitude) plus recognitions / threats / lifts, each
 * a candidate motion with a weight. Threats 100; spy crisis sanctions 60 + severity/2; condemnations 50; recognitions
 * 40; attitude sanctions 30 + depth/2; embargoes 20 + depth/2; lifts 25 + attitude/5.
 */
export function motionCandidates(galaxy: Galaxy, c: Council, year: number): MotionCandidate[] {
    const out: MotionCandidate[] = [];
    const sanctioned = (t: Empire, kind: 'sanction' | 'embargo'): boolean => c.sanctions.some((s) => s.target === t && s.kind === kind);
    const others = [...galaxy.empires, ...galaxy.pirateEmpires].filter((e): e is Empire => e !== null && e.active && e !== galaxy.independentEmpire).sort(byId);
    for (const a of c.members) {
        for (const b of others) {
            if (b === a || !hasMet(a, b)) continue;
            const normal = isCouncilEmpire(galaxy, b);
            if (isThreatTo(galaxy, b, a) && !c.threats.includes(b)) {
                out.push({ kind: 'threat', proposer: a, target: b, other: null, resourceId: -1, weight: 100 });
                continue;
            }
            if (!normal) continue;
            for (const cr of empireSpyCrises(galaxy, a)) {
                if (cr.victim === a && cr.offender === b && cr.stage !== 'resolved' && !sanctioned(b, 'sanction')) {
                    out.push({ kind: 'sanction', proposer: a, target: b, other: a, resourceId: -1, weight: 60 + cr.severity / 2 });
                }
            }
            const r = a.diplomaticRelations.byEmpire(b);
            if (r !== null && r.type === DiplomaticRelationType.War && r.initiator === b) {
                const last = c.condemned[b.empireId];
                if (last === undefined || year - last >= 3) out.push({ kind: 'condemn', proposer: a, target: b, other: a, resourceId: -1, weight: 50 });
            }
            if (isNewState(galaxy, b) && !c.recognised.includes(b) && !c.members.includes(b)) {
                out.push({ kind: 'recognise', proposer: a, target: b, other: null, resourceId: -1, weight: 40 + attitudeOf(a, b) / 10 });
            }
            const att = attitudeOf(a, b);
            if (att <= P.grievanceAttitude(galaxy) && !sanctioned(b, 'sanction')) {
                out.push({ kind: 'sanction', proposer: a, target: b, other: a, resourceId: -1, weight: 30 + (P.grievanceAttitude(galaxy) - att) / 2 });
            } else if (att <= P.embargoAttitude(galaxy) && !sanctioned(b, 'embargo') && !sanctioned(b, 'sanction')) {
                const res = embargoResource(galaxy, c, b);
                if (res >= 0) out.push({ kind: 'embargo', proposer: a, target: b, other: a, resourceId: res, weight: 20 + (P.embargoAttitude(galaxy) - att) / 2 });
            }
            const s = c.sanctions.find((x) => x.target === b);
            if (s !== undefined && year - s.year >= P.sanctionMinYears(galaxy) && att >= 0) {
                out.push({ kind: 'lift', proposer: a, target: b, other: null, resourceId: -1, weight: 25 + att / 5 });
            }
        }
    }
    return out;
}

/** The year's motion: the heaviest candidate (ties: proposer id, target id, kind); the chair's if it has one of equal weight. */
export function chooseMotion(galaxy: Galaxy, c: Council, year: number): MotionCandidate | null {
    const cands = motionCandidates(galaxy, c, year);
    if (cands.length === 0) return null;
    cands.sort((x, y) => y.weight - x.weight || (x.proposer === c.chair ? -1 : 0) - (y.proposer === c.chair ? -1 : 0) || byId(x.proposer, y.proposer) || byId(x.target, y.target) || (x.kind < y.kind ? -1 : x.kind > y.kind ? 1 : 0));
    return cands[0];
}

/**
 * A member's vote score on a motion: attitude to the proposer (×0.3), to the target (∓×0.5), own interests (trade
 * volume with the target, shared-border pressure, being at war with it) and bloc alignment (± councilBlocVoteWeight).
 * The target votes against hostile motions and for friendly ones; the proposer votes yes.
 */
export function voteScore(galaxy: Galaxy, c: Council, voter: Empire, m: Motion): number {
    const hostile = HOSTILE.has(m.kind);
    if (voter === m.target) return hostile ? -100 : 100;
    if (voter === m.proposer) return 100;
    const sign = hostile ? -1 : 1;
    let s = attitudeOf(voter, m.proposer) * 0.3 + sign * attitudeOf(voter, m.target) * 0.5;
    if (m.kind === 'sanction' || m.kind === 'embargo' || m.kind === 'lift') s += sign * tradeInterest(voter, m.target);
    s += -sign * borderPressure(voter, m.target) * 0.5;
    const atWar = relType(voter, m.target) === DiplomaticRelationType.War;
    if (m.kind === 'threat') s += 20 + (atWar ? 20 : 0);
    else if (hostile && atWar) s += 20;
    const w = P.blocVoteWeight(galaxy);
    const bv = blocOf(c, voter);
    if (bv !== null && bv.members.includes(m.proposer)) s += w;
    if (bv !== null && bv.members.includes(m.target)) s += sign * w;
    return s;
}

export function scoreToVote(galaxy: Galaxy, score: number): Vote {
    const t = P.voteThreshold(galaxy);
    return score >= t ? 'yes' : score <= -t ? 'no' : 'abstain';
}

/** AI votes (the player's comes from its decision), then bloc coordination: a hardened bloc votes its majority line. */
export function castAiVotes(galaxy: Galaxy, c: Council, m: Motion): void {
    m.votes = [];
    for (const e of c.members) {
        if (e === galaxy.playerEmpire) continue;
        const score = voteScore(galaxy, c, e, m);
        m.votes.push({ empire: e, vote: scoreToVote(galaxy, score), score, coordinated: false });
    }
    coordinateBlocs(galaxy, c, m);
}

function coordinateBlocs(galaxy: Galaxy, c: Council, m: Motion): void {
    for (const b of c.blocs) {
        if (b.hardness < P.blocCoordinationYears(galaxy)) continue;
        const vs = m.votes.filter((v) => b.members.includes(v.empire));
        const yes = vs.filter((v) => v.vote === 'yes').length;
        const no = vs.filter((v) => v.vote === 'no').length;
        if (yes === no) continue;
        const line: Vote = yes > no ? 'yes' : 'no';
        for (const v of vs) {
            if (v.empire === m.target || v.empire === m.proposer || v.vote === line) continue;
            v.vote = line;
            v.coordinated = true;
        }
    }
}

/** Puts a motion to the council: AI votes now; the player (a member) gets a vote decision, else it is tallied at once. */
export function proposeMotion(galaxy: Galaxy, c: Council, cand: Omit<MotionCandidate, 'weight'>): Motion {
    const st = councilState(galaxy);
    const m: Motion = {
        id: st.nextId++,
        kind: cand.kind,
        proposer: cand.proposer,
        target: cand.target,
        other: cand.other,
        resourceId: cand.resourceId,
        text: motionText(galaxy, cand.kind, cand.target, cand.other, cand.resourceId),
        year: nowYear(galaxy),
        proposedStarDate: galaxyStarDate(galaxy),
        status: 'voting',
        votes: [],
        decisionId: 0,
    };
    c.motion = m;
    castAiVotes(galaxy, c, m);
    const player = galaxy.playerEmpire;
    if (player !== null && c.members.includes(player)) {
        const d = raiseScenarioDecision(galaxy, player, {
            kind: COUNCIL_VOTE_DECISION,
            title: `${c.name}: vote`,
            text: `The ${m.proposer.name} move: ${m.text}. How do we vote?${m.target === player ? ' (The motion targets us.)' : ''}`,
            options: [
                { id: 'yes', label: 'Vote yes' },
                { id: 'no', label: 'Vote no' },
                { id: 'abstain', label: 'Abstain' },
            ],
            defaultOption: 'abstain',
            expiresDays: P.voteDays(galaxy),
            context: { councilId: c.id, motionId: m.id },
        });
        m.decisionId = d.id;
        // 19s-2 voices (flag llmVoices; inert otherwise, no state): two members speak for / against in the council screen.
        if (voicesOn(galaxy)) {
            noteVoiceCue(galaxy, {
                kind: 'speech',
                empire: player,
                message: null,
                voice: m.proposer,
                other: m.target,
                speaker: null,
                role: c.name,
                facts: { council: c.name, motion: m.text, kind: m.kind, proposer: m.proposer.name, target: m.target.name },
                ref: { council: c, motion: m },
                scripted: '',
            });
        }
    } else {
        tallyMotion(galaxy, c, m);
    }
    return m;
}

/** Records the player's vote (then tallies). False when the motion is not voting. */
export function recordPlayerVote(galaxy: Galaxy, c: Council, m: Motion, vote: Vote): boolean {
    const player = galaxy.playerEmpire;
    if (m.status !== 'voting' || player === null) return false;
    m.votes = m.votes.filter((v) => v.empire !== player);
    if (c.members.includes(player)) m.votes.push({ empire: player, vote, score: 0, coordinated: false });
    tallyMotion(galaxy, c, m);
    return true;
}

/** Majority of the votes cast (yes > no) passes; effects, news, losses / bloc formation. */
export function tallyMotion(galaxy: Galaxy, c: Council, m: Motion): void {
    if (m.status !== 'voting') return;
    const yes = m.votes.filter((v) => v.vote === 'yes').length;
    const no = m.votes.filter((v) => v.vote === 'no').length;
    const abstain = m.votes.filter((v) => v.vote === 'abstain').length;
    const passed = yes > no;
    m.status = passed ? 'passed' : 'failed';
    if (c.motion === m) c.motion = null;
    const year = nowYear(galaxy);
    c.results.push({ motionId: m.id, year, kind: m.kind, text: m.text, passed, yes, no, abstain, proposer: m.proposer, target: m.target });
    if (c.results.length > 20) c.results.splice(0, c.results.length - 20);
    const verdict = passed ? 'PASSED' : 'FAILED';
    scenarioNews(galaxy, null, `${c.name}: "${m.text}" ${verdict} (${yes} for, ${no} against, ${abstain} abstaining).`);
    for (const e of new Set([...c.members, m.target])) {
        if (!e.active) continue;
        const bad = passed && HOSTILE.has(m.kind) && e === m.target;
        scenarioMessage(galaxy, e, `${c.name}: motion ${passed ? 'passed' : 'failed'}`, `"${m.text}" (moved by the ${m.proposer.name}) ${passed ? 'passed' : 'failed'}: ${yes} for, ${no} against, ${abstain} abstaining.`, {
            type: bad ? EmpireMessageType.GeneralBadEvent : EmpireMessageType.GeneralNeutralEvent,
            subject: m.target,
        });
    }
    if (passed) applyMotion(galaxy, c, m, year);
    recordLosses(galaxy, c, m, passed, year);
}

// ---------------------------------------------------------------------------------------------------------------
// Effects (through the ported relation code)
// ---------------------------------------------------------------------------------------------------------------

/** Trade sanctions of `m` on `t`: StartTradeSanctions for an AI, the TRADESANCTIONS_IMPOSE change for the player. */
function imposeSanctions(galaxy: Galaxy, m: Empire, t: Empire): void {
    if (m === t || !hasMet(m, t)) return;
    const rt = relType(m, t);
    if (rt === DiplomaticRelationType.TradeSanctions || rt === DiplomaticRelationType.War || rt === DiplomaticRelationType.SubjugatedDominion) return;
    if (m === galaxy.playerEmpire) changeDiplomaticRelation(galaxy, m, obtainDiplomaticRelation(m, t), DiplomaticRelationType.TradeSanctions); // Main.Part10.cs 4591
    else startTradeSanctions(galaxy, m, t); // Empire.8.cs 1586
}

function liftSanctions(galaxy: Galaxy, m: Empire, t: Empire): void {
    const r = m.diplomaticRelations.byEmpire(t);
    if (r === null || r.type !== DiplomaticRelationType.TradeSanctions || r.initiator !== m) return;
    if (m === galaxy.playerEmpire) changeDiplomaticRelation(galaxy, m, r, DiplomaticRelationType.None); // Main.Part10.cs 4609
    else endTradeSanctions(galaxy, m, t); // Empire.8.cs 1623
}

/** CheckCancelRestrictedResourceTrading (Empire.8.cs 1712) without the authorisation prompt: the council binds. */
// TODO(scenario): a per-resource embargo (block only the named resource in the freight/contract seller choice) needs a new
// query hook in logistics/contracts.ts; the ported lever covers every restricted resource at once. Also, the AI's
// ReviewRestrictedResourceTrading (Empire.4.cs 4311) may reopen the trade between sessions — enforce() re-closes it yearly.
function embargo(galaxy: Galaxy, m: Empire, t: Empire): void {
    if (m === t || !hasMet(m, t)) return;
    const r = obtainDiplomaticRelation(m, t);
    if (!r.supplyRestrictedResources) return;
    r.supplyRestrictedResources = false;
    sendMessageToEmpire(m, t, EmpireMessageType.RestrictedResourceTradingBlocked, m, `The ${m.name} have refused to trade rare restricted resources with us`);
}

/** Start.2.cs 1376-1427 meeting: a None relation on both sides (NotMet upgraded). */
function introduce(a: Empire, b: Empire): void {
    let r = a.diplomaticRelations.byEmpire(b);
    if (r === null) {
        a.diplomaticRelations.add(new DiplomaticRelation(DiplomaticRelationType.None, a, a, b, false));
    } else if (r.type === DiplomaticRelationType.NotMet) r.type = DiplomaticRelationType.None;
    r = b.diplomaticRelations.byEmpire(a);
    if (r === null) {
        b.diplomaticRelations.add(new DiplomaticRelation(DiplomaticRelationType.None, a, b, a, false));
    } else if (r.type === DiplomaticRelationType.NotMet) r.type = DiplomaticRelationType.None;
}

export function applyMotion(galaxy: Galaxy, c: Council, m: Motion, year: number): void {
    const t = m.target;
    switch (m.kind) {
        case 'sanction':
            c.sanctions = c.sanctions.filter((s) => !(s.target === t && s.kind === 'embargo'));
            c.sanctions.push({ target: t, kind: 'sanction', resourceId: -1, year });
            for (const e of c.members) imposeSanctions(galaxy, e, t);
            if (t === galaxy.playerEmpire && c.members.includes(t)) askPlayerLeave(galaxy, c);
            break;
        case 'embargo':
            c.sanctions.push({ target: t, kind: 'embargo', resourceId: m.resourceId, year });
            for (const e of c.members) embargo(galaxy, e, t);
            for (const e of c.members) addIncident(galaxy, t, e, -5);
            if (t === galaxy.playerEmpire && c.members.includes(t)) askPlayerLeave(galaxy, c);
            break;
        case 'condemn': {
            c.condemned[t.empireId] = year;
            const pen = P.condemnPenalty(galaxy);
            for (const e of c.members) addIncident(galaxy, e, t, -pen);
            setCivilityRating(t, t.civilityRating - 2);
            break;
        }
        case 'lift':
            c.sanctions = c.sanctions.filter((s) => s.target !== t);
            for (const e of c.members) liftSanctions(galaxy, e, t);
            break;
        case 'recognise':
            c.recognised.push(t);
            for (const e of c.members) {
                introduce(e, t);
                addIncident(galaxy, e, t, 10);
                addIncident(galaxy, t, e, 10);
            }
            if (isCouncilEmpire(galaxy, t) && councilOf(galaxy, t) === null) joinCouncil(galaxy, c, t);
            break;
        case 'threat':
            c.threats.push(t);
            applyThreat(galaxy, c, t);
            break;
    }
}

/** Joint defence against a declared threat: members at war with it grow closer; AI members sanction it. */
function applyThreat(galaxy: Galaxy, c: Council, t: Empire): void {
    const bonus = P.threatBonus(galaxy);
    const fighting = c.members.filter((e) => relType(e, t) === DiplomaticRelationType.War);
    for (const a of c.members) for (const b of fighting) if (a !== b) addIncident(galaxy, a, b, bonus);
    if (t.pirateEmpireBaseHabitat === null) for (const e of c.members) if (e !== galaxy.playerEmpire) imposeSanctions(galaxy, e, t);
}

/** Yearly enforcement: standing sanctions / embargoes re-applied by AI members, threats kept or dropped. */
function enforce(galaxy: Galaxy, c: Council): void {
    c.sanctions = c.sanctions.filter((s) => s.target.active);
    for (const s of c.sanctions) {
        for (const e of c.members) {
            if (e === galaxy.playerEmpire || e === s.target) continue;
            if (s.kind === 'sanction') imposeSanctions(galaxy, e, s.target);
            else embargo(galaxy, e, s.target);
        }
    }
    c.threats = c.threats.filter((t) => t.active);
    for (const t of c.threats) applyThreat(galaxy, c, t);
}

// ---------------------------------------------------------------------------------------------------------------
// Blocs
// ---------------------------------------------------------------------------------------------------------------

/** The outvoted (losing side + abstainers) of a resolved motion. */
export function outvoted(m: Motion, passed: boolean): Empire[] {
    return m.votes.filter((v) => v.vote === 'abstain' || v.vote === (passed ? 'no' : 'yes')).map((v) => v.empire);
}

function recordLosses(galaxy: Galaxy, c: Council, m: Motion, passed: boolean, year: number): void {
    const losers = outvoted(m, passed).filter((e) => c.members.includes(e)).sort(byId);
    for (const e of losers) c.losses[e.empireId] = (c.losses[e.empireId] ?? 0) + 1;
    const need = P.blocLosses(galaxy);
    const st = councilState(galaxy);
    for (let i = 0; i < losers.length; i++) {
        for (let j = i + 1; j < losers.length; j++) {
            const a = losers[i];
            const b = losers[j];
            const k = pairKey(a, b);
            c.coLosses[k] = (c.coLosses[k] ?? 0) + 1;
            if (c.coLosses[k] < need) continue;
            const ba = blocOf(c, a);
            const bb = blocOf(c, b);
            if (ba === null && bb === null) {
                const bloc: Bloc = { id: st.nextId++, name: `${a.name} ${BLOC_WORDS[c.blocs.length % BLOC_WORDS.length]}`, founder: a, members: [a, b], formedYear: year, hardness: 0 };
                c.blocs.push(bloc);
                scenarioNews(galaxy, a, `Outvoted once too often, the ${a.name} and the ${b.name} form the ${bloc.name} within the ${c.name}.`);
                for (const e of bloc.members) scenarioMessage(galaxy, e, `${c.name}: ${bloc.name}`, `We have joined the ${bloc.name} with the ${e === a ? b.name : a.name}: we will vote together and favour each other.`, { type: EmpireMessageType.GeneralNeutralEvent });
            } else if (ba !== null && bb === null) {
                joinBloc(galaxy, c, ba, b);
            } else if (bb !== null && ba === null) {
                joinBloc(galaxy, c, bb, a);
            }
        }
    }
}

function joinBloc(galaxy: Galaxy, c: Council, bloc: Bloc, e: Empire): void {
    bloc.members.push(e);
    bloc.members.sort(byId);
    scenarioNews(galaxy, e, `The ${e.name} join the ${bloc.name} within the ${c.name}.`);
}

/** Yearly: blocs harden, their members favour each other; a hardened large bloc may split the council in two. */
function reviewBlocs(galaxy: Galaxy, st: CouncilState, c: Council, year: number): void {
    const bonus = P.blocAttitudeBonus(galaxy);
    for (const b of c.blocs) {
        b.hardness++;
        const add = bonus * Math.min(3, b.hardness);
        for (const x of b.members) for (const y of b.members) if (x !== y) addIncident(galaxy, x, y, add);
    }
    if (st.councils.length >= 2) return;
    for (const b of c.blocs) {
        const rest = c.members.length - b.members.length;
        if (b.hardness < P.splitYears(galaxy) || b.members.length * 3 < c.members.length || rest < 2) continue;
        splitCouncil(galaxy, st, c, b, year);
        return;
    }
}

export function splitCouncil(galaxy: Galaxy, st: CouncilState, c: Council, b: Bloc, year: number): Council {
    c.members = c.members.filter((m) => !b.members.includes(m));
    c.blocs = c.blocs.filter((x) => x !== b);
    if (c.chair !== null && !c.members.includes(c.chair)) electChair(c);
    if (c.motion !== null && c.motion.status === 'voting') c.motion.votes = c.motion.votes.filter((v) => c.members.includes(v.empire));
    const rival: Council = {
        id: st.nextId++,
        name: `${b.name} Council`,
        foundedYear: year,
        members: [...b.members],
        chair: null,
        motion: null,
        results: [],
        blocs: [],
        coLosses: {},
        losses: {},
        sanctions: [],
        threats: [],
        recognised: [...c.recognised],
        condemned: {},
        splitFrom: c.id,
    };
    electChair(rival);
    st.councils.push(rival);
    scenarioNews(galaxy, b.founder, `The ${c.name} splits in two: the ${b.name} (${b.members.map((m) => m.name).join(', ')}) walk out and found the ${rival.name}.`);
    return rival;
}

// ---------------------------------------------------------------------------------------------------------------
// Player decisions
// ---------------------------------------------------------------------------------------------------------------

function askPlayerLeave(galaxy: Galaxy, c: Council): void {
    const p = galaxy.playerEmpire;
    if (p === null) return;
    raiseScenarioDecision(galaxy, p, {
        kind: COUNCIL_LEAVE_DECISION,
        title: `${c.name}: sanctions against us`,
        text: `The ${c.name} has voted measures against us. Do we keep our seat or walk out (every member will resent it)?`,
        options: [
            { id: 'stay', label: 'Keep our seat' },
            { id: 'leave', label: 'Leave the council' },
        ],
        defaultOption: 'stay',
        expiresDays: P.voteDays(galaxy),
        context: { councilId: c.id },
    });
}

function councilById(galaxy: Galaxy, id: unknown): Council | null {
    return peekCouncilState(galaxy)?.councils.find((c) => c.id === id) ?? null;
}

function resolveVoteDecision(galaxy: Galaxy, d: ScenarioDecision, optionId: string): void {
    const c = councilById(galaxy, d.context.councilId);
    const m = c?.motion ?? null;
    if (c === null || m === null || m.id !== d.context.motionId) return;
    recordPlayerVote(galaxy, c, m, optionId === 'yes' ? 'yes' : optionId === 'no' ? 'no' : 'abstain');
}

function resolveLeaveDecision(galaxy: Galaxy, d: ScenarioDecision, optionId: string): void {
    const c = councilById(galaxy, d.context.councilId);
    const p = galaxy.playerEmpire;
    if (c === null || p === null || optionId !== 'leave') return;
    leaveCouncil(galaxy, c, p, nowYear(galaxy));
}

// ---------------------------------------------------------------------------------------------------------------
// Yearly review
// ---------------------------------------------------------------------------------------------------------------

/** The yearly council tick: founding, membership, chair, enforcement, blocs, then this year's motion. */
export function reviewCouncil(galaxy: Galaxy, year: number): void {
    const st = councilState(galaxy);
    if (st.councils.length === 0) {
        const group = foundingGroup(galaxy, year);
        if (group !== null) foundCouncil(galaxy, st, group, year);
        else return;
    } else {
        reviewMembership(galaxy, st, year);
    }
    for (const c of [...st.councils]) {
        // A motion still waiting on the player at the next session is tallied without the player's vote.
        if (c.motion !== null && c.motion.status === 'voting') tallyMotion(galaxy, c, c.motion);
        if (c.foundedYear !== year) electChair(c);
        enforce(galaxy, c);
        reviewBlocs(galaxy, st, c, year);
    }
    for (const c of [...st.councils]) {
        const cand = chooseMotion(galaxy, c, year);
        if (cand !== null) proposeMotion(galaxy, c, cand);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Registration (module load; imported from scenario/packages.ts)
// ---------------------------------------------------------------------------------------------------------------

registerScenarioYearly({ id: 'emergent.council', flag: COUNCIL_FLAG, order: 40, run: reviewCouncil });
registerScenarioDecision({ id: 'emergent.council.vote', kind: COUNCIL_VOTE_DECISION, flag: COUNCIL_FLAG, resolve: resolveVoteDecision, aiChoose: () => 'abstain' });
registerScenarioDecision({ id: 'emergent.council.leave', kind: COUNCIL_LEAVE_DECISION, flag: COUNCIL_FLAG, resolve: resolveLeaveDecision, aiChoose: () => 'stay' });

/** Days → star-date span (UI deadline of a vote). */
export function voteDeadline(galaxy: Galaxy, m: Motion): number {
    return m.proposedStarDate + P.voteDays(galaxy) * GAME_DAY_LENGTH;
}
