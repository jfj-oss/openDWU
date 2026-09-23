import { describe, expect, it } from 'vitest';
import { Camera } from '../src/render/camera';

function makeCamera(width = 1600, height = 900): Camera {
    const c = new Camera();
    c.setViewport(width, height);
    c.setGalaxyBounds(8_000_000, 8_000_000);
    c.x = 4_000_000;
    c.y = 4_000_000;
    c.zoom = 0.1;
    return c;
}

describe('Camera', () => {
    it('screenToWorld/worldToScreen round-trip', () => {
        const c = makeCamera();
        const world = { x: 3_999_000, y: 4_001_000 };
        const screen = c.worldToScreen(world.x, world.y);
        const back = c.screenToWorld(screen.x, screen.y);
        expect(back.x).toBeCloseTo(world.x, 6);
        expect(back.y).toBeCloseTo(world.y, 6);
    });

    it('the screen center maps to the camera center', () => {
        const c = makeCamera();
        const p = c.screenToWorld(c.width / 2, c.height / 2);
        expect(p.x).toBeCloseTo(c.x, 3);
        expect(p.y).toBeCloseTo(c.y, 3);
    });

    it('zoomAt keeps the world point under the cursor fixed (center)', () => {
        const c = makeCamera();
        const before = c.screenToWorld(800, 450);
        c.zoomAt(0.5, 800, 450);
        const after = c.screenToWorld(800, 450);
        expect(after.x).toBeCloseTo(before.x, 3);
        expect(after.y).toBeCloseTo(before.y, 3);
        expect(c.zoom).toBe(0.5);
    });

    it('zoomAt keeps the world point under the cursor fixed (off-center)', () => {
        const c = makeCamera();
        const sx = 1200;
        const sy = 200;
        const before = c.screenToWorld(sx, sy);
        c.zoomAt(c.zoom * 0.2, sx, sy);
        const after = c.screenToWorld(sx, sy);
        expect(after.x).toBeCloseTo(before.x, 3);
        expect(after.y).toBeCloseTo(before.y, 3);
    });

    it('zoomAt clamps to maxZoom (100%) and still pins the cursor point', () => {
        const c = makeCamera();
        c.zoom = 1; // already at 100%
        const before = c.screenToWorld(300, 700);
        c.zoomAt(50, 300, 700);
        expect(c.zoom).toBe(1);
        const after = c.screenToWorld(300, 700);
        expect(after.x).toBeCloseTo(before.x, 3);
        expect(after.y).toBeCloseTo(before.y, 3);
    });

    it('zoomAt clamps to minZoom (whole-galaxy view)', () => {
        const c = makeCamera();
        const before = c.screenToWorld(100, 100);
        c.zoomAt(0, 100, 100);
        expect(c.zoom).toBe(c.minZoom);
        const after = c.screenToWorld(100, 100);
        expect(after.x).toBeCloseTo(before.x, 3);
        expect(after.y).toBeCloseTo(before.y, 3);
    });

    it('minZoom makes the whole galaxy fit on screen with margin', () => {
        const c = new Camera();
        c.setViewport(1600, 900);
        c.setGalaxyBounds(8_000_000, 8_000_000);
        expect(c.minZoom).toBeCloseTo(Math.min(1600 / 8e6, 900 / 8e6) * 0.9, 12);
    });

    it('panByScreen moves the center opposite to the drag', () => {
        const c = makeCamera();
        const before = { x: c.x, y: c.y };
        c.panByScreen(100, 50);
        expect(c.x).toBeCloseTo(before.x - 100 / c.zoom, 6);
        expect(c.y).toBeCloseTo(before.y - 50 / c.zoom, 6);
    });

    it('zoomStep zooms in and out in geometric steps around the center', () => {
        const c = makeCamera();
        const z0 = c.zoom;
        c.zoomStep(1);
        expect(c.zoom).toBeCloseTo(z0 * 3, 9);
        c.zoomStep(-1);
        expect(c.zoom).toBeCloseTo(z0, 6);
    });

    it('zoomStep never leaves the [minZoom, maxZoom] range', () => {
        const c = makeCamera();
        c.zoom = 1;
        c.zoomStep(5); // zoom in as far as the clamp allows
        expect(c.zoom).toBe(1);
        c.zoomStep(-20); // zoom out as far as the clamp allows
        expect(c.zoom).toBe(c.minZoom);
    });
});