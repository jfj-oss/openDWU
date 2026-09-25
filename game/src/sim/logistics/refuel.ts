// M4e — refuelling.
//
// Ports:
//   BuiltObject.cs 4697 CheckForFuelOrdering, 4774 SetupRefuelling, 4904 DetermineFuelRequired(setFuelLevelToZero),
//   4923 CheckBaseCargoForFuel, 4940 CheckForRefuelling(useCachedRefuellingLocation)
//   BuiltObject.2.cs 4706 AutoRefuelRepairShip(useCachedRefuellingLocation)
//   BuiltObject.2.cs 7029 CheckCancelRefuelData, 7097 InitiateRefuelData(refuelLocation) (the _Refuel* reservation data)
//   Empire.6.cs 2254 PurchaseStateFuel / 2267 PurchasePrivateFuel, Empire.cs 2336 ThisYearsPrivateFuelCosts
//   BaconBuiltObject.cs 4620 CheckForNegativeRefueling, 4685 GetCargoIndex (read by case Refuel, cmdDocking.ts)
// CheckRefuelLocationRangeAcceptable (BuiltObject.cs 4856), CalculateRefuellingPortion and the refuelling-point searches
// are M4c's (movement.ts).
// Rnd: none in these bodies (the refuelling-point searches and AssignMission draw inside their owners).

import type { Galaxy } from '../galaxy';
import type { BuiltObject } from '../builtObject';
import type { Habitat } from '../types';
import type { Creature } from '../creature';
import type { Empire } from '../empire';
import { ResourceRef } from '../cargo';
import { BuiltObjectSubRole } from '../builtObjectTypes';
import { BuiltObjectRole } from '../data/designSpecifications';
import { galaxyResourceCurrentPrices } from '../design';
import { getPrivateFunds } from '../forceStructure';
import { EmpireMessageType, sendMessageToEmpire } from '../messages';
import { gameText } from '../colonyTick';
import { resolveSubRoleDescription } from '../designGeneration';
import { REAL_SECONDS_IN_GALACTIC_YEAR } from '../galaxyTime';
import { galaxyStarDate } from '../tick/simTime';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, builtObjectMission, isBuiltObject, isHabitat, type BuiltObjectMission, type StellarObject } from '../missions/mission';
import { assignMission } from '../missions/assign';
import { assignRepairMission } from '../construction/repair';
import {
    calculateFuelPortionMarginFromRefuellingPoint,
    calculateRefuellingPortion,
    calculateRefuellingPortionAt,
    checkRefuelLocationRangeAcceptable,
    fastFindNearestRefuellingPoint,
    MINIMUM_LEVEL_FOR_REFUELLING_POINT,
    ultraFastFindNearestRefuellingLocation,
    type FuelTypeRef,
} from '../movement';
import { cargoAvailable, cargoGetCargo, cargoIndexOf, cargoIndexOfById, cargoRemove, empireCreateOrder, OrderType } from './orders';

/** Galaxy.3.cs 4986 RefuelRate = 40. */
export const REFUEL_RATE = 40;

/** HabitatResourceList.IndexOf(byte resourceID, int startIndex). */
function habitatResourceIndexOf(habitat: Habitat, resourceId: number, startIndex: number): number {
    for (let i = startIndex; i < habitat.resources.length; i++) {
        if (habitat.resources[i].resourceId === resourceId) return i;
    }
    return -1;
}

// ---------------------------------------------------------------------------------------------------------------
// Refuel reservation data (BuiltObject.2.cs 7029-7130)
// ---------------------------------------------------------------------------------------------------------------

/** BuiltObject.2.cs 7029 CheckCancelRefuelData: releases the fuel reserved at the refuelling point. */
export function checkCancelRefuelData(galaxy: Galaxy, builtObject: BuiltObject): boolean {
    let result = false;
    const refuelAmount = builtObject.refuelAmount;
    const refuelLocationId = builtObject.refuelLocationId;
    const refuelResourceId = builtObject.refuelResourceId;
    const refuelLocationIsBuiltObject = builtObject.refuelLocationIsBuiltObject;
    builtObject.refuelAmount = 0;
    builtObject.refuelLocationId = -1;
    builtObject.refuelResourceId = 255;
    // 7039: ... && refuelResourceId < Galaxy.ResourceSystemStatic.Resources.Count.
    if ((refuelAmount > 0 || refuelLocationId >= 0) && refuelResourceId >= 0 && refuelResourceId < 255 && refuelResourceId < galaxy.resourceSystem.resources.length) {
        if (refuelLocationIsBuiltObject) {
            // 7043 _Galaxy.BuiltObjects.FindBuiltObjectById(refuelLocationId) (BuiltObjectList.cs 276: first match).
            let builtObject2: BuiltObject | null = null;
            for (let i = 0; i < galaxy.builtObjects.length; i++) {
                const b = galaxy.builtObjects[i];
                if (b != null && b.builtObjectID === refuelLocationId) {
                    builtObject2 = b;
                    break;
                }
            }
            if (builtObject2 !== null && !builtObject2.hasBeenDestroyed && builtObject2.cargo !== null && builtObject2.empire !== null) {
                const num = cargoIndexOfById(builtObject2.cargo, refuelResourceId, builtObject2.empire.empireId);
                if (num >= 0) {
                    const cargo = builtObject2.cargo.items[num];
                    if (cargo != null) {
                        if (cargo.reserved >= refuelAmount) {
                            cargo.reserved -= refuelAmount;
                        } else {
                            cargo.reserved = 0;
                        }
                        result = true;
                    }
                }
            }
        } else {
            let habitat: Habitat | null = null;
            if (refuelLocationId >= 0 && refuelLocationId < galaxy.habitats.length) {
                habitat = galaxy.habitats[refuelLocationId];
            }
            if (habitat !== null && !habitat.hasBeenDestroyed && habitat.cargo !== null && habitat.empire !== null) {
                const num2 = cargoIndexOfById(habitat.cargo, refuelResourceId, habitat.empire.empireId);
                if (num2 >= 0) {
                    const cargo2 = habitat.cargo.items[num2];
                    if (cargo2 != null) {
                        if (cargo2.reserved >= refuelAmount) {
                            cargo2.reserved -= refuelAmount;
                        } else {
                            cargo2.reserved = 0;
                        }
                        result = true;
                    }
                }
            }
        }
    }
    return result;
}

/** BuiltObject.2.cs 7097 InitiateRefuelData(refuelLocation) → the reserved fuel amount. */
export function initiateRefuelData(galaxy: Galaxy, builtObject: BuiltObject, refuelLocation: BuiltObject | Habitat | Creature): number {
    checkCancelRefuelData(galaxy, builtObject);
    // StellarObject.Cargo / Empire (a Creature has neither).
    const location = isBuiltObject(refuelLocation) || isHabitat(refuelLocation) ? refuelLocation : null;
    if (location !== null && location.cargo !== null && location.empire !== null && builtObject.empire !== null && builtObject.fuelType !== null) {
        const num = cargoIndexOfById(location.cargo, builtObject.fuelType.resourceId, location.empire.empireId);
        if (num >= 0) {
            const cargo = location.cargo.items[num];
            if (cargo != null && cargoAvailable(cargo) > 0) {
                const num2 = Math.min(cargoAvailable(cargo), builtObject.fuelCapacity);
                cargo.reserved += num2;
                builtObject.refuelResourceId = builtObject.fuelType.resourceId;
                // 7113 _RefuelAmount = (short)num2.
                builtObject.refuelAmount = (num2 << 16) >> 16;
                if (isBuiltObject(location)) {
                    builtObject.refuelLocationId = location.builtObjectID;
                    builtObject.refuelLocationIsBuiltObject = true;
                } else {
                    builtObject.refuelLocationId = location.habitatIndex;
                    builtObject.refuelLocationIsBuiltObject = false;
                }
                return num2;
            }
        }
    }
    return 0;
}

// ---------------------------------------------------------------------------------------------------------------
// Fuel purchases (Empire.6.cs 2254-2278)
// ---------------------------------------------------------------------------------------------------------------

/** Empire.6.cs 2254 PurchaseStateFuel(fuelCost). */
export function purchaseStateFuel(galaxy: Galaxy, empire: Empire, fuelCost: number): void {
    const currentStarDate = galaxyStarDate(galaxy);
    const num = currentStarDate % (REAL_SECONDS_IN_GALACTIC_YEAR * 1000);
    const num2 = currentStarDate - num;
    if (empire.dateOfLastStateFuelCost < num2) {
        empire.thisYearsStateFuelCosts = 0.0;
    }
    empire.dateOfLastStateFuelCost = currentStarDate;
    empire.thisYearsStateFuelCosts += fuelCost;
}

/** Empire.6.cs 2267 PurchasePrivateFuel(fuelCost). */
export function purchasePrivateFuel(galaxy: Galaxy, empire: Empire, fuelCost: number): void {
    const currentStarDate = galaxyStarDate(galaxy);
    const num = currentStarDate % (REAL_SECONDS_IN_GALACTIC_YEAR * 1000);
    const num2 = currentStarDate - num;
    if (empire.dateOfLastPrivateFuelCost < num2) {
        empire.thisYearsPrivateFuelCostsValue = 0.0;
    }
    empire.dateOfLastPrivateFuelCost = currentStarDate;
    empire.thisYearsPrivateFuelCostsValue += fuelCost;
}

/** Empire.ThisYearsPrivateFuelCosts (Empire.cs 2336: _ThisYearsPrivateFuelCosts, accumulated by PurchasePrivateFuel). */
export function thisYearsPrivateFuelCosts(galaxy: Galaxy, empire: Empire): number {
    void galaxy;
    return empire.thisYearsPrivateFuelCostsValue;
}

// ---------------------------------------------------------------------------------------------------------------
// Bacon helpers read by case Refuel
// ---------------------------------------------------------------------------------------------------------------

/** BaconBuiltObject.cs 4620 CheckForNegativeRefueling(ship, refuelAmount). */
export function checkForNegativeRefueling(ship: BuiltObject, refuelAmount: number): number {
    void ship;
    if (refuelAmount < 0) {
        refuelAmount = 0;
    }
    return refuelAmount;
}

/**
 * BaconBuiltObject.cs 4685 GetCargoIndex(dockingShip): the index of the ship's fuel in its dock's cargo, owned by the
 * dock's Empire (ActualEmpire for a BuiltObject dock), or -1.
 */
export function getCargoIndex(dockingShip: BuiltObject | null): number {
    const num = -1;
    if (dockingShip === null || dockingShip.dockedAt === null || dockingShip.dockedAt.cargo === null || dockingShip.dockedAt.cargo.items.length < 1) {
        return num;
    }
    const dockedAt = dockingShip.dockedAt;
    const cargo = dockedAt.cargo!;
    // CargoList.IndexOf(Resource, Empire) → IndexOf(resource, empireId): a null resource gives -1 (CargoList.cs 740).
    const fuelType = dockingShip.fuelType;
    if (fuelType === null) return -1;
    return !isBuiltObject(dockedAt) ? cargoIndexOf(cargo, fuelType.resourceId, dockedAt.empire) : cargoIndexOf(cargo, fuelType.resourceId, dockedAt.actualEmpire);
}

// ---------------------------------------------------------------------------------------------------------------
// Fuel ordering / refuelling decisions (BuiltObject.cs 4697-5094)
// ---------------------------------------------------------------------------------------------------------------

/** BuiltObject.cs 4697 CheckForFuelOrdering (space ports keep fuel stocked). */
export function checkForFuelOrdering(galaxy: Galaxy, builtObject: BuiltObject): void {
    const empire = builtObject.empire;
    if (empire === null || empire === galaxy.independentEmpire || empire.pirateEmpireBaseHabitat !== null || (builtObject.subRole !== BuiltObjectSubRole.SmallSpacePort && builtObject.subRole !== BuiltObjectSubRole.MediumSpacePort && builtObject.subRole !== BuiltObjectSubRole.LargeSpacePort)) {
        return;
    }
    let num = MINIMUM_LEVEL_FOR_REFUELLING_POINT * 4;
    if (builtObject.subRole === BuiltObjectSubRole.LargeSpacePort) {
        num *= 3;
    }
    if (builtObject.subRole === BuiltObjectSubRole.MediumSpacePort) {
        num *= 2;
    }
    const orders = galaxy.orders.getOrdersForBuiltObject(builtObject);
    if (builtObject.parentHabitat !== null) {
        const orders2 = galaxy.orders.getOrdersForHabitat(builtObject.parentHabitat);
        if (orders2.count > 0) {
            orders.addRange(orders2);
        }
    }
    const fuelResources = galaxy.resourceSystem.fuelResources;
    for (let i = 0; i < fuelResources.length; i++) {
        const resourceDefinition = fuelResources[i];
        if (resourceDefinition == null) {
            continue;
        }
        let num2 = 0;
        let resource = new ResourceRef(resourceDefinition.resourceId);
        let num3 = -1;
        if (builtObject.cargo !== null) {
            num3 = cargoIndexOf(builtObject.cargo, resource.resourceId, empire);
        }
        if (num3 >= 0) {
            if (cargoAvailable(builtObject.cargo!.items[num3]) < num) {
                num2 = num + (num - Math.max(0, cargoAvailable(builtObject.cargo!.items[num3])));
            }
        } else {
            num2 = num * 2;
        }
        for (let num4 = orders.indexOfResourceId(resourceDefinition.resourceId, 0); num4 >= 0; num4 = orders.indexOfResourceId(resourceDefinition.resourceId, num4 + 1)) {
            num2 -= orders.at(num4).amountRequested;
        }
        if (num2 > 0) {
            num2 = Math.max(200, num2);
        }
        if (num2 <= 0) {
            continue;
        }
        resource = new ResourceRef(resourceDefinition.resourceId);
        const num5 = num2 * galaxyResourceCurrentPrices(galaxy)[resource.resourceId];
        if (num5 <= getPrivateFunds(empire)) {
            if (builtObject.isFunctional && builtObject.isSpacePort && builtObject.dockingBays !== null && builtObject.dockingBays.length > 0) {
                empireCreateOrder(galaxy, empire, builtObject, resource, num2, false, OrderType.Standard);
            } else if (builtObject.parentHabitat !== null) {
                empireCreateOrder(galaxy, empire, builtObject.parentHabitat, resource, num2, false, OrderType.Standard);
            }
        }
    }
}

/** BuiltObject.cs 4904/4909 DetermineFuelRequired([setFuelLevelToZero = true]). */
export function determineFuelRequired(builtObject: BuiltObject, setFuelLevelToZero = true): FuelTypeRef[] {
    const resourceList: FuelTypeRef[] = [];
    let num = 1;
    if (!setFuelLevelToZero) {
        num = builtObject.fuelCapacity - Math.trunc(builtObject.currentFuel);
    }
    const fuelType = builtObject.fuelType;
    if (fuelType !== null) {
        resourceList.push({ resourceId: fuelType.resourceId, sortTag: num });
    }
    return resourceList;
}

/** BuiltObject.cs 4774 SetupRefuelling. */
export function setupRefuelling(galaxy: Galaxy, builtObject: BuiltObject): void {
    if (builtObject.role === BuiltObjectRole.Base) {
        const empire = builtObject.empire;
        if (empire === null || empire === galaxy.independentEmpire || galaxy.pirateEmpires.includes(empire)) {
            return;
        }
        const fuelType = builtObject.fuelType;
        if (fuelType !== null) {
            let num = 0;
            const orders = galaxy.orders.getOrdersForBuiltObject(builtObject);
            for (let i = 0; i < orders.count; i++) {
                const item = orders.at(i);
                if (item.commodityResource !== null) {
                    const commodityResource = item.commodityResource;
                    if (commodityResource.resourceId === fuelType.resourceId) {
                        num += item.amountRequested;
                    }
                }
            }
            let num2 = -1;
            if (builtObject.cargo !== null) {
                num2 = cargoIndexOf(builtObject.cargo, fuelType.resourceId, empire);
            }
            if (num2 >= 0) {
                num += cargoAvailable(builtObject.cargo!.items[num2]);
            }
            let num3 = Math.trunc(builtObject.fuelCapacity - builtObject.currentFuel);
            num3 -= num;
            let val = 0;
            if (builtObject.cargoSpace >= MINIMUM_LEVEL_FOR_REFUELLING_POINT) {
                val = MINIMUM_LEVEL_FOR_REFUELLING_POINT;
            }
            if (num3 > 0) {
                num3 = Math.max(num3, val);
            }
            if (num3 > 0) {
                const num4 = num3 * galaxyResourceCurrentPrices(galaxy)[fuelType.resourceId];
                if (builtObject.owner === null) {
                    if (num4 <= getPrivateFunds(empire)) {
                        empireCreateOrder(galaxy, empire, builtObject, fuelType, num3, false, OrderType.Standard);
                    }
                } else if (num4 <= getPrivateFunds(builtObject.owner)) {
                    empireCreateOrder(galaxy, empire, builtObject, fuelType, num3, false, OrderType.Standard);
                }
            }
        }
    } else {
        let stellarObject: StellarObject | null = null;
        const fuelTypes = determineFuelRequired(builtObject, false);
        if (builtObject.role === BuiltObjectRole.Military) {
            stellarObject =
                builtObject.empire === null
                    ? fastFindNearestRefuellingPoint(galaxy, builtObject.xpos, builtObject.ypos, fuelTypes, builtObject.actualEmpire, builtObject, true, null)
                    : ultraFastFindNearestRefuellingLocation(galaxy, builtObject.empire, builtObject.xpos, builtObject.ypos, fuelTypes, builtObject, true, true);
        } else {
            stellarObject =
                builtObject.empire === null
                    ? fastFindNearestRefuellingPoint(galaxy, builtObject.xpos, builtObject.ypos, fuelTypes, builtObject.actualEmpire, builtObject)
                    : ultraFastFindNearestRefuellingLocation(galaxy, builtObject.empire, builtObject.xpos, builtObject.ypos, fuelTypes, builtObject, true);
        }
        if (stellarObject !== null && checkRefuelLocationRangeAcceptable(galaxy, builtObject, stellarObject)) {
            if (isHabitat(stellarObject)) {
                assignMission(galaxy, builtObject, BuiltObjectMissionType.Refuel, stellarObject, null, BuiltObjectMissionPriority.Unavailable);
            } else if (isBuiltObject(stellarObject)) {
                assignMission(galaxy, builtObject, BuiltObjectMissionType.Refuel, stellarObject, null, BuiltObjectMissionPriority.Unavailable);
            }
        }
    }
    builtObject.refuelForNextMission = false;
}

/** BuiltObject.cs 4923 CheckBaseCargoForFuel: tops the fuel tank up from the object's own cargo. */
function checkBaseCargoForFuel(builtObject: BuiltObject): boolean {
    const fuelType = builtObject.fuelType;
    if (fuelType !== null) {
        let cargo = null;
        if (builtObject.cargo !== null) {
            cargo = cargoGetCargo(builtObject.cargo, fuelType.resourceId, builtObject.empire);
        }
        if (cargo !== null && cargoAvailable(cargo) > 0) {
            let num = Math.trunc(builtObject.fuelCapacity - builtObject.currentFuel);
            const available = cargoAvailable(cargo);
            if (num > available) {
                num = available;
            }
            builtObject.currentFuel += num;
            cargo.amount -= num;
            if (cargo.amount <= 0) {
                cargoRemove(builtObject.cargo!, cargo);
            }
            return true;
        }
    }
    return false;
}

/** The "SHIPTYPE NAME requires refuelling" message CheckForRefuelling sends (BuiltObject.cs 5050/5069/5079/5092). */
function sendNeedsRefuellingMessage(builtObject: BuiltObject): void {
    const empire = builtObject.empire!;
    const description = gameText('SHIPTYPE NAME requires refuelling', resolveSubRoleDescription(builtObject.subRole), builtObject.name);
    sendMessageToEmpire(empire, empire, EmpireMessageType.ShipNeedsRefuelling, builtObject, description);
}

/** BuiltObject.cs 4940 CheckForRefuelling(useCachedRefuellingLocation). */
export function checkForRefuelling(galaxy: Galaxy, builtObject: BuiltObject, useCachedRefuellingLocation: boolean): void {
    let num = 0.05;
    if (builtObject.role === BuiltObjectRole.Base) {
        num = 0.4;
    } else {
        switch (builtObject.subRole) {
            case BuiltObjectSubRole.SmallFreighter:
            case BuiltObjectSubRole.MediumFreighter:
            case BuiltObjectSubRole.LargeFreighter:
            case BuiltObjectSubRole.PassengerShip:
            case BuiltObjectSubRole.GasMiningShip:
            case BuiltObjectSubRole.MiningShip: {
                num = 0.3;
                const mission = builtObjectMission(builtObject.mission);
                if (mission === null || mission.type === BuiltObjectMissionType.Undefined) {
                    num = 0.6;
                }
                break;
            }
            default: {
                let refuellingLocation: StellarObject | null = null;
                const cached = builtObject.refuellingLocation;
                if (useCachedRefuellingLocation && cached !== null && !cached.hasBeenDestroyed) {
                    refuellingLocation = cached;
                    // 4972 CalculateFuelPortionMarginFromNearbyRefuellingPoints(Xpos, Ypos, refuellingLocation).
                    num = calculateFuelPortionMarginFromRefuellingPoint(galaxy, builtObject, builtObject.xpos, builtObject.ypos, refuellingLocation);
                } else {
                    const r = calculateRefuellingPortion(galaxy, builtObject);
                    num = r.portion;
                    refuellingLocation = r.refuellingLocation;
                    builtObject.refuellingLocation = refuellingLocation;
                }
                const mission2 = builtObjectMission(builtObject.mission);
                if ((mission2 === null || mission2.type === BuiltObjectMissionType.Undefined) && refuellingLocation !== null) {
                    const num2 = galaxy.calculateDistanceSquared(builtObject.xpos, builtObject.ypos, refuellingLocation.xpos, refuellingLocation.ypos);
                    let num3 = 9000000.0;
                    if (builtObject.warpSpeed > 0) {
                        num3 = 2304000000.0;
                    }
                    if (num2 < num3) {
                        num = Math.max(0.6, num);
                    }
                }
                break;
            }
        }
    }
    // 4995 `_ = ShipGroup;`
    let mission = builtObjectMission(builtObject.mission);
    if (mission !== null && (mission.type === BuiltObjectMissionType.Attack || mission.type === BuiltObjectMissionType.Bombard)) {
        num *= 0.9;
    }
    let num4 = Math.trunc(builtObject.fuelCapacity * num);
    if (builtObject.subRole === BuiltObjectSubRole.ResupplyShip) {
        const fuelType = builtObject.fuelType;
        const parentHabitat = builtObject.parentHabitat;
        if ((builtObject.isDeployed || builtObject.deployProgress !== 0.0) && builtObject.isResourceExtractor && parentHabitat !== null && fuelType !== null && habitatResourceIndexOf(parentHabitat, fuelType.resourceId, 0) >= 0) {
            num4 = 0;
        } else if (mission !== null && mission.type === BuiltObjectMissionType.Deploy && mission.targetHabitat !== null && fuelType !== null && habitatResourceIndexOf(mission.targetHabitat, fuelType.resourceId, 0) >= 0) {
            num4 = 0;
        }
    }
    if (builtObject.role !== BuiltObjectRole.Base && builtObject.warpSpeed <= 0) {
        // 5014-5017: raises `num`, which nothing reads afterwards.
        num = Math.max(num, 0.5);
    }
    const num5 = Math.trunc(builtObject.fuelCapacity * 0.9);
    // 5019: CheckBaseCargoForFuel() is evaluated inside the short-circuit (it refuels as a side effect).
    if (
        (!(builtObject.currentFuel <= num4) && (builtObject.subRole !== BuiltObjectSubRole.ResupplyShip || !(builtObject.currentFuel < num5) || !builtObject.isDeployed || checkBaseCargoForFuel(builtObject))) ||
        builtObject.dockedAt !== null ||
        builtObject.builtAt !== null
    ) {
        return;
    }
    const empire = builtObject.empire;
    const canMessage = (): boolean => empire !== null && empire !== galaxy.independentEmpire && empire.pirateEmpireBaseHabitat === null;
    if (builtObject.role === BuiltObjectRole.Base || builtObject.subRole === BuiltObjectSubRole.ResupplyShip) {
        if (!checkBaseCargoForFuel(builtObject) && builtObject.subRole !== BuiltObjectSubRole.SmallSpacePort && builtObject.subRole !== BuiltObjectSubRole.MediumSpacePort && builtObject.subRole !== BuiltObjectSubRole.LargeSpacePort && builtObject.isAutoControlled) {
            mission = builtObjectMission(builtObject.mission);
            if (mission === null || (mission.type !== BuiltObjectMissionType.Escape && mission.type !== BuiltObjectMissionType.Refuel)) {
                setupRefuelling(galaxy, builtObject);
            }
        }
        return;
    }
    mission = builtObjectMission(builtObject.mission);
    if (mission !== null) {
        switch (mission.type) {
            case BuiltObjectMissionType.Refuel:
                break;
            case BuiltObjectMissionType.Undefined:
            case BuiltObjectMissionType.Explore:
            case BuiltObjectMissionType.Patrol:
            case BuiltObjectMissionType.Escort:
            case BuiltObjectMissionType.Blockade:
            case BuiltObjectMissionType.Attack:
                if (builtObject.isAutoControlled) {
                    setupRefuelling(galaxy, builtObject);
                } else if (!autoRefuelRepairShip(galaxy, builtObject, useCachedRefuellingLocation)) {
                    if (!builtObject.refuelForNextMission && canMessage()) {
                        sendNeedsRefuellingMessage(builtObject);
                    }
                    builtObject.refuelForNextMission = true;
                }
                break;
            case BuiltObjectMissionType.MoveAndWait:
                if (!(builtObject.currentSpeed <= 0)) {
                    break;
                }
                if (builtObject.isAutoControlled) {
                    setupRefuelling(galaxy, builtObject);
                } else if (!autoRefuelRepairShip(galaxy, builtObject, useCachedRefuellingLocation)) {
                    if (!builtObject.refuelForNextMission && canMessage()) {
                        sendNeedsRefuellingMessage(builtObject);
                    }
                    builtObject.refuelForNextMission = true;
                }
                break;
            default:
                if (!builtObject.refuelForNextMission && !builtObject.isAutoControlled && canMessage()) {
                    sendNeedsRefuellingMessage(builtObject);
                }
                builtObject.refuelForNextMission = true;
                break;
        }
    } else if (builtObject.isAutoControlled) {
        setupRefuelling(galaxy, builtObject);
    } else {
        if (!builtObject.refuelForNextMission && canMessage()) {
            sendNeedsRefuellingMessage(builtObject);
        }
        builtObject.refuelForNextMission = true;
    }
}

/** `switch (builtObjectMission.Type) { default: if (RevertMission == null) RevertMission = builtObjectMission; break; case <excluded>: break; }`. */
function recordRevertUnlessExcluded(builtObject: BuiltObject, builtObjectMissionCopy: BuiltObjectMission, excluded: readonly BuiltObjectMissionType[]): void {
    if (!excluded.includes(builtObjectMissionCopy.type)) {
        if (builtObject.revertMission === null) {
            builtObject.revertMission = builtObjectMissionCopy;
        }
    }
}

/** BuiltObject.2.cs 4736-4748 (built on first use: this module sits in an import cycle with missions/mission.ts). */
let repairRevertExcluded: readonly BuiltObjectMissionType[] | null = null;
function getRepairRevertExcluded(): readonly BuiltObjectMissionType[] {
    return (repairRevertExcluded ??= [
        BuiltObjectMissionType.Undefined,
        BuiltObjectMissionType.Build,
        BuiltObjectMissionType.BuildRepair,
        BuiltObjectMissionType.Transport,
        BuiltObjectMissionType.Escape,
        BuiltObjectMissionType.Retrofit,
        BuiltObjectMissionType.Hold,
        BuiltObjectMissionType.Refuel,
        BuiltObjectMissionType.LoadTroops,
        BuiltObjectMissionType.UnloadTroops,
        BuiltObjectMissionType.Undeploy,
        BuiltObjectMissionType.Repair,
    ]);
}

/** BuiltObject.2.cs 4795-4804. */
let refuelRevertExcluded: readonly BuiltObjectMissionType[] | null = null;
function getRefuelRevertExcluded(): readonly BuiltObjectMissionType[] {
    return (refuelRevertExcluded ??= [
        BuiltObjectMissionType.Undefined,
        BuiltObjectMissionType.Transport,
        BuiltObjectMissionType.Escape,
        BuiltObjectMissionType.Retrofit,
        BuiltObjectMissionType.Hold,
        BuiltObjectMissionType.Refuel,
        BuiltObjectMissionType.LoadTroops,
        BuiltObjectMissionType.UnloadTroops,
        BuiltObjectMissionType.Undeploy,
        BuiltObjectMissionType.Repair,
    ]);
}

/** BuiltObject.2.cs 4706 AutoRefuelRepairShip(useCachedRefuellingLocation). */
export function autoRefuelRepairShip(galaxy: Galaxy, builtObject: BuiltObject, useCachedRefuellingLocation: boolean): boolean {
    const owner = builtObject.owner;
    if (builtObject.shipGroup === null && builtObject.role !== BuiltObjectRole.Base && owner !== null && owner.autoRefuelStateShips) {
        let mission = builtObjectMission(builtObject.mission);
        if (mission !== null && mission.type === BuiltObjectMissionType.Colonize) {
            return false;
        }
        let builtObjectMissionCopy: BuiltObjectMission | null = null;
        if (mission !== null && mission.type !== BuiltObjectMissionType.Undefined) {
            builtObjectMissionCopy = mission.clone();
            if (builtObjectMissionCopy.type === BuiltObjectMissionType.Undefined) {
                builtObjectMissionCopy.type = mission.previousType;
            }
        }
        const actualEmpire = builtObject.actualEmpire;
        if (builtObject.damagedComponentCount > 0 && actualEmpire !== null) {
            mission = builtObjectMission(builtObject.mission);
            if (builtObject.dockedAt === null && builtObject.builtAt === null && (mission === null || mission.type !== BuiltObjectMissionType.Repair)) {
                if (assignRepairMission(galaxy, actualEmpire, builtObject)) {
                    if (builtObjectMissionCopy !== null) {
                        recordRevertUnlessExcluded(builtObject, builtObjectMissionCopy, getRepairRevertExcluded());
                    }
                    return true;
                }
                builtObject.revertMission = null;
            }
        } else {
            mission = builtObjectMission(builtObject.mission);
            if (mission !== null) {
                const t = mission.type;
                if (
                    t === BuiltObjectMissionType.Build ||
                    t === BuiltObjectMissionType.BuildRepair ||
                    t === BuiltObjectMissionType.Colonize ||
                    t === BuiltObjectMissionType.Deploy ||
                    t === BuiltObjectMissionType.Escape ||
                    t === BuiltObjectMissionType.ExtractResources ||
                    t === BuiltObjectMissionType.LoadTroops ||
                    t === BuiltObjectMissionType.Refuel ||
                    t === BuiltObjectMissionType.Repair ||
                    t === BuiltObjectMissionType.Retire ||
                    t === BuiltObjectMissionType.Retrofit ||
                    t === BuiltObjectMissionType.Transport ||
                    t === BuiltObjectMissionType.UnloadTroops
                ) {
                    return false;
                }
                if (t === BuiltObjectMissionType.Attack && builtObject.colonyToAttack !== null && builtObject.troops !== null && builtObject.troops.count > 0) {
                    return false;
                }
            }
            let num = 0.0;
            const cached = builtObject.refuellingLocation;
            num = !useCachedRefuellingLocation || cached === null || cached.hasBeenDestroyed ? calculateRefuellingPortion(galaxy, builtObject).portion : calculateRefuellingPortionAt(galaxy, builtObject, cached);
            if (builtObject.shipGroup === null && ((builtObject.subRole === BuiltObjectSubRole.ResupplyShip && builtObject.isDeployed) || builtObject.deployProgress !== 0.0)) {
                num = 0.0;
            }
            const num2 = builtObject.fuelCapacity * num;
            if (builtObject.currentFuel <= num2 && builtObject.dockedAt === null && builtObject.builtAt === null) {
                setupRefuelling(galaxy, builtObject);
                mission = builtObjectMission(builtObject.mission);
                if (mission !== null && mission.type === BuiltObjectMissionType.Refuel) {
                    if (builtObjectMissionCopy !== null) {
                        recordRevertUnlessExcluded(builtObject, builtObjectMissionCopy, getRefuelRevertExcluded());
                    }
                    return true;
                }
            }
        }
    }
    return false;
}
