// M4g — ManufacturingQueue.cs (415), Manufacturer.cs, ManufacturerList.cs, ResourceDatePairList.cs and
// CargoList.GetResourcesForManufacturing (CargoList.cs 547). Habitat colonies get a queue with one default
// Weapon/Energy/HighTech manufacturer each (Redefine(Habitat)); built objects get one manufacturer per built
// manufacturer component (Redefine(BuiltObject), BuiltObject.cs 3186-3200 via ReDefine).
//
// Rnd: DoManufacturing → ProcessManufacturing draws Galaxy.Rnd.Next(0, Manufacturers.Count) on every call where the
// parent has cargo (ManufacturingQueue.cs 247).
//
// Reachability note: nothing in the C# puts a component into `_ComponentWaitQueue` except the queue itself
// (ManufacturingQueue.AddComponentToManufacture has no callers; Redefine(BuiltObject) only moves a manufacturer's
// in-progress component back to the wait queue, and a manufacturer only ever receives a component from the wait
// queue). In a new game the wait queue therefore stays empty and no component is ever manufactured; the component
// paths are ported for completeness. Component cargo (Cargo(Component, …)) is not modelled by cargo.ts — the two
// sites that would create one throw a TODO(port) error (unreachable, see above).
//
// This module is imported by empire.ts / galaxy.ts / builtObject.ts / startHabitats.ts (queue creation), so it only
// imports leaf modules; the processing half of the class (DoManufacturing, ProcessWaitQueue, ProcessManufacturing,
// ProcessSingleManufacturer, NotifyResourceShortages, CargoList.GetResourcesForManufacturing) lives in industry.ts as
// free functions over the queue's state, which is public here for that reason.

import type { Galaxy } from './galaxy';
import type { BuiltObject } from './builtObject';
import type { Habitat } from './types';
import type { ComponentDefinition } from './componentStatic';
import { IndustryType } from './types';
import { ComponentStatus } from './builtObjectComponent';
import { ComponentType } from './data/components';
import { ComponentCategoryType } from './data/policies';
import { MIN_TIME } from './tick/simTime';

/** C# `Component` as the manufacturing queue sees it (ComponentID, Industry, Size, RequiredResources). */
export type ManufacturedComponent = ComponentDefinition;

// Manufacturer.cs.
export class Manufacturer {
    /** _Component (null = idle). */
    component: ManufacturedComponent | null = null;
    /** _Progress (float). */
    progress = 0;
    /** _ManufacturingSpeed (int, serialised as short). */
    readonly manufacturingSpeed: number;
    /** _Industry. */
    readonly industry: IndustryType;
    /** _ParentBuiltObjectComponentIndex (short). */
    readonly parentBuiltObjectComponentIndex: number;
    /** _ParentBuiltObjectComponentId (short; -1 when built without a component). */
    readonly parentBuiltObjectComponentId: number;

    // Manufacturer(builtObjectComponentIndex, builtObjectComponent, industry, manufacturingSpeed).
    constructor(builtObjectComponentIndex: number, builtObjectComponentId: number | null, industry: IndustryType, manufacturingSpeed: number) {
        this.parentBuiltObjectComponentIndex = (builtObjectComponentIndex << 16) >> 16;
        this.parentBuiltObjectComponentId = builtObjectComponentId === null ? -1 : (builtObjectComponentId << 16) >> 16;
        this.industry = industry;
        this.manufacturingSpeed = manufacturingSpeed;
    }
}

// ManufacturerList.cs.
function canBuildComponent(list: Manufacturer[], component: ManufacturedComponent): boolean {
    const industry = component.industry;
    for (const manufacturer of list) {
        if (manufacturer.industry === industry) return true;
    }
    return false;
}

/** ManufacturerList.AddComponentToManufacture (120). */
export function listAddComponentToManufacture(list: Manufacturer[], component: ManufacturedComponent): boolean {
    for (const manufacturer of list) {
        if (manufacturer.industry === component.industry && manufacturer.component === null) {
            manufacturer.component = component;
            return true;
        }
    }
    return false;
}

/** ManufacturerList.FindManufacturerByComponentIndex (132). */
function findManufacturerByComponentIndex(list: Manufacturer[], componentIndex: number): number {
    for (let index = 0; index < list.length; ++index) {
        if (componentIndex === list[index].parentBuiltObjectComponentIndex) return index;
    }
    return -1;
}

// ResourceDatePair.cs / ResourceDatePairList.cs.
export class ResourceDatePair {
    resourceId: number;
    starDate: number;
    constructor(resourceId: number, starDate: number) {
        this.resourceId = resourceId;
        this.starDate = starDate;
    }
}

export class ResourceDatePairList {
    items: ResourceDatePair[] = [];

    /** ClearResources(ComponentResourceList) (15). */
    clearResources(resourcesToClear: readonly { resourceId: number }[]): void {
        const resourceDatePairList: ResourceDatePair[] = [];
        for (let index1 = 0; index1 < resourcesToClear.length; ++index1) {
            for (let index2 = 0; index2 < this.items.length; ++index2) {
                if (this.items[index2].resourceId === resourcesToClear[index1].resourceId) resourceDatePairList.push(this.items[index2]);
            }
        }
        for (let index = 0; index < resourceDatePairList.length; ++index) {
            const i = this.items.indexOf(resourceDatePairList[index]);
            if (i >= 0) this.items.splice(i, 1);
        }
    }

    /** Contains(byte) (30). */
    contains(resourceId: number): boolean {
        for (let index = 0; index < this.items.length; ++index) {
            if (this.items[index].resourceId === resourceId) return true;
        }
        return false;
    }

    /** CheckAddResource (40). */
    checkAddResource(resourceId: number, starDate: number): void {
        if (this.contains(resourceId)) return;
        this.items.push(new ResourceDatePair(resourceId, starDate));
    }

    /** GetResourcesOlderThanAge (47). */
    getResourcesOlderThanAge(starDate: number, age: number): ResourceDatePair[] {
        const resourcesOlderThanAge: ResourceDatePair[] = [];
        const num = starDate - age;
        for (let index = 0; index < this.items.length; ++index) {
            if (this.items[index].starDate <= num) resourcesOlderThanAge.push(this.items[index]);
        }
        return resourcesOlderThanAge;
    }

    clear(): void {
        this.items = [];
    }
}

export function componentCargoNotModelled(): never {
    // TODO(port) M4d: Cargo(Component, amount, empire, reserved) — component cargo is not modelled by cargo.ts.
    // Unreachable in a new game (see the header: no component ever enters the wait queue).
    throw new Error('TODO(port) M4d: component cargo (ManufacturingQueue completed component)');
}

// ManufacturingQueue.cs.
export class ManufacturingQueue {
    readonly _galaxy: Galaxy;
    readonly _parentBuiltObject: BuiltObject | null;
    readonly _parentHabitat: Habitat | null;
    _manufacturerList: Manufacturer[] | null = null;
    _componentWaitQueue: ManufacturedComponent[] | null = null;
    /** _LastProcessed (DateTime, game ms). */
    _lastProcessed = 0;
    /** _LastProcessedLong = DateTime.MinValue. */
    _lastProcessedLong = MIN_TIME;
    /** _LastResourceShortageNotification = DateTime.MinValue. */
    _lastResourceShortageNotification = MIN_TIME;
    _slotsAvailableWeapons = -1;
    _slotsAvailableHighTech = -1;
    _slotsAvailableEnergy = -1;
    deficientResources = new ResourceDatePairList();

    // ManufacturingQueue(Habitat, Galaxy) (36) / ManufacturingQueue(BuiltObject, Galaxy) (44).
    constructor(parent: Habitat | BuiltObject, galaxy: Galaxy, parentIsBuiltObject: boolean) {
        this._galaxy = galaxy;
        if (parentIsBuiltObject) {
            this._parentBuiltObject = parent as BuiltObject;
            this._parentHabitat = null;
            this.redefineBuiltObject(false);
        } else {
            this._parentBuiltObject = null;
            this._parentHabitat = parent as Habitat;
            this.redefineHabitat();
        }
        this._lastProcessed = galaxy.nowMs;
    }

    static forHabitat(habitat: Habitat, galaxy: Galaxy): ManufacturingQueue {
        return new ManufacturingQueue(habitat, galaxy, false);
    }

    static forBuiltObject(builtObject: BuiltObject, galaxy: Galaxy): ManufacturingQueue {
        return new ManufacturingQueue(builtObject, galaxy, true);
    }

    get manufacturers(): Manufacturer[] | null {
        return this._manufacturerList;
    }

    get componentWaitQueue(): ManufacturedComponent[] | null {
        return this._componentWaitQueue;
    }

    get lastProcessed(): number {
        return this._lastProcessed;
    }

    // UpdateSlotAvailability (52).
    updateSlotAvailability(): void {
        this._slotsAvailableEnergy = 0;
        this._slotsAvailableWeapons = 0;
        this._slotsAvailableHighTech = 0;
        for (const manufacturer of this._manufacturerList!) {
            if (manufacturer.component === null) {
                switch (manufacturer.industry) {
                    case IndustryType.Weapon:
                        ++this._slotsAvailableWeapons;
                        continue;
                    case IndustryType.Energy:
                        ++this._slotsAvailableEnergy;
                        continue;
                    case IndustryType.HighTech:
                        ++this._slotsAvailableHighTech;
                        continue;
                    default:
                        continue;
                }
            }
        }
    }

    // Redefine(Habitat) (77).
    redefineHabitat(): void {
        if (this._manufacturerList === null) this._manufacturerList = [];
        if (this._componentWaitQueue === null) this._componentWaitQueue = [];
        this._manufacturerList.push(new Manufacturer(-1, 62, IndustryType.Weapon, 24000));
        this._manufacturerList.push(new Manufacturer(-1, 63, IndustryType.Energy, 24000));
        this._manufacturerList.push(new Manufacturer(-1, 64, IndustryType.HighTech, 24000));
        this.updateSlotAvailability();
    }

    // Redefine(BuiltObject[, forceSingleManufacturerOfEachType]) (88/90). Reads this._ParentBuiltObject, as the C# does.
    redefineBuiltObject(forceSingleManufacturerOfEachType = false): boolean {
        if (this._manufacturerList === null) this._manufacturerList = [];
        if (this._componentWaitQueue === null) this._componentWaitQueue = [];
        let flag = false;
        const components = this._parentBuiltObject!.components.items;
        for (let index = 0; index < components.length; ++index) {
            const component = components[index];
            if (component.category === ComponentCategoryType.Manufacturer) {
                const byComponentIndex = findManufacturerByComponentIndex(this._manufacturerList, index);
                if (component.status === ComponentStatus.Damaged || component.status === ComponentStatus.Unbuilt) {
                    if (byComponentIndex >= 0) {
                        if (this._manufacturerList[byComponentIndex].component !== null) {
                            this._componentWaitQueue.push(this._manufacturerList[byComponentIndex].component!);
                            this._manufacturerList[byComponentIndex].component = null;
                        }
                        this._manufacturerList.splice(byComponentIndex, 1);
                    }
                } else {
                    flag = true;
                    if (byComponentIndex < 0) {
                        let industry = IndustryType.Energy;
                        switch (component.type) {
                            case ComponentType.ManufacturerWeaponsPlant:
                                industry = IndustryType.Weapon;
                                break;
                            case ComponentType.ManufacturerEnergyPlant:
                                industry = IndustryType.Energy;
                                break;
                            case ComponentType.ManufacturerHighTechPlant:
                                industry = IndustryType.HighTech;
                                break;
                        }
                        this._manufacturerList.push(new Manufacturer(index, component.componentId, industry, component.value1));
                    }
                }
            }
        }
        if (!flag && forceSingleManufacturerOfEachType) {
            this._manufacturerList.push(new Manufacturer(-1, 62, IndustryType.Weapon, 5000));
            this._manufacturerList.push(new Manufacturer(-1, 63, IndustryType.Energy, 5000));
            this._manufacturerList.push(new Manufacturer(-1, 64, IndustryType.HighTech, 5000));
            flag = true;
        }
        this.updateSlotAvailability();
        if (!flag) {
            this._manufacturerList = null;
            this._componentWaitQueue = null;
        }
        return flag;
    }

    // ProcessWaitQueue / ProcessManufacturing / ProcessSingleManufacturer / DoManufacturing / NotifyResourceShortages
    // (152-376): industry.ts (manufacturingQueueDoManufacturing and helpers).

    /** AddComponentToManufacture(component) (378). */
    addComponentToManufacture(component: ManufacturedComponent): boolean {
        if (!canBuildComponent(this._manufacturerList!, component)) return false;
        this._componentWaitQueue!.push(component);
        return true;
    }

    /** Clear() (385). */
    clear(): void {
        this._componentWaitQueue!.length = 0;
        for (const manufacturer of this._manufacturerList!) {
            if (manufacturer.component !== null) {
                componentCargoNotModelled(); // cargo1.Add(new Cargo(manufacturer.Component, 1, empire, 1))
            }
            manufacturer.progress = 0.0;
            manufacturer.component = null;
        }
        this.deficientResources.clear();
        this.updateSlotAvailability();
    }
}

/**
 * BuiltObject.cs 3186-3200 (inside ReDefine): the manufacturing-queue part. `flag9` = the design has a manufacturer
 * component. Returns the new value of BuiltObject._ManufacturingQueue.
 */
export function redefineBuiltObjectManufacturingQueue(galaxy: Galaxy, builtObject: BuiltObject, flag9: boolean, current: ManufacturingQueue | null): ManufacturingQueue | null {
    let manufacturingQueue = current;
    if (flag9) {
        if (manufacturingQueue === null) manufacturingQueue = ManufacturingQueue.forBuiltObject(builtObject, galaxy);
        if (!manufacturingQueue.redefineBuiltObject()) manufacturingQueue = null;
    } else if (manufacturingQueue !== null && !manufacturingQueue.redefineBuiltObject()) {
        manufacturingQueue = null;
    }
    return manufacturingQueue;
}

/** Habitat.ManufacturingQueue as the typed value (types.ts declares it `unknown`). */
export function habitatManufacturingQueue(habitat: Habitat): ManufacturingQueue | null {
    return (habitat.manufacturingQueue as ManufacturingQueue | null) ?? null;
}

/** BuiltObject.ManufacturingQueue as the typed value (builtObject.ts declares it `unknown`). */
export function builtObjectManufacturingQueue(builtObject: BuiltObject): ManufacturingQueue | null {
    return (builtObject.manufacturingQueue as ManufacturingQueue | null) ?? null;
}

/** `if (colony.ManufacturingQueue == null) colony.ManufacturingQueue = new ManufacturingQueue(colony, galaxy)`. */
export function ensureHabitatManufacturingQueue(galaxy: Galaxy, habitat: Habitat): void {
    if (habitat.manufacturingQueue === null) habitat.manufacturingQueue = ManufacturingQueue.forHabitat(habitat, galaxy);
}
