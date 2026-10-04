// Screen-space deep starfield behind the systems at sector / system / planet zoom — crisp at any devicePixelRatio.
//
// Port of the original's close-zoom background (Controls/MainView.cs method_14 ~966-1045 + MainView.1.cs 390-399
// method_101/102/106/107/108, method_45 in MainView.cs 2389): once the view is closer than zoom factor
// BaconMain.backgroundStarsAtZoomLevel (300) the galaxy backdrop is gone and the original draws four screen-space
// layers of star-flare sprites (images/environment/mapstars/flares), each tiled over the view and panned by a parallax
// divisor of the camera's screen-space position:
//   layer 3: 16·n stars, 6 px, grey 127, divisor 38   (tile = screenMax/2 + 50)
//   layer 2:  4·n stars, 7 px, white,    divisor 20   (tile = screenMax/2 + 50)
//   layer 1:    n stars, 11 px, white,   divisor 11   (tile = screenMax/2 + 50)
//   layer 0:  n/4 stars, 20 px, random tint 128..254 per channel, divisor 6 (tile = screenMax + 400)
// with n = StarFieldSize / 4 (XNA path, bool_9; StarFieldSize defaults to 1000) and every layer at alpha
// method_45 = clamp(1 / sqrt(sqrt(zoomFactor))) = clamp(z^0.25). The original never magnifies an image here: every
// star is a small sprite drawn at its own size, so it stays sharp at any screen resolution.
//
// Per-star look (what sets the stars' brightness and sharpness), Main.Part13.cs ~1052-1081 + MainView.1.cs:
//   layers 3..1: the flare art prescaled to 16 px (bitmap_198, PrecacheScaledBitmap HighQualityBicubic), then drawn
//     NearestNeighbor (method_175) at 6 / 7 / 11 px into the prerendered tiles (method_105/107) — point-like stars
//     whose cores keep the 16 px image's peak;
//   layer 0: the art prescaled to 32 px (bitmap_197 -> texture2D_19) and drawn at 20 px by the sprite batch
//     (AnisotropicClamp, no mip chain).
// This port builds the same textures, one small atlas per layer. Layers 3..1 are exactly the original's pixels (16 px
// prescale, then 6 / 7 / 11 px nearest), drawn 1 texel per CSS px with nearest sampling — on a DPR-2 screen each
// texel is a crisp 2×2 device-pixel block, so the stars look (and measure) the same as at DPR 1 instead of the
// brighter, haloed result a higher-resolution resample gives (+18 % mean luminance measured at DPR 2,
// scripts/starfield-shots.mjs). Layer 0 is prescaled to 32·r px (r = device resolution) and minified to 20 CSS px by
// the GPU's linear sampler, as the original's sprite batch minifies 32 -> 20. Each layer is a ParticleContainer (one
// draw call); star positions are integers (random.Next) and static; per frame each layer container only moves by its
// wrapped parallax offset, snapped to whole CSS px like the original's (int) offsets (no particle writes, no
// allocation). Particles are rebuilt only when the viewport size, the resolution or the density changes.
//
// The flare art is decoded with its embedded grey ICC profile ignored (AssetStore.loadRawImage), as the original's
// GDI+ load does; the browser's default colour management brightens the halos ~17%.
//
// Deviations (documented):
//   - Star positions are deterministic from the galaxy seed (the original seeds from DateTime.Now.Ticks).
//   - Layer 0's tint is fixed per star (the original re-rolls it from Galaxy.Rnd every frame — a sim-RNG draw in the
//     renderer, which the port must not make; a per-frame colour flicker would also shimmer badly at 60 fps).
//   - Layer 0 pans by cam·z/6 like the others (the original divides the world position by 6 without the zoom, which
//     streaks the layer at up to 50× the map's speed at sector zoom).
//   - The hard cut at zoom factor 300 becomes the Main View's backdrop crossfade window (one seamless map, task 02b2):
//     the stars fade in over the window the galaxy backdrop fades out over. Closer than F = 300 the brightness is
//     exactly method_45; farther out (where the original draws no stars, only the backdrop) it holds method_45's value
//     at the cut, 300^-0.25 = 0.240, times the window — never dimmer than the original ever draws them.
//   - A few very faint colour patches per system (deterministic from the system index), anchored to the system with a
//     deep parallax, give each system a slightly different sky; they fade by camera distance from the star, so
//     panning between systems cross-fades them.
//
// Render-only: no sim state is read beyond system positions / star types, nothing is written, no sim RNG is drawn.

import { Container, Particle, ParticleContainer, Rectangle, Sprite, Texture, type TextureSource } from 'pixi.js';
import { useMinifyingFilter } from './assets';

// --- pure part ------------------------------------------------------------------------------------------------------

/** Smoothstep 0 at a → 1 at b (same curve as mainView.fadeIn; duplicated so this module stays leaf-level). */
function ramp(v: number, a: number, b: number): number {
    if (v <= a) return 0;
    if (v >= b) return 1;
    const t = (v - a) / (b - a);
    return t * t * (3 - 2 * t);
}

/** Background flare-star strength (1 = original). Was 0.5 (an earlier user call, 2026-09-29, made while the z^0.25
 *  curve was floored at 0.5 and so drew the system-zoom stars brighter than the original); back to the original's
 *  brightness (2026-10-03: "the normal brightness the background stars should be compared to original"). */
export const STARFIELD_FLARE_SCALE = 1;
/** System colour-haze patch strength (1 = original): removed (user call: the big blobs at system zoom); 0 = not drawn. */
export const SYSTEM_PATCH_SCALE = 0;

/** Port of MainView.cs method_45: star brightness by zoom (z = px per world unit = 1 / zoomFactor). */
export function starBrightness(z: number): number {
    return Math.max(0, Math.min(1, Math.sqrt(Math.sqrt(Math.max(0, z)))));
}

/** BaconMain.cs backgroundStarsAtZoomLevel: the original draws the background stars only while zoom factor < 300
 *  (MainView.1.cs:385). */
export const BACKGROUND_STARS_AT_ZOOM_LEVEL = 300;
/** method_45 at that cut (300^-0.25 = 0.2403): the dimmest the original ever draws them. */
export const STAR_BRIGHTNESS_AT_CUT = starBrightness(1 / BACKGROUND_STARS_AT_ZOOM_LEVEL);

/** Deep-starfield opacity: fades in over the galaxy backdrop's fade-out window [m*2.5, m*14] (m = minZoom), times
 *  the original's z^0.25 brightness (method_45), held at its value at the F = 300 cut farther out (see header).
 *  0 at galaxy zoom, 1 at planet zoom (z >= 1). */
export function deepStarfieldAlpha(z: number, m: number): number {
    const win = ramp(z, m * 2.5, m * 14);
    if (win <= 0) return 0;
    return win * Math.max(STAR_BRIGHTNESS_AT_CUT, starBrightness(z));
}

/** Per-system colour patches: in once the backdrop is gone, fully in by the time a system fills the view. */
export function systemPatchZoomAlpha(z: number, m: number): number {
    return ramp(z, m * 14, m * 60);
}

/** Weight of one system's patches by camera distance from its star (d, world units) vs the system radius r. */
export function systemPatchDistanceWeight(d: number, r: number): number {
    const rr = Math.max(1, r);
    return 1 - ramp(d / rr, 1, 1.6);
}

export interface StarLayerSpec {
    /** Parallax divisor: the layer pans by (camera screen position) / divisor. */
    divisor: number;
    /** Drawn size, CSS px. */
    size: number;
    /** Star count per tile, as a multiple of n = StarFieldSize / 4. */
    countMul: number;
    /** 0xRRGGBB tint, or -1 for a random 128..255-per-channel tint per star. */
    tint: number;
    /** Tile size: 'small' = screenMax/2 + 50, 'large' = screenMax + 400. */
    tile: 'small' | 'large';
    /** Size (px) the flare art is first prescaled to: 16 (Main.bitmap_198) or 32 (Main.bitmap_197). */
    prescale: number;
    /** How the prescaled flare reaches `size`: 'nearest' on the CPU (GDI+ NearestNeighbor into the prerendered
     *  tile, method_105) or 'linear' on the GPU (the XNA sprite batch's sampler, method_102). */
    sampling: 'nearest' | 'linear';
}

/** The original's four layers, back to front (MainView.1.cs 394-398). */
export const STAR_LAYERS: readonly StarLayerSpec[] = [
    { divisor: 38, size: 6, countMul: 16, tint: 0x7f7f7f, tile: 'small', prescale: 16, sampling: 'nearest' },
    { divisor: 20, size: 7, countMul: 4, tint: 0xffffff, tile: 'small', prescale: 16, sampling: 'nearest' },
    { divisor: 11, size: 11, countMul: 1, tint: 0xffffff, tile: 'small', prescale: 16, sampling: 'nearest' },
    { divisor: 6, size: 20, countMul: 0.25, tint: -1, tile: 'large', prescale: 32, sampling: 'linear' },
];

/** Texel sizes of a layer's flare texture at device resolution `res`: the prescale size and the size of the texture
 *  the particles draw. 'nearest' layers are the original's pixels at any resolution (16 px, then `size` px: one
 *  texel per CSS px); the 'linear' layer is prescaled at device resolution (32·res px) and minified by the GPU. */
export function layerTexelSizes(spec: StarLayerSpec, res: number): { prescale: number; texture: number } {
    if (spec.sampling === 'nearest') return { prescale: spec.prescale, texture: spec.size };
    const r = res > 0 && Number.isFinite(res) ? res : 1;
    const prescale = Math.max(1, Math.round(spec.prescale * r));
    return { prescale, texture: prescale };
}

/** Nearest-neighbour resample of an RGBA image (pixel-centre sampling: destination pixel i reads source pixel
 *  floor((i + 0.5) · sw / dw)) — the GDI+ InterpolationMode.NearestNeighbor step of method_105. */
export function resampleNearest(src: Uint8ClampedArray, sw: number, sh: number, dw: number, dh: number): Uint8ClampedArray<ArrayBuffer> {
    const out = new Uint8ClampedArray(dw * dh * 4);
    for (let y = 0; y < dh; y++) {
        const sy = Math.min(sh - 1, Math.floor(((y + 0.5) * sh) / dh));
        for (let x = 0; x < dw; x++) {
            const sx = Math.min(sw - 1, Math.floor(((x + 0.5) * sw) / dw));
            const si = (sy * sw + sx) * 4;
            const di = (y * dw + x) * 4;
            out[di] = src[si];
            out[di + 1] = src[si + 1];
            out[di + 2] = src[si + 2];
            out[di + 3] = src[si + 3];
        }
    }
    return out;
}

/** Game.StarFieldSize default (Main.Part9.cs 2778). */
export const DEFAULT_STAR_FIELD_SIZE = 1000;

/** MainView.cs method_14: tile sizes (int_1 for the near layer, int_2..4 for the rest), capped at 2000. */
export function starLayerTileSize(spec: StarLayerSpec, screenMax: number): number {
    return spec.tile === 'large' ? Math.round(screenMax) + 400 : Math.min(2000, Math.round(screenMax / 2) + 50);
}

/** Small, fast, well-mixed 32-bit PRNG (mulberry32) — render-side only, never the sim's Random. */
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

/** Mix a few integers into one 32-bit seed. */
export function hashSeed(...parts: number[]): number {
    let h = 0x811c9dc5;
    for (const p of parts) {
        h = Math.imul(h ^ (p | 0), 0x01000193);
        h ^= h >>> 13;
        h = Math.imul(h, 0x5bd1e995);
        h ^= h >>> 15;
    }
    return h >>> 0;
}

export interface StarLayerData {
    tile: number;
    count: number;
    /** Tile-space position of each star's top-left corner (the original's rectangle X / Y), integer CSS px in
     *  [0, tile). */
    xs: Float32Array;
    ys: Float32Array;
    /** Atlas frame index of each star (the original: i % flareCount). */
    frames: Uint16Array;
    /** 0xRRGGBB tint per star. */
    tints: Uint32Array;
}

/** Port of MainView.1.cs method_101 (+ method_14's counts): one layer's stars, deterministic from `seed`. */
export function generateStarLayer(
    seed: number,
    layerIndex: number,
    screenMax: number,
    frameCount: number,
    starFieldSize = DEFAULT_STAR_FIELD_SIZE,
): StarLayerData {
    const spec = STAR_LAYERS[layerIndex];
    const tile = starLayerTileSize(spec, screenMax);
    const n = Math.trunc(starFieldSize / 4);
    const count = Math.max(0, Math.trunc(n * spec.countMul));
    const rnd = mulberry32(hashSeed(seed, 0x5157a2, layerIndex));
    const xs = new Float32Array(count);
    const ys = new Float32Array(count);
    const frames = new Uint16Array(count);
    const tints = new Uint32Array(count);
    const fc = Math.max(1, frameCount);
    for (let i = 0; i < count; i++) {
        xs[i] = Math.floor(rnd() * tile); // random.Next(0, int_11)
        ys[i] = Math.floor(rnd() * tile);
        frames[i] = i % fc;
        if (spec.tint >= 0) {
            tints[i] = spec.tint;
        } else {
            const r = 128 + Math.floor(rnd() * 127);
            const g = 128 + Math.floor(rnd() * 127);
            const b = 128 + Math.floor(rnd() * 127);
            tints[i] = (r << 16) | (g << 8) | b;
        }
    }
    return { tile, count, xs, ys, frames, tints };
}

/** Wrapped parallax offset of a layer in [0, tile): camera screen position / divisor, positive modulo (the caller
 *  snaps it to device pixels, as the original's (int) casts do). */
export function layerOffset(camScreen: number, divisor: number, tile: number): number {
    const v = (camScreen / divisor) % tile;
    return v < 0 ? v + tile : v;
}

/** Number of tile copies (per axis) that cover a view of `extent` px at any offset in [0, tile). */
export function tileCopies(extent: number, tile: number): number {
    return Math.ceil(extent / tile) + 1;
}

// Faint per-system colour patches (dust-lit haze): muted blues / violets / teals / rust, never saturated.
const PATCH_PALETTE = [0x3a4f8f, 0x5a3f86, 0x2f6a78, 0x7a4a3a, 0x44506a, 0x6a3f5f, 0x2f5a5a];
/** Floats per patch in SystemPatches.data: dx, dy (CSS px from the anchor), radius (CSS px), colour, alpha. */
export const PATCH_STRIDE = 5;
/** Anchor offset in CSS px when the camera is at the system's rim (deep parallax). */
export const PATCH_PARALLAX_PX = 500;

export interface SystemPatches {
    count: number;
    data: Float32Array;
}

/** A system's colour patches, deterministic from (galaxy seed, system index). */
export function generateSystemPatches(galaxySeed: number, systemIndex: number): SystemPatches {
    const rnd = mulberry32(hashSeed(galaxySeed, 0x9a7c4e, systemIndex));
    const count = 2 + Math.floor(rnd() * 3); // 2..4
    const data = new Float32Array(count * PATCH_STRIDE);
    const base = Math.floor(rnd() * PATCH_PALETTE.length);
    for (let i = 0; i < count; i++) {
        const o = i * PATCH_STRIDE;
        const ang = rnd() * Math.PI * 2;
        const dist = 150 + rnd() * 650;
        data[o] = Math.cos(ang) * dist;
        data[o + 1] = Math.sin(ang) * dist;
        data[o + 2] = 450 + rnd() * 700;
        // Neighbouring palette entries: one system reads as one colour family.
        data[o + 3] = PATCH_PALETTE[(base + Math.floor(rnd() * 2)) % PATCH_PALETTE.length];
        data[o + 4] = 0.07 + rnd() * 0.08;
    }
    return { count, data };
}

// --- Pixi part ------------------------------------------------------------------------------------------------------

/** Size of the procedural fallback flare (no install); the art itself is used at its own size. */
const FLARE_SRC = 128;
/** Transparent border around each flare in a layer atlas (no bleeding between cells under linear sampling). */
const ATLAS_PAD = 1;
const BLOB_SIZE = 512;
const MAX_PATCH_SYSTEMS = 4;
const PATCH_CACHE_LIMIT = 256;

export interface PatchSystem {
    index: number;
    x: number;
    y: number;
    /** Farthest orbit radius (world units). */
    radius: number;
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
}

/** Procedural 4-point star glow for one atlas cell (no-install fallback). */
function drawFallbackFlare(ctx: CanvasRenderingContext2D, cx: number, cy: number, variant: number): void {
    const s = FLARE_SRC;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, s * 0.5);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.06, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.2, 'rgba(210,225,255,0.25)');
    g.addColorStop(1, 'rgba(200,215,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - s / 2, cy - s / 2, s, s);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((variant % 4) * (Math.PI / 16));
    for (let k = 0; k < 2; k++) {
        const lg = ctx.createLinearGradient(-s / 2, 0, s / 2, 0);
        lg.addColorStop(0, 'rgba(255,255,255,0)');
        lg.addColorStop(0.5, 'rgba(255,255,255,0.7)');
        lg.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = lg;
        ctx.fillRect(-s / 2, -1, s, 2);
        ctx.rotate(Math.PI / 2);
    }
    ctx.restore();
}

/** High-quality downscale of a flare, stretched square (PrecacheScaledBitmap(…, 16, 16 / 32, 32) HighQualityBicubic). */
function prescaleFlare(src: CanvasImageSource, size: number): HTMLCanvasElement {
    const c = makeCanvas(size, size);
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, size, size);
    return c;
}

export class DeepStarfield {
    /** Screen-space root, drawn behind the world (stage index 0). */
    readonly root = new Container();
    /** Faint per-system colour patches (behind the stars). */
    readonly patches = new Container();
    /** Layers 3..1 (the original's prerendered tiles) — the rim atmosphere tints / thins this as the "far" field. */
    readonly far = new Container();
    /** Layer 0 (the tinted near flares) — the rim atmosphere's "near" field. */
    readonly near = new Container();

    /** The flare art as decoded (procedural fallback per missing file); the layer atlases are built from these. */
    private flares: CanvasImageSource[] = [];
    /** Per layer: the flare textures at the current resolution (one atlas source per layer). */
    private layerFrames: Texture[][] = [];
    private layerSources: TextureSource[] = [];
    /** Device resolution the layer atlases were built for (-1 = not built). */
    private atlasRes = -1;
    private layers: ParticleContainer[] = [];
    private layerData: StarLayerData[] = [];
    private builtW = -1;
    private builtH = -1;
    private blob: Texture | null = null;
    private patchSprites: Sprite[] = [];
    private patchCache = new Map<number, SystemPatches>();
    private ready = false;
    /** Game.StarFieldSize ("Star Density" in Game Options); a change rebuilds the layers (Main.Part6.cs:2497-2501:
     *  mainView.ClearMain(); mainView.method_14(StarFieldSize)). */
    private starFieldSize = DEFAULT_STAR_FIELD_SIZE;

    constructor(private readonly seed: number) {
        this.root.addChild(this.patches, this.far, this.near);
        this.root.visible = false;
        this.patches.visible = false;
    }

    /** Load the install's mapstars/flares art (procedural fallback per missing file); the per-layer textures are
     *  built at the first update, at the renderer's resolution. */
    async load(flareUrls: readonly string[], loadImage: (url: string) => Promise<CanvasImageSource | null>): Promise<void> {
        const images = await Promise.all(flareUrls.map((u) => loadImage(u).catch(() => null)));
        const n = Math.max(4, images.length);
        this.flares = [];
        for (let i = 0; i < n; i++) {
            const img = images[i] ?? null;
            if (img !== null) {
                this.flares.push(img);
            } else {
                const c = makeCanvas(FLARE_SRC, FLARE_SRC);
                drawFallbackFlare(c.getContext('2d')!, FLARE_SRC / 2, FLARE_SRC / 2, i);
                this.flares.push(c);
            }
        }
        this.layerData = STAR_LAYERS.map(() => ({ tile: 0, count: 0, xs: new Float32Array(0), ys: new Float32Array(0), frames: new Uint16Array(0), tints: new Uint32Array(0) }));
        this.blob = this.makeBlobTexture();
        this.atlasRes = -1;
        this.builtW = -1;
        this.ready = true;
    }

    /** (Re)build each layer's flare atlas and ParticleContainer for device resolution `res` (Main.Part13.cs
     *  bitmap_197 / bitmap_198 + MainView.1.cs method_105's NearestNeighbor draw, see the header). */
    private buildAtlases(res: number): void {
        this.atlasRes = res;
        for (const pc of this.layers) pc.destroy({ children: true });
        for (const src of this.layerSources) src.destroy();
        this.layers = [];
        this.layerSources = [];
        this.layerFrames = [];
        const n = this.flares.length;
        const cols = Math.ceil(Math.sqrt(n));
        const rows = Math.ceil(n / cols);
        for (let li = 0; li < STAR_LAYERS.length; li++) {
            const spec = STAR_LAYERS[li];
            const { prescale, texture } = layerTexelSizes(spec, res);
            const cell = texture + 2 * ATLAS_PAD;
            const canvas = makeCanvas(cols * cell, rows * cell);
            const ctx = canvas.getContext('2d')!;
            for (let i = 0; i < n; i++) {
                const x = (i % cols) * cell + ATLAS_PAD;
                const y = Math.floor(i / cols) * cell + ATLAS_PAD;
                const pre = prescaleFlare(this.flares[i], prescale);
                if (spec.sampling === 'nearest' && texture !== prescale) {
                    const px = pre.getContext('2d')!.getImageData(0, 0, prescale, prescale).data;
                    ctx.putImageData(new ImageData(resampleNearest(px, prescale, prescale, texture, texture), texture, texture), x, y);
                } else {
                    ctx.drawImage(pre, x, y);
                }
            }
            const atlas = Texture.from(canvas);
            // 'nearest' layers: the original's pixels, one texel per CSS px (crisp blocks on HiDPI); layer 0 is
            // minified 32 -> 20 by the GPU like the original's sprite batch (no mip chain).
            atlas.source.scaleMode = spec.sampling;
            atlas.source.autoGenerateMipmaps = false;
            this.layerSources.push(atlas.source);
            const frames: Texture[] = [];
            for (let i = 0; i < n; i++) {
                const frame = new Rectangle((i % cols) * cell + ATLAS_PAD, Math.floor(i / cols) * cell + ATLAS_PAD, texture, texture);
                frames.push(new Texture({ source: atlas.source, frame }));
            }
            this.layerFrames.push(frames);
            const pc = new ParticleContainer({ texture: atlas, dynamicProperties: { position: false, vertex: false, rotation: false, uvs: false, color: false } });
            (li === STAR_LAYERS.length - 1 ? this.near : this.far).addChild(pc);
            this.layers.push(pc);
        }
        this.builtW = -1;
    }

    private makeBlobTexture(): Texture {
        const c = makeCanvas(BLOB_SIZE, BLOB_SIZE);
        const ctx = c.getContext('2d')!;
        const h = BLOB_SIZE / 2;
        const g = ctx.createRadialGradient(h, h, 0, h, h, h);
        // Gaussian-ish falloff: smooth enough that bilinear magnification shows no steps.
        for (let i = 0; i <= 16; i++) {
            const t = i / 16;
            g.addColorStop(t, `rgba(255,255,255,${Math.exp(-4.5 * t * t) * (1 - t)})`);
        }
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, BLOB_SIZE, BLOB_SIZE);
        const tex = Texture.from(c);
        useMinifyingFilter(tex);
        return tex;
    }

    /** Set the star density (50..2000); the layers are rebuilt at the next update when it changed. */
    setStarFieldSize(size: number): void {
        const v = Math.max(50, Math.min(2000, Math.round(size)));
        if (v === this.starFieldSize) return;
        this.starFieldSize = v;
        this.builtW = -1;
    }

    /** (Re)build every layer's particles for a view of w × h CSS px (on first use, on resize, on a resolution or a
     *  density change). */
    private build(w: number, h: number): void {
        this.builtW = w;
        this.builtH = h;
        const screenMax = Math.max(w, h);
        const res = this.atlasRes;
        for (let li = 0; li < STAR_LAYERS.length; li++) {
            const spec = STAR_LAYERS[li];
            const frames = this.layerFrames[li];
            const data = generateStarLayer(this.seed, li, screenMax, frames.length, this.starFieldSize);
            this.layerData[li] = data;
            const pc = this.layers[li];
            pc.removeParticles();
            const nx = tileCopies(w, data.tile);
            const ny = tileCopies(h, data.tile);
            // Texture texels -> CSS px: `size` CSS px on screen (1 texel = 1 CSS px for the 'nearest' layers).
            const scale = spec.size / layerTexelSizes(spec, res).texture;
            const out = pc.particleChildren;
            for (let ty = 0; ty < ny; ty++) {
                for (let tx = 0; tx < nx; tx++) {
                    for (let i = 0; i < data.count; i++) {
                        const x = data.xs[i] + tx * data.tile;
                        const y = data.ys[i] + ty * data.tile;
                        // Skip copies that can never reach the view (offset range is [0, tile)).
                        if (x >= w + data.tile || y >= h + data.tile) continue;
                        out.push(
                            new Particle({
                                texture: frames[data.frames[i]],
                                x,
                                y,
                                scaleX: scale,
                                scaleY: scale,
                                // Top-left at (X, Y): the original's Rectangle(X, Y, size, size).
                                anchorX: 0,
                                anchorY: 0,
                                tint: data.tints[i],
                            }),
                        );
                    }
                }
            }
            pc.update();
        }
    }

    /**
     * Per frame. `alpha` = deepStarfieldAlpha; camera screen position = cam·z (the map's own pan in px); `resolution`
     * = the renderer's device pixels per CSS px (the layer textures are built for it).
     * Sets `far` / `near` alpha (the rim atmosphere may then scale them down further).
     */
    update(alpha: number, camX: number, camY: number, z: number, viewW: number, viewH: number, resolution = 1): void {
        const on = this.ready && alpha > 0.01;
        this.root.visible = on;
        this.far.alpha = alpha * STARFIELD_FLARE_SCALE;
        this.near.alpha = alpha * STARFIELD_FLARE_SCALE;
        if (!on) return;
        const res = resolution > 0 && Number.isFinite(resolution) ? resolution : 1;
        if (res !== this.atlasRes) this.buildAtlases(res);
        if (viewW !== this.builtW || viewH !== this.builtH) this.build(viewW, viewH);
        const sx = camX * z;
        const sy = camY * z;
        for (let li = 0; li < this.layers.length; li++) {
            const d = this.layerData[li];
            const div = STAR_LAYERS[li].divisor;
            // Whole CSS px, as the original's (int) offsets: the 'nearest' texels stay on the pixel grid.
            const ox = Math.round(layerOffset(sx, div, d.tile));
            const oy = Math.round(layerOffset(sy, div, d.tile));
            this.layers[li].position.set(-ox, -oy);
        }
    }

    private patchesFor(index: number): SystemPatches {
        let p = this.patchCache.get(index);
        if (p === undefined) {
            if (this.patchCache.size >= PATCH_CACHE_LIMIT) this.patchCache.clear();
            p = generateSystemPatches(this.seed, index);
            this.patchCache.set(index, p);
        }
        return p;
    }

    /**
     * Per frame: the colour patches of the (at most MAX_PATCH_SYSTEMS) systems whose radius the camera is inside.
     * `zoomAlpha` = systemPatchZoomAlpha. No allocation once the sprite pool is warm.
     */
    updatePatches(zoomAlpha: number, systems: readonly PatchSystem[], camX: number, camY: number, viewW: number, viewH: number): void {
        const blob = this.blob;
        const on = blob !== null && zoomAlpha > 0.01 && SYSTEM_PATCH_SCALE > 0;
        this.patches.visible = on;
        if (!on) return;
        let used = 0;
        let sysUsed = 0;
        const cx = viewW / 2;
        const cy = viewH / 2;
        for (let s = 0; s < systems.length && sysUsed < MAX_PATCH_SYSTEMS; s++) {
            const sys = systems[s];
            const r = Math.max(1, sys.radius);
            const dx = sys.x - camX;
            const dy = sys.y - camY;
            // Cheap reject before the sqrt.
            if (Math.abs(dx) > r * 1.6 || Math.abs(dy) > r * 1.6) continue;
            const w = systemPatchDistanceWeight(Math.sqrt(dx * dx + dy * dy), r) * zoomAlpha;
            if (w <= 0.005) continue;
            sysUsed++;
            const ax = cx + (dx / r) * PATCH_PARALLAX_PX;
            const ay = cy + (dy / r) * PATCH_PARALLAX_PX;
            const p = this.patchesFor(sys.index);
            for (let i = 0; i < p.count; i++) {
                const o = i * PATCH_STRIDE;
                let spr = this.patchSprites[used];
                if (spr === undefined) {
                    spr = new Sprite(blob);
                    spr.anchor.set(0.5);
                    spr.blendMode = 'add';
                    this.patchSprites.push(spr);
                    this.patches.addChild(spr);
                }
                used++;
                spr.visible = true;
                spr.position.set(ax + p.data[o], ay + p.data[o + 1]);
                const size = p.data[o + 2] * 2;
                spr.width = size;
                spr.height = size;
                spr.tint = p.data[o + 3];
                spr.alpha = p.data[o + 4] * w * SYSTEM_PATCH_SCALE;
            }
        }
        for (let i = used; i < this.patchSprites.length; i++) this.patchSprites[i].visible = false;
    }
}
