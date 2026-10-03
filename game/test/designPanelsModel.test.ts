// Designs screen: pure read-outs of the Design Editor panels (designPanelsModel.ts). No jsdom.
import { describe, expect, it } from 'vitest';
import type { Design } from '../src/sim/design';
import { ComponentType } from '../src/sim/data/components';
import { ComponentCategoryType } from '../src/sim/data/policies';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import {
    SHIP_PICTURE_COUNT,
    calculateBoardingAssaultValue,
    calculateBoardingDefenseValue,
    calculateTotalWeaponsEnergyUsePerSecond,
    componentCategoryAbbreviation,
    damageGraphPolygon,
    designDefenseRows,
    designEnergyPanel,
    designIndustryPanel,
    designMovementPanel,
    fixed,
    maximumSizeText,
    shipPictureGroups,
    thousandsK,
    upToOneDecimal,
} from '../src/ui/screens/designPanelsModel';

const weapon = (type: ComponentType, rawDamage: number, def: Record<string, unknown> = {}) => ({ component: { type, def }, rawDamage });

function makeDesign(extra: Record<string, unknown> = {}): Design {
    return {
        shieldsCapacity: 120, shieldRechargeRate: 3, shieldAreaRechargeRange: 0, armor: 40, armorReactive: 2,
        countermeasureModifier: 0, fleetCountermeasureModifier: 5, stealth: 0.85, damageReduction: 0, damageRepair: 0,
        components: [], weapons: [], energyCollection: 0, reactorPowerOutput: 100, staticEnergyConsumption: 120,
        fuelType: null, fuelCapacity: 200, reactorStorageCapacity: 400, reactorCycleFuelConsumption: 2000,
        impulseSpeedFuelBurn: 1, cruiseSpeedFuelBurn: 5, topSpeedFuelBurn: 20, warpSpeedFuelBurn: 60,
        cruiseSpeed: 10, topSpeed: 18, warpSpeed: 12500, accelerationRate: 3.0, turnRate: 0.1745329,
        maximumRange: () => 4_000_000, cargoCapacity: 0, medicalCapacity: 0, recreationCapacity: 0,
        researchWeapons: 12345, researchEnergy: 0, researchHighTech: 500, extractionMine: 0, extractionGas: 2,
        extractionLuxury: 0, manufactureWeapons: 0, manufactureEnergy: 0, manufactureHighTech: 0,
        constructionYardCount: 0, dockingBayCount: 3,
        ...extra,
    } as unknown as Design;
}

describe('designPanelsModel', () => {
    it('formats like the .NET custom formats', () => {
        expect(fixed(2.345, 2)).toBe('2.35');
        expect(fixed(-0.25, 1)).toBe('-0.3');
        expect(upToOneDecimal(3)).toBe('3');
        expect(upToOneDecimal(2.25)).toBe('2.3');
        expect(thousandsK(12345)).toBe('12K');
        expect(thousandsK(500)).toBe('1K');
    });

    it('DesignDefense rows: (None) placeholders, percent and stealth', () => {
        const rows = designDefenseRows(makeDesign(), null);
        const v = Object.fromEntries(rows.map((r) => [r.label, r.value]));
        expect(v['Shields']).toBe('120');
        expect(v['Shield Area Recharge Range']).toBe('(None)');
        expect(v['Countermeasures']).toBe('(None)');
        expect(v['Component Type Countermeasures Fleet']).toBe('+5%');
        expect(v['Stealth: Visibility Range']).toBe('-15.0%');
        expect(rows).toHaveLength(11);
    });

    it('DesignEnergy: excess output in red when negative, fuel per 1000 energy', () => {
        const m = designEnergyPanel(makeDesign({ fuelType: { resourceId: 7 } }), (id) => `R${id}`);
        expect(m.top[3]).toMatchObject({ value: '-20', color: 'rgb(255, 0, 0)' });
        expect(m.fuelType).toBe('Fuel Type = R7');
        expect(m.fuelPer1000).toContain('5.00');
    });

    it('DesignMovement: speeds, curve from the static usage line, turn rate in degrees', () => {
        const m = designMovementPanel(makeDesign());
        expect(m.moving).toBe(true);
        expect(m.speeds).toEqual([3, 10, 18, 12500]);
        // num3 = 8 + 16*4 + 64 = 136; num5 = 60 / (120 + 60) → static at 136 - 40 = 96.
        expect(m.staticY).toBe(96);
        expect(m.curve[4].y).toBe(136 - Math.trunc(180 * (60 / 180)));
        expect(m.turnRate).toContain('10°/');
        expect(m.acceleration).toContain('3/');
        expect(designMovementPanel(makeDesign({ topSpeed: 0 })).moving).toBe(false);
    });

    it('DesignIndustry: research in thousands, mining, docking bays', () => {
        const m = designIndustryPanel(makeDesign());
        const v = Object.fromEntries(m.rows.map((r) => [r.label, r.value]));
        expect(v['Research']).toBe('W:12K, H:1K');
        expect(v['Mining']).toBe('2 gas');
        expect(v['Docking Bays']).toBe('3 bays');
        expect(v['Cargo Capacity']).toBe('(None)');
    });

    it('boarding values and weapons energy use (Design.cs)', () => {
        const d = makeDesign({
            components: [{ type: ComponentType.HabitationHabModule }, { type: ComponentType.HabitationHabModule }],
            weapons: [weapon(ComponentType.AssaultPod, 15), weapon(ComponentType.WeaponBeam, 10, { value3: 4, value6: 2000 })],
        });
        const race = { troopStrength: 150 } as never;
        expect(calculateBoardingAssaultValue(d, race)).toBe(22);
        expect(calculateBoardingDefenseValue(d, race)).toBe(30 + 30 + 22);
        const research = { resolveImprovedComponentValues: (c: { value3?: number; value6?: number }) => ({ value3: c.value3 ?? 0, value6: c.value6 ?? 0 }) };
        expect(calculateTotalWeaponsEnergyUsePerSecond(d, research as never)).toBe(2);
    });

    it('damage graph wedge (WeaponListView.GenerateDamageGraph)', () => {
        expect(damageGraphPolygon(80, 10, 500, 150, 17)).toEqual([
            { x: 0, y: 1 }, { x: 0, y: 14 }, { x: 75, y: 10 }, { x: 75, y: 5 },
        ]);
    });

    it('category abbreviations, maximum size label, picture groups', () => {
        expect(componentCategoryAbbreviation(ComponentCategoryType.WeaponBeam)).toBe('WBM');
        expect(componentCategoryAbbreviation(ComponentCategoryType.AssaultPod)).toBe('ASP');
        const empire = {
            maximumConstructionSize: (s?: BuiltObjectSubRole) => (s === BuiltObjectSubRole.SmallFreighter ? 300 : 230),
            maximumConstructionSizeBase: () => 690,
        };
        expect(maximumSizeText(empire as never)).toBe('Maximum Ship size: 230, C:300\nMaximum Base size: 690 (when not at colony)');
        const groups = shipPictureGroups();
        expect(groups[0].first).toBe(0);
        expect(groups[groups.length - 1].last).toBe(SHIP_PICTURE_COUNT - 1);
    });
});
