// Task 16c: Build Order rows (Main.Part2.cs method_628 / 629 / 630 / 633) without jsdom.
import { describe, expect, it } from 'vitest';
import type { Empire } from '../src/sim/empire';
import type { Galaxy } from '../src/sim/galaxy';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import {
    BUILD_ORDER_SUBROLES,
    ORDER_AMOUNT_MAX,
    buildableDesignsBySubRole,
    buildOrderPurchaseLists,
    buildOrderTotals,
    checkEmpireHasOwnedColonies,
    clampOrderAmount,
    orderAmountEnabled,
    purchaseButtonState,
    purchaseResultText,
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

describe('Build Order purchase (Main.Part2.cs 911-1179)', () => {
    it('clamps the Order Amount like the NumericUpDown (0..1000, integer)', () => {
        expect(ORDER_AMOUNT_MAX).toBe(1000);
        expect(clampOrderAmount('3')).toBe(3);
        expect(clampOrderAmount('2.7')).toBe(2);
        expect(clampOrderAmount('-4')).toBe(0);
        expect(clampOrderAmount('5000')).toBe(1000);
        expect(clampOrderAmount('')).toBe(0);
        expect(clampOrderAmount('abc')).toBe(0);
        expect(clampOrderAmount(7)).toBe(7);
    });
    it('rows without a design, and a colony-less pirate\'s resupply / construction rows, are locked', () => {
        const e = fakeEmpire([design('Guard', S.Escort), design('Builder', S.ConstructionShip)]);
        expect(orderAmountEnabled(e, buildOrderRow(e, galaxy, S.Escort))).toBe(true);
        expect(orderAmountEnabled(e, buildOrderRow(e, galaxy, S.Frigate))).toBe(false);
        expect(orderAmountEnabled(e, buildOrderRow(e, galaxy, S.ConstructionShip))).toBe(true);
        const colony = { facilities: null } as Record<string, unknown>;
        const pirate = fakeEmpire([design('Guard', S.Escort), design('Builder', S.ConstructionShip)], { pirateEmpireBaseHabitat: {}, colonies: [colony] });
        colony.owner = null;
        const pg = { pirateShipMaintenanceFactor: 1 } as unknown as Galaxy;
        expect(checkEmpireHasOwnedColonies(pirate)).toBe(false);
        expect(orderAmountEnabled(pirate, buildOrderRow(pirate, pg, S.ConstructionShip))).toBe(false);
        expect(orderAmountEnabled(pirate, buildOrderRow(pirate, pg, S.Escort))).toBe(true);
        colony.owner = pirate;
        expect(checkEmpireHasOwnedColonies(pirate)).toBe(true);
        expect(orderAmountEnabled(pirate, buildOrderRow(pirate, pg, S.ConstructionShip))).toBe(true);
    });
    it('method_643 lists: rows with a design and amount > 0, in Escort … PassengerShip order', () => {
        const e = fakeEmpire([design('Guard', S.Escort), design('Hauler', S.SmallFreighter), design('Builder', S.ConstructionShip)]);
        const rows = buildOrderRows(e, galaxy);
        const amounts = rows.map(() => 0);
        const idx = (s: BuiltObjectSubRole) => BUILD_ORDER_SUBROLES.indexOf(s);
        amounts[idx(S.SmallFreighter)] = 4;
        amounts[idx(S.Escort)] = 2;
        amounts[idx(S.Frigate)] = 9; // no design: dropped
        amounts[idx(S.ConstructionShip)] = 0; // zero: dropped
        const lists = buildOrderPurchaseLists(rows, amounts);
        expect(lists.designs.map((d) => d.name)).toEqual(['Guard', 'Hauler']);
        expect(lists.amounts).toEqual([2, 4]);
        // Rows out of panel order still come back in C# order.
        const rev = buildOrderPurchaseLists([...rows].reverse(), [...amounts].reverse());
        expect(rev.designs.map((d) => d.name)).toEqual(['Guard', 'Hauler']);
        expect(buildOrderPurchaseLists(rows, rows.map(() => 0))).toEqual({ designs: [], amounts: [] });
    });
    it('method_632 totals: row cost / maintenance and the panel totals (private rows add no maintenance)', () => {
        const e = fakeEmpire([design('Guard', S.Escort), design('Hauler', S.SmallFreighter)]);
        const rows = buildOrderRows(e, galaxy);
        const amounts = rows.map(() => 0);
        amounts[BUILD_ORDER_SUBROLES.indexOf(S.Escort)] = 2;
        amounts[BUILD_ORDER_SUBROLES.indexOf(S.SmallFreighter)] = 3;
        const t = buildOrderTotals(galaxy, e, rows, amounts);
        expect(t.rowCost[0]).toBe(2000);
        expect(t.rowMaintenance[0]).toBe(602);
        expect(t.rowCost[BUILD_ORDER_SUBROLES.indexOf(S.SmallFreighter)]).toBe(3000);
        expect(t.rowMaintenance[BUILD_ORDER_SUBROLES.indexOf(S.SmallFreighter)]).toBe(0);
        expect(t.total).toBe(5000);
        expect(t.maintenance).toBe(602);
        expect(buildOrderTotals(galaxy, e, rows, rows.map(() => 0)).total).toBe(0);
    });
    it('method_631 button: enabled "Purchase for X credits" only with a positive total', () => {
        expect(purchaseButtonState(0)).toEqual({ enabled: false, label: 'Purchase' });
        expect(purchaseButtonState(12345.6)).toEqual({ enabled: true, label: 'Purchase for 12,346 credits' });
    });
    it('result text: the cannot-afford message box, or the count queued', () => {
        expect(purchaseResultText({ ok: true, built: [{}, {}, {}] as never[] })).toBe('Build order placed: 3 ships queued for construction');
        expect(purchaseResultText({ ok: true, built: [{}] as never[] })).toBe('Build order placed: 1 ship queued for construction');
        // No text table loaded in unit tests: resolveGameText returns the encoded text; newlines collapse to spaces.
        expect(purchaseResultText({ ok: false, title: 'T', message: 'a\n\nb', built: [] })).toBe('T: a b');
    });
});
