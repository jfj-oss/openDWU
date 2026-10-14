// openDWU command (not in the original): the selection panel's Intercept / Defend entries and a fleet's "Watch system"
// toggle (sim/player/intercept.ts). They sit in the HUD's "More" menu beside the action strip (our controls never take
// one of the eight original slots): the first entry names the force the order would go to ("Intercept: 3rd Fleet (ETA
// 14 days)"), the next ones are the other eligible forces in score order (pick one to send it instead), and "Select …"
// jumps to the chosen force. The lists are read-only queries, refreshed with the strip (every 500 ms); the orders are
// the journaled player commands 'intercept' / 'defendSystem' / 'fleetWatch' with the chosen force (the UI never writes
// the game).

import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import type { BuiltObject } from '../sim/builtObject';
import type { Creature } from '../sim/creature';
import type { Habitat } from '../sim/types';
import { ShipGroup } from '../sim/fleets/shipGroup';
import { issuePlayerCommand } from '../sim/player/playerCommands';
import {
    defendCandidates, interceptCandidates, interceptForbiddenReason, interceptOrderOf, systemStarOf, watchStatusText, watchSystemFor, watchUnavailableReason,
    type InterceptCandidate, type InterceptCommandResult, type InterceptForce, type InterceptTarget,
} from '../sim/player/intercept';
import type { SelectionExtraSlot } from './orderMenu';
import { formatEtaDays } from './supplyChainText';
import { showToast } from './toast';

/** Alternatives listed after the top candidate. */
const MAX_ALTERNATIVES = 4;

export const INTERCEPT_TITLE = 'Send the best free fleet or warship to intercept and destroy this';
export const DEFEND_TITLE = 'Send the best free fleet or warship to this system to defend it';

interface SelectionLike {
    habitat: Habitat;
    builtObject?: BuiltObject;
    shipGroup?: ShipGroup;
    creature?: Creature;
    fighter?: unknown;
    builtObjects?: BuiltObject[];
}

function strengthText(c: InterceptCandidate): string {
    return `strength ${Math.round(c.strength).toLocaleString('en-US')}` + (Number.isFinite(c.ratio) ? ` (${c.ratio.toFixed(1)}×)` : '');
}

function send(galaxy: Galaxy, empire: Empire, op: 'intercept' | 'defendSystem', subject: InterceptTarget | Habitat, force: InterceptForce): void {
    const done = (r: unknown): void => showToast((r as InterceptCommandResult).message);
    if (op === 'intercept') issuePlayerCommand(galaxy, empire, 'intercept', [subject as InterceptTarget, force], done);
    else issuePlayerCommand(galaxy, empire, 'defendSystem', [subject as Habitat, force], done);
}

function rows(galaxy: Galaxy, empire: Empire, verb: string, title: string, op: 'intercept' | 'defendSystem', subject: InterceptTarget | Habitat, list: InterceptCandidate[], select: (f: InterceptForce) => void): SelectionExtraSlot[] {
    const top = list[0];
    const out: SelectionExtraSlot[] = [
        {
            label: `${verb}: ${top.name} (ETA ${formatEtaDays(top.etaMs)})`,
            title: `${title}. ${top.name}: ${strengthText(top)}, ETA ${formatEtaDays(top.etaMs)}`,
            onClick: () => send(galaxy, empire, op, subject, top.force),
        },
    ];
    for (const c of list.slice(1, 1 + MAX_ALTERNATIVES)) {
        out.push({
            label: `  … or ${c.name} (ETA ${formatEtaDays(c.etaMs)})`,
            title: `${verb} with ${c.name} instead: ${strengthText(c)}, ETA ${formatEtaDays(c.etaMs)}`,
            onClick: () => send(galaxy, empire, op, subject, c.force),
        });
    }
    out.push({ label: `  Select ${top.name}`, title: `Select ${top.name} in the selection panel`, onClick: () => select(top.force) });
    return out;
}

/** The Intercept (a foreign ship, fleet, base or creature) or Defend (a star system) entries for the selection. */
export function interceptSlots(galaxy: Galaxy, empire: Empire, sel: SelectionLike | null, select: (f: InterceptForce) => void): SelectionExtraSlot[] {
    if (sel === null || sel.fighter !== undefined || (sel.builtObjects !== undefined && sel.builtObjects.length > 0)) return [];
    let target: InterceptTarget | null = null;
    if (sel.creature !== undefined) target = sel.creature;
    else if (sel.shipGroup !== undefined) target = sel.shipGroup.empire !== empire ? sel.shipGroup : null;
    else if (sel.builtObject !== undefined) target = sel.builtObject.empire !== empire ? sel.builtObject : null;
    if (target !== null) {
        const why = interceptForbiddenReason(galaxy, empire, target);
        if (why !== null) return [{ label: 'Intercept', title: `${INTERCEPT_TITLE} (${why})`, disabled: true, onClick: () => {} }];
        const list = interceptCandidates(galaxy, empire, target);
        if (list.length === 0) return [{ label: 'Intercept', title: `${INTERCEPT_TITLE} (no free fleet or warship strong enough and in fuel range)`, disabled: true, onClick: () => {} }];
        return rows(galaxy, empire, 'Intercept', INTERCEPT_TITLE, 'intercept', target, list, select);
    }
    if (sel.builtObject === undefined && sel.shipGroup === undefined && sel.creature === undefined) {
        const star = systemStarOf(galaxy, sel.habitat);
        if (star === null || star !== sel.habitat) return [];
        const list = defendCandidates(galaxy, empire, star);
        if (list.length === 0) return [{ label: 'Defend', title: `${DEFEND_TITLE} (no free fleet or warship available)`, disabled: true, onClick: () => {} }];
        return rows(galaxy, empire, 'Defend', DEFEND_TITLE, 'defendSystem', star, list, select);
    }
    return [];
}

/** The "Watch system" toggle of the player's own fleet. */
export function watchSlot(galaxy: Galaxy, empire: Empire, fleet: ShipGroup): SelectionExtraSlot {
    const on = fleet.watch !== undefined;
    const star = watchSystemFor(galaxy, fleet);
    const why = on ? null : watchUnavailableReason(galaxy, empire, fleet);
    const base = 'Watch system: the fleet (automation off) stays in the system defending it, leaves only to refuel and comes back; a new order or automation on ends it';
    const order = interceptOrderOf(empire, fleet);
    const status = on ? watchStatusText(fleet) : order !== null ? `Intercepting ${(order.target as { name?: string }).name ?? ''}` : '';
    return {
        label: on ? watchStatusText(fleet) : star !== null ? `Watch ${star.name}` : 'Watch system',
        title: base + (why !== null ? ` (${why})` : status !== '' ? ` (${status})` : ''),
        active: on,
        disabled: why !== null,
        onClick: () => issuePlayerCommand(galaxy, empire, 'fleetWatch', [fleet, !on]),
    };
}
