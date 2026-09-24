import { beforeAll, describe, expect, it } from 'vitest';
import { generateGalaxy, type Galaxy } from '../src/sim/galaxy';
import { setGovernmentsStatic } from '../src/sim/empire';
import { generateEmpire } from '../src/sim/empireGeneration';
import { colonyInfluenceAtPoint, strategicValue } from '../src/sim/territory';
import { GalaxyShape, HabitatCategoryType } from '../src/sim/types';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import type { GameData } from '../src/sim/data/gameData';

// Task C2c-2 — DetermineSystemInfo + EmpireTerritory.
let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
    setGovernmentsStatic(gameData.governments);
}, 60000);
const make = (): Galaxy => generateGalaxy({ seed: 4, shape: GalaxyShape.Spiral, starCount: 300, sectorWidth: 8, sectorHeight: 8, systemNames: Array.from({ length: 300 }, (_, i) => `S${i}`), gameData });

describe('DetermineSystemInfo', () => {
    it('counts planets/moons and has no dominant empire before empires exist', () => {
        const g = make();
        for (const s of g.systems) {
            const hs = g.systemHabitatsOf(s.systemStar.systemIndex);
            expect(s.planetCount).toBe(hs.filter((h) => h.category === HabitatCategoryType.Planet).length);
            expect(s.moonCount).toBe(hs.filter((h) => h.category === HabitatCategoryType.Moon).length);
            expect(s.dominantEmpire).toBeNull();
        }
    });

    it('the owning empire dominates its capital system', () => {
        const g = make();
        const race = gameData.races.find((r) => r.name === 'Human')!;
        const cap = g.habitats.find((h) => h.category === HabitatCategoryType.Planet && h.type === race.nativeHabitatType)!;
        const { empire } = generateEmpire(g, true, 'P', cap, race, -1, 0, 1.0, 'Normal', 0, 0, 1.0);
        g.updateSystemInfo();
        const sys = g.systems[cap.systemIndex];
        expect(sys.dominantEmpire?.empire).toBe(empire);
        expect(sys.dominantEmpire?.totalStrategicValue).toBe(strategicValue(cap));
    });
});

describe('EmpireTerritory', () => {
    it('influence function: r²/d² inside the radius, 0 outside', () => {
        expect(colonyInfluenceAtPoint(100, 0, 0, 50, 0)).toBeCloseTo(4);
        expect(colonyInfluenceAtPoint(100, 0, 0, 150, 0)).toBe(0);
    });

    it('capital territory: owned around the capital (pre-warp radius capped at 100k), unowned far away', () => {
        const g = make();
        const race = gameData.races.find((r) => r.name === 'Human')!;
        const cap = g.habitats.find((h) => h.category === HabitatCategoryType.Planet && h.type === race.nativeHabitatType)!;
        const { empire } = generateEmpire(g, true, 'P', cap, race, -1, 0, 1.0, 'Normal', 0, 0, 1.0);
        g.empireTerritory.reviewEmpireTerritory(g);
        expect(cap.colonyInfluenceRadius).toBeGreaterThan(0);
        expect(cap.colonyInfluenceRadius).toBeLessThanOrEqual(100000);
        expect(g.checkEmpireTerritoryIdAtLocation(cap.xpos, cap.ypos)).toBe(empire.empireId);
        expect(g.checkEmpireTerritoryIdAtLocation(cap.xpos + 500000, cap.ypos)).toBe(-1);
    });
});
