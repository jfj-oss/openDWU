// UI settings (task 10c): a small persisted state object for the in-game
// Options sub-panel. Values live in localStorage under one JSON key so they
// survive reloads; getters let the renderer read them later (TODO wiring).
// The storage backend is injectable so node-based tests can run without a
// real localStorage.

import { startEffects } from '../audio/effectsPlayer';

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
}

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
            out.uiScale = parsed.uiScale;
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
    } catch {
        // Corrupt blob: keep the defaults.
    }
    return out;
}

/** Persist the given settings to storage. */
export function saveSettings(settings: UiSettings): void {
    storage?.setItem(STORAGE_KEY, JSON.stringify(settings));
}

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