// Soft-edged territory bitmap (src/render/territoryRaster.ts): owner colours by the original's ownership rule,
// anti-aliased coverage + a float binomial blur on premultiplied colour (no gap between rivals, smooth monotonic
// outer edge), hard clip at the galaxy edge, half-float storage, dithered 8-bit outputs.

import { describe, expect, it } from 'vitest';
import {
    blurTerritoryFloatSync,
    buildTerritoryRasterSync,
    halfToFloatTable,
    rasterTexel,
    rasterToRgba8Premultiplied,
    rasterToRgba8Straight,
    toHalf,
    type TerritoryRaster,
} from '../src/render/territoryRaster';
import type { TerritorySource } from '../src/render/territoryField';

const colorOf = (o: number): number => (o === 0 ? 0xff0000 : 0x0000ff);
const at = (r: TerritoryRaster, x: number, y: number): [number, number, number, number] =>
    rasterTexel(r, Math.floor(x / r.cell), Math.floor(y / r.cell));
const close = (v: number, want: number, eps = 2e-3): void => expect(Math.abs(v - want)).toBeLessThan(eps);

describe('territory raster', () => {
    const size = 1_000_000;
    it('paints the owner colour inside, nothing outside, with a smooth monotonic edge and no NaN', () => {
        const src: TerritorySource[] = [{ x: 500_000, y: 500_000, r: 200_000, owner: 0 }];
        const r = buildTerritoryRasterSync(src, size, size, colorOf);
        const c = at(r, 500_000, 500_000);
        close(c[0], 1);
        close(c[1], 0);
        close(c[2], 0);
        close(c[3], 1);
        expect(at(r, 50_000, 50_000)[3]).toBe(0);
        const t = halfToFloatTable();
        let partial = 0;
        let bad = 0;
        for (let o = 0; o < r.data.length; o += 4) {
            const a = t[r.data[o + 3]];
            if (!Number.isFinite(a) || a < 0 || a > 1.001) bad++;
            // Premultiplied: red == alpha (pure red owner), never more.
            if (!(t[r.data[o]] <= a + 1e-3)) bad++;
            if (a > 0.001 && a < 0.999) {
                partial++;
                if (!(Math.abs(t[r.data[o]] / a - 1) < 0.01) || t[r.data[o + 2]] !== 0) bad++;
            }
        }
        expect(bad).toBe(0);
        expect(partial).toBeGreaterThan(300);
        // Along rays from the centre the alpha never rises, and falls from ~1 to 0 over a few cells, not in one step.
        const ci = Math.floor(500_000 / r.cell);
        for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [1, 1], [-1, 1], [3, 2]]) {
            const len = Math.hypot(dx, dy);
            let prev = 2;
            let steps = 0;
            for (let s = 0; s < 400 / len; s += 0.25) {
                const x = Math.round(ci + (dx / len) * s * len);
                const y = Math.round(ci + (dy / len) * s * len);
                if (x < 0 || y < 0 || x >= r.width || y >= r.height) break;
                const a = rasterTexel(r, x, y)[3];
                if (Math.abs(dx) === Math.abs(dy) || dx === 0 || dy === 0) expect(a).toBeLessThanOrEqual(prev + 1e-3);
                if (a > 0.02 && a < 0.98) steps++;
                prev = a;
            }
            expect(steps).toBeGreaterThan(4);
        }
    });
    it('half-alpha line sits on the influence circle (the crisp mesh edge)', () => {
        const src: TerritorySource[] = [{ x: 500_000, y: 500_000, r: 200_000, owner: 0 }];
        const r = buildTerritoryRasterSync(src, size, size, colorOf);
        const j = Math.floor(500_000 / r.cell);
        let edge = -1;
        for (let i = Math.floor(500_000 / r.cell); i < r.width; i++) {
            if (rasterTexel(r, i, j)[3] < 0.5) {
                edge = (i + 0.5) * r.cell;
                break;
            }
        }
        expect(Math.abs(edge - 700_000)).toBeLessThan(1.5 * r.cell);
    });
    it('rival borders have no gap: alpha stays opaque and colours blend', () => {
        const src: TerritorySource[] = [
            { x: 400_000, y: 500_000, r: 300_000, owner: 0 },
            { x: 600_000, y: 500_000, r: 300_000, owner: 1 },
        ];
        const r = buildTerritoryRasterSync(src, size, size, colorOf);
        for (let y = 300_000; y < 700_000; y += 10_000) {
            for (let x = 450_000; x < 550_000; x += r.cell) expect(at(r, x, y)[3]).toBeGreaterThan(0.995);
        }
        const mid = at(r, 500_000, 500_000);
        expect(mid[0]).toBeGreaterThan(0.2);
        expect(mid[2]).toBeGreaterThan(0.2);
        close(mid[0] + mid[2], 1, 5e-3);
    });
    it('keeps the galaxy-edge clip hard', () => {
        const src: TerritorySource[] = [{ x: 0, y: 500_000, r: 300_000, owner: 0 }];
        const r = buildTerritoryRasterSync(src, size, size, colorOf);
        const e = rasterTexel(r, 0, Math.floor(500_000 / r.cell));
        close(e[3], 1);
        close(e[0], 1);
    });
    it('8-bit outputs: premultiplied never exceeds alpha; straight keeps the exact owner colour; dither keeps the mean', () => {
        const src: TerritorySource[] = [{ x: 500_000, y: 500_000, r: 200_000, owner: 0 }];
        const r = buildTerritoryRasterSync(src, size, size, colorOf);
        const p = rasterToRgba8Premultiplied(r);
        const s = rasterToRgba8Straight(r);
        const t = halfToFloatTable();
        let sumF = 0;
        let sum8 = 0;
        let bad = 0;
        for (let o = 0; o < p.length; o += 4) {
            if (p[o] > p[o + 3]) bad++;
            if (s[o + 3] > 0 && (s[o] !== 255 || s[o + 1] !== 0 || s[o + 2] !== 0)) bad++;
            sumF += t[r.data[o + 3]] * 255;
            sum8 += p[o + 3];
        }
        expect(bad).toBe(0);
        expect(Math.abs(sum8 - sumF) / sumF).toBeLessThan(1e-3);
    });
});

describe('float blur', () => {
    it('conserves mass, stays finite and in range, and leaves a uniform image unchanged', () => {
        const w = 64, h = 48;
        const img = new Float32Array(w * h * 4);
        for (let y = 10; y < 30; y++) for (let x = 20; x < 40; x++) img.set([0.5, 0.25, 1, 1], (y * w + x) * 4);
        const before = img.reduce((a, b) => a + b, 0);
        blurTerritoryFloatSync(img, w, h);
        let after = 0;
        let bad = 0;
        for (const v of img) {
            if (!Number.isFinite(v) || v < 0 || v > 1 + 1e-6) bad++;
            after += v;
        }
        expect(bad).toBe(0);
        expect(Math.abs(after - before) / before).toBeLessThan(1e-5);
        const flat = new Float32Array(w * h * 4).fill(0.7);
        blurTerritoryFloatSync(flat, w, h);
        expect(flat.every((v) => Math.abs(v - 0.7) < 1e-5)).toBe(true);
    });
});

describe('half floats', () => {
    it('round-trips 0..1 to within half precision', () => {
        const t = halfToFloatTable();
        for (let i = 0; i <= 10000; i++) {
            const v = i / 10000;
            const back = t[toHalf(v)];
            expect(Math.abs(back - v)).toBeLessThanOrEqual(Math.max(v * 2 ** -11, 2 ** -25));
        }
        expect(t[toHalf(1e-9)]).toBe(0);
        expect(t[toHalf(1)]).toBe(1);
    });
});
