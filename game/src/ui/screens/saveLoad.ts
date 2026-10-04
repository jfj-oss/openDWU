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
import { COLORS, FONT, OwGrid, el, glassButton, messageBox, openOriginalWindow, place, tabStrip, text, textBox, type GridColumn, type OriginalWindow } from '../originalWindow';

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

/** How the Save/Load window opens: `saveAs` (Save Game As) starts with an empty name instead of the current game's. */
export interface SaveLoadOpenOptions {
    saveAs?: boolean;
}

/** What the running app offers the Save/Load panels. Registered by
 * src/main.ts after booting a game view (and for the main menu's Load Game). */
export interface SaveLoadProvider {
    /** Open the panel in the given sub-mode ('save' / 'load'). */
    open(mode: 'save' | 'load', opts?: SaveLoadOpenOptions): void;
    /** Serialize the running game (null when saving is unavailable). */
    serialize?: () => string | null | Promise<string | null>;
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

/** Main.string_2: the name the running game was last saved under or loaded from (null = never saved). "Save Game"
 *  starts from it (btnGameMenuSave_Click re-saves that file; without one it is Save Game As). */
let currentSaveName: string | null = null;

/** The current game's save name (see currentSaveName). */
export function getCurrentSaveName(): string | null {
    return currentSaveName;
}

/** Set (or clear, for a new game) the current game's save name. */
export function setCurrentSaveName(name: string | null): void {
    currentSaveName = name;
}

/** The name the save field starts with: the current game's for Save Game, empty for Save Game As. */
export function initialSaveName(current: string | null, saveAs: boolean): string {
    return saveAs || current === null ? '' : current;
}

/** A .dwusave file name without its extension (the save's name once loaded). */
export function saveNameFromFileName(fileName: string): string {
    return fileName.endsWith(SAVE_FILE_EXTENSION) ? fileName.slice(0, -SAVE_FILE_EXTENSION.length) : fileName;
}

// ---------------------------------------------------------------------------
// Panel UI: an original-style ScreenPanel (originalWindow.ts) — the original opens the Windows Open / Save File
// dialogs (Main.Part7.cs btnGameMenuLoad_Click / btnGameMenuSaveAs_Click) and shows pnlSaveLoadProgress while it works
// (ui/loadingOverlay.ts); this window stands in for the file dialogs: a name text box, the saves as a DataGridView
// (OwGrid), GlassButtons and MessageBoxEx confirms.
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
    /** The window's content (moved into the window while it is open). */
    root: HTMLDivElement;
    /** Open the window (in `mode`, default the last one). */
    show: (mode?: 'save' | 'load', opts?: SaveLoadOpenOptions) => void;
    hide: () => void;
    destroy: () => void;
}

export interface SavePanelWiring {
    callbacks: SavePanelCallbacks;
    /** In-memory saves (this session), merged above the localStorage ones. */
    memorySaves?: Map<string, string>;
    /** Serialize the running game to its save text (null → saving disabled). */
    serialize?: () => string | null | Promise<string | null>;
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

/** The window's size (original pixels) and its body layout. */
const SL_W = 620;
const SL_H = 560;
const SL_FONT = FONT.large; // 16.67

/** Build the Save/Load window. `mode` picks which sub-panel shows first: 'save' (Escape menu Save Game) or 'load'
 * (Escape menu Load Game / main menu Load Game). The window opens on show(). */
export function createSaveLoadPanel(mode: 'save' | 'load', wiring: SavePanelWiring = { callbacks: {} }): SavePanelRefs {
    const { callbacks, memorySaves, serialize, loadSave, now, storage, textStore, loadOnly } = wiring;
    const getStorage = (): SaveStorage => storage ?? (window.localStorage as unknown as SaveStorage);
    const getTextStore = (): SaveTextStore => textStore ?? getDefaultTextStore();
    const stamp = (): string => (now ? now() : new Date()).toISOString();

    const root = el('div', 'save-load-content');
    root.id = 'save-load-overlay';
    const top = loadOnly ? 10 : 44;

    // --- Tabs (EnhancedTabControl), rebuilt on each mode switch so the strip's selection follows show(mode) ----
    const tabsHost = place(el('div', 'save-load-tabs'), 10, 10, 584, 26);
    const renderTabs = (selected: 'save' | 'load'): void => {
        const strip = tabStrip(
            [
                { id: 'save', label: 'Save' },
                { id: 'load', label: 'Load' },
            ],
            selected,
            (id) => switchMode(id as 'save' | 'load'),
            120,
        );
        tabsHost.replaceChildren(strip);
    };
    if (!loadOnly) root.appendChild(tabsHost);

    const columns = (): GridColumn<SaveEntry>[] => [
        { id: 'name', header: 'Name', render: (e, c) => (c.textContent = e.name), sort: (e) => e.name.toLowerCase() },
        { id: 'date', header: 'Saved', width: 170, render: (e, c) => (c.textContent = formatSaveDate(e.date)), sort: (e) => e.date },
    ];

    // --- Save sub-panel --------------------------------------------------------
    const saveBody = place(el('div', 'save-load-body'), 0, top, 604, SL_H - 63 - top);
    saveBody.appendChild(place(text('Save name', { size: SL_FONT, color: COLORS.label, shadow: false }), 10, 4));
    const nameInput = textBox('', 'My Galaxy', () => undefined);
    nameInput.classList.add('save-load-name-input');
    nameInput.maxLength = 40;
    nameInput.style.fontSize = `${SL_FONT}px`;
    nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            void doSave();
        }
    });
    saveBody.appendChild(place(nameInput, 120, 0, 474, 26));
    saveBody.appendChild(place(text('Existing saves', { size: SL_FONT, color: COLORS.label, shadow: false }), 10, 38));
    const saveGrid = new OwGrid<SaveEntry>({
        columns: columns(),
        key: (e) => e.name,
        rowHeight: 22,
        empty: 'No saves yet',
        fontSize: SL_FONT,
        onSelect: (e) => {
            nameInput.value = e.name;
        },
    });
    saveGrid.el.classList.add('save-list');
    saveBody.appendChild(place(saveGrid.el, 10, 62, 584, 318 - (top - 10)));
    const saveBtn = glassButton('Save', { size: FONT.header, className: 'save-load-btn', onClick: () => void doSave() });
    const downloadBtn = glassButton('Download .dwusave', { size: FONT.header, className: 'save-load-btn', onClick: () => void doDownload() });
    const btnY = SL_H - 63 - top - 75;
    saveBody.append(place(saveBtn, 10, btnY, 180, 35), place(downloadBtn, 200, btnY, 240, 35));

    // --- Load sub-panel --------------------------------------------------------
    const loadBody = place(el('div', 'save-load-body'), 0, top, 604, SL_H - 63 - top);
    loadBody.appendChild(place(text('Saves', { size: SL_FONT, color: COLORS.label, shadow: false }), 10, 4));
    const loadGrid = new OwGrid<SaveEntry>({
        columns: columns(),
        key: (e) => e.name,
        rowHeight: 22,
        empty: 'No saves yet',
        fontSize: SL_FONT,
        onSelect: () => updateLoadButtons(),
        onDoubleClick: (e) => void doLoadByName(e.name),
    });
    loadGrid.el.classList.add('save-list');
    loadBody.appendChild(place(loadGrid.el, 10, 28, 584, btnY - 38));
    const loadBtn = glassButton('Load', { size: FONT.header, className: 'save-load-btn', onClick: () => loadSelected() });
    const deleteBtn = glassButton('Delete', { size: FONT.header, className: 'save-load-btn save-row-delete', onClick: () => deleteSelected() });
    const openFileBtn = glassButton('Open file…', { size: FONT.header, className: 'save-load-btn', onClick: () => fileInput.click() });
    const fileInput = el('input', 'save-load-file-input');
    fileInput.type = 'file';
    fileInput.accept = SAVE_FILE_EXTENSION;
    fileInput.style.display = 'none';
    fileInput.addEventListener('change', handleFilePicked);
    loadBody.append(place(loadBtn, 10, btnY, 180, 35), place(deleteBtn, 200, btnY, 140, 35), place(openFileBtn, 414, btnY, 180, 35), fileInput);

    // A status line under the buttons (the old panel's toast).
    const status = place(text('', { size: FONT.normal, color: 'rgb(255, 192, 0)', shadow: true, wrapWidth: 584, className: 'save-load-status' }), 10, SL_H - 63 - 34);

    // The load list first: scripts and tests look up its rows (`#save-load-overlay .ow-grid-row`); the main menu has no
    // Save sub-panel at all.
    root.append(loadBody);
    if (!loadOnly) root.append(saveBody);
    root.append(status);

    // --- State --------------------------------------------------------------
    let activeMode: 'save' | 'load' = mode;
    let statusTimer: number | undefined;
    let win: OriginalWindow | null = null;
    let loadingName: string | null = null;

    function showToast(msg: string): void {
        status.textContent = msg;
        if (statusTimer !== undefined) clearTimeout(statusTimer);
        statusTimer = window.setTimeout(() => {
            status.textContent = '';
            statusTimer = undefined;
        }, 3000);
    }

    /** All known saves: in-memory (this session) merged over localStorage,
     * newest first (index order, then memory-only names). */
    function allSaves(): SaveEntry[] {
        const st = getStorage();
        const local = readSaveIndex(st);
        const seen = new Set(local.map((e) => e.name));
        const memEntries: SaveEntry[] = [];
        for (const [name, saveText] of memorySaves ?? []) {
            if (seen.has(name)) continue;
            seen.add(name);
            memEntries.push({ name, date: savedDateFromText(saveText) ?? '' });
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
        const entries = allSaves();
        saveGrid.setRows(entries);
        const sel = loadGrid.selected?.name;
        loadGrid.setRows(entries);
        if (sel !== undefined && entries.some((e) => e.name === sel)) loadGrid.setSelection([sel]);
        updateLoadButtons();
    }

    function updateLoadButtons(): void {
        const has = loadGrid.selected !== null;
        loadBtn.disabled = !has;
        deleteBtn.disabled = !has;
    }

    function switchMode(next: 'save' | 'load'): void {
        activeMode = next;
        win?.setTitle(next === 'save' ? 'Save Game' : 'Load Game');
        if (!loadOnly) renderTabs(next);
        saveBody.style.display = next === 'save' ? '' : 'none';
        loadBody.style.display = next === 'load' ? '' : 'none';
        refreshLists();
    }

    /** While a save / download runs: buttons off, a persistent "Saving…" line and the busy cursor. Serializing a big
     *  galaxy blocks the page for seconds, so the line is painted (two animation frames) before the work starts. */
    async function whileBusy<T>(message: string, work: () => Promise<T>): Promise<T> {
        if (statusTimer !== undefined) clearTimeout(statusTimer);
        statusTimer = undefined;
        status.textContent = message;
        status.classList.add('save-load-busy');
        saveBtn.disabled = true;
        downloadBtn.disabled = true;
        root.style.cursor = 'progress';
        document.documentElement.style.cursor = 'progress';
        await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
        try {
            return await work();
        } finally {
            status.classList.remove('save-load-busy');
            saveBtn.disabled = false;
            downloadBtn.disabled = false;
            root.style.cursor = '';
            document.documentElement.style.cursor = '';
        }
    }

    async function doSave(): Promise<void> {
        if (saveBtn.disabled) return;
        const name = nameInput.value.trim();
        if (name === '') {
            showToast('Enter a save name first');
            return;
        }
        await whileBusy(`Saving "${name}"…`, () => doSaveNow(name));
    }

    async function doSaveNow(name: string): Promise<void> {
        const saveText = (await serialize?.()) ?? null;
        if (saveText === null) {
            showToast('Nothing to save yet');
            return;
        }
        const date = stamp();
        // Persist the text in the IndexedDB store, then update the small
        // localStorage index. When the text write fails keep it in memory for
        // this session and say so.
        let persisted = true;
        try {
            await getTextStore().put(name, saveText);
            writeSaveIndexEntry(getStorage(), name, date);
            memorySaves?.delete(name);
        } catch (err) {
            console.warn('Save could not be written to the text store', err);
            persisted = false;
            memorySaves?.set(name, saveText);
        }
        currentSaveName = name;
        refreshLists();
        showToast(persisted ? `Saved "${name}"` : `Saved "${name}" for this session only (save storage unavailable) — use Download .dwusave to keep it`);
        callbacks.onSaved?.(name);
    }

    async function doDownload(): Promise<void> {
        if (downloadBtn.disabled) return;
        const name = nameInput.value.trim() || 'save';
        await whileBusy(`Preparing "${name}.dwusave"…`, () => doDownloadNow(name));
    }

    async function doDownloadNow(name: string): Promise<void> {
        const saveText = (await serialize?.()) ?? null;
        if (saveText === null) {
            showToast('Nothing to download yet');
            return;
        }
        downloadSaveFile(name, saveText);
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
        const saveText = await saveTextFor(name);
        if (saveText === null) {
            showToast(`Save "${name}" not found`);
            return;
        }
        if (!loadSave) {
            showToast('Loading is only available during a game');
            return;
        }
        let loaded: LoadedGame;
        try {
            loaded = await loadSave(saveText);
        } catch (err) {
            console.error('Failed to load save', err);
            showToast('Could not load that save');
            return;
        }
        hide();
        currentSaveName = name;
        callbacks.onLoad?.(name);
        callbacks.onLoadedFile?.(loaded);
    }

    function loadSelected(): void {
        const e = loadGrid.selected;
        if (e) void doLoadByName(e.name);
    }

    function deleteSelected(): void {
        const e = loadGrid.selected;
        if (!e) return;
        void messageBox({
            caption: 'Delete Saved Game?',
            text: `Delete the saved game "${e.name}"?`,
            buttons: ['Yes', 'No'],
            defaultButton: 'No',
            icon: 'question',
        }).then((r) => {
            if (r === 'Yes') void doDelete(e.name);
        });
    }

    async function doDelete(name: string): Promise<void> {
        memorySaves?.delete(name);
        // Remove the name from all three places it can live: the text store,
        // the index and old localStorage saves.
        await getTextStore().delete(name);
        deleteSave(getStorage(), name);
        if (currentSaveName === name) currentSaveName = null;
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
                currentSaveName = saveNameFromFileName(file.name);
                callbacks.onLoadedFile?.(loaded);
            } catch (err) {
                console.error('Failed to read save file', err);
                showToast('Could not read that save file');
            }
        };
        reader.onerror = () => showToast('Could not read that save file');
        reader.readAsText(file);
    }

    function show(nextMode?: 'save' | 'load', opts: SaveLoadOpenOptions = {}): void {
        if (loadOnly) nextMode = 'load';
        if (nextMode !== undefined) activeMode = nextMode;
        if (activeMode === 'save') nameInput.value = initialSaveName(currentSaveName, opts.saveAs === true);
        if (win === null || win.closed) {
            // Escape and the close button close the window (originalWindow.ts); the panel waits for the next show().
            win = openOriginalWindow({
                id: 'saveload',
                title: activeMode === 'save' ? 'Save Game' : 'Load Game',
                width: SL_W,
                height: SL_H,
                onClose: () => {
                    win = null;
                    root.remove();
                },
            });
            win.body.appendChild(root);
        } else document.body.appendChild(win.root);
        switchMode(activeMode);
        if (activeMode === 'save') nameInput.focus();
    }

    function hide(): void {
        win?.close();
    }

    switchMode(mode);

    return {
        root,
        show,
        hide,
        destroy: () => {
            if (statusTimer !== undefined) clearTimeout(statusTimer);
            hide();
            root.remove();
        },
    };
}

// ---------------------------------------------------------------------------
// Small DOM/date helpers
// ---------------------------------------------------------------------------

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