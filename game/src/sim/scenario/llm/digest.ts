// 19s-1 grounding digests (tasks/19-mod-layer-scenarios.md §19s item 1). Not a port. ONE fixed-schema, compact JSON view
// of an empire's situation (optionally toward one other empire) that every local-model prompt is grounded on: identity,
// standing, claims and casus belli, open leads, council seat and recent motions, wars with score and goals, economy,
// rim standing and the last event-log lines between the two. ≤ DIGEST_MAX_CHARS serialised (≈ 400 tokens): the
// builder trims the longest optional parts until it fits.
//
// PURE: reads the galaxy and the scenario state bags, never creates a bag, never writes, never draws galaxy.rnd (safe
// from the UI, a background job, tests). Every section reads its package state behind a presence check
// (`galaxy.scenario.state[key]` + shape checks), so packages that are not on this build (19o reputation ledger, 19n
// court / intrigue) are simply absent from the digest and light up once merged.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import { CharacterTraitType } from '../../characters';
import { DiplomaticRelationType, empireEvaluationByEmpire, empireEvaluationsOf } from '../../diplomacy';
import { calculateAnnualCashflow } from '../../treasury';
import { resolveStarDateDescription } from '../../galaxyTime';
import { galaxyStarDate } from '../../tick/simTime';
import { tryGetText } from '../../textResolver';
import { RACE_FAMILY_NAMES, governmentName } from '../../player/diplomatBrief';
import { scenarioFlag, scenarioParam } from '../state';
import { eventsBetween, timeline } from '../eventLog/log';
import { resolveEntryText } from '../eventLog/chronicle';
import { enemySideOf, peekWarLedger, sideOf, sideScore, type WarGoal } from '../lively/warGoals';

/** Serialised size cap (compact JSON), ≈ 400 tokens at ~4 characters per token. */
export const DIGEST_MAX_CHARS = 1600;
/** Default event-log lines (param `llmDigestEvents`). */
export const DIGEST_DEFAULT_EVENTS = 6;

// ---------------------------------------------------------------------------------------------------------------
// Schema (v1). Optional sections are left out when their package is absent / has nothing to say.
// ---------------------------------------------------------------------------------------------------------------

export interface DigestIdentity {
    name: string;
    race: string;
    family: string;
    gov: string;
    ruler: { name: string; traits: string[] } | null;
    /** 19n court: the ruler's legitimacy 0–100, the ruling house, the filled council seats ("marshal:Name"). */
    legitimacy?: number;
    house?: string;
    seats?: string[];
}

export interface DigestCause {
    /** Display label (the cause's GameText, else its id). */
    c: string;
    v: number;
}

export interface DigestStanding {
    name: string;
    race: string;
    gov: string;
    /** DiplomaticRelationType name (our side). */
    relation: string;
    /** Stock EmpireEvaluation.OverallAttitude: ours toward them / theirs toward us (null when not evaluated). */
    attitude: number | null;
    theirAttitude: number | null;
    /** 19o ledger (when present): our sum about them, our top causes, what they hold against us. */
    reputation?: { sum: number; causes: DigestCause[]; held: DigestCause[] };
}

export interface DigestClaim {
    on: string;
    owner: string;
    cause: string;
    strength: number;
}

export interface DigestClaims {
    ours: DigestClaim[];
    /** Their claims on our colonies (count; with `other`). */
    theirs: number;
    /** Empires we hold a casus belli against. */
    casusBelli: string[];
}

export interface DigestLead {
    kind: string;
    level: string;
    at: string;
}

export interface DigestMotion {
    kind: string;
    text: string;
    passed: boolean;
    yes: number;
    no: number;
    abstain: number;
}

export interface DigestCouncil {
    name: string;
    chair: boolean;
    members: number;
    bloc?: string;
    /** The motion now on the floor and our vote on it (when cast). */
    voting?: { kind: string; text: string; vote?: string };
    recent: DigestMotion[];
    threats?: string[];
    sanctioned?: boolean;
}

export interface DigestWar {
    vs: string;
    /** 19g-3 war score balance −100..100 for us (null without a ledger). */
    score: number | null;
    goal?: string;
    theirGoal?: string;
}

export interface LlmDigest {
    v: 1;
    date: string;
    self: DigestIdentity;
    other?: DigestStanding;
    claims?: DigestClaims;
    leads?: { open: number; top: DigestLead[] };
    council?: DigestCouncil;
    wars?: DigestWar[];
    economy: { money: number; cashflow: number; colonies: number };
    rim?: { concord?: 'self' | { credit: number; debit: number }; herders?: number };
    /** Resolved one-liners from the event log (19p), oldest first: "YYYY.MM.DD text". */
    events: string[];
}

// ---------------------------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------------------------

function clip(s: string, n: number): string {
    const t = s.replace(/\s+/g, ' ').trim();
    return t.length > n ? t.substring(0, n - 1) + '…' : t;
}

function rec(x: unknown): Record<string, unknown> | null {
    return typeof x === 'object' && x !== null ? (x as Record<string, unknown>) : null;
}

function stateBag(galaxy: Galaxy, key: string): Record<string, unknown> | null {
    const s = galaxy.scenario;
    if (s === null || !(key in s.state)) return null;
    return rec(s.state[key]);
}

function arr(x: unknown): unknown[] {
    return Array.isArray(x) ? x : [];
}

function nameOf(x: unknown): string {
    const r = rec(x);
    return r !== null && typeof r.name === 'string' ? clip(r.name, 28) : '?';
}

function empireName(e: Empire | null | undefined): string {
    return e != null ? clip(e.name, 32) : '?';
}

function relationWith(a: Empire, b: Empire): DiplomaticRelationType {
    return a.diplomaticRelations.byEmpire(b)?.type ?? DiplomaticRelationType.NotMet;
}

function attitudeOf(a: Empire, b: Empire): number | null {
    const ev = empireEvaluationByEmpire(empireEvaluationsOf(a), b);
    return ev !== null && Number.isFinite(ev.overallAttitude) ? Math.round(ev.overallAttitude) : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------------------------------------------

function identity(galaxy: Galaxy, e: Empire): DigestIdentity {
    const race = e.dominantRace ?? null;
    const leader = e.leader;
    const out: DigestIdentity = {
        name: empireName(e),
        race: race?.name ?? '',
        family: race !== null ? (RACE_FAMILY_NAMES[race.raceFamily] ?? '') : '',
        gov: governmentName(e),
        ruler:
            leader !== null
                ? { name: clip(leader.name, 28), traits: leader.traits.filter((t) => t !== CharacterTraitType.Undefined).slice(0, 3).map((t) => CharacterTraitType[t]) }
                : null,
    };
    // 19n court (sibling branch; read behind presence checks): legitimacy, ruling house, filled seats.
    const court = stateBag(galaxy, 'court');
    if (court !== null && scenarioFlag(galaxy, 'courtDynasties')) {
        const legit = court.legitimacy;
        if (legit instanceof Map && leader !== null) {
            const v = legit.get(leader);
            out.legitimacy = typeof v === 'number' ? Math.round(v) : 50;
        }
        const ruling = court.ruling;
        if (ruling instanceof Map) {
            const id = ruling.get(e);
            const house = arr(court.houses).map(rec).find((h) => h !== null && h.id === id);
            if (house != null && typeof house.name === 'string') out.house = clip(house.name, 28);
        }
        const seats = court.seats instanceof Map ? rec(court.seats.get(e)) : null;
        if (seats !== null) {
            const filled: string[] = [];
            for (const seat of ['spymaster', 'chancellor', 'marshal', 'steward', 'magistrate']) {
                const c = rec(seats[seat]);
                if (c !== null && typeof c.name === 'string') filled.push(`${seat}:${clip(c.name, 20)}`);
            }
            if (filled.length > 0) out.seats = filled;
        }
    }
    return out;
}

function repCauses(galaxy: Galaxy, a: Empire, b: Empire): DigestCause[] | null {
    const st = stateBag(galaxy, 'reputation');
    if (st === null || !scenarioFlag(galaxy, 'reputationLedger')) return null;
    const pairs = rec(st.pairs);
    if (pairs === null) return null;
    const list = arr(pairs[`${a.empireId}>${b.empireId}`])
        .map(rec)
        .filter((x): x is Record<string, unknown> => x !== null && typeof x.value === 'number' && typeof x.cause === 'string');
    // Largest |value| first, ties in record order (ledger.ts reputationCauses).
    return list
        .map((x, i) => ({ x, i }))
        .sort((p, q) => Math.abs(q.x.value as number) - Math.abs(p.x.value as number) || p.i - q.i)
        .map(({ x }) => ({ c: clip((typeof x.labelKey === 'string' ? tryGetText(x.labelKey) : null) ?? (x.cause as string), 40), v: Math.round(x.value as number) }));
}

function standing(galaxy: Galaxy, e: Empire, other: Empire): DigestStanding {
    const race = other.dominantRace ?? null;
    const out: DigestStanding = {
        name: empireName(other),
        race: race?.name ?? '',
        gov: governmentName(other),
        relation: DiplomaticRelationType[relationWith(e, other)] ?? 'NotMet',
        attitude: attitudeOf(e, other),
        theirAttitude: attitudeOf(other, e),
    };
    const ours = repCauses(galaxy, e, other);
    const theirs = repCauses(galaxy, other, e);
    if (ours !== null && theirs !== null) {
        out.reputation = {
            sum: ours.reduce((s, x) => s + x.v, 0),
            causes: ours.slice(0, 5),
            // ledger.ts grievances(other, e): their negative entries about us, worst first.
            held: theirs.filter((x) => x.v < 0).slice(0, 3),
        };
    }
    return out;
}

function claims(galaxy: Galaxy, e: Empire, other: Empire | null): DigestClaims | undefined {
    const intrigue = scenarioFlag(galaxy, 'courtIntrigue') ? stateBag(galaxy, 'courtIntrigue') : null;
    const wg = stateBag(galaxy, 'warGoals');
    if (intrigue === null && wg === null) return undefined;
    const ours: DigestClaim[] = [];
    let theirs = 0;
    const cb = new Set<string>();
    for (const c of arr(intrigue?.claims).map(rec)) {
        if (c === null) continue;
        const colony = rec(c.colony);
        if (colony === null || colony.hasBeenDestroyed === true) continue;
        const owner = colony.empire as Empire | null;
        if (owner === null || owner === undefined) continue;
        if (c.empire === e && owner !== e && (other === null || owner === other)) {
            ours.push({ on: nameOf(colony), owner: empireName(owner), cause: String(c.cause), strength: Math.round(typeof c.base === 'number' ? c.base : 0) });
            if (c.cause === 'casusBelli' && c.against != null) cb.add(empireName(c.against as Empire));
        } else if (other !== null && c.empire === other && owner === e) theirs++;
    }
    const held = rec(wg?.casusBelli);
    if (held !== null) {
        for (const key of Object.keys(held)) {
            const [victim, breacher] = key.split(':').map(Number);
            if (victim !== e.empireId) continue;
            const b = galaxy.empires.find((x) => x !== null && x.empireId === breacher);
            if (b != null) cb.add(empireName(b));
        }
    }
    if (ours.length === 0 && theirs === 0 && cb.size === 0) return undefined;
    ours.sort((a, b) => b.strength - a.strength);
    return { ours: ours.slice(0, 3), theirs, casusBelli: [...cb].sort().slice(0, 3) };
}

function leads(galaxy: Galaxy, e: Empire): LlmDigest['leads'] {
    const st = stateBag(galaxy, 'security');
    if (st === null) return undefined;
    const open = arr(st.leads)
        .map(rec)
        .filter((l): l is Record<string, unknown> => l !== null && l.empire === e && l.closed !== true && l.level !== 'cleared');
    if (open.length === 0) return undefined;
    const top = open
        .map((l, i) => ({ l, i }))
        .sort((a, b) => ((b.l.level === 'confirmed' ? 1 : 0) - (a.l.level === 'confirmed' ? 1 : 0)) || ((b.l.updated as number) ?? 0) - ((a.l.updated as number) ?? 0) || a.i - b.i)
        .slice(0, 3)
        .map(({ l }) => ({ kind: String(l.kind), level: String(l.level), at: nameOf(l.target) }));
    return { open: open.length, top };
}

function council(galaxy: Galaxy, e: Empire): DigestCouncil | undefined {
    const st = stateBag(galaxy, 'council');
    if (st === null) return undefined;
    const c = arr(st.councils)
        .map(rec)
        .find((x) => x !== null && arr(x.members).includes(e));
    if (c == null) return undefined;
    const out: DigestCouncil = {
        name: clip(String(c.name ?? ''), 40),
        chair: c.chair === e,
        members: arr(c.members).length,
        recent: arr(c.results)
            .slice(-3)
            .map(rec)
            .filter((r): r is Record<string, unknown> => r !== null)
            .map((r) => ({ kind: String(r.kind), text: clip(String(r.text ?? ''), 70), passed: r.passed === true, yes: Number(r.yes) || 0, no: Number(r.no) || 0, abstain: Number(r.abstain) || 0 })),
    };
    const bloc = arr(c.blocs).map(rec).find((b) => b !== null && arr(b.members).includes(e));
    if (bloc != null) out.bloc = clip(String(bloc.name ?? ''), 30);
    const m = rec(c.motion);
    if (m !== null && m.status === 'voting') {
        const v = arr(m.votes).map(rec).find((x) => x !== null && x.empire === e);
        out.voting = { kind: String(m.kind), text: clip(String(m.text ?? ''), 70) };
        if (v != null) out.voting.vote = String(v.vote);
    }
    const threats = arr(c.threats).map((t) => empireName(t as Empire));
    if (threats.length > 0) out.threats = threats.slice(0, 3);
    if (arr(c.sanctions).some((s) => rec(s)?.target === e)) out.sanctioned = true;
    return out;
}

function goalText(g: WarGoal | undefined): string | undefined {
    if (g === undefined) return undefined;
    const names = g.colonies.slice(0, 2).map((c) => clip(c.name, 20));
    if (g.subject !== null) names.push(empireName(g.subject));
    return names.length > 0 ? `${g.kind}: ${names.join(', ')}` : g.kind;
}

function wars(galaxy: Galaxy, e: Empire, other: Empire | null): DigestWar[] | undefined {
    const enemies: Empire[] = [];
    for (const r of e.diplomaticRelations) {
        if (r.type === DiplomaticRelationType.War && r.otherEmpire !== null && r.otherEmpire.active) enemies.push(r.otherEmpire);
    }
    if (enemies.length === 0) return undefined;
    // `other` first, then galaxy empire order (deterministic).
    enemies.sort((a, b) => (a === other ? -1 : b === other ? 1 : a.empireId - b.empireId));
    return enemies.slice(0, 3).map((x) => {
        const l = peekWarLedger(galaxy, e, x);
        if (l === null) return { vs: empireName(x), score: null };
        const mine = sideOf(l, e);
        const theirs = enemySideOf(l, e);
        const a = sideScore(galaxy, l, mine);
        const b = sideScore(galaxy, l, theirs);
        return { vs: empireName(x), score: Math.round((100 * (a - b)) / (a + b + 1)), goal: goalText(mine.goal), theirGoal: goalText(theirs.goal) };
    });
}

function economy(galaxy: Galaxy, e: Empire): LlmDigest['economy'] {
    // ThisYearsSpacePortIncome resets / ages per-base income on read unless the empire is in averaged mode: read it in
    // averaged mode so the digest stays side-effect free (scripts/sim-run.mjs does the same).
    const avg = e.useAveragedVariableIncome;
    e.useAveragedVariableIncome = true;
    let cash = 0;
    try {
        cash = calculateAnnualCashflow(galaxy, e);
    } catch {
        cash = 0;
    } finally {
        e.useAveragedVariableIncome = avg;
    }
    return { money: Math.round(e.stateMoney), cashflow: Number.isFinite(cash) ? Math.round(cash) : 0, colonies: e.colonies.length };
}

function rim(galaxy: Galaxy, e: Empire): LlmDigest['rim'] {
    const out: NonNullable<LlmDigest['rim']> = {};
    const trade = stateBag(galaxy, 'rimTrade');
    if (trade !== null && typeof trade.empireId === 'number' && trade.empireId >= 0) {
        if (trade.empireId === e.empireId) out.concord = 'self';
        else {
            const l = rec(rec(trade.ledger)?.[e.empireId]);
            if (l !== null) out.concord = { credit: Math.round(Number(l.credit) || 0), debit: Math.round(Number(l.debit) || 0) };
        }
    }
    const herders = stateBag(galaxy, 'rimHerders');
    const v = rec(herders?.standing)?.[e.empireId];
    if (typeof v === 'number') out.herders = Math.round(v);
    return out.concord !== undefined || out.herders !== undefined ? out : undefined;
}

function events(galaxy: Galaxy, e: Empire, other: Empire | null, n: number): string[] {
    if (n <= 0) return [];
    const list = other !== null ? eventsBetween(galaxy, e, other) : timeline(galaxy, e);
    return list.slice(-n).map((x) => clip(`${resolveStarDateDescription(x.starDate)} ${resolveEntryText(x)}`, 100));
}

// ---------------------------------------------------------------------------------------------------------------
// Builder + size bound
// ---------------------------------------------------------------------------------------------------------------

export function digestSize(d: LlmDigest): number {
    return JSON.stringify(d).length;
}

/** ~4 characters per token (the local models' tokenisers land within ±20 % on this kind of JSON). */
export function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

/** Shrinks the optional parts, least valuable first, until the digest fits `max` characters. Mutates `d`. */
function fit(d: LlmDigest, max: number): void {
    const steps: (() => boolean)[] = [
        () => d.events.length > 3 && (d.events.shift(), true),
        () => (d.wars?.length ?? 0) > 1 && (d.wars!.pop(), true),
        () => (d.council?.recent.length ?? 0) > 1 && (d.council!.recent.shift(), true),
        () => (d.other?.reputation?.causes.length ?? 0) > 3 && (d.other!.reputation!.causes.pop(), true),
        () => (d.claims?.ours.length ?? 0) > 1 && (d.claims!.ours.pop(), true),
        () => (d.leads?.top.length ?? 0) > 1 && (d.leads!.top.pop(), true),
        () => (d.self.seats?.length ?? 0) > 0 && (delete d.self.seats, true),
        () => (d.other?.reputation?.held.length ?? 0) > 1 && (d.other!.reputation!.held.pop(), true),
        () => d.events.length > 0 && (d.events.shift(), true),
        () => d.council?.threats !== undefined && (delete d.council.threats, true),
        () => (d.council?.recent.length ?? 0) > 0 && (d.council!.recent.shift(), true),
    ];
    for (const step of steps) {
        while (digestSize(d) > max) if (!step()) break;
        if (digestSize(d) <= max) return;
    }
}

export interface DigestOptions {
    /** Event-log lines (default: param `llmDigestEvents`, else 6). */
    events?: number;
    /** Size cap in serialised characters (default DIGEST_MAX_CHARS). */
    maxChars?: number;
}

/**
 * The grounding digest of `empire` (toward `other` when given). Pure and deterministic: the same galaxy state gives the
 * same object (and the same `digestText`).
 */
export function digestFor(galaxy: Galaxy, empire: Empire, other?: Empire | null, opts: DigestOptions = {}): LlmDigest {
    const o = other ?? null;
    const n = Math.max(0, Math.trunc(opts.events ?? scenarioParam(galaxy, 'llmDigestEvents', DIGEST_DEFAULT_EVENTS)));
    const d: LlmDigest = { v: 1, date: resolveStarDateDescription(galaxyStarDate(galaxy)), self: identity(galaxy, empire), economy: economy(galaxy, empire), events: events(galaxy, empire, o, n) };
    if (o !== null && o !== empire) d.other = standing(galaxy, empire, o);
    const cl = claims(galaxy, empire, o);
    if (cl !== undefined) d.claims = cl;
    const ld = leads(galaxy, empire);
    if (ld !== undefined) d.leads = ld;
    const cn = council(galaxy, empire);
    if (cn !== undefined) d.council = cn;
    const w = wars(galaxy, empire, o);
    if (w !== undefined) d.wars = w;
    const r = rim(galaxy, empire);
    if (r !== undefined) d.rim = r;
    // Key order fixed by construction above; re-assemble in schema order so JSON.stringify is stable.
    const ordered = {
        v: 1,
        date: d.date,
        self: d.self,
        ...(d.other !== undefined ? { other: d.other } : {}),
        ...(d.claims !== undefined ? { claims: d.claims } : {}),
        ...(d.leads !== undefined ? { leads: d.leads } : {}),
        ...(d.council !== undefined ? { council: d.council } : {}),
        ...(d.wars !== undefined ? { wars: d.wars } : {}),
        economy: d.economy,
        ...(d.rim !== undefined ? { rim: d.rim } : {}),
        events: d.events,
    } satisfies LlmDigest as LlmDigest;
    fit(ordered, opts.maxChars ?? DIGEST_MAX_CHARS);
    return ordered;
}

/** Compact JSON (the prompt form and the size the cap applies to). */
export function digestJson(d: LlmDigest): string {
    return JSON.stringify(d);
}

/** Plain-text rendering (the scripted fallback and the cache key's source). Deterministic. */
export function digestText(d: LlmDigest): string {
    const s = d.self;
    const lines: string[] = [];
    const ruler = s.ruler !== null ? `ruler ${s.ruler.name}${s.ruler.traits.length > 0 ? ` (${s.ruler.traits.join(', ')})` : ''}` : 'no ruler';
    const court = [s.house !== undefined ? `house ${s.house}` : '', s.legitimacy !== undefined ? `legitimacy ${s.legitimacy}` : ''].filter((x) => x !== '').join(', ');
    lines.push(`${d.date} — ${s.name}: ${[s.race, s.family, s.gov].filter((x) => x !== '').join(' / ')}; ${ruler}${court !== '' ? `; ${court}` : ''}.`);
    if (s.seats !== undefined) lines.push(`Council seats: ${s.seats.join(', ')}.`);
    if (d.other !== undefined) {
        const o = d.other;
        let line = `Toward ${o.name} (${[o.race, o.gov].filter((x) => x !== '').join(' / ')}): ${o.relation}; attitude ${o.attitude ?? 'n/a'}, theirs ${o.theirAttitude ?? 'n/a'}.`;
        if (o.reputation !== undefined) {
            const causes = o.reputation.causes.map((c) => `${c.c} ${c.v > 0 ? '+' : ''}${c.v}`).join(', ');
            line += ` Ledger ${o.reputation.sum}${causes !== '' ? ` (${causes})` : ''}.`;
            if (o.reputation.held.length > 0) line += ` They hold against us: ${o.reputation.held.map((c) => `${c.c} ${c.v}`).join(', ')}.`;
        }
        lines.push(line);
    }
    if (d.claims !== undefined) {
        const c = d.claims;
        const parts = c.ours.map((x) => `${x.on} of ${x.owner} (${x.cause} ${x.strength})`);
        lines.push(`Claims: ${parts.length > 0 ? parts.join('; ') : 'none'}${c.theirs > 0 ? `; they claim ${c.theirs} of ours` : ''}${c.casusBelli.length > 0 ? `; casus belli against ${c.casusBelli.join(', ')}` : ''}.`);
    }
    if (d.leads !== undefined) lines.push(`Open leads ${d.leads.open}: ${d.leads.top.map((l) => `${l.level} ${l.kind} at ${l.at}`).join('; ')}.`);
    if (d.council !== undefined) {
        const c = d.council;
        let line = `${c.name}: ${c.chair ? 'chair' : 'member'} of ${c.members}${c.bloc !== undefined ? `, bloc ${c.bloc}` : ''}${c.sanctioned === true ? ', under sanctions' : ''}.`;
        if (c.voting !== undefined) line += ` Voting on ${c.voting.kind}: ${c.voting.text}${c.voting.vote !== undefined ? ` (we vote ${c.voting.vote})` : ''}.`;
        for (const m of c.recent) line += ` ${m.passed ? 'Passed' : 'Failed'} ${m.kind} ${m.yes}-${m.no}-${m.abstain}: ${m.text}.`;
        if (c.threats !== undefined) line += ` Declared threats: ${c.threats.join(', ')}.`;
        lines.push(line);
    }
    if (d.wars !== undefined) {
        lines.push(`Wars: ${d.wars.map((w) => `${w.vs}${w.score !== null ? ` score ${w.score > 0 ? '+' : ''}${w.score}` : ''}${w.goal !== undefined ? `, our goal ${w.goal}` : ''}${w.theirGoal !== undefined ? `, theirs ${w.theirGoal}` : ''}`).join('; ')}.`);
    }
    lines.push(`Economy: ${d.economy.money} credits, cashflow ${d.economy.cashflow}/year, ${d.economy.colonies} colonies.`);
    if (d.rim !== undefined) {
        const parts: string[] = [];
        if (d.rim.concord === 'self') parts.push('we are the Rim Concord');
        else if (d.rim.concord !== undefined) parts.push(`Concord ledger +${d.rim.concord.credit}/-${d.rim.concord.debit}`);
        if (d.rim.herders !== undefined) parts.push(`herder goodwill ${d.rim.herders}`);
        lines.push(`Rim: ${parts.join(', ')}.`);
    }
    if (d.events.length > 0) {
        lines.push('Recent:');
        for (const ev of d.events) lines.push(`- ${ev}`);
    }
    return lines.join('\n');
}
