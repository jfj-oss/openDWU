// What each location hint points at, as the message that created it said (an Improvement, with the Waypoints & Known
// Locations overlay: sim/player/knownLocations.ts, render/locationMarkers.ts). The hint itself is untouched (an Empire
// LocationHints point); the subject is a short string kept player-side in a module WeakMap keyed by Empire, outside
// the object graph, so the state digest never sees it, and no Rnd is drawn.
//
// - Format: "<label>" or "<label>: <detail>" ("Abandoned Destroyer: ISV Ranger", "Ancient ruins: Tau Ceti IV",
//   "Debris field"). The marker's label is the part before the colon; the tooltip and the Waypoints list show it all.
//   Only what the source message stated goes in (never an unrevealed detail).
// - Written by tradeItems.ts addLocationHint (its optional third argument) when a hint is really added; a hint that
//   is skipped (one already lies within MaxSolarSystemSize) keeps the earlier subject. A hint added without a subject
//   clears any stale one at that point.
// - Saved as the side table `hintSubjects` ({ "x,y": { w, s } }), only while the player's empire has one — so a game
//   without any saves exactly as before and old saves load with none (knownLocations.ts then looks the point up).
// - Worker mode: the replica reads the synced side table (setRemoteHintSubjects; simHost bumps `hintSubjectsRevision`).
//
// Headless: no DOM / Pixi.

import type { Empire } from '../empire';
import type { Galaxy } from '../galaxy';
import type { BuiltObject } from '../builtObject';
import type { Habitat } from '../types';
import { GalaxyLocationType, type GalaxyLocation } from '../galaxyLocation';
import { BuiltObjectSubRole } from '../builtObjectTypes';
import { resolveDescription } from '../messages';

export const HINT_SUBJECT_MAX = 120;

/** One recorded hint: what is there (w) and the kind of information source it came from (s). */
export interface HintInfo {
    w?: string;
    s?: string;
}

const subjects = new WeakMap<Empire, Record<string, HintInfo>>();
const remote = new WeakMap<Galaxy, () => Record<string, HintInfo> | null>();
/** Bumped on every change (simHost compares it to freshen the replica's side table). */
export let hintSubjectsRevision = 0;

export function hintSubjectKey(x: number, y: number): string {
    return `${x},${y}`;
}

/** Worker mode: read the replica's subjects from `read`; null unregisters. */
export function setRemoteHintSubjects(galaxy: Galaxy, read: (() => Record<string, HintInfo> | null) | null): void {
    if (read === null) remote.delete(galaxy);
    else remote.set(galaxy, read);
}

/** Record (or, with no `what`, clear) the subject of the hint just added at `point` for `empire`. Prunes subjects of
 *  hints that no longer exist. */
export function recordHintSubject(empire: Empire, point: { x: number; y: number }, what: string | undefined, source?: string): void {
    const key = hintSubjectKey(point.x, point.y);
    let t = subjects.get(empire);
    if ((what === undefined || what === '') && (source === undefined || source === '')) {
        if (t !== undefined && key in t) {
            delete t[key];
            hintSubjectsRevision++;
        }
        return;
    }
    if (t === undefined) {
        t = {};
        subjects.set(empire, t);
    }
    const live = new Set((empire.locationHints ?? []).map((p) => hintSubjectKey(p.x, p.y)));
    for (const k of Object.keys(t)) if (!live.has(k)) delete t[k];
    const info: HintInfo = {};
    if (what !== undefined && what !== '') info.w = what.length > HINT_SUBJECT_MAX ? what.slice(0, HINT_SUBJECT_MAX) : what;
    if (source !== undefined && source !== '') info.s = source.length > HINT_SUBJECT_MAX ? source.slice(0, HINT_SUBJECT_MAX) : source;
    t[key] = info;
    hintSubjectsRevision++;
}

function hintInfo(galaxy: Galaxy | null | undefined, x: number, y: number): HintInfo | undefined {
    if (galaxy == null) return undefined;
    const r = remote.get(galaxy);
    const t = r !== undefined ? r() : galaxy.playerEmpire != null ? subjects.get(galaxy.playerEmpire) : undefined;
    const v = t?.[hintSubjectKey(x, y)];
    return v !== null && typeof v === 'object' ? v : undefined;
}

/** The recorded subject of the hint at (x, y), or undefined. Works on the replica. */
export function hintSubject(galaxy: Galaxy | null | undefined, x: number, y: number): string | undefined {
    const w = hintInfo(galaxy, x, y)?.w;
    return typeof w === 'string' ? w : undefined;
}

/** The recorded kind of information source ("Diplomacy (traded by X)", "Story clue"), or undefined. */
export function hintSource(galaxy: Galaxy | null | undefined, x: number, y: number): string | undefined {
    const s = hintInfo(galaxy, x, y)?.s;
    return typeof s === 'string' ? s : undefined;
}

/** What the save writes: the player's subjects while there are any, else undefined (no key). */
export function savedHintSubjects(galaxy: Galaxy): Record<string, HintInfo> | undefined {
    const p = galaxy.playerEmpire;
    const t = p != null ? subjects.get(p) : undefined;
    if (t === undefined) return undefined;
    const live = new Set((p!.locationHints ?? []).map((q) => hintSubjectKey(q.x, q.y)));
    const out: Record<string, HintInfo> = {};
    let any = false;
    for (const k of Object.keys(t)) {
        if (!live.has(k)) continue;
        out[k] = t[k];
        any = true;
    }
    return any ? out : undefined;
}

/** What the replica sync carries: the live table (null while none, so the key stays). */
export function liveHintSubjects(galaxy: Galaxy): Record<string, HintInfo> | null {
    const p = galaxy.playerEmpire;
    return (p != null ? subjects.get(p) : undefined) ?? null;
}

/** Save load: undefined / null = none. */
export function restoreHintSubjects(galaxy: Galaxy, t: Record<string, HintInfo> | null | undefined): void {
    const p = galaxy.playerEmpire;
    if (p == null) return;
    if (t == null || typeof t !== 'object') subjects.delete(p);
    else subjects.set(p, JSON.parse(JSON.stringify(t)) as Record<string, HintInfo>);
    hintSubjectsRevision++;
}

// ---- subject texts (what each source's message said) ----

function subRoleText(subRole: BuiltObjectSubRole): string {
    return resolveDescription(BuiltObjectSubRole as unknown as Record<number, string>, subRole);
}

/** A ship / base the message named: "<subrole>: <name>" (abandoned = an unowned ship or base). */
export function builtObjectSubject(bo: BuiltObject, abandoned: boolean): string {
    const role = subRoleText(bo.subRole);
    return `${abandoned ? 'Abandoned ' : ''}${role}${bo.name ? `: ${bo.name}` : ''}`;
}

export function ruinsSubject(h: Habitat): string {
    return `Ancient ruins: ${h.name}`;
}

export function habitatSubject(kind: string, h: Habitat): string {
    return `${kind}: ${h.name}`;
}

const LOCATION_SUBJECT: Partial<Record<GalaxyLocationType, string>> = {
    [GalaxyLocationType.DebrisField]: 'Debris field',
    [GalaxyLocationType.PlanetDestroyer]: 'Planet destroyer',
    [GalaxyLocationType.RestrictedArea]: 'Restricted area',
    [GalaxyLocationType.BlackHole]: 'Black hole',
    [GalaxyLocationType.SuperNova]: 'Supernova',
    [GalaxyLocationType.GalacticCore]: 'Galactic core',
};

/** A GalaxyLocation the message named: its type (the type only for the label; a special name goes in the detail). */
export function locationSubject(l: GalaxyLocation): string {
    const label = LOCATION_SUBJECT[l.type] ?? 'Special location';
    return l.name && l.name !== '' && l.type !== GalaxyLocationType.DebrisField && l.type !== GalaxyLocationType.PlanetDestroyer ? `${label}: ${l.name}` : label;
}

/** The marker label of a subject: the part before the first colon. */
export function subjectLabel(what: string): string {
    const i = what.indexOf(':');
    return (i < 0 ? what : what.slice(0, i)).trim();
}
