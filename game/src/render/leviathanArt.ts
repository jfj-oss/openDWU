// The Leviathan's art (Void Whale threat, scenarios/void-whale): a giant scarred space whale seen FROM ABOVE like every
// creature and ship (head along +x, turned with its heading) — a broad blunt box head with the blowhole and the mouth
// line across the snout, a lower jaw that slides out gaping on a swallow (gullet, teeth), a thick trunk with a spine
// ridge and dorsal knuckles tapering to broad flukes, two long pectoral fins (the left one torn). The hide is near-black
// grimy slate, a little lighter where the body curves away at the flanks, with soot streaks, decay mottling, barnacle
// crusts, dried-blood scabs, scorch marks, pale squid-sucker and rake scars, harpoon puckers, rusted broken harpoons
// with slack lines, blackened hull plates jammed in, sparse faint cyan markings and small pale eyes on the head's sides.
//
// Everything is pure (typed arrays, no DOM, own hash noise — never galaxy.rnd) and baked ONCE at high resolution
// (body 1600 x 640); the rig (leviathanRig.ts) only moves the parts. Local frame: head toward +x, left flank −y.

import { fbm, makeValueNoise, smoothstep, type RgbaImage } from './creatureRig';

type Rgb = readonly [number, number, number];

export const LEV_W = 1600;
export const LEV_H = 640;
/** Body extent along x (texture px): the tail stalk ends at X0 (the fluke root), the blunt snout at X1. */
export const LEV_X0 = 40;
export const LEV_X1 = LEV_W - 16;
const CY = LEV_H / 2;

// ---------------------------------------------------------------------------
// Small pure helpers.

function image(w: number, h: number): RgbaImage {
    return { w, h, data: new Uint8ClampedArray(w * h * 4) };
}

/** Deterministic 0..1 hash of (seed, k). */
export function lh(seed: number, k: number): number {
    let h = Math.imul(seed * 2654435761 + k * 40503 + 977, 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 15), 0xc2b2ae35);
    h ^= h >>> 13;
    h = Math.imul(h, 0x27d4eb2f);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const mix = (a: Rgb, b: Rgb, t: number): [number, number, number] => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Catmull-Rom through [u, value] knots (unclamped). */
function spline(k: readonly (readonly [number, number])[], u: number): number {
    if (u <= k[0][0]) return k[0][1];
    if (u >= k[k.length - 1][0]) return k[k.length - 1][1];
    let i = 0;
    while (i < k.length - 2 && u > k[i + 1][0]) i++;
    const p0 = k[Math.max(0, i - 1)][1];
    const p1 = k[i][1];
    const p2 = k[i + 1][1];
    const p3 = k[Math.min(k.length - 1, i + 2)][1];
    const t = (u - k[i][0]) / (k[i + 1][0] - k[i][0]);
    const t2 = t * t;
    const t3 = t2 * t;
    return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/** Straight-alpha source-over of one pixel; `cover` (0..1) scales the alpha. */
function over(img: RgbaImage, x: number, y: number, r: number, g: number, b: number, a: number): void {
    if (x < 0 || y < 0 || x >= img.w || y >= img.h || a <= 0.002) return;
    const i = (y * img.w + x) * 4;
    const sa = Math.min(1, a);
    const da = img.data[i + 3] / 255;
    const oa = sa + da * (1 - sa);
    if (oa <= 0) return;
    img.data[i] = (r * sa + img.data[i] * da * (1 - sa)) / oa;
    img.data[i + 1] = (g * sa + img.data[i + 1] * da * (1 - sa)) / oa;
    img.data[i + 2] = (b * sa + img.data[i + 2] * da * (1 - sa)) / oa;
    img.data[i + 3] = oa * 255;
}

/** Tints a pixel toward (r, g, b) by `a` keeping its alpha (paint ON the hide only). */
function tint(img: RgbaImage, x: number, y: number, r: number, g: number, b: number, a: number): void {
    if (x < 0 || y < 0 || x >= img.w || y >= img.h || a <= 0.002) return;
    const i = (y * img.w + x) * 4;
    const k = Math.min(1, a) * Math.min(1, img.data[i + 3] / 200);
    img.data[i] += (r - img.data[i]) * k;
    img.data[i + 1] += (g - img.data[i + 1]) * k;
    img.data[i + 2] += (b - img.data[i + 2]) * k;
}

/** Multiplies a pixel's colour by `m` (shadows / grooves), on the hide only. */
function shade(img: RgbaImage, x: number, y: number, m: number): void {
    if (x < 0 || y < 0 || x >= img.w || y >= img.h) return;
    const i = (y * img.w + x) * 4;
    img.data[i] *= m;
    img.data[i + 1] *= m;
    img.data[i + 2] *= m;
}

type PixFn = (x: number, y: number, t: number, d: number, side: number) => void;

/** Visits the pixels within `w` of the segment (x0, y0)–(x1, y1): t along it, d distance, side −1..1 across. */
function segment(img: RgbaImage, x0: number, y0: number, x1: number, y1: number, w: number, fn: PixFn): void {
    const minX = Math.max(0, Math.floor(Math.min(x0, x1) - w - 1));
    const maxX = Math.min(img.w - 1, Math.ceil(Math.max(x0, x1) + w + 1));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1) - w - 1));
    const maxY = Math.min(img.h - 1, Math.ceil(Math.max(y0, y1) + w + 1));
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.max(1e-6, Math.hypot(dx, dy));
    for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
            const px = x + 0.5 - x0;
            const py = y + 0.5 - y0;
            const t = Math.max(0, Math.min(1, (px * dx + py * dy) / (len * len)));
            const d = Math.hypot(px - dx * t, py - dy * t);
            if (d > w) continue;
            fn(x, y, t, d, (px * dy - py * dx) / len / w);
        }
    }
}

/** Visits the pixels of a disc of radius r: d = distance / r. */
function disc(img: RgbaImage, cx: number, cy: number, r: number, fn: (x: number, y: number, d: number) => void): void {
    for (let y = Math.max(0, Math.floor(cy - r - 1)); y <= Math.min(img.h - 1, Math.ceil(cy + r + 1)); y++) {
        for (let x = Math.max(0, Math.floor(cx - r - 1)); x <= Math.min(img.w - 1, Math.ceil(cx + r + 1)); x++) {
            const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r;
            if (d <= 1) fn(x, y, d);
        }
    }
}

/** Signed distance (px, negative inside) to a closed polygon. */
function polyDist(pts: readonly [number, number][], x: number, y: number): number {
    let d = Infinity;
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i];
        const [xj, yj] = pts[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
        const ex = xi - xj;
        const ey = yi - yj;
        const t = Math.max(0, Math.min(1, ((x - xj) * ex + (y - yj) * ey) / Math.max(1e-6, ex * ex + ey * ey)));
        d = Math.min(d, Math.hypot(x - (xj + ex * t), y - (yj + ey * t)));
    }
    return inside ? -d : d;
}

/** Visits the pixels of a polygon (with a 1.5 px soft rim): cover 0..1 and the distance inside. */
function polygon(img: RgbaImage, pts: readonly [number, number][], fn: (x: number, y: number, cover: number, inside: number) => void): void {
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    for (let y = Math.max(0, Math.floor(Math.min(...ys) - 2)); y <= Math.min(img.h - 1, Math.ceil(Math.max(...ys) + 2)); y++) {
        for (let x = Math.max(0, Math.floor(Math.min(...xs) - 2)); x <= Math.min(img.w - 1, Math.ceil(Math.max(...xs) + 2)); x++) {
            const sd = polyDist(pts, x + 0.5, y + 0.5);
            if (sd > 1) continue;
            fn(x, y, clamp01(0.5 - sd / 1.5), -sd);
        }
    }
}

// ---------------------------------------------------------------------------
// The outline (seen from above).

// Half-width in units of LEV_H, tail (u 0) to snout (u 1): a narrow tail stock, a deep muscular trunk, a slight neck
// and the broad blunt box of the head.
const HALF: [number, number][] = [
    [0, 0.07], [0.06, 0.088], [0.14, 0.125], [0.24, 0.18], [0.34, 0.235], [0.44, 0.275], [0.54, 0.302], [0.62, 0.31],
    [0.69, 0.296], [0.76, 0.292], [0.86, 0.294], [0.93, 0.288], [0.97, 0.27], [0.99, 0.235], [1, 0.19],
];
/** Dorsal knuckles (u, height) along the spine of the tail half, and the low dorsal hump. */
const KNUCKLES: [number, number][] = [[0.13, 0.6], [0.18, 0.7], [0.23, 0.8], [0.28, 0.85], [0.33, 0.8], [0.38, 0.65], [0.445, 1.4]];

export const levX = (u: number): number => LEV_X0 + u * (LEV_X1 - LEV_X0);
export const levU = (x: number): number => (x - LEV_X0) / (LEV_X1 - LEV_X0);

/** Half-width of the body at u (texture px). */
export function levHalf(u: number): number {
    return spline(HALF, u) * LEV_H;
}
/** Left / right edge at u (texture px, y down). */
export function levTop(u: number): number {
    return CY - levHalf(u);
}
export function levBot(u: number): number {
    return CY + levHalf(u);
}
/** Spine bump 0..~1.4 at u (the knuckles). */
function knuckle(u: number): number {
    let v = 0;
    for (const [ku, kh] of KNUCKLES) v += kh * Math.exp(-Math.pow((u - ku) / (kh > 1 ? 0.03 : 0.013), 2));
    return v;
}

/** Jaw hinge (texture px, on the centreline under the head): the lower jaw slides forward from here as it gapes. */
export const LEV_HINGE_U = 0.7;
export const LEV_HINGE: [number, number] = [levX(LEV_HINGE_U), CY];
/** Pectoral fin roots (texture px), left (−y) and right (+y) flank. */
export const LEV_FIN_U = 0.6;
export const LEV_FIN_ROOT: [number, number] = [levX(LEV_FIN_U), CY - levHalf(LEV_FIN_U) * 0.7];
/** Eyes, low on each side of the head. */
export const LEV_EYE_U = 0.76;
export const LEV_EYES: [number, number][] = [
    [levX(LEV_EYE_U), CY - levHalf(LEV_EYE_U) * 0.9],
    [levX(LEV_EYE_U), CY + levHalf(LEV_EYE_U) * 0.9],
];

/** A point on the back: u along, t across (0 left edge .. 1 right edge). */
export function levFlank(u: number, t: number): [number, number] {
    const top = levTop(u);
    return [levX(u), top + (levBot(u) - top) * t];
}

// ---------------------------------------------------------------------------
// Palette.

const BACK: Rgb = [9, 11, 16];
const FLANK: Rgb = [30, 35, 45];
const BRUISE: Rgb = [30, 22, 32];
const HIDE_GREY: Rgb = [48, 52, 60];
const SCAR: Rgb = [128, 132, 134];
const SCAR_PINK: Rgb = [128, 104, 104];
const RIM: Rgb = [60, 96, 120];
const IVORY: Rgb = [232, 222, 196];
const LUMIN_CORE: Rgb = [196, 250, 255];
const LUMIN_HALO: Rgb = [40, 170, 226];

/** Light direction (toward the light): mostly from the viewer's side, a little ahead and from the left flank. */
const LX = 0.22;
const LY = -0.62;
const LZ = 0.75;

/** Lambert of a cylinder-ish surface: `ny` −1 (left flank) .. 1 (right flank), `nx` toward the head. */
function lambert(nx: number, ny: number): number {
    const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny * 0.97));
    const l = Math.hypot(LX, LY, LZ);
    return Math.max(0, (nx * LX + ny * LY + nz * LZ) / l);
}

// ---------------------------------------------------------------------------
// Body.

export interface LeviathanBody {
    /** The hide (straight alpha). */
    body: RgbaImage;
    /** Additive bioluminescence (markings and eyes) over the body. */
    lumin: RgbaImage;
}

/** The body raster seen from above: hide, shading, spine ridge, scars, embedded wreckage, eyes. Pure; ~1 M px. */
export function paintLeviathanBody(seed = 91): LeviathanBody {
    const img = image(LEV_W, LEV_H);
    const lumin = image(LEV_W, LEV_H);
    const nBig = makeValueNoise(seed);
    const nWr = makeValueNoise(seed + 1);
    const nFine = makeValueNoise(seed + 2);
    const nBel = makeValueNoise(seed + 3);
    for (let x = 0; x < LEV_W; x++) {
        const u = levU(x + 0.5);
        if (u < -0.01 || u > 1.01) continue;
        const half = levHalf(u);
        const top = CY - half;
        const bot = CY + half;
        const head = smoothstep(0.66, 0.76, u);
        const kn = knuckle(u);
        const spineH = u < 0.66 ? 0.35 + 1.1 * kn : 0.3 * (1 - head) + 0.1;
        for (let y = Math.max(0, Math.floor(top - 2)); y <= Math.min(LEV_H - 1, Math.ceil(bot + 2)); y++) {
            const py = y + 0.5;
            const t = (py - top) / (bot - top);
            const across = 2 * t - 1;
            // Blunt rounded snout: the front face bulges forward in the middle.
            const front = LEV_X1 - 34 * across * across - x - 0.5;
            const tail = x + 0.5 - LEV_X0 + 6;
            const sd = Math.min(py - top, bot - py, front, tail);
            const cover = clamp01((sd + 0.75) / 1.5);
            if (cover <= 0) continue;
            // Normal: a broad barrel across, tilted forward on the snout, with the spine ridge raised along the middle.
            const snout = smoothstep(LEV_X1 - 120, LEV_X1, x);
            const ridgeW = 0.1;
            const ridge = Math.exp(-Math.pow(across / ridgeW, 2)) * spineH;
            const ridgeSlope = -2 * (across / (ridgeW * ridgeW)) * Math.exp(-Math.pow(across / ridgeW, 2)) * spineH * 0.02;
            const ny = Math.max(-0.97, Math.min(0.97, Math.sign(across) * Math.pow(Math.abs(across), 1.6) * (1 - 0.4 * snout) - ridgeSlope));
            const nx = snout * 0.7 + (kn > 0.05 && Math.abs(across) < 0.12 ? (knuckle(u + 0.004) - knuckle(u - 0.004)) * -3 : 0);
            const lam = lambert(Math.max(-0.9, Math.min(0.9, nx)), ny);
            const big = fbm(nBig, x / 110, y / 110, 4);
            const fine = fbm(nFine, x / 6, y / 6, 2);
            // From above: the bruised blue-black back, slate flanks, the pale mottled underside showing at the edges.
            const edge = Math.abs(across);
            let col = mix(BACK, FLANK, smoothstep(0.25, 0.85, edge));
            col = mix(col, BRUISE, 0.55 * smoothstep(0.52, 0.72, big) * (1 - edge));
            // Weathering: mottled decay patches, soot streaks dragged back along the hide.
            const decay = fbm(nBel, x / 60, y / 40, 4);
            col = mix(col, [34, 32, 24], 0.55 * smoothstep(0.6, 0.78, decay));
            col = mix(col, [52, 48, 44], 0.3 * smoothstep(0.7, 0.85, fbm(nBel, x / 18 + 50, y / 18, 2)));
            let k = 0.4 + 0.9 * lam;
            const soot = smoothstep(0.52, 0.72, fbm(nBig, x / 260 + 20, y / 11, 3));
            k *= 1 - 0.4 * soot;
            // Body wrinkles (sperm-whale skin): long wavy creases across the trunk, fewer on the head.
            const wr = fbm(nWr, x / 9 + 3 * big, y / 130, 3);
            const groove = 1 - smoothstep(0, 0.035, Math.abs(wr - 0.5));
            k *= 1 - 0.28 * groove * (1 - 0.7 * head) * smoothstep(0.05, 0.3, 1 - edge);
            k *= 0.9 + 0.2 * fine;
            // The spine ridge: a lit crest with a shadow on its far side.
            k *= 1 + 0.9 * ridge * (across < 0 ? 1 : -0.55);
            // Muscle bands either side of the spine: soft dark troughs.
            k *= 1 - 0.25 * Math.exp(-Math.pow((Math.abs(across) - 0.2) / 0.08, 2)) * (1 - head);
            // An oily dark sheen: a tight cold highlight, broken up by the grime.
            const sheen = Math.pow(lam, 22) * 0.55 * (1 - 0.7 * soot) * (0.6 + 0.8 * fine);
            const crest = across < 0.02 ? ridge * Math.exp(-Math.pow((across + 0.03) / 0.05, 2)) * 0.35 : 0;
            const rim = crest + (1 - smoothstep(0, 10, Math.min(py - top, bot - py))) * 0.75 + (1 - smoothstep(0, 10, front)) * 0.35;
            const i = (y * LEV_W + x) * 4;
            img.data[i] = col[0] * k + 70 * sheen + RIM[0] * rim;
            img.data[i + 1] = col[1] * k + 92 * sheen + RIM[1] * rim;
            img.data[i + 2] = col[2] * k + 104 * sheen + RIM[2] * rim;
            img.data[i + 3] = cover * 255;
        }
    }
    // The mouth line: a dark seam round the snout where the lower jaw closes under the head.
    for (let x = Math.floor(levX(0.74)); x < LEV_X1; x++) {
        const u = levU(x + 0.5);
        const h = levHalf(u) - 6;
        for (const side of [-1, 1]) {
            const y = CY + side * h;
            disc(img, x, y, 3, (px, py, d) => shade(img, px, py, 1 - 0.5 * (1 - d)));
        }
    }
    paintBlowhole(img);
    paintScars(img, seed);
    paintHarpoonPuckers(img, seed);
    paintGrime(img, seed);
    for (const [ex, ey] of LEV_EYES) paintEye(img, lumin, ex, ey);
    paintMarkings(img, lumin, seed);
    paintPlates(img, seed);
    paintHarpoons(img, seed);
    return { body: img, lumin };
}

/** Pale healed scars: squid-sucker rings on the head, long triple rakes, a net of fine scratches. */
function paintScars(img: RgbaImage, seed: number): void {
    // Fine scratches, densest on the battering-ram head.
    for (let k = 0; k < 230; k++) {
        const onHead = k < 140;
        const u = onHead ? 0.66 + 0.33 * lh(seed, k * 5) : 0.12 + 0.56 * lh(seed, k * 5);
        const t = 0.06 + 0.86 * lh(seed, k * 5 + 1);
        const [x, y] = levFlank(u, t);
        const ang = (lh(seed, k * 5 + 2) - 0.5) * 2.2 + (onHead ? 0 : 0.2);
        const L = 14 + 46 * lh(seed, k * 5 + 3);
        const a = 0.18 + 0.32 * lh(seed, k * 5 + 4);
        segment(img, x - (Math.cos(ang) * L) / 2, y - (Math.sin(ang) * L) / 2, x + (Math.cos(ang) * L) / 2, y + (Math.sin(ang) * L) / 2, 1.4, (px, py, tt, d) =>
            tint(img, px, py, SCAR[0], SCAR[1], SCAR[2], a * Math.sin(Math.PI * tt) * (1 - d / 1.4)),
        );
    }
    // Sucker rings (giant squid scars), in clusters on the head.
    for (let c = 0; c < 7; c++) {
        const cu = 0.7 + 0.27 * lh(seed, 900 + c);
        const ct = 0.15 + 0.6 * lh(seed, 910 + c);
        for (let k = 0; k < 7; k++) {
            const along = (k - 4) * 0.012;
            const [x, y] = levFlank(cu + along, ct + Math.sin(k * 0.7 + c) * 0.05);
            const r = 4 + 6 * lh(seed, 920 + c * 10 + k);
            disc(img, x, y, r + 2, (px, py, d) => {
                const ring = 1 - smoothstep(0.1, 0.3, Math.abs(d * (r + 2) - r) / (r + 2) * 4);
                tint(img, px, py, SCAR[0], SCAR[1], SCAR[2], 0.3 * ring * (0.5 + lh(c, k)));
            });
        }
    }
    // Long triple rakes: healed pinkish-pale with a dark seam.
    for (let k = 0; k < 7; k++) {
        const u = 0.18 + 0.72 * lh(seed, 1000 + k);
        const t = 0.15 + 0.6 * lh(seed, 1010 + k);
        const [x, y] = levFlank(u, t);
        const ang = Math.PI / 2 + (lh(seed, 1020 + k) - 0.5) * 1.3 + 0.5;
        const L = 90 + 120 * lh(seed, 1030 + k);
        for (let j = -1; j <= 1; j++) {
            const ox = -Math.sin(ang) * j * 11;
            const oy = Math.cos(ang) * j * 11;
            const x0 = x + ox - (Math.cos(ang) * L) / 2;
            const y0 = y + oy - (Math.sin(ang) * L) / 2;
            const x1 = x + ox + (Math.cos(ang) * L) / 2;
            const y1 = y + oy + (Math.sin(ang) * L) / 2;
            segment(img, x0, y0, x1, y1, 4.2, (px, py, tt, d) => {
                const e = Math.sin(Math.PI * tt);
                tint(img, px, py, SCAR_PINK[0], SCAR_PINK[1], SCAR_PINK[2], 0.62 * e * (1 - smoothstep(0.5, 1, d / 4.2)));
                if (d < 1.2) shade(img, px, py, 1 - 0.45 * e);
            });
        }
    }
}

/** The blowhole: an S-shaped slit toward the left front of the head-top, with a puckered lip. */
function paintBlowhole(img: RgbaImage): void {
    const x0 = levX(0.94);
    const y0 = CY - levHalf(0.94) * 0.35;
    let px0 = x0;
    let py0 = y0;
    for (let j = 1; j <= 8; j++) {
        const t = j / 8;
        const nx = x0 - t * 46;
        const ny = y0 + Math.sin(t * Math.PI * 1.6) * 9;
        segment(img, px0, py0, nx, ny, 5.5, (px, py, tt, d) => {
            shade(img, px, py, 1 - 0.3 * (1 - d / 5.5));
            if (d < 2) tint(img, px, py, 4, 4, 6, 0.85);
        });
        segment(img, px0 - 1, py0 - 5, nx - 1, ny - 5, 1.6, (px, py) => tint(img, px, py, 70, 76, 84, 0.5));
        px0 = nx;
        py0 = ny;
    }
}

/** Grime: barnacle-like encrustations (clustered lit bumps) on the head, fins and tail stock, crusted old-blood scabs,
 * black scorch marks with a burnt rim. */
function paintGrime(img: RgbaImage, seed: number): void {
    const noise = makeValueNoise(seed + 30);
    const clusters: [number, number, number][] = [[0.95, 0.5, 34], [0.88, 0.2, 26], [0.84, 0.78, 24], [0.62, 0.12, 20], [0.6, 0.88, 22], [0.1, 0.5, 18], [0.18, 0.3, 14], [0.72, 0.5, 16], [0.4, 0.15, 14]];
    clusters.forEach(([u, t, R], c) => {
        const [cx, cy] = levFlank(u, t);
        for (let k = 0; k < 13; k++) {
            const a = lh(seed, 2000 + c * 40 + k) * Math.PI * 2;
            const r = Math.sqrt(lh(seed, 2001 + c * 40 + k)) * R * 2.2;
            const bx = cx + Math.cos(a) * r * 1.4;
            const by = cy + Math.sin(a) * r;
            const br = 1.6 + 3.2 * lh(seed, 2002 + c * 40 + k);
            disc(img, bx, by, br + 1.5, (px, py, d) => {
                const dd = d * (br + 1.5);
                if (dd > br) {
                    shade(img, px, py, 0.6);
                    return;
                }
                const lx = (px + 0.5 - bx) / br;
                const ly = (py + 0.5 - by) / br;
                const lit = clamp01(0.55 - 0.45 * (lx + ly));
                const crater = dd < br * 0.35 ? 0.4 : 1;
                const v = (30 + 50 * lit) * crater;
                tint(img, px, py, v * 1.02, v * 0.96, v * 0.86, 0.92);
            });
        }
    });
    // Crusted dried blood: dark brown-red crusts, cracked, around old wounds and the wreckage.
    for (let k = 0; k < 10; k++) {
        const [cx, cy] = levFlank(0.16 + 0.78 * lh(seed, 2100 + k), 0.12 + 0.76 * lh(seed, 2110 + k));
        const R = 12 + 22 * lh(seed, 2120 + k);
        disc(img, cx, cy, R, (px, py, d) => {
            const crack = fbm(noise, px / 5, py / 5, 2);
            const a = (1 - smoothstep(0.4, 1, d + 0.3 * (crack - 0.5))) * 0.8;
            tint(img, px, py, crack < 0.42 ? 16 : 52, crack < 0.42 ? 6 : 14, crack < 0.42 ? 6 : 12, a);
        });
    }
    // Scorch marks: black, with a rusty burnt rim.
    for (let k = 0; k < 4; k++) {
        const [cx, cy] = levFlank(0.2 + 0.72 * lh(seed, 2200 + k), 0.15 + 0.7 * lh(seed, 2210 + k));
        const R = 18 + 26 * lh(seed, 2220 + k);
        disc(img, cx, cy, R * 2.2, (px, py) => {
            // Streaked back along the hide (dragged by its flight): an elongated, ragged burn.
            const d = Math.hypot((px + 0.5 - cx) / 2.1, py + 0.5 - cy) / R;
            const n = d + 0.45 * (fbm(noise, px / 8 + 40, py / 8, 3) - 0.5);
            if (n > 1) return;
            if (n > 0.78) tint(img, px, py, 58, 26, 14, 0.5 * (1 - n) / 0.22);
            else tint(img, px, py, 4, 4, 5, 0.8 * (1 - smoothstep(0.45, 0.78, n)) + 0.1);
        });
    }
}

/** Old harpoon wounds: puckered round scars with a dark pit and radiating pale creases. */
function paintHarpoonPuckers(img: RgbaImage, seed: number): void {
    for (let k = 0; k < 11; k++) {
        const [x, y] = levFlank(0.2 + 0.74 * lh(seed, 1100 + k), 0.15 + 0.62 * lh(seed, 1110 + k));
        const R = 9 + 9 * lh(seed, 1120 + k);
        for (let j = 0; j < 9; j++) {
            const a = (j / 9) * Math.PI * 2 + lh(seed, 1130 + k);
            segment(img, x, y, x + Math.cos(a) * R * 2, y + Math.sin(a) * R * 2, 1.6, (px, py, tt) => tint(img, px, py, SCAR[0], SCAR[1], SCAR[2], 0.22 * (1 - tt)));
        }
        disc(img, x, y, R, (px, py, d) => {
            tint(img, px, py, SCAR_PINK[0] * 0.7, SCAR_PINK[1] * 0.62, SCAR_PINK[2] * 0.66, 0.5 * (1 - smoothstep(0.6, 1, d)));
            if (d < 0.45) tint(img, px, py, 18, 8, 12, 0.9 * (1 - smoothstep(0.25, 0.45, d)));
        });
    }
}

/** A small pale hungry eye on the side of the head: a deep wrinkled socket and a cold pale iris. */
function paintEye(img: RgbaImage, lumin: RgbaImage, x: number, y: number): void {
    disc(img, x, y, 16, (px, py, d) => shade(img, px, py, 1 - 0.55 * (1 - smoothstep(0.35, 1, d))));
    const side = y < CY ? -1 : 1;
    for (let j = 0; j < 3; j++) {
        segment(img, x - 18 + j * 3, y - side * (8 + j * 4), x + 16 - j * 2, y - side * (9 + j * 4), 1.3, (px, py, tt) => tint(img, px, py, 10, 12, 18, 0.6 * Math.sin(Math.PI * tt)));
    }
    disc(img, x, y, 5.5, (px, py, d) => {
        const c = mix([240, 250, 236], [150, 200, 196], smoothstep(0.2, 1, d));
        over(img, px, py, c[0], c[1], c[2], 1 - smoothstep(0.8, 1, d));
        if (d < 0.32) over(img, px, py, 30, 10, 14, 1 - smoothstep(0.2, 0.32, d));
    });
    glowDot(lumin, x, y, 3.5, 18, [226, 250, 240], [80, 170, 180], 0.8);
}

/** An additive glow dot on `img`: core radius rc, halo radius rh. */
function glowDot(img: RgbaImage, x: number, y: number, rc: number, rh: number, core: Rgb, halo: Rgb, a: number): void {
    disc(img, x, y, rh, (px, py, d) => {
        const dd = d * rh;
        const ca = dd < rc ? 1 - smoothstep(rc * 0.5, rc, dd) : 0;
        const ha = Math.pow(1 - d, 2.2) * 0.55;
        const c = mix(halo, core, ca);
        over(img, px, py, c[0], c[1], c[2], (ca + ha * (1 - ca)) * a);
    });
}

/** Faint cyan bioluminescent markings: a dotted line down each flank, spots beside the spine, stripes on the snout. */
function paintMarkings(img: RgbaImage, lumin: RgbaImage, seed: number): void {
    const dots: [number, number, number][] = [];
    for (let k = 0; k < 38; k++) {
        if (lh(seed, 1290 + k) < 0.45) continue;
        const u = 0.12 + k * 0.0165;
        for (const t of [0.2, 0.8]) {
            const [x, y] = levFlank(u, t + (t < 0.5 ? 1 : -1) * 0.025 * Math.sin(k * 0.6));
            dots.push([x, y, 2.4 + 1.4 * (k / 38)]);
        }
    }
    for (let k = 0; k < 9; k++) {
        const u = 0.2 + 0.68 * lh(seed, 1300 + k);
        const [x, y] = levFlank(u, k % 2 === 0 ? 0.36 + 0.06 * lh(seed, 1310 + k) : 0.58 + 0.06 * lh(seed, 1310 + k));
        dots.push([x, y, 1.8 + 1.6 * lh(seed, 1320 + k)]);
    }
    for (let k = 0; k < 14; k += 2) {
        for (const t of [0.3, 0.7]) {
            const [x, y] = levFlank(0.86 + k * 0.009, t);
            dots.push([x, y, 1.9]);
        }
    }
    for (const [x, y, r] of dots) {
        disc(img, x, y, r * 1.4, (px, py, d) => tint(img, px, py, 90, 160, 176, 0.18 * (1 - smoothstep(0.4, 1, d))));
        glowDot(lumin, x, y, r * 0.7, r * 4, LUMIN_CORE, LUMIN_HALO, 0.26);
    }
}

/** A conical tooth from base (x, y): `dir` +1 points down (+y), −1 up; lean toward the throat; broken = a flat stump. */
function tooth(img: RgbaImage, x: number, y: number, halfW: number, h: number, dir: number, lean: number, broken: boolean): void {
    const hh = broken ? h * 0.5 : h;
    const tipX = x + lean * h;
    const pts: [number, number][] = broken
        ? [[x - halfW, y], [x + halfW, y], [tipX + halfW * 0.4, y + dir * hh], [tipX - halfW * 0.5, y + dir * hh * 0.85]]
        : [[x - halfW, y], [x + halfW, y], [x + halfW * 0.45 + lean * h * 0.6, y + dir * h * 0.6], [tipX, y + dir * h], [x - halfW * 0.5 + lean * h * 0.6, y + dir * h * 0.6]];
    polygon(img, pts, (px, py, cover) => {
        const along = Math.abs(py + 0.5 - y) / hh;
        const across = (px + 0.5 - (x + lean * (py + 0.5 - y) * dir)) / halfW;
        const lit = 0.55 + 0.45 * clamp01(0.5 - across * 0.6);
        const c = mix([118, 98, 82], IVORY, smoothstep(0, 0.45, along));
        over(img, px, py, c[0] * lit, c[1] * lit, c[2] * lit, cover);
    });
}

/** Torn hull shards jammed into the hide, half sunk in crusted wounds: dark gunmetal, a lit torn edge, rust streaks. */
function paintPlates(img: RgbaImage, seed: number): void {
    const noise = makeValueNoise(seed + 9);
    const spots: [number, number, number][] = [[0.47, 0.08, 44], [0.56, 0.6, 38], [0.33, 0.5, 30], [0.82, 0.12, 36], [0.2, 0.34, 24], [0.9, 0.58, 28]];
    spots.forEach(([u, t, size], k) => {
        const [cx, cy] = levFlank(u, t);
        const rot = (lh(seed, 1500 + k) - 0.5) * 2.4;
        const n = 3 + Math.floor(lh(seed, 1510 + k) * 3);
        const pts: [number, number][] = [];
        for (let j = 0; j < n; j++) {
            const a = rot + ((j + 0.3 * lh(seed, 1530 + k * 10 + j)) / n) * Math.PI * 2;
            const r = size * (0.45 + 0.75 * lh(seed, 1520 + k * 10 + j));
            pts.push([cx + Math.cos(a) * r * 1.6, cy + Math.sin(a) * r * 0.75]);
        }
        // The crusted wound it sits in (soft, darker toward the metal).
        disc(img, cx, cy, size * 1.9, (px, py, d) => tint(img, px, py, 30, 12, 20, 0.7 * Math.pow(1 - d, 1.5)));
        polygon(img, pts, (px, py, cover, inside) => {
            const wear = fbm(noise, px / 6 + k * 13, py / 6, 3);
            const lit = 0.45 + 0.55 * clamp01(0.5 - (py - cy) / (size * 0.9));
            let c: [number, number, number] = [22 + 30 * wear, 23 + 30 * wear, 26 + 30 * wear];
            if (wear < 0.42) c = mix(c, [74, 36, 18], 0.7); // rust
            if (wear > 0.7) c = mix(c, [6, 6, 6], 0.6); // soot
            if (inside < 1.6) c = mix(c, [120, 124, 126], 0.5 * lit); // the torn edge catching light
            const m = lit * (1 - 0.35 * smoothstep(size * 0.3, 0, inside) * 0);
            over(img, px, py, c[0] * m, c[1] * m, c[2] * m, cover * 0.97);
        });
    });
}

/** Broken harpoons seen from above: shafts standing up out of the back, leaning toward the tail (short, with a
 * cast shadow), a few trailing slack cables back along the hide. */
function paintHarpoons(img: RgbaImage, seed: number): void {
    const list: [number, number, number, number][] = [
        // u, t (entry), lean angle (rad, π = straight back), apparent length (px)
        [0.31, 0.42, Math.PI + 0.35, 64], [0.37, 0.62, Math.PI - 0.4, 44], [0.53, 0.47, Math.PI + 0.2, 80], [0.76, 0.36, Math.PI + 0.5, 56],
        [0.44, 0.8, Math.PI - 0.6, 40], [0.88, 0.62, Math.PI - 0.3, 38], [0.6, 0.22, Math.PI + 0.7, 46],
    ];
    list.forEach(([u, t, ang, L], k) => {
        const [x, y] = levFlank(u, t);
        const ex = x + Math.cos(ang) * L;
        const ey = y + Math.sin(ang) * L;
        disc(img, x, y, 14, (px, py, d) => tint(img, px, py, d > 0.55 ? 92 : 22, d > 0.55 ? 34 : 6, d > 0.55 ? 44 : 12, 0.85 * (1 - smoothstep(0.7, 1, d))));
        // Cast shadow (light from the upper left): offset down-right, soft.
        segment(img, x + 4, y + 7, ex + 10, ey + 18, 4.5, (px, py, tt, d) => shade(img, px, py, 1 - 0.45 * (1 - d / 4.5) * (1 - 0.5 * tt)));
        const wood = k === 2 || k === 4;
        segment(img, x, y, ex, ey, 4.2, (px, py, tt, d, side) => {
            const lit = 0.45 + 0.55 * clamp01(0.5 - side);
            const rust = smoothstep(0.35, 0.65, lh(k, Math.floor(tt * 9)) * 0.5 + 0.5 * Math.sin(tt * 17 + k));
            const c: Rgb = wood ? [62 + 20 * tt, 44 + 14 * tt, 30 + 8 * tt] : mix([58 + 30 * tt, 58 + 28 * tt, 60 + 26 * tt], [78, 38, 22], rust * 0.85);
            const hi = (1 - smoothstep(0, 1.4, Math.abs(side + 0.5) * 4.2)) * (1 - rust * 0.6);
            over(img, px, py, c[0] * lit + 26 * hi, c[1] * lit + 26 * hi, c[2] * lit + 26 * hi, 1 - smoothstep(3, 4.2, d));
        });
        for (const f of [0.35, 0.7]) disc(img, x + Math.cos(ang) * L * f, y + Math.sin(ang) * L * f, 5, (px, py, d) => over(img, px, py, 90, 54, 32, 0.9 * (1 - smoothstep(0.7, 1, d))));
        segment(img, ex, ey, ex + Math.cos(ang + 0.45) * 10, ey + Math.sin(ang + 0.45) * 10, 2, (px, py) => over(img, px, py, 120, 108, 88, 0.9));
        if (k % 2 === 0) {
            let cx = ex;
            let cy = ey;
            const drift = y < CY ? -1 : 1;
            for (let j = 1; j <= 11; j++) {
                const nx = cx - 17;
                const ny = cy + drift * (2 + j * 0.7) + Math.sin(j * 0.9 + k) * 4;
                segment(img, cx, cy, nx, ny, 1.5, (px, py, tt, d) => over(img, px, py, 84, 74, 58, 0.85 * (1 - d / 1.5)));
                cx = nx;
                cy = ny;
            }
        }
    });
}

// ---------------------------------------------------------------------------
// Jaw, maw, fins, fluke, fx.

export const JAW_W = 560;
export const JAW_H = 380;
/** Back centre of the lower jaw inside its image (px): placed on the hinge, it slides forward as the jaw drops. */
export const JAW_ROOT: [number, number] = [40, JAW_H / 2];

/**
 * The lower jaw seen from above as it hangs open: a long U of pale bone-grey jaw rim lined with jagged teeth pointing
 * inward and up, the dark-red gullet and tongue inside, a throat glowing deep red at the back. Closed, it hides under
 * the head; on a swallow the rig slides it forward past the snout.
 */
export function paintLeviathanJaw(seed = 91): RgbaImage {
    const img = image(JAW_W, JAW_H);
    const n = makeValueNoise(seed + 20);
    const len = JAW_W - JAW_ROOT[0] - 8;
    const cy = JAW_ROOT[1];
    const outer = (s: number): number => (JAW_H / 2 - 8) * (0.92 - 0.25 * s) * Math.sqrt(Math.max(0, 1 - Math.pow(Math.max(0, s - 0.72) / 0.28, 2)));
    const RIM = 30;
    for (let x = 0; x < JAW_W; x++) {
        const s = (x + 0.5 - JAW_ROOT[0]) / len;
        if (s < -0.08 || s > 1) continue;
        const ho = outer(Math.max(0, s));
        const hi = Math.max(0, ho - RIM * (0.8 + 0.4 * s));
        const inTip = smoothstep(0.86, 0.98, s);
        for (let y = 0; y < JAW_H; y++) {
            const py = y + 0.5;
            const d = Math.abs(py - cy);
            const sd = Math.min(ho - d, x + 0.5 - JAW_ROOT[0] + 0.08 * len);
            const cover = clamp01((sd + 0.75) / 1.5);
            if (cover <= 0) continue;
            const m = fbm(n, x / 22, y / 22, 3);
            let c: [number, number, number];
            if (d > hi || inTip > 0.5) {
                // The jaw rim: pale grimy bone-grey, lit on its outer curve.
                const r = clamp01((d - hi) / Math.max(1, ho - hi));
                c = mix([118, 118, 120], [70, 72, 80], r * 0.6 + 0.4 * (1 - m));
                if (Math.abs(d - hi) < 3) c = mix(c, [60, 10, 16], 0.85); // the gum line
            } else {
                // Inside: tongue and gullet, glowing toward the throat.
                const throat = Math.pow(1 - clamp01(s), 2);
                c = mix([46, 4, 12], [210, 36, 36], throat);
                const tongue = Math.exp(-Math.pow(d / (hi * 0.55 + 1), 2)) * smoothstep(0.02, 0.2, s) * (1 - smoothstep(0.65, 0.85, s));
                c = mix(c, [150, 46, 58], tongue * 0.55);
                const ridge = 0.5 + 0.5 * Math.cos(x / 6);
                c = mix(c, [c[0] * 0.6, c[1] * 0.5, c[2] * 0.5], ridge * 0.4 * (1 - throat));
                c = mix(c, [c[0] * 0.4, c[1] * 0.4, c[2] * 0.4], smoothstep(0.6, 1, d / Math.max(1, hi)) * 0.6);
            }
            const i = (y * JAW_W + x) * 4;
            img.data[i] = c[0];
            img.data[i + 1] = c[1];
            img.data[i + 2] = c[2];
            img.data[i + 3] = cover * 255;
        }
    }
    // Teeth on both rims, standing up and leaning inward: from above, ivory cones pointing toward the centre.
    for (let k = 0; k < 17; k++) {
        const s = 0.12 + k * 0.047;
        if (s > 0.9) break;
        const x = JAW_ROOT[0] + s * len;
        const ho = outer(s);
        const hi = Math.max(0, ho - RIM * (0.8 + 0.4 * s));
        for (const side of [-1, 1]) {
            const h = 16 + 18 * lh(seed, 1710 + k * 2 + (side > 0 ? 1 : 0));
            tooth(img, x + (lh(seed, 1700 + k) - 0.5) * 6, cy + side * (hi + 6), 6 + 3 * lh(seed, 1720 + k), h, -side, 0.15, lh(seed, 1730 + k * 2 + (side > 0 ? 1 : 0)) < 0.12);
        }
    }
    return img;
}

export const UPPER_W = 90;
export const UPPER_H = 420;

/** The upper teeth along the underside of the snout, seen from above when the jaw drops: a curved row of ivory cones
 * pointing forward, set in a dark-red gum (drawn under the head; only the part past the snout shows). */
export function paintLeviathanUpperTeeth(seed = 91): RgbaImage {
    const img = image(UPPER_W, UPPER_H);
    const cy = UPPER_H / 2;
    for (let y = 0; y < UPPER_H; y++) {
        const a = (y + 0.5 - cy) / (UPPER_H / 2 - 10);
        if (Math.abs(a) > 1) continue;
        const x0 = 26 * a * a;
        for (let x = 0; x < 18; x++) over(img, Math.round(x0) + x, y, 70, 8, 16, 0.9 * (1 - x / 18));
    }
    for (let k = 0; k < 15; k++) {
        const a = -0.9 + (k / 14) * 1.8;
        const y = cy + a * (UPPER_H / 2 - 10);
        const x0 = 26 * a * a + 10;
        const h = 18 + 18 * lh(seed, 1800 + k);
        // A forward-pointing cone: reuse the up/down tooth by drawing it rotated as a polygon.
        const w = 6 + 3 * lh(seed, 1810 + k);
        polygon(img, [[x0, y - w], [x0, y + w], [x0 + h * 0.6, y + w * 0.45], [x0 + h, y], [x0 + h * 0.6, y - w * 0.5]], (px, py, cover) => {
            const along = (px + 0.5 - x0) / h;
            const c = mix([118, 98, 82], IVORY, smoothstep(0, 0.45, along));
            const lit = 0.6 + 0.4 * clamp01(0.5 - (py + 0.5 - y) / w);
            over(img, px, py, c[0] * lit, c[1] * lit, c[2] * lit, cover);
        });
    }
    return img;
}

export const FIN_LEN = 420;
export const FIN_WID = 210;

/**
 * A long pectoral fin (root at x 0, axis along +x at mid-height, the knobbly leading edge toward −y): `torn` bites
 * notches out of the trailing edge, punches holes and shreds the tip. `dark` dims it.
 */
export function paintLeviathanFin(seed: number, torn: boolean, dark: number): RgbaImage {
    const img = image(FIN_LEN, FIN_WID);
    const n = makeValueNoise(seed);
    const cy = FIN_WID / 2;
    const half = FIN_WID * 0.46;
    const notches = torn ? [[0.46, 0.07, 0.75], [0.74, 0.05, 0.6]] : [];
    const holes = torn ? [[0.42, 0.25, 7], [0.6, 0.15, 5]] : [];
    const tipCut = torn ? 0.9 : 1;
    for (let x = 0; x < FIN_LEN; x++) {
        const s = (x + 0.5) / FIN_LEN;
        const p = (0.62 + 0.38 * smoothstep(0, 0.14, s)) * Math.pow(Math.max(0, 1 - Math.pow(s, 2.4)), 0.75);
        const bumps = smoothstep(0.08, 0.2, s) * 0.06 * Math.abs(Math.sin(s * 34));
        const lead = half * (0.42 * p + bumps * p);
        let trail = half * 0.62 * p * (1 - 0.35 * smoothstep(0.75, 1, s));
        for (const [ns, nw, nd] of notches) trail *= 1 - nd * Math.sqrt(Math.max(0, 1 - Math.pow((s - ns) / nw, 2)));
        trail *= 0.94 + 0.1 * fbm(n, x / 40, 0, 2);
        for (let y = 0; y < FIN_WID; y++) {
            const py = y + 0.5;
            const off = py - cy;
            const edge = off < 0 ? lead + off : trail - off;
            let sd = Math.min(edge, x + 0.5 + 4);
            const rootFade = smoothstep(0, 10, x);
            if (torn) {
                const rag = tipCut + 0.05 * (fbm(n, 5, py / 14, 2) - 0.5);
                sd = Math.min(sd, (rag - s) * FIN_LEN);
                for (const [hs, ht, hr] of holes) sd = Math.min(sd, Math.hypot(x - hs * FIN_LEN, py - (cy + ht * half)) - hr * (0.8 + 0.4 * fbm(n, x / 3, py / 3, 2)));
            }
            const cover = clamp01((sd + 0.75) / 1.5);
            if (cover <= 0) continue;
            const across = off < 0 ? off / Math.max(1, lead) : off / Math.max(1, trail);
            // Lit on the trailing side (+y), which faces up once the rig sweeps the fin back.
            const lam = lambert(0, -across * 0.9);
            const m = fbm(n, x / 30, y / 20, 3);
            let c = mix(FLANK, HIDE_GREY, smoothstep(0.3, 0.8, m) * 0.6);
            c = mix(c, BACK, smoothstep(0.65, 1, s) * 0.3);
            const k = (0.3 + 0.95 * lam) * dark;
            const rim = (1 - smoothstep(0, 6, edge)) * 0.4 * dark;
            const i = (y * FIN_LEN + x) * 4;
            img.data[i] = c[0] * k + RIM[0] * rim;
            img.data[i + 1] = c[1] * k + RIM[1] * rim;
            img.data[i + 2] = c[2] * k + RIM[2] * rim;
            img.data[i + 3] = cover * rootFade * 255;
        }
    }
    // Scars and a few lumin flecks along the leading edge.
    for (let k = 0; k < 18; k++) {
        const x = 30 + lh(seed, 1800 + k) * (FIN_LEN - 120);
        const y = cy + (lh(seed, 1810 + k) - 0.5) * half * 0.8;
        const a = (lh(seed, 1820 + k) - 0.5) * 1.5;
        segment(img, x, y, x + Math.cos(a) * 26, y + Math.sin(a) * 26, 1.4, (px, py, tt) => tint(img, px, py, SCAR[0] * dark, SCAR[1] * dark, SCAR[2] * dark, 0.45 * Math.sin(Math.PI * tt)));
    }
    return img;
}

export const FLUKE_W = 300;
export const FLUKE_H = 560;

/** The broad tail flukes (root at x 0, mid-height; +x points away from the body): two swept lobes, a deep median
 * notch, a ragged trailing edge and one bite taken out of the lower lobe. */
export function paintLeviathanFluke(seed = 91): RgbaImage {
    const img = image(FLUKE_W, FLUKE_H);
    const n = makeValueNoise(seed + 40);
    const cy = FLUKE_H / 2;
    const A = FLUKE_H * 0.47;
    for (let y = 0; y < FLUKE_H; y++) {
        const py = y + 0.5;
        const a = Math.abs(py - cy) / A;
        if (a > 1.02) continue;
        const lower = py > cy;
        // Leading edge (toward the body) sweeps back to the tips; the trailing edge has the notch at the centre.
        const xLe = 6 + 250 * Math.pow(a, 2.1);
        let xTe = 118 + 150 * Math.pow(a, 1.25) - 40 * Math.exp(-Math.pow(a / 0.06, 2));
        xTe -= 8 * fbm(n, 3, py / 60, 2);
        if (lower && Math.abs(a - 0.62) < 0.1) xTe -= 46 * Math.sqrt(1 - Math.pow((a - 0.62) / 0.1, 2)); // a bite
        const tip = 262;
        for (let x = 0; x < FLUKE_W; x++) {
            const px = x + 0.5;
            const stalk = 34 * (1 - smoothstep(0, 70, px)) + 4;
            const sd = Math.min(px - xLe, xTe - px, (1 - a) * A, tip - px);
            const sdStalk = Math.min(stalk - Math.abs(py - cy), 70 - px);
            const s = Math.max(sd, sdStalk);
            const cover = clamp01((s + 0.75) / 1.5);
            if (cover <= 0) continue;
            const m = fbm(n, x / 26, y / 26, 3);
            // Shaded like a broad blade: a darker central ridge, lighter toward the edges; the upper lobe catches light.
            const ridge = 1 - smoothstep(0, 0.35, a);
            let c = mix(FLANK, HIDE_GREY, smoothstep(0.35, 0.8, m) * 0.5);
            c = mix(c, BACK, ridge * 0.5);
            const k = (lower ? 0.82 : 0.95) * (0.65 + 0.45 * smoothstep(0.2, 0.9, (px - xLe) / Math.max(1, xTe - xLe)));
            const rim = (1 - smoothstep(0, 5, xTe - px)) * 0.35;
            const i = (y * FLUKE_W + x) * 4;
            img.data[i] = c[0] * k + SCAR[0] * rim * 0.5;
            img.data[i + 1] = c[1] * k + SCAR[1] * rim * 0.5;
            img.data[i + 2] = c[2] * k + SCAR[2] * rim * 0.5;
            img.data[i + 3] = cover * 255;
        }
    }
    for (let k = 0; k < 16; k++) {
        const y = cy + (lh(seed, 1900 + k) - 0.5) * A * 1.6;
        const x = 60 + lh(seed, 1910 + k) * 150;
        segment(img, x, y, x + 24, y + (lh(seed, 1920 + k) - 0.5) * 30, 1.4, (px, py, tt) => tint(img, px, py, SCAR[0], SCAR[1], SCAR[2], 0.4 * Math.sin(Math.PI * tt)));
    }
    return img;
}

/** A soft radial glow (white-hot core → `halo` → transparent). */
export function glowRgba(size: number, core: Rgb, halo: Rgb): RgbaImage {
    const img = image(size, size);
    glowDot(img, size / 2, size / 2, size * 0.1, size / 2, core, halo, 1);
    return img;
}

/** The hyper-lunge ripple: a thin bright ring with a soft inner wake. */
export function rippleRgba(size: number): RgbaImage {
    const img = image(size, size);
    const c = size / 2;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const d = Math.hypot(x + 0.5 - c, y + 0.5 - c) / c;
            if (d > 1) continue;
            const ring = Math.exp(-Math.pow((d - 0.93) / 0.025, 2));
            const wake = smoothstep(0.5, 0.92, d) * (1 - smoothstep(0.92, 0.96, d)) * 0.22;
            const a = Math.min(1, ring + wake);
            const col = mix([90, 200, 255], [240, 252, 255], ring);
            over(img, x, y, col[0], col[1], col[2], a);
        }
    }
    return img;
}

/** A horizontal light streak (the hyper-lunge's stretch lines): bright head at +x fading back. */
export function streakRgba(w: number, h: number): RgbaImage {
    const img = image(w, h);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const v = Math.exp(-Math.pow((y + 0.5 - h / 2) / (h / 5), 2));
            const u = (x + 0.5) / w;
            over(img, x, y, 200 + 55 * u, 240, 255, v * Math.pow(u, 1.6));
        }
    }
    return img;
}
