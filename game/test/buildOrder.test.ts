// Task 16c: Build Order rows (Main.Part2.cs method_628 / 629 / 630 / 633) without jsdom.
import { describe, expect, it } from 'vitest';
import type { Empire } from '../src/sim/empire';
import type { Galaxy } from '../src/sim/galaxy';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import {
    BUILD_ORDER_SUBROLES,
    buildableDesignsBySubRole,
    buildOrderRow,
    buildOrderRows,
    isPrivateBuildSubRole,
    shipsOfSubRoleCount,
} from '../src/ui/screens/buildOrder';

const S = BuiltObjectSubRole;

function fakeEmpire(designs: Record<string, unknown>[], extra: Record<string, unknown> = {}): Empire {
    const empire: Record<string, unknown> = {
        research: { checkComponentResearched: () => true },
        maximumConstructionSize: () => 1e9,
        maximumConstructionSizeBase: () => 1e9,
        canBuildCarriers: true,
        canBuildResupplyShips: true,
        galaxy: null,
        leader: null,
        governmentId: -1,
        pirateEmpireBaseHabitat: null,
        latestDesigns: [],
        constructionYards: [{}],
        stateMoney: 5000,
        builtObjects: [{ subRole: S.Escort }, { subRole: S.Escort }, { subRole: S.Frigate }],
        privateBuiltObjects: [{ subRole: S.Escort }, { subRole: S.SmallFreighter }],
        designs: [],
        ...extra,
    };
    empire.designs = designs.map((d) => ({ ...d, empire }));
    return empire as unknown as Empire;
}

function design(name: string, subRole: BuiltObjectSubRole, over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        name,
        role: subRole === S.SmallFreighter ? BuiltObjectRole.Freight : subRole === S.ConstructionShip ? BuiltObjectRole.Build : BuiltObjectRole.Military,
        subRole,
        dateCreated: 1,
        isObsolete: false,
        isPlanetDestroyer: false,
        optimizedDesign: 0,
        components: [],
        size: 100,
        maintenanceSavings: 0,
        calculateCurrentPurchasePrice: () => 1000,
        ...over,
    };
}

const galaxy = null as unknown as Galaxy;

describe('Build Order rows', () => {
    it('has the 16 method_628 sub-roles in order', () => {
        expect(BUILD_ORDER_SUBROLES).toHaveLength(16);
        expect(BUILD_ORDER_SUBROLES[0]).toBe(S.Escort);
        expect(BUILD_ORDER_SUBROLES[15]).toBe(S.PassengerShip);
        expect(BUILD_ORDER_SUBROLES[10]).toBe(S.SmallFreighter);
        expect(BUILD_ORDER_SUBROLES.filter(isPrivateBuildSubRole)).toHaveLength(6);
    });
    it('counts state + private ships of a sub-role', () => {
        expect(shipsOfSubRoleCount(fakeEmpire([]), S.Escort)).toBe(3);
    });
    it('excludes obsolete designs', () => {
        const e = fakeEmpire([design('Old', S.Escort, { isObsolete: true }), design('New', S.Escort)]);
        expect(buildableDesignsBySubRole(e, S.Escort).map((d) => d.name)).toEqual(['New']);
    });
    it('picks the newest buildable design with its cost and maintenance', () => {
        const row = buildOrderRow(fakeEmpire([design('Guard', S.Escort)]), galaxy, S.Escort);
        expect(row.designText).toBe('Guard');
        expect(row.current).toBe(3);
        expect(row.type).toBe('Escort');
        expect(row.unitCost).toBe(1000);
        expect(row.unitMaintenance).toBe(301);
    });
    it('no construction yards: no design, except for colony-built types', () => {
        const e = fakeEmpire([design('Guard', S.Escort), design('Builder', S.ConstructionShip)], { constructionYards: [] });
        const row = buildOrderRow(e, galaxy, S.Escort);
        expect(row.designText).toBe('(No construction yards for this ship type)');
        expect(row.design).toBeNull();
        expect(row.unitCost).toBe(0);
        expect(buildOrderRow(e, galaxy, S.ConstructionShip).designText).toBe('Builder');
    });
    it('private sub-roles have no maintenance', () => {
        const row = buildOrderRow(fakeEmpire([design('Hauler', S.SmallFreighter)]), galaxy, S.SmallFreighter);
        expect(row.designText).toBe('Hauler');
        expect(row.unitCost).toBe(1000);
        expect(row.unitMaintenance).toBe(0);
    });
    it('no design for a sub-role', () => {
        const rows = buildOrderRows(fakeEmpire([]), galaxy);
        expect(rows).toHaveLength(16);
        expect(rows[0].designText).toBe('(No buildable designs)');
        expect(rows[0].unitCost).toBe(0);
    });
});
