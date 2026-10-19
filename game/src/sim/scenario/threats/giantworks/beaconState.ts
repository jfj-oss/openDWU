// The Beacon (Giantworks wonder, flag gwBeacon): saved state, parameters and the small helpers its three modules share
// (beacon.ts: the Watchers and the build; beaconFleet.ts: the Reclamation; beaconCounter.ts: counterplay and the dark bargain).
// Not a port. Plain data only (the scenario save codec): arrays and records, graph references to the galaxy's objects.
//
// Rnd (§0.4): the Beacon draws galaxy.rnd only through the stock functions it calls (ship / design / character
// generation). Its own decisions come from a salted private Random (beaconRandom) seeded from the galaxy seed and a
// counter kept in the state, so they never disturb the faithful draw stream.

import type { Galaxy } from '../../../galaxy';
import type { Empire } from '../../../empire';
import type { Habitat } from '../../../types';
import type { BuiltObject } from '../../../builtObject';
import type { Character } from '../../../characters';
import { Random } from '../../../random';
import { scenarioParam } from '../../state';
import { peekThreatState, threatState, type SentStages, type ThreatKnowledge } from '../framework';
import type { GreatWorkSite } from './types';

export const BEACON_KEY = 'beacon';
export const BEACON_FLAG = 'gwBeacon';
export const BEACON_KIND = 'beacon';
/** Game-end codes (threats: 1911… defeat, +100 victory; Giantworks takes 2051 / 2151). */
export const BEACON_CODE_LOST = 2051;
export const BEACON_CODE_VICTORY = 2151;
/** The Beacon destroyed after its first launch: the only threat victory that ends the game (framework.ts threatGameEndPolicy). */
export const BEACON_CODE_DESTROYED = 2152;

/** Galaxy.MaxSolarSystemSize: a ship this close to a system's star is inside the system. */
export const SYSTEM_RADIUS = 23000;

// ---------------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------------

/** 'lead': from the Reclamation on, the Watcher is the flagship of a Watcher fleet (beaconFleet.ts) and has no routine of its own. */
export type WatcherMode = 'parked' | 'travel' | 'dwell' | 'sighting' | 'return' | 'fight' | 'lead' | 'dead';

export interface WatcherRec {
    index: number;
    ship: BuiltObject | null;
    mode: WatcherMode;
    /** Where it waits in dark space beyond the rim. */
    homeX: number;
    homeY: number;
    target: Habitat | null;
    modeDate: number;
    /** Star date of the next corruption trip. */
    nextCorruptDate: number;
    /** Sighting: the star date it slips away. */
    until: number;
    dead: boolean;
    /** Empires that attacked it (a record only: attacked, it defends itself against the attackers and goes to war with no one). */
    attackedBy: number[];
    /** Per-empire knowledge of the Watcher (Rumour: a cloaked vessel was detected; Suspected: seen more than once). */
    knowledge: ThreatKnowledge[];
    detections: number;
    /** Self-defence (mode 'fight'): the ships that attacked it (builtObjectID) and the star date of the last hit on it; its guns may open fire on these ships and their fleets only. */
    attackerShips?: number[];
    lastHit?: number;
    /** The mode and sighting date it was in when it was attacked: it goes back to them when the fight is over. */
    prevMode?: WatcherMode;
    prevUntil?: number;
    prevModeDate?: number;
    /** Dwell: days it hangs over the target before corrupting it (set on arrival from the world's population). */
    dwellDays?: number;
}

/**
 * A Watcher fleet (from the Reclamation on): the Watcher leads the escorts of one of the two biggest strike groups of the first season(s).
 * It defends the harvest cores (and the Beacon) and goes on one offensive only every beaconWatcherFleetOffMinYears..MaxYears.
 */
export interface WatcherFleet {
    /** The Watcher leading it (WatcherRec.index). */
    index: number;
    /** The escorts (warships); the Watcher itself is not in the list. */
    ships: BuiltObject[];
    mode: 'defence' | 'offensive';
    modeDate: number;
    /** Star date from which the next offensive may be launched (when a big enough target exists). */
    nextOffensive: number;
    /** Defence: the world it holds (a core, else the Beacon's star). */
    post: Habitat | null;
    /** Offensive: the target. */
    target: Habitat | null;
    offensives: number;
    formed: number;
    /** Offensive: the strength (Watcher and escorts) it set out with, and the date it came within range of the target (0 before). */
    startStrength?: number;
    arrived?: number;
}

export interface CorruptRec {
    colony: Habitat;
    /** The governor the corruption works through, when the colony has one (a corrupted character, as the Cult's convert). */
    governor: Character | null;
    date: number;
    /** Empires that found out (counter-intelligence); Confirmed = they can purge it. */
    knowledge: ThreatKnowledge[];
    /** Set when it rose, was purged or the world was lost: kept for the record, no longer counted. */
    ended: 'rose' | 'purged' | 'failed' | 'lost' | null;
    endDate: number;
    /** Tech-5 knowledge siphoned through this world so far (absent in older saves). */
    siphoned?: number;
    /** A purge under way: the rebels have risen on the world and the owner must win the ground battle (absent: none). */
    purge?: PurgeRec;
}

/** A purge attempt: the empire that ordered it, when, the rebels' ground strength and the defenders' strength at the start. */
export interface PurgeRec {
    by: number;
    start: number;
    strength: number;
    defence: number;
}

/** The siphon of tech-5 knowledge through the corrupted worlds (the gate of the Beacon's completion). */
export interface SiphonRec {
    total: number;
    /** Star date of the last credit. */
    last: number;
    /** Empire id to knowledge taken from it. */
    byEmpire: Record<string, number>;
    /** Star date the required total was reached (0 before). */
    gateDate: number;
    /** The rate at the last credit (points a month, all worlds), for the soak. */
    rate: number;
}

/** Interceptions of cattle ships from one held world (destroyed or boarded), slowly decaying. */
export interface InterceptRec {
    colony: Habitat;
    n: number;
    /** Star date of the last decay step. */
    date: number;
}

export type GroupState = 'gather' | 'travel' | 'siege' | 'landed' | 'done';

export interface StrikeGroup {
    id: number;
    season: number;
    state: GroupState;
    target: Habitat | null;
    /** Index into season.staging. */
    staging: number;
    ships: BuiltObject[];
    transports: BuiltObject[];
    /** The flagship the transports escort. */
    lead: BuiltObject | null;
    departDate: number;
    arriveDate: number;
    siegeStart: number;
    landings: number;
    fails: number;
    /** Its escort has held the target's orbit. */
    committed: boolean;
    /** A planet destroyer has been sent with it. */
    destroyer: BuiltObject | null;
    /** Target population when it was picked (for the story). */
    targetPop: number;
    /** Troops have been supplied for the first time / the last reinforcement (star date) / the planet-strike roll is spent. */
    troopsDone: boolean;
    lastReinforce: number;
    rolled: boolean;
}

export interface StagingPoint {
    index: number;
    x: number;
    y: number;
    name: string;
    /** Per-empire knowledge (Confirmed: its ships were seen). */
    knowledge: ThreatKnowledge[];
    /** Strength gathered there when the preparation ended / now. */
    strength: number;
    startStrength: number;
}

export type SeasonPhase = 'prep' | 'offensive' | 'quiet';

export interface Season {
    n: number;
    phase: SeasonPhase;
    start: number;
    /** The phase's planned end (prep: the departure; offensive: the cap; quiet: the next prep). */
    end: number;
    staging: StagingPoint[];
    groups: StrikeGroup[];
    /** Strength budget for the season's waves (the Ground Report-independent ship strength measure). */
    budget: number;
    spawned: number;
    /** Star date every group left (the simultaneous departure), 0 before. */
    departed: number;
    /** Star dates of each group's departure (all equal by construction; kept as the evidence). */
    departures: number[];
    plannedTravelDays: number;
    /** When the preparation began (start is overwritten by each later phase) and the departure planned at its start (the art's launch countdown). */
    prepStart?: number;
    launchAt?: number;
    /** What of the budget the season gets for nothing (the scripted share of the funding model); the rest is paid from the fleet biofuel. */
    freeLeft?: number;
}

export interface ProcessRec {
    colony: Habitat;
    since: number;
    popStart: number;
    drained: number;
    /** Thrall strength waiting for a transport. */
    pool: number;
    done: boolean;
    /** The star date of the next convoy from this world. */
    nextConvoy: number;
    /** The garrison was set to beaconGarrison after the landing's leftovers settled (absent in older saves). */
    garrisoned?: boolean;
}

/** People of one race (by name: plain data) carried or penned. */
export interface Captive {
    race: string;
    amount: number;
}

/**
 * A harvest core (beaconHarvest.ts): one of the Reclaimers' conquered worlds where people are rendered into biofuel. The other held worlds
 * send their people to the nearest core in cattle ships; they wait in its pens until processed. The harvester (a plated base orbiting it)
 * does the work: destroying it breaks the core and frees the pens.
 */
export interface CoreRec {
    colony: Habitat;
    since: number;
    harvester: BuiltObject | null;
    /** People waiting in the pens, by race, and their sum. */
    pens: Captive[];
    waiting: number;
    received: number;
    processed: number;
    /** The world's population when it was made a core (its own people are processed slowly too). */
    popStart: number;
    /** The harvester is built by this star date (beaconCoreBuildDays after the designation): the pens fill but nothing is processed before. */
    readyDate?: number;
    /** retaken: an empire took the world back; broken: its harvester was destroyed; lost: the world was destroyed or slipped away. */
    ended: 'retaken' | 'broken' | 'lost' | null;
    endDate: number;
}

/** A cattle ship in flight from a held world to its core with a slice of the world's people. */
export interface CattleRec {
    ship: BuiltObject;
    from: Habitat;
    core: Habitat;
    load: Captive[];
    total: number;
    launched: number;
}

/** The biofuel accounts, in fleet strength (the season budget's measure): the fleet's and the troops' (a troop costs strength / beaconTroopsPerFuel). */
export interface FuelRec {
    fleet: number;
    troops: number;
    /** Totals since the Reclamation began: made, spent on warships, spent on troops, the awakening reserve. */
    income: number;
    spentShips: number;
    spentTroops: number;
    startGrant: number;
    /** Monthly income, the last 24 months (newest last). */
    monthly: number[];
}

/** What the Beacon's art reads (beaconArtInfo; refreshed in BeaconState.art every 5-day pass). Star dates are galaxyStarDate units. */
export interface BeaconArtInfo {
    /** dormant: the Great Work is not finished; awakening: finished, before the first season; prep / offensive / quiet: the season's phase; dead: the Beacon is destroyed or the arc is over. */
    phase: 'dormant' | 'awakening' | 'prep' | 'offensive' | 'quiet' | 'dead';
    season: number;
    phaseStart: number;
    phaseEnd: number;
    /** 0..1 through the phase (by the dates; the departure may wait up to 60 days past the planned end of a preparation). */
    progress: number;
    /** The departure planned when the preparation began (0 when no season is preparing or has prepared). */
    launchAt: number;
    /** The star date every strike group left (the launch moment, the mega beam), 0 before the departure of the current season. */
    launched: number;
    /** The station's damage: the share of its components damaged (0..1), and its shields (0..1 of capacity). */
    stationDamage: number;
    stationShields: number;
}

export interface RaidRec {
    ships: BuiltObject[];
    target: Habitat | null;
    start: number;
    until: number;
}

export interface BargainRec {
    empireId: number;
    kind: 'cede' | 'protectorate';
    date: number;
    /** Spared until (cede) / liquified at (protectorate). */
    until: number;
    colonyName: string;
    discovered: boolean;
    discoveredDate: number;
    /** Done: the term ran out. */
    ended: boolean;
}

export interface SalvageRec {
    empireId: number;
    points: number;
    steps: number;
}

export interface BeaconStats {
    corrupted: number;
    purged: number;
    rose: number;
    sightings: number;
    watcherDetections: number;
    seasons: number;
    spawned: number;
    transportsSpawned: number;
    thrallConvoys: number;
    conquests: number;
    landingsWon: number;
    landingsLost: number;
    planetsDestroyed: number;
    popDrained: number;
    popDestroyed: number;
    raids: number;
    offers: number;
    accepted: number;
    refused: number;
    discoveries: number;
    salvageSteps: number;
    stagingHits: number;
    thrallIntercepted: number;
    /** Staging points an empire noticed (empire x point), worlds retaken from the Reclaimers, strikes the AI coalition launched at staging fleets / the Beacon / Watchers, relief fleets sent. */
    stagingSeen?: number;
    retaken?: number;
    aiStrikes?: number;
    aiRelief?: number;
    /** Warships of the Reclaimers sunk at a staging point while the season was still gathering. */
    stagingKills?: number;
    /** Watchers whose return home took over 150 days and were given a nearer home point. */
    watcherRehomed?: number;
    /** Watcher fleets (beaconFleet.ts): formed / topped up from a strike group; offensives launched and days spent on them; defence moves to a threatened core; escorts lost; the sum of their strength before/after (the soak's loss measure). */
    wfFormed?: number;
    wfOffensives?: number;
    wfOffensiveDays?: number;
    wfResponses?: number;
    wfShipsLost?: number;
    wfReverted?: number;
    /** The harvest (beaconHarvest.ts): cores designated / retaken / broken (harvester destroyed) / lost; cattle ships launched / docked / destroyed
     *  (with their captives) / boarded; people killed on them, freed from the pens, rescued from boarded ships, processed; biofuel made, spent
     *  on warships and troops; troop regiments raised by the troop pass; the AI's cattle interceptions, harvester strikes and retake orders. */
    coresDesignated?: number;
    coresRetaken?: number;
    coresBroken?: number;
    coresLost?: number;
    cattleLaunched?: number;
    cattleArrived?: number;
    cattleKilled?: number;
    cattleBoarded?: number;
    captivesKilled?: number;
    captivesFreed?: number;
    captivesRescued?: number;
    processed?: number;
    fuelIncome?: number;
    fuelShips?: number;
    fuelTroops?: number;
    troopRegiments?: number;
    aiCattle?: number;
    aiCore?: number;
    aiRetake?: number;
    /** Siphon and purge: tech-5 knowledge siphoned in all; purges attempted / won / lost; dwells restarted after an attack. */
    siphoned?: number;
    purgeTried?: number;
    purgeFailed?: number;
    dwellResets?: number;
    /** Research moratorium motions passed; breaches sanctioned. */
    moratoriums?: number;
    moratoriumBreaches?: number;
    /** Escorts assigned to cattle ships by tier (light / destroyer / cruiser), built for them, and cattle ships whose escort fell. */
    escortLight?: number;
    escortMid?: number;
    escortHeavy?: number;
    escortBuilt?: number;
    escortLost?: number;
}

export interface BeaconState {
    /** The Great Work site (the framework's object). */
    site: GreatWorkSite | null;
    /** The one machine faction: "the Watchers" before the Beacon is finished, "the Reclaimers" after. */
    faction: Empire | null;
    phase: 'watching' | 'reclamation' | 'ended';
    /** Seed counter for beaconRandom. */
    rndCounter: number;
    sentStages: SentStages;
    /** Message kind → ids of the human empires that already had its first-encounter message (beacon.ts watcherVariant; absent in older saves). */
    msgSeen?: Record<string, number[]>;
    /** The colonies that were independent at the start (the Watchers corrupt only these). */
    formerIndependents: Habitat[];
    watchers: WatcherRec[];
    /** The Watcher fleets (absent before the Reclamation and in older saves). */
    watcherFleets?: WatcherFleet[];
    /** The Watchers currently uncloaked (sighting or fighting), refreshed every pass; the art reads it (render/threatArt.ts). */
    sighted: BuiltObject[];
    corrupted: CorruptRec[];
    nextSightingDate: number;
    completeDate: number;
    /** The Beacon base (the finished wonder), once the Reclamation began. */
    beacon: BuiltObject | null;
    beaconDestroyed: boolean;
    beaconKnowledge: ThreatKnowledge[];
    /** The Beacon's own home guard (warships parked at it). */
    guards: BuiltObject[];
    guardDate: number;
    /** Transports carrying Thralls (the ones a player can intercept). */
    thrallShips: BuiltObject[];
    seasons: Season[];
    season: Season | null;
    nextGroupId: number;
    processing: ProcessRec[];
    raids: RaidRec[];
    nextRaidDate: number;
    /** Reserve ships (raiders returned, survivors of a season) that join the next season's groups. */
    reserve: BuiltObject[];
    /** Pop the galaxy held when the Reclamation began, and the people the Reclaimers have eliminated since. */
    popBaseline: number;
    popEliminated: number;
    bargains: BargainRec[];
    nextOfferDate: number;
    /** A colony is being handed over by a bargain (not counted as a conquest loss). */
    ceding?: boolean;
    /** Empire id → colonies lost to the Reclaimers (the pressure behind the dark bargain's offers). */
    lostBy: Record<string, number>;
    /** Empire id → star date of the last offer made to it. */
    offered: Record<string, number>;
    salvage: SalvageRec[];
    /** The Reclamation began (star date, 0 before). */
    reclamationDate: number;
    /** The siphon (created on first use: absent in older saves, where it starts at the share the build had made). */
    siphon?: SiphonRec;
    /** Cattle interceptions per held world (beaconHarvest.ts escorts). */
    intercepts?: InterceptRec[];
    stats: BeaconStats;
    ended: boolean;
    /** Spawned from the Game Editor / a test: the existence-year gates are skipped. */
    forced?: boolean;
    /** The AI coalition's standing operations (beaconAi.ts), by key ('beacon', 'staging:<season>:<point>'): the rally star's system index (-1 none) and whether the force has gone in; launches counts the Beacon assaults. */
    /** The harvest (beaconHarvest.ts; absent before it first ran): cores (live and ended, the last 40 kept), cattle ships in flight, worlds
     *  that may not be made a core again before a date (their harvester was destroyed), the biofuel accounts. */
    cores?: CoreRec[];
    cattle?: CattleRec[];
    coreBans?: { colony: Habitat; until: number }[];
    fuel?: FuelRec;
    /** The launch record (the art's beam, camera and pop-up fire once per launch): how many times the strike groups were called out and
     *  the star date of the last call (set in the pass that orders the simultaneous departure; saved, so it holds across save / load). */
    launches?: number;
    /** The empire that destroyed the Beacon (empireId; absent: unknown / not an empire) and whether the victory for destroying it after a launch was declared. */
    beaconKillerId?: number;
    destroyVictoryDone?: boolean;
    lastLaunchDate?: number;
    /** Star date of the last reclamation pass (a pass is credited with the days since: the periodics run once per stock long block). */
    lastPassDate?: number;
    /** Render only (refreshed every pass): the live harvest cores' worlds, the cattle ships in flight, the live harvesters; the art record (beaconArtInfo). */
    coreWorlds?: Habitat[];
    cattleShips?: BuiltObject[];
    harvesters?: BuiltObject[];
    art?: BeaconArtInfo;
    ai?: { launches: number; /** Lead ships of the units the coalition ordered at its last pass (released when no longer ordered). */ held?: BuiltObject[]; ops: Record<string, { go: boolean; rally: number; /** Force gathered at the rally / the target at the last pass (a measure for soaks). */ there?: number; need?: number; /** The waypoint the force gathers at before it strikes. */ wx?: number; wy?: number; /** When the force began to gather; when a given-up operation may start again. */ since?: number; cooldown?: number }>; /** What the last pass saw (a measure for soaks): members, free units, their strength, the force the Beacon needs and what the nearest units sum to. */ last?: { members: number; units: number; free: number; need: number; sum: number } };
}

export function newStats(): BeaconStats {
    return {
        corrupted: 0, purged: 0, rose: 0, sightings: 0, watcherDetections: 0, seasons: 0, spawned: 0, transportsSpawned: 0, thrallConvoys: 0, conquests: 0, landingsWon: 0, landingsLost: 0,
        planetsDestroyed: 0, popDrained: 0, popDestroyed: 0, raids: 0, offers: 0, accepted: 0, refused: 0, discoveries: 0, salvageSteps: 0, stagingHits: 0, thrallIntercepted: 0,
        stagingSeen: 0, retaken: 0, aiStrikes: 0, aiRelief: 0, stagingKills: 0, watcherRehomed: 0,
        coresDesignated: 0, coresRetaken: 0, coresBroken: 0, coresLost: 0, cattleLaunched: 0, cattleArrived: 0, cattleKilled: 0, cattleBoarded: 0, captivesKilled: 0, captivesFreed: 0, captivesRescued: 0,
        processed: 0, fuelIncome: 0, fuelShips: 0, fuelTroops: 0, troopRegiments: 0, aiCattle: 0, aiCore: 0, aiRetake: 0,
        siphoned: 0, purgeTried: 0, purgeFailed: 0, dwellResets: 0, moratoriums: 0, moratoriumBreaches: 0, escortLight: 0, escortMid: 0, escortHeavy: 0, escortBuilt: 0, escortLost: 0,
    };
}

function newState(): BeaconState {
    return {
        site: null, faction: null, phase: 'watching', rndCounter: 0, sentStages: {}, msgSeen: {}, formerIndependents: [], watchers: [], sighted: [], corrupted: [], nextSightingDate: 0, completeDate: 0, beacon: null, beaconDestroyed: false,
        beaconKnowledge: [], guards: [], guardDate: 0, thrallShips: [], seasons: [], season: null, nextGroupId: 1, processing: [], raids: [], nextRaidDate: 0, reserve: [], popBaseline: 0, popEliminated: 0, bargains: [], lostBy: {}, offered: {},
        nextOfferDate: 0, salvage: [], reclamationDate: 0, stats: newStats(), ended: false,
    };
}

/** Fills what an older save lacks (withDefaults-style migration). Idempotent. */
function withDefaults(st: BeaconState): BeaconState {
    if (st.stats.escortLost !== undefined) return st;
    const fresh = newStats();
    const rec = st.stats as unknown as Record<string, number | undefined>;
    for (const [k, v] of Object.entries(fresh)) if (rec[k] === undefined) rec[k] = v;
    return st;
}

export function beaconState(galaxy: Galaxy): BeaconState {
    return withDefaults(threatState(galaxy, BEACON_KEY, newState));
}

export function peekBeaconState(galaxy: Galaxy): BeaconState | null {
    const st = peekThreatState<BeaconState>(galaxy, BEACON_KEY);
    return st === null ? null : withDefaults(st);
}

/** The siphon record; an older save's starts at the share of the total the build had reached. */
export function siphonOf(galaxy: Galaxy, st: BeaconState): SiphonRec {
    if (st.siphon === undefined) {
        const need = P.siphonRequired(galaxy);
        const done = st.phase === 'watching' ? need * Math.max(0, Math.min(1, (st.site as { progress?: number } | null)?.progress ?? 0)) : need;
        st.siphon = { total: done, last: -1, byEmpire: {}, gateDate: 0, rate: 0 };
    }
    return st.siphon;
}

/** The Beacon may be completed: enough tech-5 knowledge has been siphoned (always once the Reclamation has begun). Pure but for the lazy record. */
export function siphonGateOpen(galaxy: Galaxy, st: BeaconState): boolean {
    return st.phase !== 'watching' || siphonOf(galaxy, st).total >= P.siphonRequired(galaxy);
}

/** A private Random for one decision (never galaxy.rnd): seeded from the galaxy seed, a salt and the state's counter. */
export function beaconRandom(galaxy: Galaxy, st: BeaconState, salt = 0): Random {
    st.rndCounter++;
    return new Random(((galaxy.randomSeed ^ 0x42454143) + salt * 7919 + st.rndCounter * 104729) & 0x7fffffff);
}

// ---------------------------------------------------------------------------------------------------------------
// Parameters (the add-on manifest declares the same names and defaults; the defaults here are what a missing one reads)
// ---------------------------------------------------------------------------------------------------------------

function p(galaxy: Galaxy, name: string, fallback: number): number {
    return scenarioParam(galaxy, name, fallback);
}

export const P = {
    // The Watchers
    watcherCount: (g: Galaxy) => Math.max(1, Math.trunc(p(g, 'beaconWatchers', 2))),
    /** A Watcher's guns: this many times the capital-ship template's weapons are added (1 = double). */
    watcherGuns: (g: Galaxy) => p(g, 'beaconWatcherGuns', 2),
    watcherArmourPct: (g: Galaxy) => p(g, 'beaconWatcherArmourPct', 350),
    watcherShieldPct: (g: Galaxy) => p(g, 'beaconWatcherShieldPct', 200),
    /** 1: every Reclaimer design uses the maximum tech level the design generator supports (0: the galaxy average + 1, the Watchers + beaconWatcherTechBonus). */
    techMax: (g: Galaxy) => p(g, 'beaconTechMax', 1) > 0,
    watcherTechBonus: (g: Galaxy) => p(g, 'beaconWatcherTechBonus', 2),
    /** Days between a Watcher's corruption trips (min / max). */
    corruptMinDays: (g: Galaxy) => p(g, 'beaconCorruptMinDays', 80),
    corruptMaxDays: (g: Galaxy) => p(g, 'beaconCorruptMaxDays', 160),
    /** The dwell over a world grows with its population: this many days for a small colony (beaconDwellPopLow, millions) up to beaconDwellMaxDays for a big one (beaconDwellPopHigh). */
    dwellDays: (g: Galaxy) => p(g, 'beaconDwellDays', 30),
    dwellMaxDays: (g: Galaxy) => Math.max(p(g, 'beaconDwellDays', 30), p(g, 'beaconDwellMaxDays', 150)),
    dwellPopLow: (g: Galaxy) => Math.max(0.1, p(g, 'beaconDwellPopLow', 10)) * 1e6,
    dwellPopHigh: (g: Galaxy) => Math.max(p(g, 'beaconDwellPopLow', 10) * 1.01, p(g, 'beaconDwellPopHigh', 2000)) * 1e6,
    /** The siphon: knowledge needed before the Beacon can be completed, and points a month per tech-5 technology of the donor empire, per corrupted world. */
    siphonRequired: (g: Galaxy) => Math.max(0, p(g, 'beaconSiphonRequired', 3000)),
    siphonRate: (g: Galaxy) => Math.max(0, p(g, 'beaconSiphonRate', 0.5)),
    /** Purge: the rebels' ground strength for a max-population colony (beaconPurgeRebelPopFull, millions), the floor for a tiny one,  and the least (%) of it the owner's defenders must outweigh before the AI tries; days a purged world is left alone by the Watchers. */
    purgeRebelStrength: (g: Galaxy) => p(g, 'beaconPurgeRebelStrength', 1500000),
    purgeRebelMin: (g: Galaxy) => Math.max(1200, p(g, 'beaconPurgeRebelMin', 100000)),
    purgeRebelPopFull: (g: Galaxy) => Math.max(1, p(g, 'beaconPurgeRebelPopFull', 2000)) * 1e6,
    purgeRebelRegiments: (g: Galaxy) => Math.max(1, Math.trunc(p(g, 'beaconPurgeRebelRegiments', 12))),
    aiPurgeMarginPct: (g: Galaxy) => p(g, 'beaconAiPurgeMarginPct', 130),
    reseedDays: (g: Galaxy) => p(g, 'beaconReseedDays', 120),
    /** Build speed: +this % per corrupted world (up to the cap %); a dead Watcher multiplies it by the factor %. */
    buildBoostPct: (g: Galaxy) => p(g, 'beaconBuildBoostPct', 9),
    buildBoostCapPct: (g: Galaxy) => p(g, 'beaconBuildBoostCapPct', 150),
    watcherDeadFactorPct: (g: Galaxy) => p(g, 'beaconWatcherDeadFactorPct', 40),
    sightingMinDays: (g: Galaxy) => p(g, 'beaconSightingMinDays', 220),
    sightingMaxDays: (g: Galaxy) => p(g, 'beaconSightingMaxDays', 480),
    sightingDays: (g: Galaxy) => p(g, 'beaconSightingDays', 6),
    /** Cloak detection: a ship / base of an empire within this of a cloaked Watcher may spot it (chance % per check). */
    detectRange: (g: Galaxy) => p(g, 'beaconDetectRange', 60000),
    detectPct: (g: Galaxy) => p(g, 'beaconDetectPct', 3),
    detectSeenDays: (g: Galaxy) => p(g, 'beaconDetectSeenDays', 20),
    /** A corrupted world's chance (%) per month to rise, once the Reclamation has begun; the strength of the rising force. */
    riseStrength: (g: Galaxy) => p(g, 'beaconRiseStrength', 900000),
    // The Reclamation
    startDelayDays: (g: Galaxy) => p(g, 'beaconStartDelayDays', 90),
    prepMinDays: (g: Galaxy) => p(g, 'beaconPrepMinDays', 120),
    prepMaxDays: (g: Galaxy) => p(g, 'beaconPrepMaxDays', 180),
    offensiveMinDays: (g: Galaxy) => p(g, 'beaconOffensiveMinDays', 90),
    offensiveMaxDays: (g: Galaxy) => p(g, 'beaconOffensiveMaxDays', 360),
    quietDays: (g: Galaxy) => p(g, 'beaconQuietDays', 360),
    stagingPoints: (g: Galaxy) => Math.max(1, Math.trunc(p(g, 'beaconStagingPoints', 3))),
    /** Strike groups in season 1; one more every two seasons, up to the max. */
    groupsBase: (g: Galaxy) => Math.max(1, Math.trunc(p(g, 'beaconGroups', 3))),
    groupsMax: (g: Galaxy) => Math.max(1, Math.trunc(p(g, 'beaconGroupsMax', 16))),
    /** One more strike group per this many colonies in the galaxy (0: one per eight empires). */
    groupColonies: (g: Galaxy) => Math.max(0, Math.trunc(p(g, 'beaconGroupColonies', 16))),
    /** The Beacon's own guard: this many strike groups' worth of warships parked at it. */
    guardGroups: (g: Galaxy) => p(g, 'beaconGuardGroups', 2),
    guardCapPct: (g: Galaxy) => p(g, 'beaconGuardCapPct', 20),
    guardRampDays: (g: Galaxy) => p(g, 'beaconGuardRampDays', 720),
    // The Watcher fleets (from the Reclamation on; beaconFleet.ts)
    /** 1: the two Watchers lead the two biggest strike groups' escorts, defensively (0: they keep their old routine, no fleets). */
    wfEnabled: (g: Galaxy) => p(g, 'beaconWatcherFleets', 1) > 0,
    /** A Watcher fleet goes on an offensive every this many years (drawn between min and max with the Beacon's private Random). */
    wfOffMinYears: (g: Galaxy) => p(g, 'beaconWatcherFleetOffMinYears', 3),
    wfOffMaxYears: (g: Galaxy) => Math.max(p(g, 'beaconWatcherFleetOffMinYears', 3), p(g, 'beaconWatcherFleetOffMaxYears', 4)),
    /** The least a target is worth for an offensive (its population in millions to the beaconTargetPopPct power, plus its defenders' strength in units of 5 % of the reference military). */
    wfMinTargetValue: (g: Galaxy) => p(g, 'beaconWatcherFleetMinTargetValue', 25),
    /** The offensive is launched only at a target whose defence the fleet outweighs by this %. */
    wfRatioPct: (g: Galaxy) => p(g, 'beaconWatcherFleetRatioPct', 150),
    /** An offensive ends after this many days (its travel included) or when the fleet has lost this % of its strength. */
    wfOffDays: (g: Galaxy) => p(g, 'beaconWatcherFleetOffensiveDays', 240),
    wfMaxLossPct: (g: Galaxy) => p(g, 'beaconWatcherFleetMaxLossPct', 40),
    /** The targets an offensive may pick lie within this many sectors of the fleet's post. */
    wfReachSectors: (g: Galaxy) => p(g, 'beaconWatcherFleetReachSectors', 14),
    /** An enemy warship this close to a core (or the Beacon) draws the nearest Watcher fleet. */
    wfCoreRange: (g: Galaxy) => p(g, 'beaconWatcherFleetCoreRange', 45000),
    /** A Watcher fleet is topped up from the biggest strike group when its escorts fall below this % of that group. */
    wfTopUpPct: (g: Galaxy) => p(g, 'beaconWatcherFleetTopUpPct', 50),
    /** A target's pull grows with its population to this power (x 100: 50 = the square root, 100 = linearly). */
    targetPopPct: (g: Galaxy) => p(g, 'beaconTargetPopPct', 50),
    /** Season strength: % of the reference military (mean of the three strongest empires), season 1, growth per season, per processing world, cap. */
    strengthPct: (g: Galaxy) => p(g, 'beaconStrengthPct', 15),
    strengthGrowthPct: (g: Galaxy) => p(g, 'beaconStrengthGrowthPct', 2),
    strengthPerWorldPct: (g: Galaxy) => p(g, 'beaconStrengthPerWorldPct', 1),
    strengthCapPct: (g: Galaxy) => p(g, 'beaconStrengthCapPct', 1500),
    minSeasonStrength: (g: Galaxy) => p(g, 'beaconMinStrength', 1500),
    /** Largest number of warships one season spawns. */
    maxSeasonShips: (g: Galaxy) => Math.trunc(p(g, 'beaconMaxSeasonShips', 400)),
    /** Most troop transports one strike group has (a world needing more troops than they carry is not struck). */
    maxTransports: (g: Galaxy) => Math.trunc(p(g, 'beaconMaxTransports', 8)),
    /** The Reclaimers' regiments: strongest natural strength of one regiment (x 100 readiness = its strength), the share (%) of the defenders' regiments a landing must field, regiments in a held world's garrison / in a rising. */
    regimentNatural: (g: Galaxy) => Math.max(10, p(g, 'beaconRegimentNatural', 600)),
    hpPct: (g: Galaxy) => p(g, 'beaconHpPct', 50),
    garrisonRegiments: (g: Galaxy) => Math.max(1, Math.trunc(p(g, 'beaconGarrisonRegiments', 24))),
    riseRegiments: (g: Galaxy) => Math.max(1, Math.trunc(p(g, 'beaconRiseRegiments', 16))),
    /** Troops of a landing must beat the defence by this % (and a failed landing at a target raises it). */
    assaultMarginPct: (g: Galaxy) => p(g, 'beaconAssaultMarginPct', 150),
    assaultFailStepPct: (g: Galaxy) => p(g, 'beaconAssaultFailStepPct', 30),
    // Conquest and the harvest (beaconHarvest.ts)
    /** How the Reclaimers' fleets and troops are paid for: 0 harvest only (biofuel; an awakening reserve starts season 1), 1 scripted (the
     *  season strength grows by itself; biofuel buys troops only), 2 combined (a guaranteed trickle of beaconTricklePct % of the scripted
     *  strength, biofuel on top). */
    fundingModel: (g: Galaxy) => Math.max(0, Math.min(2, Math.trunc(p(g, 'beaconFundingModel', 2)))),
    tricklePct: (g: Galaxy) => p(g, 'beaconTricklePct', 50),
    /** Biofuel made per billion people processed: this % of the reference military, in fleet strength. */
    fuelPerBillionPct: (g: Galaxy) => p(g, 'beaconFuelPerBillionPct', 6),
    /** A season paid with biofuel reaches at most this % of the scripted season strength (models 0 and 2). */
    fuelCapPct: (g: Galaxy) => p(g, 'beaconFuelCapPct', 150),
    /** The awakening reserve (models 0 and 2): this % of season 1's scripted strength, less the trickle's share. */
    fuelStartPct: (g: Galaxy) => p(g, 'beaconFuelStartPct', 100),
    /** Share (%) of the biofuel put to the troops (models 0 and 2; model 1 puts all of it there). */
    fuelTroopPct: (g: Galaxy) => p(g, 'beaconFuelTroopPct', 30),
    /** Troop strength (the invasion measure) one unit of biofuel buys. */
    troopsPerFuel: (g: Galaxy) => Math.max(1, p(g, 'beaconTroopsPerFuel', 5000)),
    /** Cores: at most one per this many held worlds; how many by the galaxy's star count (2 below beaconCoresMidStars, 3 below beaconCoresBigStars,
     *  then from beaconCoresBig rising to beaconCoresMax at beaconCoresHugeStars). */
    coreWorldsPer: (g: Galaxy) => Math.max(1, Math.trunc(p(g, 'beaconCoreWorldsPer', 3))),
    coresSmall: (g: Galaxy) => Math.max(1, Math.trunc(p(g, 'beaconCoresSmall', 2))),
    coresMidStars: (g: Galaxy) => p(g, 'beaconCoresMidStars', 700),
    coresMid: (g: Galaxy) => Math.max(1, Math.trunc(p(g, 'beaconCoresMid', 3))),
    coresBigStars: (g: Galaxy) => p(g, 'beaconCoresBigStars', 1400),
    coresBig: (g: Galaxy) => Math.max(1, Math.trunc(p(g, 'beaconCoresBig', 4))),
    coresHugeStars: (g: Galaxy) => p(g, 'beaconCoresHugeStars', 4000),
    coresMax: (g: Galaxy) => Math.max(1, Math.trunc(p(g, 'beaconCoresMax', 7))),
    /** A new core's pull falls off within this many sectors of an existing core (they spread across the holdings). */
    coreSpreadSectors: (g: Galaxy) => p(g, 'beaconCoreSpreadSectors', 3),
    /** Share (%) of the pens processed a month; a core's own people are processed over this many months. */
    coreProcessPct: (g: Galaxy) => p(g, 'beaconCoreProcessPct', 20),
    coreDrainMonths: (g: Galaxy) => Math.max(1, p(g, 'beaconCoreDrainMonths', 36)),
    /** A new core's harvester takes this many days to build before it processes anything. */
    coreBuildDays: (g: Galaxy) => p(g, 'beaconCoreBuildDays', 120),
    /** A world whose harvester was destroyed cannot be made a core again for this many days. */
    coreBanDays: (g: Galaxy) => p(g, 'beaconCoreBanDays', 360),
    /** Garrison targets: a core's (% of beaconGarrison), a threatened world's (enemy warships near or troops landed). */
    coreGarrisonPct: (g: Galaxy) => p(g, 'beaconCoreGarrisonPct', 150),
    threatGarrisonPct: (g: Galaxy) => p(g, 'beaconThreatGarrisonPct', 125),
    /** The harvester: the faction's defensive base plated with this % of armour / shields, its guns this % more. */
    harvesterArmourPct: (g: Galaxy) => p(g, 'beaconHarvesterArmourPct', 150),
    harvesterShieldPct: (g: Galaxy) => p(g, 'beaconHarvesterShieldPct', 100),
    harvesterGunsPct: (g: Galaxy) => p(g, 'beaconHarvesterGunsPct', 0),
    /** Cattle ships: a held world launches one every this many days, carrying this % of the people it had when taken; at most this many fly at once; their plating, their holds and their slow spool. */
    cattleDays: (g: Galaxy) => Math.max(1, p(g, 'beaconCattleDays', 20)),
    cattleLoadPct: (g: Galaxy) => Math.max(0.1, p(g, 'beaconCattleLoadPct', 5)),
    cattleMax: (g: Galaxy) => Math.max(0, Math.trunc(p(g, 'beaconCattleMax', 150))),
    cattleArmourPct: (g: Galaxy) => p(g, 'beaconCattleArmourPct', 100),
    cattleHoldPct: (g: Galaxy) => p(g, 'beaconCattleHoldPct', 250),
    /** Their hyperdrive spools this many times as long as a warship's (they sit exposed at the world they leave). */
    cattleSpoolFactor: (g: Galaxy) => p(g, 'beaconCattleSpoolFactor', 12),
    /** The captives killed with a destroyed cattle ship: this % of them count toward the Reclaimers' eliminated people (the loss measure; 0: the
     *  interceptors killed them, not the Reclaimers; they are gone from the galaxy all the same). */
    cattleDeadCountPct: (g: Galaxy) => p(g, 'beaconCattleDeadCountPct', 0),
    garrisonStrength: (g: Galaxy) => p(g, 'beaconGarrison', 150000),
    /** A siege this long (days) against a world the landing cannot take ends in a planet strike (chance %). */
    siegeDays: (g: Galaxy) => p(g, 'beaconSiegeDays', 150),
    destroyPct: (g: Galaxy) => p(g, 'beaconDestroyPct', 30),
    destroyerPct: (g: Galaxy) => p(g, 'beaconDestroyerPct', 60),
    // Raids in the quiet
    raidDays: (g: Galaxy) => p(g, 'beaconRaidDays', 40),
    raidLifeDays: (g: Galaxy) => p(g, 'beaconRaidLifeDays', 70),
    // Loss
    lossPct: (g: Galaxy) => p(g, 'beaconLossPct', 80),
    // The dark bargain
    offerFirstDays: (g: Galaxy) => p(g, 'beaconOfferFirstDays', 60),
    offerEveryDays: (g: Galaxy) => p(g, 'beaconOfferEveryDays', 200),
    spareDays: (g: Galaxy) => p(g, 'beaconSpareDays', 720),
    protectorateYears: (g: Galaxy) => p(g, 'beaconProtectorateYears', 8),
    discoverPct: (g: Galaxy) => p(g, 'beaconDiscoverPct', 3),
    agentDetectPct: (g: Galaxy) => p(g, 'beaconAgentDetectPct', 5),
    // Counterplay
    /** Staging-point detection: an empire with a colony within this many sectors of a staging point may notice the gathering (chance % per 5-day pass at 0 distance, falling to 0 at the range). */
    stagingDetectSectors: (g: Galaxy) => p(g, 'beaconStagingDetectSectors', 5),
    stagingDetectPct: (g: Galaxy) => p(g, 'beaconStagingDetectPct', 25),
    /** The AI coalition (beaconAi.ts): on (1) / off (0), the force it needs against the Beacon / a staging fleet / a Watcher (% of the defence), against a strike group (relief, % of the group), how far it reaches (sectors), the share of its military a member may give, the share of the force that must be gathered before the Beacon is attacked. */
    aiOn: (g: Galaxy) => p(g, 'beaconAiOn', 1),
    aiRatioPct: (g: Galaxy) => p(g, 'beaconAiRatioPct', 220),
    aiWatcherRatioPct: (g: Galaxy) => p(g, 'beaconAiWatcherRatioPct', 200),
    aiReliefPct: (g: Galaxy) => p(g, 'beaconAiReliefPct', 100),
    aiReachSectors: (g: Galaxy) => p(g, 'beaconAiReachSectors', 12),
    aiStagingReachSectors: (g: Galaxy) => p(g, 'beaconAiStagingReachSectors', 4),
    aiStagingRatioPct: (g: Galaxy) => p(g, 'beaconAiStagingRatioPct', 70),
    aiStagingGatherPct: (g: Galaxy) => p(g, 'beaconAiStagingGatherPct', 50),
    aiSharePct: (g: Galaxy) => p(g, 'beaconAiSharePct', 60),
    aiUrgencyPct: (g: Galaxy) => p(g, 'beaconAiUrgencyPct', 30),
    aiGatherPct: (g: Galaxy) => p(g, 'beaconAiGatherPct', 80),
    /** The coalition and the harvest: it intercepts cattle ships (on / off, sectors from a member's fleet, orders per pass; it knows the captives
     *  die), strikes harvesters (force, % of the harvester and the fleet guarding its core), and Smarter AI members retake cores (on / off). */
    aiCattleOn: (g: Galaxy) => p(g, 'beaconAiCattleOn', 1),
    aiCattleReachSectors: (g: Galaxy) => p(g, 'beaconAiCattleReachSectors', 3),
    aiCattleMax: (g: Galaxy) => Math.max(0, Math.trunc(p(g, 'beaconAiCattleMax', 6))),
    aiCoreRatioPct: (g: Galaxy) => p(g, 'beaconAiCoreRatioPct', 150),
    aiRetakeOn: (g: Galaxy) => p(g, 'beaconAiRetakeOn', 1),
    salvageKill: (g: Galaxy) => p(g, 'beaconSalvageKill', 1),
    salvageBoard: (g: Galaxy) => p(g, 'beaconSalvageBoard', 6),
};

// ---------------------------------------------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------------------------------------------

/** The empire is a normal (non-faction, non-independent, non-pirate) empire. */
export function isNormalEmpire(galaxy: Galaxy, e: Empire | null, st: BeaconState | null = null): e is Empire {
    return e !== null && e.active && e !== galaxy.independentEmpire && e.pirateEmpireBaseHabitat === null && (st === null || e !== st.faction);
}

export function watcherShips(st: BeaconState): BuiltObject[] {
    const out: BuiltObject[] = [];
    for (const w of st.watchers) if (!w.dead && w.ship !== null && !w.ship.hasBeenDestroyed) out.push(w.ship);
    return out;
}

export function liveWatchers(st: BeaconState): WatcherRec[] {
    return st.watchers.filter((w) => !w.dead && w.ship !== null && !w.ship.hasBeenDestroyed && w.ship.actualEmpire === st.faction);
}

/** The corrupted worlds still serving the Beacon. Pure. */
export function activeCorruption(st: BeaconState): CorruptRec[] {
    return st.corrupted.filter((c) => c.ended === null && !c.colony.hasBeenDestroyed);
}

export function isReclaimerShip(st: BeaconState, bo: BuiltObject | null): boolean {
    return bo !== null && st.faction !== null && bo.actualEmpire === st.faction;
}

/** Live ships of a list. */
export function aliveShips(list: readonly BuiltObject[], faction: Empire | null): BuiltObject[] {
    return list.filter((b) => !b.hasBeenDestroyed && (faction === null || b.actualEmpire === faction));
}

/** The galaxy's total population on empire and independent colonies, `except` excluded (the loss measure). */
export function galaxyPopulation(galaxy: Galaxy, except: Empire | null): number {
    let total = 0;
    for (const e of galaxy.empires) {
        if (e === null || e === except || !e.active || e.pirateEmpireBaseHabitat !== null) continue;
        for (const c of e.colonies) if (!c.hasBeenDestroyed) total += c.population.totalAmount;
    }
    return total;
}

/** The Beacon's position (the site's base, else its star). */
export function beaconPosition(st: BeaconState): { x: number; y: number } | null {
    if (st.beacon !== null && !st.beacon.hasBeenDestroyed) return { x: st.beacon.xpos, y: st.beacon.ypos };
    const s = st.site;
    if (s === null) return null;
    if (s.base !== null) return { x: s.base.xpos, y: s.base.ypos };
    return { x: s.system.systemStar.xpos, y: s.system.systemStar.ypos };
}

/** True when the cloak does not hide `bo` from `empire` right now (not cloaked, or a ship / base of the empire spotted it). Pure. */
export function cloakLapsedFor(bo: BuiltObject, empire: Empire, now: number): boolean {
    if (bo.cloaked !== true) return true;
    if (bo.cloakSeenBy === undefined) return false;
    for (const s of bo.cloakSeenBy) if (s.empireId === empire.empireId && s.until > now) return true;
    return false;
}

/** Salvage steps `empire` has unlocked (0-4). Pure. */
export function salvageStepsOf(st: BeaconState, empire: Empire | null): number {
    if (empire === null) return 0;
    return st.salvage.find((s) => s.empireId === empire.empireId)?.steps ?? 0;
}
