// The local viewer: the empire the person at THIS screen plays (multiplayer Phase 1, docs/MULTIPLAYER.md). Main thread
// only — UI, render, fog, audio. Sim code never reads it: every client runs the same sim, and what differs between
// them is only who is looking. Sim rules about humans use isHumanEmpire (sim/humanEmpires.ts) instead.
//
// Until a viewer is set (every game today) it is galaxy.playerEmpire, the primary human. Kept per galaxy, so a loaded
// game or a sim-worker replica galaxy starts from its own primary human.

import type { Empire } from './sim/empire';
import type { Galaxy } from './sim/galaxy';

const viewers = new WeakMap<Galaxy, Empire | null>();

/** The empire this screen shows the game for (null: none, e.g. a galaxy without a player). */
export function localViewerEmpire(galaxy: Galaxy | null | undefined): Empire | null {
    if (galaxy == null) return null;
    const v = viewers.get(galaxy);
    return v !== undefined ? v : (galaxy.playerEmpire ?? null);
}

/** Show `galaxy` for `empire` (hot-seat / multiplayer); undefined goes back to the default (galaxy.playerEmpire). */
export function setLocalViewerEmpire(galaxy: Galaxy, empire: Empire | null | undefined): void {
    if (empire === undefined) viewers.delete(galaxy);
    else viewers.set(galaxy, empire);
}

// Multiplayer Phase 2 (hot seat): screens that cache what they show for the viewer re-render when it changes.
const viewerListeners = new Set<(galaxy: Galaxy, empire: Empire | null) => void>();

/** Call `fn` after every setLocalViewerEmpire (any galaxy). Returns the unsubscribe. */
export function onLocalViewerChange(fn: (galaxy: Galaxy, empire: Empire | null) => void): () => void {
    viewerListeners.add(fn);
    return () => viewerListeners.delete(fn);
}

/** setLocalViewerEmpire, then tell the onLocalViewerChange listeners (the hot-seat switch uses this). */
export function switchLocalViewerEmpire(galaxy: Galaxy, empire: Empire | null | undefined): void {
    setLocalViewerEmpire(galaxy, empire);
    const now = localViewerEmpire(galaxy);
    for (const fn of [...viewerListeners]) fn(galaxy, now);
}
