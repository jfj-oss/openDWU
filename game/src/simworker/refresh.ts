// Sim worker: "refresh on open" for the empire-management screens (docs/sim-worker.md §9 chunk 6).
//
// A replica's cold data is up to one cold cycle old (about 1–1.5 s on a late game). A screen that opens asks the
// worker to compare the objects it is about to show (and what they reach) at once, so they arrive with the next
// delta; `onFresh` runs on the main thread once that delta is fully applied (its cold part too), when the screen can
// re-render with current data. In-thread (no worker) the galaxy is the authoritative one and this is a no-op:
// `onFresh` is not called, so a screen behaves exactly as before.
//
// No DOM / Pixi imports.

import type { Galaxy } from '../sim/galaxy';

export type RemoteRefreshSink = (objects: readonly object[], onFresh?: () => void) => void;

const sinks = new WeakMap<Galaxy, RemoteRefreshSink>();

/** Route refresh requests on a replica galaxy to its worker (clientCore.ts; null to remove). */
export function setRemoteRefreshSink(galaxy: Galaxy, sink: RemoteRefreshSink | null): void {
    if (sink === null) sinks.delete(galaxy);
    else sinks.set(galaxy, sink);
}

/** True when `galaxy` is a sim-worker replica (its state arrives from the worker). */
export function isReplicaGalaxy(galaxy: Galaxy): boolean {
    return sinks.has(galaxy);
}

/**
 * Ask the worker to send `objects` (replica objects: an empire, colonies, ships, …) and what they reach now. No-op
 * in-thread. `onFresh` runs once the replica has the result (worker mode only).
 */
export function requestSimRefresh(galaxy: Galaxy, objects: readonly object[], onFresh?: () => void): void {
    const sink = sinks.get(galaxy);
    if (sink !== undefined) sink(objects, onFresh);
}
