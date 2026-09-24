// M4b — ExecuteCommands loop + CommandAction dispatch table (BuiltObject.2.cs 399-4579).
//
// Stubs created by M4a (tasks/M4-plan.md §3.1): the tick skeletons in src/sim/tick/ call these entry points in C#
// order. Each is a no-op that does NOT draw Galaxy.Rnd (a `RND:` note marks C# draw sites that are skipped until the
// owning package ports the body) and records a TODO hit (tick/todo.ts). The owning package replaces the bodies in
// place, keeping the signatures (or adjusting the skeleton call in the same change).

import type { Galaxy } from '../galaxy';
import type { BuiltObject } from '../builtObject';
import { registerTodo, todo } from '../tick/todo';

const T_executeCommands = registerTodo('M4b', 'executeCommands');
/** BuiltObject.2.cs 399 ExecuteCommands(galaxy, timeRemaining, time, starDate) → remaining seconds; the stub consumes all time (returns 0.0) so the DoTasks loop ends. */
export function executeCommands(galaxy: Galaxy, builtObject: BuiltObject, timeRemaining: number, time: number, starDate: number): number {
    // RND: ExecuteCommands (16 direct sites + draws in callees (d≤3), +clock×7) — not drawn until M4b.
    /* TODO(port) M4b */ todo(T_executeCommands);
    return 0;
}
