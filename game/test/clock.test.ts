import { describe, expect, it } from 'vitest';
import { GalaxyTime, SPEED_MAX, SPEED_MIN, START_STAR_DATE, startStarDateForAge } from '../src/sim/galaxyTime';

describe('GalaxyTime clock (task 07b)', () => {
    it('starts paused at 1x on the start star date', () => {
        const t = new GalaxyTime(START_STAR_DATE);
        expect(t.paused).toBe(true);
        expect(t.speed).toBe(1);
        expect(t.currentStarDate).toBe(START_STAR_DATE);
    });

    it('advances game time by realDt * speed when running, 0 while paused', () => {
        const t = new GalaxyTime();
        t.togglePause(); // resume
        expect(t.advance(1000)).toBe(1000); // 1x: 1 s real -> 1 s game
        t.faster(); // 2x
        expect(t.advance(1000)).toBe(2000);
        t.togglePause(); // pause
        expect(t.advance(1000)).toBe(0);
    });

    it('doubles/halves speed clamped to [0.25, 4]', () => {
        const t = new GalaxyTime();
        t.faster();
        expect(t.speed).toBe(2);
        t.faster();
        expect(t.speed).toBe(SPEED_MAX); // 4
        t.faster();
        expect(t.speed).toBe(SPEED_MAX); // stays
        t.slower();
        expect(t.speed).toBe(2);
        t.slower();
        expect(t.speed).toBe(1);
        t.slower();
        expect(t.speed).toBe(0.5);
        t.slower();
        expect(t.speed).toBe(SPEED_MIN); // 0.25
        t.slower();
        expect(t.speed).toBe(SPEED_MIN); // stays
    });

    it('bound to a galaxy it is a view over galaxy.nowMs and the galaxy start date', () => {
        const galaxy = { nowMs: 0, age: 1 };
        const t = new GalaxyTime().bindGalaxy(galaxy);
        expect(t.startStarDate).toBe(startStarDateForAge(1));
        expect(t.currentStarDate).toBe(START_STAR_DATE + 30_000_000);
        galaxy.nowMs = 12_345;
        expect(t.elapsedMs).toBe(12_345);
        expect(t.currentStarDate).toBe(START_STAR_DATE + 30_000_000 + 12_345);
        // The scheduler owns the clock: a bound clock is never advanced/set by itself.
        t.togglePause();
        expect(() => t.advance(1000)).toThrow(/scheduler/);
        expect(() => (t.elapsedMs = 5)).toThrow(/scheduler/);
        t.togglePause();
        expect(t.advance(1000)).toBe(0);
    });
});
