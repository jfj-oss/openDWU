import { beforeAll, describe, expect, it } from 'vitest';
import { generateGalaxy } from '../src/sim/galaxy';
import { setGovernmentsStatic } from '../src/sim/empire';
import { generateEmpire } from '../src/sim/empireGeneration';
import { ResearchAbilityType, abilityTypeFromFile } from '../src/sim/researchSystem';
import { GalaxyShape, HabitatCategoryType, HabitatType } from '../src/sim/types';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import type { GameData } from '../src/sim/data/gameData';

// Task C2c-3 — tech tree level, abilities, colonisation types, hyperdrive.
let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
    setGovernmentsStatic(gameData.governments);
}, 60000);

function empireAt(techLevel: number) {
    const g = generateGalaxy({ seed: 2, shape: GalaxyShape.Spiral, starCount: 200, sectorWidth: 6, sectorHeight: 6, systemNames: Array.from({ length: 200 }, (_, i) => `S${i}`), gameData });
    const race = gameData.races.find((r) => r.name === 'Human')!;
    const cap = g.habitats.find((h) => h.category === HabitatCategoryType.Planet && h.type === race.nativeHabitatType)!;
    return { g, race, ...generateEmpire(g, true, 'P', cap, race, -1, 0, 1.0, 'Normal', 0, techLevel, 1.0) };
}

describe('research runtime', () => {
    it('ability codes map as in the C# loader', () => {
        expect(abilityTypeFromFile(0)).toBe(ResearchAbilityType.Boarding);
        expect(abilityTypeFromFile(1)).toBe(ResearchAbilityType.ColonizeHabitatType);
        expect(abilityTypeFromFile(5)).toBe(ResearchAbilityType.Troop);
    });

    it('tech level 0: only level-0 nodes researched; no hyperdrive', () => {
        const { empire } = empireAt(0);
        for (const n of empire.research.techTree) {
            if (n.isResearched) expect(n.def.techLevel <= 0 || n.def.specialFunctionCode === 1).toBe(true);
        }
        expect(empire.hasHyperDriveTech).toBe(false);
    });

    it('tech level 2: more research, hyperdrive available, colonisation types from abilities', () => {
        const low = empireAt(0).empire;
        const { empire } = empireAt(2);
        const count = (e: typeof empire) => e.research.techTree.filter((n) => n.isResearched).length;
        expect(count(empire)).toBeGreaterThan(count(low));
        expect(empire.hasHyperDriveTech).toBe(true);
        const colonize = empire.research.abilities.filter((a) => a.type === ResearchAbilityType.ColonizeHabitatType).map((a) => a.value);
        expect(empire.canColonizeContinental).toBe(colonize.includes(1));
        const types = empire.colonizableHabitatTypesForEmpire();
        // The capital (>= 500M pop) adds the race's native type.
        expect(types).toContain(HabitatType.Continental);
    });
});
