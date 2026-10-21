// HUD fit rules at large UI scales (pure, screen pixels). The HUD blocks are anchored to the screen corners and each
// scales with the UI scale, so past ~170% they would run into each other; every rule here shrinks or moves ONE block
// (never lets two overlap), and is the identity at the scales where everything already fits:
//  - the bottom-left selection frame is capped so the left sidebar (Empire Navigation Tool) keeps room above it;
//  - the message stub list under the money block drops below any top-strip element it would run into;
//  - the bottom-right system map is capped so the "View" button and the stub list at its tallest stay above it.

import { stubListMaxHeightPx } from './messageStubs';
import { TOP_ROW_BUTTONS, topBarScreenLayout } from './topBar';

/** Room the left sidebar needs between the top strip and the selection frame, CSS px at a 1080 px tall window
 *  (about fifteen 22 px category buttons); grows with the window height like the HUD does. */
export const SIDEBAR_MIN_ROOM = 340;
/** Smallest sidebar category button, CSS px at a 1080 px tall window: its size at 100% UI scale (26 original px × 0.855), times the UI scale up to 150%. */
export const SIDEBAR_MIN_BUTTON_PX = 22;
/** Gap kept between neighbouring HUD blocks. */
export const FIT_GAP = 6;
/** The selection frame's height in the original's pixels (hud.ts SELECTION_FRAME) and its distance from the bottom edge. */
const SELECTION_H = 310;
const BOTTOM_MARGIN = 10;
/** The system map frame's height in the original's pixels (hudSystemMap.ts SYSTEM_MAP_PANEL). */
const MAP_H = 290;
/** The "View" button: height 24 + the 4 px gap above the map, at the UI scale (hud.ts). */
const OPTIONS_TOGGLE_H = 24 + 4;
/** Smallest scale a fitted frame is squeezed to, as a fraction of what it asked for. */
const MIN_FRACTION = 0.5;

/** Where the left sidebar may start: the bottom of the top-left area and of the screen-button buttons that start left of
 *  `sidebarRight` (the sidebar's right edge, screen px; default: all of them), plus a gap. */
export function topClearancePx(width: number, height: number, uiScale: number, sidebarRight = Infinity): number {
    const { rects } = topBarScreenLayout(width, height, uiScale);
    let bottom = 0;
    for (const name of ['pnlTopLeftBar', ...TOP_ROW_BUTTONS.map((b) => b.name)]) {
        const r = rects[name];
        if (r && (name === 'pnlTopLeftBar' || r.x < sidebarRight)) bottom = Math.max(bottom, r.y + r.h);
    }
    return Math.ceil(bottom) + FIT_GAP;
}

/** The selection frame's scale, capped so the sidebar keeps SIDEBAR_MIN_ROOM (× window height / 1080) between the top
 *  strip and the frame's top edge. `requested` is the scale the setting asks for (hud.ts selectionFrameScale). */
export function fitSelectionScale(requested: number, width: number, height: number, uiScale: number): number {
    const room = height - BOTTOM_MARGIN - topClearancePx(width, height, uiScale) - SIDEBAR_MIN_ROOM * Math.max(0.5, height / 1080);
    return Math.max(Math.min(requested, room / SELECTION_H), requested * MIN_FRACTION);
}

/** Top (screen px) of the message stub list: right under the money block (`moneyBottom` + 4 × UI scale), moved down
 *  below any centre-top element (message box, history buttons, screen-button row) its `stubLeft`..right edge reaches. */
export function stubListTopPx(width: number, height: number, uiScale: number, moneyBottom: number, stubLeft: number): number {
    let top = moneyBottom + 4 * uiScale;
    const { rects } = topBarScreenLayout(width, height, uiScale);
    for (const name of ['lstMessages', 'btnHistoryMessages', 'btnGalacticHistory', 'btnTopMore', ...TOP_ROW_BUTTONS.map((b) => b.name)]) {
        const r = rects[name];
        if (r && r.x + r.w > stubLeft) top = Math.max(top, r.y + r.h + 4 * uiScale);
    }
    return top;
}

/** The message stub list's width (unscaled CSS px) and its minimum margin from the right edge. */
export const STUB_LIST_W = 230;
export const STUB_LIST_MARGIN = 10;

/** The stub list's left edge: its width at the UI scale, right-aligned with its margin. */
export function stubListLeftPx(width: number, uiScale: number): number {
    return width - STUB_LIST_MARGIN - STUB_LIST_W * uiScale;
}

/** The system map frame's scale, capped so its top sits below the "View" button, which sits below the stub list at its
 *  tallest (`stubRows` rows). `requested` is the scale after the width cap (hud.ts systemMapFrameScale). */
export function fitSystemMapScale(requested: number, width: number, height: number, uiScale: number, stubRows: number): number {
    const { rects } = topBarScreenLayout(width, height, uiScale);
    const money = rects['pnlMoney'];
    const stubsTop = stubListTopPx(width, height, uiScale, money ? money.y + money.h : 0, stubListLeftPx(width, uiScale));
    const stubsBottom = stubsTop + stubListMaxHeightPx(stubRows) * uiScale;
    const room = height - BOTTOM_MARGIN - (stubsBottom + FIT_GAP + OPTIONS_TOGGLE_H * uiScale);
    return Math.max(Math.min(requested, room / MAP_H), requested * MIN_FRACTION);
}
