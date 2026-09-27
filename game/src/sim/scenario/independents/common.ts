// Scenario package 19k items 2-3 "independents as actors" + "independent leagues" (tasks/19-mod-layer-scenarios.md §19k)
// — the saved model, params and the pure lookups / hand-off hooks. Not a port: it extends the ported independents
// (Galaxy.7.cs 4354 GenerateIndependentTraders: freighters scaled by population) with a militia, construction ships
// and mining stations, and groups them into leagues. Nothing in this file draws galaxy.rnd.
//
// Hand-offs: independentStationFriction(galaxy, owner, empire, station) — raised when an independent station's system is
// claimed by another empire (no-op default; 19l's border friction binds it with registerIndependentStationFriction).
// rimTradingBlocs(galaxy) — leagues on the rim that the 19a Concord may treat as a trading bloc (hook only).

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { BuiltObject } from '../../builtObject';
import type { Habitat } from '../../types';
import type { ShipGroup } from '../../fleets/shipGroup';
import { scenarioFlag, scenarioParam, scenarioState } from '../state';
import { radiusFraction } from '../hooks';

export const ACTORS_FLAG = 'independentActors';
export const LEAGUES_FLAG = 'independentLeagues';
export const INDEPENDENTS_STATE = 'independents';

/** Galaxy.3.cs SectorSize (params in sectors). */
export const SECTOR_SIZE = 2_000_000;
/** Population per militia warship (the freighter rule's divisor is 20,000,000 per freighter; warships are rarer). */
export const POP_PER_WARSHIP = 1_000_000_000;
/** Population per mining station beyond the first. */
export const POP_PER_STATION = 2_000_000_000;
/** A colony at least this populous counts as prosperous (league trigger). */
export const PROSPEROUS_POP = 3_000_000_000;
/** A raid / expansion / herd loss keeps a colony under threat this many game days. */
export const THREAT_DAYS = 360;
/** Arrival distance of a construction / colony ship at its target. */
export const ARRIVE_RANGE = 6000;
/** Jobs abandoned after this many game days without arriving. */
export const JOB_TIMEOUT_DAYS = 720;
/** Yearly scenario-side income of one independent station (bookkeeping only; the independent empire's money is unbounded). */
export const STATION_INCOME = 500;
/** League standing: yearly gain of a peaceful neighbour, loss per raid, offer and acceptance thresholds, pull bonus. */
export const STANDING_NEIGHBOUR = 10;
export const STANDING_RAID = 20;
export const STANDING_OFFER = 30;
export const STANDING_ACCEPT = 20;
export const PULL_BONUS = 25;
/** League cohesion: start, yearly drift without threat / prosperity, gain when threatened. */
export const COHESION_START = 100;
export const COHESION_DRIFT = 10;

export const INDEPENDENTS_PARAM_DEFAULTS = {
    independentActorsStationRadius: 0.5,
    independentActorsStationsPerColony: 2,
    independentActorsFleetCap: 3,
    independentActorsMilitiaDays: 90,
    independentLeaguesRadius: 1.0,
    independentLeaguesMinMembers: 2,
    independentLeaguesChance: 0.25,
    independentLeaguesFleetMultiplier: 1.5,
    independentLeaguesOneColony: 1,
    independentLeaguesPullChance: 0.6,
    /** §19k tech-follow addendum: the fraction (0-100) of the galaxy's median regular-empire tech level the
     *  independent empire tracks — see refreshIndependentTech (independents.ts). */
    independentTechFollowPct: 60,
    /** §19k tech-follow addendum: how often (game years) the tech-follow check runs. */
    independentTechRefreshYears: 2,
} as const;
export type IndependentsParam = keyof typeof INDEPENDENTS_PARAM_DEFAULTS;

export function indParam(galaxy: Galaxy, name: IndependentsParam): number {
    return scenarioParam(galaxy, name, INDEPENDENTS_PARAM_DEFAULTS[name]);
}

/** One independent colony as an actor (saved; plain data and graph references). */
export interface IndependentActor {
    colony: Habitat;
    /** 'active' while the independent empire holds the colony. */
    status: 'active' | 'lost';
    /** Militia warships (independent state ships). */
    fleet: BuiltObject[];
    group: ShipGroup | null;
    /** The colony's construction ship and its current job. */
    builder: BuiltObject | null;
    jobHabitat: Habitat | null;
    jobSince: number;
    /** Mining stations it placed. */
    stations: BuiltObject[];
    /** Threats: raids (attacker, date), last expansion of a neighbour, last herd loss (star dates; 0 = none). */
    raids: { attacker: BuiltObject; empireId: number; date: number; answered: boolean }[];
    lastExpansion: number;
    lastHerdLoss: number;
    /** League id (-1 = isolated). */
    leagueId: number;
    /** Scenario-side income tally (stations; shared inside a league). */
    income: number;
    shipsBuilt: number;
}

export type LeagueStatus = 'active' | 'dissolved' | 'joined';

/** A league: a named sub-faction of the independent empire (members stay independent colonies). */
export interface IndependentLeague {
    id: number;
    name: string;
    /** League flag: colour (0xRRGGBB) and flag shape (the founder race's default flag design). */
    colour: number;
    flagShape: number;
    /** Council seat. */
    founder: Habitat;
    members: Habitat[];
    status: LeagueStatus;
    formedDate: number;
    cohesion: number;
    /** Goodwill toward each empire (by empireId). */
    standing: Record<number, number>;
    /** Empires offered talks (once each) and trade partners. */
    offered: number[];
    tradePartners: number[];
    /** The one extra colony: sent (never again once true), its ship, target and the founded colony. */
    extraSent: boolean;
    colonyShip: BuiltObject | null;
    colonyTarget: Habitat | null;
    colonySince: number;
    extraColony: Habitat | null;
    /** Protectorate outcome. */
    protectorId: number;
    protectorateEmpireId: number;
    /** 19a hook: a rim league the Concord may treat as a trading bloc. */
    tradeBloc: boolean;
}

export interface FrictionRecord {
    station: BuiltObject;
    colony: Habitat | null;
    empireId: number;
    status: 'pending' | 'buyout' | 'tolerate' | 'clear';
    date: number;
}

export interface IndependentsStats {
    militiaBuilt: number;
    militiaRefreshed: number;
    constructorsBuilt: number;
    stationsBuilt: number;
    raidsAnswered: number;
    frictions: number;
    buyouts: number;
    tolerated: number;
    cleared: number;
    leaguesFormed: number;
    leaguesDissolved: number;
    extraColonies: number;
    protectorates: number;
    splits: number;
    tradeDeals: number;
    /** §19k tech-follow addendum: refreshIndependentTech calls that actually raised the tech level. */
    techRefreshes: number;
}

export interface IndependentsState {
    actors: IndependentActor[];
    leagues: IndependentLeague[];
    friction: FrictionRecord[];
    nextLeagueId: number;
    lastMilitia: number;
    /** §19k tech-follow addendum: star date of the last refreshIndependentTech check (independentTechRefreshYears). */
    lastTechRefresh: number;
    started: boolean;
    stats: IndependentsStats;
}

export function independentsState(galaxy: Galaxy): IndependentsState {
    return scenarioState<IndependentsState>(galaxy, INDEPENDENTS_STATE, () => ({
        actors: [],
        leagues: [],
        friction: [],
        nextLeagueId: 1,
        lastMilitia: -1,
        lastTechRefresh: -1,
        started: false,
        stats: {
            militiaBuilt: 0, militiaRefreshed: 0, constructorsBuilt: 0, stationsBuilt: 0, raidsAnswered: 0, frictions: 0, buyouts: 0, tolerated: 0,
            cleared: 0, leaguesFormed: 0, leaguesDissolved: 0, extraColonies: 0, protectorates: 0, splits: 0, tradeDeals: 0, techRefreshes: 0,
        },
    }));
}

export function peekIndependentsState(galaxy: Galaxy): IndependentsState | null {
    const s = galaxy.scenario;
    if (s === null || !(INDEPENDENTS_STATE in s.state)) return null;
    return s.state[INDEPENDENTS_STATE] as IndependentsState;
}

export function actorOf(galaxy: Galaxy, colony: Habitat): IndependentActor | null {
    return peekIndependentsState(galaxy)?.actors.find((a) => a.colony === colony) ?? null;
}

export function leagueById(galaxy: Galaxy, id: number): IndependentLeague | null {
    if (id < 0) return null;
    return peekIndependentsState(galaxy)?.leagues.find((l) => l.id === id) ?? null;
}

/** The active league a colony belongs to (null: isolated). */
export function leagueOf(galaxy: Galaxy, colony: Habitat): IndependentLeague | null {
    const a = actorOf(galaxy, colony);
    const l = a === null ? null : leagueById(galaxy, a.leagueId);
    return l !== null && l.status === 'active' ? l : null;
}

export function activeLeagues(galaxy: Galaxy): IndependentLeague[] {
    return peekIndependentsState(galaxy)?.leagues.filter((l) => l.status === 'active') ?? [];
}

/** 19a hook: the active rim leagues that trade with the Concord as a bloc (only with the rimTrader flag on). */
export function rimTradingBlocs(galaxy: Galaxy): IndependentLeague[] {
    if (!scenarioFlag(galaxy, 'rimTrader')) return [];
    return activeLeagues(galaxy).filter((l) => l.tradeBloc);
}

/** Rim test of a league for the 19a hook (19a's RIM_MIN_RADIUS). */
export function leagueOnRim(galaxy: Galaxy, league: IndependentLeague): boolean {
    return radiusFraction(galaxy, league.founder.xpos, league.founder.ypos) >= 0.72;
}

// ---------------------------------------------------------------------------------------------------------------
// Friction hook (19l binds it)
// ---------------------------------------------------------------------------------------------------------------

export type StationFrictionHandler = (galaxy: Galaxy, owner: Empire, empire: Empire, station: BuiltObject) => void;

function frictionHandlers(): StationFrictionHandler[] {
    // A hoisted function's own property (decisions.ts pattern): safe to call mid import cycle.
    const f = frictionHandlers as unknown as { list?: StationFrictionHandler[] };
    return (f.list ??= []);
}

/** Binds a border-friction consumer (19l). Returns an unregister function. */
export function registerIndependentStationFriction(fn: StationFrictionHandler): () => void {
    const list = frictionHandlers();
    list.push(fn);
    return () => {
        const i = list.indexOf(fn);
        if (i >= 0) list.splice(i, 1);
    };
}

/** An independent station sits in a system `empire` now claims (no-op unless a consumer is bound). */
export function independentStationFriction(galaxy: Galaxy, owner: Empire, empire: Empire, station: BuiltObject): void {
    for (const fn of [...frictionHandlers()]) fn(galaxy, owner, empire, station);
}
