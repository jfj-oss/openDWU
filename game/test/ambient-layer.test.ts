// Ambient Main View effects (src/render/ambientLayer.ts): pure parts only — frame clock, blink timing, LOD
// gates, exhaust sizing/placement from the ship image's thruster marks and the marker scan orientation.
import { describe, expect, it } from 'vitest';
import {
    AMBIENT_ANIMATION_FPS,
    MINING_FRAME_COUNT,
    ambientVisibleAt,
    animationFrameIndex,
    animationSizePx,
    controlPaintLight,
    engineExhaustIndex,
    exhaustLengthPx,
    exhaustRect,
    exhaustSpeedFactor,
    gasMiningTint,
    lightSizePx,
    lightsOn,
    planetaryShieldAlpha,
    scanShipMarkers,
} from '../src/render/ambientLayer';
import { shipImageMetrics } from '../src/render/builtObjectLayer';
import { EngineType } from '../src/sim/builtObject';

describe('animation frame clock (AnimationSystem.method_1)', () => {
    it('steps trunc(trunc(n/fps*1000)/(n-1)) ms per frame and ends after the last frame', () => {
        // 120 frames @ 30 fps: trunc(4000 / 119) = 33 ms per frame.
        expect(animationFrameIndex(0, MINING_FRAME_COUNT, AMBIENT_ANIMATION_FPS)).toBe(0);
        expect(animationFrameIndex(32, MINING_FRAME_COUNT, 30)).toBe(0);
        expect(animationFrameIndex(33, MINING_FRAME_COUNT, 30)).toBe(1);
        expect(animationFrameIndex(119 * 33, MINING_FRAME_COUNT, 30)).toBe(119);
        expect(animationFrameIndex(120 * 33, MINING_FRAME_COUNT, 30)).toBe(-1);
        // 90 frames @ 30 fps: trunc(3000 / 89) = 33 ms.
        expect(animationFrameIndex(89 * 33 + 32, 90, 30)).toBe(89);
        expect(animationFrameIndex(90 * 33, 90, 30)).toBe(-1);
        expect(animationFrameIndex(-5, 90, 30)).toBe(0);
    });
});

describe('navigation light blink (MainView.1.cs:1085-1103)', () => {
    it('is on for 1.5 s then off for 1.0 s, phase-shifted by (id % 20) / 10 s', () => {
        expect(lightsOn(0, 0)).toBe(true);
        expect(lightsOn(1.49, 0)).toBe(true);
        expect(lightsOn(1.5, 0)).toBe(false);
        expect(lightsOn(2.49, 0)).toBe(false);
        expect(lightsOn(2.5, 0)).toBe(true);
        // id 15 adds 1.5 s: off at t = 0.
        expect(lightsOn(0, 15)).toBe(false);
        expect(lightsOn(0, 35)).toBe(false);
        expect(lightsOn(1.0, 15)).toBe(true);
    });
    it('sizes the light from the zoom factor and tints it with ControlPaint.Light', () => {
        expect(lightSizePx(35, 1)).toBe(18);
        expect(lightSizePx(35, 4)).toBe(9);
        expect(lightSizePx(35, 10000)).toBe(1);
        // ControlPaint.Light keeps greys grey and lightens them.
        const g = controlPaintLight(0x404040);
        expect((g >> 16) & 0xff).toBe(g & 0xff);
        expect(g & 0xff).toBeGreaterThan(0x40);
        // Pure red lightens towards white but stays red-dominant.
        const r = controlPaintLight(0xff0000);
        expect((r >> 16) & 0xff).toBe(255);
        expect(r & 0xff).toBeGreaterThan(0);
        expect(r & 0xff).toBeLessThan(255);
    });
});

describe('LOD gates', () => {
    it('shows ambient effects only while ships are drawn (f < 500)', () => {
        expect(ambientVisibleAt(1)).toBe(true);
        expect(ambientVisibleAt(499.9)).toBe(true);
        expect(ambientVisibleAt(500)).toBe(false);
    });
    it('draws an animation at trunc(size / f) px (vanishing at sector zoom)', () => {
        expect(animationSizePx(60, 1)).toBe(60);
        expect(animationSizePx(60, 2.5)).toBe(24);
        expect(animationSizePx(60, 61)).toBe(0);
    });
    it('pulses the planetary shield between 0.6 and 0.8 alpha over two seconds', () => {
        expect(planetaryShieldAlpha(0, 0)).toBeCloseTo(0.8);
        expect(planetaryShieldAlpha(0, 500)).toBeCloseTo(0.7);
        expect(planetaryShieldAlpha(1, 0)).toBeCloseTo(0.6);
        expect(planetaryShieldAlpha(1, 999)).toBeCloseTo(0.7998);
    });
});

describe('engine exhaust (PrepareEngineExhaust)', () => {
    it('lengthens with target speed bands', () => {
        expect(exhaustSpeedFactor(0, 20, 30)).toBe(0);
        expect(exhaustSpeedFactor(3, 20, 30)).toBe(1);
        expect(exhaustSpeedFactor(15, 20, 30)).toBe(1.7);
        expect(exhaustSpeedFactor(25, 20, 30)).toBe(2.5);
        expect(exhaustSpeedFactor(40, 20, 30)).toBe(0);
        // num5 = trunc(factor * 0.15 * P1), rounded up to even.
        expect(exhaustLengthPx(100, 1)).toBe(16); // 15 -> 16
        expect(exhaustLengthPx(100, 2.5)).toBe(38); // 37 -> 38
        expect(exhaustLengthPx(100, 1.7)).toBe(26); // 25 -> 26 (float 25.5 truncated)
    });
    it('maps engine types to thruster art 0..5', () => {
        expect(engineExhaustIndex(EngineType.Proton)).toBe(0);
        expect(engineExhaustIndex(EngineType.TurboThruster)).toBe(5);
        expect(engineExhaustIndex(EngineType.Undefined)).toBe(-1);
    });

    // A 40x40 raw image, ship facing up (-y): opaque grey hull x 10..29, y 5..34, a pure-blue thruster line at
    // y = 34, x 18..21, and two pure-yellow lights at (10, 15) and (29, 15).
    function makeShip(): Uint8ClampedArray {
        const w = 40;
        const px = new Uint8ClampedArray(w * w * 4);
        const set = (x: number, y: number, r: number, g: number, b: number) => {
            const i = (y * w + x) * 4;
            px[i] = r;
            px[i + 1] = g;
            px[i + 2] = b;
            px[i + 3] = 255;
        };
        for (let y = 5; y <= 34; y++) for (let x = 10; x <= 29; x++) set(x, y, 128, 128, 128);
        for (let x = 18; x <= 21; x++) set(x, 34, 0, 0, 255);
        set(10, 15, 255, 255, 0);
        set(29, 15, 255, 255, 0);
        return px;
    }

    it('scans thruster marks in the 90°-clockwise frame: the raw bottom edge becomes the rear (left) column', () => {
        const rgba = makeShip();
        const m = shipImageMetrics(rgba, 40, 40)!;
        const mk = scanShipMarkers(rgba, 40, 40, m);
        expect(mk.side).toBe(m.cropSide);
        expect(mk.thrusters.length).toBe(1);
        const t = mk.thrusters[0];
        // Raw bottom row y = 34 -> rotated x' = side - 1 - (34 - top): the rearmost ship column, left of centre.
        expect(t.left).toBeLessThan(mk.side / 2);
        expect(t.height).toBe(4);
        expect(mk.minThrusterLeft).toBe(t.left);
        // The line is centred across the hull: rotated rows centred on the crop middle.
        expect(Math.abs(t.top + t.height / 2 - mk.side / 2)).toBeLessThanOrEqual(1);
        // Two lights, forward of the thruster (rotated +x is the bow).
        expect(mk.lights.length).toBe(2);
        for (const l of mk.lights) expect(l.x).toBeGreaterThan(t.left);
        // Row-major scan over the rotated image: rotated y = raw x - crop left, so the raw x = 10 light comes first.
        expect(mk.lights[0].y).toBeLessThan(mk.lights[1].y);
    });

    it('places the exhaust behind the thruster, trailing towards -x, 2.8x the mark height', () => {
        const rgba = makeShip();
        const m = shipImageMetrics(rgba, 40, 40)!;
        const mk = scanShipMarkers(rgba, 40, 40, m);
        const p1 = 80; // prepared px (twice the crop side-ish)
        const num5 = exhaustLengthPx(p1, 2.5);
        const r = exhaustRect(mk.thrusters[0], mk.minThrusterLeft, mk.side, p1, num5, { cx: 0, cy: 0, width: 0, height: 0 });
        const num = p1 / mk.side;
        expect(r.width).toBe(num5);
        expect(r.height).toBeCloseTo(4 * num * 2.8);
        // Rect right edge = thruster column - num5 + num5 + 3 composite px: sits just aft of the mark.
        const thrusterX = mk.thrusters[0].left * num - p1 / 2;
        // (the composite side is truncated to whole px, hence the sub-pixel tolerance)
        expect(Math.abs(r.cx + r.width / 2 - (thrusterX + 2))).toBeLessThan(0.5);
        expect(r.cx).toBeLessThan(thrusterX);
        expect(Math.abs(r.cy)).toBeLessThan(num * 1.5);
    });

    it('tints gas plumes by the dominant gas', () => {
        expect(gasMiningTint(null)).toBe(0xffffff);
        expect(gasMiningTint('Hydrogen')).toBe(0xa00000);
        expect(gasMiningTint('Something')).toBe(0xcc0033);
    });
});
