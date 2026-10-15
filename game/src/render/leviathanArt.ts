// The Leviathan's art (Void Whale threat, scenarios/void-whale): a giant scarred space whale drawn in PROFILE (the one
// creature of the game seen side-on, so it reads as a whale at a glance) — a massive blunt box head, an underslung jaw
// lined with jagged teeth, a thick muscular body with dorsal knuckles tapering to a broad fluked tail, long pectoral
// fins (the near one torn), a bruised blue-black hide with a lighter mottled underbelly, pale squid-sucker and rake
// scars, old harpoon puckers, broken harpoons and hull plates jammed in the hide, and faint cyan bioluminescent
// markings with small pale eyes.
//
// Everything is pure (typed arrays, no DOM, own hash noise — never galaxy.rnd) and baked ONCE at high resolution
// (body 1600 x 640); the rig (leviathanRig.ts) only moves the parts. Local frame of every part: head toward +x,
// belly toward +y (the rig mirrors the whole beast when it swims leftward so the belly stays down on screen).

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
// The profile.

// Back (negative = up) and belly lines in units of LEV_H, tail (u 0) to snout (u 1).
const TOP: [number, number][] = [
    [0, -0.05], [0.06, -0.068], [0.14, -0.102], [0.24, -0.152], [0.34, -0.2], [0.44, -0.236], [0.54, -0.262], [0.62, -0.292],
    [0.7, -0.322], [0.8, -0.338], [0.9, -0.342], [0.95, -0.334], [0.98, -0.306], [1, -0.25],
];
const BOT: [number, number][] = [
    [0, 0.045], [0.06, 0.06], [0.14, 0.09], [0.24, 0.135], [0.34, 0.192], [0.44, 0.24], [0.52, 0.268], [0.58, 0.272],
    [0.63, 0.245], [0.67, 0.176], [0.7, 0.152], [0.8, 0.146], [0.9, 0.142], [0.96, 0.132], [0.99, 0.1], [1, 0.07],
];
/** Dorsal knuckles (u, height in LEV_H) on the tail half, and the low dorsal hump. */
const KNUCKLES: [number, number][] = [[0.13, 0.012], [0.18, 0.014], [0.23, 0.016], [0.28, 0.017], [0.33, 0.016], [0.38, 0.013], [0.445, 0.03]];

export const levX = (u: number): number => LEV_X0 + u * (LEV_X1 - LEV_X0);
export const levU = (x: number): number => (x - LEV_X0) / (LEV_X1 - LEV_X0);

/** Back line at u (texture px, y down). */
export function levTop(u: number): number {
    let v = spline(TOP, u);
    for (const [ku, kh] of KNUCKLES) v -= kh * Math.exp(-Math.pow((u - ku) / (kh > 0.02 ? 0.03 : 0.011), 2));
    return CY + v * LEV_H;
}
/** Belly / upper-jaw line at u (texture px). */
export function levBot(u: number): number {
    return CY + spline(BOT, u) * LEV_H;
}

/** Jaw hinge (texture px) and the closed jaw's length; the upper-jaw line runs flat from the hinge to the snout. */
export const LEV_HINGE_U = 0.668;
export const LEV_HINGE: [number, number] = [levX(LEV_HINGE_U), CY + 0.168 * LEV_H];
/** Near pectoral fin root (texture px). */
export const LEV_FIN_ROOT: [number, number] = [levX(0.595), CY + 0.15 * LEV_H];
export const LEV_FAR_FIN_ROOT: [number, number] = [levX(0.575), CY + 0.12 * LEV_H];
export const LEV_EYE: [number, number] = [levX(0.735), CY + 0.098 * LEV_H];

/** A point on the flank: u along, t across (0 back .. 1 belly). */
export function levFlank(u: number, t: number): [number, number] {
    const top = levTop(u);
    return [levX(u), top + (levBot(u) - top) * t];
}

// ---------------------------------------------------------------------------
// Palette.

const BACK: Rgb = [16, 21, 33];
const FLANK: Rgb = [44, 54, 74];
const BRUISE: Rgb = [52, 36, 62];
const BELLY: Rgb = [150, 156, 164];
const BELLY_DARK: Rgb = [92, 98, 112];
const SCAR: Rgb = [176, 184, 192];
const SCAR_PINK: Rgb = [178, 150, 156];
const RIM: Rgb = [70, 130, 168];
const IVORY: Rgb = [232, 222, 196];
const LUMIN_CORE: Rgb = [196, 250, 255];
const LUMIN_HALO: Rgb = [40, 170, 226];

/** Light direction (toward the light): from above and a little ahead, toward the viewer. */
const LX = 0.3;
const LY = -0.78;
const LZ = 0.55;

/** Lambert of a cylinder-ish surface: `ny` −1 (facing up) .. 1 (facing down), `nx` toward the head. */
function lambert(nx: number, ny: number): number {
    const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny * 0.94));
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

/** The body raster: hide, shading, scars, embedded wreckage and the upper teeth. Pure; ~1 M px. */
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
        const top = levTop(u);
        const bot = levBot(u);
        const span = bot - top;
        const slope = (levTop(u + 0.002) - levTop(u - 0.002)) / (0.004 * (LEV_X1 - LEV_X0));
        const head = smoothstep(0.6, 0.7, u);
        for (let y = Math.max(0, Math.floor(top - 2)); y <= Math.min(LEV_H - 1, Math.ceil(bot + 2)); y++) {
            const py = y + 0.5;
            const t = (py - top) / span;
            // Blunt rounded snout: the front face bulges forward in the middle.
            const front = LEV_X1 - 26 * Math.pow(2 * t - 1, 2) - x - 0.5;
            const tail = x + 0.5 - LEV_X0 + 6;
            const sd = Math.min(py - top, bot - py, front, tail);
            const cover = clamp01((sd + 0.75) / 1.5);
            if (cover <= 0) continue;
            // Normal: across the body (cylinder), tilted forward on the snout, and by the back's slope.
            const snout = smoothstep(LEV_X1 - 110, LEV_X1, x);
            const ny = (2 * t - 1) * (1 - 0.4 * snout);
            const nx = snout * 0.75 - slope * 0.35 * (1 - t);
            const lam = lambert(Math.max(-0.9, Math.min(0.9, nx)), ny);
            const big = fbm(nBig, x / 110, y / 110, 4);
            const fine = fbm(nFine, x / 6, y / 6, 2);
            // Countershading: the lighter mottled underbelly (and the pale lower head) under a noisy line.
            const bellyLine = lerp(0.62, 0.58, head) + 0.16 * (big - 0.5);
            const belly = smoothstep(bellyLine - 0.06, bellyLine + 0.1, t);
            let col = mix(BACK, FLANK, smoothstep(0.08, 0.6, t));
            col = mix(col, BRUISE, 0.55 * smoothstep(0.52, 0.72, big) * (1 - belly));
            const bm = fbm(nBel, x / 34, y / 22, 3);
            const bellyCol = mix(BELLY_DARK, BELLY, smoothstep(0.3, 0.7, bm));
            col = mix(col, bellyCol, belly);
            // Lit and shaded: a low ambient (it lives in the dark), a cool sky-ish rim on the back edge.
            let k = 0.32 + 0.95 * lam;
            // Body wrinkles (sperm-whale skin): long wavy creases behind the head, fewer on it.
            const wr = fbm(nWr, x / 150, y / 7.5 + 3 * big, 3);
            const groove = 1 - smoothstep(0, 0.035, Math.abs(wr - 0.5));
            k *= 1 - 0.3 * groove * (1 - 0.65 * head) * smoothstep(0.02, 0.15, t);
            k *= 0.9 + 0.2 * fine;
            // Occlusion where the belly meets the throat, and on the far curve of the belly.
            k *= 1 - 0.35 * smoothstep(0.82, 1, t);
            const r = col[0] * k;
            const g = col[1] * k;
            const b = col[2] * k;
            const sheen = Math.pow(lam, 14) * 0.5;
            const rim = (1 - smoothstep(0, 9, py - top)) * 0.55 + (1 - smoothstep(0, 10, front)) * 0.3;
            const i = (y * LEV_W + x) * 4;
            img.data[i] = r + 110 * sheen + RIM[0] * rim;
            img.data[i + 1] = g + 135 * sheen + RIM[1] * rim;
            img.data[i + 2] = b + 160 * sheen + RIM[2] * rim;
            img.data[i + 3] = cover * 255;
        }
    }
    paintScars(img, seed);
    paintHarpoonPuckers(img, seed);
    paintEye(img, lumin);
    paintMarkings(img, lumin, seed);
    paintUpperTeeth(img, seed);
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
            tint(img, px, py, SCAR_PINK[0] * 0.8, SCAR_PINK[1] * 0.75, SCAR_PINK[2] * 0.8, 0.7 * (1 - smoothstep(0.6, 1, d)));
            if (d < 0.45) tint(img, px, py, 18, 8, 12, 0.9 * (1 - smoothstep(0.25, 0.45, d)));
        });
    }
}

/** Small pale hungry eye low on the head by the jaw corner: a deep wrinkled socket and a cold pale iris. */
function paintEye(img: RgbaImage, lumin: RgbaImage): void {
    const [x, y] = LEV_EYE;
    disc(img, x, y, 26, (px, py, d) => shade(img, px, py, 1 - 0.55 * (1 - smoothstep(0.35, 1, d))));
    for (let j = 0; j < 3; j++) {
        segment(img, x - 30 + j * 4, y - 14 - j * 6, x + 26 - j * 3, y - 16 - j * 6, 1.6, (px, py, tt) => tint(img, px, py, 10, 12, 18, 0.6 * Math.sin(Math.PI * tt)));
    }
    disc(img, x, y, 10, (px, py, d) => {
        const c = mix([240, 250, 236], [150, 200, 196], smoothstep(0.2, 1, d));
        over(img, px, py, c[0], c[1], c[2], 1 - smoothstep(0.8, 1, d));
        if (d < 0.32) over(img, px, py, 30, 10, 14, 1 - smoothstep(0.2, 0.32, d)); // slit pupil-ish dark core
    });
    glowDot(lumin, x, y, 7, 34, [236, 255, 246], [90, 210, 220], 1);
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

/** Faint cyan bioluminescent markings: a dotted lateral line, a crown arc over the eye, sparse spots on the back. */
function paintMarkings(img: RgbaImage, lumin: RgbaImage, seed: number): void {
    const dots: [number, number, number][] = [];
    for (let k = 0; k < 40; k++) {
        const u = 0.12 + k * 0.0155;
        const [x, y] = levFlank(u, 0.5 + 0.03 * Math.sin(k * 0.6));
        dots.push([x, y, 2.6 + 1.6 * (k / 40)]);
    }
    for (let k = 0; k < 6; k++) {
        const a = Math.PI * (1.1 + (k / 5) * 0.55);
        dots.push([LEV_EYE[0] + Math.cos(a) * 46, LEV_EYE[1] + Math.sin(a) * 30, 1.8]);
    }
    for (let k = 0; k < 18; k++) {
        const u = 0.2 + 0.68 * lh(seed, 1300 + k);
        const [x, y] = levFlank(u, 0.12 + 0.18 * lh(seed, 1310 + k));
        dots.push([x, y, 1.8 + 1.8 * lh(seed, 1320 + k)]);
    }
    // Two pale stripes down the snout.
    for (let k = 0; k < 16; k++) {
        dots.push([LEV_X1 - 40 - k * 9, CY - 0.27 * LEV_H + k * 1.2, 2]);
        dots.push([LEV_X1 - 34 - k * 10, CY - 0.06 * LEV_H - k * 0.6, 2]);
    }
    for (const [x, y, r] of dots) {
        disc(img, x, y, r * 1.6, (px, py, d) => tint(img, px, py, 120, 210, 230, 0.3 * (1 - smoothstep(0.4, 1, d))));
        glowDot(lumin, x, y, r * 0.8, r * 4.5, LUMIN_CORE, LUMIN_HALO, 0.45);
    }
}

/** The upper teeth along the upper-jaw line (hidden behind the closed jaw; bared when it gapes). */
function paintUpperTeeth(img: RgbaImage, seed: number): void {
    const y0 = LEV_HINGE[1];
    for (let k = 0; k < 15; k++) {
        const x = levX(0.705 + k * 0.0185) + (lh(seed, 1400 + k) - 0.5) * 6;
        const h = 16 + 14 * lh(seed, 1410 + k);
        const w = 5 + 3 * lh(seed, 1420 + k);
        tooth(img, x, y0 - 2, w, h, 1, -0.25, lh(seed, 1430 + k) < 0.15);
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
            let c: [number, number, number] = [52 + 46 * wear, 58 + 48 * wear, 66 + 48 * wear];
            if (wear < 0.38) c = mix(c, [86, 44, 24], 0.65); // rust
            if (inside < 1.8) c = mix(c, [168, 184, 194], 0.6 * lit); // the lit torn edge
            const m = lit * (1 - 0.35 * smoothstep(size * 0.3, 0, inside) * 0);
            over(img, px, py, c[0] * m, c[1] * m, c[2] * m, cover * 0.97);
        });
    });
}

/** Broken harpoons: iron shafts jutting up and back out of the back, a few trailing slack cables. */
function paintHarpoons(img: RgbaImage, seed: number): void {
    const list: [number, number, number, number][] = [
        // u, t (entry), angle (rad, from +x; −π/2 = straight up), length (px)
        [0.31, 0.03, -2.3, 92], [0.37, 0.1, -2.05, 56], [0.53, 0.03, -2.4, 110], [0.76, 0.03, -2.3, 78], [0.43, 0.4, -2.65, 54], [0.88, 0.02, -2.05, 46],
    ];
    list.forEach(([u, t, ang, L], k) => {
        const [x, y] = levFlank(u, t);
        const ex = x + Math.cos(ang) * L;
        const ey = y + Math.sin(ang) * L;
        disc(img, x, y, 14, (px, py, d) => tint(img, px, py, d > 0.55 ? 92 : 22, d > 0.55 ? 34 : 6, d > 0.55 ? 44 : 12, 0.85 * (1 - smoothstep(0.7, 1, d))));
        const wood = k === 2 || k === 4;
        segment(img, x, y, ex, ey, 4.2, (px, py, tt, d, side) => {
            const lit = 0.45 + 0.55 * clamp01(0.5 - side);
            const c: Rgb = wood ? [92 + 26 * tt, 66 + 18 * tt, 42 + 12 * tt] : [70 + 40 * tt, 74 + 40 * tt, 80 + 40 * tt];
            over(img, px, py, c[0] * lit + 40 * (1 - smoothstep(0, 1.4, Math.abs(side + 0.5) * 4.2)), c[1] * lit + 44 * (1 - smoothstep(0, 1.4, Math.abs(side + 0.5) * 4.2)), c[2] * lit + 48 * (1 - smoothstep(0, 1.4, Math.abs(side + 0.5) * 4.2)), 1 - smoothstep(3, 4.2, d));
        });
        // Iron ferrule bands and a snapped, splintered end.
        for (const f of [0.35, 0.7]) disc(img, x + Math.cos(ang) * L * f, y + Math.sin(ang) * L * f, 5, (px, py, d) => over(img, px, py, 120, 110, 96, 0.9 * (1 - smoothstep(0.7, 1, d))));
        segment(img, ex, ey, ex + Math.cos(ang + 0.45) * 10, ey + Math.sin(ang + 0.45) * 10, 2, (px, py) => over(img, px, py, 160, 150, 128, 0.9));
        if (k % 2 === 0) {
            let cx = ex;
            let cy = ey;
            for (let j = 1; j <= 10; j++) {
                const nx = cx - 16;
                const ny = cy + 3 + Math.sin(j * 0.9 + k) * 3 + j * 0.9;
                segment(img, cx, cy, nx, ny, 1.5, (px, py, tt, d) => over(img, px, py, 120, 108, 86, 0.8 * (1 - d / 1.5)));
                cx = nx;
                cy = ny;
            }
        }
    });
}

// ---------------------------------------------------------------------------
// Jaw, maw, fins, fluke, fx.

export const JAW_W = 620;
export const JAW_H = 160;
/** Hinge inside the jaw image (px); the jaw's top edge runs along y = JAW_HINGE[1]. */
export const JAW_HINGE: [number, number] = [84, 44];

/** The underslung lower jaw: long, narrow, pale below, lined with jagged teeth (pointing up); its rounded back end
 * tucks under the throat behind the hinge. */
export function paintLeviathanJaw(seed = 91): RgbaImage {
    const img = image(JAW_W, JAW_H);
    const n = makeValueNoise(seed + 20);
    const y0 = JAW_HINGE[1];
    const len = LEV_X1 - 30 - LEV_HINGE[0];
    const back = 0.14;
    for (let x = 0; x < JAW_W; x++) {
        const s = (x + 0.5 - JAW_HINGE[0]) / len;
        if (s < -back || s > 1.02) continue;
        let depth = lerp(84, 36, Math.pow(clamp01(s), 0.75));
        let top = y0;
        if (s < 0) {
            const e = Math.sqrt(Math.max(0, 1 - Math.pow(s / back, 2)));
            depth *= 0.35 + 0.65 * e;
            top = y0 + (1 - e) * 30;
        }
        const tipRound = Math.sqrt(Math.max(0, 1 - Math.pow(clamp01((s - 0.88) / 0.13), 2)));
        for (let y = 0; y < JAW_H; y++) {
            const py = y + 0.5;
            const rel = (py - y0) / depth;
            const sd = Math.min(py - top, y0 + depth * tipRound - py);
            const cover = clamp01((sd + 0.75) / 1.5);
            if (cover <= 0) continue;
            const m = fbm(n, x / 26, y / 16, 3);
            let c = mix(FLANK, [150, 156, 166], smoothstep(0.1, 0.8, rel) * (0.7 + 0.3 * m));
            const lam = lambert(0, rel * 1.6 - 0.9);
            const k = (0.42 + 0.75 * lam) * (s < 0 ? 0.75 + 0.25 * (1 + s / back) : 1);
            c = [c[0] * k, c[1] * k, c[2] * k];
            if (py - top < 4 && s > 0.02) c = mix(c, [46, 12, 18], 0.8); // gum line
            const i = (y * JAW_W + x) * 4;
            img.data[i] = c[0];
            img.data[i + 1] = c[1];
            img.data[i + 2] = c[2];
            img.data[i + 3] = cover * 255;
        }
    }
    // Scratches on the pale jaw.
    for (let k = 0; k < 40; k++) {
        const x = JAW_HINGE[0] + 30 + lh(seed, 1600 + k) * (len - 60);
        const y = y0 + 8 + lh(seed, 1610 + k) * 40;
        const a = (lh(seed, 1620 + k) - 0.5) * 2;
        segment(img, x, y, x + Math.cos(a) * 22, y + Math.sin(a) * 22, 1.2, (px, py, tt) => tint(img, px, py, 196, 200, 204, 0.4 * Math.sin(Math.PI * tt)));
    }
    // Teeth: big jagged cones, a couple snapped, leaning forward.
    for (let k = 0; k < 19; k++) {
        const s = 0.16 + k * 0.044;
        const x = JAW_HINGE[0] + s * len + (lh(seed, 1700 + k) - 0.5) * 6;
        const h = (16 + 24 * lh(seed, 1710 + k)) * (1 - 0.25 * s);
        tooth(img, x, y0 + 2, 6 + 3 * lh(seed, 1720 + k), h, -1, 0.18, lh(seed, 1730 + k) < 0.12);
    }
    return img;
}

export const MAW_W = 520;
export const MAW_H = 400;
/** The maw wedge spans 0 .. MAW_ANGLE below the upper-jaw line (the rig squashes it to the jaw's gape). */
export const MAW_ANGLE = 0.72;

/** The inside of the mouth: a wedge from the hinge, a throat glowing deep red, ridged palate, darkening to the lips. */
export function paintLeviathanMaw(): RgbaImage {
    const img = image(MAW_W, MAW_H);
    const R = LEV_X1 - 64 - LEV_HINGE[0];
    for (let y = 0; y < MAW_H; y++) {
        for (let x = 0; x < MAW_W; x++) {
            const px = x + 0.5;
            const py = y + 0.5;
            const a = Math.atan2(py, px);
            const r = Math.hypot(px, py);
            const sd = Math.min(R - r, (a + 0.04) * r, (MAW_ANGLE - a) * r);
            const cover = clamp01((sd + 1) / 2);
            if (cover <= 0) continue;
            const s = r / R;
            const throat = Math.pow(1 - s, 2.2);
            let c = mix([26, 3, 9], [196, 34, 34], throat);
            const ridge = 0.5 + 0.5 * Math.cos(r / 7);
            c = mix(c, [c[0] * 0.55, c[1] * 0.5, c[2] * 0.5], ridge * 0.5 * (1 - throat));
            // Tongue: a lighter bulge along the jaw side.
            const tongue = smoothstep(0.45, 0.8, a / MAW_ANGLE) * smoothstep(0.05, 0.25, s) * (1 - smoothstep(0.55, 0.8, s));
            c = mix(c, [150, 50, 60], tongue * 0.6);
            const i = (y * MAW_W + x) * 4;
            img.data[i] = c[0];
            img.data[i + 1] = c[1];
            img.data[i + 2] = c[2];
            img.data[i + 3] = cover * 255;
        }
    }
    return img;
}

export const FIN_LEN = 470;
export const FIN_WID = 150;

/**
 * A long pectoral fin (root at x 0, axis along +x at mid-height, the knobbly leading edge toward −y): `torn` bites
 * notches out of the trailing edge, punches holes and shreds the tip. `dark` dims it (the far fin, in shadow).
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
            const rootFade = smoothstep(0, 46, x);
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
            let c = mix(FLANK, BELLY_DARK, smoothstep(0.3, 0.8, m) * 0.6);
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
            let c = mix(FLANK, BELLY_DARK, smoothstep(0.35, 0.8, m) * 0.5);
            c = mix(c, BACK, ridge * 0.5);
            const k = (lower ? 0.62 : 0.98) * (0.65 + 0.45 * smoothstep(0.2, 0.9, (px - xLe) / Math.max(1, xTe - xLe)));
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
