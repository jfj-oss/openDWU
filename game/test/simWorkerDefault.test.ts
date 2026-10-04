// The sim worker's default depends on the machine's RAM (src/systemMemory.ts; docs/sim-worker.md §6). In node the RAM is
// unknown, so the default here is off: the setting's default, its migration from the experimental era
// (a stored `false` written with every other setting before the flip is not a choice), the in-thread fallback through
// the setting and through `?simWorker=0`.
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, SIM_WORKER_SETTING_VERSION, loadSettings, saveSettings, setSettingsStorage, type SettingsStorage } from '../src/ui/settings';
import { simWorkerEnabled } from '../src/simworker/workerClient';

function memoryStorage(init: Record<string, string> = {}): SettingsStorage & { data: Record<string, string> } {
    const data = { ...init };
    return {
        data,
        getItem: (k) => data[k] ?? null,
        setItem: (k, v) => void (data[k] = v),
        removeItem: (k) => void delete data[k],
    };
}

afterEach(() => setSettingsStorage(null));

describe('the sim worker setting', () => {
    it('the setting defaults to off', () => {
        expect(DEFAULT_SETTINGS.simWorker).toBe(false);
        setSettingsStorage(memoryStorage());
        expect(loadSettings().simWorker).toBe(false);
    });

    it('a value stored while the worker was the default (version 2) is ignored', () => {
        setSettingsStorage(memoryStorage({ 'dwu-ui-settings': JSON.stringify({ ...DEFAULT_SETTINGS, simWorker: true, simWorkerVersion: 2 }) }));
        expect(loadSettings().simWorker).toBe(false);
    });

    it('a value stored with no version is ignored', () => {
        setSettingsStorage(memoryStorage({ 'dwu-ui-settings': JSON.stringify({ ...DEFAULT_SETTINGS, simWorker: true, musicVolume: 0.3 }) }));
        const s = loadSettings();
        expect(s.simWorker).toBe(false);
        expect(s.musicVolume).toBe(0.3);
    });

    it('the player\'s choice is kept once saved', () => {
        const st = memoryStorage();
        setSettingsStorage(st);
        saveSettings({ ...DEFAULT_SETTINGS, simWorker: false });
        expect(JSON.parse(st.data['dwu-ui-settings']).simWorkerVersion).toBe(SIM_WORKER_SETTING_VERSION);
        expect(loadSettings().simWorker).toBe(false);
        saveSettings({ ...DEFAULT_SETTINGS, simWorker: true });
        expect(loadSettings().simWorker).toBe(true);
    });

    it('?simWorker=0|1 overrides the setting', () => {
        expect(simWorkerEnabled('', true)).toBe(true);
        expect(simWorkerEnabled('', false)).toBe(false);
        expect(simWorkerEnabled('?simWorker=0', true)).toBe(false);
        expect(simWorkerEnabled('?autostart=1&simWorker=false', true)).toBe(false);
        expect(simWorkerEnabled('?simWorker=1', false)).toBe(true);
    });
});
