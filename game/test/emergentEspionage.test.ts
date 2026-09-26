// 19d3 espionage consequences (tasks/19d3-espionage-consequences.md §7): unit rules, harness scenarios for each
// consequence (crisis → refusal → sanctions, player decisions, false flags, stolen-tech provenance / resale / discovery),
// flags-off equivalence, determinism and the save round trip (tasks/19d1-internal-politics.md §S6).
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
import { pendingScenarioDecisions, answerScenarioDecision } from '../src/sim/scenario/decisions';
import { CharacterRole, generateNewCharacter, getEmpireCharacters, type Character } from '../src/sim/characters';
import {
    IntelligenceMissionOutcome as O,
    IntelligenceMissionType as MT,
    characterMission,
    completeIntelligenceMission,
    newIntelligenceMissionAgainstEmpire,
    newIntelligenceMissionAgainstHabitat,
    newIntelligenceMissionStealTechData,
    performIntelligenceMissions,
} from '../src/sim/espionage';
import { DiplomaticRelation, DiplomaticRelationType, empireEvaluationByEmpire, empireEvaluationsOf, obtainEmpireEvaluation } from '../src/sim/diplomacy';
import { TradeableItem, TradeableItemType, giveTradeableItem } from '../src/sim/tradeItems';
import {
    aiOffenderComplies,
    attitudeOf,
    canFrame,
    chooseDemand,
    empireSpyCrises,
    espionageState,
    exposureWeight,
    falseFlagAttribution,
    falseFlagSeenThroughChance,
    frameCandidates,
    missionFrame,
    openCrisis,
    recordExposure,
    reviewEspionage,
    setMissionFrame,
    stolenTechsOf,
    strengthRatio,
    victimWouldGoToWar,
    type SpyCrisis,
} from '../src/sim/scenario/emergent/espionage';
import { espionageHooks } from '../src/sim/scenario/emergent/espionageHooks';
import { blameOptions, incidentRows, stolenTechMarker } from '../src/sim/scenario/emergent/espionageView';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

const SCENARIO = 'espionage-consequences';

function freshGame(params: Record<string, number> = {}): Game {
    return createScenarioGame(base, { scenario: SCENARIO, params }).game;
}

function aiEmpires(g: Galaxy): Empire[] {
    return g.empires.filter((e) => e !== g.playerEmpire && e !== g.independentEmpire && e.pirateEmpireBaseHabitat === null && e.active);
}

/** meetEmpiresAtStart's contact (diplomacy.ts): a None relation both ways. */
function meet(a: Empire, b: Empire): void {
    for (const [x, y] of [[a, b], [b, a]] as const) {
        const r = x.diplomaticRelations.byEmpire(y);
        if (r === null) x.diplomaticRelations.add(new DiplomaticRelation(DiplomaticRelationType.None, a, x, y, false));
        else if (r.type === DiplomaticRelationType.NotMet) r.type = DiplomaticRelationType.None;
    }
}

function setIncident(g: Galaxy, a: Empire, b: Empire, v: number): void {
    obtainEmpireEvaluation(g, a, b).incidentEvaluation = v;
}

function rawIncident(a: Empire, b: Empire): number {
    return empireEvaluationByEmpire(empireEvaluationsOf(a), b)?.incidentEvaluationRaw ?? 0;
}

/** Clears every agent mission of `e` (isolates performIntelligenceMissions to the missions a test sets). */
function idleAgents(e: Empire): void {
    for (const c of getEmpireCharacters(e)) if (c.role === CharacterRole.IntelligenceAgent) c.mission = null;
}

function newAgent(g: Galaxy, e: Empire): Character {
    return generateNewCharacter(g, e, CharacterRole.IntelligenceAgent, e.capital).character;
}

/**
 * Forces `n` captured SabotageColony missions of A against B through the ported outcome block: the target's name
 * holds "Romulan" (BaconEmpire.cs 88: always Capture, no draw), missions are due (start 0, length 0).
 */
function forceCaptures(g: Galaxy, a: Empire, b: Empire, n: number, frameOn: Empire | null = null): void {
    idleAgents(a);
    const colony = b.colonies[0] ?? b.capital!;
    for (let i = 0; i < n; i++) {
        const agent = newAgent(g, a);
        const m = newIntelligenceMissionAgainstHabitat(a, agent, MT.SabotageColony, 0, colony);
        m.timeLength = 0;
        agent.mission = m;
        if (frameOn !== null) expect(setMissionFrame(g, m, frameOn)).toBe(true);
    }
    const name = b.name;
    b.name = `${name} Romulan`;
    try {
        performIntelligenceMissions(g, a);
    } finally {
        b.name = name;
    }
}

/** A pair of AI empires (offender, victim) where the victim is not ≥ 1.5× stronger (the AI comply rule's gate). */
function refusingPair(g: Galaxy): [Empire, Empire, Empire] {
    const ais = aiEmpires(g);
    for (const a of ais) for (const b of ais) {
        if (a === b || strengthRatio(b, a) >= 1.5) continue;
        const c = ais.find((x) => x !== a && x !== b)!;
        return [a, b, c];
    }
    throw new Error('no AI pair');
}

describe('rules (pure)', () => {
    it('severity weights: type weight × capture 1.5', () => {
        expect(exposureWeight(10, MT.StealTechData, O.FailDetect)).toBe(10);
        expect(exposureWeight(10, MT.SabotageColony, O.FailDetect)).toBe(15);
        expect(exposureWeight(10, MT.AssassinateCharacter, O.SucceedDetect)).toBe(20);
        expect(exposureWeight(10, MT.DestroyBase, O.Capture)).toBe(30);
        expect(exposureWeight(10, MT.InciteRevolution, O.Capture)).toBe(30);
        expect(exposureWeight(10, MT.SabotageColony, O.Capture)).toBe(22.5);
    });
    it('demand choice by severity', () => {
        expect(chooseDemand(12, 1e6)).toEqual({ demand: 'recall', amount: 0 });
        expect(chooseDemand(30, 1e6)).toEqual({ demand: 'apology', amount: 0 });
        expect(chooseDemand(45, 1e6)).toEqual({ demand: 'reparations', amount: 45000 });
        expect(chooseDemand(45, 100000)).toEqual({ demand: 'reparations', amount: 20000 });
    });
    it('false-flag detection chance is clamped to [0.05, 0.95]', () => {
        expect(falseFlagSeenThroughChance(0, 1000, O.FailDetect)).toBe(0.05);
        expect(falseFlagSeenThroughChance(1000, 0, O.Capture)).toBe(0.95);
        expect(falseFlagSeenThroughChance(75, 100, O.FailDetect)).toBeCloseTo(0.2);
        expect(falseFlagSeenThroughChance(75, 100, O.Capture)).toBeCloseTo(0.6);
    });
});

describe('A. exposed agents → diplomatic crises', () => {
    let game: Game;
    let g: Galaxy;
    beforeAll(() => {
        game = freshGame();
        g = game.galaxy;
    }, 600000);

    it('three captured saboteurs open a crisis next year; the AI refuses; sanctions the year after', () => {
        const [a, b] = refusingPair(g);
        meet(a, b);
        setIncident(g, a, b, -100); // A dislikes B: the §4.1 rule refuses
        const before = rawIncident(b, a);
        forceCaptures(g, a, b, 3);
        const st = espionageState(g);
        const mine = st.exposures.filter((x) => x.offender === a && x.victim === b);
        expect(mine.length).toBe(3);
        expect(mine.every((x) => x.outcome === O.Capture && x.missionType === MT.SabotageColony)).toBe(true);
        expect(rawIncident(b, a)).toBeLessThan(before); // the ported incident still lands on A
        const year = gameYear(galaxyStarDate(g));
        reviewEspionage(g, year + 1);
        const c = openCrisis(g, a, b)!;
        expect(c).not.toBeNull();
        expect(c.severity).toBeCloseTo(mine.reduce((s, x) => s + x.weight, 0));
        expect(c.stage).toBe('demand');
        expect(c.demand).toBe(chooseDemand(c.severity, 0).demand);
        expect(aiOffenderComplies(c)).toBe(false);
        expect(c.response).toBe('refused');
        expect(c.cause).toContain(mine[0].agentName);
        const incidentAtOpen = rawIncident(b, a);
        reviewEspionage(g, year + 2);
        expect(c.stage).toBe('sanctions');
        expect(rawIncident(b, a)).toBeLessThan(incidentAtOpen);
        expect(b.diplomaticRelations.byEmpire(a)!.type).toBe(DiplomaticRelationType.TradeSanctions);
        expect(empireSpyCrises(g, a)).toContain(c);
    });

    it('war only with the attitude and strength gates, never against a mutual-defence partner', () => {
        const [a, b] = refusingPair(g);
        meet(a, b);
        const rel = b.diplomaticRelations.byEmpire(a)!;
        const saved = rel.type;
        setIncident(g, b, a, 0);
        expect(victimWouldGoToWar(b, a)).toBe(false); // attitude not low enough
        setIncident(g, b, a, -10000);
        expect(victimWouldGoToWar(b, a)).toBe(strengthRatio(b, a) >= 0.8);
        rel.type = DiplomaticRelationType.MutualDefensePact;
        expect(victimWouldGoToWar(b, a)).toBe(false);
        rel.type = saved;
    });

    it('AI comply rule: positive attitude or a much stronger victim, and the demand affordable', () => {
        const [a, b] = refusingPair(g);
        const c = { offender: a, victim: b, demand: 'apology', amount: 0 } as SpyCrisis;
        setIncident(g, a, b, 500);
        expect(attitudeOf(a, b)).toBeGreaterThan(0);
        expect(aiOffenderComplies(c)).toBe(true);
        expect(aiOffenderComplies({ ...c, demand: 'reparations', amount: a.stateMoney + 1 })).toBe(false);
        setIncident(g, a, b, -500);
        expect(aiOffenderComplies(c)).toBe(strengthRatio(b, a) >= 1.5);
    });

    it('a complying AI offender (recall) cancels its missions and resolves the crisis', () => {
        const [a, , c3] = refusingPair(g);
        const b = c3;
        meet(a, b);
        setIncident(g, a, b, 500); // friendly: complies
        forceCaptures(g, a, b, 3);
        // One more agent still on a mission against B (the recall cancels it).
        const agent = newAgent(g, a);
        const m = newIntelligenceMissionAgainstHabitat(a, agent, MT.SabotageColony, galaxyStarDate(g), b.colonies[0] ?? b.capital!);
        agent.mission = m;
        g.scenario!.params.crisisSeverityThreshold = 1;
        const year = gameYear(galaxyStarDate(g)) + 3;
        reviewEspionage(g, year);
        const c = espionageState(g).crises.find((x) => x.offender === a && x.victim === b)!;
        expect(c).toBeDefined();
        expect(c.response).toBe('complied');
        expect(c.stage).toBe('resolved');
        if (c.demand === 'recall') expect(characterMission(agent)).toBeNull();
        g.scenario!.params.crisisSeverityThreshold = 12;
    });

    it('no crisis opens between empires at war', () => {
        const [a, b] = refusingPair(g);
        const st = espionageState(g);
        st.crises = [];
        st.exposures = [];
        const rel = b.diplomaticRelations.byEmpire(a)!;
        const saved = rel.type;
        rel.type = DiplomaticRelationType.War;
        const agent = newAgent(g, a);
        const m = newIntelligenceMissionAgainstHabitat(a, agent, MT.SabotageColony, 0, b.colonies[0] ?? b.capital!);
        recordExposure(g, a, b, m, agent, 30, O.Capture);
        reviewEspionage(g, gameYear(galaxyStarDate(g)) + 10);
        expect(openCrisis(g, a, b)).toBeNull();
        rel.type = saved;
    });
});

describe('A/§5. player decisions', () => {
    let game: Game;
    let g: Galaxy;
    beforeAll(() => {
        game = freshGame();
        g = game.galaxy;
    }, 600000);

    it('player as victim chooses the demand; player as offender answers it', () => {
        const player = g.playerEmpire!;
        const [a] = aiEmpires(g);
        meet(a, player);
        setIncident(g, a, player, -500);
        forceCaptures(g, a, player, 3);
        const year = gameYear(galaxyStarDate(g));
        reviewEspionage(g, year + 1);
        const c = openCrisis(g, a, player)!;
        expect(c.awaiting).toBe('victim');
        const q = pendingScenarioDecisions(g, player).find((d) => d.kind === 'espionage.response')!;
        expect(q.options.map((o) => o.id)).toEqual(['recall', 'apology', 'reparations', 'sanctions', 'ignore']);
        // Answered directly (answerScenarioDecision) — as the message popup does; not through the player command queue.
        // A cannot pay (stateMoney < 0 ⇒ the reparations demand is unaffordable): the §4.1 rule refuses.
        const money = a.stateMoney;
        a.stateMoney = -1;
        expect(answerScenarioDecision(g, q.id, 'reparations')).toBe(true);
        a.stateMoney = money;
        expect(c.demand).toBe('reparations');
        expect(c.awaiting).toBeNull();
        expect(c.response).toBe('refused');
        reviewEspionage(g, year + 2);
        // The player victim is never auto-escalated: a second decision.
        expect(c.awaiting).toBe('victim');
        const q2 = pendingScenarioDecisions(g, player).find((d) => d.kind === 'espionage.escalate')!;
        expect(q2.options.map((o) => o.id)).toEqual(['sanctions', 'war', 'letgo']);
        answerScenarioDecision(g, q2.id, 'letgo');
        expect(c.stage).toBe('resolved');

        // Player as offender: the AI victim demands; the player recalls its agents.
        const b = aiEmpires(g)[1];
        meet(player, b);
        forceCaptures(g, player, b, 3);
        const agent = newAgent(g, player);
        agent.mission = newIntelligenceMissionAgainstHabitat(player, agent, MT.SabotageColony, galaxyStarDate(g), b.colonies[0] ?? b.capital!);
        reviewEspionage(g, year + 3);
        const c2 = openCrisis(g, player, b)!;
        expect(c2.awaiting).toBe('offender');
        const q3 = pendingScenarioDecisions(g, player).find((d) => d.kind === 'espionage.demand')!;
        expect(q3.options.map((o) => o.id)).toContain('refuse');
        expect(q3.defaultOption).toBe('refuse');
        answerScenarioDecision(g, q3.id, q3.options[0].id);
        if (q3.options[0].id === 'comply') {
            expect(c2.stage).toBe('resolved');
            expect(c2.response).toBe('complied');
            if (c2.demand === 'recall') expect(characterMission(agent)).toBeNull();
        }
    });
});

describe('C. false flags', () => {
    let game: Game;
    let g: Galaxy;
    beforeAll(() => {
        game = freshGame();
        g = game.galaxy;
    }, 600000);

    function withDetection(roll: number, fn: () => void): void {
        const saved = espionageHooks.attribution;
        espionageHooks.attribution = (gx, s, t, m, a, o) => falseFlagAttribution(gx, s, t, m, a, o, { nextDouble: () => roll });
        try {
            fn();
        } finally {
            espionageHooks.attribution = saved;
        }
    }

    it('eligibility: sabotage types against a normal target, framed known to the target, not a party', () => {
        const [a, b, c] = aiEmpires(g);
        meet(a, b);
        meet(b, c);
        meet(a, c);
        const agent = newAgent(g, a);
        const m = newIntelligenceMissionAgainstHabitat(a, agent, MT.SabotageColony, 0, b.colonies[0] ?? b.capital!);
        expect(canFrame(g, m, c)).toBe(true);
        expect(canFrame(g, m, a)).toBe(false);
        expect(canFrame(g, m, b)).toBe(false);
        const spy = newIntelligenceMissionAgainstEmpire(a, agent, MT.StealGalaxyMap, 0, b);
        expect(canFrame(g, spy, c)).toBe(false);
        expect(setMissionFrame(g, m, c)).toBe(true);
        expect(missionFrame(g, m)).toBe(c);
        setMissionFrame(g, m, null);
        expect(missionFrame(g, m)).toBeNull();
    });

    it('AI frame candidates: disliked by both, no treaty, once per 5 years', () => {
        const [a, b, c] = aiEmpires(g);
        meet(a, b);
        meet(b, c);
        meet(a, c);
        setIncident(g, b, c, -500);
        setIncident(g, a, c, -500);
        expect(frameCandidates(g, a, b)).toContain(c);
        const rel = a.diplomaticRelations.byEmpire(c)!;
        const saved = rel.type;
        rel.type = DiplomaticRelationType.FreeTradeAgreement;
        expect(frameCandidates(g, a, b)).not.toContain(c);
        rel.type = saved;
        espionageState(g).lastFramed[c.empireId] = galaxyStarDate(g);
        expect(frameCandidates(g, a, b)).not.toContain(c);
        delete espionageState(g).lastFramed[c.empireId];
        setIncident(g, a, c, 500);
        expect(frameCandidates(g, a, b)).not.toContain(c);
    });

    it('frame holds (detection off): the victim blames the framed empire, not the originator', () => {
        const [a, b, c] = aiEmpires(g);
        meet(a, b);
        meet(b, c);
        meet(a, c);
        setIncident(g, b, a, 0);
        setIncident(g, b, c, 0);
        withDetection(0.999, () => forceCaptures(g, a, b, 1, c));
        expect(rawIncident(b, a)).toBe(0);
        expect(rawIncident(b, c)).toBeLessThan(0);
        const x = espionageState(g).exposures.at(-1)!;
        expect(x.offender).toBe(c);
        expect(x.victim).toBe(b);
        expect(b.recentSpyingEmpires).toContain(c);
    });

    it('frame seen through (detection on): double incident on the originator, the framed empire learns', () => {
        const [a, b, c] = aiEmpires(g);
        setIncident(g, b, a, 0);
        setIncident(g, b, c, 0);
        setIncident(g, c, a, 0);
        withDetection(0, () => forceCaptures(g, a, b, 1, c));
        const x = espionageState(g).exposures.at(-1)!;
        expect(x.offender).toBe(a);
        expect(rawIncident(b, c)).toBe(0);
        expect(rawIncident(b, a)).toBeCloseTo(-2 * (x.incident / 2));
        expect(rawIncident(c, a)).toBe(-20);
    });
});

describe('B. stolen-tech proliferation', () => {
    let game: Game;
    let g: Galaxy;
    beforeAll(() => {
        game = freshGame({ techLeakChance: 1 });
        g = game.galaxy;
    }, 600000);

    it('a StealTechData completion records provenance; a later trade records the new holder; discovery is an exposure', () => {
        const [a, b, c] = aiEmpires(g);
        meet(a, b);
        meet(a, c);
        meet(b, c);
        // A project B has and A lacks (and C lacks).
        // A project B has (researched, not race-restricted); A and C are made to lack it.
        const node = [...b.research.techTree].reverse().find((n) => n.isResearched && b.research.allowedRacesCount(n) === 0 && n.def.projectId > 0)!;
        expect(node).toBeDefined();
        for (const e of [a, c]) {
            const own = e.research.techTree[node.def.projectId];
            own.isResearched = false;
            own.selfResearched = false;
            own.progress = 0;
        }
        const agent = newAgent(g, a);
        const m = newIntelligenceMissionStealTechData(a, agent, 0, b, node);
        a.research.techTree[node.def.projectId].progress = a.research.techTree[node.def.projectId].cost; // the stolen data completes it
        completeIntelligenceMission(g, a, m);
        const s = stolenTechsOf(g, a).find((x) => x.projectId === node.def.projectId)!;
        expect(s).toBeDefined();
        expect(s.victim).toBe(b);
        expect(s.holders).toEqual([a]);
        expect(stolenTechMarker(g, a, node.def.projectId)).toContain(b.name);

        giveTradeableItem(g, a, c, new TradeableItem(TradeableItemType.ResearchProject, a.research.techTree[node.def.projectId], 1), null);
        expect(c.research.techTree[node.def.projectId].isResearched).toBe(true);
        expect(s.holders).toEqual([a, c]);
        expect(espionageState(g).pendingLeaks.some((l) => l.holder === c && l.tech === s)).toBe(true);

        // Discovery forced (roll 0): incidents on holder and thief, an exposure of the thief (severity 10).
        setIncident(g, b, a, 0);
        setIncident(g, b, c, 0);
        const rnd = g.rnd;
        const orig = rnd.nextDouble.bind(rnd);
        rnd.nextDouble = () => 0;
        try {
            reviewEspionage(g, gameYear(galaxyStarDate(g)) + 1);
        } finally {
            rnd.nextDouble = orig;
        }
        expect(rawIncident(b, c)).toBe(-10);
        expect(rawIncident(b, a)).toBe(-15);
        expect(espionageState(g).exposures.some((x) => x.offender === a && x.victim === b && x.weight === 10)).toBe(true);
        expect(espionageState(g).pendingLeaks.length).toBe(0);
        const rows = incidentRows(g, b, a);
        expect(rows.some((r) => r.kind === 'stolen')).toBe(true);
        expect(rows.some((r) => r.kind === 'exposure')).toBe(true);
    });
});

describe('UI builders', () => {
    it('blame options list eligible known empires only for sabotage missions', () => {
        const game = freshGame();
        const g = game.galaxy;
        const player = g.playerEmpire!;
        const [a, b] = aiEmpires(g);
        meet(player, a);
        meet(player, b);
        meet(a, b);
        const opts = blameOptions(g, player, MT.SabotageColony, a);
        expect(opts[0]).toEqual({ empireId: -1, label: '(none)' });
        expect(opts.map((o) => o.empireId)).toContain(b.empireId);
        expect(opts.map((o) => o.empireId)).not.toContain(a.empireId);
        expect(blameOptions(g, player, MT.StealGalaxyMap, a)).toEqual([]);
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
        const ref = cachedTickGameRun(base, { seconds: 600 }); // the modlayer test's cached run
        const { game } = createScenarioGame(base, { scenario: SCENARIO, flags: { espionageConsequences: false } });
        const run = runGameSeconds(game, 600);
        expect(stateDigest(game.galaxy)).toBe(stateDigest(ref.game.galaxy));
        expect(stateCounts(game.galaxy)).toEqual(stateCounts(ref.game.galaxy));
        expect(run.rndDraws).toBe(ref.run.rndDraws);
        expect(game.galaxy.rnd.drawCount).toBe(ref.game.galaxy.rnd.drawCount);
        expect('espionage' in game.galaxy.scenario!.state).toBe(false);
    }, 2400000);

    it('determinism: same seed and flags twice ⇒ same digest and package state', () => {
        const params = { falseFlagAiChance: 1, techLeakChance: 1, crisisSeverityThreshold: 5 };
        const g1 = createScenarioGame(base, { scenario: SCENARIO, params }).game;
        const g2 = createScenarioGame(base, { scenario: SCENARIO, params }).game;
        runGameSeconds(g1, 400);
        runGameSeconds(g2, 400);
        expect(stateDigest(g1.galaxy)).toBe(stateDigest(g2.galaxy));
        const summary = (g: Game) => {
            const st = espionageState(g.galaxy);
            return JSON.stringify({
                crises: st.crises.map((c) => [c.id, c.offender.empireId, c.victim.empireId, c.stage, c.demand, c.severity]),
                exposures: st.exposures.map((x) => [x.offender.empireId, x.victim.empireId, x.weight, x.starDate]),
                stolen: st.stolen.map((s) => [s.projectId, s.thief.empireId, s.holders.map((h) => h.empireId)]),
                frames: st.frames.length,
            });
        };
        expect(summary(g1)).toBe(summary(g2));
    }, 2400000);

    it('save round trip mid-crisis: state survives and the continuation matches', () => {
        const { game, gameData } = createScenarioGame(base, { scenario: SCENARIO });
        const g = game.galaxy;
        const [a, b, c] = refusingPair(g);
        meet(a, b);
        meet(b, c);
        meet(a, c);
        setIncident(g, a, b, -100);
        forceCaptures(g, a, b, 3);
        const agent = newAgent(g, a);
        const m = newIntelligenceMissionAgainstHabitat(a, agent, MT.SabotageColony, galaxyStarDate(g), b.colonies[0] ?? b.capital!);
        agent.mission = m;
        setMissionFrame(g, m, c);
        const year = gameYear(galaxyStarDate(g));
        reviewEspionage(g, year + 1);
        expect(openCrisis(g, a, b)).not.toBeNull();
        const text = saveText(game);
        const loaded = deserializeGame(text, gameData).game;
        const lg = loaded.galaxy;
        const la = lg.empires.find((e) => e.empireId === a.empireId)!;
        const lb = lg.empires.find((e) => e.empireId === b.empireId)!;
        const lc = openCrisis(lg, la, lb)!;
        expect(lc).not.toBeNull();
        expect(lc.stage).toBe('demand');
        const lm = characterMission(getEmpireCharacters(la).find((ch) => ch.name === agent.name && characterMission(ch)?.type === MT.SabotageColony)!)!;
        expect(missionFrame(lg, lm)?.empireId).toBe(c.empireId);
        reviewEspionage(g, year + 2);
        reviewEspionage(lg, year + 2);
        expect(openCrisis(lg, la, lb)!.stage).toBe(openCrisis(g, a, b)!.stage);
        runGameSeconds(game, 60);
        runGameSeconds(loaded, 60);
        expect(stateDigest(lg)).toBe(stateDigest(g));
    }, 2400000);
});
