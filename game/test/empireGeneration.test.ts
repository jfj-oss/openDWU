import { beforeAll, describe, expect, it } from 'vitest';
import { generateGalaxy, type Galaxy } from '../src/sim/galaxy';
import { setGovernmentsStatic } from '../src/sim/empire';
import { setRaceBiasesStatic } from '../src/sim/raceBias';
import { generateEmpire } from '../src/sim/empireGeneration';
import { selectColorFromKey } from '../src/sim/empireColors';
import { SystemVisibilityStatus, countExploredSystems } from '../src/sim/visibility';
import { GalaxyShape, HabitatCategoryType, type Habitat } from '../src/sim/types';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import type { GameData } from '../src/sim/data/gameData';

// Task C2b (M2c) — Galaxy.7.cs GenerateEmpire.
let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
    setGovernmentsStatic(gameData.governments);
    // createGame registers these (game.ts 681); needed since M4d: CheckMarketOrders (GenerateValidTradingPosts →
    // ObtainDiplomaticRelation) gives the second empire a NotMet relation, which ProjectForceStructure then evaluates.
    // The Empire.DoTasks stand-in in generateEmpire reaches ReviewColonyPopulationPolicy (M4j), which reads race biases
    // through ObtainEmpireEvaluation — register them as createGame does.
    setRaceBiasesStatic(gameData.races, gameData.raceBiases, gameData.raceFamilies.length, gameData.raceFamilyBiases);
}, 60000);

function makeGalaxy(): Galaxy {
    return generateGalaxy({ seed: 9, shape: GalaxyShape.Spiral, starCount: 300, sectorWidth: 8, sectorHeight: 8, systemNames: Array.from({ length: 300 }, (_, i) => `S${i}`), gameData });
}
function capitalFor(g: Galaxy, skip = 0): Habitat {
    return g.habitats.filter((h) => h.category === HabitatCategoryType.Planet && h.population.totalAmount === 0)[skip * 25];
}

describe('generateEmpire', () => {
    it('creates an owned, populated capital with home-system quality/diameter', () => {
        const g = makeGalaxy();
        const race = gameData.races.find((r) => r.name === 'Human')!;
        const capital = g.habitats.find((h) => h.category === HabitatCategoryType.Planet && h.type === race.nativeHabitatType && h.population.totalAmount === 0)!;
        const { empire, expansion } = generateEmpire(g, true, 'Player', capital, race, -1, 0, 1.0, 'Normal', 2, 0, 1.0);
        expect(g.empires).toEqual([empire]);
        expect(empire.capital).toBe(capital);
        expect(capital.owner).toBe(empire);
        expect(capital.diameter).toBeGreaterThanOrEqual(290);
        expect(capital.diameter).toBeLessThan(298);
        expect(capital.baseQuality).toBeGreaterThanOrEqual(Math.fround(0.82));
        expect(capital.baseQuality).toBeLessThan(0.89);
        expect(capital.population.totalAmount).toBeGreaterThanOrEqual(1e10);
        expect(expansion).toBeGreaterThanOrEqual(2.3);
        expect(expansion).toBeLessThanOrEqual(2.7);
        expect(empire.visibility.systemVisibility[capital.systemIndex].status).toBe(SystemVisibilityStatus.Visible);
        // SetEmpireExplorationAmount: (int)(expansion * 3.5) systems explored.
        expect(countExploredSystems(empire.visibility.systemVisibility)).toBeGreaterThanOrEqual(Math.trunc(expansion * 3.5));
        // (Capital resources can legitimately be 0: the 4-arg SelectResources
        // drops the race, so minimumResourceCount forces nothing.)
        expect(empire.name).toBe('Player');
        expect(empire.mainColor).toBe(selectColorFromKey(race.defaultPrimaryColor));
    });

    it('age 0: explores nothing beyond the home system; AI empire gets a generated name and a different colour', () => {
        const g = makeGalaxy();
        const human = gameData.races.find((r) => r.name === 'Human')!;
        generateEmpire(g, true, 'Player', capitalFor(g), human, -1, 0, 1.0, 'Normal', 0, 0, 1.0);
        const ai = generateEmpire(g, false, '', capitalFor(g, 1), human, -1, 0, 1.0, 'Harsh', 0, 0, 1.0).empire;
        expect(ai.name.length).toBeGreaterThan(0);
        expect(ai.mainColor).not.toBe(g.empires[0].mainColor);
        expect(countExploredSystems(ai.visibility.systemVisibility)).toBe(1); // only its own (Visible) system
    });

    it('is deterministic', () => {
        const run = () => {
            const g = makeGalaxy();
            const race = gameData.races[5];
            const r = generateEmpire(g, false, '', capitalFor(g), race, -1, 0, 1.4, 'Agreeable', -1, 0, 1.0);
            return JSON.stringify([r.empire.name, r.empire.mainColor, r.expansion, r.empire.capital!.population.totalAmount, g.rnd.next(0, 1 << 30)]);
        };
        expect(run()).toBe(run());
    });
});
