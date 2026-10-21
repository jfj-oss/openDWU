// Characters & Victory, part 2: the Interstellar Diet (docs/CHARACTERS_AND_VICTORY.md §7). Not a port: switches,
// params and the per-game state of the council sessions that extend the existing galactic-council add-on
// (emergent/council.ts, through registerCouncilExtension). With the add-on off (or its `cvCouncil` flag off, or no
// council) nothing runs and nothing is stored: the galactic council keeps its stock yearly rhythm.

import type { Galaxy } from '../../../galaxy';
import type { Empire } from '../../../empire';
import type { Habitat } from '../../../types';
import type { BuiltObject } from '../../../builtObject';
import type { Character } from '../../../characters';
import type { ShipGroup } from '../../../fleets/shipGroup';
import type { Vote } from '../../emergent/council';
import { scenarioParam, scenarioState } from '../../state';
import { councilOn } from '../../emergent/council';
import { CV_FLAG, cvOn } from '../common';

export const CV_COUNCIL_FLAG = 'cvCouncil';
export const CV_DIET_VICTORY_FLAG = 'cvDietVictory';
export const DIET_STATE_KEY = 'interstellarDiet';
export const DIET_TRIP_REASON = 'diet';
export const DIET_NAME = 'Interstellar Diet';
/** Game-end codes (victory.ts GameEndEventArgs.code): the Emperor's countdown. */
export const DIET_EMPEROR_VICTORY_CODE = 2101;
export const DIET_EMPEROR_DEFEAT_CODE = 2102;

/** Manifest defaults (scenarios/characters-victory/scenario.json). */
export const DIET_PARAMS = {
    dietSessionMinYears: 2,
    dietSessionMaxYears: 3,
    dietGatherDays: 150,
    dietVoteDays: 60,
    dietMaxMotions: 3,
    dietLesserDelegatePct: 50,
    dietCrimePenalty: 30,
    dietDefiancePenalty: 25,
    dietEnforcerScaleMax: 3,
    dietEnforcerCostPct: 50,
    dietEnforcerUpkeepPct: 10,
    dietDuesMaxPct: 5,
    dietHostIncomePct: 15,
    dietHostHappinessPct: 15,
    dietHostGrowthPct: 15,
    dietHostConstructionPct: 25,
    dietHostScenic: 1.5,
    dietVisitorTradePct: 3,
    dietBountyPerShip: 1500,
    dietTruceYears: 3,
    dietRegentYears: 6,
    dietEmergencyYears: 4,
    dietEmergencyGatherDays: 90,
    /** Years the bidder must survive. */
    dietEmperorYears: 10,
    /** A bid cannot start before this many game years after the game's start. */
    dietEmperorMinYear: 65,
    dietExpelYears: 10,
} as const;
/** AI bid reluctance: score >= LEAD_RATIO x the next empire's, >= MIN_SHARE of the galaxy total, military >= MIL_RATIO x the next's, then a low roll per check. */
export const EMPEROR_AI_LEAD_RATIO = 2.5;
export const EMPEROR_AI_MIN_SHARE = 0.4;
export const EMPEROR_AI_MIL_RATIO = 2.0;
export const EMPEROR_AI_CHECK_CHANCE = 0.02;
export const EMPEROR_AI_CHECK_DAYS = 30;
/** The rising: at most this share of the other major AI empires may stay out (the bidder's closest allies / subjects). */
export const EMPEROR_UPRISING_EXEMPT_SHARE = 0.1;
/** An exempt empire must like the bidder at least this much (attitude) and be allied/pacted/protected/subject to it. */
export const EMPEROR_EXEMPT_MIN_ATTITUDE = 60;
/** Days between refreshes of the attackers' war targets (colonies, then stations) and fleet orders during a bid. */
export const EMPEROR_ATTACK_REFRESH_DAYS = 60;
/** Idle uprising attack fleets are re-sent at the bidder this often (a fleet out of fuel range goes on hop by hop). */
export const EMPEROR_DISPATCH_DAYS = 10;
export type DietParamName = keyof typeof DIET_PARAMS;

export function dietParam(galaxy: Galaxy, name: DietParamName): number {
    return scenarioParam(galaxy, name, DIET_PARAMS[name]);
}

/** The Diet runs: Characters & Victory with `cvCouncil` on, live, and the galactic council add-on running. */
export function dietOn(galaxy: Galaxy | null): boolean {
    return galaxy !== null && galaxy.scenario !== null && cvOn(galaxy, CV_COUNCIL_FLAG) && councilOn(galaxy);
}

export { CV_FLAG };

// ---------------------------------------------------------------------------------------------------------------
// State (plain objects with graph references; saved as-is)
// ---------------------------------------------------------------------------------------------------------------

/** Motion kinds of a Diet session: the galactic council's six plus the Diet's own. */
export type DietMotionKind =
    | 'sanction'
    | 'embargo'
    | 'condemn'
    | 'lift'
    | 'recognise'
    | 'threat'
    | 'truce'
    | 'freeTrade'
    | 'banPlanetDestroyers'
    | 'banBombard'
    | 'outlawPirates'
    | 'protectIndependents'
    | 'openIndependents'
    | 'claim'
    | 'expel'
    | 'regent'
    | 'repeal'
    // A kind another add-on registers (registerDietMotionKind; e.g. The Voidbloom War's 'banVoidbloom').
    | (string & {});

/** The galactic council's own kinds (applied through council.ts applyMotion). */
export const STOCK_KINDS: ReadonlySet<DietMotionKind> = new Set(['sanction', 'embargo', 'condemn', 'lift', 'recognise', 'threat']);

export interface DietVote {
    empire: Empire;
    vote: Vote;
    weight: number;
    /** The voter's score (AI; 0 for a human). */
    score: number;
}

export interface DietMotion {
    id: number;
    kind: DietMotionKind;
    proposer: Empire;
    /** The empire the motion names (null: galaxy-wide). */
    target: Empire | null;
    /** truce: the other side; condemn: the victim. */
    other: Empire | null;
    /** claim: the colony claimed. */
    colony: Habitat | null;
    /** embargo: the resource; repeal: the law id. */
    resourceId: number;
    /** A place in the void a motion names (the mega-station's site; absent for every other kind). */
    place?: { x: number; y: number };
    text: string;
    votes: DietVote[];
    status: 'voting' | 'passed' | 'failed' | 'vetoed';
    /** Weighted totals at the tally. */
    yes: number;
    no: number;
}

export interface DietDelegate {
    empire: Empire;
    character: Character | null;
    /** Not the empire's most important governor: the vote weighs less. */
    lesser: boolean;
    /** Sent by VIP shuttle (false: already at the world, or nobody to send). */
    sent: boolean;
    /** Lost on the way (killed / captured). */
    lost: boolean;
}

export interface DietSession {
    id: number;
    emergency: boolean;
    calledBy: Empire | null;
    /** Star dates: called (delegates leave), the floor opens (AI votes), the vote closes (tally, delegates go home). */
    called: number;
    opens: number;
    closes: number;
    stage: 'gathering' | 'voting';
    host: Empire;
    world: Habitat;
    delegates: DietDelegate[];
    motions: DietMotion[];
    /** The Regent's veto was used this session. */
    vetoUsed: boolean;
}

export type DietLawKind = 'freeTrade' | 'banPlanetDestroyers' | 'banBombard' | 'outlawPirates' | 'protectIndependents' | 'openIndependents' | 'claim' | 'truce' | (string & {});

/** A motion's AI candidate as a registered kind proposes it (dietAi.ts DietCandidate). */
export interface DietKindCandidate {
    kind: DietMotionKind;
    proposer: Empire;
    target: Empire | null;
    other: Empire | null;
    colony: Habitat | null;
    resourceId: number;
    place?: { x: number; y: number };
    weight: number;
}

/**
 * A motion kind another add-on adds to the Diet (registerDietMotionKind): its text, its effect when passed (usually a
 * law through `addLaw`), every AI voter's score, and the members' candidates. Pure but `apply`; no Rnd.
 */
export interface DietMotionKindDef {
    kind: string;
    text: (galaxy: Galaxy, st: DietState, m: { target: Empire | null; other: Empire | null; colony: Habitat | null; resourceId: number; place?: { x: number; y: number } }) => string;
    apply: (galaxy: Galaxy, st: DietState, m: DietMotion, addLaw: (kind: DietLawKind, empire: Empire | null, other: Empire | null, colony: Habitat | null, until: number) => DietLaw) => void;
    voteScore: (galaxy: Galaxy, st: DietState, voter: Empire, m: DietMotion) => number;
    candidates?: (galaxy: Galaxy, st: DietState, a: Empire) => DietKindCandidate[];
    /** The Diet screen: the motion's name, what it does, what it names ('none' | 'empire'), and when it may be moved. */
    label: string;
    effect: (m: DietMotion) => string;
    /** 'point': the motion names a place on the map (the proposer picks it: the Diet screen asks for a map click). */
    needs: 'none' | 'empire' | 'point';
    proposable?: (galaxy: Galaxy) => boolean;
    /** Whether this member may move it (default: any member; the mega-station: a human holding the finished blueprint). */
    proposableBy?: (galaxy: Galaxy, empire: Empire) => boolean;
    /** The player's proposal before it is stored: may normalise it (the mega-station snaps the place to empty void); null refuses it. */
    prepare?: (galaxy: Galaxy, empire: Empire, p: { target: Empire | null; other: Empire | null; colony: Habitat | null; resourceId: number; place?: { x: number; y: number } }) => { target: Empire | null; other: Empire | null; colony: Habitat | null; resourceId: number; place?: { x: number; y: number } } | null;
    /** The motion failed or was vetoed (optional). */
    failed?: (galaxy: Galaxy, st: DietState, m: DietMotion) => void;
}

/** The Diet window's war-crimes line (War Crimes, diet/warCrimes.ts fills it; '' = none). */
export const dietWarCrimesLine: { fn: ((galaxy: Galaxy) => string) | null } = { fn: null };

/** A war declared on a member that the Diet does not treat as an outrage (the Stillness Engine's stated casus belli): true = no emergency case for the Regent. */
export const dietWarExcuse: { fn: ((galaxy: Galaxy, attacker: Empire, target: Empire) => boolean) | null } = { fn: null };

/** The Diet window's war-credit line (the Beacon's share of the war, threats/giantworks/beaconWarCredit.ts fills it; '' = none). */
export const dietWarCreditLine: { fn: ((galaxy: Galaxy) => string) | null } = { fn: null };

// eslint-disable-next-line no-var
var dietKindStore: DietMotionKindDef[] | undefined;
// eslint-disable-next-line no-var
var dietSeatExclusionStore: ((galaxy: Galaxy, e: Empire) => boolean)[] | undefined;

export function registerDietMotionKind(def: DietMotionKindDef): void {
    const list = (dietKindStore ??= []);
    const i = list.findIndex((x) => x.kind === def.kind);
    if (i >= 0) list.splice(i, 1);
    list.push(def);
}

export function dietMotionKindDef(kind: string): DietMotionKindDef | null {
    return dietKindStore?.find((x) => x.kind === kind) ?? null;
}

export function registeredDietKinds(): readonly DietMotionKindDef[] {
    return dietKindStore ?? [];
}

/** A member that may sit and vote but never hosts the Diet nor holds the Regency (The Voidbloom War: the Concord). */
export function registerDietSeatExclusion(fn: (galaxy: Galaxy, e: Empire) => boolean): void {
    const list = (dietSeatExclusionStore ??= []);
    if (!list.includes(fn)) list.push(fn);
}

export function dietSeatExcluded(galaxy: Galaxy, e: Empire): boolean {
    const list = dietSeatExclusionStore;
    if (list === undefined) return false;
    for (const f of list) if (f(galaxy, e)) return true;
    return false;
}

/** A measure in force. */
export interface DietLaw {
    id: number;
    kind: DietLawKind;
    /** outlawPirates: the pirate faction; claim: the claimant; truce: one side. */
    empire: Empire | null;
    /** truce: the other side; claim: the colony's owner when recognised. */
    other: Empire | null;
    colony: Habitat | null;
    since: number;
    /** Star date it lapses (-1: until repealed). */
    until: number;
    text: string;
}

/** One enforcer blockade fleet for one sanctioned empire. */
export interface DietEnforcerFleet {
    id: number;
    target: Empire;
    fleet: ShipGroup | null;
    ships: BuiltObject[];
    /** The blockaded colony or space port (null: still choosing / out of fuel reach). */
    station: Habitat | BuiltObject | null;
    scale: number;
    cost: number;
    since: number;
    /** 'gathering' at the host world, 'en route', 'blockading'. */
    stage: 'gathering' | 'enRoute' | 'blockading';
    /** The target's ships have attacked it (open defiance, once per fleet). */
    defied: boolean;
}

export interface DietHistoryEntry {
    sessionId: number;
    starDate: number;
    kind: DietMotionKind;
    text: string;
    result: 'passed' | 'failed' | 'vetoed';
    yes: number;
    no: number;
    proposer: Empire;
    /** Game year of the tally, and the empire the motion names (null: galaxy-wide). Absent in older saves. */
    year?: number;
    target?: Empire | null;
}

export const DIET_HISTORY_CAP = 200;

export interface DietCounters {
    sessions: number;
    emergencySessions: number;
    proposed: Record<string, number>;
    passed: Record<string, number>;
    vetoes: number;
    delegatesSent: number;
    delegatesArrived: number;
    delegatesLost: number;
    delegatesAbsent: number;
    lesserDelegates: number;
    enforcerFleets: number;
    enforcerShips: number;
    enforcerOutcomes: Record<string, number>;
    defiance: number;
    crimes: number;
    regents: number;
    emperorBids: number;
    emperorWins: number;
    emperorFails: number;
    seatMoves: number;
    duesPaid: number;
    bounties: number;
    truceBreaks: number;
    banViolations: number;
    delegateAttacks: number;
    /** Posts locked by a delegate's death. */
    lockouts?: number;
    /** Sum of the regular sessions' gathering days (the farthest delegate's ETA; tuning). */
    gatherDaysTotal?: number;
}

export interface DietState {
    nextId: number;
    /** The council (council.ts) the Diet is (0: none yet). */
    councilId: number;
    host: Empire | null;
    world: Habitat | null;
    /** Star date the next regular session is called (-1: not scheduled yet). */
    nextSessionAt: number;
    session: DietSession | null;
    regent: Empire | null;
    regentUntil: number;
    lastEmergency: number;
    /**
     * The bidder's countdown. Survival rule: the bidder wins when it still holds its capital at `until`; losing the capital
     * at any time fails the bid at once. `colonies0` is its colony count at the start (shown in the UI, not a rule).
     */
    emperor: { empire: Empire; capital: Habitat; world: Habitat; since: number; until: number; colonies0?: number; yearsAnnounced?: number; refreshedAt?: number; dispatchedAt?: number; exempt?: number[]; joined?: number[]; heldWorld?: boolean } | null;
    laws: DietLaw[];
    enforcers: DietEnforcerFleet[];
    faction: Empire | null;
    fund: number;
    /** empireId → star date expelled. */
    expelled: Record<number, number>;
    /** empireId → the player's chosen delegate (null: the most important governor). */
    delegateChoice: Record<number, Character | null>;
    /** empireId → player proposals for the next session. */
    proposals: Record<number, { kind: DietMotionKind; target: Empire | null; other: Empire | null; colony: Habitat | null; resourceId: number; place?: { x: number; y: number } }>;
    /** "attackerId" → grievance weight for an automatic sanction motion (crimes, defiance, violations). */
    grievances: Record<number, number>;
    /** "originId:targetId" → successful intelligence missions (decaying; the spies in vote weights). */
    spies: Record<string, number>;
    /** "pirateId:memberId" → pirate attacks on a member (decaying; outlaw motions). */
    raids?: Record<string, number>;
    /** memberId → bombardments it suffered lately (decaying; bombardment bans). */
    bombarded?: Record<number, number>;
    /** Delegates away from their posts (to, at or back from a session): a death among them locks the post (5-6 years). */
    abroad?: { character: Character; post: Habitat; empire: Empire }[];
    /** A pressing case for an emergency session (a war on a member, open defiance), for the AI Regent. */
    pendingEmergency?: { kind: DietMotionKind; target: Empire | null; other: Empire | null; at: number; why: string } | null;
    /** "attackerId:victimId" → star date of the last AI strike order on a delegate. */
    strikes?: Record<string, number>;
    /** empireId → star date of a failed Emperor's bid (no new bid for ten years). */
    emperorFailedAt?: Record<number, number>;
    /** The vetoed motion of the session (the Regent's; 0 = none). */
    vetoMotionId?: number;
    history: DietHistoryEntry[];
    counters: DietCounters;
}

function freshCounters(): DietCounters {
    return {
        sessions: 0,
        emergencySessions: 0,
        proposed: {},
        passed: {},
        vetoes: 0,
        delegatesSent: 0,
        delegatesArrived: 0,
        delegatesLost: 0,
        delegatesAbsent: 0,
        lesserDelegates: 0,
        enforcerFleets: 0,
        enforcerShips: 0,
        enforcerOutcomes: {},
        defiance: 0,
        crimes: 0,
        regents: 0,
        emperorBids: 0,
        emperorWins: 0,
        emperorFails: 0,
        seatMoves: 0,
        duesPaid: 0,
        bounties: 0,
        truceBreaks: 0,
        banViolations: 0,
        delegateAttacks: 0,
    };
}

export function dietState(galaxy: Galaxy): DietState {
    return scenarioState<DietState>(galaxy, DIET_STATE_KEY, () => ({
        nextId: 1,
        councilId: 0,
        host: null,
        world: null,
        nextSessionAt: -1,
        session: null,
        regent: null,
        regentUntil: -1,
        lastEmergency: -1,
        emperor: null,
        laws: [],
        enforcers: [],
        faction: null,
        fund: 0,
        expelled: {},
        delegateChoice: {},
        proposals: {},
        grievances: {},
        spies: {},
        history: [],
        counters: freshCounters(),
    }));
}

/** The state if it exists (never creates it; UI and queries). */
export function peekDietState(galaxy: Galaxy | null): DietState | null {
    if (galaxy === null || galaxy.scenario === null) return null;
    return (galaxy.scenario.state[DIET_STATE_KEY] as DietState | undefined) ?? null;
}

/** Law of `kind` in force (optionally for `empire`). Pure. */
export function lawInForce(st: DietState | null, kind: DietLawKind, empire: Empire | null = null): DietLaw | null {
    if (st === null) return null;
    for (const l of st.laws) if (l.kind === kind && (empire === null || l.empire === empire)) return l;
    return null;
}

export const byId = (a: Empire, b: Empire): number => a.empireId - b.empireId;
