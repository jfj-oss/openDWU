// Sim worker (docs/sim-worker.md §9 chunk 8): the local-model briefs are built on the main thread from the replica,
// which must stay read-only (a replica write never reaches the worker and is not overwritten until the worker's own
// value changes). One read the briefs make is not write-free: calculateAnnualCashflow → treasury.ts
// thisYearsSpacePortIncome is a faithful port of Empire.cs ThisYearsSpacePortIncome, which ages the variable income
// when it is read in a new galactic year (outside averaged mode): BuiltObject.currentYearsIncome = 0 and
// consecutiveUnprofitableYears++ for the empire's space ports and mining stations. buildStrategicBrief (18c) and
// digestFor (the 19s chronicle / strategic / voice / grounding digests) read it.
//
// readReplica runs a brief builder on a replica and puts those fields back afterwards, so the brief is exactly what the
// same read gives in-thread and the replica keeps the worker's values. In-thread (not a replica) it just runs the
// builder: the behaviour there is unchanged, side effect included.
// TODO(port): a write-free cashflow read for the briefs (strategicBrief.ts / scenario/llm/digest.ts, outside chunk 8)
// would make this guard unnecessary; in-thread the brief's aging is an unjournaled sim write a replay does not repeat.
// No DOM / Pixi imports.

import type { Galaxy } from '../sim/galaxy';
import type { BuiltObject } from '../sim/builtObject';
import { flatEmpireList } from '../sim/save/galaxySave';
import { remoteSimHost } from '../simworker/remoteHost';

/** Run `build` (a read of `galaxy`) without leaving the variable-income aging on a replica. */
export function readReplica<T>(galaxy: Galaxy, build: () => T): T {
    if (remoteSimHost(galaxy) === null) return build();
    const saved: [BuiltObject, number, number][] = [];
    for (const e of flatEmpireList(galaxy)) {
        if (e == null) continue;
        for (const list of [e.spacePorts, e.miningStations]) {
            if (list == null) continue;
            for (const b of list) if (b != null) saved.push([b, b.currentYearsIncome, b.consecutiveUnprofitableYears]);
        }
    }
    try {
        return build();
    } finally {
        for (const [b, income, years] of saved) {
            if (!Object.is(b.currentYearsIncome, income)) b.currentYearsIncome = income;
            if (!Object.is(b.consecutiveUnprofitableYears, years)) b.consecutiveUnprofitableYears = years;
        }
    }
}
