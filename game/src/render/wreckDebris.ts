// 19r item 5 — wreck-field debris (render-only, over the 19e-7 wreckage package's records). Pure planning / cutting;
// artBundleLayer.ts draws. Each wreck record (scenario.state['wreckage'].fields[].wrecks[], 19e-7 wreckage/common.ts
// WreckRecord — read here through a local shape) becomes 3-6 hull fragments cut from the destroyed ship's own art
// (the record's design → its pictureRef, else the owner race's family image for the sub-role), drifting apart and
// slowly tumbling; crew-pod lights blink on the fragments and go out one by one as the wreck decays
// (remaining = 1 − age / wreckDecayYears, as wreckRemaining computes); salvage removes records, so the field shrinks.

import { SHIP_SET_FILES, STANDARD_FAMILY_COUNT, STANDARD_SHIP_IMAGE_START_INDEX, SHIP_SET_IMAGE_COUNT } from './builtObjectLayer';
import type { CropImage } from './liveries';

/** The fields of a 19e-7 WreckRecord this layer reads. */
export interface WreckShape {
    id: number;
    builtObjectId: number;
    designName: string;
    subRole: number;
    ownerEmpireId: number;
    x: number;
    y: number;
    size: number;
    starDate: number;
}
export interface WreckFieldShape {
    id: number;
    x: number;
    y: number;
    wrecks: WreckShape[];
}
export interface WreckageStateShape {
    fields: WreckFieldShape[];
}

/** 19e-7 manifest default of wreckDecayYears (wreckage/common.ts WRECKAGE_PARAM_DEFAULTS). */
export const WRECK_DECAY_YEARS_DEFAULT = 10;

/** 0-1 left of a wreck (wreckage/common.ts wreckRemaining: linear over wreckDecayYears). */
export function wreckRemainingAt(starDate: number, wreckDate: number, decayYears: number, yearLength: number): number {
    const span = decayYears * yearLength;
    if (!(span > 0)) return 0;
    return Math.max(0, Math.min(1, 1 - (starDate - wreckDate) / span));
}

/** The standard family image for a sub-role (BuiltObjectSubRole 1-24 follow SHIP_SET_FILES; the rest → genericbase). */
export function familyPictureRef(family: number, subRole: number): number {
    const f = Math.max(0, Math.min(STANDARD_FAMILY_COUNT - 1, family | 0));
    const k = subRole >= 1 && subRole <= SHIP_SET_FILES.length ? subRole - 1 : SHIP_SET_FILES.indexOf('genericbase');
    return STANDARD_SHIP_IMAGE_START_INDEX + f * SHIP_SET_IMAGE_COUNT + k;
}

/**
 * The art a wreck is cut from: the owner's design of that name (its pictureRef), else the owner race's family image
 * for the sub-role, else family 0.
 */
export function wreckPictureRef(
    w: WreckShape,
    owner: { designs: readonly { name: string; pictureRef: number }[]; dominantRace: { designsPictureFamilyIndex: number } | null } | null,
): number {
    const d = owner?.designs.find((x) => x.name === w.designName);
    if (d !== undefined && d.pictureRef > 0) return d.pictureRef;
    return familyPictureRef(owner?.dominantRace?.designsPictureFamilyIndex ?? 0, w.subRole);
}

function hash(a: number, b: number, seed: number): number {
    let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

export interface FragmentPlan {
    /** Polygon in crop space (px). */
    poly: { x: number; y: number }[];
    /** Centroid in crop space. */
    cx: number;
    cy: number;
    /** Drift from the wreck centre in units of the drawn ship size, turn and tumble rate (rad/s). */
    dx: number;
    dy: number;
    rot: number;
    spin: number;
    /** Crew pods on this fragment (offsets in crop px from its centroid). */
    pods: { x: number; y: number; phase: number; period: number }[];
}

/** Fragment count by wreck size: 3 for the smallest, up to 6. */
export function fragmentCount(size: number): number {
    return Math.max(3, Math.min(6, 3 + Math.floor(Math.log2(Math.max(1, size / 150)))));
}

/**
 * Plans a wreck's fragments over a crop image's hull: centres picked on hull pixels spread along the length, each an
 * irregular convex polygon (6-8 jittered vertices), drift outward from the ship centre, a turn and a slow tumble.
 * Deterministic in the wreck id.
 */
export function planFragments(hull: Uint8Array, side: number, wreckId: number, count: number): FragmentPlan[] {
    const pts: { x: number; y: number }[] = [];
    for (let y = 0; y < side; y += 2) for (let x = 0; x < side; x += 2) if (hull[y * side + x] !== 0) pts.push({ x, y });
    if (pts.length === 0) return [];
    let xMin = side;
    let xMax = 0;
    for (const p of pts) {
        if (p.x < xMin) xMin = p.x;
        if (p.x > xMax) xMax = p.x;
    }
    const out: FragmentPlan[] = [];
    const c = side / 2;
    for (let k = 0; k < count; k++) {
        // Aim along the length (stern → bow slices), take the nearest hull point.
        const tx = xMin + ((k + 0.5) / count) * (xMax - xMin) + (hash(k, 1, wreckId) - 0.5) * (xMax - xMin) * 0.1;
        let best = pts[0];
        let bd = Infinity;
        for (let i = 0; i < pts.length; i += Math.max(1, Math.floor(pts.length / 400))) {
            const p = pts[i];
            const d = Math.abs(p.x - tx) + Math.abs(p.y - c) * 0.3 + hash(i, k, wreckId) * 3;
            if (d < bd) {
                bd = d;
                best = p;
            }
        }
        const r = ((xMax - xMin) / count) * (0.75 + 0.35 * hash(k, 2, wreckId)) + 2;
        const n = 6 + Math.floor(hash(k, 3, wreckId) * 3);
        const poly: { x: number; y: number }[] = [];
        for (let v = 0; v < n; v++) {
            const a = (v / n) * Math.PI * 2 + hash(k, 10 + v, wreckId) * 0.5;
            const rr = r * (0.6 + 0.5 * hash(k, 20 + v, wreckId));
            poly.push({ x: best.x + Math.cos(a) * rr, y: best.y + Math.sin(a) * rr * 1.2 });
        }
        const ang = Math.atan2(best.y - c, best.x - c) + (hash(k, 4, wreckId) - 0.5) * 0.8;
        const dist = 0.12 + 0.35 * hash(k, 5, wreckId);
        const pods: FragmentPlan['pods'] = [];
        const np = hash(k, 6, wreckId) < 0.6 ? 1 + Math.floor(hash(k, 7, wreckId) * 2) : 0;
        for (let p = 0; p < np; p++) {
            pods.push({ x: (hash(k, 30 + p, wreckId) - 0.5) * r, y: (hash(k, 40 + p, wreckId) - 0.5) * r, phase: hash(k, 50 + p, wreckId), period: 1.4 + 1.6 * hash(k, 60 + p, wreckId) });
        }
        out.push({
            poly,
            cx: best.x,
            cy: best.y,
            dx: Math.cos(ang) * dist,
            dy: Math.sin(ang) * dist,
            rot: (hash(k, 8, wreckId) - 0.5) * Math.PI,
            spin: (hash(k, 9, wreckId) - 0.5) * 0.08,
            pods,
        });
    }
    return out;
}

/** Point-in-polygon (even-odd). */
export function insidePolygon(poly: readonly { x: number; y: number }[], x: number, y: number): boolean {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i];
        const b = poly[j];
        if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
}

/**
 * Cuts one fragment out of the crop image: the pixels inside the polygon and on the hull, darkened (burnt metal) and
 * charred along the break. Returns the RGBA of the polygon's bounding box and the centroid inside it.
 */
export function cutFragment(img: CropImage, plan: FragmentPlan, seed: number): { rgba: Uint8ClampedArray; w: number; h: number; ox: number; oy: number } {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of plan.poly) {
        x0 = Math.min(x0, p.x);
        y0 = Math.min(y0, p.y);
        x1 = Math.max(x1, p.x);
        y1 = Math.max(y1, p.y);
    }
    x0 = Math.floor(x0);
    y0 = Math.floor(y0);
    const w = Math.max(1, Math.ceil(x1) - x0 + 1);
    const h = Math.max(1, Math.ceil(y1) - y0 + 1);
    const out = new Uint8ClampedArray(w * h * 4);
    const inPoly = (x: number, y: number): boolean => insidePolygon(plan.poly, x + 0.5, y + 0.5);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const sx = x + x0;
            const sy = y + y0;
            if (sx < 0 || sy < 0 || sx >= img.side || sy >= img.side) continue;
            if (!inPoly(sx, sy)) continue;
            const si = (sy * img.side + sx) * 4;
            if (img.rgba[si + 3] <= 32) continue;
            // Break edge: a neighbour outside the polygon.
            const edge = !inPoly(sx - 1, sy) || !inPoly(sx + 1, sy) || !inPoly(sx, sy - 1) || !inPoly(sx, sy + 1);
            const burn = edge ? 0.18 : 0.42 + 0.22 * hash(sx >> 1, sy >> 1, seed);
            const o = (y * w + x) * 4;
            out[o] = img.rgba[si] * burn + (edge ? 30 : 6);
            out[o + 1] = img.rgba[si + 1] * burn + (edge ? 12 : 4);
            out[o + 2] = img.rgba[si + 2] * burn;
            out[o + 3] = img.rgba[si + 3];
        }
    }
    return { rgba: out, w, h, ox: plan.cx - x0, oy: plan.cy - y0 };
}

/** Pods still lit at `remaining` (0-1): they go out in order as the wreck decays. */
export function podsLit(total: number, remaining: number): number {
    return Math.max(0, Math.min(total, Math.ceil(total * remaining - 1e-9)));
}

/** A pod's blink (on/off) at render time t (s): a 0.25 s flash each period, slower as the wreck decays. */
export function podOn(t: number, phase: number, period: number, remaining: number): boolean {
    const p = period * (1 + 1.5 * (1 - remaining));
    const q = ((t / p + phase) % 1 + 1) % 1;
    return q < 0.25 / p;
}
