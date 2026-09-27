// 19o reputation & grievances ledger (tasks/19-mod-layer-scenarios.md §19o): entry + decay maths, a 19d3 crisis → an
// entry with its cause, the attitude identical with the ledger on vs off, the diplomacy screen's causes list, the pirate
// channel, a save round trip and flags-off byte-identity.
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
import { CharacterRole, generateNewCharacter, getEmpireCharacters, type Character } from '../src/sim/characters';
import { IntelligenceMissionType as MT, newIntelligenceMissionAgainstHabitat, performIntelligenceMissions } from '../src/sim/espionage';
import { DiplomaticRelation, DiplomaticRelationType, empireEvaluationByEmpire, empireEvaluationsOf, obtainEmpireEvaluation } from '../src/sim/diplomacy';
import { obtainPirateRelation, PirateRelationEvaluationType, PirateRelationType } from '../src/sim/pirateRelations';
import { openCrisis, reviewEspionage, strengthRatio } from '../src/sim/scenario/emergent/espionage';
import {
    applyPirateReputation,
    applyReputation,
    grievances,
    peekReputationState,
    recordReputation,
    reputationCauses,
    reputationSum,
    reputationYear,
    REPUTATION_DEFAULT_DECAY,
} from '../src/sim/scenario/reputation/ledger';
import { reputationRows } from '../src/sim/scenario/reputation/view';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

const SC = 'reputation';
const ALL_OFF: Record<string, boolean> = {
    reputationLedger: false,
    internalPolitics: false,
    livingCharacters: false,
    resourceCrises: false,
    espionageConsequences: false,
    refugees: false,
};

function repGame(ledger: boolean): { game: Game; gameData: GameData } {
    return createScenarioGame(base, { scenario: SC, flags: { ...ALL_OFF, espionageConsequences: true, reputationLedger: ledger } });
}

function aiEmpires(g: Galaxy): Empire[] {
    return g.empires.filter((e) => e !== g.playerEmpire && e !== g.independentEmpire && e.pirateEmpireBaseHabitat === null && e.active);
}

function meet(a: Empire, b: Empire): void {
    for (const [x, y] of [[a, b], [b, a]] as const) {
        const r = x.diplomaticRelations.byEmpire(y);
        if (r === null) x.diplomaticRelations.add(new DiplomaticRelation(DiplomaticRelationType.None, a, x, y, false));
        else if (r.type === DiplomaticRelationType.NotMet) r.type = DiplomaticRelationType.None;
    }
}

/** An AI pair (offender, victim) where the victim is not ≥ 1.5× stronger (the 19d3 AI refuses the demand). */
function refusingPair(g: Galaxy): [Empire, Empire] {
    const ais = aiEmpires(g);
    for (const a of ais) for (const b of ais) if (a !== b && strengthRatio(b, a) < 1.5) return [a, b];
    throw new Error('no AI pair');
}

/** n captured SabotageColony missions of a against b (the "Romulan" name forces Capture without a draw; 19d3 test). */
function forceCaptures(g: Galaxy, a: Empire, b: Empire, n: number): void {
    for (const c of getEmpireCharacters(a)) if (c.role === CharacterRole.IntelligenceAgent) c.mission = null;
    const colony = b.colonies[0] ?? b.capital!;
    for (let i = 0; i < n; i++) {
        const agent: Character = generateNewCharacter(g, a, CharacterRole.IntelligenceAgent, a.capital).character;
        const m = newIntelligenceMissionAgainstHabitat(a, agent, MT.SabotageColony, 0, colony);
        m.timeLength = 0;
        agent.mission = m;
    }
    const name = b.name;
    b.name = `${name} Romulan`;
    try {
        performIntelligenceMissions(g, a);
    } finally {
        b.name = name;
    }
}

/** The 19d3 crisis script: a capture, the crisis opens (demand refused), then sanctions the year after. */
function runCrisis(g: Galaxy): [Empire, Empire] {
    const [a, b] = refusingPair(g);
    meet(a, b);
    obtainEmpireEvaluation(g, a, b).incidentEvaluation = -100; // a dislikes b: the AI refuses
    forceCaptures(g, a, b, 1); // one capture: the crisis opens and the incident sum stays inside the caps
    const year = gameYear(galaxyStarDate(g));
    reviewEspionage(g, year + 1);
    expect(openCrisis(g, a, b)!.stage).toBe('demand');
    reviewEspionage(g, year + 2);
    expect(openCrisis(g, a, b)!.stage).toBe('sanctions');
    return [a, b];
}

function saveText(game: Game): string {
    const time = new GalaxyTime();
    time.togglePause();
    time.advance(game.galaxy.nowMs);
    const s = game.galaxy.scenario!;
    return serializeGame(game, time, { ...defaultStartGameOptions(), seed: 1, scenario: { id: s.id, flags: { ...s.flags }, params: { ...s.params } } });
}

describe('ledger maths', () => {
    let g: Galaxy;
    let a: Empire;
    let b: Empire;
    beforeAll(() => {
        g = repGame(true).game.galaxy;
        [a, b] = aiEmpires(g);
    }, 600000);

    it('records per ordered pair, merges by cause, sums by term', () => {
        const e = recordReputation(g, a, b, { cause: 'test.slight', value: -10, source: 'test' })!;
        expect(e.decayPerYear).toBe(REPUTATION_DEFAULT_DECAY);
        expect(e.labelKey).toBe('Reputation Cause test.slight');
        expect(e.date).toBe(galaxyStarDate(g));
        recordReputation(g, a, b, { cause: 'test.slight', value: -5, source: 'test', decayPerYear: 4 });
        recordReputation(g, a, b, { cause: 'test.gift', value: 6, source: 'test', decayPerYear: 0 });
        recordReputation(g, a, b, { cause: 'test.like', value: 2, source: 'test', term: 'bias', decayPerYear: 1 });
        expect(reputationSum(g, a, b)).toBe(-7);
        expect(reputationSum(g, a, b, 'incident')).toBe(-9);
        expect(reputationSum(g, a, b, 'bias')).toBe(2);
        expect(reputationSum(g, b, a)).toBe(0); // ordered pair
        expect(reputationCauses(g, a, b).map((x) => [x.cause, x.value])).toEqual([['test.slight', -15], ['test.gift', 6], ['test.like', 2]]);
        // Sub-faction actors (a league / herder colony of b) are their own pair.
        recordReputation(g, a, { empireId: b.empireId, sub: 'league-1' }, { cause: 'test.league', value: -30, source: 'test' });
        expect(reputationSum(g, a, b)).toBe(-7);
        expect(reputationSum(g, a, { empireId: b.empireId, sub: 'league-1' })).toBe(-30);
        expect(recordReputation(g, a, a, { cause: 'x', value: 1, source: 'test' })).toBeNull();
    });

    it('grievances: negative entries of at least minValue, worst first', () => {
        expect(grievances(g, a, b).map((x) => x.cause)).toEqual(['test.slight']);
        expect(grievances(g, a, b, 16)).toEqual([]);
        recordReputation(g, a, b, { cause: 'test.insult', value: -20, source: 'test' });
        expect(grievances(g, a, b, 10).map((x) => x.cause)).toEqual(['test.insult', 'test.slight']);
    });

    it('yearly decay moves each entry toward 0 by its rate and drops spent ones', () => {
        reputationYear(g);
        const v = (c: string) => reputationCauses(g, a, b).find((x) => x.cause === c)?.value;
        expect(v('test.slight')).toBe(-11); // -15 + 4
        expect(v('test.insult')).toBe(-17); // -20 + 3
        expect(v('test.gift')).toBe(6); // permanent
        expect(v('test.like')).toBe(1);
        reputationYear(g);
        expect(v('test.like')).toBeUndefined();
        for (let i = 0; i < 10; i++) reputationYear(g);
        expect(reputationCauses(g, a, b).map((x) => x.cause)).toEqual(['test.gift']);
        expect(reputationSum(g, a, { empireId: b.empireId, sub: 'league-1' })).toBe(0);
    });

    it('the channel: incident entries join IncidentEvaluation (clamped), bias entries join Bias; the stock field is untouched', () => {
        recordReputation(g, a, b, { cause: 'test.gift', value: -6, source: 'test' }); // merged to 0: removed
        expect(peekReputationState(g)!.pairs[`${a.empireId}>${b.empireId}`]).toBeUndefined();
        const ev = obtainEmpireEvaluation(g, a, b);
        ev.incidentEvaluation = -40;
        const before = ev.overallAttitude;
        const stockBias = ev.biasRaw;
        recordReputation(g, a, b, { cause: 'test.big', value: -200, source: 'test' });
        expect(ev.incidentEvaluationRaw).toBe(-40);
        expect(ev.incidentEvaluationStock).toBe(-40 / ev.diplomacyFactor);
        expect(ev.incidentEvaluation).toBe(-150 / ev.diplomacyFactor); // -240 clamped to the setter's cap
        expect(ev.overallAttitude).toBeLessThan(before);
        recordReputation(g, a, b, { cause: 'test.big', value: 200, source: 'test' });
        expect(ev.overallAttitude).toBe(before); // back to the stock value
        recordReputation(g, a, b, { cause: 'test.like', value: 5, source: 'test', term: 'bias' });
        expect(ev.biasRaw).toBe(stockBias);
        const t = stockBias + 5;
        expect(ev.bias).toBe(t <= 0 ? t / ev.diplomacyFactor : t * ev.diplomacyFactor);
        expect(ev.biasStock).toBe(stockBias <= 0 ? stockBias / ev.diplomacyFactor : stockBias * ev.diplomacyFactor);
    });
});

describe('19d3 crisis through the ledger', () => {
    it('a crisis escalating to sanctions records a caused entry, and the attitude is identical with the ledger on vs off', () => {
        const on = repGame(true).game.galaxy;
        const off = repGame(false).game.galaxy;
        const [a, b] = runCrisis(on);
        const [a2, b2] = runCrisis(off);
        expect([a2.empireId, b2.empireId]).toEqual([a.empireId, b.empireId]);
        const c = openCrisis(on, a, b)!;
        // The entry: the victim's grievance against the offender, with its cause.
        const causes = reputationCauses(on, b, a);
        expect(causes).toHaveLength(1);
        expect(causes[0]).toMatchObject({ cause: 'espionage.sanctions', value: -c.severity / 2, source: '19d3', decayPerYear: REPUTATION_DEFAULT_DECAY, term: 'incident', labelKey: 'Reputation Cause espionage.sanctions' });
        expect(grievances(on, b, a, 1).map((x) => x.cause)).toEqual(['espionage.sanctions']);
        expect(reputationCauses(off, b2, a2)).toEqual([]);
        expect(peekReputationState(off)).toBeNull();
        // The source stopped writing directly: the stock field differs by exactly the entry.
        const evOn = empireEvaluationByEmpire(empireEvaluationsOf(b), a)!;
        const evOff = empireEvaluationByEmpire(empireEvaluationsOf(b2), a2)!;
        expect(evOn.incidentEvaluationRaw).toBeCloseTo(evOff.incidentEvaluationRaw + c.severity / 2, 9);
        expect(evOff.incidentEvaluationRaw).toBeGreaterThan(-150); // the sum is not at the cap (the test is meaningful)
        // Same attitude, both ways.
        expect(evOn.incidentEvaluation).toBeCloseTo(evOff.incidentEvaluation, 9);
        expect(evOn.overallAttitude).toBe(evOff.overallAttitude);
        expect(evOn.overallAttitudeWithoutSystemCompetition).toBe(evOff.overallAttitudeWithoutSystemCompetition);
        const back = empireEvaluationByEmpire(empireEvaluationsOf(a), b)!;
        const back2 = empireEvaluationByEmpire(empireEvaluationsOf(a2), b2)!;
        expect(back.overallAttitude).toBe(back2.overallAttitude);
        // The diplomacy screen's "Why they feel this way" rows for the offender looking at the victim.
        const rows = reputationRows(on, a, b);
        expect(rows).toHaveLength(1);
        expect(rows[0].label).toBe('Your spies forced us to impose sanctions');
        expect(rows[0].text).toMatch(/^-\d+(\.\d)? Your spies forced us to impose sanctions — fades 3\/yr \(19d3, /);
        expect(reputationRows(off, a2, b2)).toEqual([]);
        expect(reputationRows(on, b, a)).toEqual([]); // nothing the offender holds against the victim
    }, 2400000);

    it('applyReputation flag off = the former direct write; pirate pairs go through the PirateRelation evaluation', () => {
        const on = repGame(true).game.galaxy;
        const off = repGame(false).game.galaxy;
        const [a, b] = aiEmpires(on);
        const [a2, b2] = aiEmpires(off);
        applyReputation(on, a, b, -12, { cause: 'test.x', source: 'test' });
        applyReputation(off, a2, b2, -12, { cause: 'test.x', source: 'test' });
        expect(obtainEmpireEvaluation(on, a, b).incidentEvaluationRaw).toBe(0);
        expect(obtainEmpireEvaluation(off, a2, b2).incidentEvaluationRaw).toBe(-12);
        expect(obtainEmpireEvaluation(on, a, b).overallAttitude).toBe(obtainEmpireEvaluation(off, a2, b2).overallAttitude);
        const p = on.pirateEmpires.find((e) => e.active)!;
        const p2 = off.pirateEmpires.find((e) => e.empireId === p.empireId)!;
        const r = obtainPirateRelation(a, p);
        const r2 = obtainPirateRelation(a2, p2);
        r.type = PirateRelationType.None;
        r2.type = PirateRelationType.None;
        const before = r.evaluation;
        applyPirateReputation(on, a, p, -8, PirateRelationEvaluationType.RaidsAgainstOurColonies, { cause: 'test.raid', source: 'test' });
        applyPirateReputation(off, a2, p2, -8, PirateRelationEvaluationType.RaidsAgainstOurColonies, { cause: 'test.raid', source: 'test' });
        expect(r.evaluationRaidsAgainstOurColonies).toBe(0);
        expect(r2.evaluationRaidsAgainstOurColonies).toBe(-8);
        expect(r.evaluation).toBe(r2.evaluation);
        expect(r.evaluation).toBeLessThan(before);
    }, 2400000);
});

describe('save / flags off', () => {
    it('save round trip: the entries survive and the continuation matches', () => {
        const { game, gameData } = repGame(true);
        const g = game.galaxy;
        const [a, b] = runCrisis(g);
        recordReputation(g, a, { empireId: b.empireId, sub: 'herders-3' }, { cause: 'test.herd', value: -4, source: 'test' });
        const text = saveText(game);
        const loaded = deserializeGame(text, gameData).game;
        const lg = loaded.galaxy;
        const la = lg.empires.find((e) => e.empireId === a.empireId)!;
        const lb = lg.empires.find((e) => e.empireId === b.empireId)!;
        expect(reputationCauses(lg, lb, la)).toEqual(reputationCauses(g, b, a));
        expect(reputationSum(lg, la, { empireId: b.empireId, sub: 'herders-3' })).toBe(-4);
        expect(empireEvaluationByEmpire(empireEvaluationsOf(lb), la)!.overallAttitude).toBe(empireEvaluationByEmpire(empireEvaluationsOf(b), a)!.overallAttitude);
        runGameSeconds(game, 60);
        runGameSeconds(loaded, 60);
        expect(stateDigest(lg)).toBe(stateDigest(g));
        expect(reputationCauses(lg, lb, la)).toEqual(reputationCauses(g, b, a));
    }, 2400000);

    it('flags off: the scenario game is byte-identical to the faithful game (no draws, same digest, no state)', () => {
        const ref = cachedTickGameRun(base, { seconds: 600 });
        const { game } = createScenarioGame(base, { scenario: SC, flags: ALL_OFF });
        const run = runGameSeconds(game, 600);
        expect(stateDigest(game.galaxy)).toBe(stateDigest(ref.game.galaxy));
        expect(stateCounts(game.galaxy)).toEqual(stateCounts(ref.game.galaxy));
        expect(run.rndDraws).toBe(ref.run.rndDraws);
        expect(game.galaxy.rnd.drawCount).toBe(ref.game.galaxy.rnd.drawCount);
        expect('reputation' in game.galaxy.scenario!.state).toBe(false);
    }, 2400000);
});
