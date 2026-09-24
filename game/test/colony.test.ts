import { beforeAll, describe, expect, it } from 'vitest';
import { generateGalaxy, type Galaxy } from '../src/sim/galaxy';
import { Empire, setGovernmentsStatic } from '../src/sim/empire';
import { makeHabitatIntoColony, setColonyResources } from '../src/sim/colony';
import { buildResourceSystem } from '../src/sim/resourceSystem';
import { netSort } from '../src/sim/netSort';
import { SystemVisibilityStatus } from '../src/sim/visibility';
import { GalaxyShape, HabitatCategoryType, type Habitat } from '../src/sim/types';
import { Population, PopulationList } from '../src/sim/population';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import type { GameData } from '../src/sim/data/gameData';

// Task C2a (M2b) — colonies: MakeHabitatIntoColony / SetColonyResources /
// TakeOwnershipOfColony, ResourceSystem, .NET sort, PopulationList.Add.
let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
    setGovernmentsStatic(gameData.governments);
}, 60000);

function makeGalaxy(): Galaxy {
    return generateGalaxy({ seed: 5, shape: GalaxyShape.Spiral, starCount: 200, sectorWidth: 6, sectorHeight: 6, systemNames: Array.from({ length: 200 }, (_, i) => `S${i}`), gameData });
}
const planets = (g: Galaxy): Habitat[] => g.habitats.filter((h) => h.category === HabitatCategoryType.Planet && h.population.totalAmount === 0);

describe('netSort (.NET introsort)', () => {
    it('sorts like a normal sort for distinct keys, across all size paths', () => {
        for (const n of [0, 1, 2, 3, 10, 16, 17, 100, 1000]) {
            const a = Array.from({ length: n }, (_, i) => (i * 7919) % 1009);
            const b = a.slice();
            netSort(a, (x, y) => x - y);
            expect(a).toEqual(b.sort((x, y) => x - y));
        }
    });
});

describe('ResourceSystem', () => {
    it('splits groups and orders strategic resources by relative importance (desc)', () => {
        const rs = buildResourceSystem(gameData.resources, gameData.components);
        expect(rs.strategicResources.length).toBeGreaterThan(0);
        expect(rs.luxuryResources.length).toBeGreaterThan(0);
        expect(rs.strategicResources.every((r) => r.type === 0 || r.type === 1)).toBe(true);
        const imps = rs.strategicResourcesOrderedByRelativeImportance.map((r) => rs.relativeImportance.get(r.resourceId)!);
        for (let i = 1; i < imps.length; i++) expect(imps[i - 1]).toBeGreaterThanOrEqual(imps[i]);
        expect(rs.fuelResources.every((r) => r.isFuel)).toBe(true);
    });
});

describe('PopulationList.Add (C# semantics)', () => {
    it('merges same-race populations and leaves TotalAmount alone', () => {
        const race = gameData.races[0];
        const l = new PopulationList();
        expect(l.add(new Population(race, 100))).toBe(0);
        expect(l.add(new Population(race, 50))).toBe(-1);
        expect(l.items.length).toBe(1);
        expect(l.items[0].amount).toBe(150);
        expect(l.totalAmount).toBe(0);
        expect(l.dominantRace).toBe(race);
    });
});

describe('MakeHabitatIntoColony', () => {
    it('takes ownership, populates, stocks cargo and makes the system visible', () => {
        const g = makeGalaxy();
        const race = gameData.races.find((r) => r.name === 'Human') ?? gameData.races[0];
        const [capital, target] = planets(g);
        const empire = new Empire(g, 'Test Empire', capital, race, 0, 1.0, {});
        makeHabitatIntoColony(g, target, empire, 0, race, 1.0, false);
        expect(target.owner).toBe(empire);
        expect(target.empire).toBe(empire);
        expect(empire.colonies).toContain(target);
        expect(target.isRefuellingDepot).toBe(true);
        expect(target.quality).toBeGreaterThanOrEqual(0.5);
        expect(target.population.totalAmount).toBeGreaterThan(0);
        expect(target.population.items[0].race).toBe(race);
        expect(target.developmentLevel).toBeGreaterThanOrEqual(5);
        expect(target.developmentLevel).toBeLessThanOrEqual(50);
        expect(target.cargo!.items.length).toBeGreaterThan(0);
        expect(empire.visibility.systemVisibility[target.systemIndex].status).toBe(SystemVisibilityStatus.Visible);
    });

    it('is deterministic for a seed', () => {
        const run = () => {
            const g = makeGalaxy();
            const race = gameData.races[3];
            const [capital, a, b] = planets(g);
            const e = new Empire(g, 'E', capital, race, 0, 1.0, {});
            makeHabitatIntoColony(g, a, e, 1, race, 1.0, true);
            makeHabitatIntoColony(g, b, e, 0, race, 1.0, false);
            return JSON.stringify([a.population.totalAmount, b.population.totalAmount, a.developmentLevel, a.cargo!.items.map((c) => [c.commodity.resourceId, c.amount]), g.rnd.next(0, 1 << 30)]);
        };
        expect(run()).toBe(run());
    });

    it('SetColonyResources: space port adds non-growth strategic cargo; critical resources get 300-499', () => {
        const g = makeGalaxy();
        const race = gameData.races.find((r) => r.criticalResources.length > 0)!;
        const [capital, h] = planets(g);
        const e = new Empire(g, 'E', capital, race, 0, 1.0, {});
        h.population.add(new Population(race, 1_000_000_000));
        h.population.recalculateTotalAmount();
        h.cargo = null;
        e.takeOwnershipOfColony(h, e);
        const withPort = (setColonyResources(g, h, e, true), h.cargo!.items.length);
        setColonyResources(g, h, e, false);
        expect(withPort).toBeGreaterThan(h.cargo!.items.length);
        expect(setColonyResources(g, h, e, false)).toBe(Math.min(10, 1 + Math.trunc(1_000_000_000 / 250000000)));
    });
});

describe('SetColonizableHabitatsInSystem owner checks', () => {
    it('owned habitats are left alone', () => {
        const g = makeGalaxy();
        const race = gameData.races[0];
        const sys = g.systems.find((s) => g.systemHabitatsOf(s.systemStar.systemIndex).some((h) => h.type === race.nativeHabitatType && h.category === HabitatCategoryType.Planet))!;
        const native = g.systemHabitatsOf(sys.systemStar.systemIndex).find((h) => h.type === race.nativeHabitatType && h.category === HabitatCategoryType.Planet)!;
        const e = new Empire(g, 'E', native, race, 0, 1.0, {});
        e.takeOwnershipOfColony(native, e);
        const type = native.type;
        g.setColonizableHabitatsInSystem(sys.systemStar, race, 0);
        expect(native.type).toBe(type); // not converted to BarrenRock
    });
});
