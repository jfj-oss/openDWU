import { beforeAll, describe, expect, it } from 'vitest';
import { Galaxy, generateGalaxy } from '../src/sim/galaxy';
import type { GameData } from '../src/sim/data/gameData';
import type { Race } from '../src/sim/data/races';
import { Random } from '../src/sim/random';
import { GalaxyShape, HabitatCategoryType, HabitatType, type Habitat } from '../src/sim/types';
import { loadGameDataFs } from './helpers/loadGameDataFs';

// Task 08e1 — home-system colony helpers (Galaxy.8.cs / Galaxy.9.cs).
describe('home-system colony helpers (task 08e1)', () => {
    let gameData: GameData;
    let race: Race;

    beforeAll(async () => {
        gameData = await loadGameDataFs();
        race = gameData.races.find((r) => r.nativeHabitatType === HabitatType.Continental)!;
    });

    function makeGalaxy(): Galaxy {
        return generateGalaxy({
            seed: 11,
            shape: GalaxyShape.Spiral,
            starCount: 120,
            sectorWidth: 5,
            sectorHeight: 5,
            systemNames: Array.from({ length: 200 }, (_, i) => `S${i}`),
            gameData,
        });
    }

    const nonStar = (g: Galaxy, star: Habitat) => g.systems[star.systemIndex].habitats.filter((h) => h !== star);
    const nativeCount = (g: Galaxy, star: Habitat) =>
        nonStar(g, star).filter((h) => h.type === race.nativeHabitatType && h.category !== HabitatCategoryType.Asteroid).length;

    it('resolveHomeSystem table', () => {
        expect(Galaxy.resolveHomeSystem('Harsh')).toEqual({ capitalHabitatType: HabitatType.Desert, homeSystemFactor: 0.4 });
        expect(Galaxy.resolveHomeSystem('Trying')).toEqual({ capitalHabitatType: HabitatType.MarshySwamp, homeSystemFactor: 0.7 });
        expect(Galaxy.resolveHomeSystem('Normal')).toEqual({ capitalHabitatType: HabitatType.MarshySwamp, homeSystemFactor: 1.0 });
        expect(Galaxy.resolveHomeSystem('Agreeable')).toEqual({ capitalHabitatType: HabitatType.Continental, homeSystemFactor: 1.4 });
        expect(Galaxy.resolveHomeSystem('Excellent')).toEqual({ capitalHabitatType: HabitatType.Continental, homeSystemFactor: 2.0 });
        expect(Galaxy.resolveHomeSystem('x')).toEqual({ capitalHabitatType: HabitatType.Undefined, homeSystemFactor: 0.0 });
    });

    it('determineEmpireExpansion', () => {
        expect(Galaxy.determineEmpireExpansion(new Random(1), 1)).toBe(1);
        const e = Galaxy.determineEmpireExpansion(new Random(1), 3);
        expect(e).toBeGreaterThanOrEqual(2.3 * 2.3);
        expect(e).toBeLessThanOrEqual(2.7 * 2.7);
    });

    it('colonyCount 2 ensures >= 2 native-type habitats and keeps lists consistent', () => {
        const g = makeGalaxy();
        for (const sys of g.systems.slice(0, 30)) {
            const star = sys.systemStar;
            g.setColonizableHabitatsInSystem(star, race, 2);
            expect(nativeCount(g, star)).toBeGreaterThanOrEqual(2);
        }
        g.habitats.forEach((h, i) => expect(h.habitatIndex).toBe(i));
        for (const sys of g.systems) for (const h of sys.habitats) expect(g.habitats[h.habitatIndex]).toBe(h);
    });

    it('colonyCount 0 turns unpopulated native-type planets/moons into BarrenRock', () => {
        const g = makeGalaxy();
        for (const sys of g.systems.slice(0, 30)) {
            g.setColonizableHabitatsInSystem(sys.systemStar, race, 0);
            for (const h of nonStar(g, sys.systemStar)) {
                if (h.category !== HabitatCategoryType.Asteroid && h.population.totalAmount <= 0) {
                    expect(h.type).not.toBe(race.nativeHabitatType);
                }
            }
        }
    });

    it('setResourceLevelsInSystem bounds planet/moon resource counts', () => {
        const g = makeGalaxy();
        for (const sys of g.systems.slice(0, 30)) {
            g.setResourceLevelsInSystem(sys.systemStar, 2, 4);
            for (const h of nonStar(g, sys.systemStar)) {
                if (h.category === HabitatCategoryType.Planet || h.category === HabitatCategoryType.Moon) {
                    const n = h.resources.length;
                    expect(n === 0 || n <= 4).toBe(true);
                }
            }
        }
    });

    it('setupHomeSystem is deterministic', () => {
        const run = () => {
            const g = makeGalaxy();
            const star = g.systems[5].systemStar;
            const capital = nonStar(g, star).find((h) => h.category === HabitatCategoryType.Planet) ?? star;
            g.setupHomeSystem(capital, race, 'Excellent', 5, 3);
            return JSON.stringify(nonStar(g, star).map((h) => [h.type, h.diameter, h.resources]));
        };
        expect(run()).toBe(run());
    });
});
