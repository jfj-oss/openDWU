import { beforeAll, describe, expect, it } from 'vitest';
import { generateGalaxy, type Galaxy } from '../src/sim/galaxy';
import { Empire, setGovernmentsStatic } from '../src/sim/empire';
import { makeHabitatIntoColony } from '../src/sim/colony';
import { GalaxyShape, HabitatCategoryType, type Habitat } from '../src/sim/types';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import type { GameData } from '../src/sim/data/gameData';

// Parity batch D4: targeted tests for the remaining sim gaps (docs/parity/*.md).
let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
    setGovernmentsStatic(gameData.governments);
}, 60000);

function makeGalaxy(): Galaxy {
    return generateGalaxy({ seed: 5, shape: GalaxyShape.Spiral, starCount: 200, sectorWidth: 6, sectorHeight: 6, systemNames: Array.from({ length: 200 }, (_, i) => `S${i}`), gameData });
}
const emptyPlanets = (g: Galaxy): Habitat[] => g.habitats.filter((h) => h.category === HabitatCategoryType.Planet && h.population.totalAmount === 0);

describe('GrowPopulation(TimeSpan.Zero) at colony creation (Galaxy.8.cs 674)', () => {
    it('clamps an aged starting population to MaximumPopulation', () => {
        const g = makeGalaxy();
        const race = gameData.races.find((r) => r.name === 'Human') ?? gameData.races[0];
        const planets = emptyPlanets(g);
        const capital = planets[0];
        // The smallest planet: an age-6 population (300M..700M x quality x 1.7^6) is far above its maximum.
        const target = planets.slice(1).reduce((a, b) => (b.maxPopulation < a.maxPopulation ? b : a));
        const empire = new Empire(g, 'Test Empire', capital, race, 0, 1.0, null);
        makeHabitatIntoColony(g, target, empire, 6, race, 1.0, false);
        expect(target.population.totalAmount).toBeGreaterThan(0);
        expect(target.population.totalAmount).toBeLessThanOrEqual(target.maxPopulation);
        let sum = 0;
        for (const p of target.population.items) sum += p.amount;
        expect(sum).toBe(target.population.totalAmount);
    });
});
