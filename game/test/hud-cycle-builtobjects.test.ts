// Task 13c: cycle chips Bases/Military/Constr./Other select real BuiltObjects.
// Pure-function tests (no jsdom); fakes are cast `as unknown as BuiltObject`.

import { describe, expect, it } from 'vitest';
import type { BuiltObject } from '../src/sim/builtObject';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import type { SystemInfo } from '../src/sim/types';
import { builtObjectCycleList, builtObjectRows, nearestSystem, nextInCycle, subRoleLabel } from '../src/ui/hud';

type Kind = 'colonies' | 'bases' | 'military' | 'construction' | 'other' | 'fleets' | 'idleShips';

function fakeBo(
    name: string,
    role: BuiltObjectRole,
    subRole: BuiltObjectSubRole,
    extra: Partial<BuiltObject> = {},
): BuiltObject {
    return { name, role, subRole, ...extra } as unknown as BuiltObject;
}

describe('builtObjectCycleList (task 13c)', () => {
    const portA = fakeBo('portA', BuiltObjectRole.Base, BuiltObjectSubRole.SmallSpacePort);
    const frigate = fakeBo('frigate', BuiltObjectRole.Military, BuiltObjectSubRole.Frigate);
    const explorer = fakeBo('explorer', BuiltObjectRole.Exploration, BuiltObjectSubRole.ExplorationShip);
    const conShip = fakeBo('conShip', BuiltObjectRole.Build, BuiltObjectSubRole.ConstructionShip);
    const resupply = fakeBo('resupply', BuiltObjectRole.Military, BuiltObjectSubRole.ResupplyShip);
    const mine = fakeBo('mine', BuiltObjectRole.Resource, BuiltObjectSubRole.MiningStation);
    const research = fakeBo('research', BuiltObjectRole.Base, BuiltObjectSubRole.EnergyResearchStation);
    const empire = { builtObjects: [portA, frigate, explorer], privateBuiltObjects: [conShip, resupply, mine, research] };

    it('bases: the nine base sub-roles, in list order', () => {
        expect(builtObjectCycleList(empire, 'bases' as Kind)).toEqual([portA, research]);
    });

    it('military: role Military', () => {
        expect(builtObjectCycleList(empire, 'military' as Kind)).toEqual([frigate, resupply]);
    });

    it('construction: Build-role first, then ResupplyShip appended', () => {
        expect(builtObjectCycleList(empire, 'construction' as Kind)).toEqual([conShip, resupply]);
    });

    it('other: role Colony or Exploration', () => {
        expect(builtObjectCycleList(empire, 'other' as Kind)).toEqual([explorer]);
    });

    it('fleets: no list yet (ShipGroup not ported)', () => {
        expect(builtObjectCycleList(empire, 'fleets' as Kind)).toEqual([]);
    });
});

describe('subRoleLabel (task 13c)', () => {
    it('splits enum names into words', () => {
        expect(subRoleLabel(BuiltObjectSubRole.SmallSpacePort)).toBe('Small Space Port');
        expect(subRoleLabel(BuiltObjectSubRole.ConstructionShip)).toBe('Construction Ship');
    });

    it('Undefined is empty', () => {
        expect(subRoleLabel(BuiltObjectSubRole.Undefined)).toBe('');
    });
});

describe('nearestSystem (task 13c)', () => {
    function fakeSystem(name: string, x: number, y: number): SystemInfo {
        return { systemStar: { name, xpos: x, ypos: y } as never, habitats: [], sector: { x: 0, y: 0 } };
    }

    it('picks the star with the smallest squared distance', () => {
        const systems = [fakeSystem('A', 0, 0), fakeSystem('B', 1000, 0)];
        expect(nearestSystem(systems, 900, 10)?.systemStar.name).toBe('B');
    });

    it('empty list is null', () => {
        expect(nearestSystem([], 0, 0)).toBeNull();
    });
});

describe('builtObjectRows (task 13c)', () => {
    it('owned object: Owner/Design/Size/Location, zero troops skipped', () => {
        const bo = fakeBo('ship', BuiltObjectRole.Exploration, BuiltObjectSubRole.ExplorationShip, {
            empire: { name: 'Humans', mainColor: 0xff0000 } as never,
            design: { name: 'Pathfinder' } as never,
            size: 120,
            parentHabitat: { name: 'Terra' } as never,
            troops: { count: 0 } as never,
        });
        const rows = builtObjectRows(bo);
        expect(rows.map((r) => r.label)).toEqual(['Owner', 'Design', 'Size', 'Location']);
        expect(rows[0].color).toBe(0xff0000);
        expect(rows[0].value).toBe('Humans');
        expect(rows[1].value).toBe('Pathfinder');
        expect(rows[2].value).toBe('120');
        expect(rows[3].value).toBe('Terra');
    });

    it('abandoned object: no Owner/Location, non-zero troops shown', () => {
        const bo = fakeBo('hulk', BuiltObjectRole.Military, BuiltObjectSubRole.Frigate, {
            empire: null,
            design: { name: 'Hulk' } as never,
            size: 50,
            parentHabitat: null,
            troops: { count: 2 } as never,
        });
        const rows = builtObjectRows(bo);
        expect(rows.map((r) => r.label)).toEqual(['Design', 'Size', 'Troops']);
        expect(rows[2].value).toBe('2');
    });
});

describe('nextInCycle wrap with a remembered last item (task 13c)', () => {
    it('wraps from the last element back to the first', () => {
        const a = fakeBo('a', BuiltObjectRole.Military, BuiltObjectSubRole.Frigate);
        const b = fakeBo('b', BuiltObjectRole.Military, BuiltObjectSubRole.Destroyer);
        expect(nextInCycle([a, b], b, 1)).toBe(a);
    });
});