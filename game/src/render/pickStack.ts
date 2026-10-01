// Stacked-object pick menu (pure part): every drawn object whose art covers the cursor, so a click on a pile of
// overlapping ships / bases / planets / creatures can offer a choice instead of silently taking the smallest.
// No Pixi / DOM imports; the MainView builds the candidates from the layers (fog / visibility already applied).

export type PickKind = 'creature' | 'ship' | 'base' | 'moon' | 'planet' | 'star' | 'other';

/** One drawn, pickable object: world centre where it is drawn, and its on-screen diameter in px. */
export interface PickCandidate<T> {
    item: T;
    kind: PickKind;
    x: number;
    y: number;
    sizePx: number;
}

export interface PickHit<T> {
    item: T;
    kind: PickKind;
    /** Screen-px distance from the cursor to the object's centre. */
    distPx: number;
    sizePx: number;
}

/** Most in-front first when drawn sizes tie (creatures and ships over bodies). */
const KIND_RANK: Record<PickKind, number> = { creature: 0, ship: 1, base: 2, moon: 3, planet: 4, star: 5, other: 6 };

/** Max rows in the popup (it scrolls past this). */
export const PICK_MENU_MAX_ROWS = 12;

/**
 * All candidates whose drawn disc (radius sizePx / 2, at least `minRadiusPx`) contains the world point, deduplicated
 * by item, ordered smallest drawn size first (the order the single-pick functions prefer), then rank, then distance.
 * Capped to `limit` entries (the list is sorted before capping).
 */
export function collectHitsUnderPoint<T>(
    cands: readonly PickCandidate<T>[],
    wx: number,
    wy: number,
    zoom: number,
    minRadiusPx = 6,
    limit = 64,
): PickHit<T>[] {
    const seen = new Set<T>();
    const hits: PickHit<T>[] = [];
    for (const c of cands) {
        if (!(c.sizePx > 0) || seen.has(c.item)) continue;
        const distPx = Math.hypot(wx - c.x, wy - c.y) * zoom;
        if (distPx > Math.max(c.sizePx / 2, minRadiusPx)) continue;
        seen.add(c.item);
        hits.push({ item: c.item, kind: c.kind, distPx, sizePx: c.sizePx });
    }
    hits.sort((a, b) => a.sizePx - b.sizePx || KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.distPx - b.distPx);
    return hits.slice(0, Math.max(0, limit));
}

/** The popup is offered only when two or more distinct objects lie under the cursor. */
export function needsPickMenu(hits: readonly unknown[]): boolean {
    return hits.length >= 2;
}
