// Keyboard shortcuts (task 10a): the original's keyboard command table
// (UI_KeyboardCommands, verbatim in tasks/10a-keyboard.md) as a binding list
// plus a keydown dispatcher. Actions that exist today (pause/resume, game
// speed, zoom in/out and zoom levels, Galaxy Map, Esc) are wired to real
// handlers; every other action is registered but inert via console.info.

import { Camera } from '../render/camera';
import { isFollowing, stopFollow, type FollowState } from '../render/followCamera';
import { keyScrollPixels } from '../render/viewInput'; // [gameoptions]
import { getSettings } from './settings'; // [gameoptions]
import { toggleExpansionPlanner } from './screens/expansionPlanner'; import { selectHabitat } from './hud'; // [16a]
import { GalaxyTime } from '../sim/clock';
import { toggleDiplomacyScreen } from './screens/diplomacyScreen'; // [15a]
import {
    GALAXY_LEVEL_ZOOM,
    PLANET_LEVEL_ZOOM,
    SECTOR_LEVEL_ZOOM,
    SYSTEM_LEVEL_ZOOM,
    getSelection,
    zoomToSelectedItem,
} from './hud';
import { helpTopicKeyForHabitat, toggleGalactopedia } from './screens/galactopedia';
import { toggleShipDesigns } from './screens/shipDesigns'; // [16b]
import { toggleResearchScreen } from './screens/researchScreen'; // [15b]
import { getEmpireSummarySource, toggleEmpireSummary } from './screens/empireSummary';
import { toggleColoniesFromHud } from './hud';
import { toggleBuildOrder } from './screens/buildOrder'; import { toggleConstructionYards } from './screens/constructionYards'; import { constructionYardsOptions, selectStellarObject } from './hud'; // [16c]
import { attachBuildQueueLauncher } from './screens/buildQueue'; // [buildQueue]
import { toggleFleets, toggleShipsAndBases } from './hud'; // [15c]
import { toggleGalacticHistory } from './screens/galacticHistory';
import { historyGoTo } from './hud';
import { cycleMainViewDisplayType } from '../render/mainViewDisplay';
import { cyclePanelVisibility } from './panelVisibility';
import { toggleGroundReportFromKey } from './screens/groundReport';
import { toggleGameOptionsPanel } from './screens/gameOptionsPanel'; // [16d]
import { toggleEmpireComparison } from './screens/empireComparison'; // [15d]
import { showToast } from './toast';
// [advisor] begin
import { toggleAdvisorPanel } from './advisorPanel';
// [advisor] end

// [intel] begin
import { toggleIntelligenceScreen } from './screens/intelligence';
// [intel] end

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
    /** The key as the shortcuts overlay shows it, when it is not `key` (one row standing for 0-9). */
    overlayKey?: string;
    /** Not listed in the shortcuts overlay (the other nine digits of a 0-9 row). */
    overlayHidden?: boolean;
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
    { key: 'F2', modifiers: NONE, action: 'coloniesScreen', description: 'Colonies' },
    { key: 'F3', modifiers: NONE, action: 'expansionPlannerScreen', description: 'Expansion Planner screen' },
    { key: 'F4', modifiers: NONE, action: 'intelligenceAgentsScreen', description: 'Intelligence Agents screen' },
    { key: 'F5', modifiers: NONE, action: 'diplomacyScreen', description: 'Diplomacy screen' },
    { key: 'F6', modifiers: NONE, action: 'empireSummaryScreen', description: 'Empire Summary' },
    { key: 'F7', modifiers: NONE, action: 'researchScreen', description: 'Research screen' },
    { key: 'F8', modifiers: NONE, action: 'shipDesignsScreen', description: 'Ship Designs screen' },
    { key: 'F9', modifiers: NONE, action: 'buildOrderScreen', description: 'Build Order screen' },
    { key: 'F10', modifiers: NONE, action: 'constructionYardsScreen', description: 'Construction Yards screen' },
    { key: 'F11', modifiers: NONE, action: 'shipsAndBasesScreen', description: 'Ships and Bases screen' },
    { key: 'F12', modifiers: NONE, action: 'fleetsScreen', description: 'Fleets screen' },
    { key: 'G', modifiers: NONE, action: 'galaxyMap', description: 'Galaxy Map screen' },
    { key: 'H', modifiers: NONE, action: 'messageHistoryScreen', description: 'Message History' },
    { key: 'V', modifiers: NONE, action: 'empireComparisonScreen', description: 'Empire Comparison and Victory Conditions screen' },
    { key: 'O', modifiers: NONE, action: 'gameOptionsScreen', description: 'Game Options screen' },
    // [parC1] The Expanded build's Main_KeyUp keys missing from the 1.9.5 help table (Main.Part7.cs; default keys from
    // GameHotKeysMappingFile.json): D CycleMainDisplayTypes (68), T CyclePanelVisibility (84), [ OpenGroundInvasion-
    // StatusScreen (219), and the control groups (digits 48-57: SelectControlGroupN; Ctrl SetControlGroupN; Shift
    // SelectControlGroupNWithFocus).
    { key: 'D', modifiers: NONE, action: 'cycleMainDisplayTypes', description: 'Cycles the main view display: everything, without battle bars, without map indicators' },
    { key: 'T', modifiers: NONE, action: 'cyclePanelVisibility', description: 'Cycles the panels: all shown, only the map controls, none' },
    { key: '[', modifiers: NONE, action: 'groundInvasionStatus', description: 'Ground Report: the ground invasion status of the selected colony (else your capital)' },
    ...controlGroupBindings(),
    // [advisor] begin — 18a: not in the original table (the original has no advisor chat). It was on T until T got the
    // original's CyclePanelVisibility; K is free in the original's and the Bacon / Expansion mods' default mappings.
    { key: 'K', modifiers: NONE, action: 'advisorChat', description: 'Talk to your fleet admiral (advisor chat, needs a local model server)' },
    // [advisor] end
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

/** The 30 control-group rows: digit = select, Ctrl+digit = set, Shift+digit = select and move the view; one overlay
 *  row per variant (shown as 0-9). */
function controlGroupBindings(): KeyBinding[] {
    const out: KeyBinding[] = [];
    const variants: [KeyModifiers, string, string][] = [
        [NONE, 'selectControlGroup', 'Selects the control group (the object assigned with Ctrl+0-9)'],
        [CTRL, 'setControlGroup', 'Assigns the selected item to the control group'],
        [SHIFT, 'selectControlGroupWithFocus', 'Selects the control group and moves the view to it'],
    ];
    for (const [modifiers, action, description] of variants) {
        for (let d = 0; d <= 9; d++) {
            out.push({ key: String(d), modifiers, action: `${action}${d}`, description, overlayKey: d === 0 ? '0-9' : undefined, overlayHidden: d !== 0 });
        }
    }
    return out;
}

/** Decode a control-group binding action ('selectControlGroup3', 'setControlGroup0', ...). Pure. */
export function controlGroupActionArgs(action: string): { kind: ControlGroupKeyKind; index: number } | null {
    const m = /^(selectControlGroupWithFocus|selectControlGroup|setControlGroup)(\d)$/.exec(action);
    if (m === null) return null;
    const kind: ControlGroupKeyKind = m[1] === 'setControlGroup' ? 'set' : m[1] === 'selectControlGroup' ? 'select' : 'selectWithFocus';
    return { kind, index: Number(m[2]) };
}

/** Main_KeyUp: SetControlGroupN / SelectControlGroupN / SelectControlGroupNWithFocus. */
export type ControlGroupKeyKind = 'set' | 'select' | 'selectWithFocus';

let controlGroupHandler: ((kind: ControlGroupKeyKind, index: number) => void) | null = null;

/** Register the game view's control-group handler (main.ts → ui/controlGroups.ts; null on teardown). */
export function setControlGroupHandler(h: ((kind: ControlGroupKeyKind, index: number) => void) | null): void {
    controlGroupHandler = h;
}

/** The key a binding row stands for, from a key event: the top-row digits and "[" by their physical key (Shift+1 is
 *  "!" in `key`; the C# reads Keys.D0-D9 / Keys.OemOpenBrackets), everything else by `key`. */
export function eventBindingKey(event: Pick<KeyboardEvent, 'key'> & { code?: string }): string {
    const code = event.code;
    if (code !== undefined) {
        const m = /^Digit(\d)$/.exec(code);
        if (m !== null) return m[1];
        if (code === 'BracketLeft') return '[';
    }
    return event.key;
}

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
    messageHistoryScreen?: () => void;
    coloniesScreen?: () => void;
    shipsAndBasesScreen?: () => void;
    empireSummaryScreen?: () => void;
    gameMenu?: () => void;
    galactopediaHelp?: () => void;
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
    // KeyboardEvent.key is lowercase for unshifted letters ('g'); the table
    // uses the original's key names (Keys.G), so compare letters uppercased.
    // The space bar's KeyboardEvent.key is ' '; the table names it 'Space'
    // (Main.Part7.cs Main_KeyUp: Keys.Pause / Keys.Space -> ToglePause).
    const k = key === ' ' ? 'Space' : key.length === 1 ? key.toUpperCase() : key;
    for (const b of bindings) {
        if (b.key !== k) continue;
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
    event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'target'> & { code?: string },
    handlers: KeyHandlers,
    bindings: KeyBinding[] = KEY_BINDINGS,
): string | null {
    if (isTypingTarget(event.target)) return null;
    const binding = findBinding(eventBindingKey(event), {
        ctrl: event.ctrlKey,
        alt: event.altKey,
        shift: event.shiftKey,
    }, bindings);
    if (!binding) return null;
    // Task 12n: the C/P/M/Y/X/F/I cycler keys route to the HUD's cycle
    // handler (registered by createHud) instead of the inert default branch.
    const cyc = cycleActionArgs(binding.action);
    if (cyc) {
        cycleHandler?.(cyc.kind, cyc.dir, cyc.moveView);
        return binding.action;
    }
    // [fix6ui] begin — N2: E/R/A/S/, (ship orders) and Z/N/B/L (selection keys) route to the game view's handler
    // (main.ts → shipHotkeys.ts, ports of the Main.Part7.cs Main_KeyUp branches).
    if (isShipCommandAction(binding.action)) {
        if (shipCommandHandler) shipCommandHandler(binding.action);
        else console.info(`TODO(key): ${binding.action}`);
        return binding.action;
    }
    // [fix6ui] end
    // [parC1] Ctrl+0-9 / 0-9 / Shift+0-9: the control groups (ui/controlGroups.ts).
    const group = controlGroupActionArgs(binding.action);
    if (group !== null) {
        if (controlGroupHandler) controlGroupHandler(group.kind, group.index);
        else console.info(`TODO(key): ${binding.action}`);
        return binding.action;
    }
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
        // [16a] F3: Expansion Planner (task 16a); a row selects + zooms to the planet.
        case 'expansionPlannerScreen': {
            const src = getEmpireSummarySource();
            if (src) toggleExpansionPlanner({ empire: src.empire, onSelect: (h) => selectHabitat(h, true) });
            break;
        }
        // [/16a]
        case 'galaxyMap':
            handlers.galaxyMap?.();
            break;
        case 'messageHistoryScreen':
            handlers.messageHistoryScreen?.();
            break;
        // [15a] F5: Diplomacy screen (task 15a).
        case 'diplomacyScreen': {
            const src = getEmpireSummarySource();
            if (src) toggleDiplomacyScreen({ player: src.empire });
            break;
        }
        // [/15a]
        case 'empireSummaryScreen':
            toggleEmpireSummary();
            break;
        // [15b] F7: Research screen (task 15b).
        case 'researchScreen': {
            const src = getEmpireSummarySource();
            if (src) toggleResearchScreen({ empire: src.empire });
            break;
        }
        // [/15b]
        // [16b] F8: Ship Designs (task 16b).
        case 'shipDesignsScreen': {
            const src = getEmpireSummarySource();
            if (src) toggleShipDesigns({ empire: src.empire });
            break;
        }
        // [/16b]
        case 'coloniesScreen':
            handlers.coloniesScreen?.();
            break;
        case 'shipsAndBasesScreen':
            handlers.shipsAndBasesScreen?.();
            break;
        // [15c] F12: Fleets list (task 15c); a row selects + zooms to the fleet.
        case 'fleetsScreen': {
            toggleFleets();
            break;
        }
        // [/15c]
        case 'gameMenu':
            handlers.gameMenu?.();
            break;
        // [16d] O: Game Options — Automation + message options (task 16d).
        case 'gameOptionsScreen': {
            const src = getEmpireSummarySource();
            if (src) toggleGameOptionsPanel({ empire: src.empire });
            break;
        }
        // [/16d]
        case 'galactopediaHelp':
            handlers.galactopediaHelp?.();
            break;
        // [15d] V: Empire Comparison and Victory Conditions (task 15d).
        case 'empireComparisonScreen': {
            const src = getEmpireSummarySource();
            if (src) toggleEmpireComparison({ player: src.empire });
            break;
        }
        // [/15d]
        // [16c] F9: Build Order, F10: Construction Yards (task 16c).
        case 'buildOrderScreen': {
            const src = getEmpireSummarySource();
            if (src) {
                toggleBuildOrder({ empire: src.empire });
                attachBuildQueueLauncher({ empire: src.empire, onGoto: (t) => selectStellarObject(t, true) }); // [buildQueue]
            }
            break;
        }
        case 'constructionYardsScreen': {
            const src = getEmpireSummarySource();
            if (src) toggleConstructionYards(constructionYardsOptions(src.empire));
            break;
        }
        // [/16c]
        // [parC1] D: Main.Part6.cs:3069 btnMainViewDisplayToggle_Click (int_34, render/mainViewDisplay.ts).
        case 'cycleMainDisplayTypes':
            cycleMainViewDisplayType();
            break;
        // [parC1] T: Main.Part7.cs:3085 CyclePanelVisibility (ui/panelVisibility.ts).
        case 'cyclePanelVisibility':
            cyclePanelVisibility();
            break;
        // [parC1] [: Main.Part7.cs:3321 OpenGroundInvasionStatusScreen (method_164 / method_165, screens/groundReport.ts).
        case 'groundInvasionStatus':
            toggleGroundReportFromKey();
            break;
        // [advisor] begin K: chat advisor (task 18a; T until parC1).
        case 'advisorChat': {
            const src = getEmpireSummarySource();
            if (src) toggleAdvisorPanel({ galaxy: src.empire.galaxy, player: src.empire });
            break;
        }
        // [advisor] end

        // [intel] begin F4: Intelligence Agents (Main.Part7.cs:3254 → Main.Part6.cs:3231 tbtnIntelligenceAgents_Click).
        case 'intelligenceAgentsScreen': {
            const src = getEmpireSummarySource();
            if (src) toggleIntelligenceScreen({ player: src.empire, onZoomTo: (t) => selectStellarObject(t, true) });
            break;
        }
        // [intel] end

        default:
            // Registered but not implemented yet.
            console.info(`TODO(key): ${binding.action}`);
            // Task 12g: tell the player the shortcut exists but is inert.
            // Guarded: node-based tests run without a DOM (toast needs one).
            if (typeof document !== 'undefined') {
                showToast(`${binding.description} — not yet available`);
            }
            break;
    }
    return binding.action;
}

/** Build the standard handler set from the camera + clock (the same camera
 * calls the HUD options list uses, Main.Part11.cs zoom behaviour). When
 * `galaxySize` is given, the G key also centres on the middle of the galaxy.
 * `followState`, when given, is stopped by the arrow-key scroll actions
 * (task followcam: a keyboard scroll stops the follow camera). */
export function buildDefaultHandlers(
    camera: Camera,
    time: GalaxyTime,
    galaxySize?: { width: number; height: number },
    followState?: FollowState,
): KeyHandlers {
    const cx = (): number => camera.width / 2;
    const cy = (): number => camera.height / 2;
    const stopFollowOnScroll = (): void => {
        if (followState !== undefined && isFollowing(followState)) stopFollow(followState);
    };
    return {
        togglePause: () => time.togglePause(),
        speedUp: () => time.faster(),
        speedDown: () => time.slower(),
        // PageUp/PageDown: discrete zoom steps (Main.Part11.cs zoomStep).
        zoomIn: () => camera.zoomStep(1),
        zoomOut: () => camera.zoomStep(-1),
        // Backspace: Main_KeyUp ZoomToSelected → btnZoomSelection_Click (the system map's zoom strip button, hud.ts
        // zoomToSelectedItem): move to the selection unless the view is locked, then zoom to 100 %.
        zoomToSelection: () => {
            zoomToSelectedItem(camera);
        },
        zoomSystemLevel: () => camera.zoomAt(SYSTEM_LEVEL_ZOOM, cx(), cy()),
        zoomSectorLevel: () => camera.zoomAt(SECTOR_LEVEL_ZOOM, cx(), cy()),
        zoomGalaxyLevel: () => camera.zoomAt(GALAXY_LEVEL_ZOOM, cx(), cy()),
        zoomPlanetLevel: () => camera.zoomAt(PLANET_LEVEL_ZOOM, cx(), cy()),
        scrollUp: () => {
            stopFollowOnScroll();
            camera.panByScreen(0, scrollPx());
        },
        scrollDown: () => {
            stopFollowOnScroll();
            camera.panByScreen(0, -scrollPx());
        },
        scrollLeft: () => {
            stopFollowOnScroll();
            camera.panByScreen(scrollPx(), 0);
        },
        scrollRight: () => {
            stopFollowOnScroll();
            camera.panByScreen(-scrollPx(), 0);
        },
        // G: zoom the Main View out to show the whole galaxy (minZoom is the
        // galaxy-fit zoom from Camera.setGalaxyBounds) and centre on its
        // middle when the galaxy size is known.
        galaxyMap: () => {
            camera.zoom = camera.minZoom;
            if (galaxySize) {
                camera.centerOn(galaxySize.width / 2, galaxySize.height / 2);
            }
        },
        // H: Main_KeyUp OpenMessageHistory → Main.Part4.cs:2016 btnHistoryMessages_Click → method_528("either"): the
        // full pnlMessageHistory (screens/galacticHistory.ts) on its last filter unless that was Galactic History.
        messageHistoryScreen: () => {
            const src = getEmpireSummarySource();
            if (src) toggleGalacticHistory({ empire: src.empire, mode: 'either', onGoTo: (x, y) => historyGoTo(camera, x, y) });
        },
        // F2: the Colonies screen (Main_KeyUp F2 → method_166) — same source as the Empire Summary.
        coloniesScreen: () => {
            const src = getEmpireSummarySource();
            if (src) toggleColoniesFromHud(src.empire);
        },
        // F11: the Ships and Bases list (task 13f) — same source as the
        // Empire Summary; sorts by distance to the selection when there is one.
        shipsAndBasesScreen: () => {
            toggleShipsAndBases();
        },
        // F1 (KeyMappingFriendlyNames.OpenHelp -> btnHelp_Click, Main.Part7.cs).
        galactopediaHelp: () => toggleGalactopedia(helpTopicKeyForHabitat(getSelection()?.habitat ?? null)),
        // Esc: the in-game menu's toggle, registered by createHud (task 10c).
        gameMenu: () => {
            if (gameMenuHandler) {
                gameMenuHandler();
            } else {
                console.info('TODO(key): gameMenu');
            }
        },
    };
}

/** Screen-pixel step for arrow-key scrolling (one HUD-panel-height-ish nudge). */
/** [gameoptions] Arrow-key scroll step: 60 px at the default Scroll Speed, scaled by it (render/viewInput.ts). */
const scrollPx = (): number => keyScrollPixels(getSettings().mainViewScrollSpeed);

// ---------------------------------------------------------------------------
// Game-menu hook (task 10c): createHud registers the in-game menu's toggle so
// the Escape binding reaches it without main.ts knowing about the menu. This is
// the single Escape path — the menu does not add its own window keydown
// listener, which would double-fire with this dispatch on one keypress.
// ---------------------------------------------------------------------------

let gameMenuHandler: (() => void) | null = null;

/** Register the in-game menu's toggle as the Escape action handler. */
export function setGameMenuHandler(h: (() => void) | null): void {
    gameMenuHandler = h;
}

// ---------------------------------------------------------------------------
// Cycle hotkeys (task 12n): C/P/M/Y/X/F/I drive the HUD selection panel's
// cycler — plain cycles, Shift cycles backwards, Ctrl cycles + moves view.
// The HUD registers a handler via createHud; dispatchKey routes the seven
// cycle actions to it and never falls through to the inert default branch.
// ---------------------------------------------------------------------------

/** The seven cycler lists of the selection panel (hud.ts SELECTION_CYCLE_BUTTONS). The category lists of the old
 *  footer chips are now the left sidebar's panels (leftSidebar.ts). */
export type CycleKind = 'colonies' | 'bases' | 'military' | 'construction' | 'other' | 'fleets' | 'idleShips';

let cycleHandler: ((kind: CycleKind, dir: 1 | -1, moveView: boolean) => void) | null = null;

/** Register the HUD's cycler as the handler for the C/P/M/Y/X/F/I bindings. */
export function setCycleHandler(h: ((kind: CycleKind, dir: 1 | -1, moveView: boolean) => void) | null): void {
    cycleHandler = h;
}

const CYCLE_KIND_PREFIXES: Record<string, CycleKind> = {
    Colonies: 'colonies',
    SpacePorts: 'bases',
    MilitaryShips: 'military',
    ConstructionShips: 'construction',
    ExplorationShips: 'other',
    Fleets: 'fleets',
    IdleShips: 'idleShips',
};

/** Decode a `cycle<X>` binding action into its cycler arguments. Pure:
 * `Backward` suffix → dir -1, `MoveView` suffix → dir 1 + move view, no
 * suffix → dir 1 without moving the view. Anything else (including
 * `cycleEngagementStance`) yields null. */
export function cycleActionArgs(action: string): { kind: CycleKind; dir: 1 | -1; moveView: boolean } | null {
    if (!action.startsWith('cycle')) return null;
    let rest = action.slice('cycle'.length);
    let dir: 1 | -1 = 1;
    let moveView = false;
    if (rest.endsWith('Backward')) {
        dir = -1;
        rest = rest.slice(0, -'Backward'.length);
    } else if (rest.endsWith('MoveView')) {
        moveView = true;
        rest = rest.slice(0, -'MoveView'.length);
    }
    const kind = CYCLE_KIND_PREFIXES[rest];
    if (!kind) return null;
    return { kind, dir, moveView };
}

// [fix6ui] begin — ship-order and selection keys (N2 / #12, playtest 2026-09-25-b).
/** Binding actions handled by the game view's ship-command handler (Main.Part7.cs Main_KeyUp: E ShipEscapeCommand,
 * R RefuelShip, A EnableAuto, S StopShip, `,` CycleShipEngagmentRange, Z FindNearestMilitaryShip,
 * N CycleSelectionForward, B CycleSelectionBackward, L ToggleViewLock). */
export const SHIP_COMMAND_ACTIONS = [
    'commandEscape',
    'commandRefuel',
    'automateShip',
    'stopShip',
    'cycleEngagementStance',
    'selectNearestMilitaryShip',
    'selectionForward',
    'selectionBackward',
    'lockView',
] as const;
export type ShipCommandAction = (typeof SHIP_COMMAND_ACTIONS)[number];

export function isShipCommandAction(action: string): action is ShipCommandAction {
    return (SHIP_COMMAND_ACTIONS as readonly string[]).includes(action);
}

let shipCommandHandler: ((action: ShipCommandAction) => void) | null = null;

/** Register the game view's handler for SHIP_COMMAND_ACTIONS (null on teardown). */
export function setShipCommandHandler(h: ((action: ShipCommandAction) => void) | null): void {
    shipCommandHandler = h;
}

let viewLockedQuery: (() => boolean) | null = null;
/** The game view reports whether the view lock (L) is on (the selection panel's lock button state). */
export function setViewLockedQuery(q: (() => boolean) | null): void {
    viewLockedQuery = q;
}
export function isViewLocked(): boolean {
    return viewLockedQuery?.() ?? false;
}

/** Run a ship-command action as its key would (the selection panel's lock / history / stance / nearest-military
 *  buttons share the key handlers). False when no game view handles it. */
export function runShipCommand(action: ShipCommandAction): boolean {
    if (shipCommandHandler === null) return false;
    shipCommandHandler(action);
    return true;
}
// [fix6ui] end

// ---------------------------------------------------------------------------
// "Keyboard shortcuts" overlay (toggled by ? / F1-equivalent).
// ---------------------------------------------------------------------------

/** Actions with a real handler today: the `case`s of dispatchKey plus the
 * seven cyclers (task 12n). */
export const IMPLEMENTED_KEY_ACTIONS: ReadonlySet<string> = new Set([
    'togglePause', 'speedUp', 'speedDown',
    'diplomacyScreen', // [15a]
    'expansionPlannerScreen', // [16a]
    'zoomIn', 'zoomOut', 'zoomToSelection',
    'zoomSystemLevel', 'zoomSectorLevel', 'zoomGalaxyLevel', 'zoomPlanetLevel',
    'researchScreen', // [15b]
    'shipDesignsScreen', // [16b]
    'scrollUp', 'scrollDown', 'scrollLeft', 'scrollRight',
    'galaxyMap', 'messageHistoryScreen', 'empireSummaryScreen', 'coloniesScreen', 'shipsAndBasesScreen',
    'fleetsScreen', // [15c]
    'buildOrderScreen', 'constructionYardsScreen', // [16c]
    'gameMenu', 'galactopediaHelp',
    // Every C/P/M/Y/X/F/I cycler (hud.ts stepCycle; I = Main.Part7.cs btnCycleIdleShips_Click).
    ...['Colonies', 'SpacePorts', 'MilitaryShips', 'ConstructionShips', 'ExplorationShips', 'Fleets', 'IdleShips']
        .flatMap((k) => [`cycle${k}`, `cycle${k}Backward`, `cycle${k}MoveView`]),
    'empireComparisonScreen', // [15d]
    'gameOptionsScreen', // [16d]
    // [parC1]
    'cycleMainDisplayTypes', 'cyclePanelVisibility', 'groundInvasionStatus',
    ...['selectControlGroup', 'setControlGroup', 'selectControlGroupWithFocus'].flatMap((a) => Array.from({ length: 10 }, (_, d) => `${a}${d}`)),
    // [fix6ui] begin
    'advisorChat', 'ctrlWithZoomKeys',
    ...SHIP_COMMAND_ACTIONS,
    // [fix6ui] end

    // [intel] begin
    'intelligenceAgentsScreen',
    // [intel] end
]);

/** True when pressing the binding's key does something today. Pure. */
export function isKeyActionAvailable(action: string): boolean {
    return IMPLEMENTED_KEY_ACTIONS.has(action);
}

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
        if (b.overlayHidden) continue;
        const row = document.createElement('div');
        row.className = 'hud-keyboard-row';
        if (!isKeyActionAvailable(b.action)) {
            row.classList.add('hud-keyboard-row-unavailable');
        }
        const k = document.createElement('span');
        k.className = 'hud-keyboard-key';
        const modParts = [
            b.modifiers.ctrl ? 'Ctrl+' : '',
            b.modifiers.alt ? 'Alt+' : '',
            b.modifiers.shift ? 'Shift+' : '',
        ].join('');
        k.textContent = `${modParts}${b.overlayKey ?? displayKeyName(b.key)}`;
        const d = document.createElement('span');
        d.className = 'hud-option-label';
        d.textContent = b.description;
        row.append(k, d);
        if (!isKeyActionAvailable(b.action)) {
            const tag = document.createElement('span');
            tag.className = 'hud-keyboard-tag';
            tag.textContent = 'not yet available';
            row.appendChild(tag);
        }
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