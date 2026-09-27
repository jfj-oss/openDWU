// Scenario package 19g-7 "rim fauna" (tasks/19-mod-layer-scenarios.md §19g item 7, "Rim fauna design") — the herd model,
// its saved state, params and the pure lookups the base-sim query hooks call. Not a port: herds are ordinary ported
// Creature objects (creature.ts, Creature.cs) that this package groups, steers and feeds. Nothing in this file draws
// galaxy.rnd; the draws live in rimFauna.ts (game start / periodic / yearly handlers, all behind the `rimFauna` flag).
//
// 19j (rim herders) plugs in here: RimHerd.id / home range / birth range / docileEmpireIds, rimHerdOfCreature,
// rimHerdDocileTo, setRimHerdDocile, rimHerdFeedingSites.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { BuiltObject } from '../../builtObject';
import type { Creature, CreatureType } from '../../creature';
import { HabitatCategoryType, type Habitat } from '../../types';
import { scenarioParam, scenarioState } from '../state';
import { determineMiningStationAtHabitat } from '../../resourceTargets';

/** Flag name (scenarios/rim-fauna/scenario.json). */
export const RIM_FAUNA_FLAG = 'rimFauna';
/** scenarioState key. */
export const RIM_FAUNA_STATE = 'rimFauna';

/** Manifest defaults (scenario.json) — the fallbacks of scenarioParam. */
export const RIM_FAUNA_PARAM_DEFAULTS = {
    /** Density curve (herds per star system / gas cloud, as an expected count) at radius fraction 0 … the inner radius. */
    rimFaunaDensityCore: 0,
    /** … rising linearly from the inner radius to this value at radius fraction ≥ 1. */
    rimFaunaDensityRim: 0.4,
    /** Radius fraction where the density starts to rise above the core value. */
    rimFaunaDensityInner: 0.55,
    /** Cap on the number of herds spawned at game start. */
    rimFaunaMaxHerds: 40,
    /** Herd size (leader + followers) at spawn: min / max (inclusive), and the size breeding refills to. */
    rimFaunaHerdSizeMin: 4,
    rimFaunaHerdSizeMax: 7,
    /** Yearly chance that a herd below its max size gains one follower. */
    rimFaunaBreedChance: 0.5,
    /** Fraction of every available resource stock in a mining station's hold eaten per feeding tick. */
    rimFaunaFeedRate: 0.1,
    /** Damage (component-size units, Creature.cs DamageTarget scale) dealt to a grazed station per feeding tick. */
    rimFaunaStationDamage: 8,
    /** Weight of a mining-station habitat vs. a bare gas cloud / asteroid when a herd picks its next pasture. */
    rimFaunaStationAttraction: 3,
    /** Home range: radius around the herd's home point it grazes in. */
    rimFaunaHomeRange: 20000,
    /** Migration: max distance of a migration target from the herd's home. */
    rimFaunaMigrationRadius: 600000,
    /** Migration season: day of the year (0-359) the yearly migration starts. */
    rimFaunaMigrationDay: 90,
    /** Chance per herd per season to migrate. */
    rimFaunaMigrationChance: 0.5,
    /** Innermost radius fraction a migration may reach (rim-adjacent territory). */
    rimFaunaMigrationInner: 0.35,
    /** Leader / follower cruise speeds (Creature.MovementSpeed; followers faster so they keep up). */
    rimFaunaLeaderSpeed: 24,
    rimFaunaFollowerSpeed: 34,
    /** Unrest: approval lost per recorded station loss near a colony, and its cap. */
    rimFaunaUnrestPerLoss: 3,
    rimFaunaUnrestMax: 20,
    /** AI: escort priority multiplier / floor (firepower, Empire.5.cs 1331 SortTag scale) for stations under herd pressure. */
    rimFaunaEscortWeight: 2,
    rimFaunaEscortFloor: 30,
} as const;

export type RimFaunaParam = keyof typeof RIM_FAUNA_PARAM_DEFAULTS;

export function faunaParam(galaxy: Galaxy, name: RimFaunaParam): number {
    return scenarioParam(galaxy, name, RIM_FAUNA_PARAM_DEFAULTS[name]);
}

/** Hyper speed of migrating herd members (between Silver Mist 5000 and Ardilus 10000, Creature.cs ctor). 0 otherwise. */
export const HERD_HYPER_SPEED = 6000;
/** Followers' anchor range around the leader (cohesion radius). */
export const HERD_COHESION = 2500;
/** Leader anchor range while grazing a site / resting. */
export const HERD_FEED_RANGE = 1500;
export const HERD_REST_RANGE = 4000;
/** Herd members' attack range around their anchor (a Kaltor's is its anchor range, 600/1200 — Creature.cs ctor). */
export const HERD_ATTACK_RANGE = 1500;
/** Feeding ticks (periodic herd ticks, one per long block ≈ 36 game days) spent on one pasture. */
export const HERD_FEED_TICKS = 3;
/** A station counts as "under herd pressure" for this long after its last loss (star-date ms: one game year). */
export const HERD_PRESSURE_MS = 600000;

/** A migration in progress. */
export interface RimHerdMigration {
    toSystemIndex: number;
    x: number;
    y: number;
    startDate: number;
    /** True when this migration returns the herd to its birth range. */
    homeward: boolean;
}

/** One herd: a leader plus followers (ported Creatures), a home range, its pasture and migration. Saved as plain data. */
export interface RimHerd {
    id: number;
    type: CreatureType;
    leader: Creature | null;
    followers: Creature[];
    /** Home range: centre + radius (the system it grazes). */
    homeSystemIndex: number;
    homeX: number;
    homeY: number;
    homeRange: number;
    /** Birth range (where homeward migrations return). */
    birthSystemIndex: number;
    birthX: number;
    birthY: number;
    /** Current pasture (a gas cloud, asteroid or mining-station habitat), ticks spent there, station being grazed. */
    feedSite: Habitat | null;
    feedTicks: number;
    feedingStation: BuiltObject | null;
    migration: RimHerdMigration | null;
    /** 19j: empires whose ships / colonies / stations this herd leaves alone (herder peoples). */
    docileEmpireIds: number[];
    /** Empires that lost station stock to this herd (told when it is killed). */
    victimEmpireIds: number[];
}

export interface RimFaunaStats {
    herdsSpawned: number;
    migrations: number;
    feedTicks: number;
    stationLosses: number;
    stockEaten: number;
    herdsKilled: number;
    births: number;
}

/** Saved state (`scenarioState(galaxy, 'rimFauna')`): plain data and graph references only. */
export interface RimFaunaState {
    nextHerdId: number;
    herds: RimHerd[];
    /** Game year of the last migration season (-1 = none yet). */
    lastMigrationYear: number;
    /** Local unrest term (see rimFaunaUnrest): colony → accumulated station losses (halved yearly). */
    unrest: { colony: Habitat; losses: number }[];
    /** Stations under herd pressure (AI escort hook): last loss star date. */
    pressured: { station: BuiltObject; lastLoss: number }[];
    /** Bumped whenever herd membership changes (lookup cache key). */
    rev: number;
    stats: RimFaunaStats;
}

export function rimFaunaState(galaxy: Galaxy): RimFaunaState {
    return scenarioState<RimFaunaState>(galaxy, RIM_FAUNA_STATE, () => ({
        nextHerdId: 1,
        herds: [],
        lastMigrationYear: -1,
        unrest: [],
        pressured: [],
        rev: 0,
        stats: { herdsSpawned: 0, migrations: 0, feedTicks: 0, stationLosses: 0, stockEaten: 0, herdsKilled: 0, births: 0 },
    }));
}

/** The state if the package has run in this game (never creates it: safe from pure query handlers). */
export function peekRimFaunaState(galaxy: Galaxy): RimFaunaState | null {
    const s = galaxy.scenario;
    if (s === null || !(RIM_FAUNA_STATE in s.state)) return null;
    return s.state[RIM_FAUNA_STATE] as RimFaunaState;
}

/** Density curve: expected herds per system at radius fraction `f` (core below the inner radius, linear to the rim). */
export function herdDensityAt(galaxy: Galaxy, f: number): number {
    const core = faunaParam(galaxy, 'rimFaunaDensityCore');
    const rim = faunaParam(galaxy, 'rimFaunaDensityRim');
    const inner = faunaParam(galaxy, 'rimFaunaDensityInner');
    if (f <= inner) return core;
    if (inner >= 1) return rim;
    const t = Math.min(1, (f - inner) / (1 - inner));
    return core + (rim - core) * t;
}

/** Every living member of a herd, leader first. */
export function herdMembers(herd: RimHerd): Creature[] {
    return herd.leader === null ? [...herd.followers] : [herd.leader, ...herd.followers];
}

/** A ported creature still in play (not destroyed, still in Galaxy.Creatures). */
export function creatureAlive(galaxy: Galaxy, c: Creature): boolean {
    return !c.hasBeenDestroyed && galaxy.creatures.includes(c);
}

const herdIndexCache = new WeakMap<Galaxy, { rev: number; herds: RimHerd[]; map: Map<Creature, RimHerd> }>();

/** 19j: the herd a creature belongs to (null: not a herd member / no rim fauna in this game). No Rnd, no writes. */
export function rimHerdOfCreature(galaxy: Galaxy, c: Creature): RimHerd | null {
    const st = peekRimFaunaState(galaxy);
    if (st === null) return null;
    let cache = herdIndexCache.get(galaxy);
    if (cache === undefined || cache.rev !== st.rev || cache.herds !== st.herds) {
        const map = new Map<Creature, RimHerd>();
        for (const h of st.herds) for (const m of herdMembers(h)) map.set(m, h);
        cache = { rev: st.rev, herds: st.herds, map };
        herdIndexCache.set(galaxy, cache);
    }
    return cache.map.get(c) ?? null;
}

/** 19j: true when the herd leaves `empire`'s ships, colonies and stations alone. */
export function rimHerdDocileTo(herd: RimHerd, empire: Empire | null): boolean {
    return empire !== null && herd.docileEmpireIds.includes(empire.empireId);
}

/** 19j: makes a herd docile (or not) toward an empire (herder race colonies / drovers). */
export function setRimHerdDocile(galaxy: Galaxy, herd: RimHerd, empireId: number, docile: boolean): void {
    const i = herd.docileEmpireIds.indexOf(empireId);
    if (docile && i < 0) herd.docileEmpireIds.push(empireId);
    else if (!docile && i >= 0) herd.docileEmpireIds.splice(i, 1);
    void galaxy;
}

/** The mining station (Galaxy.7.cs DetermineMiningStationAtHabitat) at a habitat, if it is live and owned. */
export function stationAt(habitat: Habitat): BuiltObject | null {
    const bo = determineMiningStationAtHabitat(habitat) as BuiltObject | null;
    return bo !== null && !bo.hasBeenDestroyed && bo.empire !== null ? bo : null;
}

/**
 * 19j / feeding: the pastures inside a herd's home range — gas clouds, asteroids, and any habitat with a mining station
 * of an empire the herd is not docile to. Stable order (system habitat order). No Rnd.
 */
export function rimHerdFeedingSites(galaxy: Galaxy, herd: RimHerd): Habitat[] {
    const sys = galaxy.systems[herd.homeSystemIndex];
    if (sys === undefined) return [];
    const r2 = herd.homeRange * herd.homeRange;
    const out: Habitat[] = [];
    const consider = (h: Habitat): void => {
        if (h.hasBeenDestroyed) return;
        if (galaxy.calculateDistanceSquared(h.xpos, h.ypos, herd.homeX, herd.homeY) > r2) return;
        if (h.category === HabitatCategoryType.GasCloud || h.category === HabitatCategoryType.Asteroid) {
            out.push(h);
            return;
        }
        const st = stationAt(h);
        if (st !== null && !rimHerdDocileTo(herd, st.empire)) out.push(h);
    };
    if (sys.systemStar.category === HabitatCategoryType.GasCloud) consider(sys.systemStar);
    for (const h of galaxy.systemHabitatsOf(herd.homeSystemIndex)) consider(h);
    return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Pure query-hook bodies (hooks.ts ScenarioQueries; never draw, never write)
// ---------------------------------------------------------------------------------------------------------------

/** extractionBlocked: a station a herd is grazing extracts nothing (industry.ts, BuiltObject.2.cs 7859 block). */
export function rimFaunaStationBlocked(galaxy: Galaxy, bo: BuiltObject): boolean {
    const st = peekRimFaunaState(galaxy);
    if (st === null) return false;
    for (const h of st.herds) if (h.feedingStation === bo) return true;
    return false;
}

/**
 * Local unrest term ("rim fauna unrest"): approval lost at a colony for the station losses charged to it. 19d2 owns the
 * full crisis plumbing (unrest → rebellion); this is only an additive empireApprovalRating term. TODO(19d2): route it
 * through the crisis unrest pool once 19d2 lands, and drop this term.
 */
export function rimFaunaUnrest(galaxy: Galaxy, colony: Habitat): number {
    const st = peekRimFaunaState(galaxy);
    if (st === null || st.unrest.length === 0) return 0;
    const row = st.unrest.find((u) => u.colony === colony);
    if (row === undefined) return 0;
    return Math.min(faunaParam(galaxy, 'rimFaunaUnrestMax'), faunaParam(galaxy, 'rimFaunaUnrestPerLoss') * row.losses);
}

/** True when `station` is being grazed or lost stock to a herd within the last year. */
export function rimFaunaStationUnderPressure(galaxy: Galaxy, station: BuiltObject, now: number): boolean {
    const st = peekRimFaunaState(galaxy);
    if (st === null) return false;
    if (st.herds.some((h) => h.feedingStation === station)) return true;
    const p = st.pressured.find((x) => x.station === station);
    return p !== undefined && now - p.lastLoss <= HERD_PRESSURE_MS;
}

/** miningStationPatrolPriority: stations under herd pressure get a larger wanted escort (Empire.5.cs 1331 SortTag). */
export function rimFaunaPatrolPriority(galaxy: Galaxy, station: BuiltObject, value: number, now: number): number {
    if (!rimFaunaStationUnderPressure(galaxy, station, now)) return value;
    return Math.max(value * faunaParam(galaxy, 'rimFaunaEscortWeight'), faunaParam(galaxy, 'rimFaunaEscortFloor'));
}
