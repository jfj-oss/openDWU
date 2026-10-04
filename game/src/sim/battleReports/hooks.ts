// Battle reports (an Improvement inspired by Distant Worlds 2; NOT in DW:U): the switch and the two teardown hooks the
// port's combat code calls. Kept import-free (types only) so combat/teardown.ts and creature.ts can call it without
// joining the battle-report module's import graph. The observer (battleReports.ts) installs the hooks at module load.
//
// The observer only reads the sim and writes its own side-table state (save/galaxySave.ts `battleReports`): it changes
// no rule, draws no Rnd and touches nothing the state digest hashes.

import type { Galaxy } from '../galaxy';
import type { BuiltObject } from '../builtObject';
import type { Creature } from '../creature';

let enabled = true;

/** The mod-layer switch: on by default. Off, the observer records nothing (the game itself is the same either way). */
export function battleReportsEnabled(): boolean {
    return enabled;
}

/** Turn the observer on / off (tests, `?battleReports=0`; the worker gets the main thread's value in its init message). */
export function setBattleReportsEnabled(on: boolean): void {
    enabled = on;
}

export interface BattleReportHooks {
    /** combat/teardown.ts builtObjectCompleteTeardown, first line (before anything is detached). */
    builtObjectTeardown: ((galaxy: Galaxy, builtObject: BuiltObject) => void) | null;
    /** creature.ts Creature.completeTeardown, first line. */
    creatureTeardown: ((galaxy: Galaxy, creature: Creature) => void) | null;
}

export const battleReportHooks: BattleReportHooks = { builtObjectTeardown: null, creatureTeardown: null };
