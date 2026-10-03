// Read-only galaxies (docs/sim-worker.md §9 chunk 6). A few C# lookups create the record they look up when it is
// missing: Empire.4.cs 137 ObtainDiplomaticRelation adds a NotMet relation, Empire.8.cs 2351 ObtainPirateRelation
// adds a NotMet pirate relation, Empire.4.cs 106 ObtainEmpireEvaluation adds an evaluation, Galaxy._WondersBuilt is
// created on first use, and a scenario package's state bag is created on first read. Some money reads also age the
// income they read (ThisYearsSpacePortIncome, ThisYearsResortIncome, the NaN tax-revenue recalculation). The sim and
// the in-thread UI keep all of that. A sim-worker replica galaxy, though, is read-only: the worker owns its state, and a
// write there would be lost or would make the replica drift. So the main-thread screens query it, and these lookups
// answer with the same value they would give (a detached record, the aged figure) without writing it.
// simworker/clientCore.ts marks the replica. Nothing else is ever marked, so the sim's results and its RNG sequence are
// unchanged.
//
// No DOM / Pixi imports.

import type { Galaxy } from './galaxy';

const readOnlyGalaxies = new WeakSet<object>();

/** True for a read-only (sim-worker replica) galaxy: the lazy lookups must not add what they lack. */
export function isReadOnlyGalaxy(galaxy: Galaxy | null): boolean {
    return galaxy !== null && readOnlyGalaxies.has(galaxy);
}

/** Mark a galaxy as read-only (a sim-worker replica, whose state the worker owns); false unmarks it. */
export function markReadOnlyGalaxy(galaxy: Galaxy, readOnly = true): void {
    if (readOnly) readOnlyGalaxies.add(galaxy);
    else readOnlyGalaxies.delete(galaxy);
}
