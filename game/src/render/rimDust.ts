// 19i item 3 (art pass): procedural rim dust — the dark lanes, cross wisps, their close-up detail and the murk
// material, all from one noise language.
//
// Pure maths, no DOM / Pixi: the layer (rimAtmosphereLayer.ts) turns the RGBA buffers into canvas textures once at
// mount. Everything is deterministic in its seed (a local mulberry32, never galaxy.rnd).
//
// Technique:
//   - two tileable fbm grids of value noise, built row-wise (the y-lerp of each octave's lattice is shared across a
//     row, so an octave costs a couple of loads per pixel): a detailed base field F and a smooth warp field G;
//   - per variant, F is sampled through a two-stage domain warp (IQ-style f(p + k·g(p)), then p + k·f(p)), with an
//     anisotropic window (lanes sample F stretched along x, so structure runs along the lane);
//   - density = mix(body, ridged filaments) where the ridges are the |2n−1| valleys of the warped field (thin curved
//     strands), pulled towards zero by a noise-perturbed elliptical envelope before thresholding, so a lane breaks up
//     into wisps towards its ends instead of fading uniformly;
//   - alpha = smoothstep(threshold, threshold + feather, density) × envelope × border fade: every edge dissolves over
//     a wide falloff and alpha is exactly 0 on the texture border (no sprite rectangle ever shows);
//   - colour is a multiply filter (cold blue-grey at the thin edges, near-black in the cores), so drawn with
//     blendMode 'multiply' the dust can only darken and cool what is behind it;
//   - an optional rim-light buffer: the lit (+v, towards the galaxy core once placed) side of filament edges.

/** Deterministic render-side PRNG (mulberry32) — never galaxy.rnd. */
export function rimRandom(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function smoothstep(a: number, b: number, v: number): number {
    const t = (v - a) / (b - a);
    const k = t < 0 ? 0 : t > 1 ? 1 : t;
    return k * k * (3 - 2 * k);
}

/**
 * Tileable fbm of value noise on a `size`² grid (size a power of two), normalised to [0, 1]. Octave o uses a lattice
 * of (basePeriod · 2^o)² random values; each octave's amplitude is gain^o.
 */
export function fbmGrid(size: number, basePeriod: number, octaves: number, seed: number, gain = 0.5): Float32Array {
    const out = new Float32Array(size * size);
    const xi = new Int32Array(size);
    const xw = new Float32Array(size);
    let amp = 1;
    for (let o = 0; o < octaves; o++) {
        const p = Math.min(size, basePeriod << o);
        const rnd = rimRandom((seed + Math.imul(o + 1, 0x9e3779b1)) >>> 0);
        const lat = new Float32Array(p * p);
        for (let i = 0; i < lat.length; i++) lat[i] = rnd();
        const scale = p / size;
        for (let x = 0; x < size; x++) {
            const fx = x * scale;
            const i = Math.floor(fx);
            const t = fx - i;
            xi[x] = i;
            xw[x] = t * t * (3 - 2 * t);
        }
        const row = new Float32Array(p + 1);
        for (let y = 0; y < size; y++) {
            const fy = y * scale;
            const j = Math.floor(fy);
            let sy = fy - j;
            sy = sy * sy * (3 - 2 * sy);
            const r0 = j * p;
            const r1 = ((j + 1) % p) * p;
            for (let k = 0; k < p; k++) {
                const a = lat[r0 + k];
                row[k] = a + (lat[r1 + k] - a) * sy;
            }
            row[p] = row[0];
            const base = y * size;
            for (let x = 0; x < size; x++) {
                const i = xi[x];
                const a = row[i];
                out[base + x] += amp * (a + (row[i + 1] - a) * xw[x]);
            }
        }
        amp *= gain;
    }
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < out.length; i++) {
        const v = out[i];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
    }
    const k = hi > lo ? 1 / (hi - lo) : 0;
    for (let i = 0; i < out.length; i++) out[i] = (out[i] - lo) * k;
    return out;
}

/** Bilinear sample of a tileable n² grid (n a power of two) at grid-pixel coordinates (wraps). */
export function sampleWrap(g: Float32Array, n: number, x: number, y: number): number {
    const mask = n - 1;
    const xf = Math.floor(x);
    const yf = Math.floor(y);
    const tx = x - xf;
    const ty = y - yf;
    const x0 = xf & mask;
    const x1 = (x0 + 1) & mask;
    const y0 = (yf & mask) * n;
    const y1 = ((yf + 1) & mask) * n;
    const a = g[y0 + x0];
    const b = g[y0 + x1];
    const c = g[y1 + x0];
    const d = g[y1 + x1];
    const ab = a + (b - a) * tx;
    return ab + (c + (d - c) * tx - ab) * ty;
}

/** Envelope falloff by normalised radius r (0 = centre, 1 = the envelope edge): 1 in the core, eases to 0 by r = 1,
 * monotonic non-increasing. */
export function edgeFalloff(r: number): number {
    return 1 - smoothstep(0.3, 1, r);
}

/** Fade by distance (texture-fraction, from the outermost texel) to the nearest border: 0 on the border, 1 past
 * DUST_BORDER.
 * Upper bound of every generated alpha, so no sprite edge can ever show. Monotonic in d. */
export const DUST_BORDER = 0.14;
export function borderFade(d: number): number {
    return smoothstep(0, DUST_BORDER, d);
}

export type DustKind = 'lane' | 'wisp' | 'detail';

/** One texture variant's look. */
export interface DustVariantSpec {
    kind: DustKind;
    seed: number;
    /** Window of the base field the texture covers, in base-field widths (x, y). x < y stretches structure along x. */
    spanX: number;
    spanY: number;
    /** Warp amplitudes, in base-field widths: stage 1 (smooth field) and stage 2 (self-warp — curls the strands). */
    warp1: number;
    warp2: number;
    /** Warp field frequency (cycles of G over the texture). */
    warpFreq: number;
    /** 0 = soft clumps only, 1 = filaments only. */
    ridge: number;
    /** Ridge sharpness exponent (higher = thinner strands). */
    ridgePow: number;
    /** Density threshold where alpha starts, and the feather width above it. */
    threshold: number;
    feather: number;
    /** Envelope half-axes (fractions of the half texture) and how much noise perturbs its boundary. */
    envX: number;
    envY: number;
    envNoise: number;
    /** Also build the rim-light buffer (lanes only: lit side = +v). */
    rim: boolean;
}

/** Lane / wisp / detail variants (the layer draws lanes tangentially, wisps across them, detail along the lanes and
 * as the murk). */
export const DUST_VARIANTS: readonly DustVariantSpec[] = [
    { kind: 'lane', seed: 0x5eed01, spanX: 0.55, spanY: 1.3, warp1: 0.16, warp2: 0.09, warpFreq: 1.5, ridge: 0.45, ridgePow: 3, threshold: 0.22, feather: 0.36, envX: 0.96, envY: 0.6, envNoise: 0.38, rim: true },
    { kind: 'lane', seed: 0x5eed02, spanX: 0.45, spanY: 1.1, warp1: 0.2, warp2: 0.12, warpFreq: 2, ridge: 0.55, ridgePow: 3, threshold: 0.2, feather: 0.36, envX: 0.94, envY: 0.55, envNoise: 0.42, rim: false },
    { kind: 'lane', seed: 0x5eed03, spanX: 0.6, spanY: 1.4, warp1: 0.14, warp2: 0.15, warpFreq: 1.2, ridge: 0.4, ridgePow: 2, threshold: 0.24, feather: 0.38, envX: 0.97, envY: 0.62, envNoise: 0.35, rim: true },
    { kind: 'wisp', seed: 0x5eed04, spanX: 0.65, spanY: 0.95, warp1: 0.24, warp2: 0.15, warpFreq: 2.2, ridge: 0.7, ridgePow: 3, threshold: 0.25, feather: 0.36, envX: 0.9, envY: 0.6, envNoise: 0.5, rim: false },
    { kind: 'detail', seed: 0x5eed05, spanX: 1.3, spanY: 1.3, warp1: 0.24, warp2: 0.16, warpFreq: 2.5, ridge: 0.7, ridgePow: 2, threshold: 0.24, feather: 0.4, envX: 0.9, envY: 0.9, envNoise: 0.45, rim: false },
];

/** Texture side (px) for the lane / wisp / detail variants; rim-light buffers are half this. */
export const DUST_TEX_SIZE = 1024;
/** Side of the CPU sampling grid kept per variant (density look-ups for placement, murk, grading). */
export const DUST_SAMPLE_SIZE = 128;

// Multiply colours (0..255): thin edges cool the scene, dense cores take it towards black.
const ER = 96;
const EG = 108;
const EB = 160;
const DR = 14 - ER;
const DG = 14 - EG;
const DB = 22 - EB;

export interface DustTextureData {
    spec: DustVariantSpec;
    size: number;
    /** Straight (non-premultiplied) RGBA, multiply-filter colour + coverage. */
    rgba: Uint8ClampedArray;
    /** Rim-light RGBA at size/2 (cold, additive), or null. */
    rim: Uint8ClampedArray | null;
    rimSize: number;
    /** Coverage downsampled to DUST_SAMPLE_SIZE² for CPU look-ups (0..1). */
    sample: Float32Array;
}

/** Shared noise fields (built once per mount; every variant samples them through its own window + warps). */
export interface DustFields {
    base: Float32Array;
    baseN: number;
    warp: Float32Array;
    warpN: number;
}

export function dustFields(seed: number): DustFields {
    const baseN = 512;
    const warpN = 128;
    return {
        base: fbmGrid(baseN, 4, 7, seed ^ 0xba5e, 0.52),
        baseN,
        warp: fbmGrid(warpN, 3, 4, seed ^ 0x3a4b, 0.5),
        warpN,
    };
}

/**
 * Coverage (0..1) of one variant on a size² texture (size a multiple of 4). Deterministic in (fields, spec). Every
 * value is ≤ borderFade(distance to the nearest border) — 0 on the border.
 *
 * Two passes. Pass 1 (quarter resolution): the domain-warped field values — the expensive part, four field samples
 * per texel — which are smooth by construction (the base field's finest octave spans several texels). Pass 2 (full
 * resolution): upsample them bilinearly, then build the ridged strands (|2n − 1| valleys), add a fine octave read
 * straight from the base field (one load) and threshold. The non-linear steps all run at full resolution, so the
 * strands' edges are as sharp as the texture allows (like upscaling a distance field) — nothing reads as magnified.
 * Writes the multiply-colour RGBA into `rgba` when given.
 */
export function dustAlpha(fields: DustFields, spec: DustVariantSpec, size: number, rgba: Uint8ClampedArray | null = null): Float32Array {
    const { base: F, baseN: N, warp: G, warpN: NG } = fields;
    const rnd = rimRandom(spec.seed);
    const ox = rnd() * N;
    const oy = rnd() * N;
    const gx1 = rnd() * NG;
    const gy1 = rnd() * NG;
    const gx2 = rnd() * NG;
    const gy2 = rnd() * NG;
    const fox = Math.floor(rnd() * N);
    const foy = Math.floor(rnd() * N);
    const sx = spec.spanX * N;
    const sy = spec.spanY * N;
    const w1 = spec.warp1 * N;
    const w2 = spec.warp2 * N;
    const gf = spec.warpFreq * NG;
    const ridge = spec.ridge;
    const rp = Math.max(1, Math.round(spec.ridgePow));
    const iex = 2 / spec.envX;
    const iey = 2 / spec.envY;
    const en = spec.envNoise;

    // Pass 1 (quarter resolution, +1 guard texel): body B (the stage-1 warped value), strand field S (the
    // self-warped value) and envelope E.
    const STEP = 4;
    const Q = size / STEP + 1;
    const B = new Float32Array(Q * Q);
    const S = new Float32Array(Q * Q);
    const E = new Float32Array(Q * Q);
    // Per quarter-res row: the first / last column with any envelope (pass 2 skips the rest of the row).
    const rowLo = new Int32Array(Q).fill(Q);
    const rowHi = new Int32Array(Q).fill(-1);
    const qInv = STEP / size;
    for (let y = 0; y < Q; y++) {
        const v = y * qInv;
        const dy = (v - 0.5) * iey;
        const dy2 = dy * dy;
        for (let x = 0; x < Q; x++) {
            const u = x * qInv;
            const dx = (u - 0.5) * iex;
            const r0 = dx * dx + dy2;
            // Outside the widest possible perturbed ellipse (plus a texel of guard): nothing to compute.
            if (Math.sqrt(r0) * (1 - en) >= 1 + qInv * 4) continue;
            // The stage-1 warp field doubles as the envelope's boundary noise.
            const qx = sampleWrap(G, NG, u * gf + gx1, v * gf + gy1) - 0.5;
            const r = Math.sqrt(r0) * (1 + en * qx * 2);
            const env = edgeFalloff(r);
            const qy = sampleWrap(G, NG, u * gf + gx2, v * gf + gy2) - 0.5;
            const px = u * sx + ox + w1 * qx;
            const py = v * sy + oy + w1 * qy;
            const n1 = sampleWrap(F, N, px, py);
            const n = sampleWrap(F, N, px + w2 * (n1 - 0.5), py + w2 * 0.6 * (n1 - 0.5) + 97);
            const i = y * Q + x;
            B[i] = n1;
            S[i] = n;
            E[i] = env;
            if (env > 0) {
                if (x < rowLo[y]) rowLo[y] = x;
                rowHi[y] = x;
            }
        }
    }

    // Pass 2 (full resolution): upsample, ridged strands, fine octave, feathered threshold × envelope × border fade.
    const out = new Float32Array(size * size);
    const bf = new Float32Array(size);
    const xi = new Int32Array(size);
    const xw = new Float32Array(size);
    for (let x = 0; x < size; x++) {
        // Texel distance to the nearest border, so the outermost texels are exactly 0.
        bf[x] = borderFade(Math.min(x, size - 1 - x) / size);
        const hx = x / STEP;
        xi[x] = Math.min(Q - 2, Math.floor(hx));
        xw[x] = hx - xi[x];
    }
    const mask = N - 1;
    const th = spec.threshold;
    const inv = 1 / spec.feather;
    const fine = 0.22;
    for (let y = 0; y < size; y++) {
        const bv = bf[y];
        if (bv <= 0) continue;
        const hy = y / STEP;
        const j = Math.min(Q - 2, Math.floor(hy));
        const ty = hy - j;
        const r0 = j * Q;
        const r1 = r0 + Q;
        const lo = Math.min(rowLo[j], rowLo[j + 1]);
        const hi = Math.max(rowHi[j], rowHi[j + 1]);
        if (hi < 0) continue;
        // Fine octave: the base field read at half scale (bilinear on the 2× grid: four loads, no filtering maths).
        const fr0 = (((y >> 1) + foy) & mask) * N;
        const fr1 = (((y >> 1) + foy + 1) & mask) * N;
        const fty = (y & 1) * 0.5;
        const orow = y * size;
        const xEnd = Math.min(size, (hi + 1) * STEP + 1);
        for (let x = Math.max(0, (lo - 1) * STEP); x < xEnd; x++) {
            const bu = bf[x];
            if (bu <= 0) continue;
            const i0 = r0 + xi[x];
            const i1 = r1 + xi[x];
            const tx = xw[x];
            let a0 = E[i0] + (E[i0 + 1] - E[i0]) * tx;
            let a1 = E[i1] + (E[i1 + 1] - E[i1]) * tx;
            const env = a0 + (a1 - a0) * ty;
            if (env <= 0) continue;
            a0 = S[i0] + (S[i0 + 1] - S[i0]) * tx;
            a1 = S[i1] + (S[i1 + 1] - S[i1]) * tx;
            const n = a0 + (a1 - a0) * ty;
            a0 = B[i0] + (B[i0 + 1] - B[i0]) * tx;
            a1 = B[i1] + (B[i1 + 1] - B[i1]) * tx;
            const body = a0 + (a1 - a0) * ty;
            const r1v = 1 - Math.abs(2 * n - 1);
            let rg = r1v;
            for (let k = 1; k < rp; k++) rg *= r1v;
            const d = (body + (rg - body) * ridge) * (0.45 + 0.55 * env) + fine * (fineAt(F, fr0, fr1, fty, (x >> 1) + fox, (x & 1) * 0.5, mask) - 0.5) * env;
            let t = (d - th) * inv;
            if (t <= 0) continue;
            if (t > 1) t = 1;
            const a = t * t * (3 - 2 * t) * env * bu * bv;
            out[orow + x] = a;
            if (rgba !== null) {
                // Multiply colour: cold at the thin edges, near-black in the cores. Transparent texels stay 0
                // (premultiplied on upload, their colour never shows).
                let k = (a - 0.08) * 1.3;
                k = k < 0 ? 0 : k > 1 ? 1 : k * k * (3 - 2 * k);
                const o = (orow + x) << 2;
                rgba[o] = ER + DR * k;
                rgba[o + 1] = EG + DG * k;
                rgba[o + 2] = EB + DB * k;
                rgba[o + 3] = a * 255 + 0.5;
            }
        }
    }
    return out;
}

function fineAt(F: Float32Array, r0: number, r1: number, ty: number, x: number, tx: number, mask: number): number {
    const x0 = x & mask;
    const x1 = (x + 1) & mask;
    const a = F[r0 + x0] + (F[r0 + x1] - F[r0 + x0]) * tx;
    const b = F[r1 + x0] + (F[r1 + x1] - F[r1 + x0]) * tx;
    return a + (b - a) * ty;
}

/** Full texture data for one variant: multiply-colour RGBA, optional rim light, CPU sample grid. */
export function buildDustTexture(fields: DustFields, spec: DustVariantSpec, size: number): DustTextureData {
    const rgba = new Uint8ClampedArray(size * size * 4);
    const alpha = dustAlpha(fields, spec, size, rgba);
    // Rim light at half size: pixels whose +v neighbour (towards the core once placed) is thinner, on the thin side
    // of the edge only.
    let rim: Uint8ClampedArray | null = null;
    const rimSize = size >> 1;
    if (spec.rim) {
        rim = new Uint8ClampedArray(rimSize * rimSize * 4);
        const d = Math.max(2, size >> 7);
        for (let y = 0; y < rimSize; y++) {
            const sy = y * 2;
            const ny = Math.min(size - 1, sy + d);
            for (let x = 0; x < rimSize; x++) {
                const sx = x * 2;
                const a = alpha[sy * size + sx];
                const an = alpha[ny * size + sx];
                const e = (a - an) * 4;
                const l = e <= 0 ? 0 : (e > 1 ? 1 : e) * (1 - a) * (1 - a);
                const j = (y * rimSize + x) * 4;
                rim[j] = 150;
                rim[j + 1] = 178;
                rim[j + 2] = 255;
                rim[j + 3] = l * 255 + 0.5;
            }
        }
    }
    const S = DUST_SAMPLE_SIZE;
    const sample = new Float32Array(S * S);
    const step = size / S;
    for (let y = 0; y < S; y++) {
        const sy = Math.min(size - 1, Math.floor((y + 0.5) * step));
        for (let x = 0; x < S; x++) {
            const sx = Math.min(size - 1, Math.floor((x + 0.5) * step));
            sample[y * S + x] = alpha[sy * size + sx];
        }
    }
    return { spec, size, rgba, rim, rimSize, sample };
}

/** Coverage of a variant's sample grid at texture coordinates (u, v) in [0, 1] (0 outside). */
export function sampleCoverage(sample: Float32Array, u: number, v: number): number {
    if (u <= 0 || v <= 0 || u >= 1 || v >= 1) return 0;
    const S = DUST_SAMPLE_SIZE;
    const x = u * S - 0.5;
    const y = v * S - 0.5;
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(S - 1, x0 + 1);
    const y1 = Math.min(S - 1, y0 + 1);
    const tx = Math.min(1, Math.max(0, x - x0));
    const ty = Math.min(1, Math.max(0, y - y0));
    const a = sample[y0 * S + x0];
    const b = sample[y0 * S + x1];
    const c = sample[y1 * S + x0];
    const d = sample[y1 * S + x1];
    const ab = a + (b - a) * tx;
    return ab + (c + (d - c) * tx - ab) * ty;
}

// --- placement ---------------------------------------------------------------------------------------------------

/** One dust sprite in world space (the texture's x axis along `rotation`; +v points towards the galaxy centre for
 * lanes, so their rim light faces the core). */
export interface DustSprite {
    x: number;
    y: number;
    rotation: number;
    /** World size along the texture's x / y axes. */
    length: number;
    width: number;
    /** Mirror the texture along x (variety without flipping the lit side). */
    flip: boolean;
    variant: number;
    /** Relative opacity 0..1 (times the layer's dust strength). */
    alpha: number;
    kind: DustKind;
}

export interface DustPlacementOptions {
    cx: number;
    cy: number;
    radius: number;
    /** Band of rim fractions the lanes' centres lie in. */
    lo: number;
    hi: number;
    lanes: number;
    wisps: number;
    seed: number;
}

function variantsOf(kind: DustKind): number[] {
    const out: number[] = [];
    DUST_VARIANTS.forEach((v, i) => {
        if (v.kind === kind) out.push(i);
    });
    return out;
}

const DETAIL_V = variantsOf('detail');
const WISP_V = variantsOf('wisp');

/**
 * Lanes run tangentially around the ring (rotation = the tangent at their angle ± a little), strata-jittered so the
 * ring is covered without regular spacing; wisps sit across them (roughly radial ± 35°), shorter and fainter.
 */
export function placeDustLanes(o: DustPlacementOptions): DustSprite[] {
    const rnd = rimRandom(o.seed ^ 0xd057);
    const out: DustSprite[] = [];
    const laneV = variantsOf('lane');
    const wispV = variantsOf('wisp');
    const span = Math.max(0.01, o.hi - o.lo);
    for (let i = 0; i < o.lanes; i++) {
        const th = ((i + 0.15 + rnd() * 0.7) / o.lanes) * Math.PI * 2;
        // Biased inwards: the inner band has the most backdrop / deep field to occlude.
        const f = o.lo + span * Math.pow(rnd(), 1.3);
        const length = o.radius * (0.3 + rnd() * 0.32);
        const width = length * (0.3 + rnd() * 0.16);
        out.push({
            x: o.cx + Math.cos(th) * f * o.radius,
            y: o.cy + Math.sin(th) * f * o.radius,
            // Texture +y (v) must point inwards: rotation r maps local +y to (−sin r, cos r); r = θ + π/2 gives
            // (−cos θ, −sin θ), i.e. towards the centre.
            rotation: th + Math.PI / 2 + (rnd() - 0.5) * 0.3,
            length,
            width,
            flip: rnd() < 0.5,
            variant: laneV[Math.floor(rnd() * laneV.length)],
            alpha: 0.7 + rnd() * 0.3,
            kind: 'lane',
        });
    }
    for (let i = 0; i < o.wisps; i++) {
        const th = rnd() * Math.PI * 2;
        const f = o.lo + span * (0.2 + rnd() * 0.75);
        const length = o.radius * (0.12 + rnd() * 0.12);
        out.push({
            x: o.cx + Math.cos(th) * f * o.radius,
            y: o.cy + Math.sin(th) * f * o.radius,
            rotation: th + (rnd() - 0.5) * 1.2,
            length,
            width: length * (0.45 + rnd() * 0.2),
            flip: rnd() < 0.5,
            variant: wispV[Math.floor(rnd() * wispV.length)],
            alpha: 0.5 + rnd() * 0.3,
            kind: 'wisp',
        });
    }
    return out;
}

/** Texture coordinates (u, v) of world point (x, y) under sprite `s` (may be outside [0, 1]). */
export function dustLocal(s: DustSprite, x: number, y: number): { u: number; v: number } {
    const dx = x - s.x;
    const dy = y - s.y;
    const c = Math.cos(s.rotation);
    const n = Math.sin(s.rotation);
    let lx = (dx * c + dy * n) / s.length;
    const ly = (-dx * n + dy * c) / s.width;
    if (s.flip) lx = -lx;
    return { u: lx + 0.5, v: ly + 0.5 };
}

/** Combined coverage (0..1) of `sprites` at world (x, y): 1 − Π(1 − alpha·coverage), as stacked multiply layers. */
export function dustCoverageAt(sprites: readonly DustSprite[], samples: readonly Float32Array[], x: number, y: number): number {
    let clear = 1;
    for (const s of sprites) {
        const r = Math.max(s.length, s.width) * 0.71;
        if (Math.abs(x - s.x) > r || Math.abs(y - s.y) > r) continue;
        const { u, v } = dustLocal(s, x, y);
        const c = sampleCoverage(samples[s.variant], u, v);
        if (c > 0) clear *= 1 - s.alpha * c;
    }
    return 1 - clear;
}

// --- close-up detail: a world-anchored cell grid per level (like mip levels of the same dust) -------------------

/** One detail level: a world grid of `cell`-sized cells, each drawing one sprite ~`size` across (cells overlap, are
 * jittered and randomly rotated, so no lattice shows). Absolute world units: systems are the same size in every
 * galaxy, and the finest level is what a system-zoom view needs. */
export interface DustLevel {
    cell: number;
    size: number;
}

export const DUST_DETAIL_LEVELS: readonly DustLevel[] = [
    { cell: 320_000, size: 560_000 },
    { cell: 80_000, size: 140_000 },
    { cell: 20_000, size: 35_000 },
];

/**
 * Level-of-detail window by on-screen texel size (CSS px per texture texel): fades in once a texel is ≥ 0.3 px
 * (finer would need too many sprites for detail nobody can see), full from 0.6 px, fades out between 2.5 and 5 px
 * (magnified past that it would look soft — the next finer level has taken over by then).
 */
export function lodWindow(texelPx: number): number {
    return smoothstep(0.3, 0.6, texelPx) * (1 - smoothstep(2.5, 5, texelPx));
}

/** Lanes only fade out on the magnified side, to a floor (they carry the large-scale shape everywhere). */
export const LANE_LOD_FLOOR = 0.45;
export function laneLod(texelPx: number): number {
    return LANE_LOD_FLOOR + (1 - LANE_LOD_FLOOR) * (1 - smoothstep(2.5, 5, texelPx));
}

/** Deterministic hash of (seed, level, ix, iy). */
function cellHash(seed: number, level: number, ix: number, iy: number): number {
    let h = (seed ^ Math.imul(level + 1, 0x27d4eb2f)) >>> 0;
    h = Math.imul(h ^ (ix | 0), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13) ^ (iy | 0), 0xc2b2ae35) >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
}

/**
 * The detail sprite of cell (ix, iy) at `level` (centre jittered inside the cell, random rotation / mirror / size,
 * mostly the detail variant with some wisps mixed in). Deterministic: the same cell always draws the same sprite, so
 * panning never reshuffles the dust. Writes into `out` (no allocation per frame).
 */
export function detailCell(level: number, ix: number, iy: number, seed: number, out: DustSprite): DustSprite {
    const L = DUST_DETAIL_LEVELS[level];
    const rnd = rimRandom(cellHash(seed, level, ix, iy));
    out.x = (ix + 0.5 + (rnd() - 0.5) * 0.8) * L.cell;
    out.y = (iy + 0.5 + (rnd() - 0.5) * 0.8) * L.cell;
    out.rotation = rnd() * Math.PI * 2;
    const size = L.size * (0.8 + rnd() * 0.4);
    out.length = size * (1 + rnd() * 0.3);
    out.width = size;
    out.flip = rnd() < 0.5;
    const detail = DETAIL_V;
    const wisp = WISP_V;
    out.variant = rnd() < 0.7 || wisp.length === 0 ? detail[Math.floor(rnd() * detail.length)] : wisp[Math.floor(rnd() * wisp.length)];
    out.alpha = 0.75 + rnd() * 0.25;
    out.kind = 'detail';
    return out;
}
