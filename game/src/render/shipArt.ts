// Ship / fighter art as the original's image caches hold it: the raw PNG is read once, its crop metrics and
// thruster / light marker positions are taken from the *raw* pixels (shared by the ship layer, the fighter layer
// and the ambient exhaust / lights), then the marker pixels are painted out with their neighbours' colour before
// the texture is made — so the pure-blue / pure-yellow marks never show on the drawn hull.
//
// Sources:
//   DistantWorlds.Types/BuiltObjectImageCache.cs 572 LoadSingleBuiltObjectImage — crop, rotate 90° clockwise,
//     ScanForThrusterLocations(Color.Blue, 20) then ScanForColorPoints(Color.Yellow, 20) on the rotated crop;
//     739 ScanForThrusterLocations / 816 ScanForColorPoints — each collects SampleForReplacementColor for every
//     matched pixel and SetPixel()s them all after the scan, *unless* the list reached its cap (it returns early);
//     795 SampleForReplacementColor — the per-channel integer mean of the left and right neighbours (x - 1 / x + 1,
//     both = 1 at x = 0 and both = width - 2 at the right edge).
//   DistantWorlds/Main.Part13.cs 1831 LoadFighterBomboer — fighter art: the same crop / rotate, Main.Part12.cs 4827
//     method_101 (the same thruster scan + replacement, method_102 the same sampler), no light scan.

import { Texture } from 'pixi.js';
import { useMinifyingFilter } from './assets';
import { shipImageMetrics, type ShipImageMetrics } from './builtObjectLayer';
import { MAX_MARKERS, scanShipMarkers, type ShipMarkers } from './ambientLayer';

/**
 * Port of the replacement half of ScanForThrusterLocations + ScanForColorPoints (BuiltObjectImageCache.cs 739 / 816;
 * Main.Part12.cs 4827 method_101 for fighters) applied to the raw image: returns a copy of `rgba` with every marker
 * pixel of `markers` (the scan of the raw image, scanShipMarkers) replaced by SampleForReplacementColor.
 *
 * Coordinates follow the C#: it scans the cropped, 90°-clockwise-rotated image, where rotated (x', y') is raw
 * (cropLeft + y', cropTop + side - 1 - x'); its sampler's left / right neighbours (x' ∓ 1) are therefore the raw
 * pixels below / above. Crop pixels outside the raw image are the crop's transparent back colour (0,0,0,0).
 * Thruster samples are all read before any is written, then written; the light samples are read afterwards from
 * the image with the thrusters already replaced. A list that reached the cap (20) is left unreplaced, because the
 * C# returns before its SetPixel loop.
 */
export function paintOutShipMarkers(
    rgba: ArrayLike<number>,
    w: number,
    h: number,
    m: ShipImageMetrics,
    markers: ShipMarkers,
    includeLights: boolean,
): Uint8ClampedArray {
    const out = new Uint8ClampedArray(rgba.length);
    for (let i = 0; i < rgba.length; i++) out[i] = rgba[i];
    const side = m.cropSide;
    const left = Math.round(m.cropCenterX - side / 2);
    const top = Math.round(m.cropCenterY - side / 2);
    /** Raw byte offset of rotated pixel (x', y'), or -1 outside the raw image. */
    const offset = (xr: number, yr: number): number => {
        const x = left + yr;
        const y = top + (side - 1 - xr);
        if (x < 0 || y < 0 || x >= w || y >= h) return -1;
        return (y * w + x) * 4;
    };
    const sample = (xr: number, yr: number, dst: number[]): void => {
        let x1 = Math.max(0, xr - 1);
        if (xr === 0) x1 = 1;
        let x2 = Math.min(side - 1, xr + 1);
        if (xr === side - 1) x2 = side - 2;
        const a = offset(x1, yr);
        const b = offset(x2, yr);
        for (let c = 0; c < 4; c++) {
            const va = a < 0 ? 0 : out[a + c];
            const vb = b < 0 ? 0 : out[b + c];
            dst.push(Math.trunc((va + vb) / 2));
        }
    };
    const apply = (points: number[], colours: number[]): void => {
        for (let k = 0; k < points.length; k++) {
            const o = points[k];
            if (o < 0) continue;
            out[o] = colours[k * 4];
            out[o + 1] = colours[k * 4 + 1];
            out[o + 2] = colours[k * 4 + 2];
            out[o + 3] = colours[k * 4 + 3];
        }
    };
    if (markers.thrusters.length < MAX_MARKERS) {
        const points: number[] = [];
        const colours: number[] = [];
        for (const t of markers.thrusters) {
            for (let j = t.top; j < t.top + t.height; j++) {
                sample(t.left, j, colours);
                points.push(offset(t.left, j));
            }
        }
        apply(points, colours);
    }
    if (includeLights && markers.lights.length < MAX_MARKERS) {
        const points: number[] = [];
        const colours: number[] = [];
        for (const p of markers.lights) {
            sample(p.x, p.y, colours);
            points.push(offset(p.x, p.y));
        }
        apply(points, colours);
    }
    return out;
}

/** A loaded ship / fighter image: the cleaned texture plus the raw-image crop metrics and marker scan. */
export interface ShipArt {
    texture: Texture;
    metrics: ShipImageMetrics;
    markers: ShipMarkers;
}

const loading = new Map<string, Promise<ShipArt | null>>();
const loaded = new Map<string, ShipArt | null>();

/**
 * Load (once per URL, shared by every layer) ship or fighter art: raw pixels → metrics + marker scan → markers
 * painted out → mipmapped texture. Resolves null when the image is missing or has no content pixels.
 * `includeLights` is false for fighter art (LoadFighterBomboer scans thrusters only).
 */
export function loadShipArt(url: string, includeLights = true): Promise<ShipArt | null> {
    let p = loading.get(url);
    if (p === undefined) {
        p = (async (): Promise<ShipArt | null> => {
            let art: ShipArt | null = null;
            try {
                const { data, w, h } = await readImagePixels(url);
                const metrics = shipImageMetrics(data, w, h);
                if (metrics !== null) {
                    const markers = scanShipMarkers(data, w, h, metrics);
                    const cleaned = paintOutShipMarkers(data, w, h, metrics, markers, includeLights);
                    const canvas = document.createElement('canvas');
                    canvas.width = w;
                    canvas.height = h;
                    const ctx = canvas.getContext('2d')!;
                    const img = ctx.createImageData(w, h);
                    img.data.set(cleaned);
                    ctx.putImageData(img, 0, 0);
                    const texture = Texture.from(canvas);
                    useMinifyingFilter(texture);
                    art = { texture, metrics, markers };
                }
            } catch {
                art = null;
            }
            loaded.set(url, art);
            return art;
        })();
        loading.set(url, p);
    }
    return p;
}

/** The art for `url` if it has finished loading (null = failed); undefined while loading or never requested. */
export function shipArtIfLoaded(url: string): ShipArt | null | undefined {
    return loaded.get(url);
}

/** Fetch an image and read its RGBA pixels through a canvas. */
async function readImagePixels(url: string): Promise<{ data: Uint8ClampedArray; w: number; h: number }> {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error(`image load failed: ${url}`));
        el.src = url;
    });
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) throw new Error(`zero-size image: ${url}`);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0);
    return { data: ctx.getImageData(0, 0, w, h).data, w, h };
}
