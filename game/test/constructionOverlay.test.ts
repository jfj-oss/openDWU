// Port check: the "under construction" sprite reveal (src/render/constructionOverlay.ts) against the C# —
// InfoPanel.cs:1371 OverlayConstructionProgress and the identical Main.Part11.cs:250 method_117 (the map
// version, wired at Controls/MainView.cs:3259). The percent-built formula, the noise-amplitude / spark-length
// budgets, the two-loop erosion (band boundary + spark dashes) against one seeded Random stream, and the
// method_116 reveal floor.
import { describe, expect, it } from 'vitest';
import { Random } from '../src/sim/random';
import {
    buildConstructionCoverageMask,
    buildConstructionMaskLayer,
    constructionBuiltWidthPx,
    constructionNoiseAmplitude,
    constructionPercentBuilt,
    constructionRevealFloor,
    constructionSparkMax,
} from '../src/render/constructionOverlay';

describe('constructionPercentBuilt (InfoPanel.cs:1382 / method_116 val)', () => {
    it('1 − unbuilt / components', () => {
        expect(constructionPercentBuilt(3, 12)).toBe(0.75);
        expect(constructionPercentBuilt(12, 12)).toBe(0);
        expect(constructionPercentBuilt(0, 12)).toBe(1);
    });
    it('guards componentCount <= 0 (never in practice) as fully built', () => {
        expect(constructionPercentBuilt(0, 0)).toBe(1);
    });
});

describe('noise amplitude / spark max (method_117 num2 / maxValue)', () => {
    it('Math.Max(3, size / 200)', () => {
        expect(constructionNoiseAmplitude(0)).toBe(3);
        expect(constructionNoiseAmplitude(400)).toBe(3);
        expect(constructionNoiseAmplitude(1000)).toBe(5);
        expect(constructionNoiseAmplitude(999)).toBe(4); // truncating division
    });
    it('Math.Max(8, size / 80)', () => {
        expect(constructionSparkMax(0)).toBe(8);
        expect(constructionSparkMax(400)).toBe(8);
        expect(constructionSparkMax(1000)).toBe(12);
    });
});

describe('constructionBuiltWidthPx (method_117 num = (int)(width * percentBuilt))', () => {
    it('truncates', () => {
        expect(constructionBuiltWidthPx(100, 0.756)).toBe(75);
        expect(constructionBuiltWidthPx(64, 1)).toBe(64);
        expect(constructionBuiltWidthPx(64, 0)).toBe(0);
    });
});

describe('constructionRevealFloor (method_116: Math.Max(val, floor))', () => {
    it('floors the map (0) and thumbnail (0.4) call sites', () => {
        expect(constructionRevealFloor(0.1, 0)).toBe(0.1);
        expect(constructionRevealFloor(0.1, 0.4)).toBe(0.4);
        expect(constructionRevealFloor(0.9, 0.4)).toBe(0.9);
    });
});

describe('buildConstructionCoverageMask (method_117 two loops, one Random(builtWidthPx) stream)', () => {
    it('0% built erases the whole bitmap (num3 = width, no offset can un-erase every row)', () => {
        // At builtWidthPx = 0 every band boundary is unbuiltWidth (= w) + a small jitter, clamped to w - 1 —
        // never 0 — so a sliver at the right edge stays uneroded (faithful to the C#: the jitter/spark loops
        // can only erase, and the band boundary is never forced all the way to w). Assert the erased pixel
        // COUNT is >= 90% instead of exactly 100% to avoid coupling the test to that edge sliver's exact width.
        const w = 64;
        const h = 48;
        const mask = buildConstructionCoverageMask(w, h, 0, constructionNoiseAmplitude(50), constructionSparkMax(50));
        const erased = Array.from(mask).filter((v) => v === 0).length;
        expect(erased / (w * h)).toBeGreaterThan(0.9);
    });
    it('100% built erases nothing but the spark dashes (unbuiltWidth = 0, so the boundary sits at 0)', () => {
        const w = 64;
        const h = 48;
        const mask = buildConstructionCoverageMask(w, h, w, constructionNoiseAmplitude(50), constructionSparkMax(50));
        const erased = Array.from(mask).filter((v) => v === 0).length;
        // Only the second loop's short spark dashes reach past x = 0 at 100% built.
        expect(erased).toBeGreaterThan(0);
        expect(erased / (w * h)).toBeLessThan(0.25);
    });
    it('a mid-build mask erases roughly the unbuilt fraction of the width, left of a jittered boundary', () => {
        const w = 100;
        const h = 80;
        const builtWidthPx = 60; // 60% built
        const mask = buildConstructionCoverageMask(w, h, builtWidthPx, constructionNoiseAmplitude(50), constructionSparkMax(50));
        // Every row's boundary is a visible column: find it per row and check it hugs `w - builtWidthPx` (± the
        // noise amplitude and, on spark rows, the spark length).
        for (let y = 0; y < h; y++) {
            let x = 0;
            while (x < w && mask[y * w + x] === 0) x++;
            expect(x).toBeGreaterThanOrEqual(0);
            expect(x).toBeLessThanOrEqual(w - builtWidthPx + constructionSparkMax(50) + constructionNoiseAmplitude(50));
        }
    });
    it('is a pure function of (w, h, builtWidthPx, noiseAmp, sparkMax) — same inputs, same mask (seeded solely by builtWidthPx)', () => {
        const a = buildConstructionCoverageMask(50, 40, 20, 3, 8);
        const b = buildConstructionCoverageMask(50, 40, 20, 3, 8);
        expect(a).toEqual(b);
    });
    it('replays exactly against an independent transcription of both loops sharing one Random(builtWidthPx) stream', () => {
        const w = 40;
        const h = 30;
        const builtWidthPx = 10;
        const amp = 3;
        const spark = 8;
        const unbuiltWidth = w - builtWidthPx;
        const rnd = new Random(builtWidthPx);
        const expected = new Uint8Array(w * h).fill(255);
        const eraseRow = (y: number, x1: number): void => {
            const x1c = Math.max(0, Math.min(w, x1));
            for (let x = 0; x < x1c; x++) expected[y * w + x] = 0;
        };
        let i = 0;
        while (i < h - 1) {
            const offset = rnd.next(-amp, amp);
            const boundaryX = Math.max(0, Math.min(w - 1, unbuiltWidth + offset));
            let bandH = rnd.next(3, 6);
            const val = Math.min(i + bandH, h - 1);
            bandH = Math.max(1, val - i);
            for (let y = i; y < i + bandH; y++) eraseRow(y, boundaryX);
            i += bandH;
        }
        let j = 0;
        while (j < h) {
            const sparkLen = rnd.next(2, spark);
            eraseRow(j, unbuiltWidth + sparkLen);
            j += Math.max(1, rnd.next(1, 3));
        }
        const mask = buildConstructionCoverageMask(w, h, builtWidthPx, amp, spark);
        expect(mask).toEqual(expected);
    });
    it('degenerate 0x0/negative size returns an empty (fully-255) buffer without throwing', () => {
        expect(() => buildConstructionCoverageMask(0, 0, 0, 3, 8)).not.toThrow();
        expect(buildConstructionCoverageMask(0, 5, 0, 3, 8).length).toBe(0);
    });
});

describe('buildConstructionMaskLayer (the RGBA the Pixi sprite mask is built from)', () => {
    it('alpha channel matches the coverage mask; RGB is opaque white (unused by an alpha mask)', () => {
        const w = 20;
        const h = 16;
        const percent = 0.5;
        const size = 400;
        const cov = buildConstructionCoverageMask(w, h, constructionBuiltWidthPx(w, percent), constructionNoiseAmplitude(size), constructionSparkMax(size));
        const rgba = buildConstructionMaskLayer(w, h, percent, size);
        for (let i = 0; i < cov.length; i++) {
            expect(rgba[i * 4 + 3]).toBe(cov[i]);
            expect(rgba[i * 4]).toBe(255);
            expect(rgba[i * 4 + 1]).toBe(255);
            expect(rgba[i * 4 + 2]).toBe(255);
        }
    });
});
