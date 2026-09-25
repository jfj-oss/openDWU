// Task 16b: Ship Designs panel pure helpers (no jsdom).
import { describe, expect, it } from 'vitest';
import type { Design } from '../src/sim/design';
import type { Empire } from '../src/sim/empire';
import type { Galaxy } from '../src/sim/galaxy';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import {
    DesignFilter,
    DesignTypeFilter,
    componentSummary,
    designDateCreatedText,
    designRow,
    designStatRows,
    filterDesigns,
    findNewestNonPlanetDestroyer,
    roleDescription,
    toggleDesignAutoRetrofit,
    toggleDesignObsolete,
} from '../src/ui/screens/shipDesigns';
import { isKeyActionAvailable } from '../src/ui/keyboard';

const S = BuiltObjectSubRole;

function makePlayer(): Empire {
    return {
        designs: [] as unknown[], capital: null, pirateEmpireBaseHabitat: null, galaxy: null, leader: null, governmentId: -1, policy: null,
        builtObjects: [] as unknown[], privateBuiltObjects: [] as unknown[], canBuildCarriers: true, canBuildResupplyShips: true,
        research: { checkComponentResearched: () => true }, maximumConstructionSize: () => 1e9, maximumConstructionSizeBase: () => 1e9,
    } as unknown as Empire;
}

const BASE_SUBROLES = new Set([S.GasMiningStation, S.MiningStation, S.SmallSpacePort, S.MediumSpacePort, S.LargeSpacePort, S.ResortBase,
    S.GenericBase, S.EnergyResearchStation, S.WeaponsResearchStation, S.HighTechResearchStation, S.MonitoringStation, S.DefensiveBase]);

function makeDesign(player: Empire, name: string, subRole: BuiltObjectSubRole, dateCreated: number, extra: Record<string, unknown> = {}): Design {
    return {
        name,
        role: BASE_SUBROLES.has(subRole) ? BuiltObjectRole.Base : BuiltObjectRole.Military,
        subRole,
        dateCreated,
        isObsolete: false,
        isPlanetDestroyer: false,
        isManuallyCreated: false,
        optimizedDesign: 0,
        allowAutoRetrofit: true,
        size: 100,
        components: [],
        empire: player,
        maintenanceSavings: 0,
        calculateCurrentPurchasePrice: () => 1000,
        ...extra,
    } as unknown as Design;
}

describe('ship designs helpers (16b)', () => {
    it('formats the creation date like DesignListView.BindData', () => {
        expect(designDateCreatedText(0)).toBe('0000.01.01');
        expect(designDateCreatedText(600000 * 3 + 60000 * 2 + 2000 * 5 + 1)).toBe('0003.03.06');
    });

    it('resolves role descriptions', () => {
        expect(roleDescription(BuiltObjectRole.Military)).toBe('Military');
        expect(roleDescription(BuiltObjectRole.Base)).toBe('Base');
        expect(roleDescription(BuiltObjectRole.Undefined)).toBe('None');
    });

    it('findNewestNonPlanetDestroyer skips obsolete designs and planet destroyers', () => {
        const p = makePlayer();
        const a = makeDesign(p, 'A', S.Escort, 10);
        const b = makeDesign(p, 'B', S.Escort, 20);
        const c = makeDesign(p, 'C', S.Escort, 30, { isObsolete: true });
        const d = makeDesign(p, 'D', S.Escort, 40, { isPlanetDestroyer: true });
        expect(findNewestNonPlanetDestroyer([a, b, c, d], S.Escort)).toBe(b);
    });

    it('filterDesigns: All and NonObsolete', () => {
        const p = makePlayer();
        const a = makeDesign(p, 'A', S.Frigate, 5);
        const b = makeDesign(p, 'B', S.Escort, 6, { isObsolete: true });
        const c = makeDesign(p, 'C', S.Escort, 7);
        p.designs.push(a, b, c);
        expect(filterDesigns(p, DesignFilter.All, DesignTypeFilter.All)).toEqual([a, b, c]);
        expect(filterDesigns(p, DesignFilter.NonObsolete, DesignTypeFilter.All)).toEqual([a, c]);
    });

    it('filterDesigns: Latest walks the sub-role list, then Star Bases; LatestBuildable matches it', () => {
        const p = makePlayer();
        const frigate = makeDesign(p, 'Frigate', S.Frigate, 5);
        const escortOld = makeDesign(p, 'Escort1', S.Escort, 3);
        const escortNew = makeDesign(p, 'Escort2', S.Escort, 4);
        const starBase = makeDesign(p, 'StarBase', S.GenericBase, 2);
        const starBaseObs = makeDesign(p, 'StarBaseOld', S.GenericBase, 1, { isObsolete: true });
        p.designs.push(starBase, frigate, escortOld, starBaseObs, escortNew);
        const latest = filterDesigns(p, DesignFilter.Latest, DesignTypeFilter.All);
        expect(latest).toEqual([escortNew, frigate, starBase]);
        expect(filterDesigns(p, DesignFilter.LatestBuildable, DesignTypeFilter.All)).toEqual(latest);
    });

    it('filterDesigns: LatestBuildable drops designs with unresearched components', () => {
        const p = makePlayer();
        (p as unknown as { research: { checkComponentResearched: () => boolean } }).research.checkComponentResearched = () => false;
        const plain = makeDesign(p, 'Plain', S.Escort, 3);
        const withComp = makeDesign(p, 'WithComp', S.Frigate, 4, { components: [{ name: 'Laser', componentId: 1 }] });
        p.designs.push(plain, withComp);
        expect(filterDesigns(p, DesignFilter.LatestBuildable, DesignTypeFilter.All)).toEqual([plain]);
    });

    it('filterDesigns: type filters keep list order', () => {
        const p = makePlayer();
        const escort = makeDesign(p, 'Escort', S.Escort, 1);
        const freighter = makeDesign(p, 'Freighter', S.SmallFreighter, 2, { role: BuiltObjectRole.Freight });
        const mine = makeDesign(p, 'Mine', S.MiningStation, 3);
        const explorer = makeDesign(p, 'Explorer', S.ExplorationShip, 4, { role: BuiltObjectRole.Exploration });
        const gas = makeDesign(p, 'Gas', S.GasMiningStation, 5);
        const port = makeDesign(p, 'Port', S.SmallSpacePort, 6);
        p.designs.push(escort, freighter, mine, explorer, gas, port);
        expect(filterDesigns(p, DesignFilter.All, DesignTypeFilter.StateShips)).toEqual([escort, explorer]);
        expect(filterDesigns(p, DesignFilter.All, DesignTypeFilter.PrivateBases)).toEqual([mine, gas]);
    });

    it('designRow: cost, maintenance, upgrade, locked retrofit', () => {
        const p = makePlayer();
        const galaxy = {} as Galaxy;
        const escort = makeDesign(p, 'Escort', S.Escort, 1);
        const row = designRow(escort, p, galaxy);
        expect(row.cost).toBe(1000);
        expect(row.maintenance).toBe(301);
        expect(row.upgrade).toBe('Automatic');
        expect(row.retrofitLocked).toBe(false);
        const freighter = makeDesign(p, 'Freighter', S.SmallFreighter, 1, { role: BuiltObjectRole.Freight });
        expect(designRow(freighter, p, galaxy).retrofitLocked).toBe(true);
    });

    it('designStatRows: no movement and no cargo', () => {
        const p = makePlayer();
        const d = makeDesign(p, 'Base', S.GenericBase, 1, {
            topSpeed: 0, cruiseSpeed: 0, warpSpeed: 0, cargoCapacity: 0, firepower: 0, shieldsCapacity: 0, shieldRechargeRate: 0,
            armor: 0, armorReactive: 0, reactorPowerOutput: 0, staticEnergyConsumption: 0, fuelCapacity: 0, reactorStorageCapacity: 0,
            troopCapacity: 0, fighterCapacity: 0, constructionYardCount: 0, maximumRange: () => 0,
        });
        const rows = designStatRows(d);
        expect(rows).toContainEqual({ label: 'Movement', value: '(No movement)' });
        expect(rows.some((r) => r.label === 'Sprint')).toBe(false);
        expect(rows.find((r) => r.label === 'Cargo Capacity')?.value).toBe('(None)');
    });

    it('componentSummary groups by name in first-seen order', () => {
        const p = makePlayer();
        const d = makeDesign(p, 'X', S.Escort, 1, {
            components: [{ name: 'A', componentId: 1 }, { name: 'B', componentId: 2 }, { name: 'A', componentId: 1 }],
        });
        expect(componentSummary(d)).toEqual([{ name: 'A', count: 2 }, { name: 'B', count: 1 }]);
    });

    it('toggleDesignObsolete flips isObsolete', () => {
        const p = makePlayer();
        const d = makeDesign(p, 'X', S.Escort, 1);
        toggleDesignObsolete(d);
        expect(d.isObsolete).toBe(true);
        toggleDesignObsolete(d);
        expect(d.isObsolete).toBe(false);
    });

    it('toggleDesignAutoRetrofit: private designs are locked; state designs update their ships', () => {
        const p = makePlayer();
        const freighter = makeDesign(p, 'Freighter', S.SmallFreighter, 1, { role: BuiltObjectRole.Freight });
        expect(toggleDesignAutoRetrofit(freighter, p)).toBe(false);
        expect(freighter.allowAutoRetrofit).toBe(true);

        const escort = makeDesign(p, 'Escort', S.Escort, 1);
        const other = makeDesign(p, 'Other', S.Frigate, 1);
        const mine = { design: escort, suppressAutoRetrofit: false };
        const notMine = { design: other, suppressAutoRetrofit: false };
        (p.builtObjects as unknown[]).push(mine, notMine);
        expect(toggleDesignAutoRetrofit(escort, p)).toBe(true);
        expect(escort.allowAutoRetrofit).toBe(false);
        expect(mine.suppressAutoRetrofit).toBe(true);
        expect(notMine.suppressAutoRetrofit).toBe(false);
    });

    it('F8 is implemented', () => {
        expect(isKeyActionAvailable('shipDesignsScreen')).toBe(true);
    });
});
