// 19r item 3 — the Ossuvan portrait, rendered like a painted night photograph (fully procedural, deterministic; no
// Pixi / DOM). A float value buffer at 2× the output size is built as depth slices — far trees, mid trees, the tribe,
// near trees + wet ground, a foreground totem — each composited through exponential fog transmittance
// T = exp(−σ · depth · density) with multi-octave drifting density, so the far trees are almost gone and trunks fade
// in and out. One low cold light behind the figures scatters a halo through the fog (radial soft light + additive fog
// glow) and leaves thin rims on hoods, shoulders and spear shafts. Trees branch fractally with bark value variation
// and soft edges; figures are soft masses with cloth folds, no outlines; the nearest slice gets a shallow depth-of-
// field blur. Then bloom on the highlights, film grain, vignette, 2× box downsample. Desaturated cold blue-grey,
// background ≈ 3-8 % value, one faint warm ember.

import { blankImage, fbm, hash2, type RgbaImage } from './emblemArt';

/** A float image (one channel, value 0-1). */
interface F {
    w: number;
    h: number;
    d: Float32Array;
}

function fimg(w: number, h: number, v = 0): F {
    return { w, h, d: new Float32Array(w * h).fill(v) };
}

/** Separable box blur (radius r), `passes` times (≈ gaussian). */
export function boxBlur(src: F, r: number, passes = 2): F {
    if (r < 1) return { w: src.w, h: src.h, d: new Float32Array(src.d) };
    const { w, h } = src;
    let a = new Float32Array(src.d);
    let b = new Float32Array(w * h);
    const n = 2 * r + 1;
    for (let p = 0; p < passes; p++) {
        for (let y = 0; y < h; y++) {
            let acc = 0;
            for (let k = -r; k <= r; k++) acc += a[y * w + Math.min(w - 1, Math.max(0, k))];
            for (let x = 0; x < w; x++) {
                b[y * w + x] = acc / n;
                acc += a[y * w + Math.min(w - 1, x + r + 1)] - a[y * w + Math.max(0, x - r)];
            }
        }
        for (let x = 0; x < w; x++) {
            let acc = 0;
            for (let k = -r; k <= r; k++) acc += b[Math.min(h - 1, Math.max(0, k)) * w + x];
            for (let y = 0; y < h; y++) {
                a[y * w + x] = acc / n;
                acc += b[Math.min(h - 1, y + r + 1) * w + x] - b[Math.max(0, y - r) * w + x];
            }
        }
    }
    return { w, h, d: a };
}

/** A slice: soft coverage and the object's own value (before fog). */
interface Slice {
    cov: F;
    val: F;
}

function slice(w: number, h: number): Slice {
    return { cov: fimg(w, h), val: fimg(w, h) };
}

/** Stamp a soft disc (1 px falloff) of value `v` into a slice (max coverage; value taken where it covers most). */
function stamp(s: Slice, cx: number, cy: number, r: number, v: number): void {
    const { w, h } = s.cov;
    for (let y = Math.max(0, Math.floor(cy - r - 1)); y <= Math.min(h - 1, Math.ceil(cy + r + 1)); y++) {
        for (let x = Math.max(0, Math.floor(cx - r - 1)); x <= Math.min(w - 1, Math.ceil(cx + r + 1)); x++) {
            const c = Math.max(0, Math.min(1, r - Math.hypot(x + 0.5 - cx, y + 0.5 - cy) + 0.5));
            const i = y * w + x;
            if (c > s.cov.d[i]) {
                s.val.d[i] = s.cov.d[i] > 0.5 ? s.val.d[i] : v;
                s.cov.d[i] = c;
            }
        }
    }
}

/** Bark value at a pixel: vertical streaky variation. */
function bark(x: number, y: number, base: number, seed: number): number {
    return base * (0.55 + 0.9 * fbm(x / 2.5, y / 14, seed));
}

/** A fractally branching tree from (x, y) upward. */
function tree(s: Slice, x: number, y: number, len: number, width: number, ang: number, level: number, base: number, seed: number, id: number): void {
    const steps = Math.max(4, Math.ceil(len / 3));
    let cx = x;
    let cy = y;
    let a = ang;
    for (let k = 0; k < steps; k++) {
        const t = k / steps;
        a += (hash2(id, k, seed) - 0.5) * 0.12;
        cx += Math.sin(a) * (len / steps);
        cy -= Math.cos(a) * (len / steps);
        const r = width * (1 - 0.55 * t);
        stamp(s, cx, cy, r, bark(cx, cy, base, seed));
        // Branches from the upper part of the segment.
        if (level < 4 && t > 0.35 && hash2(id, k + 100, seed) < (level === 0 ? 0.1 : 0.2)) {
            const side = hash2(id, k + 200, seed) < 0.5 ? -1 : 1;
            tree(s, cx, cy, len * (0.3 + 0.25 * hash2(id, k + 300, seed)), r * 0.6, a + side * (0.5 + 0.6 * hash2(id, k + 400, seed)), level + 1, base, seed, id * 31 + k);
        }
    }
}

/** A hooded, cloaked figure as a soft mass with cloth folds (+ its spear / the leader's horn staff). */
function figure(s: Slice, spears: Slice, fx: number, footY: number, sz: number, spearAng: number, leader: boolean, seed: number): { eye: [number, number]; spear: [number, number, number, number] } {
    const { w, h } = s.cov;
    const headY = footY - sz;
    for (let y = Math.max(0, Math.floor(headY - sz * 0.1)); y <= Math.min(h - 1, Math.ceil(footY)); y++) {
        const t = (y - headY) / sz;
        // Half-width profile: pointed hood, narrow neck, shoulders, widening cloak, ragged hem.
        let hw: number;
        if (t < 0) hw = sz * 0.07 * (1 + t / 0.1);
        else if (t < 0.16) hw = sz * (0.07 + 0.3 * t);
        else if (t < 0.24) hw = sz * (0.118 + 0.4 * (t - 0.16));
        else hw = sz * (0.15 + 0.1 * (t - 0.24));
        const hem = footY - sz * 0.04 * fbm(0, y / 3, seed);
        if (y > hem) continue;
        const lean = sz * 0.02 * Math.sin(t * 3 + seed);
        for (let x = Math.max(0, Math.floor(fx - hw - 2)); x <= Math.min(w - 1, Math.ceil(fx + hw + 2)); x++) {
            const dx = x + 0.5 - fx - lean;
            const c = Math.max(0, Math.min(1, (hw - Math.abs(dx)) / 1.5 + 0.5));
            if (c <= 0) continue;
            const i = y * w + x;
            // Cloth folds: soft vertical ridges, wider low down.
            const fold = 0.75 + 0.35 * Math.sin(dx / (sz * (0.025 + 0.02 * t)) + fbm(x / 8, y / 20, seed) * 4);
            const v = 0.016 * fold * (t < 0.16 ? 0.8 : 1);
            if (c > s.cov.d[i]) {
                s.cov.d[i] = c;
                s.val.d[i] = v;
            }
        }
    }
    // Spear / staff held at the side.
    const hx = fx + sz * 0.13;
    const hy = headY + sz * 0.42;
    const len = sz * (leader ? 1.2 : 1.35);
    const tx = hx + Math.sin(spearAng) * len * 0.62;
    const ty = hy - Math.cos(spearAng) * len * 0.62;
    const bx = hx - Math.sin(spearAng) * len * 0.38;
    const by = hy + Math.cos(spearAng) * len * 0.38;
    const n = Math.ceil(len);
    for (let k = 0; k <= n; k++) stamp(spears, bx + ((tx - bx) * k) / n, by + ((ty - by) * k) / n, Math.max(0.9, sz * 0.011), 0.012);
    if (leader) {
        for (const side of [-1, 1]) {
            for (let t = 0; t <= 1; t += 0.03) {
                const a = Math.PI * (0.5 + 0.95 * t);
                const r = sz * 0.11 * (1 - 0.3 * t);
                stamp(spears, tx - side * Math.cos(a) * r, ty - Math.sin(a) * r * 0.8 - sz * 0.02, Math.max(0.8, sz * 0.022 * (1 - 0.6 * t)), 0.014);
            }
        }
    } else {
        for (let k = 0; k < 8; k++) stamp(spears, tx + Math.sin(spearAng) * sz * 0.012 * k, ty - Math.cos(spearAng) * sz * 0.012 * k, Math.max(0.8, sz * 0.02 * (1 - k / 8)), 0.012);
    }
    return { eye: [fx, headY + sz * 0.09], spear: [bx, by, tx, ty] };
}

/**
 * Renders the portrait: `size` × `size` RGBA (default 300), deterministic in `seed`. See the module comment.
 */
export function herderPortrait(seed = 7, size = 300): RgbaImage {
    const S = size * 2;
    const W = S;
    const H = S;
    // Light behind the tribe, low.
    const lx = W * 0.55;
    const ly = H * 0.7;
    const halo = (x: number, y: number): number => Math.exp(-(((x - lx) / (W * 0.2)) ** 2 + ((y - ly) / (H * 0.13)) ** 2));
    const haloWide = (x: number, y: number): number => Math.exp(-(((x - lx) / (W * 0.45)) ** 2 + ((y - ly) / (H * 0.3)) ** 2));
    // Fog radiance (value the fog shows where it is thick): dim base + scattering glow round the source.
    const fogCol = (x: number, y: number): number => 0.034 + 0.02 * (y / H) + 0.07 * haloWide(x, y) + 0.16 * halo(x, y);
    // Drifting multi-octave fog density.
    const density = (x: number, y: number, k: number): number => 0.45 + 1.1 * (0.5 * fbm(x / 70 + y / 160, y / 30, seed + k) + 0.35 * fbm(x / 23, y / 11, seed + k + 1) + 0.15 * fbm(x / 7, y / 5, seed + k + 2));
    const SIGMA = 1.15;
    // Start from the fog at infinity.
    const img = fimg(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) img.d[y * W + x] = fogCol(x, y) * (0.85 + 0.15 * fbm(x / 60, y / 40, seed + 3));
    const composite = (sl: Slice, depth: number, k: number, rimLight: F | null = null): void => {
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const i = y * W + x;
                const a = sl.cov.d[i];
                if (a <= 0.001) continue;
                const T = Math.exp(-SIGMA * depth * density(x, y, k));
                const seen = sl.val.d[i] * T + fogCol(x, y) * (1 - T) + (rimLight === null ? 0 : rimLight.d[i] * T);
                img.d[i] = img.d[i] * (1 - a) + seen * a;
            }
        }
    };
    /** A fog sheet in front of depth `depth` (wisps: density-driven veil toward the fog radiance). */
    const sheet = (from: number, strength: number, k: number): void => {
        for (let y = Math.floor(H * from); y < H; y++) {
            const rise = Math.min(1, (y - H * from) / (H * 0.12));
            for (let x = 0; x < W; x++) {
                const i = y * W + x;
                const a = Math.min(0.9, strength * rise * (density(x, y, k) - 0.45));
                if (a > 0) img.d[i] = img.d[i] * (1 - a) + fogCol(x, y) * a;
            }
        }
    };
    // Far trees (almost gone), mid trees.
    const far = slice(W, H);
    for (let t = 0; t < 14; t++) tree(far, W * ((t + hash2(t, 1, seed)) / 14), H * 0.62, H * (0.45 + 0.2 * hash2(t, 2, seed)), W * 0.006, (hash2(t, 3, seed) - 0.5) * 0.08, 1, 0.02, seed + 11, t + 1);
    composite(far, 2.6, 20);
    sheet(0.45, 0.5, 30);
    const mid = slice(W, H);
    for (let t = 0; t < 9; t++) tree(mid, W * ((t + hash2(t, 4, seed)) / 9), H * 0.72, H * (0.6 + 0.25 * hash2(t, 5, seed)), W * 0.011, (hash2(t, 6, seed) - 0.5) * 0.1, 0, 0.022, seed + 12, t + 50);
    composite(mid, 1.7, 21);
    sheet(0.55, 0.55, 31);
    // The tribe with their spears; rims from the cold light.
    const figs = slice(W, H);
    const spears = slice(W, H);
    const eyes: [number, number, number][] = [];
    const shafts: [number, number, number, number][] = [];
    const layout: [number, number, number, number, boolean][] = [
        [0.17, 0.86, 0.27, -0.18, false],
        [0.31, 0.82, 0.21, 0.13, false],
        [0.5, 0.89, 0.37, 0.03, true],
        [0.64, 0.81, 0.2, -0.3, false],
        [0.75, 0.86, 0.26, 0.22, false],
        [0.87, 0.8, 0.17, -0.06, false],
        [0.08, 0.79, 0.15, 0.28, false],
    ];
    layout.forEach(([x, fy, sz, ang, leader], k) => {
        const f = figure(figs, spears, x * W, fy * H, sz * H, ang, leader, seed + k * 13);
        shafts.push(f.spear);
        if (k === 2 || k === 4) eyes.push([f.eye[0], f.eye[1], 1.1]);
    });
    // Merge spears into the figure slice.
    for (let i = 0; i < W * H; i++) {
        if (spears.cov.d[i] > figs.cov.d[i]) {
            figs.val.d[i] = spears.val.d[i];
            figs.cov.d[i] = spears.cov.d[i];
        }
    }
    const soft = boxBlur(figs.cov, 1, 1);
    // Rim: coverage here, fog a few px toward the light → a thin cold edge on hoods, shoulders and shafts.
    const rim = fimg(W, H);
    for (let y = 2; y < H - 2; y++) {
        for (let x = 2; x < W - 2; x++) {
            const i = y * W + x;
            if (soft.d[i] < 0.3) continue;
            const dx = lx - x;
            const dy = ly - y;
            const dl = Math.hypot(dx, dy) || 1;
            const ox = Math.round(x + (dx / dl) * 2.5);
            const oy = Math.round(y + (dy / dl) * 2.5);
            const gap = 1 - soft.d[oy * W + ox];
            const up = 1 - soft.d[(y - 2) * W + x];
            rim.d[i] = Math.max(gap, up * 0.6) * soft.d[i] * (0.05 + 0.5 * halo(x, y) + 0.12 * haloWide(x, y));
        }
    }
    figs.cov = soft;
    composite(figs, 1.15, 22, rim);
    sheet(0.74, 0.7, 32);
    // Near trees and the wet ground (depth of field: blurred).
    const near = slice(W, H);
    for (const [x, wd] of [
        [0.27, 0.022],
        [0.62, 0.018],
        [0.95, 0.028],
    ] as const) tree(near, W * x, H * 1.02, H * 1.15, W * wd, (hash2(x * 100, 7, seed) - 0.5) * 0.05, 1, 0.018, seed + 13, Math.round(x * 100));
    for (let y = Math.floor(H * 0.9); y < H; y++) {
        for (let x = 0; x < W; x++) {
            const edge = H * (0.9 + 0.02 * fbm(x / 40, 0, seed + 9));
            if (y < edge) continue;
            const i = y * W + x;
            near.cov.d[i] = Math.max(near.cov.d[i], Math.min(1, (y - edge) / 3));
            // Wet leaves: dark litter with glinting specks catching the cold light.
            const leaf = hash2(x >> 1, y >> 1, seed + 17);
            const glint = leaf > 0.985 ? 0.05 + 0.25 * haloWide(x, y) : 0;
            near.val.d[i] = 0.012 + 0.012 * fbm(x / 5, y / 3, seed + 18) + glint;
        }
    }
    near.cov = boxBlur(near.cov, 2, 2);
    near.val = boxBlur(near.val, 2, 1);
    composite(near, 0.55, 23);
    // Foreground totem: a dark mass, faint bone highlights, strongly out of focus.
    const fg = slice(W, H);
    const tx = W * 0.09;
    for (let y = Math.floor(H * 0.62); y < H; y++) stamp(fg, tx + (y - H * 0.62) * 0.04, y, W * 0.018, 0.01);
    for (let k = -8; k <= 8; k++) stamp(fg, tx + k * W * 0.006, H * 0.68 - Math.abs(k) * 0.4, W * 0.006, 0.01);
    stamp(fg, tx, H * 0.605, W * 0.022, 0.03);
    for (let k = 0; k < 5; k++) stamp(fg, tx + (hash2(k, 1, seed + 5) - 0.5) * W * 0.07, H * (0.69 + 0.04 * hash2(k, 2, seed + 5)), W * 0.005, 0.07);
    fg.cov = boxBlur(fg.cov, 3, 2);
    fg.val = boxBlur(fg.val, 3, 1);
    composite(fg, 0.3, 24);
    // Eye-glints at several depths (dim, cold) and one warm ember (kept in its own buffer).
    for (let k = 0; k < 5; k++) eyes.push([W * (0.12 + 0.76 * hash2(k, 8, seed + 6)), H * (0.56 + 0.14 * hash2(k, 9, seed + 6)), 0.5 + 0.6 * hash2(k, 10, seed + 6)]);
    for (const [ex, ey, r] of eyes) {
        for (const s2 of [-1, 1]) {
            const x = ex + s2 * r * 3.2;
            for (let y = Math.floor(ey - 6); y <= ey + 6; y++) {
                for (let xx = Math.floor(x - 6); xx <= x + 6; xx++) {
                    if (xx < 0 || y < 0 || xx >= W || y >= H) continue;
                    const d = Math.hypot(xx - x, y - ey);
                    img.d[y * W + xx] += 0.14 * r * Math.exp(-(d * d) / (r * r * 1.5)) + 0.01 * Math.exp(-d / 3);
                }
            }
        }
    }
    const warm = fimg(W, H);
    const emx = W * 0.4;
    const emy = H * 0.93;
    for (let y = Math.floor(emy - 20); y <= emy + 20; y++) {
        for (let x = Math.floor(emx - 20); x <= emx + 20; x++) {
            const d = Math.hypot(x - emx, y - emy);
            warm.d[y * W + x] = 0.4 * Math.exp(-(d * d) / 4) + 0.05 * Math.exp(-d / 6);
        }
    }
    // Bloom on the highlights.
    const hi = fimg(W, H);
    for (let i = 0; i < W * H; i++) hi.d[i] = Math.max(0, img.d[i] - 0.1);
    const bloom = boxBlur(hi, 6, 2);
    for (let i = 0; i < W * H; i++) img.d[i] += 0.8 * bloom.d[i];
    // Down to the output size (2 × 2 box), grain, vignette, cold tint + the ember.
    const out = blankImage(size, size);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            let v = 0;
            let wv = 0;
            for (let dy = 0; dy < 2; dy++) {
                for (let dx = 0; dx < 2; dx++) {
                    const i = (y * 2 + dy) * W + (x * 2 + dx);
                    v += img.d[i];
                    wv += warm.d[i];
                }
            }
            v /= 4;
            wv /= 4;
            v += (hash2(x, y, seed + 77) + hash2(y, x, seed + 78) - 1) * 0.012;
            const d = Math.hypot((x - size / 2) / (size / 2), (y - size * 0.56) / (size / 2));
            const vig = Math.max(0.3, 1 - Math.max(0, d - 0.5) * 0.85);
            v = Math.max(0, v * vig);
            const i = (y * size + x) * 4;
            out.data[i] = Math.min(255, 255 * (v * 0.88 + wv * 1.0));
            out.data[i + 1] = Math.min(255, 255 * (v * 0.96 + wv * 0.42));
            out.data[i + 2] = Math.min(255, 255 * (v * 1.08 + wv * 0.12));
            out.data[i + 3] = 255;
        }
    }
    return out;
}
