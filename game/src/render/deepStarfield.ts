// Screen-space deep starfield behind the systems at sector / system / planet zoom — crisp at any devicePixelRatio.
//
// Port of the original's close-zoom background (Controls/MainView.cs method_14 ~966-1045 + MainView.1.cs 390-399
// method_101/102/106/107/108, method_45 in MainView.cs 2389): once the view is closer than zoom factor
// BaconMain.backgroundStarsAtZoomLevel (300) the galaxy backdrop is gone and the original draws four screen-space
// layers of star-flare sprites (images/environment/mapstars/flares, prescaled to 16 px), each tiled over the view and
// panned by a parallax divisor of the camera's screen-space position:
//   layer 3: 16·n stars, 6 px, grey 127, divisor 38   (tile = screenMax/2 + 50)
//   layer 2:  4·n stars, 7 px, white,    divisor 20   (tile = screenMax/2 + 50)
//   layer 1:    n stars, 11 px, white,   divisor 11   (tile = screenMax/2 + 50)
//   layer 0:  n/4 stars, 20 px, random tint 128..255 per channel, divisor 6 (tile = screenMax + 400)
// with n = StarFieldSize / 4 (XNA path, bool_9; StarFieldSize defaults to 1000) and every layer at alpha
// method_45 = clamp(1 / sqrt(sqrt(zoomFactor))) = clamp(z^0.25). The original never magnifies an image here: every
// star is a small sprite drawn at its own size, so it stays sharp at any screen resolution.
//
// This port draws the same four layers as ParticleContainers (one draw call each) whose particles sample a mip-mapped
// atlas of the 128 px flare art, sized in CSS pixels — Pixi renders them at the renderer's full device resolution, so
// on a 4K / DPR-2 screen each 6 px star is 12 device pixels of 128 px source art, never an upscaled texture. The
// star positions are static; per frame each layer container only moves by its wrapped parallax offset (no particle
// writes, no allocation). Particles are rebuilt only when the viewport size changes.
//
// Deviations (documented):
//   - Star positions are deterministic from the galaxy seed (the original seeds from DateTime.Now.Ticks).
//   - Layer 0's tint is fixed per star (the original re-rolls it from Galaxy.Rnd every frame — a sim-RNG draw in the
//     renderer, which the port must not make; a per-frame colour flicker would also shimmer badly at 60 fps).
//   - Layer 0 pans by cam·z/6 like the others (the original divides the world position by 6 without the zoom, which
//     streaks the layer at up to 50× the map's speed at sector zoom).
//   - The hard cut at zoom factor 300 becomes the Main View's backdrop crossfade window (one seamless map), with the
//     z^0.25 dimming floored at 0.5 so the mid-zoom never goes black (task 02b2).
//   - A few very faint colour patches per system (deterministic from the system index), anchored to the system with a
//     deep parallax, give each system a slightly different sky; they fade by camera distance from the star, so
//     panning between systems cross-fades them.
//
// Render-only: no sim state is read beyond system positions / star types, nothing is written, no sim RNG is drawn.

import { Container, Particle, ParticleContainer, Rectangle, Sprite, Texture } from 'pixi.js';
import { useMinifyingFilter } from './assets';

// --- pure part ------------------------------------------------------------------------------------------------------

/** Smoothstep 0 at a → 1 at b (same curve as mainView.fadeIn; duplicated so this module stays leaf-level). */
function ramp(v: number, a: number, b: number): number {
    if (v <= a) return 0;
    if (v >= b) return 1;
    const t = (v - a) / (b - a);
    return t * t * (3 - 2 * t);
}

/** Background flare-star strength (1 = original): 50% (user call). */
export const STARFIELD_FLARE_SCALE = 0.5;
/** System colour-haze patch strength (1 = original): removed (user call: the big blobs at system zoom); 0 = not drawn. */
export const SYSTEM_PATCH_SCALE = 0;

/** Port of MainView.cs method_45: star brightness by zoom (z = px per world unit = 1 / zoomFactor). */
export function starBrightness(z: number): number {
    return Math.max(0, Math.min(1, Math.sqrt(Math.sqrt(Math.max(0, z)))));
}

/** Deep-starfield opacity: fades in over the galaxy backdrop's fade-out window [m*2.5, m*14] (m = minZoom), times
 *  the original's z^0.25 brightness, floored at 0.5 (see header). 0 at galaxy zoom, 1 at planet zoom (z >= 1). */
export function deepStarfieldAlpha(z: number, m: number): number {
    const win = ramp(z, m * 2.5, m * 14);
    if (win <= 0) return 0;
    return win * Math.max(0.5, starBrightness(z));
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
}

/** The original's four layers, back to front (MainView.1.cs 394-398). */
export const STAR_LAYERS: readonly StarLayerSpec[] = [
    { divisor: 38, size: 6, countMul: 16, tint: 0x7f7f7f, tile: 'small' },
    { divisor: 20, size: 7, countMul: 4, tint: 0xffffff, tile: 'small' },
    { divisor: 11, size: 11, countMul: 1, tint: 0xffffff, tile: 'small' },
    { divisor: 6, size: 20, countMul: 0.25, tint: -1, tile: 'large' },
];

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
    /** Tile-space position of each star's centre, CSS px in [0, tile). */
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
        xs[i] = rnd() * tile;
        ys[i] = rnd() * tile;
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

/** Wrapped parallax offset of a layer in [0, tile): camera screen position / divisor, positive modulo. */
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

const FLARE_CELL = 128;
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
    const s = FLARE_CELL;
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

export class DeepStarfield {
    /** Screen-space root, drawn behind the world (stage index 0). */
    readonly root = new Container();
    /** Faint per-system colour patches (behind the stars). */
    readonly patches = new Container();
    /** Layers 3..1 (the original's prerendered tiles) — the rim atmosphere tints / thins this as the "far" field. */
    readonly far = new Container();
    /** Layer 0 (the tinted near flares) — the rim atmosphere's "near" field. */
    readonly near = new Container();

    private atlasFrames: Texture[] = [];
    private layers: ParticleContainer[] = [];
    private layerData: StarLayerData[] = [];
    private builtW = -1;
    private builtH = -1;
    private blob: Texture | null = null;
    private patchSprites: Sprite[] = [];
    private patchCache = new Map<number, SystemPatches>();
    private ready = false;

    constructor(private readonly seed: number) {
        this.root.addChild(this.patches, this.far, this.near);
        this.root.visible = false;
        this.patches.visible = false;
    }

    /** Build the flare atlas from the install's mapstars/flares art (procedural fallback per missing file). */
    async load(flareUrls: readonly string[], loadImage: (url: string) => Promise<CanvasImageSource | null>): Promise<void> {
        const images = await Promise.all(flareUrls.map((u) => loadImage(u).catch(() => null)));
        const n = Math.max(4, images.length);
        const cols = Math.ceil(Math.sqrt(n));
        const rows = Math.ceil(n / cols);
        const canvas = makeCanvas(cols * FLARE_CELL, rows * FLARE_CELL);
        const ctx = canvas.getContext('2d')!;
        for (let i = 0; i < n; i++) {
            const cx = (i % cols) * FLARE_CELL;
            const cy = Math.floor(i / cols) * FLARE_CELL;
            const img = images[i] ?? null;
            if (img !== null) {
                // 2 px transparent border keeps the deep mip levels from bleeding between cells.
                ctx.drawImage(img, cx + 2, cy + 2, FLARE_CELL - 4, FLARE_CELL - 4);
            } else {
                drawFallbackFlare(ctx, cx + FLARE_CELL / 2, cy + FLARE_CELL / 2, i);
            }
        }
        const atlas = Texture.from(canvas);
        useMinifyingFilter(atlas); // linear + mipmaps: the 128 px cells are drawn at 6..20 CSS px
        this.atlasFrames = [];
        for (let i = 0; i < n; i++) {
            const frame = new Rectangle((i % cols) * FLARE_CELL, Math.floor(i / cols) * FLARE_CELL, FLARE_CELL, FLARE_CELL);
            this.atlasFrames.push(new Texture({ source: atlas.source, frame }));
        }
        this.layerData = STAR_LAYERS.map(() => ({ tile: 0, count: 0, xs: new Float32Array(0), ys: new Float32Array(0), frames: new Uint16Array(0), tints: new Uint32Array(0) }));
        this.layers = STAR_LAYERS.map((_, i) => {
            const pc = new ParticleContainer({ texture: atlas, dynamicProperties: { position: false, vertex: false, rotation: false, uvs: false, color: false } });
            (i === STAR_LAYERS.length - 1 ? this.near : this.far).addChild(pc);
            return pc;
        });
        this.blob = this.makeBlobTexture();
        this.builtW = -1;
        this.ready = true;
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

    /** (Re)build every layer's particles for a view of w × h CSS px (on first use and on resize only). */
    private build(w: number, h: number): void {
        this.builtW = w;
        this.builtH = h;
        const screenMax = Math.max(w, h);
        for (let li = 0; li < STAR_LAYERS.length; li++) {
            const spec = STAR_LAYERS[li];
            const data = generateStarLayer(this.seed, li, screenMax, this.atlasFrames.length);
            this.layerData[li] = data;
            const pc = this.layers[li];
            pc.removeParticles();
            const nx = tileCopies(w, data.tile);
            const ny = tileCopies(h, data.tile);
            const scale = spec.size / FLARE_CELL;
            const out = pc.particleChildren;
            for (let ty = 0; ty < ny; ty++) {
                for (let tx = 0; tx < nx; tx++) {
                    for (let i = 0; i < data.count; i++) {
                        const x = data.xs[i] + tx * data.tile;
                        const y = data.ys[i] + ty * data.tile;
                        // Skip copies that can never reach the view (offset range is [0, tile)).
                        if (x - spec.size > w + data.tile || y - spec.size > h + data.tile) continue;
                        out.push(
                            new Particle({
                                texture: this.atlasFrames[data.frames[i]],
                                x,
                                y,
                                scaleX: scale,
                                scaleY: scale,
                                anchorX: 0.5,
                                anchorY: 0.5,
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
     * Per frame. `alpha` = deepStarfieldAlpha; camera screen position = cam·z (the map's own pan in px).
     * Sets `far` / `near` alpha (the rim atmosphere may then scale them down further).
     */
    update(alpha: number, camX: number, camY: number, z: number, viewW: number, viewH: number): void {
        const on = this.ready && alpha > 0.01;
        this.root.visible = on;
        this.far.alpha = alpha * STARFIELD_FLARE_SCALE;
        this.near.alpha = alpha * STARFIELD_FLARE_SCALE;
        if (!on) return;
        if (viewW !== this.builtW || viewH !== this.builtH) this.build(viewW, viewH);
        const sx = camX * z;
        const sy = camY * z;
        for (let li = 0; li < this.layers.length; li++) {
            const d = this.layerData[li];
            const div = STAR_LAYERS[li].divisor;
            this.layers[li].position.set(-layerOffset(sx, div, d.tile), -layerOffset(sy, div, d.tile));
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
