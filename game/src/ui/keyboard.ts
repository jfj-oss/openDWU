// Keyboard shortcuts (task 10a): the original's keyboard command table
// (UI_KeyboardCommands, verbatim in tasks/10a-keyboard.md) as a binding list
// plus a keydown dispatcher. Actions that exist today (pause/resume, game
// speed, zoom in/out and zoom levels, Galaxy Map, Esc) are wired to real
// handlers; every other action is registered but inert via console.info.

import { Camera } from '../render/camera';
import { GalaxyTime } from '../sim/clock';
import {
    GALAXY_LEVEL_ZOOM,
    PLANET_LEVEL_ZOOM,
    SECTOR_LEVEL_ZOOM,
    SYSTEM_LEVEL_ZOOM,
} from './hud';

/** Modifier state of a key event (Ctrl/Alt/Shift). */
export interface KeyModifiers {
    ctrl: boolean;
    alt: boolean;
    shift: boolean;
}

/** One row of the original's keyboard command table. `key` is the DOM
 * `KeyboardEvent.key` value (letters upper-case, e.g. 'F1', 'G', 'Escape',
 * 'PageUp', '+', ',', 'ArrowLeft'). */
export interface KeyBinding {
    key: string;
    modifiers: KeyModifiers;
    /** Stable action id (e.g. 'togglePause', 'zoomIn', 'cycleColonies'). */
    action: string;
    /** Verbatim description from the original's help table. */
    description: string;
}

const NONE: KeyModifiers = { ctrl: false, alt: false, shift: false };
const SHIFT: KeyModifiers = { ctrl: false, alt: false, shift: true };
const CTRL: KeyModifiers = { ctrl: true, alt: false, shift: false };
const ALT: KeyModifiers = { ctrl: false, alt: true, shift: false };

/** The complete original keyboard command table (UI_KeyboardCommands).
 * Rows with modifier variants (C/P/M/Y/X/F/I cycling) get one entry per
 * variant: plain, Shift (cycles backwards), Ctrl (cycles + moves view).
 * The right-click rows and the "Ctrl with zoom keys" note are mouse
 * interactions — no key exists for them, so they have no binding row. */
export const KEY_BINDINGS: KeyBinding[] = [
    { key: 'F1', modifiers: NONE, action: 'galactopediaHelp', description: 'Galactopedia Help screen' },
    { key: 'F2', modifiers: NONE, action: 'coloniesScreen', description: 'Colonies screen' },
    { key: 'F3', modifiers: NONE, action: 'expansionPlannerScreen', description: 'Expansion Planner screen' },
    { key: 'F4', modifiers: NONE, action: 'intelligenceAgentsScreen', description: 'Intelligence Agents screen' },
    { key: 'F5', modifiers: NONE, action: 'diplomacyScreen', description: 'Diplomacy screen' },
    { key: 'F6', modifiers: NONE, action: 'empireSummaryScreen', description: 'Your Empire Summary screen' },
    { key: 'F7', modifiers: NONE, action: 'researchScreen', description: 'Research screen' },
    { key: 'F8', modifiers: NONE, action: 'shipDesignsScreen', description: 'Ship Designs screen' },
    { key: 'F9', modifiers: NONE, action: 'buildOrderScreen', description: 'Build Order screen' },
    { key: 'F10', modifiers: NONE, action: 'constructionYardsScreen', description: 'Construction Yards screen' },
    { key: 'F11', modifiers: NONE, action: 'shipsAndBasesScreen', description: 'Ships and Bases screen' },
    { key: 'F12', modifiers: NONE, action: 'fleetsScreen', description: 'Fleets screen' },
    { key: 'G', modifiers: NONE, action: 'galaxyMap', description: 'Galaxy Map screen' },
    { key: 'H', modifiers: NONE, action: 'messageHistoryScreen', description: 'Message History screen' },
    { key: 'V', modifiers: NONE, action: 'empireComparisonScreen', description: 'Empire Comparison and Victory Conditions screen' },
    { key: 'O', modifiers: NONE, action: 'gameOptionsScreen', description: 'Game Options screen' },
    // "Pause or Spacebar": both keys pause/resume.
    { key: 'Pause', modifiers: NONE, action: 'togglePause', description: 'Pauses or resumes the game' },
    { key: 'Space', modifiers: NONE, action: 'togglePause', description: 'Pauses or resumes the game' },
    { key: 'Escape', modifiers: NONE, action: 'gameMenu', description: 'Displays the Game menu' },
    { key: 'ArrowUp', modifiers: NONE, action: 'scrollUp', description: 'Scrolls the main view up/down/left/right' },
    { key: 'ArrowDown', modifiers: NONE, action: 'scrollDown', description: 'Scrolls the main view up/down/left/right' },
    { key: 'ArrowLeft', modifiers: NONE, action: 'scrollLeft', description: 'Scrolls the main view up/down/left/right' },
    { key: 'ArrowRight', modifiers: NONE, action: 'scrollRight', description: 'Scrolls the main view up/down/left/right' },
    { key: 'Backspace', modifiers: NONE, action: 'zoomToSelection', description: 'Zooms to the selected item' },
    { key: 'Insert', modifiers: NONE, action: 'zoomSystemLevel', description: 'Zooms the main view to System level' },
    { key: 'Delete', modifiers: NONE, action: 'zoomSectorLevel', description: 'Zooms the main view to Sector level' },
    { key: 'End', modifiers: NONE, action: 'zoomGalaxyLevel', description: 'Zooms the main view to Galaxy level' },
    { key: 'Home', modifiers: NONE, action: 'zoomPlanetLevel', description: 'Zooms the main view to 100%' },
    { key: 'PageUp', modifiers: NONE, action: 'zoomOut', description: 'Zooms the main view Out' },
    { key: 'PageDown', modifiers: NONE, action: 'zoomIn', description: 'Zooms the main view In' },
    { key: '+', modifiers: NONE, action: 'speedUp', description: 'Increases game speed by one level' },
    { key: '-', modifiers: NONE, action: 'speedDown', description: 'Decreases game speed by one level' },
    { key: 'N', modifiers: NONE, action: 'selectionForward', description: 'Move forward in selection history' },
    { key: 'B', modifiers: NONE, action: 'selectionBackward', description: 'Move backward in selection history' },
    { key: 'L', modifiers: NONE, action: 'lockView', description: 'Locks/unlocks the main view on the currently selected item' },
    { key: 'Z', modifiers: NONE, action: 'selectNearestMilitaryShip', description: 'Selects the nearest available military ship to the current location' },
    // C/P/M/Y/X/F/I: plain cycles, Shift cycles backwards, Ctrl cycles +
    // moves view (the original's three variants of each cycler).
    { key: 'C', modifiers: NONE, action: 'cycleColonies', description: 'Cycles your Colonies in the selection panel (Shift cycles backwards, Ctrl cycles and moves view)' },
    { key: 'C', modifiers: SHIFT, action: 'cycleColoniesBackward', description: 'Cycles your Colonies in the selection panel (Shift cycles backwards, Ctrl cycles and moves view)' },
    { key: 'C', modifiers: CTRL, action: 'cycleColoniesMoveView', description: 'Cycles your Colonies in the selection panel (Shift cycles backwards, Ctrl cycles and moves view)' },
    { key: 'P', modifiers: NONE, action: 'cycleSpacePorts', description: 'Cycles your Space Ports in the selection panel (Shift backwards, Ctrl cycles + moves view)' },
    { key: 'P', modifiers: SHIFT, action: 'cycleSpacePortsBackward', description: 'Cycles your Space Ports in the selection panel (Shift backwards, Ctrl cycles + moves view)' },
    { key: 'P', modifiers: CTRL, action: 'cycleSpacePortsMoveView', description: 'Cycles your Space Ports in the selection panel (Shift backwards, Ctrl cycles + moves view)' },
    { key: 'M', modifiers: NONE, action: 'cycleMilitaryShips', description: 'Cycles your Military ships (same modifiers)' },
    { key: 'M', modifiers: SHIFT, action: 'cycleMilitaryShipsBackward', description: 'Cycles your Military ships (same modifiers)' },
    { key: 'M', modifiers: CTRL, action: 'cycleMilitaryShipsMoveView', description: 'Cycles your Military ships (same modifiers)' },
    { key: 'Y', modifiers: NONE, action: 'cycleConstructionShips', description: 'Cycles your Construction ships (same modifiers)' },
    { key: 'Y', modifiers: SHIFT, action: 'cycleConstructionShipsBackward', description: 'Cycles your Construction ships (same modifiers)' },
    { key: 'Y', modifiers: CTRL, action: 'cycleConstructionShipsMoveView', description: 'Cycles your Construction ships (same modifiers)' },
    { key: 'X', modifiers: NONE, action: 'cycleExplorationShips', description: 'Cycles your Exploration and Colony ships (same modifiers)' },
    { key: 'X', modifiers: SHIFT, action: 'cycleExplorationShipsBackward', description: 'Cycles your Exploration and Colony ships (same modifiers)' },
    { key: 'X', modifiers: CTRL, action: 'cycleExplorationShipsMoveView', description: 'Cycles your Exploration and Colony ships (same modifiers)' },
    { key: 'F', modifiers: NONE, action: 'cycleFleets', description: 'Cycles your Fleets (same modifiers)' },
    { key: 'F', modifiers: SHIFT, action: 'cycleFleetsBackward', description: 'Cycles your Fleets (same modifiers)' },
    { key: 'F', modifiers: CTRL, action: 'cycleFleetsMoveView', description: 'Cycles your Fleets (same modifiers)' },
    { key: 'I', modifiers: NONE, action: 'cycleIdleShips', description: 'Cycles your Idle ships (same modifiers)' },
    { key: 'I', modifiers: SHIFT, action: 'cycleIdleShipsBackward', description: 'Cycles your Idle ships (same modifiers)' },
    { key: 'I', modifiers: CTRL, action: 'cycleIdleShipsMoveView', description: 'Cycles your Idle ships (same modifiers)' },
    { key: 'E', modifiers: NONE, action: 'commandEscape', description: 'Commands the selected ship to Escape from attackers' },
    { key: 'R', modifiers: NONE, action: 'commandRefuel', description: 'Commands the selected ship to Refuel at the nearest refueling point' },
    { key: 'A', modifiers: NONE, action: 'automateShip', description: 'Automates the selected ship' },
    { key: 'S', modifiers: NONE, action: 'stopShip', description: 'Stops the selected ship, cancelling the current mission' },
    { key: ',', modifiers: NONE, action: 'cycleEngagementStance', description: 'Cycles the engagement stance of the selected ship ("Cycles the engagement stance of the selected ship or fleet")' },
    // Right-click rows (Bombard/Capture, Raid, Full mission popup, Zoom to
    // location) are mouse commands — see the table in tasks/10a-keyboard.md.
    { key: 'Control', modifiers: NONE, action: 'ctrlWithZoomKeys', description: 'Ctrl (with zoom keys/buttons) — cycles-and-moves variants of C/P/M/Y/X/F/I' },
];

/** Handlers for the actions that exist today. Anything missing falls back
 * to `console.info('TODO(key): <action>')`. */
export interface KeyHandlers {
    togglePause?: () => void;
    speedUp?: () => void;
    speedDown?: () => void;
    zoomIn?: () => void;
    zoomOut?: () => void;
    zoomToSelection?: () => void;
    zoomSystemLevel?: () => void;
    zoomSectorLevel?: () => void;
    zoomGalaxyLevel?: () => void;
    zoomPlanetLevel?: () => void;
    scrollUp?: () => void;
    scrollDown?: () => void;
    scrollLeft?: () => void;
    scrollRight?: () => void;
    galaxyMap?: () => void;
    gameMenu?: () => void;
}

/** True when focus is inside an input/textarea/contenteditable element.
 * Duck-typed (no `instanceof HTMLElement`) so the dispatcher stays usable in
 * node-based tests where DOM globals are absent. */
export function isTypingTarget(target: EventTarget | null): boolean {
    const el = target as Partial<Pick<HTMLElement, 'tagName' | 'isContentEditable'>> | null;
    if (!el || typeof el.tagName !== 'string') return false;
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return true;
    return !!el.isContentEditable;
}

/** Find the binding for a key+modifiers combo, or null. */
export function findBinding(
    key: string,
    mods: KeyModifiers,
    bindings: KeyBinding[] = KEY_BINDINGS,
): KeyBinding | null {
    for (const b of bindings) {
        if (b.key !== key) continue;
        if (b.modifiers.ctrl !== mods.ctrl) continue;
        if (b.modifiers.alt !== mods.alt) continue;
        if (b.modifiers.shift !== mods.shift) continue;
        return b;
    }
    return null;
}

/** Dispatch a keydown event through the binding table. Returns the action
 * id that ran (or null when nothing matched / typing was ignored), so tests
 * can assert on it without spying on handlers. */
export function dispatchKey(
    event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'target'>,
    handlers: KeyHandlers,
    bindings: KeyBinding[] = KEY_BINDINGS,
): string | null {
    if (isTypingTarget(event.target)) return null;
    const binding = findBinding(event.key, {
        ctrl: event.ctrlKey,
        alt: event.altKey,
        shift: event.shiftKey,
    }, bindings);
    if (!binding) return null;
    switch (binding.action) {
        case 'togglePause':
            handlers.togglePause?.();
            break;
        case 'speedUp':
            handlers.speedUp?.();
            break;
        case 'speedDown':
            handlers.speedDown?.();
            break;
        case 'zoomIn':
            handlers.zoomIn?.();
            break;
        case 'zoomOut':
            handlers.zoomOut?.();
            break;
        case 'zoomToSelection':
            handlers.zoomToSelection?.();
            break;
        case 'zoomSystemLevel':
            handlers.zoomSystemLevel?.();
            break;
        case 'zoomSectorLevel':
            handlers.zoomSectorLevel?.();
            break;
        case 'zoomGalaxyLevel':
            handlers.zoomGalaxyLevel?.();
            break;
        case 'zoomPlanetLevel':
            handlers.zoomPlanetLevel?.();
            break;
        case 'scrollUp':
            handlers.scrollUp?.();
            break;
        case 'scrollDown':
            handlers.scrollDown?.();
            break;
        case 'scrollLeft':
            handlers.scrollLeft?.();
            break;
        case 'scrollRight':
            handlers.scrollRight?.();
            break;
        case 'galaxyMap':
            handlers.galaxyMap?.();
            break;
        case 'gameMenu':
            handlers.gameMenu?.();
            break;
        default:
            // Registered but not implemented yet.
            console.info(`TODO(key): ${binding.action}`);
            break;
    }
    return binding.action;
}

/** Build the standard handler set from the camera + clock (the same camera
 * calls the HUD options list uses, Main.Part11.cs zoom behaviour). */
export function buildDefaultHandlers(camera: Camera, time: GalaxyTime): KeyHandlers {
    const cx = (): number => camera.width / 2;
    const cy = (): number => camera.height / 2;
    return {
        togglePause: () => time.togglePause(),
        speedUp: () => time.faster(),
        speedDown: () => time.slower(),
        // PageUp/PageDown: discrete zoom steps (Main.Part11.cs zoomStep).
        zoomIn: () => camera.zoomStep(1),
        zoomOut: () => camera.zoomStep(-1),
        zoomToSelection: () => {
            // TODO(port): zoom to the selected item — needs the selection hook.
            console.info('TODO(key): zoomToSelection');
        },
        zoomSystemLevel: () => camera.zoomAt(SYSTEM_LEVEL_ZOOM, cx(), cy()),
        zoomSectorLevel: () => camera.zoomAt(SECTOR_LEVEL_ZOOM, cx(), cy()),
        zoomGalaxyLevel: () => camera.zoomAt(GALAXY_LEVEL_ZOOM, cx(), cy()),
        zoomPlanetLevel: () => camera.zoomAt(PLANET_LEVEL_ZOOM, cx(), cy()),
        scrollUp: () => camera.panByScreen(0, SCROLL_PAN_PX),
        scrollDown: () => camera.panByScreen(0, -SCROLL_PAN_PX),
        scrollLeft: () => camera.panByScreen(SCROLL_PAN_PX, 0),
        scrollRight: () => camera.panByScreen(-SCROLL_PAN_PX, 0),
        // TODO(key): open the Galaxy Map screen (no openGalaxyMap hook today;
        // the View-list row only zooms out to galaxy level).
        galaxyMap: () => console.info('TODO(key): galaxyMap'),
        gameMenu: () => console.info('TODO(key): gameMenu'),
    };
}

/** Screen-pixel step for arrow-key scrolling (one HUD-panel-height-ish nudge). */
const SCROLL_PAN_PX = 60;

// ---------------------------------------------------------------------------
// "Keyboard shortcuts" overlay (toggled by ? / F1-equivalent).
// ---------------------------------------------------------------------------

/** Show/hide the shortcuts overlay; returns the new visibility. */
export function createShortcutsOverlay(): {
    root: HTMLDivElement;
    visible: () => boolean;
    show: () => void;
    hide: () => void;
    toggle: () => boolean;
    destroy: () => void;
} {
    const root = document.createElement('div');
    root.id = 'keyboard-shortcuts-overlay';
    root.className = 'hud-panel hud-keyboard-overlay';
    root.style.display = 'none';

    const title = document.createElement('div');
    title.className = 'hud-section-head';
    title.textContent = 'Keyboard shortcuts';
    root.appendChild(title);

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'hud-btn hud-btn-glyph hud-keyboard-close';
    close.title = 'Close';
    close.textContent = '✕';
    close.addEventListener('click', () => hide());
    root.appendChild(close);

    const list = document.createElement('div');
    list.className = 'hud-keyboard-rows';
    for (const b of KEY_BINDINGS) {
        const row = document.createElement('div');
        row.className = 'hud-keyboard-row';
        const k = document.createElement('span');
        k.className = 'hud-keyboard-key';
        const modParts = [
            b.modifiers.ctrl ? 'Ctrl+' : '',
            b.modifiers.alt ? 'Alt+' : '',
            b.modifiers.shift ? 'Shift+' : '',
        ].join('');
        k.textContent = `${modParts}${displayKeyName(b.key)}`;
        const d = document.createElement('span');
        d.className = 'hud-option-label';
        d.textContent = b.description;
        row.append(k, d);
        list.appendChild(row);
    }
    root.appendChild(list);

    document.body.appendChild(root);

    function show(): void {
        root.style.display = '';
    }
    function hide(): void {
        root.style.display = 'none';
    }
    function toggle(): boolean {
        if (root.style.display === 'none') {
            show();
        } else {
            hide();
        }
        return root.style.display !== 'none';
    }
    return {
        root,
        visible: () => root.style.display !== 'none',
        show,
        hide,
        toggle,
        destroy: () => root.remove(),
    };
}

/** Human display name for a DOM key value ('?' shows as '?', arrows named). */
function displayKeyName(key: string): string {
    switch (key) {
        case 'ArrowUp': return '↑';
        case 'ArrowDown': return '↓';
        case 'ArrowLeft': return '←';
        case 'ArrowRight': return '→';
        case 'Escape': return 'Esc';
        case 'PageUp': return 'PgUp';
        case 'PageDown': return 'PgDn';
        case 'Backspace': return 'Bksp';
        case 'Pause': return 'Pause';
        default: return key;
    }
}