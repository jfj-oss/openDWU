// The sim worker is the default (docs/sim-worker.md §6): the setting's default, its migration from the experimental era
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

describe('the sim worker is the default', () => {
    it('the setting defaults to on', () => {
        expect(DEFAULT_SETTINGS.simWorker).toBe(true);
        setSettingsStorage(memoryStorage());
        expect(loadSettings().simWorker).toBe(true);
    });

    it('a value stored before the flip (no version: the old default) is ignored', () => {
        setSettingsStorage(memoryStorage({ 'dwu-ui-settings': JSON.stringify({ ...DEFAULT_SETTINGS, simWorker: false, musicVolume: 0.3 }) }));
        const s = loadSettings();
        expect(s.simWorker).toBe(true);
        expect(s.musicVolume).toBe(0.3);
    });

    it('the player turning it off is kept (the in-thread fallback)', () => {
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
