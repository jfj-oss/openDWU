// Autosave (ui/autosave.ts): Main.Part12.cs:4013 method_97 — five rotating slots, the AutoSaveInterval timer,
// and the Game Options minutes range (10-60, default 30).
import { describe, expect, it } from 'vitest';
import { AUTOSAVE_SLOTS, autosaveIntervalMs, autosaveName, autosaveNow, isAutosaveDue, nextAutosaveSlot } from '../src/ui/autosave';
import { createMemorySaveStore, readSaveIndex, type SaveStorage } from '../src/ui/screens/saveLoad';
import { DEFAULT_SETTINGS, clampAutoSaveMinutes } from '../src/ui/settings';

function memoryStorage(): SaveStorage {
    const m = new Map<string, string>();
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

describe('autosave rotation', () => {
    it('cycles 1..5 and wraps', () => {
        expect(AUTOSAVE_SLOTS).toBe(5);
        const seq: number[] = [];
        let s = 0;
        for (let i = 0; i < 7; i++) seq.push((s = nextAutosaveSlot(s)));
        expect(seq).toEqual([1, 2, 3, 4, 5, 1, 2]);
        expect(autosaveName(3)).toBe('autosave-3');
    });

    it('writes to the store and the save index, overwriting the oldest slot', async () => {
        const storage = memoryStorage();
        const store = createMemorySaveStore();
        const names: (string | null)[] = [];
        for (let i = 0; i < 6; i++) names.push(await autosaveNow(() => `game ${i}`, storage, store, `2026-01-0${i + 1}T00:00:00.000Z`));
        expect(names).toEqual(['autosave-1', 'autosave-2', 'autosave-3', 'autosave-4', 'autosave-5', 'autosave-1']);
        const index = readSaveIndex(storage);
        expect(index.map((e) => e.name)).toEqual(['autosave-1', 'autosave-5', 'autosave-4', 'autosave-3', 'autosave-2']);
        expect(await store.get('autosave-1')).toBe('game 5');
        expect(await store.get('autosave-2')).toBe('game 1');
    });

    it('does nothing when there is nothing to save', async () => {
        expect(await autosaveNow(() => null, memoryStorage(), createMemorySaveStore(), '')).toBeNull();
    });
});

describe('autosave interval', () => {
    it('defaults to on, every 30 minutes', () => {
        expect(DEFAULT_SETTINGS.autoSave).toBe(true);
        expect(autosaveIntervalMs(DEFAULT_SETTINGS)).toBe(30 * 60000);
        expect(autosaveIntervalMs({ autoSave: false, autoSaveMinutes: 30 })).toBeNull();
    });
    it('is due only after the interval has passed', () => {
        expect(isAutosaveDue(1000 + 600000, 1000, 600000)).toBe(false);
        expect(isAutosaveDue(1001 + 600000, 1000, 600000)).toBe(true);
    });
    it('clamps the minutes to 10..60', () => {
        expect(clampAutoSaveMinutes(5)).toBe(10);
        expect(clampAutoSaveMinutes(45.4)).toBe(45);
        expect(clampAutoSaveMinutes(90)).toBe(60);
    });
});
