import { describe, expect, it } from 'vitest';
import { backdropAlpha, fadeIn, orbitRingAlpha, regionLabelFont, starfieldAlpha } from '../src/render/mainView';
import { GalaxyLocationType } from '../src/sim/galaxyLocation';

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

// Task 02c: planet art appears at system zoom (not closer than factor ~4),
// and planet labels only once the art is shown.
describe('planet art window + label gating', () => {
    it('the dot -> planet-art crossfade window is z = 0.012..0.03 (factor ~83..33)', () => {
        expect(fadeIn(0.012, 0.012, 0.03)).toBeCloseTo(0, 6);
        expect(fadeIn(0.03, 0.012, 0.03)).toBeCloseTo(1, 6);
        expect(fadeIn(0.021, 0.012, 0.03)).toBeCloseTo(0.5, 6); // midpoint of the window
        expect(fadeIn(0.05, 0.012, 0.03)).toBeCloseTo(1, 6); // whole-system view: art fully in
    });

    it('label visibility (dotT > 0.5) is false at sector zoom, true at z = 0.05', () => {
        const visible = (z: number) => fadeIn(z, 0.012, 0.03) > 0.5;
        expect(visible(0.0005)).toBe(false); // sector zoom: no pile of labels
        expect(visible(0.012)).toBe(false); // start of the window
        expect(visible(0.021)).toBe(true); // mid-window
        expect(visible(0.05)).toBe(true); // system zoom
    });
});

// Task 12p: the old 'system-zoom minimum body sizes' describe is gone — its
// constants (14/7/40 px floors) were replaced by the original's compressed
// zoom-factor sizing, now covered in test/main-view-system-sizes.test.ts.

// Task 08f1: region/nebula location label fonts (MainView.2.cs 4675-4705).
// Labels are only drawn while 70 < factor <= maxFactor; the font branch
// depends on the location type and the factor.
describe('region label fonts', () => {
    // A typical full-galaxy factor for an 8e6-unit galaxy on a 1600x900
    // viewport (~minZoom 0.08 -> factor ~12500).
    const maxFactor = 12_500;

    it('returns null outside the visible window', () => {
        expect(regionLabelFont(GalaxyLocationType.NebulaCloud, 70, maxFactor)).toBeNull(); // not > 70
        expect(regionLabelFont(GalaxyLocationType.NebulaCloud, 69.9, maxFactor)).toBeNull();
        expect(regionLabelFont(GalaxyLocationType.RaceRegion, 70, maxFactor)).toBeNull();
        expect(regionLabelFont(GalaxyLocationType.NebulaCloud, maxFactor + 1, maxFactor)).toBeNull(); // > double_5
        expect(regionLabelFont(GalaxyLocationType.NebulaCloud, 0, maxFactor)).toBeNull();
    });

    it('is visible at the window edges (factor 70 exclusive, maxFactor inclusive)', () => {
        expect(regionLabelFont(GalaxyLocationType.NebulaCloud, 70.0001, maxFactor)).not.toBeNull();
        expect(regionLabelFont(GalaxyLocationType.NebulaCloud, maxFactor, maxFactor)).not.toBeNull();
    });

    it('nebula clouds: font_2 (>4000), font_0 (>1000), font_1 bold (else)', () => {
        expect(regionLabelFont(GalaxyLocationType.NebulaCloud, 4001, maxFactor)).toEqual({ size: 15.33, bold: false });
        expect(regionLabelFont(GalaxyLocationType.NebulaCloud, 4000, maxFactor)).toEqual({ size: 16.67, bold: false }); // not > 4000
        expect(regionLabelFont(GalaxyLocationType.NebulaCloud, 1001, maxFactor)).toEqual({ size: 16.67, bold: false });
        expect(regionLabelFont(GalaxyLocationType.NebulaCloud, 1000, maxFactor)).toEqual({ size: 18.67, bold: true }); // not > 1000
        expect(regionLabelFont(GalaxyLocationType.NebulaCloud, 100, maxFactor)).toEqual({ size: 18.67, bold: true });
    });

    it('non-nebula locations: font_3 (>4000), font_2 (>1000), font_0 (else)', () => {
        for (const type of [GalaxyLocationType.GalacticCore, GalaxyLocationType.SuperNova, GalaxyLocationType.RaceRegion]) {
            expect(regionLabelFont(type, 4001, maxFactor)).toEqual({ size: 10.67, bold: false });
            expect(regionLabelFont(type, 4000, maxFactor)).toEqual({ size: 15.33, bold: false });
            expect(regionLabelFont(type, 1001, maxFactor)).toEqual({ size: 15.33, bold: false });
            expect(regionLabelFont(type, 1000, maxFactor)).toEqual({ size: 16.67, bold: false });
            expect(regionLabelFont(type, 100, maxFactor)).toEqual({ size: 16.67, bold: false });
        }
    });
});