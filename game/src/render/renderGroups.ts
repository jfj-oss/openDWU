// Pixi scene-graph helpers for the Main View: render-group isolation for display objects redrawn every frame, and
// containers whose hidden children are detached so Pixi's per-frame transform walk skips them.

import { Container } from 'pixi.js';

/**
 * Wrap a display object that is redrawn every frame (a Graphics cleared and refilled per frame) in its own Pixi render
 * group. Pixi 8 rebuilds a render group's whole instruction list whenever a batchable Graphics in it changes
 * (GraphicsPipe.validateRenderable returns true), which for the Main View meant re-walking the entire scene graph —
 * every system's star, label and rings — every frame; in its own group only that object's instructions are rebuilt.
 * Drawing is unchanged (same order, same transforms).
 */
export function inOwnRenderGroup<T extends Container>(child: T): Container {
    const group = new Container({ isRenderGroup: true });
    group.addChild(child);
    return group;
}

/**
 * A container whose children are attached to the scene graph only while shown. Pixi 8 visits every descendant of a
 * render group whenever an ancestor's transform changes — the Main View's world container on every pan / zoom frame —
 * hidden ones included (updateTransformAndChildren does not stop at `visible = false`). On a late 2500-star game that
 * was ~140k containers per zoom frame, of which ~5k are drawn. Children listed here keep their place in `order`
 * (the draw order) but are removed from `root` while hidden, so the walk only reaches the shown ones.
 */
export class AttachedChildren<T extends Container = Container> {
    /** Every child, in draw order. */
    readonly order: T[] = [];
    private readonly rank = new Map<T, number>();
    private readonly attached = new Set<T>();
    /** Children whose attached state changed since the last flush. */
    private pending: T[] = [];

    constructor(readonly root: Container) {}

    /** Append `child` (detached until shown). */
    add(child: T): void {
        this.rank.set(child, this.order.length);
        this.order.push(child);
    }

    /** Attach (`on`) or detach `child`; applied by flush(). */
    set(child: T, on: boolean): void {
        if (on === this.attached.has(child)) return;
        if (on) this.attached.add(child);
        else this.attached.delete(child);
        this.pending.push(child);
    }

    isAttached(child: T): boolean {
        return this.attached.has(child);
    }

    /** Apply the attach / detach calls made since the last flush to `root`'s children (draw order preserved). */
    flush(): void {
        const pending = this.pending;
        if (pending.length === 0) return;
        if (pending.length > 24) {
            // Many changes (a zoom band crossing): rebuild the child list in one pass.
            this.root.removeChildren();
            const kids: T[] = [];
            for (const c of this.order) if (this.attached.has(c)) kids.push(c);
            if (kids.length > 0) this.root.addChild(...kids);
        } else {
            for (const c of pending) {
                const on = this.attached.has(c);
                if (on === (c.parent === this.root)) continue;
                if (!on) {
                    this.root.removeChild(c);
                    continue;
                }
                // Binary search for the first attached child that comes after `c` in draw order.
                const kids = this.root.children as T[];
                const r = this.rank.get(c)!;
                let lo = 0;
                let hi = kids.length;
                while (lo < hi) {
                    const mid = (lo + hi) >> 1;
                    if (this.rank.get(kids[mid])! < r) lo = mid + 1;
                    else hi = mid;
                }
                this.root.addChildAt(c, lo);
            }
        }
        pending.length = 0;
    }
}
