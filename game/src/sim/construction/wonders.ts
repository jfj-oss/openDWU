// M4i — wonders.
//
// Stubs created by M4a (tasks/M4-plan.md §3.1): the tick skeletons in src/sim/tick/ call these entry points in C#
// order. Each is a no-op that does NOT draw Galaxy.Rnd (a `RND:` note marks C# draw sites that are skipped until the
// owning package ports the body) and records a TODO hit (tick/todo.ts). The owning package replaces the bodies in
// place, keeping the signatures (or adjusting the skeleton call in the same change).

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import { registerTodo, todo } from '../tick/todo';

const T_reviewColonyWonders = registerTodo('M4i', 'reviewColonyWonders');
/** Empire.3.cs 114 ReviewColonyWonders. */
export function reviewColonyWonders(galaxy: Galaxy, empire: Empire): void {
    /* TODO(port) M4i */ todo(T_reviewColonyWonders);
}

const T_reviewWondersBuilt = registerTodo('M4i', 'reviewWondersBuilt');
/** Galaxy.5.cs 334 ReviewWondersBuilt. */
export function reviewWondersBuilt(galaxy: Galaxy): void {
    /* TODO(port) M4i */ todo(T_reviewWondersBuilt);
}

const T_checkWonderBuilt = registerTodo('M4i', 'checkWonderBuilt');
/**
 * Galaxy.5.cs 322 CheckWonderBuilt(wonder): _WondersBuilt[wonder.PlanetaryFacilityDefinitionId] (filled by
 * ReviewWondersBuilt). Stub added by M4k (ResolveEssentialProjects_NEW): no wonder is built until M4i ports
 * facilities/wonders, which is the value the C# reads while no empire owns a completed wonder.
 */
export function checkWonderBuilt(galaxy: Galaxy, wonder: { facilityId: number } | null): boolean {
    void galaxy;
    if (wonder !== null) {
        /* TODO(port) M4i: _WondersBuilt lookup */ todo(T_checkWonderBuilt);
    }
    return false;
}
