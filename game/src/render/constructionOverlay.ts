// 19r/M4h — the "under construction" sprite reveal (the user-report gap: no map/panel indicator for a ship or
// base being built, no % complete). Port of:
//   DistantWorlds.Controls/InfoPanel.cs:1371 OverlayConstructionProgress — the selection panel's portrait
//     (DrawBackgroundPicture:3480 `bitmap = OverlayConstructionProgress(_BuiltObject, bitmap);`).
//   Main.Part11.cs:238-291 method_115/116/117 — the identical map-sprite version (method_115 floors the reveal
//     at 0%; method_116(obj, bmp, 0.4f) at InfoPanel/build-queue thumbnails floors it at 40% so a freshly queued
//     hull is still recognisable), wired at Controls/MainView.cs:3253 method_73:
//       `if (builtObject_1.UnbuiltComponentCount > 0) bitmap = main_0.method_115(builtObject_1, bitmap);`
//     — the same call BuiltObject.Role == Base goes through too (a construction ship's future base is a BuiltObject
//     from the moment it is queued, all-Unbuilt components, drawn by the same method_73), so this single overlay
//     covers ships, bases, and a base a construction ship is building.
//
// Both call sites run the same algorithm (InfoPanel.cs's copy re-lists method_117's body verbatim): the bitmap is
// eroded (made transparent) from the left in proportion to (1 − percentBuilt), the boundary jittered per
// horizontal band and spiked with short "spark" dashes reaching past it — one `new Random(builtWidthPx)` stream
// feeding both loops in sequence, the same seeded-cluster idiom damageOverlay.ts's method_113 blotches use.
// `MakeTransparent(Color.Black)` at the end turns the erased region invisible; ported here as a 0/255 coverage
// mask (this module is pure — no DOM/Pixi — so it is unit-testable without a canvas) meant to be applied as a
// Pixi sprite mask over the object's own sprite: the sprite's own texture alpha already carries the hull shape,
// so the mask need only say which x-columns of each row are "not yet built" — it does not need to know the hull.

import { Random } from '../sim/random';

/** InfoPanel.cs:1382 / method_116's `val`: 1 − UnbuiltComponentCount / Components.Count. Callers only evaluate
 *  this while unbuiltComponentCount > 0 (so componentCount is > 0 too); componentCount <= 0 (never in practice)
 *  reads as fully built rather than dividing by zero. */
export function constructionPercentBuilt(unbuiltComponentCount: number, componentCount: number): number {
    if (componentCount <= 0) return 1;
    return 1 - unbuiltComponentCount / componentCount;
}

/** method_117's `num2 = Math.Max(3, builtObject_8.Size / 200)` — the per-row-band boundary jitter amplitude
 *  (integer division, `Size` is the object's design size stat, not a pixel measurement). */
export function constructionNoiseAmplitude(size: number): number {
    return Math.max(3, Math.trunc(size / 200));
}

/** method_117's `maxValue = Math.Max(8, builtObject_8.Size / 80)` — the spark dashes' max length. */
export function constructionSparkMax(size: number): number {
    return Math.max(8, Math.trunc(size / 80));
}

/** method_117's `num = (int)(bitmap.Width * double_7)` — the built width in bitmap pixels, and the seed of the
 *  `new Random(num)` both loops share. */
export function constructionBuiltWidthPx(w: number, percentBuilt: number): number {
    return Math.trunc(w * percentBuilt);
}

function clampInt(v: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, v));
}

/**
 * The w × h coverage mask (255 = the sprite shows through here, 0 = eroded / "not yet built"): method_117's two
 * loops against one `Random(builtWidthPx)` stream.
 *
 * First the per-band jittered boundary — `for (i = 0; i < h - 1; i += num6)`: `Next(-noiseAmp, noiseAmp)` offsets
 * the boundary off `unbuiltWidth`, `Next(3, 6)` picks the band's height (clamped so the band never runs past
 * `h - 1`), and every pixel left of the jittered boundary in that band is erased
 * (`FillRectangle(0, i, num5, num6, black)`).
 *
 * Then the spark dashes — `for (j = 0; j < h; j += Max(1, Next(1, 3)))`: `Next(2, sparkMax)` picks a length past
 * `unbuiltWidth`, and that single row is erased from 0 up to it (`DrawLine(0, j, width − num2 + num8, j, black)`),
 * reaching past the band boundary in short one-row spikes.
 *
 * Both loops only ever erase (never re-reveal a pixel the other loop already erased), matching two GDI+ fills
 * painted onto the same bitmap in sequence.
 */
export function buildConstructionCoverageMask(w: number, h: number, builtWidthPx: number, noiseAmp: number, sparkMax: number): Uint8Array {
    const out = new Uint8Array(w * h).fill(255);
    if (w <= 0 || h <= 0) return out;
    const unbuiltWidth = w - builtWidthPx;
    const rnd = new Random(builtWidthPx);
    const eraseRow = (y: number, x1: number): void => {
        const x1c = clampInt(x1, 0, w);
        if (x1c <= 0) return;
        const base = y * w;
        for (let x = 0; x < x1c; x++) out[base + x] = 0;
    };
    // Band loop.
    let i = 0;
    while (i < h - 1) {
        const offset = rnd.next(-noiseAmp, noiseAmp);
        const boundaryX = clampInt(unbuiltWidth + offset, 0, w - 1);
        let bandH = rnd.next(3, 6);
        const val = Math.min(i + bandH, h - 1);
        bandH = Math.max(1, val - i);
        for (let y = i; y < i + bandH; y++) eraseRow(y, boundaryX);
        i += bandH;
    }
    // Spark loop.
    let j = 0;
    while (j < h) {
        const sparkLen = rnd.next(2, sparkMax);
        eraseRow(j, unbuiltWidth + sparkLen);
        j += Math.max(1, rnd.next(1, 3));
    }
    return out;
}

/** method_116's floor: `Math.Max(percentBuilt, floor)` — 0 on the map (method_115), 0.4 on build-queue / info
 *  panel thumbnails (the two `method_116(obj, bmp, 0.4f)` call sites) so a freshly queued hull still reads as
 *  its ship class rather than a bare sliver. */
export function constructionRevealFloor(percentBuilt: number, floor: number): number {
    return Math.max(percentBuilt, floor);
}

/** Everything one overlay needs, mirroring damageOverlay's buildDamageLayer: the coverage mask expanded to an
 *  RGBA (white, alpha-only — only the alpha channel matters for a Pixi sprite mask) layer at w × h. */
export function buildConstructionMaskLayer(w: number, h: number, percentBuilt: number, size: number): Uint8ClampedArray {
    const builtWidthPx = constructionBuiltWidthPx(w, percentBuilt);
    const mask = buildConstructionCoverageMask(w, h, builtWidthPx, constructionNoiseAmplitude(size), constructionSparkMax(size));
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let k = 0; k < mask.length; k++) {
        const a = mask[k];
        rgba[k * 4] = 255;
        rgba[k * 4 + 1] = 255;
        rgba[k * 4 + 2] = 255;
        rgba[k * 4 + 3] = a;
    }
    return rgba;
}
