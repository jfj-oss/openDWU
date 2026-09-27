// 19r item 7 — empire liveries and the WITHERED look (flag `liveries`, scenario art-bundle). Not a port: overlays on
// the ORIGINAL ship sprites, computed once per texture from its alpha mask and cached. Pure (no Pixi / DOM).
//
// Per texture (load-rotated crop space, bow along +x — the space the C# caches the art in):
//   * centreline / length from the hull mask's columns → a tint band across the hull ahead of midships and the hull
//     number's slot near the stern;
//   * a Euclidean distance transform of the mask (Felzenszwalb–Huttenlocher) → the flattest, widest spot for the emblem
//     decal (distance × low local variance × paintable);
//   * a mid-tone luminance gate (and a saturation / edge gate) so windows, engines, lights and seams stay clean.
// Per ship: the empire style (main / secondary colour, emblem glyph from the flag shape, per-empire hooks such as the
// Concord's salt bloom) and the withering level, which scales the COUNT and size of hard-edged wear marks added over
// the crisp original (never a global fade or blur): chipped decal / band paint, primer flecks at plate edges, seam
// grime lines, rust streaks running aft from rivets, leading-edge pitting, scorch round nozzles and old hits,
// replacement plates, charred storm scars — quantised so ships share textures.

/** A square RGBA image in the load-rotated crop space. */
export interface CropImage {
    rgba: Uint8ClampedArray;
    side: number;
}

/**
 * The raw art's crop square turned 90° clockwise (rotated (x', y') = raw (left + y', top + side − 1 − x'),
 * BuiltObjectImageCache.cs LoadSingleBuiltObjectImage), upsampled nearest by `scale`.
 */
export function cropRotatedImage(
    rgba: ArrayLike<number>,
    w: number,
    h: number,
    crop: { cropSide: number; cropCenterX: number; cropCenterY: number },
    scale = 1,
): CropImage {
    const side0 = crop.cropSide;
    const side = Math.max(1, Math.round(side0 * scale));
    const left = Math.round(crop.cropCenterX - side0 / 2);
    const top = Math.round(crop.cropCenterY - side0 / 2);
    const out = new Uint8ClampedArray(side * side * 4);
    for (let yr = 0; yr < side; yr++) {
        const sy = Math.min(side0 - 1, Math.floor(yr / scale));
        const x = left + sy;
        for (let xr = 0; xr < side; xr++) {
            const sx = Math.min(side0 - 1, Math.floor(xr / scale));
            const y = top + (side0 - 1 - sx);
            if (x < 0 || y < 0 || x >= w || y >= h) continue;
            const i = (y * w + x) * 4;
            const o = (yr * side + xr) * 4;
            out[o] = rgba[i];
            out[o + 1] = rgba[i + 1];
            out[o + 2] = rgba[i + 2];
            out[o + 3] = rgba[i + 3];
        }
    }
    return { rgba: out, side };
}

// ---------------------------------------------------------------------------------------------------------------
// Mask analysis
// ---------------------------------------------------------------------------------------------------------------

/** Alpha above this is hull. */
export const HULL_ALPHA = 32;

/**
 * Exact Euclidean distance (px) from every hull pixel to the nearest non-hull pixel (0 outside the hull); pixels past
 * the image edge count as non-hull. Felzenszwalb & Huttenlocher's separable squared-EDT.
 */
export function distanceTransform(mask: ArrayLike<number>, w: number, h: number): Float32Array {
    const INF = 1e20;
    const f = new Float64Array(Math.max(w, h) + 2);
    const d = new Float64Array(Math.max(w, h) + 2);
    const v = new Int32Array(Math.max(w, h) + 2);
    const z = new Float64Array(Math.max(w, h) + 3);
    const grid = new Float64Array(w * h);
    for (let i = 0; i < w * h; i++) grid[i] = mask[i] !== 0 ? INF : 0;
    // 1-D pass over n samples with a zero sentinel just outside both ends (the image border is background).
    const pass = (n: number, get: (k: number) => number, set: (k: number, val: number) => void): void => {
        const m = n + 2;
        f[0] = 0;
        f[m - 1] = 0;
        for (let k = 0; k < n; k++) f[k + 1] = get(k);
        let k = 0;
        v[0] = 0;
        z[0] = -INF;
        z[1] = INF;
        for (let q = 1; q < m; q++) {
            let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
            while (s <= z[k]) {
                k--;
                s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
            }
            k++;
            v[k] = q;
            z[k] = s;
            z[k + 1] = INF;
        }
        k = 0;
        for (let q = 0; q < m; q++) {
            while (z[k + 1] < q) k++;
            d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
        }
        for (let q = 0; q < n; q++) set(q, d[q + 1]);
    };
    for (let x = 0; x < w; x++) pass(h, (k) => grid[k * w + x], (k, val) => (grid[k * w + x] = val));
    for (let y = 0; y < h; y++) pass(w, (k) => grid[y * w + k], (k, val) => (grid[y * w + k] = val));
    const out = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) out[i] = mask[i] !== 0 ? Math.sqrt(grid[i]) : 0;
    return out;
}

function smoothstep(a: number, b: number, x: number): number {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
}

/** Relative luminance 0-1 of an sRGB pixel (Rec. 601 weights, as the art stats elsewhere use). */
export function luminance(r: number, g: number, b: number): number {
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/** HSV saturation 0-1. */
export function saturation(r: number, g: number, b: number): number {
    const max = Math.max(r, g, b);
    return max <= 0 ? 0 : (max - Math.min(r, g, b)) / max;
}

/**
 * The mid-tone gate 0-1: paint goes on plating (mid luminance, low saturation), never on dark seams / shadow
 * (lum < 0.12 → 0), bright windows and lights (lum > 0.8 → 0) or coloured engine glow / lamps (saturation > 0.55 → 0).
 */
export function midToneGate(lum: number, sat: number): number {
    return smoothstep(0.1, 0.24, lum) * (1 - smoothstep(0.62, 0.8, lum)) * (1 - smoothstep(0.35, 0.55, sat));
}

export interface HullAnalysis {
    side: number;
    mask: Uint8Array;
    /** Hull extent along the length axis (bow = xMax) and its length. */
    xMin: number;
    xMax: number;
    length: number;
    /** Per column: centreline y and half-width (NaN / 0 where the column is empty). */
    centre: Float32Array;
    halfWidth: Float32Array;
    /** Distance to the hull edge (px). */
    dist: Float32Array;
    lum: Float32Array;
    /** Paintability 0-1 (mid-tone gate × 1.5 px inset). */
    gate: Float32Array;
    /** Tint band columns [x0, x1). */
    band: { x0: number; x1: number };
    /** Hull number slot (centre, glyph height in px). */
    number: { x: number; y: number; h: number };
    /** Emblem decal (centre, radius px). */
    decal: { x: number; y: number; r: number };
    /** Content pixel count. */
    area: number;
    /** Mean luminance of the gated plating (the paint keeps the shading relative to it). */
    meanLum: number;
}

/** Analyses a crop image once (per texture): see the module comment. Null when there is no hull. */
export function analyseHull(img: CropImage): HullAnalysis | null {
    const side = img.side;
    const n = side * side;
    const mask = new Uint8Array(n);
    const lum = new Float32Array(n);
    const sat = new Float32Array(n);
    let area = 0;
    for (let i = 0; i < n; i++) {
        const r = img.rgba[i * 4];
        const g = img.rgba[i * 4 + 1];
        const b = img.rgba[i * 4 + 2];
        const a = img.rgba[i * 4 + 3];
        if (a > HULL_ALPHA && !(r === 0 && g === 0 && b === 0)) {
            mask[i] = 1;
            area++;
        }
        lum[i] = luminance(r, g, b);
        sat[i] = saturation(r, g, b);
    }
    if (area === 0) return null;
    const centre = new Float32Array(side).fill(Number.NaN);
    const halfWidth = new Float32Array(side);
    let xMin = side;
    let xMax = -1;
    for (let x = 0; x < side; x++) {
        let y0 = -1;
        let y1 = -1;
        for (let y = 0; y < side; y++) {
            if (mask[y * side + x] === 0) continue;
            if (y0 < 0) y0 = y;
            y1 = y;
        }
        if (y0 < 0) continue;
        centre[x] = (y0 + y1) / 2;
        halfWidth[x] = (y1 - y0 + 1) / 2;
        if (x < xMin) xMin = x;
        if (x > xMax) xMax = x;
    }
    const length = xMax - xMin + 1;
    const dist = distanceTransform(mask, side, side);
    const gate = new Float32Array(n);
    for (let i = 0; i < n; i++) if (mask[i] !== 0) gate[i] = midToneGate(lum[i], sat[i]) * smoothstep(0.5, 2, dist[i]);
    // Column paintability.
    const colGate = new Float32Array(side);
    for (let x = xMin; x <= xMax; x++) {
        let s = 0;
        let c = 0;
        for (let y = 0; y < side; y++) {
            const i = y * side + x;
            if (mask[i] === 0) continue;
            s += gate[i];
            c++;
        }
        colGate[x] = c > 0 ? (s / c) * Math.min(1, c / Math.max(4, length * 0.08)) : 0;
    }
    // Tint band: the most paintable window of width bw between 52 % and 76 % of the length from the stern.
    const bw = Math.max(2, Math.round(length * 0.055));
    let bx = xMin + Math.round(length * 0.62);
    let best = -1;
    for (let x = xMin + Math.round(length * 0.52); x + bw <= xMin + Math.round(length * 0.76); x++) {
        let s = 0;
        for (let k = 0; k < bw; k++) s += colGate[x + k];
        if (s > best) {
            best = s;
            bx = x;
        }
    }
    const band = { x0: bx, x1: bx + bw };
    // Hull number slot: 10-32 % from the stern, the widest paintable column, on the centreline.
    let nx = xMin + Math.round(length * 0.2);
    best = -1;
    for (let x = xMin + Math.round(length * 0.1); x <= xMin + Math.round(length * 0.32); x++) {
        const s = colGate[x] * halfWidth[x];
        if (s > best) {
            best = s;
            nx = x;
        }
    }
    const nh = Math.max(5, Math.min(Math.round(halfWidth[nx] * 0.55), Math.round(length * 0.06)));
    const number = { x: nx, y: Number.isNaN(centre[nx]) ? side / 2 : centre[nx], h: nh };
    // Decal: flat (low 5 × 5 luminance variance), deep inside the hull, paintable, clear of the band and the number.
    let dScore = -1;
    let decal = { x: xMin + Math.round(length * 0.45), y: side / 2, r: 3 };
    const rMax = Math.max(3, length * 0.11);
    for (let y = 2; y < side - 2; y++) {
        for (let x = Math.max(2, xMin + Math.round(length * 0.3)); x <= Math.min(side - 3, xMin + Math.round(length * 0.9)); x++) {
            const i = y * side + x;
            if (mask[i] === 0 || gate[i] < 0.3) continue;
            const r = Math.min(dist[i] * 0.8, rMax);
            if (r < 2.5) continue;
            if (x + r > band.x0 - 1 && x - r < band.x1 + 1) continue;
            if (Math.abs(x - number.x) < r + nh * 2 && Math.abs(y - number.y) < r + nh) continue;
            let s1 = 0;
            let s2 = 0;
            for (let dy = -2; dy <= 2; dy++) {
                for (let dx = -2; dx <= 2; dx++) {
                    const l = lum[i + dy * side + dx];
                    s1 += l;
                    s2 += l * l;
                }
            }
            const variance = Math.max(0, s2 / 25 - (s1 / 25) ** 2);
            const score = r * gate[i] * (1 - Math.min(1, variance * 40));
            if (score > dScore) {
                dScore = score;
                decal = { x, y, r };
            }
        }
    }
    let ls = 0;
    let lw = 0;
    for (let i = 0; i < n; i++) {
        ls += lum[i] * gate[i];
        lw += gate[i];
    }
    const meanLum = lw > 0 ? ls / lw : 0.4;
    return { side, mask, xMin, xMax, length, centre, halfWidth, dist, lum, gate, band, number, decal, area, meanLum };
}

// ---------------------------------------------------------------------------------------------------------------
// Withering
// ---------------------------------------------------------------------------------------------------------------

/** Years for the withering curve to reach 63 %. */
export const WITHER_TAU_YEARS = 10;
/** Pirates never look fresher than this. */
export const PIRATE_WITHER_FLOOR = 0.7;
/** Buckets the level is quantised to (shared textures). */
export const WITHER_STEPS = 4;

/** Withering 0-1 from the years since the last reset (build, retrofit, long repair): 1 − exp(−age / τ). */
export function witherCurve(ageYears: number): number {
    if (!(ageYears > 0)) return 0;
    return 1 - Math.exp(-ageYears / WITHER_TAU_YEARS);
}

export interface WitherInputs {
    /** Star dates (ms): BuiltObject.DateBuilt, DateRetrofit (set when a retrofit is assigned, empireConstruction.ts
     * 952 / 1424-1445), and the render-observed end of the last long repair (0 = none). */
    nowStarDate: number;
    dateBuilt: number;
    dateRetrofit: number;
    repairedAt: number;
    /** Game year length in star-date ms (galaxyTime.ts YEAR_LENGTH). */
    yearLength: number;
    pirate: boolean;
}

/**
 * The withering level of a ship. A retrofit or a long repair resets it (the latest of the three dates counts); a
 * pirate starts withered and only ages from its build date (it "rarely resets": retrofits and repairs do not count).
 */
export function witherLevel(w: WitherInputs): number {
    const since = w.pirate ? w.dateBuilt : Math.max(w.dateBuilt, w.dateRetrofit, w.repairedAt);
    const age = (w.nowStarDate - since) / w.yearLength;
    const level = witherCurve(age);
    return w.pirate ? Math.max(PIRATE_WITHER_FLOOR, level) : level;
}

/** Level → bucket 0..WITHER_STEPS (0 = fresh). */
export function witherBucket(level: number): number {
    return Math.max(0, Math.min(WITHER_STEPS, Math.round(level * WITHER_STEPS)));
}

// ---------------------------------------------------------------------------------------------------------------
// Painting
// ---------------------------------------------------------------------------------------------------------------

export interface LiveryStyle {
    /** 0xRRGGBB. */
    main: number;
    secondary: number;
    /** Emblem glyph (0..EMBLEM_GLYPHS − 1), from the empire's flag shape. */
    emblem: number;
    /** Concord treasure ships: salt bloom / barnacle growth on the hull edges, 0-1. */
    saltBloom: number;
    /** Paint the tint band / decal at all (false: wither only — e.g. pirates' mismatched scrap). */
    paint: boolean;
}

export interface WitherLook {
    /** Bucketed level 0-1. */
    level: number;
    /** Charred lightning streaks (0-4). */
    scars: number;
}

/** Thruster rectangles in crop space at the analysis scale (ShipMarkers × scale), for the engine scorch. */
export interface ScorchSource {
    left: number;
    top: number;
    height: number;
}

/** Overall cap on the overlay's alpha (subtle). */
export const LIVERY_ALPHA_CAP = 0.62;
export const EMBLEM_GLYPHS = 8;

function hash(x: number, y: number, seed: number): number {
    let h = (x * 374761393 + y * 668265263 + seed * 2246822519) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

function rgbOf(c: number): [number, number, number] {
    return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
}

/** Is (u, v) in [-1, 1]² inside emblem glyph `g`? Eight simple heraldic shapes. */
export function emblemGlyphHit(g: number, u: number, v: number): boolean {
    const r = Math.hypot(u, v);
    switch (((g % EMBLEM_GLYPHS) + EMBLEM_GLYPHS) % EMBLEM_GLYPHS) {
        case 0: // star (5 points)
            return r < 0.35 + 0.35 * Math.pow(Math.abs(Math.cos((5 / 2) * Math.atan2(v, u))), 3);
        case 1: // chevron
            return Math.abs(v - Math.abs(u) * 0.9 + 0.1) < 0.22 && Math.abs(u) < 0.8;
        case 2: // ring
            return r > 0.45 && r < 0.72;
        case 3: // cross
            return (Math.abs(u) < 0.2 || Math.abs(v) < 0.2) && r < 0.8;
        case 4: // crescent
            return r < 0.72 && Math.hypot(u - 0.3, v) > 0.55;
        case 5: // diamond
            return Math.abs(u) + Math.abs(v) < 0.72;
        case 6: // twin bars
            return Math.abs(Math.abs(u) - 0.35) < 0.14 && Math.abs(v) < 0.7;
        default: // triangle
            return v > -0.55 && Math.abs(u) < (0.65 - (v + 0.55) * 0.55) && v < 0.7;
    }
}

function blend(out: Uint8ClampedArray, i: number, r: number, g: number, b: number, a: number): void {
    if (a <= 0) return;
    const a0 = out[i + 3] / 255;
    const an = a + a0 * (1 - a);
    if (an <= 0) return;
    out[i] = (r * a + out[i] * a0 * (1 - a)) / an;
    out[i + 1] = (g * a + out[i + 1] * a0 * (1 - a)) / an;
    out[i + 2] = (b * a + out[i + 2] * a0 * (1 - a)) / an;
    out[i + 3] = an * 255;
}

/** Hard (unblended-looking) mark: set the overlay pixel if in the hull. */
function mark(an: HullAnalysis, out: Uint8ClampedArray, x: number, y: number, r: number, g: number, b: number, a: number): void {
    const side = an.side;
    if (x < 0 || y < 0 || x >= side || y >= side) return;
    const i = y * side + x;
    if (an.mask[i] === 0) return;
    blend(out, i * 4, r, g, b, a);
}

/** Wear-mark counts for a level over `area` in mark units² (the level scales how many marks and how big, never a global fade). */
export function wearCounts(level: number, area: number): { streaks: number; chips: number; pits: number; plates: number; hits: number } {
    const L = Math.max(0, Math.min(1, level));
    return {
        streaks: Math.round((area / 140) * Math.pow(L, 1.5)) + (L > 0 ? 1 : 0),
        chips: Math.round((area / 30) * L),
        pits: Math.round((area / 70) * L),
        plates: L >= 0.2 ? Math.floor(L * 2.6) : 0,
        hits: Math.round(L * 3.4),
    };
}

/**
 * Paints the livery + withering overlay (side² RGBA, normal blending over the crisp original sprite). The paint keeps
 * the original's shading (tint × pixel luminance relative to the plating). Wear is ADDED as legible hard-edged marks
 * whose count and size grow with the level — rust streaks (dark core, bright edge) running aft from rivets / seams,
 * chipped paint (light primer flecks) at plate edges, seam grime as dark lines, pitting (dark dot, lit rim) on the
 * leading edges, scorch (sharp inner edge, dark falloff) round the nozzles and old hit points, discoloured replacement
 * plates — and the decal / band go chipped (missing chunks), never faded. `seed` varies the marks per texture.
 */
export function paintLivery(an: HullAnalysis, img: CropImage, style: LiveryStyle | null, look: WitherLook, seed: number, thrusters: readonly ScorchSource[] = []): Uint8ClampedArray {
    const side = an.side;
    const out = new Uint8ClampedArray(side * side * 4);
    const L = look.level;
    // Mark unit: wear must read at play size, so marks scale with the hull (≈ 1/90 of its length, ≥ 2 px).
    const u = Math.max(2, Math.round(an.length / 90));
    const n = wearCounts(L, an.area / (u * u));
    const block = (x: number, y: number, sz: number, r: number, g: number, b: number, a: number): void => {
        for (let dy = 0; dy < sz; dy++) for (let dx = 0; dx < sz; dx++) mark(an, out, x + dx, y + dy, r, g, b, a);
    };
    /** Chipped paint: (1.5 u)² cells knocked out, more with the level. */
    const cell = Math.max(3, Math.round(u * 1.5));
    const chipped = (x: number, y: number): boolean => hash(Math.floor(x / cell), Math.floor(y / cell), seed + 71) < 0.42 * L * L;
    const chipEdge = (x: number, y: number): boolean => !chipped(x, y) && (chipped(x - 1, y) || chipped(x + 1, y) || chipped(x, y - 1) || chipped(x, y + 1));
    // Replacement plates first (under the paint): a rectangle of plating in another tone with a dark outline.
    for (let p = 0; p < n.plates; p++) {
        const u = 0.15 + 0.7 * hash(p, 91, seed);
        const cx = Math.round(an.xMin + an.length * u);
        const cy = Number.isNaN(an.centre[cx]) ? side / 2 : an.centre[cx] + (hash(p, 92, seed) - 0.5) * an.halfWidth[cx];
        const w = Math.max(6, Math.round(an.length * (0.07 + 0.05 * hash(p, 93, seed))));
        const h = Math.max(5, Math.round((an.halfWidth[cx] || 8) * (0.5 + 0.3 * hash(p, 94, seed))));
        const warm = hash(p, 95, seed) < 0.5;
        for (let y = Math.round(cy - h / 2); y <= Math.round(cy + h / 2); y++) {
            for (let x = cx - Math.round(w / 2); x <= cx + Math.round(w / 2); x++) {
                if (x < 0 || y < 0 || x >= side || y >= side) continue;
                const i = y * side + x;
                if (an.mask[i] === 0 || an.dist[i] < 1.5) continue;
                const edge = y === Math.round(cy - h / 2) || y === Math.round(cy + h / 2) || x === cx - Math.round(w / 2) || x === cx + Math.round(w / 2);
                const l = an.lum[i] * 255;
                if (edge) mark(an, out, x, y, 18, 16, 14, 0.9);
                else if (warm) mark(an, out, x, y, l * 1.15 + 18, l * 0.95 + 6, l * 0.7, 0.85);
                else mark(an, out, x, y, l * 0.7, l * 0.9 + 6, l * 1.1 + 22, 0.85);
            }
        }
    }
    if (style !== null && style.paint) {
        const [mr, mg, mb] = rgbOf(style.main);
        const [sr, sg, sb] = rgbOf(style.secondary);
        const paintPx = (i: number, x: number, y: number, cr: number, cg: number, cb: number, k: number, a: number): void => {
            if (chipped(x, y)) return;
            if (chipEdge(x, y) && L > 0) {
                // Primer / bare metal at the chip's rim.
                blend(out, i * 4, 205, 198, 182, 0.9);
                return;
            }
            blend(out, i * 4, cr * k, cg * k, cb * k, a);
        };
        // Band + pinstripes.
        for (let y = 0; y < side; y++) {
            for (let x = an.band.x0 - 1; x <= an.band.x1; x++) {
                if (x < 0 || x >= side) continue;
                const i = y * side + x;
                if (an.mask[i] === 0 || an.gate[i] <= 0) continue;
                const edge = x === an.band.x0 - 1 || x === an.band.x1;
                const k = Math.max(0.55, Math.min(1.3, an.lum[i] / Math.max(0.05, an.meanLum)));
                const [cr, cg, cb] = edge ? [sr, sg, sb] : [mr, mg, mb];
                paintPx(i, x, y, cr, cg, cb, k, an.gate[i] * (edge ? 0.6 : 0.62));
            }
        }
        // Emblem decal: disc in the main colour, glyph + rim in the secondary; chipped with age.
        const d = an.decal;
        const R = Math.ceil(d.r);
        for (let y = Math.floor(d.y) - R; y <= Math.floor(d.y) + R; y++) {
            for (let x = Math.floor(d.x) - R; x <= Math.floor(d.x) + R; x++) {
                if (x < 0 || y < 0 || x >= side || y >= side) continue;
                const i = y * side + x;
                if (an.mask[i] === 0) continue;
                const u = (x - d.x) / d.r;
                const v = (y - d.y) / d.r;
                const rr = Math.hypot(u, v);
                if (rr > 1) continue;
                const aa = Math.min(1, (1 - rr) * d.r) * an.gate[i];
                const k = Math.max(0.6, Math.min(1.25, 0.35 + 0.65 * (an.lum[i] / Math.max(0.05, an.meanLum))));
                const glyph = emblemGlyphHit(style.emblem, u * 1.15, v * 1.15);
                const rim = rr > 0.84;
                const [cr, cg, cb] = glyph || rim ? [sr, sg, sb] : [mr, mg, mb];
                paintPx(i, x, y, cr, cg, cb, k, Math.min(1, aa * 1.5) * 0.8);
            }
        }
    }
    if (L > 0) {
        // Seam grime: dark lines along the seams (pixels darker than their neighbours), denser with age.
        for (let y = 1; y < side - 1; y++) {
            for (let x = 1; x < side - 1; x++) {
                const i = y * side + x;
                if (an.mask[i] === 0) continue;
                const l = an.lum[i];
                const mean = (an.lum[i - 1] + an.lum[i + 1] + an.lum[i - side] + an.lum[i + side]) / 4;
                if (l < mean - 0.05 && hash(Math.floor(x / (2 * u)), Math.floor(y / (2 * u)), seed + 3) < 0.25 + 0.75 * L) block(x, y, Math.max(1, Math.round(u / 2)), 20, 16, 12, 0.85);
            }
        }
        // Chipped paint at plate edges: light flecks on the seams' lit side.
        let made = 0;
        for (let k = 0; made < n.chips && k < an.area * 4; k++) {
            const x = 1 + Math.floor(hash(k, 11, seed) * (side - 2));
            const y = 1 + Math.floor(hash(k, 12, seed) * (side - 2));
            const i = y * side + x;
            if (an.mask[i] === 0 || an.gate[i] < 0.2) continue;
            const edgeOfPlate = Math.abs(an.lum[i] - an.lum[i - 1]) > 0.06 || Math.abs(an.lum[i] - an.lum[i - side]) > 0.06;
            if (!edgeOfPlate && hash(k, 13, seed) > 0.25) continue;
            made++;
            const cs = Math.max(1, Math.round(u * (0.6 + 0.8 * L * hash(k, 16, seed))));
            block(x, y, cs, 222, 216, 200, 0.95);
            if (hash(k, 14, seed) < 0.5 + 0.4 * L) block(x + cs, y, Math.max(1, cs - 1), 176, 168, 150, 0.9);
            if (L > 0.6 && hash(k, 15, seed) < 0.4) block(x, y + cs, Math.max(1, cs - 1), 176, 168, 150, 0.9);
        }
        // Rust streaks: from rivets / hatch corners (seam specks), running aft (−x), dark core with a bright edge.
        made = 0;
        for (let k = 0; made < n.streaks && k < an.area * 4; k++) {
            const x = Math.floor(hash(k, 1, seed) * side);
            const y = Math.floor(hash(k, 2, seed) * side);
            if (x < 2 || y < 2 || x >= side - 2 || y >= side - 2) continue;
            const i = y * side + x;
            if (an.mask[i] === 0 || an.gate[i] < 0.3 || an.dist[i] < 3) continue;
            made++;
            const len = Math.round(u * 3 + (an.length * 0.1 * hash(k, 3, seed)) * (0.4 + L));
            const wide = Math.max(1, Math.round(u * (0.6 + 0.6 * L)));
            const edge = Math.max(1, Math.round(u / 2));
            block(x, y - 1, wide + 1, 50, 26, 12, 1);
            block(x + wide + 1, y - 1, edge, 226, 140, 64, 0.95);
            for (let s = 1; s < len; s++) {
                const xs = x - s;
                if (xs < 0 || an.mask[y * side + xs] === 0) break;
                const fade = 1 - s / len;
                const w2 = Math.max(1, Math.round(wide * (0.5 + 0.5 * fade)));
                const drift = Math.round(Math.sin((s + k) * 0.25) * 0.7);
                for (let wv = 0; wv < w2; wv++) mark(an, out, xs, y + drift + wv, 96, 42, 14, 0.6 + 0.4 * fade);
                for (let e = 1; e <= edge; e++) mark(an, out, xs, y + drift - e, 222, 128, 54, 0.8 * fade);
                mark(an, out, xs, y + drift + w2, 140, 64, 26, 0.45 * fade);
            }
        }
        // Pitting on the leading edges: dark dot with a lit rim.
        made = 0;
        for (let k = 0; made < n.pits && k < an.area * 4; k++) {
            const x = 1 + Math.floor(hash(k, 21, seed) * (side - 2));
            const y = 1 + Math.floor(hash(k, 22, seed) * (side - 2));
            const i = y * side + x;
            if (an.mask[i] === 0) continue;
            let lead = false;
            for (let q = 1; q <= 4; q++) if (x + q >= side || an.mask[i + q] === 0) lead = true;
            if (!lead) continue;
            made++;
            const ps = Math.max(1, Math.round(u * (0.5 + 0.6 * L * hash(k, 24, seed))));
            block(x, y, ps, 12, 10, 10, 0.95);
            block(x - 1, y - 1, 1, 230, 226, 214, 0.9);
            for (let q = 0; q < ps; q++) {
                mark(an, out, x + q, y - 1, 230, 226, 214, 0.85);
                mark(an, out, x - 1, y + q, 200, 196, 186, 0.8);
            }
        }
        // Scorch: nozzles and old hit points — sharp near-black core, dark falloff.
        const scorch = (cx: number, cy: number, r0: number, r1: number): void => {
            for (let y = Math.floor(cy - r1); y <= Math.ceil(cy + r1); y++) {
                for (let x = Math.floor(cx - r1); x <= Math.ceil(cx + r1); x++) {
                    const d = Math.hypot(x - cx, (y - cy) * 1.2) + (hash(Math.floor(x / u), Math.floor(y / u), seed + 7) - 0.5) * u;
                    if (d > r1) continue;
                    if (d <= r0) mark(an, out, x, y, 16, 12, 10, 0.92);
                    else mark(an, out, x, y, 26, 20, 16, 0.75 * (1 - (d - r0) / (r1 - r0)));
                }
            }
        };
        for (const t of thrusters) {
            const r1 = Math.max(4, an.length * (0.05 + 0.07 * L));
            scorch(t.left + 1, t.top + t.height / 2, r1 * 0.35, r1);
        }
        for (let hI = 0; hI < n.hits; hI++) {
            const u = 0.2 + 0.65 * hash(hI, 31, seed);
            const cx = an.xMin + an.length * u;
            const col = Math.floor(cx);
            const cy = (Number.isNaN(an.centre[col]) ? side / 2 : an.centre[col]) + (hash(hI, 32, seed) - 0.5) * (an.halfWidth[col] || 4);
            const r1 = Math.max(3, an.length * 0.035 * (0.6 + L));
            scorch(cx, cy, r1 * 0.4, r1);
        }
    }
    // Storm scars: charred zig-zag streaks (kept after repair; reset by a retrofit).
    for (let s = 0; s < Math.min(4, look.scars); s++) {
        let x = an.xMin + an.length * (0.2 + 0.6 * hash(s, 7, seed));
        let y = (an.centre[Math.floor(x)] || side / 2) - an.halfWidth[Math.floor(x)] * 0.9;
        const dir = hash(s, 8, seed) < 0.5 ? 1 : -1;
        for (let k = 0; k < an.length * 0.5; k++) {
            x += dir * (0.6 + 0.8 * hash(s, k + 11, seed)) * 0.9 * (hash(s, k + 40, seed) < 0.5 ? 1 : -0.4);
            y += 0.9;
            const xi = Math.round(x);
            const yi = Math.round(y);
            if (xi < 0 || yi < 0 || xi >= side || yi >= side) break;
            block(xi, yi, u, 10, 8, 8, 0.95);
            mark(an, out, xi - 1, yi, 150, 140, 180, 0.7);
        }
    }
    // Salt bloom / barnacles on the hull edges (per-empire style hook).
    const salt = style?.saltBloom ?? 0;
    if (salt > 0) {
        for (let i = 0; i < side * side; i++) {
            if (an.mask[i] === 0 || an.dist[i] > 2.6) continue;
            const x = i % side;
            const y = (i / side) | 0;
            const hN = hash(x >> 1, y >> 1, seed + 99);
            if (hN < 0.55 * salt) blend(out, i * 4, 228, 226, 212, 0.55 * (0.6 + 0.4 * hash(x, y, seed)));
        }
    }
    return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Hull numbers
// ---------------------------------------------------------------------------------------------------------------

/** 3 × 5 digit glyphs, rows top → bottom, bit 2 = left column. */
const DIGITS: readonly (readonly number[])[] = [
    [7, 5, 5, 5, 7],
    [2, 6, 2, 2, 7],
    [7, 1, 7, 4, 7],
    [7, 1, 7, 1, 7],
    [5, 5, 7, 1, 1],
    [7, 4, 7, 1, 7],
    [7, 4, 7, 5, 7],
    [7, 1, 1, 2, 2],
    [7, 5, 7, 5, 7],
    [7, 5, 7, 1, 1],
];

/** A ship's hull number: its id folded to 1-3 digits (render-only decoration). */
export function hullNumber(builtObjectID: number): string {
    return String(Math.abs(builtObjectID) % 1000).padStart(2, '0');
}

/**
 * The digits of `text` as RGBA, `px` pixels per glyph cell, with a 1-cell dark outline so they read on any plating.
 * Reads along +x (the ship's length in crop space, bow to the right).
 */
export function hullNumberRgba(text: string, fg: number, px = 1): { rgba: Uint8ClampedArray; w: number; h: number } {
    const cells = text.length * 4 - 1;
    const w = (cells + 2) * px;
    const h = (5 + 2) * px;
    const out = new Uint8ClampedArray(w * h * 4);
    const [r, g, b] = rgbOf(fg);
    const on = (cx: number, cy: number): boolean => {
        const d = Math.floor(cx / 4);
        const c = cx % 4;
        if (d < 0 || d >= text.length || c === 3 || cy < 0 || cy > 4) return false;
        const code = text.charCodeAt(d) - 48;
        if (code < 0 || code > 9) return false;
        return ((DIGITS[code][cy] >> (2 - c)) & 1) === 1;
    };
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const cx = Math.floor(x / px) - 1;
            const cy = Math.floor(y / px) - 1;
            const i = (y * w + x) * 4;
            if (on(cx, cy)) {
                out[i] = r;
                out[i + 1] = g;
                out[i + 2] = b;
                out[i + 3] = 230;
            } else if (on(cx - 1, cy) || on(cx + 1, cy) || on(cx, cy - 1) || on(cx, cy + 1)) {
                out[i] = 16;
                out[i + 1] = 14;
                out[i + 2] = 12;
                out[i + 3] = 150;
            }
        }
    }
    return { rgba: out, w, h };
}
