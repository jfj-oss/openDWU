// 19s-4 ARCHIVIST retrieval, sim side (tasks/19-mod-layer-scenarios.md §19s item 4). Not a port.
// The data half of the Archivist question box on the Galactic History screen: a small deterministic retriever
// (BM25 over the lines the player's empire knows) that picks the context the model answers from. The model call lives
// UI-side (llm/archivist.ts).
//
// Corpus, and only what the empire knows (the Galactic History view of the log, log.ts eventsKnownTo):
// - event lines of the 19p event log the empire was told of or took part in ("2105.03.12 [War] text");
// - the paragraphs of its own chronicle (19s-1; written from the known events only);
// - the lines of its current grounding digest (digestText, without its "Recent:" events, which are in the log).
// Pure: reads the galaxy, never writes state, never draws galaxy.rnd; same state + question → same lines.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import { resolveStarDateDescription } from '../../galaxyTime';
import { galaxyStarDate } from '../../tick/simTime';
import { scenarioFlag, scenarioParam } from '../state';
import { eventLogOn, eventsKnownTo } from '../eventLog/log';
import { categoryLabel, resolveEntryText } from '../eventLog/chronicle';
import { chronicleYears, llmOn, yearStartStarDate } from './chronicle';
import { digestFor, digestText, estimateTokens } from './digest';

export const ARCHIVIST_FLAG = 'llmArchivist';
/** Lines handed to the archivist by default (param `llmArchivistLines`); never more than ARCHIVE_MAX_LINES. */
export const ARCHIVE_DEFAULT_LINES = 12;
export const ARCHIVE_MAX_LINES = 20;
/** Token budget of the retrieved context (estimateTokens of the lines as sent). */
export const ARCHIVE_MAX_TOKENS = 400;
/** A line is clipped to this many characters. */
export const ARCHIVE_LINE_CHARS = 220;

/** The 19s-4 package is on (flag llmArchivist; needs llmFoundations). Gates the natural-language orders too. */
export function archivistOn(galaxy: Galaxy | null | undefined): boolean {
    return llmOn(galaxy) && scenarioFlag(galaxy!, ARCHIVIST_FLAG);
}

/** The question box runs: the package on and the event log (its corpus) on. */
export function archiveQuestionsOn(galaxy: Galaxy | null | undefined): boolean {
    return archivistOn(galaxy) && eventLogOn(galaxy);
}

export type ArchiveSource = 'event' | 'chronicle' | 'digest';

export interface ArchiveLine {
    source: ArchiveSource;
    /** "YYYY.MM.DD" for events and the digest, the calendar year for chronicle paragraphs. */
    date: string;
    /** The text as shown and cited ("[War] …" for events). */
    line: string;
    /** Sort keys: star date (events / digest) or the year's start; importance 0-3 (chronicle 1, digest 0). */
    starDate: number;
    importance: number;
    /** Stable id: `e<log id>`, `c<year>.<paragraph>`, `d<line>`. */
    id: string;
}

export interface ScoredLine extends ArchiveLine {
    score: number;
}

export interface ArchiveRetrieval {
    question: string;
    /** The query terms after normalisation (stop words dropped). */
    terms: string[];
    /** The selected lines, best first. */
    lines: ScoredLine[];
    /** False when no line matched a query term (the lines are then the most important recent ones). */
    matched: boolean;
    /** estimateTokens of the lines as sent (archiveContextText). */
    tokens: number;
    /** Lines in the corpus (what the empire knows). */
    corpus: number;
}

function clipLine(s: string): string {
    const t = s.replace(/\s*\n+\s*/g, ' ').replace(/\s+/g, ' ').trim();
    return t.length > ARCHIVE_LINE_CHARS ? t.slice(0, ARCHIVE_LINE_CHARS - 1) + '…' : t;
}

/** Everything the empire knows, as lines (log order, then the chronicle by year, then the digest). Pure. */
export function archiveCorpus(galaxy: Galaxy, empire: Empire): ArchiveLine[] {
    const out: ArchiveLine[] = [];
    for (const e of eventsKnownTo(galaxy, empire)) {
        out.push({
            source: 'event',
            date: resolveStarDateDescription(e.starDate),
            line: clipLine(`[${categoryLabel(e.category)}] ${resolveEntryText(e)}`),
            starDate: e.starDate,
            importance: e.importance,
            id: `e${e.id}`,
        });
    }
    for (const c of chronicleYears(galaxy, empire)) {
        const paras = c.source === 'fallback' ? c.text.split('\n') : c.text.split(/\n\s*\n/);
        let i = 0;
        for (const p of paras) {
            const t = p.replace(/^-\s*/, '').trim();
            if (t === '' || /^[^:]{1,30}:$/.test(t) || /^\(.*\)$/.test(t)) continue; // fallback headings / notes
            out.push({ source: 'chronicle', date: String(c.year), line: clipLine(`Chronicle "${c.title}": ${t}`), starDate: yearStartStarDate(c.year), importance: 1, id: `c${c.year}.${i++}` });
        }
    }
    const now = galaxyStarDate(galaxy);
    const date = resolveStarDateDescription(now);
    const dl = digestText(digestFor(galaxy, empire)).split('\n');
    for (let i = 0; i < dl.length; i++) {
        if (dl[i] === 'Recent:') break;
        const t = dl[i].trim();
        if (t !== '') out.push({ source: 'digest', date, line: clipLine(`Now: ${t}`), starDate: now, importance: 0, id: `d${i}` });
    }
    return out;
}

// ---------------------------------------------------------------------------------------------------------------
// BM25
// ---------------------------------------------------------------------------------------------------------------

const STOP = new Set(
    (
        'a an the and or but of to in on at by for from with about as is are was were be been being do does did has have had ' +
        'what when where which who whom whose why how that this these those there here it its it\'s our ours we us you your ' +
        'they them their i me my he she his her not no any some all ever did can could would should will shall may might ' +
        'tell me please know known happen happened happening last first recent recently since between into than then so ' +
        'many much most more year years time times'
    ).split(/\s+/),
);

/** Lower-case word tokens (letters / digits), a light plural / tense strip; stop words dropped. Deterministic. */
export function archiveTokens(text: string): string[] {
    const out: string[] = [];
    for (const raw of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
        if (raw.length < 2 || STOP.has(raw)) continue;
        out.push(stem(raw));
    }
    return out;
}

function stem(w: string): string {
    if (/^\d+$/.test(w)) return w;
    if (w.length > 5 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
    if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
    if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
    if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
    return w;
}

/** The indexed text of a line: its date parts (year, "2105.03") and its text. */
function lineTokens(l: ArchiveLine): string[] {
    const dateParts = l.date.split('.');
    const extra = dateParts.length >= 2 ? [`${dateParts[0]}`, `${dateParts[0]}.${dateParts[1]}`] : [l.date];
    return [...archiveTokens(l.line), ...extra.map((x) => x.toLowerCase())];
}

const K1 = 1.2;
const B = 0.75;

/** BM25 scores of `lines` for `terms` (query terms counted once each). Pure. */
export function bm25(lines: readonly ArchiveLine[], terms: readonly string[]): number[] {
    const docs = lines.map(lineTokens);
    const n = docs.length;
    const avg = n > 0 ? docs.reduce((s, d) => s + d.length, 0) / n : 0;
    const q = [...new Set(terms)];
    const df = new Map<string, number>();
    for (const d of docs) for (const t of new Set(d)) if (q.includes(t)) df.set(t, (df.get(t) ?? 0) + 1);
    return docs.map((d) => {
        let s = 0;
        for (const t of q) {
            const f = df.get(t);
            if (f === undefined) continue;
            let tf = 0;
            for (const x of d) if (x === t) tf++;
            if (tf === 0) continue;
            const idf = Math.log(1 + (n - f + 0.5) / (f + 0.5));
            s += (idf * tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * d.length) / (avg || 1)));
        }
        return s;
    });
}

/** The line as sent to the model and shown: "date | text". */
export function archiveLineText(l: ArchiveLine): string {
    return `${l.date} | ${l.line}`;
}

/** The retrieved lines as the prompt's RECORDS block. */
export function archiveContextText(lines: readonly ArchiveLine[]): string {
    return lines.map(archiveLineText).join('\n');
}

export interface RetrieveOptions {
    /** Lines at most (default param llmArchivistLines, else ARCHIVE_DEFAULT_LINES; capped at ARCHIVE_MAX_LINES). */
    k?: number;
    /** Token budget (default ARCHIVE_MAX_TOKENS). */
    maxTokens?: number;
}

/**
 * The top-K lines for `question` among what `empire` knows: BM25 (with a small importance weight), ties broken by
 * importance, then newer first, then id; lines added best first while they fit the token budget. No term matched →
 * the most important, newest lines. Pure and deterministic.
 */
export function retrieveArchive(galaxy: Galaxy, empire: Empire, question: string, opts: RetrieveOptions = {}): ArchiveRetrieval {
    const corpus = archiveCorpus(galaxy, empire);
    const k = Math.max(1, Math.min(ARCHIVE_MAX_LINES, Math.trunc(opts.k ?? scenarioParam(galaxy, 'llmArchivistLines', ARCHIVE_DEFAULT_LINES))));
    const maxTokens = Math.max(1, Math.min(ARCHIVE_MAX_TOKENS, opts.maxTokens ?? ARCHIVE_MAX_TOKENS));
    const terms = archiveTokens(question);
    const raw = bm25(corpus, terms);
    const scored: ScoredLine[] = corpus.map((l, i) => ({ ...l, score: raw[i] > 0 ? Math.round(raw[i] * (1 + 0.1 * l.importance) * 1e6) / 1e6 : 0 }));
    const matched = scored.some((l) => l.score > 0);
    const pool = matched ? scored.filter((l) => l.score > 0) : scored.filter((l) => l.source !== 'digest');
    pool.sort((a, b) => b.score - a.score || b.importance - a.importance || b.starDate - a.starDate || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const lines: ScoredLine[] = [];
    let tokens = 0;
    for (const l of pool) {
        if (lines.length >= k) break;
        const t = estimateTokens(archiveLineText(l) + '\n');
        if (tokens + t > maxTokens) continue;
        lines.push(l);
        tokens += t;
    }
    return { question, terms, lines, matched, tokens, corpus: corpus.length };
}

/** The scripted fallback text (no model): the retrieved lines as they are. */
export function archiveFallbackText(r: ArchiveRetrieval): string {
    if (r.lines.length === 0) return 'The archive holds nothing on that.';
    return (r.matched ? 'The records that best match your question:' : 'Nothing matched your words; the most notable records:') + '\n' + r.lines.map((l) => `- ${archiveLineText(l)}`).join('\n');
}
