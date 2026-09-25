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
