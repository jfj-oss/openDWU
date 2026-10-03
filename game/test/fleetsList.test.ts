// Task 15c: Fleets list rows, posture text and fleet selection rows (no jsdom).
import { describe, expect, it } from 'vitest';
import type { ShipGroup } from '../src/sim/fleets/shipGroup';
import type { Empire } from '../src/sim/empire';
import { FleetPosture } from '../src/sim/diplomacyTick';
import { BuiltObjectMissionType } from '../src/sim/missions/mission';
import {
    fleetCycleList,
    fleetMissionText,
    fleetName,
    fleetPostureDescription,
    fleetRows,
    fleetSystemName,
    fleetTotalFirepower,
    shipGroupSelectionRows,
} from '../src/ui/screens/fleetsList';
import { isKeyActionAvailable } from '../src/ui/keyboard';

const sol = { name: 'Sol' };
const lead = { name: 'Lead', firepowerRaw: 30, nearestSystemStar: sol, xpos: 0, ypos: 0 };
const sgData = {
    name: 'First Fleet', ships: [lead, { name: 'B', firepowerRaw: 12, nearestSystemStar: sol }], leadShip: lead,
    mission: null, posture: FleetPosture.Attack, postureRangeSquared: Number.MAX_VALUE,
    attackPoint: null, gatherPoint: { name: 'Terra' }, totalTroopAttackStrength: 0,
};
const sg = sgData as unknown as ShipGroup;
const empire = { shipGroups: [sg, null] } as unknown as Empire;
const mk = (over: Record<string, unknown>): ShipGroup => ({ ...sgData, ...over }) as unknown as ShipGroup;

describe('fleetPostureDescription (Galaxy.2.cs ResolveDescriptionFleetPosture)', () => {
    it('null fleet', () => expect(fleetPostureDescription(null)).toBe('(None)'));
    it('attack anywhere', () => expect(fleetPostureDescription(sg)).toBe('Attack any targets'));
    it('attack range ladder', () => {
        const vega = { name: 'Vega' };
        const at = (r: number): string => fleetPostureDescription(mk({ attackPoint: vega, postureRangeSquared: r }));
        expect(at(2250000)).toBe('Attack Vega only');
        expect(at(2304000000)).toBe('Attack Vega and system');
        expect(at(250000000000)).toBe('Attack Vega and nearby systems');
        expect(at(1e12)).toBe('Attack Vega and sector');
        expect(at(Number.MAX_VALUE)).toBe('Attack Vega, then any target');
    });
    it('defend', () => {
        const d = (over: Record<string, unknown>): string => fleetPostureDescription(mk({ posture: FleetPosture.Defend, ...over }));
        expect(d({ postureRangeSquared: 2250000 })).toBe('Defend Terra only');
        expect(d({ gatherPoint: null })).toBe('Defend any targets');
        expect(d({})).toBe('Defend any target, based at Terra');
    });
});

describe('fleet row helpers', () => {
    it('firepower', () => expect(fleetTotalFirepower(sg)).toBe(42));
    it('name', () => {
        expect(fleetName(sg)).toBe('First Fleet');
        expect(fleetName(mk({ name: null }))).toBe('(Unnamed fleet)');
    });
    it('system', () => {
        expect(fleetSystemName(sg)).toBe('Sol');
        expect(fleetSystemName(mk({ leadShip: { ...lead, nearestSystemStar: null } }))).toBe('(Deep Space)');
        expect(fleetSystemName(mk({ leadShip: null }))).toBe('(Deep Space)');
    });
    it('mission', () => {
        expect(fleetMissionText(sg)).toBe('(No mission)');
        expect(fleetMissionText(mk({ mission: { type: BuiltObjectMissionType.Attack } }))).toBe('Attack');
    });
    it('cycle list skips nulls', () => expect(fleetCycleList(empire)).toEqual([sg]));
    it('rows', () => {
        const rows = fleetRows(empire);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            name: 'First Fleet', ships: 2, power: 42, troops: 0, homeBase: 'Terra', mission: '(No mission)', system: 'Sol',
        });
        expect(rows[0].shipGroup).toBe(sg);
        const noHome = fleetRows({ shipGroups: [mk({ gatherPoint: null })] } as unknown as Empire);
        expect(noHome[0].homeBase).toBe('(None)');
    });
});

describe('shipGroupSelectionRows', () => {
    it('labels in order', () => {
        expect(shipGroupSelectionRows(sg, null).map((r) => r.label)).toEqual(
            ['Ships', 'Posture', 'Mission', 'Power', 'Home base', 'Lead ship', 'Location'],
        );
    });
    it('troops row after power', () => {
        const rows = shipGroupSelectionRows(mk({ totalTroopAttackStrength: 50 }), null);
        const i = rows.findIndex((r) => r.label === 'Troops');
        expect(rows[i - 1].label).toBe('Power');
        expect(rows[i].value).toBe('50');
    });
});

describe('keyboard', () => {
    it('F12 fleets screen and the F fleet cycler are available', () => {
        expect(isKeyActionAvailable('fleetsScreen')).toBe(true);
        // fix4ui: F / Shift+F / Ctrl+F cycle fleets (hud.ts stepCycle, Main.Part8.cs btnCycleShipGroups_Click).
        expect(isKeyActionAvailable('cycleFleets')).toBe(true);
    });
});

describe('fleet panel helpers', () => {
    it('range labels follow the posture-range ladder', async () => {
        const { fleetRangeLabel } = await import('../src/ui/screens/fleetsList');
        expect([2250000, 2304000000, 250000000000, 1e12, 3.4e38].map(fleetRangeLabel)).toEqual(['Point only', 'Point and system', 'Nearby systems', 'Sector', 'Any target']);
    });
    it('troop loadout: null when all 255, maxima leave the remainder', async () => {
        const { fleetTroopLoadout, troopLoadoutMaxima } = await import('../src/ui/screens/fleetsList');
        const off = mk({ troopLoadoutInfantry: 255, troopLoadoutArmored: 255, troopLoadoutArtillery: 255, troopLoadoutSpecialForces: 255 });
        expect(fleetTroopLoadout(off)).toBeNull();
        const on = mk({ troopLoadoutInfantry: 50, troopLoadoutArmored: 20, troopLoadoutArtillery: 0, troopLoadoutSpecialForces: 0 });
        const l = fleetTroopLoadout(on)!;
        expect(troopLoadoutMaxima(l)).toEqual({ infantry: 80, armored: 50, artillery: 30, specialForces: 30 });
    });
    it('panel state: nothing enabled without a fleet; Stop needs a mission; Load Troops needs space', async () => {
        const { fleetPanelState } = await import('../src/ui/screens/fleetsList');
        expect(Object.values(fleetPanelState(null).enabled).every((v) => !v)).toBe(true);
        const idle = fleetPanelState(mk({ leadShip: { isAutoControlled: true } }));
        expect(idle.enabled.stop).toBe(false);
        expect(idle.enabled.posture).toBe(true);
        expect(idle.automated).toBe(true);
        expect(fleetPanelState(mk({ mission: { type: BuiltObjectMissionType.Move } })).enabled.stop).toBe(true);
        expect(fleetPanelState(mk({}), 50).enabled.loadTroops).toBe(false);
    });
});

describe('Fleets window port (Main.Part9.cs method_268)', () => {
    it('grid columns are the ShipGroupListView ones at the method_268 widths (950 px)', async () => {
        const { FLEET_GRID_COLUMNS } = await import('../src/ui/screens/fleetsList');
        expect(FLEET_GRID_COLUMNS.map((c) => c.header)).toEqual(['', 'Name', 'Ships', 'Power', 'Troops', 'Home colony', 'Mission', 'Current system']);
        expect(FLEET_GRID_COLUMNS.reduce((s, c) => s + c.width, 0)).toBe(950);
    });
    it('orders row buttons fill 950 px with 10 px gaps', async () => {
        const { rowButtonLayout } = await import('../src/ui/screens/fleetsList');
        const l = rowButtonLayout(7);
        expect(l[0].x).toBe(10);
        const last = l[6];
        expect(last.x + last.w).toBe(960);
        for (let i = 1; i < 7; i++) expect(l[i].x - (l[i - 1].x + l[i - 1].w)).toBe(10);
    });
    it('range icons follow the range ladder', async () => {
        const { fleetRangeIcon } = await import('../src/ui/screens/fleetsList');
        expect([2250000, 2304000000, 250000000000, 1e12, 3.4e38].map(fleetRangeIcon)).toEqual(
            ['fleetRangeTarget.png', 'fleetRangeSystem.png', 'fleetRangeArea.png', 'fleetRangeSector.png', 'fleetRangeAny.png']);
    });
    it('posture circle (GalaxyMap.cs method_5)', async () => {
        const { fleetPostureCircle } = await import('../src/ui/screens/fleetsList');
        expect(fleetPostureCircle(sg)).toBeNull(); // attack, no attack point
        const p = { name: 'P', xpos: 10, ypos: 20 };
        const atk = fleetPostureCircle(mk({ attackPoint: p, postureRangeSquared: 2304000000, gatherPoint: { name: 'T', xpos: 1, ypos: 2 } }))!;
        expect(atk).toMatchObject({ x: 10, y: 20, attack: true, from: { x: 1, y: 2 } });
        expect(atk.r).toBeCloseTo(48000);
        const def = fleetPostureCircle(mk({ posture: FleetPosture.Defend, gatherPoint: { name: 'T', xpos: 1, ypos: 2 }, postureRangeSquared: 2250000 }))!;
        expect(def).toMatchObject({ attack: false, r: 0, from: null });
    });
    it('ungarrisoned troop report (method_269)', async () => {
        const { ungarrisonedTroopReport } = await import('../src/ui/screens/fleetsList');
        const list: unknown[] = [];
        const colony = { troops: { contains: (t: unknown) => list.includes(t) } };
        const t1 = { type: 0, garrisoned: false, atColony: true, colony };
        const t2 = { type: 0, garrisoned: true, atColony: true, colony };
        list.push(t1, t2);
        expect(ungarrisonedTroopReport(list as never, null)).toBe('');
        expect(ungarrisonedTroopReport(list as never, sg)).toMatch(/^Ungarrisoned Troops At Colonies\n1 troops/);
    });
    it('troop loadout labels without a fleet', async () => {
        const { troopLoadoutLabels } = await import('../src/ui/screens/fleetsList');
        const l = troopLoadoutLabels(null);
        expect(l.infantry).toBe('% Infantry  (= 0 units)');
        expect(l.description).toBe('Total Fleet Troop Capacity: 0');
    });
});
