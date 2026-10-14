// openDWU command (not in the original): the Intercept / Defend / Watch action button of the selection panel
// (sim/player/intercept.ts). It takes a free slot of the eight action buttons (orderMenu.ts setSelectionFreeSlots):
// for a foreign ship, fleet, base or creature "Intercept", for a star "Defend", for the player's own fleet the "Watch"
// toggle. Its hover message names the force ("Intercept: 1st Fleet (ETA 101 d)") or the reason it is disabled.
// Left-click sends the chosen force (the best by default); right-click lists the eligible forces in score order (pick
// one to make it the chosen force) and "Select <force>". The lists are read-only queries, redrawn with the buttons;
// the orders are the journaled player commands 'intercept' / 'defendSystem' / 'fleetWatch' with the chosen force (the
// UI never writes the game). The icons are drawn here (SVG), no art files.

import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import type { BuiltObject } from '../sim/builtObject';
import type { Creature } from '../sim/creature';
import type { Habitat } from '../sim/types';
import type { ShipGroup } from '../sim/fleets/shipGroup';
import { issuePlayerCommand } from '../sim/player/playerCommands';
import {
    defendCandidates, interceptCandidates, interceptForbiddenReason, interceptOrderOf, systemStarOf, watchStatusText, watchSystemFor, watchUnavailableReason,
    type InterceptCandidate, type InterceptCommandResult, type InterceptForce, type InterceptTarget,
} from '../sim/player/intercept';
import { YEAR_LENGTH } from '../sim/galaxyTime';
import { DAY_MS, formatEtaDays } from './supplyChainText';
import { showToast } from './toast';

export const INTERCEPT_TITLE = 'Send the best free fleet or warship to intercept and destroy this';
export const DEFEND_TITLE = 'Send the best free fleet or warship to this system to defend it';
export const WATCH_TITLE = 'Watch system: the fleet (automation off) stays in the system defending it, leaves only to refuel and comes back; a new order or automation on ends it';

export interface InterceptSelection {
    habitat: Habitat;
    builtObject?: BuiltObject;
    shipGroup?: ShipGroup;
    creature?: Creature;
    fighter?: unknown;
    builtObjects?: BuiltObject[];
}

export interface InterceptChoice {
    label: string;
    hint: string;
    chosen: boolean;
    pick: () => void;
}

/** Procedural slot icons (SVG data URLs, drawn in the chrome icons' grey-blue). */
function svgIcon(body: string): string {
    return `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="#b8c4e0" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`)}`;
}
export const INTERCEPT_ICON = svgIcon('<circle cx="16" cy="16" r="9"/><circle cx="16" cy="16" r="2.5" fill="#e04040" stroke="#e04040"/><path d="M16 3v6M16 23v6M3 16h6M23 16h6"/>');
export const DEFEND_ICON = svgIcon('<path d="M16 4l10 4v7c0 7-4.5 11-10 13C10.5 26 6 22 6 15V8z"/><path d="M11.5 16l3.2 3.2 6-6.4" stroke="#60d060"/>');
export const WATCH_ICON = svgIcon('<path d="M3 16c3.5-6 8-9 13-9s9.5 3 13 9c-3.5 6-8 9-13 9s-9.5-3-13-9z"/><circle cx="16" cy="16" r="4.5" fill="#b8c4e0"/>');

/** What the action button shows; null = no button. */
export interface InterceptStripModel {
    label: string;
    icon: string;
    /** The yellow hover message (the reason when disabled). */
    hint: string;
    disabled: boolean;
    /** A toggle that is on (Watch). */
    active: boolean;
    click: () => void;
    /** The ▾ list (empty: no ▾). */
    choices: InterceptChoice[];
    /** Select the chosen force (null: no select button). */
    select: (() => void) | null;
    selectHint: string;
}

/** The force the player picked per subject (target / star); dropped when it is no longer a candidate. */
const chosenFor = new WeakMap<object, InterceptForce>();

/** ETA as "14 d" ("< 1 d", "1.5 y"). */
export function shortEta(ms: number): string {
    if (!Number.isFinite(ms)) return '—';
    if (ms < DAY_MS) return '< 1 d';
    if (ms >= YEAR_LENGTH) return `${(ms / YEAR_LENGTH).toFixed(1)} y`;
    return `${Math.round(ms / DAY_MS)} d`;
}

function strengthText(c: InterceptCandidate): string {
    return `strength ${Math.round(c.strength).toLocaleString('en-US')}` + (Number.isFinite(c.ratio) ? ` (${c.ratio.toFixed(1)}× the target)` : '');
}

function send(galaxy: Galaxy, empire: Empire, op: 'intercept' | 'defendSystem', subject: InterceptTarget | Habitat, force: InterceptForce): void {
    const done = (r: unknown): void => showToast((r as InterceptCommandResult).message);
    if (op === 'intercept') issuePlayerCommand(galaxy, empire, 'intercept', [subject as InterceptTarget, force], done);
    else issuePlayerCommand(galaxy, empire, 'defendSystem', [subject as Habitat, force], done);
}

function disabledModel(verb: string, icon: string, hint: string): InterceptStripModel {
    return { label: verb, icon, hint, disabled: true, active: false, click: () => {}, choices: [], select: null, selectHint: '' };
}

function orderModel(
    galaxy: Galaxy, empire: Empire, verb: string, title: string, op: 'intercept' | 'defendSystem', subject: InterceptTarget | Habitat,
    list: InterceptCandidate[], select: (f: InterceptForce) => void, onChange: () => void,
): InterceptStripModel {
    let c = list[0];
    const want = chosenFor.get(subject);
    if (want !== undefined) {
        const found = list.find((x) => x.force === want);
        if (found !== undefined) c = found;
        else chosenFor.delete(subject);
    }
    const choices = list.map((x, i): InterceptChoice => ({
        label: `${i === 0 ? '★ ' : ''}${x.name} · ${shortEta(x.etaMs)}`,
        hint: `${verb} with ${x.name}: ${strengthText(x)}, ETA ${formatEtaDays(x.etaMs)}${i === 0 ? ' (best)' : ''}`,
        chosen: x === c,
        pick: () => {
            chosenFor.set(subject, x.force);
            onChange();
        },
    }));
    return {
        label: `${verb}: ${c.name} · ${shortEta(c.etaMs)}`,
        icon: op === 'intercept' ? INTERCEPT_ICON : DEFEND_ICON,
        hint: `${verb}: ${c.name} (ETA ${shortEta(c.etaMs)}) — ${strengthText(c)}; right-click to choose another force`,
        disabled: false,
        active: false,
        click: () => send(galaxy, empire, op, subject, c.force),
        choices,
        select: () => select(c.force),
        selectHint: `Select ${c.name}`,
    };
}

function watchModel(galaxy: Galaxy, empire: Empire, fleet: ShipGroup): InterceptStripModel {
    const on = fleet.watch !== undefined;
    const star = watchSystemFor(galaxy, fleet);
    const why = on ? null : watchUnavailableReason(galaxy, empire, fleet);
    const order = interceptOrderOf(empire, fleet);
    const status = on ? watchStatusText(fleet) : order !== null ? `Intercepting ${(order.target as { name?: string | null }).name ?? ''}` : '';
    return {
        label: on ? watchStatusText(fleet) : star !== null ? `Watch ${star.name}` : 'Watch system',
        icon: WATCH_ICON,
        hint: (on ? `${watchStatusText(fleet)}: click to stop watching` : star !== null ? `Watch ${star.name}` : 'Watch system') + (why !== null ? `: ${why}` : status !== '' ? ` (${status})` : ' — stays there defending it, refuels away and comes back'),
        disabled: why !== null,
        active: on,
        click: () => issuePlayerCommand(galaxy, empire, 'fleetWatch', [fleet, !on]),
        choices: [],
        select: null,
        selectHint: '',
    };
}

/**
 * The strip for the selection: Intercept (a foreign ship, fleet, base or creature), Defend (a star) or Watch (an own
 * fleet); null when nothing applies. `select` selects a force; `onChange` redraws after a ▾ pick.
 */
export function interceptStrip(galaxy: Galaxy, empire: Empire, sel: InterceptSelection | null, select: (f: InterceptForce) => void, onChange: () => void): InterceptStripModel | null {
    if (sel === null || sel.fighter !== undefined || (sel.builtObjects !== undefined && sel.builtObjects.length > 0)) return null;
    let target: InterceptTarget | null = null;
    if (sel.creature !== undefined) target = sel.creature;
    else if (sel.shipGroup !== undefined) {
        if (sel.shipGroup.empire === empire) return watchModel(galaxy, empire, sel.shipGroup);
        target = sel.shipGroup;
    } else if (sel.builtObject !== undefined) target = sel.builtObject.empire !== empire ? sel.builtObject : null;
    if (target !== null) {
        const why = interceptForbiddenReason(galaxy, empire, target);
        if (why !== null) return disabledModel('Intercept', INTERCEPT_ICON, `Intercept: ${why}`);
        const list = interceptCandidates(galaxy, empire, target);
        if (list.length === 0) return disabledModel('Intercept', INTERCEPT_ICON, 'Intercept: no free fleet or warship strong enough and in fuel range');
        return orderModel(galaxy, empire, 'Intercept', INTERCEPT_TITLE, 'intercept', target, list, select, onChange);
    }
    if (sel.builtObject === undefined && sel.shipGroup === undefined && sel.creature === undefined) {
        const star = systemStarOf(galaxy, sel.habitat);
        if (star === null || star !== sel.habitat) return null;
        const list = defendCandidates(galaxy, empire, star);
        if (list.length === 0) return disabledModel('Defend', DEFEND_ICON, 'Defend: no free fleet or warship available');
        return orderModel(galaxy, empire, 'Defend', DEFEND_TITLE, 'defendSystem', star, list, select, onChange);
    }
    return null;
}
