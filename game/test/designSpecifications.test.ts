import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    parseDesignSpecification,
    designSpecificationFallbackFiles,
    loadDesignSpecification,
    buildDefaultDesignSpecifications,
    getDefaultDesignSpecificationBySubRole,
    newDesignSpecification,
    newComponentRuleByType,
    newComponentRuleByCategory,
    resolveComponentCategoryForType,
    resolveBuiltObjectRole,
    DesignSpecificationComponentRuleType,
    DesignImageScalingMode,
    BuiltObjectRole,
} from '../src/sim/data/designSpecifications';
import { ComponentType } from '../src/sim/data/components';
import { ComponentCategoryType } from '../src/sim/data/policies';
import { BuiltObjectSubRole as SubRole } from '../src/sim/builtObjectTypes';
import { loadGameDataFs } from './helpers/loadGameDataFs';

const dwuRoot = resolve(__dirname, '../public/assets/dwu');
function readDwu(relPath: string): string {
    return readFileSync(resolve(dwuRoot, relPath), 'utf-8');
}

describe('designSpecifications.ts', () => {
    describe('parseDesignSpecification', () => {
        const text = readDwu('designTemplates/human/escort.txt');

        it('parses a real file (human escort) with expected fields and rules', () => {
            const spec = parseDesignSpecification(text, SubRole.Escort, true);
            expect(spec.subRole).toBe(SubRole.Escort);
            expect(spec.mobile).toBe(true);
            expect(spec.role).toBe(resolveBuiltObjectRole(SubRole.Escort));
            expect(spec.role).toBe(BuiltObjectRole.Military);

            // Always-added rules (command center, and hyperdrive since mobile).
            expect(spec.componentRules.some((r) => r.componentType === ComponentType.ComputerCommandCenter && r.amount === 1)).toBe(true);
            expect(spec.componentRules.some((r) => r.componentCategory === ComponentCategoryType.HyperDrive && r.componentType === ComponentType.Undefined && r.amount === 1)).toBe(true);

            // From the file: "Armor ;3"
            const armor = spec.componentRules.find((r) => r.componentType === ComponentType.Armor);
            expect(armor?.amount).toBe(3);
            expect(armor?.componentRuleType).toBe(DesignSpecificationComponentRuleType.MustHave);

            // From the file: "Engine ;6"
            const engine = spec.componentRules.find((r) => r.componentType === ComponentType.EngineMainThrust);
            expect(engine?.amount).toBe(6);

            // Amounts of 0 in the file are not added as rules.
            expect(spec.componentRules.some((r) => r.componentType === ComponentType.AssaultPod)).toBe(false);

            // "WeaponBeam ;2" resolves by category (not a specific type).
            const weaponBeam = spec.componentRules.find((r) => r.componentCategory === ComponentCategoryType.WeaponBeam && r.componentType === ComponentType.Undefined);
            expect(weaponBeam?.amount).toBe(2);
        });

        it('defaults tactics/flee/image-scaling fields when absent from the file', () => {
            const spec = parseDesignSpecification(text, SubRole.Escort, true);
            expect(spec.imageScalingMode).toBe(DesignImageScalingMode.None);
            expect(spec.imageScalingFactor).toBe(1);
        });

        it('parses ImageScaling / Tactics / FleeWhen lines when present', () => {
            const customText = `
'comment line
ImageScaling ;Absolute 250
TacticsWeaker ;Evade
TacticsStronger ;AllWeapons
TacticsInvasion ;InvadeWhenClear
FleeWhen ;Shields50
Armor ;5
`;
            const spec = parseDesignSpecification(customText, SubRole.Escort, true);
            expect(spec.imageScalingMode).toBe(DesignImageScalingMode.Absolute);
            expect(spec.imageScalingFactor).toBe(250);
            expect(spec.tacticsWeaker).toBe(1); // Evade
            expect(spec.tacticsStronger).toBe(3); // AllWeapons
            expect(spec.tacticsInvasion).toBe(2); // InvadeWhenClear
            expect(spec.fleeWhen).toBe(3); // Shields50
            expect(spec.componentRules.find((r) => r.componentType === ComponentType.Armor)?.amount).toBe(5);
        });

        it('throws on an invalid ImageScaling mode, mirroring the C# ApplicationException', () => {
            const badText = 'ImageScaling ;Bogus 5\n';
            expect(() => parseDesignSpecification(badText, SubRole.Escort, true)).toThrow();
        });

        it('rejects an Absolute image scaling factor out of [10, 1000]', () => {
            expect(() => parseDesignSpecification('ImageScaling ;Absolute 5\n', SubRole.Escort, true)).toThrow();
            expect(() => parseDesignSpecification('ImageScaling ;Absolute 2000\n', SubRole.Escort, true)).toThrow();
        });
    });

    describe('newDesignSpecification / newComponentRule helpers', () => {
        it('matches the C# ctor defaults', () => {
            const spec = newDesignSpecification(SubRole.CapitalShip, true);
            expect(spec.mobile).toBe(true);
            expect(spec.componentRules).toEqual([]);
            expect(spec.imageScalingMode).toBe(DesignImageScalingMode.None);
            expect(spec.imageScalingFactor).toBe(1);
        });

        it('newComponentRuleByType resolves the category via ResolveComponentCategory', () => {
            const rule = newComponentRuleByType(DesignSpecificationComponentRuleType.MustHave, ComponentType.WeaponBeam, 2);
            expect(rule.componentCategory).toBe(ComponentCategoryType.WeaponBeam);
            expect(resolveComponentCategoryForType(ComponentType.WeaponBeam)).toBe(ComponentCategoryType.WeaponBeam);
        });

        it('newComponentRuleByCategory leaves componentType Undefined', () => {
            const rule = newComponentRuleByCategory(DesignSpecificationComponentRuleType.ShouldHave, ComponentCategoryType.Shields, 4);
            expect(rule.componentType).toBe(ComponentType.Undefined);
            expect(rule.componentCategory).toBe(ComponentCategoryType.Shields);
        });
    });

    describe('path selection', () => {
        it('non-pirate: race file only', () => {
            const files = designSpecificationFallbackFiles('Escort', 'human', false);
            expect(files).toEqual(['designTemplates/human/escort.txt']);
        });

        it('pirate: race/pirate file first, then race base file (no DEFAULT fallback)', () => {
            const files = designSpecificationFallbackFiles('Escort', 'human', true);
            expect(files).toEqual([
                'designTemplates/human/pirate/escort.txt',
                'designTemplates/human/escort.txt',
            ]);
        });
    });

    describe('default design specification table (port of Galaxy.3.cs)', () => {
        it('has one spec per BuiltObjectSubRole except Undefined and GenericBase', () => {
            const list = buildDefaultDesignSpecifications();
            expect(list).toHaveLength(28);
        });

        it('getDefaultDesignSpecificationBySubRole returns the first match, same instance', () => {
            const list = buildDefaultDesignSpecifications();
            const escort = getDefaultDesignSpecificationBySubRole(list, SubRole.Escort);
            expect(escort).toBe(list.find((s) => s.subRole === SubRole.Escort));
        });

        it('returns null for a sub role absent from the table', () => {
            const list = buildDefaultDesignSpecifications();
            expect(getDefaultDesignSpecificationBySubRole(list, SubRole.GenericBase)).toBeNull();
            expect(getDefaultDesignSpecificationBySubRole(list, SubRole.Undefined)).toBeNull();
        });

        it('matches Galaxy.3.cs rules for Escort (mobile, MustHave Armor category x3)', () => {
            const escort = getDefaultDesignSpecificationBySubRole(buildDefaultDesignSpecifications(), SubRole.Escort)!;
            expect(escort.mobile).toBe(true);
            expect(escort.componentRules.some((r) =>
                r.componentCategory === ComponentCategoryType.Armor && r.componentType === ComponentType.Undefined
                && r.amount === 3 && r.componentRuleType === DesignSpecificationComponentRuleType.MustHave)).toBe(true);
            expect(escort.componentRules.some((r) =>
                r.componentCategory === ComponentCategoryType.WeaponBeam && r.amount === 2
                && r.componentRuleType === DesignSpecificationComponentRuleType.MustHave)).toBe(true);
        });

        it('matches Galaxy.3.cs rules for SmallSpacePort (stationary, Armor type x15)', () => {
            const spec = getDefaultDesignSpecificationBySubRole(buildDefaultDesignSpecifications(), SubRole.SmallSpacePort)!;
            expect(spec.mobile).toBe(false);
            expect(spec.componentRules.some((r) => r.componentType === ComponentType.Armor && r.amount === 15)).toBe(true);
            expect(spec.componentRules.some((r) =>
                r.componentCategory === ComponentCategoryType.Shields && r.amount === 10)).toBe(true);
        });
    });

    describe('loadDesignSpecification', () => {
        it('loads a race file when present', () => {
            const texts = new Map<string, string>([['designTemplates/human/escort.txt', readDwu('designTemplates/human/escort.txt')]]);
            const spec = loadDesignSpecification(texts, 'Escort', SubRole.Escort, true, 'human', false);
            expect(spec).not.toBeNull();
            expect(spec!.componentRules.some((r) => r.componentType === ComponentType.Armor && r.amount === 3)).toBe(true);
        });

        it('falls back from a missing pirate file to the race base file', () => {
            const texts = new Map<string, string>([['designTemplates/human/escort.txt', readDwu('designTemplates/human/escort.txt')]]);
            const spec = loadDesignSpecification(texts, 'Escort', SubRole.Escort, true, 'human', true);
            expect(spec).not.toBeNull();
            expect(spec!.componentRules.some((r) => r.componentType === ComponentType.Armor && r.amount === 3)).toBe(true);
        });

        it('falls back to the default table when the race has no file at all', () => {
            const texts = new Map<string, string>();
            const spec = loadDesignSpecification(texts, 'SmallFreighter', SubRole.SmallFreighter, true, 'nonexistentrace', false);
            expect(spec).not.toBeNull();
            expect(spec).toEqual(getDefaultDesignSpecificationBySubRole(buildDefaultDesignSpecifications(), SubRole.SmallFreighter));
        });

        it('falls back to the default table when nothing at all is found', () => {
            const texts = new Map<string, string>();
            const spec = loadDesignSpecification(texts, 'Escort', SubRole.Escort, true, 'human', false);
            expect(spec).toEqual(getDefaultDesignSpecificationBySubRole(buildDefaultDesignSpecifications(), SubRole.Escort));
        });

        it('returns null when standAlone and nothing is found', () => {
            const texts = new Map<string, string>();
            const spec = loadDesignSpecification(texts, 'Escort', SubRole.Escort, true, 'human', false, true);
            expect(spec).toBeNull();
        });

        it('returns the default table spec (or null for standAlone) when raceNameOverride is empty/null', () => {
            const texts = new Map<string, string>();
            expect(loadDesignSpecification(texts, 'Escort', SubRole.Escort, true, '', false))
                .toEqual(getDefaultDesignSpecificationBySubRole(buildDefaultDesignSpecifications(), SubRole.Escort));
            expect(loadDesignSpecification(texts, 'Escort', SubRole.Escort, true, null, false, true)).toBeNull();
        });
    });

    describe('every race folder x every sub role loads without throwing', () => {
        let gameData: Awaited<ReturnType<typeof loadGameDataFs>>;
        beforeAll(async () => {
            gameData = await loadGameDataFs();
        });

        const subRoles: [string, number][] = [
            ['CapitalShip', SubRole.CapitalShip], ['Carrier', SubRole.Carrier], ['ColonyShip', SubRole.ColonyShip],
            ['ConstructionShip', SubRole.ConstructionShip], ['Cruiser', SubRole.Cruiser], ['DefensiveBase', SubRole.DefensiveBase],
            ['Destroyer', SubRole.Destroyer], ['EnergyResearchStation', SubRole.EnergyResearchStation], ['Escort', SubRole.Escort],
            ['ExplorationShip', SubRole.ExplorationShip], ['Frigate', SubRole.Frigate], ['GasMiningShip', SubRole.GasMiningShip],
            ['GasMiningStation', SubRole.GasMiningStation], ['HighTechResearchStation', SubRole.HighTechResearchStation],
            ['LargeFreighter', SubRole.LargeFreighter], ['LargeSpacePort', SubRole.LargeSpacePort],
            ['MediumFreighter', SubRole.MediumFreighter], ['MediumSpacePort', SubRole.MediumSpacePort],
            ['MiningShip', SubRole.MiningShip], ['MiningStation', SubRole.MiningStation],
            ['MonitoringStation', SubRole.MonitoringStation], ['PassengerShip', SubRole.PassengerShip],
            ['ResortBase', SubRole.ResortBase], ['ResupplyShip', SubRole.ResupplyShip],
            ['SmallFreighter', SubRole.SmallFreighter], ['SmallSpacePort', SubRole.SmallSpacePort],
            ['TroopTransport', SubRole.TroopTransport], ['WeaponsResearchStation', SubRole.WeaponsResearchStation],
        ];

        it('loads (or falls back cleanly) for every race and every sub role, pirate and non-pirate', () => {
            expect(gameData.designSpecificationTexts).toBeDefined();
            const texts = gameData.designSpecificationTexts!;
            for (const race of gameData.races) {
                for (const [subRoleName, subRole] of subRoles) {
                    for (const isPirate of [false, true]) {
                        expect(() => loadDesignSpecification(texts, subRoleName, subRole, true, race.name, isPirate)).not.toThrow();
                        const spec = loadDesignSpecification(texts, subRoleName, subRole, true, race.name, isPirate);
                        expect(spec).not.toBeNull();
                    }
                }
            }
        });
    });
});
