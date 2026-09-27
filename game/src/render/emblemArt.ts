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

/** Is (x, y) outside the hood's face opening (an arched ellipse)? Returns the signed depth into the hood (px). */
export function hoodDepth(x: number, y: number, w: number, h: number): number {
    const cx = w / 2;
    const cy = h * 0.6;
    const rx = w * 0.34;
    const ry = h * 0.46;
    const e = Math.hypot((x - cx) / rx, (y - cy) / ry);
    return (e - 1) * Math.min(rx, ry);
}

/**
 * Ossuvan portrait: the Teekan portrait inside a hooded, weathered face frame — a fur hood (fbm-shaded earth tones)
 * leaving an arched face opening, a bead string along the hood's rim, and a herd-shell pendant hanging at the bottom.
 */
export function herderPortrait(portrait: RgbaImage, seed = 7): RgbaImage {
    const out = cloneImage(portrait);
    const { w, h } = out;
    const [dr, dg, db] = rgb(HERDER_EARTH[3]);
    // Weathering over the face: a warm dusty wash.
    for (let i = 0; i < out.data.length; i += 4) {
        out.data[i] = out.data[i] * 0.88 + 22;
        out.data[i + 1] = out.data[i + 1] * 0.86 + 14;
        out.data[i + 2] = out.data[i + 2] * 0.8 + 6;
    }
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const d = hoodDepth(x + 0.5, y + 0.5, w, h);
            if (d < -2) continue;
            const i = (y * w + x) * 4;
            if (d < 0) {
                // Soft shadow the hood casts into the opening.
                over(out.data, i, dr * 0.4, dg * 0.4, db * 0.4, 0.5 * (1 + d / 2));
                continue;
            }
            // Fur: streaky fbm along the hood's radial direction, darker at the rim.
            const n = fbm(x / 6 + y / 40, y / 6, seed);
            const streak = 0.5 + 0.5 * Math.sin((x * 0.9 + y * 0.35) * 0.9 + n * 6);
            const t = Math.min(1, d / (w * 0.08));
            const base = HERDER_EARTH[Math.floor(n * 3) % 3];
            const [br, bg, bb] = rgb(base);
            const k = (0.55 + 0.45 * t) * (0.75 + 0.35 * streak);
            out.data[i] = br * k;
            out.data[i + 1] = bg * k;
            out.data[i + 2] = bb * k;
            out.data[i + 3] = 255;
        }
    }
    // Bead string along the rim.
    const cx = w / 2;
    const cy = h * 0.6;
    const rx = w * 0.34 + 5;
    const ry = h * 0.46 + 5;
    const beads = 22;
    for (let k = 0; k < beads; k++) {
        const a = Math.PI * (1.02 + (0.96 * k) / (beads - 1));
        const bx = cx + Math.cos(a) * rx;
        const by = cy + Math.sin(a) * ry;
        if (by > h * 0.95) continue;
        fillDisc(out, bx, by, w * 0.014 + 0.5, 0x1a120a, 0.8);
        fillDisc(out, bx, by, w * 0.012, HERDER_BEADS[k % HERDER_BEADS.length]);
        fillDisc(out, bx - 0.8, by - 0.8, w * 0.004, 0xffffff, 0.7);
    }
    // Herd-shell pendant on a cord at the bottom centre.
    const px = cx;
    const py = h * 0.9;
    for (let t = 0; t < 1; t += 0.02) {
        fillDisc(out, cx - w * 0.12 + t * w * 0.12, h * 0.8 + Math.sin(t * Math.PI) * h * 0.06, 0.9, 0x2a1a0c);
        fillDisc(out, cx + w * 0.12 - t * w * 0.12, h * 0.8 + Math.sin(t * Math.PI) * h * 0.06, 0.9, 0x2a1a0c);
    }
    const sr = w * 0.055;
    fillDisc(out, px, py, sr + 1.5, 0x2a1a0c);
    fillDisc(out, px, py, sr, 0xe8dcc0);
    for (let k = 1; k <= 3; k++) strokeRing(out, px + k * 0.8, py - k * 0.4, sr * (1 - k * 0.24), 1, 0x9a7a50);
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

/** Ossuvan flag: an earth field with a darker hoist band, a horned herd head and a bead row. */
export function herderFlag(w = FLAG_W, h = FLAG_H): RgbaImage {
    const out = blankImage(w, h);
    const [er, eg, eb] = rgb(HERDER_EARTH[1]);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            const n = fbm(x / 8, y / 8, 11);
            const k = 0.85 + 0.25 * n;
            const hoist = x < w * 0.16 ? 0.62 : 1;
            out.data[i] = er * k * hoist;
            out.data[i + 1] = eg * k * hoist;
            out.data[i + 2] = eb * k * hoist;
            out.data[i + 3] = 255;
        }
    }
    drawHornedHead(out, w * 0.57, h * 0.54, h * 0.62, 0xeadcb8);
    for (let k = 0; k < 6; k++) fillDisc(out, w * 0.08, h * (0.12 + k * 0.155), h * 0.05, HERDER_BEADS[k % HERDER_BEADS.length]);
    return out;
}

/**
 * Herder camp props laid over a herder station's art (item 3): a ring of hide tents (cones with a pole tip and a
 * darker door) round the hub and two fenced herd pens (post-and-rail rings) on the rim, in earth tones, on a
 * transparent `size`² canvas centred on the station. Deterministic in `seed`.
 */
export function herderCampRgba(size: number, seed: number): RgbaImage {
    const out = blankImage(size, size);
    const c = size / 2;
    // Pens: two fenced rings on opposite sides of the rim.
    for (let p = 0; p < 2; p++) {
        const a = hash2(p, 1, seed) * 0.6 + p * Math.PI;
        const px = c + Math.cos(a) * size * 0.34;
        const py = c + Math.sin(a) * size * 0.34;
        const r = size * 0.1;
        strokeRing(out, px, py, r, Math.max(1, size * 0.012), 0x7a5230, 0.9);
        strokeRing(out, px, py, r * 0.86, Math.max(0.8, size * 0.008), 0x5a3a20, 0.8);
        for (let k = 0; k < 10; k++) {
            const b = (k / 10) * Math.PI * 2;
            fillDisc(out, px + Math.cos(b) * r, py + Math.sin(b) * r, Math.max(0.8, size * 0.012), 0x3e2a18);
        }
        // A few herd beasts (pale dots) inside.
        for (let k = 0; k < 3; k++) fillDisc(out, px + (hash2(k, p, seed) - 0.5) * r, py + (hash2(p, k, seed + 3) - 0.5) * r, Math.max(1, size * 0.018), 0xd8c8a0);
    }
    // Tents: cones seen from above — a disc with a radial seam pattern, a darker door wedge and a pole tip.
    const n = 5;
    for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + hash2(k, 2, seed) * 0.4 + Math.PI / 2;
        const tx = c + Math.cos(a) * size * 0.2;
        const ty = c + Math.sin(a) * size * 0.2;
        const r = size * (0.055 + 0.02 * hash2(k, 3, seed));
        const col = HERDER_EARTH[k % 3];
        fillDisc(out, tx + r * 0.25, ty + r * 0.25, r, 0x000000, 0.35);
        fillDisc(out, tx, ty, r, col);
        for (let s = 0; s < 6; s++) {
            const b = (s / 6) * Math.PI * 2;
            for (let t = 0.2; t < 1; t += 0.1) fillDisc(out, tx + Math.cos(b) * r * t, ty + Math.sin(b) * r * t, Math.max(0.4, size * 0.004), 0x2a1a0c, 0.5);
        }
        const d = a + Math.PI;
        fillDisc(out, tx + Math.cos(d) * r * 0.6, ty + Math.sin(d) * r * 0.6, r * 0.28, 0x2a1a0c, 0.85);
        fillDisc(out, tx, ty, Math.max(0.8, r * 0.14), 0xeadcb8);
    }
    return out;
}
