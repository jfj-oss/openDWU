// M4r — trade offers between empires.
//
// Stubs created by M4a (tasks/M4-plan.md §3.1): the tick skeletons in src/sim/tick/ call these entry points in C#
// order. Each is a no-op that does NOT draw Galaxy.Rnd (a `RND:` note marks C# draw sites that are skipped until the
// owning package ports the body) and records a TODO hit (tick/todo.ts). The owning package replaces the bodies in
// place, keeping the signatures (or adjusting the skeleton call in the same change).

import type { Galaxy } from './galaxy';
import type { Empire } from './empire';
import { registerTodo, todo } from './tick/todo';

const T_tradeItems = registerTodo('M4r', 'tradeItems');
/** Empire.7.cs 2576 TradeItems. */
export function tradeItems(galaxy: Galaxy, empire: Empire): void {
    // RND: 1 direct — not drawn until M4r.
    /* TODO(port) M4r */ todo(T_tradeItems);
}
