// Run a UI query against the galaxy as if it were a read-only replica (sim/readOnlyQuery.ts). A few lookups the
// screens make create what they look up (ObtainDiplomaticRelation / ObtainPirateRelation add a NotMet relation, some
// money reads age the income they read); on the sim-worker replica they already answer without writing. In the
// in-thread game the same screens would write the authoritative galaxy, so a panel that must stay render-only (the
// Empire Comparison / Victory panel, parity batch D1) runs its queries inside this scope: same answers, no writes.
// Synchronous only: the mark is lifted before any sim step can run.

import type { Galaxy } from '../sim/galaxy';
import { isReadOnlyGalaxy, markReadOnlyGalaxy } from '../sim/readOnlyQuery';

export function withReadOnlyGalaxy<T>(galaxy: Galaxy, fn: () => T): T {
    if (isReadOnlyGalaxy(galaxy)) return fn();
    markReadOnlyGalaxy(galaxy, true);
    try {
        return fn();
    } finally {
        markReadOnlyGalaxy(galaxy, false);
    }
}
