// Images embedded in the original's WinForms resources (DistantWorlds/Main.resx), read at runtime from the user's
// install through /assets/dwu/ (CLAUDE.md "Art": never copied into the repo). A resx bitmap is a base64 BinaryFormatter
// blob of System.Drawing.Bitmap whose payload is the PNG file; the PNG is cut out of it by its signature and IEND chunk.
// Used for pictures the original draws from its resources rather than from images/ (e.g. picExpansionPlannerImage).

/** URL of the decompiled Main.resx inside the install (the Customization tree ships with the decompiled source). */
export const MAIN_RESX_URL = '/assets/dwu/Customization/DistantWorldsExpanded-main/DistantWorldsExpanded/DistantWorlds/Main.resx';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The base64 `<value>` of `<data name="…">` in a resx document, whitespace removed; null when absent. */
export function resxDataBase64(resx: string, name: string): string | null {
    const at = resx.indexOf(`<data name="${name}"`);
    if (at < 0) return null;
    const v0 = resx.indexOf('<value>', at);
    const end = resx.indexOf('</data>', at);
    if (v0 < 0 || (end >= 0 && v0 > end)) return null;
    const v1 = resx.indexOf('</value>', v0);
    if (v1 < 0) return null;
    return resx.slice(v0 + 7, v1).replace(/\s+/g, '');
}

/** The PNG file inside a BinaryFormatter Bitmap blob (from the signature through the IEND chunk); null when none. */
export function pngFromBlob(bytes: Uint8Array): Uint8Array | null {
    let start = -1;
    outer: for (let i = 0; i + PNG_SIGNATURE.length <= bytes.length; i++) {
        for (let k = 0; k < PNG_SIGNATURE.length; k++) if (bytes[i + k] !== PNG_SIGNATURE[k]) continue outer;
        start = i;
        break;
    }
    if (start < 0) return null;
    // Walk the chunks (4-byte big-endian length, 4-byte type, data, 4-byte CRC) to IEND.
    let p = start + 8;
    while (p + 8 <= bytes.length) {
        const len = ((bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3]) >>> 0;
        const type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
        p += 12 + len;
        if (type === 'IEND') return p <= bytes.length ? bytes.slice(start, p) : null;
    }
    return null;
}

function decodeBase64(b64: string): Uint8Array {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

let resxText: Promise<string | null> | null = null;
const urls = new Map<string, Promise<string | null>>();

/** An object URL of the PNG resource `name` of Main.resx (e.g. 'picExpansionPlannerImage.Image'); null when the
 *  install has no decompiled source or the entry is missing. Cached. */
export function mainResxImageUrl(name: string): Promise<string | null> {
    let u = urls.get(name);
    if (u === undefined) {
        resxText ??= fetch(MAIN_RESX_URL)
            .then((r) => (r.ok ? r.text() : null))
            .catch(() => null);
        u = resxText.then((t) => {
            if (t === null) return null;
            const b64 = resxDataBase64(t, name);
            if (b64 === null) return null;
            const png = pngFromBlob(decodeBase64(b64));
            return png === null ? null : URL.createObjectURL(new Blob([png as BlobPart], { type: 'image/png' }));
        });
        urls.set(name, u);
    }
    return u;
}
