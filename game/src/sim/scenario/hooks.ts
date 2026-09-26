// Scenario hook points (tasks/MODLAYER-DESIGN.md §4). Not a port. Each hook is a no-op unless the game runs a scenario
// that asks for it, so the faithful game's state and Galaxy.Rnd stream are untouched when no scenario is chosen.
//
// Rnd policy: scenario code draws from galaxy.rnd only inside its own hooks (a yearly handler, a generation rule of its
// manifest, and what those call). With no scenario, no rule and no handler, none of these draw.

import type { Galaxy } from '../galaxy';
import type { Race } from '../data/races';
import type { Habitat } from '../types';
import { YEAR_LENGTH } from '../galaxyTime';
import { galaxyStarDate } from '../tick/simTime';

// ---------------------------------------------------------------------------
// Yearly scenario tick
// ---------------------------------------------------------------------------

/** A yearly handler a scenario package registers at module load. */
export interface ScenarioYearlyHandler {
    /** Unique id (e.g. "darkFarms.spawn"); ties in `order` run in id order. */
    id: string;
    /** Run order among handlers (lower first; default 0). */
    order?: number;
    /** Only runs when this scenario flag is on (omitted: no flag gate). */
    flag?: string;
    /** Only runs in this scenario (omitted: any scenario). A handler needs `flag` or `scenarioId`; an ungated one never runs. */
    scenarioId?: string;
    /** `year` = the game year that just began (floor(starDate / YEAR_LENGTH)). May draw galaxy.rnd. */
    run: (galaxy: Galaxy, year: number) => void;
}

const yearlyHandlers: ScenarioYearlyHandler[] = [];

/** Registers (or replaces, by id) a yearly handler. Returns an unregister function (tests). */
export function registerScenarioYearly(handler: ScenarioYearlyHandler): () => void {
    const i = yearlyHandlers.findIndex((h) => h.id === handler.id);
    if (i >= 0) yearlyHandlers.splice(i, 1);
    yearlyHandlers.push(handler);
    yearlyHandlers.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return () => {
        const j = yearlyHandlers.indexOf(handler);
        if (j >= 0) yearlyHandlers.splice(j, 1);
    };
}

/** The game year of a star date. */
export function gameYear(starDate: number): number {
    return Math.floor(starDate / YEAR_LENGTH);
}

/**
 * The yearly scenario tick, called once per Galaxy.DoTasks long block (galaxyTick.ts, after CheckVictoryConditions).
 * The first call anchors the current year; afterwards every handler whose gate passes runs once per new game year (if
 * several years passed at once — never at normal speeds — it runs once, for the latest year).
 */
export function scenarioYearlyTick(galaxy: Galaxy): void {
    const s = galaxy.scenario;
    if (s === null) return;
    const year = gameYear(galaxyStarDate(galaxy));
    if (s.lastYear < 0) {
        s.lastYear = year;
        return;
    }
    if (year <= s.lastYear) return;
    s.lastYear = year;
    for (const h of [...yearlyHandlers]) {
        if (h.scenarioId !== undefined && h.scenarioId !== s.id) continue;
        if (h.flag !== undefined && s.flags[h.flag] !== true) continue;
        if (h.scenarioId === undefined && h.flag === undefined) continue; // an ungated handler would run in every scenario
        h.run(galaxy, year);
    }
}

// ---------------------------------------------------------------------------
// Placement (generation)
// ---------------------------------------------------------------------------

/** Distance of (x, y) from the galaxy centre as a fraction of sizeX / 2 (the scale randomPointInRing uses). */
export function radiusFraction(galaxy: Galaxy, x: number, y: number): number {
    const cx = galaxy.sizeX / 2.0;
    const cy = galaxy.sizeY / 2.0;
    return Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy)) / cx;
}

/**
 * Resource placement hook (Galaxy.selectResources' resource loop): false when a scenario rule keeps `resourceId` off
 * this habitat. True (no effect) with no scenario or no rule for the resource.
 */
export function scenarioResourceAllowed(galaxy: Galaxy, habitat: Habitat, resourceId: number): boolean {
    const s = galaxy.scenario;
    if (s === null || s.resourceRules.length === 0) return true;
    for (const r of s.resourceRules) {
        if (r.resourceId !== resourceId) continue;
        const f = radiusFraction(galaxy, habitat.xpos, habitat.ypos);
        return f >= r.minRadius && f <= r.maxRadius;
    }
    return true;
}

/** Game-start helpers game.ts passes in (its private ports), so this module does not import game.ts. */
export interface HomePlacementHelpers {
    randomPointInRing: (galaxy: Galaxy, min: number, max: number) => { x: number; y: number };
    inNebula: (galaxy: Galaxy, habitat: Habitat) => boolean;
}

/** The home-placement ring a scenario sets for `race`, or null (no scenario / no rule). */
export function scenarioHomeRing(galaxy: Galaxy, race: Race): { minRadius: number; maxRadius: number } | null {
    const s = galaxy.scenario;
    if (s === null || s.manifest === null || s.manifest.homePlacement.length === 0) return null;
    const rule = s.manifest.homePlacement.find((r) => r.race.toLowerCase() === race.name.toLowerCase());
    return rule === undefined ? null : { minRadius: rule.minRadius, maxRadius: rule.maxRadius };
}

/**
 * Home-system placement hook (createGame, before the stock capital search): when the scenario has a homePlacement rule
 * for `race`, an uncolonized `habitatType` habitat in the ring, outside nebulae, in a system with no empire colony,
 * with at least `minPlanets` planets, and away from other colonies (`minColonyDistance`). Up to 200 tries (draws
 * galaxy.rnd: randomPointInRing per try). null = no rule, or nothing found (the caller then runs the stock search).
 */
export function scenarioFindHomeHabitat(
    galaxy: Galaxy,
    race: Race,
    habitatType: Habitat['type'],
    helpers: HomePlacementHelpers,
    minColonyDistance: number,
    minPlanets = 3,
): Habitat | null {
    const ring = scenarioHomeRing(galaxy, race);
    if (ring === null) return null;
    let fallback: Habitat | null = null;
    for (let tries = 0; tries < 200; tries++) {
        const p = helpers.randomPointInRing(galaxy, ring.minRadius, ring.maxRadius);
        const h = galaxy.findNearestUncolonizedHabitat(p.x, p.y, habitatType);
        if (h === null || helpers.inNebula(galaxy, h)) continue;
        const f = radiusFraction(galaxy, h.xpos, h.ypos);
        if (f < ring.minRadius || f > ring.maxRadius) continue;
        const star = galaxy.determineHabitatSystemStar(h);
        if (galaxy.systemHabitatsOf(star.systemIndex).some((x) => x.empire !== null && x.empire !== galaxy.independentEmpire)) continue;
        const near = galaxy.findNearestColony(h.xpos, h.ypos, null, false);
        if (near !== null && galaxy.calculateDistance(h.xpos, h.ypos, near.xpos, near.ypos) < minColonyDistance) continue;
        if (galaxy.systemPlanetCount(galaxy.systems[star.systemIndex]) < minPlanets) {
            fallback ??= h;
            continue;
        }
        return h;
    }
    return fallback;
}
