import { beforeAll, describe, expect, it } from 'vitest';
import { generateGalaxy, type Galaxy } from '../src/sim/galaxy';
import type { GameData } from '../src/sim/data/gameData';
import type { Race } from '../src/sim/data/races';
import { Random } from '../src/sim/random';
import { GalaxyShape, HabitatCategoryType, type Habitat } from '../src/sim/types';
import { loadGameDataFs } from './helpers/loadGameDataFs';

// Task 08c — Galaxy.4.cs SelectResources dominant-race critical resources.
describe('selectResources dominant-race critical resources (task 08c)', () => {
    let gameData: GameData;
    let galaxy: Galaxy;
    let planet: Habitat;
    let validId: number;

    beforeAll(async () => {
        gameData = await loadGameDataFs();
        galaxy = generateGalaxy({
            seed: 3,
            shape: GalaxyShape.Spiral,
            starCount: 100,
            sectorWidth: 5,
            sectorHeight: 5,
            systemNames: Array.from({ length: 200 }, (_, i) => `S${i}`),
            gameData,
        });
        planet = galaxy.habitats.find((h) => h.category === HabitatCategoryType.Planet && h.diameter >= 85)!;
        const valid = (galaxy as unknown as { resolveValidResourcesForHabitatExcludeManufactured(h: Habitat): number[] })
            .resolveValidResourcesForHabitatExcludeManufactured(planet);
        expect(valid.length).toBeGreaterThan(0);
        validId = valid[0];
    });

    function raceWith(resourceId: number): Race {
        return { ...gameData.races[0], criticalResources: [{ resourceId, effect: 1, value: 5, appliesOnlyToSources: false }] };
    }

    function run(race: Race | null, minCount: number, minCrit: number): { h: Habitat; next: number } {
        galaxy.rnd = new Random(99);
        (galaxy as unknown as { cryptoRnd: Random }).cryptoRnd = new Random(7);
        const h: Habitat = Object.assign(Object.create(Object.getPrototypeOf(planet)), planet, { resources: [] });
        galaxy.selectResources(h, minCount, race, minCrit);
        return { h, next: galaxy.rnd.next(0, 1_000_000) };
    }

    it('every parsed race has 0-3 critical resources with a defined effect', () => {
        for (const race of gameData.races) {
            expect(race.criticalResources.length).toBeLessThanOrEqual(3);
            for (const b of race.criticalResources) {
                expect(b.effect).toBeGreaterThanOrEqual(1);
                expect(b.effect).toBeLessThanOrEqual(11);
            }
        }
        expect(gameData.races.some((r) => r.criticalResources.length > 0)).toBe(true);
    });

    it('adds a valid critical resource first with abundance in [200, 800)', () => {
        const { h } = run(raceWith(validId), 2, 1);
        expect(h.resources[0].resourceId).toBe(validId);
        expect(h.resources[0].abundance).toBeGreaterThanOrEqual(200);
        expect(h.resources[0].abundance).toBeLessThan(800);
    });

    it('no race, or minimumResourceCount 0, consumes no extra Rnd', () => {
        const base = run(null, 2, 1);
        expect(run(raceWith(validId), 0, 1).next).toBe(run(null, 0, 1).next);
        // minimumCriticalResourceCount 0 → loop adds nothing → no Rnd.
        expect(run(raceWith(validId), 2, 0).next).toBe(base.next);
        // With a match, exactly one extra Rnd.Next(200, 800) is drawn.
        expect(run(raceWith(validId), 2, 1).next).not.toBe(base.next);
    });

    it('invalid resource for the habitat is skipped without an Rnd draw', () => {
        expect(run(raceWith(254), 2, 1).next).toBe(run(null, 2, 1).next);
    });
});
