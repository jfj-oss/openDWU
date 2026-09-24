import { describe, expect, it } from 'vitest';
import {
    builtObjectRoleLabel,
    shipsAndBasesRows,
} from '../src/ui/screens/shipsAndBasesList';
import type { BuiltObject } from '../src/sim/builtObject';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { topBarScreen } from '../src/ui/hud';
import { isKeyActionAvailable } from '../src/ui/keyboard';

// The panel's DOM needs a browser (jsdom is not configured), so this tests
// only the pure row logic: list composition, distance sort and labels.

/** A hand-built ship/base with fixed fields (0 / '' defaults elsewhere). */
function ship(fields: Partial<BuiltObject>): BuiltObject {
    return { ...fields } as unknown as BuiltObject;
}

const port = ship({
    name: 'Port A',
    role: BuiltObjectRole.Base,
    subRole: BuiltObjectSubRole.SmallSpacePort,
    nearestSystemStar: { name: 'Sol' } as never,
    parentHabitat: { name: 'Terra' } as never,
    xpos: 0,
    ypos: 0,
});
const frigate = ship({
    name: 'F1',
    role: BuiltObjectRole.Military,
    subRole: BuiltObjectSubRole.Frigate,
    nearestSystemStar: null,
    parentHabitat: null,
    xpos: 500,
    ypos: 0,
});
const miner = ship({
    name: 'M1',
    role: BuiltObjectRole.Resource,
    subRole: BuiltObjectSubRole.MiningStation,
    nearestSystemStar: { name: 'Vega' } as never,
    parentHabitat: { name: 'Vega II' } as never,
    xpos: 100,
    ypos: 0,
});

function empire(state: BuiltObject[] = [], priv: BuiltObject[] = []) {
    return { builtObjects: state, privateBuiltObjects: priv };
}

describe('builtObjectRoleLabel (task 13f)', () => {
    it('maps Undefined to "None" and other roles to their enum names', () => {
        expect(builtObjectRoleLabel(BuiltObjectRole.Undefined)).toBe('None');
        expect(builtObjectRoleLabel(BuiltObjectRole.Base)).toBe('Base');
        expect(builtObjectRoleLabel(BuiltObjectRole.Military)).toBe('Military');
        expect(builtObjectRoleLabel(BuiltObjectRole.Resource)).toBe('Resource');
    });
});

describe('shipsAndBasesRows (task 13f)', () => {
    it('lists state-owned then private objects, with role/system/location cells', () => {
        const rows = shipsAndBasesRows(empire([port, frigate], [miner]), null);
        expect(rows.map((r) => r.name)).toEqual(['Port A', 'F1', 'M1']);
        expect(rows[0].role).toBe('Base, Small Space Port');
        expect(rows[0].system).toBe('Sol');
        expect(rows[0].location).toBe('Terra');
        expect(rows[1].role).toBe('Military, Frigate');
        expect(rows[1].system).toBe('(Deep Space)');
        expect(rows[1].location).toBe('');
        expect(rows[2].role).toBe('Resource, Mining Station');
        expect(rows[2].system).toBe('Vega');
        expect(rows[2].location).toBe('Vega II');
    });

    it('sorts by squared distance to the selection (stable)', () => {
        const rows = shipsAndBasesRows(empire([port, frigate], [miner]), { xpos: 480, ypos: 0 });
        expect(rows.map((r) => r.name)).toEqual(['F1', 'M1', 'Port A']);
    });

    it('keeps input order on equal distances (stable sort)', () => {
        // Port A (x=0) and M1 (x=100) are both 50 away from x=50.
        const rows = shipsAndBasesRows(empire([port, frigate], [miner]), { xpos: 50, ypos: 0 });
        expect(rows.map((r) => r.name)).toEqual(['Port A', 'M1', 'F1']);
    });

    it('labels an object with no role/sub-role as "None"', () => {
        const ghost = ship({
            name: 'Ghost',
            role: BuiltObjectRole.Undefined,
            subRole: BuiltObjectSubRole.Undefined,
            nearestSystemStar: null,
            parentHabitat: null,
            xpos: 0,
            ypos: 0,
        });
        const rows = shipsAndBasesRows(empire([ghost]), null);
        expect(rows[0].role).toBe('None');
    });

    it('yields no rows for an empty empire', () => {
        expect(shipsAndBasesRows(empire(), null)).toEqual([]);
    });
});

describe('wiring (task 13f)', () => {
    it('maps the tbtnBuiltObjects top-bar button to the shipsAndBases screen', () => {
        expect(topBarScreen('tbtnBuiltObjects')).toBe('shipsAndBases');
    });

    it('marks the F11 shipsAndBasesScreen action as available', () => {
        expect(isKeyActionAvailable('shipsAndBasesScreen')).toBe(true);
    });
});