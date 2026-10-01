// Left-drag box selection (src/render/boxSelect.ts): Main.Part10.cs 2989 mainView_MouseUp, Main.Part11.cs 1306
// method_141 / 1285 method_140, the Shift-click toggle (Main.Part10.cs 3158-3248), and the orders a BuiltObjectList
// selection gets (Main.Part8.cs 3707 action menu → Main.Part7.cs 1557 executeForBuiltObjectList).
import { beforeEach, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { BuiltObject } from '../src/sim/builtObject';
import type { GameData } from '../src/sim/data/gameData';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { BuiltObjectMissionType, builtObjectMission } from '../src/sim/missions/mission';
import { ShipGroup } from '../src/sim/fleets/shipGroup';
import { executeShipAction } from '../src/sim/player/executeShipAction';
import { buildActionMenu, type OrderMenuItem } from '../src/sim/player/orderMenu';
import { selectionTarget } from '../src/ui/orderMenu';
import {
    DRAG_THRESHOLD_PX,
    boxContains,
    isBoxSelectable,
    isDrag,
    objectsInBox,
    resolveBoxSelection,
    screenBox,
    shiftClickSelection,
    type BoxSelectable,
} from '../src/render/boxSelect';

const PLAYER = { name: 'player' };
const OTHER = { name: 'other' };

interface Fake extends BoxSelectable {
    id: string;
    x: number;
    y: number;
}
function fake(id: string, x: number, y: number, over: Partial<Fake> = {}): Fake {
    return { id, x, y, empire: PLAYER, owner: PLAYER, role: BuiltObjectRole.Military, unbuiltComponentCount: 0, hasBeenDestroyed: false, ...over };
}

describe('box geometry', () => {
    it('screenBox normalizes any drag direction (method_141 Math.Min / Math.Abs)', () => {
        expect(screenBox(50, 40, 10, 90)).toEqual({ x0: 10, y0: 40, x1: 50, y1: 90 });
        expect(screenBox(10, 90, 50, 40)).toEqual({ x0: 10, y0: 40, x1: 50, y1: 90 });
    });
    it('a move under 4 px is a click, 4 px or more a drag', () => {
        expect(DRAG_THRESHOLD_PX).toBe(4);
        expect(isDrag(0, 0, 3, 0)).toBe(false);
        expect(isDrag(0, 0, 2, 2)).toBe(false);
        expect(isDrag(0, 0, 4, 0)).toBe(true);
        expect(isDrag(0, 0, 3, 3)).toBe(true);
    });
    it('boxContains includes the edges', () => {
        const b = screenBox(10, 10, 20, 20);
        expect(boxContains(b, 10, 10)).toBe(true);
        expect(boxContains(b, 20, 20)).toBe(true);
        expect(boxContains(b, 15, 15)).toBe(true);
        expect(boxContains(b, 9.9, 15)).toBe(false);
        expect(boxContains(b, 15, 20.1)).toBe(false);
    });
    it('objectsInBox keeps live objects whose (drawn) screen position is inside and that pass the visibility test', () => {
        const a = fake('a', 5, 5);
        const b = fake('b', 50, 50);
        const dead = fake('dead', 6, 6, { hasBeenDestroyed: true });
        const hidden = fake('hidden', 7, 7, { empire: OTHER });
        const out = objectsInBox([a, b, null, dead, hidden], screenBox(0, 0, 10, 10), (o) => ({ x: o.x, y: o.y }), (o) => o.empire === PLAYER);
        expect(out.map((o) => o.id)).toEqual(['a']);
        // The position callback is what decides (render-interpolated position, not the committed one).
        const moved = objectsInBox([b], screenBox(0, 0, 10, 10), () => ({ x: 1, y: 1 }));
        expect(moved).toEqual([b]);
    });
});

describe('Main.Part11.cs 1285 method_140 — what a multi-selection keeps', () => {
    it('the player\'s state-owned, fully built non-base ships only', () => {
        expect(isBoxSelectable(fake('ship', 0, 0), PLAYER)).toBe(true);
        expect(isBoxSelectable(fake('civ', 0, 0, { role: BuiltObjectRole.Colony }), PLAYER)).toBe(true);
        expect(isBoxSelectable(fake('base', 0, 0, { role: BuiltObjectRole.Base }), PLAYER)).toBe(false);
        expect(isBoxSelectable(fake('private', 0, 0, { owner: null }), PLAYER)).toBe(false);
        expect(isBoxSelectable(fake('foreign', 0, 0, { empire: OTHER, owner: OTHER }), PLAYER)).toBe(false);
        expect(isBoxSelectable(fake('unbuilt', 0, 0, { unbuiltComponentCount: 2 }), PLAYER)).toBe(false);
    });
});

describe('Main.Part10.cs 2989 mainView_MouseUp — what a drag box selects', () => {
    const a = fake('a', 0, 0);
    const b = fake('b', 0, 0);
    const base = fake('base', 0, 0, { role: BuiltObjectRole.Base });
    const priv = fake('priv', 0, 0, { owner: null });
    const foreign = fake('foreign', 0, 0, { empire: OTHER, owner: OTHER });

    it('several objects: the method_140 ships among them', () => {
        expect(resolveBoxSelection([a, base, b, priv, foreign], PLAYER)).toEqual({ kind: 'list', ships: [a, b] });
    });
    it('several objects with one selectable ship: that ship (a normal single selection)', () => {
        expect(resolveBoxSelection([a, base, priv], PLAYER)).toEqual({ kind: 'single', builtObject: a });
    });
    it('several objects, none selectable: nothing selected', () => {
        expect(resolveBoxSelection([base, priv, foreign], PLAYER)).toEqual({ kind: 'clear' });
    });
    it('exactly one object: that object, whatever it is', () => {
        expect(resolveBoxSelection([foreign], PLAYER)).toEqual({ kind: 'single', builtObject: foreign });
        expect(resolveBoxSelection([base], PLAYER)).toEqual({ kind: 'single', builtObject: base });
    });
    it('an empty box: the object under the press point', () => {
        expect(resolveBoxSelection([], PLAYER)).toEqual({ kind: 'pickAtPress' });
    });
    it('Shift / Ctrl drag adds the selectable ships to the current ships (no duplicates)', () => {
        const c = fake('c', 0, 0);
        expect(resolveBoxSelection([b, c, base], PLAYER, true, [a, b])).toEqual({ kind: 'list', ships: [a, b, c] });
        expect(resolveBoxSelection([b], PLAYER, true, [a])).toEqual({ kind: 'list', ships: [a, b] });
        // A current selection that is not a method_140 ship (a base) is replaced.
        expect(resolveBoxSelection([b], PLAYER, true, [base])).toEqual({ kind: 'single', builtObject: b });
        // Nothing selectable in the box: the selection stays.
        expect(resolveBoxSelection([base, priv], PLAYER, true, [a])).toEqual({ kind: 'keep' });
        expect(resolveBoxSelection([], PLAYER, true, [a])).toEqual({ kind: 'keep' });
    });
});

describe('Main.Part10.cs 3158-3248 — Shift + left click toggles a ship in the selection', () => {
    const a = fake('a', 0, 0);
    const b = fake('b', 0, 0);
    const c = fake('c', 0, 0);
    const base = fake('base', 0, 0, { role: BuiltObjectRole.Base });
    it('a list: the clicked ship is added, or removed when already in it', () => {
        expect(shiftClickSelection([a, b], [c], PLAYER)).toEqual([a, b, c]);
        expect(shiftClickSelection([a, b, c], [b], PLAYER)).toEqual([a, c]);
        // Down to one ship: a single selection.
        expect(shiftClickSelection([a, b], [b], PLAYER)).toBe(a);
    });
    it('one selectable ship: it stays first and the clicked one joins; clicking it again clears', () => {
        expect(shiftClickSelection(a, [b], PLAYER)).toEqual([a, b]);
        expect(shiftClickSelection(a, [a], PLAYER)).toBeNull();
    });
    it('anything else selected: the clicked ship', () => {
        expect(shiftClickSelection(base, [a], PLAYER)).toBe(a);
        expect(shiftClickSelection(null, [a], PLAYER)).toBe(a);
    });
    it('clicking something that is not a method_140 ship changes nothing', () => {
        expect(shiftClickSelection([a, b], [base], PLAYER)).toBeUndefined();
        expect(shiftClickSelection([a, b], [], PLAYER)).toBeUndefined();
    });
});

describe('a BuiltObjectList selection gets the list orders (Main.Part8.cs 3707 / Main.Part7.cs 1557)', () => {
    let gameData: GameData;
    let galaxy: Galaxy;
    let player: Empire;
    beforeEach(async () => {
        gameData ??= await loadGameDataFs();
        galaxy = cachedTickGame(gameData).galaxy;
        player = galaxy.playerEmpire!;
    });
    function selectableShips(n: number): BuiltObject[] {
        const list = player.builtObjects.filter((b) => isBoxSelectable(b, player) && b.builtAt === null && b.topSpeed > 0).slice(0, n);
        expect(list.length).toBe(n);
        for (const s of list) {
            s.role = BuiltObjectRole.Military;
            s.subRole = BuiltObjectSubRole.Frigate;
        }
        return list;
    }
    function walk(items: OrderMenuItem[]): OrderMenuItem[] {
        return items.flatMap((i) => [i, ...walk(i.children)]);
    }

    it('the HUD selection hands the order layer the ship list itself', () => {
        const ships = selectableShips(2);
        const sel = { habitat: player.capital!, builtObjects: ships };
        expect(selectionTarget(sel)).toBe(ships);
    });

    it('a move order from the action menu goes to every selected ship', () => {
        const ships = selectableShips(3);
        const items = buildActionMenu({ galaxy, empire: player, selected: ships, cursorX: 123456, cursorY: 654321, zoomFactor: 1, pickAt: () => null });
        const move = walk(items).find((i) => i.action !== null && i.action.missionType === BuiltObjectMissionType.Move);
        expect(move).toBeDefined();
        const r = executeShipAction(galaxy, player, ships, move!.action!, true);
        expect(r.ok).toBe(true);
        for (const s of ships) expect(builtObjectMission(s.mission)?.type).toBe(BuiltObjectMissionType.Move);
    });

    it('Join Fleet → (New Fleet) forms one fleet of the selected ships and selects it', () => {
        const ships = selectableShips(3);
        for (const s of ships) expect(s.shipGroup).toBeNull();
        const items = buildActionMenu({ galaxy, empire: player, selected: ships, cursorX: 0, cursorY: 0, zoomFactor: 1, pickAt: () => null });
        const newFleet = walk(items).find((i) => i.key === 'New Fleet');
        expect(newFleet).toBeDefined();
        const r = executeShipAction(galaxy, player, ships, newFleet!.action!, true);
        expect(r.select).toBeInstanceOf(ShipGroup);
        const fleet = r.select as ShipGroup;
        expect(fleet.ships.length).toBe(3);
        for (const s of ships) expect(s.shipGroup).toBe(fleet);
    });
});
