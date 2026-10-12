// Scenario package 19a — the Concord's warship designs (flag rimTrader). Not a port: the stock design generation
// (designGeneration.ts createNewDesigns → designPlacement.ts PlaceComponentsOnDesign) with the scenario design hook
// (query aiDesignTweak, the AIDesignChooser of designPlacement.ts), the Concord AI only.
//   Huge: every warship design is sized up to the maximum construction size (the stock size-up pass, Empire.10.cs
//     2269-2346, which the stock applies to capital ships and carriers only, here with share 1 for every warship
//     sub-role); the Concord holds the whole Ship Construction line (rimTraderConstructionLevel 8 = 1500 × its race's
//     military size factor 0.9 = 1350; carriers × 1.5).
//   Long range: fuel cells are added to the template until the design's range (BuiltObject.1.cs 2362 MaximumFuelRange,
//     on the design's own figures) reaches rimTraderDesignRangeSectors (default 40) × SectorSize, so a strike or a
//     treasure voyage never runs dry in a galaxy at most ~30 sectors across. The Concord's policy design focus is
//     Efficiency (scenarios/rimTrade/Policy/Oranthi.txt ResearchDesignOverallFocus 3: the most fuel-efficient reactor
//     and hyperdrive it has, ResearchSystem.cs EvaluateDesiredComponent), and at game start it is given the most
//     efficient drive and the densest fuel cell in the data (applyConcordTech: CONCORD_RANGE_COMPONENTS); the reactor is
//     the best its starting tech level researches (not the top NovaCore), and more fuel cells make up the range.
// No Rnd of its own: createNewDesigns replays the stock placement's draws for every extra placement.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Design } from '../../design';
import { BuiltObjectSubRole } from '../../builtObjectTypes';
import { ComponentType } from '../../data/components';
import { DesignSpecificationComponentRuleType, newComponentRuleByType, type DesignSpecification } from '../../data/designSpecifications';
import type { AIDesignChooser, DesignPlacer } from '../../designPlacement';
import { registerScenarioQuery } from '../hooks';
import { scenarioParam } from '../state';
import { isRimTraderAI } from './common';

/** The warship sub-roles the Concord builds huge and long-ranged. */
export const CONCORD_WARSHIP_SUB_ROLES: ReadonlySet<BuiltObjectSubRole> = new Set([
    BuiltObjectSubRole.Escort,
    BuiltObjectSubRole.Frigate,
    BuiltObjectSubRole.Destroyer,
    BuiltObjectSubRole.Cruiser,
    BuiltObjectSubRole.CapitalShip,
    BuiltObjectSubRole.Carrier,
    BuiltObjectSubRole.TroopTransport,
    BuiltObjectSubRole.ResupplyShip,
]);

/**
 * Components the Concord is given at game start (applyConcordTech, with their research projects' parents): the most
 * fuel-efficient hyperdrive (components.txt VelocityDrive: 23500 speed for 64 energy) and the densest fuel cell
 * (Mega-Density, 140). No top reactor: the designs use the best one its starting tech level gives, with more fuel cells.
 */
export const CONCORD_RANGE_COMPONENTS = ['VelocityDrive', 'Mega-Density Fuel Cell'] as const;

export const DESIGN_PARAM_DEFAULTS = { rimTraderDesignRangeSectors: 40 } as const;

export function designParam(galaxy: Galaxy, name: keyof typeof DESIGN_PARAM_DEFAULTS): number {
    return scenarioParam(galaxy, name, DESIGN_PARAM_DEFAULTS[name]);
}

/**
 * A design's fuel range at warp (world units): BuiltObject.1.cs 2362 MaximumFuelRange on the design's figures
 * (FuelCapacity / ((WarpSpeedFuelBurn + StaticEnergyConsumption) × FuelUnitPerEnergyUnit) × WarpSpeed), without the
 * empire / race warp-speed bonuses (a ship's range is at least this). 0 without a hyperdrive or reactor. Pure.
 */
export function designFuelRange(d: Design): number {
    const perEnergy = d.reactorCycleFuelConsumption / 1000.0 / (d.reactorStorageCapacity + 1.0);
    const burn = (d.warpSpeedFuelBurn + d.staticEnergyConsumption) * perEnergy;
    if (!(d.warpSpeed > 0) || !(burn > 0)) return 0;
    return (d.fuelCapacity / burn) * d.warpSpeed;
}

function fuelCellSize(d: Design): number {
    const c = d.components.find((x) => x.type === ComponentType.StorageFuel);
    return c?.size ?? 0;
}

/** The range target (world units). */
export function concordRangeTarget(galaxy: Galaxy): number {
    return designParam(galaxy, 'rimTraderDesignRangeSectors') * galaxy.sectorSize;
}

/**
 * Adds fuel cells to `spec` (a copy is changed) and re-places until the design's range reaches `target` or the design
 * no longer fits `maxSize`. `place` is the stock placement (first call draws the stock Rnd). Returns the best design
 * that fits (the first placement if none does).
 */
export function placeLongRange(place: (spec: DesignSpecification) => Design | null, spec0: DesignSpecification, target: number, maxSize: number): Design | null {
    const spec: DesignSpecification = { ...spec0, componentRules: spec0.componentRules.map((c) => ({ ...c })) };
    let fi = spec.componentRules.findIndex((c) => c.componentType === ComponentType.StorageFuel);
    if (fi < 0) {
        spec.componentRules.push(newComponentRuleByType(DesignSpecificationComponentRuleType.MustHave, ComponentType.StorageFuel, 0));
        fi = spec.componentRules.length - 1;
    }
    const first = place(spec);
    if (first === null || target <= 0) return first;
    let best = first;
    let d = first;
    for (let pass = 0; pass < 10; pass++) {
        const range = designFuelRange(d);
        if (range >= target || range <= 0 || d.fuelCapacity <= 0) break;
        const cells = d.components.filter((c) => c.type === ComponentType.StorageFuel).length;
        if (cells <= 0 || fuelCellSize(d) <= 0) break;
        // Range is about linear in the fuel carried; a little extra for the burn the added cells' size brings.
        const want = Math.ceil(cells * (target / range) * 1.05) - cells;
        spec.componentRules[fi].amount = Math.max(1, spec.componentRules[fi].amount + Math.max(1, want));
        const next = place(spec);
        if (next === null) break;
        next.size = next.quickCalculateSize();
        if (next.size > maxSize) break;
        d = next;
        best = next;
    }
    return best;
}

/** The aiDesignTweak chooser for the Concord AI's warships (null: not a Concord warship review). */
export function concordDesignChooser(galaxy: Galaxy, empire: Empire, spec: DesignSpecification): AIDesignChooser | null {
    if (!isRimTraderAI(galaxy, empire) || !CONCORD_WARSHIP_SUB_ROLES.has(spec.subRole)) return null;
    const target = concordRangeTarget(galaxy);
    return {
        choose: (place: DesignPlacer, maxShipSize: number) => {
            const maxSize = spec.subRole === BuiltObjectSubRole.Carrier ? empire.maximumConstructionSize(spec.subRole) : maxShipSize;
            return placeLongRange((s) => place(s, { spec: s, scaleShare: 1, trimOrder: null }), spec, target, maxSize);
        },
    };
}

registerScenarioQuery({
    id: 'rimTrade.designs',
    query: 'aiDesignTweak',
    flag: 'rimTrader',
    // Before the Smarter AI chooser (its handler leaves a value already chosen alone).
    order: -10,
    run: (galaxy, value, { empire, spec }) => (value !== null ? value : concordDesignChooser(galaxy, empire, spec) ?? value),
});
