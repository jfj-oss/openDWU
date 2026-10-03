// Read-only galaxies: the sim's lazy writes on a UI read (docs/sim-worker.md §8, §9 chunk 6).
//
// A few C# lookups create the record they look up when it is missing: Empire.4.cs 137 ObtainDiplomaticRelation adds a
// NotMet relation, Empire.8.cs 2351 ObtainPirateRelation adds a NotMet pirate relation, Empire.4.cs 106
// ObtainEmpireEvaluation adds an evaluation, Galaxy._WondersBuilt is created on first use, and a scenario package's
// state bag is created on first read. Some money reads also age the income they read (ThisYearsSpacePortIncome,
// ThisYearsResortIncome, the NaN tax-revenue recalculation, CheckAgeVariableIncome). Inside the sim (a tick, a player
// command) they keep all of that. A read from the UI must not write the game outside the journaled command queue,
// though: in-thread the write would not be in the command log (a replay of seed + log would not repeat it and would
// drift), and on a sim-worker replica it would never reach the worker.
//
// So a galaxy is READ-ONLY for these lookups when it is
// - a sim-worker replica (simworker/clientCore.ts marks it): always; or
// - the in-thread game the UI runs on (main.ts marks it with markUiGalaxy) while no sim code is running: outside a sim
//   frame (tick/commandBoundary.ts inSimFrame) and outside a player command's executor (playerCommands.ts runs each
//   one inside withSimWrites). The UI's timers and handlers run exactly then.
// A read-only lookup answers with the value it would give (a detached record, the aged figure) without writing it.
//
// The record lookups the C# UI makes (ObtainDiplomaticRelation from the mouse-move order hint, the diplomacy screen, …)
// do add the record in the original, at UI time. Here that add becomes a journaled player command instead: the
// read-only lookup asks for the record (requestUiRecord), and once per UI task the requests go out as one
// 'obtainUiRecords' command (player/playerOps.ts), applied at the next frame boundary and replayed from the log — the
// same in-thread and in worker mode (where the command reaches the worker). Port-only reads that are not the C# UI (the
// local-model briefs, llm/replicaReads.ts) run inside withPureSimReads: read-only, and they ask for nothing.
//
// Tests and the headless harness never mark a galaxy, so the sim's results and its RNG sequence there are unchanged.
//
// No DOM / Pixi imports.

import type { Galaxy } from './galaxy';
import type { Empire } from './empire';
import { inSimFrame } from './tick/commandBoundary';

const readOnlyGalaxies = new WeakSet<object>();
const uiGalaxies = new WeakSet<object>();
/** > 0 while sim code writes outside a frame: a player command's executor (playerCommands.ts), withSimWrites. */
let simWriteDepth = 0;
/** > 0 inside withPureSimReads: any galaxy is read-only, and the lookups ask for no record. */
let pureReadDepth = 0;

/** True when the lazy lookups must not write `galaxy` (a sim-worker replica, or a UI read of the in-thread game). */
export function isReadOnlyGalaxy(galaxy: Galaxy | null): boolean {
    if (galaxy === null) return false;
    if (readOnlyGalaxies.has(galaxy)) return true;
    if (pureReadDepth > 0) return true;
    return simWriteDepth === 0 && uiGalaxies.has(galaxy) && !inSimFrame();
}

/** Mark a galaxy as read-only (a sim-worker replica, whose state the worker owns); false unmarks it. */
export function markReadOnlyGalaxy(galaxy: Galaxy, readOnly = true): void {
    if (readOnly) readOnlyGalaxies.add(galaxy);
    else readOnlyGalaxies.delete(galaxy);
}

/** Mark the in-thread game the UI runs on: read-only for the lazy lookups outside sim code (see the file header). */
export function markUiGalaxy(galaxy: Galaxy, on = true): void {
    if (on) uiGalaxies.add(galaxy);
    else uiGalaxies.delete(galaxy);
}

/** Run sim code that writes the game outside a frame (a player command's executor): the lookups write. */
export function withSimWrites<T>(fn: () => T): T {
    simWriteDepth++;
    try {
        return fn();
    } finally {
        simWriteDepth--;
    }
}

/**
 * Run a read that is not the C# UI's (a port-only read: the local-model briefs) without any side effect: every galaxy
 * is read-only inside, and the record lookups ask for nothing. Not inside a sim frame or a player command.
 */
export function withPureSimReads<T>(fn: () => T): T {
    pureReadDepth++;
    try {
        return fn();
    } finally {
        pureReadDepth--;
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Records the C# UI's lookups add: requested by a read-only lookup, added by a journaled command
// ---------------------------------------------------------------------------------------------------------------

/** A record a read-only lookup did not add: ObtainDiplomaticRelation / ObtainPirateRelation / ObtainEmpireEvaluation. */
export interface UiRecordRequest {
    kind: 'diplomaticRelation' | 'pirateRelation' | 'empireEvaluation';
    /** The empire the record belongs to (the C# `this`). */
    self: Empire;
    /** The other empire of the record. */
    other: Empire;
}

/** Sends a galaxy's record requests as one journaled command (player/playerCommands.ts installs it). */
export type UiRecordSender = (galaxy: Galaxy, requests: UiRecordRequest[]) => void;
let sender: UiRecordSender | null = null;

interface RequestState {
    /** Asked since the last send (deduplicated by key). */
    pending: Map<string, UiRecordRequest>;
    /**
     * Sent lately (key → galaxy.nowMs at the send): not asked again meanwhile. In-thread the record exists once the
     * command applied; on a sim-worker replica it arrives with the sync after the worker applied it (the cold cycle,
     * about a second; a paused worker keeps syncing), so a request is not repeated for IN_FLIGHT_MS of game time. A
     * repeat would only journal a no-op. (Game time, not a wall clock: src/sim reads no real clock.)
     */
    inFlight: Map<string, number>;
    scheduled: boolean;
}
const requests = new WeakMap<Galaxy, RequestState>();
const IN_FLIGHT_MS = 5000;

export function setUiRecordSender(s: UiRecordSender | null): void {
    sender = s;
}

/** A per-object serial for the request keys (empire ids are not unique across empires and pirate factions). */
const serials = new WeakMap<object, number>();
let nextSerial = 1;
function serialOf(o: object): number {
    let n = serials.get(o);
    if (n === undefined) {
        n = nextSerial++;
        serials.set(o, n);
    }
    return n;
}
const requestKey = (r: UiRecordRequest): string => `${r.kind}:${serialOf(r.self)}:${serialOf(r.other)}`;

/**
 * A read-only lookup (isReadOnlyGalaxy) did not add the record `kind` of `self` for `other`: when the C# UI would have
 * added it (not inside withPureSimReads), ask for it. The requests of one UI task go out together, after it.
 */
export function requestUiRecord(galaxy: Galaxy, kind: UiRecordRequest['kind'], self: Empire, other: Empire): void {
    if (pureReadDepth > 0 || sender === null) return;
    let st = requests.get(galaxy);
    if (st === undefined) {
        st = { pending: new Map(), inFlight: new Map(), scheduled: false };
        requests.set(galaxy, st);
    }
    const r: UiRecordRequest = { kind, self, other };
    const key = requestKey(r);
    const now = galaxy.nowMs;
    const sent = st.inFlight.get(key);
    if (sent !== undefined && now - sent < IN_FLIGHT_MS) return;
    if (st.inFlight.size > 256) for (const [k, t] of st.inFlight) if (now - t >= IN_FLIGHT_MS) st.inFlight.delete(k);
    st.pending.set(key, r);
    if (st.scheduled) return;
    st.scheduled = true;
    const state = st;
    // After the UI task that read (a timer, a handler): never inside a sim frame or a command boundary.
    queueMicrotask(() => {
        state.scheduled = false;
        if (state.pending.size === 0 || sender === null) return;
        const list = [...state.pending.values()];
        const at = galaxy.nowMs;
        for (const k of state.pending.keys()) state.inFlight.set(k, at);
        state.pending.clear();
        sender(galaxy, list);
    });
}
