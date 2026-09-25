// M4d — colony consumption and resupply orders: Habitat.ConsumeResources (Habitat.cs 2758),
// ConsumeAndOrderStrategicResourceSupply (7293-7400), Galaxy.MaintainIndependentColonyFuelLevels (Galaxy.cs 1682-1755),
// and the resource-level helpers they and the freight code share (Galaxy.cs 1473-1661, Habitat.cs 273 ResourceMultiplier,
// 5078 DetermineCriticalResources, 7421-7443 minimum luxury levels). No Rnd drawn in this file.

import type { Galaxy } from '../galaxy';
import type { BuiltObject } from '../builtObject';
import type { Habitat } from '../types';
import type { Cargo } from '../cargo';
import { ResourceRef } from '../cargo';
import { BuiltObjectSubRole } from '../builtObjectTypes';
import { galaxyResourceCurrentPrices } from '../design';
import { getPrivateFunds } from '../forceStructure';
import { REAL_SECONDS_IN_GALACTIC_YEAR } from '../galaxyTime';
import { ResourceGroup, resourceGroupOf } from '../resourceSystem';
import {
    COLONY_ANNUAL_LUXURY_RESOURCE_CONSUMPTION_RATE,
    COLONY_ANNUAL_RESOURCE_CONSUMPTION_RATE,
    COLONY_ANNUAL_RESTRICTED_RESOURCE_CONSUMPTION_RATE,
    COLONY_MINIMUM_RESOURCE_REORDER_AMOUNT,
    COLONY_STRATEGIC_RESOURCE_CONSUMPTION_PER_MILLION_PER_YEAR,
    MINIMUM_CONTRACT_SIZE,
    MINIMUM_LUXURY_RESOURCE_REORDER_AMOUNT,
    MINIMUM_RESTRICTED_RESOURCE_REORDER_AMOUNT,
    OrderType,
    cargoAvailable,
    cargoEmpireId,
    cargoGetCargo,
    cargoGetExists,
    cargoIndexOf,
    cargoRemove,
    empireCreateOrder,
    galaxyCreateOrder,
    isBaseNotAtOwnColony,
    isLuxuryResource,
    isRestrictedResource,
    type OrderList,
} from './orders';
import { calculateMaximumOrderFulfillmentDistance } from './orders';
import type { Empire } from '../empire';
import { netSort } from '../netSort';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../diplomacy';
import { determineResourcesEmpireSupplies } from '../diplomacyTick';
import { habitatDevelopmentLevel } from '../developmentLevel';
import { conditionCheckLimit } from '../tick/builtObjectTick';

// Galaxy.3.cs 5123-5128 ResourceLevel*Quantity.
const RESOURCE_LEVEL_ONE_QUANTITY = 4000.0;
const RESOURCE_LEVEL_TWO_QUANTITY = 2000.0;
const RESOURCE_LEVEL_THREE_QUANTITY = 1000.0;
const RESOURCE_LEVEL_FOUR_QUANTITY = 500.0;
const RESOURCE_LEVEL_FIVE_QUANTITY = 300.0;
const RESOURCE_LEVEL_SIX_QUANTITY = 150.0;

const F_0_4 = Math.fround(0.4);
const F_0_25 = Math.fround(0.25);
const F_0_15 = Math.fround(0.15);

/** C# (int) of a finite double. */
function csInt(v: number): number {
    return Math.trunc(v) | 0;
}

/** ResourceDefinition.RelativeImportance (float). */
function relativeImportance(galaxy: Galaxy, resourceId: number): number {
    return galaxy.resourceSystem.relativeImportance.get(resourceId) ?? 0;
}

function isFuel(galaxy: Galaxy, resourceId: number): boolean {
    return galaxy.resourceSystem.byId.get(resourceId)?.isFuel ?? false;
}

function resourceGroup(galaxy: Galaxy, resourceId: number): ResourceGroup {
    const def = galaxy.resourceSystem.byId.get(resourceId);
    return def === undefined ? ResourceGroup.Undefined : resourceGroupOf(def);
}

function isSpacePortSubRole(subRole: BuiltObjectSubRole): boolean {
    return subRole === BuiltObjectSubRole.SmallSpacePort || subRole === BuiltObjectSubRole.MediumSpacePort || subRole === BuiltObjectSubRole.LargeSpacePort;
}

// ------------------------------------------------------------------------------------------
// Resource levels (Galaxy.cs).

/** Habitat.cs 273 ResourceMultiplier (float). */
export function habitatResourceMultiplier(colony: Habitat): number {
    let num = 1.0;
    const population = colony.population;
    if (population != null && population.items.length > 0) {
        num = Math.min(4.0, Math.max(1.0, COLONY_ANNUAL_RESOURCE_CONSUMPTION_RATE * (population.totalAmount / 20.0)));
    }
    return Math.fround(num);
}

/** Galaxy.cs 1647 CalculateResourceLevelStockForBaseRetrofit(resourceId). */
export function calculateResourceLevelStockForBaseRetrofit(galaxy: Galaxy, resourceId: number): number {
    let result = 0;
    const resourceDefinition = galaxy.resourceSystem.byId.get(resourceId);
    if (resourceDefinition !== undefined) {
        result = !resourceDefinition.isFuel ? (!(relativeImportance(galaxy, resourceId) > F_0_25) ? 25 : 50) : 0;
    }
    return result;
}

/**
 * Galaxy.cs 1541 CalculateResourceLevelSpaceport(resource, fleetFuelAmount, multiplier). C# oddity kept: the loop
 * overwrites `num` for every strategic resource, so the result is the last resource's level and `resource` is unused.
 */
export function calculateResourceLevelSpaceport(galaxy: Galaxy, resourceId: number, fleetFuelAmount: number, multiplier: number): number {
    void resourceId;
    let num = 0.0;
    const ordered = galaxy.resourceSystem.strategicResourcesOrderedByRelativeImportance;
    for (let i = 0; i < ordered.length; i++) {
        const resourceDefinition = ordered[i];
        if (resourceDefinition != null) {
            num = RESOURCE_LEVEL_ONE_QUANTITY * relativeImportance(galaxy, resourceDefinition.resourceId);
            if (resourceDefinition.isFuel) num += fleetFuelAmount;
        }
    }
    return csInt(num * multiplier);
}

/** Galaxy.cs 1560-1632 CalculateResourceLevel(resource, colony, isMiningStation, isIndependent, isCriticalResource, fleetFuelAmount). */
export function calculateResourceLevelHabitat(galaxy: Galaxy, resourceId: number, colony: Habitat, isMiningStation = false, isIndependent = false, isCriticalResource = false, fleetFuelAmount = 0): number {
    let num = 0.0;
    if (isIndependent) {
        let result = 0;
        if (isFuel(galaxy, resourceId)) result = 4000;
        return result;
    }
    const ri = relativeImportance(galaxy, resourceId);
    if (isMiningStation) {
        const group = resourceGroup(galaxy, resourceId);
        if (group === ResourceGroup.Mineral || group === ResourceGroup.Gas) {
            if (ri > F_0_25) return 4000;
            return 2000;
        }
        return 2000;
    }
    if (!colony.hasSpacePort) {
        if (isFuel(galaxy, resourceId)) num = RESOURCE_LEVEL_TWO_QUANTITY + fleetFuelAmount;
        let num3 = 0;
        if (colony.population != null) num3 = colony.population.totalAmount;
        if (num3 >= 1000000000) {
            num = ri > F_0_4 ? RESOURCE_LEVEL_THREE_QUANTITY : !(ri > F_0_15) ? RESOURCE_LEVEL_FIVE_QUANTITY : RESOURCE_LEVEL_FOUR_QUANTITY;
        } else if (num3 >= 200000000) {
            num = ri > F_0_4 ? RESOURCE_LEVEL_FOUR_QUANTITY : !(ri > F_0_15) ? RESOURCE_LEVEL_SIX_QUANTITY : RESOURCE_LEVEL_FIVE_QUANTITY;
        }
    } else {
        num = ri > F_0_4 ? RESOURCE_LEVEL_ONE_QUANTITY : ri > F_0_25 ? RESOURCE_LEVEL_TWO_QUANTITY : !(ri > F_0_15) ? RESOURCE_LEVEL_FOUR_QUANTITY : RESOURCE_LEVEL_THREE_QUANTITY;
        if (isFuel(galaxy, resourceId)) num += fleetFuelAmount;
    }
    if (isCriticalResource) num = Math.max(num, RESOURCE_LEVEL_FOUR_QUANTITY);
    return csInt(num * habitatResourceMultiplier(colony));
}

/** Galaxy.cs 1527 / 1532 CalculateResourceLevel(cargo, colony[, isMiningStation]). */
export function calculateResourceLevelCargoHabitat(galaxy: Galaxy, cargo: Cargo, colony: Habitat, isMiningStation = false): number {
    // cargo.CommodityResource != null (TS cargo is resource-only).
    return calculateResourceLevelHabitat(galaxy, cargo.commodity.resourceId, colony, isMiningStation, false);
}

/** Galaxy.cs 1473 CalculateResourceLevel(Resource, BuiltObject tradingPost). */
export function calculateResourceLevelBuiltObject(galaxy: Galaxy, resourceId: number, tradingPost: BuiltObject): number {
    if (tradingPost.parentHabitat !== null) {
        if (tradingPost !== null && !tradingPost.hasBeenDestroyed && isBaseNotAtOwnColony(tradingPost) && tradingPost.cargoSpace > 0) {
            switch (tradingPost.subRole) {
                case BuiltObjectSubRole.SmallSpacePort:
                    return calculateResourceLevelSpaceport(galaxy, resourceId, 0, 1.0);
                case BuiltObjectSubRole.MediumSpacePort:
                    return calculateResourceLevelSpaceport(galaxy, resourceId, 0, 2.0);
                case BuiltObjectSubRole.LargeSpacePort:
                    return calculateResourceLevelSpaceport(galaxy, resourceId, 0, 4.0);
                default:
                    return calculateResourceLevelStockForBaseRetrofit(galaxy, resourceId);
            }
        }
        if (tradingPost.isSpacePort) return calculateResourceLevelHabitat(galaxy, resourceId, tradingPost.parentHabitat, false, false);
        return calculateResourceLevelHabitat(galaxy, resourceId, tradingPost.parentHabitat, true, false);
    }
    if (tradingPost !== null && !tradingPost.hasBeenDestroyed && isBaseNotAtOwnColony(tradingPost) && tradingPost.cargoSpace > 0) {
        return calculateResourceLevelStockForBaseRetrofit(galaxy, resourceId);
    }
    return 0;
}

/**
 * Galaxy.cs 1500 CalculateResourceLevel(Cargo, BuiltObject tradingPost). Same as the Resource overload except that the
 * parent-habitat branch does not test CargoSpace > 0 (C# as written).
 */
export function calculateResourceLevelCargoBuiltObject(galaxy: Galaxy, cargo: Cargo, tradingPost: BuiltObject): number {
    const resourceId = cargo.commodity.resourceId;
    if (tradingPost.parentHabitat !== null) {
        if (tradingPost !== null && !tradingPost.hasBeenDestroyed && isBaseNotAtOwnColony(tradingPost)) {
            switch (tradingPost.subRole) {
                case BuiltObjectSubRole.SmallSpacePort:
                    return calculateResourceLevelSpaceport(galaxy, resourceId, 0, 1.0);
                case BuiltObjectSubRole.MediumSpacePort:
                    return calculateResourceLevelSpaceport(galaxy, resourceId, 0, 2.0);
                case BuiltObjectSubRole.LargeSpacePort:
                    return calculateResourceLevelSpaceport(galaxy, resourceId, 0, 4.0);
                default:
                    return calculateResourceLevelStockForBaseRetrofit(galaxy, resourceId);
            }
        }
        if (tradingPost.isSpacePort) return calculateResourceLevelCargoHabitat(galaxy, cargo, tradingPost.parentHabitat);
        return calculateResourceLevelCargoHabitat(galaxy, cargo, tradingPost.parentHabitat, true);
    }
    if (tradingPost !== null && !tradingPost.hasBeenDestroyed && isBaseNotAtOwnColony(tradingPost) && tradingPost.cargoSpace > 0) {
        return calculateResourceLevelStockForBaseRetrofit(galaxy, resourceId);
    }
    return 0;
}

/** Habitat.cs 7421 CalculateMinimumLuxuryResourceLevel. */
export function calculateMinimumLuxuryResourceLevel(colony: Habitat): number {
    let result = 0;
    if (colony.population != null) {
        const num = Math.max(500000000, colony.population.totalAmount);
        result = csInt(COLONY_ANNUAL_LUXURY_RESOURCE_CONSUMPTION_RATE * num);
        result = Math.max(result * 3, MINIMUM_LUXURY_RESOURCE_REORDER_AMOUNT);
    }
    return result;
}

/** Habitat.cs 7433 CalculateMinimumLuxuryResourceLevelRestricted. */
export function calculateMinimumLuxuryResourceLevelRestricted(colony: Habitat): number {
    let result = 0;
    if (colony.population != null) {
        const num = Math.max(500000000, colony.population.totalAmount);
        result = csInt(COLONY_ANNUAL_RESTRICTED_RESOURCE_CONSUMPTION_RATE * num);
        result = Math.max(result * 3, MINIMUM_RESTRICTED_RESOURCE_REORDER_AMOUNT);
    }
    return result;
}

/** Galaxy.7.cs 311 DetermineSpacePortAtHabitat(habitat). */
export function determineSpacePortAtHabitat(habitat: Habitat | null): BuiltObject | null {
    if (habitat !== null && habitat.basesAtHabitat != null) {
        for (let i = 0; i < habitat.basesAtHabitat.length; i++) {
            const builtObject: BuiltObject = habitat.basesAtHabitat[i];
            if (builtObject != null && builtObject.parentHabitat === habitat && isSpacePortSubRole(builtObject.subRole)) return builtObject;
        }
    }
    return null;
}

// ------------------------------------------------------------------------------------------
// Habitat.cs 2758 ConsumeResources(timePassed).

/** Habitat.cs 5078 DetermineCriticalResources (ResourceList of ids). */
export function determineCriticalResources(galaxy: Galaxy, habitat: Habitat): number[] {
    const population = habitat.population;
    if (population != null && population.totalAmount > 0 && population.dominantRace !== null && habitat.empire !== null && habitat.empire !== galaxy.independentEmpire) {
        // ResourceBonusList.ResolveResources (ResourceBonusList.cs 49): one Resource per non-null bonus, in order.
        const list: number[] = [];
        for (const bonus of population.dominantRace.criticalResources) if (bonus != null) list.push(bonus.resourceId);
        return list;
    }
    return [];
}

/** Habitat.cs 2758 ConsumeResources(timePassed) — timePassed in seconds. */
export function consumeResources(galaxy: Galaxy, habitat: Habitat, timePassed: number): void {
    if (habitat.population == null || habitat.population.items.length <= 0 || habitat.empire === null || habitat.empire === galaxy.independentEmpire) return;
    const resourceList = determineCriticalResources(galaxy, habitat);
    let num = csInt((COLONY_ANNUAL_LUXURY_RESOURCE_CONSUMPTION_RATE * habitat.population.totalAmount * timePassed) / REAL_SECONDS_IN_GALACTIC_YEAR);
    if (num < 1) num = 1;
    let num2 = csInt((COLONY_ANNUAL_RESTRICTED_RESOURCE_CONSUMPTION_RATE * habitat.population.totalAmount * timePassed) / REAL_SECONDS_IN_GALACTIC_YEAR);
    if (num2 < 1) num2 = 1;
    // cargoList (a CargoList; its entries all belong to Empire and have distinct resources, so Add never merges).
    const cargoList: Cargo[] = [];
    const cargoItems = habitat.cargo;
    if (cargoItems === null) return;
    const empireId = habitat.empire.empireId;
    for (let i = 0; i < cargoItems.items.length; i++) {
        const cargo = cargoItems.items[i];
        if (cargoEmpireId(cargo) !== empireId || cargoAvailable(cargo) <= 0) continue; // CommodityResource != null
        const resourceId = cargo.commodity.resourceId;
        if (!isLuxuryResource(galaxy, resourceId) && resourceList.indexOf(resourceId) < 0) continue;
        if (isRestrictedResource(galaxy, resourceId)) cargo.amount -= num2;
        else cargo.amount -= num;
        if (cargo.amount <= 0) {
            if (cargo.reserved <= 0) cargoList.push(cargo);
            else cargo.amount = 0;
        }
    }
    for (const item of cargoList) cargoRemove(cargoItems, item);
}

// ------------------------------------------------------------------------------------------
// Habitat.cs 7293 ConsumeAndOrderStrategicResourceSupply(timePassed).

/** Habitat.cs 7402 CalculateStrategicResourceConsumptionPerYear(resourceId). */
export function calculateStrategicResourceConsumptionPerYear(galaxy: Galaxy, habitat: Habitat, resourceId: number): number {
    let num = 0.0;
    if (habitat.population != null) {
        num = habitat.population.totalAmount / 1000000.0;
        num = Math.sqrt(num);
        const num2 = 5;
        const resourceDefinition = galaxy.resourceSystem.byId.get(resourceId);
        if (resourceDefinition !== undefined && Math.fround(resourceDefinition.colonyGrowthResourceLevel) > 0) {
            return num2 + csInt(5.0 * COLONY_STRATEGIC_RESOURCE_CONSUMPTION_PER_MILLION_PER_YEAR * num * Math.fround(resourceDefinition.colonyGrowthResourceLevel));
        }
        return 0;
    }
    return 0;
}

/** Habitat.cs 7293 ConsumeAndOrderStrategicResourceSupply(timePassed) — timePassed in seconds. */
export function consumeAndOrderStrategicResourceSupply(galaxy: Galaxy, habitat: Habitat, timePassed: number): void {
    if (habitat.population == null || habitat.population.items.length <= 0 || habitat.population.totalAmount <= 0 || habitat.empire === null) return;
    const orders = galaxy.orders.getOrdersForHabitat(habitat);
    const resources = galaxy.resourceSystem.resources;
    for (let i = 0; i < resources.length; i++) {
        const resourceDefinition = resources[i];
        if (resourceDefinition != null && Math.fround(resourceDefinition.colonyGrowthResourceLevel) > 0) {
            const resource = new ResourceRef(resourceDefinition.resourceId);
            consumeStrategicResource(galaxy, habitat, resource, timePassed);
            checkAndOrderResourceHabitat(galaxy, habitat, habitat, orders, resource);
        }
    }
}

/** Habitat.cs 7312 ConsumeStrategicResource(resource, timePassed). */
function consumeStrategicResource(galaxy: Galaxy, habitat: Habitat, resource: ResourceRef, timePassed: number): void {
    const cargo = habitat.cargo === null ? null : cargoGetCargo(habitat.cargo, resource.resourceId, habitat.empire);
    if (cargo === null) return;
    const num = csInt(0.5 + (timePassed / REAL_SECONDS_IN_GALACTIC_YEAR) * calculateStrategicResourceConsumptionPerYear(galaxy, habitat, resource.resourceId));
    if (cargoAvailable(cargo) > num) {
        cargo.amount -= num;
        if (cargo.amount <= 0 && cargo.reserved <= 0) cargoRemove(habitat.cargo!, cargo);
    }
}

/** Habitat.cs 7330 CheckAndOrderResource(colony, colonyOrders, resource) (`self` is the C# `this` habitat). */
function checkAndOrderResourceHabitat(galaxy: Galaxy, self: Habitat, colony: Habitat, colonyOrders: OrderList, resource: ResourceRef): void {
    const num = csInt(1.6 * calculateStrategicResourceConsumptionPerYear(galaxy, self, resource.resourceId));
    const minimumResourceLevel = csInt(num * 0.8);
    const r = checkResourceMeetsMinimumLevelHabitat(galaxy, resource, minimumResourceLevel, num, colony, colonyOrders);
    if (r.meets) return;
    const num2 = r.amountToOrder * galaxyResourceCurrentPrices(galaxy)[resource.resourceId];
    const empire = self.empire!;
    const num3 = empire !== galaxy.independentEmpire ? getPrivateFunds(empire) : Number.MAX_VALUE;
    if (num2 < num3) {
        let builtObject: BuiltObject | null = null;
        if (colony.hasSpacePort) builtObject = determineSpacePortAtHabitat(colony);
        if (builtObject !== null && builtObject.isSpacePort) {
            empireCreateOrder(galaxy, empire, builtObject, resource, r.amountToOrder, false, OrderType.Standard);
        } else {
            empireCreateOrder(galaxy, empire, colony, resource, r.amountToOrder, false, OrderType.Standard);
        }
    }
}

/** Habitat.cs 7360 CheckResourceMeetsMinimumLevel(resource, minimumResourceLevel, maximumResourceLevel, colony, colonyOrders, out amountToOrder). */
function checkResourceMeetsMinimumLevelHabitat(galaxy: Galaxy, resource: ResourceRef, minimumResourceLevel: number, maximumResourceLevel: number, colony: Habitat, colonyOrders: OrderList): { meets: boolean; amountToOrder: number } {
    let result = false;
    let num2 = 0;
    let num4 = -1;
    if (colony.cargo !== null && cargoGetExists(colony.cargo, resource.resourceId)) num4 = cargoIndexOf(colony.cargo, resource.resourceId, colony.owner);
    if (num4 >= 0) num2 = cargoAvailable(colony.cargo!.items[num4]);
    for (let num5 = colonyOrders.indexOfResourceId(resource.resourceId, 0); num5 >= 0; num5 = colonyOrders.indexOfResourceId(resource.resourceId, num5)) {
        num2 = (num2 + colonyOrders.items[num5].amountRequested) | 0;
        num5++;
    }
    let amountToOrder = Math.max(0, maximumResourceLevel - num2);
    if (amountToOrder > 0) {
        if (isRestrictedResource(galaxy, resource.resourceId)) amountToOrder = Math.max(amountToOrder, MINIMUM_RESTRICTED_RESOURCE_REORDER_AMOUNT);
        else amountToOrder = Math.max(amountToOrder, MINIMUM_CONTRACT_SIZE);
        amountToOrder = Math.min(20000, amountToOrder);
    }
    if (num2 >= minimumResourceLevel) result = true;
    return { meets: result, amountToOrder };
}

// ------------------------------------------------------------------------------------------
// Galaxy.cs 1682 MaintainIndependentColonyFuelLevels.

/** Galaxy.cs 1682 MaintainIndependentColonyFuelLevels. */
export function maintainIndependentColonyFuelLevels(galaxy: Galaxy): void {
    for (let i = 0; i < galaxy.independentColonies.length; i++) {
        const habitat = galaxy.independentColonies[i];
        if (habitat.owner !== galaxy.independentEmpire) continue;
        const orders = galaxy.orders.getOrdersForHabitat(habitat);
        const fuelResources = galaxy.resourceSystem.fuelResources;
        for (let j = 0; j < fuelResources.length; j++) {
            const resourceDefinition = fuelResources[j];
            if (resourceDefinition != null) checkAndOrderResourceGalaxy(galaxy, habitat, orders, new ResourceRef(resourceDefinition.resourceId));
        }
    }
}

/** Galaxy.cs 1703 CheckAndOrderResource(colony, colonyOrders, resource). */
function checkAndOrderResourceGalaxy(galaxy: Galaxy, colony: Habitat, colonyOrders: OrderList, resource: ResourceRef): void {
    const num = calculateResourceLevelHabitat(galaxy, resource.resourceId, colony, true, true);
    const minimumResourceLevel = csInt(num * 0.6);
    const r = checkResourceMeetsMinimumLevelGalaxy(resource, minimumResourceLevel, num, colony, colonyOrders);
    if (!r.meets) {
        // 1710: _ = ResourceCurrentPrices[resource.ResourceID] — no effect.
        galaxyCreateOrder(galaxy, colony, resource, r.amountToOrder, false);
    }
}

/** Galaxy.cs 1715 CheckResourceMeetsMinimumLevel(resource, minimumResourceLevel, maximumResourceLevel, colony, colonyOrders, out amountToOrder). */
function checkResourceMeetsMinimumLevelGalaxy(resource: ResourceRef, minimumResourceLevel: number, maximumResourceLevel: number, colony: Habitat, colonyOrders: OrderList): { meets: boolean; amountToOrder: number } {
    let result = false;
    let num2 = 0;
    let num4 = -1;
    if (colony.cargo !== null && cargoGetExists(colony.cargo, resource.resourceId)) num4 = cargoIndexOf(colony.cargo, resource.resourceId, colony.owner);
    if (num4 >= 0) num2 = colony.cargo!.items[num4].amount; // Amount (not Available) here
    for (let num5 = colonyOrders.indexOfResourceId(resource.resourceId, 0); num5 >= 0; num5 = colonyOrders.indexOfResourceId(resource.resourceId, num5)) {
        num2 = (num2 + colonyOrders.items[num5].amountRequested) | 0;
        num5++;
    }
    let amountToOrder = Math.max(0, maximumResourceLevel - num2);
    if (amountToOrder < COLONY_MINIMUM_RESOURCE_REORDER_AMOUNT) amountToOrder = 0;
    if (num2 >= minimumResourceLevel) result = true;
    return { meets: result, amountToOrder };
}

// ---- Added by M4j: the order-side parts of Empire.4.cs EvaluateColonyVariables (2943) / EvaluateColonyVariablesPirate
// (2579). None of them draws Galaxy.Rnd; none affects the growth / development state M4j computes.

/** Resource with its SortTag (Resource.cs 16, double.MinValue by default) — the ShowCheapestLuxuryResources list element. */
interface SortedResource {
    ref: ResourceRef;
    sortTag: number;
}

/** ResourceList.Contains(resource) (ResourceList.cs 78): by ResourceID. */
function resourceListContains(list: readonly ResourceRef[] | readonly number[], resourceId: number): boolean {
    for (const r of list) if ((typeof r === 'number' ? r : r.resourceId) === resourceId) return true;
    return false;
}

/** Galaxy.3.cs 412 ShowCheapestLuxuryResources. */
function showCheapestLuxuryResources(galaxy: Galaxy): SortedResource[] {
    const resourceList: SortedResource[] = [];
    const resources = galaxy.resourceSystem.resources;
    const prices = galaxyResourceCurrentPrices(galaxy);
    for (let i = 0; i < resources.length; i++) {
        const resourceDefinition = resources[i];
        if (resourceGroupOf(resourceDefinition) === ResourceGroup.Luxury && resourceDefinition.superLuxuryBonusAmount <= 0) {
            // ResourceCurrentPrices[i]: indexed by the Resources position (== ResourceID in the data files).
            resourceList.push({ ref: new ResourceRef(resourceDefinition.resourceId), sortTag: prices[i] });
        }
    }
    // Resource.CompareTo (Resource.cs 44): SortTag > double.MinValue → SortTag.CompareTo (prices are never MinValue / NaN).
    netSort(resourceList, (x, y) => (x.sortTag < y.sortTag ? -1 : x.sortTag > y.sortTag ? 1 : 0));
    return resourceList;
}

/** Galaxy.3.cs 431 UpdateResourcesFromSuppliedResources(resources, resource, supplied). */
function updateResourcesFromSuppliedResources(resources: number[], resourceId: number, supplied: readonly number[]): number[] {
    if (resourceListContains(supplied, resourceId) && !resourceListContains(resources, resourceId)) resources.push(resourceId);
    return resources;
}

/** Galaxy.3.cs 355 ShowAvailableRestrictedResourcesForEmpireSelfSupplied(empire) (resource ids). */
function showAvailableRestrictedResourcesForEmpireSelfSupplied(galaxy: Galaxy, empire: Empire): number[] {
    let resourceList: number[] = [];
    const supplied = determineResourcesEmpireSupplies(empire);
    const superLuxury = galaxy.resourceSystem.superLuxuryResources;
    for (let i = 0; i < superLuxury.length; i++) resourceList = updateResourcesFromSuppliedResources(resourceList, superLuxury[i].resourceId, supplied);
    return resourceList;
}

/** Galaxy.3.cs 367 ShowAvailableRestrictedResourcesForEmpire(empire) (resource ids). */
function showAvailableRestrictedResourcesForEmpire(galaxy: Galaxy, empire: Empire): number[] {
    let resourceList: number[] = [];
    const superLuxury = galaxy.resourceSystem.superLuxuryResources;
    for (let i = 0; i < galaxy.empires.length; i++) {
        const empire2 = galaxy.empires[i];
        if (empire2 === empire) {
            const supplied = determineResourcesEmpireSupplies(empire);
            for (let j = 0; j < superLuxury.length; j++) resourceList = updateResourcesFromSuppliedResources(resourceList, superLuxury[j].resourceId, supplied);
        } else {
            const diplomaticRelation = obtainDiplomaticRelation(empire2, empire);
            if (diplomaticRelation.type !== DiplomaticRelationType.NotMet && diplomaticRelation.supplyRestrictedResources) {
                const supplied2 = determineResourcesEmpireSupplies(empire2);
                for (let k = 0; k < superLuxury.length; k++) resourceList = updateResourcesFromSuppliedResources(resourceList, superLuxury[k].resourceId, supplied2);
            }
        }
        if (resourceList.length >= 3) break;
    }
    return resourceList;
}

/** The three lists EvaluateColonyVariables builds once per call (Empire.4.cs 2959-2961). */
export interface ColonyLuxuryResourceLists {
    resourceList: SortedResource[];
    resourceList2: number[];
    resourceList3: number[];
}

/**
 * Empire.4.cs 2959-2982 (2590-2613 pirate): resourceList = Galaxy.ShowCheapestLuxuryResources(), resourceList2/3 =
 * ShowAvailableRestrictedResourcesForEmpire(SelfSupplied)(this), `_SelfSuppliedLuxuryResources ??= new ResourceList()`,
 * then the self-supplied-first / unavailable-last reorder (RemoveAt by the snapshot's index, as in the C#). No Rnd.
 */
export function prepareColonyLuxuryResourceLists(galaxy: Galaxy, empire: Empire): ColonyLuxuryResourceLists {
    const resourceList = showCheapestLuxuryResources(galaxy);
    const resourceList2 = showAvailableRestrictedResourcesForEmpire(galaxy, empire);
    const resourceList3 = showAvailableRestrictedResourcesForEmpireSelfSupplied(galaxy, empire);
    if (empire.selfSuppliedLuxuryResources === null) empire.selfSuppliedLuxuryResources = [];
    const array = resourceList.slice();
    for (let num2 = array.length - 1; num2 > 0; num2--) {
        if (resourceListContains(empire.selfSuppliedLuxuryResources, array[num2].ref.resourceId)) {
            resourceList.splice(num2, 1);
            resourceList.splice(0, 0, array[num2]);
        }
    }
    for (let i = 0; i < array.length; i++) {
        if (resourceListContains(empire.unavailableLuxuryResources, array[i].ref.resourceId)) {
            resourceList.splice(i, 1);
            resourceList.push(array[i]);
        }
    }
    return { resourceList, resourceList2, resourceList3 };
}

/**
 * Empire.4.cs 4144 CheckResourcesMeetingMinimumLevel(resourceGroup, minimumResourceLevel, colony, colonyOrders): how many
 * distinct commodity entries exceed the level. The C# dedupes with List<Resource>.IndexOf — reference equality (Resource
 * does not override Equals) — so here the key is the cargo / order commodity object, not its id.
 */
function checkResourcesMeetingMinimumLevel(galaxy: Galaxy, resourceGroupValue: ResourceGroup, minimumResourceLevel: number, colony: Habitat, colonyOrders: OrderList): number {
    let num = 0;
    const resourceList: unknown[] = [];
    const list: number[] = [];
    const owner = colony.owner;
    if (colony.cargo !== null && owner !== null) {
        // CargoList.IndexOf(resourceGroup, empire, startIndex) (CargoList.cs 601).
        const items = colony.cargo.items;
        for (let num5 = 0; num5 < items.length; num5++) {
            const cargo = items[num5];
            if (cargo.commodityIsComponent || cargoEmpireId(cargo) !== owner.empireId || resourceGroup(galaxy, cargo.commodity.resourceId) !== resourceGroupValue) continue;
            const num2 = (cargo.amount - cargo.reserved) | 0;
            const num3 = resourceList.indexOf(cargo.commodity);
            if (num3 < 0) {
                resourceList.push(cargo.commodity);
                list.push(num2);
            } else {
                list[num3] += num2;
            }
        }
    }
    // OrderList.IndexOf(resourceGroup, startIndex) (OrderList.cs 260).
    for (let num6 = 0; num6 < colonyOrders.items.length; num6++) {
        const order = colonyOrders.items[num6];
        const commodity = order.commodityResource;
        if (commodity === null || resourceGroup(galaxy, commodity.resourceId) !== resourceGroupValue) continue;
        const num4 = order.amountRequested;
        const num3 = resourceList.indexOf(commodity);
        if (num3 < 0) {
            resourceList.push(commodity);
            list.push(num4);
        } else {
            list[num3] += num4;
        }
    }
    for (let i = 0; i < list.length; i++) {
        if (list[i] > minimumResourceLevel) num++;
    }
    return num;
}

/** List<Resource> indexer: the C# throws ArgumentOutOfRangeException past the end. */
function resourceListAt(list: SortedResource[], index: number): SortedResource {
    if (index < 0 || index >= list.length) throw new Error(`ArgumentOutOfRangeException: luxury resourceList[${index}] (Empire.4.cs 3206)`);
    return list[index];
}

/**
 * Empire.4.cs 3186-3301 (2817-2932 pirate): OrderList orders = Galaxy.Orders.GetOrders(habitat) (+ the space port's),
 * CheckResourcesMeetingMinimumLevel(Luxury, num6), and when _ControlColonyDevelopment the luxury / restricted CreateOrder
 * loop. num6 / num7 / val are CalculateMinimumLuxuryResourceLevel[Restricted] taken at Empire.4.cs 3036-3038. No Rnd.
 */
export function orderColonyLuxuryResources(galaxy: Galaxy, empire: Empire, habitat: Habitat, builtObject: BuiltObject | null, lists: ColonyLuxuryResourceLists, num6: number, num7: number, val: number): void {
    const { resourceList, resourceList2, resourceList3 } = lists;
    const orders = galaxy.orders.getOrdersForHabitat(habitat);
    if (builtObject !== null) {
        const orders2 = galaxy.orders.getOrdersForBuiltObject(builtObject);
        orders.addRange(orders2.items);
    }
    let num21 = 10;
    if (habitat.population.totalAmount < 200000000) num21 = 5;
    let num22 = 0;
    num22 += checkResourcesMeetingMinimumLevel(galaxy, ResourceGroup.Luxury, num6, habitat, orders);
    const num23 = num21 - num22;
    let resource: ResourceRef | null = null;
    if (!empire.controlColonyDevelopment) return;
    const prices = galaxyResourceCurrentPrices(galaxy);
    for (let num24 = 0; num24 < num23; num24++) {
        resource = resourceListAt(resourceList, num24).ref;
        const iterationCount = { count: 0 };
        let flag3 = false;
        do {
            flag3 = false;
            resource = resourceListAt(resourceList, num24).ref;
            for (const resource5 of habitat.resources) {
                if (resource5.resourceId === resource.resourceId) {
                    flag3 = true;
                    num24++;
                }
            }
        } while (conditionCheckLimit(flag3, 100, iterationCount));
        const maximumResourceLevel = csInt(num6 * 1.5);
        const amountToOrder = checkResourceMeetsMinimumLevelHabitat(galaxy, resource, num6, maximumResourceLevel, habitat, orders).amountToOrder; // Empire.4.cs 4101
        if (amountToOrder <= 0) continue;
        const num25 = amountToOrder * prices[resource.resourceId];
        if (num25 < getPrivateFunds(empire)) {
            if (builtObject !== null && builtObject.isSpacePort) empireCreateOrder(galaxy, empire, builtObject, resource, amountToOrder, false, OrderType.Standard, true);
            else empireCreateOrder(galaxy, empire, habitat, resource, amountToOrder, false, OrderType.Standard, true);
        }
    }
    if (resourceList2.length > 0 && habitatDevelopmentLevel(habitat) >= 80) {
        let num26 = 0;
        const maximumResourceLevel2 = num7 * 2;
        let resource2: ResourceRef | null = null;
        let num27 = 0;
        const superLuxury = galaxy.resourceSystem.superLuxuryResources;
        const candidates = resourceList3 !== null && resourceList3.length > 0 ? resourceList3 : resourceList2;
        for (let num28 = 0; num28 < superLuxury.length; num28++) {
            const resource3 = new ResourceRef(superLuxury[num28].resourceId);
            if (resourceListContains(candidates, resource3.resourceId)) {
                const amountToOrder2 = checkResourceMeetsMinimumLevelHabitat(galaxy, resource3, num7, maximumResourceLevel2, habitat, orders).amountToOrder;
                if (amountToOrder2 > num26) {
                    num26 = amountToOrder2;
                    resource2 = resource3;
                }
            }
        }
        num27 = Math.max(val, num26);
        if (resource2 !== null && num27 > 0) {
            const num30 = num27 * prices[resource2.resourceId];
            if (num30 < getPrivateFunds(empire)) {
                if (builtObject !== null && builtObject.isSpacePort) empireCreateOrder(galaxy, empire, builtObject, resource2, num27, false, OrderType.Standard, true);
                else empireCreateOrder(galaxy, empire, habitat, resource2, num27, false, OrderType.Standard, true);
            }
        }
    }
}

/** Empire.4.cs 2330 MaintainColonyCriticalResourceLevels(spacePort, colony) (called when _ControlColonyStockLevels). No Rnd. */
export function maintainColonyCriticalResourceLevels(galaxy: Galaxy, empire: Empire, spacePort: BuiltObject | null, colony: Habitat): void {
    if (colony == null || colony.hasBeenDestroyed) return;
    const resourceList = determineCriticalResources(galaxy, colony);
    if (resourceList.length <= 0) return;
    const orders = galaxy.orders.getOrdersForHabitat(colony);
    if (spacePort !== null && spacePort.isSpacePort) {
        const orders2 = galaxy.orders.getOrdersForBuiltObject(spacePort);
        if (orders2.count > 0) orders.addRange(orders2.items);
    }
    for (let i = 0; i < resourceList.length; i++) {
        // Empire.4.cs 2488: the (…, isCriticalResource) overload forwards isCriticalResource: false (C# oddity kept).
        checkAndOrderResourceEmpire(galaxy, empire, colony, orders, spacePort, new ResourceRef(resourceList[i]), false, 0);
    }
}

/** Empire.4.cs 2357 MaintainColonyResourceLevels(spacePort, colony) (called when _ControlColonyStockLevels). No Rnd. */
export function maintainColonyResourceLevels(galaxy: Galaxy, empire: Empire, spacePort: BuiltObject | null, colony: Habitat): void {
    const orders = galaxy.orders.getOrdersForHabitat(colony);
    if (spacePort !== null && spacePort.isSpacePort) {
        const orders2 = galaxy.orders.getOrdersForBuiltObject(spacePort);
        if (orders2.count > 0) orders.addRange(orders2.items);
    }
    let num = 0;
    if (empire.shipGroups != null) {
        for (let i = 0; i < empire.shipGroups.length; i++) {
            const shipGroup = empire.shipGroups[i] as { gatherPoint: unknown; ships: BuiltObject[] } | null;
            if (shipGroup != null && shipGroup.gatherPoint != null && shipGroup.gatherPoint === colony) {
                // ShipGroup.cs 2755 TotalFuelCapacity.
                let totalFuelCapacity = 0;
                for (let index = 0; index < shipGroup.ships.length; ++index) totalFuelCapacity += shipGroup.ships[index].fuelCapacity;
                num += totalFuelCapacity;
            }
        }
    }
    const ordered = galaxy.resourceSystem.strategicResourcesOrderedByRelativeImportance;
    for (let j = 0; j < ordered.length; j++) {
        const resourceDefinition = ordered[j];
        if (resourceDefinition != null) {
            const resource = new ResourceRef(resourceDefinition.resourceId);
            if (resourceDefinition.isFuel) checkAndOrderResourceEmpire(galaxy, empire, colony, orders, spacePort, resource, false, num);
            else checkAndOrderResourceEmpire(galaxy, empire, colony, orders, spacePort, resource, false, 0);
        }
    }
}

/** Empire.4.cs 2493 CheckAndOrderResource(colony, colonyOrders, colonySpacePort, resource, isCriticalResource, fleetFuelAmount). */
function checkAndOrderResourceEmpire(galaxy: Galaxy, empire: Empire, colony: Habitat, colonyOrders: OrderList, colonySpacePort: BuiltObject | null, resource: ResourceRef, isCriticalResource: boolean, fleetFuelAmount: number): void {
    const num = calculateResourceLevelHabitat(galaxy, resource.resourceId, colony, false, false, isCriticalResource, fleetFuelAmount);
    const minimumResourceLevel = csInt(num * 0.6);
    const r = checkResourceMeetsMinimumLevelHabitat(galaxy, resource, minimumResourceLevel, num, colony, colonyOrders); // Empire.4.cs 4101 (same body as Habitat.cs 7360)
    if (r.meets) return;
    const num2 = r.amountToOrder * galaxyResourceCurrentPrices(galaxy)[resource.resourceId];
    if (num2 < getPrivateFunds(empire)) {
        if (colonySpacePort !== null && colonySpacePort.isSpacePort) empireCreateOrder(galaxy, empire, colonySpacePort, resource, r.amountToOrder, false, OrderType.Standard);
        else empireCreateOrder(galaxy, empire, colony, resource, r.amountToOrder, false, OrderType.Standard);
    }
}

/** Galaxy.CalculateMaximumOrderFulfillmentDistance(habitat) (Galaxy.3.cs 1864; result unused at Empire.4.cs 3035). */
export function calculateMaximumOrderFulfillmentDistanceForHabitat(galaxy: Galaxy, habitat: Habitat): number {
    return calculateMaximumOrderFulfillmentDistance(galaxy, habitat.xpos, habitat.ypos);
}

