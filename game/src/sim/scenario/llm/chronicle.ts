// 19s-1 CHRONICLE, sim side (tasks/19-mod-layer-scenarios.md §19s item 1; the 19e-4 chronicle). Not a port.
// The data half of the yearly chronicle: which year is due, the year's events as the player's historian knew them
// (chronicleExport filtered to eventsKnownTo), the scripted fallback text (the plain digest) and the store in the
// event-log state bag (EventLogState.chronicle). The model call lives UI-side (llm/chronicleJob.ts): the store is only
// written between frames by that job, never by the tick, and nothing here draws galaxy.rnd.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import { YEAR_LENGTH, startStarDateForAge } from '../../galaxyTime';
import { galaxyStarDate } from '../../tick/simTime';
import { scenarioFlag } from '../state';
import { eventLogOn, eventLogState, eventsKnownTo, peekEventLog, type ChronicleYear } from '../eventLog/log';
import { chronicleExport, starDateYear, type ChronicleEvent } from '../eventLog/chronicle';

export type { ChronicleYear };

export const LLM_FLAG = 'llmFoundations';
export const LLM_SCENARIO_ID = 'llm-layer';
/** Default events handed to the chronicler (param `llmChronicleEvents`). */
export const CHRONICLE_DEFAULT_EVENTS = 40;

/** The 19s layer is on (flag llmFoundations). */
export function llmOn(galaxy: Galaxy | null | undefined): boolean {
    return galaxy != null && galaxy.scenario != null && scenarioFlag(galaxy, LLM_FLAG);
}

/** The chronicle runs: the layer on and the event log (its source and its store) on. */
export function chronicleOn(galaxy: Galaxy | null | undefined): boolean {
    return llmOn(galaxy) && eventLogOn(galaxy);
}

/** Star date the calendar year starts (ResolveStarDateDescription: year = floor(starDate / YEAR_LENGTH)). */
export function yearStartStarDate(year: number): number {
    return year * YEAR_LENGTH;
}

/** The stored chronicle (oldest year first); empty when none. */
export function chronicleYears(galaxy: Galaxy, empire?: Empire | null): readonly ChronicleYear[] {
    const all = peekEventLog(galaxy)?.chronicle ?? [];
    return empire == null ? all : all.filter((c) => c.empireId === empire.empireId);
}

/** Stores (or replaces) one year's entry; keeps the list ordered by year. Flag-gated (no-op when the chronicle is off). */
export function storeChronicleYear(galaxy: Galaxy, entry: ChronicleYear): void {
    if (!chronicleOn(galaxy)) return;
    const st = eventLogState(galaxy);
    const list = (st.chronicle ??= []);
    const i = list.findIndex((c) => c.year === entry.year && c.empireId === entry.empireId);
    if (i >= 0) list[i] = entry;
    else {
        list.push(entry);
        list.sort((a, b) => a.year - b.year || a.empireId - b.empireId);
    }
}

/**
 * The oldest completed calendar year since the game start that has no entry for `empire` (or only the fallback when
 * `upgradeFallback`), else null. The current year is never due (it is not over).
 */
export function dueChronicleYear(galaxy: Galaxy, empire: Empire, upgradeFallback = false): number | null {
    const first = starDateYear(startStarDateForAge(galaxy.age));
    const current = starDateYear(galaxyStarDate(galaxy));
    const have = new Map(chronicleYears(galaxy, empire).map((c) => [c.year, c] as const));
    for (let y = first; y < current; y++) {
        const c = have.get(y);
        if (c === undefined || (upgradeFallback && c.source === 'fallback')) return y;
    }
    return null;
}

export interface ChronicleInput {
    year: number;
    /** Events of the year the empire knew, in total. */
    total: number;
    /** The selection handed to the chronicler: the most important `max`, then oldest first. */
    events: (ChronicleEvent & { category: string })[];
}

/** The year's events as `empire` knew them (chronicleExport of that year ∩ eventsKnownTo), the `max` most important. */
export function chronicleInput(galaxy: Galaxy, empire: Empire, year: number, max = CHRONICLE_DEFAULT_EVENTS): ChronicleInput {
    const since = yearStartStarDate(year);
    const known = new Set(eventsKnownTo(galaxy, empire, since).map((e) => e.id));
    const exp = chronicleExport(galaxy, since).json;
    const y = exp.years.find((x) => x.year === year);
    const all: (ChronicleEvent & { category: string })[] = [];
    for (const c of y?.categories ?? []) for (const ev of c.events) if (known.has(ev.id)) all.push({ ...ev, category: c.label });
    const picked = all
        .slice()
        .sort((a, b) => b.importance - a.importance || a.id - b.id)
        .slice(0, Math.max(0, max))
        .sort((a, b) => a.id - b.id);
    return { year, total: all.length, events: picked };
}

/** One event as a prompt / fallback line: "2105.03.12 [War] text". */
export function chronicleLine(ev: ChronicleEvent & { category: string }): string {
    return `${ev.date} [${ev.category}] ${ev.text}`;
}

/** The scripted fallback (no model): the plain digest of the year, grouped by category. */
export function fallbackChronicle(galaxy: Galaxy, empire: Empire, input: ChronicleInput): ChronicleYear {
    const lines: string[] = [];
    if (input.events.length === 0) lines.push(`Nothing the ${empire.name} heard of was set down this year.`);
    const byCat = new Map<string, string[]>();
    for (const ev of input.events) {
        let l = byCat.get(ev.category);
        if (l === undefined) byCat.set(ev.category, (l = []));
        l.push(`- ${ev.date} ${ev.text}`);
    }
    for (const [cat, l] of byCat) lines.push(`${cat}:`, ...l);
    if (input.total > input.events.length) lines.push(`(${input.total - input.events.length} lesser events omitted)`);
    return {
        year: input.year,
        empireId: empire.empireId,
        title: `The Year ${input.year}`,
        text: lines.join('\n'),
        source: 'fallback',
        model: '',
        events: input.events.length,
        written: galaxyStarDate(galaxy),
    };
}

/** Every stored year of `empire`'s chronicle as one markdown document (the Chronicle tab's export). */
export function chronicleMarkdown(galaxy: Galaxy, empire: Empire): string {
    const out: string[] = [`# Chronicle of the ${empire.name}`];
    for (const c of chronicleYears(galaxy, empire)) {
        out.push('', `## ${c.year} — ${c.title}`, '', c.text.trim());
        if (c.source === 'fallback') out.push('', '_(plain record: no chronicler model answered)_');
    }
    return out.join('\n') + '\n';
}
