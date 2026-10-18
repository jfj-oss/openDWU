// The ship tick of the combat changes: one call from builtObjectTick's intermediate block (every 3 game seconds per ship) that runs the
// crew's damage control, the AI's facing steering, the surrender check and the re-application of a critical engine limit, each only
// with its own flag on. Also the frame-periodic pruning of the saved maps. Not a port.

import type { Galaxy } from '../../galaxy';
import type { BuiltObject } from '../../builtObject';
import { registerScenarioFramePeriodic } from '../hooks';
import { c2Prune, criticalsOn, damageControlOn, facingAiOn, peekC2State, surrenderOn } from './common';
import { critApplySpeed } from './criticals';
import { damageControlTick } from './damageControl';
import { facingTick } from './facing';
import { surrenderTick } from './surrender';

/** builtObjectTick, intermediate block: `dt` = seconds since this ship's last pass. */
export function c2ShipTick(galaxy: Galaxy, bo: BuiltObject, dt: number): void {
    if (bo.empire === null) return;
    if (criticalsOn(galaxy)) {
        const rec = peekC2State(galaxy)?.crits.get(bo);
        if (rec !== undefined) critApplySpeed(galaxy, bo, rec);
    }
    if (damageControlOn(galaxy)) damageControlTick(galaxy, bo, dt);
    if (facingAiOn(galaxy)) facingTick(galaxy, bo, dt);
    if (surrenderOn(galaxy)) surrenderTick(galaxy, bo);
}

// One registration per flag (a handler has one flag): any of the six being on prunes the maps of destroyed ships.
for (const flag of ['decoys', 'ambush', 'criticalHits', 'damageControl', 'armourFacing', 'surrender']) {
    registerScenarioFramePeriodic({
        id: `combat2.prune.${flag}`,
        flag,
        periodDays: 30,
        run: (galaxy) => c2Prune(galaxy),
    });
}
