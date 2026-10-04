// Ambient (non-combat) Main View effects: engine exhaust behind moving ships,
// blinking navigation lights, mining / gas-mining / construction animations
// and the planetary-shield glow. Render-only: it reads sim state and never
// writes it (the C# renderer flips BuiltObject.LightsOn / LightChanged /
// TargetSpeedChanged / NextSoundTime* and draws Galaxy.Rnd; all of that is
// kept render-side here so the sim stays deterministic).
//
// Sources (DistantWorlds/):
//   Main.Part13.cs:1352-1537 LoadEffects — art: enginethrusters/<i>.png (i = 0.., only 0..5 exist),
//     lights/light.png, mining|gasmining|construction/Frame_NNN.png, other/planetaryshield_0.png.
//   Main.Part12.cs:4712-4800 PrepareEngineExhaust(BuiltObject) — exhaust rects from the image's thruster marks.
//   DistantWorlds.Types/BuiltObjectImageCache.cs:586-613, 739-850 — thruster (pure blue) / light (pure yellow)
//     marker scan on the cropped, 90°-clockwise-rotated full-size image.
//   Controls/MainView.1.cs:856-1133 — XNA ship loop (f < 500): exhaust drawn under the ship while TargetSpeed > 0,
//     lights blink on CurrentDateTime.TimeOfDay (1.5 s on / 1.0 s off, MainView.cs:1457-1458).
//   Main.Part11.cs:45-81 vBqtbUygo3 + Main.Part12.cs:5082-5108 method_111 — light size/colour.
//   Controls/MainView.1.cs:2822-2940 method_92/95/96 — construction / mining / gas-mining animation spawns.
//   AnimationSystem.cs method_1 + Animation.cs — one-shot frame playback.
//   Controls/MainView.2.cs:1955-1978 method_173 — planetary shield glow.
//
// Not drawn because the original's renderer never draws them: effects/beacon (36 frames) and effects/scanners
// (49 frames) are shipped art with no loader in Main.Part13.cs LoadEffects; ships have no idle shield glow (only
// the shieldstrike hit flash, MainView.1.cs:1215-1233, which belongs to the combat effects layer).
// Minimal own animation helper (pooled sprites + frame clock) — no shared fx helper exists on main yet.

import type { BuiltObjectIndex } from './builtObjectIndex';
import { fogOf } from './fog';
import { habitatSystemIndex } from './habitatIndex';
import { habitatDrawnOffsetBound, type MotionInterpolator } from './renderInterp';
import { Container, Sprite, Texture } from 'pixi.js';
import { textureFromRgbaPixels } from './textureCanvas';
import type { Camera } from './camera';
import { AssetStore, useMinifyingFilter } from './assets';
import {
    BUILT_OBJECT_MAX_FACTOR,
    builtObjectImageUrl,
    builtObjectSizePx,
    resolveDrawPictureRef,
    type ShipImageMetrics,
} from './builtObjectLayer';
import { loadShipArt } from './shipArt';
// [concordArt] begin
import { concordArtEmpire, concordArtLook, concordShipArt, concordTreasureShips, concordVariantFor } from './concordArt';
// [concordArt] end
import type { Galaxy } from '../sim/galaxy';
import type { BuiltObject } from '../sim/builtObject';
import { EngineType } from '../sim/builtObject';
import { DesignImageScalingMode } from '../sim/data/designSpecifications';
import { HabitatCategoryType, HabitatType, type Habitat } from '../sim/types';
import type { ConstructionQueue } from '../sim/construction/constructionQueue';

const FX = '/assets/dwu/images/effects';

// Galaxy.3.cs 4984 MovementImpulseSpeed.
const MOVEMENT_IMPULSE_SPEED = 3;
// MainView.cs:1457-1458 double_7 / double_8: lights on for 1.5 s, off for 1.0 s.
export const LIGHT_ON_SECONDS = 1.5;
export const LIGHT_OFF_SECONDS = 1.0;
// MainView.1.cs:2966/2993/3050: every ambient animation plays at 30 fps.
export const AMBIENT_ANIMATION_FPS = 30;
// Frame counts of the install's effect folders (LoadEffects enumerates *.png).
export const MINING_FRAME_COUNT = 120;
export const GAS_MINING_FRAME_COUNT = 90;
export const CONSTRUCTION_FRAME_COUNT = 90;
// MainView.1.cs:2951/2989/3034/2847 NextSoundTime* spacing (star-date ms).
export const CONSTRUCTION_SPAWN_INTERVAL_MS = 4100;
export const MINING_SPAWN_INTERVAL_MS = 3000;
export const GAS_MINING_SPAWN_INTERVAL_MS = 5600;
/** Pure-blue thruster / pure-yellow light marker colours and the scan caps (BuiltObjectImageCache.cs:598-599). */
export const MAX_MARKERS = 20;

// ---------------------------------------------------------------------------
// Pure parts (unit-tested).

/**
 * Port of AnimationSystem.cs method_1 frame selection: step = trunc(trunc(n / fps * 1000) / max(1, n - 1)) ms,
 * frame = trunc(elapsed / step); -1 once the one-shot animation has run past its last frame (it is removed).
 */
export function animationFrameIndex(elapsedMs: number, frameCount: number, fps: number): number {
    if (frameCount <= 0) return -1;
    const step = Math.trunc(Math.trunc((frameCount / fps) * 1000) / Math.max(1, frameCount - 1));
    const index = Math.max(0, Math.trunc(Math.trunc(elapsedMs) / Math.max(1, step)));
    return index >= frameCount ? -1 : index;
}

/**
 * Port of MainView.1.cs:1085-1103: lights are on while (TimeOfDay seconds + (BuiltObjectID % 20) / 10) modulo
 * (1.5 + 1.0) is below 1.5.
 */
export function lightsOn(secondsOfDay: number, builtObjectID: number): boolean {
    const t = secondsOfDay + (builtObjectID % 20) / 10.0;
    return t % (LIGHT_ON_SECONDS + LIGHT_OFF_SECONDS) < LIGHT_ON_SECONDS;
}

/**
 * Port of PrepareEngineExhaust's num4 (Main.Part12.cs:4745-4759): exhaust length multiplier by target speed —
 * 1 up to impulse speed, 1.7 up to cruise, 2.5 up to top speed, 0 otherwise (and when stopped).
 */
export function exhaustSpeedFactor(targetSpeed: number, cruiseSpeed: number, topSpeed: number): number {
    if (targetSpeed <= 0) return 0;
    if (targetSpeed <= MOVEMENT_IMPULSE_SPEED) return 1;
    if (targetSpeed <= cruiseSpeed) return 1.7;
    if (targetSpeed <= topSpeed) return 2.5;
    return 0;
}

/** PrepareEngineExhaust num5: exhaust length in prepared-image px (num3 = 0.15 × width), rounded up to even. */
export function exhaustLengthPx(preparedPx: number, speedFactor: number): number {
    let num5 = Math.trunc(speedFactor * (preparedPx * 0.15));
    if (num5 % 2 === 1) num5 += 1;
    return num5;
}

/** Engine thruster art index per EngineType (Main.Part12.cs:4718-4738); -1 = none drawn. */
export function engineExhaustIndex(engineType: EngineType): number {
    switch (engineType) {
        case EngineType.Proton:
            return 0;
        case EngineType.Quantum:
            return 1;
        case EngineType.Acceleros:
            return 2;
        case EngineType.Vortex:
            return 3;
        case EngineType.StarBurner:
            return 4;
        case EngineType.TurboThruster:
            return 5;
        default:
            return -1;
    }
}

/** A thruster mark: a vertical run of pure-blue pixels (width 0) in the rotated crop image. */
export interface ThrusterMark {
    left: number;
    top: number;
    height: number;
}

/** Marker scan result in rotated-crop pixel coordinates (side × side, ship facing +x). */
export interface ShipMarkers {
    side: number;
    thrusters: ThrusterMark[];
    lights: { x: number; y: number }[];
    /** Smallest thruster Left (image width when there are none), PrepareEngineExhaust `left`. */
    minThrusterLeft: number;
}

/**
 * Port of BuiltObjectImageCache ScanForThrusterLocations + ScanForColorPoints over the image that
 * LoadSingleBuiltObjectImage builds: CropImageContent (square crop from shipImageMetrics), then
 * RotateFlip(Rotate90FlipNone). Rotated pixel (x', y') is crop pixel (y', side - 1 - x'). The crop is a
 * Format32bppPArgb bitmap read through FastBitmap's LockBits(Format32bppArgb), which un-premultiplies: a pure blue
 * (0,0,255) / pure yellow (255,255,0) pixel of any alpha > 0 round-trips exactly, and the C# compares RGB only, so
 * every non-transparent pure-colour pixel matches (alpha 0 reads back as 0,0,0).
 * Thrusters: columns outer, vertical runs; lights: rows outer. Each list stops at 20.
 */
export function scanShipMarkers(rgba: ArrayLike<number>, w: number, h: number, m: ShipImageMetrics): ShipMarkers {
    const side = m.cropSide;
    const left = Math.round(m.cropCenterX - side / 2);
    const top = Math.round(m.cropCenterY - side / 2);
    // Returns 1 = blue, 2 = yellow, 0 = other for rotated pixel (x', y').
    const kind = (xr: number, yr: number): number => {
        const x = left + yr;
        const y = top + (side - 1 - xr);
        if (x < 0 || y < 0 || x >= w || y >= h) return 0;
        const i = (y * w + x) * 4;
        if (rgba[i + 3] === 0) return 0;
        const r = rgba[i];
        const g = rgba[i + 1];
        const b = rgba[i + 2];
        if (r === 0 && g === 0 && b === 255) return 1;
        if (r === 255 && g === 255 && b === 0) return 2;
        return 0;
    };
    const thrusters: ThrusterMark[] = [];
    scan: for (let i = 0; i < side; i++) {
        for (let j = 0; j < side; j++) {
            if (kind(i, j) !== 1) continue;
            const start = j;
            let end = j;
            if (j < side - 1) {
                j++;
                end = side - 1;
                for (; j < side; j++) {
                    if (kind(i, j) !== 1) {
                        end = j - 1;
                        break;
                    }
                }
            }
            thrusters.push({ left: i, top: start, height: end - start + 1 });
            if (thrusters.length >= MAX_MARKERS) break scan;
        }
    }
    const lights: { x: number; y: number }[] = [];
    scanL: for (let y = 0; y < side; y++) {
        for (let x = 0; x < side; x++) {
            if (kind(x, y) === 2) {
                lights.push({ x, y });
                if (lights.length >= MAX_MARKERS) break scanL;
            }
        }
    }
    let minLeft = Infinity;
    for (const t of thrusters) if (t.left < minLeft) minLeft = t.left;
    return { side, thrusters, lights, minThrusterLeft: minLeft };
}

/** Output of exhaustRect: centre offset from the ship centre and size, in prepared-image px of the rotated frame. */
export interface ExhaustRect {
    cx: number;
    cy: number;
    width: number;
    height: number;
}

/**
 * Port of PrepareEngineExhaust's per-thruster destRect (Main.Part12.cs:4760-4796) plus the MainView.1.cs:1113-1121
 * placement (the exhaust bitmap is drawn centred on the ship): writes into `out` the exhaust rect's centre
 * relative to the ship centre and its size, in prepared-image px (P1 = ship size at zoom 1) of the rotated frame
 * (ship facing +x, exhaust trailing towards -x).
 */
export function exhaustRect(
    t: ThrusterMark,
    minThrusterLeft: number,
    side: number,
    preparedPx: number,
    num5: number,
    out: ExhaustRect,
): ExhaustRect {
    const num = preparedPx / side;
    // `left` starts at shipImage.Width and takes the smaller thruster Left (crop px, unscaled).
    const left = Math.min(preparedPx, minThrusterLeft);
    const num8 = num5 - left * num;
    const compositeW = Math.trunc(Math.max(2, preparedPx + num8 * 2 + 2));
    const x0 = t.left * num - num5 + num8 + 3;
    const num11 = t.height * num;
    const num12 = (num11 * 1.8) / 2;
    const num13 = num11 + num12 * 2;
    const y0 = t.top * num + num8 - num12;
    out.cx = x0 + num5 / 2 - compositeW / 2;
    out.cy = y0 + num13 / 2 - compositeW / 2;
    out.width = num5;
    out.height = num13;
    return out;
}

/** vBqtbUygo3 light size in prepared-image px: max(1, light.png width / 2 / sqrt(f)), rounded. */
export function lightSizePx(lightTexWidth: number, f: number): number {
    const v = Math.max(1, lightTexWidth / 2.0 / Math.sqrt(f));
    return Math.trunc(v + 0.5);
}

// .NET ControlPaint.Light(Color) = HLSColor(c).Lighter(0.5): HLS on a 0..240 scale.
const HLS_MAX = 240;
const RGB_MAX = 255;
const HLS_UNDEFINED = (HLS_MAX * 2) / 3;
function hueToRgb(n1: number, n2: number, hue: number): number {
    if (hue < 0) hue += HLS_MAX;
    if (hue > HLS_MAX) hue -= HLS_MAX;
    if (hue < HLS_MAX / 6) return n1 + Math.trunc(((n2 - n1) * hue + HLS_MAX / 12) / (HLS_MAX / 6));
    if (hue < HLS_MAX / 2) return n2;
    if (hue < (HLS_MAX * 2) / 3) return n1 + Math.trunc(((n2 - n1) * ((HLS_MAX * 2) / 3 - hue) + HLS_MAX / 12) / (HLS_MAX / 6));
    return n1;
}

/** Port of System.Windows.Forms.ControlPaint.Light(Color) (HLSColor.Lighter(0.5)) on 0xRRGGBB. */
export function controlPaintLight(rgb: number): number {
    const r = (rgb >> 16) & 0xff;
    const g = (rgb >> 8) & 0xff;
    const b = rgb & 0xff;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sum = max + min;
    const lum = Math.trunc((sum * HLS_MAX + RGB_MAX) / (2 * RGB_MAX));
    const dif = max - min;
    let hue: number;
    let sat: number;
    if (dif === 0) {
        sat = 0;
        hue = HLS_UNDEFINED;
    } else {
        sat = lum <= HLS_MAX / 2
            ? Math.trunc((dif * HLS_MAX + Math.trunc(sum / 2)) / sum)
            : Math.trunc((dif * HLS_MAX + Math.trunc((2 * RGB_MAX - sum) / 2)) / (2 * RGB_MAX - sum));
        const rd = Math.trunc(((max - r) * (HLS_MAX / 6) + Math.trunc(dif / 2)) / dif);
        const gd = Math.trunc(((max - g) * (HLS_MAX / 6) + Math.trunc(dif / 2)) / dif);
        const bd = Math.trunc(((max - b) * (HLS_MAX / 6) + Math.trunc(dif / 2)) / dif);
        if (r === max) hue = bd - gd;
        else if (g === max) hue = HLS_MAX / 3 + rd - bd;
        else hue = (2 * HLS_MAX) / 3 + gd - rd;
        if (hue < 0) hue += HLS_MAX;
        if (hue > HLS_MAX) hue -= HLS_MAX;
    }
    // Lighter(0.5): NewLuma(500, scale) = (lum * 500 + 241 * 500) / 1000.
    const oneLum = Math.trunc((lum * (1000 - 500) + (HLS_MAX + 1) * 500) / 1000);
    const l = lum + Math.trunc((oneLum - lum) * 0.5);
    if (sat === 0) {
        const v = Math.trunc((l * RGB_MAX) / HLS_MAX) & 0xff;
        return (v << 16) | (v << 8) | v;
    }
    const magic2 = l <= HLS_MAX / 2
        ? Math.trunc((l * (HLS_MAX + sat) + HLS_MAX / 2) / HLS_MAX)
        : l + sat - Math.trunc((l * sat + HLS_MAX / 2) / HLS_MAX);
    const magic1 = 2 * l - magic2;
    const ch = (hh: number) => Math.trunc((hueToRgb(magic1, magic2, hh) * RGB_MAX + HLS_MAX / 2) / HLS_MAX) & 0xff;
    return (ch(hue + HLS_MAX / 3) << 16) | (ch(hue) << 8) | ch(hue - HLS_MAX / 3);
}

/** Main.Part12.cs:5082-5108 method_111 light colour: red for independents/pirates/no empire, else Light(MainColor). */
export function lightColour(bo: BuiltObject, galaxy: Galaxy): number {
    const e = bo.empire;
    if (e !== null && e !== galaxy.independentEmpire && e.pirateEmpireBaseHabitat === null) {
        return controlPaintLight(e.mainColor);
    }
    return 0xff0000;
}

/** MainView.1.cs:3027-3037 gas-mining tint by the parent habitat's most abundant gas (0xffffff = none). */
export function gasMiningTint(resourceName: string | null): number {
    switch (resourceName) {
        case null:
            return 0xffffff;
        case 'Argon':
            return 0xffff00;
        case 'Caslon':
            return 0x0000ff;
        case 'Helium':
            return 0xcc0033;
        case 'Hydrogen':
            return 0xa00000;
        case 'Krypton':
            return 0x00ff00;
        case 'Tyderios':
            return 0xff00ff;
        default:
            return 0xcc0033;
    }
}

/** Planetary-shield alpha (MainView.2.cs:1959-1968 method_173) from the real clock's second + millisecond. */
export function planetaryShieldAlpha(second: number, millisecond: number): number {
    let num2 = millisecond;
    if (second % 2 === 1) num2 += 1000;
    const num = num2 <= 1000 ? Math.abs(1000 - num2) / 1000.0 : (num2 - 1000) / 1000.0;
    return 0.6 + num * 0.2;
}

/**
 * LOD gate: every ambient effect belongs to the ship/habitat draw loops, which run only while the zoom factor
 * f < 500 (MainView.1.cs:856, habitats drawn at the same levels); an animation's drawn size is
 * trunc(worldSize / f) px (MainView.cs:2186-2195 method_35), so it vanishes once that reaches 0.
 */
export function ambientVisibleAt(f: number): boolean {
    return f < BUILT_OBJECT_MAX_FACTOR;
}

export function animationSizePx(worldSize: number, f: number): number {
    return Math.max(0, Math.trunc(worldSize / f));
}

// ---------------------------------------------------------------------------
// Renderer.

interface ShipArt {
    metrics: ShipImageMetrics;
    markers: ShipMarkers;
}

interface FrameSet {
    urls: string[];
    textures: Texture[] | null;
    loading: boolean;
}

interface ActiveAnimation {
    frames: FrameSet;
    startMs: number;
    x: number;
    y: number;
    size: number;
    rotation: number;
    tint: number;
    sprite: Sprite;
}

interface SpawnTimes {
    construction: number;
    mining: number;
    gasMining: number;
}

function frameUrls(folder: string, count: number): string[] {
    const out: string[] = [];
    for (let i = 1; i <= count; i++) out.push(`${FX}/${folder}/Frame_${String(i).padStart(3, '0')}.png`);
    return out;
}

/** Render-local random (the C# draws Galaxy.Rnd, which would perturb the deterministic sim). */
class RenderRandom {
    private s = 0x2545f491;
    next(): number {
        let x = this.s;
        x ^= x << 13;
        x ^= x >>> 17;
        x ^= x << 5;
        this.s = x >>> 0;
        return this.s / 4294967296;
    }
}

const scratchRect: ExhaustRect = { cx: 0, cy: 0, width: 0, height: 0 };

export class AmbientLayer {
    /** Drawn under the ships (engine exhaust, planetary shields). */
    readonly under = new Container();
    /** Drawn over the ships (lights, mining / construction animations). */
    readonly over = new Container();
    private shipArt = new Map<string, ShipArt | null>();
    private shipArtLoading = new Set<string>();
    private engineTextures: (Texture | null)[] = [null, null, null, null, null, null];
    private lightTexture: Texture | null = null;
    private shieldTexture: Texture | null = null;
    private exhaustPool: Sprite[] = [];
    private lightPool: Sprite[] = [];
    private shieldPool: Sprite[] = [];
    /** Render interpolation between sim steps (renderInterp.ts; set by MainView): exhaust / lights follow the drawn
     * ship and shields the drawn planet. Null: the sim positions. */
    motion: MotionInterpolator | null = null;
    private animPool: ActiveAnimation[] = [];
    private animCount = 0;
    private spawnTimes = new Map<BuiltObject | Habitat, SpawnTimes>();
    private rnd = new RenderRandom();
    private mining: FrameSet = { urls: frameUrls('mining', MINING_FRAME_COUNT), textures: null, loading: false };
    private gasMining: FrameSet = { urls: frameUrls('gasmining', GAS_MINING_FRAME_COUNT), textures: null, loading: false };
    private construction: FrameSet = { urls: frameUrls('construction', CONSTRUCTION_FRAME_COUNT), textures: null, loading: false };
    private shieldHabitats: Habitat[] | null = null;
    private nearHabitats: Habitat[] = [];
    private systemScratch: number[] = [];
    /** Render-side index of the live built objects (set by MainView). Null: galaxy.builtObjects. */
    index: BuiltObjectIndex | null = null;
    private nearScratch: BuiltObject[] = [];
    /** 19i item 7 hook: alpha multiplier for nav lights / shield glow at a world point (null = 1, the default). */
    lightScale: ((x: number, y: number) => number) | null = null;
    private pruneCounter = 0;

    constructor(
        private galaxy: Galaxy,
        world: Container,
        shipRoot: Container,
        private store: AssetStore,
        private habitatPx: (h: Habitat, z: number) => number,
    ) {
        const idx = world.children.indexOf(shipRoot);
        world.addChildAt(this.under, idx >= 0 ? idx : world.children.length);
        world.addChild(this.over);
        if (store.dwuPresent) this.loadStaticArt();
    }

    private loadStaticArt(): void {
        for (let i = 0; i < 6; i++) {
            void this.store.loadFirst([`${FX}/enginethrusters/${i}.png`], () => Texture.EMPTY).then((t) => {
                this.engineTextures[i] = t === Texture.EMPTY ? null : t;
            });
        }
        void this.store.loadFirst([`${FX}/other/planetaryshield_0.png`], () => Texture.EMPTY).then((t) => {
            this.shieldTexture = t === Texture.EMPTY ? null : t;
        });
        // method_221 colour matrix: RGB replaced by the light colour, alpha kept — a white silhouette tinted per empire.
        void loadRgba(`${FX}/lights/light.png`).then(
            ({ data, w, h }) => {
                const px = new Uint8ClampedArray(w * h * 4);
                for (let i = 0; i < px.length; i += 4) {
                    px[i] = 255;
                    px[i + 1] = 255;
                    px[i + 2] = 255;
                    px[i + 3] = data[i + 3];
                }
                const tex = textureFromRgbaPixels(px, w, h);
                useMinifyingFilter(tex);
                this.lightTexture = tex;
            },
            () => undefined,
        );
    }

    private ensureFrames(set: FrameSet): boolean {
        if (set.textures !== null) return true;
        if (!set.loading && this.store.dwuPresent) {
            set.loading = true;
            void Promise.all(set.urls.map((u) => this.store.loadFirst([u], () => Texture.EMPTY))).then((ts) => {
                set.textures = ts;
            });
        }
        return false;
    }

    private artFor(url: string): ShipArt | null {
        const art = this.shipArt.get(url);
        if (art !== undefined) return art;
        if (!this.shipArtLoading.has(url) && this.store.dwuPresent) {
            this.shipArtLoading.add(url);
            // The shared ship-art cache (shipArt.ts): the markers are scanned from the raw pixels, before the ship
            // layer's texture has them painted out.
            loadShipArt(url).then(
                (art) => this.shipArt.set(url, art === null ? null : { metrics: art.metrics, markers: art.markers }),
                () => this.shipArt.set(url, null),
            );
        }
        return null;
    }

    update(z: number, cam: Camera): void {
        const f = 1 / z;
        const visible = ambientVisibleAt(f) && this.store.dwuPresent;
        this.under.visible = visible;
        this.over.visible = visible;
        let exhaustUsed = 0;
        let lightUsed = 0;
        let shieldUsed = 0;
        const nowMs = Date.now();
        if (visible) {
            const starDate = this.galaxy.nowMs;
            const secondsOfDay = (nowMs / 1000) % 86400;
            const halfW = cam.width / 2;
            const halfH = cam.height / 2;
            const lightTex = this.lightTexture;
            const lightPx = lightTex !== null ? lightSizePx(lightTex.width, f) : 0;
            // [concordArt] begin — the Concord's junks: their own thruster marks, no nav lights (lanterns instead).
            const concord = concordArtEmpire(this.galaxy);
            const treasure = concord !== null ? concordTreasureShips(this.galaxy) : null;
            const look = concord !== null ? concordArtLook(this.galaxy) : 'weathered';
            // [concordArt] end
            const fog = fogOf(this.galaxy);
            // Perf: with the index, only the objects inside the 100 px cull below (same order).
            const list: readonly (BuiltObject | null)[] =
                this.index !== null ? this.index.near(cam.x, cam.y, halfW / z, halfH / z, 101 / z, false, this.nearScratch) : this.galaxy.builtObjects;
            for (const bo of list) {
                if (bo === null || bo.hasBeenDestroyed) continue;
                const sx = (bo.xpos - cam.x) * z + halfW;
                const sy = (bo.ypos - cam.y) * z + halfH;
                // Same 100 px cull as BuiltObjectLayer (the C# uses -50 around the drawn rect).
                if (sx < -100 || sx > cam.width + 100 || sy < -100 || sy > cam.height + 100) continue;
                if (!fog.builtObject(bo)) continue; // fog.ts: exhaust, lights and shields belong to the ship's draw block
                // [concordArt] begin
                const cv = treasure !== null ? concordVariantFor(bo, concord, treasure, look) : null;
                let art: ShipArt | null;
                if (cv !== null) {
                    art = concordShipArt(cv, 0, false);
                } else {
                    const url = builtObjectImageUrl(resolveDrawPictureRef(bo));
                    if (url === null) continue;
                    art = this.artFor(url);
                }
                // [concordArt] end
                if (art === null) continue;
                const scalingType = bo.design?.imageScalingType ?? DesignImageScalingMode.None;
                const scalingFactor = bo.design?.imageScalingFactor ?? 1;
                const pf = builtObjectSizePx(bo.size, art.metrics.areaRatio, f, scalingType, scalingFactor);
                if (pf < 1) continue;
                const p1 = builtObjectSizePx(bo.size, art.metrics.areaRatio, 1, scalingType, scalingFactor);
                if (p1 < 1) continue;
                const k = pf / p1 / z; // world units per prepared-image px
                // Where BuiltObjectLayer drew the ship this frame (render-interpolated), else its sim position.
                const drawn = this.motion !== null ? this.motion.drawn(bo) : null;
                const bx = drawn !== null ? drawn.x : bo.xpos;
                const by = drawn !== null ? drawn.y : bo.ypos;
                const heading = drawn !== null ? drawn.heading : bo.heading;
                const cos = Math.cos(heading);
                const sin = Math.sin(heading);
                const mk = art.markers;

                // Engine exhaust (MainView.1.cs:1113-1121: only while TargetSpeed > 0, under the ship).
                if (bo.targetSpeed > 0 && mk.thrusters.length > 0) {
                    const ei = engineExhaustIndex(bo.engineType);
                    const tex = ei >= 0 ? this.engineTextures[ei] : null;
                    const num5 = exhaustLengthPx(p1, exhaustSpeedFactor(bo.targetSpeed, bo.cruiseSpeed, bo.topSpeed));
                    if (tex !== null && num5 > 0) {
                        for (const t of mk.thrusters) {
                            const r = exhaustRect(t, mk.minThrusterLeft, mk.side, p1, num5, scratchRect);
                            const s = this.pooled(this.exhaustPool, this.under, exhaustUsed++);
                            s.texture = tex;
                            s.position.set(bx + (r.cx * cos - r.cy * sin) * k, by + (r.cx * sin + r.cy * cos) * k);
                            // Raw art: the C# pre-rotates it 90° clockwise, so raw width spans the rect height.
                            s.rotation = heading + Math.PI / 2;
                            s.scale.set((r.height * k) / tex.width, (r.width * k) / tex.height);
                            s.tint = 0xffffff;
                            s.alpha = 1;
                        }
                    }
                }

                // Navigation lights (MainView.cs:3245-3284 method_73: only when BuiltAt == null and Empire != null).
                if (lightTex !== null && bo.builtAt === null && bo.empire !== null && mk.lights.length > 0 && lightsOn(secondsOfDay, bo.builtObjectID)) {
                    const colour = lightColour(bo, this.galaxy);
                    const num2 = p1 / mk.side;
                    // Drawn light px: L scaled by the inflated destination (MainView.1.cs:1111-1115).
                    const sizeWorld = (lightPx * (pf + lightPx)) / (p1 + lightPx) / z;
                    for (const lp of mk.lights) {
                        const u = lp.x * num2 - p1 / 2;
                        const v = lp.y * num2 - p1 / 2;
                        const s = this.pooled(this.lightPool, this.over, lightUsed++);
                        s.texture = lightTex;
                        s.position.set(bx + (u * cos - v * sin) * k, by + (u * sin + v * cos) * k);
                        s.rotation = 0;
                        s.scale.set(sizeWorld / lightTex.width);
                        s.tint = colour;
                        s.alpha = this.lightScale === null ? 1 : this.lightScale(bx, by);
                    }
                }

                this.spawnForBuiltObject(bo, starDate, nowMs);
            }
            shieldUsed = this.updateHabitats(z, f, cam, starDate, nowMs);
        }
        hideFrom(this.exhaustPool, exhaustUsed);
        hideFrom(this.lightPool, lightUsed);
        hideFrom(this.shieldPool, shieldUsed);
        this.updateAnimations(nowMs, f, z);
        if (++this.pruneCounter >= 600) {
            this.pruneCounter = 0;
            for (const key of this.spawnTimes.keys()) if (key.hasBeenDestroyed) this.spawnTimes.delete(key);
        }
    }

    private timesFor(key: BuiltObject | Habitat): SpawnTimes {
        let t = this.spawnTimes.get(key);
        if (t === undefined) {
            t = { construction: 0, mining: 0, gasMining: 0 };
            this.spawnTimes.set(key, t);
        }
        return t;
    }

    // Port of MainView.1.cs:2942-3060 method_95 (animations only; the sounds belong to the audio layer).
    private spawnForBuiltObject(bo: BuiltObject, starDate: number, nowMs: number): void {
        if (!bo.doingConstruction && !bo.doingMining && !bo.doingGasMining) return;
        const times = this.timesFor(bo);
        if (bo.doingConstruction && starDate > times.construction && this.ensureFrames(this.construction)) {
            times.construction = starDate + CONSTRUCTION_SPAWN_INTERVAL_MS;
            const val = Math.min(100, Math.trunc(Math.sqrt(bo.size * 15)));
            this.spawnAround(this.construction, bo.xpos, bo.ypos, val, 1.0, 0xffffff, nowMs);
        }
        if (bo.doingMining && starDate > times.mining && this.ensureFrames(this.mining)) {
            times.mining = starDate + MINING_SPAWN_INTERVAL_MS;
            const ph = bo.parentHabitat;
            if (ph !== null && (ph.category === HabitatCategoryType.Asteroid || ph.type === HabitatType.BarrenRock || ph.type === HabitatType.Volcanic)) {
                const val = Math.min(60, Math.trunc(Math.sqrt(bo.size * 15)));
                this.spawnAround(this.mining, bo.xpos, bo.ypos, val, 0.8, 0xffffff, nowMs);
            }
        }
        if (bo.doingGasMining && starDate > times.gasMining && this.ensureFrames(this.gasMining)) {
            times.gasMining = starDate + GAS_MINING_SPAWN_INTERVAL_MS;
            const val = Math.min(80, Math.trunc(Math.sqrt(bo.size * 15)));
            this.spawnAround(this.gasMining, bo.xpos, bo.ypos, val, 0.7, gasMiningTint(this.dominantGasName(bo.parentHabitat)), nowMs);
        }
    }

    /** Name of the parent habitat's most abundant Gas-group resource (first wins ties), or null. */
    private dominantGasName(h: Habitat | null): string | null {
        if (h === null || h.resources.length === 0) return null;
        let best: string | null = null;
        let bestAbundance = 0;
        const byId = this.galaxy.resourceSystem.byId;
        for (const r of h.resources) {
            const def = byId.get(r.resourceId);
            // resources.txt type 1 = Gas (ResourceGroup.Gas - 1).
            if (def !== undefined && def.type === 1 && r.abundance > bestAbundance) {
                bestAbundance = r.abundance;
                best = def.name;
            }
        }
        return best;
    }

    /** method_96: offset by (trunc(val * spread) / 2) at a random angle, which is also the animation's rotation. */
    private spawnAround(set: FrameSet, x: number, y: number, val: number, spread: number, tint: number, nowMs: number): void {
        const angle = this.rnd.next() * Math.PI * 2.0;
        const r = Math.trunc(val * spread) / 2.0;
        this.spawn(set, x + Math.cos(angle) * r, y + Math.sin(angle) * r, val, angle, tint, nowMs);
    }

    private spawn(set: FrameSet, x: number, y: number, size: number, rotation: number, tint: number, nowMs: number): void {
        let a = this.animPool[this.animCount];
        if (a === undefined) {
            const sprite = new Sprite(Texture.EMPTY);
            sprite.anchor.set(0.5);
            this.over.addChild(sprite);
            a = { frames: set, startMs: 0, x: 0, y: 0, size: 0, rotation: 0, tint: 0xffffff, sprite };
            this.animPool.push(a);
        }
        a.frames = set;
        a.startMs = nowMs;
        a.x = x;
        a.y = y;
        a.size = size;
        a.rotation = rotation;
        a.tint = tint;
        this.animCount++;
    }

    // AnimationSystem.DoAnimationsXna: draw each live animation's current frame; drop finished ones.
    private updateAnimations(nowMs: number, f: number, z: number): void {
        let i = 0;
        while (i < this.animCount) {
            const a = this.animPool[i];
            const textures = a.frames.textures!;
            const idx = animationFrameIndex(nowMs - a.startMs, textures.length, AMBIENT_ANIMATION_FPS);
            if (idx < 0) {
                // Swap-remove: move the last live record into this slot.
                const last = this.animCount - 1;
                this.animPool[i] = this.animPool[last];
                this.animPool[last] = a;
                a.sprite.visible = false;
                this.animCount--;
                continue;
            }
            const px = animationSizePx(a.size, f);
            const tex = textures[idx];
            const s = a.sprite;
            if (px < 1 || !this.over.visible || tex === Texture.EMPTY) {
                s.visible = false;
            } else {
                s.texture = tex;
                s.position.set(a.x, a.y);
                s.rotation = -a.rotation;
                s.scale.set(px / z / tex.width, px / z / tex.height);
                s.tint = a.tint;
                s.visible = true;
            }
            i++;
        }
    }

    // Habitat effects: method_92 construction sparks and method_173 planetary shield (MainView.1.cs:831/842).
    private updateHabitats(z: number, f: number, cam: Camera, starDate: number, nowMs: number): number {
        if (this.shieldHabitats === null) {
            this.shieldHabitats = this.galaxy.habitats.filter(
                (h) => h.category === HabitatCategoryType.Planet || h.category === HabitatCategoryType.Moon,
            );
        }
        // DateTime.Second / Millisecond of the real UTC clock (Galaxy.CurrentDateTime tracks real time).
        const shieldAlpha = planetaryShieldAlpha(Math.floor(nowMs / 1000) % 60, nowMs % 1000);
        const shieldTex = this.shieldTexture;
        let used = 0;
        const halfW = cam.width / 2;
        const halfH = cam.height / 2;
        const clamp = this.motion !== null ? this.motion.clampSeconds : 0;
        // Perf: only planets and moons of systems near the view (habitatIndex.ts; same order as shieldHabitats). A body's
        // drawn sprite is at most 1.25 diameters (planetZoomFactor / moonZoomFactor >= f / 1.25) or 4 px across, and
        // the cull below keeps px / 2 + 100 px around it.
        const hix = habitatSystemIndex(this.galaxy);
        let list: readonly Habitat[] = this.shieldHabitats;
        if (hix.ordered) {
            const near = this.nearHabitats;
            near.length = 0;
            const systems = hix.visible(cam.x, cam.y, halfW / z, halfH / z, 1, 110 / z, this.systemScratch);
            for (let si = 0; si < systems.length; si++) {
                const habs = hix.bySystem[systems[si]];
                for (let hi = 0; hi < habs.length; hi++) {
                    const h = habs[hi];
                    if (h.category === HabitatCategoryType.Planet || h.category === HabitatCategoryType.Moon) near.push(h);
                }
            }
            list = near;
        }
        for (const h of list) {
            if (h.hasBeenDestroyed) continue;
            // Perf (13k planets and moons in a late 2500-star game): cull on the committed position widened by the
            // most the drawn orbit position can differ from it (renderInterp.ts habitatDrawnOffsetBound) before
            // computing the drawn position; the exact test below is unchanged.
            {
                const px0 = this.habitatPx(h, z);
                const reach0 = px0 / 2 + 100 + (this.motion !== null ? habitatDrawnOffsetBound(h, clamp) * z : 0) + 1;
                const sx0 = (h.xpos - cam.x) * z + halfW;
                const sy0 = (h.ypos - cam.y) * z + halfH;
                if (sx0 < -reach0 || sx0 > cam.width + reach0 || sy0 < -reach0 || sy0 > cam.height + reach0) continue;
            }
            // The planet's drawn (render-interpolated orbit) position, else its committed one.
            let hx = h.xpos;
            let hy = h.ypos;
            if (this.motion !== null) {
                const hp = this.motion.habitatPos(h);
                hx = hp.x;
                hy = hp.y;
            }
            const sx = (hx - cam.x) * z + halfW;
            const sy = (hy - cam.y) * z + halfH;
            const px = this.habitatPx(h, z);
            const reach = px / 2 + 100;
            if (sx < -reach || sx > cam.width + reach || sy < -reach || sy > cam.height + reach) continue;
            if (!fogOf(this.galaxy).habitatDrawn(h)) continue; // fog.ts: a body of an unexplored system is not drawn
            if (shieldTex !== null && h.planetaryShieldPresent) {
                const n4 = Math.trunc(26.0 / f);
                const sizePx = px + n4 * 2;
                const s = this.pooled(this.shieldPool, this.under, used++);
                s.texture = shieldTex;
                s.position.set(hx, hy);
                s.rotation = 0;
                s.scale.set(sizePx / z / shieldTex.width, sizePx / z / shieldTex.height);
                s.tint = 0xffffff;
                s.alpha = this.lightScale === null ? shieldAlpha : shieldAlpha * this.lightScale(hx, hy);
            }
            this.spawnForHabitat(h, starDate, nowMs);
        }
        return used;
    }

    // Port of MainView.1.cs:2841-2877 method_92 (planet/moon yards with a ship under construction).
    // TODO(port): Empire.IsObjectVisibleToThisEmpire(habitat) gate (MainView.1.cs:2841) — not in sim; all yards animate
    private spawnForHabitat(h: Habitat, starDate: number, nowMs: number): void {
        const queue = h.constructionQueue as ConstructionQueue | null;
        const yards = queue?.constructionYards ?? null;
        if (yards === null || yards.length === 0) return;
        let under = 0;
        for (const y of yards) if (y.shipUnderConstruction !== null) under++;
        if (under <= 0) return;
        const times = this.timesFor(h);
        if (!(starDate > times.construction) || !this.ensureFrames(this.construction)) return;
        times.construction = starDate + CONSTRUCTION_SPAWN_INTERVAL_MS;
        let val = Math.trunc(Math.sqrt(h.diameter * 10));
        const ship = yards[0].shipUnderConstruction;
        let ox = 0;
        let oy = 0;
        if (ship !== null) {
            val = Math.trunc(Math.sqrt(ship.size * 15));
            if ((ship.parentBuiltObject !== null || ship.parentHabitat !== null) && ship.parentOffsetX > -2000000001.0 && ship.parentOffsetY > -2000000001.0) {
                ox = ship.parentOffsetX;
                oy = ship.parentOffsetY;
            }
        }
        val = Math.min(100, val);
        this.spawnAround(this.construction, h.xpos + ox, h.ypos + oy, val, 0.5, 0xffffff, nowMs);
    }

    private pooled(pool: Sprite[], parent: Container, i: number): Sprite {
        let s = pool[i];
        if (s === undefined) {
            s = new Sprite(Texture.EMPTY);
            s.anchor.set(0.5);
            parent.addChild(s);
            pool.push(s);
        }
        s.visible = true;
        return s;
    }
}

function hideFrom(pool: Sprite[], used: number): void {
    for (let i = used; i < pool.length; i++) {
        if (!pool[i].visible) break;
        pool[i].visible = false;
    }
}

/** Fetch an image and read its RGBA pixels through a canvas (same pattern as measureShipImage). */
async function loadRgba(url: string): Promise<{ data: Uint8ClampedArray; w: number; h: number }> {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error(`image load failed: ${url}`));
        el.src = url;
    });
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) throw new Error(`zero-size image: ${url}`);
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    // Read back once: a software canvas (no GPU surface).
    const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
    ctx.drawImage(img, 0, 0);
    return { data: ctx.getImageData(0, 0, w, h).data, w, h };
}
