import { describe, expect, it } from 'vitest';
import {
    IMPLEMENTED_KEY_ACTIONS,
    KEY_BINDINGS,
    buildDefaultHandlers,
    cycleActionArgs,
    dispatchKey,
    findBinding,
    isKeyActionAvailable,
    isTypingTarget,
} from '../src/ui/keyboard';
import { Camera } from '../src/render/camera';
import { GalaxyTime, START_STAR_DATE } from '../src/sim/galaxyTime';
import { setSelection, SYSTEM_LEVEL_ZOOM } from '../src/ui/hud';
import type { Habitat, SystemInfo } from '../src/sim/types';

// Task 10a: the key-binding table mirrors the original's UI_KeyboardCommands
// help table (verbatim in tasks/10a-keyboard.md). These tests are pure — no
// DOM needed beyond the typing-target check (HTMLElement exists in vitest's
// node environment? No: we construct targets as plain objects and cast).

/** Minimal stand-in for a KeyboardEvent. */
function fakeEvent(
    key: string,
    target: unknown = null,
    mods: { ctrl?: boolean; alt?: boolean; shift?: boolean } = {},
): Parameters<typeof dispatchKey>[0] {
    return {
        key,
        ctrlKey: !!mods.ctrl,
        altKey: !!mods.alt,
        shiftKey: !!mods.shift,
        target: target as EventTarget,
    };
}

describe('KEY_BINDINGS table (task 10a)', () => {
    // Every row of the source table, keyed by the action id this port uses.
    const EXPECTED_ACTIONS = [
        'galactopediaHelp',
        'coloniesScreen',
        'expansionPlannerScreen',
        'intelligenceAgentsScreen',
        'diplomacyScreen',
        'empireSummaryScreen',
        'researchScreen',
        'shipDesignsScreen',
        'buildOrderScreen',
        'constructionYardsScreen',
        'shipsAndBasesScreen',
        'fleetsScreen',
        'galaxyMap',
        'messageHistoryScreen',
        'empireComparisonScreen',
        'gameOptionsScreen',
        'togglePause',
        'gameMenu',
        'scrollUp',
        'scrollDown',
        'scrollLeft',
        'scrollRight',
        'zoomToSelection',
        'zoomSystemLevel',
        'zoomSectorLevel',
        'zoomGalaxyLevel',
        'zoomPlanetLevel',
        'zoomOut',
        'zoomIn',
        'speedUp',
        'speedDown',
        'selectionForward',
        'selectionBackward',
        'lockView',
        'selectNearestMilitaryShip',
        'cycleColonies',
        'cycleSpacePorts',
        'cycleMilitaryShips',
        'cycleConstructionShips',
        'cycleExplorationShips',
        'cycleFleets',
        'cycleIdleShips',
        'commandEscape',
        'commandRefuel',
        'automateShip',
        'stopShip',
        'cycleEngagementStance',
        'ctrlWithZoomKeys',
    ];

    it('has one binding per source-table action', () => {
        const actions = new Set(KEY_BINDINGS.map((b) => b.action));
        for (const a of EXPECTED_ACTIONS) {
            expect(actions.has(a), `missing action ${a}`).toBe(true);
        }
    });

    it('maps each source-table key to its action', () => {
        const cases: Array<[string, string] | [string, string, Partial<{ ctrl: boolean; alt: boolean; shift: boolean }>]> = [
            ['F1', 'galactopediaHelp'],
            ['F2', 'coloniesScreen'],
            ['F3', 'expansionPlannerScreen'],
            ['F4', 'intelligenceAgentsScreen'],
            ['F5', 'diplomacyScreen'],
            ['F6', 'empireSummaryScreen'],
            ['F7', 'researchScreen'],
            ['F8', 'shipDesignsScreen'],
            ['F9', 'buildOrderScreen'],
            ['F10', 'constructionYardsScreen'],
            ['F11', 'shipsAndBasesScreen'],
            ['F12', 'fleetsScreen'],
            ['G', 'galaxyMap'],
            ['H', 'messageHistoryScreen'],
            ['V', 'empireComparisonScreen'],
            ['O', 'gameOptionsScreen'],
            ['Pause', 'togglePause'],
            ['Space', 'togglePause'],
            ['Escape', 'gameMenu'],
            ['ArrowUp', 'scrollUp'],
            ['ArrowDown', 'scrollDown'],
            ['ArrowLeft', 'scrollLeft'],
            ['ArrowRight', 'scrollRight'],
            ['Backspace', 'zoomToSelection'],
            ['Insert', 'zoomSystemLevel'],
            ['Delete', 'zoomSectorLevel'],
            ['End', 'zoomGalaxyLevel'],
            ['Home', 'zoomPlanetLevel'],
            ['PageUp', 'zoomOut'],
            ['PageDown', 'zoomIn'],
            ['+', 'speedUp'],
            ['-', 'speedDown'],
            ['N', 'selectionForward'],
            ['B', 'selectionBackward'],
            ['L', 'lockView'],
            ['Z', 'selectNearestMilitaryShip'],
            ['C', 'cycleColonies'],
            ['P', 'cycleSpacePorts'],
            ['M', 'cycleMilitaryShips'],
            ['Y', 'cycleConstructionShips'],
            ['X', 'cycleExplorationShips'],
            ['F', 'cycleFleets'],
            ['I', 'cycleIdleShips'],
            ['E', 'commandEscape'],
            ['R', 'commandRefuel'],
            ['A', 'automateShip'],
            ['S', 'stopShip'],
            [',', 'cycleEngagementStance'],
        ];
        for (const [key, action, mods = {}] of cases) {
            const b = findBinding(key, {
                ctrl: !!mods.ctrl,
                alt: !!mods.alt,
                shift: !!mods.shift,
            });
            expect(b?.action, `key ${key} -> ${action}`).toBe(action);
        }
    });

    it('has the Shift/Ctrl variants of the cycler keys', () => {
        for (const key of ['C', 'P', 'M', 'Y', 'X', 'F', 'I']) {
            expect(findBinding(key, { ctrl: false, alt: false, shift: true })?.action.endsWith('Backward')).toBe(true);
            expect(findBinding(key, { ctrl: true, alt: false, shift: false })?.action.endsWith('MoveView')).toBe(true);
        }
    });

    it('no two bindings share key + modifiers', () => {
        const seen = new Set<string>();
        for (const b of KEY_BINDINGS) {
            const id = `${b.key}|${b.modifiers.ctrl ? 'c' : ''}${b.modifiers.alt ? 'a' : ''}${b.modifiers.shift ? 's' : ''}`;
            expect(seen.has(id), `duplicate binding ${id}`).toBe(false);
            seen.add(id);
        }
    });

    it('every binding has a non-empty description', () => {
        for (const b of KEY_BINDINGS) {
            expect(b.description.length, `description for ${b.key}/${b.action}`).toBeGreaterThan(0);
        }
    });
});

describe('dispatchKey (task 10a)', () => {
    function makeClock(): GalaxyTime {
        return new GalaxyTime(START_STAR_DATE);
    }

    it('toggles pause on Space and Pause', () => {
        const time = makeClock();
        const handlers = buildDefaultHandlers(new Camera(), time);
        expect(time.paused).toBe(true);
        expect(dispatchKey(fakeEvent('Space'), handlers)).toBe('togglePause');
        expect(time.paused).toBe(false);
        expect(dispatchKey(fakeEvent('Pause'), handlers)).toBe('togglePause');
        expect(time.paused).toBe(true);
        // fix4ui: the space bar's real KeyboardEvent.key is ' '.
        expect(dispatchKey(fakeEvent(' '), handlers)).toBe('togglePause');
        expect(time.paused).toBe(false);
    });

    it('changes game speed with + / -', () => {
        const time = makeClock();
        const handlers = buildDefaultHandlers(new Camera(), time);
        dispatchKey(fakeEvent('+'), handlers);
        expect(time.speed).toBe(2);
        dispatchKey(fakeEvent('-'), handlers);
        expect(time.speed).toBe(1);
    });

    it('zooms in/out and to level views via the camera', () => {
        const cam = new Camera();
        cam.setViewport(1000, 1000);
        cam.zoom = 0.1;
        const handlers = buildDefaultHandlers(cam, makeClock());
        dispatchKey(fakeEvent('PageDown'), handlers); // zoom in
        expect(cam.zoom).toBeCloseTo(0.3);
        dispatchKey(fakeEvent('PageUp'), handlers); // zoom out
        expect(cam.zoom).toBeCloseTo(0.1);
        dispatchKey(fakeEvent('End'), handlers); // galaxy level
        expect(cam.zoom).toBeLessThan(0.0001);
        dispatchKey(fakeEvent('Home'), handlers); // 100%
        expect(cam.zoom).toBe(1);
    });

    it('zooms to the selection (Backspace) via the shared zoom function', () => {
        const cam = new Camera();
        cam.setViewport(1000, 1000);
        cam.x = 0;
        cam.y = 0;
        const handlers = buildDefaultHandlers(cam, makeClock());
        // No selection: Backspace is a no-op.
        setSelection(null);
        expect(dispatchKey(fakeEvent('Backspace'), handlers)).toBe('zoomToSelection');
        expect(cam.x).toBe(0);
        expect(cam.zoom).toBe(1);
        // With a selection: btnZoomSelection_Click — centres on the habitat and
        // zooms to 100 % (method_157 + method_4(1.0)).
        const habitat = { xpos: 42, ypos: -7 } as unknown as Habitat;
        setSelection({ habitat, system: {} as SystemInfo });
        expect(dispatchKey(fakeEvent('Backspace'), handlers)).toBe('zoomToSelection');
        expect(cam.x).toBe(42);
        expect(cam.y).toBe(-7);
        expect(cam.zoom).toBe(1);
        cam.zoom = SYSTEM_LEVEL_ZOOM;
        dispatchKey(fakeEvent('Backspace'), handlers);
        expect(cam.zoom).toBe(1);
        expect(cam.x).toBe(42);
        setSelection(null);
    });

    it('zooms to the whole galaxy with G (minZoom) and centres on its middle', () => {
        const cam = new Camera();
        cam.setViewport(1000, 1000);
        cam.setGalaxyBounds(2000, 800); // minZoom = min(0.5, 1.25) * 0.9
        cam.x = 0;
        cam.y = 0;
        cam.zoom = 1;
        const handlers = buildDefaultHandlers(cam, makeClock(), { width: 2000, height: 800 });
        expect(dispatchKey(fakeEvent('G'), handlers)).toBe('galaxyMap');
        expect(cam.zoom).toBeCloseTo(cam.minZoom);
        expect(cam.x).toBe(1000);
        expect(cam.y).toBe(400);
    });

    it('zooms out only when G is pressed without a galaxy size', () => {
        const cam = new Camera();
        cam.setViewport(1000, 1000);
        cam.setGalaxyBounds(2000, 800);
        cam.x = 5;
        cam.y = -3;
        cam.zoom = 1;
        const handlers = buildDefaultHandlers(cam, makeClock());
        expect(dispatchKey(fakeEvent('G'), handlers)).toBe('galaxyMap');
        expect(cam.zoom).toBeCloseTo(cam.minZoom);
        // No centreing without a galaxy size.
        expect(cam.x).toBe(5);
        expect(cam.y).toBe(-3);
    });

    it('pans the camera with the arrow keys', () => {
        const cam = new Camera();
        cam.setViewport(1000, 1000);
        cam.x = 0;
        cam.y = 0;
        const handlers = buildDefaultHandlers(cam, makeClock());
        dispatchKey(fakeEvent('ArrowRight'), handlers);
        // ArrowRight scrolls the view right: with grab-the-world panning
        // (Camera.panByScreen), that moves the camera centre to +x.
        expect(cam.x).toBeGreaterThan(0);
        dispatchKey(fakeEvent('ArrowUp'), handlers);
        expect(cam.y).toBeLessThan(0);
    });

    it('ignores events while focus is in an input or textarea', () => {
        const time = makeClock();
        const handlers = buildDefaultHandlers(new Camera(), time);
        const input = { tagName: 'INPUT', isContentEditable: false } as unknown as EventTarget;
        const textarea = { tagName: 'TEXTAREA', isContentEditable: false } as unknown as EventTarget;
        const editable = { tagName: 'DIV', isContentEditable: true } as unknown as EventTarget;
        expect(isTypingTarget(input)).toBe(true);
        expect(isTypingTarget(textarea)).toBe(true);
        expect(isTypingTarget(editable)).toBe(true);
        expect(isTypingTarget(null)).toBe(false);
        expect(isTypingTarget({} as EventTarget)).toBe(false);
        // While typing, even a bound key does nothing.
        expect(dispatchKey(fakeEvent('Space', input), handlers)).toBeNull();
        expect(time.paused).toBe(true);
        expect(dispatchKey(fakeEvent('Space', textarea), handlers)).toBeNull();
        expect(dispatchKey(fakeEvent('Space', editable), handlers)).toBeNull();
    });

    it('returns null for unbound keys and runs TODO actions inertly', () => {
        const handlers = buildDefaultHandlers(new Camera(), makeClock());
        expect(dispatchKey(fakeEvent('U'), handlers)).toBeNull(); // W: the waypoint key (an Improvement)
        // A bound but unimplemented action still reports its action id.
        expect(dispatchKey(fakeEvent('L'), handlers)).toBe('lockView');
    });

    it('dispatches H to the message history handler (task 12i)', () => {
        const handlers = buildDefaultHandlers(new Camera(), makeClock());
        expect(dispatchKey(fakeEvent('H'), handlers)).toBe('messageHistoryScreen');
    });
});

// Task 12q: which shortcut rows do something today.
describe('isKeyActionAvailable (task 12q)', () => {
    it('marks implemented actions as available', () => {
        expect(isKeyActionAvailable('togglePause')).toBe(true);
        expect(isKeyActionAvailable('coloniesScreen')).toBe(true);
        expect(isKeyActionAvailable('cycleColoniesMoveView')).toBe(true);
    });

    it('marks unimplemented actions as unavailable', () => {
        // intel + fix6ui: F4, the ship-order keys and the selection keys are all implemented now.
        expect(isKeyActionAvailable('intelligenceAgentsScreen')).toBe(true);
        expect(isKeyActionAvailable('lockView')).toBe(true);
        expect(isKeyActionAvailable('commandRefuel')).toBe(true);
        expect(isKeyActionAvailable('nonsense')).toBe(false);
    });

    it('every implemented action appears in KEY_BINDINGS (catches typos)', () => {
        const actions = new Set(KEY_BINDINGS.map((b) => b.action));
        for (const a of IMPLEMENTED_KEY_ACTIONS) {
            expect(actions.has(a), `IMPLEMENTED_KEY_ACTIONS entry ${a} has no binding`).toBe(true);
        }
    });

    it('bound keys resolve to actions that are available now (L = lockView since fix6ui)', () => {
        const action = dispatchKey(
            { key: 'L', ctrlKey: false, altKey: false, shiftKey: false, target: null },
            {},
        );
        expect(action).toBe('lockView');
        expect(isKeyActionAvailable(action!)).toBe(true);
        expect(isKeyActionAvailable('nonsense')).toBe(false);
    });
});
describe('findBinding letter case', () => {
    it('matches unshifted lowercase letters to the uppercase table keys', () => {
        const none = { ctrl: false, alt: false, shift: false };
        expect(findBinding('g', none)?.action).toBe('galaxyMap');
        expect(findBinding('G', none)?.action).toBe('galaxyMap');
    });
});

// Task 12n: cycleActionArgs decodes the C/P/M/Y/X/F/I binding actions into
// cycler arguments (pure — no DOM needed).
describe('cycleActionArgs (task 12n)', () => {
    it('maps each prefix to its cycle kind', () => {
        expect(cycleActionArgs('cycleColonies')).toEqual({ kind: 'colonies', dir: 1, moveView: false });
        expect(cycleActionArgs('cycleSpacePorts')).toEqual({ kind: 'bases', dir: 1, moveView: false });
        expect(cycleActionArgs('cycleMilitaryShips')).toEqual({ kind: 'military', dir: 1, moveView: false });
        expect(cycleActionArgs('cycleConstructionShips')).toEqual({ kind: 'construction', dir: 1, moveView: false });
        expect(cycleActionArgs('cycleExplorationShips')).toEqual({ kind: 'other', dir: 1, moveView: false });
        expect(cycleActionArgs('cycleFleets')).toEqual({ kind: 'fleets', dir: 1, moveView: false });
        expect(cycleActionArgs('cycleIdleShips')).toEqual({ kind: 'idleShips', dir: 1, moveView: false });
    });

    it('Backward suffix cycles backwards without moving the view', () => {
        expect(cycleActionArgs('cycleColoniesBackward')).toEqual({ kind: 'colonies', dir: -1, moveView: false });
        expect(cycleActionArgs('cycleFleetsBackward')).toEqual({ kind: 'fleets', dir: -1, moveView: false });
    });

    it('MoveView suffix cycles forward and moves the view', () => {
        expect(cycleActionArgs('cycleFleetsMoveView')).toEqual({ kind: 'fleets', dir: 1, moveView: true });
        expect(cycleActionArgs('cycleColoniesMoveView')).toEqual({ kind: 'colonies', dir: 1, moveView: true });
    });

    it('returns null for non-cycler or unknown actions', () => {
        expect(cycleActionArgs('cycleEngagementStance')).toBeNull();
        expect(cycleActionArgs('zoomIn')).toBeNull();
        expect(cycleActionArgs('togglePause')).toBeNull();
        expect(cycleActionArgs('cycleSomethingElse')).toBeNull();
    });
});
