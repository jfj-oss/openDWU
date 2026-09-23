import { describe, expect, it } from 'vitest';
import { Random } from '../src/sim/random';

describe('Random (.NET System.Random legacy port)', () => {
    it('seed 42: next() x3 matches .NET', () => {
        const r = new Random(42);
        expect([r.next(), r.next(), r.next()]).toEqual([1434747710, 302596119, 269548474]);
    });

    it('seed 42: next(0, 100) x5 matches .NET', () => {
        const r = new Random(42);
        expect([r.next(0, 100), r.next(0, 100), r.next(0, 100), r.next(0, 100), r.next(0, 100)]).toEqual([66, 14, 12, 52, 16]);
    });

    it('seed 0: next() matches .NET', () => {
        expect(new Random(0).next()).toBe(1559595546);
    });
});