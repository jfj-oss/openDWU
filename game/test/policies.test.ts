import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    parseEmpirePolicy,
    defaultEmpirePolicy,
    resolveTechFocuses,
    ComponentCategoryType,
    ColonyPopulationPolicy,
} from '../src/sim/data/policies';

const dwuRoot = resolve(__dirname, '../public/assets/dwu');
function readDwu(relPath: string): string {
    return readFileSync(resolve(dwuRoot, relPath), 'utf-8');
}

describe('policies.ts', () => {
    describe('defaultEmpirePolicy', () => {
        it('matches EmpirePolicy.cs field initialisers', () => {
            const p = defaultEmpirePolicy();

            // Booleans defaulting true via ctor initialisers.
            expect(p.designUpgradeEscort).toBe(true);
            expect(p.designUpgradeFrigate).toBe(true);
            expect(p.designUpgradeMiningStation).toBe(true);
            expect(p.buildPlanetDestroyers).toBe(false);

            // No initialiser -> C# default(bool)/default(int) = false/0.
            expect(p.colonyActionForNewTroopRecruitment).toBe(false);
            expect(p.protectLeaderAtAllCosts).toBe(false);
            expect(p.captureEnlistMilitaryShip).toBe(0);

            expect(p.defaultMilitaryFleeWhen).toBe(4); // BuiltObjectFleeWhen.Shields20
            expect(p.researchDesignOverallFocus).toBe(0); // ShipDesignFocus.Balanced
            expect(p.prioritizeBuildWonderId).toBe(-1);
            expect(p.homeworldDefensePriority).toBe(1.0);
            expect(p.newColonyPopulationPolicyAllRaces).toBe(ColonyPopulationPolicy.Assimilate);

            // Existing researchDesignTechFocus behaviour must be unchanged.
            expect(p.researchDesignTechFocus).toHaveLength(6);
            expect(p.researchDesignTechFocus[0]).toEqual({ category: ComponentCategoryType.Undefined, type: 0 });
        });
    });

    describe('parseEmpirePolicy', () => {
        const text = readDwu('Policy/Human.txt');
        const policy = parseEmpirePolicy(text);

        it('parses booleans, ints and floats from a real policy file', () => {
            expect(policy.colonyActionForNewTroopRecruitment).toBe(false); // "N"
            expect(policy.colonyAllowFacilityCloningFacility).toBe(true); // "Y"
            expect(policy.colonyFacilityPopulationThresholdCloningFacility).toBe(500);
        });

        it('sets DesignUpgrade*, BuildPlanetDestroyers and DefaultMilitaryFleeWhen from the file', () => {
            expect(typeof policy.designUpgradeEscort).toBe('boolean');
            expect(typeof policy.buildPlanetDestroyers).toBe('boolean');
            expect(typeof policy.defaultMilitaryFleeWhen).toBe('number');
        });

        it('keeps researchDesignTechFocus parsing and resolveTechFocuses working', () => {
            const { categories, types } = resolveTechFocuses(policy);
            expect(Array.isArray(categories)).toBe(true);
            expect(Array.isArray(types)).toBe(true);
        });
    });

    describe('clamped priority fields', () => {
        it('clamps to [0.5, 4.0] like C# Math.Max(0.5, Math.Min(4.0, value))', () => {
            const low = parseEmpirePolicy('ResearchPriority\t\t;0.1');
            expect(low.researchPriority).toBe(0.5);

            const high = parseEmpirePolicy('ResearchPriority\t\t;10');
            expect(high.researchPriority).toBe(4.0);

            const mid = parseEmpirePolicy('ResearchPriority\t\t;2.5');
            expect(mid.researchPriority).toBe(2.5);
        });
    });

    describe('junk values fall back like C#', () => {
        it('bool: anything but "y"/"n" (case-insensitive) is false', () => {
            const p = parseEmpirePolicy('BuildPlanetDestroyers\t\t;maybe');
            expect(p.buildPlanetDestroyers).toBe(false);

            const py = parseEmpirePolicy('BuildPlanetDestroyers\t\t;Y');
            expect(py.buildPlanetDestroyers).toBe(true);
        });

        it('int: unparsable text falls back to 0 (TryParse failure)', () => {
            const p = parseEmpirePolicy('ColonyTaxRateSmallColony\t\t;not-a-number');
            expect(p.colonyTaxRateSmallColony).toBe(0);
        });

        it('float: unparsable text falls back to 0', () => {
            const p = parseEmpirePolicy('ConstructionMilitaryEscort\t\t;garbage');
            expect(p.constructionMilitaryEscort).toBe(0);
        });

        it('ResearchDesignOverallFocus: out-of-range values keep the previous value', () => {
            const p = parseEmpirePolicy('ResearchDesignOverallFocus\t\t;99');
            expect(p.researchDesignOverallFocus).toBe(0); // default (Balanced), unchanged
        });

        it('byte-backed enum (DefaultMilitaryFleeWhen): unparsable falls back to 0', () => {
            const p = parseEmpirePolicy('DefaultMilitaryFleeWhen\t\t;nope');
            expect(p.defaultMilitaryFleeWhen).toBe(0); // BuiltObjectFleeWhen.Undefined
        });
    });
});
