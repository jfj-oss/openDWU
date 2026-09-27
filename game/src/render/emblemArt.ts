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

export function fbm(x: number, y: number, seed: number): number {
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

/** Cold blue-grey of the herder scenes (desaturated), by value 0-255. */
export function cold(v: number): [number, number, number] {
    return [v * 0.86, v * 0.95, v * 1.08];
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

/** Ossuvan flag (matching the portrait): a near-black cold field, a pale fog band across the middle, a faint ring of
 * spears round a bone-coloured horned herd head (bold enough to read at 32 px), a bead row on the hoist. */
export function herderFlag(w = FLAG_W, h = FLAG_H): RgbaImage {
    const out = blankImage(w, h);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            const hoist = x < w * 0.14 ? 0.6 : 1;
            const [r, g, b] = cold(22 * hoist);
            out.data[i] = r;
            out.data[i + 1] = g;
            out.data[i + 2] = b;
            out.data[i + 3] = 255;
            // Fog band.
            const d = Math.abs(y - h * 0.62) / (h * 0.16);
            if (d < 1.4) over(out.data, i, ...cold(92), Math.max(0, 1 - d / 1.4) * (0.45 + 0.35 * fbm(x / 14, y / 5, 3)));
        }
    }
    // Ring of spears round the emblem.
    const cx = w * 0.56;
    const cy = h * 0.5;
    const ring = newMask(out);
    for (let k = 0; k < 14; k++) {
        const a = (k / 14) * Math.PI * 2;
        maskLine(ring, w, h, cx + Math.cos(a) * h * 0.34, cy + Math.sin(a) * h * 0.34, cx + Math.cos(a) * h * 0.46, cy + Math.sin(a) * h * 0.46, 1.1);
    }
    paintMask(out, ring, 0x8c98a4, 0.75);
    drawHornedHead(out, cx, cy + 1, h * 0.6, 0x050608);
    drawHornedHead(out, cx, cy - 1, h * 0.56, 0xd6d2c4);
    for (let k = 0; k < 6; k++) fillDisc(out, w * 0.07, h * (0.12 + k * 0.155), h * 0.045, k === 2 ? 0xc86828 : 0x7c8890);
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
