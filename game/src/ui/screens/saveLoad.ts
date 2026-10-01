// Save/load part 3 (task 11a3): the Save Game / Load Game panels. The Escape
// menu's Save/Load buttons and the main menu's "Load Game" item open these;
// in src/main.ts a load goes through the shared startGameView(game).
//
// Storage: save *texts* live in an IndexedDB text store (createIndexedDbSaveStore,
// task 12e) because a serialized game exceeds the ~5 MB localStorage quota;
// 'dwu.saveIndex' is a small index of {name, date} entries in localStorage so
// the list can be shown without parsing every save. Saves written before 12e
// still live under localStorage['dwu.saves.' + name] and are read as a fallback.
// A save also carries its own savedAt timestamp inside the stored JSON.
// .dwusave files are plain-text exports/imports of that same JSON string
// (Blob download / <input type=file>).
import './saveLoad.css';

/** localStorage key prefix for one named save. */
export const SAVE_KEY_PREFIX = 'dwu.saves.';
/** localStorage key of the save index (array of SaveEntry). */
export const SAVE_INDEX_KEY = 'dwu.saveIndex';
/** File extension for downloaded/imported save files. */
export const SAVE_FILE_EXTENSION = '.dwusave';

/** Minimal string-keyed storage shape (localStorage-compatible subset). */
export interface SaveStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

/** One row of the save list. */
export interface SaveEntry {
    name: string;
    /** ISO date string (UTC) when the save was written. */
    date: string;
}

/** The three things a loaded game needs to boot through startGameView. */
export interface LoadedGame {
    game: unknown;
    time: unknown;
    startOptions: unknown;
}

// ---------------------------------------------------------------------------
// Pure save-index helpers (testable with an injected storage object).
// ---------------------------------------------------------------------------

/** Read the save index from storage (missing/corrupt → empty list). */
export function readSaveIndex(storage: SaveStorage): SaveEntry[] {
    try {
        const raw = storage.getItem(SAVE_INDEX_KEY);
        if (raw === null) return [];
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(
            (e): e is SaveEntry =>
                typeof e === 'object' && e !== null && typeof (e as SaveEntry).name === 'string',
        );
    } catch {
        return [];
    }
}

/** Write the save index back to storage. */
export function writeSaveIndex(storage: SaveStorage, entries: SaveEntry[]): void {
    storage.setItem(SAVE_INDEX_KEY, JSON.stringify(entries));
}

/** Add or replace the index entry for `name`, newest first (the save text
 * itself is written separately — see storeSave / SaveTextStore). */
export function writeSaveIndexEntry(storage: SaveStorage, name: string, date: string): void {
    const entries = readSaveIndex(storage).filter((e) => e.name !== name);
    entries.unshift({ name, date });
    writeSaveIndex(storage, entries);
}

/** Store `text` under `name`: writes the save key plus the index entry
 * (replacing any existing entry for the same name, newest first). Kept for
 * tests and pre-12e callers; the panel now writes the text via a SaveTextStore. */
export function storeSave(storage: SaveStorage, name: string, text: string, date: string): void {
    storage.setItem(SAVE_KEY_PREFIX + name, text);
    writeSaveIndexEntry(storage, name, date);
}

/** Remove the save key and its index entry (no-op when absent). Returns true
 * when something was removed. */
export function deleteSave(storage: SaveStorage, name: string): boolean {
    let removed = false;
    if (storage.getItem(SAVE_KEY_PREFIX + name) !== null) {
        storage.removeItem(SAVE_KEY_PREFIX + name);
        removed = true;
    }
    const entries = readSaveIndex(storage);
    const kept = entries.filter((e) => e.name !== name);
    if (kept.length !== entries.length) {
        writeSaveIndex(storage, kept);
        removed = true;
    }
    return removed;
}

/** Parse a .dwusave file's text into a LoadedGame (throws / rejects on bad input). Only a cheap sanity check runs up
 *  front (a save is one JSON object): a full JSON.parse here would parse a late-game save — hundreds of MB — a second
 *  time, and the loader rejects malformed JSON anyway. */
export function parseSaveFileText<T extends LoadedGame | Promise<LoadedGame>>(text: string, load: (text: string) => T): T {
    if (!/^\s*\{/.test(text.slice(0, 256))) throw new SyntaxError('Not a save file (expected a JSON object).');
    return load(text);
}

// ---------------------------------------------------------------------------
// Save text stores (task 12e): save texts are too big for localStorage's
// ~5 MB quota, so they live in IndexedDB; only the small index stays there.
// ---------------------------------------------------------------------------

/** Async key/value store for serialized save texts (key = save name). */
export interface SaveTextStore {
    get(name: string): Promise<string | null>;
    put(name: string, text: string): Promise<void>;
    delete(name: string): Promise<void>;
}

/** Map-backed SaveTextStore, used by tests and as the fallback when
 * IndexedDB is unavailable or fails to open. */
export function createMemorySaveStore(): SaveTextStore {
    const map = new Map<string, string>();
    return {
        async get(name) {
            return map.get(name) ?? null;
        },
        async put(name, text) {
            map.set(name, text);
        },
        async delete(name) {
            map.delete(name);
        },
    };
}

/** IndexedDB-backed SaveTextStore: opens `dbName` lazily on first use
 * (version 1; onupgradeneeded creates the 'saves' object store keyed by
 * name). If indexedDB is undefined or opening fails, every method falls back
 * to an internal memory store and one console.warn is logged. */
export function createIndexedDbSaveStore(dbName = 'dwu-saves'): SaveTextStore {
    const memoryFallback = createMemorySaveStore();
    let dbPromise: Promise<IDBDatabase> | null = null;
    let warned = false;

    function openDb(): Promise<IDBDatabase> {
        if (dbPromise === null) {
            dbPromise = new Promise((resolve, reject) => {
                if (typeof indexedDB === 'undefined') {
                    reject(new Error('indexedDB is not available'));
                    return;
                }
                const req = indexedDB.open(dbName, 1);
                req.onupgradeneeded = () => {
                    const db = req.result;
                    if (!db.objectStoreNames.contains('saves')) {
                        db.createObjectStore('saves');
                    }
                };
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error ?? new Error('Failed to open save database'));
                req.onblocked = () => reject(new Error('Opening the save database was blocked'));
            });
        }
        return dbPromise;
    }

    /** Run `fn` against the opened DB, falling back to the memory store once
     * when the DB is unusable (and logging a single warning). */
    async function withDb<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => Promise<T>): Promise<T> {
        try {
            const db = await openDb();
            return await fn(db.transaction('saves', mode).objectStore('saves'));
        } catch (err) {
            if (!warned) {
                warned = true;
                console.warn('Save database unavailable, falling back to in-memory saves', err);
            }
            throw err;
        }
    }

    return {
        async get(name) {
            try {
                return await withDb('readonly', async (store) => {
                    const result = await new Promise<string | null>((resolve, reject) => {
                        const req = store.get(name);
                        req.onsuccess = () => resolve(req.result ?? null);
                        req.onerror = () => reject(req.error);
                    });
                    return result;
                });
            } catch {
                return memoryFallback.get(name);
            }
        },
        async put(name, text) {
            // No internal fallback: a failed put must reach doSave so it can
            // keep the save in the session map and warn the user. Resolve on
            // transaction completion — quota errors surface as an abort
            // after the request itself has succeeded.
            await withDb('readwrite', async (store) => {
                await new Promise<void>((resolve, reject) => {
                    const tx = store.transaction;
                    const req = store.put(text, name);
                    req.onerror = () => reject(req.error);
                    tx.oncomplete = () => resolve();
                    tx.onabort = () => reject(tx.error ?? new Error('Save transaction aborted'));
                    tx.onerror = () => reject(tx.error ?? new Error('Save transaction failed'));
                });
            });
        },
        async delete(name) {
            try {
                await withDb('readwrite', async (store) => {
                    await new Promise<void>((resolve, reject) => {
                        const tx = store.transaction;
                        const req = store.delete(name);
                        req.onerror = () => reject(req.error);
                        tx.oncomplete = () => resolve();
                        tx.onabort = () => reject(tx.error ?? new Error('Delete transaction aborted'));
                    });
                });
            } catch {
                await memoryFallback.delete(name);
            }
        },
    };
}

/** The module's shared default text store, created lazily once per module. */
let defaultTextStore: SaveTextStore | null = null;
function getDefaultTextStore(): SaveTextStore {
    if (defaultTextStore === null) {
        defaultTextStore = createIndexedDbSaveStore();
    }
    return defaultTextStore;
}

// [leftovers] begin
/** The shared save text store (IndexedDB, created once per module): the autosave (ui/autosave.ts) writes through it
 *  like the panel's Save does, so autosaves appear in the Load list. */
export function defaultSaveTextStore(): SaveTextStore {
    return getDefaultTextStore();
}
// [leftovers] end

/** Trigger a browser download of `text` as `<baseName>.dwusave`. */
export function downloadSaveFile(baseName: string, text: string): void {
    const blob = new Blob([text], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${baseName}${SAVE_FILE_EXTENSION}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Provider registry (same pattern as keyboard.setGameMenuHandler)
// ---------------------------------------------------------------------------

/** What the running app offers the Save/Load panels. Registered by
 * src/main.ts after booting a game view (and for the main menu's Load Game). */
export interface SaveLoadProvider {
    /** Open the panel in the given sub-mode ('save' / 'load'). */
    open(mode: 'save' | 'load'): void;
    /** Serialize the running game (null when saving is unavailable). */
    serialize?: () => string | null;
    /** Resolve stored save text to a LoadedGame (null when loading is
     * unavailable, e.g. on the main menu without a loaded game data set). */
    loadSave?: (text: string) => LoadedGame | Promise<LoadedGame>;
    /** In-memory saves written this session (merged over localStorage). */
    memorySaves?: Map<string, string>;
}

let saveLoadProvider: SaveLoadProvider | null = null;

/** Register the provider used by the Escape menu's Save/Load buttons and the
 * main menu's Load Game item. Pass null to unregister (e.g. on teardown). */
export function setSaveLoadProvider(p: SaveLoadProvider | null): void {
    saveLoadProvider = p;
}

/** The currently registered provider (null before any game has booted). */
export function getSaveLoadProvider(): SaveLoadProvider | null {
    return saveLoadProvider;
}

// ---------------------------------------------------------------------------
// Panel UI
// ---------------------------------------------------------------------------

export interface SavePanelCallbacks {
    /** Called by the panel after it has written the save to storage. */
    onSaved?: (name: string) => void;
    /** Called when a save should be loaded (panel already closed). */
    onLoad?: (name: string) => void;
    /** Called when a stored save or a .dwusave file was parsed (panel
     * already closed): the caller boots the loaded game. */
    onLoadedFile?: (loaded: LoadedGame) => void;
    /** Called after a save was deleted (list refresh handled internally). */
    onDelete?: (name: string) => void;
}

export interface SavePanelRefs {
    root: HTMLDivElement;
    show: () => void;
    hide: () => void;
    destroy: () => void;
}

export interface SavePanelWiring {
    callbacks: SavePanelCallbacks;
    /** In-memory saves (this session), merged above the localStorage ones. */
    memorySaves?: Map<string, string>;
    /** Serialize the running game to its save text (null → saving disabled). */
    serialize?: () => string | null;
    /** Resolve a stored save text to a LoadedGame (load button / file open). */
    loadSave?: (text: string) => LoadedGame | Promise<LoadedGame>;
    /** Date stamp for newly written saves (default: now). */
    now?: () => Date;
    /** Storage backend (default: window.localStorage). */
    storage?: SaveStorage;
    /** Where save texts are persisted (default: an IndexedDB store, created
     * once per module; pass createMemorySaveStore() in tests). */
    textStore?: SaveTextStore;
    /** Hide the Save tab (main menu: there is no running game to save). */
    loadOnly?: boolean;
}

/** Build the Save/Load panel and append it to document.body. `mode` picks
 * which sub-panel shows first: 'save' (Escape menu Save Game) or 'load'
 * (Escape menu Load Game / main menu Load Game). */
export function createSaveLoadPanel(mode: 'save' | 'load', wiring: SavePanelWiring = { callbacks: {} }): SavePanelRefs {
    const { callbacks, memorySaves, serialize, loadSave, now, storage, textStore, loadOnly } = wiring;
    const getStorage = (): SaveStorage => storage ?? (window.localStorage as unknown as SaveStorage);
    const getTextStore = (): SaveTextStore => textStore ?? getDefaultTextStore();
    const stamp = (): string => (now ? now() : new Date()).toISOString();

    const root = document.createElement('div');
    root.id = 'save-load-overlay';
    root.style.display = 'none';

    const dim = document.createElement('div');
    dim.className = 'save-load-dim';
    root.appendChild(dim);

    const panel = document.createElement('div');
    panel.className = 'save-load-panel';

    const title = document.createElement('div');
    title.className = 'save-load-title';
    panel.appendChild(title);

    // --- Tabs ---------------------------------------------------------------
    const tabs = document.createElement('div');
    tabs.className = 'save-load-tabs';
    const tabButtons: Record<'save' | 'load', HTMLButtonElement> = {
        save: makeTabButton('Save'),
        load: makeTabButton('Load'),
    };
    tabs.append(tabButtons.save, tabButtons.load);
    if (loadOnly) tabs.style.display = 'none';
    panel.appendChild(tabs);

    // --- Save sub-panel -----------------------------------------------------
    const saveBody = document.createElement('div');
    saveBody.className = 'save-load-body';

    const nameLabel = document.createElement('label');
    nameLabel.className = 'save-load-field-label';
    nameLabel.textContent = 'Save name';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'save-load-name-input';
    nameInput.maxLength = 40;
    nameInput.placeholder = 'My Galaxy';
    nameLabel.append(nameInput);
    saveBody.appendChild(nameLabel);

    const saveListHead = document.createElement('div');
    saveListHead.className = 'save-list-head';
    saveListHead.textContent = 'Existing saves';
    saveBody.appendChild(saveListHead);
    const saveList = document.createElement('div');
    saveList.className = 'save-list';
    saveBody.appendChild(saveList);

    const saveActions = document.createElement('div');
    saveActions.className = 'save-load-actions';
    const saveBtn = makeActionButton('Save');
    const downloadBtn = makeActionButton('Download .dwusave');
    saveActions.append(saveBtn, downloadBtn);
    saveBody.appendChild(saveActions);

    // --- Load sub-panel -----------------------------------------------------
    const loadBody = document.createElement('div');
    loadBody.className = 'save-load-body';
    loadBody.style.display = 'none';

    const loadListHead = document.createElement('div');
    loadListHead.className = 'save-list-head';
    loadListHead.textContent = 'Saves';
    loadBody.appendChild(loadListHead);
    const loadList = document.createElement('div');
    loadList.className = 'save-list';
    loadBody.appendChild(loadList);

    const loadActions = document.createElement('div');
    loadActions.className = 'save-load-actions';
    const openFileBtn = makeActionButton('Open file…');
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = SAVE_FILE_EXTENSION;
    fileInput.className = 'save-load-file-input';
    fileInput.style.display = 'none';
    loadActions.append(openFileBtn, fileInput);
    loadBody.appendChild(loadActions);

    panel.append(saveBody, loadBody);
    root.appendChild(panel);

    // Close button (top-right of the panel).
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'save-load-close';
    closeBtn.title = 'Close';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', () => hide());
    panel.appendChild(closeBtn);

    document.body.appendChild(root);

    // --- State --------------------------------------------------------------
    let activeMode: 'save' | 'load' = mode;
    let toastTimer: number | undefined;

    function showToast(text: string): void {
        const existing = root.querySelector('.save-load-toast');
        if (existing) existing.remove();
        if (toastTimer !== undefined) {
            clearTimeout(toastTimer);
            toastTimer = undefined;
        }
        const toast = document.createElement('div');
        toast.className = 'save-load-toast';
        toast.textContent = text;
        root.appendChild(toast);
        toastTimer = window.setTimeout(() => {
            toast.remove();
            toastTimer = undefined;
        }, 3000);
    }

    /** All known saves: in-memory (this session) merged over localStorage,
     * newest first (index order, then memory-only names). */
    function allSaves(): SaveEntry[] {
        const st = getStorage();
        const local = readSaveIndex(st);
        const seen = new Set(local.map((e) => e.name));
        const memEntries: SaveEntry[] = [];
        for (const [name, text] of memorySaves ?? []) {
            if (seen.has(name)) continue;
            seen.add(name);
            memEntries.push({ name, date: savedDateFromText(text) ?? '' });
        }
        return [...memEntries, ...local];
    }

    /** Look up the save text for `name`: memory first, then the text store,
     * then old localStorage saves (pre-12e). */
    async function saveTextFor(name: string): Promise<string | null> {
        const mem = memorySaves?.get(name);
        if (mem !== undefined) return mem;
        const stored = await getTextStore().get(name);
        if (stored !== null) return stored;
        return getStorage().getItem(SAVE_KEY_PREFIX + name);
    }

    function refreshLists(): void {
        renderList(saveList, allSaves(), {
            onSaveClick: (name) => {
                nameInput.value = name;
            },
        });
        renderList(loadList, allSaves(), {
            onLoadClick: (name) => {
                void doLoadByName(name);
            },
            onDeleteClick: (name) => {
                void doDelete(name);
            },
        });
    }

    function renderList(
        listEl: HTMLDivElement,
        entries: SaveEntry[],
        handlers: { onSaveClick?: (name: string) => void; onLoadClick?: (name: string) => void; onDeleteClick?: (name: string) => void },
    ): void {
        listEl.replaceChildren();
        if (entries.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'save-list-empty';
            empty.textContent = 'No saves yet';
            listEl.appendChild(empty);
            return;
        }
        for (const entry of entries) {
            const row = document.createElement('div');
            row.className = 'save-row';
            const label = document.createElement('span');
            label.className = 'save-row-name';
            label.textContent = entry.name;
            const date = document.createElement('span');
            date.className = 'save-row-date';
            date.textContent = formatSaveDate(entry.date);
            row.append(label, date);
            if (handlers.onSaveClick) {
                row.classList.add('save-row-clickable');
                row.addEventListener('click', () => handlers.onSaveClick!(entry.name));
            }
            if (handlers.onLoadClick) {
                const loadBtn = makeRowButton('Load');
                loadBtn.addEventListener('click', () => handlers.onLoadClick!(entry.name));
                row.appendChild(loadBtn);
            }
            if (handlers.onDeleteClick) {
                const delBtn = makeRowButton('Delete');
                delBtn.className += ' save-row-delete';
                delBtn.addEventListener('click', () => handlers.onDeleteClick!(entry.name));
                row.appendChild(delBtn);
            }
            listEl.appendChild(row);
        }
    }

    function switchMode(next: 'save' | 'load'): void {
        activeMode = next;
        title.textContent = next === 'save' ? 'Save Game' : 'Load Game';
        tabButtons.save.classList.toggle('save-load-tab-active', next === 'save');
        tabButtons.load.classList.toggle('save-load-tab-active', next === 'load');
        saveBody.style.display = next === 'save' ? '' : 'none';
        loadBody.style.display = next === 'load' ? '' : 'none';
        refreshLists();
    }

    async function doSave(): Promise<void> {
        const name = nameInput.value.trim();
        if (name === '') {
            showToast('Enter a save name first');
            return;
        }
        const text = serialize?.() ?? null;
        if (text === null) {
            showToast('Nothing to save yet');
            return;
        }
        const date = stamp();
        // Persist the text in the IndexedDB store, then update the small
        // localStorage index. When the text write fails keep it in memory for
        // this session and say so.
        let persisted = true;
        try {
            await getTextStore().put(name, text);
            writeSaveIndexEntry(getStorage(), name, date);
            memorySaves?.delete(name);
        } catch (err) {
            console.warn('Save could not be written to the text store', err);
            persisted = false;
            memorySaves?.set(name, text);
        }
        refreshLists();
        showToast(persisted ? `Saved "${name}"` : `Saved "${name}" for this session only (save storage unavailable) — use Download .dwusave to keep it`);
        callbacks.onSaved?.(name);
    }

    function doDownload(): void {
        const name = nameInput.value.trim() || 'save';
        const text = serialize?.() ?? null;
        if (text === null) {
            showToast('Nothing to download yet');
            return;
        }
        downloadSaveFile(name, text);
        showToast(`Downloading ${name}${SAVE_FILE_EXTENSION}`);
    }

    async function doLoadByName(name: string): Promise<void> {
        // Ignore repeat clicks while the save text is being read: a second
        // onLoadedFile would boot a second game view.
        if (loadingName !== null) return;
        loadingName = name;
        try {
            await doLoadByNameInner(name);
        } finally {
            loadingName = null;
        }
    }

    async function doLoadByNameInner(name: string): Promise<void> {
        const text = await saveTextFor(name);
        if (text === null) {
            showToast(`Save "${name}" not found`);
            return;
        }
        if (!loadSave) {
            showToast('Loading is only available during a game');
            return;
        }
        let loaded: LoadedGame;
        try {
            loaded = await loadSave(text);
        } catch (err) {
            console.error('Failed to load save', err);
            showToast('Could not load that save');
            return;
        }
        hide();
        callbacks.onLoad?.(name);
        callbacks.onLoadedFile?.(loaded);
    }

    async function doDelete(name: string): Promise<void> {
        memorySaves?.delete(name);
        // Remove the name from all three places it can live: the text store,
        // the index and old localStorage saves.
        await getTextStore().delete(name);
        deleteSave(getStorage(), name);
        refreshLists();
        showToast(`Deleted "${name}"`);
        callbacks.onDelete?.(name);
    }

    function handleFilePicked(e: Event): void {
        const input = e.target as HTMLInputElement;
        const file = input.files?.[0];
        input.value = '';
        if (!file) return;
        if (!loadSave) {
            showToast('Opening files is only available during a game');
            return;
        }
        const reader = new FileReader();
        reader.onload = async () => {
            try {
                const loaded = await parseSaveFileText(String(reader.result), loadSave);
                hide();
                callbacks.onLoadedFile?.(loaded);
            } catch (err) {
                console.error('Failed to read save file', err);
                showToast('Could not read that save file');
            }
        };
        reader.onerror = () => showToast('Could not read that save file');
        reader.readAsText(file);
    }

    tabButtons.save.addEventListener('click', () => switchMode('save'));
    tabButtons.load.addEventListener('click', () => switchMode('load'));
    saveBtn.addEventListener('click', () => void doSave());
    downloadBtn.addEventListener('click', doDownload);
    openFileBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFilePicked);

    let loadingName: string | null = null;

    // Escape closes the panel. Capture phase on document runs before the
    // window-level key dispatch, so the game menu does not also toggle.
    const onKeyDown = (e: KeyboardEvent): void => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopImmediatePropagation();
        hide();
    };

    function show(): void {
        root.style.display = '';
        switchMode(activeMode);
        document.addEventListener('keydown', onKeyDown, true);
    }

    function hide(): void {
        root.style.display = 'none';
        document.removeEventListener('keydown', onKeyDown, true);
    }

    switchMode(mode);

    return {
        root,
        show,
        hide,
        destroy: () => {
            if (toastTimer !== undefined) clearTimeout(toastTimer);
            hide();
            root.remove();
        },
    };
}

// ---------------------------------------------------------------------------
// Small DOM/date helpers
// ---------------------------------------------------------------------------

function makeTabButton(label: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'save-load-tab';
    btn.textContent = label;
    return btn;
}

function makeActionButton(label: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'save-load-btn';
    btn.textContent = label;
    return btn;
}

function makeRowButton(label: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'save-row-btn';
    btn.textContent = label;
    return btn;
}

/** Pull the savedAt timestamp out of a stored save JSON (best effort). */
function savedDateFromText(text: string): string | null {
    try {
        const obj = JSON.parse(text) as { savedAt?: unknown };
        return typeof obj.savedAt === 'string' ? obj.savedAt : null;
    } catch {
        return null;
    }
}

/** Format an ISO date for the list, e.g. `2026-09-24 15:03`. */
function formatSaveDate(iso: string): string {
    if (iso === '') return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const pad = (n: number): string => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}