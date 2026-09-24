import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import type { GameData } from '../src/sim/data/gameData';
import { ComponentType } from '../src/sim/data/components';
import { ComponentCategoryType } from '../src/sim/data/policies';
import { IndustryType } from '../src/sim/types';
import {
    buildComponentStatic,
    evaluateLatestByCategory,
    evaluateLatestByType,
    evaluateNextByCategory,
    resolveComponentCategory,
    resolveIndustry,
    isPlanetDestroyer,
    generateOrderedComponentImprovementList,
    type ComponentStatic,
} from '../src/sim/componentStatic';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 60000);

describe('componentStatic', () => {
    it('resolves category/industry for a few known component types', () => {
        expect(resolveComponentCategory(ComponentType.WeaponBeam)).toBe(ComponentCategoryType.WeaponBeam);
        expect(resolveComponentCategory(ComponentType.WeaponPhaser)).toBe(ComponentCategoryType.WeaponBeam);
        expect(resolveComponentCategory(ComponentType.HyperDrive)).toBe(ComponentCategoryType.HyperDrive);
        expect(resolveIndustry(ComponentCategoryType.WeaponBeam)).toBe(IndustryType.Weapon);
        expect(resolveIndustry(ComponentCategoryType.HyperDrive)).toBe(IndustryType.Energy);
        expect(resolveIndustry(ComponentCategoryType.Sensor)).toBe(IndustryType.HighTech);
    });

    it('does not mutate GameData components', () => {
        const before = gameData.components.map((c) => c.value1);
        buildComponentStatic(gameData);
        const after = gameData.components.map((c) => c.value1);
        expect(after).toEqual(before);
    });

    it('assigns techLevel from research nodes to their referenced components', () => {
        const cs = buildComponentStatic(gameData);
        const node = gameData.research.find((n) => n.components.length > 0);
        expect(node).toBeTruthy();
        for (const componentId of node!.components) {
            const def = cs.byId.get(componentId);
            expect(def).toBeTruthy();
            expect(def!.techLevel).toBe(node!.techLevel);
        }
    });

    it('assigns techLevel to component improvements from their research node', () => {
        const cs = buildComponentStatic(gameData);
        const project = cs.researchProjects.find((p) => p.improvements.length > 0);
        expect(project).toBeTruthy();
        for (const imp of project!.improvements) {
            expect(imp.techLevel).toBe(project!.techLevel);
        }
    });

    it('hyperdrive multiplier scales Value1 of hyperdrive components (int truncation)', () => {
        const csBase = buildComponentStatic(gameData, { hyperDriveSpeedMultiplier: 1.0 });
        const csScaled = buildComponentStatic(gameData, { hyperDriveSpeedMultiplier: 1.5 });
        const baseHd = csBase.definitions.filter((d) => d.category === ComponentCategoryType.HyperDrive);
        const scaledHd = csScaled.definitions.filter((d) => d.category === ComponentCategoryType.HyperDrive);
        expect(baseHd.length).toBeGreaterThan(0);
        for (let i = 0; i < baseHd.length; i++) {
            expect(scaledHd[i].value1).toBe(Math.trunc(baseHd[i].value1 * 1.5));
        }
    });

    it('ordered beam-by-range list is sorted descending by Value2', () => {
        const cs = buildComponentStatic(gameData);
        const list = cs.componentsWeaponBeamOrderedByRange;
        expect(list.length).toBeGreaterThan(1);
        for (let i = 1; i < list.length; i++) {
            expect(list[i - 1].value2).toBeGreaterThanOrEqual(list[i].value2);
        }
        for (const c of list) {
            expect(c.category).toBe(ComponentCategoryType.WeaponBeam);
        }
    });

    it('reactor-by-efficiency list is ascending (double .Reverse() call in C#)', () => {
        const cs = buildComponentStatic(gameData);
        const list = cs.componentsReactorOrderedByEfficiency;
        expect(list.length).toBeGreaterThan(1);
        for (let i = 1; i < list.length; i++) {
            const prevRatio = list[i - 1].value3 / list[i - 1].value2;
            const curRatio = list[i].value3 / list[i].value2;
            expect(curRatio).toBeGreaterThanOrEqual(prevRatio);
        }
    });

    it('reactor-by-power list is descending', () => {
        const cs = buildComponentStatic(gameData);
        const list = cs.componentsReactorOrderedByPower;
        for (let i = 1; i < list.length; i++) {
            expect(list[i - 1].value1).toBeGreaterThanOrEqual(list[i].value1);
        }
    });

    it('hyperdrive-by-jump-initiation list is ascending (orderHighestToLowest: false)', () => {
        const cs = buildComponentStatic(gameData);
        const list = cs.componentsHyperdriveOrderedByJumpInitiation;
        expect(list.length).toBeGreaterThan(1);
        for (let i = 1; i < list.length; i++) {
            expect(list[i].value3).toBeGreaterThanOrEqual(list[i - 1].value3);
        }
    });

    it('EvaluateLatest picks the highest techLevel component <= given level', () => {
        const cs = buildComponentStatic(gameData);
        const byType = cs.definitions.filter((d) => d.type === ComponentType.WeaponBeam).sort((a, b) => a.techLevel - b.techLevel);
        expect(byType.length).toBeGreaterThan(1);
        const target = byType[Math.floor(byType.length / 2)];
        const latest = evaluateLatestByType(cs.definitions, ComponentType.WeaponBeam, target.techLevel);
        expect(latest).toBeTruthy();
        expect(latest!.techLevel).toBeLessThanOrEqual(target.techLevel);
        expect(latest!.techLevel).toBe(
            Math.max(...byType.filter((d) => d.techLevel <= target.techLevel).map((d) => d.techLevel)),
        );

        const latestByCategory = evaluateLatestByCategory(cs.definitions, ComponentCategoryType.WeaponBeam, 1_000_000);
        expect(latestByCategory).toBeTruthy();

        const next = evaluateNextByCategory(cs.definitions, ComponentCategoryType.WeaponBeam, -1);
        expect(next).toBeTruthy();
        expect(next!.techLevel).toBeGreaterThan(-1);
    });

    it('generateOrderedComponentImprovementList wraps ordered components as improvements', () => {
        const cs = buildComponentStatic(gameData);
        const list = generateOrderedComponentImprovementList(cs.definitions, ComponentCategoryType.WeaponTorpedo, 1);
        expect(list.length).toBeGreaterThan(1);
        for (let i = 1; i < list.length; i++) {
            expect(list[i - 1].value1).toBeGreaterThanOrEqual(list[i].value1);
        }
        for (const ci of list) {
            expect(ci.improvedComponent).toBeTruthy();
        }
    });

    it('isPlanetDestroyer flags only super weapons with Value1 >= 10000', () => {
        const cs = buildComponentStatic(gameData);
        const superBeam = cs.definitions.find((d) => d.type === ComponentType.WeaponSuperBeam);
        if (superBeam) {
            const ci = { improvedComponent: superBeam, techLevel: 0, value1: 10000, value2: 0, value3: 0, value4: 0, value5: 0, value6: 0, value7: 0 };
            expect(isPlanetDestroyer(ci)).toBe(true);
            expect(isPlanetDestroyer({ ...ci, value1: 9999 })).toBe(false);
        }
        const beam = cs.definitions.find((d) => d.type === ComponentType.WeaponBeam)!;
        expect(isPlanetDestroyer({ improvedComponent: beam, techLevel: 0, value1: 999999, value2: 0, value3: 0, value4: 0, value5: 0, value6: 0, value7: 0 })).toBe(false);
    });
});
