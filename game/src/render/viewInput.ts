// The Game Options' view controls applied to our camera (pure; no DOM / Pixi): the wheel zoom step (Zoom Speed), the
// mouse scroll-wheel behaviour and the edge / arrow-key scroll speed (Scroll Speed).
//
// The original (Main.Part13.cs:388 OnMouseWheel): val = (-Delta / 120) × (MainViewZoomSpeed / 100), clamped to ±0.85,
// and the zoom factor (world units per pixel, double_0 = 1 / our `zoom`) becomes double_0 × (1 + val), clamped to
// 1..double_5 (our Camera clamps). Then, when the factor changed, MouseScrollWheelBehaviour picks where the view goes:
// 0 "No movement" (zoom about the view centre), 1 "Move to selected item" (method_157: centre on the selection),
// 2 "Move to mouse cursor location" (only when zooming IN, Delta > 0: the world point under the cursor stays put;
// zooming out keeps the centre). Scrolling (Main.Part12.cs:4366-4407 method_98 / method_99) moves the view by
// MainViewScrollSpeed × double_0 world units per update, i.e. MainViewScrollSpeed screen pixels.

/** A DOM wheel event's deltaY in notches of 120 Delta units (WheelEvent.deltaMode: 0 pixels, 1 lines, 2 pages).
 *  Positive = wheel towards the user (zoom out). A mouse notch arrives as one pixel event of 50-120 px depending on
 *  the platform and the device pixel ratio (Chromium: 100 at 1x, 50 at 2x on Linux; 53 / 120 elsewhere), so a pixel
 *  event of at least 50 px counts as whole notches; smaller ones (trackpads, high-resolution wheels) are fractions of
 *  a 100 px notch, so a swipe zooms smoothly by about the same amount as the wheel. */
export function wheelNotches(deltaY: number, deltaMode: number): number {
    if (!Number.isFinite(deltaY) || deltaY === 0) return 0;
    if (deltaMode === 1) return deltaY / 3;
    if (deltaMode === 2) return deltaY;
    const a = Math.abs(deltaY);
    if (a >= 50) return Math.sign(deltaY) * Math.max(1, Math.round(a / 100));
    return deltaY / 100;
}

/** Port of Main.Part13.cs:399-400: the change of the zoom factor for `notches` (DOM sign: positive zooms out). */
export function wheelZoomVal(notches: number, zoomSpeed: number): number {
    // (e.Delta * -1) / 120.0 * (MainViewZoomSpeed / 100.0) with e.Delta = -notches * 120.
    const val = notches * (zoomSpeed / 100);
    return Math.max(-0.85, Math.min(val, 0.85));
}

/** The new camera zoom (px per world unit) after one wheel event: double_0 += double_0 × val, and zoom = 1 / double_0. */
export function wheelZoom(zoom: number, notches: number, zoomSpeed: number): number {
    return zoom / (1 + wheelZoomVal(notches, zoomSpeed));
}

/** Main.Part13.cs:420-470: the screen point the wheel zoom keeps fixed, or 'selection' to centre on the selected item
 *  first. Behaviour 2 anchors on the cursor only when zooming in; everything else zooms about the view centre. */
export function wheelZoomAnchor(behaviour: number, zoomingIn: boolean, hasSelection: boolean): 'cursor' | 'center' | 'selection' {
    if (behaviour === 1) return hasSelection ? 'selection' : 'center';
    if (behaviour === 2) return zoomingIn ? 'cursor' : 'center';
    return 'center';
}

/** Scroll Speed's default (Main.Part9.cs:2774). Our edge scroll ran at 16 px a frame and the arrow keys at 60 px a
 *  press before the option existed; they keep those speeds at the default and scale linearly with the setting. */
export const DEFAULT_SCROLL_SPEED = 10;

/** Screen pixels the view moves per frame of edge scroll (method_98) at Scroll Speed `speed`. */
export function edgeScrollPixels(speed: number): number {
    return 16 * (speed / DEFAULT_SCROLL_SPEED);
}

/** Screen pixels one arrow-key press scrolls (method_99) at Scroll Speed `speed`. */
export function keyScrollPixels(speed: number): number {
    return 60 * (speed / DEFAULT_SCROLL_SPEED);
}

/** SystemNebulaeDetail (Low / Medium / High) → our nebula texture resolution multiplier. The original lowers the
 *  generator's scaleFactor (4.5 / 2.9 / 1.8, Main.Part12.cs:2730 SastWuBaXc) for finer clouds; ours keeps its art
 *  direction and raises the patch texture resolution instead. Low = the resolution the layer used before the option. */
export function nebulaDetailScale(detail: number): number {
    switch (detail) {
        case 2:
            return 1.6;
        case 1:
            return 1.3;
        default:
            return 1;
    }
}
