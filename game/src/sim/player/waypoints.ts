// Player waypoints (an Improvement: not in DW:U). Named map pins the player puts down to remember places; nothing in
// the sim reads them. They are player data saved with the game:
//
// - State: a per-galaxy side table (save/galaxySave.ts SideTables.waypoints) in a module WeakMap beside the galaxy,
//   outside the object graph, so the galaxy graph and the state digest (tick/digest.ts) never see it. The table is
//   written only while at least one waypoint exists, so a game without waypoints saves exactly as before (and when
//   the last one is deleted the id counter restarts, so a save → load and an uninterrupted game keep issuing the same
//   ids).
// - Writes: only through the journaled player ops addWaypoint / renameWaypoint / deleteWaypoint (playerOps.ts), applied
//   at a frame boundary and replayed from the command log; in worker mode they run on the worker's galaxy and the
//   table reaches the replica through the side-tables root (simworker/simHost.ts freshens it at once; the replica
//   reads the synced object through setRemoteWaypoints).
// - No Rnd, no sim state read for any rule: a waypoint is a point, a name, an owner and the star date it was made.
//
// Headless: no DOM / Pixi.

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import { galaxyStarDate } from '../tick/simTime';

/** One waypoint. Plain data (saved, synced, sent in command replies). */
export interface Waypoint {
    /** Stable id within the game (1, 2, ...; restarts at 1 once every waypoint is deleted). */
    id: number;
    /** Galaxy coordinates (integers, inside the galaxy). */
    x: number;
    y: number;
    name: string;
    /** Empire.empireId of the empire that placed it (the player). */
    empireId: number;
    /** Galaxy star date (ms) when it was placed. */
    starDate: number;
}

/** The side table. */
export interface WaypointState {
    version: 1;
    nextId: number;
    /** In creation order. */
    list: Waypoint[];
    /** Dismissed map markers (hint `h:<x>,<y>` / known location `l:<index>`; knownLocations.ts keys), hidden from our
     *  overlay only: the original's LocationHints / KnownGalaxyLocations are untouched. Absent / empty = none. */
    dismissed?: string[];
}

/** Longest name kept (the rest is cut). */
export const WAYPOINT_NAME_MAX = 40;
/** Most waypoints one game keeps (a stuck key cannot flood the map). */
export const WAYPOINT_MAX = 500;

const states = new WeakMap<Galaxy, WaypointState>();
/** Worker mode: the replica reads the synced table (simworker/clientCore.ts). */
const remote = new WeakMap<Galaxy, () => WaypointState | null>();

/** Worker mode: read the replica's waypoints from `read` (the synced side table); null unregisters. */
export function setRemoteWaypoints(galaxy: Galaxy, read: (() => WaypointState | null) | null): void {
    if (read === null) remote.delete(galaxy);
    else remote.set(galaxy, read);
}

/** The galaxy's waypoint table (undefined while it has none). Read-only for the UI. */
export function waypointState(galaxy: Galaxy | null | undefined): WaypointState | undefined {
    if (galaxy == null) return undefined;
    const r = remote.get(galaxy);
    if (r !== undefined) {
        const v = r();
        return v !== null && typeof v === 'object' && Array.isArray(v.list) ? v : undefined;
    }
    return states.get(galaxy);
}

/** The waypoints `empire` placed (every waypoint when `empire` is omitted), in creation order. */
export function waypoints(galaxy: Galaxy | null | undefined, empire?: Empire | null): readonly Waypoint[] {
    const st = waypointState(galaxy);
    if (st === undefined) return [];
    if (empire === undefined) return st.list;
    if (empire === null) return [];
    return st.list.filter((w) => w.empireId === empire.empireId);
}

export function waypointById(galaxy: Galaxy | null | undefined, id: number): Waypoint | null {
    return waypointState(galaxy)?.list.find((w) => w.id === id) ?? null;
}

/** The name as kept: one line, whitespace collapsed, at most WAYPOINT_NAME_MAX characters ('' when nothing is left). */
export function sanitizeWaypointName(name: unknown): string {
    if (typeof name !== 'string') return '';
    const s = name.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
    return Array.from(s).slice(0, WAYPOINT_NAME_MAX).join('').trim();
}

/** The name an unnamed waypoint gets ("Waypoint N", N = the next id). */
export function defaultWaypointName(galaxy: Galaxy): string {
    return `Waypoint ${waypointState(galaxy)?.nextId ?? 1}`;
}

/**
 * Op addWaypoint: put a waypoint named `name` at (x, y) (clamped into the galaxy, truncated to integers). Returns its
 * id, or 0 when refused (coordinates not finite, the WAYPOINT_MAX limit). An empty name gets defaultWaypointName.
 */
export function addWaypoint(galaxy: Galaxy, empire: Empire, x: number, y: number, name: string): number {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return 0;
    let st = states.get(galaxy);
    if (st !== undefined && st.list.length >= WAYPOINT_MAX) return 0;
    const clean = sanitizeWaypointName(name);
    if (st === undefined) {
        st = { version: 1, nextId: 1, list: [] };
        states.set(galaxy, st);
    }
    const id = st.nextId++;
    st.list.push({
        id,
        x: Math.trunc(Math.min(Math.max(x, 0), galaxy.sizeX)),
        y: Math.trunc(Math.min(Math.max(y, 0), galaxy.sizeY)),
        name: clean !== '' ? clean : `Waypoint ${id}`,
        empireId: empire.empireId,
        starDate: galaxyStarDate(galaxy),
    });
    return id;
}

/** Op renameWaypoint: false when there is no such waypoint of `empire` or the new name is empty. */
export function renameWaypoint(galaxy: Galaxy, empire: Empire, id: number, name: string): boolean {
    const w = states.get(galaxy)?.list.find((v) => v.id === id);
    if (w === undefined || w.empireId !== empire.empireId) return false;
    const clean = sanitizeWaypointName(name);
    if (clean === '') return false;
    w.name = clean;
    return true;
}

/** Op deleteWaypoint: false when there is no such waypoint of `empire`. Deleting the last one restarts the ids. */
export function deleteWaypoint(galaxy: Galaxy, empire: Empire, id: number): boolean {
    const st = states.get(galaxy);
    if (st === undefined) return false;
    const i = st.list.findIndex((v) => v.id === id);
    if (i < 0 || st.list[i].empireId !== empire.empireId) return false;
    st.list.splice(i, 1);
    // The table is not saved while empty (savedWaypointState), so a reloaded game would start the ids at 1 again:
    // restart them here too, so ids — which later commands in the log name — come out the same either way. The object
    // stays (the worker's side-tables root holds it).
    if (st.list.length === 0) st.nextId = 1;
    return true;
}

/** The dismissed marker keys (empty when none). Read-only for the UI; works on the replica. */
export function dismissedMarkers(galaxy: Galaxy | null | undefined): readonly string[] {
    return waypointState(galaxy)?.dismissed ?? [];
}

export function isMarkerDismissed(galaxy: Galaxy | null | undefined, key: string): boolean {
    return dismissedMarkers(galaxy).includes(key);
}

const MARKER_KEY = /^(h:-?\d+,-?\d+|l:\d+)$/;

/** Op dismissMarker: hide (dismiss = true) or restore a hint / known-location marker. False when nothing changed. */
export function dismissMarker(galaxy: Galaxy, _empire: Empire, key: string, dismiss: boolean): boolean {
    if (typeof key !== 'string' || !MARKER_KEY.test(key)) return false;
    let st = states.get(galaxy);
    const has = st?.dismissed?.includes(key) === true;
    if (dismiss === has) return false;
    if (st === undefined) {
        st = { version: 1, nextId: 1, list: [] };
        states.set(galaxy, st);
    }
    if (dismiss) (st.dismissed ??= []).push(key);
    else st.dismissed = st.dismissed!.filter((k) => k !== key);
    return true;
}

/** What the save writes: the table while it holds a waypoint or a dismissed marker, else undefined (no key). */
export function savedWaypointState(galaxy: Galaxy): WaypointState | undefined {
    const st = states.get(galaxy);
    return st !== undefined && (st.list.length > 0 || (st.dismissed?.length ?? 0) > 0) ? st : undefined;
}

/** What the replica sync carries: the live table (also while empty, so a delete of the last one reaches the replica). */
export function liveWaypointState(galaxy: Galaxy): WaypointState | null {
    return states.get(galaxy) ?? null;
}

/** Save load / replica restore (galaxySave.ts restoreSideTables): undefined / null = no waypoints. */
export function restoreWaypointState(galaxy: Galaxy, st: WaypointState | null | undefined): void {
    if (st == null || !Array.isArray(st.list)) {
        states.delete(galaxy);
        return;
    }
    states.set(galaxy, st);
}

/** The ops that change the table (simworker/simHost.ts freshens the side-tables root after them). */
export const WAYPOINT_OPS: ReadonlySet<string> = new Set(['addWaypoint', 'renameWaypoint', 'deleteWaypoint', 'dismissMarker']);
