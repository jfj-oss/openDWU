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
