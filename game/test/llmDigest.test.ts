// 19s-1 grounding digests (src/sim/scenario/llm/digest.ts): the fixed schema, the ≤ 400-token size bound (every empire
// pair of a real run, and a synthetic worst case with every section overfull), determinism (same state → same JSON,
// also across save / load), purity (no state, no Rnd), the presence-checked sections of packages on sibling branches
// (19o reputation ledger, 19n court / intrigue: their state shapes lit up by hand) and the ones on this build (19d8
// council, 19g-3 war goals, 19m leads, rim), and the text rendering. Plus: the llm-layer scenario with its flags off —
// and with only llmFoundations on — runs byte-identical to the faithful game.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGameRun } from './helpers/gameCache';
import { createScenarioGame, scenarioGameData } from './helpers/scenarioGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Game } from '../src/sim/game';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import { runGameSeconds } from '../src/sim/tick/harness';
import { stateDigest } from '../src/sim/tick/digest';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import { defaultStartGameOptions } from '../src/sim/startGameOptions';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../src/sim/diplomacy';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { appendEvent, empireActor } from '../src/sim/scenario/eventLog/log';
import { DIGEST_MAX_CHARS, digestFor, digestJson, digestSize, digestText, estimateTokens, type LlmDigest } from '../src/sim/scenario/llm/digest';

const SC = 'llm-layer';
let base: GameData;
let ALL_OFF: Record<string, boolean>;
let ALL_ON: Record<string, boolean>;
let run: { game: Game; gameData: GameData };

beforeAll(async () => {
    base = await loadGameDataFs();
    const flags = scenarioGameData(base, SC).scenario!.manifest.flags;
    ALL_OFF = Object.fromEntries(flags.map((f) => [f.name, false]));
    ALL_ON = Object.fromEntries(flags.map((f) => [f.name, true]));
    run = createScenarioGame(base, { scenario: SC, flags: ALL_ON });
    runGameSeconds(run.game, 600);
}, 600000);

function majors(g: Galaxy): Empire[] {
    return g.empires.filter((e): e is Empire => e !== null && e.active && e !== g.independentEmpire && e.pirateEmpireBaseHabitat === null);
}

const SCHEMA_KEYS = ['v', 'date', 'self', 'other', 'claims', 'leads', 'council', 'wars', 'economy', 'rim', 'events'];

describe('flags off = faithful game', () => {
    it('llm-layer with every flag off, and with only llmFoundations on, runs byte-identical and writes no state', () => {
        const ref = cachedTickGameRun(base, { seconds: 600 });
        for (const flags of [ALL_OFF, { ...ALL_OFF, llmFoundations: true }]) {
            const g = createScenarioGame(base, { scenario: SC, flags }).game;
            runGameSeconds(g, 600);
            expect(stateDigest(g.galaxy)).toBe(stateDigest(ref.game.galaxy));
            expect(g.galaxy.rnd.drawCount).toBe(ref.game.galaxy.rnd.drawCount);
            expect(Object.keys(g.galaxy.scenario!.state)).toEqual([]);
        }
    }, 600000);
});

describe('digestFor on a real run', () => {
    it('has the fixed schema, fits ≤ 400 tokens for every empire pair, and is pure', () => {
        const g = run.game.galaxy;
        const before = stateDigest(g);
        const draws = g.rnd.drawCount;
        const keys = Object.keys(g.scenario!.state).sort();
        const es = majors(g);
        expect(es.length).toBeGreaterThanOrEqual(3);
        let withEvents = 0;
        for (const a of es) {
            for (const b of [null, ...es]) {
                if (b === a) continue;
                const d = digestFor(g, a, b);
                expect(Object.keys(d).every((k) => SCHEMA_KEYS.includes(k))).toBe(true);
                expect(Object.keys(d).filter((k) => SCHEMA_KEYS.includes(k))).toEqual(SCHEMA_KEYS.filter((k) => k in d)); // schema order
                expect(d.v).toBe(1);
                expect(d.self.name).toBe(a.name.slice(0, 32));
                expect(typeof d.economy.money).toBe('number');
                expect(d.economy.colonies).toBe(a.colonies.length);
                if (b !== null) {
                    expect(d.other!.name).toBe(b.name.slice(0, 32));
                    expect(d.other!.relation).toBe(DiplomaticRelationType[a.diplomaticRelations.byEmpire(b)?.type ?? DiplomaticRelationType.NotMet]);
                } else expect(d.other).toBeUndefined();
                expect(d.events.length).toBeLessThanOrEqual(6);
                if (d.events.length > 0) withEvents++;
                const json = digestJson(d);
                expect(json.length).toBe(digestSize(d));
                expect(json.length).toBeLessThanOrEqual(DIGEST_MAX_CHARS);
                expect(estimateTokens(json)).toBeLessThanOrEqual(400);
            }
        }
        expect(withEvents).toBeGreaterThan(0); // the event log (19p) fed the digests
        expect(stateDigest(g)).toBe(before);
        expect(g.rnd.drawCount).toBe(draws);
        expect(Object.keys(g.scenario!.state).sort()).toEqual(keys);
    });

    it('is deterministic: the same state gives the same JSON and text, also after save / load', () => {
        const g = run.game.galaxy;
        const [a, b] = majors(g);
        const d1 = digestJson(digestFor(g, a, b));
        expect(digestJson(digestFor(g, a, b))).toBe(d1);
        expect(digestText(digestFor(g, a, b))).toBe(digestText(digestFor(g, a, b)));
        const time = new GalaxyTime();
        time.togglePause();
        time.advance(g.nowMs);
        const text = serializeGame(run.game as never, time, { ...defaultStartGameOptions(), seed: 1, scenario: { id: SC, flags: ALL_ON, params: {} } });
        const lg = deserializeGame(text, run.gameData).game.galaxy;
        const la = lg.empires.find((e) => e?.empireId === a.empireId)!;
        const lb = lg.empires.find((e) => e?.empireId === b.empireId)!;
        expect(digestJson(digestFor(lg, la, lb))).toBe(d1);
    });

    it('the events option and the param bound the event lines', () => {
        const g = run.game.galaxy;
        const [a] = majors(g);
        expect(digestFor(g, a, null, { events: 0 }).events).toEqual([]);
        const d = digestFor(g, a, null, { events: 2 });
        expect(d.events.length).toBeLessThanOrEqual(2);
        for (const line of d.events) expect(line).toMatch(/^\d{4}\.\d{2}\.\d{2} /);
    });
});

describe('sections from package states (presence-checked)', () => {
    function lit(): { g: Galaxy; a: Empire; b: Empire; c: Empire } {
        const game = createScenarioGame(base, { scenario: SC, flags: ALL_ON }).game;
        const g = game.galaxy;
        const [a, b, c] = majors(g);
        const s = g.scenario!;
        // 19o reputation ledger (sibling branch): its state shape and flag.
        s.flags.reputationLedger = true;
        s.state.reputation = {
            pairs: {
                [`${a.empireId}>${b.empireId}`]: [
                    { cause: 'border.incident', labelKey: 'Reputation Cause border.incident', value: -12, decayPerYear: 3, source: '19l', date: 0, term: 'incident' },
                    { cause: 'trade.gift', labelKey: 'no such tag', value: 5, decayPerYear: 3, source: '19c', date: 0, term: 'bias' },
                ],
                [`${b.empireId}>${a.empireId}`]: [{ cause: 'espionage.caught', labelKey: 'x', value: -30, decayPerYear: 3, source: '19d3', date: 0, term: 'incident' }],
            },
        };
        // 19n court + intrigue (sibling branch).
        s.flags.courtDynasties = true;
        s.flags.courtIntrigue = true;
        const house = { id: 7, name: 'House Varn', empire: a, prestige: 40, founded: 0, founder: null, rivals: [] };
        s.state.court = {
            houses: [house],
            ruling: new Map([[a, 7]]),
            legitimacy: new Map(a.leader !== null ? [[a.leader, 71.6]] : []),
            seats: new Map([[a, { spymaster: a.leader, chancellor: null, marshal: null, steward: null, magistrate: null }]]),
        };
        s.state.courtIntrigue = { claims: [{ id: 1, house: 7, empire: a, colony: b.capital, cause: 'former', base: 55, since: 0, recognized: false, tieId: 0, against: null }] };
        // 19g-3 war goals: a casus belli a holds against c.
        s.state.warGoals = { wars: {}, offers: {}, treaties: [], reparations: [], humiliations: {}, casusBelli: { [`${a.empireId}:${c.empireId}`]: galaxyStarDate(g) } };
        // 19d8 council.
        s.state.council = {
            councils: [
                {
                    id: 1,
                    name: 'Galactic Council',
                    foundedYear: 2100,
                    members: [a, b, c],
                    chair: a,
                    motion: { id: 3, kind: 'sanction', proposer: b, target: c, other: null, resourceId: -1, text: 'Sanction the aggressor', year: 2101, proposedStarDate: 0, status: 'voting', votes: [{ empire: a, vote: 'yes', score: 9, coordinated: false }], decisionId: 0 },
                    results: [
                        { motionId: 1, year: 2100, kind: 'embargo', text: 'Embargo steel', passed: true, yes: 2, no: 1, abstain: 0, proposer: b, target: c },
                        { motionId: 2, year: 2101, kind: 'condemn', text: 'Condemn the war', passed: false, yes: 1, no: 2, abstain: 0, proposer: c, target: a },
                    ],
                    blocs: [{ id: 1, name: 'Northern Bloc', founder: a, members: [a], formedYear: 2101, hardness: 1 }],
                    coLosses: {},
                    losses: {},
                    sanctions: [],
                    threats: [c],
                    recognised: [],
                    condemned: {},
                    splitFrom: 0,
                },
            ],
            nextId: 2,
            leftYear: {},
        };
        // 19m lead.
        s.state.security = { ...(s.state.security as object), leads: [{ id: 1, thingId: 'plot#1', kind: 'plot', empire: a, target: a.capital, level: 'confirmed', source: 'roll', since: 0, updated: 5, closed: false, outcome: '' }] };
        // Rim: the Concord's ledger and herder goodwill.
        s.state.rimTrade = { empireId: c.empireId, capital: null, ledger: { [a.empireId]: { credit: 1200, debit: 300 } }, informed: [], metIds: [], stats: {} };
        s.state.rimHerders = { standing: { [a.empireId]: -15 } };
        return { g, a, b, c };
    }

    it('light up the identity, standing, claims, leads, council and rim sections', () => {
        const { g, a, b, c } = lit();
        const d = digestFor(g, a, b);
        if (a.leader !== null) {
            expect(d.self.legitimacy).toBe(72);
            expect(d.self.seats).toEqual([`spymaster:${a.leader.name.slice(0, 20)}`]);
        }
        expect(d.self.house).toBe('House Varn');
        expect(d.other!.reputation).toEqual({ sum: -7, causes: [{ c: 'border.incident', v: -12 }, { c: 'trade.gift', v: 5 }], held: [{ c: 'espionage.caught', v: -30 }] });
        expect(d.claims!.ours).toEqual([{ on: b.capital!.name.slice(0, 28), owner: b.name.slice(0, 32), cause: 'former', strength: 55 }]);
        expect(d.claims!.casusBelli).toEqual([c.name.slice(0, 32)]);
        expect(d.leads).toEqual({ open: 1, top: [{ kind: 'plot', level: 'confirmed', at: a.capital!.name.slice(0, 28) }] });
        expect(d.council).toMatchObject({ name: 'Galactic Council', chair: true, members: 3, bloc: 'Northern Bloc', voting: { kind: 'sanction', vote: 'yes' }, threats: [c.name.slice(0, 32)] });
        expect(d.council!.recent.map((m) => m.kind)).toEqual(['embargo', 'condemn']);
        expect(d.rim).toEqual({ concord: { credit: 1200, debit: 300 }, herders: -15 });
        const t = digestText(d);
        expect(t).toContain('Ledger -7');
        expect(t).toContain('They hold against us: espionage.caught -30');
        expect(t).toContain('casus belli against');
        expect(t).toContain('Galactic Council: chair of 3, bloc Northern Bloc');
        expect(t).toContain('Concord ledger +1200/-300');
        // The Concord itself.
        expect(digestFor(g, c).rim?.concord).toBe('self');
        // Without their flags the sibling-branch sections stay dark.
        g.scenario!.flags.reputationLedger = false;
        g.scenario!.flags.courtDynasties = false;
        g.scenario!.flags.courtIntrigue = false;
        const off = digestFor(g, a, b);
        expect(off.other!.reputation).toBeUndefined();
        expect(off.self.legitimacy).toBeUndefined();
        expect(off.claims!.ours).toEqual([]);
    });

    it('a war with a 19g-3 ledger shows the score and both goals', () => {
        const { g, a, b } = lit();
        for (const [x, y] of [
            [a, b],
            [b, a],
        ]) {
            obtainDiplomaticRelation(x, y).type = DiplomaticRelationType.War;
        }
        expect(r0(a, b)).toBe(true);
        const side = (e: Empire, kind: string) => ({ empire: e, goal: { kind, colonies: kind === 'conquest' ? [b.capital] : [], subject: null }, chosenBy: 'ai', shipsDestroyed: 0, shipValue: 300, coloniesTaken: 0, colonyValue: 0, invasions: 0, invasionValue: 0, blockadeDays: 0, bonus: 0 });
        const key = a.empireId < b.empireId ? `${a.empireId}:${b.empireId}` : `${b.empireId}:${a.empireId}`;
        (g.scenario!.state.warGoals as { wars: Record<string, unknown> }).wars[key] = { a: side(a, 'conquest'), b: { ...side(b, 'punish'), shipValue: 100 }, attacker: a, startDate: 0, lastSample: 0 };
        g.scenario!.flags.warGoals = true;
        const d = digestFor(g, a, b);
        expect(d.wars![0]).toEqual({ vs: b.name.slice(0, 32), score: 50, goal: `conquest: ${b.capital!.name.slice(0, 20)}`, theirGoal: 'punish' });
        expect(digestText(d)).toContain(`score +50, our goal conquest`);
    });

    it('an overfull situation is trimmed to the size cap (≤ 400 tokens), keeping the schema', () => {
        const { g, a, b } = lit();
        const s = g.scenario!;
        const long = 'an exceedingly long and winding description of a very complicated grievance';
        (s.state.reputation as { pairs: Record<string, unknown[]> }).pairs[`${a.empireId}>${b.empireId}`] = Array.from({ length: 20 }, (_, i) => ({ cause: `${long} ${i}`, labelKey: 'x', value: -i - 1, decayPerYear: 3, source: 't', date: 0, term: 'incident' }));
        (s.state.reputation as { pairs: Record<string, unknown[]> }).pairs[`${b.empireId}>${a.empireId}`] = Array.from({ length: 20 }, (_, i) => ({ cause: `${long} ${i}`, labelKey: 'x', value: -i - 1, decayPerYear: 3, source: 't', date: 0, term: 'incident' }));
        const council = (s.state.council as { councils: { results: unknown[] }[] }).councils[0];
        council.results = Array.from({ length: 10 }, (_, i) => ({ motionId: i, year: 2100, kind: 'sanction', text: `${long} motion ${i}`, passed: i % 2 === 0, yes: 3, no: 2, abstain: 1, proposer: b, target: a }));
        (s.state.security as { leads: unknown[] }).leads = Array.from({ length: 10 }, (_, i) => ({ id: i, thingId: `t${i}`, kind: 'foreignAgent', empire: a, target: a.capital, level: 'suspected', source: 'roll', since: 0, updated: i, closed: false, outcome: '' }));
        for (let i = 0; i < 12; i++) {
            appendEvent(g, { category: 'war', importance: 2, actors: [empireActor(g, a), empireActor(g, b)], seenBy: [a.empireId], place: null, textKey: `${long} — event number ${i} of the long list of events`, args: [], textFormat: 'scenario', data: null, source: 'test' });
        }
        const d: LlmDigest = digestFor(g, a, b, { events: 12 });
        expect(digestSize(d)).toBeLessThanOrEqual(DIGEST_MAX_CHARS);
        expect(d.self.name).toBe(a.name.slice(0, 32));
        expect(d.other).toBeDefined();
        expect(d.economy).toBeDefined();
        expect(d.other!.reputation!.causes.length).toBeGreaterThanOrEqual(3);
        expect(d.events.length).toBeGreaterThan(0);
        // Deterministic trimming.
        expect(digestJson(digestFor(g, a, b, { events: 12 }))).toBe(digestJson(d));
    });
});

function r0(a: Empire, b: Empire): boolean {
    return a.diplomaticRelations.byEmpire(b)?.type === DiplomaticRelationType.War;
}
