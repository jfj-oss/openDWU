// The T key: Main.Part7.cs:3085 Main_KeyUp CyclePanelVisibility — three steps over the Main form's controls:
//
//   pnlInfoPanel visible  → method_472(bool_28: true)  hide every panel / button but the system map corner
//   pnlSystemMap visible  → method_472(bool_28: false) hide that corner too (Main.Part5.cs:2315)
//   otherwise             → method_473()               show everything again (Main.Part5.cs:2472)
//
// method_472(true) hides the selection panel (pnlInfoPanel, pnlDetailInfo, the selection back / forward, panel size,
// zoom-to-selection, nearest-military, stance, help, the eight action buttons, the cyclers and the lock), the message
// ticker (lstMessages), the top buttons (play / pause, speed, game menu, the history buttons, every screen button) and
// the left sidebar (itemListCollectionPanel_0); it keeps pnlSystemMap / picSystem, the zoom buttons, the map overlay
// buttons and the diplomatic message queue. method_472(false) hides those as well. What MainView draws itself
// (method_18: the star date and speed text, the money / cashflow block and the system name) stays in every step.
//
// Port: the system map corner is pnlSystemMap (hudSystemMap.ts: the panel, its zoom strip and our size toggle) plus our options list (pnlOptionsList: the overlay toggles, the original's row
// of overlay buttons), the message stub list (messageStubList.ts) for the diplomatic message queue; the date text of
// pnlTopLeftBar and pnlMoney are the MainView-drawn parts. The state is a data attribute on <body> read by hud.css.
//
// Changed at the user's request (not the original's order): T cycles all → everything but the system map → no UI →
// all. 'nomap' hides only the system map corner (pnlSystemMap); 'none' is method_472(false)'s state.
// TODO(port): the hover message's move by the panel height (rectangle_0.Y / mainView.HoverMessageLocation,
// Main.Part7.cs 3094-3103) — our map tooltip follows the cursor (mapTooltip.ts).

/** 'all' = method_473's state, 'nomap' = everything but the system map, 'none' = after method_472(false). */
export type PanelVisibility = 'all' | 'nomap' | 'none';

/** The T key's step after `current`: all → nomap → none → all. */
export function nextPanelVisibility(current: PanelVisibility): PanelVisibility {
    if (current === 'all') return 'nomap';
    if (current === 'nomap') return 'none';
    return 'all';
}

/** HUD element names (data-hud) the 'nomap' step hides; everything else stays. */
export const MAP_CORNER_ELEMENTS: readonly string[] = ['pnlSystemMap'];
/** HUD element names drawn by MainView itself (method_18), never hidden. */
export const MAIN_VIEW_DRAWN_ELEMENTS: readonly string[] = ['pnlMoney'];

/** Whether a HUD element (by its data-hud name) is shown in a step. pnlTopLeftBar keeps its date text (hud.css). */
export function hudElementShown(name: string, state: PanelVisibility): boolean {
    if (state === 'all' || MAIN_VIEW_DRAWN_ELEMENTS.includes(name)) return true;
    if (name === 'pnlTopLeftBar') return true; // its buttons are hidden by CSS, the date text stays
    if (state === 'nomap') return !MAP_CORNER_ELEMENTS.includes(name);
    return false;
}

let state: PanelVisibility = 'all';

export function panelVisibility(): PanelVisibility {
    return state;
}

function apply(): void {
    if (typeof document === 'undefined') return;
    if (state === 'all') delete document.body.dataset.panels;
    else document.body.dataset.panels = state;
}

/** The T key. Returns the new step. */
export function cyclePanelVisibility(): PanelVisibility {
    state = nextPanelVisibility(state);
    apply();
    return state;
}

/** Show everything (a new game view starts with every panel, as Main does). */
export function resetPanelVisibility(): void {
    state = 'all';
    apply();
}
