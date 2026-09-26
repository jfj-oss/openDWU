// M4j harness smoke test (tasks/M4-plan.md §5.3 layer 6, wave-1 milestone): on the seed-1 createGame galaxy, 600 game-s
// of the real ticks grow the empires' colonies and move money (tax revenue in, maintenance out), with every M4j entry
// point reached and no TODO hit left on the M4j stubs.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame, cachedTickGameRun } from './helpers/gameCache';
import { runGameSeconds } from '../src/sim/tick/harness';
import type { GameData } from '../src/sim/data/gameData';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

describe('M4j on the headless harness', () => {
    it('colonies grow and money flows over 600 game-s', () => {
        const before = cachedTickGame(gameData).galaxy.empires.map((e) => ({
            pop: e.colonies.reduce((n, c) => n + c.population.totalAmount, 0),
            state: e.stateMoney,
            priv: e.privateMoney,
            revenue: e.counters.colonyPrivateRevenueTotal,
        }));
        const { game, run: r } = cachedTickGameRun(gameData, { seconds: 600 }); // createTickGame + runGameSeconds(g, 600), built once and cached (test/helpers/gameCache.ts)
        const g = game.galaxy;
        const m4jHits = Object.keys(r.todoHits).filter((k) => k.startsWith('M4j '));
        expect(m4jHits).toEqual([]);
        g.empires.forEach((e, i) => {
            const pop = e.colonies.reduce((n, c) => n + c.population.totalAmount, 0);
            expect(pop, e.name).toBeGreaterThan(before[i].pop);
            expect(e.totalPopulation).toBeGreaterThan(before[i].pop); // _TotalPopulation: snapshot of the last EvaluateColonyVariables
            expect(e.stateMoney).not.toBe(before[i].state);
            // Private money moves; since M4f DirectPrivateConstruction spends it on new private ships, so it may fall
            // (the private revenue total below still grows).
            expect(e.privateMoney).not.toBe(before[i].priv);
            expect(e.counters.colonyPrivateRevenueTotal).toBeGreaterThan(before[i].revenue);
            expect(Number.isFinite(e.stateMoney) && Number.isFinite(e.privateMoney)).toBe(true);
            for (const c of e.colonies) {
                expect(c.population.totalAmount).toBeLessThanOrEqual(Math.max(c.maxPopulation, before[i].pop));
                for (const p of c.population.items) expect(p.growthRate).toBeGreaterThanOrEqual(1);
                expect(Number.isFinite(c.migrationFactor)).toBe(true);
            }
        });
        // Galaxy long block (every 60 s): colony fill factor = clamp(10 × colonies / min(700, stars)).
        const colonies = g.empires.reduce((n, e) => n + e.colonies.length, 0);
        expect(g.colonyFillFactor).toBe(Math.min(2.5, Math.max(0.7, 10.0 * (colonies / Math.min(700, g.starCount)))));
        // Independent colonies grow at 1 + (ReproductiveRate − 1) / 3 below their maximum.
        const indep = g.habitats.filter((h) => h.empire === g.independentEmpire && h.population.totalAmount > 0);
        expect(indep.length).toBeGreaterThan(0);
        expect(indep.some((h) => h.baconValues !== null && h.baconValues.has('marketcash'))).toBe(true);
    }, 300000);
});
