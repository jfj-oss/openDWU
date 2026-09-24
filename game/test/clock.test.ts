import { describe, expect, it } from 'vitest';
import { GalaxyTime, SPEED_MAX, SPEED_MIN, START_STAR_DATE } from '../src/sim/galaxyTime';

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
});