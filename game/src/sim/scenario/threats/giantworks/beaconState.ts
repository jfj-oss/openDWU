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

/** Galaxy.MaxSolarSystemSize: a ship this close to a system's star is inside the system. */
export const SYSTEM_RADIUS = 23000;

// ---------------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------------

export type WatcherMode = 'parked' | 'travel' | 'dwell' | 'sighting' | 'return' | 'fight' | 'dead';

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
    /** Empires that attacked it (it is at locked war with them). */
    attackedBy: number[];
    /** Per-empire knowledge of the Watcher (Rumour: a cloaked vessel was detected; Suspected: seen more than once). */
    knowledge: ThreatKnowledge[];
    detections: number;
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
    /** The colonies that were independent at the start (the Watchers corrupt only these). */
    formerIndependents: Habitat[];
    watchers: WatcherRec[];
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
    stats: BeaconStats;
    ended: boolean;
    /** Spawned from the Game Editor / a test: the existence-year gates are skipped. */
    forced?: boolean;
}

export function newStats(): BeaconStats {
    return {
        corrupted: 0, purged: 0, rose: 0, sightings: 0, watcherDetections: 0, seasons: 0, spawned: 0, transportsSpawned: 0, thrallConvoys: 0, conquests: 0, landingsWon: 0, landingsLost: 0,
        planetsDestroyed: 0, popDrained: 0, popDestroyed: 0, raids: 0, offers: 0, accepted: 0, refused: 0, discoveries: 0, salvageSteps: 0, stagingHits: 0, thrallIntercepted: 0,
    };
}

function newState(): BeaconState {
    return {
        site: null, faction: null, phase: 'watching', rndCounter: 0, sentStages: {}, formerIndependents: [], watchers: [], sighted: [], corrupted: [], nextSightingDate: 0, completeDate: 0, beacon: null, beaconDestroyed: false,
        beaconKnowledge: [], guards: [], guardDate: 0, thrallShips: [], seasons: [], season: null, nextGroupId: 1, processing: [], raids: [], nextRaidDate: 0, reserve: [], popBaseline: 0, popEliminated: 0, bargains: [], lostBy: {}, offered: {},
        nextOfferDate: 0, salvage: [], reclamationDate: 0, stats: newStats(), ended: false,
    };
}

export function beaconState(galaxy: Galaxy): BeaconState {
    return threatState(galaxy, BEACON_KEY, newState);
}

export function peekBeaconState(galaxy: Galaxy): BeaconState | null {
    return peekThreatState<BeaconState>(galaxy, BEACON_KEY);
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
    watcherTechBonus: (g: Galaxy) => p(g, 'beaconWatcherTechBonus', 2),
    /** Days between a Watcher's corruption trips (min / max). */
    corruptMinDays: (g: Galaxy) => p(g, 'beaconCorruptMinDays', 80),
    corruptMaxDays: (g: Galaxy) => p(g, 'beaconCorruptMaxDays', 160),
    dwellDays: (g: Galaxy) => p(g, 'beaconDwellDays', 30),
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
    purgeCost: (g: Galaxy) => p(g, 'beaconPurgeCost', 250000),
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
    groupsMax: (g: Galaxy) => Math.max(1, Math.trunc(p(g, 'beaconGroupsMax', 10))),
    /** Season strength: % of the reference military (mean of the three strongest empires), season 1, growth per season, per processing world, cap. */
    strengthPct: (g: Galaxy) => p(g, 'beaconStrengthPct', 65),
    strengthGrowthPct: (g: Galaxy) => p(g, 'beaconStrengthGrowthPct', 14),
    strengthPerWorldPct: (g: Galaxy) => p(g, 'beaconStrengthPerWorldPct', 7),
    strengthCapPct: (g: Galaxy) => p(g, 'beaconStrengthCapPct', 360),
    minSeasonStrength: (g: Galaxy) => p(g, 'beaconMinStrength', 1500),
    /** Largest number of warships one season spawns. */
    maxSeasonShips: (g: Galaxy) => Math.trunc(p(g, 'beaconMaxSeasonShips', 160)),
    /** Most troop transports one strike group has (a world needing more troops than they carry is not struck). */
    maxTransports: (g: Galaxy) => Math.trunc(p(g, 'beaconMaxTransports', 8)),
    /** Troops of a landing must beat the defence by this % (and a failed landing at a target raises it). */
    assaultMarginPct: (g: Galaxy) => p(g, 'beaconAssaultMarginPct', 150),
    assaultFailStepPct: (g: Galaxy) => p(g, 'beaconAssaultFailStepPct', 30),
    // Conquest and processing
    drainMonths: (g: Galaxy) => p(g, 'beaconDrainMonths', 8),
    /** Thrall strength made per million people drained. */
    thrallPerMillion: (g: Galaxy) => p(g, 'beaconThrallPerMillion', 400000),
    garrisonStrength: (g: Galaxy) => p(g, 'beaconGarrison', 1500000),
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
    for (const w of st.watchers) if (w.ship !== null && !w.ship.hasBeenDestroyed) out.push(w.ship);
    return out;
}

export function liveWatchers(st: BeaconState): WatcherRec[] {
    return st.watchers.filter((w) => !w.dead && w.ship !== null && !w.ship.hasBeenDestroyed);
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

/** Salvage steps `empire` has unlocked (0-4). Pure. */
export function salvageStepsOf(st: BeaconState, empire: Empire | null): number {
    if (empire === null) return 0;
    return st.salvage.find((s) => s.empireId === empire.empireId)?.steps ?? 0;
}
