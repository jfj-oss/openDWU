// 19s-1 CHRONICLE: the yearly background job (src/llm/chronicleJob.ts) over a fake endpoint — the due year, the prompt
// (historian voice by government, the digest, the year's events the player knew), the model's text stored in the
// event-log state, the scripted fallback (plain digest) when no model answers / the budget refuses / the answer is
// unusable, the fallback upgraded once a model answers, the Galactic History Chronicle rows and the markdown export;
// flag off → nothing. The game is not ticked: the clock is moved past the year end by hand (the job only reads it).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createScenarioGame, scenarioGameData } from './helpers/scenarioGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import { YEAR_LENGTH } from '../src/sim/galaxyTime';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { appendEvent, empireActor, peekEventLog } from '../src/sim/scenario/eventLog/log';
import { starDateYear } from '../src/sim/scenario/eventLog/chronicle';
import { chronicleInput, chronicleMarkdown, chronicleOn, chronicleYears, dueChronicleYear } from '../src/sim/scenario/llm/chronicle';
import { ChronicleJob, buildChronicleMessages, parseChronicleAnswer } from '../src/llm/chronicleJob';
import { DEFAULT_LLM_POLICY, LlmQueue, galaxyLlmClock, type LlmRequest, type LlmTransport } from '../src/llm/queue';
import { startLlmLayer } from '../src/llm/llmLayer';
import { historianVoice } from '../src/llm/prompts/chronicle';
import { governmentName } from '../src/sim/player/diplomatBrief';
import { chronicleFileName, chronicleRows, galacticHistoryHasChronicle } from '../src/ui/screens/galacticHistory';

const SC = 'llm-layer';
let base: GameData;
let ALL_OFF: Record<string, boolean>;
beforeAll(async () => {
    base = await loadGameDataFs();
    ALL_OFF = Object.fromEntries(scenarioGameData(base, SC).scenario!.manifest.flags.map((f) => [f.name, false]));
}, 120000);

function game(on = true): { g: Galaxy; p: Empire; other: Empire; year: number } {
    const g = createScenarioGame(base, { scenario: SC, flags: { ...ALL_OFF, eventLog: true, llmFoundations: on } }).game.galaxy;
    const p = g.playerEmpire!;
    const other = g.empires.find((e) => e !== null && e !== p && e.active && e.capital !== null)!;
    const year = starDateYear(galaxyStarDate(g));
    // Three events of the first year: two the player knew, one it never heard of.
    const ev = (text: string, importance: 0 | 1 | 2 | 3, seenBy: number[], actors = [empireActor(g, other)]) =>
        appendEvent(g, { category: 'war', importance, actors, seenBy, place: null, textKey: text, args: [], textFormat: 'scenario', data: null, source: 'test' });
    ev('The fleet of the enemy was scattered at Vega', 3, [p.empireId], [empireActor(g, p), empireActor(g, other)]);
    ev('A trade pact was signed with the neighbours', 1, [p.empireId]);
    ev('A secret plot unknown to the court', 2, [other.empireId]);
    return { g, p, other, year };
}

function endYear(g: Galaxy): void {
    // Move the clock past the year end (the job reads only the date and the log).
    g.nowMs += YEAR_LENGTH;
}

function transport(answer: (r: LlmRequest) => string | Error, up = true): LlmTransport & { reqs: LlmRequest[] } {
    const reqs: LlmRequest[] = [];
    return {
        reqs,
        model: () => 'fake-14b',
        probe: async () => up,
        complete: async (r) => {
            reqs.push(r);
            const a = answer(r);
            if (a instanceof Error) throw a;
            return { text: a };
        },
    };
}

async function runJob(g: Galaxy, p: Empire, t: LlmTransport, policy = {}): Promise<ChronicleJob> {
    const queue = new LlmQueue({ transport: t, clock: galaxyLlmClock(g), policy: () => ({ ...DEFAULT_LLM_POLICY, ...policy }) });
    const job = new ChronicleJob({ galaxy: g, empire: p, queue, model: () => t.model() });
    job.poll();
    await job.pending;
    return job;
}

const GOOD = JSON.stringify({ title: 'The Scattering at Vega', text: 'In this year our fleets met the enemy at Vega and scattered them. A trade pact was signed with our neighbours, and the court rejoiced.' });

describe('chronicle job', () => {
    it('nothing is due before the year ends; after it the model text is stored in the event-log state', async () => {
        const { g, p, year } = game();
        expect(chronicleOn(g)).toBe(true);
        expect(dueChronicleYear(g, p)).toBeNull();
        endYear(g);
        expect(dueChronicleYear(g, p)).toBe(year);
        const t = transport(() => GOOD);
        const job = await runJob(g, p, t);
        const stored = peekEventLog(g)!.chronicle!;
        expect(stored).toHaveLength(1);
        expect(stored[0]).toMatchObject({ year, empireId: p.empireId, title: 'The Scattering at Vega', source: 'model', model: 'fake-14b', events: chronicleInput(g, p, year).events.length });
        expect(stored[0].text).toContain('Vega');
        expect(job.written).toHaveLength(1);
        expect(dueChronicleYear(g, p)).toBeNull();
        // Nothing more to do: a second poll sends nothing.
        job.poll();
        expect(job.pending).toBeNull();
        expect(t.reqs).toHaveLength(1);
    });

    it('the prompt carries the historian voice, the digest and only the events the player knew; schema-constrained, background priority', async () => {
        const { g, p, year } = game();
        endYear(g);
        const input = chronicleInput(g, p, year);
        // The game's own start-up messages are in the log too; ours are among the known ones, the secret is not.
        const texts = input.events.map((e) => e.text);
        expect(texts).toContain('The fleet of the enemy was scattered at Vega');
        expect(texts).toContain('A trade pact was signed with the neighbours');
        expect(texts).not.toContain('A secret plot unknown to the court');
        expect(input.events.length).toBeLessThanOrEqual(40);
        const { messages, situation } = buildChronicleMessages(g, p, input);
        const sys = messages[0].content;
        expect(sys).toContain(historianVoice(governmentName(p)));
        expect(sys).toContain(`history of the year ${year}`);
        expect(sys).toContain(`${p.name}:`); // the digest text
        expect(sys).toContain('[War] The fleet of the enemy was scattered at Vega');
        expect(sys).not.toContain('secret plot');
        expect(situation).toContain('v1');
        const t = transport(() => GOOD);
        await runJob(g, p, t);
        expect(t.reqs[0]).toMatchObject({ priority: 'background', purpose: 'chronicle', schemaName: 'chronicle' });
        expect(historianVoice('Hive Mind')).toContain('Collective Memory');
        expect(historianVoice('Monarchy')).toContain('Royal Court Historian');
        // The most important events are kept when capped.
        expect(chronicleInput(g, p, year, 1).events.map((e) => e.text)).toEqual(['The fleet of the enemy was scattered at Vega']);
    });

    it('no model → the scripted fallback (the plain digest of the year); upgraded once a model answers', async () => {
        const { g, p, year } = game();
        endYear(g);
        await runJob(g, p, transport(() => GOOD, false));
        let c = chronicleYears(g, p);
        expect(c).toHaveLength(1);
        expect(c[0]).toMatchObject({ year, source: 'fallback', model: '', title: `The Year ${year}` });
        expect(c[0].text).toContain('The fleet of the enemy was scattered at Vega');
        expect(c[0].text).not.toContain('secret plot');
        // A later session with a model upgrades the fallback year (the first poll probes, the next one writes).
        const t = transport(() => GOOD);
        const job = await runJob(g, p, t);
        expect(chronicleYears(g, p)[0].source).toBe('fallback');
        await Promise.resolve();
        await Promise.resolve();
        job.poll();
        await job.pending;
        c = chronicleYears(g, p);
        expect(c).toHaveLength(1);
        expect(c[0].source).toBe('model');
    });

    it('a refused budget, an endpoint error or an unusable answer store the fallback', async () => {
        for (const [t, policy] of [
            [transport(() => GOOD), { requestsPerYear: 0 }],
            [transport(() => new Error('HTTP 500')), {}],
            [transport(() => 'not json'), {}],
            [transport(() => JSON.stringify({ title: 'x', text: 'short' })), {}],
        ] as const) {
            const { g, p } = game();
            endYear(g);
            await runJob(g, p, t, policy);
            expect(chronicleYears(g, p)[0].source).toBe('fallback');
        }
        expect(parseChronicleAnswer(GOOD)?.title).toBe('The Scattering at Vega');
        expect(parseChronicleAnswer('{"text": "   "}')).toBeNull();
    });

    it('the Chronicle tab rows (pending, then the text) and the markdown export', async () => {
        const { g, p, year } = game();
        expect(galacticHistoryHasChronicle(g)).toBe(true);
        expect(chronicleRows(g, p)).toEqual([]);
        endYear(g);
        expect(chronicleRows(g, p)).toMatchObject([{ year, source: 'pending' }]);
        await runJob(g, p, transport(() => GOOD));
        expect(chronicleRows(g, p)).toMatchObject([{ year, source: 'model', title: 'The Scattering at Vega' }]);
        const md = chronicleMarkdown(g, p);
        expect(md).toMatch(new RegExp(`^# Chronicle of the ${p.name}\\n\\n## ${year} — The Scattering at Vega\\n\\nIn this year`));
        expect(chronicleFileName(p)).toMatch(/^chronicle-[a-z0-9-]+\.md$/);
    });

    it('flag off: no chronicle, no layer (no queue, no timer)', async () => {
        const { g, p } = game(false);
        endYear(g);
        expect(chronicleOn(g)).toBe(false);
        expect(galacticHistoryHasChronicle(g)).toBe(false);
        const layer = startLlmLayer({ galaxy: g, player: p, settings: () => ({ endpoint: 'x', model: 'y', api: 'auto' }) });
        expect(layer).toMatchObject({ on: false, queue: null, chronicle: null });
        layer.dispose();
        // A job forced onto a flag-off game writes nothing either.
        const t = transport(() => GOOD);
        const job = await runJob(g, p, t);
        expect(job.written).toEqual([]);
        expect(peekEventLog(g)?.chronicle).toBeUndefined();
        expect(t.reqs).toEqual([]);
    });

    it('the app layer on: a queue over the given transport and the job polling it', async () => {
        const { g, p, year } = game();
        endYear(g);
        const t = transport(() => GOOD);
        const stored: number[] = [];
        const layer = startLlmLayer({ galaxy: g, player: p, settings: () => ({ endpoint: 'x', model: 'y', api: 'auto' }), transport: t, onChronicle: (e) => stored.push(e.year), pollMs: 60000 });
        expect(layer.on).toBe(true);
        layer.chronicle!.poll();
        await layer.chronicle!.pending;
        expect(stored).toEqual([year]);
        expect(layer.queue!.metrics()).toMatchObject({ ok: 1, byPurpose: { chronicle: 1 } });
        layer.dispose();
    });
});
