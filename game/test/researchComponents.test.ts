import { beforeAll, describe, expect, it } from 'vitest';
import { setGovernmentsStatic } from '../src/sim/empire';
import { ResearchSystem, ShipDesignFocus, buildResearchStatic, loadEmpirePolicy } from '../src/sim/researchSystem';
import { buildComponentStatic } from '../src/sim/componentStatic';
import { ComponentCategoryType } from '../src/sim/data/policies';
import { ComponentType } from '../src/sim/data/components';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import type { GameData } from '../src/sim/data/gameData';
import { Random } from '../src/sim/random';

// DetermineResearchedComponents / DetermineComponentImprovements /
// DetermineLatest*ComponentsBy* / DetermineBest*ComponentsBy* / ReviewOrderedComponents /
// EvaluateDesiredComponent(Improvement) (ResearchSystem.cs Update, 68, and the
// Evaluate*/Identify* helpers, 2285-2781).
let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
    setGovernmentsStatic(gameData.governments);
}, 60000);

const human = () => gameData.races.find((r) => r.name === 'Human')!;

function makeSystem(techLevel: number | null) {
    const componentStatic = buildComponentStatic(gameData);
    const stat = buildResearchStatic(gameData.research, gameData.components, gameData.races, gameData.policies, gameData.piratePolicies, componentStatic);
    const rs = new ResearchSystem(stat);
    rs.obtainTechTree();
    if (techLevel === null) {
        const policy = loadEmpirePolicy(stat, human(), false);
        rs.setTechTreeStartingDefaults(human(), policy);
    } else {
        rs.setTechTreeLevel(new Random(1), human(), techLevel, false);
    }
    rs.update();
    return { rs, componentStatic };
}

describe('ResearchSystem component tracking', () => {
    it('researchedComponents/state agree at starting defaults (tech 0.5)', () => {
        const { rs } = makeSystem(null);
        for (const c of rs.researchedComponents) {
            expect(rs.checkComponentResearched(c)).toBe(true);
        }
        // Anything not in researchedComponents must read as unresearched.
        const researchedIds = new Set(rs.researchedComponents.map((c) => c.componentId));
        const unresearched = gameData.components.find((c) => !researchedIds.has(c.componentId));
        if (unresearched) expect(rs.checkComponentResearched(unresearched)).toBe(false);
    });

    it('researchedComponents/state agree at tech level 3', () => {
        const { rs } = makeSystem(3);
        for (const c of rs.researchedComponents) {
            expect(rs.checkComponentResearched(c)).toBe(true);
        }
        expect(rs.researchedComponents.length).toBeGreaterThan(0);
        // Every researched component must come from a researched node.
        for (const c of rs.researchedComponents) {
            const owningNode = rs.techTree.find((n) => n.def.components.includes(c.componentId));
            expect(owningNode?.isResearched).toBe(true);
        }
    });

    it('component improvements pick the highest tech level among researched projects', () => {
        const { rs } = makeSystem(3);
        for (const [componentId, entry] of rs.componentImprovements) {
            // No other researched project targeting this component may have a higher tech level.
            for (const n of rs.techTree) {
                if (!n.isResearched) continue;
                for (const ci of n.def.componentImprovements) {
                    if (ci.componentId === componentId) {
                        expect(entry.techLevel).toBeGreaterThanOrEqual(n.def.techLevel);
                    }
                }
            }
            const def = rs.researchedComponents.find((c) => c.componentId === componentId);
            expect(def).toBeDefined();
            expect(rs.resolveImprovedComponentValues(def!)).toEqual(entry);
        }
    });

    it('resolveImprovedComponentValues falls back to the component itself when no improvement was researched', () => {
        const { rs } = makeSystem(3);
        const withoutImprovement = rs.researchedComponents.find((c) => !rs.componentImprovements.has(c.componentId));
        if (withoutImprovement) {
            const resolved = rs.resolveImprovedComponentValues(withoutImprovement);
            expect(resolved.improvedComponent).toBe(withoutImprovement);
            expect(resolved.value1).toBe(withoutImprovement.value1);
        }
    });

    it('evaluateDesiredComponent(Reactor, Balanced) returns a researched reactor', () => {
        const { rs } = makeSystem(3);
        const reactor = rs.evaluateDesiredComponent(ComponentType.Reactor, ShipDesignFocus.Balanced);
        expect(reactor).not.toBeNull();
        expect(reactor!.type).toBe(ComponentType.Reactor);
        expect(rs.checkComponentResearched(reactor!)).toBe(true);
    });

    it('evaluateDesiredComponent respects design focus (SpeedAgility prefers ordered-by-range list head)', () => {
        const { rs } = makeSystem(3);
        const balanced = rs.evaluateDesiredComponent(ComponentType.WeaponBeam, ShipDesignFocus.Balanced);
        const speed = rs.evaluateDesiredComponent(ComponentType.WeaponBeam, ShipDesignFocus.SpeedAgility);
        if (rs.componentsWeaponBeamOrderedByRange.length > 0) {
            expect(speed).toBe(rs.componentsWeaponBeamOrderedByRange[0].improvedComponent);
        }
        expect(balanced).not.toBeUndefined();
    });

    it('category variants: evaluateDesiredComponentByCategory(Reactor) matches type variant', () => {
        const { rs } = makeSystem(3);
        const byType = rs.evaluateDesiredComponent(ComponentType.Reactor, ShipDesignFocus.Balanced);
        const byCategory = rs.evaluateDesiredComponentByCategory(ComponentCategoryType.Reactor, ShipDesignFocus.Balanced);
        expect(byCategory).toBe(byType);
        const improvement = rs.evaluateDesiredComponentImprovementByCategory(ComponentCategoryType.Reactor, ShipDesignFocus.Balanced);
        expect(improvement).not.toBeNull();
        expect(improvement!.improvedComponent).toBe(byCategory);
    });

    it('unresearched component types return null from evaluateDesiredComponent', () => {
        const { rs } = makeSystem(null); // starting defaults: no high-tech researched
        const superBeam = rs.evaluateDesiredComponent(ComponentType.WeaponSuperBeam, ShipDesignFocus.Balanced);
        expect(superBeam).toBeNull();
        const improvement = rs.evaluateDesiredComponentImprovement(ComponentType.WeaponSuperBeam, ShipDesignFocus.Balanced);
        expect(improvement).toBeNull();
    });

    it('latest-by-category excludes WeaponBombard from taking the WeaponTorpedo category slot', () => {
        const { rs } = makeSystem(3);
        const latestTorpedoCategory = rs.getLatestComponent(ComponentCategoryType.WeaponTorpedo, true);
        if (latestTorpedoCategory) {
            expect(latestTorpedoCategory.type).not.toBe(ComponentType.WeaponBombard);
        }
    });

    it('Shields latest-by-category tie-breaks on Value1 when tech levels match', () => {
        const { rs } = makeSystem(3);
        const shieldComponents = rs.researchedComponents.filter((c) => c.category === ComponentCategoryType.Shields);
        const latest = rs.getLatestComponent(ComponentCategoryType.Shields, true);
        if (shieldComponents.length > 1 && latest) {
            const maxTechLevel = Math.max(...shieldComponents.map((c) => rs.resolveImprovedComponentValues(c).techLevel));
            const tiedAtMax = shieldComponents.filter((c) => rs.resolveImprovedComponentValues(c).techLevel === maxTechLevel);
            if (tiedAtMax.length > 1) {
                const maxValue1 = Math.max(...tiedAtMax.map((c) => rs.resolveImprovedComponentValues(c).value1));
                expect(rs.resolveImprovedComponentValues(latest).value1).toBe(maxValue1);
            }
        }
    });

    it('ReviewOrderedComponents ordered lists only contain researched components', () => {
        const { rs } = makeSystem(3);
        const researchedIds = new Set(rs.researchedComponents.map((c) => c.componentId));
        for (const entry of rs.componentsWeaponBeamOrderedByPower) {
            expect(researchedIds.has(entry.improvedComponent.componentId)).toBe(true);
        }
        for (const entry of rs.componentsReactorOrderedByPower) {
            expect(researchedIds.has(entry.improvedComponent.componentId)).toBe(true);
        }
    });

    it('hasHyperDrive still works with ComponentDefinition[] researchedComponents', () => {
        const { rs } = makeSystem(null);
        expect(rs.hasHyperDrive()).toBe(true);
    });

    it('works without ComponentStatic (falls back to synthesized definitions)', () => {
        const stat = buildResearchStatic(gameData.research, gameData.components, gameData.races, gameData.policies, gameData.piratePolicies);
        const rs = new ResearchSystem(stat);
        rs.obtainTechTree();
        const policy = loadEmpirePolicy(stat, human(), false);
        rs.setTechTreeStartingDefaults(human(), policy);
        rs.update();
        expect(rs.hasHyperDrive()).toBe(true);
        expect(rs.researchedComponents.length).toBeGreaterThan(0);
        expect(rs.checkComponentResearched(rs.researchedComponents[0])).toBe(true);
    });
});
