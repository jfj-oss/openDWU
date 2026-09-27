// 19f #8 The Exchange (tasks/19f-hidden-threats.md §8): flag off, forced placement, funding + sabotage advancing,
// discovery via the intelMissionCompleted emit, and collapse (blockade). Short, direct-call tests.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createScenarioGame } from './helpers/scenarioGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Game, CreateGameOptions } from '../src/sim/game';
import type { Galaxy } from '../src/sim/galaxy';
import { runGameSeconds } from '../src/sim/tick/harness';
import { gameYear } from '../src/sim/scenario/hooks';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { setGameEndHandler, type GameEndEventArgs } from '../src/sim/victory';
import { declareWar } from '../src/sim/diplomacyTick';
import { builtObjectCompleteTeardown } from '../src/sim/combat/teardown';
import {
    EXCHANGE_CODE_CONTAINED,
    exchangeKnownSites,
    exchangeState,
    exchangeYearly,
    peekExchangeState,
} from '../src/sim/scenario/threats/exchange';
import { KNOWLEDGE_SUSPECTED, knowledgeLevel } from '../src/sim/scenario/threats/framework';
import { scenarioEmit } from '../src/sim/scenario/hooks';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

const age3 = (o: CreateGameOptions): CreateGameOptions => ({ ...o, player: { ...o.player, age: 3 }, aiEmpires: o.aiEmpires.map((e) => ({ ...e, age: 3 })) });

function exGame(flags: Record<string, boolean> = {}): { game: Game; g: Galaxy } {
    const { game } = createScenarioGame(base, { scenario: 'exchange', flags: { threatExchange: true, ...flags }, params: { exchangeYear: 0, exchangeExistChancePct: 100, exchangeMinYear: 0 }, options: age3 });
    return { game, g: game.galaxy };
}

function forceYear(g: Galaxy): void {
    g.scenario!.lastYear = gameYear(galaxyStarDate(g)) - 1;
}

describe('The Exchange: flag off', () => {
    it('no state with the flag off', () => {
        const { game, g } = exGame({ threatExchange: false });
        runGameSeconds(game, 65);
        expect(peekExchangeState(g)).toBeNull();
    }, 300000);
});

describe('The Exchange: forced placement, funding + sabotage, discovery, collapse', () => {
    it('placement: an independent large space port near the galaxy centre', () => {
        const { game, g } = exGame();
        forceYear(g);
        runGameSeconds(game, 65);
        const st = exchangeState(g);
        expect(st.placed).toBe(true);
        expect(st.station).not.toBeNull();
        expect(st.station!.bo.actualEmpire).toBe(g.independentEmpire);
    }, 300000);

    it('funding + sabotage: the weaker side of a war is funded and the stronger side is sabotaged with a false-flag message', () => {
        const { game, g } = exGame();
        forceYear(g);
        runGameSeconds(game, 65);
        const st = exchangeState(g);
        const [a, b] = g.empires.filter((e) => e !== g.independentEmpire && e.pirateEmpireBaseHabitat === null && e.colonies.length > 0);
        declareWar(g, a, b);
        const weaker = a.stateMoney <= b.stateMoney ? a : b;
        const before = weaker.stateMoney;
        const beforeMsgs = st.sabotageLog.length;
        exchangeYearly(g, gameYear(galaxyStarDate(g)) + 1);
        expect(weaker.stateMoney).toBeGreaterThan(before);
        expect(st.fundedTotal).toBeGreaterThan(0);
        expect(st.sabotageLog.length).toBeGreaterThan(beforeMsgs);
    }, 300000);

    it('discovery: an intel mission against a funded empire traces the money (level 2, then confirmed at 2)', () => {
        const { game, g } = exGame();
        forceYear(g);
        runGameSeconds(game, 65);
        const st = exchangeState(g);
        const [a, b] = g.empires.filter((e) => e !== g.independentEmpire && e.pirateEmpireBaseHabitat === null && e.colonies.length > 0);
        declareWar(g, a, b);
        exchangeYearly(g, gameYear(galaxyStarDate(g)) + 1); // establishes a funded (weaker) empire
        const weaker = a.stateMoney <= b.stateMoney ? a : b;
        const spy = weaker === a ? b : a;
        scenarioEmit(g, 'intelMissionCompleted', { empire: spy, mission: { targetEmpire: weaker }, outcome: null });
        expect(knowledgeLevel(st.station!, spy)).toBeGreaterThanOrEqual(KNOWLEDGE_SUSPECTED);
        expect(exchangeKnownSites(g, spy).some((s) => s.target === st.station!.bo)).toBe(true);
        scenarioEmit(g, 'intelMissionCompleted', { empire: spy, mission: { targetEmpire: weaker }, outcome: null });
        expect(knowledgeLevel(st.station!, spy)).toBe(3);
    }, 300000);

    it('collapse: destroying the station ends the game in containment (2018)', () => {
        const { game, g } = exGame();
        forceYear(g);
        runGameSeconds(game, 65);
        const st = exchangeState(g);
        const ends: GameEndEventArgs[] = [];
        setGameEndHandler(g, (e) => ends.push(e));
        builtObjectCompleteTeardown(g, st.station!.bo);
        exchangeYearly(g, gameYear(galaxyStarDate(g)) + 1);
        expect(st.ended).toBe(true);
        expect(ends.map((e) => e.code)).toEqual([EXCHANGE_CODE_CONTAINED]);
        setGameEndHandler(g, null);
    }, 300000);
});
