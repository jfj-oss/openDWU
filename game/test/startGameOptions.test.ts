import { describe, expect, it } from 'vitest';
import { defaultStartGameOptions, sectorsFor, starCountFor } from '../src/sim/startGameOptions';
import { GalaxyShape } from '../src/sim/types';

describe('starCountFor (task 06b, Start.cs BaconStart.method_60)', () => {
    it('maps the six star-amount slider ticks', () => {
        expect(starCountFor(0)).toBe(100);
        expect(starCountFor(1)).toBe(250);
        expect(starCountFor(2)).toBe(400);
        expect(starCountFor(3)).toBe(700);
        expect(starCountFor(4)).toBe(1000);
        expect(starCountFor(5)).toBe(1400);
    });

    it('defaults out-of-range indices to 400 (Small)', () => {
        expect(starCountFor(-1)).toBe(400);
        expect(starCountFor(6)).toBe(400);
    });
});

describe('sectorsFor (task 06b, Start.cs Start.method_69)', () => {
    it('maps the five physical-size slider ticks', () => {
        expect(sectorsFor(0)).toBe(4);
        expect(sectorsFor(1)).toBe(6);
        expect(sectorsFor(2)).toBe(8);
        expect(sectorsFor(3)).toBe(10);
        expect(sectorsFor(4)).toBe(15);
    });

    it('defaults out-of-range indices to 10 (Large)', () => {
        expect(sectorsFor(-1)).toBe(10);
        expect(sectorsFor(5)).toBe(10);
    });
});

describe('defaultStartGameOptions (task 06b)', () => {
    it('defaults to Spiral, star index 3, dimension index 2', () => {
        const opts = defaultStartGameOptions();
        expect(opts.shape).toBe(GalaxyShape.Spiral);
        expect(opts.starCountIndex).toBe(3);
        expect(opts.dimensionIndex).toBe(2);
        expect(typeof opts.seed).toBe('number');
    });
});
