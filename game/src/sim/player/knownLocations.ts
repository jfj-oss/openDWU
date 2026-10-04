// The locations the player has learned of, for the "Waypoints & Known Locations" map overlay and the Waypoints list
// (an Improvement; ui/waypoints.ts, render/locationMarkers.ts). Read only: it never writes the galaxy (works on the
// sim-worker replica) and draws no Rnd.
//
// What the original keeps and shows:
// - Empire.LocationHints (Empire.cs 331 / 1031 List<Point>): a spot the empire was told of. AddLocationHint (Empire.cs
//   2807; tradeItems.ts addLocationHint) is called when the empire receives a location in a diplomatic trade
//   (Galaxy.4.cs 3981-4002 GiveTradeableItem: ruins, a GalaxyLocation, a habitat), buys information from pirates
//   (Main.Part10.cs 4068-4122: INFO_RUINS / debris fields / planet destroyers / restricted areas), from a story clue
//   (Galaxy.5.cs 3877 CheckForStoryLocationHint, 3685 / Galaxy.9.cs 2226 event actions), from the navigational bonus
//   of a ruin or a captured / destroyed base (Galaxy.5.cs 4857 GenerateNavigationalBonusMessage, BuiltObject.2.cs
//   5028 / 5104, Fighter.cs 985 / 1061), and on a LocationPinged event (Main.Part7.cs 4082). A hint is removed once one
//   of the empire's ships comes near it (BuiltObject.1.cs 1941; exploration.ts). The Main View draws every hint as a
//   pulsing dotted circle (MainView.2.cs 3436 method_229 / 3455 method_230, from method_250) — render/locationMarkers.ts
//   ports that — with no name and no tooltip.
// - Empire.KnownGalaxyLocations: the GalaxyLocations the empire knows (found by its ships, BuiltObject.1.cs; traded,
//   bought, revealed). The Main View names the known ones with ShowName at galaxy zoom (MainView.2.cs 4675-4705 /
//   5742-5770: `GodMode || empire.KnownGalaxyLocations.Contains(location)`; mainView.ts RegionLabel), and the system
//   map's hover names a known supernova / restricted area (Main.Part11.cs 1840). No marker, no list.
// Our addition lists both (hints and the point-like known locations: debris fields, planet destroyers, black holes,
// supernovae, restricted areas, the galactic core) with a name and where the knowledge came from.
//
// Headless: no DOM / Pixi.

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import type { Habitat } from '../types';
import { GalaxyLocationType, type GalaxyLocation } from '../galaxyLocation';
import { MAX_SOLAR_SYSTEM_SIZE } from '../visibility';
import { generateLocationDescription } from '../galaxyReports';
import { resolveStarDateDescription } from '../galaxyTime';
import { isMarkerDismissed } from './waypoints';
import { EmpireMessageType, type EmpireMessage } from '../messages';

export type KnownLocationKind = 'hint' | 'location';

export interface KnownLocation {
    kind: KnownLocationKind;
    /** Dismissed by the player (hidden from the overlay; listed only with includeDismissed). */
    dismissed?: boolean;
    /** Stable while the location is listed: `h:<x>,<y>` / `l:<GalaxyLocation index>`. */
    key: string;
    /** Galaxy coordinates of the marker (a hint's point; a location's centre). */
    x: number;
    y: number;
    /** The marker's label. */
    name: string;
    /** "Location hint", "Debris Field", ... */
    typeLabel: string;
    /** kind 'location': the GalaxyLocation; kind 'hint': the listed known location the hint points at, if any. */
    location: GalaxyLocation | null;
}

/** The known GalaxyLocation types listed as markers (the regions — nebulae, race regions — are named by the region
 *  labels instead). */
export const MARKED_LOCATION_TYPES: ReadonlySet<GalaxyLocationType> = new Set([
    GalaxyLocationType.DebrisField,
    GalaxyLocationType.PlanetDestroyer,
    GalaxyLocationType.BlackHole,
    GalaxyLocationType.SuperNova,
    GalaxyLocationType.RestrictedArea,
    GalaxyLocationType.GalacticCore,
]);

const TYPE_LABELS: Partial<Record<GalaxyLocationType, string>> = {
    [GalaxyLocationType.DebrisField]: 'Debris Field',
    [GalaxyLocationType.PlanetDestroyer]: 'Planet Destroyer',
    [GalaxyLocationType.BlackHole]: 'Black Hole',
    [GalaxyLocationType.SuperNova]: 'Supernova',
    [GalaxyLocationType.RestrictedArea]: 'Restricted Area',
    [GalaxyLocationType.GalacticCore]: 'Galactic Core',
    [GalaxyLocationType.NebulaCloud]: 'Nebula',
    [GalaxyLocationType.RaceRegion]: 'Region',
};

export function galaxyLocationTypeLabel(type: GalaxyLocationType): string {
    return TYPE_LABELS[type] ?? 'Location';
}

/** The system star nearest (x, y) and its distance (linear over the systems: called on a change only). */
function nearestSystemStar(galaxy: Galaxy, x: number, y: number): { star: Habitat; distance: number } | null {
    let best: Habitat | null = null;
    let bestD = Infinity;
    for (const sys of galaxy.systems) {
        const s = sys?.systemStar;
        if (s == null) continue;
        const dx = s.xpos - x;
        const dy = s.ypos - y;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
            bestD = d;
            best = s;
        }
    }
    return best === null ? null : { star: best, distance: Math.sqrt(bestD) };
}

/**
 * A hint's short name, after Galaxy.5.cs 4807 GenerateLocationDescription — what the message that brought the hint
 * said: the habitat within 500 of the point by name, else the system ("<star> system", or "near <star>" outside
 * MaxSolarSystemSize * 2.1 of it).
 */
export function hintPlaceName(galaxy: Galaxy, x: number, y: number): string {
    const near = nearestSystemStar(galaxy, x, y);
    if (near === null) return 'Deep space';
    const sys = galaxy.systems[near.star.systemIndex];
    let hab: Habitat | null = null;
    let hd = 500 * 500;
    for (const h of [near.star, ...(sys?.habitats ?? [])]) {
        if (h == null) continue;
        const dx = h.xpos - x;
        const dy = h.ypos - y;
        const d = dx * dx + dy * dy;
        if (d < hd) {
            hd = d;
            hab = h;
        }
    }
    if (hab !== null && hab.name !== '') return hab.name;
    if (near.distance > MAX_SOLAR_SYSTEM_SIZE * 2.1) return `near ${near.star.name}`;
    return `${near.star.name} system`;
}

/** Listed known locations of the player, by the GalaxyLocation (reveal = the original's GodMode: every one). */
function markedLocations(galaxy: Galaxy, empire: Empire, reveal: boolean): GalaxyLocation[] {
    const source = reveal ? galaxy.galaxyLocations : empire.visibility?.knownGalaxyLocations ?? [];
    const out: GalaxyLocation[] = [];
    for (const l of source) if (l != null && MARKED_LOCATION_TYPES.has(l.type)) out.push(l);
    return out;
}

/**
 * Every location the player knows of: the point-like known GalaxyLocations, then the location hints (a hint at — within
 * MaxSolarSystemSize of the centre of — a listed location points at it). `reveal` lists every location (GodMode).
 */
export function knownLocations(galaxy: Galaxy, empire: Empire | null, reveal = false, includeDismissed = false): KnownLocation[] {
    if (empire === null) return [];
    const out: KnownLocation[] = [];
    const locs = markedLocations(galaxy, empire, reveal);
    const index = new Map(galaxy.galaxyLocations.map((l, i) => [l, i] as const));
    for (const l of locs) {
        const c = l.resolveLocationCenter();
        const typeLabel = galaxyLocationTypeLabel(l.type);
        const key = `l:${index.get(l) ?? -1}`;
        const dismissed = isMarkerDismissed(galaxy, key);
        out.push({ kind: 'location', key, dismissed, x: c.x, y: c.y, name: l.name !== '' && l.name != null ? l.name : typeLabel, typeLabel, location: l });
    }
    // Dismissed locations stay in `listed` (a hint at one still points at it); they are dropped on return.
    const listed = out.slice();
    const r2 = MAX_SOLAR_SYSTEM_SIZE * MAX_SOLAR_SYSTEM_SIZE;
    for (const p of empire.locationHints ?? []) {
        if (p == null) continue;
        let at: KnownLocation | null = null;
        for (const k of listed) {
            const dx = k.x - p.x;
            const dy = k.y - p.y;
            if (dx * dx + dy * dy <= r2) {
                at = k;
                break;
            }
        }
        const key = `h:${p.x},${p.y}`;
        const dismissed = isMarkerDismissed(galaxy, key);
        if (dismissed && !includeDismissed) continue;
        out.push({
            kind: 'hint',
            key,
            dismissed,
            x: p.x,
            y: p.y,
            name: at !== null ? at.name : hintPlaceName(galaxy, p.x, p.y),
            typeLabel: 'Location hint',
            location: at?.location ?? null,
        });
    }
    return includeDismissed ? out : out.filter((k) => k.dismissed !== true);
}

/** A cheap change key for the player's hints and known locations (counts and end points; read every few frames). */
export function knownLocationsSignature(empire: Empire | null, reveal = false): string {
    if (empire === null) return '';
    const h = empire.locationHints ?? [];
    const k = empire.visibility?.knownGalaxyLocations ?? [];
    const a = h.length > 0 ? h[0] : null;
    const b = h.length > 0 ? h[h.length - 1] : null;
    let s = `${reveal ? 1 : 0}|${h.length}:${a?.x},${a?.y}:${b?.x},${b?.y}|${k.length}`;
    // Hints are few: include each (a hint removed in the middle and another added keeps the count).
    if (h.length <= 64) for (const p of h) s += `;${p.x},${p.y}`;
    return s;
}

/** A message's one-line title: its title, else the first line of its text (cut), with the star date. */
function messageLine(m: EmpireMessage): string {
    let t = (m.title ?? '').trim();
    if (t === '') {
        const first = (m.description ?? '').split('\n')[0].trim();
        t = first.length > 90 ? `${first.slice(0, 87)}...` : first;
    }
    if (t === '') t = EmpireMessageType[m.messageType] ?? 'Message';
    return m.starDate > 0 ? `${t} (${resolveStarDateDescription(m.starDate)})` : t;
}

/** The newest of the player's messages (history, then the current ones) whose text contains one of `needles`. */
function findMessage(empire: Empire, needles: readonly string[]): EmpireMessage | null {
    const ns = needles.filter((n) => n.length >= 4);
    if (ns.length === 0) return null;
    const lists = [empire.messageHistory as EmpireMessage[], empire.messages as EmpireMessage[]];
    for (const list of lists) {
        if (!Array.isArray(list)) continue;
        for (let i = list.length - 1; i >= 0; i--) {
            const m = list[i];
            const d = m?.description;
            if (typeof d !== 'string' || d === '') continue;
            for (const n of ns) if (d.includes(n)) return m;
        }
    }
    return null;
}

/** Where the knowledge came from, as far as the player's messages tell: the message line, else null. */
export function knownLocationSource(galaxy: Galaxy, empire: Empire | null, loc: KnownLocation): string | null {
    if (empire === null) return null;
    const needles: string[] = [];
    if (loc.kind === 'hint') {
        try {
            needles.push(generateLocationDescription(galaxy, loc.x, loc.y));
        } catch {
            /* a replica without its spatial index: the name below */
        }
    }
    if (loc.location !== null && loc.location.name !== '') needles.push(loc.location.name);
    const m = findMessage(empire, needles);
    return m !== null ? messageLine(m) : null;
}

/** The hover text of a known location (name, kind, what the original's message said, where it came from). */
export function knownLocationTooltip(galaxy: Galaxy, empire: Empire | null, loc: KnownLocation): string {
    const lines = [loc.name];
    if (loc.kind === 'hint') {
        let desc = '';
        try {
            desc = generateLocationDescription(galaxy, loc.x, loc.y);
        } catch {
            desc = '';
        }
        lines.push(desc !== '' ? `Location hint: ${desc}` : 'Location hint');
        if (loc.location !== null) lines.push(galaxyLocationTypeLabel(loc.location.type));
    } else {
        lines.push(loc.typeLabel);
    }
    const src = knownLocationSource(galaxy, empire, loc);
    if (src !== null) lines.push(`From: ${src}`);
    else if (loc.kind === 'hint') lines.push('From: a location you were told of (a diplomatic exchange, information bought from pirates, a story clue or an investigation)');
    else lines.push('From: found by your ships, or shared through diplomacy or pirate information');
    if (loc.kind === 'hint') lines.push('Cleared when one of your ships gets there.');
    lines.push('Right-click: dismiss this marker (restore it in the Waypoints list).');
    return lines.join('\n');
}
