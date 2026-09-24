import { describe, expect, it } from 'vitest';
import { backdropAlpha, orbitRingAlpha, starfieldAlpha } from '../src/render/mainView';

// Task 02b2: close the mid-zoom black gap. The backdrop fades out over
// [m*2.5, m*14] (m = minZoom, whole-galaxy zoom) and the starfield must
// fade in over exactly that window so the two always overlap.
describe('mid-zoom layer crossfades', () => {
    // Typical values: 8e6 x 8e6 galaxy on a 1600x900 viewport gives
    // minZoom ~ 0.1; the original's zoom factor 150 is z = 1/150.
    const m = 0.1;

    it('backdrop + starfield alpha never drops below 0.6 between galaxy view and 100%', () => {
        for (let i = 0; i <= 2000; i++) {
            const z = m * Math.pow(1 / m, i / 2000); // log-spaced m .. 1
            const sum = backdropAlpha(z, m) + starfieldAlpha(z, m);
            expect(sum).toBeGreaterThanOrEqual(0.6 - 1e-9);
        }
    });

    it('the starfield is fully opaque by the time the backdrop is gone', () => {
        expect(backdropAlpha(m * 14, m)).toBeCloseTo(0, 6);
        expect(starfieldAlpha(m * 14, m)).toBeCloseTo(1, 6);
    });

    it('the starfield starts fading in where the backdrop starts fading out', () => {
        expect(backdropAlpha(m * 2.5, m)).toBeCloseTo(1, 6);
        expect(starfieldAlpha(m * 2.5, m)).toBeCloseTo(0, 6);
        expect(starfieldAlpha(m * 2.5 + m * 0.01, m)).toBeGreaterThan(0);
    });

    it('orbit rings appear once the outermost orbit spans >= ~40 px', () => {
        // Outermost orbit of 10000 world units: 40 px at z = 0.004.
        expect(orbitRingAlpha(0.003, 10_000)).toBe(0);
        expect(orbitRingAlpha(0.004, 10_000)).toBeCloseTo(0, 6);
        expect(orbitRingAlpha(0.006, 10_000)).toBeGreaterThan(0);
        expect(orbitRingAlpha(0.008, 10_000)).toBeCloseTo(0.5, 6);
        expect(orbitRingAlpha(1, 10_000)).toBeCloseTo(0.5, 6);
        expect(orbitRingAlpha(1, 0)).toBe(0);
    });
});