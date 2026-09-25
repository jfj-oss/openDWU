// M4e — habitat docking-bay / wait-queue creation (the block the C# repeats at every habitat site).
//
// Split out of docking.ts because empire.ts / galaxy.ts / startHabitats.ts call it: this module only imports
// builtObject.ts (DockingBay) and types.ts, so it does not pull the mission / diplomacy modules into their import
// cycles. Sites: Galaxy.8.cs 277-285 (and 316/355/485/524/563, the Generate*Planet helpers), Galaxy.5.cs 1619-1644 /
// 1757-1781 (SetupSolarSystem, populated planets / moons), Empire.1.cs 120-131 (TakeOwnershipOfColony). No Rnd.

import { DockingBay } from '../builtObject';
import { HabitatCategoryType, HabitatType, type Habitat } from '../types';

/** Component 74 (Docking Bay) — the BuiltObjectComponent the C# news up for each habitat bay (its BuiltObjectComponentId keeps the field default -1, BuiltObjectComponent.cs 17). */
const HABITAT_DOCKING_BAY_COMPONENT_ID = 74;
/** BuiltObjectComponent.BuiltObjectComponentId field default (BuiltObjectComponent.cs 17: `short BuiltObjectComponentId = -1`). */
const HABITAT_DOCKING_BAY_COMPONENT_BO_ID = -1;

/**
 * The block repeated at the C# habitat sites (e.g. Galaxy.8.cs 277-285):
 * `DockingBays = new DockingBayList(); for (i < count) { var c = new BuiltObjectComponent(74, Normal);
 * DockingBays.Add(new DockingBay(c.ComponentID, c.BuiltObjectComponentId, 100)); } DockingBayWaitQueue = new BuiltObjectList();`
 * No Rnd, no id counters (the component's BuiltObjectComponentId is left at its default -1, BuiltObjectComponent.cs 17).
 */
export function createHabitatDockingBays(habitat: Habitat, count: number): void {
    habitat.dockingBays = [];
    for (let i = 0; i < count; i++) {
        habitat.dockingBays.push(new DockingBay(HABITAT_DOCKING_BAY_COMPONENT_ID, HABITAT_DOCKING_BAY_COMPONENT_BO_ID, 100));
    }
    habitat.dockingBayWaitQueue = [];
}

/** Galaxy.5.cs 1619-1644 (planets) / 1757-1781 (moons): the populated-habitat bay count switch, then the bays and queue. */
export function createPopulatedHabitatDockingBays(habitat: Habitat): void {
    let num8 = 1;
    switch (habitat.type) {
        case HabitatType.Volcanic:
        case HabitatType.Desert:
        case HabitatType.MarshySwamp:
        case HabitatType.Continental:
        case HabitatType.Ocean:
        case HabitatType.BarrenRock:
        case HabitatType.Ice:
        case HabitatType.Metal:
            num8 = habitat.category === HabitatCategoryType.Asteroid || habitat.type === HabitatType.BarrenRock ? 1 : 20;
            break;
        default:
            num8 = 1;
            break;
    }
    createHabitatDockingBays(habitat, num8);
}

/** Empire.1.cs 120-131 (TakeOwnershipOfColony): 20 bays if the colony has none; a wait queue if it has none. */
export function takeOwnershipOfColonyDockingBays(colony: Habitat): void {
    if (colony.dockingBays === null) {
        colony.dockingBays = [];
        const num = 20;
        for (let i = 0; i < num; i++) {
            colony.dockingBays.push(new DockingBay(HABITAT_DOCKING_BAY_COMPONENT_ID, HABITAT_DOCKING_BAY_COMPONENT_BO_ID, 100));
        }
    }
    if (colony.dockingBayWaitQueue === null) {
        colony.dockingBayWaitQueue = [];
    }
}
