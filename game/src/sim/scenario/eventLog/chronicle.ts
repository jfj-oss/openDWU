// 19p event log: resolved text and the chronicle digest (tasks/19-mod-layer-scenarios.md §19p). Not a port. Pure
// reads of the log (log.ts) — never writes state; safe to call from the UI, the dev URL and tests.

import type { Galaxy } from '../../galaxy';
import { resolveStarDateDescription } from '../../galaxyTime';
import { resolveGameText, tryGetText } from '../../textResolver';
import { actorName, EVENT_CATEGORIES, eventLogEntries, type EventCategory, type EventLogEntry } from './log';

/** scenario/messages.ts scenarioText without its event-log capture (a GameText tag, else the literal; `{n}` = args). */
function scenarioTextPure(tag: string, args: readonly (string | number)[]): string {
    const template = tryGetText(tag) ?? tag;
    return template.replace(/\{(\d+)\}/g, (m, i: string) => (Number(i) < args.length ? String(args[Number(i)]) : m));
}

function resolveKey(format: EventLogEntry['textFormat'], key: string, args: readonly (string | number)[]): string {
    return format === 'scenario' ? scenarioTextPure(key, args) : resolveGameText([key, ...args.map(String)].join('|'));
}

/** The entry's text in the current language. */
export function resolveEntryText(e: EventLogEntry): string {
    return resolveKey(e.textFormat, e.textKey, e.args);
}

/** The entry's title (its own title text, else the first line of the text). */
export function resolveEntryTitle(e: EventLogEntry): string {
    if (e.titleKey !== undefined && e.titleKey !== '') return resolveKey(e.textFormat, e.titleKey, e.titleArgs ?? []);
    const t = resolveEntryText(e).split('\n')[0];
    return t.length > 90 ? t.substring(0, 87) + '...' : t;
}

/** The GameText label of a category ("EventLog Category war" in scenarios/event-log/GameText.txt; else the id). */
export function categoryLabel(c: EventCategory): string {
    return tryGetText(`EventLog Category ${c}`) ?? c.charAt(0).toUpperCase() + c.slice(1);
}

/** The calendar year of a star date (ResolveStarDateDescription's year part). */
export function starDateYear(starDate: number): number {
    return Number(resolveStarDateDescription(starDate).split('.')[0]);
}

export interface ChronicleEvent {
    id: number;
    date: string;
    importance: number;
    text: string;
    actors: string[];
    source: string;
}

export interface ChronicleDigest {
    scenario: string;
    since: number;
    /** Star date of the newest entry (0 when empty). */
    until: number;
    count: number;
    years: { year: number; categories: { category: EventCategory; label: string; events: ChronicleEvent[] }[] }[];
}

export interface ChronicleExport {
    json: ChronicleDigest;
    markdown: string;
}

export interface ChronicleOptions {
    /** Drop entries below this importance (default 0: everything). */
    minImportance?: number;
}

const STARS = ['', '*', '**', '***'];

/**
 * A compact digest of the log from `since` (star date): grouped by year, then category (EVENT_CATEGORIES order),
 * oldest first, the text resolved in the current language. For the future local-model chronicle (19e-4) and the
 * replay theatre (19e-1).
 */
export function chronicleExport(galaxy: Galaxy, since = 0, opts: ChronicleOptions = {}): ChronicleExport {
    const min = opts.minImportance ?? 0;
    const entries = eventLogEntries(galaxy).filter((e) => e.starDate >= since && e.importance >= min);
    const byYear = new Map<number, Map<EventCategory, ChronicleEvent[]>>();
    for (const e of entries) {
        const y = starDateYear(e.starDate);
        let cats = byYear.get(y);
        if (cats === undefined) byYear.set(y, (cats = new Map()));
        let list = cats.get(e.category);
        if (list === undefined) cats.set(e.category, (list = []));
        list.push({
            id: e.id,
            date: resolveStarDateDescription(e.starDate),
            importance: e.importance,
            text: resolveEntryText(e).replace(/\s*\n+\s*/g, ' ').trim(),
            actors: e.actors.map((a) => actorName(galaxy, a)),
            source: e.source,
        });
    }
    const years = [...byYear.keys()]
        .sort((a, b) => a - b)
        .map((year) => {
            const cats = byYear.get(year)!;
            return { year, categories: EVENT_CATEGORIES.filter((c) => cats.has(c)).map((c) => ({ category: c, label: categoryLabel(c), events: cats.get(c)! })) };
        });
    const json: ChronicleDigest = { scenario: galaxy.scenario?.id ?? '', since, until: entries.length > 0 ? entries[entries.length - 1].starDate : 0, count: entries.length, years };
    const lines: string[] = [`# Chronicle (${entries.length} events)`];
    for (const y of years) {
        lines.push('', `## ${y.year}`);
        for (const c of y.categories) {
            lines.push('', `### ${c.label}`);
            for (const ev of c.events) lines.push(`- ${ev.date}${ev.importance > 0 ? ` ${STARS[ev.importance]}` : ''} ${ev.text}`);
        }
    }
    return { json, markdown: lines.join('\n') + '\n' };
}
