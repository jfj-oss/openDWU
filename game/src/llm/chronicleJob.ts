// 19s-1 CHRONICLE job (tasks/19-mod-layer-scenarios.md §19s item 1; the 19e-4 chronicle). Not a port.
//
// A background job polled from the UI timer (llm/llmLayer.ts), never from the tick: when a calendar year has ended it
// takes that year's events as the player's court knew them (sim/scenario/llm/chronicle.ts chronicleInput over
// chronicleExport), the player's grounding digest and the historian's voice (government / race, the briefs' persona
// lines), and asks the model through the queue (priority 'background': budgeted, cached by situation hash) for an
// in-character history. The answer is validated (JSON {title, text}) and stored in the event-log state; no model, a
// refusal, a timeout or a bad answer → the scripted fallback (the plain digest of the year) is stored instead, and is
// upgraded to the model's text on a later poll once a model answers. One year at a time.

import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import { galaxyStarDate } from '../sim/tick/simTime';
import { governmentName, personaLines, raceBonuses, raceTraits, RACE_FAMILY_NAMES } from '../sim/player/diplomatBrief';
import { digestFor, digestText } from '../sim/scenario/llm/digest';
import { scenarioParam } from '../sim/scenario/state';
import {
    CHRONICLE_DEFAULT_EVENTS,
    chronicleInput,
    chronicleYears,
    chronicleLine,
    chronicleOn,
    dueChronicleYear,
    fallbackChronicle,
    storeChronicleYear,
    type ChronicleInput,
    type ChronicleYear,
} from '../sim/scenario/llm/chronicle';
import { CHRONICLE_PROMPT_VERSION, CHRONICLE_SCHEMA, CHRONICLE_SYSTEM, CHRONICLE_USER, fillPrompt, historianVoice } from './prompts/chronicle';
import type { ChatMessage } from '../ui/advisorClient';
import type { LlmQueue, LlmResult } from './queue';
import { remoteSimHost } from '../simworker/remoteHost';
import { readReplica } from './replicaReads';

/** The chronicle's system + user messages for one year. */
export function buildChronicleMessages(galaxy: Galaxy, empire: Empire, input: ChronicleInput): { messages: ChatMessage[]; situation: string } {
    const race = empire.dominantRace ?? null;
    const gov = governmentName(empire);
    const persona = personaLines({
        race: raceTraits(race),
        raceBonuses: raceBonuses(race),
        speaker: null,
        empire: { race: race?.name ?? 'unknown', government: gov },
    }).join(' ');
    const digest = digestText(digestFor(galaxy, empire));
    const events = input.events.length > 0 ? input.events.map(chronicleLine).join('\n') : '(nothing of note reached the court)';
    const omitted = input.total > input.events.length ? `, the ${input.events.length} most important of ${input.total}` : '';
    const raceWords = race !== null ? `${race.name} (${RACE_FAMILY_NAMES[race.raceFamily] ?? ''})` : 'mixed';
    const system = fillPrompt(CHRONICLE_SYSTEM, { voice: historianVoice(gov), empire: empire.name, race: raceWords, persona, year: input.year, digest, events, omitted });
    const user = fillPrompt(CHRONICLE_USER, { year: input.year });
    // The situation the answer depends on: the prompt version and the whole prompt (digest + events).
    return { messages: [{ role: 'system', content: system }, { role: 'user', content: user }], situation: `v${CHRONICLE_PROMPT_VERSION}\n${system}` };
}

/** The model's answer → {title, text}, or null when unusable. */
export function parseChronicleAnswer(raw: string): { title: string; text: string } | null {
    let o: unknown;
    try {
        o = JSON.parse(raw);
    } catch {
        return null;
    }
    const r = o as { title?: unknown; text?: unknown };
    if (typeof r?.text !== 'string') return null;
    const text = r.text.replace(/\r\n/g, '\n').trim();
    if (text.length < 20) return null;
    const title = typeof r.title === 'string' && r.title.trim() !== '' ? r.title.trim().slice(0, 80) : '';
    return { title, text: text.length > 4000 ? text.slice(0, 3999) + '…' : text };
}

export interface ChronicleJobOptions {
    galaxy: Galaxy;
    /** The empire whose historian writes (the player). */
    empire: Empire | null;
    queue: LlmQueue;
    /** Model id recorded with the text. */
    model: () => string;
    /** Called when a year was stored (the Galactic History screen refreshes). */
    onStored?: (entry: ChronicleYear) => void;
}

export class ChronicleJob {
    private busy: Promise<void> | null = null;
    private disposed = false;
    /** Years whose fallback we already tried to upgrade in this session (one attempt each). */
    private readonly upgradeTried = new Set<number>();
    /**
     * Sim worker: years stored in the worker that the replica does not show yet (the event-log state syncs in the cold
     * cycle, about a second later), by the stored entry's source. Until then the year still looks due here, and writing
     * it again could put a fallback over the model's text. Empty in-thread (the store is immediate).
     */
    private readonly awaitingSync = new Map<number, ChronicleYear['source']>();
    readonly written: ChronicleYear[] = [];

    constructor(private readonly opts: ChronicleJobOptions) {}

    /** The run in flight (tests). */
    get pending(): Promise<void> | null {
        return this.busy;
    }

    /** Cheap poll (UI timer): start the next due year when idle. Never awaits. */
    poll(): void {
        if (this.disposed || this.busy !== null) return;
        const { galaxy, empire } = this.opts;
        if (empire === null || !chronicleOn(galaxy)) return;
        if (this.awaitingSync.size > 0) {
            for (const c of chronicleYears(galaxy, empire)) if (this.awaitingSync.get(c.year) === c.source) this.awaitingSync.delete(c.year);
            // Wait for the replica to show what was stored (then the due years are current again).
            if (this.awaitingSync.size > 0) return;
        }
        let year = dueChronicleYear(galaxy, empire);
        if (year === null) {
            // A fallback year is rewritten once per session when a model answers (the probe is rate-limited).
            const up = dueChronicleYear(galaxy, empire, true);
            if (up !== null && !this.upgradeTried.has(up)) {
                if (!this.opts.queue.available) {
                    void this.opts.queue.ensureProbe();
                    return;
                }
                year = up;
            }
        }
        if (year === null) return;
        this.upgradeTried.add(year);
        this.busy = this.write(year).then(() => undefined).finally(() => {
            this.busy = null;
        });
    }

    /** Writes one year (model, else fallback) and stores it. */
    async write(year: number): Promise<ChronicleYear | null> {
        const { galaxy, empire, queue } = this.opts;
        if (empire === null) return null;
        const max = Math.max(5, Math.trunc(scenarioParam(galaxy, 'llmChronicleEvents', CHRONICLE_DEFAULT_EVENTS)));
        const input = readReplica(galaxy, () => chronicleInput(galaxy, empire, year, max));
        const { messages, situation } = readReplica(galaxy, () => buildChronicleMessages(galaxy, empire, input));
        let res: LlmResult;
        try {
            res = await queue.submit({ priority: 'background', purpose: 'chronicle', situation, messages, schema: CHRONICLE_SCHEMA, schemaName: 'chronicle', temperature: 0.7 });
        } catch (e) {
            res = { outcome: 'error', text: '', tokens: 0, latencyMs: 0, error: String(e) };
        }
        if (this.disposed || !chronicleOn(galaxy)) return null;
        const parsed = res.outcome === 'ok' || res.outcome === 'cached' ? parseChronicleAnswer(res.text) : null;
        const entry: ChronicleYear =
            parsed !== null
                ? {
                      year,
                      empireId: empire.empireId,
                      title: parsed.title !== '' ? parsed.title : `The Year ${year}`,
                      text: parsed.text,
                      source: 'model',
                      model: this.opts.model(),
                      events: input.events.length,
                      written: galaxyStarDate(galaxy),
                  }
                : readReplica(galaxy, () => fallbackChronicle(galaxy, empire, input));
        // Only missing or fallback years are written, so a model text is never replaced.
        const remote = remoteSimHost(galaxy);
        if (remote === null) storeChronicleYear(galaxy, entry);
        else {
            // Sim worker (docs/sim-worker.md §9 chunk 8): `galaxy` is the replica; the store is a host op on the worker's
            // game (between two ticks, as here in-thread), and the replica gets the entry with the event-log state.
            this.awaitingSync.set(year, entry.source);
            try {
                await remote.hostOp('chronicleYear', [entry]);
            } catch {
                this.awaitingSync.delete(year);
                return null;
            }
            if (this.disposed) return null;
        }
        this.written.push(entry);
        try {
            this.opts.onStored?.(entry);
        } catch {
            // a broken listener must not break the job
        }
        return entry;
    }

    dispose(): void {
        this.disposed = true;
    }
}
