// Characters & Victory add-on (scenarios/characters-victory; docs/CHARACTERS_AND_VICTORY.md): switches, params and the
// per-game state. Not a port. Every handler is gated on the master flag `charactersVictory` plus a sub flag; with the
// add-on off (or no scenario) nothing runs and nothing is stored.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Habitat } from '../../types';
import type { BuiltObject } from '../../builtObject';
import type { Design } from '../../design';
import type { Character } from '../../characters';
import type { ShipGroup } from '../../fleets/shipGroup';
import { scenarioFlag, scenarioParam, scenarioState } from '../state';
import { registerScenarioGameStart } from '../hooks';
import { YEAR_LENGTH } from '../../galaxyTime';

export const CV_FLAG = 'charactersVictory';
export const CV_VIP_FLAG = 'cvVipShuttles';
export const CV_ESCORT_FLAG = 'cvEscorts';
export const CV_DECOY_FLAG = 'cvRulerDecoys';
export const CV_GOV_FLAG = 'cvGovernors';
export const CV_STATE_KEY = 'charactersVictory';
/** Set at the end of createGame: generation and the start-up tick run as in the faithful game. */
export const CV_LIVE_KEY = 'charactersVictoryLive';

/** Manifest defaults (scenario.json). */
export const CV_PARAMS = {
    cvShuttleSize: 180,
    cvTripTimeoutFactor: 3,
    cvRulerDecoyCount: 2,
    cvEscortFirepowerPerPoint: 60,
    cvEscortCapPct: 20,
    cvEscortWaitDays: 60,
    cvGraceDays: 360,
    cvDeclineYears: 4,
    cvRecoveryYears: 5,
    cvDisrepairPerYear: 2,
    cvMinPopulation: 50,
    cvReservePct: 10,
    cvTrainDays: 180,
    cvTrainCost: 2000,
    cvTenureYears: 2,
    cvGainPct: 25,
    cvTransitPerColonies: 15,
    cvMovesPerReview: 2,
} as const;
export type CvParamName = keyof typeof CV_PARAMS;

export function cvParam(galaxy: Galaxy, name: CvParamName): number {
    return scenarioParam(galaxy, name, CV_PARAMS[name]);
}

/** Star-date ms per game day. */
export const DAY = YEAR_LENGTH / 360;

/** The master switch and `sub` are on, and the game has started. */
export function cvOn(galaxy: Galaxy, sub: string): boolean {
    if (galaxy.scenario === null) return false;
    // Live: past createGame (the marker), or a running game the add-on was added to (Load screen's "Add add-ons").
    return scenarioFlag(galaxy, CV_FLAG) && scenarioFlag(galaxy, sub) && (galaxy.scenario.state[CV_LIVE_KEY] === true || !galaxy.deferEventsForGameStart);
}

registerScenarioGameStart({
    id: 'charactersVictory.live',
    flag: CV_FLAG,
    run: (galaxy) => {
        galaxy.scenario!.state[CV_LIVE_KEY] = true;
    },
});

/** An empire the add-on runs for: an active normal empire with a race (not the independents, not a pirate faction). */
export function isCvEmpire(galaxy: Galaxy, e: Empire | null): e is Empire {
    return e !== null && e.active && e !== galaxy.independentEmpire && e.pirateEmpireBaseHabitat === null && e.dominantRace !== null;
}

// ---------------------------------------------------------------------------------------------------------------
// State (plain objects with graph references; saved as-is)
// ---------------------------------------------------------------------------------------------------------------

/** One VIP trip: a shuttle carrying `character` (null: a decoy) to `destination`. */
export interface VipTrip {
    id: number;
    empire: Empire;
    character: Character | null;
    shuttle: BuiltObject;
    destination: BuiltObject | Habitat;
    reason: string;
    /** Star date the trip started. */
    started: number;
    /** Star date by which the trip completes regardless (the stuck-trip guard). */
    deadline: number;
    /** Escorts assigned (released on arrival). */
    escorts: BuiltObject[];
    /** The fleet each escort was taken from (null: a loose ship), rejoined on release. Same order as `escorts`. */
    escortFleets?: (ShipGroup | null)[];
    /** The escort firepower the trip asked for. */
    escortWanted: number;
    /** Star date until which an important trip waits at the origin for its escort (0: departed). */
    waitUntil: number;
    importance: number;
    danger: number;
    /** A decoy's ruler trip id (0: not a decoy). */
    decoyOf: number;
    /** Empire ids that know which of a ruler's shuttles is real. */
    revealedTo: number[];
}

/** One empire's add-on settings and records. */
export interface CvEmpire {
    /** The VIP Shuttle design (kept out of empire.designs). */
    design: Design | null;
    /** The player saved their own VIP design: the auto-design no longer replaces it. */
    designLocked: boolean;
    /** Signature of the components the auto-design was built from (regenerate when it changes). */
    designSig: string;
    /** Player settings (AI empires: always automatic). */
    automateGovernors: boolean;
    automateEscorts: boolean;
    /** Escort multiplier: 0 none, 0.5 light, 1 normal, 2 heavy. */
    escortLevel: number;
    /** Governor training in progress: site and star date it completes. */
    training: { site: Habitat; until: number }[];
    /** Open suggestions to the player (human empires without automation). */
    suggestions: GovernorSuggestion[];
    /** Colonies the player asked a governor for (served first). */
    requests: Habitat[];
    stats: { trips: number; arrived: number; lost: number; escorts: number; escortShips: number; moves: number; trained: number; risen: number };
    /** The first review ran (the posts vacant then — a game the add-on was added to — fill by local rises within the grace). */
    seeded?: boolean;
}

export interface GovernorSuggestion {
    character: Character;
    to: Habitat;
    from: Habitat | null;
    gainPct: number;
    priority: number;
    starDate: number;
}

/** One colony's vacancy record. */
export interface CvColony {
    colony: Habitat;
    /** Star date the colony became vacant (-1: governed). */
    vacantSince: number;
    /** 0..1 */
    neglect: number;
    /** Star date of the last neglect update. */
    updated: number;
    /** Star date a local governor rises if still vacant (-1: not drawn). */
    riseAt: number;
    /** Development levels lost to disrepair, fractional carry. */
    disrepairCarry: number;
    emigrationCarry: number;
    /** A "colony in decline" message was sent this vacancy. */
    warned: boolean;
    /**
     * Star date until which no governor can be appointed here (Part 2: its governor died as a Diet delegate;
     * absent / -1: none). No reserve is posted and no local governor rises before it; the vacancy rules run as usual.
     */
    lockedUntil?: number;
}

/** A governor's post and tenure. */
export interface CvGovernor {
    character: Character;
    /** The colony they hold (null: a reserve). */
    post: Habitat | null;
    /** Star date they arrived at the post (-1: never). */
    since: number;
    /** Away on duty (Part 2: 'council'); the post is kept. */
    duty: string | null;
}

export interface CvState {
    nextTripId: number;
    trips: VipTrip[];
    empires: Record<number, CvEmpire>;
    colonies: CvColony[];
    governors: CvGovernor[];
    /** Measurement counters (tuning). */
    counters: { tripsStarted: number; tripsArrived: number; tripsLost: number; escortedTrips: number; escortShips: number; dangerousTrips?: number; escortUnfilled?: number; governorMoves: number; localRises: number; trained: number; vacancyDaysTotal: number; vacanciesEnded: number };
}

export function cvState(galaxy: Galaxy): CvState {
    return scenarioState<CvState>(galaxy, CV_STATE_KEY, () => ({
        nextTripId: 1,
        trips: [],
        empires: {},
        colonies: [],
        governors: [],
        counters: { tripsStarted: 0, tripsArrived: 0, tripsLost: 0, escortedTrips: 0, escortShips: 0, governorMoves: 0, localRises: 0, trained: 0, vacancyDaysTotal: 0, vacanciesEnded: 0 },
    }));
}

/** The state if it exists (never creates it). */
export function peekCvState(galaxy: Galaxy): CvState | null {
    const st = galaxy.scenario?.state[CV_STATE_KEY] as CvState | undefined;
    return st ?? null;
}

export function cvEmpire(galaxy: Galaxy, e: Empire): CvEmpire {
    const st = cvState(galaxy);
    return (st.empires[e.empireId] ??= {
        design: null,
        designLocked: false,
        designSig: '',
        automateGovernors: false,
        automateEscorts: true,
        escortLevel: 1,
        training: [],
        suggestions: [],
        requests: [],
        stats: { trips: 0, arrived: 0, lost: 0, escorts: 0, escortShips: 0, moves: 0, trained: 0, risen: 0 },
    });
}

// ---------------------------------------------------------------------------------------------------------------
// Derived lookups (rebuilt lazily per state object: a loaded game has a new one; never saved)
// ---------------------------------------------------------------------------------------------------------------

interface CvIndex {
    tripsLen: number;
    byShuttle: Map<BuiltObject, VipTrip>;
    byCharacter: Map<Character, VipTrip>;
}
const indexes = new WeakMap<CvState, CvIndex>();
let indexDirty = new WeakSet<CvState>();

export function markTripsChanged(st: CvState): void {
    indexDirty.add(st);
}

function tripIndex(st: CvState): CvIndex {
    let ix = indexes.get(st);
    if (ix === undefined || indexDirty.has(st) || ix.tripsLen !== st.trips.length) {
        ix = { tripsLen: st.trips.length, byShuttle: new Map(), byCharacter: new Map() };
        for (const t of st.trips) {
            ix.byShuttle.set(t.shuttle, t);
            if (t.character !== null) ix.byCharacter.set(t.character, t);
        }
        indexes.set(st, ix);
        indexDirty.delete(st);
    }
    return ix;
}

/** The trip `shuttle` flies (null: not a VIP shuttle). Pure. */
export function tripOfShuttle(galaxy: Galaxy, shuttle: BuiltObject): VipTrip | null {
    const st = peekCvState(galaxy);
    if (st === null || st.trips.length === 0) return null;
    return tripIndex(st).byShuttle.get(shuttle) ?? null;
}

/** The trip `character` is on (null: not travelling by shuttle). Pure. */
export function tripOfCharacter(galaxy: Galaxy, character: Character): VipTrip | null {
    const st = peekCvState(galaxy);
    if (st === null || st.trips.length === 0) return null;
    return tripIndex(st).byCharacter.get(character) ?? null;
}

/** Test helper: forget the derived indexes. */
export function resetCvIndexes(): void {
    indexDirty = new WeakSet();
}
