// Coloured nebula haze behind each solar system at system zoom (world space, behind orbits and planets, above the
// deep starfield).
//
// What the original does (Controls/MainView.cs method_42 / method_40 / method_41, Main.Part12.cs SastWuBaXc,
// NebulaCloudGenerator.cs GenerateNebulaBackdrop): when Game.ShowSystemNebulae is on and the view is closer than zoom
// factor 210 on a star that is not a black hole / supernova, a ThreadPool job generates ONE procedural cloud bitmap
// for the viewed system — nebulaCloudGenerator_0 (constructed with seed 1, so one colour-scheme table for the whole
// game) runs GenerateNebulaBackdrop(seed = SystemIndex, scaleFactor = double_2 (SystemNebulaeDetail 4.5 / 2.9 / 1.8 /
// 1.0)); the colour scheme is new Random(SystemIndex).Next(0, 17), the cloud is 3..4 curve-bounded blobs with Perlin
// / fBm noise, and it is placed near the star (a few px of jitter). It is drawn as a deep-parallax backdrop:
// position (star - camera) / 25 plus the cloud offset, magnified by 1 + (zoomFactor - 1) / 50 (clamped 1..5). Only
// the one system under the camera has a cloud; the images/environment/nebulae PNGs (NebulaArray*.png) are loaded by
// Main.LoadNebulae but are the galaxy-map nebula art, not this layer.
//
// This port keeps the idea — a per-system procedural cloud, deterministic from the system index, generated off the
// frame and cached — but follows the art direction for the recreation (documented deviation): the haze is anchored
// in world space to the system (one seamless map, so neighbouring systems keep their own clouds while panning), it is
// 1–3 patches off-centre from the star (20–50 % of the system radius) covering ~40–60 % of the system disc, the
// colours come from a dark, low-saturation palette (dark purple, magenta, pink, blue, green) instead of the
// generator's 17 bright schemes, and the shapes are domain-warped multi-octave value noise with soft edges and uneven
// density (dense cores, thin wisps, clear holes). It fades in around the original's zoom-factor-210 threshold as a
// crossfade instead of a hard switch.
//
// Render-only: reads system positions / star types, never touches sim state or the sim RNG.

import { BufferImageSource, Container, Sprite, Texture, type Renderer } from 'pixi.js';
import { useMinifyingFilter } from './assets';
import { hashSeed, mulberry32 } from './deepStarfield';
import { createGpuNebula, type GpuNebula } from './gpuNebula';

// --- pure part ------------------------------------------------------------------------------------------------------

function ramp(v: number, a: number, b: number): number {
    if (v <= a) return 0;
    if (v >= b) return 1;
    const t = (v - a) / (b - a);
    return t * t * (3 - 2 * t);
}

export interface NebulaPaletteEntry {
    name: string;
    r: number;
    g: number;
    b: number;
}

/** Dark, low-saturation nebula tones. Order matters: neighbours are the secondary tone inside a patch. */
export const SYSTEM_NEBULA_PALETTE: readonly NebulaPaletteEntry[] = [
    { name: 'dark purple', r: 84, g: 44, b: 112 },
    { name: 'magenta', r: 112, g: 40, b: 96 },
    { name: 'pink', r: 118, g: 58, b: 86 },
    { name: 'blue', r: 44, g: 64, b: 122 },
    { name: 'green', r: 40, g: 84, b: 70 },
];

export interface NebulaPatchParams {
    /** Patch centre relative to the star, as a fraction of the system radius. */
    dx: number;
    dy: number;
    /** Ellipse semi-axes of the patch footprint, as a fraction of the system radius. */
    a: number;
    b: number;
    /** Ellipse rotation, radians. */
    rotation: number;
    /** Palette indices: main tone and the secondary tone mixed in by a low-frequency noise. */
    colour: number;
    colour2: number;
    /** Peak opacity of the densest parts. */
    opacity: number;
    /** Domain-warp strength (ellipse units). */
    warp: number;
    /** Base noise frequency (cycles per ellipse radius). */
    freq: number;
    /** Density threshold: higher = more holes and wisps, lower = more even haze. */
    threshold: number;
    /** Seed of this patch's noise lattice. */
    noiseSeed: number;
}

export interface SystemNebulaParams {
    /** Nominal footprint: sum of the patch ellipse areas over the system disc area. */
    coverage: number;
    patches: NebulaPatchParams[];
}

export const MIN_PATCH_OFFSET = 0.2;
export const MAX_PATCH_OFFSET = 0.5;
export const MIN_COVERAGE = 0.4;
export const MAX_COVERAGE = 0.6;

/** A system's nebula patches, deterministic from (galaxy seed, system index). */
export function systemNebulaParams(galaxySeed: number, systemIndex: number): SystemNebulaParams {
    const rnd = mulberry32(hashSeed(galaxySeed, 0x5e7b1a, systemIndex));
    const count = 1 + Math.floor(rnd() * 3); // 1..3
    const coverage = MIN_COVERAGE + rnd() * (MAX_COVERAGE - MIN_COVERAGE);
    const weights: number[] = [];
    let wSum = 0;
    for (let i = 0; i < count; i++) {
        const w = 0.45 + rnd();
        weights.push(w);
        wSum += w;
    }
    const pal = SYSTEM_NEBULA_PALETTE.length;
    const base = Math.floor(rnd() * pal);
    const baseAngle = rnd() * Math.PI * 2;
    const patches: NebulaPatchParams[] = [];
    let angle = baseAngle;
    for (let i = 0; i < count; i++) {
        const area = (coverage * weights[i]) / wSum; // a·b, in units of R²
        const aspect = 1 + rnd() * 0.8;
        const a = Math.sqrt(area * aspect);
        const b = Math.sqrt(area / aspect);
        const dist = MIN_PATCH_OFFSET + rnd() * (MAX_PATCH_OFFSET - MIN_PATCH_OFFSET);
        // One colour family per system: extra patches mostly repeat the main tone, else take a palette neighbour.
        const colour = i === 0 || rnd() < 0.7 ? base : (base + (rnd() < 0.5 ? 1 : pal - 1)) % pal;
        const colour2 = (colour + (rnd() < 0.5 ? 1 : pal - 1)) % pal;
        patches.push({
            dx: Math.cos(angle) * dist,
            dy: Math.sin(angle) * dist,
            a,
            b,
            // Mostly along the tangent, so a stretched patch drifts around the star rather than pointing at it.
            rotation: angle + Math.PI / 2 + (rnd() - 0.5) * 1.4,
            colour,
            colour2,
            opacity: 0.48 + rnd() * 0.18,
            warp: 0.38 + rnd() * 0.12,
            freq: 1.0 + rnd() * 0.7,
            threshold: 0.17 + rnd() * 0.12,
            noiseSeed: Math.floor(rnd() * 4294967296) >>> 0,
        });
        // Spread the next patch around the star (90°..200° on), so patches rarely stack.
        angle += Math.PI * (0.5 + rnd() * 0.6);
    }
    return { coverage, patches };
}

/** Sum of the patch footprints (ellipse areas) over the system disc area. */
export function nebulaCoverage(p: SystemNebulaParams): number {
    let s = 0;
    for (const q of p.patches) s += q.a * q.b;
    return s;
}

/**
 * Zoom fade (z = px per world unit). The original draws the cloud below zoom factor 210 with a hard switch; here it
 * crossfades in over zoom factor 320 → 140 around that threshold, with the other system-zoom layers.
 */
export function systemNebulaZoomAlpha(z: number): number {
    return ramp(z, 1 / 320, 1 / 140);
}

/** Texture half-extent in ellipse units: the warped envelope reaches zero inside it, so the border is transparent. */
export const PATCH_TEXTURE_EXTENT = 1.7;

/** Warped radius (ellipse units) where the envelope reaches zero; EXTENT - ENV_OUTER > max warp shift (0.5 / √2). */
const ENV_OUTER = 1.34;

/** Patch texture size (px, square) for a device pixel ratio: 224 per DPR, multiple of 32, capped at 512. The haze is
 *  soft, but at system zoom the largest patch still spans ~1200+ device px on a 4K screen, so 160 per DPR left it
 *  magnified ~4x (soft-edged blocks); 224 keeps one patch at ~11 ms of idle-slice raster time at DPR 2. */
export function nebulaTextureSize(dpr: number): number {
    const d = Math.max(1, Math.min(4, Number.isFinite(dpr) ? dpr : 1));
    return Math.min(512, Math.max(128, Math.round((224 * d) / 32) * 32));
}

/**
 * Deterministic triangular-PDF dither in (-1, 1) (units of one 8-bit step) for texel (x, y) and a seed: the sum of two
 * uniform hashes minus 1. Render-only — a pure integer hash, never the sim RNG. Added to a value just before it is
 * stored in an 8-bit channel, it turns the flat quantisation steps of a slow gradient into fine noise whose local mean
 * is the exact value (no banding), and bilinear magnification averages it away.
 */
export function tpdfDither(x: number, y: number, seed: number): number {
    let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ seed;
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
    h ^= h >>> 15;
    return ((h & 0xffff) + ((h >>> 16) & 0xffff)) / 65535 - 1;
}

/** A patch's texture size: `base` for the largest patches, scaled with the major axis (same texel density), >= base/2. */
export function patchTextureSize(base: number, p: NebulaPatchParams): number {
    const k = Math.min(1, Math.max(0.5, p.a / 0.9));
    return Math.max(64, Math.round((base * k) / 16) * 16);
}

// Value noise on a 64×64 periodic lattice with a smoothstep (C1) interpolant.
const LATTICE = 64;
const LMASK = LATTICE - 1;

function makeLattice(seed: number): Float32Array {
    const rnd = mulberry32(seed);
    const l = new Float32Array(LATTICE * LATTICE);
    for (let i = 0; i < l.length; i++) l[i] = rnd();
    return l;
}

function vnoise(l: Float32Array, x: number, y: number): number {
    const xf = Math.floor(x);
    const yf = Math.floor(y);
    let tx = x - xf;
    let ty = y - yf;
    tx = tx * tx * (3 - 2 * tx);
    ty = ty * ty * (3 - 2 * ty);
    const x0 = xf & LMASK;
    const y0 = (yf & LMASK) * LATTICE;
    const x1 = (xf + 1) & LMASK;
    const y1 = ((yf + 1) & LMASK) * LATTICE;
    const a = l[y0 + x0];
    const b = l[y0 + x1];
    const c = l[y1 + x0];
    const d = l[y1 + x1];
    const top = a + (b - a) * tx;
    return top + (c + (d - c) * tx - top) * ty;
}

/** fBm in [0, 1): `oct` octaves, lacunarity ~2.03, gain 0.5; each octave shifted to decorrelate. */
function fbm(l: Float32Array, x: number, y: number, oct: number): number {
    let sum = 0;
    let amp = 0.5;
    let norm = 0;
    let f = 1;
    for (let o = 0; o < oct; o++) {
        sum += amp * vnoise(l, x * f + o * 17.3, y * f - o * 11.1);
        norm += amp;
        amp *= 0.5;
        f *= 2.03;
    }
    return sum / norm;
}

function smooth01(e0: number, e1: number, v: number): number {
    return ramp(v, e0, e1);
}

/**
 * Rasterises one patch (RGBA, premultiplied alpha, TPDF-dithered before the 8-bit store) row by row, so the work can be
 * spread over idle slices. Premultiplying here (instead of on GL upload) lets the dither act on the values the GPU
 * actually samples: a premultiplied dark tone at a low alpha has only ~50 levels, which over a ~300-texel patch left
 * flat runs of 40+ texels (bands, magnified ~4x on screen).
 * Texture space: [-EXTENT, EXTENT]² in ellipse units (the sprite stretches it to the ellipse's a × b and rotates it).
 */
export class NebulaPatchRaster {
    readonly data: Uint8ClampedArray;
    private row = 0;
    private readonly lattice: Float32Array;
    private readonly c1: NebulaPaletteEntry;
    private readonly c2: NebulaPaletteEntry;

    constructor(
        readonly params: NebulaPatchParams,
        readonly size: number,
    ) {
        this.data = new Uint8ClampedArray(size * size * 4);
        this.lattice = makeLattice(params.noiseSeed);
        this.c1 = SYSTEM_NEBULA_PALETTE[params.colour];
        this.c2 = SYSTEM_NEBULA_PALETTE[params.colour2];
    }

    get done(): boolean {
        return this.row >= this.size;
    }

    /** Rasterise up to `rows` more rows; returns true when finished. */
    step(rows: number): boolean {
        const { size, data, lattice: l, params: p, c1, c2 } = this;
        const E = PATCH_TEXTURE_EXTENT;
        const inv = (2 * E) / size;
        const W = p.warp;
        const F = p.freq;
        const thr = p.threshold;
        const alphaMax = 255 * p.opacity;
        // Farthest a pixel can be displaced by the warp (each component is within ±W/2).
        const reject = ENV_OUTER + W * Math.SQRT1_2;
        const end = Math.min(size, this.row + rows);
        const seedC = p.noiseSeed | 0;
        const seedA = (p.noiseSeed ^ 0x6a09e667) | 0;
        for (let j = this.row; j < end; j++) {
            const y = -E + (j + 0.5) * inv;
            let o = j * size * 4;
            for (let i = 0; i < size; i++, o += 4) {
                const x = -E + (i + 0.5) * inv;
                if (x * x + y * y >= reject * reject) {
                    data[o + 3] = 0;
                    continue;
                }
                // Domain warp (two low-octave fields, centred on 0, each component within ±W/2).
                const wx = fbm(l, x * 1.5 + 5.2, y * 1.5 + 1.3, 2) - 0.5;
                const wy = fbm(l, x * 1.5 + 9.7, y * 1.5 + 23.1, 2) - 0.5;
                const xw = x + W * wx;
                const yw = y + W * wy;
                const r = Math.sqrt(xw * xw + yw * yw);
                if (r >= ENV_OUTER) {
                    data[o + 3] = 0;
                    continue;
                }
                // Soft envelope: full inside ~0.45, about half at the nominal ellipse (r = 1), zero at ENV_OUTER.
                const env = 1 - smooth01(0.45, ENV_OUTER, r);
                // Density: fBm of the warped position, pulled down towards the rim, thresholded into cores / wisps /
                // holes, then a ridge-ish second pass for filaments.
                const n = fbm(l, xw * F + 31.7, yw * F + 3.9, 5);
                const v = n + (env - 1) * 0.45;
                let d = smooth01(thr, thr + 0.55, v);
                d = d * (0.55 + 0.45 * d); // denser cores, thinner wisps
                // A faint veil under the structure, so the thin parts still tint the sky.
                d = Math.max(d, 0.1 * env * env);
                d *= smooth01(0, 0.35, env);
                if (d <= 0.002) {
                    data[o + 3] = 0;
                    continue;
                }
                // Tone: two palette colours mixed by a slow noise, a little brighter in the dense cores.
                const t = smooth01(0.38, 0.62, fbm(l, x * 0.9 + 47.3, y * 0.9 + 12.8, 2));
                const lum = 0.75 + 0.35 * d;
                const a = alphaMax * d;
                const k = (lum * a) / 255; // straight colour → premultiplied
                // One dither value for the three colour channels (keeps the hue), an independent one for alpha; the
                // clamped store rounds to nearest. Colour is kept <= alpha (valid premultiplied: no additive specks).
                const nc = tpdfDither(i, j, seedC);
                const aq = Math.min(255, Math.max(0, Math.round(a + tpdfDither(i, j, seedA))));
                data[o] = Math.min(aq, (c1.r + (c2.r - c1.r) * t) * k + nc);
                data[o + 1] = Math.min(aq, (c1.g + (c2.g - c1.g) * t) * k + nc);
                data[o + 2] = Math.min(aq, (c1.b + (c2.b - c1.b) * t) * k + nc);
                data[o + 3] = aq;
            }
        }
        this.row = end;
        return this.done;
    }
}

// --- Pixi part ------------------------------------------------------------------------------------------------------

export interface NebulaSystem {
    index: number;
    x: number;
    y: number;
    /** System radius (world units): farthest orbit plus margin. */
    radius: number;
    /** False for black holes / supernovae (the original draws no system nebula there). */
    enabled: boolean;
}

/** Most systems with textures kept (least recently seen are destroyed first). */
const CACHE_LIMIT = 10;
/** Seconds for a freshly generated system to fade up (no pop-in). */
const READY_FADE_S = 0.6;
/** Idle-slice budget, ms. */
const SLICE_MS = 6;

interface Entry {
    sys: NebulaSystem;
    params: SystemNebulaParams;
    container: Container | null;
    rasters: NebulaPatchRaster[];
    textures: Texture[];
    ready: boolean;
    readySince: number;
    lastSeen: number;
    /** Generation time (ms, summed over slices) — for the perf budget check. */
    genMs: number;
}

type IdleDeadline = { timeRemaining(): number; didTimeout?: boolean };
type IdleWindow = { requestIdleCallback?: (cb: (d: IdleDeadline) => void, o?: { timeout: number }) => number };

export class SystemNebulaLayer {
    /** World-space layer; mainView adds it just below the system roots. */
    readonly root = new Container();
    private entries = new Map<number, Entry>();
    private queue: Entry[] = [];
    private scheduled = false;
    private frame = 0;
    private readonly size: number;
    /** WebGL fragment-shader rasteriser (one pass per patch); null = CPU idle-slice path (tests / headless / WebGPU). */
    private gpu: GpuNebula | null;

    constructor(
        private readonly galaxySeed: number,
        dpr: number,
        renderer?: Renderer | null,
    ) {
        this.size = nebulaTextureSize(dpr);
        this.gpu = createGpuNebula(renderer);
        this.root.label = 'systemNebulae';
    }

    /** Generation time of a system's textures in ms (undefined until finished) — perf diagnostics. */
    generationMs(index: number): number | undefined {
        const e = this.entries.get(index);
        return e?.ready ? e.genMs : undefined;
    }

    /**
     * Per frame. `z` = px per world unit, camera centre (world) and view size (CSS px). `systems` are all systems;
     * only those whose disc is on screen are touched.
     */
    update(z: number, camX: number, camY: number, viewW: number, viewH: number, systems: readonly NebulaSystem[], nowMs: number): void {
        this.frame++;
        const zoomA = systemNebulaZoomAlpha(z);
        const on = zoomA > 0.004;
        this.root.visible = on;
        if (!on) return;
        const halfW = viewW / 2 / z;
        const halfH = viewH / 2 / z;
        for (const e of this.entries.values()) if (e.container) e.container.visible = false;
        for (let s = 0; s < systems.length; s++) {
            const sys = systems[s];
            if (!sys.enabled) continue;
            const reach = sys.radius * 1.9; // offset + stretched patch + texture margin
            if (Math.abs(sys.x - camX) > halfW + reach || Math.abs(sys.y - camY) > halfH + reach) continue;
            let e = this.entries.get(sys.index);
            if (e === undefined) {
                e = this.createEntry(sys);
            }
            e.lastSeen = this.frame;
            if (!e.ready) continue;
            if (e.readySince < 0) e.readySince = nowMs;
            const fadeUp = Math.min(1, (nowMs - e.readySince) / (READY_FADE_S * 1000));
            const c = e.container!;
            c.visible = true;
            c.alpha = zoomA * fadeUp * fadeUp * (3 - 2 * fadeUp);
        }
        if (this.queue.length > 0) this.schedule();
    }

    private createEntry(sys: NebulaSystem): Entry {
        if (this.entries.size >= CACHE_LIMIT) this.evict();
        const params = systemNebulaParams(this.galaxySeed, sys.index);
        const e: Entry = {
            sys,
            params,
            container: null,
            rasters: this.gpu ? [] : params.patches.map((p) => new NebulaPatchRaster(p, patchTextureSize(this.size, p))),
            textures: [],
            ready: false,
            readySince: -1,
            lastSeen: this.frame,
            genMs: 0,
        };
        this.entries.set(sys.index, e);
        this.queue.push(e);
        return e;
    }

    private evict(): void {
        let victim: Entry | null = null;
        for (const e of this.entries.values()) {
            if (e.lastSeen === this.frame) continue;
            if (victim === null || e.lastSeen < victim.lastSeen) victim = e;
        }
        if (victim === null) return;
        this.entries.delete(victim.sys.index);
        const qi = this.queue.indexOf(victim);
        if (qi >= 0) this.queue.splice(qi, 1);
        if (victim.container) {
            this.root.removeChild(victim.container);
            victim.container.destroy({ children: true });
        }
        for (const t of victim.textures) t.destroy(true);
    }

    private schedule(): void {
        if (this.scheduled) return;
        this.scheduled = true;
        const w = (typeof window !== 'undefined' ? window : {}) as IdleWindow;
        if (typeof w.requestIdleCallback === 'function') {
            // Idle time when the frame leaves some; the timeout keeps generation moving (in SLICE_MS / 2 slices)
            // when a busy frame loop never leaves any.
            w.requestIdleCallback((d) => this.work(d.didTimeout === true ? SLICE_MS / 2 : Math.min(SLICE_MS, d.timeRemaining() - 1)), { timeout: 60 });
        } else {
            setTimeout(() => this.work(SLICE_MS / 2), 0);
        }
    }

    /** Rasterise queued patches for about `budgetMs` (at least one 16-row chunk); finished systems become sprites. */
    private work(budgetMs: number): void {
        this.scheduled = false;
        const t0 = performance.now();
        // Most recently wanted first (the system under the camera beats one panned past).
        this.queue.sort((a, b) => b.lastSeen - a.lastSeen);
        if (this.gpu) {
            // One GPU pass per patch (at 2x the CPU resolution, capped at 1024): finish the wanted system now.
            const e = this.queue.shift()!;
            const s0 = performance.now();
            try {
                const E = PATCH_TEXTURE_EXTENT;
                for (const p of e.params.patches) {
                    const c1 = SYSTEM_NEBULA_PALETTE[p.colour];
                    const c2 = SYSTEM_NEBULA_PALETTE[p.colour2];
                    e.textures.push(
                        this.gpu.render(
                            { lattice: makeLattice(p.noiseSeed), warp: p.warp, freq: p.freq, threshold: p.threshold, opacity: p.opacity, c1: [c1.r, c1.g, c1.b], c2: [c2.r, c2.g, c2.b], extent: E, envOuter: ENV_OUTER },
                            Math.min(1024, patchTextureSize(this.size, p) * 2),
                        ),
                    );
                }
                e.genMs += performance.now() - s0;
                this.finish(e);
            } catch {
                for (const t of e.textures) t.destroy(true);
                e.textures = [];
                this.gpuFailed(e);
            }
            if (this.queue.length > 0) this.schedule();
            return;
        }
        let first = true;
        while (this.queue.length > 0 && (first || performance.now() - t0 < budgetMs)) {
            first = false;
            const e = this.queue[0];
            const s0 = performance.now();
            const r = e.rasters.find((x) => !x.done);
            if (r !== undefined) r.step(16);
            e.genMs += performance.now() - s0;
            if (e.rasters.every((x) => x.done)) {
                this.queue.shift();
                this.finish(e);
            }
        }
        if (this.queue.length > 0) this.schedule();
    }

    /** GPU render threw: drop to the CPU path for this system. */
    private gpuFailed(e: Entry): void {
        this.gpu = null;
        e.rasters = e.params.patches.map((p) => new NebulaPatchRaster(p, patchTextureSize(this.size, p)));
        this.queue.push(e);
    }

    private finish(e: Entry): void {
        const s0 = performance.now();
        const c = new Container();
        const R = e.sys.radius;
        const E = PATCH_TEXTURE_EXTENT;
        const gpuTex = e.textures.length > 0 ? e.textures : null;
        const patches = e.params.patches;
        for (let pi = 0; pi < patches.length; pi++) {
            const r = e.rasters[pi];
            let tex: Texture;
            if (gpuTex) tex = gpuTex[pi];
            else {
                // Premultiplied, dithered RGBA straight from the raster (no canvas copy, no premultiply on upload).
                const source = new BufferImageSource({
                    resource: r.data,
                    width: r.size,
                    height: r.size,
                    format: 'rgba8unorm',
                    alphaMode: 'premultiplied-alpha',
                });
                tex = new Texture({ source });
                useMinifyingFilter(tex); // linear + mipmaps: magnified at system zoom, minified while zooming out
                e.textures.push(tex);
            }
            const p = patches[pi];
            const spr = new Sprite(tex);
            spr.anchor.set(0.5);
            spr.position.set(e.sys.x + p.dx * R, e.sys.y + p.dy * R);
            spr.rotation = p.rotation;
            spr.width = 2 * E * p.a * R;
            spr.height = 2 * E * p.b * R;
            c.addChild(spr);
        }
        e.rasters = [];
        c.visible = false;
        e.container = c;
        this.root.addChild(c);
        e.ready = true;
        e.genMs += performance.now() - s0;
    }
}
