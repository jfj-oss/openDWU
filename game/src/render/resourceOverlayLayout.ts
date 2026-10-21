// [dw2overlays] Resources overlay layout (Pixi-free, unit-tested): the ring of icons round a system's star (or a
// habitat at system zoom), how many icons a ring keeps when its neighbours on screen would crowd it, and the step of the
// abundance pie that sits behind each icon.
//
// Every length here is in screen px (the caller multiplies world units by the zoom). An icon sits in front of a pie disc
// (its abundance as a share of a full circle, in the rarity colour); the disc is the icon's footprint for spacing.

/** Most icons one ring shows (a system's or habitat's most important resources, rarest / most abundant first). */
export const RING_MAX_ICONS = 6;
/** Clear space between two neighbouring pie discs, px. */
export const RING_GAP_PX = 3;
/** The pie disc is this much wider than its icon, so the abundance shows as a rim round the icon. */
export const PIE_RIM_PX = 4;
/** The abundance pies are pre-baked in steps of one tenth of a full circle (0..PIE_STEPS). */
export const PIE_STEPS = 10;
/** A ring may be turned to any of this many equal phases to find room for its icons (the LOD tries them in turn). */
export const RING_PHASE_STEPS = 24;

/** Pie disc width for an icon `iconPx` wide. */
export function pieDiscPx(iconPx: number): number {
    return iconPx + PIE_RIM_PX;
}

/** Radius of a ring of `n` icons round a body `bodyPx` wide, px from the body's centre: clear of the body, and wide
 * enough that the discs of neighbouring icons do not touch (chord >= disc + gap). One icon sits on the same ring. */
export function ringRadiusPx(n: number, bodyPx: number, discPx: number): number {
    const clear = bodyPx / 2 + discPx / 2 + RING_GAP_PX;
    if (n <= 1) return clear;
    const slot = discPx + RING_GAP_PX;
    return Math.max(clear, slot / (2 * Math.sin(Math.PI / n)));
}

/** Angle of icon `i` of `n` on its ring: icon 0 at 12 o'clock (turned by `phase`), the others clockwise (screen y
 * points down). */
export function ringAngle(i: number, n: number, phase = 0): number {
    return -Math.PI / 2 + phase + (2 * Math.PI * i) / n;
}

/** One body (a system's star or a habitat) that wants a ring: its centre and drawn width, px, and how many icons it has. */
export interface RingSite {
    x: number;
    y: number;
    bodyPx: number;
    want: number;
}

/** A placed icon's grid key: cells `reach` px square; the key packs the cell's column and row. */
function cellKey(cx: number, cy: number): number {
    return cx * 1000003 + cy;
}

/** Does an icon centred at (x, y) come within `reach` px of one already placed? `grid` holds x, y pairs per cell. */
function hitsPlaced(grid: Map<number, number[]>, x: number, y: number, reach: number): boolean {
    const cx = Math.floor(x / reach);
    const cy = Math.floor(y / reach);
    const r2 = reach * reach;
    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            const cell = grid.get(cellKey(cx + dx, cy + dy));
            if (cell === undefined) continue;
            for (let j = 0; j < cell.length; j += 2) {
                const ex = cell[j] - x;
                const ey = cell[j + 1] - y;
                if (ex * ex + ey * ey < r2) return true;
            }
        }
    }
    return false;
}

/** Walks the `n` icon centres of a site's ring turned by `phase`; `visit` returns true to stop (then so does this). */
function forRingIcons(site: RingSite, n: number, phase: number, discPx: number, visit: (x: number, y: number) => boolean): boolean {
    const r = ringRadiusPx(n, site.bodyPx, discPx);
    for (let i = 0; i < n; i++) {
        const a = ringAngle(i, n, phase);
        if (visit(site.x + Math.cos(a) * r, site.y + Math.sin(a) * r)) return true;
    }
    return false;
}

/** Where a site's ring goes: how many icons it keeps and the phase it is turned to. */
export interface RingPlacement {
    count: number;
    phase: number;
}

/**
 * Screen-space LOD for the Resources overlay: how many icons each site's ring keeps, and where it is turned. Sites are
 * taken in the order given (put the most important first). A site keeps as many of its `want` icons (at most
 * RING_MAX_ICONS) as fit without any of its icons' discs touching an icon already placed for an earlier site, turning
 * the ring through RING_PHASE_STEPS phases (12 o'clock first) to find room; it never keeps fewer than one (a lone icon
 * may still overlap a neighbour when no phase clears it). Writes the placement per site into `out`, in the same order.
 */
export function chooseRingCounts(sites: readonly RingSite[], iconPx: number, out: RingPlacement[]): void {
    const disc = pieDiscPx(iconPx);
    const reach = disc + RING_GAP_PX; // icon centres closer than this overlap their discs' gap
    const grid = new Map<number, number[]>();
    out.length = sites.length;
    for (let s = 0; s < sites.length; s++) {
        const site = sites[s];
        let n = Math.min(RING_MAX_ICONS, Math.max(1, Math.floor(site.want)));
        let phase = 0;
        for (;;) {
            let free: number | null = null;
            for (let k = 0; k < RING_PHASE_STEPS && free === null; k++) {
                const p = (2 * Math.PI * k) / RING_PHASE_STEPS;
                if (!forRingIcons(site, n, p, disc, (x, y) => hitsPlaced(grid, x, y, reach))) free = p;
            }
            if (free !== null) {
                phase = free;
                break;
            }
            if (n === 1) break; // a lone icon with no clear phase stays where it is
            n--;
        }
        out[s] = { count: n, phase };
        forRingIcons(site, n, phase, disc, (x, y) => {
            const key = cellKey(Math.floor(x / reach), Math.floor(y / reach));
            let cell = grid.get(key);
            if (cell === undefined) grid.set(key, (cell = []));
            cell.push(x, y);
            return false;
        });
    }
}

/** The abundance pie's step for an abundance (0..1000, i.e. 0..100 %), rounded to the nearest tenth of the circle. */
export function abundancePieStep(abundance: number): number {
    if (!(abundance > 0)) return 0;
    return Math.min(PIE_STEPS, Math.round((abundance / 1000) * PIE_STEPS));
}

/** The pie's wedge for a step: from 12 o'clock clockwise, `step` tenths of a full turn (radians). */
export function pieWedge(step: number): { start: number; end: number } {
    const start = -Math.PI / 2;
    return { start, end: start + (2 * Math.PI * step) / PIE_STEPS };
}
