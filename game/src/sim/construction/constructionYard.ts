// M4h — construction yards (ConstructionYard.cs, ConstructionYardList.cs), ships under construction
// (BuiltObject.cs 3877 CheckWhetherStillBeingBuilt), the queue-creation hooks and the component-list helpers
// the construction code uses (ComponentList.Diff, BuiltObjectComponentList.ResolveComponentList /
// FindNextBuiltComponent / FindNextUnbuiltComponent / IndexByIdAndStatus).
// Rnd: none.
//
// This module stays import-light on purpose: builtObject.ts (ReDefine), empire.ts (TakeOwnershipOfColony), galaxy.ts
// and startHabitats.ts create queues through it, and constructionQueue.ts (which pulls in characters / research /
// missions) registers the ConstructionQueue factory here at module load (the import cycle otherwise runs taxes.ts'
// top-level hook registration before empire.ts is initialised).

import type { Galaxy } from '../galaxy';
import type { BuiltObject } from '../builtObject';
import { ComponentStatus, toShort, type BuiltObjectComponent, type BuiltObjectComponentList } from '../builtObjectComponent';
import type { ComponentDefinition } from '../componentStatic';
import type { Habitat } from '../types';

/** ConstructionYard.cs (the fields and the 4-arg constructor, 97-106). */
export class ConstructionYard {
    shipUnderConstruction: BuiltObject | null = null;
    /** int _ConstructionSpeed. */
    constructionSpeed: number;
    /** int _MaximumShipSize. */
    readonly maximumShipSize: number;
    private _incrementalProgress = 0; // float
    /** short _ComponentId. */
    readonly componentId: number;
    /** short _BuiltObjectComponentId. */
    readonly builtObjectComponentId: number;
    retrofitComponentsToBeBuilt: ComponentDefinition[] | null = null;
    retrofitComponentsToBeScrapped: ComponentDefinition[] | null = null;
    private _buildSpeedModifier = 1; // float _BuildSpeedModifier = 1f

    constructor(componentId: number, builtObjectComponentId: number, maximumShipSize: number, constructionSpeed: number) {
        this.componentId = toShort(componentId);
        this.builtObjectComponentId = builtObjectComponentId;
        this.maximumShipSize = maximumShipSize;
        this.constructionSpeed = constructionSpeed;
    }

    /** float IncrementalProgress. */
    get incrementalProgress(): number {
        return this._incrementalProgress;
    }
    set incrementalProgress(v: number) {
        this._incrementalProgress = Math.fround(v);
    }
    /** float BuildSpeedModifier. */
    get buildSpeedModifier(): number {
        return this._buildSpeedModifier;
    }
    set buildSpeedModifier(v: number) {
        this._buildSpeedModifier = Math.fround(v);
    }
}

/** ConstructionYardList.CountUnderConstruction (ConstructionYardList.cs 14). */
export function yardsCountUnderConstruction(yards: readonly ConstructionYard[]): number {
    let underConstruction = 0;
    for (let index = 0; index < yards.length; ++index) {
        if (yards[index].shipUnderConstruction !== null) ++underConstruction;
    }
    return underConstruction;
}

/** ConstructionYardList.CountPlanetDestroyersUnderConstruction (ConstructionYardList.cs 27). */
export function yardsCountPlanetDestroyersUnderConstruction(yards: readonly (ConstructionYard | null)[]): number {
    let underConstruction = 0;
    for (let index = 0; index < yards.length; ++index) {
        const constructionYard = yards[index];
        if (constructionYard != null && constructionYard.shipUnderConstruction !== null && constructionYard.shipUnderConstruction.design != null && constructionYard.shipUnderConstruction.design.isPlanetDestroyer) {
            ++underConstruction;
        }
    }
    return underConstruction;
}

/** ConstructionYardList.IndexOf(BuiltObjectComponent) (ConstructionYardList.cs 67). */
export function yardsIndexOfComponent(yards: readonly ConstructionYard[], builtObjectComponent: BuiltObjectComponent | null): number {
    if (builtObjectComponent !== null && builtObjectComponent.builtObjectComponentId >= 0) {
        for (let index = 0; index < yards.length; ++index) {
            if (builtObjectComponent.builtObjectComponentId === yards[index].builtObjectComponentId) return index;
        }
    }
    return -1;
}

/** ConstructionYardList.IndexOf(BuiltObject) (ConstructionYardList.cs 83). */
export function yardsIndexOfShip(yards: readonly ConstructionYard[], builtObject: BuiltObject | null): number {
    for (let index = 0; index < yards.length; ++index) {
        if (builtObject === yards[index].shipUnderConstruction) return index;
    }
    return -1;
}

// ---------------------------------------------------------------------------------------------------------------
// Component-list helpers (ComponentList.cs / BuiltObjectComponentList.cs)
// ---------------------------------------------------------------------------------------------------------------

/** ComponentList.IndexById(component): first entry with the same ComponentID. */
function componentListIndexById(list: readonly ComponentDefinition[], component: ComponentDefinition): number {
    for (let i = 0; i < list.length; i++) {
        if (list[i].componentId === component.componentId) return i;
    }
    return -1;
}

/**
 * ComponentList.Diff(components) (ComponentList.cs 294): the entries of `components` left after removing, for every
 * entry of `self` (walked from the end), the first entry of `components` with the same id.
 */
export function componentListDiff(self: readonly ComponentDefinition[], components: readonly ComponentDefinition[]): ComponentDefinition[] {
    const componentList1 = self.slice();
    const componentList2 = components.slice();
    for (let index1 = componentList1.length - 1; index1 >= 0; --index1) {
        const index2 = componentListIndexById(componentList2, componentList1[index1]);
        if (index2 >= 0) {
            componentList2.splice(index2, 1);
            componentList1.splice(index1, 1);
        }
    }
    return componentList2;
}

/** BuiltObjectComponentList.ResolveComponentList (BuiltObjectComponentList.cs 247): `new Component(id)` per entry. */
export function resolveComponentList(components: BuiltObjectComponentList): ComponentDefinition[] {
    const componentList: ComponentDefinition[] = [];
    for (const component1 of components.items) componentList.push(component1.def);
    return componentList;
}

/** BuiltObjectComponentList.FindNextUnbuiltComponent(startIndex) (100). */
export function findNextUnbuiltComponent(components: BuiltObjectComponentList, startIndex: number): number {
    const items = components.items;
    if (startIndex >= items.length) return -1;
    for (let index = startIndex; index < items.length; ++index) {
        if (items[index].status === ComponentStatus.Unbuilt) return index;
    }
    return -1;
}

/** BuiltObjectComponentList.FindNextBuiltComponent(startIndex) (130). */
export function findNextBuiltComponent(components: BuiltObjectComponentList, startIndex: number): number {
    const items = components.items;
    if (startIndex >= items.length) return -1;
    for (let index = startIndex; index < items.length; ++index) {
        if (items[index].status === ComponentStatus.Normal) return index;
    }
    return -1;
}

/** BuiltObjectComponentList.IndexByIdAndStatus(componentId, status) (234). */
export function indexByIdAndStatus(components: BuiltObjectComponentList, componentId: number, status: ComponentStatus): number {
    const items = components.items;
    for (let index = 0; index < items.length; ++index) {
        if (items[index].componentId === componentId && items[index].status === status) return index;
    }
    return -1;
}

// ---------------------------------------------------------------------------------------------------------------
// BuiltObject.cs 3877 CheckWhetherStillBeingBuilt
// ---------------------------------------------------------------------------------------------------------------

/** The ConstructionQueue members read through a `builtAt` StellarObject (BuiltObject or Habitat). */
interface QueueOnStellarObject {
    constructionYards: ConstructionYard[] | null;
    constructionWaitQueue: BuiltObject[] | null;
}

/** BuiltObject.cs 3877 CheckWhetherStillBeingBuilt. */
export function checkWhetherStillBeingBuilt(galaxy: Galaxy, builtObject: BuiltObject): void {
    void galaxy;
    const builtAt = builtObject.builtAt as { hasBeenDestroyed: boolean; constructionQueue: unknown } | null;
    if (builtAt === null || !builtAt.hasBeenDestroyed) {
        return;
    }
    const constructionQueue = builtAt.constructionQueue as QueueOnStellarObject | null;
    if (constructionQueue !== null) {
        const yards = constructionQueue.constructionYards!;
        for (let i = 0; i < yards.length; i++) {
            const constructionYard = yards[i];
            if (constructionYard.shipUnderConstruction !== null && constructionYard.shipUnderConstruction === builtObject) {
                constructionYard.shipUnderConstruction = null;
            }
        }
        const waitQueue = constructionQueue.constructionWaitQueue;
        if (waitQueue !== null && waitQueue.includes(builtObject)) {
            waitQueue.splice(waitQueue.indexOf(builtObject), 1);
        }
    }
    builtObject.builtAt = null;
}

// ---------------------------------------------------------------------------------------------------------------
// Queue creation (the ConstructionQueue class lives in constructionQueue.ts)
// ---------------------------------------------------------------------------------------------------------------

/** The ConstructionQueue members the creation hooks call. */
export interface ConstructionQueueHandle {
    redefineBuiltObject(builtObject: BuiltObject, forceSingleConstructionYard?: boolean): boolean;
    reviewConstructionSpeed(): void;
}
/** `new ConstructionQueue(habitat, galaxy)` / `new ConstructionQueue(builtObject, galaxy)` (ConstructionQueue.cs 71/79). */
export interface ConstructionQueueFactory {
    forHabitat(galaxy: Galaxy, habitat: Habitat): ConstructionQueueHandle;
    forBuiltObject(galaxy: Galaxy, builtObject: BuiltObject): ConstructionQueueHandle;
}
let queueFactory: ConstructionQueueFactory | null = null;
/** Called once by constructionQueue.ts at module load. */
export function registerConstructionQueueFactory(factory: ConstructionQueueFactory): void {
    queueFactory = factory;
}
function requireQueueFactory(): ConstructionQueueFactory {
    if (queueFactory === null) throw new Error('construction/constructionQueue.ts is not loaded (ConstructionQueue factory missing)');
    return queueFactory;
}

/** `habitat.ConstructionQueue = new ConstructionQueue(habitat, galaxy)` (Galaxy.5.cs 1617/1755, Galaxy.8.cs 275…561, Empire.1.cs 110). No Rnd. */
export function newHabitatConstructionQueue(galaxy: Galaxy, habitat: Habitat): ConstructionQueueHandle | null {
    // Galaxies generated without game data (unit tests) have no component definitions; the C# always has the statics.
    if (galaxy.researchStatic === null || galaxy.researchStatic.componentStatic === null) return null;
    const queue = requireQueueFactory().forHabitat(galaxy, habitat);
    habitat.constructionQueue = queue;
    return queue;
}

/** Empire.1.cs 108-115 (TakeOwnershipOfColony): create the colony queue, or re-review the speed of the existing one. */
export function takeOwnershipOfColonyConstructionQueue(galaxy: Galaxy, colony: Habitat): void {
    if (colony.constructionQueue === null) {
        newHabitatConstructionQueue(galaxy, colony);
    } else {
        (colony.constructionQueue as ConstructionQueueHandle).reviewConstructionSpeed();
    }
}

/**
 * BuiltObject.cs 3171-3184 (ReDefine): with a ConstructionBuild component (`flag7`) the ship gets / keeps a queue while
 * Redefine finds a built yard; otherwise an existing queue is re-defined and dropped when it has no yard left. No Rnd.
 */
export function builtObjectReDefineConstructionQueue(builtObject: BuiltObject, flag7: boolean): void {
    if (flag7) {
        if (builtObject.constructionQueue === null) {
            builtObject.constructionQueue = requireQueueFactory().forBuiltObject(builtObject._galaxy, builtObject);
        }
        if (!(builtObject.constructionQueue as ConstructionQueueHandle).redefineBuiltObject(builtObject)) {
            builtObject.constructionQueue = null;
        }
    } else if (builtObject.constructionQueue !== null && !(builtObject.constructionQueue as ConstructionQueueHandle).redefineBuiltObject(builtObject)) {
        builtObject.constructionQueue = null;
    }
}
