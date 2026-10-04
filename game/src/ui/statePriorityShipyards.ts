// [improvements] State ships first at shipyards — the UI half. The rules live in the sim (sim/construction/statePriority.ts);
// the Improvement switch (ui/improvements.ts 'statePriorityShipyards', default on) reaches the sim only as the journaled
// player command `setStatePriorityShipyards`, issued when the game view starts (new game or load) and whenever the
// switch is toggled. A game run without the game view (tests, harness, seed runs) never gets the command, so it plays
// exactly as the original.

import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import { issuePlayerCommand } from '../sim/player/playerCommands';
import { STATE_PRIORITY_IMPROVEMENT } from '../sim/construction/statePriority';
import { isImprovementEnabled, onImprovementsChange } from './improvements';

let uninstall: (() => void) | null = null;

/** Send the current switch to the sim now and on every toggle, until removeStatePrioritySync. */
export function installStatePrioritySync(galaxy: Galaxy, player: Empire): void {
    removeStatePrioritySync();
    issuePlayerCommand(galaxy, player, 'setStatePriorityShipyards', [isImprovementEnabled(STATE_PRIORITY_IMPROVEMENT)]);
    uninstall = onImprovementsChange((id, on) => {
        if (id === STATE_PRIORITY_IMPROVEMENT) issuePlayerCommand(galaxy, player, 'setStatePriorityShipyards', [on]);
    });
}

export function removeStatePrioritySync(): void {
    uninstall?.();
    uninstall = null;
}
