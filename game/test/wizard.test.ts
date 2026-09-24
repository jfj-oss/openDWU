import { describe, expect, it } from 'vitest';
import { defaultStartGameOptions, sectorsFor, starCountFor } from '../src/sim/startGameOptions';
import { GalaxyShape } from '../src/sim/types';
import { SHAPE_ENTRIES } from '../src/ui/screens/newGameWizard';

// Task 06b: the wizard's slider tables are ports of BaconStart.method_60
// (star amount) and Start.method_69 (physical size), each with a fixed
// default for out-of-range values. The DOM itself needs a browser, so this
// tests the pure mapping functions and defaults.

describe('starCountFor (task 06b)', () => {
    it('maps indices 0..5 to the vanilla counts', () => {
        expect([0, 1, 2, 3, 4, 5].map(starCountFor)).toEqual([100, 250, 400, 700, 1000, 1400]);
    });

    it('falls back to 400 when out of range', () => {
        expect(starCountFor(-1)).toBe(400);
        expect(starCountFor(6)).toBe(400);
        expect(starCountFor(99)).toBe(400);
    });
});

describe('sectorsFor (task 06b)', () => {
    it('maps indices 0..4 to square sector sizes', () => {
        expect([0, 1, 2, 3, 4].map(sectorsFor)).toEqual([4, 6, 8, 10, 15]);
    });

    it('falls back to 10 when out of range', () => {
        expect(sectorsFor(-1)).toBe(10);
        expect(sectorsFor(5)).toBe(10);
        expect(sectorsFor(99)).toBe(10);
    });
});

describe('defaultStartGameOptions (task 06b)', () => {
    it('selects Spiral (not the first radio), Standard stars, Medium size', () => {
        const o = defaultStartGameOptions();
        expect(o.shape).toBe(GalaxyShape.Spiral);
        expect(o.starCountIndex).toBe(3);
        expect(o.dimensionIndex).toBe(2);
        expect(typeof o.seed).toBe('number');
    });
});

describe('SHAPE_ENTRIES (task 06b)', () => {
    it('lists all six shapes in display order with preview images', () => {
        expect(SHAPE_ENTRIES.map((e) => e.shape)).toEqual([
            GalaxyShape.Elliptical,
            GalaxyShape.Spiral,
            GalaxyShape.Ring,
            GalaxyShape.Irregular,
            GalaxyShape.ClustersEven,
            GalaxyShape.ClustersVaried,
        ]);
        for (const e of SHAPE_ENTRIES) {
            expect(e.label.length).toBeGreaterThan(0);
            expect(e.image.startsWith('galaxyshape_')).toBe(true);
        }
    });
});