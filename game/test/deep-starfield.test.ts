import { describe, expect, it } from 'vitest';
import {
    deepStarfieldAlpha,
    generateStarLayer,
    generateSystemPatches,
    layerOffset,
    starBrightness,
    starLayerTileSize,
    STAR_LAYERS,
    systemPatchDistanceWeight,
    systemPatchZoomAlpha,
    tileCopies,
} from '../src/render/deepStarfield';
import { backdropAlpha } from '../src/render/mainView';

describe('deep starfield fade curve', () => {
    const m = 1.2e-4; // seed-1 galaxy on a 1920x1080 view

    it('is 0 at galaxy zoom and 1 at planet zoom', () => {
        expect(deepStarfieldAlpha(m, m)).toBe(0);
        expect(deepStarfieldAlpha(m * 2.5, m)).toBe(0);
        expect(deepStarfieldAlpha(1, m)).toBe(1);
    });

    it('is monotonic in zoom and crossfades with the backdrop (never both near zero)', () => {
        let prev = -1;
        for (let i = 0; i <= 2000; i++) {
            const z = m * Math.pow(1 / m, i / 2000);
            const a = deepStarfieldAlpha(z, m);
            expect(a).toBeGreaterThanOrEqual(prev - 1e-12);
            expect(a).toBeGreaterThanOrEqual(0);
            expect(a).toBeLessThanOrEqual(1);
            // Backdrop fades out exactly where the stars fade in (at >= half the original's z^0.25 brightness).
            expect(backdropAlpha(z, m) + deepStarfieldAlpha(z, m) * 2).toBeGreaterThanOrEqual(1 - 1e-9);
            prev = a;
        }
    });

    it('ports MainView.cs method_45: brightness = clamp(z^0.25)', () => {
        expect(starBrightness(1)).toBe(1);
        expect(starBrightness(4)).toBe(1);
        expect(starBrightness(1 / 16)).toBeCloseTo(0.5, 12);
        expect(starBrightness(0)).toBe(0);
    });

    it('patches fade in after the backdrop is gone and fade out by camera distance', () => {
        expect(systemPatchZoomAlpha(m * 14, m)).toBe(0);
        expect(systemPatchZoomAlpha(m * 60, m)).toBe(1);
        expect(systemPatchDistanceWeight(0, 1000)).toBe(1);
        expect(systemPatchDistanceWeight(1000, 1000)).toBe(1);
        expect(systemPatchDistanceWeight(1300, 1000)).toBeCloseTo(0.5, 9);
        expect(systemPatchDistanceWeight(1600, 1000)).toBe(0);
    });
});

describe('deep starfield generation', () => {
    it('is deterministic: same seed → same stars; different seed → different stars', () => {
        for (let li = 0; li < STAR_LAYERS.length; li++) {
            const a = generateStarLayer(1234, li, 1920, 17);
            const b = generateStarLayer(1234, li, 1920, 17);
            const c = generateStarLayer(1235, li, 1920, 17);
            expect(Array.from(a.xs)).toEqual(Array.from(b.xs));
            expect(Array.from(a.ys)).toEqual(Array.from(b.ys));
            expect(Array.from(a.tints)).toEqual(Array.from(b.tints));
            expect(Array.from(a.xs)).not.toEqual(Array.from(c.xs));
        }
    });

    it('same system → same colour patches; different systems differ', () => {
        const a = generateSystemPatches(7, 42);
        const b = generateSystemPatches(7, 42);
        const c = generateSystemPatches(7, 43);
        expect(a.count).toBe(b.count);
        expect(Array.from(a.data)).toEqual(Array.from(b.data));
        expect(Array.from(c.data)).not.toEqual(Array.from(a.data));
        expect(a.count).toBeGreaterThanOrEqual(2);
        expect(a.count).toBeLessThanOrEqual(4);
    });

    it("uses the original's layer counts and tile sizes (StarFieldSize 1000, XNA path)", () => {
        // n = 1000 / 4 = 250: layers 3..0 carry 4000 / 1000 / 250 / 62 stars.
        expect([0, 1, 2, 3].map((li) => generateStarLayer(1, li, 1920, 17).count)).toEqual([4000, 1000, 250, 62]);
        expect(starLayerTileSize(STAR_LAYERS[0], 1920)).toBe(1010);
        expect(starLayerTileSize(STAR_LAYERS[3], 1920)).toBe(2320);
        expect(starLayerTileSize(STAR_LAYERS[0], 5000)).toBe(2000); // capped (method_14)
        const l = generateStarLayer(9, 0, 1920, 17);
        for (let i = 0; i < l.count; i++) {
            expect(l.xs[i]).toBeGreaterThanOrEqual(0);
            expect(l.xs[i]).toBeLessThan(l.tile);
            expect(l.frames[i]).toBe(i % 17);
        }
    });

    it('wraps the parallax offset into [0, tile) and covers the view with enough copies', () => {
        expect(layerOffset(0, 6, 100)).toBe(0);
        expect(layerOffset(-60, 6, 100)).toBe(90);
        expect(layerOffset(6_000_000, 38, 1010)).toBeGreaterThanOrEqual(0);
        expect(layerOffset(6_000_000, 38, 1010)).toBeLessThan(1010);
        for (const [extent, tile] of [[1920, 1010], [1080, 1010], [1920, 2320], [3840, 1970]]) {
            // Worst offset (just under a tile) must still reach the far edge.
            expect(tileCopies(extent, tile) * tile - tile).toBeGreaterThanOrEqual(extent);
        }
    });
});
