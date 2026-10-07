// A fleet's "Move together" check box and status line (sim/fleets/moveTogether.ts; openDWU rule, not in the original).
// Shown on the Fleets window and the Fleet Settings panel. The change is the journaled player command fleetMoveTogether;
// the control reads the game (or the sim-worker replica) and never writes it. The value last sent counts until its reply
// lands (pendingCommands.ts), so a quick second click takes effect.

import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import type { ShipGroup } from '../sim/fleets/shipGroup';
import { issuePlayerCommand } from '../sim/player/playerCommands';
import { moveTogetherStatus } from '../sim/fleets/moveTogether';
import { PendingValues } from './pendingCommands';
import { COLORS, FONT, checkBox, el, place, setText, text } from './originalWindow';

export const MOVE_TOGETHER_TITLE =
    'Move together (openDWU rule, not in the original): for your move, attack and patrol orders the fleet first gathers at its lead ship, ' +
    'then every ship flies at the slowest ship\'s speed and starts its hyperjump at the same moment. Badly damaged ships, ships low on fuel ' +
    'and ships still far away after a short wait follow on their own. Urgent orders (defending a colony under attack, intercepting, escaping) go at once.';

export interface FleetMoveTogetherControl {
    el: HTMLDivElement;
    update: (fleet: ShipGroup | null) => void;
}

/** The check box with the run's status to its right, `width` × 24 original pixels. */
export function createFleetMoveTogetherControl(empire: Empire, width: number, onChanged?: () => void, size: number = FONT.normal): FleetMoveTogetherControl {
    const galaxy = empire.galaxy as Galaxy;
    const pending = new PendingValues<ShipGroup, boolean>();
    let fleet: ShipGroup | null = null;
    const root = place(el('div', 'fmt-row'), 0, 0, width, 24);
    root.title = MOVE_TOGETHER_TITLE;
    const box = checkBox('Move together', false, (v) => {
        const f = fleet;
        if (f === null) return;
        const settle = pending.send(f, v);
        issuePlayerCommand(galaxy, empire, 'fleetMoveTogether', [f, v], () => {
            settle();
            update(fleet);
            onChanged?.();
        });
    }, size);
    root.appendChild(place(box, 0, 2));
    const input = box.querySelector('input')!;
    const status = text('', { size: FONT.small, color: COLORS.label, shadow: false });
    root.appendChild(place(status, 130, 5, width - 130));

    function update(f: ShipGroup | null): void {
        fleet = f;
        const s = moveTogetherStatus(f);
        input.disabled = f === null;
        input.checked = f !== null && pending.value(f, s.on);
        setText(status, input.checked ? (s.on ? s.text : 'Next order: gather, then travel as one') : '');
    }
    update(null);
    return { el: root, update };
}
