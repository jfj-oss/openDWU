// UI control click sounds for every screen (the HUD keeps its own handler in
// hud.ts). The original's control classes each play one static sound
// (Main.Part13.cs:905-944 SetSoundLocation):
//   GlassButton.OnClick       (GlassButton.cs:119)   → button1.wav
//   HoverButton.OnClick       (HoverButton.cs:40)    → button2.wav
//   HoverMenuItem.OnClick     (HoverMenuItem.cs:82)  → button2.wav
//   ListViewBase.OnSelectionChanged (ListViewBase.cs:167) → grid.wav
// Here the DOM stand-ins are classified by a delegated click listener:
// order/context-menu items are HoverMenuItems, the start screen's items are
// HoverButtons, other buttons are GlassButtons and a click on a list/table
// row is a ListViewBase selection.

import { startEffects, uiClickSounds, type UiClickKind } from './effectsPlayer';

/** The subset of Element the classifier needs (tests pass plain objects). */
export interface ClosestLike {
    closest(selector: string): unknown;
}

/** Selector → kind, first match wins (Main.Part13.cs:905-944). */
export const UI_CLICK_RULES: ReadonlyArray<readonly [string, UiClickKind]> = [
    ['.order-menu-item, [role="menuitem"]', 'menuItem'],
    ['.main-menu-item', 'hover'],
    ['button:not(:disabled), input[type="button"], input[type="submit"]', 'glass'],
    ['tbody tr, [role="row"], [role="option"]', 'list'],
];

/** The click sound for a click target, or null (outside any control, or inside the HUD, which plays its own). */
export function classifyUiClick(target: ClosestLike | null): UiClickKind | null {
    if (target === null || typeof target.closest !== 'function') return null;
    if (target.closest('#hud') !== null) return null;
    for (const [selector, kind] of UI_CLICK_RULES) {
        if (target.closest(selector) !== null) return kind;
    }
    return null;
}

let installed = false;

/** Install the document-level click sounds once (main menu and in game). */
export function installUiClickSounds(): void {
    if (installed || typeof document === 'undefined') return;
    installed = true;
    // GlassButton.Volume etc. follow the Options' sound-effects volume / mute (startEffects applies them).
    try {
        startEffects();
    } catch {
        // no audio
    }
    document.addEventListener(
        'click',
        (e) => {
            const kind = classifyUiClick(e.target as Element | null);
            if (kind !== null) void uiClickSounds().play(kind);
        },
        true,
    );
}
