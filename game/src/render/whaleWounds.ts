// The Leviathan's wounds (Void Whale threat): a transparent overlay in body-texture space, drawn over the rig body
// (LeviathanRig.setDamage). Pure and deterministic from two numbers, no Rnd and no DOM:
//   peak = the largest share of its health the beast has ever lost (0..1; never falls),
//   cur  = the share it has lost now (falls as it heals).
// 24 gash slots appear in a fixed order as `peak` rises (slot k at peak >= its threshold) and stay for good, with a
// few hundred fine scuffs, scrapes and nicks (their own thresholds) so heavy damage reads as a battered hide. A mark
// whose threshold is above `cur` has healed: a thin, low-contrast pale-grey scar; one at or below `cur` is open: a thin
// tapering cut of dark dried maroon, wet only at the centre of the fresh deep gashes (no glow, no outline). In between
// it closes smoothly, so healing fades dark red to pale grey.

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

/** Fine scuffs / scrapes / nicks: their count grows with `peak` up to this many. */
export const SCUFF_SLOTS = 320;

function scuffThreshold(j: number): number {
    return ((j + 0.5) / SCUFF_SLOTS) * 0.95;
}

// Dim, desaturated colours: it sits on a dark photographic hide in the dark of space.
const DRIED = [50, 17, 19] as const;
const DEEP = [26, 5, 8] as const;
const WET = [88, 20, 24] as const;
const BRUISE = [18, 10, 14] as const;
const SCAR = [112, 116, 124] as const;
const SCAR_SEAM = [70, 74, 82] as const;
const SCRAPE = [104, 112, 124] as const;
const NICK = [16, 16, 20] as const;

/**
 * Paints a broken tapering stroke along `pts`: `width(t)` the half-width at arc fraction t, `gap(t)` true where it is
 * broken, `paint(x, y, r, t)` for each covered pixel (r = distance / half-width, 0 centre … 1 edge, up to `reach`).
 */
function stroke(img: RgbaImage, pts: readonly [number, number][], width: (t: number) => number, gap: (t: number) => boolean, reach: number, paint: (x: number, y: number, r: number, t: number, cover: number) => void): void {
    const cum = [0];
    for (let j = 1; j < pts.length; j++) cum.push(cum[j - 1] + Math.hypot(pts[j][0] - pts[j - 1][0], pts[j][1] - pts[j - 1][1]));
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    let wMax = 0;
    for (let k = 0; k <= 8; k++) wMax = Math.max(wMax, width(k / 8));
    const R = wMax * reach + 1.5;
    for (let y = Math.max(0, Math.floor(Math.min(...ys) - R)); y <= Math.min(img.h - 1, Math.ceil(Math.max(...ys) + R)); y++) {
        for (let x = Math.max(0, Math.floor(Math.min(...xs) - R)); x <= Math.min(img.w - 1, Math.ceil(Math.max(...xs) + R)); x++) {
            const [d, t] = nearest(pts, cum, x + 0.5, y + 0.5);
            if (gap(t)) continue;
            const w = Math.max(0.35, width(t));
            const r = d / w;
            if (r > reach) continue;
            // Sub-pixel cuts still cover part of a pixel: fade by the coverage instead of drawing a hard 1 px line.
            const cover = Math.min(1, w * 1.6) * (1 - smoothstep(reach * 0.75, reach, r));
            paint(x, y, r, t, cover);
        }
    }
}

/** A wandering polyline of `seg` segments from the centre (cx, cy), length L at angle ang, jagged by `jag`. */
function path(cx: number, cy: number, ang: number, L: number, seg: number, jag: number, key: number, bend: number): [number, number][] {
    const pts: [number, number][] = [];
    for (let j = 0; j <= seg; j++) {
        const t = j / seg - 0.5;
        const off = (h01(key, 10 + j) - 0.5) * L * jag + bend * L * (0.25 - t * t);
        pts.push([cx + Math.cos(ang) * L * t - Math.sin(ang) * off, cy + Math.sin(ang) * L * t + Math.cos(ang) * off]);
    }
    return pts;
}

/** The wound overlay for `body` (the Leviathan's body raster, leviathanArt.ts outline): fine scuffs and scrapes over the
 * hide, thin cuts and a few deeper dark gashes raked across the back. */
export function paintWounds(body: RgbaImage, peak: number, cur: number): RgbaImage {
    const img: RgbaImage = { w: body.w, h: body.h, data: new Uint8ClampedArray(body.w * body.h * 4) };
    const sc = body.w / 800;
    // Scuffs, scrapes and nicks first (under the cuts), following the skin's lengthwise grain.
    for (let j = 0; j < SCUFF_SLOTS && peak >= scuffThreshold(j); j++) {
        const th = scuffThreshold(j);
        const open = smoothstep(th - 0.04, th + 0.006, cur);
        const k = 1000 + j;
        const [cx, cy] = levFlank(0.06 + 0.9 * h01(k, 1), 0.08 + 0.84 * h01(k, 2));
        const kind = h01(k, 3);
        const ang = (h01(k, 4) < 0.7 ? 0 : Math.PI / 2) + (h01(k, 5) - 0.5) * 1.1;
        if (kind < 0.55) {
            // A scrape: 2-4 fine parallel scratches, pale where the hide is rubbed raw, dark red in the freshest.
            const L = (5 + 18 * h01(k, 6)) * sc;
            const lines = 2 + Math.floor(h01(k, 7) * 3);
            const a = 0.3 + 0.25 * h01(k, 8);
            for (let q = 0; q < lines; q++) {
                const o = (q - (lines - 1) / 2) * (1.3 + h01(k, 20 + q)) * sc;
                const pts = path(cx - Math.sin(ang) * o, cy + Math.cos(ang) * o, ang, L * (0.6 + 0.4 * h01(k, 30 + q)), 3, 0.12, k * 7 + q, 0);
                stroke(img, pts, (t) => 0.6 * sc * Math.sin(Math.PI * t), () => false, 1, (x, y, r, _t, cov) => {
                    const c = mix(SCRAPE, DRIED, open * 0.8);
                    over(img, body.data, x, y, c[0], c[1], c[2], a * cov * (1 - r * 0.5));
                });
            }
        } else if (kind < 0.8) {
            // An abrasion: a small rough patch, darker and faintly reddish while fresh, pale grey once healed.
            const R = (2 + 4 * h01(k, 6)) * sc;
            const rx = R * (1.4 + h01(k, 7));
            for (let y = Math.floor(cy - R - 1); y <= Math.ceil(cy + R + 1); y++) {
                for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
                    const dx = x + 0.5 - cx;
                    const dy = y + 0.5 - cy;
                    const u = (dx * Math.cos(ang) + dy * Math.sin(ang)) / rx;
                    const v = (-dx * Math.sin(ang) + dy * Math.cos(ang)) / R;
                    const d = Math.hypot(u, v);
                    if (d > 1) continue;
                    // Broken up like rubbed skin.
                    if (h01(k, 100 + ((x * 31 + y * 17) & 1023)) < 0.35) continue;
                    const c = mix(SCRAPE, mix(DRIED, BRUISE, 0.4), open);
                    over(img, body.data, x, y, c[0], c[1], c[2], (0.2 + 0.18 * open) * (1 - d));
                }
            }
        } else {
            // A nick: a tiny dark pit or a short sharp cut.
            const L = (1.5 + 4 * h01(k, 6)) * sc;
            const pts = path(cx, cy, ang, L, 2, 0.1, k, 0);
            stroke(img, pts, (t) => (0.5 + 0.4 * h01(k, 7)) * sc * Math.pow(Math.sin(Math.PI * t), 0.5), () => false, 1, (x, y, r, _t, cov) => {
                const c = mix(mix(SCAR, NICK, 0.5), DEEP, open);
                over(img, body.data, x, y, c[0], c[1], c[2], (0.3 + 0.3 * open) * cov * (1 - r * 0.6));
            });
        }
    }
    // The cuts: thin tapering broken lines of varied length, every third a deeper gash that reads from afar.
    const n = woundCount(peak);
    for (let k = 0; k < n; k++) {
        const th = woundThreshold(k);
        const open = smoothstep(th - 0.05, th + 0.008, cur);
        const deep = k % 3 === 1;
        const [cx, cy] = levFlank(0.12 + 0.82 * h01(k, 1), 0.14 + 0.72 * h01(k, 2));
        // Raked across the flank (claw / blade / beam cuts), some along it.
        const ang = (h01(k, 6) < 0.75 ? Math.PI / 2 + 0.45 : 0.2) + (h01(k, 3) - 0.5) * 1.1;
        const L = (deep ? 60 + 70 * h01(k, 4) : 18 + 50 * h01(k, 4)) * sc;
        // Open: deep gashes ~2-3 px wide at the middle, fine cuts ~1 px; healed: a hair-thin scar.
        const wOpen = (deep ? 1.9 + 1.0 * h01(k, 5) : 0.6 + 0.4 * h01(k, 5)) * sc;
        const wMid = lerp(0.5 * sc, wOpen, open);
        const pts = path(cx, cy, ang, L, 8, 0.08, k, (h01(k, 7) - 0.5) * 0.25);
        const gapAt = h01(k, 8) < 0.6 ? 0.25 + 0.5 * h01(k, 9) : -1;
        const gapLen = 0.04 + 0.08 * h01(k, 11);
        const reach = open > 0.05 ? 2.2 : 1;
        stroke(img, pts, (t) => wMid * Math.pow(Math.sin(Math.PI * Math.max(0.01, Math.min(0.99, t))), 0.9), (t) => gapAt > 0 && Math.abs(t - gapAt) < gapLen, reach, (x, y, r, t, cov) => {
            if (r > 1) {
                // A faint dark bruise either side of an open cut (no glow, no outline).
                if (open > 0.05) over(img, body.data, x, y, BRUISE[0], BRUISE[1], BRUISE[2], 0.35 * open * (1 - (r - 1) / (reach - 1)) * cov);
                return;
            }
            if (open <= 0.05) {
                // Healed: thin pale-grey, a touch darker down the seam, low contrast.
                const c = mix(SCAR_SEAM, SCAR, smoothstep(0.1, 0.7, r));
                over(img, body.data, x, y, c[0], c[1], c[2], 0.48 * cov * (1 - r * 0.4));
                return;
            }
            // Open: dark dried maroon edges into a near-black depth; wet only at the centre of a fresh deep gash.
            let c = mix(DEEP, DRIED, smoothstep(0.45, 1, r));
            if (deep && open > 0.6 && r < 0.3) c = mix(c, WET, (open - 0.6) * 2 * (1 - r / 0.3) * Math.sin(Math.PI * t));
            const healedC = mix(SCAR_SEAM, SCAR, smoothstep(0.1, 0.7, r));
            c = mix(healedC, c, open);
            over(img, body.data, x, y, c[0], c[1], c[2], lerp(0.36, 0.92, open) * cov * (1 - smoothstep(0.75, 1, r) * 0.6));
        });
    }
    return img;
}
