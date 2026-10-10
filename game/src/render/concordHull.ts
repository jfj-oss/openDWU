// Scenario 19a art — the biomech canvas of the Oranthi Concord's procedural fleet (concordFleet.ts builds every kind on
// it). Not a port: the original has no such art.
//
// Look: giant insects, cybernetically augmented. Glossy black chitin with an iridescent oil-slick sheen (dark violet,
// magenta, pink; the hue shifts with the surface's slope and a per-plate film thickness, so curved carapaces sweep
// through the colours), dark purple / deep pink plate margins, fine growth lines and pores; soft parts (joints, brood
// sacs, intersegmental membranes) in dark wet flesh; grafted gunmetal armour plates bolted into the shell, cable and
// tube bundles along the segments, mechanical engine pods fused onto the abdomen and implanted sensor clusters, with
// glowing pink-violet seams wherever flesh meets machine (a separate emission layer the overlay pulses).
//
// Technique: a BioCanvas is a supersampled G-buffer in "design units" (0‥1000 across the square, x right, y down =
// aft) holding a height field, coverage, albedo, a material id, a thin-film phase (the iridescence offset), a steady
// emissive layer (eyes, lamps, engine throats) and the pulsing seam layer. Builders stack volumes on it — lofted body
// segments with overlapping shingle plates, tapered tubes (legs, mandibles, antennae, cables), domes (compound eyes,
// sensor domes), wing membranes, honeycomb, grafted plates — each written where it rises above what is there (or added
// on top of it, or carved into it), so overlaps and seams come out of the height field. renderBio then lights it:
// normals from the height field, one key light from the top-left (the stock sprites' convention), horizon-based
// ambient occlusion and cast shadows marched through the height field, a Blinn specular per material whose colour is
// the thin-film hue for chitin (plus a broad sheen lobe and a slope-dependent rim, the oil-slick), tinted highlights on
// metal, and the emissive layers with a soft bloom. Coverage is binary (hard alpha edges); the caller downsamples. Pure
// and deterministic (own hash / RNG; never Math.random or galaxy.rnd); no DOM.

export type Rgb = readonly [number, number, number];

export interface RgbaImageLike {
    w: number;
    h: number;
    data: Uint8ClampedArray;
}

// ---------------------------------------------------------------------------------------------------------------
// Palette and materials
// ---------------------------------------------------------------------------------------------------------------

/** Material ids. */
export const M = {
    chitin: 1,
    margin: 2,
    membrane: 3,
    flesh: 4,
    graft: 5,
    steel: 6,
    cable: 7,
    eye: 8,
    lamp: 9,
    nozzle: 10,
    comb: 11,
} as const;

interface Optics {
    /** Specular strength / exponent. */
    spec: number;
    shin: number;
    /** Metal: darker diffuse, highlights tinted by the albedo. */
    metal: number;
    /** Thin-film iridescence weight (the specular and sheen take the film hue). */
    iri: number;
    /** Broad sheen lobe and slope rim (the oil-slick wash over the black). */
    sheen: number;
    /** Highlight on convex edges. */
    ridge: number;
}

const OPTICS: readonly Optics[] = [
    { spec: 0, shin: 1, metal: 0, iri: 0, sheen: 0, ridge: 0 },
    { spec: 0.7, shin: 46, metal: 0, iri: 1, sheen: 1, ridge: 0.55 }, // chitin
    { spec: 0.6, shin: 34, metal: 0, iri: 0.85, sheen: 0.8, ridge: 0.5 }, // plate margin
    { spec: 0.35, shin: 24, metal: 0, iri: 0.7, sheen: 0.45, ridge: 0.2 }, // wing / membrane
    { spec: 0.45, shin: 20, metal: 0, iri: 0.15, sheen: 0.2, ridge: 0.15 }, // wet flesh
    { spec: 0.5, shin: 30, metal: 0.75, iri: 0, sheen: 0, ridge: 1.2 }, // grafted gunmetal
    { spec: 0.35, shin: 22, metal: 0.55, iri: 0, sheen: 0, ridge: 0.9 }, // dark steel (bolts, clamps, nozzles)
    { spec: 0.3, shin: 14, metal: 0.1, iri: 0.1, sheen: 0.1, ridge: 0.4 }, // cable sheath
    { spec: 1.0, shin: 80, metal: 0, iri: 0.75, sheen: 0.6, ridge: 0.3 }, // compound eye / lens
    { spec: 0.5, shin: 50, metal: 0, iri: 0, sheen: 0, ridge: 0.2 }, // lamp
    { spec: 0.2, shin: 16, metal: 0.5, iri: 0, sheen: 0, ridge: 0.6 }, // nozzle throat
    { spec: 0.4, shin: 22, metal: 0, iri: 0.55, sheen: 0.45, ridge: 0.4 }, // hive comb resin
];

export interface Surf {
    c: Rgb;
    m: number;
}

export const CHITIN: Surf = { c: [0.026, 0.021, 0.032], m: M.chitin };
export const CHITIN_PURPLE: Surf = { c: [0.055, 0.028, 0.07], m: M.chitin };
export const MARGIN_PURPLE: Surf = { c: [0.2, 0.055, 0.27], m: M.margin };
export const MARGIN_PINK: Surf = { c: [0.42, 0.07, 0.26], m: M.margin };
export const MEMBRANE: Surf = { c: [0.07, 0.03, 0.085], m: M.membrane };
export const VEIN: Surf = { c: [0.2, 0.05, 0.17], m: M.margin };
export const FLESH: Surf = { c: [0.17, 0.035, 0.09], m: M.flesh };
export const FLESH_DARK: Surf = { c: [0.09, 0.02, 0.055], m: M.flesh };
export const GRAFT: Surf = { c: [0.17, 0.165, 0.19], m: M.graft };
export const GRAFT_DARK: Surf = { c: [0.13, 0.125, 0.15], m: M.graft };
export const STEEL: Surf = { c: [0.22, 0.21, 0.24], m: M.steel };
export const CABLE: Surf = { c: [0.06, 0.05, 0.07], m: M.cable };
export const CABLE_PINK: Surf = { c: [0.22, 0.05, 0.15], m: M.cable };
export const EYE: Surf = { c: [0.05, 0.018, 0.07], m: M.eye };
export const NOZZLE: Surf = { c: [0.08, 0.075, 0.09], m: M.nozzle };
export const COMB: Surf = { c: [0.1, 0.045, 0.1], m: M.comb };
export const COMB_DEEP: Surf = { c: [0.04, 0.015, 0.045], m: M.comb };

/** Seam glow (flesh meets machine), bioluminescent lamps and the engine throat. */
export const SEAM_PINK: Rgb = [1, 0.3, 0.72];
export const SEAM_VIOLET: Rgb = [0.72, 0.34, 1];
export const BIO_LAMP: Rgb = [1, 0.48, 0.88];
export const ENGINE_GLOW: Rgb = [0.78, 0.5, 1];

/**
 * The thin-film hue at phase t (cyclic): deep violet → magenta → pink → magenta → blue-violet, with a brief cool
 * teal glint (the oil-slick). Values are highlight colours (≈ unit brightness).
 */
const FILM_STOPS: readonly Rgb[] = [
    [0.42, 0.18, 0.95],
    [0.85, 0.2, 0.78],
    [1.0, 0.42, 0.66],
    [0.88, 0.24, 0.62],
    [0.5, 0.26, 1.0],
    [0.3, 0.5, 0.9],
];

export function filmHue(t: number, out: [number, number, number]): [number, number, number] {
    const n = FILM_STOPS.length;
    const f = (((t % 1) + 1) % 1) * n;
    const a = Math.floor(f) % n;
    const b = (a + 1) % n;
    let u = f - Math.floor(f);
    u = u * u * (3 - 2 * u);
    const A = FILM_STOPS[a];
    const B = FILM_STOPS[b];
    out[0] = A[0] + (B[0] - A[0]) * u;
    out[1] = A[1] + (B[1] - A[1]) * u;
    out[2] = A[2] + (B[2] - A[2]) * u;
    return out;
}

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

export function hashI(ix: number, iy: number, seed: number): number {
    let h = (ix * 374761393 + iy * 668265263 + seed * 144269504) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
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

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smooth = (e0: number, e1: number, x: number): number => {
    const t = clamp01((x - e0) / (e1 - e0));
    return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------------------------------------------------------
// Canvas
// ---------------------------------------------------------------------------------------------------------------

/** Design units across the square. */
export const U = 1000;
/** The vertical axis every Concord body is symmetric about. */
export const CX = U / 2;

/** A nozzle (thruster mark site): centre x, aft end y and radius, in units. */
export interface Nozzle {
    x: number;
    y: number;
    r: number;
}

export class BioCanvas {
    /** Pixels per design unit. */
    readonly k: number;
    readonly hgt: Float32Array;
    readonly cov: Uint8Array;
    readonly alb: Float32Array;
    readonly mat: Uint8Array;
    /** Thin-film phase offset (iridescence hue per plate). */
    readonly film: Float32Array;
    /** Steady emission (rgb). */
    readonly emi: Float32Array;
    /** Pulsing seam emission (rgb): baked dimly, and the overlay's breathing glow. */
    readonly pulse: Float32Array;
    /** Engine nozzles (the thruster marks are placed at them). */
    readonly nozzles: Nozzle[] = [];
    /** Bioluminescent lamp points (steady overlay lights). */
    readonly lamps: Nozzle[] = [];
    constructor(readonly n: number) {
        this.k = n / U;
        const nn = n * n;
        this.hgt = new Float32Array(nn);
        this.cov = new Uint8Array(nn);
        this.alb = new Float32Array(nn * 3);
        this.mat = new Uint8Array(nn);
        this.film = new Float32Array(nn);
        this.emi = new Float32Array(nn * 3);
        this.pulse = new Float32Array(nn * 3);
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

    setSurf(i: number, s: Surf, film = 0): void {
        this.alb[i * 3] = s.c[0];
        this.alb[i * 3 + 1] = s.c[1];
        this.alb[i * 3 + 2] = s.c[2];
        this.mat[i] = s.m;
        this.film[i] = film;
        this.emi[i * 3] = 0;
        this.emi[i * 3 + 1] = 0;
        this.emi[i * 3 + 2] = 0;
        this.pulse[i * 3] = 0;
        this.pulse[i * 3 + 1] = 0;
        this.pulse[i * 3 + 2] = 0;
    }

    tint(i: number, c: Rgb, t: number): void {
        for (let ch = 0; ch < 3; ch++) this.alb[i * 3 + ch] += (c[ch] - this.alb[i * 3 + ch]) * t;
    }

    mul(i: number, f: number): void {
        this.alb[i * 3] *= f;
        this.alb[i * 3 + 1] *= f;
        this.alb[i * 3 + 2] *= f;
    }

    glow(buf: Float32Array, i: number, c: Rgb, e: number): void {
        buf[i * 3] = Math.max(buf[i * 3], c[0] * e);
        buf[i * 3 + 1] = Math.max(buf[i * 3 + 1], c[1] * e);
        buf[i * 3 + 2] = Math.max(buf[i * 3 + 2], c[2] * e);
    }

    /** Height at a unit point (0 off the body or the canvas). */
    heightAt(x: number, y: number): number {
        const i = Math.floor(x * this.k);
        const j = Math.floor(y * this.k);
        if (i < 0 || j < 0 || i >= this.n || j >= this.n) return 0;
        return this.hgt[j * this.n + i];
    }

    covered(x: number, y: number): boolean {
        const i = Math.floor(x * this.k);
        const j = Math.floor(y * this.k);
        return i >= 0 && j >= 0 && i < this.n && j < this.n && this.cov[j * this.n + i] !== 0;
    }
}

/** Run `f` for the starboard side (+1) and its mirror to port (−1). */
export function both(f: (s: 1 | -1) => void): void {
    f(1);
    f(-1);
}

// ---------------------------------------------------------------------------------------------------------------
// Shapes (signed distance in units, negative inside)
// ---------------------------------------------------------------------------------------------------------------

export interface Shape {
    d: (x: number, y: number) => number;
    box: readonly [number, number, number, number];
}

export function circleShape(cx: number, cy: number, r: number): Shape {
    return { d: (x, y) => Math.hypot(x - cx, y - cy) - r, box: [cx - r, cy - r, cx + r, cy + r] };
}

export function ellipseShape(cx: number, cy: number, a: number, b: number): Shape {
    const m = Math.min(a, b);
    return { d: (x, y) => (Math.hypot((x - cx) / a, (y - cy) / b) - 1) * m, box: [cx - a, cy - b, cx + a, cy + b] };
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

export function segDist(x: number, y: number, x0: number, y0: number, x1: number, y1: number): number {
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

export function mirrorX(x: number): number {
    return U - x;
}

// ---------------------------------------------------------------------------------------------------------------
// Generic volumes
// ---------------------------------------------------------------------------------------------------------------

/**
 * How a volume meets what is under it: 'max' writes where it rises above the existing height (stacked volumes),
 * 'add' raises the existing surface by its profile (a plate following a curved shell), 'over' paints its own height
 * regardless.
 */
export type Mode = 'max' | 'add' | 'over';

export interface VolOpts {
    z?: number;
    h: number;
    /** Width of the edge roll-off (units). */
    bevel: number;
    /** 'round' (quarter circle), 'soft' (smoothstep), 'flat'. */
    prof?: 'round' | 'soft' | 'flat';
    s: Surf;
    film?: number;
    mode?: Mode;
    /** Only where the canvas is already covered. */
    onHull?: boolean;
}

function prof(p: 'round' | 'soft' | 'flat', t: number): number {
    if (p === 'round') return Math.sqrt(1 - (1 - t) * (1 - t));
    if (p === 'soft') return t * t * (3 - 2 * t);
    return 1;
}

export function volume(cv: BioCanvas, sh: Shape, o: VolOpts): void {
    const z = o.z ?? 0;
    const p = o.prof ?? 'round';
    const mode = o.mode ?? 'max';
    const [bx0, by0, bx1, by1] = sh.box;
    cv.each(bx0, by0, bx1, by1, (i, x, y) => {
        const d = sh.d(x, y);
        if (d > 0) return;
        if (o.onHull && cv.cov[i] === 0) return;
        const t = o.bevel > 0 ? Math.min(1, -d / o.bevel) : 1;
        const H = (mode === 'add' && cv.cov[i] ? cv.hgt[i] : 0) + z + o.h * prof(p, t);
        if (mode === 'max' && cv.cov[i] && H <= cv.hgt[i]) return;
        cv.hgt[i] = H;
        cv.cov[i] = 1;
        cv.setSurf(i, o.s, o.film ?? 0);
    });
}

/** Lower the surface inside a shape by `depth` (bevelled walls); optionally repaint the floor. */
export function carve(cv: BioCanvas, sh: Shape, depth: number, bevel: number, floor?: Surf, darken = 0.25): void {
    const [bx0, by0, bx1, by1] = sh.box;
    cv.each(bx0, by0, bx1, by1, (i, x, y) => {
        if (!cv.cov[i]) return;
        const d = sh.d(x, y);
        if (d > 0) return;
        const t = bevel > 0 ? Math.min(1, -d / bevel) : 1;
        cv.hgt[i] -= depth * t;
        if (floor !== undefined && t >= 1) cv.setSurf(i, floor, cv.film[i]);
        if (darken > 0) cv.mul(i, 1 - darken * t);
    });
}

/** Paint a region with another surface without changing its height. */
export function paint(cv: BioCanvas, sh: Shape, s: Surf, onlyMats?: readonly number[]): void {
    const mats = onlyMats === undefined ? null : new Set(onlyMats);
    const [bx0, by0, bx1, by1] = sh.box;
    cv.each(bx0, by0, bx1, by1, (i, x, y) => {
        if (!cv.cov[i] || sh.d(x, y) > 0) return;
        if (mats !== null && !mats.has(cv.mat[i])) return;
        cv.setSurf(i, s, cv.film[i]);
    });
}

/** Emission inside a shape (steady or pulsing layer), `falloff` units of fade in from the outline. */
export function emit(cv: BioCanvas, sh: Shape, c: Rgb, power: number, layer: 'steady' | 'pulse' = 'steady', falloff = 0): void {
    const buf = layer === 'steady' ? cv.emi : cv.pulse;
    const [bx0, by0, bx1, by1] = sh.box;
    cv.each(bx0, by0, bx1, by1, (i, x, y) => {
        if (!cv.cov[i]) return;
        const d = sh.d(x, y);
        if (d > 0) return;
        cv.glow(buf, i, c, power * (falloff > 0 ? Math.min(1, -d / falloff) : 1));
    });
}

/**
 * A tapered tube lying in the image plane from (x0, y0) radius r0 to (x1, y1) radius r1, round cross-section (height
 * z + r·hk at the axis), round ends. 'add' follows the surface below (cables on a shell).
 */
export function tube(
    cv: BioCanvas,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    r0: number,
    r1: number,
    o: { z?: number; hk?: number; s: Surf; mode?: Mode; film?: number; bands?: number; bandSurf?: Surf; z1?: number },
): void {
    const z0 = o.z ?? 0;
    const zEnd = o.z1 ?? z0;
    const hk = o.hk ?? 1;
    const L = Math.hypot(x1 - x0, y1 - y0) || 1;
    const ux = (x1 - x0) / L;
    const uy = (y1 - y0) / L;
    const mode = o.mode ?? 'max';
    const rm = Math.max(r0, r1);
    cv.each(Math.min(x0, x1) - rm, Math.min(y0, y1) - rm, Math.max(x0, x1) + rm, Math.max(y0, y1) + rm, (i, x, y) => {
        const px = x - x0;
        const py = y - y0;
        const al = px * ux + py * uy;
        const t = clamp01(al / L);
        const r = r0 + (r1 - r0) * t;
        const ac = Math.abs(-px * uy + py * ux);
        const d = al < 0 ? Math.hypot(al, ac) : al > L ? Math.hypot(al - L, ac) : ac;
        if (d > r || r <= 0) return;
        const H = (mode === 'add' && cv.cov[i] ? cv.hgt[i] : 0) + z0 + (zEnd - z0) * t + r * hk * Math.sqrt(1 - (d / r) ** 2);
        if (mode === 'max' && cv.cov[i] && H <= cv.hgt[i]) return;
        cv.hgt[i] = H;
        cv.cov[i] = 1;
        let s = o.s;
        if (o.bands !== undefined && o.bandSurf !== undefined && al >= 0 && al <= L) {
            const f = (al / L) * o.bands;
            const fr = f - Math.floor(f);
            if (fr < 0.12) s = o.bandSurf;
        }
        cv.setSurf(i, s, (o.film ?? 0) + t * 0.3);
    });
}

export function dome(cv: BioCanvas, cx: number, cy: number, r: number, o: { z?: number; h?: number; s: Surf; mode?: Mode; film?: number }): void {
    volume(cv, circleShape(cx, cy, r), { z: o.z, h: o.h ?? r, bevel: r, prof: 'round', s: o.s, mode: o.mode, film: o.film });
}

/** Quadratic Bézier point. */
export function bez(p0: readonly [number, number], p1: readonly [number, number], p2: readonly [number, number], t: number): [number, number] {
    const a = (1 - t) * (1 - t);
    const b = 2 * (1 - t) * t;
    const c = t * t;
    return [a * p0[0] + b * p1[0] + c * p2[0], a * p0[1] + b * p1[1] + c * p2[1]];
}

/** A tapering curved horn / mandible / feeler along a quadratic Bézier: `n` tube pieces from radius r0 to r1. */
export function curvedTube(
    cv: BioCanvas,
    p0: readonly [number, number],
    p1: readonly [number, number],
    p2: readonly [number, number],
    r0: number,
    r1: number,
    o: { z?: number; z1?: number; s: Surf; n?: number; mode?: Mode; film?: number; beads?: Surf },
): void {
    const n = o.n ?? 10;
    const z0 = o.z ?? 0;
    const z1 = o.z1 ?? z0;
    for (let k = 0; k < n; k++) {
        const ta = k / n;
        const tb = (k + 1) / n;
        const a = bez(p0, p1, p2, ta);
        const b = bez(p0, p1, p2, tb);
        const ra = r0 + (r1 - r0) * ta;
        const rb = r0 + (r1 - r0) * tb;
        tube(cv, a[0], a[1], b[0], b[1], ra, rb, { z: z0 + (z1 - z0) * ta, z1: z0 + (z1 - z0) * tb, s: o.s, mode: o.mode, film: (o.film ?? 0) + ta * 0.4 });
        if (o.beads !== undefined && k > 0) dome(cv, a[0], a[1], ra * 1.18, { z: z0 + (z1 - z0) * ta, h: ra * 1.05, s: o.beads, film: ta });
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Anatomy
// ---------------------------------------------------------------------------------------------------------------

export interface SegmentOpts {
    cx?: number;
    /** Fore / aft ends (units). */
    y0: number;
    y1: number;
    /** Half-width at fraction t of the length (0 fore … 1 aft); ≤ 0 = no body there. */
    hw: (t: number) => number;
    /** Crown height at t. */
    ht: (t: number) => number;
    z?: number;
    /** Superelliptic cross-section exponent (2 round, higher boxier). */
    pow?: number;
    /** Overlapping shingle plates (tergites) along the segment: each rises toward its aft lip over the next. */
    plates?: number;
    /** Lip height of each plate (units). */
    lip?: number;
    /** Margin band width (units) along the plates' aft lips and the outer edge; colour alternates purple / pink. */
    margin?: number;
    /** Central keel ridge height. */
    keel?: number;
    s?: Surf;
    film?: number;
    seed?: number;
    mode?: Mode;
}

/**
 * A body segment (head capsule, thorax, abdomen): a lofted shell along the vertical axis with growth lines, pores,
 * an optional keel and overlapping shingle plates whose aft lips stand over the next plate, each plate with its own
 * film phase (hue) and a dark purple / deep pink margin.
 */
export function segment(cv: BioCanvas, o: SegmentOpts): void {
    const cx = o.cx ?? CX;
    const pow = o.pow ?? 2.2;
    const z = o.z ?? 0;
    const n = o.plates ?? 1;
    const lip = o.lip ?? 0;
    const mw = o.margin ?? 0;
    const s = o.s ?? CHITIN;
    const seed = o.seed ?? 1;
    const L = o.y1 - o.y0;
    const plateL = L / n;
    let maxW = 0;
    for (let t = 0; t <= 1; t += 0.01) maxW = Math.max(maxW, o.hw(t));
    cv.each(cx - maxW, o.y0, cx + maxW, o.y1, (i, x, y) => {
        const t = (y - o.y0) / L;
        if (t < 0 || t > 1) return;
        const w = o.hw(t);
        if (w <= 0) return;
        const ax = Math.abs(x - cx);
        const u = ax / w;
        if (u > 1) return;
        let H = z + o.ht(t) * Math.pow(1 - Math.pow(u, pow), 1 / pow);
        const fp = (t * n) % 1;
        const plate = Math.min(n - 1, Math.floor(t * n));
        if (n > 1) H += lip * (0.25 + 0.75 * smooth(0, 1, fp)) * (1 - 0.5 * u);
        if (o.keel !== undefined && o.keel > 0) H += o.keel * Math.max(0, 1 - ax / (w * 0.09 + 3));
        // Growth lines parallel to the aft lip and the flanks, pores.
        const toLip = (1 - fp) * plateL;
        const toEdge = w - ax;
        const g = Math.min(toLip, toEdge);
        H += 0.35 * Math.sin(g * 1.3) * Math.exp(-g / 16);
        {
            const px = Math.floor(x / 5);
            const py = Math.floor(y / 5);
            if (g > 6 && hashI(px, py, seed + 71) < 0.12) {
                const ox = (px + 0.25 + 0.5 * hashI(px, py, seed + 72)) * 5;
                const oy = (py + 0.25 + 0.5 * hashI(px, py, seed + 73)) * 5;
                const q = Math.hypot(x - ox, y - oy) / 1.3;
                if (q < 1) H -= 0.8 * (1 - q * q);
            }
        }
        const mode = o.mode ?? 'max';
        if (mode === 'add' && cv.cov[i]) H += cv.hgt[i];
        else if (mode === 'max' && cv.cov[i] && H <= cv.hgt[i]) return;
        cv.hgt[i] = H;
        cv.cov[i] = 1;
        const film = (o.film ?? 0) + plate * 0.17 + 0.08 * fbm(x * 0.012, y * 0.012, seed);
        if (mw > 0 && (toLip < mw * (n > 1 ? 1 : 0) || toEdge < mw * 0.75)) {
            const pink = hashI(plate, 0, seed + 3) < 0.5 !== toEdge < mw * 0.75;
            cv.setSurf(i, pink ? MARGIN_PINK : MARGIN_PURPLE, film);
            const e = Math.min(toLip, toEdge) / mw;
            cv.mul(i, 0.55 + 0.45 * e);
        } else cv.setSurf(i, s, film);
        if (n > 1 && toLip < 1.6) {
            // The aft lip's shadowed undercut.
            cv.hgt[i] -= 0.6;
        }
    });
}

/** Mirror-symmetric jointed limb: a chain of tapered tubes through `pts` (starboard side given, port mirrored). */
export function limb(
    cv: BioCanvas,
    pts: readonly (readonly [number, number])[],
    r0: number,
    r1: number,
    o: { z?: number; s?: Surf; knuckle?: Surf; claw?: number; mirror?: boolean; film?: number; seam?: boolean },
): void {
    const s = o.s ?? CHITIN;
    const z = o.z ?? 0;
    const draw = (P: readonly (readonly [number, number])[]): void => {
        const nseg = P.length - 1;
        for (let k = 0; k < nseg; k++) {
            const ra = r0 + ((r1 - r0) * k) / nseg;
            const rb = r0 + ((r1 - r0) * (k + 1)) / nseg;
            // Each leg segment swells a little in its middle (femur, tibia).
            const [ax, ay] = P[k];
            const [bx, by] = P[k + 1];
            const mx = (ax + bx) / 2;
            const my = (ay + by) / 2;
            tube(cv, ax, ay, mx, my, ra, (ra + rb) * 0.62, { z, s, film: (o.film ?? 0) + k * 0.2 });
            tube(cv, mx, my, bx, by, (ra + rb) * 0.62, rb * 0.9, { z, s, film: (o.film ?? 0) + k * 0.2 + 0.1 });
            if (k > 0) {
                dome(cv, ax, ay, ra * 0.95, { z: z + ra * 0.2, h: ra * 0.8, s: o.knuckle ?? MARGIN_PURPLE, film: k * 0.3 });
                if (o.seam) emit(cv, circleShape(ax, ay, ra * 0.55), SEAM_PINK, 0.55, 'pulse');
            }
        }
        const claw = o.claw ?? 0;
        if (claw > 0) {
            const [ax, ay] = P[nseg - 1];
            const [bx, by] = P[nseg];
            const L = Math.hypot(bx - ax, by - ay) || 1;
            const dx = (bx - ax) / L;
            const dy = (by - ay) / L;
            tube(cv, bx, by, bx + dx * claw, by + dy * claw, r1 * 0.9, r1 * 0.15, { z, s: CHITIN_PURPLE });
        }
    };
    draw(pts);
    if (o.mirror !== false) draw(pts.map(([x, y]) => [U - x, y] as const));
}

/** A compound eye: a glossy dome with hexagonal facets (and a faint pink inner glow at a few facets). */
export function compoundEye(cv: BioCanvas, cx: number, cy: number, a: number, b: number, o: { z?: number; h?: number; glow?: number; seed?: number } = {}): void {
    const z = o.z ?? cv.heightAt(cx, cy);
    const h = o.h ?? Math.min(a, b) * 0.9;
    const facet = Math.max(2.2, Math.min(a, b) / 7);
    const seed = o.seed ?? 5;
    cv.each(cx - a, cy - b, cx + a, cy + b, (i, x, y) => {
        const e = Math.hypot((x - cx) / a, (y - cy) / b);
        if (e > 1) return;
        // Hex grid (axial): the nearest centre.
        const qx = (x - cx) / facet;
        const qy = (y - cy) / (facet * 0.866);
        const row = Math.round(qy);
        const off = row & 1 ? 0.5 : 0;
        const col = Math.round(qx - off);
        const dx = qx - (col + off);
        const dy = (qy - row) * 0.866;
        const dc = Math.hypot(dx, dy);
        const H = z + h * Math.sqrt(1 - e * e) + 0.35 * Math.sqrt(Math.max(0, 1 - dc * dc * 1.6));
        if (cv.cov[i] && H <= cv.hgt[i] - 0.5 && cv.mat[i] !== M.eye) return;
        cv.hgt[i] = H;
        cv.cov[i] = 1;
        cv.setSurf(i, EYE, 0.2 + 0.6 * e + 0.05 * hashI(col, row, seed));
        if (dc > 0.5) cv.mul(i, 0.8);
        const g = (o.glow ?? 0.25) * (hashI(col, row, seed + 1) < 0.12 ? 0.7 : 0.3) * (1 - e * 0.6);
        if (g > 0) cv.glow(cv.emi, i, BIO_LAMP, g * 0.5);
    });
}

/**
 * A wing / fin membrane from `root` toward `tip`, half-width `w` at its widest (a long leaf), dark membrane with a
 * vein network (raised, pink-violet) and a thicker leading-edge vein. Low (below the body).
 */
export function wing(cv: BioCanvas, root: readonly [number, number], tip: readonly [number, number], w: number, o: { z?: number; seed?: number; mirror?: boolean; veins?: number } = {}): void {
    const z = o.z ?? 4;
    const seed = o.seed ?? 9;
    const nv = o.veins ?? 5;
    const draw = (R: readonly [number, number], T: readonly [number, number], sgn: number): void => {
        const L = Math.hypot(T[0] - R[0], T[1] - R[1]) || 1;
        const ux = (T[0] - R[0]) / L;
        const uy = (T[1] - R[1]) / L;
        // Leading edge on the fore side: the normal pointing toward −y.
        let nx = -uy;
        let ny = ux;
        if (ny > 0) {
            nx = -nx;
            ny = -ny;
        }
        cv.each(Math.min(R[0], T[0]) - w, Math.min(R[1], T[1]) - w, Math.max(R[0], T[0]) + w, Math.max(R[1], T[1]) + w, (i, x, y) => {
            const px = x - R[0];
            const py = y - R[1];
            const al = (px * ux + py * uy) / L;
            if (al < 0 || al > 1) return;
            const ac = px * nx + py * ny; // + toward the leading edge
            // Leaf: narrow at the root, widest at 40 %, rounded tip; the leading edge straighter than the trailing.
            const prof = Math.sin(Math.PI * Math.pow(al, 0.7)) * (0.35 + 0.65 * Math.min(1, al * 3));
            const wl = w * 0.45 * prof;
            const wt = w * prof;
            if (ac > wl || ac < -wt) return;
            const v = ac >= 0 ? ac / Math.max(1e-6, wl) : -ac / Math.max(1e-6, wt);
            let H = z + 1.2 * (1 - v);
            let s = MEMBRANE;
            // Venation: a few long veins along the wing, a Voronoi net of cells between them (smaller toward the root).
            const fl = ((ac + wt) / (wl + wt)) * nv + 0.25 * Math.sin(al * 5 + sgn);
            const lon = fl % 1;
            const cell = w * (0.16 + 0.12 * al);
            const vx = (al * L) / cell;
            const vy = (ac + wt) / cell;
            const ix = Math.floor(vx);
            const iy = Math.floor(vy);
            let f1 = Infinity;
            let f2 = Infinity;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const cx = ix + dx + 0.15 + 0.7 * hashI(ix + dx, iy + dy, seed + 31);
                    const cy = iy + dy + 0.15 + 0.7 * hashI(ix + dx, iy + dy, seed + 37);
                    const dd = Math.hypot(vx - cx, vy - cy);
                    if (dd < f1) {
                        f2 = f1;
                        f1 = dd;
                    } else if (dd < f2) f2 = dd;
                }
            }
            const lead = wl - ac;
            if (lead < Math.max(2, w * 0.08)) {
                H += 2.2;
                s = CHITIN_PURPLE;
            } else if (Math.min(lon, 1 - lon) < 0.035) {
                H += 1.2;
                s = VEIN;
            } else if (f2 - f1 < 0.07 && al > 0.05) {
                H += 0.7;
                s = VEIN;
            }
            if (cv.cov[i] && cv.hgt[i] >= H) return;
            cv.hgt[i] = H;
            cv.cov[i] = 1;
            cv.setSurf(i, s, al * 0.8 + v * 0.3 + 0.2 * noise2(x * 0.02, y * 0.02, seed) + sgn * 0.05);
        });
    };
    draw(root, tip, 1);
    if (o.mirror !== false) draw([U - root[0], root[1]], [U - tip[0], tip[1]], -1);
}

/**
 * A grafted armour plate bolted into the shell (added on the surface, onHull): bevelled gunmetal with panel lines,
 * bolts along its edge and a glowing pink-violet seam just outside its outline where the chitin was cut for it.
 */
export function graft(cv: BioCanvas, sh: Shape, o: { h?: number; bolts?: number; seam?: number; glow?: number; s?: Surf; colour?: Rgb; panel?: number; seed?: number }): void {
    const h = o.h ?? 4;
    const seamW = o.seam ?? 3.5;
    const panel = o.panel ?? 0;
    const glow = o.glow ?? 0.9;
    const col = o.colour ?? SEAM_PINK;
    const [bx0, by0, bx1, by1] = sh.box;
    // The seam: a narrow flesh gap around the plate, glowing.
    cv.each(bx0 - seamW, by0 - seamW, bx1 + seamW, by1 + seamW, (i, x, y) => {
        if (!cv.cov[i]) return;
        const d = sh.d(x, y);
        if (d <= 0 || d > seamW) return;
        const t = 1 - d / seamW;
        cv.hgt[i] -= 1.2 * t;
        cv.setSurf(i, FLESH, cv.film[i]);
        cv.glow(cv.pulse, i, col, glow * (0.4 + 0.6 * t));
    });
    cv.each(bx0, by0, bx1, by1, (i, x, y) => {
        if (!cv.cov[i]) return;
        const d = sh.d(x, y);
        if (d > 0) return;
        const t = Math.min(1, -d / Math.max(1.5, h * 0.9));
        cv.hgt[i] += h * (0.35 + 0.65 * t);
        cv.setSurf(i, o.s ?? GRAFT);
        if (panel > 0 && (y / (panel * 1.6)) % 1 < 0.07 && -d > 3) {
            cv.hgt[i] -= 0.8;
            cv.mul(i, 0.6);
        }
        cv.mul(i, 0.92 + 0.16 * hashI(Math.floor(bx0), Math.floor(by0), o.seed ?? 3));
    });
    // Bolts just inside the outline: walk the outline by sampling the box perimeter and stepping inward.
    const nb = o.bolts ?? 0;
    if (nb > 0) {
        const pts: [number, number][] = [];
        const bw = bx1 - bx0;
        const bh = by1 - by0;
        const per = 2 * (bw + bh);
        for (let k = 0; k < nb * 6 && pts.length < nb; k++) {
            const s = ((k + 0.5) / (nb * 6)) * per;
            let x: number;
            let y: number;
            if (s < bw) [x, y] = [bx0 + s, by0];
            else if (s < bw + bh) [x, y] = [bx1, by0 + s - bw];
            else if (s < 2 * bw + bh) [x, y] = [bx1 - (s - bw - bh), by1];
            else [x, y] = [bx0, by1 - (s - 2 * bw - bh)];
            // March toward the centre until 3 units inside.
            const cx = (bx0 + bx1) / 2;
            const cy = (by0 + by1) / 2;
            for (let m = 0; m < 60; m++) {
                const dd = sh.d(x, y);
                if (dd < -3.2) break;
                const L = Math.hypot(cx - x, cy - y) || 1;
                x += ((cx - x) / L) * 1.5;
                y += ((cy - y) / L) * 1.5;
            }
            if (k % 6 === 0) pts.push([x, y]);
        }
        for (const [x, y] of pts) dome(cv, x, y, 2.2, { z: cv.heightAt(x, y), h: 1.6, s: STEEL, mode: 'over' });
    }
}

/** A bundle of `n` parallel cables along a polyline (added on the surface), with steel clamps every `clamp` units. */
export function cables(cv: BioCanvas, pts: readonly (readonly [number, number])[], r: number, o: { n?: number; clamp?: number; s?: Surf; mirror?: boolean; glowEnds?: boolean } = {}): void {
    const n = o.n ?? 3;
    const clampL = o.clamp ?? 40;
    const draw = (P: readonly (readonly [number, number])[]): void => {
        let acc = 0;
        for (let k = 0; k + 1 < P.length; k++) {
            const [ax, ay] = P[k];
            const [bx, by] = P[k + 1];
            const L = Math.hypot(bx - ax, by - ay) || 1;
            const nx = -(by - ay) / L;
            const ny = (bx - ax) / L;
            for (let c = 0; c < n; c++) {
                const off = (c - (n - 1) / 2) * r * 2.05;
                const s = c === 1 && n >= 3 ? (o.s === undefined ? CABLE_PINK : o.s) : CABLE;
                tube(cv, ax + nx * off, ay + ny * off, bx + nx * off, by + ny * off, r, r, { z: 0.5, hk: 0.9, s, mode: 'add' });
            }
            for (let d = clampL - (acc % clampL); d < L; d += clampL) {
                const x = ax + ((bx - ax) * d) / L;
                const y = ay + ((by - ay) * d) / L;
                volume(cv, capsuleShape(x - nx * r * n * 1.1, y - ny * r * n * 1.1, x + nx * r * n * 1.1, y + ny * r * n * 1.1, r * 0.75), {
                    h: r * 0.9,
                    bevel: r * 0.6,
                    s: STEEL,
                    mode: 'add',
                    onHull: true,
                });
            }
            acc += L;
        }
        if (o.glowEnds !== false) {
            for (const [x, y] of [P[0], P[P.length - 1]]) {
                volume(cv, circleShape(x, y, r * n * 1.15), { h: r * 1.2, bevel: r, s: GRAFT_DARK, mode: 'add', onHull: true });
                graft(cv, circleShape(x, y, r * n * 0.8), { h: 0.8, seam: 2.5, glow: 0.8, s: GRAFT_DARK });
            }
        }
    };
    draw(pts);
    if (o.mirror) draw(pts.map(([x, y]) => [U - x, y] as const));
}

/**
 * A mechanical engine pod fused onto the abdomen from y0 (fore) to y1 (aft), radius r: banded gunmetal cylinder, a
 * fleshy collar fused to the shell at its fore end (glowing seam), cooling ribs, a dark throat with engine glow at the
 * aft lip. Records the nozzle (the thruster mark sits at its aft lip).
 */
export function enginePod(cv: BioCanvas, x: number, y0: number, y1: number, r: number, o: { z?: number; glow?: number } = {}): void {
    const z = o.z ?? 6;
    // Fleshy socket where the pod was fused on.
    volume(cv, ellipseShape(x, y0 + r * 0.4, r * 1.35, r * 0.9), { z: z - 2, h: r * 0.9, bevel: r * 0.6, prof: 'soft', s: FLESH_DARK });
    emit(cv, ellipseShape(x, y0 + r * 0.4, r * 1.3, r * 0.85), SEAM_PINK, 0.75, 'pulse', r * 0.3);
    tube(cv, x, y0, x, y1 - r * 0.5, r * 0.88, r, { z, s: GRAFT, bands: 5, bandSurf: GRAFT_DARK });
    // Bell flare at the aft end.
    tube(cv, x, y1 - r * 0.7, x, y1 - r * 0.1, r * 1.05, r * 1.12, { z, s: STEEL });
    // Ribs along the pod.
    for (const sgn of [-1, 1]) for (let k = 0; k < 4; k++) dome(cv, x + sgn * r * 0.62, y0 + (y1 - y0) * (0.25 + 0.12 * k), r * 0.16, { z: cv.heightAt(x + sgn * r * 0.62, y0 + (y1 - y0) * (0.25 + 0.12 * k)), h: r * 0.12, s: STEEL, mode: 'over' });
    // Throat: dark mouth at the aft lip with the glow.
    carve(cv, ellipseShape(x, y1 - r * 0.18, r * 0.78, r * 0.2), r * 0.6, r * 0.12, NOZZLE, 0.1);
    emit(cv, ellipseShape(x, y1 - r * 0.12, r * 0.66, r * 0.14), ENGINE_GLOW, o.glow ?? 1.1, 'steady', r * 0.05);
    cv.nozzles.push({ x, y: y1, r });
}

/** An implanted sensor cluster: a steel socket with glossy lens domes around a lamp (lamp position recorded by caller). */
export function sensorCluster(cv: BioCanvas, cx: number, cy: number, r: number, o: { lenses?: number; seed?: number } = {}): void {
    const base = cv.heightAt(cx, cy);
    graft(cv, circleShape(cx, cy, r), { h: r * 0.25, seam: Math.max(2, r * 0.18), glow: 0.9, s: GRAFT_DARK });
    const n = o.lenses ?? 5;
    for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + 0.3;
        const lx = cx + Math.cos(a) * r * 0.58;
        const ly = cy + Math.sin(a) * r * 0.58;
        dome(cv, lx, ly, r * 0.24, { z: base + r * 0.25, h: r * 0.24, s: EYE, film: k * 0.2 });
    }
    dome(cv, cx, cy, r * 0.26, { z: base + r * 0.25, h: r * 0.3, s: { c: [0.3, 0.06, 0.25], m: M.lamp } });
    emit(cv, circleShape(cx, cy, r * 0.24), BIO_LAMP, 1.1, 'steady', r * 0.08);
}

/**
 * Hive comb inside a shape: raised hexagonal cell walls (resin), recessed cells, some capped with domed brood caps
 * (flesh), some lit from inside (pink-violet glow, pulsing). `cell` = cell radius (units).
 */
export function comb(cv: BioCanvas, sh: Shape, cell: number, o: { z?: number; h?: number; seed?: number; lit?: number; capped?: number; mode?: Mode; wall?: number } = {}): void {
    const z = o.z ?? 0;
    const h = o.h ?? cell * 0.6;
    const seed = o.seed ?? 21;
    const lit = o.lit ?? 0.12;
    const capped = o.capped ?? 0.3;
    const wall = o.wall ?? 0.2;
    const mode = o.mode ?? 'max';
    const [bx0, by0, bx1, by1] = sh.box;
    cv.each(bx0, by0, bx1, by1, (i, x, y) => {
        const d = sh.d(x, y);
        if (d > 0) return;
        // Pointy-top hex grid.
        const qx = x / (cell * 1.732);
        const qy = y / (cell * 1.5);
        const row = Math.round(qy);
        const off = row & 1 ? 0.5 : 0;
        const col = Math.round(qx - off);
        // Nearest of the candidate centres (hex Voronoi).
        let best = Infinity;
        let bc = col;
        let br = row;
        for (let dr = -1; dr <= 1; dr++) {
            const rr = row + dr;
            const oo = rr & 1 ? 0.5 : 0;
            for (let dc = -1; dc <= 1; dc++) {
                const cc = col + dc;
                const ccx = (cc + oo) * cell * 1.732;
                const ccy = rr * cell * 1.5;
                const dd = Math.hypot(x - ccx, y - ccy);
                if (dd < best) {
                    best = dd;
                    bc = cc;
                    br = rr;
                }
            }
        }
        // Hex distance to the cell's centre (≈ 1 at the wall).
        const ccx = (bc + (br & 1 ? 0.5 : 0)) * cell * 1.732;
        const ccy = br * cell * 1.5;
        const px = Math.abs(x - ccx);
        const py = Math.abs(y - ccy);
        const hexD = Math.max(px * 0.866 + py * 0.5, py) / (cell * 0.866);
        const edge = clamp01(-d / (cell * 1.5));
        const hh = hashI(bc, br, seed);
        let H: number;
        let s: Surf = COMB;
        let glow = 0;
        if (hexD > 1 - wall) H = z + h * (0.75 + 0.25 * edge);
        else if (hh < capped) {
            H = z + h * (0.55 + 0.4 * Math.sqrt(Math.max(0, 1 - hexD * hexD)));
            s = hashI(bc, br, seed + 2) < 0.5 ? FLESH_DARK : COMB;
        } else {
            H = z + h * (0.75 * edge - 0.4 * (1 - hexD));
            s = COMB_DEEP;
            if (hh > 1 - lit) glow = 0.7 * (1 - hexD * 0.7);
        }
        if (mode === 'add' && cv.cov[i]) H += cv.hgt[i];
        else if (mode === 'max' && cv.cov[i] && H <= cv.hgt[i]) return;
        cv.hgt[i] = H;
        cv.cov[i] = 1;
        cv.setSurf(i, s, hh * 0.7 + 0.2 * noise2(x * 0.01, y * 0.01, seed));
        if (glow > 0) cv.glow(cv.pulse, i, hashI(bc, br, seed + 5) < 0.5 ? SEAM_PINK : SEAM_VIOLET, glow);
    });
}

/** Bioluminescent lamp point: a small glossy bead with a steady emissive core. */
export function bioLamp(cv: BioCanvas, x: number, y: number, r: number, c: Rgb = BIO_LAMP, power = 0.55): void {
    const base = cv.heightAt(x, y);
    cv.lamps.push({ x, y, r });
    cv.each(x - r, y - r, x + r, y + r, (i, px, py) => {
        const d = Math.hypot(px - x, py - y) / r;
        if (d > 1) return;
        cv.hgt[i] = base + r * 0.7 * Math.sqrt(1 - d * d);
        cv.cov[i] = 1;
        cv.setSurf(i, { c: [c[0] * 0.3, c[1] * 0.3, c[2] * 0.3], m: M.lamp });
        cv.glow(cv.emi, i, c, power * (0.55 + 0.45 * (1 - d * d)));
    });
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

export interface BioRender {
    /** The lit body (straight alpha, binary coverage). */
    img: RgbaImageLike;
    /** The pulsing seam glow (soft, straight alpha: colour normalised, alpha = intensity), same size. */
    glow: RgbaImageLike;
}

/** Light the canvas. */
export function renderBio(cv: BioCanvas, o: { seed: number; exposure?: number }): BioRender {
    const { n, k } = cv;
    const nn = n * n;
    const H = cv.hgt;
    const cov = cv.cov;
    const seed = o.seed;
    const expo = o.exposure ?? 1;
    // Fine organic grain in the height field.
    for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
            const p = j * n + i;
            if (!cov[p]) continue;
            const m = cv.mat[p];
            const x = (i + 0.5) / k;
            const y = (j + 0.5) / k;
            const amp = m === M.graft || m === M.steel ? 0.12 : m === M.flesh ? 0.6 : 0.3;
            H[p] += amp * fbm(x * 0.3, y * 0.3, seed + 101);
            // Fine ridges across the chitin (stretched noise).
            if (m === M.chitin) H[p] += 0.1 * Math.sin(x * 0.7 + 6 * noise2(x * 0.03, y * 0.09, seed + 103));
        }
    }
    const h = (i: number, j: number): number => (i < 0 || j < 0 || i >= n || j >= n ? 0 : H[j * n + i]);
    // Ambient occlusion: horizon slope in 8 directions at 5 radii (units).
    const ao = new Float32Array(nn);
    const radii = [3, 9, 22, 40].map((r) => Math.max(1, Math.round(r * k)));
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
            ao[p] = 1 - Math.min(0.9, (occ / 8) * 1.6);
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
    const col = new Float32Array(nn * 3);
    const [LX, LY, LZ] = HULL_LIGHT;
    const HV = norm3(LX, LY, LZ + 1);
    const lapR = Math.max(1, Math.round(1.6 * k));
    const fc: [number, number, number] = [0, 0, 0];
    const fc2: [number, number, number] = [0, 0, 0];
    for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
            const p = j * n + i;
            if (!cov[p]) continue;
            const x = (i + 0.5) / k;
            const y = (j + 0.5) / k;
            const optic = OPTICS[cv.mat[p]];
            const dhx = (h(i + 1, j) - h(i - 1, j)) * (k / 2);
            const dhy = (h(i, j + 1) - h(i, j - 1)) * (k / 2);
            const [nx, ny, nz] = norm3(-dhx, -dhy, 1);
            const lap = (h(i + lapR, j) + h(i - lapR, j) + h(i, j + lapR) + h(i, j - lapR) - 4 * H[p]) / ((lapR / k) * (lapR / k));
            const convex = Math.max(0, Math.min(1, -lap * 3));
            let r = cv.alb[p * 3];
            let g = cv.alb[p * 3 + 1];
            let b = cv.alb[p * 3 + 2];
            const mott = fbm(x * 0.04, y * 0.04, seed + 17);
            const tex = 1 + 0.22 * mott + 0.08 * (noise2(x * 0.9, y * 0.9, seed + 23) - 0.5);
            r *= tex;
            g *= tex;
            b *= tex;
            const occl = ao[p];
            const ndl = nx * LX + ny * LY + nz * LZ;
            const diff = Math.max(0, ndl) * shadow[p];
            const sky = 0.5 + 0.5 * nz;
            const amb = (0.12 + 0.1 * sky) * occl * occl;
            const ndh = Math.max(0, nx * HV[0] + ny * HV[1] + nz * HV[2]);
            const lit = amb + diff * 1.3;
            const dk = 1 - 0.35 * optic.metal;
            let R = r * lit * dk;
            let G = g * lit * dk;
            let B = b * lit * dk;
            // Specular: thin-film hue for the iridescent materials, albedo-tinted for metal, white otherwise.
            const slope = 1 - nz;
            const phase = cv.film[p] + slope * 2.4 + ndh * 0.6 + 0.25 * fbm(x * 0.015, y * 0.015, seed + 29);
            filmHue(phase, fc);
            filmHue(phase + 0.33, fc2);
            const sp = optic.spec * Math.pow(ndh, optic.shin) * (0.25 + 0.75 * shadow[p]);
            const iri = optic.iri;
            const mr = 1 + (r * 2.4 - 1) * optic.metal;
            const mg = 1 + (g * 2.4 - 1) * optic.metal;
            const mb = 1 + (b * 2.4 - 1) * optic.metal;
            R += sp * (mr * (1 - iri) + fc[0] * iri * 1.1);
            G += sp * (mg * (1 - iri) + fc[1] * iri * 1.1);
            B += sp * (mb * (1 - iri) + fc[2] * iri * 1.1);
            if (optic.sheen > 0) {
                // Broad sheen lobe (light-dependent) and slope rim (view-dependent: grazing toward the edges).
                const lobe = Math.pow(ndh, 8) * 0.14 * (0.3 + 0.7 * shadow[p]);
                const rim = Math.pow(slope, 1.4) * 0.09 * (0.5 + 0.5 * occl);
                const sh = optic.sheen;
                R += sh * (lobe * fc[0] + rim * fc2[0]);
                G += sh * (lobe * fc[1] + rim * fc2[1]);
                B += sh * (lobe * fc[2] + rim * fc2[2]);
            }
            const ridge = optic.ridge * convex * 0.45 * Math.max(0, ndl - 0.2) * (0.3 + 0.7 * shadow[p]);
            if (ridge > 0) {
                const rr = iri > 0.3 ? fc : [mr, mg, mb];
                R += ridge * rr[0] * 0.8;
                G += ridge * rr[1] * 0.8;
                B += ridge * rr[2] * 0.8;
            }
            col[p * 3] = R * expo;
            col[p * 3 + 1] = G * expo;
            col[p * 3 + 2] = B * expo;
        }
    }
    // Emission with a soft bloom (inside the body only; the overlays add the outer glow). Seams are baked dimly.
    const emiAll = new Float32Array(nn * 3);
    for (let q = 0; q < nn * 3; q++) emiAll[q] = cv.emi[q] + cv.pulse[q] * 0.6;
    const bloom = blur3(emiAll, n, Math.max(1, Math.round(3.5 * k)));
    const out = new Uint8ClampedArray(nn * 4);
    for (let p = 0; p < nn; p++) {
        if (!cov[p]) continue;
        const r = tone(col[p * 3] + emiAll[p * 3] + bloom[p * 3] * 0.8);
        const g = tone(col[p * 3 + 1] + emiAll[p * 3 + 1] + bloom[p * 3 + 1] * 0.8);
        const b = tone(col[p * 3 + 2] + emiAll[p * 3 + 2] + bloom[p * 3 + 2] * 0.8);
        out[p * 4] = Math.round(r * 255);
        out[p * 4 + 1] = Math.round(g * 255);
        out[p * 4 + 2] = Math.round(b * 255);
        out[p * 4 + 3] = 255;
    }
    // The pulsing glow: the seam layer, bloomed wider, as a soft straight-alpha image.
    const gl = blur3(cv.pulse, n, Math.max(1, Math.round(5 * k)));
    const glow = new Uint8ClampedArray(nn * 4);
    for (let p = 0; p < nn; p++) {
        const r = cv.pulse[p * 3] * 0.6 + gl[p * 3] * 1.6;
        const g = cv.pulse[p * 3 + 1] * 0.6 + gl[p * 3 + 1] * 1.6;
        const b = cv.pulse[p * 3 + 2] * 0.6 + gl[p * 3 + 2] * 1.6;
        const a = Math.max(r, g, b);
        if (a < 0.01) continue;
        glow[p * 4] = Math.round(Math.min(1, r / a) * 255);
        glow[p * 4 + 1] = Math.round(Math.min(1, g / a) * 255);
        glow[p * 4 + 2] = Math.round(Math.min(1, b / a) * 255);
        glow[p * 4 + 3] = Math.round(Math.min(1, a) * 255);
    }
    return { img: { w: n, h: n, data: out }, glow: { w: n, h: n, data: glow } };
}

/** Soft shoulder above 0.7. */
function tone(v: number): number {
    if (v <= 0) return 0;
    if (v < 0.7) return v;
    return 0.7 + 0.3 * (1 - Math.exp(-(v - 0.7) / 0.3));
}

/** Two box-blur passes (≈ gaussian) of a 3-channel buffer. */
export function blur3(src: Float32Array, n: number, r: number): Float32Array {
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
