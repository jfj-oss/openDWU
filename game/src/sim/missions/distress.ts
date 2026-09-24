// M4b — distress signals and declined tasks (Empire.3.cs 4898-5020, Empire.2.cs 3985-4002, Empire.8.cs 4357).
//
// Stubs created by M4a (tasks/M4-plan.md §3.1): the tick skeletons in src/sim/tick/ call these entry points in C#
// order. Each is a no-op that does NOT draw Galaxy.Rnd (a `RND:` note marks C# draw sites that are skipped until the
// owning package ports the body) and records a TODO hit (tick/todo.ts). The owning package replaces the bodies in
// place, keeping the signatures (or adjusting the skeleton call in the same change).

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import { registerTodo, todo } from '../tick/todo';

const T_processDistressSignals = registerTodo('M4b', 'processDistressSignals');
/** Empire.3.cs 4915 ProcessDistressSignals. */
export function processDistressSignals(galaxy: Galaxy, empire: Empire): void {
    // RND: draws in callees (d≤3) — not drawn until M4b.
    /* TODO(port) M4b */ todo(T_processDistressSignals);
}

const T_clearOutOldDistressSignals = registerTodo('M4b', 'clearOutOldDistressSignals');
/** Empire.3.cs 4898 ClearOutOldDistressSignals. */
export function clearOutOldDistressSignals(galaxy: Galaxy, empire: Empire): void {
    /* TODO(port) M4b */ todo(T_clearOutOldDistressSignals);
}

const T_clearOldDistressSignals = registerTodo('M4b', 'clearOldDistressSignals');
/** Empire.2.cs 3985 ClearOldDistressSignals. */
export function clearOldDistressSignals(galaxy: Galaxy, empire: Empire): void {
    /* TODO(port) M4b */ todo(T_clearOldDistressSignals);
}

const T_clearExpiredDeclinedTasks = registerTodo('M4b', 'clearExpiredDeclinedTasks');
/** Empire.8.cs 4357 ClearExpiredDeclinedTasks. */
export function clearExpiredDeclinedTasks(galaxy: Galaxy, empire: Empire): void {
    /* TODO(port) M4b */ todo(T_clearExpiredDeclinedTasks);
}
