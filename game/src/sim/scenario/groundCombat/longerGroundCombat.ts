// Longer ground battles (scenarios/longer-ground-combat, flag longerGroundCombat; a gameplay change set on the new-game
// wizard's Other Empires page, on by default there). Not a port. combat/invasion.ts resolveInvasionBattles runs the
// whole fight (both sides' losses, civilian losses, special forces attacks, raid progress) on timePassed /
// groundCombatDurationFactor, so a battle lasts that many times as long; the start / end checks are untouched and
// Orbital superiority's per-day attrition gets the real time. No Rnd, no state.

import type { Galaxy } from '../../galaxy';
import { scenarioFlag, scenarioParam } from '../state';

export const LONGER_GROUND_COMBAT_FLAG = 'longerGroundCombat';
export const LONGER_GROUND_COMBAT_ADDON_ID = 'longer-ground-combat';

/** The fight's time span for a real `timeSpanSeconds` (unchanged with the flag off). */
export function groundCombatTimeSpan(galaxy: Galaxy, timeSpanSeconds: number): number {
    if (!scenarioFlag(galaxy, LONGER_GROUND_COMBAT_FLAG)) return timeSpanSeconds;
    return timeSpanSeconds / Math.max(1, scenarioParam(galaxy, 'groundCombatDurationFactor', 2));
}
