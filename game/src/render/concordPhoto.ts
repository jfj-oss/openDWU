// The Oranthi Concord's ship art (concordArt.ts): real insect specimen photos (public domain;
// public/art/concord-photo/CREDITS.md) rendered offline by scripts/concord-photo-art.py into one image per class with
// its fittings (<name>.json: lights on the cybernetic parts, thruster runs at the nozzles, limb pieces) and limb
// sprites (<name>-limbs.png). This module loads them (once per class) and composes each variant: the image placed at
// the class's fill in the stock Ackdarian frame's texture side (CONCORD_PHOTO_SIDE), the fittings mapped through the
// same placement and baked by finishConcordImages (blue blink lights, strobes, running lights, engine glow, pure-blue
// thruster marks for the ambient exhaust), the image's own area ratio (× CONCORD_PHOTO_SCALE) so the opaque on-screen
// area matches the stock ship of the same size, and the limbs cut from the image with their attachment points for the
// close-zoom animation (ConcordFxLayer). Render-only.

import {
    concordPlacement,
    concordSpec,
    finishConcordImages,
    placeConcordHull,
    type ConcordImages,
    type ConcordKind,
    type ConcordLight,
    type ConcordLightKind,
    type ConcordVariant,
    type RgbaImage,
} from './concordArt';

/**
 * The fittings the build step drew onto the cybernetic parts (public/art/concord-photo/<name>.json), in source px:
 * lights [x, y, kind, colour | null] (navigation lights, strobes, the emerald running lights along the grafts, the
 * masthead, engine glow) and thruster runs [centre x, row y, half width] at each nozzle.
 */
export interface ConcordPhotoLimb {
    /** Rect in <name>-limbs.png, top-left in the source image, pivot (attachment point) in the source image. */
    rect: [number, number, number, number];
    at: [number, number];
    pivot: [number, number];
    kind: 'antenna' | 'leg';
}

export interface ConcordPhotoManifest {
    side: number;
    lights: [number, number, ConcordLightKind, [number, number, number] | null][];
    thrusters: [number, number, number][];
    limbs?: ConcordPhotoLimb[];
}

export interface ConcordPhotoSourceData {
    img: RgbaImage;
    manifest: ConcordPhotoManifest;
    /** The limb sprites (cut from `img`, so the same pixels) and `img` without them; absent for limbless sources. */
    limbs?: RgbaImage[];
    body?: RgbaImage;
}

/** Antennae sway a few degrees, legs twitch less (radians); frequencies in Hz, phase per limb. */
const LIMB_MOTION = { antenna: { amp: (4 * Math.PI) / 180, freq: 0.45 }, leg: { amp: (2.5 * Math.PI) / 180, freq: 0.8 } } as const;

/** Splits the decoded limb atlas into sprites and cuts them out of the source (exactly their pixels). Pure. */
export function concordPhotoSplitLimbs(img: RgbaImage, atlas: RgbaImage, limbs: readonly ConcordPhotoLimb[]): { limbs: RgbaImage[]; body: RgbaImage } {
    const body: RgbaImage = { w: img.w, h: img.h, data: new Uint8ClampedArray(img.data) };
    const out: RgbaImage[] = [];
    for (const l of limbs) {
        const [ax, ay, w, h] = l.rect;
        const data = new Uint8ClampedArray(w * h * 4);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const i = ((ay + y) * atlas.w + ax + x) * 4;
                const o = (y * w + x) * 4;
                data[o] = atlas.data[i];
                data[o + 1] = atlas.data[i + 1];
                data[o + 2] = atlas.data[i + 2];
                data[o + 3] = atlas.data[i + 3];
                if (atlas.data[i + 3] > 0) {
                    const bx = l.at[0] + x;
                    const by = l.at[1] + y;
                    if (bx >= 0 && by >= 0 && bx < img.w && by < img.h) body.data[(by * img.w + bx) * 4 + 3] = 0;
                }
            }
        }
        out.push({ w, h, data });
    }
    return { limbs: out, body };
}

/** The source images (public/art/concord-photo/<name>.png). */
export type ConcordPhotoSource = 'frigate' | 'destroyer' | 'battleship' | 'carrier' | 'construction' | 'explorer' | 'freighter' | 'treasure' | 'base' | 'port';

export function concordPhotoSourceOf(v: Pick<ConcordVariant, 'kind'>): ConcordPhotoSource {
    return v.kind;
}

export function concordPhotoUrl(src: ConcordPhotoSource): string {
    return `/art/concord-photo/${src}.png`;
}

/** Longest extent as a fraction of the texture side, per class (the size calibration below was measured with these). */
export const CONCORD_PHOTO_FILL: Readonly<Record<ConcordKind, number>> = {
    frigate: 0.89,
    destroyer: 0.92,
    battleship: 0.925,
    carrier: 0.925,
    freighter: 0.92,
    explorer: 0.84,
    construction: 0.84,
    treasure: 0.92,
    port: 0.965,
    base: 0.95,
};

/**
 * Texture side per class: the stock Ackdarian frame's side for the same class (family 7: escort 80, destroyer 170,
 * cruiser / capital ship 230, carrier 220, construction ship 210, exploration ship 100, large freighter 140, generic
 * base / large space port 300), so the photo art has the stock art's texel density at the same drawn size. The
 * treasure ship (no stock counterpart; drawn ×3) keeps 512.
 */
export const CONCORD_PHOTO_SIDE: Readonly<Record<ConcordKind, number>> = {
    frigate: 80,
    destroyer: 170,
    battleship: 230,
    carrier: 220,
    construction: 210,
    explorer: 100,
    freighter: 140,
    treasure: 512,
    base: 300,
    port: 300,
};

/**
 * Linear size correction per class on top of the image's own area ratio (which alone makes the opaque on-screen area
 * equal a stock ship's of the same size): measured against the stock frames at the same size, nudged toward the stock
 * length while the area stays within ±10% (the bugs keep their own, often broader, proportions).
 */
export const CONCORD_PHOTO_SCALE: Readonly<Partial<Record<ConcordKind, number>>> = {
    frigate: 0.99,
    destroyer: 0.955,
    battleship: 1.034,
    carrier: 0.99,
    construction: 1.037,
    explorer: 1.009,
    freighter: 1.0,
    base: 0.97,
    port: 0.935,
};

/**
 * Images of a photo variant from its decoded source (pure; no DOM): the source placed at the kind's fill, its
 * manifest's lights and thruster runs mapped through the same placement (each nudged onto the silhouette), then the
 * shared bake (light dots, pure-blue marks, halos by blink group: the ambient nav-light cycle and per-ship phase of
 * ConcordFxLayer, so they blink in step with the other Concord art). `side` overrides the texture side (full-size
 * renders).
 */
export function concordPhotoImages(v: ConcordVariant, src: ConcordPhotoSourceData, side?: number): ConcordImages {
    const cls = v.kind;
    const spec = { ...concordSpec(v.kind, v.bucket), side: side ?? CONCORD_PHOTO_SIDE[cls] };
    const S = spec.side;
    const fill = CONCORD_PHOTO_FILL[v.kind];
    const ship = placeConcordHull(src.img, S, fill);
    const pl = concordPlacement(src.img, S, fill);
    const lights: ConcordLight[] = [];
    const thrusters: [number, number, number][] = [];
    if (pl !== null) {
        const mx = (x: number): number => (x - pl.box.x0) * pl.k + pl.ox;
        const my = (y: number): number => (y - pl.box.y0) * pl.k + pl.oy;
        const opaque = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < S && y < S && ship.data[(y * S + x) * 4 + 3] > 0;
        const c = S / 2;
        for (const [x, y, k0, col] of src.manifest.lights) {
            // The build step's floodlights (the construction ship's dozer blade) are steady lamps here.
            const kind: ConcordLightKind = (k0 as string) === 'flood' ? 'lamp' : k0;
            let px = Math.min(S - 1, Math.max(0, Math.floor(mx(x))));
            let py = Math.min(S - 1, Math.max(0, Math.floor(my(y))));
            for (let n = 0; n < S && !opaque(px, py); n++) {
                px += Math.sign(Math.round(c) - px);
                py += Math.sign(Math.round(c) - py);
            }
            // Radii as the shaded hulls' fittings (running / deck lights smaller), the navigation lights and strobes
            // half as large again: on the dark chitin they would otherwise vanish at game size.
            const big = kind === 'port' || kind === 'starboard' || kind === 'strobe' || kind === 'white' || kind === 'blink';
            const r = Math.max(0.45, S * (kind === 'deck' || kind === 'lamp' ? 0.0022 : big ? 0.0051 : 0.0034));
            lights.push(col !== null ? { x: px + 0.5, y: py + 0.5, r, kind, c: col } : { x: px + 0.5, y: py + 0.5, r, kind });
        }
        for (const [x, y, hw] of src.manifest.thrusters) {
            const X = mx(x);
            let Y = Math.min(S - 1, Math.max(0, Math.round(my(y))));
            const w = Math.max(0.5, hw * pl.k * 0.8);
            const x0 = Math.max(0, Math.round(X - w));
            const x1 = Math.min(S - 1, Math.max(x0, Math.round(X + w) - 1));
            while (Y > 0 && !opaque(Math.round(X), Y)) Y--;
            thrusters.push([x0, x1, Y]);
        }
    }
    const images = finishConcordImages(spec, ship, lights, thrusters);
    const sc = CONCORD_PHOTO_SCALE[cls] ?? 1;
    images.areaScale = sc * sc;
    const man = src.manifest.limbs;
    if (pl !== null && src.body !== undefined && src.limbs !== undefined && man !== undefined) {
        // The limbless body at the same placement, with the same baked lights / marks (its halos are the ship's).
        const body = placeConcordHull(src.body, S, fill, src.img);
        finishConcordImages(spec, body, lights.map((l) => ({ ...l })), thrusters);
        images.bodyShip = body;
        images.limbs = man.map((l, i) => ({
            img: src.limbs![i],
            x: (l.pivot[0] - pl.box.x0) * pl.k + pl.ox,
            y: (l.pivot[1] - pl.box.y0) * pl.k + pl.oy,
            ax: l.pivot[0] - l.at[0],
            ay: l.pivot[1] - l.at[1],
            k: pl.k,
            kind: l.kind,
            amp: LIMB_MOTION[l.kind].amp,
            freq: LIMB_MOTION[l.kind].freq * (0.85 + 0.3 * ((i * 0.618) % 1)),
            phase: i * 1.9,
        }));
    }
    return images;
}

const sources = new Map<ConcordPhotoSource, ConcordPhotoSourceData | 'loading' | 'failed'>();

/** The decoded source (image, fittings manifest, limbs) of a variant, or null while it loads (started on first request). */
export function concordPhotoSource(v: ConcordVariant): ConcordPhotoSourceData | null {
    const name = concordPhotoSourceOf(v);
    const hit = sources.get(name);
    if (hit === 'loading' || hit === 'failed') return null;
    if (hit !== undefined) return hit;
    if (typeof Image === 'undefined' || typeof document === 'undefined') return null;
    sources.set(name, 'loading');
    const url = concordPhotoUrl(name);
    const image = decode(url);
    const manifest = fetch(url.replace(/\.png$/, '.json')).then((r) => {
        if (!r.ok) throw new Error(`manifest ${r.status}: ${url}`);
        return r.json() as Promise<ConcordPhotoManifest>;
    });
    const withLimbs = manifest.then(async (m) => ({ m, atlas: m.limbs !== undefined && m.limbs.length > 0 ? await decode(url.replace(/\.png$/, '-limbs.png')) : null }));
    Promise.all([image, withLimbs]).then(
        ([img, { m, atlas }]) => sources.set(name, atlas !== null && m.limbs !== undefined ? { img, manifest: m, ...concordPhotoSplitLimbs(img, atlas, m.limbs) } : { img, manifest: m }),
        (e: unknown) => {
            sources.set(name, 'failed');
            console.warn(`[concordPhoto] ${String(e)}`);
        },
    );
    return null;
}

/** Fetches and decodes a PNG to straight-alpha RGBA through a software canvas. */
function decode(url: string): Promise<RgbaImage> {
    return new Promise<RgbaImage>((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const w = img.naturalWidth;
            const h = img.naturalHeight;
            const c = document.createElement('canvas');
            c.width = w;
            c.height = h;
            const ctx = c.getContext('2d', { willReadFrequently: true });
            if (ctx === null || w === 0 || h === 0) return reject(new Error(`no pixels: ${url}`));
            ctx.drawImage(img, 0, 0);
            resolve({ w, h, data: ctx.getImageData(0, 0, w, h).data });
        };
        img.onerror = () => reject(new Error(`image load failed: ${url}`));
        img.src = url;
    });
}
