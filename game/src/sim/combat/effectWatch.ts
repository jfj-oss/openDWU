// Observation-only signal for the Main View's effects layer (render/effectsLayer.ts): the built objects that just
// started something the view animates — a shot fired, an explosion, a shield or ion strike, a hyperjump flag, a fighter
// launch. With it the layer re-checks only the objects that have (or just got) something to draw, instead of scanning
// every built object and all its weapons on every step to find the few hundred that do.
//
// Not sim state: nothing in the sim reads it, it draws no Rnd, it is not saved and not in the digest (a module WeakMap
// beside the galaxy, like logistics/tradeFlows.ts). Off unless a watcher is attached: each note is then one WeakMap
// probe. In-thread the Main View watches its galaxy; in sim-worker mode the worker host watches the authoritative one
// and sends the noted objects with each step (simworker/simHost.ts), and the main thread notes them on the replica.
// No DOM / Pixi imports.

import type { BuiltObject } from '../builtObject';
import type { Galaxy } from '../galaxy';

interface Watcher {
    notes: Set<BuiltObject>;
    /** Most notes kept unread (a watcher that stops reading cannot grow without bound; it sees the size and rescans). */
    cap: number;
}

const watches = new WeakMap<object, Watcher[]>();

/** Default `cap` of a watcher: more unread notes than this are not kept (the reader sees a full set and rescans). */
export const EFFECT_WATCH_CAP = 16384;

/** Start watching `galaxy`: the returned set (one per watcher) collects every noted object until its watcher clears it
 *  (at most `cap` of them). */
export function watchBuiltObjectEffects(galaxy: Galaxy, cap = EFFECT_WATCH_CAP): Set<BuiltObject> {
    const notes = new Set<BuiltObject>();
    const list = watches.get(galaxy);
    if (list === undefined) watches.set(galaxy, [{ notes, cap }]);
    else list.push({ notes, cap });
    return notes;
}

/** Stop the watcher whose set is `notes`. */
export function unwatchBuiltObjectEffects(galaxy: Galaxy, notes: Set<BuiltObject>): void {
    const list = watches.get(galaxy);
    if (list === undefined) return;
    const i = list.findIndex((w) => w.notes === notes);
    if (i >= 0) list.splice(i, 1);
    if (list.length === 0) watches.delete(galaxy);
}

/** Whether a watcher is attached to `galaxy`. */
export function builtObjectEffectsWatched(galaxy: Galaxy): boolean {
    return watches.has(galaxy);
}

/**
 * `bo` just fired a shot, got an explosion, a shield / ion strike or a hyperjump flag, or launched a fighter (called
 * where the sim does so). Observation only.
 */
export function noteBuiltObjectEffect(galaxy: Galaxy, bo: BuiltObject): void {
    const list = watches.get(galaxy);
    if (list === undefined) return;
    for (let i = 0; i < list.length; i++) {
        const w = list[i];
        if (w.notes.size < w.cap) w.notes.add(bo);
    }
}
