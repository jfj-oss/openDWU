// 19r item 2 — league presence (render-only, over the 19k-3 independent leagues: scenario.state['independents']
// .leagues[], independents/common.ts IndependentLeague — read here through a local shape). Pure: the league flag
// (the founder race's flag shape + a chain-link emblem in the league colour), the pennant cut from it, the member
// boundary (convex hull + margin) and its dots.

import { composeEmpireFlag, blankImage, over, sampleBilinear, type RgbaImage } from './emblemArt';

/** The fields of a 19k-3 IndependentLeague this layer reads. */
export interface LeagueShape {
    id: number;
    name: string;
    colour: number;
    flagShape: number;
    founder: { xpos: number; ypos: number; name?: string } | null;
    members: { xpos: number; ypos: number; name?: string }[];
    status: string;
}
export interface IndependentsShape {
    leagues: LeagueShape[];
}

/** The active leagues (empty without the 19k-3 state). */
export function activeLeaguesOf(state: unknown): LeagueShape[] {
    const s = state as Partial<IndependentsShape> | null | undefined;
    if (s == null || !Array.isArray(s.leagues)) return [];
    return s.leagues.filter((l) => l.status === 'active');
}

function shade(c: number, k: number): number {
    const r = Math.min(255, Math.round(((c >> 16) & 255) * k));
    const g = Math.min(255, Math.round(((c >> 8) & 255) * k));
    const b = Math.min(255, Math.round((c & 255) * k));
    return (r << 16) | (g << 8) | b;
}

/** Stroke of an axis-aligned ellipse ring (anti-aliased), optionally only where `keep(x, y)` holds. */
function ellipseRing(img: RgbaImage, cx: number, cy: number, rx: number, ry: number, width: number, col: number, keep: (x: number, y: number) => boolean = () => true): void {
    const r = (col >> 16) & 255;
    const g = (col >> 8) & 255;
    const b = col & 255;
    for (let y = Math.floor(cy - ry - width); y <= Math.ceil(cy + ry + width); y++) {
        for (let x = Math.floor(cx - rx - width); x <= Math.ceil(cx + rx + width); x++) {
            if (x < 0 || y < 0 || x >= img.w || y >= img.h || !keep(x, y)) continue;
            const u = (x + 0.5 - cx) / rx;
            const v = (y + 0.5 - cy) / ry;
            const d = Math.abs(Math.hypot(u, v) - 1) * Math.min(rx, ry);
            const cov = Math.max(0, Math.min(1, width / 2 - d + 0.5));
            if (cov > 0) over(img.data, (y * img.w + x) * 4, r, g, b, cov);
        }
    }
}

/** A chain link emblem: two interlocked oval links at (cx, cy), length s. */
export function drawChainLinks(img: RgbaImage, cx: number, cy: number, s: number, col: number, outline: number): void {
    const rx = s * 0.3;
    const ry = s * 0.17;
    const w = Math.max(1.5, s * 0.08);
    const lx = cx - rx * 0.55;
    const rxc = cx + rx * 0.55;
    // Left link under, right link over — then the left link's upper arc over the right one (interlock).
    ellipseRing(img, lx, cy, rx, ry, w + 1.6, outline);
    ellipseRing(img, lx, cy, rx, ry, w, col);
    ellipseRing(img, rxc, cy, rx, ry, w + 1.6, outline);
    ellipseRing(img, rxc, cy, rx, ry, w, col);
    ellipseRing(img, lx, cy, rx, ry, w + 1.6, outline, (x, y) => y < cy && x > cx);
    ellipseRing(img, lx, cy, rx, ry, w, col, (x, y) => y < cy && x > cx);
}

/** League flag: the founder race's flag shape on a dark field of the league colour, a chain-link emblem in the fly. */
export function leagueFlag(shape: RgbaImage | null, colour: number): RgbaImage {
    const flag = composeEmpireFlag(shape, shade(colour, 0.45), shade(colour, 1.25));
    // Band along the foot in the league colour, the links over it.
    for (let y = Math.floor(flag.h * 0.74); y < flag.h; y++) {
        for (let x = 0; x < flag.w; x++) over(flag.data, (y * flag.w + x) * 4, (colour >> 16) & 255, (colour >> 8) & 255, colour & 255, 0.85);
    }
    drawChainLinks(flag, flag.w * 0.72, flag.h * 0.5, flag.h * 0.62, 0xf0e8d0, 0x101010);
    return flag;
}

/** A swallowtail pennant (w × h) cut from a flag with a slight wave; transparent outside the pennant shape. */
export function pennantFromFlag(flag: RgbaImage, w = 48, h = 28, phase = 0): RgbaImage {
    const out = blankImage(w, h);
    const px = [0, 0, 0, 0];
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const u = x / (w - 1);
            const wave = Math.sin(u * 5 + phase) * u * h * 0.06;
            const vy = y - wave;
            const half = (h / 2) * (1 - 0.55 * u);
            const d = Math.abs(vy - h / 2);
            // Swallowtail notch at the fly.
            const notch = u > 0.78 && d < (u - 0.78) * h * 1.1;
            if (d > half || notch) continue;
            sampleBilinear(flag, u * flag.w, ((vy - (h / 2 - half)) / (2 * half)) * flag.h, px);
            const lit = 0.85 + 0.15 * Math.cos(u * 5 + phase);
            const i = (y * w + x) * 4;
            out.data[i] = px[0] * lit;
            out.data[i + 1] = px[1] * lit;
            out.data[i + 2] = px[2] * lit;
            out.data[i + 3] = px[3];
        }
    }
    return out;
}

/** Convex hull (monotone chain), counter-clockwise, no duplicate end point. */
export function convexHull(points: readonly { x: number; y: number }[]): { x: number; y: number }[] {
    const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
    if (p.length <= 2) return p;
    const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lower: { x: number; y: number }[] = [];
    for (const q of p) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
        lower.push(q);
    }
    const upper: { x: number; y: number }[] = [];
    for (let i = p.length - 1; i >= 0; i--) {
        const q = p[i];
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
        upper.push(q);
    }
    upper.pop();
    lower.pop();
    return [...lower, ...upper];
}

/**
 * The dotted boundary round the members: points every `spacing` world units along the hull of the members, each
 * pushed out by `margin` (a circle round a lone member; a stadium round two).
 */
export function leagueBoundaryDots(members: readonly { x: number; y: number }[], margin: number, spacing: number): { x: number; y: number }[] {
    if (members.length === 0 || !(spacing > 0)) return [];
    // Sample a circle of radius `margin` round every member, hull the lot: the Minkowski sum of the hull and a disc.
    const ring: { x: number; y: number }[] = [];
    for (const m of members) for (let k = 0; k < 24; k++) ring.push({ x: m.x + Math.cos((k / 24) * Math.PI * 2) * margin, y: m.y + Math.sin((k / 24) * Math.PI * 2) * margin });
    const hull = convexHull(ring);
    const out: { x: number; y: number }[] = [];
    let carry = 0;
    for (let i = 0; i < hull.length; i++) {
        const a = hull[i];
        const b = hull[(i + 1) % hull.length];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        let t = carry;
        while (t < len) {
            out.push({ x: a.x + ((b.x - a.x) * t) / len, y: a.y + ((b.y - a.y) * t) / len });
            t += spacing;
        }
        carry = t - len;
    }
    return out;
}
