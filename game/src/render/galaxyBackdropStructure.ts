// Galaxy structure for the generated galaxy backdrops (galaxyBackdrop.ts; render-only, no Pixi, no sim writes).
//
// The backdrops are drawn to line up with the real star layout, so they are driven by what the galaxy actually holds:
// - a star-density grid over the galaxy rectangle (every system's star position, bilinear splat), blurred at three
//   radii (fine / mid / broad) and packed into one RGBA8 texture (R fine, G mid, B broad);
// - the centre the glow and the swirl turn about (the densest point of the broad blur for centred shapes; the centroid
//   of every star for a ring, whose core is nearly empty);
// - the shape's orientation and flattening (second moments about the centre), its core radius (the radius holding the
//   inner fifth of the stars) and outer radius (90%);
// - for a spiral, the arm count / pitch / handedness (seeded from the galaxy seed) and the arm phase that best matches
//   the density, so the arms sit on the stars.
// It also makes the shared tileable noise texture (four independent periodic fBm channels, seeded) and, for the
// wizard's thumbnail before any galaxy exists, a synthetic star layout per shape.

import { GalaxyShape } from '../sim/types';

/** Density grid side (cells). */
export const DENSITY_SIZE = 128;
/** Noise texture side (texels; periodic). */
export const NOISE_SIZE = 256;

export interface BackdropStructure {
    /** RGBA8, DENSITY_SIZE², row-major from the galaxy's top-left (uv 0,0): R fine, G mid, B broad blur, A 255. */
    density: Uint8Array;
    /** Centre in galaxy uv (0..1). */
    centre: [number, number];
    /** Galaxy rectangle aspect: (sizeX, sizeY) / max(sizeX, sizeY). */
    aspect: [number, number];
    /** 0 spiral, 1 elliptical, 2 ring, 3 irregular, 4 clusters. */
    shape: number;
    /** Arms: count, log-spiral winding (1 / tan(pitch)), phase (rad), handedness (+1 / -1). */
    arm: [number, number, number, number];
    /** Major axis (cos, sin), minor / major ratio, core radius (centred units: 1 = half the larger side). */
    ell: [number, number, number, number];
    /** Core brightness weight, outer (90%) radius, galaxy seed noise offsets (0..1). */
    misc: [number, number, number, number];
}

/** Small, well-mixed 32-bit PRNG (mulberry32): render-side only, never the sim's Random. */
export function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function shapeCode(shape: GalaxyShape): number {
    switch (shape) {
        case GalaxyShape.Spiral:
            return 0;
        case GalaxyShape.Elliptical:
            return 1;
        case GalaxyShape.Ring:
            return 2;
        case GalaxyShape.Irregular:
            return 3;
        default:
            return 4;
    }
}

/** Separable Gaussian blur of an n×n grid (clamped edges), sigma in cells. */
function blur(src: Float32Array, n: number, sigma: number): Float32Array {
    const rad = Math.max(1, Math.ceil(sigma * 3));
    const k = new Float32Array(2 * rad + 1);
    let ks = 0;
    for (let i = -rad; i <= rad; i++) ks += k[i + rad] = Math.exp(-(i * i) / (2 * sigma * sigma));
    for (let i = 0; i < k.length; i++) k[i] /= ks;
    const tmp = new Float32Array(n * n);
    const out = new Float32Array(n * n);
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            let s = 0;
            for (let i = -rad; i <= rad; i++) s += k[i + rad] * src[y * n + Math.min(n - 1, Math.max(0, x + i))];
            tmp[y * n + x] = s;
        }
    }
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            let s = 0;
            for (let i = -rad; i <= rad; i++) s += k[i + rad] * tmp[Math.min(n - 1, Math.max(0, y + i)) * n + x];
            out[y * n + x] = s;
        }
    }
    return out;
}

function quantile(values: Float32Array, q: number): number {
    const sorted = Array.from(values).sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))];
}

/**
 * The structure of a galaxy from its star positions (`xs`, `ys` in galaxy units over a sizeX × sizeY rectangle), its
 * shape setting and seed.
 */
export function analyzeGalaxyStructure(xs: ArrayLike<number>, ys: ArrayLike<number>, sizeX: number, sizeY: number, shape: GalaxyShape, seed: number): BackdropStructure {
    const n = DENSITY_SIZE;
    const count = Math.min(xs.length, ys.length);
    const sx = sizeX > 0 ? sizeX : 1;
    const sy = sizeY > 0 ? sizeY : 1;
    const big = Math.max(sx, sy);
    const aspect: [number, number] = [sx / big, sy / big];
    const code = shapeCode(shape);
    const grid = new Float32Array(n * n);
    for (let i = 0; i < count; i++) {
        const gx = (xs[i] / sx) * n - 0.5;
        const gy = (ys[i] / sy) * n - 0.5;
        const x0 = Math.floor(gx);
        const y0 = Math.floor(gy);
        const fx = gx - x0;
        const fy = gy - y0;
        for (let dy = 0; dy <= 1; dy++) {
            for (let dx = 0; dx <= 1; dx++) {
                const x = x0 + dx;
                const y = y0 + dy;
                if (x < 0 || y < 0 || x >= n || y >= n) continue;
                grid[y * n + x] += (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
            }
        }
    }
    // Blur radii scale with the grid, not the star count: a sparse galaxy gets the same smooth body.
    const fine = blur(grid, n, 1.3);
    const mid = blur(grid, n, 3.6);
    const broad = blur(grid, n, 9);
    const norm = (a: Float32Array, q: number): Float32Array => {
        const top = Math.max(1e-6, quantile(a, q));
        const out = new Float32Array(a.length);
        for (let i = 0; i < a.length; i++) out[i] = Math.min(1, Math.sqrt(a[i] / top));
        return out;
    };
    const fineN = norm(fine, 0.985);
    const midN = norm(mid, 0.995);
    const broadN = norm(broad, 1);
    const density = new Uint8Array(n * n * 4);
    for (let i = 0; i < n * n; i++) {
        density[i * 4] = Math.round(fineN[i] * 255);
        density[i * 4 + 1] = Math.round(midN[i] * 255);
        density[i * 4 + 2] = Math.round(broadN[i] * 255);
        density[i * 4 + 3] = 255;
    }

    // Centre: a ring turns about its middle (the centroid of all stars); every other shape about its densest point —
    // the weighted centroid of the broad-blur cells within 85% of the peak.
    let cu = 0.5;
    let cv = 0.5;
    if (count > 0) {
        if (code === 2) {
            let ax = 0;
            let ay = 0;
            for (let i = 0; i < count; i++) {
                ax += xs[i];
                ay += ys[i];
            }
            cu = ax / count / sx;
            cv = ay / count / sy;
        } else {
            let peak = 0;
            for (let i = 0; i < n * n; i++) peak = Math.max(peak, broad[i]);
            let w = 0;
            let ax = 0;
            let ay = 0;
            for (let y = 0; y < n; y++) {
                for (let x = 0; x < n; x++) {
                    const v = broad[y * n + x];
                    if (v < peak * 0.85) continue;
                    const wt = v - peak * 0.85;
                    w += wt;
                    ax += wt * (x + 0.5);
                    ay += wt * (y + 0.5);
                }
            }
            if (w > 0) {
                cu = ax / w / n;
                cv = ay / w / n;
            }
        }
    }

    // Radii and second moments in centred units (1 = half the larger side), about the centre.
    const radii = new Float32Array(count);
    let mxx = 0;
    let myy = 0;
    let mxy = 0;
    for (let i = 0; i < count; i++) {
        const px = (xs[i] / sx - cu) * 2 * aspect[0];
        const py = (ys[i] / sy - cv) * 2 * aspect[1];
        radii[i] = Math.hypot(px, py);
        mxx += px * px;
        myy += py * py;
        mxy += px * py;
    }
    const rCore = count > 0 ? quantile(radii, 0.2) : 0.3;
    const rOuter = count > 0 ? quantile(radii, 0.9) : 0.9;
    let axisAngle = 0;
    let ratio = 1;
    if (count > 2) {
        mxx /= count;
        myy /= count;
        mxy /= count;
        const tr = mxx + myy;
        const det = mxx * myy - mxy * mxy;
        const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
        const l1 = tr / 2 + disc;
        const l2 = Math.max(1e-9, tr / 2 - disc);
        axisAngle = 0.5 * Math.atan2(2 * mxy, mxx - myy);
        ratio = Math.min(1, Math.max(0.45, Math.sqrt(l2 / Math.max(1e-9, l1))));
    }

    // Arms (used by the spiral; harmless elsewhere): count / pitch / handedness from the seed, phase fitted to the
    // mid-blur density over the disc between the core and the rim.
    const rnd = mulberry32((seed ^ 0x5bd1e995) >>> 0);
    const arms = [2, 2, 3, 4][Math.floor(rnd() * 4)];
    const pitchDeg = 13 + rnd() * 9;
    const wind = 1 / Math.tan((pitchDeg * Math.PI) / 180);
    const hand = rnd() < 0.5 ? -1 : 1;
    const noiseOffU = rnd();
    const noiseOffV = rnd();
    let bestPhase = 0;
    let bestScore = -Infinity;
    const steps = 48;
    const rMin = Math.max(0.08, rCore * 0.6);
    const rMax = Math.max(rMin + 0.1, rOuter);
    for (let s = 0; s < steps; s++) {
        const phase = (s / steps) * Math.PI * 2;
        let score = 0;
        for (let y = 0; y < n; y += 2) {
            for (let x = 0; x < n; x += 2) {
                const px = ((x + 0.5) / n - cu) * 2 * aspect[0];
                const py = ((y + 0.5) / n - cv) * 2 * aspect[1];
                const r = Math.hypot(px, py);
                if (r < rMin || r > rMax) continue;
                const psi = arms * (hand * Math.atan2(py, px) - Math.log(r) * wind) + phase;
                score += midN[y * n + x] * Math.cos(psi);
            }
        }
        if (score > bestScore) {
            bestScore = score;
            bestPhase = phase;
        }
    }

    const coreWeight = [1, 0.9, 0.3, 0.5, 0.55][code];
    return {
        density,
        centre: [cu, cv],
        aspect,
        shape: code,
        arm: [arms, wind, bestPhase, hand],
        ell: [Math.cos(axisAngle), Math.sin(axisAngle), ratio, Math.min(0.28, Math.max(0.05, rCore * 0.5))],
        misc: [coreWeight, Math.min(1.3, Math.max(0.35, rOuter)), noiseOffU, noiseOffV],
    };
}

/**
 * A star layout like the galaxy generator's for `shape` (Galaxy.5.cs SetupSun's distributions, simplified), for the
 * wizard's thumbnail before the galaxy exists. Not the real galaxy: only its look.
 */
export function syntheticStarLayout(shape: GalaxyShape, seed: number, count = 700): { xs: Float64Array; ys: Float64Array } {
    const rnd = mulberry32((seed * 2654435761) >>> 0);
    const xs = new Float64Array(count);
    const ys = new Float64Array(count);
    const S = 1;
    const sign = (): number => (rnd() < 0.5 ? -1 : 1);
    const radial = (r: number): [number, number] => {
        const a = rnd() * Math.PI * 2;
        return [S / 2 + Math.sin(a) * r, S / 2 + Math.cos(a) * r];
    };
    const spread = (): number => (Math.floor(2 + rnd() * 8) / 10) * (Math.floor(2 + rnd() * 8) / 10) * rnd() * (S / 2);
    const clusters: [number, number, number][] = [];
    const clusterCount = 6 + Math.floor(rnd() * 6);
    for (let c = 0; c < clusterCount; c++) clusters.push([0.12 + rnd() * 0.76, 0.12 + rnd() * 0.76, 0.03 + rnd() * 0.07]);
    for (let i = 0; i < count; i++) {
        let x = 0;
        let y = 0;
        switch (shape) {
            case GalaxyShape.Spiral:
                x = S / 2 + sign() * rnd() * rnd() * (S / 2);
                y = S / 2 + sign() * rnd() * rnd() * (S / 2);
                break;
            case GalaxyShape.Elliptical: {
                const roll = Math.floor(rnd() * 16);
                if (roll >= 10) {
                    x = S / 2 + sign() * spread();
                    y = S / 2 + sign() * spread();
                } else if (roll >= 5) [x, y] = radial(S / 2 - (S / 2) * rnd() * 0.1);
                else [x, y] = radial((S / 2) * (0.25 + rnd() * 0.6));
                break;
            }
            case GalaxyShape.Ring:
                if (Math.floor(rnd() * 20) >= 3) [x, y] = radial(S / 2 - (S / 2) * rnd() * 0.15);
                else {
                    x = S / 2 + sign() * spread();
                    y = S / 2 + sign() * spread();
                }
                break;
            case GalaxyShape.Irregular:
                x = rnd();
                y = rnd();
                break;
            default: {
                if (rnd() < 0.1) {
                    x = 0.02 + rnd() * 0.96;
                    y = 0.02 + rnd() * 0.96;
                } else {
                    const c = clusters[Math.floor(rnd() * clusters.length)];
                    const r = rnd() * c[2];
                    const a = rnd() * Math.PI * 2;
                    x = c[0] + Math.sin(a) * r;
                    y = c[1] + Math.cos(a) * r;
                }
            }
        }
        xs[i] = Math.min(0.985, Math.max(0.015, x));
        ys[i] = Math.min(0.985, Math.max(0.015, y));
    }
    return { xs, ys };
}

/** A float as IEEE half-float bits (round to nearest; the values here are 0..1). */
function toHalf(v: number): number {
    if (!(v > 0)) return 0;
    if (v >= 65504) return 0x7bff;
    let e = Math.floor(Math.log2(v));
    if (e < -14) return Math.round(v / 2 ** -24);
    let m = Math.round((v / 2 ** e - 1) * 1024);
    if (m === 1024) {
        m = 0;
        e++;
    }
    return ((e + 15) << 10) | m;
}

/**
 * The shared tileable noise texture (RGBA half float, NOISE_SIZE², periodic in both axes): four independent fBm
 * channels of periodic value noise (base period 8 cells, 4 octaves, quintic fade), each stretched to 0..1. Half float,
 * not 8-bit: the clouds magnify it several times and stretch its contrast, and 8-bit steps showed as grain.
 */
export function makeBackdropNoise(seed: number): Uint16Array {
    const n = NOISE_SIZE;
    const out = new Uint16Array(n * n * 4);
    const rnd = mulberry32((seed ^ 0x9e3779b9) >>> 0);
    const field = new Float32Array(n * n);
    for (let ch = 0; ch < 4; ch++) {
        field.fill(0);
        let amp = 0.5;
        for (let oct = 0; oct < 4; oct++) {
            const period = 8 << oct;
            const lat = new Float32Array(period * period);
            for (let i = 0; i < lat.length; i++) lat[i] = rnd();
            const cell = n / period;
            for (let y = 0; y < n; y++) {
                const gy = y / cell;
                const y0 = Math.floor(gy);
                let ty = gy - y0;
                ty = ty * ty * ty * (ty * (ty * 6 - 15) + 10);
                const r0 = (y0 % period) * period;
                const r1 = ((y0 + 1) % period) * period;
                for (let x = 0; x < n; x++) {
                    const gx = x / cell;
                    const x0 = Math.floor(gx);
                    let tx = gx - x0;
                    tx = tx * tx * tx * (tx * (tx * 6 - 15) + 10);
                    const c0 = x0 % period;
                    const c1 = (x0 + 1) % period;
                    const a = lat[r0 + c0] + (lat[r0 + c1] - lat[r0 + c0]) * tx;
                    const b = lat[r1 + c0] + (lat[r1 + c1] - lat[r1 + c0]) * tx;
                    field[y * n + x] += amp * (a + (b - a) * ty);
                }
            }
            amp *= 0.5;
        }
        let lo = Infinity;
        let hi = -Infinity;
        for (let i = 0; i < field.length; i++) {
            lo = Math.min(lo, field[i]);
            hi = Math.max(hi, field[i]);
        }
        const span = Math.max(1e-6, hi - lo);
        for (let i = 0; i < field.length; i++) out[i * 4 + ch] = toHalf((field[i] - lo) / span);
    }
    return out;
}
