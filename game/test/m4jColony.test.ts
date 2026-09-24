// M4j unit tests: colony growth / happiness / maximum population (colonyTick.ts), treasury helpers (treasury.ts).
// Expected values are hand-worked from the C# (Habitat.cs, BaconHabitat.cs, Empire.10.cs, Galaxy.cs) with C# float
// semantics where the fields are float.
import { describe, expect, it } from 'vitest';
import { Habitat, HabitatCategoryType, HabitatType, recalculateMaximumPopulation } from '../src/sim/types';
import { Population } from '../src/sim/population';
import type { Race } from '../src/sim/data/races';
import type { Galaxy } from '../src/sim/galaxy';
import {
    calculateMigrationFactor,
    calculatePenalColonyValue,
    growPopulation,
    regenerateDamage,
    reviewColonyFillFactor,
    reviewRacePeriodicChanges,
    raceReproductiveRate,
    updateConqueredFactor,
    getPolicyForPopulation,
} from '../src/sim/colonyTick';
import { convertToInt32 } from '../src/sim/developmentLevel';
import { ColonyPopulationPolicy } from '../src/sim/data/policies';

function fakeRace(over: Partial<Race> = {}): Race {
    return {
        name: 'Testian', reproductionRate: 1.1, intelligence: 100, aggression: 100, caution: 100, friendliness: 100, loyalty: 100,
        raceFamily: 0, nativeHabitatType: HabitatType.Ocean, troopStrength: 100, extra: {}, criticalResources: [],
        ...over,
    } as unknown as Race;
}

function fakeGalaxy(over: Record<string, unknown> = {}): Galaxy {
    return { independentEmpire: {}, raceChangePeriodActive: new Set<Race>(), empires: [], starCount: 300, races: [], nowMs: 0, age: 0, playerEmpire: null, ...over } as unknown as Galaxy;
}

function planet(diameter: number, baseQuality: number): Habitat {
    const h = new Habitat(HabitatCategoryType.Planet, HabitatType.Continental, 'P', 0, 0);
    h.diameter = diameter;
    h.baseQuality = Math.fround(baseQuality);
    return h;
}

describe('BaconHabitat.RecalculateMaximumPopulation (via the Diameter / BaseQuality setters)', () => {
    it('diameter² × 250000 × quality², ×1.1 for the native type of the dominant race, min 100', () => {
        const h = planet(100, 0.5);
        // 100*100*250000*(0.5*0.5) = 625,000,000
        expect(h.maxPopulation).toBe(625000000);
        const race = fakeRace({ nativeHabitatType: HabitatType.Continental } as Partial<Race>);
        h.population.add(new Population(race, 5000000));
        recalculateMaximumPopulation(h);
        // (long)(625,000,000 * 1.1) = 687,500,000 (the double product is 687500000.0000001)
        expect(h.maxPopulation).toBe(687500000);
        const tiny = planet(0, 1);
        expect(tiny.maxPopulation).toBe(100);
    });
});

describe('Habitat.GrowPopulation', () => {
    it('grows by (long)(Amount × (GrowthRate − 1) × t/600) below the cap', () => {
        const g = fakeGalaxy();
        const h = planet(100, 1); // max 2,500,000,000
        const p = new Population(fakeRace(), 1000000000);
        p.growthRate = Math.fround(1.1);
        h.population.add(p);
        growPopulation(g, h, 60);
        // (double)1.1f − 1 = 0.10000002384185791; × 0.1 × 1e9 = 10000002.38… → 10000002
        expect(p.amount).toBe(1010000002);
        expect(h.population.totalAmount).toBe(1010000002);
    });

    it('scales every population down to the maximum when over it; plague stops growth', () => {
        const g = fakeGalaxy();
        const h = planet(10, 1); // 25,000,000
        const a = new Population(fakeRace(), 30000000);
        const b = new Population(fakeRace({ name: 'Other' } as Partial<Race>), 20000000);
        h.population.add(a);
        h.population.add(b);
        growPopulation(g, h, 10);
        // factor 25e6/50e6 = 0.5
        expect(a.amount).toBe(15000000);
        expect(b.amount).toBe(10000000);
        h.plagueId = 0;
        a.amount = 1;
        growPopulation(g, h, 10);
        expect(a.amount).toBe(1);
    });

    it('raises small populations to MinimumHabitatPopulationAmount unless Resettle/Exterminate', () => {
        const empireRace = fakeRace({ name: 'Ruler', raceFamily: 1 } as Partial<Race>);
        const empire = { dominantRace: empireRace };
        const g = fakeGalaxy({ independentEmpire: {} });
        const h = planet(100, 1);
        h.empire = empire as never;
        const p = new Population(fakeRace(), 1000);
        p.growthRate = 1;
        h.population.add(p);
        h.colonyPopulationPolicy = ColonyPopulationPolicy.Exterminate;
        expect(getPolicyForPopulation(h, p.race, empireRace)).toBe(ColonyPopulationPolicy.Exterminate);
        growPopulation(g, h, 10);
        expect(p.amount).toBe(1000);
        h.colonyPopulationPolicy = ColonyPopulationPolicy.Assimilate;
        growPopulation(g, h, 10);
        expect(p.amount).toBe(1000000);
    });

    it('independent colonies use GrowthRate = 1f + ((float)ReproductiveRate − 1f) / 3f', () => {
        const indep = {};
        const g = fakeGalaxy({ independentEmpire: indep });
        const h = planet(100, 1);
        h.empire = indep as never;
        const p = new Population(fakeRace({ reproductionRate: 1.3 } as Partial<Race>), 100000000);
        h.population.add(p);
        growPopulation(g, h, 600);
        expect(p.growthRate).toBe(Math.fround(1 + Math.fround(Math.fround(Math.fround(1.3) - 1) / 3)));
        expect(p.amount).toBe(100000000 + Math.trunc(100000000 * (p.growthRate - 1)));
    });
});

describe('Habitat damage / conquest / migration', () => {
    it('RegenerateDamage: 0.02/year × (1 + 3·min(1, pop/1e9)), float Damage, max population recomputed', () => {
        const h = planet(100, 1);
        h.damage = Math.fround(0.5);
        const p = new Population(fakeRace(), 500000000);
        h.population.add(p);
        h.population.recalculateTotalAmount();
        regenerateDamage(fakeGalaxy(), h, 600);
        // num = 0.02 × 1 × 2.5 = 0.05 → Damage = 0.5f − 0.05f
        expect(h.damage).toBe(Math.fround(Math.fround(0.5) - Math.fround(0.05)));
        const q = Math.fround(1 * Math.fround(1 - h.damage));
        expect(h.maxPopulation).toBe(Math.trunc(100 * 100 * 250000.0 * (q * q)));
    });

    it('UpdateConqueredFactor recovers 20/year towards 0', () => {
        const h = planet(10, 1);
        h.conqueredFactor = -10;
        updateConqueredFactor(fakeGalaxy(), h, 60);
        expect(h.conqueredFactor).toBe(-8);
        updateConqueredFactor(fakeGalaxy(), h, 6000);
        expect(h.conqueredFactor).toBe(0);
    });

    it('CalculateMigrationFactor for an unowned populated habitat', () => {
        const h = planet(100, 0.75);
        h.scenicFactor = Math.fround(0.2);
        h.population.add(new Population(fakeRace(), 1000000000));
        h.population.recalculateTotalAmount();
        calculateMigrationFactor(fakeGalaxy(), h);
        const num2 = (3000000000 - 1000000000) / 5000000000.0;
        const num3 = (Math.fround(0.75) - 0.5) / 5.0 + Math.fround(0.2) * 0.5;
        const num4 = Math.fround(0.15 * num2 * 2.0); // TaxRate 0
        expect(h.migrationFactor).toBe(Math.fround(num4 + 0 + num2 + num3));
    });

    it('CalculatePenalColonyValue: distance to the capital × 1000 (Ice) / 100 (Volcanic) / 10 (Desert)', () => {
        const capital = planet(10, 1);
        const ice = new Habitat(HabitatCategoryType.Planet, HabitatType.Ice, 'I', 300, 400);
        const empire = { capital };
        ice.empire = empire as never;
        const g = fakeGalaxy({ calculateDistance: (x1: number, y1: number, x2: number, y2: number) => Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2) });
        expect(calculatePenalColonyValue(g, ice)).toBe(500 * 1000);
        capital.empire = empire as never;
        expect(calculatePenalColonyValue(g, capital)).toBe(0);
    });
});

describe('Galaxy long-block reviews', () => {
    it('ReviewColonyFillFactor = clamp(10 × colonies / min(700, stars), 0.7, 2.5)', () => {
        const g = fakeGalaxy({ empires: [{ colonies: new Array(20) }, { colonies: new Array(10) }], starCount: 300, colonyFillFactor: 1 }) as unknown as { colonyFillFactor: number } & Galaxy;
        reviewColonyFillFactor(g);
        expect(g.colonyFillFactor).toBe(1.0);
        (g as unknown as { empires: unknown[] }).empires = [{ colonies: new Array(2) }];
        reviewColonyFillFactor(g);
        expect(g.colonyFillFactor).toBe(0.7);
    });

    it('ReviewRacePeriodicChanges toggles ChangePeriodActive on the interval / length schedule', () => {
        const race = fakeRace({ extra: { PeriodicChangeInterval: '3', PeriodicChangeLength: '1', PeriodicFactorsGrowth: '1.5' } } as Partial<Race>);
        const g = fakeGalaxy({ races: [race] });
        const at = (years: number) => {
            (g as unknown as { nowMs: number }).nowMs = years * 600000;
            reviewRacePeriodicChanges(g);
            return g.raceChangePeriodActive.has(race);
        };
        expect(at(1)).toBe(false);
        expect(at(3)).toBe(true); // (3 − 3) % 4 == 0
        expect(raceReproductiveRate(g, race)).toBe(1.5);
        expect(at(4)).toBe(false); // 4 % 4 == 0
        expect(raceReproductiveRate(g, race)).toBe(1.1);
        expect(at(7)).toBe(true);
    });
});

describe('System.Convert.ToInt32(double)', () => {
    it('rounds half to even', () => {
        expect(convertToInt32(2.5)).toBe(2);
        expect(convertToInt32(3.5)).toBe(4);
        expect(convertToInt32(-2.5)).toBe(-2);
        expect(convertToInt32(2.4999)).toBe(2);
        expect(() => convertToInt32(3e9)).toThrow();
    });
});
