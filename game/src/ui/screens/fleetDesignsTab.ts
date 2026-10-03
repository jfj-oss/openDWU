// "Fleet Designs" tab of the Fleets window (fleetsList.ts): player fleet templates (sim/player/fleetTemplates.ts — a
// documented deviation, the original has no fleet templates). Create / rename / delete templates, rows of (design,
// count) with +/-, total cost and strength, then Form from existing (unassigned finished ships, nearest the rally first)
// or Build fleet (queues the ships at the player's yards, optionally in one sector; completed ships join the fleet).
// Running build orders show their progress and can be cancelled. Every change is a player command.
// Drawn with the original-style window widgets (originalWindow.ts) in body-relative pixels like the Fleets page:
// the templates grid on the left, the selected template on the right, the running build orders along the bottom.

import type { Empire } from '../../sim/empire';
import type { Design } from '../../sim/design';
import type { Habitat } from '../../sim/types';
import { BuiltObjectRole } from '../../sim/data/designSpecifications';
import { resolveSubRoleDescription } from '../../sim/designGeneration';
import { issuePlayerCommand } from '../../sim/player/playerCommands';
import type { PlayerOpArgs, PlayerOpName } from '../../sim/player/playerOps';
import {
    fleetBuildProgress,
    fleetDesignBook,
    fleetTemplateTotals,
    pickFleetShips,
    sectorLabel,
    shipyardSectors,
    type BuildFleetResult,
    type FleetBuildMode,
    type FleetTemplate,
    type FormEntryReport,
    type FormFleetResult,
    type SectorRef,
} from '../../sim/player/fleetTemplates';
import { formatMoney } from '../hud';
import { confirmAutomationOff } from '../orderMenu';
import {
    COLORS,
    FONT,
    OwGrid,
    checkBox,
    darkRect,
    dropText,
    el,
    glassButton,
    place,
    scrollPanel,
    text,
    textBox,
} from '../originalWindow';

/** As the Ships and Bases Set Fleet: ask first to turn off Fleet Formation automation (the AI would otherwise disband
 * idle player fleets, Empire.cs MaintainShipGroups). */
async function withFleetFormationPrompt(empire: Empire, issue: () => void): Promise<void> {
    if (empire.controlMilitaryFleets && (await confirmAutomationOff('Fleet Formation'))) {
        issuePlayerCommand(empire.galaxy, empire, 'automationOff', ['Fleet Formation']);
    }
    issue();
}

/** The warship designs a template row can use, grouped by subrole (Set Fleet only takes Military ships). */
export function fleetTemplateDesignGroups(empire: Empire): { label: string; designs: Design[] }[] {
    const designs = empire.designs
        .filter((d) => d != null && d.role === BuiltObjectRole.Military)
        .sort((a, b) => a.subRole - b.subRole || Number(a.isObsolete) - Number(b.isObsolete) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const groups: { label: string; designs: Design[] }[] = [];
    for (const d of designs) {
        const label = resolveSubRoleDescription(d.subRole);
        let g = groups[groups.length - 1];
        if (g === undefined || g.label !== label) {
            g = { label, designs: [] };
            groups.push(g);
        }
        g.designs.push(d);
    }
    return groups;
}

/** One line per template row of a form / build report: "3/4 Frigate X (1 as Frigate Y), 1 short". */
export function formReportLines(entries: readonly FormEntryReport[]): string[] {
    return entries.map((e) => {
        const got = e.wanted - e.short;
        const subs = e.substitutes.map((s) => `${s.count} as ${s.designName}`).join(', ');
        return `${got}/${e.wanted} ${e.design.name}` + (subs !== '' ? ` (${subs})` : '') + (e.short > 0 ? `, ${e.short} short` : '');
    });
}

export function buildReportText(r: BuildFleetResult): string {
    const lines = [r.message];
    if (r.queued.length > 0) lines.push('Queued: ' + r.queued.map((q) => `${q.count} × ${q.designName}`).join(', '));
    if (r.unbuildable.length > 0) lines.push('Cannot build: ' + r.unbuildable.join(', '));
    lines.push(...formReportLines(r.entries));
    return lines.join('\n');
}

export interface FleetDesignsTab {
    render: () => void;
    /** Redraw only the running-orders block (called on a timer while the tab is shown). */
    refreshOrders: () => void;
}

/** A glass button in the tab's flow (inline, in the window font). */
function button(label: string, title: string, onClick: () => void, enabled = true): HTMLButtonElement {
    return glassButton(label, { title, onClick, disabled: !enabled });
}

/** A combo box positioned in the tab (dropDown with option groups). */
function select(options: { value: string; label: string; group?: string }[], value: string, onChange: (v: string) => void): HTMLSelectElement {
    const s = el('select', 'ow-input ow-select');
    let og: HTMLOptGroupElement | null = null;
    for (const o of options) {
        if (o.group !== undefined && (og === null || og.label !== o.group)) {
            og = document.createElement('optgroup');
            og.label = o.group;
            s.appendChild(og);
        }
        const opt = el('option', '', o.label);
        opt.value = o.value;
        (o.group !== undefined && og !== null ? og : s).appendChild(opt);
    }
    s.value = value;
    s.addEventListener('change', () => onChange(s.value));
    s.addEventListener('keydown', (e) => e.stopPropagation());
    return s;
}

export function createFleetDesignsTab(container: HTMLElement, empire: Empire, size: { w: number; h: number } = { w: 972, h: 767 }): FleetDesignsTab {
    const galaxy = empire.galaxy;
    let selectedId: number | null = null;
    let rallyIndex = -1; // -1: capital
    let sectorKey = ''; // '': any sector
    let allowSubstitutes = true;
    let mode: FleetBuildMode = 'missing';
    let report = '';

    const W = size.w;
    const H = size.h;
    const ordersTop = H - 210;

    const issue = <K extends PlayerOpName>(op: K, args: PlayerOpArgs<K>, after?: (r: unknown) => void): void => {
        issuePlayerCommand(galaxy, empire, op, args, (r) => {
            after?.(r);
            render();
        });
    };

    function colonies(): Habitat[] {
        return [...empire.colonies].filter((c) => c != null).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    }
    function rally(): Habitat | null {
        return rallyIndex < 0 ? empire.capital : (colonies()[rallyIndex] ?? empire.capital);
    }
    function sector(): SectorRef | null {
        if (sectorKey === '') return null;
        const [x, y] = sectorKey.split(',').map(Number);
        return { x, y };
    }

    // The templates grid (left).
    const templateGrid = new OwGrid<FleetTemplate>({
        columns: [
            { id: 'name', header: 'Fleet Design', fill: 1, sort: (t) => t.name, render: (t, c) => { c.textContent = t.name; c.title = t.name; } },
            { id: 'ships', header: 'Ships', width: 60, align: 'center', sort: (t) => fleetTemplateTotals(galaxy, t).ships, render: (t, c) => { c.textContent = String(fleetTemplateTotals(galaxy, t).ships); } },
        ],
        key: (t) => t.id,
        empty: 'No fleet designs yet',
        onSelect: (t) => {
            if (selectedId === t.id) return;
            selectedId = t.id;
            report = '';
            render();
        },
    });

    // Running build orders (bottom).
    const ordersTitle = dropText(container, '', 10, ordersTop, { size: FONT.header, bold: true, color: COLORS.label });
    const ordersBox = place(scrollPanel('fl-orders'), 10, ordersTop + 26, W - 22, H - ordersTop - 36);
    container.appendChild(ordersBox);

    function renderOrders(): void {
        const keep = ordersBox.scrollTop;
        ordersBox.replaceChildren();
        const orders = fleetDesignBook(empire).orders;
        ordersTitle.textContent = `Build Orders (${orders.length})`;
        if (orders.length === 0) {
            ordersBox.appendChild(place(text('No fleet is being built', { size: FONT.normal, color: COLORS.label, shadow: false }), 8, 6));
            return;
        }
        orders.forEach((o, i) => {
            const p = fleetBuildProgress(empire, o);
            const row = place(el('div', `fl-order-row${i % 2 === 1 ? ' fl-alt' : ''}`), 0, i * 30, W - 36, 30);
            const where = o.sector === null ? 'any sector' : `sector ${sectorLabel(o.sector)}`;
            const name = text(o.name, { size: FONT.normal, bold: true, color: COLORS.text });
            row.appendChild(place(name, 8, 6, 200));
            name.classList.add('fl-ellipsis');
            // DataGridViewTextBoxDropShadowCell-like progress bar.
            const bar = place(el('div', 'fl-progress'), 215, 7, 200, 16);
            const fill = el('div', 'fl-progress-fill');
            fill.style.width = `${p.total > 0 ? Math.round((100 * p.built) / p.total) : 0}%`;
            bar.appendChild(fill);
            bar.appendChild(place(text(`${p.built}/${p.total}`, { size: FONT.small, color: '#fff' }), 0, 0, 200));
            row.appendChild(bar);
            const status = text(`${p.building} under construction${p.lost > 0 ? ` · ${p.lost} lost` : ''} · ${where}${o.fleet !== null ? ` · ${o.fleet.name ?? ''}` : ''}`, { size: FONT.normal, color: COLORS.label, shadow: false });
            status.classList.add('fl-ellipsis');
            row.appendChild(place(status, 425, 6, W - 36 - 425 - 110));
            row.appendChild(place(button('Cancel', 'Stop the order: ships still waiting for a yard are removed and refunded; ships on a slipway finish unassigned', () =>
                issue('fleetTemplateCancelOrder', [o.id], (r) => {
                    const c = r as { ok: boolean; removed: number; refund: number };
                    report = c.ok ? `Order cancelled: ${c.removed} queued ships removed, ${formatMoney(c.refund)} refunded` : 'The order could not be cancelled';
                })), W - 36 - 100, 2, 94, 26));
            ordersBox.appendChild(row);
        });
        ordersBox.scrollTop = keep;
    }

    // The selected template (right).
    const detailX = 290;
    const detailW = W - detailX - 12;
    const detailH = ordersTop - 37 - 12;
    const detail = place(darkRect(96), detailX, 37, detailW, detailH);
    detail.classList.add('fl-design-detail');

    function renderTemplate(t: FleetTemplate): void {
        const DW = detailW;
        // Name, Delete.
        dropText(detail, 'Name', 10, 13, { size: FONT.large, bold: true, color: 'rgb(120, 120, 120)', shadow: false });
        const nameInput = place(textBox(t.name, 'Fleet design name', () => {}), 70, 10, 300, 24);
        nameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') nameInput.blur();
        });
        nameInput.addEventListener('change', () => {
            if (nameInput.value.trim() !== '' && nameInput.value !== t.name) issue('fleetTemplateRename', [t.id, nameInput.value]);
        });
        detail.appendChild(nameInput);
        detail.appendChild(place(button('Delete', 'Delete this fleet design (running build orders continue)', () => {
            selectedId = null;
            issue('fleetTemplateDelete', [t.id]);
        }), DW - 110, 6, 100, 32));

        // Rows: Type, Design, Count (−/+), Unit cost, Power, Available.
        const r = rally();
        const pick = pickFleetShips(galaxy, empire, t, r, allowSubstitutes);
        type Row = { i: number };
        const rowsGrid = new OwGrid<Row>({
            columns: [
                { id: 'type', header: 'Type', width: 120, render: ({ i }, c) => { c.textContent = resolveSubRoleDescription(t.entries[i].design.subRole); } },
                {
                    id: 'design', header: 'Design', fill: 1, render: ({ i }, c) => {
                        const e = t.entries[i];
                        const gone = !empire.designs.includes(e.design);
                        c.textContent = e.design.name + (gone ? ' (deleted)' : e.design.isObsolete ? ' (obsolete)' : '');
                        c.title = c.textContent;
                    },
                },
                {
                    id: 'count', header: 'Count', width: 100, align: 'center', render: ({ i }, c) => {
                        const e = t.entries[i];
                        const minus = button('−', 'One fewer (0 removes the row)', () => issue('fleetTemplateSetEntry', [t.id, e.design, e.count - 1]));
                        const plus = button('+', 'One more', () => issue('fleetTemplateSetEntry', [t.id, e.design, e.count + 1]));
                        minus.classList.add('fl-step');
                        plus.classList.add('fl-step');
                        c.append(minus, el('span', 'fl-count', String(e.count)), plus);
                    },
                },
                { id: 'cost', header: 'Unit cost', width: 90, align: 'right', render: ({ i }, c) => { c.textContent = formatMoney(t.entries[i].design.calculateCurrentPurchasePrice(galaxy)); } },
                { id: 'power', header: 'Power', width: 70, align: 'right', render: ({ i }, c) => { c.textContent = String(t.entries[i].design.firepowerRaw * t.entries[i].count); } },
                {
                    id: 'avail', header: 'Available', width: 80, align: 'right', render: ({ i }, c) => {
                        const rep = pick.entries[i];
                        c.textContent = `${rep.wanted - rep.short}/${rep.wanted}`;
                        c.title = formReportLines([rep])[0];
                    },
                },
            ],
            key: (x) => x.i,
            rowHeight: 26,
            empty: 'Add designs below',
        });
        rowsGrid.setRows(t.entries.map((_, i) => ({ i })));
        detail.appendChild(place(rowsGrid.el, 10, 46, DW - 20, 170));

        // Add a design.
        dropText(detail, 'Add', 10, 231, { size: FONT.large, bold: true, color: 'rgb(120, 120, 120)', shadow: false });
        const all: Design[] = [];
        const options: { value: string; label: string; group?: string }[] = [];
        for (const g of fleetTemplateDesignGroups(empire)) {
            for (const d of g.designs) {
                options.push({ value: String(all.length), label: d.name + (d.isObsolete ? ' (obsolete)' : ''), group: g.label });
                all.push(d);
            }
        }
        const designSel = place(select(options, options[0]?.value ?? '', () => {}), 70, 228, 330, 24);
        detail.appendChild(designSel);
        detail.appendChild(place(button('Add Design', 'Add one ship of the chosen design', () => {
            const d = all[Number(designSel.value)];
            if (d === undefined) return;
            const cur = t.entries.find((x) => x.design === d)?.count ?? 0;
            issue('fleetTemplateSetEntry', [t.id, d, cur + 1]);
        }, all.length > 0), 410, 224, 140, 32));

        // Totals.
        const tot = fleetTemplateTotals(galaxy, t);
        dropText(detail, `${tot.ships} ships   ·   total cost ${formatMoney(tot.cost)}   ·   power ${tot.strength}   ·   ${pick.ships.length} available unassigned`, 10, 266, { size: FONT.normal, color: COLORS.text });

        // Options: rally, sector, substitutes, build mode.
        dropText(detail, 'Rally at', 10, 299, { size: FONT.normal, bold: true, color: COLORS.label, shadow: false });
        const rallyOptions = [{ value: '-1', label: `Capital${empire.capital !== null ? ` (${empire.capital.name})` : ''}` }, ...colonies().map((c, i) => ({ value: String(i), label: c.name }))];
        detail.appendChild(place(select(rallyOptions, String(rallyIndex), (v) => {
            rallyIndex = Number(v);
            render();
        }), 90, 296, 220, 24));
        dropText(detail, 'Build in', 330, 299, { size: FONT.normal, bold: true, color: COLORS.label, shadow: false });
        const sectorOptions = [{ value: '', label: 'Any sector' }, ...shipyardSectors(galaxy, empire).map((s) => ({ value: `${s.x},${s.y}`, label: `Sector ${sectorLabel(s)}` }))];
        detail.appendChild(place(select(sectorOptions, sectorKey, (v) => (sectorKey = v)), 400, 296, 150, 24));
        const subs = checkBox('Same-type substitutes', allowSubstitutes, (v) => {
            allowSubstitutes = v;
            render();
        });
        subs.title = 'When too few ships of a design are free, use other designs of the same type';
        detail.appendChild(place(subs, 10, 332));
        detail.appendChild(place(select([{ value: 'missing', label: 'Build missing ships' }, { value: 'all', label: 'Build all ships' }], mode, (v) => (mode = v as FleetBuildMode)), 400, 330, 150, 24));

        // Actions.
        detail.appendChild(place(button('Form from Existing', 'Form a new fleet from finished ships not in any fleet (nearest the rally point first) and gather it there', () =>
            void withFleetFormationPrompt(empire, () =>
                issue('fleetTemplateForm', [t.id, rally(), allowSubstitutes], (res) => {
                    const f = res as FormFleetResult;
                    report = [f.message, ...formReportLines(f.entries)].join('\n');
                })), t.entries.length > 0), 10, 366, 200, 40));
        detail.appendChild(place(button('Build Fleet', 'Order the ships at your ship yards; each completed ship joins the forming fleet', () =>
            void withFleetFormationPrompt(empire, () =>
                issue('fleetTemplateBuild', [t.id, mode, sector(), rallyIndex < 0 && sectorKey !== '' ? null : rally(), allowSubstitutes], (res) => {
                    report = buildReportText(res as BuildFleetResult);
                })), t.entries.length > 0), 220, 366, 200, 40));
    }

    function render(): void {
        container.querySelectorAll('.fl-designs-own').forEach((x) => x.remove());
        const bk = fleetDesignBook(empire);
        if (selectedId !== null && !bk.templates.some((t) => t.id === selectedId)) selectedId = null;
        if (selectedId === null && bk.templates.length > 0) selectedId = bk.templates[0].id;

        templateGrid.setRows(bk.templates);
        templateGrid.select(selectedId, false);
        if (templateGrid.el.parentElement === null) {
            templateGrid.el.classList.add('fl-designs-keep');
            container.appendChild(place(templateGrid.el, 10, 37, 270, ordersTop - 37 - 60));
        }
        const newBtn = place(button('New Fleet Design', 'Create an empty fleet design', () =>
            issue('fleetTemplateCreate', [''], (id) => {
                selectedId = id as number;
            })), 10, ordersTop - 50, 270, 38);
        newBtn.classList.add('fl-designs-own');
        container.appendChild(newBtn);

        detail.replaceChildren();
        if (detail.parentElement === null) container.appendChild(detail);
        const t = bk.templates.find((x) => x.id === selectedId) ?? null;
        if (t !== null) renderTemplate(t);
        else {
            detail.appendChild(place(text('Create a fleet design: pick ship designs and counts, then form it from idle ships or build it.', { size: FONT.large, color: COLORS.label, shadow: false, wrapWidth: detailW - 40 }), 20, 20));
        }
        if (report !== '') {
            const box = place(scrollPanel('fl-report-box'), 10, 416, detailW - 20, detailH - 426);
            box.appendChild(text(report, { size: FONT.normal, color: COLORS.text, shadow: false, wrapWidth: detailW - 44, className: 'fl-report-text' }));
            detail.appendChild(box);
        }
        renderOrders();
    }

    return { render, refreshOrders: renderOrders };
}
