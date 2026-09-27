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

export type ConcordKind = 'frigate' | 'destroyer' | 'battleship' | 'freighter' | 'explorer' | 'construction' | 'treasure' | 'port' | 'base';
export const CONCORD_KINDS: readonly ConcordKind[] = ['frigate', 'destroyer', 'battleship', 'freighter', 'explorer', 'construction', 'treasure', 'port', 'base'];

/** The three military classes. */
export function isConcordMilitary(kind: ConcordKind): boolean {
    return kind === 'frigate' || kind === 'destroyer' || kind === 'battleship';
}

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
const PORT_SIDES = [224, 256, 320, 384, 448, 512] as const;

/**
 * Sub-role → variant. Military classes: Escort → frigate; Frigate, Destroyer, TroopTransport → destroyer; Cruiser,
 * CapitalShip, Carrier → battleship (and anything unlisted → destroyer).
 */
export function concordKindOf(subRole: BuiltObjectSubRole, treasure: boolean): ConcordKind {
    if (treasure) return 'treasure';
    switch (subRole) {
        case BuiltObjectSubRole.Escort:
            return 'frigate';
        case BuiltObjectSubRole.Cruiser:
        case BuiltObjectSubRole.CapitalShip:
        case BuiltObjectSubRole.Carrier:
            return 'battleship';
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
            return 'destroyer';
    }
}

export function concordSizeBucket(size: number): number {
    let b = 0;
    for (const t of CONCORD_SIZE_THRESHOLDS) if (size >= t) b++;
    return b;
}

export function concordTextureSide(kind: ConcordKind, bucket: number): number {
    const b = Math.max(0, Math.min(CONCORD_BUCKETS - 1, bucket));
    if (kind === 'port') return PORT_SIDES[b];
    if (kind === 'base') return BASE_SIDES[b];
    if (kind === 'treasure') return 512;
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
    /** Container carriers (freighter, treasure ship): container columns across the deck, gantry cranes, jet-fan pods. */
    containerColumns: number;
    gantries: number;
    pods: number;
    /** Military: recessed beam mounts and missile cell blocks. */
    mounts: number;
    missileBlocks: number;
    /** Nozzles in the stern engine cluster (the outer pair as small jet-fan pods on bigger hulls; treasure: 2 pods). */
    engines: number;
    /** Base / port: docking arms and fuel tanks. */
    docks: number;
    tanks: number;
}

function engineCount(kind: ConcordKind, b: number): number {
    switch (kind) {
        case 'frigate':
            return 2;
        case 'destroyer':
            return 2;
        case 'battleship':
            return 4;
        case 'freighter':
            return 2;
        case 'explorer':
            return 2;
        case 'construction':
            return b >= 3 ? 3 : 2;
        case 'treasure':
            return 4;
        default:
            return 0;
    }
}

export function concordSpec(kind: ConcordKind, bucket: number, look: ConcordLook = 'weathered'): ConcordSpec {
    const b = Math.max(0, Math.min(CONCORD_BUCKETS - 1, bucket));
    const base = kind === 'port' || kind === 'base';
    let weathering = look === 'clean' ? 0.35 : 1;
    if (isConcordMilitary(kind)) weathering *= 1.5;
    if (base) weathering *= 1.8;
    return {
        kind,
        look,
        bucket: b,
        side: concordTextureSide(kind, b),
        weathering,
        containerColumns: kind === 'treasure' ? (b >= 4 ? 16 : 14) : kind === 'freighter' ? [4, 4, 6, 6, 8, 8][b] : 0,
        gantries: kind === 'treasure' ? (b >= 5 ? 6 : b >= 3 ? 5 : 4) : kind === 'freighter' ? [1, 1, 2, 2, 3, 3][b] : 0,
        pods: kind === 'treasure' ? 4 : kind === 'freighter' ? 2 : 0,
        mounts: kind === 'frigate' ? 1 : kind === 'destroyer' ? 2 : kind === 'battleship' ? 4 : 0,
        missileBlocks: kind === 'frigate' ? 1 : kind === 'destroyer' ? 2 : kind === 'battleship' ? 3 : 0,
        engines: engineCount(kind, b),
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

const Q_ESCORT = [0, 0, 0, 0.002, 0.078, 0.103, 0.12, 0.137, 0.152, 0.168, 0.189, 0.208, 0.23, 0.248, 0.267, 0.286, 0.302, 0.323, 0.345, 0.388, 0.472, 0.637, 0.807, 0.993, 1];
const Q_DESTROYER = [0, 0, 0, 0.004, 0.061, 0.08, 0.095, 0.112, 0.126, 0.144, 0.165, 0.185, 0.206, 0.227, 0.246, 0.263, 0.283, 0.305, 0.332, 0.374, 0.437, 0.562, 0.678, 0.865, 1];
const Q_CAPITALSHIP = [0, 0, 0, 0.001, 0.043, 0.072, 0.088, 0.104, 0.12, 0.137, 0.155, 0.175, 0.195, 0.213, 0.235, 0.258, 0.282, 0.306, 0.344, 0.393, 0.458, 0.598, 0.749, 0.959, 1];
const Q_LARGEFREIGHTER = [0, 0, 0, 0.001, 0.059, 0.092, 0.116, 0.135, 0.152, 0.167, 0.183, 0.2, 0.219, 0.235, 0.257, 0.281, 0.311, 0.345, 0.382, 0.427, 0.484, 0.599, 0.744, 0.925, 0.997];
const Q_EXPLORATIONSHIP = [0, 0, 0, 0.001, 0.064, 0.095, 0.115, 0.134, 0.147, 0.16, 0.177, 0.194, 0.217, 0.238, 0.269, 0.292, 0.317, 0.349, 0.386, 0.434, 0.501, 0.629, 0.709, 0.856, 0.993];
const Q_CONSTRUCTIONSHIP = [0, 0, 0, 0.013, 0.082, 0.111, 0.139, 0.16, 0.177, 0.194, 0.21, 0.227, 0.248, 0.272, 0.301, 0.33, 0.362, 0.398, 0.445, 0.496, 0.556, 0.699, 0.844, 0.986, 1];
const Q_LARGESPACEPORT = [0, 0, 0.003, 0.047, 0.09, 0.114, 0.135, 0.155, 0.173, 0.19, 0.208, 0.225, 0.243, 0.264, 0.286, 0.309, 0.336, 0.366, 0.403, 0.449, 0.506, 0.6, 0.699, 0.847, 1];
const Q_GENERICBASE = [0, 0, 0.013, 0.06, 0.095, 0.118, 0.135, 0.149, 0.164, 0.177, 0.191, 0.204, 0.217, 0.231, 0.246, 0.263, 0.283, 0.305, 0.333, 0.37, 0.423, 0.51, 0.596, 0.724, 0.997];

export const ACKDARIAN_REFERENCE: Readonly<Record<ConcordKind, AckdarianReference>> = {
    frigate: { file: 'family7/escort.png', meanL: 0.258, stdL: 0.186, meanSat: 0.229, q: Q_ESCORT },
    destroyer: { file: 'family7/destroyer.png', meanL: 0.232, stdL: 0.169, meanSat: 0.19, q: Q_DESTROYER },
    battleship: { file: 'family7/capitalship.png', meanL: 0.232, stdL: 0.186, meanSat: 0.182, q: Q_CAPITALSHIP },
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
export type ConcordLightKind = 'window' | 'deck' | 'flood' | 'port' | 'starboard' | 'white' | 'strobe' | 'engine';
const LIGHT_COLOUR: Readonly<Record<ConcordLightKind, Rgb>> = {
    window: [1, 0.8, 0.5],
    deck: [1, 0.86, 0.62],
    flood: [1, 0.95, 0.82],
    port: [1, 0.14, 0.1],
    starboard: [0.2, 1, 0.42],
    white: [1, 1, 0.95],
    strobe: [0.95, 0.97, 1],
    engine: [0.72, 0.86, 1],
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

/** Layout of a container carrier (the freighter, and the treasure ship at a much bigger scale). */
interface CarrierCfg {
    lengthFrac: number;
    /** Half-beam as a fraction of the length. */
    beam: number;
    /** Twin bridge towers side by side (treasure ship) instead of one. */
    twinBridge: boolean;
    /** Jet-fan pods per rear quarter (1 or 2). */
    podsPerSide: number;
    /** Deck floodlight spacing along the rails (fraction of the length). */
    floodStep: number;
    /** Extra strobes on the bow and the bridge roofs (treasure ship). */
    extraStrobes: boolean;
}

/**
 * A container carrier: forecastle with registry, container blocks (`containerColumns` across, two bays per block,
 * lashing gaps), gantry cranes over the deck, docking hatches, the bridge (or twin towers), funnel, engine deck and
 * jet-fan thruster pods on the rear quarters (pylon, nacelle, animated fan face, heat-stained nozzle).
 */
function buildCarrier(b: Build, cfg: CarrierCfg): void {
    const { gb, S, spec, rng } = b;
    const L = S * cfg.lengthFrac;
    const W = L * cfg.beam;
    const hull = roundedHull(S / 2, (S - L) / 2 - S * 0.005, L, W, 0.16, 0.1);
    const { cx } = hull;
    paintHull(b, hull, TURQ, DECK, true, P_PLATE, 0.9);
    forecastle(b, hull, 0.025, 0.105, `OC-${10 + spec.bucket * 7}`);
    const nc = spec.containerColumns;
    const usable = W * 0.84;
    const cw = (2 * usable) / nc;
    const cl = cw * 2.4;
    const gap = Math.max((3.6 * S) / 384, cw * 0.62);
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
        if (block > 40) break;
    }
    for (let u = 0.15; u < 0.76; u += cfg.floodStep) {
        light(b, cx - hull.hw(u) + 0.5, hull.yAt(u), 'flood');
        light(b, cx + hull.hw(u) - 0.5, hull.yAt(u), 'flood');
    }
    for (let g = 0; g < spec.gantries && gaps.length > 0; g++) {
        const k = Math.min(gaps.length - 1, Math.round(((g + 1) * gaps.length) / (spec.gantries + 1)) - 1);
        gantry(b, cx, gaps[Math.max(0, k)], W * 1.02, gap);
    }
    for (const s of [-1, 1]) {
        const hx = cx + s * (hull.hw(0.45) - Math.max(0.6, W * 0.06));
        hazard(gb, hx - Math.max(0.5, W * 0.05), hull.yAt(0.43), hx + Math.max(0.5, W * 0.05), hull.yAt(0.47), 2.5, Math.max(0.5, W * 0.05));
        b.rust.push([hx, hull.yAt(0.47)]);
    }
    // The bridge (or twin towers); its wing sidelights are dropped — the outermost pods carry red / green.
    const before = b.lights.length;
    if (cfg.twinBridge) for (const s of [-1, 1]) bridge(b, { ...hull, cx: cx + s * W * 0.5 }, 0.775, 0.845, W * 0.4, W * 0.62, 16, TURQ_LIGHT, true);
    else bridge(b, hull, 0.775, 0.845, W * 0.92, W * 1.18, 16, TURQ_LIGHT, true);
    const mine = b.lights.splice(before);
    for (const l of mine) if (l.kind !== 'port' && l.kind !== 'starboard') b.lights.push(l);
    funnel(b, hull, 0.855, 0.895, W * (cfg.twinBridge ? 0.22 : 0.32), 18);
    engineDeck(b, hull, 0.905);
    if (cfg.extraStrobes) {
        light(b, cx - hull.hw(0.05) * 0.7, hull.yAt(0.05), 'strobe');
        light(b, cx + hull.hw(0.05) * 0.7, hull.yAt(0.05), 'strobe');
    }
    // Jet-fan thruster pods on the rear quarters (the outer one of a pair a little further aft).
    const nr = W * (cfg.podsPerSide > 1 ? 0.22 : 0.3);
    for (let k = 0; k < cfg.podsPerSide; k++) {
        const yA = hull.yAt(0.78 + k * 0.03);
        const yB = hull.yAt(0.975) + k * nr * 0.2;
        for (const s of [-1, 1]) {
            const px = cx + s * (W + nr * (1.3 + k * 2.35));
            rect(gb, Math.min(cx + s * W * 0.9, px), (yA + yB) / 2 - nr * 0.45, Math.max(cx + s * W * 0.9, px), (yA + yB) / 2 + nr * 0.45, TURQ_DARK, 5, M_PAINT, P_PLATE, 0.4);
            b.rust.push([px - s * nr, (yA + yB) / 2 + nr * 0.45]);
            seg(gb, px, yA + nr, px, yB - nr * 0.2, nr, ENGINE, 5.5, M_METAL, 3.2, P_PLATE);
            gb.each(px - nr, yA, px + nr, yB, (i, _x, yy) => {
                if (gb.mat[i] !== M_METAL) return;
                const t = (yy - yA) / (yB - yA);
                if (Math.abs(t - 0.34) < 0.03) gb.set(i, COPPER, gb.hgt[i] + 0.05, M_COPPER);
                else if (t > 0.42 && t < 0.62) gb.tint(i, TURQ, 0.8);
                else if (t > 0.8) gb.tint(i, HEAT, 0.35 + 0.5 * ((t - 0.8) / 0.2));
            });
            circle(gb, px, yA + nr, nr * 0.98, METAL, 8.4, M_METAL, P_NONE, 0.6);
            fanFace(gb, px, yA + nr, nr * 0.84, 8.6, s);
            b.parts.push({ kind: 'fan', x: px, y: yA + nr, r: nr * 0.84, spin: (0.9 + k * 0.15) * s });
            circle(gb, px, yB - nr * 0.1, nr * 0.62, BLACK, 5, M_METAL);
            b.thrusters.push([Math.round(px - nr * 0.45), Math.round(px + nr * 0.45), Math.floor(yB) - 1]);
            light(b, px, yB - nr * 0.1, 'engine');
            const outer = k === cfg.podsPerSide - 1;
            if (outer) {
                light(b, px + s * nr * 0.85, yB - nr * 0.3, 'strobe');
                light(b, px + s * nr * 0.85, yA + nr * 0.4, s < 0 ? 'port' : 'starboard');
            }
        }
    }
}

/** The freighter: the container carrier at freighter hull sizes. */
function buildFreighter(b: Build): void {
    buildCarrier(b, { lengthFrac: 0.9, beam: 0.118, twinBridge: false, podsPerSide: 1, floodStep: 0.09, extraStrobes: false });
}

/**
 * The treasure ship: the carrier language much bigger — about twice the freighter-style hull's beam and 1.5× its
 * length (drawn larger through CONCORD_TREASURE_AREA_BOOST), many more container blocks, 4–6 gantries, twin bridge
 * towers, four jet-fan pods (two per rear quarter), more floodlights and strobes.
 */
function buildTreasure(b: Build): void {
    buildCarrier(b, { lengthFrac: 0.92, beam: 0.157, twinBridge: true, podsPerSide: 2, floodStep: 0.055, extraStrobes: true });
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

// ---------------------------------------------------------------------------------------------------------------
// Space fittings (military classes, explorer, construction ship, bases): the industrial finish, spaceship parts
// ---------------------------------------------------------------------------------------------------------------

/** Pale radiator panels. */
const RADIATOR: Rgb = [0.36, 0.42, 0.42];

/** Clears a band of the hull (the gaps an exposed spine truss spans). */
function clearBand(gb: GBuf, x0: number, y0: number, x1: number, y1: number): void {
    gb.each(x0, y0, x1, y1, (i) => {
        gb.mat[i] = 0;
        gb.hgt[i] = 0;
        gb.pat[i] = P_NONE;
    });
}

/** An exposed spine truss between hull sections: two rails, a lattice web and a copper feed pipe. */
function spineTruss(b: Build, cx: number, y0: number, y1: number, half: number): void {
    const { gb } = b;
    rect(gb, cx - half, y0, cx + half, y1, METAL, 2.2, M_METAL, P_LATTICE);
    for (const s of [-1, 1]) seg(gb, cx + s * half, y0, cx + s * half, y1, Math.max(0.35, half * 0.16), METAL, 3, M_METAL, 0.6);
    seg(gb, cx + half * 0.35, y0, cx + half * 0.35, y1, Math.max(0.3, half * 0.12), COPPER, 2.8, M_COPPER, 0.5);
    b.rust.push([cx - half, y1], [cx + half, y1]);
}

/** A module bolted onto the hull: bevelled plated block, corner bolts; taller modules cast shadows on the hull. */
function module(b: Build, x0: number, y0: number, x1: number, y1: number, h: number, c: Rgb): void {
    const { gb } = b;
    rect(gb, x0, y0, x1, y1, c, h, M_PAINT, P_PLATE, 0.6);
    const br = Math.max(0.3, Math.min(x1 - x0, y1 - y0) * 0.07);
    for (const [bx, by] of [
        [x0 + br * 1.6, y0 + br * 1.6],
        [x1 - br * 1.6, y0 + br * 1.6],
        [x0 + br * 1.6, y1 - br * 1.6],
        [x1 - br * 1.6, y1 - br * 1.6],
    ] as const) {
        circle(gb, bx, by, br, METAL, h + 0.2, M_METAL, P_NONE, 0.2);
    }
    b.rust.push([x0 + br, y1], [x1 - br, y1]);
}

/** Radiator fins along one flank (side −1 port, +1 starboard): ribbed panels standing off the hull. Returns the tips. */
function radiators(b: Build, hull: Hull, side: number, u0: number, u1: number, count: number, len: number, h: number): [number, number][] {
    const { gb } = b;
    const t = Math.max(0.45, hull.W * 0.07);
    const tips: [number, number][] = [];
    for (let k = 0; k < count; k++) {
        const u = u0 + ((u1 - u0) * (k + 0.5)) / count;
        const y = hull.yAt(u);
        const xa = hull.cx + side * hull.hw(u) * 0.9;
        const xb = xa + side * len;
        gb.each(Math.min(xa, xb), y - t, Math.max(xa, xb), y + t, (i, x, yy) => {
            const along = Math.abs(x - xa);
            const rib = ((along / 0.7) % 1) < 0.25;
            gb.set(i, along > len - 0.4 ? COPPER : RADIATOR, h - (rib ? 0.2 : 0) + 0.2 * (1 - Math.abs(yy - y) / t), along > len - 0.4 ? M_COPPER : M_METAL);
            if (rib) gb.mul(i, 0.78);
        });
        seg(gb, xa, y, xa + side * len * 0.3, y, t * 0.6, METAL, h + 0.4, M_METAL, 0.3);
        tips.push([xb - side * 0.4, y]);
    }
    return tips;
}

/** A reaction-control block: a small quad with nozzle ports facing out. */
function rcs(b: Build, x: number, y: number, s: number, outX: number, outY: number): void {
    const { gb } = b;
    rect(gb, x - s, y - s, x + s, y + s, METAL, 3.8, M_METAL, P_NONE, 0.3);
    circle(gb, x + outX * s * 0.7, y + outY * s * 0.7, s * 0.32, BLACK, 3.4, M_METAL);
    circle(gb, x + outX * s * 0.7 - outY * s * 0.55, y + outY * s * 0.7 + outX * s * 0.55, s * 0.24, BLACK, 3.4, M_METAL);
}

/** A docking collar: hazard-striped ring round an airlock hatch, with two marker lights. */
function dockingCollar(b: Build, x: number, y: number, r: number, h: number): void {
    const { gb } = b;
    gb.each(x - r, y - r, x + r, y + r, (i, px, py) => {
        const d = Math.hypot(px - x, py - y);
        if (d > r) return;
        if (d > r * 0.66) {
            const k = Math.floor((Math.atan2(py - y, px - x) / (2 * Math.PI)) * 16 + 16) & 1;
            gb.set(i, k === 0 ? HAZARD : BLACK, h + 0.5 * Math.sin(Math.PI * ((d - r * 0.66) / (r * 0.34))), M_PAINT);
        } else if (d > r * 0.56) gb.set(i, METAL, h + 0.3, M_METAL);
        else {
            const seam = Math.abs(px - x) < 0.15 || Math.abs(py - y) < 0.15;
            gb.set(i, seam ? BLACK : DECK_DARK, h - 0.4, M_METAL);
        }
    });
    light(b, x - r * 0.83, y, 'deck');
    light(b, x + r * 0.83, y, 'deck');
}

/** Dorsal comms array: mast, the turning dish, an antenna cluster (asymmetric), masthead light, optional strobes. */
function commsArray(b: Build, x: number, y: number, r: number, h: number, strobes: boolean): void {
    const { gb } = b;
    const ants: [number, number][] = [
        [-2.4, 1.15],
        [-0.95, 0.75],
        [0.6, 1.35],
        [2.1, 0.7],
    ];
    const tips: [number, number][] = [];
    for (const [a, l] of ants) {
        const tx = x + Math.cos(a) * r * l;
        const ty = y + Math.sin(a) * r * l;
        seg(gb, x, y, tx, ty, Math.max(0.25, r * 0.05), METAL, h - 0.6, M_METAL, 0.2);
        circle(gb, tx, ty, Math.max(0.35, r * 0.09), METAL, h - 0.3, M_METAL, P_NONE, 0.3);
        tips.push([tx, ty]);
    }
    circle(gb, x, y, Math.max(0.5, r * 0.26), METAL, h, M_METAL, P_NONE, 0.8);
    dishBaked(gb, x, y, r * 0.72, h + 0.6);
    b.parts.push({ kind: 'dish', x, y, r: r * 0.72, spin: 0.6 });
    light(b, x, y - r * 0.2, 'white');
    if (strobes) {
        light(b, tips[0][0], tips[0][1], 'strobe');
        light(b, tips[2][0], tips[2][1], 'strobe');
    }
}

/** Recessed beam emitter: cooling vanes round a raised ring, a dark well, a glass lens in a copper rim. */
function beamEmitter(b: Build, x: number, y: number, r: number): void {
    const { gb } = b;
    for (let k = 0; k < 10; k++) {
        const a = (k / 10) * 2 * Math.PI;
        seg(gb, x + Math.cos(a) * r * 0.95, y + Math.sin(a) * r * 0.95, x + Math.cos(a) * r * 1.38, y + Math.sin(a) * r * 1.38, Math.max(0.22, r * 0.07), METAL, 3.4, M_METAL, 0.2);
    }
    ring(gb, x, y, r * 0.68, r, WAR_GREY_DARK, 4.2, M_PAINT, P_PLATE);
    circle(gb, x, y, r * 0.68, BLACK, 2.2, M_METAL);
    ring(gb, x, y, r * 0.32, r * 0.42, COPPER, 2.8, M_COPPER);
    circle(gb, x, y, r * 0.32, GLASS, 2.6, M_GLASS, P_NONE, 0.8);
    b.rust.push([x - r, y + r * 0.5], [x + r, y + r * 0.5]);
}

/** A missile cell block with visible tube ends (dark bores in metal rims). */
function missileCells(b: Build, x0: number, y0: number, x1: number, y1: number): void {
    const { gb } = b;
    rect(gb, x0, y0, x1, y1, WAR_GREY_DARK, 2.9, M_PAINT, P_NONE, 0.3);
    const cols = Math.max(2, Math.round((x1 - x0) / 1.5));
    const rows = Math.max(2, Math.round((y1 - y0) / 1.5));
    const cw = (x1 - x0) / cols;
    const ch = (y1 - y0) / rows;
    const tr = Math.min(cw, ch) * 0.38;
    for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
            const cx = x0 + cw * (i + 0.5);
            const cy = y0 + ch * (j + 0.5);
            circle(gb, cx, cy, tr, METAL, 3.1, M_METAL, P_NONE, 0.15);
            circle(gb, cx, cy, tr * 0.62, BLACK, 2.3, M_METAL);
        }
    }
    b.rust.push([x0, y1], [x1, y1]);
}

/** Hangar bay doors: a recessed segmented door pair in a hazard frame, bay lights at the corners. */
function hangarDoors(b: Build, x0: number, y0: number, x1: number, y1: number, h: number): void {
    const { gb } = b;
    const f = Math.max(0.45, (x1 - x0) * 0.07);
    hazard(gb, x0, y0, x1, y1, h, Math.max(0.4, f * 0.8));
    gb.each(x0 + f, y0 + f, x1 - f, y1 - f, (i, x, y) => {
        const seamY = (((y - y0) / ((y1 - y0) / 5)) % 1) < 0.12;
        const split = Math.abs(x - (x0 + x1) / 2) < 0.18;
        gb.set(i, DECK_DARK, h - 0.7 - (seamY || split ? 0.25 : 0), M_METAL);
        if (seamY || split) gb.mul(i, 0.55);
    });
    light(b, x0 + f * 0.5, y0 + f * 0.5, 'deck');
    light(b, x1 - f * 0.5, y0 + f * 0.5, 'deck');
    light(b, x0 + f * 0.5, y1 - f * 0.5, 'deck');
    light(b, x1 - f * 0.5, y1 - f * 0.5, 'deck');
    b.rust.push([x0, y1], [x1, y1]);
}

/** Hull-hugging fuel tanks / cargo pods along one flank: banded cylinders with copper straps. */
function flankPods(b: Build, hull: Hull, side: number, u0: number, u1: number, count: number, r: number, c: Rgb): void {
    const { gb } = b;
    const span = (u1 - u0) / count;
    for (let k = 0; k < count; k++) {
        const ua = u0 + span * k + span * 0.08;
        const ub = u0 + span * (k + 1) - span * 0.08;
        const x = hull.cx + side * (hull.hw((ua + ub) / 2) + r * 0.55);
        const ya = hull.yAt(ua) + r;
        const yb = hull.yAt(ub) - r;
        seg(gb, x, ya, x, yb, r, c, 3.2, M_PAINT, 2.2, P_NONE);
        gb.each(x - r, ya - r, x + r, yb + r, (i, _x, y) => {
            if (gb.mat[i] !== M_PAINT) return;
            const t = (y - ya) / Math.max(1e-6, yb - ya);
            if (Math.abs(t - 0.25) < 0.035 || Math.abs(t - 0.75) < 0.035) gb.set(i, COPPER, gb.hgt[i] + 0.05, M_COPPER);
        });
        b.rust.push([x, yb + r]);
    }
}

/**
 * The engine cluster: an engine block across the stern and `n` nozzles — heat-stained bells, the outer pair on bigger
 * hulls as small jet-fan pods (the treasure ship's language) — with the thruster marks at the exits and a small
 * blue-white engine glow.
 */
function engineCluster(b: Build, hull: Hull, n: number, podPair: boolean): void {
    const { gb } = b;
    const { cx, W } = hull;
    const yT = hull.yAt(0.995);
    const bw = hull.hw(0.95) * 0.92;
    rect(gb, cx - bw, hull.yAt(0.9), cx + bw, yT, ENGINE, 3.4, M_METAL, P_GRATE, 0.5);
    const bells = podPair ? n - 2 : n;
    const r = Math.max(0.8, Math.min(W * 0.26, (bw * 1.8) / Math.max(1, bells) / 2.2));
    const bell = (x: number, y0: number, rr: number): void => {
        seg(gb, x, y0 - rr * 0.4, x, y0 + rr * 0.8, rr, METAL, 3.6, M_METAL, 1.4);
        gb.each(x - rr, y0, x + rr, y0 + rr * 1.8, (i, _x, y) => {
            if (gb.mat[i] !== M_METAL) return;
            gb.tint(i, HEAT, Math.min(0.85, 0.25 + 0.6 * ((y - y0) / (rr * 1.8))));
        });
        circle(gb, x, y0 + rr * 0.95, rr * 0.5, BLACK, 3, M_METAL);
        b.thrusters.push([Math.round(x - rr * 0.45), Math.round(x + rr * 0.45), Math.floor(y0 + rr * 1.1)]);
        light(b, x, y0 + rr * 0.95, 'engine');
    };
    for (let k = 0; k < bells; k++) {
        const x = bells === 1 ? cx : cx - bw * 0.62 + (bw * 1.24 * k) / (bells - 1);
        bell(x, yT, r);
    }
    if (podPair) {
        const pr = r * 0.9;
        for (const s of [-1, 1]) {
            const px = cx + s * (hull.hw(0.9) + pr * 1.3);
            const yA = hull.yAt(0.82);
            const yB = yT;
            rect(gb, Math.min(cx + s * hull.hw(0.88) * 0.9, px), (yA + yB) / 2 - pr * 0.4, Math.max(cx + s * hull.hw(0.88) * 0.9, px), (yA + yB) / 2 + pr * 0.4, TURQ_DARK, 4.4, M_PAINT, P_PLATE, 0.3);
            seg(gb, px, yA + pr, px, yB - pr * 0.2, pr, ENGINE, 4.6, M_METAL, 2.4, P_PLATE);
            circle(gb, px, yA + pr, pr * 0.96, METAL, 7, M_METAL, P_NONE, 0.5);
            fanFace(gb, px, yA + pr, pr * 0.82, 7.2, s);
            b.parts.push({ kind: 'fan', x: px, y: yA + pr, r: pr * 0.82, spin: 1.1 * s });
            bell(px, yB - pr * 0.4, pr * 0.8);
            b.rust.push([px - s * pr, (yA + yB) / 2 + pr * 0.4]);
        }
    }
    light(b, cx, hull.yAt(0.93), 'white');
}

/** A command module (no bridge wings): plated block, roof inset with copper trim, a row of lit windows forward. */
function commandModule(b: Build, cx: number, y0: number, y1: number, half: number, h: number, c: Rgb, trim: boolean): void {
    const { gb } = b;
    module(b, cx - half, y0, cx + half, y1, h, c);
    const rx = half * 0.72;
    const ry0 = y0 + (y1 - y0) * 0.25;
    const ry1 = y1 - (y1 - y0) * 0.16;
    rect(gb, cx - rx, ry0, cx + rx, ry1, DECK_DARK, h + 0.9, M_DECK, P_NONSKID, 0.3);
    if (trim) {
        gb.each(cx - rx, ry0, cx + rx, ry1, (i, x, y) => {
            if (Math.min(x - (cx - rx), cx + rx - x, y - ry0, ry1 - y) < 0.35) gb.set(i, COPPER, h + 1, M_COPPER);
        });
    }
    const step = Math.max(1, b.S * 0.0055);
    for (let x = cx - half + step * 0.6; x <= cx + half - step * 0.4; x += step) light(b, x, y0 + 0.35, 'window');
    glyph(gb, cx, (ry0 + ry1) / 2, Math.max(0.8, rx * 0.3), COPPER);
}

// ---------------------------------------------------------------------------------------------------------------
// Explorer, construction ship, military classes
// ---------------------------------------------------------------------------------------------------------------

function buildExplorer(b: Build): void {
    const { gb, S, spec } = b;
    const L = S * 0.8;
    const W = L * 0.112;
    const hull = roundedHull(S / 2, S * 0.08, L, W, 0.16, 0.08);
    const { cx } = hull;
    paintHull(b, hull, TURQ, DECK, true, P_PLATE, 0.9);
    circle(gb, cx, hull.yAt(0.075), W * 0.56, GLASS, 3, M_GLASS, P_NONE, 3);
    text(gb, `OC-${40 + spec.bucket}`, cx, hull.yAt(0.135), Math.max(0.3, W * 0.06), WHITE_PAINT, 2.4);
    for (const s of [-1, 1]) rcs(b, cx + s * hull.hw(0.13) * 0.72, hull.yAt(0.13), Math.max(0.55, W * 0.13), s, -0.3);
    commandModule(b, cx, hull.yAt(0.16), hull.yAt(0.27), W * 0.8, 8, TURQ_LIGHT, true);
    commsArray(b, cx + W * 0.1, hull.yAt(0.315), W * 0.9, 12, false);
    dockingCollar(b, cx - W * 0.35, hull.yAt(0.37), W * 0.4, 3.2);
    // Lab modules bolted on at different heights and offsets.
    const mods: [number, number, number, number, number][] = [
        [0.41, 0.48, 0.2, 0.62, 6],
        [0.49, 0.58, -0.15, 0.72, 8.6],
        [0.59, 0.66, 0.05, 0.55, 5.4],
    ];
    for (const [u0, u1, off, hwm, h] of mods) {
        module(b, cx + W * (off - hwm), hull.yAt(u0), cx + W * (off + hwm), hull.yAt(u1), h, TURQ_LIGHT);
        rect(gb, cx + W * (off - hwm * 0.5), hull.yAt(u0 + 0.015), cx + W * (off + hwm * 0.5), hull.yAt(u1 - 0.015), METAL, h + 0.5, M_METAL, P_GRATE, 0.2);
        light(b, cx + W * (off - hwm) + 0.3, hull.yAt((u0 + u1) / 2), 'window');
        light(b, cx + W * (off + hwm) - 0.3, hull.yAt((u0 + u1) / 2), 'window');
    }
    const port = radiators(b, hull, -1, 0.44, 0.64, 3, W * 1.05, 2.8);
    const star = radiators(b, hull, 1, 0.47, 0.62, 2, W * 0.8, 2.8);
    light(b, port[0][0], port[0][1], 'port');
    light(b, star[0][0], star[0][1], 'starboard');
    hangarDoors(b, cx - W * 0.55, hull.yAt(0.7), cx + W * 0.55, hull.yAt(0.82), 2.6);
    for (const s of [-1, 1]) rcs(b, cx + s * hull.hw(0.86) * 0.78, hull.yAt(0.86), Math.max(0.55, W * 0.13), s, 0.3);
    engineCluster(b, hull, spec.engines, false);
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
    const L = S * 0.78;
    const W = L * 0.169;
    const hull = roundedHull(S / 2, S * 0.08, L, W, 0.14, 0.2);
    const { cx } = hull;
    paintHull(b, hull, TURQ, DECK, true, P_GRATE, 0.9);
    text(gb, `OC-${70 + spec.bucket}`, cx, hull.yAt(0.06), Math.max(0.3, W * 0.05), WHITE_PAINT, 2.4);
    for (const s of [-1, 1]) rcs(b, cx + s * hull.hw(0.08) * 0.72, hull.yAt(0.08), Math.max(0.6, W * 0.1), s, -0.4);
    // Materials in a few containers on the bow section, a docking collar beside them.
    const cw = (W * 0.9) / 3;
    for (let c = 0; c < 3; c++) {
        for (let bay = 0; bay < 2; bay++) {
            const x0 = cx - W * 0.75 + c * cw + 0.1;
            const y0 = hull.yAt(0.11) + bay * cw * 1.3;
            container(b, x0, y0, x0 + cw - 0.2, y0 + cw * 1.25, CONTAINERS[Math.floor(rng() * CONTAINERS.length)], 1 + Math.floor(rng() * 2));
        }
    }
    dockingCollar(b, cx + W * 0.5, hull.yAt(0.16), W * 0.3, 3.2);
    // Exposed spine truss to the work section.
    clearBand(gb, cx - W * 1.2, hull.yAt(0.25), cx + W * 1.2, hull.yAt(0.3));
    spineTruss(b, cx, hull.yAt(0.25) - 0.3, hull.yAt(0.3) + 0.3, W * 0.3);
    // Work section: truss frames with stacked beams, hazard-striped edges, the big crane.
    const t0 = hull.yAt(0.34);
    const t1 = hull.yAt(0.66);
    const bw = Math.max(0.5, W * 0.07);
    for (const s of [-1, 1]) {
        rect(gb, cx + s * W * 0.72 - bw, t0, cx + s * W * 0.72 + bw, t1, OCHRE, 5, M_METAL, P_LATTICE);
        hazard(gb, cx + s * hull.hw(0.5) - s * Math.max(0.6, W * 0.06) - 0.4, t0, cx + s * hull.hw(0.5) - s * Math.max(0.6, W * 0.06) + 0.4, t1, 2.6, Math.max(0.5, W * 0.05));
    }
    for (let k = 0; k <= 3; k++) rect(gb, cx - W * 0.72, t0 + ((t1 - t0) * k) / 3 - bw, cx + W * 0.72, t0 + ((t1 - t0) * k) / 3 + bw, OCHRE, 5.2, M_METAL, P_LATTICE);
    for (let k = 0; k < 4; k++) seg(gb, cx - W * 0.5, t0 + (t1 - t0) * (0.12 + k * 0.08), cx + W * 0.5, t0 + (t1 - t0) * (0.12 + k * 0.08), Math.max(0.3, W * 0.04), METAL, 3.2, M_METAL, 0.4);
    const px = cx + W * 0.35;
    const py = hull.yAt(0.36);
    const tx = cx - W * 1.9;
    const ty = hull.yAt(0.2);
    circle(gb, px, py, W * 0.26, OCHRE, 6, M_METAL, P_NONE, 0.8);
    seg(gb, px, py, tx, ty, Math.max(0.55, W * 0.085), OCHRE, 9, M_METAL, 0.5, P_LATTICE);
    rect(gb, tx - W * 0.12, ty - W * 0.12, tx + W * 0.12, ty + W * 0.12, METAL, 9.5, M_METAL, P_NONE, 0.2);
    hazard(gb, tx - W * 0.12, ty + W * 0.12, tx + W * 0.12, ty + W * 0.22, 9.4, Math.max(0.4, W * 0.04));
    light(b, tx, ty, 'flood');
    // Workshop (starboard-offset), radiators to starboard, command module and comms mast aft.
    module(b, cx - W * 0.45, hull.yAt(0.69), cx + W * 0.85, hull.yAt(0.79), 7, TURQ_LIGHT);
    for (let k = 0; k < 3; k++) rect(gb, cx - W * 0.25 + k * W * 0.35, hull.yAt(0.715), cx - W * 0.08 + k * W * 0.35, hull.yAt(0.76), METAL, 7.6, M_METAL, P_GRATE, 0.2);
    for (let x = cx - W * 0.4; x < cx + W * 0.8; x += Math.max(1, S * 0.0055)) light(b, x, hull.yAt(0.69) + 0.35, 'window');
    const star = radiators(b, hull, 1, 0.68, 0.84, 3, W * 0.7, 2.8);
    commandModule(b, cx - W * 0.2, hull.yAt(0.81), hull.yAt(0.88), W * 0.5, 8.4, TURQ_LIGHT, true);
    commsArray(b, cx - W * 0.55, hull.yAt(0.745), W * 0.4, 10.5, false);
    light(b, cx - hull.hw(0.5) + 0.4, hull.yAt(0.5), 'port');
    light(b, star[1][0], star[1][1], 'starboard');
    engineCluster(b, hull, spec.engines, false);
}

/** Per-class layout of the military hulls (all wider than a naval hull: the modules need room). */
interface MilitaryCfg {
    lengthFrac: number;
    beam: number;
    /** Beam mounts: [u, x offset in beams, radius in beams]. */
    mounts: [number, number, number][];
    /** Missile cell blocks: [u0, u1, x0, x1] (x in beams). */
    cells: [number, number, number, number][];
    /** Superstructure tiers (outer first): [u0, u1, half-width in beams, height]. */
    tiers: [number, number, number, number][];
    /** Bolted modules: [u0, u1, x0, x1, height]. */
    modules: [number, number, number, number, number][];
    mast: { u: number; x: number; r: number; h: number };
    fins: { port: [number, number, number, number]; star: [number, number, number, number] };
    hangar: [number, number] | null;
    armour: boolean;
    collar: [number, number] | null;
}

const MILITARY: Readonly<Record<'frigate' | 'destroyer' | 'battleship', MilitaryCfg>> = {
    frigate: {
        lengthFrac: 0.84,
        beam: 0.14,
        mounts: [[0.18, 0, 0.3]],
        cells: [[0.25, 0.3, -0.45, 0.35]],
        tiers: [
            [0.34, 0.53, 0.62, 7.5],
            [0.37, 0.48, 0.4, 9.8],
        ],
        modules: [[0.6, 0.68, 0.35, 0.85, 5]],
        mast: { u: 0.55, x: -0.1, r: 0.42, h: 12.5 },
        fins: { port: [0.62, 0.76, 2, 0.45], star: [0.7, 0.8, 2, 0.35] },
        hangar: null,
        armour: false,
        collar: [0.42, -0.6],
    },
    destroyer: {
        lengthFrac: 0.86,
        beam: 0.15,
        mounts: [
            [0.17, 0, 0.3],
            [0.7, 0.2, 0.26],
        ],
        cells: [
            [0.235, 0.29, -0.52, 0.42],
            [0.6, 0.645, -0.62, -0.05],
        ],
        tiers: [
            [0.33, 0.55, 0.66, 8],
            [0.36, 0.49, 0.46, 10.5],
        ],
        modules: [
            [0.43, 0.5, -1.0, -0.5, 6.2],
            [0.74, 0.8, 0.4, 0.92, 4.6],
        ],
        mast: { u: 0.52, x: 0.12, r: 0.56, h: 15 },
        fins: { port: [0.6, 0.76, 3, 0.5], star: [0.58, 0.7, 2, 0.42] },
        hangar: null,
        armour: false,
        collar: [0.38, 0.62],
    },
    battleship: {
        lengthFrac: 0.88,
        beam: 0.17,
        mounts: [
            [0.14, -0.3, 0.26],
            [0.21, 0.32, 0.26],
            [0.66, -0.38, 0.24],
            [0.73, 0.34, 0.24],
        ],
        cells: [
            [0.265, 0.31, -0.6, 0.6],
            [0.585, 0.625, -0.7, -0.08],
            [0.6, 0.64, 0.12, 0.66],
        ],
        tiers: [
            [0.32, 0.57, 0.72, 8],
            [0.35, 0.52, 0.52, 10.5],
            [0.38, 0.47, 0.32, 13],
        ],
        modules: [
            [0.34, 0.42, 0.62, 1.04, 5.6],
            [0.46, 0.55, -1.06, -0.6, 7],
            [0.77, 0.82, -0.95, -0.5, 4.4],
        ],
        mast: { u: 0.545, x: 0.05, r: 0.5, h: 16 },
        fins: { port: [0.6, 0.76, 4, 0.5], star: [0.66, 0.78, 3, 0.4] },
        hangar: [0.78, 0.87],
        armour: true,
        collar: [0.44, 0.7],
    },
};

/**
 * Frigate / destroyer / battleship: an angular grey hull (heavy rust and salt), recessed beam emitters with cooling
 * vanes, missile cells with tube ends, a faceted layered superstructure with copper trim on the bridge roof only,
 * bolted modules at different heights, a dorsal comms mast with strobes, radiator fins, RCS blocks, a docking collar,
 * hangar doors and an armour belt on the battleship, and the stern engine cluster.
 */
function buildMilitary(b: Build, cls: 'frigate' | 'destroyer' | 'battleship'): void {
    const { gb, S, spec } = b;
    const cfg = MILITARY[cls];
    const L = S * cfg.lengthFrac;
    const W = L * cfg.beam;
    const cx = S / 2;
    const bowY = (S - L) / 2 - S * 0.025;
    const knots: [number, number][] = [
        [0, 0.06],
        [0.1, 0.55],
        [0.28, 0.92],
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
    const X = (k: number): number => cx + k * W;
    paintHull(b, hull, WAR_GREY, WAR_DECK, false, P_NONSKID, 2);
    // Chine crease; the battleship's armour belt (raised band of heavy plates along both flanks).
    gb.each(cx - W, bowY, cx + W, bowY + L, (i, x, y) => {
        if (gb.mat[i] === 0) return;
        const u = (y - bowY) / L;
        const a = Math.abs(x - cx) / hw(u);
        if (Math.abs(a - 0.62) * hw(u) < 0.3) gb.hgt[i] += 0.35;
        if (cfg.armour && a > 0.68 && a < 0.9 && u > 0.12 && u < 0.9) {
            const seam = ((y - bowY) / (W * 0.55)) % 1 < 0.06 || Math.abs(a - 0.68) * hw(u) < 0.25;
            gb.set(i, seam ? WAR_GREY_DARK : WAR_GREY, gb.hgt[i] + (seam ? 0.3 : 0.8), M_PAINT);
            if (seam) gb.mul(i, 0.7);
        }
    });
    const num = `${(cls === 'frigate' ? 5 : cls === 'destroyer' ? 17 : 41) + spec.bucket * 3}`;
    text(gb, num, cx, hull.yAt(0.075), Math.max(0.3, W * 0.06), WHITE_PAINT, 2.4);
    for (const s of [-1, 1]) rcs(b, cx + s * hw(0.12) * 0.72, hull.yAt(0.12), Math.max(0.6, W * 0.08), s, -0.4);
    for (const [u, xo, r] of cfg.mounts) beamEmitter(b, X(xo), hull.yAt(u), W * r);
    for (const [u0, u1, x0, x1] of cfg.cells) missileCells(b, X(x0), hull.yAt(u0), X(x1), hull.yAt(u1));
    // Layered, faceted superstructure; copper trim on the top (bridge) tier only.
    cfg.tiers.forEach(([u0, u1, half, h], k) => {
        const du = (u1 - u0) * 0.12;
        const pts: [number, number][] = [
            [X(-half * 0.7), hull.yAt(u0)],
            [X(half * 0.7), hull.yAt(u0)],
            [X(half), hull.yAt(u0 + du)],
            [X(half), hull.yAt(u1 - du * 0.5)],
            [X(half * 0.8), hull.yAt(u1)],
            [X(-half * 0.8), hull.yAt(u1)],
            [X(-half), hull.yAt(u1 - du * 0.5)],
            [X(-half), hull.yAt(u0 + du)],
        ];
        const top = k === cfg.tiers.length - 1;
        poly(gb, pts, k % 2 === 0 ? WAR_GREY : WAR_GREY_DARK, h, M_PAINT, P_PLATE, 0.8);
        if (top) {
            gb.each(X(-half), hull.yAt(u0), X(half), hull.yAt(u1), (i, x, y) => {
                if (gb.hgt[i] < h - 0.5) return;
                let e = Infinity;
                for (let q = 0, m = pts.length - 1; q < pts.length; m = q++) e = Math.min(e, segDist(x, y, pts[q][0], pts[q][1], pts[m][0], pts[m][1]));
                if (e < 0.4) gb.set(i, COPPER, h + 0.1, M_COPPER);
            });
            for (let x = X(-half * 0.6); x <= X(half * 0.6); x += Math.max(0.9, S * 0.005)) light(b, x, hull.yAt(u0) + 0.4, 'window');
        }
        b.rust.push([X(-half), hull.yAt(u1)], [X(half), hull.yAt(u1)]);
    });
    for (const [u0, u1, x0, x1, h] of cfg.modules) module(b, X(x0), hull.yAt(u0), X(x1), hull.yAt(u1), h, WAR_GREY_DARK);
    if (cfg.collar !== null) dockingCollar(b, X(cfg.collar[1]), hull.yAt(cfg.collar[0]), W * 0.2, 3.2);
    commsArray(b, X(cfg.mast.x), hull.yAt(cfg.mast.u), W * cfg.mast.r, cfg.mast.h, true);
    const pf = radiators(b, hull, -1, cfg.fins.port[0], cfg.fins.port[1], cfg.fins.port[2], W * cfg.fins.port[3], 3);
    const sf = radiators(b, hull, 1, cfg.fins.star[0], cfg.fins.star[1], cfg.fins.star[2], W * cfg.fins.star[3], 3);
    light(b, pf[0][0], pf[0][1], 'port');
    light(b, sf[0][0], sf[0][1], 'starboard');
    if (cfg.hangar !== null) hangarDoors(b, X(-0.5), hull.yAt(cfg.hangar[0]), X(0.5), hull.yAt(cfg.hangar[1]), 2.6);
    for (const s of [-1, 1]) rcs(b, cx + s * hw(0.9) * 0.8, hull.yAt(0.9), Math.max(0.6, W * 0.08), s, 0.4);
    for (let u = 0.08; u < 0.97; u += 0.035) for (const s of [-1, 1]) b.rust.push([cx + s * (hw(u) - 0.5), hull.yAt(u)]);
    engineCluster(b, hull, spec.engines, false);
}

/** A small ship silhouette cradled at a dock (pointing along `ax, ay`). */
function cradledShip(b: Build, x: number, y: number, ax: number, ay: number, len: number): void {
    const { gb } = b;
    const w = len * 0.2;
    gb.each(x - len, y - len, x + len, y + len, (i, px, py) => {
        const along = (px - x) * ax + (py - y) * ay; // + = outward (bow)
        const across = -(px - x) * ay + (py - y) * ax;
        const u = (len / 2 - along) / len; // 0 bow … 1 stern
        if (u < 0 || u > 1) return;
        const hw = w * (u < 0.25 ? 0.4 + 0.6 * (u / 0.25) : 1);
        if (Math.abs(across) > hw) return;
        const tone = Math.abs(across) > hw * 0.7 ? TURQ_DARK : u > 0.55 && u < 0.8 ? TURQ_LIGHT : WAR_GREY_DARK;
        gb.set(i, tone, 6 + 1.2 * (1 - Math.abs(across) / hw) + (u > 0.55 && u < 0.8 ? 1 : 0), M_PAINT, P_PLATE);
    });
    light(b, x - ax * len * 0.45, y - ay * len * 0.45, 'engine');
    light(b, x + ax * len * 0.1, y + ay * len * 0.1, 'window');
}

/**
 * Bases and the space port: a heavy hub and ring (thick structure), an inner habitat ring and stacked module blocks at
 * different heights, irregular window rows, radiator arrays, fuel tank clusters, an antenna forest and turning dishes,
 * docking arms with cradled ships and worn hazard stripes, RCS blocks with scorch; heavier weathering than the ships
 * (rust bloom at welds, patched plates, micrometeorite pitting on the outer ring). The port is bigger and busier.
 */
function buildBase(b: Build): void {
    const { gb, S, spec, rng } = b;
    const port = spec.kind === 'port';
    const c = S / 2;
    const ringR = S * (port ? 0.32 : 0.3);
    const ringW = S * 0.056;
    const hubR = S * (port ? 0.16 : 0.14);
    const wearN = valueNoise(211);
    const wear = (x: number, y: number): number => fbm2(wearN, x * 0.6, y * 0.6) + 0.5;
    // Spokes: heavy girders with pipe runs.
    const spokes = port ? 6 : 4;
    for (let k = 0; k < spokes; k++) {
        const a = (k / spokes) * 2 * Math.PI + Math.PI / spokes;
        const ax = Math.cos(a);
        const ay = Math.sin(a);
        seg(gb, c + ax * hubR, c + ay * hubR, c + ax * ringR, c + ay * ringR, S * 0.019, METAL, 4, M_METAL, 1.1, P_PLATE);
        for (const off of [-0.026, 0.026]) {
            const nx = -ay * S * off;
            const ny = ax * S * off;
            seg(gb, c + ax * hubR + nx, c + ay * hubR + ny, c + ax * ringR + nx, c + ay * ringR + ny, S * 0.005, off < 0 ? COPPER : METAL, 3.6, off < 0 ? M_COPPER : M_METAL, 0.6);
        }
    }
    // Inner habitat ring (arcs at a different height), fuel tank clusters between the spokes.
    const habR = (hubR + ringR) / 2 + S * 0.01;
    gb.each(c - habR - S * 0.03, c - habR - S * 0.03, c + habR + S * 0.03, c + habR + S * 0.03, (i, x, y) => {
        const d = Math.hypot(x - c, y - c);
        const t = (d - habR) / (S * 0.022);
        if (Math.abs(t) > 1) return;
        const a = (Math.atan2(y - c, x - c) + 2 * Math.PI) % (2 * Math.PI);
        if ((a > 0.4 && a < 1.2) || (a > 3.3 && a < 3.9)) return; // gaps in the arcs
        gb.set(i, Math.abs(t) > 0.75 ? TURQ_DARK : TURQ_LIGHT, 9 + 1.5 * Math.sqrt(1 - t * t), M_PAINT, P_PLATE);
    });
    for (let k = 0; k < 60; k++) {
        const a = (k / 60) * 2 * Math.PI;
        if (hash2(k, 31) < 0.35 || (a > 0.4 && a < 1.2) || (a > 3.3 && a < 3.9)) continue;
        light(b, c + habR * Math.cos(a), c + habR * Math.sin(a), 'window');
    }
    const clusters = spec.tanks;
    for (let k = 0; k < clusters; k++) {
        const a = ((k + 0.5) / clusters) * 2 * Math.PI + 0.9;
        const r = hubR + (habR - hubR) * 0.55;
        const tr = S * (port ? 0.022 : 0.028);
        for (let q = 0; q < 3; q++) {
            const aa = a + (q - 1) * (tr * 2.1) / r;
            const tx = c + r * Math.cos(aa);
            const ty = c + r * Math.sin(aa);
            const col = [TURQ_LIGHT, WHITE_PAINT, COPPER][(k + q) % 3];
            circle(gb, tx, ty, tr, col, 4.5, (k + q) % 3 === 2 ? M_COPPER : M_PAINT, P_NONE, 5);
            ring(gb, tx, ty, tr * 0.46, tr * 0.54, METAL, 9, M_METAL);
            b.rust.push([tx, ty + tr]);
        }
        seg(gb, c + hubR * Math.cos(a), c + hubR * Math.sin(a), c + r * Math.cos(a), c + r * Math.sin(a), S * 0.005, METAL, 3.4, M_METAL, 0.5);
    }
    // The outer ring: thick plated torus, copper trim lines, micrometeorite pitting on the outer band, window rows.
    const pits = valueNoise(223);
    gb.each(c - ringR - ringW, c - ringR - ringW, c + ringR + ringW, c + ringR + ringW, (i, x, y) => {
        const d = Math.hypot(x - c, y - c);
        const t = (d - ringR) / ringW;
        if (Math.abs(t) > 1) return;
        let hgt = 5.5 + 2 * Math.sqrt(Math.max(0, 1 - t * t));
        let colr: Rgb = Math.abs(t) < 0.35 ? DECK : TURQ;
        let mat = Math.abs(t) < 0.35 ? M_DECK : M_PAINT;
        if (Math.abs(Math.abs(t) - 0.62) < 0.05) {
            colr = COPPER;
            mat = M_COPPER;
        }
        gb.set(i, colr, hgt, mat, mat === M_COPPER ? P_NONE : P_PLATE);
        if (t > 0.4 && pits(x * 2.2, y * 2.2) > 0.86) {
            hgt -= 0.35;
            gb.hgt[i] = hgt;
            gb.mul(i, 0.55);
        }
    });
    for (const [rr, spacing, seed] of [
        [ringR + ringW * 0.8, 1.2, 7],
        [ringR - ringW * 0.8, 1.35, 11],
        [ringR + ringW * 0.5, 1.6, 13],
    ] as const) {
        const n = Math.round((2 * Math.PI * rr) / Math.max(spacing, S * 0.006 * spacing));
        for (let k = 0; k < n; k++) {
            if (hash2(k, seed) < 0.38 || hash2(Math.floor(k / 7), seed + 1) < 0.2) continue;
            const a = (k / n) * 2 * Math.PI;
            light(b, c + rr * Math.cos(a), c + rr * Math.sin(a), 'window');
        }
    }
    // Radiator arrays (three parallel panels each) off the outer ring, at uneven angles.
    const arrays = port ? [0.55, 1.7, 2.75, 4.45, 5.4] : [0.8, 2.9, 4.9];
    for (const a of arrays) {
        const ax = Math.cos(a);
        const ay = Math.sin(a);
        for (const off of [-0.03, 0, 0.03]) {
            const aa = a + off;
            const bx = Math.cos(aa);
            const by = Math.sin(aa);
            const r0 = ringR + ringW * 0.8;
            const r1 = ringR + S * 0.09;
            const t = S * 0.008;
            gb.each(c + Math.min(bx * r0, bx * r1) - t * 2, c + Math.min(by * r0, by * r1) - t * 2, c + Math.max(bx * r0, bx * r1) + t * 2, c + Math.max(by * r0, by * r1) + t * 2, (i, x, y) => {
                const along = (x - c) * bx + (y - c) * by;
                const across = -(x - c) * by + (y - c) * bx;
                if (along < r0 || along > r1 || Math.abs(across) > t) return;
                const rib = (((along - r0) / 0.7) % 1) < 0.25;
                gb.set(i, RADIATOR, 3.8 - (rib ? 0.2 : 0), M_METAL);
                if (rib) gb.mul(i, 0.78);
            });
        }
        void ax;
        void ay;
    }
    // Stacked module blocks on the ring (two levels), with windows and a turning dish on some.
    const mods = port ? [1.25, 2.2, 3.55, 4.9, 5.85] : [1.6, 4.1];
    mods.forEach((a, k) => {
        const mx = c + ringR * Math.cos(a);
        const my = c + ringR * Math.sin(a);
        const m = S * 0.04;
        module(b, mx - m, my - m * 0.75, mx + m, my + m * 0.75, 9.5, TURQ_LIGHT);
        module(b, mx - m * 0.55, my - m * 0.45, mx + m * 0.45, my + m * 0.4, 12.5, k % 2 ? TURQ_DARK : TURQ);
        for (let q = 0; q < 5; q++) if (hash2(k, q) > 0.3) light(b, mx - m * 0.8 + q * m * 0.4, my - m * 0.62, 'window');
        if (k % 2 === 0) {
            dishBaked(gb, mx, my, m * 0.5, 13.4);
            b.parts.push({ kind: 'dish', x: mx, y: my, r: m * 0.5, spin: 0.3 + k * 0.07 });
        }
    });
    // RCS blocks with scorch marks.
    for (let k = 0; k < 6; k++) {
        const a = (k / 6) * 2 * Math.PI + 0.25;
        const ax = Math.cos(a);
        const ay = Math.sin(a);
        const rx = c + (ringR + ringW * 0.6) * ax;
        const ry = c + (ringR + ringW * 0.6) * ay;
        gb.each(rx - S * 0.03, ry - S * 0.03, rx + S * 0.03, ry + S * 0.03, (i, x, y) => {
            const d = Math.hypot(x - rx - ax * S * 0.01, y - ry - ay * S * 0.01);
            if (gb.mat[i] !== 0 && d < S * 0.028) gb.tint(i, BLACK, 0.5 * (1 - d / (S * 0.028)));
        });
        rcs(b, rx, ry, S * 0.011, ax, ay);
    }
    // Docking arms: thick, worn hazard stripes at the ends, cradled ships, gantries over the ring, floodlights.
    for (let k = 0; k < spec.docks; k++) {
        const a = (k / spec.docks) * 2 * Math.PI;
        const ax = Math.cos(a);
        const ay = Math.sin(a);
        const r0 = ringR + ringW * 0.8;
        const r1 = ringR + S * 0.095;
        const w = S * 0.015;
        seg(gb, c + ax * r0, c + ay * r0, c + ax * r1, c + ay * r1, w, TURQ_DARK, 4.8, M_PAINT, 0.8, P_PLATE);
        gb.each(c + ax * r1 - w * 5, c + ay * r1 - w * 5, c + ax * r1 + w * 5, c + ay * r1 + w * 5, (i, x, y) => {
            const along = (x - c) * ax + (y - c) * ay;
            const across = -(x - c) * ay + (y - c) * ax;
            if (along < r1 - (r1 - r0) * 0.3 || along > r1 || Math.abs(across) > w) return;
            if (wear(x, y) > 0.62) gb.set(i, METAL, 5, M_METAL);
            else gb.set(i, Math.floor((along + across) / Math.max(0.5, w * 0.6)) & 1 ? HAZARD : BLACK, 5, M_PAINT);
        });
        for (const s of [-1, 1]) seg(gb, c + ax * r1 - ay * s * w * 2.6, c + ay * r1 + ax * s * w * 2.6, c + ax * (r1 + w * 4) - ay * s * w * 2.6, c + ay * (r1 + w * 4) + ax * s * w * 2.6, w * 0.4, METAL, 5, M_METAL, 0.3);
        if (port || k % 2 === 0) cradledShip(b, c + ax * (r1 + w * 2.4), c + ay * (r1 + w * 2.4), ax, ay, w * 3.6);
        else dockingCollar(b, c + ax * (r1 + w * 1.6), c + ay * (r1 + w * 1.6), w * 1.6, 5.2);
        light(b, c + ax * (r1 - w * 2.5) - ay * w * 0.6, c + ay * (r1 - w * 2.5) + ax * w * 0.6, 'flood');
        if (k % 2 === 1) light(b, c + ax * (r1 + w * 4) - ay * w * 2.6, c + ay * (r1 + w * 4) + ax * w * 2.6, 'strobe');
        const gx = c + ax * ringR;
        const gy = c + ay * ringR;
        seg(gb, gx - ay * S * 0.07, gy + ax * S * 0.07, gx + ay * S * 0.07, gy - ax * S * 0.07, S * 0.008, OCHRE, 11.5, M_METAL, 0.3, P_LATTICE);
        b.rust.push([c + ax * r1, c + ay * r1]);
    }
    if (port) {
        for (const a of [0.9, 3.9, 5.1]) {
            const ax = Math.cos(a);
            const ay = Math.sin(a);
            circle(gb, c + ax * ringR, c + ay * ringR, S * 0.02, OCHRE, 8, M_METAL, P_NONE, 0.8);
            seg(gb, c + ax * ringR, c + ay * ringR, c + ax * (ringR + S * 0.1) - ay * S * 0.045, c + ay * (ringR + S * 0.1) + ax * S * 0.045, S * 0.006, OCHRE, 10, M_METAL, 0.3, P_LATTICE);
        }
    }
    // Hub: heavy plated drum, copper trim, stacked roof decks, radiator panels, antenna forest, comms array.
    circle(gb, c, c, hubR, TURQ_LIGHT, 9, M_PAINT, P_PLATE, 3);
    ring(gb, c, c, hubR * 0.93, hubR * 0.97, COPPER, 11.4, M_COPPER);
    circle(gb, c, c, hubR * 0.7, DECK_DARK, 12.5, M_DECK, P_NONSKID, 0.6);
    circle(gb, c - hubR * 0.12, c + hubR * 0.08, hubR * 0.42, TURQ, 14, M_PAINT, P_PLATE, 0.8);
    for (let k = 0; k < 5; k++) {
        const a = (k / 5) * 2 * Math.PI + 0.5;
        const px = c + hubR * 0.52 * Math.cos(a);
        const py = c + hubR * 0.52 * Math.sin(a);
        rect(gb, px - hubR * 0.1, py - hubR * 0.1, px + hubR * 0.1, py + hubR * 0.1, METAL, 13.2, M_METAL, P_GRATE, 0.2);
    }
    for (let k = 0; k < (port ? 16 : 10); k++) {
        const a = rng() * 2 * Math.PI;
        const r0 = hubR * (0.2 + rng() * 0.35);
        const len = hubR * (0.12 + rng() * 0.22);
        const x0 = c + r0 * Math.cos(a);
        const y0 = c + r0 * Math.sin(a);
        seg(gb, x0, y0, x0 + len * Math.cos(a + 0.6), y0 + len * Math.sin(a + 0.6), Math.max(0.25, S * 0.0018), METAL, 16 + rng() * 2, M_METAL, 0.2);
        circle(gb, x0 + len * Math.cos(a + 0.6), y0 + len * Math.sin(a + 0.6), Math.max(0.3, S * 0.0028), METAL, 17, M_METAL, P_NONE, 0.2);
    }
    commsArray(b, c + hubR * 0.15, c - hubR * 0.2, S * 0.065, 17.5, false);
    glyph(gb, c - hubR * 0.12, c + hubR * 0.08, hubR * 0.2, COPPER);
    const hn = Math.round((2 * Math.PI * hubR) / Math.max(1.1, S * 0.006));
    for (const rr of [0.88, 0.78]) {
        for (let k = 0; k < hn; k++) {
            if (rng() < 0.3) continue;
            const a = (k / hn) * 2 * Math.PI;
            light(b, c + hubR * rr * Math.cos(a), c + hubR * rr * Math.sin(a), 'window');
        }
    }
    // Positional lights at the extremities: red to port (−x), green to starboard (+x), white fore and aft.
    const ext = ringR + ringW * 0.9;
    light(b, c - ext, c, 'port');
    light(b, c + ext, c, 'starboard');
    light(b, c, c - ext, 'white');
    light(b, c, c + ext, 'white');
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
    const station = spec.kind === 'port' || spec.kind === 'base';
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
                if (station && hash2(row + 97, col) < 0.09) gb.tint(c, hash2(row, col + 5) < 0.5 ? METAL : TURQ_DARK, 0.45); // patched plate
                if (fy < seamW || fx < seamW) {
                    if (weld) {
                        gb.hgt[c] += 0.12;
                        gb.mul(c, 1.07);
                        if (station) gb.tint(c, RUST, 0.5);
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
    if (isConcordMilitary(spec.kind)) {
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
export type ConcordLightGroup = 'steady' | 'flood' | 'nav' | 'strobe' | 'engine';
export const CONCORD_LIGHT_GROUPS: readonly ConcordLightGroup[] = ['steady', 'flood', 'nav', 'strobe', 'engine'];

export function concordLightGroup(kind: ConcordLightKind): ConcordLightGroup {
    if (kind === 'flood') return 'flood';
    if (kind === 'port' || kind === 'starboard') return 'nav';
    if (kind === 'strobe') return 'strobe';
    if (kind === 'engine') return 'engine';
    return 'steady';
}

/** Tight halos (σ ≈ 1.2 × the light's radius) of one blink group, each in its own colour. */
function haloImage(S: number, lights: readonly ConcordLight[]): RgbaImage {
    const acc = new Float64Array(S * S * 4);
    for (const l of lights) {
        const sg = Math.max(0.6, l.r * (l.kind === 'flood' || l.kind === 'engine' ? 1.6 : l.kind === 'strobe' ? 1.8 : 1.2));
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
        case 'frigate':
        case 'destroyer':
        case 'battleship':
            buildMilitary(b, kind);
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

/** Contrast (luma standard deviation, opaque pixels) of the original Ackdarian portrait (images/units/races/race_7.png,
 * the art the Oranthi race file borrows): the Concord portrait is held at least this contrasty. */
export const ACKDARIAN_PORTRAIT_STDL = 0.243;

interface MaskPt {
    /** Height (relief), 0 outside the mask. */
    h: number;
    /** 0 none, 1 copper plate, 2 void (eye slits, mouth), 3 engraved groove. */
    m: number;
    /** Plate id (tone variation per layered plate). */
    plate: number;
}

function inQuad(x: number, y: number, q: readonly (readonly [number, number])[]): boolean {
    let inside = false;
    for (let k = 0, m = q.length - 1; k < q.length; m = k++) {
        const [xi, yi] = q[k];
        const [xj, yj] = q[m];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
}

/** Layered cheek / jaw plates (asymmetric): each a quad raised over what lies beneath. */
const MASK_PLATES: readonly (readonly (readonly [number, number])[])[] = [
    [
        [-0.46, 0.0],
        [-0.14, 0.04],
        [-0.12, 0.3],
        [-0.36, 0.38],
    ],
    [
        [0.15, 0.02],
        [0.5, -0.03],
        [0.4, 0.42],
        [0.13, 0.3],
    ],
    [
        [-0.3, 0.3],
        [0.32, 0.3],
        [0.2, 0.62],
        [-0.16, 0.66],
    ],
    [
        [-0.2, -0.62],
        [0.24, -0.66],
        [0.1, -0.2],
        [-0.08, -0.2],
    ],
];

/**
 * The ceremonial mask in normalised coordinates (≈ ±0.6 wide, y down): a heavy angular shield, asymmetric; a
 * scowling brow ridge overhanging deep hollow eye slits; an angular nose ridge; a stern mouth line; layered riveted
 * plates; a forehead plate with engraved glyphs; a jagged crest of three blades; mismatched ear guards (one chipped).
 */
function maskAt(x: number, y: number, o: MaskPt, dent: (x: number, y: number) => number): void {
    o.h = 0;
    o.m = 0;
    o.plate = 0;
    // Crest blades behind the head (asymmetric heights).
    const blades: [number, number, number][] = [
        [-0.28, -0.86, 0.1],
        [0.02, -0.98, 0.12],
        [0.3, -0.8, 0.09],
    ];
    for (const [bx, top, w] of blades) {
        const t = (y - top) / (-0.5 - top);
        if (t >= 0 && t <= 1 && Math.abs(x - bx - (1 - t) * 0.04) < w * (0.25 + 0.75 * t)) {
            o.h = Math.max(o.h, 0.28 + 0.1 * t);
            o.m = 1;
            o.plate = 5;
        }
    }
    // Ear guards: the right one longer, the left one chipped.
    const earL = Math.abs(x + 0.56) < 0.08 && y > -0.3 && y < 0.3 && !(y > 0.12 && x < -0.57 && y - 0.12 > (x + 0.64) * 1.5);
    const earR = Math.abs(x - 0.58) < 0.085 && y > -0.34 && y < 0.44;
    if (earL || earR) {
        o.h = Math.max(o.h, 0.42 + 0.06 * Math.cos(((x < 0 ? x + 0.56 : x - 0.58) / 0.08) * 1.4));
        o.m = 1;
        o.plate = 6;
    }
    // Face shield: a squarish superellipse, wider on the right, tapering to a pointed chin.
    const sx = x < 0 ? x / 0.5 : x / 0.54;
    const taper = y > 0.3 ? 1 - 0.75 * ((y - 0.3) / 0.46) : 1;
    const e = Math.pow(Math.abs(sx / Math.max(0.05, taper)), 2.6) + Math.pow(Math.abs((y + 0.02) / 0.74), 2.2);
    if (e >= 1) return;
    o.m = 1;
    o.plate = 1;
    let h = 0.55 + 0.35 * Math.sqrt(1 - e);
    // Forehead plate with engraved glyphs.
    if (inQuad(x, y, MASK_PLATES[3])) {
        h += 0.07;
        o.plate = 4;
        const gx = x - 0.02;
        const gy = y + 0.42;
        const ring = Math.abs(Math.hypot(gx, gy) - 0.075) < 0.011;
        const bar = Math.abs(gx) < 0.011 && Math.abs(gy) < 0.13;
        const tick = Math.abs(gy + 0.04 - Math.abs(gx) * 0.6) < 0.01 && Math.abs(gx) < 0.1;
        const side = (Math.abs(gx - 0.13) < 0.009 && gy > -0.12 && gy < 0.02) || (Math.abs(gy - 0.1) < 0.009 && gx > -0.14 && gx < -0.04);
        if (ring || bar || tick || side) o.m = 3;
    }
    // Layered cheek and jaw plates (riveted edges).
    for (let k = 0; k < 3; k++) {
        const q = MASK_PLATES[k];
        if (!inQuad(x, y, q)) continue;
        h += 0.06;
        o.plate = 2 + (k === 2 ? 1 : 0);
        let edge = Infinity;
        for (let a = 0, m = q.length - 1; a < q.length; m = a++) edge = Math.min(edge, segDist(x, y, q[a][0], q[a][1], q[m][0], q[m][1]));
        if (edge < 0.012) h -= 0.03;
        const along = (x * 13 + y * 7) % 1;
        if (edge > 0.02 && edge < 0.034 && Math.abs(((along + 1) % 1) - 0.5) < 0.12) h += 0.03;
    }
    // Scowling brow ridge: lower toward the centre, overhanging the eyes.
    const browY = -0.1 - 0.16 * Math.min(1, Math.abs(x) / 0.42) + (x > 0 ? 0.015 : 0);
    const db = y - browY;
    if (Math.abs(x) < 0.46 && db > -0.07 && db < 0.03) h += 0.2 * (1 - Math.abs((db + 0.02) / 0.05));
    // Deep eye sockets and hollow slits (left slit lower and longer).
    for (const s of [-1, 1]) {
        const ex = s * x;
        const cxE = 0.2 + (s < 0 ? 0.01 : 0);
        const half = s < 0 ? 0.15 : 0.13;
        const yE = browY + (s < 0 ? 0.075 : 0.065) + 0.05 * ((ex - cxE) / half);
        const u = (ex - cxE) / half;
        if (Math.abs(u) < 1.35 && Math.abs(y - yE) < 0.09) h -= 0.2 * (1 - Math.abs(u) / 1.35) * (1 - Math.abs(y - yE) / 0.09);
        if (Math.abs(u) < 1 && Math.abs(y - yE) < 0.022 * (1 - u * u) + 0.004) {
            o.m = 2;
            h -= 0.3;
        }
    }
    // Nose ridge: angular, off-centre a touch.
    if (y > -0.12 && y < 0.17) {
        const w = 0.03 + 0.05 * ((y + 0.12) / 0.29);
        const nx = x - 0.012;
        if (Math.abs(nx) < w) h += 0.13 * (1 - Math.abs(nx) / w);
    }
    // Stern mouth: a straight slit turning down at the ends, a hard lip ridge above, a chin plate below.
    const mxs = x / 0.2;
    if (Math.abs(mxs) < 1) {
        const my = 0.37 + 0.045 * Math.max(0, Math.abs(mxs) - 0.55) / 0.45;
        const dy = y - my;
        if (Math.abs(dy) < 0.011) {
            o.m = 2;
            h -= 0.25;
        } else if (dy < 0 && dy > -0.04) h += 0.06 * (1 + dy / 0.04);
    }
    // Hammered texture.
    h += dent(x, y);
    o.h = h;
}

/**
 * The Concord's portrait: an intimidating ceremonial copper mask, painterly — layered hammered plates, engraved
 * glyphs, verdigris in the recesses, scratched ridges — lit hard from the side by a low lantern (a strong cast shadow
 * over half the face, a cool rim light on the other edge), on a dark smoky ground with faint hanging chains and
 * banners and a vignette. Its contrast is held at or above the Ackdarian portrait's (ACKDARIAN_PORTRAIT_STDL).
 */
export function generateConcordPortrait(size = CONCORD_PORTRAIT_SIZE): RgbaImage {
    const ss = 2;
    const N = size * ss;
    const hs = new Float32Array(N * N);
    const ms = new Uint8Array(N * N);
    const ps = new Uint8Array(N * N);
    const hammer = valueNoise(97);
    const fine = valueNoise(131);
    const smoke = valueNoise(151);
    const scratchN = valueNoise(173);
    const dent = (x: number, y: number): number => -0.018 * Math.abs(hammer(x * 55, y * 55) - 0.5) * 2 - 0.01 * fine(x * 140, y * 140);
    const scale = size * 0.5;
    const cx = size * 0.5;
    const cy = size * 0.56;
    const pt: MaskPt = { h: 0, m: 0, plate: 0 };
    for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
            maskAt(((i + 0.5) / ss - cx) / scale, ((j + 0.5) / ss - cy) / scale, pt, dent);
            hs[j * N + i] = pt.h;
            ms[j * N + i] = pt.m;
            ps[j * N + i] = pt.plate;
        }
    }
    // Cavity (for verdigris): how far a cell sits below the mean of a ring around it.
    const at = (i: number, j: number): number => hs[Math.min(N - 1, Math.max(0, j)) * N + Math.min(N - 1, Math.max(0, i))];
    const cav = (i: number, j: number): number => {
        const r = Math.round(0.02 * scale * ss);
        const m = (at(i - r, j) + at(i + r, j) + at(i, j - r) + at(i, j + r)) / 4;
        return m - at(i, j);
    };
    const key = norm3(-0.86, 0.3, 0.4); // a low lantern to the left, slightly below
    const rim = norm3(0.9, -0.2, 0.12); // a cool rim from the right edge
    const keyH = norm3(key[0], key[1], key[2] + 1);
    const reliefPx = scale * 0.22; // height units → px
    const out = new Float32Array(size * size * 3);
    const acc = [0, 0, 0];
    const plateTone = [1, 1, 0.94, 0.88, 1.06, 0.8, 0.9];
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            acc[0] = acc[1] = acc[2] = 0;
            for (let sj = 0; sj < ss; sj++) {
                for (let si = 0; si < ss; si++) {
                    const i = x * ss + si;
                    const j = y * ss + sj;
                    const c = j * N + i;
                    const gx = (i + 0.5) / N;
                    const gy = (j + 0.5) / N;
                    let col: [number, number, number];
                    if (ms[c] === 0) {
                        // Smoky dark ground, a warm lantern glow low on the left, faint chains and banners, vignette.
                        const sm = fbm2(smoke, gx * 5 + fbm2(smoke, gx * 2, gy * 2) * 2, gy * 3);
                        let r = 0.03 + 0.03 * sm;
                        let g = 0.065 + 0.05 * sm;
                        let bb = 0.065 + 0.045 * sm;
                        const glow = Math.exp(-(((gx - 0.02) ** 2) / 0.05 + ((gy - 0.78) ** 2) / 0.09));
                        r += 0.34 * glow;
                        g += 0.17 * glow;
                        bb += 0.05 * glow;
                        for (const chX of [0.13, 0.9]) {
                            const lx = (gx - chX) / 0.012;
                            const ly = ((gy * 30) % 1) - 0.5;
                            const link = Math.abs(Math.hypot(lx * (Math.floor(gy * 30) % 2 ? 1 : 2.2), ly * 2.2) - 0.8) < 0.3;
                            if (gy < 0.55 && link) {
                                r += 0.08;
                                g += 0.06;
                                bb += 0.04;
                            }
                        }
                        for (const [bx, bw] of [
                            [0.05, 0.07],
                            [0.95, 0.06],
                        ] as const) {
                            const tatter = 0.62 + 0.12 * fbm2(smoke, gx * 40, 3);
                            if (Math.abs(gx - bx) < bw && gy < tatter) {
                                const fold = 0.7 + 0.3 * Math.sin((gx - bx) * 120);
                                r = r * 0.6 + 0.04 * fold;
                                g = g * 0.6 + 0.11 * fold;
                                bb = bb * 0.6 + 0.1 * fold;
                            }
                        }
                        // The mask's cast shadow on the ground (away from the lantern).
                        const si2 = i - Math.round(0.06 * N);
                        const sj2 = j + Math.round(0.01 * N);
                        if (si2 >= 0 && sj2 < N && ms[sj2 * N + si2] !== 0) {
                            r *= 0.35;
                            g *= 0.35;
                            bb *= 0.35;
                        }
                        const v = 1 - 0.75 * Math.min(1, Math.hypot(gx - 0.5, gy - 0.5) / 0.72) ** 2;
                        col = [r * v, g * v, bb * v];
                    } else if (ms[c] === 2) {
                        col = [0.008, 0.012, 0.012]; // hollow slits: no eyes, only darkness
                    } else {
                        const hx = (at(i + 1, j) - at(i - 1, j)) * reliefPx * 0.5 * ss;
                        const hy = (at(i, j + 1) - at(i, j - 1)) * reliefPx * 0.5 * ss;
                        const n = norm3(-hx, -hy, 1);
                        // Hard cast shadow: march toward the lantern over the relief.
                        let lit = 1;
                        const h0 = hs[c];
                        for (let s2 = 2; s2 < 0.5 * N; s2 += 2) {
                            const qi = Math.round(i + key[0] * s2);
                            const qj = Math.round(j + key[1] * s2);
                            if (qi < 0 || qj < 0 || qi >= N || qj >= N) break;
                            const need = h0 + ((s2 / ss) / reliefPx) * (key[2] / Math.hypot(key[0], key[1]));
                            if (need > 1.6) break;
                            if (hs[qj * N + qi] > need + 0.01) {
                                lit = 0.08;
                                break;
                            }
                        }
                        const dKey = Math.max(0, n[0] * key[0] + n[1] * key[1] + n[2] * key[2]) * lit;
                        const dRim = Math.pow(Math.max(0, n[0] * rim[0] + n[1] * rim[1] + n[2] * rim[2]), 3);
                        const sp = Math.pow(Math.max(0, n[0] * keyH[0] + n[1] * keyH[1] + n[2] * keyH[2]), 30) * lit;
                        const tone = plateTone[ps[c]] ?? 1;
                        let alb: [number, number, number] = [0.6 * tone, 0.35 * tone, 0.19 * tone];
                        // Verdigris in the recesses, dark in engraved grooves, bright scratches on the ridges.
                        const cv = cav(i, j);
                        const verd = Math.min(1, Math.max(0, cv * 9) + (ms[c] === 3 ? 0.7 : 0)) * (0.6 + 0.4 * fine(gx * 90, gy * 90));
                        alb = [alb[0] + (0.16 - alb[0]) * verd, alb[1] + (0.46 - alb[1]) * verd, alb[2] + (0.38 - alb[2]) * verd];
                        if (ms[c] === 3) alb = [alb[0] * 0.45, alb[1] * 0.55, alb[2] * 0.55];
                        const ridge = Math.max(0, -cv * 10);
                        const scr = Math.abs(scratchN(gx * 8 + gy * 30, gy * 3) - 0.5) < 0.012 ? 1 : 0;
                        const bright = Math.min(1, ridge * scr + scr * 0.35);
                        alb = [alb[0] + (0.95 - alb[0]) * bright * 0.6, alb[1] + (0.72 - alb[1]) * bright * 0.6, alb[2] + (0.55 - alb[2]) * bright * 0.6];
                        col = [
                            alb[0] * (0.05 + 1.9 * dKey * 1.0) + 0.3 * dRim * 0.3 + sp * 1.1,
                            alb[1] * (0.05 + 1.9 * dKey * 0.7) + 0.3 * dRim * 0.9 + sp * 0.85,
                            alb[2] * (0.05 + 1.9 * dKey * 0.42) + 0.3 * dRim * 0.85 + sp * 0.55,
                        ];
                    }
                    acc[0] += col[0];
                    acc[1] += col[1];
                    acc[2] += col[2];
                }
            }
            const k = (y * size + x) * 3;
            out[k] = acc[0] / (ss * ss);
            out[k + 1] = acc[1] / (ss * ss);
            out[k + 2] = acc[2] / (ss * ss);
        }
    }
    const data = new Uint8ClampedArray(size * size * 4);
    for (let p = 0; p < size * size; p++) {
        data[p * 4] = Math.round(Math.min(1, out[p * 3]) * 255);
        data[p * 4 + 1] = Math.round(Math.min(1, out[p * 3 + 1]) * 255);
        data[p * 4 + 2] = Math.round(Math.min(1, out[p * 3 + 2]) * 255);
        data[p * 4 + 3] = 255;
    }
    const img: RgbaImage = { w: size, h: size, data };
    // Hold the contrast at or above the Ackdarian portrait's: stretch luma about its mean if needed (hue kept).
    const target = ACKDARIAN_PORTRAIT_STDL * 1.05;
    for (let pass = 0; pass < 6; pass++) {
        const st = concordArtStats(data, size, size);
        if (st.stdL >= target) break;
        const k = target / Math.max(1e-6, st.stdL);
        for (let p = 0; p < size * size; p++) {
            const i = p * 4;
            const l = luma709(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255);
            const l2 = Math.max(0, st.meanL + (l - st.meanL) * k);
            const m = l > 0.002 ? l2 / l : 0;
            data[i] = Math.round(Math.min(1, (data[i] / 255) * m) * 255);
            data[i + 1] = Math.round(Math.min(1, (data[i + 1] / 255) * m) * 255);
            data[i + 2] = Math.round(Math.min(1, (data[i + 2] / 255) * m) * 255);
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
 * starboard) steady with a slow pulse; strobe a short double flash at the start of each cycle; engine (the small
 * blue-white nozzle glow) steady.
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
        case 'engine':
            return 0.6;
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
    const raw = shipImageMetrics(data, w, h);
    if (raw === null) return null;
    // The treasure ship draws bigger than its hull size alone gives (both layers read areaRatio: sprite, picking and
    // the ambient exhaust stay consistent).
    const metrics = images.spec.kind === 'treasure' ? { ...raw, areaRatio: raw.areaRatio * CONCORD_TREASURE_AREA_BOOST } : raw;
    const markers = scanShipMarkers(data, w, h, metrics);
    return { rgba: paintOutShipMarkers(data, w, h, metrics, markers, true), metrics, markers };
}

/**
 * Drawn-area multiplier of the treasure ship: about 2× the beam and 1.5× the length of a carrier of its hull size
 * (DetermineBuiltObjectSizeNEW's px ∝ √(size · areaRatio), so the area ratio carries it). Render-only.
 */
export const CONCORD_TREASURE_AREA_BOOST = 3;

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
