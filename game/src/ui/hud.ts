import { computeHudLayout, OPTIONS_ABOVE_MAP_GAP, SYSTEM_MAP_PANEL_H, SYSTEM_MAP_PANEL_W, type Rect } from './hudLayout';
import { buildHudSystemMap, setZoomFactor, SYSTEM_MAP_SMALL_SCALE, SYSTEM_MAP_STRIP, systemMapSmall } from './hudSystemMap';
import { openRuinDetail } from './screens/ruinDetail';
import { cornerRadiusCss, MONEY_POS, researchReadout, showViewSystemName, TOP_DATE_POS, TOP_ELEMENT_NAMES, TOP_LEFT_BUTTONS, TOP_ROW_BUTTONS, topBarLayout, topBarScale, viewSystemName, type CornerCurves } from './topBar';
import './topBar.css';
import { openGameOptionsPanel, toggleGameOptionsPanel } from './screens/gameOptionsPanel';
import { toggleAdvisorPanel } from './advisorPanel';
import { empireFlagUrl } from './selectionInfoView';
import { threatKnownSites } from '../sim/scenario/threats/framework';
import { getSettings, onSettingsChange, uiScaleFactor } from './settings';
import { destroyHudListeners, hudInterval, hudSignal, onHudDestroyed } from './hudLifetime';
export { destroyHudListeners } from './hudLifetime';
import { bindAutoPauseClock } from './autoPause';
import { HUD_FRAME_SIZE } from './topBar';
import { GalaxyTime } from '../sim/clock';
import { resolveStarDateDescription } from '../sim/galaxyTime';
import { createMapOverlayState, OVERLAY_ROWS, onOverlayChange, toggleOverlay, type MapOverlayState, type OverlayKey, type OverlayRow } from './mapOverlays';
import { resourcePickerPanel, supplyShortagesPanel, type OverlayOptionPanel } from './overlayOptionPanels'; // [dw2overlays]
import { waypointsOptionsPanel } from './waypoints'; // [improvements] waypoints
import { IMPROVEMENTS_TITLE, improvementViewRows, onImprovementsChange, overlayRowSections, setImprovementEnabled, type Improvement } from './improvements'; // [improvements]
import { Camera } from '../render/camera';
import { followOnSelectionChanged, isFollowingTarget, toggleFollow, type FollowState, type FollowTarget } from '../render/followCamera';
import { Galaxy } from '../sim/galaxy';
import { calculateAvailableAssaultPodAttackStrength } from '../sim/combat/attackAI';
import type { GameData } from '../sim/data/gameData';
import type { ConstructionQueue } from '../sim/construction/constructionQueue';
import { yardProgress } from './screens/constructionYards';
import { Habitat, HabitatCategoryType, HabitatType, SystemInfo } from '../sim/types';
import type { Empire } from '../sim/empire';
import type { BuiltObject } from '../sim/builtObject';
import { BuiltObjectSubRole } from '../sim/builtObjectTypes';
import { BuiltObjectRole } from '../sim/data/designSpecifications';
import { BuiltObjectMissionType, COORD_UNSET_DOUBLE, builtObjectMission, type BuiltObjectMission } from '../sim/missions/mission';
// [15c]
import { ShipGroup } from '../sim/fleets/shipGroup';
import { closeFleetsList, fleetCycleList, fleetShipAction, toggleFleetsList } from './screens/fleetsList';
import { closeFleetSettings, isFleetSettingsOpen, openFleetSettings } from './screens/fleetSettings';
import { fleetForSelection } from './screens/fleetSettingsModel';
import { isImprovementEnabled } from './improvements';
// [/15c]
import { SystemVisibilityStatus } from '../sim/visibility';
import { flagShapeUrl } from '../sim/startGameOptions';
import { rimSystemDisplayName, type RimNameHost } from '../sim/scenario/rimNames'; // [rimatmo-wiring] 19i item 11
import { raceDisplayOverride, raceHasConcordArt } from '../render/concordArt';
// [troopart] begin
import { troopImageUrl } from '../render/troopImages';
import { Troop, TroopList } from '../sim/cargo';
import type { Race } from '../sim/data/races';
import { resolveInvasionEmpires } from '../sim/troops';
import { calculateForceStrengths, calculatePopulationStrength } from '../sim/combat/invasion';
import { stellarObjectCharacters, habitatInvadingCharacterList } from '../sim/characters';
import { troopCountsByType, troopCompositionDescription } from './screens/troops';
// [/troopart]
import { resolveEmpireEmblem } from './empireEmblem';
import { createGameMenu, type GameMenuRefs } from './screens/gameMenu';
import { createLeftSidebar, relayoutLeftSidebar } from './leftSidebarView';
import { setListHoverSelectionSource } from './listHover';
import { setGameMenuHandler, setCycleHandler, runShipCommand, isViewLocked, type CycleKind } from './keyboard';
import { uiClickSounds } from '../audio/effectsPlayer';
import { helpTopicKeyForHabitat, openGalactopedia, toggleGalactopedia } from './screens/galactopedia';
import { toggleEmpiresList } from './screens/empiresList';
import { toggleDiplomacyScreen } from './screens/diplomacyScreen';
import { toggleExpansionPlanner } from './screens/expansionPlanner'; // [16a]
import { setEmpireSummarySource, getEmpireSummarySource, toggleEmpireSummary } from './screens/empireSummary';
// [leftovers] begin
import { toggleGalacticHistory } from './screens/galacticHistory';
import { openGroundReport } from './screens/groundReport'; // [parC1]
// [leftovers] end
import { formatThousandsK } from './screens/coloniesList';
import { toggleColoniesScreen } from './screens/coloniesScreen';
import { toggleShipDesigns } from './screens/shipDesigns'; // [16b]
import { closeShipsAndBasesList, toggleShipsAndBasesList, type BuiltObjectFilter } from './screens/shipsAndBasesList';
import { toggleMessageHistory } from './screens/messageHistory';
import { toggleBuildOrder } from './screens/buildOrder'; import { openConstructionYards, toggleConstructionYards, type ConstructionYardsOptions } from './screens/constructionYards'; // [16c]
import { attachBuildQueueLauncher } from './screens/buildQueue'; // [buildQueue]
import { toggleResearchScreen } from './screens/researchScreen'; // [15b]
import { toggleEmpireComparison } from './screens/empireComparison';
import { showToast } from './toast';
import { setToolStripActive, toolStripHeading, toolStripItem, toolStripMenu } from './originalWindow'; // [uiwp6]
import type { DispatchOption } from '../sim/player/habitatDispatch';
// [troops] begin
import { toggleTroopsScreen } from './screens/troops';
import { sectorColumnName } from '../sim/sectorNames';
import { confirmAutomationOff } from './orderMenu';
import { galaxyStarDate } from '../sim/tick/simTime';
import { createShipAction, ShipActionType } from '../sim/player/shipAction';
import { issuePlayerCommand } from '../sim/player/playerCommands';
import { toggleGameEditor } from './screens/gameEditor';
import type { PlayerOpArgs, PlayerOpName, PlayerOpResult } from '../sim/player/playerOps';
import type { Design } from '../sim/design';
import { PendingOnce, PendingValues } from './pendingCommands';
// [troops] end
import { moneyPanelIncome, moneyPanelWriteDue } from '../sim/treasury';
import { countLabel } from './plural';
// [policy] begin
import { toggleEmpirePolicy } from './screens/empirePolicy';
// [policy] end

// [intel] begin
import { toggleIntelligenceScreen } from './screens/intelligence';
// [intel] end
import { createSelectionActionBar, performAction, redrawSelectionActionBar, refreshSelectionActionBar, setSelectionExtraSlots, setSelectionIconResolvers, selectionShipIconUrl, type SelectionExtraSlot } from './orderMenu'; // [ordermenu]
import { buildInfoModel, retrofitProgressPercent, type InfoTarget } from './selectionInfo';
import { renderInfoModel } from './selectionInfoView';
import './selectionPanel.css';
import { builtObjectImageUrl, resolveDrawPictureRef } from '../render/builtObjectLayer';
import { createCharterButton } from './screens/charters'; // [charters]
import { setTextIfChanged } from '../render/drawCache';
import { CREATURE_FRAME_SETS, creatureFrameSetIndexes, creatureFrameUrls } from '../render/creatureLayer';
import type { Creature } from '../sim/creature';
import { Fighter } from '../sim/combat/fighters';

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

/** Hover hints of the HUD controls: port of Main.Part10.cs method_206 (the
 * control-under-cursor switch; TextResolver.GetText English text plus the
 * shortcut in brackets). Tooltips and toasts use these, never control names. */
export const CONTROL_HINTS: Record<string, string> = {
    btnGameSpeedIncrease: 'Increase game speed (+)',
    btnGameSpeedDecrease: 'Decrease game speed (-)',
    btnGalacticHistory: 'Open Galactic History screen',
    btnHistoryMessages: 'Open Message History screen (H)',
    btnHelp: 'Open Galactopedia Help screen (F1)',
    tbtnBuiltObjects: 'Open Ships and Bases screen (F11)',
    tbtnColonies: 'Open Colonies screen (F2)',
    tbtnConstructionYards: 'Open Construction Yards screen (F10)',
    tbtnDesigns: 'Open Designs screen (F8)',
    tbtnEmpires: 'Open Diplomacy screen (F5)',
    tbtnGalaxyMap: 'Open Galaxy Map screen (G)',
    tbtnIntelligenceAgents: 'Open Intelligence Agents screen (F4)',
    tbtnResearch: 'Open Research screen (F7)',
    tbtnShipGroups: 'Open Fleets screen (F12)',
    tbtnTroops: 'Open Troops screen',
    btnEmpirePolicy: 'Open Empire Policy screen',
    btnBuildOrder: 'Open Build Order screen (F9)',
    btnGameEditor: 'Switch to Game Editor',
    btnEmpireGraphs: 'Open Empire Comparison and Victory Conditions (V)',
    btnEmpireSummary: 'Open Your Empire Summary screen (F6)',
    btnExpansionPlanner: 'Open Expansion Planner screen (F3)',
    btnGameMenu: 'Show Game Menu: load & save, options, exit (Esc)',
    lstMessages: 'Messages: click a message for more information',
};

/** Hover hint of a HUD control (CONTROL_HINTS), '' when it has none. */
export function controlHint(name: string): string {
    return CONTROL_HINTS[name] ?? '';
}

/** Toast text for a control whose screen is not ported yet: its hint without
 * the "Open"/"Switch to" verb and the shortcut, e.g. "Empire Policy screen —
 * not yet available". Never the internal control name. */
export function unavailableControlText(name: string): string {
    const hint = controlHint(name)
        .replace(/\s*\([^)]*\)$/, '')
        .replace(/^(Open|Switch to)\s+/, '');
    return `${hint || 'This screen'} — not yet available`;
}

/** Pause button hint (Main.Part10.cs method_206 btnPlayPause). */
export function playPauseHint(paused: boolean): string {
    return paused ? 'Resume the game' : 'Pause the game (Pause or Spacebar)';
}

/** Cycle chip hints (Main.Part10.cs method_206 btnCycle*). */
export const CYCLE_CHIP_HINTS: Record<CycleKind, string> = {
    colonies: 'Next Colony (C)',
    bases: 'Next Space Port (P)',
    military: 'Next Military ship (M)',
    construction: 'Next Construction ship (Y)',
    other: 'Next Exploration or Colony ship (X)',
    fleets: 'Next Fleet (F)',
    idleShips: 'Next Idle ship (I)',
};

/** Toast when a cycler has nothing to select (the original silently does
 * nothing; this is UI feedback only, never an empire message). */
export function cycleEmptyText(kind: CycleKind): string {
    const what: Record<CycleKind, string> = {
        colonies: 'colonies',
        bases: 'space ports',
        military: 'military ships',
        construction: 'construction ships',
        other: 'exploration or colony ships',
        fleets: 'fleets',
        idleShips: 'idle ships',
    };
    return `No ${what[kind]} to cycle`;
}

/** Planet-level ("100%") camera zoom: 1 px per world unit. */
export const PLANET_LEVEL_ZOOM = 1;

// ---------------------------------------------------------------------------
// UI scale (task 10f): each HUD element is scaled about its anchored corner so
// the panel edges stay pinned to the screen edge/corner at any scale. The top
// strip (topBar.ts) is the original's pixels scaled by one factor about the
// screen's top-left corner, each element at its scaled original position, so
// the strip grows as one; the bottom-left selection frame scales from its
// bottom-left corner, the bottom-right options list from bottom-right.
// ---------------------------------------------------------------------------

const TOP_NAMES: ReadonlySet<string> = new Set(TOP_ELEMENT_NAMES);

/** CSS `transform-origin` for a HUD element name given its layout rect. Pure
 * (no window access) so node-based tests can exercise the mapping. */
export function hudTransformOrigin(name: string, _rect: Rect, _viewportWidth?: number): string {
    if (name === 'pnlOptionsList' || name === 'pnlSystemMap') return '100% 100%'; // bottom-right anchored
    if (TOP_NAMES.has(name)) return '0 0'; // top strip: positioned at its scaled original position
    if (name === 'pnlSelection') return '0 100%'; // bottom-left anchored
    return '0 0'; // default: top-left anchored
}

/** Place the top strip (topBar.ts): every element at (original x, y) × k with its original size and
 * `scale(k)`, k = topBarScale (window height × UI scale, capped by the width). */
function placeTopStrip(refs: HudRefs): void {
    const k = topBarScale(window.innerWidth, window.innerHeight, uiScaleFactor());
    const rects = topBarLayout(window.innerWidth / k);
    for (const [name, el] of refs.elements) {
        const r = rects[name];
        if (!r) continue;
        el.style.left = `${r.x * k}px`;
        el.style.top = `${r.y * k}px`;
        el.style.right = '';
        el.style.bottom = '';
        el.style.width = `${r.w}px`;
        el.style.height = `${r.h}px`;
        el.style.transformOrigin = '0 0';
        el.style.transform = k === 1 ? '' : `scale(${k})`;
    }
}

/** Apply the UI scale setting to every HUD element: `transform: scale(s)`
 * about the element's anchored corner (see {@link hudTransformOrigin}). A
 * factor of 1 clears the transform entirely. */
export function applyHudScale(refs: HudRefs): void {
    const s = uiScaleFactor();
    const layout = computeHudLayout(window.innerWidth, window.innerHeight);
    const selScale = selectionFrameScale(window.innerHeight, s, selectionPanelSmall());
    const mapScale = systemMapFrameScale(window.innerWidth, window.innerHeight, s, systemMapSmall(), selScale);
    for (const [name, el] of refs.elements) {
        if (TOP_NAMES.has(name)) continue;
        const rect = layout[name];
        if (!rect) continue;
        el.style.transformOrigin = hudTransformOrigin(name, rect, window.innerWidth);
        // The selection frame and the system map are drawn in the original's pixels and scale with the window height
        // (4K / HiDPI) like the top strip (HUD_FRAME_SIZE × UI scale).
        const k = name === 'pnlSelection' ? selScale : name === 'pnlSystemMap' ? mapScale : s;
        el.style.transform = k === 1 ? '' : `scale(${k})`;
        if (name === 'pnlSelection') anchorSelectionPanel(el, rect);
    }
    anchorOptionsAboveSystemMap(refs, s, mapScale);
    placeTopStrip(refs);
}

/** The "View" popup sits right above the system mini-map's top-right corner: its bottom is the map's scaled top (the
 * map scales by `mapScale` from its bottom-right corner, both sizes) plus the gap at the popup's own scale. Without a
 * map it keeps its own rect. */
function anchorOptionsAboveSystemMap(refs: HudRefs, s: number, mapScale: number): void {
    const opts = refs.elements.get('pnlOptionsList');
    if (opts === undefined || !refs.elements.has('pnlSystemMap')) return;
    const layout = computeHudLayout(window.innerWidth, window.innerHeight);
    const map = layout['pnlSystemMap'];
    if (map === undefined) return;
    const mapBottom = Math.max(0, window.innerHeight - map.y - map.h);
    opts.style.top = '';
    opts.style.bottom = `${mapBottom + SYSTEM_MAP_PANEL_H * mapScale + OPTIONS_ABOVE_MAP_GAP * s}px`;
}

/** Right / bottom anchoring for the bottom-right elements (task 10e): they never clip past the screen edge. */
function anchorBottomRight(el: HTMLElement, name: string, rect: Rect): void {
    if (name !== 'pnlOptionsList' && name !== 'pnlSystemMap') return;
    el.style.left = '';
    el.style.right = `${Math.max(0, window.innerWidth - rect.x - rect.w)}px`;
    if (name === 'pnlSystemMap' || rect.h === 0) {
        el.style.top = '';
        el.style.bottom = `${Math.max(0, window.innerHeight - rect.y - rect.h)}px`;
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
    // [freightOverlay] begin — task 19e-9: the Freight Flows / Trade Hubs rows' "…" opens the Trade Flows panel.
    openTradeFlows?: () => void;
    // [freightOverlay] end
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
    /** Open the Galaxy Map screen with a habitat's system selected (the screens' "Show On Galaxy Map", method_169). */
    openGalaxyMapAt?: (h: Habitat) => void;
    /** Task followcam: shared with the Main View (src/render/mainView.ts), which recentres the camera on it
     * every frame and clears it on a manual pan/edge-scroll/map-click/target-loss. The selection panel's Follow
     * toggle (shown only for a selected ship/fleet) flips it here; a selection change also clears it
     * (followOnSelectionChanged) unless it is the same object already being followed. */
    followState?: FollowState;
}

export interface Selection {
    habitat: Habitat;
    system: SystemInfo;
    /** Task 13c: the selected ship/base when cycling Bases/Military/Constr./
     * Other. `habitat` is then the nearest system's star. */
    builtObject?: BuiltObject;
    /** [15c] The selected fleet; `builtObject` is then its lead ship and `habitat` the nearest star. */
    shipGroup?: ShipGroup;
    /** A selected space creature (InfoPanel.cs DrawCreature). `habitat` is then its nearest system's star. */
    creature?: Creature;
    /** A selected launched fighter (InfoPanel.cs 3495 DrawFighter; picked on the map, Main.Part11.cs 1579-1600).
     *  `habitat` is then its nearest system's star. */
    fighter?: Fighter;
    /** Several selected ships (the C# BuiltObjectList selection: a left-drag box or Shift-clicks), 2+ entries;
     * `builtObject` / `shipGroup` are then unset and `habitat` is the first ship's nearest system star. */
    builtObjects?: BuiltObject[];
    /** A system star picked at galaxy / sector zoom: the panel shows the system (InfoPanel.cs DrawSystemInfo, the C#
     *  SystemInfo selection) instead of the star. Set by the panel from the camera zoom when left undefined. */
    systemInfo?: boolean;
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

// Multi-selection hook (BuiltObjectList, Main.Part10.cs 2989 mainView_MouseUp → method_208(builtObjectList2)):
// buildSelectionPanel registers it; the Main View's drag box / Shift-click and the order layer call it.
let builtObjectListSelectHandler: ((list: BuiltObject[]) => void) | null = null;
/** Select several ships (2+; one ship is a normal ship selection, none clears it). */
export function selectBuiltObjectList(list: readonly BuiltObject[]): void {
    builtObjectListSelectHandler?.(list.slice());
}

/**
 * InfoPanel.cs 5059 DrawBuiltObjectSelection: the multi-selection's summary line — "N ships, F firepower, B boarding
 * strength, T troops (S strength)" (the player's / viewable ships; others get just the count).
 */
export function multipleShipsSummary(ships: readonly BuiltObject[], galaxy: Galaxy | null, detailed: boolean): string {
    const n = countLabel(ships.length, 'ship');
    if (!detailed) return n;
    let firepower = 0;
    let boarding = 0;
    let troops = 0;
    let troopStrength = 0;
    for (const bo of ships) {
        firepower += bo.firepowerRaw;
        if (galaxy !== null) boarding += calculateAvailableAssaultPodAttackStrength(galaxy, bo, galaxy.nowMs);
        if (bo.troops !== null) {
            troops += bo.troops.items.length;
            troopStrength += bo.troops.totalAttackStrength;
        }
    }
    return `${n}, ${firepower} firepower, ${boarding.toFixed(0)} boarding strength, ${troops} troops (${troopStrength} strength)`;
}

/** Test hook: set the current selection directly (bypasses the panel's own
 * setter, which also refreshes its DOM). */
export function setSelection(sel: Selection | null): void {
    currentSelection = sel;
}

// Creature selection hook: buildSelectionPanel registers it; the Main View's creature click calls selectCreature.
let creatureSelectHandler: ((c: Creature, moveView: boolean) => void) | null = null;
export function selectCreature(c: Creature, moveView = false): void {
    creatureSelectHandler?.(c, moveView);
}

// Fighter selection hook: buildSelectionPanel registers it; the Main View's fighter click calls selectFighter.
let fighterSelectHandler: ((f: Fighter) => void) | null = null;
export function selectFighter(f: Fighter): void {
    fighterSelectHandler?.(f);
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

/** F11 / the top-bar Ships and Bases button (Main.Part9.cs tbtnBuiltObjects_Click): toggle the Ships and Bases window. */
export function toggleShipsAndBases(filter?: BuiltObjectFilter): void {
    const src = getEmpireSummarySource();
    if (!src) return;
    const sel = getSelection();
    toggleShipsAndBasesList({
        empire: src.empire,
        filter,
        selected: sel ? (sel.builtObject ?? sel.builtObjects?.[0] ?? sel.habitat) : null,
        // Select / Go to / double click select the ship/base (or colony) and move the view to it.
        onSelect: (bo) => selectStellarObject(bo, false),
        onZoomTo: (bo) => selectStellarObject(bo, true),
        // View Fleet (Main.Part6.cs btnBuiltObjectViewShipGroup_Click): the Fleets window on that fleet.
        onViewFleet: (sg) => toggleFleets(sg),
    });
}

/** The Construction Yards screen's callbacks (top-bar tbtnConstructionYards and F10). */
export function constructionYardsOptions(empire: Empire): ConstructionYardsOptions {
    return {
        empire,
        onSelect: (t) => selectStellarObject(t, true),
        onSelectOnly: (t) => selectStellarObject(t, false),
        onViewFleet: (sg) => toggleFleets(sg),
        // The header's filter combo: another filter opens the Ships and Bases screen on it.
        onOpenShipsAndBases: (f) => {
            closeShipsAndBasesList();
            toggleShipsAndBases(f as BuiltObjectFilter);
        },
    };
}

/** F12 / the top-bar Fleets button (Main.Part9.cs tbtnShipGroups_Click), optionally on one fleet (View Fleet). */
export function toggleFleets(selected?: ShipGroup): void {
    const src = getEmpireSummarySource();
    if (!src) return;
    toggleFleetsList({
        empire: src.empire,
        selected,
        onSelect: (sg) => selectShipGroup(sg, true),
        // Select Fleet (method_208): select without moving the view.
        onSelectOnly: (sg) => selectShipGroup(sg, false),
        // The info panel's hotspots: a ship selects it; the fleet itself is the selection already.
        onTarget: (t) => {
            if (t.kind !== 'select' || t.obj instanceof ShipGroup) return;
            if (t.obj instanceof Fighter) selectFighter(t.obj);
            else selectStellarObject(t.obj, false);
        },
        // Home Base / Attack Point (Main.Part7.cs SetFleetHomeBase / SetFleetAttackPoint): the fleet is selected and the
        // next map click picks the point.
        onPickPoint: (sg, mode) => {
            selectShipGroup(sg, false);
            void performAction(fleetShipAction(mode, sg), false);
        },
        // The Fleet Settings panel (an Improvement; the button is hidden while it is off).
        onOpenSettings: (sg) => openFleetSettingsFor(sg),
    });
}

/** The Fleet Settings panel (an Improvement, screens/fleetSettings.ts) on `sg` (else the first fleet); nothing while
 *  the improvement is off. Pick on Map selects the fleet and arms the next map click, as the Fleets window does. */
export function openFleetSettingsFor(sg: ShipGroup | null): void {
    const src = getEmpireSummarySource();
    if (!src || !isImprovementEnabled('fleetSettings')) return;
    openFleetSettings({
        empire: src.empire,
        fleet: sg,
        onPickPoint: (fleet, mode) => {
            selectShipGroup(fleet, false);
            void performAction(fleetShipAction(mode, fleet), false);
        },
        onSelectShip: (ship) => selectStellarObject(ship, true),
        onOpenDesigns: () => toggleShipDesigns({ empire: src.empire }),
        onOpenFleetDesigns: () => {
            closeFleetsList();
            toggleFleetsList({
                empire: src.empire,
                tab: 'designs',
                onSelect: (f) => selectShipGroup(f, true),
                onSelectOnly: (f) => selectShipGroup(f, false),
            });
        },
    });
}

/** Q: the Fleet Settings panel on the selected fleet (or the selected own ship's fleet); a toast without one. */
export function openFleetSettingsForSelection(): void {
    const src = getEmpireSummarySource();
    if (!src || !isImprovementEnabled('fleetSettings')) return;
    if (isFleetSettingsOpen()) {
        closeFleetSettings();
        return;
    }
    const sg = fleetForSelection(src.empire, currentSelection);
    if (sg === null) {
        showToast('Select one of your fleets to open its Fleet Settings');
        return;
    }
    openFleetSettingsFor(sg);
}

/** Build the HUD overlay and append it to document.body. */
/** HudWiring.openGalaxyMapAt of the running HUD (the Colonies screen's "Show On Galaxy Map"). */
let galaxyMapAt: ((h: Habitat) => void) | null = null;

/** Open / close the Colonies screen for the player's empire (top-bar Colonies button and F2) with the HUD's actions:
 *  Select Colony = method_208 (select, view stays), Go to Colony = method_157 (select + move), Show On Galaxy Map,
 *  Show Expansion Planner, Show Construction Summary and the Galactopedia links. */
export function toggleColoniesFromHud(empire: Empire, selected: Habitat | null = null): void {
    toggleColoniesScreen({
        empire,
        selected,
        onSelect: (h) => selectHabitat(h, false),
        onGoTo: (h) => selectHabitat(h, true),
        onShowOnGalaxyMap: galaxyMapAt ?? undefined,
        onExpansionPlanner: () => toggleExpansionPlanner({ empire, onSelect: (h) => selectHabitat(h, true) }),
        onHelp: (topic) => openGalactopedia({ topic }),
        confirmAutomationOff: (task) => confirmAutomationOff(task),
    });
}

/** btnMessageHistoryGoto_Click (Main.Part4.cs:1967): method_156(x, y) + method_4(1.0) — centre at planet zoom. */
export function historyGoTo(cam: Camera | undefined, x: number, y: number): void {
    if (!cam) return;
    cam.centerOn(x, y);
    cam.zoomAt(PLANET_LEVEL_ZOOM, cam.width / 2, cam.height / 2);
}

export function createHud(wiring: HudWiring = {}): HudRefs {
    destroyHudListeners(); // a HUD still running from a view that was not torn down (hudLifetime.ts)
    galaxyMapAt = wiring.openGalaxyMapAt ?? null;
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
    bindAutoPauseClock(clock, () => getSettings().autoPauseInPopup);
    const gameMenu = createGameMenu(clock, {
        onMainMenu: wiring.onMainMenu,
        // [gameoptions] the Escape menu's Options opens the Game Options screen (same as O).
        onOptions: () => {
            // Without a player empire (a view with no game behind it) the window edits the new-game defaults.
            const src = getEmpireSummarySource();
            openGameOptionsPanel({ empire: src?.empire ?? null });
        },
    });
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
            case 'btnTopMore':
                el = buildTopMoreButton(wiring);
                break;
            case 'tbtnResearch':
                el = buildResearchButton(wiring);
                break;
            case 'btnEmpireSummary':
                el = buildEmpireSummaryButton(wiring);
                break;
            case 'pnlSelection':
            {
                // buildSelectionPanel installs its refresh callback on the object it is
                // given; expose that callback as the HUD's selection hook.
                const panelWiring: HudWiring = { ...wiring };
                el = buildSelectionPanel(panelWiring);
                // btnSelectionPanelSize: re-apply the frame scale for the new content size.
                el.addEventListener('sel-resize', () => applyHudScale(refs));
                wiring.onSelectionChange = panelWiring.onSelectionChange;
                refs.onSelectionChange = panelWiring.onSelectionChange;
                break;
            }
            case 'pnlOptionsList':
                el = buildOptionsPopup(buildOptionsList({ ...wiring, overlays }));
                break;
            case 'pnlSystemMap':
                // The original's bottom-right system mini-map (hudSystemMap.ts); needs the galaxy and the camera.
                if (wiring.galaxy === undefined || wiring.camera === undefined) continue;
                {
                    const cam = wiring.camera;
                    el = buildHudSystemMap({
                        galaxy: wiring.galaxy,
                        camera: cam,
                        onGalaxyMap: wiring.onGalaxyMap,
                        onZoomSelection: () => zoomToSelectedItem(cam),
                        hasSelection: () => selectionViewTarget(currentSelection) !== null,
                        // The size toggle: re-apply the frame scale (and the View popup's anchor above it).
                        onResize: () => applyHudScale(refs),
                    });
                }
                break;
            case 'tbtnEmpires':
                el = buildDiplomacyButton(wiring);
                break;
            default:
                el = buildTopBarButton(name, wiring);
                break;
        }
        el.classList.add('hud-el');
        el.dataset.hud = name;
        // The top strip is placed by applyHudScale (placeTopStrip) in the original's pixels.
        if (!TOP_NAMES.has(name)) applyRect(el, rect);
        // Task 10e: right-anchored panels position via `right` (not a computed
        // left) so they can never clip past the screen edge. The options list
        // is content-sized (rect.h === 0): anchor it to the window's
        // bottom-right corner instead of a fixed top offset; the mini-map too.
        anchorBottomRight(el, name, rect);
        if (name === 'pnlSelection') anchorSelectionPanel(el, rect);
        root.appendChild(el);
        elements.set(name, el);
    }

    // The left sidebar (the original's Empire Navigation Tool, ItemListCollectionPanel): category buttons + item list.
    // ItemListPanel.cs 2384: a hovered row's red travel vectors fall back to the ships flying to the selection.
    setListHoverSelectionSource(() => currentSelection);
    const leftSidebar = createLeftSidebar(wiring);
    root.appendChild(leftSidebar);
    elements.get('pnlSelection')?.addEventListener('sel-resize', () => relayoutLeftSidebar(leftSidebar));

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
    onHudDestroyed(onSettingsChange(() => applyHudScale(refs)));

    document.body.appendChild(root);
    return refs;
}

/** Space kept free above the bottom-left selection panel: the top-left bar
 * (y 10-50) plus a margin, in unscaled CSS px. */
export const SELECTION_PANEL_TOP_RESERVE = 70;

/** Max CSS height of the selection panel so that, scaled by `scale` about its
 * bottom-left corner and anchored `bottomGap` px above the window bottom, it
 * never extends above SELECTION_PANEL_TOP_RESERVE. */
export function selectionPanelMaxHeight(viewportHeight: number, bottomGap: number, scale: number): number {
    return Math.max(120, Math.floor((viewportHeight - bottomGap - SELECTION_PANEL_TOP_RESERVE) / scale));
}

/** The selection panel grows with its content (a ship has more rows than a
 * planet), so it is anchored to the bottom edge with a content height capped
 * by selectionPanelMaxHeight; its body scrolls beyond that (hud.css). */
function anchorSelectionPanel(el: HTMLElement, rect: Rect): void {
    const bottomGap = Math.max(0, window.innerHeight - rect.y - rect.h);
    el.style.top = '';
    el.style.bottom = `${bottomGap}px`;
    el.style.width = `${rect.w}px`;
    el.style.height = `${rect.h}px`;
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
        if (TOP_NAMES.has(name)) continue; // placed by applyHudScale
        const rect = layout[name];
        if (rect) applyRect(el, rect);
        // Task 10e: keep the right-anchored options list and mini-map pinned to the bottom-right corner.
        if (rect) anchorBottomRight(el, name, rect);
        if (name === 'pnlSelection' && rect) anchorSelectionPanel(el, rect);
    }
    // Task 10f: keep the UI scale applied after a re-layout.
    applyHudScale(refs);
}

// ---------------------------------------------------------------------------
// Element builders
// ---------------------------------------------------------------------------

/** A GlassButton of the top strip (DistantWorlds.Controls GlassButton, the selection frame's `.sel-glass` look) at
 * its original-pixel rect inside its element, with its SetCornerCurves corners. */
function topGlass(cls: string, corners: CornerCurves, title: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `sel-glass top-glass ${cls}`;
    b.style.borderRadius = cornerRadiusCss(corners);
    b.title = title;
    return b;
}

function chromeImg(file: string, cls = ''): HTMLImageElement {
    const img = document.createElement('img');
    img.src = `/assets/dwu/images/ui/chrome/${file}`;
    img.alt = '';
    img.draggable = false;
    if (cls) img.className = cls;
    return img;
}

/** lstMessages (Main.Part12.cs 1724-1726; ScrollingLinkList.cs): the 668 × 80 dark box with the top-left and
 * bottom-left corners curved, its lines centred in (170,170,170), newest at the bottom; a new line scrolls in from
 * below. The envelope (Message History) and hourglass (Galactic History) are their own buttons beside it. */
function buildMessagesPanel(): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'top-ticker';
    panel.title = controlHint('lstMessages');
    const lines = document.createElement('div');
    lines.className = 'hud-message-lines';
    for (let i = 0; i < MESSAGE_LINES; i++) {
        const line = document.createElement('div');
        line.className = 'hud-message-line';
        lines.appendChild(line);
    }
    panel.appendChild(lines);
    return panel;
}

/** Top-left: btnGameMenu + btnHelp (40 × 40 at y 10), btnPlayPause (80 × 34 at y 62), the slower ">" / faster ">>>"
 * buttons (40 × 20 at y 96) and the date + speed text at (12, 120) — Main.Part12.cs 1790-1804, MainView.cs
 * method_18. main.ts keeps them current through {@link refreshTopLeftControls}. */
function buildTopLeftBar(clock: GalaxyTime, onGameMenu: () => void): HTMLElement {
    const area = document.createElement('div');
    area.className = 'top-left';
    const spec = (name: string) => TOP_LEFT_BUTTONS.find((b) => b.name === name)!;
    const place = (b: HTMLElement, name: string): HTMLElement => {
        const r = spec(name);
        b.style.left = `${r.x}px`;
        b.style.top = `${r.y}px`;
        b.style.width = `${r.w}px`;
        b.style.height = `${r.h}px`;
        b.dataset.ctl = name;
        area.appendChild(b);
        return b;
    };
    // The game menu button toggles the in-game Escape menu (task 10c).
    const menu = topGlass('top-btn', spec('btnGameMenu').corners, controlHint('btnGameMenu'));
    menu.appendChild(chromeImg('gameOptionsButton.png'));
    menu.addEventListener('click', () => onGameMenu());
    place(menu, 'btnGameMenu');
    // Main.Part5.cs btnHelp_Click: toggle the Galactopedia at the selection's topic.
    const help = topGlass('top-btn', spec('btnHelp').corners, controlHint('btnHelp'));
    help.appendChild(chromeImg('galactopediaButton.png'));
    help.addEventListener('click', () => toggleGalactopedia(helpTopicKeyForHabitat(getSelection()?.habitat ?? null)));
    place(help, 'btnHelp');

    const pauseBtn = topGlass('top-btn', spec('btnPlayPause').corners, playPauseHint(clock.paused));
    pauseBtn.dataset.hudCtl = 'playPause'; // stable hook (the title follows the clock state)
    pauseBtn.appendChild(chromeImg(playPauseImage(clock.paused)));
    place(pauseBtn, 'btnPlayPause');
    const dec = topGlass('top-btn top-speed', spec('btnGameSpeedDecrease').corners, controlHint('btnGameSpeedDecrease'));
    dec.dataset.hudCtl = 'slower';
    dec.textContent = '>';
    place(dec, 'btnGameSpeedDecrease');
    const inc = topGlass('top-btn top-speed', spec('btnGameSpeedIncrease').corners, controlHint('btnGameSpeedIncrease'));
    inc.dataset.hudCtl = 'faster';
    inc.textContent = '>>>';
    place(inc, 'btnGameSpeedIncrease');

    const dateEl = document.createElement('span');
    dateEl.className = 'hud-date top-text-shadow';
    dateEl.style.left = `${TOP_DATE_POS.x}px`;
    dateEl.style.top = `${TOP_DATE_POS.y}px`;
    area.appendChild(dateEl);

    const refresh = (): void => refreshTopLeftControls(area, clock);
    pauseBtn.addEventListener('click', () => {
        clock.togglePause();
        refresh();
    });
    dec.addEventListener('click', () => {
        clock.slower();
        refresh();
    });
    inc.addEventListener('click', () => {
        clock.faster();
        refresh();
    });
    refresh();
    return area;
}

/** btnPlayPause's image (Main.Part12.cs LoadUiChromeButtons): bitmap_46 pauseresume_Pause.png while paused,
 * bitmap_45 pauseresume_Play.png while running. */
export function playPauseImage(paused: boolean): string {
    return paused ? 'pauseresume_Pause.png' : 'pauseresume_Play.png';
}

/** Speed button enabled states (Main.Part12.cs 3336-3352): slower off at 0.25x, faster off at 4x. */
export function speedButtonsEnabled(speed: number): { slower: boolean; faster: boolean } {
    return { slower: speed > 0.25, faster: speed < 4 };
}

/** Sync the top-left controls with the clock: date + speed text, the pause image / hint and the speed buttons'
 * enabled states. Written only on change (main.ts calls it 4× a second). `area` is the pnlTopLeftBar element. */
export function refreshTopLeftControls(area: HTMLElement | null | undefined, clock: { paused: boolean; speed: number; currentStarDate: number }): void {
    if (!area) return;
    const date = area.querySelector<HTMLElement>('.hud-date');
    if (date) setTextIfChanged(date, formatClockLabel(clock.currentStarDate, clock.speed));
    const pause = area.querySelector<HTMLButtonElement>('button[data-hud-ctl="playPause"]');
    if (pause) {
        const hint = playPauseHint(clock.paused);
        if (pause.title !== hint) pause.title = hint;
        const img = pause.querySelector('img');
        const src = `/assets/dwu/images/ui/chrome/${playPauseImage(clock.paused)}`;
        if (img && img.getAttribute('src') !== src) img.setAttribute('src', src);
    }
    const en = speedButtonsEnabled(clock.speed);
    const slower = area.querySelector<HTMLButtonElement>('button[data-hud-ctl="slower"]');
    if (slower && slower.disabled === en.slower) slower.disabled = !en.slower;
    const faster = area.querySelector<HTMLButtonElement>('button[data-hud-ctl="faster"]');
    if (faster && faster.disabled === en.faster) faster.disabled = !en.faster;
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

/** Run a top-strip control's click (Main.Part*.cs tbtn* / btn*_Click → the matching screen toggle, like its
 * hotkey). Controls whose screen is not ported toast "not yet available". */
function openTopBarScreen(name: string, wiring: HudWiring): void {
    const src = getEmpireSummarySource();
    switch (name) {
        // [15b] tbtnResearch → Research screen (Main.Part9.cs tbtnResearch_Click; task 15b).
        case 'tbtnResearch':
            if (src) toggleResearchScreen({ empire: src.empire });
            return;
        // [16a] btnExpansionPlanner → Expansion Planner (Main.Part4.cs:2974 btnExpansionPlanner_Click).
        case 'btnExpansionPlanner':
            if (src) toggleExpansionPlanner({ empire: src.empire, onSelect: (h) => selectHabitat(h, true) });
            return;
        // [policy] btnEmpirePolicy → Empire Policy panel (Main.Part2.cs:1184 btnEmpirePolicy_Click; task 17d).
        case 'btnEmpirePolicy':
            if (src) toggleEmpirePolicy({ empire: src.empire });
            return;
        // [troops] tbtnTroops → Troops screen (Main.Part9.cs:3129 tbtnTroops_Click; no hotkey in Main_KeyUp).
        case 'tbtnTroops': {
            const galaxy = src?.empire.galaxy;
            if (src && galaxy) {
                toggleTroopsScreen({
                    galaxy,
                    empire: src.empire,
                    onGoTo: (t) => selectStellarObject(t, true),
                    confirmAutomationOff: (task) => confirmAutomationOff(task),
                });
            }
            return;
        }
        // [intel] tbtnIntelligenceAgents → Intelligence Agents / Characters (Main.Part6.cs:3231).
        case 'tbtnIntelligenceAgents':
            if (src) toggleIntelligenceScreen({ player: src.empire, onZoomTo: (t) => selectStellarObject(t, true) });
            return;
        // [leftovers] btnGalacticHistory → Galactic History (Main.Part3.cs:46 btnGalacticHistory_Click).
        case 'btnGalacticHistory':
            if (src) toggleGalacticHistory({ empire: src.empire, mode: 'galactichistory', onGoTo: (x, y) => historyGoTo(wiring.camera, x, y) });
            return;
        // btnGameEditor: our barebones Game Editor (screens/gameEditor.ts; not the original's editor).
        case 'btnGameEditor':
            if (src) toggleGameEditor(src.empire);
            return;
        // Main.Part9.cs tbtnColonies_Click: toggle the Colonies screen (pnlColonyInfo, Main.Part11.cs method_166).
        case 'tbtnColonies':
            if (src) toggleColoniesFromHud(src.empire);
            return;
        // Main.Part8.cs btnEmpireSummary_Click.
        case 'btnEmpireSummary':
            toggleEmpireSummary();
            return;
        // Main.Part4.cs:2016 btnHistoryMessages_Click: the same pnlMessageHistory as btnGalacticHistory, opened with
        // method_528("either") (the last filter, unless it was Galactic History).
        case 'btnHistoryMessages':
            if (src) toggleGalacticHistory({ empire: src.empire, mode: 'either', onGoTo: (x, y) => historyGoTo(wiring.camera, x, y) });
            return;
        // Main.Part9.cs tbtnBuiltObjects_Click.
        case 'tbtnBuiltObjects':
            toggleShipsAndBases();
            return;
        // [16c] btnBuildOrder → Build Order (Main.Part2.cs:1196); tbtnConstructionYards → Construction Yards (Main.Part6.cs:3243).
        case 'btnBuildOrder':
            if (src) {
                toggleBuildOrder({ empire: src.empire });
                attachBuildQueueLauncher({ empire: src.empire, onGoto: (t) => selectStellarObject(t, true) }); // [buildQueue]
            }
            return;
        case 'tbtnConstructionYards':
            if (src) toggleConstructionYards(constructionYardsOptions(src.empire));
            return;
        // [15c] tbtnShipGroups → Fleets list (Main.Part9.cs:3153 tbtnShipGroups_Click).
        case 'tbtnShipGroups':
            toggleFleets();
            return;
        // [16b] tbtnDesigns → Designs panel (Main.Part9.cs:4339 tbtnDesigns_Click; fleet designs are its tab).
        case 'tbtnDesigns':
            if (src) toggleShipDesigns({ empire: src.empire });
            return;
        // Main.Part7.cs 2037 btnEmpireGraphs_Click: Empire Comparison and Victory Conditions (V).
        case 'btnEmpireGraphs':
            if (src) toggleEmpireComparison({ player: src.empire });
            return;
        case 'tbtnEmpires':
            openDiplomacy(wiring);
            return;
        default:
            console.log(`TODO(screen): ${name}`);
            showToast(unavailableControlText(name));
    }
}

/** A row / history button: the GlassButton with its chrome image (LoadUiChromeButtons), its hint and click. */
function buildTopBarButton(name: string, wiring: HudWiring): HTMLElement {
    const spec = TOP_ROW_BUTTONS.find((b) => b.name === name);
    const corners: CornerCurves = spec?.corners
        ?? (name === 'btnHistoryMessages' ? [false, true, false, false] : name === 'btnGalacticHistory' ? [false, false, true, false] : [false, false, false, false]);
    const btn = topGlass('top-btn', corners, controlHint(name));
    const file = chromeButtonFile(name);
    if (file) btn.appendChild(chromeImg(file));
    btn.addEventListener('click', () => openTopBarScreen(name, wiring));
    return btn;
}

/** tbtnEmpires: the diplomacy button (diplomacyButton.png) → the Diplomacy screen (F5), whose empire list is one
 * click away (the Empires list window keeps its own zoom-to). */
function buildDiplomacyButton(wiring: HudWiring): HTMLElement {
    return buildTopBarButton('tbtnEmpires', wiring);
}

function openDiplomacy(wiring: HudWiring): void {
    const galaxy = wiring.galaxy;
    const game = wiring.game;
    if (!galaxy || !game) return;
    const playerEmpire = game.playerEmpire as Empire;
    const openList = (): void => toggleEmpiresList({
        empires: galaxy.empires,
        playerEmpire,
        onZoomTo: (habitat) => {
            const cam = wiring.camera;
            if (!cam) return;
            // Centre on the habitat at System zoom.
            cam.centerOn(habitat.xpos, habitat.ypos);
            cam.zoomAt(SYSTEM_LEVEL_ZOOM, cam.width / 2, cam.height / 2);
        },
    });
    toggleDiplomacyScreen({
        player: playerEmpire,
        onOpenEmpiresList: openList,
        onGoTo: (habitat) => {
            const cam = wiring.camera;
            if (!cam) return;
            cam.centerOn(habitat.xpos, habitat.ypos);
            cam.zoomAt(SYSTEM_LEVEL_ZOOM, cam.width / 2, cam.height / 2);
        },
    });
}

/** btnEmpireSummary: the player's flag (Empire.LargeFlagPicture scaled to 50 × 30, Main.Part12.cs 2904) — or the
 * scenario emblem that replaces it — opening the Empire Summary (F6). */
function buildEmpireSummaryButton(wiring: HudWiring): HTMLElement {
    const btn = buildTopBarButton('btnEmpireSummary', wiring);
    const galaxy = wiring.galaxy;
    const empire = wiring.game?.playerEmpire as Empire | undefined;
    if (galaxy && empire) {
        const flag = document.createElement('img');
        flag.className = 'top-flag';
        flag.alt = '';
        flag.draggable = false;
        btn.appendChild(flag);
        void empireFlagUrl(galaxy, empire).then((url) => {
            flag.src = url;
        });
    }
    return btn;
}

/** tbtnResearch (ResearchButton.cs): research.png at (7, 9) and, per field (weapons / energy / high tech at y 5 / 23
 * / 41), the progress of the project at the head of its queue in the field's colour ("58%", "  -----" when idle). */
// TODO(port): the 14 px project icon left of each percentage (component / facility / fighter / troop image at 70%
// alpha) — ResearchButton.cs GenerateNodeImages; the component art is images/ui/components/Component_N.bmp.
function buildResearchButton(wiring: HudWiring): HTMLElement {
    const btn = buildTopBarButton('tbtnResearch', wiring);
    btn.classList.add('top-research');
    btn.appendChild(chromeImg('research.png', 'top-research-img'));
    const rows = researchReadout(null).map((r) => {
        const el = document.createElement('span');
        el.className = 'top-research-row';
        el.style.top = `${r.y}px`;
        el.style.color = r.color;
        btn.appendChild(el);
        return el;
    });
    const refresh = (): void => {
        const empire = wiring.game?.playerEmpire as Empire | undefined;
        researchReadout(empire?.research ?? null).forEach((r, i) => {
            setTextIfChanged(rows[i], r.text);
            rows[i].classList.toggle('top-research-idle', r.node === null);
        });
    };
    refresh();
    if (wiring.game) whileInDocument(btn, refresh, 500);
    return btn;
}

/** addEventListener on `target` until the HUD is destroyed (hudLifetime.ts). */
function listenWhileInDocument<K extends keyof DocumentEventMap>(_el: HTMLElement, target: Document, type: K, fn: (e: DocumentEventMap[K]) => void, capture = false): void {
    target.addEventListener(type, fn, { capture, signal: hudSignal() });
}

/** setInterval(fn, ms) until the HUD is destroyed (hudLifetime.ts). */
function whileInDocument(_el: HTMLElement, fn: () => void, ms: number): void {
    hudInterval(fn, ms);
}

/** Our screens with no top-strip button in the original, behind one overflow button (small tweak): each runs the
 * same action as its key. */
export const TOP_MORE_ITEMS: readonly { key: string; label: string }[] = [
    { key: 'galaxyMap', label: 'Galaxy Map (G)' },
    { key: 'empires', label: 'Empires list' },
    { key: 'gameOptions', label: 'Game Options (O)' },
    { key: 'advisor', label: 'Talk to your admiral (K)' },
    { key: 'shortcuts', label: 'Keyboard shortcuts (?)' },
];

function runTopMoreItem(key: string, wiring: HudWiring): void {
    const src = getEmpireSummarySource();
    switch (key) {
        case 'galaxyMap':
            openGalaxyMap(wiring);
            return;
        case 'empires': {
            const galaxy = wiring.galaxy;
            if (!galaxy || !src) return;
            toggleEmpiresList({
                empires: galaxy.empires,
                playerEmpire: src.empire,
                onZoomTo: (habitat) => {
                    const cam = wiring.camera;
                    if (!cam) return;
                    cam.centerOn(habitat.xpos, habitat.ypos);
                    cam.zoomAt(SYSTEM_LEVEL_ZOOM, cam.width / 2, cam.height / 2);
                },
            });
            return;
        }
        case 'gameOptions':
            if (src) toggleGameOptionsPanel({ empire: src.empire });
            return;
        case 'advisor':
            if (src) toggleAdvisorPanel({ galaxy: src.empire.galaxy, player: src.empire });
            return;
        case 'shortcuts':
            // The "?" overlay belongs to main.ts's key handler.
            window.dispatchEvent(new KeyboardEvent('keydown', { key: '?' }));
            return;
    }
}

function buildTopMoreButton(wiring: HudWiring): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'top-more';
    const btn = topGlass('top-btn top-more-btn', [false, false, true, true], 'More screens: Galaxy Map, Empires, Game Options, Advisor, Keyboard shortcuts');
    btn.textContent = '•••';
    btn.style.width = '100%';
    btn.style.height = '100%';
    // A ContextMenuStrip under the button (originalWindow.ts toolStripMenu, CustomToolStripRenderer).
    const menu = toolStripMenu('top-more-menu');
    menu.hidden = true;
    for (const item of TOP_MORE_ITEMS) {
        const row = toolStripItem(item.label, { tag: 'button', className: 'top-more-item' });
        row.addEventListener('click', (e) => {
            e.stopPropagation();
            menu.hidden = true;
            runTopMoreItem(item.key, wiring);
        });
        menu.appendChild(row);
    }
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.hidden = !menu.hidden;
    });
    listenWhileInDocument(wrap, document, 'pointerdown', (e) => {
        if (!menu.hidden && !wrap.contains(e.target as Node)) menu.hidden = true;
    });
    wrap.append(btn, menu);
    return wrap;
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

/** Top-right money block (MainView.cs method_18): the money icon, the grey "Money" / "Cashflow" / "Bonus Income"
 * labels, the values drawn from num2 = Width - 95 (state money bold, red when negative; cashflow red when negative;
 * both incomes in parentheses), and the view's system name under it in large text (main.ts fills
 * `.hud-system-name`). Money from the player empire's state money, Cashflow / Bonus Income from treasury.ts
 * moneyPanelIncome (Main.Part11.cs 832 method_126). */
function buildMoneyPanel(game?: { playerEmpire: { name: string; mainColor: number; stateMoney: number; flagShape: number } }, galaxy?: Galaxy): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'top-money';
    const at = (el: HTMLElement, p: { x: number; y: number }): HTMLElement => {
        el.style.left = `${p.x}px`;
        el.style.top = `${p.y}px`;
        panel.appendChild(el);
        return el;
    };
    const text = (cls: string, s: string): HTMLElement => {
        const el = document.createElement('span');
        el.className = cls;
        el.textContent = s;
        return el;
    };
    at(chromeImg('money.png', 'top-money-icon'), MONEY_POS.icon);
    at(text('top-money-label', 'Money'), MONEY_POS.moneyLabel);
    const money = at(text('top-money-value top-text-shadow', '—'), MONEY_POS.money);
    at(text('top-money-label', 'Cashflow'), MONEY_POS.cashflowLabel);
    const cashflow = at(text('top-money-small top-text-shadow', ''), MONEY_POS.cashflow);
    at(text('top-money-label', 'Bonus Income'), MONEY_POS.bonusLabel);
    const bonus = at(text('top-money-small top-text-shadow', ''), MONEY_POS.bonus);
    const sys = text('hud-system-name top-text-shadow', '');
    sys.style.right = `${MONEY_POS.systemName.right}px`;
    sys.style.top = `${MONEY_POS.systemName.y}px`;
    panel.appendChild(sys);

    if (game) {
        const showIncome = (income: { cashflow: number; bonusIncome: number } | null): void => {
            if (income === null) return;
            setTextIfChanged(cashflow, `(${formatSignedMoney(income.cashflow)})`);
            cashflow.classList.toggle('top-negative', income.cashflow < 0);
            setTextIfChanged(bonus, `(${formatSignedMoney(income.bonusIncome)})`);
        };
        /** When the last 'moneyPanel' command was issued (performance.now), while it is not applied yet. */
        let moneyCommandAt: number | null = null;
        const refreshMoney = (): void => {
            // 4 Hz; written only on change (render: perf pass).
            const m = game.playerEmpire.stateMoney;
            setTextIfChanged(money, formatMoney(Math.round(m)));
            money.classList.toggle('top-negative', m < 0);
            // Main.Part11.cs 838-857: Cashflow / Bonus Income, `+##,###,##0;-##,###,##0` (the C# keeps the previous
            // strings when there is nothing to show).
            if (galaxy === undefined || galaxy.playerEmpire === null) return;
            const player = galaxy.playerEmpire;
            if (moneyPanelWriteDue(galaxy, player)) {
                // method_126 also ages the player's variable income (841 CheckAgeVariableIncome): a sim write, so the
                // journaled 'moneyPanel' command does it in the game at the next frame boundary (in-thread or in the
                // worker) and the panel shows its figures (docs/sim-worker.md §8). Asked again if no reply came.
                const t = performance.now();
                if (moneyCommandAt !== null && t - moneyCommandAt < 2000) return;
                moneyCommandAt = t;
                issuePlayerCommand(galaxy, player, 'moneyPanel', [], (income) => {
                    moneyCommandAt = null;
                    showIncome(income);
                });
                return;
            }
            // Nothing to write: the same figures, as a read (sim/readOnlyQuery.ts: the lookups write nothing).
            showIncome(moneyPanelIncome(galaxy, player));
        };
        refreshMoney();
        whileInDocument(panel, refreshMoney, 250);
    }
    return panel;
}

/** The text under the money block for a view centred at (x, y) at camera `zoom`: the original's string_22
 * (topBar.ts viewSystemName, with the scenario's rim name for the system) while zoomed in below factor 100, else ''. */
export function topSystemNameText(galaxy: Galaxy, x: number, y: number, zoom: number): string {
    if (!showViewSystemName(zoom)) return '';
    return viewSystemName(galaxy, galaxy.playerEmpire, x, y, (h) => rimSystemDisplayName({ scenario: galaxy.scenario ?? null }, h.systemIndex, h.name));
}

/** Bottom-left streamlined selection panel. */
// ---------------------------------------------------------------------------------------------------------------
// Selection panel: the original's bottom-left frame (Main.Part2.cs QxrIvWcaOp / Main.Part12.cs 1962-2097): the
// pnlInfoPanel frame with pnlDetailInfo (the InfoPanel, selectionInfo.ts + selectionInfoView.ts), the selection
// history buttons on top, the lock + seven "‹" cycle buttons on the left, the nearest-military + seven "›" cycle
// buttons on the right, the ship-stance button and the eight btnSelectionAction buttons under it. Geometry is in
// the original's pixels (small content size); the whole frame scales (selectionFrameScale).
// ---------------------------------------------------------------------------------------------------------------

/** Frame size in the original's pixels: x 10..409, y (num - 36)..(pnlInfoPanel.Bottom + 30). */
export const SELECTION_FRAME = { w: 399, h: 310 } as const;
/** The frame at 1080 px window height is ~683 × 531 px (the original's large-DPI look). */
export const SELECTION_FRAME_BASE_SCALE = 683 / 399;

/** btnSelectionPanelSize toggles the content size (InfoPanel.Kickstart(isLargeSize)); here the small size is the
 *  same frame drawn smaller. Persisted per browser. */
const PANEL_SIZE_KEY = 'dwu.selectionPanelSmall';
export function selectionPanelSmall(): boolean {
    try {
        return localStorage.getItem(PANEL_SIZE_KEY) === '1';
    } catch {
        return false;
    }
}

/** The frame's CSS scale: the base scale at a 1080 px tall window, proportional to the window height, times the UI
 *  scale setting (and 0.75 in the small size). */
export function selectionFrameScale(viewportHeight: number, uiScale: number, small: boolean): number {
    const v = Math.max(0.5, viewportHeight / 1080);
    return SELECTION_FRAME_BASE_SCALE * HUD_FRAME_SIZE * v * uiScale * (small ? 0.75 : 1);
}

/** The system map's CSS scale (hudSystemMap.ts): the selection frame's full-size scale (the same original pixels on
 *  both bottom corners), × SYSTEM_MAP_SMALL_SCALE in the small size, and capped so that in a narrow window the map
 *  with its zoom strip (13 px left of the panel) keeps 10 px clear of the selection frame (scaled by
 *  `selectionScale`) instead of overlapping it. Both frames sit 10 px from their screen edges. */
export function systemMapFrameScale(viewportWidth: number, viewportHeight: number, uiScale: number, small: boolean, selectionScale: number): number {
    const k = selectionFrameScale(viewportHeight, uiScale, false) * (small ? SYSTEM_MAP_SMALL_SCALE : 1);
    const frameW = SYSTEM_MAP_PANEL_W - SYSTEM_MAP_STRIP.x;
    const room = (viewportWidth - 10 - SELECTION_FRAME.w * selectionScale - 10 - 10) / frameW;
    return Math.max(0.25, Math.min(k, room));
}

/** The original's selection-panel cycle buttons, top to bottom (Main.Part12.cs 2003-2030). */
export const SELECTION_CYCLE_BUTTONS: readonly { kind: CycleKind; image: string }[] = [
    { kind: 'colonies', image: 'cycleColonies' },
    { kind: 'bases', image: 'cycleBases' },
    { kind: 'military', image: 'cycleMilitary' },
    { kind: 'construction', image: 'cycleConstruction' },
    { kind: 'other', image: 'cycleOther' },
    { kind: 'fleets', image: 'cycleFleets' },
    { kind: 'idleShips', image: 'cycleIdleShips' },
];

type Corners = 'left' | 'right' | 'all' | 'none';

/** A GlassButton (DistantWorlds.Controls GlassButton) at an original-pixel rect, with its chrome image. */
function glassButton(cls: string, x: number, y: number, w: number, h: number, image: string | null, title: string, corners: Corners, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `sel-glass sel-corners-${corners} ${cls}`;
    b.style.left = `${x}px`;
    b.style.top = `${y}px`;
    b.style.width = `${w}px`;
    b.style.height = `${h}px`;
    b.title = title;
    if (image !== null) {
        const img = document.createElement('img');
        img.src = `/assets/dwu/images/ui/chrome/${image}`;
        img.alt = '';
        img.draggable = false;
        b.appendChild(img);
    }
    b.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick();
    });
    return b;
}

function buildSelectionPanel(wiring: HudWiring): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'hud-selection sel-frame';

    // pnlInfoPanel (26, H-290, 370×250) → frame (16, 30); pnlDetailInfo at (44, 5) inside it.
    const infoFrame = document.createElement('div');
    infoFrame.className = 'sel-infopanel';
    panel.appendChild(infoFrame);
    const detail = document.createElement('div');
    detail.className = 'sel-detail';
    panel.appendChild(detail);
    const content = document.createElement('div');
    content.className = 'sel-content-box';
    detail.appendChild(content);
    // The main view's hover message over the selection panel (Main.Part10.cs 1141-1159, method_206 case
    // "pnlDetailInfo" / "pnlInfoPanel": "Selection Panel: click to center view on selected item" while pnlDetailInfo
    // is visible, replaced by the hovered hotspot's HoverMessage → string_17), drawn in yellow with a drop shadow at
    // HoverMessageLocation = (10, height - (pnlInfoPanel + btnSelectionForward + btnSelectionAction1 heights + 4 +
    // 35)), Main.Part12.cs 2103 / MainView.cs 1599: 19 px above this frame's top, at its left edge.
    const hoverMsg = document.createElement('div');
    hoverMsg.className = 'sel-hover-msg';
    hoverMsg.hidden = true;
    panel.appendChild(hoverMsg);
    let hoverPoint: { x: number; y: number } | null = null;
    const syncHoverMessage = (): void => {
        let text = '';
        if (hoverPoint !== null) {
            const under = document.elementFromPoint(hoverPoint.x, hoverPoint.y);
            if (under instanceof HTMLElement && (detail.contains(under) || infoFrame.contains(under)) && under.closest('button') === null) {
                text = selectionPanelHint(under.closest<HTMLElement>('[data-hover]')?.dataset.hover);
            }
        }
        if (hoverMsg.textContent !== text) hoverMsg.textContent = text;
        hoverMsg.hidden = text === '';
    };
    for (const area of [detail, infoFrame]) {
        area.addEventListener('mousemove', (e) => {
            hoverPoint = { x: e.clientX, y: e.clientY };
            syncHoverMessage();
        });
        area.addEventListener('mouseleave', () => {
            hoverPoint = null;
            syncHoverMessage();
        });
    }
    // Main.Part4.cs 3525 pnlDetailInfo_MouseClick: a click off every hotspot moves the view to the selection
    // (method_157(_Game.SelectedObject)); a hotspot with no object (a message only) does nothing; the hotspots'
    // own clicks are attachTarget's (selectionInfoView.ts, they stop the event).
    detail.addEventListener('click', (e) => {
        if (!(e.target instanceof Element) || e.target.closest('button') !== null || e.target.closest('[data-hover]') !== null) return;
        const cam = wiring.camera;
        if (cam === undefined) return;
        const t = selectionViewTarget(currentSelection);
        if (t === null) return;
        // method_157: `if (SelectedObject != null && UhvLmNjli7) UhvLmNjli7 = false` — the view lock comes off (here
        // also the follow camera, our lock for a moving ship / fleet), then the view centres on it (no zoom change).
        if (isViewLocked()) runShipCommand('lockView');
        const follow = followTarget();
        if (follow !== null && wiring.followState !== undefined && isFollowingTarget(wiring.followState, follow)) toggleFollow(wiring.followState, follow);
        cam.centerOn(t.x, t.y);
        syncLock();
    });
    // Our controls with no button in the original (follow, the dispatch orders, charter) go into the action strip's
    // empty slots (orderMenu.ts setSelectionExtraSlots); any that don't fit overflow into this compact row.
    const extras = document.createElement('div');
    extras.className = 'sel-extras';
    extras.hidden = true;
    detail.appendChild(extras);

    // [followcam] begin — Follow toggle: offered only while the selection is a ship or fleet (bases and colonies
    // don't move). Toggling flips the shared FollowState the Main View recentres the camera on every frame
    // (mainView.ts update()); a manual pan/edge-scroll/keyboard-scroll, a map click, a different selection, or
    // the target's loss all turn it off elsewhere (mainView.ts, keyboard.ts, onSelectionChange below).
    /** The current selection's follow identity: the ShipGroup for a fleet (so a lead-ship change mid-fleet
     * doesn't look like "a different target"), else the selected ship/base (bases excluded: they never move). */
    const followTarget = (): FollowTarget | null => {
        const sel = currentSelection;
        if (!sel) return null;
        if (sel.shipGroup) return sel.shipGroup;
        if (sel.builtObject && sel.builtObject.role !== BuiltObjectRole.Base) return sel.builtObject;
        return null;
    };
    // [followcam] end

    // [charters] begin
    // Scenario 19c: "Charter a company…" for a selected unowned planet (tasks/19c-chartered-companies.md §8.1).
    const charterButton = createCharterButton(
        () => ({
            galaxy: wiring.galaxy ?? null,
            player: wiring.galaxy?.playerEmpire ?? null,
            habitat: currentSelection !== null && currentSelection.builtObject === undefined && currentSelection.shipGroup === undefined && currentSelection.builtObjects === undefined && currentSelection.creature === undefined && currentSelection.fighter === undefined ? currentSelection.habitat : null,
        }),
        (id) => wiring.gameData?.resources.find((d) => d.resourceId === id)?.name ?? `#${id}`,
    );
    // [charters] end

    /** The dispatch orders of the selected habitat (sim/player/habitatDispatch.ts), resolved on a selection change. */
    let dispatchSlots: SelectionExtraSlot[] = [];
    const extraSlots = (): SelectionExtraSlot[] => {
        const out: SelectionExtraSlot[] = [...dispatchSlots];
        // The Fleet Settings panel for a selected player fleet (an Improvement, ui/improvements.ts).
        const settingsFleet = currentSelection?.shipGroup ?? null;
        if (settingsFleet !== null && isImprovementEnabled('fleetSettings') && settingsFleet.empire === (wiring.galaxy?.playerEmpire ?? null)) {
            out.push({ label: 'Settings', title: 'Fleet Settings: posture, engagement, retreat, fuel, troops and resupply (Q)', onClick: () => openFleetSettingsFor(settingsFleet) });
        }
        if (!charterButton.element.hidden) {
            const el = charterButton.element as HTMLButtonElement;
            out.push({ label: 'Charter', title: el.title || 'Charter a company…', disabled: el.disabled, onClick: () => el.click() });
        }
        return out;
    };
    // The extras beyond the empty slots: a popup over the strip opened by the "More…" slot, or (no empty slot at all)
    // a compact row at the bottom of the info area.
    const more = document.createElement('div');
    more.className = 'sel-more';
    more.hidden = true;
    panel.appendChild(more);
    let moreOpen = false;
    const extraButton = (x: SelectionExtraSlot, after: () => void): HTMLButtonElement => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'sel-extra-btn';
        if (x.active) b.classList.add('hud-follow-toggle-active');
        b.textContent = x.label;
        b.title = x.title;
        b.disabled = x.disabled === true;
        b.addEventListener('click', (e) => {
            e.stopPropagation();
            x.onClick();
            after();
        });
        return b;
    };
    setSelectionExtraSlots(
        extraSlots,
        (rest, behindMore) => {
            const inline = behindMore ? [] : rest;
            extras.hidden = inline.length === 0;
            extras.replaceChildren(...inline.map((x) => extraButton(x, () => refreshSelectionActionBar())));
            const popup = behindMore ? rest : [];
            if (popup.length === 0) moreOpen = false;
            more.hidden = !moreOpen || popup.length === 0;
            // The hidden extras as an original-style menu (CustomToolStripRenderer, originalWindow.ts toolStripMenu).
            const menu = toolStripMenu('sel-more-menu');
            for (const x of popup) {
                const row = toolStripItem(x.label, { enabled: x.disabled !== true, title: x.title, tag: 'button' });
                if (x.icon !== undefined) {
                    const img = document.createElement('img');
                    img.className = 'sel-more-icon';
                    img.src = x.icon;
                    img.alt = '';
                    img.draggable = false;
                    row.prepend(img);
                }
                if (x.active) row.classList.add('sel-more-on');
                row.addEventListener('mouseenter', () => setToolStripActive(menu, row));
                row.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (x.disabled === true) return;
                    x.onClick();
                    moreOpen = false;
                    more.hidden = true;
                });
                menu.appendChild(row);
            }
            more.replaceChildren(menu);
        },
        () => {
            moreOpen = !moreOpen;
            more.hidden = !moreOpen || more.childElementCount === 0;
        },
    );

    // An Improvement switched on / off in Game Options: its selection-panel button appears / goes.
    onHudDestroyed(onImprovementsChange(() => refreshSelectionActionBar()));

    // [ordermenu] begin
    // 17c: btnSelectionAction1-8 (Main.Part3.cs 1120-3805, method_593), 35×28 each from (70, pnlInfoPanel.Bottom + 2).
    const actionBar = createSelectionActionBar();
    actionBar.classList.add('sel-actions');
    panel.appendChild(actionBar);
    if (wiring.galaxy) {
        const galaxy = wiring.galaxy;
        setSelectionIconResolvers({
            troop: (t: unknown) => (t instanceof Troop ? troopImageUrl(t, galaxy.races.length, { concordArt: raceHasConcordArt(galaxy, (t.race as Race | null)?.name) }) : null),
            ship: (d: { pictureRef: number; subRole: number }) => builtObjectImageUrl(resolveDrawPictureRef({ pictureRef: d.pictureRef, isPlanetDestroyer: false, subRole: d.subRole, builtObjectID: 0 })),
        });
    }
    // [ordermenu] end

    // Idle-ship cycler position (Main builtObject_4 / shipGroup_1).
    let idleCycle: IdleCycleState = { builtObject: null, shipGroup: null };
    // Task 13c: each BuiltObject cycle kind (bases/military/construction/other)
    // remembers its own last-cycled object, like the original's builtObject_0..3.
    const lastCycled = new Map<CycleKind, BuiltObject>();
    /** Step through a cycle list: select the next item (same hook as click-to-select, so the panel updates). With
     * `moveView` (the Ctrl variants of C/P/M/Y/X/F/I and the panel's cycle buttons) the camera also centres on it at
     * System zoom. */
    const stepCycle = (dir: 1 | -1, kind: CycleKind, moveView = true): void => {
        if (kind !== 'colonies') {
            // [15c] Port of Main.Part8.cs:1243 btnCycleShipGroups_Click (F / Shift+F / Ctrl+F).
            if (kind === 'fleets') {
                const game = wiring.game;
                if (!game) return;
                const list = fleetCycleList(game.playerEmpire as Empire);
                if (list.length === 0) {
                    showToast(cycleEmptyText('fleets'));
                    return;
                }
                const next = nextInCycle(list, currentSelection?.shipGroup ?? null, dir);
                if (next) shipGroupSelectHandler?.(next, moveView);
                return;
            }
            // [/15c]
            if (kind === 'idleShips') {
                // Port of Main.Part7.cs 1863 btnCycleIdleShips_Click / Main.Part4.cs 3897
                // btnCycleIdleShipsBack_Click: select (method_208) and, when moving the
                // view, centre on (method_157) the next idle ship or fleet.
                const game = wiring.game;
                if (!game) return;
                idleCycle = cycleIdleShips(game.playerEmpire as unknown as IdleCycleEmpire, idleCycle, dir);
                if (idleCycle.shipGroup) {
                    shipGroupSelectHandler?.(idleCycle.shipGroup, moveView);
                } else if (idleCycle.builtObject) {
                    stellarObjectSelectHandler?.(idleCycle.builtObject, moveView);
                } else {
                    showToast(cycleEmptyText(kind));
                }
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
            const list = builtObjectCycleList(game.playerEmpire as Empire, kind);
            if (list.length === 0) {
                showToast(cycleEmptyText(kind));
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
            showToast(cycleEmptyText('colonies'));
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

    // Top row: btnSelectionBack / btnSelectionForward (138×28 at x 71 / 213, Main.Part10.cs 1505/1535 — the N/B
    // keys) and btnSelectionPanelSize (56×28 at x 353).
    const histBack = glassButton('sel-hist', 61, 0, 138, 28, 'back.png', 'Previous selection (B)', 'left', () => runShipCommand('selectionBackward'));
    const histFwd = glassButton('sel-hist', 203, 0, 138, 28, 'forward.png', 'Next selection (N)', 'right', () => runShipCommand('selectionForward'));
    const sizeBtn = glassButton('sel-size', 343, 0, 56, 28, 'selectionPanelSize.png', 'Shrink Selection Panel', 'all', () => {
        const small = !selectionPanelSmall();
        try {
            localStorage.setItem(PANEL_SIZE_KEY, small ? '1' : '0');
        } catch {
            // private mode: the size just doesn't persist
        }
        sizeBtn.title = small ? 'Enlarge Selection Panel' : 'Shrink Selection Panel';
        panel.dispatchEvent(new CustomEvent('sel-resize', { bubbles: false }));
    });
    sizeBtn.title = selectionPanelSmall() ? 'Enlarge Selection Panel' : 'Shrink Selection Panel';
    panel.append(histBack, histFwd, sizeBtn);
    // Left column: btnLockView (Main.Part9.cs 3165, the L key) + the seven "‹" cycle buttons; right column:
    // btnSelectNearestMilitary (Main.Part4.cs 2330, Z) + the seven "›" cycle buttons; btnCycleShipStance under them.
    // Small tweak: for a ship / fleet the lock is the follow camera ([followcam]: it keeps following through warps);
    // for anything else the original's view lock (L).
    const lockActive = (): boolean => {
        const t = followTarget();
        return isViewLocked() || (t !== null && wiring.followState !== undefined && isFollowingTarget(wiring.followState, t));
    };
    const lockBtn = glassButton('sel-lock', 0, 36, 56, 28, 'lockView.png', 'Lock the view on the selection (L)', 'left', () => {
        const t = followTarget();
        const state = wiring.followState;
        if (t !== null && state !== undefined) toggleFollow(state, t);
        else runShipCommand('lockView');
        syncLock();
    });
    const syncLock = (): void => {
        lockBtn.classList.toggle('sel-glass-on', lockActive());
        lockBtn.title = followTarget() !== null
            ? (lockActive() ? 'Following the selection (click, pan or select something else to stop)' : 'Follow the selection while it moves or warps')
            : 'Lock the view on the selection (L)';
    };
    panel.appendChild(lockBtn);
    // Double-clicking the panel's title (the selection name) turns the follow camera on for a selected ship / fleet.
    content.addEventListener('dblclick', (e) => {
        if (!(e.target instanceof Element) || e.target.closest('.sel-title') === null) return;
        const t = followTarget();
        const state = wiring.followState;
        if (t === null || state === undefined || isFollowingTarget(state, t)) return;
        toggleFollow(state, t);
        syncLock();
    });
    panel.appendChild(glassButton('sel-nearest', 343, 36, 56, 28, 'nearestMilitary.png', 'Select the nearest military ship (Z)', 'right', () => runShipCommand('selectNearestMilitaryShip')));
    SELECTION_CYCLE_BUTTONS.forEach((c, i) => {
        const y = 66 + 30 * i;
        panel.appendChild(glassButton('sel-cycle', 0, y, 56, 28, `${c.image}Back.png`, `${CYCLE_CHIP_HINTS[c.kind]} (previous)`, 'left', () => stepCycle(-1, c.kind, true)));
        panel.appendChild(glassButton('sel-cycle', 343, y, 56, 28, `${c.image}.png`, `${CYCLE_CHIP_HINTS[c.kind]} (next)`, 'right', () => stepCycle(1, c.kind, true)));
    });
    const stanceBtn = glassButton('sel-stance', 343, 276, 56, 28, 'shipStance.png', 'Cycle the engagement range (,)', 'all', () => {
        runShipCommand('cycleEngagementStance');
        refresh();
    });
    panel.appendChild(stanceBtn);

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

    // Task 12n: the C/P/M/Y/X/F/I hotkeys route here. A plain/Shift cycle selects without moving the view; Ctrl
    // (MoveView) also moves it.
    setCycleHandler((kind, dir, moveView) => {
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
    // Select a fighter (Main.Part10.cs method_208 for a Fighter): its nearest system's star as `habitat`.
    fighterSelectHandler = (f) => {
        const galaxy = wiring.galaxy;
        if (!galaxy) return;
        const system = nearestSystem(galaxy.systems, f.xpos, f.ypos);
        if (!system) return;
        wiring.onSelectionChange?.({ habitat: system.systemStar, system, fighter: f });
    };
    // Select a creature: its nearest system's star as `habitat`, `creature` set (the map ring and live refresh follow it).
    creatureSelectHandler = (c, moveView) => {
        const galaxy = wiring.galaxy;
        if (!galaxy) return;
        const system = nearestSystem(galaxy.systems, c.xpos, c.ypos);
        if (!system) return;
        wiring.onSelectionChange?.({ habitat: system.systemStar, system, creature: c });
        const cam = wiring.camera;
        if (moveView && cam) {
            cam.centerOn(c.xpos, c.ypos);
            cam.zoomAt(SYSTEM_LEVEL_ZOOM, cam.width / 2, cam.height / 2);
        }
    };

    // A hotspot click (InfoPanel.AddHotspot objects): select the object (method_208), or open the empire.
    const onTarget = (t: InfoTarget): void => {
        if (t.kind === 'empire') {
            const player = wiring.galaxy?.playerEmpire ?? null;
            if (player === null) return;
            if (t.empire === player) toggleEmpireSummary();
            else toggleDiplomacyScreen({ player, selectedEmpire: t.empire });
            return;
        }
        if (t.kind === 'ruin') {
            // Main.Part4.cs 3581: a Ruin hotspot opens the Ruin Detail window (method_550).
            if (wiring.galaxy) openRuinDetail(wiring.galaxy, t.ruin);
            return;
        }
        // [parC1] The Troops / battle rows: the Ground Report (method_164).
        if (t.kind === 'groundReport') {
            openGroundReport(t.habitat);
            return;
        }
        // Main.Part4.cs 3586-3597: a planetary facility hotspot opens the Galactopedia (method_456) at "Wonders" or
        // "Planetary Facilities".
        if (t.kind === 'galactopedia') {
            openGalactopedia({ topic: t.topic });
            return;
        }
        // [improvements] supplyChain: the Waiting row → Construction Yards, Waiting For tab, at the site.
        if (t.kind === 'supply') {
            const src = getEmpireSummarySource();
            if (src) openConstructionYards({ ...constructionYardsOptions(src.empire), site: t.target, tab: 'supply' });
            return;
        }
        // Not in the original: a fleet's "Template" row opens the Fleets screen on the fleet (fleetRefillControls.ts).
        if (t.kind === 'fleetTemplate') {
            closeFleetsList();
            toggleFleets(t.fleet);
            return;
        }
        const o = t.obj;
        if (o instanceof ShipGroup) shipGroupSelectHandler?.(o, false);
        else if (o instanceof Habitat) habitatSelectHandler?.(o, false);
        else if (o instanceof Fighter) fighterSelectHandler?.(o); // Main.Part4.cs 3547: a Fighters-row picture
        else stellarObjectSelectHandler?.(o, false);
    };
    const automationTarget = (): BuiltObject | ShipGroup | null => currentSelection?.shipGroup ?? currentSelection?.builtObject ?? null;
    // The toggle's state last sent per ship / fleet until its reply lands (pendingCommands.ts): a quick second click
    // turns it back, as it does in-thread a frame later.
    const pendingAutomated = new PendingValues<BuiltObject | ShipGroup, boolean>();
    const toggleAutomation = (): void => {
        const target = automationTarget();
        const player = wiring.galaxy?.playerEmpire;
        if (!target || !player) return;
        const automated = pendingAutomated.value(target, automationToggleLabel(target).automated);
        const settle = pendingAutomated.send(target, !automated);
        issuePlayerCommand(player.galaxy, player, 'shipAction', [target, createShipAction(automated ? ShipActionType.UnautomateShip : ShipActionType.AutomateShip, target), false, undefined], () => {
            settle();
            refresh();
            refreshSelectionActionBar();
        });
    };

    // Refresh the info area from the current selection (InfoPanel.SetData + DrawPanel).
    const gameData = wiring.gameData;
    const resourceDef = (id: number): { name: string; pictureRef: number } | null => gameData?.resources.find((d) => d.resourceId === id) ?? null;
    let lastScroll = 0;
    const refresh = (): void => {
        const sel = currentSelection;
        const galaxy = wiring.galaxy;
        const player = galaxy?.playerEmpire ?? null;
        const scroll = content.querySelector('.sel-scroll');
        if (scroll !== null) lastScroll = scroll.scrollTop;
        if (!sel || !galaxy || player === null) {
            renderInfoModel(content, null, { galaxy: galaxy as Galaxy, onTarget });
        } else {
            const model = buildInfoModel({ galaxy, player, resource: resourceDef }, sel, sel.creature ? creaturePictureUrl(sel.creature) : null);
            renderInfoModel(content, model, { galaxy, onTarget, onAutomate: model.automated ? toggleAutomation : undefined, hoverMessage: true });
            const next = content.querySelector('.sel-scroll');
            if (next !== null) next.scrollTop = lastScroll;
        }
        // The hovered hotspot was redrawn: its (refreshed) message stays up while the cursor is still on it.
        syncHoverMessage();
        // The stance button only for the player's military ship / fleet (Main.Part10.cs: btnCycleShipStance.Visible).
        const target = automationTarget();
        stanceBtn.style.visibility = target !== null && player !== null
            && (target instanceof ShipGroup ? target.empire === player : target.empire === player && target.role === BuiltObjectRole.Military) ? '' : 'hidden';
        syncLock();
    };
    /** The dispatch slots: rebuilt on a selection change (the dispatch options re-resolve at click time). */
    const rebuildExtras = (): void => {
        const sel = currentSelection;
        const galaxy = wiring.galaxy;
        const player = galaxy?.playerEmpire ?? null;
        if (sel && galaxy && player !== null && !sel.creature && !sel.fighter && !sel.shipGroup && !sel.builtObject && !sel.builtObjects) {
            // The options come from a command (at the next frame boundary; in worker mode from the authoritative game
            // one round trip later), then the strip is redrawn — a reply for a selection already left is dropped.
            dispatchSlots = [];
            habitatDispatchSlots(galaxy, player, sel.habitat, (slots) => {
                if (currentSelection !== sel) return;
                dispatchSlots = slots;
                redrawSelectionActionBar();
            });
        } else {
            dispatchSlots = [];
        }
    };
    builtObjectListSelectHandler = (list) => {
        const galaxy = wiring.galaxy;
        if (!galaxy) return;
        if (list.length === 0) {
            wiring.onSelectionChange?.(null);
            return;
        }
        if (list.length === 1) {
            stellarObjectSelectHandler?.(list[0], false);
            return;
        }
        const system = nearestSystem(galaxy.systems, list[0].xpos, list[0].ypos);
        if (!system) return;
        wiring.onSelectionChange?.({ habitat: system.systemStar, system, builtObjects: list });
    };
    wiring.onSelectionChange = (sel) => {
        // A star picked at galaxy / sector zoom is the C# SystemInfo selection (DrawSystemInfo); at system zoom the
        // star itself (DrawHabitat).
        if (sel !== null && sel.systemInfo === undefined && sel.habitat === sel.system.systemStar && !sel.builtObject && !sel.shipGroup && !sel.creature && !sel.fighter && !sel.builtObjects) {
            const cam = wiring.camera;
            sel = { ...sel, systemInfo: cam !== undefined && cam.zoom < SYSTEM_INFO_ZOOM };
        }
        const changed = currentSelection !== sel;
        currentSelection = sel;
        // [followcam] a selection change stops following unless it's the same object already followed.
        if (wiring.followState) followOnSelectionChanged(wiring.followState, followTarget());
        lastScroll = 0;
        refresh();
        if (changed) rebuildExtras();
        charterButton.update(); // [charters]
        refreshSelectionActionBar(); // [ordermenu]
        wiring.afterSelectionChange?.(sel);
    };
    // Main.Part11.cs 661: the panel redraws twice a second (ship status, colony troops, building queues). Stops
    // once the HUD is removed.
    const liveTimer = setInterval(() => {
        if (!panel.isConnected) {
            clearInterval(liveTimer);
            return;
        }
        if (currentSelection?.fighter) {
            // InfoPanel.cs 3497 DrawFighter: a destroyed fighter clears the selection.
            if (currentSelection.fighter.hasBeenDestroyed) wiring.onSelectionChange?.(null);
            else refresh();
            return;
        }
        if (currentSelection?.creature) {
            // InfoPanel.cs 3455: a destroyed creature clears the selection.
            if (currentSelection.creature.hasBeenDestroyed) wiring.onSelectionChange?.(null);
            else refresh();
            return;
        }
        const multi = currentSelection?.builtObjects;
        if (multi) {
            // Destroyed / lost ships drop out of the multi-selection (one left: a single selection).
            const alive = multi.filter((bo) => !bo.hasBeenDestroyed && bo.empire === multi[0].empire);
            if (alive.length !== multi.length) {
                builtObjectListSelectHandler?.(alive);
                return;
            }
        }
        // Don't redraw under the pointer while it hovers a hotspot (its tooltip would flicker).
        if (content.querySelector('.sel-hot:hover') === null) refresh();
        else syncLock();
    }, 500);
    rebuildExtras();
    refresh();
    return panel;
}

/** Below this camera zoom a picked system star is the system as a whole (DrawSystemInfo). */
export const SYSTEM_INFO_ZOOM = 1 / 70;

/** A creature's picture for the panel (its first animation frame). */
function creaturePictureUrl(c: Creature): string | null {
    const idx = creatureFrameSetIndexes(c.type);
    if (idx === null) return null;
    const set = CREATURE_FRAME_SETS[idx.moving];
    return set !== undefined ? (creatureFrameUrls(set)[0] ?? null) : null;
}

/** Bottom-right options list: the map overlay toggles (the original's row of overlay buttons above pnlSystemMap,
 *  Main.Part12.cs 2135-2199). The zoom buttons are the system map's own strip (hudSystemMap.ts). */
function buildOptionsList(wiring: HudWiring): HTMLElement {
    const overlays = wiring.overlays ?? createMapOverlayState();
    // [uiwp6] A ToolStrip drop-down (originalWindow.ts toolStripMenu, CustomToolStripRenderer) of checked items.
    const panel = toolStripMenu('hud-options');

    const section = (title: string): void => {
        panel.appendChild(toolStripHeading(title, 'hud-section-head'));
    };
    const addRow = (row: OverlayRow): void => {
        const item = toolStripItem(row.label, { tag: 'button', checked: overlays[row.key], className: 'hud-option-row', labelClassName: 'hud-option-label' });
        item.dataset.overlay = row.key;
        const check = item.querySelector<HTMLElement>('.ow-ts-check')!;
        check.classList.add('hud-option-check');
        // [freightOverlay] begin — additions to the original nine carry a "+" badge (the Improvements section's rows do
        // not: the section says it); `panel` rows get a "…" opener.
        if (row.mod === true && row.improvement === undefined) {
            const badge = document.createElement('span');
            badge.className = 'hud-option-mod';
            badge.textContent = '+';
            badge.title = 'Not in the original game';
            item.appendChild(badge);
        }
        if (row.panel === 'tradeFlows' && wiring.openTradeFlows !== undefined) {
            const more = document.createElement('span');
            more.className = 'hud-option-more';
            more.textContent = '…';
            more.title = 'Trade Flows panel';
            more.setAttribute('role', 'button');
            more.addEventListener('click', (e) => {
                e.stopPropagation();
                wiring.openTradeFlows?.();
            });
            item.appendChild(more);
        }
        // [freightOverlay] end
        // [dw2overlays] begin — the Resources row's "…": an inline resource picker under the row (ui/overlayOptionPanels.ts).
        let sub: OverlayOptionPanel | null = null;
        if (row.panel === 'resources' && wiring.galaxy !== undefined) {
            const picker = resourcePickerPanel(overlays, wiring.galaxy);
            sub = picker;
            picker.element.style.display = 'none';
            const more = document.createElement('span');
            more.className = 'hud-option-more';
            more.textContent = '…';
            more.title = 'Pick a resource';
            more.setAttribute('role', 'button');
            more.addEventListener('click', (e) => {
                e.stopPropagation();
                const open = picker.element.style.display === 'none';
                if (open) picker.refresh();
                picker.element.style.display = open ? '' : 'none';
            });
            item.appendChild(more);
        }
        // [dw2overlays] end
        // [improvements] supplyChain — the Supply Shortages row's "…": its colony sub-toggle.
        if (row.panel === 'supplyShortages') {
            const opts = supplyShortagesPanel();
            sub = opts;
            opts.element.style.display = 'none';
            const more = document.createElement('span');
            more.className = 'hud-option-more';
            more.textContent = '…';
            more.title = 'Supply Shortages options';
            more.setAttribute('role', 'button');
            more.addEventListener('click', (e) => {
                e.stopPropagation();
                const open = opts.element.style.display === 'none';
                if (open) opts.refresh();
                opts.element.style.display = open ? '' : 'none';
            });
            item.appendChild(more);
        }
        // [improvements] waypoints — the Waypoints & Known Locations row's "…": its two sub-toggles and the list.
        if (row.panel === 'waypoints') {
            const opts = waypointsOptionsPanel();
            sub = opts;
            opts.element.style.display = 'none';
            const more = document.createElement('span');
            more.className = 'hud-option-more';
            more.textContent = '…';
            more.title = 'Waypoints & Known Locations options';
            more.setAttribute('role', 'button');
            more.addEventListener('click', (e) => {
                e.stopPropagation();
                const open = opts.element.style.display === 'none';
                if (open) opts.refresh();
                opts.element.style.display = open ? '' : 'none';
            });
            item.appendChild(more);
        }
        item.addEventListener('click', () => {
            toggleOverlay(overlays, row.key);
            check.textContent = overlays[row.key] ? '✓' : '';
            // Rendering lives in src/render/overlayLayer.ts (task M3, parity C3), which subscribes to onOverlayChange and
            // reads the state every frame (Fade civilian ships: builtObjectLayer.ts).
        });
        panel.appendChild(item);
        if (sub !== null) panel.appendChild(sub.element); // [dw2overlays]
    };
    // [improvements] An improvement with no overlay (Improvement.viewRow): its row switches the improvement itself.
    const addImprovementRow = (imp: Improvement): void => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'hud-option-row';
        item.dataset.improvement = imp.id;
        item.title = imp.description;
        const check = document.createElement('span');
        check.className = 'hud-option-check';
        check.textContent = isImprovementEnabled(imp.id) ? '✓' : '';
        const lbl = document.createElement('span');
        lbl.className = 'hud-option-label';
        lbl.textContent = imp.label;
        item.append(check, lbl);
        item.addEventListener('click', () => setImprovementEnabled(imp.id, !isImprovementEnabled(imp.id)));
        panel.appendChild(item);
    };
    // The original's overlays, then the Improvements section (ui/improvements.ts: DW2-inspired additions, each one
    // listed only while it is enabled in Game Options → Improvements).
    const render = (): void => {
        panel.replaceChildren();
        const { original, improvements } = overlayRowSections(OVERLAY_ROWS);
        section('Overlays');
        for (const row of original) addRow(row);
        const toggles = improvementViewRows();
        if (improvements.length > 0 || toggles.length > 0) {
            section(IMPROVEMENTS_TITLE);
            for (const row of improvements) addRow(row);
            for (const imp of toggles) addImprovementRow(imp);
        }
    };
    render();
    // Until the HUD is destroyed (hudLifetime.ts).
    const off = onImprovementsChange(() => render());
    onHudDestroyed(off);
    // [dw2overlays] the checks follow changes made elsewhere (the resource picker turns its overlay on).
    onHudDestroyed(
        onOverlayChange(() => {
            for (const el of panel.querySelectorAll<HTMLElement>('.hud-option-row[data-overlay]')) {
                const c = el.querySelector('.hud-option-check');
                if (c !== null) c.textContent = overlays[el.dataset.overlay as OverlayKey] ? '✓' : '';
            }
        }),
    );
    return panel;
}

const OPTIONS_POPUP_OPEN_KEY = 'dwu.optionsPopup.open';

/** The bottom-right options list behind a small "View" button: the list pops up
 * above the button and closes on a second click or a click elsewhere. */
function buildOptionsPopup(list: HTMLElement): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'hud-options-pop';
    list.classList.add('hud-options-menu');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ow-glass hud-options-toggle'; // [uiwp6] a GlassButton
    btn.title = 'View and map overlays';
    const setOpen = (open: boolean): void => {
        wrap.classList.toggle('open', open);
        btn.textContent = open ? 'View ▾' : 'View ▴';
        btn.setAttribute('aria-expanded', String(open));
        try {
            localStorage.setItem(OPTIONS_POPUP_OPEN_KEY, open ? '1' : '0');
        } catch {
            /* storage unavailable */
        }
    };
    let initial = false;
    try {
        initial = localStorage.getItem(OPTIONS_POPUP_OPEN_KEY) === '1';
    } catch {
        /* storage unavailable */
    }
    setOpen(initial);
    btn.addEventListener('click', () => setOpen(!wrap.classList.contains('open')));
    listenWhileInDocument(
        wrap,
        document,
        'pointerdown',
        (e) => {
            if (wrap.classList.contains('open') && !wrap.contains(e.target as Node)) setOpen(false);
        },
        true,
    );
    wrap.append(list, btn);
    return wrap;
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

/** The player's state lists the idle-ship cycler walks (Empire.BuiltObjects
 * / Empire.ShipGroups; null holes are skipped as non-idle). */
export interface IdleCycleEmpire {
    builtObjects: readonly (BuiltObject | null)[];
    shipGroups: readonly unknown[];
}

/** Current position of the idle-ship cycler (Main builtObject_4 / shipGroup_1). */
export interface IdleCycleState {
    builtObject: BuiltObject | null;
    shipGroup: ShipGroup | null;
}

function missionIsIdle(mission: unknown): boolean {
    const m = mission as { type?: BuiltObjectMissionType } | null;
    return m == null || m.type === BuiltObjectMissionType.Undefined;
}

/** Port of Main.Part7.cs method_349: from index `start`, step `dir` to the
 * next ShipGroup with no mission (or an Undefined one); null past the end. */
export function nextIdleShipGroup(empire: IdleCycleEmpire, start: number, dir: 1 | -1): ShipGroup | null {
    const groups = empire.shipGroups as readonly (ShipGroup | null)[];
    if (groups.length === 0) return null;
    let i = start;
    let num = 0;
    for (;;) {
        i += dir;
        num++;
        if (dir === 1 ? i >= groups.length : i < 0) return null;
        const g = groups[i];
        if (g && missionIsIdle(g.mission)) return g;
        if (num >= groups.length) return null;
    }
}

/** Port of Main.Part7.cs method_350: from index `start`, step `dir` to the
 * next idle ship — no ShipGroup, no mission (or Undefined), not a Base, not
 * under construction (BuiltAt == null) and not automated (!IsAutoControlled). */
export function nextIdleBuiltObject(empire: IdleCycleEmpire, start: number, dir: 1 | -1): BuiltObject | null {
    const list = empire.builtObjects;
    if (list.length === 0) return null;
    let i = start;
    let num = 0;
    for (;;) {
        i += dir;
        num++;
        if (dir === 1 ? i >= list.length : i < 0) return null;
        const b = list[i];
        if (
            b &&
            b.shipGroup == null &&
            missionIsIdle(b.mission) &&
            b.role !== BuiltObjectRole.Base &&
            b.builtAt == null &&
            !b.isAutoControlled
        ) {
            return b;
        }
        if (num >= list.length) return null;
    }
}

/** Port of Main.Part7.cs btnCycleIdleShips_Click (dir 1) and Main.Part4.cs
 * btnCycleIdleShipsBack_Click (dir -1): continue from the last idle ship or
 * fleet, wrapping between the ship list and the fleet list. Returns the new
 * cycler state (both null when nothing is idle). */
export function cycleIdleShips(empire: IdleCycleEmpire, state: IdleCycleState, dir: 1 | -1): IdleCycleState {
    let bo: BuiltObject | null = null;
    let sg: ShipGroup | null = null;
    const boEnd = dir === 1 ? -1 : empire.builtObjects.length;
    const sgEnd = dir === 1 ? -1 : empire.shipGroups.length;
    if (state.builtObject !== null) {
        bo = nextIdleBuiltObject(empire, empire.builtObjects.indexOf(state.builtObject), dir);
        if (bo === null) {
            sg = nextIdleShipGroup(empire, sgEnd, dir);
            if (sg === null) bo = nextIdleBuiltObject(empire, boEnd, dir);
        }
    } else if (state.shipGroup !== null) {
        sg = nextIdleShipGroup(empire, empire.shipGroups.indexOf(state.shipGroup), dir);
        if (sg === null) {
            bo = nextIdleBuiltObject(empire, boEnd, dir);
            if (bo === null) sg = nextIdleShipGroup(empire, sgEnd, dir);
        }
    } else if (dir === 1) {
        bo = nextIdleBuiltObject(empire, boEnd, dir);
        if (bo === null) sg = nextIdleShipGroup(empire, sgEnd, dir);
    } else {
        sg = nextIdleShipGroup(empire, sgEnd, dir);
        if (sg === null) bo = nextIdleBuiltObject(empire, boEnd, dir);
    }
    if (bo !== null) return { builtObject: bo, shipGroup: null };
    if (sg !== null) return { builtObject: null, shipGroup: sg };
    return { builtObject: null, shipGroup: null };
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
    // BaconInfoPanel.cs:401-402 Type (STATE / PRIVATE / Smuggler); Fleet (:418-436) the ship's fleet name.
    if (bo.pirateEmpireId > 0 && bo.role === BuiltObjectRole.Freight) rows.push({ label: 'Type', value: 'SMUGGLER' });
    else rows.push({ label: 'Type', value: bo.owner != null ? 'STATE' : 'PRIVATE' });
    const fleet = (bo.shipGroup as { name?: string } | null)?.name;
    if (fleet) rows.push({ label: 'Fleet', value: fleet });
    const design = bo.design?.name ?? '';
    if (design !== '') rows.push({ label: 'Design', value: design });
    rows.push({ label: 'Size', value: String(bo.size) });
    const location = bo.parentHabitat?.name ?? '';
    if (location !== '') rows.push({ label: 'Location', value: location });
    if (bo.troops !== null && bo.troops.count > 0) rows.push({ label: 'Troops', value: String(bo.troops.count) });
    return rows;
}

// ---------------------------------------------------------------------------------------------------------------
// [troopart] Troop images + invasion status (colony panel and the ship panel's troop transports).
// ---------------------------------------------------------------------------------------------------------------


function nonNullTroops(list: TroopList | null): Troop[] {
    return list !== null ? list.items.filter((t): t is Troop => t != null) : [];
}



export interface TroopStrengthText {
    /** "Show {colony} Ground/Battle Report  (Strength: …)". */
    text: string;
    /** InvadingTroops.Count > 0 — the row is drawn on the red pulsing highlight. */
    invading: boolean;
}

/**
 * Port of InfoPanel.cs:4408-4462: the "Show {colony} Ground/Battle Report  (Strength: …)" text. "Battle Report"
 * (red, pulsing — GraphicsHelper.OscillateColor, simplified to a CSS pulse in {@link troopStrengthRow}) once
 * InvadingTroops.Count > 0, "Ground Report" otherwise. With an invader the strength is
 * "{defend} ({composition})  vs  {attack}" (GameText "Battle Strength Description" = "{0}  vs  {1}"); without one
 * it's just "{defend} ({composition})". Composition is Galaxy.ResolveTroopCompositionDescription(habitat.Troops)
 * (Habitat.Troops only, not TroopsToRecruit). Pure (no DOM) so it is unit-testable against a hand-built colony
 * state; {@link troopStrengthRow} wraps it into a row element. Text only — no Ground/Battle Report screen
 * (TODO(port): InfoPanel.cs 4419/4497 Show Colony Ground/Battle Report screen).
 */
export function troopStrengthText(h: Habitat, galaxy: Galaxy): TroopStrengthText | null {
    const troops = h.troops;
    const troopsToRecruit = h.troopsToRecruit;
    const invadingTroops = h.invadingTroops;
    const characters = stellarObjectCharacters(h);
    const invadingCharacters = habitatInvadingCharacterList(h);
    const hasAny = (troops?.count ?? 0) > 0 || (invadingTroops?.count ?? 0) > 0 || (troopsToRecruit?.count ?? 0) > 0
        || (characters?.length ?? 0) > 0 || (invadingCharacters?.length ?? 0) > 0;
    if (!hasAny) return null;
    const resolved = resolveInvasionEmpires(h);
    const invader = resolved.invader;
    const defender = resolved.defender ?? h.empire;
    const defendingTroops = troops ?? new TroopList();
    const attackingTroops = invadingTroops ?? new TroopList();
    let { defendingStrength, attackingStrength } = calculateForceStrengths(galaxy, h, defender, invader, defendingTroops, characters, attackingTroops, invadingCharacters);
    const counts = troopCountsByType(nonNullTroops(troops));
    const compositionText = ` (${troopCompositionDescription(counts.infantry, counts.artillery, counts.armor, counts.specialForces)})`;
    const pop = calculatePopulationStrength(galaxy, h, invader, defender);
    if (pop.isDefending) defendingStrength += pop.result;
    else attackingStrength += pop.result;
    const invadingNow = invadingTroops !== null && invadingTroops.count > 0;
    const base = invadingNow ? `Show ${h.name} Battle Report` : `Show ${h.name} Ground Report`;
    const text = invader !== null
        ? `${base}  (Strength: ${formatThousandsK(defendingStrength)}${compositionText}  vs  ${formatThousandsK(attackingStrength)})`
        : `${base}  (Strength: ${formatThousandsK(defendingStrength)}${compositionText})`;
    return { text, invading: invadingNow };
}

/**
 * Colony / shipyard build queue row: the streamlined panel had no indicator at all for what a construction queue
 * was building or how far along — the user-report gap. Compact port of BaconInfoPanel.cs:4502-4516 /
 * InfoPanel.cs:3480-3495 `DrawBuiltObjectList("Building", …)`: the ship(s) each construction yard is currently
 * building, each with its percent complete (yardProgress, ConstructionYardListView.cs:128 BindData's Progress
 * column formula), plus the original's `waitingCount` suffix ("+N waiting", InfoPanel.cs:3606-3609) for ships
 * queued behind them. Returns null (the row is then hidden, {@link addText}'s "hide empty rows" convention) when
 * the queue is absent or nothing is under way. Pure — exported for unit testing; {@link buildingQueueRow} is the
 * DOM wrapper, untested directly (this project has no jsdom test environment).
 */
export function buildingQueueText(queue: ConstructionQueue | null): string | null {
    if (queue === null) return null;
    const yards = queue.constructionYards ?? [];
    const building: string[] = [];
    for (const yard of yards) {
        if (yard === null || yard === undefined || yard.shipUnderConstruction === null) continue;
        const pct = Math.round(yardProgress(yard) * 100);
        building.push(`${yard.shipUnderConstruction.name} (${pct}%)`);
    }
    const waiting = queue.constructionWaitQueue?.length ?? 0;
    if (building.length === 0 && waiting === 0) return null;
    let text = building.length > 0 ? building.join(', ') : '(None)';
    if (waiting > 0) text += ` +${waiting} waiting`;
    return text;
}



export interface InvasionVsText {
    /** "  {defend}   vs   {attack}" (InfoPanel.cs:4489 description7). */
    text: string;
    /** "Show {colony} Battle Report" (the row's hotspot text, InfoPanel.cs:4497). */
    title: string;
}

/**
 * Port of InfoPanel.cs:4469-4499: the actively-invading "defend  vs  attack" text (red, pulsing), present only
 * when `habitat.InvadingTroops.Count > 0` and the player can see it (the colony's owner, or the player is the
 * invader). The strength that is defending (or attacking) also gets the population's strength added, with the
 * "{n} from population" suffix (GameText "X from population" = "{0} from population"). Pure (no DOM); the wrapper
 * {@link invasionVsRow} builds the row element.
 */
export function invasionVsText(h: Habitat, galaxy: Galaxy, player: Empire | null): InvasionVsText | null {
    const invadingTroops = h.invadingTroops;
    if (invadingTroops === null || invadingTroops.count === 0) return null;
    const firstInvaderEmpire = (invadingTroops.items[0]?.empire ?? null) as Empire | null;
    if (h.empire !== player && firstInvaderEmpire !== player) return null;
    const resolved = resolveInvasionEmpires(h);
    const { invader, defender } = resolved;
    const characters = stellarObjectCharacters(h);
    const invadingCharacters = habitatInvadingCharacterList(h);
    const troops = h.troops ?? new TroopList();
    let { defendingStrength, attackingStrength } = calculateForceStrengths(galaxy, h, defender, invader, troops, characters, invadingTroops, invadingCharacters);
    const pop = calculatePopulationStrength(galaxy, h, invader, defender);
    let defendText: string;
    let attackText: string;
    if (pop.isDefending) {
        defendText = `${formatThousandsK(defendingStrength + pop.result)} (${formatThousandsK(pop.result)} from population)`;
        attackText = formatThousandsK(attackingStrength);
    } else {
        defendText = formatThousandsK(defendingStrength);
        attackText = `${formatThousandsK(attackingStrength + pop.result)} (${formatThousandsK(pop.result)} from population)`;
    }
    return { text: `  ${defendText}   vs   ${attackText}`, title: `Show ${h.name} Battle Report` };
}

// [/troopart]

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
    if (sector !== null) return `Sector ${sectorColumnName(sector.x)}${sector.y + 1}`;
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

/** The Automate / Unautomate toggle (Main.Part3.cs fleetSlots / the ship menu: `IsAutoControlled` picks the action;
 * a fleet uses its lead ship). Null unless the player owns a ship or a fleet. Goes through the command log. */
export function automationToggleLabel(target: BuiltObject | ShipGroup): { automated: boolean; label: string } {
    const lead = target instanceof ShipGroup ? target.leadShip : target;
    const automated = lead?.isAutoControlled === true;
    return { automated, label: automated ? 'Automated: On (click to turn off)' : 'Automated: Off (click to automate)' };
}


/** Hyperdrive status of a ship/base: "No hyperdrive" (WarpSpeed <= 0, BaconInfoPanel.cs:645), "Blocked" (hyperjump
 * disabled here / CanHyperJump false), "Charging (N s)" while the jump countdown (BuiltObject._HyperjumpCountdown, set
 * from Design.HyperjumpInitiate, cmdMovement.ts) runs, else "Ready". */
export function hyperjumpStatusText(bo: BuiltObject): string {
    if (bo.warpSpeed <= 0) return 'No hyperdrive';
    if (bo.hyperjumpDisabledLocation || bo.canHyperJump === false) return 'Blocked';
    if (bo.hyperjumpPrepare && bo._galaxy != null) {
        const left = Math.ceil((bo.hyperjumpCountdown - galaxyStarDate(bo._galaxy)) / 1000);
        if (left > 0) return `Charging (${left} s)`;
    }
    return 'Ready';
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
            const pct = retrofitProgressPercent(bo);
            components = `(RETROFITTING to ${bo.retrofitDesign.name}${pct === null ? '' : pct < 0 ? ' — waiting for a yard' : `: ${pct}%`})`;
        }
    }
    rows.push({ label: 'Components', value: components });

    // Construction progress: the C# has no text row for this (only the map/portrait reveal,
    // InfoPanel.cs:1371 OverlayConstructionProgress, and the fighter Health bar's "(Under construction)"
    // suffix, InfoPanel.cs:3580) — this mirrors that reveal's own percent-built formula (InfoPanel.cs:1382
    // `1 - UnbuiltComponentCount / Components.Count`) as a row, in the "NN% Complete" phrasing the original
    // does use for a colony's planetary facilities (InfoPanel.cs:2578-2582 `ConstructionProgress.ToString
    // ("0%") + " Complete"`) — the user-facing % indicator the streamlined panel was missing entirely.
    if (known && bo.unbuiltComponentCount > 0 && bo.components.count > 0) {
        const pct = Math.round((100 * (bo.components.count - bo.unbuiltComponentCount)) / bo.components.count);
        rows.push({ label: 'Construction', value: `${pct}% Complete` });
    }

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

    // Energy (BaconInfoPanel.cs:622-630) — only ships with a reactor store show it.
    if (known && bo.reactorStorageCapacity > 0) {
        rows.push({ label: 'Energy', value: `${Math.max(0, Math.trunc(bo.currentEnergy))} / ${Math.trunc(bo.reactorStorageCapacity)}` });
    }

    // Shields (BaconInfoPanel.cs:631-635 DrawBarGraph "Shields"; current / capacity, " (reducing)" while ShieldsReducedLocation)
    if (bo.shieldsCapacity > 0 || known) {
        rows.push({ label: 'Shields', value: `${Math.trunc(bo.currentShields)} / ${Math.trunc(bo.shieldsCapacity)}${bo.shieldsReducedLocation ? ' (reducing)' : ''}` });
    }

    // Speed (BaconInfoPanel.cs:637-651)
    if (bo.role !== BuiltObjectRole.Base) {
        // TODO(port): " (slowed)" — BuiltObject.MovementSlowedLocation not in sim
        let suffix = '';
        if (bo.hyperjumpDisabledLocation) suffix += ' (Hyper block)';
        if (bo.warpSpeed <= 0) suffix = ' (No Hyperdrive)';
        rows.push({ label: 'Speed', value: `${Math.trunc(bo.currentSpeed)} / ${Math.trunc(bo.topSpeed)}${suffix}` });
    }

    // Hyperjump readiness (streamlined: the original only shows the "(No Hyperdrive)" / "(Hyper block)" speed suffixes
    // and turns the speed bar red while HyperjumpPrepare; the countdown is the sim's _HyperjumpCountdown).
    rows.push({ label: 'Hyperjump', value: hyperjumpStatusText(bo) });

    // Weapons (BaconInfoPanel.cs:710-713): "Firepower: N, Range: M", or "(None)".
    rows.push({ label: 'Weapons', value: bo.firepowerRaw === 0 ? '(None)' : `Firepower: ${bo.firepowerRaw}, Range: ${Math.trunc(bo.maximumWeaponsRange)}` });

    // streamlined: not a row in the original panel
    if (known && bo.cargoCapacity > 0) {
        let used = 0;
        for (const c of bo.cargo?.items ?? []) used += Math.max(0, c.amount);
        rows.push({ label: 'Cargo', value: `${used} / ${bo.cargoCapacity}` });
    }
    return rows;
}

/** Drive the camera for a View-list action. */
/** The top-more menu's Galaxy Map item: the Galaxy Map window, or the whole galaxy on the Main View without one. */
function openGalaxyMap(wiring: HudWiring): void {
    if (wiring.onGalaxyMap) {
        wiring.onGalaxyMap();
        return;
    }
    const cam = wiring.camera;
    if (cam) cam.zoomAt(GALAXY_LEVEL_ZOOM, cam.width / 2, cam.height / 2);
}

/** The selection panel's hover message (Main.Part10.cs 1141-1159): the hovered hotspot's message, else the panel's
 *  own hint. */
export function selectionPanelHint(hotspotMessage: string | undefined): string {
    return hotspotMessage !== undefined && hotspotMessage !== '' ? hotspotMessage : 'Selection Panel: click to center view on selected item';
}

/** Where method_157 moves the view for a selection (Main.Part11.cs 2241: the habitat / built object / creature's
 *  position; a fleet's lead ship, the first of several ships); null without a selection. */
export function selectionViewTarget(sel: Selection | null): { x: number; y: number } | null {
    if (sel === null) return null;
    const t = sel.builtObject ?? sel.builtObjects?.[0] ?? sel.creature ?? sel.habitat;
    return { x: t.xpos, y: t.ypos };
}

/** btnZoomSelection_Click (Main.Part4.cs 2153; Backspace calls the same): with a selection, move the view to it
 *  (method_157) unless the view is locked on it, then zoom to 100 % (method_4(1.0)). False when nothing is selected. */
export function zoomToSelectedItem(cam: Camera): boolean {
    const t = selectionViewTarget(currentSelection);
    if (t === null) return false;
    if (!isViewLocked()) cam.centerOn(t.x, t.y);
    if (cam.zoom !== 1) setZoomFactor(cam, 1.0);
    return true;
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
 * bottom (the original's message ticker: four lines show in the 80 px box, the
 * oldest is scrolling out above). Module state so later systems can
 * push via {@link pushHudMessage} without holding a HUD reference. */
const MESSAGE_LINES = 5;
let hudMessages: string[] = [];
/** Per ticker line, the jump for its message (Go to its location), or null when it has none. Parallel to hudMessages. */
let hudMessageGotos: Array<(() => boolean) | null> = [];
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
    // Clicking a ticker line that is about a place jumps there (Main.Part9.cs method_249); other lines fall through to
    // the panel's click, which opens the message history.
    messageLineEls?.forEach((el, i) => {
        el.addEventListener('click', (ev) => {
            if (tickerLineGoto(i, messageLineEls!.length)) ev.stopPropagation();
        });
    });
    renderMessages();
}

/** Ring-buffer index shown in ticker slot `slot` of `slotCount`: bottom-aligned, newest in the last slot
 * (ScrollingLinkList adds each line below the previous ones), empty slots above. */
function tickerSlotIndex(slot: number, slotCount: number): number {
    return slot - (slotCount - hudMessages.length);
}

/** Re-render the bound message lines from the ring buffer (newest at the
 * bottom, empty slots above). */
function renderMessages(): void {
    if (!messageLineEls) return;
    for (let i = 0; i < messageLineEls.length; i++) {
        const idx = tickerSlotIndex(i, messageLineEls.length);
        messageLineEls[i].textContent = hudMessages[idx] ?? '';
        messageLineEls[i].classList.toggle('hud-message-goto', (hudMessageGotos[idx] ?? null) !== null);
    }
}

/** Run the Go to of the ticker line in slot `slot` of `slotCount`; true when the line had one. Exported for tests. */
export function tickerLineGoto(slot: number, slotCount: number): boolean {
    const idx = tickerSlotIndex(slot, slotCount);
    const go = hudMessageGotos[idx] ?? null;
    return go !== null ? go() : false;
}

/** Push a message into the top-middle ticker (keeps the last 5, newest at
 * the bottom) and into the full history. `at` is an optional display date
 * (main.ts will pass the game date); it defaults to ''. Exported for later
 * systems (events, diplomacy, ...). */
export function pushHudMessage(text: string, at?: string, goTo: (() => boolean) | null = null): void {
    hudMessages.push(text);
    hudMessageGotos.push(goTo);
    while (hudMessages.length > MESSAGE_LINES) {
        hudMessages.shift();
        hudMessageGotos.shift();
    }
    hudMessageHistory.push({ text, at: at ?? '' });
    while (hudMessageHistory.length > HISTORY_LIMIT) hudMessageHistory.shift();
    renderMessages();
    // ScrollingLinkList.cs AddItem / method_3: a new line enters below the box and scrolls up into place.
    const box = messageLineEls?.[0]?.parentElement;
    if (box) {
        box.classList.remove('hud-message-scroll');
        void box.offsetWidth; // restart the animation
        box.classList.add('hud-message-scroll');
    }
}

/** Test hook: drop all pushed messages (also clears the rendered lines and
 * the full history). */
export function clearHudMessages(): void {
    hudMessages = [];
    hudMessageGotos = [];
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

/** 19b/19f: a "Threat" row for a selected colony / ship the player knows as a scenario threat site (read-only, from the
 * framework selector threatKnownSites; nothing without a scenario). */
export function threatRows(target: Habitat | BuiltObject, player: Empire | null): { label: string; value: string; color?: number }[] {
    if (player === null || player.galaxy.scenario === null) return [];
    return threatKnownSites(player.galaxy, player)
        .filter((s) => s.target === target)
        .map((s) => ({ label: 'Threat', value: s.label }));
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


/** Name of the system nearest the camera centre, or '' if unavailable. 19i item 11: the rim name override
 *  (rimSystemDisplayName) replaces the base name for a rim system when the scenario flag is on — a display-time
 *  swap only, so `dwu.galaxy` may be the real Galaxy or any object carrying its `scenario` field. */
export function nearestSystemName(
    dwu: { galaxy?: { systems?: Array<{ systemStar: { name: string; xpos: number; ypos: number; systemIndex: number } }>; scenario?: RimNameHost['scenario'] } } | undefined,
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
    if (best < 0) return '';
    const star = systems[best].systemStar;
    return rimSystemDisplayName({ scenario: dwu?.galaxy?.scenario ?? null }, star.systemIndex, star.name);
}
/** Selection-panel dispatch orders for a selected habitat: each sends the nearest idle unselected ship that can take
 *  the order (sim/player/habitatDispatch.ts) through the player command path, then toasts which ship went. Shown in
 *  the action strip's empty slots (or the overflow row). */
/** Original chrome art for a dispatch order (build orders show the station design's own picture, like the
 *  original's build buttons); null = text label. */
function dispatchIcon(id: string, design: { pictureRef: number; subRole: number } | null): string | undefined {
    const chrome = (f: string): string => `/assets/dwu/images/ui/chrome/${f}`;
    if (id.startsWith('build:')) return (design !== null ? selectionShipIconUrl(design) : null) ?? chrome('build.png');
    const mt = Number(id.slice('mission:'.length));
    switch (mt) {
        case BuiltObjectMissionType.Explore: return chrome('longrangescanner.png');
        case BuiltObjectMissionType.Colonize: return chrome('colonize.png');
        case BuiltObjectMissionType.ExtractResources: return chrome('mine.png');
        case BuiltObjectMissionType.Attack: return chrome('attack.png');
        case BuiltObjectMissionType.Bombard: return chrome('bombard.png');
        case BuiltObjectMissionType.Capture: return chrome('troops.png');
        case BuiltObjectMissionType.Raid: return chrome('raid.png');
        case BuiltObjectMissionType.LoadTroops: return chrome('loadtroops.png');
        case BuiltObjectMissionType.UnloadTroops: return chrome('troopsButton.png');
        case BuiltObjectMissionType.Patrol:
        case BuiltObjectMissionType.Blockade:
            return chrome('fleetDefendPosture.png');
    }
    return undefined;
}

/** The dispatch slots for habitat `h`, handed to `done` once the journaled 'habitatDispatch' command applied (it builds
 *  the candidate ships' action menus, which draws galaxy.rnd: playerOps.ts). */
export function habitatDispatchSlots(galaxy: Galaxy, player: Empire, h: Habitat, done: (slots: SelectionExtraSlot[]) => void): void {
    issuePlayerCommand(galaxy, player, 'habitatDispatch', [h], (options) => done(options.map((o) => ({
        label: o.label,
        title: `${o.label}: ${o.hint}`,
        icon: dispatchIcon(o.id, o.action?.design ?? null),
        disabled: o.ship === null,
        onClick: () => clickDispatchSlot(galaxy, player, h, o),
    }))));
}

/** Dispatch slot orders on their way (habitat index | option id). */
const dispatchBusy = new PendingOnce<string>();

/** Whether a dispatch slot's order is still on its way (tests). */
export function dispatchSlotBusy(h: Habitat, optionId: string): boolean {
    return dispatchBusy.busy(`${h.habitatIndex}|${optionId}`);
}

/**
 * A click on dispatch slot `o`. One order per slot until its reply lands (pendingCommands.ts): a double click sends one
 * ship, in both modes (the second click would re-resolve before the first order reached the game). Every way the chain
 * can end — the order's reply, a refusal, a command that could not be sent or whose executor threw, an exception here —
 * releases the slot and says so in a toast, so the button can never stay silently locked.
 */
function clickDispatchSlot(galaxy: Galaxy, player: Empire, h: Habitat, o: DispatchOption): void {
    const end = dispatchBusy.start(`${h.habitatIndex}|${o.id}`);
    if (end === null) return;
    let ended = false;
    const finish = (text: string): void => {
        if (ended) return;
        ended = true;
        end();
        showToast(text);
    };
    const failed = (reason: string): void => finish(`${o.label} ${h.name}: ${reason}`);
    // Re-resolve at click time: ships' queues and positions have moved since the panel was drawn.
    issueDispatchCommand(galaxy, player, 'habitatDispatch', [h], (now) => dispatchOrder(galaxy, player, h, o, now.find((x) => x.id === o.id), finish, failed), failed);
}

/** issuePlayerCommand for the dispatch chain: an exception from the issue itself or from `onApplied` goes to `failed`. */
function issueDispatchCommand<K extends PlayerOpName>(
    galaxy: Galaxy,
    player: Empire,
    op: K,
    args: PlayerOpArgs<K>,
    onApplied: (r: PlayerOpResult<K>) => void,
    failed: (reason: string) => void,
): void {
    const guarded = (r: PlayerOpResult<K>): void => {
        try {
            onApplied(r);
        } catch (err) {
            failed(err instanceof Error ? err.message : String(err));
            throw err;
        }
    };
    try {
        issuePlayerCommand(galaxy, player, op, args, guarded, failed);
    } catch (err) {
        failed(err instanceof Error ? err.message : String(err));
        throw err;
    }
}

/**
 * The player's own Design for `design` (a design an order reply named): the same object when it is in the empire's
 * design list, else the listed design of the same name and sub-role. In sim-worker mode the replica's design is what
 * the command sends by sync id, so the worker gets the authoritative design (a stray copy would travel by value and
 * reach the game as a design no empire owns).
 */
export function playerDesignFor(player: Empire, design: Design): Design {
    const designs = player.designs as Design[];
    if (designs.includes(design)) return design;
    return designs.find((d) => d.name === design.name && d.subRole === design.subRole) ?? design;
}

/** Give the dispatch order `o` as re-resolved at click time (`fresh`); `finish` with the outcome's toast once its reply
 *  landed, `failed` when it could not be given. */
function dispatchOrder(
    galaxy: Galaxy,
    player: Empire,
    h: Habitat,
    o: DispatchOption,
    fresh: DispatchOption | undefined,
    finish: (text: string) => void,
    failed: (reason: string) => void,
): void {
    if (!fresh || fresh.ship === null || fresh.action === null) {
        finish(`No available ${o.role}`);
        return;
    }
    const ship = fresh.ship;
    const design = fresh.action.design;
    if (o.id.startsWith('build:') && design !== null) {
        // Build orders go onto the empire's construction job board (sim/player/constructionBoard.ts): the
        // construction ship that finishes it first takes it, instead of a backlog on one ship.
        const p = fresh.action.position;
        const zero = p.x === 0 && p.y === 0;
        issueDispatchCommand(
            galaxy,
            player,
            'constructionJobAdd',
            [playerDesignFor(player, design), h, zero ? COORD_UNSET_DOUBLE : p.x, zero ? COORD_UNSET_DOUBLE : p.y],
            (id) => finish(id === 0 ? `${o.label} ${h.name}: not possible` : `Construction job added: ${o.label} at ${h.name}`),
            failed,
        );
        return;
    }
    issueDispatchCommand(
        galaxy,
        player,
        'shipAction',
        [ship, fresh.action, true, { x: h.xpos, y: h.ypos }],
        (r) => finish(r.ok === false ? `${ship.name}: ${r.message ?? 'order refused'}` : `${ship.name} sent: ${o.label} ${h.name}`),
        failed,
    );
}
