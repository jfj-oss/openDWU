// M4k — research progress.
//
// Stubs created by M4a (tasks/M4-plan.md §3.1): the tick skeletons in src/sim/tick/ call these entry points in C#
// order. Each is a no-op that does NOT draw Galaxy.Rnd (a `RND:` note marks C# draw sites that are skipped until the
// owning package ports the body) and records a TODO hit (tick/todo.ts). The owning package replaces the bodies in
// place, keeping the signatures (or adjusting the skeleton call in the same change).

import type { Galaxy } from './galaxy';
import type { Empire } from './empire';
import { registerTodo, todo } from './tick/todo';

const T_performResearch = registerTodo('M4k', 'performResearch');
/** Empire.3.cs 1756 PerformResearch(timePassed, allowResearchEvents). */
export function performResearch(galaxy: Galaxy, empire: Empire, timePassed: number, allowResearchEvents: boolean): void {
    // RND: draws in callees (d≤3) — not drawn until M4k.
    /* TODO(port) M4k */ todo(T_performResearch);
}

const T_reviewResearchStationBonuses = registerTodo('M4k', 'reviewResearchStationBonuses');
/** Empire.3.cs 2732 ReviewResearchStationBonuses. */
export function reviewResearchStationBonuses(galaxy: Galaxy, empire: Empire): void {
    /* TODO(port) M4k */ todo(T_reviewResearchStationBonuses);
}

const T_doCrashResearch = registerTodo('M4k', 'doCrashResearch');
/** Empire.3.cs 3093 DoCrashResearch. */
export function doCrashResearch(galaxy: Galaxy, empire: Empire): void {
    // RND: 3 direct — not drawn until M4k.
    /* TODO(port) M4k */ todo(T_doCrashResearch);
}
