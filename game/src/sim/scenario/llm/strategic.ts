// 19s-3 STRATEGIC UPGRADE, sim side (tasks/19-mod-layer-scenarios.md §19s item 3; builds on 18c). Not a port.
//
// For the N AI empires nearest the player (param llmStrategicEmpires, flag llmStrategic of the llm-layer scenario), once
// per game year the UI-side job (llm/strategicJob.ts) sends the empire's grounding digest (digest.ts digestFor) plus its
// LEGAL MOVES to the local model as a schema-constrained choice. This module is the sim half:
//
//  - one family per scenario system, each a legal-move ENUMERATOR over the live state (pure: peeks the package state,
//    never creates a bag, never draws galaxy.rnd) and an APPLY through the package's own entry point:
//      council    19d8  table one of the empire's own motion candidates / change its vote on the motion being voted
//      peace      19g-3 offer terms (its war-score demand or the status quo) / accept a standing end-war proposal
//      warGoal    19g-3 change its war goal to another candidate goal of that war
//      scheme     19m   start an investigation into an open lead (the counter-scheme on this build: the 19n-2 schemes
//                       are not merged here; the family's enumerator is the hook they plug into)
//      faction    19d1  concede to a discontented character: honour them or grant their colony autonomy
//      league     19k   offer an independent league a protectorate or a trade pact
//      herders    19j   the herder path for a neighbouring free herder colony: protectorate or conquest
//  - VALIDATION: the answer's id must be one of the ids offered; when the command is applied the families are
//    re-enumerated on the live galaxy and the id must still be legal (else 'refused', nothing is called);
//  - the COMMAND: the model's choice reaches the sim ONLY as a player-queue command (playerOps `llmStrategic`, applied
//    at a frame boundary and journaled in the command log), so seed + command log replays the game without the model.
//    Refused / invalid / timed-out answers are commands too (logged, no effect): the rules keep running for everyone;
//  - the DECISION LOG (empire, year, options offered, choice, the model's reason, applied / blocked / refused) in the
//    scenario state bag 'llmStrategic' — written only by the command, so a replay rebuilds it.
//
// The scripted rules are not suspended for the chosen empires: a model move is one extra deliberate act per year.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Character } from '../../characters';
import { getEmpireCharacters } from '../../characters';
import { DiplomaticRelationType } from '../../diplomacy';
import { YEAR_LENGTH } from '../../galaxyTime';
import { galaxyStarDate } from '../../tick/simTime';
import { acceptProposal } from '../../player/playerOrders';
import { scenarioFlag, scenarioParam, scenarioState } from '../state';
import { llmOn } from './chronicle';
import { COUNCIL_FLAG, motionCandidates, peekCouncilState, proposeMotion, type Council, type Vote } from '../emergent/council';
import { atWar, describeGoal, peekWarGoalCandidates, peekWarLedger, sideOf, warGoalsOn, type WarGoal } from '../lively/warGoals';
import { buildTerms, describeTerms, isStatusQuo, proposePeaceTerms, statusQuo } from '../lively/peaceTerms';
import { POLITICS_FLAG, governedColony, peekPoliticsState } from '../emergent/politics';
import { grantAutonomy, honorCharacter, honourBlocked } from '../emergent/politicsActions';
import { availableInvestigators, investigatingAgent, investigatorSkill, startInvestigation } from '../security/security';
import { peekSecurityState, securityOn } from '../security/registry';
import { ACTORS_FLAG, LEAGUES_FLAG, STANDING_NEIGHBOUR, peekIndependentsState } from '../independents/common';
import { offerToLeague } from '../independents/independents';
import { RIM_HERDERS_FLAG, herderStanding, isHerderEmpire, peekRimHerdersState, rimHerdersState } from '../rimHerders/common';
import { formProtectorate, orderHerderConquest } from '../rimHerders/rimHerders';

export const LLM_STRATEGIC_FLAG = 'llmStrategic';
export const LLM_STRATEGIC_STATE = 'llmStrategic';
/** Default N (param llmStrategicEmpires). */
export const STRATEGIC_DEFAULT_EMPIRES = 5;
/** At most this many empires (one per 30-day slot of the year). */
export const STRATEGIC_MAX_EMPIRES = 12;
/** Game days between two empires' slots in the yearly pass. */
export const STRATEGIC_SLOT_DAYS = 30;
/** Legal moves offered per family / in all (keeps the prompt small). */
export const MOVES_PER_FAMILY = 4;
export const MAX_MOVES = 16;
/** Decision log entries kept. */
export const STRATEGIC_LOG_MAX = 120;
/** Longest reason kept. */
export const MAX_REASON_CHARS = 300;
/** A character below this loyalty is discontented (faction concession). */
export const FACTION_LOYALTY = 60;

export type StrategicFamily = 'council' | 'peace' | 'warGoal' | 'scheme' | 'faction' | 'league' | 'herders';
export const STRATEGIC_FAMILIES: readonly StrategicFamily[] = ['council', 'peace', 'warGoal', 'scheme', 'faction', 'league', 'herders'];

/** One legal move (plain data; `id` is what the model answers and the command carries). */
export interface LegalMove {
    id: string;
    family: StrategicFamily;
    /** What it does, in words (the prompt). */
    text: string;
}

export type StrategicStatus = 'applied' | 'blocked' | 'refused' | 'none';

/** One decision-log row (plain data; saved in the scenario state). */
export interface StrategicLogEntry {
    empireId: number;
    empireName: string;
    /** Game year of the yearly pass that asked. */
    year: number;
    /** Star date the command was applied. */
    starDate: number;
    /** The ids offered. */
    offered: string[];
    /** The chosen id ('none' = the model chose to do nothing; null = no usable answer). */
    choice: string | null;
    family: StrategicFamily | '';
    /** The model's stated reason (or why the answer was refused). */
    reason: string;
    status: StrategicStatus;
    /** What the sim did / why not. */
    text: string;
}

export interface StrategicState {
    log: StrategicLogEntry[];
    /** Totals by status (the overlay). */
    counts: Record<StrategicStatus, number>;
}

/** The command the job issues (plain JSON: the command codec journals it by value). */
export interface LlmStrategicCommand {
    /** Year of the pass that asked. */
    year: number;
    offered: string[];
    /** The validated choice, 'none', or null (refused / invalid / timed out: `reason` says why). */
    choice: string | null;
    reason: string;
}

// ---------------------------------------------------------------------------------------------------------------
// Gates, state, selection
// ---------------------------------------------------------------------------------------------------------------

/** The strategic layer runs: the llm layer on and its flag llmStrategic on. */
export function strategicOn(galaxy: Galaxy | null | undefined): boolean {
    return llmOn(galaxy) && scenarioFlag(galaxy!, LLM_STRATEGIC_FLAG);
}

export function peekStrategicState(galaxy: Galaxy): StrategicState | null {
    const s = galaxy.scenario;
    if (s === null || !(LLM_STRATEGIC_STATE in s.state)) return null;
    return s.state[LLM_STRATEGIC_STATE] as StrategicState;
}

function strategicState(galaxy: Galaxy): StrategicState {
    return scenarioState<StrategicState>(galaxy, LLM_STRATEGIC_STATE, () => ({ log: [], counts: { applied: 0, blocked: 0, refused: 0, none: 0 } }));
}

/** The decision log (oldest first); empty when none. */
export function strategicLog(galaxy: Galaxy): readonly StrategicLogEntry[] {
    return peekStrategicState(galaxy)?.log ?? [];
}

/** True when a decision for `empire` in pass `year` is already logged (after a load the job does not ask again). */
export function strategicDecided(galaxy: Galaxy, empire: Empire, year: number): boolean {
    return strategicLog(galaxy).some((e) => e.empireId === empire.empireId && e.year === year);
}

/** The param N, clamped to 0..STRATEGIC_MAX_EMPIRES. */
export function strategicEmpireCount(galaxy: Galaxy): number {
    return Math.max(0, Math.min(STRATEGIC_MAX_EMPIRES, Math.trunc(scenarioParam(galaxy, 'llmStrategicEmpires', STRATEGIC_DEFAULT_EMPIRES))));
}

function isMajor(galaxy: Galaxy, e: Empire | null): e is Empire {
    return e !== null && e.active && e !== galaxy.independentEmpire && e.pirateEmpireBaseHabitat === null;
}

/**
 * The AI empires the model decides for: normal active empires other than the player (not the independents, pirates or
 * herder empires) with a capital, nearest the player's capital first (ties by empireId); at most `n`. Pure.
 */
export function nearestAiEmpires(galaxy: Galaxy, player: Empire | null, n: number): Empire[] {
    const cap = player?.capital ?? null;
    if (player === null || cap === null || n <= 0) return [];
    const out: { e: Empire; d: number }[] = [];
    for (const e of galaxy.empires) {
        if (!isMajor(galaxy, e) || e === player || e.capital === null || isHerderEmpire(galaxy, e)) continue;
        out.push({ e, d: (e.capital.xpos - cap.xpos) ** 2 + (e.capital.ypos - cap.ypos) ** 2 });
    }
    out.sort((a, b) => a.d - b.d || a.e.empireId - b.e.empireId);
    return out.slice(0, n).map((x) => x.e);
}

// ---------------------------------------------------------------------------------------------------------------
// Families
// ---------------------------------------------------------------------------------------------------------------

interface ApplyResult {
    status: 'applied' | 'blocked';
    text: string;
}

interface FamilyDef {
    family: StrategicFamily;
    /** The legal moves of `e` now (pure). */
    enumerate(galaxy: Galaxy, e: Empire): LegalMove[];
    /** Applies a move this family enumerated just now (the caller re-enumerated it on the live galaxy). */
    apply(galaxy: Galaxy, e: Empire, id: string): ApplyResult;
}

const ok = (text: string): ApplyResult => ({ status: 'applied', text });
const no = (text: string): ApplyResult => ({ status: 'blocked', text });
const year = (galaxy: Galaxy): number => Math.floor(galaxyStarDate(galaxy) / YEAR_LENGTH);

function empireById(galaxy: Galaxy, id: number): Empire | null {
    return [...galaxy.empires, ...galaxy.pirateEmpires].find((x): x is Empire => x !== null && x.empireId === id) ?? null;
}

function parts(id: string): string[] {
    return id.split(':');
}

// ---- council (19d8) ---------------------------------------------------------------------------------------------

function councilOf(galaxy: Galaxy, e: Empire): Council | null {
    return peekCouncilState(galaxy)?.councils.find((c) => c.members.includes(e)) ?? null;
}

const council: FamilyDef = {
    family: 'council',
    enumerate(galaxy, e) {
        if (!scenarioFlag(galaxy, COUNCIL_FLAG)) return [];
        const c = councilOf(galaxy, e);
        if (c === null) return [];
        const out: LegalMove[] = [];
        const m = c.motion;
        if (m !== null && m.status === 'voting') {
            if (e !== m.proposer && e !== m.target) {
                const cur = m.votes.find((v) => v.empire === e)?.vote ?? null;
                for (const v of ['yes', 'no', 'abstain'] as const) {
                    if (v === cur) continue;
                    out.push({ id: `council.vote:${c.id}:${m.id}:${v}`, family: 'council', text: `${c.name}: vote ${v} on "${m.text}"${cur !== null ? ` (now ${cur})` : ''}` });
                }
            }
            return out;
        }
        const cands = motionCandidates(galaxy, c, year(galaxy))
            .filter((x) => x.proposer === e)
            .sort((a, b) => b.weight - a.weight || a.target.empireId - b.target.empireId || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));
        const seen = new Set<string>();
        for (const x of cands) {
            const id = `council.table:${c.id}:${x.kind}:${x.target.empireId}:${x.resourceId}`;
            if (seen.has(id)) continue;
            seen.add(id);
            out.push({ id, family: 'council', text: `${c.name}: table a motion to ${x.kind} the ${x.target.name}` });
        }
        return out;
    },
    apply(galaxy, e, id) {
        const p = parts(id);
        const c = peekCouncilState(galaxy)?.councils.find((x) => x.id === Number(p[1])) ?? null;
        if (c === null) return no('no such council');
        if (p[0] === 'council.vote') {
            const m = c.motion;
            if (m === null || m.id !== Number(p[2]) || m.status !== 'voting') return no('the vote is over');
            const vote = p[3] as Vote;
            const v = m.votes.find((x) => x.empire === e);
            if (v !== undefined) {
                v.vote = vote;
                v.coordinated = false;
            } else m.votes.push({ empire: e, vote, score: 0, coordinated: false });
            return ok(`Voted ${vote} on "${m.text}"`);
        }
        const kind = p[2];
        const target = Number(p[3]);
        const resourceId = Number(p[4]);
        const cand = motionCandidates(galaxy, c, year(galaxy)).find((x) => x.proposer === e && x.kind === kind && x.target.empireId === target && x.resourceId === resourceId);
        if (cand === undefined) return no('the motion is no longer a grievance');
        const m = proposeMotion(galaxy, c, cand);
        return ok(`Tabled "${m.text}"${m.status !== 'voting' ? `: ${m.status}` : ''}`);
    },
};

// ---- peace terms (19g-3) ----------------------------------------------------------------------------------------

function enemiesOf(galaxy: Galaxy, e: Empire): Empire[] {
    const out: Empire[] = [];
    for (const r of e.diplomaticRelations) {
        if (r.type === DiplomaticRelationType.War && isMajor(galaxy, r.otherEmpire)) out.push(r.otherEmpire);
    }
    return out.sort((a, b) => a.empireId - b.empireId);
}

/** War old enough to end (Galaxy.MinimumWarLengthPeriodYears 0.5, as peaceTerms.acceptsTerms) and not locked. */
function warEndable(galaxy: Galaxy, e: Empire, x: Empire): boolean {
    const rel = e.diplomaticRelations.byEmpire(x);
    if (rel === null || rel.locked) return false;
    return galaxyStarDate(galaxy) >= rel.startDateOfLastChange + 0.5 * YEAR_LENGTH;
}

const peace: FamilyDef = {
    family: 'peace',
    enumerate(galaxy, e) {
        if (!warGoalsOn(galaxy)) return [];
        const out: LegalMove[] = [];
        for (const x of enemiesOf(galaxy, e)) {
            if (peekWarLedger(galaxy, e, x) === null || !warEndable(galaxy, e, x)) continue;
            const prop = e.proposedDiplomaticRelations.byEmpire(x);
            if (prop !== null && prop.type === DiplomaticRelationType.None) {
                out.push({ id: `peace.accept:${x.empireId}`, family: 'peace', text: `Accept the ${x.name}'s peace offer` });
            }
            // An offer to the player would be answered on the player's behalf (proposePeaceTerms answers at once).
            if (x === galaxy.playerEmpire) continue;
            const demand = buildTerms(galaxy, e, x);
            if (!isStatusQuo(demand)) out.push({ id: `peace.offer:${x.empireId}:demand`, family: 'peace', text: `Offer the ${x.name} peace on our terms: ${describeTerms(demand).join('; ')}` });
            out.push({ id: `peace.offer:${x.empireId}:statusQuo`, family: 'peace', text: `Offer the ${x.name} a white peace (status quo)` });
        }
        return out;
    },
    apply(galaxy, e, id) {
        const p = parts(id);
        const x = empireById(galaxy, Number(p[1]));
        if (x === null || !atWar(e, x)) return no('not at war');
        if (p[0] === 'peace.accept') {
            return acceptProposal(e, x) && !atWar(e, x) ? ok(`Accepted the ${x.name}'s peace offer`) : no('the offer lapsed');
        }
        const terms = p[2] === 'demand' ? buildTerms(galaxy, e, x) : statusQuo();
        const r = proposePeaceTerms(galaxy, e, x, terms);
        if (!r.ok) return no(r.message);
        return r.accepted ? ok(`Peace with the ${x.name}: ${describeTerms(terms).join('; ')}`) : no(`The ${x.name} refused and countered`);
    },
};

// ---- war goals (19g-3) ------------------------------------------------------------------------------------------

function sameGoal(a: WarGoal, b: WarGoal): boolean {
    return a.kind === b.kind && a.subject === b.subject && a.colonies.length === b.colonies.length && a.colonies.every((c, i) => b.colonies[i] === c);
}

function goalMoves(galaxy: Galaxy, e: Empire): { move: LegalMove; enemy: Empire; goal: WarGoal }[] {
    if (!warGoalsOn(galaxy)) return [];
    const out: { move: LegalMove; enemy: Empire; goal: WarGoal }[] = [];
    for (const x of enemiesOf(galaxy, e)) {
        const l = peekWarLedger(galaxy, e, x);
        if (l === null) continue;
        const side = sideOf(l, e);
        if (side.chosenBy === 'player' || side.chosenBy === 'pending') continue;
        for (const g of peekWarGoalCandidates(galaxy, e, x, l.attacker)) {
            if (sameGoal(g, side.goal) || g.kind === 'casusBelli') continue;
            out.push({ move: { id: `warGoal:${x.empireId}:${g.kind}`, family: 'warGoal', text: `War with the ${x.name}: change our goal to ${describeGoal(g)} (now ${describeGoal(side.goal)})` }, enemy: x, goal: g });
        }
    }
    return out;
}

const warGoal: FamilyDef = {
    family: 'warGoal',
    enumerate: (galaxy, e) => goalMoves(galaxy, e).map((m) => m.move),
    apply(galaxy, e, id) {
        const m = goalMoves(galaxy, e).find((x) => x.move.id === id);
        const l = m !== undefined ? peekWarLedger(galaxy, e, m.enemy) : null;
        if (m === undefined || l === null) return no('no such war');
        const side = sideOf(l, e);
        side.goal = m.goal;
        side.chosenBy = 'ai';
        return ok(`War goal against the ${m.enemy.name}: ${describeGoal(m.goal)}`);
    },
};

// ---- scheme target (19m investigation; 19n-2 schemes plug in here) -----------------------------------------------

const scheme: FamilyDef = {
    family: 'scheme',
    enumerate(galaxy, e) {
        const st = peekSecurityState(galaxy);
        if (!securityOn(galaxy) || st === null || availableInvestigators(galaxy, e).length === 0) return [];
        return st.leads
            .filter((l) => l.empire === e && !l.closed && l.level !== 'confirmed' && investigatingAgent(galaxy, l) === null)
            .sort((a, b) => b.updated - a.updated || a.id - b.id)
            .map((l) => ({ id: `scheme.investigate:${l.id}`, family: 'scheme' as const, text: `Send an agent to investigate the ${l.level} ${l.kind} lead` }));
    },
    apply(galaxy, e, id) {
        const leadId = Number(parts(id)[1]);
        const agents = availableInvestigators(galaxy, e)
            .map((a, i) => ({ a, i, s: investigatorSkill(a, e) }))
            .sort((x, y) => y.s - x.s || x.i - y.i);
        if (agents.length === 0) return no('no agent free');
        const r = startInvestigation(galaxy, e, leadId, agents[0].a);
        return r.ok ? ok(`${agents[0].a.name} investigates lead ${leadId}`) : no(r.reason ?? 'blocked');
    },
};

// ---- faction concession (19d1 internal politics) ----------------------------------------------------------------

function discontented(galaxy: Galaxy, e: Empire): { c: Character; idx: number; loyalty: number }[] {
    const st = peekPoliticsState(galaxy);
    if (st === null || !scenarioFlag(galaxy, POLITICS_FLAG)) return [];
    const chars = getEmpireCharacters(e);
    const out: { c: Character; idx: number; loyalty: number }[] = [];
    chars.forEach((c, idx) => {
        const entry = st.chars.get(c);
        if (entry !== undefined && c.active && c.empire === e && entry.loyalty < FACTION_LOYALTY) out.push({ c, idx, loyalty: entry.loyalty });
    });
    return out.sort((a, b) => a.loyalty - b.loyalty || a.idx - b.idx).slice(0, 3);
}

function slug(s: string): string {
    return s.replace(/[^A-Za-z0-9]+/g, '_').slice(0, 24);
}

function factionMoves(galaxy: Galaxy, e: Empire): { move: LegalMove; c: Character; colony: ReturnType<typeof governedColony> }[] {
    const st = peekPoliticsState(galaxy);
    const out: { move: LegalMove; c: Character; colony: ReturnType<typeof governedColony> }[] = [];
    for (const d of discontented(galaxy, e)) {
        const col = governedColony(d.c);
        if (col !== null && col.empire === e && col !== e.capital && st !== null && !st.autonomy.has(col)) {
            out.push({ move: { id: `faction.autonomy:${col.habitatIndex}`, family: 'faction', text: `Grant ${col.name} autonomy (5 years of low tax) to appease its governor ${d.c.name} (loyalty ${Math.round(d.loyalty)})` }, c: d.c, colony: col });
        }
        if (honourBlocked(galaxy, e, d.c) === null) {
            out.push({ move: { id: `faction.honour:${d.idx}:${slug(d.c.name)}`, family: 'faction', text: `Honour ${d.c.name} (loyalty ${Math.round(d.loyalty)}) with a costly public reward` }, c: d.c, colony: null });
        }
    }
    return out;
}

const faction: FamilyDef = {
    family: 'faction',
    enumerate: (galaxy, e) => factionMoves(galaxy, e).map((m) => m.move),
    apply(galaxy, e, id) {
        const m = factionMoves(galaxy, e).find((x) => x.move.id === id);
        if (m === undefined) return no('no longer discontented');
        const r = m.colony !== null ? grantAutonomy(galaxy, e, m.colony) : honorCharacter(galaxy, e, m.c);
        return r.ok ? ok(m.colony !== null ? `Granted ${m.colony.name} autonomy` : `Honoured ${m.c.name}`) : no(r.reason ?? 'blocked');
    },
};

// ---- independent leagues (19k) ----------------------------------------------------------------------------------

const league: FamilyDef = {
    family: 'league',
    enumerate(galaxy, e) {
        const st = peekIndependentsState(galaxy);
        if (st === null || !scenarioFlag(galaxy, ACTORS_FLAG) || !scenarioFlag(galaxy, LEAGUES_FLAG) || galaxy.independentEmpire === null) return [];
        const out: LegalMove[] = [];
        const leagues = st.leagues
            .filter((l) => l.status === 'active' && !l.offered.includes(e.empireId) && (l.standing[e.empireId] ?? 0) >= STANDING_NEIGHBOUR)
            .sort((a, b) => (b.standing[e.empireId] ?? 0) - (a.standing[e.empireId] ?? 0) || a.id - b.id)
            .slice(0, 2);
        for (const l of leagues) {
            const s = Math.round(l.standing[e.empireId] ?? 0);
            out.push({ id: `league.protectorate:${l.id}`, family: 'league', text: `Offer the ${l.name} (${l.members.length} colonies, goodwill ${s}) our protection as a protectorate` });
            if (!l.tradePartners.includes(e.empireId)) out.push({ id: `league.trade:${l.id}`, family: 'league', text: `Offer the ${l.name} (goodwill ${s}) a trade pact` });
        }
        return out;
    },
    apply(galaxy, e, id) {
        const p = parts(id);
        const l = peekIndependentsState(galaxy)?.leagues.find((x) => x.id === Number(p[1])) ?? null;
        if (l === null) return no('no such league');
        const kind = p[0] === 'league.trade' ? 'trade' : 'protectorate';
        l.offered.push(e.empireId);
        const r = offerToLeague(galaxy, l, e, kind);
        return r === 'refused' ? no(`The ${l.name} refused`) : ok(`The ${l.name}: ${r}`);
    },
};

// ---- rim herders (19j) ------------------------------------------------------------------------------------------

const herders: FamilyDef = {
    family: 'herders',
    enumerate(galaxy, e) {
        const st = peekRimHerdersState(galaxy);
        if (st === null || !scenarioFlag(galaxy, RIM_HERDERS_FLAG) || isHerderEmpire(galaxy, e)) return [];
        const out: LegalMove[] = [];
        st.colonies.forEach((hc, i) => {
            if (hc.status !== 'free' || hc.colony.hasBeenDestroyed || hc.neighbourSince[e.empireId] === undefined) return;
            if (herderStanding(galaxy, e.empireId) >= 0) out.push({ id: `herders.protect:${i}`, family: 'herders', text: `Take the herders of ${hc.colony.name} under our protection (a herder protectorate)` });
            out.push({ id: `herders.conquer:${i}`, family: 'herders', text: `Conquer the herder colony ${hc.colony.name} (its herds turn feral against us for years)` });
        });
        return out;
    },
    apply(galaxy, e, id) {
        const p = parts(id);
        const hc = rimHerdersState(galaxy).colonies[Number(p[1])];
        if (hc === undefined || hc.status !== 'free') return no('the colony is no longer free');
        if (p[0] === 'herders.protect') {
            if (!hc.offered.includes(e.empireId)) hc.offered.push(e.empireId);
            const h = formProtectorate(galaxy, hc, e);
            return h !== null ? ok(`${hc.colony.name} became the protectorate ${h.name}`) : no('the protectorate could not be formed');
        }
        if (!orderHerderConquest(galaxy, hc, e)) return no('no attack fleet free');
        rimHerdersState(galaxy).stats.conquestOrders++;
        return ok(`Attack fleet sent against ${hc.colony.name}`);
    },
};

const FAMILIES: readonly FamilyDef[] = [council, peace, warGoal, scheme, faction, league, herders];

// ---------------------------------------------------------------------------------------------------------------
// Legal moves, validation, the command
// ---------------------------------------------------------------------------------------------------------------

/** The moves one family offers `e` now (pure; tests and the per-family enumerator). */
export function familyMoves(galaxy: Galaxy, e: Empire, family: StrategicFamily): LegalMove[] {
    return FAMILIES.find((f) => f.family === family)!.enumerate(galaxy, e);
}

/**
 * All legal moves of `e` now, per family at most MOVES_PER_FAMILY, in all at most MAX_MOVES (families interleaved so
 * none is crowded out). Pure and deterministic: never creates state, never draws.
 */
export function legalMoves(galaxy: Galaxy, e: Empire): LegalMove[] {
    if (!e.active) return [];
    const lists = FAMILIES.map((f) => f.enumerate(galaxy, e).slice(0, MOVES_PER_FAMILY));
    const out: LegalMove[] = [];
    for (let i = 0; i < MOVES_PER_FAMILY && out.length < MAX_MOVES; i++) {
        for (const l of lists) if (i < l.length && out.length < MAX_MOVES) out.push(l[i]);
    }
    return out;
}

/** The JSON schema of the answer: `choice` constrained to the offered ids plus "none"; the reason first. */
export function strategicSchema(moves: readonly LegalMove[]): object {
    return {
        type: 'object',
        properties: {
            reason: { type: 'string' },
            choice: { type: 'string', enum: [...moves.map((m) => m.id), 'none'] },
        },
        required: ['reason', 'choice'],
    };
}

export interface ValidatedAnswer {
    /** An offered id or 'none'; null when the answer is unusable (`error`). */
    choice: string | null;
    reason: string;
    error?: string;
}

function clipReason(s: string): string {
    const r = s.replace(/\s+/g, ' ').trim();
    return r.length > MAX_REASON_CHARS ? `${r.slice(0, MAX_REASON_CHARS - 3)}...` : r;
}

/** Parse and check the model's answer against the moves offered. Pure. */
export function validateStrategicAnswer(moves: readonly LegalMove[], raw: string): ValidatedAnswer {
    let o: unknown;
    try {
        o = JSON.parse(raw);
    } catch {
        return { choice: null, reason: '', error: 'the answer is not JSON' };
    }
    if (o === null || typeof o !== 'object') return { choice: null, reason: '', error: 'the answer is not an object' };
    const a = o as { reason?: unknown; choice?: unknown };
    const reason = typeof a.reason === 'string' ? clipReason(a.reason) : '';
    if (typeof a.choice !== 'string') return { choice: null, reason, error: 'the answer has no choice' };
    const choice = a.choice.trim();
    if (choice === 'none') return { choice: 'none', reason };
    if (!moves.some((m) => m.id === choice)) return { choice: null, reason, error: `"${clipReason(choice).slice(0, 60)}" is not one of the legal moves` };
    return { choice, reason };
}

function familyOfId(id: string): FamilyDef | null {
    const head = id.split(':')[0];
    const fam = head.split('.')[0];
    return FAMILIES.find((f) => f.family === fam) ?? null;
}

function log(galaxy: Galaxy, entry: StrategicLogEntry): StrategicLogEntry {
    const st = strategicState(galaxy);
    st.log.push(entry);
    if (st.log.length > STRATEGIC_LOG_MAX) st.log.splice(0, st.log.length - STRATEGIC_LOG_MAX);
    st.counts[entry.status]++;
    return entry;
}

/**
 * The `llmStrategic` player-queue command (playerOps): applied at a frame boundary, journaled, replayed from the log.
 * Re-enumerates `empire`'s legal moves on the live galaxy; the choice must still be among them (else 'refused'), then
 * the family applies it through the package's own entry point. Every call (also a refusal) adds a decision-log row.
 * No-op (null) when the layer is off.
 */
export function applyLlmStrategicCommand(galaxy: Galaxy, empire: Empire, cmd: LlmStrategicCommand): StrategicLogEntry | null {
    if (!strategicOn(galaxy)) return null;
    const base = {
        empireId: empire.empireId,
        empireName: empire.name,
        year: Math.trunc(Number(cmd.year)) || 0,
        starDate: galaxyStarDate(galaxy),
        offered: Array.isArray(cmd.offered) ? cmd.offered.map(String).slice(0, MAX_MOVES) : [],
        choice: typeof cmd.choice === 'string' ? cmd.choice : null,
        reason: clipReason(String(cmd.reason ?? '')),
    };
    if (base.choice === null) return log(galaxy, { ...base, family: '', status: 'refused', text: 'No usable answer: the rules decide' });
    if (base.choice === 'none') return log(galaxy, { ...base, family: '', status: 'none', text: 'No move this year' });
    const fam = familyOfId(base.choice);
    if (fam === null || !empire.active) return log(galaxy, { ...base, family: '', status: 'refused', text: 'Not a legal move' });
    if (!base.offered.includes(base.choice) || !fam.enumerate(galaxy, empire).some((m) => m.id === base.choice)) {
        return log(galaxy, { ...base, family: fam.family, status: 'refused', text: 'Not (or no longer) a legal move: the rules decide' });
    }
    const r = fam.apply(galaxy, empire, base.choice);
    return log(galaxy, { ...base, family: fam.family, status: r.status, text: r.text });
}
