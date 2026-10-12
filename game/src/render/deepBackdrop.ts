// "Deep (DW2-style)" galaxy backdrop (render-only): the install's galaxy_backdrop image, darkened at runtime by a tone
// curve (blacks kept, mids and highs pushed down, slightly desaturated, a gentle rust shift) with a layer of our own
// procedural dark dust (rimDust.ts fbmGrid noise) laid over it. The dust follows the galaxy shape (it is weighted by
// the original image's own brightness) and stays far dimmer than any star. Built once into a canvas; nothing of the
// original art is stored or copied -- it is read from the loaded texture and the result lives only in memory.

import { fbmGrid, sampleWrap } from './rimDust';

const MAX_PX = 2048;

function smooth(a: number, b: number, x: number): number {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
}

/** Tone curve of one 0..1 channel: deep blacks, mids and highs pushed well down. */
export function deepTone(v: number): number {
    return 0.72 * Math.pow(v, 1.5);
}

/** Side of the square field texture handed to the animated layer (deepBackdropAnim.ts). */
export const DEEP_FIELD_SIZE = 256;

export interface DeepBackdrop {
    canvas: HTMLCanvasElement;
    /** DEEP_FIELD_SIZE^2 RGBA bytes: R galaxy-shape weight, G dust noise, B palette (teal) noise, A wisp noise. */
    field: Uint8Array;
}

/**
 * A DW2-style dark backdrop from `src` (the loaded original image), or null if it cannot be read. `staticDust` scales
 * the dust baked into the canvas (1 = all of it; less when the animated layer draws the rest on top).
 */
export function buildDeepBackdrop(src: CanvasImageSource, srcW: number, srcH: number, seed: number, staticDust = 1): DeepBackdrop | null {
    if (typeof document === 'undefined' || srcW < 2 || srcH < 2) return null;
    const k = Math.min(1, MAX_PX / Math.max(srcW, srcH));
    const w = Math.max(2, Math.round(srcW * k));
    const h = Math.max(2, Math.round(srcH * k));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    try {
        ctx.drawImage(src, 0, 0, w, h);
        const img = ctx.getImageData(0, 0, w, h);
        const d = img.data;
        const N = 512;
        const dust = fbmGrid(N, 3, 6, seed ^ 0xd33b, 0.55); // broad clouds with finer wisps
        const tint = fbmGrid(N, 2, 3, seed ^ 0x7ea1, 0.5); // which palette colour
        const lane = fbmGrid(N, 5, 4, seed ^ 0x51ed, 0.5); // thin wisps
        // Soft galaxy-shape weight: the original's brightness, blurred by drawing it tiny and back up.
        const sw = 64;
        const sh = Math.max(2, Math.round((sw * h) / w));
        const small = document.createElement('canvas');
        small.width = sw;
        small.height = sh;
        const sctx = small.getContext('2d', { willReadFrequently: true });
        const shape = new Float32Array(sw * sh);
        if (sctx) {
            sctx.drawImage(src, 0, 0, sw, sh);
            const sd = sctx.getImageData(0, 0, sw, sh).data;
            for (let i = 0; i < shape.length; i++) shape[i] = (0.3 * sd[i * 4] + 0.5 * sd[i * 4 + 1] + 0.2 * sd[i * 4 + 2]) / 255;
        }
        for (let y = 0; y < h; y++) {
            const gy = (y / h) * N;
            const sy = Math.min(sh - 1.001, Math.max(0, (y / h) * sh - 0.5));
            const y0 = Math.floor(sy);
            const fy = sy - y0;
            for (let x = 0; x < w; x++) {
                const gx = (x / w) * N;
                const p = (y * w + x) * 4;
                let r = d[p] / 255;
                let g = d[p + 1] / 255;
                let b = d[p + 2] / 255;
                // Tone curve, slight desaturation, gentle warm/rust shift.
                const lum = 0.3 * r + 0.55 * g + 0.15 * b;
                r = lum + (r - lum) * 0.8;
                g = lum + (g - lum) * 0.8;
                b = lum + (b - lum) * 0.8;
                r = deepTone(r) * 1.05;
                g = deepTone(g) * 0.97;
                b = deepTone(b) * 0.95;
                // Procedural dust: soft low-frequency clouds, weighted by the galaxy's shape.
                const sx = Math.min(sw - 1.001, Math.max(0, (x / w) * sw - 0.5));
                const x0 = Math.floor(sx);
                const fx = sx - x0;
                const s0 = shape[y0 * sw + x0] * (1 - fx) + shape[y0 * sw + x0 + 1] * fx;
                const s1 = shape[(y0 + 1) * sw + x0] * (1 - fx) + shape[(y0 + 1) * sw + x0 + 1] * fx;
                const area = smooth(0.04, 0.5, s0 * (1 - fy) + s1 * fy);
                const cloud = smooth(0.38, 0.88, sampleWrap(dust, N, gx, gy)) * (0.35 + 0.65 * area);
                const wisp = smooth(0.55, 0.85, 1 - Math.abs(2 * sampleWrap(lane, N, gx, gy) - 1)) * 0.5 * area;
                const a = (cloud + wisp * cloud) * 1.25 * staticDust;
                const teal = smooth(0.52, 0.76, sampleWrap(tint, N, gx, gy));
                // dark rust / brown / orange, with the odd deep teal
                const cr = 0.44 * (1 - teal) + 0.03 * teal;
                const cg = 0.19 * (1 - teal) + 0.16 * teal;
                const cb = 0.05 * (1 - teal) + 0.24 * teal;
                // very dark navy floor: space between the clouds is deep blue, not black
                const navy = 0.55 + 0.45 * area;
                d[p] = Math.min(255, (r + cr * a + 0.012 * navy) * 255);
                d[p + 1] = Math.min(255, (g + cg * a + 0.02 * navy) * 255);
                d[p + 2] = Math.min(255, (b + cb * a + 0.05 * navy) * 255);
            }
        }
        ctx.putImageData(img, 0, 0);
        const F = DEEP_FIELD_SIZE;
        const field = new Uint8Array(F * F * 4);
        for (let y = 0; y < F; y++) {
            const sy = Math.min(sh - 1.001, Math.max(0, (y / F) * sh - 0.5));
            const y0 = Math.floor(sy);
            const fy = sy - y0;
            for (let x = 0; x < F; x++) {
                const sx = Math.min(sw - 1.001, Math.max(0, (x / F) * sw - 0.5));
                const x0 = Math.floor(sx);
                const fx = sx - x0;
                const s0 = shape[y0 * sw + x0] * (1 - fx) + shape[y0 * sw + x0 + 1] * fx;
                const s1 = shape[(y0 + 1) * sw + x0] * (1 - fx) + shape[(y0 + 1) * sw + x0 + 1] * fx;
                const gx = (x / F) * N;
                const gy = (y / F) * N;
                const q = (y * F + x) * 4;
                field[q] = Math.round(smooth(0.04, 0.5, s0 * (1 - fy) + s1 * fy) * 255);
                field[q + 1] = Math.round(Math.min(1, Math.max(0, sampleWrap(dust, N, gx, gy))) * 255);
                field[q + 2] = Math.round(Math.min(1, Math.max(0, sampleWrap(tint, N, gx, gy))) * 255);
                field[q + 3] = Math.round(Math.min(1, Math.max(0, sampleWrap(lane, N, gx, gy))) * 255);
            }
        }
        return { canvas, field };
    } catch (err) {
        console.warn('deep backdrop: could not build, showing the original', err);
        return null;
    }
}
