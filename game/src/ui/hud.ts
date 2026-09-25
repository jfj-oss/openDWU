import { computeHudLayout, CYCLE_CHIPS, TOP_BAR_BUTTONS, VIEW_ROWS, type Rect, type ViewRowKey } from './hudLayout';
import { onSettingsChange, uiScaleFactor } from './settings';
import { GalaxyTime } from '../sim/clock';
import { resolveStarDateDescription } from '../sim/galaxyTime';
import { createMapOverlayState, OVERLAY_ROWS, toggleOverlay, type MapOverlayState, type OverlayKey } from './mapOverlays';
import { Camera } from '../render/camera';
import { Galaxy } from '../sim/galaxy';
import type { GameData } from '../sim/data/gameData';
import { moneyPanelIncome } from '../sim/treasury';
import { Habitat, HabitatCategoryType, HabitatType, IndustryType, SystemInfo } from '../sim/types';
import type { Empire } from '../sim/empire';
import type { BuiltObject } from '../sim/builtObject';
import { BuiltObjectSubRole } from '../sim/builtObjectTypes';
import { BuiltObjectRole } from '../sim/data/designSpecifications';
import { BuiltObjectMissionType, builtObjectMission, type BuiltObjectMission } from '../sim/missions/mission';
// [15c]
import type { ShipGroup } from '../sim/fleets/shipGroup';
import { fleetCycleList, fleetName, fleetSystemName, shipGroupSelectionRows, toggleFleetsList } from './screens/fleetsList';
// [/15c]
import { SystemVisibilityStatus } from '../sim/visibility';
import { flagShapeUrl } from '../sim/startGameOptions';
import { createGameMenu, type GameMenuRefs } from './screens/gameMenu';
import { setGameMenuHandler, setCycleHandler, type CycleKind } from './keyboard';
import { uiClickSounds } from '../audio/effectsPlayer';
import { helpTopicKeyForHabitat, toggleGalactopedia } from './screens/galactopedia';
import { toggleEmpiresList } from './screens/empiresList';
import { toggleExpansionPlanner } from './screens/expansionPlanner'; // [16a]
import { setEmpireSummarySource, getEmpireSummarySource, toggleEmpireSummary } from './screens/empireSummary';
import { toggleColoniesList } from './screens/coloniesList';
import { toggleShipDesigns } from './screens/shipDesigns'; // [16b]
import { toggleShipsAndBasesList } from './screens/shipsAndBasesList';
import { toggleMessageHistory } from './screens/messageHistory';
import { toggleBuildOrder } from './screens/buildOrder'; import { toggleConstructionYards } from './screens/constructionYards'; // [16c]
import { toggleResearchScreen } from './screens/researchScreen'; // [15b]
import { showToast } from './toast';
// [policy] begin
import { toggleEmpirePolicy } from './screens/empirePolicy';
// [policy] end

// Port of Main.Part12.cs LoadUiChromeButtons (381–520): the control → chrome
// button image mapping. The original loads each control's image from
// images/ui/chrome/<file>, falling back to the customization folder; here the
// desktop shell / dev server serves the same files under /assets/dwu/.
// Only file names that exist in the original chrome folder are used (see the
// task's file list); controls whose image is a runtime bitmap (play/pause) or
// has no chrome file are mapped to null.

export const CHROME_BUTTONS: Record<string, string | null> = {
    // Top bar buttons (tbtn* / btn* per LoadUiChromeButtons).
    tbtnColonies: 'coloniesButton.png',
    tbtnBuiltObjects: 'shipsAndBasesButton.png',
    tbtnEmpires: 'diplomacyButton.png',
    tbtnTroops: 'troopsButton.png',
    tbtnGalaxyMap: 'galaxyMapButton.png',
    tbtnShipGroups: 'fleetsButton.png',
    tbtnConstructionYards: 'constructionYardsButton.png',
    tbtnIntelligenceAgents: 'charactersButton.png',
    tbtnDesigns: 'designsButton.png',
    btnExpansionPlanner: 'expansionPlannerButton.png',
    btnEmpirePolicy: 'empirePolicyButton.png',
    btnEmpireGraphs: 'empireGraphsButton.png',
    btnGameEditor: 'gameEditorButton.png',
    btnBuildOrder: 'buildButton.png',
    btnGalacticHistory: 'galacticHistoryButton.png',
    btnHistoryMessages: 'messagesButton.png',
    // Menu/help glyphs reuse the original chrome art in the top-left bar.
    btnGameMenu: 'gameOptionsButton.png',
    btnHelp: 'galactopediaButton.png',
    // Runtime bitmaps in the original (bitmap_45/46) — not chrome files.
    btnPlayPause: null,
    // System-map zoom rows (C# names use lowercase "Colony"/"In"; the chrome
    // folder only contains the lowercase-z variants).
    btnZoomColony: 'zoomcolony.png',
    btnZoomIn: 'zoomin.png',
    btnZoomOut: 'zoomout.png',
};

/** Control name → chrome png file name (or null if none applies). */
export function chromeButtonFile(name: string): string | null {
    return CHROME_BUTTONS[name] ?? null;
}

// ---------------------------------------------------------------------------
// DOM overlay (task 05c redesign). One element per rect from
// computeHudLayout, re-laid-out on resize. The overlay is pointer-events:none;
// interactive children re-enable it.
// ---------------------------------------------------------------------------

/** Human labels for chrome-less top-bar buttons (never the control name). */
const TOP_BAR_TEXT_LABELS: Record<string, string> = {
    btnEmpireSummary: 'Empire',
    tbtnResearch: 'Research',
};

/** View row key → original zoom-button control name (for its icon art). */
const VIEW_ROW_CONTROL: Partial<Record<ViewRowKey, string>> = {
    zoomSelection: 'btnZoomSelection',
    zoomIn: 'btnZoomIn',
    zoomOut: 'btnZoomOut',
    zoomPlanet: 'btnZoomColony',
    galaxyMap: 'tbtnGalaxyMap',
};

/** Planet-level ("100%") camera zoom: 1 px per world unit. */
export const PLANET_LEVEL_ZOOM = 1;

// ---------------------------------------------------------------------------
// UI scale (task 10f): each HUD element is scaled about its anchored corner so
// the panel edges stay pinned to the screen edge/corner at any scale. The
// origin follows the element's anchor in computeHudLayout: top-left panels
// scale from top-left, right-anchored panels from their right edge, the
// bottom-right options list from bottom-right, and the top-middle message
// panel + launch row from top-centre.
// ---------------------------------------------------------------------------

/** CSS `transform-origin` for a HUD element name given its layout rect. Pure
 * (no window access) so node-based tests can exercise the mapping: the
 * bottom-left selection panel is the only element anchored to the bottom edge,
 * and every other element anchors top-left except the special cases below. */
export function hudTransformOrigin(name: string, _rect: Rect): string {
    if (name === 'pnlOptionsList') return '100% 100%'; // bottom-right anchored
    if (name === 'pnlMoney') return '100% 0'; // top-right anchored
    if (name === 'lstMessages' || (TOP_BAR_BUTTONS as readonly string[]).includes(name)) {
        return '50% 0'; // top-middle: scale from top-centre
    }
    if (name === 'pnlSelection') return '0 100%'; // bottom-left anchored
    return '0 0'; // default: top-left anchored
}

/** Apply the UI scale setting to every HUD element: `transform: scale(s)`
 * about the element's anchored corner (see {@link hudTransformOrigin}). A
 * factor of 1 clears the transform entirely. */
export function applyHudScale(refs: HudRefs): void {
    const s = uiScaleFactor();
    const layout = computeHudLayout(window.innerWidth, window.innerHeight);
    for (const [name, el] of refs.elements) {
        const rect = layout[name];
        if (!rect) continue;
        el.style.transformOrigin = hudTransformOrigin(name, rect);
        el.style.transform = s === 1 ? '' : `scale(${s})`;
    }
}

/** System-level view: zoom factor 50 (Main.Part9.cs btnZoomSystem_Click
 * method_4(50.0)), inside the Main View's system band (factor < 70). */
export const SYSTEM_LEVEL_ZOOM = 1 / 50;

/** Sector-level view: zoom factor 3000 (Main.Part9.cs sector button,
 * method_4(3000.0)). */
export const SECTOR_LEVEL_ZOOM = 1 / 3000;

/** Whole-galaxy view: the most zoomed-out level (fits the galaxy). */
export const GALAXY_LEVEL_ZOOM = 0.00001;

export interface HudRefs {
    root: HTMLDivElement;
    elements: Map<string, HTMLElement>;
    /** Set by the selection panel; main.ts calls it to push a new selection. */
    onSelectionChange?: (sel: Selection | null) => void;
    /** The in-game Escape menu (task 10c), created with the HUD's clock. */
    gameMenu?: GameMenuRefs;
}

export interface HudWiring {
    /** Simulation clock state (play/pause + speed), mutated by the HUD. */
    clock?: GalaxyTime;
    /** Overlay toggle state, mutated by the options list. */
    overlays?: MapOverlayState;
    /** Main-view camera, driven by the View rows. */
    camera?: Camera;
    /** Generated galaxy model, for selection lookups. */
    galaxy?: Galaxy;
    /** Parsed game data (resource definitions → icons/names). */
    gameData?: GameData;
    /** The running game (galaxy + player empire) — task 10d: the money panel
     * refreshes from `game.playerEmpire.stateMoney` and the empires button
     * shows the player's flag shape tinted with the empire colour. */
    game?: { playerEmpire: { name: string; mainColor: number; stateMoney: number; flagShape: number } };
    /** Called after a selection change so main.ts can react. */
    onSelectionChange?: (sel: Selection | null) => void;
    /** Escape menu "Main Menu" (confirmed): main.ts tears the game down. */
    onMainMenu?: () => void;
    /** Notified after every selection change (click, cycle key, chip), so
     * main.ts can keep the Main View's selection ring in sync. */
    afterSelectionChange?: (sel: Selection | null) => void;
    /** Task C3: open/close the Galaxy Map screen (the "Galaxy map (G)" row). */
    onGalaxyMap?: () => void;
}

export interface Selection {
    habitat: Habitat;
    system: SystemInfo;
    /** Task 13c: the selected ship/base when cycling Bases/Military/Constr./
     * Other. `habitat` is then the nearest system's star. */
    builtObject?: BuiltObject;
    /** [15c] The selected fleet; `builtObject` is then its lead ship and `habitat` the nearest star. */
    shipGroup?: ShipGroup;
}

let currentSelection: Selection | null = null;

/** The object currently selected in the streamlined selection panel. */
export function getSelection(): Selection | null {
    return currentSelection;
}

// [16c] Ship/base/colony selection hook: buildSelectionPanel registers it; the
// Construction Yards panel's Go to calls selectStellarObject (method_208 + method_157).
let stellarObjectSelectHandler: ((target: BuiltObject | Habitat, moveView: boolean) => void) | null = null;
export function selectStellarObject(target: BuiltObject | Habitat, moveView = true): void {
    stellarObjectSelectHandler?.(target, moveView);
}
// [/16c]

/** Test hook: set the current selection directly (bypasses the panel's own
 * setter, which also refreshes its DOM). */
export function setSelection(sel: Selection | null): void {
    currentSelection = sel;
}

// [15c] Fleet selection hook: buildSelectionPanel registers it; the Fleets list,
// F12 and the fleet cycler call selectShipGroup (Main.Part8.cs method_208 for a ShipGroup).
let shipGroupSelectHandler: ((sg: ShipGroup, moveView: boolean) => void) | null = null;
export function selectShipGroup(sg: ShipGroup, moveView = true): void {
    shipGroupSelectHandler?.(sg, moveView);
}
// [/15c]
// [16a] Habitat selection hook: buildSelectionPanel registers it; the Expansion
// Planner calls selectHabitat (Main.Part4.cs:3027/3038 GotoTarget / SelectTarget).
let habitatSelectHandler: ((h: Habitat, moveView: boolean) => void) | null = null;
export function selectHabitat(h: Habitat, moveView = true): void {
    habitatSelectHandler?.(h, moveView);
}
// [/16a]

/** Build the HUD overlay and append it to document.body. */
export function createHud(wiring: HudWiring = {}): HudRefs {
    const root = document.createElement('div');
    root.id = 'hud';
    // Task C4: HUD click sounds. Options-list rows are the original's
    // HoverMenuItems (button2.wav); every other HUD button is a GlassButton
    // (button1.wav) — Main.Part13.cs 905-944.
    root.addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement | null)?.closest('button');
        if (btn) void uiClickSounds().play(btn.classList.contains('hud-option-row') ? 'menuItem' : 'glass');
    });
    const elements = new Map<string, HTMLElement>();
    const refs: HudRefs = { root, elements };
    // Default state objects when the caller does not supply its own.
    const clock = wiring.clock ?? new GalaxyTime();
    const overlays = wiring.overlays ?? createMapOverlayState();

    // In-game Escape menu (task 10c): created with the HUD's clock so opening
    // it pauses the game and closing restores the previous paused state. Its
    // toggle is registered as the global Escape action; the ≡ button below
    // calls the same toggle.
    const gameMenu = createGameMenu(clock, { onMainMenu: wiring.onMainMenu });
    setGameMenuHandler(gameMenu.toggle);
    refs.gameMenu = gameMenu;

    for (const [name, rect] of Object.entries(computeHudLayout(window.innerWidth, window.innerHeight))) {
        let el: HTMLElement;
        switch (name) {
            case 'lstMessages':
                el = buildMessagesPanel();
                break;
            case 'pnlTopLeftBar':
                el = buildTopLeftBar(clock, () => gameMenu.toggle());
                break;
            case 'pnlMoney':
                el = buildMoneyPanel(wiring.game, wiring.galaxy);
                break;
            case 'pnlSelection':
            {
                // buildSelectionPanel installs its refresh callback on the object it is
                // given; expose that callback as the HUD's selection hook.
                const panelWiring: HudWiring = { ...wiring };
                el = buildSelectionPanel(panelWiring);
                wiring.onSelectionChange = panelWiring.onSelectionChange;
                refs.onSelectionChange = panelWiring.onSelectionChange;
                break;
            }
            case 'pnlOptionsList':
                el = buildOptionsList({ ...wiring, overlays });
                break;
            default:
                el = name === 'tbtnEmpires' ? buildEmpireFlagButton(wiring) : buildTopBarButton(name, wiring);
                break;
        }
        el.classList.add('hud-el');
        el.dataset.hud = name;
        applyRect(el, rect);
        // Task 10e: right-anchored panels position via `right` (not a computed
        // left) so they can never clip past the screen edge. The options list
        // is content-sized (rect.h === 0): anchor it to the window's
        // bottom-right corner instead of a fixed top offset.
        if (name === 'pnlMoney' || name === 'pnlOptionsList') {
            el.style.left = '';
            el.style.right = `${Math.max(0, window.innerWidth - rect.x - rect.w)}px`;
        }
        if (name === 'pnlOptionsList' && rect.h === 0) {
            el.style.top = '';
            el.style.bottom = `${Math.max(0, window.innerHeight - rect.y - rect.h)}px`;
        }
        root.appendChild(el);
        elements.set(name, el);
    }

    // Task 10d: bind the message ticker's five lines to the ring buffer.
    setMessageLineElements(elements.get('lstMessages') ?? null);

    // Task 12i: clicking the top-middle message panel toggles the Message
    // History window (the original's "Historical messages" button).
    const messagePanel = elements.get('lstMessages');
    if (messagePanel) {
        messagePanel.addEventListener('click', () => toggleMessageHistory());
    }

    // Task 12j: register the Empire Summary panel's data source (F6): the
    // player's empire plus its government's name from the parsed game data.
    if (wiring.game) {
        setEmpireSummarySource(() => ({
            empire: wiring.game!.playerEmpire as Empire,
            governmentName:
                wiring.gameData?.governments[(wiring.game!.playerEmpire as Empire).governmentId]?.name ?? null,
        }));
    }

    // Task 10f: apply the persisted UI scale on startup and re-apply it
    // immediately whenever a settings change updates it (Escape menu).
    applyHudScale(refs);
    onSettingsChange(() => applyHudScale(refs));

    document.body.appendChild(root);
    return refs;
}

function applyRect(el: HTMLElement, rect: Rect): void {
    el.style.left = `${rect.x}px`;
    el.style.top = `${rect.y}px`;
    if (rect.w > 0) el.style.width = `${rect.w}px`;
    if (rect.h > 0) el.style.height = `${rect.h}px`;
}

/** Re-run computeHudLayout at the current window size and move every element. */
export function layoutHud(refs: HudRefs): void {
    const layout = computeHudLayout(window.innerWidth, window.innerHeight);
    for (const [name, el] of refs.elements) {
        const rect = layout[name];
        if (rect) applyRect(el, rect);
        // Task 10e: keep the right-anchored panels pinned to the right edge.
        if (rect && (name === 'pnlMoney' || name === 'pnlOptionsList')) {
            el.style.left = '';
            el.style.right = `${Math.max(0, window.innerWidth - rect.x - rect.w)}px`;
        }
        if (name === 'pnlOptionsList' && rect && rect.h === 0) {
            el.style.top = '';
            el.style.bottom = `${Math.max(0, window.innerHeight - rect.y - rect.h)}px`;
        }
    }
    // Task 10f: keep the UI scale applied after a re-layout.
    applyHudScale(refs);
}

// ---------------------------------------------------------------------------
// Element builders
// ---------------------------------------------------------------------------

/** Top-middle message panel: five placeholder lines + envelope/hourglass. */
function buildMessagesPanel(): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'hud-panel hud-messages';
    const lines = document.createElement('div');
    lines.className = 'hud-message-lines';
    for (let i = 0; i < 5; i++) {
        const line = document.createElement('div');
        line.className = 'hud-message-line';
        lines.appendChild(line);
    }
    panel.appendChild(lines);
    const actions = document.createElement('div');
    actions.className = 'hud-message-actions';
    const env = makeGlyphButton('✉', 'Messages');
    const hourglass = makeGlyphButton('⧗', 'Historical messages');
    actions.append(env, hourglass);
    panel.appendChild(actions);
    return panel;
}

/** Top-left compact bar: menu | help || play/pause − + || date (speed). */
function buildTopLeftBar(clock: GalaxyTime, onGameMenu: () => void): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'hud-panel hud-topbar';

    // The ≡ button toggles the in-game Escape menu (task 10c) instead of the
    // generic TODO log other chrome buttons still use.
    const menu = makeIconButton('btnGameMenu', 'Menu');
    menu.addEventListener('click', () => {
        onGameMenu();
    });
    const help = makeIconButton('btnHelp', 'Help');
    // Main.Part5.cs btnHelp_Click: toggle the Galactopedia at the selection's topic.
    help.addEventListener('click', () => {
        toggleGalactopedia(helpTopicKeyForHabitat(getSelection()?.habitat ?? null));
    });
    bar.append(menu, help);
    bar.appendChild(makeSeparator());

    const pauseBtn = makeGlyphButton(clock.paused ? '▶' : '⏸', 'Play / pause');
    const refreshPauseGlyph = (): void => {
        pauseBtn.textContent = clock.paused ? '▶' : '⏸';
    };
    pauseBtn.addEventListener('click', () => {
        clock.togglePause();
        refreshPauseGlyph();
    });
    const dec = makeGlyphButton('−', 'Slower');
    dec.addEventListener('click', () => {
        clock.slower();
        refreshDateLabel(dateEl, clock);
    });
    const inc = makeGlyphButton('+', 'Faster');
    inc.addEventListener('click', () => {
        clock.faster();
        refreshDateLabel(dateEl, clock);
    });
    bar.append(pauseBtn, dec, inc);
    bar.appendChild(makeSeparator());

    const dateEl = document.createElement('span');
    dateEl.className = 'hud-date';
    refreshDateLabel(dateEl, clock);
    bar.appendChild(dateEl);
    return bar;
}

// Task 07b: the star-date label shows the current star date plus the speed
// multiplier, e.g. `2100.01.01 (1x)` or `2100.01.01 (¼x)`.
export function formatClockLabel(starDate: number, speed: number): string {
    return `${resolveStarDateDescription(starDate)} (${formatSpeed(speed)}x)`;
}

function formatSpeed(speed: number): string {
    if (speed === 0.25) return '¼';
    if (speed === 0.5) return '½';
    return Number.isInteger(speed) ? String(speed) : String(speed);
}

function refreshDateLabel(el: HTMLElement, clock: GalaxyTime): void {
    el.textContent = formatClockLabel(clock.currentStarDate, clock.speed);
}

function makeSeparator(): HTMLElement {
    const sep = document.createElement('span');
    sep.className = 'hud-separator';
    return sep;
}

/** A small text-glyph button (no chrome art). */
function makeGlyphButton(glyph: string, title: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hud-btn hud-btn-glyph';
    btn.title = title;
    btn.textContent = glyph;
    return btn;
}

/** A chrome-art button with a human tooltip (art never shows its name). */
function makeIconButton(controlName: string, title: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hud-btn';
    btn.title = title;
    const file = chromeButtonFile(controlName);
    if (file) {
        const img = document.createElement('img');
        img.src = `/assets/dwu/images/ui/chrome/${file}`;
        img.alt = '';
        img.draggable = false;
        btn.appendChild(img);
    } else {
        btn.classList.add('hud-btn-bare');
        btn.textContent = title;
    }
    // TODO(screen): open the original's panel/screen for this control.
    btn.addEventListener('click', () => {
        console.log(`TODO(screen): ${title}`);
        showToast(`${title} — not yet available`);
    });
    return btn;
}

export type TopBarScreen = 'colonies' | 'empireSummary' | 'messageHistory' | 'shipsAndBases';

/** Top-bar control → the existing screen it toggles (task 12s), or null. */
export function topBarScreen(name: string): TopBarScreen | null {
    switch (name) {
        case 'tbtnColonies':
            return 'colonies';
        case 'btnEmpireSummary':
            return 'empireSummary';
        case 'btnHistoryMessages':
            return 'messageHistory';
        case 'tbtnBuiltObjects':
            return 'shipsAndBases';
        default:
            // btnGalacticHistory is a different screen, not the message history.
            return null;
    }
}

/** Top-middle screen-launch button (chrome art, or small text label). Task
 * 12s: buttons whose screen exists toggle it (like their hotkeys); only the
 * unmapped controls still toast "not yet available". */
function buildTopBarButton(name: string, wiring: HudWiring): HTMLElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hud-btn';
    const label = TOP_BAR_TEXT_LABELS[name];
    const file = chromeButtonFile(name);
    if (file) {
        btn.title = label ?? name;
        const img = document.createElement('img');
        img.src = `/assets/dwu/images/ui/chrome/${file}`;
        img.alt = '';
        img.draggable = false;
        btn.appendChild(img);
    } else {
        // No art file: render a small text label, never the control name.
        btn.classList.add('hud-btn-bare');
        btn.textContent = label ?? '';
        btn.title = label ?? '';
    }
    // TODO(screen): open the original's panel/screen for this control — only
    // the unmapped ones below still toast; tbtnColonies / btnEmpireSummary /
    // btnHistoryMessages toggle their screens.
    btn.addEventListener('click', () => {
        // [15b] tbtnResearch → Research screen (Main.Part9.cs tbtnResearch_Click; task 15b).
        if (name === 'tbtnResearch') {
            const src = getEmpireSummarySource();
            if (src) toggleResearchScreen({ empire: src.empire });
            return;
        }
        // [/15b]
        // [16a] btnExpansionPlanner → Expansion Planner (Main.Part4.cs:2974 btnExpansionPlanner_Click).
        if (name === 'btnExpansionPlanner') {
            const src = getEmpireSummarySource();
            if (src) toggleExpansionPlanner({ empire: src.empire, onSelect: (h) => selectHabitat(h, true) });
            return;
        }
        // [/16a]

        // [policy] begin
        // btnEmpirePolicy → Empire Policy panel (Main.Part2.cs:1184 btnEmpirePolicy_Click; task 17d).
        if (name === 'btnEmpirePolicy') {
            const src = getEmpireSummarySource();
            if (src) toggleEmpirePolicy({ empire: src.empire });
            return;
        }
        // [policy] end

        const screen = topBarScreen(name);
        if (screen === 'colonies') {
            // Main.Part9.cs tbtnColonies_Click: toggle the Colonies list.
            const src = getEmpireSummarySource();
            if (!src) return;
            toggleColoniesList({
                empire: src.empire,
                onZoomTo: (h) => {
                    const cam = wiring.camera;
                    if (!cam) return;
                    // Same camera calls as the Empires button's onZoomTo.
                    cam.centerOn(h.xpos, h.ypos);
                    cam.zoomAt(SYSTEM_LEVEL_ZOOM, cam.width / 2, cam.height / 2);
                },
            });
        } else if (screen === 'empireSummary') {
            // Main.Part8.cs btnEmpireSummary_Click: toggle the Empire Summary.
            toggleEmpireSummary();
        } else if (screen === 'messageHistory') {
            // Main.Part4.cs btnHistoryMessages_Click: toggle Message History.
            toggleMessageHistory();
        } else if (screen === 'shipsAndBases') {
            // Main.Part9.cs tbtnBuiltObjects_Click: toggle the Ships and Bases list.
            const src = getEmpireSummarySource();
            if (!src) return;
            const sel = getSelection();
            toggleShipsAndBasesList({
                empire: src.empire,
                selected: sel ? (sel.builtObject ?? sel.habitat) : null,
                onZoomTo: (bo) => {
                    const cam = wiring.camera;
                    if (!cam) return;
                    cam.centerOn(bo.xpos, bo.ypos);
                    cam.zoomAt(SYSTEM_LEVEL_ZOOM, cam.width / 2, cam.height / 2);
                },
            });
        } else {
            // [16c] btnBuildOrder → Build Order (Main.Part2.cs:1196 btnBuildOrder_Click);
            // tbtnConstructionYards → Construction Yards (Main.Part6.cs:3243 tbtnConstructionYards_Click).
            if (name === 'btnBuildOrder') {
                const src = getEmpireSummarySource();
                if (src) toggleBuildOrder({ empire: src.empire });
                return;
            }
            if (name === 'tbtnConstructionYards') {
                const src = getEmpireSummarySource();
                if (src) toggleConstructionYards({ empire: src.empire, onSelect: (t) => selectStellarObject(t, true) });
                return;
            }
            // [/16c]
            // [15c] tbtnShipGroups → Fleets list (Main.Part9.cs:3153 tbtnShipGroups_Click).
            if (name === 'tbtnShipGroups') {
                const src = getEmpireSummarySource();
                if (src) toggleFleetsList({ empire: src.empire, onSelect: (sg) => selectShipGroup(sg, true) });
                return;
            }
            // [/15c]
            // [16b] tbtnDesigns → Designs panel (Main.Part9.cs:4339 tbtnDesigns_Click).
            if (name === 'tbtnDesigns') {
                const src = getEmpireSummarySource();
                if (src) toggleShipDesigns({ empire: src.empire });
                return;
            }
            // [/16b]
            console.log(`TODO(screen): ${label ?? name}`);
            showToast(`${label ?? name} — not yet available`);
        }
    });
    return btn;
}

/** Top-row empires button (task 10d): the player's flag shape art tinted with
 * the empire colour, falling back to the plain chrome diplomacy button when
 * no game is wired (e.g. the generateGalaxy-only boot path). */
function buildEmpireFlagButton(wiring: HudWiring): HTMLElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hud-btn';
    const file = chromeButtonFile('tbtnEmpires');
    if (file) {
        btn.title = 'Empires';
        const img = document.createElement('img');
        img.src = `/assets/dwu/images/ui/chrome/${file}`;
        img.alt = '';
        img.draggable = false;
        btn.appendChild(img);
    } else {
        btn.classList.add('hud-btn-bare');
        btn.textContent = 'Empires';
        btn.title = 'Empires';
    }
    const game = wiring.game;
    if (game) {
        // The wizard's StartGameOptions carry the chosen flagShapeIndex; the
        // autostart/fallback paths have none, so use the empire's own
        // dominant-race default flag design (Empire.flagShape, -1 if none).
        const shapeIndex = game.playerEmpire.flagShape >= 0 ? game.playerEmpire.flagShape : null;
        if (shapeIndex !== null) {
            const flag = document.createElement('img');
            flag.src = flagShapeUrl(shapeIndex);
            flag.alt = '';
            flag.draggable = false;
            flag.style.filter = `sepia(1) saturate(4) hue-rotate(${colorHueRotate(game.playerEmpire.mainColor)}deg)`;
            btn.appendChild(flag);
        }
    }
    btn.addEventListener('click', () => {
        // Task 12b: open the Empires list panel (galaxy + player empire from
        // the wiring, guarded when either is missing).
        const galaxy = wiring.galaxy;
        if (!galaxy || !game) return;
        toggleEmpiresList({
            empires: galaxy.empires,
            playerEmpire: game.playerEmpire as Empire,
            onZoomTo: (habitat) => {
                const cam = wiring.camera;
                if (!cam) return;
                // Same camera calls as doViewAction('zoomSelection').
                cam.centerOn(habitat.xpos, habitat.ypos);
                cam.zoomAt(SYSTEM_LEVEL_ZOOM, cam.width / 2, cam.height / 2);
            },
        });
    });
    return btn;
}

/** CSS hue-rotate angle that turns a white source into `rgb` — used to tint
 * the monochrome flag shape art with the empire's main colour. */
export function colorHueRotate(rgb: number): number {
    const r = ((rgb >> 16) & 255) / 255;
    const g = ((rgb >> 8) & 255) / 255;
    const b = (rgb & 255) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0;
    if (max !== min) {
        const d = max - min;
        if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        else if (max === g) h = ((b - r) / d + 2) / 6;
        else h = ((r - g) / d + 4) / 6;
    }
    return Math.round(h * 360);
}

/** Top-right money block + nearest-system name (existing behaviour kept).
 * Task 10d: Money is refreshed live from the player empire's state money;
 * Cashflow and Bonus Income come from treasury.ts moneyPanelIncome (Main.Part11.cs 832 method_126). */
function buildMoneyPanel(game?: { playerEmpire: { name: string; mainColor: number; stateMoney: number; flagShape: number } }, galaxy?: Galaxy): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'hud-panel hud-money';
    const valueEls: Record<string, HTMLElement> = {};
    for (const row of ['Money', 'Cashflow', 'Bonus Income']) {
        const line = document.createElement('div');
        line.className = 'hud-money-row';
        const k = document.createElement('span');
        k.className = 'hud-label';
        k.textContent = row;
        const v = document.createElement('span');
        v.className = 'hud-value';
        v.textContent = '—';
        valueEls[row] = v;
        line.append(k, v);
        panel.appendChild(line);
    }
    const sys = document.createElement('div');
    sys.className = 'hud-system-name';
    sys.textContent = '';
    panel.appendChild(sys);

    if (game) {
        // The original's top-right block mirrors the player empire's money
        // fields (Main.Part12.cs pnlStateMoney); here only state money exists
        // on Empire — see the TODO(sim) notes below.
        const refreshMoney = (): void => {
            valueEls['Money'].textContent = formatMoney(Math.round(game.playerEmpire.stateMoney));
            // Main.Part11.cs 838-857: Cashflow / Bonus Income, `+##,###,##0;-##,###,##0` (the C# keeps the previous
            // strings when there is nothing to show).
            const income = galaxy === undefined ? null : moneyPanelIncome(galaxy, galaxy.playerEmpire);
            if (income !== null) {
                valueEls['Cashflow'].textContent = formatSignedMoney(income.cashflow);
                valueEls['Bonus Income'].textContent = formatSignedMoney(income.bonusIncome);
            }
        };
        refreshMoney();
        setInterval(refreshMoney, 250);
    }
    return panel;
}

/** Bottom-left streamlined selection panel. */
function buildSelectionPanel(wiring: HudWiring): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'hud-panel hud-selection';

    const header = document.createElement('div');
    header.className = 'hud-selection-header';
    const nameEl = document.createElement('div');
    nameEl.className = 'hud-selection-name';
    const subEl = document.createElement('div');
    subEl.className = 'hud-selection-sub';
    header.append(nameEl, subEl);
    panel.appendChild(header);

    const body = document.createElement('div');
    body.className = 'hud-selection-body';
    panel.appendChild(body);

    // Footer: ‹ › cycler pair + seven cycle chips.
    const footer = document.createElement('div');
    footer.className = 'hud-selection-footer';
    const back = makeGlyphButton('‹', 'Previous');
    const fwd = makeGlyphButton('›', 'Next');
    let activeChip: CycleKind = 'colonies';
    const chipLabel = (): string => CYCLE_CHIPS.find((c) => c.key === activeChip)?.label ?? activeChip;
    // Task 13c: each BuiltObject cycle kind (bases/military/construction/other)
    // remembers its own last-cycled object, like the original's builtObject_0..3.
    const lastCycled = new Map<CycleKind, BuiltObject>();
    /** Step through a cycle list: select the next item (same hook as
     * click-to-select, so the panel updates). With `moveView` (the Ctrl
     * variants of C/P/M/Y/X/F/I and the ‹ › buttons) the camera also centres
     * on it at System zoom. */
    const stepCycle = (dir: 1 | -1, kind: CycleKind = activeChip, moveView = true): void => {
        if (kind !== 'colonies') {
            // [15c] Port of Main.Part8.cs:1243 btnCycleShipGroups_Click (F / Shift+F / Ctrl+F).
            if (kind === 'fleets') {
                const game = wiring.game;
                if (!game) return;
                const list = fleetCycleList(game.playerEmpire as Empire);
                if (list.length === 0) {
                    pushHudMessage('No Fleets yet');
                    return;
                }
                const next = nextInCycle(list, currentSelection?.shipGroup ?? null, dir);
                if (next) shipGroupSelectHandler?.(next, moveView);
                return;
            }
            // [/15c]
            if (kind === 'idleShips') {
                // TODO(cycle): ShipGroup / BuiltObject.mission not ported (Main.Part7.cs 1863 btnCycleIdleShips_Click)
                pushHudMessage(`No ${chipLabel()} yet`);
                return;
            }
            // Port of Main.Part9.cs btnCycle{Bases,Military,Construction,Other}_Click
            // (2927-3090): filter PlayerEmpire.BuiltObjects + PrivateBuiltObjects by
            // role/sub-role, remember the last-cycled object per kind, and select
            // the next one (method_208), moving the view with MoveView (method_157).
            const game = wiring.game;
            const cam = wiring.camera;
            const galaxy = wiring.galaxy;
            if (!game || !cam || !galaxy) return;
            const label = CYCLE_CHIPS.find((c) => c.key === kind)?.label ?? kind;
            const list = builtObjectCycleList(game.playerEmpire as Empire, kind);
            if (list.length === 0) {
                pushHudMessage(`No ${label} yet`);
                return;
            }
            const next = nextInCycle(list, lastCycled.get(kind) ?? null, dir);
            if (!next) return;
            lastCycled.set(kind, next);
            const system = nearestSystem(galaxy.systems, next.xpos, next.ypos);
            if (!system) return;
            wiring.onSelectionChange?.({ habitat: system.systemStar, system, builtObject: next });
            if (moveView) {
                cam.centerOn(next.xpos, next.ypos);
                cam.zoomAt(SYSTEM_LEVEL_ZOOM, cam.width / 2, cam.height / 2);
            }
            return;
        }
        const game = wiring.game;
        const cam = wiring.camera;
        const galaxy = wiring.galaxy;
        if (!game || !cam || !galaxy) return;
        const colonies = playerColonyList(galaxy, game.playerEmpire as Empire);
        if (colonies.length === 0) {
            pushHudMessage('No Colonies yet');
            return;
        }
        const current = currentSelection?.habitat ?? null;
        const next = nextInCycle(colonies, current, dir);
        if (!next) return;
        const system =
            galaxy.systems.find((s) => s.habitats.includes(next)) ?? galaxy.systems[next.systemIndex];
        wiring.onSelectionChange?.({ habitat: next, system });
        if (moveView) {
            cam.centerOn(next.xpos, next.ypos);
            cam.zoomAt(SYSTEM_LEVEL_ZOOM, cam.width / 2, cam.height / 2);
        }
    };
    back.addEventListener('click', () => {
        stepCycle(-1);
    });
    fwd.addEventListener('click', () => {
        stepCycle(1);
    });
    footer.append(back, fwd);
    for (const chip of CYCLE_CHIPS) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'hud-chip';
        b.title = chip.label;
        // Text pill, not the original's cycle<X>.png art: that art bakes a
        // "›" arrow into each icon (task 05d).
        b.textContent = chip.label;
        b.addEventListener('click', () => {
            activeChip = chip.key;
            footer.querySelectorAll('.hud-chip').forEach((c) => c.classList.remove('hud-chip-active'));
            b.classList.add('hud-chip-active');
        });
        if (chip.key === activeChip) b.classList.add('hud-chip-active');
        footer.appendChild(b);
    }
    panel.appendChild(footer);
    // [16c] Select a construction site: a colony selects itself; a ship/base selects its
    // nearest system with builtObject set (as the Bases cycler does). Optionally move the view.
    stellarObjectSelectHandler = (target, moveView) => {
        const galaxy = wiring.galaxy;
        if (!galaxy) return;
        if (target instanceof Habitat) {
            const h = target;
            const system = galaxy.systems.find((s) => s.habitats.includes(h)) ?? galaxy.systems[h.systemIndex];
            if (!system) return;
            wiring.onSelectionChange?.({ habitat: h, system });
        } else {
            const system = nearestSystem(galaxy.systems, target.xpos, target.ypos);
            if (!system) return;
            wiring.onSelectionChange?.({ habitat: system.systemStar, system, builtObject: target });
        }
        const cam = wiring.camera;
        if (moveView && cam) {
            cam.centerOn(target.xpos, target.ypos);
            cam.zoomAt(SYSTEM_LEVEL_ZOOM, cam.width / 2, cam.height / 2);
        }
    };
    // [/16c]

    // Task 12n: the C/P/M/Y/X/F/I hotkeys route here. A plain/Shift cycle
    // selects without moving the view; Ctrl (MoveView) also moves it. The
    // chip is switched to the cycled list and highlighted like a chip click,
    // so the panel shows which list is cycling.
    setCycleHandler((kind, dir, moveView) => {
        activeChip = kind;
        footer.querySelectorAll('.hud-chip').forEach((c) => c.classList.remove('hud-chip-active'));
        const label = CYCLE_CHIPS.find((c) => c.key === kind)?.label ?? '';
        footer.querySelector(`.hud-chip[title="${label}"]`)?.classList.add('hud-chip-active');
        stepCycle(dir, kind, moveView);
    });
    // [15c] Select a fleet: the lead ship's nearest system, builtObject = lead ship
    // (so the map ring and live refresh follow it), and optionally move the view.
    shipGroupSelectHandler = (sg, moveView) => {
        const lead = sg.leadShip;
        const galaxy = wiring.galaxy;
        if (!lead || !galaxy) return;
        const system = nearestSystem(galaxy.systems, lead.xpos, lead.ypos);
        if (!system) return;
        wiring.onSelectionChange?.({ habitat: system.systemStar, system, builtObject: lead, shipGroup: sg });
        const cam = wiring.camera;
        if (moveView && cam) {
            cam.centerOn(lead.xpos, lead.ypos);
            cam.zoomAt(SYSTEM_LEVEL_ZOOM, cam.width / 2, cam.height / 2);
        }
    };
    // [/15c]
    // [16a] Select a habitat (the same calls as the colony cycler) and optionally move the view.
    habitatSelectHandler = (h, moveView) => {
        const galaxy = wiring.galaxy;
        if (!galaxy) return;
        const system = galaxy.systems.find((s) => s.habitats.includes(h)) ?? galaxy.systems[h.systemIndex];
        if (!system) return;
        wiring.onSelectionChange?.({ habitat: h, system });
        const cam = wiring.camera;
        if (moveView && cam) {
            cam.centerOn(h.xpos, h.ypos);
            cam.zoomAt(SYSTEM_LEVEL_ZOOM, cam.width / 2, cam.height / 2);
        }
    };
    // [/16a]

    // Refresh the header/body from the current selection.
    const gameData = wiring.gameData;
    const refresh = (): void => {
        const sel = currentSelection;
        if (!sel) {
            nameEl.textContent = 'Nothing selected';
            nameEl.classList.add('hud-muted');
            subEl.textContent = '';
            body.replaceChildren();
            return;
        }
        const h = sel.habitat;
        // [15c] fleet header: name + ship count and system.
        if (sel.shipGroup) {
            nameEl.textContent = fleetName(sel.shipGroup);
            nameEl.classList.remove('hud-muted');
            subEl.textContent = `Fleet · ${sel.shipGroup.ships.length} ships · ${fleetSystemName(sel.shipGroup)}`;
        } else // [/15c]
        if (sel.builtObject) {
            // Task 13c: ship/base header — name + sub-role label and system.
            nameEl.textContent = sel.builtObject.name;
            nameEl.classList.remove('hud-muted');
            subEl.textContent = `${subRoleLabel(sel.builtObject.subRole)} · ${sel.system.systemStar.name} system`;
        } else {
            nameEl.textContent = h.name;
            nameEl.classList.remove('hud-muted');
            const typeName = habitatTypeLabel(h.type, h.category);
            subEl.textContent = `${typeName} · ${sel.system.systemStar.name} system`;
        }
        body.replaceChildren();
        for (const row of buildSelectionRows(sel, gameData, wiring.galaxy?.playerEmpire ?? null)) {
            body.appendChild(row.element);
        }
    };
    wiring.onSelectionChange = (sel) => {
        currentSelection = sel;
        refresh();
        wiring.afterSelectionChange?.(sel);
    };
    // Task 14b: ship/base status (speed, fuel, mission) changes every tick — re-render
    // the rows twice a second while one is selected. Stops once the HUD is removed.
    const liveTimer = setInterval(() => {
        if (!panel.isConnected) {
            clearInterval(liveTimer);
            return;
        }
        if (currentSelection?.builtObject) refresh();
    }, 500);
    refresh();
    return panel;
}

/** Bottom-right options list: View rows + overlay toggles. */
/** Task M3: overlays that need ship state (fleets, travel vectors) not yet
 * ported — their toggle just flips the checkbox; src/render/overlayLayer.ts
 * does not draw anything for them. */
const OVERLAY_NEEDS_SHIPS: ReadonlySet<OverlayKey> = new Set([
    'fleetPostures',
    'travelVectorsState',
    'travelVectorsPrivate',
    'longRangeScanners',
    'fadeCivilianShips',
]);

function buildOptionsList(wiring: HudWiring): HTMLElement {
    const overlays = wiring.overlays ?? createMapOverlayState();
    const panel = document.createElement('div');
    panel.className = 'hud-panel hud-options';

    const viewHead = document.createElement('div');
    viewHead.className = 'hud-section-head';
    viewHead.textContent = 'View';
    panel.appendChild(viewHead);
    for (const row of VIEW_ROWS) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'hud-option-row';
        const file = chromeButtonFile(VIEW_ROW_CONTROL[row.key] ?? '');
        if (file) {
            const img = document.createElement('img');
            img.src = `/assets/dwu/images/ui/chrome/${file}`;
            img.alt = '';
            img.draggable = false;
            item.appendChild(img);
        }
        const lbl = document.createElement('span');
        lbl.className = 'hud-option-label';
        lbl.textContent = row.label;
        item.appendChild(lbl);
        item.addEventListener('click', () => {
            doViewAction(row.key, wiring);
        });
        panel.appendChild(item);
    }

    const ovHead = document.createElement('div');
    ovHead.className = 'hud-section-head';
    ovHead.textContent = 'Overlays';
    panel.appendChild(ovHead);
    for (const row of OVERLAY_ROWS) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'hud-option-row';
        const check = document.createElement('span');
        check.className = 'hud-option-check';
        check.textContent = overlays[row.key] ? '✓' : '';
        const lbl = document.createElement('span');
        lbl.className = 'hud-option-label';
        lbl.textContent = row.label;
        item.append(check, lbl);
        item.addEventListener('click', () => {
            toggleOverlay(overlays, row.key);
            check.textContent = overlays[row.key] ? '✓' : '';
            // Rendering lives in src/render/overlayLayer.ts (task M3), which
            // subscribes to onOverlayChange and reacts to this toggle
            // immediately. Empire Territory / Potential Colonies / Scenic
            // Locations / Research Locations are implemented there.
            if (OVERLAY_NEEDS_SHIPS.has(row.key)) {
                // TODO(overlay): needs ships (M3).
            }
        });
        panel.appendChild(item);
    }
    return panel;
}

// ---------------------------------------------------------------------------
// Selection panel cycler (task 10h)
// ---------------------------------------------------------------------------

/** Next item of a cycle list for direction +1 (forward) or -1 (back), with
 * wrap-around. An empty list yields null; if `current` is not in the list
 * (e.g. it was just selected by clicking), forward starts at the first item
 * and back at the last one. */
export function nextInCycle<T>(list: readonly T[], current: T | null, dir: 1 | -1): T | null {
    if (list.length === 0) return null;
    const i = current == null ? -1 : list.indexOf(current);
    if (i === -1) return dir === 1 ? list[0] : list[list.length - 1];
    return list[(i + dir + list.length) % list.length];
}

/** The player empire's owned planets/moons, ordered like the original's
 * colony list: descending population where the habitat has one, else name.
 * Port of the Main.Part* cycleColonies list built from the player empire's
 * colonies (Empire.colonies / Habitat.owner). */
export function playerColonyList(galaxy: Galaxy, playerEmpire: Empire): Habitat[] {
    const owned: Habitat[] = [];
    for (const system of galaxy.systems) {
        for (const h of system.habitats) {
            if (
                (h.category === HabitatCategoryType.Planet || h.category === HabitatCategoryType.Moon) &&
                h.owner === playerEmpire
            ) {
                owned.push(h);
            }
        }
    }
    // Population is only comparable when every habitat reports one; mixed
    // lists fall back to name order (task 10h).
    const allHavePopulation = owned.every((h) => h.population != null && h.population.totalAmount > 0);
    owned.sort((a, b) =>
        allHavePopulation
            ? b.population!.totalAmount - a.population!.totalAmount || a.name.localeCompare(b.name)
            : a.name.localeCompare(b.name),
    );
    return owned;
}

// ---------------------------------------------------------------------------
// BuiltObject cycles (task 13c)
// ---------------------------------------------------------------------------

/** The sub-roles of the Bases cycle chip (Main.Part9.cs btnCycleBases_Click:
 * GetBuiltObjectsBySubRole over these nine). */
const BASE_SUB_ROLES: readonly BuiltObjectSubRole[] = [
    BuiltObjectSubRole.SmallSpacePort,
    BuiltObjectSubRole.MediumSpacePort,
    BuiltObjectSubRole.LargeSpacePort,
    BuiltObjectSubRole.GenericBase,
    BuiltObjectSubRole.EnergyResearchStation,
    BuiltObjectSubRole.WeaponsResearchStation,
    BuiltObjectSubRole.HighTechResearchStation,
    BuiltObjectSubRole.MonitoringStation,
    BuiltObjectSubRole.DefensiveBase,
];

/** Cycle list for a BuiltObject chip: the empire's state + private built
 * objects filtered per kind, in list order (nulls dropped), mirroring the
 * original's btnCycle*_Click handlers (Main.Part9.cs 2927-3090) and
 * BuiltObjectList.GetBuiltObjectsByRole/BySubRole (BuiltObjectList.cs
 * 317-329). Construction appends the ResupplyShip objects after the Build-role
 * ones; other kinds filter by role or sub-role; fleets/idleShips have no list
 * yet (ShipGroup not ported). */
export function builtObjectCycleList(
    empire: { builtObjects: BuiltObject[]; privateBuiltObjects: BuiltObject[] },
    kind: CycleKind,
): BuiltObject[] {
    const all = [...empire.builtObjects, ...empire.privateBuiltObjects].filter((b) => b !== null);
    switch (kind) {
        case 'construction': {
            const out = all.filter((b) => b.role === BuiltObjectRole.Build);
            for (const b of all) if (b.subRole === BuiltObjectSubRole.ResupplyShip) out.push(b);
            return out;
        }
        case 'military':
            return all.filter((b) => b.role === BuiltObjectRole.Military);
        case 'bases':
            return all.filter((b) => BASE_SUB_ROLES.includes(b.subRole));
        case 'other':
            return all.filter((b) => b.role === BuiltObjectRole.Colony || b.role === BuiltObjectRole.Exploration);
        default:
            return [];
    }
}

/** Human label for a built-object sub-role: the enum name split into words
 * (`SmallSpacePort` → "Small Space Port"); '' for Undefined. */
export function subRoleLabel(subRole: BuiltObjectSubRole): string {
    if (subRole === BuiltObjectSubRole.Undefined) return '';
    return BuiltObjectSubRole[subRole].replace(/([a-z])([A-Z])/g, '$1 $2');
}

/** The system whose star is nearest (x, y) by squared distance, or null for
 * an empty list — the same loop as {@link nearestSystemName}. */
export function nearestSystem(systems: readonly SystemInfo[], x: number, y: number): SystemInfo | null {
    let best: SystemInfo | null = null;
    let bestDist = Infinity;
    for (let i = 0; i < systems.length; i++) {
        const star = systems[i].systemStar;
        const dx = star.xpos - x;
        const dy = star.ypos - y;
        const d = dx * dx + dy * dy;
        if (d < bestDist) {
            bestDist = d;
            best = systems[i];
        }
    }
    return best;
}

/** Detail rows for a selected ship/base (task 13c), in order, each skipped
 * when empty: Owner (with the empire's main colour), Design, Size, Location
 * (parent habitat name), Troops (only when non-zero). */
export function builtObjectRows(bo: BuiltObject): { label: string; value: string; color?: number }[] {
    const rows: { label: string; value: string; color?: number }[] = [];
    if (bo.empire !== null) rows.push({ label: 'Owner', value: bo.empire.name, color: bo.empire.mainColor });
    const design = bo.design?.name ?? '';
    if (design !== '') rows.push({ label: 'Design', value: design });
    rows.push({ label: 'Size', value: String(bo.size) });
    const location = bo.parentHabitat?.name ?? '';
    if (location !== '') rows.push({ label: 'Location', value: location });
    if (bo.troops !== null && bo.troops.count > 0) rows.push({ label: 'Troops', value: String(bo.troops.count) });
    return rows;
}

// Port of Galaxy.2.cs ResolveDescription(BuiltObjectMissionType) (GameText.txt values)
export function missionTypeLabel(type: BuiltObjectMissionType): string {
    switch (type) {
        case BuiltObjectMissionType.Undefined: return '(No mission)';
        case BuiltObjectMissionType.Explore: return 'Explore';
        case BuiltObjectMissionType.Build: return 'Build';
        case BuiltObjectMissionType.BuildRepair: return 'Build';
        case BuiltObjectMissionType.Transport: return 'Transport';
        case BuiltObjectMissionType.Patrol: return 'Patrol';
        case BuiltObjectMissionType.Escort: return 'Escort';
        case BuiltObjectMissionType.Rescue: return 'Rescue';
        case BuiltObjectMissionType.Blockade: return 'Blockade';
        case BuiltObjectMissionType.Attack: return 'Attack';
        case BuiltObjectMissionType.Escape: return 'Escape';
        case BuiltObjectMissionType.Retire: return 'Retire';
        case BuiltObjectMissionType.Retrofit: return 'Retrofit';
        case BuiltObjectMissionType.Colonize: return 'Colonize';
        case BuiltObjectMissionType.Waypoint: return 'Assemble';
        case BuiltObjectMissionType.Hold: return 'Wait';
        case BuiltObjectMissionType.WaitAndAttack: return 'Prepare and Attack';
        case BuiltObjectMissionType.WaitAndBombard: return 'Prepare and Bombard';
        case BuiltObjectMissionType.MoveAndWait: return 'Move and Wait';
        case BuiltObjectMissionType.Refuel: return 'Refuel';
        case BuiltObjectMissionType.ExtractResources: return 'Mine';
        case BuiltObjectMissionType.LoadTroops: return 'Load Troops';
        case BuiltObjectMissionType.UnloadTroops: return 'Unload Troops';
        case BuiltObjectMissionType.Deploy: return 'Deploy';
        case BuiltObjectMissionType.Undeploy: return 'Undeploy';
        case BuiltObjectMissionType.Repair: return 'Repair';
        case BuiltObjectMissionType.Move: return 'Move';
        case BuiltObjectMissionType.Bombard: return 'Bombard';
        default: return BuiltObjectMissionType[type] ?? '';
    }
}

// Port of Galaxy.3.cs ResolveDescription(Empire, BuiltObjectMission) — target text only
export function missionTargetText(mission: BuiltObjectMission, empire: Empire | null): string {
    const sector = mission.targetSector;
    if (sector !== null) return `Sector ${String.fromCharCode(sector.x + 65)}${sector.y + 1}`;
    // TODO(port): ShipGroup.Name — not in sim
    if (mission.targetShipGroup !== null) return '';
    const bo = mission.targetBuiltObject;
    if (bo !== null) return bo.name;
    const h = mission.targetHabitat;
    if (h !== null) {
        const cat = h.category === HabitatCategoryType.GasCloud ? 'Gas Cloud' : HabitatCategoryType[h.category];
        const unknown =
            empire !== null &&
            h.systemIndex >= 0 &&
            h.systemIndex < empire.visibility.systemVisibility.length &&
            empire.visibility.checkSystemVisibilityStatus(h.systemIndex) === SystemVisibilityStatus.Unexplored;
        return unknown ? `Unknown ${cat}` : h.name;
    }
    const creature = mission.targetCreature;
    if (creature !== null) return creature.name;
    return '';
}

// Task 14b: port of BaconInfoPanel.cs BuiltObject rows (mission/components/fuel/speed); player null = no player empire (all known)
export function builtObjectStatusRows(bo: BuiltObject, player: Empire | null): { label: string; value: string }[] {
    const rows: { label: string; value: string }[] = [];
    const known = player === null || bo.actualEmpire === player;

    // Mission (BaconInfoPanel.cs:327-342)
    const m = builtObjectMission(bo.mission);
    if (!known) {
        rows.push({ label: 'Mission', value: '(Unknown mission)' });
    } else {
        let text = m === null || m.type === BuiltObjectMissionType.Undefined ? '(No mission)' : missionTypeLabel(m.type);
        if (bo.role === BuiltObjectRole.Military) {
            if (bo.attackRangeSquared === 0) text += ' (Engage when attacked)';
            else if (bo.attackRangeSquared === 4000000) text += ' (Engage nearby targets)';
            else if (bo.attackRangeSquared === 2304000000) text += ' (Engage system targets)';
            else text += ' (Engage detected targets)';
        }
        if (bo.subsequentMissions.length > 0) text += ` (${bo.subsequentMissions.length} queued)`;
        rows.push({ label: 'Mission', value: text });
    }

    // Target (Galaxy.3.cs ResolveDescription target part)
    if (known && m !== null && m.type !== BuiltObjectMissionType.Undefined) {
        const t = missionTargetText(m, bo.actualEmpire);
        if (t !== '') rows.push({ label: 'Target', value: t });
    }

    // Components (BaconInfoPanel.cs:463-490)
    let components = '(Unknown component status)';
    if (known || bo.actualEmpire === null) {
        components = '(All components normal)';
        const damaged = bo.damagedComponentCount;
        const unbuilt = bo.unbuiltComponentCount;
        const disabled = bo.disabledComponentIndexes !== null ? bo.disabledComponentIndexes.length : 0;
        if (damaged > 0 || unbuilt > 0 || disabled > 0) {
            const parts: string[] = [];
            if (damaged > 0) parts.push(`${damaged} damaged`);
            if (disabled > 0) parts.push(`${disabled} disabled`);
            if (unbuilt > 0) parts.push(`${unbuilt} unbuilt`);
            components = parts.join(', ');
        } else if (bo.retrofitDesign !== null) {
            components = `(RETROFITTING to ${bo.retrofitDesign.name})`;
        }
    }
    rows.push({ label: 'Components', value: components });

    // InfoPanel.cs:1236 damage fraction
    if (known && bo.damagedComponentCount > 0 && bo.components.count > 0) {
        rows.push({ label: 'Damage', value: `${Math.round((100 * bo.damagedComponentCount) / bo.components.count)}%` });
    }

    // Fuel (BaconInfoPanel.cs:604-620)
    let fuel = '(Unknown)';
    if (known) {
        fuel = `${Math.max(0, Math.trunc(bo.currentFuel))} / ${Math.trunc(bo.fuelCapacity)}`;
        if (bo.currentFuel <= 0 && bo.role !== BuiltObjectRole.Base && bo.unbuiltComponentCount === 0) fuel += ' (speed reduced)';
    }
    rows.push({ label: 'Fuel', value: fuel });

    // Speed (BaconInfoPanel.cs:637-651)
    if (bo.role !== BuiltObjectRole.Base) {
        // TODO(port): " (slowed)" — BuiltObject.MovementSlowedLocation not in sim
        let suffix = '';
        if (bo.hyperjumpDisabledLocation) suffix += ' (Hyper block)';
        if (bo.warpSpeed <= 0) suffix = ' (No Hyperdrive)';
        rows.push({ label: 'Speed', value: `${Math.trunc(bo.currentSpeed)} / ${Math.trunc(bo.topSpeed)}${suffix}` });
    }

    // streamlined: not a row in the original panel
    if (known && bo.cargoCapacity > 0) {
        let used = 0;
        for (const c of bo.cargo?.items ?? []) used += Math.max(0, c.amount);
        rows.push({ label: 'Cargo', value: `${used} / ${bo.cargoCapacity}` });
    }
    return rows;
}

/** Drive the camera for a View-list action. */
function doViewAction(key: ViewRowKey, wiring: HudWiring): void {
    const cam = wiring.camera;
    if (!cam) return;
    const cx = cam.width / 2;
    const cy = cam.height / 2;
    switch (key) {
        case 'zoomIn':
            cam.zoomAt(cam.zoom * 2, cx, cy);
            break;
        case 'zoomOut':
            cam.zoomAt(cam.zoom / 2, cx, cy);
            break;
        case 'zoomPlanet':
            cam.zoomAt(PLANET_LEVEL_ZOOM, cx, cy);
            break;
        case 'system':
            cam.zoomAt(SYSTEM_LEVEL_ZOOM, cx, cy);
            break;
        case 'sector':
            cam.zoomAt(SECTOR_LEVEL_ZOOM, cx, cy);
            break;
        case 'galaxyMap':
            if (wiring.onGalaxyMap) {
                wiring.onGalaxyMap();
                break;
            }
            cam.zoomAt(GALAXY_LEVEL_ZOOM, cx, cy);
            break;
        case 'galaxy':
            cam.zoomAt(GALAXY_LEVEL_ZOOM, cx, cy);
            break;
        case 'zoomSelection': {
            const sel = currentSelection;
            if (!sel) return;
            // Task 13c: centre on the selected ship/base when one is set.
            const t = sel.builtObject ?? sel.habitat;
            cam.centerOn(t.xpos, t.ypos);
            cam.zoomAt(SYSTEM_LEVEL_ZOOM, cx, cy);
            break;
        }
    }
}

// ---------------------------------------------------------------------------
// Selection helpers
// ---------------------------------------------------------------------------

/** Format a population amount as `1.2B` / `350M` / `4.2K` (one decimal,
 * dropped when integral; smaller amounts stay plain). */
export function formatPopulation(n: number): string {
    if (n >= 1_000_000_000) return trimDecimal(n / 1_000_000_000) + 'B';
    if (n >= 1_000_000) return trimDecimal(n / 1_000_000) + 'M';
    if (n >= 1_000) return trimDecimal(n / 1_000) + 'K';
    return String(Math.trunc(n));
}

// ---------------------------------------------------------------------------
// Money formatting + message ticker (task 10d)
// ---------------------------------------------------------------------------

/** Thousands separators like the original's money display (`641,607`). */
export function formatMoney(n: number): string {
    const sign = n < 0 ? '-' : '';
    return sign + Math.abs(Math.trunc(n)).toLocaleString('en-US');
}

/**
 * .NET `n.ToString("+##,###,##0;-##,###,##0")`: rounded to an integer (half away from zero), grouped, always signed;
 * a value that rounds to 0 uses the first section (`+0`). NaN → "NaN" as in .NET.
 */
export function formatSignedMoney(n: number): string {
    if (Number.isNaN(n)) return 'NaN';
    const r = Math.sign(n) * Math.round(Math.abs(n));
    return (r < 0 ? '-' : '+') + Math.abs(r).toLocaleString('en-US');
}

/** Cashflow style: signed, in parentheses — `(+213,959)` / `(-5,000)` / `(0)`. */
export function formatCashflow(n: number): string {
    const t = Math.trunc(n);
    const inner = t > 0 ? '+' + formatMoney(t) : formatMoney(t);
    return `(${inner})`;
}

/** The top-middle message panel keeps the last 5 messages, newest at the
 * bottom (the original's message ticker). Module state so later systems can
 * push via {@link pushHudMessage} without holding a HUD reference. */
const MESSAGE_LINES = 5;
let hudMessages: string[] = [];
let messageLineEls: HTMLElement[] | null = null;

// Task 12i: the full message history behind the ticker (the original's
// "Historical messages" list), capped at 500 entries, oldest dropped first.
const HISTORY_LIMIT = 500;
export interface HudMessageEntry {
    text: string;
    /** Display date of the message ('' until main.ts passes the game date). */
    at: string;
}
let hudMessageHistory: HudMessageEntry[] = [];

/** Bind the five `.hud-message-line` slots of the message panel to the ring
 * buffer and render the current contents. Called from createHud. */
function setMessageLineElements(panel: HTMLElement | null): void {
    messageLineEls = panel ? Array.from(panel.querySelectorAll('.hud-message-line')) : null;
    renderMessages();
}

/** Re-render the bound message lines from the ring buffer (newest at the
 * bottom, older lines blanked out). */
function renderMessages(): void {
    if (!messageLineEls) return;
    for (let i = 0; i < messageLineEls.length; i++) {
        const idx = i - (messageLineEls.length - MESSAGE_LINES);
        messageLineEls[i].textContent = hudMessages[idx] ?? '';
    }
}

/** Push a message into the top-middle ticker (keeps the last 5, newest at
 * the bottom) and into the full history. `at` is an optional display date
 * (main.ts will pass the game date); it defaults to ''. Exported for later
 * systems (events, diplomacy, ...). */
export function pushHudMessage(text: string, at?: string): void {
    hudMessages.push(text);
    while (hudMessages.length > MESSAGE_LINES) hudMessages.shift();
    hudMessageHistory.push({ text, at: at ?? '' });
    while (hudMessageHistory.length > HISTORY_LIMIT) hudMessageHistory.shift();
    renderMessages();
}

/** Test hook: drop all pushed messages (also clears the rendered lines and
 * the full history). */
export function clearHudMessages(): void {
    hudMessages = [];
    hudMessageHistory = [];
    renderMessages();
}

/** The current message ticker contents (oldest → newest), for tests. */
export function getHudMessages(): readonly string[] {
    return hudMessages;
}

/** The full message history (oldest → newest), for the Message History panel
 * and tests. */
export function getHudMessageHistory(): ReadonlyArray<HudMessageEntry> {
    return hudMessageHistory;
}

function trimDecimal(x: number): string {
    const s = x.toFixed(1);
    return s.endsWith('.0') ? s.slice(0, -2) : s;
}

/** Human label for a habitat type: the `HabitatType` enum name split into
 * words (`MarshySwamp` → "Marshy Swamp"), plus the category word
 * (Planet/Moon/Star/Asteroid/Gas cloud). */
export function habitatTypeLabel(type: HabitatType, category?: HabitatCategoryType): string {
    let base = '';
    for (const key of Object.keys(HabitatType)) {
        if ((HabitatType as Record<string, unknown>)[key] === type) {
            base = key;
            break;
        }
    }
    const words = base.replace(/([a-z])([A-Z])/g, '$1 $2');
    const catWord =
        category === undefined
            ? ''
            : category === HabitatCategoryType.Star
                ? 'Star'
                : category === HabitatCategoryType.Planet
                    ? 'Planet'
                    : category === HabitatCategoryType.Moon
                        ? 'Moon'
                        : category === HabitatCategoryType.Asteroid
                            ? 'Asteroid'
                            : 'Gas cloud';
    return catWord ? `${words} ${catWord}` : words;
}

/** URL of a resource's small UI icon (browsers display BMP directly). */
export function resourceIconUrl(pictureRef: number): string {
    return `/assets/dwu/images/ui/resources/Resource_${pictureRef}.bmp`;
}

/** Industry label for the research-bonus row (IndustryType member names). */
function industryLabel(industry: IndustryType): string {
    for (const key of Object.keys(IndustryType)) {
        if ((IndustryType as Record<string, unknown>)[key] === industry) {
            return key;
        }
    }
    return '';
}

interface SelectionRow {
    element: HTMLElement;
}

/** CSS colour for a packed RGB empire mainColor, decoded the same way as the
 * Empires list swatch (empiresList.ts). */
export function rgbCss(rgb: number): string {
    return `rgb(${(rgb >> 16) & 255}, ${((rgb >> 8) & 255)}, ${(rgb & 255)})`;
}

/** Owner / capital / population rows for the selection panel (task 12l):
 * shown only when the habitat is a colony (`empire !== null`). */
export function ownerRows(h: Habitat): { label: string; value: string; color?: number }[] {
    if (h.empire === null) return [];
    const rows: { label: string; value: string; color?: number }[] = [
        { label: 'Owner', value: h.empire.name, color: h.empire.mainColor },
    ];
    if (h.empire.capital === h) rows.push({ label: 'Status', value: 'Capital' });
    if (h.population.totalAmount > 0) rows.push({ label: 'Population', value: formatPopulation(h.population.totalAmount) });
    return rows;
}

/** `${name} (${n} colon)` — "colony" when n === 1, "colonies" otherwise. */
function colonyText(name: string, n: number): string {
    return `${name} (${n} ${n === 1 ? 'colony' : 'colonies'})`;
}

/** Rows for a selected star's system (task 12r), from the SystemInfo fields
 * cached by Galaxy.determineSystemInfo (Galaxy.1.cs DetermineSystemInfo). */
export function systemRows(sys: SystemInfo): { label: string; value: string; color?: number }[] {
    const rows: { label: string; value: string; color?: number }[] = [];
    // Planets is always shown; fall back to counting habitats when the sim has
    // not cached planetCount yet.
    const planetFallback = sys.habitats.filter((x) => x.category === HabitatCategoryType.Planet).length;
    rows.push({ label: 'Planets', value: `${sys.planetCount ?? planetFallback}` });
    const moonCount = sys.moonCount ?? sys.habitats.filter((x) => x.category === HabitatCategoryType.Moon).length;
    if (moonCount > 0) rows.push({ label: 'Moons', value: `${moonCount}` });
    if (sys.dominantEmpire !== null && sys.dominantEmpire !== undefined) {
        const d = sys.dominantEmpire;
        rows.push({ label: 'Dominant', value: colonyText(d.empire.name, d.colonyCount), color: d.empire.mainColor });
    }
    for (const o of sys.otherEmpires ?? []) {
        rows.push({ label: 'Also present', value: colonyText(o.empire.name, o.colonyCount), color: o.empire.mainColor });
    }
    // Count independent colonies by empireId 0 rather than
    // sys.independentColonyCount, which compares against galaxy.independentEmpire
    // and counts every unowned body on a galaxy without an independent empire.
    const independent = sys.habitats.filter((x) => x.empire !== null && x.empire.empireId === 0).length;
    if (independent > 0) rows.push({ label: 'Independent', value: `${independent} ${independent === 1 ? 'colony' : 'colonies'}` });
    return rows;
}

/** Build the selection panel's detail rows in the original's order, skipping
 * empty ones: Quality (planets/moons), Diameter, Resources, Natives, Scenic,
 * Research bonus; stars additionally show their planet count. Colonies add
 * Owner / Status / Population rows after the header (task 12l). */
export function buildSelectionRows(sel: Selection, gameData?: GameData, player: Empire | null = null): SelectionRow[] {
    const h = sel.habitat;
    const rows: SelectionRow[] = [];
    const addText = (label: string, value: string): void => {
        if (value === '') return; // hide empty rows
        const line = document.createElement('div');
        line.className = 'hud-money-row';
        const k = document.createElement('span');
        k.className = 'hud-label';
        k.textContent = label;
        const v = document.createElement('span');
        v.className = 'hud-value';
        v.textContent = value;
        line.append(k, v);
        rows.push({ element: line });
    };

    // Owner / Status / Population for colonies (task 12l), right after the
    // name/type header and before Quality. The owner row carries a 10px swatch
    // in the empire's main colour, decoded like the Empires list.
    const addColorRow = (row: { label: string; value: string; color?: number }): void => {
        const line = document.createElement('div');
        line.className = 'hud-money-row';
        const k = document.createElement('span');
        k.className = 'hud-label';
        if (row.color !== undefined) {
            const swatch = document.createElement('span');
            swatch.className = 'hud-owner-swatch';
            swatch.style.background = rgbCss(row.color);
            k.appendChild(swatch);
        }
        k.append(document.createTextNode(row.label));
        const v = document.createElement('span');
        v.className = 'hud-value';
        v.textContent = row.value;
        line.append(k, v);
        rows.push({ element: line });
    };
    // [15c] A selected fleet shows its own rows instead of the lead ship's.
    if (sel.shipGroup) {
        for (const r of shipGroupSelectionRows(sel.shipGroup, player)) addColorRow(r);
        return rows;
    }
    // [/15c]
    // Task 13c: a selected ship/base shows only its own rows (Owner / Design /
    // Size / Location / Troops) instead of the habitat's detail rows.
    if (sel.builtObject) {
        for (const r of builtObjectRows(sel.builtObject)) addColorRow(r);
        for (const r of builtObjectStatusRows(sel.builtObject, player)) addColorRow(r);
        return rows;
    }
    for (const orow of ownerRows(h)) addColorRow(orow);

    // Quality: baseQuality × 100 as %, planets/moons only.
    if (h.category === HabitatCategoryType.Planet || h.category === HabitatCategoryType.Moon) {
        addText('Quality', `${Math.round(h.baseQuality * 100)}%`);
    }
    addText('Diameter', `${h.diameter}`);

    // Stars: system rows from the cached SystemInfo fields (task 12r).
    if (h.category === HabitatCategoryType.Star) {
        for (const r of systemRows(sel.system)) addColorRow(r);
    }

    // Resources: one small icon per entry, abundance % as tooltip/label.
    if (h.resources.length > 0) {
        const line = document.createElement('div');
        line.className = 'hud-money-row hud-resource-row';
        const k = document.createElement('span');
        k.className = 'hud-label';
        k.textContent = 'Resources';
        const icons = document.createElement('span');
        icons.className = 'hud-resource-icons';
        for (const r of h.resources) {
            const def = gameData?.resources.find((d) => d.resourceId === r.resourceId);
            const img = document.createElement('img');
            img.src = def ? resourceIconUrl(def.pictureRef) : '';
            img.alt = def?.name ?? `Resource ${r.resourceId}`;
            img.title = `${def?.name ?? `Resource ${r.resourceId}`} (${r.abundance}%)`;
            if (!def) img.style.display = 'none';
            const pct = document.createElement('span');
            pct.className = 'hud-resource-pct';
            pct.textContent = `${r.abundance}%`;
            icons.append(img, pct);
        }
        line.append(k, icons);
        rows.push({ element: line });
    }

    // Natives: each population entry — race name + formatted amount.
    if (h.population.items.length > 0) {
        const natives = h.population.items
            .map((p) => `${p.race.name}: ${formatPopulation(p.amount)}`)
            .join(', ');
        // Owned habitats list their population's races; unowned ones natives.
        addText(h.empire ? 'Races' : 'Natives', natives);
    }

    // Scenic feature (Galaxy.5.cs SetScenicFactor).
    if (h.scenicFeature !== '') {
        addText('Scenic', h.scenicFeature);
    }

    // Research bonus (Galaxy.5.cs SetResearchBonus) with its industry.
    if (h.researchBonus > 0) {
        const ind = industryLabel(h.researchBonusIndustry);
        addText('Research bonus', ind ? `${h.researchBonus} (${ind})` : `${h.researchBonus}`);
    }

    return rows;
}

/** Name of the system nearest the camera centre, or '' if unavailable. */
export function nearestSystemName(
    dwu: { galaxy?: { systems?: Array<{ systemStar: { name: string; xpos: number; ypos: number } }> } } | undefined,
    camera: { x: number; y: number } | undefined,
): string {
    const systems = dwu?.galaxy?.systems;
    if (!systems || !camera) return '';
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < systems.length; i++) {
        const star = systems[i].systemStar;
        const dx = star.xpos - camera.x;
        const dy = star.ypos - camera.y;
        const d = dx * dx + dy * dy;
        if (d < bestDist) {
            bestDist = d;
            best = i;
        }
    }
    return best >= 0 ? systems[best].systemStar.name : '';
}