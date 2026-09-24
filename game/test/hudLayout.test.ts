import { describe, expect, it } from 'vitest';
import { computeHudLayout, type Rect } from '../src/ui/hudLayout';

describe('computeHudLayout', () => {
    for (const [width, height] of [[1920, 1080], [1280, 720]] as const) {
        it(`positions are correct at ${width}x${height}`, () => {
            const l = computeHudLayout(width, height);

            // Fixed top-left controls.
            expect(l['btnPlayPause']).toEqual({ x: 10, y: 62, w: 80, h: 34 });
            expect(l['lblStarDate'].x).toBe(10);
            expect(l['lblStarDate'].y).toBe(10);
            expect(l['lblStateMoney'].x).toBe(width - 95);
            expect(l['lblPrivateMoney'].x).toBe(width - 95);

            // Selection panel takes the default (small) 280x240 branch; the
            // large 392x360 variant is set elsewhere at runtime.
            expect(l['pnlDetailInfo']).toEqual({ x: 44, y: 5, w: 280, h: 240 });

            // System map flush to bottom-right with a 10 px margin.
            expect(l['pnlSystemMap']).toEqual({
                x: width - 330 - 10,
                y: height - 290 - 10,
                w: 330,
                h: 290,
            });
            expect(l['picSystem']).toEqual({ x: 45, y: 5, w: 280, h: 280 });

            // Centered message bar / button row track the width.
            const num3 = Math.floor((width - 700) / 2);
            expect(l['lstMessages'].x).toBe(num3);
            expect(l['btnHistoryMessages'].x).toBe(num3 + 668);
            const num4 = Math.floor((width - 624) / 2);
            expect(l['tbtnColonies'].x).toBe(num4);
            // Row widths: 32×8 + 80×2 = 592.
            expect(l['tbtnTroops'].x).toBe(num4 + 592);

            // Bottom-anchored selection buttons track the height.
            const num6 = height - (240 + 45) + 1;
            expect(l['btnLockView'].y).toBe(num6);
            expect(l['btnCycleIdleShips'].y).toBe(num6 + 210);
            expect(l['btnSelectionBack']).toEqual({ x: 71, y: num6 - 36, w: 138, h: 28 });

            // Zoom buttons sit just above the system-map bottom edge.
            const num6b = height - (290 + 7) + 1;
            expect(l['btnZoomIn'].y).toBe(num6b + 30);
            expect(l['btnZoomRegion'].y).toBe(num6b + 180);
            expect(l['tbtnGalaxyMap'].y).toBe(num6b + 240);
            expect(l['tbtnGalaxyMap'].h).toBe(40);

            // Map overlay buttons start inside the system map's top edge.
            const num9 = height - (290 + 10) - 29;
            expect(l['btnMapCivilianFade'].x).toBe(width - (330 + 10) + 11);
            expect(l['btnMapCivilianFade'].y).toBe(num9);
            expect(l['btnMapOverlay8'].x).toBe(width - (330 + 10) + 11 + 35 * 8);

            // Every rect with a known size stays inside the screen.
            for (const r of Object.values(l) as Rect[]) {
                if (r.w > 0 || r.h > 0) {
                    expect(r.x, `x of ${r}`).toBeGreaterThanOrEqual(0);
                    expect(r.y, `y of ${r}`).toBeGreaterThanOrEqual(0);
                    if (r.w > 0) expect(r.x + r.w, `right of ${r}`).toBeLessThanOrEqual(width);
                    if (r.h > 0) expect(r.y + r.h, `bottom of ${r}`).toBeLessThanOrEqual(height);
                }
            }
        });
    }

    it('later assignments override earlier ones (C# order preserved)', () => {
        const l = computeHudLayout(1920, 1080);
        // pnlSystemMap gets its final Location after its Size and after the
        // zoom-button block: bottom-right corner minus the 10 px margin.
        expect(l['pnlSystemMap'].x).toBe(1920 - 340);
        expect(l['pnlSystemMap'].y).toBe(1080 - 300);
    });
});