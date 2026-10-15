// The Leviathan's wounds (Void Whale threat): a transparent overlay in body-texture space, drawn over the rig body
// (LeviathanRig.setDamage). Pure and deterministic from two numbers, no Rnd and no DOM:
//   peak = the largest share of its health the beast has ever lost (0..1; never falls),
//   cur  = the share it has lost now (falls as it heals).
// 24 gash slots appear in a fixed order as `peak` rises (slot k at peak >= its threshold) and stay for good. A slot
// whose threshold is above `cur` has healed: it is drawn as a thin pale scar; one at or below `cur` is an open, dark
// red gash with raw edges and a bone-pale depth line. In between it closes smoothly, so healing fades red to pale.

import { smoothstep, type RgbaImage } from './creatureRig';
import { levFlank } from './leviathanArt';

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

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const mix = (a: readonly [number, number, number], b: readonly [number, number, number], t: number): [number, number, number] => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

const SCAR_RIM = [196, 192, 198] as const;
const SCAR_SEAM = [150, 148, 158] as const;
const RAW_RIM = [214, 44, 50] as const;
const RAW_CORE = [64, 0, 10] as const;
const BONE = [240, 206, 190] as const;
const HALO = [190, 20, 28] as const;

/** Distance from (x, y) to a polyline and the arc fraction 0..1 of the nearest point. */
function nearest(pts: readonly [number, number][], cum: readonly number[], x: number, y: number): [number, number] {
    let best = Infinity;
    let at = 0;
    for (let j = 0; j < pts.length - 1; j++) {
        const [x0, y0] = pts[j];
        const dx = pts[j + 1][0] - x0;
        const dy = pts[j + 1][1] - y0;
        const l2 = Math.max(1e-6, dx * dx + dy * dy);
        const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / l2));
        const d = Math.hypot(x - x0 - dx * t, y - y0 - dy * t);
        if (d < best) {
            best = d;
            at = cum[j] + (cum[j + 1] - cum[j]) * t;
        }
    }
    return [best, at / cum[cum.length - 1]];
}

/** The wound overlay for `body` (the Leviathan's body raster, leviathanArt.ts outline): gashes raked across the back. */
export function paintWounds(body: RgbaImage, peak: number, cur: number): RgbaImage {
    const img: RgbaImage = { w: body.w, h: body.h, data: new Uint8ClampedArray(body.w * body.h * 4) };
    const sc = body.w / 1600;
    const n = woundCount(peak);
    for (let k = 0; k < n; k++) {
        const th = woundThreshold(k);
        const open = smoothstep(th - 0.05, th + 0.008, cur);
        const [cx, cy] = levFlank(0.14 + 0.8 * h01(k, 1), 0.14 + 0.72 * h01(k, 2));
        // Slashes run mostly across the flank, raked back like claw / blade / beam cuts.
        const ang = Math.PI / 2 + (h01(k, 3) - 0.5) * 1.2 + 0.45;
        const L = (110 + 150 * h01(k, 4)) * sc;
        const wMax = lerp(2.2 * sc, (7 + 7 * h01(k, 5)) * sc, open);
        const pts: [number, number][] = [];
        const SEG = 6;
        for (let j = 0; j <= SEG; j++) {
            const t = j / SEG - 0.5;
            const jag = (h01(k, 10 + j) - 0.5) * L * 0.12;
            pts.push([cx + Math.cos(ang) * L * t - Math.sin(ang) * jag, cy + Math.sin(ang) * L * t + Math.cos(ang) * jag]);
        }
        const cum = [0];
        for (let j = 1; j < pts.length; j++) cum.push(cum[j - 1] + Math.hypot(pts[j][0] - pts[j - 1][0], pts[j][1] - pts[j - 1][1]));
        const reach = wMax * (open > 0.05 ? 3 : 1.8) + 2;
        const xs = pts.map((p) => p[0]);
        const ys = pts.map((p) => p[1]);
        for (let y = Math.max(0, Math.floor(Math.min(...ys) - reach)); y <= Math.min(img.h - 1, Math.ceil(Math.max(...ys) + reach)); y++) {
            for (let x = Math.max(0, Math.floor(Math.min(...xs) - reach)); x <= Math.min(img.w - 1, Math.ceil(Math.max(...xs) + reach)); x++) {
                const [d, t] = nearest(pts, cum, x + 0.5, y + 0.5);
                const w = wMax * Math.pow(Math.sin(Math.PI * Math.max(0.02, Math.min(0.98, t))), 0.6);
                const r = d / Math.max(0.5, w);
                if (r > 3) continue;
                // Fresh: a soft blood glow (reads at system zoom), raw red lips, a dark core, a bone-pale depth line.
                // Healed: a pale raised scar with a darker seam.
                if (r > 1) {
                    if (open > 0.05) over(img, body.data, x, y, HALO[0], HALO[1], HALO[2], 0.3 * open * Math.pow(1 - (r - 1) / 2, 2));
                    else if (r < 1.8) over(img, body.data, x, y, SCAR_RIM[0], SCAR_RIM[1], SCAR_RIM[2], 0.35 * (1 - (r - 1) / 0.8));
                    continue;
                }
                const lip = smoothstep(0.35, 0.75, r);
                const rim = mix(SCAR_RIM, RAW_RIM, open);
                const core = mix(SCAR_SEAM, RAW_CORE, open);
                let c = mix(core, rim, lip);
                if (open > 0.4 && r < 0.14) c = mix(c, BONE, (open - 0.4) * 1.4);
                over(img, body.data, x, y, c[0], c[1], c[2], lerp(0.7, 0.97, open) * (1 - smoothstep(0.85, 1, r)));
            }
        }
    }
    return img;
}
