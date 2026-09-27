// 19s-4 ARCHIVIST (tasks/19-mod-layer-scenarios.md §19s item 4). Not a port.
//
// The question box on the Galactic History screen: the question → the deterministic retrieval over what the player's
// empire knows (sim/scenario/llm/archive.ts: event log lines it saw, its chronicle, its digest; top K ≤ 20 lines,
// ≤ 400 tokens) → ONE 'player'-priority request through the foundations queue, constrained to {answer, citations}.
// Citations are kept only when they match a retrieved line (the retrieved line is shown, never the model's copy), so
// nothing outside the player's knowledge is ever displayed. No model / refusal / bad answer → the scripted fallback:
// "no archivist available" plus the raw top-K lines. Read-only: nothing here writes the galaxy.

import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import { resolveStarDateDescription } from '../sim/galaxyTime';
import { galaxyStarDate } from '../sim/tick/simTime';
import { archiveContextText, archiveFallbackText, retrieveArchive, type ArchiveRetrieval, type ScoredLine } from '../sim/scenario/llm/archive';
import { fillPrompt } from './prompts/chronicle';
import { ARCHIVIST_PROMPT_VERSION, ARCHIVIST_SCHEMA, ARCHIVIST_SYSTEM } from './prompts/archivist';
import type { ChatMessage } from '../ui/advisorClient';
import type { LlmQueue, LlmResult } from './queue';

export const NO_ARCHIVIST = 'No archivist is available (no model answered).';

export interface ArchivistAnswer {
    source: 'model' | 'fallback';
    answer: string;
    /** The retrieved lines the answer cites (model), or none (fallback). */
    citations: ScoredLine[];
    retrieval: ArchiveRetrieval;
    outcome: LlmResult['outcome'] | 'empty';
}

export function buildArchivistMessages(galaxy: Galaxy, empire: Empire, question: string, r: ArchiveRetrieval): { messages: ChatMessage[]; situation: string } {
    const records = r.lines.length > 0 ? archiveContextText(r.lines) : '(no records)';
    const system = fillPrompt(ARCHIVIST_SYSTEM, { empire: empire.name, date: resolveStarDateDescription(galaxyStarDate(galaxy)), records });
    const q = question.trim().slice(0, 400);
    return { messages: [{ role: 'system', content: system }, { role: 'user', content: q }], situation: `v${ARCHIVIST_PROMPT_VERSION}\n${system}\nQ: ${q}` };
}

const norm = (s: string): string => s.toLowerCase().replace(/[“”"']/g, '').replace(/\s+/g, ' ').trim();

/** A cited {date, line} → the retrieved line it names (null when it names none). */
export function matchCitation(lines: readonly ScoredLine[], c: { date?: unknown; line?: unknown }): ScoredLine | null {
    const text = typeof c.line === 'string' ? norm(c.line) : '';
    const date = typeof c.date === 'string' ? c.date.trim() : '';
    if (text === '') return null;
    // "date | text" copied whole is fine too.
    const t = text.includes(' | ') ? text.slice(text.indexOf(' | ') + 3) : text;
    const cands = lines.filter((l) => {
        const n = norm(l.line);
        return n === t || (t.length >= 12 && n.includes(t)) || (n.length >= 12 && t.includes(n));
    });
    if (cands.length === 0) return null;
    return cands.find((l) => l.date === date) ?? cands[0];
}

/** The model's answer → {answer, citations} over the retrieved lines, or null when unusable. */
export function parseArchivistAnswer(raw: string, r: ArchiveRetrieval): { answer: string; citations: ScoredLine[] } | null {
    let o: unknown;
    try {
        o = JSON.parse(raw);
    } catch {
        return null;
    }
    const a = o as { answer?: unknown; citations?: unknown };
    if (typeof a?.answer !== 'string' || a.answer.trim() === '') return null;
    const citations: ScoredLine[] = [];
    if (Array.isArray(a.citations)) {
        for (const c of a.citations) {
            if (c === null || typeof c !== 'object') continue;
            const m = matchCitation(r.lines, c as { date?: unknown; line?: unknown });
            if (m !== null && !citations.includes(m)) citations.push(m);
            if (citations.length >= 5) break;
        }
    }
    const answer = a.answer.replace(/\r\n/g, '\n').trim();
    return { answer: answer.length > 1500 ? answer.slice(0, 1499) + '…' : answer, citations };
}

/** The fallback answer (no model): the raw top-K lines. */
export function archivistFallback(r: ArchiveRetrieval, outcome: ArchivistAnswer['outcome']): ArchivistAnswer {
    return { source: 'fallback', answer: `${NO_ARCHIVIST}\n${archiveFallbackText(r)}`, citations: [], retrieval: r, outcome };
}

/** Ask the archivist. Never rejects. */
export async function askArchivist(galaxy: Galaxy, empire: Empire, queue: LlmQueue | null, question: string): Promise<ArchivistAnswer> {
    const r = retrieveArchive(galaxy, empire, question);
    if (question.trim() === '') return { ...archivistFallback(r, 'empty'), answer: 'Ask the archive a question.' };
    if (queue === null) return archivistFallback(r, 'silent');
    const { messages, situation } = buildArchivistMessages(galaxy, empire, question, r);
    let res: LlmResult;
    try {
        res = await queue.submit({ priority: 'player', purpose: 'archivist', situation, messages, schema: ARCHIVIST_SCHEMA, schemaName: 'archivist', temperature: 0.2 });
    } catch (e) {
        res = { outcome: 'error', text: '', tokens: 0, latencyMs: 0, error: String(e) };
    }
    const parsed = res.outcome === 'ok' || res.outcome === 'cached' ? parseArchivistAnswer(res.text, r) : null;
    if (parsed === null) return archivistFallback(r, res.outcome === 'ok' || res.outcome === 'cached' ? 'error' : res.outcome);
    return { source: 'model', answer: parsed.answer, citations: parsed.citations, retrieval: r, outcome: res.outcome };
}
