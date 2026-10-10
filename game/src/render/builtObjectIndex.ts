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
import { builtObjectDrawnOffsetBound, builtObjectTouchGapMs, MotionInterpolator } from './renderInterp';

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
        for (let i = 0; i < n; i++) {
            const dx = xs[i] - cx;
            const dy = ys[i] - cy;
            if (dx >= -ax && dx <= ax && dy >= -ay && dy <= ay) {
                out.push(this.live[i]);
                continue;
            }
            if (!withBound) continue;
            let r = rs[i];
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
