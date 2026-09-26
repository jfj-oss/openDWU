// Renderer perf helpers (render: perf pass). Pure — no Pixi or DOM imports — so they are unit-testable.
//
// The Main View layers used to clear and rebuild their Graphics every frame (colony / marker / overlay rings, the
// selection ring), which makes Pixi re-triangulate and re-upload the geometry and rebuild its instruction set each
// frame. DrawKey remembers the parameters a Graphics was last drawn with so the layer only rebuilds it when one of
// them changes; the drawn output is the same because the same calls run with the same arguments.

/** The last parameters (up to five numbers) a Graphics was drawn with. */
export class DrawKey {
    private a = NaN;
    private b = NaN;
    private c = NaN;
    private d = NaN;
    private e = NaN;

    /** True when any value differs from the previous call (or on the first call / after reset); remembers the new
     * values. Unused trailing parameters default to 0. NaN never compares equal, so a NaN input always redraws. */
    changed(a: number, b = 0, c = 0, d = 0, e = 0): boolean {
        if (a === this.a && b === this.b && c === this.c && d === this.d && e === this.e) return false;
        this.a = a;
        this.b = b;
        this.c = c;
        this.d = d;
        this.e = e;
        return true;
    }

    /** Forget the remembered values: the next changed() call returns true. */
    reset(): void {
        this.a = NaN;
    }
}

/**
 * Conservative on-screen test for an object centred at world (x, y) that draws within `worldRadius` world units plus
 * `pxMargin` screen pixels of its centre, for a camera centred at (camX, camY) showing viewW × viewH pixels at `zoom`
 * px per world unit. False only when every drawn pixel is off screen.
 */
export function boundsOnScreen(
    x: number,
    y: number,
    worldRadius: number,
    pxMargin: number,
    camX: number,
    camY: number,
    viewW: number,
    viewH: number,
    zoom: number,
): boolean {
    const halfW = (viewW / 2 + pxMargin) / zoom + worldRadius;
    const halfH = (viewH / 2 + pxMargin) / zoom + worldRadius;
    return x >= camX - halfW && x <= camX + halfW && y >= camY - halfH && y <= camY + halfH;
}

/** Minimal text sink (an HTMLElement's textContent / title, or a test double). */
export interface TextTarget {
    textContent: string | null;
}

/** Set `el.textContent` only when it differs: an unchanged write still replaces the text node and re-lays out the
 * HUD. Returns true when the text was written. */
export function setTextIfChanged(el: TextTarget, text: string): boolean {
    if (el.textContent === text) return false;
    el.textContent = text;
    return true;
}
