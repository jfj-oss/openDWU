// Built-object layer: draws every ship and base (BuiltObject) in the Main View
// at galaxy/sector/system zoom, while the original's zoom factor f = 1/z stays
// below 500 (MainView.1.cs:856-859, 1034-1133; MainView.2.cs:2020-2029).
// Port of the image-index table from BuiltObjectImageCache.cs:949-1158
// (GenerateBuiltObjectImageFilepaths) + BaconBuiltObjectImageCache.cs:20-80
// (AddMoreImages), the size formula from Main.Part12.cs:4604-4626
// (DetermineBuiltObjectSizeNEW), and the crop/content-size maths from
// BuiltObjectImageCache.cs:521-534, 616-730.
//
// The world container is scaled by z (px per world unit), so a sprite drawn at
// `px` screen pixels gets scale px / tex.width / z. The original rotates the
// cached art 90° clockwise at load, hence rotation = heading + π/2 on the raw
// PNG. There is no empire tint: PrepareBuiltObjectImageNEW ignores its colour
// arguments (only the civilian fade below applies).

import { Container, Sprite } from 'pixi.js';
import type { Texture } from 'pixi.js';
import { Camera } from './camera';
import { AssetStore, makeDotTexture, useMinifyingFilter } from './assets';
import { loadShipArt, type ShipArt } from './shipArt';
// [concordArt] begin
import { ConcordFxLayer, concordArtEmpire, concordArtLook, concordShipArt, concordTreasureShips, concordVariantFor, type ConcordShipArt } from './concordArt';
// [concordArt] end
import { DamageOverlays, shipDamageSubject } from './shipOverlays';
import { artBundleFlag } from './artBundleFlags';
import { LiveryOverlays } from './liveryLayer';
import { Galaxy } from '../sim/galaxy';
import type { BuiltObject } from '../sim/builtObject';
import { BuiltObjectSubRole } from '../sim/builtObjectTypes';
import { DesignImageScalingMode } from '../sim/data/designSpecifications';
import { DiplomaticRelationType } from '../sim/diplomacy';
import type { Empire } from '../sim/empire';
import type { SystemInfo } from '../sim/types';
import type { MapOverlayState } from '../ui/mapOverlays';

// Galaxy.BuiltObjectDrawResizeFactor (Galaxy.1.cs).
export const BUILT_OBJECT_DRAW_RESIZE_FACTOR = 8.0;
// Ships are only drawn while the original's zoom factor double_0 < 500.
export const BUILT_OBJECT_MAX_FACTOR = 500;
// Main.Part11.cs method_145: below this zoom factor (f <= 100) ships are
// picked by their drawn rect, above it by nearest-within-radius.
export const BUILT_OBJECT_PICK_SYSTEM_MAX_FACTOR = 100;
// First index of the standard family<N>/ ship sets (after the minor/major sets).
export const STANDARD_SHIP_IMAGE_START_INDEX = 72;
// One image per entry of SHIP_SET_FILES per family folder.
export const SHIP_SET_IMAGE_COUNT = 24;
// images/units/ships/family0..family26 exist in the install.
export const STANDARD_FAMILY_COUNT = 27;

// The 24 lower-case file names (without .png) each family<N>/ holds, in the
// AddMoreImages order (BaconBuiltObjectImageCache.cs:20-80).
export const SHIP_SET_FILES = [
    'escort',
    'frigate',
    'destroyer',
    'cruiser',
    'capitalship',
    'trooptransport',
    'carrier',
    'resupplyship',
    'explorationship',
    'smallfreighter',
    'mediumfreighter',
    'largefreighter',
    'colonyship',
    'passengership',
    'constructionship',
    'gasminingship',
    'miningship',
    'gasminingstation',
    'miningstation',
    'smallspaceport',
    'mediumspaceport',
    'largespaceport',
    'resortbase',
    'genericbase',
] as const;

// Minor-set military slots (other/MinorSets/family<j>/, j = 0..6).
const MINOR_MILITARY_FILES = ['military_small', 'military_medium', 'military_large', 'colonyship'] as const;
// Major-set families in GenerateBuiltObjectImageFilepaths order (k = 0..3).
const MAJOR_SET_FAMILIES = ['Shakturi', 'ShakturiAllies', 'AncientHelpers', 'FreedomAlliance'] as const;
const MAJOR_SET_FILES = ['frigate', 'destroyer', 'cruiser', 'capitalship', 'trooptransport', 'base_0', 'base_1'] as const;
const PHANTOM_PIRATE_FILES = ['escort', 'frigate', 'destroyer', 'cruiser', 'capitalship', 'carrier', 'defensivebase', 'homebase'] as const;

/**
 * Path relative to `images/units/ships/` for a pictureRef, following the
 * GenerateBuiltObjectImageFilepaths index table (BuiltObjectImageCache.cs:949-1158)
 * with the exact case-sensitive folder spellings of the install. Returns null
 * for a negative index or a standard family >= 27.
 */
export function builtObjectImagePath(pictureRef: number): string | null {
    if (pictureRef < 0) return null;
    if (pictureRef === 0) return 'other/planetdestroyer.png';
    if (pictureRef <= 2) return `other/MinorSets/bases/base_${pictureRef - 1}.png`;
    if (pictureRef <= 30) {
        const p = pictureRef - 3;
        return `other/MinorSets/family${Math.floor(p / 4)}/${MINOR_MILITARY_FILES[p % 4]}.png`;
    }
    if (pictureRef <= 58) {
        const p = pictureRef - 31;
        return `other/MajorSets/${MAJOR_SET_FAMILIES[Math.floor(p / 7)]}/${MAJOR_SET_FILES[p % 7]}.png`;
    }
    if (pictureRef <= 63) {
        // FreedomAllianceFamily (k == 3) aged variants.
        return `other/MajorSets/FreedomAlliance/aged/${MAJOR_SET_FILES[pictureRef - 59]}.png`;
    }
    if (pictureRef <= 71) {
        return `other/MajorSets/PhantomPirates/${PHANTOM_PIRATE_FILES[pictureRef - 64]}.png`;
    }
    const n = Math.floor((pictureRef - STANDARD_SHIP_IMAGE_START_INDEX) / SHIP_SET_IMAGE_COUNT);
    if (n >= STANDARD_FAMILY_COUNT) return null;
    return `family${n}/${SHIP_SET_FILES[(pictureRef - STANDARD_SHIP_IMAGE_START_INDEX) % SHIP_SET_IMAGE_COUNT]}.png`;
}

/** Full URL of the ship art for a pictureRef, or null when there is none. */
export function builtObjectImageUrl(pictureRef: number): string | null {
    const path = builtObjectImagePath(pictureRef);
    return path === null ? null : `/assets/dwu/images/units/ships/${path}`;
}

/**
 * The pictureRef to draw for a built object. Objects with an explicit
 * pictureRef (or planet destroyers) use it directly; pictureRef 0 is a render
 * stand-in for ShipImageHelper.ResolveMinorShipImageIndex (own clock-seeded
 * Random), which the sim does not run — see designGeneration.ts.
 */
export function resolveDrawPictureRef(bo: {
    pictureRef: number;
    isPlanetDestroyer: boolean;
    subRole: BuiltObjectSubRole;
    builtObjectID: number;
}): number {
    if (bo.pictureRef !== 0 || bo.isPlanetDestroyer) return bo.pictureRef;
    // TODO(port): ShipImageHelper.ResolveMinorShipImageIndex — clock-seeded Random; deterministic stand-in
    const id = Math.abs(bo.builtObjectID);
    switch (bo.subRole) {
        case BuiltObjectSubRole.GasMiningStation:
        case BuiltObjectSubRole.MiningStation:
        case BuiltObjectSubRole.SmallSpacePort:
        case BuiltObjectSubRole.GenericBase:
            // MinorBaseStartIndex 1 + Rnd.Next(0, 2) → one of the two base images.
            return 1 + (id % 2);
        default: {
            // num2 per ResolveMinorShipImageIndex (largeShips = false).
            let num2 = 0;
            switch (bo.subRole) {
                case BuiltObjectSubRole.Escort:
                    num2 = 0;
                    break;
                case BuiltObjectSubRole.Frigate:
                    num2 = 1;
                    break;
                case BuiltObjectSubRole.Destroyer:
                    num2 = 2;
                    break;
                case BuiltObjectSubRole.Cruiser:
                    num2 = 1;
                    break;
                case BuiltObjectSubRole.CapitalShip:
                    num2 = 2;
                    break;
                case BuiltObjectSubRole.ColonyShip:
                    num2 = 3;
                    break;
            }
            // MinorShipStartIndex 3 + family * 4 + num2, family = Rnd.Next(0, 7).
            return 3 + (id % 7) * 4 + num2;
        }
    }
}

/** Crop + content-size metrics of a ship image (see shipImageMetrics). */
export interface ShipImageMetrics {
    /** DetermineBuiltObjectSizeNEW's num3: crop-bitmap area / content-pixel
     * count (imageData.Size) of the full-size image data. */
    areaRatio: number;
    /** Side of the C# square crop bitmap (padded bbox extent + 1). */
    cropSide: number;
    /** Centre of that crop square in raw-image pixel-edge coordinates (anchor). */
    cropCenterX: number;
    cropCenterY: number;
}

/**
 * Pure port of CropImageContent (padding 4) + DetermineImageContentSize on the
 * raw RGBA (BuiltObjectImageCache.cs CropImageContent / LoadSingleBuiltObjectImage).
 * A content pixel is opaque and not opaque black (the C# also excludes
 * transparent-white and fully-transparent pixels, which already fail `a > 0`).
 * Returns null when the image has no content pixels.
 *
 * The crop is the C#'s integer maths: pad the bbox by 4, then square it about
 * the padded bbox — `num10 = num + num9 / 2 - num8 / 2` (or the y analogue) —
 * into `new Bitmap(num11 - num10 + 1, num13 - num12 + 1)`, so the square is
 * one pixel wider than the padded extent. The main view draws the full-size
 * image data (BuiltObjectImageCache.FastGetImageData), whose Image is that
 * crop bitmap, so DetermineBuiltObjectSizeNEW's image area is cropSide².
 */
export function shipImageMetrics(rgba: ArrayLike<number>, w: number, h: number): ShipImageMetrics | null {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let count = 0;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            const r = rgba[i];
            const g = rgba[i + 1];
            const b = rgba[i + 2];
            const a = rgba[i + 3];
            if (a > 0 && !(r === 0 && g === 0 && b === 0 && a === 255)) {
                count++;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
    }
    if (count === 0) return null;
    // num3/num4 = minY/maxY, num/num2 = minX/maxX, padded by 4.
    const num = minX - 4;
    const num2 = maxX + 4;
    const num3 = minY - 4;
    const num4 = maxY + 4;
    const num8 = num4 - num3; // padded height
    const num9 = num2 - num; // padded width
    let left: number;
    let top: number;
    let side: number;
    if (num8 > num9) {
        left = num + Math.trunc(num9 / 2) - Math.trunc(num8 / 2);
        top = num3;
        side = num8 + 1;
    } else {
        top = num3 + Math.trunc(num8 / 2) - Math.trunc(num9 / 2);
        left = num;
        side = num9 + 1;
    }
    return {
        areaRatio: (side * side) / count,
        cropSide: side,
        // Centre of the crop square in raw-image pixel-edge coordinates.
        cropCenterX: left + side / 2,
        cropCenterY: top + side / 2,
    };
}

/**
 * On-screen size in px of a built object at zoom factor f = 1/z. Exact port of
 * DetermineBuiltObjectSizeNEW (Main.Part12.cs:4604-4626): sqrt(size *
 * areaRatio * 8.0 / f²), then the design's image-scaling override.
 */
export function builtObjectSizePx(
    size: number,
    areaRatio: number,
    f: number,
    scalingType: DesignImageScalingMode,
    scalingFactor: number,
): number {
    let num = Math.sqrt((size * areaRatio * BUILT_OBJECT_DRAW_RESIZE_FACTOR) / (f * f));
    if (scalingType !== DesignImageScalingMode.None) {
        if (scalingType === DesignImageScalingMode.Absolute) {
            num = Math.fround(scalingFactor) / Math.fround(f);
        } else {
            num *= scalingFactor;
        }
    }
    return Math.trunc(num);
}

/**
 * Task 13d (Main.Part11.cs method_145, f > 100 branch): the pick radius in
 * world units at zoom factor f. num2 = 10, scaled up while f < 400 and down
 * while f > 4000, clamped to >= 6; the radius is num2 * f / 1.4.
 */
export function builtObjectPickRadiusPx(f: number): number {
    let num2 = 10;
    if (f < 400.0) num2 = Math.trunc(num2 * Math.sqrt(400.0 / f));
    if (f > 4000.0) num2 = Math.trunc(num2 / (f / 4000.0));
    if (num2 < 6) num2 = 6;
    return num2 * f;
}

/** The other empires of every War diplomatic relation, in order. */
export function warEmpires(relations: Iterable<{ type: DiplomaticRelationType; otherEmpire: Empire | null }>): Empire[] {
    const out: Empire[] = [];
    for (const r of relations) {
        if (r.type === DiplomaticRelationType.War && r.otherEmpire !== null) out.push(r.otherEmpire);
    }
    return out;
}

// Port of Main.Part11.cs method_145 flag + Galaxy.3.cs FastTestShipInColonizedSystem
export function builtObjectHiddenFromPick(
    bo: BuiltObject,
    systems: readonly SystemInfo[],
    pirateEmpires: readonly (Empire | null)[],
    war: readonly (Empire | null)[],
): boolean {
    if (
        bo.subRole === BuiltObjectSubRole.SmallSpacePort ||
        bo.subRole === BuiltObjectSubRole.MediumSpacePort ||
        bo.subRole === BuiltObjectSubRole.LargeSpacePort
    ) {
        return false;
    }
    const star = bo.nearestSystemStar;
    if (star === null) return false;
    const sys = systems[star.systemIndex];
    if (sys?.dominantEmpire?.empire == null) return false;
    if (pirateEmpires.includes(bo.empire)) return false;
    if (war.includes(bo.empire)) return false;
    return true;
}

/**
 * Task 13d (Main.Part11.cs method_145, f <= 100 branch): the smallest-size
 * built object whose drawn rect (drawn px times f world units, padded by
 * trunc(f * 1.3) screen px) contains the world point.
 */
export function pickBuiltObjectBySize(
    list: readonly BuiltObject[],
    wx: number,
    wy: number,
    f: number,
    sizePx: (bo: BuiltObject) => number,
): BuiltObject | null {
    const x = Math.trunc(wx);
    const y = Math.trunc(wy);
    const pad = Math.trunc(f * 1.3);
    let best: BuiltObject | null = null;
    let bestSize = 536870911;
    for (const bo of list) {
        const px = sizePx(bo);
        if (px <= 0) continue;
        const w = Math.trunc(px * f);
        const half = Math.trunc(w / 2);
        const cx = Math.trunc(bo.xpos);
        const cy = Math.trunc(bo.ypos);
        if (x >= cx - half - pad && x <= cx + half + pad && y >= cy - half - pad && y <= cy + half + pad) {
            if (bo.size < bestSize) {
                best = bo;
                bestSize = bo.size;
            }
        }
    }
    return best;
}

/**
 * Task 13d (Main.Part11.cs method_145, f > 100 branch): the nearest
 * non-hidden built object within builtObjectPickRadiusPx(f) / 1.4 world
 * units of the point. Ties go to the first object in the list.
 */
export function pickNearestBuiltObject(
    list: readonly BuiltObject[],
    wx: number,
    wy: number,
    f: number,
    hidden: (bo: BuiltObject) => boolean,
): BuiltObject | null {
    let best: BuiltObject | null = null;
    let bestDist = Infinity;
    for (const bo of list) {
        if (hidden(bo)) continue;
        const d = Math.hypot(bo.xpos - wx, bo.ypos - wy);
        if (d < bestDist) {
            bestDist = d;
            best = bo;
        }
    }
    if (best === null) return null;
    if (bestDist <= builtObjectPickRadiusPx(f) / 1.4) return best;
    return null;
}

/**
 * Release the sprites of built objects that were not visited as live this frame: destroyed ships/bases
 * (hasBeenDestroyed — their explosion is drawn by effectsLayer.ts) and objects gone from galaxy.builtObjects (the sim
 * leaves a null slot). `seen` holds every live object the frame visited. Each released entry is removed from `sprites`
 * and handed to `release` (which detaches / destroys it). Returns how many were released.
 */
export function releaseStaleSprites<K, S>(sprites: Map<K, S>, seen: ReadonlySet<K>, release: (key: K, sprite: S) => void): number {
    let n = 0;
    for (const [key, sprite] of sprites) {
        if (seen.has(key)) continue;
        sprites.delete(key);
        release(key, sprite);
        n++;
    }
    return n;
}

// [concordArt]
const NO_TREASURE: ReadonlySet<unknown> = new Set();

interface LoadedShipImage {
    texture: Texture;
    metrics: ShipImageMetrics;
    /** The shipArt.ts record (pixels for the 19r overlays); null for the no-install dot. */
    art: ShipArt | null;
}

/**
 * Draws every BuiltObject in the galaxy (ships, bases, pirate fleets, traders,
 * abandoned ships) as a sprite centred on (xpos, ypos), rotated by heading.
 * Textures load lazily per pictureRef URL; without a DW:U install the grey dot
 * fallback is used and metrics fall back to a 2:1 area ratio.
 */
export class BuiltObjectLayer {
    root = new Container();
    /** The ship / base sprites (first child of root). */
    private ships = new Container();
    /** 19r: the base-game damage overlay over the sprites (always on; embers / scorch behind damageFx). */
    private damage: DamageOverlays<BuiltObject>;
    /** 19r: liveries / withered look under the damage (flag `liveries`). */
    readonly liveries: LiveryOverlays;
    private sprites = new Map<BuiltObject, Sprite>();
    private images = new Map<string, Promise<LoadedShipImage>>();
    /** Loaded images by URL, read synchronously each frame (null = failed). */
    private resolved = new Map<string, LoadedShipImage | null>();
    /** Task 13d: drawn size (px) of each built object at the last update. */
    private drawnPx = new Map<BuiltObject, number>();
    /** Art URL per pictureRef (render: perf pass — built once instead of a string per ship per frame). */
    private urlByPictureRef = new Map<number, string | null>();
    /** Live (not destroyed) built objects visited by the current update; the rest release their sprites. */
    private seen = new Set<BuiltObject>();
    // [concordArt] begin — scenario 19a: the Concord's ships (concordArt.ts: procedural hulls) and overlays.
    private concordFx = new ConcordFxLayer();
    private frame = 0;
    // [concordArt] end

    constructor(
        private galaxy: Galaxy,
        world: Container,
        private store: AssetStore,
        private overlays: MapOverlayState,
    ) {
        world.addChild(this.root);
        world.addChild(this.concordFx.root); // [concordArt]
        this.root.addChild(this.ships);
        this.liveries = new LiveryOverlays(this.root, galaxy);
        this.damage = new DamageOverlays<BuiltObject>(this.root);
    }

    /**
     * Load (once per URL) the ship art + its crop/content metrics. With an install the art comes from the shared
     * shipArt.ts cache: one read of the raw PNG gives the metrics and the thruster / light marker scan (from the raw
     * pixels) and a texture with those marker pixels painted out, as BuiltObjectImageCache.LoadSingleBuiltObjectImage
     * does at load.
     */
    private loadImage(url: string): Promise<LoadedShipImage> {
        let p = this.images.get(url);
        if (!p) {
            p = (async () => {
                if (this.store.dwuPresent) {
                    const art = await loadShipArt(url);
                    if (art !== null) return { texture: art.texture, metrics: art.metrics, art };
                }
                // No install, or the image is missing / empty: the grey dot, assuming the content fills about
                // half the texture area, centred.
                const texture = makeDotTexture('#cccccc', 32);
                useMinifyingFilter(texture);
                const metrics: ShipImageMetrics = {
                    areaRatio: 2,
                    cropSide: texture.width,
                    cropCenterX: texture.width / 2,
                    cropCenterY: texture.height / 2,
                };
                return { texture, metrics, art: null };
            })();
            this.images.set(url, p);
        }
        return p;
    }

    update(z: number, cam: Camera): void {
        const f = 1 / z;
        // Ships are drawn only while the original's zoom factor < 500.
        this.root.visible = f < BUILT_OBJECT_MAX_FACTOR;
        this.concordFx.root.visible = this.root.visible; // [concordArt]
        if (!this.root.visible) return;
        // [concordArt] begin — null with the scenario / flag off: every object keeps its stock art.
        const concord = concordArtEmpire(this.galaxy);
        const treasure = concord !== null ? concordTreasureShips(this.galaxy) : NO_TREASURE;
        const look = concord !== null ? concordArtLook(this.galaxy) : 'weathered';
        const nowMs = Date.now();
        this.frame++;
        this.concordFx.begin();
        // [concordArt] end
        this.damage.begin();
        const damageFx = artBundleFlag(this.galaxy, 'damageFx');
        const liveries = artBundleFlag(this.galaxy, 'liveries');
        this.liveries.root.visible = liveries;
        if (liveries) this.liveries.begin();
        // Camera.worldToScreen, inlined (no allocation per ship per frame).
        const camX = cam.x;
        const camY = cam.y;
        const halfW = cam.width / 2;
        const halfH = cam.height / 2;
        const maxX = cam.width + 100;
        const maxY = cam.height + 100;
        // TODO(port): Empire.IsObjectVisibleToThisEmpire(BuiltObject) (MainView.1.cs:883) — not in sim; all objects drawn
        this.seen.clear();
        for (const bo of this.galaxy.builtObjects) {
            // MainView.1.cs:867 `if (builtObject5 == null) continue;` — Galaxy.BuiltObjects keeps null holes after
            // CompleteTeardown (BuiltObject.2.cs:5522) until RemoveNullBuiltObjects (Galaxy.9.cs:2862) compacts it.
            if (bo === null || bo.hasBeenDestroyed) continue;
            this.seen.add(bo);
            if (liveries) this.liveries.observe(bo);
            const sx = (bo.xpos - camX) * z + halfW;
            const sy = (bo.ypos - camY) * z + halfH;
            let sprite = this.sprites.get(bo);
            // Cull more than 100 px outside the viewport.
            if (sx < -100 || sx > maxX || sy < -100 || sy > maxY) {
                if (sprite !== undefined) sprite.visible = false;
                this.drawnPx.delete(bo);
                continue;
            }
            // [concordArt] begin — the Concord's objects draw their own art (built lazily; hidden until then).
            const cv = concordVariantFor(bo, concord, treasure, look);
            const cArt = cv !== null ? concordShipArt(cv, this.frame) : null;
            if (cv !== null && cArt === null) {
                if (sprite !== undefined) sprite.visible = false;
                this.drawnPx.delete(bo);
                continue;
            }
            // [concordArt] end
            let img: LoadedShipImage | ConcordShipArt | null | undefined = cArt;
            if (img === null) {
                const pictureRef = resolveDrawPictureRef(bo);
                let url = this.urlByPictureRef.get(pictureRef);
                if (url === undefined) {
                    url = builtObjectImageUrl(pictureRef);
                    this.urlByPictureRef.set(pictureRef, url);
                }
                if (url === null) {
                    if (sprite !== undefined) sprite.visible = false;
                    this.drawnPx.delete(bo);
                    continue;
                }
                // Textures load once; until then (or if the load failed) the
                // sprite stays hidden. The frame reads the cache synchronously so
                // visibility is final before Pixi renders this tick.
                img = this.resolved.get(url);
                if (img === undefined || img === null) {
                    if (img === undefined && !this.images.has(url)) {
                        const u = url;
                        this.loadImage(u).then(
                            (r) => this.resolved.set(u, r),
                            () => this.resolved.set(u, null),
                        );
                    }
                    if (sprite !== undefined) sprite.visible = false;
                    this.drawnPx.delete(bo);
                    continue;
                }
            }
            const { texture, metrics } = img;
            if (sprite === undefined) {
                sprite = new Sprite(texture);
                this.ships.addChild(sprite);
                this.sprites.set(bo, sprite);
            }
            sprite.texture = texture;
            const px = builtObjectSizePx(
                bo.size,
                metrics.areaRatio,
                f,
                bo.design?.imageScalingType ?? DesignImageScalingMode.None,
                bo.design?.imageScalingFactor ?? 1,
            );
            this.drawnPx.set(bo, px);
            if (px < 1) {
                sprite.visible = false;
                continue;
            }
            sprite.position.set(bo.xpos, bo.ypos);
            sprite.anchor.set(metrics.cropCenterX / texture.width, metrics.cropCenterY / texture.height);
            sprite.rotation = bo.heading + Math.PI / 2;
            sprite.scale.set(px / metrics.cropSide / z);
            sprite.alpha = this.overlays.fadeCivilianShips && bo.owner === null ? 144 / 255 : 1;
            sprite.visible = true;
            // [concordArt] begin
            if (cArt !== null) {
                this.concordFx.draw(cArt, bo.xpos, bo.ypos, sprite.rotation, sprite.scale.x, sprite.anchor.x, sprite.anchor.y, bo.builtObjectID, px, nowMs);
            }
            // [concordArt] end
            // A Concord ship (cArt !== null) has no shipArt.ts record of its own — it's drawn by the concordFx pass
            // above instead, with its own weathered/pristine look (concordArtLook), so 19r's damage/liveries overlays
            // (keyed off the stock art record) skip it rather than fall over on a shape without `.art`.
            const shipArtRecord = 'art' in img ? img.art : null;
            if (liveries && shipArtRecord !== null) this.liveries.draw(bo, shipArtRecord, px, z, sprite.alpha);
            // 19r: MainView.cs 3253 method_73 → Main.Part12.cs 4988 method_106 while DamagedComponentCount > 0.
            if (bo.damagedComponentCount > 0 && shipArtRecord !== null) {
                const subject = shipDamageSubject(bo);
                if (subject !== null) this.damage.draw(bo, subject, shipArtRecord, bo.xpos, bo.ypos, bo.heading, px, z, damageFx, sprite.alpha);
            }
        }
        this.concordFx.end(); // [concordArt]
        this.damage.end();
        if (liveries) this.liveries.end();
        // Destroyed or removed objects: drop their sprite and drawn size (which also clears their selection ring / pick).
        releaseStaleSprites(this.sprites, this.seen, (bo, sprite) => {
            this.drawnPx.delete(bo);
            sprite.destroy();
        });
        // TODO(port): DrawShipSymbolXna (MainView.1.cs:1085-1110) — small symbol for ships too far away to show their art.
        // TODO(port): engine exhaust flames (MainView.1.cs ~1112-1133) — animated thrust frames behind moving ships.
    }

    /** Task 13d: drawn size in px of a built object from the last update (0 if unknown). */
    drawnSizePx(bo: BuiltObject): number {
        return this.drawnPx.get(bo) ?? 0;
    }

    // TODO(port): Empire.IsObjectVisibleToThisEmpire / GodMode (Main.Part11.cs method_145) — all objects pickable
    // TODO(port): ShipGroup lead-ship pick at f > 100, and creature/fighter pick at f <= 100 — not ported
    /** Task 13d (Main.Part11.cs method_145): the ship/base under the world point. */
    pick(wx: number, wy: number, f: number, player: Empire | null): BuiltObject | null {
        // ships are not drawn at f >= 500 (DrawShipSymbolXna not ported), so they are not pickable there
        if (f >= BUILT_OBJECT_MAX_FACTOR) return null;
        const list = this.galaxy.builtObjects.filter((b): b is BuiltObject => b !== null && !b.hasBeenDestroyed);
        if (f <= BUILT_OBJECT_PICK_SYSTEM_MAX_FACTOR) {
            return pickBuiltObjectBySize(list, wx, wy, f, (b) => this.drawnSizePx(b));
        }
        if (player === null) return null;
        const war = warEmpires(player.diplomaticRelations);
        return pickNearestBuiltObject(list, wx, wy, f, (b) =>
            builtObjectHiddenFromPick(b, this.galaxy.systems, this.galaxy.pirateEmpires, war),
        );
    }
}
