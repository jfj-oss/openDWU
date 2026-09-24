// MHTML ("Single File Web Page", .mht) reader for the original Galactopedia
// help pages ($DWU/Help/*.mht, saved from Microsoft Word). The original shows
// them in an embedded IE WebBrowser (Main.Part5.cs method_459); here we split
// the MIME multipart/related archive ourselves: the HTML part (quoted-
// printable, us-ascii / windows-1252) plus its embedded images (base64).
//
// Pure: no DOM. Uses TextDecoder + atob (available in browsers and Node).

export interface MhtPart {
    /** Content-Location, e.g. "file:///C:/C323208E/Planet_Ocean_files/image002.png". */
    location: string;
    /** Lower-cased MIME type without parameters, e.g. "image/png". */
    contentType: string;
    bytes: Uint8Array;
}

export interface MhtDocument {
    /** Decoded HTML of the first text/html part ('' when none). */
    html: string;
    /** Content-Location of the HTML part (base for relative references). */
    htmlLocation: string;
    /** Every part (including the HTML one), in file order. */
    parts: MhtPart[];
}

/** Bytes -> "binary string" (one char per byte, no charset mapping). */
function bytesToBinary(bytes: Uint8Array): string {
    let out = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
        out += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
    }
    return out;
}

/** Quoted-printable -> bytes (RFC 2045: "=\r\n" soft breaks, "=XX" octets). */
export function decodeQuotedPrintable(s: string): Uint8Array {
    const src = s.replace(/=\r?\n/g, '');
    const out = new Uint8Array(src.length);
    let n = 0;
    for (let i = 0; i < src.length; i++) {
        const c = src.charCodeAt(i);
        if (c === 0x3d /* = */ && i + 2 < src.length &&/^[0-9A-Fa-f]{2}$/.test(src.substr(i + 1, 2))) {
            out[n++] = parseInt(src.substr(i + 1, 2), 16);
            i += 2;
        } else {
            out[n++] = c & 0xff;
        }
    }
    return out.slice(0, n);
}

/** Base64 -> bytes (whitespace ignored). */
export function decodeBase64(s: string): Uint8Array {
    const bin = atob(s.replace(/[^A-Za-z0-9+/=]/g, ''));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

/** Parse "Name: value" headers (with folded continuation lines). */
function parseHeaders(block: string): Map<string, string> {
    const headers = new Map<string, string>();
    const lines = block.split(/\r?\n/);
    let last = '';
    for (const line of lines) {
        if (/^[ \t]/.test(line) && last !== '') {
            headers.set(last, `${headers.get(last) ?? ''} ${line.trim()}`);
            continue;
        }
        const idx = line.indexOf(':');
        if (idx <= 0) continue;
        last = line.slice(0, idx).trim().toLowerCase();
        headers.set(last, line.slice(idx + 1).trim());
    }
    return headers;
}

/** Map an HTML charset label to one TextDecoder understands; Word's
 *  "us-ascii" pages actually contain windows-1252 bytes (e.g. 0x92 ’). */
function decoderFor(charset: string): TextDecoder {
    const cs = charset.toLowerCase();
    if (cs === 'utf-8' || cs === 'utf8') return new TextDecoder('utf-8');
    return new TextDecoder('windows-1252');
}

/** Split an .mht file into its parts and decode the HTML part. */
export function parseMht(data: Uint8Array): MhtDocument {
    const raw = bytesToBinary(data);
    const headerEnd = raw.search(/\r?\n\r?\n/);
    const topHeaders = parseHeaders(headerEnd >= 0 ? raw.slice(0, headerEnd) : raw);
    const topType = topHeaders.get('content-type') ?? '';
    const bm = /boundary="?([^";]+)"?/i.exec(topType);
    const doc: MhtDocument = { html: '', htmlLocation: '', parts: [] };
    if (!bm) return doc;
    const delimiter = `--${bm[1]}`;
    const chunks = raw.split(delimiter);
    // chunks[0] is the preamble; a chunk starting with "--" is the epilogue.
    for (let i = 1; i < chunks.length; i++) {
        const chunk = chunks[i];
        if (chunk.startsWith('--')) break;
        const body = chunk.replace(/^\r?\n/, '');
        const sep = /\r?\n\r?\n/.exec(body);
        if (!sep) continue;
        const headers = parseHeaders(body.slice(0, sep.index));
        let content = body.slice(sep.index + sep[0].length);
        content = content.replace(/\r?\n$/, '');
        const ctype = headers.get('content-type') ?? 'application/octet-stream';
        const contentType = ctype.split(';')[0].trim().toLowerCase();
        const encoding = (headers.get('content-transfer-encoding') ?? '').toLowerCase();
        let bytes: Uint8Array;
        if (encoding === 'base64') {
            bytes = decodeBase64(content);
        } else if (encoding === 'quoted-printable') {
            bytes = decodeQuotedPrintable(content);
        } else {
            bytes = new Uint8Array(content.length);
            for (let k = 0; k < content.length; k++) bytes[k] = content.charCodeAt(k) & 0xff;
        }
        const location = headers.get('content-location') ?? '';
        doc.parts.push({ location, contentType, bytes });
        if (contentType === 'text/html' && doc.html === '') {
            const cm = /charset="?([^";]+)"?/i.exec(ctype);
            doc.html = decoderFor(cm ? cm[1] : 'windows-1252').decode(bytes);
            doc.htmlLocation = location;
        }
    }
    return doc;
}

/** Last path segment of a file path / URL (handles both / and \). */
export function fileNameOf(ref: string): string {
    const clean = ref.split(/[?#]/)[0];
    const parts = clean.split(/[\\/]/);
    return parts[parts.length - 1] ?? '';
}

/** Find the part a (relative or absolute) reference in the HTML points to:
 *  exact Content-Location, then resolved against the HTML part's folder,
 *  then by trailing "<folder>/<file>" match (case-insensitive). */
export function findMhtPart(doc: MhtDocument, ref: string): MhtPart | null {
    const r = decodeURIComponent(ref.trim()).replace(/\\/g, '/').toLowerCase();
    if (r === '') return null;
    const byLoc = (loc: string): MhtPart | undefined => doc.parts.find((p) => p.location.replace(/\\/g, '/').toLowerCase() === loc);
    const exact = byLoc(r);
    if (exact) return exact;
    const base = doc.htmlLocation.replace(/\\/g, '/');
    const dir = base.slice(0, base.lastIndexOf('/') + 1).toLowerCase();
    const resolved = byLoc(dir + r.replace(/^\.\//, ''));
    if (resolved) return resolved;
    const tail = r.split('/').slice(-2).join('/');
    return doc.parts.find((p) => p.location.replace(/\\/g, '/').toLowerCase().endsWith(`/${tail}`)) ?? null;
}
