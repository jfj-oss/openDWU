// Usage: node scripts/make-icon.mjs [outDir]   (default: release/icons)
//
// The desktop app's own icon, drawn procedurally (our own art: no original game files, nothing binary committed):
// a ringed planet with a moon on a starfield, in a rounded square. Written as
//   icon.png (1024 px; the window icon fallback and the Linux AppImage / .desktop icon), icon-512.png, icon-256.png,
//   icon.icns (macOS: PNG-coded icp4..ic14 entries) and icon.ico (Windows: 16..256 px, 32-bit DIB below 256, PNG at 256).
// Used by scripts/package-desktop.mjs. Pure Node (zlib only), deterministic output.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Drawing: colour of the unit square at (x, y) in [0, 1] (y down), premultiplied-free RGBA in [0, 1]
// ---------------------------------------------------------------------------

const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => {
    const t = clamp((x - e0) / (e1 - e0));
    return t * t * (3 - 2 * t);
};

// Deterministic star field (xorshift).
const STARS = (() => {
    let s = 0x9e3779b9;
    const rnd = () => {
        s ^= s << 13;
        s >>>= 0;
        s ^= s >>> 17;
        s ^= s << 5;
        s >>>= 0;
        return s / 4294967296;
    };
    const out = [];
    for (let i = 0; i < 70; i++) out.push({ x: rnd(), y: rnd(), r: 0.0025 + rnd() * rnd() * 0.009, a: 0.35 + rnd() * 0.65 });
    return out;
})();

const INSET = 0.075; // transparent margin (macOS icon grid)
const RADIUS = 0.2; // corner radius of the tile

/** Signed distance to the rounded tile (negative inside). */
function tileDist(x, y) {
    const hx = 0.5 - INSET;
    const qx = Math.abs(x - 0.5) - (hx - RADIUS);
    const qy = Math.abs(y - 0.5) - (hx - RADIUS);
    const ox = Math.max(qx, 0);
    const oy = Math.max(qy, 0);
    return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - RADIUS;
}

const PLANET = { x: 0.47, y: 0.55, r: 0.215 };
const MOON = { x: 0.755, y: 0.285, r: 0.045 };
const LIGHT = (() => {
    const v = [-0.55, -0.6, 0.58];
    const l = Math.hypot(...v);
    return v.map((c) => c / l);
})();
// Ring: ellipse around the planet, tilted.
const RING = { tilt: (-18 * Math.PI) / 180, squash: 0.3, inner: 0.285, outer: 0.395 };

function ringCoords(x, y) {
    const dx = x - PLANET.x;
    const dy = y - PLANET.y;
    const c = Math.cos(-RING.tilt);
    const s = Math.sin(-RING.tilt);
    const u = dx * c - dy * s;
    const v = (dx * s + dy * c) / RING.squash;
    return { rr: Math.hypot(u, v), front: v > 0 };
}

function ringColor(rr) {
    if (rr < RING.inner || rr > RING.outer) return null;
    const t = (rr - RING.inner) / (RING.outer - RING.inner);
    // Banded alpha with a gap (Cassini-style division).
    const bands = 0.55 + 0.3 * Math.sin(t * 38) * Math.sin(t * 11 + 1);
    const gap = 1 - 0.85 * (1 - smooth(0.0, 0.035, Math.abs(t - 0.62)));
    const edge = smooth(0, 0.06, t) * smooth(0, 0.08, 1 - t);
    const a = clamp(bands * gap * edge * 0.95);
    return [mix(0.98, 0.85, t), mix(0.84, 0.62, t), mix(0.55, 0.38, t), a];
}

function over(dst, src) {
    const a = src[3];
    return [mix(dst[0], src[0], a), mix(dst[1], src[1], a), mix(dst[2], src[2], a), dst[3] + a * (1 - dst[3])];
}

function sphereShade(x, y, body, base, dark) {
    const dx = (x - body.x) / body.r;
    const dy = (y - body.y) / body.r;
    const d2 = dx * dx + dy * dy;
    if (d2 > 1) return null;
    const nz = Math.sqrt(1 - d2);
    const lambert = clamp(dx * LIGHT[0] + dy * LIGHT[1] + nz * LIGHT[2]);
    const lit = smooth(-0.05, 0.9, lambert);
    return { lit, nz, dx, dy, col: [mix(dark[0], base[0], lit), mix(dark[1], base[1], lit), mix(dark[2], base[2], lit)] };
}

function sample(x, y) {
    const td = tileDist(x, y);
    if (td > 0) return [0, 0, 0, 0];
    // Background: deep-space gradient with a nebula glow.
    const g = clamp(Math.hypot(x - 0.25, y - 0.2) / 0.95);
    let c = [mix(0.1, 0.012, g), mix(0.17, 0.02, g), mix(0.36, 0.07, g), 1];
    const neb = Math.exp(-((x - 0.78) ** 2 + (y - 0.78) ** 2) / 0.03);
    c = over(c, [0.55, 0.22, 0.62, 0.45 * neb]);
    const neb2 = Math.exp(-((x - 0.2) ** 2 + (y - 0.82) ** 2) / 0.02);
    c = over(c, [0.12, 0.5, 0.62, 0.3 * neb2]);
    for (const s of STARS) {
        if (Math.abs(x - s.x) > s.r * 2.5 || Math.abs(y - s.y) > s.r * 2.5) continue;
        const d = Math.hypot(x - s.x, y - s.y);
        if (d < s.r * 2.5) c = over(c, [1, 1, 1, s.a * Math.exp(-((d / s.r) ** 2))]);
    }
    // Back half of the ring, then the planet (with an atmosphere rim), then the front half of the ring.
    const ring = ringCoords(x, y);
    const rc = ringColor(ring.rr);
    if (rc && !ring.front) c = over(c, [rc[0] * 0.8, rc[1] * 0.8, rc[2] * 0.8, rc[3]]);
    const pd = Math.hypot(x - PLANET.x, y - PLANET.y) / PLANET.r;
    if (pd < 1.12 && pd > 0.9) {
        const glow = Math.exp(-(((pd - 1.0) / 0.06) ** 2)) * 0.55;
        c = over(c, [0.45, 0.8, 1, glow]);
    }
    const p = sphereShade(x, y, PLANET, [0.36, 0.78, 0.92], [0.02, 0.06, 0.16]);
    if (p) {
        // Cloud bands across the planet, following the sphere.
        const lat = Math.asin(clamp(p.dy * Math.cos(RING.tilt) - p.dx * Math.sin(RING.tilt), -1, 1));
        const band = 0.5 + 0.5 * Math.sin(lat * 9 + Math.sin(p.dx * 5) * 0.8);
        const tint = [mix(p.col[0], p.col[0] * 0.7 + 0.2 * p.lit, band * 0.6), mix(p.col[1], p.col[1] * 0.85, band * 0.4), mix(p.col[2], p.col[2] * 0.95, band * 0.3)];
        const aa = smooth(1, 0.985, Math.hypot(p.dx, p.dy));
        c = over(c, [...tint, aa]);
    }
    if (rc && ring.front) c = over(c, rc);
    const m = sphereShade(x, y, MOON, [0.86, 0.84, 0.8], [0.05, 0.05, 0.08]);
    if (m) c = over(c, [...m.col, smooth(1, 0.94, Math.hypot(m.dx, m.dy))]);
    // A soft inner edge on the tile.
    const edge = smooth(-0.03, 0, td);
    c = over(c, [0.6, 0.75, 1, 0.18 * edge]);
    return c;
}

/** RGBA8 pixels of the icon at `size` px (supersampled). */
function render(size) {
    const ss = size >= 512 ? 2 : 4;
    const px = Buffer.alloc(size * size * 4);
    for (let j = 0; j < size; j++) {
        for (let i = 0; i < size; i++) {
            let r = 0;
            let g = 0;
            let b = 0;
            let a = 0;
            for (let sj = 0; sj < ss; sj++) {
                for (let si = 0; si < ss; si++) {
                    const c = sample((i + (si + 0.5) / ss) / size, (j + (sj + 0.5) / ss) / size);
                    r += c[0] * c[3];
                    g += c[1] * c[3];
                    b += c[2] * c[3];
                    a += c[3];
                }
            }
            const o = (j * size + i) * 4;
            const n = ss * ss;
            px[o] = a > 0 ? Math.round(clamp(r / a) * 255) : 0;
            px[o + 1] = a > 0 ? Math.round(clamp(g / a) * 255) : 0;
            px[o + 2] = a > 0 ? Math.round(clamp(b / a) * 255) : 0;
            px[o + 3] = Math.round(clamp(a / n) * 255);
        }
    }
    return px;
}

/** Area-average `px` (size `from`) down to `to` px, `from` a multiple of `to` (alpha-weighted colour). */
function downscale(px, from, to) {
    if (from === to) return px;
    const f = from / to;
    const out = Buffer.alloc(to * to * 4);
    for (let j = 0; j < to; j++) {
        for (let i = 0; i < to; i++) {
            let r = 0;
            let g = 0;
            let b = 0;
            let a = 0;
            for (let y = j * f; y < (j + 1) * f; y++) {
                for (let x = i * f; x < (i + 1) * f; x++) {
                    const o = (y * from + x) * 4;
                    const al = px[o + 3];
                    r += px[o] * al;
                    g += px[o + 1] * al;
                    b += px[o + 2] * al;
                    a += al;
                }
            }
            const o = (j * to + i) * 4;
            out[o] = a > 0 ? Math.round(r / a) : 0;
            out[o + 1] = a > 0 ? Math.round(g / a) : 0;
            out[o + 2] = a > 0 ? Math.round(b / a) : 0;
            out[o + 3] = Math.round(a / (f * f));
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// Encoders
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();

function crc32(buf) {
    let c = 0xffffffff;
    for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
}

export function encodePng(px, size) {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(size, 0);
    ihdr.writeUInt32BE(size, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // RGBA
    const raw = Buffer.alloc((size * 4 + 1) * size);
    for (let y = 0; y < size; y++) {
        raw[y * (size * 4 + 1)] = 0; // filter: none
        px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
    }
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        pngChunk('IHDR', ihdr),
        pngChunk('IDAT', deflateSync(raw, { level: 9 })),
        pngChunk('IEND', Buffer.alloc(0)),
    ]);
}

/** macOS .icns with PNG-coded entries (what iconutil writes). */
function encodeIcns(pngs) {
    const types = [
        ['icp4', 16],
        ['icp5', 32],
        ['icp6', 64],
        ['ic07', 128],
        ['ic08', 256],
        ['ic09', 512],
        ['ic10', 1024],
        ['ic11', 32],
        ['ic12', 64],
        ['ic13', 256],
        ['ic14', 512],
    ];
    const entries = types.map(([type, size]) => {
        const data = pngs.get(size);
        const head = Buffer.alloc(8);
        head.write(type, 0, 'ascii');
        head.writeUInt32BE(data.length + 8, 4);
        return Buffer.concat([head, data]);
    });
    const body = Buffer.concat(entries);
    const head = Buffer.alloc(8);
    head.write('icns', 0, 'ascii');
    head.writeUInt32BE(body.length + 8, 4);
    return Buffer.concat([head, body]);
}

/** 32-bit BGRA DIB (bottom-up, doubled height, with an AND mask) for an .ico entry. */
function encodeDib(px, size) {
    const header = Buffer.alloc(40);
    header.writeUInt32LE(40, 0);
    header.writeInt32LE(size, 4);
    header.writeInt32LE(size * 2, 8);
    header.writeUInt16LE(1, 12);
    header.writeUInt16LE(32, 14);
    header.writeUInt32LE(0, 16); // BI_RGB
    const xor = Buffer.alloc(size * size * 4);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const s = ((size - 1 - y) * size + x) * 4;
            const d = (y * size + x) * 4;
            xor[d] = px[s + 2];
            xor[d + 1] = px[s + 1];
            xor[d + 2] = px[s];
            xor[d + 3] = px[s + 3];
        }
    }
    const maskRow = Math.ceil(size / 32) * 4;
    const and = Buffer.alloc(maskRow * size); // all 0: alpha channel decides
    header.writeUInt32LE(xor.length + and.length, 20);
    return Buffer.concat([header, xor, and]);
}

function encodeIco(images) {
    const head = Buffer.alloc(6);
    head.writeUInt16LE(0, 0);
    head.writeUInt16LE(1, 2);
    head.writeUInt16LE(images.length, 4);
    const dir = Buffer.alloc(16 * images.length);
    let offset = 6 + dir.length;
    images.forEach(({ size, data }, i) => {
        const o = i * 16;
        dir[o] = size >= 256 ? 0 : size;
        dir[o + 1] = size >= 256 ? 0 : size;
        dir[o + 2] = 0;
        dir[o + 3] = 0;
        dir.writeUInt16LE(1, o + 4);
        dir.writeUInt16LE(32, o + 6);
        dir.writeUInt32LE(data.length, o + 8);
        dir.writeUInt32LE(offset, o + 12);
        offset += data.length;
    });
    return Buffer.concat([head, dir, ...images.map((im) => im.data)]);
}

/** Render every size and write the icon files into outDir; returns their paths. */
export function makeIcons(outDir) {
    mkdirSync(outDir, { recursive: true });
    const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
    const big = render(1024);
    // Power-of-two sizes are area averages of the 1024 px render; 24 and 48 px are rendered directly.
    const pixels = new Map(sizes.map((s) => [s, 1024 % s === 0 ? downscale(big, 1024, s) : render(s)]));
    const pngs = new Map(sizes.map((s) => [s, encodePng(pixels.get(s), s)]));
    const files = {
        png: path.join(outDir, 'icon.png'),
        png512: path.join(outDir, 'icon-512.png'),
        png256: path.join(outDir, 'icon-256.png'),
        icns: path.join(outDir, 'icon.icns'),
        ico: path.join(outDir, 'icon.ico'),
    };
    writeFileSync(files.png, pngs.get(1024));
    writeFileSync(files.png512, pngs.get(512));
    writeFileSync(files.png256, pngs.get(256));
    writeFileSync(files.icns, encodeIcns(pngs));
    writeFileSync(
        files.ico,
        encodeIco([16, 24, 32, 48, 64, 128, 256].map((s) => ({ size: s, data: s >= 256 ? pngs.get(s) : encodeDib(pixels.get(s), s) }))),
    );
    return files;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const out = path.resolve(process.argv[2] ?? path.join(root, 'release', 'icons'));
    const files = makeIcons(out);
    console.log(`icons: ${Object.values(files).join(', ')}`);
}
