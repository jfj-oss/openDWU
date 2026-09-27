// 19s-3 STRATEGIC UPGRADE (src/sim/scenario/llm/strategic.ts + src/llm/strategicJob.ts) over a fake endpoint. Per
// decision family (council motion / vote, peace offer / accept, war goal, scheme target, faction concession, league
// offer, herder path) on a hand-built state: the legal-move enumeration, validation rejecting an illegal answer, the
// model's choice applied ONLY as a command through the player command queue (journaled), and the refusal fallback (an
// unusable / timed-out answer changes nothing but the decision log). Plus: enumeration is pure, the prompt's digest is
// ≤ 400 tokens, the schema is the offered ids, the yearly pass spreads the empires over 30-day slots with at most one
// request per empire in flight, the decision log shows in the ?llmMetrics=1 overlay text, and with the flags off (or
// llmStrategic on but no model) the game runs byte-identical to the faithful game. The replay soak (commands recorded
// from a fake endpoint, replayed without it) is test/llmStrategicReplay.test.ts.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGameRun } from './helpers/gameCache';
import { createScenarioGame, scenarioGameData } from './helpers/scenarioGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import { runGameSeconds } from '../src/sim/tick/harness';
import { stateDigest } from '../src/sim/tick/digest';
import { YEAR_LENGTH } from '../src/sim/galaxyTime';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { DiplomaticRelation, DiplomaticRelationType, obtainDiplomaticRelation } from '../src/sim/diplomacy';
import { getEmpireCharacters, CharacterRole } from '../src/sim/characters';
import { commandLog, type PlayerLogEntry } from '../src/sim/player/commandLog';
import { flushPlayerCommands, pendingPlayerCommands } from '../src/sim/player/playerCommands';
import { decodeCommandArg, type EncodedArg } from '../src/sim/player/commandCodec';
import { GAME_DAY_LENGTH } from '../src/sim/scenario/hooks';
import { DIGEST_MAX_CHARS, estimateTokens } from '../src/sim/scenario/llm/digest';
import {
    STRATEGIC_FAMILIES,
    applyLlmStrategicCommand,
    familyMoves,
    legalMoves,
    nearestAiEmpires,
    strategicLog,
    strategicOn,
    strategicSchema,
    validateStrategicAnswer,
    type StrategicFamily,
} from '../src/sim/scenario/llm/strategic';
import { councilState, type Council } from '../src/sim/scenario/emergent/council';
import { atWar, peekWarLedger, sideOf, startWarLedger, warGoalsState } from '../src/sim/scenario/lively/warGoals';
import { peekPoliticsState } from '../src/sim/scenario/emergent/politics';
import { securityState } from '../src/sim/scenario/security/registry';
import { availableInvestigators } from '../src/sim/scenario/security/security';
import { independentsState } from '../src/sim/scenario/independents/common';
import { formLeague } from '../src/sim/scenario/independents/independents';
import { makeHerderColony } from '../src/sim/scenario/rimHerders/rimHerders';
import { StrategicJob, buildStrategicMessages, strategicSlotDue } from '../src/llm/strategicJob';
import { DEFAULT_LLM_POLICY, LlmQueue, galaxyLlmClock, type LlmRequest, type LlmTransport } from '../src/llm/queue';
import { startLlmLayer } from '../src/llm/llmLayer';
import { strategicLogText } from '../src/ui/llmOverlay';

const SC = 'ai-parity';
let base: GameData;
let ALL_OFF: Record<string, boolean>;
const LAYER = { llmFoundations: true, llmStrategic: true };
const PACKAGES = { galacticCouncil: true, warGoals: true, internalPolitics: true, internalSecurity: true, independentActors: true, independentLeagues: true, rimHerders: true, rimFauna: true };

beforeAll(async () => {
    base = await loadGameDataFs();
    ALL_OFF = Object.fromEntries(scenarioGameData(base, SC).scenario!.manifest.flags.map((f) => [f.name, false]));
}, 120000);

function game(extra: Record<string, boolean> = {}): Galaxy {
    return createScenarioGame(base, { scenario: SC, flags: { ...ALL_OFF, ...LAYER, ...PACKAGES, ...extra } }).game.galaxy;
}

function ais(g: Galaxy): Empire[] {
    return g.empires.filter((e): e is Empire => e !== null && e.active && e !== g.playerEmpire && e !== g.independentEmpire && e.pirateEmpireBaseHabitat === null);
}

const PREFIX: Record<StrategicFamily, string> = { council: 'council.', peace: 'peace.', warGoal: 'warGoal:', scheme: 'scheme.', faction: 'faction.', league: 'league.', herders: 'herders.' };

/** A fake endpoint: answers with the chosen id from the schema's enum (or raw text / an error / never). */
function transport(answer: (ids: string[], r: LlmRequest) => string | Error | 'hang'): LlmTransport & { reqs: LlmRequest[] } {
    const reqs: LlmRequest[] = [];
    return {
        reqs,
        model: () => 'fake-14b',
        probe: async () => true,
        complete: (r) => {
            reqs.push(r);
            const ids = ((r.schema as { properties: { choice: { enum: string[] } } }).properties.choice.enum ?? []).slice();
            const a = answer(ids, r);
            if (a === 'hang') return new Promise(() => {});
            if (a instanceof Error) return Promise.reject(a);
            return Promise.resolve({ text: a });
        },
    };
}

function job(g: Galaxy, t: LlmTransport, timeoutMs = 90000): StrategicJob {
    const queue = new LlmQueue({ transport: t, clock: galaxyLlmClock(g), policy: () => ({ ...DEFAULT_LLM_POLICY, cacheTtlDays: 0, timeoutMs }) });
    return new StrategicJob({ galaxy: g, player: g.playerEmpire, queue });
}

const thisYear = (g: Galaxy): number => Math.floor(galaxyStarDate(g) / YEAR_LENGTH);
const pick = (id: string) => (ids: string[]) => JSON.stringify({ reason: 'Our people demand it.', choice: ids.find((x) => x === id) ?? 'MISSING ' + id });

// ---------------------------------------------------------------------------------------------------------------
// Hand-built situations, one per family
// ---------------------------------------------------------------------------------------------------------------

interface Case {
    e: Empire;
    /** The move the fake endpoint chooses. */
    move: string;
    /** The family's observable state (unchanged by a refusal). */
    snap: () => string;
    /** The move took effect. */
    effect: () => void;
}

function makeCouncil(g: Galaxy, a: Empire, b: Empire, c: Empire): Council {
    const st = councilState(g);
    const council: Council = {
        id: 1, name: 'Galactic Council', foundedYear: thisYear(g), members: [a, b, c], chair: a, motion: null, results: [], blocs: [], coLosses: {}, losses: {},
        sanctions: [], threats: [], recognised: [], condemned: {}, splitFrom: 0,
    };
    st.councils.push(council);
    st.nextId = 10;
    for (const [x, y] of [[a, b], [a, c], [b, c]] as const) {
        obtainDiplomaticRelation(x, y).type = DiplomaticRelationType.None;
        obtainDiplomaticRelation(y, x).type = DiplomaticRelationType.None;
    }
    return council;
}

function declareWar(g: Galaxy, attacker: Empire, target: Empire): void {
    for (const [x, y] of [[attacker, target], [target, attacker]] as const) {
        const r = obtainDiplomaticRelation(x, y);
        r.type = DiplomaticRelationType.War;
        r.initiator = attacker;
        r.startDateOfLastChange = galaxyStarDate(g) - YEAR_LENGTH;
    }
    startWarLedger(g, attacker, target);
}

const CASES: Record<string, (g: Galaxy) => Case> = {
    'council vote': (g) => {
        const [a, b, c] = ais(g);
        const council = makeCouncil(g, a, b, c);
        council.motion = { id: 3, kind: 'sanction', proposer: b, target: c, other: null, resourceId: -1, text: 'Sanction the offender', year: thisYear(g), proposedStarDate: galaxyStarDate(g), status: 'voting', votes: [{ empire: a, vote: 'yes', score: 9, coordinated: false }], decisionId: 0 };
        return {
            e: a,
            move: 'council.vote:1:3:no',
            snap: () => JSON.stringify(council.motion!.votes.map((v) => [v.empire.empireId, v.vote])),
            effect: () => expect(council.motion!.votes.find((v) => v.empire === a)!.vote).toBe('no'),
        };
    },
    'council table': (g) => {
        const [a, b, c] = ais(g);
        const council = makeCouncil(g, a, b, c);
        // c attacked a: a has a condemnation to table.
        for (const [x, y] of [[a, c], [c, a]] as const) {
            const r = obtainDiplomaticRelation(x, y);
            r.type = DiplomaticRelationType.War;
            r.initiator = c;
        }
        return {
            e: a,
            move: `council.table:1:condemn:${c.empireId}:-1`,
            snap: () => JSON.stringify([council.results.length, council.motion?.id ?? null]),
            effect: () => {
                expect(council.results.length + (council.motion !== null ? 1 : 0)).toBe(1);
                expect((council.results[0] ?? council.motion)!.kind).toBe('condemn');
            },
        };
    },
    'peace offer': (g) => {
        const [a, b] = ais(g);
        declareWar(g, a, b);
        const st = warGoalsState(g);
        return {
            e: a,
            move: `peace.offer:${b.empireId}:statusQuo`,
            snap: () => JSON.stringify([atWar(a, b), Object.keys(st.offers).sort()]),
            // Accepted (the war ended) or refused with a counter-offer standing: either way the sim answered the offer.
            effect: () => expect(!atWar(a, b) || st.offers[`${b.empireId}:${a.empireId}`] !== undefined).toBe(true),
        };
    },
    'peace accept': (g) => {
        const [a, b] = ais(g);
        declareWar(g, a, b);
        a.proposedDiplomaticRelations.add(new DiplomaticRelation(DiplomaticRelationType.None, b, b, a, galaxyStarDate(g), false));
        return { e: a, move: `peace.accept:${b.empireId}`, snap: () => JSON.stringify(atWar(a, b)), effect: () => expect(atWar(a, b)).toBe(false) };
    },
    'war goal': (g) => {
        const [a, b] = ais(g);
        declareWar(g, a, b);
        const side = sideOf(peekWarLedger(g, b, a)!, b);
        expect(side.goal.kind).toBe('punish');
        return { e: b, move: `warGoal:${a.empireId}:humiliate`, snap: () => side.goal.kind, effect: () => expect(side.goal.kind).toBe('humiliate') };
    },
    'scheme target': (g) => {
        const e = ais(g).find((x) => availableInvestigators(g, x).length > 0)!;
        expect(e).toBeDefined();
        const st = securityState(g);
        st.leads.push({ id: 991, thingId: 'plot#test', kind: 'plot', empire: e, target: e.capital!, level: 'suspected', source: 'roll', since: 0, updated: 1, closed: false, outcome: '' } as (typeof st.leads)[number]);
        return { e, move: 'scheme.investigate:991', snap: () => JSON.stringify(st.investigations.map((i) => i.leadId)), effect: () => expect(st.investigations.some((i) => i.leadId === 991)).toBe(true) };
    },
    'faction concession': (g) => {
        const e = ais(g)[0];
        const ps = peekPoliticsState(g)!;
        const c = getEmpireCharacters(e).find((x) => x.role !== CharacterRole.Leader && ps.chars.has(x))!;
        ps.chars.get(c)!.loyalty = 20;
        e.stateMoney = 1_000_000;
        const idx = getEmpireCharacters(e).indexOf(c);
        return {
            e,
            move: `faction.honour:${idx}:${c.name.replace(/[^A-Za-z0-9]+/g, '_').slice(0, 24)}`,
            snap: () => JSON.stringify([Math.round(ps.chars.get(c)!.loyalty), Math.round(e.stateMoney)]),
            effect: () => {
                expect(ps.chars.get(c)!.loyalty).toBe(35);
                expect(e.stateMoney).toBeLessThan(1_000_000);
            },
        };
    },
    'league offer': (g) => {
        const e = ais(g)[0];
        const st = independentsState(g);
        const members = st.actors.filter((x) => x.status === 'active' && x.leagueId < 0).slice(0, 2).map((x) => x.colony);
        const league = formLeague(g, members)!;
        league.standing[e.empireId] = 40;
        return { e, move: `league.trade:${league.id}`, snap: () => JSON.stringify([league.tradePartners, league.offered]), effect: () => expect(league.tradePartners).toContain(e.empireId) };
    },
    'herder path': (g) => {
        const e = ais(g)[0];
        const colony = independentsState(g).actors.find((x) => x.status === 'active')!.colony;
        const hc = makeHerderColony(g, colony, 0)!;
        hc.neighbourSince[e.empireId] = 0;
        return {
            e,
            move: 'herders.protect:0',
            snap: () => hc.status,
            effect: () => {
                expect(hc.status).toBe('protectorate');
                expect(hc.protectorId).toBe(e.empireId);
            },
        };
    },
};

const FAMILY_OF: Record<string, StrategicFamily> = {
    'council vote': 'council',
    'council table': 'council',
    'peace offer': 'peace',
    'peace accept': 'peace',
    'war goal': 'warGoal',
    'scheme target': 'scheme',
    'faction concession': 'faction',
    'league offer': 'league',
    'herder path': 'herders',
};

describe('decision families (fake endpoint, hand-built state)', () => {
    it('every family has a case', () => {
        expect(new Set(Object.values(FAMILY_OF))).toEqual(new Set(STRATEGIC_FAMILIES));
    });

    for (const name of Object.keys(CASES)) {
        const family = FAMILY_OF[name];
        it(`${name}: legal moves enumerated purely; an illegal answer is rejected; the choice applies only as a queued command`, async () => {
            const g = game();
            const c = CASES[name](g);
            // Enumeration on the hand-built state: pure (no state, no Rnd).
            const before = stateDigest(g);
            const draws = g.rnd.drawCount;
            const keys = Object.keys(g.scenario!.state).sort();
            const fam = familyMoves(g, c.e, family);
            expect(fam.map((m) => m.id)).toContain(c.move);
            expect(fam.every((m) => m.family === family && m.id.startsWith(PREFIX[family]) && m.text !== '')).toBe(true);
            const all = legalMoves(g, c.e);
            expect(all.map((m) => m.id)).toContain(c.move);
            expect(stateDigest(g)).toBe(before);
            expect(g.rnd.drawCount).toBe(draws);
            expect(Object.keys(g.scenario!.state).sort()).toEqual(keys);
            // Validation: an id outside the offered moves (a made-up target of the same family) is rejected.
            const bogus = `${PREFIX[family]}${family === 'warGoal' ? '9999:conquest' : 'x:9999'}`;
            const v = validateStrategicAnswer(all, JSON.stringify({ reason: 'x', choice: bogus }));
            expect(v.choice).toBeNull();
            expect(v.error).toMatch(/not one of the legal moves/);
            expect(validateStrategicAnswer(all, JSON.stringify({ reason: '  Because.  ', choice: c.move }))).toEqual({ choice: c.move, reason: 'Because.' });
            // …and a command smuggling it in anyway is refused at the boundary (nothing is called).
            const snap0 = c.snap();
            const refused = applyLlmStrategicCommand(g, c.e, { year: thisYear(g), offered: [bogus], choice: bogus, reason: 'forged' })!;
            expect(refused.status).toBe('refused');
            expect(c.snap()).toBe(snap0);
            // The model's choice: the job asks, validates and ISSUES a command; nothing changes until the boundary.
            const t = transport(pick(c.move));
            const j = job(g, t);
            const ask = await j.ask(c.e, thisYear(g) + 1)!;
            expect(ask!.command!.choice).toBe(c.move);
            expect(t.reqs[0].priority).toBe('background');
            expect(t.reqs[0].purpose).toBe('strategic');
            expect(pendingPlayerCommands(g)).toBe(1);
            expect(c.snap()).toBe(snap0);
            flushPlayerCommands(g);
            c.effect();
            const row = strategicLog(g).at(-1)!;
            expect(row).toMatchObject({ empireId: c.e.empireId, year: thisYear(g) + 1, choice: c.move, family, reason: 'Our people demand it.' });
            // A peace offer the other side refuses is 'blocked' (the sim answered with a counter-offer).
            expect(row.status).toBe(name === 'peace offer' && row.status === 'blocked' ? 'blocked' : 'applied');
            expect(row.offered).toContain(c.move);
            const entry = commandLog(g).at(-1) as PlayerLogEntry;
            expect(entry.source).toBe('player');
            expect(entry.op).toBe('llmStrategic');
            expect((decodeCommandArg(g, entry.args[0] as EncodedArg) as { choice: string }).choice).toBe(c.move);
        });

        it(`${name}: refusal fallback — an unusable or timed-out answer changes nothing but the log`, async () => {
            const g = game();
            const c = CASES[name](g);
            const snap0 = c.snap();
            const digest0 = stateDigest(g);
            await job(g, transport(() => 'I would rather not say.')).ask(c.e, thisYear(g))!;
            await job(g, transport(() => 'hang'), 20).ask(c.e, thisYear(g) + 1)!;
            flushPlayerCommands(g);
            const rows = strategicLog(g);
            expect(rows.map((r) => r.status)).toEqual(['refused', 'refused']);
            expect(rows[0].reason).toMatch(/invalid answer/);
            expect(rows[1].reason).toMatch(/timeout/);
            expect(rows.every((r) => r.choice === null && r.offered.includes(c.move))).toBe(true);
            expect(c.snap()).toBe(snap0);
            expect(stateDigest(g)).toBe(digest0);
        });
    }
});

describe('the job and the prompt', () => {
    it('prompt: the digest (≤ 400 tokens) plus the legal moves; the schema is the offered ids plus "none"', () => {
        const g = game();
        const c = CASES['war goal'](g);
        const moves = legalMoves(g, c.e);
        const { messages, situation } = buildStrategicMessages(g, c.e, moves);
        const sys = messages[0].content;
        const digest = sys.split('\n').find((l) => l.startsWith('SITUATION: '))!.slice('SITUATION: '.length);
        expect(digest.length).toBeLessThanOrEqual(DIGEST_MAX_CHARS);
        expect(estimateTokens(digest)).toBeLessThanOrEqual(400);
        expect(JSON.parse(digest).self.name).toBeDefined();
        for (const m of moves) expect(sys).toContain(m.id);
        expect(situation).toContain(sys);
        expect((strategicSchema(moves) as { properties: { choice: { enum: string[] } } }).properties.choice.enum).toEqual([...moves.map((m) => m.id), 'none']);
        // "none" is a valid answer: logged, no effect.
        const v = validateStrategicAnswer(moves, '{"reason":"We wait.","choice":"none"}');
        expect(v).toEqual({ choice: 'none', reason: 'We wait.' });
        expect(applyLlmStrategicCommand(g, c.e, { year: 1, offered: moves.map((m) => m.id), choice: 'none', reason: v.reason })!.status).toBe('none');
    });

    it('the yearly pass: nearest AI empires, one 30-day slot each, at most one request per empire in flight', async () => {
        const g = game();
        const near = nearestAiEmpires(g, g.playerEmpire, 5);
        expect(near.length).toBe(ais(g).length);
        const cap = g.playerEmpire!.capital!;
        const d = (e: Empire) => (e.capital!.xpos - cap.xpos) ** 2 + (e.capital!.ypos - cap.ypos) ** 2;
        for (let i = 1; i < near.length; i++) expect(d(near[i])).toBeGreaterThanOrEqual(d(near[i - 1]));
        expect(nearestAiEmpires(g, g.playerEmpire, 2)).toEqual(near.slice(0, 2));
        // Give the first two a legal move (a war goal / a peace offer) so their slots send a request.
        declareWar(g, near[1], near[0]);
        const t = transport(() => '{"reason":"We wait.","choice":"none"}');
        const j = job(g, t);
        const year = thisYear(g) + 1;
        const at = (sd: number) => {
            g.nowMs += sd - galaxyStarDate(g);
        };
        const settle = () => new Promise((r) => setTimeout(r, 0));
        at(strategicSlotDue(year, 0) - GAME_DAY_LENGTH);
        j.poll();
        await settle();
        expect(t.reqs.length).toBe(0);
        at(strategicSlotDue(year, 0) + GAME_DAY_LENGTH);
        j.poll();
        expect(j.ask(near[0], year)).toBeNull(); // in flight: one request per empire
        j.poll();
        await j.pending;
        await settle();
        expect(t.reqs.length).toBe(1);
        expect(t.reqs[0].messages[0].content).toContain(near[0].name);
        j.poll(); // same window: already asked
        await settle();
        expect(t.reqs.length).toBe(1);
        at(strategicSlotDue(year, 1) + GAME_DAY_LENGTH);
        j.poll();
        await j.pending;
        await settle();
        expect(t.reqs.length).toBe(2);
        expect(t.reqs[1].messages[0].content).toContain(near[1].name);
        expect(strategicSlotDue(year, 1) - strategicSlotDue(year, 0)).toBe(30 * GAME_DAY_LENGTH);
        flushPlayerCommands(g);
        expect(strategicLog(g).map((r) => [r.empireId, r.year, r.status])).toEqual([
            [near[0].empireId, year, 'none'],
            [near[1].empireId, year, 'none'],
        ]);
        // A new job (a reloaded game) does not ask again for a logged decision.
        const j2 = job(g, t);
        j2.poll();
        expect(j2.ask(near[0], year)).toBeNull();
        await settle();
        expect(t.reqs.length).toBe(2);
        j.dispose();
    });

    it('the decision log shows in the ?llmMetrics=1 overlay text', async () => {
        const g = game();
        const c = CASES['war goal'](g);
        await job(g, transport(pick(c.move))).ask(c.e, thisYear(g))!;
        flushPlayerCommands(g);
        const text = strategicLogText(strategicLog(g));
        expect(text).toContain('strategic 1: applied 1');
        expect(text).toContain(c.e.name.slice(0, 10));
        expect(text).toContain(c.move);
        expect(text).toContain('Our people demand it.');
        expect(strategicLogText([])).toBe('strategic: no decisions yet');
    });

    it('graceful silence: no model sends no command (the rules decide)', async () => {
        const g = game();
        const c = CASES['war goal'](g);
        const t: LlmTransport = { model: () => 'x', probe: async () => false, complete: () => Promise.reject(new Error('down')) };
        const a = await job(g, t).ask(c.e, thisYear(g))!;
        expect(a!.outcome).toBe('silent');
        expect(a!.command).toBeNull();
        expect(pendingPlayerCommands(g)).toBe(0);
    });
});

describe('flags off = faithful game', () => {
    it('llmStrategic off: no job, and the command is a no-op; llmStrategic on without commands runs byte-identical', () => {
        const off = game({ llmStrategic: false });
        expect(strategicOn(off)).toBe(false);
        const e = ais(off)[0];
        expect(applyLlmStrategicCommand(off, e, { year: 0, offered: [], choice: 'none', reason: '' })).toBeNull();
        expect('llmStrategic' in off.scenario!.state).toBe(false);
        const layer = startLlmLayer({ galaxy: off, player: off.playerEmpire, settings: () => ({ endpoint: '', model: '', api: 'openai' }) as never, transport: transport(() => 'hang') });
        expect(layer.strategic).toBeNull();
        layer.dispose();
        const on = game();
        const layer2 = startLlmLayer({ galaxy: on, player: on.playerEmpire, settings: () => ({ endpoint: '', model: '', api: 'openai' }) as never, transport: transport(() => 'hang') });
        expect(layer2.strategic).not.toBeNull();
        layer2.dispose();

        const ref = cachedTickGameRun(base, { seconds: 120 });
        for (const flags of [{}, LAYER]) {
            const g = createScenarioGame(base, { scenario: 'llm-layer', flags: { ...Object.fromEntries(scenarioGameData(base, 'llm-layer').scenario!.manifest.flags.map((f) => [f.name, false])), ...flags } }).game;
            runGameSeconds(g, 120);
            expect(stateDigest(g.galaxy)).toBe(stateDigest(ref.game.galaxy));
            expect(g.galaxy.rnd.drawCount).toBe(ref.game.galaxy.rnd.drawCount);
            expect(Object.keys(g.galaxy.scenario!.state)).toEqual([]);
        }
    }, 600000);
});
