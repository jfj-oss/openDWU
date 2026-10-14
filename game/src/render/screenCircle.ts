// World-space circles tessellated for their on-screen size.

import type { Graphics } from 'pixi.js';

/**
 * Add a circle at world (x, y) with world radius `r` to `g` (a world-space Graphics; stroke / fill it as usual), with
 * the point count Pixi would give a circle of its ON-SCREEN radius `r * z` px.
 *
 * Pixi 8 (buildCircle) tessellates a circle with 8·ceil(2.3·√(2r)) points in the Graphics' local units. In world units
 * that tracks the world radius, not the drawn size: a 20 px faction ring at galaxy zoom (r ≈ 600 000) got ~20 000
 * points where ~120 are smooth, and a Graphics of a few thousand such rings, redrawn on every zoom change, took
 * tens of ms to re-triangulate. Here the circle is built at its screen radius and mapped back to world space by the
 * context transform (applied to the points before the stroke is built, so stroke widths stay in world units). The
 * drawn shape is the same circle; its polygon stays within ~0.01 px of the true circle (Pixi's own error bound).
 */
let canvasRenderer = false;
/** The Main View draws with Pixi's Canvas renderer (rendererInfo.ts recordRenderer). */
export function setScreenCircleCanvasMode(on: boolean): void {
    canvasRenderer = on;
}

export function circleAtScreenRes(g: Graphics, x: number, y: number, r: number, z: number): Graphics {
    // Pixi's Canvas renderer (no WebGL) scales stroke widths by the inner transform too: a 1.2 px orbit ring came out
    // 1.2 × zoom-factor px wide and washed the whole system view out. The plain circle is right there.
    if (canvasRenderer) return g.circle(x, y, r);
    g.context.save();
    g.context.transform(1 / z, 0, 0, 1 / z, x, y);
    g.circle(0, 0, r * z);
    g.context.restore();
    return g;
}

/**
 * XnaDrawingHelper.DrawCircle(x, y, w, h, color, thickness, segmentCount) (XnaDrawingHelper.cs 777-811): the circle as
 * `segments` chords from angle 0 (a closed polygon; stroke it as usual). Coordinates in the Graphics' own units.
 */
export function segmentCircle(g: Graphics, cx: number, cy: number, r: number, segments: number): Graphics {
    const step = (Math.PI * 2) / segments;
    g.moveTo(cx + r, cy);
    for (let i = 1; i < segments; i++) g.lineTo(cx + r * Math.cos(i * step), cy + r * Math.sin(i * step));
    g.closePath();
    return g;
}
