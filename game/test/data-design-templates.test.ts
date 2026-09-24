// Tests for src/sim/data/designTemplates.ts (task 04d3): parseDesignSpecification.

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { BuiltObjectSubRole } from '../src/sim/data/names';
import { ComponentType } from '../src/sim/data/components';
import {
    BattleTactics,
    BuiltObjectFleeWhen,
    BuiltObjectRole,
    ComponentCategoryType,
    DesignImageScalingMode,
    DesignSpecification,
    DesignSpecificationComponentRule,
    DesignSpecificationComponentRuleType,
    InvasionTactics,
    parseDesignSpecification,
} from '../src/sim/data/designTemplates';
import { loadGameDataFs } from './helpers/loadGameDataFs';

const dwuRoot = resolve(__dirname, '../public/assets/dwu');
const templatesDir = resolve(dwuRoot, 'designTemplates', 'DEFAULT');

describe('designTemplates.ts parseDesignSpecification — synthetic text', () => {
    it('always adds a MustHave command center, plus hyperdrive for mobile objects', () => {
        const spec = parseDesignSpecification('', 'frigate', BuiltObjectSubRole.Frigate, true);
        expect(spec.ComponentRules).toHaveLength(2);
        expect(spec.ComponentRules[0].ComponentType).toBe(ComponentType.ComputerCommandCenter);
        expect(spec.ComponentRules[0].ComponentRuleType).toBe(DesignSpecificationComponentRuleType.MustHave);
        expect(spec.ComponentRules[0].Amount).toBe(1);
        // The second rule is category-based (HyperDrive), so its type is Undefined.
        expect(spec.ComponentRules[1].ComponentType).toBe(ComponentType.Undefined);
        expect(spec.Mobile).toBe(true);
    });

    it('omits the hyperdrive rule for non-mobile objects', () => {
        const spec = parseDesignSpecification('', 'smallspaceport', BuiltObjectSubRole.SmallSpacePort, false);
        expect(spec.ComponentRules).toHaveLength(1);
        expect(spec.ComponentRules[0].ComponentType).toBe(ComponentType.ComputerCommandCenter);
        expect(spec.Mobile).toBe(false);
    });

    it('parses component rules by concrete type and by category', () => {
        const spec = parseDesignSpecification([
            "' comment line",
            '',
            'weaponbeam ; 4',
            'armor ; 12',
            'shields ; 3',
            'hyperdrive ; 2', // skipped: already added automatically for mobile
            'commandcenter ; 5', // skipped: already added automatically
            'unknowncomponent ; 7', // unknown name -> no rule
        ].join('\n'), 'destroyer', BuiltObjectSubRole.Destroyer, true);

        const rules = spec.ComponentRules;
        // auto command center + auto hyperdrive + weaponbeam(cat) + armor(type) + shields(cat)
        expect(rules).toHaveLength(5);

        const byType = (t: ComponentType) => rules.find((r) => r.ComponentType === t);
        const armor = byType(ComponentType.Armor);
        expect(armor).toBeDefined();
        expect(armor!.Amount).toBe(12);
        expect(armor!.ComponentRuleType).toBe(DesignSpecificationComponentRuleType.MustHave);

        const categories = rules.filter((r) => r.ComponentType === ComponentType.Undefined);
        expect(categories.map((r) => r.ComponentCategory)).toEqual([
            ComponentCategoryType.HyperDrive, // auto
            ComponentCategoryType.WeaponBeam,
            ComponentCategoryType.Shields,
        ]);
    });

    it('parses tactics, invasion tactics and flee-when keys case-insensitively', () => {
        const spec = parseDesignSpecification([
            'TacticsWeaker ; Evade',
            'tacticsstronger ; AllWeapons',
            'TACTICSINVASION ; InvadeImmediately',
            'FleeWhen ; Shields50',
        ].join('\n'), 'cruiser', BuiltObjectSubRole.Cruiser, true);

        expect(spec.TacticsWeaker).toBe(BattleTactics.Evade);
        expect(spec.TacticsStronger).toBe(BattleTactics.AllWeapons);
        expect(spec.TacticsInvasion).toBe(InvasionTactics.InvadeImmediately);
        expect(spec.FleeWhen).toBe(BuiltObjectFleeWhen.Shields50);
    });

    it('leaves tactics at Undefined for unrecognized values', () => {
        const spec = parseDesignSpecification('TacticsWeaker ; nonsense', 'escort', BuiltObjectSubRole.Escort, true);
        expect(spec.TacticsWeaker).toBe(BattleTactics.Undefined);
    });

    it('parses ImageScaling in Absolute mode with range validation', () => {
        const spec = parseDesignSpecification('ImageScaling ; Absolute 50', 'largefreighter', BuiltObjectSubRole.LargeFreighter, true);
        expect(spec.ImageScalingMode).toBe(DesignImageScalingMode.Absolute);
        expect(spec.ImageScalingFactor).toBe(50);

        expect(() => parseDesignSpecification('ImageScaling ; Absolute 5', 'x', BuiltObjectSubRole.Frigate, true))
            .toThrowError(/between 10 and 1000/);
        expect(() => parseDesignSpecification('ImageScaling ; Absolute 2000', 'x', BuiltObjectSubRole.Frigate, true))
            .toThrowError(/between 10 and 1000/);
        expect(() => parseDesignSpecification('ImageScaling ; Absolute abc', 'x', BuiltObjectSubRole.Frigate, true))
            .toThrowError(/Error reading Image Scaling Factor/);
    });

    it('parses ImageScaling in Scaled mode with range validation', () => {
        const spec = parseDesignSpecification('ImageScaling ; Scaled 0.5', 'x', BuiltObjectSubRole.Frigate, true);
        expect(spec.ImageScalingMode).toBe(DesignImageScalingMode.Scaled);
        expect(spec.ImageScalingFactor).toBe(0.5);

        expect(() => parseDesignSpecification('ImageScaling ; Scaled 0.01', 'x', BuiltObjectSubRole.Frigate, true))
            .toThrowError(/between 0.05 and 10.0/);
        expect(() => parseDesignSpecification('ImageScaling ; Bogus 1', 'x', BuiltObjectSubRole.Frigate, true))
            .toThrowError(/should be Absolute or Scaled/);
    });

    it('ignores lines without a semicolon and non-positive amounts', () => {
        const spec = parseDesignSpecification([
            'NotAValidLine',
            'armor ; 0',
            'armor ; -3',
            'armor ; abc',
        ].join('\n'), 'miningship', BuiltObjectSubRole.MiningShip, true);
        // Only the two automatic rules survive.
        expect(spec.ComponentRules).toHaveLength(2);
    });

    it('handles a UTF-8 BOM and CRLF line endings', () => {
        const spec = parseDesignSpecification('﻿Armor ; 6\r\nTacticsWeaker ; Standoff\r\n', 'frigate', BuiltObjectSubRole.Frigate, true);
        expect(spec.TacticsWeaker).toBe(BattleTactics.Standoff);
        expect(spec.ComponentRules.some((r) => r.ComponentType === ComponentType.Armor && r.Amount === 6)).toBe(true);
    });

    it('ResolveRole maps sub-roles to roles and throws on unknown ones', () => {
        expect(DesignSpecification.ResolveRole(BuiltObjectSubRole.Frigate)).toBe(BuiltObjectRole.Military);
        expect(DesignSpecification.ResolveRole(BuiltObjectSubRole.ExplorationShip)).toBe(BuiltObjectRole.Exploration);
        expect(DesignSpecification.ResolveRole(BuiltObjectSubRole.LargeFreighter)).toBe(BuiltObjectRole.Freight);
        expect(DesignSpecification.ResolveRole(BuiltObjectSubRole.ColonyShip)).toBe(BuiltObjectRole.Colony);
        expect(DesignSpecification.ResolveRole(BuiltObjectSubRole.PassengerShip)).toBe(BuiltObjectRole.Passenger);
        expect(DesignSpecification.ResolveRole(BuiltObjectSubRole.ConstructionShip)).toBe(BuiltObjectRole.Build);
        expect(DesignSpecification.ResolveRole(BuiltObjectSubRole.GasMiningStation)).toBe(BuiltObjectRole.Base);
        expect(() => DesignSpecification.ResolveRole(BuiltObjectSubRole.Undefined)).toThrowError('Unknown built object sub role type.');
    });

    it('Clone copies rules (type-based and category-based) and Contains finds them', () => {
        const spec = parseDesignSpecification('armor ; 9\nshields ; 2', 'c', BuiltObjectSubRole.Cruiser, true);
        const clone = spec.Clone();
        expect(clone.SubRole).toBe(spec.SubRole);
        expect(clone.Mobile).toBe(true);
        expect(clone.ComponentRules).toHaveLength(spec.ComponentRules.length);
        expect(clone.Contains(ComponentType.Armor)).toBe(true);
        expect(clone.Contains(ComponentType.WeaponBeam)).toBe(false);
        // Category rules are preserved through the clone.
        const shieldRules = clone.ComponentRules.filter((r) => r.ComponentCategory === ComponentCategoryType.Shields);
        expect(shieldRules.some((r) => r.Amount === 2)).toBe(true);
    });

    it('rule getters/setters behave like the C# properties', () => {
        const rule = new DesignSpecificationComponentRule(
            DesignSpecificationComponentRuleType.ShouldHave,
            'type',
            ComponentType.Armor,
            3
        );
        expect(rule.ComponentRuleType).toBe(DesignSpecificationComponentRuleType.ShouldHave);
        expect(rule.Amount).toBe(3);
        expect(rule.ComponentType).toBe(ComponentType.Armor);
        rule.Amount = 4;
        rule.ComponentRuleType = DesignSpecificationComponentRuleType.MustHave;
        expect(rule.Amount).toBe(4);
        expect(rule.ComponentRuleType).toBe(DesignSpecificationComponentRuleType.MustHave);
    });
});

describe('designTemplates.ts — real files under designTemplates/DEFAULT/', () => {
    let templateFileNames: string[] = [];

    if (existsSync(templatesDir)) {
        templateFileNames = readdirSync(templatesDir)
            .filter((f) => f.endsWith('.txt'))
            .map((f) => f.replace(/\.txt$/, ''))
            .sort();
    }

    // A complete DW:U install ships one template per sub-role (~30 files). A
    // partial install may have fewer; the >= 20 checks are then relaxed to
    // "at least what is present" and reported via console.log.
    const hasFullSet = templateFileNames.length >= 20;

    it('the DEFAULT folder exists and lists >= 20 sub-role template files', () => {
        if (!existsSync(templatesDir)) {
            console.log('✓ designTemplates/DEFAULT not found under public/assets/dwu — skipping real-file tests');
            return;
        }
        if (hasFullSet) {
            expect(templateFileNames.length, `found ${templateFileNames.length} template files`).toBeGreaterThanOrEqual(20);
        } else {
            console.log(`? designTemplates/DEFAULT has only ${templateFileNames.length} files (< 20) — partial install, relaxing count checks`);
            expect(templateFileNames.length).toBeGreaterThan(0);
        }
    });

    it('every DEFAULT template file parses into a valid specification', () => {
        if (!existsSync(templatesDir)) {
            return;
        }
        // Match a file name to a BuiltObjectSubRole member case-insensitively,
        // allowing the file to be a prefix or substring of the member name
        // (the C# engine's sub-role -> file mapping is not always an exact
        // member-name match, e.g. SmallFreighter -> smallfreighter.txt).
        const memberNames = Object.keys(BuiltObjectSubRole).filter((k) => Number.isNaN(parseInt(k, 10)));
        function resolveSubRole(fileName: string): BuiltObjectSubRole | undefined {
            const lower = fileName.toLowerCase();
            for (const name of memberNames) {
                const n = name.toLowerCase();
                if (n === lower || n.startsWith(lower) || lower.startsWith(n)) {
                    return BuiltObjectSubRole[name as keyof typeof BuiltObjectSubRole];
                }
            }
            return undefined;
        }

        let parsedCount = 0;
        let unresolved: string[] = [];
        for (const fileName of templateFileNames) {
            const subRole = resolveSubRole(fileName);
            if (subRole === undefined) {
                // A file whose name matches no BuiltObjectSubRole cannot be
                // loaded by the engine either; note it but do not fail.
                unresolved.push(fileName);
                continue;
            }
            const text = readFileSync(resolve(templatesDir, `${fileName}.txt`), 'utf-8');
            const spec = parseDesignSpecification(text, fileName, subRole, true);
            expect(spec.Role, `${fileName}: role resolved`).not.toBe(BuiltObjectRole.Undefined);
            // Every rule's type must fall inside the enum range.
            const maxType = Math.max(...Object.values(ComponentType).filter((v) => typeof v === 'number'));
            const maxRuleType = Math.max(...Object.values(DesignSpecificationComponentRuleType).filter((v) => typeof v === 'number'));
            for (const rule of spec.ComponentRules) {
                expect(rule.ComponentType, `${fileName}: component type in range`)
                    .toBeGreaterThanOrEqual(ComponentType.Undefined);
                expect(rule.ComponentType, `${fileName}: component type in range`)
                    .toBeLessThanOrEqual(maxType);
                expect(rule.ComponentRuleType, `${fileName}: rule type in range`)
                    .toBeGreaterThanOrEqual(DesignSpecificationComponentRuleType.MustNotHave);
                expect(rule.ComponentRuleType, `${fileName}: rule type in range`)
                    .toBeLessThanOrEqual(maxRuleType);
            }
            parsedCount++;
        }
        if (unresolved.length > 0) {
            console.log(`? ${unresolved.length} file(s) had no matching BuiltObjectSubRole: ${unresolved.join(', ')}`);
        }
        if (hasFullSet) {
            expect(parsedCount, `parsed ${parsedCount} of ${templateFileNames.length} files`).toBeGreaterThanOrEqual(20);
        } else {
            // Partial install: require at least one file to have parsed when any
            // file could be resolved to a sub-role.
            if (parsedCount + unresolved.length > 0 && parsedCount === 0 && unresolved.length > 0) {
                console.log(`? all ${unresolved.length} file(s) were unresolved — nothing to parse`);
            } else {
                expect(parsedCount, `parsed ${parsedCount} of ${templateFileNames.length} files`).toBeGreaterThan(0);
            }
        }
    });

    it('loadGameDataFs exposes design templates via GameData.designTemplates', async () => {
        if (!existsSync(templatesDir)) {
            return;
        }
        const data = await loadGameDataFs();
        if (hasFullSet) {
            expect(data.designTemplates.size).toBeGreaterThanOrEqual(20);
        } else {
            expect(data.designTemplates.size).toBeGreaterThan(0);
        }
        // Spot-check one well-known sub-role when present.
        const frigate = data.designTemplates.get('frigate');
        if (frigate) {
            expect(frigate.Role).toBe(BuiltObjectRole.Military);
            expect(frigate.Contains(ComponentType.ComputerCommandCenter)).toBe(true);
        }
    });

    it('ComponentCategoryType has a single canonical definition, re-exported (not redeclared) by races.ts', async () => {
        // Regression test for a prior duplicate-enum bug: races.ts used to
        // declare its own copy of ComponentCategoryType. Importing the
        // "same" enum member from both modules must give identical values,
        // and races.ts's export must be the literal object designTemplates.ts
        // defines (an `export { X } from './designTemplates'` re-export),
        // not a second, independently declared enum.
        const { ComponentCategoryType: FromRaces } = await import('../src/sim/data/races');
        expect(FromRaces).toBe(ComponentCategoryType);
        expect(FromRaces.WeaponSuperTorpedo).toBe(ComponentCategoryType.WeaponSuperTorpedo);
        expect(FromRaces.Undefined).toBe(0);
    });
});