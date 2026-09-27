// Scenario 19a art — shaded hull primitives for the Concord's procedural fleet (concordFleet.ts: frigate, destroyer,
// battleship, construction ship, explorer, the Exchange space port). Not a port: the original has no such art.
//
// Technique: a HullCanvas is a supersampled G-buffer in "design units" (0‥1000 across the square, x right, y down =
// aft) holding a height field, coverage, albedo, a material id, an emissive layer and weathering sources (rust, soot).
// Builders stack volumes on it — rounded boxes, cylinders, domes, lofted spines, tori, bowls, plates — each written
// where it rises above what is already there (or added on top of it, or carved into it), so seams and overlaps come
// out of the height field rather than out of outlines. Detail passes (plate fields with bevelled seams and rivet rows,
// greebles, vents, radiator ribs, pipes, lamp gems) work on the same buffers. renderHull then lights it: normals from
// the height field, one key light from the top-left (the stock sprites' convention), horizon-based ambient occlusion
// and cast shadows marched through the height field, Blinn-Phong specular per material plus a ridge highlight on
// convex edges, a fine noise texture, grime in the concavities, chipped paint on the edges, rust streaks running aft
// from seams and rivets (a column scan), soot, and emissive gems / engine glow with a soft bloom. Coverage is binary
// (hard alpha edges); the caller downsamples. Pure and deterministic (own hash / RNG; never Math.random); no DOM.

export type Rgb = readonly [number, number, number];

export interface RgbaImageLike {
    w: number;
    h: number;
    data: Uint8ClampedArray;
}

// ---------------------------------------------------------------------------------------------------------------
// Palette and materials
// ---------------------------------------------------------------------------------------------------------------

/** Material ids (optics: specular strength / exponent, metal tint, paint that chips, rust propensity). */
export const M = {
    paint: 1,
    plate: 2,
    turq: 3,
    copper: 4,
    gun: 5,
    glass: 6,
    gold: 7,
    lamp: 8,
    nozzle: 9,
    bare: 10,
    cargo: 11,
} as const;

interface Optics {
    spec: number;
    shin: number;
    metal: number;
    chip: number;
    rust: number;
    ridge: number;
}

const OPTICS: readonly Optics[] = [
    { spec: 0, shin: 1, metal: 0, chip: 0, rust: 0, ridge: 0 },
    { spec: 0.22, shin: 18, metal: 0.1, chip: 1, rust: 1, ridge: 1 }, // paint (naval grey)
    { spec: 0.3, shin: 24, metal: 0.3, chip: 0.6, rust: 1.1, ridge: 1 }, // plate (dark steel)
    { spec: 0.4, shin: 40, metal: 0.2, chip: 0.8, rust: 0.6, ridge: 0.9 }, // turquoise panel (enamel)
    { spec: 0.75, shin: 34, metal: 0.9, chip: 0, rust: 0.2, ridge: 1.3 }, // copper
    { spec: 0.45, shin: 30, metal: 0.6, chip: 0, rust: 0.7, ridge: 1.1 }, // gunmetal
    { spec: 0.9, shin: 90, metal: 0, chip: 0, rust: 0, ridge: 0.6 }, // glass
    { spec: 0.95, shin: 28, metal: 1, chip: 0, rust: 0.05, ridge: 1.4 }, // gilding
    { spec: 0.6, shin: 60, metal: 0, chip: 0, rust: 0, ridge: 0.3 }, // lamp gem
    { spec: 0.2, shin: 16, metal: 0.5, chip: 0, rust: 0.3, ridge: 0.8 }, // nozzle
    { spec: 0.55, shin: 26, metal: 0.8, chip: 0, rust: 1.2, ridge: 1.2 }, // bare metal
    { spec: 0.2, shin: 14, metal: 0, chip: 1, rust: 1.3, ridge: 0.8 }, // cargo paint
];

export interface Surf {
    c: Rgb;
    m: number;
}

export const NAVAL: Surf = { c: [0.4, 0.43, 0.44], m: M.paint };
export const NAVAL_LIGHT: Surf = { c: [0.49, 0.51, 0.51], m: M.paint };
export const NAVAL_DARK: Surf = { c: [0.29, 0.31, 0.33], m: M.plate };
export const STEEL: Surf = { c: [0.23, 0.24, 0.26], m: M.plate };
export const GUN: Surf = { c: [0.2, 0.21, 0.23], m: M.gun };
export const TURQ: Surf = { c: [0.07, 0.3, 0.3], m: M.turq };
export const TURQ_LIGHT: Surf = { c: [0.12, 0.4, 0.38], m: M.turq };
export const COPPER: Surf = { c: [0.66, 0.38, 0.19], m: M.copper };
export const COPPER_DARK: Surf = { c: [0.44, 0.24, 0.12], m: M.copper };
export const GOLD: Surf = { c: [0.74, 0.57, 0.26], m: M.gold };
export const GLASS: Surf = { c: [0.06, 0.28, 0.3], m: M.glass };
export const NOZZLE_DARK: Surf = { c: [0.05, 0.05, 0.06], m: M.nozzle };
export const NOZZLE: Surf = { c: [0.13, 0.13, 0.15], m: M.nozzle };
export const BARE: Surf = { c: [0.56, 0.56, 0.54], m: M.bare };
export const RUST_C: Rgb = [0.42, 0.19, 0.07];
export const LAMP_TURQ: Rgb = [0.35, 1, 0.9];
export const ENGINE_BLUE: Rgb = [0.35, 0.6, 1];
export const LAMP_WARM: Rgb = [1, 0.75, 0.4];

// ---------------------------------------------------------------------------------------------------------------
// Deterministic noise
// ---------------------------------------------------------------------------------------------------------------

/** Own deterministic RNG (mulberry32). */
export function hullRng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function hashI(ix: number, iy: number, seed: number): number {
    let h = (ix * 374761393 + iy * 668265263 + seed * 144269504) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

/** A deterministic tone in [0, 1) from two numbers (per-part variation). */
export function hashTone(a: number, b: number): number {
    return hashI(Math.round(a * 7), Math.round(b * 13), 911);
}

/** Smooth value noise in [0, 1). */
export function noise2(x: number, y: number, seed: number): number {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    let fx = x - ix;
    let fy = y - iy;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const a = hashI(ix, iy, seed);
    const b = hashI(ix + 1, iy, seed);
    const c = hashI(ix, iy + 1, seed);
    const e = hashI(ix + 1, iy + 1, seed);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + e) * fx * fy;
}

/** Three-octave fbm centred on 0 (≈ ±0.5). */
export function fbm(x: number, y: number, seed: number): number {
    return noise2(x, y, seed) * 0.5 + noise2(x * 2.03, y * 2.03, seed + 7) * 0.3 + noise2(x * 4.1, y * 4.1, seed + 13) * 0.2 - 0.5;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (e0: number, e1: number, x: number): number => {
    const t = clamp01((x - e0) / (e1 - e0));
    return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------------------------------------------------------
// Canvas
// ---------------------------------------------------------------------------------------------------------------

/** Design units across the square. */
export const U = 1000;
/** The vertical axis every Concord hull is symmetric about. */
export const CX = U / 2;

export class HullCanvas {
    /** Pixels per design unit. */
    readonly k: number;
    readonly hgt: Float32Array;
    readonly cov: Uint8Array;
    readonly alb: Float32Array;
    readonly mat: Uint8Array;
    readonly emi: Float32Array;
    /** Rust sources (streaks run aft from them) and soot. */
    readonly rust: Float32Array;
    readonly soot: Float32Array;
    constructor(readonly n: number) {
        this.k = n / U;
        const nn = n * n;
        this.hgt = new Float32Array(nn);
        this.cov = new Uint8Array(nn);
        this.alb = new Float32Array(nn * 3);
        this.mat = new Uint8Array(nn);
        this.emi = new Float32Array(nn * 3);
        this.rust = new Float32Array(nn);
        this.soot = new Float32Array(nn);
    }

    /** Visit the pixels whose centres fall inside the unit box: cb(i, x, y) with x, y in units. */
    each(x0: number, y0: number, x1: number, y1: number, cb: (i: number, x: number, y: number) => void): void {
        const { n, k } = this;
        const i0 = Math.max(0, Math.floor(x0 * k - 0.5));
        const i1 = Math.min(n - 1, Math.ceil(x1 * k));
        const j0 = Math.max(0, Math.floor(y0 * k - 0.5));
        const j1 = Math.min(n - 1, Math.ceil(y1 * k));
        for (let j = j0; j <= j1; j++) {
            const y = (j + 0.5) / k;
            for (let i = i0; i <= i1; i++) cb(j * n + i, (i + 0.5) / k, y);
        }
    }

    setSurf(i: number, s: Surf): void {
        this.alb[i * 3] = s.c[0];
        this.alb[i * 3 + 1] = s.c[1];
        this.alb[i * 3 + 2] = s.c[2];
        this.mat[i] = s.m;
        this.emi[i * 3] = 0;
        this.emi[i * 3 + 1] = 0;
        this.emi[i * 3 + 2] = 0;
    }

    tint(i: number, c: Rgb, t: number): void {
        for (let ch = 0; ch < 3; ch++) this.alb[i * 3 + ch] += (c[ch] - this.alb[i * 3 + ch]) * t;
    }

    mul(i: number, f: number): void {
        this.alb[i * 3] *= f;
        this.alb[i * 3 + 1] *= f;
        this.alb[i * 3 + 2] *= f;
    }

    /** Height at a unit point (0 off the hull or the canvas). */
    heightAt(x: number, y: number): number {
        const i = Math.floor(x * this.k);
        const j = Math.floor(y * this.k);
        if (i < 0 || j < 0 || i >= this.n || j >= this.n) return 0;
        return this.hgt[j * this.n + i];
    }
}

/** Run `f` for the starboard side (+1) and its mirror to port (−1). */
export function both(f: (s: 1 | -1) => void): void {
    f(1);
    f(-1);
}

// ---------------------------------------------------------------------------------------------------------------
// Shapes (signed distance in units, negative inside) and the generic volume
// ---------------------------------------------------------------------------------------------------------------

export interface Shape {
    d: (x: number, y: number) => number;
    box: readonly [number, number, number, number];
}

export function boxShape(cx: number, cy: number, hx: number, hy: number, r = 0): Shape {
    const rr = Math.min(r, hx, hy);
    return {
        d: (x, y) => {
            const qx = Math.abs(x - cx) - (hx - rr);
            const qy = Math.abs(y - cy) - (hy - rr);
            return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rr;
        },
        box: [cx - hx, cy - hy, cx + hx, cy + hy],
    };
}

export function circleShape(cx: number, cy: number, r: number): Shape {
    return { d: (x, y) => Math.hypot(x - cx, y - cy) - r, box: [cx - r, cy - r, cx + r, cy + r] };
}

export function ellipseShape(cx: number, cy: number, a: number, b: number): Shape {
    const m = Math.min(a, b);
    return { d: (x, y) => (Math.hypot((x - cx) / a, (y - cy) / b) - 1) * m, box: [cx - a, cy - b, cx + a, cy + b] };
}

function segDist(x: number, y: number, x0: number, y0: number, x1: number, y1: number): number {
    const vx = x1 - x0;
    const vy = y1 - y0;
    const t = clamp01(((x - x0) * vx + (y - y0) * vy) / (vx * vx + vy * vy || 1));
    return Math.hypot(x - (x0 + vx * t), y - (y0 + vy * t));
}

export function capsuleShape(x0: number, y0: number, x1: number, y1: number, r: number): Shape {
    return {
        d: (x, y) => segDist(x, y, x0, y0, x1, y1) - r,
        box: [Math.min(x0, x1) - r, Math.min(y0, y1) - r, Math.max(x0, x1) + r, Math.max(y0, y1) + r],
    };
}

export function ringShape(cx: number, cy: number, R: number, w: number): Shape {
    return { d: (x, y) => Math.abs(Math.hypot(x - cx, y - cy) - R) - w, box: [cx - R - w, cy - R - w, cx + R + w, cy + R + w] };
}

/** Convex or concave polygon (points in order). */
export function polyShape(pts: readonly (readonly [number, number])[]): Shape {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [x, y] of pts) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
    }
    return {
        d: (x, y) => {
            let d = Infinity;
            let inside = false;
            for (let a = 0, b = pts.length - 1; a < pts.length; b = a++) {
                const [ax, ay] = pts[a];
                const [bx, by] = pts[b];
                d = Math.min(d, segDist(x, y, ax, ay, bx, by));
                if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
            }
            return inside ? -d : d;
        },
        box: [x0, y0, x1, y1],
    };
}

/** An oriented rectangle along a segment (half-width w). */
export function barShape(x0: number, y0: number, x1: number, y1: number, w: number): Shape {
    const L = Math.hypot(x1 - x0, y1 - y0) || 1;
    const ux = (x1 - x0) / L;
    const uy = (y1 - y0) / L;
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    return {
        d: (x, y) => {
            const px = x - mx;
            const py = y - my;
            const a = Math.abs(px * ux + py * uy) - L / 2;
            const b = Math.abs(-px * uy + py * ux) - w;
            return Math.hypot(Math.max(a, 0), Math.max(b, 0)) + Math.min(Math.max(a, b), 0);
        },
        box: [Math.min(x0, x1) - w, Math.min(y0, y1) - w, Math.max(x0, x1) + w, Math.max(y0, y1) + w],
    };
}

export function mirrorShape(s: Shape): Shape {
    return { d: (x, y) => s.d(U - x, y), box: [U - s.box[2], s.box[1], U - s.box[0], s.box[3]] };
}

export function unionShape(...ss: Shape[]): Shape {
    return {
        d: (x, y) => {
            let d = Infinity;
            for (const s of ss) d = Math.min(d, s.d(x, y));
            return d;
        },
        box: [Math.min(...ss.map((s) => s.box[0])), Math.min(...ss.map((s) => s.box[1])), Math.max(...ss.map((s) => s.box[2])), Math.max(...ss.map((s) => s.box[3]))],
    };
}

export type Profile = 'round' | 'chamfer' | 'flat' | 'ogee';
/**
 * How a volume meets what is under it: 'max' writes where it rises above the existing height (stacked volumes),
 * 'add' raises the existing surface by its profile (a plate following a curved hull), 'over' paints its own height
 * regardless (a part sitting in a recess).
 */
export type Mode = 'max' | 'add' | 'over';

export interface VolOpts {
    /** Base height (units). */
    z?: number;
    /** Height of the profile above the base. */
    h: number;
    /** Width of the edge roll-off (units). */
    bevel: number;
    prof?: Profile;
    s: Surf;
    mode?: Mode;
    /** Only where the canvas is already covered (plates / decals). */
    onHull?: boolean;
    /** Width of the dark seam cut into the surface just outside the outline, where this volume sits over another. */
    seam?: number;
}

function profile(p: Profile, t: number): number {
    switch (p) {
        case 'round':
            return Math.sqrt(1 - (1 - t) * (1 - t));
        case 'chamfer':
            return t;
        case 'flat':
            return 1;
        case 'ogee':
            return t * t * (3 - 2 * t);
    }
}

export function volume(cv: HullCanvas, sh: Shape, o: VolOpts): void {
    const z = o.z ?? 0;
    const prof = o.prof ?? 'round';
    const mode = o.mode ?? 'max';
    const [bx0, by0, bx1, by1] = sh.box;
    cv.each(bx0, by0, bx1, by1, (i, x, y) => {
        const d = sh.d(x, y);
        if (d > 0) return;
        if (o.onHull && cv.cov[i] === 0) return;
        const t = o.bevel > 0 ? Math.min(1, -d / o.bevel) : 1;
        const p = profile(prof, t);
        let H: number;
        if (mode === 'add') H = (cv.cov[i] ? cv.hgt[i] : 0) + z + o.h * p;
        else H = z + o.h * p;
        if (mode === 'max' && cv.cov[i] && H <= cv.hgt[i]) return;
        cv.hgt[i] = H;
        cv.cov[i] = 1;
        cv.setSurf(i, o.s);
    });
    const seam = o.seam ?? (mode === 'max' && !o.onHull ? 1.8 : 0);
    if (seam > 0) {
        cv.each(bx0 - seam, by0 - seam, bx1 + seam, by1 + seam, (i, x, y) => {
            if (!cv.cov[i]) return;
            const d = sh.d(x, y);
            if (d <= 0 || d > seam) return;
            const t = 1 - d / seam;
            if (cv.hgt[i] > z + o.h * 0.6) return;
            cv.hgt[i] -= 1.2 * t;
            cv.mul(i, 1 - 0.45 * t);
        });
    }
}

/** Lower the surface inside a shape by `depth` (bevelled walls); optionally repaint the floor. */
export function carve(cv: HullCanvas, sh: Shape, depth: number, bevel: number, floor?: Surf, darken = 0.25): void {
    const [bx0, by0, bx1, by1] = sh.box;
    cv.each(bx0, by0, bx1, by1, (i, x, y) => {
        if (!cv.cov[i]) return;
        const d = sh.d(x, y);
        if (d > 0) return;
        const t = bevel > 0 ? Math.min(1, -d / bevel) : 1;
        cv.hgt[i] -= depth * t;
        if (floor !== undefined && t >= 1) cv.setSurf(i, floor);
        if (darken > 0) cv.mul(i, 1 - darken * t);
    });
}

/** Cut a hole through the hull (coverage off) — open frames, gaps between docking arms. */
export function cut(cv: HullCanvas, sh: Shape): void {
    const [bx0, by0, bx1, by1] = sh.box;
    cv.each(bx0, by0, bx1, by1, (i, x, y) => {
        if (sh.d(x, y) > 0) return;
        cv.cov[i] = 0;
        cv.hgt[i] = 0;
        cv.mat[i] = 0;
    });
}

// ---------------------------------------------------------------------------------------------------------------
// Volumes
// ---------------------------------------------------------------------------------------------------------------

export function shadedBox(cv: HullCanvas, cx: number, cy: number, hx: number, hy: number, o: VolOpts & { r?: number }): void {
    volume(cv, boxShape(cx, cy, hx, hy, o.r ?? 0), o);
}

/**
 * A cylinder lying in the image plane from (x0, y0) to (x1, y1), radius r: round cross-section (height z + r·hk at the
 * axis), flat or domed caps.
 */
export function shadedCylinder(
    cv: HullCanvas,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    r: number,
    o: { z?: number; hk?: number; s: Surf; caps?: 'flat' | 'round'; mode?: Mode; bands?: number; bandSurf?: Surf },
): void {
    const z = o.z ?? 0;
    const hk = o.hk ?? 1;
    const L = Math.hypot(x1 - x0, y1 - y0) || 1;
    const ux = (x1 - x0) / L;
    const uy = (y1 - y0) / L;
    const round = o.caps === 'round';
    const mode = o.mode ?? 'max';
    cv.each(Math.min(x0, x1) - r, Math.min(y0, y1) - r, Math.max(x0, x1) + r, Math.max(y0, y1) + r, (i, x, y) => {
        const px = x - x0;
        const py = y - y0;
        const along = px * ux + py * uy;
        const across = Math.abs(-px * uy + py * ux);
        let d: number;
        if (along < 0 || along > L) {
            if (!round) return;
            const ea = along < 0 ? -along : along - L;
            d = Math.hypot(ea, across);
        } else d = across;
        if (d > r) return;
        const H = (mode === 'add' && cv.cov[i] ? cv.hgt[i] : 0) + z + r * hk * Math.sqrt(1 - (d / r) ** 2);
        if (mode === 'max' && cv.cov[i] && H <= cv.hgt[i]) return;
        cv.hgt[i] = H;
        cv.cov[i] = 1;
        let s = o.s;
        if (o.bands !== undefined && o.bandSurf !== undefined && along >= 0 && along <= L) {
            // Evenly spaced collar bands along the cylinder.
            const f = (along / L) * o.bands;
            const fr = f - Math.floor(f);
            if (fr < 0.08 || fr > 0.92) s = o.bandSurf;
        }
        cv.setSurf(i, s);
    });
}

export function dome(cv: HullCanvas, cx: number, cy: number, r: number, o: { z?: number; h?: number; s: Surf; mode?: Mode }): void {
    volume(cv, circleShape(cx, cy, r), { z: o.z, h: o.h ?? r, bevel: r, prof: 'round', s: o.s, mode: o.mode });
}

/** A torus lying flat: tube of half-width w around radius R. */
export function torus(cv: HullCanvas, cx: number, cy: number, R: number, w: number, o: { z?: number; h?: number; s: Surf; mode?: Mode }): void {
    volume(cv, ringShape(cx, cy, R, w), { z: o.z, h: o.h ?? w, bevel: w, prof: 'round', s: o.s, mode: o.mode });
}

/**
 * A lofted spine along the vertical axis from y0 (fore) to y1 (aft): half-width hw(t) and crown height ht(t) for t in
 * 0‥1, superelliptic cross-section (pow 2 = round, higher = boxier).
 */
export function loft(
    cv: HullCanvas,
    o: { cx?: number; y0: number; y1: number; hw: (t: number) => number; ht: (t: number) => number; pow?: number; z?: number; s: Surf; mode?: Mode },
): void {
    const cx = o.cx ?? CX;
    const pow = o.pow ?? 2;
    const z = o.z ?? 0;
    let maxW = 0;
    for (let t = 0; t <= 1; t += 0.01) maxW = Math.max(maxW, o.hw(t));
    cv.each(cx - maxW, o.y0, cx + maxW, o.y1, (i, x, y) => {
        const t = (y - o.y0) / (o.y1 - o.y0);
        if (t < 0 || t > 1) return;
        const w = o.hw(t);
        if (w <= 0) return;
        const u = Math.abs(x - cx) / w;
        if (u > 1) return;
        const H = (o.mode === 'add' && cv.cov[i] ? cv.hgt[i] : 0) + z + o.ht(t) * Math.pow(1 - Math.pow(u, pow), 1 / pow);
        if ((o.mode ?? 'max') === 'max' && cv.cov[i] && H <= cv.hgt[i]) return;
        cv.hgt[i] = H;
        cv.cov[i] = 1;
        cv.setSurf(i, o.s);
    });
}

/** A concave dish: rim ring at z + h, bowl down to z at the centre. */
export function bowl(cv: HullCanvas, cx: number, cy: number, r: number, o: { z?: number; h: number; s: Surf; rim: Surf }): void {
    const z = o.z ?? 0;
    cv.each(cx - r, cy - r, cx + r, cy + r, (i, x, y) => {
        const d = Math.hypot(x - cx, y - cy) / r;
        if (d > 1) return;
        const rim = d > 0.9;
        const H = rim ? z + o.h + o.h * 0.25 * Math.sin(((d - 0.9) / 0.1) * Math.PI) : z + o.h * d * d;
        cv.hgt[i] = H;
        cv.cov[i] = 1;
        cv.setSurf(i, rim ? o.rim : o.s);
    });
}

// ---------------------------------------------------------------------------------------------------------------
// Detail passes
// ---------------------------------------------------------------------------------------------------------------

/**
 * Plating over existing hull inside a box: staggered plates (mirrored about the axis), each with its own slight tone
 * and height offset, bevelled seams, rivet rows along the seams and rust sources at some seam corners. `mats` limits it
 * to the given materials.
 */
export function plateField(
    cv: HullCanvas,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    o: { pw: number; ph: number; seed: number; mats: readonly number[]; seam?: number; rivet?: number; tone?: number; rust?: number; ox?: number; oy?: number },
): void {
    const seam = o.seam ?? 1.6;
    const rivet = o.rivet ?? 0;
    const tone = o.tone ?? 0.07;
    const rustK = o.rust ?? 0.35;
    const mats = new Set(o.mats);
    const ox = o.ox ?? 0;
    const oy = o.oy ?? 0;
    cv.each(x0, y0, x1, y1, (i, x, y) => {
        if (!cv.cov[i] || !mats.has(cv.mat[i])) return;
        const ax = Math.abs(x - CX) + ox;
        const fy = (y - oy) / o.ph;
        const row = Math.floor(fy);
        const rw = o.pw * (0.7 + 0.8 * hashI(row, 3, o.seed + 5));
        const fx = ax / rw + hashI(row, 9, o.seed + 6);
        const col = Math.floor(fx);
        const ex = Math.min(fx - col, 1 - (fx - col)) * rw;
        const ey = Math.min(fy - row, 1 - (fy - row)) * o.ph;
        const e = Math.min(ex, ey);
        const hr = hashI(col, row, o.seed);
        // Per-plate tone and slight warp.
        cv.mul(i, 1 - tone + 2 * tone * hr);
        cv.hgt[i] += (hr - 0.5) * 0.5;
        if (hr > 0.86) cv.tint(i, [0.4, 0.4, 0.38], 0.18); // a replaced plate
        if (e < seam) {
            const t = 1 - e / seam;
            cv.hgt[i] -= 0.8 * t;
            cv.mul(i, 1 - 0.14 * t);
            // Rust weeps from a few short stretches of seam (streaks then run aft from them).
            const cell = Math.floor((ex < ey ? y : ax) / 7);
            if (hashI(cell, row * 31 + col, o.seed + 1) < rustK * 0.16) cv.rust[i] = Math.max(cv.rust[i], 0.7 * t);
        } else if (rivet > 0 && e < seam + rivet * 3.2) {
            // Rivets in a row just inside the seam.
            const along = ex < ey ? y : ax;
            const ph = along / (rivet * 3.4);
            const dAl = (ph - Math.round(ph)) * rivet * 3.4;
            const dAc = e - (seam + rivet * 1.6);
            const rr = Math.hypot(dAl, dAc);
            if (rr < rivet) {
                cv.hgt[i] += 0.9 * Math.sqrt(1 - (rr / rivet) ** 2);
                if (hashI(Math.round(ph), row + col * 17, o.seed + 3) < rustK * 0.12) cv.rust[i] = Math.max(cv.rust[i], 0.45);
            }
        }
    });
}

/** A row of rivets (small domes added on the surface). */
export function rivetRow(cv: HullCanvas, x0: number, y0: number, x1: number, y1: number, step: number, r: number, s?: Surf): void {
    const L = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(1, Math.floor(L / step));
    for (let k = 0; k <= n; k++) {
        const x = x0 + ((x1 - x0) * k) / n;
        const y = y0 + ((y1 - y0) * k) / n;
        cv.each(x - r, y - r, x + r, y + r, (i, px, py) => {
            if (!cv.cov[i]) return;
            const d = Math.hypot(px - x, py - y) / r;
            if (d > 1) return;
            cv.hgt[i] += r * 0.55 * Math.sqrt(1 - d * d);
            if (s !== undefined) cv.setSurf(i, s);
        });
    }
}

/** Parallel vent slots (carved, dark) in a box; slots run across `dir` ('x': slots horizontal). */
export function vents(cv: HullCanvas, cx: number, cy: number, hx: number, hy: number, n: number, dir: 'x' | 'y' = 'x'): void {
    for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        if (dir === 'x') carve(cv, boxShape(cx, cy - hy + 2 * hy * t, hx, (hy / n) * 0.32, 1), 2.2, 0.8, undefined, 0.55);
        else carve(cv, boxShape(cx - hx + 2 * hx * t, cy, (hx / n) * 0.32, hy, 1), 2.2, 0.8, undefined, 0.55);
    }
}

/** Radiator: a panel of n parallel ribs (little cylinders) along the long side of the box, in a dark frame. */
export function radiator(cv: HullCanvas, cx: number, cy: number, hx: number, hy: number, n: number, o: { z?: number; s: Surf; frame: Surf; dir?: 'x' | 'y' }): void {
    const z = o.z ?? 0;
    shadedBox(cv, cx, cy, hx, hy, { z, h: 3, bevel: 2.5, prof: 'chamfer', s: o.frame, r: 2 });
    const along = o.dir ?? (hx > hy ? 'x' : 'y');
    const span = along === 'x' ? hy : hx;
    const w = (span * 2 - 4) / n / 2;
    for (let k = 0; k < n; k++) {
        const off = -span + 2 + w * (2 * k + 1);
        if (along === 'x') shadedCylinder(cv, cx - hx + 3, cy + off, cx + hx - 3, cy + off, w * 0.92, { z: z + 2, hk: 0.9, s: o.s });
        else shadedCylinder(cv, cx + off, cy - hy + 3, cx + off, cy + hy - 3, w * 0.92, { z: z + 2, hk: 0.9, s: o.s });
    }
}

/**
 * A comb of n ribs (radiator fins / cooling vanes) along the segment (x0, y0)–(x1, y1), each sticking out `len` along
 * the outward normal (side +1 = the segment's right-hand normal, −1 = left), round cross-section r.
 */
export function ribs(cv: HullCanvas, x0: number, y0: number, x1: number, y1: number, n: number, len: number, r: number, side: 1 | -1, o: { z?: number; s: Surf; tip?: Surf }): void {
    const L = Math.hypot(x1 - x0, y1 - y0) || 1;
    const nx = (-(y1 - y0) / L) * side;
    const ny = ((x1 - x0) / L) * side;
    for (let k = 0; k < n; k++) {
        const t = n === 1 ? 0.5 : k / (n - 1);
        const bx = x0 + (x1 - x0) * t;
        const by = y0 + (y1 - y0) * t;
        shadedCylinder(cv, bx, by, bx + nx * len, by + ny * len, r, { z: o.z, s: o.s, caps: 'round' });
        if (o.tip !== undefined) dome(cv, bx + nx * len, by + ny * len, r * 1.2, { z: o.z, h: r * 1.1, s: o.tip });
    }
}

/** A pipe along a polyline with collars at the joints. */
export function pipe(cv: HullCanvas, pts: readonly (readonly [number, number])[], r: number, o: { z?: number; s: Surf; collar?: Surf }): void {
    for (let k = 0; k + 1 < pts.length; k++) shadedCylinder(cv, pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1], r, { z: o.z, s: o.s, caps: 'round' });
    if (o.collar !== undefined) for (const [x, y] of pts) dome(cv, x, y, r * 1.35, { z: o.z, h: r * 1.2, s: o.collar });
}

/** Small raised boxes / domes scattered over a region (mirrored pairs) on the given materials. */
export function greebles(
    cv: HullCanvas,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    n: number,
    o: { seed: number; size: number; mats: readonly number[]; s: Surf; alt?: Surf; h?: number },
): void {
    const rng = hullRng(o.seed);
    const mats = new Set(o.mats);
    for (let k = 0; k < n; k++) {
        const x = x0 + (x1 - x0) * rng();
        const y = y0 + (y1 - y0) * rng();
        const hx = o.size * (0.4 + rng() * 0.8);
        const hy = o.size * (0.4 + rng() * 0.8);
        const kind = rng();
        const s = o.alt !== undefined && rng() < 0.35 ? o.alt : o.s;
        const h = (o.h ?? o.size * 0.6) * (0.6 + rng() * 0.6);
        for (const sx of [x, U - x]) {
            const i = Math.floor(y * cv.k) * cv.n + Math.floor(sx * cv.k);
            if (i < 0 || i >= cv.cov.length || !cv.cov[i] || !mats.has(cv.mat[i])) continue;
            const base = cv.hgt[i];
            if (kind < 0.6) shadedBox(cv, sx, y, hx, hy, { z: base, h, bevel: Math.min(hx, hy) * 0.5, prof: 'chamfer', s, r: 1 });
            else dome(cv, sx, y, Math.min(hx, hy), { z: base, h: h * 0.8, s });
        }
    }
}

/** A glowing lamp gem: a small glass dome with an emissive core (bloom added by renderHull). */
export function glowLamp(cv: HullCanvas, x: number, y: number, r: number, c: Rgb = LAMP_TURQ, power = 1): void {
    const base = cv.heightAt(x, y);
    // Copper bezel, then the gem.
    dome(cv, x, y, r * 1.45, { z: base, h: r * 0.5, s: COPPER_DARK, mode: 'over' });
    cv.each(x - r, y - r, x + r, y + r, (i, px, py) => {
        const d = Math.hypot(px - x, py - y) / r;
        if (d > 1) return;
        cv.hgt[i] = base + r * 0.5 + r * 0.6 * Math.sqrt(1 - d * d);
        cv.cov[i] = 1;
        cv.setSurf(i, { c: [c[0] * 0.3, c[1] * 0.3, c[2] * 0.3], m: M.lamp });
        const e = power * (0.55 + 0.45 * (1 - d * d));
        cv.emi[i * 3] = c[0] * e;
        cv.emi[i * 3 + 1] = c[1] * e;
        cv.emi[i * 3 + 2] = c[2] * e;
    });
}

/** Emissive paint (window strips, glow in an engine throat) without changing the geometry. */
export function emissive(cv: HullCanvas, sh: Shape, c: Rgb, power: number, falloff = 0): void {
    const [bx0, by0, bx1, by1] = sh.box;
    cv.each(bx0, by0, bx1, by1, (i, x, y) => {
        if (!cv.cov[i]) return;
        const d = sh.d(x, y);
        if (d > 0) return;
        const e = power * (falloff > 0 ? Math.min(1, -d / falloff) : 1);
        cv.emi[i * 3] = Math.max(cv.emi[i * 3], c[0] * e);
        cv.emi[i * 3 + 1] = Math.max(cv.emi[i * 3 + 1], c[1] * e);
        cv.emi[i * 3 + 2] = Math.max(cv.emi[i * 3 + 2], c[2] * e);
    });
}

/** Paint a region with another surface without changing its height (trim bands, panels). */
export function paint(cv: HullCanvas, sh: Shape, s: Surf, onlyMats?: readonly number[]): void {
    const mats = onlyMats === undefined ? null : new Set(onlyMats);
    const [bx0, by0, bx1, by1] = sh.box;
    cv.each(bx0, by0, bx1, by1, (i, x, y) => {
        if (!cv.cov[i] || sh.d(x, y) > 0) return;
        if (mats !== null && !mats.has(cv.mat[i])) return;
        cv.setSurf(i, s);
    });
}

/** Mark rust / soot sources in a shape (strength 0‥1). */
export function stain(cv: HullCanvas, sh: Shape, kind: 'rust' | 'soot', k: number): void {
    const buf = kind === 'rust' ? cv.rust : cv.soot;
    const [bx0, by0, bx1, by1] = sh.box;
    cv.each(bx0, by0, bx1, by1, (i, x, y) => {
        const d = sh.d(x, y);
        if (d > 0 || !cv.cov[i]) return;
        buf[i] = Math.max(buf[i], k);
    });
}

/**
 * An engine bell lying along +y from y0 to y1 (aft), radius r: ribbed gunmetal housing, copper rim near the mouth,
 * a dark throat with blue glow at the aft end, soot around it.
 */
export function engineBell(cv: HullCanvas, x: number, y0: number, y1: number, r: number, o: { z?: number; glow?: number } = {}): void {
    const z = o.z ?? 0;
    shadedCylinder(cv, x, y0, x, y1, r, { z, s: GUN, bands: 5, bandSurf: STEEL });
    shadedCylinder(cv, x, y1 - r * 0.55, x, y1 - r * 0.2, r * 1.08, { z, s: COPPER });
    // Throat: the flared mouth seen from above (a darker, ribbed interior sliver), glowing at the lip.
    carve(cv, boxShape(x, y1 - r * 0.08, r * 0.62, r * 0.12, r * 0.1), r * 0.5, r * 0.2, NOZZLE, 0.1);
    emissive(cv, boxShape(x, y1 - r * 0.05, r * 0.55, r * 0.1, r * 0.08), ENGINE_BLUE, o.glow ?? 1.1, r * 0.05);
    stain(cv, boxShape(x, y1 - r * 0.9, r * 1.1, r * 0.4), 'soot', 0.35);
}

/**
 * A gun turret at (x, y): armoured ring, rotating housing (rounded, slightly longer fore than aft), `barrels` guns
 * pointing forward (−y), copper band and a lamp gem on the housing's rear.
 */
export function turret(cv: HullCanvas, x: number, y: number, r: number, o: { z?: number; barrels?: number; s?: Surf; len?: number }): void {
    const z = o.z ?? cv.heightAt(x, y);
    const n = o.barrels ?? 2;
    const s = o.s ?? NAVAL;
    torus(cv, x, y, r * 0.95, r * 0.14, { z, h: r * 0.12, s: STEEL });
    const len = o.len ?? r * 1.6;
    const bw = r * 0.13;
    for (let k = 0; k < n; k++) {
        const bx = x + (n === 1 ? 0 : (k - (n - 1) / 2) * r * 0.42);
        shadedCylinder(cv, bx, y - r * 0.2, bx, y - r * 0.2 - len, bw, { z: z + r * 0.3, s: GUN, caps: 'flat' });
        shadedCylinder(cv, bx, y - r * 0.2 - len * 0.9, bx, y - r * 0.2 - len, bw * 1.35, { z: z + r * 0.3, s: STEEL, caps: 'flat' });
        shadedCylinder(cv, bx, y - r * 0.6, bx, y - r * 0.95, bw * 1.3, { z: z + r * 0.3, s: COPPER_DARK, caps: 'flat' });
    }
    volume(cv, polyShape([
        [x - r * 0.62, y - r * 0.75],
        [x + r * 0.62, y - r * 0.75],
        [x + r * 0.85, y - r * 0.1],
        [x + r * 0.7, y + r * 0.7],
        [x - r * 0.7, y + r * 0.7],
        [x - r * 0.85, y - r * 0.1],
    ]), { z: z + r * 0.05, h: r * 0.55, bevel: r * 0.35, prof: 'round', s });
    volume(cv, boxShape(x, y + r * 0.2, r * 0.42, r * 0.28, r * 0.1), { z: z + r * 0.25, h: r * 0.38, bevel: r * 0.12, prof: 'chamfer', s: NAVAL_DARK, mode: 'max' });
    paint(cv, boxShape(x, y - r * 0.42, r * 0.9, r * 0.05), COPPER);
    glowLamp(cv, x, y + r * 0.2, r * 0.1);
}

// ---------------------------------------------------------------------------------------------------------------
// Lighting
// ---------------------------------------------------------------------------------------------------------------

function norm3(x: number, y: number, z: number): [number, number, number] {
    const l = Math.hypot(x, y, z) || 1;
    return [x / l, y / l, z / l];
}

/** Key light (image space: x right, y down, z out of the image): from the top-left and above. */
export const HULL_LIGHT = norm3(-0.45, -0.62, 0.55);

export interface RenderOpts {
    seed: number;
    /** Baked wear: grime, chips, rust streaks (0 = factory new). */
    wear: number;
    /** Rust streak length (units). */
    streak?: number;
}

/** Light the canvas: an RGBA image of side n (straight alpha, binary coverage). */
export function renderHull(cv: HullCanvas, o: RenderOpts): RgbaImageLike {
    const { n, k } = cv;
    const nn = n * n;
    const H = cv.hgt;
    const cov = cv.cov;
    const seed = o.seed;
    const wear = o.wear;
    // Fine surface grain in the height field (hammered plate).
    for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
            const p = j * n + i;
            if (!cov[p]) continue;
            const x = (i + 0.5) / k;
            const y = (j + 0.5) / k;
            H[p] += 0.35 * fbm(x * 0.35, y * 0.35, seed + 101);
        }
    }
    const h = (i: number, j: number): number => (i < 0 || j < 0 || i >= n || j >= n ? 0 : H[j * n + i]);
    // Ambient occlusion: horizon slope in 8 directions at 5 radii (units).
    const ao = new Float32Array(nn);
    const radii = [2, 5, 11, 22, 40].map((r) => Math.max(1, Math.round(r * k)));
    const dirs: [number, number][] = [];
    for (let d = 0; d < 8; d++) dirs.push([Math.cos((d * Math.PI) / 4 + 0.2), Math.sin((d * Math.PI) / 4 + 0.2)]);
    for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
            const p = j * n + i;
            if (!cov[p]) continue;
            const h0 = H[p];
            let occ = 0;
            for (const [dx, dy] of dirs) {
                let best = 0;
                for (const r of radii) {
                    const s = (h(Math.round(i + dx * r), Math.round(j + dy * r)) - h0) / (r / k);
                    if (s > best) best = s;
                }
                occ += best / Math.sqrt(1 + best * best);
            }
            ao[p] = 1 - Math.min(0.9, (occ / 8) * 1.7);
        }
    }
    // Cast shadows toward the light.
    const shadow = new Float32Array(nn);
    const lxy = Math.hypot(HULL_LIGHT[0], HULL_LIGHT[1]);
    const ldx = HULL_LIGHT[0] / lxy;
    const ldy = HULL_LIGHT[1] / lxy;
    const tanE = HULL_LIGHT[2] / lxy;
    const steps: number[] = [];
    for (let t = 1.5; t < 120; t *= 1.22) steps.push(t);
    for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
            const p = j * n + i;
            if (!cov[p]) continue;
            const h0 = H[p] + 0.4;
            let sh = 1;
            for (const t of steps) {
                const q = h(Math.round(i + ldx * t * k), Math.round(j + ldy * t * k));
                const above = q - (h0 + t * tanE);
                if (above > 0) sh = Math.min(sh, 1 - Math.min(1, above / (0.25 * t + 0.8)));
                if (sh <= 0) break;
            }
            shadow[p] = sh;
        }
    }
    // Weathering fields: rust streaks run aft (+y) from their sources; chips on convex edges; grime in concavities.
    const rustAmt = new Float32Array(nn);
    const streakPx = (o.streak ?? 45) * k;
    for (let i = 0; i < n; i++) {
        let carry = 0;
        const colN = noise2(i * 0.37, 0, seed + 5);
        const decay = Math.exp(-1 / (streakPx * (0.45 + 0.9 * colN)));
        for (let j = 0; j < n; j++) {
            const p = j * n + i;
            if (!cov[p]) {
                carry = 0;
                continue;
            }
            const optic = OPTICS[cv.mat[p]];
            const src = cv.rust[p] * wear;
            carry = Math.max(carry * decay, src);
            // Streaks break over steep drops (falling off a module edge) only partly.
            if (j > 0 && H[p] < H[p - n] - 6) carry *= 0.7;
            rustAmt[p] = carry * optic.rust;
        }
    }
    const out = new Uint8ClampedArray(nn * 4);
    const col = new Float32Array(nn * 3);
    const [LX, LY, LZ] = HULL_LIGHT;
    const HV = norm3(LX, LY, LZ + 1);
    const lapR = Math.max(1, Math.round(1.6 * k));
    for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
            const p = j * n + i;
            if (!cov[p]) continue;
            const x = (i + 0.5) / k;
            const y = (j + 0.5) / k;
            const optic = OPTICS[cv.mat[p]];
            // Normal (units): central differences.
            const dhx = (h(i + 1, j) - h(i - 1, j)) * (k / 2);
            const dhy = (h(i, j + 1) - h(i, j - 1)) * (k / 2);
            const [nx, ny, nz] = norm3(-dhx, -dhy, 1);
            // Curvature (convex < 0 → ridge highlight / chips; concave → grime).
            const lap = (h(i + lapR, j) + h(i - lapR, j) + h(i, j + lapR) + h(i, j - lapR) - 4 * H[p]) / ((lapR / k) * (lapR / k));
            const convex = Math.max(0, Math.min(1, -lap * 3));
            const concave = Math.max(0, Math.min(1, lap * 1.5));
            let r = cv.alb[p * 3];
            let g = cv.alb[p * 3 + 1];
            let b = cv.alb[p * 3 + 2];
            // Surface texture: mottled paint and fine grain.
            const mott = fbm(x * 0.045, y * 0.045, seed + 17);
            const grain = noise2(x * 0.9, y * 0.9, seed + 23) - 0.5;
            const tex = 1 + 0.16 * mott + 0.07 * grain;
            r *= tex;
            g *= tex;
            b *= tex;
            let spec = optic.spec;
            let shin = optic.shin;
            let metal = optic.metal;
            // Chipped paint: convex edges and random scuffs expose bare metal (with a dark primer rim).
            if (optic.chip > 0 && wear > 0) {
                const cn = noise2(x * 0.22, y * 0.22, seed + 31) * 0.7 + noise2(x * 0.9, y * 0.9, seed + 37) * 0.3;
                const edge = convex * 1.4 + smooth(0.78, 0.9, noise2(x * 0.05, y * 0.05, seed + 41)) * 0.5;
                const c = (cn + edge * 0.45) * optic.chip * Math.min(1.4, wear);
                if (c > 0.82) {
                    r = 0.55 + 0.05 * grain;
                    g = 0.55 + 0.05 * grain;
                    b = 0.53 + 0.05 * grain;
                    spec = 0.55;
                    shin = 26;
                    metal = 0.8;
                } else if (c > 0.76) {
                    r *= 0.6;
                    g *= 0.6;
                    b *= 0.6;
                }
            }
            // Rust streaks.
            const ra = Math.min(0.8, rustAmt[p] * (0.6 + 0.8 * noise2(x * 0.3, y * 0.08, seed + 43)));
            if (ra > 0.01) {
                const dark = noise2(x * 0.15, y * 0.15, seed + 47);
                const rc0 = 0.42 - 0.16 * dark;
                const rc1 = 0.19 - 0.08 * dark;
                const rc2 = 0.07 - 0.03 * dark;
                r += (rc0 - r) * ra;
                g += (rc1 - g) * ra;
                b += (rc2 - b) * ra;
                spec *= 1 - ra * 0.7;
            }
            // Patchy rust blooms on paint (old hull).
            if (optic.rust > 0 && wear > 0) {
                const bloom = smooth(0.68, 0.86, fbm(x * 0.03, y * 0.03, seed + 53) + 0.5) * 0.28 * wear * optic.rust * (0.5 + concave);
                if (bloom > 0.01) {
                    r += (0.36 - r) * bloom;
                    g += (0.17 - g) * bloom;
                    b += (0.07 - b) * bloom;
                }
            }
            // Grime in concavities and soot.
            const occl = ao[p];
            const grime = Math.min(0.75, ((1 - occl) * 0.9 + concave * 0.4) * (0.6 + 0.8 * (mott + 0.5)) * Math.min(1.3, wear));
            const soot = Math.min(0.85, cv.soot[p] * (0.7 + 0.6 * noise2(x * 0.12, y * 0.12, seed + 59)));
            const dirt = 1 - grime * 0.45 - soot * 0.7;
            r *= dirt;
            g *= dirt;
            b *= dirt;
            // Lighting.
            const ndl = nx * LX + ny * LY + nz * LZ;
            const diff = Math.max(0, ndl) * shadow[p];
            const sky = 0.5 + 0.5 * nz;
            const amb = (0.1 + 0.1 * sky) * occl * occl;
            const ndh = Math.max(0, nx * HV[0] + ny * HV[1] + nz * HV[2]);
            const sp = spec * Math.pow(ndh, shin) * shadow[p] * (1 - grime * 0.6);
            const ridge = optic.ridge * convex * 0.6 * Math.max(0, ndl - 0.25) * (0.3 + 0.7 * shadow[p]);
            const sr = 1 + (r * 2.2 - 1) * metal;
            const sg = 1 + (g * 2.2 - 1) * metal;
            const sb = 1 + (b * 2.2 - 1) * metal;
            const lit = amb + diff * 1.35;
            // Metals: darker diffuse, brighter tinted highlights.
            const dk = 1 - 0.35 * metal;
            col[p * 3] = r * lit * dk + (sp + ridge) * sr;
            col[p * 3 + 1] = g * lit * dk + (sp + ridge) * sg;
            col[p * 3 + 2] = b * lit * dk + (sp + ridge) * sb;
        }
    }
    // Emissive with a soft bloom (inside the hull only: the halo overlays add the outer glow).
    const bloom = blur3(cv.emi, n, Math.max(1, Math.round(3.5 * k)));
    for (let p = 0; p < nn; p++) {
        if (!cov[p]) continue;
        let r = col[p * 3] + cv.emi[p * 3] + bloom[p * 3] * 0.9;
        let g = col[p * 3 + 1] + cv.emi[p * 3 + 1] + bloom[p * 3 + 1] * 0.9;
        let b = col[p * 3 + 2] + cv.emi[p * 3 + 2] + bloom[p * 3 + 2] * 0.9;
        r = tone(r);
        g = tone(g);
        b = tone(b);
        out[p * 4] = Math.round(r * 255);
        out[p * 4 + 1] = Math.round(g * 255);
        out[p * 4 + 2] = Math.round(b * 255);
        out[p * 4 + 3] = 255;
    }
    return { w: n, h: n, data: out };
}

/** Soft shoulder above 0.75. */
function tone(v: number): number {
    if (v <= 0) return 0;
    if (v < 0.75) return v;
    return 0.75 + 0.25 * (1 - Math.exp(-(v - 0.75) / 0.25));
}

/** Two box-blur passes (≈ gaussian) of a 3-channel buffer. */
function blur3(src: Float32Array, n: number, r: number): Float32Array {
    let a = src;
    for (let pass = 0; pass < 2; pass++) {
        const tmp = new Float32Array(a.length);
        const inv = 1 / (2 * r + 1);
        for (let j = 0; j < n; j++) {
            for (let ch = 0; ch < 3; ch++) {
                let acc = 0;
                for (let i = -r; i <= r; i++) acc += i >= 0 && i < n ? a[(j * n + i) * 3 + ch] : 0;
                for (let i = 0; i < n; i++) {
                    tmp[(j * n + i) * 3 + ch] = acc * inv;
                    const add = i + r + 1;
                    const sub = i - r;
                    if (add < n) acc += a[(j * n + add) * 3 + ch];
                    if (sub >= 0) acc -= a[(j * n + sub) * 3 + ch];
                }
            }
        }
        const out = new Float32Array(a.length);
        for (let i = 0; i < n; i++) {
            for (let ch = 0; ch < 3; ch++) {
                let acc = 0;
                for (let j = -r; j <= r; j++) acc += j >= 0 && j < n ? tmp[(j * n + i) * 3 + ch] : 0;
                for (let j = 0; j < n; j++) {
                    out[(j * n + i) * 3 + ch] = acc * inv;
                    const add = j + r + 1;
                    const sub = j - r;
                    if (add < n) acc += tmp[(add * n + i) * 3 + ch];
                    if (sub >= 0) acc -= tmp[(sub * n + i) * 3 + ch];
                }
            }
        }
        a = out;
    }
    return a;
}
