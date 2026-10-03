// The local-model briefs (docs/sim-worker.md §8, §9 chunk 8) are built on the main thread, from the in-thread game or a
// sim-worker replica, between frames. They are not the C# UI (a port-only read), so they must not change the game: a
// write there is not in the command log (an in-thread replay drifts) and never reaches the worker (the replica drifts).
// One read they make is not write-free as the C# getter: calculateAnnualCashflow → treasury.ts thisYearsSpacePortIncome
// ports Empire.cs ThisYearsSpacePortIncome, which ages the variable income when it is read in a new galactic year
// (outside averaged mode: BuiltObject.currentYearsIncome = 0 and consecutiveUnprofitableYears++ for the empire's space
// ports and mining stations, on every such read); the record lookups (Obtain*) add what they look up.
// buildStrategicBrief (18c) and digestFor (the 19s chronicle / strategic / voice / grounding digests) read them.
//
// readReplica runs a brief builder inside sim/readOnlyQuery.ts withPureSimReads: the lookups answer with the value they
// would give (the aged figure, a detached record) and write nothing, and ask for no record — in both modes, so the
// brief is the same and the game is untouched.
// No DOM / Pixi imports.

import type { Galaxy } from '../sim/galaxy';
import { withPureSimReads } from '../sim/readOnlyQuery';

/** Run `build` (a port-only read of `galaxy`: a brief, a digest) without any side effect on the game. */
export function readReplica<T>(galaxy: Galaxy, build: () => T): T {
    void galaxy;
    return withPureSimReads(build);
}
