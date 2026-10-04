// HUD layout (task 05c, top strip + selection frame re-ported). The top of the screen is the original's own layout
// (topBar.ts: Main.Part12.cs MainInit + MainView.cs method_18, scaled as one strip), the bottom-left is the original's
// selection frame, the bottom-right the original's system mini-map (pnlSystemMap, hudSystemMap.ts) with our options list
// ("View" popup) right above it.
// Pure function (no DOM/Pixi): returns a rect per element name, in screen pixels.

import { TOP_ROW_BUTTONS, topBarScreenLayout } from './topBar';

export interface Rect { x: number; y: number; w: number; h: number }

/** Top-middle buttons: the screen-button row (original order, Main.Part12.cs 1727-1789) plus the message history
 *  (envelope) and galactic history (hourglass) buttons beside the message box. */
export const TOP_BAR_BUTTONS = [...TOP_ROW_BUTTONS.map((b) => b.name), 'btnHistoryMessages', 'btnGalacticHistory'] as const;

/** pnlSystemMap's size (Main.Part12.cs 2099-2100; hudSystemMap.ts SYSTEM_MAP_PANEL). */
export const SYSTEM_MAP_PANEL_W = 330;
export const SYSTEM_MAP_PANEL_H = 290;
/** Gap between the mini-map's top and the "View" button's bottom (CSS px at UI scale 1). */
export const OPTIONS_ABOVE_MAP_GAP = 4;

export function computeHudLayout(width: number, height: number, uiScale = 1): Record<string, Rect> {
    const layout: Record<string, Rect> = {};

    // ------------------------------------------------------------------
    // Top strip: message box + history buttons, the screen-button row, the top-left game menu / help / pause /
    // speed / date area, the top-right money block (+ system name) and our overflow button — the original's pixels
    // scaled by one factor (topBar.ts topBarScale), here in screen pixels.
    // ------------------------------------------------------------------
    Object.assign(layout, topBarScreenLayout(width, height, uiScale).rects);

    // ------------------------------------------------------------------
    // Bottom-left: the selection panel frame.
    // ------------------------------------------------------------------
    // The original's frame (Main.Part12.cs 1962-2097): 399 × 310 px from x = 10 down to 10 px above the bottom, in
    // the original's pixels (the HUD scales it, hud.ts selectionFrameScale).
    layout['pnlSelection'] = { x: 10, y: height - 310 - 10, w: 399, h: 310 };

    // ------------------------------------------------------------------
    // Bottom-right: the system mini-map, pnlSystemMap 330 × 290 at (mainView.Width - (330 + 10), mainView.Height -
    // (290 + 10)) (Main.Part12.cs 2099-2100, 2132), in the original's pixels (the HUD scales it from its bottom-right
    // corner, hud.ts applyHudScale).
    // ------------------------------------------------------------------
    layout['pnlSystemMap'] = { x: width - SYSTEM_MAP_PANEL_W - 10, y: height - SYSTEM_MAP_PANEL_H - 10, w: SYSTEM_MAP_PANEL_W, h: SYSTEM_MAP_PANEL_H };

    // ------------------------------------------------------------------
    // Bottom-right, above the mini-map: options list ("View" popup), 220 px
    // wide, anchored to the right edge with a 10 px margin (task 10e). Height
    // is content-driven (h = 0): its bottom sits OPTIONS_ABOVE_MAP_GAP px
    // above the mini-map's top (where the original has its row of overlay
    // buttons, 29 px above the panel); the list pops up from there.
    // ------------------------------------------------------------------
    layout['pnlOptionsList'] = { x: width - 220 - 10, y: height - 10 - SYSTEM_MAP_PANEL_H - OPTIONS_ABOVE_MAP_GAP, w: 220, h: 0 };

    return layout;
}