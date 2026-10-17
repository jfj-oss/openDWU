// Coordinated landings (scenarios/coordinated-landings, flag coordinatedLandings): an opt-in gameplay change. Not a port.
//
// The original lands each troop transport on its own as soon as it is in range of the planet (missions/cmdAttack.ts, the
// Attack command's landing branch), so a fleet's transports trickle onto the planet one by one and the defenders beat them
// piecemeal. With the flag on, a transport in landing range of an enemy planet first asks coordinatedLandingHolds():
//   - the group = every live troop transport of the same empire that is attacking the same planet (its Attack order, or
//     colonyToAttack) and is
//     not on a refuel / repair / retire / retrofit / escape mission (so destroyed, retreating and re-tasked ships drop out);
//   - the transport holds (troops stay aboard, it keeps closing on the planet at orbital speed) until every ship of the
//     group is holding, or clTimeoutDays game days (default 25) after the first one began holding;
//   - then the whole group is released: each holding ship lands on its next landing check (within two game days), the last
//     arrival at once.
// Pirate raids (the Raid command, which does not take this branch), pirate empires and PirateRaider troops are never held.
// Applies to AI empires and the player alike. Rnd: none. With the flag off nothing here runs (cmdAttack.ts checks
// galaxy.scenario first). State: the ship fields below, absent unless in use (saved with the ship).

import type { Galaxy } from '../../galaxy';
import type { BuiltObject } from '../../builtObject';
import type { Habitat } from '../../types';
import type { Empire } from '../../empire';
import { TroopType } from '../../cargo';
import { BuiltObjectMissionType, builtObjectMission } from '../../missions/mission';
import { scenarioFlag, scenarioParam } from '../state';
import { GAME_DAY_LENGTH } from '../hooks';
import { galaxyStarDate } from '../../tick/simTime';

export const COORDINATED_LANDINGS_FLAG = 'coordinatedLandings';
export const COORDINATED_LANDINGS_ADDON_ID = 'coordinated-landings';
export const CL_DEFAULT_TIMEOUT_DAYS = 25;
/** How long a released ship stays released (game days): it lands at its next landing check. */
const RELEASE_DAYS = 2;

declare module '../../builtObject' {
    interface BuiltObject {
        /** Coordinated landings: the planet this transport is holding over; absent = not holding. */
        clTarget?: Habitat;
        /** Coordinated landings: star date it began holding. */
        clSince?: number;
        /** Coordinated landings: star date until which it may land (the group was released). */
        clGoUntil?: number;
    }
}

export function coordinatedLandingsOn(galaxy: Galaxy): boolean {
    return scenarioFlag(galaxy, COORDINATED_LANDINGS_FLAG);
}

function isPirateEmpire(galaxy: Galaxy, e: Empire | null): boolean {
    return e !== null && (e.pirateEmpireBaseHabitat !== null || galaxy.pirateEmpires.includes(e));
}

function carriesPirateTroops(bo: BuiltObject): boolean {
    if (bo.troops === null) return false;
    for (const t of bo.troops.items) if (t != null && t.type === TroopType.PirateRaider) return true;
    return false;
}

function hasTroops(bo: BuiltObject): boolean {
    return bo.troops !== null && bo.troops.count > 0;
}

function dropOut(bo: BuiltObject): void {
    delete bo.clTarget;
    delete bo.clSince;
    delete bo.clGoUntil;
}

function inGroup(bo: BuiltObject, colony: Habitat): boolean {
    if (bo.hasBeenDestroyed || !hasTroops(bo) || carriesPirateTroops(bo)) return false;
    const m = builtObjectMission(bo.mission);
    let bound = bo.colonyToAttack === colony;
    if (m !== null) {
        const t = m.type;
        if (t === BuiltObjectMissionType.Refuel || t === BuiltObjectMissionType.Retire || t === BuiltObjectMissionType.Retrofit || t === BuiltObjectMissionType.Repair || t === BuiltObjectMissionType.Escape || t === BuiltObjectMissionType.Raid) return false;
        // Still on its way: the colony is the target of its attack order (colonyToAttack is only set near the end).
        if ((t === BuiltObjectMissionType.Attack || t === BuiltObjectMissionType.WaitAndAttack) && (m.targetHabitat === colony || m.secondaryTargetHabitat === colony)) bound = true;
    }
    return bound;
}

/**
 * Whether `s` is holding over `colony` right now: its hold began no longer ago than a hold can last (the timeout plus the two days a
 * released ship has to land). Older fields are left on a ship that was re-tasked while holding; they are not a hold.
 */
function holdingAt(s: BuiltObject, colony: Habitat, now: number, timeout: number): boolean {
    return s.clTarget === colony && s.clSince !== undefined && now - s.clSince <= timeout + (RELEASE_DAYS + 1) * GAME_DAY_LENGTH;
}

/**
 * True = this transport (in landing range of `colony`, troops aboard) must hold in orbit instead of landing now.
 * False = it lands (flag off, pirates, nobody to wait for, everyone arrived, timed out, or the group was released).
 */
export function coordinatedLandingHolds(galaxy: Galaxy, bo: BuiltObject, colony: Habitat): boolean {
    if (!coordinatedLandingsOn(galaxy)) return false;
    const empire = bo.empire;
    if (empire === null || isPirateEmpire(galaxy, empire) || !hasTroops(bo) || carriesPirateTroops(bo)) return false;
    const now = galaxyStarDate(galaxy);
    const timeout = scenarioParam(galaxy, 'clTimeoutDays', CL_DEFAULT_TIMEOUT_DAYS) * GAME_DAY_LENGTH;
    if (bo.clTarget === colony && bo.clGoUntil !== undefined && now <= bo.clGoUntil) {
        dropOut(bo);
        return false;
    }
    if (!holdingAt(bo, colony, now, timeout)) {
        dropOut(bo);
        bo.clTarget = colony;
        bo.clSince = now;
    }
    // The group: every ship of the empire still attacking this planet with troops aboard.
    const group: BuiltObject[] = [];
    for (const list of [empire.builtObjects, empire.privateBuiltObjects]) {
        for (const s of list) {
            if (s == null || s === bo || !inGroup(s, colony)) continue;
            group.push(s);
        }
    }
    let allHere = true;
    let first = bo.clSince ?? now;
    for (const s of group) {
        if (holdingAt(s, colony, now, timeout)) first = Math.min(first, s.clSince!);
        else allHere = false;
    }
    if (!allHere && now - first < timeout) return true;
    // Release the whole group: the holders land at their next check, this ship now.
    const until = now + RELEASE_DAYS * GAME_DAY_LENGTH;
    for (const s of group) if (holdingAt(s, colony, now, timeout)) s.clGoUntil = until;
    dropOut(bo);
    return false;
}

/** The transport landed or was re-tasked: forget any hold. */
export function coordinatedLandingDone(bo: BuiltObject): void {
    if (bo.clTarget !== undefined) dropOut(bo);
}
