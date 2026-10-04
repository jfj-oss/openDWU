// The volcanic glow over a volcanic planet / moon picture (render-only).
//
//   Main.Part13.cs 1666-1688 LoadEnvironmentOverlays — bitmap_195[0..19]: the files "VolcanicG*" of
//     images\environment\planets\volcanic\ in Directory.GetFiles order, i < GalaxyImages.HabitatImageCountVolcanic; a
//     theme's planets\volcanic\ folder replaces the stock one as soon as it exists (the qualifying GetFiles probe looks
//     at the STOCK folder, which always has VolcanicG files), each bitmap MakeTransparent()'d (the colour of the
//     lower-left pixel made transparent when that pixel is opaque, System.Drawing Bitmap.MakeTransparent).
//   MainView.cs 2515 method_50 — for a Volcanic habitat with 0 <= PictureRef - HabitatImageOffsetVolcanic < 20, that
//     glow scaled to the picture's size / 1.025, recoloured by method_224(Color(255, 64, 0), bool_13: true) (the
//     method_221 matrix: RGB replaced by the colour, alpha kept) and drawn centred over the picture — after the
//     cloud overlay and the planet shadow (method_78, MainView.1.cs 2002-2005; neither is ported, so here it lies on
//     the bare picture).
// TODO(port): the other method_50 sites (MainView.cs 2843 / 3800 / 3865: the small habitat pictures of the panels).
import { Texture } from 'pixi.js';
import { HabitatImageCountVolcanic, HabitatImageOffsetVolcanic } from '../sim/galaxyImages';
import { HabitatType, type Habitat } from '../sim/types';
import { activeCustomizationSet, windowsOrdinal } from '../sim/data/customization';
import { manifestFiles, useMinifyingFilter, type AssetStore } from './assets';
import { textureFromRgbaPixels } from './textureCanvas';

const VOLCANIC_DIR = 'images/environment/planets/volcanic';

/** method_50: the glow is drawn at the picture's size / 1.025. */
export const VOLCANIC_GLOW_SCALE = 1 / 1.025;
/** method_50: method_224(bitmap, Color.FromArgb(255, 64, 0), bool_13: true). */
export const VOLCANIC_GLOW_COLOR = [255, 64, 0] as const;

/** Directory.GetFiles(folder, "VolcanicG*"): names starting with "VolcanicG" (case-insensitive). */
function isGlowFile(name: string): boolean {
    return name.toLowerCase().startsWith('volcanicg');
}

/**
 * bitmap_195: the glow files LoadEnvironmentOverlays loads, as URLs (index i = the glow of PictureRef
 * HabitatImageOffsetVolcanic + i). The theme's planets/volcanic folder when it exists, else the stock folder (asset
 * manifest; [] without one). At most HabitatImageCountVolcanic.
 */
export function volcanicGlowUrls(): string[] {
    const set = activeCustomizationSet();
    let urls: string[];
    if (set !== null && set.dirExists(VOLCANIC_DIR)) {
        urls = set.listFiles(VOLCANIC_DIR).filter(isGlowFile).map((f) => set.listedFileUrl(VOLCANIC_DIR, f));
    } else {
        const stock = [...(manifestFiles('planets/volcanic') ?? [])].filter(isGlowFile).sort(windowsOrdinal);
        // The stock folder's URL (a theme without the folder: themedAssetUrl leaves it unchanged).
        urls = stock.map((f) => `/assets/dwu/${VOLCANIC_DIR}/${f}`);
    }
    // files2[localNum7] for num7 < 20: a folder with fewer files throws there (no glow past its count).
    return urls.slice(0, HabitatImageCountVolcanic);
}

/** method_50's glow index for `habitat` (PictureRef - HabitatImageOffsetVolcanic), or -1 when it gets none. */
export function volcanicGlowIndex(habitat: Pick<Habitat, 'type' | 'pictureRef'>): number {
    if (habitat.type !== HabitatType.Volcanic) return -1;
    const i = habitat.pictureRef - HabitatImageOffsetVolcanic;
    return i >= 0 && i < HabitatImageCountVolcanic ? i : -1;
}

/**
 * The glow's pixels as drawn (straight-alpha RGBA, in place): Bitmap.MakeTransparent() — the lower-left pixel's colour
 * becomes transparent when that pixel is opaque — then the method_221 matrix (RGB := (255, 64, 0), alpha kept).
 */
export function volcanicGlowPixels(rgba: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
    if (w > 0 && h > 0) {
        const k = (h - 1) * w * 4;
        if (rgba[k + 3] === 255) {
            const r = rgba[k];
            const g = rgba[k + 1];
            const b = rgba[k + 2];
            for (let i = 0; i < rgba.length; i += 4) {
                if (rgba[i] === r && rgba[i + 1] === g && rgba[i + 2] === b && rgba[i + 3] === 255) rgba[i + 3] = 0;
            }
        }
    }
    const [cr, cg, cb] = VOLCANIC_GLOW_COLOR;
    for (let i = 0; i < rgba.length; i += 4) {
        rgba[i] = cr;
        rgba[i + 1] = cg;
        rgba[i + 2] = cb;
    }
    return rgba;
}

/** The bitmap_195 textures, loaded once on first use (per active theme: the store is rebuilt with the view). */
export class VolcanicGlowTextures {
    private readonly urls = volcanicGlowUrls();
    private readonly textures = new Map<number, Promise<Texture | null>>();

    constructor(private readonly store: AssetStore) {}

    /** The glow texture for `habitat` (null: none, or the file is missing). */
    textureFor(habitat: Pick<Habitat, 'type' | 'pictureRef'>): Promise<Texture | null> {
        const i = volcanicGlowIndex(habitat);
        const url = i >= 0 ? this.urls[i] : undefined;
        if (url === undefined) return Promise.resolve(null);
        let p = this.textures.get(i);
        if (p === undefined) {
            p = this.load(url);
            this.textures.set(i, p);
        }
        return p;
    }

    private async load(url: string): Promise<Texture | null> {
        const bmp = await this.store.loadRawImage(url);
        if (bmp === null || typeof document === 'undefined') return null;
        const w = bmp.width;
        const h = bmp.height;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx === null) return null;
        ctx.drawImage(bmp, 0, 0);
        bmp.close();
        const tex = textureFromRgbaPixels(volcanicGlowPixels(ctx.getImageData(0, 0, w, h).data, w, h), w, h, false, `volcanicGlow:${url}`);
        useMinifyingFilter(tex);
        return tex;
    }
}
