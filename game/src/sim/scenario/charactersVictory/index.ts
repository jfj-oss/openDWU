// Characters & Victory add-on (docs/CHARACTERS_AND_VICTORY.md): the public hooks for other packages (§10) — the
// Galactic Council (Part 2) sends delegates by VIP shuttle, picks each member's most important governor and keeps
// their post while they are away.
import type { Galaxy } from '../../galaxy';
import type { Habitat } from '../../types';
import type { BuiltObject } from '../../builtObject';
import type { Character } from '../../characters';
import { startVipTrip } from './vip';

export { characterImportance, routeDanger, isVipShuttle, vipMarkers, vipTripView, tripOfCharacter, tripOfShuttle } from './vip';
export { mostImportantGovernor, setGovernorDuty, endGovernorDuty, colonyVacancy, fitAt, governorCap, empireGovernors } from './governorsCv';
export { colonyGovernor as governorOf } from '../governors';
export { CV_FLAG, CV_VIP_FLAG, CV_GOV_FLAG, CV_ESCORT_FLAG, CV_DECOY_FLAG, cvOn, peekCvState } from './common';

/**
 * Sends `character` to `destination` by VIP shuttle with tag `reason`. Arrival emits `vipTripArrived` (and a loss
 * `vipTripFailed`) with that reason. Uses the stock transfer (Character.cs 4418), so the trip is a normal one in every
 * stock view. Returns false when the add-on's shuttles are off (the stock timer then runs).
 */
export function sendVip(galaxy: Galaxy, character: Character, destination: BuiltObject | Habitat, reason: string): boolean {
    character.transferToNewLocation(destination, galaxy);
    const t = startVipTrip(galaxy, character, destination, reason);
    return t !== null;
}
