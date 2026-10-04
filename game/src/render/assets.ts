// Texture loading/caching for the Main View. Original art is served from
// `/assets/dwu/images/...` (mapped by the desktop shell / vite public
// symlink to the user's DW:U install folder, see CLAUDE.md). Planets, moons and
// asteroids use Habitat.PictureRef directly as the original's HabitatImageCache
// index (habitatPictureUrls, sim/galaxyImages.ts HABITAT_IMAGE_SETS). The
// browser can't enumerate the install's art folders, so
// `scripts/gen-asset-manifest.mjs` (predev/prebuild) writes
// public/asset-manifest.json = { "<folder under images/environment/>": [sorted
// file names] }; loadManifest() fetches it at boot. Stars use Habitat.MapPictureRef as the index of the original's
// bitmap_196 (mapStarImageUrls, the LoadMapStars folder listings); the gas-cloud URL builder picks a real file out of
// its folder via pictureRef modulo the folder's file count. Without a manifest (no install) every builder
// returns [] and the store falls back to generated textures — the view must
// render (and stay console-clean) with or without the install.

import { Assets, Texture } from 'pixi.js';
import { Habitat, HabitatCategoryType, HabitatType } from '../sim/types';
import { HABITAT_IMAGE_COUNT, MAP_STAR_IMAGE_FOLDERS, habitatImageFile } from '../sim/galaxyImages';
import { themeArtFolder, themedAssetUrl, themeOtherPlanetUrls } from '../themeAssets';

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
 * file count (gas clouds: the port does not model their own picture indices).
 * Returns [] when the folder is unknown or empty.
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

/**
 * Port of Main.Part13.cs LoadMapStars 993-1051: bitmap_196, the map-star pictures — every *.png of
 * images/environment/mapstars/<folder>/ for the folders mainsequence, redgiant, supergiant, whitedwarf, neutron,
 * blackhole (sim/galaxyImages.ts MAP_STAR_IMAGE_FOLDERS), concatenated in that order (the manifest's listing is the
 * Directory.GetFiles order). LoadMapStars reads the stock install only (Main.Part12.cs 1018; themeAssets.ts BASE_ONLY).
 * Index i is Habitat.MapPictureRef i (GalaxyImages.cs 59-71: 0-5 main sequence, 6 red giant, 7 super giant, 8-10
 * white dwarf, 11-12 neutron, 13 black hole). [] without a manifest.
 */
export function mapStarImageUrls(): string[] {
    const urls: string[] = [];
    for (const { folder } of MAP_STAR_IMAGE_FOLDERS) for (const f of MANIFEST[`mapstars/${folder}`] ?? []) urls.push(`${IMG}/environment/mapstars/${folder}/${f}`);
    return urls;
}

/** bitmap_196[mapPictureRef] (mapStarImageUrls), or null outside the table. */
export function mapStarImageUrl(mapPictureRef: number): string | null {
    if (!Number.isInteger(mapPictureRef) || mapPictureRef < 0) return null;
    return mapStarImageUrls()[mapPictureRef] ?? null;
}

/**
 * A star's map picture, bitmap_196[habitat.MapPictureRef], as a loadFirst list ([] for a habitat that is no star or
 * without art). The C# draws it for every star wherever it shows a star's picture: the Main View galaxy pass
 * (MainView.2.cs 5437 texture2D_18 = bitmap_196) and the system-zoom discs' tint (MainView.1.cs 741 method_120), the
 * selected system's panel (Main.Part10.cs 1422) and the item lists (ItemListPanel.cs 951) — a super nova too, whose
 * MapPictureRef is SelectStar's 0; the Main View and the habitat panel draw a super nova's own picture instead
 * (starPictureUrls).
 */
export function mapStarUrls(habitat: Habitat): string[] {
    if (habitat.category !== HabitatCategoryType.Star) return [];
    const url = mapStarImageUrl(habitat.mapPictureRef);
    return url === null ? [] : [url];
}

/**
 * Port of Main.Part13.cs 1189-1215: bitmap_206, the super-nova pictures — every *.png of images/environment/supernovae/
 * (the theme's folder when it holds a *.png: themeAssets.ts FOLDER_RULES), Directory.GetFiles order. Indexed by
 * Habitat.NovaImageIndexMajor (Galaxy.5.cs SetupSun 1357, Rnd.Next(0, NovaImageCountMajor = 20)).
 */
export function supernovaImageUrls(): string[] {
    const theme = themeArtFolder('images/environment/supernovae');
    if (theme !== null) return theme.files.filter((f) => f.toLowerCase().endsWith('.png')).map((f) => theme.urlOf(f));
    return (MANIFEST['supernovae'] ?? []).map((f) => `${IMG}/environment/supernovae/${f}`);
}

/**
 * The picture of a star where the C# draws it with its own art (MainView.cs method_54 — the selection panel's habitat
 * picture and the hover panel, Main.Part10.cs 1193-1205 — and the Main View galaxy pass, MainView.2.cs 5429-5438): a
 * super nova's bitmap_206[NovaImageIndexMajor], any other star's bitmap_196[MapPictureRef] (mapStarUrls).
 */
export function starPictureUrls(habitat: Habitat): string[] {
    if (habitat.category === HabitatCategoryType.Star && habitat.type === HabitatType.SuperNova) {
        const url = supernovaImageUrls()[habitat.novaImageIndexMajor];
        return url === undefined ? [] : [url];
    }
    return mapStarUrls(habitat);
}

/**
 * The black hole's system-zoom sprite (f < 150, MainView.1.cs 649-722): a still accretion frame
 * (stars/blackhole/BlkHole-0001.png, the first of the method_117 animation frames), else star_blackhole_0.png.
 * TODO(port): the C# animates it — star_blackhole_0 (texture2D_12[0]) drawn three times rotating, tinted by
 * HabitatIndex % 4, under the BlkHole-* frames (texture2D_13) at 15 fps — MainView.1.cs method_76 649-722. [] for any
 * other star (their system-zoom art is the disc + corona group, mainView.ts buildStarDiscs).
 */
export function starSpriteUrls(habitat: Habitat): string[] {
    if (habitat.type !== HabitatType.BlackHole) return [];
    const frames = MANIFEST['stars/blackhole'] ?? [];
    const urls = frames.length > 0 ? [`${IMG}/environment/stars/blackhole/${frames[0]}`] : [];
    urls.push(`${IMG}/environment/stars/star_blackhole_0.png`);
    return urls;
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

const manifestSets = new WeakMap<string[], Set<string>>();
/** Whether the manifest lists images/environment/`file` (folder/name). */
function manifestHasFile(file: string): boolean {
    const slash = file.lastIndexOf('/');
    const files = MANIFEST[file.slice(0, slash)];
    if (files === undefined) return false;
    let set = manifestSets.get(files);
    if (set === undefined) manifestSets.set(files, (set = new Set(files)));
    return set.has(file.slice(slash + 1));
}

/**
 * HabitatImageCache.ObtainImage(habitat.PictureRef) / ResolveImageFilename (HabitatImageCache.cs 236-268): the planet,
 * moon or asteroid picture `pictureRef` — a fixed GalaxyImages picture (0-664, images/environment/<folder>/<file>, a
 * theme's copy through themedAssetUrl) or a theme's planets/other picture (665+). Null when there is none: out of
 * range (the C#'s empty file name), or the file is missing — LoadImage's File.Exists, answered by the asset manifest
 * (so without an install, no manifest: null, and the views draw their generated fallback) or the active theme.
 */
export function habitatPictureUrl(pictureRef: number): string | null {
    const file = habitatImageFile(pictureRef);
    if (file !== null) {
        const url = `${IMG}/environment/${file}`;
        return manifestHasFile(file) || themedAssetUrl(url) !== url ? url : null;
    }
    if (!Number.isInteger(pictureRef) || pictureRef < HABITAT_IMAGE_COUNT) return null;
    return themeOtherPlanetUrls()[pictureRef - HABITAT_IMAGE_COUNT] ?? null;
}

/** The planet / moon / asteroid sprite of `habitat` (habitatPictureUrl of its PictureRef) as a loadFirst list. */
export function habitatPictureUrls(habitat: Habitat): string[] {
    const url = habitatPictureUrl(habitat.pictureRef);
    return url === null ? [] : [url];
}

/**
 * Gas-cloud nebula art: the install ships a single flat nebulae/ folder
 * (NebulaArray*.png), so all cloud types share it (task 02b1).
 */
export function cloudUrls(habitat: Habitat): string[] {
    return pickFromFolder('nebulae', habitat.pictureRef);
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
// With a theme active the install file is swapped for the theme's copy where the original would load that
// (themeAssets.ts themedAssetUrl; unchanged with no theme).
function absoluteUrl(url: string): string {
    url = themedAssetUrl(url);
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
        const key = urls.length > 0 ? themedAssetUrl(urls[0]) : urls[0];
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
     * never applied (e.g. the grey mapstars/flares profile would brighten their halos ~17%). Every /assets/dwu/ PNG
     * and JPEG is already served without its colour chunks (desktop/colorProfile.cjs, used by the Vite dev server and
     * the Electron dwu:// handler), so every load path decodes raw values; colorSpaceConversion 'none' keeps this
     * one raw even from a server that does not strip them. Not cached: callers bake the result into their own texture.
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
