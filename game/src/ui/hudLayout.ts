// Streamlined HUD layout (task 05c). The original's full control set from
// Main.Part12.cs MainInit is reduced to: the top-middle message panel +
// screen-launch button row (positions unchanged, still ported from the C#),
// plus four new panels — a compact top-left bar, a top-right money/system
// block, a bottom-left selection panel and a bottom-right options list.
// Pure function (no DOM/Pixi): returns a rect per element name.

export interface Rect { x: number; y: number; w: number; h: number }

/** Top-middle button row order (original LoadUiChromeButtons set). */
export const TOP_BAR_BUTTONS = [
    'tbtnColonies',
    'btnExpansionPlanner',
    'btnEmpireGraphs',
    'btnEmpirePolicy',
    'btnGameEditor',
    'tbtnIntelligenceAgents',
    'tbtnEmpires',
    'btnEmpireSummary',
    'tbtnResearch',
    'tbtnDesigns',
    'btnBuildOrder',
    'tbtnConstructionYards',
    'tbtnBuiltObjects',
    'tbtnShipGroups',
    'tbtnTroops',
    'btnHistoryMessages',
    'btnGalacticHistory',
] as const;

/** Cycle chips of the streamlined selection panel footer. The original's
    cycle<X>.png art bakes a "›" arrow into each icon, so the chips render
    as short text labels instead (task 05d). */
export const CYCLE_CHIPS = [
    { key: 'colonies', label: 'Colonies' },
    { key: 'bases', label: 'Bases' },
    { key: 'military', label: 'Military' },
    { key: 'construction', label: 'Constr.' },
    { key: 'other', label: 'Other' },
    { key: 'fleets', label: 'Fleets' },
    { key: 'idleShips', label: 'Idle' },
] as const;

export type CycleChipKey = (typeof CYCLE_CHIPS)[number]['key'];

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

export function computeHudLayout(width: number, height: number): Record<string, Rect> {
    const layout: Record<string, Rect> = {};

    // ------------------------------------------------------------------
    // Top-middle: message panel + screen-launch button row. Positions are
    // the original's (Main.Part12.cs MainInit) and stay exactly as before.
    // ------------------------------------------------------------------
    const num3 = Math.floor((width - 700) / 2);
    layout['lstMessages'] = { x: num3, y: 10, w: 668, h: 80 };
    // The original's int division truncates (num3 + 668 is the exact edge).
    const msgEdge = Math.floor((width - 700) / 2 + 668);

    // int num4 = (rectangle.Width - 624) / 2; then sequential += per width.
    const num4 = Math.floor((width - 624) / 2);
    let num5 = num4;
    for (const name of TOP_BAR_BUTTONS) {
        const w = name === 'tbtnEmpires' || name === 'btnEmpireSummary' || name === 'tbtnResearch' ? 80 : 32;
        if (name === 'btnHistoryMessages') {
            // Envelope button sits to the right of the message panel, not in
            // the launch row (original Main.Part12.cs positions it at the
            // panel's right edge).
            layout[name] = { x: msgEdge, y: 10, w: 32, h: 48 };
            continue;
        }
        if (name === 'btnGalacticHistory') {
            // Hourglass button below the envelope, same column.
            layout[name] = { x: msgEdge, y: 58, w: 32, h: 32 };
            continue;
        }
        layout[name] = { x: num5, y: 90, w, h: 32 };
        num5 += w;
    }

    // ------------------------------------------------------------------
    // Top-left: one compact bar at (10,10).
    // ------------------------------------------------------------------
    layout['pnlTopLeftBar'] = { x: 10, y: 10, w: 300, h: 40 };

    // ------------------------------------------------------------------
    // Top-right: money block + system name, one panel anchored to the right
    // edge (10 px margin) so its values never clip past the screen edge
    // (task 10e).
    // ------------------------------------------------------------------
    layout['pnlMoney'] = { x: width - 230 - 10, y: 10, w: 230, h: 100 };

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