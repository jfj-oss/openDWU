// Soft-edged territory bitmap (docs/territory.md section 3). The original rasterises the owner of every pixel in the
// owner's MainColor, then GraphicsHelper.SmoothImage (GraphicsHelper.cs 197-204: scale to 1.1x and back, bilinear)
// softens it about a pixel, and the result is blended at 25% (Main View) or 40% (Galaxy Map window,
// GalaxyMap.cs 141-157). This builds the same thing once per territory rebuild from the influence grid of
// territoryField.ts, one texel per grid cell:
//
// - Coverage: a cell fully inside one empire takes its colour; a border cell is split between the empires whose
//   s_E > 0 region crosses it, by 4x4 sub-samples of the bilinear s_E (the same field the crisp meshes contour), so
//   the bitmap's half-alpha line is the mesh edge and the crossfade between the two does not shift the border.
// - Blur: a separable 9-tap binomial ([1 2 1] four times; sigma ~1.4 cells, about 1.4 screen px at galaxy zoom on
//   1080p, 3 device px at 4K) on PREMULTIPLIED colour, so rival borders blend into each other with no gap and the
//   outer edge fades to transparent. Clamped at the grid edge, so the galaxy-edge clip stays hard.
// - Precision: everything is Float32 with no intermediate rounding (8-bit rounding repeated per blur pass and an
//   8-bit un-premultiply made the old low-alpha edges blotchy). The result is stored as premultiplied half floats
//   (`data`, ready for an rgba16float texture); the 8-bit consumers (WebGL1 texture fallback, the Galaxy Map canvas)
//   quantise once from it with an ordered dither.
//
// Never per frame (the Main View layer time-slices the generator); the result is cached per galaxy and shared.
// Pure apart from the cache and the canvas helpers. No Pixi.

import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import { TerritoryGrid, collectTerritorySources, splatInfluence, territorySignature, TERRITORY_GRID_CELLS, type TerritorySource } from './territoryField';

export interface TerritoryRaster {
    width: number;
    height: number;
    /** Premultiplied RGBA as IEEE half floats (0..1), row-major from the galaxy's top-left. */
    data: Uint16Array;
    /** World units per pixel. */
    cell: number;
    /** Pixels (fractional) that lie inside the galaxy: sizeX / cell, sizeY / cell. */
    usedW: number;
    usedH: number;
}

/** Binomial blur radius in cells: a (2R+1)-tap kernel = [1 2 1] applied R times (sigma = sqrt(R / 2) cells). */
export const TERRITORY_BLUR_RADIUS = 4;

/** Normalised binomial kernel of radius R (row R*2 of Pascal's triangle / 4^R). */
function binomialKernel(radius: number): Float32Array {
    const n = 2 * radius;
    const k = new Float32Array(n + 1);
    let c = 1;
    for (let i = 0; i <= n; i++) {
        k[i] = c;
        c = (c * (n - i)) / (i + 1);
    }
    const sum = 2 ** n;
    for (let i = 0; i <= n; i++) k[i] /= sum;
    return k;
}
const KERNEL = binomialKernel(TERRITORY_BLUR_RADIUS);

/** Horizontal pass of rows [y0, y1): src -> dst (RGBA float), clamped at the left / right edge. */
function blurRowsF(src: Float32Array, dst: Float32Array, w: number, y0: number, y1: number, k: Float32Array): void {
    const R = (k.length - 1) >> 1;
    for (let y = y0; y < y1; y++) {
        const row = y * w;
        for (let x = 0; x < w; x++) {
            let r = 0, g = 0, b = 0, a = 0;
            for (let t = -R; t <= R; t++) {
                let xx = x + t;
                if (xx < 0) xx = 0;
                else if (xx >= w) xx = w - 1;
                const s = (row + xx) * 4;
                const kv = k[t + R];
                r += kv * src[s];
                g += kv * src[s + 1];
                b += kv * src[s + 2];
                a += kv * src[s + 3];
            }
            const o = (row + x) * 4;
            dst[o] = r;
            dst[o + 1] = g;
            dst[o + 2] = b;
            dst[o + 3] = a;
        }
    }
}
/** Vertical pass of rows [y0, y1): src -> dst, clamped at the top / bottom edge. */
function blurColsF(src: Float32Array, dst: Float32Array, w: number, h: number, y0: number, y1: number, k: Float32Array): void {
    const R = (k.length - 1) >> 1;
    const W4 = w * 4;
    for (let y = y0; y < y1; y++) {
        const o = y * W4;
        for (let q = 0; q < W4; q++) dst[o + q] = 0;
        for (let t = -R; t <= R; t++) {
            let yy = y + t;
            if (yy < 0) yy = 0;
            else if (yy >= h) yy = h - 1;
            const s = yy * W4;
            const kv = k[t + R];
            for (let q = 0; q < W4; q++) dst[o + q] += kv * src[s + q];
        }
    }
}

/**
 * Separable binomial blur of a premultiplied RGBA float image in place (`tmp` is scratch of the same size).
 * Generator: yields every 32 rows of each pass.
 */
export function* blurTerritoryFloat(img: Float32Array, tmp: Float32Array, w: number, h: number, radius = TERRITORY_BLUR_RADIUS): Generator<void, void, void> {
    const k = radius === TERRITORY_BLUR_RADIUS ? KERNEL : binomialKernel(radius);
    for (let y = 0; y < h; y += 32) {
        blurRowsF(img, tmp, w, y, Math.min(h, y + 32), k);
        yield;
    }
    for (let y = 0; y < h; y += 32) {
        blurColsF(tmp, img, w, h, y, Math.min(h, y + 32), k);
        yield;
    }
}

export function blurTerritoryFloatSync(img: Float32Array, w: number, h: number, radius = TERRITORY_BLUR_RADIUS): void {
    const g = blurTerritoryFloat(img, new Float32Array(img.length), w, h, radius);
    while (g.next().done !== true) { /* run to completion */ }
}

// --- half floats ------------------------------------------------------------------------------------------------------

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

/** IEEE 754 binary16 bits of `v` (round to nearest; overflow to infinity; NaN kept). */
export function toHalf(v: number): number {
    f32[0] = v;
    const x = u32[0];
    const sign = (x >>> 16) & 0x8000;
    const exp = (x >>> 23) & 0xff;
    const man = x & 0x7fffff;
    if (exp === 0xff) return sign | 0x7c00 | (man !== 0 ? 0x200 : 0);
    const e = exp - 127 + 15;
    if (e >= 31) return sign | 0x7c00;
    if (e <= 0) {
        if (e < -10) return sign;
        const m = (man | 0x800000) >>> (1 - e);
        return sign | ((m + 0x1000) >>> 13);
    }
    // Rounding may carry into the exponent, which is the correctly rounded result.
    return sign | (((e << 10) | (man >>> 13)) + ((man >>> 12) & 1));
}

let halfTable: Float32Array | null = null;
/** Float value of every binary16 bit pattern (256 KB, built once). */
export function halfToFloatTable(): Float32Array {
    if (halfTable !== null) return halfTable;
    const t = new Float32Array(65536);
    for (let h = 0; h < 65536; h++) {
        const s = h & 0x8000 ? -1 : 1;
        const e = (h >>> 10) & 0x1f;
        const m = h & 0x3ff;
        t[h] = e === 0 ? s * m * 2 ** -24 : e === 31 ? (m === 0 ? s * Infinity : NaN) : s * (1 + m / 1024) * 2 ** (e - 15);
    }
    halfTable = t;
    return t;
}

// --- rasterise --------------------------------------------------------------------------------------------------------

/** Scratch float images, reused across builds of the same size (taken while a build runs; a concurrent build allocates). */
let scratch: { n: number; a: Float32Array; b: Float32Array; busy: boolean } | null = null;
function takeScratch(n: number): { a: Float32Array; b: Float32Array; release: () => void } {
    if (scratch === null || scratch.n !== n) {
        if (scratch === null || !scratch.busy) scratch = { n, a: new Float32Array(n), b: new Float32Array(n), busy: false };
        else return { a: new Float32Array(n), b: new Float32Array(n), release: () => {} };
    } else if (scratch.busy) {
        return { a: new Float32Array(n), b: new Float32Array(n), release: () => {} };
    }
    const s = scratch;
    s.busy = true;
    s.a.fill(0);
    return { a: s.a, b: s.b, release: () => { s.busy = false; } };
}

/** Sub-samples per cell side for the coverage of a border cell. */
const SUB = 4;

/**
 * Rasterise the grid (after splatInfluence) into premultiplied float RGBA, one texel per cell, with anti-aliased
 * coverage (header), into `out` (zeroed, nx * ny * 4). Generator (yields every 64 rows).
 */
export function* rasterizeCoverage(grid: TerritoryGrid, colorOf: (owner: number) => number, out: Float32Array): Generator<void, void, void> {
    const { nx: w, ny: h, top, l1, l2 } = grid;
    const stride = w + 1;
    const rgb = new Map<number, Float32Array>();
    const colour = (e: number): Float32Array => {
        let c = rgb.get(e);
        if (c === undefined) {
            const v = colorOf(e - 1) & 0xffffff;
            c = new Float32Array([((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]);
            rgb.set(e, c);
        }
        return c;
    };
    // s_E at vertex k, as territoryField.ts buildTerritoryMeshes sAt.
    const sAt = (e: number, k: number): number => {
        const a = l1[k];
        const b = l2[k];
        if (top[k] === e) return Math.min(a, a - b);
        return Math.min(b, b - a);
    };
    const corners = [0, 0, 0, 0];
    const cand = [0, 0, 0, 0];
    for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
            const k00 = j * stride + i;
            corners[0] = k00;
            corners[1] = k00 + 1;
            corners[2] = k00 + 1 + stride;
            corners[3] = k00 + stride;
            if (l1[corners[0]] <= 0 && l1[corners[1]] <= 0 && l1[corners[2]] <= 0 && l1[corners[3]] <= 0) continue;
            const o = (j * w + i) * 4;
            const e0 = top[corners[0]];
            if (e0 !== 0 && top[corners[1]] === e0 && top[corners[2]] === e0 && top[corners[3]] === e0 &&
                sAt(e0, corners[0]) > 0 && sAt(e0, corners[1]) > 0 && sAt(e0, corners[2]) > 0 && sAt(e0, corners[3]) > 0) {
                const c = colour(e0);
                out[o] = c[0];
                out[o + 1] = c[1];
                out[o + 2] = c[2];
                out[o + 3] = 1;
                continue;
            }
            // Border cell: candidate owners are the top empires of the corners they own (influence >= 1 there).
            let nc = 0;
            for (let q = 0; q < 4; q++) {
                const e = top[corners[q]];
                if (e === 0 || l1[corners[q]] < 0) continue;
                let seen = false;
                for (let p = 0; p < nc; p++) if (cand[p] === e) seen = true;
                if (!seen) cand[nc++] = e;
            }
            let r = 0, g = 0, b = 0, a = 0;
            for (let p = 0; p < nc; p++) {
                const e = cand[p];
                const s0 = sAt(e, corners[0]);
                const s1 = sAt(e, corners[1]);
                const s2 = sAt(e, corners[2]);
                const s3 = sAt(e, corners[3]);
                let hits = 0;
                for (let sy = 0; sy < SUB; sy++) {
                    const fy = (sy + 0.5) / SUB;
                    const left = s0 + (s3 - s0) * fy;
                    const right = s1 + (s2 - s1) * fy;
                    for (let sx = 0; sx < SUB; sx++) {
                        const fx = (sx + 0.5) / SUB;
                        if (left + (right - left) * fx > 0) hits++;
                    }
                }
                if (hits === 0) continue;
                const cov = hits / (SUB * SUB);
                const c = colour(e);
                r += cov * c[0];
                g += cov * c[1];
                b += cov * c[2];
                a += cov;
            }
            if (a > 1) {
                // Three or more rivals in one cell: the runner-up bound can over-count; renormalise.
                r /= a;
                g /= a;
                b /= a;
                a = 1;
            }
            out[o] = r;
            out[o + 1] = g;
            out[o + 2] = b;
            out[o + 3] = a;
        }
        if ((j & 63) === 63) yield;
    }
}

/**
 * Rasterise the grid (after splatInfluence) into the blurred premultiplied bitmap (header). `colorOf(ownerIndex)`
 * gives 0xRRGGBB. Generator (yields every few dozen rows).
 */
export function* rasterizeTerritory(grid: TerritoryGrid, colorOf: (owner: number) => number): Generator<void, TerritoryRaster, void> {
    const { nx: w, ny: h } = grid;
    const n = w * h * 4;
    const s = takeScratch(n);
    try {
        yield* rasterizeCoverage(grid, colorOf, s.a);
        yield* blurTerritoryFloat(s.a, s.b, w, h);
        const data = new Uint16Array(n);
        const img = s.a;
        for (let o = 0; o < n; o++) {
            data[o] = toHalf(img[o]);
            if ((o & 0x3ffff) === 0x3ffff) yield;
        }
        return { width: w, height: h, data, cell: grid.cell, usedW: grid.sizeX / grid.cell, usedH: grid.sizeY / grid.cell };
    } finally {
        s.release();
    }
}

export function rasterizeTerritorySync(grid: TerritoryGrid, colorOf: (owner: number) => number): TerritoryRaster {
    const gen = rasterizeTerritory(grid, colorOf);
    for (;;) {
        const r = gen.next();
        if (r.done === true) return r.value;
    }
}

/** Splat + rasterise from sources (the mini maps, tests). */
export function buildTerritoryRasterSync(sources: readonly TerritorySource[], sizeX: number, sizeY: number, colorOf: (owner: number) => number): TerritoryRaster {
    const grid = new TerritoryGrid(sizeX, sizeY);
    const g = splatInfluence(sources, grid);
    while (g.next().done !== true) { /* run to completion */ }
    return rasterizeTerritorySync(grid, colorOf);
}

/** Premultiplied float RGBA of texel (x, y) (tests, tools). */
export function rasterTexel(r: TerritoryRaster, x: number, y: number): [number, number, number, number] {
    const t = halfToFloatTable();
    const o = (y * r.width + x) * 4;
    return [t[r.data[o]], t[r.data[o + 1]], t[r.data[o + 2]], t[r.data[o + 3]]];
}

// --- 8-bit output (ordered dither) ------------------------------------------------------------------------------------

/** 8x8 Bayer matrix as quantisation offsets in (-0.5, 0.5): zero-mean, so the average level is exact. */
const BAYER8 = Float32Array.from([
    0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26,
    12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22,
    3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25,
    15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21,
], (v) => (v + 0.5) / 64 - 0.5);

const q8 = (v: number, d: number): number => {
    const q = Math.floor(v * 255 + 0.5 + d);
    return q < 0 ? 0 : q > 255 ? 255 : q;
};

/**
 * Premultiplied 8-bit RGBA (for an rgba8unorm texture with premultiplied alpha, where float textures are not
 * available). One quantisation from the half floats, all four channels with the same ordered-dither offset, so
 * colour never exceeds alpha.
 */
export function rasterToRgba8Premultiplied(r: TerritoryRaster): Uint8Array {
    const t = halfToFloatTable();
    const out = new Uint8Array(r.width * r.height * 4);
    for (let y = 0; y < r.height; y++) {
        for (let x = 0; x < r.width; x++) {
            const o = (y * r.width + x) * 4;
            const d = BAYER8[(y & 7) * 8 + (x & 7)];
            out[o] = q8(t[r.data[o]], d);
            out[o + 1] = q8(t[r.data[o + 1]], d);
            out[o + 2] = q8(t[r.data[o + 2]], d);
            out[o + 3] = q8(t[r.data[o + 3]], d);
        }
    }
    return out;
}

/**
 * Straight-alpha 8-bit RGBA for a 2D canvas (ImageData is straight alpha). The colour is un-premultiplied in float,
 * so it is the exact owner colour even at the faintest edge (no 8-bit un-premultiply blotches); only alpha carries the
 * gradient, quantised once with an ordered dither.
 */
export function rasterToRgba8Straight(r: TerritoryRaster): Uint8ClampedArray {
    const t = halfToFloatTable();
    const out = new Uint8ClampedArray(r.width * r.height * 4);
    for (let y = 0; y < r.height; y++) {
        for (let x = 0; x < r.width; x++) {
            const o = (y * r.width + x) * 4;
            const a = t[r.data[o + 3]];
            const a8 = q8(a, BAYER8[(y & 7) * 8 + (x & 7)]);
            if (a8 === 0 || !(a > 0)) continue;
            const inv = 255 / a;
            out[o] = Math.round(t[r.data[o]] * inv);
            out[o + 1] = Math.round(t[r.data[o + 1]] * inv);
            out[o + 2] = Math.round(t[r.data[o + 2]] * inv);
            out[o + 3] = a8;
        }
    }
    return out;
}

// --- shared cache ---------------------------------------------------------------------------------------------------

interface CacheEntry {
    sig: number;
    raster: TerritoryRaster;
    canvas: HTMLCanvasElement | null;
}
const cache = new WeakMap<Galaxy, CacheEntry>();

/** The Main View layer publishes the bitmap it just built so the mini maps reuse it. */
export function publishTerritoryRaster(galaxy: Galaxy, sig: number, raster: TerritoryRaster): void {
    cache.set(galaxy, { sig, raster, canvas: null });
}

/** territorySignature with the grid cell the Main View layer uses (TerritoryGrid default cells). */
export function galaxyTerritorySignature(galaxy: Galaxy, sources: readonly TerritorySource[]): number {
    return territorySignature(sources, Math.max(galaxy.sizeX, galaxy.sizeY) / TERRITORY_GRID_CELLS);
}

/** The cached (or freshly built, when the territory changed) bitmap for `viewer`'s knowledge. */
export function getTerritoryRaster(galaxy: Galaxy, viewer: Empire | null, colorOf: (owner: number) => number): TerritoryRaster {
    const sources = collectTerritorySources(galaxy, viewer);
    const sig = galaxyTerritorySignature(galaxy, sources);
    const hit = cache.get(galaxy);
    if (hit !== undefined && hit.sig === sig) return hit.raster;
    const raster = buildTerritoryRasterSync(sources, galaxy.sizeX, galaxy.sizeY, colorOf);
    cache.set(galaxy, { sig, raster, canvas: null });
    return raster;
}

/** Canvas copy of the cached bitmap (drawn with drawImage at 40% by the Galaxy Map windows), or null without a DOM.
 * Built once per raster from the float data (rasterToRgba8Straight), never read back. */
export function getTerritoryCanvas(galaxy: Galaxy, viewer: Empire | null, colorOf: (owner: number) => number): { canvas: HTMLCanvasElement; raster: TerritoryRaster } | null {
    if (typeof document === 'undefined') return null;
    const raster = getTerritoryRaster(galaxy, viewer, colorOf);
    const entry = cache.get(galaxy)!;
    if (entry.canvas === null) {
        const c = document.createElement('canvas');
        c.width = raster.width;
        c.height = raster.height;
        const ctx = c.getContext('2d');
        if (ctx === null) return null;
        ctx.putImageData(new ImageData(rasterToRgba8Straight(raster) as Uint8ClampedArray<ArrayBuffer>, raster.width, raster.height), 0, 0);
        entry.canvas = c;
    }
    return { canvas: entry.canvas, raster };
}

/** Draw the territory bitmap over the whole-galaxy map `mapW` px wide at `alpha` (GalaxyMap.cs 141-157: 0.4). */
export function drawTerritoryOnMap(ctx: CanvasRenderingContext2D, galaxy: Galaxy, viewer: Empire | null, colorOf: (owner: number) => number, mapW: number, alpha = 0.4): void {
    const t = getTerritoryCanvas(galaxy, viewer, colorOf);
    if (t === null) return;
    const k = mapW / galaxy.sizeX;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(t.canvas, 0, 0, t.raster.usedW, t.raster.usedH, 0, 0, galaxy.sizeX * k, galaxy.sizeY * k);
    ctx.restore();
}
