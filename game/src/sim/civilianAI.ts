// M4f — civilian mission AI (AssignMissionToBuiltObject), exploration/migration/tourism, private construction, colonisation targets.
//
// Stubs created by M4a (tasks/M4-plan.md §3.1): the tick skeletons in src/sim/tick/ call these entry points in C#
// order. Each is a no-op that does NOT draw Galaxy.Rnd (a `RND:` note marks C# draw sites that are skipped until the
// owning package ports the body) and records a TODO hit (tick/todo.ts). The owning package replaces the bodies in
// place, keeping the signatures (or adjusting the skeleton call in the same change).

import type { Galaxy } from './galaxy';
import type { Empire } from './empire';
import { registerTodo, todo } from './tick/todo';

const T_assignShipMissions = registerTodo('M4f', 'assignShipMissions');
/** Empire.4.cs 4796 AssignShipMissions. */
export function assignShipMissions(galaxy: Galaxy, empire: Empire): void {
    // RND: draws in callees (d≤3) — not drawn until M4f.
    /* TODO(port) M4f */ todo(T_assignShipMissions);
}

const T_reviewMigrationTourism = registerTodo('M4f', 'reviewMigrationTourism');
/** Empire.5.cs 3128 ReviewMigrationTourism. */
export function reviewMigrationTourism(galaxy: Galaxy, empire: Empire): void {
    /* TODO(port) M4f */ todo(T_reviewMigrationTourism);
}

const T_directPrivateConstruction = registerTodo('M4f', 'directPrivateConstruction');
/** Empire.6.cs 741 DirectPrivateConstruction. */
export function directPrivateConstruction(galaxy: Galaxy, empire: Empire): void {
    // RND: draws in callees (d≤3) — not drawn until M4f.
    /* TODO(port) M4f */ todo(T_directPrivateConstruction);
}

const T_identifyColonizationTargets = registerTodo('M4f', 'identifyColonizationTargets');
/** Empire.4.cs 4652 IdentifyColonizationTargets(galaxy) → HabitatPrioritizationList; the stub returns the current list unchanged. */
export function identifyColonizationTargets(galaxy: Galaxy, empire: Empire): Empire['colonizationTargets'] {
    /* TODO(port) M4f */ todo(T_identifyColonizationTargets);
    return empire.colonizationTargets;
}

const T_reviewIndependentColonyTargets = registerTodo('M4f', 'reviewIndependentColonyTargets');
/** Empire.5.cs 1298 ReviewIndependentColonyTargets. */
export function reviewIndependentColonyTargets(galaxy: Galaxy, empire: Empire): void {
    /* TODO(port) M4f */ todo(T_reviewIndependentColonyTargets);
}
