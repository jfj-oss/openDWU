// Scenario 19a art — the Oranthi Concord's own ships (tasks/19-mod-layer-scenarios.md "Concord art"). Not a port:
// the original has no such art. All procedural, one family ("biomech"): dark insects — glossy black chitin with an
// iridescent violet / magenta / pink oil-slick sheen, dark purple and deep pink plate margins — cybernetically
// augmented into giant ships: grafted gunmetal armour bolted into the shell, cable bundles along the segments,
// mechanical engine pods fused onto the abdomen, implanted sensor clusters, and glowing pink-violet seams wherever
// flesh meets machine.
//   Every kind — frigate (wasp), destroyer (mantis-hornet), battleship (armoured stag beetle), carrier (hive-backed
//     beetle with brood hatches), construction ship (worker ant with manipulator mandibles), explorer (dragonfly),
//     freighter (bloated tick with strapped cargo sacs), treasure ship (giant armoured queen), space port and generic
//     base (honeycomb hives with grafted docking arms) — is drawn by concordFleet.ts on the biomech canvas of
//     concordHull.ts: a supersampled G-buffer (height, albedo, material, thin-film phase, steady and pulsing emission)
//     built from anatomy volumes, then detail (growth lines, pores, fine ridges, facets, comb cells, bolts, panel
//     lines) and lighting (normals from the height field, one top-left key light, ambient occlusion, cast shadows, a
//     specular whose colour is the thin-film hue on chitin plus a broad sheen lobe and a slope rim — the oil-slick —
//     and tinted highlights on metal). Each kind is drawn once at twice its largest texture side
//     (concordHullSourceSide); each variant places that image at the kind's fill (CONCORD_HULL_FILL) in its bucket's
//     texture side (box downsample, hard alpha edge), then layers the shared passes on: the scarred look's scratches
//     and old wounds (the pristine look skips them), positional lights found on the silhouette (bioluminescent: hot
//     pink to port at the leftmost point, violet to starboard at the rightmost, pale lilac at the stern and masthead,
//     the warships' two mast strobes), the builders' lamp points, thruster marks at the engine pods' nozzles, and the
//     overlays.
//
// Thruster marks are painted as the originals do (pure-blue runs at the nozzles) and go through the same scan + paint-
// out as stock art (shipArt.ts), so the ambient layer's engine exhaust works unchanged; there are no yellow marks (the
// Concord's own lights replace the stock ones). Overlays sharing the ship's transform: light halos by blink group
// (additive, tight) and the seam glow (additive, breathing on its own slow cycle, phase per ship). Top-down like the
// originals, bow up in the raw image (the ship layer rotates raw art by heading + π/2). Pure and deterministic (own
// hash / RNG, never galaxy.rnd) and testable without a DOM.
//
// Display gate: the rim trader flag and the scenario flag `concordArt` (default on; off = the stock Ackdarian art the
// race file names); `concordArtLook` 0 = scarred (default), 1 = pristine. Render-only — nothing here reads galaxy.rnd
// or writes sim state.

import { Container, Texture } from 'pixi.js';
import { makeTextureCanvas, textureFromRgbaPixels } from './textureCanvas';
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
import { registerEmblemOverride } from '../ui/empireEmblem';
import { drawConcordHull, type ConcordHullDrawing, type ConcordHullKind } from './concordFleet';
import { filmHue, fbm, hashI, noise2, segDist } from './concordHull';

// ---------------------------------------------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------------------------------------------

export type ConcordKind = ConcordHullKind;
export const CONCORD_KINDS: readonly ConcordKind[] = ['frigate', 'destroyer', 'battleship', 'carrier', 'freighter', 'explorer', 'construction', 'treasure', 'port', 'base'];
export type { ConcordHullKind };

/** The military classes (mast strobes). */
export function isConcordMilitary(kind: ConcordKind): boolean {
    return kind === 'frigate' || kind === 'destroyer' || kind === 'battleship' || kind === 'carrier';
}

export function isConcordBase(kind: ConcordKind): boolean {
    return kind === 'port' || kind === 'base';
}

/** 'weathered' = scarred (old wounds, scratches), 'clean' = pristine gloss. */
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
 * CapitalShip → battleship; Carrier → carrier (and anything unlisted → destroyer).
 */
export function concordKindOf(subRole: BuiltObjectSubRole, treasure: boolean): ConcordKind {
    if (treasure) return 'treasure';
    switch (subRole) {
        case BuiltObjectSubRole.Escort:
            return 'frigate';
        case BuiltObjectSubRole.Cruiser:
        case BuiltObjectSubRole.CapitalShip:
            return 'battleship';
        case BuiltObjectSubRole.Carrier:
            return 'carrier';
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
    /** Scarring strength (scratches, old wounds): 1 scarred, 0 pristine; warships ×1.4, hives ×1.6. */
    weathering: number;
    /** Engine pods (one thruster mark at each nozzle). */
    engines: number;
}

/** Engine pods each kind's builder fuses on (concordFleet.ts). */
const ENGINES: Readonly<Record<ConcordKind, number>> = {
    frigate: 2,
    destroyer: 2,
    battleship: 4,
    carrier: 4,
    freighter: 2,
    explorer: 2,
    construction: 2,
    treasure: 4,
    port: 0,
    base: 0,
};

export function concordSpec(kind: ConcordKind, bucket: number, look: ConcordLook = 'weathered'): ConcordSpec {
    const b = Math.max(0, Math.min(CONCORD_BUCKETS - 1, bucket));
    let weathering = look === 'clean' ? 0 : 1;
    if (isConcordMilitary(kind)) weathering *= 1.4;
    if (isConcordBase(kind)) weathering *= 1.6;
    return { kind, look, bucket: b, side: concordTextureSide(kind, b), weathering, engines: ENGINES[kind] };
}

// ---------------------------------------------------------------------------------------------------------------
// Statistics
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
 * Opaque-pixel statistics of the original Ackdarian frames the Oranthi race file borrows (concordArtStats on the raw
 * PNG; the install-gated test re-measures them): the brightness the biomech art is held under (dark, but readable
 * next to the neighbours' stock ships). Only these numbers live in the repo, never the art.
 */
export interface AckdarianReference {
    file: string;
    meanL: number;
    stdL: number;
    meanSat: number;
    p5L: number;
    p95L: number;
}

export const ACKDARIAN_REFERENCE: Readonly<Record<'freighter' | 'base', AckdarianReference>> = {
    freighter: { file: 'family7/largefreighter.png', meanL: 0.255, stdL: 0.183, meanSat: 0.174, p5L: 0.001, p95L: 0.599 },
    base: { file: 'family7/genericbase.png', meanL: 0.242, stdL: 0.141, meanSat: 0.225, p5L: 0.06, p95L: 0.51 },
};

/** Mean luma (opaque, non-light pixels) every kind's drawing is exposed to: about 60 % of the Ackdarian frames'. */
export const CONCORD_TARGET_L = 0.135;

/** Scales the RGB of the pixels not in `keep` so their mean luma reaches `target` (an exposure; hue kept). */
function exposeTo(img: RgbaImage, target: number, keep: (p: number) => boolean): void {
    const d = img.data;
    const n = img.w * img.h;
    for (let pass = 0; pass < 3; pass++) {
        let sum = 0;
        let cnt = 0;
        for (let p = 0; p < n; p++) {
            if (d[p * 4 + 3] < 128 || keep(p)) continue;
            sum += luma709(d[p * 4] / 255, d[p * 4 + 1] / 255, d[p * 4 + 2] / 255);
            cnt++;
        }
        const mean = cnt > 0 ? sum / cnt : 0;
        if (mean <= 1e-4 || Math.abs(mean - target) < 0.002) return;
        const k = target / mean;
        for (let p = 0; p < n; p++) {
            if (d[p * 4 + 3] === 0 || keep(p)) continue;
            d[p * 4] = Math.min(255, Math.round(d[p * 4] * k));
            d[p * 4 + 1] = Math.min(255, Math.round(d[p * 4 + 1] * k));
            d[p * 4 + 2] = Math.min(255, Math.round(d[p * 4 + 2] * k));
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Lights, palette, RNG
// ---------------------------------------------------------------------------------------------------------------

type Rgb = readonly [number, number, number];

/** Light kinds: blink groups of the overlay (and the baked colour). All bioluminescent. */
export type ConcordLightKind = 'lamp' | 'port' | 'starboard' | 'white' | 'strobe' | 'engine';
const LIGHT_COLOUR: Readonly<Record<ConcordLightKind, Rgb>> = {
    lamp: [1, 0.5, 0.9],
    port: [1, 0.22, 0.55],
    starboard: [0.62, 0.38, 1],
    white: [1, 0.84, 1],
    strobe: [1, 0.9, 1],
    engine: [0.8, 0.56, 1],
};

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

const smooth01 = (e0: number, e1: number, x: number): number => {
    const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
};

function norm3(x: number, y: number, z: number): [number, number, number] {
    const l = Math.hypot(x, y, z) || 1;
    return [x / l, y / l, z / l];
}

export interface ConcordLight {
    x: number;
    y: number;
    r: number;
    kind: ConcordLightKind;
}

// ---------------------------------------------------------------------------------------------------------------
// Overlays: light halos by blink group, the seam glow
// ---------------------------------------------------------------------------------------------------------------

/** Blink groups of the overlay: 'pulse' is the seam glow (not point lights). */
export type ConcordLightGroup = 'steady' | 'nav' | 'strobe' | 'engine' | 'pulse';
export const CONCORD_LIGHT_GROUPS: readonly ConcordLightGroup[] = ['steady', 'nav', 'strobe', 'engine', 'pulse'];

export function concordLightGroup(kind: ConcordLightKind): ConcordLightGroup {
    if (kind === 'port' || kind === 'starboard') return 'nav';
    if (kind === 'strobe') return 'strobe';
    if (kind === 'engine') return 'engine';
    return 'steady';
}

/** Tight halos (σ ≈ 1.2–1.8 × the light's radius) of one blink group, each in its own colour. */
function haloImage(S: number, lights: readonly ConcordLight[]): RgbaImage {
    const acc = new Float64Array(S * S * 4);
    for (const l of lights) {
        const sg = Math.max(0.6, l.r * (l.kind === 'engine' || l.kind === 'lamp' ? 1.6 : l.kind === 'strobe' ? 1.8 : 1.3));
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

// ---------------------------------------------------------------------------------------------------------------
// A variant
// ---------------------------------------------------------------------------------------------------------------

export interface ConcordImages {
    spec: ConcordSpec;
    /** The ship / base, straight alpha, with the pure-blue thruster marks still in (shipArt pipeline removes them). */
    ship: RgbaImage;
    /** Tight light halos per blink group (additive); 'pulse' is the seam glow. */
    halos: Record<ConcordLightGroup, RgbaImage>;
    lights: ConcordLight[];
    /** Pixel indices of the thruster marks. */
    markerPixels: number[];
    /** Pixel indices of baked light dots. */
    lightPixels: number[];
}

function variantSeed(kind: ConcordKind, bucket: number, look: ConcordLook): number {
    return (CONCORD_KINDS.indexOf(kind) + 1) * 7919 + bucket * 104729 + CONCORD_LOOKS.indexOf(look) * 15485863;
}

/** Longest extent of the body as a fraction of the texture side. */
export const CONCORD_HULL_FILL: Readonly<Record<ConcordKind, number>> = {
    frigate: 0.89,
    destroyer: 0.92,
    battleship: 0.925,
    carrier: 0.925,
    freighter: 0.9,
    explorer: 0.86,
    construction: 0.88,
    treasure: 0.95,
    port: 0.965,
    base: 0.93,
};

/**
 * Drawn-area ratio per kind (crop square / opaque px, which with the hull size sets the drawn size): the earlier
 * Concord art's measured values, so every kind keeps its on-map footprint whatever its silhouette. The treasure ship
 * draws bigger than its hull size alone gives (about 2× the beam and 1.5× the length of a carrier of its size): its
 * ratio carries CONCORD_TREASURE_AREA_BOOST.
 */
export const CONCORD_TREASURE_AREA_BOOST = 3;
export const CONCORD_HULL_AREA_RATIO: Readonly<Record<ConcordKind, number>> = {
    frigate: 5.0,
    destroyer: 4.6,
    battleship: 3.9,
    carrier: 3.9,
    freighter: 4.4,
    explorer: 5.4,
    construction: 3.7,
    treasure: 3.1 * CONCORD_TREASURE_AREA_BOOST,
    port: 2.2,
    base: 2.2,
};

/** Side of a kind's full-resolution drawing: twice its largest texture side (every variant downsamples from it). */
export function concordHullSourceSide(kind: ConcordKind): number {
    return 2 * concordTextureSide(kind, CONCORD_BUCKETS - 1);
}

/** A kind's drawing, exposed and with its lamp / nozzle sites in px. */
export interface ConcordSource {
    img: RgbaImage;
    glow: RgbaImage;
    /** px of the source image. */
    nozzles: { x: number; y: number; r: number }[];
    lamps: { x: number; y: number; r: number }[];
}

const hullSources = new Map<ConcordKind, ConcordSource>();

/** Turns a raw drawing into a source: exposure to CONCORD_TARGET_L (the emissive pixels kept), sites in px. */
export function concordSourceOf(d: ConcordHullDrawing): ConcordSource {
    const k = d.img.w / 1000;
    const img: RgbaImage = { w: d.img.w, h: d.img.h, data: d.img.data };
    const glow = d.glow.data;
    exposeTo(img, CONCORD_TARGET_L, (p) => glow[p * 4 + 3] > 140);
    const px = (s: { x: number; y: number; r: number }): { x: number; y: number; r: number } => ({ x: s.x * k, y: s.y * k, r: s.r * k });
    return { img, glow: { w: d.glow.w, h: d.glow.h, data: d.glow.data }, nozzles: d.nozzles.map(px), lamps: d.lamps.map(px) };
}

/** A kind's full-resolution drawing (drawn once, then cached; pure and deterministic). */
export function concordHullSource(kind: ConcordKind): ConcordSource {
    let src = hullSources.get(kind);
    if (src === undefined) {
        src = concordSourceOf(drawConcordHull(kind, concordHullSourceSide(kind)));
        hullSources.set(kind, src);
    }
    return src;
}

/** Inclusive bbox of the pixels with alpha ≥ `min`, or null. */
function alphaBox(img: RgbaImage, min: number): { x0: number; y0: number; x1: number; y1: number } | null {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < img.h; y++) {
        for (let x = 0; x < img.w; x++) {
            if (img.data[(y * img.w + x) * 4 + 3] < min) continue;
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            y1 = y;
        }
    }
    return x1 < 0 ? null : { x0, y0, x1, y1 };
}

/** Area weights of a box resample along one axis: dest pixel d covers source [(d − origin)/k, (d + 1 − origin)/k). */
function axisWeights(destLen: number, origin: number, k: number, srcLen: number): { from: number; w: number[] }[] {
    const out: { from: number; w: number[] }[] = [];
    for (let d = 0; d < destLen; d++) {
        const a = Math.max(0, (d - origin) / k);
        const b = Math.min(srcLen, (d + 1 - origin) / k);
        const from = Math.floor(a);
        const w: number[] = [];
        for (let s = from; s < b; s++) w.push((Math.min(b, s + 1) - Math.max(a, s)) * k);
        out.push({ from, w });
    }
    return out;
}

/** Where a source lands on an S × S texture: its alpha bbox scaled by k, offset to centre it. */
export interface ConcordPlacement {
    box: { x0: number; y0: number; x1: number; y1: number };
    k: number;
    ox: number;
    oy: number;
}

export function concordPlacement(src: RgbaImage, S: number, fill: number): ConcordPlacement | null {
    const box = alphaBox(src, 8);
    if (box === null) return null;
    const bw = box.x1 - box.x0 + 1;
    const bh = box.y1 - box.y0 + 1;
    const k = (fill * S) / Math.max(bw, bh);
    return { box, k, ox: (S - bw * k) / 2, oy: (S - bh * k) / 2 };
}

/**
 * Resamples the placed box of `src` onto an S × S canvas: an area-average (box) resample in premultiplied alpha,
 * separable; `hard` gives a hard alpha edge (half-covered pixels opaque, the rest clear, like the stock sprites).
 */
function resample(src: RgbaImage, S: number, pl: ConcordPlacement, hard: boolean): RgbaImage {
    const data = new Uint8ClampedArray(S * S * 4);
    const { box, k, ox, oy } = pl;
    const bw = box.x1 - box.x0 + 1;
    const bh = box.y1 - box.y0 + 1;
    const wx = axisWeights(S, ox, k, bw);
    const wy = axisWeights(S, oy, k, bh);
    const tmp = new Float32Array(S * bh * 4);
    for (let y = 0; y < bh; y++) {
        const row = (box.y0 + y) * src.w;
        for (let x = 0; x < S; x++) {
            const { from, w } = wx[x];
            let r = 0;
            let g = 0;
            let b = 0;
            let a = 0;
            for (let q = 0; q < w.length; q++) {
                const i = (row + box.x0 + from + q) * 4;
                const al = (src.data[i + 3] / 255) * w[q];
                r += src.data[i] * al;
                g += src.data[i + 1] * al;
                b += src.data[i + 2] * al;
                a += al;
            }
            const t = (y * S + x) * 4;
            tmp[t] = r;
            tmp[t + 1] = g;
            tmp[t + 2] = b;
            tmp[t + 3] = a;
        }
    }
    for (let y = 0; y < S; y++) {
        const { from, w } = wy[y];
        if (w.length === 0) continue;
        for (let x = 0; x < S; x++) {
            let r = 0;
            let g = 0;
            let b = 0;
            let a = 0;
            for (let q = 0; q < w.length; q++) {
                const t = ((from + q) * S + x) * 4;
                r += tmp[t] * w[q];
                g += tmp[t + 1] * w[q];
                b += tmp[t + 2] * w[q];
                a += tmp[t + 3] * w[q];
            }
            if (hard ? a < 0.5 : a < 0.004) continue;
            const o = (y * S + x) * 4;
            data[o] = Math.round(r / a);
            data[o + 1] = Math.round(g / a);
            data[o + 2] = Math.round(b / a);
            data[o + 3] = hard ? 255 : Math.round(Math.min(1, a) * 255);
        }
    }
    return { w: S, h: S, data };
}

/** The body's silhouette scaled so its longest side is `fill` × S and centred (hard alpha edge). Pure. */
export function placeConcordHull(src: RgbaImage, S: number, fill: number): RgbaImage {
    const pl = concordPlacement(src, S, fill);
    if (pl === null) return { w: S, h: S, data: new Uint8ClampedArray(S * S * 4) };
    return resample(src, S, pl, true);
}

/**
 * The scarred look on a placed body (the pristine look skips it): pale scratches across the chitin, a few old wounds
 * (healed scar tissue: dull, pinkish, with a dark rim) and dulled blotches, scaled by the spec's strength. Never moves
 * the silhouette.
 */
function scarring(img: RgbaImage, spec: ConcordSpec, rng: () => number): void {
    const { w: S, data: d } = img;
    const wk = spec.weathering;
    if (wk <= 0) return;
    const k240 = 240 / S;
    for (let p = 0; p < S * S; p++) {
        if (d[p * 4 + 3] === 0) continue;
        const x = (p % S) * k240;
        const y = Math.floor(p / S) * k240;
        const m = 1 - 0.14 * Math.min(1.3, wk) * smooth01(0.6, 0.85, noise2(x * 0.11, y * 0.11, 53));
        d[p * 4] *= m;
        d[p * 4 + 1] *= m;
        d[p * 4 + 2] *= m;
    }
    const tint = (i: number, c: Rgb, t: number): void => {
        d[i] += (c[0] * 255 - d[i]) * t;
        d[i + 1] += (c[1] * 255 - d[i + 1]) * t;
        d[i + 2] += (c[2] * 255 - d[i + 2]) * t;
    };
    const scratches = Math.round(S * 0.1 * wk);
    for (let n = 0, tries = 0; n < scratches && tries < scratches * 8; tries++) {
        const x0 = rng() * S;
        const y0 = rng() * S;
        if (d[(Math.floor(y0) * S + Math.floor(x0)) * 4 + 3] < 255) continue;
        n++;
        const a = rng() * Math.PI;
        const len = (1 + rng() * 2.5) * (S / 240);
        const x1 = x0 + Math.cos(a) * len;
        const y1 = y0 + Math.sin(a) * len;
        for (let y = Math.max(0, Math.floor(Math.min(y0, y1) - 1)); y <= Math.min(S - 1, Math.ceil(Math.max(y0, y1) + 1)); y++) {
            for (let x = Math.max(0, Math.floor(Math.min(x0, x1) - 1)); x <= Math.min(S - 1, Math.ceil(Math.max(x0, x1) + 1)); x++) {
                const i = (y * S + x) * 4;
                if (d[i + 3] < 200 || segDist(x + 0.5, y + 0.5, x0, y0, x1, y1) > 0.5) continue;
                tint(i, [0.3, 0.24, 0.34], 0.22 * Math.min(1, wk));
            }
        }
    }
    const wounds = Math.round(S * 0.02 * wk) + 1;
    for (let n = 0, tries = 0; n < wounds && tries < wounds * 10; tries++) {
        const cx = rng() * S;
        const cy = rng() * S;
        if (d[(Math.floor(cy) * S + Math.floor(cx)) * 4 + 3] < 255) continue;
        n++;
        const r = (1.2 + rng() * 2.2) * (S / 240);
        for (let y = Math.max(0, Math.floor(cy - r - 1)); y <= Math.min(S - 1, Math.ceil(cy + r + 1)); y++) {
            for (let x = Math.max(0, Math.floor(cx - r - 1)); x <= Math.min(S - 1, Math.ceil(cx + r + 1)); x++) {
                const i = (y * S + x) * 4;
                if (d[i + 3] < 200) continue;
                const q = Math.hypot(x + 0.5 - cx, (y + 0.5 - cy) * 1.4) / r;
                if (q > 1.25) continue;
                if (q > 1) tint(i, [0.02, 0.01, 0.03], 0.5);
                else tint(i, [0.36, 0.14, 0.24], 0.55 * (1 - q * 0.6));
            }
        }
    }
}

/** Opaque runs [x0, x1] (inclusive, alpha ≥ `min`) of one row. */
function rowRuns(img: RgbaImage, y: number, min: number): [number, number][] {
    const runs: [number, number][] = [];
    let start = -1;
    for (let x = 0; x <= img.w; x++) {
        const on = x < img.w && img.data[(y * img.w + x) * 4 + 3] >= min;
        if (on && start < 0) start = x;
        else if (!on && start >= 0) {
            runs.push([start, x - 1]);
            start = -1;
        }
    }
    return runs;
}

/** The run of a row nearest the centre column (the body, not a limb), or null. */
function centreRun(img: RgbaImage, y: number, min: number): [number, number] | null {
    const c = img.w / 2;
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (const r of rowRuns(img, y, min)) {
        const d = c < r[0] ? r[0] - c : c > r[1] ? c - r[1] : 0;
        if (d < bestD || (d === bestD && best !== null && r[1] - r[0] > best[1] - best[0])) {
            best = r;
            bestD = d;
        }
    }
    return best;
}

/**
 * Lights and thruster marks of a placed body: pink to port at its leftmost point, violet to starboard at its
 * rightmost, lilac at the stern and the masthead (the hives: fore and aft), the warships' two mast strobes, the
 * builders' lamps, and one thruster mark at each engine pod's nozzle with a glow there. Every point sits inside the
 * opaque silhouette.
 */
function hullFittings(img: RgbaImage, spec: ConcordSpec, src: ConcordSource, pl: ConcordPlacement): { lights: ConcordLight[]; thrusters: [number, number, number][] } {
    const S = img.w;
    const A = 200;
    const lights: ConcordLight[] = [];
    const thrusters: [number, number, number][] = [];
    const box = alphaBox(img, A);
    if (box === null) return { lights, thrusters };
    const r = (kind: ConcordLightKind): number => Math.max(0.45, S * (kind === 'lamp' ? 0.0028 : 0.0034));
    const inset = (kind: ConcordLightKind): number => Math.max(1, Math.ceil(r(kind) * 1.5));
    const opaque = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < S && y < S && img.data[(y * S + x) * 4 + 3] >= A;
    const add = (x: number, y: number, kind: ConcordLightKind, rr = r(kind)): void => {
        let px = Math.round(x);
        let py = Math.round(y);
        for (let n = 0; n < S && !opaque(px, py); n++) {
            px += Math.sign(Math.round(S / 2) - px);
            py += Math.sign(Math.round(S / 2) - py);
        }
        lights.push({ x: px + 0.5, y: py + 0.5, r: rr, kind });
    };
    const map = (x: number, y: number): [number, number] => [pl.ox + (x - pl.box.x0) * pl.k, pl.oy + (y - pl.box.y0) * pl.k];
    const sideLight = (dir: -1 | 1, kind: ConcordLightKind): void => {
        let best = dir < 0 ? Infinity : -Infinity;
        const rows: number[] = [];
        for (let y = box.y0; y <= box.y1; y++) {
            const runs = rowRuns(img, y, A);
            if (runs.length === 0) continue;
            const e = dir < 0 ? runs[0][0] : runs[runs.length - 1][1];
            if (dir < 0 ? e < best - 1 : e > best + 1) {
                best = e;
                rows.length = 0;
            }
            if (Math.abs(e - best) <= 1) rows.push(y);
        }
        add(best - dir * inset(kind), rows[Math.floor(rows.length / 2)], kind);
    };
    sideLight(-1, 'port');
    sideLight(1, 'starboard');
    const endLight = (y: number): void => {
        const run = centreRun(img, y, A);
        if (run !== null) add((run[0] + run[1] + 1) / 2, y, 'white');
    };
    endLight(box.y1 - inset('white'));
    if (isConcordBase(spec.kind)) endLight(box.y0 + inset('white'));
    else {
        const ym = Math.round(box.y0 + (box.y1 - box.y0) * 0.4);
        const run = centreRun(img, ym, A);
        if (run !== null) {
            const mx = (run[0] + run[1] + 1) / 2;
            add(mx, ym, 'white');
            if (isConcordMilitary(spec.kind)) {
                const off = Math.max(1.5, S * 0.012);
                add(mx - off, ym + off * 0.5, 'strobe');
                add(mx + off, ym + off * 0.5, 'strobe');
            }
        }
    }
    for (const l of src.lamps) {
        const [x, y] = map(l.x, l.y);
        add(x, y, 'lamp', Math.max(0.45, Math.min(S * 0.005, l.r * pl.k * 0.9)));
    }
    // Thruster marks: one per nozzle, on the lowest opaque row at the nozzle (within its width), at least a pixel apart.
    const used = new Set<number>();
    for (const nz of src.nozzles) {
        const [cx, cy] = map(nz.x, nz.y);
        const hw = Math.max(0.5, nz.r * pl.k * 0.55);
        let x0 = Math.round(cx - hw);
        let x1 = Math.round(cx + hw) - 1;
        if (x1 < x0) x1 = x0;
        let y = Math.min(S - 1, Math.ceil(cy));
        for (; y > 0; y--) {
            let all = true;
            for (let x = x0; x <= x1; x++) if (!opaque(x, y)) all = false;
            if (all) break;
        }
        // Keep a clear pixel between neighbouring marks in the same row.
        while (x0 <= x1 && (used.has(y * S + x0 - 1) || used.has(y * S + x0))) x0++;
        while (x1 >= x0 && (used.has(y * S + x1 + 1) || used.has(y * S + x1))) x1--;
        if (x1 < x0) continue;
        for (let x = x0; x <= x1; x++) used.add(y * S + x);
        thrusters.push([x0, x1, y]);
        lights.push({ x: (x0 + x1 + 1) / 2, y: y + 0.5, r: r('engine'), kind: 'engine' });
    }
    return { lights, thrusters };
}

/**
 * Images of a variant (pure; no DOM): the kind's full-resolution drawing (concordHullSource) placed at the kind's
 * fill, the scarred look's scratches and wounds (pristine: none), the lights and thruster marks, baked light dots and
 * the overlays (the light halos by blink group and the placed seam glow).
 */
export function composeConcordHullImages(kind: ConcordKind, bucket: number, look: ConcordLook, src: ConcordSource = concordHullSource(kind)): ConcordImages {
    const spec = concordSpec(kind, bucket, look);
    const S = spec.side;
    const pl = concordPlacement(src.img, S, CONCORD_HULL_FILL[kind]);
    const ship = pl === null ? { w: S, h: S, data: new Uint8ClampedArray(S * S * 4) } : resample(src.img, S, pl, true);
    const pulse = pl === null ? { w: S, h: S, data: new Uint8ClampedArray(S * S * 4) } : resample(src.glow, S, pl, false);
    if (look === 'weathered') scarring(ship, spec, makeRng(variantSeed(kind, bucket, look)));
    const { lights, thrusters } = pl === null ? { lights: [], thrusters: [] } : hullFittings(ship, spec, src, pl);
    const d = ship.data;
    for (let p = 0; p < S * S; p++) {
        const i = p * 4;
        if (d[i + 3] === 0) continue;
        // Never leave an accidental pure-blue / pure-yellow marker colour in the art.
        if ((d[i] === 0 && d[i + 1] === 0 && d[i + 2] === 255) || (d[i] === 255 && d[i + 1] === 255 && d[i + 2] === 0)) d[i + 2] = d[i + 2] === 255 ? 254 : 1;
    }
    const lightPixels: number[] = [];
    for (const l of lights) {
        const c = LIGHT_COLOUR[l.kind];
        const dim = l.kind === 'strobe' ? 0.55 : 1;
        for (let y = Math.max(0, Math.floor(l.y - l.r)); y <= Math.min(S - 1, Math.floor(l.y + l.r)); y++) {
            for (let x = Math.max(0, Math.floor(l.x - l.r)); x <= Math.min(S - 1, Math.floor(l.x + l.r)); x++) {
                const p = y * S + x;
                if (d[p * 4 + 3] === 0 || Math.hypot(x + 0.5 - l.x, y + 0.5 - l.y) > Math.max(0.71, l.r)) continue;
                d[p * 4] = Math.round(c[0] * dim * 255);
                d[p * 4 + 1] = Math.round(c[1] * dim * 255);
                d[p * 4 + 2] = Math.round(c[2] * dim * 255);
                lightPixels.push(p);
            }
        }
    }
    const markerPixels: number[] = [];
    for (const [x0, x1, y] of thrusters) {
        for (let x = x0; x <= x1; x++) {
            const p = y * S + x;
            markerPixels.push(p);
            d[p * 4] = 0;
            d[p * 4 + 1] = 0;
            d[p * 4 + 2] = 255;
            d[p * 4 + 3] = 255;
        }
    }
    const halos = {} as Record<ConcordLightGroup, RgbaImage>;
    for (const g of CONCORD_LIGHT_GROUPS) halos[g] = g === 'pulse' ? pulse : haloImage(S, lights.filter((l) => concordLightGroup(l.kind) === g));
    return { spec, ship, halos, lights, markerPixels, lightPixels };
}

/** Images of any variant (pure; no DOM; deterministic). */
export function concordImages(kind: ConcordKind, bucket: number, look: ConcordLook = 'weathered'): ConcordImages {
    return composeConcordHullImages(kind, bucket, look);
}

// ---------------------------------------------------------------------------------------------------------------
// Portrait and flag: the biomech insect mask and the insect emblem (black chitin, violet / pink)
// ---------------------------------------------------------------------------------------------------------------

export const CONCORD_PORTRAIT_SIZE = 300; // images/units/races/race_<i>.png are 300 × 300
export const CONCORD_FLAG_W = 180; // images/ui/flagshapes/flagNN.png are 180 × 107
export const CONCORD_FLAG_H = 107;

/** Contrast (luma standard deviation, opaque pixels) of the original Ackdarian portrait (images/units/races/race_7.png,
 * the art the Oranthi race file borrows): the Concord portrait is held at least this contrasty. */
export const ACKDARIAN_PORTRAIT_STDL = 0.243;

/** Relief material ids. */
const R_NONE = 0;
const R_CHITIN = 1;
const R_MARGIN = 2;
const R_EYE = 3;
const R_METAL = 4;
const R_CABLE = 5;
const R_LENS = 6;

interface ReliefPt {
    h: number;
    m: number;
    /** Thin-film phase. */
    film: number;
    /** Emission (pink-violet), 0..1, and its hue mix (0 pink … 1 violet). */
    e: number;
    eh: number;
}

function clearPt(o: ReliefPt): void {
    o.h = 0;
    o.m = R_NONE;
    o.film = 0;
    o.e = 0;
    o.eh = 0;
}

const SEAM_P: Rgb = [1, 0.3, 0.72];
const SEAM_V: Rgb = [0.72, 0.34, 1];

function ellE(x: number, y: number, cx: number, cy: number, a: number, b: number): number {
    return Math.hypot((x - cx) / a, (y - cy) / b);
}

/** Quadratic Bézier distance (sampled): distance and parameter of the nearest sample. */
function bezDist(x: number, y: number, p0: Rgb2, p1: Rgb2, p2: Rgb2, n = 24): { d: number; t: number } {
    let best = Infinity;
    let bt = 0;
    let px = p0[0];
    let py = p0[1];
    for (let k = 1; k <= n; k++) {
        const t = k / n;
        const qx = (1 - t) * (1 - t) * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0];
        const qy = (1 - t) * (1 - t) * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1];
        const d = segDist(x, y, px, py, qx, qy);
        if (d < best) {
            best = d;
            bt = t - 0.5 / n;
        }
        px = qx;
        py = qy;
    }
    return { d: best, t: bt };
}
type Rgb2 = readonly [number, number];

/**
 * The portrait's head in normalised coordinates (≈ ±1, y down), seen from the front: a broad chitin head capsule
 * narrowing to the mouth, huge faceted compound eyes (the right one ringed by a cybernetic implant with a violet lens),
 * three ocelli, a bolted metal plate on the frons with glowing seams, segmented antennae sweeping up, a clypeus plate,
 * curved mandibles with metal-tipped edges, and cable bundles running from the cheeks down out of frame.
 */
function headAt(x: number, y: number, o: ReliefPt): void {
    clearPt(o);
    const ax = Math.abs(x);
    const s = x < 0 ? -1 : 1;
    // Cables from the cheeks down (behind everything else).
    for (const sg of [-1, 1]) {
        for (const off of [-0.035, 0.035]) {
            const b = bezDist(x, y, [sg * 0.46 + off, 0.2], [sg * 0.62 + off, 0.55], [sg * 0.7 + off, 1.05]);
            const r = 0.028;
            if (b.d < r) {
                const hh = 0.25 + 0.12 * Math.sqrt(1 - (b.d / r) ** 2);
                if (hh > o.h) {
                    o.h = hh;
                    o.m = (Math.floor(b.t * 14) & 3) === 0 ? R_METAL : R_CABLE;
                    o.film = b.t;
                }
            }
        }
    }
    // Antennae: beaded, from the frons up and out.
    {
        const b = bezDist(ax, y, [0.13, -0.42], [0.3, -0.85], [0.78, -0.98]);
        const r = 0.026 * (1 - b.t * 0.45);
        const bead = 0.5 + 0.5 * Math.cos(b.t * 70);
        if (b.d < r * (0.85 + 0.25 * bead)) {
            const hh = 0.55 + 0.1 * Math.sqrt(Math.max(0, 1 - (b.d / r) ** 2));
            if (hh > o.h) {
                o.h = hh;
                o.m = bead > 0.8 ? R_MARGIN : R_CHITIN;
                o.film = 0.3 + b.t;
            }
        }
    }
    // Mandibles: curved blades from the jaw corners down and inward.
    {
        const b = bezDist(ax, y, [0.22, 0.4], [0.36, 0.7], [0.04, 0.86]);
        const r = 0.085 * (1 - b.t * 0.8) + 0.01;
        if (b.d < r) {
            const hh = 0.52 + 0.18 * Math.sqrt(1 - (b.d / r) ** 2);
            if (hh > o.h) {
                o.h = hh;
                o.m = b.t > 0.62 ? R_METAL : R_CHITIN;
                o.film = 0.5 + b.t * 0.6;
                if (b.t > 0.55 && b.t < 0.62) {
                    o.e = 0.8;
                    o.eh = 0.2;
                }
            }
        }
    }
    // Head capsule: wide at the eyes, narrowing to the mouth.
    const top = -0.62;
    const bot = 0.5;
    if (y > top && y < bot) {
        const t = (y - top) / (bot - top);
        const w = 0.6 * Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 4)) * (1 - 0.42 * Math.max(0, t - 0.45) / 0.55);
        if (ax < w) {
            const u = ax / w;
            let hh = 0.6 + 0.4 * Math.pow(1 - Math.pow(u, 2.4), 0.42) * Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2));
            o.m = u > 0.93 ? R_MARGIN : R_CHITIN;
            o.film = 0.2 * t + 0.7 * u;
            // Central ridge, growth lines along the rim.
            hh += 0.03 * Math.max(0, 1 - ax / 0.03);
            hh += 0.006 * Math.sin((1 - u) * w * 160) * Math.exp(-(1 - u) * 6);
            // Frons plate (grafted metal), seams glowing.
            const fe = Math.max(Math.abs(x) / 0.16, Math.abs(y + 0.28) / 0.1);
            if (fe < 1) {
                hh += 0.05;
                o.m = R_METAL;
                const bolt = Math.hypot(Math.abs(x) - 0.12, Math.abs(y + 0.28) - 0.065);
                if (bolt < 0.016) hh += 0.02;
                if (Math.abs(x) < 0.12 && Math.abs(((y + 0.28) * 40) % 1) < 0.1) hh -= 0.01;
            } else if (fe < 1.12) {
                hh -= 0.02;
                o.e = 0.9;
                o.eh = 0.1;
            }
            // Clypeus plate and mouth.
            const ce = ellE(x, y, 0, 0.3, 0.2, 0.1);
            if (ce < 1) {
                hh += 0.04 * Math.sqrt(1 - ce);
                o.m = R_CHITIN;
                o.film = 0.8;
            } else if (ce < 1.08) {
                hh -= 0.03;
                o.m = R_MARGIN;
            }
            if (ellE(x, y, 0, 0.45, 0.1, 0.04) < 1) {
                hh -= 0.1;
                o.e = 0.5;
                o.eh = 0.3;
            }
            // Ocelli.
            for (const [ox, oy] of [[0, -0.47], [-0.065, -0.41], [0.065, -0.41]] as const) {
                if (Math.hypot(x - ox, y - oy) < 0.024) {
                    hh += 0.015;
                    o.m = R_LENS;
                    o.e = 0.9;
                    o.eh = 0.6;
                }
            }
            o.h = Math.max(o.h, hh);
        }
    }
    // Compound eyes.
    const ex = 0.36;
    const ey = -0.06;
    const ee = ellE(x, y, s * ex, ey, 0.24, 0.31);
    if (ee < 1.12) {
        if (ee < 1) {
            const facet = 0.022;
            const qx = (x - s * ex) / facet;
            const qy = (y - ey) / (facet * 0.866);
            const row = Math.round(qy);
            const offc = row & 1 ? 0.5 : 0;
            const col = Math.round(qx - offc);
            const dc = Math.hypot(qx - (col + offc), (qy - row) * 0.866);
            o.h = 0.85 + 0.22 * Math.sqrt(1 - ee * ee) + 0.012 * Math.sqrt(Math.max(0, 1 - dc * dc * 1.5));
            o.m = R_EYE;
            o.film = 0.15 + ee * 0.8 + 0.12 * hashI(col, row, 3);
            o.e = (hashI(col, row, s > 0 ? 7 : 11) < 0.12 ? 0.22 : 0.02) * (1 - ee * 0.7);
            o.eh = 0.35;
            // The right eye's implant: a violet lens inside a bolted ring.
            if (s > 0) {
                const le = ellE(x, y, ex + 0.04, ey + 0.04, 0.1, 0.1);
                if (le < 1) {
                    o.m = R_LENS;
                    o.h = 1.1 + 0.05 * Math.sqrt(1 - le * le);
                    o.e = 0.45 * (1 - le * 0.6);
                    o.eh = 0.85;
                } else if (le < 1.45) {
                    o.m = R_METAL;
                    o.h = 1.12 - 0.02 * Math.abs(le - 1.22);
                    o.e = le < 1.08 ? 0.9 : 0;
                    o.eh = 0.5;
                    const ang = Math.atan2(y - ey - 0.04, x - ex - 0.04);
                    if (Math.abs(((ang / (Math.PI * 2)) * 8 + 8) % 1 - 0.5) < 0.1 && le > 1.25 && le < 1.38) o.h += 0.02;
                }
            }
        } else if (o.m !== R_NONE) {
            // Glowing seam around the eye socket.
            o.e = Math.max(o.e, 0.6 * (1 - (ee - 1) / 0.12));
            o.eh = 0.15;
            o.h -= 0.03;
        }
    }
}

/** The flag's emblem (normalised, ≈ ±1): a top-down armoured beetle — mandibles, pronotum, elytra, six legs, feelers. */
function emblemAt(x: number, y: number, o: ReliefPt): void {
    clearPt(o);
    const ax = Math.abs(x);
    const tubeAt = (d: number, r: number, h: number, m: number, film: number): void => {
        if (d >= r) return;
        const hh = h + 0.1 * Math.sqrt(1 - (d / r) ** 2);
        if (hh > o.h) {
            o.h = hh;
            o.m = m;
            o.film = film;
        }
    };
    // Legs (three pairs).
    for (const [p0, p1, p2] of [
        [[0.22, -0.2], [0.55, -0.35], [0.62, -0.62]],
        [[0.3, 0.08], [0.62, 0.05], [0.78, 0.3]],
        [[0.28, 0.32], [0.55, 0.5], [0.6, 0.85]],
    ] as const) {
        const b = bezDist(ax, y, p0, p1, p2, 16);
        tubeAt(b.d, 0.05 * (1 - b.t * 0.5), 0.2, R_CHITIN, b.t);
    }
    // Feelers.
    {
        const b = bezDist(ax, y, [0.08, -0.68], [0.25, -0.95], [0.5, -0.92], 16);
        tubeAt(b.d, 0.025, 0.3, R_MARGIN, b.t);
    }
    // Mandibles.
    {
        const b = bezDist(ax, y, [0.1, -0.62], [0.24, -0.82], [0.04, -0.94], 16);
        tubeAt(b.d, 0.07 * (1 - b.t * 0.7), 0.35, b.t > 0.7 ? R_METAL : R_CHITIN, 0.4 + b.t * 0.5);
    }
    // Head.
    const he = ellE(x, y, 0, -0.56, 0.17, 0.13);
    if (he < 1) {
        o.h = 0.55 + 0.25 * Math.sqrt(1 - he * he);
        o.m = R_CHITIN;
        o.film = 0.1;
        for (const sg of [-1, 1]) if (ellE(x, y, sg * 0.12, -0.56, 0.06, 0.07) < 1) {
            o.m = R_EYE;
            o.e = 0.6;
            o.eh = 0.3;
        }
    }
    // Pronotum.
    const pe = ellE(x, y, 0, -0.3, 0.34, 0.19);
    if (pe < 1) {
        o.h = 0.65 + 0.3 * Math.sqrt(1 - pe * pe);
        o.m = pe > 0.86 ? R_MARGIN : R_CHITIN;
        o.film = 0.25 + pe * 0.6;
        if (Math.max(ax / 0.12, Math.abs(y + 0.3) / 0.07) < 1) {
            o.m = R_METAL;
            o.h += 0.04;
        }
    } else if (pe < 1.07 && o.h > 0) {
        o.e = 0.8;
        o.eh = 0.1;
    }
    // Elytra: two cases with a glowing suture.
    if (y > -0.12 && y < 0.82) {
        const t = (y + 0.12) / 0.94;
        const w = 0.42 * (t < 0.1 ? Math.sqrt(t / 0.1) : t > 0.6 ? Math.sqrt(Math.max(0, 1 - ((t - 0.6) / 0.4) ** 2)) : 1);
        if (ax < w) {
            const u = ax / w;
            o.h = 0.7 + 0.3 * Math.pow(1 - Math.pow(u, 3), 0.33) * (0.5 + 0.5 * Math.sqrt(Math.max(0, 1 - ((t - 0.4) / 0.6) ** 2)));
            o.m = u > 0.9 ? R_MARGIN : R_CHITIN;
            o.film = 0.45 + u * 0.7 + t * 0.3;
            if (ax < 0.018) {
                o.e = 0.95;
                o.eh = 0.15;
                o.h -= 0.08;
            }
            // Striae and a bolted graft plate on each case.
            if (Math.abs(((ax / w) * 4) % 1 - 0.5) > 0.47 && u > 0.1 && u < 0.85) o.h -= 0.02;
            if (Math.max(Math.abs(ax - 0.22) / 0.1, Math.abs(y - 0.25) / 0.12) < 1) {
                o.m = R_METAL;
                o.h += 0.03;
            } else if (Math.max(Math.abs(ax - 0.22) / 0.1, Math.abs(y - 0.25) / 0.12) < 1.12) {
                o.e = 0.85;
                o.eh = 0.7;
            }
        }
    }
}

interface ReliefLights {
    /** Background colour at the normalised point (nx, ny) and the 0..1 image position (gx, gy). */
    background(nx: number, ny: number, gx: number, gy: number): Rgb;
    relief: number;
    key: readonly [number, number, number];
    rim: readonly [number, number, number];
    rimColour: Rgb;
    shadow: number;
}

/**
 * Renders a relief field over a background into a w × h image at 2× supersampling: heights → normals → black chitin
 * lit by a cool key light plus a pink rim, a thin-film specular (the oil-slick) on chitin, eyes and lenses, tinted
 * highlights on metal, emission (seams, eyes, ocelli) added with a soft glow, and a drop shadow on the background.
 */
function renderRelief(w: number, h: number, cx: number, cy: number, radius: number, field: (x: number, y: number, o: ReliefPt) => void, L: ReliefLights): RgbaImage {
    const ss = 2;
    const W = w * ss;
    const H = h * ss;
    const hs = new Float32Array(W * H);
    const ms = new Uint8Array(W * H);
    const fs = new Float32Array(W * H);
    const es = new Float32Array(W * H);
    const ehs = new Float32Array(W * H);
    const pt: ReliefPt = { h: 0, m: 0, film: 0, e: 0, eh: 0 };
    const rad = radius * ss;
    for (let j = 0; j < H; j++) {
        for (let i = 0; i < W; i++) {
            field((i + 0.5 - cx * ss) / rad, (j + 0.5 - cy * ss) / rad, pt);
            const c = j * W + i;
            hs[c] = pt.h;
            ms[c] = pt.m;
            fs[c] = pt.film;
            es[c] = pt.e;
            ehs[c] = pt.eh;
        }
    }
    // Glow: a cheap blur of the emission (box, 2 passes) for the halo around seams.
    const glow = blur1(es, W, H, Math.max(2, Math.round(rad * 0.025)));
    const shadowOff = Math.max(2, Math.round(rad * 0.04));
    const key = L.key;
    const rim = L.rim;
    const KH = norm3(key[0], key[1], key[2] + 1);
    const at = (i: number, j: number): number => hs[Math.min(H - 1, Math.max(0, j)) * W + Math.min(W - 1, Math.max(0, i))];
    const out = new Uint8ClampedArray(w * h * 4);
    const fc: [number, number, number] = [0, 0, 0];
    const fc2: [number, number, number] = [0, 0, 0];
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let ar = 0;
            let ag = 0;
            let ab = 0;
            for (let sj = 0; sj < ss; sj++) {
                for (let si = 0; si < ss; si++) {
                    const i = x * ss + si;
                    const j = y * ss + sj;
                    const c = j * W + i;
                    const m = ms[c];
                    const nx = (i + 0.5 - cx * ss) / rad;
                    const ny = (j + 0.5 - cy * ss) / rad;
                    let R: number;
                    let G: number;
                    let B: number;
                    if (m === R_NONE) {
                        const bg = L.background(nx, ny, x / w, y / h);
                        const sh = ms[Math.max(0, j - shadowOff) * W + Math.max(0, i - shadowOff)] !== R_NONE ? L.shadow : 1;
                        R = bg[0] * sh;
                        G = bg[1] * sh;
                        B = bg[2] * sh;
                    } else {
                        const gx = (at(i + 1, j) - at(i - 1, j)) * L.relief * rad * 0.5;
                        const gy = (at(i, j + 1) - at(i, j - 1)) * L.relief * rad * 0.5;
                        const n = norm3(-gx, -gy, 1);
                        const dk = Math.max(0, n[0] * key[0] + n[1] * key[1] + n[2] * key[2]);
                        const dr = Math.pow(Math.max(0, n[0] * rim[0] + n[1] * rim[1] + n[2] * rim[2]), 2.5);
                        const ndh = Math.max(0, n[0] * KH[0] + n[1] * KH[1] + n[2] * KH[2]);
                        const slope = 1 - n[2];
                        filmHue(fs[c] + slope * 2.2 + ndh * 0.5, fc);
                        filmHue(fs[c] + slope * 2.2 + 0.4, fc2);
                        let alb: Rgb;
                        let spec = 0.75;
                        let shin = 40;
                        let iri = 1;
                        if (m === R_MARGIN) alb = [0.3, 0.06, 0.24];
                        else if (m === R_EYE) {
                            alb = [0.05, 0.015, 0.07];
                            spec = 1;
                            shin = 70;
                        } else if (m === R_METAL) {
                            alb = [0.2, 0.19, 0.23];
                            spec = 0.6;
                            shin = 30;
                            iri = 0;
                        } else if (m === R_CABLE) {
                            alb = [0.07, 0.05, 0.08];
                            spec = 0.3;
                            shin = 14;
                            iri = 0.2;
                        } else if (m === R_LENS) {
                            alb = [0.25, 0.08, 0.4];
                            spec = 1;
                            shin = 90;
                            iri = 0.5;
                        } else alb = [0.06, 0.04, 0.08];
                        const sp = spec * Math.pow(ndh, shin);
                        const fill = Math.max(0, n[0] * -0.3 + n[1] * 0.72 + n[2] * 0.62) * 0.45;
                        const lit = 0.12 + 1.3 * dk + fill;
                        const lobe = 0.3 * Math.pow(ndh, 9) * iri;
                        R = alb[0] * lit + sp * (iri * fc[0] + (1 - iri) * 1.1) + 0.32 * dr * L.rimColour[0] * (0.5 + 0.5 * fc2[0]) + 0.2 * Math.pow(ndh, 5) * fc[0] * iri + lobe * fc[0];
                        G = alb[1] * lit + sp * (iri * fc[1] + (1 - iri) * 1.05) + 0.32 * dr * L.rimColour[1] * (0.5 + 0.5 * fc2[1]) + 0.2 * Math.pow(ndh, 5) * fc[1] * iri + lobe * fc[1];
                        B = alb[2] * lit + sp * (iri * fc[2] + (1 - iri) * 1.15) + 0.32 * dr * L.rimColour[2] * (0.5 + 0.5 * fc2[2]) + 0.2 * Math.pow(ndh, 5) * fc[2] * iri + lobe * fc[2];
                    }
                    // Emission (and the glow spilling around it, also over the background).
                    const e = es[c] * 0.8 + glow[c] * 0.55;
                    if (e > 0) {
                        const v = ehs[c];
                        R += e * (SEAM_P[0] + (SEAM_V[0] - SEAM_P[0]) * v);
                        G += e * (SEAM_P[1] + (SEAM_V[1] - SEAM_P[1]) * v);
                        B += e * (SEAM_P[2] + (SEAM_V[2] - SEAM_P[2]) * v);
                    }
                    ar += R;
                    ag += G;
                    ab += B;
                }
            }
            const k = (y * w + x) * 4;
            const inv = 1 / (ss * ss);
            out[k] = Math.round(Math.min(1, ar * inv) * 255);
            out[k + 1] = Math.round(Math.min(1, ag * inv) * 255);
            out[k + 2] = Math.round(Math.min(1, ab * inv) * 255);
            out[k + 3] = 255;
        }
    }
    return { w, h, data: out };
}

/** Two box-blur passes of a scalar field. */
function blur1(src: Float32Array, W: number, H: number, r: number): Float32Array {
    let a = src;
    for (let pass = 0; pass < 2; pass++) {
        const tmp = new Float32Array(a.length);
        const inv = 1 / (2 * r + 1);
        for (let j = 0; j < H; j++) {
            let acc = 0;
            for (let i = -r; i <= r; i++) acc += i >= 0 && i < W ? a[j * W + i] : 0;
            for (let i = 0; i < W; i++) {
                tmp[j * W + i] = acc * inv;
                if (i + r + 1 < W) acc += a[j * W + i + r + 1];
                if (i - r >= 0) acc -= a[j * W + i - r];
            }
        }
        const out = new Float32Array(a.length);
        for (let i = 0; i < W; i++) {
            let acc = 0;
            for (let j = -r; j <= r; j++) acc += j >= 0 && j < H ? tmp[j * W + i] : 0;
            for (let j = 0; j < H; j++) {
                out[j * W + i] = acc * inv;
                if (j + r + 1 < H) acc += tmp[(j + r + 1) * W + i];
                if (j - r >= 0) acc -= tmp[(j - r) * W + i];
            }
        }
        a = out;
    }
    return a;
}

/**
 * The Concord's portrait: a biomech insect head seen from the front — black iridescent chitin, huge faceted eyes
 * glowing faintly from within, one replaced by a violet lens implant, a bolted frons plate and cheek cables with
 * glowing seams — lit by a cool key from the upper left and a pink rim from the right, on a dark violet ground with a
 * faint honeycomb, a pink glow behind the head and a vignette. Its contrast is held at or above the Ackdarian
 * portrait's (ACKDARIAN_PORTRAIT_STDL).
 */
export function generateConcordPortrait(size = CONCORD_PORTRAIT_SIZE): RgbaImage {
    const img = renderRelief(size, size, size * 0.5, size * 0.53, size * 0.5, headAt, {
        relief: 0.9,
        key: norm3(-0.55, -0.6, 0.6),
        rim: norm3(0.85, 0.1, 0.25),
        rimColour: [1, 0.35, 0.8],
        shadow: 0.45,
        background(nx, ny, gx, gy) {
            const sm = fbm(gx * 5, gy * 5, 151);
            let r = 0.06 + 0.03 * sm;
            let g = 0.025 + 0.012 * sm;
            let b = 0.085 + 0.04 * sm;
            // Faint honeycomb.
            const qx = (gx * 22) / 1.732;
            const qy = (gy * 22) / 1.5;
            const row = Math.round(qy);
            const col = Math.round(qx - (row & 1 ? 0.5 : 0));
            const dx = Math.abs(qx - (col + (row & 1 ? 0.5 : 0))) * 1.732;
            const dy = Math.abs(qy - row) * 1.5;
            const hex = Math.max(dx * 0.866 + dy * 0.5, dy) / 0.866;
            if (hex > 0.86) {
                r += 0.035;
                g += 0.01;
                b += 0.05;
            }
            // Pink glow behind the head.
            const gl = Math.exp(-((nx * nx) / 0.9 + ((ny + 0.1) * (ny + 0.1)) / 0.7));
            r += 0.22 * gl;
            g += 0.04 * gl;
            b += 0.18 * gl;
            const v = 1 - 0.7 * Math.min(1, Math.hypot(gx - 0.5, gy - 0.5) / 0.72) ** 2;
            return [r * v, g * v, b * v];
        },
    });
    const data = img.data;
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

/** The Concord's flag: a deep violet-black field, a pink border, the black iridescent beetle emblem with glowing seams. */
export function generateConcordFlag(w = CONCORD_FLAG_W, h = CONCORD_FLAG_H): RgbaImage {
    const img = renderRelief(w, h, w / 2, h / 2 + h * 0.02, h * 0.45, emblemAt, {
        relief: 0.7,
        key: norm3(-0.5, -0.6, 0.62),
        rim: norm3(0.7, 0.5, 0.3),
        rimColour: [1, 0.4, 0.85],
        shadow: 0.5,
        background(_nx, _ny, gx, gy) {
            const wave = 0.85 + 0.15 * Math.sin(gx * 8 + gy * 3);
            const k = 1 - 0.4 * Math.hypot(gx - 0.5, gy - 0.5);
            return [0.2 * wave * k, 0.05 * wave * k, 0.26 * wave * k];
        },
    });
    const d = img.data;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const e = Math.min(x, y, w - 1 - x, h - 1 - y);
            if (e >= 5) continue;
            const k = (y * w + x) * 4;
            const c: Rgb = e < 1 || e === 4 ? [0.08, 0.02, 0.1] : [0.82, 0.2, 0.55];
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

/** The look chosen by the `concordArtLook` param (0 scarred, 1 pristine). */
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
    const kind = concordKindOf(bo.subRole, treasure.has(bo));
    return { kind, bucket: concordSizeBucket(bo.size), look };
}

/** The ambient nav-light cycle (MainView.cs:1457-1458: 1.5 s on + 1.0 s off) and its per-ship phase (id % 20 / 10). */
// (Read at call time: ambientLayer.ts and this module import each other, so no module-level use of its constants.)
const navCycle = (): number => LIGHT_ON_SECONDS + LIGHT_OFF_SECONDS;
const navPhase = (seconds: number, id: number): number => {
    const c = navCycle();
    return (((seconds + (Math.abs(id) % 20) / 10) % c) + c) % c;
};

/** Period (s) of the seam glow's breathing. */
export const CONCORD_PULSE_SECONDS = 3.6;

/**
 * Overlay alpha of a blink group at `seconds` (wall clock) for ship `id`: steady (lamps, stern / masthead) constant;
 * nav (pink port / violet starboard) steady with a slow pulse on the ambient nav-light cycle; strobe a short double
 * flash at the start of each cycle; engine steady; pulse (the seam glow) a slow breath between 0.25 and 0.75, phase
 * per ship.
 */
export function concordLightAlpha(group: ConcordLightGroup, seconds: number, id: number): number {
    const t = navPhase(seconds, id);
    switch (group) {
        case 'steady':
            return 0.5;
        case 'nav':
            return 0.45 + 0.25 * (0.5 + 0.5 * Math.cos((2 * Math.PI * t) / navCycle()));
        case 'strobe':
            return t < 0.07 || (t > 0.2 && t < 0.27) ? 0.95 : 0;
        case 'engine':
            return 0.6;
        case 'pulse': {
            const ph = (Math.abs(id) % 37) / 37;
            const b = 0.5 - 0.5 * Math.cos(2 * Math.PI * (seconds / CONCORD_PULSE_SECONDS + ph));
            return 0.25 + 0.5 * b * b * (3 - 2 * b);
        }
    }
}

/** Overlays are skipped below this drawn size (px): too small to read, and cheap to skip. */
export const CONCORD_FX_MIN_PX = 12;

// ---------------------------------------------------------------------------------------------------------------
// Textures (DOM / Pixi) — generated once per variant, lazily, at most CONCORD_BUILDS_PER_FRAME per frame
// ---------------------------------------------------------------------------------------------------------------

export interface ConcordShipArt {
    texture: Texture;
    metrics: ShipImageMetrics;
    markers: ShipMarkers;
    halos: Record<ConcordLightGroup, Texture>;
}

export const CONCORD_BUILDS_PER_FRAME = 1;

const shipArtCache = new Map<string, ConcordShipArt>();
let buildFrame = -1;
let buildsThisFrame = 0;

function toCanvasTexture(img: RgbaImage): Texture {
    const t = textureFromRgbaPixels(img.data, img.w, img.h);
    useMinifyingFilter(t);
    return t;
}

/** Ship art of a variant through the same pipeline as stock art: metrics, thruster scan, marks painted out. */
export function buildConcordShipArt(images: ConcordImages): { rgba: Uint8ClampedArray; metrics: ShipImageMetrics; markers: ShipMarkers } | null {
    const { w, h, data } = images.ship;
    const raw = shipImageMetrics(data, w, h);
    if (raw === null) return null;
    // Every kind keeps the drawn extent the earlier Concord art had (both layers read areaRatio: sprite, picking and
    // the ambient exhaust stay consistent).
    const metrics = { ...raw, areaRatio: CONCORD_HULL_AREA_RATIO[images.spec.kind] };
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
    // A kind's first variant also draws its full-resolution source (a few hundred ms, once per kind).
    const images = concordImages(v.kind, v.bucket, v.look);
    const built = buildConcordShipArt(images);
    if (built === null) return null;
    const halos = {} as Record<ConcordLightGroup, Texture>;
    for (const g of CONCORD_LIGHT_GROUPS) halos[g] = toCanvasTexture(images.halos[g]);
    const art: ConcordShipArt = {
        texture: toCanvasTexture({ w: images.ship.w, h: images.ship.h, data: built.rgba }),
        metrics: built.metrics,
        markers: built.markers,
        halos,
    };
    shipArtCache.set(key, art);
    return art;
}

/** Light halos (by blink group) and the seam glow over the Concord's ships (pooled; one container above the ships). */
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
    const { canvas, ctx } = makeTextureCanvas(img.w, img.h);
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

// 19r's ui/empireEmblem.ts registry (companies, exile, ghost, herders) and this module's own race-file override were
// each written without the other in view; registering here — rather than duplicating raceDisplayOverride's logic a
// third time — is what keeps the Concord's insect-mask portrait / flag showing through 19r's unified emblem rendering
// (diplomacyScreen.ts, hud.ts) instead of being silently dropped by the merge.
registerEmblemOverride((galaxy, empire: Empire) => {
    const o = raceDisplayOverride(galaxy, empire.dominantRace?.name);
    return o !== null ? Promise.resolve({ portraitUrl: o.portraitUrl, flagUrl: o.flagUrl }) : null;
});
