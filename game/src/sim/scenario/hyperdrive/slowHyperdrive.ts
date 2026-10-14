// Slower hyperdrive spool (scenarios/slow-hyperdrive, flag slowHyperdrive; a gameplay change set on the new-game
// wizard's Other Empires page, on by default there). Not a port. The stock spool (BuiltObject.2.cs 3020 HyperTo:
// HyperjumpInitiate × 1000 ± 1000 ms, missions/cmdMovement.ts cmdHyperTo) is multiplied by hyperjumpSpoolFactor (3)
// for every ship, through the query hyperjumpSpoolFactor that cmdHyperTo, fleets/moveTogether.ts and
// player/intercept.ts ask. Defensive jump interdiction (scenario/interdiction) answers after this handler with its
// TOTAL factor for an interdicted ship (not stacked). No Rnd, no state.

import type { Galaxy } from '../../galaxy';
import { registerScenarioQuery } from '../hooks';
import { scenarioFlag, scenarioParam } from '../state';

export const SLOW_HYPERDRIVE_FLAG = 'slowHyperdrive';
export const SLOW_HYPERDRIVE_ADDON_ID = 'slow-hyperdrive';

/** Every ship's spool factor (1 with the flag off). */
export function slowSpoolFactor(galaxy: Galaxy): number {
    if (!scenarioFlag(galaxy, SLOW_HYPERDRIVE_FLAG)) return 1;
    return Math.max(1, scenarioParam(galaxy, 'hyperjumpSpoolFactor', 3));
}

registerScenarioQuery({
    id: 'slowHyperdrive.spool',
    order: 0,
    flag: SLOW_HYPERDRIVE_FLAG,
    query: 'hyperjumpSpoolFactor',
    run: (g, v) => v * slowSpoolFactor(g),
});
