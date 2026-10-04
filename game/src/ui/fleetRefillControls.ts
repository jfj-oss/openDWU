// A fleet's template controls (sim/player/fleetRefill.ts; a gameplay addition inspired by Distant Worlds 2, not in the
// original): the fleet design combo, "Auto-refill from template" (per fleet, off by default), the yard the replacements
// are built at, the "Replenish" button (queue the missing ships once, now) and the status line ("2 replacements
// building at Sol Space Port"). Shown on the Fleets screen (fleetsList.ts); a self-contained row any fleet panel can
// mount (createFleetRefillControls). The status text is also the selection panel's "Template" row (selectionInfo.ts).
// Every change is a journaled player command (fleetTemplateAssign / AutoRefill / RefillYard / Replenish); the controls
// read the game (or the sim-worker replica) and never write it.

import './fleetRefillControls.css';
import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import type { ShipGroup } from '../sim/fleets/shipGroup';
import type { BuiltObject } from '../sim/builtObject';
import { issuePlayerCommand } from '../sim/player/playerCommands';
import { fleetDesignBook } from '../sim/player/fleetTemplates';
import { fleetRefillStatus, refillYards, type FleetRefillStatus, type ReplenishResult } from '../sim/player/fleetRefill';
import { formatMoney } from './hud';
import { confirmAutomationOff } from './orderMenu';
import { PendingValues } from './pendingCommands';
import { COLORS, FONT, checkBox, dropDown, el, glassButton, place, setText, text } from './originalWindow';

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** The status line for a fleet's template ("" when it has none). Pure. */
export function fleetRefillText(s: FleetRefillStatus | null): string {
    if (s === null) return '';
    if (s.template === null) return 'Fleet design deleted';
    const parts: string[] = [];
    if (s.building > 0) parts.push(`${plural(s.building, 'replacement')} building at ${s.buildingAt.join(', ')}`);
    if (s.missing > 0) {
        const auto = s.link.autoRefill;
        if (s.plan.designs.length <= 0) parts.push(`${s.missing} missing: no buildable design`);
        else if (auto && s.link.state === 'funds') parts.push(`${s.missing} missing, waiting for funds (${formatMoney(s.plan.cost)})`);
        else if (auto && s.link.state === 'noYard') parts.push(`${s.missing} missing: no ship yard could take them`);
        else parts.push(`${s.missing} missing`);
    }
    if (parts.length === 0) return `Complete (${s.present}/${s.wanted} ships)`;
    return parts.join(' · ');
}

/** The selection panel's one-line summary: design name, auto-refill, status. Pure. */
export function fleetTemplateSummary(s: FleetRefillStatus | null): string {
    if (s === null) return '';
    const name = s.template?.name ?? '(deleted)';
    return `${name}${s.link.autoRefill ? ' (auto-refill)' : ''} · ${fleetRefillText(s)}`;
}

/** Replenish: enabled, and the tooltip saying what it does or why it is greyed out. Pure. */
export function replenishButtonState(s: FleetRefillStatus | null, treasury: number): { enabled: boolean; title: string } {
    if (s === null) return { enabled: false, title: 'Assign a fleet design to the fleet first' };
    if (s.template === null) return { enabled: false, title: 'The fleet design was deleted' };
    if (s.missing <= 0) return { enabled: false, title: s.building > 0 ? 'Nothing is missing: the replacements are already under construction' : 'Nothing is missing: the fleet matches its design' };
    if (s.plan.designs.length <= 0) return { enabled: false, title: `No buildable design for ${s.plan.unbuildable.join(', ')}` };
    if (s.plan.cost > treasury) return { enabled: false, title: `Cannot afford the ${plural(s.missing, 'missing ship')}: ${formatMoney(s.plan.cost)} needed, ${formatMoney(treasury)} in the treasury` };
    const what = s.plan.designs.map((d, i) => `${s.plan.amounts[i]} × ${d.name}`).join(', ');
    return { enabled: true, title: `Queue the missing ships now (${what}) for ${formatMoney(s.plan.cost)}; they join the fleet when built` };
}

/** Offer to turn off Fleet Formation automation first (as Build Fleet / Set Fleet: the AI would manage the fleet). */
async function withFleetFormationPrompt(empire: Empire, issue: () => void): Promise<void> {
    if (empire.controlMilitaryFleets && (await confirmAutomationOff('Fleet Formation'))) issuePlayerCommand(empire.galaxy, empire, 'automationOff', ['Fleet Formation']);
    issue();
}

export interface FleetRefillControls {
    /** The row (place it in the panel: 950 × 56). */
    el: HTMLDivElement;
    /** Show `fleet` (null: disabled). */
    update: (fleet: ShipGroup | null) => void;
}

/**
 * The template row for `empire`'s fleets, `width` px wide: line 1 the controls, line 2 the status. `onChanged` runs
 * after a command's reply (the owner redraws).
 */
export function createFleetRefillControls(empire: Empire, width = 950, onChanged?: () => void): FleetRefillControls {
    const galaxy = empire.galaxy as Galaxy;
    const root = place(el('div', 'fr-row'), 0, 0, width, 56);
    let fleet: ShipGroup | null = null;
    let note = '';
    let noteUntil = 0;
    const pendingTemplate = new PendingValues<ShipGroup, number>();
    const pendingAuto = new PendingValues<ShipGroup, boolean>();
    const pendingYard = new PendingValues<ShipGroup, BuiltObject | null>();

    const after = (settle?: () => void) => (): void => {
        settle?.();
        update(fleet);
        onChanged?.();
    };

    root.appendChild(place(text('Fleet Design', { size: FONT.normal, bold: true, color: COLORS.label, shadow: false }), 0, 5));
    let templateSel = place(dropDown([], '', () => {}), 92, 2, 190, 24);
    root.appendChild(templateSel);
    const auto = checkBox('Auto-refill from template', false, (v) => {
        const f = fleet;
        if (f === null) return;
        const run = (): void => {
            const settle = pendingAuto.send(f, v);
            issuePlayerCommand(galaxy, empire, 'fleetTemplateAutoRefill', [f, v], after(settle));
        };
        if (v) void withFleetFormationPrompt(empire, run);
        else run();
    });
    auto.title = 'When ships of the fleet are lost, queue replacements automatically (when affordable) at the chosen yard; they join the fleet when built';
    root.appendChild(place(auto, 294, 5));
    const autoInput = auto.querySelector('input')!;
    root.appendChild(place(text('Build at', { size: FONT.normal, bold: true, color: COLORS.label, shadow: false }), 500, 5));
    let yardSel = place(dropDown([], '', () => {}), 560, 2, 230, 24);
    root.appendChild(yardSel);
    const replenish = glassButton('Replenish', {
        onClick: () => {
            const f = fleet;
            if (f === null) return;
            void withFleetFormationPrompt(empire, () =>
                issuePlayerCommand(galaxy, empire, 'fleetTemplateReplenish', [f], (r: ReplenishResult) => {
                    note = r.message;
                    noteUntil = Date.now() + 6000;
                    after()();
                }),
            );
        },
    });
    root.appendChild(place(replenish, width - 150, 0, 150, 28));
    const status = text('', { size: FONT.normal, color: COLORS.text, shadow: false, className: 'fr-status' });
    root.appendChild(place(status, 0, 34, width));

    let templateKey = '';
    let yardKey = '';
    function rebuildTemplates(): void {
        const opts = [{ value: '0', label: '(None)' }, ...fleetDesignBook(empire).templates.map((t) => ({ value: String(t.id), label: t.name }))];
        const key = JSON.stringify(opts);
        if (key === templateKey) return;
        templateKey = key;
        const s = place(dropDown(opts, '0', (v) => {
            const f = fleet;
            if (f === null) return;
            const id = Number(v);
            const settle = pendingTemplate.send(f, id);
            issuePlayerCommand(galaxy, empire, 'fleetTemplateAssign', [f, id], after(settle));
        }, 'The fleet design (template) this fleet is kept to'), 92, 2, 190, 24);
        templateSel.replaceWith(s);
        templateSel = s;
    }
    let yards: BuiltObject[] = [];
    function rebuildYards(): void {
        const list = refillYards(empire);
        const key = list.map((y) => `${y.builtObjectID}:${y.name}`).join('|');
        if (key === yardKey) return;
        yardKey = key;
        yards = list;
        const s = place(dropDown([{ value: '', label: '(Nearest yard to the fleet)' }, ...list.map((y) => ({ value: String(y.builtObjectID), label: y.name }))], '', (v) => {
            const f = fleet;
            if (f === null) return;
            const yard = v === '' ? null : (yards.find((y) => String(y.builtObjectID) === v) ?? null);
            const settle = pendingYard.send(f, yard);
            issuePlayerCommand(galaxy, empire, 'fleetTemplateRefillYard', [f, yard], after(settle));
        }, 'The ship yard replacements are queued at'), 560, 2, 230, 24);
        yardSel.replaceWith(s);
        yardSel = s;
    }

    function update(f: ShipGroup | null): void {
        fleet = f;
        rebuildTemplates();
        rebuildYards();
        const st = f !== null ? fleetRefillStatus(galaxy, empire, f) : null;
        const tid = f !== null ? pendingTemplate.value(f, st?.link.templateId ?? 0) : 0;
        if (document.activeElement !== templateSel) templateSel.value = String(tid);
        templateSel.disabled = f === null;
        const linked = f !== null && tid > 0;
        autoInput.checked = f !== null && linked && pendingAuto.value(f, st?.link.autoRefill ?? false);
        autoInput.disabled = !linked;
        const yard = f !== null ? pendingYard.value(f, st?.link.yard ?? null) : null;
        if (document.activeElement !== yardSel) yardSel.value = yard !== null && yards.includes(yard) ? String(yard.builtObjectID) : '';
        yardSel.disabled = !linked;
        const rb = replenishButtonState(linked ? st : null, empire.stateMoney);
        replenish.disabled = !rb.enabled;
        replenish.title = rb.title;
        let line = f === null ? '' : st === null ? 'No fleet design: pick one to keep this fleet to it' : fleetRefillText(st);
        if (st !== null && st.yardLost) line += ' · the chosen yard is lost: using the nearest';
        if (note !== '' && Date.now() < noteUntil) line = `${note} — ${line}`;
        setText(status, line);
        status.title = line;
    }

    update(null);
    return { el: root, update };
}
