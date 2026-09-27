// 19r items 3 / 6 — flags and portraits derived from the stock ones (pure RGBA, deterministic; no Pixi / DOM).
//
// Base: port of Galaxy.cs 2343 GenerateEmpireFlag — a 100 × 60 field filled with the main colour and the flag shape
// (images/ui/flagshapes/flagNN.png, white on transparent) drawn over it stretched to 100 × 60 after TintBitmap
// (Galaxy.cs 2333: a colour matrix multiplying each channel by the secondary colour / 255).
// Derived (item 6): company = founder flag + corner seal, corporate portrait border; seceded state = torn, recoloured
// parent flag; government in exile = black border; Ghost Armada = dead empire's flag desaturated + skull.
// Herders (item 3): hooded weathered face-frame over the Teekan portrait (fur hood, beads, herd-shell pendant, earth
// tones) and a horned-herd flag.

export interface RgbaImage {
    w: number;
    h: number;
    data: Uint8ClampedArray;
}

export const FLAG_W = 100;
export const FLAG_H = 60;

export function blankImage(w: number, h: number): RgbaImage {
    return { w, h, data: new Uint8ClampedArray(w * h * 4) };
}

export function cloneImage(img: RgbaImage): RgbaImage {
    return { w: img.w, h: img.h, data: new Uint8ClampedArray(img.data) };
}

function rgb(c: number): [number, number, number] {
    return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
}

/** Bilinear sample (straight alpha) of `img` at pixel-centre coordinates. */
export function sampleBilinear(img: RgbaImage, x: number, y: number, out: number[]): void {
    const fx = Math.max(0, Math.min(img.w - 1, x - 0.5));
    const fy = Math.max(0, Math.min(img.h - 1, y - 0.5));
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const x1 = Math.min(img.w - 1, x0 + 1);
    const y1 = Math.min(img.h - 1, y0 + 1);
    const tx = fx - x0;
    const ty = fy - y0;
    for (let c = 0; c < 4; c++) {
        const a = img.data[(y0 * img.w + x0) * 4 + c];
        const b = img.data[(y0 * img.w + x1) * 4 + c];
        const d = img.data[(y1 * img.w + x0) * 4 + c];
        const e = img.data[(y1 * img.w + x1) * 4 + c];
        out[c] = (a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty;
    }
}

/** Source-over of one straight-alpha colour onto pixel i (byte offset). */
export function over(dst: Uint8ClampedArray, i: number, r: number, g: number, b: number, a: number): void {
    if (a <= 0) return;
    const a0 = dst[i + 3] / 255;
    const an = a + a0 * (1 - a);
    if (an <= 0) return;
    dst[i] = (r * a + dst[i] * a0 * (1 - a)) / an;
    dst[i + 1] = (g * a + dst[i + 1] * a0 * (1 - a)) / an;
    dst[i + 2] = (b * a + dst[i + 2] * a0 * (1 - a)) / an;
    dst[i + 3] = an * 255;
}

/** Port of Galaxy.cs 2343 GenerateEmpireFlag (the 100 × 60 LargeFlagPicture); `shape` null = plain field. */
export function composeEmpireFlag(shape: RgbaImage | null, main: number, secondary: number, w = FLAG_W, h = FLAG_H): RgbaImage {
    const out = blankImage(w, h);
    const [mr, mg, mb] = rgb(main);
    const [sr, sg, sb] = rgb(secondary);
    const px = [0, 0, 0, 0];
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            out.data[i] = mr;
            out.data[i + 1] = mg;
            out.data[i + 2] = mb;
            out.data[i + 3] = 255;
            if (shape === null) continue;
            sampleBilinear(shape, ((x + 0.5) * shape.w) / w, ((y + 0.5) * shape.h) / h, px);
            // TintBitmap: channel × secondary / 255.
            over(out.data, i, (px[0] * sr) / 255, (px[1] * sg) / 255, (px[2] * sb) / 255, px[3] / 255);
        }
    }
    return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Small deterministic noise
// ---------------------------------------------------------------------------------------------------------------

export function hash2(x: number, y: number, seed: number): number {
    let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number, seed: number): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = x - x0;
    const ty = y - y0;
    const s = (t: number): number => t * t * (3 - 2 * t);
    const a = hash2(x0, y0, seed);
    const b = hash2(x0 + 1, y0, seed);
    const c = hash2(x0, y0 + 1, seed);
    const d = hash2(x0 + 1, y0 + 1, seed);
    return (a * (1 - s(tx)) + b * s(tx)) * (1 - s(ty)) + (c * (1 - s(tx)) + d * s(tx)) * s(ty);
}

function fbm(x: number, y: number, seed: number): number {
    return 0.55 * valueNoise(x, y, seed) + 0.3 * valueNoise(x * 2.1, y * 2.1, seed + 1) + 0.15 * valueNoise(x * 4.3, y * 4.3, seed + 2);
}

function lum(r: number, g: number, b: number): number {
    return 0.299 * r + 0.587 * g + 0.114 * b;
}

function fillDisc(img: RgbaImage, cx: number, cy: number, r: number, col: number, a = 1): void {
    const [cr, cg, cb] = rgb(col);
    for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++) {
        for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
            if (x < 0 || y < 0 || x >= img.w || y >= img.h) continue;
            const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
            const cov = Math.max(0, Math.min(1, r - d + 0.5));
            if (cov > 0) over(img.data, (y * img.w + x) * 4, cr, cg, cb, cov * a);
        }
    }
}

function strokeRing(img: RgbaImage, cx: number, cy: number, r: number, width: number, col: number, a = 1): void {
    const [cr, cg, cb] = rgb(col);
    for (let y = Math.floor(cy - r - width - 1); y <= Math.ceil(cy + r + width + 1); y++) {
        for (let x = Math.floor(cx - r - width - 1); x <= Math.ceil(cx + r + width + 1); x++) {
            if (x < 0 || y < 0 || x >= img.w || y >= img.h) continue;
            const d = Math.abs(Math.hypot(x + 0.5 - cx, y + 0.5 - cy) - r);
            const cov = Math.max(0, Math.min(1, width / 2 - d + 0.5));
            if (cov > 0) over(img.data, (y * img.w + x) * 4, cr, cg, cb, cov * a);
        }
    }
}

function fillRect(img: RgbaImage, x0: number, y0: number, x1: number, y1: number, col: number, a = 1): void {
    const [cr, cg, cb] = rgb(col);
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(img.h, Math.ceil(y1)); y++) {
        for (let x = Math.max(0, Math.floor(x0)); x < Math.min(img.w, Math.ceil(x1)); x++) over(img.data, (y * img.w + x) * 4, cr, cg, cb, a);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Derived flags (item 6)
// ---------------------------------------------------------------------------------------------------------------

/** Company: the founder's flag with a round company seal in the upper hoist corner (seal = company colours). */
export function companyFlag(founderFlag: RgbaImage, companyMain: number, companySecondary: number): RgbaImage {
    const out = cloneImage(founderFlag);
    const r = out.h * 0.24;
    const cx = r + 3;
    const cy = r + 3;
    fillDisc(out, cx, cy, r + 1.5, 0x1a1408, 0.9);
    fillDisc(out, cx, cy, r, 0xc8a048);
    strokeRing(out, cx, cy, r * 0.78, 1.2, 0x6a4a18);
    fillDisc(out, cx, cy, r * 0.5, companyMain);
    // Seal mark: a ledger bar in the company's secondary colour.
    fillRect(out, cx - r * 0.3, cy - r * 0.08, cx + r * 0.3, cy + r * 0.08, companySecondary);
    // Serrated seal rim.
    for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        fillDisc(out, cx + Math.cos(a) * (r + 1), cy + Math.sin(a) * (r + 1), 1.2, 0xc8a048);
    }
    return out;
}

/** Tear depth (px from the fly edge) of row y for a torn flag. */
export function tearDepth(y: number, h: number, w: number, seed: number): number {
    const base = w * 0.12;
    return base + w * 0.1 * fbm(y / 5, seed * 0.37, seed) + (hash2(y, 3, seed) < 0.18 ? w * 0.06 : 0);
}

/** Seceded state: the parent's flag shape in the new state's colours, torn along the fly edge (with a rip). */
export function secededFlag(parentShape: RgbaImage | null, newMain: number, newSecondary: number, seed: number): RgbaImage {
    const out = composeEmpireFlag(parentShape, newMain, newSecondary);
    const { w, h } = out;
    const ripY = Math.floor(h * (0.3 + 0.4 * hash2(1, 1, seed)));
    for (let y = 0; y < h; y++) {
        const cut = w - tearDepth(y, h, w, seed);
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            // A rip running in from the fly towards the middle.
            const rip = Math.abs(y - ripY - (w - x) * 0.08) < 0.9 && x > w * 0.55;
            if (x >= cut || rip) {
                out.data[i + 3] = 0;
                continue;
            }
            // Frayed, scorched edge.
            const d = cut - x;
            if (d < 3) {
                const k = 0.45 + 0.18 * d;
                out.data[i] *= k;
                out.data[i + 1] *= k;
                out.data[i + 2] *= k;
            }
        }
    }
    return out;
}

/** Government in exile: the lost empire's flag inside a black mourning border. */
export function exileFlag(parentFlag: RgbaImage, border = 5): RgbaImage {
    const out = cloneImage(parentFlag);
    const { w, h } = out;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const d = Math.min(x, y, w - 1 - x, h - 1 - y);
            const i = (y * w + x) * 4;
            if (d < border) {
                out.data[i] = 6;
                out.data[i + 1] = 6;
                out.data[i + 2] = 8;
                out.data[i + 3] = 255;
            } else if (d === border) {
                over(out.data, i, 90, 90, 96, 0.8);
            }
        }
    }
    return out;
}

/** Draws a skull (bone colour) centred at (cx, cy), height s. */
export function drawSkull(img: RgbaImage, cx: number, cy: number, s: number, bone = 0xe6e0cc, dark = 0x0c0c10): void {
    fillDisc(img, cx, cy - s * 0.12, s * 0.36, bone);
    fillRect(img, cx - s * 0.2, cy + s * 0.12, cx + s * 0.2, cy + s * 0.4, bone);
    fillDisc(img, cx - s * 0.14, cy - s * 0.08, s * 0.1, dark);
    fillDisc(img, cx + s * 0.14, cy - s * 0.08, s * 0.1, dark);
    fillDisc(img, cx, cy + s * 0.08, s * 0.04, dark);
    for (let k = -1; k <= 1; k++) fillRect(img, cx + k * s * 0.1 - 0.5, cy + s * 0.22, cx + k * s * 0.1 + 0.5, cy + s * 0.4, dark);
}

/** Desaturate + darken + cold tint (ghost look) in place. `amount` 0-1. */
export function ghostTone(img: RgbaImage, amount = 1): void {
    for (let i = 0; i < img.data.length; i += 4) {
        const l = lum(img.data[i], img.data[i + 1], img.data[i + 2]) * 0.6;
        const tr = l * 0.9;
        const tg = l * 1.0 + 6;
        const tb = l * 1.15 + 14;
        img.data[i] = img.data[i] + (tr - img.data[i]) * amount;
        img.data[i + 1] = img.data[i + 1] + (tg - img.data[i + 1]) * amount;
        img.data[i + 2] = img.data[i + 2] + (tb - img.data[i + 2]) * amount;
    }
}

/** Ghost Armada: the dead empire's flag, desaturated and darkened, with a skull over the centre. */
export function ghostFlag(deadFlag: RgbaImage): RgbaImage {
    const out = cloneImage(deadFlag);
    ghostTone(out);
    drawSkull(out, out.w / 2, out.h / 2, out.h * 0.7);
    return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Derived portraits (item 6)
// ---------------------------------------------------------------------------------------------------------------

/** Corporate portrait border: a brass frame with rivets and a company seal in the lower right. */
export function corporatePortrait(portrait: RgbaImage, companyMain: number): RgbaImage {
    const out = cloneImage(portrait);
    const { w, h } = out;
    const b = Math.round(w * 0.045);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const d = Math.min(x, y, w - 1 - x, h - 1 - y);
            if (d >= b) continue;
            const i = (y * w + x) * 4;
            const shade = 0.75 + 0.35 * (1 - d / b) * (x + y < w ? 1 : 0.6);
            out.data[i] = 176 * shade;
            out.data[i + 1] = 136 * shade;
            out.data[i + 2] = 64 * shade;
            out.data[i + 3] = 255;
        }
    }
    for (const [x, y] of [
        [b / 2, b / 2],
        [w - b / 2, b / 2],
        [b / 2, h - b / 2],
        [w - b / 2, h - b / 2],
        [w / 2, b / 2],
        [w / 2, h - b / 2],
    ]) {
        fillDisc(out, x, y, b * 0.28, 0x4a3410);
        fillDisc(out, x - b * 0.06, y - b * 0.06, b * 0.12, 0xf0d890);
    }
    const r = w * 0.09;
    fillDisc(out, w - b - r - 4, h - b - r - 4, r + 2, 0x1a1408, 0.85);
    fillDisc(out, w - b - r - 4, h - b - r - 4, r, 0xc8a048);
    fillDisc(out, w - b - r - 4, h - b - r - 4, r * 0.55, companyMain);
    return out;
}

/** Seceded portrait: the parent race's portrait washed toward the new state's colour, a torn lower corner. */
export function secededPortrait(portrait: RgbaImage, newMain: number, seed: number): RgbaImage {
    const out = cloneImage(portrait);
    const [nr, ng, nb] = rgb(newMain);
    const { w, h } = out;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            const l = lum(out.data[i], out.data[i + 1], out.data[i + 2]) / 255;
            out.data[i] += (nr * l - out.data[i]) * 0.3;
            out.data[i + 1] += (ng * l - out.data[i + 1]) * 0.3;
            out.data[i + 2] += (nb * l - out.data[i + 2]) * 0.3;
            // Torn corner (lower right): a jagged diagonal.
            const edge = (w - x) + (h - y) - (w * 0.22 + w * 0.08 * fbm(x / 9, y / 9, seed));
            if (edge < 0) out.data[i + 3] = 0;
            else if (edge < 3) {
                out.data[i] *= 0.5;
                out.data[i + 1] *= 0.5;
                out.data[i + 2] *= 0.5;
            }
        }
    }
    return out;
}

/** Exile portrait: a black mourning border and a black band across the upper corner. */
export function exilePortrait(portrait: RgbaImage): RgbaImage {
    const out = cloneImage(portrait);
    const { w, h } = out;
    const b = Math.round(w * 0.05);
    const band = w * 0.075;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            const d = Math.min(x, y, w - 1 - x, h - 1 - y);
            const diag = Math.abs(x + y - w * 0.3) / Math.SQRT2;
            if (d < b || (diag < band / 2 && x + y < w * 0.6)) {
                out.data[i] = 6;
                out.data[i + 1] = 6;
                out.data[i + 2] = 8;
                out.data[i + 3] = 255;
            }
        }
    }
    return out;
}

/** Ghost portrait: the dead empire's race portrait, desaturated / cold, a skull badge in the lower right. */
export function ghostPortrait(portrait: RgbaImage): RgbaImage {
    const out = cloneImage(portrait);
    ghostTone(out, 0.9);
    const s = out.w * 0.2;
    fillDisc(out, out.w - s * 0.7, out.h - s * 0.7, s * 0.55, 0x101014, 0.85);
    drawSkull(out, out.w - s * 0.7, out.h - s * 0.66, s * 0.8);
    return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Herders (item 3)
// ---------------------------------------------------------------------------------------------------------------

export const HERDER_EARTH = [0x6b4424, 0x8a5a2b, 0xb07a3c, 0x3e2a18, 0xc9a26a] as const;
export const HERDER_BEADS = [0x2f9a8a, 0xe8dcc0, 0xa8442a, 0xd8a030] as const;

/** A layer mask (1 byte per pixel) for silhouettes. */
function newMask(img: RgbaImage): Uint8Array {
    return new Uint8Array(img.w * img.h);
}

function maskDisc(m: Uint8Array, w: number, h: number, cx: number, cy: number, r: number): void {
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(h - 1, Math.ceil(cy + r)); y++) {
        for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(w - 1, Math.ceil(cx + r)); x++) if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r) m[y * w + x] = 1;
    }
}

/** Filled polygon into a mask (even-odd). */
function maskPoly(m: Uint8Array, w: number, h: number, pts: readonly [number, number][]): void {
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const [, y] of pts) {
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
    }
    for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(h - 1, Math.ceil(y1)); y++) {
        const yc = y + 0.5;
        const xs: number[] = [];
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
            const [xa, ya] = pts[i];
            const [xb, yb] = pts[j];
            if (ya > yc !== yb > yc) xs.push(xa + ((yc - ya) * (xb - xa)) / (yb - ya));
        }
        xs.sort((p, q) => p - q);
        for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.max(0, Math.ceil(xs[k] - 0.5)); x <= Math.min(w - 1, Math.floor(xs[k + 1] - 0.5)); x++) m[y * w + x] = 1;
    }
}

/** A thick line into a mask. */
function maskLine(m: Uint8Array, w: number, h: number, x0: number, y0: number, x1: number, y1: number, width: number): void {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(len * 2));
    for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        maskDisc(m, w, h, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, width / 2);
    }
}

/** Composite a mask in `col`; with `rim` the silhouette's edge facing the light (from behind, up-left) glows. */
function paintMask(img: RgbaImage, m: Uint8Array, col: number, a: number, rim: number | null = null, rimA = 0.8): void {
    const [r, g, b] = rgb(col);
    const [rr, rg, rb] = rim === null ? [0, 0, 0] : rgb(rim);
    const { w, h } = img;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = y * w + x;
            if (m[i] === 0) continue;
            over(img.data, i * 4, r, g, b, a);
            if (rim === null) continue;
            // Rim: a neighbour outside the silhouette (the fog-lit gap behind it).
            const out = (xx: number, yy: number): boolean => xx < 0 || yy < 0 || xx >= w || yy >= h || m[yy * w + xx] === 0;
            if (out(x - 1, y) || out(x, y - 1) || out(x + 1, y) || out(x - 1, y - 1)) over(img.data, i * 4, rr, rg, rb, rimA);
        }
    }
}

/** Fog band: an fbm-thinned horizontal veil centred at `cy`. */
function fogBand(img: RgbaImage, cy: number, thick: number, col: number, a: number, seed: number): void {
    const [r, g, b] = rgb(col);
    for (let y = 0; y < img.h; y++) {
        const d = Math.abs(y - cy) / thick;
        if (d > 1.6) continue;
        for (let x = 0; x < img.w; x++) {
            const n = fbm(x / 38, y / 11, seed);
            const k = Math.max(0, 1 - d) * (0.45 + 0.9 * n);
            if (k > 0) over(img.data, (y * img.w + x) * 4, r, g, b, Math.min(1, a * k));
        }
    }
}

/** A tree line of conifer / snag silhouettes with trunks, base at `base`, heights around `hgt`. */
function treeLine(img: RgbaImage, seed: number, n: number, base: number, hgt: number, col: number, a: number, rim: number | null = null, ground = true): void {
    const m = newMask(img);
    const { w, h } = img;
    for (let k = 0; k < n; k++) {
        const x = (k + hash2(k, 1, seed) * 0.9) * (w / n);
        const th = hgt * (0.7 + 0.6 * hash2(k, 2, seed));
        const tw = Math.max(1.5, hgt * 0.035 * (0.7 + hash2(k, 3, seed)));
        maskPoly(m, w, h, [
            [x - tw, base + 5],
            [x + tw, base + 5],
            [x + tw * 0.4, base - th],
            [x - tw * 0.4, base - th],
        ]);
        if (hash2(k, 4, seed) < 0.7) {
            // Tiered conifer crown.
            const tiers = 4 + Math.floor(hash2(k, 5, seed) * 3);
            for (let t = 0; t < tiers; t++) {
                const ty = base - th * (0.35 + (0.65 * t) / tiers);
                const half = th * 0.22 * (1 - t / (tiers + 1)) * (0.8 + 0.4 * hash2(k, 10 + t, seed));
                maskPoly(m, w, h, [
                    [x - half, ty + th * 0.12],
                    [x + half, ty + th * 0.12],
                    [x + half * 0.15, ty - th * 0.1],
                    [x - half * 0.15, ty - th * 0.1],
                ]);
            }
        } else {
            // Dead snag with crooked branches.
            for (let t = 0; t < 4; t++) {
                const by = base - th * (0.45 + 0.13 * t);
                const dir = hash2(k, 20 + t, seed) < 0.5 ? -1 : 1;
                maskLine(m, w, h, x, by, x + dir * th * 0.18, by - th * 0.12, Math.max(1, tw * 0.6));
            }
        }
    }
    if (ground) for (let x = 0; x < w; x++) for (let y = Math.max(0, Math.floor(base)); y < h; y++) m[y * w + x] = 1;
    paintMask(img, m, col, a, rim, 0.35);
}

/** One hooded / feathered figure with a spear (or the leader's horn staff) into mask `m`; returns its eye line. */
function tribesman(m: Uint8Array, w: number, h: number, fx: number, footY: number, s: number, spearAng: number, leader: boolean, seed: number): { ex: number; ey: number } {
    const headY = footY - s;
    // Cloak: a trapezoid, ragged hem.
    const pts: [number, number][] = [
        [fx - s * 0.1, headY + s * 0.16],
        [fx + s * 0.1, headY + s * 0.16],
        [fx + s * 0.2, footY - s * 0.06],
    ];
    for (let k = 0; k <= 5; k++) pts.push([fx + s * 0.2 - (k / 5) * s * 0.4, footY - (k % 2) * s * 0.05]);
    pts.push([fx - s * 0.2, footY - s * 0.06]);
    maskPoly(m, w, h, pts);
    // Hood: a pointed cowl.
    maskPoly(m, w, h, [
        [fx - s * 0.1, headY + s * 0.2],
        [fx + s * 0.1, headY + s * 0.2],
        [fx + s * 0.08, headY + s * 0.04],
        [fx + s * 0.02, headY - s * 0.08],
        [fx - s * 0.07, headY + s * 0.02],
    ]);
    // Feathers from the hood and shoulders.
    const nf = 2 + Math.floor(hash2(1, 1, seed) * 3);
    for (let k = 0; k < nf; k++) {
        const a = -Math.PI / 2 + (hash2(k, 2, seed) - 0.5) * 1.6;
        const bx = fx + (hash2(k, 3, seed) - 0.5) * s * 0.14;
        const by = headY + s * (0.02 + 0.12 * hash2(k, 4, seed));
        maskLine(m, w, h, bx, by, bx + Math.cos(a) * s * 0.18, by + Math.sin(a) * s * 0.18, Math.max(1, s * 0.022));
    }
    // Spear / staff held at the side.
    const hx = fx + s * 0.16;
    const hy = headY + s * 0.45;
    const len = s * (leader ? 1.25 : 1.35);
    const tx = hx + Math.sin(spearAng) * len * 0.62;
    const ty = hy - Math.cos(spearAng) * len * 0.62;
    const bx2 = hx - Math.sin(spearAng) * len * 0.38;
    const by2 = hy + Math.cos(spearAng) * len * 0.38;
    maskLine(m, w, h, bx2, by2, tx, ty, Math.max(1, s * 0.025));
    if (leader) {
        // Herd-horn staff head: two curling horns.
        for (const side of [-1, 1]) {
            for (let t = 0; t <= 1; t += 0.04) {
                const ang = Math.PI * (0.5 + 0.9 * t);
                const r = s * 0.13 * (1 - 0.3 * t);
                maskDisc(m, w, h, tx + side * (s * 0.02 + Math.cos(ang) * r * -1 * side * side), ty - Math.sin(ang) * r * 0.8 - s * 0.02, Math.max(0.8, s * 0.03 * (1 - 0.6 * t)));
            }
        }
    } else {
        maskPoly(m, w, h, [
            [tx - Math.cos(spearAng) * s * 0.03, ty - Math.sin(spearAng) * s * 0.03],
            [tx + Math.cos(spearAng) * s * 0.03, ty + Math.sin(spearAng) * s * 0.03],
            [tx + Math.sin(spearAng) * s * 0.12, ty - Math.cos(spearAng) * s * 0.12],
        ]);
    }
    return { ex: fx, ey: headY + s * 0.1 };
}

/**
 * The Ossuvan portrait (item 3, fully procedural): a dark misty forest at dusk — layered blue-black tree lines with
 * fog bands between them, a veiled moon and drifting bioluminescent spores — and in the middle ground the cut-out
 * silhouettes of an uncontacted herder tribe: 6-7 hooded, feathered figures at different distances with tall spears
 * at varied angles, some half hidden behind trunks, two with faintly glowing eyes, a taller leader with a herd-horn
 * staff; rim light from the fog behind them; bone-hung totems and stakes in the foreground. No faces. Earth / teal.
 */
export function herderPortrait(seed = 7, size = 300): RgbaImage {
    const out = blankImage(size, size);
    const w = size;
    const h = size;
    // Dusk sky.
    for (let y = 0; y < h; y++) {
        const t = y / h;
        const r = 8 + 82 * t * t;
        const g = 12 + 136 * t * t;
        const b = 28 + 116 * t * t;
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            out.data[i] = r;
            out.data[i + 1] = g;
            out.data[i + 2] = b;
            out.data[i + 3] = 255;
        }
    }
    // Veiled moon with halo.
    const mx = w * 0.7;
    const my = h * 0.2;
    for (let y = 0; y < h * 0.5; y++) {
        for (let x = 0; x < w; x++) {
            const d = Math.hypot(x - mx, y - my);
            const i = (y * w + x) * 4;
            if (d < w * 0.095) over(out.data, i, 226, 232, 206, 0.95);
            else over(out.data, i, 176, 220, 206, Math.max(0, 0.62 * (1 - (d - w * 0.095) / (w * 0.4))));
        }
    }
    fogBand(out, my + 6, h * 0.025, 0x42585c, 0.8, seed + 1);
    // Far → near tree lines with fog between.
    treeLine(out, seed + 10, 16, h * 0.56, h * 0.3, 0x40606a, 0.9);
    fogBand(out, h * 0.55, h * 0.08, 0xb4d2ca, 0.95, seed + 2);
    treeLine(out, seed + 11, 11, h * 0.64, h * 0.4, 0x16222c, 0.97, null, false);
    fogBand(out, h * 0.7, h * 0.13, 0xd8eee6, 1, seed + 3);
    // Middle ground: the tribe, rim-lit against the fog.
    const figs = newMask(out);
    const eyes: { x: number; y: number; r: number }[] = [];
    const layout: [number, number, number, number, boolean][] = [
        // x, foot y, height, spear angle, leader
        [0.2, 0.84, 0.3, -0.18, false],
        [0.33, 0.8, 0.24, 0.12, false],
        [0.47, 0.86, 0.4, 0.05, true],
        [0.6, 0.79, 0.22, -0.3, false],
        [0.7, 0.83, 0.28, 0.22, false],
        [0.83, 0.78, 0.19, -0.05, false],
        [0.12, 0.77, 0.17, 0.3, false],
    ];
    layout.forEach(([x, fy, s, ang, leader], k) => {
        const e = tribesman(figs, w, h, x * w, fy * h, s * h, ang, leader, seed + k * 13);
        if (k === 2 || k === 4) eyes.push({ x: e.ex, y: e.ey, r: Math.max(1, s * h * 0.012) });
    });
    paintMask(out, figs, 0x06090c, 1, 0x8fd2c2, 0.85);
    // Trunks in front of some figures (half hidden).
    const trunks = newMask(out);
    for (const [x, t] of [
        [0.3, 0.05],
        [0.64, 0.045],
        [0.9, 0.06],
    ] as const) {
        maskPoly(trunks, w, h, [
            [x * w - t * w * 0.5, h],
            [x * w + t * w * 0.5, h],
            [x * w + t * w * 0.3, 0],
            [x * w - t * w * 0.3, 0],
        ]);
    }
    paintMask(out, trunks, 0x05080a, 1, 0x3a5a58, 0.5);
    // Glowing eyes (two figures), drawn after the trunks only where no trunk covers them.
    for (const e of eyes) {
        for (const dx of [-1, 1]) {
            const ex = e.x + dx * e.r * 1.6;
            if (trunks[Math.round(e.y) * w + Math.round(ex)] === 1) continue;
            fillDisc(out, ex, e.y, e.r * 3.2, 0x9ae8c8, 0.18);
            fillDisc(out, ex, e.y, e.r, 0xd8ffc0, 1);
        }
    }
    fogBand(out, h * 0.87, h * 0.05, 0x8aa8a2, 0.4, seed + 4);
    // Foreground: ground, stakes and totems hung with bones.
    const fg = newMask(out);
    for (let x = 0; x < w; x++) for (let y = Math.floor(h * (0.9 + 0.025 * fbm(x / 20, 0, seed))); y < h; y++) fg[y * w + x] = 1;
    const bones: [number, number, number][] = [];
    for (let k = 0; k < 7; k++) {
        const x = w * (0.04 + 0.92 * ((k + hash2(k, 1, seed + 50)) / 7));
        const top = h * (0.8 + 0.08 * hash2(k, 2, seed + 50));
        const lean = (hash2(k, 3, seed + 50) - 0.5) * 0.25;
        maskLine(fg, w, h, x, h, x + lean * h * 0.2, top, Math.max(1.5, w * 0.012));
        if (hash2(k, 4, seed + 50) < 0.6) {
            maskLine(fg, w, h, x + lean * h * 0.15 - w * 0.03, top + h * 0.03, x + lean * h * 0.15 + w * 0.03, top + h * 0.03, Math.max(1, w * 0.007));
            bones.push([x + lean * h * 0.2, top + h * 0.012, w * 0.018]);
        }
    }
    paintMask(out, fg, 0x040607, 1, 0x3c4e46, 0.4);
    // Bones and skulls on the totems (pale, earth-toned).
    for (const [x, y, r] of bones) {
        fillDisc(out, x, y, r, 0xcfc2a0);
        fillDisc(out, x - r * 0.35, y - r * 0.05, r * 0.28, 0x1a1410);
        fillDisc(out, x + r * 0.35, y - r * 0.05, r * 0.28, 0x1a1410);
        fillRect(out, x - r * 1.6, y + r * 1.6, x + r * 1.6, y + r * 2, 0xb8a882, 0.9);
    }
    // Bioluminescent spores drifting in the fog.
    for (let k = 0; k < 38; k++) {
        const x = hash2(k, 7, seed + 90) * w;
        const y = h * (0.3 + 0.6 * hash2(k, 8, seed + 90));
        const r = 0.6 + 1.3 * hash2(k, 9, seed + 90);
        fillDisc(out, x, y, r * 3, 0x6fe0b8, 0.12);
        fillDisc(out, x, y, r, 0xc8ffd8, 0.9);
    }
    // Vignette.
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const d = Math.hypot((x - w / 2) / (w / 2), (y - h / 2) / (h / 2));
            if (d > 0.85) over(out.data, (y * w + x) * 4, 0, 0, 0, Math.min(0.45, (d - 0.85) * 1.2));
        }
    }
    return out;
}

/** A horned herd head (front view): skull disc, muzzle, two sweeping horns, ears. Drawn at (cx, cy), size s. */
export function drawHornedHead(img: RgbaImage, cx: number, cy: number, s: number, col: number): void {
    for (const side of [-1, 1]) {
        // Horns: a sweep of discs along an arc rising outward then curling up.
        for (let t = 0; t <= 1; t += 0.02) {
            const a = Math.PI * (0.95 - 0.75 * t);
            const r = s * (0.3 + 0.28 * t);
            const x = cx + side * Math.cos(a) * r * 1.5 * -1;
            const y = cy - s * 0.15 - Math.sin(a) * r * 0.9;
            fillDisc(img, x, y, s * (0.1 - 0.075 * t), col);
        }
        // Ears.
        fillDisc(img, cx + side * s * 0.32, cy - s * 0.02, s * 0.09, col);
    }
    fillDisc(img, cx, cy, s * 0.24, col);
    fillDisc(img, cx, cy + s * 0.24, s * 0.15, col);
}

/** Ossuvan flag: a dusk-teal field with a veiled moon and a pine-forest silhouette along the foot, the horned herd
 * head in bone over it, a bead row on the hoist (matches the portrait). */
export function herderFlag(w = FLAG_W, h = FLAG_H): RgbaImage {
    const out = blankImage(w, h);
    for (let y = 0; y < h; y++) {
        const t = y / h;
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            const hoist = x < w * 0.14 ? 0.55 : 1;
            out.data[i] = (18 + 38 * t) * hoist;
            out.data[i + 1] = (34 + 60 * t) * hoist;
            out.data[i + 2] = (46 + 44 * t) * hoist;
            out.data[i + 3] = 255;
        }
    }
    fillDisc(out, w * 0.8, h * 0.26, h * 0.13, 0xd8dcc0, 0.9);
    fillDisc(out, w * 0.8, h * 0.26, h * 0.26, 0x9ad0c0, 0.15);
    const forest = newMask(out);
    for (let k = 0; k < 11; k++) {
        const x = w * (0.14 + 0.86 * ((k + 0.5 * hash2(k, 1, 5)) / 11));
        const th = h * (0.22 + 0.16 * hash2(k, 2, 5));
        maskPoly(forest, w, h, [
            [x - th * 0.3, h],
            [x + th * 0.3, h],
            [x, h - th - h * 0.1],
        ]);
    }
    for (let x = 0; x < w; x++) for (let y = Math.floor(h * 0.9); y < h; y++) forest[y * w + x] = 1;
    paintMask(out, forest, 0x0a1418, 1, 0x4a7a70, 0.5);
    drawHornedHead(out, w * 0.56, h * 0.5, h * 0.6, 0x08100f);
    drawHornedHead(out, w * 0.56, h * 0.48, h * 0.56, 0xe6dab4);
    for (let k = 0; k < 6; k++) fillDisc(out, w * 0.07, h * (0.12 + k * 0.155), h * 0.05, HERDER_BEADS[k % HERDER_BEADS.length]);
    return out;
}

/**
 * Herder camp props laid over a herder station's art (item 3), top-down with light from the upper left: hide tents as
 * cones (a lit face, a shaded face, radial seams, a pole tip) casting a shadow down-right, and two post-and-rail
 * corrals (posts with shadows, double rails, a gate gap) holding a few small horned herd beasts. Transparent
 * `size`² canvas centred on the station; deterministic in `seed`.
 */
export function herderCampRgba(size: number, seed: number): RgbaImage {
    const out = blankImage(size, size);
    const c = size / 2;
    const light = Math.atan2(-1, -1); // from the upper left
    const shadowDx = size * 0.012;
    // Corrals on opposite sides of the rim.
    for (let p = 0; p < 2; p++) {
        const a = hash2(p, 1, seed) * 0.6 + p * Math.PI;
        const px = c + Math.cos(a) * size * 0.33;
        const py = c + Math.sin(a) * size * 0.33;
        const r = size * 0.1;
        const gate = hash2(p, 5, seed) * Math.PI * 2;
        // Ground inside (trampled earth).
        fillDisc(out, px, py, r * 0.98, 0x5a4630, 0.55);
        // Rails: two concentric arcs, skipping the gate.
        for (let t = 0; t < 1; t += 0.004) {
            const b = t * Math.PI * 2;
            let dg = Math.abs(b - gate);
            dg = Math.min(dg, Math.PI * 2 - dg);
            if (dg < 0.28) continue;
            for (const rr of [r, r * 0.93]) {
                fillDisc(out, px + Math.cos(b) * rr + shadowDx, py + Math.sin(b) * rr + shadowDx, Math.max(0.6, size * 0.004), 0x000000, 0.35);
                fillDisc(out, px + Math.cos(b) * rr, py + Math.sin(b) * rr, Math.max(0.6, size * 0.0045), 0xb08a5a);
            }
        }
        // Posts.
        for (let k = 0; k < 14; k++) {
            const b = (k / 14) * Math.PI * 2;
            let dg = Math.abs(b - gate);
            dg = Math.min(dg, Math.PI * 2 - dg);
            if (dg < 0.2) continue;
            const x = px + Math.cos(b) * r * 0.965;
            const y = py + Math.sin(b) * r * 0.965;
            const s2 = Math.max(1.2, size * 0.011);
            fillRect(out, x - s2 + shadowDx * 1.5, y - s2 + shadowDx * 1.5, x + s2 + shadowDx * 1.5, y + s2 + shadowDx * 1.5, 0x000000, 0.45);
            fillRect(out, x - s2, y - s2, x + s2, y + s2, 0x6a4a28);
            fillRect(out, x - s2, y - s2, x, y, 0xd0aa70);
        }
        // Herd beasts: body, head, horns, with a shadow.
        const nb = 3 + Math.floor(hash2(p, 6, seed) * 3);
        for (let k = 0; k < nb; k++) {
            const ang = hash2(k, p + 10, seed) * Math.PI * 2;
            const dd = r * 0.55 * Math.sqrt(hash2(k, p + 20, seed));
            const bx = px + Math.cos(ang) * dd;
            const by = py + Math.sin(ang) * dd;
            const face = hash2(k, p + 30, seed) * Math.PI * 2;
            const bl = size * 0.022;
            for (const [ox, col, al] of [
                [shadowDx, 0x000000, 0.45],
                [0, 0xd8c8a0, 1],
            ] as const) {
                for (let t = -1; t <= 1; t += 0.25) fillDisc(out, bx + ox + Math.cos(face) * bl * t, by + ox + Math.sin(face) * bl * t, bl * 0.55, col, al);
                const hx = bx + ox + Math.cos(face) * bl * 1.5;
                const hy = by + ox + Math.sin(face) * bl * 1.5;
                fillDisc(out, hx, hy, bl * 0.4, col, al);
                if (ox === 0) {
                    for (const sd of [-1, 1]) {
                        const nx = -Math.sin(face) * sd;
                        const ny = Math.cos(face) * sd;
                        fillDisc(out, hx + nx * bl * 0.5 + Math.cos(face) * bl * 0.2, hy + ny * bl * 0.5 + Math.sin(face) * bl * 0.2, bl * 0.16, 0x3a2a18);
                    }
                    fillDisc(out, bx - Math.cos(light) * -bl * 0.3, by - Math.sin(light) * -bl * 0.3, bl * 0.3, 0xf4ead0, 0.8);
                }
            }
        }
    }
    // Tents: cones seen from above, shaded by facing, with a cast shadow.
    const n = 5;
    for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + hash2(k, 2, seed) * 0.4 + Math.PI / 2;
        const tx = c + Math.cos(a) * size * 0.19;
        const ty = c + Math.sin(a) * size * 0.19;
        const r = size * (0.05 + 0.018 * hash2(k, 3, seed));
        const [br, bg, bb] = rgb(HERDER_EARTH[k % 3]);
        // Shadow (offset down-right, elongated).
        for (let t = 0; t <= 1; t += 0.1) fillDisc(out, tx + r * 0.5 * t + shadowDx, ty + r * 0.5 * t + shadowDx, r * (1 - 0.4 * t), 0x000000, 0.18);
        for (let y = Math.floor(ty - r - 1); y <= Math.ceil(ty + r + 1); y++) {
            for (let x = Math.floor(tx - r - 1); x <= Math.ceil(tx + r + 1); x++) {
                if (x < 0 || y < 0 || x >= size || y >= size) continue;
                const dx = x + 0.5 - tx;
                const dy = y + 0.5 - ty;
                const d = Math.hypot(dx, dy);
                if (d > r) continue;
                const th = Math.atan2(dy, dx);
                // Cone facet facing: lit toward the light, dark away; seams every 60°.
                const facing = Math.cos(th - light);
                const seam = Math.abs(((th / (Math.PI / 3)) % 1 + 1) % 1 - 0.5) > 0.46;
                let k2 = 0.62 + 0.5 * facing;
                if (seam) k2 *= 0.55;
                // Hem darker.
                if (d > r * 0.88) k2 *= 0.7;
                const cov = Math.max(0, Math.min(1, r - d + 0.5));
                over(out.data, (y * size + x) * 4, Math.min(255, br * k2 + 10), Math.min(255, bg * k2 + 6), Math.min(255, bb * k2), cov);
            }
        }
        // Door flap (dark wedge on the side facing out) and the pole tip.
        const dA = a;
        fillDisc(out, tx + Math.cos(dA) * r * 0.62, ty + Math.sin(dA) * r * 0.62, r * 0.22, 0x1a120a, 0.95);
        fillDisc(out, tx, ty, Math.max(1, r * 0.13), 0x2a1a0c);
        fillDisc(out, tx - 0.5, ty - 0.5, Math.max(0.6, r * 0.07), 0xf0e0c0);
    }
    return out;
}
