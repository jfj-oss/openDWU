// Scenario hook points (tasks/MODLAYER-DESIGN.md §4). Not a port. Each hook is a no-op unless the game runs a scenario
// that asks for it, so the faithful game's state and Galaxy.Rnd stream are untouched when no scenario is chosen.
//
// Rnd policy: scenario code draws from galaxy.rnd only inside its own hooks (a yearly handler, a generation rule of its
// manifest, and what those call). With no scenario, no rule and no handler, none of these draw.

import type { Galaxy } from '../galaxy';
import type { Race } from '../data/races';
import type { Habitat } from '../types';
import type { Empire } from '../empire';
import type { BuiltObject } from '../builtObject';
import { YEAR_LENGTH } from '../galaxyTime';
import { galaxyStarDate } from '../tick/simTime';

// ---------------------------------------------------------------------------
// Handler registries (shared gate)
// ---------------------------------------------------------------------------

/** Gate shared by every scenario handler. A handler needs `flag` or `scenarioId`; an ungated one never runs. */
export interface ScenarioHandlerGate {
    /** Unique id per registry (e.g. "darkFarms.spawn"); ties in `order` run in id order. Re-registering an id replaces it. */
    id: string;
    /** Run order among handlers of the same registry (lower first; default 0). */
    order?: number;
    /** Only runs when this scenario flag is on (omitted: no flag gate). */
    flag?: string;
    /** Only runs in this scenario (omitted: any scenario). */
    scenarioId?: string;
}

function register<T extends ScenarioHandlerGate>(list: T[], handler: T): () => void {
    const i = list.findIndex((h) => h.id === handler.id);
    if (i >= 0) list.splice(i, 1);
    list.push(handler);
    list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return () => {
        const j = list.indexOf(handler);
        if (j >= 0) list.splice(j, 1);
    };
}

/** True when `h` may run in this galaxy's scenario. */
export function scenarioGateOpen(galaxy: Galaxy, h: ScenarioHandlerGate): boolean {
    const s = galaxy.scenario;
    if (s === null) return false;
    if (h.scenarioId === undefined && h.flag === undefined) return false;
    if (h.scenarioId !== undefined && h.scenarioId !== s.id) return false;
    if (h.flag !== undefined && s.flags[h.flag] !== true) return false;
    return true;
}

// ---------------------------------------------------------------------------
// Yearly / periodic scenario ticks
// ---------------------------------------------------------------------------

/** A yearly handler a scenario package registers at module load. */
export interface ScenarioYearlyHandler extends ScenarioHandlerGate {
    /** `year` = the game year that just began (floor(starDate / YEAR_LENGTH)). May draw galaxy.rnd. */
    run: (galaxy: Galaxy, year: number) => void;
}

/** A periodic handler: runs every `periodDays` game days (a game day = YEAR_LENGTH / 360: 12 months of 30 days). */
export interface ScenarioPeriodicHandler extends ScenarioHandlerGate {
    periodDays: number;
    /** `starDate` = the current star date. May draw galaxy.rnd. */
    run: (galaxy: Galaxy, starDate: number) => void;
}

/** Star-date ms per game day (ResolveStarDateDescription: 12 months of 30 days). */
export const GAME_DAY_LENGTH = YEAR_LENGTH / 360;

const yearlyHandlers: ScenarioYearlyHandler[] = [];
const periodicHandlers: ScenarioPeriodicHandler[] = [];

/** Registers (or replaces, by id) a yearly handler. Returns an unregister function (tests). */
export function registerScenarioYearly(handler: ScenarioYearlyHandler): () => void {
    return register(yearlyHandlers, handler);
}

/** Registers (or replaces, by id) a periodic handler. Returns an unregister function (tests). */
export function registerScenarioPeriodic(handler: ScenarioPeriodicHandler): () => void {
    if (!(handler.periodDays > 0)) throw new Error(`registerScenarioPeriodic(${handler.id}): periodDays must be > 0`);
    return register(periodicHandlers, handler);
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
        if (scenarioGateOpen(galaxy, h)) h.run(galaxy, year);
    }
}

/**
 * The periodic scenario tick (same call site, right after the yearly one; the long block runs every 60 game seconds =
 * 36 game days at 1x, so a period shorter than that runs once per long block). Per handler: the first call with its
 * gate open anchors it (GalaxyScenario.periodicLast[id] = now); afterwards it runs when periodDays have passed since
 * its last run.
 */
export function scenarioPeriodicTick(galaxy: Galaxy): void {
    const s = galaxy.scenario;
    if (s === null) return;
    const now = galaxyStarDate(galaxy);
    for (const h of [...periodicHandlers]) {
        if (!scenarioGateOpen(galaxy, h)) continue;
        const last = s.periodicLast[h.id];
        if (last === undefined) {
            s.periodicLast[h.id] = now;
            continue;
        }
        if (now - last < h.periodDays * GAME_DAY_LENGTH) continue;
        s.periodicLast[h.id] = now;
        h.run(galaxy, now);
    }
}

// ---------------------------------------------------------------------------
// Game start
// ---------------------------------------------------------------------------

/** Game-start helpers game.ts passes in (its private ports), so this module does not import game.ts. */
export interface HomePlacementHelpers {
    randomPointInRing: (galaxy: Galaxy, min: number, max: number) => { x: number; y: number };
    inNebula: (galaxy: Galaxy, habitat: Habitat) => boolean;
}

/** Runs once at the end of createGame (after every stock start step, before the first scheduler frame). May draw. */
export interface ScenarioGameStartHandler extends ScenarioHandlerGate {
    run: (galaxy: Galaxy, ctx: HomePlacementHelpers) => void;
}

const gameStartHandlers: ScenarioGameStartHandler[] = [];

export function registerScenarioGameStart(handler: ScenarioGameStartHandler): () => void {
    return register(gameStartHandlers, handler);
}

/** createGame's last step when the game has a scenario. */
export function scenarioGameStart(galaxy: Galaxy, ctx: HomePlacementHelpers): void {
    if (galaxy.scenario === null) return;
    for (const h of [...gameStartHandlers]) {
        if (scenarioGateOpen(galaxy, h)) h.run(galaxy, ctx);
    }
}

// ---------------------------------------------------------------------------
// Events (scenarioEmit) and queries (scenarioQuery)
// ---------------------------------------------------------------------------

/**
 * Base-sim events. Each emit site is one line guarded by `galaxy.scenario !== null` placed after the stock code, so
 * with no scenario nothing is built or called. Event handlers may draw galaxy.rnd (their gate is on).
 */
export interface ScenarioEvents {
    /** combat/ownership.ts takeOwnershipOfColonyFull (end; covers conquest, independents absorbed, secession). */
    colonyOwnerChanged: { colony: Habitat; from: Empire | null; to: Empire | null };
    /** A new colony founded by a colony ship (missions: colonize). */
    colonyFounded: { colony: Habitat; empire: Empire };
    /** combat/ownership.ts takeOwnershipOfBuiltObject (end). */
    builtObjectOwnerChanged: { builtObject: BuiltObject; from: Empire | null; to: Empire | null };
    /** A ship or base finished construction (construction yard completion). */
    builtObjectBuilt: { builtObject: BuiltObject; empire: Empire | null };
    /** combat/teardown.ts builtObjectCompleteTeardown (top). */
    builtObjectRemoved: { builtObject: BuiltObject };
    /** combat/damage.ts inflictBombardDamage (end). */
    habitatBombarded: { builtObject: BuiltObject; habitat: Habitat; bombardPower: number };
    /** espionage.ts completeIntelligenceMission (end). */
    intelMissionCompleted: { empire: Empire; mission: unknown; outcome: unknown };
    /** events.ts empireCompleteTeardown (top). */
    empireEliminated: { empire: Empire; conqueror: Empire | null };
    /** researchTick.ts doResearchBreakthrough (end). */
    researchCompleted: { empire: Empire; project: unknown };
    /** characters.ts generateNewCharacter (end). */
    characterCreated: { character: unknown; empire: Empire };
    /** combat/ownership.ts investigateAbandonedBuiltObject (end). */
    abandonedShipClaimed: { builtObject: BuiltObject; empire: Empire };
    /** A diplomatic relation changed type (diplomacyTick changeDiplomaticRelation, end): war declared, treaty signed, ... */
    diplomaticRelationChanged: { empire: Empire; other: Empire; from: number; to: number };
    /** A disaster event hit a colony (events.ts). */
    disaster: { empire: Empire | null; habitat: Habitat | null; disasterType: number };
    /** logistics/contracts.ts initiateContract (end): a private/state sale (no Rnd in handlers — 19e-9 contract rule). */
    contractInitiated: {
        seller: Empire;
        buyer: Empire;
        sellingPoint: unknown;
        destination: unknown;
        resourceId: number;
        componentId: number;
        amount: number;
        value: number;
        isState: boolean;
        freighter: BuiltObject | null;
    };
}
export type ScenarioEventName = keyof ScenarioEvents;

export interface ScenarioEventHandler<E extends ScenarioEventName = ScenarioEventName> extends ScenarioHandlerGate {
    event: E;
    run: (galaxy: Galaxy, payload: ScenarioEvents[E]) => void;
}

const eventHandlers: ScenarioEventHandler[] = [];

export function registerScenarioEvent<E extends ScenarioEventName>(handler: ScenarioEventHandler<E>): () => void {
    return register(eventHandlers, handler as unknown as ScenarioEventHandler);
}

/** Delivers an event to the gated handlers subscribed to it (no-op without a scenario). */
export function scenarioEmit<E extends ScenarioEventName>(galaxy: Galaxy, event: E, payload: ScenarioEvents[E]): void {
    if (galaxy.scenario === null) return;
    for (const h of [...eventHandlers]) {
        if (h.event === event && scenarioGateOpen(galaxy, h)) (h.run as (g: Galaxy, p: ScenarioEvents[E]) => void)(galaxy, payload);
    }
}

/**
 * Query hooks: a stock value a scenario may adjust. Each site is `if (galaxy.scenario !== null) v = scenarioQuery(...)`
 * after the stock computation. Query handlers never draw galaxy.rnd and must be pure (the value may be asked any number
 * of times).
 */
export interface ScenarioQueries {
    /** taxes.ts empireApprovalRating(h) (Habitat.cs approval of its empire): the rating; an additive term goes here. */
    empireApprovalRating: { value: number; args: { habitat: Habitat; empire: Empire | null } };
    /** diplomacyTick.ts declareWar (Empire.7.cs 4883), first line: true blocks the declaration (19c charter war rules). */
    declareWarBlocked: { value: boolean; args: { empire: Empire; target: Empire } };
    /**
     * logistics/freight.ts addForeignTradingPosts (Empire.4.cs 540-576): `undefined` = stock posts; otherwise the only
     * trading post `empire` may use at `other` (null: none) — 19c companyHqExportOnly.
     */
    foreignTradingPosts: { value: BuiltObject | null | undefined; args: { empire: Empire; other: Empire } };
}
export type ScenarioQueryName = keyof ScenarioQueries;

export interface ScenarioQueryHandler<Q extends ScenarioQueryName = ScenarioQueryName> extends ScenarioHandlerGate {
    query: Q;
    run: (galaxy: Galaxy, value: ScenarioQueries[Q]['value'], args: ScenarioQueries[Q]['args']) => ScenarioQueries[Q]['value'];
}

const queryHandlers: ScenarioQueryHandler[] = [];

export function registerScenarioQuery<Q extends ScenarioQueryName>(handler: ScenarioQueryHandler<Q>): () => void {
    return register(queryHandlers, handler as unknown as ScenarioQueryHandler);
}

/** Folds the gated handlers of `query` over the stock value (returns it unchanged without a scenario / handler). */
export function scenarioQuery<Q extends ScenarioQueryName>(galaxy: Galaxy, query: Q, value: ScenarioQueries[Q]['value'], args: ScenarioQueries[Q]['args']): ScenarioQueries[Q]['value'] {
    if (galaxy.scenario === null) return value;
    let v = value;
    for (const h of queryHandlers) {
        if (h.query === query && scenarioGateOpen(galaxy, h)) v = (h.run as ScenarioQueryHandler<Q>['run'])(galaxy, v, args);
    }
    return v;
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
