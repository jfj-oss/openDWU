// [dw2overlays] The Resources overlay's layout (render/resourceOverlayLayout.ts): the ring of icons round a body, the
// screen-space LOD that keeps fewer icons where rings would crowd each other, and the abundance pie's step. Pure maths.

import { describe, expect, it } from 'vitest';
import {
    PIE_STEPS,
    RING_GAP_PX,
    RING_MAX_ICONS,
    abundancePieStep,
    chooseRingCounts,
    pieDiscPx,
    RINGS_MAX_VIEW_SIDE,
    pieWedge,
    ringAngle,
    ringRadiusPx,
    ringsShownAt,
    type RingPlacement,
    type RingSite,
} from '../src/render/resourceOverlayLayout';

/** A small deterministic generator (the tests must not depend on Math.random). */
function rng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

/** Icon centres of a site's ring of n icons turned by `phase` (the same geometry the overlay places). */
function iconCentres(site: RingSite, n: number, phase: number, iconPx: number): { x: number; y: number }[] {
    const r = ringRadiusPx(n, site.bodyPx, pieDiscPx(iconPx));
    const out: { x: number; y: number }[] = [];
    for (let i = 0; i < n; i++) out.push({ x: site.x + Math.cos(ringAngle(i, n, phase)) * r, y: site.y + Math.sin(ringAngle(i, n, phase)) * r });
    return out;
}

/** The counts chooseRingCounts keeps for some sites. */
function counts(sites: RingSite[], iconPx = 10): number[] {
    const out: RingPlacement[] = [];
    chooseRingCounts(sites, iconPx, out);
    return out.map((p) => p.count);
}

describe('Resources overlay ring geometry', () => {
    it('a ring clears its body, and its neighbours clear each other by the gap', () => {
        const disc = pieDiscPx(10); // 14 px
        expect(disc).toBe(14);
        // One icon: just outside the body and its own disc.
        expect(ringRadiusPx(1, 6, disc)).toBeCloseTo(3 + 7 + RING_GAP_PX);
        // Six icons: the chord between neighbours is one disc plus the gap.
        const r6 = ringRadiusPx(6, 6, disc);
        expect(2 * r6 * Math.sin(Math.PI / 6)).toBeCloseTo(disc + RING_GAP_PX);
        // A bigger body pushes the ring out, and more icons never shrink it.
        expect(ringRadiusPx(1, 40, disc)).toBeGreaterThan(ringRadiusPx(1, 6, disc));
        for (let n = 2; n <= RING_MAX_ICONS; n++) expect(ringRadiusPx(n, 6, disc)).toBeGreaterThanOrEqual(ringRadiusPx(n - 1, 6, disc));
    });

    it('icon 0 sits at 12 o clock and the rest run clockwise', () => {
        expect(ringAngle(0, 4)).toBeCloseTo(-Math.PI / 2);
        expect(ringAngle(1, 4)).toBeCloseTo(0); // 3 o clock on screen (y points down)
        expect(ringAngle(2, 4)).toBeCloseTo(Math.PI / 2);
    });
});

describe('Resources overlay screen-space LOD', () => {
    it('keeps the full ring for bodies with room', () => {
        const sites: RingSite[] = [
            { x: 0, y: 0, bodyPx: 6, want: 6 },
            { x: 500, y: 0, bodyPx: 6, want: 6 },
            { x: 0, y: 500, bodyPx: 6, want: 3 },
        ];
        expect(counts(sites)).toEqual([6, 6, 3]);
    });

    it('falls back to fewer icons where a neighbour ring would crowd it, and never below one', () => {
        const near: RingSite[] = [
            { x: 0, y: 0, bodyPx: 6, want: 6 },
            { x: 40, y: 0, bodyPx: 6, want: 6 },
        ];
        const out = counts(near);
        expect(out[0]).toBe(6); // the first one (most important) keeps its ring
        expect(out[1]).toBeLessThan(6);
        expect(out[1]).toBeGreaterThanOrEqual(1);
        // Bodies on top of each other: the second keeps a lone icon, which may still overlap.
        expect(counts([{ x: 0, y: 0, bodyPx: 6, want: 6 }, { x: 0, y: 0, bodyPx: 6, want: 6 }])).toEqual([6, 1]);
    });

    it('a lone icon turns away from a neighbour instead of crowding it', () => {
        // Two single-icon bodies 16 px apart: each can turn its icon to the far side, so both keep their icon clear.
        const pair: RingSite[] = [
            { x: 0, y: 0, bodyPx: 6, want: 1 },
            { x: 16, y: 0, bodyPx: 6, want: 1 },
        ];
        const out: RingPlacement[] = [];
        chooseRingCounts(pair, 10, out);
        expect(out.map((p) => p.count)).toEqual([1, 1]);
        const a = iconCentres(pair[0], 1, out[0].phase, 10)[0];
        const b = iconCentres(pair[1], 1, out[1].phase, 10)[0];
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(pieDiscPx(10) + RING_GAP_PX - 1e-9);
    });

    it('never offers more icons than a body has, or than RING_MAX_ICONS', () => {
        expect(counts([{ x: 0, y: 0, bodyPx: 6, want: 1 }, { x: 300, y: 0, bodyPx: 6, want: 20 }], 15)).toEqual([1, RING_MAX_ICONS]);
    });

    it('no two icons of rings that kept two or more overlap (random layouts, dense and sparse)', () => {
        const rand = rng(7);
        for (const [spread, count, iconPx] of [
            [600, 300, 10],
            [120, 200, 10],
            [900, 120, 15],
        ] as const) {
            const sites: RingSite[] = [];
            for (let i = 0; i < count; i++) sites.push({ x: rand() * spread, y: rand() * spread, bodyPx: 4 + rand() * 26, want: 1 + Math.floor(rand() * 6) });
            const out: RingPlacement[] = [];
            chooseRingCounts(sites, iconPx, out);
            const reach = pieDiscPx(iconPx) + RING_GAP_PX;
            const icons: { x: number; y: number; site: number }[] = [];
            sites.forEach((s, si) => {
                if (out[si].count < 2) return; // a lone icon is allowed to crowd (never below one)
                for (const c of iconCentres(s, out[si].count, out[si].phase, iconPx)) icons.push({ ...c, site: si });
            });
            let closest = Infinity;
            for (let a = 0; a < icons.length; a++) {
                for (let b = a + 1; b < icons.length; b++) {
                    if (icons[a].site === icons[b].site) continue;
                    closest = Math.min(closest, Math.hypot(icons[a].x - icons[b].x, icons[a].y - icons[b].y));
                }
            }
            expect(closest).toBeGreaterThanOrEqual(reach - 1e-9);
            // The count is never below one, and a crowded layout does shrink some rings.
            expect(Math.min(...out.map((p) => p.count))).toBeGreaterThanOrEqual(1);
            if (spread === 120) expect(out.some((p) => p.count < RING_MAX_ICONS)).toBe(true);
        }
    });
});

describe('Resources overlay abundance pie', () => {
    it('the step is the abundance (0..1000) in tenths of the circle, rounded and clamped', () => {
        expect(abundancePieStep(0)).toBe(0);
        expect(abundancePieStep(-5)).toBe(0);
        expect(abundancePieStep(Number.NaN)).toBe(0);
        expect(abundancePieStep(455)).toBe(5);
        expect(abundancePieStep(949)).toBe(9);
        expect(abundancePieStep(1000)).toBe(PIE_STEPS);
        expect(abundancePieStep(5000)).toBe(PIE_STEPS);
    });

    it('the wedge runs from 12 o clock clockwise over the step share of a full turn', () => {
        const full = pieWedge(PIE_STEPS);
        expect(full.start).toBeCloseTo(-Math.PI / 2);
        expect(full.end - full.start).toBeCloseTo(2 * Math.PI);
        expect(pieWedge(0).end - pieWedge(0).start).toBeCloseTo(0);
        expect(pieWedge(3).end - pieWedge(3).start).toBeCloseTo((2 * Math.PI * 3) / 10);
    });
});

describe('Resources overlay quarter-view threshold', () => {
    const GALAXY = 8e6; // the galaxy's larger side, world units
    const SHORT = 900; // the view's shorter side, px
    const quarterZoom = SHORT / (GALAXY * RINGS_MAX_VIEW_SIDE); // the audit's quarter view: the view spans G/4

    it('the rings show at the quarter view and closer, and hide zoomed out past it', () => {
        expect(RINGS_MAX_VIEW_SIDE).toBe(0.25);
        expect(ringsShownAt(quarterZoom, SHORT, GALAXY, 0)).toBe(true);
        expect(ringsShownAt(quarterZoom * 2, SHORT, GALAXY, 0)).toBe(true);
        expect(ringsShownAt(quarterZoom * 0.99, SHORT, GALAXY, 0)).toBe(false);
        expect(ringsShownAt(quarterZoom / 4, SHORT, GALAXY, 0)).toBe(false); // the full galaxy view
    });

    it('a picked selection keeps its rings at the full galaxy view', () => {
        expect(ringsShownAt(quarterZoom / 4, SHORT, GALAXY, 1)).toBe(true);
        expect(ringsShownAt(quarterZoom / 4, SHORT, GALAXY, 3)).toBe(true);
    });

    it('an unbounded or empty galaxy never hides them', () => {
        expect(ringsShownAt(1e-9, SHORT, Infinity, 0)).toBe(true);
        expect(ringsShownAt(1e-9, SHORT, 0, 0)).toBe(true);
    });
});
