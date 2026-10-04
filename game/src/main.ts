// Boot: create the PixiJS app, generate the galaxy from URL parameters
// (?seed=, ?shape=, ?stars=, ?zoom=, ?cx=, ?cy=) and start the Main View.
// All DW:U data/art is fetched by URL from /assets/dwu/... (mapped to the
// install folder by the desktop shell; under `npm run dev` a public symlink
// plus the probe middleware in vite.config.ts does the same).

import { fogOf } from './render/fog';
import { goToMessage, messageGoToTarget } from './ui/messageGoto';
import { Application } from 'pixi.js';
import { Camera } from './render/camera';
import { MainView } from './render/mainView';
import { installContextLossRecovery, releasePixiTestContext } from './render/contextLoss';
import { AssetStore, loadManifest } from './render/assets';
import { generateGalaxy } from './sim/galaxy';
import { Galaxy } from './sim/galaxy';
import { createGame, createGameSteps, installGameStatics, registerGameHooks, type CreateGameOptions } from './sim/game';
import { runStepsWithProgress, showLoadingOverlay, nextPaint } from './ui/loadingOverlay';
import { parseSystemNames } from './sim/data';
import { loadGameData, type FetchText, type GameData } from './sim/data/gameData';
import { GalaxyShape } from './sim/types';
import { clearHudMessages, createHud, destroyHudListeners, refreshTopLeftControls, topSystemNameText, layoutHud, nearestSystem, pushHudMessage, setSelection as setHudSelection, type HudRefs } from './ui/hud';
import { GalaxyTime } from './sim/clock';
import { resolveStarDateDescription } from './sim/galaxyTime';
import { createSimLoop, simViewEnabledFromUrl } from './simLoop';
// [simworker] begin — docs/sim-worker.md: the sim in a Web Worker (the default; ?simWorker=0 or Settings → off selects the in-thread fallback).
import { SimWorkerClient, simWorkerEnabled, type ReplicaGameData } from './simworker/workerClient';
import { workerCreateOptions } from './simworker/bootOptions';
import type { ScenarioRef, WorkerBoot } from './simworker/protocol';
import type { RenderTime } from './render/renderInterp';
// [simworker] end
import { SECTOR_LEVEL_ZOOM, SYSTEM_LEVEL_ZOOM, historyGoTo, type Selection } from './ui/hud';
import { setTextIfChanged } from './render/drawCache';
import { Habitat, HabitatCategoryType } from './sim/types';
import { createMapOverlayState, overlayOptionsOf, type MapOverlayState, type OverlayKey } from './ui/mapOverlays';
import { buildDefaultHandlers, createShortcutsOverlay, dispatchKey, setCycleHandler, setGameMenuHandler } from './ui/keyboard';
import { closeEmpiresList } from './ui/screens/empiresList';
import { closeCharterPanels } from './ui/screens/charters'; // [charters]
import { closeDiplomacyScreen } from './ui/screens/diplomacyScreen'; // [15a]
import { closeExpansionPlanner } from './ui/screens/expansionPlanner'; // [16a]
import { closeColoniesScreen } from './ui/screens/coloniesScreen';
// [tradenego] begin
import { closeTradePanel } from './ui/screens/tradePanel';
// [tradenego] end
import { closeShipsAndBasesList } from './ui/screens/shipsAndBasesList';
import { closeResearchScreen } from './ui/screens/researchScreen'; // [15b]
import { closeShipDesigns } from './ui/screens/shipDesigns'; // [16b]
import { closeEmpireSummary, setEmpireSummarySource, setEmpireSummaryTradeFlowsLink } from './ui/screens/empireSummary';
// [advisor] begin
import { closeAdvisorPanel } from './ui/advisorPanel';
// [advisor] end

// [aiadvisor] begin
import { aiAdvisorSettingsWithUrl, startAiAdvisorDriver } from './ui/aiAdvisorDriver';
import { closeCouncilLog, pushCouncilLog } from './ui/aiAdvisorLog';
import { startLlmLayer } from './llm/llmLayer'; // [llm] 19s-1
import { getSettings, loadedGamePaused, onSettingsChange, tickerMaxFps } from './ui/settings';
import { installOutputDither, setOutputDither } from './render/outputDither';
// [aiadvisor] end
import { closeMessageHistory } from './ui/screens/messageHistory';
import { closeFleetsList } from './ui/screens/fleetsList'; // [15c]
import { closeBuildQueue } from './ui/screens/buildQueue'; // [buildQueue]
import { closeBuildOrder } from './ui/screens/buildOrder'; import { closeConstructionYards } from './ui/screens/constructionYards'; // [16c]
import { createEmpireMessageFeed, savedHistoryLines } from './ui/empireMessageFeed';
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
// [audio] begin
import { installGameAudio } from './audio/gameAudio';
import { installUiClickSounds } from './audio/uiClicks';
import { soundRequestStats } from './audio/effectsPlayer';
import { adoptGameMessageOptions, copyMessageOptions, getMessageOptions } from './ui/messageRouting';
// [audio] end
import { createNewGameWizard } from './ui/screens/newGameWizard';
import { openGalactopedia } from './ui/screens/galactopedia';
import { habitatInfo } from './ui/selectionInfo';
import { renderInfoModel } from './ui/selectionInfoView';
import { colonizationRangeFor, defaultStartGameOptions, wizardStartGameOptions, piratesFor, STARTING_TECH_LEVEL, toCreateGameOptions, type StartGameOptions, maximumEmpireAmountFor, starCountFor, defaultScenarioChoice, type StartScenarioChoice } from './sim/startGameOptions';
import { serializeGame, deserializeGameSteps, savedCustomizationSet, savedScenarioId, savedScenarioInclude, type GameSaveJSON } from './sim/save/gameSave';
import { loadScenarioIndex, loadScenarioOverlay } from './sim/scenario/fetchScenario';
import { applyScenarioOverlay, type ScenarioOverlay } from './sim/scenario/overlay';
import { COMPOSITE_SCENARIO_ID, addonCatalog, compositeScenarioManifest, planAddonStart, resolveAddonSwitches, scenarioOverlayFor } from './sim/scenario/addons';
// [leftovers] begin
import { closeGalacticHistory } from './ui/screens/galacticHistory';
import { installEventLogDevHook } from './ui/eventLogDev';
import { installEventMessages, removeEventMessages } from './ui/eventMessages';
import { installWorkerMessageUi } from './ui/workerMessages'; // [simworker] chunk 4
import { installLocalMessageStream } from './ui/messagePipeline';
import { currentGameAutosave, installAutosave, readAutosave, removeAutosave } from './ui/autosave';
import { messageBox } from './ui/originalWindow';
import { restartFromSources, restartPromptText, restartSources } from './simworker/restart';
import { isGameOptionsPanelOpen } from './ui/screens/gameOptionsPanel';
import { newGameOptionsFromSettings } from './ui/screens/gameOptionsModel'; // [gameoptions]
// [leftovers] end
import { issuePlayerCommand } from './sim/player/playerCommands';
import { createMissionShipActionAt } from './sim/player/shipAction';
import { BuiltObjectMissionType } from './sim/missions/mission';
import { commandLog } from './sim/player/commandLog';
import { setSaveLoadProvider, createSaveLoadPanel, type LoadedGame } from './ui/screens/saveLoad';
import { type Game } from './sim/game';
import { registerLocationPingedHook } from './sim/story/eventActions';
import { createGalaxyMap, type GalaxyMapScreen } from './ui/screens/galaxyMap';
import { hideMapTooltip } from './ui/mapTooltip';
import { closeTradeFlows, mountFreightLegend, openTradeFlows, toggleTradeFlows } from './ui/screens/tradeFlows'; // [freightOverlay]
import { openResourceSupply, setResourceSupplyHost } from './ui/screens/resourceSupply'; // [improvements] supplyChain
import { invalidateSupply, supplySnapshot, supplyStats } from './ui/supplyChainCache'; // [improvements] supplyChain
import { closeEmpireComparison, closeGameEndBanner, installGameEndHandler, removeGameEndHandler } from './ui/screens/empireComparison'; // [15d]
import { setGameEndExitHandler } from './ui/screens/gameEndPanel'; // [15d]
import { closeIntroductionPanel, openIntroductionPanel } from './ui/screens/introductionPanel'; // [intro]
import { installMessagePopups, removeMessagePopups } from './ui/messagePopups'; import { closeGameOptionsPanel, setAllowSameSystemSource } from './ui/screens/gameOptionsPanel'; // [16d]
import { installOrderUi, selectionTarget } from './ui/orderMenu'; import { getSelection as getHudSelection, selectBuiltObjectList, selectShipGroup, selectStellarObject } from './ui/hud'; import { ShipGroup } from './sim/fleets/shipGroup'; import { Fighter } from './sim/combat/fighters'; // [ordermenu]
// [suggest] begin
import { installAdvisorSuggestions, removeAdvisorSuggestions } from './ui/advisorSuggestions';
import { expireConversationsForEmpire } from './ui/messagePopups';
import { toggleBuildOrder } from './ui/screens/buildOrder';
import { Creature } from './sim/creature';
// [suggest] end

// [popupstubs] begin
import { installBattleReportNotifier, removeBattleReportNotifier } from './ui/battleReports';
import { setBattleReportsEnabled } from './sim/battleReports/hooks';
import { installMessageStubList, removeMessageStubList } from './ui/messageStubList';
// [popupstubs] end

// [fix6ui] begin
import { setShipCommandHandler, setViewLockedQuery } from './ui/keyboard';
import { refreshSelectionActionBar } from './ui/orderMenu';
import { selectCreature, selectFighter, selectHabitat } from './ui/hud';
import { createShipCommandKeys, type ShipCommandKeys } from './ui/shipCommandKeys';
import { createControlGroupKeys } from './ui/controlGroups'; import { setControlGroupHandler } from './ui/keyboard'; import { resetPanelVisibility } from './ui/panelVisibility'; import { setMainViewDisplayType } from './render/mainViewDisplay'; import { closeGroundReport } from './ui/screens/groundReport'; import { playGridClick } from './audio/gameAudio'; // [parC1]
import { showToast } from './ui/toast';
// [fix6ui] end

import './ui/hud.css';
import { activateTheme, bootTheme, fetchThemeList, themeToRestoreOnLeave } from './themeLoader';
import { activeCustomizationSet, activeCustomizationSetName, normalizeCustomizationSetName } from './sim/data/customization';
import { setThemeChromeRace } from './themeAssets';
import { resetMusicForTheme } from './audio/musicPlayer';
import { updateSettings } from './ui/settings';

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
            // Galaxy.4.cs 3437 LoadSystemNames: Customization\<set>\systemNames.txt when it exists, else the stock file.
            const text = await (await fetch(activeCustomizationSet()?.fileUrl('systemNames.txt') ?? '/assets/dwu/systemNames.txt')).text();
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
        // The active theme's files where the original reads Customization\<set>\ (data/gameData.ts).
        return await loadGameData(fetchTextBrowser, activeCustomizationSet() ?? undefined);
    } catch (err) {
        console.warn('DW:U game data failed to load; continuing without it', err);
        return null;
    }
}

// Task 11a3: module-level state for the save/load panels. The loaded game
// data is remembered so a later "Load Game" can deserialize saved games
// (deserializeGame needs the static race/resource/research tables).
let lastGameData: GameData | null = null;
/** Mod layer: the GameData of the game on screen (the base data with its scenario overlay, if any). */
let lastPlayedGameData: GameData | null = null;
/** Mod layer: scenario overlays fetched this session (small text files), by id — saves re-apply them synchronously. */
const scenarioOverlays = new Map<string, ScenarioOverlay>();

/** Mod layer: fetch every scenario overlay listed in /assets/scenarios/index.json (errors leave the list short). */
async function preloadScenarioOverlays(): Promise<void> {
    try {
        for (const m of await loadScenarioIndex(fetchTextBrowser)) {
            if (scenarioOverlays.has(m.id)) continue;
            try {
                scenarioOverlays.set(m.id, await loadScenarioOverlay(fetchTextBrowser, m));
            } catch (err) {
                console.warn(`Scenario ${m.id} failed to load`, err);
            }
        }
    } catch (err) {
        console.warn('Scenario index failed to load', err);
    }
}

/**
 * Mod layer: the base data, or the base data with a scenario overlay applied (throws when it is not available). A
 * composite ('addons') scenario is rebuilt from its flattened add-on list (`include`).
 */
function gameDataWithScenario(base: GameData, scenarioId: string | null, include: readonly string[] | null = null): GameData {
    if (scenarioId === null) return base;
    try {
        return applyScenarioOverlay(base, scenarioOverlayFor(scenarioId, include, scenarioOverlays));
    } catch (err) {
        throw new Error(`Scenario "${scenarioId}" is not available; cannot load this game. (${err instanceof Error ? err.message : String(err)})`);
    }
}

/** Add-on picker: the flattened add-on list of a composite start choice (null for a single scenario). */
function choiceInclude(choice: StartScenarioChoice): string[] | null {
    if (choice.id !== COMPOSITE_SCENARIO_ID) return null;
    const cat = addonCatalog([...scenarioOverlays.values()].map((o) => o.manifest));
    return compositeScenarioManifest(cat, choice.addons ?? []).include;
}

/** Mod layer: the GameData a save needs (its scenario's overlay over the base data). */
function gameDataForSave(save: GameSaveJSON): GameData {
    if (lastGameData === null) throw new Error('DW:U game data is required to load a save');
    const id = savedScenarioId(save);
    lastPlayedGameData = gameDataWithScenario(lastGameData, id, id === COMPOSITE_SCENARIO_ID ? savedScenarioInclude(save) : null);
    // The static tables and hooks createGame installs (race/government biases, troop-general hook): a save loaded in a
    // session that never started a game (main-menu Load Game on a fresh page) would otherwise run without them.
    installGameStatics(lastPlayedGameData);
    registerGameHooks();
    return lastPlayedGameData;
}

/** Deserialize a save under the loading overlay (the save is parsed once; a late-game save takes seconds). */
async function loadSaveWithProgress(text: string): Promise<LoadedGame> {
    // Start.cs 1777 / Main.Part7.cs 3941 LoadFromFile: a save of another theme first switches to it — as the user's
    // choice too (delegate8_0 = method_2(ThemeName, bool_5: true, …)) — then the galaxy loads on that theme's data.
    const saveTheme = savedCustomizationSet(text);
    if (saveTheme !== activeCustomizationSetName()) {
        showToast(`Switching to ${saveTheme === '' ? '(Default)' : saveTheme} theme`); // "Switching to THEMENAME theme"
        await switchTheme(saveTheme, true);
        await ensureStaticData();
    }
    if (lastGameData === null) throw new Error('DW:U game data is required to load a save');
    if (useSimWorker()) return (await loadSaveInWorker({ text })) as unknown as LoadedGame;
    return (await runStepsWithProgress('Loading game', deserializeGameSteps(text, gameDataForSave))) as unknown as LoadedGame;
}

/** [improvements] The battle-report observer's kill switch: `?battleReports=0` turns the sim-side recording off. */
function battleReportsObserverOn(): boolean {
    return new URLSearchParams(window.location.search).get('battleReports') !== '0';
}

// [simworker] begin
/** Whether the next game runs its sim in a worker (`?simWorker=1|0`, else Settings → simulation in a worker thread). */
function useSimWorker(): boolean {
    return simWorkerEnabled(window.location.search, getSettings().simWorker);
}

/** Boot the worker's game under the loading overlay and build the replica from its snapshot. */
async function bootWorker(title: string, boot: WorkerBoot, playData: ReplicaGameData, startOptions: StartGameOptions | undefined, clock?: { speed: number; paused: boolean }): Promise<SimWorkerClient> {
    const overlay = showLoadingOverlay(title);
    try {
        overlay.update({ step: 'Starting simulation thread', fraction: 0 });
        await nextPaint();
        // The worker loads the same theme's data (Main.Part12.cs CustomizationSetName()).
        return await SimWorkerClient.boot({ type: 'init', boot, startOptions, clock, customizationSet: activeCustomizationSetName(), battleReports: battleReportsObserverOn() }, playData, { update: (p) => overlay.update(p), paint: nextPaint });
    } finally {
        overlay.close();
    }
}

/**
 * The replica's static data for the scenario the worker found in a save (main.ts gameDataForSave without the parsed
 * save): the base data with that scenario's overlay, plus the static tables and hooks createGame installs.
 */
function gameDataForScenario(scenario: ScenarioRef): GameData {
    if (lastGameData === null) throw new Error('DW:U game data is required to load a save');
    lastPlayedGameData = gameDataWithScenario(lastGameData, scenario?.id ?? null, scenario?.include ?? null);
    installGameStatics(lastPlayedGameData);
    registerGameHooks();
    return lastPlayedGameData;
}

/** The loaded-game record of a worker game (bootLoadedGame hands `simClient` on to startGameView). */
interface WorkerLoadedGame {
    game: Game;
    time: GalaxyTime;
    startOptions: StartGameOptions;
    simClient: SimWorkerClient;
}

/**
 * A save loaded by the worker. The main thread does not parse it (a late save is 100+ MB of JSON: seconds of a frozen
 * tab): the worker parses it once, and its snapshot names the scenario (for the replica's static data) and carries the
 * save's start options. `url`: the worker fetches the save itself (`?load=`), so the text never reaches this thread.
 */
async function loadSaveInWorker(source: { text: string } | { url: string }): Promise<WorkerLoadedGame> {
    let startOptions: StartGameOptions | null = null;
    const client = await bootWorker('Loading game', { kind: 'load', ...source }, (snap) => {
        startOptions = snap.startOptions;
        return gameDataForScenario(snap.scenario ?? null);
    }, undefined);
    const time = new GalaxyTime();
    time.speed = client.core.clock.speed;
    time.paused = client.core.clock.paused;
    return { game: client.core.game, time, startOptions: startOptions ?? defaultStartGameOptions(), simClient: client };
}

/** The restart prompt is open (one per stopped worker). */
let restartPromptFor: SimWorkerClient | null = null;

/**
 * [simworker] The worker stopped for good (simworker/restart.ts, docs/sim-worker.md §4.6): every request waiting on it
 * has failed. A message box (the original's MessageBoxEx) offers Restart — the game in a new worker from the best save
 * text there is: the worker's own last state, else the replica as the view last showed it, else this game's last
 * autosave — resumed paused, or Main Menu.
 */
async function offerWorkerRestart(simClient: SimWorkerClient, game: Game, time: GalaxyTime, reason: string): Promise<void> {
    if (restartPromptFor === simClient) return;
    restartPromptFor = simClient;
    try {
        await offerWorkerRestartOnce(simClient, game, time, reason);
    } finally {
        // Only while the prompt is up: kept afterwards, it held the stopped client — and through it the old view and
        // game — until the next crash.
        if (restartPromptFor === simClient) restartPromptFor = null;
    }
}

async function offerWorkerRestartOnce(simClient: SimWorkerClient, game: Game, time: GalaxyTime, reason: string): Promise<void> {
    time.paused = true;
    const startOptions = lastStartOptions;
    const auto = currentGameAutosave();
    const sources = restartSources({
        rescue: simClient.rescueSave,
        // Serialized only if chosen (a late game takes seconds), while this view still holds the replica.
        replica: startOptions !== null ? () => serializeGame(game, time, startOptions) : null,
        autosave: auto === null ? null : { ...auto, read: () => readAutosave(auto.name) },
    });
    const RESTART = 'Restart';
    const MENU = 'Main Menu';
    const answer = await messageBox({ caption: 'Simulation Stopped', text: restartPromptText(reason, sources), buttons: sources.length > 0 ? [RESTART, MENU] : [MENU], icon: 'stop', width: 540, buttonWidth: 120 });
    const toMenu = (): void => {
        void leaveGameToMenu();
    };
    if (answer !== RESTART) {
        toMenu();
        return;
    }
    const r = await restartFromSources(sources, (text) => loadSaveInWorker({ text }));
    for (const f of r.failed) console.warn(`sim worker restart: ${f.source.label}: ${f.error}`);
    if (r.result === null) {
        await messageBox({ caption: 'Restart Failed', text: `The game could not be restarted:\n${r.failed.map((f) => `- ${f.source.label}: ${f.error}`).join('\n')}`, icon: 'stop', width: 540 });
        toMenu();
        return;
    }
    const loaded = r.result;
    lastStartOptions = loaded.startOptions;
    teardownActiveGameView();
    await startGameViewWithOverlay(loaded.game, undefined, undefined, { speed: loaded.time.speed, paused: true }, loaded.simClient);
    showToast(`Restarted from ${r.source.label} — paused`);
    console.info(`sim worker restart: restarted from ${r.source.label} (${r.source.kind})`);
}

/** createGame in the worker (autostart / wizard): the options minus gameData, and the scenario to apply to its data. */
async function createGameInWorker(opts: CreateGameOptions, scenario: { id: string; include: string[] | null } | null, startOptions: StartGameOptions): Promise<{ game: Game; simClient: SimWorkerClient }> {
    const client = await bootWorker('Creating galaxy', { kind: 'create', options: workerCreateOptions(opts), scenario }, opts.gameData, startOptions);
    return { game: client.core.game, simClient: client };
}
// [simworker] end

/** startGameView under a "Preparing map" overlay: building the map layers of a big galaxy takes a moment. */
async function startGameViewWithOverlay(...args: Parameters<typeof startGameView>): Promise<GalaxyTime> {
    const overlay = showLoadingOverlay('Preparing map');
    overlay.update({ step: '', fraction: 1 });
    try {
        await nextPaint();
        return await startGameView(...args);
    } finally {
        overlay.close();
    }
}
let lastStartOptions: StartGameOptions | null = null;
// [gameoptions] Game Options → Empire Settings shows this game's same-system start option read-only.
setAllowSameSystemSource(() => lastStartOptions?.colonization.allowSameSystemAsOtherEmpires ?? null);
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
    await preloadScenarioOverlays();
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
    factionMarkers: 'factionMarkers',
    stationPresence: 'stationPresence',
    fleetPostures: 'fleetPostures',
    travelVectorsState: 'travelVectorsState',
    travelVectorsPrivate: 'travelVectorsPrivate',
    longRangeScanners: 'longRangeScanners',
    fadeCivilianShips: 'fadeCivilianShips',
    // [freightOverlay] begin
    freight: 'freightFlows',
    freightFlows: 'freightFlows',
    hubs: 'tradeHubs',
    tradeHubs: 'tradeHubs',
    // [freightOverlay] end
    // [dw2overlays] begin
    resources: 'resources',
    fuel: 'fuelRange',
    fuelRange: 'fuelRange',
    colonyScores: 'colonyScores',
    // [dw2overlays] end
    supply: 'supplyShortages', // [improvements] supplyChain
    supplyShortages: 'supplyShortages',
};

/** Screenshot / dev hook: `?overlays=potentialColonies,scenic,research`
 * turns on the named overlay toggles at boot (task M3 verification), e.g.
 * `?autostart=1&zoom=1200&overlays=potentialColonies,scenic,research`. */
function applyOverlaysUrlParam(overlays: MapOverlayState): void {
    const raw = new URLSearchParams(window.location.search).get('overlays');
    if (raw === null) return;
    for (const token of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
        // A leading '-' turns the overlay off instead (e.g. `-territory`, to see the station-presence discs).
        const off = token.startsWith('-');
        const key = OVERLAY_PARAM_ALIASES[off ? token.slice(1) : token];
        if (key !== undefined) overlays[key] = !off;
    }
}

/** [dw2overlays] Screenshot / dev hook: `?resourceFilter=Caslon` (a resource name or id) picks the Resources overlay's
 * resource, as its "…" panel does. */
function applyResourceFilterUrlParam(overlays: MapOverlayState, galaxy: Galaxy): void {
    const raw = new URLSearchParams(window.location.search).get('resourceFilter');
    if (raw === null || raw === '') return;
    const n = Number(raw);
    const r = Number.isInteger(n) ? galaxy.resourceSystem.byId.get(n) : galaxy.resourceSystem.resources.find((x) => x.name.toLowerCase() === raw.toLowerCase());
    if (r !== undefined) overlayOptionsOf(overlays).resourceFilter = r.resourceId;
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
        // pnlHabitatInfo: the InfoPanel for the selected habitat. The original's InfoPanel there has no mouse handler;
        // here its hotspots keep their messages as tool tips, and the Galactopedia ones (resources, races, facilities —
        // Main.Part4.cs 3586-3607) open their topic.
        renderHabitatInfo: (box, h) => {
            const player = galaxy.playerEmpire;
            if (player === null) return;
            const resource = (id: number): { name: string; pictureRef: number } | null => galaxy.resources.find((r) => r.resourceId === id) ?? null;
            const model = habitatInfo({ galaxy, player, resource }, h);
            renderInfoModel(box, model, { galaxy, onTarget: (t) => { if (t.kind === 'galactopedia') openGalactopedia({ topic: t.topic }); } });
            // InfoPanel.DrawBackgroundPicture centres the picture in this 250 × 240 client area.
            const pic = box.querySelector<HTMLImageElement>('.sel-picture');
            if (pic !== null) {
                const side = Math.min(parseFloat(pic.style.width) || 200, 234);
                pic.style.width = `${side}px`;
                pic.style.height = `${side}px`;
                if (!pic.style.left.startsWith('-')) pic.style.left = `${Math.trunc((250 - side) / 2)}px`;
                pic.style.top = `${Math.trunc((240 - side) / 2)}px`;
            }
        },
    });
    document.body.appendChild(galaxyMap.element);
    return galaxyMap;
}

/**
 * WebGL context-loss recovery for a game view (render/contextLoss.ts): regenerate GPU-only content on restore, step
 * detail down when losses recur. Also drops Pixi's capability-probe context (getTestContext: a second WebGL context
 * kept for the page's lifetime once the renderer has read its limits; Pixi makes a new one if it ever asks again).
 */
function installGpuRecovery(app: Application, view: MainView): ReturnType<typeof installContextLossRecovery> {
    releasePixiTestContext(app.renderer);
    return installContextLossRecovery(app.canvas, app.renderer, view, { notify: showToast });
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
    simClient?: SimWorkerClient, // [simworker] the game runs in this worker; `game` is its replica
): Promise<GalaxyTime> {
    const dwuPresent = await detectDwuPresent();
    if (dwuPresent) {
        // Real-art file lists (scripts/gen-asset-manifest.mjs, predev/prebuild).
        await loadManifest();
    }
    const galaxy = game.galaxy;
    // Start.2.cs 60 / Start.cs 2394 method_56: the player race's chrome folder of the theme is searched first.
    setThemeChromeRace(game.playerEmpire?.dominantRace?.name ?? '');
    // [simworker] Save text of the running game: the worker's authoritative game in worker mode (async).
    const serializeCurrent = (): string | null | Promise<string | null> =>
        simClient !== undefined ? simClient.save() : lastStartOptions !== null ? serializeGame(game, time, lastStartOptions) : null;

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
    initOutputDither(app);
    initFrameLimiter(app); // [gameoptions]
    document.body.appendChild(app.canvas);

    const camera = new Camera();
    camera.setViewport(app.screen.width, app.screen.height);
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
    // Main.Part7.cs:4075 method_365, the LocationPinged handler: centre the main view on the pinged object (the
    // handler's only other effect, AddLocationHint, is a direct sim call in story/eventActions.ts RevealObject).
    registerLocationPingedHook((target) => camera.centerOn(target.xpos, target.ypos));

    const store = new AssetStore(dwuPresent);
    // Task M3: the overlay toggle state is created here (instead of after
    // MainView, as before) so the Main View's overlay layer and the HUD's
    // options list share the same MapOverlayState instance.
    const overlays = createMapOverlayState();
    overlays.freightFlows = getSettings().freightFlowsDefault; // [freightOverlay] settings default (19e-9)
    applyOverlaysUrlParam(overlays);
    applyResourceFilterUrlParam(overlays, galaxy); // [dw2overlays]
    const view = new MainView(app, camera, galaxy, store, overlays);
    await view.init();
    const contextLoss = installGpuRecovery(app, view);

    // One clock: the HUD's GalaxyTime is bound to galaxy.nowMs by createSimLoop (the scheduler advances it).
    const time = new GalaxyTime();
    if (savedClock !== undefined) {
        time.speed = savedClock.speed;
        time.paused = savedClock.paused;
    }
    if (simClient !== undefined) {
        // The worker's clock controls (a loaded save's, or a new game's paused start).
        time.speed = simClient.core.clock.speed;
        time.paused = simClient.core.clock.paused;
    }
    // [simworker] in worker mode the frame loop applies the worker's deltas to the replica instead of stepping.
    const inThreadLoop = simClient === undefined ? createSimLoop(galaxy, time, camera, simViewEnabledFromUrl(window.location.search)) : null;
    const simLoop: { stats: object; renderTime: RenderTime; tick(realDtMs: number): number } = inThreadLoop ?? simClient!.createLoop(time);
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
    // [simworker] in worker mode `sim` / `simBudget` stand in for the worker's driver / budget (SimWorkerClient.debugObject).
    Object.assign((window as unknown as { __dwu: Record<string, unknown> }).__dwu, { sim: inThreadLoop?.driver ?? simClient?.debugObject('sim') ?? null, simStats: simLoop.stats, simWorker: simClient ?? null, gpuContext: contextLoss.state });
    // The game's message options (Game.DisplayMessage* / DisplayPopup*, saved with it): what the Game Options window
    // shows and edits (ui/messageRouting.ts).
    adoptGameMessageOptions(galaxy);
    // The player's message pipeline runs in the sim tick (sim/playerMessages.ts); the ticker / popups / stubs read what
    // it handled from a PlayerMessageStream. In-thread the game's pipeline feeds it; in worker mode the worker's
    // 'playerMessages' events do (ui/workerMessages.ts, with the events and the game end). Installed before the
    // consumers first read it.
    const localMessages = simClient === undefined ? installLocalMessageStream(galaxy, game.playerEmpire) : null;
    // [simworker] Sim → UI events from the worker (the sim-side handling already ran there).
    const workerMessageUi = simClient !== undefined ? installWorkerMessageUi({ player: game.playerEmpire, galaxy, time }) : null;
    simClient?.onEvent((e, resolve) => {
        if (workerMessageUi?.onEvent(e, resolve) === true) return;
        if (e.kind === 'locationPinged') {
            const t = resolve(e.target) as { xpos: number; ypos: number } | null;
            if (t !== null) camera.centerOn(t.xpos, t.ypos);
        } else if (e.kind === 'simError') showToast('Simulation error — game paused (see the worker console)');
        // The worker itself stopped (docs/sim-worker.md §4.4 "Failed commands"): orders in flight have failed. Offer to
        // restart the game in a new worker (§4.6).
        else if (e.kind === 'workerStopped') {
            showToast('The simulation stopped — the orders on their way were not carried out (see the console)');
            void offerWorkerRestart(simClient, game, time, e.message);
        }
    });
    // 19p event log: `?eventLog=dump` logs the chronicle digest; __dwu.eventLog.dump() / .export(since).
    (window as unknown as { __dwu: Record<string, unknown> }).__dwu.eventLog = installEventLogDevHook(galaxy, window.location.search);

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
    // [llm] begin — 19s-1: the local-model layer (queue + yearly chronicle); nothing is created with llmFoundations off.
    const llmLayer = startLlmLayer({ galaxy, player: game.playerEmpire, settings: () => {
            const st = getSettings();
            return { endpoint: st.advisorEndpoint, model: st.advisorModel, api: st.advisorApi, think: st.advisorThink };
        }, search: window.location.search });
    (window as unknown as { __dwu: Record<string, unknown> }).__dwu.llm = llmLayer;
    // [llm] end
    // Task 10d: the HUD's money panel refreshes from the player empire.
    // Task C3: Galaxy Map screen (G key / HUD "Galaxy map (G)" row).
    const galaxyMap = createGalaxyMapFor(galaxy, camera);
    (window as unknown as { __dwu?: Record<string, unknown> }).__dwu!.galaxyMap = galaxyMap;
    // [fix6ui] begin — ship-order / selection keys (created after the order UI below).
    let shipKeys: ShipCommandKeys | null = null;
    Object.assign((window as unknown as { __dwu: Record<string, unknown> }).__dwu, { simBudget: inThreadLoop?.budget ?? simClient?.debugObject('simBudget') ?? null });
    // Command log (smoke / debugging): issue a player command through the queue and read the journal. [simworker] In
    // worker mode the journal is the worker's: `log()` returns a Promise of it (the replica keeps no log).
    Object.assign((window as unknown as { __dwu: Record<string, unknown> }).__dwu, { commands: { issue: issuePlayerCommand, log: () => (simClient !== undefined ? simClient.commandLog() : commandLog(galaxy)), moveOrder: (t: Habitat) => createMissionShipActionAt(BuiltObjectMissionType.Move, t, Math.trunc(t.xpos), Math.trunc(t.ypos)) } });
    // [fix6ui] end
    // [freightOverlay] begin — task 19e-9: Trade Flows panel (overlay row "…", legend button) + map legend.
    const tradeFlowsOpts = {
        galaxy,
        playerEmpire: game.playerEmpire,
        overlay: () => view.freightOverlay,
        jumpTo: (x: number, y: number) => camera.centerOn(x, y),
    };
    const removeFreightLegend = mountFreightLegend(overlays, () => openTradeFlows(tradeFlowsOpts));
    setEmpireSummaryTradeFlowsLink(() => openTradeFlows(tradeFlowsOpts));
    // [freightOverlay] end
    // [improvements] supplyChain — the resource supply panel's game-view hooks, and a dev / perf handle.
    setResourceSupplyHost({
        galaxy,
        goTo: (t) => selectStellarObject(t, true),
        jumpTo: (x, y) => camera.centerOn(x, y),
        freight: () => view.freightOverlay,
        overlays,
        openTradeFlows: () => openTradeFlows(tradeFlowsOpts),
    });
    Object.assign((window as unknown as { __dwu: Record<string, unknown> }).__dwu, {
        supply: { stats: supplyStats, snapshot: (force = false) => supplySnapshot(galaxy, galaxy.playerEmpire, force), invalidate: () => invalidateSupply(galaxy), openResource: openResourceSupply },
    });
    const hud: HudRefs = createHud({
        clock: time,
        overlays,
        openTradeFlows: () => toggleTradeFlows(tradeFlowsOpts), // [freightOverlay]
        camera,
        galaxy,
        game,
        gameData: lastPlayedGameData ?? lastGameData ?? undefined,
        followState: view.followState, // [followcam]
        onGalaxyMap: () => galaxyMap.toggle(),
        openGalaxyMapAt: (h) => galaxyMap.open(h),
        onMainMenu: () => {
            void leaveGameToMenu();
        },
        // Keep the Main View selection ring on whatever the panel shows.
        afterSelectionChange: (sel) => {
            view.selectedBuiltObject = sel?.builtObject ?? null;
            view.selectedCreature = sel?.creature ?? null;
            view.selectedFighter = sel?.fighter ?? null;
            view.selectedHabitat = sel && !sel.builtObject && !sel.creature && !sel.fighter && !sel.builtObjects ? sel.habitat : null;
            view.selectedBuiltObjects = sel?.builtObjects ?? null;
            shipKeys?.afterSelectionChange(sel); // [fix6ui] selection history + view lock
        },
    });
    const systemNameEl = hud.elements.get('pnlMoney')?.querySelector('.hud-system-name');
    const topLeftEl = hud.elements.get('pnlTopLeftBar');
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
    // A clicked creature selects it (InfoPanel.cs DrawCreature in the selection panel).
    view.onCreatureSelect = (c) => selectCreature(c, false);
    // A clicked fighter selects it (Main.Part11.cs 1579-1600 → InfoPanel.cs DrawFighter).
    view.onFighterSelect = (f) => selectFighter(f);
    // Left-drag box / Shift-click multi-selection (Main.Part10.cs 2989 mainView_MouseUp, BuiltObjectList).
    view.onBuiltObjectListSelect = (list) => selectBuiltObjectList(list);
    view.getSelectedShips = () => {
        const s = getHudSelection();
        if (s === null || s.shipGroup !== undefined || s.creature !== undefined || s.fighter !== undefined) return null;
        return s.builtObjects ?? s.builtObject ?? null;
    };
    // [galaxymarkers] fleet icons / double-clicked fleet ships select the fleet; symbols highlight the HUD selection.
    view.onShipGroupSelect = (g) => selectShipGroup(g, false);
    if (view.galaxyMarkers !== null) view.galaxyMarkers.getSelection = () => getHudSelection();
    view.getHudSelection = () => getHudSelection();
    view.onDoubleClickStar = (star: Habitat) => {
        if (star.category !== HabitatCategoryType.Star) return;
        camera.centerOn(star.xpos, star.ypos);
        camera.zoomAt(SYSTEM_LEVEL_ZOOM, camera.width / 2, camera.height / 2);
    };
    // Task 14a: the messages the player's pipeline handled feed the ticker (4x a second; the line's date is the
    // message's star date, stamped by the pipeline).
    const messageFeed = createEmpireMessageFeed();
    const refreshHud = (): void => {
        // Fog of war (Main.Part10.cs method_209): no panel for a ship / fleet / creature the player no longer sees.
        const shown = getHudSelection();
        if (shown !== null && fogOf(galaxy).selectionUnseen(shown)) hud.onSelectionChange?.(null);
        if (systemNameEl) {
            setTextIfChanged(systemNameEl, topSystemNameText(galaxy, camera.x, camera.y, camera.zoom));
        }
        for (const { message, text } of messageFeed.pollMessages(game.playerEmpire)) {
            const goTo = messageGoToTarget(message) !== null ? (): boolean => goToMessage(message, galaxy) : null;
            pushHudMessage(text, resolveStarDateDescription(message.starDate > 0 ? message.starDate : time.currentStarDate), goTo);
        }
    };
    refreshHud();
    const resizeHandler = (): void => {
        layoutHud(hud);
    };
    window.addEventListener('resize', resizeHandler);
    const refreshHudTimer = setInterval(refreshHud, 250);
    const refreshClockLabel = (): void => {
        // 4 Hz; the DOM is only written when a value changes (an unchanged write still re-lays out the HUD).
        refreshTopLeftControls(topLeftEl, time);
    };
    const refreshClockTimer = setInterval(refreshClockLabel, 250);
    // [15d] Galaxy.GameEnd → Main.Part12.cs Galaxy_GameEnd / DoGameEnd (pause, IsFinished/Victor, banner).
    // [simworker] worker mode: the worker's handler ends the game; its gameEnd event shows the banner (workerMessages.ts).
    if (simClient === undefined) installGameEndHandler(galaxy, time);
    // Main.Part6.cs:4050 btnGameEndExit_Click: the Game End panel's "Exit to main menu" leaves like the menu's Main Menu.
    setGameEndExitHandler(() => {
        void leaveGameToMenu();
    });
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
            else if (o instanceof Creature) selectCreature(o, false);
            else selectStellarObject(o as Parameters<typeof selectStellarObject>[0], false);
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
    // [improvements] Battle reports (DW2-inspired): the sim records them; this announces new ones and opens the window.
    setBattleReportsEnabled(battleReportsObserverOn());
    installBattleReportNotifier({ galaxy, player: game.playerEmpire, goTo: (x, y) => historyGoTo(camera, x, y) });
    // Dev / screenshot hook (scripts/battlereports-shots.mjs): the current game's save text (both modes).
    Object.assign((window as unknown as { __dwu: Record<string, unknown> }).__dwu, { serialize: serializeCurrent });

    // [leftovers] begin
    // The player's EventMessageRecipient (Main.Part12.cs:2881) → history messages + the wonder-built popup.
    installEventMessages({ player: game.playerEmpire, galaxy, onGoTo: (t) => selectStellarObject(t, true), onGoToCreature: (c) => selectCreature(c, true) });
    // Autosave every GameOptions.AutoSaveInterval minutes (Main.Part12.cs:4013 method_97).
    installAutosave({
        serialize: () => serializeCurrent(),
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
                else if (Array.isArray(t)) selectBuiltObjectList(t); // BuiltObjectList (one ship: a ship selection)
                else if (t instanceof Fighter) selectFighter(t); // Main.Part10.cs method_208 for a Fighter
                else selectStellarObject(t, false);
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
    setViewLockedQuery(() => activeShipKeys.locked);
    // [fix6ui] end

    // [parC1] begin — control groups (Main.Part7.cs Main_KeyUp Set / SelectControlGroupN[WithFocus], ui/controlGroups.ts).
    const controlGroupKeys = createControlGroupKeys({
        galaxy,
        player: game.playerEmpire,
        camera,
        getSelection: getHudSelection,
        godMode: () => fogOf(galaxy).reveal,
        playSetSound: () => playGridClick(),
        // method_209(obj, bool_28: true) without method_157: select, keep the view.
        select: (o) => {
            if (o === null) hud.onSelectionChange?.(null);
            else if (Array.isArray(o)) selectBuiltObjectList(o);
            else if (o instanceof ShipGroup) selectShipGroup(o, false);
            else if (o instanceof Habitat) selectHabitat(o, false);
            else if (o instanceof Creature) selectCreature(o, false);
            else if (o instanceof Fighter) selectFighter(o);
            else if ('systemStar' in o) hud.onSelectionChange?.({ habitat: o.systemStar, system: o, systemInfo: true });
            else selectStellarObject(o, false);
        },
    });
    setControlGroupHandler((kind, index) => controlGroupKeys.handle(kind, index));
    // A new game view starts with every panel shown and the full display type (Main's defaults).
    resetPanelVisibility();
    setMainViewDisplayType(0);
    // [parC1] end

    // Task 06l: extra boots run after the HUD/clock are wired (e.g. opening
    // a tutorial window that pauses/unpauses the clock).
    for (const boot of extraBoots ?? []) {
        boot();
    }

    const shortcuts = createShortcutsOverlay();
    const keyHandlers = buildDefaultHandlers(camera, time, { width: galaxy.sizeX, height: galaxy.sizeY }, view.followState);
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
        // Space must not also activate a focused HUD button (a second toggle). [parC1] Ctrl+digit must not reach the
        // browser's / shell's own shortcut (where it can be cancelled).
        if (action === 'togglePause' || (action !== null && action.startsWith('setControlGroup'))) e.preventDefault();
        if (action === 'togglePause' || action === 'speedUp' || action === 'speedDown') {
            refreshClockLabel();
        }
    };
    window.addEventListener('keydown', keydownHandler);

    // Plan §1.1/§5.1: whole sim frames from the real scheduler (orbits, creatures, empires, fleets, ships...).
    // [fix6ui] begin — real elapsed time (elapsedMS: not capped at 100 ms like deltaMS) under the sim's wall-clock
    // budget; a render exception is contained like a sim one (Pixi would stop scheduling frames).
    const renderGuard = createRenderGuard();
    // [audio] begin — Main View sound requests (drawn weapons, explosions, hyperjumps, ...) + ambient music fade.
    const gameAudio = installGameAudio({ galaxy, camera, time, suppressAllPopups: () => getMessageOptions().suppressAllPopups, selectedShip: () => view.selectedBuiltObject });
    Object.assign((window as unknown as { __dwu: Record<string, unknown> }).__dwu, { audio: soundRequestStats() });
    // [audio] end
    app.ticker.add(() => {
        simLoop.tick(app.ticker.elapsedMS);
        shipKeys?.frame();
        renderGuard(() => view.update(simLoop.renderTime));
        renderGuard(() => gameAudio.frame()); // [audio]
    });
    // [fix6ui] end
    app.renderer.on('resize', () => {
        camera.setViewport(app.screen.width, app.screen.height);
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
                serialize: () => serializeCurrent(),
                loadSave: (text) => {
                    return loadSaveWithProgress(text);
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
        serialize: () => serializeCurrent(),
        loadSave: (text) => {
            return loadSaveWithProgress(text);
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
        contextLoss.dispose();
        galaxyMap.destroy();
        // The HUD selection is module state: don't show the old game's
        // object in the next game's panel.
        setHudSelection(null);
        // The scene graph too (not the textures: the art caches are shared): a Text that is not destroyed stays a
        // listener of its TextStyle, which Pixi's text-metrics cache keeps, and through its parents the old view, its
        // layers and its galaxy stayed alive after a load or a sim-worker restart.
        app.destroy(true, { children: true });
        hud.root.remove();
        destroyHudListeners();
        shortcuts.destroy();
        hud.gameMenu?.destroy();
        setGameMenuHandler(null);
        setCycleHandler(null);
        // [fix6ui] begin
        setShipCommandHandler(null);
        setViewLockedQuery(null);
        shipKeys = null;
        setControlGroupHandler(null); // [parC1]
        resetPanelVisibility(); // [parC1]
        closeGroundReport(); // [parC1]
        // [fix6ui] end
        // Module-level panels hold the old game's Empire/camera and a
        // document keydown listener: close them and drop their source.
        closeEmpiresList();
        closeCharterPanels(); // [charters]
        closeDiplomacyScreen(); // [15a]
        closeExpansionPlanner(); // [16a]
        closeColoniesScreen();
        // [tradenego] begin
        closeTradePanel();
        // [tradenego] end
        closeShipsAndBasesList();
        closeResearchScreen(); // [15b]
        closeShipDesigns(); // [16b]
        closeEmpireSummary();
        // [freightOverlay] begin
        closeTradeFlows();
        removeFreightLegend();
        setEmpireSummaryTradeFlowsLink(null);
        // [freightOverlay] end
        setResourceSupplyHost(null); // [improvements] supplyChain
        closeMessageHistory();
        closeFleetsList(); // [15c]
        closeBuildOrder(); closeConstructionYards(); // [16c]
        closeBuildQueue(); // [buildQueue]

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
        removeBattleReportNotifier(); // [improvements]

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
        setGameEndExitHandler(null);
        closeIntroductionPanel(); // [intro]
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
        llmLayer.dispose(); // [llm]
        orderUiCleanup(); // [ordermenu]

        gameAudio.dispose(); // [audio]
        workerMessageUi?.dispose(); // [simworker]
        localMessages?.dispose();
        simClient?.dispose(); // [simworker]
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
    // Mod layer: a chosen scenario's overlay goes over the base data before createGame.
    let playData: GameData = gameData;
    if (startOptions.scenario != null) {
        await preloadScenarioOverlays();
        try {
            playData = gameDataWithScenario(gameData, startOptions.scenario.id, choiceInclude(startOptions.scenario));
        } catch (err) {
            console.error(err);
            return;
        }
        if (playData.scenario !== undefined && playData.scenario.warnings.length > 0) console.warn('Scenario overlay warnings', playData.scenario.warnings);
    }
    lastPlayedGameData = playData;
    // Built in steps under a progress overlay: a big Mature/Old galaxy takes several seconds.
    let game: Game;
    let simClient: SimWorkerClient | undefined; // [simworker]
    let createOpts: CreateGameOptions;
    try {
        // [gameoptions] Start.2.cs 1352-1363 / 2122-2146: the player empire starts with the GameOptions defaults the
        // in-game Options window saved (Main.Part9.cs YxwyUefOyQ / method_257; undefined = method_260's defaults).
        // Start.2.cs 2147-2188: the message options too (Game.DisplayMessage* / DisplayPopup*, sim state since the player's
        // message pipeline runs in the tick); and the wizard's flag pick, written at the end of createGame.
        createOpts = {
            ...toCreateGameOptions(startOptions, playData, systemNames),
            gameOptions: newGameOptionsFromSettings(getSettings().newGameOptions),
            messageOptions: copyMessageOptions(getMessageOptions()),
            playerFlagShape: startOptions.flagShapeIndex,
        };
        if (useSimWorker()) {
            const sc = startOptions.scenario;
            const scenario = sc == null ? null : { id: sc.id, include: choiceInclude(sc) };
            ({ game, simClient } = await createGameInWorker(createOpts, scenario, startOptions));
        } else game = await runStepsWithProgress('Creating galaxy', createGameSteps(createOpts));
    } catch (err) {
        console.error('Galaxy creation failed', err);
        showToast('Could not create the galaxy — see console');
        showMainMenu();
        return;
    }
    const time = await startGameViewWithOverlay(game, undefined, undefined, undefined, simClient);
    // Main.Part12.cs:4248-4258: a new (non-tutorial) game pauses and shows the Introduction panel once the main view is
    // up. Game.PlayAsAPirate = Start.2.cs bool_2; Game.AgeOfShadows = Start.2.cs:2020-2024 (bool_3, or the player's
    // Age == 0; sim/gameStartTail.ts gameObjectAtStart).
    showIntroduction(game, time, { playAsAPirate: createOpts.player.playAsPirate ?? false, ageOfShadows: createOpts.ageOfShadows === true || createOpts.player.age === 0 });
}

/** [intro] Open the game-start Introduction panel (ui/screens/introductionPanel.ts) over the main view. */
function showIntroduction(game: Game, time: GalaxyTime, kind: { playAsAPirate: boolean; ageOfShadows: boolean }): void {
    try {
        openIntroductionPanel({ galaxy: game.galaxy, player: game.playerEmpire, clock: time, ...kind });
    } catch (err) {
        console.warn('Introduction panel failed', err);
    }
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
    // [simworker] the tutorial game is created in the worker too (the same options; createGame there).
    const inWorker = useSimWorker();
    let simClient: SimWorkerClient | undefined;
    try {
        if (inWorker) ({ game, simClient } = await createGameInWorker(opts, null, { ...defaultStartGameOptions(), seed: opts.seed }));
        else game = createGame(opts);
    } catch (err) {
        console.warn('Tutorial game creation failed', err);
        if (inWorker) {
            // [simworker] the Tutorials screen is gone: back to the menu rather than a blank page.
            showToast('Could not create the tutorial game — see console');
            showMainMenu();
        }
        return;
    }
    // Saves need start options (metadata only; the galaxy itself is saved).
    lastGameData = gameData;
    lastPlayedGameData = gameData;
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
    }], undefined, simClient);
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
    const { game, time, startOptions, simClient } = loaded as unknown as {
        game: Game;
        time: GalaxyTime;
        startOptions: StartGameOptions;
        simClient?: SimWorkerClient; // [simworker]
    };
    lastStartOptions = startOptions;
    activeMainMenu?.destroy();
    activeMainMenu = null;
    await ensureStaticData();
    teardownActiveGameView();
    // The sim time itself is galaxy.nowMs (saved with the galaxy); the save's clock only restores pause/speed.
    // [gameoptions] Main.Part7.cs:4056-4063: a loaded game is paused exactly when "Loaded games are paused" is on.
    await startGameViewWithOverlay(game, undefined, undefined, { speed: time.speed, paused: loadedGamePaused(time.paused, getSettings().loadedGamesPaused) }, simClient);
}

/**
 * Make `name` the active theme in this session (Start.cs method_2 / Main.Part12.cs method_66): data, GameText, art
 * and music are reloaded for it on next use. `persist` = GameOptions.CustomizationSetName is set too (bool_5).
 */
async function switchTheme(name: string, persist: boolean): Promise<void> {
    const set = normalizeCustomizationSetName(name);
    if (persist) updateSettings({ customizationSet: set });
    if (set === activeCustomizationSetName()) return;
    await activateTheme(set);
    lastGameData = null;
    lastPlayedGameData = null;
    resetMusicForTheme();
    // Galaxy.InitializeData + TextResolver.LoadText for the new set (method_2 1458-1473): data and GameText now.
    await ensureStaticData();
}

/**
 * Leave the running game for the main menu (the game menu's Main Menu, the Game End panel's exit, a stopped
 * simulation): Main.Part12.cs 3181-3184 first loads GameOptions.CustomizationSetName's theme again when the game ran on
 * another one (a ?theme= game; themeLoader.ts themeToRestoreOnLeave), not persisting it.
 */
async function leaveGameToMenu(): Promise<void> {
    teardownActiveGameView();
    const restore = themeToRestoreOnLeave(activeCustomizationSetName(), getSettings().customizationSet, await fetchThemeList());
    if (restore !== null) await switchTheme(restore, false);
    showMainMenu();
}

async function main(): Promise<void> {
    const params = new URLSearchParams(window.location.search);
    // The stored theme (GameOptions.CustomizationSetName), cleared when its folder is gone (Main.Part12.cs 1932-1938).
    // ?theme=<name> (dev / screenshots) picks one for this page only.
    const urlTheme = params.get('theme');
    await bootTheme(urlTheme ?? getSettings().customizationSet, () => {
        if (urlTheme === null) updateSettings({ customizationSet: '' });
    });
    // [audio] begin — GlassButton / HoverButton / HoverMenuItem / ListViewBase click sounds on every screen.
    installUiClickSounds();
    // [audio] end
    const skipMenu = SKIP_MENU_PARAMS.some((k) => params.has(k));

    const newGame = params.get('newgame');
    if (newGame !== null) {
        // Dev / perf hook: start a game through the wizard path (toCreateGameOptions + the progress overlay) with the
        // wizard defaults overridden by this JSON, e.g. the big late start
        // ?newgame={"seed":1,"starCountIndex":5,"dimensionIndex":4,"galaxyExpansionIndex":4,"empireExpansionIndex":4,"otherEmpires":{"empireCount":19}}
        const o = JSON.parse(newGame) as Partial<StartGameOptions> & { otherEmpires?: Partial<StartGameOptions['otherEmpires']> };
        const base = wizardStartGameOptions();
        void bootGameFromWizard({ ...base, raceName: 'Human', empireName: 'Human Empire', ...o, otherEmpires: { ...base.otherEmpires, ...o.otherEmpires } });
        return;
    }

    const loadUrl = params.get('load');
    if (loadUrl !== null) {
        // Dev / perf hook: ?load=<url> fetches a save (serializeGame text, e.g. /dev-saves/x.dwusave under public/) and
        // boots it as the main menu's Load Game would (scripts/perf-render.mjs --load=...).
        await ensureStaticData();
        if (useSimWorker()) {
            // [simworker] the worker fetches and parses the save itself (the text never reaches the main thread).
            if (lastGameData === null) throw new Error('DW:U game data is required to load a save');
            await bootLoadedGame((await loadSaveInWorker({ url: new URL(loadUrl, window.location.href).href })) as unknown as LoadedGame);
            return;
        }
        const res = await fetch(loadUrl);
        if (!res.ok) throw new Error(`?load=${loadUrl}: HTTP ${res.status}`);
        await bootLoadedGame(await loadSaveWithProgress(await res.text()));
        return;
    }

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
    setThemeChromeRace(''); // no player race on the menu (Main.Part12.cs method_56 runs at game start)
    const menu = createMainMenu({
        // Start.1.cs btnThemeSwitch_Click → method_2(theme, bool_5: true, bool_6: true), then the menu shows the new set.
        onSwitchTheme: async (name) => {
            await switchTheme(name, true);
            menu.destroy();
            showMainMenu();
        },
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
                    return loadSaveWithProgress(text);
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
                return loadSaveWithProgress(text);
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
 * seed=1, spiral, 700 stars, 4x4 sectors; ?stars=N, ?sectors=N override). */
function parseBootOptions(params: URLSearchParams): BootOptions {
    return {
        seed: parseInt(params.get('seed') ?? '1', 10) || 1,
        starCount: parseInt(params.get('stars') ?? '700', 10) || 700,
        shape: SHAPE_BY_NAME[params.get('shape') ?? 'spiral'] ?? GalaxyShape.Spiral,
        // ?sectors=N (debug/perf): N×N sectors (the wizard's Physical Size; clamped to 4..15 by the Galaxy ctor).
        sectorWidth: parseInt(params.get('sectors') ?? '4', 10) || 4,
        sectorHeight: parseInt(params.get('sectors') ?? '4', 10) || 4,
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
        // wizdefaults: the dev/tutorial autostart path skips the wizard entirely, so it must set these
        // explicitly or fall back to createGame's own default (game.ts, Galaxy.cs 729/732's raw 3000000 —
        // the pre-wizard class default, not what "New Game" actually starts with). Match the wizard's
        // default instead (Main.Part9.cs 2674-2675 method_259): enforcement on, 2 sectors.
        colonizationRangeEnforceLimit: defaultStartGameOptions().colonization.enforceRangeLimits,
        colonizationRange: colonizationRangeFor(defaultStartGameOptions().colonization.colonizationRangeKly),
        // Human, or (a theme without one) the first playable race of its races\ folder.
        player: { race: gameData.races.some((r) => r.name === 'Human' && r.playable) ? 'Human' : (gameData.races.find((r) => r.playable)?.name ?? 'Human'), homeSystemFavourability: 'Normal', startLocation: '(Random)', age: 1, techLevel: STARTING_TECH_LEVEL },
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

/** [simworker] The worker an autostart game was created in (handed to startGameView by bootGameWithOptions). */
let autostartSimClient: SimWorkerClient | null = null;

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
    let opts = defaultDevGameOptions(seed, shape, starCount, sectorWidth, sectorHeight, systemNames, gameData);
    let playData = gameData;
    // [scenarioAutostart] begin
    // Dev / screenshot hook: `?autostart=1&scenario=<id>[&aiRace=<race>]` starts the dev game with a scenario overlay
    // (manifest-default flags and params); aiRace forces the first AI empire's race. `scenario=<a>,<b>,...` starts
    // those add-ons together as the wizard's add-on picker would (requirements pulled in, masters on).
    const scenarioParams = new URLSearchParams(window.location.search);
    const scenarioId = scenarioParams.get('scenario');
    let scenarioChoice: StartScenarioChoice | null = null;
    if (scenarioId !== null && scenarioId.includes(',')) {
        await preloadScenarioOverlays();
        const cat = addonCatalog([...scenarioOverlays.values()].map((o) => o.manifest));
        const picked = scenarioId.split(',').map((x) => x.trim()).filter((x) => x !== '');
        const plan = planAddonStart(cat, picked);
        if (plan !== null) {
            const sw = resolveAddonSwitches(cat, picked);
            scenarioChoice = { id: plan.id, flags: sw.flags, params: sw.params, addons: picked };
            playData = gameDataWithScenario(gameData, plan.id, plan.kind === 'composite' ? plan.manifest.include : null);
            lastPlayedGameData = playData;
            opts = { ...opts, gameData: playData, scenarioFlags: sw.flags, scenarioParams: sw.params };
        }
    } else if (scenarioId !== null && scenarioId !== '') {
        await preloadScenarioOverlays();
        const overlay = scenarioOverlays.get(scenarioId);
        if (overlay === undefined) {
            console.warn(`?scenario=${scenarioId}: no such scenario`);
        } else {
            playData = gameDataWithScenario(gameData, scenarioId);
            lastPlayedGameData = playData;
            scenarioChoice = defaultScenarioChoice(overlay.manifest);
            const aiRace = scenarioParams.get('aiRace');
            opts = { ...opts, gameData: playData, scenarioFlags: scenarioChoice.flags, scenarioParams: scenarioChoice.params, aiEmpires: aiRace !== null ? [{ ...opts.aiEmpires[0], race: aiRace }, ...opts.aiEmpires.slice(1)] : opts.aiEmpires };
        }
    }
    // [scenarioAutostart] end
    try {
        // Saves need start options (metadata only; the galaxy itself is saved).
        const startOptions = { ...defaultStartGameOptions(), seed, scenario: scenarioChoice };
        if (useSimWorker()) {
            // [simworker] the same options, created in the worker (its data gets the same scenario overlay).
            const scenario = scenarioChoice === null ? null : { id: scenarioChoice.id, include: choiceInclude(scenarioChoice) };
            const r = await createGameInWorker(opts, scenario, startOptions);
            lastPlayedGameData = playData;
            lastStartOptions = startOptions;
            autostartSimClient = r.simClient;
            return r.game;
        }
        const game = await runStepsWithProgress('Creating galaxy', createGameSteps(opts));
        lastPlayedGameData = playData;
        lastStartOptions = startOptions;
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
    lastPlayedGameData = gameData;
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
            const simClient = autostartSimClient ?? undefined; // [simworker]
            autostartSimClient = null;
            const time = await startGameView(started, zoomParam ?? undefined, undefined, undefined, simClient);
            // [intro] ?intro=1: the dev autostart shows the Introduction panel too (wizard games always do).
            if (new URLSearchParams(window.location.search).get('intro') === '1') showIntroduction(started, time, { playAsAPirate: started.playerEmpire.pirateEmpireBaseHabitat !== null, ageOfShadows: false });
            return;
        }
    }

    // [simworker] begin — the bare generateGalaxy boot runs in the worker too (it needs the DW:U data for the replica's
    // static tables; without it, or if the worker fails, the galaxy is generated here as before).
    let simClient: SimWorkerClient | null = null;
    if (useSimWorker() && gameData !== null) {
        try {
            simClient = await bootWorker('Creating galaxy', { kind: 'generate', options: { seed, shape, starCount, sectorWidth, sectorHeight, systemNames }, viewX: 0, viewY: 0 }, gameData, defaultStartGameOptions());
        } catch (err) {
            console.warn('sim worker: generateGalaxy failed in the worker; generating it in-thread', err);
        }
    }
    // [simworker] end

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
    initOutputDither(app);
    initFrameLimiter(app); // [gameoptions]
    document.body.appendChild(app.canvas);

    // Deterministic galaxy (seed/shape/stars/sectors from the URL or wizard). [simworker] or the worker's replica.
    const galaxy = simClient !== null ? simClient.core.galaxy : generateGalaxy({
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
    camera.setViewport(app.screen.width, app.screen.height);
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
    installGpuRecovery(app, view);

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
    // [simworker] in worker mode the frame loop applies the worker's deltas to the replica instead of stepping.
    const inThreadLoop = simClient === null ? createSimLoop(galaxy, time, camera, simViewEnabledFromUrl(window.location.search)) : null;
    const simLoop: { tick(realDtMs: number): number; renderTime: RenderTime } = inThreadLoop ?? simClient!.createLoop(time);
    if (inThreadLoop !== null) Object.assign(debugHook, { time, sim: inThreadLoop.driver, simStats: inThreadLoop.stats });
    else {
        const sc = simClient!;
        Object.assign(debugHook, { time, sim: sc.debugObject('sim'), simBudget: sc.debugObject('simBudget'), simStats: sc.core.stats, simWorker: sc, commands: { log: () => sc.commandLog() } });
    }
    // Task C3: Galaxy Map screen (G key / HUD "Galaxy map (G)" row).
    const galaxyMap = createGalaxyMapFor(galaxy, camera);
    debugHook.galaxyMap = galaxyMap;
    const hud: HudRefs = createHud({
        clock: time,
        overlays,
        camera,
        galaxy,
        gameData: gameData ?? undefined,
        followState: view.followState, // [followcam]
        onGalaxyMap: () => galaxyMap.toggle(),
        openGalaxyMapAt: (h) => galaxyMap.open(h),
    });
    const systemNameEl = hud.elements.get('pnlMoney')?.querySelector('.hud-system-name');
    const topLeftEl = hud.elements.get('pnlTopLeftBar');
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
            setTextIfChanged(systemNameEl, topSystemNameText(galaxy, camera.x, camera.y, camera.zoom));
        }
    };
    refreshHud();
    window.addEventListener('resize', () => layoutHud(hud));
    // The camera centre moves with panning/zooming; keep lblSystemName fresh.
    setInterval(refreshHud, 250);
    // Task 07b: keep the star-date label (and the play/pause glyph) fresh.
    const refreshClockLabel = (): void => {
        // 4 Hz; the DOM is only written when a value changes (an unchanged write still re-lays out the HUD).
        refreshTopLeftControls(topLeftEl, time);
    };
    setInterval(refreshClockLabel, 250);

    // Task 10a: the full original keyboard command table (UI_KeyboardCommands)
    // dispatches on keydown; it replaces the ad-hoc spacebar handler. '?'
    // toggles the "Keyboard shortcuts" overlay; F1 opens the Galactopedia.
    const shortcuts = createShortcutsOverlay();
    const keyHandlers = buildDefaultHandlers(camera, time, { width: galaxy.sizeX, height: galaxy.sizeY }, view.followState);
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
        renderGuard(() => view.update(simLoop.renderTime));
    });
    // [fix6ui] end
    app.renderer.on('resize', () => {
        camera.setViewport(app.screen.width, app.screen.height);
        layoutHud(hud);
    });
}

main().catch((err) => {
    console.error('DW:U boot failed', err);
});
// [gameoptions] begin
/** The running game view's ticker (the one listener below follows the latest view). */
let limitedTicker: Application['ticker'] | null = null;
let frameLimiterListening = false;
/** GameOptions.MaximumFramerate (Main.Part12.cs:4289-4316: the main loop sleeps to stay under it; -1 = Unlimited) as
 *  the Pixi ticker's maxFPS; follows later changes from Game Options → Advanced Display Settings. */
function initFrameLimiter(app: Application): void {
    limitedTicker = app.ticker;
    app.ticker.maxFPS = tickerMaxFps(getSettings().maximumFramerate);
    if (frameLimiterListening) return;
    frameLimiterListening = true;
    onSettingsChange((st) => {
        if (limitedTicker !== null) limitedTicker.maxFPS = tickerMaxFps(st.maximumFramerate);
    });
}
// [gameoptions] end

/**
 * Anti-banding output dither (render/outputDither.ts): on unless Settings → "Dither gradients" is off; `?dither=0|1`
 * overrides it for A/B checks (scripts/perf-render.mjs, screenshots). Follows later settings changes live.
 */
function initOutputDither(app: Application): void {
    const q = new URLSearchParams(window.location.search).get('dither');
    const urlOverride = q === '0' ? false : q === '1' ? true : null;
    installOutputDither(app.renderer, urlOverride ?? getSettings().ditherGradients);
    onSettingsChange((st) => setOutputDither(urlOverride ?? st.ditherGradients));
}
