// Ion-strike lightning (render/lightning.ts): port of LightningGenerator.GenerateLightning + MainView.1.cs 1162-1201.
import { describe, expect, it } from 'vitest';
import { generateLightning, ionStrikeAlpha, ionStrikeSeed, ionStrikeSizePx, ionStrikeVisible } from '../src/render/lightning';
import { MIN_TIME } from '../src/sim/tick/simTime';

describe('generateLightning', () => {
    it('is deterministic per seed and differs between seeds', () => {
        const a = generateLightning(1234, 140);
        expect(generateLightning(1234, 140)).toEqual(a);
        expect(generateLightning(1235, 140).segments).not.toEqual(a.segments);
    });
    it('starts at the centre, draws the pink pass then the white pass over the same path', () => {
        const img = generateLightning(7, 200);
        expect(img.size).toBe(200);
        const n = img.segments.length / 2;
        expect(Number.isInteger(n) && n > 10).toBe(true);
        expect(img.segments[0]).toMatchObject({ x1: 100, y1: 100, color: 0xd08080 });
        expect(img.segments[n]).toMatchObject({ x1: 100, y1: 100, color: 0xffffff });
        for (let i = 0; i < n; i++) {
            expect(img.segments[n + i].x2).toBe(img.segments[i].x2);
            // 1.4x vs 0.8x the node width × size / 400 (at least 1 px).
            expect(img.segments[i].width).toBeGreaterThanOrEqual(img.segments[n + i].width);
        }
        // Each level darkens by 0.99: the second segment of the white pass is 252 (trunc(255 x 0.99)).
        expect(img.segments[n + 1].color).toBe(0xfcfcfc);
    });
    it('steps size / 50 to size / 33 px per node (double_1 x [0.5, 1.5))', () => {
        const img = generateLightning(99, 500);
        const s = img.segments[0];
        const step = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
        expect(step).toBeGreaterThanOrEqual(5);
        expect(step).toBeLessThan(15);
    });
    it('adds the glow rings (size / 15 down, alpha up to 64)', () => {
        const img = generateLightning(3, 300);
        expect(img.glow[0]).toMatchObject({ size: 20, x: 140, y: 140 });
        expect(img.glow[img.glow.length - 1].alpha).toBeLessThanOrEqual(64);
        expect(img.glow[0].alpha).toBe(3);
        expect(generateLightning(3, 5000).size).toBe(2000);
    });
});

describe('ion strike timing', () => {
    it('shows for 1400 ms after the strike', () => {
        expect(ionStrikeVisible(MIN_TIME, 0)).toBe(false);
        expect(ionStrikeVisible(1000, 2399)).toBe(true);
        expect(ionStrikeVisible(1000, 2400)).toBe(false);
    });
    it('flickers every 250 ms from 1 down to 0.05', () => {
        expect(ionStrikeAlpha(0)).toBe(1);
        expect(ionStrikeAlpha(125)).toBeCloseTo(0.525);
        expect(ionStrikeAlpha(250)).toBe(1);
        expect(ionStrikeAlpha(-10)).toBe(1);
    });
    it('reseeds every 3 game seconds and sizes 1.4 x the drawn width', () => {
        expect(ionStrikeSeed(10, 0)).toBe(10);
        expect(ionStrikeSeed(10, 2999)).toBe(10);
        expect(ionStrikeSeed(10, 3000)).toBe(11);
        expect(ionStrikeSeed(10, 61_000)).toBe(10);
        expect(ionStrikeSizePx(25)).toBe(35);
    });
});
