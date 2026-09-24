// UI settings (task 10c): a small persisted state object for the in-game
// Options sub-panel. Values live in localStorage under one JSON key so they
// survive reloads; getters let the renderer read them later (TODO wiring).
// The storage backend is injectable so node-based tests can run without a
// real localStorage.

/** One entry of the persisted settings blob. */
export interface UiSettings {
    /** Music volume, 0..1 (MusicPlayer.setVolume range). */
    musicVolume: number;
    /** Music muted flag (MusicPlayer.mute/unmute). */
    musicMuted: boolean;
    /** UI scale percentage applied as `--ui-scale` on the HUD root. */
    uiScale: number;
    /** Show system name labels on the map (renderer TODO). */
    showSystemNames: boolean;
    /** Show region label overlays on the map (renderer TODO). */
    showRegionLabels: boolean;
}

const STORAGE_KEY = 'dwu-ui-settings';

/** Default values when nothing has been stored yet. */
export const DEFAULT_SETTINGS: UiSettings = {
    musicVolume: 0.5,
    musicMuted: false,
    uiScale: 100,
    showSystemNames: true,
    showRegionLabels: false,
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
        if (typeof parsed.uiScale === 'number' && Number.isFinite(parsed.uiScale)) {
            out.uiScale = parsed.uiScale;
        }
        if (typeof parsed.showSystemNames === 'boolean') out.showSystemNames = parsed.showSystemNames;
        if (typeof parsed.showRegionLabels === 'boolean') out.showRegionLabels = parsed.showRegionLabels;
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
    current = next;
    saveSettings(next);
    return next;
}

// ---------------------------------------------------------------------------
// Getters the renderer can read later (TODO(port): consume these in the Main
// View label/overlay rendering — src/render/mainView.ts).
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