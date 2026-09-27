// Shared procedural creature rig (19g-7b "new fauna"; tasks/19-mod-layer-scenarios.md §19g-7b, art route "creature b"):
// the whale pilot's technique B (whalePilotLayer.ts) generalised to a BODY DEFINITION per variant —
//   silhouette spline, rope segment count, fin / fluke set, skin noise params, palette (sampled from an ORIGINAL creature
//   frame at runtime and hue-shifted; its luma distribution is matched so every look stays inside the originals' value
//   range), glow / spots, motion params —
// plus the lantern-shoal particle swarm and the TAMED LOOK harness (strapped containers in the original freighter's
// palette, a rigging line, warm work lights that blink with the ambient nav-light pattern, fade-in / debris drop).
//
// The raster functions are pure (typed arrays, no DOM): tests measure the rest poses with artStats against the original
// frames. The Pixi classes (CreatureRig, LanternSwarm, HarnessView) turn them into textures once and pose them per frame.
// Nothing here writes sim state; no galaxy.rnd (own hash noise).

import { Container, Graphics, MeshRope, Point, Sprite, Texture } from 'pixi.js';
import { useMinifyingFilter } from './assets';
import { lightsOn } from './ambientLayer';

// ---------------------------------------------------------------------------
// Statistics (moved here from the whale pilot; whalePilotLayer.ts re-exports it).

export interface ArtStats {
    /** Opaque (alpha ≥ 128) pixels measured. */
    pixels: number;
    /** Rec.709 luma of the sRGB values, 0..1: mean, standard deviation (contrast), 5th / 95th percentiles. */
    meanL: number;
    stdL: number;
    p5L: number;
    p95L: number;
    /** Mean HSV saturation. */
    meanSat: number;
    /** Mean colour (0..255) and its hue in degrees. */
    meanRGB: [number, number, number];
    hueDeg: number;
    /** Semi-transparent share of the visible pixels: semi / (semi + opaque). */
    softEdge: number;
    /** Mean alpha-ramp width (semi pixels / opaque boundary pixels) as a fraction of the silhouette's long side. */
    edgeWidthFrac: number;
    /** Long side of the alpha > 16 bounding box, px. */
    longSidePx: number;
}

export function artStats(data: ArrayLike<number>, w: number, h: number): ArtStats {
    const ls: number[] = [];
    let sumS = 0;
    let sr = 0;
    let sg = 0;
    let sb = 0;
    let semi = 0;
    let opaque = 0;
    let boundary = 0;
    let minX = w;
    let minY = h;
    let maxX = -1;
    let maxY = -1;
    const alphaAt = (x: number, y: number): number => (x < 0 || y < 0 || x >= w || y >= h ? 0 : data[(y * w + x) * 4 + 3]);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            const a = data[i + 3];
            if (a > 16) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
            if (a >= 247) {
                opaque++;
                if (alphaAt(x - 1, y) < 247 || alphaAt(x + 1, y) < 247 || alphaAt(x, y - 1) < 247 || alphaAt(x, y + 1) < 247) boundary++;
            } else if (a > 8) {
                semi++;
            }
            if (a < 128) continue;
            const r = data[i] / 255;
            const g = data[i + 1] / 255;
            const b = data[i + 2] / 255;
            ls.push(0.2126 * r + 0.7152 * g + 0.0722 * b);
            const mx = Math.max(r, g, b);
            const mn = Math.min(r, g, b);
            sumS += mx > 0 ? (mx - mn) / mx : 0;
            sr += r;
            sg += g;
            sb += b;
        }
    }
    const n = ls.length;
    const longSidePx = maxX < 0 ? 0 : Math.max(maxX - minX + 1, maxY - minY + 1);
    if (n === 0) {
        return { pixels: 0, meanL: 0, stdL: 0, p5L: 0, p95L: 0, meanSat: 0, meanRGB: [0, 0, 0], hueDeg: 0, softEdge: 0, edgeWidthFrac: 0, longSidePx };
    }
    let sumL = 0;
    for (const l of ls) sumL += l;
    const meanL = sumL / n;
    let varL = 0;
    for (const l of ls) varL += (l - meanL) * (l - meanL);
    const sorted = ls.slice().sort((p, q) => p - q);
    const pct = (p: number): number => sorted[Math.min(n - 1, Math.floor(p * n))];
    const mr = sr / n;
    const mg = sg / n;
    const mb = sb / n;
    return {
        pixels: n,
        meanL,
        stdL: Math.sqrt(varL / n),
        p5L: pct(0.05),
        p95L: pct(0.95),
        meanSat: sumS / n,
        meanRGB: [Math.round(mr * 255), Math.round(mg * 255), Math.round(mb * 255)],
        hueDeg: hueOf(mr, mg, mb),
        softEdge: semi / Math.max(1, semi + opaque),
        edgeWidthFrac: longSidePx > 0 ? semi / Math.max(1, boundary) / longSidePx : 0,
        longSidePx,
    };
}

function hueOf(r: number, g: number, b: number): number {
    const mx = Math.max(r, g, b);
    const d = mx - Math.min(r, g, b);
    if (d <= 0) return 0;
    let hh: number;
    if (mx === r) hh = ((g - b) / d) % 6;
    else if (mx === g) hh = (b - r) / d + 2;
    else hh = (r - g) / d + 4;
    return Math.round((hh * 60 + 360) % 360);
}

export function roundStats(s: ArtStats): Record<string, unknown> {
    const r3 = (x: number): number => Math.round(x * 1000) / 1000;
    return {
        meanL: r3(s.meanL),
        stdL: r3(s.stdL),
        p5L: r3(s.p5L),
        p95L: r3(s.p95L),
        meanSat: r3(s.meanSat),
        meanRGB: s.meanRGB,
        hueDeg: s.hueDeg,
        softEdge: r3(s.softEdge),
        edgeWidthFrac: Math.round(s.edgeWidthFrac * 10000) / 10000,
        longSidePx: s.longSidePx,
        pixels: s.pixels,
    };
}

// ---------------------------------------------------------------------------
// Noise (own hash; never galaxy.rnd).

export function makeValueNoise(seed: number): (x: number, y: number) => number {
    const hash = (ix: number, iy: number): number => {
        let hh = (ix * 374761393 + iy * 668265263 + seed * 144269504) | 0;
        hh = Math.imul(hh ^ (hh >>> 13), 1274126177);
        hh ^= hh >>> 16;
        return (hh >>> 0) / 4294967296;
    };
    const smooth = (t: number): number => t * t * (3 - 2 * t);
    return (x, y) => {
        const ix = Math.floor(x);
        const iy = Math.floor(y);
        const fx = smooth(x - ix);
        const fy = smooth(y - iy);
        const a = hash(ix, iy);
        const b = hash(ix + 1, iy);
        const c = hash(ix, iy + 1);
        const d = hash(ix + 1, iy + 1);
        return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
    };
}

export function fbm(noise: (x: number, y: number) => number, x: number, y: number, octaves: number): number {
    let sum = 0;
    let amp = 0.5;
    let norm = 0;
    let fx = x;
    let fy = y;
    for (let o = 0; o < octaves; o++) {
        sum += amp * noise(fx, fy);
        norm += amp;
        amp *= 0.5;
        fx *= 2.03;
        fy *= 2.03;
    }
    return sum / norm;
}

export const smoothstep = (e0: number, e1: number, x: number): number => {
    const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------------------
// Palette: sampled from an original frame, re-hued.

type Rgb = [number, number, number];

/** An original frame's colours: the mean colour per luma bin and its sorted opaque luma (subsampled). */
export interface PaletteSource {
    /** 32 bins: [sum r, sum g, sum b, count] of the opaque pixels (0..1 channels). */
    bins: number[][];
    /** Sorted opaque luma values (at most 4096, evenly subsampled). */
    luma: number[];
    /** The frame's measured edge softness (artStats edgeWidthFrac). */
    edgeWidthFrac: number;
}

export function paletteSourceFromRgba(data: ArrayLike<number>, w: number, h: number): PaletteSource {
    const bins = Array.from({ length: 32 }, () => [0, 0, 0, 0]);
    const all: number[] = [];
    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 128) continue;
        const r = data[i] / 255;
        const g = data[i + 1] / 255;
        const b = data[i + 2] / 255;
        const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const k = Math.min(31, Math.floor(l * 32));
        bins[k][0] += r;
        bins[k][1] += g;
        bins[k][2] += b;
        bins[k][3]++;
        all.push(l);
    }
    all.sort((p, q) => p - q);
    const luma: number[] = [];
    const step = Math.max(1, all.length / 4096);
    for (let i = 0; i < all.length; i += step) luma.push(all[Math.floor(i)]);
    return { bins, luma, edgeWidthFrac: artStats(data, w, h).edgeWidthFrac };
}

/** A neutral stand-in when the install is missing (grey ramp, soft Kaltor-like edge). */
export function fallbackPaletteSource(): PaletteSource {
    const bins = Array.from({ length: 32 }, (_, k) => {
        const l = (k + 0.5) / 32;
        return [l * 10, l * 10, l * 10, 10];
    });
    const luma: number[] = [];
    for (let i = 0; i < 256; i++) luma.push(0.05 + 0.65 * Math.pow(i / 255, 1.3));
    return { bins, luma, edgeWidthFrac: 0.007 };
}

/** 32-step colour ramp: each bin's colour re-hued to hueDeg with its saturation × satMul and its luma kept (pilot B). */
export function rehuedRamp(src: PaletteSource, hueDeg: number, satMul: number): Rgb[] {
    const hh = (((hueDeg % 360) + 360) % 360) / 60;
    const x = 1 - Math.abs((hh % 2) - 1);
    const hueRgb: Rgb = hh < 1 ? [1, x, 0] : hh < 2 ? [x, 1, 0] : hh < 3 ? [0, 1, x] : hh < 4 ? [0, x, 1] : hh < 5 ? [x, 0, 1] : [1, 0, x];
    const out: Rgb[] = [];
    for (let k = 0; k < 32; k++) {
        const [r, g, b, n] = src.bins[k];
        const lum = n > 0 ? (0.2126 * r + 0.7152 * g + 0.0722 * b) / n : (k + 0.5) / 32;
        let sat = 0;
        if (n > 0) {
            const mx = Math.max(r, g, b) / n;
            sat = mx > 0 ? (mx - Math.min(r, g, b) / n) / mx : 0;
        }
        sat = Math.min(1, sat * satMul);
        const base = hueRgb.map((c) => 1 - sat + sat * c) as Rgb;
        const baseL = 0.2126 * base[0] + 0.7152 * base[1] + 0.0722 * base[2];
        const v = Math.min(1 / Math.max(...base), lum / baseL);
        out.push([base[0] * v * 255, base[1] * v * 255, base[2] * v * 255]);
    }
    return out;
}

/** The original's colours per luma bin, not re-hued (the container palette). Empty bins interpolate from the nearest. */
export function plainRamp(src: PaletteSource): Rgb[] {
    const out: (Rgb | null)[] = src.bins.map(([r, g, b, n]) => (n > 0 ? [(r / n) * 255, (g / n) * 255, (b / n) * 255] : null));
    for (let k = 0; k < 32; k++) {
        if (out[k] !== null) continue;
        let lo = k - 1;
        while (lo >= 0 && out[lo] === null) lo--;
        let hi = k + 1;
        while (hi < 32 && out[hi] === null) hi++;
        const l = (k + 0.5) / 32;
        const pick = lo >= 0 ? out[lo]! : hi < 32 ? out[hi]! : ([l * 255, l * 255, l * 255] as Rgb);
        out[k] = [...pick] as Rgb;
    }
    return out as Rgb[];
}

// ---------------------------------------------------------------------------
// Body definitions.

export type PaletteFrame = 'kaltor' | 'ardilus' | 'slug' | 'sandslug';

/** Frame 0 of each original creature used as a palette source (loaded at runtime from the install, never copied). */
export const PALETTE_FRAMES: Readonly<Record<PaletteFrame, string>> = {
    kaltor: 'kaltor/Kaltor_00000.png',
    ardilus: 'ardilus/ArdillusMoving2_00000.png',
    slug: 'spaceslug/Slug_00000.png',
    sandslug: 'sandslug/Sandworm_00000.png',
};

/** The original freighter frame the harness containers take their colours from. */
export const CONTAINER_PALETTE_FRAME = 'ships/family0/largefreighter.png';

export interface FinDef {
    /** Root along the body (0 tail … 1 head) and across it (fraction of the half-width). */
    u: number;
    v: number;
    /** Texture size (px) of the fin: length (root → tip) and width. */
    len: number;
    wid: number;
    /** Rest angle away from the body (rad, 0 = straight out, larger = swept back). */
    sweep: number;
    shape: 'leaf' | 'spike' | 'frond';
    flutterHz: number;
    flutterAmp: number;
}

export interface BodyDef {
    id: string;
    name: string;
    /** Silhouette spline: [u, half-width 0..1] knots from the tail (u 0) to the head (u 1). */
    silhouette: [number, number][];
    /** Rope points (body segments of the undulation). */
    segments: number;
    /** Body texture size (px): length × height. */
    texW: number;
    texH: number;
    fins: FinDef[];
    fluke: { len: number; span: number } | null;
    skin: { seed: number; noiseScale: number; noiseAmp: number; mottle: number; grooves: number; grooveFreq: number; grooveFrom: number; grooveTo: number; plates: number; plateFreq: number; spine: number };
    palette: { frame: PaletteFrame; hueDeg: number; satMul: number; lumaMul: number };
    glow: { rgb: Rgb; alpha: number; blurPx: number } | null;
    spots: { rows: number; count: number; uFrom: number; uTo: number; v: number; r: number; core: Rgb; halo: Rgb; head: number } | null;
    motion: { wavePeriodS: number; waveAmp: number; waveCycles: number; tailSweep: number };
    /** Drawn-width cap multiplier over the creature layer's 240 px / f cap (big bodies). */
    capMul: number;
}

/** Catmull-Rom through the silhouette knots, clamped to 0..1. */
export function silhouetteAt(def: BodyDef, u: number): number {
    const k = def.silhouette;
    if (u <= k[0][0]) return Math.max(0, k[0][1]);
    if (u >= k[k.length - 1][0]) return Math.max(0, k[k.length - 1][1]);
    let i = 0;
    while (i < k.length - 2 && u > k[i + 1][0]) i++;
    const p0 = k[Math.max(0, i - 1)][1];
    const p1 = k[i][1];
    const p2 = k[i + 1][1];
    const p3 = k[Math.min(k.length - 1, i + 2)][1];
    const t = (u - k[i][0]) / (k[i + 1][0] - k[i][0]);
    const t2 = t * t;
    const t3 = t2 * t;
    const v = 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
    return Math.max(0, Math.min(1, v));
}

/** The whale pilot's silhouette as knots (blunt head from u 0.62, tapering tail stalk). */
function pilotWhaleKnots(): [number, number][] {
    const out: [number, number][] = [];
    for (let i = 0; i <= 20; i++) {
        const u = i / 20;
        let hw: number;
        if (u >= 0.62) hw = Math.sqrt(Math.max(0, 1 - Math.pow((u - 0.62) / 0.38, 2.6)));
        else {
            const t = u / 0.62;
            hw = 0.2 + 0.8 * Math.pow(t * t * (3 - 2 * t), 0.9);
        }
        out.push([u, hw]);
    }
    return out;
}

const NO_GROOVES = { grooves: 0, grooveFreq: 1, grooveFrom: 0, grooveTo: 0 };

/** The variant bodies (the lantern shoal is a swarm: LANTERN_SWARM). Keys = sim FaunaVariantDef.look. */
export const FAUNA_BODIES: Readonly<Record<string, BodyDef>> = {
    voidWhale: {
        id: 'voidWhale',
        name: 'Void Whale',
        silhouette: pilotWhaleKnots(),
        segments: 24,
        texW: 512,
        texH: 192,
        fins: [{ u: 0.64, v: 0.42, len: 128, wid: 76, sweep: 0.62, shape: 'leaf', flutterHz: 0.35, flutterAmp: 0.16 }],
        fluke: { len: 96, span: 216 },
        skin: { seed: 7, noiseScale: 22, noiseAmp: 0.46, mottle: 0.12, grooves: 0.07, grooveFreq: 18, grooveFrom: 0.25, grooveTo: 0.65, plates: 0.05, plateFreq: 4, spine: 0.12 },
        palette: { frame: 'kaltor', hueDeg: 212, satMul: 1.1, lumaMul: 1.1 },
        glow: { rgb: [70, 140, 190], alpha: 0.32, blurPx: 12 },
        spots: { rows: 2, count: 11, uFrom: 0.2, uTo: 0.78, v: 0.6, r: 5, core: [210, 245, 255], halo: [40, 120, 220], head: 3 },
        motion: { wavePeriodS: 7.5, waveAmp: 0.16, waveCycles: 0.85, tailSweep: 0.22 },
        capMul: 3,
    },
    hunter: {
        id: 'hunter',
        name: 'Hunter',
        silhouette: [[0, 0.1], [0.15, 0.3], [0.45, 0.62], [0.7, 0.72], [0.86, 0.5], [0.96, 0.2], [1, 0]],
        segments: 14,
        texW: 384,
        texH: 104,
        fins: [
            { u: 0.66, v: 0.55, len: 120, wid: 34, sweep: 1.05, shape: 'spike', flutterHz: 1.4, flutterAmp: 0.22 },
            { u: 0.42, v: 0.5, len: 84, wid: 26, sweep: 1.25, shape: 'spike', flutterHz: 1.4, flutterAmp: 0.18 },
        ],
        fluke: { len: 56, span: 110 },
        skin: { seed: 23, noiseScale: 14, noiseAmp: 0.5, mottle: 0.08, grooves: 0.1, grooveFreq: 11, grooveFrom: 0.1, grooveTo: 0.6, plates: 0.08, plateFreq: 3, spine: 0.16 },
        palette: { frame: 'kaltor', hueDeg: 352, satMul: 1.25, lumaMul: 1.1 },
        glow: null,
        spots: { rows: 0, count: 0, uFrom: 0, uTo: 0, v: 0, r: 5, core: [255, 190, 150], halo: [220, 40, 20], head: 2 },
        motion: { wavePeriodS: 1.6, waveAmp: 0.22, waveCycles: 1.1, tailSweep: 0.35 },
        capMul: 1,
    },
    hullGrazer: {
        id: 'hullGrazer',
        name: 'Hull Grazer',
        silhouette: [[0, 0.35], [0.12, 0.72], [0.4, 0.95], [0.75, 0.92], [0.92, 0.7], [1, 0.3]],
        segments: 12,
        texW: 320,
        texH: 184,
        fins: [
            { u: 0.86, v: 0.7, len: 58, wid: 22, sweep: -0.35, shape: 'spike', flutterHz: 0.8, flutterAmp: 0.3 },
            { u: 0.62, v: 0.9, len: 40, wid: 18, sweep: 0.2, shape: 'spike', flutterHz: 0.8, flutterAmp: 0.2 },
            { u: 0.38, v: 0.9, len: 40, wid: 18, sweep: 0.45, shape: 'spike', flutterHz: 0.8, flutterAmp: 0.2 },
        ],
        fluke: null,
        skin: { seed: 31, noiseScale: 12, noiseAmp: 0.5, mottle: 0.14, grooves: 0.16, grooveFreq: 9, grooveFrom: 0.05, grooveTo: 0.9, plates: 0.12, plateFreq: 6, spine: 0.1 },
        palette: { frame: 'slug', hueDeg: 38, satMul: 1.05, lumaMul: 1.04 },
        glow: null,
        spots: null,
        motion: { wavePeriodS: 3.2, waveAmp: 0.06, waveCycles: 0.6, tailSweep: 0 },
        capMul: 1.2,
    },
    stormDrifter: {
        id: 'stormDrifter',
        name: 'Storm Drifter',
        silhouette: [[0, 0.06], [0.3, 0.14], [0.55, 0.3], [0.7, 0.8], [0.85, 1], [0.96, 0.75], [1, 0.3]],
        segments: 20,
        texW: 448,
        texH: 208,
        fins: [
            { u: 0.7, v: 0.8, len: 200, wid: 40, sweep: 2.55, shape: 'frond', flutterHz: 0.5, flutterAmp: 0.14 },
            { u: 0.74, v: 0.4, len: 170, wid: 34, sweep: 2.75, shape: 'frond', flutterHz: 0.45, flutterAmp: 0.12 },
        ],
        fluke: null,
        skin: { seed: 41, noiseScale: 18, noiseAmp: 0.5, mottle: 0.16, grooves: 0.1, grooveFreq: 14, grooveFrom: 0.7, grooveTo: 0.98, plates: 0, plateFreq: 1, spine: 0.06 },
        palette: { frame: 'ardilus', hueDeg: 262, satMul: 1.15, lumaMul: 1.0 },
        glow: { rgb: [140, 110, 230], alpha: 0.4, blurPx: 16 },
        spots: { rows: 2, count: 6, uFrom: 0.72, uTo: 0.95, v: 0.55, r: 5, core: [235, 225, 255], halo: [120, 80, 255], head: 0 },
        motion: { wavePeriodS: 5, waveAmp: 0.1, waveCycles: 1.4, tailSweep: 0 },
        capMul: 1.8,
    },
    nestMother: {
        id: 'nestMother',
        name: 'Nest Mother',
        silhouette: [[0, 0.22], [0.18, 0.7], [0.42, 1], [0.66, 0.96], [0.86, 0.72], [0.96, 0.42], [1, 0.1]],
        segments: 16,
        texW: 512,
        texH: 300,
        fins: [
            { u: 0.8, v: 0.8, len: 110, wid: 50, sweep: 0.9, shape: 'frond', flutterHz: 0.18, flutterAmp: 0.1 },
            { u: 0.55, v: 0.92, len: 96, wid: 46, sweep: 1.3, shape: 'frond', flutterHz: 0.16, flutterAmp: 0.1 },
            { u: 0.3, v: 0.8, len: 84, wid: 40, sweep: 1.7, shape: 'frond', flutterHz: 0.14, flutterAmp: 0.1 },
        ],
        fluke: null,
        skin: { seed: 53, noiseScale: 26, noiseAmp: 0.5, mottle: 0.16, grooves: 0.06, grooveFreq: 7, grooveFrom: 0.1, grooveTo: 0.9, plates: 0.1, plateFreq: 5, spine: 0.14 },
        palette: { frame: 'ardilus', hueDeg: 322, satMul: 0.95, lumaMul: 0.98 },
        glow: { rgb: [150, 70, 60], alpha: 0.22, blurPx: 18 },
        spots: { rows: 4, count: 7, uFrom: 0.15, uTo: 0.72, v: 0.72, r: 8, core: [255, 220, 150], halo: [230, 110, 40], head: 0 },
        motion: { wavePeriodS: 12, waveAmp: 0.04, waveCycles: 0.5, tailSweep: 0 },
        capMul: 3.5,
    },
    scavenger: {
        id: 'scavenger',
        name: 'Scavenger',
        silhouette: [[0, 0.15], [0.25, 0.5], [0.6, 0.62], [0.85, 0.55], [0.95, 0.38], [1, 0.12]],
        segments: 16,
        texW: 384,
        texH: 116,
        fins: [
            { u: 0.97, v: 0.3, len: 52, wid: 16, sweep: -0.55, shape: 'spike', flutterHz: 1.1, flutterAmp: 0.3 },
            { u: 0.7, v: 0.95, len: 44, wid: 14, sweep: 0.55, shape: 'spike', flutterHz: 1.6, flutterAmp: 0.35 },
            { u: 0.5, v: 0.95, len: 44, wid: 14, sweep: 0.75, shape: 'spike', flutterHz: 1.6, flutterAmp: 0.35 },
            { u: 0.3, v: 0.9, len: 40, wid: 14, sweep: 0.95, shape: 'spike', flutterHz: 1.6, flutterAmp: 0.35 },
        ],
        fluke: null,
        skin: { seed: 67, noiseScale: 12, noiseAmp: 0.46, mottle: 0.12, grooves: 0.2, grooveFreq: 14, grooveFrom: 0.05, grooveTo: 0.92, plates: 0.05, plateFreq: 2, spine: 0.08 },
        palette: { frame: 'sandslug', hueDeg: 28, satMul: 0.9, lumaMul: 0.94 },
        glow: null,
        spots: null,
        motion: { wavePeriodS: 2.4, waveAmp: 0.14, waveCycles: 1.3, tailSweep: 0 },
        capMul: 1,
    },
    broodCarrier: {
        id: 'broodCarrier',
        name: 'Brood Carrier',
        silhouette: [[0, 0.1], [0.25, 0.4], [0.55, 0.78], [0.78, 0.82], [0.93, 0.55], [1, 0.2]],
        segments: 20,
        texW: 512,
        texH: 224,
        fins: [{ u: 0.58, v: 0.7, len: 190, wid: 110, sweep: 0.95, shape: 'leaf', flutterHz: 0.22, flutterAmp: 0.14 }],
        fluke: { len: 64, span: 120 },
        skin: { seed: 79, noiseScale: 20, noiseAmp: 0.46, mottle: 0.12, grooves: 0.05, grooveFreq: 10, grooveFrom: 0.3, grooveTo: 0.7, plates: 0.06, plateFreq: 3, spine: 0.14 },
        palette: { frame: 'kaltor', hueDeg: 158, satMul: 1.0, lumaMul: 1.16 },
        glow: null,
        spots: { rows: 2, count: 5, uFrom: 0.32, uTo: 0.72, v: 0.5, r: 9, core: [255, 210, 190], halo: [200, 60, 50], head: 0 },
        motion: { wavePeriodS: 9, waveAmp: 0.1, waveCycles: 0.7, tailSweep: 0.18 },
        capMul: 2.5,
    },
};

/** The lantern shoal: a particle swarm (not a body). */
export const LANTERN_SWARM = { particles: 56, colors: [0xffd27a, 0xffe9b0, 0x9fe8ff, 0xffb35c] as const, periodS: 9, capMul: 2 } as const;

/** Look id → drawn cap multiplier (bodies and the swarm). */
export function lookCapMul(look: string): number {
    if (look === 'lantern') return LANTERN_SWARM.capMul;
    return FAUNA_BODIES[look]?.capMul ?? 1;
}

// ---------------------------------------------------------------------------
// Pure rasterisers.

export interface RgbaImage {
    w: number;
    h: number;
    data: Uint8ClampedArray;
}

function image(w: number, h: number): RgbaImage {
    return { w, h, data: new Uint8ClampedArray(w * h * 4) };
}

/** Shading → luma (quantile-matched to the source frame × lumaMul) → ramp colour. */
interface Shader {
    colour(s: number): Rgb;
}

function makeShader(src: PaletteSource, def: BodyDef, sVals: number[]): Shader {
    const ramp = rehuedRamp(src, def.palette.hueDeg, def.palette.satMul);
    const KN = 64;
    const sorted = sVals.slice().sort((p, q) => p - q);
    const sK: number[] = [];
    const lK: number[] = [];
    for (let k = 0; k < KN; k++) {
        const q = k / (KN - 1);
        sK.push((sorted.length > 0 ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : q) + k * 1e-7);
        lK.push(src.luma[Math.min(src.luma.length - 1, Math.floor(q * src.luma.length))] * def.palette.lumaMul);
    }
    return {
        colour(s: number): Rgb {
            let lum: number;
            if (s <= sK[0]) lum = lK[0];
            else if (s >= sK[KN - 1]) lum = lK[KN - 1];
            else {
                let lo = 0;
                let hi = KN - 1;
                while (hi - lo > 1) {
                    const m = (lo + hi) >> 1;
                    if (sK[m] < s) lo = m;
                    else hi = m;
                }
                const t = (s - sK[lo]) / Math.max(1e-9, sK[hi] - sK[lo]);
                lum = lK[lo] + (lK[hi] - lK[lo]) * t;
            }
            return ramp[Math.max(0, Math.min(31, Math.floor(lum * 32)))];
        },
    };
}

/** Edge softness in texture px: the source frame's alpha-ramp fraction × the body length (pilot B). */
export function edgePxOf(def: BodyDef, src: PaletteSource): number {
    return Math.max(1.5, src.edgeWidthFrac * def.texW);
}

/** Maximum half-height of the body in its texture (px). */
export function maxHalfOf(def: BodyDef): number {
    return def.texH * 0.47;
}

interface ShadeField {
    s: Float32Array;
    a: Float32Array;
}

function bodyField(def: BodyDef, edgePx: number): ShadeField {
    const W = def.texW;
    const H = def.texH;
    const sk = def.skin;
    const noise = makeValueNoise(sk.seed);
    const noise2 = makeValueNoise(sk.seed + 12);
    const maxHalf = maxHalfOf(def);
    const s = new Float32Array(W * H);
    const a = new Float32Array(W * H);
    const hwCol = new Float32Array(W);
    for (let x = 0; x < W; x++) hwCol[x] = silhouetteAt(def, (x + 0.5) / W) * maxHalf;
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const u = (x + 0.5) / W;
            const hw = hwCol[x];
            if (hw <= 0.5) continue;
            const dy = y + 0.5 - H / 2;
            const d = hw - Math.abs(dy);
            const endDist = Math.min(x + 0.5, W - x - 0.5) + 2;
            const alpha = smoothstep(0, edgePx, Math.min(d, endDist));
            if (alpha <= 0) continue;
            const v = dy / hw;
            let sh = 0.1 + 0.5 * Math.pow(Math.max(0, 1 - v * v), 0.7);
            sh += sk.spine * Math.exp(-Math.pow(v / 0.1, 2)) * smoothstep(0.08, 0.35, u) * (1 - smoothstep(0.85, 0.97, u));
            if (sk.grooves > 0) sh -= sk.grooves * Math.pow(0.5 + 0.5 * Math.cos(2 * Math.PI * u * sk.grooveFreq), 3) * smoothstep(sk.grooveFrom, sk.grooveFrom + 0.06, u) * (1 - smoothstep(sk.grooveTo - 0.06, sk.grooveTo, u));
            if (sk.plates > 0) sh -= sk.plates * Math.pow(0.5 + 0.5 * Math.cos(2 * Math.PI * (Math.abs(v) * 1.5 + u * sk.plateFreq)), 6) * smoothstep(0.55, 0.8, u);
            sh *= 1 - sk.noiseAmp / 2 + sk.noiseAmp * fbm(noise, x / sk.noiseScale, y / sk.noiseScale, 4);
            sh += sk.mottle * (fbm(noise2, x / (sk.noiseScale * 3.6), y / (sk.noiseScale * 2.7), 3) - 0.5);
            sh += 0.1 * Math.exp(-Math.pow((1 - Math.abs(v)) / 0.08, 2)) * smoothstep(0.12, 0.4, u);
            s[y * W + x] = sh;
            a[y * W + x] = alpha;
        }
    }
    return { s, a };
}

function paint(field: ShadeField, w: number, h: number, shader: Shader, alphaMul: ((i: number) => number) | null = null): RgbaImage {
    const img = image(w, h);
    for (let i = 0; i < w * h; i++) {
        const al = field.a[i] * (alphaMul === null ? 1 : alphaMul(i));
        if (al <= 0) continue;
        const [r, g, b] = shader.colour(field.s[i]);
        img.data[i * 4] = r;
        img.data[i * 4 + 1] = g;
        img.data[i * 4 + 2] = b;
        img.data[i * 4 + 3] = al * 255;
    }
    return img;
}

function finField(fin: FinDef, edgePx: number, seed: number): ShadeField {
    const FW = fin.len;
    const FH = fin.wid;
    const noise = makeValueNoise(seed);
    const s = new Float32Array(FW * FH);
    const a = new Float32Array(FW * FH);
    for (let y = 0; y < FH; y++) {
        for (let x = 0; x < FW; x++) {
            const u = (x + 0.5) / FW;
            let half: number;
            let curl = 0;
            if (fin.shape === 'spike') half = (FH / 2) * 0.9 * Math.pow(1 - u, 0.8) * smoothstep(0, 0.12, u + 0.02);
            else if (fin.shape === 'frond') {
                half = (FH / 2) * 0.85 * (0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, u * 1.1))) * (1 - 0.6 * u);
                curl = Math.sin(u * Math.PI * 2.2) * FH * 0.12;
            } else {
                half = (FH / 2) * 0.92 * Math.pow(Math.sin(Math.PI * Math.pow(u, 0.62)), 0.85);
                curl = 6 * u * u * (FH / 76);
            }
            const dy = y + 0.5 - FH / 2 - curl;
            const d = half - Math.abs(dy);
            const al = smoothstep(0, Math.min(edgePx, Math.max(1, half)), d) * (1 - smoothstep(0.9, 1, u));
            if (al <= 0) continue;
            const v = dy / Math.max(1, half);
            let sh = 0.14 + 0.36 * Math.pow(Math.max(0, 1 - v * v), 0.8) * (1 - 0.5 * u);
            if (fin.shape !== 'spike') sh += 0.06 * Math.pow(0.5 + 0.5 * Math.cos(2 * Math.PI * (u * 5 + v * 0.6)), 4);
            sh *= 0.75 + 0.45 * fbm(noise, x / 14 + 40, y / 14, 3);
            // Membrane: the trailing side is thinner (darker), not transparent (the originals' bodies are opaque).
            const membrane = fin.shape !== 'spike' && v > 0.5 ? 1 - 0.3 * smoothstep(0.5, 1, v) : 1;
            s[y * FW + x] = sh * membrane;
            a[y * FW + x] = al;
        }
    }
    return { s, a };
}

function flukeField(fluke: { len: number; span: number }, edgePx: number, seed: number): ShadeField {
    const KW = fluke.len;
    const KH = fluke.span;
    const noise2 = makeValueNoise(seed);
    const s = new Float32Array(KW * KH);
    const a = new Float32Array(KW * KH);
    for (let y = 0; y < KH; y++) {
        const yy = Math.abs(y + 0.5 - KH / 2) / (KH / 2);
        const lead = KW * (0.97 - 0.62 * Math.pow(yy, 1.6));
        const thick = KW * (0.34 * Math.exp(-Math.pow(yy / 0.22, 2)) + 0.42 * Math.pow(Math.sin(Math.PI * Math.min(1, yy / 0.97)), 0.9));
        const trail = lead - thick;
        for (let x = 0; x < KW; x++) {
            const xc = x + 0.5;
            const d = Math.min(lead - xc, xc - trail, (0.97 - yy) * KH * 0.5);
            const al = smoothstep(0, edgePx, d);
            if (al <= 0) continue;
            const across = thick > 0 ? (xc - trail) / thick : 0.5;
            let sh = 0.12 + 0.34 * Math.sin(Math.PI * Math.pow(Math.max(0, across), 0.7)) * (1 - 0.5 * yy);
            sh *= 0.75 + 0.45 * fbm(noise2, x / 14, y / 14 + 30, 3);
            s[y * KW + x] = sh;
            a[y * KW + x] = al;
        }
    }
    return { s, a };
}

/** Separable box blur (3 passes ≈ Gaussian) of an alpha field. */
function blurAlpha(src: Float32Array, w: number, h: number, radius: number): Float32Array {
    let cur = src;
    const r = Math.max(1, Math.round(radius / 1.7));
    for (let pass = 0; pass < 3; pass++) {
        const tmp = new Float32Array(w * h);
        for (let y = 0; y < h; y++) {
            let acc = 0;
            for (let x = -r; x <= r; x++) acc += cur[y * w + Math.max(0, Math.min(w - 1, x))];
            for (let x = 0; x < w; x++) {
                tmp[y * w + x] = acc / (2 * r + 1);
                acc += cur[y * w + Math.min(w - 1, x + r + 1)] - cur[y * w + Math.max(0, x - r)];
            }
        }
        const out = new Float32Array(w * h);
        for (let x = 0; x < w; x++) {
            let acc = 0;
            for (let y = -r; y <= r; y++) acc += tmp[Math.max(0, Math.min(h - 1, y)) * w + x];
            for (let y = 0; y < h; y++) {
                out[y * w + x] = acc / (2 * r + 1);
                acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
            }
        }
        cur = out;
    }
    return cur;
}

/** Radial light dot (core → halo → transparent), premultiplied-friendly straight alpha. */
export function dotRgba(size: number, core: Rgb, halo: Rgb): RgbaImage {
    const img = image(size, size);
    const c = size / 2;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const d = Math.hypot(x + 0.5 - c, y + 0.5 - c) / c;
            if (d >= 1) continue;
            const t = smoothstep(0, 0.35, d);
            const a = d < 0.25 ? 1 : 0.8 * (1 - smoothstep(0.25, 1, d)) + 0.0001;
            const i = (y * size + x) * 4;
            img.data[i] = core[0] + (halo[0] - core[0]) * t;
            img.data[i + 1] = core[1] + (halo[1] - core[1]) * t;
            img.data[i + 2] = core[2] + (halo[2] - core[2]) * t;
            img.data[i + 3] = Math.min(1, a) * 255;
        }
    }
    return img;
}

export interface SpotDef {
    u: number;
    v: number;
    r: number;
    phase: number;
}

export function spotsOf(def: BodyDef): SpotDef[] {
    const sp = def.spots;
    if (sp === null) return [];
    const out: SpotDef[] = [];
    for (let k = 0; k < sp.count; k++) {
        const u = sp.count > 1 ? sp.uFrom + ((sp.uTo - sp.uFrom) * k) / (sp.count - 1) : sp.uFrom;
        for (let row = 0; row < sp.rows; row++) {
            const side = row % 2 === 0 ? -1 : 1;
            const tier = Math.floor(row / 2);
            const v = side * (sp.v - 0.1 * Math.sin(k) - tier * 0.32);
            out.push({ u, v, r: sp.r + (k % 3) - 1, phase: k * 1.7 + row * 0.9 });
        }
    }
    const heads: [number, number][] = [[0.93, -0.3], [0.93, 0.3], [0.97, 0]];
    for (let h = 0; h < sp.head; h++) out.push({ u: heads[h][0], v: heads[h][1], r: sp.r, phase: h * 2.1 });
    return out;
}

/** Everything a body needs, rasterised once (pure). */
export interface BodyParts {
    def: BodyDef;
    body: RgbaImage;
    fins: { fin: FinDef; img: RgbaImage }[];
    fluke: RgbaImage | null;
    glow: RgbaImage | null;
    spot: RgbaImage | null;
    spots: SpotDef[];
}

/** Rasterises a body definition in the palette of `src` (an original frame's PaletteSource). Pure. */
export function rasterBody(def: BodyDef, src: PaletteSource): BodyParts {
    const edgePx = edgePxOf(def, src);
    const bf = bodyField(def, edgePx);
    const sVals: number[] = [];
    for (let i = 0; i < bf.s.length; i++) if (bf.a[i] >= 0.5) sVals.push(bf.s[i]);
    const shader = makeShader(src, def, sVals);
    const body = paint(bf, def.texW, def.texH, shader);
    const fins = def.fins.map((fin, i) => ({ fin, img: paint(finField(fin, edgePx, def.skin.seed + 100 + i), fin.len, fin.wid, shader) }));
    const fluke = def.fluke === null ? null : paint(flukeField(def.fluke, edgePx, def.skin.seed + 200), def.fluke.len, def.fluke.span, shader);
    let glow: RgbaImage | null = null;
    if (def.glow !== null) {
        const gh = Math.round(def.texH * 1.45);
        const pad = Math.round((gh - def.texH) / 2);
        const sil = new Float32Array(def.texW * gh);
        const maxHalf = maxHalfOf(def);
        for (let x = 0; x < def.texW; x++) {
            const hw = silhouetteAt(def, (x + 0.5) / def.texW) * maxHalf;
            for (let y = 0; y < def.texH; y++) if (Math.abs(y + 0.5 - def.texH / 2) <= hw) sil[(y + pad) * def.texW + x] = 1;
        }
        const bl = blurAlpha(sil, def.texW, gh, def.glow.blurPx);
        glow = image(def.texW, gh);
        for (let i = 0; i < bl.length; i++) {
            if (bl[i] <= 0.002) continue;
            glow.data[i * 4] = def.glow.rgb[0];
            glow.data[i * 4 + 1] = def.glow.rgb[1];
            glow.data[i * 4 + 2] = def.glow.rgb[2];
            glow.data[i * 4 + 3] = bl[i] * def.glow.alpha * 255;
        }
    }
    const spots = spotsOf(def);
    const spot = def.spots === null ? null : dotRgba(32, def.spots.core, def.spots.halo);
    return { def, body, fins, fluke, glow, spot, spots };
}

// Geometry shared by the rest pose and the rig.

export const FIN_ANCHOR: [number, number] = [0.04, 0.5];
export const FLUKE_ANCHOR: [number, number] = [0.97, 0.5];

/** Offset of a fin root from the centreline (texture px) at rest. */
export function finOffset(def: BodyDef, fin: FinDef): number {
    return maxHalfOf(def) * fin.v * silhouetteAt(def, fin.u);
}

/** Bilinear sample of an image (straight alpha), 0 outside. */
function sample(img: RgbaImage, x: number, y: number): [number, number, number, number] {
    const x0 = Math.floor(x - 0.5);
    const y0 = Math.floor(y - 0.5);
    const fx = x - 0.5 - x0;
    const fy = y - 0.5 - y0;
    const out = [0, 0, 0, 0] as [number, number, number, number];
    for (let j = 0; j < 2; j++) {
        for (let i = 0; i < 2; i++) {
            const xx = x0 + i;
            const yy = y0 + j;
            if (xx < 0 || yy < 0 || xx >= img.w || yy >= img.h) continue;
            const wgt = (i === 0 ? 1 - fx : fx) * (j === 0 ? 1 - fy : fy);
            const k = (yy * img.w + xx) * 4;
            const a = (img.data[k + 3] / 255) * wgt;
            out[0] += img.data[k] * a;
            out[1] += img.data[k + 1] * a;
            out[2] += img.data[k + 2] * a;
            out[3] += a;
        }
    }
    if (out[3] > 0) {
        out[0] /= out[3];
        out[1] /= out[3];
        out[2] /= out[3];
    }
    return out;
}

/** Draws `src` into `dst` at (x, y) with anchor, rotation and optional y flip; source-over or additive. Pure. */
export function blit(dst: RgbaImage, src: RgbaImage, x: number, y: number, rot: number, anchor: [number, number], flipY: boolean, additive: boolean, alpha = 1, scale = 1): void {
    const c = Math.cos(rot) * scale;
    const s = Math.sin(rot) * scale;
    const ax = anchor[0] * src.w;
    const ay = anchor[1] * src.h;
    // Destination bounds of the rotated source box.
    const corners = [[-ax, -ay], [src.w - ax, -ay], [-ax, src.h - ay], [src.w - ax, src.h - ay]].map(([px, py]) => [x + px * c - (flipY ? -py : py) * s, y + px * s + (flipY ? -py : py) * c]);
    const minX = Math.max(0, Math.floor(Math.min(...corners.map((p) => p[0]))));
    const maxX = Math.min(dst.w - 1, Math.ceil(Math.max(...corners.map((p) => p[0]))));
    const minY = Math.max(0, Math.floor(Math.min(...corners.map((p) => p[1]))));
    const maxY = Math.min(dst.h - 1, Math.ceil(Math.max(...corners.map((p) => p[1]))));
    for (let dy = minY; dy <= maxY; dy++) {
        for (let dx = minX; dx <= maxX; dx++) {
            const rx = dx + 0.5 - x;
            const ry = dy + 0.5 - y;
            const inv = 1 / (scale * scale);
            const lx = (rx * c + ry * s) * inv;
            let ly = (-rx * s + ry * c) * inv;
            if (flipY) ly = -ly;
            const [r, g, b, a0] = sample(src, lx + ax, ly + ay);
            const a = a0 * alpha;
            if (a <= 0) continue;
            const k = (dy * dst.w + dx) * 4;
            if (additive) {
                dst.data[k] = dst.data[k] + r * a;
                dst.data[k + 1] = dst.data[k + 1] + g * a;
                dst.data[k + 2] = dst.data[k + 2] + b * a;
                dst.data[k + 3] = Math.max(dst.data[k + 3], a * 255);
            } else {
                const da = dst.data[k + 3] / 255;
                const oa = a + da * (1 - a);
                if (oa <= 0) continue;
                dst.data[k] = (r * a + dst.data[k] * da * (1 - a)) / oa;
                dst.data[k + 1] = (g * a + dst.data[k + 1] * da * (1 - a)) / oa;
                dst.data[k + 2] = (b * a + dst.data[k + 2] * da * (1 - a)) / oa;
                dst.data[k + 3] = oa * 255;
            }
        }
    }
}

/**
 * The rest pose on one image (glow, fluke, fins, body, spots — the rig's draw order), for the statistics.
 * `skinOnly` leaves out the glow and the spots (the pilot's "whaleBSkinOnly").
 */
export function restPose(parts: BodyParts, skinOnly = false): RgbaImage {
    const def = parts.def;
    const finReach = parts.fins.reduce((m, f) => Math.max(m, f.fin.len), 0);
    const padX = Math.max(parts.fluke?.w ?? 0, 8) + 8;
    const padY = finReach + 8;
    const out = image(def.texW + padX * 2, def.texH + padY * 2);
    const ox = padX;
    const oy = padY + def.texH / 2;
    if (!skinOnly && parts.glow !== null) blit(out, parts.glow, ox, oy - parts.glow.h / 2, 0, [0, 0], false, true);
    if (parts.fluke !== null) blit(out, parts.fluke, ox + 10, oy, 0, FLUKE_ANCHOR, false, false);
    for (const { fin, img } of parts.fins) {
        const fx = ox + fin.u * def.texW;
        const off = finOffset(def, fin);
        blit(out, img, fx, oy - off, -Math.PI / 2 - fin.sweep, FIN_ANCHOR, false, false);
        blit(out, img, fx, oy + off, Math.PI / 2 + fin.sweep, FIN_ANCHOR, true, false);
    }
    blit(out, parts.body, ox, oy - def.texH / 2, 0, [0, 0], false, false);
    if (!skinOnly && parts.spot !== null) {
        const maxHalf = maxHalfOf(def);
        for (const s of parts.spots) {
            const x = ox + s.u * def.texW;
            const y = oy + maxHalf * s.v * silhouetteAt(def, s.u);
            blit(out, parts.spot, x, y, 0, [0.5, 0.5], false, true, 0.67, (s.r * 2) / parts.spot.w);
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// Tamed look: harness state machine (pure) and container art (pure).

/** Harness fade-in on taming (s) and how long detached containers drift as debris (s). */
export const HARNESS_FADE_S = 3;
export const HARNESS_DEBRIS_S = 3.5;

export type HarnessPhase = 'none' | 'on' | 'dropping';

export interface HarnessState {
    phase: HarnessPhase;
    /** Seconds (render clock) the phase began. */
    since: number;
}

/** First sight of a creature: already tamed = harness fully on (no fade), else none. */
export function harnessInit(tamed: boolean): HarnessState {
    return tamed ? { phase: 'on', since: -1e9 } : { phase: 'none', since: 0 };
}

/** One render step: tamed turns the harness on (fading in), feral drops it (debris), debris ends after HARNESS_DEBRIS_S. */
export function harnessStep(s: HarnessState, tamed: boolean, t: number): HarnessState {
    switch (s.phase) {
        case 'none':
            return tamed ? { phase: 'on', since: t } : s;
        case 'on':
            return tamed ? s : { phase: 'dropping', since: t };
        case 'dropping':
            if (tamed) return { phase: 'on', since: t };
            return t - s.since >= HARNESS_DEBRIS_S ? { phase: 'none', since: t } : s;
    }
}

/** Harness opacity (containers, line, lights): the fade-in while 'on', the debris fade while 'dropping'. */
export function harnessAlpha(s: HarnessState, t: number): number {
    if (s.phase === 'on') return Math.max(0, Math.min(1, (t - s.since) / HARNESS_FADE_S));
    if (s.phase === 'dropping') return Math.max(0, 1 - (t - s.since) / HARNESS_DEBRIS_S);
    return 0;
}

/** Containers on the back by creature size (sim Creature.Size): 2 for a hunter … 6 for a void whale. */
export function containerCount(size: number): number {
    const t = (Math.sqrt(Math.max(1, size)) - Math.sqrt(40)) / (Math.sqrt(1400) - Math.sqrt(40));
    return Math.max(2, Math.min(6, Math.round(2 + 4 * t)));
}

/** A detached container's drift at debris age `age` (s): outward off alternate sides, spinning, fading. Pure. */
export function debrisOffset(i: number, age: number, boxLen: number): { dx: number; dy: number; rot: number; alpha: number } {
    const side = i % 2 === 0 ? -1 : 1;
    const k = age / HARNESS_DEBRIS_S;
    return {
        dx: -boxLen * 0.6 * age * (0.4 + 0.15 * i),
        dy: side * boxLen * (0.35 + 1.4 * age + 0.1 * i),
        rot: side * age * (0.9 + 0.3 * i),
        alpha: Math.max(0, 1 - k),
    };
}

/** Work-light id of container i on a creature: offsets the ambient blink (MainView.1.cs 1085) so they run out of phase. */
export function containerLightId(creatureId: number, i: number): number {
    return creatureId * 20 + ((i * 7) % 20);
}

/** Container art (pure): a corrugated box in the original freighter's colours (plainRamp), variant k shifts the tone. */
export function containerRgba(ramp: Rgb[], w: number, h: number, k: number): RgbaImage {
    const img = image(w, h);
    const noise = makeValueNoise(300 + k);
    const base = 0.46 + 0.08 * (k % 3);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const ex = Math.min(x + 0.5, w - x - 0.5);
            const ey = Math.min(y + 0.5, h - y - 0.5);
            const a = smoothstep(0, 1.4, Math.min(ex, ey));
            if (a <= 0) continue;
            let l = base;
            l += 0.07 * Math.cos((2 * Math.PI * x) / 5); // corrugation
            l += 0.1 * (1 - y / h) - 0.05; // light from above
            const edge = Math.min(ex, ey);
            l += 0.3 * (1 - smoothstep(1.2, 2.6, edge)); // light rim highlight
            l -= 0.1 * smoothstep(2.6, 3.2, edge) * (1 - smoothstep(3.2, 4.5, edge)); // shadow line inside the rim
            if (Math.abs(x - w * 0.5) < 0.8 || Math.abs(y - h * 0.22) < 0.7) l -= 0.1; // door seam, strap line
            if (y > h * 0.62 && y < h * 0.74) l += 0.2 * (k % 2); // painted band
            l *= 0.85 + 0.3 * noise(x / 4, y / 4);
            const [r, g, b] = ramp[Math.max(0, Math.min(31, Math.floor(l * 32)))];
            const i = (y * w + x) * 4;
            img.data[i] = r;
            img.data[i + 1] = g;
            img.data[i + 2] = b;
            img.data[i + 3] = a * 255;
        }
    }
    return img;
}

// ---------------------------------------------------------------------------
// Pixi side.

export function textureFromRgba(img: RgbaImage): Texture {
    const c = document.createElement('canvas');
    c.width = img.w;
    c.height = img.h;
    const ctx = c.getContext('2d');
    if (ctx === null) throw new Error('creatureRig: no 2d context');
    ctx.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.w, img.h), 0, 0);
    const t = Texture.from(c);
    useMinifyingFilter(t);
    return t;
}

/** Pixi textures of a BodyParts (built once per look). */
export interface BodyTextures {
    def: BodyDef;
    body: Texture;
    fins: { fin: FinDef; tex: Texture }[];
    fluke: Texture | null;
    glow: Texture | null;
    spot: Texture | null;
    spots: SpotDef[];
}

export function bodyTextures(parts: BodyParts): BodyTextures {
    return {
        def: parts.def,
        body: textureFromRgba(parts.body),
        fins: parts.fins.map((f) => ({ fin: f.fin, tex: textureFromRgba(f.img) })),
        fluke: parts.fluke === null ? null : textureFromRgba(parts.fluke),
        glow: parts.glow === null ? null : textureFromRgba(parts.glow),
        spot: parts.spot === null ? null : textureFromRgba(parts.spot),
        spots: parts.spots,
    };
}

/** A point on the centreline in rig-local units: position and tangent angle. */
export interface BackPoint {
    x: number;
    y: number;
    ang: number;
}

/** Something the harness can ride: its local length and its centreline. */
export interface HarnessCarrier {
    readonly length: number;
    readonly width: number;
    backPoint(u: number): BackPoint;
    /** Half-width of the body at u (local units): where the straps wrap round the flank. */
    halfWidthAt(u: number): number;
}

/** The rope rig: MeshRope body (head along +x), fin pairs with flutter, optional fluke, glow rope and pulsing spots. */
export class CreatureRig implements HarnessCarrier {
    root = new Container();
    /** Harness layer (children above the body). */
    readonly top = new Container();
    private points: Point[] = [];
    private body: MeshRope;
    private glowRope: MeshRope | null = null;
    private fins: { fin: FinDef; l: Sprite; r: Sprite }[] = [];
    private fluke: Sprite | null = null;
    private spotSprites: Sprite[] = [];
    readonly length: number;
    readonly width: number;

    constructor(private tex: BodyTextures, private phase: number) {
        const def = tex.def;
        this.length = def.texW;
        this.width = def.texH;
        this.root.eventMode = 'none';
        for (let i = 0; i < def.segments; i++) this.points.push(new Point((i / (def.segments - 1) - 0.5) * def.texW, 0));
        if (tex.glow !== null) {
            this.glowRope = new MeshRope({ texture: tex.glow, points: this.points });
            this.glowRope.blendMode = 'add';
            this.root.addChild(this.glowRope);
        }
        if (tex.fluke !== null) {
            this.fluke = new Sprite(tex.fluke);
            this.fluke.anchor.set(FLUKE_ANCHOR[0], FLUKE_ANCHOR[1]);
            this.root.addChild(this.fluke);
        }
        for (const f of tex.fins) {
            const l = new Sprite(f.tex);
            l.anchor.set(FIN_ANCHOR[0], FIN_ANCHOR[1]);
            const r = new Sprite(f.tex);
            r.anchor.set(FIN_ANCHOR[0], FIN_ANCHOR[1]);
            r.scale.y = -1;
            this.root.addChild(l, r);
            this.fins.push({ fin: f.fin, l, r });
        }
        this.body = new MeshRope({ texture: tex.body, points: this.points });
        this.root.addChild(this.body);
        if (tex.spot !== null) {
            for (const s of tex.spots) {
                const sp = new Sprite(tex.spot);
                sp.anchor.set(0.5);
                sp.blendMode = 'add';
                sp.scale.set((s.r * 2) / tex.spot.width);
                this.spotSprites.push(sp);
                this.root.addChild(sp);
            }
        }
        this.root.addChild(this.top);
    }

    halfWidthAt(u: number): number {
        return maxHalfOf(this.tex.def) * silhouetteAt(this.tex.def, u);
    }

    /** Centreline point at u (0 tail … 1 head) of the current pose. */
    backPoint(u: number): BackPoint {
        const n = this.points.length;
        const si = Math.max(0, Math.min(n - 1.0001, u * (n - 1)));
        const j = Math.floor(si);
        const a = this.points[j];
        const b = this.points[Math.min(n - 1, j + 1)];
        const k = si - j;
        return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, ang: Math.atan2(b.y - a.y, b.x - a.x) };
    }

    /** Pose at time t (s): travelling body wave, tail fluke sweep, fin flutter, spot pulse. `speed01` damps a resting body. */
    pose(t: number, speed01 = 1): void {
        const def = this.tex.def;
        const m = def.motion;
        const w = (2 * Math.PI) / m.wavePeriodS;
        const ph = this.phase;
        const amp = m.waveAmp * (0.35 + 0.65 * speed01);
        const n = this.points.length;
        for (let i = 0; i < n; i++) {
            const u = i / (n - 1);
            const env = Math.pow(1 - u, 1.7) * amp + 0.015;
            const y = def.texH * env * Math.sin(2 * Math.PI * m.waveCycles * u - w * t + ph);
            this.points[i].set((u - 0.5) * def.texW, y);
        }
        if (this.fluke !== null) {
            const p0 = this.points[0];
            const p1 = this.points[1];
            const tail = Math.atan2(p1.y - p0.y, p1.x - p0.x);
            this.fluke.position.set(p0.x + Math.cos(tail) * 10, p0.y + Math.sin(tail) * 10);
            this.fluke.rotation = tail + m.tailSweep * Math.sin(-w * t + ph - 1.1);
        }
        const maxHalf = maxHalfOf(def);
        for (const f of this.fins) {
            const bp = this.backPoint(f.fin.u);
            const off = maxHalf * f.fin.v * silhouetteAt(def, f.fin.u);
            const nx = -Math.sin(bp.ang);
            const ny = Math.cos(bp.ang);
            const fl = 2 * Math.PI * f.fin.flutterHz;
            f.l.position.set(bp.x - nx * off, bp.y - ny * off);
            f.l.rotation = bp.ang - Math.PI / 2 - (f.fin.sweep + f.fin.flutterAmp * Math.sin(fl * t + ph));
            f.r.position.set(bp.x + nx * off, bp.y + ny * off);
            f.r.rotation = bp.ang + Math.PI / 2 + (f.fin.sweep + f.fin.flutterAmp * Math.sin(fl * t + ph + 2.2));
        }
        for (let s = 0; s < this.spotSprites.length; s++) {
            const spot = this.tex.spots[s];
            const bp = this.backPoint(spot.u);
            const d = maxHalf * spot.v * silhouetteAt(def, spot.u);
            const sp = this.spotSprites[s];
            sp.position.set(bp.x - Math.sin(bp.ang) * d, bp.y + Math.cos(bp.ang) * d);
            sp.alpha = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 1.3 + spot.phase));
        }
    }
}

/** A straight carrier for sprite creatures (the original Kaltor frames): length along +x. */
export class StraightCarrier implements HarnessCarrier {
    root = new Container();
    readonly top = this.root;
    constructor(readonly length: number, readonly width: number) {
        this.root.eventMode = 'none';
    }
    backPoint(u: number): BackPoint {
        return { x: (u - 0.5) * this.length, y: 0, ang: 0 };
    }
    halfWidthAt(u: number): number {
        return (this.width / 2) * Math.sin(Math.PI * Math.max(0.05, Math.min(0.95, u)));
    }
}

/** The lantern shoal: additive light motes swirling around the creature's position (radius 0.5 in local units × scale). */
export class LanternSwarm {
    root = new Container();
    private motes: { s: Sprite; r: number; w: number; ph: number; squash: number; pulse: number }[] = [];
    /** Local radius of the swarm (the drawn length is 2 × this after scaling). */
    static readonly RADIUS = 256;

    constructor(mote: Texture, seed: number) {
        this.root.eventMode = 'none';
        const noise = makeValueNoise(seed);
        for (let i = 0; i < LANTERN_SWARM.particles; i++) {
            const s = new Sprite(mote);
            s.anchor.set(0.5);
            s.blendMode = 'add';
            s.tint = LANTERN_SWARM.colors[i % LANTERN_SWARM.colors.length];
            const size = 10 + 22 * noise(i * 1.7, 3.1);
            s.scale.set(size / mote.width);
            this.root.addChild(s);
            this.motes.push({
                s,
                r: LanternSwarm.RADIUS * (0.12 + 0.88 * Math.sqrt(noise(i * 0.9, 7.7))),
                w: ((2 * Math.PI) / LANTERN_SWARM.periodS) * (0.5 + noise(i * 2.3, 1.3)) * (i % 3 === 0 ? -1 : 1),
                ph: noise(i * 3.1, 5.5) * Math.PI * 2,
                squash: 0.45 + 0.4 * noise(i * 1.1, 9.9),
                pulse: 0.6 + 1.4 * noise(i * 4.4, 2.2),
            });
        }
    }

    pose(t: number): void {
        for (const m of this.motes) {
            const a = m.ph + m.w * t;
            const wob = 1 + 0.12 * Math.sin(t * 0.7 + m.ph * 3);
            m.s.position.set(Math.cos(a) * m.r * wob, Math.sin(a) * m.r * m.squash * wob);
            m.s.alpha = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * m.pulse + m.ph));
        }
    }
}

/** Harness style: laden cargo beast (containers in lanes over the middle 60 % of the back, straps round the flanks), or
 * a tamed hunter's single band with one red beacon. */
export type HarnessMode = 'cargo' | 'band';

/** Cargo harness geometry: the back from u 0.2 to 0.8 (60 % of the body), 2 or 3 lanes of containers. */
export const CARGO_U_FROM = 0.2;
export const CARGO_U_TO = 0.8;

/** Lanes of containers across the back by creature size: 3 on the big beasts, else 2. */
export function cargoLanes(size: number): number {
    return size >= 900 ? 3 : 2;
}

/** Containers per lane along the back (containerCount by size, 2..6, less two: the boxes are long). */
export function containersPerLane(size: number): number {
    return Math.max(2, containerCount(size) - 2);
}

/** A tamed hunter's red beacon: a slow regular blink, 1 s period (0.5 s on), not the ambient nav-light pattern. */
export const BEACON_PERIOD_S = 1.0;
export function beaconOn(t: number, phase = 0): boolean {
    const k = (((t + phase) % BEACON_PERIOD_S) + BEACON_PERIOD_S) % BEACON_PERIOD_S;
    return k < BEACON_PERIOD_S / 2;
}

/**
 * The harness overlay on a carrier.
 *   cargo: containers in 2–3 lanes over the middle 60 % of the back, following the rope; leather bands wrapping round
 *          the body between them (crossing both flanks), a thick rigging line along each lane; warm work lights on the
 *          containers blinking with the ambient nav-light pattern (lightsOn, MainView.1.cs 1085-1103), out of phase.
 *   band:  one wide band round the body with a single red beacon on its edge (BEACON_PERIOD_S blink); no containers.
 * Fades in over HARNESS_FADE_S; on 'dropping' the containers / band drift off as debris and fade.
 */
export class HarnessView {
    root = new Container();
    private under = new Graphics();
    private over = new Graphics();
    private boxes: { s: Sprite; u: number; lane: number }[] = [];
    private lights: Sprite[] = [];
    private beacon: Sprite | null = null;
    private boxLen = 0;
    private boxWid = 0;
    private laneOffsets: number[] = [];
    private bandUs: number[] = [];

    constructor(private carrier: HarnessCarrier, private mode: HarnessMode, boxTex: Texture[], lightTex: Texture, size: number) {
        this.root.eventMode = 'none';
        this.root.addChild(this.under);
        if (mode === 'band') {
            this.bandUs = [0.56];
            this.root.addChild(this.over);
            const b = new Sprite(lightTex);
            b.anchor.set(0.5);
            b.blendMode = 'add';
            b.tint = 0xff2414;
            const d = Math.max(6, carrier.halfWidthAt(0.56) * 0.9);
            b.width = d;
            b.height = d;
            this.beacon = b;
            this.root.addChild(b);
            return;
        }
        const lanes = cargoLanes(size);
        const per = containersPerLane(size);
        const span = CARGO_U_TO - CARGO_U_FROM;
        this.boxLen = ((span / per) * 0.86) * carrier.length;
        // Lanes share the narrowest half-width over the cargo span (so the outer lanes stay on the back).
        let hw = Number.MAX_VALUE;
        for (let k = 0; k <= 8; k++) hw = Math.min(hw, carrier.halfWidthAt(CARGO_U_FROM + 0.05 + ((span - 0.1) * k) / 8));
        const laneW = (hw * 1.5) / lanes;
        this.boxWid = laneW * 0.9;
        for (let l = 0; l < lanes; l++) this.laneOffsets.push((l - (lanes - 1) / 2) * laneW);
        let n = 0;
        for (let l = 0; l < lanes; l++) {
            for (let i = 0; i < per; i++) {
                const s = new Sprite(boxTex[(n + l) % boxTex.length]);
                s.anchor.set(0.5);
                s.width = this.boxLen;
                s.height = this.boxWid;
                this.boxes.push({ s, u: CARGO_U_FROM + ((i + 0.5) / per) * span, lane: l });
                this.root.addChild(s);
                n++;
            }
        }
        // Bands between the containers (and at both ends) wrap round the flanks.
        for (let i = 0; i <= per; i++) this.bandUs.push(CARGO_U_FROM + (i / per) * span);
        this.root.addChild(this.over);
        for (let i = 0; i < this.boxes.length; i++) {
            const l = new Sprite(lightTex);
            l.anchor.set(0.5);
            l.blendMode = 'add';
            l.tint = 0xffb45a;
            const d = Math.max(5, this.boxWid * 0.7);
            l.width = d;
            l.height = d;
            this.lights.push(l);
            this.root.addChild(l);
        }
    }

    private at(u: number, across: number): { x: number; y: number; ang: number } {
        const bp = this.carrier.backPoint(u);
        return { x: bp.x - Math.sin(bp.ang) * across, y: bp.y + Math.cos(bp.ang) * across, ang: bp.ang };
    }

    /** Pose on the carrier's current back line. `state` from harnessStep; `t` render seconds; `secondsOfDay` for the blink. */
    pose(state: HarnessState, t: number, secondsOfDay: number, id: number): void {
        const alpha = harnessAlpha(state, t);
        this.root.visible = state.phase !== 'none' && alpha > 0;
        if (!this.root.visible) return;
        const dropping = state.phase === 'dropping';
        const age = dropping ? t - state.since : 0;
        const L = this.carrier.length;
        const g = this.under;
        const o = this.over;
        g.clear();
        o.clear();
        const bandWidth = this.mode === 'band' ? L * 0.05 : L * 0.022;
        // Bands: a dark leather strap across the whole body (flank to flank), a pale edge line on each side.
        const drawBand = (u: number, dx: number, dy: number, rot: number, a: number): void => {
            const hw = this.carrier.halfWidthAt(u) * 1.04;
            const bp = this.carrier.backPoint(u);
            const ang = bp.ang + rot;
            const nx = -Math.sin(ang);
            const ny = Math.cos(ang);
            const x = bp.x + dx;
            const y = bp.y + dy;
            g.moveTo(x - nx * hw, y - ny * hw).lineTo(x + nx * hw, y + ny * hw).stroke({ width: bandWidth, color: 0x4a3524, alpha: a });
            const ex = Math.cos(ang) * bandWidth * 0.42;
            const ey = Math.sin(ang) * bandWidth * 0.42;
            for (const sgn of [-1, 1]) g.moveTo(x - nx * hw + sgn * ex, y - ny * hw + sgn * ey).lineTo(x + nx * hw + sgn * ex, y + ny * hw + sgn * ey);
            g.stroke({ width: Math.max(1, bandWidth * 0.14), color: 0xcdb58a, alpha: 0.9 * a });
        };
        this.bandUs.forEach((u, i) => {
            if (dropping) {
                const d = debrisOffset(i, age, L * 0.08);
                drawBand(u, d.dx * 0.3, d.dy * 0.6, d.rot * 0.3, d.alpha);
            } else drawBand(u, 0, 0, 0, alpha);
        });
        if (this.mode === 'band') {
            const b = this.beacon!;
            const u = this.bandUs[0];
            const hw = this.carrier.halfWidthAt(u) * 1.04;
            const p = this.at(u, hw);
            if (dropping) {
                b.visible = false;
                return;
            }
            b.position.set(p.x, p.y);
            b.visible = beaconOn(t, (id % 10) * 0.1);
            b.alpha = alpha;
            return;
        }
        // Rigging: a thick line along each lane over the containers, tied off at both ends of the cargo span.
        if (!dropping) {
            for (const off of this.laneOffsets) {
                const pts: { x: number; y: number }[] = [];
                for (let k = 0; k <= 12; k++) pts.push(this.at(CARGO_U_FROM - 0.03 + ((CARGO_U_TO - CARGO_U_FROM + 0.06) * k) / 12, off));
                o.moveTo(pts[0].x, pts[0].y);
                for (let k = 1; k < pts.length; k++) o.lineTo(pts[k].x, pts[k].y);
            }
            o.stroke({ width: Math.max(1.2, L * 0.007), color: 0xd8c49a, alpha: 0.95 * alpha });
        }
        for (let i = 0; i < this.boxes.length; i++) {
            const bx = this.boxes[i];
            const p = this.at(bx.u, this.laneOffsets[bx.lane]);
            const l = this.lights[i];
            if (dropping) {
                const d = debrisOffset(i, age, this.boxLen);
                const c = Math.cos(p.ang);
                const s = Math.sin(p.ang);
                bx.s.position.set(p.x + d.dx * c - d.dy * s, p.y + d.dx * s + d.dy * c);
                bx.s.rotation = p.ang + d.rot;
                bx.s.alpha = d.alpha;
                l.visible = false;
                continue;
            }
            bx.s.position.set(p.x, p.y);
            bx.s.rotation = p.ang;
            bx.s.alpha = alpha;
            // Warm work light on the container's front outer corner.
            const side = this.laneOffsets[bx.lane] >= 0 ? 1 : -1;
            const off = this.boxLen * 0.4;
            l.position.set(p.x + Math.cos(p.ang) * off - Math.sin(p.ang) * this.boxWid * 0.38 * side, p.y + Math.sin(p.ang) * off + Math.cos(p.ang) * this.boxWid * 0.38 * side);
            l.visible = lightsOn(secondsOfDay, containerLightId(id, i));
            l.alpha = 0.95 * alpha;
        }
    }
}
