// [dw2overlays] The inline options panels that open under an overlay row of the View popup (its "…" button): the
// Resources overlay's resource picker ("show me where Caslon is"). Part of the Improvements category
// (ui/improvements.ts). UI-only: it reads the player's known-resource index (render/resourceOverlayData.ts) and sets the
// overlay option; nothing reaches the game.

import type { Galaxy } from '../sim/galaxy';
import { fogOf } from '../render/fog';
import { RARITY_COLORS, knownResourceIndexFor, resourceGroups } from '../render/resourceOverlayData';
import { resourceIconPath } from './resourceIcons';
import { getSettings, updateSettings } from './settings';
import { overlayOptionsOf, setOverlay, setOverlayResourceFilter, type MapOverlayState } from './mapOverlays';
import { localViewerEmpire } from '../localViewer';

/** [improvements] supplyChain: the Supply Shortages row's options — "Show colony luxury shortages" (UI setting
 *  supplyShowColonyShortages, default on). Yards short of resources are always marked. */
export function supplyShortagesPanel(): OverlayOptionPanel {
    const wrap = document.createElement('div');
    wrap.className = 'hud-option-panel';
    wrap.dataset.panel = 'supplyShortages';
    const lbl = document.createElement('label');
    lbl.className = 'hud-option-panel-label';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = getSettings().supplyShowColonyShortages;
    box.addEventListener('change', () => updateSettings({ supplyShowColonyShortages: box.checked }));
    lbl.append(box, document.createTextNode(' Show colony luxury shortages'));
    wrap.appendChild(lbl);
    const note = document.createElement('div');
    note.className = 'hud-option-panel-note';
    note.textContent = 'Red diamond: yard stalled / nothing coming; amber: short. Small amber ring: colony losing development for lack of a luxury your empire holds but no freighter brings.';
    wrap.appendChild(note);
    return {
        element: wrap,
        refresh: () => {
            box.checked = getSettings().supplyShowColonyShortages;
        },
    };
}

export interface OverlayOptionPanel {
    element: HTMLElement;
    /** Re-read the counts (called when the panel opens). */
    refresh(): void;
}

/** The Resources overlay's picker (the row's "…"): the resources the player knows of, grouped by type (Mineral, Gas,
 * Luxury), each with its stock icon and a checkbox, and a box per group (Mineral etc.) plus All / None. The overlay
 * shows the picked resources only; with none picked it shows every known resource. Ticking a box turns the overlay on.
 * The picks are UI state (the overlay's options), never sim state. */
export function resourcePickerPanel(overlays: MapOverlayState, galaxy: Galaxy): OverlayOptionPanel {
    const wrap = document.createElement('div');
    wrap.className = 'hud-option-panel';
    const head = document.createElement('div');
    head.className = 'hud-option-picker-head';
    const summary = document.createElement('span');
    summary.className = 'hud-option-summary';
    const all = document.createElement('button');
    all.type = 'button';
    all.className = 'hud-option-button';
    all.textContent = 'All';
    all.title = 'Pick every known resource';
    const none = document.createElement('button');
    none.type = 'button';
    none.className = 'hud-option-button';
    none.textContent = 'None';
    none.title = 'Clear the picks: every known resource is shown';
    head.append(summary, all, none);
    wrap.appendChild(head);
    const list = document.createElement('div');
    list.className = 'hud-option-list';
    wrap.appendChild(list);
    const note = document.createElement('div');
    note.className = 'hud-option-panel-note';
    note.textContent = 'Pie = abundance; colour = rarity (grey common, gold rare, violet very rare)';
    wrap.appendChild(note);

    /** The item and group checkboxes of the last refresh, so a pick can update them without rebuilding the list. */
    let itemBoxes = new Map<number, HTMLInputElement>();
    let groupBoxes: { box: HTMLInputElement; ids: number[] }[] = [];
    let knownIds: number[] = [];

    const picks = (): readonly number[] => overlayOptionsOf(overlays).resourceFilter;
    const setPicks = (ids: readonly number[]): void => {
        setOverlayResourceFilter(overlays, ids);
        setOverlay(overlays, 'resources', true);
        sync();
    };
    /** The checkboxes and the summary from the current picks. */
    const sync = (): void => {
        const cur = new Set(picks());
        for (const [id, box] of itemBoxes) box.checked = cur.has(id);
        for (const g of groupBoxes) {
            const n = g.ids.filter((id) => cur.has(id)).length;
            g.box.checked = n === g.ids.length && n > 0;
            g.box.indeterminate = n > 0 && n < g.ids.length;
        }
        const n = picks().length;
        summary.textContent = n === 0 ? 'Showing all known resources' : `Showing ${n} of ${knownIds.length} picked`;
        all.disabled = knownIds.length === 0;
    };
    all.addEventListener('click', () => setPicks(knownIds));
    none.addEventListener('click', () => setPicks([]));

    const refresh = (): void => {
        const player = localViewerEmpire(galaxy);
        const index = knownResourceIndexFor(galaxy, player, fogOf(galaxy).reveal);
        const groups = resourceGroups(galaxy.resourceSystem.resources, index);
        list.replaceChildren();
        itemBoxes = new Map();
        groupBoxes = [];
        knownIds = groups.flatMap((g) => g.items.map((it) => it.resourceId));
        for (const g of groups) {
            const ids = g.items.map((it) => it.resourceId);
            const head = document.createElement('label');
            head.className = 'hud-option-group';
            const gbox = document.createElement('input');
            gbox.type = 'checkbox';
            gbox.title = `Pick every ${g.label.toLowerCase()} resource`;
            gbox.addEventListener('change', () => {
                const cur = new Set(picks());
                for (const id of ids) {
                    if (gbox.checked) cur.add(id);
                    else cur.delete(id);
                }
                setPicks([...cur]);
            });
            const name = document.createElement('span');
            name.textContent = `${g.label} (${g.items.length})`;
            head.append(gbox, name);
            list.appendChild(head);
            groupBoxes.push({ box: gbox, ids });
            for (const it of g.items) {
                const row = document.createElement('label');
                row.className = 'hud-option-item';
                const box = document.createElement('input');
                box.type = 'checkbox';
                box.addEventListener('change', () => {
                    const cur = new Set(picks());
                    if (box.checked) cur.add(it.resourceId);
                    else cur.delete(it.resourceId);
                    setPicks([...cur]);
                });
                const icon = document.createElement('img');
                icon.className = 'hud-option-icon';
                icon.src = resourceIconPath(it.pictureRef);
                icon.alt = '';
                const label = document.createElement('span');
                label.className = 'hud-option-item-name';
                label.textContent = it.name;
                label.style.color = `#${RARITY_COLORS[it.rarity].toString(16).padStart(6, '0')}`;
                const count = document.createElement('span');
                count.className = 'hud-option-item-count';
                count.textContent = `${it.systems} system${it.systems === 1 ? '' : 's'}`;
                row.append(box, icon, label, count);
                list.appendChild(row);
                itemBoxes.set(it.resourceId, box);
            }
        }
        sync();
    };
    refresh();
    return { element: wrap, refresh };
}
