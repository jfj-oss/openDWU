// The Beacon, part 7: its construction waits for the galaxy's technology (Giantworks wonder, flag gwBeacon). Not a port.
//   The Great Work builds at full speed only up to a stage cap that grows with the tech of the leading empires: T is the mean of the highest
//   researched tech level of the top half (rounded up) of the ordinary empires; T below 2 allows 20% of the work, 2 40%, 3 60%, 4 80%, 5 and
//   more 100% (beaconTechCap1..5). Past the cap it still builds, at beaconTechSlowPct of its speed, until the galaxy catches up.
// Rnd: none.

import type { Galaxy } from '../../../galaxy';
import { empireTechLevel } from '../robotMutiny';
import { ordinaryEmpires } from './state';
import { P } from './beaconState';

/** The mean of the highest researched tech levels of the top half of the ordinary empires (the count rounded up; 1 with no empire). Pure. */
export function topHalfTech(galaxy: Galaxy): number {
    const levels = ordinaryEmpires(galaxy).map(empireTechLevel).sort((a, b) => b - a);
    if (levels.length === 0) return 1;
    const n = Math.ceil(levels.length / 2);
    let sum = 0;
    for (let i = 0; i < n; i++) sum += levels[i];
    return sum / n;
}

/** The share of the work (0..1) the Beacon builds at full speed at galaxy tech `t` (steps on floor(t)). Pure. */
export function techCapFor(galaxy: Galaxy, t: number): number {
    const caps = P.techCaps(galaxy);
    const i = Math.max(1, Math.min(5, Math.floor(t)));
    return Math.max(0, Math.min(1, caps[i - 1] / 100));
}

/** The share of the work built at full speed now. Pure. */
export function beaconTechCap(galaxy: Galaxy): number {
    return techCapFor(galaxy, topHalfTech(galaxy));
}

/** The work, at `progress`, is held back by the galaxy's technology. Pure. */
export function beaconTechSlowed(galaxy: Galaxy, progress: number): boolean {
    const cap = beaconTechCap(galaxy);
    return cap < 1 && progress >= cap;
}
