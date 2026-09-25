// Empire.8.cs GenerateOrderedFleetsBy* (military-AI fleet ordering helpers) and the ShipGroup overloads of
// Empire.7.cs CheckLocationSafeForDemoralizingCharacter, needed by Empire.7.cs ReviewCharacterLocation
// (characters.ts). NOTE: these are Empire military-AI helpers; M4m (militaryAI.ts) may take ownership of them
// later — at merge, keep one copy (this one is a statement-for-statement port).

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import type { Character } from '../characters';
import { CharacterRole, getNonTransferringCharacters } from '../characters';
import { netSort } from '../netSort';
import type { ShipGroup } from './shipGroup';
import { empireShipGroups } from './shipGroup';
import {
    compareShipGroups,
    shipGroupListClearSortTags,
    shipGroupObtainCharacters,
    shipGroupTotalFighterCount,
    shipGroupTotalOverallStrengthFactor,
} from './shipGroupTasks';

// ShipGroupList.Sort() (List<ShipGroup>.Sort → ShipGroup.CompareTo, ShipGroup.cs 3574), Reverse(), ClearSortTags().
function sortReverseClear(shipGroupList: ShipGroup[]): ShipGroup[] {
    netSort(shipGroupList, compareShipGroups);
    shipGroupList.reverse();
    shipGroupListClearSortTags(shipGroupList);
    return shipGroupList;
}

/** Empire.8.cs 4755 GenerateOrderedFleetsByOverallStrength. */
export function generateOrderedFleetsByOverallStrength(galaxy: Galaxy, empire: Empire): ShipGroup[] {
    const shipGroups = empireShipGroups(empire);
    const shipGroupList: ShipGroup[] = [];
    for (let i = 0; i < shipGroups.length; i++) {
        const shipGroup = shipGroups[i]!;
        shipGroup.sortTag = shipGroupTotalOverallStrengthFactor(galaxy, shipGroup);
        shipGroupList.push(shipGroup);
    }
    return sortReverseClear(shipGroupList);
}

/** Empire.8.cs 4770 GenerateOrderedFleetsByFighterStrength. */
export function generateOrderedFleetsByFighterStrength(empire: Empire): ShipGroup[] {
    const shipGroups = empireShipGroups(empire);
    const shipGroupList: ShipGroup[] = [];
    for (let i = 0; i < shipGroups.length; i++) {
        const shipGroup = shipGroups[i]!;
        shipGroup.sortTag = shipGroupTotalFighterCount(shipGroup);
        shipGroupList.push(shipGroup);
    }
    return sortReverseClear(shipGroupList);
}

/** Empire.8.cs 4785 GenerateOrderedFleetsByTroopAttackStrength. */
export function generateOrderedFleetsByTroopAttackStrength(empire: Empire): ShipGroup[] {
    const shipGroups = empireShipGroups(empire);
    const shipGroupList: ShipGroup[] = [];
    for (let i = 0; i < shipGroups.length; i++) {
        const shipGroup = shipGroups[i]!;
        shipGroup.sortTag = shipGroup.totalTroopAttackStrength;
        shipGroupList.push(shipGroup);
    }
    return sortReverseClear(shipGroupList);
}

/**
 * Empire.7.cs 453 CheckLocationSafeForDemoralizingCharacter(bool characterIsDemoralizing, ShipGroup fleet,
 * Character characterToExclude) and 462 (ShipGroup fleet, Character characterToExclude).
 */
export function checkFleetSafeForDemoralizingCharacter(empire: Empire, characterIsDemoralizing: boolean, fleet: ShipGroup | null, characterToExclude: Character | null): boolean {
    void empire;
    if (characterIsDemoralizing) return checkFleetSafeForDemoralizingCharacterAt(fleet, characterToExclude);
    return true;
}
function checkFleetSafeForDemoralizingCharacterAt(fleet: ShipGroup | null, characterToExclude: Character | null): boolean {
    if (fleet !== null) {
        const characterList = shipGroupObtainCharacters(fleet);
        if (characterList !== null) {
            const nonTransferringCharacters = getNonTransferringCharacters(characterList, CharacterRole.Undefined, characterToExclude);
            if (nonTransferringCharacters !== null && nonTransferringCharacters.length > 0) return false;
        }
    }
    return true;
}
