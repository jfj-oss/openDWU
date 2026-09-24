import { describe, expect, it } from 'vitest';
import { createGameClock, GAME_SPEEDS, stepSpeed } from '../src/sim/clock';

describe('GameClock (task 05c)', () => {
    it('starts running at 1x', () => {
        const c = createGameClock();
        expect(c.paused).toBe(false);
        expect(c.speed).toBe(1);
    });

    it('steps speed through the list in order', () => {
        let s = 1;
        s = stepSpeed(s, 1);
        expect(s).toBe(2);
        s = stepSpeed(s, 1);
        expect(s).toBe(4);
        s = stepSpeed(s, -1);
        expect(s).toBe(2);
        s = stepSpeed(s, -1);
        expect(s).toBe(1);
        s = stepSpeed(s, -1);
        expect(s).toBe(0.5);
        s = stepSpeed(s, -1);
        expect(s).toBe(0.25);
    });

    it('clamps to the ends of the speed list', () => {
        expect(stepSpeed(GAME_SPEEDS[0], -1)).toBe(GAME_SPEEDS[0]); // 0.25 stays
        expect(stepSpeed(GAME_SPEEDS[GAME_SPEEDS.length - 1], 1)).toBe(8); // 8 stays
    });

    it('snaps an unknown speed to the closest entry before stepping', () => {
        expect(stepSpeed(3, 1)).toBe(4); // closest to 3 is 2 -> up to 4
        expect(stepSpeed(3, -1)).toBe(1); // closest to 3 is 2 -> down to 1
    });
});