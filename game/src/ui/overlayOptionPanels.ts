// [dw2overlays] The inline options panels that open under an overlay row of the View popup (its "…" button): the
// Resources overlay's resource picker ("show me where Caslon is"). Part of the Improvements category
// (ui/improvements.ts). UI-only: it reads the player's known-resource index (render/resourceOverlayData.ts) and sets the
// overlay option; nothing reaches the game.

import type { Galaxy } from '../sim/galaxy';
import { fogOf } from '../render/fog';
import { RARITY_LABELS, knownResourceIndexFor, resourcePickerOptions } from '../render/resourceOverlayData';
import { overlayOptionsOf, setOverlay, setOverlayResourceFilter, type MapOverlayState } from './mapOverlays';

export interface OverlayOptionPanel {
    element: HTMLElement;
    /** Re-read the counts (called when the panel opens). */
    refresh(): void;
}

/** The Resources overlay's picker: All known resources, or one resource (grouped very rare / rare / common, each with
 * the number of systems where the player knows of it). Picking one turns the overlay on. */
export function resourcePickerPanel(overlays: MapOverlayState, galaxy: Galaxy): OverlayOptionPanel {
    const wrap = document.createElement('div');
    wrap.className = 'hud-option-panel';
    const lbl = document.createElement('label');
    lbl.className = 'hud-option-panel-label';
    lbl.textContent = 'Show';
    const select = document.createElement('select');
    select.className = 'hud-option-select';
    select.title = 'Resource to find on the map';
    lbl.appendChild(select);
    wrap.appendChild(lbl);
    const note = document.createElement('div');
    note.className = 'hud-option-panel-note';
    note.textContent = 'Bar = abundance; colour = rarity (grey common, gold rare, violet very rare)';
    wrap.appendChild(note);
    select.addEventListener('change', () => {
        const v = select.value;
        setOverlayResourceFilter(overlays, v === '' ? null : Number(v));
        setOverlay(overlays, 'resources', true);
    });
    const refresh = (): void => {
        const player = galaxy.playerEmpire;
        const index = knownResourceIndexFor(galaxy, player, fogOf(galaxy).reveal);
        const opts = resourcePickerOptions(galaxy.resourceSystem.resources, index);
        const current = overlayOptionsOf(overlays).resourceFilter;
        select.replaceChildren();
        let group: HTMLOptGroupElement | null = null;
        let groupRarity: number | null = null;
        for (const o of opts) {
            const opt = document.createElement('option');
            opt.value = o.resourceId === null ? '' : String(o.resourceId);
            opt.textContent = o.resourceId === null ? `${o.label} (${o.systems} systems)` : o.label;
            if (o.resourceId !== null && o.systems === 0) opt.className = 'hud-option-none';
            if (o.resourceId === current) opt.selected = true;
            if (o.rarity === null) {
                select.appendChild(opt);
                continue;
            }
            if (group === null || groupRarity !== o.rarity) {
                group = document.createElement('optgroup');
                group.label = RARITY_LABELS[o.rarity].replace(/^./, (c) => c.toUpperCase());
                groupRarity = o.rarity;
                select.appendChild(group);
            }
            group.appendChild(opt);
        }
        if (current === null) select.value = '';
    };
    refresh();
    return { element: wrap, refresh };
}
