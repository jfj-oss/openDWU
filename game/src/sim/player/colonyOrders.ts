// The Colonies window's orders (ui/screens/coloniesScreen.ts): rename, Set as Capital, the population policy drop-downs
// and "Apply this Policy to All Colonies", Scrap / Attack Facility, and Transfer (troop or character to a transport).
// Each is the ported click handler's sim effect; the UI issues them as journaled player commands (player/playerOps.ts,
// applied at the next frame boundary). The original's Colonies list holds only the player's own colonies
// (UnlxwvByxj.BindData(PlayerEmpire.Colonies)), so every order here rejects a colony the empire does not own.
// Headless: no DOM / Pixi.

import type { Empire } from '../empire';
import type { Galaxy } from '../galaxy';
import type { BuiltObject } from '../builtObject';
import type { Habitat } from '../types';
import { Troop } from '../cargo';
import { stellarObjectCharacters, type Character } from '../characters';
import { getNearbyBuiltObjects } from '../pirates/pirateAI';
import { ColonyPopulationPolicy } from '../data/policies';
import { RaceEventType } from '../eventTypes';
import { checkRemoveFacilityTracking, recalculateColonyDistancesFromCapital, reviewPlanetaryFacilities } from '../construction/facilities';
import { checkCanInitiateAttackAgainstPirateFacilities, checkFacilityOwner, initiateAttackAgainstPirateFacilities } from '../pirates/pirateEmpireAI';

function ownColony(empire: Empire, h: Habitat | null): h is Habitat {
    return h !== null && h.empire === empire && empire.colonies.includes(h);
}

/** Port of Main.Part11.cs 4760 txtColonyName_Leave: a non-blank name becomes Habitat.Name (ours stores it trimmed, as
 *  renameShip / empireRename do). Returns false when rejected or unchanged. */
export function renameColony(empire: Empire, h: Habitat, name: string): boolean {
    const n = name.trim();
    if (!ownColony(empire, h) || n === '' || n === h.name) return false;
    h.name = n;
    return true;
}

/** BaconMain.cs 122 baconValuesToCopyOnChangingCapital. */
const BACON_VALUES_TO_COPY_ON_CHANGING_CAPITAL = ['scientificData', 'capturedSpies', 'customBomberDesigns'];

/** Port of Main.Part5.cs 2215 btnColonyMakeCapital_Click: BaconMain.OnChangeCapital (move the capital-held Expanded
 *  values to the new capital), then `PlayerEmpire.Capital = colony; RecalculateColonyDistancesFromCapital()`. The
 *  original has no other rule, cost or message: the button is enabled for any colony in the list (disabled only for a
 *  pirate player's non-owned colony, Main.Part11.cs 3329). Re-selecting the current capital changes nothing. */
export function setColonyAsCapital(galaxy: Galaxy, empire: Empire, h: Habitat): boolean {
    if (!ownColony(empire, h) || h.hasBeenDestroyed) return false;
    // BaconMain.cs 2138 OnChangeCapital (the C# throws on a null capital; ours just skips the copy).
    const capital = empire.capital;
    if (capital !== null && capital.baconValues !== null) {
        if (h.baconValues === null) h.baconValues = new Map<string, unknown>();
        for (const [key, value] of [...capital.baconValues]) {
            if (BACON_VALUES_TO_COPY_ON_CHANGING_CAPITAL.includes(key) && !h.baconValues.has(key)) {
                h.baconValues.set(key, value);
                capital.baconValues.delete(key);
            }
        }
    }
    empire.capital = h;
    recalculateColonyDistancesFromCapital(galaxy, empire);
    return true;
}

function isPopulationPolicy(p: number): p is ColonyPopulationPolicy {
    return Number.isInteger(p) && p >= ColonyPopulationPolicy.Assimilate && p <= ColonyPopulationPolicy.Exterminate;
}

/** Main.Part11.cs 3247-3256: the drop-downs are disabled while an extermination race event runs at the colony. */
export function colonyPopulationPolicyLocked(h: Habitat): boolean {
    return h.raceEventType === RaceEventType.AntiXenoRiotsExterminate || h.raceEventType === RaceEventType.DeathCultExterminate;
}

/** Port of Main.Part11.cs 2629 cmbColonyPopulationPolicyRaceFamily_SelectedIndexChanged (`sameFamily`) and 2643
 *  ItjTatWsXr (cmbColonyPopulationPolicyAllOthers): the new policy, except Assimilate under XenophobiaNoAssimilate. */
export function setColonyPopulationPolicy(empire: Empire, h: Habitat, sameFamily: boolean, policy: number): boolean {
    if (!ownColony(empire, h) || !isPopulationPolicy(policy) || colonyPopulationPolicyLocked(h)) return false;
    if (policy === ColonyPopulationPolicy.Assimilate && h.raceEventType === RaceEventType.XenophobiaNoAssimilate) return false;
    if (sameFamily) {
        if (h.colonyPopulationPolicyRaceFamily === policy) return false;
        h.colonyPopulationPolicyRaceFamily = policy;
    } else {
        if (h.colonyPopulationPolicy === policy) return false;
        h.colonyPopulationPolicy = policy;
    }
    return true;
}

/** Port of Main.Part11.cs 2657 btnColonyPopulationApplyPolicyToAll_Click (after its Yes/No question): both drop-downs'
 *  policies onto every colony of the empire (no race event check, as in the original). Returns the colonies set. */
export function applyPopulationPolicyToAllColonies(empire: Empire, raceFamily: number, allOthers: number): number {
    if (!isPopulationPolicy(raceFamily) || !isPopulationPolicy(allOthers) || empire.colonies === null) return 0;
    let n = 0;
    for (const habitat of empire.colonies) {
        if (habitat == null) continue;
        habitat.colonyPopulationPolicyRaceFamily = raceFamily;
        habitat.colonyPopulationPolicy = allOthers;
        n++;
    }
    return n;
}

/** Habitat.cs 6580 CheckFacilityOwnedByColonyOwner. */
export function checkFacilityOwnedByColonyOwner(galaxy: Galaxy, h: Habitat, index: number): boolean {
    const f = h.facilities?.[index] ?? null;
    return f !== null && checkFacilityOwner(galaxy, h, f) === h.owner;
}

export type ScrapFacilityResult = 'scrapped' | 'attack' | 'rejected';

/** Port of Main.Part6.cs 3696 btnColonyFacilityScrap_Click (after its Yes/No question): the colony owner's facility is
 *  removed (CheckRemoveFacilityTracking, ReviewPlanetaryFacilities); a pirate faction's facility at the colony is
 *  attacked instead (Habitat.InitiateAttackAgainstPirateFacilities; the button reads "Attack" and is disabled unless
 *  CheckCanInitiateAttackAgainstPirateFacilities, Main.Part11.cs 2739). The facility is given by its index in
 *  Habitat.Facilities and its definition id (a stale pick is rejected). */
export function scrapColonyFacility(galaxy: Galaxy, empire: Empire, h: Habitat, index: number, facilityId: number): ScrapFacilityResult {
    if (!ownColony(empire, h) || h.facilities === null || !Number.isInteger(index)) return 'rejected';
    const f = h.facilities[index] ?? null;
    if (f === null || f.planetaryFacilityDefinitionId !== facilityId) return 'rejected';
    if (checkFacilityOwner(galaxy, h, f) === h.owner) {
        h.facilities.splice(index, 1);
        checkRemoveFacilityTracking(h, f);
        reviewPlanetaryFacilities(galaxy, h, empire);
        return 'scrapped';
    }
    if (!checkCanInitiateAttackAgainstPirateFacilities(galaxy, h, empire, f)) return 'rejected';
    initiateAttackAgainstPirateFacilities(galaxy, h, empire, f);
    return 'attack';
}

/** Main.Part6.cs 3561 method_427: the Transfer drop-down's transports — the empire's ships within 1000 of the colony
 *  with room for at least 100 troop size. */
export function colonyTroopTransports(galaxy: Galaxy, empire: Empire, h: Habitat): BuiltObject[] {
    return getNearbyBuiltObjects(galaxy, h.xpos, h.ypos, 1000.0).filter((b) => b != null && !b.hasBeenDestroyed && b.empire === empire && b.troopCapacityRemaining >= 100);
}

/** Port of Main.Part6.cs 3525 btnColonyTroopTransferTransport_Click: move one troop (ungarrisoned) or one character
 *  from the colony onto the transport picked in the drop-down. The handler re-checks ownership, membership and the
 *  transport's remaining capacity, not the distance (the drop-down's list, method_427, holds the nearby ones). */
export function transferToTransport(galaxy: Galaxy, empire: Empire, h: Habitat, item: Troop | Character, transport: BuiltObject): boolean {
    if (transport === null || transport.troops === null) return false;
    if (item instanceof Troop) {
        const troop = item;
        if (transport.empire !== empire) return false;
        if (h.empire !== empire || h.troops === null || !h.troops.contains(troop) || transport.troopCapacityRemaining < troop.size) return false;
        if (troop.garrisoned) troop.garrisoned = false;
        h.troops.remove(troop);
        transport.troops.add(troop);
        troop.colony = null;
        troop.builtObject = transport;
        return true;
    }
    const character = item;
    if (transport.owner !== empire) return false;
    const chars = stellarObjectCharacters(h);
    if (h.empire !== empire || chars === null || !chars.includes(character) || character.empire !== empire || character.transferTimeRemaining > 0 || character.transferDestination !== null) return false;
    character.completeLocationTransfer(transport, galaxy);
    return true;
}
