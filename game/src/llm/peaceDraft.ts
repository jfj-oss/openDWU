// 19g-3 peace talks: plain words -> a draft of peace terms (docs/llm-diplomacy plan §4). Not a port.
//
// The terms panel's words box sends what the player typed plus the panel's own choices (colonies, systems, subjects,
// treaty rights, as short ids) through the foundations queue ('player' priority) and gets the ids back. The answer is
// validated against the choices (an invented id is dropped, numbers are clamped) and only fills the panel's Draft: the
// player sees the real terms, may edit them, and presses the panel's own button, which issues the stock
// `proposePeaceTerms` command (sanitiseTerms re-validates it in the sim). Nothing here writes the game. No model -> null.

import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import type { Habitat } from '../sim/types';
import { termsChoices, sanitiseTerms, warView } from '../sim/scenario/lively/peaceTerms';
import type { PeaceTerms, ScenarioTerm } from '../sim/scenario/lively/warGoals';
import { voidbloomTermChoices, voidbloomTermText } from '../sim/scenario/voidbloom/treaty'; // [voidbloom]
import type { ChatMessage } from '../ui/advisorClient';
import type { LlmQueue, LlmResult } from './queue';
import { readReplica } from './replicaReads';

export const PEACE_DRAFT_PROMPT_VERSION = 1;

export interface PeaceChoices {
    theirColonies: Habitat[];
    ourColonies: Habitat[];
    theirSystems: Habitat[];
    subject: Empire | null;
    extra: ScenarioTerm[];
}

export interface PeaceDraftResult {
    terms: PeaceTerms;
    understood: string;
    unmapped: string;
}

export function peaceChoices(galaxy: Galaxy, player: Empire, other: Empire): PeaceChoices {
    const c = termsChoices(galaxy, player, other);
    return { theirColonies: c.theirColonies, ourColonies: c.ourColonies, theirSystems: c.theirSystems, subject: c.theirSubjects[0] ?? null, extra: voidbloomTermChoices(galaxy, player, other) };
}

const ids = (prefix: string, n: number): string[] => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);

export function peaceDraftSchema(ch: PeaceChoices): object {
    const set = (list: string[]): object => ({ type: 'array', items: list.length > 0 ? { enum: list } : { enum: ['none'] } });
    return {
        type: 'object',
        additionalProperties: false,
        required: ['understood', 'cedeTheirs', 'cedeOurs', 'payer', 'lump', 'perYear', 'years', 'demil', 'demilYears', 'release', 'extra', 'unmapped'],
        properties: {
            understood: { type: 'string' },
            cedeTheirs: set(ids('tc', ch.theirColonies.length)),
            cedeOurs: set(ids('oc', ch.ourColonies.length)),
            payer: { enum: ['none', 'they', 'we'] },
            lump: { type: 'integer', minimum: 0 },
            perYear: { type: 'integer', minimum: 0 },
            years: { type: 'integer', minimum: 0, maximum: 20 },
            demil: set(ids('ts', ch.theirSystems.length)),
            demilYears: { type: 'integer', minimum: 1, maximum: 30 },
            release: { type: 'boolean' },
            extra: set(ids('x', ch.extra.length)),
            unmapped: { type: 'string' },
        },
    };
}

export const PEACE_DRAFT_SYSTEM = [
    'You turn a player\'s plain-words peace proposal into the fields of a peace-terms form in the space strategy game Distant Worlds. "We/us/our" is the player; "they/them" is the enemy empire.',
    'Use ONLY the ids listed under CHOICES. If the player asks for something that has no id or field, leave it out and say so in "unmapped". Never invent ids or numbers the player did not say.',
    'cedeTheirs: their colonies they hand to us. cedeOurs: our colonies we hand to them. payer: who pays reparations (none/they/we) with lump (one-off) and perYear over years. demil: their border systems they must demilitarise for demilYears. release: they free their subject. extra: treaty rights.',
    '"understood" is one short sentence restating the proposal. Answer with JSON only.',
].join('\n');

export function peaceChoicesText(galaxy: Galaxy, player: Empire, other: Empire, ch: PeaceChoices): string {
    const list = (prefix: string, hs: Habitat[]): string => (hs.length > 0 ? hs.map((h, i) => `${prefix}${i + 1}=${h.name}`).join(', ') : '(none)');
    const view = warView(galaxy, player, other);
    return [
        `THEIR_COLONIES: ${list('tc', ch.theirColonies)}`,
        `OUR_COLONIES: ${list('oc', ch.ourColonies)}`,
        `THEIR_SYSTEMS (demilitarise): ${list('ts', ch.theirSystems)}`,
        `SUBJECT (release): ${ch.subject?.name ?? '(none)'}`,
        `EXTRA: ${ch.extra.length > 0 ? ch.extra.map((x, i) => `x${i + 1}=${voidbloomTermText(x)}`).join(', ') : '(none)'}`,
        `WAR SCORE: ours ${view?.us.score ?? 0}, theirs ${view?.them.score ?? 0}. Treasury: ours ${Math.round(player.stateMoney)}, theirs ${Math.round(other.stateMoney)}.`,
    ].join('\n');
}

export function buildPeaceMessages(galaxy: Galaxy, player: Empire, other: Empire, ch: PeaceChoices, text: string): ChatMessage[] {
    const system = `${PEACE_DRAFT_SYSTEM}\n\nCHOICES (the enemy is the ${other.name}):\n${peaceChoicesText(galaxy, player, other, ch)}`;
    return [
        { role: 'system', content: system },
        { role: 'user', content: text.trim().slice(0, 400) },
    ];
}

const pickIds = (raw: unknown, list: Habitat[], prefix: string): Habitat[] => {
    const out: Habitat[] = [];
    if (!Array.isArray(raw)) return out;
    for (const x of raw) {
        const m = typeof x === 'string' && x.startsWith(prefix) ? Number(x.slice(prefix.length)) : NaN;
        const h = Number.isInteger(m) ? list[m - 1] : undefined;
        if (h !== undefined && !out.includes(h)) out.push(h);
    }
    return out;
};
const clampInt = (v: unknown, lo: number, hi: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.floor(v))) : lo);

/** The model's answer -> terms from `player`'s side (invented ids dropped, numbers clamped, then sanitised), or null when unusable. */
export function parsePeaceAnswer(galaxy: Galaxy, player: Empire, other: Empire, ch: PeaceChoices, raw: string): PeaceDraftResult | null {
    let o: Record<string, unknown>;
    try {
        o = JSON.parse(raw) as Record<string, unknown>;
    } catch {
        return null;
    }
    if (o === null || typeof o !== 'object') return null;
    const t: PeaceTerms = { cede: [], reparations: null, demilitarise: null, release: null };
    for (const c of pickIds(o.cedeTheirs, ch.theirColonies, 'tc')) t.cede.push({ colony: c, from: other, to: player });
    for (const c of pickIds(o.cedeOurs, ch.ourColonies, 'oc')) t.cede.push({ colony: c, from: player, to: other });
    const payer = o.payer === 'we' ? player : o.payer === 'they' ? other : null;
    if (payer !== null) {
        const lump = clampInt(o.lump, 0, 2_000_000_000);
        const years = clampInt(o.years, 0, 20);
        const perYear = clampInt(o.perYear, 0, 2_000_000_000);
        if (lump > 0 || (perYear > 0 && years > 0)) t.reparations = { payer, payee: payer === player ? other : player, lump, perYear, years };
    }
    const systems = pickIds(o.demil, ch.theirSystems, 'ts');
    if (systems.length > 0) t.demilitarise = { empire: other, beneficiary: player, systems, years: clampInt(o.demilYears, 1, 30) };
    if (o.release === true && ch.subject !== null) t.release = { overlord: other, subject: ch.subject };
    if (Array.isArray(o.extra)) {
        const extra = ch.extra.filter((_, i) => (o.extra as unknown[]).includes(`x${i + 1}`));
        if (extra.length > 0) t.extra = extra;
    }
    const str = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 240) : '');
    return { terms: sanitiseTerms(galaxy, t, player, other), understood: str(o.understood), unmapped: str(o.unmapped) };
}

/** Plain words -> a draft. Null: no model / unusable answer (the panel keeps working by hand). Never rejects, never writes. */
export async function interpretPeaceWords(galaxy: Galaxy, player: Empire, other: Empire, queue: LlmQueue | null, text: string): Promise<PeaceDraftResult | null> {
    if (queue === null || text.trim() === '') return null;
    const ch = readReplica(galaxy, () => peaceChoices(galaxy, player, other));
    const messages = readReplica(galaxy, () => buildPeaceMessages(galaxy, player, other, ch, text));
    let res: LlmResult;
    try {
        res = await queue.submit({
            priority: 'player',
            purpose: 'peaceDraft',
            situation: `v${PEACE_DRAFT_PROMPT_VERSION}\n${messages[0].content}\n${messages[1].content}`,
            messages,
            schema: peaceDraftSchema(ch),
            schemaName: 'peace_terms',
            temperature: 0,
            cache: false,
        });
    } catch {
        return null;
    }
    if (res.outcome !== 'ok' && res.outcome !== 'cached') return null;
    return parsePeaceAnswer(galaxy, player, other, ch, res.text);
}
