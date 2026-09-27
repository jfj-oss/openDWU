// 19s-4 ARCHIVIST + NATURAL-LANGUAGE ORDERS (tasks/19-mod-layer-scenarios.md §19s item 4) over a fake endpoint:
// the deterministic, pure retriever (BM25 over what the player's empire knows: top K ≤ 20, ≤ 400 tokens, only visible
// lines), the question answered through the queue ('player' priority, {answer, citations}; citations only from the
// retrieved lines), the scripted fallback (no archivist + the raw lines); the order box mapping a typed order to ONE
// legal op, refusing an op outside the menu, asking instead of guessing, and issuing a command only on confirm.
// Flags off (and llmArchivist on, which is UI-only) → byte-identical game.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGameRun } from './helpers/gameCache';
import { createScenarioGame, scenarioGameData } from './helpers/scenarioGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import { runGameSeconds } from '../src/sim/tick/harness';
import { stateDigest } from '../src/sim/tick/digest';
import { appendEvent, empireActor } from '../src/sim/scenario/eventLog/log';
import { ARCHIVE_MAX_LINES, ARCHIVE_MAX_TOKENS, archiveCorpus, archiveContextText, archivistOn, archiveTokens, retrieveArchive } from '../src/sim/scenario/llm/archive';
import { buildOrderMenu, mapOrderAnswer, orderMenuIds, orderResponseSchema } from '../src/sim/scenario/llm/orderMenu';
import { NO_ARCHIVIST, askArchivist } from '../src/llm/archivist';
import { NO_ORDER_CLERK, confirmOrder, interpretOrder, type ConfirmedOrderResult } from '../src/llm/orders';
import { DEFAULT_LLM_POLICY, LlmQueue, galaxyLlmClock, type LlmRequest, type LlmTransport } from '../src/llm/queue';
import { flushPlayerCommands, pendingPlayerCommands } from '../src/sim/player/playerCommands';
import { commandLog } from '../src/sim/player/commandLog';
import { allowedTargets } from '../src/sim/player/advisorCommands';
import { galacticHistoryTabs } from '../src/ui/screens/galacticHistory';

const SC = 'llm-layer';
let base: GameData;
let ALL_OFF: Record<string, boolean>;
beforeAll(async () => {
    base = await loadGameDataFs();
    ALL_OFF = Object.fromEntries(scenarioGameData(base, SC).scenario!.manifest.flags.map((f) => [f.name, false]));
}, 120000);

function game(on = true): { g: Galaxy; p: Empire; other: Empire } {
    const g = createScenarioGame(base, { scenario: SC, flags: { ...ALL_OFF, eventLog: true, llmFoundations: on, llmArchivist: on } }).game.galaxy;
    const p = g.playerEmpire!;
    const other = g.empires.find((e) => e !== null && e !== p && e.active && e.capital !== null)!;
    const ev = (text: string, importance: 0 | 1 | 2 | 3, seenBy: number[], actors = [empireActor(g, other)]) =>
        appendEvent(g, { category: 'war', importance, actors, seenBy, place: null, textKey: text, args: [], textFormat: 'scenario', data: null, source: 'test' });
    ev('The enemy fleet was scattered at Vega after a long battle', 3, [p.empireId], [empireActor(g, p), empireActor(g, other)]);
    ev('A trade pact was signed with the neighbours', 1, [p.empireId]);
    ev('A secret plot against the Vega garrison was hatched in the shadows', 2, [other.empireId]);
    return { g, p, other };
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

function queue(g: Galaxy, t: LlmTransport): LlmQueue {
    return new LlmQueue({ transport: t, clock: galaxyLlmClock(g), policy: () => ({ ...DEFAULT_LLM_POLICY }) });
}

describe('flags off = faithful game', () => {
    it('llm-layer with every flag off, and with llmFoundations + llmArchivist on, runs byte-identical and writes no state', () => {
        const ref = cachedTickGameRun(base, { seconds: 600 });
        for (const flags of [ALL_OFF, { ...ALL_OFF, llmFoundations: true, llmArchivist: true }]) {
            const g = createScenarioGame(base, { scenario: SC, flags }).game;
            runGameSeconds(g, 600);
            expect(stateDigest(g.galaxy)).toBe(stateDigest(ref.game.galaxy));
            expect(g.galaxy.rnd.drawCount).toBe(ref.game.galaxy.rnd.drawCount);
            expect(Object.keys(g.galaxy.scenario!.state)).toEqual([]);
        }
    }, 600000);

    it('the flag is off by default and needs llmFoundations; off → no Ask / Orders tabs', () => {
        const f = scenarioGameData(base, SC).scenario!.manifest.flags.find((x) => x.name === 'llmArchivist');
        expect(f?.default).toBe(false);
        const { g } = game(false);
        expect(archivistOn(g)).toBe(false);
        expect(galacticHistoryTabs(g)).toEqual(['history']);
        const only = createScenarioGame(base, { scenario: SC, flags: { ...ALL_OFF, eventLog: true, llmArchivist: true } }).game.galaxy;
        expect(archivistOn(only)).toBe(false);
        expect(galacticHistoryTabs(game().g)).toEqual(['history', 'chronicle', 'ask', 'orders']);
    });
});

describe('archive retrieval', () => {
    it('is pure and deterministic, bounded (K ≤ 20, ≤ 400 tokens) and ranks the matching line first', () => {
        const { g, p } = game();
        const before = stateDigest(g);
        const draws = g.rnd.drawCount;
        const a = retrieveArchive(g, p, 'What happened at Vega?');
        const b = retrieveArchive(g, p, 'What happened at Vega?');
        expect(b).toEqual(a);
        expect(stateDigest(g)).toBe(before);
        expect(g.rnd.drawCount).toBe(draws);
        expect(a.matched).toBe(true);
        expect(a.terms).toEqual(['vega']);
        expect(a.lines[0].line).toContain('scattered at Vega');
        expect(a.lines[0].date).toMatch(/^\d+\.\d\d\.\d\d$/);
        expect(a.lines.length).toBeLessThanOrEqual(ARCHIVE_MAX_LINES);
        expect(a.tokens).toBeLessThanOrEqual(ARCHIVE_MAX_TOKENS);
        const big = retrieveArchive(g, p, 'empire colony war trade fleet ship', { k: 99 });
        expect(big.lines.length).toBeLessThanOrEqual(ARCHIVE_MAX_LINES);
        expect(Math.ceil(archiveContextText(big.lines).length / 4)).toBeLessThanOrEqual(ARCHIVE_MAX_TOKENS + big.lines.length);
        expect(archiveTokens('The Fleets were attacked!')).toEqual(['fleet', 'attack']);
    });

    it('never holds a line the player does not know (the log visibility rule)', () => {
        const { g, p } = game();
        const corpus = archiveCorpus(g, p).map((l) => l.line).join('\n');
        expect(corpus).toContain('scattered at Vega');
        expect(corpus).not.toContain('secret plot');
        const r = retrieveArchive(g, p, 'secret plot shadows garrison');
        expect(r.lines.map((l) => l.line).join('\n')).not.toContain('secret plot');
        // The digest lines are in the corpus ("Now: …").
        expect(archiveCorpus(g, p).some((l) => l.source === 'digest' && l.line.startsWith(`Now: `))).toBe(true);
    });
});

describe('archivist question box', () => {
    it('answers through the queue (player priority, schema) with citations kept only when they match retrieved lines', async () => {
        const { g, p } = game();
        let cited = '';
        const t = transport((r) => {
            const rec = r.messages[0].content.split('\n').find((l) => l.includes('scattered at Vega'))!;
            const [date, line] = rec.split(' | ');
            cited = line;
            return JSON.stringify({ answer: 'Our fleets scattered the enemy at Vega.', citations: [{ date, line }, { date: '2000.01.01', line: 'A secret plot against the Vega garrison was hatched' }] });
        });
        const before = stateDigest(g);
        const a = await askArchivist(g, p, queue(g, t), 'What happened at Vega?');
        expect(a.source).toBe('model');
        expect(a.answer).toBe('Our fleets scattered the enemy at Vega.');
        expect(a.citations).toHaveLength(1);
        expect(a.citations[0].line).toBe(cited);
        expect(t.reqs[0]).toMatchObject({ priority: 'player', purpose: 'archivist', schemaName: 'archivist' });
        expect(t.reqs[0].messages[0].content).not.toContain('secret plot');
        expect(t.reqs[0].messages[1].content).toBe('What happened at Vega?');
        expect(stateDigest(g)).toBe(before);
    });

    it('no model, an unusable answer or no queue → "no archivist available" plus the raw top lines', async () => {
        for (const [t, q] of [
            [transport(() => 'x', false), true],
            [transport(() => 'not json'), true],
            [transport(() => JSON.stringify({ answer: '', citations: [] })), true],
            [transport(() => 'x'), false],
        ] as const) {
            const { g, p } = game();
            const a = await askArchivist(g, p, q ? queue(g, t) : null, 'Vega battle');
            expect(a.source).toBe('fallback');
            expect(a.answer.startsWith(NO_ARCHIVIST)).toBe(true);
            expect(a.answer).toContain('scattered at Vega');
            expect(a.answer).not.toContain('secret plot');
            expect(a.citations).toEqual([]);
        }
    });
});

describe('natural-language orders', () => {
    function moveCase(g: Galaxy, p: Empire) {
        const menu = buildOrderMenu(g, p, null);
        const entry = menu.brief.commands.find((c) => c.do === 'Move' && c.who.startsWith('s'))!;
        expect(entry).toBeDefined();
        const target = allowedTargets(menu.brief, entry).find((r) => r.startsWith('h'))!;
        return { menu, entry, target };
    }

    it('maps a typed order to one legal op, shows the confirmation line, and issues a command only on confirm', async () => {
        const { g, p } = game();
        const { menu, entry, target } = moveCase(g, p);
        expect(orderMenuIds(menu)).toContain(entry.id);
        const schema = orderResponseSchema(menu) as { properties: { op: { enum: string[] } } };
        expect(schema.properties.op.enum).toContain('none');
        const shipName = menu.brief.ships.find((s) => s.ref === entry.who)!.name;
        const placeName = menu.brief.places.find((s) => s.ref === target)!.name;
        const t = transport(() => JSON.stringify({ op: entry.id, targetId: target }));
        const before = stateDigest(g);
        const logLen = commandLog(g).length;
        const r = await interpretOrder(g, p, queue(g, t), null, `send ${shipName} to ${placeName}`);
        expect(t.reqs[0]).toMatchObject({ priority: 'player', purpose: 'orders', schemaName: 'order', cache: false });
        expect(r.status).toBe('confirm');
        if (r.status !== 'confirm') return;
        expect(r.line).toBe(`Move ${shipName} to ${placeName}`);
        // Nothing issued, nothing changed until the player confirms.
        expect(pendingPlayerCommands(g)).toBe(0);
        expect(stateDigest(g)).toBe(before);
        expect(commandLog(g).length).toBe(logLen);
        let applied: ConfirmedOrderResult | null = null;
        confirmOrder(g, p, r.order, (x) => (applied = x));
        expect(pendingPlayerCommands(g)).toBe(1);
        flushPlayerCommands(g);
        expect(applied).not.toBeNull();
        expect(applied!.ok).toBe(true);
        const last = commandLog(g)[commandLog(g).length - 1];
        expect(last).toMatchObject({ source: 'player', op: 'advisorCommands' });
    });

    it('refuses an op outside the menu and an illegal target', async () => {
        const { g, p } = game();
        const { menu, entry } = moveCase(g, p);
        const r = await interpretOrder(g, p, queue(g, transport(() => JSON.stringify({ op: 'c99999' }))), null, 'conquer the galaxy');
        expect(r.status).toBe('refused');
        const bad = mapOrderAnswer(menu, { op: entry.id, targetId: 'h999999' });
        expect(bad.status).toBe('refused');
        expect(pendingPlayerCommands(g)).toBe(0);
    });

    it('asks instead of guessing: "none" + a question, a missing target, a bad answer', async () => {
        const { g, p } = game();
        const { menu, entry } = moveCase(g, p);
        const q = await interpretOrder(g, p, queue(g, transport(() => JSON.stringify({ op: 'none', clarify: 'Which fleet do you mean?' }))), null, 'attack them');
        expect(q).toEqual({ status: 'clarify', text: 'Which fleet do you mean?' });
        const m = mapOrderAnswer(menu, { op: entry.id });
        expect(m.status).toBe('clarify');
        if (m.status === 'clarify') expect(m.text).toContain('where?');
        expect(mapOrderAnswer(menu, 'not json').status).toBe('clarify');
        expect(pendingPlayerCommands(g)).toBe(0);
    });

    it('no model → unavailable (the menus), nothing issued', async () => {
        const { g, p } = game();
        const t = transport(() => '{}', false);
        expect(await interpretOrder(g, p, queue(g, t), null, 'move the explorer home')).toEqual({ status: 'unavailable', text: NO_ORDER_CLERK });
        expect(await interpretOrder(g, p, null, null, 'move the explorer home')).toEqual({ status: 'unavailable', text: NO_ORDER_CLERK });
        expect(t.reqs).toEqual([]);
        expect(pendingPlayerCommands(g)).toBe(0);
    });
});
