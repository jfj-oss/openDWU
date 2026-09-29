import { describe, expect, it } from 'vitest';
import { builtObjectStatusRows, missionTargetText, missionTypeLabel } from '../src/ui/hud';
import type { BuiltObject } from '../src/sim/builtObject';
import type { Empire } from '../src/sim/empire';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { BuiltObjectMissionType, type BuiltObjectMission } from '../src/sim/missions/mission';
import { SystemVisibilityStatus } from '../src/sim/visibility';
import { HabitatCategoryType } from '../src/sim/types';

const player = {
    visibility: {
        systemVisibility: [{}, {}],
        checkSystemVisibilityStatus: (i: number) =>
            i === 1 ? SystemVisibilityStatus.Unexplored : SystemVisibilityStatus.Explored,
    },
} as unknown as Empire;

function fakeBo(extra: Record<string, unknown>): BuiltObject {
    return {
        role: BuiltObjectRole.Exploration,
        currentSpeed: 0,
        topSpeed: 20,
        warpSpeed: 3000,
        hyperjumpDisabledLocation: false,
        currentFuel: 50,
        fuelCapacity: 100,
        attackRangeSquared: 0,
        unbuiltComponentCount: 0,
        damagedComponentCount: 0,
        disabledComponentIndexes: null,
        retrofitDesign: null,
        components: { count: 10 },
        cargo: null,
        cargoCapacity: 0,
        mission: null,
        subsequentMissions: [],
        actualEmpire: player,
        ...extra,
    } as unknown as BuiltObject;
}

function fakeMission(extra: Record<string, unknown>): BuiltObjectMission {
    return {
        type: BuiltObjectMissionType.Move,
        targetSector: null,
        targetShipGroup: null,
        targetBuiltObject: null,
        targetHabitat: null,
        targetCreature: null,
        ...extra,
    } as unknown as BuiltObjectMission;
}

function row(rows: { label: string; value: string }[], label: string): string | undefined {
    return rows.find((r) => r.label === label)?.value;
}

describe('missionTypeLabel', () => {
    it('maps GameText values and default names', () => {
        expect(missionTypeLabel(BuiltObjectMissionType.Undefined)).toBe('(No mission)');
        expect(missionTypeLabel(BuiltObjectMissionType.ExtractResources)).toBe('Mine');
        expect(missionTypeLabel(BuiltObjectMissionType.Waypoint)).toBe('Assemble');
        expect(missionTypeLabel(BuiltObjectMissionType.Hold)).toBe('Wait');
        expect(missionTypeLabel(BuiltObjectMissionType.BuildRepair)).toBe('Build');
        expect(missionTypeLabel(BuiltObjectMissionType.Raid)).toBe('Raid');
        expect(missionTypeLabel(BuiltObjectMissionType.Capture)).toBe('Capture');
    });
});

describe('missionTargetText', () => {
    const terra = (systemIndex: number, category = HabitatCategoryType.Planet) => ({
        targetHabitat: { name: 'Terra', systemIndex, category },
    });
    it('formats each target kind', () => {
        expect(missionTargetText(fakeMission({ targetSector: { x: 2, y: 4 } }), player)).toBe('Sector C5');
        expect(missionTargetText(fakeMission({ targetBuiltObject: { name: 'Port A' } }), player)).toBe('Port A');
        expect(missionTargetText(fakeMission(terra(0)), player)).toBe('Terra');
        expect(missionTargetText(fakeMission(terra(1)), player)).toBe('Unknown Planet');
        expect(missionTargetText(fakeMission(terra(1, HabitatCategoryType.GasCloud)), player)).toBe('Unknown Gas Cloud');
        expect(missionTargetText(fakeMission(terra(5)), player)).toBe('Terra');
        expect(missionTargetText(fakeMission(terra(1)), null)).toBe('Terra');
        expect(missionTargetText(fakeMission({ targetCreature: { name: 'Kaltor' } }), player)).toBe('Kaltor');
        expect(missionTargetText(fakeMission({}), player)).toBe('');
    });
});

describe('builtObjectStatusRows', () => {
    it('idle own explorer', () => {
        const rows = builtObjectStatusRows(fakeBo({}), player);
        expect(rows.map((r) => r.label)).toEqual(['Mission', 'Components', 'Fuel', 'Speed']);
        expect(rows.map((r) => r.value)).toEqual(['(No mission)', '(All components normal)', '50 / 100', '0 / 20']);
    });

    it('own frigate with mission, engage posture and queue', () => {
        const bo = fakeBo({
            role: BuiltObjectRole.Military,
            attackRangeSquared: 4000000,
            subsequentMissions: [{}, {}],
            mission: fakeMission({ type: BuiltObjectMissionType.Attack, targetBuiltObject: { name: 'Raider' } }),
        });
        const rows = builtObjectStatusRows(bo, player);
        expect(row(rows, 'Mission')).toBe('Attack (Engage nearby targets) (2 queued)');
        expect(row(rows, 'Target')).toBe('Raider');
    });

    it('engage postures by attackRangeSquared', () => {
        const mission = (ar: number) =>
            row(builtObjectStatusRows(fakeBo({ role: BuiltObjectRole.Military, attackRangeSquared: ar }), player), 'Mission');
        expect(mission(0)).toBe('(No mission) (Engage when attacked)');
        expect(mission(2304000000)).toBe('(No mission) (Engage system targets)');
        expect(mission(123)).toBe('(No mission) (Engage detected targets)');
    });

    it('components and damage', () => {
        const rows = builtObjectStatusRows(
            fakeBo({ damagedComponentCount: 2, unbuiltComponentCount: 1, disabledComponentIndexes: [4] }),
            player,
        );
        expect(row(rows, 'Components')).toBe('2 damaged, 1 disabled, 1 unbuilt');
        expect(row(rows, 'Construction')).toBe('90% Complete');
        expect(row(rows, 'Damage')).toBe('20%');
        expect(row(builtObjectStatusRows(fakeBo({ retrofitDesign: { name: 'Mk2' } }), player), 'Components')).toBe(
            '(RETROFITTING to Mk2)',
        );
    });

    it('construction progress: 1 - unbuilt / components, hidden once nothing is left to build', () => {
        expect(row(builtObjectStatusRows(fakeBo({ unbuiltComponentCount: 4, components: { count: 10 } }), player), 'Construction')).toBe(
            '60% Complete',
        );
        expect(row(builtObjectStatusRows(fakeBo({ unbuiltComponentCount: 0 }), player), 'Construction')).toBeUndefined();
        // A ship someone else owns: hidden along with the other "known" rows (same `known` guard as Damage).
        expect(
            row(builtObjectStatusRows(fakeBo({ actualEmpire: {}, unbuiltComponentCount: 4 }), player), 'Construction'),
        ).toBeUndefined();
    });

    it('fuel', () => {
        expect(row(builtObjectStatusRows(fakeBo({ currentFuel: -3 }), player), 'Fuel')).toBe('0 / 100 (speed reduced)');
        expect(row(builtObjectStatusRows(fakeBo({ currentFuel: -3, unbuiltComponentCount: 1 }), player), 'Fuel')).toBe(
            '0 / 100',
        );
    });

    it('speed', () => {
        const speed = (extra: Record<string, unknown>) => row(builtObjectStatusRows(fakeBo(extra), player), 'Speed');
        expect(speed({ currentSpeed: 1500.7, warpSpeed: 3000 })).toBe('1500 / 20');
        expect(speed({ warpSpeed: 0 })).toBe('0 / 20 (No Hyperdrive)');
        expect(speed({ hyperjumpDisabledLocation: true })).toBe('0 / 20 (Hyper block)');
        expect(speed({ role: BuiltObjectRole.Base })).toBeUndefined();
    });

    it('cargo', () => {
        const rows = builtObjectStatusRows(
            fakeBo({ cargoCapacity: 500, cargo: { items: [{ amount: 120 }, { amount: 30 }] } }),
            player,
        );
        expect(row(rows, 'Cargo')).toBe('150 / 500');
    });

    it("someone else's ship", () => {
        const rows = builtObjectStatusRows(
            fakeBo({
                actualEmpire: {},
                damagedComponentCount: 2,
                cargoCapacity: 500,
                cargo: { items: [{ amount: 1 }] },
                mission: fakeMission({ targetBuiltObject: { name: 'X' } }),
            }),
            player,
        );
        expect(row(rows, 'Mission')).toBe('(Unknown mission)');
        expect(row(rows, 'Components')).toBe('(Unknown component status)');
        expect(row(rows, 'Fuel')).toBe('(Unknown)');
        expect(row(rows, 'Target')).toBeUndefined();
        expect(row(rows, 'Damage')).toBeUndefined();
        expect(row(rows, 'Cargo')).toBeUndefined();
        expect(row(rows, 'Speed')).toBe('0 / 20');
    });

    it('no actual empire: components known, fuel unknown', () => {
        const rows = builtObjectStatusRows(fakeBo({ actualEmpire: null }), player);
        expect(row(rows, 'Components')).toBe('(All components normal)');
        expect(row(rows, 'Fuel')).toBe('(Unknown)');
    });

    it('null player: everything known', () => {
        const rows = builtObjectStatusRows(
            fakeBo({ actualEmpire: {}, cargoCapacity: 10, damagedComponentCount: 1 }),
            null,
        );
        expect(row(rows, 'Mission')).toBe('(No mission)');
        expect(row(rows, 'Components')).toBe('1 damaged');
        expect(row(rows, 'Damage')).toBe('10%');
        expect(row(rows, 'Fuel')).toBe('50 / 100');
        expect(row(rows, 'Cargo')).toBe('0 / 10');
    });
});
