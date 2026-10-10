// A save's text, kept out of the JS heap where it can be. serializeGame's text of a 100k-habitat galaxy is ~140M
// characters; as one string (two-byte as soon as one non-Latin-1 character is in it) beside the game it pushed the page
// past V8's heap cage — and in worker mode the string was copied again into the page by postMessage. So a save is made
// as a Blob: the text is written in chunks (serializeGameParts), each chunk encoded to UTF-8 bytes as soon as it is
// written, and the Blob of those bytes is what moves (worker → page: by reference) and what IndexedDB stores (the bytes
// go to the browser's blob storage). Old saves in the store, files and the dev `?load=` are still plain strings.
//
// Since saveCompression.ts the Blob is gzip (a 450 MB save is ~45 MB): serializeGameSave compresses the chunks, and
// every reader here inflates a gzip Blob (told apart by its first bytes, isGzipBlob) and reads an uncompressed one —
// old saves — as before. The text inside is unchanged.

import type { Game } from './sim/game';
import type { GalaxyTime } from './sim/galaxyTime';
import type { StartGameOptions } from './sim/startGameOptions';
import { serializeGameParts, type GameSaveExtras } from './sim/save/gameSave';
import { gunzipStream, gunzipText, gzipBlob, gzipParts, gzipString, isGzipBlob } from './saveCompression';

/** A save's text: a string, or a Blob of its UTF-8 bytes (gzip-compressed, or plain in older saves). */
export type SaveText = string | Blob;

/** serializeGame's text as an uncompressed Blob (UTF-8), made chunk by chunk: the JS heap only ever holds one chunk. */
export function serializeGameBlob(game: Game, time: GalaxyTime, startOptions: StartGameOptions, extras?: GameSaveExtras): Blob {
    return new Blob(serializeGamePartsBytes(game, time, startOptions, extras), { type: 'application/json' });
}

/**
 * The save of a game: serializeGame's text, gzip-compressed (saveCompression.ts). The text is written now, at the call
 * (synchronously: the save is of the game as it is at this boundary, and a throw is the caller's), then compressed
 * asynchronously — the game may run on meanwhile. Each UTF-8 chunk is dropped once the compressor has taken it.
 */
export function serializeGameSave(game: Game, time: GalaxyTime, startOptions: StartGameOptions, extras?: GameSaveExtras): Promise<Blob> {
    return gzipParts(serializeGamePartsBytes(game, time, startOptions, extras));
}

function serializeGamePartsBytes(game: Game, time: GalaxyTime, startOptions: StartGameOptions, extras?: GameSaveExtras): Uint8Array<ArrayBuffer>[] {
    const enc = new TextEncoder();
    return serializeGameParts(game, time, startOptions, (chunk) => enc.encode(chunk), undefined, extras);
}

/** The save as a gzip Blob (export: a .dwusave file is compressed): a compressed Blob as it is, else compressed now. */
export async function compressedSave(save: SaveText): Promise<Blob> {
    if (typeof save === 'string') return await gzipString(save);
    return (await isGzipBlob(save)) ? save : await gzipBlob(save);
}

/** The save's text as a string (a Blob is read, inflated first when compressed; a string is itself). */
export async function saveTextString(save: SaveText): Promise<string> {
    if (typeof save === 'string') return save;
    return (await isGzipBlob(save)) ? await gunzipText(save) : await save.text();
}

/**
 * The last `n` characters of the save's text (a Blob: of its last `n` bytes, enough for the key read from the tail).
 * A compressed Blob is inflated as a stream to its end, keeping only the last `n` bytes (a gzip stream has no index).
 */
export async function saveTextTail(save: SaveText, n: number): Promise<string> {
    if (typeof save === 'string') return save.slice(-n);
    if (!(await isGzipBlob(save))) return await save.slice(Math.max(0, save.size - n)).text();
    let tail = new Uint8Array(0);
    const reader = gunzipStream(save).getReader();
    for (;;) {
        const r = await reader.read();
        if (r.done) break;
        const chunk = r.value;
        if (chunk.length >= n) tail = chunk.slice(chunk.length - n);
        else {
            const keep = Math.min(tail.length, n - chunk.length);
            const next = new Uint8Array(keep + chunk.length);
            next.set(tail.subarray(tail.length - keep), 0);
            next.set(chunk, keep);
            tail = next;
        }
    }
    return new TextDecoder().decode(tail);
}

/** Its size in MB (characters of a string, bytes of a Blob — compressed bytes for a compressed save), for logs. */
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
    if (await isGzipBlob(save)) return (await scanGzipSave(save, MARK, PAD, fromWindow)) ?? { id: null, include: null };
    for (let end = save.size; end > 0; end -= CHUNK) {
        const lo = Math.max(0, end - CHUNK);
        const chunk = await save.slice(lo, Math.min(save.size, end + MARK.length)).text();
        if (!chunk.includes(MARK)) continue;
        const r = fromWindow(await save.slice(Math.max(0, lo - PAD), Math.min(save.size, end + MARK.length + PAD)).text());
        if (r !== null) return r;
    }
    return { id: null, include: null };
}

/**
 * readSaveScenarioRef for a compressed save: there is no reading from the end, so the text is inflated and decoded as a
 * stream from the start, and the last window (the `pad` characters before an occurrence of `mark`, and what follows
 * until `read` can parse it) wins. Only that window and the last `pad` characters are held, never the whole text.
 */
async function scanGzipSave<T>(save: Blob, mark: string, pad: number, read: (window: string) => T | null): Promise<T | null> {
    const reader = gunzipStream(save).getReader();
    const dec = new TextDecoder();
    let best: T | null = null;
    let win: string | null = null;
    const recent: string[] = [];
    let recentChars = 0;
    let carry = '';
    const take = (text: string): void => {
        if (text === '') return;
        const hit = (carry + text).includes(mark);
        if (win !== null) win += text;
        else if (hit) win = recent.join('') + text;
        if (win !== null) {
            const r = read(win);
            if (r !== null) {
                best = r;
                win = null;
            } else if (win.length > 4 * pad) win = null; // cut off for good: not the manifest
        }
        recent.push(text);
        recentChars += text.length;
        while (recent.length > 1 && recentChars - recent[0].length >= pad) recentChars -= recent.shift()!.length;
        carry = text.slice(-(mark.length - 1));
    };
    for (;;) {
        const r = await reader.read();
        if (r.done) break;
        take(dec.decode(r.value, { stream: true }));
    }
    take(dec.decode());
    return best;
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
