// Soft-edged territory bitmap (docs/territory.md section 3). The original rasterises the owner of every pixel in the
// owner's MainColor, then GraphicsHelper.SmoothImage (GraphicsHelper.cs 197-204: scale to 1.1x and back, bilinear)
// softens it about a pixel, and the result is blended at 25% (Main View) or 40% (Galaxy Map window,
// GalaxyMap.cs 141-157). This builds the same thing once per territory rebuild from the influence grid of
// territoryField.ts: an RGBA bitmap, one pixel per grid cell, owner colour, a small binomial blur on premultiplied
// colour (so rival borders blend into each other with no gap and the outer edge fades), clamped at the galaxy edge
// (the clip stays hard). Never per frame; the result is cached per galaxy and shared by every consumer.
//
// Pure apart from the cache and the canvas helpers. No Pixi.

import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import { TerritoryGrid, collectTerritorySources, splatInfluence, territorySignature, TERRITORY_GRID_CELLS, type TerritorySource } from './territoryField';

export interface TerritoryRaster {
    width: number;
    height: number;
    /** Straight (non-premultiplied) RGBA; alpha is 255 inside territory before the blur. */
    data: Uint8ClampedArray;
    /** World units per pixel. */
    cell: number;
    /** Pixels (fractional) that lie inside the galaxy: sizeX / cell, sizeY / cell. */
    usedW: number;
    usedH: number;
}

/** Binomial [1 2 1]/4 passes applied to the bitmap (two passes: sigma of about one pixel, like SmoothImage). */
export const TERRITORY_BLUR_PASSES = 2;

function blurRows(src: Uint8ClampedArray, dst: Uint8ClampedArray, w: number, y0: number, y1: number): void {
    for (let y = y0; y < y1; y++) {
        const row = y * w * 4;
        for (let x = 0; x < w; x++) {
            const i = row + x * 4;
            const l = row + Math.max(0, x - 1) * 4;
            const r = row + Math.min(w - 1, x + 1) * 4;
            for (let c = 0; c < 4; c++) dst[i + c] = (src[l + c] + 2 * src[i + c] + src[r + c] + 2) >> 2;
        }
    }
}
function blurCols(src: Uint8ClampedArray, dst: Uint8ClampedArray, w: number, h: number, y0: number, y1: number): void {
    for (let y = y0; y < y1; y++) {
        const up = Math.max(0, y - 1) * w * 4;
        const mid = y * w * 4;
        const dn = Math.min(h - 1, y + 1) * w * 4;
        for (let k = 0; k < w * 4; k++) dst[mid + k] = (src[up + k] + 2 * src[mid + k] + src[dn + k] + 2) >> 2;
    }
}

/**
 * Rasterise the grid (after splatInfluence) into the blurred owner bitmap. Cell (i, j) takes the owner of whichever of
 * its four corner vertices has the strongest positive s_E (territoryField.ts header), so there is no half-cell shift.
 * `colorOf(ownerIndex)` gives 0xRRGGBB. Generator (yields every 64 rows).
 */
export function* rasterizeTerritory(grid: TerritoryGrid, colorOf: (owner: number) => number): Generator<void, TerritoryRaster, void> {
    const { nx: w, ny: h, top, l1, l2 } = grid;
    const stride = w + 1;
    const a = new Uint8ClampedArray(w * h * 4);
    const b = new Uint8ClampedArray(w * h * 4);
    const colours = new Map<number, number>();
    for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
            const k0 = j * stride + i;
            let bestS = 0;
            let bestE = 0;
            for (let q = 0; q < 4; q++) {
                const k = k0 + (q & 1) + (q >> 1) * stride;
                const e = top[k];
                if (e === 0) continue;
                const s = Math.min(l1[k], l1[k] - l2[k]);
                if (s > bestS) {
                    bestS = s;
                    bestE = e;
                }
            }
            if (bestE === 0) continue;
            let c = colours.get(bestE);
            if (c === undefined) {
                c = colorOf(bestE - 1) & 0xffffff;
                colours.set(bestE, c);
            }
            const o = (j * w + i) * 4;
            a[o] = (c >> 16) & 255;
            a[o + 1] = (c >> 8) & 255;
            a[o + 2] = c & 255;
            a[o + 3] = 255;
        }
        if ((j & 63) === 63) yield;
    }
    // Alpha is 0 or 255 here, so straight and premultiplied colour coincide (transparent pixels are black = premult 0).
    for (let pass = 0; pass < TERRITORY_BLUR_PASSES; pass++) {
        for (let y = 0; y < h; y += 64) {
            blurRows(a, b, w, y, Math.min(h, y + 64));
            yield;
        }
        for (let y = 0; y < h; y += 64) {
            blurCols(b, a, w, h, y, Math.min(h, y + 64));
            yield;
        }
    }
    // Un-premultiply for canvas / texture upload.
    for (let o = 0; o < a.length; o += 4) {
        const al = a[o + 3];
        if (al > 0 && al < 255) {
            a[o] = Math.round((a[o] * 255) / al);
            a[o + 1] = Math.round((a[o + 1] * 255) / al);
            a[o + 2] = Math.round((a[o + 2] * 255) / al);
        }
    }
    return { width: w, height: h, data: a, cell: grid.cell, usedW: grid.sizeX / grid.cell, usedH: grid.sizeY / grid.cell };
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

/** Canvas copy of the cached bitmap (drawn with drawImage at 40% by the Galaxy Map windows), or null without a DOM. */
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
        ctx.putImageData(new ImageData(new Uint8ClampedArray(raster.data), raster.width, raster.height), 0, 0);
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
    ctx.drawImage(t.canvas, 0, 0, t.raster.usedW, t.raster.usedH, 0, 0, galaxy.sizeX * k, galaxy.sizeY * k);
    ctx.restore();
}
