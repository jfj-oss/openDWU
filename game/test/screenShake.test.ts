// Explosion screen shake (render/screenShake.ts): Main.Part10.cs method_217 / 218 / 219, MainView.2.cs 2811-2815.
import { describe, expect, it } from 'vitest';
import { SHAKE_FRAMES, ScreenShake, explosionShakeAmplitude } from '../src/render/screenShake';

describe('explosionShakeAmplitude', () => {
    it('is size / 50 capped at 8, only above 150', () => {
        expect(explosionShakeAmplitude(150)).toBe(0);
        expect(explosionShakeAmplitude(151)).toBe(3);
        expect(explosionShakeAmplitude(299)).toBe(5);
        expect(explosionShakeAmplitude(10_000)).toBe(8);
    });
});

describe('ScreenShake', () => {
    it('alternates +amp / -amp for 7 frames, then rests', () => {
        const s = new ScreenShake();
        s.step();
        expect(s.active).toBe(false);
        s.trigger(4);
        const xs: number[] = [];
        for (let i = 0; i < SHAKE_FRAMES + 2; i++) {
            s.step();
            xs.push(s.dx);
        }
        expect(xs).toEqual([4, -4, 4, -4, 4, -4, 4, 0, 0]);
    });
    it('a new explosion restarts the count with its amplitude', () => {
        const s = new ScreenShake();
        s.trigger(3);
        s.step();
        s.step();
        s.trigger(8);
        s.step();
        expect(s.dx).toBe(8);
        let n = 1;
        for (; n < 20 && (s.step(), s.active); n++);
        expect(n).toBe(SHAKE_FRAMES);
    });
});
