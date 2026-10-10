// Render-side tracking of the few built objects with combat effects to draw (render only: nothing here writes sim state).
//
// Late games have ~20k built objects and ~100k weapons, of which a few hundred have a shot in flight, an explosion, a
// strike, a hyperjump flash or launched fighters. Finding them by scanning every object (and all its weapons) on every
// sim step cost milliseconds a frame. Instead the sim notes each object that starts such a thing
// (sim/combat/effectWatch.ts, observation only), and a TrackedBuiltObjects re-checks only the objects it tracks: the
// noted ones and those its owner still keeps (they had something last time). Each refresh visits them in
// galaxy.builtObjects order with the owner's own per-object test, so the owner builds exactly the lists a full scan
// would — provided every way an object can start passing that test is noted (or is time alone, which the owner covers
// by keeping such objects). A full scan seeds it: on the first refresh, when the builtObjects array is replaced, and
// when too many notes went unread.

import type { BuiltObject } from '../sim/builtObject';
import type { Galaxy } from '../sim/galaxy';
import { EFFECT_WATCH_CAP, unwatchBuiltObjectEffects, watchBuiltObjectEffects } from '../sim/combat/effectWatch';
import { fightersOf } from '../sim/combat/fighters';

/** Game ms a noted object stays tracked with nothing to draw yet: on a sim-worker replica the state behind a note can
 *  land after the note (a hit ship's shield strike comes with that ship's next update, under a second later). */
export const NOTE_GRACE_MS = 10000;
/** Unread notes past this many: they are dropped and the next refresh is a full scan (bounded memory; below the
 *  watch's own cap, so a full watch always reads as overflowed). */
export const NOTE_OVERFLOW = EFFECT_WATCH_CAP / 2;

/** Whether `bo` has a launched fighter (its fighters are drawn, with their effects). */
export function hasLaunchedFighter(bo: BuiltObject): boolean {
    const fighters = fightersOf(bo);
    if (fighters === null) return false;
    for (let i = 0; i < fighters.length; i++) {
        const fighter = fighters[i];
        if (fighter != null && !fighter.onboardCarrier) return true;
    }
    return false;
}

export class TrackedBuiltObjects {
    private notes: Set<BuiltObject> | null = null;
    /** Tracked objects → keep-until (game ms; -Infinity: kept only while the owner says so). */
    private readonly tracked = new Map<BuiltObject, number>();
    /** Last known index in galaxy.builtObjects of each tracked object (checked before use). */
    private readonly posHint = new Map<BuiltObject, number>();
    private source: readonly unknown[] | null = null;
    private fullScanDue = true;
    private readonly order: BuiltObject[] = [];
    /** Full scans so far (tests / perf counters). */
    fullScans = 0;

    constructor(private readonly galaxy: Galaxy) {}

    /** Notes waiting for the next refresh. */
    get pending(): number {
        return this.notes?.size ?? 1;
    }

    /** Objects tracked after the last refresh. */
    get size(): number {
        return this.tracked.size;
    }

    /** Keep the unread notes bounded while the owner does not refresh (the next refresh is then a full scan). */
    trim(): void {
        if (this.notes !== null && this.notes.size > NOTE_OVERFLOW) {
            this.notes.clear();
            this.fullScanDue = true;
        }
    }

    /**
     * Visit, in galaxy.builtObjects order, every non-null object a full scan would need to visit for the owner's test:
     * `visit(bo)` runs the test (building the owner's lists) and returns whether `bo` must stay tracked (it passes, or
     * may start passing by time alone). `extra`: objects the owner's own records make interesting (tracked too).
     */
    refresh(nowMs: number, extra: Iterable<BuiltObject> | null, visit: (bo: BuiltObject) => boolean): void {
        const g = this.galaxy;
        const arr = g.builtObjects as readonly (BuiltObject | null)[];
        if (this.notes === null) {
            this.notes = watchBuiltObjectEffects(g);
            this.fullScanDue = true;
        }
        if (arr !== this.source) {
            this.source = arr;
            this.fullScanDue = true;
        }
        const notes = this.notes;
        if (notes.size > NOTE_OVERFLOW) this.fullScanDue = true;
        const tracked = this.tracked;
        const keepUntil = nowMs + NOTE_GRACE_MS;
        for (const bo of notes) {
            const k = tracked.get(bo);
            if (k === undefined || k < keepUntil) tracked.set(bo, keepUntil);
        }
        notes.clear();
        const hint = this.posHint;
        if (this.fullScanDue) {
            this.fullScanDue = false;
            this.fullScans++;
            // Every object (the graced notes stay tracked; the scan sees everything else as it is now).
            for (const [bo, k] of tracked) if (!(k >= nowMs)) tracked.delete(bo);
            hint.clear();
            for (let i = 0; i < arr.length; i++) {
                const bo = arr[i];
                if (bo === null || bo === undefined) continue;
                if (visit(bo) && !tracked.has(bo)) tracked.set(bo, -Infinity);
                if (tracked.has(bo)) hint.set(bo, i);
            }
            for (const bo of tracked.keys()) if (!hint.has(bo)) tracked.delete(bo);
            return;
        }
        if (extra !== null) for (const bo of extra) if (!tracked.has(bo)) tracked.set(bo, -Infinity);
        // Where each tracked object is in galaxy.builtObjects (its order; gone from it: untracked).
        let stale = 0;
        for (const bo of tracked.keys()) {
            const i = hint.get(bo);
            if (i === undefined || arr[i] !== bo) stale++;
        }
        if (stale > 16) {
            hint.clear();
            for (let i = 0; i < arr.length; i++) {
                const bo = arr[i];
                if (bo !== null && bo !== undefined && tracked.has(bo)) hint.set(bo, i);
            }
        } else if (stale > 0) {
            for (const bo of tracked.keys()) {
                const i = hint.get(bo);
                if (i !== undefined && arr[i] === bo) continue;
                const j = arr.lastIndexOf(bo);
                if (j >= 0) hint.set(bo, j);
                else hint.delete(bo);
            }
        }
        const order = this.order;
        order.length = 0;
        for (const bo of tracked.keys()) {
            if (hint.has(bo)) order.push(bo);
            else tracked.delete(bo);
        }
        order.sort((a, b) => hint.get(a)! - hint.get(b)!);
        for (let i = 0; i < order.length; i++) {
            const bo = order[i];
            if (!visit(bo) && !(tracked.get(bo)! >= nowMs)) {
                tracked.delete(bo);
                hint.delete(bo);
            }
        }
        order.length = 0;
    }

    /** Stop watching (the owner is going away). */
    dispose(): void {
        if (this.notes !== null) unwatchBuiltObjectEffects(this.galaxy, this.notes);
        this.notes = null;
        this.tracked.clear();
        this.posHint.clear();
    }
}
