// Left-drag box selection in the Main View (pure parts: no Pixi / DOM).
// Port of Main.Part10.cs 2989 mainView_MouseUp (the drag-rectangle pick), Main.Part11.cs 1306 method_141 (the ships
// inside the rectangle), Main.Part11.cs 1285 method_140 (which of them a multi-selection keeps) and the Shift + left
// click toggle of Main.Part10.cs 3158-3248 (mainView_MouseClick). The C# tests the committed Xpos / Ypos against the
// rectangle converted to galaxy coordinates (method_151); here the rectangle stays in screen space and each object's
// drawn (render-interpolated) position is projected into it, which is the same test at any zoom.

import { BuiltObjectRole } from '../sim/data/designSpecifications';

/** A left press that moves less than this (px) before release is a click, not a drag (MainView's click threshold). */
export const DRAG_THRESHOLD_PX = 4;

/** A normalized screen rectangle (x0 <= x1, y0 <= y1). */
export interface ScreenBox {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
}

/** method_141: Math.Min / Math.Abs of the press and release points. */
export function screenBox(ax: number, ay: number, bx: number, by: number): ScreenBox {
    return { x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by) };
}

/** Whether a press at (ax, ay) released / moved to (bx, by) is a drag (>= DRAG_THRESHOLD_PX). */
export function isDrag(ax: number, ay: number, bx: number, by: number): boolean {
    return Math.hypot(bx - ax, by - ay) >= DRAG_THRESHOLD_PX;
}

/** method_141: Xpos >= num && Xpos <= num + num3 && Ypos >= num2 && Ypos <= num2 + num4 (inclusive edges). */
export function boxContains(box: ScreenBox, x: number, y: number): boolean {
    return x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1;
}

/** The BuiltObject fields the selection filter reads. */
export interface BoxSelectable {
    empire: unknown;
    owner: unknown;
    role: BuiltObjectRole;
    unbuiltComponentCount: number;
    hasBeenDestroyed: boolean;
}

/**
 * Main.Part11.cs 1285 method_140: a ship a multi-selection keeps — the player's (Empire == PlayerEmpire), not a base,
 * state-owned (Owner != null: private ships have Owner null, Empire.7.cs 1393) and fully built
 * (UnbuiltComponentCount <= 0).
 */
export function isBoxSelectable(bo: BoxSelectable, player: unknown): boolean {
    if (bo.empire !== player) return false;
    if (bo.role === BuiltObjectRole.Base) return false;
    if (bo.owner === null || bo.owner === undefined) return false;
    if (bo.unbuiltComponentCount > 0) return false;
    return true;
}

/**
 * method_141 over the drawn positions: every live object whose screen position lies inside `box` and that `include`
 * accepts (the caller passes the player's visibility test), in `objects` order.
 */
export function objectsInBox<T extends { hasBeenDestroyed: boolean }>(
    objects: Iterable<T | null | undefined>,
    box: ScreenBox,
    screenPosOf: (o: T) => { x: number; y: number },
    include: (o: T) => boolean = () => true,
): T[] {
    const out: T[] = [];
    for (const o of objects) {
        if (o === null || o === undefined || o.hasBeenDestroyed) continue;
        const p = screenPosOf(o);
        if (!boxContains(box, p.x, p.y)) continue;
        if (!include(o)) continue;
        out.push(o);
    }
    return out;
}

/** What a finished drag selects. */
export type BoxSelectResult<T> =
    | { kind: 'list'; ships: T[] } // method_208(builtObjectList2): several ships
    | { kind: 'single'; builtObject: T } // method_208(builtObject)
    | { kind: 'clear' } // method_208(null)
    | { kind: 'pickAtPress' } // method_142(int_32, int_33): whatever is under the press point (or nothing)
    | { kind: 'keep' }; // additive drag over nothing selectable: the selection stays

/** A one-ship list is a normal single selection; an empty one clears. */
function listOrSingle<T>(ships: T[]): BoxSelectResult<T> {
    if (ships.length > 1) return { kind: 'list', ships };
    if (ships.length === 1) return { kind: 'single', builtObject: ships[0] };
    return { kind: 'clear' };
}

/**
 * Main.Part10.cs 2989-3044 mainView_MouseUp: the selection a drag rectangle gives. `inBox` is method_141's list
 * (visible objects inside the rectangle). More than one: the method_140 ships among them (several → the list, one →
 * that ship, none → nothing selected). Exactly one object: that object, whatever it is. None: the object under the
 * press point.
 * `additive` (Shift / Ctrl held; an addition here — the C# drag replaces the selection) adds the method_140 ships to
 * `current` (the selected ships: the list, or the one selected ship when it passes method_140) instead.
 */
export function resolveBoxSelection<T extends BoxSelectable>(inBox: readonly T[], player: unknown, additive = false, current: readonly T[] = []): BoxSelectResult<T> {
    if (additive) {
        const picked = inBox.filter((bo) => isBoxSelectable(bo, player));
        if (picked.length === 0) return { kind: 'keep' };
        const merged: T[] = current.filter((bo) => !bo.hasBeenDestroyed && isBoxSelectable(bo, player));
        for (const bo of picked) if (!merged.includes(bo)) merged.push(bo);
        return listOrSingle(merged);
    }
    if (inBox.length > 1) {
        return listOrSingle(inBox.filter((bo) => isBoxSelectable(bo, player)));
    }
    if (inBox.length === 1) return { kind: 'single', builtObject: inBox[0] };
    return { kind: 'pickAtPress' };
}

/**
 * Main.Part10.cs 3158-3248 (mainView_MouseClick, Shift + left click): toggle the clicked ship in the multi-selection.
 * `clicked` = the ship(s) under the cursor; `current` = the selected ship list, else the selected ship, else null (any
 * other selection). Returns the new selection: a ship list (2+), one ship, null (clear), or undefined when the click
 * picked no method_140 ship (the C# returns without changing anything).
 */
export function shiftClickSelection<T extends BoxSelectable>(current: T | readonly T[] | null, clicked: readonly T[], player: unknown): T | T[] | null | undefined {
    const builtObjectList = clicked.filter((bo) => isBoxSelectable(bo, player));
    if (builtObjectList.length <= 0) return undefined;
    const collapse = (list: T[]): T | T[] | null => (list.length > 1 ? list : list.length === 1 ? list[0] : null);
    if (Array.isArray(current)) {
        // 3184-3207: toggle each clicked ship in / out of the list.
        const list2 = (current as readonly T[]).slice();
        for (const item of builtObjectList) {
            const i = list2.indexOf(item);
            if (i >= 0) list2.splice(i, 1);
            else list2.push(item);
        }
        return collapse(list2);
    }
    if (current !== null && isBoxSelectable(current as T, player)) {
        // 3208-3239: the selected ship first (dropped when it is clicked again), then the clicked ones.
        let builtObject5: T | null = current as T;
        const list3: T[] = [];
        for (const item of builtObjectList) {
            if (builtObject5 === item) builtObject5 = null;
            else list3.push(item);
        }
        if (builtObject5 !== null) list3.unshift(builtObject5);
        return collapse(list3);
    }
    // 3240-3247: anything else selected — the clicked ships.
    return collapse(builtObjectList.slice());
}
