// HUD layout (task 05c, top strip + selection frame re-ported). The top of the screen is the original's own layout
// (topBar.ts: Main.Part12.cs MainInit + MainView.cs method_18, scaled as one strip), the bottom-left is the original's
// selection frame, the bottom-right our options list (replacing the minimap).
// Pure function (no DOM/Pixi): returns a rect per element name, in screen pixels.

import { TOP_ROW_BUTTONS, topBarScreenLayout } from './topBar';

export interface Rect { x: number; y: number; w: number; h: number }

/** Top-middle buttons: the screen-button row (original order, Main.Part12.cs 1727-1789) plus the message history
 *  (envelope) and galactic history (hourglass) buttons beside the message box. */
export const TOP_BAR_BUTTONS = [...TOP_ROW_BUTTONS.map((b) => b.name), 'btnHistoryMessages', 'btnGalacticHistory'] as const;

/** View rows of the bottom-right options list. */
export const VIEW_ROWS = [
    { key: 'zoomSelection', label: 'Zoom to selection' },
    { key: 'zoomIn', label: 'Zoom in' },
    { key: 'zoomOut', label: 'Zoom out' },
    { key: 'zoomPlanet', label: '100% (planet level)' },
    { key: 'system', label: 'System' },
    { key: 'sector', label: 'Sector' },
    { key: 'galaxy', label: 'Galaxy' },
    { key: 'galaxyMap', label: 'Galaxy map (G)' },
] as const;

export type ViewRowKey = (typeof VIEW_ROWS)[number]['key'];

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
    // Bottom-right: options list, 220 px wide (replaces the minimap),
    // anchored to the right edge with a 10 px margin (task 10e). Height is
    // content-driven (h = 0): the CSS sizes it to its rows and scrolls if
    // the window is shorter than the list (task 05d).
    // ------------------------------------------------------------------
    layout['pnlOptionsList'] = { x: width - 220 - 10, y: height - 10, w: 220, h: 0 };

    return layout;
}