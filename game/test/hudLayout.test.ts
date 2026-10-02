import { describe, expect, it } from 'vitest';
import { computeHudLayout, TOP_BAR_BUTTONS } from '../src/ui/hudLayout';
import { topBarLayout, topBarScale, TOP_ROW_BUTTONS } from '../src/ui/topBar';

describe('computeHudLayout (top strip = the original layout, scaled)', () => {
    for (const [width, height] of [[1920, 1080], [1600, 900], [1280, 720], [1440, 1080], [3840, 2160]] as const) {
        it(`positions are correct at ${width}x${height}`, () => {
            const l = computeHudLayout(width, height);
            const k = topBarScale(width, height, 1);
            const v = topBarLayout(width / k);
            // Every top element is its original-pixel rect × k.
            for (const [name, r] of Object.entries(v)) {
                expect(l[name].x, name).toBeCloseTo(r.x * k);
                expect(l[name].y, name).toBeCloseTo(r.y * k);
                expect(l[name].w, name).toBeCloseTo(r.w * k);
            }
            // The message box is centred: num3 = (W - 700) / 2 in the virtual width.
            const msg = l['lstMessages'];
            expect(msg.x + (700 * k) / 2).toBeCloseTo(width / 2, -1);
            // The money block ends at the right edge.
            expect(l['pnlMoney'].x + l['pnlMoney'].w).toBeCloseTo(width);
            // Selection panel anchored bottom-left with a 10 px margin.
            expect(l['pnlSelection']).toEqual({ x: 10, y: height - 310 - 10, w: 399, h: 310 });
            // Options list right-anchored with a 10 px margin; content-sized.
            expect(l['pnlOptionsList']).toEqual({ x: width - 220 - 10, y: height - 10, w: 220, h: 0 });
            // Every rect stays inside the screen.
            for (const [name, r] of Object.entries(l)) {
                expect(r.x, `x of ${name}`).toBeGreaterThanOrEqual(0);
                expect(r.y, `y of ${name}`).toBeGreaterThanOrEqual(0);
                if (r.w > 0) expect(r.x + r.w, `right of ${name}`).toBeLessThanOrEqual(width + 1e-6);
                if (r.h > 0) expect(r.y + r.h, `bottom of ${name}`).toBeLessThanOrEqual(height + 1e-6);
            }
            // The money block never overlaps the message box + its history buttons.
            expect(l['btnHistoryMessages'].x + l['btnHistoryMessages'].w).toBeLessThanOrEqual(l['pnlMoney'].x + 1e-6);
        });
    }

    it('the button row and history buttons are in the top-bar list, in the original order', () => {
        expect(TOP_BAR_BUTTONS.slice(0, TOP_ROW_BUTTONS.length)).toEqual(TOP_ROW_BUTTONS.map((b) => b.name));
        expect(TOP_BAR_BUTTONS.slice(-2)).toEqual(['btnHistoryMessages', 'btnGalacticHistory']);
        const l = computeHudLayout(1920, 1080);
        for (const name of TOP_BAR_BUTTONS) expect(l[name], name).toBeDefined();
    });
});
