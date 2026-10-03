import { describe, expect, it } from 'vitest';
import { STATION_PULL_MAX_RADIUS, STATION_PULL_SCALE, pulledStationOffset } from '../src/render/renderInterp';

describe('cosmetic station pull (drawn only)', () => {
    it('scales the offset in, capped at a fraction of the radius', () => {
        const out = { x: 0, y: 0 };
        // A base at the rim of a moon of diameter 169 (offset 84.3): drawn at 0.4 × the offset.
        pulledStationOffset(0, 84.3, 169, out);
        expect(out.x).toBe(0);
        expect(out.y).toBeCloseTo(84.3 * STATION_PULL_SCALE, 6);
        // Far past a tiny moon's rim (diameter 29, offset 80): capped at half the radius.
        pulledStationOffset(48, 64, 29, out);
        expect(Math.hypot(out.x, out.y)).toBeCloseTo((STATION_PULL_MAX_RADIUS * 29) / 2, 6);
        expect(out.y / out.x).toBeCloseTo(64 / 48, 6); // same direction
        // At the centre it stays at the centre.
        pulledStationOffset(0, 0, 100, out);
        expect(out.x).toBe(0);
        expect(out.y).toBe(0);
    });
});
