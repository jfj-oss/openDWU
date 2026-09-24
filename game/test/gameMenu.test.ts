import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GalaxyTime } from '../src/sim/clock';
import { buildOptionsPanel, pauseForMenu, restorePauseState } from '../src/ui/screens/gameMenu';
import {
    clearSettingsListeners,
    DEFAULT_SETTINGS,
    getSettings,
    loadSettings,
    onSettingsChange,
    setSettingsStorage,
    uiScaleFactor,
    updateSettings,
    type SettingsStorage,
} from '../src/ui/settings';

// Node-based tests (jsdom is not configured): the settings module takes an
// injectable storage backend and the pause helpers are pure over a real
// GalaxyTime, so both required behaviours run without a DOM.

/** In-memory localStorage stand-in for the settings persistence tests. */
function makeFakeStorage(): SettingsStorage & { map: Map<string, string> } {
    const map = new Map<string, string>();
    return {
        map,
        getItem: (key) => map.get(key) ?? null,
        setItem: (key, value) => {
            map.set(key, value);
        },
        removeItem: (key) => {
            map.delete(key);
        },
    };
}

describe('settings persist/restore (task 10c)', () => {
    let storage: ReturnType<typeof makeFakeStorage>;

    beforeEach(() => {
        storage = makeFakeStorage();
        setSettingsStorage(storage);
        clearSettingsListeners();
    });

    afterEach(() => {
        setSettingsStorage(null);
        clearSettingsListeners();
    });

    it('returns defaults when nothing has been stored', () => {
        expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    });

    it('persists updates and restores them on reload', () => {
        updateSettings({ musicVolume: 0.8, musicMuted: true, uiScale: 125, showRegionLabels: true });
        // A fresh read of the same storage sees the saved blob.
        expect(loadSettings()).toEqual({
            ...DEFAULT_SETTINGS,
            musicVolume: 0.8,
            musicMuted: true,
            uiScale: 125,
            showRegionLabels: true,
        });
    });

    it('clamps out-of-range music volume on save', () => {
        const next = updateSettings({ musicVolume: 3 });
        expect(next.musicVolume).toBe(1);
        expect(loadSettings().musicVolume).toBe(1);
    });

    it('falls back to defaults for a corrupt blob', () => {
        storage.setItem('dwu-ui-settings', '{not json');
        expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    });

    it('exposes renderer getters over the live state', () => {
        updateSettings({ uiScale: 110, showSystemNames: false });
        expect(uiScaleFactor()).toBeCloseTo(1.1);
        expect(getSettings().showSystemNames).toBe(false);
    });

    // Task 10f: subscribers are told about every settings change so the HUD
    // (UI scale) can react immediately.
    it('fires onSettingsChange after an update with the new state', () => {
        const seen: number[] = [];
        const off = onSettingsChange((s) => {
            seen.push(s.uiScale);
        });
        try {
            updateSettings({ uiScale: 90 });
            updateSettings({ uiScale: 125 });
            expect(seen).toEqual([90, 125]);
        } finally {
            off();
        }
    });

    it('stops notifying after unsubscribe', () => {
        let calls = 0;
        const off = onSettingsChange(() => {
            calls++;
        });
        updateSettings({ uiScale: 90 });
        off();
        updateSettings({ uiScale: 110 });
        expect(calls).toBe(1);
    });

    it('survives a listener that throws', () => {
        onSettingsChange(() => {
            throw new Error('broken');
        });
        let ok = false;
        const off = onSettingsChange(() => {
            ok = true;
        });
        try {
            expect(() => updateSettings({ uiScale: 90 })).not.toThrow();
            expect(ok).toBe(true);
        } finally {
            off();
        }
    });
});

describe('pause state restored on close (task 10c)', () => {
    it('pauses an unpaused game and restores it on close', () => {
        const clock = new GalaxyTime();
        clock.paused = false;
        const prevPaused = pauseForMenu(clock);
        expect(prevPaused).toBe(false);
        expect(clock.paused).toBe(true);
        restorePauseState(clock, prevPaused);
        expect(clock.paused).toBe(false);
    });

    it('keeps a paused game paused through open/close', () => {
        const clock = new GalaxyTime();
        clock.paused = true;
        const prevPaused = pauseForMenu(clock);
        expect(prevPaused).toBe(true);
        expect(clock.paused).toBe(true);
        restorePauseState(clock, prevPaused);
        expect(clock.paused).toBe(true);
    });
});

// Task 06k: buildOptionsPanel is shared with the main menu's Options modal.
// The DOM panel itself needs a browser (jsdom is not configured), so this
// exercises its pure settings wiring: the controls it builds read from and
// write to the same persisted settings the in-game Escape menu uses.
describe('buildOptionsPanel settings wiring (task 06k)', () => {
    let storage: ReturnType<typeof makeFakeStorage>;

    beforeEach(() => {
        storage = makeFakeStorage();
        setSettingsStorage(storage);
        clearSettingsListeners();
    });

    afterEach(() => {
        setSettingsStorage(null);
        clearSettingsListeners();
    });

    it('reflects the persisted music volume and mute state', () => {
        updateSettings({ musicVolume: 0.8, musicMuted: true });
        // The panel reads these values when built (verified via the same
        // getters the builder uses); here we assert the stored state the
        // controls would display.
        expect(getSettings().musicVolume).toBe(0.8);
        expect(getSettings().musicMuted).toBe(true);
    });

    it('offers the four UI scale steps the panel renders', () => {
        for (const pct of [90, 100, 110, 125]) {
            updateSettings({ uiScale: pct });
            expect(uiScaleFactor()).toBeCloseTo(pct / 100);
        }
    });

    it('persists label toggles the way the panel checkboxes do', () => {
        updateSettings({ showSystemNames: false, showRegionLabels: true });
        expect(loadSettings().showSystemNames).toBe(false);
        expect(loadSettings().showRegionLabels).toBe(true);
    });
});