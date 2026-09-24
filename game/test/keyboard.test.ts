import { describe, expect, it } from 'vitest';
import {
    KEY_BINDINGS,
    buildDefaultHandlers,
    dispatchKey,
    findBinding,
    isTypingTarget,
} from '../src/ui/keyboard';
import { Camera } from '../src/render/camera';
import { GalaxyTime, START_STAR_DATE } from '../src/sim/galaxyTime';

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
        expect(dispatchKey(fakeEvent('Q'), handlers)).toBeNull();
        // A bound but unimplemented action still reports its action id.
        expect(dispatchKey(fakeEvent('L'), handlers)).toBe('lockView');
    });
});