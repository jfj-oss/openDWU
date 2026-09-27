// 19d8 galactic council (tasks/19-mod-layer-scenarios.md §19d item 8): founding at N met empires, late joining, a
// sanction motion applying trade sanctions through the ported relation code, the player's vote through the command
// queue, bloc formation after repeated defeats, a sanctioned member leaving, flags-off equivalence and the save round
// trip mid-motion.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGameRun } from './helpers/gameCache';
import { createScenarioGame } from './helpers/scenarioGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { Game } from '../src/sim/game';
import { runGameSeconds } from '../src/sim/tick/harness';
import { stateCounts, stateDigest } from '../src/sim/tick/digest';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import { defaultStartGameOptions } from '../src/sim/startGameOptions';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { gameYear } from '../src/sim/scenario/hooks';
import { pendingScenarioDecisions } from '../src/sim/scenario/decisions';
import { DiplomaticRelation, DiplomaticRelationType, empireEvaluationByEmpire, empireEvaluationsOf, obtainEmpireEvaluation } from '../src/sim/diplomacy';
import { EmpireMessageType, empireMessages } from '../src/sim/messages';
import { commandLog, type PlayerLogEntry } from '../src/sim/player/commandLog';
import { runPlayerCommand } from '../src/sim/player/playerCommands';
import {
    COUNCIL_VOTE_DECISION,
    blocOf,
    chooseMotion,
    councilOf,
    councilState,
    peekCouncilState,
    proposeMotion,
    reviewCouncil,
    tallyMotion,
    type Council,
} from '../src/sim/scenario/emergent/council';
import { councilView } from '../src/sim/scenario/emergent/councilView';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

const SCENARIO = 'galactic-council';

function fresh(params: Record<string, number> = {}): { game: Game; gameData: GameData } {
    return createScenarioGame(base, { scenario: SCENARIO, params: { councilJoinThreshold: -1000, ...params } });
}

function normalEmpires(g: Galaxy): Empire[] {
    return g.empires.filter((e) => e !== g.independentEmpire && e.pirateEmpireBaseHabitat === null && e.active);
}

function ais(g: Galaxy): Empire[] {
    return normalEmpires(g).filter((e) => e !== g.playerEmpire);
}

function setMet(a: Empire, b: Empire, met: boolean): void {
    for (const [x, y] of [[a, b], [b, a]] as const) {
        const r = x.diplomaticRelations.byEmpire(y);
        if (r === null) {
            if (met) x.diplomaticRelations.add(new DiplomaticRelation(DiplomaticRelationType.None, a, x, y, false));
        } else if (met && r.type === DiplomaticRelationType.NotMet) r.type = DiplomaticRelationType.None;
        else if (!met) r.type = DiplomaticRelationType.NotMet;
    }
}

/** Nobody has met anybody (normal empires). */
function isolateAll(g: Galaxy): void {
    const es = normalEmpires(g);
    for (const a of es) for (const b of es) if (a !== b) setMet(a, b, false);
}

function meetAll(es: Empire[]): void {
    for (const a of es) for (const b of es) if (a !== b) setMet(a, b, true);
}

function setIncident(g: Galaxy, a: Empire, b: Empire, v: number): void {
    obtainEmpireEvaluation(g, a, b).incidentEvaluation = v;
}

function rawIncident(a: Empire, b: Empire): number {
    return empireEvaluationByEmpire(empireEvaluationsOf(a), b)?.incidentEvaluationRaw ?? 0;
}

function year(g: Galaxy): number {
    return gameYear(galaxyStarDate(g));
}

/** A council of the three AIs (the player has met nobody). */
function aiCouncil(g: Galaxy): { c: Council; a: Empire; b: Empire; x: Empire } {
    isolateAll(g);
    const [a, b, x] = ais(g);
    meetAll([a, b, x]);
    reviewCouncil(g, year(g));
    const c = councilOf(g, a)!;
    expect(c).not.toBeNull();
    c.motion = null; // drop the founding year's own motion; tests put their own
    return { c, a, b, x };
}

describe('founding and membership', () => {
    it('the council forms once N empires have all met each other; a late-met empire joins on contact', () => {
        const { game } = fresh({ councilFoundingMembers: 3 });
        const g = game.galaxy;
        const p = g.playerEmpire!;
        isolateAll(g);
        const [a, b, x] = ais(g);
        setMet(a, b, true);
        setMet(b, x, true);
        reviewCouncil(g, year(g));
        expect(peekCouncilState(g)!.councils).toHaveLength(0); // a and x have not met
        setMet(a, x, true);
        reviewCouncil(g, year(g));
        const c = councilOf(g, a)!;
        expect(c.members.map((e) => e.empireId)).toEqual([a, b, x].map((e) => e.empireId).sort((u, v) => u - v));
        expect(c.name).not.toBe('');
        expect(c.members).toContain(c.chair);
        expect(councilOf(g, p)).toBeNull();
        // Everyone hears of it (NewsNet); members get a message.
        expect(empireMessages(p).some((m) => m.messageType === EmpireMessageType.GalacticNewsNet && m.description.includes(c.name))).toBe(true);
        expect(empireMessages(a).some((m) => m.title === `${c.name} founded`)).toBe(true);
        // The player meets one member: next session it takes a seat.
        setMet(p, a, true);
        reviewCouncil(g, year(g) + 1);
        expect(councilOf(g, p)).toBe(c);
        expect(councilView(g, p)!.members.map((m) => m.name)).toContain(p.name);
    }, 600000);

    it('the chair rotates each year by prestige (not the same empire twice running)', () => {
        const { game } = fresh();
        const { c } = aiCouncil(game.galaxy);
        const first = c.chair;
        reviewCouncil(game.galaxy, year(game.galaxy) + 1);
        expect(c.chair).not.toBe(first);
        expect(c.members).toContain(c.chair);
    }, 600000);
});

describe('motions and votes', () => {
    it('a sanction motion is chosen from a grievance, passes and applies trade sanctions for every member', () => {
        const { game } = fresh();
        const g = game.galaxy;
        const { c, a, b, x } = aiCouncil(g);
        setIncident(g, a, x, -100);
        setIncident(g, b, x, -100);
        const cand = chooseMotion(g, c, year(g))!;
        expect(cand.kind).toBe('sanction');
        expect(cand.target).toBe(x);
        const m = proposeMotion(g, c, cand);
        expect(m.status).toBe('passed');
        expect(m.votes.find((v) => v.empire === x)!.vote).toBe('no');
        expect(m.votes.find((v) => v.empire === b)!.vote).toBe('yes');
        expect(a.diplomaticRelations.byEmpire(x)!.type).toBe(DiplomaticRelationType.TradeSanctions);
        expect(b.diplomaticRelations.byEmpire(x)!.type).toBe(DiplomaticRelationType.TradeSanctions);
        expect(c.sanctions.some((s) => s.target === x && s.kind === 'sanction')).toBe(true);
        expect(c.results.at(-1)!.passed).toBe(true);
        expect(empireMessages(x).some((mm) => mm.title.includes('motion passed'))).toBe(true);
    }, 600000);

    it('the player votes through a scenario decision routed by the command queue', () => {
        const { game } = fresh();
        const g = game.galaxy;
        const p = g.playerEmpire!;
        isolateAll(g);
        const [a, b, x] = ais(g);
        meetAll([p, a, b, x]);
        reviewCouncil(g, year(g));
        const c = councilOf(g, p)!;
        expect(c.members).toHaveLength(4);
        c.motion = null;
        for (const d of pendingScenarioDecisions(g, p)) runPlayerCommand(g, p, 'answerScenarioDecision', [d.id, d.defaultOption]);
        setIncident(g, b, x, -100);
        const m = proposeMotion(g, c, { kind: 'sanction', proposer: a, target: x, other: a, resourceId: -1 });
        expect(m.status).toBe('voting');
        const d = pendingScenarioDecisions(g, p).find((q) => q.kind === COUNCIL_VOTE_DECISION)!;
        expect(d.context.motionId).toBe(m.id);
        expect(councilView(g, p)!.voteDecisionId).toBe(d.id);
        expect(runPlayerCommand(g, p, 'answerScenarioDecision', [d.id, 'yes'])).toBe(true);
        expect(m.status).toBe('passed');
        expect(m.votes.find((v) => v.empire === p)!.vote).toBe('yes');
        expect(p.diplomaticRelations.byEmpire(x)!.type).toBe(DiplomaticRelationType.TradeSanctions);
        expect(commandLog(g).at(-1) as PlayerLogEntry).toMatchObject({ source: 'player', op: 'answerScenarioDecision', args: [d.id, 'yes'] });
    }, 600000);

    it('members outvoted together repeatedly form a bloc, which then favours its members', () => {
        const { game } = fresh({ councilBlocLosses: 3 });
        const g = game.galaxy;
        const p = g.playerEmpire!;
        isolateAll(g);
        const [a, b, x] = ais(g);
        meetAll([p, a, b, x]);
        reviewCouncil(g, year(g));
        const c = councilOf(g, p)!;
        c.motion = null;
        for (let i = 0; i < 3; i++) {
            expect(blocOf(c, b)).toBeNull();
            const m = proposeMotion(g, c, { kind: 'condemn', proposer: a, target: p, other: a, resourceId: -1 });
            m.votes = [
                { empire: a, vote: 'yes', score: 0, coordinated: false },
                { empire: p, vote: 'yes', score: 0, coordinated: false },
                { empire: b, vote: 'no', score: 0, coordinated: false },
                { empire: x, vote: 'abstain', score: 0, coordinated: false },
            ];
            tallyMotion(g, c, m);
            expect(m.status).toBe('passed');
        }
        const bloc = blocOf(c, b)!;
        expect(bloc).not.toBeNull();
        expect(bloc.members).toEqual([b, x].sort((u, v) => u.empireId - v.empireId));
        expect(blocOf(c, a)).toBeNull();
        const before = rawIncident(b, x);
        reviewCouncil(g, year(g) + 1);
        expect(bloc.hardness).toBe(1);
        expect(rawIncident(b, x)).toBeGreaterThan(before);
    }, 600000);
});

describe('consequences', () => {
    it('a sanctioned member leaves by its traits; leaving costs relations with every member', () => {
        for (const threshold of [1000, -1000]) {
            const { game } = fresh({ councilLeaveThreshold: threshold, councilLeavePenalty: 10 });
            const g = game.galaxy;
            const { c, a, b, x } = aiCouncil(g);
            setIncident(g, a, x, -100);
            setIncident(g, b, x, -100);
            proposeMotion(g, c, { kind: 'sanction', proposer: a, target: x, other: a, resourceId: -1 });
            const before = rawIncident(a, x);
            reviewCouncil(g, year(g) + 1);
            if (threshold > 0) {
                expect(c.members).toContain(x);
            } else {
                expect(c.members).not.toContain(x);
                expect(councilState(g).leftYear[x.empireId]).toBe(year(g) + 1);
                expect(rawIncident(a, x)).toBeCloseTo(before - 10, 5);
                // A 2-member council survives; x cannot rejoin before councilRejoinYears.
                reviewCouncil(g, year(g) + 2);
                expect(councilOf(g, x)).toBeNull();
            }
        }
    }, 600000);
});

function saveText(game: Game): string {
    const time = new GalaxyTime();
    time.togglePause();
    time.advance(game.galaxy.nowMs);
    const s = game.galaxy.scenario!;
    return serializeGame(game, time, { ...defaultStartGameOptions(), seed: 1, scenario: { id: s.id, flags: { ...s.flags }, params: { ...s.params } } });
}

describe('§S6 checks', () => {
    it('flags off: the scenario game is byte-identical to the faithful game over a game year (no draws, same digest)', () => {
        const ref = cachedTickGameRun(base, { seconds: 600 });
        const { game } = createScenarioGame(base, { scenario: SCENARIO, flags: { galacticCouncil: false } });
        const run = runGameSeconds(game, 600);
        expect(stateDigest(game.galaxy)).toBe(stateDigest(ref.game.galaxy));
        expect(stateCounts(game.galaxy)).toEqual(stateCounts(ref.game.galaxy));
        expect(run.rndDraws).toBe(ref.run.rndDraws);
        expect(game.galaxy.rnd.drawCount).toBe(ref.game.galaxy.rnd.drawCount);
        expect('council' in game.galaxy.scenario!.state).toBe(false);
        expect(councilView(game.galaxy, game.galaxy.playerEmpire!)).toBeNull();
    }, 2400000);

    it('save round trip mid-motion: the vote survives and the continuation matches', () => {
        const { game, gameData } = fresh();
        const g = game.galaxy;
        const p = g.playerEmpire!;
        isolateAll(g);
        const [a, b, x] = ais(g);
        meetAll([p, a, b, x]);
        reviewCouncil(g, year(g));
        const c = councilOf(g, p)!;
        c.motion = null;
        for (const d of pendingScenarioDecisions(g, p)) runPlayerCommand(g, p, 'answerScenarioDecision', [d.id, d.defaultOption]);
        setIncident(g, b, x, -100);
        const m = proposeMotion(g, c, { kind: 'sanction', proposer: a, target: x, other: a, resourceId: -1 });
        const d = pendingScenarioDecisions(g, p).find((q) => q.kind === COUNCIL_VOTE_DECISION)!;
        const loaded = deserializeGame(saveText(game), gameData).game;
        const lg = loaded.galaxy;
        const lp = lg.playerEmpire!;
        const lc = councilOf(lg, lp)!;
        expect(lc.name).toBe(c.name);
        expect(lc.motion!.id).toBe(m.id);
        expect(lc.motion!.status).toBe('voting');
        expect(lc.motion!.votes.map((v) => [v.empire.empireId, v.vote])).toEqual(m.votes.map((v) => [v.empire.empireId, v.vote]));
        expect(pendingScenarioDecisions(lg, lp).some((q) => q.id === d.id)).toBe(true);
        runPlayerCommand(g, p, 'answerScenarioDecision', [d.id, 'no']);
        runPlayerCommand(lg, lp, 'answerScenarioDecision', [d.id, 'no']);
        expect(lc.results.at(-1)).toMatchObject({ passed: c.results.at(-1)!.passed, yes: c.results.at(-1)!.yes, no: c.results.at(-1)!.no });
        runGameSeconds(game, 60);
        runGameSeconds(loaded, 60);
        expect(stateDigest(lg)).toBe(stateDigest(g));
    }, 2400000);
});
