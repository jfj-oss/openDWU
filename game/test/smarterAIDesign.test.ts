// Smarter AI add-on, ship design (src/sim/scenario/smarterAI/shipDesign.ts, weaponFocus.ts): the mod-style rule changes,
// the quality-based weapon pick and merge, the safety net, and the wizard switches (absent = off). (Flags off = the
// faithful game: smarterAI.test.ts.)
import { describe, expect, it } from 'vitest';
import { scenarioIndexFs } from './helpers/scenarioGame';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { ComponentType } from '../src/sim/data/components';
import { ComponentCategoryType } from '../src/sim/data/policies';
import { DesignSpecificationComponentRuleType, newComponentRuleByCategory, newComponentRuleByType } from '../src/sim/data/designSpecifications';
import { addonCatalog } from '../src/sim/scenario/addons';
import { MIN_FIRE_SHARE, passesSafetyNet, tuneRules } from '../src/sim/scenario/smarterAI/shipDesign';
import { mergeWeaponRules, weaponScore } from '../src/sim/scenario/smarterAI/weaponFocus';
import type { ComponentDefinition } from '../src/sim/componentStatic';
import { addonChoiceFor } from '../src/ui/screens/newGameWizard';

const MH = DesignSpecificationComponentRuleType.MustHave;

describe('mod-style designs', () => {
    it('drops the clutter (fighter bays only off non-carriers) and adds HyperDeny on cruisers', () => {
        const rules = [
            newComponentRuleByType(MH, ComponentType.EngineMainThrust, 6),
            newComponentRuleByCategory(MH, ComponentCategoryType.WeaponPointDefense, 5),
            newComponentRuleByType(MH, ComponentType.SensorStealth, 1),
            newComponentRuleByType(MH, ComponentType.WeaponIonDefense, 1),
            newComponentRuleByType(MH, ComponentType.WeaponTractorBeam, 1),
            newComponentRuleByCategory(MH, ComponentCategoryType.AssaultPod, 1),
            newComponentRuleByType(MH, ComponentType.WeaponBombard, 1),
            newComponentRuleByType(MH, ComponentType.FighterBay, 2),
            newComponentRuleByCategory(MH, ComponentCategoryType.WeaponBeam, 2),
        ];
        expect(tuneRules(rules, BuiltObjectSubRole.Cruiser, [], { hyperDeny: true, superBeam: false })).toBe(true);
        expect(rules.map((r) => r.componentType)).toEqual([ComponentType.EngineMainThrust, ComponentType.Undefined, ComponentType.WeaponIonDefense, ComponentType.Undefined, ComponentType.HyperDeny]);
        const carrier = [newComponentRuleByType(MH, ComponentType.FighterBay, 4), newComponentRuleByType(MH, ComponentType.WeaponTractorBeam, 1)];
        tuneRules(carrier, BuiltObjectSubRole.Carrier, [ComponentType.WeaponTractorBeam]);
        expect(carrier.map((r) => r.componentType)).toEqual([ComponentType.FighterBay, ComponentType.WeaponTractorBeam]);
    });
});

describe('one weapon type', () => {
    const ci = (value1: number, value2: number, size: number) => ({ value1, value2, improvedComponent: { size } as ComponentDefinition });
    it('rates by damage per space weighted by range; merges the main weapon slots into one rule', () => {
        expect(weaponScore(ci(36, 390, 12))).toBeGreaterThan(weaponScore(ci(9, 200, 7)));
        expect(weaponScore(ci(10, 600, 5))).toBeGreaterThan(weaponScore(ci(10, 200, 5)));
        expect(weaponScore(ci(0, 600, 5))).toBe(0);
        const rules = [
            newComponentRuleByCategory(MH, ComponentCategoryType.WeaponBeam, 5),
            newComponentRuleByType(MH, ComponentType.WeaponMissile, 3),
            newComponentRuleByCategory(MH, ComponentCategoryType.WeaponPointDefense, 1),
        ];
        expect(mergeWeaponRules(rules, ComponentType.WeaponTorpedo, 4)).toBe(0);
        expect(rules.map((r) => [r.componentType, r.amount])).toEqual([[ComponentType.WeaponTorpedo, 4], [ComponentType.Undefined, 1]]);
    });
});

describe('safety net', () => {
    it('keeps a changed design only with enough firepower, the stock shields and hyperdrive speed, within the size', () => {
        const stock = { size: 300, fire: 100, shields: 500, fuel: 200, warp: 18000, speed: 50 };
        expect(passesSafetyNet({ ...stock, fire: MIN_FIRE_SHARE * 100, shields: 700 }, stock, 400)).toBe(true);
        expect(passesSafetyNet({ ...stock, fire: 70 }, stock, 400)).toBe(false);
        expect(passesSafetyNet({ ...stock, shields: 400 }, stock, 400)).toBe(false);
        expect(passesSafetyNet({ ...stock, warp: 15000 }, stock, 400)).toBe(false);
        expect(passesSafetyNet({ ...stock, size: 401 }, stock, 400)).toBe(false);
    });
});

describe('wizard', () => {
    it('the four ship design switches reach the scenario flags (absent = off)', () => {
        const cat = addonCatalog(scenarioIndexFs());
        const none = { flags: {}, params: {} };
        const smart = { enabled: true, research: true, growthTaxes: true, growthTaxThreshold: 70 };
        expect(addonChoiceFor(cat, [], none, smart)!.flags).toMatchObject({ smarterAIDesignTune: false, smarterAIWeaponFocus: false, smarterAIDesignScale: false, smarterAIDesignTrim: false });
        expect(addonChoiceFor(cat, [], none, { ...smart, designTune: true, designTrim: true })!.flags).toMatchObject({ smarterAIDesignTune: true, smarterAIWeaponFocus: false, smarterAIDesignScale: false, smarterAIDesignTrim: true });
    });
});
