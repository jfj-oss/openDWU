// Build orders the player gave that the sim has not answered yet (UI side only, never part of the sim state).
// A base order from the selection panel goes to the construction job board (sim/player/constructionBoard.ts) at the next
// frame boundary and its reply lands one round trip later (docs/sim-worker.md §4.4); the real job then waits for a
// construction ship (often a long trip in a late-game galaxy). From the click until the reply the order shows as a
// pending row in the job lists ("Awaiting construction ship"), so it never looks as if the click was lost.
// No DOM / Pixi imports.

import type { ConstructionJobRow } from '../sim/player/constructionBoard';

export const AWAITING_SHIP_TEXT = 'Awaiting construction ship';

/** A pending entry that never got its reply (a lost message) is dropped after this long. */
const PENDING_MAX_MS = 30000;

interface Pending { id: number; label: string; at: number }
const pending: Pending[] = [];
let nextId = -1;

/** Note an order as sent. Returns the hook to call when its reply landed (any outcome). */
export function notePendingBuildOrder(label: string, now: number = Date.now()): () => void {
    const p: Pending = { id: nextId--, label, at: now };
    pending.push(p);
    return () => {
        const i = pending.indexOf(p);
        if (i >= 0) pending.splice(i, 1);
    };
}

/** True for the rows `pendingBuildRows` makes (they have no job on the board yet: nothing to cancel or move). */
export function isPendingJobRow(r: { id: number }): boolean {
    return r.id < 0;
}

/** The pending orders as job rows (negative ids), after the board's own rows. */
export function pendingBuildRows(now: number = Date.now()): ConstructionJobRow[] {
    for (let i = pending.length - 1; i >= 0; i--) if (now - pending[i].at > PENDING_MAX_MS) pending.splice(i, 1);
    return pending.map((p) => ({ id: p.id, label: p.label, state: 'open', ship: null, shipName: '', etaMs: null }));
}

/** The board's rows plus the pending ones. */
export function withPendingBuildRows(rows: ConstructionJobRow[]): ConstructionJobRow[] {
    const extra = pendingBuildRows();
    return extra.length === 0 ? rows : [...rows, ...extra];
}

/** Tests / a new game. */
export function clearPendingBuildOrders(): void {
    pending.length = 0;
}
