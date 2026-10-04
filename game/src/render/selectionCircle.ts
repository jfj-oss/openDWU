// The original's selection marker: MainView.2.cs 3132 method_212 — XnaDrawingHelper.DrawCircle(x, y, w, h, color_5, 5,
// 50) over a box around the selected object — in 3140 method_213's colour: color_7 (128, 112, 0, 160) ↔ color_8
// (224, 255, 32, 112) on a 2 s triangle wave of real UTC time (DateTime.Now.ToUniversalTime()).
//
// The boxes (all screen px, the circle's diameter is the box width):
// - a ship / base drawn at close zoom (method_76, MainView.1.cs 1068-1077 / 1141-1161): (int)(drawn size * 1.3); every
//   ship of a selected fleet and every ship of a BuiltObjectList selection gets one, as does the selected ship;
// - a fighter (MainView.1.cs 1518-1521): (int)(drawn size * 1.3);
// - a creature (MainView.1.cs 1715-1720): (int)(drawn size * 1.5);
// - a habitat (MainView.1.cs 823-826): the drawn body + 10 px each side;
// - a galaxy-pass ship symbol (MainView.2.cs 5984-6016): (int)(symbol size * 1.6), for the selected ship or a member of
//   the selected BuiltObjectList; a fleet icon (MainView.2.cs 6395-6398): the icon size; a SystemInfo at f > 150
//   (MainView.2.cs 5536-5546): the star's drawn rect grown by 3 px left/top and 4 px right/bottom.
// XnaDrawingHelper.DrawCircle (XnaDrawingHelper.cs 777-811) takes the radius from the WIDTH (width / 2) and centres the
// circle in the box.
//
// No sim access; pure helpers (unit-tested) plus a Graphics builder.

import type { Graphics } from 'pixi.js';
import { pulseColor } from './combatBars';
import { segmentCircle } from './screenCircle';

/** MainView.cs 1432-1433 color_7 / color_8 (0xAARRGGBB). */
export const SELECTION_COLOR_FROM = 0x807000a0;
export const SELECTION_COLOR_TO = 0xe0ff2070;
/** method_212: line thickness 5, 50 segments. */
export const SELECTION_CIRCLE_WIDTH_PX = 5;
export const SELECTION_CIRCLE_SEGMENTS = 50;

/** method_213 at the wall-clock instant `now` (UTC seconds / milliseconds): the circle colour as 0xAARRGGBB. */
export function selectionCircleArgb(now: Date): number {
    return pulseColor(SELECTION_COLOR_FROM, SELECTION_COLOR_TO, now.getUTCSeconds(), now.getUTCMilliseconds());
}

/** MainView.1.cs 1068: the ship box (int)(drawn size * 1.3); also the fighter box (1518). */
export function shipSelectionBox(drawnPx: number): number {
    return Math.trunc(drawnPx * 1.3);
}
/** MainView.1.cs 1715: the creature box (int)(drawn size * 1.5). */
export function creatureSelectionBox(drawnPx: number): number {
    return Math.trunc(drawnPx * 1.5);
}
/** MainView.1.cs 825: method_212(x - 10, y - 10, x + w + 10, y + h + 10): the habitat box. */
export function habitatSelectionBox(drawnPx: number): number {
    return drawnPx + 20;
}
/** MainView.2.cs 5986: num68 = (int)(num68 * 1.6) around a galaxy-pass ship symbol. */
export function symbolSelectionBox(symbolPx: number): number {
    return Math.trunc(symbolPx * 1.6);
}
/** MainView.2.cs 5540: (rect.X - 3, rect.Y - 3) .. (rect.Right + 4, rect.Bottom + 4) around a selected system's star. */
export function systemSelectionBox(drawnPx: number): number {
    return drawnPx + 7;
}

/**
 * Add the method_212 circles of `boxes` (flat [cx, cy, box, ...], the box centres and widths in this Graphics' units)
 * to `g`, stroked white `width` wide: the pulse colour is applied as the Graphics' tint / alpha (applySelectionTint), so
 * a frame whose boxes did not move need not re-tessellate.
 */
export function buildSelectionCircles(g: Graphics, boxes: readonly number[], width = SELECTION_CIRCLE_WIDTH_PX): void {
    g.clear();
    if (boxes.length === 0) return;
    for (let i = 0; i + 2 < boxes.length; i += 3) segmentCircle(g, boxes[i], boxes[i + 1], boxes[i + 2] / 2, SELECTION_CIRCLE_SEGMENTS);
    g.stroke({ width, color: 0xffffff, alpha: 1 });
}

/** The method_213 colour on `g` (tint RGB, alpha from the colour's A byte). */
export function applySelectionTint(g: Graphics, now: Date): void {
    const argb = selectionCircleArgb(now);
    g.tint = argb & 0xffffff;
    g.alpha = ((argb >>> 24) & 0xff) / 255;
}

/** Whether two flat box lists are the same (no re-tessellation needed). */
export function sameBoxes(a: readonly number[], b: readonly number[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}
