// 19r item 1 — the damage overlay (BASE GAME port, always on). Pure: no Pixi / DOM, unit-tested.
//
// The original paints damage straight into the prepared sprite every time it rebuilds it:
//   DistantWorlds/Main.Part12.cs 4988 method_106 (ships) — only while DamagedComponentCount > 0: budget
//     int_ = (int)(width × height × 0.7 × DamagedComponentCount / Components.Count), new Random(BuiltObjectID), a
//     HatchBrush(HatchStyle.Cross, fore (160,160,160), back (1,1,1)) — grey scaffolding lines over near-black holes.
//   Main.Part12.cs 5002 method_107 (fighters) — while Health < 1: budget (int)(w × h × 0.7 × (1 − Health)),
//     new Random(FighterID), the same hatch.
//   Main.Part12.cs 5016 method_108 (creatures) — while Damage > 0: budget (int)(w × h × 0.3 × Damage /
//     DamageKillThreshhold), new Random(CreatureID), a SolidBrush in the species' flesh colour (Kaltor 110,32,80;
//     space slug 64,32,36; sand slug 160,56,0; Ardilus 48,8,20; default 1,1,1); SilverMist fades instead (method_376,
//     creatureLayer.ts creatureDamageAlpha).
//   Main.Part11.cs 107 method_113 (the painter) — `while (int_64 > 0)`: shape = Next(0, 6), x = Next(0, w − 1),
//     y = Next(0, h − 1), then one of six little two/three-rectangle clusters, each lowering the budget by its weight
//     (11, 8, 19, 7, 6, 13); FillRectangles(brush, all rects) over the sprite, then the black 1-px frame and the
//     MaskImage (black wherever the source pixel is transparent — BuiltObjectImageCache.cs 914 ScanForOutline) drawn
//     over it, and MakeTransparent(Black): the clusters survive only on the hull.
// The bitmaps are the *prepared* sprite at its drawn size (MainView.cs 4182 PrepareBuiltObjectImage → method_73), so
// the cluster count and pixel sizes are in drawn pixels: the overlay here is built at the drawn size too.
//
// Note: images/environment/overlays/damage/damage.png is not the ship mask — Main.Part13.cs 1630 loads it for the
// habitat-quality damage images (bitmap_194); the ship mask is generated from the sprite's own alpha (above).
//
// Flagged extras (`damageFx`, off = faithful): an ember glow in the clusters added by the latest damage (fading over
// a few seconds) and a scorch darkening around each cluster.

import { Random } from '../sim/random';
import { CreatureType } from '../sim/creature';

/** HatchBrush(HatchStyle.Cross, Color.FromArgb(160,160,160), Color.FromArgb(1,1,1)). */
export const DAMAGE_HATCH_FORE: readonly [number, number, number] = [160, 160, 160];
export const DAMAGE_HATCH_BACK: readonly [number, number, number] = [1, 1, 1];
/** GDI+ hatch cell (8 × 8); HatchStyle.Cross = one horizontal + one vertical line per cell. */
export const HATCH_CELL = 8;

export interface BlotchRect {
    x: number;
    y: number;
    w: number;
    h: number;
}

/** One cluster (one iteration of method_113's loop): its seed point and its rectangles. */
export interface BlotchCluster {
    x: number;
    y: number;
    shape: number;
    rects: BlotchRect[];
}

/** method_113's per-shape budget weights (num), shapes 0-5. */
export const BLOTCH_WEIGHTS: readonly number[] = [11, 8, 19, 7, 6, 13];

/** Main.Part12.cs 4988 method_106: (int)(w × h × 0.7 × damaged / components); 0 when nothing is damaged. */
export function shipDamageBudget(w: number, h: number, damagedComponents: number, components: number): number {
    if (!(damagedComponents > 0) || !(components > 0)) return 0;
    const share = damagedComponents / components;
    return Math.trunc(w * h * 0.7 * share);
}

/** Main.Part12.cs 5002 method_107: (int)(w × h × 0.7 × (1 − Health)) while Health < 1 (Health is a float). */
export function fighterDamageBudget(w: number, h: number, health: number): number {
    const hf = Math.fround(health);
    if (!(hf < 1)) return 0;
    const share = 1 - hf;
    return Math.trunc(w * h * 0.7 * share);
}

/** Main.Part12.cs 5016 method_108: (int)(w × h × 0.3 × Damage / DamageKillThreshhold) while Damage > 0. */
export function creatureDamageBudget(w: number, h: number, damage: number, killThreshold: number): number {
    if (!(damage > 0) || !(killThreshold > 0)) return 0;
    return Math.trunc(w * h * 0.3 * (damage / killThreshold));
}

/** method_108's brush per creature type (null = SilverMist, which fades instead). */
export function creatureDamageColour(type: CreatureType): [number, number, number] | null {
    switch (type) {
        case CreatureType.Kaltor:
            return [110, 32, 80];
        case CreatureType.RockSpaceSlug:
            return [64, 32, 36];
        case CreatureType.DesertSpaceSlug:
            return [160, 56, 0];
        case CreatureType.Ardilus:
            return [48, 8, 20];
        case CreatureType.SilverMist:
            return null;
        default:
            return [1, 1, 1];
    }
}

/**
 * Port of Main.Part11.cs 107 method_113's cluster loop: the clusters a `budget` buys on a w × h bitmap, drawing
 * Next(0, 6), Next(0, w − 1), Next(0, h − 1) per cluster from `rnd` (new Random(id) in every caller). Rectangles may
 * reach past the edges (GDI+ clips them). Because every caller seeds the stream with the object's id, a larger budget
 * on the same size yields the same clusters plus more — the fresh clusters of a new hit are the tail.
 */
export function damageClusters(rnd: Random, w: number, h: number, budget: number): BlotchCluster[] {
    const out: BlotchCluster[] = [];
    let left = budget;
    while (left > 0) {
        const shape = rnd.next(0, 6);
        const x = rnd.next(0, w - 1);
        const y = rnd.next(0, h - 1);
        let rects: BlotchRect[];
        switch (shape) {
            case 0:
                rects = [r(x, y, 3, 3), r(x + 3, y, 1, 2)];
                break;
            case 1:
                rects = [r(x, y, 2, 2), r(x + 1, y + 2, 2, 2)];
                break;
            case 2:
                rects = [r(x, y, 3, 5), r(x - 1, y + 2, 2, 2)];
                break;
            case 3:
                rects = [r(x, y, 2, 2), r(x - 1, y - 1, 2, 2)];
                break;
            case 4:
                rects = [r(x, y, 2, 2), r(x - 1, y - 1, 1, 1), r(x + 1, y + 2, 1, 1)];
                break;
            default:
                rects = [r(x, y, 3, 3), r(x - 2, y, 2, 2)];
                break;
        }
        out.push({ x, y, shape, rects });
        left -= BLOTCH_WEIGHTS[shape];
    }
    return out;
}

function r(x: number, y: number, w: number, h: number): BlotchRect {
    return { x, y, w, h };
}

/** Damage brush: the ships' / fighters' cross hatch, or a creature's solid flesh colour. */
export type DamageBrush = { kind: 'hatch' } | { kind: 'solid'; rgb: readonly [number, number, number] };

export const HATCH_BRUSH: DamageBrush = { kind: 'hatch' };

/** The brush colour at pixel (x, y): HatchStyle.Cross lines on every 8th row / column from the bitmap origin. */
export function brushColour(brush: DamageBrush, x: number, y: number): readonly [number, number, number] {
    if (brush.kind === 'solid') return brush.rgb;
    return x % HATCH_CELL === 0 || y % HATCH_CELL === 0 ? DAMAGE_HATCH_FORE : DAMAGE_HATCH_BACK;
}

export interface DamagePaintOptions {
    /** Flagged extra: darken the hull around each cluster (radius in px, 0 = off). */
    scorchRadius?: number;
    /** Scorch strength 0-1 at the cluster (falls off linearly to the radius). */
    scorchAlpha?: number;
}

/**
 * The overlay method_113 leaves on the sprite, as its own w × h RGBA layer (transparent where the sprite shows):
 * every cluster rectangle filled with the brush, then clipped by the hull (`hull[i]` ≠ 0 where the prepared sprite's
 * pixel is not transparent — the MaskImage test) and the 1-px frame the C# paints black and keys out. With
 * `scorchRadius` (damageFx) a soft dark halo is painted under the clusters first, also clipped to the hull.
 * Returns the number of painted pixels.
 */
export function paintDamageOverlay(
    out: Uint8ClampedArray,
    w: number,
    h: number,
    hull: ArrayLike<number>,
    clusters: readonly BlotchCluster[],
    brush: DamageBrush,
    opts: DamagePaintOptions = {},
): number {
    const inside = (x: number, y: number): boolean => x >= 1 && y >= 1 && x < w - 1 && y < h - 1 && hull[y * w + x] !== 0;
    const sr = opts.scorchRadius ?? 0;
    if (sr > 0) {
        const a0 = Math.max(0, Math.min(1, opts.scorchAlpha ?? 0.45));
        const ri = Math.ceil(sr);
        for (const c of clusters) {
            const cx = c.x + 1;
            const cy = c.y + 1;
            for (let y = cy - ri; y <= cy + ri; y++) {
                for (let x = cx - ri; x <= cx + ri; x++) {
                    if (!inside(x, y)) continue;
                    const d = Math.hypot(x - cx, y - cy);
                    if (d > sr) continue;
                    const a = Math.round(255 * a0 * (1 - d / sr));
                    const i = (y * w + x) * 4;
                    // Accumulate darkness (max, not sum: overlapping halos do not go black).
                    if (a > out[i + 3]) {
                        out[i] = 10;
                        out[i + 1] = 7;
                        out[i + 2] = 5;
                        out[i + 3] = a;
                    }
                }
            }
        }
    }
    let n = 0;
    for (const c of clusters) {
        for (const rc of c.rects) {
            const x0 = Math.max(0, rc.x);
            const y0 = Math.max(0, rc.y);
            const x1 = Math.min(w, rc.x + rc.w);
            const y1 = Math.min(h, rc.y + rc.h);
            for (let y = y0; y < y1; y++) {
                for (let x = x0; x < x1; x++) {
                    if (!inside(x, y)) continue;
                    const i = (y * w + x) * 4;
                    const col = brushColour(brush, x, y);
                    if (out[i + 3] !== 255 || out[i] !== col[0]) n++;
                    out[i] = col[0];
                    out[i + 1] = col[1];
                    out[i + 2] = col[2];
                    out[i + 3] = 255;
                }
            }
        }
    }
    return n;
}

/** Flagged extra (damageFx): an ember layer lighting the clusters `fromIndex` onward (the latest hit's new ones). */
export function paintEmbers(out: Uint8ClampedArray, w: number, h: number, hull: ArrayLike<number>, clusters: readonly BlotchCluster[], fromIndex: number): number {
    let n = 0;
    for (let k = Math.max(0, fromIndex); k < clusters.length; k++) {
        for (const rc of clusters[k].rects) {
            for (let y = Math.max(1, rc.y - 1); y < Math.min(h - 1, rc.y + rc.h + 1); y++) {
                for (let x = Math.max(1, rc.x - 1); x < Math.min(w - 1, rc.x + rc.w + 1); x++) {
                    if (hull[y * w + x] === 0) continue;
                    const core = x >= rc.x && x < rc.x + rc.w && y >= rc.y && y < rc.y + rc.h;
                    const i = (y * w + x) * 4;
                    const a = core ? 255 : 120;
                    if (a <= out[i + 3]) continue;
                    out[i] = 255;
                    out[i + 1] = core ? 150 : 90;
                    out[i + 2] = core ? 40 : 20;
                    out[i + 3] = a;
                    n++;
                }
            }
        }
    }
    return n;
}

/**
 * Hull mask of a ship / fighter image at the drawn size: the crop square of the raw art (shipImageMetrics), turned
 * 90° clockwise as LoadSingleBuiltObjectImage does (rotated (x', y') = raw (left + y', top + side − 1 − x')), sampled
 * nearest at `size` × `size`. 1 where the raw pixel has alpha (the MaskImage keeps exactly the transparent pixels
 * black).
 */
export function cropHullMask(
    rgba: ArrayLike<number>,
    w: number,
    h: number,
    crop: { cropSide: number; cropCenterX: number; cropCenterY: number },
    size: number,
): Uint8Array {
    const side = crop.cropSide;
    const left = Math.round(crop.cropCenterX - side / 2);
    const top = Math.round(crop.cropCenterY - side / 2);
    const out = new Uint8Array(size * size);
    const k = side / size;
    for (let yr = 0; yr < size; yr++) {
        const sy = Math.min(side - 1, Math.floor((yr + 0.5) * k));
        const x = left + sy;
        for (let xr = 0; xr < size; xr++) {
            const sx = Math.min(side - 1, Math.floor((xr + 0.5) * k));
            const y = top + (side - 1 - sx);
            if (x < 0 || y < 0 || x >= w || y >= h) continue;
            if (rgba[(y * w + x) * 4 + 3] > 0) out[yr * size + xr] = 1;
        }
    }
    return out;
}

/** Hull mask of a square raw frame (creature frames, 360²) turned 90° clockwise at `size`: rotated (x', y') = raw (y', side − 1 − x'). */
export function rotatedFrameMask(alpha: ArrayLike<number>, side: number, size: number): Uint8Array {
    return cropHullMask(alpha, side, side, { cropSide: side, cropCenterX: side / 2, cropCenterY: side / 2 }, size);
}

/** Hull mask of an unrotated image (a rig body texture) at w × h, sampled nearest. */
export function scaledMask(rgba: ArrayLike<number>, sw: number, sh: number, w: number, h: number): Uint8Array {
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
        const sy = Math.min(sh - 1, Math.floor(((y + 0.5) * sh) / h));
        for (let x = 0; x < w; x++) {
            const sx = Math.min(sw - 1, Math.floor(((x + 0.5) * sw) / w));
            if (rgba[(sy * sw + sx) * 4 + 3] > 0) out[y * w + x] = 1;
        }
    }
    return out;
}

/**
 * Overlay side (px) for a drawn size: the drawn size itself (the C# works in drawn pixels), stepped to quarter-octave
 * buckets so zooming does not rebuild every frame, and capped (past the cap the overlay is scaled up, blotches grow).
 */
export function damageOverlaySide(drawnPx: number, cap = 384): number {
    const p = Math.max(4, Math.min(cap, drawnPx));
    const step = Math.round(Math.log2(p) * 4) / 4;
    return Math.max(4, Math.min(cap, Math.round(2 ** step)));
}

/** Everything one overlay needs, built together (budget → clusters → layer). */
export function buildDamageLayer(
    seed: number,
    w: number,
    h: number,
    budget: number,
    hull: ArrayLike<number>,
    brush: DamageBrush,
    opts: DamagePaintOptions = {},
): { rgba: Uint8ClampedArray; clusters: BlotchCluster[]; painted: number } {
    const clusters = damageClusters(new Random(seed), w, h, budget);
    const rgba = new Uint8ClampedArray(w * h * 4);
    const painted = paintDamageOverlay(rgba, w, h, hull, clusters, brush, opts);
    return { rgba, clusters, painted };
}
