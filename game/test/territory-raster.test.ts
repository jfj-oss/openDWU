// Soft-edged territory bitmap (src/render/territoryRaster.ts): owner colours by the original's ownership rule, a
// small blur at borders (no gap between rivals, fading outer edge), hard clip at the galaxy edge.

import { describe, expect, it } from 'vitest';
import { buildTerritoryRasterSync } from '../src/render/territoryRaster';
import type { TerritorySource } from '../src/render/territoryField';

const colorOf = (o: number): number => (o === 0 ? 0xff0000 : 0x0000ff);
const px = (r: ReturnType<typeof buildTerritoryRasterSync>, x: number, y: number): number[] => {
    const i = (Math.floor(y / r.cell) * r.width + Math.floor(x / r.cell)) * 4;
    return [r.data[i], r.data[i + 1], r.data[i + 2], r.data[i + 3]];
};

describe('territory raster', () => {
    const size = 1_000_000;
    it('paints the owner colour inside, nothing outside, with a soft edge', () => {
        const src: TerritorySource[] = [{ x: 500_000, y: 500_000, r: 200_000, owner: 0 }];
        const r = buildTerritoryRasterSync(src, size, size, colorOf);
        expect(px(r, 500_000, 500_000)).toEqual([255, 0, 0, 255]);
        expect(px(r, 50_000, 50_000)[3]).toBe(0);
        // Edge pixels are partially transparent but keep the owner colour (straight alpha).
        let partial = 0;
        for (let i = 0; i < r.data.length; i += 4) {
            const a = r.data[i + 3];
            if (a > 0 && a < 255) {
                partial++;
                expect(r.data[i]).toBeGreaterThan(240);
                expect(r.data[i + 2]).toBeLessThan(15);
            }
        }
        expect(partial).toBeGreaterThan(100);
    });
    it('rival borders have no gap: alpha stays opaque and colours blend', () => {
        const src: TerritorySource[] = [
            { x: 400_000, y: 500_000, r: 300_000, owner: 0 },
            { x: 600_000, y: 500_000, r: 300_000, owner: 1 },
        ];
        const r = buildTerritoryRasterSync(src, size, size, colorOf);
        for (let x = 450_000; x < 550_000; x += r.cell) expect(px(r, x, 500_000)[3]).toBe(255);
        const mid = px(r, 500_000, 500_000);
        expect(mid[0]).toBeGreaterThan(40);
        expect(mid[2]).toBeGreaterThan(40);
    });
    it('keeps the galaxy-edge clip hard', () => {
        const src: TerritorySource[] = [{ x: 0, y: 500_000, r: 300_000, owner: 0 }];
        const r = buildTerritoryRasterSync(src, size, size, colorOf);
        expect(px(r, 1, 500_000)[3]).toBe(255);
        expect(px(r, 1, 500_000)).toEqual([255, 0, 0, 255]);
    });
});
