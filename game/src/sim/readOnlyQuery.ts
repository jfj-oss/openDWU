// Read-only query scope (docs/sim-worker.md §9 chunk 6). A few C# "Obtain*" lookups create the record they look up
// when it is missing (Empire.4.cs 137 ObtainDiplomaticRelation adds a NotMet relation, Empire.8.cs 2351
// ObtainPirateRelation adds a NotMet pirate relation). The sim keeps that behaviour. A screen that runs the same AI
// queries (the Expansion Planner: territory and danger checks) must not write the game — in worker mode it is a
// read-only replica, and in-thread such a write would bypass the command log — so it runs them inside
// `readOnlyQuery`, where those lookups answer with a detached record (same type and fields as the one they would
// add) instead of adding it. The sim itself never opens a scope, so its results and RNG sequence are unchanged.
// A sim-worker replica galaxy (simworker/clientCore.ts markReadOnlyGalaxy) is read-only for good: whatever main-thread
// code queries it, these lookups never write it.
//
// No DOM / Pixi imports.

import type { Galaxy } from './galaxy';

let depth = 0;
const readOnlyGalaxies = new WeakSet<object>();

/** True inside readOnlyQuery, or for a read-only (replica) galaxy: the lazy lookups must not add what they lack. */
export function inReadOnlyQuery(galaxy: Galaxy | null = null): boolean {
    return depth > 0 || (galaxy !== null && readOnlyGalaxies.has(galaxy));
}

/** Mark a galaxy as read-only for good (a sim-worker replica: the worker owns its state); false unmarks it. */
export function markReadOnlyGalaxy(galaxy: Galaxy, readOnly = true): void {
    if (readOnly) readOnlyGalaxies.add(galaxy);
    else readOnlyGalaxies.delete(galaxy);
}

/** Run `fn` (UI-side queries over sim state) with the lazy-creating lookups detached. */
export function readOnlyQuery<T>(fn: () => T): T {
    depth++;
    try {
        return fn();
    } finally {
        depth--;
    }
}
