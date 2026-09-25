// M4d — the Order / OrderList model (Order.cs, OrderList.cs, OrderType.cs), order creation (Galaxy.cs 1757-1773,
// Empire.4.cs 4048-4098, Galaxy.3.cs 1864-1906), the per-empire order upkeep entry points the tick calls
// (ProcessTradeBonuses, ReviewRestrictedResourceTrading, MaintainBaseResourceLevels), CheckForUnownedCargo
// (BuiltObject + Habitat), order cleanup (Galaxy.1.cs 1047-1158, moved here from independentTraders.ts), and the
// C# CargoList lookups the logistics code needs on top of the TS CargoList (cargo.ts).
//
// CheckMarketOrders (freighter assignment) lives in freight.ts and is re-exported here, because the tick skeletons
// import it from this module. None of the functions in this file draw from Galaxy.Rnd.

import { registerTodo, todo } from '../tick/todo';
import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import { AutomationLevel, empireGovernmentAttributes } from '../empire';
import { BuiltObject } from '../builtObject';
import { BuiltObjectSubRole } from '../builtObjectTypes';
import type { Habitat } from '../types';
import { GalaxyShape } from '../types';
import { Cargo, CargoList, ResourceRef } from '../cargo';
import { BuiltObjectRole } from '../data/designSpecifications';
import { galaxyResourceCurrentPrices } from '../design';
import { DiplomaticRelationType, DiplomaticStrategy, obtainDiplomaticRelation, type DiplomaticRelation } from '../diplomacy';
import { getPrivateFunds } from '../forceStructure';
import { EmpireMessageType, sendMessageToEmpire } from '../messages';
import { galaxyStarDate } from '../tick/simTime';
import { REAL_SECONDS_IN_GALACTIC_YEAR } from '../galaxyTime';
import { countersProcessColonyRevenue } from '../treasury';
import { calculateResourceLevelStockForBaseRetrofit } from './colonySupply';
import type { Contract } from './contracts';
import { cancelContract } from './contracts';
import { baconSettings } from '../data/baconSettings';

export { checkMarketOrders } from './freight';

// ------------------------------------------------------------------------------------------
// Galaxy statics (Galaxy.3.cs InitializeStatics 4963-5138) used by the logistics package.
export const MINIMUM_CONTRACT_SIZE = 300; // 5022
export const COLONY_MINIMUM_RESOURCE_REORDER_AMOUNT = 500; // 5025
export const MINIMUM_LUXURY_RESOURCE_REORDER_AMOUNT = 100; // 5026
export const MINIMUM_RESTRICTED_RESOURCE_REORDER_AMOUNT = 10; // 5027
export const ORDER_EXPIRY_YEARS_LUXURY = 0.6; // 5016
export const TYPICAL_MAXIMUM_ORDER_FULFILLMENT_DISTANCE = 8000000; // 5006
export const MAXIMUM_EMPIRE_COUNT = 255; // 5034
export const TRADE_BONUS_ANNUAL_INCREASE = 0.1; // 5063
export const TRADE_BONUS_MAXIMUM_FREE_TRADE = 0.2; // 5064
export const TRADE_BONUS_MAXIMUM_FREE_TRADE_AMOUNT = 20000.0; // 5065
export const TRADE_BONUS_MAXIMUM_MUTUAL_DEFENSE = 0.3; // 5066
export const TRADE_BONUS_MAXIMUM_MUTUAL_DEFENSE_AMOUNT = 30000.0; // 5067
export const INDEPENDENT_TRADER_FREIGHT_RANGE = 5000000; // 5069
export const COLONY_ANNUAL_RESOURCE_CONSUMPTION_RATE = 1e-8; // 5004
export const COLONY_ANNUAL_LUXURY_RESOURCE_CONSUMPTION_RATE = 2e-8; // 5005
export const COLONY_ANNUAL_RESTRICTED_RESOURCE_CONSUMPTION_RATE = 1e-8; // 5095
export const COLONY_STRATEGIC_RESOURCE_CONSUMPTION_PER_MILLION_PER_YEAR = 0.33; // 5085
export const SECTOR_SIZE = 2000000; // 4974

// ------------------------------------------------------------------------------------------
// Commodity references. C# Order/Contract/Cargo carry a Resource or a Component (by id); the TS CargoList only
// carries resources (cargo.ts TODO(port): component cargo), so ComponentRef exists for orders only.

/** Component.cs as an order commodity (by ComponentID). */
export class ComponentRef {
    componentId: number;
    constructor(componentId: number) {
        this.componentId = componentId;
    }
}

// OrderType.cs (byte enum, declaration order = values).
export enum OrderType {
    Standard,
    RetrofitResourcesForBase,
    ConstructionShortage,
    ConstructionShortageMobile,
}

// Order.cs. The four C# constructors (requesting BuiltObject or Habitat × Resource or Component) collapse into one:
// exactly one of requestingColony / requestingBuiltObject and one of the commodities is non-null.
export class Order {
    private _amountRequested: number; // int
    private _maximumFulfillmentDistance: number; // int
    private _expiryDate: number; // long
    private _minimumContractSize = 0; // int
    isStateOrder = false;
    type: OrderType = OrderType.Standard;
    galaxy: Galaxy | null;
    requestingColony: Habitat | null;
    requestingBuiltObject: BuiltObject | null;
    /** Order._Contracts (ContractList = SyncList<Contract>). */
    contracts: (Contract | null)[] = [];
    private _component: ComponentRef | null = null;
    private _resource: ResourceRef | null = null;

    // Order.cs 95-161.
    constructor(galaxy: Galaxy | null, requester: Habitat | BuiltObject, commodity: ResourceRef | ComponentRef, amountRequested: number, expiryDate: number, maximumFulfillmentDistance: number) {
        this.galaxy = galaxy;
        if (requester instanceof BuiltObject) {
            this.requestingBuiltObject = requester;
            this.requestingColony = null;
        } else {
            this.requestingBuiltObject = null;
            this.requestingColony = requester;
        }
        if (commodity instanceof ComponentRef) this.commodityComponent = commodity;
        else this.commodityResource = commodity;
        this._amountRequested = amountRequested;
        this._expiryDate = expiryDate;
        this._maximumFulfillmentDistance = maximumFulfillmentDistance;
    }

    // Order.cs 163 AmountToFulfill (int sum over non-null contracts).
    get amountToFulfill(): number {
        let amountToFulfill = 0;
        for (let index = 0; index < this.contracts.length; ++index) {
            const contract = this.contracts[index];
            if (contract != null) amountToFulfill = (amountToFulfill + contract.amountToFulfill) | 0;
        }
        return amountToFulfill;
    }

    // Order.cs 178 AmountDelivered.
    get amountDelivered(): number {
        let amountDelivered = 0;
        for (let index = 0; index < this.contracts.length; ++index) {
            const contract = this.contracts[index];
            if (contract != null) amountDelivered = (amountDelivered + contract.amountDelivered) | 0;
        }
        return amountDelivered;
    }

    // Order.cs 193 / 195.
    get amountStillToArrive(): number {
        return (this.amountToFulfill - this.amountDelivered) | 0;
    }
    get amountOutstandingToContract(): number {
        return (this.amountRequested - this.amountToFulfill) | 0;
    }

    get minimumContractSize(): number {
        return this._minimumContractSize;
    }
    set minimumContractSize(value: number) {
        this._minimumContractSize = value;
    }

    // Order.cs 209 / 219: setting one commodity clears the other.
    get commodityResource(): ResourceRef | null {
        return this._resource;
    }
    set commodityResource(value: ResourceRef | null) {
        this._resource = value;
        this._component = null;
    }
    get commodityComponent(): ComponentRef | null {
        return this._component;
    }
    set commodityComponent(value: ComponentRef | null) {
        this._resource = null;
        this._component = value;
    }

    get amountRequested(): number {
        return this._amountRequested;
    }
    set amountRequested(value: number) {
        this._amountRequested = value;
    }
    get maximumFulfillmentDistance(): number {
        return this._maximumFulfillmentDistance;
    }
    set maximumFulfillmentDistance(value: number) {
        this._maximumFulfillmentDistance = value;
    }
    get expiryDate(): number {
        return this._expiryDate;
    }
    set expiryDate(value: number) {
        this._expiryDate = value;
    }
}

// OrderList.cs (SyncList<Order> + optional per-requester indexes). Galaxy.Orders is indexed (EnableIndexing in the
// Galaxy constructor, Galaxy.4.cs 2356 / Start.2.cs 136); every list the GetOrders* helpers return is a plain one.
// The index lists are kept exactly as in the C# (parallel key/list arrays, keys captured at Add/Remove time: a
// colony that changes hands stays indexed under its old empire until the order is removed).
export class OrderList {
    items: Order[] = [];
    private _habitatIndexes: number[] = [];
    private _builtObjectIndexes: number[] = [];
    private _empireIndexes: number[] = [];
    private _habitatOrders: Order[][] = [];
    private _builtObjectOrders: Order[][] = [];
    private _empireOrders: Order[][] = [];
    private _isIndexed = false;

    constructor(indexed = false) {
        this._isIndexed = indexed;
    }

    get isIndexed(): boolean {
        return this._isIndexed;
    }
    enableIndexing(): void {
        this._isIndexed = true;
    }
    get count(): number {
        return this.items.length;
    }
    /** Array-style alias (digest.ts reads `.length`). */
    get length(): number {
        return this.items.length;
    }
    at(index: number): Order {
        return this.items[index];
    }
    contains(order: Order): boolean {
        return this.items.indexOf(order) >= 0;
    }
    /** List<T>.AddRange (bypasses the indexing Add, as in the C# base call). */
    addRange(orders: OrderList | Order[]): void {
        const src = orders instanceof OrderList ? orders.items : orders;
        for (let i = 0; i < src.length; i++) this.items.push(src[i]);
    }

    // OrderList.cs 27 Add.
    add(order: Order): void {
        this.items.push(order);
        if (!this._isIndexed) return;
        let empire: Empire | null = null;
        if (order.requestingBuiltObject !== null) {
            empire = order.requestingBuiltObject.actualEmpire;
            addIndexed(this._builtObjectIndexes, this._builtObjectOrders, order.requestingBuiltObject.builtObjectID, order);
        }
        if (order.requestingColony !== null) {
            empire = order.requestingColony.empire;
            addIndexed(this._habitatIndexes, this._habitatOrders, order.requestingColony.habitatIndex, order);
        }
        if (empire === null) return;
        addIndexed(this._empireIndexes, this._empireOrders, empire.empireId, order);
    }

    // OrderList.cs 90 Remove.
    remove(order: Order): void {
        const i = this.items.indexOf(order);
        if (i >= 0) this.items.splice(i, 1);
        if (!this._isIndexed) return;
        let empire: Empire | null = null;
        if (order.requestingBuiltObject !== null) {
            empire = order.requestingBuiltObject.actualEmpire;
            removeIndexed(this._builtObjectIndexes, this._builtObjectOrders, order.requestingBuiltObject.builtObjectID, order);
        }
        if (order.requestingColony !== null) {
            empire = order.requestingColony.empire;
            removeIndexed(this._habitatIndexes, this._habitatOrders, order.requestingColony.habitatIndex, order);
        }
        if (empire === null) return;
        removeIndexed(this._empireIndexes, this._empireOrders, empire.empireId, order);
    }

    // OrderList.cs 139 UpdateHabitatIndexes (Habitat.cs 7617 on planet removal).
    updateHabitatIndexes(startIndex: number, offset: number): void {
        if (!this._isIndexed) return;
        for (let index = 0; index < this._habitatIndexes.length; ++index) {
            const habitatIndex = this._habitatIndexes[index];
            if (habitatIndex >= startIndex) this._habitatIndexes[index] = habitatIndex + offset;
        }
    }

    // OrderList.cs 157 GetOrders(Habitat).
    getOrdersForHabitat(colony: Habitat): OrderList {
        const orders = new OrderList();
        if (this._isIndexed) {
            const index = this._habitatIndexes.indexOf(colony.habitatIndex);
            if (index >= 0 && this._habitatOrders.length > index) orders.addRange(this._habitatOrders[index].slice());
        } else {
            for (let index = 0; index < this.items.length; ++index) {
                const order = this.items[index];
                if (order.requestingColony === colony) orders.add(order);
            }
        }
        return orders;
    }

    // OrderList.cs 187 GetOrders(BuiltObject).
    getOrdersForBuiltObject(builtObject: BuiltObject): OrderList {
        const orders = new OrderList();
        if (this._isIndexed) {
            const index = this._builtObjectIndexes.indexOf(builtObject.builtObjectID);
            if (index >= 0 && this._builtObjectOrders.length > index) orders.addRange(this._builtObjectOrders[index].slice());
        } else {
            for (let index = 0; index < this.items.length; ++index) {
                const order = this.items[index];
                if (order.requestingBuiltObject === builtObject) orders.add(order);
            }
        }
        return orders;
    }

    // OrderList.cs 217 GetOrders(Empire).
    getOrdersForEmpire(empire: Empire): OrderList {
        const orders = new OrderList();
        if (this._isIndexed) {
            const index = this._empireIndexes.indexOf(empire.empireId);
            if (index >= 0 && this._empireOrders.length > index) orders.addRange(this._empireOrders[index].slice());
        } else {
            for (let index = 0; index < this.items.length; ++index) {
                const order = this.items[index];
                if (order.requestingColony !== null && order.requestingColony.owner === empire) orders.add(order);
                else if (order.requestingBuiltObject !== null && order.requestingBuiltObject.actualEmpire === empire) orders.add(order);
            }
        }
        return orders;
    }

    // OrderList.cs 249 GetOrders(byte resourceId).
    getOrdersForResourceId(resourceId: number): OrderList {
        const orders = new OrderList();
        for (let index = 0; index < this.items.length; ++index) {
            const r = this.items[index].commodityResource;
            if (r !== null && r.resourceId === resourceId) orders.add(this.items[index]);
        }
        return orders;
    }

    // OrderList.cs 275 IndexOf(byte resourceId, int startIndex).
    indexOfResourceId(resourceId: number, startIndex: number): number {
        if (startIndex >= this.items.length) return -1;
        for (let index = startIndex; index < this.items.length; ++index) {
            const r = this.items[index].commodityResource;
            if (r !== null && r.resourceId === resourceId) return index;
        }
        return -1;
    }

    // OrderList.cs 290 SplitOrdersByType.
    splitOrdersByType(): { standardOrders: OrderList; constructionShortageOrders: OrderList; constructionShortageMobileOrders: OrderList; retrofitResourcesForBaseOrders: OrderList } {
        const standardOrders = new OrderList();
        const constructionShortageOrders = new OrderList();
        const constructionShortageMobileOrders = new OrderList();
        const retrofitResourcesForBaseOrders = new OrderList();
        for (let index = 0; index < this.items.length; ++index) {
            const order = this.items[index];
            if (order == null) continue;
            switch (order.type) {
                case OrderType.Standard:
                    standardOrders.add(order);
                    break;
                case OrderType.RetrofitResourcesForBase:
                    retrofitResourcesForBaseOrders.add(order);
                    break;
                case OrderType.ConstructionShortage:
                    constructionShortageOrders.add(order);
                    break;
                case OrderType.ConstructionShortageMobile:
                    constructionShortageMobileOrders.add(order);
                    break;
            }
        }
        return { standardOrders, constructionShortageOrders, constructionShortageMobileOrders, retrofitResourcesForBaseOrders };
    }

    // OrderList.cs 326 MergeRange.
    mergeRange(orders: OrderList): void {
        for (let index = 0; index < orders.items.length; ++index) {
            const order = orders.items[index];
            if (order != null && !this.contains(order)) this.add(order);
        }
    }
}

function addIndexed(keys: number[], lists: Order[][], key: number, order: Order): void {
    const index = keys.indexOf(key);
    if (index >= 0) {
        if (lists[index] == null) lists[index] = [];
        lists[index].push(order);
    } else {
        keys.push(key);
        lists.push([order]);
    }
}

function removeIndexed(keys: number[], lists: Order[][], key: number, order: Order): void {
    const index = keys.indexOf(key);
    if (index < 0) return;
    const list = lists[index];
    const i = list.indexOf(order);
    if (i >= 0) list.splice(i, 1);
    if (list.length === 0) {
        lists.splice(index, 1);
        keys.splice(index, 1);
    }
}

/** Galaxy.Orders: an OrderList with indexing enabled (Galaxy.4.cs 2356). */
export function createGalaxyOrderList(): OrderList {
    return new OrderList(true);
}

// ------------------------------------------------------------------------------------------
// C# CargoList / Cargo lookups on the TS CargoList. C# identifies a cargo's owner by EmpireId (-1 when the Cargo was
// built with a null Empire); the TS Cargo stores the Empire object (null/undefined = -1).

/** Cargo.EmpireId. */
export function cargoEmpireId(cargo: Cargo): number {
    const e = cargo.empire as Empire | null | undefined;
    return e == null ? -1 : e.empireId;
}

/** Cargo.Available => Amount - Reserved (Cargo.cs 91). */
export function cargoAvailable(cargo: Cargo): number {
    return (cargo.amount - cargo.reserved) | 0;
}

/**
 * CargoList.GetExists(Resource) (CargoList.cs 21): the per-resource "exists" bit, set on Add and recomputed on Remove
 * as "some empire still holds this resource" — i.e. whether any entry carries the resource.
 */
export function cargoGetExists(list: CargoList, resourceId: number): boolean {
    for (let i = 0; i < list.items.length; i++) if (list.items[i].commodity.resourceId === resourceId) return true;
    return false;
}

/** CargoList.IndexOf(Resource, int empireId) (CargoList.cs 740): -1 for a negative empire id. */
export function cargoIndexOfById(list: CargoList, resourceId: number, empireId: number): number {
    if (empireId < 0) return -1;
    for (let i = 0; i < list.items.length; i++) {
        const c = list.items[i];
        if (c.commodity.resourceId === resourceId && cargoEmpireId(c) === empireId) return i;
    }
    return -1;
}

/** CargoList.IndexOf(Resource, Empire) (CargoList.cs 738). */
export function cargoIndexOf(list: CargoList, resourceId: number, empire: Empire | null): number {
    return empire !== null ? cargoIndexOfById(list, resourceId, empire.empireId) : -1;
}

/** CargoList.GetCargo(Resource, Empire) (CargoList.cs 731); GetCargoOptimized(Resource, int) (748) / GetCargo(Resource, int) (761) by id. */
export function cargoGetCargo(list: CargoList, resourceId: number, empire: Empire | null): Cargo | null {
    if (empire === null) return null;
    const index = cargoIndexOfById(list, resourceId, empire.empireId);
    return index >= 0 ? list.items[index] : null;
}
export function cargoGetCargoById(list: CargoList, resourceId: number, empireId: number): Cargo | null {
    const index = cargoIndexOfById(list, resourceId, empireId);
    return index >= 0 ? list.items[index] : null;
}

/** CargoList.TotalUnits (CargoList.cs 531): int sum of Amount. */
export function cargoTotalUnits(list: CargoList): number {
    let totalUnits = 0;
    for (let i = 0; i < list.items.length; i++) totalUnits = (totalUnits + list.items[i].amount) | 0;
    return totalUnits;
}

/**
 * CargoList.Remove(Cargo) (CargoList.cs 227): locates the entry through IndexOf(resource, cargo.EmpireId), which is
 * -1 for an unowned cargo (EmpireId < 0) — the C# then returns without removing anything.
 */
export function cargoRemove(list: CargoList, cargo: Cargo): void {
    if (cargoIndexOfById(list, cargo.commodity.resourceId, cargoEmpireId(cargo)) < 0) return;
    list.remove(cargo);
}

// ------------------------------------------------------------------------------------------
// Empire money helpers.

/** Empire.4.cs 1766 PerformPrivateTransaction(transactionAmount). */
export function performPrivateTransaction(galaxy: Galaxy, empire: Empire, transactionAmount: number): number {
    const gov = empireGovernmentAttributes(empire);
    if (gov !== null && gov.specialFunctionCode === 1) {
        empire.stateMoney += transactionAmount;
        return empire.stateMoney;
    }
    if (empire.pirateEmpireBaseHabitat !== null) {
        empire.stateMoney += transactionAmount;
        return empire.stateMoney;
    }
    countersProcessColonyRevenue(galaxy, empire, transactionAmount);
    empire.privateMoney += transactionAmount;
    return empire.privateMoney;
}

/** Empire.4.cs 3396 ApplyCorruptionToIncome(incomeAmount). */
export function applyCorruptionToIncome(empire: Empire, incomeAmount: number): number {
    if (empire.pirateEmpireBaseHabitat !== null) {
        const num = incomeAmount * empire.corruption;
        return incomeAmount - num;
    }
    return incomeAmount;
}

// ------------------------------------------------------------------------------------------
// Order creation.

/** C# (int) of a finite double (truncation toward zero; values here fit an int). */
function csInt(v: number): number {
    return Math.trunc(v) | 0;
}

/** Galaxy.6.cs 3822 CorrectSectorCoords (SectorMaxX/Y = SectorWidth/Height, Galaxy.3.cs 5727). */
function correctSectorCoords(galaxy: Galaxy, x: number, y: number): { x: number; y: number } {
    if (x < 0) x = 0;
    else if (x >= galaxy.sectorWidth) x = galaxy.sectorWidth - 1;
    if (y < 0) y = 0;
    else if (y >= galaxy.sectorHeight) y = galaxy.sectorHeight - 1;
    return { x, y };
}

/** Galaxy.3.cs 1864-1906 CalculateMaximumOrderFulfillmentDistance(x, y). */
export function calculateMaximumOrderFulfillmentDistance(galaxy: Galaxy, xPos: number, yPos: number): number {
    let num = 0;
    switch (galaxy.galaxyShape) {
        case GalaxyShape.Elliptical: {
            const c = correctSectorCoords(galaxy, Math.trunc(csInt(xPos) / SECTOR_SIZE), Math.trunc(csInt(yPos) / SECTOR_SIZE));
            num = c.x <= 3 || c.x >= 8 || c.y <= 3 || c.y >= 8 ? TYPICAL_MAXIMUM_ORDER_FULFILLMENT_DISTANCE * 2 : TYPICAL_MAXIMUM_ORDER_FULFILLMENT_DISTANCE;
            break;
        }
        case GalaxyShape.Irregular:
        case GalaxyShape.ClustersEven:
        case GalaxyShape.ClustersVaried:
            num = TYPICAL_MAXIMUM_ORDER_FULFILLMENT_DISTANCE;
            break;
        case GalaxyShape.Ring:
            num = TYPICAL_MAXIMUM_ORDER_FULFILLMENT_DISTANCE * 2;
            break;
        case GalaxyShape.Spiral: {
            // C# oddity: the distance is measured to (yPos, yPos), not (xPos, yPos).
            const num2 = csInt(galaxy.calculateDistance(Math.trunc(galaxy.sizeX / 2), Math.trunc(galaxy.sizeY / 2), yPos, yPos));
            num = Math.min(1, Math.trunc(num2 / Math.trunc(galaxy.sizeX / 4))) * TYPICAL_MAXIMUM_ORDER_FULFILLMENT_DISTANCE;
            break;
        }
    }
    if (galaxy.sectorWidth > 10 || galaxy.sectorHeight > 10) {
        num = csInt(num * (Math.max(galaxy.sectorWidth, galaxy.sectorHeight) / 10.0));
    }
    return num;
}

/** Resource.IsLuxuryResource (Resource.cs 32): Group == Luxury. */
export function isLuxuryResource(galaxy: Galaxy, resourceId: number): boolean {
    const def = galaxy.resourceSystem.byId.get(resourceId);
    return def !== undefined && def.type === 2; // TS type 2 = ResourceGroup.Luxury
}

/** Resource.IsRestrictedResource (Resource.cs 34): SuperLuxuryBonusAmount > 0. */
export function isRestrictedResource(galaxy: Galaxy, resourceId: number): boolean {
    const def = galaxy.resourceSystem.byId.get(resourceId);
    return def !== undefined && def.superLuxuryBonusAmount > 0;
}

/** Galaxy.cs 1757-1773 CreateOrder(colony, resource, amount, isState[, allowExpiry = false]) (Type stays Standard). */
export function galaxyCreateOrder(galaxy: Galaxy, colony: Habitat, resource: ResourceRef, amount: number, isState: boolean, allowExpiry = false): Order {
    const currentStarDate = galaxyStarDate(galaxy);
    let expiryDate = currentStarDate + csInt(ORDER_EXPIRY_YEARS_LUXURY * REAL_SECONDS_IN_GALACTIC_YEAR * 1000.0);
    if (!allowExpiry || !isLuxuryResource(galaxy, resource.resourceId)) {
        expiryDate = currentStarDate + csInt(1000.0 * REAL_SECONDS_IN_GALACTIC_YEAR * 1000.0);
    }
    // Galaxy.cs 1765 CreateOrder(colony, resource, amount, isState, expiryDate).
    const maximumFulfillmentDistance = calculateMaximumOrderFulfillmentDistance(galaxy, colony.xpos, colony.ypos);
    const order = new Order(galaxy, colony, resource, amount, expiryDate, maximumFulfillmentDistance);
    order.minimumContractSize = MINIMUM_CONTRACT_SIZE;
    order.isStateOrder = isState;
    galaxy.orders.add(order);
    return order;
}

/**
 * Empire.4.cs 4048-4098 CreateOrder(colony | builtObject, resource, amount, isState, type[, allowExpiry = false]).
 * The expiry uses (long) casts here (the Galaxy overload uses (int)); same values.
 */
export function empireCreateOrder(galaxy: Galaxy, empire: Empire, requester: Habitat | BuiltObject, resource: ResourceRef, amount: number, isState: boolean, type: OrderType, allowExpiry = false): Order {
    void empire;
    const currentStarDate = galaxyStarDate(galaxy);
    let expiryDate = currentStarDate + Math.trunc(ORDER_EXPIRY_YEARS_LUXURY * REAL_SECONDS_IN_GALACTIC_YEAR * 1000.0);
    if (!allowExpiry || !isLuxuryResource(galaxy, resource.resourceId)) {
        expiryDate = currentStarDate + Math.trunc(1000.0 * REAL_SECONDS_IN_GALACTIC_YEAR * 1000.0);
    }
    const maximumFulfillmentDistance = calculateMaximumOrderFulfillmentDistance(galaxy, requester.xpos, requester.ypos);
    // 4092 (BuiltObject overload only): _ = ResourceCurrentPrices[resource.ResourceID] — no effect.
    const order = new Order(galaxy, requester, resource, amount, expiryDate, maximumFulfillmentDistance);
    order.type = type;
    order.minimumContractSize = MINIMUM_CONTRACT_SIZE;
    order.isStateOrder = isState;
    galaxy.orders.add(order);
    return order;
}

// ------------------------------------------------------------------------------------------
// Order cleanup (Galaxy.1.cs; called by the Galaxy long block, tick/galaxyTick.ts 137-138).

/** Galaxy.1.cs 1047 RemoveCompletedOrders. No Rnd. */
export function removeCompletedOrders(orders: OrderList): void {
    const orderList: Order[] = [];
    for (let i = 0; i < orders.items.length; i++) {
        const order = orders.items[i];
        const num = order.amountRequested - order.amountDelivered;
        if (num <= 0) orderList.push(order);
    }
    for (const item of orderList) orders.remove(item);
}

/** Galaxy.1.cs 1126 CancelExpiredOrders. No Rnd. */
export function cancelExpiredOrders(galaxy: Galaxy, orders: OrderList): void {
    const currentStarDate = galaxyStarDate(galaxy);
    const orderList: Order[] = [];
    for (let i = 0; i < orders.items.length; i++) {
        const order = orders.items[i];
        if (currentStarDate <= order.expiryDate || order.amountStillToArrive > 0) continue;
        orderList.push(order);
        if (order.contracts === null || order.contracts.length <= 0) continue;
        for (let j = 0; j < order.contracts.length; j++) {
            const contract = order.contracts[j];
            if (contract !== null) cancelContract(galaxy, contract);
        }
    }
    for (const item of orderList) orders.remove(item);
}

/** Galaxy.1.cs 1062-1084 CalculateOrderPlacementDate(order, out timeSinceOrderPlacement). */
export function calculateOrderPlacementDate(galaxy: Galaxy, order: Order): { placementDate: number; timeSinceOrderPlacement: number } {
    const num2 = csInt(ORDER_EXPIRY_YEARS_LUXURY * REAL_SECONDS_IN_GALACTIC_YEAR * 1000.0);
    const num3 = csInt(1000.0 * REAL_SECONDS_IN_GALACTIC_YEAR * 1000.0);
    const currentStarDate = galaxyStarDate(galaxy);
    const num4 = order.expiryDate - currentStarDate;
    const num = num4 <= num2 ? order.expiryDate - num2 : order.expiryDate - num3;
    return { placementDate: num, timeSinceOrderPlacement: currentStarDate - num };
}

// ------------------------------------------------------------------------------------------
// Empire.1.cs 1029 ProcessTradeBonuses(timePassed). No Rnd.

/** DiplomaticRelation.cs 141 AnnualTradeBonus. */
export function annualTradeBonus(relation: DiplomaticRelation): number {
    let val1 = 0.0;
    switch (relation.type) {
        case DiplomaticRelationType.FreeTradeAgreement:
            val1 = TRADE_BONUS_MAXIMUM_FREE_TRADE_AMOUNT / TRADE_BONUS_MAXIMUM_FREE_TRADE;
            break;
        case DiplomaticRelationType.MutualDefensePact:
        case DiplomaticRelationType.Protectorate:
            val1 = TRADE_BONUS_MAXIMUM_MUTUAL_DEFENSE_AMOUNT / TRADE_BONUS_MAXIMUM_MUTUAL_DEFENSE;
            break;
    }
    return relation.tradeBonus * Math.min(val1, relation.normalizedAnnualTradeValue);
}

/** Empire.1.cs 1029 ProcessTradeBonuses(timePassed) — timePassed in seconds (the intermediate-block num4). */
export function processTradeBonuses(galaxy: Galaxy, empire: Empire, timePassed: number): void {
    const num = timePassed / REAL_SECONDS_IN_GALACTIC_YEAR;
    const num2 = TRADE_BONUS_ANNUAL_INCREASE * num;
    const currentStarDate = galaxyStarDate(galaxy);
    for (let i = 0; i < empire.diplomaticRelations.count; i++) {
        const diplomaticRelation = empire.diplomaticRelations.at(i);
        diplomaticRelation.ageTradeValues(currentStarDate);
        let num3 = 0.0;
        switch (diplomaticRelation.type) {
            case DiplomaticRelationType.FreeTradeAgreement:
                diplomaticRelation.tradeBonus += num2;
                diplomaticRelation.tradeBonus = Math.min(diplomaticRelation.tradeBonus, TRADE_BONUS_MAXIMUM_FREE_TRADE);
                num3 = annualTradeBonus(diplomaticRelation) * num;
                break;
            case DiplomaticRelationType.MutualDefensePact:
            case DiplomaticRelationType.Protectorate:
                diplomaticRelation.tradeBonus += num2;
                diplomaticRelation.tradeBonus = Math.min(diplomaticRelation.tradeBonus, TRADE_BONUS_MAXIMUM_MUTUAL_DEFENSE);
                num3 = annualTradeBonus(diplomaticRelation) * num;
                break;
            default:
                diplomaticRelation.tradeBonus = 0.0;
                break;
        }
        empire.stateMoney += num3;
    }
}

// ------------------------------------------------------------------------------------------
// Empire.4.cs 4311 ReviewRestrictedResourceTrading. No Rnd.

/** Empire.6.cs 1387 DetermineResourcesEmpireSupplies (ResourceList of ids, first-seen order). */
export function determineResourcesEmpireSupplies(empire: Empire): number[] {
    const resourceList: number[] = [];
    if (empire.colonies != null) {
        for (let i = 0; i < empire.colonies.length; i++) {
            const habitat = empire.colonies[i];
            if (habitat == null || habitat.resources == null) continue;
            for (const resource2 of habitat.resources) {
                if (resourceList.indexOf(resource2.resourceId) < 0) resourceList.push(resource2.resourceId);
            }
        }
    }
    for (let j = 0; j < empire.privateBuiltObjects.length; j++) {
        const builtObject = empire.privateBuiltObjects[j];
        if (builtObject == null || (builtObject.subRole !== BuiltObjectSubRole.GasMiningStation && builtObject.subRole !== BuiltObjectSubRole.MiningStation) || builtObject.parentHabitat == null || builtObject.parentHabitat.resources == null) continue;
        for (const resource3 of builtObject.parentHabitat.resources) {
            if (resourceList.indexOf(resource3.resourceId) < 0) resourceList.push(resource3.resourceId);
        }
    }
    return resourceList;
}

/** Empire.7.cs 4697 CheckEmpireSuppliesRestrictedResources(out resource). */
export function checkEmpireSuppliesRestrictedResources(galaxy: Galaxy, empire: Empire): { supplies: boolean; resource: number } {
    const resourceList = determineResourcesEmpireSupplies(empire);
    const superLuxury = galaxy.resourceSystem.superLuxuryResources;
    for (let i = 0; i < superLuxury.length; i++) {
        const resourceDefinition = superLuxury[i];
        if (resourceDefinition != null && resourceList.indexOf(resourceDefinition.resourceId) >= 0) {
            return { supplies: true, resource: resourceDefinition.resourceId };
        }
    }
    return { supplies: false, resource: 255 };
}

/** Empire.4.cs 4359 DetermineWhetherTradeRestrictedResourcesWithEmpire(otherEmpire). */
export function determineWhetherTradeRestrictedResourcesWithEmpire(empire: Empire, otherEmpire: Empire | null): boolean {
    let result = false;
    const diplomaticRelation = obtainDiplomaticRelation(empire, otherEmpire);
    switch (diplomaticRelation.strategy) {
        case DiplomaticStrategy.Befriend:
        case DiplomaticStrategy.Placate:
        case DiplomaticStrategy.Ally:
        case DiplomaticStrategy.DefendPlacate:
            result = true;
            break;
    }
    return result;
}

/**
 * Empire.8.cs 4374-4501 CheckTaskAuthorized(automationLevel, taskDescription, taskTarget, advisorMessageType) with
 * refusalCount 0 and no attack target. TS AutomationLevel.Undefined / PartiallyAutomated are the C# Manual /
 * SemiAutomated (same values).
 */
export function checkTaskAuthorized(galaxy: Galaxy, empire: Empire, automationLevel: AutomationLevel, taskTarget: unknown): boolean {
    void taskTarget;
    let result = true;
    switch (automationLevel) {
        case AutomationLevel.PartiallyAutomated:
            result = false;
            // TODO(port) M4b: `refusalCount >= MaximumMissionRefusals || !_DeclinedTasks.CheckTaskTargetValid(taskTarget,
            // starDate)` breaks with false — declined tasks are only added by the player path below / on a player "No",
            // so an AI empire's list is empty and the check passes.
            if (empire === galaxy.playerEmpire) {
                // TODO(port) M9: player prompt — EmpireMessage(AdvisorSuggestion) + PromptPlayerForAuthorization and
                // DeclinedTask(taskTarget, starDate + 600000); the C# returns false here.
                return false;
            }
            // Non-player: _AutomationResponse is forced to Yes.
            result = true;
            break;
        case AutomationLevel.Undefined: // Manual
            result = false;
            break;
    }
    return result;
}

/** Empire.4.cs 4311 ReviewRestrictedResourceTrading. */
export function reviewRestrictedResourceTrading(galaxy: Galaxy, empire: Empire): void {
    if (!checkEmpireSuppliesRestrictedResources(galaxy, empire).supplies || empire.reclusive) return;
    for (let i = 0; i < empire.diplomaticRelations.count; i++) {
        const diplomaticRelation = empire.diplomaticRelations.at(i);
        if (diplomaticRelation.otherEmpire === empire) continue;
        const flag = determineWhetherTradeRestrictedResourcesWithEmpire(empire, diplomaticRelation.otherEmpire);
        if (flag === diplomaticRelation.supplyRestrictedResources) continue;
        // AdvisorMessageType Allow/DisallowTradeRestrictedResources and the automation text
        // (GenerateAutomationMessageTradeRestrictedResources, Empire.10.cs 4038) only feed the player prompt.
        if (checkTaskAuthorized(galaxy, empire, empire.controlDiplomacyTreaties, diplomaticRelation.otherEmpire)) {
            let empty = '';
            let empireMessageType = EmpireMessageType.RestrictedResourceTradingAllowed;
            if (flag) {
                // TextResolver "Trade Restricted Resource EMPIRE" (GameText.txt 1437).
                empty = `The ${empire.name} have agreed to trade rare restricted resources with us`;
                empireMessageType = EmpireMessageType.RestrictedResourceTradingAllowed;
            } else {
                // TextResolver "Trade Restricted Resource Refuse EMPIRE" (GameText.txt 1438).
                empty = `The ${empire.name} have refused to trade rare restricted resources with us`;
                empireMessageType = EmpireMessageType.RestrictedResourceTradingBlocked;
            }
            sendMessageToEmpire(empire, diplomaticRelation.otherEmpire, empireMessageType, empire, empty);
            diplomaticRelation.supplyRestrictedResources = flag;
        }
    }
}

// ------------------------------------------------------------------------------------------
// Empire.1.cs 4275 MaintainBaseResourceLevels. No Rnd.

/**
 * `Role == Base && (ParentHabitat == null || ParentHabitat.Empire == null || ParentHabitat.Empire != Empire) &&
 * BuiltAt == null` — the "base not at a colony of its own empire" test shared by MaintainBaseResourceLevels and the
 * CalculateResourceLevel overloads (callers add HasBeenDestroyed / CargoSpace as the C# does).
 */
export function isBaseNotAtOwnColony(builtObject: BuiltObject): boolean {
    return builtObject.role === BuiltObjectRole.Base && (builtObject.parentHabitat === null || builtObject.parentHabitat.empire === null || builtObject.parentHabitat.empire !== builtObject.empire) && builtObject.builtAt == null;
}

/** Empire.1.cs 4275 MaintainBaseResourceLevels. */
export function maintainBaseResourceLevels(galaxy: Galaxy, empire: Empire): void {
    for (let i = 0; i < empire.builtObjects.length; i++) {
        const builtObject = empire.builtObjects[i];
        if (builtObject != null && !builtObject.hasBeenDestroyed && isBaseNotAtOwnColony(builtObject) && builtObject.cargoSpace > 0) {
            maintainBaseResourceLevelsSingleBase(galaxy, empire, builtObject);
        }
    }
    for (let j = 0; j < empire.privateBuiltObjects.length; j++) {
        const builtObject2 = empire.privateBuiltObjects[j];
        if (builtObject2 != null && !builtObject2.hasBeenDestroyed && isBaseNotAtOwnColony(builtObject2) && builtObject2.cargoSpace > 0) {
            maintainBaseResourceLevelsSingleBase(galaxy, empire, builtObject2);
        }
    }
}

/** Empire.1.cs 4294 MaintainBaseResourceLevelsSingleBase. */
function maintainBaseResourceLevelsSingleBase(galaxy: Galaxy, empire: Empire, baseNotAtColony: BuiltObject): void {
    const orders = galaxy.orders.getOrdersForBuiltObject(baseNotAtColony);
    const ordered = galaxy.resourceSystem.strategicResourcesOrderedByRelativeImportance;
    for (let i = 0; i < ordered.length; i++) {
        const resourceDefinition = ordered[i];
        if (resourceDefinition != null) {
            const resource = new ResourceRef(resourceDefinition.resourceId);
            checkAndOrderResourceBaseNotAtColony(galaxy, empire, baseNotAtColony, orders, resource);
        }
    }
}

/** Empire.1.cs 4309 CheckAndOrderResource(baseNotAtColony, baseOrders, resource). */
function checkAndOrderResourceBaseNotAtColony(galaxy: Galaxy, empire: Empire, baseNotAtColony: BuiltObject, baseOrders: OrderList, resource: ResourceRef): void {
    const num = calculateResourceLevelStockForBaseRetrofit(galaxy, resource.resourceId);
    const r = checkResourceMeetsMinimumLevelBaseNotAtColony(resource, num, num, baseNotAtColony, baseOrders);
    if (!r.meets) {
        const num2 = r.amountToOrder * galaxyResourceCurrentPrices(galaxy)[resource.resourceId];
        if (num2 < getPrivateFunds(empire)) {
            empireCreateOrder(galaxy, empire, baseNotAtColony, resource, r.amountToOrder, false, OrderType.RetrofitResourcesForBase);
        }
    }
}

/** BaconEmpire.cs 667 CheckResourceMeetsMinimumLevelBaseNotAtColony (maximumResourceLevel overridden by BaconMain). */
function checkResourceMeetsMinimumLevelBaseNotAtColony(resource: ResourceRef, minimumResourceLevel: number, maximumResourceLevel: number, baseNotAtColony: BuiltObject, baseOrders: OrderList): { meets: boolean; amountToOrder: number } {
    void maximumResourceLevel;
    maximumResourceLevel = baconSettings.maximumResourceLevelToStockAtBaseNotAtColony;
    let flag = false;
    let num = 0;
    let index1 = -1;
    const cargo = baseNotAtColony.cargo;
    if (cargo !== null && cargoGetExists(cargo, resource.resourceId)) index1 = cargoIndexOf(cargo, resource.resourceId, baseNotAtColony.empire);
    if (index1 >= 0) num = Math.max(0, cargoAvailable(cargo!.items[index1]));
    let startIndex = 0;
    for (let index2 = baseOrders.indexOfResourceId(resource.resourceId, 0); index2 >= 0; index2 = baseOrders.indexOfResourceId(resource.resourceId, startIndex)) {
        const amountRequested = baseOrders.items[index2].amountRequested;
        num = (num + amountRequested) | 0;
        startIndex = index2 + 1;
    }
    const amountToOrder = Math.max(0, maximumResourceLevel - num);
    if (num >= minimumResourceLevel) flag = true;
    return { meets: flag, amountToOrder };
}

// ------------------------------------------------------------------------------------------
// CheckForUnownedCargo (BuiltObject.cs 3568 / Habitat.cs 1558). No Rnd.
//
// C# oddity kept: CargoList.Remove(cargo) is a no-op for an unowned cargo (IndexOf(resource, -1) returns -1), so the
// unowned entry stays and a copy owned by the holder's empire is merged in on every call.

function checkForUnownedCargo(cargoList: CargoList | null, empire: Empire | null): void {
    if (cargoList === null || cargoList.items.length <= 0) return;
    if (empire === null) return;
    const newCargo = new CargoList();
    const unowned: Cargo[] = [];
    for (let i = 0; i < cargoList.items.length; i++) {
        const cargo = cargoList.items[i];
        if (cargo != null && cargoEmpireId(cargo) < 0) {
            // TODO(port): component cargo (cargo.CommodityIsComponent → new Cargo(cargo.Component, …)); TS cargo is
            // resource-only.
            const cargo2 = new Cargo(new ResourceRef(cargo.commodity.resourceId), cargo.amount, empire, 0);
            newCargo.add(cargo2);
            // cargoList2.Add(cargo): a CargoList merges by (EmpireId, resource); these all have EmpireId -1 and
            // distinct resources (the holder's list already merged them), so this is a plain append.
            unowned.push(cargo);
        }
    }
    for (let j = 0; j < unowned.length; j++) cargoRemove(cargoList, unowned[j]);
    for (const item of newCargo.items) cargoList.add(item);
}

/** BuiltObject.cs 3568 CheckForUnownedCargo. */
export function checkForUnownedCargoBuiltObject(galaxy: Galaxy, builtObject: BuiltObject): void {
    void galaxy;
    checkForUnownedCargo(builtObject.cargo, builtObject.empire);
}

/** Habitat.cs 1558 CheckForUnownedCargo. */
export function checkForUnownedCargoHabitat(galaxy: Galaxy, habitat: Habitat): void {
    void galaxy;
    checkForUnownedCargo(habitat.cargo, habitat.empire);
}

/**
 * Empire.6.cs 1313 CountResourceSupplyLocations(resourceId, includeIndependentColonies) (ported by M4s; the second C#
 * parameter is includeIndependentColonies). No Rnd.
 */
export function countResourceSupplyLocations(galaxy: Galaxy, empire: Empire, resourceId: number, includeIndependentColonies: boolean): number {
    let num = 0;
    const builtObjectList: BuiltObject[] = [];
    builtObjectList.push(...empire.builtObjects);
    builtObjectList.push(...empire.privateBuiltObjects);
    for (let i = 0; i < empire.colonies.length; i++) {
        const habitat = empire.colonies[i];
        if (habitat.empire !== empire) continue;
        for (const resource of habitat.resources) if (resource.resourceId === resourceId) num++;
    }
    for (let j = 0; j < builtObjectList.length; j++) {
        const builtObject = builtObjectList[j];
        if (builtObject.subRole === BuiltObjectSubRole.GasMiningStation || builtObject.subRole === BuiltObjectSubRole.MiningStation) {
            if (builtObject.parentHabitat === null) continue;
            for (const resource2 of builtObject.parentHabitat.resources) if (resource2.resourceId === resourceId) num++;
        } else {
            if (
                empire.pirateEmpireBaseHabitat === null ||
                (builtObject.subRole !== BuiltObjectSubRole.SmallSpacePort && builtObject.subRole !== BuiltObjectSubRole.MediumSpacePort && builtObject.subRole !== BuiltObjectSubRole.LargeSpacePort) ||
                builtObject.parentHabitat === null ||
                builtObject.parentHabitat.empire === empire
            )
                continue;
            for (const resource3 of builtObject.parentHabitat.resources) if (resource3.resourceId === resourceId) num++;
        }
    }
    if (includeIndependentColonies) {
        for (let k = 0; k < galaxy.independentColonies.length; k++) {
            const habitat2 = galaxy.independentColonies[k];
            if (habitat2.empire !== galaxy.independentEmpire || !empire.visibility.checkSystemExplored(habitat2.systemIndex)) continue;
            for (const resource4 of habitat2.resources) if (resource4.resourceId === resourceId) num++;
        }
    }
    return num;
}
