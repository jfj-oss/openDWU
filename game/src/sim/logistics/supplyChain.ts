// Supply-chain visibility (Improvements "supplyChain", inspired by Distant Worlds 2). NOT a port: DW:U never showed
// what a yard waits for. Pure, read-only queries over the state the logistics port already keeps:
// - construction: each yard's ConstructionQueue (ConstructionQueue.cs; ships on the slipways, then the wait queue), the
//   parent's ManufacturingQueue (ManufacturingQueue.cs: components being made, DeficientResources) and the parent's
//   cargo (resources and finished components, CargoList.cs) — a ship on a slipway builds one component at a time from
//   component cargo (ConstructionQueue.cs 765-790), and a component is made from the cargo's resources
//   (CargoList.GetResourcesForManufacturing);
// - deliveries: Galaxy.Orders (Order.cs: the requester's ConstructionShortage / Standard orders) and their contracts
//   (Contract.cs: freighter, supplier, AmountToFulfill / PickedUp / Delivered), the freighters' positions and speeds;
// - colonies: the luxury count EvaluateColonyVariables weighs against development (Empire.4.cs 3016-3060: the colony
//   loses development while it holds fewer luxury types than DevelopmentLevel / 5) and the luxury orders it places
//   (Empire.4.cs 3186 OrderColonyLuxuryResources);
// - production: mining stations / ships and colonies extracting from their habitat (BuiltObject.cs 7859
//   IndustrialProcessing, Habitat.cs 2827 ExtractResources) and the stock held in cargo.
//
// Read-only contract (sim/readOnlyQuery.ts): nothing here writes the galaxy, draws Rnd, reads a real clock or calls a
// lookup that creates records. The UI caches the results (ui/supplyChainCache.ts) and recomputes at most once a second;
// on a sim-worker replica every input is a synced field (orders, contracts, cargo, queues, positions), so it works the
// same there. The numbers are estimates for the player: the sim's own allocation order is not reproduced.
//
// No DOM / Pixi imports.

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import { BuiltObject } from '../builtObject';
import type { Habitat } from '../types';
import type { CargoList } from '../cargo';
import { BuiltObjectSubRole } from '../builtObjectTypes';
import { BuiltObjectRole } from '../data/designSpecifications';
import { ComponentStatus } from '../builtObjectComponent';
import type { ComponentDefinition } from '../componentStatic';
import type { ConstructionQueue } from '../construction/constructionQueue';
import type { ConstructionYard } from '../construction/constructionYard';
import { componentListDiff, resolveComponentList } from '../construction/constructionYard';
import { builtObjectManufacturingQueue, habitatManufacturingQueue, type ManufacturingQueue } from '../manufacturingQueue';
import { ResourceGroup, resourceGroupOf } from '../resourceSystem';
import { estimateTravelMs } from '../player/constructionBoard';
import { calculateOrderPlacementDate, OrderType, type Order } from './orders';
import type { Contract, StellarObject } from './contracts';
import { calculateMinimumLuxuryResourceLevel, calculateMinimumLuxuryResourceLevelRestricted, calculateStrategicResourceConsumptionPerYear } from './colonySupply';
import { COLONY_ANNUAL_LUXURY_RESOURCE_CONSUMPTION_RATE, COLONY_ANNUAL_RESTRICTED_RESOURCE_CONSUMPTION_RATE } from './orders';
import { flowsInWindow, tradeFlowLedger, type FlowRow } from './tradeFlows';

/** A construction site: a base / ship with yards, or a colony. */
export type SupplyTarget = BuiltObject | Habitat;

// ---------------------------------------------------------------------------------------------------------------
// Deliveries (orders → contracts → freighters)
// ---------------------------------------------------------------------------------------------------------------

/** Why a delivery may not arrive as estimated. */
export type DeliveryRisk = 'freighterLost' | 'freighterInCombat' | 'destinationBlockaded' | 'sourceBlockaded';

/** One contract still to deliver. */
export interface Delivery {
    order: Order;
    contract: Contract;
    resourceId: number;
    freighter: BuiltObject | null;
    /** Where it is picked up (the trading post that sold it). */
    supplier: StellarObject | null;
    destination: StellarObject;
    /** Units still to arrive (AmountToFulfill − AmountDelivered). */
    amount: number;
    /** All of it is aboard the freighter (AmountPickedUp ≥ AmountToFulfill). */
    pickedUp: boolean;
    /** Estimated game ms until it arrives (the freighter's travel, via the supplier first when not picked up); null
     *  when there is no live freighter. */
    etaMs: number | null;
    risks: DeliveryRisk[];
}

/** One requester's open orders for one resource. */
export interface ResourceOrders {
    resourceId: number;
    orders: Order[];
    /** Contracted deliveries still to arrive, soonest first (no-ETA ones last). */
    deliveries: Delivery[];
    /** Ordered but not yet contracted to a freighter (AmountRequested − AmountToFulfill, summed). */
    uncontracted: number;
    /** Game ms since the oldest open order was placed (calculateOrderPlacementDate). */
    oldestOrderAgeMs: number;
}

function blockadedAt(o: StellarObject | null): boolean {
    if (o === null) return false;
    if (o instanceof BuiltObject) return o.parentHabitat !== null && o.parentHabitat.isBlockaded === true;
    return (o as Habitat).isBlockaded === true;
}

/** Game ms for `freighter` to deliver: via `supplier` first unless the cargo is aboard. Null without a live freighter. */
export function deliveryEtaMs(galaxy: Galaxy, freighter: BuiltObject | null, supplier: StellarObject | null, destination: StellarObject, pickedUp: boolean): number | null {
    if (freighter === null || freighter.hasBeenDestroyed) return null;
    if (!pickedUp && supplier !== null) {
        return estimateTravelMs(galaxy, freighter, freighter.xpos, freighter.ypos, supplier.xpos, supplier.ypos) + estimateTravelMs(galaxy, freighter, supplier.xpos, supplier.ypos, destination.xpos, destination.ypos);
    }
    return estimateTravelMs(galaxy, freighter, freighter.xpos, freighter.ypos, destination.xpos, destination.ypos);
}

/** The deliveries still to arrive for `order` (one per contract with units outstanding). */
export function orderDeliveries(galaxy: Galaxy, order: Order): Delivery[] {
    const out: Delivery[] = [];
    const destination: StellarObject | null = order.requestingBuiltObject ?? order.requestingColony;
    const res = order.commodityResource;
    if (destination === null || res === null) return out;
    for (const c of order.contracts) {
        if (c == null) continue;
        const amount = c.amountToFulfill - c.amountDelivered;
        if (amount <= 0) continue;
        const freighter = c.freighter;
        const pickedUp = c.amountPickedUp >= c.amountToFulfill;
        const risks: DeliveryRisk[] = [];
        if (freighter === null || freighter.hasBeenDestroyed) risks.push('freighterLost');
        else if (freighter.inBattle) risks.push('freighterInCombat');
        if (blockadedAt(destination)) risks.push('destinationBlockaded');
        if (!pickedUp && blockadedAt(c.supplier)) risks.push('sourceBlockaded');
        out.push({ order, contract: c, resourceId: res.resourceId, freighter, supplier: c.supplier, destination, amount, pickedUp, etaMs: deliveryEtaMs(galaxy, freighter, c.supplier, destination, pickedUp), risks });
    }
    return out;
}

const byEta = (a: Delivery, b: Delivery): number => (a.etaMs ?? Infinity) - (b.etaMs ?? Infinity) || a.amount - b.amount;

/** Group open orders by resource (component orders are skipped), with their deliveries. */
export function resourceOrdersOf(galaxy: Galaxy, orders: readonly Order[]): Map<number, ResourceOrders> {
    const out = new Map<number, ResourceOrders>();
    for (const o of orders) {
        const r = o.commodityResource;
        if (r === null) continue;
        if (o.amountRequested - o.amountDelivered <= 0) continue;
        let e = out.get(r.resourceId);
        if (e === undefined) {
            e = { resourceId: r.resourceId, orders: [], deliveries: [], uncontracted: 0, oldestOrderAgeMs: 0 };
            out.set(r.resourceId, e);
        }
        e.orders.push(o);
        for (const d of orderDeliveries(galaxy, o)) e.deliveries.push(d);
        e.uncontracted += Math.max(0, o.amountOutstandingToContract);
        e.oldestOrderAgeMs = Math.max(e.oldestOrderAgeMs, calculateOrderPlacementDate(galaxy, o).timeSinceOrderPlacement);
    }
    for (const e of out.values()) e.deliveries.sort(byEta);
    return out;
}

/** Galaxy.Orders by requester for one empire's requesters (one pass over the list). */
export function ordersByRequester(galaxy: Galaxy, empire: Empire): Map<StellarObject, Order[]> {
    const out = new Map<StellarObject, Order[]>();
    for (const o of galaxy.orders.items) {
        if (o == null) continue;
        const req: StellarObject | null = o.requestingBuiltObject ?? o.requestingColony;
        if (req === null) continue;
        const owner = o.requestingBuiltObject !== null ? o.requestingBuiltObject.actualEmpire : o.requestingColony!.empire;
        if (owner !== empire) continue;
        let list = out.get(req);
        if (list === undefined) {
            list = [];
            out.set(req, list);
        }
        list.push(o);
    }
    return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Construction: what each queue item waits for
// ---------------------------------------------------------------------------------------------------------------

/** How one item's shortfall of one resource is covered, in queue order (earlier items take the earlier deliveries). */
export interface ItemResourceNeed {
    resourceId: number;
    /** Units the item still needs that are not in stock (after the items ahead of it took theirs). */
    missing: number;
    /** Of `missing`: covered by contracted deliveries, by orders without a freighter yet, by nothing. */
    byDeliveries: number;
    byOrders: number;
    uncovered: number;
    /** The deliveries (and the part of each) that cover it. */
    deliveries: { delivery: Delivery; amount: number }[];
    /** When the deliveries covering it should all have arrived (null: not fully covered by deliveries). */
    etaMs: number | null;
}

export interface QueueItemSupply {
    ship: BuiltObject;
    /** On a slipway (else in the wait queue). */
    yard: ConstructionYard | null;
    /** Components still to build (new build: unbuilt ones; retrofit: the ones still to add). */
    componentsToBuild: number;
    /** Of those: in cargo ready to fit / being manufactured now / to be made from resources. */
    componentsReady: number;
    componentsInManufacture: number;
    componentsToMake: number;
    /** Resources it still lacks (empty: everything is in stock or made). */
    needs: ItemResourceNeed[];
    /** On a slipway with nothing to fit next and resources missing: it makes no progress now. */
    stalled: boolean;
}

export interface SiteSupply {
    target: SupplyTarget;
    name: string;
    items: QueueItemSupply[];
    /** Per resource over the whole queue: missing in total, and what is coming (the pool's orders). */
    resources: SiteResource[];
    /** Some slipway ship makes no progress for lack of resources. */
    stalled: boolean;
    /** Some item lacks resources that nothing is bringing (no delivery, no order). */
    nothingComing: boolean;
    /** ManufacturingQueue.DeficientResources of the site's manufacturer (the sim's own record; resource id → since). */
    deficientSince: Map<number, number>;
}

export interface SiteResource {
    resourceId: number;
    missing: number;
    inStock: number;
    orders: ResourceOrders | null;
    uncovered: number;
    /** Held elsewhere in the empire (empireSupplySnapshot fills it): the units and the largest holder. */
    availableElsewhere: number;
    availableAt: SupplyTarget | null;
}

/** The construction queue of a site (BuiltObject / Habitat both type it `unknown`). */
export function supplyQueueOf(target: SupplyTarget): ConstructionQueue | null {
    return (target.constructionQueue as ConstructionQueue | null) ?? null;
}

function manufacturingQueueOf(target: SupplyTarget): ManufacturingQueue | null {
    return target instanceof BuiltObject ? builtObjectManufacturingQueue(target) : habitatManufacturingQueue(target);
}

function targetEmpire(target: SupplyTarget): Empire | null {
    return target instanceof BuiltObject ? target.empire : target.empire;
}

/** The components a queued ship still has to receive (ConstructionQueue.cs 584-790). Damaged ones need no resources. */
export function componentsStillToBuild(ship: BuiltObject, yard: ConstructionYard | null): ComponentDefinition[] {
    if (ship.scrap) return [];
    if (ship.retrofitDesign !== null) {
        if (yard !== null && yard.retrofitComponentsToBeBuilt !== null) return yard.retrofitComponentsToBeBuilt;
        return componentListDiff(resolveComponentList(ship.components), ship.retrofitDesign.components);
    }
    const out: ComponentDefinition[] = [];
    for (const c of ship.components.items) if (c.status === ComponentStatus.Unbuilt) out.push(c.def);
    return out;
}

/** The ships of a queue in the order they build: the slipways, then the wait queue. */
export function queueItems(queue: ConstructionQueue): { ship: BuiltObject; yard: ConstructionYard | null }[] {
    const out: { ship: BuiltObject; yard: ConstructionYard | null }[] = [];
    for (const y of queue.constructionYards ?? []) if (y != null && y.shipUnderConstruction !== null) out.push({ ship: y.shipUnderConstruction, yard: y });
    for (const s of queue.constructionWaitQueue ?? []) if (s != null) out.push({ ship: s, yard: null });
    return out;
}

/** Objects sharing one cargo list (a colony and the bases at it share the colony's, BuiltObject.cs ReDefine). */
function poolMembers(target: SupplyTarget): SupplyTarget[] {
    const cargo = target.cargo;
    const out: SupplyTarget[] = [target];
    if (cargo === null) return out;
    const colony: Habitat | null = target instanceof BuiltObject ? target.parentHabitat : target;
    if (colony === null) return out;
    if (colony !== target && colony.cargo === cargo) out.push(colony);
    for (const b of colony.basesAtHabitat ?? []) if (b != null && b !== target && !b.hasBeenDestroyed && b.cargo === cargo) out.push(b);
    return out;
}

interface Pool {
    empire: Empire | null;
    resources: Map<number, number>;
    components: Map<number, number>;
    manufacturing: Map<number, number>;
    orders: Map<number, ResourceOrders>;
    /** Delivered units left per delivery (shared across the pool's items). */
    deliveryLeft: Map<Delivery, number>;
    orderedLeft: Map<number, number>;
}

function buildPool(galaxy: Galaxy, members: readonly SupplyTarget[], empire: Empire | null, orders: Map<StellarObject, Order[]> | null): Pool {
    const resources = new Map<number, number>();
    const components = new Map<number, number>();
    const cargo = members[0].cargo as CargoList | null;
    if (cargo !== null) {
        for (const c of cargo.items) {
            if (c == null || c.empire !== empire || !(c.amount > 0)) continue;
            if (c.commodityComponent !== null) components.set(c.commodityComponent.componentId, (components.get(c.commodityComponent.componentId) ?? 0) + c.amount);
            else resources.set(c.commodity.resourceId, (resources.get(c.commodity.resourceId) ?? 0) + c.amount);
        }
    }
    const manufacturing = new Map<number, number>();
    const seenMq = new Set<ManufacturingQueue>();
    const all: Order[] = [];
    for (const m of members) {
        const mq = manufacturingQueueOf(m);
        if (mq !== null && !seenMq.has(mq)) {
            seenMq.add(mq);
            for (const f of mq.manufacturers ?? []) if (f.component !== null) manufacturing.set(f.component.componentId, (manufacturing.get(f.component.componentId) ?? 0) + 1);
        }
        const list = orders !== null ? orders.get(m) : galaxyOrdersFor(galaxy, m);
        if (list !== undefined) for (const o of list) all.push(o);
    }
    const ro = resourceOrdersOf(galaxy, all);
    const deliveryLeft = new Map<Delivery, number>();
    const orderedLeft = new Map<number, number>();
    for (const e of ro.values()) {
        for (const d of e.deliveries) deliveryLeft.set(d, d.amount);
        orderedLeft.set(e.resourceId, e.uncontracted);
    }
    return { empire, resources, components, manufacturing, orders: ro, deliveryLeft, orderedLeft };
}

function galaxyOrdersFor(galaxy: Galaxy, o: SupplyTarget): Order[] {
    return (o instanceof BuiltObject ? galaxy.orders.getOrdersForBuiltObject(o) : galaxy.orders.getOrdersForHabitat(o)).items;
}

function take(map: Map<number, number>, key: number, want: number): number {
    const have = map.get(key) ?? 0;
    const got = Math.min(have, want);
    if (got > 0) map.set(key, have - got);
    return got;
}

function itemSupply(pool: Pool, ship: BuiltObject, yard: ConstructionYard | null): QueueItemSupply {
    const comps = componentsStillToBuild(ship, yard);
    let ready = 0;
    let making = 0;
    const need = new Map<number, number>();
    for (const def of comps) {
        if (take(pool.components, def.componentId, 1) > 0) {
            ready++;
            continue;
        }
        if (take(pool.manufacturing, def.componentId, 1) > 0) {
            making++;
            continue;
        }
        for (const r of def.resourceRequirements) need.set(r.resourceId, (need.get(r.resourceId) ?? 0) + r.amount);
    }
    const needs: ItemResourceNeed[] = [];
    for (const [resourceId, amount] of need) {
        const fromStock = take(pool.resources, resourceId, amount);
        const missing = amount - fromStock;
        if (missing <= 0) continue;
        let left = missing;
        const deliveries: { delivery: Delivery; amount: number }[] = [];
        let eta: number | null = 0;
        for (const d of pool.orders.get(resourceId)?.deliveries ?? []) {
            if (left <= 0) break;
            const avail = pool.deliveryLeft.get(d) ?? 0;
            if (avail <= 0) continue;
            const used = Math.min(avail, left);
            pool.deliveryLeft.set(d, avail - used);
            left -= used;
            deliveries.push({ delivery: d, amount: used });
            eta = eta === null || d.etaMs === null ? null : Math.max(eta, d.etaMs);
        }
        const byDeliveries = missing - left;
        const byOrders = take(pool.orderedLeft, resourceId, left);
        left -= byOrders;
        needs.push({ resourceId, missing, byDeliveries, byOrders, uncovered: left, deliveries, etaMs: left === 0 && byOrders === 0 && deliveries.length > 0 ? eta : null });
    }
    needs.sort((a, b) => b.uncovered - a.uncovered || b.missing - a.missing || a.resourceId - b.resourceId);
    return {
        ship,
        yard,
        componentsToBuild: comps.length,
        componentsReady: ready,
        componentsInManufacture: making,
        componentsToMake: comps.length - ready - making,
        needs,
        stalled: yard !== null && needs.length > 0 && ready === 0 && making === 0,
    };
}

/**
 * What every item in the queues of `targets` waits for. Targets sharing a cargo list (a colony and its space port) are
 * allocated together, in the order given (stock and deliveries go to the earlier items first). `orders`: the empire's
 * orders by requester (ordersByRequester), or null to look each requester up in Galaxy.Orders.
 */
export function constructionSupply(galaxy: Galaxy, targets: readonly SupplyTarget[], orders: Map<StellarObject, Order[]> | null = null): SiteSupply[] {
    const pools = new Map<object, Pool>();
    const out: SiteSupply[] = [];
    for (const target of targets) {
        const queue = supplyQueueOf(target);
        if (queue === null) continue;
        const items = queueItems(queue);
        if (items.length === 0) continue;
        const key: object = target.cargo ?? target;
        let pool = pools.get(key);
        const empire = targetEmpire(target);
        if (pool === undefined) {
            pool = buildPool(galaxy, poolMembers(target), empire, orders);
            pools.set(key, pool);
        }
        const before = new Map(pool.resources);
        const supplies = items.map((it) => itemSupply(pool!, it.ship, it.yard));
        const resources = new Map<number, SiteResource>();
        for (const s of supplies) {
            for (const n of s.needs) {
                let r = resources.get(n.resourceId);
                if (r === undefined) {
                    r = { resourceId: n.resourceId, missing: 0, inStock: before.get(n.resourceId) ?? 0, orders: pool.orders.get(n.resourceId) ?? null, uncovered: 0, availableElsewhere: 0, availableAt: null };
                    resources.set(n.resourceId, r);
                }
                r.missing += n.missing;
                r.uncovered += n.uncovered;
            }
        }
        const deficientSince = new Map<number, number>();
        const mq = manufacturingQueueOf(target);
        if (mq !== null) for (const d of mq.deficientResources?.items ?? []) deficientSince.set(d.resourceId, d.starDate);
        out.push({
            target,
            name: target.name,
            items: supplies,
            resources: [...resources.values()].sort((a, b) => b.uncovered - a.uncovered || b.missing - a.missing || a.resourceId - b.resourceId),
            stalled: supplies.some((s) => s.stalled),
            nothingComing: supplies.some((s) => s.needs.some((n) => n.uncovered > 0)),
            deficientSince,
        });
    }
    return out;
}

/** The empire's construction sites in the Construction Yards screen order (BaconMain.cs method_423): state then private
 *  ship yards with at least one yard, then every colony (only those with a queue). */
export function empireConstructionTargets(empire: Empire): SupplyTarget[] {
    const out: SupplyTarget[] = [];
    const add = (list: readonly BuiltObject[]): void => {
        for (const bo of list) {
            if (bo == null || bo.hasBeenDestroyed) continue;
            const q = supplyQueueOf(bo);
            if (q !== null && (q.constructionYards?.length ?? 0) > 0) out.push(bo);
        }
    };
    add(empire.builtObjects);
    add(empire.privateBuiltObjects);
    for (const h of empire.colonies) if (h != null && supplyQueueOf(h) !== null) out.push(h);
    return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Colonies: luxuries
// ---------------------------------------------------------------------------------------------------------------

export interface ColonyLuxuryNeed {
    resourceId: number;
    /** In the colony's cargo (owner's units). */
    stock: number;
    /** The level the colony orders up to (CalculateMinimumLuxuryResourceLevel[Restricted]). */
    minimumLevel: number;
    orders: ResourceOrders;
    /** Held elsewhere in the empire (other colonies, bases, mining stations): the units and the largest holder. */
    availableElsewhere: number;
    availableAt: SupplyTarget | null;
    /** None in stock, nothing contracted for LUXURY_WAIT_MS, yet the empire holds some elsewhere: a freighter could bring it. */
    notComing: boolean;
    /** None in stock, nothing contracted and none anywhere in the empire. */
    unavailable: boolean;
}

export interface ColonyLuxuryStatus {
    colony: Habitat;
    /** Luxury types held (CargoList.ResourceGroupCount(Luxury, owner) > 0 amounts; Empire.4.cs 3016). */
    luxuryTypes: number;
    /** Types needed to hold development (DevelopmentLevel / 5, Empire.4.cs 3046). */
    typesForDevelopment: number;
    /** Types the colony aims for (Empire.4.cs 3195: 10, or 5 under 200 M people). */
    typesWanted: number;
    /** Development falls for lack of luxury types (and strategic supply lets it change at all). */
    developmentFalling: boolean;
    /** The luxuries it has open orders for (it or its space port): not coming first, then unavailable, then the rest. */
    demanded: ColonyLuxuryNeed[];
    /** Short: development falling, or a demanded luxury the empire holds elsewhere is not on its way. */
    short: boolean;
}

/** A luxury order with nothing contracted counts as "not coming" once it is this old (game ms: 60 days). */
export const LUXURY_WAIT_MS = (60 * 600000) / 360;

/** Units of each resource the empire holds, and the largest holder (one entry per cargo list). */
export type EmpireStock = Map<number, { amount: number; at: SupplyTarget; atAmount: number; byCargo: Map<object, number> }>;

/** The empire's stock of every resource: its colonies' and its (state and private) built objects' cargo, owner's units. */
export function empireResourceStock(empire: Empire): EmpireStock {
    const out: EmpireStock = new Map();
    const seen = new Set<object>();
    const visit = (obj: SupplyTarget): void => {
        const cargo = obj.cargo as CargoList | null;
        if (cargo === null || seen.has(cargo)) return;
        seen.add(cargo);
        for (const c of cargo.items) {
            if (c == null || c.commodityComponent !== null || c.empire !== empire || !(c.amount > 0)) continue;
            const id = c.commodity.resourceId;
            let e = out.get(id);
            if (e === undefined) {
                e = { amount: 0, at: obj, atAmount: 0, byCargo: new Map() };
                out.set(id, e);
            }
            e.amount += c.amount;
            const here = (e.byCargo.get(cargo) ?? 0) + c.amount;
            e.byCargo.set(cargo, here);
            if (here > e.atAmount) {
                e.atAmount = here;
                e.at = obj;
            }
        }
    };
    for (const h of empire.colonies) if (h != null && !h.hasBeenDestroyed) visit(h);
    for (const list of [empire.builtObjects, empire.privateBuiltObjects]) for (const bo of list) if (bo != null && !bo.hasBeenDestroyed) visit(bo);
    return out;
}

function isLuxury(galaxy: Galaxy, resourceId: number): boolean {
    const r = galaxy.resourceSystem.byId.get(resourceId);
    return r !== undefined && resourceGroupOf(r) === ResourceGroup.Luxury;
}

/** A colony's luxury situation (null for an unpopulated / unowned colony). `stock`: empireResourceStock of its owner
 *  (for "held elsewhere"); `strategicGrowthFactor`: taxes.ts calculateStrategicResourceSupplyGrowthFactor (0 = its
 *  development cannot change, Empire.4.cs 3040). */
export function colonyLuxuryStatus(
    galaxy: Galaxy,
    colony: Habitat,
    orders: Map<StellarObject, Order[]> | null = null,
    strategicGrowthFactor: number | null = null,
    stock: EmpireStock | null = null,
): ColonyLuxuryStatus | null {
    const owner = colony.owner;
    if (owner === null || owner === galaxy.independentEmpire || colony.population == null || !(colony.population.totalAmount > 0)) return null;
    const held = new Map<number, number>();
    let types = 0;
    for (const c of colony.cargo?.items ?? []) {
        if (c == null || c.commodityComponent !== null || c.empire !== owner || !(c.amount > 0)) continue;
        if (!isLuxury(galaxy, c.commodity.resourceId)) continue;
        if (!held.has(c.commodity.resourceId)) types++;
        held.set(c.commodity.resourceId, (held.get(c.commodity.resourceId) ?? 0) + c.amount);
    }
    const forDev = Math.trunc(colony.developmentLevel / 5);
    const growth = strategicGrowthFactor ?? 1;
    const all: Order[] = [];
    const members: StellarObject[] = [colony];
    for (const b of colony.basesAtHabitat ?? []) if (b != null && b.isSpacePort && b.parentHabitat === colony) members.push(b);
    for (const m of members) {
        const list = orders !== null ? orders.get(m) : galaxyOrdersFor(galaxy, m as SupplyTarget);
        if (list !== undefined) for (const o of list) if (o.type === OrderType.Standard && o.commodityResource !== null && isLuxury(galaxy, o.commodityResource.resourceId)) all.push(o);
    }
    const minLux = calculateMinimumLuxuryResourceLevel(colony);
    const minRestricted = calculateMinimumLuxuryResourceLevelRestricted(colony);
    const own = colony.cargo;
    const demanded: ColonyLuxuryNeed[] = [];
    for (const ro of resourceOrdersOf(galaxy, all).values()) {
        const r = galaxy.resourceSystem.byId.get(ro.resourceId);
        const st = held.get(ro.resourceId) ?? 0;
        const es = stock?.get(ro.resourceId);
        const elsewhere = es === undefined ? 0 : es.amount - (own !== null ? (es.byCargo.get(own) ?? 0) : 0);
        // Not coming: none held, nothing contracted, and the order has waited LUXURY_WAIT_MS (a fresh order is normal).
        const none = st <= 0 && ro.deliveries.length === 0 && ro.oldestOrderAgeMs >= LUXURY_WAIT_MS;
        demanded.push({
            resourceId: ro.resourceId,
            stock: st,
            minimumLevel: r !== undefined && r.superLuxuryBonusAmount > 0 ? minRestricted : minLux,
            orders: ro,
            availableElsewhere: Math.max(0, elsewhere),
            availableAt: es !== undefined && es.at.cargo !== own && elsewhere > 0 ? es.at : null,
            notComing: none && elsewhere > 0,
            unavailable: none && elsewhere <= 0,
        });
    }
    const rank = (d: ColonyLuxuryNeed): number => (d.notComing ? 0 : d.unavailable ? 1 : 2);
    demanded.sort((a, b) => rank(a) - rank(b) || a.stock - b.stock || a.resourceId - b.resourceId);
    const falling = growth > 0 && types < forDev;
    return {
        colony,
        luxuryTypes: types,
        typesForDevelopment: forDev,
        typesWanted: colony.population.totalAmount < 200000000 ? 5 : 10,
        developmentFalling: falling,
        demanded,
        short: falling || demanded.some((d) => d.notComing),
    };
}

// ---------------------------------------------------------------------------------------------------------------
// Empire snapshot (the overlay, the selection panel, the yards screen)
// ---------------------------------------------------------------------------------------------------------------

export interface EmpireSupplySnapshot {
    empire: Empire;
    /** galaxy.nowMs when computed. */
    nowMs: number;
    sites: SiteSupply[];
    bySite: Map<SupplyTarget, SiteSupply>;
    /** Colonies short of luxuries (ColonyLuxuryStatus.short). */
    shortColonies: ColonyLuxuryStatus[];
    byColony: Map<Habitat, ColonyLuxuryStatus>;
    stock: EmpireStock;
}

/** Every construction site's supply and every colony's luxury status for `empire`. */
export function empireSupplySnapshot(galaxy: Galaxy, empire: Empire, growthFactor: ((h: Habitat) => number) | null = null): EmpireSupplySnapshot {
    const orders = ordersByRequester(galaxy, empire);
    const sites = constructionSupply(galaxy, empireConstructionTargets(empire), orders);
    const stock = empireResourceStock(empire);
    for (const site of sites) {
        const own = site.target.cargo;
        for (const r of site.resources) {
            const es = stock.get(r.resourceId);
            if (es === undefined) continue;
            r.availableElsewhere = Math.max(0, es.amount - (own !== null ? (es.byCargo.get(own) ?? 0) : 0));
            r.availableAt = r.availableElsewhere > 0 && es.at.cargo !== own ? es.at : null;
        }
    }
    const bySite = new Map<SupplyTarget, SiteSupply>();
    for (const s of sites) bySite.set(s.target, s);
    const shortColonies: ColonyLuxuryStatus[] = [];
    const byColony = new Map<Habitat, ColonyLuxuryStatus>();
    for (const h of empire.colonies) {
        if (h == null || h.hasBeenDestroyed) continue;
        const st = colonyLuxuryStatus(galaxy, h, orders, growthFactor !== null ? growthFactor(h) : null, stock);
        if (st === null) continue;
        byColony.set(h, st);
        if (st.short) shortColonies.push(st);
    }
    return { empire, nowMs: galaxy.nowMs, sites, bySite, shortColonies, byColony, stock };
}

/** A site for the Supply Shortages overlay: stalled (red) or short with something on its way (amber). */
export type ShortageSeverity = 'stalled' | 'short';

export interface ShortageMarker {
    target: SupplyTarget;
    x: number;
    y: number;
    severity: ShortageSeverity;
    site: SiteSupply | null;
    colony: ColonyLuxuryStatus | null;
}

/** The overlay's markers: yards whose queue lacks resources (stalled, or nothing coming = red) and short colonies
 *  (development falling = red). One marker per object; a colony that is both gets both parts. */
export function shortageMarkers(snap: EmpireSupplySnapshot): ShortageMarker[] {
    const out = new Map<SupplyTarget, ShortageMarker>();
    for (const s of snap.sites) {
        if (s.resources.length === 0) continue;
        const sev: ShortageSeverity = s.stalled || s.nothingComing ? 'stalled' : 'short';
        out.set(s.target, { target: s.target, x: s.target.xpos, y: s.target.ypos, severity: sev, site: s, colony: null });
    }
    for (const c of snap.shortColonies) {
        const sev: ShortageSeverity = c.developmentFalling ? 'stalled' : 'short';
        const m = out.get(c.colony);
        if (m !== undefined) {
            m.colony = c;
            if (sev === 'stalled') m.severity = 'stalled';
        } else out.set(c.colony, { target: c.colony, x: c.colony.xpos, y: c.colony.ypos, severity: sev, site: null, colony: c });
    }
    return [...out.values()];
}

// ---------------------------------------------------------------------------------------------------------------
// Per-resource supply view
// ---------------------------------------------------------------------------------------------------------------

export type ProducerKind = 'miningStation' | 'gasMiningStation' | 'miningShip' | 'colony';

export interface ResourceProducer {
    obj: SupplyTarget;
    kind: ProducerKind;
    /** HabitatResource.Abundance (0..1000) of the mined habitat. */
    abundance: number;
    /** Units held by it (its cargo, owner's). */
    stock: number;
}

export interface ResourceStock {
    obj: SupplyTarget;
    amount: number;
    /** Of it reserved for construction (Cargo.Reserved). */
    reserved: number;
}

export type ConsumerReason = 'construction' | 'luxury' | 'strategic' | 'order';

export interface ResourceConsumer {
    obj: SupplyTarget;
    reasons: ConsumerReason[];
    /** Estimated units per game year the colony consumes (luxury / strategic upkeep), 0 when not known. */
    perYear: number;
    /** Construction: units still missing for the queue. */
    constructionMissing: number;
    /** Open orders: requested − delivered, and what is contracted (on its way). */
    ordered: number;
    incoming: number;
}

export interface ResourceRoute {
    key: string;
    from: StellarObject | null;
    to: StellarObject;
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
    /** Units in transit or to be picked up on live contracts. */
    amount: number;
    freighters: number;
    /** From the Freight Flows recording (null while not recording). */
    recordedPerYear: number | null;
}

export interface ResourceSupplyView {
    resourceId: number;
    producers: ResourceProducer[];
    stock: ResourceStock[];
    totalStock: number;
    consumers: ResourceConsumer[];
    routes: ResourceRoute[];
    /** Recorded flows (Freight Flows ledger, 12 months), when recording. */
    recorded: FlowRow[] | null;
}

function cargoAmount(cargo: CargoList | null, resourceId: number, empire: Empire | null): { amount: number; reserved: number } {
    let amount = 0;
    let reserved = 0;
    if (cargo !== null) {
        for (const c of cargo.items) {
            if (c == null || c.commodityComponent !== null || c.commodity.resourceId !== resourceId || c.empire !== empire) continue;
            amount += c.amount;
            reserved += c.reserved;
        }
    }
    return { amount, reserved };
}

function habitatAbundance(h: Habitat | null, resourceId: number): number {
    if (h === null) return 0;
    for (const r of h.resources ?? []) if (r != null && r.resourceId === resourceId) return r.abundance;
    return 0;
}

function extractsGroup(bo: BuiltObject, group: ResourceGroup): boolean {
    if (group === ResourceGroup.Mineral) return bo.extractionMine > 0;
    if (group === ResourceGroup.Gas) return bo.extractionGas > 0;
    if (group === ResourceGroup.Luxury) return bo.extractionLuxury > 0;
    return false;
}

function centreOf(galaxy: Galaxy, o: StellarObject): { x: number; y: number } {
    if (o instanceof BuiltObject) {
        const s = o.nearestSystemStar;
        return s !== null ? { x: s.xpos, y: s.ypos } : { x: o.xpos, y: o.ypos };
    }
    const sys = galaxy.systems[(o as Habitat).systemIndex];
    return sys !== undefined ? { x: sys.systemStar.xpos, y: sys.systemStar.ypos } : { x: o.xpos, y: o.ypos };
}

/**
 * Where `resourceId` is produced, held and needed in `empire`, and the routes it travels on: live contracts to or from
 * the empire, grouped by (supplier system, destination system), plus the Freight Flows recording when it runs.
 * `snapshot` gives the construction needs (empireSupplySnapshot).
 */
export function resourceSupplyView(galaxy: Galaxy, empire: Empire, resourceId: number, snapshot: EmpireSupplySnapshot | null = null, nowStarDate: number | null = null): ResourceSupplyView {
    const def = galaxy.resourceSystem.byId.get(resourceId);
    const group = def !== undefined ? resourceGroupOf(def) : ResourceGroup.Undefined;
    const producers: ResourceProducer[] = [];
    const stockByCargo = new Map<object, ResourceStock>();
    const addStock = (obj: SupplyTarget): number => {
        const cargo = obj.cargo as CargoList | null;
        if (cargo === null) return 0;
        const a = cargoAmount(cargo, resourceId, empire);
        if (a.amount > 0 && !stockByCargo.has(cargo)) stockByCargo.set(cargo, { obj, amount: a.amount, reserved: a.reserved });
        return a.amount;
    };
    for (const list of [empire.builtObjects, empire.privateBuiltObjects]) {
        for (const bo of list) {
            if (bo == null || bo.hasBeenDestroyed) continue;
            const isExtractor = (bo.extractionMine > 0 || bo.extractionGas > 0 || bo.extractionLuxury > 0) && bo.isResourceExtractor;
            if (isExtractor && extractsGroup(bo, group)) {
                const ab = habitatAbundance(bo.parentHabitat, resourceId);
                if (ab > 0) {
                    const kind: ProducerKind = bo.subRole === BuiltObjectSubRole.GasMiningStation ? 'gasMiningStation' : bo.subRole === BuiltObjectSubRole.MiningStation ? 'miningStation' : 'miningShip';
                    producers.push({ obj: bo, kind, abundance: ab, stock: cargoAmount(bo.cargo, resourceId, empire).amount });
                }
            }
            if (bo.role === BuiltObjectRole.Base || bo.isResourceExtractor) addStock(bo);
        }
    }
    const consumers = new Map<SupplyTarget, ResourceConsumer>();
    const consumer = (obj: SupplyTarget): ResourceConsumer => {
        let c = consumers.get(obj);
        if (c === undefined) {
            c = { obj, reasons: [], perYear: 0, constructionMissing: 0, ordered: 0, incoming: 0 };
            consumers.set(obj, c);
        }
        return c;
    };
    const isLux = group === ResourceGroup.Luxury;
    const isRestricted = def !== undefined && def.superLuxuryBonusAmount > 0;
    const strategicLevel = def !== undefined ? Math.fround(def.colonyGrowthResourceLevel) : 0;
    for (const h of empire.colonies) {
        if (h == null || h.hasBeenDestroyed) continue;
        const held = addStock(h);
        const pop = h.population?.totalAmount ?? 0;
        if (pop > 0 && habitatAbundance(h, resourceId) > 0) producers.push({ obj: h, kind: 'colony', abundance: habitatAbundance(h, resourceId), stock: held });
        if (pop <= 0) continue;
        // Habitat.cs 2758 ConsumeResources: luxuries (and the race's critical resources) the colony holds; 7402 the
        // strategic upkeep of a growth resource.
        if (isLux && held > 0) {
            const c = consumer(h);
            c.reasons.push('luxury');
            c.perYear += (isRestricted ? COLONY_ANNUAL_RESTRICTED_RESOURCE_CONSUMPTION_RATE : COLONY_ANNUAL_LUXURY_RESOURCE_CONSUMPTION_RATE) * pop;
        } else if (strategicLevel > 0 && held > 0) {
            const c = consumer(h);
            c.reasons.push('strategic');
            c.perYear += calculateStrategicResourceConsumptionPerYear(galaxy, h, resourceId);
        }
    }
    const snap = snapshot;
    if (snap !== null) {
        for (const s of snap.sites) {
            const r = s.resources.find((x) => x.resourceId === resourceId);
            if (r === undefined) continue;
            const c = consumer(s.target);
            if (!c.reasons.includes('construction')) c.reasons.push('construction');
            c.constructionMissing += r.missing;
        }
    }
    // Open orders by the empire's requesters, and the live routes.
    const routes = new Map<string, ResourceRoute>();
    for (const o of galaxy.orders.items) {
        if (o == null || o.commodityResource === null || o.commodityResource.resourceId !== resourceId) continue;
        const req: SupplyTarget | null = o.requestingBuiltObject ?? o.requestingColony;
        if (req === null) continue;
        const reqOwner = o.requestingBuiltObject !== null ? o.requestingBuiltObject.actualEmpire : o.requestingColony!.empire;
        const mine = reqOwner === empire;
        const deliveries = orderDeliveries(galaxy, o);
        if (mine) {
            const left = o.amountRequested - o.amountDelivered;
            if (left > 0) {
                const c = consumer(req);
                if (!c.reasons.includes('order') && !c.reasons.includes('construction')) c.reasons.push('order');
                c.ordered += left;
                for (const d of deliveries) c.incoming += d.amount;
            }
        }
        for (const d of deliveries) {
            const sup = d.supplier;
            const supOwner = sup === null ? null : sup instanceof BuiltObject ? sup.actualEmpire : (sup as Habitat).empire;
            if (!mine && supOwner !== empire) continue;
            const a = sup !== null ? centreOf(galaxy, sup) : { x: NaN, y: NaN };
            const b = centreOf(galaxy, d.destination);
            const key = `${sup === null ? '?' : `${Math.round(a.x)},${Math.round(a.y)}`}>${Math.round(b.x)},${Math.round(b.y)}`;
            let r = routes.get(key);
            if (r === undefined) {
                r = { key, from: sup, to: d.destination, fromX: a.x, fromY: a.y, toX: b.x, toY: b.y, amount: 0, freighters: 0, recordedPerYear: null };
                routes.set(key, r);
            }
            r.amount += d.amount;
            if (d.freighter !== null) r.freighters++;
        }
    }
    let recorded: FlowRow[] | null = null;
    const ledger = tradeFlowLedger(galaxy);
    if (ledger !== null && nowStarDate !== null) recorded = flowsInWindow(ledger, nowStarDate, 12, { resourceId, empire }, 'system').slice(0, 12);
    const stock = [...stockByCargo.values()].sort((a, b) => b.amount - a.amount);
    let total = 0;
    for (const s of stock) total += s.amount;
    producers.sort((a, b) => b.abundance - a.abundance || b.stock - a.stock);
    return {
        resourceId,
        producers,
        stock,
        totalStock: total,
        consumers: [...consumers.values()].sort((a, b) => b.constructionMissing - a.constructionMissing || b.ordered - b.incoming - (a.ordered - a.incoming) || b.perYear - a.perYear),
        routes: [...routes.values()].sort((a, b) => b.amount - a.amount || (a.key < b.key ? -1 : 1)),
        recorded,
    };
}
