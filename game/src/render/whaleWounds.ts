// The Leviathan's wounds (Void Whale threat): a transparent overlay in body-texture space, drawn over the rig body
// (CreatureRig.setDamage). Pure and deterministic from two numbers, no Rnd and no DOM:
//   peak = the largest share of its health the beast has ever lost (0..1; never falls),
//   cur  = the share it has lost now (falls as it heals).
// 24 gash slots appear in a fixed order as `peak` rises (slot k at peak >= its threshold) and stay for good. A slot
// whose threshold is above `cur` has healed: it is drawn as a thin pale scar; one at or below `cur` is an open, dark
// red gash with raw edges and a bone-pale depth line. In between it closes smoothly, so healing fades red to pale.

import { silhouetteAt, maxHalfOf, smoothstep, type BodyDef, type RgbaImage } from './creatureRig';

export const WOUND_SLOTS = 24;
/** Quantisation of peak / cur for the texture cache key. */
export const WOUND_STEPS = 48;

function h01(slot: number, k: number): number {
    let h = Math.imul(slot * 7919 + k * 104729 + 12345, 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 15), 0xc2b2ae35);
    h ^= h >>> 13;
    return (h >>> 0) / 4294967296;
}

export function woundThreshold(slot: number): number {
    return ((slot + 0.35) / WOUND_SLOTS) * 0.92;
}

/** Number of gashes that exist at `peak`. */
export function woundCount(peak: number): number {
    let n = 0;
    while (n < WOUND_SLOTS && peak >= woundThreshold(n)) n++;
    return n;
}

export function woundKey(peak: number, cur: number): string {
    const q = (x: number): number => Math.round(Math.max(0, Math.min(1, x)) * WOUND_STEPS);
    return `${q(peak)}:${q(cur)}`;
}

function over(img: RgbaImage, mask: Uint8ClampedArray, x: number, y: number, r: number, g: number, b: number, a: number): void {
    if (x < 0 || y < 0 || x >= img.w || y >= img.h || a <= 0) return;
    const i = (y * img.w + x) * 4;
    const m = mask[i + 3] / 255;
    if (m < 0.3) return;
    const sa = Math.min(1, a) * Math.min(1, m * 1.15);
    const da = img.data[i + 3] / 255;
    const oa = sa + da * (1 - sa);
    if (oa <= 0) return;
    img.data[i] = (r * sa + img.data[i] * da * (1 - sa)) / oa;
    img.data[i + 1] = (g * sa + img.data[i + 1] * da * (1 - sa)) / oa;
    img.data[i + 2] = (b * sa + img.data[i + 2] * da * (1 - sa)) / oa;
    img.data[i + 3] = oa * 255;
}

function stroke(img: RgbaImage, mask: Uint8ClampedArray, x0: number, y0: number, x1: number, y1: number, w: number, rgb: readonly [number, number, number], alpha: number): void {
    const minX = Math.max(0, Math.floor(Math.min(x0, x1) - w - 1));
    const maxX = Math.min(img.w - 1, Math.ceil(Math.max(x0, x1) + w + 1));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1) - w - 1));
    const maxY = Math.min(img.h - 1, Math.ceil(Math.max(y0, y1) + w + 1));
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len2 = Math.max(1e-6, dx * dx + dy * dy);
    for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
            const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / len2));
            const d = Math.hypot(x - (x0 + dx * t), y - (y0 + dy * t));
            if (d > w) continue;
            over(img, mask, x, y, rgb[0], rgb[1], rgb[2], alpha * (1 - smoothstep(w * 0.45, w, d)));
        }
    }
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const mix = (a: readonly [number, number, number], b: readonly [number, number, number], t: number): [number, number, number] => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

const SCAR_RIM = [214, 196, 190] as const;
const RAW_RIM = [168, 34, 52] as const;
const RAW_CORE = [58, 2, 12] as const;
const BONE = [236, 208, 192] as const;

/** The wound overlay for `body` (the rig's body raster). */
export function paintWounds(def: BodyDef, body: RgbaImage, peak: number, cur: number): RgbaImage {
    const img: RgbaImage = { w: body.w, h: body.h, data: new Uint8ClampedArray(body.w * body.h * 4) };
    const sc = body.w / 1024;
    const n = woundCount(peak);
    const maxHalf = maxHalfOf(def);
    for (let k = 0; k < n; k++) {
        const th = woundThreshold(k);
        const open = smoothstep(th - 0.05, th + 0.008, cur);
        const u = 0.16 + 0.8 * h01(k, 1);
        const v = (h01(k, 2) * 2 - 1) * 0.78;
        const cx = u * body.w;
        const cy = body.h / 2 + v * silhouetteAt(def, u) * maxHalf;
        // Slashes run mostly across the flank, raked back like claw / blade cuts.
        const ang = Math.PI / 2 + (h01(k, 3) - 0.5) * 1.5 + (v > 0 ? 0.35 : -0.35);
        const L = (80 + 150 * h01(k, 4)) * sc;
        const wGash = (5 + 6 * h01(k, 5)) * sc;
        const pts: [number, number][] = [];
        const SEG = 6;
        for (let j = 0; j <= SEG; j++) {
            const t = j / SEG - 0.5;
            const jag = (h01(k, 10 + j) - 0.5) * L * 0.16;
            pts.push([cx + Math.cos(ang) * L * t - Math.sin(ang) * jag, cy + Math.sin(ang) * L * t + Math.cos(ang) * jag]);
        }
        for (let j = 0; j < SEG; j++) {
            const taper = Math.sin((Math.PI * (j + 0.5)) / SEG);
            const w = lerp(1.6 * sc, wGash, open) * (0.45 + 0.55 * taper);
            // Healed: the pale scar tissue lies wider than the thin seam (drawn first); open: raw rim, dark core, bone.
            stroke(img, body.data, pts[j][0], pts[j][1], pts[j + 1][0], pts[j + 1][1], w * 1.9, mix(SCAR_RIM, RAW_RIM, open), lerp(0.5, 0.85, open));
            stroke(img, body.data, pts[j][0], pts[j][1], pts[j + 1][0], pts[j + 1][1], w * lerp(0.55, 0.8, open), mix(SCAR_RIM, RAW_CORE, open), lerp(0.75, 0.97, open));
            if (open > 0.4 && j > 0 && j < SEG - 1) stroke(img, body.data, pts[j][0], pts[j][1], pts[j + 1][0], pts[j + 1][1], w * 0.22, BONE, (open - 0.4) * 0.9);
        }
    }
    return img;
}
