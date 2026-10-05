// Smarter AI add-on, ship design (src/sim/scenario/smarterAI/shipDesign.ts, weaponFocus.ts): a tuned design has more
// engines and no cloak; the weapon focus gives one weapon family and moves only on a clear lead; a cruiser design grows
// (not in debt); trimming an oversize design keeps the engines. (Flags off = the faithful game: smarterAI.test.ts.)
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createScenarioGame, scenarioIndexFs } from './helpers/scenarioGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { ComponentType } from '../src/sim/data/components';
import { ComponentCategoryType } from '../src/sim/data/policies';
import { DesignSpecificationComponentRuleType, newComponentRuleByCategory, newComponentRuleByType, type DesignSpecification } from '../src/sim/data/designSpecifications';
import { Design } from '../src/sim/design';
import { placeComponentsOnDesignSized, type DesignPlacementTweak } from '../src/sim/designPlacement';
import { placementView } from '../src/sim/designGeneration';
import { addonCatalog } from '../src/sim/scenario/addons';
import { isSmarterAIEmpire } from '../src/sim/scenario/smarterAI/common';
import { KEEP_SPEED_TRIM_ORDER, SCALE_SHARE, cloneSpec, smarterDesignTweak, tuneRules } from '../src/sim/scenario/smarterAI/shipDesign';
import { componentFamily, mergeWeaponRules, pickWeaponFocus, type WeaponFamily } from '../src/sim/scenario/smarterAI/weaponFocus';
import { addonChoiceFor } from '../src/ui/screens/newGameWizard';

const SC = 'smarter-ai';
const MH = DesignSpecificationComponentRuleType.MustHave;

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

let shared: Galaxy | null = null;
function smartGame(): Galaxy {
    if (shared === null) shared = createScenarioGame(base, { scenario: SC }).game.galaxy;
    return shared;
}
const aiEmpires = (g: Galaxy): Empire[] => g.empires.filter((e) => isSmarterAIEmpire(g, e));
const specOf = (e: Empire, sr: BuiltObjectSubRole): DesignSpecification => e.designSpecifications.find((s) => s !== null && s.subRole === sr)!;

/** The stock placement of `spec` (or with `tweak`) for `e`, at an optional size limit. */
function place(g: Galaxy, e: Empire, spec: DesignSpecification, tweak: DesignPlacementTweak | null = null, maxShip?: number): Design {
    const d = new Design('test');
    d.role = spec.role;
    d.subRole = spec.subRole;
    const max = maxShip ?? e.maximumConstructionSize(spec.subRole);
    const out = placeComponentsOnDesignSized(placementView(e, g), d, tweak?.spec ?? spec, null, max, e.maximumConstructionSizeBase(spec.subRole), null, tweak);
    expect(out).not.toBeNull();
    return out!;
}
/** Runs `f` with `e`'s maximum construction size raised to `base` (later-game shipyards), restored afterwards. */
function withMaxSize<T>(e: Empire, base: number, f: () => T): T {
    const was = e.baseMaximumConstructionSize;
    e.baseMaximumConstructionSize = base;
    try {
        return f();
    } finally {
        e.baseMaximumConstructionSize = was;
    }
}
const count = (d: Design, t: ComponentType): number => d.components.filter((c) => c.type === t).length;
const size = (d: Design): number => d.components.reduce((s, c) => s + c.size, 0);
const families = (d: Design): Set<WeaponFamily> => new Set(d.components.map(componentFamily).filter((f): f is WeaponFamily => f !== null));

describe('mod-style designs', () => {
    it('drops the clutter, scales engines / fuel / shields, caps point defence, adds fleet computers to escorts', () => {
        const rules = [
            newComponentRuleByType(MH, ComponentType.EngineMainThrust, 6),
            newComponentRuleByType(MH, ComponentType.StorageFuel, 2),
            newComponentRuleByCategory(MH, ComponentCategoryType.Shields, 3),
            newComponentRuleByCategory(MH, ComponentCategoryType.WeaponPointDefense, 5),
            newComponentRuleByType(MH, ComponentType.SensorStealth, 1),
            newComponentRuleByType(MH, ComponentType.WeaponIonDefense, 1),
            newComponentRuleByType(MH, ComponentType.WeaponTractorBeam, 1),
            newComponentRuleByCategory(MH, ComponentCategoryType.AssaultPod, 1),
            newComponentRuleByType(MH, ComponentType.WeaponBombard, 1),
            newComponentRuleByCategory(MH, ComponentCategoryType.WeaponBeam, 2),
        ];
        expect(tuneRules(rules, BuiltObjectSubRole.Escort)).toBe(true);
        const amount = (t: ComponentType): number | undefined => rules.find((r) => r.componentType === t)?.amount;
        expect(amount(ComponentType.EngineMainThrust)).toBe(9);
        expect(amount(ComponentType.StorageFuel)).toBe(4);
        expect(rules.find((r) => r.componentCategory === ComponentCategoryType.Shields)!.amount).toBe(5);
        expect(rules.find((r) => r.componentCategory === ComponentCategoryType.WeaponPointDefense)!.amount).toBe(2);
        for (const t of [ComponentType.SensorStealth, ComponentType.WeaponIonDefense, ComponentType.WeaponTractorBeam, ComponentType.WeaponBombard]) expect(amount(t)).toBeUndefined();
        expect(rules.some((r) => r.componentCategory === ComponentCategoryType.AssaultPod)).toBe(false);
        expect(amount(ComponentType.ComputerTargettingFleet)).toBe(1);
        expect(amount(ComponentType.ComputerCountermeasuresFleet)).toBe(1);
        // A tech-focus component stays; destroyers keep their ion defence (as in the mod).
        const d = [newComponentRuleByType(MH, ComponentType.WeaponTractorBeam, 1), newComponentRuleByType(MH, ComponentType.WeaponIonDefense, 1)];
        tuneRules(d, BuiltObjectSubRole.Destroyer, [ComponentType.WeaponTractorBeam]);
        expect(d.map((r) => r.componentType)).toEqual([ComponentType.WeaponTractorBeam, ComponentType.WeaponIonDefense]);
    });

    it("an AI empire's tuned escort has more engines and no cloak; its template is untouched", () => {
        const g = smartGame();
        const e = aiEmpires(g)[0];
        // The race's escort template plus a cloak (so the drop shows whatever the race).
        const spec = cloneSpec(specOf(e, BuiltObjectSubRole.Escort));
        spec.componentRules.push(newComponentRuleByType(MH, ComponentType.SensorStealth, 1));
        const before = JSON.stringify(spec.componentRules);
        const stock = place(g, e, spec);
        const tweak = smarterDesignTweak(g, e, spec)!;
        expect(JSON.stringify(spec.componentRules)).toBe(before);
        const tuned = place(g, e, spec, { ...tweak, trimOrder: null, scaleShare: 0 });
        if (e.research.researchedComponents.some((c) => c.type === ComponentType.SensorStealth)) expect(count(stock, ComponentType.SensorStealth)).toBeGreaterThan(0);
        expect(count(tuned, ComponentType.SensorStealth)).toBe(0);
        expect(count(tuned, ComponentType.EngineMainThrust)).toBeGreaterThan(count(stock, ComponentType.EngineMainThrust));
    }, 600000);
});

describe('one weapon type', () => {
    it('the focus is the leading family, kept until another leads by more than one tech level', () => {
        expect(pickWeaponFocus({ beam: 0, torpedo: 0, fighter: 0 }, null)).toBeNull();
        expect(pickWeaponFocus({ beam: 2, torpedo: 3, fighter: 0 }, null)).toBe('torpedo');
        expect(pickWeaponFocus({ beam: 4, torpedo: 3, fighter: 0 }, 'torpedo')).toBe('torpedo');
        expect(pickWeaponFocus({ beam: 5, torpedo: 4, fighter: 0 }, 'torpedo')).toBe('torpedo');
        expect(pickWeaponFocus({ beam: 6, torpedo: 4, fighter: 0 }, 'torpedo')).toBe('beam');
    });

    it("a frigate's weapon slots merge into one family; fighters only replace guns on big hulls; carriers keep their bays", () => {
        const rules = [
            newComponentRuleByCategory(MH, ComponentCategoryType.WeaponBeam, 5),
            newComponentRuleByType(MH, ComponentType.WeaponMissile, 3),
            newComponentRuleByCategory(MH, ComponentCategoryType.WeaponPointDefense, 1),
        ];
        expect(mergeWeaponRules(rules, BuiltObjectSubRole.Frigate, 'torpedo', 'torpedo')).toBe(true);
        expect(rules.map((r) => [r.componentCategory, r.amount])).toEqual([[ComponentCategoryType.WeaponTorpedo, 8], [ComponentCategoryType.WeaponPointDefense, 1]]);
        const small = [newComponentRuleByCategory(MH, ComponentCategoryType.WeaponBeam, 5), newComponentRuleByType(MH, ComponentType.WeaponMissile, 3)];
        mergeWeaponRules(small, BuiltObjectSubRole.Frigate, 'fighter', 'beam');
        expect(small.map((r) => [r.componentCategory, r.amount])).toEqual([[ComponentCategoryType.WeaponBeam, 8]]);
        const big = [newComponentRuleByCategory(MH, ComponentCategoryType.WeaponBeam, 6), newComponentRuleByType(MH, ComponentType.WeaponMissile, 3)];
        mergeWeaponRules(big, BuiltObjectSubRole.Cruiser, 'fighter', 'beam');
        expect(big.map((r) => [r.componentType, r.amount])).toEqual([[ComponentType.FighterBay, 3]]);
        const carrier = [newComponentRuleByType(MH, ComponentType.FighterBay, 6), newComponentRuleByCategory(MH, ComponentCategoryType.WeaponBeam, 1), newComponentRuleByType(MH, ComponentType.WeaponMissile, 1)];
        mergeWeaponRules(carrier, BuiltObjectSubRole.Carrier, 'fighter', 'torpedo');
        expect(carrier.map((r) => [r.componentType, r.componentCategory, r.amount])).toEqual([[ComponentType.FighterBay, ComponentCategoryType.Fighter, 6], [ComponentType.Undefined, ComponentCategoryType.WeaponTorpedo, 2]]);
    });

    it("an AI empire's frigate design carries a single weapon family", () => {
        const g = smartGame();
        const e = aiEmpires(g)[0];
        const spec = cloneSpec(specOf(e, BuiltObjectSubRole.Frigate));
        // Two families in the template, whatever the race.
        spec.componentRules.push(newComponentRuleByCategory(MH, ComponentCategoryType.WeaponBeam, 2), newComponentRuleByType(MH, ComponentType.WeaponMissile, 2));
        const stock = place(g, e, spec);
        const tweak = smarterDesignTweak(g, e, spec)!;
        const focused = place(g, e, spec, { ...tweak, trimOrder: null, scaleShare: 0 });
        const researched = new Set(e.research.researchedComponents.map(componentFamily));
        if (researched.has('beam') && researched.has('torpedo')) expect(families(stock).size).toBeGreaterThan(1);
        expect(families(focused).size).toBe(1);
    }, 600000);
});

describe('bigger warships', () => {
    it('a cruiser design grows towards the share of the maximum size; not in debt', () => {
        const g = smartGame();
        const e = aiEmpires(g)[0];
        const spec = specOf(e, BuiltObjectSubRole.Cruiser);
        withMaxSize(e, 2000, () => {
            const stock = place(g, e, spec);
            const max = e.maximumConstructionSize(BuiltObjectSubRole.Cruiser);
            expect(size(stock)).toBeLessThan(SCALE_SHARE[BuiltObjectSubRole.Cruiser]! * max);
            const grown = place(g, e, spec, { spec, scaleShare: SCALE_SHARE[BuiltObjectSubRole.Cruiser]!, trimOrder: null });
            expect(size(grown)).toBeGreaterThan(1.3 * size(stock));
            expect(size(grown)).toBeLessThanOrEqual(max);
        });
        expect(smarterDesignTweak(g, e, spec)!.scaleShare).toBe(SCALE_SHARE[BuiltObjectSubRole.Cruiser]);
        const money = e.stateMoney;
        e.stateMoney = -1e6;
        try {
            expect(smarterDesignTweak(g, e, spec)!.scaleShare).toBe(0);
        } finally {
            e.stateMoney = money;
        }
        // Escorts and frigates are not scaled.
        expect(smarterDesignTweak(g, e, specOf(e, BuiltObjectSubRole.Frigate))!.scaleShare).toBe(0);
    }, 600000);
});

describe('keep speed when trimming', () => {
    it('an oversize destroyer loses armour and weapons before its engines', () => {
        const g = smartGame();
        const e = aiEmpires(g)[0];
        const spec = specOf(e, BuiltObjectSubRole.Destroyer);
        const full = withMaxSize(e, 2000, () => place(g, e, spec));
        const limit = Math.trunc(size(full) * 0.9);
        const stock = place(g, e, spec, null, limit);
        const kept = place(g, e, spec, { spec, scaleShare: 0, trimOrder: KEEP_SPEED_TRIM_ORDER }, limit);
        expect(count(stock, ComponentType.EngineMainThrust)).toBeLessThan(count(full, ComponentType.EngineMainThrust));
        expect(count(kept, ComponentType.EngineMainThrust)).toBe(count(full, ComponentType.EngineMainThrust));
        expect(count(kept, ComponentType.Armor)).toBeLessThan(count(stock, ComponentType.Armor));
    }, 600000);
});

describe('wizard', () => {
    it('the four ship design switches reach the scenario flags (absent = on)', () => {
        const cat = addonCatalog(scenarioIndexFs());
        const none = { flags: {}, params: {} };
        const smart = { enabled: true, research: true, growthTaxes: true, growthTaxThreshold: 70 };
        expect(addonChoiceFor(cat, [], none, smart)!.flags).toMatchObject({ smarterAIDesignTune: true, smarterAIWeaponFocus: true, smarterAIDesignScale: true, smarterAIDesignTrim: true });
        expect(addonChoiceFor(cat, [], none, { ...smart, designTune: false, designTrim: false })!.flags).toMatchObject({ smarterAIDesignTune: false, smarterAIWeaponFocus: true, smarterAIDesignScale: true, smarterAIDesignTrim: false });
    });
});
