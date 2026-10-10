// Perf: BuiltObjectList.FindBuiltObjectById over Galaxy.BuiltObjects (BuiltObjectList.cs 276: the first object with that
// id, or null) with the slot of the last hit remembered per id. A late-game galaxy holds tens of thousands of slots, so
// the plain scan is a cache-missing walk over every built object.
//
// Exactness: ids come from Galaxy.getNextBuiltObjectID (a counter, > 0), so at most one object in the list has a given
// id and "the first match" is "the match". A remembered slot is used only when it still holds that same object with
// that same id (the list may have nulled, compacted or appended slots since); otherwise the full scan runs, exactly as
// before. Nothing here is saved or read by anything else; a miss costs the scan it always cost.

import type { BuiltObject } from './builtObject';
import type { Galaxy } from './galaxy';

interface Slot {
    bo: BuiltObject;
    index: number;
}
const slotsByGalaxy = new WeakMap<Galaxy, Map<number, Slot>>();
/** Bound on remembered ids (ids of removed objects are only dropped when looked up again). */
const MAX_SLOTS = 8192;

/** BuiltObjectList.FindBuiltObjectById(id) on galaxy.builtObjects. No Rnd. */
export function findGalaxyBuiltObjectById(galaxy: Galaxy, id: number): BuiltObject | null {
    const list = galaxy.builtObjects;
    let slots = slotsByGalaxy.get(galaxy);
    if (slots === undefined) {
        slots = new Map();
        slotsByGalaxy.set(galaxy, slots);
    }
    if (id > 0) {
        const slot = slots.get(id);
        if (slot !== undefined && slot.index < list.length && list[slot.index] === slot.bo && slot.bo.builtObjectID === id) return slot.bo;
    }
    for (let i = 0; i < list.length; i++) {
        const b = list[i];
        if (b != null && b.builtObjectID === id) {
            if (id > 0) {
                if (slots.size >= MAX_SLOTS) slots.clear();
                slots.set(id, { bo: b, index: i });
            }
            return b;
        }
    }
    slots.delete(id);
    return null;
}
