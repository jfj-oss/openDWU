// Mothballing add-on (scenarios/mothballing; not in the original): the selection panel's Mothball / Reactivate action
// button for an own fleet or a lone warship, in a free slot of the eight like Intercept (orderMenu.ts
// setSelectionFreeSlots; the More menu when none is free). Left-click "Mothball" sends the force to the best port
// (interior ports first, sim mothballPortChoices); right-click lists every own space port (distance, ETA, ships in
// reserve / capacity; full ones greyed with the reason) to choose. In reserve the button is "Reactivate (N d)", on the
// way "Cancel reserve order". Read-only queries; the orders are the journaled player commands 'mothball' / 'reactivate'.
// Nothing shows when the add-on is off. The icon is drawn here (SVG), no art files.

import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import type { BuiltObject } from '../sim/builtObject';
import { ShipGroup } from '../sim/fleets/shipGroup';
import { BuiltObjectRole } from '../sim/data/designSpecifications';
import { issuePlayerCommand } from '../sim/player/playerCommands';
import {
    MOTHBALL_RESERVE, MOTHBALL_TRAVEL, forceMothballPhase, mothballPortChoices, mothballStatusText, mothballUnavailableReason, mothballingOn, reactivationDays,
    type MothballCommandResult, type MothballForce,
} from '../sim/scenario/mothballing/mothballing';
import { formatEtaDays } from './supplyChainText';
import { showToast } from './toast';
import { setToolStripActive, toolStripItem, toolStripMenu } from './originalWindow';

export const MOTHBALL_TITLE = 'Mothball: the force flies to a space port and goes into reserve — upkeep drops to a fraction, it cannot move or fight back, and no automation or Intercept / Defend order uses it until it is reactivated. Click to choose the port (best one first)';
export const REACTIVATE_TITLE = 'Reactivate: back to full readiness (as the same fleet) when the slowest ship is ready; full upkeep meanwhile, it stays at the port';

function svgIcon(body: string): string {
    return `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="#b8c4e0" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`)}`;
}
/** A ship under a dock roof (mothball) and the same with a rising arrow (reactivate). */
export const MOTHBALL_ICON = svgIcon('<path d="M4 13L16 5l12 8"/><path d="M8 21h16l-3 5H11z"/><path d="M16 21v-6"/>');
export const REACTIVATE_ICON = svgIcon('<path d="M8 21h16l-3 5H11z"/><path d="M16 18V6M11 11l5-5 5 5" stroke="#60d060"/>');

export interface MothballChoice {
    label: string;
    hint: string;
    chosen: boolean;
    disabled: boolean;
    pick: () => void;
}

/** What the action button shows; null = no button. */
export interface MothballSlotModel {
    label: string;
    icon: string;
    hint: string;
    disabled: boolean;
    click: () => void;
    /** Right-click list (empty: no list). */
    choices: MothballChoice[];
}

function done(r: unknown): void {
    showToast((r as MothballCommandResult).message);
}

function forceOf(empire: Empire, sel: { shipGroup?: ShipGroup; builtObject?: BuiltObject; builtObjects?: BuiltObject[] } | null): MothballForce | null {
    if (sel === null || (sel.builtObjects !== undefined && sel.builtObjects.length > 0)) return null;
    if (sel.shipGroup !== undefined) return sel.shipGroup.empire === empire ? sel.shipGroup : null;
    const b = sel.builtObject;
    return b !== undefined && b.empire === empire && b.role === BuiltObjectRole.Military && b.shipGroup === null ? b : null;
}

/** The Mothball / Reactivate button for `sel` (an own fleet, or an own warship outside a fleet); null otherwise. */
export function mothballSlot(galaxy: Galaxy, empire: Empire, sel: { shipGroup?: ShipGroup; builtObject?: BuiltObject; builtObjects?: BuiltObject[] } | null): MothballSlotModel | null {
    if (!mothballingOn(galaxy)) return null;
    const force = forceOf(empire, sel);
    if (force === null) return null;
    const phase = forceMothballPhase(force);
    const status = mothballStatusText(galaxy, force);
    if (phase === MOTHBALL_RESERVE) {
        const ships = force instanceof ShipGroup ? force.ships : [force];
        const days = Math.max(1, ...ships.map((b) => reactivationDays(galaxy, b)));
        return { label: `Reactivate (${days} d)`, icon: REACTIVATE_ICON, hint: `${REACTIVATE_TITLE}. ${status}: ready in ${days} days`, disabled: false, choices: [], click: () => issuePlayerCommand(galaxy, empire, 'reactivate', [force], done) };
    }
    if (phase === MOTHBALL_TRAVEL) return { label: 'Cancel reserve order', icon: MOTHBALL_ICON, hint: `${status}: click to call the trip off`, disabled: false, choices: [], click: () => issuePlayerCommand(galaxy, empire, 'reactivate', [force], done) };
    if (phase >= 0) return { label: status, icon: REACTIVATE_ICON, hint: `${REACTIVATE_TITLE} (${status})`, disabled: true, choices: [], click: () => {} };
    const why = mothballUnavailableReason(galaxy, empire, force);
    const list = mothballPortChoices(galaxy, empire, force);
    const best = list.length > 0 && list[0].full === null ? list[0] : null;
    const choices: MothballChoice[] = list.map((c) => ({
        label: `${c === best ? '★ ' : ''}${c.port.name} — ${Math.round(c.distance).toLocaleString('en-US')} (ETA ${formatEtaDays(c.etaMs)}), ${c.used} / ${c.capacity} in reserve${c.full !== null ? ' — full' : ''}`,
        hint: c.full !== null ? `${c.port.name} is ${c.full}` : `Mothball at ${c.port.name}${c === best ? ' (the best: interior, with room)' : ''}`,
        chosen: c === best,
        disabled: c.full !== null || why !== null,
        pick: () => issuePlayerCommand(galaxy, empire, 'mothball', [force, c.port], done),
    }));
    if (why !== null || best === null) return { label: 'Mothball', icon: MOTHBALL_ICON, hint: `${MOTHBALL_TITLE} (${why ?? 'no space port with room'})`, disabled: true, choices, click: () => {} };
    return {
        label: `Mothball at ${best.port.name}`,
        icon: MOTHBALL_ICON,
        hint: `Mothball at ${best.port.name} (ETA ${formatEtaDays(best.etaMs)}, ${best.used} / ${best.capacity} in reserve). ${MOTHBALL_TITLE}`,
        disabled: false,
        choices,
        click: () => issuePlayerCommand(galaxy, empire, 'mothball', [force, best.port], done),
    };
}

// ---------------------------------------------------------------------------------------------------------------
// Ships and Bases / Fleets screens: one Mothball / Reactivate button over the selected ships or fleets.
// ---------------------------------------------------------------------------------------------------------------

/** The forces of a selection of ships: a ship in a fleet stands for its whole fleet (fleets go into reserve whole). */
export function forcesOfShips(empire: Empire, ships: readonly BuiltObject[]): MothballForce[] {
    const out: MothballForce[] = [];
    for (const b of ships) {
        if (b.empire !== empire || b.role !== BuiltObjectRole.Military) continue;
        const f: MothballForce = b.shipGroup instanceof ShipGroup ? b.shipGroup : b;
        if (!out.includes(f)) out.push(f);
    }
    return out;
}

/**
 * The screens' button over `forces` (null: the add-on is off). One force: the selection panel's model. Several: all
 * in reserve → Reactivate them all; none mothballed → Mothball each at its best port (right-click: one port for all);
 * anything else greyed with the reason.
 */
export function mothballForcesModel(galaxy: Galaxy, empire: Empire, forces: readonly MothballForce[]): MothballSlotModel | null {
    if (!mothballingOn(galaxy)) return null;
    if (forces.length === 0) return { label: 'Mothball', icon: MOTHBALL_ICON, hint: `${MOTHBALL_TITLE} (select your warships or fleets)`, disabled: true, choices: [], click: () => {} };
    if (forces.length === 1) {
        const f = forces[0];
        return mothballSlot(galaxy, empire, f instanceof ShipGroup ? { shipGroup: f } : { builtObject: f });
    }
    const phases = forces.map((f) => forceMothballPhase(f));
    if (phases.every((p) => p === MOTHBALL_RESERVE)) {
        return { label: `Reactivate (${forces.length})`, icon: REACTIVATE_ICON, hint: `${REACTIVATE_TITLE}: all ${forces.length} selected`, disabled: false, choices: [], click: () => { for (const f of forces) issuePlayerCommand(galaxy, empire, 'reactivate', [f], done); } };
    }
    if (phases.some((p) => p >= 0)) return { label: 'Mothball', icon: MOTHBALL_ICON, hint: `${MOTHBALL_TITLE} (the selection mixes ships in reserve and in service)`, disabled: true, choices: [], click: () => {} };
    const why = forces.map((f) => mothballUnavailableReason(galaxy, empire, f)).find((w) => w !== null) ?? null;
    const first = mothballPortChoices(galaxy, empire, forces[0]);
    const choices: MothballChoice[] = first.map((c) => ({
        label: `${c.port.name}, ${c.used} / ${c.capacity} in reserve${c.full !== null ? ' — full' : ''}`,
        hint: c.full !== null ? `${c.port.name} is ${c.full}` : `Mothball all ${forces.length} at ${c.port.name} (as long as it has room)`,
        chosen: false,
        disabled: c.full !== null || why !== null,
        pick: () => { for (const f of forces) issuePlayerCommand(galaxy, empire, 'mothball', [f, c.port], done); },
    }));
    if (why !== null) return { label: 'Mothball', icon: MOTHBALL_ICON, hint: `${MOTHBALL_TITLE} (${why})`, disabled: true, choices, click: () => {} };
    return { label: `Mothball (${forces.length})`, icon: MOTHBALL_ICON, hint: `Mothball all ${forces.length} selected, each at its best port. ${MOTHBALL_TITLE}`, disabled: false, choices, click: () => { for (const f of forces) issuePlayerCommand(galaxy, empire, 'mothball', [f, null], done); } };
}

/** Opens the port list (an original-style ToolStrip menu) above `anchor`; a click elsewhere closes it. */
export function openMothballPortMenu(anchor: HTMLElement, choices: readonly MothballChoice[], after: () => void = () => {}): void {
    document.querySelectorAll('.mothball-port-menu').forEach((x) => x.remove());
    if (choices.length === 0) return;
    const menu = toolStripMenu('sel-more-menu mothball-port-menu');
    for (const c of choices) {
        const row = toolStripItem(c.label, { title: c.hint, tag: 'button', enabled: !c.disabled });
        row.classList.add('sel-extra-btn');
        if (c.chosen) row.classList.add('sel-more-on');
        row.addEventListener('mouseenter', () => setToolStripActive(menu, row));
        row.addEventListener('click', (e) => {
            e.stopPropagation();
            if (c.disabled) return;
            menu.remove();
            c.pick();
            after();
        });
        menu.appendChild(row);
    }
    const r = anchor.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.left = `${Math.round(r.left)}px`;
    menu.style.bottom = `${Math.round(window.innerHeight - r.top + 2)}px`;
    menu.style.zIndex = '10000';
    document.body.appendChild(menu);
    const close = (e: PointerEvent): void => {
        if (menu.contains(e.target as Node)) return;
        menu.remove();
        document.removeEventListener('pointerdown', close, true);
    };
    document.addEventListener('pointerdown', close, true);
}

/** Wires a screen button to a model getter: a click on Mothball opens the port list to choose from (best port first;
 *  user 2026-10-14: the screens must let you pick), Reactivate acts at once; right-click also opens the list. */
export function wireMothballButton(btn: HTMLButtonElement, model: () => MothballSlotModel | null, after: () => void): void {
    btn.addEventListener(
        'click',
        (e) => {
            const m = model();
            if (m === null || m.disabled || m.choices.length === 0 || !m.label.startsWith('Mothball')) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            openMothballPortMenu(btn, m.choices, after);
        },
        true,
    );
    btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const m = model();
        if (m !== null) openMothballPortMenu(btn, m.choices, after);
    });
}

/** A short label + minor text for a screen's row button ("Mothball" / "Sol Port", "Reactivate" / "240 d", …). */
export function compactMothballLabel(m: MothballSlotModel): { label: string; minor: string } {
    const mb = /^Mothball at (.+)$/.exec(m.label);
    if (mb !== null) return { label: 'Mothball', minor: mb[1] };
    const re = /^Reactivate \((.+)\)$/.exec(m.label);
    if (re !== null) return { label: 'Reactivate', minor: re[1] };
    if (m.label.startsWith('Cancel')) return { label: 'Cancel Reserve', minor: 'on the way' };
    const ra = /^Reactivating: (\d+) days$/.exec(m.label);
    if (ra !== null) return { label: 'Reactivating', minor: `${ra[1]} d` };
    const n = /^Mothball \((\d+)\)$/.exec(m.label);
    if (n !== null) return { label: 'Mothball', minor: `${n[1]} selected` };
    return { label: m.label, minor: '' };
}
