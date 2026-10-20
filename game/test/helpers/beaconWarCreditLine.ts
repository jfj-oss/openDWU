import type { Galaxy } from '../../src/sim/galaxy';
import { dietWarCreditLine } from '../../src/sim/scenario/charactersVictory/diet/dietState';

/** The Diet window's war-credit line (the hook beaconWarCredit.ts registers). */
export function dietLineForTest(g: Galaxy): string {
    return dietWarCreditLine.fn?.(g) ?? '';
}
