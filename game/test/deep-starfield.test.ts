import { describe, expect, it } from 'vitest';
import {
    DeepStarfield,
    deepStarfieldAlpha,
    generateStarLayer,
    generateSystemPatches,
    layerOffset,
    layerTexelSizes,
    resampleNearest,
    screenPanDelta,
    snapToDevicePixels,
    starBrightness,
    STAR_BRIGHTNESS_AT_CUT,
    STARFIELD_FLARE_SCALE,
    starLayerTileSize,
    STAR_LAYERS,
    systemPatchDistanceWeight,
    systemPatchZoomAlpha,
    tileCopies,
} from '../src/render/deepStarfield';
import { backdropAlpha } from '../src/render/mainView';
import { Camera } from '../src/render/camera';
import { wheelNotches, wheelZoom } from '../src/render/viewInput';

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
            // Backdrop fades out exactly where the stars fade in (at >= the original's brightness at its F = 300 cut).
            expect(backdropAlpha(z, m) + deepStarfieldAlpha(z, m) / STAR_BRIGHTNESS_AT_CUT).toBeGreaterThanOrEqual(1 - 1e-9);
            prev = a;
        }
    });

    it('is exactly the original method_45 brightness once the crossfade is done (no extra dimming)', () => {
        // F = 1 / z: planet (1), system zoom (5, 50), the original's star range up to the F = 300 cut.
        for (const F of [1, 5, 50, 200, 299]) {
            expect(deepStarfieldAlpha(1 / F, m)).toBeCloseTo(Math.min(1, Math.pow(F, -0.25)), 12);
        }
        // Past the cut (still inside our backdrop window's far end): held at 300^-0.25.
        expect(STAR_BRIGHTNESS_AT_CUT).toBeCloseTo(0.24028, 5);
        expect(deepStarfieldAlpha(m * 14, m)).toBeCloseTo(STAR_BRIGHTNESS_AT_CUT, 12);
        expect(STARFIELD_FLARE_SCALE).toBe(1);
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
            expect(Number.isInteger(l.xs[i]) && Number.isInteger(l.ys[i])).toBe(true); // random.Next(0, tile)
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

describe('deep starfield per-star textures (Main.Part13.cs bitmap_197/198 + MainView.1.cs method_105)', () => {
    it('prescales layers 3..1 to 16 px then nearest to 6 / 7 / 11 px, layer 0 to 32 px (drawn at 20 px)', () => {
        expect(STAR_LAYERS.map((l) => [l.size, l.prescale, l.sampling])).toEqual([
            [6, 16, 'nearest'],
            [7, 16, 'nearest'],
            [11, 16, 'nearest'],
            [20, 32, 'linear'],
        ]);
        expect(STAR_LAYERS.map((l) => layerTexelSizes(l, 1))).toEqual([
            { prescale: 16, texture: 6 },
            { prescale: 16, texture: 7 },
            { prescale: 16, texture: 11 },
            { prescale: 32, texture: 32 },
        ]);
        // HiDPI: the nearest layers keep the original's pixels (1 texel per CSS px); layer 0 prescales at device res.
        expect(layerTexelSizes(STAR_LAYERS[0], 2)).toEqual({ prescale: 16, texture: 6 });
        expect(layerTexelSizes(STAR_LAYERS[3], 2)).toEqual({ prescale: 64, texture: 64 });
        expect(layerTexelSizes(STAR_LAYERS[3], 1.5)).toEqual({ prescale: 48, texture: 48 });
        expect(layerTexelSizes(STAR_LAYERS[3], 0)).toEqual({ prescale: 32, texture: 32 });
    });

    it('resamples nearest-neighbour by pixel centres', () => {
        // 4x1 -> 2x1 picks source pixels 1 and 3; 2x1 -> 4x1 doubles each pixel.
        const src = new Uint8ClampedArray([10, 0, 0, 255, 20, 0, 0, 255, 30, 0, 0, 255, 40, 0, 0, 255]);
        expect(Array.from(resampleNearest(src, 4, 1, 2, 1))).toEqual([20, 0, 0, 255, 40, 0, 0, 255]);
        const two = new Uint8ClampedArray([1, 2, 3, 4, 5, 6, 7, 8]);
        expect(Array.from(resampleNearest(two, 2, 1, 4, 1))).toEqual([1, 2, 3, 4, 1, 2, 3, 4, 5, 6, 7, 8, 5, 6, 7, 8]);
        // 16 -> 6 (layer 3) reads source columns 1, 4, 6, 9, 12, 14.
        const ramp16 = new Uint8ClampedArray(16 * 4);
        for (let i = 0; i < 16; i++) ramp16[i * 4] = i;
        const six = resampleNearest(ramp16, 16, 1, 6, 1);
        expect([0, 1, 2, 3, 4, 5].map((i) => six[i * 4])).toEqual([1, 4, 6, 9, 12, 14]);
    });
});

describe('deep starfield parallax under trackpad zoom and pans (Mac report: stars swirl on tiny zoom steps)', () => {
    // A camera far from the origin, like a real system (the original's absolute cam·z / divisor offset moves the
    // layers by cam·dz there: hundreds of px per tiny zoom step).
    const makeCam = (zoom: number): Camera => {
        const cam = new Camera();
        cam.setViewport(1440, 900);
        cam.minZoom = 1e-4;
        cam.centerOn(312_345.6, 187_654.3);
        cam.zoom = zoom;
        return cam;
    };
    const track = (sf: DeepStarfield, cam: Camera): void => sf.update(0, cam.x, cam.y, cam.zoom, cam.width, cam.height, 2);

    it('keeps the field still during a pinch about the view centre (many tiny ctrl+wheel deltas)', () => {
        for (const z0 of [1 / 50, 1 / 2, 1]) {
            const cam = makeCam(z0);
            const sf = new DeepStarfield(1);
            track(sf, cam);
            const start = sf.parallaxPan;
            for (let i = 0; i < 200; i++) {
                // Trackpad pinch: fractional pixel deltas, in then out.
                const dy = i < 100 ? -1.3 : 1.1;
                cam.zoomAt(cam.clampZoom(wheelZoom(cam.zoom, wheelNotches(dy, 0), 12)), cam.width / 2, cam.height / 2);
                track(sf, cam);
                const p = sf.parallaxPan;
                expect(Math.abs(p.x - start.x)).toBeLessThan(1e-6);
                expect(Math.abs(p.y - start.y)).toBeLessThan(1e-6);
            }
        }
    });

    it('moves the field by the map centre\'s shift (tiny, smooth) during a zoom at the cursor, and back on the reverse', () => {
        const cam = makeCam(1 / 50);
        const sf = new DeepStarfield(1);
        track(sf, cam);
        const start = sf.parallaxPan;
        const zooms: number[] = [];
        for (let i = 0; i < 100; i++) {
            const before = { x: cam.x, z: cam.zoom };
            cam.zoomAt(wheelZoom(cam.zoom, wheelNotches(-1.5, 0), 12), 1100, 300);
            zooms.push(cam.zoom);
            const p0 = sf.parallaxPan.x;
            track(sf, cam);
            // Per step: the centre's world shift × zoom, which is < the cursor's offset from the centre × the step.
            const step = sf.parallaxPan.x - p0;
            expect(step).toBeCloseTo((cam.x - before.x) * ((before.z + cam.zoom) / 2), 9);
            expect(Math.abs(step)).toBeLessThan((1100 - 720) * 0.01);
        }
        // Reverse the same steps (anchored at the same cursor): back to the start.
        for (let i = zooms.length - 2; i >= -1; i--) {
            cam.zoomAt(i >= 0 ? zooms[i] : 1 / 50, 1100, 300);
            track(sf, cam);
        }
        expect(sf.parallaxPan.x - start.x).toBeCloseTo(0, 6);
        expect(sf.parallaxPan.y - start.y).toBeCloseTo(0, 6);
    });

    it('pans by exactly the map\'s screen pan (the original\'s pan / divisor per layer)', () => {
        const cam = makeCam(1 / 7);
        const sf = new DeepStarfield(1);
        track(sf, cam);
        const start = sf.parallaxPan;
        for (let i = 0; i < 50; i++) {
            cam.panByScreen(-1.25, 0.5); // drag left / down: the camera moves right / up
            track(sf, cam);
        }
        expect(sf.parallaxPan.x - start.x).toBeCloseTo(62.5, 6);
        expect(sf.parallaxPan.y - start.y).toBeCloseTo(-25, 6);
        expect(screenPanDelta(100, 0.5, 104, 0.5)).toBe(2);
        expect(screenPanDelta(100, 0.5, 100, 0.9)).toBe(0); // a zoom about the centre pans nothing
    });

    it('snaps offsets to the device-pixel grid (1 / DPR CSS px), not whole CSS px', () => {
        expect(snapToDevicePixels(10.3, 1)).toBe(10);
        expect(snapToDevicePixels(10.3, 2)).toBe(10.5);
        expect(snapToDevicePixels(10.2, 2)).toBe(10);
        expect(snapToDevicePixels(10.4, 1.5)).toBeCloseTo(10.6667, 4);
        expect(snapToDevicePixels(10.3, 0)).toBe(10);
        // At DPR 2 a slow pan of 1 CSS px a frame moves layer 0 (divisor 38) by at most 1 device px per frame.
        let prev = snapToDevicePixels(layerOffset(0, 38, 1010), 2);
        for (let x = 1; x < 400; x++) {
            const o = snapToDevicePixels(layerOffset(x, 38, 1010), 2);
            expect(Math.abs(o - prev) * 2).toBeLessThanOrEqual(1);
            prev = o;
        }
    });
});
