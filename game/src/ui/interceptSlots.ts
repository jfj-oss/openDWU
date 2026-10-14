// openDWU command (not in the original): the model of the Intercept / Defend / Watch strip right above the selection
// frame (hud.ts; sim/player/intercept.ts). For a foreign ship, fleet, base or creature: "Intercept: 3rd Fleet · 14 d";
// for a star: "Defend: 2nd Fleet · 9 d"; for the player's own fleet: the "Watch Sol" toggle. The ▾ list holds the
// eligible forces in score order (picking one makes it the chosen force), the select button selects the chosen force.
// The lists are read-only queries, refreshed with the action strip (every 500 ms); the orders are the journaled player
// commands 'intercept' / 'defendSystem' / 'fleetWatch' with the chosen force (the UI never writes the game).

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

/** What the strip shows; null = hidden. */
export interface InterceptStripModel {
    label: string;
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

function disabledModel(verb: string, hint: string): InterceptStripModel {
    return { label: verb, hint, disabled: true, active: false, click: () => {}, choices: [], select: null, selectHint: '' };
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
        hint: `${title}: ${c.name}, ${strengthText(c)}, ETA ${formatEtaDays(c.etaMs)}`,
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
        hint: WATCH_TITLE + (why !== null ? ` (${why})` : status !== '' ? ` (${status})` : ''),
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
        if (why !== null) return disabledModel('Intercept', `${INTERCEPT_TITLE} (${why})`);
        const list = interceptCandidates(galaxy, empire, target);
        if (list.length === 0) return disabledModel('Intercept', `${INTERCEPT_TITLE} (no free fleet or warship strong enough and in fuel range)`);
        return orderModel(galaxy, empire, 'Intercept', INTERCEPT_TITLE, 'intercept', target, list, select, onChange);
    }
    if (sel.builtObject === undefined && sel.shipGroup === undefined && sel.creature === undefined) {
        const star = systemStarOf(galaxy, sel.habitat);
        if (star === null || star !== sel.habitat) return null;
        const list = defendCandidates(galaxy, empire, star);
        if (list.length === 0) return disabledModel('Defend', `${DEFEND_TITLE} (no free fleet or warship available)`);
        return orderModel(galaxy, empire, 'Defend', DEFEND_TITLE, 'defendSystem', star, list, select, onChange);
    }
    return null;
}
