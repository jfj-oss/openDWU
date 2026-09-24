// M4h — retrofit queues.
//
// Stubs created by M4a (tasks/M4-plan.md §3.1): the tick skeletons in src/sim/tick/ call these entry points in C#
// order. Each is a no-op that does NOT draw Galaxy.Rnd (a `RND:` note marks C# draw sites that are skipped until the
// owning package ports the body) and records a TODO hit (tick/todo.ts). The owning package replaces the bodies in
// place, keeping the signatures (or adjusting the skeleton call in the same change).

import type { Galaxy } from '../galaxy';
import type { BuiltObject } from '../builtObject';
import { registerTodo, todo } from '../tick/todo';

const T_reviewRetrofitConstructionQueue = registerTodo('M4h', 'reviewRetrofitConstructionQueue');
/** BuiltObject.2.cs 6023 ReviewRetrofitConstructionQueue(time, starDate). */
export function reviewRetrofitConstructionQueue(galaxy: Galaxy, builtObject: BuiltObject, time: number, starDate: number): void {
    // RND: draws in callees (d≤3) — not drawn until M4h.
    /* TODO(port) M4h */ todo(T_reviewRetrofitConstructionQueue);
}
