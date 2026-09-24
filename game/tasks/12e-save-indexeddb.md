# Task 12e — Persist saves in IndexedDB (localStorage quota is too small)

thinking: off
scope: locked

Edit only `src/ui/screens/saveLoad.ts` and `test/saveLoad.test.ts`. Start editing right away.

A serialized game is bigger than the ~5 MB localStorage quota. Today `doSave` catches the QuotaExceededError and keeps the save in the in-memory `memorySaves` map, so it is lost when the app restarts. Move save *texts* to IndexedDB. The small index (`SAVE_INDEX_KEY`, a list of {name, date}) stays in localStorage.

1. Add an async text store:
```ts
export interface SaveTextStore {
    get(name: string): Promise<string | null>;
    put(name: string, text: string): Promise<void>;
    delete(name: string): Promise<void>;
}
export function createIndexedDbSaveStore(dbName = 'dwu-saves'): SaveTextStore;  // object store 'saves', key = name
export function createMemorySaveStore(): SaveTextStore;                          // Map-backed, for tests and as fallback
```
   `createIndexedDbSaveStore` opens the DB lazily, on the first call (version 1, `onupgradeneeded` creates the 'saves' store). If `indexedDB` is undefined or open fails, every method falls back to an internal memory store and logs one `console.warn`.
2. Add `textStore?: SaveTextStore` to `SavePanelWiring`. The default is `createIndexedDbSaveStore()`, created once per module (lazily).
   - `doSave`: `await textStore.put(name, text)`, then write the index entry: storeSave's index part only. Split `storeSave` into `writeSaveIndexEntry(storage, name, date)` plus the text write.
     - Keep `storeSave` exported and working, because tests use it.
     - On put failure, keep the current memorySaves fallback and toast.
   - `saveTextFor(name)` becomes async: memorySaves first, then `textStore.get`, then (for old saves) `storage.getItem(SAVE_KEY_PREFIX + name)`.
   - `doLoadByName` and `doDelete` become async. Delete removes the name from the text store, the index and the old localStorage key.
   - Event handlers call them with `void`.
3. Tests, using `createMemorySaveStore()` and a fake SaveStorage (see the existing tests in test/saveLoad.test.ts for the fake). Test only the pure/async helpers, not the DOM:
   - put/get/delete round trip on the memory store;
   - `writeSaveIndexEntry` puts the newest entry first and replaces a same-name entry.

Run `npm run typecheck` && `npm test`, then append `## Worker report`.

## Worker report

Files changed:
- `src/ui/screens/saveLoad.ts`
- `test/saveLoad.test.ts`

Done:
- Added `SaveTextStore` interface plus `createIndexedDbSaveStore()` (lazy DB open, version 1, `onupgradeneeded` creates the 'saves' object store keyed by name; falls back to an internal memory store with a single `console.warn` when indexedDB is undefined or open fails) and `createMemorySaveStore()` (Map-backed).
- Default text store is created once per module lazily (`getDefaultTextStore`); `SavePanelWiring` gained `textStore?: SaveTextStore`.
- Split `storeSave` into `writeSaveIndexEntry(storage, name, date)` + the text write; `storeSave` is still exported and behaves as before.
- `doSave` now awaits `textStore.put(name, text)` then writes only the index entry; on failure it keeps the in-memory fallback and toast (message updated to "save storage unavailable").
- `saveTextFor` is async: memorySaves → text store → old localStorage key (pre-12e saves still load).
- `doLoadByName` and `doDelete` are async; delete removes the name from the text store, the index, and the old localStorage key. Event handlers call them with `void`.
- Tests: put/get/delete round trip (incl. replace + independence) on the memory store; `writeSaveIndexEntry` newest-first ordering and same-name replacement.

Verification: `npm run typecheck` passes; `npm test` — 596/596 tests pass (saveLoad file: 16/16).

Left undone / notes:
- Nothing. IndexedDB behavior itself is not unit-tested (no DOM in vitest here); the fallback path is exercised indirectly via the memory store. Old localStorage save texts remain readable but are not migrated into IndexedDB (they are removed on delete, which covers cleanup).
