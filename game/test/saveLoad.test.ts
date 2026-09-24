// Task 11a3: unit tests for the pure save-index helpers in
// src/ui/screens/saveLoad.ts, using a fake Map-backed SaveStorage (no DOM).
import { describe, it, expect } from 'vitest';
import {
    SAVE_INDEX_KEY,
    SAVE_KEY_PREFIX,
    readSaveIndex,
    writeSaveIndex,
    writeSaveIndexEntry,
    storeSave,
    deleteSave,
    parseSaveFileText,
    createMemorySaveStore,
    type SaveStorage,
} from '../src/ui/screens/saveLoad';

/** Minimal in-memory SaveStorage (localStorage-compatible subset). */
class FakeStorage implements SaveStorage {
    private map = new Map<string, string>();
    getItem(key: string): string | null {
        return this.map.has(key) ? (this.map.get(key) as string) : null;
    }
    setItem(key: string, value: string): void {
        this.map.set(key, value);
    }
    removeItem(key: string): void {
        this.map.delete(key);
    }
}

describe('readSaveIndex', () => {
    it('returns [] when no index is stored', () => {
        const storage = new FakeStorage();
        expect(readSaveIndex(storage)).toEqual([]);
    });

    it('returns [] for a corrupt (non-JSON) index', () => {
        const storage = new FakeStorage();
        storage.setItem(SAVE_INDEX_KEY, '{not json');
        expect(readSaveIndex(storage)).toEqual([]);
    });

    it('returns [] when the index is not an array', () => {
        const storage = new FakeStorage();
        storage.setItem(SAVE_INDEX_KEY, JSON.stringify({ name: 'x' }));
        expect(readSaveIndex(storage)).toEqual([]);
    });

    it('keeps only entries with a string name', () => {
        const storage = new FakeStorage();
        storage.setItem(
            SAVE_INDEX_KEY,
            JSON.stringify([{ name: 'a', date: 'd1' }, { date: 'd2' }, null, { name: 'b', date: 'd3' }]),
        );
        expect(readSaveIndex(storage)).toEqual([
            { name: 'a', date: 'd1' },
            { name: 'b', date: 'd3' },
        ]);
    });

    it('round-trips through writeSaveIndex', () => {
        const storage = new FakeStorage();
        const entries = [
            { name: 'one', date: '2026-09-24T00:00:00.000Z' },
            { name: 'two', date: '2026-09-25T00:00:00.000Z' },
        ];
        writeSaveIndex(storage, entries);
        expect(readSaveIndex(storage)).toEqual(entries);
    });
});

describe('storeSave', () => {
    it('writes the save key and an index entry', () => {
        const storage = new FakeStorage();
        storeSave(storage, 'alpha', '{"v":1}', '2026-09-24T10:00:00.000Z');
        expect(storage.getItem(SAVE_KEY_PREFIX + 'alpha')).toBe('{"v":1}');
        expect(readSaveIndex(storage)).toEqual([{ name: 'alpha', date: '2026-09-24T10:00:00.000Z' }]);
    });

    it('puts newer saves first', () => {
        const storage = new FakeStorage();
        storeSave(storage, 'first', 't1', '2026-09-24T09:00:00.000Z');
        storeSave(storage, 'second', 't2', '2026-09-24T10:00:00.000Z');
        expect(readSaveIndex(storage).map((e) => e.name)).toEqual(['second', 'first']);
    });

    it('replaces the entry (and text) of an existing name without duplicating', () => {
        const storage = new FakeStorage();
        storeSave(storage, 'alpha', 'old', '2026-09-24T09:00:00.000Z');
        storeSave(storage, 'beta', 'b', '2026-09-24T09:30:00.000Z');
        storeSave(storage, 'alpha', 'new', '2026-09-24T10:00:00.000Z');
        const entries = readSaveIndex(storage);
        expect(entries.map((e) => e.name)).toEqual(['alpha', 'beta']);
        expect(storage.getItem(SAVE_KEY_PREFIX + 'alpha')).toBe('new');
        expect(entries[0].date).toBe('2026-09-24T10:00:00.000Z');
    });
});

describe('deleteSave', () => {
    it('removes the save key and its index entry', () => {
        const storage = new FakeStorage();
        storeSave(storage, 'alpha', 't', 'd1');
        storeSave(storage, 'beta', 'u', 'd2');
        expect(deleteSave(storage, 'alpha')).toBe(true);
        expect(storage.getItem(SAVE_KEY_PREFIX + 'alpha')).toBeNull();
        expect(readSaveIndex(storage).map((e) => e.name)).toEqual(['beta']);
    });

    it('returns false when the name is unknown', () => {
        const storage = new FakeStorage();
        storeSave(storage, 'alpha', 't', 'd1');
        expect(deleteSave(storage, 'nope')).toBe(false);
        // The index is untouched.
        expect(readSaveIndex(storage).map((e) => e.name)).toEqual(['alpha']);
    });
});

describe('createMemorySaveStore', () => {
    it('round-trips put/get/delete', async () => {
        const store = createMemorySaveStore();
        expect(await store.get('alpha')).toBeNull();
        await store.put('alpha', '{"v":1}');
        expect(await store.get('alpha')).toBe('{"v":1}');
        // A second put replaces the text.
        await store.put('alpha', '{"v":2}');
        expect(await store.get('alpha')).toBe('{"v":2}');
        await store.delete('alpha');
        expect(await store.get('alpha')).toBeNull();
        // Deleting an unknown name is a no-op.
        await store.delete('nope');
    });

    it('keeps entries independent per name', async () => {
        const store = createMemorySaveStore();
        await store.put('a', 'ta');
        await store.put('b', 'tb');
        expect(await store.get('a')).toBe('ta');
        expect(await store.get('b')).toBe('tb');
        await store.delete('a');
        expect(await store.get('b')).toBe('tb');
    });
});

describe('writeSaveIndexEntry', () => {
    it('puts the newest entry first', () => {
        const storage = new FakeStorage();
        writeSaveIndexEntry(storage, 'first', '2026-09-24T09:00:00.000Z');
        writeSaveIndexEntry(storage, 'second', '2026-09-24T10:00:00.000Z');
        expect(readSaveIndex(storage).map((e) => e.name)).toEqual(['second', 'first']);
    });

    it('replaces a same-name entry without duplicating', () => {
        const storage = new FakeStorage();
        writeSaveIndexEntry(storage, 'alpha', '2026-09-24T09:00:00.000Z');
        writeSaveIndexEntry(storage, 'beta', '2026-09-24T09:30:00.000Z');
        writeSaveIndexEntry(storage, 'alpha', '2026-09-24T10:00:00.000Z');
        const entries = readSaveIndex(storage);
        expect(entries.map((e) => e.name)).toEqual(['alpha', 'beta']);
        expect(entries[0].date).toBe('2026-09-24T10:00:00.000Z');
    });
});

describe('parseSaveFileText', () => {
    it('passes valid JSON through to the loader', () => {
        const loaded = { game: 'g', time: 't', startOptions: 'o' };
        const result = parseSaveFileText('{"version":1}', (text) => {
            expect(text).toBe('{"version":1}');
            return loaded;
        });
        expect(result).toBe(loaded);
    });

    it('throws on non-JSON text before calling the loader', () => {
        let called = false;
        expect(() => parseSaveFileText('not json', () => (called = true, { game: null, time: null, startOptions: null }))).toThrow();
        expect(called).toBe(false);
    });
});