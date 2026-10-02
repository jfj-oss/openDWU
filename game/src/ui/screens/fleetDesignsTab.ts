// "Fleet Designs" tab of the Fleets window (fleetsList.ts): player fleet templates (sim/player/fleetTemplates.ts — a
// documented deviation, the original has no fleet templates). Create / rename / delete templates, rows of (design,
// count) with +/-, total cost and strength, then Form from existing (unassigned finished ships, nearest the rally first)
// or Build fleet (queues the ships at the player's yards, optionally in one sector; completed ships join the fleet).
// Running build orders show their progress and can be cancelled. Every change is a player command.

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

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
}

function button(parent: HTMLElement, text: string, title: string, onClick: () => void, enabled = true): HTMLButtonElement {
    const b = el('button', 'fleets-detail-button', text);
    b.type = 'button';
    b.title = title;
    b.disabled = !enabled;
    b.addEventListener('click', onClick);
    parent.appendChild(b);
    return b;
}

export interface FleetDesignsTab {
    render: () => void;
    /** Redraw only the running-orders block (called on a timer while the tab is shown). */
    refreshOrders: () => void;
}

export function createFleetDesignsTab(container: HTMLElement, empire: Empire): FleetDesignsTab {
    const galaxy = empire.galaxy;
    let selectedId: number | null = null;
    let rallyIndex = -1; // -1: capital
    let sectorKey = ''; // '': any sector
    let allowSubstitutes = true;
    let mode: FleetBuildMode = 'missing';
    let report = '';
    const ordersBox = el('div', 'fleet-designs-orders');

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

    function renderOrders(): void {
        ordersBox.replaceChildren();
        const orders = fleetDesignBook(empire).orders;
        ordersBox.appendChild(el('div', 'fleets-detail-label', `Build orders (${orders.length})`));
        if (orders.length === 0) {
            ordersBox.appendChild(el('div', 'fleets-list-empty', 'No fleet is being built'));
            return;
        }
        for (const o of orders) {
            const p = fleetBuildProgress(empire, o);
            const line = el('div', 'fleets-detail-line fleet-designs-order');
            const where = o.sector === null ? 'any sector' : `sector ${sectorLabel(o.sector)}`;
            line.appendChild(el('span', 'fleets-detail-value', `${o.name}`));
            const bar = el('span', 'fleet-designs-progress');
            const fill = el('span', 'fleet-designs-progress-fill');
            fill.style.width = `${p.total > 0 ? Math.round((100 * p.built) / p.total) : 0}%`;
            bar.appendChild(fill);
            line.appendChild(bar);
            line.appendChild(el('span', 'fleets-detail-text', `${p.built}/${p.total} built · ${p.building} under construction${p.lost > 0 ? ` · ${p.lost} lost` : ''} · ${where}${o.fleet !== null ? ` · ${o.fleet.name ?? ''}` : ''}`));
            button(line, 'Cancel', 'Stop the order: ships still waiting for a yard are removed and refunded; ships on a slipway finish unassigned', () =>
                issue('fleetTemplateCancelOrder', [o.id], (r) => {
                    const c = r as { removed: number; refund: number };
                    report = `Order cancelled: ${c.removed} queued ships removed, ${formatMoney(c.refund)} refunded`;
                }));
            ordersBox.appendChild(line);
        }
    }

    function renderTemplate(t: FleetTemplate, parent: HTMLElement): void {
        // Name.
        const nameLine = el('div', 'fleets-detail-line');
        nameLine.appendChild(el('span', 'fleets-detail-label', 'Name'));
        const nameInput = el('input', 'fleets-detail-name');
        nameInput.type = 'text';
        nameInput.value = t.name;
        nameInput.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') nameInput.blur();
        });
        nameInput.addEventListener('change', () => {
            if (nameInput.value.trim() !== '' && nameInput.value !== t.name) issue('fleetTemplateRename', [t.id, nameInput.value]);
        });
        nameLine.appendChild(nameInput);
        button(nameLine, 'Delete', 'Delete this fleet design (running build orders continue)', () => {
            selectedId = null;
            issue('fleetTemplateDelete', [t.id]);
        });
        parent.appendChild(nameLine);

        // Rows.
        const r = rally();
        const pick = pickFleetShips(galaxy, empire, t, r, allowSubstitutes);
        const table = el('div', 'fleet-designs-rows');
        const head = el('div', 'fleet-designs-row fleet-designs-head');
        for (const h of ['Type', 'Design', 'Count', 'Unit cost', 'Power', 'Available']) head.appendChild(el('span', 'fleets-list-header-cell', h));
        table.appendChild(head);
        if (t.entries.length === 0) table.appendChild(el('div', 'fleets-list-empty', 'Add designs below'));
        t.entries.forEach((e, i) => {
            const row = el('div', 'fleet-designs-row');
            row.appendChild(el('span', 'fleets-list-cell', resolveSubRoleDescription(e.design.subRole)));
            const gone = !empire.designs.includes(e.design);
            const dn = el('span', 'fleets-list-name', e.design.name + (gone ? ' (deleted)' : e.design.isObsolete ? ' (obsolete)' : ''));
            dn.title = dn.textContent ?? '';
            row.appendChild(dn);
            const cnt = el('span', 'fleet-designs-count');
            button(cnt, '−', 'One fewer (0 removes the row)', () => issue('fleetTemplateSetEntry', [t.id, e.design, e.count - 1]));
            cnt.appendChild(el('span', 'fleets-list-cell', String(e.count)));
            button(cnt, '+', 'One more', () => issue('fleetTemplateSetEntry', [t.id, e.design, e.count + 1]));
            row.appendChild(cnt);
            row.appendChild(el('span', 'fleets-list-cell fleets-list-number', formatMoney(e.design.calculateCurrentPurchasePrice(galaxy))));
            row.appendChild(el('span', 'fleets-list-cell fleets-list-number', String(e.design.firepowerRaw * e.count)));
            const rep = pick.entries[i];
            const avail = el('span', 'fleets-list-cell fleets-list-number', `${rep.wanted - rep.short}/${rep.wanted}`);
            avail.title = formReportLines([rep])[0];
            row.appendChild(avail);
            table.appendChild(row);
        });
        parent.appendChild(table);

        // Add a design.
        const addLine = el('div', 'fleets-detail-line');
        addLine.appendChild(el('span', 'fleets-detail-label', 'Add'));
        const sel = el('select', 'fleets-detail-select');
        const all: Design[] = [];
        for (const g of fleetTemplateDesignGroups(empire)) {
            const og = document.createElement('optgroup');
            og.label = g.label;
            for (const d of g.designs) {
                const o = document.createElement('option');
                o.value = String(all.length);
                o.textContent = d.name + (d.isObsolete ? ' (obsolete)' : '');
                all.push(d);
                og.appendChild(o);
            }
            sel.appendChild(og);
        }
        addLine.appendChild(sel);
        button(addLine, 'Add Design', 'Add one ship of the chosen design', () => {
            const d = all[Number(sel.value)];
            if (d === undefined) return;
            const cur = t.entries.find((x) => x.design === d)?.count ?? 0;
            issue('fleetTemplateSetEntry', [t.id, d, cur + 1]);
        }, all.length > 0);
        parent.appendChild(addLine);

        // Totals.
        const tot = fleetTemplateTotals(galaxy, t);
        const totLine = el('div', 'fleets-detail-line');
        totLine.appendChild(el('span', 'fleets-detail-text', `${tot.ships} ships · total cost ${formatMoney(tot.cost)} · power ${tot.strength} · ${pick.ships.length} available unassigned`));
        parent.appendChild(totLine);

        // Options: rally, sector, substitutes, build mode.
        const optLine = el('div', 'fleets-detail-line');
        optLine.appendChild(el('span', 'fleets-detail-label', 'Rally'));
        const rallySel = el('select', 'fleets-detail-select');
        const cap = document.createElement('option');
        cap.value = '-1';
        cap.textContent = `Capital${empire.capital !== null ? ` (${empire.capital.name})` : ''}`;
        rallySel.appendChild(cap);
        colonies().forEach((c, i) => {
            const o = document.createElement('option');
            o.value = String(i);
            o.textContent = c.name;
            rallySel.appendChild(o);
        });
        rallySel.value = String(rallyIndex);
        rallySel.addEventListener('change', () => {
            rallyIndex = Number(rallySel.value);
            render();
        });
        optLine.appendChild(rallySel);
        optLine.appendChild(el('span', 'fleets-detail-label', 'Build in'));
        const secSel = el('select', 'fleets-detail-select');
        const any = document.createElement('option');
        any.value = '';
        any.textContent = 'Any sector';
        secSel.appendChild(any);
        for (const s of shipyardSectors(galaxy, empire)) {
            const o = document.createElement('option');
            o.value = `${s.x},${s.y}`;
            o.textContent = `Sector ${sectorLabel(s)}`;
            secSel.appendChild(o);
        }
        secSel.value = sectorKey;
        secSel.addEventListener('change', () => (sectorKey = secSel.value));
        optLine.appendChild(secSel);
        const subs = el('input', '');
        subs.type = 'checkbox';
        subs.id = 'fleet-designs-subs';
        subs.checked = allowSubstitutes;
        subs.addEventListener('change', () => {
            allowSubstitutes = subs.checked;
            render();
        });
        const subsLabel = el('label', 'fleets-detail-text', 'Same-type substitutes');
        subsLabel.htmlFor = subs.id;
        subsLabel.title = 'When too few ships of a design are free, use other designs of the same type';
        optLine.append(subs, subsLabel);
        const modeSel = el('select', 'fleets-detail-select');
        for (const [v, text] of [['missing', 'Build missing ships'], ['all', 'Build all ships']] as const) {
            const o = document.createElement('option');
            o.value = v;
            o.textContent = text;
            modeSel.appendChild(o);
        }
        modeSel.value = mode;
        modeSel.addEventListener('change', () => (mode = modeSel.value as FleetBuildMode));
        optLine.appendChild(modeSel);
        parent.appendChild(optLine);

        // Actions.
        const actLine = el('div', 'fleets-detail-line');
        button(actLine, 'Form from Existing', 'Form a new fleet from finished ships not in any fleet (nearest the rally point first) and gather it there', () =>
            void withFleetFormationPrompt(empire, () =>
                issue('fleetTemplateForm', [t.id, rally(), allowSubstitutes], (res) => {
                    const f = res as FormFleetResult;
                    report = [f.message, ...formReportLines(f.entries)].join('\n');
                })), t.entries.length > 0);
        button(actLine, 'Build Fleet', 'Order the ships at your ship yards; each completed ship joins the forming fleet', () =>
            void withFleetFormationPrompt(empire, () =>
                issue('fleetTemplateBuild', [t.id, mode, sector(), rallyIndex < 0 && sectorKey !== '' ? null : rally(), allowSubstitutes], (res) => {
                    report = buildReportText(res as BuildFleetResult);
                })), t.entries.length > 0);
        parent.appendChild(actLine);
    }

    function render(): void {
        container.replaceChildren();
        const bk = fleetDesignBook(empire);
        if (selectedId !== null && !bk.templates.some((t) => t.id === selectedId)) selectedId = null;
        if (selectedId === null && bk.templates.length > 0) selectedId = bk.templates[0].id;

        const layout = el('div', 'fleet-designs');
        const list = el('div', 'fleet-designs-list');
        for (const t of bk.templates) {
            const tot = fleetTemplateTotals(galaxy, t);
            const row = el('div', 'fleets-list-row fleet-designs-template' + (t.id === selectedId ? ' fleets-list-row-selected' : ''));
            row.appendChild(el('span', 'fleets-list-name', t.name));
            row.appendChild(el('span', 'fleets-list-cell fleets-list-number', `${tot.ships} ships`));
            row.addEventListener('click', () => {
                selectedId = t.id;
                report = '';
                render();
            });
            list.appendChild(row);
        }
        if (bk.templates.length === 0) list.appendChild(el('div', 'fleets-list-empty', 'No fleet designs yet'));
        button(list, 'New Fleet Design', 'Create an empty fleet design', () =>
            issue('fleetTemplateCreate', [''], (id) => {
                selectedId = id as number;
            }));
        layout.appendChild(list);

        const right = el('div', 'fleet-designs-detail');
        const t = bk.templates.find((x) => x.id === selectedId) ?? null;
        if (t !== null) renderTemplate(t, right);
        else right.appendChild(el('div', 'fleets-list-empty', 'Create a fleet design: pick ship designs and counts, then form it from idle ships or build it'));
        if (report !== '') right.appendChild(el('pre', 'fleet-designs-report', report));
        layout.appendChild(right);
        container.appendChild(layout);
        renderOrders();
        container.appendChild(ordersBox);
    }

    return { render, refreshOrders: renderOrders };
}
