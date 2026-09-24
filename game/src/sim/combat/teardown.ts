// M4o — teardown and invalid-ship cleanup.
//
// Stubs created by M4a (tasks/M4-plan.md §3.1): the tick skeletons in src/sim/tick/ call these entry points in C#
// order. Each is a no-op that does NOT draw Galaxy.Rnd (a `RND:` note marks C# draw sites that are skipped until the
// owning package ports the body) and records a TODO hit (tick/todo.ts). The owning package replaces the bodies in
// place, keeping the signatures (or adjusting the skeleton call in the same change).

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import type { BuiltObject } from '../builtObject';
import { registerTodo, todo } from '../tick/todo';

const T_cleanupInvalidShips = registerTodo('M4o', 'cleanupInvalidShips');
/** Empire.8.cs 2896 CleanupInvalidShips. */
export function cleanupInvalidShips(galaxy: Galaxy, empire: Empire): void {
    // RND: +clock×3 — not drawn until M4o.
    /* TODO(port) M4o */ todo(T_cleanupInvalidShips);
}

// ---- stubs added by M4h (called from construction/constructionQueue.ts) ----

const T_builtObjectCompleteTeardown = registerTodo('M4o', 'builtObjectCompleteTeardown');
/** BuiltObject.2.cs 5166/5171 CompleteTeardown(galaxy[, removeFromEmpire]) — stub (a scrapped ship stays in the galaxy). */
export function builtObjectCompleteTeardown(galaxy: Galaxy, builtObject: BuiltObject, removeFromEmpire = false): void {
    /* TODO(port) M4o */ todo(T_builtObjectCompleteTeardown);
}
