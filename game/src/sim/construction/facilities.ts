// M4i — planetary facilities.
//
// Stubs created by M4a (tasks/M4-plan.md §3.1): the tick skeletons in src/sim/tick/ call these entry points in C#
// order. Each is a no-op that does NOT draw Galaxy.Rnd (a `RND:` note marks C# draw sites that are skipped until the
// owning package ports the body) and records a TODO hit (tick/todo.ts). The owning package replaces the bodies in
// place, keeping the signatures (or adjusting the skeleton call in the same change).

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import type { Habitat } from '../types';
import { registerTodo, todo } from '../tick/todo';

const T_reviewColonyFacilities = registerTodo('M4i', 'reviewColonyFacilities');
/** Empire.3.cs 395 ReviewColonyFacilities. */
export function reviewColonyFacilities(galaxy: Galaxy, empire: Empire): void {
    // RND: 1 direct — not drawn until M4i.
    /* TODO(port) M4i */ todo(T_reviewColonyFacilities);
}

const T_refreshColonyFacilityInfo = registerTodo('M4i', 'refreshColonyFacilityInfo');
/** Empire.3.cs 104 RefreshColonyFacilityInfo. */
export function refreshColonyFacilityInfo(galaxy: Galaxy, empire: Empire): void {
    /* TODO(port) M4i */ todo(T_refreshColonyFacilityInfo);
}

const T_pirateReviewColonyFacilities = registerTodo('M4i', 'pirateReviewColonyFacilities');
/** Empire.3.cs 254 PirateReviewColonyFacilities. */
export function pirateReviewColonyFacilities(galaxy: Galaxy, empire: Empire): void {
    /* TODO(port) M4i */ todo(T_pirateReviewColonyFacilities);
}

const T_constructFacilities = registerTodo('M4i', 'constructFacilities');
/** Habitat.cs 2039 ConstructFacilities(timePassed). */
export function constructFacilities(galaxy: Galaxy, habitat: Habitat, timePassed: number): void {
    // RND: 1 direct — not drawn until M4i.
    /* TODO(port) M4i */ todo(T_constructFacilities);
}
