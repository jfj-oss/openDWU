// M4q — ownership transfer: colonies and ships changing hands, lost colonies / abandoned ships found, cleared colonies.
//
// Ports (statement for statement, same Galaxy.Rnd draw order):
//   Empire.1.cs 54/59/64 TakeOwnershipOfColony, 373/384/395 TakeOwnershipOfOrders, 443 TakeOwnershipOfCargo,
//   514/519/524 TakeOwnershipOfBuiltObject, 899 ClearFleetHomeBases; BaconEmpire.cs 313 DestroyUnreservedCargoOfEmpire (empty),
//   1442 TakePossessionOfBuiltObject; Empire.3.cs 3399 ClearAttackersFromEmpire; Empire.cs 3596 SelectBestCandidateForCapital;
//   Empire.8.cs 3897/3924 CancelBlockade, 3956/4097 CancelAttacks, 3972/4000 CancelAllShipAttacksNonEnemies,
//   4028/4044 CancelAllShipAttacks, 4077 CancelAllShipUnloadTroops, 4119 CancelUnloadTroops, 4139 CancelAllCharacterTransfers;
//   Galaxy.7.cs 4262 ClearFleetHomeBases, 4274 ReevaluateMissionsAgainstHabitat; Galaxy.8.cs 3007 CheckPirateEmpireTerminated,
//   3563 CheckCancelIntelligenceMissionsWithTarget; Habitat.cs 2571 ScanForNewOwner, 7445/7450 ClearColony;
//   BuiltObject.1.cs 65/70 ScanForNewOwner; Galaxy.5.cs 2971 SortBuiltObjectsByDistance, 5240 InvestigateAbandonedBuiltObject,
//   4857 GenerateNavigationalBonusMessage, 4689 FindNearestUnknownIndependentColony, 4749 FindNearestUnknownRuin,
//   4782 FindNearestUnownedBuiltObject; Galaxy.8.cs 2828 FindNearestPirateFactionBaseUnknown;
//   BuiltObjectList.cs 317 GetBuiltObjectsByRole.
// Galaxy.Rnd: only through callees (InvestigateAbandonedBuiltObject: research breakthroughs, the player's navigational
// hint Next(0, 2) + Next(0, 11); mission assignment draws).

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import type { BuiltObject } from '../builtObject';
import type { Habitat } from '../types';
import { HabitatCategoryType, HabitatType } from '../types';
import { CargoList, TroopList, Cargo, type Troop } from '../cargo';
import { BuiltObjectRole } from '../data/designSpecifications';
import { BuiltObjectSubRole } from '../builtObjectTypes';
import { BuiltObjectStance, type Design } from '../design';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, builtObjectMission, isBuiltObject, isHabitat, type BuiltObjectMission, type StellarObject } from '../missions/mission';
import { assignMission, checkCancelContracts, clearAllMissionsForTargetHabitat, clearPreviousMissionRequirements } from '../missions/assign';
import { leaveShipGroup, type ShipGroup } from '../fleets/shipGroup';
import { selectFleetBase, shipGroupClearAllMissionsForTargetBuiltObject, shipGroupClearAllMissionsForTargetHabitat, shipGroupCompleteMission } from '../fleets/shipGroupTasks';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../diplomacy';
import { EmpireMessageType, resolveDescription, sendMessageToEmpire } from '../messages';
import { formatText, getText } from '../diplomacyTick';
import { EventMessageType, empireCompleteTeardown, sendEventMessageToEmpire } from '../events';
import { CharacterRole, ensureHabitatInvadingCharacters, ensureStellarObjectCharacters, habitatInvadingCharacterList, identifyPirateBase, stellarObjectCharacters, type Character } from '../characters';
import { recalculateDevelopmentLevelBaseline } from '../developmentLevel';
import { recalculateColonyInfluenceRadius, strategicValue } from '../territory';
import { recalculateAnnualTaxRevenue, recalculateDistanceFactor } from '../forceStructure';
import { setColonyTaxRate } from '../taxes';
import { reviewSpecialBonusesRuinsWonders } from '../treasury';
import { calculateWarWithOurRace } from '../colonyTick';
import { evaluateSystemLinks } from '../movement';
import { takeOwnershipOfColonyConstructionQueue } from '../construction/constructionYard';
import { ensureHabitatManufacturingQueue } from '../manufacturingQueue';
import { takeOwnershipOfColonyDockingBays } from '../logistics/dockingBays';
import { recalculateColonyDistancesFromCapital, reviewPlanetaryFacilities, checkRemoveFacilityTracking } from '../construction/facilities';
import { determineMiningStationAtHabitat } from '../resourceTargets';
import { builtObjectCompleteTeardown, clearAllMissionsForTargetBuiltObject } from './teardown';
import { cancelPirateMissionsForTarget } from '../pirates/missionsMarket';
import { EmpireActivityType } from '../pirates/empireActivity';
import { eliminatePirateFaction } from '../pirates/pirateGalaxyTick';
import { cargoEmpireId } from '../logistics/orders';
import type { Order } from '../logistics/orders';
import { checkForShipsDiscoveringRuins } from '../exploration';
import { builtObjectThreats } from './threats';
import { determineSpacePortAtColony, determineDestroyOrCaptureTarget, resolveTechBonusFactor } from './attackAI';
import { findNearestPirateFaction } from '../pirates';
import { inflictDamageFull } from './damage';
import { BuiltObjectEncounterAction, BuiltObjectEncounterEventType, cloneDesign } from '../gameStartTail';
import { galaxyNow, galaxyStarDate } from '../tick/simTime';
import { getGovernmentsStatic } from '../empire';
import { fastFindNearestUnexploredHabitat } from '../civilianAI';
import { SystemVisibilityStatus } from '../visibility';
import { selectRandomNextResearchProjectExcludeSuperWeapons } from '../construction/constructionQueue';
import { doResearchBreakthrough, reviewDesignsBuiltObjectsImprovedComponents } from '../researchTick';
import { pirateEconomyPerformIncome } from '../pirates/pirateAI';
import { PirateIncomeType } from '../pirates/pirateEconomy';
import { addLocationHint } from '../tradeItems';
import { GalaxyLocationType } from '../galaxyLocation';
import { resolveSectorDescription } from '../empireEvents';
import { netSort } from '../netSort';

// ---------------------------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------------------------

function removeAt<T>(list: T[] | null, item: T): void {
    if (list === null) return;
    const i = list.indexOf(item);
    if (i >= 0) list.splice(i, 1);
}
function troopEmpire(troop: Troop): Empire | null {
    return troop.empire as Empire | null;
}
function shipGroupsOf(empire: Empire): ShipGroup[] {
    return empire.shipGroups as ShipGroup[];
}
function charactersOf(empire: Empire): Character[] {
    return empire.characters as Character[];
}

/** BuiltObjectList.cs 317 GetBuiltObjectsByRole(roles). */
export function getBuiltObjectsByRole(list: readonly BuiltObject[], roles: BuiltObjectRole[]): BuiltObject[] {
    const result: BuiltObject[] = [];
    for (let index = 0; index < list.length; ++index) {
        const builtObject = list[index];
        if (builtObject != null && roles.includes(builtObject.role)) result.push(builtObject);
    }
    return result;
}

/** Empire.cs 3596 SelectBestCandidateForCapital(). No Rnd. */
export function selectBestCandidateForCapital(empire: Empire): Habitat | null {
    let result: Habitat | null = null;
    let num = 0;
    for (let i = 0; i < empire.colonies.length; i++) {
        const habitat = empire.colonies[i];
        if (strategicValue(habitat) > num) {
            result = habitat;
            num = strategicValue(habitat);
        }
    }
    return result;
}

/** Galaxy.8.cs 3007 CheckPirateEmpireTerminated(pirateFaction). No Rnd. */
export function checkPirateEmpireTerminated(galaxy: Galaxy, pirateFaction: Empire | null): boolean {
    void galaxy;
    if (pirateFaction !== null) {
        const builtObject = identifyPirateBase(pirateFaction);
        if (
            builtObject === null &&
            (pirateFaction.colonies == null || pirateFaction.colonies.length <= 0) &&
            pirateFaction.builtObjects.filter((b) => b != null && b.subRole === BuiltObjectSubRole.ConstructionShip).length <= 0 &&
            pirateFaction.builtObjects.filter((b) => b != null && b.subRole === BuiltObjectSubRole.ResupplyShip).length <= 0
        ) {
            return true;
        }
    }
    return false;
}

// ---------------------------------------------------------------------------------------------------------------
// Empire.8.cs 3897-4160: cancelling blockades, attacks and transfers against a target changing hands
// ---------------------------------------------------------------------------------------------------------------

/** Empire.8.cs 3924 CancelBlockade(colony) / 3897 CancelBlockade(builtObject). No Rnd. */
export function cancelBlockadeHabitat(galaxy: Galaxy, empire: Empire, colony: Habitat): void {
    void empire;
    // Galaxy.Blockades (BlockadeList): TODO(port) M4m — blockades are not modelled yet (ImplementBlockade is a stub), so
    // `_Galaxy.Blockades[colony]` is null and the loop never runs.
    void galaxy;
    void colony;
}

/** Empire.8.cs 3956 CancelAttacks(builtObject). No Rnd. */
export function cancelAttacksBuiltObject(galaxy: Galaxy, empire: Empire, builtObject: BuiltObject): void {
    void empire;
    for (let i = 0; i < galaxy.empires.length; i++) {
        const e = galaxy.empires[i];
        const groups = shipGroupsOf(e);
        for (let j = 0; j < groups.length; j++) {
            const shipGroup = groups[j];
            shipGroupClearAllMissionsForTargetBuiltObject(galaxy, shipGroup, builtObject, BuiltObjectMissionType.Attack);
            shipGroupClearAllMissionsForTargetBuiltObject(galaxy, shipGroup, builtObject, BuiltObjectMissionType.WaitAndAttack);
            shipGroupClearAllMissionsForTargetBuiltObject(galaxy, shipGroup, builtObject, BuiltObjectMissionType.Capture);
            shipGroupClearAllMissionsForTargetBuiltObject(galaxy, shipGroup, builtObject, BuiltObjectMissionType.Raid);
        }
    }
}

/** Empire.8.cs 4097 CancelAttacks(colony). No Rnd. */
export function cancelAttacksHabitat(galaxy: Galaxy, empire: Empire, colony: Habitat): void {
    const builtObject = determineSpacePortAtColony(galaxy, colony);
    if (builtObject !== null) cancelAttacksBuiltObject(galaxy, empire, builtObject);
    for (let i = 0; i < galaxy.empires.length; i++) {
        const e = galaxy.empires[i];
        const groups = shipGroupsOf(e);
        for (let j = 0; j < groups.length; j++) {
            const shipGroup = groups[j];
            shipGroupClearAllMissionsForTargetHabitat(galaxy, shipGroup, colony, BuiltObjectMissionType.Attack);
            shipGroupClearAllMissionsForTargetHabitat(galaxy, shipGroup, colony, BuiltObjectMissionType.WaitAndAttack);
            shipGroupClearAllMissionsForTargetHabitat(galaxy, shipGroup, colony, BuiltObjectMissionType.Bombard);
            shipGroupClearAllMissionsForTargetHabitat(galaxy, shipGroup, colony, BuiltObjectMissionType.WaitAndBombard);
            shipGroupClearAllMissionsForTargetHabitat(galaxy, shipGroup, colony, BuiltObjectMissionType.Raid);
        }
    }
}

/** A non-enemy of `self` (Empire.8.cs 3978-3990 / 4006-4018 `flag`). */
function isNonEnemy(self: Empire, empire: Empire): boolean {
    let flag = true;
    if (empire !== self && empire.pirateEmpireBaseHabitat === null && self.pirateEmpireBaseHabitat === null) {
        const diplomaticRelation = obtainDiplomaticRelation(self, empire);
        if (diplomaticRelation.type === DiplomaticRelationType.War) flag = false;
    }
    return flag;
}

/** Empire.8.cs 3972 CancelAllShipAttacksNonEnemies(builtObject). No Rnd. */
export function cancelAllShipAttacksNonEnemiesBuiltObject(galaxy: Galaxy, self: Empire, builtObject: BuiltObject): void {
    for (let i = 0; i < galaxy.empires.length; i++) {
        const empire = galaxy.empires[i];
        if (!isNonEnemy(self, empire)) continue;
        for (const builtObject2 of empire.builtObjects) {
            clearAllMissionsForTargetBuiltObject(galaxy, builtObject2, builtObject2, builtObject, BuiltObjectMissionType.Attack, true);
            clearAllMissionsForTargetBuiltObject(galaxy, builtObject2, builtObject2, builtObject, BuiltObjectMissionType.WaitAndAttack, true);
            clearAllMissionsForTargetBuiltObject(galaxy, builtObject2, builtObject2, builtObject, BuiltObjectMissionType.Capture, true);
            clearAllMissionsForTargetBuiltObject(galaxy, builtObject2, builtObject2, builtObject, BuiltObjectMissionType.Raid, true);
        }
    }
}

/** Empire.8.cs 4000 CancelAllShipAttacksNonEnemies(colony). No Rnd. */
export function cancelAllShipAttacksNonEnemiesHabitat(galaxy: Galaxy, self: Empire, colony: Habitat): void {
    for (let i = 0; i < galaxy.empires.length; i++) {
        const empire = galaxy.empires[i];
        if (!isNonEnemy(self, empire)) continue;
        for (const builtObject of empire.builtObjects) {
            clearAllMissionsForTargetHabitat(galaxy, builtObject, builtObject, colony, BuiltObjectMissionType.Attack, true);
            clearAllMissionsForTargetHabitat(galaxy, builtObject, builtObject, colony, BuiltObjectMissionType.WaitAndAttack, true);
            clearAllMissionsForTargetHabitat(galaxy, builtObject, builtObject, colony, BuiltObjectMissionType.Bombard, true);
            clearAllMissionsForTargetHabitat(galaxy, builtObject, builtObject, colony, BuiltObjectMissionType.WaitAndBombard, true);
        }
    }
}

/** Empire.8.cs 4028 CancelAllShipAttacks(builtObject). No Rnd. */
export function cancelAllShipAttacksBuiltObject(galaxy: Galaxy, builtObject: BuiltObject): void {
    for (let i = 0; i < galaxy.empires.length; i++) {
        const empire = galaxy.empires[i];
        for (let j = 0; j < empire.builtObjects.length; j++) {
            const builtObject2 = empire.builtObjects[j];
            clearAllMissionsForTargetBuiltObject(galaxy, builtObject2, builtObject2, builtObject, BuiltObjectMissionType.Attack, true);
            clearAllMissionsForTargetBuiltObject(galaxy, builtObject2, builtObject2, builtObject, BuiltObjectMissionType.WaitAndAttack, true);
            clearAllMissionsForTargetBuiltObject(galaxy, builtObject2, builtObject2, builtObject, BuiltObjectMissionType.Capture, true);
            clearAllMissionsForTargetBuiltObject(galaxy, builtObject2, builtObject2, builtObject, BuiltObjectMissionType.Raid, true);
        }
    }
}

/** Empire.8.cs 4044 CancelAllShipAttacks(colony, alsoCancelAttackForBases). No Rnd. */
export function cancelAllShipAttacksHabitat(galaxy: Galaxy, colony: Habitat, alsoCancelAttackForBases: boolean): void {
    if (alsoCancelAttackForBases) {
        const builtObject = determineSpacePortAtColony(galaxy, colony);
        if (builtObject !== null) cancelAllShipAttacksBuiltObject(galaxy, builtObject);
        if (colony.basesAtHabitat !== null) {
            for (let i = 0; i < colony.basesAtHabitat.length; i++) cancelAllShipAttacksBuiltObject(galaxy, colony.basesAtHabitat[i]);
        }
    }
    for (let j = 0; j < galaxy.empires.length; j++) {
        const empire = galaxy.empires[j];
        for (let k = 0; k < empire.builtObjects.length; k++) {
            const builtObject3 = empire.builtObjects[k];
            clearAllMissionsForTargetHabitat(galaxy, builtObject3, builtObject3, colony, BuiltObjectMissionType.Attack, true);
            clearAllMissionsForTargetHabitat(galaxy, builtObject3, builtObject3, colony, BuiltObjectMissionType.WaitAndAttack, true);
            clearAllMissionsForTargetHabitat(galaxy, builtObject3, builtObject3, colony, BuiltObjectMissionType.Bombard, true);
            clearAllMissionsForTargetHabitat(galaxy, builtObject3, builtObject3, colony, BuiltObjectMissionType.WaitAndBombard, true);
            clearAllMissionsForTargetHabitat(galaxy, builtObject3, builtObject3, colony, BuiltObjectMissionType.Raid, true);
        }
    }
}

/** Empire.8.cs 4077 CancelAllShipUnloadTroops(colony). No Rnd. */
export function cancelAllShipUnloadTroops(galaxy: Galaxy, colony: Habitat | null): void {
    if (colony === null) return;
    for (let i = 0; i < galaxy.empires.length; i++) {
        const empire = galaxy.empires[i];
        if (empire != null && empire.builtObjects !== null) {
            for (let j = 0; j < empire.builtObjects.length; j++) {
                const builtObject = empire.builtObjects[j];
                if (builtObject != null) clearAllMissionsForTargetHabitat(galaxy, builtObject, builtObject, colony, BuiltObjectMissionType.UnloadTroops, true);
            }
        }
    }
}

/** Empire.8.cs 4119 CancelUnloadTroops(colony). No Rnd. */
export function cancelUnloadTroops(galaxy: Galaxy, colony: Habitat | null): void {
    if (colony === null) return;
    for (let i = 0; i < galaxy.empires.length; i++) {
        const empire = galaxy.empires[i];
        if (empire != null && empire.shipGroups !== null) {
            const groups = shipGroupsOf(empire);
            for (let j = 0; j < groups.length; j++) {
                const shipGroup = groups[j];
                if (shipGroup != null) shipGroupClearAllMissionsForTargetHabitat(galaxy, shipGroup, colony, BuiltObjectMissionType.UnloadTroops);
            }
        }
    }
}

/** Empire.8.cs 4139 CancelAllCharacterTransfers(colony). No Rnd. */
export function cancelAllCharacterTransfers(galaxy: Galaxy, colony: Habitat): void {
    for (let i = 0; i < galaxy.empires.length; i++) {
        const empire = galaxy.empires[i];
        if (empire == null || empire.characters == null) continue;
        const chars = charactersOf(empire);
        for (let j = 0; j < chars.length; j++) {
            const character = chars[j];
            if (character != null && character.transferDestination === colony && character.transferTimeRemaining > 0 && character.location !== character.transferDestination) {
                character.resetTransfer();
            }
        }
    }
}

/**
 * Galaxy.8.cs 3563 CheckCancelIntelligenceMissionsWithTarget(target). Intelligence missions are only created by the
 * (deferred) espionage code, so every agent's Mission is null; a set mission throws the deferred TODO. No Rnd.
 */
export function checkCancelIntelligenceMissionsWithTarget(galaxy: Galaxy, target: StellarObject | null): void {
    if (target === null) return;
    for (let i = 0; i < galaxy.empires.length; i++) {
        const empire = galaxy.empires[i];
        if (empire == null || empire.characters == null) continue;
        const chars = charactersOf(empire);
        for (let j = 0; j < chars.length; j++) {
            const character = chars[j];
            if (character == null || character.role !== CharacterRole.IntelligenceAgent) continue;
            const mission = character.mission as { target: unknown } | null;
            if (mission == null || mission.target == null) continue;
            if (mission.target === target) {
                // Empire.CancelIntelligenceMission(mission); character.Mission = null — espionage is deferred.
                throw new Error('TODO(port) deferred espionage: Empire.CancelIntelligenceMission (Galaxy.8.cs 3563)');
            }
        }
    }
}

/** Galaxy.7.cs 4274 ReevaluateMissionsAgainstHabitat(habitat, newEmpire). No Rnd. */
export function reevaluateMissionsAgainstHabitat(galaxy: Galaxy, habitat: Habitat, newEmpire: Empire | null): void {
    for (let i = 0; i < galaxy.empires.length; i++) {
        const empire = galaxy.empires[i];
        let diplomaticRelationType = DiplomaticRelationType.None;
        if (newEmpire !== null && newEmpire !== galaxy.independentEmpire) {
            const diplomaticRelation = obtainDiplomaticRelation(empire, newEmpire);
            diplomaticRelationType = diplomaticRelation.type;
        }
        if (diplomaticRelationType === DiplomaticRelationType.War || diplomaticRelationType === DiplomaticRelationType.TradeSanctions) continue;
        const groups = shipGroupsOf(empire);
        for (let j = 0; j < groups.length; j++) {
            const shipGroup = groups[j];
            const m = builtObjectMission(shipGroup.mission);
            if (
                m !== null &&
                m.type !== BuiltObjectMissionType.Undefined &&
                m.targetHabitat === habitat &&
                (m.type === BuiltObjectMissionType.WaitAndAttack || m.type === BuiltObjectMissionType.Attack || m.type === BuiltObjectMissionType.Blockade || m.type === BuiltObjectMissionType.Bombard || m.type === BuiltObjectMissionType.WaitAndBombard)
            ) {
                shipGroupCompleteMission(galaxy, shipGroup);
            }
        }
    }
}

/** Empire.1.cs 899 ClearFleetHomeBases(currentBase). No Rnd. */
function empireClearFleetHomeBases(galaxy: Galaxy, empire: Empire, currentBase: StellarObject | null): void {
    if (empire.shipGroups === null || currentBase === null) return;
    const groups = shipGroupsOf(empire);
    for (let i = 0; i < groups.length; i++) {
        const shipGroup = groups[i];
        if (shipGroup == null || shipGroup.gatherPoint === null) continue;
        let flag = false;
        const gp = shipGroup.gatherPoint;
        if (isHabitat(currentBase)) {
            const habitat = currentBase;
            if (isBuiltObject(gp)) {
                if (gp.parentHabitat !== null && gp.parentHabitat === habitat) flag = true;
            } else if (isHabitat(gp)) {
                if (gp === habitat) flag = true;
            }
        } else if (isBuiltObject(currentBase)) {
            const builtObject2 = currentBase;
            if (isBuiltObject(gp)) {
                if (gp !== null && gp === builtObject2) flag = true;
            } else if (isHabitat(gp)) {
                if (builtObject2.parentHabitat !== null && builtObject2.parentHabitat === gp) flag = true;
            }
        }
        if (flag) {
            const stellarObject = selectFleetBase(galaxy, empire, shipGroup);
            if (stellarObject !== shipGroup.gatherPoint) shipGroup.gatherPoint = stellarObject;
            else shipGroup.gatherPoint = null;
        }
    }
}

/** Galaxy.7.cs 4262 ClearFleetHomeBases(currentBase). No Rnd. */
export function clearFleetHomeBases(galaxy: Galaxy, currentBase: StellarObject | null): void {
    for (let i = 0; i < galaxy.empires.length; i++) {
        const empire = galaxy.empires[i];
        if (empire != null && empire.active && empire.shipGroups !== null) empireClearFleetHomeBases(galaxy, empire, currentBase);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Empire.1.cs 373-512: cargo and orders changing hands
// ---------------------------------------------------------------------------------------------------------------

/** Empire.1.cs 443 TakeOwnershipOfCargo(cargoList, oldEmpire, newEmpire). No Rnd. */
export function takeOwnershipOfCargo(galaxy: Galaxy, cargoList: CargoList | null, oldEmpire: Empire | null, newEmpire: Empire | null): void {
    if (cargoList === null) return;
    let num = -1;
    if (oldEmpire !== null) num = oldEmpire.empireId;
    const cargoList2: (Cargo | null)[] = [];
    const cargoList3: Cargo[] = [];
    for (let i = 0; i < cargoList.items.length; i++) {
        const cargo = cargoList.items[i];
        const empireId = cargo != null ? cargoEmpireId(cargo) : 0;
        if (cargo != null && (empireId === num || empireId < 0 || empireId === galaxy.independentEmpire!.empireId)) {
            let cargo2: Cargo | null = null;
            if (cargo.commodityIsComponent) cargo2 = Cargo.ofComponent(cargo.commodityComponent!, cargo.amount, newEmpire, cargo.reserved);
            else if (cargo.commodityIsResource) cargo2 = new Cargo(cargo.commodity, cargo.amount, newEmpire, cargo.reserved);
            cargoList2.push(cargo2);
            cargoList3.push(cargo);
        }
    }
    for (let j = 0; j < cargoList3.length; j++) cargoList.remove(cargoList3[j]);
    for (const item of cargoList2) cargoList.add(item!);
}

/** Empire.1.cs 395 TakeOwnershipOfOrders(orders, oldEmpire, newEmpire). No Rnd. */
function takeOwnershipOfOrderList(orders: readonly Order[], oldEmpire: Empire | null, newEmpire: Empire | null): void {
    for (let i = 0; i < orders.length; i++) {
        const order = orders[i];
        if (order.contracts == null || order.contracts.length <= 0) continue;
        for (let j = 0; j < order.contracts.length; j++) {
            const contract = order.contracts[j]!;
            if (contract.freighter === null || contract.freighter.cargo === null || contract.freighter.hasBeenDestroyed) continue;
            const freighterCargo = contract.freighter.cargo;
            if (order.commodityComponent !== null) {
                const cargo = freighterCargo.getCargoComponent(order.commodityComponent.componentId, oldEmpire);
                if (cargo !== null && cargo.amount >= contract.amountToFulfill) {
                    const cargo2 = Cargo.ofComponent(order.commodityComponent, contract.amountToFulfill, newEmpire);
                    if (cargo.amount === contract.amountToFulfill) freighterCargo.remove(cargo);
                    else cargo.amount -= contract.amountToFulfill;
                    freighterCargo.add(cargo2);
                }
            } else {
                if (order.commodityResource === null) continue;
                const idx = freighterCargo.indexOf(order.commodityResource, oldEmpire);
                const cargo3 = idx >= 0 ? freighterCargo.items[idx] : null;
                if (cargo3 !== null && cargo3.amount >= contract.amountToFulfill) {
                    const cargo4 = new Cargo(order.commodityResource, contract.amountToFulfill, newEmpire);
                    if (cargo3.amount === contract.amountToFulfill) freighterCargo.remove(cargo3);
                    else cargo3.amount -= contract.amountToFulfill;
                    freighterCargo.add(cargo4);
                }
            }
        }
    }
}

/** Empire.1.cs 373 TakeOwnershipOfOrders(colony, oldEmpire, newEmpire). */
export function takeOwnershipOfOrdersHabitat(galaxy: Galaxy, colony: Habitat | null, oldEmpire: Empire | null, newEmpire: Empire | null): void {
    const orderList: Order[] = [];
    if (colony !== null) orderList.push(...galaxy.orders.getOrdersForHabitat(colony).items);
    takeOwnershipOfOrderList(orderList, oldEmpire, newEmpire);
}

/** Empire.1.cs 384 TakeOwnershipOfOrders(spacePort, oldEmpire, newEmpire). */
export function takeOwnershipOfOrdersBuiltObject(galaxy: Galaxy, spacePort: BuiltObject | null, oldEmpire: Empire | null, newEmpire: Empire | null): void {
    const orderList: Order[] = [];
    if (spacePort !== null) orderList.push(...galaxy.orders.getOrdersForBuiltObject(spacePort).items);
    takeOwnershipOfOrderList(orderList, oldEmpire, newEmpire);
}

// ---------------------------------------------------------------------------------------------------------------
// Empire.1.cs 64 TakeOwnershipOfColony
// ---------------------------------------------------------------------------------------------------------------

/** The ConstructionQueue members touched here (construction/constructionYard.ts owns the class). */
interface QueueLike {
    constructionYards: { shipUnderConstruction: BuiltObject | null }[];
    constructionWaitQueue: BuiltObject[] | null;
}
function queueOf(o: { constructionQueue: unknown }): QueueLike | null {
    return o.constructionQueue as QueueLike | null;
}

/**
 * Empire.1.cs 64 TakeOwnershipOfColony(colony, newEmpire, destroyBases, destroyTroops) (54/59: false, false). `self` is the
 * C# `this` (the empire the call is made on: its hyperdrive tech sets the influence radius, and it re-resolves its
 * system visibility). No Rnd directly (the base transfers and fleet re-basing draw none).
 */
export function takeOwnershipOfColonyFull(galaxy: Galaxy, self: Empire, colony: Habitat, newEmpire: Empire | null, destroyBases: boolean, destroyTroops: boolean): void {
    const empire = colony.empire;
    // _Galaxy.CheckTriggerEvent(colony.GameEventId, newEmpire, Capture, null): scripted game events are deferred (plan §0.3);
    // a new game defines none.
    let flag = false;
    if (colony.empire !== null) {
        if (colony.empire.capital === colony) flag = true;
        removeAt(colony.empire.colonies, colony);
    }
    if (colony.cargo === null) colony.cargo = new CargoList();
    if (colony.troops === null) colony.troops = new TroopList();
    if (colony.troopsToRecruit === null) colony.troopsToRecruit = new TroopList();
    if (colony.invadingTroops === null) colony.invadingTroops = new TroopList();
    ensureStellarObjectCharacters(colony);
    ensureHabitatInvadingCharacters(colony);
    if (colony.facilities === null) colony.facilities = [];
    takeOwnershipOfColonyConstructionQueue(galaxy, colony);
    ensureHabitatManufacturingQueue(galaxy, colony);
    takeOwnershipOfColonyDockingBays(colony);
    clearFleetHomeBases(galaxy, colony);
    colony.owner = newEmpire;
    colony.empire = newEmpire;
    if (colony.troops !== null) {
        for (let j = 0; j < colony.troops.count; j++) {
            const troop = colony.troops.items[j];
            const te = troopEmpire(troop);
            if (te !== null && te.troops != null) te.troops.remove(troop);
            if (!destroyTroops && newEmpire !== null && newEmpire.troops != null) {
                troop.empire = newEmpire;
                newEmpire.troops.add(troop);
            }
        }
        if (destroyTroops || newEmpire === null) colony.troops.clear();
    }
    if (colony.troopsToRecruit !== null) {
        for (let k = 0; k < colony.troopsToRecruit.count; k++) {
            const troop2 = colony.troopsToRecruit.items[k];
            const te2 = troopEmpire(troop2);
            if (te2 !== null && te2.troops != null && te2.troops.contains(troop2)) te2.troops.remove(troop2);
            if (!destroyTroops && newEmpire !== null) troop2.empire = newEmpire;
        }
        if (destroyTroops || newEmpire === null) colony.troopsToRecruit.clear();
    }
    const chars = stellarObjectCharacters(colony);
    if (chars !== null) {
        const array = chars.slice();
        for (let l = 0; l < array.length; l++) array[l].completeEmpireChange(newEmpire);
    }
    if (newEmpire !== null) {
        cancelBlockadeHabitat(galaxy, newEmpire, colony);
        cancelAttacksHabitat(galaxy, newEmpire, colony);
        cancelAllShipAttacksHabitat(galaxy, colony, false);
        cancelUnloadTroops(galaxy, colony);
        cancelAllShipUnloadTroops(galaxy, colony);
        cancelAllShipAttacksNonEnemiesHabitat(galaxy, newEmpire, colony);
        checkCancelIntelligenceMissionsWithTarget(galaxy, colony);
        cancelAllCharacterTransfers(galaxy, colony);
    }
    reevaluateMissionsAgainstHabitat(galaxy, colony, newEmpire);
    if (empire !== null) {
        if (flag) {
            empire.capital = selectBestCandidateForCapital(empire);
            recalculateColonyDistancesFromCapital(galaxy, empire);
        }
        if (empire.colonies.length <= 0 && empire !== galaxy.independentEmpire) {
            if (empire.pirateEmpireBaseHabitat !== null) {
                if (checkPirateEmpireTerminated(galaxy, empire)) eliminatePirateFaction(galaxy, empire, newEmpire);
            } else if (newEmpire !== null) {
                sendMessageToEmpire(newEmpire, empire, EmpireMessageType.EmpireDefeated, empire, getText('You have been defeated!'));
                empireCompleteTeardown(galaxy, empire, newEmpire);
            } else {
                sendMessageToEmpire(empire, empire, EmpireMessageType.EmpireDefeated, empire, getText('You have been defeated!'));
                empireCompleteTeardown(galaxy, empire, null);
            }
        }
    }
    if (newEmpire !== null) {
        colony.isRefuellingDepot = true;
        takeOwnershipOfCargo(galaxy, colony.cargo, empire, newEmpire);
        takeOwnershipOfOrdersHabitat(galaxy, colony, empire, newEmpire);
        colony.restrictedResourcesPresent = false;
        reviewSpecialBonusesRuinsWonders(galaxy, newEmpire);
        if (newEmpire.capital === null) newEmpire.capital = colony;
        if (!newEmpire.colonies.includes(colony)) newEmpire.colonies.push(colony);
        recalculateDistanceFactor(galaxy, colony);
        setColonyTaxRate(galaxy, newEmpire, colony, false);
        if (newEmpire.policy != null) {
            colony.colonyPopulationPolicy = newEmpire.policy.newColonyPopulationPolicyAllRaces;
            colony.colonyPopulationPolicyRaceFamily = newEmpire.policy.newColonyPopulationPolicyYourRaceFamily;
        }
    } else {
        colony.isRefuellingDepot = false;
        const orders = galaxy.orders.getOrdersForHabitat(colony).items.slice();
        for (const item2 of orders) {
            if (item2.amountStillToArrive > 0) {
                for (let m = 0; m < item2.contracts.length; m++) {
                    const contract = item2.contracts[m]!;
                    const fm = contract.freighter !== null ? builtObjectMission(contract.freighter.mission) : null;
                    if (contract.freighter !== null && fm !== null && fm.type === BuiltObjectMissionType.Transport && fm.secondaryTargetHabitat === item2.requestingColony) {
                        clearPreviousMissionRequirements(galaxy, contract.freighter);
                    }
                }
            }
            galaxy.orders.remove(item2);
        }
    }
    recalculateDevelopmentLevelBaseline(colony);
    recalculateAnnualTaxRevenue(galaxy, colony);
    const empireHasWarptech = self.hasHyperDriveTech;
    recalculateColonyInfluenceRadius(galaxy, colony, empireHasWarptech);
    const builtObject = determineMiningStationAtHabitat(colony) as BuiltObject | null;
    if (builtObject !== null && builtObject.subRole !== BuiltObjectSubRole.SmallSpacePort && builtObject.subRole !== BuiltObjectSubRole.MediumSpacePort && builtObject.subRole !== BuiltObjectSubRole.LargeSpacePort) {
        builtObjectCompleteTeardown(galaxy, builtObject);
    }
    for (let n = 0; n < colony.basesAtHabitat.length; n++) {
        const builtObject2 = colony.basesAtHabitat[n];
        const S = BuiltObjectSubRole;
        if (builtObject2.subRole === S.GenericBase || builtObject2.subRole === S.EnergyResearchStation || builtObject2.subRole === S.WeaponsResearchStation || builtObject2.subRole === S.HighTechResearchStation || builtObject2.subRole === S.MonitoringStation || builtObject2.subRole === S.ResortBase || builtObject2.subRole === S.DefensiveBase) {
            if (destroyBases) builtObjectCompleteTeardown(galaxy, builtObject2, true);
            else takeOwnershipOfBuiltObject(galaxy, self, builtObject2, newEmpire, true);
        }
    }
    if (empire !== null) {
        const list = [BuiltObjectRole.Base];
        const builtObjectsByRole = getBuiltObjectsByRole(empire.builtObjects, list);
        const builtObjectsByRole2 = getBuiltObjectsByRole(empire.privateBuiltObjects, list);
        for (let num2 = 0; num2 < builtObjectsByRole.length; num2++) {
            const builtObject3 = builtObjectsByRole[num2];
            if (builtObject3.parentHabitat === colony || builtObject3.builtAt === colony || builtObject3.dockedAt === colony) {
                if (destroyBases) builtObjectCompleteTeardown(galaxy, builtObject3, true);
                else takeOwnershipOfBuiltObject(galaxy, self, builtObject3, newEmpire, true);
            }
        }
        for (let num3 = 0; num3 < builtObjectsByRole2.length; num3++) {
            const builtObject4 = builtObjectsByRole2[num3];
            if (builtObject4.parentHabitat === colony || builtObject4.builtAt === colony || builtObject4.dockedAt === colony) {
                if (destroyBases) builtObjectCompleteTeardown(galaxy, builtObject4, true);
                else takeOwnershipOfBuiltObject(galaxy, self, builtObject4, newEmpire, true);
            }
        }
    }
    const queue = queueOf(colony);
    if (queue !== null && queue.constructionYards.length > 0) {
        for (let num4 = 0; num4 < queue.constructionYards.length; num4++) {
            const constructionYard = queue.constructionYards[num4];
            if (constructionYard.shipUnderConstruction !== null && constructionYard.shipUnderConstruction.empire === empire) {
                if (destroyBases) builtObjectCompleteTeardown(galaxy, constructionYard.shipUnderConstruction, true);
                else takeOwnershipOfBuiltObject(galaxy, self, constructionYard.shipUnderConstruction, newEmpire, true);
            }
        }
        if (queue.constructionWaitQueue !== null) {
            const builtObjectList = queue.constructionWaitQueue.slice();
            for (let num5 = 0; num5 < builtObjectList.length; num5++) {
                const builtObject5 = builtObjectList[num5];
                if (destroyBases) builtObjectCompleteTeardown(galaxy, builtObject5, true);
                else takeOwnershipOfBuiltObject(galaxy, self, builtObject5, newEmpire, true);
            }
            if (destroyBases) queue.constructionWaitQueue.length = 0;
        }
    }
    cancelPirateMissionsForTarget(galaxy, colony, EmpireActivityType.Smuggle);
    cancelPirateMissionsForTarget(galaxy, colony, EmpireActivityType.Attack);
    self.visibility.resolveSystemVisibilityAt(colony.xpos, colony.ypos, null, null);
    if (self.resourceMap != null) self.resourceMap.setResourcesKnown(colony, true);
    colony.rebelling = false;
    calculateWarWithOurRace(galaxy, colony);
    colony.culturalDistressFactor = 0;
    galaxy.determineSystemInfo(galaxy.systems[colony.systemIndex], null);
    if (empire !== null) {
        reviewSpecialBonusesRuinsWonders(galaxy, empire);
        evaluateSystemLinks(galaxy, empire);
    }
    if (newEmpire !== null) evaluateSystemLinks(galaxy, newEmpire);
}

// ---------------------------------------------------------------------------------------------------------------
// Empire.1.cs 524 TakeOwnershipOfBuiltObject
// ---------------------------------------------------------------------------------------------------------------

/** Empire.3.cs 3399 ClearAttackersFromEmpire(ship, empire). No Rnd. */
function clearAttackersFromEmpire(ship: BuiltObject, empire: Empire): void {
    const attackers = (ship.attackers ?? []) as StellarObject[];
    const stellarObjectList: StellarObject[] = [];
    for (const attacker of attackers) {
        if (isBuiltObject(attacker)) {
            if (attacker.empire === empire) stellarObjectList.push(attacker);
        }
    }
    for (const item of stellarObjectList) removeAt(attackers, item);
}

/** A Fighter's owner fields (M4p owns the class). */
interface FighterOwnerLike {
    empire: Empire | null;
    owner: Empire | null;
}

/**
 * Empire.1.cs 524 TakeOwnershipOfBuiltObject(builtObject, newEmpire, setDesignAsObsolete, removeFromFleet) (514/519:
 * setDesignAsObsolete false, removeFromFleet true). `self` is the C# `this`. No Rnd.
 * BaconEmpire.TakePossessionOfBuiltObject marks a base "givenInTrade" only when `new StackFrame(2)` is GiveTradeableItem;
 * GiveTradeableItem calls the 3-argument overload, so frame 2 is that overload and the check never matches (no-op).
 */
export function takeOwnershipOfBuiltObject(galaxy: Galaxy, self: Empire, builtObject: BuiltObject, newEmpire: Empire | null, setDesignAsObsolete = false, removeFromFleet = true): void {
    const actualEmpire = builtObject.actualEmpire;
    // _Galaxy.CheckTriggerEvent(builtObject.GameEventId, newEmpire, Capture, null): scripted game events are deferred.
    if (removeFromFleet && builtObject.shipGroup !== null) leaveShipGroup(galaxy, builtObject);
    if (actualEmpire !== null) {
        removeAt(actualEmpire.spacePorts, builtObject);
        removeAt(actualEmpire.constructionYards, builtObject);
        removeAt(actualEmpire.miningStations, builtObject);
        removeAt(actualEmpire.builtObjects, builtObject);
        removeAt(actualEmpire.privateBuiltObjects, builtObject);
        removeAt(actualEmpire.resourceExtractors, builtObject);
        removeAt(actualEmpire.manufacturers, builtObject);
        removeAt(actualEmpire.longRangeScanners, builtObject);
        removeAt(actualEmpire.researchFacilities, builtObject);
        removeAt(actualEmpire.resortBases, builtObject);
        removeAt(actualEmpire.planetDestroyers, builtObject);
        removeAt(actualEmpire.refuellingDepots, builtObject);
        removeAt(actualEmpire.freighters, builtObject);
        removeAt(actualEmpire.constructionShips, builtObject);
        removeAt(actualEmpire.outlaws, builtObject);
    } else if (galaxy.abandonedBuiltObjects.includes(builtObject)) {
        removeAt(galaxy.abandonedBuiltObjects, builtObject);
    }
    builtObject.empire = newEmpire;
    for (let i = 0; i < galaxy.empires.length; i++) {
        const empire = galaxy.empires[i];
        if (empire != null && empire.outlaws !== null && empire.outlaws.includes(builtObject)) removeAt(empire.outlaws, builtObject);
    }
    for (let j = 0; j < galaxy.pirateEmpires.length; j++) {
        const empire2 = galaxy.pirateEmpires[j];
        if (empire2 != null && empire2.outlaws !== null && empire2.outlaws.includes(builtObject)) removeAt(empire2.outlaws, builtObject);
    }
    if (actualEmpire !== null && actualEmpire.pirateEmpireBaseHabitat !== null && (newEmpire === null || newEmpire.pirateEmpireBaseHabitat === null) && builtObject.role === BuiltObjectRole.Base) {
        for (let k = 0; k < galaxy.empires.length; k++) {
            const empire3 = galaxy.empires[k];
            if (empire3.knownPirateBases.includes(builtObject)) removeAt(empire3.knownPirateBases, builtObject);
        }
    }
    if (newEmpire !== null) {
        clearAttackersFromEmpire(builtObject, newEmpire);
        if (builtObject.attackers !== null) builtObject.attackers.length = 0;
        builtObject.currentTarget = null;
        const mission = builtObjectMission(builtObject.mission);
        if (mission !== null) mission.clear();
        builtObject.revertMission = null;
        (builtObject.subsequentMissions as BuiltObjectMission[]).length = 0;
        cancelAllShipAttacksNonEnemiesBuiltObject(galaxy, newEmpire, builtObject);
        checkCancelIntelligenceMissionsWithTarget(galaxy, builtObject);
        if (actualEmpire !== null) {
            if (builtObject.owner === actualEmpire) {
                builtObject.owner = newEmpire;
                newEmpire.builtObjects.push(builtObject);
            } else {
                builtObject.owner = null;
                newEmpire.privateBuiltObjects.push(builtObject);
            }
        } else {
            const S = BuiltObjectSubRole;
            switch (builtObject.subRole) {
                case S.Escort:
                case S.Frigate:
                case S.Destroyer:
                case S.Cruiser:
                case S.CapitalShip:
                case S.TroopTransport:
                case S.Carrier:
                case S.ResupplyShip:
                case S.ExplorationShip:
                case S.ColonyShip:
                case S.ConstructionShip:
                case S.SmallSpacePort:
                case S.MediumSpacePort:
                case S.LargeSpacePort:
                case S.ResortBase:
                case S.GenericBase:
                case S.EnergyResearchStation:
                case S.WeaponsResearchStation:
                case S.HighTechResearchStation:
                case S.MonitoringStation:
                case S.DefensiveBase:
                    builtObject.owner = newEmpire;
                    newEmpire.builtObjects.push(builtObject);
                    break;
                case S.SmallFreighter:
                case S.MediumFreighter:
                case S.LargeFreighter:
                case S.GasMiningShip:
                case S.MiningShip:
                case S.GasMiningStation:
                case S.MiningStation:
                    builtObject.owner = null;
                    newEmpire.privateBuiltObjects.push(builtObject);
                    break;
            }
        }
        const design = cloneDesign(builtObject.design);
        design.empire = newEmpire;
        let design2: Design | null = null;
        for (let l = 0; l < newEmpire.designs.length; l++) {
            const design3 = newEmpire.designs[l];
            if (design3.isEquivalent(design) && design3.name === design.name) {
                design2 = design3;
                break;
            }
        }
        if (design2 === null) {
            design.buildCount = 1;
            if (setDesignAsObsolete) design.isObsolete = true;
            if (design.stance === BuiltObjectStance.AttackUnallied) design.stance = BuiltObjectStance.AttackEnemies;
            newEmpire.designs.push(design);
            builtObject.design = design;
        } else {
            design2.buildCount++;
            if (design2.stance === BuiltObjectStance.AttackUnallied) design2.stance = BuiltObjectStance.AttackEnemies;
            builtObject.design = design2;
        }
        if (newEmpire.pirateEmpireBaseHabitat === null) {
            builtObject.pirateEmpireId = 0;
        } else {
            builtObject.pirateEmpireId = newEmpire.empireId & 0xff;
            const S = BuiltObjectSubRole;
            switch (builtObject.subRole) {
                case S.SmallFreighter:
                case S.MediumFreighter:
                case S.LargeFreighter:
                case S.PassengerShip:
                case S.GasMiningShip:
                case S.MiningShip: {
                    const independent = galaxy.independentEmpire!;
                    builtObject.empire = independent;
                    if (!independent.privateBuiltObjects.includes(builtObject)) independent.privateBuiltObjects.push(builtObject);
                    if (newEmpire.privateBuiltObjects !== null && !newEmpire.privateBuiltObjects.includes(builtObject)) newEmpire.privateBuiltObjects.push(builtObject);
                    if (newEmpire.builtObjects !== null && newEmpire.builtObjects.includes(builtObject)) removeAt(newEmpire.builtObjects, builtObject);
                    break;
                }
            }
        }
    } else {
        builtObject.playerEmpireEncounterAction = BuiltObjectEncounterAction.Prompt;
        clearPreviousMissionRequirements(galaxy, builtObject);
        builtObject.owner = null;
        builtObject.empire = null;
        builtObject.pirateEmpireId = 0;
    }
    builtObject.reDefine();
    if (builtObject.fighters !== null && builtObject.fighters.length > 0) {
        if (newEmpire === null) {
            // Fighter.CompleteTeardown (Fighter.cs) — M4p.
            throw new Error('TODO(port) M4p: Fighter.CompleteTeardown for the fighters of a ship left without owner (Empire.1.cs 787)');
        }
        for (let n = 0; n < builtObject.fighters.length; n++) {
            const fighter = builtObject.fighters[n] as unknown as FighterOwnerLike;
            fighter.empire = newEmpire;
            fighter.owner = newEmpire;
        }
    }
    const chars = builtObject.characters as Character[] | null;
    if (chars !== null && chars.length > 0) {
        const array2 = chars.slice();
        for (const character of array2) character.kill(galaxy);
    }
    if (builtObject.troops !== null && builtObject.troops.count > 0) {
        if (newEmpire === galaxy.independentEmpire || newEmpire === null) {
            for (let num17 = 0; num17 < builtObject.troops.count; num17++) {
                const troop = builtObject.troops.items[num17];
                if (actualEmpire !== null) actualEmpire.troops.remove(troop);
                troop.empire = null;
                troop.colony = null;
                troop.builtObject = null;
            }
            builtObject.troops.clear();
        } else {
            for (let num18 = 0; num18 < builtObject.troops.count; num18++) {
                const troop2 = builtObject.troops.items[num18];
                if (actualEmpire !== null) actualEmpire.troops.remove(troop2);
                troop2.empire = newEmpire;
                newEmpire.troops.add(troop2);
            }
        }
    }
    if (builtObject.troopCapacity > 0 && newEmpire !== null && newEmpire.policy != null) builtObject.setTroopLoadoutsFromPolicy(newEmpire.policy);
    if (newEmpire !== null) {
        // BaconEmpire.DestroyUnreservedCargoOfEmpire(cargo, actualEmpire): empty body.
        takeOwnershipOfCargo(galaxy, builtObject.cargo, actualEmpire, newEmpire);
    }
    if (actualEmpire !== null) {
        if (newEmpire !== null) {
            takeOwnershipOfOrdersBuiltObject(galaxy, builtObject, actualEmpire, newEmpire);
        } else {
            if (builtObject.contractsToFulfill !== null && builtObject.contractsToFulfill.length > 0) checkCancelContracts(galaxy, builtObject);
            const orders = galaxy.orders.getOrdersForBuiltObject(builtObject).items.slice();
            if (orders.length > 0) {
                for (const item of orders) galaxy.orders.remove(item);
            }
            if (builtObject.cargo !== null) builtObject.cargo.clear();
        }
    }
    const queue = queueOf(builtObject);
    if (queue !== null && queue.constructionYards.length > 0) {
        for (let num19 = 0; num19 < queue.constructionYards.length; num19++) {
            const constructionYard = queue.constructionYards[num19];
            if (constructionYard.shipUnderConstruction !== null && constructionYard.shipUnderConstruction.empire === actualEmpire) {
                takeOwnershipOfBuiltObject(galaxy, self, constructionYard.shipUnderConstruction, newEmpire, setDesignAsObsolete);
            }
        }
        if (queue.constructionWaitQueue !== null) {
            for (let num20 = 0; num20 < queue.constructionWaitQueue.length; num20++) {
                const builtObject2 = queue.constructionWaitQueue[num20];
                takeOwnershipOfBuiltObject(galaxy, self, builtObject2, newEmpire, setDesignAsObsolete);
            }
        }
    }
    if (actualEmpire !== null) actualEmpire.visibility.resolveSystemVisibilityAt(builtObject.xpos, builtObject.ypos, null, null);
    if (newEmpire !== null) newEmpire.visibility.resolveSystemVisibilityAt(builtObject.xpos, builtObject.ypos, null, null);
    builtObject.isAutoControlled = true;
}

// ---------------------------------------------------------------------------------------------------------------
// Habitat.cs 7450 ClearColony
// ---------------------------------------------------------------------------------------------------------------

/** Habitat.cs 7445/7450 ClearColony(clearingEmpire[, sendMessages = true, removeEmpireWhenNoColonies = true]). No Rnd. */
export function clearColony(galaxy: Galaxy, habitat: Habitat, clearingEmpire: Empire | null, sendMessages = true, removeEmpireWhenNoColonies = true): void {
    const self = habitat;
    let num = -1;
    if (self.cargo !== null) self.cargo.clear();
    self.cargo = null;
    self.isRefuellingDepot = false;
    if (self.troops !== null && self.troops.count > 0) {
        for (let i = 0; i < self.troops.count; i++) {
            const troop = self.troops.items[i];
            const te = troopEmpire(troop);
            if (te !== null && te.counters !== null) te.counters.processTroopDestruction(troop);
            if (te !== null && te.troops != null) te.troops.remove(troop);
            troop.empire = null;
            troop.colony = null;
            troop.builtObject = null;
        }
        self.troops.clear();
    }
    if (self.troopsToRecruit !== null && self.troopsToRecruit.count > 0) {
        for (let j = 0; j < self.troopsToRecruit.count; j++) {
            const troop2 = self.troopsToRecruit.items[j];
            const te2 = troopEmpire(troop2);
            if (te2 !== null && te2.counters !== null) te2.counters.processTroopDestruction(troop2);
            if (te2 !== null && te2.troops != null) te2.troops.remove(troop2);
            troop2.empire = null;
            troop2.colony = null;
            troop2.builtObject = null;
        }
        self.troopsToRecruit.clear();
    }
    if (self.invadingTroops !== null && self.invadingTroops.count > 0) {
        for (let k = 0; k < self.invadingTroops.count; k++) {
            const troop3 = self.invadingTroops.items[k];
            const te3 = troopEmpire(troop3);
            if (te3 !== null && te3.troops != null) te3.troops.remove(troop3);
            troop3.empire = null;
            troop3.colony = null;
            troop3.builtObject = null;
        }
        self.invadingTroops.clear();
    }
    const chars = stellarObjectCharacters(self);
    if (chars !== null && chars.length > 0) {
        const array = chars.slice();
        for (let l = 0; l < array.length; l++) array[l].kill(galaxy);
    }
    const invChars = habitatInvadingCharacterList(self);
    if (invChars !== null && invChars.length > 0) {
        const array2 = invChars.slice();
        for (let m = 0; m < array2.length; m++) array2[m].kill(galaxy);
    }
    const queue = queueOf(self);
    if (queue !== null) {
        for (const constructionYard of queue.constructionYards) {
            if (constructionYard.shipUnderConstruction !== null) builtObjectCompleteTeardown(galaxy, constructionYard.shipUnderConstruction, true);
            constructionYard.shipUnderConstruction = null;
        }
    }
    const orders = galaxy.orders.getOrdersForHabitat(self).items.slice();
    if (orders.length > 0) {
        for (const item of orders) galaxy.orders.remove(item);
    }
    if (self.population != null) {
        if (self.population.items.length > 0) {
            for (let n = 0; n < self.population.items.length; n++) self.population.items[n].amount = 0;
            self.population.items.length = 0;
        }
        self.population.recalculateTotalAmount();
    }
    if (self.facilities !== null && self.facilities.length > 0) {
        for (let num2 = 0; num2 < self.facilities.length; num2++) checkRemoveFacilityTracking(self, self.facilities[num2]);
        self.facilities.length = 0;
    }
    if (self.empire !== null) {
        const empire0 = self.empire;
        num = empire0.colonies.indexOf(self);
        if (num >= 0) {
            empire0.colonies.splice(num, 1);
            if (empire0.capital === self) {
                empire0.capital = selectBestCandidateForCapital(empire0);
                recalculateColonyDistancesFromCapital(galaxy, empire0);
                if (empire0.colonies.length <= 0 && removeEmpireWhenNoColonies) {
                    if (empire0.pirateEmpireBaseHabitat !== null) {
                        if (checkPirateEmpireTerminated(galaxy, empire0)) eliminatePirateFaction(galaxy, empire0, clearingEmpire);
                    } else {
                        if (sendMessages) sendMessageToEmpire(empire0, empire0, EmpireMessageType.EmpireDefeated, empire0, getText('You have been defeated!'));
                        empireCompleteTeardown(galaxy, empire0, clearingEmpire, true, false);
                    }
                }
            }
        }
        if (self.empire !== galaxy.independentEmpire) {
            self.empire!.visibility.resolveSystemVisibilityAt(self.xpos, self.ypos, null, self);
            evaluateSystemLinks(galaxy, self.empire!);
        }
        const empire = self.empire;
        self.owner = null;
        self.empire = null;
        reviewPlanetaryFacilities(galaxy, self, empire);
    }
    galaxy.determineSystemInfo(galaxy.systems[self.systemIndex], galaxy.playerEmpire);
}

// ---------------------------------------------------------------------------------------------------------------
// Habitat.cs 2571 / BuiltObject.1.cs 70 ScanForNewOwner
// ---------------------------------------------------------------------------------------------------------------

/** Habitat.cs 2571 ScanForNewOwner(): a lost colony joins the empire of a ship within 500. No Rnd (TakeOwnershipOfColony draws none). */
export function scanForNewOwnerHabitat(galaxy: Galaxy, habitat: Habitat): void {
    const self = habitat;
    if (self.population == null || self.population.items.length <= 0 || self.population.totalAmount <= 0 || self.empire !== null) return;
    const builtObject = galaxy.findNearestBuiltObject(Math.trunc(self.xpos), Math.trunc(self.ypos), BuiltObjectRole.Undefined, false);
    if (builtObject === null || builtObject.empire === null || builtObject.empire.pirateEmpireBaseHabitat !== null || builtObject.empire === galaxy.independentEmpire || builtObject.empire.reclusive) return;
    const num = galaxy.calculateDistanceSquared(self.xpos, self.ypos, builtObject.xpos, builtObject.ypos);
    if (num < 250000.0) {
        checkForShipsDiscoveringRuins(galaxy, self);
        takeOwnershipOfColonyFull(galaxy, builtObject.empire, self, builtObject.empire, false, false);
        let text = '';
        if (builtObject.nearestSystemStar !== null) text = builtObject.nearestSystemStar.name;
        let text2 = formatText(
            getText('We have discovered a lost colony of RACE'),
            self.population.dominantRace!.name,
            resolveDescription(HabitatType as unknown as Record<number, string>, self.type).toLowerCase(),
            resolveDescription(HabitatCategoryType as unknown as Record<number, string>, self.category).toLowerCase(),
            self.name,
            text,
        );
        text2 = text2 + ' ' + getText('The inhabitants have welcomed us and we have claimed the colony for our empire.');
        sendEventMessageToEmpire(builtObject.empire, EventMessageType.LostColonyFound, getText('Lost Colony Found'), text2, self, self);
    }
}

/** Galaxy.5.cs 2971 SortBuiltObjectsByDistance(x, y, builtObjects): SortTag = distance², BuiltObjectList.Sort (by SortTag). */
function sortBuiltObjectsByDistance(galaxy: Galaxy, x: number, y: number, builtObjects: BuiltObject[]): BuiltObject[] {
    for (let i = 0; i < builtObjects.length; i++) builtObjects[i].sortTag = galaxy.calculateDistanceSquared(x, y, builtObjects[i].xpos, builtObjects[i].ypos);
    netSort(builtObjects, (a, b) => (a.sortTag < b.sortTag ? -1 : a.sortTag > b.sortTag ? 1 : 0));
    return builtObjects;
}

/**
 * BuiltObject.1.cs 65/70 ScanForNewOwner([preferredDiscoverer]): an abandoned ship / base is investigated by the nearest
 * non-independent ship within 500 (Galaxy.InvestigateAbandonedBuiltObject). Rnd: the investigation's draws.
 */
export function scanForNewOwnerBuiltObject(galaxy: Galaxy, builtObject: BuiltObject, preferredDiscoverer: BuiltObject | null = null): void {
    const self = builtObject;
    const threats = builtObjectThreats(self);
    if (self.empire !== null || self.damagedComponentCount !== 0 || self.unbuiltComponentCount !== 0 || threats === null) return;
    let builtObjectList: BuiltObject[] = [];
    for (let i = 0; i < threats.length; i++) {
        const t = threats[i];
        if (!isBuiltObject(t)) continue;
        if (self.empire !== null) break;
        const builtObject2 = t;
        if (builtObject2 === null || builtObject2.empire === null || builtObject2.empire === galaxy.independentEmpire || (builtObject2.warpSpeed > 0 && !(builtObject2.currentSpeed < builtObject2.warpSpeed))) continue;
        const num = galaxy.calculateDistance(self.xpos, self.ypos, builtObject2.xpos, builtObject2.ypos);
        if (num < 500.0) {
            // `_Galaxy.StoryClueLocations.Contains(this) && builtObject.Empire != PlayerEmpire` → skip: the story (deferred,
            // plan §0.3) places no clue locations in a normal game.
            builtObjectList.push(builtObject2);
        }
    }
    builtObjectList = sortBuiltObjectsByDistance(galaxy, self.xpos, self.ypos, builtObjectList);
    if (self.builtAt !== null) {
        let num2 = -1;
        for (let j = 0; j < builtObjectList.length; j++) {
            if (builtObjectList[j] != null && builtObjectList[j] === self.builtAt) {
                num2 = j;
                break;
            }
        }
        if (num2 >= 0) {
            const builtObject3 = builtObjectList[num2];
            if (builtObject3 != null) {
                builtObjectList.splice(num2, 1);
                builtObjectList.splice(0, 0, builtObject3);
            }
        }
    }
    if (preferredDiscoverer !== null) builtObjectList.splice(0, 0, preferredDiscoverer);
    for (let k = 0; k < builtObjectList.length; k++) {
        if (self.empire !== null) break;
        const builtObject3 = builtObjectList[k];
        let builtObjectEncounterAction = BuiltObjectEncounterAction.Notify;
        if (builtObject3.empire === galaxy.playerEmpire) {
            builtObjectEncounterAction = self.playerEmpireEncounterAction ?? BuiltObjectEncounterAction.Prompt;
            if (builtObjectEncounterAction !== BuiltObjectEncounterAction.Notify) self.playerEmpireEncounterAction = BuiltObjectEncounterAction.None;
        }
        switch (builtObjectEncounterAction) {
            case BuiltObjectEncounterAction.Prompt: {
                if (builtObject3.empire === galaxy.playerEmpire && galaxy.playerEmpire!.discoveryActionAbandonedShipBase > 0) {
                    investigateAbandonedBuiltObject(galaxy, builtObject3.empire, self);
                    break;
                }
                const flag2 = self.name.includes(getText('Refugee'));
                let arg = '';
                if (builtObject3.nearestSystemStar !== null) arg = builtObject3.nearestSystemStar.name;
                let empty = !flag2
                    ? formatText(getText('We have encountered an abandoned SHIPTYPE'), resolveDescription(BuiltObjectSubRole as unknown as Record<number, string>, self.subRole), arg)
                    : formatText(getText('We have encountered a refugee SHIPTYPE'), resolveDescription(BuiltObjectSubRole as unknown as Record<number, string>, self.subRole), arg);
                empty += '.\n\n';
                if (self.encounterDescription != null && self.encounterDescription !== '') {
                    empty += self.encounterDescription;
                    empty += '\n\n';
                }
                let text = getText('Abandoned Ship Encountered');
                if (self.role === BuiltObjectRole.Base) {
                    empty += getText('Should we investigate the base?');
                    text = getText('Abandoned Base Encountered');
                } else {
                    empty += getText('Should we investigate the ship?');
                }
                sendEventMessageToEmpire(builtObject3.empire!, EventMessageType.EncounterBuiltObject, text, empty, self, self);
                break;
            }
            case BuiltObjectEncounterAction.Notify:
                if (builtObject3.empire !== null && !builtObject3.empire.reclusive) investigateAbandonedBuiltObject(galaxy, builtObject3.empire, self);
                break;
            default:
                break;
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Galaxy.5.cs 5240 InvestigateAbandonedBuiltObject (+ navigational hints)
// ---------------------------------------------------------------------------------------------------------------

/** Galaxy.5.cs 4815 GenerateLocationDescription(x, y) — text only (TODO(port) M9: the nearest-habitat description). */
function generateLocationDescription(galaxy: Galaxy, x: number, y: number): string {
    return resolveSectorDescription(galaxy, x, y);
}

/** Galaxy.5.cs 4689 FindNearestUnknownIndependentColony(x, y, empire). No Rnd. */
function findNearestUnknownIndependentColony(galaxy: Galaxy, x: number, y: number, empire: Empire): Habitat | null {
    let result: Habitat | null = null;
    let num = Number.MAX_VALUE;
    for (let i = 0; i < galaxy.independentColonies.length; i++) {
        const habitat = galaxy.independentColonies[i];
        if (habitat != null && habitat.empire === galaxy.independentEmpire && !empire.visibility.checkSystemExplored(habitat.systemIndex)) {
            const num2 = galaxy.calculateDistanceSquared(x, y, habitat.xpos, habitat.ypos);
            if (num2 < num) {
                num = num2;
                result = habitat;
            }
        }
    }
    return result;
}

/** Galaxy.5.cs 4749 FindNearestUnknownRuin(x, y, empire). No Rnd. */
function findNearestUnknownRuin(galaxy: Galaxy, x: number, y: number, empire: Empire): Habitat | null {
    let result: Habitat | null = null;
    let num = Number.MAX_VALUE;
    for (let i = 0; i < galaxy.ruinsHabitats.length; i++) {
        const habitat = galaxy.ruinsHabitats[i];
        if (habitat != null && habitat.ruin !== null && (habitat.empire === null || habitat.empire === galaxy.independentEmpire) && !empire.visibility.checkSystemExplored(habitat.systemIndex)) {
            const num2 = galaxy.calculateDistanceSquared(x, y, habitat.xpos, habitat.ypos);
            if (num2 < num) {
                num = num2;
                result = habitat;
            }
        }
    }
    return result;
}

/** Galaxy.5.cs 4782 FindNearestUnownedBuiltObject(x, y). No Rnd. */
function findNearestUnownedBuiltObject(galaxy: Galaxy, x: number, y: number): BuiltObject | null {
    let result: BuiltObject | null = null;
    let num = Number.MAX_VALUE;
    for (let i = 0; i < galaxy.abandonedBuiltObjects.length; i++) {
        const builtObject = galaxy.abandonedBuiltObjects[i];
        if (builtObject != null && builtObject.unbuiltOrDamagedComponentCount <= 0) {
            const num2 = galaxy.calculateDistanceSquared(x, y, builtObject.xpos, builtObject.ypos);
            if (num2 < num) {
                result = builtObject;
                num = num2;
            }
        }
    }
    return result;
}

/** Galaxy.8.cs 2828 FindNearestPirateFactionBaseUnknown(empire, x, y, pirateFactionToExclude). No Rnd. */
function findNearestPirateFactionBaseUnknown(galaxy: Galaxy, empire: Empire, x: number, y: number, pirateFactionToExclude: Empire | null): Empire | null {
    let num = Number.MAX_VALUE;
    let result: Empire | null = null;
    const empireList: (Empire | null)[] = [];
    for (let i = 0; i < empire.knownPirateBases.length; i++) {
        const builtObject = empire.knownPirateBases[i];
        if (!empireList.includes(builtObject.empire)) empireList.push(builtObject.empire);
    }
    for (let j = 0; j < galaxy.pirateEmpires.length; j++) {
        const empire2 = galaxy.pirateEmpires[j];
        if (empire2 == null || empire2.pirateEmpireBaseHabitat === null || empire2.builtObjects == null || empireList.includes(empire2) || (pirateFactionToExclude !== null && empire2 === pirateFactionToExclude)) continue;
        const num2 = galaxy.calculateDistanceSquared(x, y, empire2.pirateEmpireBaseHabitat.xpos, empire2.pirateEmpireBaseHabitat.ypos);
        if (!(num2 < num)) continue;
        let flag = false;
        for (let k = 0; k < empire2.builtObjects.length; k++) {
            const b = empire2.builtObjects[k];
            if (b != null && (b.subRole === BuiltObjectSubRole.GenericBase || b.subRole === BuiltObjectSubRole.SmallSpacePort || b.subRole === BuiltObjectSubRole.MediumSpacePort || b.subRole === BuiltObjectSubRole.LargeSpacePort)) {
                flag = true;
                break;
            }
        }
        if (flag) {
            result = empire2;
            num = num2;
        }
    }
    return result;
}

/** Galaxy.5.cs 4857 GenerateNavigationalBonusMessage(x, y, empire). Rnd: Next(0, 11). */
function generateNavigationalBonusMessage(galaxy: Galaxy, x: number, y: number, empire: Empire): string {
    let text = '';
    switch (galaxy.rnd.next(0, 11)) {
        case 0:
        case 1:
        case 2: {
            const habitat = findNearestUnknownRuin(galaxy, x, y, empire);
            if (habitat !== null) {
                text += generateLocationDescription(galaxy, habitat.xpos, habitat.ypos);
                if (empire === galaxy.playerEmpire) addLocationHint(galaxy.playerEmpire, { x: Math.trunc(habitat.xpos), y: Math.trunc(habitat.ypos) });
            }
            break;
        }
        case 3:
        case 4: {
            const builtObject = findNearestUnownedBuiltObject(galaxy, x, y);
            if (builtObject !== null) {
                text += generateLocationDescription(galaxy, builtObject.xpos, builtObject.ypos);
                if (empire === galaxy.playerEmpire) addLocationHint(galaxy.playerEmpire, { x: Math.trunc(builtObject.xpos), y: Math.trunc(builtObject.ypos) });
            }
            break;
        }
        case 5:
        case 6: {
            const habitat2 = findNearestUnknownIndependentColony(galaxy, x, y, empire);
            if (habitat2 !== null) {
                text += generateLocationDescription(galaxy, habitat2.xpos, habitat2.ypos);
                if (empire === galaxy.playerEmpire) addLocationHint(galaxy.playerEmpire, { x: Math.trunc(habitat2.xpos), y: Math.trunc(habitat2.ypos) });
            }
            break;
        }
        case 7:
        case 8: {
            const empire2 = findNearestPirateFactionBaseUnknown(galaxy, empire, x, y, null);
            if (empire2 !== null && empire2.pirateEmpireBaseHabitat !== null) {
                text += generateLocationDescription(galaxy, empire2.pirateEmpireBaseHabitat.xpos, empire2.pirateEmpireBaseHabitat.ypos);
                if (empire === galaxy.playerEmpire) addLocationHint(galaxy.playerEmpire, { x: Math.trunc(empire2.pirateEmpireBaseHabitat.xpos), y: Math.trunc(empire2.pirateEmpireBaseHabitat.ypos) });
            }
            break;
        }
        case 9:
        case 10: {
            const galaxyLocationList = [];
            for (let i = 0; i < galaxy.galaxyLocations.length; i++) {
                const galaxyLocation = galaxy.galaxyLocations[i];
                if (
                    galaxyLocation != null &&
                    (galaxyLocation.type === GalaxyLocationType.DebrisField ||
                        galaxyLocation.type === GalaxyLocationType.PlanetDestroyer ||
                        (galaxyLocation.type === GalaxyLocationType.RestrictedArea && galaxyLocation.name !== formatText(getText('NAME Weapons Testing Range'), 'Pozdac') && galaxyLocation.name !== getText('Dead Zone')))
                ) {
                    galaxyLocationList.push(galaxyLocation);
                }
            }
            for (const item of galaxyLocationList) {
                if (!empire.visibility.knownGalaxyLocations.includes(item)) {
                    text += generateLocationDescription(galaxy, item.xpos, item.ypos);
                    if (empire === galaxy.playerEmpire) {
                        addLocationHint(galaxy.playerEmpire, { x: Math.trunc(item.xpos + item.width / 2.0), y: Math.trunc(item.ypos + item.height / 2.0) });
                    }
                    return text;
                }
            }
            return text;
        }
    }
    return text;
}

/**
 * Galaxy.5.cs 5240 InvestigateAbandonedBuiltObject(investigatingEmpire, abandonedBuiltObject). Rnd: InflictDamage draws
 * (Explodes / fallback), the ambush mission's AssignMission, the Acquire case's research breakthroughs
 * (SelectRandomNextResearchProjectExcludeSuperWeapons) and, for the player, Next(0, 2) + GenerateNavigationalBonusMessage.
 */
export function investigateAbandonedBuiltObject(galaxy: Galaxy, investigatingEmpire: Empire | null, abandonedBuiltObject: BuiltObject): void {
    if (investigatingEmpire === null) return;
    let empty = '';
    let text = getText('Ship');
    if (abandonedBuiltObject.role === BuiltObjectRole.Base) text = getText('Base');
    const time = galaxyNow(galaxy);
    const eventType = abandonedBuiltObject.encounterEventType ?? BuiltObjectEncounterEventType.Acquire;
    let explodes = eventType === BuiltObjectEncounterEventType.Explodes;
    if (eventType === BuiltObjectEncounterEventType.PirateAmbush) {
        const empire = findNearestPirateFaction(galaxy, abandonedBuiltObject.xpos, abandonedBuiltObject.ypos, null, false);
        if (empire !== null) {
            empty = formatText(getText('Abandoned Ship Pirate Ambush'), text.toLowerCase(), empire.name);
            takeOwnershipOfBuiltObject(galaxy, empire, abandonedBuiltObject, empire);
            abandonedBuiltObject.isAutoControlled = true;
            const builtObject2 = galaxy.findNearestBuiltObjectOfEmpire(Math.trunc(abandonedBuiltObject.xpos), Math.trunc(abandonedBuiltObject.ypos), investigatingEmpire);
            if (builtObject2 !== null) {
                let missionType = BuiltObjectMissionType.Attack;
                if (empire !== null) missionType = determineDestroyOrCaptureTarget(galaxy, empire, abandonedBuiltObject, builtObject2, false);
                assignMission(galaxy, abandonedBuiltObject, missionType, builtObject2, null, BuiltObjectMissionPriority.High);
                sendEventMessageToEmpire(investigatingEmpire, EventMessageType.PirateAmbush, getText('Pirate Ambush') + '!', empty, abandonedBuiltObject, abandonedBuiltObject);
            }
            return;
        }
        // goto case Explodes.
        explodes = true;
    }
    if (explodes) {
        empty = formatText(getText('Abandoned Ship Explodes'), text.toLowerCase());
        inflictDamageFull(galaxy, abandonedBuiltObject, abandonedBuiltObject, null, 100000.0, time, 0, false, -Number.MAX_VALUE, false);
        const builtObject = galaxy.findNearestBuiltObjectOfEmpire(Math.trunc(abandonedBuiltObject.xpos), Math.trunc(abandonedBuiltObject.ypos), investigatingEmpire);
        if (builtObject !== null) {
            let num2 = 300;
            let text8 = getText('Abandoned Ship Explodes Shields');
            if (builtObject.currentShields < num2) {
                text8 = getText('Abandoned Ship Explodes Damage');
                builtObject.currentShields = 0;
                num2 = 40;
            }
            empty += text8;
            inflictDamageFull(galaxy, builtObject, builtObject, null, num2, time, 0, false, -Number.MAX_VALUE, false);
            sendEventMessageToEmpire(investigatingEmpire, EventMessageType.BuiltObjectExplodes, formatText(getText('SHIPBASE Explodes'), text), empty, abandonedBuiltObject, abandonedBuiltObject);
        }
        return;
    }
    // case Acquire.
    let flag = false;
    if (abandonedBuiltObject.name.toLowerCase().includes(getText('Refugee').toLowerCase())) flag = true;
    const text2 = '';
    // investigatingEmpire == PlayerEmpire && !flag && StoryDistantWorldsEnabled → GenerateStoryClue: the story is deferred
    // (plan §0.3) and off in a normal game, so text2 stays empty.
    takeOwnershipOfBuiltObject(galaxy, investigatingEmpire, abandonedBuiltObject, investigatingEmpire, true);
    abandonedBuiltObject.supportCostFactor = 0.5;
    abandonedBuiltObject.isAutoControlled = true;
    // GameEventId >= 0 && CheckTriggerEvent(Investigate): scripted game events are deferred; abandoned ships carry none.
    if (abandonedBuiltObject.gameEventId >= 0) throw new Error('TODO(port) deferred game events: CheckTriggerEvent(Investigate) (Galaxy.5.cs 5305)');
    const text3 = generateLocationDescription(galaxy, abandonedBuiltObject.xpos, abandonedBuiltObject.ypos);
    empty = !flag
        ? formatText(getText('Abandoned Ship Acquire Intro'), resolveDescription(BuiltObjectSubRole as unknown as Record<number, string>, abandonedBuiltObject.subRole), abandonedBuiltObject.name, text3)
        : formatText(getText('Abandoned Ship Acquire Intro Refugee'), resolveDescription(BuiltObjectSubRole as unknown as Record<number, string>, abandonedBuiltObject.subRole), text3);
    if (flag) empty = empty + '. ' + getText('Abandoned Ship Acquire Transfer Refugee');
    else empty = empty + '. ' + getText('Abandoned Ship Acquire Transfer');
    if (abandonedBuiltObject.role === BuiltObjectRole.Military && investigatingEmpire === galaxy.playerEmpire) {
        const num = resolveTechBonusFactor(investigatingEmpire, galaxy, abandonedBuiltObject);
        if (num > 1.0) empty = empty + '\n\n' + getText('Abandoned Ship Acquire Tech Bonus');
    }
    const governmentTypeId = abandonedBuiltObject.encounterGovernmentTypeId ?? 255;
    if (governmentTypeId < 255) {
        const governmentAttributes = getGovernmentsStatic()[governmentTypeId];
        if (investigatingEmpire.allowableGovernmentTypes.includes(governmentTypeId)) {
            empty += '\n\n' + formatText(getText('Abandoned Ship Acquire Government Existing'), text.toLowerCase(), governmentAttributes?.name ?? '');
            empty += '\n\n' + getText('Ruins Secret Form of Government Revealed Adoption');
        } else {
            empty += '\n\n' + formatText(getText('Abandoned Ship Acquire Government'), text.toLowerCase(), governmentAttributes?.name ?? '');
            empty += '\n\n' + getText('Ruins Secret Form of Government Revealed Adoption');
            investigatingEmpire.allowableGovernmentTypes.push(governmentTypeId);
        }
        abandonedBuiltObject.encounterGovernmentTypeId = 255;
    }
    const explorationBonus = abandonedBuiltObject.encounterExplorationBonus ?? 0;
    if (explorationBonus > 0) {
        const encounterExplorationBonus = explorationBonus;
        abandonedBuiltObject.encounterExplorationBonus = 0;
        for (let i = 0; i < encounterExplorationBonus; i++) {
            const habitat = fastFindNearestUnexploredHabitat(galaxy, abandonedBuiltObject.xpos, abandonedBuiltObject.ypos, investigatingEmpire);
            if (habitat === null) break;
            const sv = investigatingEmpire.visibility.systemVisibility[habitat.systemIndex];
            sv.totallyExplored = true;
            if (investigatingEmpire.resourceMap != null) {
                const sys = galaxy.systems[habitat.systemIndex];
                for (let j = 0; j < sys.habitats.length; j++) investigatingEmpire.resourceMap.setResourcesKnown(sys.habitats[j], true);
                if (sys.systemStar != null) investigatingEmpire.resourceMap.setResourcesKnown(sys.systemStar, true);
            }
            const status = sv.status;
            if (status === SystemVisibilityStatus.Unexplored || status === SystemVisibilityStatus.Undefined) sv.status = SystemVisibilityStatus.Explored;
        }
        empty += '\n\n' + formatText(getText('Abandoned Ship Acquire Maps'), text.toLowerCase(), String(encounterExplorationBonus));
    }
    const moneyBonus = abandonedBuiltObject.encounterMoneyBonus ?? 0;
    if (moneyBonus > 0) {
        investigatingEmpire.stateMoney += moneyBonus;
        pirateEconomyPerformIncome(galaxy, investigatingEmpire, moneyBonus, PirateIncomeType.Undefined, galaxyStarDate(galaxy));
        empty += '\n\n' + formatText(getText('Abandoned Ship Acquire Money'), text.toLowerCase(), String(moneyBonus));
        abandonedBuiltObject.encounterMoneyBonus = 0;
    }
    const techAdvanceCount = abandonedBuiltObject.encounterTechAdvanceCount ?? 0;
    if (techAdvanceCount > 0) {
        if (techAdvanceCount === 1) {
            const researchNode = selectRandomNextResearchProjectExcludeSuperWeapons(galaxy, investigatingEmpire);
            if (researchNode !== null) {
                doResearchBreakthrough(galaxy, investigatingEmpire, researchNode, true, true, true);
                investigatingEmpire.research.update(investigatingEmpire.dominantRace);
                reviewDesignsBuiltObjectsImprovedComponents(investigatingEmpire);
                investigatingEmpire.reviewResearchAbilities();
                empty += '\n\n' + formatText(getText('Abandoned Ship Acquire Tech'), text.toLowerCase(), researchNode.def.name);
            }
        } else {
            empty += '\n\n' + formatText(getText('Abandoned Ship Acquire Tech Multiple'), text.toLowerCase());
            for (let k = 0; k < techAdvanceCount; k++) {
                const researchNode2 = selectRandomNextResearchProjectExcludeSuperWeapons(galaxy, investigatingEmpire);
                if (researchNode2 !== null) {
                    doResearchBreakthrough(galaxy, investigatingEmpire, researchNode2, true, true, false);
                    empty = empty + researchNode2.def.name + ', ';
                }
            }
            investigatingEmpire.research.update(investigatingEmpire.dominantRace);
            reviewDesignsBuiltObjectsImprovedComponents(investigatingEmpire);
            investigatingEmpire.reviewResearchAbilities();
            empty = empty.substring(0, empty.length - 2);
        }
        abandonedBuiltObject.encounterTechAdvanceCount = 0;
    }
    if (text2 === '' && investigatingEmpire === galaxy.playerEmpire && !flag) {
        // CheckForStoryLocationHint(): StoryCluesEnabled is off in a normal game (story deferred) → empty.
        const text5 = '';
        if (text5 !== '') {
            empty += text5;
        } else if (!flag && galaxy.rnd.next(0, 2) === 1) {
            const text6 = generateNavigationalBonusMessage(galaxy, abandonedBuiltObject.xpos, abandonedBuiltObject.ypos, investigatingEmpire);
            if (text6 !== '') {
                empty += '\n\n*** ' + formatText(getText('Abandoned Ship Acquire NAVIGATIONAL DIRECTIONS'), text.toLowerCase()) + ' ' + text6 + '. ***\n\n';
                empty += getText('Maybe we should send a ship to investigate this location.');
            }
        }
    }
    if (abandonedBuiltObject.subRole === BuiltObjectSubRole.ColonyShip && abandonedBuiltObject.nativeRace !== null) {
        // GenerateRaceReport (text): TODO(port) M9.
        empty += '\n\n' + formatText(getText('Abandoned Ship Acquire Colony Ship'), abandonedBuiltObject.nativeRace.name);
    }
    if (flag) {
        sendMessageToEmpire(investigatingEmpire, investigatingEmpire, EmpireMessageType.ExplorationBuiltObject, abandonedBuiltObject, empty);
        return;
    }
    let text7 = getText('Abandoned Ship Acquired');
    if (abandonedBuiltObject.role === BuiltObjectRole.Base) text7 = getText('Abandoned Base Acquired');
    if ((abandonedBuiltObject.playerEmpireEncounterAction ?? BuiltObjectEncounterAction.Prompt) === BuiltObjectEncounterAction.Notify) {
        sendMessageToEmpire(investigatingEmpire, investigatingEmpire, EmpireMessageType.ExplorationBuiltObject, abandonedBuiltObject, empty);
    } else {
        sendEventMessageToEmpire(investigatingEmpire, EventMessageType.FreeSuperShip, text7, empty, abandonedBuiltObject, abandonedBuiltObject);
    }
    abandonedBuiltObject.playerEmpireEncounterAction = BuiltObjectEncounterAction.None;
}
