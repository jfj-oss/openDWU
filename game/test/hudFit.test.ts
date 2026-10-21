// Large-UI-scale HUD fit rules (hudFit.ts): each block shrinks / moves on its own instead of overlapping the next one,
// and nothing changes where everything already fit. Plus the Text size setting and the sidebar's squeezed area.
import { describe, expect, it } from 'vitest';
import {
    FIT_GAP,
    SIDEBAR_MIN_ROOM,
    STUB_LIST_W,
    fitSelectionScale,
    fitSystemMapScale,
    stubListLeftPx,
    stubListTopPx,
    topClearancePx,
} from '../src/ui/hudFit';
import { selectionFrameScale } from '../src/ui/hud';
import { itemListArea } from '../src/ui/leftSidebar';
import { stubListMaxHeightPx } from '../src/ui/messageStubs';
import { TOP_ROW_BUTTONS, topBarScreenLayout } from '../src/ui/topBar';
import { TEXT_SCALES, UI_SCALE_MAX, clampTextScale, DEFAULT_SETTINGS, getSettings, setSettingsStorage, textScaleFactor, updateSettings, loadSettings } from '../src/ui/settings';

const SIZES: [number, number][] = [
    [1366, 768],
    [1920, 1080],
    [2560, 1440],
    [3840, 2160],
];
const SCALES = [1, 1.25, 1.5, 1.66, 2, 2.5];

describe('fitSelectionScale', () => {
    it('is the identity where the sidebar already has its room (every size up to 166%)', () => {
        for (const [w, h] of SIZES) {
            for (const s of [1, 1.25, 1.5, 1.66]) {
                const want = selectionFrameScale(h, s, false);
                expect(fitSelectionScale(want, w, h, s)).toBe(want);
            }
        }
    });

    it('caps the frame so the sidebar keeps its room above it (150% .. 250%)', () => {
        for (const [w, h] of SIZES) {
            for (const s of SCALES) {
                const want = selectionFrameScale(h, s, false);
                const k = fitSelectionScale(want, w, h, s);
                expect(k).toBeLessThanOrEqual(want);
                expect(k).toBeGreaterThanOrEqual(want * 0.5);
                const frameTop = h - 10 - 310 * k;
                const room = frameTop - topClearancePx(w, h, s);
                // Either the sidebar has its room, or the frame is already at its floor (a very small window).
                if (k > want * 0.5 + 1e-9) expect(room).toBeGreaterThanOrEqual(SIDEBAR_MIN_ROOM * Math.max(0.5, h / 1080) - 1e-6);
            }
        }
    });

    it('the frame still grows with the scale up to the cap at 1080p', () => {
        const k = (s: number) => fitSelectionScale(selectionFrameScale(1080, s, false), 1920, 1080, s);
        expect(k(1.5)).toBeLessThan(k(1.66));
        expect(k(2)).toBeGreaterThan(k(1.66));
        expect(k(2.5)).toBeCloseTo(k(2), 6); // capped by the sidebar's room, not by the scale
    });
});

describe('stubListTopPx', () => {
    it('sits right under the money block when it clears the top strip', () => {
        const { rects } = topBarScreenLayout(1920, 1080, 1);
        const money = rects['pnlMoney'];
        expect(stubListTopPx(1920, 1080, 1, money.y + money.h, stubListLeftPx(1920, 1))).toBeCloseTo(money.y + money.h + 4);
    });

    it('drops below any top-strip button it would run into at a large scale', () => {
        for (const [w, h] of SIZES) {
            for (const s of SCALES) {
                const { rects } = topBarScreenLayout(w, h, s);
                const money = rects['pnlMoney'];
                const left = stubListLeftPx(w, s);
                const top = stubListTopPx(w, h, s, money.y + money.h, left);
                expect(top).toBeGreaterThanOrEqual(money.y + money.h);
                for (const name of ['lstMessages', 'btnHistoryMessages', 'btnGalacticHistory', 'btnTopMore', ...TOP_ROW_BUTTONS.map((b) => b.name)]) {
                    const r = rects[name];
                    if (r.x + r.w > left) expect(top).toBeGreaterThanOrEqual(r.y + r.h);
                }
            }
        }
    });
});

describe('fitSystemMapScale', () => {
    it('is the identity up to 166% and keeps the map below the stub list and the View button otherwise', () => {
        for (const [w, h] of SIZES) {
            for (const s of SCALES) {
                const want = selectionFrameScale(h, s, false);
                const k = fitSystemMapScale(want, w, h, s, 6);
                expect(k).toBeLessThanOrEqual(want);
                if (s <= 1.66) expect(k).toBe(want);
                const { rects } = topBarScreenLayout(w, h, s);
                const money = rects['pnlMoney'];
                const stubsBottom = stubListTopPx(w, h, s, money.y + money.h, stubListLeftPx(w, s)) + stubListMaxHeightPx(6) * s;
                const mapTop = h - 10 - 290 * k;
                if (k > want * 0.5 + 1e-9) expect(mapTop).toBeGreaterThanOrEqual(stubsBottom + FIT_GAP + 28 * s - 1e-6);
            }
        }
    });

    it('stub list geometry constants stay in step with the stub list', () => {
        expect(stubListLeftPx(1920, 2)).toBe(1920 - 10 - STUB_LIST_W * 2);
    });
});

describe('itemListArea with a squeezed region', () => {
    it('keeps the original region by default', () => {
        expect(itemListArea(1261, 941, 1, 150, 941 - 50)).toEqual(itemListArea(1261, 941, 1));
    });

    it('lays the area out in the given region and never makes it shorter than its button column (keepButtons)', () => {
        const a = itemListArea(505, 226, 1, 126, 283, true);
        expect(a.y).toBeGreaterThanOrEqual(126);
        expect(a.y + a.h).toBeLessThanOrEqual(283);
        expect(a.h).toBeGreaterThanOrEqual(15 * a.button);
        const plain = itemListArea(505, 226, 1, 126, 283);
        expect(plain.h).toBeLessThan(15 * plain.button); // the original's behaviour: buttons run out of the area
    });
});

describe('Text size setting', () => {
    it('offers 100..200% in 25% steps, defaulting to 100', () => {
        expect(TEXT_SCALES).toEqual([100, 125, 150, 175, 200]);
        expect(DEFAULT_SETTINGS.textScale).toBe(100);
    });

    it('snaps stored values to a choice and ignores junk', () => {
        expect(clampTextScale(130)).toBe(125);
        expect(clampTextScale(999)).toBe(200);
        expect(clampTextScale(10)).toBe(100);
        expect(clampTextScale('150')).toBe(100);
        expect(clampTextScale(NaN)).toBe(100);
    });
});

describe('Text size / GUI scale persistence', () => {
    it('round-trips through storage, snapping and clamping hand-edited values', () => {
        const map = new Map<string, string>();
        setSettingsStorage({ getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) });
        updateSettings({ textScale: 150, uiScale: 250 });
        expect(loadSettings()).toMatchObject({ textScale: 150, uiScale: 250 });
        expect(textScaleFactor()).toBe(1.5);
        map.set('dwu-ui-settings', JSON.stringify({ textScale: 133, uiScale: 900 }));
        expect(loadSettings()).toMatchObject({ textScale: 125, uiScale: UI_SCALE_MAX });
        expect(getSettings()).toBeDefined();
        setSettingsStorage(null);
    });
});
