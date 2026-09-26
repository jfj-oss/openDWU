// Boot: create the PixiJS app, generate the galaxy from URL parameters
// (?seed=, ?shape=, ?stars=, ?zoom=, ?cx=, ?cy=) and start the Main View.
// All DW:U data/art is fetched by URL from /assets/dwu/... (mapped to the
// install folder by the desktop shell; under `npm run dev` a public symlink
// plus the probe middleware in vite.config.ts does the same).

import { Application } from 'pixi.js';
import { Camera } from './render/camera';
import { MainView } from './render/mainView';
import { AssetStore, loadManifest } from './render/assets';
import { generateGalaxy } from './sim/galaxy';
import { Galaxy } from './sim/galaxy';
import { createGame, type CreateGameOptions } from './sim/game';
import { parseSystemNames } from './sim/data';
import { loadGameData, type FetchText, type GameData } from './sim/data/gameData';
import { GalaxyShape } from './sim/types';
import { clearHudMessages, playPauseHint, createHud, layoutHud, nearestSystem, nearestSystemName, pushHudMessage, setSelection as setHudSelection, type HudRefs } from './ui/hud';
import { GalaxyTime } from './sim/clock';
import { resolveStarDateDescription } from './sim/galaxyTime';
import { createSimLoop, simViewEnabledFromUrl } from './simLoop';
import { formatClockLabel, SECTOR_LEVEL_ZOOM, SYSTEM_LEVEL_ZOOM, type Selection } from './ui/hud';
import { Habitat, HabitatCategoryType } from './sim/types';
import { createMapOverlayState, type MapOverlayState, type OverlayKey } from './ui/mapOverlays';
import { buildDefaultHandlers, createShortcutsOverlay, dispatchKey, setCycleHandler, setGameMenuHandler } from './ui/keyboard';
import { closeEmpiresList } from './ui/screens/empiresList';
import { closeDiplomacyScreen } from './ui/screens/diplomacyScreen'; // [15a]
import { closeExpansionPlanner } from './ui/screens/expansionPlanner'; // [16a]
import { closeColoniesList } from './ui/screens/coloniesList';
// [tradenego] begin
import { closeTradePanel } from './ui/screens/tradePanel';
// [tradenego] end
import { closeShipsAndBasesList } from './ui/screens/shipsAndBasesList';
import { closeResearchScreen } from './ui/screens/researchScreen'; // [15b]
import { closeShipDesigns } from './ui/screens/shipDesigns'; // [16b]
import { closeEmpireSummary, setEmpireSummarySource } from './ui/screens/empireSummary';
// [advisor] begin
import { closeAdvisorPanel } from './ui/advisorPanel';
// [advisor] end

// [aiadvisor] begin
import { aiAdvisorSettingsWithUrl, startAiAdvisorDriver } from './ui/aiAdvisorDriver';
import { closeCouncilLog, pushCouncilLog } from './ui/aiAdvisorLog';
import { getSettings } from './ui/settings';
// [aiadvisor] end
import { closeMessageHistory } from './ui/screens/messageHistory';
import { closeFleetsList } from './ui/screens/fleetsList'; // [15c]
import { closeBuildOrder } from './ui/screens/buildOrder'; import { closeConstructionYards } from './ui/screens/constructionYards'; // [16c]
import { createEmpireMessageFeed, recordTickerMessage, savedHistoryLines } from './ui/empireMessageFeed';
// [policy] begin
import { closeEmpirePolicy } from './ui/screens/empirePolicy';
// [policy] end
// [troops] begin
import { closeTroopsScreen } from './ui/screens/troops';
// [troops] end

// [intel] begin
import { closeIntelligenceScreen } from './ui/screens/intelligence';
// [intel] end
import { createMainMenu } from './ui/screens/mainMenu';
import { openOptionsModal } from './ui/screens/mainMenu';
import { createTutorialsScreen, openTutorialWindow } from './ui/screens/tutorials';
import { createCreditsScreen } from './ui/screens/credits';
import { startMusic } from './audio/musicPlayer';
import { createNewGameWizard } from './ui/screens/newGameWizard';
import { openGalactopedia } from './ui/screens/galactopedia';
import { defaultStartGameOptions, piratesFor, STARTING_TECH_LEVEL, toCreateGameOptions, type StartGameOptions, maximumEmpireAmountFor, starCountFor } from './sim/startGameOptions';
import { serializeGame, deserializeGame } from './sim/save/gameSave';
// [leftovers] begin
import { closeGalacticHistory } from './ui/screens/galacticHistory';
import { installEventMessages, removeEventMessages } from './ui/eventMessages';
import { installAutosave, removeAutosave } from './ui/autosave';
import { isGameOptionsPanelOpen } from './ui/screens/gameOptionsPanel';
// [leftovers] end
import { setSaveLoadProvider, createSaveLoadPanel, type LoadedGame } from './ui/screens/saveLoad';
import { type Game } from './sim/game';
import { createGalaxyMap, type GalaxyMapScreen } from './ui/screens/galaxyMap';
import { hideMapTooltip } from './ui/mapTooltip';
import { closeEmpireComparison, closeGameEndBanner, installGameEndHandler, removeGameEndHandler } from './ui/screens/empireComparison'; // [15d]
import { installMessagePopups, removeMessagePopups } from './ui/messagePopups'; import { closeGameOptionsPanel } from './ui/screens/gameOptionsPanel'; // [16d]
import { installOrderUi, selectionTarget } from './ui/orderMenu'; import { getSelection as getHudSelection, selectShipGroup, selectStellarObject } from './ui/hud'; import { ShipGroup } from './sim/fleets/shipGroup'; import { Fighter } from './sim/combat/fighters'; // [ordermenu]
// [suggest] begin
import { installAdvisorSuggestions, removeAdvisorSuggestions } from './ui/advisorSuggestions';
import { expireConversationsForEmpire } from './ui/messagePopups';
import { toggleBuildOrder } from './ui/screens/buildOrder';
import { Creature } from './sim/creature';
// [suggest] end

// [popupstubs] begin
import { installMessageStubList, removeMessageStubList } from './ui/messageStubList';
// [popupstubs] end

// [fix6ui] begin
import { setShipCommandHandler } from './ui/keyboard';
import { refreshSelectionActionBar } from './ui/orderMenu';
import { selectHabitat } from './ui/hud';
import { createShipCommandKeys, type ShipCommandKeys } from './ui/shipCommandKeys';
import { showToast } from './ui/toast';
// [fix6ui] end

import './ui/hud.css';

// ?shape= names accepted by the boot URL.
const SHAPE_BY_NAME: Record<string, GalaxyShape> = {
    spiral: GalaxyShape.Spiral,
    elliptical: GalaxyShape.Elliptical,
    irregular: GalaxyShape.Irregular,
    ring: GalaxyShape.Ring,
    clustereven: GalaxyShape.ClustersEven,
    clustersvaried: GalaxyShape.ClustersVaried,
};

// Used when no DW:U install (systemNames.txt) is available so generation
// still runs with plausible names.
const FALLBACK_SYSTEM_NAMES = [
    'Aldra', 'Borin', 'Cathis', 'Dravos', 'Eltan', 'Fennra', 'Ghoris', 'Halvard',
    'Iskren', 'Jovara', 'Keldris', 'Lumien', 'Morvath', 'Nethis', 'Ostara', 'Pellin',
    'Quarion', 'Raventh', 'Solvane', 'Thessik', 'Ulmaran', 'Vindemi', 'Wyrnhol', 'Xanthea',
    'Yorvane', 'Zarell', 'Anthis', 'Brakka', 'Cordelis', 'Drenn', 'Erynd', 'Fellmar',
    'Gryvanne', 'Hordath', 'Ilyra', 'Jorvane', 'Kaldris', 'Lynthea', 'Mordath', 'Nyrvane',
    'Orvallis', 'Quendrin', 'Rethalis', 'Silvarin', 'Torvane', 'Undris', 'Vellora', 'Wynthal',
    'Xalvane', 'Yorvath', 'Zelindra', 'Aldrenna', 'Brythas', 'Caelvane', 'Dorvane', 'Elthyr',
    'Feldris', 'Gravenne', 'Iskval', 'Jorvane II', 'Keltharis', 'Lorvane', 'Melthas', 'Nyrthala',
];

/** Probe whether a DW:U install (original data/art) is reachable. */
async function detectDwuPresent(): Promise<boolean> {
    try {
        // Dev server: dedicated probe middleware (vite.config.ts).
        const r = await fetch('/assets/dwu/__dwu_probe');
        if (r.ok) {
            const j = (await r.json()) as { present: boolean };
            return j.present;
        }
    } catch {
        // no probe endpoint (built desktop shell)
    }
    try {
        // Built shell: probe a data file directly.
        return (await fetch('/assets/dwu/systemNames.txt')).ok;
    } catch {
        return false;
    }
}

/**
 * Load the system name list from systemNames.txt. Port of Galaxy.4.cs
 * LoadSystemNames: lines starting with `'` are comments; each other line is
 * a comma-separated list of names (with a trailing comma), trimmed, empties
 * dropped. (The file is NOT one-name-per-line.)
 */
async function loadSystemNames(dwuPresent: boolean): Promise<string[]> {
    if (dwuPresent) {
        try {
            const text = await (await fetch('/assets/dwu/systemNames.txt')).text();
            const names = parseSystemNames(text);
            if (names.length > 0) {
                return names;
            }
        } catch {
            // fall through to the fallback list
        }
    }
    return FALLBACK_SYSTEM_NAMES;
}

/** Keys that, when present on the boot URL, skip the main menu and boot
 * straight into the game (keeps screenshot scripts / dev links working). */
const SKIP_MENU_PARAMS = ['seed', 'shape', 'stars', 'zoom', 'cx', 'cy', 'select', 'skipMenu', 'autostart'];

/** FetchText for the browser: try each candidate URL in order. */
const fetchTextBrowser: FetchText = async (candidates: string[]): Promise<string> => {
    for (const url of candidates) {
        try {
            const r = await fetch(url);
            if (r.ok) {
                return await r.text();
            }
        } catch {
            // try the next candidate
        }
    }
    throw new Error(`Could not load any of: ${candidates.join(', ')}`);
};

/** Load all parsed DW:U data (resources, races, ...) when an install is
 * reachable; null otherwise so generation falls back to no resources. */
async function loadGameDataOrNone(dwuPresent: boolean): Promise<GameData | null> {
    if (!dwuPresent) return null;
    try {
        return await loadGameData(fetchTextBrowser);
    } catch (err) {
        console.warn('DW:U game data failed to load; continuing without it', err);
        return null;
    }
}

// Task 11a3: module-level state for the save/load panels. The loaded game
// data is remembered so a later "Load Game" can deserialize saved games
// (deserializeGame needs the static race/resource/research tables).
let lastGameData: GameData | null = null;
let lastStartOptions: StartGameOptions | null = null;
let activeSavePanel: ReturnType<typeof createSaveLoadPanel> | null = null;
/** Saves that could not be written to localStorage (quota), kept for this
 * session and shared by every save/load panel (in-game and main menu). */
const sessionSaves = new Map<string, string>();
/** The main menu currently on screen (closed when a save is loaded from it). */
let activeMainMenu: { destroy: () => void } | null = null;

/** Load the static game data and the art manifest once, for paths that did
 * not boot through the wizard/autostart (main-menu Load Game). */
async function ensureStaticData(): Promise<void> {
    if (lastGameData !== null) return;
    const dwuPresent = await detectDwuPresent();
    lastGameData = await loadGameDataOrNone(dwuPresent);
    if (dwuPresent) {
        await loadManifest();
    }
}
let activeGameViewCleanup: (() => void) | null = null;

/** Task M2e2: build the `window.__dwu` debug/screenshot object (pure — no
 * window access, so it is testable without jsdom). The parameter types are
 * structural (any non-null value) so tests can pass plain objects instead of
 * real Camera/Galaxy/MainView/Application instances. */
export function buildDwuDebugObject(args: { camera: object; galaxy: object; view: object; app: object; game?: Game; time?: GalaxyTime }): Record<string, unknown> {
    const obj: Record<string, unknown> = { camera: args.camera, galaxy: args.galaxy, view: args.view, app: args.app };
    if (args.game !== undefined) {
        obj.game = args.game;
    }
    if (args.time !== undefined) {
        // Task 06l: the running clock, so the tutorial window's "Play This
        // Game" button can unpause it.
        obj.time = args.time;
    }
    return obj;
}

/** Task M3: `?overlays=` token → MapOverlayState key, including short
 * screenshot-friendly aliases alongside the full field names. */
const OVERLAY_PARAM_ALIASES: Record<string, OverlayKey> = {
    potentialColonies: 'potentialColonies',
    colonies: 'potentialColonies',
    scenic: 'scenicLocations',
    scenicLocations: 'scenicLocations',
    research: 'researchLocations',
    researchLocations: 'researchLocations',
    territory: 'empireTerritory',
    empireTerritory: 'empireTerritory',
    fleetPostures: 'fleetPostures',
    travelVectorsState: 'travelVectorsState',
    travelVectorsPrivate: 'travelVectorsPrivate',
    longRangeScanners: 'longRangeScanners',
    fadeCivilianShips: 'fadeCivilianShips',
};

/** Screenshot / dev hook: `?overlays=potentialColonies,scenic,research`
 * turns on the named overlay toggles at boot (task M3 verification), e.g.
 * `?autostart=1&zoom=1200&overlays=potentialColonies,scenic,research`. */
function applyOverlaysUrlParam(overlays: MapOverlayState): void {
    const raw = new URLSearchParams(window.location.search).get('overlays');
    if (raw === null) return;
    for (const token of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
        const key = OVERLAY_PARAM_ALIASES[token];
        if (key !== undefined) overlays[key] = true;
    }
}

/** Task C3: the Galaxy Map screen for a game view (G key / HUD row); closes
 * by jumping the Main View camera. */
function createGalaxyMapFor(galaxy: Galaxy, camera: Camera): GalaxyMapScreen {
    const galaxyMap = createGalaxyMap({
        galaxy,
        getViewRect: () => {
            const tl = camera.screenToWorld(0, 0);
            const br = camera.screenToWorld(camera.width, camera.height);
            return { x: tl.x, y: tl.y, width: br.x - tl.x, height: br.y - tl.y };
        },
        jumpTo: (x, y) => camera.centerOn(x, y),
        // The Main View hover tooltip would otherwise stay over the map.
        onOpen: () => hideMapTooltip(),
    });
    document.body.appendChild(galaxyMap.element);
    return galaxyMap;
}

/** Task M2e2: one shared boot used by the wizard Start, `?autostart=1` and
 * save-load — centres the camera on the player's capital at Sector zoom,
 * wires the HUD/clock/input, and sets `window.__dwu` (camera, galaxy, view,
 * app, game). Returns the GalaxyTime it created so callers (the save/load
 * provider, task 11a3) can serialize the running game. The clock is a view
 * over the galaxy's sim clock (galaxy.nowMs, start date from Galaxy.Age);
 * `savedClock` carries a loaded save's pause/speed controls. */
export async function startGameView(
    game: Game,
    zoomOverride?: number,
    extraBoots?: Array<() => void>,
    savedClock?: { speed: number; paused: boolean },
): Promise<GalaxyTime> {
    const dwuPresent = await detectDwuPresent();
    if (dwuPresent) {
        // Real-art file lists (scripts/gen-asset-manifest.mjs, predev/prebuild).
        await loadManifest();
    }
    const galaxy = game.galaxy;

    // Task 10d: first message of the top-middle ticker — the founding line.
    const playerCapital = game.playerEmpire?.capital ?? null;
    const systemName = playerCapital !== null ? galaxy.systems[playerCapital.systemIndex].systemStar.name : '';
    const foundingMessage = `${game.playerEmpire.name} founded at ${playerCapital?.name ?? ''} (${systemName} system)`;

    const app = new Application();
    await app.init({
        resizeTo: window,
        // Render at the display's device pixel ratio (HiDPI / 4K): without this Pixi draws at 1x
        // and the browser upscales the canvas, which looks like a 720p capture on a 2x screen.
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
        background: 0x000000,
        antialias: true,
        preference: 'webgl',
    });
    document.body.appendChild(app.canvas);

    const camera = new Camera();
    camera.setViewport(app.renderer.width, app.renderer.height);
    camera.setGalaxyBounds(galaxy.sizeX, galaxy.sizeY);
    // Task M2e3: the Sector-level zoom must be applied AFTER any code that
    // resets the camera to the whole-galaxy view (the order bug left the view
    // at minZoom). Centre on the player's capital (createGame returns
    // viewX/viewY as fallback when it is null).
    const capital = game.playerEmpire?.capital ?? null;
    camera.centerOn(capital !== null ? capital.xpos : game.viewX, capital !== null ? capital.ypos : game.viewY);
    camera.zoom = camera.minZoom;
    if (zoomOverride !== undefined) {
        // Task M2e3: an explicit ?zoom= on the autostart path overrides the
        // Sector-level default (same factor/reciprocal semantics as the
        // generateGalaxy boot path below).
        camera.zoom = camera.clampZoom(zoomOverride >= 1 ? 1 / zoomOverride : zoomOverride);
    } else {
        camera.zoomAt(SECTOR_LEVEL_ZOOM, camera.width / 2, camera.height / 2);
    }

    const store = new AssetStore(dwuPresent);
    // Task M3: the overlay toggle state is created here (instead of after
    // MainView, as before) so the Main View's overlay layer and the HUD's
    // options list share the same MapOverlayState instance.
    const overlays = createMapOverlayState();
    applyOverlaysUrlParam(overlays);
    const view = new MainView(app, camera, galaxy, store, overlays);
    await view.init();

    // One clock: the HUD's GalaxyTime is bound to galaxy.nowMs by createSimLoop (the scheduler advances it).
    const time = new GalaxyTime();
    if (savedClock !== undefined) {
        time.speed = savedClock.speed;
        time.paused = savedClock.paused;
    }
    const simLoop = createSimLoop(galaxy, time, camera, simViewEnabledFromUrl(window.location.search));
    if (savedClock === undefined) {
        // New game: the founding line, dated at the game start.
        pushHudMessage(foundingMessage, resolveStarDateDescription(time.currentStarDate));
    } else {
        // Loaded game: rebuild the ticker/history from the saved message
        // history (Empire.MessageHistory) instead of re-emitting the founding
        // line at the load date.
        for (const line of savedHistoryLines(game.playerEmpire)) {
            pushHudMessage(line.text, line.starDate > 0 ? resolveStarDateDescription(line.starDate) : '');
        }
    }
    // Debug / screenshot hook: the created game (galaxy + player empire).
    // Task 06l: also exposes the running clock (`time`) so the tutorial
    // window's "Play This Game" button can unpause it.
    (window as unknown as { __dwu?: unknown }).__dwu = buildDwuDebugObject({ camera, galaxy, view, app, game, time });
    Object.assign((window as unknown as { __dwu: Record<string, unknown> }).__dwu, { sim: simLoop.driver, simStats: simLoop.stats });

    // [aiadvisor] begin — 18c: the local model's strategic decisions for AI empires (off unless enabled + a server).
    const aiAdvisorParams = new URLSearchParams(window.location.search);
    const aiAdvisor = startAiAdvisorDriver({
        galaxy,
        player: game.playerEmpire,
        settings: () => aiAdvisorSettingsWithUrl(getSettings(), aiAdvisorParams),
        onTurn: pushCouncilLog,
    });
    (window as unknown as { __dwu: Record<string, unknown> }).__dwu.aiAdvisor = aiAdvisor.driver;
    // [aiadvisor] end
    // Task 10d: the HUD's money panel refreshes from the player empire.
    // Task C3: Galaxy Map screen (G key / HUD "Galaxy map (G)" row).
    const galaxyMap = createGalaxyMapFor(galaxy, camera);
    (window as unknown as { __dwu?: Record<string, unknown> }).__dwu!.galaxyMap = galaxyMap;
    // [fix6ui] begin — ship-order / selection keys (created after the order UI below).
    let shipKeys: ShipCommandKeys | null = null;
    Object.assign((window as unknown as { __dwu: Record<string, unknown> }).__dwu, { simBudget: simLoop.budget });
    // [fix6ui] end
    const hud: HudRefs = createHud({
        clock: time,
        overlays,
        camera,
        galaxy,
        game,
        gameData: lastGameData ?? undefined,
        onGalaxyMap: () => galaxyMap.toggle(),
        onMainMenu: () => {
            teardownActiveGameView();
            showMainMenu();
        },
        // Keep the Main View selection ring on whatever the panel shows.
        afterSelectionChange: (sel) => {
            view.selectedBuiltObject = sel?.builtObject ?? null;
            view.selectedHabitat = sel && !sel.builtObject ? sel.habitat : null;
            shipKeys?.afterSelectionChange(sel); // [fix6ui] selection history + view lock
        },
    });
    const systemNameEl = hud.elements.get('pnlMoney')?.querySelector('.hud-system-name');
    const dateEl = hud.elements.get('pnlTopLeftBar')?.querySelector('.hud-date');
    const pauseBtn = hud.elements.get('pnlTopLeftBar')?.querySelector<HTMLButtonElement>('button[data-hud-ctl="playPause"]');
    const setSelection = (h: Habitat | null): void => {
        if (h === null) {
            hud.onSelectionChange?.(null);
            return;
        }
        const system = galaxy.systems.find((s) => s.habitats.includes(h)) ?? galaxy.systems[h.systemIndex];
        const sel: Selection = { habitat: h, system };
        hud.onSelectionChange?.(sel);
    };
    view.onSelectionChange = setSelection;
    // Task 13d: a clicked ship/base selects it (same Selection shape as the 13c cycle chips).
    view.onBuiltObjectSelect = (bo) => {
        const system = nearestSystem(galaxy.systems, bo.xpos, bo.ypos);
        if (system === null) return;
        hud.onSelectionChange?.({ habitat: system.systemStar, system, builtObject: bo });
    };
    view.onDoubleClickStar = (star: Habitat) => {
        if (star.category !== HabitatCategoryType.Star) return;
        camera.centerOn(star.xpos, star.ypos);
        camera.zoomAt(SYSTEM_LEVEL_ZOOM, camera.width / 2, camera.height / 2);
    };
    // Task 14a: the player's EmpireMessage queue feeds the ticker. The sim empties the
    // queue in processMessages, so poll on every HUD refresh (4x a second).
    const messageFeed = createEmpireMessageFeed();
    const refreshHud = (): void => {
        if (systemNameEl) {
            systemNameEl.textContent = nearestSystemName(
                { galaxy },
                camera,
            );
        }
        for (const { message, text } of messageFeed.pollMessages(game.playerEmpire)) {
            recordTickerMessage(game.playerEmpire, message, time.currentStarDate);
            pushHudMessage(text, resolveStarDateDescription(time.currentStarDate));
        }
    };
    refreshHud();
    const resizeHandler = (): void => {
        layoutHud(hud);
    };
    window.addEventListener('resize', resizeHandler);
    const refreshHudTimer = setInterval(refreshHud, 250);
    const refreshClockLabel = (): void => {
        if (dateEl) {
            dateEl.textContent = formatClockLabel(time.currentStarDate, time.speed);
        }
        if (pauseBtn) {
            pauseBtn.textContent = time.paused ? '▶' : '⏸';
            pauseBtn.title = playPauseHint(time.paused);
        }
    };
    const refreshClockTimer = setInterval(refreshClockLabel, 250);
    // [15d] Galaxy.GameEnd → Main.Part12.cs Galaxy_GameEnd / DoGameEnd (pause, IsFinished/Victor, banner).
    installGameEndHandler(galaxy, time);
    // [/15d]
    // [16d] Player messages → popups + the diplomatic conversation queue (Main.Part9.cs ReceiveMessageInternal).
    // [popupstubs] begin
    // The clock lets an immediate conversation pause the game (Main.Part9.cs 1544 method_253).
    installMessagePopups({ player: game.playerEmpire, galaxy, clock: time });
    // [popupstubs] end
    // [/16d]

    // [suggest] begin
    // Advisor suggestions (SemiAutomated tasks): Main.Part2.cs 2781 pnlAdvisorSuggestion. "Show me first" centres and
    // selects the subject (method_646 / 647; method_645 → the empire's capital here) and Approve / Decline restore the
    // view (method_644).
    installAdvisorSuggestions({
        player: game.playerEmpire,
        galaxy,
        clock: time,
        openBuildOrder: () => toggleBuildOrder({ empire: game.playerEmpire }),
        expireConversations: (e) => expireConversationsForEmpire(e),
        show: (target) => {
            const before = { x: camera.x, y: camera.y, zoom: camera.zoom, sel: getHudSelection() };
            let o: unknown = null;
            if (target.kind === 'empire') o = target.empire?.capital ?? null;
            else o = target.object;
            if (o === null) return;
            const pos = o instanceof ShipGroup ? o.leadShip : (o as { xpos: number; ypos: number });
            if (pos == null) return;
            camera.centerOn(pos.xpos, pos.ypos);
            camera.zoomAt(SYSTEM_LEVEL_ZOOM, camera.width / 2, camera.height / 2);
            if (o instanceof ShipGroup) selectShipGroup(o, false);
            else if (o instanceof Habitat) selectHabitat(o, false);
            else if (!(o instanceof Creature)) selectStellarObject(o as Parameters<typeof selectStellarObject>[0], false);
            return () => {
                camera.zoom = before.zoom;
                camera.centerOn(before.x, before.y);
                hud.onSelectionChange?.(before.sel);
            };
        },
    });
    // [suggest] end

    // [popupstubs] begin
    // Messages, conversations and advisor suggestions first appear as one-line stubs under the top-right panel.
    installMessageStubList({ player: game.playerEmpire, galaxy, clock: time });
    // [popupstubs] end

    // [leftovers] begin
    // The player's EventMessageRecipient (Main.Part12.cs:2881) → history messages + the wonder-built popup.
    installEventMessages({ player: game.playerEmpire, galaxy, onGoTo: (t) => selectStellarObject(t, true) });
    // Autosave every GameOptions.AutoSaveInterval minutes (Main.Part12.cs:4013 method_97).
    installAutosave({
        serialize: () => (lastStartOptions !== null ? serializeGame(game, time, lastStartOptions) : null),
        isBlocked: () => isGameOptionsPanelOpen(),
    });
    // [leftovers] end

    // [ordermenu] begin
    // 17c: right-click orders / the action menu in the main view and the selection panel's action buttons.
    const orderUiCleanup = installOrderUi(
        {
            galaxy,
            empire: game.playerEmpire,
            clock: time,
            getSelected: () => selectionTarget(getHudSelection()),
            select: (t) => {
                if (t === null) hud.onSelectionChange?.(null);
                else if (t instanceof ShipGroup) selectShipGroup(t, false);
                else if (Array.isArray(t)) {
                    if (t.length > 0) selectStellarObject(t[0], false); // no multi-selection in the streamlined HUD
                } else if (!(t instanceof Fighter)) selectStellarObject(t, false); // (a Fighter is not selectable here)
            },
        },
        view,
        camera,
    );
    // [ordermenu] end

    // [fix6ui] begin — N2: E/R/A/S/, orders and Z/N/B/L selection keys (Main.Part7.cs Main_KeyUp).
    shipKeys = createShipCommandKeys({
        galaxy,
        player: game.playerEmpire,
        camera,
        getSelection: getHudSelection,
        getSelected: () => selectionTarget(getHudSelection()),
        select: (o) => {
            if (o === null) hud.onSelectionChange?.(null);
            else if (o instanceof ShipGroup) selectShipGroup(o, false);
            else if (o instanceof Habitat) selectHabitat(o, false);
            else selectStellarObject(o, false);
        },
        refresh: () => {
            refreshSelectionActionBar();
            hud.onSelectionChange?.(getHudSelection());
        },
    });
    const activeShipKeys = shipKeys;
    setShipCommandHandler((action) => activeShipKeys.handle(action));
    // [fix6ui] end

    // Task 06l: extra boots run after the HUD/clock are wired (e.g. opening
    // a tutorial window that pauses/unpauses the clock).
    for (const boot of extraBoots ?? []) {
        boot();
    }

    const shortcuts = createShortcutsOverlay();
    const keyHandlers = buildDefaultHandlers(camera, time, { width: galaxy.sizeX, height: galaxy.sizeY });
    // G opens the Galaxy Map screen (original UI_KeyboardCommands); the HUD's
    // "Galaxy" view row still zooms the Main View out.
    keyHandlers.galaxyMap = () => galaxyMap.toggle();
    const keydownHandler = (e: KeyboardEvent): void => {
        if (galaxyMap.isOpen && e.key === 'Escape') {
            e.preventDefault();
            galaxyMap.close();
            return;
        }
        // [fix6ui] begin — N1: Escape closes the ? overlay first (not the Game Menu underneath).
        if (e.key === 'Escape' && shortcuts.visible()) {
            e.preventDefault();
            shortcuts.hide();
            return;
        }
        // [fix6ui] end
        // F1 is the Galactopedia binding (dispatchKey), not the overlay.
        if (e.key === '?') {
            e.preventDefault();
            shortcuts.toggle();
            return;
        }
        const action = dispatchKey(e, keyHandlers);
        // Space must not also activate a focused HUD button (a second toggle).
        if (action === 'togglePause') e.preventDefault();
        if (action === 'togglePause' || action === 'speedUp' || action === 'speedDown') {
            refreshClockLabel();
        }
    };
    window.addEventListener('keydown', keydownHandler);

    // Plan §1.1/§5.1: whole sim frames from the real scheduler (orbits, creatures, empires, fleets, ships...).
    // [fix6ui] begin — real elapsed time (elapsedMS: not capped at 100 ms like deltaMS) under the sim's wall-clock
    // budget; a render exception is contained like a sim one (Pixi would stop scheduling frames).
    const renderGuard = createRenderGuard();
    app.ticker.add(() => {
        simLoop.tick(app.ticker.elapsedMS);
        shipKeys?.frame();
        renderGuard(() => view.update());
    });
    // [fix6ui] end
    app.renderer.on('resize', () => {
        camera.setViewport(app.renderer.width, app.renderer.height);
        resizeHandler();
    });

    // Task 11a3: register the save/load provider for this game view. The
    // panel is created lazily on first open and reuses one instance per game
    // view; saving serializes via serializeGame with this view's clock +
    // startOptions, loading deserializes against the remembered gameData and
    // reboots through startGameView.
    let savePanel: ReturnType<typeof createSaveLoadPanel> | null = null;
    const memorySaves = sessionSaves;
    function getSavePanel() {
        if (!savePanel) {
            savePanel = createSaveLoadPanel('save', {
                callbacks: {
                    onLoadedFile: (loaded) => void bootLoadedGame(loaded),
                },
                memorySaves,
                serialize: () =>
                    lastStartOptions !== null ? serializeGame(game, time, lastStartOptions) : null,
                loadSave: (text) => {
                    if (lastGameData === null) {
                        throw new Error('DW:U game data is required to load a save');
                    }
                    return deserializeGame(text, lastGameData) as unknown as LoadedGame;
                },
            });
        }
        activeSavePanel = savePanel;
        return savePanel;
    }
    setSaveLoadProvider({
        open: (_mode) => {
            const panel = getSavePanel();
            panel.show();
        },
        serialize: () =>
            lastStartOptions !== null ? serializeGame(game, time, lastStartOptions) : null,
        loadSave: (text) => {
            if (lastGameData === null) {
                throw new Error('DW:U game data is required to load a save');
            }
            return deserializeGame(text, lastGameData) as unknown as LoadedGame;
        },
        memorySaves,
    });

    // Teardown for a later mid-game load (task 11a3): drop this view's canvas,
    // HUD, overlays and intervals before startGameView rebuilds them.
    activeGameViewCleanup = () => {
        window.removeEventListener('keydown', keydownHandler);
        window.removeEventListener('resize', resizeHandler);
        clearInterval(refreshHudTimer);
        clearInterval(refreshClockTimer);
        view.dispose(); // Task 12k: remove the hover tooltip div.
        galaxyMap.destroy();
        // The HUD selection is module state: don't show the old game's
        // object in the next game's panel.
        setHudSelection(null);
        app.destroy(true);
        hud.root.remove();
        shortcuts.destroy();
        hud.gameMenu?.destroy();
        setGameMenuHandler(null);
        setCycleHandler(null);
        // [fix6ui] begin
        setShipCommandHandler(null);
        shipKeys = null;
        // [fix6ui] end
        // Module-level panels hold the old game's Empire/camera and a
        // document keydown listener: close them and drop their source.
        closeEmpiresList();
        closeDiplomacyScreen(); // [15a]
        closeExpansionPlanner(); // [16a]
        closeColoniesList();
        // [tradenego] begin
        closeTradePanel();
        // [tradenego] end
        closeShipsAndBasesList();
        closeResearchScreen(); // [15b]
        closeShipDesigns(); // [16b]
        closeEmpireSummary();
        closeMessageHistory();
        closeFleetsList(); // [15c]
        closeBuildOrder(); closeConstructionYards(); // [16c]

        // [policy] begin
        closeEmpirePolicy();
        // [policy] end

        // [troops] begin
        closeTroopsScreen();
        // [troops] end
        // [intel] begin
        closeIntelligenceScreen();
        // [intel] end

        setEmpireSummarySource(null);
        // [suggest] begin
        removeAdvisorSuggestions();
        // [suggest] end

        // [popupstubs] begin
        removeMessageStubList();
        // [popupstubs] end

        // [leftovers] begin
        removeEventMessages();
        removeAutosave();
        closeGalacticHistory();
        // [leftovers] end
        // The ticker buffer is module-level; the next game starts fresh.
        clearHudMessages();
        // [15d]
        removeGameEndHandler(galaxy);
        closeEmpireComparison();
        closeGameEndBanner();
        // [/15d]
        // [16d]
        removeMessagePopups();
        closeGameOptionsPanel();
        // [/16d]
        // [advisor] begin
        closeAdvisorPanel();
        // [advisor] end

        // [aiadvisor] begin
        aiAdvisor.dispose();
        closeCouncilLog();
        // [aiadvisor] end
        orderUiCleanup(); // [ordermenu]
    };

    return time;
}

// [fix6ui] begin
/**
 * Wrap the per-frame view.update(): Pixi's Ticker schedules the next frame only after its listeners return, so an
 * exception there would freeze rendering and the sim for good. Log it and toast once per burst (at most every 10 s)
 * and keep the loop running.
 */
function createRenderGuard(): (fn: () => void) => void {
    let lastToast = -Infinity;
    return (fn) => {
        try {
            fn();
        } catch (err) {
            const t = performance.now();
            if (t - lastToast >= 10000) {
                lastToast = t;
                console.error('Render error (continuing):', err);
                showToast('Render error — see console');
            }
        }
    };
}
// [fix6ui] end

/** Open the new-game wizard (task 06b), replacing the main menu. Start Game
 * maps the chosen StartGameOptions onto createGame's options and boots the
 * Main View + HUD with the returned galaxy/empires (task 06i). */
function openWizard(onBackToMenu: () => void): void {
    const wizard = createNewGameWizard({
        onBackToMenu: () => {
            wizard.destroy();
            onBackToMenu();
        },
        onStartGame: (options: StartGameOptions) => {
            wizard.destroy();
            void bootGameFromWizard(options);
        },
    });
}

/** Task 06i: boot from the wizard's StartGameOptions via createGame (galaxy +
 * player/AI empires + starting colonies), then the shared Main View + HUD
 * boot (task M2e2). The URL-param boot path (bootGameWithOptions) still uses
 * generateGalaxy only. */
async function bootGameFromWizard(startOptions: StartGameOptions): Promise<void> {
    const dwuPresent = await detectDwuPresent();
    const systemNames = await loadSystemNames(dwuPresent);
    const gameData = await loadGameDataOrNone(dwuPresent);
    // Real-art file lists (scripts/gen-asset-manifest.mjs, predev/prebuild).
    if (dwuPresent) {
        await loadManifest();
    }

    // createGame needs full game data (races/governments); without a DW:U
    // install there is no fallback, so report it rather than booting broken.
    if (gameData === null) {
        console.error('DW:U game data is required to start a game from the wizard but failed to load.');
        return;
    }

    lastGameData = gameData;
    lastStartOptions = startOptions;
    const game: Game = createGame(toCreateGameOptions(startOptions, gameData, systemNames));
    // Task 10d: the wizard's chosen flag shape/colour is not forwarded to
    // createGame yet (see TODO(createGame) in startGameOptions.ts), so apply
    // it to the player empire here for the HUD's empires button.
    if (startOptions.flagShapeIndex >= 0) {
        game.playerEmpire.flagShape = startOptions.flagShapeIndex;
    }
    await startGameView(game);
}

/** Task 06l: boot a default-options game (player Human + 3 random AI
 * empires, like ?autostart=1) and open the given tutorial's window over it.
 * Used by the Tutorials screen's Start buttons. */
async function startTutorialGame(file: string): Promise<void> {
    const dwuPresent = await detectDwuPresent();
    const systemNames = await loadSystemNames(dwuPresent);
    const gameData = await loadGameDataOrNone(dwuPresent);
    if (dwuPresent) {
        // Real-art file lists (scripts/gen-asset-manifest.mjs, predev/prebuild).
        await loadManifest();
    }
    if (gameData === null) {
        console.error('DW:U game data is required to start a tutorial but failed to load.');
        return;
    }
    const opts = defaultDevGameOptions(1, GalaxyShape.Spiral, 700, 4, 4, systemNames, gameData);
    let game: Game | null = null;
    try {
        game = createGame(opts);
    } catch (err) {
        console.warn('Tutorial game creation failed', err);
        return;
    }
    // Saves need start options (metadata only; the galaxy itself is saved).
    lastGameData = gameData;
    lastStartOptions = { ...defaultStartGameOptions(), seed: opts.seed };
    // The clock is created inside startGameView and starts paused; the
    // tutorial window's "Play This Game" button resumes it (method_455).
    await startGameView(game, undefined, [() => {
        void openTutorialWindow(file, {
            onPlayThisGame: () => {
                const dwu = (window as unknown as { __dwu?: { time?: GalaxyTime } }).__dwu;
                if (dwu?.time !== undefined) {
                    dwu.time.paused = false;
                }
            },
        });
    }]);
}

/** Task 11a3: remember the loaded game data so later loads (main menu or
 * mid-game) can deserialize saved games against the same static tables. */
/** Task 11a3: tear down the currently running game view (canvas, HUD,
 * intervals, save panel) before replacing it with a loaded game. */
function teardownActiveGameView(): void {
    activeSavePanel?.destroy();
    // The main-menu panel is cached; drop the destroyed instance so the next
    // Load Game builds a fresh one.
    if (activeSavePanel === mainMenuSavePanel) {
        mainMenuSavePanel = null;
    }
    activeSavePanel = null;
    activeGameViewCleanup?.();
    activeGameViewCleanup = null;
}

/** Task 11a3: replace the running game with a loaded one (already
 * deserialized by the save panel's loadSave), rebooting through the shared
 * startGameView. */
async function bootLoadedGame(loaded: LoadedGame): Promise<void> {
    const { game, time, startOptions } = loaded as unknown as {
        game: Game;
        time: GalaxyTime;
        startOptions: StartGameOptions;
    };
    lastStartOptions = startOptions;
    activeMainMenu?.destroy();
    activeMainMenu = null;
    await ensureStaticData();
    teardownActiveGameView();
    // The sim time itself is galaxy.nowMs (saved with the galaxy); the save's clock only restores pause/speed.
    await startGameView(game, undefined, undefined, { speed: time.speed, paused: time.paused });
}

async function main(): Promise<void> {
    const params = new URLSearchParams(window.location.search);
    const skipMenu = SKIP_MENU_PARAMS.some((k) => params.has(k));

    if (params.get('screen') === 'wizard') {
        // Screenshot / dev hook (task 06b): jump straight to the wizard.
        openWizard(() => {
            // Nothing to go back to when opened directly; reload to the menu.
            window.location.search = '';
        });
        return;
    }

    if (params.get('screen') === 'credits' || params.get('screen') === 'options' || params.get('screen') === 'tutorials') {
        // Screenshot / dev hook (task 06k/06l): show the main menu with the
        // credits screen, options modal or tutorials list pre-opened.
        const menu = createMainMenu({
            onStartNewGame: () => {
                menu.destroy();
                openWizard(showMainMenu);
            },
            onTutorials: () => {
                const screen = createTutorialsScreen({
                    onStartTutorial: (file) => {
                        screen.destroy();
                        void startTutorialGame(file);
                    },
                });
            },
        });
        startMusic();
        const screen = params.get('screen');
        if (screen === 'credits') {
            createCreditsScreen(() => undefined);
        } else if (screen === 'options') {
            openOptionsModal(menu.root);
        } else {
            createTutorialsScreen({ onStartTutorial: () => undefined });
        }
        return;
    }

    if (params.get('screen') === 'galactopedia') {
        // Screenshot / dev hook: ?screen=galactopedia&topic=<id|title|file>.
        openGalactopedia({ topic: params.get('topic') ?? undefined });
        return;
    }

    if (!skipMenu) {
        showMainMenu();
        return;
    }

    await bootGame(params);
}

/** Show the main menu; Start New Game opens the wizard, whose back button
 * returns here. Task 11a3: Load Game opens the shared save/load panel in
 * load mode (localStorage saves + .dwusave files); a pick reboots through
 * startGameView with the remembered gameData. */
function showMainMenu(): void {
    const menu = createMainMenu({
        onStartNewGame: () => {
            menu.destroy();
            openWizard(showMainMenu);
        },
        onTutorials: () => {
            // Task 06l: the Tutorials list screen; Start boots a default
            // game and opens that tutorial's window in it.
            const screen = createTutorialsScreen({
                onStartTutorial: (file) => {
                    screen.destroy();
                    void startTutorialGame(file);
                },
            });
        },
        onLoadGame: async () => {
            // Game data is needed to deserialize a save; the menu path has
            // not loaded it yet.
            await ensureStaticData();
            // Register a load-only provider for the main menu context.
            setSaveLoadProvider({
                open: (_mode) => {
                    getMainMenuSavePanel().show();
                },
                loadSave: (text) => {
                    if (lastGameData === null) {
                        throw new Error('DW:U game data is required to load a save');
                    }
                    return deserializeGame(text, lastGameData) as unknown as LoadedGame;
                },
            });
            getMainMenuSavePanel().show();
        },
    });
    activeMainMenu = menu;
    startMusic();
}

// Lazily-created save panel for the main menu's Load Game item (task 11a3).
let mainMenuSavePanel: ReturnType<typeof createSaveLoadPanel> | null = null;
function getMainMenuSavePanel() {
    if (!mainMenuSavePanel) {
        mainMenuSavePanel = createSaveLoadPanel('load', {
            callbacks: {
                onLoadedFile: (loaded) => void bootLoadedGame(loaded),
            },
            serialize: () => null, // saving is only available during a game
            loadOnly: true,
            memorySaves: sessionSaves,
            loadSave: (text) => {
                if (lastGameData === null) {
                    throw new Error('DW:U game data is required to load a save');
                }
                return deserializeGame(text, lastGameData) as unknown as LoadedGame;
            },
        });
    }
    activeSavePanel = mainMenuSavePanel;
    return mainMenuSavePanel;
}

/** Fully-resolved options to start a game (from the boot URL or the wizard). */
interface BootOptions {
    seed: number;
    shape: GalaxyShape;
    starCount: number;
    sectorWidth: number;
    sectorHeight: number;
    zoom: number | null;
    cx: number | null;
    cy: number | null;
    /** ?select=<habitat name>: select that habitat on boot (screenshots). */
    select: string | null;
}

/** Parse `bootGame`'s URL-param path into a BootOptions (task 06a defaults:
 * seed=1, spiral, 700 stars, 4x4 sectors). */
function parseBootOptions(params: URLSearchParams): BootOptions {
    return {
        seed: parseInt(params.get('seed') ?? '1', 10) || 1,
        starCount: parseInt(params.get('stars') ?? '700', 10) || 700,
        shape: SHAPE_BY_NAME[params.get('shape') ?? 'spiral'] ?? GalaxyShape.Spiral,
        sectorWidth: 4,
        sectorHeight: 4,
        zoom: params.get('zoom') !== null ? parseFloat(params.get('zoom')!) : null,
        cx: params.get('cx') !== null ? parseFloat(params.get('cx')!) : null,
        cy: params.get('cy') !== null ? parseFloat(params.get('cy')!) : null,
        select: params.get('select'),
    };
}

async function bootGame(params: URLSearchParams): Promise<void> {
    await bootGameWithOptions(parseBootOptions(params));
}

/** Task M2e: `?autostart=1` boots a full game via createGame (player + 3 AI
 * empires, defaults) instead of a bare generateGalaxy, so the Main View has
 * owned colonies to draw empire rings/territory for. */
function paramsHasAutostart(): boolean {
    return new URLSearchParams(window.location.search).has('autostart');
}

/** createGame options for the dev autostart and tutorial games: Human + 3 random AI empires in the wizard's
 * default "Starting" era, with the wizard's default pirate prevalence (piratesIndex 2 → piratesFor = 0.2;
 * createGame's own default is 0 = no pirates). */
function defaultDevGameOptions(
    seed: number,
    shape: GalaxyShape,
    starCount: number,
    sectorWidth: number,
    sectorHeight: number,
    systemNames: string[],
    gameData: GameData,
): CreateGameOptions {
    const ai = { race: '(Random)', homeSystemFavourability: 'Normal' as const, proximityDistance: 'Random', age: 1, techLevel: STARTING_TECH_LEVEL };
    return {
        seed,
        shape,
        starCount,
        sectorWidth,
        sectorHeight,
        systemNames,
        gameData,
        // "Starting" era: Galaxy.Age 1 (= Galaxy.StartingAge), as the wizard's default Expansion slider.
        galaxyAge: 1,
        piratePrevalence: piratesFor(defaultStartGameOptions().piratesIndex),
        // Galaxy.MaximumEmpireAmount comes from the star-count slider (BaconStart.cs 84 method_61), not from the
        // number of empires in the game: it drives the pirate faction count (Galaxy.9.cs 22).
        maximumEmpireAmount: maximumEmpireAmountFor(starCountIndexFor(starCount), gameData.races.filter((r) => r.playable).length),
        player: { race: 'Human', homeSystemFavourability: 'Normal', startLocation: '(Random)', age: 1, techLevel: STARTING_TECH_LEVEL },
        aiEmpires: [ai, { ...ai }, { ...ai }],
    };
}

/** Inverse of startGameOptions.ts starCountFor for the dev/tutorial paths (nearest slider index; 700 stars → 3). */
function starCountIndexFor(starCount: number): number {
    let best = 3;
    let bestDiff = Infinity;
    for (let i = 0; i <= 6; i++) {
        const d = Math.abs(starCountFor(i) - starCount);
        if (d < bestDiff) {
            bestDiff = d;
            best = i;
        }
    }
    return best;
}

async function buildAutostartGame(
    seed: number,
    shape: GalaxyShape,
    starCount: number,
    sectorWidth: number,
    sectorHeight: number,
    systemNames: string[],
    gameData: GameData | null,
): Promise<Game | null> {
    if (gameData === null) {
        console.warn('?autostart=1 needs DW:U game data (races/governments); falling back to generateGalaxy');
        return null;
    }
    const opts = defaultDevGameOptions(seed, shape, starCount, sectorWidth, sectorHeight, systemNames, gameData);
    try {
        const game = createGame(opts);
        // Saves need start options (metadata only; the galaxy itself is saved).
        lastStartOptions = { ...defaultStartGameOptions(), seed };
        return game;
    } catch (err) {
        console.warn('?autostart=1 createGame failed; falling back to generateGalaxy', err);
        return null;
    }
}

async function bootGameWithOptions(opts: BootOptions): Promise<void> {
    const { seed, shape, starCount, sectorWidth, sectorHeight, zoom: zoomParam, cx, cy, select } = opts;

    const dwuPresent = await detectDwuPresent();
    const systemNames = await loadSystemNames(dwuPresent);
    const gameData = await loadGameDataOrNone(dwuPresent);
    // Task 11a3: remember the loaded game data so later loads (main menu or
    // mid-game) can deserialize saved games against the same static tables.
    lastGameData = gameData;
    // Real-art file lists (scripts/gen-asset-manifest.mjs, predev/prebuild).
    if (dwuPresent) {
        await loadManifest();
    }

    // Task M2e2: ?autostart=1 boots a full game (player + 3 AI empires with
    // colours + colonies) through the shared startGameView — camera centred on
    // the player's capital at Sector zoom, window.__dwu.game set.
    if (paramsHasAutostart()) {
        const started = await buildAutostartGame(seed, shape, starCount, sectorWidth, sectorHeight, systemNames, gameData);
        if (started !== null) {
            // Task M2e3: honour ?zoom= on the autostart path too (galaxy-view
            // screenshots), otherwise startGameView applies Sector zoom.
            await startGameView(started, zoomParam ?? undefined);
            return;
        }
    }

    const app = new Application();
    await app.init({
        resizeTo: window,
        // Render at the display's device pixel ratio (HiDPI / 4K): without this Pixi draws at 1x
        // and the browser upscales the canvas, which looks like a 720p capture on a 2x screen.
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
        background: 0x000000,
        antialias: true,
        preference: 'webgl',
    });
    document.body.appendChild(app.canvas);

    // Deterministic galaxy (seed/shape/stars/sectors from the URL or wizard).
    const galaxy = generateGalaxy({
        seed,
        shape,
        starCount: starCount,
        sectorWidth,
        sectorHeight,
        systemNames,
        gameData: gameData ?? undefined,
    });
    let viewX = galaxy.sizeX / 2;
    let viewY = galaxy.sizeY / 2;
    if (cx !== null && cy !== null) {
        viewX = cx;
        viewY = cy;
    }

    const camera = new Camera();
    camera.setViewport(app.renderer.width, app.renderer.height);
    camera.setGalaxyBounds(galaxy.sizeX, galaxy.sizeY);
    camera.centerOn(viewX, viewY);
    if (zoomParam !== null) {
        // zoom >= 1 is the original zoom *factor* (reciprocal of px/unit);
        // zoom < 1 is a direct px/unit value.
        camera.zoom = camera.clampZoom(zoomParam >= 1 ? 1 / zoomParam : zoomParam);
    } else {
        // No ?zoom= : start at the whole-galaxy view.
        camera.zoom = camera.minZoom;
    }

    const store = new AssetStore(dwuPresent);
    // Task M3: created before MainView so the Main View's overlay layer and
    // the HUD's options list share the same MapOverlayState instance.
    const overlays = createMapOverlayState();
    applyOverlaysUrlParam(overlays);
    const view = new MainView(app, camera, galaxy, store, overlays);
    await view.init();

    // Debug / screenshot hook: the camera and the generated galaxy model.
    const debugHook: Record<string, unknown> = { camera, galaxy, view, app };
    (window as unknown as { __dwu?: unknown }).__dwu = debugHook;

    // Task 07b: the compact top-left bar drives the galaxy-time clock
    // (GalaxyTime, starts paused at 1x per the original); the bottom-right
    // list drives the camera and overlay toggles; the selection panel is
    // refreshed as the camera moves (demo: nearest star/planet to the view
    // centre).
    // One clock (galaxy.nowMs), advanced by the real scheduler below; generateGalaxy leaves Galaxy.Age 0.
    const time = new GalaxyTime();
    const simLoop = createSimLoop(galaxy, time, camera, simViewEnabledFromUrl(window.location.search));
    Object.assign(debugHook, { time, sim: simLoop.driver, simStats: simLoop.stats });
    // Task C3: Galaxy Map screen (G key / HUD "Galaxy map (G)" row).
    const galaxyMap = createGalaxyMapFor(galaxy, camera);
    debugHook.galaxyMap = galaxyMap;
    const hud: HudRefs = createHud({
        clock: time,
        overlays,
        camera,
        galaxy,
        gameData: gameData ?? undefined,
        onGalaxyMap: () => galaxyMap.toggle(),
    });
    const systemNameEl = hud.elements.get('pnlMoney')?.querySelector('.hud-system-name');
    const dateEl = hud.elements.get('pnlTopLeftBar')?.querySelector('.hud-date');
    const pauseBtn = hud.elements.get('pnlTopLeftBar')?.querySelector<HTMLButtonElement>('button[data-hud-ctl="playPause"]');
    // Task 08g: push a Main View pick (or null) to the HUD selection panel.
    const setSelection = (h: Habitat | null): void => {
        if (h === null) {
            hud.onSelectionChange?.(null);
            return;
        }
        const system = galaxy.systems.find((s) => s.habitats.includes(h)) ?? galaxy.systems[h.systemIndex];
        const sel: Selection = { habitat: h, system };
        hud.onSelectionChange?.(sel);
    };
    view.onSelectionChange = setSelection;
    // Task 10b: ?select=<habitat name> selects that habitat on boot (used by
    // screenshot scripts to show a filled-in selection panel).
    if (select !== null && select !== '') {
        const target = galaxy.habitats.find((h) => h.name === select);
        if (target) {
            camera.centerOn(target.xpos, target.ypos);
            setSelection(target);
        } else {
            console.warn(`?select=: no habitat named "${select}"`);
        }
    }
    // Double-click a star at galaxy/sector zoom -> System level centred on it.
    view.onDoubleClickStar = (star: Habitat) => {
        if (star.category !== HabitatCategoryType.Star) return;
        camera.centerOn(star.xpos, star.ypos);
        camera.zoomAt(SYSTEM_LEVEL_ZOOM, camera.width / 2, camera.height / 2);
    };
    const refreshHud = (): void => {
        if (systemNameEl) {
            systemNameEl.textContent = nearestSystemName(
                { galaxy },
                camera,
            );
        }
    };
    refreshHud();
    window.addEventListener('resize', () => layoutHud(hud));
    // The camera centre moves with panning/zooming; keep lblSystemName fresh.
    setInterval(refreshHud, 250);
    // Task 07b: keep the star-date label (and the play/pause glyph) fresh.
    const refreshClockLabel = (): void => {
        if (dateEl) {
            dateEl.textContent = formatClockLabel(time.currentStarDate, time.speed);
        }
        if (pauseBtn) {
            pauseBtn.textContent = time.paused ? '▶' : '⏸';
            pauseBtn.title = playPauseHint(time.paused);
        }
    };
    setInterval(refreshClockLabel, 250);

    // Task 10a: the full original keyboard command table (UI_KeyboardCommands)
    // dispatches on keydown; it replaces the ad-hoc spacebar handler. '?'
    // toggles the "Keyboard shortcuts" overlay; F1 opens the Galactopedia.
    const shortcuts = createShortcutsOverlay();
    const keyHandlers = buildDefaultHandlers(camera, time, { width: galaxy.sizeX, height: galaxy.sizeY });
    keyHandlers.galaxyMap = () => galaxyMap.toggle();
    window.addEventListener('keydown', (e: KeyboardEvent) => {
        if (galaxyMap.isOpen && e.key === 'Escape') {
            e.preventDefault();
            galaxyMap.close();
            return;
        }
        // [fix6ui] begin — N1: Escape closes the ? overlay first.
        if (e.key === 'Escape' && shortcuts.visible()) {
            e.preventDefault();
            shortcuts.hide();
            return;
        }
        // [fix6ui] end
        if (e.key === '?') {
            e.preventDefault();
            shortcuts.toggle();
            return;
        }
        const action = dispatchKey(e, keyHandlers);
        // Space must not also activate a focused HUD button (a second toggle).
        if (action === 'togglePause') e.preventDefault();
        if (action === 'togglePause' || action === 'speedUp' || action === 'speedDown') {
            refreshClockLabel();
        }
    });

    // Task 07b / plan §1.1: run whole sim frames of the real scheduler each render frame.
    // [fix6ui] begin — real elapsed time + contained render errors (as in startGameView).
    const renderGuard = createRenderGuard();
    app.ticker.add(() => {
        simLoop.tick(app.ticker.elapsedMS);
        renderGuard(() => view.update());
    });
    // [fix6ui] end
    app.renderer.on('resize', () => {
        camera.setViewport(app.renderer.width, app.renderer.height);
        layoutHud(hud);
    });
}

main().catch((err) => {
    console.error('DW:U boot failed', err);
});