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
//   (3) procedural dust (rimDust.ts): domain-warped multi-octave noise rendered once into a few 1024² mip-mapped
//       textures — tangential lanes + cross wisps along the rim band, drawn with blendMode 'multiply' (they can only
//       darken / cool what is behind them: the backdrop, nebulae and the deep field, which moves into the world under
//       them), a faint additive cold rim light on some core-facing filament edges, and a world-anchored cell grid of
//       finer detail levels that take over as the zoom closes in (so nothing is magnified past ~2.5 px per texel).
//       Murk over every unexplored rim system (the player's EmpireVisibility.checkSystemExplored — the same test the
//       Potential Colonies overlay uses) uses the same material, tinted very dark and cold (normal blend: it darkens
//       the backdrop, over black space it is a barely-there haze): system-sized patches at galaxy zoom; low,
//       screen-edge-weighted cells clear of the star at sector / system zoom. The dust coverage also thickens the cold
//       wash, the murk and the starfield grading, so the three read as one atmosphere;
//   (4) thinner deep field — the parallax starfield's alpha drops with rim depth;
//   (5) decorative derelicts — a deterministic scatter of dead stations / hulks (original ship art, dark-tinted, slowly
//       tumbling) in deep rim space and near rim systems; not selectable (the sim version belongs to 19h / 19j);
//   (6) eyes in the dark — small pairs of dim red dots, procedural (no art), sprinkled in the outer, empty parts of
//       rim systems (away from the star / planets / stations), system zoom only; each pair blinks on its own
//       irregular period with a soft glow and occasionally drifts a little between blinks;
//   (7) nav lights / planetary-shield glow dimmed on the rim (AmbientLayer.lightScale hook);
//   (13) vignette + film grain on the main view while the camera is deep in the rim.
// Exported for the data/wiring package (minimap outer-band dimming, music/ambient weights): rimGeometry, rimFraction,
// rimWeight, rimParams.

import { Container, Sprite, Texture, TilingSprite } from 'pixi.js';
import type { Camera } from './camera';
import type { AssetStore } from './assets';
import { boundsOnScreen, DrawKey } from './drawCache';
import { useMinifyingFilter } from './assets';
import {
    buildDustTexture,
    detailCell,
    DUST_DETAIL_LEVELS,
    DUST_SAMPLE_SIZE,
    DUST_TEX_SIZE,
    DUST_VARIANTS,
    dustCoverageAt,
    dustFields,
    laneLod,
    lodWindow,
    placeDustLanes,
    rimRandom,
    type DustSprite,
} from './rimDust';
import { SpritePool } from './fxCommon';
import { BUILT_OBJECT_MAX_FACTOR } from './builtObjectLayer';
import type { Galaxy } from '../sim/galaxy';
import { HabitatCategoryType, type SystemInfo } from '../sim/types';
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
    /** Eyes in the dark: multiplier on the base pair count (3–8 per rim system, scaled by rim weight; 0 = none). */
    eyeDensity: number;
    /** Derelicts: multiplier on the base count (80; 0 = none). */
    derelictDensity: number;
    /** How much nav lights / shield glow dim at full rim depth, 0..1. */
    lightDimming: number;
    /** Procedural dust lanes opacity 0..1 (0 = no dust; the starfield then stays where the base game draws it). */
    dustStrength: number;
    /** Close-up dust detail (the finer cell levels at sector / system zoom) 0..1. */
    dustDetail: number;
}

export const RIM_DEFAULTS: RimParams = {
    rimInner: 0.72,
    tintStrength: 0.6,
    murkStrength: 0.7,
    eyeDensity: 1,
    derelictDensity: 1,
    lightDimming: 0.6,
    dustStrength: 0.75,
    dustDetail: 1,
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
        eyeDensity: Math.max(0, scenarioParam(galaxy, 'eyeDensity', RIM_DEFAULTS.eyeDensity)),
        derelictDensity: Math.max(0, scenarioParam(galaxy, 'derelictDensity', RIM_DEFAULTS.derelictDensity)),
        lightDimming: clamp01(scenarioParam(galaxy, 'lightDimming', RIM_DEFAULTS.lightDimming)),
        dustStrength: clamp01(scenarioParam(galaxy, 'dustStrength', RIM_DEFAULTS.dustStrength)),
        dustDetail: clamp01(scenarioParam(galaxy, 'dustDetail', RIM_DEFAULTS.dustDetail)),
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
/** Derelict tint. */
export const RIM_DERELICT = 0x6a625c;

/** Multiply tint for a sprite at rim weight `w`: white inside, towards RIM_COLD at full depth × strength. */
export function rimTint(w: number, strength: number): number {
    return lerpColour(0xffffff, RIM_COLD, w * strength);
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

export { rimRandom };

const IMG = '/assets/dwu/images';
const DERELICT_KINDS = ['genericbase', 'smallspaceport', 'mediumspaceport', 'miningstation', 'resortbase', 'gasminingstation', 'colonyship', 'cruiser', 'largefreighter'];
const SHIP_FAMILIES = 27;
const BASE_DERELICTS = 80;

export interface Derelict {
    x: number;
    y: number;
    size: number;
    rot0: number;
    spin: number;
    url: string;
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

// --- eyes in the dark (item 6) -------------------------------------------------------------------------------

// Blink shape: irregular per-pair period and a short on-time, like nav lights (LIGHT_ON_SECONDS / LIGHT_OFF_SECONDS
// in ambientLayer.ts) but softer — the on-window ramps up and back down instead of the nav light's hard on/off.
export const EYE_MIN_PERIOD_S = 2;
export const EYE_MAX_PERIOD_S = 6;
const EYE_ON_FRACTION_MIN = 0.12;
const EYE_ON_FRACTION_MAX = 0.28;
// "occasionally a pair moves a little between blinks": recomputed fresh each cycle (never drifts further away).
const EYE_MOVE_CHANCE = 0.3;
const EYE_MOVE_MIN = 250;
const EYE_MOVE_MAX = 1400;
// Placement: past the outermost planet/moon orbit (never on top of the star, a planet or a station orbiting one),
// the same clearance-then-band shape scatterDerelicts uses for its near-rim-star half.
const EYE_CLEARANCE = 3000;
const EYE_BAND = 12000;
const EYE_SIZE = 1100; // world units; ~2-3 px on screen at the zoom eyeZoomFade first opens (see below)
const EYE_BASE_COUNT_MIN = 3;
const EYE_BASE_COUNT_SPAN = 6; // base count is EYE_BASE_COUNT_MIN..EYE_BASE_COUNT_MIN+EYE_BASE_COUNT_SPAN-1 (3..8)
/** Dim glow cap: eyes never reach full nav-light brightness even mid-blink. */
export const EYE_MAX_ALPHA = 0.55;

export interface EyePair {
    x: number;
    y: number;
    /** Orientation of the two-dot pair (world radians). */
    angle: number;
    /** World units between the two dots. */
    gap: number;
    /** Each dot's world diameter. */
    size: number;
    /** Blink period, seconds (EYE_MIN_PERIOD_S..EYE_MAX_PERIOD_S). */
    period: number;
    /** Fraction of `period` the pair is lit (short — EYE_ON_FRACTION_MIN..MAX). */
    onFraction: number;
    /** Seconds offset into the cycle, so pairs do not all blink in lockstep. */
    phase: number;
    /** Max world-unit distance the pair can drift between blink cycles. */
    moveRadius: number;
    /** Seed for the per-cycle move jitter (eyeMoveOffset). */
    seed: number;
}

/** One rim system's placement inputs (plain data: no Galaxy/SystemInfo dependency, so this is unit-testable
 * without building a galaxy). `seed` must already be per-system (e.g. mixed with the system index). */
export interface RimSystemInput {
    seed: number;
    starX: number;
    starY: number;
    /** Farthest planet/moon orbit distance from the star (0 for a starless / planetless system). */
    maxOrbit: number;
    /** Rim weight at the star (0 = core system: no eyes). */
    weight: number;
}

/** Item 6 pair count: 3–8 (density 1) scaled by density and by the system's rim weight; 0 below either. */
export function eyeCountForSystem(seed: number, density: number, weight: number): number {
    if (density <= 0 || weight <= 0) return 0;
    const rnd = rimRandom(seed ^ 0x1eee5eed);
    const base = EYE_BASE_COUNT_MIN + Math.floor(rnd() * EYE_BASE_COUNT_SPAN);
    return Math.max(0, Math.round(base * density * weight));
}

/**
 * `count` eye pairs for one system: positions past the outermost habitat orbit (EYE_CLEARANCE..+EYE_BAND beyond
 * it), so they never land on the star, a planet/moon or a station orbiting one. Deterministic in `seed`.
 */
export function eyePairsForSystem(starX: number, starY: number, maxOrbit: number, count: number, seed: number): EyePair[] {
    const rnd = rimRandom(seed ^ 0xe7e5e7e5);
    const lo = Math.max(0, maxOrbit) + EYE_CLEARANCE;
    const out: EyePair[] = [];
    for (let i = 0; i < count; i++) {
        const a = rnd() * Math.PI * 2;
        const d = lo + rnd() * EYE_BAND;
        const size = EYE_SIZE * (0.75 + rnd() * 0.5);
        out.push({
            x: starX + Math.cos(a) * d,
            y: starY + Math.sin(a) * d,
            angle: rnd() * Math.PI * 2,
            gap: size * (0.8 + rnd() * 0.6),
            size,
            period: EYE_MIN_PERIOD_S + rnd() * (EYE_MAX_PERIOD_S - EYE_MIN_PERIOD_S),
            onFraction: EYE_ON_FRACTION_MIN + rnd() * (EYE_ON_FRACTION_MAX - EYE_ON_FRACTION_MIN),
            phase: rnd() * (EYE_MAX_PERIOD_S * 2),
            moveRadius: EYE_MOVE_MIN + rnd() * (EYE_MOVE_MAX - EYE_MOVE_MIN),
            seed: (rnd() * 0xffffffff) >>> 0,
        });
    }
    return out;
}

/** Every rim system's eye pairs (density 0 or a core system's weight 0 contribute none). Reuses `out` like
 * murkPatches. */
export function scatterEyes(systems: readonly RimSystemInput[], density: number, out: EyePair[] = []): EyePair[] {
    out.length = 0;
    if (density <= 0) return out;
    for (const s of systems) {
        const n = eyeCountForSystem(s.seed, density, s.weight);
        if (n <= 0) continue;
        for (const pair of eyePairsForSystem(s.starX, s.starY, s.maxOrbit, n, s.seed)) out.push(pair);
    }
    return out;
}

/**
 * Blink alpha at time `tSec` (pure; seconds, any origin): 0 outside the short on-window, a smoothstep ramp up then
 * back down within it (softer than the nav lights' hard on/off — item 6 asks for a "soft glow").
 */
export function eyeBlinkAlpha(tSec: number, period: number, onFraction: number, phase: number): number {
    if (period <= 0) return 0;
    const cyclePos = (((tSec + phase) % period) + period) % period;
    const onLen = Math.max(0.05, period * clamp01(onFraction));
    if (cyclePos >= onLen) return 0;
    const t = cyclePos / onLen;
    const ramp = t < 0.5 ? t * 2 : (1 - t) * 2;
    return ramp * ramp * (3 - 2 * ramp);
}

/** Which blink cycle `tSec` falls in (for the per-cycle move jitter). */
export function eyeCycleIndex(tSec: number, period: number, phase: number): number {
    if (period <= 0) return 0;
    return Math.floor((tSec + phase) / period);
}

/** "Occasionally a pair moves a little between blinks": a small, deterministic offset recomputed fresh each cycle
 * (most cycles: none), so the pair never drifts away — it just occasionally resettles nearby. */
export function eyeMoveOffset(seed: number, cycleIndex: number, moveRadius: number): { dx: number; dy: number } {
    const rnd = rimRandom((seed ^ Math.imul(cycleIndex + 1, 0x27d4eb2f)) >>> 0);
    if (rnd() > EYE_MOVE_CHANCE) return { dx: 0, dy: 0 };
    const a = rnd() * Math.PI * 2;
    const d = rnd() * moveRadius;
    return { dx: Math.cos(a) * d, dy: Math.sin(a) * d };
}

/**
 * Item 6 zoom gate: crossfades in over the same system-zoom threshold ambientLayer.ambientVisibleAt uses to turn
 * nav lights on (f = 1/z < BUILT_OBJECT_MAX_FACTOR, i.e. z > 1/BUILT_OBJECT_MAX_FACTOR) — nav lights themselves pop
 * at that threshold (a hard visible toggle), but item 6 asks for no pop, so this eases in over a band past it
 * instead of switching at it, the same smoothstep shape rimWeight uses for the rim-band crossfade.
 */
export function eyeZoomFade(z: number): number {
    const a = 1 / BUILT_OBJECT_MAX_FACTOR;
    const b = a * 2.5;
    if (z <= a) return 0;
    if (z >= b) return 1;
    const t = (z - a) / (b - a);
    return t * t * (3 - 2 * t);
}

/** Farthest planet/moon orbit distance from the star (0 for none): the eyes' inner clearance boundary. Moons orbit
 * their planet, so their distance from the star is the planet's orbit plus the moon's. */
export function systemMaxExtent(system: SystemInfo): number {
    let maxExtent = 0;
    for (const h of system.habitats) {
        if (h === system.systemStar) continue;
        if (h.category === HabitatCategoryType.Moon && h.parent) {
            maxExtent = Math.max(maxExtent, h.parent.orbitDistance + h.orbitDistance);
        } else {
            maxExtent = Math.max(maxExtent, h.orbitDistance);
        }
    }
    return maxExtent;
}

/** Per-system seed, mixed from the shared rim-layer seed and the system index (never galaxy.rnd). */
export function eyeSystemSeed(seed: number, systemIndex: number): number {
    return (seed ^ Math.imul(systemIndex + 1, 0x2545f491)) >>> 0;
}

// --- procedural textures (canvas; generated once, only when the flag is on) ------------------------------------

function canvasTexture(size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void): Texture {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    draw(canvas.getContext('2d')!, size);
    return Texture.from(canvas);
}

/** A straight-alpha RGBA buffer as a mip-mapped, linearly filtered canvas texture. */
function rgbaTexture(rgba: Uint8ClampedArray, size: number): Texture {
    const tex = canvasTexture(size, (ctx) => {
        const img = ctx.createImageData(size, size);
        img.data.set(rgba);
        ctx.putImageData(img, 0, 0);
    });
    useMinifyingFilter(tex);
    return tex;
}

/** Wash alpha by rim fraction (the old radial gradient's stops, evaluated analytically). */
function washAlpha(f: number, p: RimParams): number {
    const inner = p.rimInner;
    const mid = inner + rimBand(inner);
    const edge = Math.max(mid + 0.001, 1.05);
    const k = p.tintStrength;
    if (f <= inner) return 0;
    if (f <= mid) return ((f - inner) / (mid - inner)) * 0.5 * k;
    if (f <= edge) return (0.5 + ((f - mid) / (edge - mid)) * 0.3) * k;
    return Math.min(0.85, 0.8 + (f - edge) * 0.2) * k;
}

/**
 * Radial cold wash over the backdrop + nebulae, now modulated by the dust coverage (item 4): thinner between the
 * lanes, thicker along them, so the grading and the lanes read as one atmosphere. `half` = sprite half side.
 */
function makeWashTexture(geo: RimGeometry, p: RimParams, half: number, cov: ((x: number, y: number) => number) | null): Texture {
    const S = 128;
    return canvasTexture(S, (ctx) => {
        const img = ctx.createImageData(S, S);
        for (let y = 0; y < S; y++) {
            const wy = geo.cy + ((y + 0.5) / S - 0.5) * 2 * half;
            for (let x = 0; x < S; x++) {
                const wx = geo.cx + ((x + 0.5) / S - 0.5) * 2 * half;
                const f = rimFraction(geo, wx, wy);
                let a = washAlpha(f, p);
                if (a <= 0) continue;
                if (cov !== null) a = Math.min(0.92, a * (0.55 + 0.9 * cov(wx, wy)));
                const t = clamp01((f - p.rimInner) / Math.max(0.01, 1.05 - p.rimInner));
                const i = (y * S + x) * 4;
                img.data[i] = 22 - 10 * t;
                img.data[i + 1] = 24 - 11 * t;
                img.data[i + 2] = 46 - 18 * t;
                img.data[i + 3] = a * 255;
            }
        }
        ctx.putImageData(img, 0, 0);
    });
}

/** Item 6 eye dot: a small soft red glow (white-hot centre, dim red halo, transparent edge) — no art, just a radial
 * gradient, tinted per-draw by alpha (blink) rather than colour. */
function makeEyeTexture(): Texture {
    return canvasTexture(64, (ctx, s) => {
        const c = s / 2;
        const g = ctx.createRadialGradient(c, c, 0, c, c, c);
        g.addColorStop(0, 'rgba(255,235,225,1)');
        g.addColorStop(0.3, 'rgba(255,60,40,0.9)');
        g.addColorStop(0.65, 'rgba(160,10,10,0.35)');
        g.addColorStop(1, 'rgba(120,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, s, s);
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

// --- dust + murk tuning (item 3 art pass) ---------------------------------------------------------------------

/** Dust pans at this fraction of the camera pan (relative to the galaxy centre): just behind the map stars. */
export const DUST_PARALLAX = 0.97;
/** Peak lane opacity at dustStrength 1 (multiply: the most a lane core can take away). */
export const DUST_LANE_ALPHA = 0.85;
/** Peak detail-cell opacity at dustStrength 1 × dustDetail 1, times √(lane coverage under the cell): close in, the
 * deep field is all the dust has to occlude, so the lanes need their full strength there. */
export const DUST_DETAIL_ALPHA = 0.9;
/** Rim light (additive, cold) on the core-facing filament edges of some lanes: kept very faint. */
export const DUST_RIM_ALPHA = 0.07;
/** Murk (the detail material, normal blend, tinted very dark and cold — over a bright backdrop it darkens, over
 * black space it is a barely-there haze): galaxy-zoom patches / close-zoom cells, at murkStrength 1. */
export const MURK_FAR_ALPHA = 0.5;
export const MURK_NEAR_ALPHA = 0.8;
export const MURK_TINT = 0x4a5066;
/** Close-zoom murk stays off each unexplored star: 0 inside CLEAR0, full from CLEAR1 (world units). */
const MURK_CLEAR0 = 35_000;
const MURK_CLEAR1 = 90_000;
/** Lane / wisp counts around the ring. */
const DUST_LANES = 36;
const DUST_WISPS = 16;
const CELL_CACHE_MAX = 20_000;
/** Dust / murk sprites are refreshed when the camera has panned this many screen pixels (or zoomed). */
const PAN_QUANTUM_PX = 12;

function smooth(a: number, b: number, v: number): number {
    const t = clamp01((v - a) / (b - a));
    return t * t * (3 - 2 * t);
}

/** Close-zoom factor: 0 at galaxy zoom, 1 from sector zoom in (m = the whole-galaxy zoom). */
export function murkCloseness(z: number, m: number): number {
    return smooth(m * 3, m * 12, z);
}

/** Screen-edge weight for close-zoom murk: low in the middle of the screen (where the player looks), full at the
 * edges. `rn` = distance from the screen centre / half the screen diagonal. */
export function murkVignette(rn: number): number {
    return 0.12 + 0.88 * smooth(0.2, 0.95, rn);
}

/** Close-zoom murk density at distance `d` from an unexplored rim star of weight `w`, `r` = the murk radius. */
export function murkDensity(d: number, w: number, r: number): number {
    return w * (1 - smooth(0.3, 1, d / r)) * smooth(MURK_CLEAR0, MURK_CLEAR1, d);
}

interface DustCell {
    s: DustSprite;
    /** Lane coverage (dust) or murk density (murk) under the cell's centre. */
    v: number;
}

function cellKey(level: number, ix: number, iy: number): number {
    return (level * 1048576 + (ix + 524288)) * 1048576 + (iy + 524288);
}

// --- the layer ----------------------------------------------------------------------------------------------------

/** What mainView hands the layer. */
export interface RimMountTargets {
    world: Container;
    fx: Container;
    /** World child index just above the backdrop + nebula images (wash, dust, derelicts, eyes go there). */
    backgroundIndex: number;
    starfieldFar: Container;
    starfieldNear: Container;
    /** Screen-space index in fx just above the starfield (vignette + grain). */
    fxIndex: number;
    nebulae: readonly { sprite: Sprite; x: number; y: number }[];
    mapIcons: readonly { sprite: Sprite; x: number; y: number }[];
}

const MURK_REFRESH_FRAMES = 90;

/** Set a sprite's transform to a dust sprite's placement (texture x along `rotation`, mirrored when `flip`). */
function placeDust(spr: Sprite, s: DustSprite, tex: Texture): void {
    spr.anchor.set(0.5);
    spr.position.set(s.x, s.y);
    spr.rotation = s.rotation;
    spr.scale.set(((s.flip ? -1 : 1) * s.length) / tex.width, s.width / tex.height);
}

/**
 * Sprites bound to detail cells: a cell that stays on screen keeps its sprite untouched (no transform churn while
 * panning); cells leaving the screen hand theirs back to a free list.
 */
class CellSprites {
    private live = new Map<number, Sprite>();
    private next = new Map<number, Sprite>();
    private free: Sprite[] = [];

    constructor(
        private parent: Container,
        private blend: 'multiply' | 'normal',
        private tint = 0xffffff,
    ) {}

    begin(): void {
        this.next.clear();
    }

    use(key: number, s: DustSprite, tex: Texture): Sprite {
        let spr = this.live.get(key);
        if (spr !== undefined) {
            this.live.delete(key);
        } else {
            spr = this.free.pop();
            if (spr === undefined) {
                spr = new Sprite(tex);
                spr.blendMode = this.blend;
                spr.tint = this.tint;
                this.parent.addChild(spr);
            } else {
                spr.texture = tex;
                spr.visible = true;
            }
            placeDust(spr, s, tex);
        }
        this.next.set(key, spr);
        return spr;
    }

    end(): void {
        for (const spr of this.live.values()) {
            spr.visible = false;
            this.free.push(spr);
        }
        const t = this.live;
        this.live = this.next;
        this.next = t;
    }

    get count(): number {
        return this.live.size;
    }
}

export class RimAtmosphereLayer {
    readonly params: RimParams | null;
    readonly geo: RimGeometry | null;
    /** Milliseconds spent building the dust / murk textures and the dust-graded wash (once, on the first frame after
     * mount); 0 until then / when off. */
    dustGenMs = 0;
    /** Breakdown of dustGenMs: noise fields, variant buffers, canvas textures, graded wash. */
    dustGenBreakdown: Record<string, number> = {};
    private mounted = false;
    private world: Container | null = null;
    private wash: Sprite | null = null;
    private background = new Container();
    /** Screen-space container inside the world (inverse world transform) holding the parallax starfield, so the
     * dust (drawn after it) occludes the deep field while the systems still draw on top. */
    private deepField = new Container();
    private washRoot = new Container();
    private dustRoot = new Container();
    private laneRoot = new Container();
    private rimRoot = new Container();
    private detailRoot = new Container();
    private derelictRoot = new Container();
    private eyeRoot = new Container();
    private murkRoot = new Container();
    private murkCellRoot = new Container();
    private detailSprites = new CellSprites(this.detailRoot, 'multiply');
    private murkCellSprites = new CellSprites(this.murkCellRoot, 'normal', MURK_TINT);
    private derelictPool = new SpritePool(this.derelictRoot);
    private eyePool = new SpritePool(this.eyeRoot);
    private vignette: Sprite | null = null;
    private grain: TilingSprite | null = null;
    private starfieldFar: Container | null = null;
    private starfieldNear: Container | null = null;
    private mapIcons: readonly { sprite: Sprite; x: number; y: number }[] = [];
    /** Per DUST_VARIANTS index: texture, rim-light texture (or null), CPU coverage grid. */
    private dustTex: (Texture | null)[] = [];
    private dustRimTex: (Texture | null)[] = [];
    private dustSamples: Float32Array[] = [];
    private dustReady = false;
    /** Variants to generate on the first update() (not mid-load in mount(), where the start-up GC churn made the
     * same work ~30% slower); null once done. */
    private pendingVariants: number[] | null = null;
    /** Lane / wisp placements (dustAt only reads them once the samples are in). */
    private lanes: DustSprite[] = [];
    private laneSprites: Sprite[] = [];
    private laneRimSprites: (Sprite | null)[] = [];
    private dustCells = new Map<number, DustCell>();
    private murkCells = new Map<number, DustCell>();
    private murkTexture: Texture | null = null;
    private murkSprites: Sprite[] = [];
    private derelicts: Derelict[] = [];
    private derelictTex = new Map<string, Texture | null>();
    private eyes: EyePair[] = [];
    private eyeTexture: Texture | null = null;
    private murk: MurkPatch[] = [];
    private murkCov: number[] = [];
    /** Spatial hash of murk patch indices (bucket = murkRadius). */
    private murkGrid = new Map<number, number[]>();
    private murkFrame = MURK_REFRESH_FRAMES;
    private murkSize = 0;
    private murkRadius = 0;
    private seed = 0;
    private camCov = 0;
    private screenKey = new DrawKey();
    private tintKey = new DrawKey();
    private camKey = new DrawKey();
    /** Last detail cell ranges (x0, x1, y0, y1 per level) and zoom. */
    private detailRanges = new Float64Array(DUST_DETAIL_LEVELS.length * 4);
    private detailZ = NaN;
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

    /** Dust-lane coverage (0..1) at a world point, in the dust's own (parallax) space; 0 when inactive, without
     * dust, or before the textures are ready. */
    dustAt(x: number, y: number): number {
        if (!this.dustReady || this.lanes.length === 0) return 0;
        return dustCoverageAt(this.lanes, this.dustSamples, x, y);
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
        this.world = t.world;
        this.seed = ((this.galaxy.randomSeed | 0) ^ 0x19a7) >>> 0;
        const wantDust = p.dustStrength > 0;

        this.dustRoot.addChild(this.laneRoot, this.detailRoot, this.rimRoot);
        this.background.addChild(this.washRoot, this.deepField, this.dustRoot, this.eyeRoot, this.derelictRoot);
        t.world.addChildAt(this.background, Math.min(t.backgroundIndex, t.world.children.length));
        // Murk above the systems (added before the empire / ship layers, so those stay on top).
        this.murkRoot.addChild(this.murkCellRoot);
        t.world.addChild(this.murkRoot);

        // (1) nebulae: cold (the dust, drawn above them, does the darkening). Map-star icons: cold, re-graded by
        // the dust once it is ready.
        for (const n of t.nebulae) {
            const w = this.weightAt(n.x, n.y);
            if (w > 0) n.sprite.tint = rimTint(w, p.tintStrength);
        }
        this.mapIcons = t.mapIcons;
        this.tintMapIcons(p);
        this.starfieldFar = t.starfieldFar;
        this.starfieldNear = t.starfieldNear;

        // (13) vignette + grain, screen-space, just above where the starfield was in fx.
        let fxIdx = Math.min(t.fxIndex, t.fx.children.length);
        if (wantDust) {
            // (3)/(4) the deep field moves under the dust: into the world, below the systems, in screen space.
            for (const sf of [t.starfieldFar, t.starfieldNear]) {
                const i = t.fx.children.indexOf(sf);
                if (i >= 0 && i < fxIdx) fxIdx--;
                this.deepField.addChild(sf);
            }
        }
        this.vignette = new Sprite(makeVignetteTexture());
        this.vignette.visible = false;
        this.grain = new TilingSprite(makeGrainTexture());
        this.grain.visible = false;
        t.fx.addChildAt(this.grain, fxIdx);
        t.fx.addChildAt(this.vignette, fxIdx);

        // (3) dust lanes / wisps (placement needs no texture) and the dust + murk textures (workers).
        this.murkSize = geo.radius * 0.11;
        this.murkRadius = this.murkSize * 0.6;
        if (wantDust) {
            const band = rimBand(p.rimInner);
            this.lanes = placeDustLanes({
                cx: geo.cx,
                cy: geo.cy,
                radius: geo.radius,
                lo: Math.min(1, p.rimInner + band * 0.3),
                hi: 1.08,
                lanes: DUST_LANES,
                wisps: DUST_WISPS,
                seed: this.seed,
            });
        }
        const variants: number[] = [];
        DUST_VARIANTS.forEach((spec, i) => {
            if (wantDust || (p.murkStrength > 0 && spec.kind === 'detail')) variants.push(i);
        });
        // Textures: generated on the first frame (see pendingVariants).
        this.pendingVariants = variants;

        // (5) derelicts; (6) eyes in the dark.
        const seed = (this.galaxy.randomSeed | 0) ^ 0x19a7;
        const rimStars: { xpos: number; ypos: number }[] = [];
        for (const s of this.galaxy.systems) {
            if (s.systemStar && this.weightAt(s.systemStar.xpos, s.systemStar.ypos) > 0.5) rimStars.push(s.systemStar);
        }
        this.derelicts = scatterDerelicts(geo, p.rimInner, Math.round(BASE_DERELICTS * Math.min(4, p.derelictDensity)), rimStars, seed);
        if (p.eyeDensity > 0) {
            this.eyeTexture = makeEyeTexture();
            const eyeInputs: RimSystemInput[] = [];
            for (const s of this.galaxy.systems) {
                const star = s.systemStar;
                if (!star) continue;
                const w = this.weightAt(star.xpos, star.ypos);
                if (w <= 0) continue;
                eyeInputs.push({
                    seed: eyeSystemSeed(seed, star.systemIndex),
                    starX: star.xpos,
                    starY: star.ypos,
                    maxOrbit: systemMaxExtent(s),
                    weight: w,
                });
            }
            this.eyes = scatterEyes(eyeInputs, p.eyeDensity);
        }
    }

    private tintMapIcons(p: RimParams): void {
        for (const m of this.mapIcons) {
            const w = this.weightAt(m.x, m.y);
            if (w > 0) m.sprite.tint = rimTint(w, Math.min(1, p.tintStrength * 0.8 * (1 + 0.4 * this.dustAt(m.x, m.y))));
        }
    }

    /** Build the variant buffers and their textures (once; synchronous, measured in dustGenMs). */
    private generateDust(variants: number[]): void {
        const t0 = performance.now();
        const bd = this.dustGenBreakdown;
        const fields = dustFields(this.seed);
        bd.fieldsMs = performance.now() - t0;
        bd.buffersMs = 0;
        bd.texturesMs = 0;
        for (const i of variants) {
            const tb = performance.now();
            const d = buildDustTexture(fields, DUST_VARIANTS[i], DUST_TEX_SIZE);
            const tt = performance.now();
            bd.buffersMs += tt - tb;
            this.dustTex[i] = rgbaTexture(d.rgba, d.size);
            this.dustRimTex[i] = d.rim !== null ? rgbaTexture(d.rim, d.rimSize) : null;
            this.dustSamples[i] = d.sample;
            bd.texturesMs += performance.now() - tt;
        }
        this.finishDust(t0);
    }

    /** Textures are in: lane sprites, murk material, the dust-graded wash and icon tints. */
    private finishDust(t0: number): void {
        const p = this.params;
        const geo = this.geo;
        if (p === null || geo === null) return;
        this.dustReady = true;
        const detailIdx = DUST_VARIANTS.findIndex((v) => v.kind === 'detail');
        this.murkTexture = p.murkStrength > 0 ? (this.dustTex[detailIdx] ?? null) : null;
        for (const s of this.lanes) {
            const tex = this.dustTex[s.variant] ?? null;
            if (tex === null) continue;
            const spr = new Sprite(tex);
            spr.blendMode = 'multiply';
            placeDust(spr, s, tex);
            spr.visible = false;
            this.laneRoot.addChild(spr);
            this.laneSprites.push(spr);
            const rimTex = this.dustRimTex[s.variant] ?? null;
            let rim: Sprite | null = null;
            if (rimTex !== null && p.tintStrength > 0) {
                rim = new Sprite(rimTex);
                rim.blendMode = 'add';
                placeDust(rim, s, rimTex);
                rim.visible = false;
                this.rimRoot.addChild(rim);
            }
            this.laneRimSprites.push(rim);
        }
        // (1) wash over backdrop + nebulae, graded by the dust (item 4).
        const tw = performance.now();
        if (p.tintStrength > 0) {
            const half = Math.max(this.galaxy.sizeX, this.galaxy.sizeY) / 2;
            const cov = this.lanes.length > 0 ? (x: number, y: number) => this.dustAt(x, y) : null;
            this.wash = new Sprite(makeWashTexture(geo, p, half, cov));
            this.wash.anchor.set(0.5);
            this.wash.position.set(geo.cx, geo.cy);
            this.wash.scale.set((half * 2) / this.wash.texture.width);
            this.wash.visible = false;
            this.washRoot.addChild(this.wash);
        }
        this.tintMapIcons(p);
        this.dustGenBreakdown.washMs = performance.now() - tw;
        this.dustGenMs = performance.now() - t0;
        // Redraw everything that reads the dust on the next frame.
        this.dustCells.clear();
        this.murkFrame = MURK_REFRESH_FRAMES;
        this.camKey.reset();
        this.detailZ = NaN;
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

    /** Detail cell (cached): the deterministic sprite + the lane coverage under it. */
    private dustCell(level: number, ix: number, iy: number): DustCell {
        const key = cellKey(level, ix, iy);
        let c = this.dustCells.get(key);
        if (c === undefined) {
            if (this.dustCells.size >= CELL_CACHE_MAX) this.dustCells.clear();
            const s = detailCell(level, ix, iy, this.seed, {} as DustSprite);
            c = { s, v: this.dustAt(s.x, s.y) };
            this.dustCells.set(key, c);
        }
        return c;
    }

    /** Close-zoom murk cell (cached until the next explored-state refresh): sprite + murk density under it. */
    private murkCell(level: number, ix: number, iy: number): DustCell {
        const key = cellKey(level, ix, iy);
        let c = this.murkCells.get(key);
        if (c === undefined) {
            if (this.murkCells.size >= CELL_CACHE_MAX) this.murkCells.clear();
            const s = detailCell(level, ix, iy, this.seed ^ 0x3c6ef372, {} as DustSprite);
            c = { s, v: this.murkDensityAt(s.x, s.y) };
            this.murkCells.set(key, c);
        }
        return c;
    }

    private murkDensityAt(x: number, y: number): number {
        const r = this.murkRadius;
        const bx = Math.floor(x / r);
        const by = Math.floor(y / r);
        let best = 0;
        for (let j = -1; j <= 1; j++) {
            for (let i = -1; i <= 1; i++) {
                const list = this.murkGrid.get((bx + i) * 65536 + (by + j));
                if (list === undefined) continue;
                for (const k of list) {
                    const m = this.murk[k];
                    const d = Math.hypot(x - m.x, y - m.y);
                    const v = murkDensity(d, m.w, r) * (0.75 + 0.5 * this.murkCov[k]);
                    if (v > best) best = v;
                }
            }
        }
        return best;
    }

    private refreshMurk(p: RimParams, geo: RimGeometry): void {
        const vis = this.galaxy.playerEmpire?.visibility ?? null;
        const prevLen = this.murk.length;
        const prevX = prevLen > 0 ? this.murk[prevLen - 1].x : NaN;
        murkPatches(this.galaxy.systems, geo, p.rimInner, vis === null ? null : (i) => vis.checkSystemExplored(i), this.murk);
        // Explored state only grows: an unchanged count (and last entry) means an unchanged list.
        const n = this.murk.length;
        if (n === prevLen && (n === 0 || this.murk[n - 1].x === prevX) && this.murkSprites.length === n && n > 0) return;
        this.murkCov.length = n;
        this.murkGrid.clear();
        const r = this.murkRadius;
        const tex = this.murkTexture;
        for (let i = 0; i < n; i++) {
            const m = this.murk[i];
            this.murkCov[i] = this.dustAt(m.x, m.y);
            const key = Math.floor(m.x / r) * 65536 + Math.floor(m.y / r);
            let list = this.murkGrid.get(key);
            if (list === undefined) this.murkGrid.set(key, (list = []));
            list.push(i);
            if (tex === null) continue;
            // Galaxy-zoom patch sprites: one per patch, placed once per list change.
            let spr = this.murkSprites[i];
            if (spr === undefined) {
                spr = new Sprite(tex);
                spr.tint = MURK_TINT;
                spr.anchor.set(0.5);
                this.murkRoot.addChildAt(spr, 0);
                this.murkSprites.push(spr);
            }
            spr.position.set(m.x, m.y);
            spr.scale.set(this.murkSize / tex.width);
            spr.rotation = (i * 2.399) % (Math.PI * 2);
            spr.visible = false;
        }
        for (let i = n; i < this.murkSprites.length; i++) this.murkSprites[i].visible = false;
        this.murkCells.clear();
    }

    /** Lanes, their rim light and the detail cells for the current camera (only when the camera moved). */
    private drawDust(p: RimParams, z: number, cam: Camera, camX: number, camY: number): void {
        const k = p.dustStrength;
        for (let i = 0; i < this.laneSprites.length; i++) {
            const s = this.lanes[i];
            const spr = this.laneSprites[i];
            const rim = this.laneRimSprites[i];
            const big = Math.max(s.length, s.width);
            const on = big * z >= 3 && boundsOnScreen(s.x, s.y, big * 0.71, PAN_QUANTUM_PX * 2, camX, camY, cam.width, cam.height, z);
            if (spr.visible !== on) spr.visible = on;
            if (rim !== null && rim.visible !== on) rim.visible = on;
            if (!on) continue;
            const lod = laneLod((s.length / DUST_TEX_SIZE) * z);
            spr.alpha = k * DUST_LANE_ALPHA * s.alpha * lod;
            if (rim !== null) rim.alpha = k * DUST_RIM_ALPHA * s.alpha * lod * p.tintStrength;
        }
        // Detail cells: the visible cell ranges (with a margin covering every sprite's extent) decide everything —
        // alphas depend on the zoom only — so a pan that stays inside the same ranges touches nothing.
        const R = this.detailRanges;
        let same = z === this.detailZ;
        for (let level = 0; level < DUST_DETAIL_LEVELS.length; level++) {
            const L = DUST_DETAIL_LEVELS[level];
            const on = p.dustDetail > 0 && lodWindow((L.size / DUST_TEX_SIZE) * z) >= 0.01;
            const hw = cam.width / 2 / z + L.size * 1.05 + L.cell * 0.4;
            const hh = cam.height / 2 / z + L.size * 1.05 + L.cell * 0.4;
            const x0 = on ? Math.floor((camX - hw) / L.cell) : 0;
            const x1 = on ? Math.floor((camX + hw) / L.cell) : -1;
            const y0 = on ? Math.floor((camY - hh) / L.cell) : 0;
            const y1 = on ? Math.floor((camY + hh) / L.cell) : -1;
            const o = level * 4;
            if (R[o] !== x0 || R[o + 1] !== x1 || R[o + 2] !== y0 || R[o + 3] !== y1) same = false;
            R[o] = x0;
            R[o + 1] = x1;
            R[o + 2] = y0;
            R[o + 3] = y1;
        }
        if (same) return;
        this.detailZ = z;
        this.detailSprites.begin();
        for (let level = 0; level < DUST_DETAIL_LEVELS.length; level++) {
            const L = DUST_DETAIL_LEVELS[level];
            const lw = lodWindow((L.size / DUST_TEX_SIZE) * z) * p.dustDetail;
            const o = level * 4;
            for (let iy = R[o + 2]; iy <= R[o + 3]; iy++) {
                for (let ix = R[o]; ix <= R[o + 1]; ix++) {
                    const c = this.dustCell(level, ix, iy);
                    if (c.v < 0.02) continue;
                    const s = c.s;
                    const tex = this.dustTex[s.variant] ?? null;
                    if (tex === null) continue;
                    const spr = this.detailSprites.use(cellKey(level, ix, iy), s, tex);
                    spr.alpha = k * DUST_DETAIL_ALPHA * Math.sqrt(c.v) * s.alpha * lw;
                }
            }
        }
        this.detailSprites.end();
    }

    /** Murk: system-sized patches at galaxy zoom; low, edge-weighted cells of the same material closer in. */
    private drawMurk(p: RimParams, z: number, cam: Camera): void {
        const tex = this.murkTexture;
        this.murkCellSprites.begin();
        if (tex !== null) {
            const c = murkCloseness(z, cam.minZoom);
            const halfDiag = Math.hypot(cam.width, cam.height) / 2;
            const size = this.murkSize;
            const n = Math.min(this.murk.length, this.murkSprites.length);
            for (let i = 0; i < n; i++) {
                const m = this.murk[i];
                const spr = this.murkSprites[i];
                let a = 0;
                if (boundsOnScreen(m.x, m.y, size * 0.71, PAN_QUANTUM_PX * 2, cam.x, cam.y, cam.width, cam.height, z)) {
                    a = m.w * p.murkStrength * MURK_FAR_ALPHA * (0.75 + 0.5 * this.murkCov[i]) * (1 - 0.85 * c);
                    if (c > 0) a *= 1 - c + c * murkVignette((Math.hypot(m.x - cam.x, m.y - cam.y) * z) / halfDiag);
                }
                const on = a >= 0.004;
                if (spr.visible !== on) spr.visible = on;
                if (on) spr.alpha = a;
            }
            if (c > 0.01 && this.murk.length > 0) {
                for (let level = 0; level < DUST_DETAIL_LEVELS.length; level++) {
                    const L = DUST_DETAIL_LEVELS[level];
                    const lw = lodWindow((L.size / DUST_TEX_SIZE) * z);
                    if (lw < 0.01) continue;
                    const hw = cam.width / 2 / z + L.size * 0.75;
                    const hh = cam.height / 2 / z + L.size * 0.75;
                    const x0 = Math.floor((cam.x - hw) / L.cell);
                    const x1 = Math.floor((cam.x + hw) / L.cell);
                    const y0 = Math.floor((cam.y - hh) / L.cell);
                    const y1 = Math.floor((cam.y + hh) / L.cell);
                    for (let iy = y0; iy <= y1; iy++) {
                        for (let ix = x0; ix <= x1; ix++) {
                            const cell = this.murkCell(level, ix, iy);
                            if (cell.v < 0.02) continue;
                            const s = cell.s;
                            if (!boundsOnScreen(s.x, s.y, Math.max(s.length, s.width) * 0.71, PAN_QUANTUM_PX * 2, cam.x, cam.y, cam.width, cam.height, z)) continue;
                            const a = p.murkStrength * MURK_NEAR_ALPHA * cell.v * s.alpha * lw * c * murkVignette((Math.hypot(s.x - cam.x, s.y - cam.y) * z) / halfDiag);
                            if (a < 0.004) continue;
                            const t = this.dustTex[s.variant] ?? tex;
                            const spr = this.murkCellSprites.use(cellKey(level, ix, iy), s, t);
                            spr.alpha = a;
                        }
                    }
                }
            }
        }
        this.murkCellSprites.end();
    }

    /**
     * Per frame, after mainView has set the starfield / backdrop alphas. `galaxyA` = the backdrop alpha (1 at galaxy
     * zoom, 0 by system zoom).
     */
    update(z: number, cam: Camera, galaxyA: number): void {
        const p = this.params;
        const geo = this.geo;
        if (p === null || geo === null || !this.mounted) return;
        if (this.pendingVariants !== null) {
            const v = this.pendingVariants;
            this.pendingVariants = null;
            if (v.length > 0) this.generateDust(v);
            else this.finishDust(performance.now());
        }
        this.frame++;
        const tSec = Date.now() / 1000;
        const camW = this.weightAt(cam.x, cam.y);

        if (this.wash !== null) {
            this.wash.alpha = galaxyA;
            this.wash.visible = galaxyA > 0.01;
        }

        // Dust space: pans at DUST_PARALLAX of the camera (about the galaxy centre). The deep field container undoes
        // the world transform so the starfield keeps its screen-space parallax.
        const offX = (cam.x - geo.cx) * (1 - DUST_PARALLAX);
        const offY = (cam.y - geo.cy) * (1 - DUST_PARALLAX);
        this.dustRoot.position.set(offX, offY);
        if (this.world !== null && this.deepField.children.length > 0) {
            this.deepField.scale.set(1 / z);
            this.deepField.position.set(-this.world.x / z, -this.world.y / z);
        }

        // (3) murk patch list (explored state only grows; refreshed every 90 frames).
        let murkDirty = false;
        if (this.dustReady && ++this.murkFrame >= MURK_REFRESH_FRAMES) {
            this.murkFrame = 0;
            this.refreshMurk(p, geo);
            murkDirty = true;
        }
        // Dust + murk sprites only change with the camera (or the murk refresh).
        // Keyed on the camera quantised to PAN_QUANTUM_PX screen pixels (culling carries that much margin; the murk's
        // screen-edge weighting lags at most that much).
        if (this.camKey.changed(Math.round((cam.x * z) / PAN_QUANTUM_PX), Math.round((cam.y * z) / PAN_QUANTUM_PX), z, cam.width, cam.height) || murkDirty) {
            this.camCov = this.dustAt(cam.x - offX, cam.y - offY);
            if (this.dustReady && this.lanes.length > 0) this.drawDust(p, z, cam, cam.x - offX, cam.y - offY);
            this.drawMurk(p, z, cam);
        }

        // (1) + (4) starfield tint / thinning by camera position (the dust under the camera adds to both).
        const atmo = clamp01(camW + 0.35 * this.camCov * p.dustStrength);
        if (this.starfieldFar !== null && this.starfieldNear !== null && atmo > 0) {
            // With dust on, the uniform thinning eases off: the lanes do the thinning where they lie (item 4), and
            // they need a deep field to occlude.
            const th = deepFieldThinning(this.lanes.length > 0 ? atmo * 0.55 : atmo, p.tintStrength);
            this.starfieldFar.alpha *= th.far;
            this.starfieldNear.alpha *= th.near;
        }
        if (this.starfieldFar !== null && this.starfieldNear !== null && this.tintKey.changed(Math.round(atmo * 64))) {
            const tint = rimTint(Math.round(atmo * 64) / 64, p.tintStrength);
            this.starfieldFar.tint = tint;
            this.starfieldNear.tint = tint;
        }

        // (13) vignette + grain.
        if (this.vignette !== null && this.grain !== null) {
            const vA = camW * p.tintStrength;
            const gA = camW * p.murkStrength * 0.08;
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

        // (6) eyes in the dark: system zoom only, rim systems only, crossfaded in (never a pop) and blinking.
        this.eyePool.begin();
        const eyeZ = eyeZoomFade(z);
        const tex = this.eyeTexture;
        if (eyeZ > 0.003 && tex !== null) {
            for (const e of this.eyes) {
                if (e.size * z < 1) continue;
                if (!boundsOnScreen(e.x, e.y, e.gap + e.size, e.gap, cam.x, cam.y, cam.width, cam.height, z)) continue;
                const blink = eyeBlinkAlpha(tSec, e.period, e.onFraction, e.phase);
                if (blink <= 0.01) continue;
                const cyc = eyeCycleIndex(tSec, e.period, e.phase);
                const mv = eyeMoveOffset(e.seed, cyc, e.moveRadius);
                const cx = e.x + mv.dx;
                const cy = e.y + mv.dy;
                const dx = Math.cos(e.angle) * e.gap * 0.5;
                const dy = Math.sin(e.angle) * e.gap * 0.5;
                const alpha = blink * eyeZ * EYE_MAX_ALPHA;
                const s1 = this.eyePool.acquire(tex);
                s1.position.set(cx - dx, cy - dy);
                s1.scale.set(e.size / tex.width);
                s1.alpha = alpha;
                const s2 = this.eyePool.acquire(tex);
                s2.position.set(cx + dx, cy + dy);
                s2.scale.set(e.size / tex.width);
                s2.alpha = alpha;
            }
        }
        this.eyePool.end();
    }
}
