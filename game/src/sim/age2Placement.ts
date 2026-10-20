// The Long Night's Age 2 placement (ours; the plan's "Age 2 placement"): which empires of Age 1 come back and where they stand.
//
// At capture time (longNight.ts captureMemory) the empires that still owned a colony are recorded as SurvivorRecs (identity + candidate home
// worlds by position). At the start of the new game (game.ts, the foundPreWarp branch, BEFORE any empire is founded, so the stock pre-warp
// home-system set-up, with its crashed-hull research ruin, runs on the chosen home) planAge2 picks each survivor's home among the new galaxy's
// habitats at those positions. The galaxy's remaining empire slots are filled with new empires placed the stock way, which keep clear of the
// survivors' systems, the Harvest Scars and the old Beacon site (Age2Plan.avoids).
//
// Pure of Rnd except makeHomeNative (the stock colony code's draws, as a colony settled on another type does). No DOM, no Pixi.

import type { Galaxy } from './galaxy';
import type { Empire } from './empire';
import { HabitatCategoryType, HabitatType, type Habitat } from './types';
import { humanSeats } from './humanEmpires';
import type { PlaceRec, SurvivorRec } from './scenario/threats/giantworks/longNightState';

/** The most worlds recorded per survivor (the fallbacks when the best ones are taken). */
const MAX_HOMES = 12;
/** A new empire's capital keeps this many sectors from a Scar or the old Beacon site. */
const AVOID_SECTORS = 0.75;

function placeOf(galaxy: Galaxy, h: Habitat): PlaceRec {
    return { name: h.name, systemName: galaxy.systems[h.systemIndex]?.systemStar?.name ?? h.name, x: h.xpos, y: h.ypos };
}

/** A world a colony can stand on (a planet, or a moon of a planet that is not a gas giant). */
function isWorld(h: Habitat): boolean {
    if (h.category === HabitatCategoryType.Planet) return h.type !== HabitatType.GasGiant && h.type !== HabitatType.FrozenGasGiant;
    if (h.category === HabitatCategoryType.Moon) return h.parent !== null && h.parent.type !== HabitatType.GasGiant && h.parent.type !== HabitatType.FrozenGasGiant;
    return false;
}

function popOf(h: Habitat): number {
    return h.population?.totalAmount ?? 0;
}

function distToCentre(galaxy: Galaxy, h: Habitat): number {
    return Math.hypot(h.xpos - galaxy.sizeX / 2, h.ypos - galaxy.sizeY / 2);
}

// ---------------------------------------------------------------------------------------------------------------
// Capture (the old galaxy, when the Long Night begins)
// ---------------------------------------------------------------------------------------------------------------

/**
 * The survivors of Age 1: every normal empire still owning a colony (and every human empire, alive or not). `isNormal` is the Beacon path's
 * test (not a faction, not independent, not a pirate). Pure.
 */
export function captureSurvivors(galaxy: Galaxy, isNormal: (e: Empire) => boolean): SurvivorRec[] {
    const humans = humanSeats(galaxy);
    const out: SurvivorRec[] = [];
    for (const e of galaxy.empires) {
        if (e === null || !isNormal(e) || e.dominantRace === null) continue;
        const human = humans.indexOf(e);
        const worlds = e.colonies.filter((h) => isWorld(h) && h.empire === e);
        const alive = worlds.length > 0;
        if (!alive && human < 0) continue;
        const capitalHeld = e.capital !== null && worlds.includes(e.capital);
        let order: Habitat[];
        if (human >= 0) {
            // The player's rule: the capital if it survived, else the colony closest to the galaxy's centre.
            order = [...worlds].sort((a, b) => distToCentre(galaxy, a) - distToCentre(galaxy, b));
        } else {
            order = [...worlds].sort((a, b) => popOf(b) - popOf(a));
        }
        if (capitalHeld) order = [e.capital!, ...order.filter((h) => h !== e.capital)];
        // A dead human starts on its Age 1 home world.
        if (!alive && e.capital !== null) order = [e.capital];
        out.push({
            name: e.name,
            race: e.dominantRace.name,
            primaryColor: e.mainColor,
            secondaryColor: e.secondaryColor,
            flagShape: e.flagShape,
            human,
            alive,
            capitalHeld,
            homes: order.slice(0, MAX_HOMES).map((h) => placeOf(galaxy, h)),
        });
    }
    // Humans first (player, then the extra seats), the rest in empire order: the order they claim their worlds in.
    return out.sort((a, b) => (a.human < 0 ? 1e9 : a.human) - (b.human < 0 ? 1e9 : b.human) || (a.capitalHeld === b.capitalHeld ? 0 : a.capitalHeld ? -1 : 1));
}

// ---------------------------------------------------------------------------------------------------------------
// The plan (the new galaxy, before the empires are founded)
// ---------------------------------------------------------------------------------------------------------------

export interface Age2Placement {
    survivors: SurvivorRec[];
    /** Where new empires keep clear: the Harvest Scars and the old Beacon site. */
    avoid: PlaceRec[];
}

export interface Age2Plan {
    /** The survivors that got a home, with it. A survivor missing here found no free world: it is placed the stock way (identity kept). */
    homes: Map<SurvivorRec, Habitat>;
    /** The home systems taken. */
    claimedSystems: Set<number>;
    /** A new empire's capital must not be here (a survivor's system, within AVOID_SECTORS of a Scar or the old Beacon site). */
    avoids(h: Habitat): boolean;
}

/** The new galaxy's habitat at a recorded position (an exact hit, else the nearest world within a hair). */
function habitatAt(galaxy: Galaxy, byPos: Map<string, Habitat[]>, p: PlaceRec): Habitat | null {
    const exact = byPos.get(`${p.x},${p.y}`);
    if (exact !== undefined) {
        const w = exact.find(isWorld);
        if (w !== undefined) return w;
    }
    let best: Habitat | null = null;
    let bestD = 2000;
    for (const h of galaxy.habitats) {
        if (!isWorld(h)) continue;
        const d = Math.hypot(h.xpos - p.x, h.ypos - p.y);
        if (d < bestD) {
            best = h;
            bestD = d;
        }
    }
    return best;
}

/**
 * Pick every survivor's home in the new galaxy: in claim order (humans, then capital holders), the first recorded world that is a free world
 * (not owned by an empire; the independents' are taken over as the stock capital search does) in a system no survivor has claimed yet. Two
 * survivors in one system: the later one moves to its next-best world. `usable` is the caller's extra test (nebulae). Draws no Rnd.
 */
export function planAge2(galaxy: Galaxy, placement: Age2Placement, usable: (h: Habitat) => boolean = () => true): Age2Plan {
    const byPos = new Map<string, Habitat[]>();
    for (const h of galaxy.habitats) {
        const k = `${h.xpos},${h.ypos}`;
        const l = byPos.get(k);
        if (l === undefined) byPos.set(k, [h]);
        else l.push(h);
    }
    const homes = new Map<SurvivorRec, Habitat>();
    const claimed = new Set<number>();
    for (const s of placement.survivors) {
        for (const p of s.homes) {
            const h = habitatAt(galaxy, byPos, p);
            if (h === null || claimed.has(h.systemIndex) || !usable(h)) continue;
            if (h.empire !== null && h.empire !== galaxy.independentEmpire) continue;
            homes.set(s, h);
            claimed.add(h.systemIndex);
            break;
        }
    }
    const radius = galaxy.sectorSize * AVOID_SECTORS;
    const avoidSites = placement.avoid;
    return {
        homes,
        claimedSystems: claimed,
        avoids: (h) => claimed.has(h.systemIndex) || avoidSites.some((a) => Math.hypot(h.xpos - a.x, h.ypos - a.y) < radius),
    };
}

/**
 * A survivor's home world becomes a normal pre-warp home for its race: the planet type is the race's native one (a colony of Age 1 may have
 * stood on another; the stock colony code redraws type, picture, quality and resources just so). Habitats already of the type are untouched.
 */
export function makeHomeNative(galaxy: Galaxy, h: Habitat, native: HabitatType): void {
    if (h.type === native) return;
    const sel = galaxy.selectPlanetOfType(native);
    h.type = sel.type;
    h.diameter = sel.diameter;
    h.pictureRef = sel.pictureRef;
    h.landscapePictureRef = sel.landscapePictureRef;
    h.baseQuality = galaxy.selectHabitatQuality(h, galaxy.colonyPrevalence);
    h.resources = [];
    galaxy.selectResources(h);
}

/** The new-game options' Age 2 part from a memory record. */
export function age2PlacementOf(survivors: SurvivorRec[] | undefined, scars: PlaceRec[], beaconSite: PlaceRec | null): Age2Placement | undefined {
    if (survivors === undefined) return undefined;
    return { survivors, avoid: beaconSite === null ? scars : [...scars, beaconSite] };
}
