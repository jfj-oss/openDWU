// Scenario 19a art — the Oranthi Concord's own procedural ships (tasks/19-mod-layer-scenarios.md "Concord art"). Not a
// port: the original has no such art. Realistic industrial hulls in one family: dark turquoise hulls, dark copper /
// yellow trim, several tones per ship so hull, deck, superstructure and engine zones read as separate sections.
//   Treasure ship — a giant, wide container carrier: a flat deck stacked with multicoloured containers in tidy blocks,
//     gantry cranes over the deck, a lit bridge tower aft, deck floodlights, two jet-fan thruster pods on the rear
//     quarters (fan faces turning slowly, heat-stained nozzles).
//   Freighters — bulk carriers: long hold hatch covers, deck cranes, a smaller bridge, a few containers.
//   Explorers / construction ships — the same language, smaller: sensor dome, lab modules and a pad; a big crane,
//     truss frames and a workshop.
//   Warships — modern naval: angular grey hulls with heavy rust and salt staining, a bridge with a sensor mast and a
//     slowly turning dish, turrets and missile cell blocks, hull numbers; thin copper trim only on the bridge.
//   Bases / the space port — a hub and ring docks with gantries, cranes, fuel tanks, hazard-striped docking arms and
//     lit windows.
// Construction detail everywhere: plating with seams, weld beads and rivet rows (height grooves / bumps, so the joins
// catch the light), vents, pipe runs, hazard stripes at docking points, hull numbers and Concord glyphs; grain,
// scratches and blemishes from noise and a scratch map; rust streaks bleeding aft from rivets and hatches. Lights are
// small and tight: warm deck / window lights, flickering floodlights, and positional navigation lights at the real
// extremities — red to port, green to starboard, white at the stern and masthead, white strobes on the treasure ship's
// pod tips and the warships' masts (a short double flash on the ambient nav-light cycle, phase per ship).
//
// Technique: a supersampled G-buffer (albedo, height, material, surface pattern) painted with shapes, then detail
// passes (plating, rivets, welds, grain, scratches, rust, salt) and a lighting pass — normals from the height field,
// one key light from ahead of the bow as measured on the original Ackdarian frames (CONCORD_LIGHT), soft ambient
// occlusion at superstructure bases, cast shadows by marching the height field toward the light, a specular glint on
// bare metal / copper / glass — downsampled to the texture. Then the chroma is scaled to the originals' saturation
// (lights keep their colour) and the luma quantile-matched to the matching Ackdarian frame (ACKDARIAN_REFERENCE), so
// mean, contrast and the 5–95 % band equal the stock art's. Pure and deterministic (own hash / RNG, never galaxy.rnd);
// testable without a DOM. Top-down like the originals, bow up in the raw image (the ship layer rotates raw art by
// heading + π/2). Thruster marks are painted as the originals do (pure-blue runs at the nozzles) and go through the
// same scan + paint-out as stock art (shipArt.ts), so the ambient layer's engine exhaust works unchanged; there are no
// yellow marks (the Concord's own navigation lights replace the stock ones). Overlays sharing the ship's transform:
// light halos by blink group (additive, tight) and animated parts (fan faces, the radar dish).
//
// Display gate: the rim trader flag and the scenario flag `concordArt` (default on; off = the stock Ackdarian art the
// race file names); `concordArtLook` 0 = weathered (default), 1 = clean (light weathering). Render-only — nothing here
// reads galaxy.rnd or writes sim state.

import { Container, Texture } from 'pixi.js';
import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import { BuiltObjectSubRole } from '../sim/builtObjectTypes';
import { scenarioFlag, scenarioParam } from '../sim/scenario/state';
import { RIM_RACE, rimTraderEmpire } from '../sim/scenario/rimTrade/common';
import { shipImageMetrics, type ShipImageMetrics } from './builtObjectLayer';
import { LIGHT_OFF_SECONDS, LIGHT_ON_SECONDS, scanShipMarkers, type ShipMarkers } from './ambientLayer';
import { paintOutShipMarkers } from './shipArt';
import { useMinifyingFilter } from './assets';
import { SpritePool } from './fxCommon';

// ---------------------------------------------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------------------------------------------

export type ConcordKind = 'warship' | 'freighter' | 'explorer' | 'construction' | 'treasure' | 'port' | 'base';
export const CONCORD_KINDS: readonly ConcordKind[] = ['warship', 'freighter', 'explorer', 'construction', 'treasure', 'port', 'base'];

export type ConcordLook = 'weathered' | 'clean';
/** Index = the `concordArtLook` param value. */
export const CONCORD_LOOKS: readonly ConcordLook[] = ['weathered', 'clean'];

export function concordLookOf(param: number): ConcordLook {
    return CONCORD_LOOKS[Math.max(0, Math.min(CONCORD_LOOKS.length - 1, Math.trunc(param) || 0))];
}

/** Hull-size thresholds of the size buckets 1..5 (bucket 0 below the first). */
export const CONCORD_SIZE_THRESHOLDS = [150, 300, 500, 800, 1200] as const;
export const CONCORD_BUCKETS = CONCORD_SIZE_THRESHOLDS.length + 1;
/** Square texture side per size bucket (ships / bases). */
const SHIP_SIDES = [128, 160, 192, 256, 320, 384] as const;
const BASE_SIDES = [192, 224, 256, 320, 384, 448] as const;

export function concordKindOf(subRole: BuiltObjectSubRole, treasure: boolean): ConcordKind {
    if (treasure) return 'treasure';
    switch (subRole) {
        case BuiltObjectSubRole.ResupplyShip:
        case BuiltObjectSubRole.SmallFreighter:
        case BuiltObjectSubRole.MediumFreighter:
        case BuiltObjectSubRole.LargeFreighter:
        case BuiltObjectSubRole.ColonyShip:
        case BuiltObjectSubRole.PassengerShip:
            return 'freighter';
        case BuiltObjectSubRole.ExplorationShip:
            return 'explorer';
        case BuiltObjectSubRole.ConstructionShip:
        case BuiltObjectSubRole.GasMiningShip:
        case BuiltObjectSubRole.MiningShip:
            return 'construction';
        case BuiltObjectSubRole.SmallSpacePort:
        case BuiltObjectSubRole.MediumSpacePort:
        case BuiltObjectSubRole.LargeSpacePort:
            return 'port';
        case BuiltObjectSubRole.GasMiningStation:
        case BuiltObjectSubRole.MiningStation:
        case BuiltObjectSubRole.ResortBase:
        case BuiltObjectSubRole.GenericBase:
        case BuiltObjectSubRole.EnergyResearchStation:
        case BuiltObjectSubRole.WeaponsResearchStation:
        case BuiltObjectSubRole.HighTechResearchStation:
        case BuiltObjectSubRole.MonitoringStation:
        case BuiltObjectSubRole.DefensiveBase:
            return 'base';
        default:
            return 'warship';
    }
}

export function concordSizeBucket(size: number): number {
    let b = 0;
    for (const t of CONCORD_SIZE_THRESHOLDS) if (size >= t) b++;
    return b;
}

export function concordTextureSide(kind: ConcordKind, bucket: number): number {
    const b = Math.max(0, Math.min(CONCORD_BUCKETS - 1, bucket));
    if (kind === 'port' || kind === 'base') return BASE_SIDES[b];
    if (kind === 'treasure') return Math.max(384, SHIP_SIDES[b]);
    return SHIP_SIDES[b];
}

/** The drawing parameters of one variant (derived; exported for tests and the report). */
export interface ConcordSpec {
    kind: ConcordKind;
    look: ConcordLook;
    bucket: number;
    side: number;
    /** Weathering strength (rust, salt, scratches, grime): 1 weathered, ~0.35 clean; warships ×1.5. */
    weathering: number;
    /** Treasure ship: container columns across the deck and gantry cranes. */
    containerColumns: number;
    gantries: number;
    /** Freighter: hold hatch covers. */
    hatches: number;
    /** Warship: gun turrets and missile cell blocks. */
    turrets: number;
    missileBlocks: number;
    /** Base / port: docking arms and fuel tanks. */
    docks: number;
    tanks: number;
}

export function concordSpec(kind: ConcordKind, bucket: number, look: ConcordLook = 'weathered'): ConcordSpec {
    const b = Math.max(0, Math.min(CONCORD_BUCKETS - 1, bucket));
    const base = kind === 'port' || kind === 'base';
    let weathering = look === 'clean' ? 0.35 : 1;
    if (kind === 'warship') weathering *= 1.5;
    return {
        kind,
        look,
        bucket: b,
        side: concordTextureSide(kind, b),
        weathering,
        containerColumns: kind === 'treasure' ? (b >= 4 ? 10 : 8) : 0,
        gantries: kind === 'treasure' ? 3 : 0,
        hatches: kind === 'freighter' ? 4 + Math.floor(b / 2) : 0,
        turrets: kind === 'warship' ? (b >= 3 ? 2 : 1) : 0,
        missileBlocks: kind === 'warship' ? (b >= 2 ? 2 : 1) : 0,
        docks: kind === 'port' ? 6 + 2 * Math.floor(b / 2) : base ? 3 + Math.floor(b / 2) : 0,
        tanks: kind === 'port' ? 4 + Math.floor(b / 2) : base ? 3 + Math.floor(b / 2) : 0,
    };
}

// ---------------------------------------------------------------------------------------------------------------
// Statistics and luma matching
// ---------------------------------------------------------------------------------------------------------------

export interface RgbaImage {
    w: number;
    h: number;
    data: Uint8ClampedArray;
}

export interface ConcordArtStats {
    /** Opaque (alpha ≥ 128) pixels measured. */
    pixels: number;
    /** Rec.709 luma of the sRGB values, 0..1: mean, standard deviation (contrast), 5th / 95th percentiles. */
    meanL: number;
    stdL: number;
    p5L: number;
    p95L: number;
    /** Mean HSV saturation. */
    meanSat: number;
    /** Hue (degrees) of the mean colour. */
    hueDeg: number;
}

const luma709 = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Luma / saturation statistics of the opaque pixels (alpha ≥ 128) of an RGBA image; `skip` excludes pixels. */
export function concordArtStats(data: ArrayLike<number>, w: number, h: number, skip?: (i: number) => boolean): ConcordArtStats {
    const ls: number[] = [];
    let sumS = 0;
    let sr = 0;
    let sg = 0;
    let sb = 0;
    for (let p = 0; p < w * h; p++) {
        const i = p * 4;
        if (data[i + 3] < 128 || (skip !== undefined && skip(p))) continue;
        const r = data[i] / 255;
        const g = data[i + 1] / 255;
        const b = data[i + 2] / 255;
        ls.push(luma709(r, g, b));
        const mx = Math.max(r, g, b);
        sumS += mx > 0 ? (mx - Math.min(r, g, b)) / mx : 0;
        sr += r;
        sg += g;
        sb += b;
    }
    const n = ls.length;
    if (n === 0) return { pixels: 0, meanL: 0, stdL: 0, p5L: 0, p95L: 0, meanSat: 0, hueDeg: 0 };
    let sum = 0;
    for (const l of ls) sum += l;
    const meanL = sum / n;
    let v = 0;
    for (const l of ls) v += (l - meanL) * (l - meanL);
    ls.sort((a, b) => a - b);
    const pct = (q: number): number => ls[Math.min(n - 1, Math.floor(q * n))];
    return { pixels: n, meanL, stdL: Math.sqrt(v / n), p5L: pct(0.05), p95L: pct(0.95), meanSat: sumS / n, hueDeg: hueOf(sr / n, sg / n, sb / n) };
}

function hueOf(r: number, g: number, b: number): number {
    const mx = Math.max(r, g, b);
    const d = mx - Math.min(r, g, b);
    if (d <= 0) return 0;
    let hh: number;
    if (mx === r) hh = ((g - b) / d) % 6;
    else if (mx === g) hh = (b - r) / d + 2;
    else hh = (r - g) / d + 4;
    return Math.round((hh * 60 + 360) % 360);
}

/**
 * The original Ackdarian ship frames (DesignsPictureFamilyIndex 7, the art the Oranthi race file borrows) each kind is
 * matched to, and their measured opaque-pixel statistics (concordArtStats on the raw PNG; the install-gated test
 * re-measures them): luma mean / standard deviation, mean HSV saturation and the luma quantiles at CONCORD_QUANTILE_P the
 * generated art's luma is quantile-matched to. Only these numbers live in the repo, never the art.
 */
export interface AckdarianReference {
    file: string;
    meanL: number;
    stdL: number;
    meanSat: number;
    q: readonly number[];
}

/** Probabilities of the stored quantiles: denser in the tails, where the originals' highlights and black outlines sit. */
export const CONCORD_QUANTILE_P: readonly number[] = [0, 0.01, 0.025, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 0.975, 0.99, 1];

const Q_CRUISER = [0, 0, 0, 0.045, 0.099, 0.127, 0.147, 0.166, 0.183, 0.2, 0.217, 0.234, 0.25, 0.269, 0.288, 0.31, 0.331, 0.358, 0.392, 0.436, 0.494, 0.592, 0.688, 0.821, 1];
const Q_LARGEFREIGHTER = [0, 0, 0, 0.001, 0.059, 0.092, 0.116, 0.135, 0.152, 0.167, 0.183, 0.2, 0.219, 0.235, 0.257, 0.281, 0.311, 0.345, 0.382, 0.427, 0.484, 0.599, 0.744, 0.925, 0.997];
const Q_EXPLORATIONSHIP = [0, 0, 0, 0.001, 0.064, 0.095, 0.115, 0.134, 0.147, 0.16, 0.177, 0.194, 0.217, 0.238, 0.269, 0.292, 0.317, 0.349, 0.386, 0.434, 0.501, 0.629, 0.709, 0.856, 0.993];
const Q_CONSTRUCTIONSHIP = [0, 0, 0, 0.013, 0.082, 0.111, 0.139, 0.16, 0.177, 0.194, 0.21, 0.227, 0.248, 0.272, 0.301, 0.33, 0.362, 0.398, 0.445, 0.496, 0.556, 0.699, 0.844, 0.986, 1];
const Q_LARGESPACEPORT = [0, 0, 0.003, 0.047, 0.09, 0.114, 0.135, 0.155, 0.173, 0.19, 0.208, 0.225, 0.243, 0.264, 0.286, 0.309, 0.336, 0.366, 0.403, 0.449, 0.506, 0.6, 0.699, 0.847, 1];
const Q_GENERICBASE = [0, 0, 0.013, 0.06, 0.095, 0.118, 0.135, 0.149, 0.164, 0.177, 0.191, 0.204, 0.217, 0.231, 0.246, 0.263, 0.283, 0.305, 0.333, 0.37, 0.423, 0.51, 0.596, 0.724, 0.997];

export const ACKDARIAN_REFERENCE: Readonly<Record<ConcordKind, AckdarianReference>> = {
    warship: { file: 'family7/cruiser.png', meanL: 0.278, stdL: 0.167, meanSat: 0.173, q: Q_CRUISER },
    freighter: { file: 'family7/largefreighter.png', meanL: 0.255, stdL: 0.183, meanSat: 0.174, q: Q_LARGEFREIGHTER },
    explorer: { file: 'family7/explorationship.png', meanL: 0.257, stdL: 0.182, meanSat: 0.219, q: Q_EXPLORATIONSHIP },
    construction: { file: 'family7/constructionship.png', meanL: 0.295, stdL: 0.202, meanSat: 0.189, q: Q_CONSTRUCTIONSHIP },
    treasure: { file: 'family7/largefreighter.png', meanL: 0.255, stdL: 0.183, meanSat: 0.174, q: Q_LARGEFREIGHTER },
    port: { file: 'family7/largespaceport.png', meanL: 0.276, stdL: 0.173, meanSat: 0.205, q: Q_LARGESPACEPORT },
    base: { file: 'family7/genericbase.png', meanL: 0.242, stdL: 0.141, meanSat: 0.225, q: Q_GENERICBASE },
};

/** Mean HSV saturation the Concord art is brought to: the upper end of the Ackdarian frames' 0.17–0.29 (lacquer). */
export const CONCORD_TARGET_SAT = 0.26;

/**
 * Quantile-matches the luma of the opaque pixels (not in `skip`) to `q` (the quantiles at probabilities `pr`): the
 * pixel of rank i gets the reference luma interpolated at (i + 0.5) / n, its RGB scaled by L'/L (hue and HSV saturation kept, up to
 * clamping). Monotonic, so the shading order is kept while mean, contrast and the 5–95 % band follow the original.
 */
export function matchLumaQuantiles(img: RgbaImage, q: readonly number[], skip?: (i: number) => boolean, pr: readonly number[] = CONCORD_QUANTILE_P): void {
    const d = img.data;
    const idx: number[] = [];
    const lum: number[] = [];
    for (let p = 0; p < img.w * img.h; p++) {
        const i = p * 4;
        if (d[i + 3] < 128 || (skip !== undefined && skip(p))) continue;
        idx.push(p);
        lum.push(luma709(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255));
    }
    const n = idx.length;
    if (n === 0) return;
    const order = Array.from({ length: n }, (_, k) => k).sort((a, b) => lum[a] - lum[b] || a - b);
    let j = 0;
    for (let rank = 0; rank < n; rank++) {
        const k = order[rank];
        const t = (rank + 0.5) / n;
        while (j < pr.length - 2 && pr[j + 1] < t) j++;
        const l2 = q[j] + (q[j + 1] - q[j]) * ((t - pr[j]) / (pr[j + 1] - pr[j]));
        const i = idx[k] * 4;
        const l = lum[k];
        if (l < 0.002) {
            d[i] = d[i + 1] = d[i + 2] = Math.round(l2 * 255);
            continue;
        }
        const s = l2 / l;
        d[i] = Math.round((d[i] / 255) * s * 255);
        d[i + 1] = Math.round((d[i + 1] / 255) * s * 255);
        d[i + 2] = Math.round((d[i + 2] / 255) * s * 255);
    }
}

/**
 * Scales every opaque pixel's chroma about its own luma (c' = L + (c − L)·k: luma kept exactly) so the mean HSV
 * saturation of the measured pixels (not in `skip`) reaches `target`; pixels in `keep` (the lights) keep their colour.
 */
export function matchSaturation(img: RgbaImage, target: number, skip?: (i: number) => boolean, keep?: (i: number) => boolean): void {
    const d = img.data;
    for (let pass = 0; pass < 4; pass++) {
        const s = concordArtStats(d, img.w, img.h, skip);
        if (s.pixels === 0 || s.meanSat <= 1e-4 || Math.abs(s.meanSat - target) < 0.004) return;
        const k = target / s.meanSat;
        for (let p = 0; p < img.w * img.h; p++) {
            const i = p * 4;
            if (d[i + 3] === 0 || (skip !== undefined && skip(p)) || (keep !== undefined && keep(p))) continue;
            const r = d[i] / 255;
            const g = d[i + 1] / 255;
            const b = d[i + 2] / 255;
            const l = luma709(r, g, b);
            d[i] = Math.round(Math.max(0, Math.min(1, l + (r - l) * k)) * 255);
            d[i + 1] = Math.round(Math.max(0, Math.min(1, l + (g - l) * k)) * 255);
            d[i + 2] = Math.round(Math.max(0, Math.min(1, l + (b - l) * k)) * 255);
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Noise (own hash; never galaxy.rnd)
// ---------------------------------------------------------------------------------------------------------------

function valueNoise(seed: number): (x: number, y: number) => number {
    const hash = (ix: number, iy: number): number => {
        let hh = (ix * 374761393 + iy * 668265263 + seed * 144269504) | 0;
        hh = Math.imul(hh ^ (hh >>> 13), 1274126177);
        hh ^= hh >>> 16;
        return (hh >>> 0) / 4294967296;
    };
    const sm = (t: number): number => t * t * (3 - 2 * t);
    return (x, y) => {
        const ix = Math.floor(x);
        const iy = Math.floor(y);
        const fx = sm(x - ix);
        const fy = sm(y - iy);
        const a = hash(ix, iy);
        const b = hash(ix + 1, iy);
        const c = hash(ix, iy + 1);
        const e = hash(ix + 1, iy + 1);
        return a + (b - a) * fx + (c - a) * fy + (a - b - c + e) * fx * fy;
    };
}

function fbm2(n: (x: number, y: number) => number, x: number, y: number): number {
    return n(x, y) * 0.5 + n(x * 2.03, y * 2.03) * 0.3 + n(x * 4.1, y * 4.1) * 0.2 - 0.5;
}

// ---------------------------------------------------------------------------------------------------------------
// Palette, materials, lighting
// ---------------------------------------------------------------------------------------------------------------

type Rgb = readonly [number, number, number];
/** Hull paint (dark turquoise), its darker lower / engine-zone tone and the lighter superstructure tone. */
const TURQ: Rgb = [0.09, 0.3, 0.29];
const TURQ_DARK: Rgb = [0.06, 0.2, 0.2];
const TURQ_LIGHT: Rgb = [0.2, 0.42, 0.4];
const DECK: Rgb = [0.23, 0.25, 0.23];
const DECK_DARK: Rgb = [0.15, 0.16, 0.15];
const ENGINE: Rgb = [0.3, 0.3, 0.31];
const COPPER: Rgb = [0.6, 0.37, 0.18];
/** Dark yellow: gantries, cranes, hatch covers. */
const OCHRE: Rgb = [0.56, 0.45, 0.15];
const HATCH: Rgb = [0.46, 0.31, 0.16];
const WAR_GREY: Rgb = [0.4, 0.42, 0.44];
const WAR_GREY_DARK: Rgb = [0.3, 0.32, 0.34];
const WAR_DECK: Rgb = [0.25, 0.26, 0.27];
const METAL: Rgb = [0.34, 0.34, 0.35];
const RUST: Rgb = [0.42, 0.2, 0.07];
const SALT: Rgb = [0.74, 0.75, 0.72];
const BARE: Rgb = [0.58, 0.58, 0.57];
const HAZARD: Rgb = [0.8, 0.63, 0.1];
const BLACK: Rgb = [0.04, 0.04, 0.045];
const GLASS: Rgb = [0.08, 0.14, 0.17];
const WHITE_PAINT: Rgb = [0.8, 0.8, 0.76];
const HEAT: Rgb = [0.3, 0.2, 0.3];
/** Shipping-container liveries (muted): blue, red, orange, green, grey, white, yellow, brown, teal, maroon. */
const CONTAINERS: readonly Rgb[] = [
    [0.12, 0.26, 0.5],
    [0.55, 0.13, 0.09],
    [0.72, 0.38, 0.1],
    [0.18, 0.4, 0.22],
    [0.45, 0.46, 0.46],
    [0.78, 0.78, 0.74],
    [0.7, 0.58, 0.14],
    [0.38, 0.24, 0.14],
    [0.1, 0.4, 0.42],
    [0.4, 0.1, 0.14],
];

/** Light kinds: blink groups of the overlay (and the baked colour). */
export type ConcordLightKind = 'window' | 'deck' | 'flood' | 'port' | 'starboard' | 'white' | 'strobe';
const LIGHT_COLOUR: Readonly<Record<ConcordLightKind, Rgb>> = {
    window: [1, 0.8, 0.5],
    deck: [1, 0.86, 0.62],
    flood: [1, 0.95, 0.82],
    port: [1, 0.14, 0.1],
    starboard: [0.2, 1, 0.42],
    white: [1, 1, 0.95],
    strobe: [0.95, 0.97, 1],
};

const M_PAINT = 1;
const M_DECK = 2;
const M_METAL = 3;
const M_COPPER = 4;
const M_CONTAINER = 5;
const M_LIGHT = 6;
const M_GLASS = 7;
const P_NONE = 0;
const P_PLATE = 1;
const P_GRATE = 2;
const P_LATTICE = 3;
const P_NONSKID = 4;

/**
 * Key light, raw-image space (x right, y down = toward the stern, z out of the image): from ahead of the bow and above,
 * as measured on the original Ackdarian frames — their mean Sobel luma gradient points to the bow (cruiser
 * (0.02, −1.00), capital ship (0.04, −1.00), destroyer (0.06, −1.00), large freighter (0.44, −0.90), family7).
 */
export const CONCORD_LIGHT: readonly [number, number, number] = norm3(0.08, -0.72, 0.69);
const HALF = norm3(CONCORD_LIGHT[0], CONCORD_LIGHT[1], CONCORD_LIGHT[2] + 1);

/** Own deterministic RNG (mulberry32). */
function makeRng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function hash2(a: number, b: number): number {
    let h = (a * 374761393 + b * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth01 = (e0: number, e1: number, x: number): number => {
    const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------------------------------------------------------
// G-buffer and painters (coordinates in texture px; cells are 1 / ss px)
// ---------------------------------------------------------------------------------------------------------------

class GBuf {
    readonly n: number;
    readonly alb: Float32Array;
    readonly hgt: Float32Array;
    readonly mat: Uint8Array;
    readonly pat: Uint8Array;
    constructor(
        readonly side: number,
        readonly ss: number,
    ) {
        this.n = side * ss;
        this.alb = new Float32Array(this.n * this.n * 3);
        this.hgt = new Float32Array(this.n * this.n);
        this.mat = new Uint8Array(this.n * this.n);
        this.pat = new Uint8Array(this.n * this.n);
    }

    /** Visit the cells whose centres fall inside the px box: cb(cell, x, y). */
    each(x0: number, y0: number, x1: number, y1: number, cb: (i: number, x: number, y: number) => void): void {
        const { n, ss } = this;
        const i0 = Math.max(0, Math.floor(x0 * ss));
        const i1 = Math.min(n - 1, Math.ceil(x1 * ss));
        const j0 = Math.max(0, Math.floor(y0 * ss));
        const j1 = Math.min(n - 1, Math.ceil(y1 * ss));
        for (let j = j0; j <= j1; j++) {
            const y = (j + 0.5) / ss;
            if (y < y0 || y > y1) continue;
            for (let i = i0; i <= i1; i++) {
                const x = (i + 0.5) / ss;
                if (x < x0 || x > x1) continue;
                cb(j * n + i, x, y);
            }
        }
    }

    set(i: number, c: Rgb, h: number, mat: number, pat = P_NONE): void {
        this.alb[i * 3] = c[0];
        this.alb[i * 3 + 1] = c[1];
        this.alb[i * 3 + 2] = c[2];
        this.hgt[i] = h;
        this.mat[i] = mat;
        this.pat[i] = pat;
    }

    mul(i: number, k: number): void {
        this.alb[i * 3] *= k;
        this.alb[i * 3 + 1] *= k;
        this.alb[i * 3 + 2] *= k;
    }

    tint(i: number, c: Rgb, k: number): void {
        for (let ch = 0; ch < 3; ch++) this.alb[i * 3 + ch] += (c[ch] - this.alb[i * 3 + ch]) * k;
    }
}

function rect(gb: GBuf, x0: number, y0: number, x1: number, y1: number, c: Rgb, h: number, mat: number, pat = P_NONE, bevel = 0): void {
    gb.each(x0, y0, x1, y1, (i, x, y) => {
        const e = Math.min(x - x0, x1 - x, y - y0, y1 - y);
        gb.set(i, c, bevel > 0 ? h - 0.6 * Math.max(0, 1 - e / bevel) : h, mat, pat);
    });
}

function circle(gb: GBuf, cx: number, cy: number, r: number, c: Rgb, h: number, mat: number, pat = P_NONE, dome = 0): void {
    gb.each(cx - r, cy - r, cx + r, cy + r, (i, x, y) => {
        const d = Math.hypot(x - cx, y - cy);
        if (d > r) return;
        gb.set(i, c, h + dome * Math.sqrt(Math.max(0, 1 - (d / r) ** 2)), mat, pat);
    });
}

function ring(gb: GBuf, cx: number, cy: number, r0: number, r1: number, c: Rgb, h: number, mat: number, pat = P_NONE): void {
    gb.each(cx - r1, cy - r1, cx + r1, cy + r1, (i, x, y) => {
        const d = Math.hypot(x - cx, y - cy);
        if (d < r0 || d > r1) return;
        const t = (d - r0) / Math.max(1e-6, r1 - r0);
        gb.set(i, c, h + 0.5 * Math.sin(Math.PI * t), mat, pat);
    });
}

function segDist(x: number, y: number, x0: number, y0: number, x1: number, y1: number): number {
    const vx = x1 - x0;
    const vy = y1 - y0;
    const t = Math.max(0, Math.min(1, ((x - x0) * vx + (y - y0) * vy) / (vx * vx + vy * vy || 1)));
    return Math.hypot(x - (x0 + vx * t), y - (y0 + vy * t));
}

/** A capsule (beam / pipe / boom) of half-width w; `cyl` adds a rounded (cylinder) height profile. */
function seg(gb: GBuf, x0: number, y0: number, x1: number, y1: number, w: number, c: Rgb, h: number, mat: number, cyl = 0, pat = P_NONE): void {
    gb.each(Math.min(x0, x1) - w, Math.min(y0, y1) - w, Math.max(x0, x1) + w, Math.max(y0, y1) + w, (i, x, y) => {
        const d = segDist(x, y, x0, y0, x1, y1);
        if (d > w) return;
        gb.set(i, c, h + cyl * Math.sqrt(Math.max(0, 1 - (d / w) ** 2)), mat, pat);
    });
}

function poly(gb: GBuf, pts: readonly (readonly [number, number])[], c: Rgb, h: number, mat: number, pat = P_NONE, bevel = 0): void {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [x, y] of pts) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
    }
    gb.each(x0, y0, x1, y1, (i, x, y) => {
        let inside = false;
        let e = Infinity;
        for (let k = 0, m = pts.length - 1; k < pts.length; m = k++) {
            const [xi, yi] = pts[k];
            const [xj, yj] = pts[m];
            if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
            if (bevel > 0) e = Math.min(e, segDist(x, y, xi, yi, xj, yj));
        }
        if (!inside) return;
        gb.set(i, c, bevel > 0 ? h - 0.6 * Math.max(0, 1 - e / bevel) : h, mat, pat);
    });
}

/** Diagonal yellow / black hazard stripes over a box (painted at height h). */
function hazard(gb: GBuf, x0: number, y0: number, x1: number, y1: number, h: number, stripe: number): void {
    gb.each(x0, y0, x1, y1, (i, x, y) => {
        const k = Math.floor((x + y) / stripe) & 1;
        gb.set(i, k === 0 ? HAZARD : BLACK, h, M_PAINT);
    });
}

/** 3 × 5 pixel font (hull numbers / registry marks). */
const FONT: Readonly<Record<string, string>> = {
    '0': '111101101101111',
    '1': '010110010010111',
    '2': '111001111100111',
    '3': '111001111001111',
    '4': '101101111001001',
    '5': '111100111001111',
    '6': '111100111101111',
    '7': '111001010010010',
    '8': '111101111101111',
    '9': '111101111001111',
    O: '111101101101111',
    C: '111100100100111',
    '-': '000000111000000',
};

/** Paints `text` centred at (cx, cy), one font pixel = `cell` px, the letters reading along +x. */
function text(gb: GBuf, s: string, cx: number, cy: number, cell: number, c: Rgb, h: number): void {
    const w = s.length * 4 - 1;
    const x0 = cx - (w * cell) / 2;
    const y0 = cy - (5 * cell) / 2;
    for (let k = 0; k < s.length; k++) {
        const g = FONT[s[k]];
        if (g === undefined) continue;
        for (let r = 0; r < 5; r++) {
            for (let q = 0; q < 3; q++) {
                if (g[r * 3 + q] !== '1') continue;
                const x = x0 + (k * 4 + q) * cell;
                const y = y0 + r * cell;
                gb.each(x, y, x + cell, y + cell, (i) => {
                    gb.alb[i * 3] = c[0];
                    gb.alb[i * 3 + 1] = c[1];
                    gb.alb[i * 3 + 2] = c[2];
                    gb.hgt[i] = h;
                });
            }
        }
    }
}

/** The Concord glyph: a ring, a gate bar and a crossbar (painted as a marking, height kept). */
function glyph(gb: GBuf, cx: number, cy: number, r: number, c: Rgb): void {
    const w = Math.max(0.3, r * 0.16);
    gb.each(cx - r, cy - r, cx + r, cy + r, (i, x, y) => {
        const d = Math.hypot(x - cx, y - cy);
        const on = Math.abs(d - r * 0.8) < w || (Math.abs(x - cx) < w && Math.abs(y - cy) < r * 0.8) || (Math.abs(y - (cy - r * 0.3)) < w * 0.8 && Math.abs(x - cx) < r * 0.45);
        if (!on || gb.mat[i] === 0) return;
        gb.alb[i * 3] = c[0];
        gb.alb[i * 3 + 1] = c[1];
        gb.alb[i * 3 + 2] = c[2];
    });
}

// ---------------------------------------------------------------------------------------------------------------
// Ship builders
// ---------------------------------------------------------------------------------------------------------------

export interface ConcordLight {
    x: number;
    y: number;
    r: number;
    kind: ConcordLightKind;
}

export interface ConcordPart {
    kind: 'fan' | 'dish';
    /** Centre in raw texture px and radius (px). */
    x: number;
    y: number;
    r: number;
    /** Radians per second (sign = direction). */
    spin: number;
}

interface Build {
    gb: GBuf;
    spec: ConcordSpec;
    S: number;
    rng: () => number;
    lights: ConcordLight[];
    parts: ConcordPart[];
    thrusters: [number, number, number][];
    /** Rust sources: streaks bleed aft (+y) from these. */
    rust: [number, number][];
}

function light(b: Build, x: number, y: number, kind: ConcordLightKind, r = 0): void {
    const rr = r > 0 ? r : Math.max(0.45, b.S * (kind === 'window' || kind === 'deck' ? 0.0022 : 0.0034));
    b.lights.push({ x, y, r: rr, kind });
}

interface Hull {
    cx: number;
    bowY: number;
    L: number;
    W: number;
    hw: (u: number) => number;
    yAt: (u: number) => number;
}

/**
 * The hull: a crowned body (edges fall away, so the flanks take light or shade), a painted side band, the deck
 * inside it and a thin copper rail line; `zone` recolours the deck per section.
 */
function paintHull(b: Build, hull: Hull, side: Rgb, deck: Rgb, trim: boolean, deckPat: number, engineFrom = 0.9): void {
    const { gb } = b;
    const { cx, bowY, L, W, hw } = hull;
    const rail = Math.max(0.8, W * 0.09);
    gb.each(cx - W * 1.05, bowY, cx + W * 1.05, bowY + L, (i, x, y) => {
        const u = (y - bowY) / L;
        const h = hw(u);
        const dx = Math.abs(x - cx);
        if (dx > h) return;
        const e = Math.min(h - dx, (1 - u) * L * 2);
        const crown = 1 + 1.4 * smooth01(0, W * 0.35, e);
        const engine = u > engineFrom;
        if (e < rail) gb.set(i, engine ? TURQ_DARK : side, crown, M_PAINT, P_PLATE);
        else if (trim && e < rail + Math.max(0.35, W * 0.025)) gb.set(i, COPPER, crown + 0.1, M_COPPER);
        else gb.set(i, engine ? ENGINE : deck, crown, M_DECK, engine ? P_GRATE : deckPat);
    });
}

function roundedHull(cx: number, bowY: number, L: number, W: number, bowLen: number, bowMin: number): Hull {
    const hw = (u: number): number => {
        if (u < 0 || u > 1) return 0;
        let k = 1;
        if (u < bowLen) k = bowMin + (1 - bowMin) * Math.pow(Math.sin(((u / bowLen) * Math.PI) / 2), 0.8);
        if (u > 0.975) k *= 1 - 0.35 * ((u - 0.975) / 0.025) ** 2;
        return W * k;
    };
    return { cx, bowY, L, W, hw, yAt: (u) => bowY + u * L };
}

/** Forecastle: raised bow deck with bollards, a windlass, hazard edge and the registry number. */
function forecastle(b: Build, hull: Hull, u0: number, u1: number, reg: string): void {
    const { gb } = b;
    const { cx, W } = hull;
    const y0 = hull.yAt(u0);
    const y1 = hull.yAt(u1);
    gb.each(cx - W, y0, cx + W, y1, (i, x, y) => {
        const u = (y - hull.bowY) / hull.L;
        if (Math.abs(x - cx) > hull.hw(u) - Math.max(0.8, W * 0.09)) return;
        gb.set(i, DECK_DARK, 3.2, M_DECK, P_NONSKID);
    });
    const bw = Math.max(0.5, W * 0.1);
    for (const s of [-1, 1]) {
        const bx = cx + s * hull.hw((u0 + u1) / 2) * 0.6;
        circle(gb, bx, y1 - (y1 - y0) * 0.35, bw, METAL, 3.6, M_METAL, P_NONE, 0.5);
        b.rust.push([bx, y1 - (y1 - y0) * 0.35]);
    }
    rect(gb, cx - W * 0.22, y0 + (y1 - y0) * 0.55, cx + W * 0.22, y0 + (y1 - y0) * 0.75, METAL, 3.8, M_METAL, P_NONE, 0.3);
    hazard(gb, cx - hull.hw(u1) * 0.8, y1 - Math.max(0.6, W * 0.07), cx + hull.hw(u1) * 0.8, y1, 3.2, Math.max(0.6, W * 0.08));
    text(gb, reg, cx, y0 + (y1 - y0) * 0.3, Math.max(0.3, W * 0.055), WHITE_PAINT, 3.2);
}

/** A bridge block with wings, roof gear, copper roof trim, lit windows and the ship's positional lights. */
function bridge(b: Build, hull: Hull, u0: number, u1: number, half: number, wing: number, h: number, colour: Rgb, trim: boolean): { mastX: number; mastY: number } {
    const { gb } = b;
    const { cx } = hull;
    const y0 = hull.yAt(u0);
    const y1 = hull.yAt(u1);
    const edge = Math.max(0.5, half * 0.06);
    rect(gb, cx - half, y0, cx + half, y1, colour, h, M_PAINT, P_PLATE, 0.8);
    rect(gb, cx - wing, y0, cx + wing, y0 + Math.max(1.2, (y1 - y0) * 0.16), colour, h - 0.4, M_PAINT, P_PLATE, 0.4);
    // Roof deck inset.
    const rx = half - Math.max(1, half * 0.14);
    rect(gb, cx - rx, y0 + (y1 - y0) * 0.24, cx + rx, y1 - (y1 - y0) * 0.14, DECK_DARK, h + 1, M_DECK, P_NONSKID, 0.4);
    if (trim) {
        gb.each(cx - rx, y0 + (y1 - y0) * 0.24, cx + rx, y1 - (y1 - y0) * 0.14, (i, x, y) => {
            const e = Math.min(x - (cx - rx), cx + rx - x, y - (y0 + (y1 - y0) * 0.24), y1 - (y1 - y0) * 0.14 - y);
            if (e < edge * 0.7) gb.set(i, COPPER, h + 1.1, M_COPPER);
        });
    }
    // Vents and a small radar pole.
    const vw = Math.max(0.5, half * 0.1);
    for (const s of [-1, 1]) rect(gb, cx + s * rx * 0.55 - vw, y1 - (y1 - y0) * 0.4, cx + s * rx * 0.55 + vw, y1 - (y1 - y0) * 0.26, METAL, h + 1.6, M_METAL, P_GRATE, 0.2);
    const mastX = cx;
    const mastY = y0 + (y1 - y0) * 0.42;
    circle(gb, mastX, mastY, Math.max(0.5, half * 0.09), METAL, h + 4, M_METAL, P_NONE, 0.6);
    glyph(gb, cx, y0 + (y1 - y0) * 0.66, Math.max(0.9, half * 0.2), COPPER);
    // Windows along the front edge and down the sides.
    const step = Math.max(1, b.S * 0.0055);
    for (let x = cx - half + step * 0.6; x <= cx + half - step * 0.4; x += step) light(b, x, y0 + 0.35, 'window');
    for (let y = y0 + step * 1.6; y < y1 - step * 0.4; y += step * 1.3) {
        light(b, cx - half + 0.3, y, 'window');
        light(b, cx + half - 0.3, y, 'window');
    }
    // Sidelights on the wing tips (red to port = −x, green to starboard), masthead white.
    light(b, cx - wing + 0.35, y0 + 0.6, 'port');
    light(b, cx + wing - 0.35, y0 + 0.6, 'starboard');
    light(b, mastX, mastY, 'white');
    return { mastX, mastY };
}

function funnel(b: Build, hull: Hull, u0: number, u1: number, half: number, h: number): void {
    const { gb } = b;
    const y0 = hull.yAt(u0);
    const y1 = hull.yAt(u1);
    rect(gb, hull.cx - half, y0, hull.cx + half, y1, TURQ, h, M_PAINT, P_NONE, 0.7);
    rect(gb, hull.cx - half, (y0 + y1) / 2 - Math.max(0.4, (y1 - y0) * 0.1), hull.cx + half, (y0 + y1) / 2 + Math.max(0.4, (y1 - y0) * 0.1), COPPER, h + 0.05, M_COPPER);
    rect(gb, hull.cx - half * 0.6, y0 + (y1 - y0) * 0.2, hull.cx + half * 0.6, y1 - (y1 - y0) * 0.2, BLACK, h - 1.5, M_METAL);
}

/** Engine deck: vents with slats, pipe runs, a hazard edge on the transom, the stern light. */
function engineDeck(b: Build, hull: Hull, u0: number): void {
    const { gb } = b;
    const { cx, W } = hull;
    const y0 = hull.yAt(u0);
    const y1 = hull.yAt(0.995);
    const pw = Math.max(0.35, W * 0.05);
    for (const s of [-0.55, -0.2, 0.2, 0.55]) seg(gb, cx + s * W, y0, cx + s * W, y1 - pw * 2, pw, s < 0 ? COPPER : METAL, 2.6, s < 0 ? M_COPPER : M_METAL, 0.6);
    seg(gb, cx - W * 0.6, y0 + (y1 - y0) * 0.35, cx + W * 0.6, y0 + (y1 - y0) * 0.35, pw, METAL, 2.8, M_METAL, 0.6);
    const vx = W * 0.14;
    for (const s of [-1, 1]) rect(gb, cx + s * W * 0.38 - vx, y0 + (y1 - y0) * 0.55, cx + s * W * 0.38 + vx, y0 + (y1 - y0) * 0.8, BLACK, 2.2, M_METAL, P_GRATE);
    hazard(gb, cx - hull.hw(0.99) * 0.85, y1 - Math.max(0.6, W * 0.06), cx + hull.hw(0.99) * 0.85, y1, 2.4, Math.max(0.6, W * 0.07));
    light(b, cx, hull.yAt(0.992), 'white');
}

/** Stern thruster marks (pure-blue runs just inside the transom): one on small hulls, two on bigger ones. */
function sternThrusters(b: Build, hull: Hull): void {
    const sy = Math.floor(hull.bowY + hull.L) - 2;
    const hw = hull.hw(0.985);
    const S = b.S;
    b.thrusters.push(
        ...(b.spec.bucket <= 1
            ? ([[Math.round(S / 2 - hw * 0.35), Math.round(S / 2 + hw * 0.35), sy]] as [number, number, number][])
            : ([
                  [Math.round(S / 2 - hw * 0.7), Math.round(S / 2 - hw * 0.25), sy],
                  [Math.round(S / 2 + hw * 0.25), Math.round(S / 2 + hw * 0.7), sy],
              ] as [number, number, number][])),
    );
}

/** A stack of containers in one slot: corrugated roof, darker door ends, a per-box colour variation. */
function container(b: Build, x0: number, y0: number, x1: number, y1: number, c: Rgb, stack: number): void {
    const { gb, rng } = b;
    const v = 0.88 + rng() * 0.24;
    const col: Rgb = [c[0] * v, c[1] * v, c[2] * v];
    const h = 3 + stack * 1.25;
    const pitch = Math.max(0.5, (x1 - x0) * 0.14);
    gb.each(x0, y0, x1, y1, (i, x, y) => {
        const e = Math.min(x - x0, x1 - x, y - y0, y1 - y);
        const cor = Math.sin(((y - y0) / pitch) * 2 * Math.PI);
        gb.set(i, col, h + 0.12 * cor - 0.5 * Math.max(0, 1 - e / 0.35), M_CONTAINER);
        if (y - y0 < 0.3 || y1 - y < 0.3) gb.mul(i, 0.62);
        else gb.mul(i, 0.95 + 0.05 * cor);
    });
}

/** A gantry crane spanning the deck: two lattice girders, legs with hazard caps, a trolley cab, floodlights. */
function gantry(b: Build, cx: number, y: number, span: number, gap: number): void {
    const { gb, rng } = b;
    const t = Math.max(0.45, gap * 0.2);
    for (const s of [-1, 1]) rect(gb, cx - span, y + s * gap * 0.3 - t, cx + span, y + s * gap * 0.3 + t, OCHRE, 13, M_METAL, P_LATTICE);
    const leg = Math.max(0.8, gap * 0.36);
    for (const s of [-1, 1]) {
        rect(gb, cx + s * span - leg, y - gap * 0.45, cx + s * span + leg, y + gap * 0.45, OCHRE, 13.4, M_METAL, P_NONE, 0.3);
        hazard(gb, cx + s * span - leg, y - gap * 0.45, cx + s * span + leg, y - gap * 0.2, 13.5, Math.max(0.4, leg * 0.5));
        light(b, cx + s * span, y + gap * 0.3, 'flood');
        b.rust.push([cx + s * span, y + gap * 0.45]);
    }
    const tx = cx + (rng() - 0.5) * span;
    rect(gb, tx - gap * 0.5, y - gap * 0.42, tx + gap * 0.5, y + gap * 0.42, TURQ_LIGHT, 14.2, M_PAINT, P_NONE, 0.3);
    light(b, tx, y - gap * 0.3, 'window');
}

function buildTreasure(b: Build): void {
    const { gb, S, spec, rng } = b;
    const L = S * 0.9;
    const W = L * 0.118;
    const hull = roundedHull(S / 2, S * 0.05, L, W, 0.16, 0.1);
    const { cx } = hull;
    paintHull(b, hull, TURQ, DECK, true, P_PLATE, 0.9);
    forecastle(b, hull, 0.025, 0.105, `OC-${10 + spec.bucket * 7}`);
    // Container blocks: `containerColumns` across, two bays per block, lashing gaps between blocks.
    const nc = spec.containerColumns;
    const usable = W * 0.84;
    const cw = (2 * usable) / nc;
    const cl = cw * 2.4;
    const gap = Math.max(3.6, cw * 0.62);
    const yEnd = hull.yAt(0.765);
    const gaps: number[] = [];
    let y = hull.yAt(0.125);
    let block = 0;
    while (y + 2 * cl + 0.2 <= yEnd) {
        const groupColour: number[] = [];
        for (let g = 0; g < Math.ceil(nc / 3); g++) groupColour.push(Math.floor(rng() * CONTAINERS.length));
        for (let c = 0; c < nc; c++) {
            const bias = 1 - Math.abs(c - (nc - 1) / 2) / (nc / 2);
            const stack = Math.max(1, Math.min(5, Math.round(1.6 + 2.4 * bias + rng() * 1.4 - 0.4)));
            for (let bay = 0; bay < 2; bay++) {
                const x0 = cx - usable + c * cw + 0.12;
                const y0 = y + bay * (cl + 0.2);
                if (rng() < 0.04) {
                    rect(gb, x0, y0, x0 + cw - 0.24, y0 + cl, DECK_DARK, 2.2, M_METAL, P_GRATE);
                    continue;
                }
                const ci = rng() < 0.8 ? groupColour[Math.floor(c / 3)] : Math.floor(rng() * CONTAINERS.length);
                container(b, x0, y0 + 0.06, x0 + cw - 0.24, y0 + cl - 0.06, CONTAINERS[ci], stack - (bay === 1 && rng() < 0.3 ? 1 : 0));
            }
        }
        y += 2 * cl + 0.4;
        gaps.push(y + gap / 2);
        y += gap;
        block++;
        if (block > 20) break;
    }
    // Deck floodlights along the rails.
    for (let u = 0.15; u < 0.76; u += 0.09) {
        light(b, cx - hull.hw(u) + 0.5, hull.yAt(u), 'flood');
        light(b, cx + hull.hw(u) - 0.5, hull.yAt(u), 'flood');
    }
    for (let g = 0; g < spec.gantries && gaps.length > 0; g++) {
        const k = Math.min(gaps.length - 1, Math.round(((g + 1) * gaps.length) / (spec.gantries + 1)) - 1);
        gantry(b, cx, gaps[Math.max(0, k)], W * 1.02, gap);
    }
    // Docking hatches on both flanks, hazard-striped.
    for (const s of [-1, 1]) {
        const hx = cx + s * (hull.hw(0.45) - Math.max(0.6, W * 0.06));
        hazard(gb, hx - Math.max(0.5, W * 0.05), hull.yAt(0.43), hx + Math.max(0.5, W * 0.05), hull.yAt(0.47), 2.5, Math.max(0.5, W * 0.05));
        b.rust.push([hx, hull.yAt(0.47)]);
    }
    const br = bridge(b, hull, 0.775, 0.845, W * 0.92, W * 1.18, 16, TURQ_LIGHT, true);
    void br;
    funnel(b, hull, 0.855, 0.895, W * 0.32, 18);
    engineDeck(b, hull, 0.905);
    // Jet-fan thruster pods on the rear quarters: pylon, nacelle, fan face (animated part), heat-stained nozzle.
    const nr = W * 0.3;
    const yA = hull.yAt(0.78);
    const yB = hull.yAt(0.975);
    for (const s of [-1, 1]) {
        const px = cx + s * (W + nr * 1.3);
        rect(gb, Math.min(cx + s * W * 0.9, px), (yA + yB) / 2 - nr * 0.45, Math.max(cx + s * W * 0.9, px), (yA + yB) / 2 + nr * 0.45, TURQ_DARK, 5, M_PAINT, P_PLATE, 0.4);
        b.rust.push([px - s * nr, (yA + yB) / 2 + nr * 0.45]);
        seg(gb, px, yA + nr, px, yB - nr * 0.2, nr, ENGINE, 5.5, M_METAL, 3.2, P_PLATE);
        gb.each(px - nr, yA, px + nr, yB, (i, x, yy) => {
            if (gb.mat[i] !== M_METAL) return;
            const t = (yy - yA) / (yB - yA);
            if (Math.abs(t - 0.34) < 0.03) gb.set(i, COPPER, gb.hgt[i] + 0.05, M_COPPER);
            else if (t > 0.42 && t < 0.62) gb.tint(i, TURQ, 0.8);
            else if (t > 0.8) gb.tint(i, HEAT, 0.35 + 0.5 * ((t - 0.8) / 0.2));
            void x;
        });
        circle(gb, px, yA + nr, nr * 0.98, METAL, 8.4, M_METAL, P_NONE, 0.6);
        fanFace(gb, px, yA + nr, nr * 0.84, 8.6, s);
        b.parts.push({ kind: 'fan', x: px, y: yA + nr, r: nr * 0.84, spin: 0.9 * s });
        circle(gb, px, yB - nr * 0.1, nr * 0.62, BLACK, 5, M_METAL);
        b.thrusters.push([Math.round(px - nr * 0.45), Math.round(px + nr * 0.45), Math.floor(yB) - 1]);
        light(b, px + s * nr * 0.85, yB - nr * 0.3, 'strobe');
        light(b, px + s * nr * 0.85, yA + nr * 0.4, s < 0 ? 'port' : 'starboard');
    }
}

/** A static fan face (the animated part covers it when drawn): blades, spinner. */
function fanFace(gb: GBuf, cx: number, cy: number, r: number, h: number, dir: number): void {
    gb.each(cx - r, cy - r, cx + r, cy + r, (i, x, y) => {
        const d = Math.hypot(x - cx, y - cy);
        if (d > r) return;
        if (d < r * 0.28) {
            gb.set(i, COPPER, h + 0.8 * Math.sqrt(1 - (d / (r * 0.28)) ** 2), M_COPPER);
            return;
        }
        const a = Math.atan2(y - cy, x - cx) + dir * 0.6 * (d / r);
        const f = ((a / (2 * Math.PI)) * 18 + 18) % 1;
        gb.set(i, f < 0.55 ? METAL : BLACK, h - (f < 0.55 ? 0.1 * f : 0.6), M_METAL);
    });
}

function buildFreighter(b: Build): void {
    const { gb, S, spec, rng } = b;
    const L = S * 0.88;
    const W = L * 0.1;
    const hull = roundedHull(S / 2, S * 0.06, L, W, 0.15, 0.12);
    const { cx } = hull;
    paintHull(b, hull, TURQ, DECK, true, P_PLATE, 0.9);
    forecastle(b, hull, 0.02, 0.1, `OC-${3 + spec.bucket * 5}`);
    const n = spec.hatches;
    const pitch = (0.6 * L) / n;
    for (let k = 0; k < n; k++) {
        const yc = hull.yAt(0.13) + pitch * (k + 0.5);
        const hl = pitch * 0.4;
        const hw = W * 0.74;
        rect(gb, cx - hw - 0.6, yc - hl - 0.6, cx + hw + 0.6, yc + hl + 0.6, DECK_DARK, 2.8, M_METAL, P_NONE, 0.3);
        gb.each(cx - hw, yc - hl, cx + hw, yc + hl, (i, x, y) => {
            const fold = Math.abs(((y - (yc - hl)) / (2 * hl)) * 3 - Math.round(((y - (yc - hl)) / (2 * hl)) * 3)) < 0.03;
            const rib = Math.sin(((x - cx) / Math.max(0.6, W * 0.08)) * Math.PI);
            const e = Math.min(x - (cx - hw), cx + hw - x, y - (yc - hl), yc + hl - y);
            gb.set(i, HATCH, 3.6 + 0.12 * rib - (fold ? 0.4 : 0) - 0.5 * Math.max(0, 1 - e / 0.4), M_PAINT);
            if (fold) gb.mul(i, 0.7);
        });
        b.rust.push([cx - hw, yc + hl], [cx + hw, yc + hl]);
        if (spec.bucket >= 2 && k < n - 1) {
            const s = k % 2 === 0 ? -1 : 1;
            const py = yc + pitch / 2;
            circle(gb, cx + s * W * 0.25, py, W * 0.2, OCHRE, 5, M_METAL, P_NONE, 0.6);
            seg(gb, cx + s * W * 0.25, py, cx - s * W * 1.02, py - pitch * 0.35, Math.max(0.35, W * 0.05), OCHRE, 6.5, M_METAL, 0.4, P_LATTICE);
            light(b, cx - s * W * 1.02, py - pitch * 0.35, 'flood');
        }
    }
    // A few containers aft of the holds.
    const cw = (W * 1.4) / 4;
    for (let c = 0; c < 4; c++) {
        for (let bay = 0; bay < 2; bay++) {
            const x0 = cx - W * 0.7 + c * cw + 0.1;
            const y0 = hull.yAt(0.735) + bay * cw * 1.25;
            container(b, x0, y0, x0 + cw - 0.2, y0 + cw * 1.2, CONTAINERS[Math.floor(rng() * CONTAINERS.length)], 1 + Math.floor(rng() * 2));
        }
    }
    bridge(b, hull, 0.8, 0.855, W * 0.8, W * 1.06, 12, TURQ_LIGHT, true);
    funnel(b, hull, 0.865, 0.895, W * 0.28, 13.5);
    engineDeck(b, hull, 0.905);
    sternThrusters(b, hull);
}

function buildExplorer(b: Build): void {
    const { gb, S, spec } = b;
    const L = S * 0.84;
    const W = L * 0.086;
    const hull = roundedHull(S / 2, S * 0.08, L, W, 0.16, 0.08);
    const { cx } = hull;
    paintHull(b, hull, TURQ, DECK, true, P_PLATE, 0.9);
    circle(gb, cx, hull.yAt(0.075), W * 0.56, GLASS, 3, M_GLASS, P_NONE, 3);
    text(gb, `OC-${40 + spec.bucket}`, cx, hull.yAt(0.13), Math.max(0.3, W * 0.06), WHITE_PAINT, 2.4);
    const br = bridge(b, hull, 0.16, 0.29, W * 0.84, W * 1.06, 9, TURQ_LIGHT, true);
    void br;
    // Sensor mast with the turning dish.
    const my = hull.yAt(0.325);
    circle(gb, cx, my, W * 0.2, METAL, 12, M_METAL, P_NONE, 0.8);
    dishBaked(gb, cx, my, W * 0.72, 12.6);
    b.parts.push({ kind: 'dish', x: cx, y: my, r: W * 0.72, spin: 0.8 });
    light(b, cx, my, 'white');
    // Lab modules with roof gear and radiator panels.
    const mods: [number, number, number, number][] = [
        [0.37, 0.46, 0.8, 7],
        [0.47, 0.56, 0.66, 8.2],
        [0.57, 0.66, 0.78, 6.6],
    ];
    for (const [u0, u1, hwm, h] of mods) {
        rect(gb, cx - W * hwm, hull.yAt(u0), cx + W * hwm, hull.yAt(u1), TURQ_LIGHT, h, M_PAINT, P_PLATE, 0.6);
        rect(gb, cx - W * hwm * 0.6, hull.yAt(u0 + 0.015), cx + W * hwm * 0.6, hull.yAt(u1 - 0.015), METAL, h + 0.5, M_METAL, P_GRATE, 0.2);
        light(b, cx - W * hwm + 0.3, hull.yAt((u0 + u1) / 2), 'window');
        light(b, cx + W * hwm - 0.3, hull.yAt((u0 + u1) / 2), 'window');
        b.rust.push([cx - W * hwm, hull.yAt(u1)]);
    }
    seg(gb, cx + W * 0.5, hull.yAt(0.36), cx + W * 0.5, hull.yAt(0.66), Math.max(0.3, W * 0.05), COPPER, 9, M_COPPER, 0.4);
    // Landing pad with hazard ring and the Concord glyph.
    const py = hull.yAt(0.8);
    const pr = W * 0.78;
    circle(gb, cx, py, pr, DECK_DARK, 2.4, M_DECK, P_NONSKID);
    gb.each(cx - pr, py - pr, cx + pr, py + pr, (i, x, y) => {
        const d = Math.hypot(x - cx, y - py);
        if (d > pr || d < pr * 0.84) return;
        const k = Math.floor((Math.atan2(y - py, x - cx) / (2 * Math.PI)) * 24 + 24) & 1;
        gb.set(i, k === 0 ? HAZARD : BLACK, 2.4, M_PAINT);
    });
    glyph(gb, cx, py, pr * 0.55, WHITE_PAINT);
    for (let k = 0; k < 6; k++) light(b, cx + pr * 0.92 * Math.cos((k / 6) * 2 * Math.PI), py + pr * 0.92 * Math.sin((k / 6) * 2 * Math.PI), 'deck');
    engineDeck(b, hull, 0.92);
    sternThrusters(b, hull);
}

/** A baked radar dish (the animated part covers it when drawn): a slatted bar across the mast. */
function dishBaked(gb: GBuf, cx: number, cy: number, r: number, h: number): void {
    gb.each(cx - r, cy - r * 0.2, cx + r, cy + r * 0.2, (i, x, y) => {
        const dy = (y - cy) / (r * 0.2);
        if (Math.abs(dy) > 1) return;
        const slat = Math.abs(Math.sin(((x - cx) / Math.max(0.4, r * 0.12)) * Math.PI)) < 0.25;
        gb.set(i, slat ? GLASS : METAL, h + 0.6 * (1 - dy * dy), M_METAL);
    });
}

function buildConstruction(b: Build): void {
    const { gb, S, spec, rng } = b;
    const L = S * 0.8;
    const W = L * 0.13;
    const hull = roundedHull(S / 2, S * 0.1, L, W, 0.14, 0.2);
    const { cx } = hull;
    paintHull(b, hull, TURQ, DECK, true, P_GRATE, 0.9);
    text(gb, `OC-${70 + spec.bucket}`, cx, hull.yAt(0.06), Math.max(0.3, W * 0.05), WHITE_PAINT, 2.4);
    // Materials in a few containers.
    const cw = (W * 1.2) / 3;
    for (let c = 0; c < 3; c++) for (let bay = 0; bay < 2; bay++) {
        const x0 = cx - W * 0.6 + c * cw + 0.1;
        const y0 = hull.yAt(0.12) + bay * cw * 1.3;
        container(b, x0, y0, x0 + cw - 0.2, y0 + cw * 1.25, CONTAINERS[Math.floor(rng() * CONTAINERS.length)], 1 + Math.floor(rng() * 2));
    }
    // Truss frames with stacked beams, hazard-striped deck edges.
    const t0 = hull.yAt(0.38);
    const t1 = hull.yAt(0.66);
    const bw = Math.max(0.5, W * 0.07);
    for (const s of [-1, 1]) {
        rect(gb, cx + s * W * 0.72 - bw, t0, cx + s * W * 0.72 + bw, t1, OCHRE, 5, M_METAL, P_LATTICE);
        hazard(gb, cx + s * hull.hw(0.5) - s * Math.max(0.6, W * 0.06) - 0.4, t0, cx + s * hull.hw(0.5) - s * Math.max(0.6, W * 0.06) + 0.4, t1, 2.6, Math.max(0.5, W * 0.05));
    }
    for (let k = 0; k <= 3; k++) rect(gb, cx - W * 0.72, t0 + ((t1 - t0) * k) / 3 - bw, cx + W * 0.72, t0 + ((t1 - t0) * k) / 3 + bw, OCHRE, 5.2, M_METAL, P_LATTICE);
    for (let k = 0; k < 4; k++) seg(gb, cx - W * 0.5, t0 + (t1 - t0) * (0.12 + k * 0.08), cx + W * 0.5, t0 + (t1 - t0) * (0.12 + k * 0.08), Math.max(0.3, W * 0.04), METAL, 3.2, M_METAL, 0.4);
    // The big crane: pedestal, lattice boom swung out to port, hook block, tip floodlight.
    const px = cx + W * 0.35;
    const py = hull.yAt(0.3);
    const tx = cx - W * 1.9;
    const ty = hull.yAt(0.12);
    circle(gb, px, py, W * 0.26, OCHRE, 6, M_METAL, P_NONE, 0.8);
    seg(gb, px, py, tx, ty, Math.max(0.55, W * 0.085), OCHRE, 9, M_METAL, 0.5, P_LATTICE);
    rect(gb, tx - W * 0.12, ty - W * 0.12, tx + W * 0.12, ty + W * 0.12, METAL, 9.5, M_METAL, P_NONE, 0.2);
    hazard(gb, tx - W * 0.12, ty + W * 0.12, tx + W * 0.12, ty + W * 0.22, 9.4, Math.max(0.4, W * 0.04));
    light(b, tx, ty, 'flood');
    // Workshop, a small bridge.
    rect(gb, cx - W * 0.8, hull.yAt(0.68), cx + W * 0.8, hull.yAt(0.8), TURQ_LIGHT, 7, M_PAINT, P_PLATE, 0.6);
    for (let k = 0; k < 3; k++) rect(gb, cx - W * 0.55 + k * W * 0.4, hull.yAt(0.71), cx - W * 0.35 + k * W * 0.4, hull.yAt(0.76), METAL, 7.6, M_METAL, P_GRATE, 0.2);
    for (let x = cx - W * 0.7; x < cx + W * 0.7; x += Math.max(1, S * 0.0055)) light(b, x, hull.yAt(0.68) + 0.35, 'window');
    bridge(b, hull, 0.82, 0.88, W * 0.62, W * 0.9, 9, TURQ_LIGHT, true);
    engineDeck(b, hull, 0.9);
    sternThrusters(b, hull);
}

function buildWarship(b: Build): void {
    const { gb, S, spec } = b;
    const L = S * 0.9;
    const W = L * 0.078;
    const cx = S / 2;
    const bowY = S * 0.05;
    // Angular hull: piecewise-linear chines.
    const knots: [number, number][] = [
        [0, 0.04],
        [0.1, 0.52],
        [0.28, 0.9],
        [0.5, 1],
        [0.86, 0.97],
        [1, 0.86],
    ];
    const hw = (u: number): number => {
        if (u < 0 || u > 1) return 0;
        for (let k = 1; k < knots.length; k++) {
            if (u <= knots[k][0]) {
                const [u0, w0] = knots[k - 1];
                const [u1, w1] = knots[k];
                return W * (w0 + ((w1 - w0) * (u - u0)) / (u1 - u0));
            }
        }
        return W * knots[knots.length - 1][1];
    };
    const hull: Hull = { cx, bowY, L, W, hw, yAt: (u) => bowY + u * L };
    paintHull(b, hull, WAR_GREY, WAR_DECK, false, P_NONSKID, 2);
    // Knuckle crease along the flanks.
    gb.each(cx - W, bowY, cx + W, bowY + L, (i, x, y) => {
        const u = (y - bowY) / L;
        const h = hw(u);
        const d = Math.abs(Math.abs(x - cx) - h * 0.62);
        if (gb.mat[i] === 0 || d > 0.3) return;
        gb.hgt[i] += 0.35;
    });
    text(gb, `${17 + spec.bucket * 11}`, cx, hull.yAt(0.07), Math.max(0.3, W * 0.09), WHITE_PAINT, 2.4);
    // Turrets: faceted gun houses with barrels (forward; aft on bigger hulls).
    const turret = (u: number, dir: 1 | -1): void => {
        const ty = hull.yAt(u);
        const r = W * 0.48;
        const pts: [number, number][] = [];
        for (let k = 0; k < 6; k++) {
            const a = (k / 6) * 2 * Math.PI + Math.PI / 6;
            pts.push([cx + r * Math.cos(a), ty + r * Math.sin(a) * 1.1]);
        }
        const bl = Math.max(0.3, W * 0.06);
        for (const s of [-0.18, 0.18]) seg(gb, cx + s * r, ty, cx + s * r, ty - dir * W * 1.35, bl, METAL, 4.4, M_METAL, 0.4);
        poly(gb, pts, WAR_GREY_DARK, 4.2, M_PAINT, P_PLATE, 0.7);
        b.rust.push([cx - r * 0.8, ty + r * 0.5], [cx + r * 0.8, ty + r * 0.5]);
    };
    turret(0.17, 1);
    if (spec.turrets >= 2) turret(0.74, -1);
    // Missile cell blocks.
    const vls = (u0: number, u1: number): void => {
        const y0 = hull.yAt(u0);
        const y1 = hull.yAt(u1);
        const x0 = cx - W * 0.56;
        const x1 = cx + W * 0.56;
        const cell = Math.max(0.9, (x1 - x0) / 4);
        rect(gb, x0, y0, x1, y1, METAL, 2.6, M_METAL, P_NONE, 0.3);
        gb.each(x0, y0, x1, y1, (i, x, y) => {
            const fx = ((x - x0) / cell) % 1;
            const fy = ((y - y0) / cell) % 1;
            if (fx < 0.14 || fy < 0.14) {
                gb.hgt[i] -= 0.35;
                gb.mul(i, 0.6);
            }
        });
        b.rust.push([x0, y1], [x1, y1]);
    };
    vls(0.235, 0.3);
    if (spec.missileBlocks >= 2) vls(0.625, 0.68);
    // Bridge superstructure: faceted two-level block, copper trim on the bridge roof only.
    const p = (u: number, k: number): [number, number] => [cx + k * W, hull.yAt(u)];
    poly(gb, [p(0.34, -0.5), p(0.34, 0.5), p(0.4, 0.82), p(0.56, 0.82), p(0.58, 0.68), p(0.58, -0.68), p(0.56, -0.82), p(0.4, -0.82)], WAR_GREY, 8, M_PAINT, P_PLATE, 0.9);
    const upper: [number, number][] = [p(0.37, -0.36), p(0.37, 0.36), p(0.41, 0.56), p(0.5, 0.56), p(0.5, -0.56), p(0.41, -0.56)];
    poly(gb, upper, WAR_GREY_DARK, 10.5, M_PAINT, P_PLATE, 0.7);
    gb.each(cx - W * 0.6, hull.yAt(0.365), cx + W * 0.6, hull.yAt(0.505), (i, x, y) => {
        if (gb.hgt[i] < 10) return;
        let e = Infinity;
        for (let k = 0, m = upper.length - 1; k < upper.length; m = k++) e = Math.min(e, segDist(x, y, upper[k][0], upper[k][1], upper[m][0], upper[m][1]));
        if (e < 0.4) gb.set(i, COPPER, 10.6, M_COPPER);
    });
    for (let x = cx - W * 0.32; x <= cx + W * 0.32; x += Math.max(0.9, S * 0.005)) light(b, x, hull.yAt(0.372), 'window');
    // Sensor mast: pole, yardarm with strobes at its tips, the turning dish, masthead light.
    const my = hull.yAt(0.45);
    circle(gb, cx, my, W * 0.16, METAL, 14, M_METAL, P_NONE, 0.6);
    seg(gb, cx - W * 0.72, my + W * 0.25, cx + W * 0.72, my + W * 0.25, Math.max(0.3, W * 0.045), METAL, 13.4, M_METAL, 0.3);
    dishBaked(gb, cx, my, W * 0.55, 14.6);
    b.parts.push({ kind: 'dish', x: cx, y: my, r: W * 0.55, spin: 0.6 });
    light(b, cx - W * 0.72, my + W * 0.25, 'strobe');
    light(b, cx + W * 0.72, my + W * 0.25, 'strobe');
    light(b, cx, my - W * 0.2, 'white');
    light(b, cx - W * 0.82, hull.yAt(0.47), 'port');
    light(b, cx + W * 0.82, hull.yAt(0.47), 'starboard');
    // Hangar with a hazard-striped door, helicopter deck with markings.
    rect(gb, cx - W * 0.7, hull.yAt(0.59), cx + W * 0.7, hull.yAt(0.715), WAR_GREY, 6, M_PAINT, P_PLATE, 0.7);
    hazard(gb, cx - W * 0.5, hull.yAt(0.705), cx + W * 0.5, hull.yAt(0.715), 6, Math.max(0.4, W * 0.06));
    b.rust.push([cx - W * 0.5, hull.yAt(0.715)], [cx + W * 0.5, hull.yAt(0.715)]);
    const hy = hull.yAt(0.86);
    const hr = W * 0.56;
    gb.each(cx - hr, hy - hr, cx + hr, hy + hr, (i, x, y) => {
        const d = Math.hypot(x - cx, y - hy);
        if (Math.abs(d - hr * 0.85) < 0.3 || (Math.abs(x - cx) < 0.25 && d < hr * 0.85)) gb.tint(i, WHITE_PAINT, 0.8);
    });
    for (let k = 0; k < 6; k++) light(b, cx + hr * Math.cos((k / 6) * 2 * Math.PI), hy + hr * Math.sin((k / 6) * 2 * Math.PI), 'deck');
    text(gb, `${17 + spec.bucket * 11}`, cx, hull.yAt(0.955), Math.max(0.25, W * 0.06), WHITE_PAINT, 2.4);
    light(b, cx, hull.yAt(0.992), 'white');
    // Rust from the rail, all along both flanks.
    for (let u = 0.08; u < 0.97; u += 0.035) for (const s of [-1, 1]) b.rust.push([cx + s * (hw(u) - 0.5), hull.yAt(u)]);
    sternThrusters(b, hull);
}

function buildBase(b: Build): void {
    const { gb, S, spec, rng } = b;
    const port = spec.kind === 'port';
    const c = S / 2;
    const ringR = S * (port ? 0.33 : 0.3);
    const ringW = S * 0.035;
    const hubR = S * (port ? 0.14 : 0.12);
    // Spokes with pipe runs.
    const spokes = port ? 6 : 4;
    for (let k = 0; k < spokes; k++) {
        const a = (k / spokes) * 2 * Math.PI + Math.PI / spokes;
        const ax = Math.cos(a);
        const ay = Math.sin(a);
        seg(gb, c + ax * hubR, c + ay * hubR, c + ax * ringR, c + ay * ringR, S * 0.012, METAL, 3.6, M_METAL, 0.8, P_PLATE);
        const nx = -ay * S * 0.017;
        const ny = ax * S * 0.017;
        seg(gb, c + ax * hubR + nx, c + ay * hubR + ny, c + ax * ringR + nx, c + ay * ringR + ny, S * 0.004, COPPER, 3.4, M_COPPER, 0.5);
    }
    // Fuel tanks between the spokes, piped to the hub.
    for (let k = 0; k < spec.tanks; k++) {
        const a = ((k + 0.5) / spec.tanks) * 2 * Math.PI + 0.3;
        const r = (hubR + ringR) / 2;
        const tr = S * (port ? 0.034 : 0.045);
        const tx = c + r * Math.cos(a);
        const ty = c + r * Math.sin(a);
        seg(gb, c + hubR * Math.cos(a), c + hubR * Math.sin(a), tx, ty, S * 0.004, METAL, 3, M_METAL, 0.5);
        const col = [TURQ_LIGHT, WHITE_PAINT, COPPER][k % 3];
        circle(gb, tx, ty, tr, col, 4, k % 3 === 2 ? M_COPPER : M_PAINT, P_NONE, 5);
        ring(gb, tx, ty, tr * 0.46, tr * 0.54, METAL, 8.4, M_METAL);
        b.rust.push([tx, ty + tr]);
    }
    // The ring: plated segments, copper trim lines, lit windows.
    gb.each(c - ringR - ringW, c - ringR - ringW, c + ringR + ringW, c + ringR + ringW, (i, x, y) => {
        const d = Math.hypot(x - c, y - c);
        const t = (d - ringR) / ringW;
        if (Math.abs(t) > 1) return;
        const hgt = 5 + 1.2 * Math.sqrt(Math.max(0, 1 - t * t));
        if (Math.abs(Math.abs(t) - 0.72) < 0.07) gb.set(i, COPPER, hgt, M_COPPER);
        else gb.set(i, Math.abs(t) < 0.4 ? DECK : TURQ, hgt, Math.abs(t) < 0.4 ? M_DECK : M_PAINT, P_PLATE);
    });
    const wn = Math.round((2 * Math.PI * ringR) / Math.max(1.4, S * 0.009));
    for (let k = 0; k < wn; k++) {
        const a = (k / wn) * 2 * Math.PI;
        if (hash2(k, 7) < 0.3) continue;
        light(b, c + (ringR + ringW * 0.86) * Math.cos(a), c + (ringR + ringW * 0.86) * Math.sin(a), 'window');
    }
    // Docking arms with hazard-striped ends, cradles, gantries over the ring and floodlights.
    for (let k = 0; k < spec.docks; k++) {
        const a = (k / spec.docks) * 2 * Math.PI;
        const ax = Math.cos(a);
        const ay = Math.sin(a);
        const r0 = ringR + ringW * 0.8;
        const r1 = ringR + S * 0.12;
        const w = S * 0.011;
        seg(gb, c + ax * r0, c + ay * r0, c + ax * r1, c + ay * r1, w, TURQ_DARK, 4.4, M_PAINT, 0.6, P_PLATE);
        gb.each(c + ax * r1 - w * 4, c + ay * r1 - w * 4, c + ax * r1 + w * 4, c + ay * r1 + w * 4, (i, x, y) => {
            const along = (x - c) * ax + (y - c) * ay;
            const across = -(x - c) * ay + (y - c) * ax;
            if (along < r1 - (r1 - r0) * 0.25 || along > r1 + w || Math.abs(across) > w) return;
            gb.set(i, Math.floor((along + across) / Math.max(0.5, w * 0.8)) & 1 ? HAZARD : BLACK, 4.6, M_PAINT);
        });
        for (const s of [-1, 1]) seg(gb, c + ax * r1 - ay * s * w * 2.2, c + ay * r1 + ax * s * w * 2.2, c + ax * (r1 + w * 3) - ay * s * w * 2.2, c + ay * (r1 + w * 3) + ax * s * w * 2.2, w * 0.4, METAL, 4.4, M_METAL, 0.3);
        light(b, c + ax * (r1 + w * 3.4), c + ay * (r1 + w * 3.4), 'flood');
        const gx = c + ax * ringR;
        const gy = c + ay * ringR;
        seg(gb, gx - ay * S * 0.05, gy + ax * S * 0.05, gx + ay * S * 0.05, gy - ax * S * 0.05, S * 0.006, OCHRE, 10, M_METAL, 0.3, P_LATTICE);
        b.rust.push([c + ax * r1, c + ay * r1]);
    }
    if (port) {
        for (const a of [0.9, 3.9]) {
            const ax = Math.cos(a);
            const ay = Math.sin(a);
            circle(gb, c + ax * ringR, c + ay * ringR, S * 0.016, OCHRE, 7, M_METAL, P_NONE, 0.8);
            seg(gb, c + ax * ringR, c + ay * ringR, c + ax * (ringR + S * 0.1) - ay * S * 0.04, c + ay * (ringR + S * 0.1) + ax * S * 0.04, S * 0.005, OCHRE, 9, M_METAL, 0.3, P_LATTICE);
        }
    }
    // Hub: plated drum, copper trim ring, roof with radiator panels, a tower with the turning dish, window ring.
    circle(gb, c, c, hubR, TURQ_LIGHT, 8, M_PAINT, P_PLATE, 2);
    ring(gb, c, c, hubR * 0.93, hubR * 0.97, COPPER, 9.4, M_COPPER);
    circle(gb, c, c, hubR * 0.62, DECK_DARK, 11, M_DECK, P_NONSKID, 0.6);
    for (let k = 0; k < 4; k++) {
        const a = (k / 4) * 2 * Math.PI + Math.PI / 4;
        const px = c + hubR * 0.4 * Math.cos(a);
        const py = c + hubR * 0.4 * Math.sin(a);
        rect(gb, px - hubR * 0.12, py - hubR * 0.12, px + hubR * 0.12, py + hubR * 0.12, METAL, 11.6, M_METAL, P_GRATE, 0.2);
    }
    circle(gb, c, c, S * 0.022, METAL, 15, M_METAL, P_NONE, 1);
    dishBaked(gb, c, c, S * 0.045, 16.2);
    b.parts.push({ kind: 'dish', x: c, y: c, r: S * 0.045, spin: 0.45 });
    glyph(gb, c, c + hubR * 0.4, hubR * 0.16, COPPER);
    const hn = Math.round((2 * Math.PI * hubR) / Math.max(1.2, S * 0.008));
    for (let k = 0; k < hn; k++) {
        if (rng() < 0.25) continue;
        const a = (k / hn) * 2 * Math.PI;
        light(b, c + hubR * 0.86 * Math.cos(a), c + hubR * 0.86 * Math.sin(a), 'window');
    }
    light(b, c, c - S * 0.03, 'white');
}

// ---------------------------------------------------------------------------------------------------------------
// Detail passes and lighting
// ---------------------------------------------------------------------------------------------------------------

/** Plating seams (grooves) and weld beads, rivet rows, gratings, lattices, grain and grime blotches. */
function surfaceDetail(b: Build): void {
    const { gb, S, spec } = b;
    const { n, ss } = gb;
    const k240 = 240 / S;
    const grain = valueNoise(29);
    const grime = valueNoise(53);
    const plateW = Math.max(2.4, S * 0.03);
    const plateH = plateW * 1.9;
    const seamW = 0.28;
    const rivetR = 0.22;
    const rivetSp = 0.95;
    for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
            const c = j * n + i;
            const m = gb.mat[c];
            if (m === 0 || m === M_LIGHT) continue;
            const x = (i + 0.5) / ss;
            const y = (j + 0.5) / ss;
            const p = gb.pat[c];
            if (p === P_PLATE) {
                const row = Math.floor(y / plateH);
                const xo = (row & 1) * plateW * 0.5;
                const col = Math.floor((x + xo) / plateW);
                const fx = x + xo - col * plateW;
                const fy = y - row * plateH;
                const weld = hash2(row, col) < 0.3;
                if (fy < seamW || fx < seamW) {
                    if (weld) {
                        gb.hgt[c] += 0.12;
                        gb.mul(c, 1.07);
                    } else {
                        gb.hgt[c] -= 0.3;
                        gb.mul(c, 0.72);
                    }
                } else {
                    const ry = Math.min(Math.abs(fy - (seamW + 0.45)), Math.abs(fy - (plateH - 0.45)));
                    const rx = Math.abs(((fx % rivetSp) + rivetSp) % rivetSp - rivetSp / 2);
                    if (!weld && Math.hypot(rx, ry) < rivetR) {
                        gb.hgt[c] += 0.16;
                        gb.mul(c, 1.08);
                    }
                }
            } else if (p === P_GRATE) {
                if (((x / 0.8) % 1) < 0.3 || ((y / 0.8) % 1) < 0.3) {
                    gb.hgt[c] -= 0.15;
                    gb.mul(c, 0.72);
                }
            } else if (p === P_LATTICE) {
                const a = (((x + y) / 1.5) % 1 + 1) % 1;
                const d = (((x - y) / 1.5) % 1 + 1) % 1;
                if (a > 0.3 && d > 0.3) {
                    gb.hgt[c] -= 1.2;
                    gb.mul(c, 0.4);
                }
            }
            const X = x * k240;
            const Y = y * k240;
            const g = 1 + (p === P_NONSKID ? 0.16 : 0.09) * fbm2(grain, X * 1.4, Y * 1.4) + 0.07 * fbm2(grain, X * 0.25 + 17, Y * 0.25);
            const blot = smooth01(0.6, 0.8, grime(X * 0.11, Y * 0.11));
            gb.mul(c, g * (1 - 0.2 * blot * spec.weathering));
        }
    }
}

/** Scratches (short bright strokes of bare metal), rust streaks bleeding aft from sources, salt staining (warships). */
function weathering(b: Build): void {
    const { gb, S, spec, rng } = b;
    const w = spec.weathering;
    const paintable = (i: number): boolean => {
        const m = gb.mat[i];
        return m === M_PAINT || m === M_DECK || m === M_METAL;
    };
    const scratches = Math.round(S * 0.5 * w);
    for (let k = 0; k < scratches; k++) {
        const x = rng() * S;
        const y = rng() * S;
        const ci = Math.floor(y * gb.ss) * gb.n + Math.floor(x * gb.ss);
        if (!paintable(ci)) continue;
        const a = Math.PI / 2 + (rng() - 0.5) * 1.2;
        const len = 0.8 + rng() * 3.5;
        const x1 = x + Math.cos(a) * len;
        const y1 = y + Math.sin(a) * len;
        gb.each(Math.min(x, x1) - 0.3, Math.min(y, y1) - 0.3, Math.max(x, x1) + 0.3, Math.max(y, y1) + 0.3, (i, px, py) => {
            if (!paintable(i) || segDist(px, py, x, y, x1, y1) > 0.18) return;
            gb.tint(i, BARE, 0.4);
        });
    }
    // Rust: the builders' sources plus random rivet points on painted plating.
    const sources = b.rust.slice();
    const extra = Math.round(S * 0.25 * w);
    for (let k = 0; k < extra * 4 && sources.length < b.rust.length + extra; k++) {
        const x = rng() * S;
        const y = rng() * S;
        const ci = Math.floor(y * gb.ss) * gb.n + Math.floor(x * gb.ss);
        if (gb.mat[ci] === M_PAINT && gb.pat[ci] === P_PLATE) sources.push([x, y]);
    }
    for (const [sx, sy] of sources) {
        if (rng() > Math.min(1, 0.55 * w + 0.2)) continue;
        const len = (2 + rng() * 7) * Math.min(1.6, w) * (S / 240);
        const wd = 0.3 + rng() * 0.6;
        const ph = rng() * 6;
        gb.each(sx - wd - 1, sy, sx + wd + 1, sy + len, (i, x, y) => {
            if (!paintable(i)) return;
            const t = (y - sy) / len;
            const xc = sx + 0.3 * Math.sin(t * 5 + ph);
            const d = Math.abs(x - xc) / (wd * (1 - 0.5 * t));
            if (d > 1) return;
            gb.tint(i, RUST, Math.min(0.85, 0.7 * Math.pow(1 - t, 1.4) * (1 - d * d) * Math.min(1.3, w)));
        });
    }
    if (spec.kind === 'warship') {
        const salt = valueNoise(71);
        gb.each(0, 0, S, S, (i, x, y) => {
            if (!paintable(i)) return;
            const v = smooth01(0.55, 0.75, fbm2(salt, x * 0.18, y * 0.05) + 0.5);
            if (v > 0) gb.tint(i, SALT, 0.28 * v * Math.min(1, w));
        });
    }
}

/** Paints the lights as small emissive dots (the overlay adds their halo / blink). */
function paintLights(b: Build): void {
    for (const l of b.lights) {
        const c = LIGHT_COLOUR[l.kind];
        const dim = l.kind === 'strobe' ? 0.55 : 1;
        b.gb.each(l.x - l.r, l.y - l.r, l.x + l.r, l.y + l.r, (i, x, y) => {
            if (Math.hypot(x - l.x, y - l.y) > l.r) return;
            b.gb.set(i, [c[0] * dim, c[1] * dim, c[2] * dim], b.gb.hgt[i] + 0.2, M_LIGHT);
        });
    }
}

/**
 * Lighting: normals from the height field, Lambert + ambient from CONCORD_LIGHT, cast shadows (march toward the light
 * over the height field), soft ambient occlusion from taller neighbours, a Blinn glint on metal / copper / glass.
 * Returns the downsampled RGBA and which pixels are mostly light.
 */
function shade(gb: GBuf): { rgba: Uint8ClampedArray; lightPx: number[] } {
    const { n, ss, side } = gb;
    const h = gb.hgt;
    const out = new Float32Array(n * n * 3);
    const L = CONCORD_LIGHT;
    const lxy = Math.hypot(L[0], L[1]);
    const dx = L[0] / lxy;
    const dy = L[1] / lxy;
    const rise = L[2] / lxy; // height gained per px toward the light
    const maxSteps = Math.ceil(22 * ss);
    const hAt = (i: number, j: number): number => (i < 0 || j < 0 || i >= n || j >= n ? 0 : h[j * n + i]);
    const aoDirs: [number, number][] = [];
    for (let k = 0; k < 8; k++) aoDirs.push([Math.cos((k / 8) * 2 * Math.PI), Math.sin((k / 8) * 2 * Math.PI)]);
    for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
            const c = j * n + i;
            const m = gb.mat[c];
            if (m === 0) continue;
            const r = gb.alb[c * 3];
            const g = gb.alb[c * 3 + 1];
            const bl = gb.alb[c * 3 + 2];
            if (m === M_LIGHT) {
                out[c * 3] = r;
                out[c * 3 + 1] = g;
                out[c * 3 + 2] = bl;
                continue;
            }
            const h0 = h[c];
            const gx = ((hAt(i + 1, j) - hAt(i - 1, j)) * ss) / 2;
            const gy = ((hAt(i, j + 1) - hAt(i, j - 1)) * ss) / 2;
            const nn = norm3(-Math.max(-4, Math.min(4, gx)) * 0.8, -Math.max(-4, Math.min(4, gy)) * 0.8, 1);
            const diff = Math.max(0, nn[0] * L[0] + nn[1] * L[1] + nn[2] * L[2]);
            let lit = 1;
            for (let s = 2; s <= maxSteps; s += 2) {
                const si = Math.round(i + dx * s);
                const sj = Math.round(j + dy * s);
                if (si < 0 || sj < 0 || si >= n || sj >= n) break;
                const need = h0 + (s / ss) * rise + 0.25;
                if (need > 20) break;
                if (h[sj * n + si] > need) {
                    lit = 0.38;
                    break;
                }
            }
            let occ = 0;
            for (const [ax, ay] of aoDirs) {
                for (const dist of [1.2, 3.5]) {
                    const q = hAt(Math.round(i + ax * dist * ss), Math.round(j + ay * dist * ss)) - h0 - 0.15;
                    if (q > 0) occ += Math.min(1, q / (dist * 1.6));
                }
            }
            const ao = 1 - 0.55 * Math.min(1, occ / 5);
            let sp = 0;
            if (m === M_METAL || m === M_COPPER || m === M_GLASS) {
                const d = Math.max(0, nn[0] * HALF[0] + nn[1] * HALF[1] + nn[2] * HALF[2]);
                sp = Math.pow(d, m === M_GLASS ? 60 : 26) * (m === M_COPPER ? 0.55 : m === M_GLASS ? 0.7 : 0.35) * lit;
            }
            const k = (0.24 + 0.92 * diff * lit) * ao;
            out[c * 3] = r * k + sp;
            out[c * 3 + 1] = g * k + sp * 0.92;
            out[c * 3 + 2] = bl * k + sp * 0.8;
        }
    }
    const rgba = new Uint8ClampedArray(side * side * 4);
    const lightPx: number[] = [];
    const inv = 1 / (ss * ss);
    for (let y = 0; y < side; y++) {
        for (let x = 0; x < side; x++) {
            let r = 0;
            let g = 0;
            let bl = 0;
            let a = 0;
            let lights = 0;
            for (let sj = 0; sj < ss; sj++) {
                for (let si = 0; si < ss; si++) {
                    const c = (y * ss + sj) * n + (x * ss + si);
                    if (gb.mat[c] === 0) continue;
                    r += out[c * 3];
                    g += out[c * 3 + 1];
                    bl += out[c * 3 + 2];
                    a++;
                    if (gb.mat[c] === M_LIGHT) lights++;
                }
            }
            if (a === 0) continue;
            const p = y * side + x;
            rgba[p * 4] = Math.round(Math.min(1, r / a) * 255);
            rgba[p * 4 + 1] = Math.round(Math.min(1, g / a) * 255);
            rgba[p * 4 + 2] = Math.round(Math.min(1, bl / a) * 255);
            rgba[p * 4 + 3] = Math.round(a * inv * 255);
            if (lights * 2 >= a) lightPx.push(p);
        }
    }
    return { rgba, lightPx };
}

// ---------------------------------------------------------------------------------------------------------------
// Overlays: light halos by blink group, animated parts
// ---------------------------------------------------------------------------------------------------------------

/** Blink groups of the light overlay. */
export type ConcordLightGroup = 'steady' | 'flood' | 'nav' | 'strobe';
export const CONCORD_LIGHT_GROUPS: readonly ConcordLightGroup[] = ['steady', 'flood', 'nav', 'strobe'];

export function concordLightGroup(kind: ConcordLightKind): ConcordLightGroup {
    if (kind === 'flood') return 'flood';
    if (kind === 'port' || kind === 'starboard') return 'nav';
    if (kind === 'strobe') return 'strobe';
    return 'steady';
}

/** Tight halos (σ ≈ 1.2 × the light's radius) of one blink group, each in its own colour. */
function haloImage(S: number, lights: readonly ConcordLight[]): RgbaImage {
    const acc = new Float64Array(S * S * 4);
    for (const l of lights) {
        const sg = Math.max(0.6, l.r * (l.kind === 'flood' ? 1.6 : l.kind === 'strobe' ? 1.8 : 1.2));
        const c = LIGHT_COLOUR[l.kind];
        const x0 = Math.max(0, Math.floor(l.x - 3 * sg));
        const x1 = Math.min(S - 1, Math.ceil(l.x + 3 * sg));
        const y0 = Math.max(0, Math.floor(l.y - 3 * sg));
        const y1 = Math.min(S - 1, Math.ceil(l.y + 3 * sg));
        for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
                const q = ((x + 0.5 - l.x) ** 2 + (y + 0.5 - l.y) ** 2) / (sg * sg);
                if (q > 9) continue;
                const a = Math.exp(-q);
                const k = (y * S + x) * 4;
                acc[k] += c[0] * a;
                acc[k + 1] += c[1] * a;
                acc[k + 2] += c[2] * a;
                acc[k + 3] += a;
            }
        }
    }
    const data = new Uint8ClampedArray(S * S * 4);
    for (let p = 0; p < S * S; p++) {
        const a = acc[p * 4 + 3];
        if (a <= 0.004) continue;
        data[p * 4] = Math.round(Math.min(1, acc[p * 4] / a) * 255);
        data[p * 4 + 1] = Math.round(Math.min(1, acc[p * 4 + 1] / a) * 255);
        data[p * 4 + 2] = Math.round(Math.min(1, acc[p * 4 + 2] / a) * 255);
        data[p * 4 + 3] = Math.round(Math.min(1, a) * 255);
    }
    return { w: S, h: S, data };
}

/** Oversampling of the part textures (texture px per raw px). */
export const CONCORD_PART_SCALE = 4;

/** A part's texture: the fan face (18 twisted blades, copper spinner) or the radar dish bar, lit like the hull. */
function partImage(p: ConcordPart): RgbaImage {
    const k = CONCORD_PART_SCALE;
    const side = Math.max(4, Math.ceil(p.r * 2 * k) + 2);
    const data = new Uint8ClampedArray(side * side * 4);
    const c = side / 2;
    const R = p.r * k;
    const setPx = (q: number, col: Rgb, s: number): void => {
        data[q * 4] = Math.round(Math.min(1, col[0] * s) * 255);
        data[q * 4 + 1] = Math.round(Math.min(1, col[1] * s) * 255);
        data[q * 4 + 2] = Math.round(Math.min(1, col[2] * s) * 255);
        data[q * 4 + 3] = 255;
    };
    for (let y = 0; y < side; y++) {
        for (let x = 0; x < side; x++) {
            const dx = x + 0.5 - c;
            const dy = y + 0.5 - c;
            const d = Math.hypot(dx, dy);
            const q = y * side + x;
            if (p.kind === 'fan') {
                if (d > R) continue;
                if (d < R * 0.28) {
                    const t = d / (R * 0.28);
                    setPx(q, COPPER, 0.45 + 0.5 * Math.max(0, -dy / (R * 0.28) * 0.7 + Math.sqrt(1 - t * t) * 0.7));
                    continue;
                }
                const a = Math.atan2(dy, dx) + Math.sign(p.spin) * 0.6 * (d / R);
                const f = ((a / (2 * Math.PI)) * 18 + 18) % 1;
                if (f < 0.55) setPx(q, METAL, 0.55 + 0.6 * (f / 0.55));
                else setPx(q, BLACK, 1);
            } else {
                const w = R * 0.2;
                if (Math.abs(dx) > R || Math.abs(dy) > w) continue;
                const slat = Math.abs(Math.sin((dx / Math.max(1, R * 0.12)) * Math.PI)) < 0.25;
                setPx(q, slat ? GLASS : METAL, 0.7 + 0.5 * (1 - (dy / w) ** 2) * (dy < 0 ? 1.1 : 0.8));
            }
        }
    }
    return { w: side, h: side, data };
}

// ---------------------------------------------------------------------------------------------------------------
// A variant
// ---------------------------------------------------------------------------------------------------------------

export interface ConcordImages {
    spec: ConcordSpec;
    /** The ship / base, straight alpha, with the pure-blue thruster marks still in (shipArt pipeline removes them). */
    ship: RgbaImage;
    /** Tight light halos per blink group (additive). */
    halos: Record<ConcordLightGroup, RgbaImage>;
    lights: ConcordLight[];
    /** Animated parts (fan faces, dishes) with their textures (CONCORD_PART_SCALE texture px per raw px). */
    parts: (ConcordPart & { img: RgbaImage })[];
    /** Pixel indices of the thruster marks. */
    markerPixels: number[];
    /** Pixel indices that are mostly light (kept in colour through the saturation pass). */
    lightPixels: number[];
}

function variantSeed(kind: ConcordKind, bucket: number, look: ConcordLook): number {
    return (CONCORD_KINDS.indexOf(kind) + 1) * 7919 + bucket * 104729 + CONCORD_LOOKS.indexOf(look) * 15485863;
}

/** Deterministic procedural images of one variant (pure; no DOM). */
export function generateConcordImages(kind: ConcordKind, bucket: number, look: ConcordLook = 'weathered'): ConcordImages {
    const spec = concordSpec(kind, bucket, look);
    const S = spec.side;
    const b: Build = { gb: new GBuf(S, S <= 192 ? 3 : 2), spec, S, rng: makeRng(variantSeed(kind, bucket, look)), lights: [], parts: [], thrusters: [], rust: [] };
    switch (kind) {
        case 'treasure':
            buildTreasure(b);
            break;
        case 'freighter':
            buildFreighter(b);
            break;
        case 'explorer':
            buildExplorer(b);
            break;
        case 'construction':
            buildConstruction(b);
            break;
        case 'warship':
            buildWarship(b);
            break;
        default:
            buildBase(b);
    }
    surfaceDetail(b);
    weathering(b);
    paintLights(b);
    const { rgba, lightPx } = shade(b.gb);
    const ship: RgbaImage = { w: S, h: S, data: rgba };
    const markerPixels: number[] = [];
    for (const [x0, x1, y] of b.thrusters) for (let x = x0; x <= x1; x++) markerPixels.push(y * S + x);
    const markers = new Set(markerPixels);
    const lamps = new Set(lightPx);
    const ref = ACKDARIAN_REFERENCE[kind];
    matchSaturation(ship, CONCORD_TARGET_SAT, (p) => markers.has(p), (p) => lamps.has(p));
    matchLumaQuantiles(ship, ref.q, (p) => markers.has(p));
    const d = ship.data;
    for (let p = 0; p < S * S; p++) {
        const i = p * 4;
        if (d[i + 3] === 0) continue;
        // Never leave an accidental pure-blue / pure-yellow marker colour in the art.
        if ((d[i] === 0 && d[i + 1] === 0 && d[i + 2] === 255) || (d[i] === 255 && d[i + 1] === 255 && d[i + 2] === 0)) d[i + 2] = d[i + 2] === 255 ? 254 : 1;
    }
    for (const p of markerPixels) {
        const i = p * 4;
        d[i] = 0;
        d[i + 1] = 0;
        d[i + 2] = 255;
        d[i + 3] = 255;
    }
    const halos = {} as Record<ConcordLightGroup, RgbaImage>;
    for (const g of CONCORD_LIGHT_GROUPS) halos[g] = haloImage(S, b.lights.filter((l) => concordLightGroup(l.kind) === g));
    return { spec, ship, halos, lights: b.lights, parts: b.parts.map((p) => ({ ...p, img: partImage(p) })), markerPixels, lightPixels: lightPx };
}

// ---------------------------------------------------------------------------------------------------------------
// Portrait and flag: the ceremonial mask emblem (copper on turquoise)
// ---------------------------------------------------------------------------------------------------------------

export const CONCORD_PORTRAIT_SIZE = 300; // images/units/races/race_<i>.png are 300 × 300
export const CONCORD_FLAG_W = 180; // images/ui/flagshapes/flagNN.png are 180 × 107
export const CONCORD_FLAG_H = 107;

/** Emblem material at a point: 0 none, 1 copper, 2 cut-through (dark), 3 turquoise gem, 4 engraved groove. */
interface EmblemPt {
    h: number;
    m: number;
}

function ellipseE(x: number, y: number, cx: number, cy: number, a: number, b: number): number {
    const u = (x - cx) / a;
    const v = (y - cy) / b;
    return u * u + v * v;
}

function raise(o: EmblemPt, h: number): void {
    if (h > o.h || o.m === 0) {
        o.h = Math.max(o.h, h);
        o.m = 1;
    }
}

/**
 * The emblem in normalised coordinates (radius ≈ 1, y down): a sunburst of rays and a beaded halo behind a domed
 * mask with almond eye slits, arched brows, a nose ridge, a serene mouth, cheek medallions, ear plates, a forehead
 * gem, a crown of five cloud lobes with a flame finial and a lotus at the chin.
 */
function emblemAt(x: number, y: number, o: EmblemPt): void {
    o.h = 0;
    o.m = 0;
    const r = Math.hypot(x, y);
    const ang = Math.atan2(y, x);
    // Sunburst rays, alternating long / short.
    const nr = 24;
    const k = (ang / (2 * Math.PI)) * nr;
    const ki = Math.round(k);
    const dk = Math.abs(k - ki);
    const long = (ki & 1) === 0;
    const rEnd = long ? 0.98 : 0.86;
    if (r > 0.6 && r < rEnd) {
        const wHalf = 0.28 * (1 - (r - 0.6) / (rEnd - 0.6));
        if (dk < wHalf) raise(o, 0.22 + 0.18 * (1 - dk / wHalf));
    }
    // Beaded halo ring.
    if (Math.abs(r - 0.63) < 0.035) raise(o, 0.42 + 0.1 * (1 - Math.abs(r - 0.63) / 0.035));
    const nb = 32;
    const bk = (ang / (2 * Math.PI)) * nb;
    const ba = (Math.round(bk) / nb) * 2 * Math.PI;
    const bd = Math.hypot(x - 0.7 * Math.cos(ba), y - 0.7 * Math.sin(ba));
    if (bd < 0.026) raise(o, 0.35 + 0.25 * Math.sqrt(1 - (bd / 0.026) ** 2));
    // Crown: five cloud lobes along an arc above the brow, each with an engraved curl, and a flame finial.
    const lobes: [number, number, number][] = [
        [-0.3, -0.47, 0.105],
        [-0.16, -0.57, 0.11],
        [0, -0.61, 0.12],
        [0.16, -0.57, 0.11],
        [0.3, -0.47, 0.105],
    ];
    for (const [lx, ly, lr] of lobes) {
        const d = Math.hypot(x - lx, y - ly);
        if (d < lr) {
            raise(o, 0.55 + 0.35 * Math.sqrt(1 - (d / lr) ** 2));
            if (Math.abs(d - lr * 0.55) < lr * 0.1 && Math.atan2(y - ly, x - lx) > -2.2) o.m = 4;
        }
    }
    const fd = Math.hypot(x, y + 0.74);
    if (fd < 0.07 || (y < -0.74 && y > -0.93 && Math.abs(x) < 0.07 * ((y + 0.93) / 0.19))) raise(o, 0.8);
    // Ear plates.
    for (const s of [-1, 1]) {
        const e = ellipseE(x, y, s * 0.47, 0.02, 0.075, 0.19);
        if (e < 1) {
            raise(o, 0.5 + 0.3 * Math.sqrt(1 - e));
            if (Math.abs(e - 0.45) < 0.08) o.m = 4;
        }
    }
    // Face dome.
    const fe = ellipseE(x, y, 0, 0.04, 0.42, 0.52);
    if (fe < 1) {
        o.h = 0.6 + 0.4 * Math.sqrt(1 - fe);
        o.m = 1;
        if (fe > 0.8 && fe < 0.86) o.m = 4;
        // Brows.
        for (const s of [-1, 1]) {
            const bx = (x - s * 0.17) / 0.16;
            const by = -0.17 - 0.05 * (1 - bx * bx);
            if (Math.abs(bx) < 1 && Math.abs(y - by) < 0.022) o.h += 0.12;
        }
        // Nose ridge and nostrils.
        if (y > -0.1 && y < 0.2) {
            const w = 0.03 + 0.03 * ((y + 0.1) / 0.3);
            if (Math.abs(x) < w) o.h += 0.12 * (1 - Math.abs(x) / w);
        }
        for (const s of [-1, 1]) if (Math.hypot(x - s * 0.05, y - 0.2) < 0.02) o.m = 4;
        // Cheek medallions.
        for (const s of [-1, 1]) {
            const d = Math.hypot(x - s * 0.26, y - 0.17);
            if (Math.abs(d - 0.06) < 0.015 || d < 0.018) o.h += 0.1;
        }
        // Mouth: a closed, serene line with lips.
        const mx = x / 0.15;
        if (Math.abs(mx) < 1) {
            const my = 0.34 + 0.035 * mx * mx;
            const dy = y - my;
            if (Math.abs(dy) < 0.012) o.m = 2;
            else if (Math.abs(dy) < 0.04) o.h += 0.07 * (1 - Math.abs(mx));
        }
        // Forehead gem.
        if (Math.abs(x) + Math.abs(y + 0.3) < 0.055) {
            o.m = 3;
            o.h += 0.1;
        }
        // Almond eye slits, outer corners upturned.
        for (const s of [-1, 1]) {
            const ex = (x - s * 0.17) / 0.12;
            if (Math.abs(ex) < 1) {
                const ey = -0.07 - 0.025 * ex * s;
                if (Math.abs(y - ey) < 0.042 * (1 - ex * ex)) o.m = 2;
            }
        }
    }
    // Lotus at the chin.
    for (const [px, py, pr] of [
        [0, 0.66, 0.065],
        [-0.075, 0.62, 0.05],
        [0.075, 0.62, 0.05],
    ] as const) {
        const d = Math.hypot(x - px, y - py);
        if (d < pr) raise(o, 0.5 + 0.3 * Math.sqrt(1 - (d / pr) ** 2));
    }
}

interface EmblemLight {
    /** Lacquer-red background colour at (nx, ny) (flag / portrait specific). */
    background(nx: number, ny: number, gx: number, gy: number): Rgb;
    relief: number;
}

/**
 * Renders the emblem over a background into a w × h image at 2× supersampling: heights on the fine grid → normals →
 * copper lit by warm lantern light from the upper left (plus a dim red fill from the lower right and a specular
 * glint); cut-through slits show the dark field, grooves darken, the gem is glossy turquoise; a soft drop shadow falls on
 * the background.
 */
function renderEmblem(w: number, h: number, cx: number, cy: number, radius: number, light: EmblemLight): RgbaImage {
    const ss = 2;
    const W = w * ss;
    const H = h * ss;
    const hs = new Float32Array(W * H);
    const ms = new Uint8Array(W * H);
    const pt: EmblemPt = { h: 0, m: 0 };
    const rad = radius * ss;
    for (let j = 0; j < H; j++) {
        for (let i = 0; i < W; i++) {
            emblemAt((i + 0.5 - cx * ss) / rad, (j + 0.5 - cy * ss) / rad, pt);
            hs[j * W + i] = pt.h;
            ms[j * W + i] = pt.m;
        }
    }
    const shadowOff = Math.max(2, Math.round(rad * 0.035));
    const out = new Uint8ClampedArray(w * h * 4);
    const L1 = norm3(-0.55, -0.6, 0.58);
    const L2 = norm3(0.6, 0.55, 0.58);
    const H1 = norm3(L1[0], L1[1], L1[2] + 1);
    const at = (i: number, j: number): number => hs[Math.min(H - 1, Math.max(0, j)) * W + Math.min(W - 1, Math.max(0, i))];
    const acc = [0, 0, 0];
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            acc[0] = acc[1] = acc[2] = 0;
            for (let sj = 0; sj < ss; sj++) {
                for (let si = 0; si < ss; si++) {
                    const i = x * ss + si;
                    const j = y * ss + sj;
                    const m = ms[j * W + i];
                    const nx = (i + 0.5 - cx * ss) / rad;
                    const ny = (j + 0.5 - cy * ss) / rad;
                    let c: Rgb;
                    if (m === 0 || m === 2) {
                        const bg = light.background(nx, ny, x / w, y / h);
                        const shadow = ms[Math.max(0, j - shadowOff) * W + Math.max(0, i - shadowOff)] !== 0;
                        c = m === 2 ? [0.01, 0.05, 0.05] : shadow ? [bg[0] * 0.5, bg[1] * 0.5, bg[2] * 0.5] : bg;
                    } else {
                        const gx = (at(i + 1, j) - at(i - 1, j)) * light.relief * rad * 0.5;
                        const gy = (at(i, j + 1) - at(i, j - 1)) * light.relief * rad * 0.5;
                        const n = norm3(-gx, -gy, 1);
                        const d1 = Math.max(0, n[0] * L1[0] + n[1] * L1[1] + n[2] * L1[2]);
                        const d2 = Math.max(0, n[0] * L2[0] + n[1] * L2[1] + n[2] * L2[2]);
                        const sp = Math.pow(Math.max(0, n[0] * H1[0] + n[1] * H1[1] + n[2] * H1[2]), 28);
                        const alb: Rgb = m === 3 ? [0.1, 0.55, 0.5] : m === 4 ? [0.4, 0.22, 0.12] : [0.8, 0.48, 0.27];
                        const amb = 0.2;
                        c = [
                            alb[0] * (amb + 1.0 * d1 + 0.45 * d2) + sp * 0.95,
                            alb[1] * (amb + 0.84 * d1 + 0.2 * d2) + sp * 0.85,
                            alb[2] * (amb + 0.58 * d1 + 0.1 * d2) + sp * 0.6,
                        ];
                    }
                    acc[0] += c[0];
                    acc[1] += c[1];
                    acc[2] += c[2];
                }
            }
            const k = (y * w + x) * 4;
            const inv = 1 / (ss * ss);
            out[k] = Math.round(Math.min(1, acc[0] * inv) * 255);
            out[k + 1] = Math.round(Math.min(1, acc[1] * inv) * 255);
            out[k + 2] = Math.round(Math.min(1, acc[2] * inv) * 255);
            out[k + 3] = 255;
        }
    }
    return { w, h, data: out };
}

function norm3(x: number, y: number, z: number): [number, number, number] {
    const l = Math.hypot(x, y, z) || 1;
    return [x / l, y / l, z / l];
}

/** The Concord's portrait: the ceremonial copper mask on dark turquoise, lit by two hanging lanterns, in a copper frame. */
export function generateConcordPortrait(size = CONCORD_PORTRAIT_SIZE): RgbaImage {
    const cloud = valueNoise(83);
    const lanterns = [
        { x: 0.13, y: 0.14 },
        { x: 0.87, y: 0.14 },
    ];
    const img = renderEmblem(size, size, size / 2, size * 0.53, size * 0.43, {
        relief: 0.9,
        background(_nx, _ny, gx, gy) {
            const dc = Math.hypot(gx - 0.5, gy - 0.5);
            let v = 0.5 - 0.42 * dc;
            v *= 1 + 0.25 * fbm2(cloud, gx * 6, gy * 6);
            let r = 0.05 * v;
            let g = 0.4 * v + 0.02;
            let b = 0.37 * v + 0.02;
            for (const l of lanterns) {
                const q = ((gx - l.x) ** 2 + (gy - l.y) ** 2) / 0.02;
                const glow = Math.exp(-q);
                r += 0.55 * glow;
                g += 0.28 * glow;
                b += 0.07 * glow;
            }
            return [r, g, b];
        },
    });
    // Hanging lanterns and the gilded frame, drawn over the rendered field.
    const d = img.data;
    const S = size;
    for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
            const k = (y * S + x) * 4;
            const gx = (x + 0.5) / S;
            const gy = (y + 0.5) / S;
            let c: Rgb | null = null;
            for (const l of lanterns) {
                const e = ellipseE(gx, gy, l.x, l.y, 0.05, 0.062);
                if (Math.abs(gx - l.x) < 0.004 && gy < l.y - 0.06) c = [0.55, 0.33, 0.18];
                if (e < 1) {
                    const rib = Math.abs(Math.sin(((gy - l.y) / 0.062) * Math.PI * 2.5)) < 0.2;
                    const core = 1 - e;
                    c = rib ? [0.55, 0.3, 0.14] : [0.98, 0.55 + 0.35 * core, 0.25 + 0.35 * core];
                }
                if (Math.abs(gx - l.x) < 0.03 && Math.abs(gy - (l.y - 0.066)) < 0.008) c = [0.8, 0.48, 0.27];
                if (Math.abs(gx - l.x) < 0.02 && Math.abs(gy - (l.y + 0.066)) < 0.008) c = [0.8, 0.48, 0.27];
                if (Math.abs(gx - l.x) < 0.006 && gy > l.y + 0.07 && gy < l.y + 0.12) c = [0.12, 0.5, 0.46];
            }
            const e = Math.min(x, y, S - 1 - x, S - 1 - y);
            if (e < 3) c = [0.8, 0.48, 0.27].map((v) => v * (0.8 + 0.12 * e)) as unknown as Rgb;
            else if (e < 4) c = [0.02, 0.1, 0.1];
            else if (e < 7 && ((x + y) >> 2) % 2 === 0) c = [0.6, 0.36, 0.2];
            if (c !== null) {
                d[k] = Math.round(Math.min(1, c[0]) * 255);
                d[k + 1] = Math.round(Math.min(1, c[1]) * 255);
                d[k + 2] = Math.round(Math.min(1, c[2]) * 255);
            }
        }
    }
    return img;
}

/** The Concord's flag: a turquoise field, copper border, the copper mask emblem. */
export function generateConcordFlag(w = CONCORD_FLAG_W, h = CONCORD_FLAG_H): RgbaImage {
    const img = renderEmblem(w, h, w / 2, h / 2 + h * 0.02, h * 0.42, {
        relief: 0.55,
        background(_nx, _ny, gx, gy) {
            const wave = 0.9 + 0.1 * Math.sin(gx * 9 + gy * 2.5);
            return [0.08 * wave, 0.42 * wave, 0.39 * wave];
        },
    });
    const d = img.data;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const e = Math.min(x, y, w - 1 - x, h - 1 - y);
            if (e >= 5) continue;
            const k = (y * w + x) * 4;
            const c: Rgb = e < 1 || e === 4 ? [0.45, 0.25, 0.13] : [0.86, 0.53, 0.3];
            d[k] = Math.round(c[0] * 255);
            d[k + 1] = Math.round(c[1] * 255);
            d[k + 2] = Math.round(c[2] * 255);
        }
    }
    return img;
}

/** FNV-1a hash of image bytes (determinism tests / cache keys). */
export function imageHash(img: RgbaImage): string {
    let hh = 0x811c9dc5;
    const d = img.data;
    for (let i = 0; i < d.length; i++) {
        hh ^= d[i];
        hh = Math.imul(hh, 0x01000193);
    }
    return (hh >>> 0).toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------------------------------------------------------
// Display gate and per-object lookup (pure)
// ---------------------------------------------------------------------------------------------------------------

/** The scenario flag: default on (a save made before the flag existed has no entry → on). */
export function concordArtEnabled(galaxy: Galaxy): boolean {
    const s = galaxy.scenario;
    return s !== null && scenarioFlag(galaxy, 'rimTrader') && s.flags['concordArt'] !== false;
}

/** The look chosen by the `concordArtLook` param (0 weathered, 1 clean). */
export function concordArtLook(galaxy: Galaxy): ConcordLook {
    return concordLookOf(scenarioParam(galaxy, 'concordArtLook', 0));
}

/** The empire whose built objects get the Concord art this frame (null = draw every object with its stock art). */
export function concordArtEmpire(galaxy: Galaxy): Empire | null {
    return concordArtEnabled(galaxy) ? rimTraderEmpire(galaxy) : null;
}

/** The treasure ships (render-side read of the 19a state; never creates it). */
export function concordTreasureShips(galaxy: Galaxy): ReadonlySet<unknown> {
    const st = galaxy.scenario?.state['rimTreasure'] as { treasure?: unknown[] } | undefined;
    return new Set(st?.treasure ?? []);
}

export interface ConcordVariant {
    kind: ConcordKind;
    bucket: number;
    look: ConcordLook;
}

/** Which Concord variant draws `bo` — null unless it belongs to the Concord (and the art is on). */
export function concordVariantFor(
    bo: { empire: Empire | null; subRole: BuiltObjectSubRole; size: number },
    concord: Empire | null,
    treasure: ReadonlySet<unknown>,
    look: ConcordLook = 'weathered',
): ConcordVariant | null {
    if (concord === null || bo.empire !== concord) return null;
    return { kind: concordKindOf(bo.subRole, treasure.has(bo)), bucket: concordSizeBucket(bo.size), look };
}

/** The ambient nav-light cycle (MainView.cs:1457-1458: 1.5 s on + 1.0 s off) and its per-ship phase (id % 20 / 10). */
// (Read at call time: ambientLayer.ts and this module import each other, so no module-level use of its constants.)
const navCycle = (): number => LIGHT_ON_SECONDS + LIGHT_OFF_SECONDS;
const navPhase = (seconds: number, id: number): number => {
    const c = navCycle();
    return (((seconds + (Math.abs(id) % 20) / 10) % c) + c) % c;
};

/**
 * Halo alpha of a blink group at `seconds` (wall clock) for ship `id`, on the ambient nav-light cycle:
 * steady (windows, deck, white stern / masthead) constant; flood a warm flicker with a rare dip; nav (red port / green
 * starboard) steady with a slow pulse; strobe a short double flash at the start of each cycle.
 */
export function concordLightAlpha(group: ConcordLightGroup, seconds: number, id: number): number {
    const t = navPhase(seconds, id);
    switch (group) {
        case 'steady':
            return 0.5;
        case 'flood': {
            const k = Math.abs(id) % 97;
            const dip = (((seconds + k * 0.37) / 7.3) % 1) < 0.025 ? 0.45 : 1;
            return 0.5 * (0.84 + 0.1 * Math.sin(seconds * 9 + k) + 0.06 * Math.sin(seconds * 23.7 + k * 1.3)) * dip;
        }
        case 'nav':
            return 0.45 + 0.25 * (0.5 + 0.5 * Math.cos((2 * Math.PI * t) / navCycle()));
        case 'strobe':
            return t < 0.07 || (t > 0.2 && t < 0.27) ? 0.95 : 0;
    }
}

/** Overlays are skipped below this drawn size (px): too small to read, and cheap to skip. */
export const CONCORD_FX_MIN_PX = 12;
/** Animated parts are drawn from this drawn size (px) up; below it the baked fan / dish shows. */
export const CONCORD_PARTS_MIN_PX = 40;

// ---------------------------------------------------------------------------------------------------------------
// Textures (DOM / Pixi) — generated once per variant, lazily, at most CONCORD_BUILDS_PER_FRAME per frame
// ---------------------------------------------------------------------------------------------------------------

export interface ConcordShipArt {
    texture: Texture;
    metrics: ShipImageMetrics;
    markers: ShipMarkers;
    halos: Record<ConcordLightGroup, Texture>;
    parts: { part: ConcordPart; texture: Texture }[];
}

export const CONCORD_BUILDS_PER_FRAME = 1;
const shipArtCache = new Map<string, ConcordShipArt>();
let buildFrame = -1;
let buildsThisFrame = 0;

function toCanvasTexture(img: RgbaImage): Texture {
    const canvas = document.createElement('canvas');
    canvas.width = img.w;
    canvas.height = img.h;
    const ctx = canvas.getContext('2d')!;
    const id = ctx.createImageData(img.w, img.h);
    id.data.set(img.data);
    ctx.putImageData(id, 0, 0);
    const t = Texture.from(canvas);
    useMinifyingFilter(t);
    return t;
}

/** Ship art of a variant through the same pipeline as stock art: metrics, thruster scan, marks painted out. */
export function buildConcordShipArt(images: ConcordImages): { rgba: Uint8ClampedArray; metrics: ShipImageMetrics; markers: ShipMarkers } | null {
    const { w, h, data } = images.ship;
    const metrics = shipImageMetrics(data, w, h);
    if (metrics === null) return null;
    const markers = scanShipMarkers(data, w, h, metrics);
    return { rgba: paintOutShipMarkers(data, w, h, metrics, markers, true), metrics, markers };
}

export function concordVariantKey(v: ConcordVariant): string {
    return `${v.look}:${v.kind}:${v.bucket}`;
}

/**
 * The textures of a variant: built on first request (at most CONCORD_BUILDS_PER_FRAME new ones per `frame`; null
 * until built). `build` false only reads the cache (the ambient layer).
 */
export function concordShipArt(v: ConcordVariant, frame: number, build = true): ConcordShipArt | null {
    const key = concordVariantKey(v);
    const hit = shipArtCache.get(key);
    if (hit !== undefined || !build) return hit ?? null;
    if (frame !== buildFrame) {
        buildFrame = frame;
        buildsThisFrame = 0;
    }
    if (buildsThisFrame >= CONCORD_BUILDS_PER_FRAME) return null;
    buildsThisFrame++;
    const images = generateConcordImages(v.kind, v.bucket, v.look);
    const built = buildConcordShipArt(images);
    if (built === null) return null;
    const halos = {} as Record<ConcordLightGroup, Texture>;
    for (const g of CONCORD_LIGHT_GROUPS) halos[g] = toCanvasTexture(images.halos[g]);
    const art: ConcordShipArt = {
        texture: toCanvasTexture({ w: images.ship.w, h: images.ship.h, data: built.rgba }),
        metrics: built.metrics,
        markers: built.markers,
        halos,
        parts: images.parts.map((p) => ({ part: { kind: p.kind, x: p.x, y: p.y, r: p.r, spin: p.spin }, texture: toCanvasTexture(p.img) })),
    };
    shipArtCache.set(key, art);
    return art;
}

/** Light halos (by blink group) and animated parts over the Concord's ships (pooled; one container above the ships). */
export class ConcordFxLayer {
    readonly root = new Container();
    private pool = new SpritePool(this.root);

    begin(): void {
        this.pool.begin();
    }

    /**
     * Overlays for one ship drawn with the ship sprite's transform (position, rotation, scale = world units per raw
     * texture px, anchor as a fraction of the texture); `drawnPx` = its drawn size.
     */
    draw(art: ConcordShipArt, x: number, y: number, rotation: number, scale: number, anchorX: number, anchorY: number, id: number, drawnPx: number, nowMs: number): void {
        if (drawnPx < CONCORD_FX_MIN_PX) return;
        const sec = nowMs / 1000;
        const cos = Math.cos(rotation);
        const sin = Math.sin(rotation);
        const tw = art.texture.width;
        const th = art.texture.height;
        if (drawnPx >= CONCORD_PARTS_MIN_PX) {
            for (const { part, texture } of art.parts) {
                const lx = (part.x - anchorX * tw) * scale;
                const ly = (part.y - anchorY * th) * scale;
                const s = this.pool.acquire(texture);
                s.blendMode = 'normal';
                s.position.set(x + lx * cos - ly * sin, y + lx * sin + ly * cos);
                s.rotation = rotation + part.spin * sec;
                s.scale.set(scale / CONCORD_PART_SCALE);
            }
        }
        for (const g of CONCORD_LIGHT_GROUPS) {
            const a = concordLightAlpha(g, sec, id);
            if (a <= 0) continue;
            const s = this.pool.acquire(art.halos[g]);
            s.blendMode = 'add';
            s.anchor.set(anchorX, anchorY);
            s.position.set(x, y);
            s.rotation = rotation;
            s.scale.set(scale);
            s.alpha = a;
        }
    }

    end(): void {
        this.pool.end();
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Race display override (portrait / flag), keyed by race name
// ---------------------------------------------------------------------------------------------------------------

export interface RaceDisplayArt {
    portraitUrl: string;
    flagUrl: string;
}

let raceArt: RaceDisplayArt | null = null;

function toDataUrl(img: RgbaImage): string {
    const canvas = document.createElement('canvas');
    canvas.width = img.w;
    canvas.height = img.h;
    const ctx = canvas.getContext('2d')!;
    const id = ctx.createImageData(img.w, img.h);
    id.data.set(img.data);
    ctx.putImageData(id, 0, 0);
    return canvas.toDataURL('image/png');
}

/** True when `raceName` is shown with the Concord's own portrait / flag in this game. Pure. */
export function raceHasConcordArt(galaxy: Galaxy | null | undefined, raceName: string | null | undefined): boolean {
    return galaxy != null && raceName != null && raceName.toLowerCase() === RIM_RACE.toLowerCase() && concordArtEnabled(galaxy);
}

/** Display-time portrait / flag override for a race (the race file stays data); null = use the stock art. */
export function raceDisplayOverride(galaxy: Galaxy | null | undefined, raceName: string | null | undefined): RaceDisplayArt | null {
    if (!raceHasConcordArt(galaxy, raceName)) return null;
    raceArt ??= { portraitUrl: toDataUrl(generateConcordPortrait()), flagUrl: toDataUrl(generateConcordFlag()) };
    return raceArt;
}
