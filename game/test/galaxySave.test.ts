import { beforeAll, describe, expect, it } from 'vitest';
import { generateGalaxy, type Galaxy } from '../src/sim/galaxy';
import type { GameData } from '../src/sim/data/gameData';
import { galaxyFromJSON, galaxyToJSON } from '../src/sim/save/galaxySave';
import { GalaxyShape } from '../src/sim/types';
import { loadGameDataFs } from './helpers/loadGameDataFs';

const systemNames = Array.from({ length: 200 }, (_, i) => `Test System ${i}`);

let gameData: GameData;

beforeAll(async () => {
    gameData = await loadGameDataFs();
});

describe('galaxy save/load (11a1)', () => {
    function roundTrip(galaxy: Galaxy): Galaxy {
        const json = JSON.stringify(galaxyToJSON(galaxy));
        return galaxyFromJSON(JSON.parse(json), gameData);
    }

    it('seed-1 galaxy: JSON round trip is byte-identical', () => {
        const galaxy = generateGalaxy({
            seed: 1,
            shape: GalaxyShape.Spiral,
            starCount: 150,
            sectorWidth: 8,
            sectorHeight: 8,
            systemNames,
            gameData,
        });

        const originalJson = JSON.stringify(galaxyToJSON(galaxy));
        const restored = roundTrip(galaxy);
        const restoredJson = JSON.stringify(galaxyToJSON(restored));

        expect(restoredJson).toBe(originalJson);
    });

    it('seed-1 galaxy: rnd sequence continues identically after restore', () => {
        const galaxy = generateGalaxy({
            seed: 1,
            shape: GalaxyShape.Spiral,
            starCount: 150,
            sectorWidth: 8,
            sectorHeight: 8,
            systemNames,
            gameData,
        });

        const restored = roundTrip(galaxy);

        for (let i = 0; i < 5; i++) {
            expect(restored.rnd.next()).toBe(galaxy.rnd.next());
        }
    });

    it('restored galaxy keeps habitat counts and parent links intact', () => {
        const galaxy = generateGalaxy({
            seed: 1,
            shape: GalaxyShape.Elliptical,
            starCount: 100,
            sectorWidth: 6,
            sectorHeight: 6,
            systemNames,
            gameData,
        });

        const restored = roundTrip(galaxy);

        expect(restored.habitats.length).toBe(galaxy.habitats.length);
        expect(restored.systems.length).toBe(galaxy.systems.length);
        expect(restored.creatures.length).toBe(galaxy.creatures.length);
        expect(restored.galaxyLocations.length).toBe(galaxy.galaxyLocations.length);

        for (let i = 0; i < galaxy.habitats.length; i++) {
            const a = galaxy.habitats[i];
            const b = restored.habitats[i];
            expect(b.name).toBe(a.name);
            expect(b.category).toBe(a.category);
            expect(b.type).toBe(a.type);
            if (a.parent === null) {
                expect(b.parent).toBeNull();
            } else {
                const parentIndex = galaxy.habitats.indexOf(a.parent);
                expect(parentIndex).toBeGreaterThanOrEqual(0);
                expect(b.parent).toBe(restored.habitats[parentIndex]);
            }
        }
    });
});