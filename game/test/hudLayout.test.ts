import { describe, expect, it } from 'vitest';
import { computeHudLayout, TOP_BAR_BUTTONS } from '../src/ui/hudLayout';

describe('computeHudLayout (streamlined, task 05c)', () => {
    for (const [width, height] of [[1920, 1080], [1600, 900], [1280, 720]] as const) {
        it(`positions are correct at ${width}x${height}`, () => {
            const l = computeHudLayout(width, height);

            // Top-middle message panel tracks the width.
            const num3 = Math.floor((width - 700) / 2);
            expect(l['lstMessages']).toEqual({ x: num3, y: 10, w: 668, h: 80 });
            // Buttons sit at the exact (truncated) right edge of the panel.
            const msgEdge = Math.floor((width - 700) / 2 + 668);
            expect(l['btnHistoryMessages'].x).toBe(msgEdge);
            expect(l['btnGalacticHistory'].x).toBe(msgEdge);

            // Screen-launch button row starts at the original's offset.
            const num4 = Math.floor((width - 624) / 2);
            expect(l['tbtnColonies'].x).toBe(num4);
            // tbtnTroops (last row button) at num4 + 592 = 6×32 + 3×80 + 5×32;
            // full row width 32×15 + 80×3 = 720 (the two history buttons sit
            // by the message panel, not in this row).
            expect(l[TOP_BAR_BUTTONS[14]].x).toBe(num4 + 592);

            // Top-left compact bar is fixed at (10,10).
            expect(l['pnlTopLeftBar']).toEqual({ x: 10, y: 10, w: 300, h: 40 });

            // Money block right-anchored with a 10 px margin (task 10e): its right edge
            // sits exactly at width - 10, so it can never clip the screen.
            expect(l['pnlMoney']).toEqual({ x: width - 230 - 10, y: 10, w: 230, h: 100 });
            expect(l['pnlMoney'].x + l['pnlMoney'].w).toBe(width - 10);

            // Selection panel anchored bottom-left with a 10 px margin.
            expect(l['pnlSelection']).toEqual({ x: 10, y: height - 220 - 10, w: 300, h: 220 });

            // Options list right-anchored (task 10e) with a 10 px margin;
            // height is content-driven (h = 0, task 05d) so it fits at any
            // window size.
            expect(l['pnlOptionsList']).toEqual({ x: width - 220 - 10, y: height - 10, w: 220, h: 0 });
            expect(l['pnlOptionsList'].x + l['pnlOptionsList'].w).toBe(width - 10);

            // Every rect stays inside the screen.
            for (const r of Object.values(l)) {
                expect(r.x, `x of ${r}`).toBeGreaterThanOrEqual(0);
                expect(r.y, `y of ${r}`).toBeGreaterThanOrEqual(0);
                if (r.w > 0) expect(r.x + r.w, `right of ${r}`).toBeLessThanOrEqual(width);
                if (r.h > 0) expect(r.y + r.h, `bottom of ${r}`).toBeLessThanOrEqual(height);
            }
        });
    }

    it('top-bar buttons are laid out sequentially in the original order', () => {
        const l = computeHudLayout(1920, 1080);
        let x = Math.floor((1920 - 624) / 2);
        for (const name of TOP_BAR_BUTTONS) {
            if (name === 'btnHistoryMessages' || name === 'btnGalacticHistory') continue; // by the message panel
            const w = name === 'tbtnEmpires' || name === 'btnEmpireSummary' || name === 'tbtnResearch' ? 80 : 32;
            expect(l[name].x).toBe(x);
            expect(l[name].w).toBe(w);
            expect(l[name].y).toBe(90);
            x += w;
        }
    });

    it('every rect stays inside the screen at 1600x900 and 1920x1080 (task 10e)', () => {
        for (const [width, height] of [[1600, 900], [1920, 1080]] as const) {
            const l = computeHudLayout(width, height);
            for (const [name, r] of Object.entries(l)) {
                expect(r.x, `x of ${name}`).toBeGreaterThanOrEqual(0);
                expect(r.y, `y of ${name}`).toBeGreaterThanOrEqual(0);
                if (r.w > 0) expect(r.x + r.w, `right of ${name}`).toBeLessThanOrEqual(width);
                if (r.h > 0) expect(r.y + r.h, `bottom of ${name}`).toBeLessThanOrEqual(height);
            }
        }
    });
});