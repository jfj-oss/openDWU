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
 * A variable-length DrawKey: the values (numbers or object identities) a Graphics was last drawn from. A layer whose
 * geometry follows a list (one entry per marker / line) pushes each drawn entry's inputs between begin() and
 * changed(), and only clears and redraws when that list differs from the previous frame's: unchanged inputs (a
 * paused game, a still camera, ships at rest) then cost no re-tessellation. The two backing arrays are reused, so a
 * frame allocates nothing once they have grown.
 */
export class DrawSig {
    private prev: unknown[] = [];
    private cur: unknown[] = [];
    private n = 0;
    private valid = false;

    /** Start collecting this frame's values. */
    begin(): void {
        this.n = 0;
    }

    push(v: unknown): void {
        this.cur[this.n++] = v;
    }

    push2(a: unknown, b: unknown): void {
        this.cur[this.n++] = a;
        this.cur[this.n++] = b;
    }

    push4(a: unknown, b: unknown, c: unknown, d: unknown): void {
        this.cur[this.n++] = a;
        this.cur[this.n++] = b;
        this.cur[this.n++] = c;
        this.cur[this.n++] = d;
    }

    /** True when the values pushed since begin() differ from the last remembered list (or on the first call / after
     * reset), which then becomes the remembered one. NaN never compares equal, so it always redraws. */
    changed(): boolean {
        const p = this.prev;
        const c = this.cur;
        const n = this.n;
        if (this.valid && p.length === n) {
            let same = true;
            for (let i = 0; i < n; i++) {
                if (p[i] !== c[i]) {
                    same = false;
                    break;
                }
            }
            if (same) return false;
        }
        c.length = n;
        this.prev = c;
        this.cur = p;
        this.valid = true;
        return true;
    }

    /** Forget the remembered list: the next changed() returns true. */
    reset(): void {
        this.valid = false;
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
