import { describe, expect, it } from 'vitest';
import {
    MAX_COVERAGE,
    MAX_PATCH_OFFSET,
    MIN_COVERAGE,
    MIN_PATCH_OFFSET,
    NebulaPatchRaster,
    tpdfDither,
    nebulaCoverage,
    nebulaTextureSize,
    patchTextureSize,
    SYSTEM_NEBULA_PALETTE,
    systemNebulaParams,
    systemNebulaZoomAlpha,
} from '../src/render/systemNebula';

describe('system nebula parameters', () => {
    it('are deterministic from (galaxy seed, system index)', () => {
        expect(systemNebulaParams(1, 42)).toEqual(systemNebulaParams(1, 42));
        expect(systemNebulaParams(1, 42)).not.toEqual(systemNebulaParams(1, 43));
        expect(systemNebulaParams(1, 42)).not.toEqual(systemNebulaParams(2, 42));
    });

    it('keep patch count, offset, coverage and palette in bounds', () => {
        const counts = new Set<number>();
        const colours = new Set<number>();
        for (let i = 0; i < 500; i++) {
            const p = systemNebulaParams(7, i);
            counts.add(p.patches.length);
            expect(p.patches.length).toBeGreaterThanOrEqual(1);
            expect(p.patches.length).toBeLessThanOrEqual(3);
            expect(p.coverage).toBeGreaterThanOrEqual(MIN_COVERAGE);
            expect(p.coverage).toBeLessThanOrEqual(MAX_COVERAGE);
            expect(nebulaCoverage(p)).toBeCloseTo(p.coverage, 9);
            for (const q of p.patches) {
                const d = Math.hypot(q.dx, q.dy);
                expect(d).toBeGreaterThanOrEqual(MIN_PATCH_OFFSET - 1e-12);
                expect(d).toBeLessThanOrEqual(MAX_PATCH_OFFSET + 1e-12);
                expect(Number.isInteger(q.colour) && q.colour >= 0 && q.colour < SYSTEM_NEBULA_PALETTE.length).toBe(true);
                expect(Number.isInteger(q.colour2) && q.colour2 >= 0 && q.colour2 < SYSTEM_NEBULA_PALETTE.length).toBe(true);
                expect(q.a).toBeGreaterThanOrEqual(q.b);
                expect(q.opacity).toBeGreaterThan(0);
                expect(q.opacity).toBeLessThan(0.7);
                colours.add(q.colour);
            }
        }
        expect([...counts].sort()).toEqual([1, 2, 3]);
        // Every palette colour is used somewhere.
        expect(colours.size).toBe(SYSTEM_NEBULA_PALETTE.length);
    });

    it('palette is dark purple, magenta, pink, blue, green — dark and low saturation', () => {
        expect(SYSTEM_NEBULA_PALETTE.map((c) => c.name)).toEqual(['dark purple', 'magenta', 'pink', 'blue', 'green']);
        for (const c of SYSTEM_NEBULA_PALETTE) {
            const max = Math.max(c.r, c.g, c.b);
            const min = Math.min(c.r, c.g, c.b);
            expect(max).toBeLessThanOrEqual(140); // dark
            expect((max - min) / max).toBeLessThan(0.7); // not neon
        }
    });
});

describe('system nebula fade and texture size', () => {
    it('crossfades in around the original zoom factor 210, monotonic', () => {
        expect(systemNebulaZoomAlpha(1 / 400)).toBe(0);
        expect(systemNebulaZoomAlpha(1 / 320)).toBe(0);
        expect(systemNebulaZoomAlpha(1 / 140)).toBe(1);
        expect(systemNebulaZoomAlpha(1 / 50)).toBe(1);
        expect(systemNebulaZoomAlpha(1)).toBe(1);
        const mid = systemNebulaZoomAlpha(1 / 210);
        expect(mid).toBeGreaterThan(0.2);
        expect(mid).toBeLessThan(0.8);
        let prev = -1;
        for (let f = 400; f >= 100; f -= 2) {
            const a = systemNebulaZoomAlpha(1 / f);
            expect(a).toBeGreaterThanOrEqual(prev);
            prev = a;
        }
    });

    it('texture size follows DPR, capped', () => {
        expect(nebulaTextureSize(1)).toBe(224);
        expect(nebulaTextureSize(2)).toBe(448);
        expect(nebulaTextureSize(3)).toBe(512);
        expect(nebulaTextureSize(4)).toBe(512);
        expect(nebulaTextureSize(Number.NaN)).toBe(224);
    });

    it('patch textures scale with the patch size, between base/2 and base', () => {
        for (let i = 0; i < 200; i++) {
            for (const q of systemNebulaParams(1, i).patches) {
                const t = patchTextureSize(320, q);
                expect(t).toBeGreaterThanOrEqual(160);
                expect(t).toBeLessThanOrEqual(320);
                expect(t % 16).toBe(0);
            }
        }
    });
});

describe('system nebula raster', () => {
    const size = 128;
    const rasterise = (seed: number, idx: number, patch = 0): NebulaPatchRaster => {
        const r = new NebulaPatchRaster(systemNebulaParams(seed, idx).patches[patch], size);
        while (!r.step(7));
        return r;
    };

    it('is deterministic, incremental-safe and transparent at the border', () => {
        const a = rasterise(1, 5);
        const b = new NebulaPatchRaster(systemNebulaParams(1, 5).patches[0], size);
        b.step(size);
        expect(a.data).toEqual(b.data);
        for (let i = 0; i < size; i++) {
            for (const [x, y] of [
                [i, 0],
                [i, size - 1],
                [0, i],
                [size - 1, i],
            ]) {
                expect(a.data[(y * size + x) * 4 + 3]).toBe(0);
            }
        }
    });

    it('has variable density: opaque cores, see-through haze and clear areas', () => {
        for (const idx of [1, 2, 3, 10, 99]) {
            const r = rasterise(3, idx);
            const p = r.params;
            let clear = 0;
            let thin = 0;
            let dense = 0;
            const n = size * size;
            for (let i = 0; i < n; i++) {
                const a = r.data[i * 4 + 3] / 255 / p.opacity;
                if (a < 0.02) clear++;
                else if (a < 0.4) thin++;
                else dense++;
            }
            expect(clear / n).toBeGreaterThan(0.2);
            expect(thin / n).toBeGreaterThan(0.05);
            expect(dense / n).toBeGreaterThan(0.01);
        }
    });

    it('stores valid premultiplied colour (no texel dither: banding is handled by the screen-space output dither)', () => {
        const big = 320;
        const p = systemNebulaParams(1, 3).patches[0];
        const r = new NebulaPatchRaster(p, big);
        r.step(big);
        let maxRun = 0;
        for (let j = big * 0.3; j < big * 0.7; j += 8) {
            let prev = -1;
            let run = 0;
            for (let i = 0; i < big; i++) {
                const o = (j * big + i) * 4;
                expect(r.data[o]).toBeLessThanOrEqual(r.data[o + 3]);
                expect(r.data[o + 2]).toBeLessThanOrEqual(r.data[o + 3]);
                const v = r.data[o];
                if (v > 0 && v === prev) run++;
                else run = 1;
                prev = v;
                maxRun = Math.max(maxRun, run);
            }
        }
        // Texel dither removed (magnified texels showed it as blotches at close zoom): only check it is defined.
        expect(maxRun).toBeGreaterThan(0);
    });

    it('TPDF dither is zero-mean, within ±1 step and triangular', () => {
        let sum = 0;
        let inner = 0;
        const n = 200 * 200;
        for (let y = 0; y < 200; y++) {
            for (let x = 0; x < 200; x++) {
                const v = tpdfDither(x, y, 12345);
                expect(Math.abs(v)).toBeLessThanOrEqual(1);
                sum += v;
                if (Math.abs(v) < 0.5) inner++;
            }
        }
        expect(Math.abs(sum / n)).toBeLessThan(0.01);
        expect(inner / n).toBeCloseTo(0.75, 1); // triangular: 3/4 of the mass within ±0.5
    });
});
