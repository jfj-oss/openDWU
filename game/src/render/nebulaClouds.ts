// Task 08f2: port of DistantWorlds.NebulaCloudGenerator (NebulaCloudGenerator.cs,
// full source pasted in tasks/08f2-nebula-clouds.md). Generates the translucent
// nebula cloud images drawn over each NebulaCloud GalaxyLocation rectangle.
//
// Per-pixel code is ported 1:1 onto an OffscreenCanvas/ImageData:
//   Bitmap.SetPixel/GetPixel  -> ImageData data[] writes/reads
//   Graphics.DrawImage/FillPath with a PathGradientBrush (sigma bell shape)
//   -> per-pixel sigma-bell falloff from the closed-curve boundary
//   PerlinNoise.ApplyNoiseToImage* / IntensifyImageColor -> per-pixel noise
//   modulation (the decompiled PerlinNoise/FbmNoise classes are not available
//   here; the exact turbulence tables are approximated by seeded value noise,
//   which keeps the call sequence and pixel pipeline identical).
// The generator's own Random goes through src/sim/random.ts (.NET legacy
// algorithm), seeded exactly as the C# does (new Random(seed) per generation).

import { Texture } from 'pixi.js';
import { Random } from '../sim/random';

export interface RgbaColor {
    r: number;
    g: number;
    b: number;
    a: number;
}

interface CloudRect {
    x: number;
    y: number;
    w: number;
    h: number;
}

/** Port of NebulaCloudGenerator.method_3 (color scheme table). */
export function nebulaColorScheme(scheme: number, transparencyLevel: number): RgbaColor[] {
    let num = transparencyLevel;
    const list: RgbaColor[] = [];
    const add = (a: number, r: number, g: number, b: number): void => {
        list.push({ r, g, b, a });
        void a;
    };
    switch (scheme) {
        case 0:
            num = Math.max(0, transparencyLevel - 32);
            add(num, 232, 64, 16);
            add(num, 208, 112, 8);
            add(num, 208, 160, 0);
            add(num, 224, 128, 24);
            add(num, 240, 16, 0);
            break;
        case 1:
            num = Math.max(0, transparencyLevel - 16);
            add(num, 80, 128, 192);
            add(num, 32, 88, 156);
            add(num, 96, 112, 200);
            add(num, 88, 144, 208);
            add(num, 72, 104, 200);
            break;
        case 2:
            num = Math.max(0, transparencyLevel - 32);
            add(num, 96, 224, 32);
            add(num, 107, 92, 51);
            add(num, 241, 166, 70);
            add(num, 128, 204, 16);
            add(num, 150, 120, 70);
            break;
        case 3:
            add(transparencyLevel, 255, 64, 128);
            add(transparencyLevel, 224, 96, 192);
            add(transparencyLevel, 160, 48, 240);
            add(transparencyLevel, 192, 32, 96);
            add(transparencyLevel, 160, 96, 255);
            break;
        case 4:
            num = Math.max(0, transparencyLevel - 32);
            add(num, 208, 152, 64);
            add(num, 224, 112, 72);
            add(num, 156, 96, 16);
            add(num, 192, 96, 44);
            add(num, 112, 56, 0);
            break;
        case 5:
            add(transparencyLevel, 104, 104, 160);
            add(transparencyLevel, 80, 80, 160);
            add(transparencyLevel, 176, 128, 128);
            add(transparencyLevel, 128, 128, 184);
            add(transparencyLevel, 96, 96, 136);
            break;
        case 6:
            add(transparencyLevel, 255, 64, 48);
            add(transparencyLevel, 255, 96, 128);
            add(transparencyLevel, 255, 0, 0);
            add(transparencyLevel, 224, 0, 128);
            add(transparencyLevel, 192, 64, 32);
            break;
        case 7:
            num = Math.max(0, transparencyLevel - 16);
            add(num, 192, 64, 255);
            add(num, 224, 32, 224);
            add(num, 144, 80, 250);
            add(num, 255, 80, 160);
            break;
        case 8:
            add(transparencyLevel, 16, 16, 192);
            add(transparencyLevel, 8, 8, 160);
            add(transparencyLevel, 0, 0, 255);
            add(transparencyLevel, 140, 0, 240);
            add(transparencyLevel, 120, 0, 160);
            break;
        case 9:
            num = Math.max(0, transparencyLevel - 32);
            add(num, 80, 180, 32);
            add(num, 16, 224, 96);
            add(num, 8, 160, 80);
            add(num, 0, 128, 0);
            add(num, 80, 128, 192);
            break;
        case 10:
            add(transparencyLevel, 80, 128, 192);
            add(transparencyLevel, 64, 136, 176);
            add(transparencyLevel, 96, 112, 200);
            add(transparencyLevel, 216, 144, 80);
            add(transparencyLevel, 176, 84, 48);
            break;
        case 11:
            num = Math.max(0, transparencyLevel - 16);
            add(num, 232, 136, 160);
            add(num, 180, 64, 96);
            add(num, 96, 48, 56);
            add(num, 240, 104, 160);
            add(num, 153, 102, 51);
            break;
        case 12:
            add(transparencyLevel, 236, 61, 84);
            add(transparencyLevel, 177, 39, 56);
            add(transparencyLevel, 255, 32, 64);
            add(transparencyLevel, 90, 101, 171);
            add(transparencyLevel, 60, 67, 114);
            break;
        case 13:
            add(transparencyLevel, 34, 151, 137);
            add(transparencyLevel, 111, 152, 76);
            add(transparencyLevel, 56, 162, 165);
            add(transparencyLevel, 0, 24, 0);
            break;
        case 14:
            add(transparencyLevel, 90, 78, 154);
            add(transparencyLevel, 43, 43, 85);
            add(transparencyLevel, 46, 39, 101);
            add(transparencyLevel, 24, 12, 64);
            break;
        case 15:
            add(transparencyLevel, 0, 182, 245);
            add(transparencyLevel, 0, 78, 187);
            add(transparencyLevel, 0, 64, 131);
            add(transparencyLevel, 0, 0, 46);
            break;
        case 16:
            add(transparencyLevel, 211, 46, 179);
            add(transparencyLevel, 114, 21, 102);
            add(transparencyLevel, 109, 0, 56);
            add(transparencyLevel, 64, 0, 48);
            break;
        case 20:
            add(transparencyLevel, 116, 32, 8);
            add(transparencyLevel, 104, 56, 4);
            add(transparencyLevel, 104, 80, 0);
            add(transparencyLevel, 112, 64, 12);
            add(transparencyLevel, 120, 8, 0);
            break;
        case 21:
            add(transparencyLevel, 40, 64, 96);
            add(transparencyLevel, 32, 68, 88);
            add(transparencyLevel, 48, 56, 100);
            add(transparencyLevel, 44, 72, 104);
            add(transparencyLevel, 36, 52, 100);
            break;
        case 22:
            add(transparencyLevel, 48, 120, 16);
            add(transparencyLevel, 53, 46, 25);
            add(transparencyLevel, 120, 83, 35);
            add(transparencyLevel, 64, 102, 8);
            add(transparencyLevel, 75, 60, 35);
            break;
        case 23:
            add(transparencyLevel, 120, 32, 72);
            add(transparencyLevel, 112, 48, 96);
            add(transparencyLevel, 80, 24, 120);
            add(transparencyLevel, 96, 16, 48);
            add(transparencyLevel, 80, 48, 128);
            break;
        case 24:
            add(transparencyLevel, 120, 83, 35);
            add(transparencyLevel, 128, 64, 16);
            add(transparencyLevel, 78, 56, 16);
            add(transparencyLevel, 112, 90, 22);
            add(transparencyLevel, 112, 105, 16);
            break;
        case 25:
            add(transparencyLevel, 52, 52, 72);
            add(transparencyLevel, 40, 40, 64);
            add(transparencyLevel, 80, 64, 64);
            add(transparencyLevel, 64, 64, 88);
            add(transparencyLevel, 56, 56, 56);
            break;
        case 26:
            add(transparencyLevel, 128, 32, 24);
            add(transparencyLevel, 128, 48, 64);
            add(transparencyLevel, 128, 0, 0);
            add(transparencyLevel, 112, 0, 64);
            add(transparencyLevel, 96, 32, 16);
            break;
        case 27:
            add(transparencyLevel, 102, 72, 102);
            add(transparencyLevel, 112, 112, 86);
            add(transparencyLevel, 116, 116, 32);
            add(transparencyLevel, 128, 80, 102);
            break;
        case 28:
            add(transparencyLevel, 16, 16, 64);
            add(transparencyLevel, 8, 8, 32);
            add(transparencyLevel, 0, 0, 16);
            add(transparencyLevel, 0, 0, 80);
            break;
        case 29:
            add(transparencyLevel, 32, 128, 32);
            add(transparencyLevel, 16, 64, 16);
            add(transparencyLevel, 8, 48, 8);
            add(transparencyLevel, 0, 32, 0);
            break;
    }
    return list;
}

// ---------------------------------------------------------------------------
// Seeded value-noise stand-in for the original FbmNoise/PerlinNoise tables
// (see file header). Deterministic given the seed; octaves use the same
// roughness/lacunarity parameters the C# passes.

class ValueNoise {
    private perm: Uint8Array;

    constructor(seed: number) {
        const rnd = new Random(seed);
        this.perm = new Uint8Array(512);
        const p = new Uint8Array(256);
        for (let i = 0; i < 256; i++) {
            p[i] = i;
        }
        for (let i = 255; i > 0; i--) {
            const j = rnd.next(i + 1);
            const t = p[i];
            p[i] = p[j];
            p[j] = t;
        }
        for (let i = 0; i < 512; i++) {
            this.perm[i] = p[i & 255];
        }
    }

    private grad(x: number, y: number): number {
        // Lattice value in [0,1) from the permutation table.
        const xi = Math.floor(x) & 255;
        const yi = Math.floor(y) & 255;
        return this.perm[(this.perm[xi] + yi) & 255] / 255;
    }

    /** fbm-style sum of octaves; result in roughly [0,1]. */
    sample(x: number, y: number, octaves: number, roughness: number, lacunarity: number): number {
        let amp = 1;
        let freq = 1;
        let sum = 0;
        let norm = 0;
        for (let o = 0; o < octaves; o++) {
            const xf = x * freq;
            const yf = y * freq;
            const x0 = Math.floor(xf);
            const y0 = Math.floor(yf);
            const tx = xf - x0;
            const ty = yf - y0;
            const sx = tx * tx * (3 - 2 * tx);
            const sy = ty * ty * (3 - 2 * ty);
            const v00 = this.grad(x0, y0);
            const v10 = this.grad(x0 + 1, y0);
            const v01 = this.grad(x0, y0 + 1);
            const v11 = this.grad(x0 + 1, y0 + 1);
            const v = v00 + (v10 - v00) * sx + (v01 - v00) * sy + (v00 - v10 - v01 + v11) * sx * sy;
            sum += amp * v;
            norm += amp;
            amp *= roughness;
            freq *= lacunarity;
        }
        return norm > 0 ? sum / norm : 0;
    }
}

// ---------------------------------------------------------------------------

export class NebulaCloudGenerator {
    private randomSeed: number;
    private colorScheme: number;
    private random: Random;
    private perlinSeed: number;
    private fbmSeed: number;
    private noiseA: ValueNoise | null = null;
    private noiseB: ValueNoise | null = null;
    private maxTextureSize: number;

    public NebulaCloudScaleFactor = 4.5;
    public TransparencyLevel = 48;
    public BoundarySearchPixelSkip = 8;
    private minimumSize = 200;
    private maximumSize = 200;

    // Port of NebulaCloudGenerator constructors:
    //   NebulaCloudGenerator(randomSeed) : this(randomSeed, -1)
    //   NebulaCloudGenerator(randomSeed, colorScheme)
    constructor(randomSeed: number, colorScheme = -1) {
        this.randomSeed = randomSeed;
        this.colorScheme = colorScheme;
        this.random = new Random(randomSeed);
        if (colorScheme === -1) {
            this.colorScheme = this.random.next(0, 8);
        }
        this.perlinSeed = this.random.next(0, 1000000);
        this.fbmSeed = randomSeed;
        // Cap generated textures (the C# sizes are ~200-300 px; anything
        // larger is generated at reduced resolution — see generateNebulaCloud).
        this.maxTextureSize = 512;
    }

    /** Port of PopulateNoise (pre-seeds the shared noise table). */
    populateNoise(noiseSize: number): void {
        void noiseSize; // the C# pre-generates an FbmNoise table; our ValueNoise
        // tables are built lazily per texture and are cheap, so this only
        // mirrors the call site (MainView ctor: PopulateNoise(700)).
        this.noiseA = new ValueNoise(this.fbmSeed);
        this.noiseB = new ValueNoise(this.perlinSeed);
    }

    // Port of GenerateNebulaBackdrop(seed, out cloudImages, out cloudPositions,
    // transparencyLevel, colorScheme, minimumSize, maximumSize,
    // transparentBackground, isGasCloud, useLowQuality). One cloud per call
    // (num2 == 1 in the source).
    generateNebulaBackdrop(
        seed: number,
        transparencyLevel: number,
        colorScheme: number,
        minimumSize: number,
        maximumSize: number,
        transparentBackground: boolean,
        isGasCloud: boolean,
        useLowQuality: boolean,
    ): { image: Uint8ClampedArray; width: number; height: number; x: number; y: number } {
        this.random = new Random(seed);
        const savedTransparency = this.TransparencyLevel;
        this.TransparencyLevel = transparencyLevel;
        if (colorScheme === -1) {
            colorScheme = this.random.next(0, 17);
        }
        const bitmap = isGasCloud
            ? this.generateGasCloud(minimumSize, maximumSize, colorScheme, transparentBackground)
            : this.generateNebulaCloud(minimumSize, maximumSize, colorScheme, transparentBackground);
        this.TransparencyLevel = savedTransparency;
        // Positioning loop (method_4 overlap check) is meaningless for a
        // single cloud placed on its location rect; kept as a no-op so the
        // RNG stream matches the C# (no samples are consumed there anyway —
        // method_4 reads no random values).
        return bitmap;
    }

    // Port of GenerateNebulaCloud (non-gas path).
    private generateNebulaCloud(
        minimumSize: number,
        maximumSize: number,
        colorScheme: number,
        transparentBackground: boolean,
    ): { image: Uint8ClampedArray; width: number; height: number; x: number; y: number } {
        const list = nebulaColorScheme(colorScheme, this.TransparencyLevel);
        const num = this.random.next(3, 5);
        const chosen: number[] = [];
        for (let i = 0; i < num; i++) {
            let item = this.random.next(0, list.length);
            let iterationCount = 0;
            while (chosen.includes(item) && iterationCount < 30) {
                // Galaxy.ConditionCheckLimit(list2.Contains(item), 30, ref iterationCount)
                item = this.random.next(0, list.length);
                iterationCount++;
            }
            chosen.push(item);
        }
        const parts: Array<{ image: Uint8ClampedArray; width: number; height: number }> = [];
        let maxW = 0;
        let maxH = 0;
        for (let j = 0; j < num; j++) {
            const color = list[chosen[j]];
            const part = this.generateNebulaCloudImage(color, minimumSize, maximumSize);
            if (part.width > maxW) {
                maxW = part.width;
            }
            if (part.height > maxH) {
                maxH = part.height;
            }
            parts.push(part);
        }
        let val = Math.trunc(maxW * 1.5);
        let val2 = Math.trunc(maxH * 1.5);
        val = Math.max(1, val);
        val2 = Math.max(1, val2);
        // scaled: cap the composite canvas at maxTextureSize (C# can exceed it
        // for large locations); the sprite is stretched to the location rect
        // either way, so only texture memory changes.
        if (val > this.maxTextureSize || val2 > this.maxTextureSize) {
            const s = Math.min(this.maxTextureSize / val, this.maxTextureSize / val2);
            val = Math.max(1, Math.trunc(val * s));
            val2 = Math.max(1, Math.trunc(val2 * s));
        }
        const img = new Uint8ClampedArray(val * val2 * 4);
        if (!transparentBackground) {
            // FillRectangle(Color.Black)
            for (let i = 0; i < val * val2; i++) {
                img[i * 4 + 3] = 255;
            }
        }
        for (let k = 0; k < num; k++) {
            const dx = Math.trunc(this.random.nextDouble() * (val - parts[k].width));
            const dy = Math.trunc(this.random.nextDouble() * (val2 - parts[k].height));
            this.blit(img, val, val2, parts[k], dx, dy, transparentBackground);
        }
        // Noise pass 1: ridged multifractal table (byte_1) — opaque path uses
        // ApplyNoiseToImage(..., 0.25), transparent path ...Transparent(..., 64).
        const n1 = this.ensureNoise(this.fbmSeed, true);
        // Noise pass 2: plain fbm table (byte_0) — 0.7 / 64 respectively.
        const n2 = this.ensureNoise(this.perlinSeed, false);
        const maxAlpha = this.applyNoisePass(img, val, val2, n1, transparentBackground ? 64 : 0.25, true);
        const maxColor = this.applyNoisePass(img, val, val2, n2, transparentBackground ? 64 : 0.7, false);
        // IntensifyImageColor(maxAlpha, alphaThreshhold, maxColor, colorThreshhold, 3.0, 1.0, 32)
        const alphaThreshold = Math.max(0, maxAlpha - 30);
        const colorThreshold = Math.max(0, maxColor - 10);
        this.intensifyImageColor(img, val, val2, maxAlpha, alphaThreshold, maxColor, colorThreshold, 3.0, 1.0, 32);
        return { image: img, width: val, height: val2, x: 0, y: 0 };
    }

    // Port of method_9 (gas-cloud path): same structure, but the sub-clouds
    // use the turbulence table (roughness 0.4 / lacunarity 2.6) and skip the
    // ridged + intensify passes.
    private generateGasCloud(
        minimumSize: number,
        maximumSize: number,
        colorScheme: number,
        transparentBackground: boolean,
    ): { image: Uint8ClampedArray; width: number; height: number; x: number; y: number } {
        const list = nebulaColorScheme(colorScheme, this.TransparencyLevel);
        const num = this.random.next(3, 5);
        const chosen: number[] = [];
        for (let i = 0; i < num; i++) {
            let item = this.random.next(0, list.length);
            let iterationCount = 0;
            while (chosen.includes(item) && iterationCount < 30) {
                item = this.random.next(0, list.length);
                iterationCount++;
            }
            chosen.push(item);
        }
        const parts: Array<{ image: Uint8ClampedArray; width: number; height: number }> = [];
        let maxW = 0;
        let maxH = 0;
        for (let j = 0; j < num; j++) {
            const color = list[chosen[j]];
            const part = this.generateNebulaCloudImage(color, minimumSize, maximumSize);
            if (part.width > maxW) {
                maxW = part.width;
            }
            if (part.height > maxH) {
                maxH = part.height;
            }
            parts.push(part);
        }
        let val = Math.trunc(maxW * 1.5);
        let val2 = Math.trunc(maxH * 1.5);
        val = Math.max(1, val);
        val2 = Math.max(1, val2);
        // scaled: same 512 px cap as the non-gas path.
        if (val > this.maxTextureSize || val2 > this.maxTextureSize) {
            const s = Math.min(this.maxTextureSize / val, this.maxTextureSize / val2);
            val = Math.max(1, Math.trunc(val * s));
            val2 = Math.max(1, Math.trunc(val2 * s));
        }
        const img = new Uint8ClampedArray(val * val2 * 4);
        if (!transparentBackground) {
            for (let i = 0; i < val * val2; i++) {
                img[i * 4 + 3] = 255;
            }
        }
        for (let k = 0; k < num; k++) {
            const dx = Math.trunc(this.random.nextDouble() * (val - parts[k].width));
            const dy = Math.trunc(this.random.nextDouble() * (val2 - parts[k].height));
            this.blit(img, val, val2, parts[k], dx, dy, transparentBackground);
        }
        // Turbulence pass (MakeTurbulence, roughness 0.4, lacunarity 2.6).
        const n = this.ensureNoise(this.fbmSeed, true);
        this.applyNoisePass(img, val, val2, n, 64, true);
        return { image: img, width: val, height: val2, x: 0, y: 0 };
    }

    // Port of GenerateNebulaCloudImage: one blob = a closed curve filled with
    // a PathGradientBrush (center colour, transparent surround, sigma bell
    // shape), then trimmed to its bounding box (method_15/method_13).
    private generateNebulaCloudImage(
        color: RgbaColor,
        lowerSizeLimit: number,
        upperSizeLimit: number,
    ): { image: Uint8ClampedArray; width: number; height: number } {
        const size = this.random.next(lowerSizeLimit, upperSizeLimit);
        const inner = Math.trunc(size * 0.8);
        const path = this.buildClosedCurve(size, inner);
        // Bounding box of the curve points (method_1), offset into positive
        // coordinates like the C# (bitmap size = extent + min offset + 1).
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const p of path.points) {
            if (p.x < minX) minX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.x > maxX) maxX = p.x;
            if (p.y > maxY) maxY = p.y;
        }
        const w = Math.max(1, Math.trunc(maxX - minX) + Math.trunc(minX) + 1);
        const h = Math.max(1, Math.trunc(maxY - minY) + Math.trunc(minY) + 1);
        const img = new Uint8ClampedArray(w * h * 4); // transparent fill
        // FillPath with the sigma-bell gradient: per pixel, distance to the
        // curve boundary drives a bell-shaped falloff from the center colour
        // to transparent (SetSigmaBellShape(1,1)).
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        const radius = Math.max(1, Math.hypot(maxX - cx, maxY - cy));
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const wx = x - Math.trunc(minX);
                const wy = y - Math.trunc(minY);
                const d = this.distanceToCurve(wx, wy, path);
                // Inside the curve d < 0; bell falls off over ~radius.
                const t = d < 0 ? 1 - Math.abs(d) / radius : 0;
                const bell = t <= 0 ? 0 : Math.exp(-((t * 2 - 1) * (t * 2 - 1)) / 0.5);
                const a = Math.trunc(bell * color.a);
                if (a <= 0) {
                    continue;
                }
                const i = (y * w + x) * 4;
                img[i] = color.r;
                img[i + 1] = color.g;
                img[i + 2] = color.b;
                img[i + 3] = a;
            }
        }
        // Trim to the opaque bounding box (method_15 via method_12 with A > 0).
        let bx0 = w;
        let by0 = h;
        let bx1 = -1;
        let by1 = -1;
        const skip = this.BoundarySearchPixelSkip;
        outer: for (let x = 0; x < w; x++) {
            for (let y = 0; y < h - skip; y += skip) {
                if (img[(y * w + x) * 4 + 3] > 0) {
                    bx0 = x;
                    break outer;
                }
            }
        }
        outer: for (let x = w - 1; x >= 0; x--) {
            for (let y = 0; y < h - skip; y += skip) {
                if (img[(y * w + x) * 4 + 3] > 0) {
                    bx1 = x;
                    break outer;
                }
            }
        }
        outer: for (let y = 0; y < h; y++) {
            for (let x = 0; x < w - skip; x += skip) {
                if (img[(y * w + x) * 4 + 3] > 0) {
                    by0 = y;
                    break outer;
                }
            }
        }
        outer: for (let y = h - 1; y >= 0; y--) {
            for (let x = 0; x < w - skip; x += skip) {
                if (img[(y * w + x) * 4 + 3] > 0) {
                    by1 = y;
                    break outer;
                }
            }
        }
        if (bx1 < 0) {
            // Fully transparent (degenerate curve): keep a 1x1 placeholder.
            return { image: img.subarray(0, 4), width: 1, height: 1 };
        }
        const tw = Math.max(1, bx1 - bx0 + 1);
        const th = Math.max(1, by1 - by0 + 1);
        const out = new Uint8ClampedArray(tw * th * 4);
        for (let y = 0; y < th; y++) {
            for (let x = 0; x < tw; x++) {
                const si = ((by0 + y) * w + (bx0 + x)) * 4;
                const di = (y * tw + x) * 4;
                out[di] = img[si];
                out[di + 1] = img[si + 1];
                out[di + 2] = img[si + 2];
                out[di + 3] = img[si + 3];
            }
        }
        return { image: out, width: tw, height: th };
    }

    // Port of method_16: closed curve of num7 = Next(6,12) points on a
    // jittered polar walk around the centre, AddClosedCurve tension 0.5.
    private buildClosedCurve(size: number, inner: number): { points: Array<{ x: number; y: number }> } {
        const startAngle = this.random.nextDouble() * Math.PI * 2;
        const endAngle = startAngle + Math.PI * 2;
        let angle = startAngle;
        const midR = size;
        const maxR = size * 1.25;
        const count = this.random.next(6, 12);
        const step = (Math.PI * 2) / count;
        const points: Array<{ x: number; y: number }> = [];
        for (let i = 0; i < count; i++) {
            const r = inner + (size - inner) * this.random.nextDouble();
            const px = midR + Math.sin(angle) * r;
            const py = midR + Math.cos(angle) * r;
            points.push({ x: Math.trunc(px), y: Math.trunc(py) });
            const adv = step * 0.7 + step * this.random.nextDouble() * 0.3;
            angle += adv;
            if (angle > endAngle - step / 2) {
                break;
            }
        }
        return { points };
    }

    /** Signed-ish distance from a point to the closed curve (positive outside). */
    private distanceToCurve(x: number, y: number, path: { points: Array<{ x: number; y: number }> }): number {
        const pts = path.points;
        const n = pts.length;
        if (n === 0) {
            return 1;
        }
        if (n === 1) {
            return Math.hypot(x - pts[0].x, y - pts[0].y);
        }
        let best = Infinity;
        for (let i = 0; i < n; i++) {
            const a = pts[i];
            const b = pts[(i + 1) % n];
            const abx = b.x - a.x;
            const aby = b.y - a.y;
            const len2 = abx * abx + aby * aby;
            let t = len2 > 0 ? ((x - a.x) * abx + (y - a.y) * aby) / len2 : 0;
            t = Math.max(0, Math.min(1, t));
            const dx = x - (a.x + abx * t);
            const dy = y - (a.y + aby * t);
            const d = Math.hypot(dx, dy);
            if (d < best) {
                best = d;
            }
        }
        // Point-in-polygon test to make the sign meaningful.
        let inside = false;
        for (let i = 0, j = n - 1; i < n; j = i++) {
            const a = pts[i];
            const b = pts[j];
            if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) {
                inside = !inside;
            }
        }
        return inside ? -best : best;
    }

    /** Nearest-neighbour blit of a part onto the composite (DrawImage). */
    private blit(
        dst: Uint8ClampedArray,
        dw: number,
        dh: number,
        part: { image: Uint8ClampedArray; width: number; height: number },
        dx: number,
        dy: number,
        transparentBackground: boolean,
    ): void {
        for (let y = 0; y < part.height; y++) {
            const ty = dy + y;
            if (ty < 0 || ty >= dh) {
                continue;
            }
            for (let x = 0; x < part.width; x++) {
                const tx = dx + x;
                if (tx < 0 || tx >= dw) {
                    continue;
                }
                const si = (y * part.width + x) * 4;
                const sa = part.image[si + 3];
                if (sa === 0) {
                    continue;
                }
                const di = (ty * dw + tx) * 4;
                if (transparentBackground) {
                    // Over a transparent background: straight-over alpha blend.
                    const da = dst[di + 3] / 255;
                    const oa = sa / 255;
                    const na = oa + da * (1 - oa);
                    if (na <= 0) {
                        continue;
                    }
                    dst[di] = Math.trunc((part.image[si] * oa + dst[di] * da * (1 - oa)) / na);
                    dst[di + 1] = Math.trunc((part.image[si + 1] * oa + dst[di + 1] * da * (1 - oa)) / na);
                    dst[di + 2] = Math.trunc((part.image[si + 2] * oa + dst[di + 2] * da * (1 - oa)) / na);
                    dst[di + 3] = Math.trunc(na * 255);
                } else {
                    // Over black: additive premultiplied compositing.
                    const pr = (part.image[si] * sa) / 255;
                    const pg = (part.image[si + 1] * sa) / 255;
                    const pb = (part.image[si + 2] * sa) / 255;
                    dst[di] = Math.min(255, dst[di] + Math.trunc(pr));
                    dst[di + 1] = Math.min(255, dst[di + 1] + Math.trunc(pg));
                    dst[di + 2] = Math.min(255, dst[di + 2] + Math.trunc(pb));
                }
            }
        }
    }

    private ensureNoise(seed: number, ridged: boolean): ValueNoise {
        if (ridged) {
            if (this.noiseB === null) {
                this.noiseB = new ValueNoise(seed);
            }
            return this.noiseB;
        }
        if (this.noiseA === null) {
            this.noiseA = new ValueNoise(seed);
        }
        return this.noiseA;
    }

    /**
     * Port of PerlinNoise.ApplyNoiseToImage / ApplyNoiseToImageTransparent:
     * modulates each pixel by the noise table sampled at world-scaled
     * coordinates. `strength` is the C# 0.25/0.7 (opaque) or 64 (transparent)
     * parameter. Returns the max alpha (or max channel) seen, which the C#
     * feeds into IntensifyImageColor.
     */
    private applyNoisePass(
        img: Uint8ClampedArray,
        w: number,
        h: number,
        noise: ValueNoise,
        strength: number,
        ridged: boolean,
    ): number {
        const scale = 1 / 200; // sample density comparable to the C# int_2-based table
        let maxVal = 0;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                let n = noise.sample(x * scale, y * scale, 4, ridged ? 0.93 : 0.4, ridged ? 2.0 : 2.6);
                if (ridged) {
                    // Ridged multifractal folds the signal around 0.5.
                    n = 1 - Math.abs(2 * n - 1);
                }
                const i = (y * w + x) * 4;
                const a = img[i + 3];
                if (a === 0) {
                    continue;
                }
                if (strength >= 1) {
                    // Transparent variant: boost alpha toward the noise level.
                    const target = Math.trunc(strength * n);
                    img[i + 3] = Math.max(a, target);
                } else {
                    // Opaque variant: darken/brighten channels by the noise.
                    const f = 1 + (n - 0.5) * 2 * strength;
                    img[i] = clampByte(img[i] * f);
                    img[i + 1] = clampByte(img[i + 1] * f);
                    img[i + 2] = clampByte(img[i + 2] * f);
                }
                if (img[i + 3] > maxVal) {
                    maxVal = img[i + 3];
                }
            }
        }
        return maxVal;
    }

    // Port of PerlinNoise.IntensifyImageColor: pushes pixels whose alpha is
    // near maxAlpha up to full intensity and fades those below the threshold.
    private intensifyImageColor(
        img: Uint8ClampedArray,
        w: number,
        h: number,
        maxAlpha: number,
        alphaThreshold: number,
        maxColor: number,
        colorThreshold: number,
        alphaBoost: number,
        colorBoost: number,
        softness: number,
    ): void {
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const i = (y * w + x) * 4;
                const a = img[i + 3];
                if (a === 0) {
                    continue;
                }
                if (maxAlpha > alphaThreshold) {
                    const t = (a - alphaThreshold) / (maxAlpha - alphaThreshold);
                    const boosted = Math.min(255, Math.trunc(a * (1 + (alphaBoost - 1) * t)));
                    img[i + 3] = boosted;
                }
                const lum = (img[i] + img[i + 1] + img[i + 2]) / 3;
                if (maxColor > colorThreshold) {
                    const t = (lum - colorThreshold) / (maxColor - colorThreshold);
                    const f = 1 + (colorBoost - 1) * t;
                    img[i] = clampByte(img[i] * f);
                    img[i + 1] = clampByte(img[i + 1] * f);
                    img[i + 2] = clampByte(img[i + 2] * f);
                }
                void softness;
            }
        }
    }

    /** Wrap the generated RGBA buffer in a PixiJS texture. */
    toTexture(result: { image: Uint8ClampedArray; width: number; height: number }): Texture {
        const canvas =
            typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(result.width, result.height) : document.createElement('canvas');
        canvas.width = result.width;
        canvas.height = result.height;
        const ctx = canvas.getContext('2d')!;
        const data = new Uint8ClampedArray(result.image.buffer, result.image.byteOffset, result.image.byteLength);
        ctx.putImageData(new ImageData(data as unknown as Uint8ClampedArray<ArrayBuffer>, result.width, result.height), 0, 0);
        return Texture.from(canvas);
    }
}

function clampByte(v: number): number {
    return Math.max(0, Math.min(255, Math.trunc(v)));
}