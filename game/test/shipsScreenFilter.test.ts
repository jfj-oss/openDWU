// Ships and Bases window: role filter (BaconMain.cs method_423 / Main.Part3.cs cmbBuiltObjectFilter items), the
// multi-select model (DataGridView MultiSelect: click / Ctrl / Shift) and the button enable rules. Pure (no jsdom).
import { describe, expect, it } from 'vitest';
import {
    BUILT_OBJECT_FILTERS,
    filterBuiltObjects,
    selectedShips,
    shipsActionState,
    shipsAndBasesRows,
    type BuiltObjectFilter,
} from '../src/ui/screens/shipsAndBasesList';
import { ListSelection } from '../src/ui/listSelection';
import type { BuiltObject } from '../src/sim/builtObject';
import type { Habitat } from '../src/sim/types';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { BuiltObjectSubRole as S } from '../src/sim/builtObjectTypes';

let n = 0;
function ship(subRole: S, role: BuiltObjectRole, over: Record<string, unknown> = {}): BuiltObject {
    n++;
    return { name: `B${n}`, subRole, role, xpos: n * 10, ypos: 0, shipGroup: null, mission: null, isAutoControlled: true, topSpeed: 10, damagedComponentCount: 0, troopCapacity: 0, isShipYard: false, constructionQueue: null, owner: {}, nearestSystemStar: null, parentHabitat: null, ...over } as unknown as BuiltObject;
}

const frigate = ship(S.Frigate, BuiltObjectRole.Military);
const escort = ship(S.Escort, BuiltObjectRole.Military);
const transport = ship(S.TroopTransport, BuiltObjectRole.Military, { troopCapacity: 200 });
const resupply = ship(S.ResupplyShip, BuiltObjectRole.Military);
const colony = ship(S.ColonyShip, BuiltObjectRole.Colony);
const explorer = ship(S.ExplorationShip, BuiltObjectRole.Exploration);
const freighter = ship(S.SmallFreighter, BuiltObjectRole.Freight);
const minerPrivate = ship(S.MiningShip, BuiltObjectRole.Resource);
const gasStation = ship(S.GasMiningStation, BuiltObjectRole.Base, { topSpeed: 0 });
const research = ship(S.WeaponsResearchStation, BuiltObjectRole.Base, { topSpeed: 0 });
const yard = ship(S.MediumSpacePort, BuiltObjectRole.Base, { topSpeed: 0, isShipYard: true, constructionQueue: { constructionYards: [{}] } });
const passengerPrivate = ship(S.PassengerShip, BuiltObjectRole.Passenger);
const passengerState = ship(S.PassengerShip, BuiltObjectRole.Passenger);
const home = { name: 'Home', xpos: 5, ypos: 5 } as unknown as Habitat;

const state = [frigate, escort, transport, resupply, colony, explorer, freighter, gasStation, research, yard, passengerState];
const priv = [minerPrivate, passengerPrivate];
const empire = { builtObjects: state, privateBuiltObjects: priv, colonies: [home] };
const names = (l: readonly { name: string }[]): string[] => l.map((x) => x.name).sort();
const list = (f: BuiltObjectFilter): { name: string }[] => filterBuiltObjects(empire, f, null);

describe('role filter (cmbBuiltObjectFilter)', () => {
    it('offers the original 18 entries in order, including "Selected Item"', () => {
        expect([...BUILT_OBJECT_FILTERS]).toEqual([
            '(Show all ships and bases)', 'Selected Item', 'Colony Ships', 'Construction Yards', 'Defensive Bases', 'Exploration Ships',
            'Freighters', 'Military Ships', 'Mining Ships', 'Mining Stations', 'Monitoring Stations', 'Passenger Ships', 'Other Bases',
            'Research Stations', 'Resort Bases', 'Resupply Ships', 'Space Ports', 'Troop Carriers',
        ]);
    });

    it('the default lists every state-owned then private ship and base', () => {
        expect(list('(Show all ships and bases)')).toEqual([...state, ...priv]);
    });

    it('Military Ships: the eight military sub-roles, state list only', () => {
        expect(names(list('Military Ships'))).toEqual(names([frigate, escort, transport, resupply]));
    });

    it('single-role filters show only that role', () => {
        expect(list('Colony Ships')).toEqual([colony]);
        expect(list('Exploration Ships')).toEqual([explorer]);
        expect(list('Freighters')).toEqual([freighter]);
        expect(list('Resupply Ships')).toEqual([resupply]);
        expect(list('Space Ports')).toEqual([yard]);
        expect(list('Research Stations')).toEqual([research]);
        expect(list('Mining Stations')).toEqual([gasStation]);
        expect(list('Defensive Bases')).toEqual([]);
        expect(list('Monitoring Stations')).toEqual([]);
        expect(list('Resort Bases')).toEqual([]);
        expect(list('Other Bases')).toEqual([]);
    });

    it('Mining Ships reads the private list too; Passenger Ships lists private first', () => {
        expect(list('Mining Ships')).toEqual([minerPrivate]);
        expect(list('Passenger Ships')).toEqual([passengerPrivate, passengerState]);
    });

    it('Troop Carriers: anything with troop capacity', () => {
        expect(list('Troop Carriers')).toEqual([transport]);
    });

    it('Construction Yards: ship yards with construction yards, then the colonies', () => {
        expect(list('Construction Yards')).toEqual([yard, home]);
    });

    it('Selected Item: only the selection, when it is the empire\'s', () => {
        expect(filterBuiltObjects(empire, 'Selected Item', frigate)).toEqual([frigate]);
        expect(filterBuiltObjects(empire, 'Selected Item', ship(S.Frigate, BuiltObjectRole.Military))).toEqual([]);
        expect(filterBuiltObjects(empire, 'Selected Item', null)).toEqual([]);
    });

    it('filtered rows keep the distance sort and carry the row cells', () => {
        const rows = shipsAndBasesRows(empire, { xpos: 1e6, ypos: 0 }, 'Military Ships');
        expect(rows.map((r) => r.name)).toEqual([resupply.name, transport.name, escort.name, frigate.name]);
        expect(rows[0].fleet).toBe('(None)');
        expect(rows[0].mission).toBe('(None)');
        expect(rows[0].automated).toBe(true);
    });

    it('a fleet name and a mission show in the row', () => {
        const f = ship(S.Frigate, BuiltObjectRole.Military, { shipGroup: { name: 'First Fleet' } });
        const r = shipsAndBasesRows({ builtObjects: [f], privateBuiltObjects: [] }, null, '(Show all ships and bases)')[0];
        expect(r.fleet).toBe('First Fleet');
    });
});

describe('multi-select model (ListSelection)', () => {
    const rows = ['a', 'b', 'c', 'd', 'e'];
    const mk = (): ListSelection<string> => {
        const s = new ListSelection<string>();
        s.setItems(rows);
        return s;
    };

    it('a plain click selects one row and replaces the selection', () => {
        const s = mk();
        s.click(1);
        s.click(3);
        expect(s.selected()).toEqual(['d']);
    });

    it('ctrl+click toggles rows', () => {
        const s = mk();
        s.click(0);
        s.click(2, { ctrl: true });
        s.click(4, { ctrl: true });
        expect(s.selected()).toEqual(['a', 'c', 'e']);
        s.click(2, { ctrl: true });
        expect(s.selected()).toEqual(['a', 'e']);
    });

    it('shift+click selects the range from the anchor, either direction', () => {
        const s = mk();
        s.click(1);
        s.click(3, { shift: true });
        expect(s.selected()).toEqual(['b', 'c', 'd']);
        s.click(0, { shift: true }); // the anchor stays at b
        expect(s.selected()).toEqual(['a', 'b']);
    });

    it('ctrl+shift adds the range to what is selected', () => {
        const s = mk();
        s.click(0);
        s.click(2);
        s.click(3, { ctrl: true, shift: true });
        expect(s.selected()).toEqual(['c', 'd']);
        const t = mk();
        t.click(0);
        t.click(2, { ctrl: true });
        t.click(4, { ctrl: true, shift: true });
        expect(t.selected()).toEqual(['a', 'c', 'd', 'e']);
    });

    it('select all, clear, first and count', () => {
        const s = mk();
        s.selectAll();
        expect(s.count).toBe(5);
        expect(s.first()).toBe('a');
        s.clear();
        expect(s.selected()).toEqual([]);
        expect(s.first()).toBeNull();
    });

    it('a re-filtered list drops selected items that are gone', () => {
        const s = mk();
        s.selectAll();
        s.setItems(['b', 'x']);
        expect(s.selected()).toEqual(['b']);
    });
});

describe('selection actions', () => {
    it('selectedShips skips colony rows', () => {
        const rows = shipsAndBasesRows(empire, null, 'Construction Yards');
        expect(rows).toHaveLength(2);
        expect(selectedShips(rows)).toEqual([yard]);
    });

    it('Set Fleet needs a military ship; Retire / Refuel need mobile non-bases; Repair needs damage', () => {
        expect(shipsActionState([frigate])).toMatchObject({ setFleet: true, retire: true, refuel: true, repair: false, viewFleet: false });
        expect(shipsActionState([gasStation])).toMatchObject({ setFleet: false, retire: false, refuel: false, repair: false });
        const hurt = ship(S.Frigate, BuiltObjectRole.Military, { damagedComponentCount: 2, shipGroup: {} });
        expect(shipsActionState([hurt])).toMatchObject({ repair: true, viewFleet: true });
        expect(shipsActionState([])).toMatchObject({ setFleet: false, retire: false });
    });
});
