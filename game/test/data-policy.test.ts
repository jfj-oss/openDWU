// Tests for src/sim/data/policy.ts (task 04d2): parseEmpirePolicy / createEmpirePolicy.

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { EmpirePolicy } from '../src/sim/data/policy';
import { createEmpirePolicy, parseEmpirePolicy } from '../src/sim/data/policy';

const dwuRoot = resolve(__dirname, '../public/assets/dwu');

/** Every numeric field of an EmpirePolicy, for the no-NaN sweep. */
function numericFields(policy: EmpirePolicy): [string, number][] {
    const entries: [string, unknown][] = Object.entries(policy);
    return entries.filter(([, v]) => typeof v === 'number') as [string, number][];
}

describe('policy.ts parseEmpirePolicy — synthetic text', () => {
    it('parses representative keys of every value kind', () => {
        const policy = parseEmpirePolicy([
            // comment and blank lines are skipped
            "' this is a comment",
            '',
            '   ',
            // bools: only "y" (case-insensitive) is true
            'IntelligenceAllowMissionDeepCover ; n',
            'TradeWithOtherEmpires ; Y',
            'EngageInTourism ; maybe', // not "y" -> false
            // ints
            'ColonyTaxRateLargeColony ; 5',
            'FleetTypicalSize ; 30',
            'MilitaryConstructionLevel ; 2',
            'PrioritizeBuildWonderId ; -1',
            // floats
            'ConstructionMilitaryEscort ; 12.5',
            'IntelligenceCounterIntelligenceProportion ; 45',
            'TroopDefaultTransportLoadoutArmor ; 0.75',
            // doubles clamped to [0.5, 4.0]
            'WarWillingness ; 9', // -> 4.0
            'ResearchPriority ; 0.1', // -> 0.5
            'HomeworldDefensePriority ; 2.5',
            // byte-parsed enums (kept as ints)
            'NewColonyPopulationPolicyAllRaces ; 3',
            'ResearchIndustryFocus ; 7',
            'DefaultMilitaryFleeWhen ; 25',
            // ResearchDesignOverallFocus: only 0..3 accepted
            'ResearchDesignOverallFocus ; 2',
        ].join('\n'));

        expect(policy.intelligenceAllowMissionDeepCover).toBe(false);
        expect(policy.tradeWithOtherEmpires).toBe(true);
        expect(policy.engageInTourism).toBe(false);
        expect(policy.colonyTaxRateLargeColony).toBe(5);
        expect(policy.fleetTypicalSize).toBe(30);
        expect(policy.constructionMilitary).toBe(2);
        expect(policy.prioritizeBuildWonderId).toBe(-1);
        expect(policy.constructionMilitaryEscort).toBe(12.5);
        expect(policy.intelligenceCounterIntelligenceProportion).toBe(45);
        expect(policy.troopDefaultTransportLoadoutArmor).toBe(0.75);
        expect(policy.warWillingness).toBe(4.0);
        expect(policy.researchPriority).toBe(0.5);
        expect(policy.homeworldDefensePriority).toBe(2.5);
        expect(policy.newColonyPopulationPolicyAllRaces).toBe(3);
        expect(policy.researchIndustryFocus).toBe(7);
        expect(policy.defaultMilitaryFleeWhen).toBe(25);
        expect(policy.researchDesignOverallFocus).toBe(2);
        // untouched fields keep their defaults
        expect(policy.colonyTaxRateSmallColony).toBe(0);
        expect(policy.colonyTaxRateMediumColony).toBe(2);
    });

    it('ResearchDesignOverallFocus outside 0..3 keeps its default', () => {
        const policy = parseEmpirePolicy('ResearchDesignOverallFocus ; 7');
        expect(policy.researchDesignOverallFocus).toBe(0);
    });

    it('unparseable values fall back to 0 like C# TryParse failures', () => {
        const policy = parseEmpirePolicy([
            'ColonyTaxRateLargeColony ; abc',
            'ConstructionMilitaryEscort ; xyz',
            'FleetTypicalSize ; 12.5', // int.TryParse("12.5") fails in C# -> 0
            'NewColonyPopulationPolicyAllRaces ; 300', // > 255 -> byte.TryParse fails -> 0
        ].join('\n'));
        expect(policy.colonyTaxRateLargeColony).toBe(0);
        expect(policy.constructionMilitaryEscort).toBe(0);
        expect(policy.fleetTypicalSize).toBe(0);
        expect(policy.newColonyPopulationPolicyAllRaces).toBe(0);
    });

    it('lines without a semicolon are ignored', () => {
        const policy = parseEmpirePolicy('NotAValidLine\nFleetTypicalSize ; 9');
        expect(policy.fleetTypicalSize).toBe(9);
    });

    it('handles a UTF-8 BOM and CRLF line endings', () => {
        const policy = parseEmpirePolicy('﻿FleetTypicalSize ; 21\r\nWarWillingness ; 3\r\n');
        expect(policy.fleetTypicalSize).toBe(21);
        expect(policy.warWillingness).toBe(3);
    });

    it('unknown keys are silently ignored', () => {
        const policy = parseEmpirePolicy('SomeUnknownKey ; 42\nFleetTypicalSize ; 11');
        expect(policy.fleetTypicalSize).toBe(11);
    });

    it('empty text yields exactly the C# class defaults', () => {
        expect(parseEmpirePolicy('')).toEqual(createEmpirePolicy());
    });

    it('no numeric field is NaN after parsing', () => {
        const policy = parseEmpirePolicy([
            'IntelligenceCounterIntelligenceProportion ; 30',
            'IntelligenceUseEspionageAgainstEmpireWhen ; 2',
            'DiplomacySendGiftsUpToAmount ; 20000',
            'ColonyFacilityPopulationThresholdGiantIonCannon ; 5000',
            'ColonyTaxRateSmallColony ; 0',
            'ResearchDesignOverallFocus ; 3',
            'ResearchDesignTechFocus1 ; 1',
            'ConstructionMilitary ; 1',
            'ConstructionSpaceportMinimumDistance ; 700',
            'WarAttacksAllowColonyBombardment ; 2',
            'FleetMilitaryProportionForFleets ; 60',
            'NewColonyPopulationPolicyYourRaceFamily ; 1',
            'HomeworldDefensePriority ; 1.0',
            'ColonizeOceanPriority ; 1.0',
            'ResearchIndustryFocus ; 1',
            'DefaultMilitaryFleeWhen ; 20',
            'CaptureTargetConditionShip ; 1',
            'PirateSmugglerFreighterLevel ; 1.0',
            'TroopRecruitInfantryLevel ; 1.0',
            'TroopDefaultTransportLoadoutInfantry ; 0.25',
            'TroopGarrisonMinimumPerColony ; 0',
        ].join('\n'));
        for (const [name, value] of numericFields(policy)) {
            expect(Number.isNaN(value), `field ${name} is NaN`).toBe(false);
        }
    });
});

describe('policy.ts — real file', () => {
    const defaultPolicyPath = resolve(dwuRoot, 'Policy/default.txt');

    it('parses Policy/default.txt with no NaN numbers (if present)', () => {
        if (!existsSync(defaultPolicyPath)) {
            console.log('✓ Policy/default.txt not found under public/assets/dwu — skipping real-file test');
            return;
        }
        const policy = parseEmpirePolicy(readFileSync(defaultPolicyPath, 'utf-8'));
        for (const [name, value] of numericFields(policy)) {
            expect(Number.isNaN(value), `field ${name} is NaN`).toBe(false);
        }
        console.log(`✓ parsed Policy/default.txt (${numericFields(policy).length} numeric fields, no NaN)`);
    });
});