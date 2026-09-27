// 19f #6 Time-bomb tech (tasks/19f-hidden-threats.md §6): flag off (no state), forced placement, holder tracking via
// the researchCompleted emit, detonation, abandon (counterplay), and both end conditions. Short, direct-call tests
// (as scenarioDarkFarms.test.ts does): production over years is exercised through the module's own functions rather
// than a long tick soak.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createScenarioGame } from './helpers/scenarioGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Game, CreateGameOptions } from '../src/sim/game';
import type { Galaxy } from '../src/sim/galaxy';
import { runGameSeconds } from '../src/sim/tick/harness';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { gameYear, scenarioEmit } from '../src/sim/scenario/hooks';
import { setGameEndHandler, type GameEndEventArgs } from '../src/sim/victory';
import {
    TIME_BOMB_CODE_CONTAINED,
    TIME_BOMB_CODE_DEFEAT,
    TIME_BOMB_PROJECT_IDS,
    abandonTech,
    detonate,
    peekTimeBombState,
    ruinlessHabitats,
    timeBombState,
    timeBombYearly,
} from '../src/sim/scenario/threats/timeBomb';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

const FORCE = { timeBombStartYear: 0, timeBombChancePerMillePerColony: 1000, timeBombDefeatDestroyed: 2 };
const age3 = (o: CreateGameOptions): CreateGameOptions => ({ ...o, player: { ...o.player, age: 3 }, aiEmpires: o.aiEmpires.map((e) => ({ ...e, age: 3 })) });

function tbGame(flags: Record<string, boolean> = {}): { game: Game; g: Galaxy } {
    const { game } = createScenarioGame(base, { scenario: 'timebomb', flags: { threatTimeBomb: true, ...flags }, params: FORCE, options: age3 });
    return { game, g: game.galaxy };
}

function forceYear(g: Galaxy): void {
    g.scenario!.lastYear = gameYear(galaxyStarDate(g)) - 1;
}

describe('Time-bomb tech: flag off', () => {
    it('no state with the flag off', () => {
        const { game, g } = tbGame({ threatTimeBomb: false });
        runGameSeconds(game, 60);
        expect(peekTimeBombState(g)).toBeNull();
    }, 300000);
});

describe('Time-bomb tech: forced placement, holders, detonation, abandon, ends', () => {
    it('placement: three ruins seeded on ruin-less habitats after the year boundary', () => {
        const { game, g } = tbGame();
        const before = ruinlessHabitats(g).length;
        expect(before).toBeGreaterThan(0);
        forceYear(g);
        runGameSeconds(game, 65);
        const st = timeBombState(g);
        expect(st.placed).toBe(true);
        expect(st.nodes).toEqual([...TIME_BOMB_PROJECT_IDS]);
        expect(g.habitats.filter((h) => h.ruin !== null).length).toBeGreaterThanOrEqual(3);
    }, 300000);

    it('holders: a researchCompleted emit for a time-bomb node records the empire; detonation destroys the colony', () => {
        const { game, g } = tbGame();
        forceYear(g);
        runGameSeconds(game, 65);
        const st = timeBombState(g);
        const empire = g.empires.find((e) => e !== g.independentEmpire && e.pirateEmpireBaseHabitat === null && e.colonies.length > 0)!;
        const node = empire.research.techTree.find((n) => n.def.projectId === st.nodes[0])!;
        node.isResearched = true;
        scenarioEmit(g, 'researchCompleted', { empire, project: node });
        expect(st.holders[empire.empireId]).toContain(st.nodes[0]);

        const colony = empire.colonies[0];
        expect(colony.hasBeenDestroyed).toBe(false);
        detonate(g, st, colony, empire);
        expect(colony.hasBeenDestroyed).toBe(true);
        expect(colony.explosion).not.toBeNull();
        expect(st.destroyed).toContain(colony);
        expect(st.knowledge[empire.empireId]).toBeGreaterThanOrEqual(1);

        // Counterplay: abandoning clears isResearched and the holder entry.
        expect(abandonTech(g, empire)).toBe(true);
        expect(node.isResearched).toBe(false);
        expect(empire.research.techTree.some((n) => n.def.projectId === st.nodes[0] && n.isResearched)).toBe(false);
    }, 600000);

    it('end: enough destroyed planets ends the game in defeat (1916)', () => {
        const { game, g } = tbGame();
        forceYear(g);
        runGameSeconds(game, 65);
        const st = timeBombState(g);
        const ends: GameEndEventArgs[] = [];
        setGameEndHandler(g, (e) => ends.push(e));
        const fakeHabitat = g.habitats[0];
        st.destroyed = [fakeHabitat, fakeHabitat];
        timeBombYearly(g, gameYear(galaxyStarDate(g)));
        expect(ends.map((e) => e.code)).toEqual([TIME_BOMB_CODE_DEFEAT]);
        expect(st.ended).toBe(true);
        setGameEndHandler(g, null);
    }, 300000);

    it('end: no holder left after at least one detonation is contained (2016)', () => {
        const { game, g } = tbGame();
        forceYear(g);
        runGameSeconds(game, 65);
        const st = timeBombState(g);
        const ends: GameEndEventArgs[] = [];
        setGameEndHandler(g, (e) => ends.push(e));
        st.destroyed = [g.habitats[0]];
        st.holders = {};
        timeBombYearly(g, gameYear(galaxyStarDate(g)));
        expect(ends.map((e) => e.code)).toEqual([TIME_BOMB_CODE_CONTAINED]);
        expect(st.ended).toBe(true);
        setGameEndHandler(g, null);
    }, 300000);
});
