// The galaxy-reset seam (ours): a scenario asks for the running galaxy to be replaced by a freshly built one (the Harvest Cycle's Long
// Night, scenario/threats/giantworks/longNight.ts). The sim cannot swap its own galaxy in the middle of a tick, so it only records the
// request; whoever drives the game (the sim worker's loop, a test harness) sees it between ticks, builds the new game (longNightReset.ts
// buildAge2Game) and swaps it in as a loaded save replaces a game (worker.ts replaceGame). A galaxy whose driver cannot swap says so by
// never calling setGalaxyResetSupported: the request is then refused and the scenario falls back to what it did before (the game ends).
// No DOM, no imports beyond the type.

import type { Galaxy } from './galaxy';

const supported = new WeakSet<Galaxy>();
const pending = new WeakSet<Galaxy>();

/** The driver of `galaxy` can replace it between ticks. */
export function setGalaxyResetSupported(galaxy: Galaxy, on: boolean): void {
    if (on) supported.add(galaxy);
    else supported.delete(galaxy);
}

export function galaxyResetSupported(galaxy: Galaxy): boolean {
    return supported.has(galaxy);
}

/** Ask for the galaxy to be replaced at the next boundary. False (nothing recorded) when the driver cannot. */
export function requestGalaxyReset(galaxy: Galaxy): boolean {
    if (!supported.has(galaxy)) return false;
    pending.add(galaxy);
    return true;
}

export function galaxyResetPending(galaxy: Galaxy): boolean {
    return pending.has(galaxy);
}

/** The driver gave up (the new game could not be built): the request is dropped. */
export function clearGalaxyReset(galaxy: Galaxy): void {
    pending.delete(galaxy);
}
