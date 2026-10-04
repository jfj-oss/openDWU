// "Improvements": the one category every Distant Worlds 2-inspired addition goes under. NOT a port: DW:U has none of
// them. They are UI only (no game rules change) and each can be switched off in Game Options → Improvements.
//
// The shared scaffolding (reuse it for a new improvement):
//   1. Add an entry to IMPROVEMENTS below (or call registerImprovement from the feature's module): a stable `id`, the
//      label and one-line description the Game Options group shows, and the default (on).
//   2. A map overlay that belongs to it: give its OVERLAY_ROWS row `improvement: '<id>'` (mapOverlays.ts). The View
//      popup (hud.ts buildOptionsList) lists those rows in an "Improvements" section below the original's Overlays,
//      without the "+" badge, and hides them while the improvement is off; mapOverlays.ts overlayActive(state, key) is
//      false then, so the renderer draws nothing.
//   3. Panels / rows: gate them with isImprovementEnabled('<id>'), and react to a toggle with onImprovementsChange.
// The on / off choices persist in the UI settings (settings.ts `improvements`, id → boolean; a missing id = default).
//
// The Game Options group is buildImprovementsGroup (screens/gameOptionsPanel.ts opens it from "Improvements...").

import { getSettings, onSettingsChange, updateSettings } from './settings';
import { COLORS, FONT, checkBox, el, place, text } from './originalWindow';
import { groupBox } from './originalWindowControls';

export interface Improvement {
    /** Stable id (settings key, OVERLAY_ROWS `improvement`). */
    id: string;
    /** Name in Game Options → Improvements. */
    label: string;
    /** One line under the name. */
    description: string;
    /** On unless the player turned it off. */
    default: boolean;
}

/** Title of the overlay section and of the options group. */
export const IMPROVEMENTS_TITLE = 'Improvements';

/** The registry, in display order. */
const IMPROVEMENTS: Improvement[] = [
    {
        id: 'supplyChain',
        label: 'Supply chain visibility',
        description: 'What construction is waiting for, the Supply Shortages map overlay and the per-resource supply panel.',
        default: true,
    },
];

/** Add an improvement (or replace the one with the same id). Returns it. */
export function registerImprovement(imp: Improvement): Improvement {
    const i = IMPROVEMENTS.findIndex((x) => x.id === imp.id);
    if (i >= 0) IMPROVEMENTS[i] = imp;
    else IMPROVEMENTS.push(imp);
    return imp;
}

/** Every registered improvement, in display order. */
export function improvements(): readonly Improvement[] {
    return IMPROVEMENTS;
}

export function improvementById(id: string): Improvement | null {
    return IMPROVEMENTS.find((x) => x.id === id) ?? null;
}

/** On / off for `id`: the player's choice, else the default (an unknown id is on). */
export function isImprovementEnabled(id: string): boolean {
    const v = getSettings().improvements?.[id];
    if (typeof v === 'boolean') return v;
    return improvementById(id)?.default ?? true;
}

export function setImprovementEnabled(id: string, on: boolean): void {
    if (isImprovementEnabled(id) === on) return;
    updateSettings({ improvements: { ...(getSettings().improvements ?? {}), [id]: on } });
}

/** Called after any improvement was switched (with its id), until the returned function unsubscribes. */
export function onImprovementsChange(cb: (id: string, on: boolean) => void): () => void {
    let last = new Map(IMPROVEMENTS.map((i) => [i.id, isImprovementEnabled(i.id)]));
    return onSettingsChange(() => {
        const next = new Map(IMPROVEMENTS.map((i) => [i.id, isImprovementEnabled(i.id)]));
        const prev = last;
        last = next;
        for (const [id, on] of next) if (prev.get(id) !== on) cb(id, on);
    });
}

/** Split overlay rows into the original's and the Improvements section (only the enabled improvements' rows). */
export function overlayRowSections<R extends { improvement?: string }>(rows: readonly R[]): { original: R[]; improvements: R[] } {
    const original: R[] = [];
    const extra: R[] = [];
    for (const r of rows) {
        if (r.improvement === undefined) original.push(r);
        else if (isImprovementEnabled(r.improvement)) extra.push(r);
    }
    return { original, improvements: extra };
}

/** Row pitch of the options group (check box line + description line). */
const ROW_H = 40;

/** Height of the options group for `n` improvements. */
export function improvementsGroupHeight(n = IMPROVEMENTS.length): number {
    return 30 + Math.max(1, n) * ROW_H;
}

/**
 * The Game Options "Improvements" group: one check box per improvement (its label) with its description below, in the
 * original-window style (originalWindowControls.groupBox / originalWindow.checkBox). Toggling saves at once.
 */
export function buildImprovementsGroup(width: number, size: number = FONT.normal): HTMLDivElement {
    const g = groupBox(IMPROVEMENTS_TITLE, width, improvementsGroupHeight(), FONT.header);
    g.classList.add('improvements-group');
    IMPROVEMENTS.forEach((imp, i) => {
        const y = 24 + i * ROW_H;
        const c = checkBox(imp.label, isImprovementEnabled(imp.id), (v) => setImprovementEnabled(imp.id, v), size);
        c.dataset.improvement = imp.id;
        g.appendChild(place(c, 10, y));
        g.appendChild(place(text(imp.description, { size: FONT.tiny, color: COLORS.label, wrapWidth: width - 50 }), 34, y + 19));
    });
    if (IMPROVEMENTS.length === 0) g.appendChild(place(el('div', 'ow-text', '(none)'), 10, 24));
    return g;
}
