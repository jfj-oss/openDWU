// A save's text, kept out of the JS heap where it can be. serializeGame's text of a 100k-habitat galaxy is ~140M
// characters; as one string (two-byte as soon as one non-Latin-1 character is in it) beside the game it pushed the page
// past V8's heap cage — and in worker mode the string was copied again into the page by postMessage. So a save is made
// as a Blob: the text is written in chunks (serializeGameParts), each chunk encoded to UTF-8 bytes as soon as it is
// written, and the Blob of those bytes is what moves (worker → page: by reference) and what IndexedDB stores (the bytes
// go to the browser's blob storage). Old saves in the store, files and the dev `?load=` are still plain strings.

import type { Game } from './sim/game';
import type { GalaxyTime } from './sim/galaxyTime';
import type { StartGameOptions } from './sim/startGameOptions';
import { serializeGameParts } from './sim/save/gameSave';

/** A save's text: a string, or a Blob of its UTF-8 bytes. */
export type SaveText = string | Blob;

/** serializeGame's text as a Blob (UTF-8), made chunk by chunk: the JS heap only ever holds one chunk of it. */
export function serializeGameBlob(game: Game, time: GalaxyTime, startOptions: StartGameOptions): Blob {
    const enc = new TextEncoder();
    const parts = serializeGameParts(game, time, startOptions, (chunk) => enc.encode(chunk));
    return new Blob(parts as BlobPart[], { type: 'application/json' });
}

/** The save's text as a string (a Blob is read; a string is itself). */
export async function saveTextString(save: SaveText): Promise<string> {
    return typeof save === 'string' ? save : await save.text();
}

/** The last `n` characters of the save's text (a Blob: of its last `n` bytes, enough for the key read from the tail). */
export async function saveTextTail(save: SaveText, n: number): Promise<string> {
    return typeof save === 'string' ? save.slice(-n) : await save.slice(Math.max(0, save.size - n)).text();
}

/** Its size in MB (characters of a string, bytes of a Blob), for logs. */
export function saveTextMB(save: SaveText): number {
    return (typeof save === 'string' ? save.length : save.size) / 1048576;
}

/**
 * The scenario a save was made with, read without parsing the save (the Load screen's "Add add-ons…" lists what the
 * save does not have yet; a late save is hundreds of MB). galaxy.scenario.manifest is plain JSON in the encoded graph
 * and the only object with a `resourcePlacement` key (ScenarioManifest's key order: id first): the last such key is
 * found from the end of the text, chunk by chunk, and its manifest object parsed. The load itself checks the result
 * again (deserializeGame's addAddons path). id null = no scenario (the original game).
 */
export async function readSaveScenarioRef(save: SaveText): Promise<{ id: string | null; include: string[] | null }> {
    const MARK = '"resourcePlacement":[';
    const START = '{"id":"';
    const fromWindow = (w: string): { id: string | null; include: string[] | null } | null => {
        const m = w.lastIndexOf(MARK);
        if (m < 0) return null;
        const start = w.lastIndexOf(START, m);
        if (start < 0) return null;
        const end = jsonObjectEnd(w, start);
        if (end < 0) return null;
        const manifest = JSON.parse(w.slice(start, end)) as { id?: unknown; include?: unknown };
        const id = typeof manifest.id === 'string' ? manifest.id : null;
        const include = Array.isArray(manifest.include) && manifest.include.every((x) => typeof x === 'string') ? (manifest.include as string[]) : null;
        return { id, include: id === 'addons' ? include : null };
    };
    if (typeof save === 'string') return fromWindow(save) ?? { id: null, include: null };
    const CHUNK = 8 << 20;
    const PAD = 1 << 20; // the manifest (a few KB to tens of KB) around the key
    for (let end = save.size; end > 0; end -= CHUNK) {
        const lo = Math.max(0, end - CHUNK);
        const chunk = await save.slice(lo, Math.min(save.size, end + MARK.length)).text();
        if (!chunk.includes(MARK)) continue;
        const r = fromWindow(await save.slice(Math.max(0, lo - PAD), Math.min(save.size, end + MARK.length + PAD)).text());
        if (r !== null) return r;
    }
    return { id: null, include: null };
}

/** The index just past the JSON object starting at `start` (strings and escapes skipped), or -1 when it is cut off. */
function jsonObjectEnd(text: string, start: number): number {
    let depth = 0;
    let inString = false;
    for (let i = start; i < text.length; i++) {
        const c = text.charCodeAt(i);
        if (inString) {
            if (c === 92) i++; // backslash
            else if (c === 34) inString = false;
            continue;
        }
        if (c === 34) inString = true;
        else if (c === 123 || c === 91) depth++;
        else if (c === 125 || c === 93) {
            depth--;
            if (depth === 0) return i + 1;
        }
    }
    return -1;
}
