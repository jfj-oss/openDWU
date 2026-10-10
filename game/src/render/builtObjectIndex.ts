// Render-side index of the live built objects (render-only: nothing here writes sim state).
//
// Late games have ~10,000 ships and bases, and several layers (BuiltObjectLayer, galaxy markers, ambient effects,
// fighters) used to walk all of galaxy.builtObjects every render frame only to cull most of them on position — memory-
// bound work (each object is a large heap record) repeated at the display rate. Committed positions only change when a
// sim step lands (and, rarely, at the command boundary), so this index copies them once per step into flat arrays:
//   live      — the non-null, non-destroyed objects in galaxy.builtObjects order (the order every layer draws in);
//   xs / ys   — their committed positions;
//   rs        — renderInterp.ts builtObjectDrawnOffsetBound at the fastest game speed (and the presentation clock's
//               lag at the rebuild): no drawn (interpolated) position is farther than this from the committed one
//               (NaN until first needed: computed by `near` only for objects outside the view on their committed position);
// and `near` returns, in that same order, every live object that could be on screen — a superset of what each layer's
// own cull keeps, so a layer that runs its unchanged per-object tests over `near` draws exactly what it drew before.
// It is refreshed when a step lands (MotionInterpolator.serial), when the array changes (identity / length), and every
// REFRESH_FRAMES frames regardless (edits made outside a step, e.g. while paused, show within a few frames).

import type { BuiltObject } from '../sim/builtObject';
import type { Galaxy } from '../sim/galaxy';
import { FRAMES_PER_SECOND } from '../sim/tick/scheduler';
import { builtObjectBoundSpeed, builtObjectDrawnOffsetBound, builtObjectDrawnOffsetCap, builtObjectHasParentFrame, builtObjectTouchGapMs, MotionInterpolator } from './renderInterp';

/** Most render frames between refreshes when no sim step lands (paused, or edits outside a step). */
export const REFRESH_FRAMES = 8;

export class BuiltObjectIndex {
    readonly live: BuiltObject[] = [];
    xs = new Float64Array(0);
    ys = new Float64Array(0);
    rs = new Float64Array(0);
    /** Times the index was rebuilt (tests / perf counters). */
    rebuilds = 0;
    /** update() calls so far: a reader outside the Main View (audio) uses the index only in a frame it was updated. */
    updates = 0;
    /** Whether the latest update() rebuilt the index (liveness / positions may have changed this frame). */
    changed = true;
    private liveSetCache: Set<BuiltObject> | null = null;
    /** Since the last rebuild: whether `cap` / `parented` are computed (on the first near with bounds). `cap` bounds the
     *  drawn offset of every object without a parent frame (builtObjectDrawnOffsetCap of the largest speed); objects
     *  outside the view by more than it are rejected without their own bound. */
    private capValid = false;
    private cap = 0;
    private parented = new Uint8Array(0);
    private serial = -1;
    private source: readonly (BuiltObject | null)[] | null = null;
    private sourceLength = -1;
    private framesSince = 0;
    /** Worst-case interpolation parameters for the bound (4× speed: every frame's own bound is at most this). */
    private worst = new MotionInterpolator();

    /** Call once per render frame (after MotionInterpolator.begin). Returns whether it was rebuilt. */
    update(galaxy: Galaxy, motion: MotionInterpolator | null): boolean {
        const arr = galaxy.builtObjects as readonly (BuiltObject | null)[];
        const serial = motion?.serial ?? -1;
        this.updates++;
        this.framesSince++;
        this.changed = false;
        if (serial === this.serial && arr === this.source && arr.length === this.sourceLength && this.framesSince < REFRESH_FRAMES && motion !== null) return false;
        this.changed = true;
        this.serial = serial;
        this.source = arr;
        this.sourceLength = arr.length;
        this.framesSince = 0;
        this.rebuilds++;
        this.liveSetCache = null;
        this.capValid = false;
        const w = this.worst;
        w.stepSeconds = 4 / FRAMES_PER_SECOND;
        w.untouchedMaxMs = builtObjectTouchGapMs(arr.length, 4000 / FRAMES_PER_SECOND);
        w.clampSeconds = motion?.clampSeconds ?? 0;
        // How far the presented instant trails the committed step (PresentationClock): it only shrinks until the next
        // step lands, which rebuilds the index, so this frame's lag bounds every frame until then.
        w.lagSteps = motion?.lagSteps ?? 0;
        const live = this.live;
        live.length = 0;
        for (let i = 0; i < arr.length; i++) {
            const bo = arr[i];
            if (bo === null || bo === undefined || bo.hasBeenDestroyed) continue;
            live.push(bo);
        }
        const n = live.length;
        if (this.xs.length < n) {
            const cap = Math.max(n, Math.ceil(this.xs.length * 1.5), 256);
            this.xs = new Float64Array(cap);
            this.ys = new Float64Array(cap);
            this.rs = new Float64Array(cap);
        }
        // The drawn-offset bounds are computed lazily (in near), only for objects `near` cannot accept on their
        // committed position alone: at galaxy zoom nearly every object is inside the view, so none is computed.
        const useBound = motion !== null;
        const xs = this.xs;
        const ys = this.ys;
        const rs = this.rs;
        for (let i = 0; i < n; i++) {
            const bo = live[i];
            xs[i] = bo.xpos;
            ys[i] = bo.ypos;
            rs[i] = useBound ? Number.NaN : 0;
        }
        return true;
    }

    private computeCap(): void {
        const n = this.live.length;
        if (this.parented.length < n) this.parented = new Uint8Array(Math.max(n, Math.ceil(this.parented.length * 1.5), 256));
        let v = 0;
        for (let i = 0; i < n; i++) {
            const bo = this.live[i];
            if (builtObjectHasParentFrame(bo)) {
                this.parented[i] = 1;
                continue;
            }
            this.parented[i] = 0;
            const s = builtObjectBoundSpeed(bo);
            // (A NaN speed makes the cap NaN: then nothing is rejected by it.)
            v = s > v || s !== s ? s : v;
        }
        this.cap = builtObjectDrawnOffsetCap(this.worst, v);
        this.capValid = true;
    }

    /** `live` as a set (built at most once per rebuild, on first use). */
    liveSet(): ReadonlySet<BuiltObject> {
        if (this.liveSetCache === null) this.liveSetCache = new Set(this.live);
        return this.liveSetCache;
    }

    /**
     * The live objects (in galaxy.builtObjects order) whose committed position, widened by their drawn-position bound
     * (when `withBound`) plus `marginWorld`, falls inside the rectangle centred at (cx, cy) with half-extents
     * (halfW, halfH). Written to `out` (cleared first) and returned.
     */
    near(cx: number, cy: number, halfW: number, halfH: number, marginWorld: number, withBound: boolean, out: BuiltObject[]): BuiltObject[] {
        out.length = 0;
        const n = this.live.length;
        const xs = this.xs;
        const ys = this.ys;
        const rs = this.rs;
        const ax = halfW + marginWorld;
        const ay = halfH + marginWorld;
        // (cap / parented are computed at the first object outside the rectangle without a bound yet: at galaxy zoom none is.)
        let cap = this.cap;
        let parented = this.parented;
        for (let i = 0; i < n; i++) {
            const dx = xs[i] - cx;
            const dy = ys[i] - cy;
            if (dx >= -ax && dx <= ax && dy >= -ay && dy <= ay) {
                out.push(this.live[i]);
                continue;
            }
            if (!withBound) continue;
            let r = rs[i];
            // Farther out than any unparented object's bound: rejected as its own bound would (cap >= that bound).
            if (r !== r && !this.capValid) {
                this.computeCap();
                cap = this.cap;
                parented = this.parented;
            }
            if (r !== r && parented[i] === 0 && cap === cap && !(dx >= -ax - cap && dx <= ax + cap && dy >= -ay - cap && dy <= ay + cap)) continue;
            if (r !== r) r = rs[i] = builtObjectDrawnOffsetBound(this.worst, this.live[i]);
            if (r > 0 && dx >= -ax - r && dx <= ax + r && dy >= -ay - r && dy <= ay + r) out.push(this.live[i]);
        }
        return out;
    }
}

/** The Main View's index of each galaxy (registered by MainView), for readers outside the view layers. */
const byGalaxy = new WeakMap<Galaxy, BuiltObjectIndex>();
export function registerBuiltObjectIndex(galaxy: Galaxy, index: BuiltObjectIndex): void {
    byGalaxy.set(galaxy, index);
}
export function builtObjectIndexOf(galaxy: Galaxy): BuiltObjectIndex | null {
    return byGalaxy.get(galaxy) ?? null;
}
