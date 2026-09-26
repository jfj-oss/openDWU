// 19i "Rim atmosphere" — the visual half (tasks/19-mod-layer-scenarios.md §19i items 1, 3, 4, 5, 6, 7, 13).
//
// Presentation only: reads sim state (galaxy extent, star positions, the player's explored systems) and never writes
// it; every draw here is render-side randomness (a local PRNG seeded from the galaxy seed, never galaxy.rnd), so no
// sim digest or pin moves. Gated on the scenario flag `rimAtmosphere`: with the flag off the layer is inert —
// mount() adds nothing to the scene graph and touches no sprite, update() returns at once and lightScale is null —
// so the Main View draws exactly as without it (test/rim-atmosphere.test.ts).
//
// The distance-from-centre curve is computed here from the galaxy extent: centre = (sizeX/2, sizeY/2), radius = the
// 98th-percentile star distance from that centre (falls back to sizeX/2), so the rim band follows where the stars actually end on
// every galaxy shape. rimWeight() is 0 inside `rimInner` and eases to 1 over a band outward.
//
// What it draws (all procedural Graphics/canvas textures or original art under /assets/dwu — no art files):
//   (1) colour grading — a world-space radial wash over the backdrop + nebula images (desaturating, cold blue-violet),
//       cold tint on rim map-star icons and on the screen-space parallax starfield by camera position;
//   (3) rim nebulae become dark dust lanes (tinted near-black so they occlude the backdrop) + grainy grey murk over
//       every unexplored rim system (the player's EmpireVisibility.checkSystemExplored — the same test the
//       Potential Colonies overlay uses; the map has no other unexplored fade today);
//   (4) thinner deep field — the parallax starfield's alpha drops with rim depth;
//   (5) decorative derelicts — a deterministic scatter of dead stations / hulks (original ship art, dark-tinted, slowly
//       tumbling) in deep rim space and near rim systems; not selectable (the sim version belongs to 19h / 19j);
//   (6) creature silhouettes — dim, dark, slow-drifting original creature sprites orbiting in the rim at galaxy zoom;
//   (7) nav lights / planetary-shield glow dimmed on the rim (AmbientLayer.lightScale hook);
//   (13) vignette + film grain on the main view while the camera is deep in the rim.
// Exported for the data/wiring package (minimap outer-band dimming, music/ambient weights): rimGeometry, rimFraction,
// rimWeight, rimParams.

import { Container, Sprite, Texture, TilingSprite } from 'pixi.js';
import type { Camera } from './camera';
import type { AssetStore } from './assets';
import { boundsOnScreen, DrawKey } from './drawCache';
import { FrameSet, SpritePool } from './fxCommon';
import type { Galaxy } from '../sim/galaxy';
import type { SystemInfo } from '../sim/types';
import { scenarioFlag, scenarioParam } from '../sim/scenario';

export const RIM_FLAG = 'rimAtmosphere';

/** Resolved scenario params (see scenarios/rim-atmosphere/scenario.json). */
export interface RimParams {
    /** Radius fraction where the rim band starts (0..1 of the rim radius). */
    rimInner: number;
    /** Colour grading strength 0..1: wash, cold tint, dust lanes, deep-field thinning, vignette. */
    tintStrength: number;
    /** Unexplored-rim murk strength 0..1 (and the film grain). */
    murkStrength: number;
    /** Creature silhouettes: multiplier on the base count (6) and their opacity (0 = none). */
    silhouetteDensity: number;
    /** Derelicts: multiplier on the base count (80; 0 = none). */
    derelictDensity: number;
    /** How much nav lights / shield glow dim at full rim depth, 0..1. */
    lightDimming: number;
}

export const RIM_DEFAULTS: RimParams = {
    rimInner: 0.72,
    tintStrength: 0.6,
    murkStrength: 0.7,
    silhouetteDensity: 1,
    derelictDensity: 1,
    lightDimming: 0.6,
};

function clamp01(v: number): number {
    return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** The rim params of this galaxy's scenario, or null when the `rimAtmosphere` flag is off / there is no scenario. */
export function rimParams(galaxy: Galaxy): RimParams | null {
    if (!scenarioFlag(galaxy, RIM_FLAG)) return null;
    return {
        rimInner: Math.min(0.98, Math.max(0, scenarioParam(galaxy, 'rimInner', RIM_DEFAULTS.rimInner))),
        tintStrength: clamp01(scenarioParam(galaxy, 'tintStrength', RIM_DEFAULTS.tintStrength)),
        murkStrength: clamp01(scenarioParam(galaxy, 'murkStrength', RIM_DEFAULTS.murkStrength)),
        silhouetteDensity: Math.max(0, scenarioParam(galaxy, 'silhouetteDensity', RIM_DEFAULTS.silhouetteDensity)),
        derelictDensity: Math.max(0, scenarioParam(galaxy, 'derelictDensity', RIM_DEFAULTS.derelictDensity)),
        lightDimming: clamp01(scenarioParam(galaxy, 'lightDimming', RIM_DEFAULTS.lightDimming)),
    };
}

/** Galaxy centre and rim radius (world units). */
export interface RimGeometry {
    cx: number;
    cy: number;
    radius: number;
}

/** Share of stars inside the rim radius: the radius is this quantile of the star distances, so a few outlying
 * corner stars do not push the whole rim band outward. */
export const RIM_RADIUS_QUANTILE = 0.98;

/** Centre = the middle of the galaxy rect; radius = the 98th-percentile star distance from it (sizeX/2 without
 * stars). */
export function rimGeometry(sizeX: number, sizeY: number, stars: readonly { xpos: number; ypos: number }[]): RimGeometry {
    const cx = sizeX / 2;
    const cy = sizeY / 2;
    const d = new Float64Array(stars.length);
    for (let i = 0; i < stars.length; i++) {
        const dx = stars[i].xpos - cx;
        const dy = stars[i].ypos - cy;
        d[i] = Math.sqrt(dx * dx + dy * dy);
    }
    d.sort();
    const r = d.length > 0 ? d[Math.floor(RIM_RADIUS_QUANTILE * (d.length - 1))] : 0;
    return { cx, cy, radius: r > 0 ? r : Math.max(1, cx) };
}

/** Distance from the centre as a fraction of the rim radius (1 = the 98th-percentile star distance). */
export function rimFraction(geo: RimGeometry, x: number, y: number): number {
    const dx = x - geo.cx;
    const dy = y - geo.cy;
    return Math.sqrt(dx * dx + dy * dy) / geo.radius;
}

/** Width of the fade-in band past rimInner (fraction of the radius). */
export function rimBand(rimInner: number): number {
    return Math.min(0.3, Math.max(0.04, (1 - rimInner) * 0.5));
}

/** 0 inside rimInner, smoothstep to 1 across the band, 1 beyond. */
export function rimWeight(fraction: number, rimInner: number): number {
    const a = rimInner;
    const b = rimInner + rimBand(rimInner);
    if (fraction <= a) return 0;
    if (fraction >= b) return 1;
    const t = (fraction - a) / (b - a);
    return t * t * (3 - 2 * t);
}

/** Channel-wise linear blend of two 0xRRGGBB colours. */
export function lerpColour(a: number, b: number, t: number): number {
    const k = clamp01(t);
    const r = Math.round(((a >> 16) & 255) + (((b >> 16) & 255) - ((a >> 16) & 255)) * k);
    const g = Math.round(((a >> 8) & 255) + (((b >> 8) & 255) - ((a >> 8) & 255)) * k);
    const bl = Math.round((a & 255) + ((b & 255) - (a & 255)) * k);
    return (r << 16) | (g << 8) | bl;
}

/** Cold blue-violet multiply tint (stars, starfield). */
export const RIM_COLD = 0x7a80d6;
/** Dust-lane tint for rim nebulae (near-black, faintly warm-grey). */
export const RIM_DUST = 0x26232c;
/** Silhouette / derelict tints. */
export const RIM_SILHOUETTE = 0x0c0e16;
export const RIM_DERELICT = 0x6a625c;

/** Multiply tint for a sprite at rim weight `w`: white inside, towards RIM_COLD at full depth × strength. */
export function rimTint(w: number, strength: number): number {
    return lerpColour(0xffffff, RIM_COLD, w * strength);
}

/** Nebula tint: cold first, then dark dust lane past the band's middle. */
export function rimNebulaTint(w: number, strength: number): number {
    const cold = rimTint(w, strength);
    return lerpColour(cold, RIM_DUST, clamp01((w - 0.35) / 0.65) * Math.min(1, strength * 1.4));
}

/** Parallax starfield alpha multipliers at camera rim weight `w` (the deep field thins out). */
export function deepFieldThinning(w: number, strength: number): { far: number; near: number } {
    const k = clamp01(w * (0.4 + strength));
    return { far: 1 - 0.85 * k, near: 1 - 0.5 * k };
}

/** Nav light / glow alpha multiplier at rim weight `w`. */
export function rimLightScale(w: number, lightDimming: number): number {
    return 1 - clamp01(w) * clamp01(lightDimming);
}

/** One murk patch: a world-space blob over an unexplored rim system. */
export interface MurkPatch {
    x: number;
    y: number;
    /** Rim weight at the system (drives the opacity). */
    w: number;
}

/**
 * The murk hook (19i item 3 / 19h-5 sensor fog): one patch per system that lies in the rim band (weight > 0) and is
 * not explored by the viewing empire. `explored` is the empire's EmpireVisibility.checkSystemExplored; with no viewing
 * empire (null) nothing is fogged.
 */
export function murkPatches(
    systems: readonly SystemInfo[],
    geo: RimGeometry,
    rimInner: number,
    explored: ((systemIndex: number) => boolean) | null,
    out: MurkPatch[] = [],
): MurkPatch[] {
    out.length = 0;
    if (explored === null) return out;
    for (const sys of systems) {
        const star = sys.systemStar;
        if (star === null || star === undefined) continue;
        const w = rimWeight(rimFraction(geo, star.xpos, star.ypos), rimInner);
        if (w <= 0) continue;
        if (explored(star.systemIndex)) continue;
        out.push({ x: star.xpos, y: star.ypos, w });
    }
    return out;
}

/** Deterministic render-side PRNG (mulberry32) — never galaxy.rnd. */
export function rimRandom(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const IMG = '/assets/dwu/images';
const DERELICT_KINDS = ['genericbase', 'smallspaceport', 'mediumspaceport', 'miningstation', 'resortbase', 'gasminingstation', 'colonyship', 'cruiser', 'largefreighter'];
const SHIP_FAMILIES = 27;
const CREATURES: { dir: string; prefix: string }[] = [
    { dir: 'kaltor', prefix: 'Kaltor' },
    { dir: 'spaceslug', prefix: 'Slug' },
    { dir: 'silvermist', prefix: 'SilverMist' },
    { dir: 'ardilus', prefix: 'ArdillusMoving' },
];
const CREATURE_FRAMES = 12;
const BASE_SILHOUETTES = 6;
const BASE_DERELICTS = 80;

export interface Derelict {
    x: number;
    y: number;
    size: number;
    rot0: number;
    spin: number;
    url: string;
}

export interface Silhouette {
    creature: number;
    orbit: number;
    angle0: number;
    omega: number;
    size: number;
    phase: number;
}

/**
 * Derelict scatter (item 5): `count` hulks, half near rim systems (4000–14000 units from the star, so a rim system
 * view shows one), half free in deep rim space (fraction in [rimInner + band/2, 1.06]). Deterministic in `seed`.
 */
export function scatterDerelicts(geo: RimGeometry, rimInner: number, count: number, rimStars: readonly { xpos: number; ypos: number }[], seed: number): Derelict[] {
    const rnd = rimRandom(seed);
    const out: Derelict[] = [];
    const lo = rimInner + rimBand(rimInner) * 0.5;
    for (let i = 0; i < count; i++) {
        let x: number;
        let y: number;
        if (i % 2 === 0 && rimStars.length > 0) {
            const s = rimStars[Math.floor(rnd() * rimStars.length)];
            const a = rnd() * Math.PI * 2;
            const d = 4000 + rnd() * 10000;
            x = s.xpos + Math.cos(a) * d;
            y = s.ypos + Math.sin(a) * d;
        } else {
            const a = rnd() * Math.PI * 2;
            const f = lo + rnd() * Math.max(0.02, 1.06 - lo);
            x = geo.cx + Math.cos(a) * f * geo.radius;
            y = geo.cy + Math.sin(a) * f * geo.radius;
        }
        const kind = DERELICT_KINDS[Math.floor(rnd() * DERELICT_KINDS.length)];
        const family = Math.floor(rnd() * SHIP_FAMILIES);
        const station = kind.endsWith('base') || kind.endsWith('port') || kind.endsWith('station');
        out.push({
            x,
            y,
            size: (station ? 1400 : 700) * (0.7 + rnd() * 0.8),
            rot0: rnd() * Math.PI * 2,
            spin: (rnd() - 0.5) * 0.04,
            url: `${IMG}/units/ships/family${family}/${kind}.png`,
        });
    }
    return out;
}

/** Silhouette orbits (item 6): radius fractions in [rimInner + band/3, 1.15], one lap per 15–40 minutes. */
export function silhouetteOrbits(rimInner: number, count: number, seed: number): Silhouette[] {
    const rnd = rimRandom(seed ^ 0x5bd1e995);
    const out: Silhouette[] = [];
    const lo = rimInner + rimBand(rimInner) / 3;
    for (let i = 0; i < count; i++) {
        out.push({
            creature: Math.floor(rnd() * CREATURES.length),
            orbit: lo + rnd() * Math.max(0.02, 1.15 - lo),
            angle0: rnd() * Math.PI * 2,
            omega: ((rnd() < 0.5 ? -1 : 1) * (Math.PI * 2)) / (900 + rnd() * 1500),
            size: 0.05 + rnd() * 0.05,
            phase: rnd() * CREATURE_FRAMES,
        });
    }
    return out;
}

// --- procedural textures (canvas; generated once, only when the flag is on) ------------------------------------

function canvasTexture(size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void): Texture {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    draw(canvas.getContext('2d')!, size);
    return Texture.from(canvas);
}

/** Radial wash: transparent inside rimInner, dark cold blue-violet towards the rim; `halfSize` = sprite half side. */
function makeWashTexture(geo: RimGeometry, p: RimParams, halfSize: number): Texture {
    return canvasTexture(512, (ctx, s) => {
        const c = s / 2;
        const g = ctx.createRadialGradient(c, c, 0, c, c, c);
        const at = (f: number) => clamp01((f * geo.radius) / halfSize);
        const inner = at(p.rimInner);
        const mid = Math.max(inner + 0.001, at(p.rimInner + rimBand(p.rimInner)));
        const edge = Math.max(mid + 0.001, at(1.05));
        const k = p.tintStrength;
        g.addColorStop(0, 'rgba(22,24,46,0)');
        g.addColorStop(inner, 'rgba(22,24,46,0)');
        g.addColorStop(Math.min(1, mid), `rgba(22,24,46,${(0.5 * k).toFixed(3)})`);
        g.addColorStop(Math.min(1, edge), `rgba(12,13,28,${(0.8 * k).toFixed(3)})`);
        if (edge < 1) g.addColorStop(1, `rgba(8,9,20,${(0.85 * k).toFixed(3)})`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, s, s);
    });
}

/** Grainy grey murk blob: radial falloff × two octaves of value noise × per-pixel grain. */
function makeMurkTexture(): Texture {
    return canvasTexture(256, (ctx, s) => {
        const img = ctx.createImageData(s, s);
        const rnd = rimRandom(0x19c0ffee);
        const n = 17;
        const lattice = new Float32Array(n * n);
        for (let i = 0; i < lattice.length; i++) lattice[i] = rnd();
        const noise = (u: number, v: number): number => {
            const x = u * (n - 1);
            const y = v * (n - 1);
            const x0 = Math.min(n - 2, Math.floor(x));
            const y0 = Math.min(n - 2, Math.floor(y));
            const fx = x - x0;
            const fy = y - y0;
            const a = lattice[y0 * n + x0] + (lattice[y0 * n + x0 + 1] - lattice[y0 * n + x0]) * fx;
            const b = lattice[(y0 + 1) * n + x0] + (lattice[(y0 + 1) * n + x0 + 1] - lattice[(y0 + 1) * n + x0]) * fx;
            return a + (b - a) * fy;
        };
        for (let y = 0; y < s; y++) {
            for (let x = 0; x < s; x++) {
                const u = x / (s - 1);
                const v = y / (s - 1);
                const dx = u - 0.5;
                const dy = v - 0.5;
                const d = Math.sqrt(dx * dx + dy * dy) * 2;
                const fall = d >= 1 ? 0 : Math.pow(1 - d, 1.4);
                const cloud = 0.45 * noise(u, v) + 0.35 * noise((u * 3) % 1, (v * 3) % 1) + 0.2;
                const grain = 0.75 + rnd() * 0.5;
                const a = clamp01(fall * cloud * grain * 1.3);
                const grey = 120 + Math.floor(rnd() * 50);
                const i = (y * s + x) * 4;
                img.data[i] = grey;
                img.data[i + 1] = grey;
                img.data[i + 2] = grey + 8;
                img.data[i + 3] = Math.round(a * 255);
            }
        }
        ctx.putImageData(img, 0, 0);
    });
}

/** Screen vignette: clear centre, black corners. */
function makeVignetteTexture(): Texture {
    return canvasTexture(256, (ctx, s) => {
        const c = s / 2;
        const g = ctx.createRadialGradient(c, c, c * 0.35, c, c, c * 1.42);
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(0.55, 'rgba(4,4,12,0.35)');
        g.addColorStop(1, 'rgba(0,0,6,0.95)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, s, s);
    });
}

/** Film grain tile: random grey specks. */
function makeGrainTexture(): Texture {
    return canvasTexture(256, (ctx, s) => {
        const img = ctx.createImageData(s, s);
        const rnd = rimRandom(0x6a09e667);
        for (let i = 0; i < s * s; i++) {
            const v = Math.floor(rnd() * 255);
            img.data[i * 4] = v;
            img.data[i * 4 + 1] = v;
            img.data[i * 4 + 2] = v;
            img.data[i * 4 + 3] = rnd() < 0.5 ? Math.floor(rnd() * 120) : 0;
        }
        ctx.putImageData(img, 0, 0);
    });
}

// --- the layer ----------------------------------------------------------------------------------------------------

/** What mainView hands the layer. */
export interface RimMountTargets {
    world: Container;
    fx: Container;
    /** World child index just above the backdrop + nebula images (wash, derelicts, silhouettes go there). */
    backgroundIndex: number;
    starfieldFar: TilingSprite;
    starfieldNear: TilingSprite;
    /** Screen-space index in fx just above the starfield (vignette + grain). */
    fxIndex: number;
    nebulae: readonly { sprite: Sprite; x: number; y: number }[];
    mapIcons: readonly { sprite: Sprite; x: number; y: number }[];
}

const MURK_REFRESH_FRAMES = 90;

export class RimAtmosphereLayer {
    readonly params: RimParams | null;
    readonly geo: RimGeometry | null;
    private mounted = false;
    private wash: Sprite | null = null;
    private background = new Container();
    private derelictRoot = new Container();
    private silhouetteRoot = new Container();
    private murkRoot = new Container();
    private derelictPool = new SpritePool(this.derelictRoot);
    private silhouettePool = new SpritePool(this.silhouetteRoot);
    private murkPool = new SpritePool(this.murkRoot);
    private vignette: Sprite | null = null;
    private grain: TilingSprite | null = null;
    private starfieldFar: TilingSprite | null = null;
    private starfieldNear: TilingSprite | null = null;
    private murkTexture: Texture | null = null;
    private derelicts: Derelict[] = [];
    private derelictTex = new Map<string, Texture | null>();
    private silhouettes: Silhouette[] = [];
    private creatureFrames: FrameSet[] = [];
    private murk: MurkPatch[] = [];
    private murkFrame = MURK_REFRESH_FRAMES;
    private murkSize = 0;
    private screenKey = new DrawKey();
    private tintKey = new DrawKey();
    private frame = 0;

    constructor(
        private galaxy: Galaxy,
        private store: AssetStore,
    ) {
        this.params = rimParams(galaxy);
        if (this.params === null) {
            this.geo = null;
            return;
        }
        const stars: { xpos: number; ypos: number }[] = [];
        for (const s of galaxy.systems) if (s.systemStar) stars.push(s.systemStar);
        this.geo = rimGeometry(galaxy.sizeX, galaxy.sizeY, stars);
    }

    /** True when the scenario flag is on (the layer draws); false = inert. */
    get active(): boolean {
        return this.params !== null;
    }

    /** Rim weight at a world point (0 when inactive). */
    weightAt(x: number, y: number): number {
        if (this.params === null || this.geo === null) return 0;
        return rimWeight(rimFraction(this.geo, x, y), this.params.rimInner);
    }

    /** Item 7 hook for AmbientLayer (nav lights / shield glow alpha multiplier); null when inactive or no dimming. */
    get lightScale(): ((x: number, y: number) => number) | null {
        const p = this.params;
        if (p === null || p.lightDimming <= 0) return null;
        return (x, y) => rimLightScale(this.weightAt(x, y), p.lightDimming);
    }

    /** Build the display objects. No-op (nothing added, nothing tinted) when the flag is off. */
    mount(t: RimMountTargets): void {
        const p = this.params;
        const geo = this.geo;
        if (p === null || geo === null || this.mounted) return;
        this.mounted = true;

        // (1) wash over backdrop + nebulae.
        const half = Math.max(this.galaxy.sizeX, this.galaxy.sizeY) / 2;
        if (p.tintStrength > 0) {
            this.wash = new Sprite(makeWashTexture(geo, p, half));
            this.wash.anchor.set(0.5);
            this.wash.position.set(geo.cx, geo.cy);
            this.wash.scale.set((half * 2) / this.wash.texture.width);
            this.background.addChild(this.wash);
        }
        this.background.addChild(this.silhouetteRoot, this.derelictRoot);
        t.world.addChildAt(this.background, Math.min(t.backgroundIndex, t.world.children.length));
        // Murk above the systems (added before the empire / ship layers, so those stay on top).
        t.world.addChild(this.murkRoot);

        // (1) + (3) nebulae: cold, then dust lanes deep in the rim; map-star icons: cold.
        for (const n of t.nebulae) {
            const w = this.weightAt(n.x, n.y);
            if (w > 0) n.sprite.tint = rimNebulaTint(w, p.tintStrength);
        }
        for (const m of t.mapIcons) {
            const w = this.weightAt(m.x, m.y);
            if (w > 0) m.sprite.tint = rimTint(w, p.tintStrength * 0.8);
        }
        this.starfieldFar = t.starfieldFar;
        this.starfieldNear = t.starfieldNear;

        // (13) vignette + grain, screen-space.
        this.vignette = new Sprite(makeVignetteTexture());
        this.vignette.visible = false;
        this.grain = new TilingSprite(makeGrainTexture());
        this.grain.visible = false;
        const fxIdx = Math.min(t.fxIndex, t.fx.children.length);
        t.fx.addChildAt(this.grain, fxIdx);
        t.fx.addChildAt(this.vignette, fxIdx);

        // (3) murk texture; (5) derelicts; (6) silhouettes.
        if (p.murkStrength > 0) this.murkTexture = makeMurkTexture();
        this.murkSize = geo.radius * 0.11;
        const seed = (this.galaxy.randomSeed | 0) ^ 0x19a7;
        const rimStars: { xpos: number; ypos: number }[] = [];
        for (const s of this.galaxy.systems) {
            if (s.systemStar && this.weightAt(s.systemStar.xpos, s.systemStar.ypos) > 0.5) rimStars.push(s.systemStar);
        }
        this.derelicts = scatterDerelicts(geo, p.rimInner, Math.round(BASE_DERELICTS * Math.min(4, p.derelictDensity)), rimStars, seed);
        this.silhouettes = silhouetteOrbits(p.rimInner, Math.min(24, Math.round(BASE_SILHOUETTES * p.silhouetteDensity)), seed);
        if (this.store.dwuPresent) {
            this.creatureFrames = CREATURES.map(
                (c) => new FrameSet(this.store, Array.from({ length: CREATURE_FRAMES }, (_, i) => `${IMG}/units/creatures/${c.dir}/${c.prefix}_${String(i).padStart(5, '0')}.png`)),
            );
        }
    }

    private derelictTexture(url: string): Texture | null {
        const t = this.derelictTex.get(url);
        if (t !== undefined) return t;
        this.derelictTex.set(url, null);
        if (this.store.dwuPresent) {
            this.store.loadFirst([url], () => Texture.EMPTY).then(
                (tex) => this.derelictTex.set(url, tex === Texture.EMPTY ? null : tex),
                () => undefined,
            );
        }
        return null;
    }

    /**
     * Per frame, after mainView has set the starfield / backdrop alphas. `m` = the camera's min zoom (whole galaxy),
     * `galaxyA` = the backdrop alpha (1 at galaxy zoom, 0 by system zoom).
     */
    update(z: number, cam: Camera, galaxyA: number): void {
        const p = this.params;
        const geo = this.geo;
        if (p === null || geo === null || !this.mounted) return;
        this.frame++;
        const tSec = Date.now() / 1000;
        const camW = this.weightAt(cam.x, cam.y);

        if (this.wash !== null) {
            this.wash.alpha = galaxyA;
            this.wash.visible = galaxyA > 0.01;
        }

        // (1) + (4) starfield tint / thinning by camera position.
        if (this.starfieldFar !== null && this.starfieldNear !== null && camW > 0) {
            const th = deepFieldThinning(camW, p.tintStrength);
            this.starfieldFar.alpha *= th.far;
            this.starfieldNear.alpha *= th.near;
        }
        if (this.starfieldFar !== null && this.starfieldNear !== null && this.tintKey.changed(Math.round(camW * 64))) {
            const tint = rimTint(Math.round(camW * 64) / 64, p.tintStrength);
            this.starfieldFar.tint = tint;
            this.starfieldNear.tint = tint;
        }

        // (13) vignette + grain.
        if (this.vignette !== null && this.grain !== null) {
            const vA = camW * p.tintStrength;
            const gA = camW * p.murkStrength * 0.12;
            this.vignette.visible = vA > 0.01;
            this.grain.visible = gA > 0.004;
            if (this.screenKey.changed(cam.width, cam.height)) {
                this.vignette.width = cam.width;
                this.vignette.height = cam.height;
                this.grain.width = cam.width;
                this.grain.height = cam.height;
            }
            this.vignette.alpha = Math.min(1, vA * 1.2);
            if (this.grain.visible) {
                this.grain.alpha = gA;
                // Grain flicker: jump the tile offset every other frame.
                if ((this.frame & 1) === 0) this.grain.tilePosition.set(Math.floor(Math.random() * 256), Math.floor(Math.random() * 256));
            }
        }

        // (3) murk over unexplored rim systems (explored state only grows; refreshed every 90 frames).
        this.murkPool.begin();
        if (this.murkTexture !== null) {
            if (++this.murkFrame >= MURK_REFRESH_FRAMES) {
                this.murkFrame = 0;
                const vis = this.galaxy.playerEmpire?.visibility ?? null;
                murkPatches(this.galaxy.systems, geo, p.rimInner, vis === null ? null : (i) => vis.checkSystemExplored(i), this.murk);
            }
            const size = this.murkSize;
            for (let i = 0; i < this.murk.length; i++) {
                const m = this.murk[i];
                if (!boundsOnScreen(m.x, m.y, size * 0.6, 0, cam.x, cam.y, cam.width, cam.height, z)) continue;
                const s = this.murkPool.acquire(this.murkTexture);
                s.position.set(m.x, m.y);
                s.scale.set(size / this.murkTexture.width);
                s.rotation = (i * 2.399 + tSec * 0.004) % (Math.PI * 2);
                s.alpha = m.w * p.murkStrength * 0.6;
            }
        }
        this.murkPool.end();

        // (5) derelicts: drawn once they are >= 2 px on screen.
        this.derelictPool.begin();
        for (const d of this.derelicts) {
            if (d.size * z < 2) continue;
            if (!boundsOnScreen(d.x, d.y, d.size, 0, cam.x, cam.y, cam.width, cam.height, z)) continue;
            const tex = this.derelictTexture(d.url);
            if (tex === null) continue;
            const s = this.derelictPool.acquire(tex);
            s.position.set(d.x, d.y);
            s.scale.set(d.size / Math.max(tex.width, tex.height));
            s.rotation = d.rot0 + tSec * d.spin;
            s.tint = RIM_DERELICT;
            s.alpha = 0.85;
        }
        this.derelictPool.end();

        // (6) silhouettes at galaxy zoom.
        this.silhouettePool.begin();
        const silA = galaxyA * Math.min(1, 0.35 + 0.3 * p.silhouetteDensity);
        if (silA > 0.01 && this.creatureFrames.length > 0) {
            for (const sh of this.silhouettes) {
                const a = sh.angle0 + tSec * sh.omega;
                const r = sh.orbit * geo.radius;
                const x = geo.cx + Math.cos(a) * r;
                const y = geo.cy + Math.sin(a) * r;
                const size = sh.size * geo.radius;
                if (!boundsOnScreen(x, y, size, 0, cam.x, cam.y, cam.width, cam.height, z)) continue;
                const frames = this.creatureFrames[sh.creature];
                const tex = frames.frame(Math.floor(sh.phase + tSec * 3) % CREATURE_FRAMES);
                if (tex === null) continue;
                const s = this.silhouettePool.acquire(tex);
                s.position.set(x, y);
                s.scale.set(size / Math.max(tex.width, tex.height));
                // Heading along the orbit tangent (a ± π/2); art facing up needs rotation = heading + π/2.
                s.rotation = a + (sh.omega > 0 ? Math.PI : 0);
                s.tint = RIM_SILHOUETTE;
                s.alpha = silA;
            }
        }
        this.silhouettePool.end();
    }
}
