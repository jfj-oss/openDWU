// Scenario 19a art — the Oranthi Concord's own procedural look (tasks/19-mod-layer-scenarios.md "Concord art"). Not a
// port: the original has no such art. The Concord's hulls are "junks in space": a broad dark hull with a flat bow, a
// high square stern castle with a gold roofline, lanterns as the constant signature, lacquer red and gold. Three
// looks (scenario param `concordArtLook`):
//   A hybrid (default) — ONE broad, low-detail fan sail (both wings from one mast) with 3–4 thick battens; its fine
//     rib detail is a separate overlay that fades in only at close zoom; a single pagoda tier on freighters, treasure
//     ships and bases;
//   B pagoda — no sails: stepped, tiered pagoda superstructures along the spine, a lantern row on every tier's eaves;
//   C furled — masts with furled sails as thick lashed crossbars, a lantern at each end.
// Warships, freighters, explorers, construction ships, the treasure ships and the Concord's bases share the language;
// sail / tier / yard count and lantern count scale with the size bucket; treasure ships carry the biggest lanterns and
// long banners; bases are a junk hull ringed with lantern-lit docks. The portrait is a ceremonial gold-on-lacquer
// mask (the Concord shows no faces to outsiders) and the flag a red field with the same gold emblem.
//
// Technique: a small software rasteriser (supersampled implicit shapes: splined hull silhouette, polar fan sail,
// value-noise wood grain, a fake-normal lighting pass for the gold relief of the mask), so the images are
// deterministic and testable without a DOM. Top-down like the originals, bow up in the raw image (the ship layer
// rotates raw art by heading + π/2). After drawing, the opaque pixels' Rec.709 luma is remapped (affine, hue kept) to
// the mean / contrast measured on the matching original Ackdarian ship frame (ACKDARIAN_REFERENCE), so the junks sit
// in the same world as the stock art. Thruster marks are painted as the originals do (a pure-blue run on the stern)
// and go through the same scan + paint-out as stock art (shipArt.ts), so the ambient layer's engine exhaust works
// unchanged; there are no yellow nav-light marks — the lanterns replace them. Three overlay textures share the ship's
// transform: fine detail (normal blend, faded in with drawn size), sheen (additive, slow shimmer) and lantern glow
// (additive, low alpha, warm flicker on the ambient nav-light blink phase).
//
// Display gate: the rim trader flag and the scenario flag `concordArt` (default on; off = the stock Ackdarian art the
// race file names). Render-only — nothing here reads galaxy.rnd or writes sim state.

import { Container, Texture } from 'pixi.js';
import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import { BuiltObjectSubRole } from '../sim/builtObjectTypes';
import { scenarioFlag, scenarioParam } from '../sim/scenario/state';
import { RIM_RACE, rimTraderEmpire } from '../sim/scenario/rimTrade/common';
import { shipImageMetrics, type ShipImageMetrics } from './builtObjectLayer';
import { lightsOn, scanShipMarkers, type ShipMarkers } from './ambientLayer';
import { paintOutShipMarkers } from './shipArt';
import { useMinifyingFilter } from './assets';
import { SpritePool } from './fxCommon';

// ---------------------------------------------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------------------------------------------

export type ConcordKind = 'warship' | 'freighter' | 'explorer' | 'construction' | 'treasure' | 'port' | 'base';
export const CONCORD_KINDS: readonly ConcordKind[] = ['warship', 'freighter', 'explorer', 'construction', 'treasure', 'port', 'base'];

export type ConcordLook = 'hybrid' | 'pagoda' | 'furled';
/** Index = the `concordArtLook` param value. */
export const CONCORD_LOOKS: readonly ConcordLook[] = ['hybrid', 'pagoda', 'furled'];

export function concordLookOf(param: number): ConcordLook {
    return CONCORD_LOOKS[Math.max(0, Math.min(CONCORD_LOOKS.length - 1, Math.trunc(param) || 0))];
}

/** Hull-size thresholds of the size buckets 1..5 (bucket 0 below the first). */
export const CONCORD_SIZE_THRESHOLDS = [150, 300, 500, 800, 1200] as const;
export const CONCORD_BUCKETS = CONCORD_SIZE_THRESHOLDS.length + 1;
/** Square texture side per size bucket (ships / bases). */
const SHIP_SIDES = [128, 160, 192, 240, 288, 336] as const;
const BASE_SIDES = [176, 208, 240, 288, 336, 384] as const;

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
    if (kind === 'treasure') return Math.max(288, SHIP_SIDES[b]);
    return SHIP_SIDES[b];
}

/** The drawing parameters of one variant (derived; exported for tests and the report). */
export interface ConcordSpec {
    kind: ConcordKind;
    look: ConcordLook;
    bucket: number;
    side: number;
    /** Hybrid: thick battens per sail wing. */
    battens: number;
    /** Pagoda: superstructures along the spine; tiers per superstructure. */
    pagodas: number;
    tiers: number;
    /** Furled: masts with a furled crossbar each. */
    yards: number;
    /** Lanterns strung along each hybrid sail wing's yard. */
    lanternsPerYard: number;
    /** Lantern body radius, texture px. */
    lanternR: number;
    /** Long banners streaming aft (treasure ships). */
    banners: number;
    /** Lantern-lit docks around a base's ring (0 for ships). */
    docks: number;
}

export function concordSpec(kind: ConcordKind, bucket: number, look: ConcordLook = 'hybrid'): ConcordSpec {
    const b = Math.max(0, Math.min(CONCORD_BUCKETS - 1, bucket));
    const side = concordTextureSide(kind, b);
    const base = kind === 'port' || kind === 'base';
    const treasure = kind === 'treasure';
    const battens = b >= 3 || treasure ? 4 : 3;
    let pagodas = b <= 1 ? 1 : b <= 3 ? 2 : 3;
    if (treasure) pagodas = 3;
    if (base) pagodas = kind === 'port' ? 2 : 1;
    const tiers = b <= 1 ? 2 : 3;
    let yards = b <= 2 ? 2 : 3;
    if (treasure) yards = 3;
    if (kind === 'explorer' || kind === 'construction' || base) yards = 2;
    let lanternsPerYard = 2 + Math.floor(b / 2);
    if (treasure) lanternsPerYard += 1;
    let lanternR = side * 0.0135 * (1 + b * 0.03);
    if (treasure) lanternR *= 1.6;
    if (base) lanternR = side * 0.0105;
    lanternR = Math.max(1.6, lanternR);
    const docks = kind === 'port' ? 8 + 2 * Math.floor(b / 2) : base ? 4 + Math.floor(b / 2) : 0;
    return { kind, look, bucket: b, side, battens, pagodas, tiers, yards, lanternsPerYard, lanternR, banners: treasure ? 2 : 0, docks };
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

/** Mean / standard deviation of the opaque pixels' luma (the matchLuma loop; no sort). */
function meanStdL(d: ArrayLike<number>, n: number, skip?: (i: number) => boolean): { pixels: number; meanL: number; stdL: number } {
    let c = 0;
    let s1 = 0;
    let s2 = 0;
    for (let p = 0; p < n; p++) {
        const i = p * 4;
        if (d[i + 3] < 128 || (skip !== undefined && skip(p))) continue;
        const l = luma709(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255);
        c++;
        s1 += l;
        s2 += l * l;
    }
    if (c === 0) return { pixels: 0, meanL: 0, stdL: 0 };
    const m = s1 / c;
    return { pixels: c, meanL: m, stdL: Math.sqrt(Math.max(0, s2 / c - m * m)) };
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
 * matched to, and their measured opaque-pixel luma mean / standard deviation (concordArtStats on the raw PNG; the
 * install-gated test re-measures them). Only these numbers live in the repo, never the art.
 */
export const ACKDARIAN_REFERENCE: Readonly<Record<ConcordKind, { file: string; meanL: number; stdL: number }>> = {
    warship: { file: 'family7/cruiser.png', meanL: 0.278, stdL: 0.167 },
    freighter: { file: 'family7/largefreighter.png', meanL: 0.255, stdL: 0.183 },
    explorer: { file: 'family7/explorationship.png', meanL: 0.257, stdL: 0.182 },
    construction: { file: 'family7/constructionship.png', meanL: 0.295, stdL: 0.202 },
    treasure: { file: 'family7/largefreighter.png', meanL: 0.255, stdL: 0.183 },
    port: { file: 'family7/largespaceport.png', meanL: 0.276, stdL: 0.173 },
    base: { file: 'family7/genericbase.png', meanL: 0.242, stdL: 0.141 },
};

/**
 * Remaps the luma of the opaque pixels (not in `skip`) so their mean / standard deviation become the target's:
 * L' = mean' + (L − mean)·std'/std, each pixel's RGB scaled by L'/L (hue kept, clamped). Repeated passes absorb the
 * clamp.
 */
export function matchLuma(img: RgbaImage, target: { meanL: number; stdL: number }, skip?: (i: number) => boolean): void {
    const d = img.data;
    for (let pass = 0; pass < 4; pass++) {
        const s = meanStdL(d, img.w * img.h, skip);
        if (s.pixels === 0 || s.stdL <= 1e-6) return;
        if (Math.abs(s.meanL - target.meanL) < 0.002 && Math.abs(s.stdL - target.stdL) < 0.002) return;
        const k = target.stdL / s.stdL;
        for (let p = 0; p < img.w * img.h; p++) {
            const i = p * 4;
            if (d[i + 3] < 128 || (skip !== undefined && skip(p))) continue;
            const r = d[i] / 255;
            const g = d[i + 1] / 255;
            const b = d[i + 2] / 255;
            const l = luma709(r, g, b);
            const l2 = Math.max(0.004, target.meanL + (l - s.meanL) * k);
            if (l < 0.002) {
                d[i] = d[i + 1] = d[i + 2] = Math.round(l2 * 255);
                continue;
            }
            const m = l2 / l;
            d[i] = Math.round(r * m * 255);
            d[i + 1] = Math.round(g * m * 255);
            d[i + 2] = Math.round(b * m * 255);
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
// Palette (0..1; the luma pass sets the final values)
// ---------------------------------------------------------------------------------------------------------------

type Rgb = readonly [number, number, number];
const HULL: Rgb = [0.2, 0.13, 0.1];
const LACQUER: Rgb = [0.68, 0.12, 0.09];
const LACQUER_DARK: Rgb = [0.36, 0.05, 0.05];
const GOLD: Rgb = [0.88, 0.67, 0.28];
const GOLD_DARK: Rgb = [0.5, 0.33, 0.12];
const ROOF: Rgb = [0.58, 0.09, 0.07];
const LANTERN: Rgb = [1.0, 0.5, 0.2];
const LANTERN_CORE: Rgb = [1.0, 0.88, 0.58];
const IRON: Rgb = [0.16, 0.15, 0.15];
const GLOW: Rgb = [1.0, 0.66, 0.3];

/** One subsample's result: colour (0..1), whether it is opaque, and the sheen / fine-detail strengths. */
interface Sample {
    r: number;
    g: number;
    b: number;
    hit: boolean;
    sheen: number;
    detail: number;
}

function put(o: Sample, c: Rgb, shade: number): void {
    o.r = c[0] * shade;
    o.g = c[1] * shade;
    o.b = c[2] * shade;
    o.hit = true;
    o.sheen = 0;
    o.detail = 0;
}

export interface ConcordLantern {
    x: number;
    y: number;
    r: number;
}

interface Scene {
    side: number;
    lanterns: ConcordLantern[];
    /** Pure-blue thruster runs (raw px): [x0, x1, y]. */
    thrusters: [number, number, number][];
    sample(x: number, y: number, o: Sample): void;
}

function segDist(x: number, y: number, x0: number, y0: number, x1: number, y1: number): number {
    const vx = x1 - x0;
    const vy = y1 - y0;
    const t = Math.max(0, Math.min(1, ((x - x0) * vx + (y - y0) * vy) / (vx * vx + vy * vy)));
    return Math.hypot(x - (x0 + vx * t), y - (y0 + vy * t));
}

/** A paper lantern seen from above: gold cap, red-orange body, glowing core. */
function lanternBody(l: ConcordLantern, x: number, y: number, o: Sample): void {
    const dx = x - l.x;
    const dy = y - l.y;
    if (dx > l.r || dx < -l.r || dy > l.r || dy < -l.r) return;
    const d = Math.hypot(dx, dy);
    if (d > l.r) return;
    if (d < l.r * 0.5) put(o, LANTERN_CORE, 1);
    else if (dy < -l.r * 0.62) put(o, GOLD, 1);
    else put(o, LANTERN, 0.85 + 0.25 * (1 - d / l.r));
}

/**
 * A square pagoda roof seen from above, centred (cx, cy), `tiers` stepped hip roofs (outer half-size `half`, each tier
 * 0.3 smaller), gold eaves and ridges, a gold finial; lit from the upper left. Returns true when it painted.
 */
function pagodaRoof(x: number, y: number, cx: number, cy: number, half: number, tiers: number, eave: number, o: Sample): boolean {
    const dx = x - cx;
    const dy = y - cy;
    const m = Math.max(Math.abs(dx), Math.abs(dy));
    if (m > half) return false;
    const step = half * 0.3;
    const tier = Math.min(tiers - 1, Math.floor((half - m) / step));
    const inner = half - (tier + 1) * step;
    if (tier === tiers - 1 && m < Math.max(1, half * 0.12)) {
        put(o, GOLD, 1.2);
        return true;
    }
    const tierHalf = half - tier * step;
    if (tierHalf - m < eave) {
        put(o, GOLD, 1.0 + 0.08 * tier);
        return true;
    }
    // Hip-roof slope by the dominant axis; diagonal ridges gold.
    if (Math.abs(Math.abs(dx) - Math.abs(dy)) < eave * 0.7) {
        put(o, GOLD_DARK, 1.1);
        return true;
    }
    const slope = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 1.18 : 0.72) : dy < 0 ? 1.05 : 0.8;
    const t = tier === tiers - 1 ? 1 : (m - inner) / step;
    put(o, ROOF, slope * (0.92 + 0.12 * tier) * (0.9 + 0.15 * t));
    // Tile rows parallel to the eave (fine detail) and a sheen on the lit slopes.
    const rows = (tierHalf - m) / Math.max(1.2, eave * 1.3);
    o.detail = rows - Math.floor(rows) < 0.3 ? 0.7 : 0;
    o.sheen = slope > 1 ? 0.35 : 0;
    return true;
}

// ---------------------------------------------------------------------------------------------------------------
// The junk
// ---------------------------------------------------------------------------------------------------------------

interface JunkShape {
    lengthFrac: number;
    beam: number;
    sailR: number;
    fore: number;
    aft: number;
}

const JUNK_SHAPES: Readonly<Record<Exclude<ConcordKind, 'port' | 'base'>, JunkShape>> = {
    warship: { lengthFrac: 0.84, beam: 0.115, sailR: 0.36, fore: 0.32, aft: 0.72 },
    freighter: { lengthFrac: 0.78, beam: 0.16, sailR: 0.4, fore: 0.42, aft: 0.6 },
    explorer: { lengthFrac: 0.78, beam: 0.11, sailR: 0.38, fore: 0.36, aft: 0.66 },
    construction: { lengthFrac: 0.76, beam: 0.15, sailR: 0.36, fore: 0.4, aft: 0.6 },
    treasure: { lengthFrac: 0.86, beam: 0.16, sailR: 0.42, fore: 0.44, aft: 0.6 },
};

interface Wing {
    px: number;
    py: number;
    sgn: 1 | -1;
    rIn: number;
    R: number;
    a0: number;
    a1: number;
    panels: number;
}

interface Yard {
    y: number;
    half: number;
    thick: number;
}

interface Pagoda {
    y: number;
    half: number;
    tiers: number;
}

class Junk {
    readonly cx: number;
    readonly bowY: number;
    readonly L: number;
    readonly W: number;
    readonly look: ConcordLook;
    readonly wings: Wing[] = [];
    readonly yards: Yard[] = [];
    readonly pagodas: Pagoda[] = [];
    readonly masts: number[] = [];
    /** Deck fittings (turrets, hatches, dishes): u positions. */
    readonly fittings: number[] = [];
    /** Where banners stream from (treasure ships): raw px. */
    readonly bannerRoots: { x: number; y: number }[] = [];
    readonly castle = { u0: 0.74, u1: 0.985 };
    readonly lanterns: ConcordLantern[] = [];
    private readonly wood = valueNoise(11);
    private readonly shadowOff: number;
    private readonly lineW: number;
    /** Bounding box of everything the junk draws (early out). */
    private bx0 = Infinity;
    private bx1 = -Infinity;
    private by0 = Infinity;
    private by1 = -Infinity;

    constructor(
        readonly kind: ConcordKind,
        readonly spec: ConcordSpec,
        cx: number,
        cy: number,
        length: number,
        shape: JunkShape,
        withPagodaTier: boolean,
    ) {
        this.cx = cx;
        this.L = length;
        this.bowY = cy - length / 2;
        this.W = shape.beam * length;
        this.look = spec.look;
        this.shadowOff = Math.max(1.2, spec.side * 0.016);
        this.lineW = Math.max(0.9, spec.side * 0.0075);
        const lr = spec.lanternR;
        const yAt = (u: number): number => this.bowY + u * length;
        if (this.look === 'hybrid') {
            const u = kind === 'warship' ? 0.36 : 0.34;
            this.masts.push(u);
            const py = yAt(u);
            const rIn = this.hw(u) * 0.95;
            const R = Math.max(rIn + 4, shape.sailR * length);
            const a0 = (-shape.fore * Math.PI) / 3;
            const a1 = (shape.aft * Math.PI) / 3;
            for (const sgn of [-1, 1] as const) {
                this.wings.push({ px: cx, py, sgn, rIn, R, a0, a1, panels: spec.battens + 1 });
                const yardAngles = kind === 'treasure' ? [a0 + 0.08, a1 - 0.08] : [a0 + 0.08];
                for (const ang of yardAngles) {
                    for (let k = 1; k <= spec.lanternsPerYard; k++) {
                        const r = rIn + (R * 0.9 - rIn) * (k / spec.lanternsPerYard);
                        this.lanterns.push({ x: cx + sgn * r * Math.cos(ang), y: py + r * Math.sin(ang), r: lr });
                    }
                }
            }
            this.bannerRoots.push({ x: cx - this.W * 0.3, y: py }, { x: cx + this.W * 0.3, y: py });
            if (withPagodaTier) this.pagodas.push({ y: yAt(0.6), half: this.hw(0.6) * 0.8, tiers: 1 });
            this.fittings.push(kind === 'warship' ? 0.14 : 0.13);
            if (kind === 'warship') this.fittings.push(0.6);
        } else if (this.look === 'pagoda') {
            const n = spec.pagodas;
            const us = n === 1 ? [0.44] : n === 2 ? [0.3, 0.56] : [0.2, 0.4, 0.6];
            for (const u of us) {
                const half = Math.min(this.hw(u) * 1.12, (length * 0.24) / n + this.W * 0.3);
                const p: Pagoda = { y: yAt(u), half, tiers: spec.tiers };
                this.pagodas.push(p);
                // A lantern row on every tier's eaves (the four corners; the lateral midpoints on bigger tiers).
                for (let t = 0; t < p.tiers; t++) {
                    const h = half * (1 - 0.3 * t) + lr * 0.4;
                    const pts: [number, number][] = [
                        [-h, -h],
                        [h, -h],
                        [-h, h],
                        [h, h],
                    ];
                    if (t === 0 && spec.bucket >= 3) pts.push([-h, 0], [h, 0]);
                    for (const [ox, oy] of pts) this.lanterns.push({ x: cx + ox, y: p.y + oy, r: lr * (t === 0 ? 1 : 0.8) });
                }
            }
            this.bannerRoots.push({ x: cx, y: yAt(us[0]) }, { x: cx, y: yAt(us[us.length - 1]) });
            this.fittings.push(0.1);
        } else {
            const n = spec.yards;
            const us = n === 2 ? [0.28, 0.54] : [0.2, 0.41, 0.61];
            const mul = n === 2 ? [0.86, 1] : [0.8, 1, 0.88];
            for (let i = 0; i < us.length; i++) {
                const u = us[i];
                this.masts.push(u);
                const half = (this.hw(u) + this.W * 1.5) * mul[i];
                const yard: Yard = { y: yAt(u), half, thick: this.W * 0.34 };
                this.yards.push(yard);
                const lx = half + lr * 0.9;
                this.lanterns.push({ x: cx - lx, y: yard.y, r: lr }, { x: cx + lx, y: yard.y, r: lr });
                if (kind === 'treasure') this.lanterns.push({ x: cx - half * 0.55, y: yard.y + yard.thick * 0.5 + lr, r: lr * 0.8 }, { x: cx + half * 0.55, y: yard.y + yard.thick * 0.5 + lr, r: lr * 0.8 });
            }
            this.bannerRoots.push({ x: cx - this.W * 0.3, y: yAt(us[0]) }, { x: cx + this.W * 0.3, y: yAt(us[us.length - 1]) });
            if (withPagodaTier) this.pagodas.push({ y: yAt(0.66), half: this.hw(0.66) * 0.72, tiers: 1 });
            for (let i = 0; i + 1 < us.length; i++) this.fittings.push((us[i] + us[i + 1]) / 2);
            this.fittings.unshift(0.1);
        }
        for (const p of this.pagodas) {
            if (this.look === 'pagoda') continue;
            const h = p.half + lr * 0.4;
            this.lanterns.push({ x: cx - h, y: p.y - h, r: lr * 0.85 }, { x: cx + h, y: p.y - h, r: lr * 0.85 }, { x: cx - h, y: p.y + h, r: lr * 0.85 }, { x: cx + h, y: p.y + h, r: lr * 0.85 });
        }
        // Castle aft corners and the bow.
        const cu = this.castle.u1 - 0.015;
        const chw = this.hw(cu);
        this.lanterns.push({ x: cx - chw, y: yAt(cu), r: lr }, { x: cx + chw, y: yAt(cu), r: lr }, { x: cx, y: this.bowY + lr * 0.9, r: lr });
        // Bounds: hull (+ the explorer's spar), sail wings, yards, pagodas, crane, banners, lanterns.
        const grow = (x0: number, y0: number, x1: number, y1: number): void => {
            this.bx0 = Math.min(this.bx0, x0);
            this.by0 = Math.min(this.by0, y0);
            this.bx1 = Math.max(this.bx1, x1);
            this.by1 = Math.max(this.by1, y1);
        };
        grow(cx - this.W * 2.3, this.bowY - length * 0.12, cx + this.W * 2.3, this.bowY + length * 1.01);
        for (const w of this.wings) grow(w.px - w.R, w.py - w.R, w.px + w.R, w.py + w.R);
        for (const yd of this.yards) grow(cx - yd.half - yd.thick, yd.y - yd.thick, cx + yd.half + yd.thick, yd.y + yd.thick);
        for (const p of this.pagodas) grow(cx - p.half, p.y - p.half, cx + p.half, p.y + p.half);
        for (const l of this.lanterns) grow(l.x - l.r, l.y - l.r, l.x + l.r, l.y + l.r);
        this.bx0 -= 1;
        this.by0 -= 1;
        this.bx1 += 1;
        this.by1 += 1;
    }

    /** Hull half-width at u (0 = bow, 1 = transom): a flat, slightly rounded bow, broad flanks, a square stern. */
    hw(u: number): number {
        if (u < 0 || u > 1) return 0;
        let k = 1;
        if (u < 0.12) k = 0.6 + 0.4 * Math.sqrt(u / 0.12);
        if (u > 0.94) {
            const t = (u - 0.94) / 0.06;
            k *= 1 - 0.1 * t * t;
        }
        return this.W * k;
    }

    private inCastle(x: number, y: number): boolean {
        const u = (y - this.bowY) / this.L;
        if (u < this.castle.u0 || u > this.castle.u1) return false;
        return Math.abs(x - this.cx) <= this.hw(u);
    }

    /** Superstructures that cast a shadow on the deck: the castle and the pagodas. */
    private raised(x: number, y: number): boolean {
        if (this.inCastle(x, y)) return true;
        for (const p of this.pagodas) if (Math.max(Math.abs(x - this.cx), Math.abs(y - p.y)) <= p.half) return true;
        return false;
    }

    sample(x: number, y: number, o: Sample): void {
        if (x < this.bx0 || x > this.bx1 || y < this.by0 || y > this.by1) return;
        const u = (y - this.bowY) / this.L;
        const dx = x - this.cx;
        const hw = this.hw(u);
        const onHull = u >= 0 && u <= 1 && Math.abs(dx) <= hw;
        if (this.kind === 'explorer') this.explorerSpar(x, y, o);
        if (onHull) this.hull(x, y, u, dx / hw, o);
        for (const s of this.wings) this.wing(s, x, y, o);
        if (onHull) for (const fu of this.fittings) this.fitting(fu, x, y, o);
        for (const yd of this.yards) this.yard(yd, x, y, o);
        for (const mu of this.masts) {
            const d = Math.hypot(dx, y - (this.bowY + mu * this.L));
            const mr = this.W * 0.22;
            if (d <= mr) put(o, d < mr * 0.45 ? IRON : GOLD, 0.8 + 0.35 * (1 - d / mr));
        }
        if (onHull && this.inCastle(x, y)) this.castleRoof(x, y, u, o);
        for (const p of this.pagodas) pagodaRoof(x, y, this.cx, p.y, p.half, p.tiers, this.lineW, o);
        if (this.kind === 'construction') this.crane(x, y, o);
        if (this.spec.banners > 0) this.banners(x, y, o);
        for (const l of this.lanterns) lanternBody(l, x, y, o);
    }

    private hull(x: number, y: number, u: number, nx: number, o: Sample): void {
        const a = Math.abs(nx);
        const nz = Math.sqrt(Math.max(0, 1 - nx * nx * 0.85));
        let shade = 0.55 + 0.6 * Math.max(0, -0.42 * nx + 0.9 * nz);
        let c: Rgb;
        if (a > 0.88 || u < 0.018) c = GOLD;
        else if (a > 0.7) {
            c = LACQUER;
            if (((y - this.bowY) / (this.W * 1.1)) % 1 < 0.1) c = GOLD_DARK;
        } else {
            c = HULL;
            const plank = this.W * 0.2;
            const q = (x - this.cx) / plank;
            if (q - Math.floor(q) < 0.12) shade *= 0.8;
            shade *= 1 + 0.3 * fbm2(this.wood, x * 0.3, y * 0.05);
        }
        if (!this.raised(x, y) && this.raised(x - this.shadowOff, y - this.shadowOff)) shade *= 0.5;
        put(o, c, shade);
    }

    /** Hybrid: one wing of the broad fan sail — flat lacquer panels, thick battens, gold yard and rim. */
    private wing(s: Wing, x: number, y: number, o: Sample): void {
        const dx = (x - s.px) * s.sgn;
        const dy = y - s.py;
        const r = Math.hypot(dx, dy);
        if (r < s.rIn || r > s.R) return;
        const phi = Math.atan2(dy, dx);
        if (phi < s.a0 || phi > s.a1) return;
        const t = (phi - s.a0) / (s.a1 - s.a0);
        const tp = t * s.panels;
        const f = tp - Math.floor(tp);
        const edge = s.R * (0.94 + 0.06 * Math.sin(Math.PI * f));
        if (r > edge) return;
        const span = (s.a1 - s.a0) * r;
        const battenPx = (Math.min(f, 1 - f) / s.panels) * span;
        const yardPx = Math.min(t, 1 - t) * span;
        const bw = this.lineW;
        const lit = s.sgn < 0 ? 1.06 : 0.92;
        if (yardPx < bw * 1.3 || r > edge - bw * 1.4) {
            put(o, GOLD, 0.98 * lit);
            return;
        }
        if (battenPx < bw * 0.9) {
            put(o, GOLD_DARK, 1.05 * lit);
            return;
        }
        const rr = (r - s.rIn) / (s.R - s.rIn);
        put(o, LACQUER, (0.72 + 0.32 * rr) * (0.9 + 0.14 * Math.sin(Math.PI * f)) * lit);
        // Fine ribs (three per panel) and radiator channels: the close-zoom detail overlay only.
        const fr = f * 4;
        const ribPx = (Math.min(fr - Math.floor(fr), 1 - (fr - Math.floor(fr))) / (4 * s.panels)) * span;
        const ch = r / Math.max(2.5, this.spec.side * 0.02);
        o.detail = ribPx < 0.45 ? 0.8 : ch - Math.floor(ch) < 0.16 ? 0.45 : 0;
        o.sheen = Math.pow(Math.sin(Math.PI * f), 6) * (0.4 + 0.6 * rr);
    }

    /** Furled: a thick lashed crossbar (the furled sail) across the hull, lit as a cylinder. */
    private yard(yd: Yard, x: number, y: number, o: Sample): void {
        const dx = x - this.cx;
        const dy = y - yd.y;
        const t = yd.thick / 2;
        const ax = Math.abs(dx);
        if (ax > yd.half + t) return;
        const ex = Math.max(0, ax - yd.half);
        if (ex * ex + dy * dy > t * t) return;
        const n = dy / t;
        const cyl = 0.62 + 0.55 * Math.max(0, -0.75 * n + 0.66 * Math.sqrt(Math.max(0, 1 - n * n)));
        const lash = (ax / (this.W * 0.5)) % 1 < 0.14 && ax < yd.half;
        if (ex > 0 && ex > t * 0.35) {
            put(o, GOLD, cyl);
            return;
        }
        put(o, lash ? GOLD : LACQUER, cyl * (lash ? 1 : 0.95));
        if (!lash) {
            const fold = (ax / Math.max(1.5, this.W * 0.16) + n * 0.8) % 1;
            o.detail = fold < 0.22 ? 0.6 : 0;
            o.sheen = n < -0.2 ? 0.5 * (-n) : 0;
        }
    }

    private fitting(fu: number, x: number, y: number, o: Sample): void {
        const fy = this.bowY + fu * this.L;
        const dx = x - this.cx;
        const dy = y - fy;
        const W = this.W;
        if (this.kind === 'warship') {
            const tr = W * 0.36;
            const d = Math.hypot(dx, dy);
            if (Math.abs(dx) < tr * 0.2 && dy < 0 && dy > -tr * 1.8) {
                put(o, GOLD_DARK, 1);
                return;
            }
            if (d <= tr) put(o, d > tr * 0.64 ? GOLD : LACQUER_DARK, 0.75 + 0.45 * Math.max(0, (-dx - dy) / (tr * 1.4) + 0.5));
            return;
        }
        if (this.kind === 'explorer') {
            const d = Math.hypot(dx, dy);
            const rr = W * 0.5;
            if (d <= rr) put(o, d > rr * 0.72 || d < rr * 0.22 ? GOLD : IRON, 0.85 + 0.3 * (1 - d / rr));
            return;
        }
        const hx = W * 0.5;
        const hy = W * (this.kind === 'treasure' ? 0.4 : 0.32);
        if (Math.abs(dx) <= hx && Math.abs(dy) <= hy) {
            const frame = Math.abs(dx) > hx * 0.78 || Math.abs(dy) > hy * 0.72;
            put(o, frame ? GOLD : LACQUER_DARK, frame ? 0.95 : 1);
            if (!frame && ((dy + hy) / (hy * 0.5)) % 1 < 0.16) o.detail = 0.7;
        }
    }

    private explorerSpar(x: number, y: number, o: Sample): void {
        const len = this.L * 0.1;
        if (y < this.bowY - len || y > this.bowY + this.L * 0.05) return;
        if (Math.abs(x - this.cx) <= Math.max(0.7, this.W * 0.07)) put(o, GOLD, 1);
        if (Math.hypot(x - this.cx, y - (this.bowY - len)) <= this.W * 0.18) put(o, GOLD, 1.15);
    }

    private crane(x: number, y: number, o: Sample): void {
        const x0 = this.cx;
        const y0 = this.bowY + this.L * 0.5;
        const x1 = this.cx + this.W * 2.1;
        const y1 = this.bowY + this.L * 0.44;
        const d = segDist(x, y, x0, y0, x1, y1);
        if (d <= Math.max(0.8, this.W * 0.11)) put(o, GOLD, 1);
        if (Math.hypot(x - x1, y - y1) <= this.W * 0.2) put(o, IRON, 1.2);
    }

    /** The high square stern castle: a hip roof with a thick gold roofline and ridge; a second tier on big hulls. */
    private castleRoof(x: number, y: number, u: number, o: Sample): void {
        const hw = this.hw(u);
        const nx = (x - this.cx) / hw;
        const top = this.bowY + this.castle.u0 * this.L;
        const bottom = this.bowY + this.castle.u1 * this.L;
        const edge = Math.min(hw - Math.abs(x - this.cx), y - top, bottom - y);
        if (edge < this.lineW * 1.5) {
            put(o, GOLD, 1.05);
            return;
        }
        const tier2 = this.spec.bucket >= 3 && Math.abs(nx) < 0.55 && y > top + (bottom - top) * 0.2 && y < bottom - (bottom - top) * 0.18;
        const k = tier2 ? nx / 0.55 : nx;
        if (Math.abs(k) < 0.1 || (tier2 && Math.abs(Math.abs(nx) - 0.55) < 0.06)) {
            put(o, GOLD, 1.15);
            return;
        }
        const shade = k < 0 ? 1.14 : 0.72;
        put(o, ROOF, shade * (tier2 ? 1.1 : 1));
        const tile = (y - this.bowY) / Math.max(1.6, this.spec.side * 0.013);
        if (tile - Math.floor(tile) < 0.28) o.detail = 0.7;
        o.sheen = k < 0 ? 0.3 : 0;
    }

    private banners(x: number, y: number, o: Sample): void {
        const len = this.L * 0.38;
        const bw = this.W * 0.38;
        for (let i = 0; i < this.bannerRoots.length; i++) {
            const root = this.bannerRoots[i];
            const t = (y - root.y) / len;
            if (t < 0 || t > 1) continue;
            const wave = Math.sin(2 * Math.PI * 1.3 * t + i * 1.9);
            const xc = root.x + (i === 0 ? -1 : 1) * this.W * 0.15 * t + this.W * 0.5 * wave * t;
            const w = bw * (1 - 0.45 * t);
            const ddx = Math.abs(x - xc);
            if (ddx > w / 2) continue;
            if (t > 0.86 && ddx < (w / 2) * ((t - 0.86) / 0.14)) continue; // swallowtail
            const edge = ddx > w * 0.32;
            put(o, edge ? GOLD : LACQUER, edge ? 1 : 1.12 - 0.25 * wave);
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------------------------------------------

function shipScene(spec: ConcordSpec): Scene {
    const shape = JUNK_SHAPES[spec.kind as keyof typeof JUNK_SHAPES];
    const S = spec.side;
    const glowPad = spec.lanternR * 3.4 + 2;
    const length = S * shape.lengthFrac;
    // Keep the sail tips / yard ends (and their lantern glow) inside the texture.
    const maxHalf = S / 2 - glowPad;
    const fit: JunkShape = { ...shape, sailR: Math.min(shape.sailR, maxHalf / length) };
    if (spec.look === 'furled') fit.beam = Math.min(shape.beam, maxHalf / (length * 2.6));
    const pagodaTier = spec.kind === 'freighter' || spec.kind === 'treasure';
    const junk = new Junk(spec.kind, spec, S / 2, S / 2 + (spec.kind === 'explorer' ? S * 0.04 : 0), length, fit, pagodaTier);
    // One thruster run on small hulls, two on bigger ones, just inside the transom.
    const sy = Math.floor(junk.bowY + junk.L) - 2;
    const hw = junk.hw(0.985);
    const thrusters: [number, number, number][] =
        spec.bucket <= 1
            ? [[Math.round(S / 2 - hw * 0.35), Math.round(S / 2 + hw * 0.35), sy]]
            : [
                  [Math.round(S / 2 - hw * 0.7), Math.round(S / 2 - hw * 0.25), sy],
                  [Math.round(S / 2 + hw * 0.25), Math.round(S / 2 + hw * 0.7), sy],
              ];
    return { side: S, lanterns: junk.lanterns, thrusters, sample: (x, y, o) => junk.sample(x, y, o) };
}

function baseScene(spec: ConcordSpec): Scene {
    const S = spec.side;
    const c = S / 2;
    const port = spec.kind === 'port';
    const lr = spec.lanternR;
    const ringR = S * 0.3;
    const ringW = S * 0.03;
    const dockLen = S * 0.085;
    const dockW = S * 0.013;
    const shape: JunkShape = { lengthFrac: 0.44, beam: port ? 0.16 : 0.14, sailR: 0.6, fore: 0.35, aft: 0.7 };
    const junk = new Junk(port ? 'freighter' : 'base', spec, c, c, S * 0.44, shape, true);
    const lanterns = junk.lanterns.slice();
    const segs = 16 + 4 * spec.bucket;
    const spokes = port ? 6 : 4;
    const docks: number[] = [];
    for (let i = 0; i < spec.docks; i++) docks.push(((i + 0.5) / spec.docks) * Math.PI * 2);
    for (const a of docks) {
        const r = ringR + ringW + dockLen;
        lanterns.push({ x: c + r * Math.cos(a), y: c + r * Math.sin(a), r: lr * 1.15 });
    }
    for (let i = 0; i < spec.docks; i++) {
        const a = (i / spec.docks) * Math.PI * 2;
        lanterns.push({ x: c + ringR * Math.cos(a), y: c + ringR * Math.sin(a), r: lr });
    }
    const gates = port ? [0, 1, 2, 3].map((k) => Math.PI / 4 + (k * Math.PI) / 2) : [];
    const noise = valueNoise(47);
    const own = junk.lanterns.length;
    const outer = ringR + ringW + dockLen + lr * 1.3 + 1;
    const sample = (x: number, y: number, o: Sample): void => {
        const dx = x - c;
        const dy = y - c;
        const r = Math.hypot(dx, dy);
        if (r > outer) return;
        const ang = Math.atan2(dy, dx);
        const nearRing = r > ringR - ringW - S * 0.04;
        if (r < ringR + ringW) for (let k = 0; k < spokes; k++) {
            const a = Math.PI / spokes + (k * 2 * Math.PI) / spokes;
            const d = segDist(x, y, c, c, c + ringR * Math.cos(a), c + ringR * Math.sin(a));
            if (d <= S * 0.008) put(o, d < S * 0.003 ? GOLD : IRON, 1.1);
        }
        if (nearRing && r > ringR) for (const a of docks) {
            const x0 = c + (ringR + ringW * 0.5) * Math.cos(a);
            const y0 = c + (ringR + ringW * 0.5) * Math.sin(a);
            const x1 = c + (ringR + ringW + dockLen) * Math.cos(a);
            const y1 = c + (ringR + ringW + dockLen) * Math.sin(a);
            const d = segDist(x, y, x0, y0, x1, y1);
            if (d <= dockW) put(o, d > dockW * 0.6 ? GOLD_DARK : HULL, 1.05 + 0.3 * fbm2(noise, x * 0.3, y * 0.3));
        }
        if (Math.abs(r - ringR) <= ringW) {
            const q = (((ang / (2 * Math.PI)) * segs) % 1 + 1) % 1;
            const rim = Math.abs(r - ringR) > ringW * 0.68;
            const nr = (r - ringR) / ringW;
            const shade = 0.75 + 0.45 * Math.max(0, -(dx + dy) / (r * 1.5) + 0.35) + 0.1 * (1 - Math.abs(nr));
            const lacq = Math.floor(((ang / (2 * Math.PI)) * segs + segs) % 2) === 0;
            put(o, rim || q < 0.07 ? GOLD : lacq ? LACQUER : HULL, shade);
        }
        if (nearRing) for (const a of gates) pagodaRoof(x, y, c + ringR * Math.cos(a), c + ringR * Math.sin(a), S * 0.036, 2, Math.max(0.9, S * 0.005), o);
        junk.sample(x, y, o);
        if (nearRing) for (let i = own; i < lanterns.length; i++) lanternBody(lanterns[i], x, y, o);
    };
    return { side: S, lanterns, thrusters: [], sample };
}

// ---------------------------------------------------------------------------------------------------------------
// Rasterising a variant
// ---------------------------------------------------------------------------------------------------------------

export interface ConcordImages {
    spec: ConcordSpec;
    /** The ship / base, straight alpha, with the pure-blue thruster marks still in (shipArt pipeline removes them). */
    ship: RgbaImage;
    /** Fine detail (sail ribs, roof tiles, folds): normal blend, faded in only at close zoom. */
    detail: RgbaImage;
    /** Sheen highlights: additive, slow shimmer. */
    sheen: RgbaImage;
    /** Lantern halos (warm, straight alpha): additive. */
    glow: RgbaImage;
    lanterns: ConcordLantern[];
    /** Pixel indices of the thruster marks. */
    markerPixels: number[];
}

function rasterise(scene: Scene): { ship: RgbaImage; sheen: RgbaImage; detail: RgbaImage } {
    const S = scene.side;
    const ss = S <= 200 ? 3 : 2;
    const ship = new Uint8ClampedArray(S * S * 4);
    const sheen = new Uint8ClampedArray(S * S * 4);
    const detail = new Uint8ClampedArray(S * S * 4);
    const o: Sample = { r: 0, g: 0, b: 0, hit: false, sheen: 0, detail: 0 };
    const inv = 1 / (ss * ss);
    for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
            let r = 0;
            let g = 0;
            let b = 0;
            let a = 0;
            let sh = 0;
            let dt = 0;
            for (let j = 0; j < ss; j++) {
                for (let i = 0; i < ss; i++) {
                    o.hit = false;
                    o.sheen = 0;
                    o.detail = 0;
                    scene.sample(x + (i + 0.5) / ss, y + (j + 0.5) / ss, o);
                    if (!o.hit) continue;
                    r += o.r;
                    g += o.g;
                    b += o.b;
                    a += 1;
                    sh += o.sheen;
                    dt += o.detail;
                }
            }
            if (a === 0) continue;
            const k = (y * S + x) * 4;
            ship[k] = Math.round(Math.min(1, r / a) * 255);
            ship[k + 1] = Math.round(Math.min(1, g / a) * 255);
            ship[k + 2] = Math.round(Math.min(1, b / a) * 255);
            ship[k + 3] = Math.round(a * inv * 255);
            if (sh > 0) {
                sheen[k] = 255;
                sheen[k + 1] = 236;
                sheen[k + 2] = 190;
                sheen[k + 3] = Math.round(Math.min(1, sh * inv) * 255);
            }
            if (dt > 0) {
                detail[k] = 34;
                detail[k + 1] = 8;
                detail[k + 2] = 6;
                detail[k + 3] = Math.round(Math.min(1, dt * inv) * 0.75 * 255);
            }
        }
    }
    return { ship: { w: S, h: S, data: ship }, sheen: { w: S, h: S, data: sheen }, detail: { w: S, h: S, data: detail } };
}

function glowImage(S: number, lanterns: readonly ConcordLantern[], spread: number): RgbaImage {
    const data = new Uint8ClampedArray(S * S * 4);
    const acc = new Float64Array(S * S);
    // Splat each lantern's Gaussian halo over its own 3σ box (the lanterns are processed in order: deterministic).
    for (const l of lanterns) {
        const rr = l.r * spread;
        const x0 = Math.max(0, Math.floor(l.x - 3 * rr));
        const x1 = Math.min(S - 1, Math.ceil(l.x + 3 * rr));
        const y0 = Math.max(0, Math.floor(l.y - 3 * rr));
        const y1 = Math.min(S - 1, Math.ceil(l.y + 3 * rr));
        for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
                const dx = (x + 0.5 - l.x) / rr;
                const dy = (y + 0.5 - l.y) / rr;
                const q = dx * dx + dy * dy;
                if (q < 9) acc[y * S + x] += Math.exp(-q);
            }
        }
    }
    for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
            const a = acc[y * S + x];
            if (a <= 0.004) continue;
            const k = (y * S + x) * 4;
            data[k] = Math.round(GLOW[0] * 255);
            data[k + 1] = Math.round(GLOW[1] * 255);
            data[k + 2] = Math.round(GLOW[2] * 255);
            data[k + 3] = Math.round(Math.min(1, a) * 255);
        }
    }
    return { w: S, h: S, data };
}

/** Deterministic procedural images of one variant (pure; no DOM). */
export function generateConcordImages(kind: ConcordKind, bucket: number, look: ConcordLook = 'hybrid'): ConcordImages {
    const spec = concordSpec(kind, bucket, look);
    const scene = kind === 'port' || kind === 'base' ? baseScene(spec) : shipScene(spec);
    const { ship, sheen, detail } = rasterise(scene);
    const S = spec.side;
    const markerPixels: number[] = [];
    for (const [x0, x1, y] of scene.thrusters) for (let x = x0; x <= x1; x++) markerPixels.push(y * S + x);
    const markers = new Set(markerPixels);
    matchLuma(ship, ACKDARIAN_REFERENCE[kind], (p) => markers.has(p));
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
    const glow = glowImage(S, scene.lanterns, kind === 'treasure' ? 3.4 : 3.0);
    return { spec, ship, detail, sheen, glow, lanterns: scene.lanterns, markerPixels };
}

// ---------------------------------------------------------------------------------------------------------------
// Portrait and flag: the ceremonial mask emblem
// ---------------------------------------------------------------------------------------------------------------

export const CONCORD_PORTRAIT_SIZE = 300; // images/units/races/race_<i>.png are 300 × 300
export const CONCORD_FLAG_W = 180; // images/ui/flagshapes/flagNN.png are 180 × 107
export const CONCORD_FLAG_H = 107;

/** Emblem material at a point: 0 none, 1 gold, 2 cut-through (dark), 3 lacquer gem, 4 engraved groove. */
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
 * gold lit by warm lantern light from the upper left (plus a dim red fill from the lower right and a specular
 * glint); cut-through slits show deep lacquer, grooves darken, the gem is glossy red; a soft drop shadow falls on
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
                        c = m === 2 ? [0.07, 0.01, 0.01] : shadow ? [bg[0] * 0.5, bg[1] * 0.5, bg[2] * 0.5] : bg;
                    } else {
                        const gx = (at(i + 1, j) - at(i - 1, j)) * light.relief * rad * 0.5;
                        const gy = (at(i, j + 1) - at(i, j - 1)) * light.relief * rad * 0.5;
                        const n = norm3(-gx, -gy, 1);
                        const d1 = Math.max(0, n[0] * L1[0] + n[1] * L1[1] + n[2] * L1[2]);
                        const d2 = Math.max(0, n[0] * L2[0] + n[1] * L2[1] + n[2] * L2[2]);
                        const sp = Math.pow(Math.max(0, n[0] * H1[0] + n[1] * H1[1] + n[2] * H1[2]), 28);
                        const alb: Rgb = m === 3 ? [0.75, 0.08, 0.06] : m === 4 ? [0.42, 0.28, 0.1] : [0.86, 0.64, 0.26];
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

/** The Concord's portrait: the ceremonial mask on lacquer, lit by two hanging lanterns, in a gilded frame. */
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
            let r = 0.62 * v + 0.02;
            let g = 0.07 * v;
            let b = 0.06 * v;
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
                if (Math.abs(gx - l.x) < 0.004 && gy < l.y - 0.06) c = [0.55, 0.4, 0.16];
                if (e < 1) {
                    const rib = Math.abs(Math.sin(((gy - l.y) / 0.062) * Math.PI * 2.5)) < 0.2;
                    const core = 1 - e;
                    c = rib ? [0.62, 0.2, 0.06] : [0.95, 0.35 + 0.45 * core, 0.12 + 0.3 * core];
                }
                if (Math.abs(gx - l.x) < 0.03 && Math.abs(gy - (l.y - 0.066)) < 0.008) c = [0.86, 0.64, 0.26];
                if (Math.abs(gx - l.x) < 0.02 && Math.abs(gy - (l.y + 0.066)) < 0.008) c = [0.86, 0.64, 0.26];
                if (Math.abs(gx - l.x) < 0.006 && gy > l.y + 0.07 && gy < l.y + 0.12) c = [0.78, 0.12, 0.08];
            }
            const e = Math.min(x, y, S - 1 - x, S - 1 - y);
            if (e < 3) c = [0.86, 0.64, 0.26].map((v) => v * (0.8 + 0.12 * e)) as unknown as Rgb;
            else if (e < 4) c = [0.12, 0.02, 0.02];
            else if (e < 7 && ((x + y) >> 2) % 2 === 0) c = [0.62, 0.45, 0.18];
            if (c !== null) {
                d[k] = Math.round(Math.min(1, c[0]) * 255);
                d[k + 1] = Math.round(Math.min(1, c[1]) * 255);
                d[k + 2] = Math.round(Math.min(1, c[2]) * 255);
            }
        }
    }
    return img;
}

/** The Concord's flag: a lacquer-red field, gold border, the gold mask emblem. */
export function generateConcordFlag(w = CONCORD_FLAG_W, h = CONCORD_FLAG_H): RgbaImage {
    const img = renderEmblem(w, h, w / 2, h / 2 + h * 0.02, h * 0.42, {
        relief: 0.55,
        background(_nx, _ny, gx, gy) {
            const wave = 0.9 + 0.1 * Math.sin(gx * 9 + gy * 2.5);
            return [0.72 * wave, 0.08 * wave, 0.07 * wave];
        },
    });
    const d = img.data;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const e = Math.min(x, y, w - 1 - x, h - 1 - y);
            if (e >= 5) continue;
            const k = (y * w + x) * 4;
            const c: Rgb = e < 1 || e === 4 ? [0.5, 0.33, 0.12] : [0.9, 0.7, 0.3];
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

/** The look chosen by the `concordArtLook` param (0 hybrid, 1 pagoda, 2 furled). */
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
    look: ConcordLook = 'hybrid',
): ConcordVariant | null {
    if (concord === null || bo.empire !== concord) return null;
    return { kind: concordKindOf(bo.subRole, treasure.has(bo)), bucket: concordSizeBucket(bo.size), look };
}

/** Lantern glow alpha: warm flicker, brighter in the ambient nav-light "on" phase (lightsOn), low overall. */
export function concordLanternAlpha(secondsOfDay: number, builtObjectID: number): number {
    const on = lightsOn(secondsOfDay, builtObjectID);
    const t = secondsOfDay * 6.3 + (Math.abs(builtObjectID) % 97) * 1.7;
    const flicker = 0.84 + 0.09 * Math.sin(t) + 0.07 * Math.sin(t * 2.7 + 1.3);
    return (on ? 0.55 : 0.36) * flicker;
}

/** Sheen alpha: a slow shimmer (7 s period), phase per ship. */
export function concordSheenAlpha(seconds: number, builtObjectID: number): number {
    const ph = (Math.abs(builtObjectID) % 13) / 13;
    return 0.05 + 0.13 * (0.5 + 0.5 * Math.sin(2 * Math.PI * (seconds / 7 + ph)));
}

/** Fine-detail alpha by drawn size: none below 110 px, full from 220 px (close zoom only). */
export function concordDetailAlpha(drawnPx: number): number {
    const t = Math.max(0, Math.min(1, (drawnPx - 110) / 110));
    return t * t * (3 - 2 * t);
}

/** Lantern / sheen overlays are skipped below this drawn size (px): too small to read, and cheap to skip. */
export const CONCORD_FX_MIN_PX = 12;
/** Above this drawn ship size (px) the lantern glow is skipped (a 240/f-style cap: halos never swamp a close view). */
export const CONCORD_GLOW_MAX_PX = 900;

// ---------------------------------------------------------------------------------------------------------------
// Textures (DOM / Pixi) — generated once per variant, lazily, at most CONCORD_BUILDS_PER_FRAME per frame
// ---------------------------------------------------------------------------------------------------------------

export interface ConcordShipArt {
    texture: Texture;
    metrics: ShipImageMetrics;
    markers: ShipMarkers;
    detail: Texture;
    sheen: Texture;
    glow: Texture;
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
    const art: ConcordShipArt = {
        texture: toCanvasTexture({ w: images.ship.w, h: images.ship.h, data: built.rgba }),
        metrics: built.metrics,
        markers: built.markers,
        detail: toCanvasTexture(images.detail),
        sheen: toCanvasTexture(images.sheen),
        glow: toCanvasTexture(images.glow),
    };
    shipArtCache.set(key, art);
    return art;
}

/** Fine detail, sail / roof sheen and lantern glow over the Concord's ships (pooled; one container above the ships). */
export class ConcordFxLayer {
    readonly root = new Container();
    private pool = new SpritePool(this.root);

    begin(): void {
        this.pool.begin();
    }

    /** Overlays for one ship drawn with the ship sprite's transform; `drawnPx` = its drawn size. */
    draw(art: ConcordShipArt, x: number, y: number, rotation: number, scale: number, anchorX: number, anchorY: number, id: number, drawnPx: number, nowMs: number): void {
        if (drawnPx < CONCORD_FX_MIN_PX) return;
        const sec = nowMs / 1000;
        const layers: [Texture, 'normal' | 'add', number][] = [];
        const detailA = concordDetailAlpha(drawnPx);
        if (detailA > 0) layers.push([art.detail, 'normal', detailA]);
        layers.push([art.sheen, 'add', concordSheenAlpha(sec, id)]);
        if (drawnPx <= CONCORD_GLOW_MAX_PX) layers.push([art.glow, 'add', concordLanternAlpha(sec % 86400, id)]);
        for (const [tex, blend, alpha] of layers) {
            const s = this.pool.acquire(tex);
            s.blendMode = blend;
            s.anchor.set(anchorX, anchorY);
            s.position.set(x, y);
            s.rotation = rotation;
            s.scale.set(scale);
            s.alpha = alpha;
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
