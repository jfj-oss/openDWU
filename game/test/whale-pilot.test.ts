// Art pilot (src/render/whalePilotLayer.ts): the creature size / frame conventions it reuses from the original and
// the palette statistics it prints.
import { describe, expect, it } from 'vitest';
import { artStats, creatureDrawPx, creatureFrameIndex, creatureZoomFactor, pilotActorPlacement, tintMatrix } from '../src/render/whalePilotLayer';

describe('whale pilot', () => {
    it('CalculateCreatureZoomFactor: divisor f up to 3, then max(3, f / 2) with the 240 px cap / f', () => {
        expect(creatureZoomFactor(1)).toEqual({ factor: 1, maxWidth: 240 });
        expect(creatureZoomFactor(10)).toEqual({ factor: 5, maxWidth: 24 });
        expect(creatureZoomFactor(4)).toEqual({ factor: 3, maxWidth: 60 });
    });

    it('creature size: sqrt(size / (content / 8)) on the 108 px loaded frame, capped', () => {
        // content 2432 → content / 8 = 304; size 304 → scale 1 → 108 px at f = 1.
        expect(creatureDrawPx(2432, 304, 1)).toBe(108);
        expect(creatureDrawPx(2432, 304, 10)).toBe(21); // 108 / 5 = 21 (cap 24)
        expect(creatureDrawPx(2432, 304 * 4, 1)).toBe(216);
        expect(creatureDrawPx(2432, 304 * 9, 1)).toBe(240); // capped
        expect(creatureDrawPx(2432, 304 * 9, 1, 3)).toBe(324);
    });

    it('method_113 frame schedule: 12 frames at 10 fps over a 1.2 s cycle', () => {
        expect(creatureFrameIndex(0, 12, 10)).toBe(0);
        expect(creatureFrameIndex(1199, 12, 10)).toBe(11);
        expect(creatureFrameIndex(1200, 12, 10)).toBe(0);
        expect(creatureFrameIndex(1100, 12, 10)).toBe(10);
    });

    it('artStats: luma, saturation and edge softness of a tiny image', () => {
        // 4 × 1: opaque grey, opaque red, half-alpha, transparent.
        const d = [128, 128, 128, 255, 255, 0, 0, 255, 0, 0, 0, 128, 0, 0, 0, 0];
        const s = artStats(d, 4, 1);
        expect(s.pixels).toBe(3);
        expect(s.meanSat).toBeCloseTo(1 / 3, 5);
        expect(s.softEdge).toBeCloseTo(1 / 3, 5);
        expect(s.longSidePx).toBe(3);
    });

    it('tintMatrix keeps luma at gain 1 for a grey pixel', () => {
        const m = tintMatrix([0.8, 0.9, 1.3], 0.3, 1);
        const g = 0.5;
        const out = [0, 1, 2].map((c) => (m[c * 5] + m[c * 5 + 1] + m[c * 5 + 2]) * g);
        expect(0.2126 * out[0] + 0.7152 * out[1] + 0.0722 * out[2]).toBeCloseTo(0.5, 6);
        expect(out[2]).toBeGreaterThan(out[0]);
    });
});

describe('whale pilot placement', () => {
    it('actors circle an anchor offset from the drawn home planet, so they ride along with its orbit', () => {
        const orbit = { ox: 700, oy: -300, radius: 90, omega: -0.012, angle0: Math.PI / 2 };
        const a = pilotActorPlacement(1000, 2000, orbit, 0, { x: 0, y: 0, heading: 0 });
        expect(a.x).toBeCloseTo(1700, 9);
        expect(a.y).toBeCloseTo(1790, 9);
        expect(a.heading).toBeCloseTo(0, 12);
        const moved = pilotActorPlacement(1050, 2020, orbit, 0, { x: 0, y: 0, heading: 0 });
        expect(moved.x - a.x).toBeCloseTo(50, 9);
        expect(moved.y - a.y).toBeCloseTo(20, 9);
    });
});
