// Texture loading/caching for the Main View. Original art is served from
// `/assets/dwu/images/...` (mapped by the desktop shell / vite public
// symlink to the user's DW:U install folder, see CLAUDE.md). Filenames
// inside the original art folders are not part of the engine's public
// contract, so every logical asset is loaded from a short candidate-URL
// list and falls back to a generated texture when none exists — the view
// must render (and stay console-clean) with or without the install.

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
// Candidate URL builders. Folders per the original install layout
// (Main.Part12.cs:1962 backdrops, Main.Part13.cs:993 map stars).

// Port of Main.Part13.cs LoadMapStars: map-star icons live under
// images/environment/mapstars/<type>/.
const STAR_MAP_FOLDERS: Record<string, string> = {
    [HabitatType.MainSequence]: 'mainsequence',
    [HabitatType.RedGiant]: 'redgiant',
    [HabitatType.SuperGiant]: 'supergiant',
    [HabitatType.WhiteDwarf]: 'whitedwarf',
    [HabitatType.Neutron]: 'neutron',
    [HabitatType.BlackHole]: 'blackhole',
    [HabitatType.SuperNova]: 'flares',
};

const PLANET_FOLDERS: Record<string, string[]> = {
    [HabitatType.Volcanic]: ['volcanic'],
    [HabitatType.Desert]: ['desert'],
    [HabitatType.MarshySwamp]: ['marshy', 'swamp'],
    [HabitatType.Continental]: ['continental'],
    [HabitatType.Ocean]: ['ocean'],
    [HabitatType.BarrenRock]: ['barren_rock', 'barrenrock'],
    [HabitatType.Ice]: ['ice'],
    [HabitatType.GasGiant]: ['gas_giant', 'gasgiant'],
    [HabitatType.FrozenGasGiant]: ['frozen_gas_giant', 'frozengasgiant'],
};

const CLOUD_FOLDERS: Record<string, string> = {
    [HabitatType.Hydrogen]: 'hydrogen',
    [HabitatType.Helium]: 'helium',
    [HabitatType.Argon]: 'argon',
    [HabitatType.Ammonia]: 'ammonia',
    [HabitatType.CarbonDioxide]: 'carbon_dioxide',
    [HabitatType.Chlorine]: 'chlorine',
    [HabitatType.Oxygen]: 'oxygen',
    [HabitatType.NitrogenOxygen]: 'nitrogen_oxygen',
};

const IMG = '/assets/dwu/images';

export function mapStarUrls(habitat: Habitat): string[] {
    const folder = STAR_MAP_FOLDERS[habitat.type] ?? 'mainsequence';
    return [`${IMG}/environment/mapstars/${folder}/${habitat.pictureRef}.png`];
}

// Full star sprites at system zoom (Main.Part12.cs star art).
export function starSpriteUrls(habitat: Habitat): string[] {
    const folder = STAR_MAP_FOLDERS[habitat.type] ?? 'mainsequence';
    const urls = [`${IMG}/environment/stars/${folder}/${habitat.pictureRef}.png`];
    if (habitat.type === HabitatType.BlackHole) {
        urls.push(`${IMG}/environment/stars/blackhole/${habitat.pictureRef}.png`);
    }
    return urls;
}

// Planet sprites: chosen via the habitat's pictureRef (task 01), e.g.
// ocean planet pictureRef 900..909 -> images/environment/planets/ocean/.
export function planetUrls(habitat: Habitat): string[] {
    const folders = PLANET_FOLDERS[habitat.type] ?? ['ocean'];
    const urls: string[] = [];
    for (const folder of folders) {
        urls.push(`${IMG}/environment/planets/${folder}/${habitat.pictureRef}.png`);
        urls.push(`${IMG}/environment/planets/${folder}/planet_${habitat.pictureRef}.png`);
    }
    return urls;
}

export function cloudUrls(habitat: Habitat): string[] {
    const folder = CLOUD_FOLDERS[habitat.type] ?? 'hydrogen';
    return [`${IMG}/environment/nebulae/${folder}/${habitat.pictureRef}.png`];
}

export function asteroidUrls(habitat: Habitat): string[] {
    return [`${IMG}/environment/asteroids/${habitat.pictureRef}.png`];
}

export const BACKDROP_URLS = [`${IMG}/environment/galaxybackdrops/galaxy_backdrop.jpg`];

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

/** Dense tiny-white-dot starfield tile (procedural, non-sim randomness). */
export function makeStarfieldTexture(size = 512, density = 220): Texture {
    return canvasTexture(size, (ctx, s) => {
        ctx.clearRect(0, 0, s, s);
        for (let i = 0; i < density; i++) {
            const x = pseudo(i * 7 + 1) * s;
            const y = pseudo(i * 7 + 2) * s;
            const r = 0.4 + pseudo(i * 7 + 3) * 0.9;
            const a = 0.35 + pseudo(i * 7 + 4) * 0.65;
            ctx.fillStyle = `rgba(255,255,255,${a})`;
            ctx.fillRect(x, y, r, r);
        }
    });
}

/** Deterministic [0,1) pseudo-random from an integer key. */
function pseudo(i: number): number {
    const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
}

// ---------------------------------------------------------------------------
// Asset store: candidate-URL loading with caching + generated fallbacks.

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
            this.cache.set(key, tex);
            return Promise.resolve(tex);
        }
        const promise = (async () => {
            for (const url of urls) {
                try {
                    const tex = await Assets.load(url);
                    this.cache.set(key, tex);
                    return tex;
                } catch {
                    // 404 / decode failure: try the next candidate.
                }
            }
            const tex = fallback();
            this.cache.set(key, tex);
            return tex;
        })();
        this.cache.set(key, promise);
        return promise;
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
                            result = await Assets.load(url);
                            break;
                        } catch {
                            // try the next candidate URL
                        }
                    }
                }
                if (result === null) {
                    result = fb();
                }
                this.cache.set(key, result);
                out.set(key, result);
            }),
        );
        return out;
    }
}