// Task 02c2: pure helpers for the system-zoom star renderer — tint scaling
// (MainView.1.cs method_65) and corona frame selection (method_117). The
// builders live in src/render/assets.ts which imports pixi.js, so this test
// stubs that module before importing them.
import { describe, expect, it, vi } from 'vitest';

vi.mock('pixi.js', () => ({ Assets: { load: vi.fn() }, Texture: class {} }));

const { scaleColour, coronaFrameIndex, starDiscUrl, coronaFrameUrls } = await import('../src/render/assets');

describe('scaleColour (method_65: per-channel scale, clamped to 0..255)', () => {
    it('scales each channel by f with integer truncation', () => {
        expect(scaleColour(0x808080, 1.2)).toBe(0x999999); // 128 * 1.2 = 153.6 -> 153 = 0x99
    });

    it('clamps channels above 255', () => {
        expect(scaleColour(0xffffff, 1.2)).toBe(0xffffff);
        expect(scaleColour(0xff8040, 2)).toBe(0xffff80); // G 128*2=255 ok, B 64*2=128
    });

    it('leaves zero channels at zero', () => {
        expect(scaleColour(0x0000ff, 3)).toBe(0x0000ff);
    });

    it('truncates rather than rounds', () => {
        // 100 * 1.5 = 150 exactly; 101 * 1.5 = 151.5 -> 151.
        expect(scaleColour(0x646464, 1.5)).toBe(0x969696);
        expect(scaleColour(0x656565, 1.5)).toBe(0x979797);
    });
});

describe('coronaFrameIndex (method_117: loopMs/stepMs frame stepping)', () => {
    const N = 100;
    const FPS = 15;

    it('is 0 at t=0', () => {
        expect(coronaFrameIndex(0, N, FPS)).toBe(0);
    });

    it('advances ~every 67 ms at 15 fps (loop 6666.7 ms / 99 steps ≈ 67.34 ms)', () => {
        expect(coronaFrameIndex(67, N, FPS)).toBe(0);
        expect(coronaFrameIndex(68, N, FPS)).toBe(1);
        expect(coronaFrameIndex(135, N, FPS)).toBe(2);
        expect(coronaFrameIndex(202, N, FPS)).toBe(2); // frame 3 starts at 2*67.34 = 134.7
        expect(coronaFrameIndex(203, N, FPS)).toBe(3);
    });

    it('wraps back to 0 after one full loop (~6667 ms)', () => {
        // stepMs = 6666.67 / 99 ≈ 67.34: frame 99 spans [6665.8, 6666.7), so
        // t=6666 is still frame 98 and the wrap to 0 happens at ~6666.7 ms.
        expect(coronaFrameIndex(6665, N, FPS)).toBe(98);
        expect(coronaFrameIndex(6666, N, FPS)).toBe(98);
        expect(coronaFrameIndex(6667, N, FPS)).toBe(0);
    });

    it('never returns an index >= frameCount for arbitrary times', () => {
        for (let t = 0; t < 20000; t += 7) {
            const i = coronaFrameIndex(t, N, FPS);
            expect(i).toBeGreaterThanOrEqual(0);
            expect(i).toBeLessThan(N);
        }
    });

    it('handles a single-frame set without dividing by zero', () => {
        expect(coronaFrameIndex(12345, 1, FPS)).toBe(0);
    });
});

describe('task 02c2 URL builders', () => {
    it('starDiscUrl addresses the shared discs', () => {
        expect(starDiscUrl(0)).toBe('/assets/dwu/images/environment/stars/star_disc_0.png');
        expect(starDiscUrl(2)).toBe('/assets/dwu/images/environment/stars/star_disc_2.png');
    });

    it('coronaFrameUrls lists all 100 frames, 1-based, 4-digit', () => {
        const b = coronaFrameUrls('B');
        const c = coronaFrameUrls('C');
        expect(b).toHaveLength(100);
        expect(c).toHaveLength(100);
        expect(b[0]).toBe('/assets/dwu/images/environment/stars/rays/CoronaB-0001.png');
        expect(b[99]).toBe('/assets/dwu/images/environment/stars/rays/CoronaB-0100.png');
        expect(c[0]).toBe('/assets/dwu/images/environment/stars/rays/CoronaC-0001.png');
        expect(c[99]).toBe('/assets/dwu/images/environment/stars/rays/CoronaC-0100.png');
    });
});