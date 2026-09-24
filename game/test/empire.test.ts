// Tests for src/sim/empire.ts (task M2a): Empire constructors against a
// generated galaxy, plus determinism.

import { beforeAll, describe, expect, it } from 'vitest';
import { generateGalaxy } from '../src/sim/galaxy';
import type { Galaxy, GenerateGalaxyOptions } from '../src/sim/galaxy';
import { HabitatCategoryType, GalaxyShape } from '../src/sim/types';
import type { Habitat } from '../src/sim/types';
import { Empire, setGovernmentsStatic } from '../src/sim/empire';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import type { GameData } from '../src/sim/data/gameData';

const SEED = 12345;
const START_RACES = ['Boskara', 'Mortalen', 'Sluken', 'Naxxilian', 'Dhayut'];

let gameData: GameData;

function makeEmpireStarts() {
    return START_RACES.map((name) => ({
        resolvedRace: gameData.races.find((r) => r.name === name)!,
        projectedColonyAmount: 5,
    }));
}

function generationOptions(): GenerateGalaxyOptions {
    const systemNames: string[] = [];
    for (let i = 0; i < 200; i++) {
        systemNames.push(`System ${i}`);
    }
    return {
        seed: SEED,
        shape: GalaxyShape.Spiral,
        starCount: 700,
        sectorWidth: 10,
        sectorHeight: 10,
        systemNames,
        gameData,
        aggressionLevel: 1.5,
        empireStarts: makeEmpireStarts(),
    };
}

beforeAll(async () => {
    gameData = await loadGameDataFs();
    setGovernmentsStatic(gameData.governments);
}, 60000);

// First habitat with a non-star category and population > 0, used as capital.
function pickCapital(galaxy: Galaxy): Habitat {
    for (const h of galaxy.habitats) {
        if ((h.category === HabitatCategoryType.Planet || h.category === HabitatCategoryType.Asteroid) && h.population.totalAmount > 0) {
            return h;
        }
    }
    throw new Error('No populated planet/asteroid found in generated galaxy');
}

describe('Empire (M2a)', () => {
    it('constructs an empire with race + capital from a generated galaxy', () => {
        const galaxy = generateGalaxy(generationOptions());
        const capital = pickCapital(galaxy);
        const popItem = capital.population.items[0];
        const race = popItem?.race ?? null;

        const empire = new Empire(galaxy, 'Test Empire', capital, race, 0, 1.0, {});

        expect(empire.name).toBe('Test Empire');
        expect(empire.capital).toBe(capital);
        expect(empire.homeWorld).toBe(capital);
        expect(empire.dominantRace).toBe(race);
        expect(empire.active).toBe(true);
        expect(empire.stateMoney).toBe(30000.0);
        expect(empire.privateMoney).toBe(100000.0);
        // latestDesigns sized to BuiltObjectSubRole count (28).
        expect(empire.latestDesigns.length).toBe(28);
        // one SystemVisibility entry per system.
        expect(empire.systemVisibility.length).toBe(galaxy.systems.length);
        // government id stored by changeGovernment stub.
        expect(empire.governmentId).toBe(0);
        // capital development level set to 10.
        expect(capital.developmentLevel).toBe(10);
        // capital cargo re-titled to this empire (if any existed).
        if (capital.cargo !== null) {
            for (const item of capital.cargo.items) {
                expect(item.empire).toBe(empire);
            }
        }
    }, 60000);

    it('generates a name when given an empty name', () => {
        const galaxy = generateGalaxy(generationOptions());
        const capital = pickCapital(galaxy);
        const race = capital.population.items[0]?.race ?? null;

        const empire = new Empire(galaxy, '', capital, race, 0, 1.0, {});

        expect(empire.name.length).toBeGreaterThan(0);
    }, 60000);

    it('independent-empire constructor works', () => {
        const galaxy = generateGalaxy(generationOptions());
        const homeHabitat = pickCapital(galaxy);
        const race = homeHabitat.population.items[0]?.race ?? null;

        const empire = new Empire(galaxy, 'Independent', true, homeHabitat, race, {});

        expect(empire.name).toBe('Independent');
        expect(empire.active).toBe(true);
        expect(empire.stateMoney).toBe(30000.0);
        expect(empire.privateMoney).toBe(100000.0);
    }, 60000);

    it('is deterministic across two generations with the same seed', () => {
        const galaxyA = generateGalaxy(generationOptions());
        const galaxyB = generateGalaxy(generationOptions());

        const capitalA = pickCapital(galaxyA);
        const capitalB = pickCapital(galaxyB);
        const raceA = capitalA.population.items[0]?.race ?? null;
        const raceB = capitalB.population.items[0]?.race ?? null;

        const empireA = new Empire(galaxyA, 'Det Empire', capitalA, raceA, 0, 1.0, {});
        const empireB = new Empire(galaxyB, 'Det Empire', capitalB, raceB, 0, 1.0, {});

        const sig = (e: Empire) =>
            [
                e.name,
                e.empireId,
                e.governmentId,
                e.mainColor,
                e.secondaryColor,
                e.flagShape,
                e.stateMoney,
                e.privateMoney,
                e.designNamesIndex,
                e.troopDescription,
                e.troopPictureRef,
                e.latestDesigns.length,
                e.systemVisibility.length,
            ].join('|');

        expect(sig(empireA)).toEqual(sig(empireB));
    }, 120000);
});