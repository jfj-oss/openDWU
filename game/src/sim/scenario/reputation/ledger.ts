// 19o reputation & grievances ledger (tasks/19-mod-layer-scenarios.md §19o). Not a port: the mod layer's one channel for
// scenario attitude modifiers, as scenario/stability.ts is for approval terms. Every package that changes how one actor
// regards another records an entry WITH A CAUSE here instead of writing EmpireEvaluation.IncidentEvaluation / Bias or a
// PirateRelation evaluation field directly; the ported attitude reads the sum through reputation/channel.ts:
//   - EmpireEvaluation (diplomacy.ts): incidentTotal() = clamp(_IncidentEvaluation + incident entries) — the single place
//     the C# sums incidents into the attitude (EmpireEvaluation.cs 96 OverallAttitude `this._IncidentEvaluation`, 157
//     OverallAttitudeWithoutSystemCompetition, 199 the IncidentEvaluation getter) — and biasTotal() (147 / 157 / 302).
//   - PirateRelation (pirateRelations.ts): the Evaluation float sum (PirateRelation.cs 271) gets the pair's entries as one
//     more term (what Empire.8.cs 2512 ChangePirateEvaluation would have added).
// With the flag off nothing is recorded and every channel slot returns null: the game is byte-identical.
//
// Entries are keyed per ORDERED actor pair (a regards b). Actors are empires (normal, pirate factions, the independent
// empire) or a sub-faction of one (a league, a herder colony: `{ empireId, sub }`); only plain-empire pairs reach the
// ported attitude, sub-faction pairs are read by their packages (reputationSum / grievances with the ActorRef).
// Values are in IncidentEvaluation units (the evaluation weighs them by AggressionLevel / DiplomacyFactor like the stock
// field). Each entry decays toward 0 by `decayPerYear` once per game year (the scenario yearly tick); the default is the
// stock neutralization rate (Galaxy.3.cs 5009 IncidentEvaluationAnnualNeutralizationAmount = 3, applied by Empire.8.cs
// 2050 to the stock accumulator). Recording, decay and every reader are pure (no Rnd).

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import { empireEvaluationByEmpire, empireEvaluationsOf, obtainEmpireEvaluation, type EmpireEvaluation } from '../../diplomacy';
import { changePirateEvaluation, obtainPirateRelation, type PirateRelation, type PirateRelationEvaluationType } from '../../pirateRelations';
import { galaxyStarDate } from '../../tick/simTime';
import { registerScenarioYearly } from '../hooks';
import { scenarioFlag, scenarioState } from '../state';
import { reputationChannel } from './channel';

export const REPUTATION_FLAG = 'reputationLedger';
const STATE_KEY = 'reputation';

/** Galaxy.3.cs 5009 IncidentEvaluationAnnualNeutralizationAmount: the default yearly decay of an entry. */
export const REPUTATION_DEFAULT_DECAY = 3;

/** An actor: an empire (Empire satisfies it) or a sub-faction of one (league, herder colony) by `sub` id. */
export interface ActorRef {
    readonly empireId: number;
    readonly sub?: string;
}

/** Which EmpireEvaluation term an entry joins (pirate pairs: both join the PirateRelation evaluation). */
export type ReputationTerm = 'incident' | 'bias';

export interface ReputationEntry {
    /** Cause id, unique per pair and term (e.g. "espionage.sanctions"): a second record with it merges. */
    cause: string;
    /** scenarioText tag of the display label. */
    labelKey: string;
    /** Signed current value (after decay). */
    value: number;
    /** Moved toward 0 by this much each game year; 0 = permanent. */
    decayPerYear: number;
    /** Package that wrote it (e.g. "19d3"). */
    source: string;
    /** Star date of the last record. */
    date: number;
    term: ReputationTerm;
}

/** What a package passes. */
export interface ReputationEntrySpec {
    cause: string;
    /** Default `Reputation Cause <cause>`. */
    labelKey?: string;
    value: number;
    /** Default REPUTATION_DEFAULT_DECAY. */
    decayPerYear?: number;
    source: string;
    /** Default 'incident'. */
    term?: ReputationTerm;
}

export interface ReputationState {
    /** `${actorKey(a)}>${actorKey(b)}` → a's entries about b (insertion order). */
    pairs: Record<string, ReputationEntry[]>;
}

export function actorKey(a: ActorRef): string {
    return a.sub === undefined ? String(a.empireId) : `${a.empireId}:${a.sub}`;
}

function pairKey(a: ActorRef, b: ActorRef): string {
    return `${actorKey(a)}>${actorKey(b)}`;
}

export function reputationOn(galaxy: Galaxy): boolean {
    return scenarioFlag(galaxy, REPUTATION_FLAG);
}

export function reputationState(galaxy: Galaxy): ReputationState {
    return scenarioState<ReputationState>(galaxy, STATE_KEY, () => ({ pairs: {} }));
}

/** The state if it exists (readers never create it). */
export function peekReputationState(galaxy: Galaxy): ReputationState | null {
    const s = galaxy.scenario;
    if (s === null || !(STATE_KEY in s.state)) return null;
    return s.state[STATE_KEY] as ReputationState;
}

// Target empire id → owner empire ids with plain-empire entries about it (the channel's owner lookup). Derived, never
// saved: dropped on every mutation, rebuilt lazily (a loaded game has a new state object).
const indexCache = new WeakMap<ReputationState, Map<number, number[]>>();

function targetIndex(st: ReputationState): Map<number, number[]> {
    let idx = indexCache.get(st);
    if (idx !== undefined) return idx;
    idx = new Map();
    for (const key of Object.keys(st.pairs)) {
        const [a, b] = key.split('>');
        if (a.includes(':') || b.includes(':')) continue;
        const list = idx.get(Number(b)) ?? [];
        list.push(Number(a));
        idx.set(Number(b), list);
    }
    indexCache.set(st, idx);
    return idx;
}

/**
 * Records `spec` as a's entry about b (merging into the existing entry of the same cause and term: value added, date and
 * decay refreshed). Returns the entry, or null with the flag off / a zero value / a === b. No Rnd.
 */
export function recordReputation(galaxy: Galaxy, a: ActorRef, b: ActorRef, spec: ReputationEntrySpec): ReputationEntry | null {
    if (!reputationOn(galaxy) || spec.value === 0 || !Number.isFinite(spec.value)) return null;
    const key = pairKey(a, b);
    const [ka, kb] = key.split('>');
    if (ka === kb) return null;
    const st = reputationState(galaxy);
    const term = spec.term ?? 'incident';
    const list = (st.pairs[key] ??= []);
    const now = galaxyStarDate(galaxy);
    const decay = spec.decayPerYear ?? REPUTATION_DEFAULT_DECAY;
    let e = list.find((x) => x.cause === spec.cause && x.term === term);
    if (e === undefined) {
        e = { cause: spec.cause, labelKey: spec.labelKey ?? `Reputation Cause ${spec.cause}`, value: spec.value, decayPerYear: decay, source: spec.source, date: now, term };
        list.push(e);
    } else {
        e.value += spec.value;
        e.decayPerYear = decay;
        e.date = now;
        if (spec.labelKey !== undefined) e.labelKey = spec.labelKey;
    }
    if (e.value === 0) list.splice(list.indexOf(e), 1);
    if (list.length === 0) delete st.pairs[key];
    indexCache.delete(st);
    return e;
}

function entries(galaxy: Galaxy, a: ActorRef, b: ActorRef): readonly ReputationEntry[] {
    if (!reputationOn(galaxy)) return [];
    return peekReputationState(galaxy)?.pairs[pairKey(a, b)] ?? [];
}

/** a's ledger sum about b (the `term` entries, or all). 0 with the flag off. */
export function reputationSum(galaxy: Galaxy, a: ActorRef, b: ActorRef, term: ReputationTerm | 'all' = 'all'): number {
    let v = 0;
    for (const e of entries(galaxy, a, b)) if (term === 'all' || e.term === term) v += e.value;
    return v;
}

/** a's entries about b for the UI: copies, largest |value| first (ties: record order). */
export function reputationCauses(galaxy: Galaxy, a: ActorRef, b: ActorRef): ReputationEntry[] {
    const list = entries(galaxy, a, b).map((e) => ({ ...e }));
    return list.map((e, i) => ({ e, i })).sort((x, y) => Math.abs(y.e.value) - Math.abs(x.e.value) || x.i - y.i).map((x) => x.e);
}

/**
 * What a holds against b: a's negative entries about b whose magnitude is at least `minValue` (≥ 0), worst first. For
 * the council grievance search, the war review and peace-terms pricing (see reputation/MIGRATION.md).
 */
export function grievances(galaxy: Galaxy, a: ActorRef, b: ActorRef, minValue = 0): ReputationEntry[] {
    return reputationCauses(galaxy, a, b).filter((e) => e.value < 0 && -e.value >= minValue);
}

/** The yearly decay: every entry moves toward 0 by its decayPerYear; spent entries and empty pairs are dropped. */
export function reputationYear(galaxy: Galaxy): void {
    const st = peekReputationState(galaxy);
    if (st === null) return;
    for (const key of Object.keys(st.pairs)) {
        const list = st.pairs[key];
        for (let i = list.length - 1; i >= 0; i--) {
            const e = list[i];
            if (e.decayPerYear <= 0) continue;
            e.value = e.value > 0 ? Math.max(0, e.value - e.decayPerYear) : Math.min(0, e.value + e.decayPerYear);
            if (e.value === 0) list.splice(i, 1);
        }
        if (list.length === 0) delete st.pairs[key];
    }
    indexCache.delete(st);
}

// ---------------------------------------------------------------------------------------------------------------
// One-line migration helpers for the sources (flag off: exactly the former direct write)
// ---------------------------------------------------------------------------------------------------------------

/**
 * The generic migration form for a package's own ledger (herder / league standing, Concord trade standing): flag off runs
 * `legacy` (the former write) and records nothing; flag on records the entry instead. Use a sub-faction ActorRef on one
 * side when the value must NOT reach the ported attitude (only plain-empire pairs do). No Rnd.
 */
export function recordReputationOr(galaxy: Galaxy, a: ActorRef, b: ActorRef, spec: ReputationEntrySpec, legacy: () => void): void {
    if (!reputationOn(galaxy)) legacy();
    else recordReputation(galaxy, a, b, spec);
}

/** How the source wrote before (the flag-off path repeats it exactly). */
export type LegacyWrite = 'raw' | 'factored';

export interface ApplyReputationSpec extends Omit<ReputationEntrySpec, 'value'> {
    /**
     * 'raw' (default): `ev.incidentEvaluation = ev.incidentEvaluationRaw + value` (bias: `ev.bias = ev.biasRaw + value`);
     * 'factored': `ev.incidentEvaluation = ev.incidentEvaluation + value` — also what `ev.incidentEvaluation += value`
     * does (bias: `ev.bias = ev.bias + value`).
     */
    legacy?: LegacyWrite;
}

/**
 * a's attitude to b changes by `value` for `spec.cause`. Flag off: the former direct write on
 * obtainEmpireEvaluation(a, b). Flag on: the evaluation is still obtained (same creation side effect) and the value is
 * recorded as a ledger entry, which the attitude reads through the channel. A throwaway evaluation (pirate / independent
 * pair, inactive b: Empire.4.cs 106 ObtainEmpireEvaluation) records nothing, as the direct write changed nothing. No Rnd.
 */
export function applyReputation(galaxy: Galaxy, a: Empire, b: Empire, value: number, spec: ApplyReputationSpec): void {
    const ev = obtainEmpireEvaluation(galaxy, a, b);
    const term = spec.term ?? 'incident';
    if (!reputationOn(galaxy)) {
        const factored = spec.legacy === 'factored';
        if (term === 'bias') ev.bias = (factored ? ev.bias : ev.biasRaw) + value;
        else ev.incidentEvaluation = (factored ? ev.incidentEvaluation : ev.incidentEvaluationRaw) + value;
        return;
    }
    if (empireEvaluationByEmpire(empireEvaluationsOf(a), b) !== ev) return;
    recordReputation(galaxy, a, b, { cause: spec.cause, labelKey: spec.labelKey, value, decayPerYear: spec.decayPerYear, source: spec.source, term });
}

/**
 * `empire`'s regard for the pirate faction `pirate` (or a pirate's for an empire) changes by `value`. Flag off:
 * changePirateEvaluation(empire, pirate, value, evaluationType) (Empire.8.cs 2512). Flag on: the relation is still
 * obtained and the value becomes a ledger entry the PirateRelation evaluation reads. No Rnd.
 */
export function applyPirateReputation(galaxy: Galaxy, empire: Empire, pirate: Empire, value: number, evaluationType: PirateRelationEvaluationType, spec: Omit<ReputationEntrySpec, 'value' | 'term'>): void {
    if (!reputationOn(galaxy)) {
        changePirateEvaluation(empire, pirate, value, evaluationType);
        return;
    }
    obtainPirateRelation(empire, pirate);
    recordReputation(galaxy, empire, pirate, { ...spec, value: Math.fround(value) });
}

// ---------------------------------------------------------------------------------------------------------------
// The channel (reputation/channel.ts slots) and the yearly decay
// ---------------------------------------------------------------------------------------------------------------

function stateFor(galaxy: Galaxy | undefined | null): ReputationState | null {
    if (galaxy === undefined || galaxy === null) return null;
    const s = galaxy.scenario;
    if (s === null || s === undefined || s.flags[REPUTATION_FLAG] !== true) return null; // undefined: test stub galaxies
    return (s.state[STATE_KEY] as ReputationState | undefined) ?? null;
}

function actorById(galaxy: Galaxy, id: number): Empire | null {
    for (const e of galaxy.empires) if (e !== null && e.empireId === id) return e;
    for (const e of galaxy.pirateEmpires) if (e !== null && e.empireId === id) return e;
    const ind = galaxy.independentEmpire;
    return ind !== null && ind.empireId === id ? ind : null;
}

function evaluationSum(ev: EmpireEvaluation, term: ReputationTerm): number | null {
    const b = ev.empire;
    if (b === null) return null;
    const galaxy = b.galaxy;
    const st = stateFor(galaxy);
    if (st === null) return null;
    const owners = targetIndex(st).get(b.empireId);
    if (owners === undefined) return null;
    for (const id of owners) {
        const owner = actorById(galaxy, id);
        if (owner === null || empireEvaluationByEmpire(empireEvaluationsOf(owner), b) !== ev) continue;
        const list = st.pairs[pairKey(owner, b)];
        let v = 0;
        let any = false;
        for (const e of list) {
            if (e.term !== term) continue;
            v += e.value;
            any = true;
        }
        return any ? v : null;
    }
    return null;
}

function pirateSum(r: PirateRelation): number | null {
    const a = r.thisEmpire;
    const b = r.otherEmpire;
    if (a === null || b === null) return null;
    const st = stateFor(a.galaxy);
    if (st === null) return null;
    const list = st.pairs[pairKey(a, b)];
    if (list === undefined) return null;
    let v = 0;
    for (const e of list) v += e.value;
    return v;
}

reputationChannel.incident = (ev) => evaluationSum(ev, 'incident');
reputationChannel.bias = (ev) => evaluationSum(ev, 'bias');
reputationChannel.pirate = pirateSum;

registerScenarioYearly({ id: 'reputation.decay', flag: REPUTATION_FLAG, run: (galaxy) => reputationYear(galaxy) });
