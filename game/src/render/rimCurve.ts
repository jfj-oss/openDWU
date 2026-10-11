// 19i "Rim atmosphere": the rim curve (scenario params, galaxy centre / rim radius, the 0..1 rim weight), split out of
// rimAtmosphereLayer.ts (which re-exports all of it) so that code without Pixi can use it: the sim worker installs the
// per-system rim weights / name overrides at boot (rimAtmosphereWiring.ts, docs/sim-worker.md §9 chunk 3), and a
// module Web Worker must not load pixi.js. Pure functions; no DOM / Pixi imports.

import type { Galaxy } from '../sim/galaxy';
import { scenarioFlag, scenarioParam } from '../sim/scenario';

export const RIM_FLAG = 'rimAtmosphere';

/** Resolved scenario params (see scenarios/rim-atmosphere/scenario.json). */
export interface RimParams {
    /** Radius fraction where the rim band starts (0..1 of the rim radius). */
    rimInner: number;
    /** Colour grading strength 0..1: wash, cold tint, dust lanes, deep-field thinning. */
    tintStrength: number;
    /** Unexplored-rim murk strength 0..1. */
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
    /** Screen vignette strength deep in the rim, 0..1 (0 = off). Kept subtle: it fades in only past
     *  VIGNETTE_DEPTH_START of the rim weight. */
    vignetteStrength: number;
    /** Film grain strength deep in the rim, 0..1 (0 = off). */
    grainStrength: number;
    /** Wind motes in rim systems at system zoom, 0..1 (0 = off). */
    windStrength: number;
    /** Galaxy-map rim look option (RIM_MAP_LOOKS index; see rimMapLook.ts). */
    rimMapLook: number;
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
    vignetteStrength: 0.25,
    grainStrength: 0.3,
    windStrength: 1,
    rimMapLook: 1,
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
        vignetteStrength: clamp01(scenarioParam(galaxy, 'vignetteStrength', RIM_DEFAULTS.vignetteStrength)),
        grainStrength: clamp01(scenarioParam(galaxy, 'grainStrength', RIM_DEFAULTS.grainStrength)),
        windStrength: clamp01(scenarioParam(galaxy, 'windStrength', RIM_DEFAULTS.windStrength)),
        rimMapLook: Math.round(Math.min(3, Math.max(0, scenarioParam(galaxy, 'rimMapLook', RIM_DEFAULTS.rimMapLook)))),
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

// --- zoom gate for the screen-space atmosphere (vignette, grain, camera tint, wind, ambient bed) ----------------

/** "System view" zoom factor (1 / zoom): the system-zoom threshold the overlays use (overlayLayer `1 / z < 70`). The
 *  screen-space atmosphere reaches full strength here. */
export const RIM_SYSTEM_VIEW_FACTOR = 70;

/** The whole-galaxy zoom for a viewport (Camera.setGalaxyBounds' minZoom: the fit with a 0.9 margin). */
export function rimGalaxyViewZoom(sizeX: number, sizeY: number, width: number, height: number): number {
    const fit = Math.min(width / sizeX, height / sizeY);
    return Number.isFinite(fit) && fit > 0 ? fit * 0.9 : 1e-6;
}

/**
 * 0..1 zoom gate for the screen-space atmosphere: 0 from the galaxy view (`galaxyZoom`) until the camera is halfway to
 * the system view (the geometric mean of the two zooms, i.e. halfway in log zoom = halfway in mouse-wheel steps), then
 * a smoothstep in log zoom to 1 at the system view (1 / RIM_SYSTEM_VIEW_FACTOR) and beyond. Continuous: no pop.
 */
export function rimAtmoZoomFade(z: number, galaxyZoom: number): number {
    const zs = 1 / RIM_SYSTEM_VIEW_FACTOR;
    if (!(z > 0)) return 0;
    if (z >= zs) return 1;
    const zg = galaxyZoom > 0 ? galaxyZoom : 1e-6;
    if (zg >= zs) return 0;
    const lo = Math.sqrt(zg * zs);
    if (z <= lo) return 0;
    const t = Math.log(z / lo) / Math.log(zs / lo);
    return t * t * (3 - 2 * t);
}
