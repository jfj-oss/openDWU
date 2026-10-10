// Save compression: a save's text is stored, exported and sent as gzip (a late-game save of 450 MB of JSON is ~45 MB).
// The platform's CompressionStream / DecompressionStream do the work (browser, Electron and Node 18+ all have them; no
// library), as streams: the text's chunks are fed in as they come and the compressed bytes collected in a Blob, and a
// load inflates the Blob as a stream. A gzip save starts with the gzip magic bytes (1f 8b); a save's text is JSON and
// starts with "{" — so a save in any store or file is told apart by its first two bytes, and old uncompressed saves
// load as before. The text inside is byte-identical to the uncompressed save (only the container changed).
//
// Headless: web-platform APIs only (no DOM / Pixi / Node APIs).

/** The gzip member header's first two bytes (RFC 1952 ID1 ID2). */
const GZIP_ID1 = 0x1f;
const GZIP_ID2 = 0x8b;

/** The MIME type of a compressed save Blob. */
export const GZIP_SAVE_TYPE = 'application/gzip';

/** Whether these bytes start a gzip stream. */
export function isGzipBytes(bytes: Uint8Array): boolean {
    return bytes.length >= 2 && bytes[0] === GZIP_ID1 && bytes[1] === GZIP_ID2;
}

/** Whether the Blob holds gzip (its first two bytes). */
export async function isGzipBlob(blob: Blob): Promise<boolean> {
    if (blob.size < 2) return false;
    return isGzipBytes(new Uint8Array(await blob.slice(0, 2).arrayBuffer()));
}

/**
 * gzip `parts` (the save's text in chunks: UTF-8 bytes, or strings encoded here) into one Blob. The array is consumed:
 * each chunk is dropped from it as it goes into the compressor, which takes the next one only when it has room, so
 * the input is released as the output grows instead of both being held whole.
 */
export async function gzipParts(parts: (Uint8Array | string)[]): Promise<Blob> {
    const cs = new CompressionStream('gzip');
    const out = new Response(cs.readable).blob();
    const writer = cs.writable.getWriter();
    const enc = new TextEncoder();
    try {
        for (let i = 0; i < parts.length; i++) {
            const p = parts[i];
            parts[i] = '';
            await writer.ready;
            // (A failed write fails close() and the output too: awaited there.)
            writer.write(typeof p === 'string' ? enc.encode(p) : (p as Uint8Array<ArrayBuffer>)).catch(() => undefined);
        }
        parts.length = 0;
        await writer.close();
    } catch (err) {
        writer.abort(err).catch(() => undefined);
        await out.catch(() => undefined);
        throw err;
    }
    return new Blob([await out], { type: GZIP_SAVE_TYPE });
}

/** gzip a Blob as a stream (an uncompressed save's bytes). */
export async function gzipBlob(blob: Blob): Promise<Blob> {
    const gz = await new Response(blob.stream().pipeThrough(new CompressionStream('gzip'))).blob();
    return new Blob([gz], { type: GZIP_SAVE_TYPE });
}

/** The inflated bytes of a gzip Blob, as a stream. */
export function gunzipStream(blob: Blob): ReadableStream<Uint8Array> {
    return blob.stream().pipeThrough(new DecompressionStream('gzip')) as ReadableStream<Uint8Array>;
}

/** A gzip Blob's text (UTF-8), inflated as a stream. */
export async function gunzipText(blob: Blob): Promise<string> {
    return await new Response(gunzipStream(blob)).text();
}

/** gzip a string (UTF-8) in chunks: the whole text is never encoded as one byte array. */
export function gzipString(text: string, chunkChars = 4 << 20): Promise<Blob> {
    const parts: string[] = [];
    let i = 0;
    while (i < text.length) {
        // Never split a surrogate pair (its halves would each encode as U+FFFD).
        let end = Math.min(text.length, i + chunkChars);
        const c = text.charCodeAt(end - 1);
        if (end < text.length && c >= 0xd800 && c <= 0xdbff) end++;
        parts.push(text.slice(i, end));
        i = end;
    }
    return gzipParts(parts);
}

// ---------------------------------------------------------------------------------------------------------------------
// Base64 for a text-only link (the lockstep transport sends strings).
// ---------------------------------------------------------------------------------------------------------------------

/** Bytes as base64 (btoa over 32 KB slices: no one huge argument list). */
export function bytesToBase64(bytes: Uint8Array): string {
    const pieces: string[] = [];
    const STEP = 0x8000;
    for (let i = 0; i < bytes.length; i += STEP) pieces.push(String.fromCharCode.apply(null, bytes.subarray(i, i + STEP) as unknown as number[]));
    return btoa(pieces.join(''));
}

/** base64 back to bytes. */
export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}
