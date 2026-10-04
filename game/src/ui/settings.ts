// UI settings (task 10c): a small persisted state object for the in-game
// Options sub-panel. Values live in localStorage under one JSON key so they
// survive reloads; getters let the renderer read them later (TODO wiring).
// The storage backend is injectable so node-based tests can run without a
// real localStorage.

import { startEffects } from '../audio/effectsPlayer';
import { simWorkerDefault } from '../systemMemory';
import { applyMusicSettings } from '../audio/musicPlayer'; // [audio]
import { sanitizeOverrides } from './keyBindingModel';

/** One entry of the persisted settings blob. */
export interface UiSettings {
    /** Music volume, 0..1 (MusicPlayer.setVolume range). */
    musicVolume: number;
    /** Music muted flag (MusicPlayer.mute/unmute). */
    musicMuted: boolean;
    /** Sound effects volume, 0..1 (EffectsPlayer.setVolume range). */
    soundVolume: number;
    /** Sound effects muted flag (EffectsPlayer.mute/unmute). */
    soundMuted: boolean;
    /** UI scale percentage applied as `--ui-scale` on the HUD root. */
    uiScale: number;
    /** Show system name labels on the map (mainView.ts reads per frame). */
    showSystemNames: boolean;
    /** Show region label overlays on the map (mainView.ts reads per frame). */
    showRegionLabels: boolean;
    // [advisor] begin — 18a chat advisor: a local OpenAI-compatible / Ollama chat endpoint (off unless it responds).
    /** Base URL of the model server (Ollama default port; llama-server usually :8080). */
    advisorEndpoint: string;
    /** Model name sent with each request. */
    advisorModel: string;
    /** Wire protocol: Ollama /api/chat, OpenAI /v1/chat/completions, or detect on first use. */
    advisorApi: 'auto' | 'ollama' | 'openai';
    /** Let a thinking model reason first (Ollama `think`): better at "the most distant …" style orders, ~10x slower. */
    advisorThink: boolean;
    // [aiadvisor] begin — 18c: the same model makes strategic choices for AI empires (off by default).
    /** Let the model decide AI empires' strategic choices (war, treaties, tech emphasis, policy) every few game-days. */
    aiAdvisor: boolean;
    /** Game-days between two decision rounds (star-date days: 30 per month). */
    aiAdvisorIntervalDays: number;
    /** Which AI empires: only those the player has met, or all. */
    aiAdvisorEmpires: 'met' | 'all';
    /** At most this many empires per round. */
    aiAdvisorMaxEmpires: number;
    // [aiadvisor] end
    // [advisor] end

    // [diplovoice] begin — 18b: AI empires' diplomatic replies voiced by the same local model (off unless it answers).
    diplomatVoice: boolean;
    // [diplovoice] end

    // [popupstubs] begin — messages first appear as stubs under the top-right panel.
    /** Open the popup card by itself when a message arrives (the 16d behaviour); off: only the stub. */
    openMessagesAutomatically: boolean;
    /** Stubs shown at once (1..6); the rest scroll. */
    messageStubsVisible: number;
    // [popupstubs] end

    // [leftovers] begin — GameOptions.AutoSaveInterval (GameOptions.cs:240): 0 = off, else minutes (10-60, Main.InitializeComponent.cs:10739-10744).
    /** chkOptionsAutoSave. */
    autoSave: boolean;
    /** numOptionsAutoSaveMinutes. */
    autoSaveMinutes: number;
    // [leftovers] end

    // [freightOverlay] begin — task 19e-9: Overlays → Freight Flows starts on in new / loaded games.
    freightFlowsDefault: boolean;
    // [freightOverlay] end

    /** Dither the map's output (render/outputDither.ts): removes banding in dark gradients on 8-bit canvases. */
    ditherGradients: boolean;
    /** Cosmetic (not in the original): draw stations pulled in toward their planet's / moon's centre. */
    pullStationsToCentre: boolean;
    /** Bacon mod (BaconMain.cs 442 DrawWeaponRanges, opt-in like its showRangeCircles / "!rangecircles"): weapon-range
     *  circles around the selected ship (render/weaponRangeCircles.ts). */
    showWeaponRangeCircles: boolean;

    /** GameOptions.AutoPauseWhenInPopupWindow (default true, Main.Part9.cs:2714): pause a running game while a screen window is open. */
    autoPauseInPopup: boolean;

    // [improvements] begin — the DW2-inspired additions (src/ui/improvements.ts): on / off per improvement id. A missing
    // id takes the improvement's default.
    improvements: Record<string, boolean>;
    /** supplyChain: the Supply Shortages overlay also marks colonies short of luxuries (its "…" panel). */
    supplyShowColonyShortages: boolean;
    // [improvements] end

    /** Run the simulation in a Web Worker (docs/sim-worker.md; the default). Off: the in-thread fallback, the sim on the
     *  main thread as before. Applies to the next game started or loaded; `?simWorker=1|0` overrides. */
    simWorker: boolean;

    // [galaxymarkers] begin — GameOptions.GalaxyViewDisplay* (GameOptions.cs 74-96, "Galaxy View - Ship Display"):
    // which ship/base types the galaxy view shows beyond zoom factor 3500 (MainView.2.cs method_250).
    galaxyViewDisplayFleets: boolean;
    galaxyViewDisplayResupplyShips: boolean;
    galaxyViewDisplayMilitaryShips: boolean;
    galaxyViewDisplaySpacePorts: boolean;
    galaxyViewDisplayOtherBases: boolean;
    galaxyViewDisplayExplorationShips: boolean;
    galaxyViewDisplayColonyShips: boolean;
    galaxyViewDisplayConstructionShips: boolean;
    galaxyViewDisplayCivilianShips: boolean;
    galaxyViewDisplayAlwaysEnemyFleets: boolean;
    galaxyViewDisplayAlwaysEnemyMilitaryShips: boolean;
    galaxyViewDisplayAlwaysPirates: boolean;
    // [galaxymarkers] end
    /** GameOptions.CleanGalaxyView (Expanded's "Clean Galaxy view", Start.1.cs 2935 / 3001, default off): the galaxy
     *  view without the sector grid, system rings, names and link lines (render/cleanGalaxyView.ts). */
    cleanGalaxyView: boolean;

    // [gameoptions] begin — the Game Options screen's view / display options (Main.Part6.cs:2491-2515 method_418,
    // Main.Part4.cs:4690-4712 method_569; defaults Main.Part9.cs:2774-2807 method_260). UI-only: none reaches the sim.
    /** Game.MainViewScrollSpeed (sldOptionsMainViewScrollSpeed 1..100, default 10): edge / arrow-key scroll speed. */
    mainViewScrollSpeed: number;
    /** Game.MainViewZoomSpeed (sldOptionsMainViewZoomSpeed 1..100, default 12): percent per wheel notch. */
    mainViewZoomSpeed: number;
    /** Game.MouseScrollWheelBehaviour (cmbOptionsMouseScrollWheelBehaviour): 0 no movement, 1 move to the selected
     *  item, 2 move to the mouse cursor (default). */
    mouseScrollWheelBehaviour: number;
    /** Game.StarFieldSize (sldOptionsMainViewStarFieldSize "Star Density" 50..2000, default 1000). */
    starFieldSize: number;
    /** GameOptions.ShowSystemNebulae (chkOptionsShowSystemNebulae, default true). */
    showSystemNebulae: boolean;
    /** GameOptions.SystemNebulaeDetail (tbarGameOptionsAdvancedDisplaySettingsSystemNebulaeDetail 0 Low .. 2 High, default 0). */
    systemNebulaeDetail: number;
    /** GameOptions.MaximumFramerate (-1 = Unlimited, the default; else numGameOptionsAdvancedDisplaySettingsMaximumFramerate 10..100). */
    maximumFramerate: number;
    /** GameOptions.LoadedGamesPaused (chkOptionsLoadedGamesPaused, default true; Main.Part7.cs:4056). */
    loadedGamesPaused: boolean;
    /** MessageBoxExManager saved responses of the automation prompts ("Don't ask me again"), by task: true = turn
     *  automation off, false = leave it on. Cleared by Game Options → Reset Warnings (Main.Part5.cs:2051). */
    automationPromptResponses: Record<string, boolean>;
    /** GameOptions (the "defaultOptions" file, Main.Part9.cs:2510 method_257): the player empire's automation /
     *  engagement / discovery settings saved when the in-game Options window closes (Main.Part6.cs:2540 YxwyUefOyQ),
     *  copied onto the player of the next new game (Start.2.cs 1352-1363, 2122-2146). Keys are sim/game.ts
     *  GameOptionsAutomation's; screens/gameOptionsModel.ts newGameOptionsFromSettings validates them. null = the
     *  method_260 defaults. */
    newGameOptions: Record<string, number | boolean> | null;
    // [gameoptions] end

    /** GameOptions.CustomizationSetName (GameOptions.cs 258): the theme chosen on the Change Theme panel (Start.cs
     *  method_2), "" = the stock game. */
    customizationSet: string;

    /** Hotkeys screen (Bacon mod HotKeys/HotKeyManager.cs): the rows the player remapped, by row id (keyBindingModel.ts). */
    keyBindingOverrides: Record<string, { key: string; ctrl: boolean; alt: boolean; shift: boolean }>;
}

/** [galaxymarkers] The GalaxyViewDisplay* keys, in the original's option order. */
export const GALAXY_VIEW_DISPLAY_KEYS = [
    'galaxyViewDisplayFleets',
    'galaxyViewDisplayResupplyShips',
    'galaxyViewDisplayMilitaryShips',
    'galaxyViewDisplaySpacePorts',
    'galaxyViewDisplayOtherBases',
    'galaxyViewDisplayExplorationShips',
    'galaxyViewDisplayColonyShips',
    'galaxyViewDisplayConstructionShips',
    'galaxyViewDisplayCivilianShips',
    'galaxyViewDisplayAlwaysEnemyFleets',
    'galaxyViewDisplayAlwaysEnemyMilitaryShips',
    'galaxyViewDisplayAlwaysPirates',
] as const;
export type GalaxyViewDisplayKey = (typeof GALAXY_VIEW_DISPLAY_KEYS)[number];

const STORAGE_KEY = 'dwu-ui-settings';

/** Default values when nothing has been stored yet. */
export const DEFAULT_SETTINGS: UiSettings = {
    musicVolume: 0.5,
    musicMuted: false,
    // Matches EffectsPlayer's default master volume (double_0 = 0.7).
    soundVolume: 0.7,
    soundMuted: false,
    uiScale: 100,
    showSystemNames: true,
    showRegionLabels: false,
    // [advisor] begin
    advisorEndpoint: 'http://127.0.0.1:11434',
    advisorModel: 'qwen3:4b',
    advisorApi: 'auto',
    advisorThink: false,
    // [aiadvisor] begin
    aiAdvisor: false,
    aiAdvisorIntervalDays: 30,
    aiAdvisorEmpires: 'met',
    aiAdvisorMaxEmpires: 4,
    // [aiadvisor] end
    // [advisor] end

    // [diplovoice] begin
    diplomatVoice: true,
    // [diplovoice] end

    // [popupstubs] begin
    openMessagesAutomatically: false,
    messageStubsVisible: 6,
    // [popupstubs] end

    // [leftovers] begin — Main.Part9.cs:2781 default AutoSaveInterval = 30.
    autoSave: true,
    autoSaveMinutes: 30,
    // [leftovers] end

    // [freightOverlay] begin
    freightFlowsDefault: false,
    // [freightOverlay] end

    ditherGradients: true,
    pullStationsToCentre: false,
    showWeaponRangeCircles: false,
    autoPauseInPopup: true,
    improvements: {}, // [improvements]
    supplyShowColonyShortages: true, // [improvements] supplyChain
    // On by default only with 16 GB+ of RAM (src/systemMemory.ts): on an 8 GB Mac the replica's extra memory caused severe
    // slowdown and WebGL context loss (2026-10-04); see docs/sim-worker.md §6.
    simWorker: simWorkerDefault(),

    // [galaxymarkers] begin — GameOptions.cs 74-96 / Main.Part9.cs 2793-2804: all on except civilian ships.
    galaxyViewDisplayFleets: true,
    galaxyViewDisplayResupplyShips: true,
    galaxyViewDisplayMilitaryShips: true,
    galaxyViewDisplaySpacePorts: true,
    galaxyViewDisplayOtherBases: true,
    galaxyViewDisplayExplorationShips: true,
    galaxyViewDisplayColonyShips: true,
    galaxyViewDisplayConstructionShips: true,
    galaxyViewDisplayCivilianShips: false,
    galaxyViewDisplayAlwaysEnemyFleets: true,
    galaxyViewDisplayAlwaysEnemyMilitaryShips: true,
    galaxyViewDisplayAlwaysPirates: true,
    // [galaxymarkers] end
    cleanGalaxyView: false,

    // [gameoptions] begin — Main.Part9.cs:2774-2807 method_260; GameOptions.cs _MaximumFramerate = -1, _SystemNebulaeDetail = 0.
    mainViewScrollSpeed: 10,
    mainViewZoomSpeed: 12,
    mouseScrollWheelBehaviour: 2,
    starFieldSize: 1000,
    showSystemNebulae: true,
    systemNebulaeDetail: 0,
    maximumFramerate: -1,
    loadedGamesPaused: true,
    automationPromptResponses: {},
    newGameOptions: null,
    customizationSet: '',
    keyBindingOverrides: {},
    // [gameoptions] end
};

/** Minimal storage shape (localStorage-compatible). */
export interface SettingsStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

/** The browser's localStorage, or null in node-based test environments. */
function defaultStorage(): SettingsStorage | null {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
}

let storage: SettingsStorage | null = defaultStorage();

/** Override the storage backend (tests); pass null to restore the default. */
export function setSettingsStorage(s: SettingsStorage | null): void {
    storage = s ?? defaultStorage();
}

/** Load the current settings from storage, falling back to defaults for any
 * missing/invalid fields. */
export function loadSettings(): UiSettings {
    const out: UiSettings = { ...DEFAULT_SETTINGS };
    const raw = storage?.getItem(STORAGE_KEY) ?? null;
    if (raw === null) return out;
    try {
        const parsed = JSON.parse(raw) as Partial<UiSettings>;
        if (typeof parsed.musicVolume === 'number' && Number.isFinite(parsed.musicVolume)) {
            out.musicVolume = Math.min(1, Math.max(0, parsed.musicVolume));
        }
        if (typeof parsed.musicMuted === 'boolean') out.musicMuted = parsed.musicMuted;
        if (typeof parsed.soundVolume === 'number' && Number.isFinite(parsed.soundVolume)) {
            out.soundVolume = Math.min(1, Math.max(0, parsed.soundVolume));
        }
        if (typeof parsed.soundMuted === 'boolean') out.soundMuted = parsed.soundMuted;
        if (typeof parsed.uiScale === 'number' && Number.isFinite(parsed.uiScale)) {
            out.uiScale = Math.min(200, Math.max(50, parsed.uiScale));
        }
        if (typeof parsed.showSystemNames === 'boolean') out.showSystemNames = parsed.showSystemNames;
        if (typeof parsed.showRegionLabels === 'boolean') out.showRegionLabels = parsed.showRegionLabels;
        // [advisor] begin
        if (typeof parsed.advisorEndpoint === 'string' && parsed.advisorEndpoint.trim() !== '') out.advisorEndpoint = parsed.advisorEndpoint.trim();
        if (typeof parsed.advisorModel === 'string' && parsed.advisorModel.trim() !== '') out.advisorModel = parsed.advisorModel.trim();
        if (parsed.advisorApi === 'auto' || parsed.advisorApi === 'ollama' || parsed.advisorApi === 'openai') out.advisorApi = parsed.advisorApi;
        if (typeof parsed.advisorThink === 'boolean') out.advisorThink = parsed.advisorThink;
        // [aiadvisor] begin
        if (typeof parsed.aiAdvisor === 'boolean') out.aiAdvisor = parsed.aiAdvisor;
        if (typeof parsed.aiAdvisorIntervalDays === 'number' && Number.isFinite(parsed.aiAdvisorIntervalDays)) out.aiAdvisorIntervalDays = Math.min(3600, Math.max(1, Math.round(parsed.aiAdvisorIntervalDays)));
        if (parsed.aiAdvisorEmpires === 'met' || parsed.aiAdvisorEmpires === 'all') out.aiAdvisorEmpires = parsed.aiAdvisorEmpires;
        if (typeof parsed.aiAdvisorMaxEmpires === 'number' && Number.isFinite(parsed.aiAdvisorMaxEmpires)) out.aiAdvisorMaxEmpires = Math.min(16, Math.max(1, Math.round(parsed.aiAdvisorMaxEmpires)));
        // [aiadvisor] end
        // [advisor] end

        // [diplovoice] begin
        if (typeof parsed.diplomatVoice === 'boolean') out.diplomatVoice = parsed.diplomatVoice;
        // [diplovoice] end

        // [popupstubs] begin
        if (typeof parsed.openMessagesAutomatically === 'boolean') out.openMessagesAutomatically = parsed.openMessagesAutomatically;
        if (typeof parsed.messageStubsVisible === 'number' && Number.isFinite(parsed.messageStubsVisible)) {
            out.messageStubsVisible = Math.min(6, Math.max(1, Math.round(parsed.messageStubsVisible)));
        }
        // [popupstubs] end

        // [leftovers] begin
        if (typeof parsed.autoSave === 'boolean') out.autoSave = parsed.autoSave;
        if (typeof parsed.autoSaveMinutes === 'number' && Number.isFinite(parsed.autoSaveMinutes)) out.autoSaveMinutes = clampAutoSaveMinutes(parsed.autoSaveMinutes);
        // [leftovers] end

        // [freightOverlay] begin
        if (typeof parsed.freightFlowsDefault === 'boolean') out.freightFlowsDefault = parsed.freightFlowsDefault;
        // [freightOverlay] end
        if (typeof parsed.ditherGradients === 'boolean') out.ditherGradients = parsed.ditherGradients;
        if (typeof parsed.pullStationsToCentre === 'boolean') out.pullStationsToCentre = parsed.pullStationsToCentre;
        if (typeof parsed.cleanGalaxyView === 'boolean') out.cleanGalaxyView = parsed.cleanGalaxyView;
        if (typeof parsed.showWeaponRangeCircles === 'boolean') out.showWeaponRangeCircles = parsed.showWeaponRangeCircles;
        if (typeof parsed.autoPauseInPopup === 'boolean') out.autoPauseInPopup = parsed.autoPauseInPopup;
        // [improvements] begin
        if (parsed.improvements !== null && typeof parsed.improvements === 'object' && !Array.isArray(parsed.improvements)) {
            const m: Record<string, boolean> = {};
            for (const [k, v] of Object.entries(parsed.improvements as Record<string, unknown>)) if (typeof v === 'boolean') m[k] = v;
            out.improvements = m;
        }
        if (typeof parsed.supplyShowColonyShortages === 'boolean') out.supplyShowColonyShortages = parsed.supplyShowColonyShortages;
        // [improvements] end
        // The worker became the default with SIM_WORKER_SETTING_VERSION 2: a stored value from before (the old default
        // `false`, written with every other setting) is not the player's choice and is ignored.
        if (typeof parsed.simWorker === 'boolean' && (parsed as { simWorkerVersion?: unknown }).simWorkerVersion === SIM_WORKER_SETTING_VERSION) out.simWorker = parsed.simWorker;
        // [galaxymarkers] begin
        for (const k of GALAXY_VIEW_DISPLAY_KEYS) if (typeof parsed[k] === 'boolean') out[k] = parsed[k];
        // [galaxymarkers] end
        // [gameoptions] begin
        const int = (v: unknown, min: number, max: number): number | null =>
            typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : null;
        out.mainViewScrollSpeed = int(parsed.mainViewScrollSpeed, 1, 100) ?? out.mainViewScrollSpeed;
        out.mainViewZoomSpeed = int(parsed.mainViewZoomSpeed, 1, 100) ?? out.mainViewZoomSpeed;
        out.mouseScrollWheelBehaviour = int(parsed.mouseScrollWheelBehaviour, 0, 2) ?? out.mouseScrollWheelBehaviour;
        out.starFieldSize = int(parsed.starFieldSize, 50, 2000) ?? out.starFieldSize;
        if (typeof parsed.showSystemNebulae === 'boolean') out.showSystemNebulae = parsed.showSystemNebulae;
        out.systemNebulaeDetail = int(parsed.systemNebulaeDetail, 0, 2) ?? out.systemNebulaeDetail;
        const fps = int(parsed.maximumFramerate, -1, 100);
        if (fps !== null) out.maximumFramerate = clampMaximumFramerate(fps);
        if (typeof parsed.loadedGamesPaused === 'boolean') out.loadedGamesPaused = parsed.loadedGamesPaused;
        if (parsed.automationPromptResponses !== null && typeof parsed.automationPromptResponses === 'object') {
            const r: Record<string, boolean> = {};
            for (const [k, v] of Object.entries(parsed.automationPromptResponses)) if (typeof v === 'boolean') r[k] = v;
            out.automationPromptResponses = r;
        }
        if (parsed.newGameOptions !== null && typeof parsed.newGameOptions === 'object' && !Array.isArray(parsed.newGameOptions)) {
            const o: Record<string, number | boolean> = {};
            for (const [k, v] of Object.entries(parsed.newGameOptions)) if (typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) o[k] = v;
            out.newGameOptions = o;
        }
        // [gameoptions] end
        if (typeof parsed.customizationSet === 'string') out.customizationSet = parsed.customizationSet;
        out.keyBindingOverrides = sanitizeOverrides(parsed.keyBindingOverrides);
    } catch {
        // Corrupt blob: keep the defaults.
    }
    return out;
}

// [gameoptions] begin
/** GameOptions.MaximumFramerate: <= 0 is Unlimited (-1); else numGameOptionsAdvancedDisplaySettingsMaximumFramerate's
 *  range 10..100 (Minimum 10, NumericUpDown's default Maximum 100; Main.Part4.cs:4667-4671 clamps to it). */
export function clampMaximumFramerate(v: number): number {
    if (!Number.isFinite(v) || v <= 0) return -1;
    return Math.min(100, Math.max(10, Math.round(v)));
}

/** The Pixi ticker's maxFPS for a MaximumFramerate setting (0 = uncapped). */
export function tickerMaxFps(maximumFramerate: number): number {
    return maximumFramerate > 0 ? clampMaximumFramerate(maximumFramerate) : 0;
}

/** Main.Part7.cs:4056-4063 (after loading a game): a paused game resumes unless LoadedGamesPaused, a running one pauses
 *  when it is set — the loaded game is paused exactly when the option is on. */
export function loadedGamePaused(_savedPaused: boolean, loadedGamesPaused: boolean): boolean {
    return loadedGamesPaused;
}

/** MessageBoxEx.UseSavedResponse for an automation prompt: the remembered answer, or null to ask. */
export function savedAutomationResponse(task: string): boolean | null {
    const r = getSettings().automationPromptResponses[task];
    return typeof r === 'boolean' ? r : null;
}

/** "Don't ask me again": remember the answer to `task`'s automation prompt. */
export function saveAutomationResponse(task: string, off: boolean): void {
    updateSettings({ automationPromptResponses: { ...getSettings().automationPromptResponses, [task]: off } });
}

/** Main.Part5.cs:2051 btnGameOptionsResetAutomationMessages_Click: MessageBoxExManager.ResetAllSavedResponses(). */
export function resetAutomationResponses(): void {
    updateSettings({ automationPromptResponses: {} });
}
// [gameoptions] end

// [leftovers] begin
/** numOptionsAutoSaveMinutes range (Main.InitializeComponent.cs:10739-10740: 10..60) and Math.Max(10, …) (Main.Part6.cs:2595). */
export function clampAutoSaveMinutes(v: number): number {
    return Math.min(60, Math.max(10, Math.round(v)));
}
// [leftovers] end

/** Persist the given settings to storage. */
export function saveSettings(settings: UiSettings): void {
    storage?.setItem(STORAGE_KEY, JSON.stringify({ ...settings, simWorkerVersion: SIM_WORKER_SETTING_VERSION }));
}

/** Stored next to `simWorker` (loadSettings): 2 = saved while the worker was the default, 3 = saved since the default
 *  depends on the machine's RAM (values stored under 1-2 are ignored, so everyone gets the RAM-based default). */
export const SIM_WORKER_SETTING_VERSION = 3;

/** Current in-memory copy of the settings (loaded once at first use). */
let current: UiSettings | null = null;

/** The live settings object; lazily loaded from storage on first access. */
export function getSettings(): UiSettings {
    if (current === null) {
        current = loadSettings();
    }
    return current;
}

/** Update one or more fields and persist the result. Returns the new state. */
export function updateSettings(patch: Partial<UiSettings>): UiSettings {
    const next: UiSettings = { ...getSettings(), ...patch };
    if (next.musicVolume < 0 || next.musicVolume > 1) {
        next.musicVolume = Math.min(1, Math.max(0, next.musicVolume));
    }
    if (next.soundVolume < 0 || next.soundVolume > 1) {
        next.soundVolume = Math.min(1, Math.max(0, next.soundVolume));
    }
    current = next;
    saveSettings(next);
    applySoundSettings(next);
    notifySettingsListeners(next);
    return next;
}

// ---------------------------------------------------------------------------
// Change notifications (task 10f): subscribers are told about every settings
// change so the HUD (UI scale) and other systems can react immediately. The
// Main View renderer reads its flags per frame instead of subscribing.
// ---------------------------------------------------------------------------

type SettingsListener = (settings: UiSettings) => void;

const settingsListeners: SettingsListener[] = [];

/** Register a callback fired after any settings change (i.e. after
 * {@link updateSettings} has applied and persisted the new state). Returns
 * an unsubscribe function. */
export function onSettingsChange(cb: SettingsListener): () => void {
    settingsListeners.push(cb);
    return () => {
        const i = settingsListeners.indexOf(cb);
        if (i >= 0) settingsListeners.splice(i, 1);
    };
}

/** Test hook: drop all registered listeners. */
export function clearSettingsListeners(): void {
    settingsListeners.length = 0;
}

function notifySettingsListeners(s: UiSettings): void {
    for (const cb of settingsListeners) {
        try {
            cb(s);
        } catch {
            // A broken listener must never break a settings change.
        }
    }
}

/** Push the sound settings into the live effects player. Best-effort: the
 * player may not exist yet (no HUD created), and it is a no-op before the
 * first user gesture creates its AudioContext. */
function applySoundSettings(s: UiSettings): void {
    try {
        const p = startEffects();
        p.setVolume(s.soundVolume);
        if (s.soundMuted) p.mute();
        else p.unmute();
    } catch {
        // Audio must never break a settings change.
    }
    // [audio] begin — the music volume / mute apply to musicPlayer_0 and musicPlayer_1 (Main.Part9.cs:2816 SetVolume(MusicVolume)).
    try {
        applyMusicSettings(s.musicVolume, s.musicMuted);
    } catch {
        // Audio must never break a settings change.
    }
    // [audio] end
}

// ---------------------------------------------------------------------------
// Getters the Main View renderer reads per frame (task 10f: consumed by
// src/render/mainView.ts for system-name and region-label visibility).
// ---------------------------------------------------------------------------

/** Whether system name labels should be drawn on the map. */
export function showSystemNames(): boolean {
    return getSettings().showSystemNames;
}

/** Whether region label overlays should be drawn on the map. */
export function showRegionLabels(): boolean {
    return getSettings().showRegionLabels;
}

/** UI scale as a CSS custom-property value (e.g. `1.25` for 125%). */
export function uiScaleFactor(): number {
    return getSettings().uiScale / 100;
}

/** Sound effects volume, 0..1 (EffectsPlayer range). */
export function soundVolume(): number {
    return getSettings().soundVolume;
}

/** Whether sound effects are muted. */
export function soundMuted(): boolean {
    return getSettings().soundMuted;
}