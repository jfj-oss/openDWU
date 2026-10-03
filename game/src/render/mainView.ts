// Main View: one seamless continuous zoom from full galaxy to a single
// planet and back. Port of the original's MainView renderer
// (Controls/MainView.1.cs: PrepareGalaxyBackdrop ~line 3926,
// FadeGalaxyNebulae/FadeSectorBackground/FadeGalaxyBackground ~4111-4152;
// Main.Part11.cs zoom thresholds ~460-510, e.g. actualZoomFactor > 3.0 /
// > 10.0; Main.Part13.cs LoadMapStars ~line 993).
//
// The original expresses zoom as `actualZoomFactor` (1.0 = 100%, larger =
// more zoomed out); here `Camera.zoom` is its reciprocal (pixels per world
// unit). Layer crossfade windows below are expressed in that zoom.
//
// TODO(port): nebula-anchored gas-cloud placement / radiation fields —
// Galaxy.4.cs GenerateGasCloud.

import { fogOf } from './fog';
import { AttachedChildren } from './renderGroups';
import { circleAtScreenRes } from './screenCircle';
import { installGlParameterCache } from './glParamCache';
import { collectHitsUnderPoint, needsPickMenu, PICK_MENU_MAX_ROWS, type PickCandidate, type PickHit } from './pickStack';
import { openPickMenu, closePickMenu, type PickMenuEntry } from '../ui/pickMenu';
import { describeSubRole } from '../sim/player/orderMenu';
import { BuiltObjectRole } from '../sim/data/designSpecifications';
import { SystemVisibilityStatus } from '../sim/visibility';
import { playGridClick } from '../audio/gameAudio'; // [audio]
import { Application, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { Camera } from './camera';
import {
    AssetStore,
    BACKDROP_URLS,
    CLOUD_COLORS,
    PLANET_COLORS,
    STAR_COLORS,
    asteroidUrls,
    cloudUrls,
    coronaFrameIndex,
    coronaFrameUrls,
    makeBackdropTexture,
    makeCloudTexture,
    makeDotTexture,
    makeGlowTexture,
    makePlanetTexture,
    makeStarSpriteTexture,
    manifestFiles,
    mapStarUrls,
    planetUrls,
    sampleCentreColour,
    scaleColour,
    starDiscUrl,
    starSpriteUrls,
} from './assets';
import { DeepStarfield, deepStarfieldAlpha, systemPatchZoomAlpha, type PatchSystem } from './deepStarfield';
import { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import { GalaxyLocation, GalaxyLocationType } from '../sim/galaxyLocation';
import { Habitat, HabitatCategoryType, HabitatType, SystemInfo } from '../sim/types';
import { NebulaCloudGenerator } from './nebulaClouds';
import { SystemNebulaLayer, type NebulaSystem } from './systemNebula';
import { EmpireLayer } from './empireLayer';
import { OverlayLayer } from './overlayLayer';
import { GalaxyMarkerLayer, clickSelection, doubleClickFleet } from './galaxyMarkers'; // [galaxymarkers]
import type { ShipGroup } from '../sim/fleets/shipGroup'; // [galaxymarkers]
import { ArtBundleLayer } from './artBundleLayer'; // [19r]
import { ArtBundleGallery, artGalleryView } from './artBundleGallery'; // [19r]
import { BuiltObjectLayer, BUILT_OBJECT_MAX_FACTOR } from './builtObjectLayer';
// [ambientfx] begin
import { AmbientLayer } from './ambientLayer';
// [ambientfx] end
// [fightersfx] begin
import { FighterLayer } from './fighterLayer';
import { WhalePilotLayer, whalePilotEnabled } from './whalePilotLayer'; // [whalepilot]
import { CreatureLayer, creatureTooltipText, creatureVariantName } from './creatureLayer';
import { FaunaGallery, faunaGalleryEnabled } from './faunaGallery'; // [newfauna]
// [fightersfx] end
// [rimatmo] begin
import { RimAtmosphereLayer } from './rimAtmosphereLayer';
// [rimatmo] end
// [rimatmo-wiring] begin
import { installRimAtmosphereData } from './rimAtmosphereWiring';
// [rimatmo-wiring] end
// [combatfx] begin
import { updateCombatEffects } from './effectsLayer';
// [combatfx] end
import { BuiltObject } from '../sim/builtObject';
import type { Creature } from '../sim/creature';
import { createMapOverlayState, type MapOverlayState } from '../ui/mapOverlays';
import { getSettings, showRegionLabels, showSystemNames } from '../ui/settings';
import { edgeScrollPixels, nebulaDetailScale, wheelNotches, wheelZoom, wheelZoomAnchor } from './viewInput'; // [gameoptions]
import { hideMapTooltip, showMapTooltip, tooltipText } from '../ui/mapTooltip';
import { freightTooltipText } from '../ui/freightText'; // [freightOverlay]
import { wreckTooltipText } from '../ui/scenario/wreckageUi'; // [wreckage]
import type { FreightOverlay } from './freightOverlay'; // [freightOverlay]
import { boundsOnScreen, DrawKey } from './drawCache';
import { drawRangeRings, fleetRangeRadii } from './rangeRings';
import { BuiltObjectIndex, registerBuiltObjectIndex } from './builtObjectIndex';
import { MotionInterpolator, createRenderTime, builtObjectDrawnOffsetBound, drawnBuiltObjectPos, habitatTouchClampSeconds, renderOrbitAngle, type RenderTime } from './renderInterp';
import { isDrag, objectsInBox, resolveBoxSelection, screenBox, shiftClickSelection, type ScreenBox } from './boxSelect';
import { isObjectVisibleToThisEmpire } from '../sim/independentTraders';
import { createFollowState, followTargetAlive, followTargetPosition, isFollowing, stopFollow, type FollowState, type FollowTarget } from './followCamera';

export function fadeIn(v: number, a: number, b: number): number {
    if (v <= a) {
        return 0;
    }
    if (v >= b) {
        return 1;
    }
    const t = (v - a) / (b - a);
    return t * t * (3 - 2 * t);
}

// Task 08f3: every map Text uses this family so the labels fall back to
// sans-serif (not serif) when 'Forgotten Futurist' has not loaded yet.
export const MAP_FONT_FAMILY = 'Forgotten Futurist, sans-serif';

/**
 * Task 08f3: wait for the 'Forgotten Futurist' web font (declared via CSS
 * @font-face in hud.css) before building the Main View text layers, so the
 * region/system/planet labels rasterize in the real font instead of the
 * serif fallback. Both weights are requested because RegionLabel switches
 * fontWeight between normal and bold per zoom branch. Failures are caught
 * and ignored — the labels then use the sans-serif fallback.
 */
export async function loadMapFont(): Promise<void> {
    try {
        // Sample text is not a space: the @font-face unicode-range (hud.css)
        // excludes U+0020, and load()'s default sample is ' '.
        await document.fonts.load('16px "Forgotten Futurist"', 'Aa');
        await document.fonts.load('bold 16px "Forgotten Futurist"', 'Aa');
    } catch {
        // Font unavailable (e.g. no DW:U install): continue with the fallback.
    }
}

export function fadeOut(v: number, a: number, b: number): number {
    return 1 - fadeIn(v, a, b);
}

// Layer crossfade windows for the mid-zoom gap between the galaxy backdrop
// and the system layers (task 02b2). The backdrop fades out over
// [m*2.5, m*14] where m = minZoom (whole-galaxy zoom), so the starfield
// must start fading in where the backdrop starts fading out and be fully
// opaque by the time the backdrop is gone — otherwise the screen goes
// black at ~zoom factor 150.
export function backdropAlpha(z: number, m: number): number {
    return fadeOut(z, m * 2.5, m * 14);
}

export function starfieldAlpha(z: number, m: number): number {
    return fadeIn(z, m * 2.5, m * 14);
}

// Orbit rings appear once the outermost orbit spans >= ~40 px on screen
// (smoothed with a short fade-in window).
export function orbitRingAlpha(z: number, maxOrbitDistance: number): number {
    if (maxOrbitDistance <= 0) {
        return 0;
    }
    const zMin = 40 / maxOrbitDistance;
    return 0.5 * fadeIn(z, zMin, zMin * 2);
}

// renderOrbitAngle / habitatTouchClampSeconds (render-only orbit interpolation) live in renderInterp.ts with the
// rest of the between-steps interpolation; re-exported here for existing callers.
export { renderOrbitAngle, habitatTouchClampSeconds } from './renderInterp';

// Task 12p (Main.Part11.cs:487-505, MainView.1.cs:437-470/626-642,
// MainView.cs:2186-2191): on-screen body sizes at system zoom, in the
// original's zoom factor f = 1/z (px per world unit z, max 1). Planets and
// moons are drawn while f < 500 with a compressed zoom factor (divided by
// 1.25 / 1.1 above f = 10) and a minimum of 4 px (asteroids 1 px); stars
// use the plain factor with a minimum of 4 px and no cap. The galaxy-level
// map-star icon is D/f clamped to >= 10 px, plus 2 (MainView.2.cs:5465-5473).
// Task fix8ui: system culling test. cam.width/height are screen pixels and
// the star position / system extent are world units, so the half-extent of
// the visible world rect is width/(2z); `extent` (farthest body from the
// star, world units) and a screen-space margin are added on top. Mixing the
// two units hid systems whose bodies orbit far from the star at 100% zoom
// (a capital moon ~16000 units out was culled with its whole system).
export function systemInView(
    starX: number,
    starY: number,
    extent: number,
    camX: number,
    camY: number,
    camW: number,
    camH: number,
    z: number,
    screenMargin: number,
): boolean {
    const halfW = (camW / 2 + screenMargin) / z + extent;
    const halfH = (camH / 2 + screenMargin) / z + extent;
    return starX > camX - halfW && starX < camX + halfW && starY > camY - halfH && starY < camY + halfH;
}

export function planetZoomFactor(f: number): number {
    // Port of Main.Part11.cs CalculatePlanetZoomFactor.
    let result = f;
    if (f > 10.0) {
        result = Math.max(10.0, f / 1.25);
    }
    return result;
}

export function moonZoomFactor(f: number): number {
    // Port of Main.Part11.cs CalculateMoonZoomFactor.
    let result = f;
    if (f > 10.0) {
        result = Math.max(10.0, f / 1.1);
    }
    return result;
}

export function planetSpritePx(diameter: number, z: number): number {
    const f = 1 / z;
    return Math.max(4, Math.trunc(diameter / planetZoomFactor(f) + 1e-6));
}

export function moonDotPx(diameter: number, z: number): number {
    const f = 1 / z;
    return Math.max(4, Math.trunc(diameter / moonZoomFactor(f) + 1e-6));
}

export function starSpritePx(diameter: number, z: number): number {
    const f = 1 / z;
    return Math.max(4, Math.trunc(diameter / f + 1e-6));
}

export function starGalaxySpritePx(diameter: number, z: number): number {
    const f = 1 / z;
    return Math.max(10, Math.trunc(diameter / f + 1e-6)) + 2;
}

// Task 12p (MainView.cs:3027-3058 method_60 `result` column): the zoom
// factor below which the star is drawn as rotating discs + corona instead
// of its plain texture (default 100 for unlisted types).
export function starDiscMaxFactor(type: HabitatType): number {
    switch (type) {
        case HabitatType.MainSequence:
            return 60;
        case HabitatType.RedGiant:
        case HabitatType.SuperGiant:
            return 75;
        case HabitatType.WhiteDwarf:
            return 40;
        case HabitatType.Neutron:
            return 30;
        case HabitatType.BlackHole:
        case HabitatType.SuperNova:
            return 150;
        default:
            return 100;
    }
}

// Task 12p (MainView.1.cs:1814-1919 label rules): draw a habitat name while
// f < 500 — populated colonies always, planets only down to f < 10. Bases
// are not modelled (their flag ignored); the ruin marker (flag13) is skipped.
export function habitatLabelVisible(isPlanet: boolean, populated: boolean, f: number): boolean {
    return f < 500 && (populated || (isPlanet && f < 10));
}

// Task 12p (MainView.1.cs:2314-2338 method_84): TinyFont (11 px) at f >= 3,
// NormalFont (17 px) below — the GDI twin's 10.67/16.67 px rounded up.
export function habitatLabelFontSize(f: number): number {
    return f < 3 ? 17 : 11;
}

// Task 12p (method_84): empire main colour unless the habitat belongs to
// the independent empire (or none), then the default grey 0xa0a0a0
// (MainView.cs:1410 color_1 = FromArgb(255,160,160,160)).
export function habitatLabelColor(h: Habitat, independent: Empire | null): number {
    return h.empire !== null && h.empire !== independent ? h.empire.mainColor : 0xa0a0a0;
}

// Task 08g (Controls/MainView.cs mouse picking): pure hit-test over a list of
// candidate habitats. Each object's drawn art is a disc centred where it is
// drawn (`posOf`, the render-interpolated orbit position, renderInterp.ts
// renderHabitatPos; default its committed xpos / ypos) whose on-screen
// diameter is `sizeFn(habitat, zoom)` px (the same size functions the renderer
// uses). The hit radius is half that drawn size, at least `minRadiusPx` CSS px
// so tiny objects stay clickable, converted to world units (px / zoom). Among
// several matches the smaller drawn object wins (a moon in front of its planet,
// a planet in front of the star), then the closer centre. Null for empty space.
export function hitTestHabitats(
    list: Habitat[],
    x: number,
    y: number,
    sizeFn: (h: Habitat, zoom: number) => number,
    zoom: number,
    posOf: (h: Habitat) => { x: number; y: number } = (h) => ({ x: h.xpos, y: h.ypos }),
    minRadiusPx = 6,
): Habitat | null {
    let best: Habitat | null = null;
    let bestSize = Infinity;
    let bestDist = Infinity;
    for (const h of list) {
        const s = sizeFn(h, zoom);
        if (s <= 0) continue;
        const rWorld = Math.max(s / 2, minRadiusPx) / zoom;
        const p = posOf(h);
        const d = Math.hypot(x - p.x, y - p.y);
        if (d > rWorld) continue;
        if (s < bestSize || (s === bestSize && d < bestDist)) {
            bestSize = s;
            bestDist = d;
            best = h;
        }
    }
    return best;
}

/** Asteroid rocks are drawn only above this zoom (SystemView.updateBodies `rocksVisible`). */
export const ROCK_MIN_ZOOM = 0.05;

/** On-screen size in px of an asteroid rock: world-linear, diameter * zoom * 0.45 (SystemView's rock sprite scale). */
export function asteroidDrawnPx(diameter: number, z: number): number {
    return diameter * 0.45 * z;
}

/** On-screen size in px of the star art at zoom z: the same bands the system renderer draws (discs / sprite /
 * galaxy map-star icon / small map icon). */
export function starDrawnPx(star: Habitat, z: number): number {
    const f = 1 / z;
    const bhOrSn = star.type === HabitatType.BlackHole || star.type === HabitatType.SuperNova;
    if (!bhOrSn && f < starDiscMaxFactor(star.type)) return starSpritePx(star.diameter, z);
    if (star.type === HabitatType.BlackHole && f < 150) return starSpritePx(star.diameter, z);
    if (f < 150) return starGalaxySpritePx(star.diameter, z);
    return clamp(star.diameter * z * 30, 2.5, 26);
}

// Task 08f1 (MainView.2.cs 4675-4705): region/nebula location labels are
// drawn only while the original's zoom factor `double_15` satisfies
// 70 < double_15 <= double_5 (the full-galaxy factor, passed by the caller).
// The font depends on the location type and the factor:
//   NebulaCloud:  > 4000 -> font_2 (15.33 px regular)
//                 > 1000 -> font_0 (16.67 px regular)
//                 else   -> font_1 (18.67 px bold)
//   other types:  > 4000 -> font_3 (10.67 px regular)
//                 > 1000 -> font_2 (15.33 px regular)
//                 else   -> font_0 (16.67 px regular)
// Fonts (MainView.cs 624-627): font_0 = 16.67 px regular, font_1 = 18.67 px
// bold, font_2 = 15.33 px regular, font_3 = 10.67 px regular.
export function regionLabelFont(type: GalaxyLocationType, factor: number, maxFactor: number): { size: number; bold: boolean } | null {
    if (!(factor > 70 && factor <= maxFactor)) {
        return null;
    }
    if (type === GalaxyLocationType.NebulaCloud) {
        if (factor > 4000) {
            return { size: 15.33, bold: false };
        }
        if (factor > 1000) {
            return { size: 16.67, bold: false };
        }
        return { size: 18.67, bold: true };
    }
    if (factor > 4000) {
        return { size: 10.67, bold: false };
    }
    if (factor > 1000) {
        return { size: 15.33, bold: false };
    }
    return { size: 16.67, bold: false };
}

// Task 08f2 (Controls/MainView.cs FadeGalaxyNebulae ~4111-4152): the nebula
// cloud images are visible at galaxy/sector zoom and fade out as the sector
// starfield takes over — the same window the backdrop fades out over
// ([m*2.5, m*14], m = minZoom). At full-galaxy zoom they are fully opaque;
// they are gone by the time the dense starfield is opaque.
export function nebulaAlpha(z: number, m: number): number {
    return fadeOut(z, m * 2.5, m * 14);
}

/** Screen-pixel part of a system's cull bounds (render: perf pass): minimum sprite sizes, the map icon, and the
 * planet / moon / system name labels, which are centred on a body's right edge or under the star. */
export const SYSTEM_CULL_PX_MARGIN = 1000;

function clamp(v: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, v));
}

// Planet-type dots at mid zoom (assets.ts keeps the same palette).
const PLANET_DOT_TYPES = [
    HabitatType.Volcanic,
    HabitatType.Desert,
    HabitatType.MarshySwamp,
    HabitatType.Continental,
    HabitatType.Ocean,
    HabitatType.BarrenRock,
    HabitatType.Ice,
    HabitatType.GasGiant,
    HabitatType.FrozenGasGiant,
];


function starColors(type: HabitatType): { glow: string; core: string } {
    return STAR_COLORS[type] ?? STAR_COLORS[HabitatType.MainSequence];
}

// ---------------------------------------------------------------------------

class PlanetView {
    habitat: Habitat;
    dot: Sprite;
    sprite: Sprite;
    label: Text;
    moons: MoonView[] = [];
    constructor(private system: SystemView, habitat: Habitat, dotTex: Texture) {
        this.habitat = habitat;
        this.dot = new Sprite(dotTex);
        this.dot.anchor.set(0.5);
        this.dot.visible = false;
        this.system.bodies.addChild(this.dot);
        this.sprite = new Sprite(makePlanetTexture(PLANET_COLORS[habitat.type] ?? '#888888'));
        this.sprite.anchor.set(0.5);
        this.sprite.visible = false;
        this.sprite.alpha = 0;
        this.system.bodies.addChild(this.sprite);
        // Task 12p (method_84): name centred on the drawn rect's right edge,
        // vertically centred on the body; 1 px black drop shadow (the XNA
        // offset is not recoverable from the C#).
        this.label = new Text({
            text: habitat.name,
            style: {
                fontSize: 11,
                fill: 0xa0a0a0,
                fontFamily: MAP_FONT_FAMILY,
                dropShadow: { color: 0x000000, distance: 1, blur: 0, alpha: 1, angle: Math.PI / 4 },
            },
        });
        this.label.anchor.set(0.5, 0.5);
        this.label.visible = false;
        this.system.bodies.addChild(this.label);
    }
}

class MoonView {
    habitat: Habitat;
    dot: Sprite;
    label: Text;
    constructor(private system: SystemView, habitat: Habitat, tex: Texture) {
        this.habitat = habitat;
        this.dot = new Sprite(tex);
        this.dot.anchor.set(0.5);
        this.dot.visible = false;
        this.system.bodies.addChild(this.dot);
        // Task 12p: moons are full planet-textured sprites at system zoom
        // (MainView.1.cs:437-470 draws them like planets, factor via
        // CalculateMoonZoomFactor), with the same label rules as planets.
        this.label = new Text({
            text: habitat.name,
            style: {
                fontSize: 11,
                fill: 0xa0a0a0,
                fontFamily: MAP_FONT_FAMILY,
                dropShadow: { color: 0x000000, distance: 1, blur: 0, alpha: 1, angle: Math.PI / 4 },
            },
        });
        this.label.anchor.set(0.5, 0.5);
        this.label.visible = false;
        this.system.bodies.addChild(this.label);
    }
}

/** Orbit rings (planet ring and every planet's moon ring) draw BELOW all bodies and their labels: the ring goes
 * straight before the `bodies` container in the system root's child order. */
export function addRingBelowBodies(root: Container, ring: Container, bodies: Container): void {
    root.addChildAt(ring, root.getChildIndex(bodies));
}

class SystemView {
    system: SystemInfo;
    root: Container;
    mapIcon: Sprite;
    starSprite: Sprite;
    nameLabel: Text;
    ring: Graphics;
    /** Planets, moons, their labels and the asteroid rocks, in habitat order (render: perf pass). One container so
     * the whole group is skipped — by this update and by Pixi's scene traversal — while none of it is drawn
     * (zoom factor >= 500). It sits where the bodies used to be among root's children, so draw order is unchanged. */
    bodies: Container;
    /** Everything drawn only from sector / system zoom in: the star discs + corona, the orbit rings, the moon rings and
     * `bodies`, in that draw order between the star sprite and the name label. Detached from root while none of it is
     * drawn (render: zoom perf) — Pixi re-walks every attached descendant, hidden ones included, on each pan / zoom
     * frame, and at galaxy zoom this was ~50 hidden containers per system. */
    private detail = new Container();
    /** World-space radius around the star that holds everything this system draws, not counting pixel-sized
     * extras (min sprite sizes, labels) — those are covered by SYSTEM_CULL_PX_MARGIN. */
    drawRadius = 0;
    private rocksShown: boolean | null = null;
    planets: PlanetView[] = [];
    asteroids: Sprite[] = [];
    rockHabitats: Habitat[] = [];
    /** One moon-ring Graphics per planet (parallel to `planets`), drawn around (0,0) on zoom change and moved to the
     * planet's drawn position every frame, so the rings follow the orbiting planet instead of staying where it was. */
    moonRings: Graphics[] = [];
    /** Every planet's moon ring, in one container just below `bodies` and shown only with them (render: galaxy-zoom
     * perf — Pixi's traversal visits one hidden child per system instead of one per planet). */
    private moonRingLayer = new Container();
    /** Fog of war (fog.ts): which bodies of this system are drawn (all, unless the player has not explored it), and a
     * signature of that set so the orbit rings / rocks are rebuilt when it changes. */
    private fogSig = 0;
    private planetDrawn: boolean[] = [];
    private moonDrawn: boolean[][] = [];
    private rockDrawn: boolean[] = [];
    maxExtent = 0; // farthest orbit radius (culling margin)
    private lastRingZoom = -1;

    // Task 02c2: system-zoom star = two tinted counter-rotating discs plus an
    // animated corona (MainView.1.cs ~740-782). Built lazily on first entry to
    // the crossfade window; black holes keep the plain `starSprite` instead.
    private starDiscs: Container | null = null;
    private discA: Sprite | null = null;
    private discB: Sprite | null = null;
    private corona: Sprite | null = null;
    private coronaFrames: Texture[] = [];
    private coronaFps = 15;
    private coronaScale = 1.65;
    private discAngle = 0;

    constructor(private view: MainView, system: SystemInfo, textures: MainViewTextures) {
        this.system = system;
        const star = system.systemStar;
        this.root = new Container();
        this.root.x = star.xpos;
        this.root.y = star.ypos;
        this.root.visible = false;
        // Attached to the scene graph only while visible (MainView.systemLayer, renderGroups.ts AttachedChildren).
        view.systemLayer.add(this.root);

        // Generated fallbacks; the original per-habitat art (pictureRef)
        // loads lazily in MainView.init and swaps the texture in.
        this.mapIcon = new Sprite(makeGlowTexture(starColors(star.type).glow, starColors(star.type).core));
        this.mapIcon.anchor.set(0.5);
        this.mapIcon.visible = false;
        this.root.addChild(this.mapIcon);

        this.starSprite = new Sprite(makeStarSpriteTexture(star.type));
        this.starSprite.anchor.set(0.5);
        this.starSprite.visible = false;
        this.starSprite.alpha = 0;
        this.root.addChild(this.starSprite);

        // Task 02c2: tinted rotating discs + corona for non-black-hole stars,
        // built lazily (see buildStarDiscs) so the corona frames are only
        // fetched once a star actually reaches system zoom.
        if (star.type !== HabitatType.BlackHole) {
            this.starDiscs = new Container();
            this.starDiscs.visible = false;
            this.starDiscs.alpha = 0;
            this.discA = new Sprite(Texture.EMPTY);
            this.discA.anchor.set(0.5);
            this.discB = new Sprite(Texture.EMPTY);
            this.discB.anchor.set(0.5);
            this.corona = new Sprite(Texture.EMPTY);
            this.corona.anchor.set(0.5);
            this.starDiscs.addChild(this.discA, this.discB, this.corona);
            this.detail.addChild(this.starDiscs);
        }

        this.ring = new Graphics();
        this.detail.addChild(this.ring);
        this.bodies = new Container();
        this.detail.addChild(this.bodies);
        addRingBelowBodies(this.detail, this.moonRingLayer, this.bodies);
        // Star: discs + corona (<= 2.3 x the drawn size S = max(4, diameter*z) px) or the map icon (<= 26 px or
        // diameter*z + 2 px), so 1.2 diameters plus the pixel margin.
        let radius = 1.2 * star.diameter;

        // Planets and their moons (orbit positions relative to the star).
        for (const habitat of system.habitats) {
            if (habitat.category === HabitatCategoryType.Planet) {
                const planet = new PlanetView(this, habitat, textures.dots.get(habitat.type) ?? textures.dot);
                this.planets.push(planet);
                const moonRing = new Graphics();
                moonRing.visible = false;
                this.moonRingLayer.addChild(moonRing);
                this.moonRings.push(moonRing);
                for (const moon of system.habitats) {
                    if (moon.category === HabitatCategoryType.Moon && moon.parent === habitat) {
                        // Task 12p: moons render as planet-textured sprites, not dots.
                        planet.moons.push(new MoonView(this, moon, makePlanetTexture(PLANET_COLORS[moon.type] ?? '#888888')));
                        this.maxExtent = Math.max(this.maxExtent, habitat.orbitDistance + moon.orbitDistance + 3000);
                        // Moon orbit ring + moon sprite (<= 1.1 x diameter*z px).
                        radius = Math.max(radius, habitat.orbitDistance + moon.orbitDistance + moon.diameter);
                    }
                }
                // Orbit ring + planet sprite (<= 1.25 x diameter*z px, or the 4 px minimum).
                radius = Math.max(radius, habitat.orbitDistance + habitat.diameter);
                this.maxExtent = Math.max(this.maxExtent, habitat.orbitDistance + 3000);
            } else if (habitat.category === HabitatCategoryType.Asteroid) {
                const rock = new Sprite(textures.rock);
                rock.anchor.set(0.5);
                rock.x = Math.cos(habitat.orbitAngle) * habitat.orbitDistance;
                rock.y = Math.sin(habitat.orbitAngle) * habitat.orbitDistance;
                // Rock pixel size is world-linear (px = diameter*zoom*0.45),
                // so the counter-scale is zoom-independent.
                rock.scale.set((habitat.diameter * 0.45) / textures.rock.width);
                rock.visible = false;
                this.asteroids.push(rock);
                this.rockHabitats.push(habitat);
                this.bodies.addChild(rock);
                radius = Math.max(radius, habitat.orbitDistance + habitat.diameter);
                this.maxExtent = Math.max(this.maxExtent, habitat.orbitDistance + 3000);
            }
        }

        this.drawRadius = radius;

        this.nameLabel = new Text({
            text: star.name,
            style: { fontSize: 11, fill: 0xffffff, fontFamily: MAP_FONT_FAMILY },
        });
        this.nameLabel.anchor.set(0.5, 0);
        this.nameLabel.visible = false;
        this.root.addChild(this.nameLabel);
    }

    /** Per-frame level-of-detail update (only for systems near the view). */
    update(zoom: number, cam: Camera, labelAllowed: boolean, dtSeconds: number): void {
        const star = this.system.systemStar;
        // Culling (render: perf pass): skip the system only when everything it can draw — star, orbit rings,
        // planets, moons, rocks (drawRadius, world units) plus labels and minimum sprite sizes (px margin) — is off
        // screen. The previous test, (300 + 0.3 * maxExtent) / zoom around the star, hid on-screen systems: planetless
        // stars away from the view centre at galaxy / sector zoom, and at planet zoom the whole system of a planet
        // orbiting > ~0.3 * maxExtent from its star (the planet itself vanished).
        const visible = boundsOnScreen(star.xpos, star.ypos, this.drawRadius, SYSTEM_CULL_PX_MARGIN, cam.x, cam.y, cam.width, cam.height, zoom);
        this.root.visible = visible;
        this.view.systemLayer.set(this.root, visible);
        if (!visible) {
            return;
        }

        const z = zoom;
        // Task 12p (MainView.1.cs:735-785, MainView.2.cs:5465-5473): hard
        // bands on the original's zoom factor f = 1/z — no crossfade.
        //   f < discMax(type)      : rotating discs + corona (not BH/SN)
        //   BH and f < 150         : plain star sprite
        //   f < 150                : galaxy-level map-star icon
        //   f >= 150               : small map icon (iconPx)
        const f = 1 / z;
        const S = starSpritePx(star.diameter, z);
        const isBHOrSN = star.type === HabitatType.BlackHole || star.type === HabitatType.SuperNova;
        if (!isBHOrSN && f < starDiscMaxFactor(star.type)) {
            this.mapIcon.visible = false;
            this.starSprite.visible = false;
            this.updateStarDiscs(1, S, z, dtSeconds);
        } else if (star.type === HabitatType.BlackHole && f < 150) {
            this.mapIcon.visible = false;
            this.updateStarDiscs(0, S, z, dtSeconds);
            this.starSprite.visible = true;
            this.starSprite.alpha = 1;
            this.starSprite.scale.set(S / (this.starSprite.texture.width * z));
        } else if (star.type === HabitatType.SuperNova && f < 150) {
            // MainView.2.cs 5491 draws the nova flare art only while f > method_60(SuperNova) = 150, and the system
            // pass (MainView.1.cs 728: `Type != SuperNova`) draws nothing for it: no flare sprite at system zoom
            // (it was the 8-spike "lens flare" over the star).
            this.updateStarDiscs(0, S, z, dtSeconds);
            this.starSprite.visible = false;
            this.mapIcon.visible = false;
        } else if (f < 150) {
            this.updateStarDiscs(0, S, z, dtSeconds);
            this.starSprite.visible = false;
            this.mapIcon.visible = true;
            this.mapIcon.alpha = 1;
            const gpx = starGalaxySpritePx(star.diameter, z);
            this.mapIcon.scale.set(gpx / (this.mapIcon.texture.width * z));
        } else {
            this.updateStarDiscs(0, S, z, dtSeconds);
            this.starSprite.visible = false;
            this.mapIcon.visible = true;
            this.mapIcon.alpha = 1;
            const iconPx = clamp(star.diameter * z * 30, 2.5, 26);
            this.mapIcon.scale.set(iconPx / (this.mapIcon.texture.width * z));
        }

        // Faint circular orbit rings: visible from the zoom where the
        // outermost orbit spans >= ~40 px on screen (task 02b2), persist
        // through 100%.
        const ringA = orbitRingAlpha(z, this.maxExtent);
        const bodiesShown = f < 500;
        // Render: galaxy-zoom perf — the fog pass only decides which rings / bodies are drawn, so skip it while
        // neither is (every visible Unexplored system otherwise scanned all the player's ships per frame).
        if (bodiesShown || ringA > 0.02) this.updateFog();
        this.ring.visible = ringA > 0.02;
        if (this.ring.visible) {
            this.ring.alpha = ringA;
            if (this.lastRingZoom < 0 || Math.abs(z / this.lastRingZoom - 1) > 0.05) {
                this.redrawRings(z);
                this.lastRingZoom = z;
            }
        }

        // Render: perf pass — at f >= 500 no planet, moon, label or rock is drawn (sprites and labels need f < 500,
        // rocks z > 0.05), so hide the group and skip the per-body work.
        this.bodies.visible = bodiesShown;
        // The moon rings live outside `bodies` (below it, under root) and go with them.
        this.moonRingLayer.visible = bodiesShown;
        if (bodiesShown) {
            this.updateBodies(z, f);
        }
        this.setDetailAttached(bodiesShown || this.ring.visible || (this.starDiscs?.visible ?? false));

        // System name label under the star (small white text). Task 12p: only
        // drawn above f = 150 (MainView.2.cs:5153/5627-5630) — nothing names
        // stars at system zoom; offset uses the larger of the map icon and
        // the drawn star size.
        this.nameLabel.visible = labelAllowed && f > 150;
        if (this.nameLabel.visible) {
            const gpx = starGalaxySpritePx(star.diameter, z);
            const iconPx = clamp(star.diameter * z * 30, 2.5, 26);
            this.nameLabel.position.set(0, (Math.max(iconPx, gpx) * 0.5 + 10) / z);
            this.nameLabel.scale.set(1 / z);
        }
    }

    /** Attach `detail` (just below the name label) while any of it is drawn, else detach it (see `detail`). */
    private setDetailAttached(on: boolean): void {
        const attached = this.detail.parent === this.root;
        if (on === attached) return;
        if (on) this.root.addChildAt(this.detail, this.root.getChildIndex(this.nameLabel));
        else this.root.removeChild(this.detail);
    }

    /**
     * Fog of war (MainView.1.cs 440-448, 1750-1770; fog.ts): in a system the player has not explored only the star is
     * drawn, plus — when its ships / scanners are in range — the gas clouds and the bodies it can see. Fills
     * planetDrawn / moonDrawn / rockDrawn and, when the set changed, forces the rings and rocks to be rebuilt.
     */
    private updateFog(): void {
        const fog = fogOf(this.view.galaxy);
        let sig = 0;
        if (fog.status(this.system.systemStar.systemIndex) === SystemVisibilityStatus.Unexplored) {
            sig = 1;
            const bit = (b: boolean): number => (sig = (Math.imul(sig, 31) + (b ? 1 : 2)) | 0);
            for (let i = 0; i < this.planets.length; i++) {
                const planet = this.planets[i];
                this.planetDrawn[i] = fog.habitatDrawn(planet.habitat);
                bit(this.planetDrawn[i]);
                const md = (this.moonDrawn[i] ??= []);
                for (let k = 0; k < planet.moons.length; k++) {
                    md[k] = fog.habitatDrawn(planet.moons[k].habitat);
                    bit(md[k]);
                }
            }
            for (let i = 0; i < this.rockHabitats.length; i++) {
                this.rockDrawn[i] = fog.habitatDrawn(this.rockHabitats[i]);
                bit(this.rockDrawn[i]);
            }
        } else if (this.fogSig !== 0) {
            this.planetDrawn.length = 0;
            this.moonDrawn.length = 0;
            this.rockDrawn.length = 0;
        }
        if (sig !== this.fogSig) {
            this.fogSig = sig;
            this.lastRingZoom = -1;
            this.rocksShown = null;
        }
    }

    private planetIsDrawn(pi: number): boolean {
        return this.planetDrawn[pi] !== false;
    }

    private moonIsDrawn(pi: number, k: number): boolean {
        return this.moonDrawn[pi]?.[k] !== false;
    }

    /** Planets, moons, their labels and the rocks (only called while f < 500). */
    private updateBodies(z: number, f: number): void {
        // Task 12p (MainView.1.cs:437-470): no dot crossfade — planet sprites are
        // drawn while f < 500 at their compressed-factor size; the name
        // label follows the original's populated/planet rules (method_84).
        // Render-only orbit interpolation (renderOrbitAngle, defined above): draws each body at the angle its
        // committed orbitAngle/lastTouch imply RIGHT NOW, not the possibly seconds-stale committed angle itself.
        const galaxy = this.view.galaxy;
        const clampSeconds = habitatTouchClampSeconds(galaxy.habitats.length);
        // renderNowMs: galaxy.nowMs plus the elapsed part of the next sim step (renderInterp.ts), so the angles also
        // advance between steps.
        const nowMs = this.view.renderTime.renderNowMs;
        for (let pi = 0; pi < this.planets.length; pi++) {
            const planet = this.planets[pi];
            const p = planet.habitat;
            const pAngle = renderOrbitAngle(p.orbitAngle, p.anglePerSecond, p.orbitDirection, p.lastTouch, nowMs, clampSeconds);
            const px = Math.cos(pAngle) * p.orbitDistance;
            const py = Math.sin(pAngle) * p.orbitDistance;
            const mg = this.moonRings[pi];
            if (!this.planetIsDrawn(pi)) {
                // Fog of war: not drawn — nor its label, moons or moon rings.
                planet.sprite.visible = false;
                planet.label.visible = false;
                mg.visible = false;
                for (const moon of planet.moons) {
                    moon.dot.visible = false;
                    moon.label.visible = false;
                }
                continue;
            }
            mg.visible = this.ring.visible && planet.moons.length > 0;
            if (mg.visible) {
                mg.alpha = this.ring.alpha;
                mg.position.set(px, py);
            }
            const sprPx = planetSpritePx(p.diameter, z);
            planet.dot.visible = false;
            planet.sprite.visible = f < 500;
            planet.sprite.alpha = 1;
            planet.sprite.position.set(px, py);
            planet.sprite.scale.set(sprPx / (planet.sprite.texture.width * z));
            // Label centred on the drawn rect's right edge (method_84),
            // vertically centred on the body.
            const populated = p.owner !== null && p.population.items.length > 0;
            planet.label.visible = habitatLabelVisible(true, populated, f);
            planet.label.position.set(px + (sprPx / 2) / z, py);
            planet.label.scale.set(1 / z);
            if (planet.label.visible) {
                const fontSize = habitatLabelFontSize(f);
                if (fontSize !== planet.label.style.fontSize) {
                    planet.label.style.fontSize = fontSize;
                }
                const fill = habitatLabelColor(p, this.view.galaxy.independentEmpire);
                if (fill !== planet.label.style.fill) {
                    planet.label.style.fill = fill;
                }
            }
            for (let mk = 0; mk < planet.moons.length; mk++) {
                const moon = planet.moons[mk];
                if (!this.moonIsDrawn(pi, mk)) {
                    moon.dot.visible = false;
                    moon.label.visible = false;
                    continue;
                }
                const m = moon.habitat;
                const mAngle = renderOrbitAngle(m.orbitAngle, m.anglePerSecond, m.orbitDirection, m.lastTouch, nowMs, clampSeconds);
                const mx = px + Math.cos(mAngle) * m.orbitDistance;
                const my = py + Math.sin(mAngle) * m.orbitDistance;
                const mPx = moonDotPx(m.diameter, z);
                moon.dot.visible = f < 500;
                moon.dot.alpha = 1;
                moon.dot.position.set(mx, my);
                moon.dot.scale.set(mPx / (moon.dot.texture.width * z));
                const mPopulated = m.owner !== null && m.population.items.length > 0;
                moon.label.visible = habitatLabelVisible(false, mPopulated, f);
                moon.label.position.set(mx + (mPx / 2) / z, my);
                moon.label.scale.set(1 / z);
                if (moon.label.visible) {
                    const fontSize = habitatLabelFontSize(f);
                    if (fontSize !== moon.label.style.fontSize) {
                        moon.label.style.fontSize = fontSize;
                    }
                    const fill = habitatLabelColor(m, this.view.galaxy.independentEmpire);
                    if (fill !== moon.label.style.fill) {
                        moon.label.style.fill = fill;
                    }
                }
            }
        }

        // Asteroid fields: scattered rocks, only once they resolve to >1 px.
        const rocksVisible = z > ROCK_MIN_ZOOM;
        if (rocksVisible !== this.rocksShown) {
            this.rocksShown = rocksVisible;
            for (let i = 0; i < this.asteroids.length; i++) {
                this.asteroids[i].visible = rocksVisible && this.rockDrawn[i] !== false;
            }
        }
        // Asteroids orbit their star like planets (Habitat.cs Move applies to every habitat with a Parent), so they
        // follow the same render-interpolated angle instead of the position frozen at system build.
        if (rocksVisible) {
            for (let i = 0; i < this.asteroids.length; i++) {
                const h = this.rockHabitats[i];
                const a = renderOrbitAngle(h.orbitAngle, h.anglePerSecond, h.orbitDirection, h.lastTouch, nowMs, clampSeconds);
                this.asteroids[i].position.set(Math.cos(a) * h.orbitDistance, Math.sin(a) * h.orbitDistance);
            }
        }
    }

    private redrawRings(z: number): void {
        const g = this.ring;
        g.clear();
        for (let i = 0; i < this.planets.length; i++) {
            const planet = this.planets[i];
            const p = planet.habitat;
            const mg0 = this.moonRings[i];
            if (!this.planetIsDrawn(i)) {
                mg0.clear(); // fog of war (fog.ts): no orbit ring for a planet the player cannot see
                continue;
            }
            circleAtScreenRes(g, 0, 0, p.orbitDistance, z).stroke({ width: 1.2 / z, color: 0x5c5cc0, alpha: 0.85 });
            // Faint moon-orbit circles (system zoom), drawn around (0,0) in their own Graphics; updateBodies moves it
            // to the planet's drawn position every frame.
            const mg = this.moonRings[i];
            mg.clear();
            if (z > 0.25) {
                for (let mk = 0; mk < planet.moons.length; mk++) {
                    if (!this.moonIsDrawn(i, mk)) continue;
                    circleAtScreenRes(mg, 0, 0, planet.moons[mk].habitat.orbitDistance, z).stroke({ width: 1.2 / z, color: 0x4c4ca0, alpha: 0.65 });
                }
            }
        }
    }

    /**
     * Task 02c2 (MainView.1.cs ~740-782): lazily build the system-zoom star
     * from two tinted counter-rotating discs plus an animated corona frame.
     * The tint is the centre pixel of this star's MAP-STAR image (the same
     * icon used at galaxy/sector zoom), sampled once per URL. Corona B is
     * used for all stars except neutron stars, which use Corona C with a
     * larger scale and slower fps.
     */
    private async buildStarDiscs(): Promise<void> {
        if (this.starDiscs === null || this.discA === null || this.discB === null || this.corona === null) {
            return;
        }
        const store = this.view.store;
        const star = this.system.systemStar;
        const [discATex, discBTex] = await Promise.all([
            store.loadFirst([starDiscUrl(2)], () => makeGlowTexture(starColors(star.type).glow, starColors(star.type).core)),
            store.loadFirst([starDiscUrl(0)], () => makeGlowTexture(starColors(star.type).glow, starColors(star.type).core)),
        ]);
        this.discA.texture = discATex;
        this.discB.texture = discBTex;

        // Tint = centre pixel of the map-star icon (method_120 in the
        // original); falls back to white when the image can't be read.
        const mapUrls = mapStarUrls(star);
        const c = mapUrls.length > 0 ? await sampleCentreColour(mapUrls[0]) : 0xffffff;
        const bright = scaleColour(c, 1.2);
        this.discA.tint = bright; // star_disc_2, rotation +angle, alpha 255
        this.discA.alpha = 1;
        this.discB.tint = c; // star_disc_0 on top, rotation -angle, alpha 96
        this.discB.alpha = 96 / 255;

        // Corona frames load lazily here (only when a star reaches system
        // zoom) and only once (AssetStore caches by first URL).
        const isNeutron = star.type === HabitatType.Neutron;
        this.coronaFps = isNeutron ? 12 : 15;
        this.coronaScale = isNeutron ? 2.3 : 1.65;
        const frames = await Promise.all(coronaFrameUrls(isNeutron ? 'C' : 'B').map((url) => store.loadFirst([url], () => Texture.EMPTY)));
        this.coronaFrames = frames;
        this.corona.texture = frames[0];
        this.corona.tint = bright;
        // Original alpha 240; at 50% (user call).
        this.corona.alpha = (240 / 255) * STAR_BLOOM_SCALE;
    }

    /** Per-frame update of the disc/corona group (no-op until built). */
    private updateStarDiscs(crossT: number, fullPx: number, z: number, dtSeconds: number): void {
        if (this.starDiscs === null || this.discA === null || this.discB === null || this.corona === null) {
            return;
        }
        if (crossT <= 0.005) {
            this.starDiscs.visible = false;
            this.starDiscs.alpha = 0;
            return;
        }
        if (this.coronaFrames.length === 0) {
            // First entry into the crossfade window: kick off the lazy load
            // (disc textures, centre-pixel tint, corona frames).
            void this.buildStarDiscs();
            this.starDiscs.visible = false;
            this.starDiscs.alpha = 0;
            return;
        }
        this.discAngle += dtSeconds * 0.02; // double_5 -= elapsed * 0.02; A rotates +angle, B -angle
        this.starDiscs.visible = true;
        this.starDiscs.alpha = crossT;
        const s = fullPx / (this.discA.texture.width * z);
        this.discA.scale.set(s);
        this.discA.rotation = this.discAngle;
        this.discB.scale.set(s);
        this.discB.rotation = -this.discAngle;
        const cs = (fullPx * this.coronaScale) / (this.corona.texture.width * z);
        this.corona.scale.set(cs);
        const nowMs = performance.now();
        this.corona.texture = this.coronaFrames[coronaFrameIndex(nowMs, this.coronaFrames.length, this.coronaFps)];
    }
}

/** Star corona (bloom) strength vs the original's alpha 240 (1 = original). */
export const STAR_BLOOM_SCALE = 0.5;

class CloudView {
    cloud: Habitat;
    sprite: Sprite;
    constructor(private view: MainView, cloud: Habitat, texture: Texture) {
        this.cloud = cloud;
        this.sprite = new Sprite(texture);
        this.sprite.anchor.set(0.5);
        this.sprite.x = cloud.xpos;
        this.sprite.y = cloud.ypos;
        this.sprite.alpha = 0.5;
        this.sprite.visible = false;
        this.view.world.addChild(this.sprite);
    }

    update(zoom: number, cam: Camera): void {
        const px = Math.min(this.cloud.diameter * zoom * 0.6, 2400);
        const visible = px > 16;
        // Culling margin of one cloud radius plus a screen margin.
        const halfW = cam.width / 2 + px / 2 + 100;
        const halfH = cam.height / 2 + px / 2 + 100;
        this.sprite.visible =
            visible &&
            this.cloud.xpos > cam.x - halfW &&
            this.cloud.xpos < cam.x + halfW &&
            this.cloud.ypos > cam.y - halfH &&
            this.cloud.ypos < cam.y + halfH;
        if (this.sprite.visible) {
            this.sprite.scale.set(px / (this.sprite.texture.width * zoom));
        }
    }
}

// Task 08f1 (MainView.2.cs 4675-4705): a GalaxyLocation name label in
// screen space (the original draws text at fixed pixel sizes on top of the
// world). One Text object per location, created once and reused; the font
// style is only rebuilt when the zoom-factor branch changes.
class RegionLabel {
    location: GalaxyLocation;
    text: Text;
    private lastSize = -1;
    private lastBold = false;
    constructor(location: GalaxyLocation, layer: Container) {
        this.location = location;
        this.text = new Text({
            text: location.name,
            style: { fontSize: 16.67, fill: 0xffffff, fontFamily: MAP_FONT_FAMILY },
        });
        this.text.anchor.set(0.5);
        this.text.alpha = 0.85;
        this.text.visible = false;
        layer.addChild(this.text);
    }

    /** Update position/font/visibility for the current camera state. */
    update(cam: Camera, factor: number, maxFactor: number): void {
        const font = regionLabelFont(this.location.type, factor, maxFactor);
        if (font === null || !this.location.showName) {
            this.text.visible = false;
            return;
        }
        // Screen centre of the location (MainView.2.cs x/y formulas), with
        // the non-nebula offset of (-5, -20) px.
        const c = this.location.resolveLocationCenter();
        const s = cam.worldToScreen(c.x, c.y);
        if (s.x < -100 || s.x > cam.width + 100 || s.y < -100 || s.y > cam.height + 100) {
            this.text.visible = false;
            return;
        }
        if (this.location.type !== GalaxyLocationType.NebulaCloud) {
            s.x -= 5;
            s.y -= 20;
        }
        if (font.size !== this.lastSize || font.bold !== this.lastBold) {
            this.text.style.fontSize = font.size;
            this.text.style.fontWeight = font.bold ? 'bold' : 'normal';
            this.lastSize = font.size;
            this.lastBold = font.bold;
        }
        this.text.position.set(s.x, s.y);
        this.text.visible = true;
    }
}

// Task 08f2 (NebulaCloudGenerator): a procedurally generated translucent
// nebula image placed over the location's rectangle. The texture is generated
// lazily the first time the cloud becomes visible (the original generates all
// clouds on a background thread at galaxy load; lazy generation keeps the
// same per-location seed = location index, so results are identical).
class NebulaView {
    location: GalaxyLocation;
    sprite: Sprite;
    private generator: NebulaCloudGenerator;
    constructor(private view: MainView, location: GalaxyLocation) {
        this.location = location;
        // Port of MainView.cs:1438-1452: two generators, seeds 1 and 2.
        // Nebula locations use the second one (nebulaCloudGenerator_1); the
        // color scheme stays -1 (random per generation, seeded by the call).
        this.generator = new NebulaCloudGenerator(2);
        this.sprite = new Sprite(Texture.EMPTY);
        this.sprite.anchor.set(0.5);
        this.sprite.x = location.xpos + location.width / 2;
        this.sprite.y = location.ypos + location.height / 2;
        this.sprite.alpha = 0;
        this.sprite.visible = false;
        this.view.world.addChild(this.sprite);
    }

    /** Generate (once) and draw the cloud for the current camera state. */
    update(zoom: number, cam: Camera, alpha: number): void {
        if (alpha <= 0.01) {
            this.sprite.visible = false;
            return;
        }
        const c = this.location.resolveLocationCenter();
        const halfW = cam.width / 2 + this.location.width * zoom * 0.5 + 100;
        const halfH = cam.height / 2 + this.location.height * zoom * 0.5 + 100;
        if (c.x < cam.x - halfW || c.x > cam.x + halfW || c.y < cam.y - halfH || c.y > cam.y + halfH) {
            this.sprite.visible = false;
            return;
        }
        if (this.sprite.texture === Texture.EMPTY) {
            // Lazy first-time generation (see class comment). The C# sizes
            // the cloud to the location rect via minimumSize/maximumSize; we
            // derive them from the rect in world units (the generator caps
            // the texture at 512 px and the sprite is stretched to the rect).
            const size = Math.max(64, Math.min(this.location.width, this.location.height));
            const result = this.generator.generateNebulaBackdrop(
                this.location.pictureRef >= 0 ? this.location.pictureRef : this.location.effectRandomSeed,
                114, // TransparencyLevel set in method_41 (double_2 == 4.5 default)
                -1,
                Math.trunc(size),
                Math.trunc(size * 1.5),
                true,
                false,
                false,
            );
            this.sprite.texture = this.generator.toTexture(result);
        }
        // Stretch the (<=512 px) texture over the location rectangle.
        this.sprite.scale.set(this.location.width / this.sprite.texture.width, this.location.height / this.sprite.texture.height);
        this.sprite.alpha = alpha;
        this.sprite.visible = true;
    }
}

// ---------------------------------------------------------------------------

export interface MainViewTextures {
    dots: Map<HabitatType, Texture>;
    dot: Texture;
    rock: Texture;
    backdrop: Texture;
}

/** Type label for a stacked-object pick row: the ship / base sub-role, the habitat type + category, the creature
 *  variant. */
function pickTypeLabel(it: Creature | BuiltObject | Habitat): string {
    if (it instanceof BuiltObject) return describeSubRole(it.subRole);
    if (it instanceof Habitat) {
        const key = Object.keys(HabitatType).find((k) => (HabitatType as Record<string, unknown>)[k] === it.type) ?? '';
        const words = key.replace(/([a-z])([A-Z])/g, '$1 $2');
        const cat = it.category === HabitatCategoryType.Planet ? ' Planet' : it.category === HabitatCategoryType.Moon ? ' Moon'
            : it.category === HabitatCategoryType.Asteroid ? ' Asteroid' : it.category === HabitatCategoryType.Star ? ' Star' : '';
        return `${words}${cat}`.trim();
    }
    return creatureVariantName(it) ?? 'Creature';
}

export class MainView {
    world = new Container();
    fx = new Container();
    /** Task 08g: thin selection ring around the picked object (screen-space). */
    selectionRing = new Graphics();
    /** Left-drag box selection (boxSelect.ts): the thin screen-space rectangle while the left button drags. */
    private selectionBox = new Graphics();
    /** Rings around each ship of a multi-selection (selectedBuiltObjects), redrawn every frame. */
    private multiSelectionRings = new Graphics();
    /** Dashed yellow hyperjump range rings (45% / 100% of current fuel) for the selected ship / fleet. */
    private rangeRingsG = new Graphics();
    private backdrop: Sprite;
    private grid = new Graphics();
    /** Screen-space deep starfield behind the world (deepStarfield.ts; port of the original's close-zoom stars). */
    private deepStarfield!: DeepStarfield;
    /** Systems for the deep starfield's per-system colour patches (flat, reused every frame). */
    private patchSystems: PatchSystem[] = [];
    /** Coloured per-system nebula haze at system zoom (systemNebula.ts), world-space just below the system roots. */
    private systemNebulae!: SystemNebulaLayer;
    private nebulaSystems: NebulaSystem[] = [];
    /** Region-name label layer (task 08f1), screen-space. */
    regionLabels = new Container();
    private regionLabelViews: RegionLabel[] = [];
    systems: SystemView[] = [];
    /** Every SystemView root, in galaxy order; only the on-screen ones are attached (renderGroups.ts AttachedChildren). */
    readonly systemLayer = new AttachedChildren(new Container());
    clouds: CloudView[] = [];
    /** Task 08f2: nebula cloud images, world-space between backdrop and stars. */
    nebulae: NebulaView[] = [];
    /** Task M2e: empire ownership overlays (colony rings, markers, territory). */
    private empireLayer!: EmpireLayer;
    /** Task M3: the Overlays HUD toggles this renderer implements (potential
     * colonies, scenic/research markers, empire territory visibility). */
    private overlayLayer!: OverlayLayer;
    /** The HUD selection (main.ts sets it): the selected ship / fleet gets its travel vector drawn (overlayLayer.ts). */
    getHudSelection: () => { builtObject?: BuiltObject; shipGroup?: ShipGroup } | null = () => null;
    /** [galaxymarkers] faction rings, ship/base symbols, fleet icons, name decorations, station-presence discs. */
    galaxyMarkers: GalaxyMarkerLayer | null = null;
    /** [galaxymarkers] a fleet icon click, or a double click on one of the player's fleet ships, selects the fleet. */
    onShipGroupSelect?: (g: ShipGroup) => void;
    /** [19r] threat markers, league presence, wreck debris, herder camps (render-only map extras). */
    artBundleLayer!: ArtBundleLayer;
    /** [19r] capture gallery (dev flag ?artGallery=<view>). */
    private artGallery: ArtBundleGallery | null = null;
    /** Task 13a: ships, bases, pirates and traders (BuiltObjects). */
    private builtObjectLayer!: BuiltObjectLayer;
    // [ambientfx] begin
    /** Engine exhaust, navigation lights, mining/construction animations, planetary shields. */
    private ambientLayer!: AmbientLayer;
    // [ambientfx] end
    // [fightersfx] begin
    private fighterLayer!: FighterLayer;
    // [fightersfx] end
    // [rimatmo] begin
    /** 19i rim atmosphere (scenario flag `rimAtmosphere`); inert when the flag is off. */
    private rimLayer: RimAtmosphereLayer | null = null;
    // [rimatmo] end
    /** Space creatures (Kaltor, slugs, Ardilus, SilverMist) of the viewed system. */
    private creatureLayer!: CreatureLayer;
    /** Art pilot (dev flag ?whalePilot=1): render-only void-whale prototypes next to an original Kaltor. */
    whalePilot: WhalePilotLayer | null = null; // [whalepilot]
    private textures!: MainViewTextures;
    private minZoom = 1e-6;
    private lastGridZoom = -1;
    /** Screen x, y pairs of the system labels kept this frame (reused). */
    private keptLabels: number[] = [];
    /** Last parameters the selection ring was drawn with (redrawn only on change). */
    private selectionKey = new DrawKey();
    private dragging = false;
    private lastPointer = { x: 0, y: 0 };
    private lastDragX = 0;
    private lastDragY = 0;
    private pointerInside = false;
    /** Task 12k: debounce timer for the hover tooltip pick. */
    private tooltipTimer: number | undefined;
    /** Elapsed seconds since boot (disc rotation / corona frame clock). */
    private elapsedSeconds = 0;
    private lastUpdateMs = -1;
    /** Render interpolation between sim steps: this frame's render time (from the sim loop; without one — tests, a
     * view with no loop — the committed state is drawn: alpha 0, renderNowMs = galaxy.nowMs) and the per-object
     * previous/current step positions shared by every layer that draws a moving object. Render-only. */
    renderTime: RenderTime = createRenderTime();
    readonly motion = new MotionInterpolator();
    /** Render-side index of the live built objects, refreshed per sim step (builtObjectIndex.ts). */
    readonly builtObjectIndex = new BuiltObjectIndex();
    /** Follow camera (task followcam): shared with the HUD's selection-panel toggle (src/ui/hud.ts) and its
     * followOnSelectionChanged call. Recentred on the followed ship/fleet every frame in update(); cleared here
     * on a manual drag/edge-scroll/map-click or target loss, and by keyboard.ts on a keyboard scroll. */
    readonly followState: FollowState = createFollowState();
    /** Task 08g: set by main.ts — receives the habitat picked on left click. */
    onSelectionChange?: (h: Habitat | null) => void;
    /** Task 13d: set by main.ts — receives the ship/base picked on left click. */
    onBuiltObjectSelect?: (bo: BuiltObject) => void;
    /** Set by main.ts — receives the creature picked on left click. */
    onCreatureSelect?: (c: Creature) => void;
    /** Set by main.ts — receives the ships a drag box / Shift-click selects when there are several (BuiltObjectList). */
    onBuiltObjectListSelect?: (list: BuiltObject[]) => void;
    /** Set by main.ts — the current selection as ships (the list, the one selected ship, else null): the base a
     * Shift/Ctrl drag adds to and a Shift-click toggles in (a fleet / habitat / creature selection is null). */
    getSelectedShips?: () => BuiltObject | BuiltObject[] | null;
    /** Task 08g: set by main.ts — star double-clicked at galaxy/sector zoom. */
    onDoubleClickStar?: (h: Habitat) => void;
    // [ordermenu] begin
    /** 17c: a right click without drag (< 4 px between down and up); replaces the default centre-on-click. */
    onRightClick?: (sx: number, sy: number, e: MouseEvent) => void;
    /** 17c: a left click the order layer consumes (fleet attack point / home base pick); return true to skip selection. */
    onLeftClickIntercept?: (sx: number, sy: number) => boolean;
    /** 17c: the pointer rested on the map (debounced like the hover tooltip). */
    onPointerRest?: (sx: number, sy: number, clientX: number, clientY: number) => void;
    // [ordermenu] end

    /** Task M3: map overlay toggle state (src/ui/mapOverlays.ts), shared
     * with the HUD's options list. Defaults to a fresh state so existing
     * callers that only pass the first four constructor args keep working. */
    constructor(
        readonly app: Application,
        readonly camera: Camera,
        readonly galaxy: Galaxy,
        readonly store: AssetStore,
        private overlays: MapOverlayState = createMapOverlayState(),
    ) {
        installGlParameterCache(app.renderer); // texture set-up must not wait on the GPU (glParamCache.ts)
        // Nothing in the map takes Pixi pointer events (picking is MainView.pick on the camera): keep Pixi's EventSystem
        // from hit-testing the whole world / overlay scene graph on every wheel and pointer-move event.
        this.world.eventMode = 'none';
        this.fx.eventMode = 'none';
        app.stage.addChild(this.world);
        app.stage.addChild(this.fx);
        this.world.addChild(this.grid);
        this.backdrop = new Sprite(Texture.EMPTY);
        this.world.addChildAt(this.backdrop, 0);
        this.selectionRing.visible = false;
        this.fx.addChild(this.selectionRing);
        this.multiSelectionRings.visible = false;
        this.fx.addChild(this.rangeRingsG);
        this.fx.addChild(this.multiSelectionRings);
        this.selectionBox.visible = false;
        this.fx.addChild(this.selectionBox);
    }

    /** Task 08g: the habitat currently selected in the Main View (null = none). */
    selectedHabitat: Habitat | null = null;
    /** Task 13d: the ship/base currently selected in the Main View (null = none). */
    selectedBuiltObject: BuiltObject | null = null;
    /** The ships of a multi-selection (BuiltObjectList, 2+ ships; null = none) — each gets a selection ring. */
    selectedBuiltObjects: BuiltObject[] | null = null;
    /** The creature currently selected in the Main View (null = none). */
    selectedCreature: Creature | null = null;

    /** Drawn on-screen size of a habitat at the current zoom — the same size
     * functions the renderer uses (planets >= 14 px, moons >= 7 px, star
     * sprite >= 40 px via planetSpritePx/moonDotPx/starSpritePx). */
    private drawnSize(h: Habitat, z: number): number {
        if (h.category === HabitatCategoryType.Star) {
            return starDrawnPx(h, z);
        }
        if (h.category === HabitatCategoryType.Moon) {
            return moonDotPx(h.diameter, z);
        }
        if (h.category === HabitatCategoryType.Planet) {
            return planetSpritePx(h.diameter, z);
        }
        if (h.category === HabitatCategoryType.Asteroid) {
            return z > ROCK_MIN_ZOOM ? asteroidDrawnPx(h.diameter, z) : 0;
        }
        // Gas clouds are not pickable.
        return 0;
    }

    /**
     * Task 08g (Controls/MainView.cs mouse picking): the habitat drawn under
     * the given screen point. At system/planet zoom prefer planets/moons whose
     * drawn sprite rect contains the point (same size functions as the
     * renderer), then the star; at galaxy/sector zoom pick the nearest star
     * within 12 px of the cursor. Ties go to the smaller object.
     */
    pick(screenX: number, screenY: number): Habitat | null {
        const cam = this.camera;
        const w = cam.screenToWorld(screenX, screenY);
        const z = cam.zoom;
        const bodiesDrawn = 1 / z < 500; // planets / moons are drawn while f < 500
        // Hit the planets / moons where they are drawn (render-interpolated orbit at the last frame's render time).
        const drawnAt = (h: Habitat): { x: number; y: number } => this.motion.positionOf(h);
        const size = (h: Habitat, zz: number): number => this.drawnSize(h, zz);
        // Pick order (smaller drawn art wins): moons, planets, then stars.
        if (bodiesDrawn) {
            // Fog of war (Main.Part10.cs 1291 / Main.Part7.cs 3489): the bodies of a system the player has not explored
            // can't be hovered or selected (they are not even drawn, see SystemView.updateFog).
            const fog = fogOf(this.galaxy);
            const bodies: Habitat[] = [];
            for (const sv of this.systems) {
                if (!fog.habitatInfo(sv.system.systemStar)) continue;
                for (const p of sv.planets) {
                    bodies.push(p.habitat);
                    for (const moon of p.moons) {
                        bodies.push(moon.habitat);
                    }
                }
            }
            // Asteroid rocks first (smaller art wins over planets / moons / stars): where the rock is drawn, at least 6 px.
            const rocks: Habitat[] = [];
            for (const sv of this.systems) {
                if (!fog.habitatInfo(sv.system.systemStar)) continue;
                for (const r of sv.rockHabitats) if (fog.habitatDrawn(r)) rocks.push(r);
            }
            const rock = hitTestHabitats(rocks, w.x, w.y, size, z, drawnAt);
            if (rock !== null) return rock;
            const hit = hitTestHabitats(bodies, w.x, w.y, size, z, drawnAt);
            if (hit !== null) {
                return hit;
            }
        }
        // Stars: their drawn art, at least 12 px radius (the old galaxy-zoom pick reach).
        const stars = this.systems.map((sv) => sv.system.systemStar);
        return hitTestHabitats(stars, w.x, w.y, size, z, drawnAt, 12);
    }

    /** Task 13d (Main.Part11.cs method_145): the ship/base under the screen point. Ships win over habitats. */
    pickBuiltObject(screenX: number, screenY: number): BuiltObject | null {
        const w = this.camera.screenToWorld(screenX, screenY);
        const bo = this.builtObjectLayer.pick(w.x, w.y, 1 / this.camera.zoom, this.galaxy.playerEmpire);
        // [galaxymarkers] beyond the ship art (galaxy/sector zoom) the drawn symbols / fleet icons are the pick targets.
        return bo ?? this.galaxyMarkers?.pickAt(w.x, w.y, this.camera.zoom)?.bo ?? null;
    }

    /** Main.Part11.cs method_145 (f <= 100): the creature under the screen point. Creatures win over ships. */
    pickCreature(screenX: number, screenY: number): Creature | null {
        const w = this.camera.screenToWorld(screenX, screenY);
        return this.creatureLayer.pick(w.x, w.y, 1 / this.camera.zoom);
    }

    /** Set while a right click chosen from the stacked-object popup is replayed: pickOrderTarget returns it. */
    private pickOverride: unknown = undefined;

    /**
     * Stacked-object popup: every pickable ship / base / creature / planet / moon / star whose drawn art covers the
     * screen point (system zoom and closer; galaxy-zoom symbols keep the single pick). Fog / visibility are those of
     * the single pickers. Smallest drawn object first.
     */
    pickAllAt(screenX: number, screenY: number): PickHit<Creature | BuiltObject | Habitat>[] {
        const z = this.camera.zoom;
        const f = 1 / z;
        if (f > 100) return [];
        const w = this.camera.screenToWorld(screenX, screenY);
        const cands: PickCandidate<Creature | BuiltObject | Habitat>[] = [
            ...this.creatureLayer.pickCandidates(w.x, w.y, f),
            ...this.builtObjectLayer.pickCandidates(f),
        ];
        const fog = fogOf(this.galaxy);
        const add = (h: Habitat, kind: PickCandidate<Habitat>['kind']): void => {
            const p = this.motion.positionOf(h);
            cands.push({ item: h, kind, x: p.x, y: p.y, sizePx: this.drawnSize(h, z) });
        };
        for (const sv of this.systems) {
            const star = sv.system.systemStar;
            if (!fog.habitatInfo(star)) continue;
            add(star, 'star');
            for (const p of sv.planets) {
                add(p.habitat, 'planet');
                for (const moon of p.moons) add(moon.habitat, 'moon');
            }
        }
        return collectHitsUnderPoint(cands, w.x, w.y, z, 6, PICK_MENU_MAX_ROWS * 4);
    }

    /** Popup rows for a stack of hits: icon, name, owner; `choose` runs with the picked object. */
    private pickMenuEntries(hits: readonly PickHit<Creature | BuiltObject | Habitat>[], choose: (item: Creature | BuiltObject | Habitat) => void): PickMenuEntry[] {
        const icons = { creature: '!', ship: '>', base: '#', moon: 'o', planet: 'O', star: '*', other: '?' } as const;
        return hits.map((h) => {
            const it = h.item;
            const owner = it instanceof BuiltObject || it instanceof Habitat ? (it.empire?.name ?? '') : '';
            const type = pickTypeLabel(it);
            const name = it.name !== '' ? it.name : type !== '' ? type : h.kind;
            return { icon: icons[h.kind], name, type: it.name !== '' ? type : '', owner, onPick: () => choose(it) };
        });
    }

    /** Open the stacked-object popup when 2+ objects lie under the point; false (nothing opened) otherwise. */
    private tryPickMenu(sx: number, sy: number, clientX: number, clientY: number, choose: (item: Creature | BuiltObject | Habitat) => void): boolean {
        const hits = this.pickAllAt(sx, sy);
        if (!needsPickMenu(hits)) return false;
        openPickMenu(this.pickMenuEntries(hits.slice(0, PICK_MENU_MAX_ROWS * 4), choose), clientX, clientY);
        return true;
    }

    /** Select a specific object picked from the popup (same effects as a left click on it). */
    private selectPicked(item: Creature | BuiltObject | Habitat): void {
        playGridClick(); // [audio]
        if (item instanceof BuiltObject) {
            this.selectedCreature = null;
            this.selectedHabitat = null;
            this.selectedBuiltObject = item;
            this.onBuiltObjectSelect?.(item);
        } else if (item instanceof Habitat) {
            this.selectedCreature = null;
            this.selectedBuiltObject = null;
            this.selectedHabitat = item;
            this.onSelectionChange?.(item);
        } else {
            this.selectedHabitat = null;
            this.selectedBuiltObject = null;
            this.selectedCreature = item;
            this.onCreatureSelect?.(item);
        }
    }

    // [ordermenu] begin
    /** 17c: double_0, the zoom as galaxy units per screen pixel (> 100: sector / galaxy level). */
    get zoomFactor(): number {
        return 1 / this.camera.zoom;
    }

    /**
     * 17c: Main.Part11.cs 1330 method_143 (the object under a screen point) from the renderer's pickers: a ship / base
     * (its fleet when it leads one at zoom factor > 100), else the habitat drawn there — its SystemInfo when it is a
     * star picked at zoom factor > 100 — else null.
     * TODO(port): method_145's exact radii (fleet lead ship within 10 px scaled, systems within their dominant empire's
     * strategic radius) and creature picking; this reuses the 13d / 08g pickers.
     */
    pickOrderTarget(sx: number, sy: number): unknown {
        if (this.pickOverride !== undefined) return this.pickOverride; // chosen from the stacked-object popup
        const f = this.zoomFactor;
        // Main.Part11.cs 1501-1554: at f <= 100 a creature under the point is returned before any ship (Main.Part8.cs
        // 2751 / 3082 / 3289 then offer "Attack X" on it).
        const creature = this.pickCreature(sx, sy);
        if (creature !== null) return creature;
        const bo = this.pickBuiltObject(sx, sy);
        if (bo !== null) {
            const g = bo.shipGroup as { leadShip?: BuiltObject | null } | null;
            if (f > 100 && g !== null && g !== undefined && g.leadShip === bo) return g;
            return bo;
        }
        const h = this.pick(sx, sy);
        if (h === null) return null;
        if (f > 100 && h.category === HabitatCategoryType.Star) {
            return this.galaxy.systems.find((s) => s.systemStar === h) ?? h;
        }
        return h;
    }
    // [ordermenu] end

    /** Load textures, build all scene objects, attach input handlers. */
    async init(): Promise<void> {
        const store = this.store;
        // Task 08f3: wait for the 'Forgotten Futurist' web font BEFORE any
        // map Text object is built below (system/planet labels are created
        // in SystemView's constructor), so they rasterize in the real font.
        await loadMapFont();
        // If the font finishes loading later (or was created earlier by a
        // caller that skipped the wait), force every label to re-render in
        // it once document.fonts settles.
        void document.fonts.ready
            .then(() => {
                for (const sv of this.systems) {
                    sv.nameLabel.style.fontFamily = MAP_FONT_FAMILY;
                    for (const planet of sv.planets) {
                        planet.label.style.fontFamily = MAP_FONT_FAMILY;
                    }
                }
                for (const rl of this.regionLabelViews) {
                    rl.text.style.fontFamily = MAP_FONT_FAMILY;
                }
            })
            .catch(() => undefined);
        // Only the backdrop is preloaded up front; star map icons, star
        // sprites, planet sprites, rocks and gas clouds all load lazily
        // below, per habitat pictureRef (task 01).
        const loaded = await store.preload([['backdrop', BACKDROP_URLS, makeBackdropTexture]]);

        const textures: MainViewTextures = {
            dots: new Map(),
            dot: makeDotTexture('#cccccc'),
            rock: makeDotTexture('#8a7f6a', 32),
            backdrop: loaded.get('backdrop')!,
        };
        // Planet-type dot textures.
        for (const t of PLANET_DOT_TYPES) {
            textures.dots.set(t, makeDotTexture(PLANET_COLORS[t] ?? '#888888'));
        }
        this.textures = textures;

        // Backdrop: stretched over the galaxy bounds, world-space.
        this.backdrop.texture = textures.backdrop;
        this.backdrop.scale.set(this.galaxy.sizeX / textures.backdrop.width, this.galaxy.sizeY / textures.backdrop.height);
        this.minZoom = this.camera.minZoom;

        // Sector grid (world-space lines every sectorSize units).
        this.drawGrid(this.camera.zoom);

        // Deep starfield (screen-space, behind the world): sharp flare sprites at the renderer's device
        // resolution — the galaxy backdrop is a 2000 px image and cannot stay sharp when magnified (HiDPI fix).
        this.deepStarfield = new DeepStarfield(this.galaxy.randomSeed);
        this.app.stage.addChildAt(this.deepStarfield.root, 0);
        const flareFiles = manifestFiles('mapstars/flares') ?? [];
        void this.deepStarfield
            .load(
                flareFiles.map((f) => `/assets/dwu/images/environment/mapstars/flares/${f}`),
                async (url) => {
                    if (!store.dwuPresent) return null;
                    const tex = await store.loadFirst([url], () => Texture.EMPTY);
                    const res = tex === Texture.EMPTY ? null : (tex.source.resource as CanvasImageSource | undefined);
                    return res ?? null;
                },
            )
            .catch(() => undefined);

        // Systems and gas clouds. The system roots sit in one container (attached only while on screen) where they
        // used to be among world's children, so draw order is unchanged.
        this.world.addChild(this.systemLayer.root);
        for (const system of this.galaxy.systems) {
            // Gas clouds are SystemInfos too (C# / task C2c-1); they are drawn as clouds below.
            if (system.systemStar.category === HabitatCategoryType.GasCloud) continue;
            this.systems.push(new SystemView(this, system, textures));
        }
        for (const sv of this.systems) {
            const star = sv.system.systemStar;
            // Planetless systems still get a sky patch the size of a small system.
            this.patchSystems.push({ index: this.galaxy.systems.indexOf(sv.system), x: star.xpos, y: star.ypos, radius: Math.max(sv.maxExtent, 30000) });
            this.nebulaSystems.push({
                index: this.galaxy.systems.indexOf(sv.system),
                x: star.xpos,
                y: star.ypos,
                radius: Math.max(sv.maxExtent, 20000),
                // MainView.cs method_42 call site: no system nebula around black holes / supernovae.
                enabled: star.type !== HabitatType.BlackHole && star.type !== HabitatType.SuperNova,
            });
        }
        // Behind every system root (orbits, planets, stars), above the backdrop / galaxy nebulae / grid.
        this.systemNebulae = new SystemNebulaLayer(this.galaxy.randomSeed, this.app.renderer.resolution, this.app.renderer);
        this.world.addChildAt(this.systemNebulae.root, this.world.getChildIndex(this.systemLayer.root));
        for (const habitat of this.galaxy.habitats) {
            if (habitat.category === HabitatCategoryType.GasCloud) {
                // Generated fallback; the original art loads lazily below.
                this.clouds.push(new CloudView(this, habitat, makeCloudTexture(CLOUD_COLORS[habitat.type] ?? '#88aaff')));
            }
        }

        // Lazy per-habitat sprite loading (pictureRef-selected art).
        const lazyLoads: Promise<unknown>[] = [];
        for (const sv of this.systems) {
            const star = sv.system.systemStar;
            lazyLoads.push(
                store
                    .loadFirst(mapStarUrls(star), () => makeGlowTexture(starColors(star.type).glow, starColors(star.type).core))
                    .then((tex) => {
                        sv.mapIcon.texture = tex;
                    }),
            );
            lazyLoads.push(
                store.loadFirst(starSpriteUrls(star), () => makeStarSpriteTexture(star.type)).then((tex) => {
                    sv.starSprite.texture = tex;
                }),
            );
            for (const planet of sv.planets) {
                lazyLoads.push(
                    store
                        .loadFirst(planetUrls(planet.habitat), () => makePlanetTexture(PLANET_COLORS[planet.habitat.type] ?? '#888888'))
                        .then((tex) => {
                            planet.sprite.texture = tex;
                        }),
                );
                // Task 12p: moons use per-habitat planet art too.
                for (const moon of planet.moons) {
                    lazyLoads.push(
                        store
                            .loadFirst(planetUrls(moon.habitat), () => makePlanetTexture(PLANET_COLORS[moon.habitat.type] ?? '#888888'))
                            .then((tex) => {
                                moon.dot.texture = tex;
                            }),
                    );
                }
            }
            for (let i = 0; i < sv.asteroids.length; i++) {
                const rock = sv.asteroids[i];
                const h = sv.rockHabitats[i];
                lazyLoads.push(
                    store
                        .loadFirst(asteroidUrls(h), () => this.textures.rock)
                        .then((tex) => {
                            rock.texture = tex;
                            rock.scale.set((h.diameter * 0.45) / tex.width);
                        }),
                );
            }
        }
        for (const cloud of this.clouds) {
            lazyLoads.push(
                store
                    .loadFirst(cloudUrls(cloud.cloud), () => makeCloudTexture(CLOUD_COLORS[cloud.cloud.type] ?? '#88aaff'))
                    .then((tex) => {
                        cloud.sprite.texture = tex;
                    }),
            );
        }
        await Promise.all(lazyLoads);

        // Task 08f1: region/nebula location name labels (screen-space layer).
        // All locations are treated as known to the empire for now.
        for (const location of this.galaxy.galaxyLocations) {
            this.regionLabelViews.push(new RegionLabel(location, this.regionLabels));
        }
        this.fx.addChild(this.regionLabels);

        // Task 08f2: nebula cloud images over each NebulaCloud location rect,
        // in world space between the backdrop and the map stars.
        for (const location of this.galaxy.galaxyLocations) {
            if (location.type === GalaxyLocationType.NebulaCloud) {
                const nv = new NebulaView(this, location);
                this.nebulae.push(nv);
                this.world.addChildAt(nv.sprite, 1); // just above the backdrop
            }
        }

        // [rimatmo] begin
        // 19i: rim wash / derelicts / eyes in the dark just above the backdrop + nebulae, murk above the systems
        // (before the empire and ship layers are added), vignette + grain above the starfield. Adds nothing with the
        // flag off.
        this.rimLayer = new RimAtmosphereLayer(this.galaxy, this.store);
        this.rimLayer.mount({
            world: this.world,
            fx: this.fx,
            backgroundIndex: 1 + this.nebulae.length,
            starfieldFar: this.deepStarfield.far,
            starfieldNear: this.deepStarfield.near,
            fxIndex: 0,
            nebulae: this.nebulae.map((nv) => ({ sprite: nv.sprite, x: nv.sprite.x, y: nv.sprite.y })),
            mapIcons: this.systems.map((sv) => ({ sprite: sv.mapIcon, x: sv.system.systemStar.xpos, y: sv.system.systemStar.ypos })),
        });
        // [rimatmo] end

        // [rimatmo-wiring] begin
        // 19i data/wiring: item 11 rim name overrides + the per-system weight state item 12's message remap reads.
        // No-op with the flag off (installRimAtmosphereData short-circuits when rimParams(galaxy) is null).
        installRimAtmosphereData(this.galaxy);
        // [rimatmo-wiring] end

        // Task M2e: empire ownership overlays. The layer's root is added to
        // world after all system roots, so rings/discs draw on top of stars.
        this.empireLayer = new EmpireLayer(this.galaxy, this.world);
        // Task M3: potential-colonies/scenic/research markers + the Empire
        // Territory toggle. Added after empireLayer so its yellow marker
        // rings draw above the territory discs and colony rings.
        this.overlayLayer = new OverlayLayer(this.galaxy, this.world, this.empireLayer, this.overlays);
        this.galaxyMarkers = new GalaxyMarkerLayer(this.galaxy, this.world, this.overlays, this.empireLayer.root); // [galaxymarkers]
        this.galaxyMarkers.shipPxOf = (bo) => this.builtObjectLayer.drawnSizePx(bo); // [galaxymarkers]
        // [galaxymarkers] symbols (and so their pick boxes) follow the render-interpolated ship: BuiltObjectLayer's
        // sample this frame, else (galaxy / sector zoom, where the ship art is not drawn) a sample taken here.
        this.galaxyMarkers.positionOf = (bo) => drawnBuiltObjectPos(this.motion, bo);
        this.galaxyMarkers.drawnOffsetBound = (bo) => builtObjectDrawnOffsetBound(this.motion, bo);
        this.galaxyMarkers.index = this.builtObjectIndex;
        // Task 13a: ships/bases/pirates/traders on top of all map layers.
        this.builtObjectLayer = new BuiltObjectLayer(this.galaxy, this.world, this.store, this.overlays);
        // [ambientfx] begin
        this.ambientLayer = new AmbientLayer(this.galaxy, this.world, this.builtObjectLayer.root, this.store, (h, zz) => this.drawnSize(h, zz));
        // [ambientfx] end
        // [rimatmo] begin
        this.ambientLayer.lightScale = this.rimLayer.lightScale;
        // [rimatmo] end
        // [fightersfx] begin
        // Launched fighters / bombers above the ships and their ambient effects, below the combat effects.
        this.fighterLayer = new FighterLayer(this.galaxy, this.world, this.store);
        // MainView.1.cs 1559: creatures are drawn after the ships and fighters.
        this.creatureLayer = new CreatureLayer(this.galaxy, this.world, this.store.dwuPresent);
        // Render interpolation between sim steps: the layers drawing moving objects share one interpolator.
        this.builtObjectLayer.motion = this.motion;
        this.builtObjectLayer.index = this.builtObjectIndex;
        registerBuiltObjectIndex(this.galaxy, this.builtObjectIndex);
        this.overlayLayer.motion = this.motion;
        this.overlayLayer.getSelection = () => this.getHudSelection();
        this.empireLayer.motion = this.motion;
        this.ambientLayer.motion = this.motion;
        this.ambientLayer.index = this.builtObjectIndex;
        this.fighterLayer.motion = this.motion;
        this.creatureLayer.motion = this.motion;
        if (typeof window !== 'undefined') {
            const q = new URLSearchParams(window.location.search);
            this.creatureLayer.godMode = q.get('godMode') === '1';
            // Dev toggle: `?reveal=1` (or `?godMode=1`, the original's GodMode) turns the fog of war (fog.ts) off.
            fogOf(this.galaxy).reveal = q.get('reveal') === '1' || q.get('godMode') === '1';
        }
        // [fightersfx] end
        // [19r] map-level art-bundle extras above the ships / fighters / creatures.
        this.artBundleLayer = new ArtBundleLayer(this.galaxy, this.world, (bo) => this.builtObjectLayer.drawnSizePx(bo));
        this.artBundleLayer.motion = this.motion;
        const artView = typeof window !== 'undefined' ? artGalleryView(window.location.search) : null;
        if (artView !== null) {
            this.artGallery = new ArtBundleGallery(this.galaxy, this.app.stage, this.app.screen.width, this.app.screen.height, artView);
            (window as unknown as { __artGallery?: unknown }).__artGallery = this.artGallery;
        }
        // [newfauna] begin — render-only capture gallery, no-op unless the URL carries ?faunaGallery=1
        if (typeof window !== 'undefined' && faunaGalleryEnabled(window.location.search)) {
            const gallery = new FaunaGallery(this.galaxy, this.world, this.camera, window.location.search);
            this.creatureLayer.gallery = gallery;
            (window as unknown as { __faunaGallery?: unknown }).__faunaGallery = { gallery, layer: this.creatureLayer };
        }
        // [newfauna] end
        // [whalepilot] begin — no-op unless the URL carries ?whalePilot=1
        if (typeof window !== 'undefined' && whalePilotEnabled(window.location.search)) {
            this.whalePilot = new WhalePilotLayer(this.galaxy, this.world, this.camera, window.location.search, this.store.dwuPresent);
            this.whalePilot.motion = this.motion;
        }
        // [whalepilot] end

        this.attachInput();
    }

    /** Per-frame update: camera transform + per-layer level of detail. */
    /** Draw one frame. `renderTime` is the sim loop's render-interpolation sample (simLoop.ts SimLoop.renderTime);
     * without it the committed sim state is drawn (alpha 0). */
    update(renderTime?: RenderTime): void {
        const cam = this.camera;
        const z = cam.zoom;
        const m = this.minZoom;

        // Render interpolation between sim steps (renderInterp.ts): read-only on the sim.
        const rt = this.renderTime;
        if (renderTime !== undefined) {
            rt.alpha = renderTime.alpha;
            rt.stepGameMs = renderTime.stepGameMs;
            rt.renderNowMs = renderTime.renderNowMs;
            rt.stepSerial = renderTime.stepSerial;
            rt.simNowMs = renderTime.simNowMs;
        } else {
            rt.alpha = 0;
            rt.stepGameMs = 0;
            rt.renderNowMs = this.galaxy.nowMs;
            rt.stepSerial = this.galaxy.scheduler?.frames ?? 0;
            rt.simNowMs = this.galaxy.nowMs;
        }
        this.motion.begin(rt, habitatTouchClampSeconds(this.galaxy.habitats.length), this.galaxy.builtObjects.length, this.galaxy.creatures.length, this.galaxy.habitats.length);
        this.builtObjectIndex.update(this.galaxy, this.motion);
        fogOf(this.galaxy).begin(); // the player's per-frame visibility answers (fog.ts)

        // Frame delta for the animated star discs/corona (task 02c2).
        const nowMs = performance.now();
        const dtSeconds = this.lastUpdateMs < 0 ? 0 : Math.max(0, (nowMs - this.lastUpdateMs) / 1000);
        this.lastUpdateMs = nowMs;
        this.elapsedSeconds += dtSeconds;

        this.world.scale.set(z);
        this.world.x = cam.width / 2 - cam.x * z;
        this.world.y = cam.height / 2 - cam.y * z;

        // Galaxy backdrop: bright at full-galaxy zoom, fading out as the
        // sector view takes over (MainView.1.cs FadeGalaxyBackground).
        const bdA = backdropAlpha(z, m);
        this.backdrop.alpha = bdA;
        this.backdrop.visible = bdA > 0.01;

        // Faint sector grid: fades in over the galaxy zoom, out at mid zoom
        // (MainView.1.cs FadeSectorBackground).
        const gridA = fadeIn(z, m * 2, m * 6) * fadeOut(z, 0.004, 0.015);
        this.grid.alpha = gridA;
        this.grid.visible = gridA > 0.01;
        if (this.grid.visible && (this.lastGridZoom < 0 || Math.abs(z / this.lastGridZoom - 1) > 0.05)) {
            this.drawGrid(z);
            this.lastGridZoom = z;
        }

        // Deep parallax starfield: fades in over the same window the backdrop
        // fades out (task 02b2), so something is always visible while
        // zooming between galaxy and system view; the per-system colour
        // patches follow once the backdrop is gone.
        this.applyDisplaySettings(); // [gameoptions] Star Density, system nebulae on / detail
        this.deepStarfield.update(deepStarfieldAlpha(z, m), cam.x, cam.y, z, cam.width, cam.height);
        this.deepStarfield.updatePatches(systemPatchZoomAlpha(z, m), this.patchSystems, cam.x, cam.y, cam.width, cam.height);
        this.systemNebulae.update(z, cam.x, cam.y, cam.width, cam.height, this.nebulaSystems, nowMs);

        // Systems: greedy 80 px label-overlap suppression across systems.
        const labelZoom = m * 4; // system names appear at ~sector zoom
        // Task 10f: the "Show system names" setting disables them entirely.
        const namesOn = z > labelZoom && showSystemNames();
        // Kept label positions as flat x, y pairs (reused across frames: no per-frame allocation).
        const kept = this.keptLabels;
        kept.length = 0;
        const halfViewW = cam.width / 2;
        const halfViewH = cam.height / 2;
        for (const sv of this.systems) {
            // Pre-cull: the systems that take part in the greedy label pass below (unchanged, so the same labels
            // are kept); SystemView.update then culls exactly by what the system draws.
            const star = sv.system.systemStar;
            if (!systemInView(star.xpos, star.ypos, sv.maxExtent, cam.x, cam.y, cam.width, cam.height, z, 400)) {
                sv.root.visible = false;
                this.systemLayer.set(sv.root, false);
                continue;
            }
            // Decide label visibility greedily (min 80 px between labels).
            let allow = namesOn;
            if (allow) {
                // Camera.worldToScreen, inlined.
                const sx = (star.xpos - cam.x) * z + halfViewW;
                const sy = (star.ypos - cam.y) * z + halfViewH;
                for (let i = 0; i < kept.length; i += 2) {
                    const dx = kept[i] - sx;
                    const dy = kept[i + 1] - sy;
                    if (dx * dx + dy * dy < 80 * 80) {
                        allow = false;
                        break;
                    }
                }
                if (allow) {
                    kept.push(sx, sy);
                }
            }
            sv.update(z, cam, allow, dtSeconds);
        }
        this.systemLayer.flush();
        for (const cloud of this.clouds) {
            cloud.update(z, cam);
        }

        // Task 08f2: nebula clouds fade out over the same window the backdrop
        // fades out (FadeGalaxyNebulae), so they are fully visible at
        // galaxy/sector zoom and gone by system zoom.
        const nebA = nebulaAlpha(z, m);
        for (const nv of this.nebulae) {
            nv.update(z, cam, nebA);
        }
        // [rimatmo] begin
        this.rimLayer?.update(z, cam, bdA);
        // [rimatmo] end

        // Task 13a: built objects (ships, bases, pirates, traders). Updated first among the object layers (draw order is
        // the container order, not this one): it samples the render-interpolated ship positions (this.motion) that the
        // overlays, ambient effects, selection ring, etc. read later this frame.
        this.builtObjectLayer.update(z, cam);
        // Task M2e: empire ownership overlays (colony rings at system zoom;
        // owned-system markers + territory discs at galaxy/sector zoom).
        this.empireLayer.update(z, cam);
        // Task M3: potential-colonies/scenic/research markers (Empire
        // Territory's visibility toggle is applied straight to empireLayer,
        // above).
        this.overlayLayer.update(z, cam);
        this.galaxyMarkers?.update(z, cam, this.systems); // [galaxymarkers]
        // [ambientfx] begin
        this.ambientLayer.update(z, cam);
        // [ambientfx] end
        // [fightersfx] begin
        this.fighterLayer.update(z, cam);
        // [fightersfx] end
        this.creatureLayer.update(z, cam);
        this.artBundleLayer.update(z, cam); // [19r]
        this.artGallery?.update(); // [19r]
        this.whalePilot?.update(z, cam); // [whalepilot]
        // [combatfx] begin
        // Combat effects (weapon fire, explosions, shield strikes, hyperjump flashes) above the ships.
        updateCombatEffects(this.galaxy, this.world, this.store, this.builtObjectLayer, z, cam);
        // [combatfx] end

        // Region/nebula location name labels (task 08f1): visible while the
        // original's zoom factor double_15 satisfies 70 < double_15 <=
        // double_5 (the full-galaxy factor = 1/minZoom). Task 10f: the
        // "Show region labels" setting hides the whole layer.
        const showRegions = showRegionLabels();
        this.regionLabels.visible = showRegions;
        if (showRegions) {
            const factor = 1 / z;
            const maxFactor = 1 / m;
            for (const rl of this.regionLabelViews) {
                rl.update(cam, factor, maxFactor);
            }
        }

        // Task 08g / 13d: keep the selection ring around the selected habitat or ship.
        const selBo = this.selectedBuiltObject;
        const sel = this.selectedHabitat;
        const selC = this.selectedCreature;
        if (selC !== null) {
            // MainView.1.cs 1717-1720 method_212: a circle over the box 1.5 x the drawn size, only while it is drawn.
            const px = selC.hasBeenDestroyed ? 0 : this.creatureLayer.drawnSizePx(selC);
            if (px > 0) {
                // Around the drawn (render-interpolated) creature.
                const d = this.motion.drawn(selC);
                const s = cam.worldToScreen(d !== null ? d.x : selC.xpos, d !== null ? d.y : selC.ypos);
                this.drawSelectionRing(s.x, s.y, Math.max(px * 1.5, 8) * 0.5);
            } else {
                this.selectionRing.visible = false;
            }
        } else if (selBo !== null && !selBo.hasBeenDestroyed && 1 / z < BUILT_OBJECT_MAX_FACTOR) {
            // The same drawn position as the ship sprite and its marker (sampled by BuiltObjectLayer above this frame).
            const d = drawnBuiltObjectPos(this.motion, selBo);
            const s = cam.worldToScreen(d.x, d.y);
            const r = Math.max(this.builtObjectLayer.drawnSizePx(selBo), 8) * 0.5 + 4;
            this.drawSelectionRing(s.x, s.y, r);
        } else if (sel === null) {
            this.selectionRing.visible = false;
        } else {
            // Around the drawn planet / moon (render-interpolated orbit).
            const hp = this.motion.habitatPos(sel);
            const s = cam.worldToScreen(hp.x, hp.y);
            const r = this.drawnSize(sel, z) * 0.5 + 4;
            this.drawSelectionRing(s.x, s.y, r);
        }

        this.drawMultiSelectionRings(z, cam);
        this.updateRangeRings(z, cam);

        // Screen-edge auto-scroll (original control scheme).
        let edgeDx = 0;
        let edgeDy = 0;
        if (!this.dragging && this.pointerInside) {
            const edge = 24;
            const speed = edgeScrollPixels(getSettings().mainViewScrollSpeed); // [gameoptions] Scroll Speed
            if (this.lastPointer.x < edge) {
                edgeDx = -speed;
            } else if (this.lastPointer.x > cam.width - edge) {
                edgeDx = speed;
            }
            if (this.lastPointer.y < edge) {
                edgeDy = -speed;
            } else if (this.lastPointer.y > cam.height - edge) {
                edgeDy = speed;
            }
        }

        // Follow camera (task followcam): recentre every frame on the followed ship/fleet's drawn
        // (render-interpolated) position, keeping zoom. Edge-scroll stops it here; a drag-pan or any map click
        // stops it immediately at mousedown (attachInput, below); a keyboard scroll stops it in keyboard.ts; a
        // selection change stops it in hud.ts (followOnSelectionChanged). Wheel-zoom is untouched, so zooming
        // keeps following.
        if (isFollowing(this.followState)) {
            if (edgeDx !== 0 || edgeDy !== 0) {
                this.stopFollowing();
            } else {
                const target = this.followState.target as FollowTarget;
                if (!followTargetAlive(target)) {
                    this.stopFollowing();
                } else {
                    const p = followTargetPosition(this.motion, target);
                    cam.centerOn(p.x, p.y);
                }
            }
        }

        if (edgeDx !== 0 || edgeDy !== 0) {
            // panByScreen has drag semantics (content follows the pointer); edge scroll moves the view toward the edge.
            cam.panByScreen(-edgeDx, -edgeDy);
        }
    }

    // [gameoptions] begin
    /** Main.Part13.cs:388 OnMouseWheel on our camera: the zoom step from Zoom Speed and the anchor from the mouse
     *  scroll-wheel behaviour (render/viewInput.ts). */
    private wheelZoom(deltaY: number, deltaMode: number, sx: number, sy: number): void {
        const s = getSettings();
        const notches = wheelNotches(deltaY, deltaMode);
        if (notches === 0) return;
        const cam = this.camera;
        const zoom = cam.clampZoom(wheelZoom(cam.zoom, notches, s.mainViewZoomSpeed));
        if (zoom === cam.zoom) return; // `if (num == double_0) flag = false`: no movement either
        const target = this.wheelSelectionPoint();
        const anchor = wheelZoomAnchor(s.mouseScrollWheelBehaviour, notches < 0, target !== null);
        if (anchor === 'selection' && target !== null) cam.centerOn(target.x, target.y);
        if (anchor === 'cursor') cam.zoomAt(zoom, sx, sy);
        else cam.zoomAt(zoom, cam.width / 2, cam.height / 2);
    }

    /** The selected item's drawn position (method_157's target): the HUD's ship / fleet, else the selected body. */
    private wheelSelectionPoint(): { x: number; y: number } | null {
        const sel = this.getHudSelection();
        const bo = sel?.builtObject ?? sel?.shipGroup?.leadShip ?? null;
        if (bo) return { x: bo.xpos, y: bo.ypos };
        const h = this.selectedHabitat;
        return h !== null ? this.motion.habitatPos(h) : null;
    }

    /** Push the display options into the starfield and the nebula layer (each a no-op unless the value changed). */
    private applyDisplaySettings(): void {
        const s = getSettings();
        this.deepStarfield.setStarFieldSize(s.starFieldSize);
        this.systemNebulae.setDisplay(s.showSystemNebulae, nebulaDetailScale(s.systemNebulaeDetail));
    }
    // [gameoptions] end

    /** Stop the follow camera if it is on (edge-scroll, a mousedown on the canvas, or the followed target being
     * gone — task followcam). A no-op while already off. */
    private stopFollowing(): void {
        if (isFollowing(this.followState)) stopFollow(this.followState);
    }

    /** The selection ring at screen (x, y) with radius r; the geometry is rebuilt only when one of them changes. */
    private drawSelectionRing(x: number, y: number, r: number): void {
        if (this.selectionKey.changed(x, y, r)) {
            this.selectionRing.clear();
            this.selectionRing.circle(x, y, r).stroke({ width: 1.5, color: 0x4fc3f7 });
        }
        this.selectionRing.visible = true;
    }

    /** Range rings for the selected ship / fleet / multi-selection (the minimum over its ships), centred on the
     * lead's drawn position; hidden for bases / ships without a hyperdrive. */
    private updateRangeRings(z: number, cam: Camera): void {
        const g = this.rangeRingsG;
        const hud = this.getHudSelection();
        let ships: BuiltObject[] | null = null;
        let lead: BuiltObject | null = null;
        const grp = hud?.shipGroup;
        if (grp !== undefined && grp.ships.length > 0) {
            ships = grp.ships;
            lead = grp.leadShip ?? grp.ships[0];
        } else if (this.selectedBuiltObjects !== null && this.selectedBuiltObjects.length > 0) {
            ships = this.selectedBuiltObjects;
            lead = ships[0];
        } else if (this.selectedBuiltObject !== null) {
            ships = [this.selectedBuiltObject];
            lead = this.selectedBuiltObject;
        }
        const radii = ships !== null ? fleetRangeRadii(ships) : null;
        if (radii === null || lead === null || lead.hasBeenDestroyed) {
            if (g.visible) g.clear();
            g.visible = false;
            return;
        }
        const d = drawnBuiltObjectPos(this.motion, lead);
        const s = cam.worldToScreen(d.x, d.y);
        drawRangeRings(g, s.x, s.y, { range45: radii.range45 * z, range100: radii.range100 * z }, cam.width, cam.height);
        g.visible = true;
    }

    /** A ring around every live ship of the multi-selection, at its drawn position (ship size at system zoom, a small
     * fixed ring over the galaxy / sector symbols). */
    private drawMultiSelectionRings(z: number, cam: Camera): void {
        const g = this.multiSelectionRings;
        const list = this.selectedBuiltObjects;
        g.clear();
        if (list === null || list.length === 0) {
            g.visible = false;
            return;
        }
        const shipArt = 1 / z < BUILT_OBJECT_MAX_FACTOR;
        let any = false;
        for (const bo of list) {
            if (bo.hasBeenDestroyed) continue;
            const d = drawnBuiltObjectPos(this.motion, bo);
            const s = cam.worldToScreen(d.x, d.y);
            const r = shipArt ? Math.max(this.builtObjectLayer.drawnSizePx(bo), 8) * 0.5 + 4 : 7;
            if (s.x < -r || s.y < -r || s.x > cam.width + r || s.y > cam.height + r) continue;
            g.circle(s.x, s.y, r);
            any = true;
        }
        if (any) g.stroke({ width: 1.5, color: 0x4fc3f7 });
        g.visible = any;
    }

    /** The drag rectangle from the press point to the pointer (thin, subtle; screen space). */
    private drawSelectionBox(ax: number, ay: number, bx: number, by: number): void {
        const b = screenBox(ax, ay, bx, by);
        const g = this.selectionBox;
        g.clear();
        g.rect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0).fill({ color: 0x4fc3f7, alpha: 0.06 }).stroke({ width: 1, color: 0x4fc3f7, alpha: 0.75 });
        g.visible = true;
    }

    /** Main.Part10.cs 2989 mainView_MouseUp / method_141: the visible built objects drawn inside a screen box. */
    builtObjectsInScreenBox(box: ScreenBox): BuiltObject[] {
        const cam = this.camera;
        const player = this.galaxy.playerEmpire;
        return objectsInBox(
            this.galaxy.builtObjects,
            box,
            (bo) => {
                const d = drawnBuiltObjectPos(this.motion, bo);
                return cam.worldToScreen(d.x, d.y);
            },
            (bo) => player === null || bo.empire === player || isObjectVisibleToThisEmpire(this.galaxy, player, bo),
        );
    }

    /** method_208 for a ship selection: several ships, one ship, or nothing. */
    private selectShips(sel: BuiltObject | BuiltObject[] | null): void {
        this.selectedHabitat = null;
        this.selectedCreature = null;
        if (Array.isArray(sel)) {
            this.selectedBuiltObject = null;
            this.onBuiltObjectListSelect?.(sel);
        } else if (sel !== null) {
            this.selectedBuiltObject = sel;
            this.onBuiltObjectSelect?.(sel);
        } else {
            this.selectedBuiltObject = null;
            this.onSelectionChange?.(null);
        }
    }

    private drawGrid(z: number): void {
        const g = this.grid;
        g.clear();
        const sizeX = this.galaxy.sizeX;
        const sizeY = this.galaxy.sizeY;
        const step = this.galaxy.sectorSize;
        const line = { width: 1 / z, color: 0x3a4a66, alpha: 0.6 };
        for (let x = 0; x <= sizeX + 1; x += step) {
            g.moveTo(x, 0).lineTo(x, sizeY).stroke(line);
        }
        for (let y = 0; y <= sizeY + 1; y += step) {
            g.moveTo(0, y).lineTo(sizeX, y).stroke(line);
        }
    }

    /** A left click (or a drag box with nothing inside, at its press point) selects the object under (x, y); empty
     * space clears the selection. */
    private clickSelect(x: number, y: number): void {
        // Main.Part11.cs method_145: a creature under the cursor is picked before any ship.
        const creature = this.pickCreature(x, y);
        if (creature !== null) {
            playGridClick(); // [audio]
            this.selectedHabitat = null;
            this.selectedBuiltObject = null;
            this.selectedCreature = creature;
            this.onCreatureSelect?.(creature);
            return;
        }
        this.selectedCreature = null;
        // [galaxymarkers] begin — a fleet icon (galaxy/sector zoom) selects its fleet (method_258 / 145).
        const wp = this.camera.screenToWorld(x, y);
        const sym = this.galaxyMarkers?.pickAt(wp.x, wp.y, this.camera.zoom) ?? null;
        const symSel = sym !== null ? clickSelection(sym) : null;
        if (symSel !== null && symSel !== sym?.bo && this.onShipGroupSelect !== undefined) {
            playGridClick(); // [audio]
            this.selectedHabitat = null;
            this.selectedBuiltObject = null;
            this.onShipGroupSelect(symSel as ShipGroup);
            return;
        }
        // [galaxymarkers] end
        const bo = this.pickBuiltObject(x, y);
        // [audio] begin — Main.Part10.cs:3304-3306 `if (obj3 != null) method_225()` (grid.wav) on a left-click pick.
        if (bo !== null || this.pick(x, y) !== null) playGridClick();
        // [audio] end
        if (bo !== null) {
            this.selectedHabitat = null;
            this.selectedBuiltObject = bo;
            this.onBuiltObjectSelect?.(bo);
            return;
        }
        const hit = this.pick(x, y);
        this.selectedBuiltObject = null;
        this.selectedHabitat = hit;
        this.onSelectionChange?.(hit);
    }

    /** Main.Part10.cs 2989-3044 mainView_MouseUp: select from a finished drag rectangle (boxSelect.ts). */
    private finishBoxSelection(box: ScreenBox, additive: boolean, pressX: number, pressY: number): void {
        const inBox = this.builtObjectsInScreenBox(box);
        const cur = this.getSelectedShips?.() ?? null;
        const current = cur === null ? [] : Array.isArray(cur) ? cur : [cur];
        const r = resolveBoxSelection(inBox, this.galaxy.playerEmpire, additive, current);
        switch (r.kind) {
            case 'list':
                playGridClick(); // [audio]
                if (this.onBuiltObjectListSelect !== undefined) this.selectShips(r.ships);
                else this.selectShips(r.ships[0]);
                return;
            case 'single':
                playGridClick(); // [audio]
                this.selectShips(r.builtObject);
                return;
            case 'clear':
                this.selectShips(null);
                return;
            case 'pickAtPress':
                this.clickSelect(pressX, pressY);
                return;
            case 'keep':
                return;
        }
    }

    // ------------------------------------------------------------------
    // Input: wheel zoom around cursor, right-drag pan, right-click center,
    // PageUp/PageDown zoom steps, screen-edge scroll (manual control set).

    private attachInput(): void {
        const canvas = this.app.canvas;
        let downX = 0;
        let downY = 0;
        /** The left button went down on the map (not on the HUD); a drag box may follow. */
        let leftPressed = false;
        /** The left press moved >= 4 px: the selection box is being dragged. */
        let boxActive = false;
        let rightDownX = 0; // [ordermenu] the right button's press point (click vs drag)
        let rightDownY = 0;
        canvas.addEventListener(
            'wheel',
            (e: WheelEvent) => {
                e.preventDefault();
                const rect = canvas.getBoundingClientRect();
                const sx = e.clientX - rect.left;
                const sy = e.clientY - rect.top;
                this.wheelZoom(e.deltaY, e.deltaMode, sx, sy); // [gameoptions] Zoom Speed + Mouse scroll-wheel behaviour
            },
            { passive: false },
        );
        canvas.addEventListener('mousedown', (e: MouseEvent) => {
            // Task followcam: any press on the map — a drag-pan starting or a plain click — stops the follow
            // camera ("touching anything outside UI elements ... stops the follow cam").
            this.stopFollowing();
            // A press (a selection click, a drag) drops the hover name tooltip and cancels its pending show, so selecting a
            // body does not pop its name (the selection panel shows it); the next pointer move brings hover tooltips back.
            if (this.tooltipTimer !== undefined) {
                clearTimeout(this.tooltipTimer);
                this.tooltipTimer = undefined;
            }
            hideMapTooltip();
            if (e.button === 2) {
                this.dragging = true;
                const rect = canvas.getBoundingClientRect();
                this.lastDragX = e.clientX - rect.left;
                this.lastDragY = e.clientY - rect.top;
                rightDownX = this.lastDragX;
                rightDownY = this.lastDragY;
            } else if (e.button === 0) {
                const rect = canvas.getBoundingClientRect();
                downX = e.clientX - rect.left;
                downY = e.clientY - rect.top;
                leftPressed = true;
                boxActive = false;
            }
        });
        window.addEventListener('mousemove', (e: MouseEvent) => {
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            this.pointerInside = x >= 0 && y >= 0 && x <= rect.width && y <= rect.height;
            this.lastPointer = { x, y };
            if (this.dragging) {
                this.camera.panByScreen(x - this.lastDragX, y - this.lastDragY);
                this.lastDragX = x;
                this.lastDragY = y;
                // Task 12k: no hover tooltip while panning.
                hideMapTooltip();
                return;
            }
            // Left-drag box selection (Main.Part10.cs mainView_MouseDown / MouseUp): the rectangle from the press point.
            if (leftPressed && (e.buttons & 1) !== 0) {
                if (!boxActive && isDrag(downX, downY, x, y)) boxActive = true;
                if (boxActive) {
                    this.drawSelectionBox(downX, downY, x, y);
                    if (this.tooltipTimer !== undefined) {
                        clearTimeout(this.tooltipTimer);
                        this.tooltipTimer = undefined;
                    }
                    hideMapTooltip();
                    return;
                }
            }
            // Task 12k: hover tooltip — debounce ~120 ms so it only appears
            // when the mouse rests on a pickable object.
            if (this.tooltipTimer !== undefined) {
                clearTimeout(this.tooltipTimer);
            }
            this.tooltipTimer = window.setTimeout(() => {
                this.tooltipTimer = undefined;
                if (!this.pointerInside) {
                    hideMapTooltip();
                    return;
                }
                this.onPointerRest?.(x, y, e.clientX, e.clientY); // [ordermenu]
                // HoverPanel.cs 220 method_2: a creature under the cursor shows its name, size, strength and health.
                const creature = this.pickCreature(x, y);
                if (creature !== null) {
                    showMapTooltip(creatureTooltipText(creature), e.clientX, e.clientY);
                    return;
                }
                const hit = this.pick(x, y);
                if (hit === null) {
                    // [freightOverlay] begin — hover a flow arc / trade hub (task 19e-9).
                    const w = this.camera.screenToWorld(x, y);
                    const fh = this.overlayLayer?.freight.hitTest(w.x, w.y, this.camera.zoom) ?? null;
                    if (fh !== null) {
                        showMapTooltip(freightTooltipText(this.galaxy, fh), e.clientX, e.clientY);
                        return;
                    }
                    // [freightOverlay] end
                    // [wreckage] begin — hover a known debris field (scenario 19e-7).
                    const wf = this.overlayLayer?.wreckHitTest(w.x, w.y, this.camera.zoom) ?? null;
                    if (wf !== null) {
                        showMapTooltip(wreckTooltipText(this.galaxy, wf), e.clientX, e.clientY);
                        return;
                    }
                    // [wreckage] end
                    hideMapTooltip();
                    return;
                }
                // Same lookup as main.ts's selection code: the system star of
                // the habitat's system, guarded against out-of-range indices.
                let systemName: string | null = null;
                const sys = this.galaxy.systems[hit.systemIndex];
                if (sys !== undefined) {
                    systemName = sys.systemStar.name;
                }
                showMapTooltip(tooltipText(hit, systemName), e.clientX, e.clientY);
            }, 120);
        });
        window.addEventListener('mouseup', (e: MouseEvent) => {
            if (this.tooltipTimer !== undefined) {
                clearTimeout(this.tooltipTimer);
                this.tooltipTimer = undefined;
            }
            hideMapTooltip();
            if (e.button === 2 && this.dragging) {
                this.dragging = false;
                const rect = canvas.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                // [ordermenu] begin: a right click without drag goes to the order layer (17c) when installed.
                if (this.onRightClick !== undefined) {
                    if (Math.hypot(x - rightDownX, y - rightDownY) < 4) {
                        const handler = this.onRightClick;
                        // Stacked objects under the cursor: choose the order target from a popup, then replay the click on it.
                        const opened = this.tryPickMenu(x, y, e.clientX, e.clientY, (item) => {
                            this.pickOverride = item;
                            try {
                                handler(x, y, e);
                            } finally {
                                this.pickOverride = undefined;
                            }
                        });
                        if (!opened) handler(x, y, e);
                    }
                    return;
                }
                // [ordermenu] end
                if (Math.hypot(x - this.lastDragX, y - this.lastDragY) < 4) {
                    // Right-click on empty space centers the view there.
                    const w = this.camera.screenToWorld(x, y);
                    this.camera.centerOn(w.x, w.y);
                }
            } else if (e.button === 0) {
                if (!leftPressed) return; // pressed on the HUD, released over the map
                leftPressed = false;
                const rect = canvas.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                if (boxActive || isDrag(downX, downY, x, y)) {
                    // Main.Part10.cs 2989 mainView_MouseUp: the ships inside the dragged rectangle.
                    boxActive = false;
                    this.selectionBox.clear();
                    this.selectionBox.visible = false;
                    this.finishBoxSelection(screenBox(downX, downY, x, y), e.shiftKey || e.ctrlKey, downX, downY);
                    return;
                }
                // Left click (no drag: < 4 px pointer movement between
                // down/up) selects the object under the cursor; empty space
                // clears the selection.
                if (this.onLeftClickIntercept?.(x, y)) return; // [ordermenu]
                // Main.Part10.cs 3158-3248: Shift + left click toggles the clicked ship in the multi-selection.
                if (e.shiftKey && this.onBuiltObjectListSelect !== undefined) {
                    const bo = this.pickBuiltObject(x, y);
                    const next = shiftClickSelection(this.getSelectedShips?.() ?? null, bo !== null ? [bo] : [], this.galaxy.playerEmpire);
                    if (next !== undefined) {
                        playGridClick(); // [audio]
                        this.selectShips(next);
                    }
                    return;
                }
                if (this.tryPickMenu(x, y, e.clientX, e.clientY, (item) => this.selectPicked(item))) return;
                this.clickSelect(x, y);
            }
        });
        canvas.addEventListener('dblclick', (e: MouseEvent) => {
            // Double-click a star at galaxy/sector zoom -> zoom to System
            // level centred on it.
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            // [galaxymarkers] Main.Part7.cs 3494-3502: double-clicking one of the player's fleet ships selects its fleet.
            const dbo = this.pickBuiltObject(x, y);
            const fleet = dbo !== null ? doubleClickFleet(dbo, this.galaxy.playerEmpire) : null;
            if (fleet !== null && this.onShipGroupSelect !== undefined) {
                this.selectedBuiltObject = null;
                this.onShipGroupSelect(fleet);
                return;
            }
            const hit = this.pick(x, y);
            if (hit !== null && hit.category === HabitatCategoryType.Star) {
                this.onDoubleClickStar?.(hit);
            }
        });
        canvas.addEventListener('contextmenu', (e) => e.preventDefault());
        // PageUp/PageDown zoom is handled by the KEY_BINDINGS dispatch
        // (src/ui/keyboard.ts zoomOut/zoomIn); a second listener here undid it
        // and survived game-view teardown.
    }

    /** Task 12k: drop the hover tooltip when this view is torn down. */
    dispose(): void {
        closePickMenu();
        if (this.tooltipTimer !== undefined) {
            clearTimeout(this.tooltipTimer);
            this.tooltipTimer = undefined;
        }
        hideMapTooltip();
        this.overlayLayer?.destroy(); // [freightOverlay] stop recording contracts for this galaxy
    }

    // [freightOverlay] begin — task 19e-9: the panel / legend reach the Freight Flows overlay through the view.
    get freightOverlay(): FreightOverlay | null {
        return this.overlayLayer?.freight ?? null;
    }
    // [freightOverlay] end
}
