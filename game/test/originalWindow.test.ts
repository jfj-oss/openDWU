import { describe, expect, it } from 'vitest';
import {
    gridClickSelection,
    amountBarWidth,
    hudScale,
    isLargeScreen,
    nextSortDir,
    originalVirtualSize,
    originalWindowScale,
    rgbCss,
    screenPanelLayout,
    sortRows,
} from '../src/ui/originalWindow';
import { HUD_FRAME_SIZE, TOP_BASE_SCALE, topBarScale } from '../src/ui/topBar';

describe('originalWindow scale', () => {
    it('uses the HUD factor (window height × UI scale × HUD_FRAME_SIZE)', () => {
        expect(hudScale(1080, 1)).toBeCloseTo(TOP_BASE_SCALE * HUD_FRAME_SIZE);
        expect(hudScale(2160, 1)).toBeCloseTo(2 * TOP_BASE_SCALE * HUD_FRAME_SIZE);
        expect(hudScale(1080, 1.5)).toBeCloseTo(1.5 * TOP_BASE_SCALE * HUD_FRAME_SIZE);
        // Same factor as the top strip on a wide window.
        expect(hudScale(1080, 1)).toBeCloseTo(topBarScale(1920, 1080, 1));
    });
    it('caps the scale so the window fits', () => {
        expect(originalWindowScale(1920, 1080, 1, 1180, 900)).toBeCloseTo(hudScale(1080, 1));
        const k = originalWindowScale(1920, 1080, 2, 1180, 900);
        expect(900 * k).toBeLessThanOrEqual(1080 - 16 + 1e-9);
    });
    it('picks the large variant from the virtual (original-pixel) window size', () => {
        expect(isLargeScreen(originalVirtualSize(1920, 1080, 1))).toBe(true);
        expect(isLargeScreen(originalVirtualSize(1920, 1080, 2))).toBe(false);
        expect(isLargeScreen({ w: 1180, h: 900 })).toBe(true);
        expect(isLargeScreen({ w: 1179, h: 900 })).toBe(false);
    });
    it('lays a ScreenPanel out like ScreenPanel.DoLayout', () => {
        const l = screenPanelLayout(1040, 760);
        expect(l.header).toEqual({ x: 7, y: 8, w: 1026, h: 51 });
        expect(l.body).toEqual({ x: 8, y: 59, w: 1024, h: 697 });
        expect(l.close).toEqual({ x: 985, y: 9, w: 30, h: 30 });
    });
});

describe('originalWindow grid helpers', () => {
    it('sorts stably, numbers numerically and strings case-insensitively', () => {
        const rows = [
            { n: 'b', v: 2 },
            { n: 'A', v: 1 },
            { n: 'c', v: 2 },
        ];
        expect(sortRows(rows, (r) => r.n, 'asc').map((r) => r.n)).toEqual(['A', 'b', 'c']);
        expect(sortRows(rows, (r) => r.v, 'desc').map((r) => r.n)).toEqual(['b', 'c', 'A']);
        expect(sortRows(rows, undefined, 'asc')).toEqual(rows);
        expect(nextSortDir(null)).toBe('asc');
        expect(nextSortDir('asc')).toBe('desc');
        expect(nextSortDir('desc')).toBe('asc');
    });
    it('sizes the amount bar like DataGridViewTextBoxDropShadowCell', () => {
        expect(amountBarWidth(0, 100, 164)).toBe(0);
        expect(amountBarWidth(100, 100, 164)).toBe(156);
        expect(amountBarWidth(1, 1000, 164)).toBe(1);
        expect(rgbCss(0x102030)).toBe('rgb(16, 32, 48)');
        expect(rgbCss(0x102030, 128)).toBe('rgba(16, 32, 48, 0.502)');
    });
});

describe('gridClickSelection (DataGridView MultiSelect)', () => {
    const keys = ['a', 'b', 'c', 'd'];
    it('plain click selects one; Ctrl toggles; Shift selects the range from the anchor; Ctrl+Shift adds it', () => {
        let st = gridClickSelection(keys, new Set<string>(), undefined, 'b', {}, true);
        expect([...st.selected]).toEqual(['b']);
        st = gridClickSelection(keys, st.selected, st.anchor, 'd', { shift: true }, true);
        expect([...st.selected].sort()).toEqual(['b', 'c', 'd']);
        expect(st.anchor).toBe('b');
        st = gridClickSelection(keys, st.selected, st.anchor, 'c', { ctrl: true }, true);
        expect([...st.selected].sort()).toEqual(['b', 'd']);
        st = gridClickSelection(keys, new Set(['d']), 'b', 'a', { ctrl: true, shift: true }, true);
        expect([...st.selected].sort()).toEqual(['a', 'b', 'd']);
    });
    it('without multiSelect every click is a plain click', () => {
        const st = gridClickSelection(keys, new Set(['a']), 'a', 'c', { ctrl: true, shift: true }, false);
        expect([...st.selected]).toEqual(['c']);
    });
});
