// Autosave: port of Main.Part12.cs:4013 method_97, run from the program loop (4330). Every AutoSaveInterval real-time
// minutes (Game Options; default 30, 10-60) the running game is saved to the next of five rotating slots
// (Autosave1..5.dwg → "autosave-1".."autosave-5" here), through the same save codec and store as the Save panel.
// Skipped while the Game Options panel is open (4015, pnlGameOptions.Visible).
//
// Timing: serializeGame is synchronous and slow on big galaxies (~4.3-5.3 s and ~139 MB of text for a 1400-star
// autostart game on the dev machine), so it cannot be spread over frames. It is started from requestIdleCallback
// (between frames, never inside a sim tick) after a "Saving the Galaxy..." toast has painted — the C# also stops the
// game with that message while it saves — and the text is then written to IndexedDB asynchronously.

import { writeSaveIndexEntry, defaultSaveTextStore, type SaveStorage, type SaveTextStore } from './screens/saveLoad';
import { getSettings, type UiSettings } from './settings';
import { showToast } from './toast';
import { tryGetText } from '../sim/textResolver';

/** int_59 cycles 1..5 (Main.Part12.cs:4038-4041). */
export const AUTOSAVE_SLOTS = 5;

/** Main.Part12.cs:4038-4042: int_59++, wrapping past 5 back to 1. */
export function nextAutosaveSlot(previous: number): number {
    const n = previous + 1;
    return n > AUTOSAVE_SLOTS ? 1 : n;
}

/** The slot's save name ("Autosave" + int_59 + ".dwg" in the C#). */
export function autosaveName(slot: number): string {
    return `autosave-${slot}`;
}

/** GameOptions.AutoSaveInterval in ms, or null when autosave is off (4015 `AutoSaveInterval <= 0`);
 *  `Math.Max(1, AutoSaveInterval)` minutes (4023). */
export function autosaveIntervalMs(settings: Pick<UiSettings, 'autoSave' | 'autoSaveMinutes'>): number | null {
    if (!settings.autoSave || !(settings.autoSaveMinutes > 0)) return null;
    return Math.max(1, settings.autoSaveMinutes) * 60000;
}

/** Main.Part12.cs:4019-4027: due once `now` is past the last save (or the first check) plus the interval. */
export function isAutosaveDue(now: number, last: number, intervalMs: number): boolean {
    return now > last + intervalMs;
}

/** Write one autosave: the text to the store, then the index entry (as the panel's doSave). */
export async function writeAutosave(name: string, text: string, storage: SaveStorage, store: SaveTextStore, date: string): Promise<void> {
    await store.put(name, text);
    writeSaveIndexEntry(storage, name, date);
}

export interface AutosaveOptions {
    /** Serialize the running game (null when saving is unavailable). */
    serialize: () => string | null;
    /** True while the save must wait (the Game Options panel is open). */
    isBlocked?: () => boolean;
}

interface Installed {
    timer: ReturnType<typeof setInterval>;
    idle: number | null;
    disposed: boolean;
}

let installed: Installed | null = null;
/** int_59: the last slot written this session (0 before the first autosave). */
let lastSlot = 0;

function requestIdle(cb: () => void): number {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    if (typeof w.requestIdleCallback === 'function') return w.requestIdleCallback(cb, { timeout: 5000 });
    return window.setTimeout(cb, 0);
}

function cancelIdle(id: number): void {
    const w = window as Window & { cancelIdleCallback?: (id: number) => void };
    if (typeof w.cancelIdleCallback === 'function') w.cancelIdleCallback(id);
    else clearTimeout(id);
}

/** Start the autosave check for a game view (one at a time; replaces any previous one). */
export function installAutosave(opts: AutosaveOptions): void {
    removeAutosave();
    // dateTime_6: DateTime.MinValue until the first check with autosave on.
    let last: number | null = null;
    const state: Installed = { timer: 0 as unknown as ReturnType<typeof setInterval>, idle: null, disposed: false };

    function save(): void {
        state.idle = null;
        if (state.disposed) return;
        const slot = nextAutosaveSlot(lastSlot);
        const name = autosaveName(slot);
        const t0 = performance.now();
        let text: string | null = null;
        try {
            text = opts.serialize();
        } catch (err) {
            console.error('Autosave failed', err);
        }
        const ms = performance.now() - t0;
        // 4116: dateTime_6 = DateTime.Now after the attempt.
        last = Date.now();
        if (text === null) return;
        lastSlot = slot;
        console.info(`[autosave] ${name}: serialized ${(text.length / 1048576).toFixed(1)} MB in ${ms.toFixed(0)} ms`);
        void writeAutosave(name, text, window.localStorage as unknown as SaveStorage, defaultSaveTextStore(), new Date().toISOString()).then(
            () => showToast(`Autosaved (${name})`),
            (err: unknown) => console.warn('Autosave could not be written', err),
        );
    }

    function check(): void {
        const interval = autosaveIntervalMs(getSettings());
        if (interval === null || state.idle !== null) return;
        if (opts.isBlocked?.()) return;
        const now = Date.now();
        if (last === null) last = now;
        if (!isAutosaveDue(now, last, interval)) return;
        // Between frames: announce the save first (4070 method_383 "Saving the Galaxy..."), give the browser a moment
        // to paint it, then run the synchronous serialize.
        state.idle = requestIdle(() => {
            if (state.disposed) return;
            showToast(tryGetText('Saving the Galaxy...') ?? 'Saving the Galaxy...', document.body, 8000);
            state.idle = window.setTimeout(save, 60);
        });
    }

    state.timer = setInterval(check, 5000);
    installed = state;
}

/** Stop the autosave check (game teardown). */
export function removeAutosave(): void {
    if (installed === null) return;
    installed.disposed = true;
    clearInterval(installed.timer);
    if (installed.idle !== null) {
        cancelIdle(installed.idle);
        clearTimeout(installed.idle);
    }
    installed = null;
}

/** Test/debug hook: run the autosave now, ignoring the timer (resolves after the text is stored). */
export async function autosaveNow(serialize: () => string | null, storage: SaveStorage, store: SaveTextStore, date: string): Promise<string | null> {
    const text = serialize();
    if (text === null) return null;
    const slot = nextAutosaveSlot(lastSlot);
    lastSlot = slot;
    const name = autosaveName(slot);
    await writeAutosave(name, text, storage, store, date);
    return name;
}
