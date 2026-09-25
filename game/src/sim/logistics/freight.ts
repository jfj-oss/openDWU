// M4d — freighter assignment for market orders: Empire.CheckMarketOrders (Empire.4.cs 720) and everything it calls
// (Empire.4.cs 337-1033: GenerateValidTradingPosts / Spaceports, SortTradingPostsByDistance, DetermineAvailableFreighters,
// smuggling freighters, FulfillOrdersAtTradingPosts, AttemptToFulfillOrderAtTradingPost, FindFreighterToFulfillOrder,
// CheckOrderIsAffordable; 1225-1526 FreighterFulfillOrdersForDestination, FindFreighterForContract), plus the
// BuiltObject fuel-range helpers they need (BuiltObject.1.cs 2338-2390, BuiltObject.cs 572, BuiltObjectList.cs 348).
//
// Rnd: FindFreighterForContract draws Galaxy.Rnd.Next(0, availableFreighters.Count) and
// Next(0, availableIndependentFreighters.Count) (Empire.4.cs 1320 / 1363) when the lists are non-empty.

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import { BuiltObject } from '../builtObject';
import { BuiltObjectSubRole } from '../builtObjectTypes';
import { Habitat } from '../types';
import { Cargo, CargoList, ResourceRef } from '../cargo';
import { BuiltObjectRole } from '../data/designSpecifications';
import { findNewest, galaxyComponentCurrentPrices, galaxyResourceCurrentPrices } from '../design';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../diplomacy';
import { checkEmpireHasHyperDriveTech, getPrivateFunds } from '../forceStructure';
import { isStellarObjectDockable } from '../independentTraders';
import { assignMission } from '../missions/assign';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, builtObjectMission } from '../missions/mission';
import { netSort } from '../netSort';
import { resolvePirateMissionsByType, type EmpireActivityRef } from '../pirates/missionsMarket';
import { PirateRelationType } from '../pirateRelations';
import { fastFindNearestSpacePort } from '../stationPlacement';
import { galaxyStarDate } from '../tick/simTime';
import { getNearestBuiltObjectWithinRange, withinFuelRangeWithFactor as withinFuelRange } from '../movement';
import {
    calculateMinimumLuxuryResourceLevel,
    calculateMinimumLuxuryResourceLevelRestricted,
    calculateResourceLevelBuiltObject,
    calculateResourceLevelCargoBuiltObject,
    calculateResourceLevelCargoHabitat,
} from './colonySupply';
import { Contract, builtObjectContracts, calculateCurrentContractValueResource, initiateContract, initiateContractForOrder, type StellarObject } from './contracts';
import {
    INDEPENDENT_TRADER_FREIGHT_RANGE,
    MAXIMUM_EMPIRE_COUNT,
    MINIMUM_CONTRACT_SIZE,
    OrderList,
    OrderType,
    SECTOR_SIZE,
    cargoAvailable,
    cargoGetCargoById,
    cargoGetExists,
    cargoIndexOf,
    cargoTotalUnits,
    isLuxuryResource,
    isRestrictedResource,
    type Order,
} from './orders';

// EmpireActivityType.Smuggle (EmpireActivityType.cs: Undefined, Attack, Defend, Smuggle).
const EMPIRE_ACTIVITY_TYPE_SMUGGLE = 3;

function isBuiltObject(o: StellarObject): o is BuiltObject {
    return o instanceof BuiltObject;
}

function missionIsIdle(bo: BuiltObject): boolean {
    const mission = builtObjectMission(bo.mission);
    return mission === null || mission.type === BuiltObjectMissionType.Undefined;
}

/**
 * `habitat.DockingBayWaitQueue != null ? habitat.DockingBayWaitQueue.Count` (null → the C# `!= null` test fails). M4e
 * creates the queues at the C# sites (Galaxy.8.cs 285-571, Galaxy.5.cs 1644/1781, Empire.1.cs 131).
 */
function habitatDockingBayWaitQueueCount(habitat: Habitat): number | null {
    const q = habitat.dockingBayWaitQueue;
    return q === null ? null : q.length;
}

/** Habitat.IsBlockaded (Habitat.cs 119). TODO(port) M4m: blockades not modeled on Habitat yet (false until then). */
function habitatIsBlockaded(habitat: Habitat): boolean {
    return (habitat as Habitat & { isBlockaded?: boolean }).isBlockaded ?? false;
}

// ------------------------------------------------------------------------------------------
// Fuel range (BuiltObject.1.cs 2338-2390, BuiltObject.cs 572, BuiltObjectList.cs 348): one implementation, in movement.ts
// (M4c owns fuel ranges); re-exported here for existing callers. `withinFuelRange` here is the C# `out rangeFactor`
// overload ({ within, rangeFactor }); movement.ts's `withinFuelRange` is the boolean overload.
export { currentRange, warpSpeedWithBonuses, withinFuelRangeWithFactor as withinFuelRange } from '../movement';

/** BuiltObject.cs 4423 CheckPirateRelationOk(pirateEmpire). */
function checkPirateRelationOk(builtObject: BuiltObject, pirateEmpire: Empire): boolean {
    let result = true;
    if (builtObject.pirateEmpireId > 0 && builtObject.pirateEmpireId !== pirateEmpire.empireId) {
        if (pirateEmpire !== null && pirateEmpire.pirateEmpireBaseHabitat !== null && pirateEmpire.pirateRelations != null) {
            const relationByOtherEmpireId = pirateEmpire.pirateRelations.getRelationByOtherEmpireId(builtObject.pirateEmpireId);
            if (relationByOtherEmpireId !== null && relationByOtherEmpireId.type !== PirateRelationType.Protection) result = false;
        }
    } else if (builtObject.empire !== null && pirateEmpire !== null && pirateEmpire.pirateEmpireBaseHabitat !== null && pirateEmpire.pirateRelations != null) {
        const relationByOtherEmpire = pirateEmpire.pirateRelations.getRelationByOtherEmpire(builtObject.empire);
        if (relationByOtherEmpire !== null && relationByOtherEmpire.type !== PirateRelationType.Protection) result = false;
    }
    return result;
}

// ------------------------------------------------------------------------------------------
// Trading posts (SortableStellarObjectList). `Contains` is a linear scan in the C#; a Set gives the same answers.

interface SortableStellarObject {
    stellarObject: StellarObject;
    sortTag: number;
}

class SortableStellarObjectList {
    items: SortableStellarObject[] = [];
    private readonly members = new Set<StellarObject>();
    contains(o: StellarObject): boolean {
        return this.members.has(o);
    }
    add(o: StellarObject): void {
        this.items.push({ stellarObject: o, sortTag: 0.0 });
        this.members.add(o);
    }
}

function dockingQueueCountBuiltObject(bo: BuiltObject): number | null {
    return bo.dockingBayWaitQueue === null ? null : bo.dockingBayWaitQueue.length;
}

/** Empire.4.cs 438 GenerateValidSpaceports(empire). */
function generateValidSpaceports(empire: Empire): SortableStellarObjectList {
    const list = new SortableStellarObjectList();
    const num = 100;
    for (let i = 0; i < empire.spacePorts.length; i++) {
        const builtObject = empire.spacePorts[i];
        if (builtObject == null || !builtObject.isSpacePort || builtObject.isBlockaded) continue;
        const q = dockingQueueCountBuiltObject(builtObject);
        if (q !== null && q < num && !list.contains(builtObject)) list.add(builtObject);
    }
    return list;
}

/** Empire.4.cs 453 GenerateValidTradingPosts(empire) (`self` is the C# `this`). */
function generateValidTradingPosts(galaxy: Galaxy, self: Empire, empire: Empire): SortableStellarObjectList {
    const list = new SortableStellarObjectList();
    const num = 50;
    const queueOk = (bo: BuiltObject): boolean => {
        const q = dockingQueueCountBuiltObject(bo);
        return q !== null && q < num;
    };
    for (let i = 0; i < empire.spacePorts.length; i++) {
        const builtObject = empire.spacePorts[i];
        if (builtObject != null && builtObject.isSpacePort && !builtObject.isBlockaded && queueOk(builtObject) && !list.contains(builtObject)) list.add(builtObject);
    }
    for (let j = 0; j < empire.miningStations.length; j++) {
        const builtObject2 = empire.miningStations[j];
        if (builtObject2 != null && builtObject2.isResourceExtractor && builtObject2.isSpacePort && !builtObject2.isBlockaded && queueOk(builtObject2) && !list.contains(builtObject2)) list.add(builtObject2);
    }
    if (empire.pirateEmpireBaseHabitat === null) {
        for (let k = 0; k < empire.colonies.length; k++) {
            const habitat = empire.colonies[k];
            if (habitatIsBlockaded(habitat)) continue;
            let flag = false;
            if (habitat.basesAtHabitat != null && habitat.basesAtHabitat.length > 0) {
                for (let l = 0; l < habitat.basesAtHabitat.length; l++) {
                    const b = habitat.basesAtHabitat[l];
                    if (b.isSpacePort && (b.subRole === BuiltObjectSubRole.SmallSpacePort || b.subRole === BuiltObjectSubRole.MediumSpacePort || b.subRole === BuiltObjectSubRole.LargeSpacePort)) {
                        flag = true;
                        break;
                    }
                }
            }
            const q = habitatDockingBayWaitQueueCount(habitat);
            if (!flag && q !== null && q < num && !list.contains(habitat)) list.add(habitat);
        }
    }
    if (empire.policy != null && empire.policy.tradeWithOtherEmpires) {
        if (empire.pirateEmpireBaseHabitat === null) {
            for (let m = 0; m < galaxy.empires.length; m++) {
                const empire2 = galaxy.empires[m];
                if (empire2 === empire || empire2 == null || empire2.policy == null || !empire2.policy.tradeWithOtherEmpires) continue;
                const diplomaticRelation = obtainDiplomaticRelation(empire, empire2);
                if (diplomaticRelation.type === DiplomaticRelationType.NotMet || diplomaticRelation.type === DiplomaticRelationType.TradeSanctions || diplomaticRelation.type === DiplomaticRelationType.War) continue;
                addForeignTradingPosts(empire, empire2, list, queueOk);
            }
        }
        for (let num3 = 0; num3 < empire.pirateRelations.count; num3++) {
            const pirateRelation = empire.pirateRelations.get(num3);
            if (pirateRelation == null || pirateRelation.type !== PirateRelationType.Protection) continue;
            const otherEmpire = pirateRelation.otherEmpire;
            if (otherEmpire === empire || otherEmpire == null || otherEmpire.policy == null || !otherEmpire.policy.tradeWithOtherEmpires) continue;
            addForeignTradingPosts(empire, otherEmpire, list, queueOk);
        }
    }
    if (empire === galaxy.independentEmpire) {
        for (let num6 = 0; num6 < galaxy.independentColonies.length; num6++) {
            const habitat2 = galaxy.independentColonies[num6];
            if (habitat2 == null) continue;
            const q = habitatDockingBayWaitQueueCount(habitat2);
            if (q !== null && q < num && !list.contains(habitat2)) list.add(habitat2);
        }
    } else {
        for (let num7 = 0; num7 < galaxy.systems.length; num7++) {
            if (!empire.visibility.checkSystemExplored(galaxy.systems[num7].systemStar.systemIndex) || galaxy.systems[num7].habitats.length <= 0) continue;
            for (let num8 = 0; num8 < galaxy.systems[num7].habitats.length; num8++) {
                const habitat3 = galaxy.systems[num7].habitats[num8];
                if (habitat3 == null || habitat3.population.items.length <= 0 || habitat3.empire !== galaxy.independentEmpire) continue;
                const q = habitatDockingBayWaitQueueCount(habitat3);
                if (q !== null && q < num && !list.contains(habitat3)) list.add(habitat3);
            }
        }
    }
    void self;
    return list;
}

/** Empire.4.cs 540-576 / 590-625: another empire's explored, unblockaded space ports and mining-station ports. */
function addForeignTradingPosts(empire: Empire, other: Empire, list: SortableStellarObjectList, queueOk: (bo: BuiltObject) => boolean): void {
    for (let n = 0; n < other.spacePorts.length; n++) {
        const builtObject3 = other.spacePorts[n];
        if (builtObject3 != null && builtObject3.isSpacePort) {
            let flag2 = false;
            if (builtObject3.nearestSystemStar !== null && empire.visibility.checkSystemExplored(builtObject3.nearestSystemStar.systemIndex)) flag2 = true;
            if (flag2 && !builtObject3.isBlockaded && queueOk(builtObject3) && !list.contains(builtObject3)) list.add(builtObject3);
        }
    }
    for (let num2 = 0; num2 < other.miningStations.length; num2++) {
        const builtObject4 = other.miningStations[num2];
        if (builtObject4 != null && builtObject4.isSpacePort && builtObject4.isResourceExtractor) {
            let flag3 = false;
            if (builtObject4.nearestSystemStar !== null && empire.visibility.checkSystemExplored(builtObject4.nearestSystemStar.systemIndex)) flag3 = true;
            if (flag3 && !builtObject4.isBlockaded && queueOk(builtObject4) && !list.contains(builtObject4)) list.add(builtObject4);
        }
    }
}

/** Empire.4.cs 648 SortTradingPostsByDistance(tradingPosts, x, y): sorts the list in place and returns it. */
function sortTradingPostsByDistance(galaxy: Galaxy, tradingPosts: SortableStellarObjectList, x: number, y: number): SortableStellarObjectList {
    for (let i = 0; i < tradingPosts.items.length; i++) {
        const t = tradingPosts.items[i];
        t.sortTag = galaxy.calculateDistanceSquared(x, y, t.stellarObject.xpos, t.stellarObject.ypos);
    }
    // SortableStellarObject.CompareTo: SortTag.CompareTo(other.SortTag) (double; no NaN here).
    netSort(tradingPosts.items, (a, b) => (a.sortTag < b.sortTag ? -1 : a.sortTag > b.sortTag ? 1 : 0));
    return tradingPosts;
}

/** Empire.4.cs 658 DetermineAvailableFreighters(out totalFreighters). */
export function determineAvailableFreighters(empire: Empire): { available: BuiltObject[]; totalFreighters: number } {
    const builtObjectList: BuiltObject[] = [];
    let totalFreighters = 0;
    const freighters = empire.freighters as BuiltObject[];
    for (let i = 0; i < freighters.length; i++) {
        const f = freighters[i];
        if (f.builtAt == null && !f.hasBeenDestroyed) {
            totalFreighters++;
            if (missionIsIdle(f) && !f.retireForNextMission && !f.repairForNextMission && !f.refuelForNextMission && !f.retrofitForNextMission) builtObjectList.push(f);
        }
    }
    return { available: builtObjectList, totalFreighters };
}

/** BaconEmpire.cs 317 RemoveStateShips(empire, ships): drops ships with an Owner that are not auto-controlled. */
function removeStateShips(ships: BuiltObject[]): BuiltObject[] {
    const toRemove = ships.filter((x) => x.owner !== null && !x.isAutoControlled);
    for (const builtObject of toRemove) {
        const i = ships.indexOf(builtObject);
        if (i >= 0) ships.splice(i, 1);
    }
    return ships;
}

// ------------------------------------------------------------------------------------------
// Smuggling (Empire.4.cs 675-718).

/** Empire.4.cs 675 SendFreightersToSmugglingDestinations(colonies, ref availableFreighters, resourceTypesToSupply). */
function sendFreightersToSmugglingDestinations(galaxy: Galaxy, self: Empire, colonies: Habitat[], availableFreighters: BuiltObject[], resourceTypesToSupply: number[]): void {
    const freightersToSend = Math.max(1, Math.trunc((availableFreighters.length * 0.6) / colonies.length));
    for (let i = 0; i < colonies.length; i++) {
        sendFreightersToSmugglingDestination(galaxy, self, colonies[i], availableFreighters, freightersToSend, resourceTypesToSupply[i]);
    }
}

/** CargoList.cs 441 GetHighestAvailableResource(empire, spaceport, out highestAvailable). */
function getHighestAvailableResource(galaxy: Galaxy, list: CargoList, empire: Empire | null, spaceport: BuiltObject): { cargo: Cargo | null; highestAvailable: number } {
    let availableResource: Cargo | null = null;
    let highestAvailable = 0;
    if (empire !== null) {
        for (let index = 0; index < list.items.length; ++index) {
            const cargo = list.items[index];
            const e = cargo?.empire as Empire | null | undefined;
            if (cargo != null && e != null && e.empireId === empire.empireId) {
                const num = cargoAvailable(cargo) - calculateResourceLevelBuiltObject(galaxy, cargo.commodity.resourceId, spaceport);
                if (availableResource === null || num > highestAvailable) {
                    availableResource = cargo;
                    highestAvailable = num;
                }
            }
        }
    }
    return { cargo: availableResource, highestAvailable };
}

/** Empire.4.cs 684 SendFreightersToSmugglingDestination(colony, ref availableFreighters, freightersToSend, resourceTypeToSupply). */
function sendFreightersToSmugglingDestination(galaxy: Galaxy, self: Empire, colony: Habitat, availableFreighters: BuiltObject[], freightersToSend: number, resourceTypeToSupply: number): void {
    const builtObject = fastFindNearestSpacePort(galaxy, colony.xpos, colony.ypos, self);
    if (builtObject === null || builtObject.cargo === null) return;
    for (let i = 0; i < freightersToSend; i++) {
        let highestAvailable = 0;
        let cargo: Cargo | null = null;
        if (resourceTypeToSupply === 255) {
            const r = getHighestAvailableResource(galaxy, builtObject.cargo, self, builtObject);
            cargo = r.cargo;
            highestAvailable = r.highestAvailable;
        } else {
            cargo = cargoGetCargoById(builtObject.cargo, resourceTypeToSupply, builtObject.empire!.empireId);
            if (cargo !== null) highestAvailable = cargoAvailable(cargo);
            const num = calculateResourceLevelBuiltObject(galaxy, resourceTypeToSupply, builtObject);
            highestAvailable -= num;
        }
        if (cargo !== null && highestAvailable > 0) {
            const nearest = getNearestBuiltObjectWithinRange(galaxy, availableFreighters, builtObject.xpos, builtObject.ypos, 0.1, true);
            if (nearest !== null && nearest.role === BuiltObjectRole.Freight && cargo !== null && cargoAvailable(cargo) > 0 && highestAvailable > 0) {
                const num2 = Math.min(nearest.cargoCapacity, highestAvailable);
                const cargoList = new CargoList();
                const resource = new ResourceRef(cargo.commodity.resourceId);
                cargoList.add(new Cargo(resource, num2, colony.empire));
                const contract = new Contract(builtObject, num2, resource.resourceId, -1, colony.empire!.empireId);
                contract.freighter = nearest;
                builtObjectContracts(nearest).push(contract);
                const transactionAmount = calculateCurrentContractValueResource(galaxy, resource, num2);
                initiateContract(galaxy, self, builtObject, colony, colony.owner, false, resource, null, transactionAmount, contract, self, galaxyStarDate(galaxy));
                assignMission(galaxy, nearest, BuiltObjectMissionType.Transport, builtObject, colony, BuiltObjectMissionPriority.Normal, { cargo: cargoList, allowReprocessing: true });
                const idx = availableFreighters.indexOf(nearest);
                if (idx >= 0) availableFreighters.splice(idx, 1);
            }
        }
    }
}

// ------------------------------------------------------------------------------------------
// Empire.4.cs 720 CheckMarketOrders.

/** Empire.4.cs 720 CheckMarketOrders (`empire` is the C# `this`). */
export function checkMarketOrders(galaxy: Galaxy, empire: Empire): void {
    const tradingPosts = generateValidTradingPosts(galaxy, empire, empire);
    const tradingPosts2 = generateValidSpaceports(empire);
    let orderList = new OrderList();
    let ships = determineAvailableFreighters(empire).available;
    ships = removeStateShips(ships);
    // Galaxy.IndependentEmpire always exists in a real game; bare unit-test galaxies (generateEmpire) have none.
    const availableIndependentFreighters = galaxy.independentEmpire !== null ? determineAvailableFreighters(galaxy.independentEmpire).available : [];
    const habitatList: Habitat[] = [];
    const list: number[] = [];
    const empireActivityList: EmpireActivityRef[] = resolvePirateMissionsByType(galaxy, empire, EMPIRE_ACTIVITY_TYPE_SMUGGLE);
    if (empireActivityList.length > 0 && ships.length > 0) {
        for (let i = 0; i < empireActivityList.length; i++) {
            const empireActivity = empireActivityList[i];
            if (empireActivity == null || empireActivity.target == null || !(empireActivity.target instanceof Habitat) || empireActivity.requestingEmpire === empire) continue;
            const habitat = empireActivity.target as Habitat;
            if (!(empire.pirateEmpireBaseHabitat === null ? isStellarObjectDockable(galaxy, habitat, empire) : isStellarObjectDockable(galaxy, habitat, galaxy.independentEmpire))) continue;
            const orders = galaxy.orders.getOrdersForHabitat(habitat);
            if (empireActivity.resourceId === 255) {
                if (orders == null || orders.count <= 0) {
                    habitatList.push(habitat);
                    list.push(255);
                } else {
                    orderList.addRange(orders);
                }
                continue;
            }
            const orders2 = orders.getOrdersForResourceId(empireActivity.resourceId);
            if (habitat.empire === galaxy.independentEmpire) {
                if (orders2 == null || orders2.count <= 0) {
                    habitatList.push(habitat);
                    list.push(empireActivity.resourceId);
                } else {
                    orderList.addRange(orders2);
                }
            } else {
                orderList.addRange(orders2);
            }
        }
        orderList.mergeRange(galaxy.orders.getOrdersForEmpire(empire));
    } else {
        orderList = galaxy.orders.getOrdersForEmpire(empire);
    }
    empire.empireOrderCount = orderList.count;
    if (habitatList.length > 0) sendFreightersToSmugglingDestinations(galaxy, empire, habitatList, ships, list);
    let useOptimizedSorting = false;
    if (checkEmpireHasHyperDriveTech(empire)) useOptimizedSorting = true;
    const sortedTradingPosts = new Map<number, SortableStellarObjectList>();
    const sortedTradingPosts2 = new Map<number, SortableStellarObjectList>();
    const empireAvailableFreighterCount = new Array<number>(MAXIMUM_EMPIRE_COUNT + 1).fill(0);
    const array = new Array<number>(MAXIMUM_EMPIRE_COUNT + 1).fill(0);
    for (let j = 0; j < galaxy.empires.length; j++) {
        const empire2 = galaxy.empires[j];
        if (empire2 != null) {
            const r = determineAvailableFreighters(empire2);
            empireAvailableFreighterCount[empire2.empireId] = r.available.length;
            array[empire2.empireId] = r.totalFreighters;
        }
    }
    let allowableRangeSquared = SECTOR_SIZE * 5.0 * (SECTOR_SIZE * 5.0);
    const design = findNewest(empire.designs, BuiltObjectSubRole.MediumFreighter);
    if (design !== null && design.warpSpeed > 0) {
        allowableRangeSquared = design.maximumRange();
        allowableRangeSquared *= allowableRangeSquared;
    }
    const split = orderList.splitOrdersByType();
    const ctx: FulfillContext = { galaxy, self: empire, availableFreighters: ships, allowableRangeSquared, empireTotalFreighterCount: array, empireAvailableFreighterCount, availableIndependentFreighters, useOptimizedSorting };
    fulfillOrdersAtTradingPosts(ctx, split.constructionShortageMobileOrders, tradingPosts, sortedTradingPosts);
    fulfillOrdersAtTradingPosts(ctx, split.constructionShortageOrders, tradingPosts, sortedTradingPosts);
    fulfillOrdersAtTradingPosts(ctx, split.retrofitResourcesForBaseOrders, tradingPosts2, sortedTradingPosts2);
    fulfillOrdersAtTradingPosts(ctx, split.standardOrders, tradingPosts, sortedTradingPosts);
}

/** The arguments FulfillOrdersAtTradingPosts threads through to FindFreighterForContract. */
interface FulfillContext {
    galaxy: Galaxy;
    /** C# `this` (the empire running CheckMarketOrders). */
    self: Empire;
    availableFreighters: BuiltObject[];
    allowableRangeSquared: number;
    empireTotalFreighterCount: number[];
    empireAvailableFreighterCount: number[];
    availableIndependentFreighters: BuiltObject[];
    useOptimizedSorting: boolean;
}

/** Empire.4.cs 826 CheckOrderIsAffordable(order). */
function checkOrderIsAffordable(galaxy: Galaxy, self: Empire, order: Order): boolean {
    let result = true;
    let num = 0.0;
    if (order.commodityResource !== null) num = galaxyResourceCurrentPrices(galaxy)[order.commodityResource.resourceId];
    else if (order.commodityComponent !== null) num = galaxyComponentCurrentPrices(galaxy)[order.commodityComponent.componentId];
    const num2 = num * order.amountOutstandingToContract;
    if (order.isStateOrder) {
        if (num2 > self.stateMoney) result = false;
    } else if (num2 > getPrivateFunds(self)) {
        result = false;
    }
    return result;
}

/** Empire.4.cs 826 FulfillOrdersAtTradingPosts(orders, tradingPosts, …, ref sortedTradingPosts). */
function fulfillOrdersAtTradingPosts(ctx: FulfillContext, orders: OrderList, tradingPosts: SortableStellarObjectList, sortedTradingPosts: Map<number, SortableStellarObjectList>): void {
    const { galaxy, self } = ctx;
    for (let i = 0; i < orders.items.length; i++) {
        const order = orders.items[i];
        if (order.amountOutstandingToContract <= 0 || (self !== galaxy.independentEmpire && self.pirateEmpireBaseHabitat === null && !checkOrderIsAffordable(galaxy, self, order))) continue;
        let requesterIsConstructionShip = false;
        if (order.requestingBuiltObject !== null) {
            if (order.requestingBuiltObject.hasBeenDestroyed) continue;
            if (order.requestingBuiltObject.subRole === BuiltObjectSubRole.ConstructionShip) requesterIsConstructionShip = true;
        }
        if (order.requestingBuiltObject !== null) {
            if (order.requestingBuiltObject.isBlockaded) continue;
        } else if (order.requestingColony !== null && habitatIsBlockaded(order.requestingColony)) {
            continue;
        }
        let habitat: Habitat | null = null;
        let empire: Empire | null = null;
        let stellarObject: StellarObject | null = null;
        let x = 0.0;
        let y = 0.0;
        if (order.requestingBuiltObject !== null) {
            stellarObject = order.requestingBuiltObject;
            empire = order.requestingBuiltObject.actualEmpire;
            x = order.requestingBuiltObject.xpos;
            y = order.requestingBuiltObject.ypos;
            if (ctx.useOptimizedSorting) habitat = order.requestingBuiltObject.nearestSystemStar;
        } else if (order.requestingColony !== null) {
            stellarObject = order.requestingColony;
            empire = order.requestingColony.empire;
            x = order.requestingColony.xpos;
            y = order.requestingColony.ypos;
            if (ctx.useOptimizedSorting) habitat = galaxy.determineHabitatSystemStar(order.requestingColony);
        }
        if (empire === null) {
            galaxy.orders.remove(order);
            continue;
        }
        // C# quirk kept: SortTradingPostsByDistance sorts `tradingPosts` in place and returns it, so every cached
        // entry is the same list, in whatever order the latest sort left it.
        let value: SortableStellarObjectList | undefined = tradingPosts;
        if (habitat !== null) {
            value = sortedTradingPosts.get(habitat.systemIndex);
            if (value === undefined) {
                value = sortTradingPostsByDistance(galaxy, tradingPosts, habitat.xpos, habitat.ypos);
                sortedTradingPosts.set(habitat.systemIndex, value);
            }
        } else {
            value = sortTradingPostsByDistance(galaxy, tradingPosts, x, y);
        }
        const commodityResource = order.commodityResource;
        let resourceIsRestricted = false;
        let resourceIsLuxury = false;
        if (commodityResource !== null) {
            resourceIsRestricted = isRestrictedResource(galaxy, commodityResource.resourceId);
            resourceIsLuxury = isLuxuryResource(galaxy, commodityResource.resourceId);
        }
        for (let j = 0; j < value.items.length; j++) {
            if (value.items[j].stellarObject !== stellarObject) {
                attemptToFulfillOrderAtTradingPost(ctx, value.items[j].stellarObject, order, commodityResource, resourceIsRestricted, resourceIsLuxury, requesterIsConstructionShip);
                if (order.amountOutstandingToContract <= 0) break;
            }
        }
    }
}

/** Empire.4.cs 923 AttemptToFulfillOrderAtTradingPost(StellarObject tradingPost, order, orderResource, …). */
function attemptToFulfillOrderAtTradingPost(ctx: FulfillContext, tradingPost: StellarObject | null, order: Order | null, orderResource: ResourceRef | null, resourceIsRestricted: boolean, resourceIsLuxury: boolean, requesterIsConstructionShip: boolean): number {
    const { galaxy } = ctx;
    let allowableRangeSquared = ctx.allowableRangeSquared;
    if (tradingPost === null || order === null) return 0;
    if (isBuiltObject(tradingPost) && !tradingPost.isFunctional) return 0;
    let empire: Empire | null = null;
    let x = 0.0;
    let y = 0.0;
    const requestingColony = order.requestingColony;
    const requestingBuiltObject = order.requestingBuiltObject;
    if (requestingColony !== null) {
        empire = requestingColony.empire;
        if (!isBuiltObject(tradingPost)) {
            x = requestingColony.xpos;
            y = requestingColony.ypos;
            if (tradingPost === requestingColony) return 0;
        } else {
            x = requestingColony.xpos;
            y = requestingColony.ypos;
            if (tradingPost.parentHabitat !== null && tradingPost.parentHabitat === requestingColony) return 0;
        }
    } else if (requestingBuiltObject !== null) {
        empire = requestingBuiltObject.actualEmpire;
        x = requestingBuiltObject.xpos;
        y = requestingBuiltObject.ypos;
        if (tradingPost === requestingBuiltObject) return 0;
    }
    const tradingPostEmpire = tradingPost.empire as Empire | null;
    if (orderResource !== null && resourceIsRestricted) {
        if (tradingPostEmpire !== null && tradingPostEmpire !== empire) {
            if (tradingPostEmpire.pirateEmpireBaseHabitat !== null || empire!.pirateEmpireBaseHabitat !== null) return 0;
            const diplomaticRelation = obtainDiplomaticRelation(tradingPostEmpire, empire);
            if (!diplomaticRelation.supplyRestrictedResources) return 0;
        }
        allowableRangeSquared = galaxy.sizeX * 1.415 * (galaxy.sizeX * 1.415);
    }
    const num = galaxy.calculateDistanceSquared(tradingPost.xpos, tradingPost.ypos, x, y);
    if (num > allowableRangeSquared) return 0;
    let cargo: Cargo | null = null;
    let num2 = 0;
    const cargo2 = tradingPost.cargo;
    if (cargo2 !== null) {
        if (orderResource !== null && cargoGetExists(cargo2, orderResource.resourceId)) {
            const empire2 = tradingPostEmpire;
            if (empire2 !== null) {
                cargo = cargoGetCargoById(cargo2, orderResource.resourceId, empire2.empireId);
                if (resourceIsLuxury && !isBuiltObject(tradingPost)) {
                    num2 = !resourceIsRestricted ? calculateMinimumLuxuryResourceLevel(tradingPost) : calculateMinimumLuxuryResourceLevelRestricted(tradingPost);
                }
            }
        } else if (order.commodityComponent !== null) {
            // TODO(port): component cargo — `cargo2.GetExists(component)` / GetCargo(component, tradingPost.Empire);
            // TS cargo is resource-only, so no trading post holds components.
        }
    }
    if (cargo !== null) {
        let available = cargoAvailable(cargo);
        if (available > 0) {
            let num3 = 0;
            if ((requesterIsConstructionShip || order.type === OrderType.ConstructionShortage || order.type === OrderType.ConstructionShortageMobile || order.type === OrderType.RetrofitResourcesForBase) && tradingPostEmpire === empire) {
                num3 = 0;
            } else if (isBuiltObject(tradingPost)) {
                num3 = calculateResourceLevelCargoBuiltObject(galaxy, cargo, tradingPost);
            } else {
                num3 = num2 <= 0 ? calculateResourceLevelCargoHabitat(galaxy, cargo, tradingPost) : num2;
            }
            available -= num3;
            if (available > 0 && available > Math.min(order.amountOutstandingToContract, MINIMUM_CONTRACT_SIZE)) {
                return findFreighterToFulfillOrder(ctx, order, available, tradingPost, empire);
            }
        }
    }
    return 0;
}

/** Empire.4.cs 337 FindFreighterToFulfillOrder(order, available, tradingPost, requestor, …). */
function findFreighterToFulfillOrder(ctx: FulfillContext, order: Order, available: number, tradingPost: StellarObject, requestor: Empire | null): number {
    void requestor;
    const { galaxy, self } = ctx;
    let num = Math.min(order.amountOutstandingToContract, available);
    let empire: Empire | null = null;
    let destination: StellarObject | null = null;
    if (order.requestingBuiltObject !== null) {
        empire = order.requestingBuiltObject.actualEmpire;
        destination = order.requestingBuiltObject;
    } else if (order.requestingColony !== null) {
        empire = order.requestingColony.owner;
        destination = order.requestingColony;
    }
    const tradingPostEmpire = tradingPost.empire as Empire | null;
    const found = findFreighterForContract(ctx, empire, tradingPostEmpire, MINIMUM_CONTRACT_SIZE, tradingPost, destination);
    const builtObject = found.freighter;
    const freighterTypeIndex = found.freighterTypeIndex;
    if (num > 0 && builtObject !== null) {
        const contracts: Contract[] = [];
        const num2 = Math.min(num, builtObject.cargoSpace);
        let contract: Contract | null = null;
        if (order.commodityResource !== null) contract = new Contract(tradingPost, num2, order.commodityResource.resourceId, -1, empire!.empireId);
        else if (order.commodityComponent !== null) contract = new Contract(tradingPost, num2, -1, order.commodityComponent.componentId, empire!.empireId);
        contract!.freighter = builtObject;
        contracts.push(contract!);
        num -= num2;
        const currentStarDate = galaxyStarDate(galaxy);
        initiateContractForOrder(galaxy, self, tradingPost, order, contract!, tradingPostEmpire!, currentStarDate);
        const cargoList = new CargoList();
        let cargo: Cargo | null = null;
        if (order.commodityResource !== null) cargo = new Cargo(order.commodityResource, num2, empire);
        else if (order.commodityComponent !== null) {
            // TODO(port): component cargo — new Cargo(order.CommodityComponent, num2, empire); TS cargo is resource-only.
        }
        if (cargo !== null) cargoList.add(cargo);
        freighterFulfillOrdersForDestination(galaxy, self, destination!, tradingPost, builtObject, cargoList, currentStarDate, contracts, order);
        let target: StellarObject | null = null;
        if (order.requestingBuiltObject !== null) target = order.requestingBuiltObject;
        else if (order.requestingColony !== null) target = order.requestingColony;
        assignMission(galaxy, builtObject, BuiltObjectMissionType.Transport, tradingPost, target, BuiltObjectMissionPriority.Normal, { cargo: cargoList, allowReprocessing: true });
        switch (freighterTypeIndex) {
            case 0: {
                const i = ctx.availableFreighters.indexOf(builtObject);
                if (i >= 0) ctx.availableFreighters.splice(i, 1);
                break;
            }
            case 1: {
                const i = ctx.availableIndependentFreighters.indexOf(builtObject);
                if (i >= 0) ctx.availableIndependentFreighters.splice(i, 1);
                break;
            }
        }
        builtObjectContracts(builtObject).push(...contracts);
        return num2;
    }
    return 0;
}

/** Empire.4.cs 1225 FreighterFulfillOrdersForDestination(destination, supplier, freighter, freighterMissionCargo, starDate, ref contracts, orderToExclude). */
function freighterFulfillOrdersForDestination(galaxy: Galaxy, self: Empire, destination: StellarObject, supplier: StellarObject, freighter: BuiltObject, freighterMissionCargo: CargoList, starDate: number, contracts: Contract[], orderToExclude: Order): void {
    let orderList: OrderList | null = null;
    if (isBuiltObject(destination)) orderList = galaxy.orders.getOrdersForBuiltObject(destination);
    else orderList = galaxy.orders.getOrdersForHabitat(destination);
    if (orderList === null) return;
    const supplierEmpire = supplier.empire as Empire | null;
    const destinationEmpire = destination.empire as Empire | null;
    for (let i = 0; i < orderList.items.length; i++) {
        const order = orderList.items[i];
        if (order === orderToExclude || order.amountOutstandingToContract <= 0) continue;
        let num = -1;
        let cargo: Cargo | null = null;
        if (supplier.cargo === null) continue;
        if (order.commodityResource !== null && cargoGetExists(supplier.cargo, order.commodityResource.resourceId)) {
            const commodityResource = order.commodityResource;
            num = cargoIndexOf(supplier.cargo, commodityResource.resourceId, supplierEmpire);
            cargo = new Cargo(commodityResource, 0, destinationEmpire, 0);
        } else if (order.commodityComponent !== null) {
            // TODO(port): component cargo (supplier.Cargo.GetExists(component) / IndexOf(component, supplier.Empire)).
        }
        if (num < 0) continue;
        const num2 = freighter.cargoSpace - cargoTotalUnits(freighterMissionCargo);
        if (num2 <= 0) break;
        let available = cargoAvailable(supplier.cargo.items[num]);
        let num3 = 0;
        if (!isBuiltObject(supplier)) num3 = calculateResourceLevelCargoHabitat(galaxy, supplier.cargo.items[num], supplier);
        else num3 = calculateResourceLevelCargoBuiltObject(galaxy, supplier.cargo.items[num], supplier);
        available = Math.max(0, available - num3);
        let val = Math.min(order.amountOutstandingToContract, available);
        val = Math.min(val, num2);
        if (val > 0) {
            let contract: Contract | null = null;
            if (order.commodityResource !== null) contract = new Contract(supplier, val, order.commodityResource.resourceId, -1, destinationEmpire!.empireId);
            else if (order.commodityComponent !== null) contract = new Contract(supplier, val, -1, order.commodityComponent.componentId, destinationEmpire!.empireId);
            cargo!.amount = val;
            freighterMissionCargo.add(cargo!);
            contract!.freighter = freighter;
            contracts.push(contract!);
            initiateContractForOrder(galaxy, self, supplier, order, contract!, supplierEmpire!, starDate);
        }
    }
}

/** Empire.4.cs 1310 FindFreighterForContract(buyer, seller, minimumCargoSpaceRequired, pickupPoint, destination, …, ref freighterTypeIndex). */
function findFreighterForContract(ctx: FulfillContext, buyer: Empire | null, seller: Empire | null, minimumCargoSpaceRequired: number, pickupPoint: StellarObject | null, destination: StellarObject | null): { freighter: BuiltObject | null; freighterTypeIndex: number } {
    const { galaxy } = ctx;
    let freighterTypeIndex = 0;
    if (buyer !== null && seller !== null && pickupPoint !== null && destination !== null) {
        let builtObject: BuiltObject | null = null;
        let num = Number.MAX_VALUE;
        let rangeFactor = 0.0;
        freighterTypeIndex = 0;
        let num2 = 0;
        const availableFreighters = ctx.availableFreighters;
        // Own freighters: return the first (from a random start) that reaches both points; else remember the lowest
        // rangeFactor (from whichever WithinFuelRange call ran last, as the C# `out` parameter is left).
        const ownCandidate = (bo: BuiltObject | null): BuiltObject | null => {
            if (bo == null) return null;
            if (missionIsIdle(bo) && bo.builtAt == null && !bo.hasBeenDestroyed && bo.cargoCapacity > minimumCargoSpaceRequired) {
                const r1 = withinFuelRange(galaxy, bo, pickupPoint.xpos, pickupPoint.ypos, 0.0);
                rangeFactor = r1.rangeFactor;
                if (r1.within) {
                    const r2 = withinFuelRange(galaxy, bo, destination.xpos, destination.ypos, 0.0);
                    rangeFactor = r2.rangeFactor;
                    if (r2.within) return bo;
                }
                if (rangeFactor < num) {
                    builtObject = bo;
                    num = rangeFactor;
                }
            }
            return null;
        };
        if (availableFreighters != null && availableFreighters.length > 0) {
            num2 = galaxy.rnd.next(0, availableFreighters.length);
            for (let i = num2; i < availableFreighters.length; i++) {
                const r = ownCandidate(availableFreighters[i]);
                if (r !== null) return { freighter: r, freighterTypeIndex };
            }
            for (let j = 0; j < num2; j++) {
                const r = ownCandidate(availableFreighters[j]);
                if (r !== null) return { freighter: r, freighterTypeIndex };
            }
        }
        freighterTypeIndex = 1;
        const availableIndependentFreighters = ctx.availableIndependentFreighters;
        // Independent traders within IndependentTraderFreightRange of the pickup (both C# branches of the
        // PirateEmpireBaseHabitat test are identical).
        const independentCandidate = (bo: BuiltObject | null): boolean => {
            if (bo == null) return false;
            if (!missionIsIdle(bo) || bo.builtAt != null || bo.hasBeenDestroyed || bo.cargoCapacity <= minimumCargoSpaceRequired) return false;
            const num3 = galaxy.calculateDistance(bo.xpos, bo.ypos, pickupPoint.xpos, pickupPoint.ypos);
            return Math.trunc(num3) <= INDEPENDENT_TRADER_FREIGHT_RANGE && withinFuelRange(galaxy, bo, pickupPoint.xpos, pickupPoint.ypos, 0.1).within && withinFuelRange(galaxy, bo, destination.xpos, destination.ypos, 0.1).within && bo.role === BuiltObjectRole.Freight;
        };
        if (availableIndependentFreighters != null && availableIndependentFreighters.length > 0) {
            num2 = galaxy.rnd.next(0, availableIndependentFreighters.length);
            for (let k = num2; k < availableIndependentFreighters.length; k++) {
                if (independentCandidate(availableIndependentFreighters[k])) return { freighter: availableIndependentFreighters[k], freighterTypeIndex };
            }
            for (let l = 0; l < num2; l++) {
                if (independentCandidate(availableIndependentFreighters[l])) return { freighter: availableIndependentFreighters[l], freighterTypeIndex };
            }
        }
        if (buyer !== galaxy.independentEmpire) {
            freighterTypeIndex = 2;
            let num7 = 0.0;
            if (seller !== null) {
                const freighters = seller.freighters as BuiltObject[];
                if (freighters != null) {
                    num7 = ctx.empireAvailableFreighterCount[seller.empireId] / Math.max(1.0, ctx.empireTotalFreighterCount[seller.empireId]);
                    if (num7 > 0.5) {
                        let habitat: Habitat | null = null;
                        if (!isBuiltObject(destination)) habitat = galaxy.determineHabitatSystemStar(destination);
                        else habitat = destination.nearestSystemStar;
                        if (habitat !== null && seller.visibility.checkSystemExplored(habitat.systemIndex)) {
                            for (let m = 0; m < freighters.length; m++) {
                                const builtObject6 = freighters[m];
                                if (builtObject6 == null) continue;
                                if (!missionIsIdle(builtObject6) || builtObject6.builtAt != null || builtObject6.hasBeenDestroyed || builtObject6.cargoCapacity <= minimumCargoSpaceRequired) continue;
                                if (buyer.pirateEmpireBaseHabitat !== null && !checkPirateRelationOk(builtObject6, buyer)) continue;
                                // WithinFuelRange without `out`: rangeFactor keeps its stale value below (C# as written).
                                if (withinFuelRange(galaxy, builtObject6, pickupPoint.xpos, pickupPoint.ypos, 0.0).within && withinFuelRange(galaxy, builtObject6, destination.xpos, destination.ypos, 0.0).within) {
                                    ctx.empireAvailableFreighterCount[seller.empireId]--;
                                    return { freighter: builtObject6, freighterTypeIndex };
                                }
                                if (rangeFactor < num) {
                                    if (builtObject === null) ctx.empireAvailableFreighterCount[seller.empireId]--;
                                    builtObject = builtObject6;
                                    num = rangeFactor;
                                }
                            }
                        }
                    }
                }
            }
        }
        const best = builtObject as BuiltObject | null;
        if (best !== null && withinFuelRange(galaxy, best, pickupPoint.xpos, pickupPoint.ypos, 0.0).within && withinFuelRange(galaxy, best, destination.xpos, destination.ypos, 0.0).within) {
            return { freighter: best, freighterTypeIndex };
        }
    }
    return { freighter: null, freighterTypeIndex };
}

