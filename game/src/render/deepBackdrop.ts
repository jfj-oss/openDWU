// "Deep (DW2-style)" galaxy backdrop and its variants (render-only): the install's galaxy_backdrop image, darkened at
// runtime by a tone curve (blacks kept, mids and highs pushed down, desaturated, a colour shift) with a layer of our own
// procedural dark dust (rimDust.ts fbmGrid noise) laid over it. Each kind is a DeepRecipe (DEEP_RECIPES); Deep's is the
// original look, the others change the curve, the colours and the amount of dust. The dust follows the galaxy shape (it is weighted by
// the original image's own brightness) and stays far dimmer than any star. Built once into a canvas; nothing of the
// original art is stored or copied -- it is read from the loaded texture and the result lives only in memory.

import { fbmGrid, sampleWrap } from './rimDust';

const MAX_PX = 2048;

function smooth(a: number, b: number, x: number): number {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
}

type Rgb = readonly [number, number, number];

/** How one backdrop kind is made from the original image (static canvas here, animated layer deepBackdropAnim.ts). */
export interface DeepRecipe {
    /** Tone curve of a 0..1 channel: gain * v^power (Deep: 0.72 * v^1.5). */
    toneGain: number;
    tonePower: number;
    /** Saturation kept (1 = the original's). */
    saturation: number;
    /** Per-channel multiplier after the curve (the colour shift). */
    shift: Rgb;
    /** Main dust colour, the second dust colour (where the palette noise is low), the accent (where it is high). */
    dustA: Rgb;
    dustB: Rgb;
    accent: Rgb;
    /** Floor added everywhere (between the clouds), x (0.55 + 0.45 * galaxy shape). */
    floor: Rgb;
    /** Dust amount (Deep 1.25). */
    dust: number;
    /** Animated glow and godray colours, and the glow strength. */
    glow: Rgb;
    rays: Rgb;
    glowStrength: number;
    /** Use the original nebulae compositing (source-over) instead of Deep's added tint-only clouds (mainView.ts). */
    originalNebulae?: boolean;
}

export type DeepKind = 'dimmedOriginal' | 'deep' | 'deepAzure' | 'deepEmber' | 'deepViolet';

const DEEP: DeepRecipe = {
    toneGain: 0.72,
    tonePower: 1.5,
    saturation: 0.8,
    shift: [1.05, 0.97, 0.95],
    dustA: [0.44, 0.19, 0.05],
    dustB: [0.44, 0.19, 0.05],
    accent: [0.03, 0.16, 0.24],
    floor: [0.012, 0.02, 0.05],
    dust: 1.25,
    glow: [0.3, 0.14, 0.05],
    rays: [0.24, 0.14, 0.07],
    glowStrength: 0.45,
};

/** Every kind but Original. */
export const DEEP_RECIPES: Readonly<Record<DeepKind, DeepRecipe>> = {
    deep: DEEP,
    dimmedOriginal: {
        toneGain: 0.92,
        tonePower: 1.12,
        saturation: 1,
        shift: [1, 1, 1],
        dustA: [0.16, 0.155, 0.15],
        dustB: [0.12, 0.125, 0.135],
        accent: [0.14, 0.14, 0.15],
        floor: [0.004, 0.006, 0.012],
        dust: 0.45,
        glow: [0.14, 0.13, 0.12],
        rays: [0.12, 0.12, 0.12],
        glowStrength: 0.25,
        originalNebulae: true,
    },
    deepAzure: {
        toneGain: 0.72,
        tonePower: 1.5,
        saturation: 0.7,
        shift: [0.9, 0.98, 1.1],
        dustA: [0.06, 0.13, 0.36],
        dustB: [0.15, 0.22, 0.33],
        accent: [0.02, 0.24, 0.25],
        floor: [0.008, 0.016, 0.055],
        dust: 1.3,
        glow: [0.08, 0.16, 0.3],
        rays: [0.1, 0.16, 0.24],
        glowStrength: 0.45,
    },
    deepEmber: {
        toneGain: 0.72,
        tonePower: 1.5,
        saturation: 0.6,
        shift: [1.12, 0.9, 0.7],
        dustA: [0.42, 0.06, 0.04],
        dustB: [0.4, 0.13, 0.03],
        accent: [0.3, 0.22, 0.05],
        floor: [0.03, 0.01, 0.014],
        dust: 1.4,
        glow: [0.34, 0.1, 0.03],
        rays: [0.26, 0.12, 0.05],
        glowStrength: 0.45,
    },
    deepViolet: {
        toneGain: 0.72,
        tonePower: 1.5,
        saturation: 0.75,
        shift: [1.02, 0.9, 1.08],
        dustA: [0.26, 0.06, 0.34],
        dustB: [0.38, 0.06, 0.24],
        accent: [0.06, 0.12, 0.36],
        floor: [0.02, 0.01, 0.045],
        dust: 1.35,
        glow: [0.26, 0.08, 0.3],
        rays: [0.18, 0.1, 0.26],
        glowStrength: 0.45,
    },
};

export function isDeepKind(kind: string): kind is DeepKind {
    return Object.prototype.hasOwnProperty.call(DEEP_RECIPES, kind);
}

/** Palette noise below this blend goes from the main dust colour to the second one (smoothstep lo..hi, reversed). */
export const DUST_B_LO = 0.26;
export const DUST_B_HI = 0.46;

/** Tone curve of one 0..1 channel: deep blacks, mids and highs pushed well down (Deep's curve by default). */
export function deepTone(v: number, r: DeepRecipe = DEEP): number {
    return r.toneGain * Math.pow(v, r.tonePower);
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
 * the dust baked into the canvas (1 = all of it; less when the animated layer draws the rest on top); `recipe` is the
 * kind's look (Deep by default); `maxPx` caps the canvas' long side (thumbnails).
 */
export function buildDeepBackdrop(src: CanvasImageSource, srcW: number, srcH: number, seed: number, staticDust = 1, recipe: DeepRecipe = DEEP, maxPx = MAX_PX): DeepBackdrop | null {
    if (typeof document === 'undefined' || srcW < 2 || srcH < 2) return null;
    const k = Math.min(1, maxPx / Math.max(srcW, srcH));
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
        const R = recipe;
        const sat = R.saturation;
        const [mr, mg, mb] = R.shift;
        const twoDust = R.dustA[0] !== R.dustB[0] || R.dustA[1] !== R.dustB[1] || R.dustA[2] !== R.dustB[2];
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
                // Tone curve, desaturation, colour shift (Deep: slight, a gentle warm/rust shift).
                const lum = 0.3 * r + 0.55 * g + 0.15 * b;
                r = lum + (r - lum) * sat;
                g = lum + (g - lum) * sat;
                b = lum + (b - lum) * sat;
                r = deepTone(r, R) * mr;
                g = deepTone(g, R) * mg;
                b = deepTone(b, R) * mb;
                // Procedural dust: soft low-frequency clouds, weighted by the galaxy's shape.
                const sx = Math.min(sw - 1.001, Math.max(0, (x / w) * sw - 0.5));
                const x0 = Math.floor(sx);
                const fx = sx - x0;
                const s0 = shape[y0 * sw + x0] * (1 - fx) + shape[y0 * sw + x0 + 1] * fx;
                const s1 = shape[(y0 + 1) * sw + x0] * (1 - fx) + shape[(y0 + 1) * sw + x0 + 1] * fx;
                const area = smooth(0.04, 0.5, s0 * (1 - fy) + s1 * fy);
                const cloud = smooth(0.38, 0.88, sampleWrap(dust, N, gx, gy)) * (0.35 + 0.65 * area);
                const wisp = smooth(0.55, 0.85, 1 - Math.abs(2 * sampleWrap(lane, N, gx, gy) - 1)) * 0.5 * area;
                const a = (cloud + wisp * cloud) * R.dust * staticDust;
                const tv = sampleWrap(tint, N, gx, gy);
                const teal = smooth(0.52, 0.76, tv);
                // Deep: dark rust / brown / orange, with the odd deep teal (the accent)
                let ar = R.dustA[0];
                let ag = R.dustA[1];
                let ab = R.dustA[2];
                if (twoDust) {
                    const m = 1 - smooth(DUST_B_LO, DUST_B_HI, tv);
                    ar += (R.dustB[0] - ar) * m;
                    ag += (R.dustB[1] - ag) * m;
                    ab += (R.dustB[2] - ab) * m;
                }
                const cr = ar * (1 - teal) + R.accent[0] * teal;
                const cg = ag * (1 - teal) + R.accent[1] * teal;
                const cb = ab * (1 - teal) + R.accent[2] * teal;
                // very dark floor (Deep: navy): space between the clouds is not black
                const navy = 0.55 + 0.45 * area;
                d[p] = Math.min(255, (r + cr * a + R.floor[0] * navy) * 255);
                d[p + 1] = Math.min(255, (g + cg * a + R.floor[1] * navy) * 255);
                d[p + 2] = Math.min(255, (b + cb * a + R.floor[2] * navy) * 255);
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
