// Texture loading/caching for the Main View. Original art is served from
// `/assets/dwu/images/...` (mapped by the desktop shell / vite public
// symlink to the user's DW:U install folder, see CLAUDE.md). The browser can't
// enumerate the install's art folders, so `scripts/gen-asset-manifest.mjs`
// (predev/prebuild) writes public/asset-manifest.json = { "<folder under
// images/environment/>": [sorted file names] }; loadManifest() fetches it at
// boot and the URL builders below pick a REAL file out of each folder via
// pictureRef modulo the folder's file count (the port's pictureRef values
// don't match the original engine's offset scheme, so direct indexing would
// 404). Without a manifest (no install) every builder returns [] and the
// store falls back to generated textures — the view must render (and stay
// console-clean) with or without the install.

import { Assets, Texture } from 'pixi.js';
import { Habitat, HabitatType } from '../sim/types';

// ---------------------------------------------------------------------------
// Fallback colors (match the original art palettes: yellow/white main
// sequence, orange-red giants, blue-white dwarfs, dark black holes).

export const STAR_COLORS: Record<string, { glow: string; core: string }> = {
    [HabitatType.MainSequence]: { glow: '#ffd27f', core: '#fff6e0' },
    [HabitatType.RedGiant]: { glow: '#ff7a4d', core: '#ffd9a0' },
    [HabitatType.SuperGiant]: { glow: '#ff6b45', core: '#ffc890' },
    [HabitatType.WhiteDwarf]: { glow: '#cfe8ff', core: '#ffffff' },
    [HabitatType.Neutron]: { glow: '#b0c4de', core: '#e8f0ff' },
    [HabitatType.BlackHole]: { glow: '#6a5acd', core: '#000000' },
    [HabitatType.SuperNova]: { glow: '#ff5555', core: '#fff0c0' },
};

export const PLANET_COLORS: Record<string, string> = {
    [HabitatType.Volcanic]: '#a05535',
    [HabitatType.Desert]: '#d0a050',
    [HabitatType.MarshySwamp]: '#709040',
    [HabitatType.Continental]: '#5fa060',
    [HabitatType.Ocean]: '#3070c8',
    [HabitatType.BarrenRock]: '#98907c',
    [HabitatType.Ice]: '#cfeef5',
    [HabitatType.GasGiant]: '#d09060',
    [HabitatType.FrozenGasGiant]: '#95b5d5',
};

export const CLOUD_COLORS: Record<string, string> = {
    [HabitatType.Hydrogen]: '#88ccff',
    [HabitatType.Helium]: '#ffe9a0',
    [HabitatType.Argon]: '#b8ffe0',
    [HabitatType.Ammonia]: '#c0d8ff',
    [HabitatType.CarbonDioxide]: '#b0e8d8',
    [HabitatType.Chlorine]: '#d0f0a0',
    [HabitatType.Oxygen]: '#a0e8ff',
    [HabitatType.NitrogenOxygen]: '#c0c8ff',
};

// ---------------------------------------------------------------------------
// Real-art URL builders. Folders per the original install layout
// (Main.Part12.cs:1962 backdrops, Main.Part13.cs:993 map stars).

const IMG = '/assets/dwu/images';

/**
 * File lists for every folder under images/environment/, keyed by path
 * relative to that directory (e.g. "planets/ocean"). Written by
 * scripts/gen-asset-manifest.mjs; empty until loadManifest() resolves it.
 */
export const MANIFEST: Record<string, string[]> = {};

/** Fetch public/asset-manifest.json into MANIFEST (no-op if unreachable). */
export async function loadManifest(): Promise<void> {
    try {
        const r = await fetch('/asset-manifest.json');
        if (r.ok) {
            const j = (await r.json()) as Record<string, string[]>;
            if (j && typeof j === 'object') {
                Object.assign(MANIFEST, j);
            }
        }
    } catch {
        // no manifest (install absent / built shell without it) -> fallbacks
    }
}

/**
 * Pick a real file from a manifest folder: `pictureRef` modulo the folder's
 * file count (task 02b1 — the port's pictureRef values don't align with the
 * original engine's offset scheme, so direct indexing would 404). Returns []
 * when the folder is unknown or empty.
 */
export function pickFromFolder(folder: string, pictureRef: number): string[] {
    const files = MANIFEST[folder];
    if (!files || files.length === 0) {
        return [];
    }
    const i = ((pictureRef % files.length) + files.length) % files.length;
    return [`${IMG}/environment/${folder}/${files[i]}`];
}

/** The manifest's sorted file-name list for `key` (e.g. "Help",
 *  "Customization/<set>/help"); undefined when loadManifest() has not run or
 *  the key is absent. Unlike pickFromFolder this covers every manifest key,
 *  not just images/environment/ folders. */
export function manifestFiles(key: string): string[] | undefined {
    return MANIFEST[key];
}

// Port of Main.Part13.cs LoadMapStars: map-star icons live under
// images/environment/mapstars/<type>/ and are indexed by MapPictureRef.
const STAR_MAP_FOLDERS: Record<string, string> = {
    [HabitatType.MainSequence]: 'mainsequence',
    [HabitatType.RedGiant]: 'redgiant',
    [HabitatType.SuperGiant]: 'supergiant',
    [HabitatType.WhiteDwarf]: 'whitedwarf',
    [HabitatType.Neutron]: 'neutron',
    [HabitatType.BlackHole]: 'blackhole',
    [HabitatType.SuperNova]: 'flares',
};

// Planet/moon art folders per type (real install names under planets/).
const PLANET_FOLDERS: Record<string, string> = {
    [HabitatType.Volcanic]: 'volcanic',
    [HabitatType.Desert]: 'sandydesert',
    [HabitatType.MarshySwamp]: 'marshyswamp',
    [HabitatType.Continental]: 'continental',
    [HabitatType.Ocean]: 'ocean',
    [HabitatType.BarrenRock]: 'barrenrock',
    [HabitatType.Ice]: 'iceglacial',
    [HabitatType.GasGiant]: 'gasgiant',
    [HabitatType.FrozenGasGiant]: 'frozengasgiant',
};

// Asteroid belt art per composition (real install folders under asteroids/).
const ASTEROID_FOLDERS: Record<string, string> = {
    [HabitatType.BarrenRock]: 'rocky',
    [HabitatType.Ice]: 'ice',
    [HabitatType.Metal]: 'metal',
};

export function mapStarUrls(habitat: Habitat): string[] {
    const folder = `mapstars/${STAR_MAP_FOLDERS[habitat.type] ?? 'mainsequence'}`;
    return pickFromFolder(folder, habitat.pictureRef);
}

/**
 * Full star sprites at system zoom (Main.Part13.cs LoadStars): one of three
 * shared discs (`stars/star_disc_<n>.png`, n = pictureRef % 3) plus an
 * animated corona ray frame (`stars/rays/CoronaA-<nnnn>.png`). Black holes
 * use the dedicated disc + accretion-disc art instead.
 */
export function starSpriteUrls(habitat: Habitat): string[] {
    if (habitat.type === HabitatType.BlackHole) {
        const urls = [...pickFromFolder('stars/blackhole', habitat.pictureRef)];
        urls.push(`${IMG}/environment/stars/star_blackhole_0.png`);
        return urls;
    }
    const disc = `${IMG}/environment/stars/star_disc_${habitat.pictureRef % 3}.png`;
    const rays = pickFromFolder('stars/rays', habitat.pictureRef);
    return [disc, ...rays];
}

// Task 02c2: the GPU renderer draws system-zoom stars as two tinted,
// counter-rotating discs (star_disc_2 under star_disc_0) plus an animated
// corona frame (MainView.1.cs ~740-782). These URLs are fixed install files
// (no manifest lookup needed).

/** `stars/star_disc_<n>.png` — one of the shared rotating star discs. */
export function starDiscUrl(n: number): string {
    return `${IMG}/environment/stars/star_disc_${n}.png`;
}

/** All 100 frames of `stars/rays/Corona<B|C>-<nnnn>.png` (1-based). */
export function coronaFrameUrls(kind: 'B' | 'C'): string[] {
    const urls: string[] = [];
    for (let i = 1; i <= 100; i++) {
        urls.push(`${IMG}/environment/stars/rays/Corona${kind}-${String(i).padStart(4, '0')}.png`);
    }
    return urls;
}

// Port of MainView.1.cs method_65: scale each RGB channel by f, clamped to
// 0..255 (integer truncation, like C# (int)(channel * f)).
export function scaleColour(rgb: number, f: number): number {
    const r = Math.min(255, ((rgb >> 16) & 0xff) * f);
    const g = Math.min(255, ((rgb >> 8) & 0xff) * f);
    const b = Math.min(255, (rgb & 0xff) * f);
    return ((r | 0) << 16) | ((g | 0) << 8) | (b | 0);
}

// Port of MainView.1.cs method_117 frame selection: loopMs = frameCount / fps
// seconds; stepMs = loopMs / max(1, frameCount - 1); frame = floor((nowMs %
// loopMs) / stepMs), so it advances once per step and wraps at frameCount.
export function coronaFrameIndex(nowMs: number, frameCount: number, fps: number): number {
    if (frameCount <= 0) {
        return 0;
    }
    const loopMs = (frameCount / fps) * 1000;
    const stepMs = loopMs / Math.max(1, frameCount - 1);
    return Math.floor((nowMs % loopMs) / stepMs);
}

const centreColourCache = new Map<string, Promise<number>>();

/**
 * Centre pixel colour (0xRRGGBB) of a loaded image: drawn to a canvas and
 * read at (⌊w/2⌋, ⌊h/2⌋) — the original samples the map-star icon's centre
 * pixel to tint the system-zoom discs/corona (method_120 in MainView.1.cs).
 * Cached per URL; resolves to 0xffffff when the image can't be fetched or
 * decoded (keeps the view console-clean without an install).
 */
export async function sampleCentreColour(url: string): Promise<number> {
    let p = centreColourCache.get(url);
    if (!p) {
        p = (async () => {
            try {
                const img = await new Promise<HTMLImageElement>((resolve, reject) => {
                    const el = new Image();
                    el.onload = () => resolve(el);
                    el.onerror = () => reject(new Error(`image load failed: ${url}`));
                    el.src = url;
                });
                const w = img.naturalWidth || img.width;
                const h = img.naturalHeight || img.height;
                if (!w || !h) {
                    throw new Error(`zero-size image: ${url}`);
                }
                const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : document.createElement('canvas');
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d')!;
                ctx.drawImage(img, 0, 0);
                const px = ctx.getImageData(Math.floor(w / 2), Math.floor(h / 2), 1, 1).data;
                return (px[0] << 16) | (px[1] << 8) | px[2];
            } catch {
                return 0xffffff;
            }
        })();
        centreColourCache.set(url, p);
    }
    return p;
}

/** Planet/moon sprite: type folder, index = pictureRef modulo file count. */
export function planetUrls(habitat: Habitat): string[] {
    const folder = `planets/${PLANET_FOLDERS[habitat.type] ?? 'ocean'}`;
    return pickFromFolder(folder, habitat.pictureRef);
}

/**
 * Gas-cloud nebula art: the install ships a single flat nebulae/ folder
 * (NebulaArray*.png), so all cloud types share it (task 02b1).
 */
export function cloudUrls(habitat: Habitat): string[] {
    return pickFromFolder('nebulae', habitat.pictureRef);
}

export function asteroidUrls(habitat: Habitat): string[] {
    const folder = `asteroids/${ASTEROID_FOLDERS[habitat.type] ?? 'rocky'}`;
    return pickFromFolder(folder, habitat.pictureRef);
}

export const BACKDROP_URLS = [`${IMG}/environment/galaxybackdrops/galaxy_backdrop.jpg`];

// Warn once per missing URL (keeps the console informative but quiet).
const warnedMissing = new Set<string>();
export function warnMissing(url: string): void {
    if (!warnedMissing.has(url)) {
        warnedMissing.add(url);
        console.warn(`missing DW:U art: ${url}`);
    }
}

// ---------------------------------------------------------------------------
// Generated fallback textures (canvas-based, deterministic).

function canvasTexture(size: number, draw: (ctx: CanvasRenderingContext2D, size: number) => void): Texture {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    draw(ctx, size);
    return Texture.from(canvas);
}

function rgba(hex: string, alpha: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
}

/** Soft circular glow disc (star icon / planet dot fallback). */
export function makeGlowTexture(glowColor: string, coreColor: string, size = 128): Texture {
    return canvasTexture(size, (ctx, s) => {
        const c = s / 2;
        const grad = ctx.createRadialGradient(c, c, 0, c, c, c);
        grad.addColorStop(0.0, rgba(coreColor, 1));
        grad.addColorStop(0.25, rgba(coreColor, 0.95));
        grad.addColorStop(0.45, rgba(glowColor, 0.55));
        grad.addColorStop(0.7, rgba(glowColor, 0.18));
        grad.addColorStop(1.0, rgba(glowColor, 0));
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, s, s);
    });
}

/** Small flat dot (planets at mid zoom, moons, asteroids). */
export function makeDotTexture(color: string, size = 64): Texture {
    return canvasTexture(size, (ctx, s) => {
        const c = s / 2;
        const grad = ctx.createRadialGradient(c, c, 0, c, c, c);
        grad.addColorStop(0.0, rgba(color, 1));
        grad.addColorStop(0.7, rgba(color, 1));
        grad.addColorStop(0.85, rgba(color, 0.35));
        grad.addColorStop(1.0, rgba(color, 0));
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, s, s);
    });
}

/** Full star sprite fallback: hot disc with a flared corona. */
export function makeStarSpriteTexture(type: HabitatType): Texture {
    const colors = STAR_COLORS[type] ?? STAR_COLORS[HabitatType.MainSequence];
    if (type === HabitatType.BlackHole) {
        // Event horizon (black) with a glowing accretion rim.
        return canvasTexture(256, (ctx, s) => {
            const c = s / 2;
            const rim = ctx.createRadialGradient(c, c, s * 0.30, c, c, s * 0.48);
            rim.addColorStop(0.0, 'rgba(0,0,0,0)');
            rim.addColorStop(0.45, 'rgba(140,110,255,0.85)');
            rim.addColorStop(0.7, 'rgba(120,180,255,0.35)');
            rim.addColorStop(1.0, 'rgba(120,180,255,0)');
            ctx.fillStyle = rim;
            ctx.fillRect(0, 0, s, s);
            ctx.fillStyle = '#000000';
            ctx.beginPath();
            ctx.arc(c, c, s * 0.30, 0, Math.PI * 2);
            ctx.fill();
        });
    }
    return canvasTexture(256, (ctx, s) => {
        const c = s / 2;
        const corona = ctx.createRadialGradient(c, c, 0, c, c, c);
        corona.addColorStop(0.0, rgba(colors.core, 1));
        corona.addColorStop(0.30, rgba(colors.core, 1));
        corona.addColorStop(0.40, rgba(colors.glow, 0.9));
        corona.addColorStop(0.55, rgba(colors.glow, 0.45));
        corona.addColorStop(0.8, rgba(colors.glow, 0.12));
        corona.addColorStop(1.0, rgba(colors.glow, 0));
        ctx.fillStyle = corona;
        ctx.fillRect(0, 0, s, s);
    });
}

/** Shaded sphere fallback for planet sprites. */
export function makePlanetTexture(color: string): Texture {
    return canvasTexture(128, (ctx, s) => {
        const c = s / 2;
        const light = ctx.createRadialGradient(c * 0.7, c * 0.7, s * 0.05, c, c, c);
        light.addColorStop(0.0, rgba('#ffffff', 0.25));
        light.addColorStop(0.4, rgba(color, 1));
        light.addColorStop(0.85, rgba('#000000', 0.85));
        light.addColorStop(1.0, rgba('#000000', 0.95));
        ctx.fillStyle = light;
        ctx.beginPath();
        ctx.arc(c, c, c * 0.92, 0, Math.PI * 2);
        ctx.fill();
    });
}

/** Soft irregular nebula blob fallback for gas clouds. */
export function makeCloudTexture(color: string): Texture {
    return canvasTexture(256, (ctx, s) => {
        const blobs = 7;
        for (let i = 0; i < blobs; i++) {
            const x = s * (0.25 + 0.5 * pseudo(i * 3 + 1));
            const y = s * (0.25 + 0.5 * pseudo(i * 3 + 2));
            const r = s * (0.16 + 0.22 * pseudo(i * 3 + 3));
            const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
            grad.addColorStop(0.0, rgba(color, 0.30));
            grad.addColorStop(0.6, rgba(color, 0.12));
            grad.addColorStop(1.0, rgba(color, 0));
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, s, s);
        }
    });
}

/** Dim blue/teal nebula wash fallback for the galaxy backdrop. */
export function makeBackdropTexture(): Texture {
    return canvasTexture(512, (ctx, s) => {
        ctx.fillStyle = '#05070f';
        ctx.fillRect(0, 0, s, s);
        const wash = (x: number, y: number, r: number, color: string, a: number) => {
            const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
            grad.addColorStop(0, rgba(color, a));
            grad.addColorStop(1, rgba(color, 0));
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, s, s);
        };
        wash(s * 0.5, s * 0.48, s * 0.5, '#4a6a9a', 0.55); // bright core
        wash(s * 0.3, s * 0.35, s * 0.35, '#3a5a8a', 0.35);
        wash(s * 0.7, s * 0.6, s * 0.4, '#3a5f8f', 0.3);
        wash(s * 0.62, s * 0.3, s * 0.25, '#2e4a75', 0.3);
        // Dark dust lanes.
        ctx.globalAlpha = 0.5;
        for (let i = 0; i < 8; i++) {
            const x = s * pseudo(i + 10);
            const y = s * pseudo(i + 20);
            const grad = ctx.createRadialGradient(x, y, 0, x, y, s * 0.18);
            grad.addColorStop(0, 'rgba(4,6,12,0.8)');
            grad.addColorStop(1, 'rgba(4,6,12,0)');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, s, s);
        }
        ctx.globalAlpha = 1;
    });
}

/** Deterministic [0,1) pseudo-random from an integer key. */
function pseudo(i: number): number {
    const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
}

// ---------------------------------------------------------------------------
// Asset store: candidate-URL loading with caching + generated fallbacks.

// Pixi's asset resolver joins root-relative paths itself and, under the packaged
// app's custom scheme (dwu://app/…), turns "/assets/dwu/x" into "dwu://assets/dwu/x".
// Resolve against the document first so every scheme gets a correct absolute URL.
function absoluteUrl(url: string): string {
    return typeof document !== 'undefined' ? new URL(url, document.baseURI).href : url;
}

export class AssetStore {
    private cache = new Map<string, Texture | Promise<Texture>>();

    /** Whether a DW:U install (with original art) is present. */
    readonly dwuPresent: boolean;

    constructor(dwuPresent: boolean) {
        this.dwuPresent = dwuPresent;
    }

    /**
     * Load the first URL of `urls` that exists; otherwise return
     * `fallback()`. Results are cached by `urls[0]`. When no DW:U install
     * is present this returns the fallback immediately without fetching
     * (keeps the console clean and the render instant).
     */
    loadFirst(urls: string[], fallback: () => Texture): Promise<Texture> {
        const key = urls[0];
        const hit = this.cache.get(key);
        if (hit) {
            return hit instanceof Texture ? Promise.resolve(hit) : hit;
        }
        if (!this.dwuPresent || urls.length === 0) {
            const tex = fallback();
            useMinifyingFilter(tex);
            this.cache.set(key, tex);
            return Promise.resolve(tex);
        }
        const promise = (async () => {
            for (const url of urls) {
                try {
                    const tex: Texture = await Assets.load(absoluteUrl(url));
                    useMinifyingFilter(tex);
                    this.cache.set(key, tex);
                    return tex;
                } catch {
                    // 404 / decode failure: warn once, try the next candidate.
                    warnMissing(url);
                }
            }
            const tex = fallback();
            useMinifyingFilter(tex);
            this.cache.set(key, tex);
            return tex;
        })();
        this.cache.set(key, promise);
        return promise;
    }

    /**
     * Decode an original image with its embedded colour profile ignored (raw sample values), or null when there is
     * no install / the file is missing. The original loads art with `new Bitmap(path)` (DistantWorlds.Types
     * GraphicsHelper.cs LoadImageFromFilePath), i.e. GDI+ without ICM, so the iCCP profiles most DW:U PNGs carry are
     * never applied; the browser applies them by default (e.g. the grey mapstars/flares profile brightens their
     * halos ~17%). Not cached: callers bake the result into their own texture.
     */
    async loadRawImage(url: string): Promise<ImageBitmap | null> {
        if (!this.dwuPresent) return null;
        try {
            const r = await fetch(absoluteUrl(url));
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return await createImageBitmap(await r.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'default' });
        } catch {
            warnMissing(url);
            return null;
        }
    }

    /** Preload a set of (key, urls, fallback) assets in parallel. */
    async preload(entries: Array<[string, string[], () => Texture]>): Promise<Map<string, Texture>> {
        const out = new Map<string, Texture>();
        await Promise.all(
            entries.map(async ([key, urls, fb]) => {
                let result: Texture | null = null;
                if (this.dwuPresent) {
                    for (const url of urls) {
                        try {
                            result = await Assets.load(absoluteUrl(url));
                            break;
                        } catch {
                            // 404 / decode failure: warn once, try the next candidate URL.
                            warnMissing(url);
                        }
                    }
                }
                if (result === null) {
                    result = fb();
                }
                useMinifyingFilter(result);
                this.cache.set(key, result);
                out.set(key, result);
            }),
        );
        return out;
    }
}

/**
 * Give a map texture a trilinear mip chain. The main view draws planets, moons,
 * stars, corona frames, map-star icons, rocks, gas clouds, the backdrop and
 * ship art far smaller than their source images at system/sector zoom; with
 * Pixi's default (bilinear, no mips) that skips most texels and speckles the
 * art. The C# never minifies raw art that way — e.g. for ships
 * PrepareBuiltObjectImageNEW
 * (Main.Part12.cs:4533-4555, zoom 1.0) first redraws the art at
 * the 100% size with InterpolationMode.HighQualityBicubic (okQtJmsUqH,
 * Main.Part12.cs:5064-5074), and MainView.1.cs:1018-1024 uploads that, drawn
 * with SamplerState.AnisotropicClamp (MainView.cs:1511-1517). A full
 * trilinear mip chain is the GPU equivalent of that filtered pre-scale.
 * Applied centrally by AssetStore to every texture it hands out (loaded art
 * and procedural fallbacks); the shared Texture.EMPTY / Texture.WHITE are left
 * alone. Render-only: no sim state is touched.
 */
export function useMinifyingFilter(texture: Texture): void {
    if (texture === Texture.EMPTY || texture === Texture.WHITE) return;
    const source = texture.source;
    if (source.autoGenerateMipmaps && source.scaleMode === 'linear') return;
    source.autoGenerateMipmaps = true;
    // Sets mag, min and mipmap filters to linear (trilinear minification).
    source.scaleMode = 'linear';
    source.maxAnisotropy = 16;
    // Mip levels are allocated when the source is first uploaded; drop any
    // earlier GPU copy so the next render re-creates it with the chain.
    source.unload();
}
