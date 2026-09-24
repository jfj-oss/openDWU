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
import { AssetStore, makeDotTexture } from './assets';
import { Galaxy } from '../sim/galaxy';
import type { BuiltObject } from '../sim/builtObject';
import { BuiltObjectSubRole } from '../sim/builtObjectTypes';
import { DesignImageScalingMode } from '../sim/data/designSpecifications';
import type { MapOverlayState } from '../ui/mapOverlays';

// Galaxy.BuiltObjectDrawResizeFactor (Galaxy.1.cs).
export const BUILT_OBJECT_DRAW_RESIZE_FACTOR = 8.0;
// Ships are only drawn while the original's zoom factor double_0 < 500.
export const BUILT_OBJECT_MAX_FACTOR = 500;
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
    /** C# imageData.Size = image area / content-pixel count (measured on the
     * 30×30 rescale, so this is the scale-free equivalent). */
    areaRatio: number;
    /** Side of the padded square crop (bbox + 4 px padding each side). */
    cropSide: number;
    /** Centre of the content bbox in raw-image pixels (anchor point). */
    cropCenterX: number;
    cropCenterY: number;
}

/**
 * Pure port of CropImageContent (padding 4) + DetermineImageContentSize on the
 * raw RGBA. A content pixel is opaque and not opaque black (the C# also
 * excludes transparent-white and fully-transparent pixels, which already fail
 * `a > 0`). Returns null when the image has no content pixels.
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
    // Padded bbox (±4) made into a square centred on the bbox.
    const cropSide = Math.max(maxX - minX, maxY - minY) + 8;
    // C# measures on the 30×30 rescale, so this is the scale-free equivalent.
    const areaRatio = (cropSide * cropSide) / count;
    return {
        areaRatio,
        cropSide,
        cropCenterX: (minX + maxX) / 2,
        cropCenterY: (minY + maxY) / 2,
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

interface LoadedShipImage {
    texture: Texture;
    metrics: ShipImageMetrics;
}

/**
 * Draws every BuiltObject in the galaxy (ships, bases, pirate fleets, traders,
 * abandoned ships) as a sprite centred on (xpos, ypos), rotated by heading.
 * Textures load lazily per pictureRef URL; without a DW:U install the grey dot
 * fallback is used and metrics fall back to a 2:1 area ratio.
 */
export class BuiltObjectLayer {
    root = new Container();
    private sprites = new Map<BuiltObject, Sprite>();
    private images = new Map<string, Promise<LoadedShipImage>>();

    constructor(
        private galaxy: Galaxy,
        world: Container,
        private store: AssetStore,
        private overlays: MapOverlayState,
    ) {
        world.addChild(this.root);
    }

    /** Load (once per URL) the ship art + its crop/content metrics. */
    private loadImage(url: string): Promise<LoadedShipImage> {
        let p = this.images.get(url);
        if (!p) {
            p = (async () => {
                const texture = await this.store.loadFirst([url], () => makeDotTexture('#cccccc', 32));
                let metrics: ShipImageMetrics | null = null;
                if (this.store.dwuPresent) {
                    try {
                        metrics = await measureShipImage(url);
                    } catch {
                        metrics = null;
                    }
                }
                if (metrics === null) {
                    // Measuring failed (or no install): assume the content fills
                    // about half the texture area, centred.
                    metrics = {
                        areaRatio: 2,
                        cropSide: texture.width,
                        cropCenterX: texture.width / 2,
                        cropCenterY: texture.height / 2,
                    };
                }
                return { texture, metrics };
            })();
            this.images.set(url, p);
        }
        return p;
    }

    update(z: number, cam: Camera): void {
        const f = 1 / z;
        // Ships are drawn only while the original's zoom factor < 500.
        this.root.visible = f < BUILT_OBJECT_MAX_FACTOR;
        if (!this.root.visible) return;
        // TODO(port): Empire.IsObjectVisibleToThisEmpire(BuiltObject) (MainView.1.cs:883) — not in sim; all objects drawn
        for (const bo of this.galaxy.builtObjects) {
            if (bo.hasBeenDestroyed) continue;
            const s = cam.worldToScreen(bo.xpos, bo.ypos);
            let sprite = this.sprites.get(bo);
            // Cull more than 100 px outside the viewport.
            if (s.x < -100 || s.x > cam.width + 100 || s.y < -100 || s.y > cam.height + 100) {
                if (sprite !== undefined) sprite.visible = false;
                continue;
            }
            const url = builtObjectImageUrl(resolveDrawPictureRef(bo));
            if (url === null) {
                if (sprite !== undefined) sprite.visible = false;
                continue;
            }
            const imgPromise = this.loadImage(url);
            let settled = false;
            imgPromise.then(({ texture, metrics }) => {
                settled = true;
                if (sprite === undefined) {
                    sprite = new Sprite(texture);
                    this.root.addChild(sprite);
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
                if (px < 1) {
                    sprite.visible = false;
                    return;
                }
                sprite.position.set(bo.xpos, bo.ypos);
                sprite.anchor.set(metrics.cropCenterX / texture.width, metrics.cropCenterY / texture.height);
                sprite.rotation = bo.heading + Math.PI / 2;
                sprite.scale.set(px / metrics.cropSide / z);
                sprite.alpha = this.overlays.fadeCivilianShips && bo.owner === null ? 144 / 255 : 1;
                sprite.visible = true;
            });
            // While the texture is still loading the sprite (if any) stays hidden.
            if (!settled && sprite !== undefined) sprite.visible = false;
        }
        // TODO(port): DrawShipSymbolXna (MainView.1.cs:1085-1110) — small symbol for ships too far away to show their art.
        // TODO(port): engine exhaust flames (MainView.1.cs ~1112-1133) — animated thrust frames behind moving ships.
    }
}

/**
 * Measure a ship image's crop/content metrics: fetch the raw PNG, read its
 * pixels via a canvas (same pattern as sampleCentreColour in assets.ts) and
 * run shipImageMetrics over the full bitmap.
 */
async function measureShipImage(url: string): Promise<ShipImageMetrics> {
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
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, w, h).data;
    const m = shipImageMetrics(px, w, h);
    if (m === null) throw new Error(`no content pixels: ${url}`);
    return m;
}