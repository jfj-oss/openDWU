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
import { galaxyStarDate } from '../../../tick/simTime';
import { GAME_DAY_LENGTH } from '../../hooks';
import { peekThreatState, threatState, type SentStages, type ThreatKnowledge } from '../framework';
import type { GreatWorkSite } from './types';
import type { FoundryState } from './beaconFoundry';

export const BEACON_KEY = 'beacon';
export const BEACON_FLAG = 'gwBeacon';
export const BEACON_KIND = 'beacon';
/** Game-end codes (threats: 1911… defeat, +100 victory; Giantworks takes 2051 / 2151). */
export const BEACON_CODE_LOST = 2051;
export const BEACON_CODE_VICTORY = 2151;
/** The Beacon destroyed after its first launch: no longer ends the game (the fake-out: it gives the beam lens); kept as the old code. */
export const BEACON_CODE_DESTROYED = 2152;
/** The threat victories (framework.ts threatGameEndPolicy): 95% of the Reclaimers' assets destroyed, or the mega-station fired. */
export const BEACON_CODE_ASSETS = 2153;
export const BEACON_CODE_MEGA = 2154;

/** Galaxy.MaxSolarSystemSize: a ship this close to a system's star is inside the system. */
export const SYSTEM_RADIUS = 23000;

// ---------------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------------

/**
 * 'lead': from the first mega beam on, the Watcher is the flagship of a Watcher fleet (beaconFleet.ts) and has no routine of its own.
 * 'muster': the Great Work is finished and the first beam not yet fired: the Watcher gathers, cloaked, round the Beacon (beacon.ts musterWatchers).
 */
export type WatcherMode = 'parked' | 'travel' | 'dwell' | 'sighting' | 'return' | 'fight' | 'lead' | 'muster' | 'guard' | 'dead';

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
    /** Site defence (beaconSite.ts): it was called to the Great Work's site by an attack on it before the first beam, and fires on every empire ship in that system while it fights. */
    siteFight?: boolean;
    /** It was moved to the site from where it was (a trip, a rest): when the fight is over it goes back to it (or rests) instead of resuming in place. */
    teleported?: boolean;
}

/**
 * The site's own defence before the first mega beam (beaconSite.ts): the Great Work's scaffold (and the finished Beacon) carry a shield; an attack on
 * them calls the Watchers to the site, and a broken shield brings a Reclaimer fleet. Absent until the first attack.
 */
export interface SiteDefence {
    /** An attack on the site is on (the Watchers fight, the fleet may fire); ends after beaconSiteQuietDays without a hit and no empire warship near. */
    active: boolean;
    /** Star date of the last attack on the site. */
    lastAttack: number;
    /** builtObjectIDs of attackers that are no empire's ordinary ships (pirates, monsters): the site's defenders may fire on them. */
    attackerIds: number[];
    /** The shield broke before the first beam and the fleet came (star date; 0: not yet). */
    fleetDate: number;
    /** The fleet that came (the Watchers' faction); after the beam they join the Beacon's guard. */
    fleet: BuiltObject[];
    /** The fleet was handed to the guard (st.guards) after the beam. */
    handed?: boolean;
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

/**
 * A response fleet or patrol of the Reclaimers (beaconResponse.ts). A 'reserve' waits at its post near a core and goes to a held world that is invaded,
 * blockaded or besieged (mode 'respond'), then returns ('return'); a 'patrol' keeps moving along its route of nearby held worlds.
 */
export interface ResponseFleet {
    id: number;
    kind: 'reserve' | 'patrol';
    ships: BuiltObject[];
    /** Reserve: the world it waits at. */
    post: Habitat | null;
    mode: 'post' | 'respond' | 'return';
    /** Respond: the world it defends. */
    target: Habitat | null;
    modeDate: number;
    /** Respond: its strength when it set out. */
    startStrength: number;
    /** Respond: the star date the threat was last seen at the target (the fleet returns after beaconResponseCalmDays without it). */
    threatSeen: number;
    /** Patrol: the route (held worlds), the leg being flown, and the star date it got there (0 on the way). */
    route: Habitat[];
    leg: number;
    arrivedAt: number;
    /** Patrol: it is in contact with an enemy now (an encounter is counted when it begins). */
    engaged: boolean;
}

/**
 * A refugee interceptor group (beaconInterceptors.ts): a cruiser carrying assault pods (the first ship), a destroyer and two frigates. It patrols the
 * Reclaimer-held worlds (`patrol`), at its leisure raids a private station (`raid`), and drops everything to chase a detected relocation transport (`chase`).
 */
export interface InterceptorGroup {
    id: number;
    ships: BuiltObject[];
    mode: 'patrol' | 'chase' | 'raid';
    modeDate: number;
    /** Patrol: the route (held worlds), the leg being flown, and the star date it got there (0 on the way). */
    route: Habitat[];
    leg: number;
    arrivedAt: number;
    /** Chase: the transport; raid: the station. */
    target: BuiltObject | null;
    /** The cruiser may drag a ship out of warp again from this star date (its own cooldown). */
    pullReady: number;
    /** Star date of the last raid started. */
    lastRaid: number;
}

export interface InterceptorRec {
    groups: InterceptorGroup[];
    nextId: number;
    /** Star date of the last build pass. */
    lastBuild: number;
    stats: Record<string, number>;
}

export interface ResponseRec {
    fleets: ResponseFleet[];
    nextId: number;
    /** Strength still to be built for the reserves / the patrols (their share of the seasons' budgets, banked). */
    reserveAllow: number;
    patrolAllow: number;
    /** A patrol met a superior force near a held world (it reports it: the reserves may answer). */
    alerts: { world: Habitat; date: number; enemy: number }[];
    /** Worlds whose threat the reserves judged hopeless now (counted once each time it begins). */
    hopeless: Habitat[];
    stats: Record<string, number>;
}

/** A ship's order before a pursuit took it (beaconPursuit.ts): restored when the chase ends. */
export interface PriorOrder {
    ship: BuiltObject;
    type: number;
    habitat: Habitat | null;
    target: BuiltObject | null;
    x: number;
    y: number;
}

/**
 * One pursuit (beaconPursuit.ts): a Reclaimer capital and some escorts chase `target`, a ship of an empire at war with them that left a fight
 * by hyperjump. `pulled` is the star date the target was dragged out of warp (or the pursuers arrived where it stopped); 0 while still chasing.
 */
export interface PursuitChase {
    id: number;
    capital: BuiltObject;
    escorts: BuiltObject[];
    target: BuiltObject;
    start: number;
    originX: number;
    originY: number;
    pulled: number;
    prior: PriorOrder[];
    /** Star date of the last defended-place check once the enemy stopped. */
    defChecked?: number;
}

/** A pursuit record: the chases under way, who fought whom lately, per-capital cooldowns, ships that may not start a jump, the counters. */
export interface PursuitRec {
    chases: PursuitChase[];
    nextId: number;
    /** Star date of the last sampling of the fights. */
    sampled: number;
    /** Enemy ships that fought a Reclaimer ship lately (`by`), with the star date of the last contact. */
    contacts: { victim: BuiltObject; by: BuiltObject; date: number }[];
    cooldown: { capital: BuiltObject; until: number }[];
    /** Ships pulled out of warp: no jump may start before `until` (star date). */
    locks: { ship: BuiltObject; until: number }[];
    /** Per human empire: the star date of its last 'pulled out of warp' message. */
    msgLast: Record<string, number>;
    stats: Record<string, number>;
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
    /** Star date the scaffold first waited at 99.9 % for the gate (absent: not yet): the baseline siphon begins and a Watcher guards it from then. */
    holdSince?: number;
}

/** A research moratorium the Diet passed: members that break it (their research is not slowed), breaches seen per empire, empires sanctioned. */
export interface MoratoriumRec {
    since: number;
    until: number;
    proposer: number;
    breakers: number[];
    breaches: Record<string, number>;
    sanctioned: number[];
    lastCheck: number;
}

/** The people a member world took in from the evacuated zone (beaconDiet.ts): the amount in the current window, its start, and until when the world earns less (by the intake's share of its population). */
export interface EvacIntake {
    colony: Habitat;
    amount: number;
    since: number;
    slowUntil: number;
    /** The world's population before the window's first intake, and whether the news line for the window was sent (absent in older saves). */
    basePop?: number;
    noted?: boolean;
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

/** Season 1 is a BEAM season: its 'prep' is a countdown with no groups and no staging points (fireBeam brings the groups through). Later seasons have both. Pure. */
export function isBeamCountdown(s: { phase: string; groups: readonly unknown[]; staging: readonly unknown[] }): boolean {
    return s.phase === 'prep' && s.groups.length === 0 && s.staging.length === 0;
}

export type SeasonPhase = 'prep' | 'offensive' | 'quiet';

export interface Season {
    n: number;
    phase: SeasonPhase;
    start: number;
    /** The phase's planned end (prep: the departure, or for season 1's beam countdown the beam; offensive: the cap; quiet: the next prep). */
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
    /** The empires that know this is a harvest core (empire ids; absent: none): learned from the navigation record of a destroyed or boarded cattle ship (beaconHarvest.ts noteCattleCore). */
    knownBy?: number[];
    /** retaken: an empire took the world back; broken: its harvester was destroyed; lost: the world was destroyed or slipped away. */
    ended: 'retaken' | 'broken' | 'lost' | null;
    endDate: number;
}

/**
 * Where a pool cattle ship is in its shuttle loop: out (empty, flying to the held world `from`), loading (at that world), in (laden, flying to its
 * core), home (empty, flying back to its core), idle (at its core: waiting for a run or mending).
 */
export type CattlePhase = 'out' | 'loading' | 'in' | 'home' | 'idle';

/**
 * A cattle ship of a core's pool (beaconHarvest.ts): it shuttles between the core and the held worlds that are due a collection, carrying
 * a slice of a world's people to the core's pens. `core` is its home core; `from` the world of the run in hand (the core's world when idle).
 * Saves from before the shuttle have no `phase`: a ship with people aboard is `in` (it docks, then stays as a pool ship), an empty one idle.
 */
export interface CattleRec {
    ship: BuiltObject;
    from: Habitat;
    core: Habitat;
    load: Captive[];
    total: number;
    launched: number;
    phase?: CattlePhase;
    /** Set on a ship from a save before the shuttle (no `phase`): a ship beyond its pool's size is retired once it has docked and unloaded. */
    legacy?: boolean;
    /** The star date the loading at `from` is done; for a laden ship at its core, the star date the unloading is (beaconCattleUnloadDays). */
    loadUntil?: number;
    /** Warships escorting it (beaconHarvest.ts assignEscorts), and those of them built for it (they join the reserve when it docks). */
    escorts?: BuiltObject[];
    built?: BuiltObject[];
    /** A seized relocation transport (beaconInterceptors.ts): not a pool ship; it flies its people to the core's pens and is scrapped there (`from`: the world they were taken from). */
    seized?: boolean;
}

/** A replacement cattle ship on order (beaconHarvest.ts): paid when the fleet biofuel allows, built beaconCattleBuildDays later at the core. */
export interface CattleOrder {
    core: Habitat;
    paid: boolean;
    ready: number;
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
    /** The shuttle: pool ships spawned to fill a pool, replacements ordered / built, runs that never loaded (the world was gone). */
    cattleSpawned?: number;
    cattleOrdered?: number;
    cattleRebuilt?: number;
    cattleRetired?: number;
    cattleRunsAborted?: number;
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
    /** Evacuation motions passed; worlds slowed by taking in the evacuees. */
    evacuations?: number;
    evacSlowed?: number;
    /** Escorts assigned to cattle ships by tier (light / destroyer / cruiser), built for them, and cattle ships whose escort fell. */
    escortLight?: number;
    escortMid?: number;
    escortHeavy?: number;
    escortBuilt?: number;
    escortLost?: number;
    /** Relocation transports seized by the refugee interceptors / the ones whose people were penned (beaconInterceptors.ts, beaconHarvest.ts). */
    transportsSeized?: number;
    transportsPenned?: number;
}

/** One empire's progress on the mega-station blueprint (a scenario research sink: a share of its research output while it is selected). */
export interface BlueprintRec {
    /** Star date the empire reached the drifting planet. */
    since: number;
    /** Research points put into it, of beaconBlueprintCost. */
    progress: number;
    /** Share (%) of the empire's research output it takes (0 = paused). */
    sharePct: number;
    /** Finished (the mega-station's design is known). */
    done?: boolean;
}

/** The parts one empire holds toward the mega-station (carried across ages). */
export interface EmpireParts {
    /** The beam lens: the Beacon destroyed after it fired. */
    beamLens?: boolean;
    /** The link conduit: a harvester destroyed. */
    linkConduit?: boolean;
    /** The cloak lattice (a Watcher part): a Watcher destroyed. */
    cloakLattice?: boolean;
    /** Reclaimer capital ships its ships destroyed (30 needed). */
    mindFragments?: number;
    /** Void frames, one per foundry destroyed (4 needed; foundries do not exist yet). */
    voidFrames?: number;
    blueprint?: BlueprintRec;
}

/** The mega-station path (beaconComponents.ts): parts per empire, the Reclaimers' asset peak, the drifting planet. Absent before first use. */
export interface PartsRec {
    /** Empire id → its parts. */
    held: Record<string, EmpireParts>;
    /** The Reclaimers' highest asset index so far (ships and bases by strength, held worlds as that many ships), and the last one measured. */
    peakAssets: number;
    lastAssets: number;
    /** The largest average ship strength seen (the unit a held world is worth ships of). */
    shipUnit: number;
    /** Star date of the first mega beam (0: not fired). */
    firstBeam: number;
    /** The drifting precursor planet's place, and the star date everyone learned of it (0: not yet). */
    planet?: { x: number; y: number };
    revealDate: number;
    /** Empire ids that reached the planet. */
    visited: number[];
    /** Empire id → the ship an AI sent to the planet and when. */
    sent?: Record<string, { id: number; date: number }>;
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
    /** Star date of the last ticker message of a throttled kind (detect per Watcher, decloak / cloak per world) to an empire: key 'kind:subject:empireId' (beacon.ts watcherMessage). */
    msgLast?: Record<string, number>;
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
    /**
     * The war has begun: the first mega beam was fired (or the Beacon fell before it). False from the Great Work's completion to that beam (the Watchers
     * muster cloaked round the Beacon); absent in saves from before the beam, which are at war already (warOn).
     */
    warStarted?: boolean;
    /** The siphon (created on first use: absent in older saves, where it starts at the share the build had made). */
    siphon?: SiphonRec;
    /** Star date the Watchers appeared (absent in older saves: the first siphon pass sets it). */
    rollDate?: number;
    /** Cattle interceptions per held world (beaconHarvest.ts escorts). */
    intercepts?: InterceptRec[];
    /** The research moratorium the Diet passed last (beaconDiet.ts): who breaks it, the breaches seen and who was sanctioned. */
    moratorium?: MoratoriumRec;
    /** Member worlds that took in the Diet's evacuees (beaconDiet.ts; absent before the first). */
    evacIntakes?: EvacIntake[];
    /** The site's own defence before the first beam (beaconSite.ts); absent until the site is first attacked. */
    defence?: SiteDefence;
    stats: BeaconStats;
    ended: boolean;
    /** Spawned from the Game Editor / a test: the existence-year gates are skipped. */
    forced?: boolean;
    /** The AI coalition's standing operations (beaconAi.ts), by key ('beacon', 'staging:<season>:<point>'): the rally star's system index (-1 none) and whether the force has gone in; launches counts the Beacon assaults. */
    /** The response fleets and patrols (beaconResponse.ts; absent before they first ran and in older saves). */
    response?: ResponseRec;
    /** Capital pursuits (beaconPursuit.ts; absent before the first contact and in older saves). */
    pursuit?: PursuitRec;
    /** The Reclaimer foundries (beaconFoundry.ts; raised when the Beacon is finished, absent in older saves until their first reclamation pass). */
    foundries?: FoundryState;
    /** The refugee interceptors (beaconInterceptors.ts; absent before they first ran and in older saves). */
    interceptors?: InterceptorRec;
    /** The harvest (beaconHarvest.ts; absent before it first ran): cores (live and ended, the last 40 kept), cattle ships in flight, worlds
     *  that may not be made a core again before a date (their harvester was destroyed), the biofuel accounts. */
    cores?: CoreRec[];
    cattle?: CattleRec[];
    /** Replacement cattle ships ordered for a core after a loss: paid from the fleet biofuel, ready `ready` (a star date; 0 until paid). */
    cattleOrders?: CattleOrder[];
    coreBans?: { colony: Habitat; until: number }[];
    fuel?: FuelRec;
    /** The launch record (the art's beam, camera and pop-up fire once per launch): how many times the strike groups were called out and
     *  the star date of the last call (set in the pass that orders the simultaneous departure; saved, so it holds across save / load). */
    launches?: number;
    /** The empire that destroyed the Beacon (empireId; absent: unknown / not an empire) and whether the victory for destroying it after a launch was declared. */
    beaconKillerId?: number;
    destroyVictoryDone?: boolean;
    lastLaunchDate?: number;
    /** The mega-station path (beaconComponents.ts): parts, asset peak, the drifting planet. */
    parts?: PartsRec;
    /** Where the Reclaimers' ships are made and gather once the Beacon is gone (their biggest held world; absent: the site). */
    yard?: { x: number; y: number };
    /** The mega-station was fired (a placeholder for the later ages: the threat's other victory). */
    megaFired?: boolean;
    /** The asset victory was declared. */
    assetVictoryDone?: boolean;
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

/** The Reclaimers are at war with the galaxy: the first mega beam was fired. A save from before the beam (no record) is at war once the Reclamation began. Pure. */
export function warOn(st: BeaconState): boolean {
    return st.phase === 'reclamation' && st.warStarted !== false;
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
    if (st.phase !== 'watching') return true;
    if (siphonOf(galaxy, st).total >= P.siphonRequired(galaxy)) return true;
    // the hard upper limit: after beaconSiphonMaxYears the Beacon ripens whatever was siphoned
    const max = P.siphonMaxYears(galaxy);
    return max > 0 && st.rollDate !== undefined && galaxyStarDate(galaxy) - st.rollDate >= max * 360 * GAME_DAY_LENGTH;
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
    /** The Watcher's speeds: extra main engines (with reactors and fuel) are added until the design reaches these (0 top speed: the template's engines). */
    watcherTopSpeed: (g: Galaxy) => p(g, 'beaconWatcherTopSpeed', 20),
    watcherCruiseSpeed: (g: Galaxy) => p(g, 'beaconWatcherCruiseSpeed', 12),
    watcherArmourPct: (g: Galaxy) => p(g, 'beaconWatcherArmourPct', 350),
    watcherShieldPct: (g: Galaxy) => p(g, 'beaconWatcherShieldPct', 200),
    /** The Great Work's scaffold shield before the Beacon is finished (the finished Beacon has its own plating); days its schedule keeps a broken shield down. */
    siteShields: (g: Galaxy) => p(g, 'beaconSiteShields', 25000),
    siteShieldRechargeDays: (g: Galaxy) => p(g, 'beaconSiteShieldRechargeDays', 30),
    /** The Reclaimer fleet a broken site shield brings: % of the strongest attacking force in the system, its floor and its ship cap. */
    siteFleetPct: (g: Galaxy) => p(g, 'beaconSiteFleetPct', 150),
    siteFleetMin: (g: Galaxy) => p(g, 'beaconSiteFleetMin', 3000),
    siteFleetMaxShips: (g: Galaxy) => p(g, 'beaconSiteFleetMaxShips', 40),
    /** Days without a hit (and no empire warship near) after which a site fight is over. */
    siteQuietDays: (g: Galaxy) => p(g, 'beaconSiteQuietDays', 15),
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
    siphonRequired: (g: Galaxy) => Math.max(0, p(g, 'beaconSiphonRequired', 2000)),
    siphonRate: (g: Galaxy) => Math.max(0, p(g, 'beaconSiphonRate', 1)),
    /** Fallbacks so the Beacon cannot stall for ever: a baseline siphon (points a month) from the moment the scaffold waits at 99.9 % for the gate (about two years from nothing), the Beacon completable regardless after beaconSiphonMaxYears; the Watchers
     *  may corrupt any colony of up to beaconCorruptFallbackPop million people when fewer than beaconCorruptMinPool of the start-independent worlds are left. */
    siphonBaseline: (g: Galaxy) => Math.max(0, p(g, 'beaconSiphonBaseline', 80)),
    siphonMaxYears: (g: Galaxy) => Math.max(0, p(g, 'beaconSiphonMaxYears', 30)),
    corruptFallbackPop: (g: Galaxy) => Math.max(0, p(g, 'beaconCorruptFallbackPop', 30)) * 1e6,
    corruptMinPool: (g: Galaxy) => Math.max(0, Math.trunc(p(g, 'beaconCorruptMinPool', 3))),
    /** Purge: the rebels' ground strength for a max-population colony (beaconPurgeRebelPopFull, millions), the floor for a tiny one,  and the least (%) of it the owner's defenders must outweigh before the AI tries; days a purged world is left alone by the Watchers. */
    purgeRebelStrength: (g: Galaxy) => p(g, 'beaconPurgeRebelStrength', 750000),
    purgeRebelMin: (g: Galaxy) => Math.max(1200, p(g, 'beaconPurgeRebelMin', 50000)),
    purgeRebelPopFull: (g: Galaxy) => Math.max(1, p(g, 'beaconPurgeRebelPopFull', 2000)) * 1e6,
    purgeRebelRegiments: (g: Galaxy) => Math.max(1, Math.trunc(p(g, 'beaconPurgeRebelRegiments', 12))),
    aiPurgeMarginPct: (g: Galaxy) => p(g, 'beaconAiPurgeMarginPct', 130),
    /** The Diet's research moratorium: research is slowed by this % galaxy-wide for this many days; a member that broke it is sanctioned after this many breaches (one is counted a month). */
    moratoriumPct: (g: Galaxy) => Math.max(0, Math.min(95, p(g, 'beaconMoratoriumPct', 40))),
    moratoriumDays: (g: Galaxy) => Math.max(30, p(g, 'beaconMoratoriumDays', 720)),
    moratoriumSanctionAfter: (g: Galaxy) => Math.max(1, Math.trunc(p(g, 'beaconMoratoriumSanctionAfter', 3))),
    /** Cattle escorts: on / off; a world's interceptions fall by 1 every this many days; the world with the most interceptions sends destroyers from this many, cruisers from beaconEscortCruiserAt. */
    escortsOn: (g: Galaxy) => p(g, 'beaconEscortsOn', 1) > 0,
    escortDecayDays: (g: Galaxy) => Math.max(1, p(g, 'beaconEscortDecayDays', 360)),
    escortDestroyerAt: (g: Galaxy) => p(g, 'beaconEscortDestroyerAt', 1),
    escortCruiserAt: (g: Galaxy) => p(g, 'beaconEscortCruiserAt', 3),
    /** The repeat detection / decloak / cloak messages: at most one per Watcher (detect) or world (decloak, cloak) per empire in this many days; the first of each always shows. */
    msgRepeatDays: (g: Galaxy) => Math.max(0, p(g, 'beaconMsgRepeatDays', 120)),
    reseedDays: (g: Galaxy) => p(g, 'beaconReseedDays', 120),
    /** Build speed: +this % per corrupted world (up to the cap %); a dead Watcher multiplies it by the factor %. */
    buildBoostPct: (g: Galaxy) => p(g, 'beaconBuildBoostPct', 4),
    buildBoostCapPct: (g: Galaxy) => p(g, 'beaconBuildBoostCapPct', 50),
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
    /** Days from the Great Work's completion to the FIRST mega beam (the countdown: war, the Watchers decloak, season 1's groups arrive through the beam). */
    beamDelayDays: (g: Galaxy) => p(g, 'beaconBeamDelayDays', 10),
    /** A save from before the beam, between completion and season 1: days to season 1's preparation. */
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
    /** The Beacon station's armour plates keep this % of their reactive rating (25: only hits of 2.5 or less do nothing; UltraDense 10: a hit of 10 or less does nothing; the beams' damage falls with range, so a coalition of ordinary beams could never hurt it). */
    stationReactivePct: (g: Galaxy) => Math.max(0, p(g, 'beaconStationReactivePct', 25)),
    /** Every other Reclaimer ship's plates keep this % of their reactive rating (60: UltraDense 10 -> 6, a notch below the tech-5 Reactive Armor's 7; user 2026-10-19). */
    fleetReactivePct: (g: Galaxy) => Math.max(0, p(g, 'beaconFleetReactivePct', 60)),
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
    // The response fleets and patrols (beaconResponse.ts)
    /** 1: reserve fleets answer threatened held worlds and patrols walk between them (0: neither, the season keeps the whole budget). */
    respOn: (g: Galaxy) => p(g, 'beaconResponseOn', 1) > 0,
    /** The share (%) of each season's budget put to the reserve fleets / the patrols (the strike groups get the rest). */
    respSharePct: (g: Galaxy) => Math.max(0, Math.min(40, p(g, 'beaconResponseSharePct', 12))),
    patrolSharePct: (g: Galaxy) => Math.max(0, Math.min(40, p(g, 'beaconPatrolSharePct', 6))),
    /** One reserve fleet per this many held worlds (at least one); a patrol per beaconPatrolWorldsPer held worlds (from three held worlds), at most beaconPatrolMax. */
    respWorldsPer: (g: Galaxy) => Math.max(1, Math.trunc(p(g, 'beaconResponseWorldsPer', 8))),
    patrolWorldsPer: (g: Galaxy) => Math.max(1, Math.trunc(p(g, 'beaconPatrolWorldsPer', 6))),
    patrolMax: (g: Galaxy) => Math.max(0, Math.trunc(p(g, 'beaconPatrolMax', 6))),
    /** A reserve fleet's / a patrol's strength, in % of one strike group's quota of the scripted season strength. */
    respFleetPct: (g: Galaxy) => p(g, 'beaconResponseFleetPct', 60),
    patrolFleetPct: (g: Galaxy) => p(g, 'beaconPatrolFleetPct', 25),
    /** A reserve goes only when it and the ships already there outweigh the enemy by this %; it turns back when it has lost this % of its strength. */
    respRatioPct: (g: Galaxy) => p(g, 'beaconResponseRatioPct', 120),
    respMaxLossPct: (g: Galaxy) => p(g, 'beaconResponseMaxLossPct', 60),
    /** Enemy warships this close to a held world (units) threaten it; reserves answer within this many sectors; they return after this many calm days. */
    respThreatRange: (g: Galaxy) => p(g, 'beaconResponseThreatRange', 30000),
    respReachSectors: (g: Galaxy) => p(g, 'beaconResponseReachSectors', 14),
    respCalmDays: (g: Galaxy) => p(g, 'beaconResponseCalmDays', 10),
    /** A patrol stays this many days at a world before it flies on; its route has at most this many worlds, each within this many sectors of the last. */
    patrolDwellDays: (g: Galaxy) => p(g, 'beaconPatrolDwellDays', 15),
    patrolRouteLen: (g: Galaxy) => Math.max(1, Math.trunc(p(g, 'beaconPatrolRouteLen', 4))),
    /** A patrol reports a force this % of its own strength (or more) to the reserves. */
    patrolReportPct: (g: Galaxy) => p(g, 'beaconPatrolReportPct', 120),
    patrolHopSectors: (g: Galaxy) => p(g, 'beaconPatrolHopSectors', 6),
    // The mega-station path (beaconComponents.ts)
    /** The Reclaimers lose when this % of their peak assets (ships, bases and held worlds, as a strength index) is destroyed. */
    assetVictoryPct: (g: Galaxy) => Math.max(1, Math.min(100, p(g, 'beaconAssetVictoryPct', 95))),
    /** A held world counts as this many average ships in the asset index. */
    assetWorldShips: (g: Galaxy) => Math.max(0, p(g, 'beaconAssetWorldShips', 10)),
    /** The asset victory needs a peak of at least this many average ships (a Reclamation that never got going is not "broken"). */
    assetMinPeakShips: (g: Galaxy) => Math.max(0, p(g, 'beaconAssetMinPeakShips', 30)),
    /** Days from the first mega beam to the Guardians' reveal of the drifting planet. */
    revealDays: (g: Galaxy) => Math.max(0, p(g, 'beaconRevealDays', 360)),
    /** The blueprint's research cost in points, and the share (%) of an empire's research a started project takes. */
    blueprintCost: (g: Galaxy) => Math.max(1, p(g, 'beaconBlueprintCost', 5000000)),
    blueprintSharePct: (g: Galaxy) => Math.max(0, Math.min(100, p(g, 'beaconBlueprintSharePct', 25))),
    /** The planet is reached by a ship within this many units. */
    planetReach: (g: Galaxy) => Math.max(1000, p(g, 'beaconPlanetReach', 30000)),
    /** Mind fragments and void frames the mega-station needs. */
    mindFragmentsNeeded: (g: Galaxy) => Math.max(1, Math.trunc(p(g, 'beaconMindFragmentsNeeded', 30))),
    voidFramesNeeded: (g: Galaxy) => Math.max(1, Math.trunc(p(g, 'beaconVoidFramesNeeded', 4))),
    /** A part changes hands in a trade at this value (credits' worth, for the AI's evaluation). */
    /** The attitude toward the receiver a giver needs for a part to change hands. */
    partTradeAttitude: (g: Galaxy) => p(g, 'beaconPartTradeAttitude', 10),
    partTradeValue: (g: Galaxy) => Math.max(1, p(g, 'beaconPartTradeValue', 30000)),
    // Capital pursuit (beaconPursuit.ts)
    /** 1: a Reclaimer capital (with escorts) follows an enemy that fled a fight by hyperjump and drags it out of warp (0: no pursuit). */
    pursuitOn: (g: Galaxy) => p(g, 'beaconPursuitOn', 1) > 0,
    /** Most pursuits at once; the most escorts that go with a capital. */
    pursuitMax: (g: Galaxy) => Math.max(0, Math.trunc(p(g, 'beaconPursuitMax', 6))),
    pursuitEscorts: (g: Galaxy) => Math.max(1, Math.trunc(p(g, 'beaconPursuitEscorts', 4))),
    /** A flight is pursued only if the enemy fought a Reclaimer ship this many days before it went into warp. */
    pursuitContactDays: (g: Galaxy) => p(g, 'beaconPursuitContactDays', 12),
    /** The farthest a pursuit goes from where it began (sectors), the days before it gives up, and the days a capital rests after one. */
    pursuitMaxSectors: (g: Galaxy) => p(g, 'beaconPursuitMaxSectors', 4.5),
    pursuitGiveUpDays: (g: Galaxy) => p(g, 'beaconPursuitGiveUpDays', 50),
    pursuitCooldownDays: (g: Galaxy) => p(g, 'beaconPursuitCooldownDays', 90),
    /** A pursuer within this many units of the enemy in warp pulls it out of warp. */
    pursuitPullRange: (g: Galaxy) => p(g, 'beaconPursuitPullRange', 40000),
    /** The pursuers need a warp speed this % of the enemy's (or more); their jump spools this % of the stock time. */
    pursuitSpeedPct: (g: Galaxy) => p(g, 'beaconPursuitSpeedPct', 110),
    pursuitSpoolPct: (g: Galaxy) => p(g, 'beaconPursuitSpoolPct', 25),
    /** No pursuit when the capital and its escorts are this % undamaged or less (share of components not damaged). */
    pursuitMinHealthPct: (g: Galaxy) => p(g, 'beaconPursuitMinHealthPct', 60),
    /** Days after a pull-out that the dragged ship cannot start another jump; days the pursuit stays on to fight after it. */
    pursuitLockDays: (g: Galaxy) => p(g, 'beaconPursuitLockDays', 30),
    pursuitFightDays: (g: Galaxy) => p(g, 'beaconPursuitFightDays', 45),
    /** The pursuit stops at a place where the enemy's defence outweighs the pursuers by this % (a defended system's edge). */
    pursuitDefencePct: (g: Galaxy) => p(g, 'beaconPursuitDefencePct', 80),
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
    /** Cattle ships: a held world is due a collection every this many days, carrying this % of the people it had when taken; at most this many in all pools; their plating, their holds and their slow spool. */
    cattleDays: (g: Galaxy) => Math.max(1, p(g, 'beaconCattleDays', 20)),
    cattleLoadPct: (g: Galaxy) => Math.max(0.1, p(g, 'beaconCattleLoadPct', 5)),
    cattleMax: (g: Galaxy) => Math.max(0, Math.trunc(p(g, 'beaconCattleMax', 150))),
    /** The shuttle (beaconHarvest.ts): a core's pool has one ship per this many feeder worlds (at least one, at most beaconCattlePoolMax); a ship loads
     *  for this many days at a world; one damaged beyond this % of its parts stays at the core to mend, the mending there runs at this factor of the
     *  stock rate (away from the core, at the field factor); a lost ship is replaced for this % of the reference military in fleet biofuel, built this many days after it is paid. */
    cattlePoolWorldsPer: (g: Galaxy) => Math.max(1, p(g, 'beaconCattlePoolWorldsPer', 1)),
    cattlePoolMax: (g: Galaxy) => Math.max(1, Math.trunc(p(g, 'beaconCattlePoolMax', 30))),
    cattleLoadDays: (g: Galaxy) => Math.max(0, p(g, 'beaconCattleLoadDays', 3)),
    /** A laden ship docked at its core unloads this many game days later (it sits at the harvester meanwhile). */
    cattleUnloadDays: (g: Galaxy) => Math.max(0, p(g, 'beaconCattleUnloadDays', 3)),
    cattleRepairDamagePct: (g: Galaxy) => Math.max(0, Math.min(100, p(g, 'beaconCattleRepairDamagePct', 20))),
    cattleRepairFactor: (g: Galaxy) => Math.max(0.01, p(g, 'beaconCattleRepairFactor', 1)),
    cattleFieldRepairFactor: (g: Galaxy) => Math.max(0.01, p(g, 'beaconCattleFieldRepairFactor', 0.1)),
    cattleBuildFuelPct: (g: Galaxy) => Math.max(0, p(g, 'beaconCattleBuildFuelPct', 2)),
    cattleBuildDays: (g: Galaxy) => Math.max(0, p(g, 'beaconCattleBuildDays', 60)),
    cattleArmourPct: (g: Galaxy) => p(g, 'beaconCattleArmourPct', 100),
    cattleHoldPct: (g: Galaxy) => p(g, 'beaconCattleHoldPct', 250),
    /** Their hyperdrive spools this many times as long as a warship's (they sit exposed at the world they leave). */
    /** A cattle ship's hyperdrive spools this many game seconds before each jump (1x speed). */
    cattleSpoolSeconds: (g: Galaxy) => p(g, 'beaconCattleSpoolSeconds', 120),
    /** The captives killed with a destroyed cattle ship: this % of them count toward the Reclaimers' eliminated people (the loss measure; 0: the
     *  interceptors killed them, not the Reclaimers; they are gone from the galaxy all the same). */
    cattleDeadCountPct: (g: Galaxy) => p(g, 'beaconCattleDeadCountPct', 0),
    /** A destroyed cattle ship: this % of its captives escape in pods (to their world of origin, else the nearest free colony); the rest die. */
    cattleSurvivePct: (g: Galaxy) => Math.max(0, Math.min(100, p(g, 'beaconCattleSurvivePct', 70))),
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
    if (st.beacon !== null && !st.beacon.hasBeenDestroyed && !(st.beaconDestroyed && st.yard !== undefined)) return { x: st.beacon.xpos, y: st.beacon.ypos };
    // the Beacon is gone and the Reclamation carries on: its ships are made at, and gather round, its biggest held world (beaconComponents.ts refreshYard)
    if (st.yard !== undefined && st.phase === 'reclamation') return st.yard;
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
