// M4g — resource extraction, industrial processing, manufacturing queues, empire resource needs.
//
// Stubs created by M4a (tasks/M4-plan.md §3.1): the tick skeletons in src/sim/tick/ call these entry points in C#
// order. Each is a no-op that does NOT draw Galaxy.Rnd (a `RND:` note marks C# draw sites that are skipped until the
// owning package ports the body) and records a TODO hit (tick/todo.ts). The owning package replaces the bodies in
// place, keeping the signatures (or adjusting the skeleton call in the same change).

import type { Galaxy } from './galaxy';
import type { Empire } from './empire';
import type { BuiltObject } from './builtObject';
import type { Habitat } from './types';
import { registerTodo, todo } from './tick/todo';

const T_prioritizeEmpireResourceNeeds = registerTodo('M4g', 'prioritizeEmpireResourceNeeds');
/** Empire.2.cs 4023/4028 PrioritizeEmpireResourceNeeds([includeLuxuryResources, topResourceCount, minimumValue]); the stub returns the current list unchanged. */
export function prioritizeEmpireResourceNeeds(galaxy: Galaxy, empire: Empire, includeLuxuryResources = false, topResourceCount = 5, minimumValue = 1.0): Empire['empireResourceTargets'] {
    /* TODO(port) M4g */ todo(T_prioritizeEmpireResourceNeeds);
    return empire.empireResourceTargets;
}

const T_industrialProcessing = registerTodo('M4g', 'industrialProcessing');
/** BuiltObject.2.cs 7805 IndustrialProcessing(timePassed, galaxy, time). */
export function industrialProcessing(galaxy: Galaxy, builtObject: BuiltObject, timePassed: number, time: number): void {
    // RND: draws in callees (d≤3) — not drawn until M4g.
    /* TODO(port) M4g */ todo(T_industrialProcessing);
}

const T_extractResources = registerTodo('M4g', 'extractResources');
/** Habitat.cs 2827 ExtractResources(timePassed). */
export function extractResources(galaxy: Galaxy, habitat: Habitat, timePassed: number): void {
    /* TODO(port) M4g */ todo(T_extractResources);
}

const T_doManufacturing = registerTodo('M4g', 'doManufacturing');
/** ManufacturingQueue.cs 305 DoManufacturing(galaxy, time, starDate). */
export function doManufacturing(galaxy: Galaxy, habitat: Habitat, time: number, starDate: number): void {
    // RND: draws in callees (d≤3) — not drawn until M4g.
    /* TODO(port) M4g */ todo(T_doManufacturing);
}

const T_reviewManufacturedResources = registerTodo('M4g', 'reviewManufacturedResources');
/** Habitat.cs 1899 ReviewManufacturedResources. */
export function reviewManufacturedResources(galaxy: Galaxy, habitat: Habitat): void {
    // RND: 3 direct — not drawn until M4g.
    /* TODO(port) M4g */ todo(T_reviewManufacturedResources);
}
