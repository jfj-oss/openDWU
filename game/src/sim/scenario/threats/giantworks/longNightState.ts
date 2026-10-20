// The Harvest Cycle's saved state and the memory record carried across the Long Night (longNight.ts, ../../../longNightReset.ts). Not a
// port. Plain data only (the scenario save codec) plus graph references to the galaxy's habitats. Light imports: sim/game.ts records
// the new-game options through here, so nothing in this file may import game.ts.
//
// The state bag is galaxy.scenario.state.longNight. Age 1 is every game's first cycle (no record at all reads as age 1); the Long Night
// builds a NEW galaxy from the same seed with every empire pre-warp and stores the MemoryRecord in its state: age 2.

import type { Galaxy } from '../../../galaxy';
import type { Habitat } from '../../../types';
import { scenarioFlag } from '../../state';

export const LN_KEY = 'longNight';
/** The Giantworks option "The Harvest Cycle": the Beacon's defeat begins the Long Night instead of ending the game. Default on. */
export const HARVEST_CYCLE_FLAG = 'gwHarvestCycle';
/** The age the Long Night leads to (the Preparation). */
export const AGE_PREPARATION = 2;
/** GameText tag prefix. */
export const LN_TAG = 'LongNight';

/** A place on the map by position (habitat indexes shift between galaxies of one seed; positions line up). */
export interface PlaceRec {
    name: string;
    systemName: string;
    x: number;
    y: number;
}

/** A harvest core of Age 1: a Harvest Scar of Age 2. */
export interface ScarRec extends PlaceRec {
    /** How the core stood when the Long Night began. */
    fate: 'live' | 'retaken' | 'broken' | 'lost';
    /** Some human empire knew it was a harvest core (CoreRec.knownBy). */
    knownToPlayer: boolean;
}

/** The player's empire identity (the new galaxy's player starts as this empire did). */
export interface PlayerIdentityRec {
    name: string;
    race: string;
    primaryColor: number;
    secondaryColor: number;
    flagShape: number;
}

/**
 * An empire as the Long Night found it (Age 2 placement, age2Placement.ts): the identity it is rebuilt with and the worlds it may be rebuilt on,
 * best first (positions: habitat indexes shift between galaxies of one seed). An AI empire is recorded only if it still owned a colony; a human
 * empire always is (a dead human starts on its Age 1 home world, `alive` false).
 */
export interface SurvivorRec {
    name: string;
    race: string;
    primaryColor: number;
    secondaryColor: number;
    flagShape: number;
    /** -1 an AI empire; otherwise the empire's seat in humanSeats (0 the player, 1.. the extra multiplayer humans). */
    human: number;
    alive: boolean;
    /** It still held its capital when the Long Night began. */
    capitalHeld: boolean;
    /** Candidate home worlds, best first: a human's capital if held, then its colonies nearest the galaxy's centre; an AI's capital if held, then its most populous colonies. */
    homes: PlaceRec[];
}

/** The mega-station's progress as Age 1 left it (filled from the megapath state, read defensively; absent fields stay empty). */
export interface MegaStationMemory {
    /** Component name → count (or 1 when held) as the player's empire held them. */
    components: Record<string, number>;
    /** Blueprint research points done. */
    blueprintPoints: number;
}

/** What the player remembers across the Long Night. AI empires carry no knowledge. */
export interface MemoryRecord {
    /** The age this record leads to (2). */
    age: number;
    /** The seed of the galaxy both cycles share. */
    seed: number;
    /** Star date of the Long Night's start (in the old galaxy's clock). */
    fromDate: number;
    /** The people the Reclaimers had eliminated, as a percent of the galaxy's people. */
    eliminatedPct: number;
    scars: ScarRec[];
    /** Reclaimer foundries (not built yet: the hooks): located and destroyed ones, by position, so the next Reclamation draws only on the survivors. */
    foundries: { located: PlaceRec[]; destroyed: PlaceRec[] };
    megaStation: MegaStationMemory;
    /** The empires of Age 1 that Age 2 rebuilds (absent in a record made before the placement was built: the stock placement). */
    survivors?: SurvivorRec[];
    /** Where the Beacon stood (new empires keep clear of it); null when it never had a site. */
    beaconSite?: PlaceRec | null;
    /** Truths unlocked (placeholder list: ids of Galactopedia / Knowledge entries). */
    truths: string[];
    player: PlayerIdentityRec | null;
    /** Other packages' records (registerMemoryContributor), by contributor id. */
    extra: Record<string, unknown>;
}

/** A crashed Reclaimer hull: the pre-warp start's stock research ruin of one empire's home system, made the Age 2 site. */
export interface CrashSite {
    habitat: Habitat;
    /** The empire whose home system it lies in. */
    empireId: number;
}

export interface LongNightState {
    /** 1 until a Long Night built this galaxy; then 2. */
    age: number;
    /** The CreateGameOptions this galaxy was made with (JSON, no game data): the Long Night builds the next galaxy from the same ones. Absent in games from before the Harvest Cycle. */
    createOptions?: Record<string, unknown>;
    /** Age 1: the Long Night began (the memory taken, the reset asked for); the driver swaps the galaxy at the next boundary. */
    pending?: MemoryRecord | null;
    /** Age 1: the Beacon has processed half the galaxy's people: the human players were advised (advisorSent, empire ids) and the AI empires lean to rim worlds. */
    rimNudge?: boolean;
    advisorSent?: number[];
    /** Age 2: what the player remembers. */
    memory?: MemoryRecord | null;
    /** Age 2: the crashed hulls (milestone 1). */
    crashSites: CrashSite[];
    /** Age 2: milestone key → ids of the empires that reached it (AI empires too). Milestones 2-8 are not built: the hook is `markMilestone`. */
    milestones: Record<string, number[]>;
}

export function newLongNightState(): LongNightState {
    return { age: 1, crashSites: [], milestones: {} };
}

/** The state bag if the game has one (a read never creates it). */
export function peekLongNight(galaxy: Galaxy): LongNightState | null {
    const s = galaxy.scenario?.state[LN_KEY];
    return s === undefined || s === null ? null : (s as LongNightState);
}

/** The state bag, created on first use (scenario games only). */
export function longNightState(galaxy: Galaxy): LongNightState {
    const s = galaxy.scenario;
    if (s === null) throw new Error('longNightState: no scenario in this game');
    let st = s.state[LN_KEY] as LongNightState | undefined;
    if (st === undefined) {
        st = newLongNightState();
        s.state[LN_KEY] = st;
    }
    st.crashSites ??= [];
    st.milestones ??= {};
    return st;
}

/** The galaxy's age: 1 (the Harvest), 2 (the Preparation, after the Long Night). Pure. */
export function galaxyAgeOf(galaxy: Galaxy): number {
    return peekLongNight(galaxy)?.age ?? 1;
}

/** The player's memory record of this galaxy (Age 2 on), or null. Pure. */
export function memoryRecordOf(galaxy: Galaxy): MemoryRecord | null {
    return peekLongNight(galaxy)?.memory ?? null;
}

/** An Age 2 empire reached knowledge milestone `key` (0-8 of the plan; 1 = the crashed hull). True the first time for that empire. */
export function markMilestone(galaxy: Galaxy, key: string, empireId: number): boolean {
    const st = longNightState(galaxy);
    const list = ((st.milestones ??= {})[key] ??= []);
    if (list.includes(empireId)) return false;
    list.push(empireId);
    return true;
}

export function milestoneReached(galaxy: Galaxy, key: string, empireId: number): boolean {
    return (peekLongNight(galaxy)?.milestones?.[key] ?? []).includes(empireId);
}

/**
 * Called by createGame at its end: a game with the Harvest Cycle option keeps its own new-game options (JSON, without the game data and the
 * test hook) so the Long Night can build the next cycle's galaxy from the same ones. Draws no Rnd.
 */
export function recordCreateOptions(galaxy: Galaxy, opts: object): void {
    if (galaxy.scenario === null || !scenarioFlag(galaxy, HARVEST_CYCLE_FLAG)) return;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { gameData, __phaseHook, ...rest } = opts as Record<string, unknown>;
    longNightState(galaxy).createOptions = JSON.parse(JSON.stringify(rest)) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------------------------------------------
// Other packages' records
// ---------------------------------------------------------------------------------------------------------------

/** A package that carries something across the Long Night (the mega-station components, the foundries ...): its capture goes into `MemoryRecord.extra[id]`; its restore runs on the new galaxy. */
export interface MemoryContributor {
    id: string;
    /** The old galaxy at the moment the Long Night begins: plain data (JSON-able) or undefined for nothing. */
    capture(galaxy: Galaxy): unknown;
    /** The new galaxy, once built (memory.extra[id] is what capture returned). */
    restore?(galaxy: Galaxy, data: unknown): void;
}

const contributors = new Map<string, MemoryContributor>();

export function registerMemoryContributor(c: MemoryContributor): void {
    contributors.set(c.id, c);
}

export function memoryContributors(): readonly MemoryContributor[] {
    return [...contributors.values()];
}
