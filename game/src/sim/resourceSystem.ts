// Port of ResourceSystem.cs Update / CalculateRelativeImportanceLevels and
// ResourceDefinitionList.SortByRelativeImportance (task C2a): the strategic /
// luxury / fuel resource lists and each resource's RelativeImportance, which
// colony setup (SetColonyResources, SetStartupColonyResourceCargo) iterates.

import type { Resource } from './data/resources';
import type { Component } from './data/components';
import { netSort } from './netSort';

// ResourceGroup.cs: Undefined, Mineral, Gas, Luxury. The TS resource `type`
// is the file's 0=Mineral, 1=Gas, 2=Luxury, i.e. group - 1.
export enum ResourceGroup {
    Undefined,
    Mineral,
    Gas,
    Luxury,
}

export function resourceGroupOf(r: Resource): ResourceGroup {
    return (r.type + 1) as ResourceGroup;
}

export interface ResourceSystem {
    resources: Resource[];
    strategicResources: Resource[];
    luxuryResources: Resource[];
    superLuxuryResources: Resource[];
    gasStrategicResources: Resource[];
    mineralStrategicResources: Resource[];
    fuelResources: Resource[];
    colonyManufacturedResources: Resource[];
    strategicResourcesOrderedByRelativeImportance: Resource[];
    /** ResourceDefinition.RelativeImportance (C# float) by resource id. */
    relativeImportance: Map<number, number>;
    byId: Map<number, Resource>;
}

// Port of ResourceSystem.Update(components).
export function buildResourceSystem(resources: Resource[], components: Component[]): ResourceSystem {
    const rs: ResourceSystem = {
        resources,
        strategicResources: [],
        luxuryResources: [],
        superLuxuryResources: [],
        gasStrategicResources: [],
        mineralStrategicResources: [],
        fuelResources: [],
        colonyManufacturedResources: [],
        strategicResourcesOrderedByRelativeImportance: [],
        relativeImportance: new Map(),
        byId: new Map(resources.map((r) => [r.resourceId, r])),
    };
    for (const resource of resources) {
        switch (resourceGroupOf(resource)) {
            case ResourceGroup.Mineral:
                rs.strategicResources.push(resource);
                rs.mineralStrategicResources.push(resource);
                break;
            case ResourceGroup.Gas:
                rs.strategicResources.push(resource);
                rs.gasStrategicResources.push(resource);
                break;
            case ResourceGroup.Luxury:
                rs.luxuryResources.push(resource);
                break;
        }
        if (resource.superLuxuryBonusAmount > 0) rs.superLuxuryResources.push(resource);
        if (resource.isFuel) rs.fuelResources.push(resource);
        if (resource.colonyManufacturingLevel > 0) rs.colonyManufacturedResources.push(resource);
    }
    calculateRelativeImportanceLevels(rs, components);
    // SortByRelativeImportance: SortTag = RelativeImportance; Sort(); Reverse().
    const ordered = rs.strategicResources.slice();
    netSort(ordered, (a, b) => floatCompare(rs.relativeImportance.get(a.resourceId) ?? 0, rs.relativeImportance.get(b.resourceId) ?? 0));
    ordered.reverse();
    rs.strategicResourcesOrderedByRelativeImportance = ordered;
    return rs;
}

// C# float.CompareTo.
function floatCompare(a: number, b: number): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

// Port of ResourceSystem.CalculateRelativeImportanceLevels (float math).
function calculateRelativeImportanceLevels(rs: ResourceSystem, components: Component[]): void {
    for (const r of rs.resources) rs.relativeImportance.set(r.resourceId, 0);
    if (components.length <= 0) return;
    const numArray = new Array<number>(rs.resources.length).fill(0);
    for (const c of components) {
        if (c !== null && c.resourceRequirements && c.size < 100) {
            for (const req of c.resourceRequirements) {
                if (numArray.length > req.resourceId) numArray[req.resourceId] += req.amount;
            }
        }
    }
    let num1 = 0;
    for (const v of numArray) if (v > num1) num1 = v;
    for (const resource of rs.resources) {
        let imp = 0;
        if (resource.isFuel) imp = Math.fround(imp + 1);
        if (resource.colonyGrowthResourceLevel > 0) imp = Math.fround(imp + Math.fround(resource.colonyGrowthResourceLevel * 0.5));
        if (numArray.length > resource.resourceId) {
            const num2 = Math.fround(numArray[resource.resourceId] / num1);
            imp = Math.fround(imp + num2);
        }
        rs.relativeImportance.set(resource.resourceId, imp);
    }
}
