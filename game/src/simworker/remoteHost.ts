// Sim worker: the main thread's handle on the worker game for code that only has a (replica) Galaxy in hand — the
// local-model paths (docs/sim-worker.md §9 chunk 8: the advisor chat, the diplomat voice, the 18c AI advisor, the
// chronicle and voice jobs). In-thread they called sim functions directly and used the result at once
// (runPlayerCommand, applyStrategicDecisions, storeChronicleYear, applyVoiceToMessage). On a replica those writes must
// run in the worker, so they become a command or a host op with an async result, and the worker → main events (the
// voice cues) are delivered to subscribers here.
//
// A registry keyed by the replica Galaxy (the client core registers itself), so this module imports nothing heavy: the
// UI / llm modules can ask "is this galaxy a replica, and how do I reach its worker?" without pulling in the replica
// codec. No DOM / Pixi imports.

import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import type { PlayerOpArgs, PlayerOpName, PlayerOpResult } from '../sim/player/playerOps';
import type { HostOpArgs, HostOpName, HostOpResult } from './hostOps';
import type { WorkerEvent } from './protocol';

export interface RemoteSimHost {
    /**
     * Issue a player command on the worker's game (issuePlayerCommand there: applied at the worker's next frame
     * boundary and journaled exactly as in-thread). Resolves with the executor's result, resolved against the replica
     * once the delta of that boundary has been applied; rejects when the worker could not apply it.
     */
    command<K extends PlayerOpName>(empire: Empire, op: K, args: PlayerOpArgs<K>): Promise<PlayerOpResult<K>>;
    /** Run a host op (simworker/hostOps.ts) on the worker's game between two ticks; the result as for `command`. */
    hostOp<K extends HostOpName>(op: K, args: HostOpArgs<K>): Promise<HostOpResult<K>>;
    /** Sim → UI events of each step message (after its delta), with the resolver for their replica objects. */
    subscribe(listener: (e: WorkerEvent, resolve: (a: unknown) => unknown) => void): () => void;
}

const hosts = new WeakMap<Galaxy, RemoteSimHost>();

/** The worker behind a replica galaxy (null in-thread: the galaxy is the authoritative game). */
export function remoteSimHost(galaxy: Galaxy): RemoteSimHost | null {
    return hosts.get(galaxy) ?? null;
}

/** Register (or, with null, forget) the worker behind replica `galaxy` (clientCore.ts). */
export function setRemoteSimHost(galaxy: Galaxy, host: RemoteSimHost | null): void {
    if (host === null) hosts.delete(galaxy);
    else hosts.set(galaxy, host);
}
