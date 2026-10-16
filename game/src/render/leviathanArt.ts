// The Leviathan's art (Void Whale threat, scenarios/void-whale): a giant alien humpback-like whale seen FROM ABOVE like
// every creature and ship (head along +x, turned with its heading). The art is the user-supplied Leviathan picture, cut
// into parts by scripts/leviathan-parts.py (public/art/leviathan/: body, two pectoral fins, flukes; their pivots, the
// body outline and the glowing head dots / spine beads in leviathanParts.ts), toned down to sit in the dark of space and
// weathered (an old, hunted animal), with the old harpoons stuck in it drawn into their own atlas (harpoons.png).
// This module holds the body geometry everything else measures against (the rope, the wounds, the galaxy icon), the
// plain dark silhouette shown if the pictures cannot load, and the soft glow-dot texture.
//
// Everything here is pure (typed arrays, no DOM, no galaxy.rnd). Local frame: head toward +x, left flank −y.

import { smoothstep, type RgbaImage } from './creatureRig';
import { LEV_HALF_PROFILE, LEV_PARTS, LEV_PART_H, LEV_PART_W, LEV_PART_X0, LEV_PART_X1, type LevPart } from './leviathanParts';

type Rgb = readonly [number, number, number];

/** Body texture size (px) and the body's extent along x: the fluke root at X0, the snout tip at X1. */
export const LEV_W = LEV_PART_W;
export const LEV_H = LEV_PART_H;
export const LEV_X0 = LEV_PART_X0;
export const LEV_X1 = LEV_PART_X1;
const CY = LEV_H / 2;

function image(w: number, h: number): RgbaImage {
    return { w, h, data: new Uint8ClampedArray(w * h * 4) };
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const mix = (a: Rgb, b: Rgb, t: number): [number, number, number] => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Straight-alpha source-over of one pixel. */
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

/** Visits the pixels of a disc of radius r: d = distance / r. */
function disc(img: RgbaImage, cx: number, cy: number, r: number, fn: (x: number, y: number, d: number) => void): void {
    for (let y = Math.max(0, Math.floor(cy - r - 1)); y <= Math.min(img.h - 1, Math.ceil(cy + r + 1)); y++) {
        for (let x = Math.max(0, Math.floor(cx - r - 1)); x <= Math.min(img.w - 1, Math.ceil(cx + r + 1)); x++) {
            const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r;
            if (d <= 1) fn(x, y, d);
        }
    }
}

// ---------------------------------------------------------------------------
// The outline (seen from above), measured from the body picture.

export const levX = (u: number): number => LEV_X0 + u * (LEV_X1 - LEV_X0);
export const levU = (x: number): number => (x - LEV_X0) / (LEV_X1 - LEV_X0);

/** Half-width of the body at u (texture px; 0 the fluke root … 1 the snout tip). */
export function levHalf(u: number): number {
    const n = LEV_HALF_PROFILE.length - 1;
    const s = Math.max(0, Math.min(n, u * n));
    const j = Math.min(n - 1, Math.floor(s));
    return lerp(LEV_HALF_PROFILE[j], LEV_HALF_PROFILE[j + 1], s - j);
}
/** Left / right edge at u (texture px, y down). */
export function levTop(u: number): number {
    return CY - levHalf(u);
}
export function levBot(u: number): number {
    return CY + levHalf(u);
}

/** A point on the back: u along, t across (0 left edge .. 1 right edge). */
export function levFlank(u: number, t: number): [number, number] {
    const top = levTop(u);
    return [levX(u), top + (levBot(u) - top) * t];
}

// ---------------------------------------------------------------------------
// The fallback: a plain dark silhouette of each part (shown only if the pictures fail to load).

const DARK: Rgb = [22, 28, 40];
const DARK_SIDE: Rgb = [8, 10, 16];

/** The body silhouette from the measured outline, lit from above (sides darker). Pure, deterministic. */
export function leviathanSilhouette(): RgbaImage {
    const img = image(LEV_W, LEV_H);
    for (let x = 0; x < LEV_W; x++) {
        const u = levU(x + 0.5);
        if (u < 0 || u > 1) continue;
        const half = levHalf(u);
        for (let y = 0; y < LEV_H; y++) {
            const off = Math.abs(y + 0.5 - CY);
            const cover = clamp01(half - off + 0.5) * clamp01((x + 0.5 - LEV_X0) / 4);
            if (cover <= 0) continue;
            const c = mix(DARK, DARK_SIDE, smoothstep(0.4, 1, off / Math.max(1, half)));
            const i = (y * LEV_W + x) * 4;
            img.data[i] = c[0];
            img.data[i + 1] = c[1];
            img.data[i + 2] = c[2];
            img.data[i + 3] = cover * 255;
        }
    }
    return img;
}

/** A part's fallback: a dark ellipse filling its box. */
export function leviathanPartSilhouette(p: LevPart): RgbaImage {
    const img = image(p.w, p.h);
    for (let y = 0; y < p.h; y++) {
        for (let x = 0; x < p.w; x++) {
            const d = Math.hypot((x + 0.5 - p.w / 2) / (p.w / 2), (y + 0.5 - p.h / 2) / (p.h / 2));
            if (d < 0.9) over(img, x, y, DARK[0], DARK[1], DARK[2], clamp01((0.9 - d) * 20));
        }
    }
    return img;
}

export { LEV_PARTS };

/** A copy of the rectangle (x, y, w, h) of `img` (a frame of the harpoon atlas). Pure. */
export function cropRgba(img: RgbaImage, x: number, y: number, w: number, h: number): RgbaImage {
    const out = image(w, h);
    for (let r = 0; r < h; r++) {
        const sy = y + r;
        if (sy < 0 || sy >= img.h) continue;
        const x0 = Math.max(0, x);
        const x1 = Math.min(img.w, x + w);
        if (x1 <= x0) continue;
        out.data.set(img.data.subarray((sy * img.w + x0) * 4, (sy * img.w + x1) * 4), (r * w + (x0 - x)) * 4);
    }
    return out;
}

// ---------------------------------------------------------------------------
// Fx.

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

/** A soft radial glow (white-hot core → `halo` → transparent). */
export function glowRgba(size: number, core: Rgb, halo: Rgb): RgbaImage {
    const img = image(size, size);
    glowDot(img, size / 2, size / 2, size * 0.1, size / 2, core, halo, 1);
    return img;
}
