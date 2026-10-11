// Small deterministic helpers of the Concord's procedural portrait / flag (concordArt.ts): the thin-film hue, value
// noise, fbm and a segment distance. Pure; no DOM; never Math.random or galaxy.rnd. (Kept from the biomech canvas the
// procedural fleet used; the fleet itself is now the insect-photo art, concordPhoto.ts.)

type Rgb = readonly [number, number, number];

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

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export function segDist(x: number, y: number, x0: number, y0: number, x1: number, y1: number): number {
    const vx = x1 - x0;
    const vy = y1 - y0;
    const t = clamp01(((x - x0) * vx + (y - y0) * vy) / (vx * vx + vy * vy || 1));
    return Math.hypot(x - (x0 + vx * t), y - (y0 + vy * t));
}
