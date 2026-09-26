// Resource / component market prices (task: market). Port of Galaxy.1.cs
// ReviewResourcePrices (1204) and ReviewComponentPrices (1027), which
// Start.2.cs:1103-1107 runs 20 times after the starting colonies exist (and
// Galaxy.cs:3093 re-runs during play).
//
// State: Galaxy.ResourceCurrentPrices / Galaxy.ComponentCurrentPrices live in the
// per-galaxy arrays returned by galaxyResourceCurrentPrices /
// galaxyComponentCurrentPrices (src/sim/design.ts), initialised exactly as the
// Galaxy constructor does (Galaxy.4.cs:2175-2188). Both functions here mutate
// those arrays in place, so Design.calculateCurrentPurchasePrice (Design.cs:1138)
// reads the reviewed values.
//
// Neither function draws from Galaxy.Rnd (no galaxy.rnd calls).

import type { Cargo } from './cargo';
import { galaxyComponentCurrentPrices, galaxyResourceCurrentPrices } from './design';
import type { Galaxy } from './galaxy';
import type { Order } from './logistics/orders';
import { crisisPrice } from './scenario/emergent/crisesCore';

/**
 * The Order surface ReviewResourcePrices reads (Order.cs CommodityResource, AmountOutstandingToContract): the real
 * Order model (logistics/orders.ts).
 */
export type MarketOrder = Order;

// Galaxy.Orders (OrderList, logistics/orders.ts).
function galaxyOrders(galaxy: Galaxy): MarketOrder[] {
    return galaxy.orders.items;
}

// C# Cargo.CommodityResource (null for component cargo). TS Cargo only carries
// resource commodities (cargo.ts TODO(port): component cargo).
function cargoCommodityResource(cargo: Cargo): { resourceId: number } | null {
    return cargo.commodity ?? null;
}

// C# Cargo.Available => Amount - Reserved (Cargo.cs:91), int arithmetic.
function cargoAvailable(cargo: Cargo): number {
    return (cargo.amount - cargo.reserved) | 0;
}

// Port of Galaxy.1.cs ReviewResourcePrices (1204-1307).
export function reviewResourcePrices(galaxy: Galaxy): void {
    const resources = galaxy.resourceSystem.resources;
    const resourceCurrentPrices = galaxyResourceCurrentPrices(galaxy);
    const orders = galaxyOrders(galaxy);
    // 1206-1215: outstanding demand per resource.
    const array: number[] = new Array<number>(resources.length).fill(0);
    for (let i = 0; i < orders.length; i++) {
        const order = orders[i];
        if (order.commodityResource !== null && order.amountOutstandingToContract > 0) {
            const commodityResource = order.commodityResource;
            array[commodityResource.resourceId] = (array[commodityResource.resourceId] + order.amountOutstandingToContract) | 0;
        }
    }
    // 1216-1276: available supply per resource.
    const array2: number[] = new Array<number>(resources.length).fill(0);
    const empireList = [];
    empireList.push(...galaxy.empires);
    empireList.push(...galaxy.pirateEmpires);
    for (let j = 0; j < empireList.length; j++) {
        const empire = empireList[j];
        if (empire == null || !empire.active) continue;
        for (let k = 0; k < empire.colonies.length; k++) {
            const habitat = empire.colonies[k];
            if (habitat == null || habitat.empire !== empire || habitat.cargo === null) continue;
            for (let l = 0; l < habitat.cargo.items.length; l++) {
                const cargo = habitat.cargo.items[l];
                const commodityResource2 = cargo != null ? cargoCommodityResource(cargo) : null;
                if (cargo != null && commodityResource2 !== null && cargoAvailable(cargo) > 0) {
                    array2[commodityResource2.resourceId] = (array2[commodityResource2.resourceId] + cargoAvailable(cargo)) | 0;
                }
            }
        }
        for (let m = 0; m < empire.spacePorts.length; m++) {
            const builtObject = empire.spacePorts[m];
            if (builtObject == null || (builtObject.parentHabitat !== null && builtObject.parentHabitat.empire === empire) || builtObject.cargo === null) continue;
            for (let n = 0; n < builtObject.cargo.items.length; n++) {
                const cargo2 = builtObject.cargo.items[n];
                const commodityResource3 = cargo2 != null ? cargoCommodityResource(cargo2) : null;
                if (cargo2 != null && commodityResource3 !== null && cargoAvailable(cargo2) > 0) {
                    array2[commodityResource3.resourceId] = (array2[commodityResource3.resourceId] + cargoAvailable(cargo2)) | 0;
                }
            }
        }
        for (let num = 0; num < empire.miningStations.length; num++) {
            const builtObject2 = empire.miningStations[num];
            if (builtObject2 == null || builtObject2.cargo === null) continue;
            for (let num2 = 0; num2 < builtObject2.cargo.items.length; num2++) {
                const cargo3 = builtObject2.cargo.items[num2];
                const commodityResource4 = cargo3 != null ? cargoCommodityResource(cargo3) : null;
                if (cargo3 != null && commodityResource4 !== null && cargoAvailable(cargo3) > 0) {
                    array2[commodityResource4.resourceId] = (array2[commodityResource4.resourceId] + cargoAvailable(cargo3)) | 0;
                }
            }
        }
    }
    // 1277-1306: move each price towards BasePrice * demand/supply, clamped.
    for (let num3 = 0; num3 < resources.length; num3++) {
        const resourceDefinition = resources[num3];
        const basePrice = Math.fround(resourceDefinition.basePrice); // ResourceDefinition.BasePrice (float)
        const num4 = array[num3] / Math.max(1.0, array2[num3]);
        const num5 = basePrice * num4;
        let num6 = num5 - resourceCurrentPrices[num3];
        num6 = !(num6 > 0.0) ? num6 / 2.0 : num6 / 4.0;
        if (num6 > resourceCurrentPrices[num3] / 2.0) {
            num6 = resourceCurrentPrices[num3] / 2.0;
        }
        let num7 = resourceCurrentPrices[num3];
        num7 += num6;
        let val = basePrice * 0.1667;
        let val2 = basePrice * 0.35;
        if (resourceDefinition.superLuxuryBonusAmount > 0) {
            val = basePrice / 2.0;
            val2 = basePrice * 3.0;
        }
        num7 = csMathMax(val, num7);
        num7 = csMathMin(val2, num7);
        // 19d2 resource crises (scenario flag): a shortage lifts the ceiling (crisesCore.crisisPrice). No Rnd.
        if (galaxy.scenario !== null) num7 = crisisPrice(galaxy, resourceDefinition, array[num3], array2[num3], num7, resourceCurrentPrices[num3]);
        if (Number.isNaN(num7)) {
            num7 = basePrice;
        }
        resourceCurrentPrices[num3] = num7;
    }
}

// Port of Galaxy.1.cs ReviewComponentPrices (1027-1045).
export function reviewComponentPrices(galaxy: Galaxy): void {
    const componentDefinitionsStatic = galaxy.researchStatic?.componentStatic?.definitions ?? [];
    const resourceCurrentPrices = galaxyResourceCurrentPrices(galaxy);
    const componentCurrentPrices = galaxyComponentCurrentPrices(galaxy);
    for (const componentDefinition of componentDefinitionsStatic) {
        let num = 0.0;
        for (let j = 0; j < componentDefinition.resourceRequirements.length; j++) {
            const componentResource = componentDefinition.resourceRequirements[j];
            const num2 = resourceCurrentPrices[componentResource.resourceId];
            num += num2 * componentResource.amount;
        }
        if (componentDefinition.componentId >= componentCurrentPrices.length) {
            componentCurrentPrices.push(0.0);
        }
        componentCurrentPrices[componentDefinition.componentId] = num * 2.0;
    }
}

// .NET Math.Max/Min(double, double): NaN if either argument is NaN.
function csMathMax(a: number, b: number): number {
    if (Number.isNaN(a) || Number.isNaN(b)) return NaN;
    return a > b ? a : b;
}
function csMathMin(a: number, b: number): number {
    if (Number.isNaN(a) || Number.isNaN(b)) return NaN;
    return a < b ? a : b;
}
