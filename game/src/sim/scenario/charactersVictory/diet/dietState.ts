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
    dietEmperorYears: 5,
    dietEmperorMinSharePct: 30,
    dietExpelYears: 10,
} as const;
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
    | 'repeal';

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

export type DietLawKind = 'freeTrade' | 'banPlanetDestroyers' | 'banBombard' | 'outlawPirates' | 'protectIndependents' | 'openIndependents' | 'claim' | 'truce';

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
}

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
    emperor: { empire: Empire; capital: Habitat; world: Habitat; since: number; until: number } | null;
    laws: DietLaw[];
    enforcers: DietEnforcerFleet[];
    faction: Empire | null;
    fund: number;
    /** empireId → star date expelled. */
    expelled: Record<number, number>;
    /** empireId → the player's chosen delegate (null: the most important governor). */
    delegateChoice: Record<number, Character | null>;
    /** empireId → player proposals for the next session. */
    proposals: Record<number, { kind: DietMotionKind; target: Empire | null; other: Empire | null; colony: Habitat | null; resourceId: number }>;
    /** "attackerId" → grievance weight for an automatic sanction motion (crimes, defiance, violations). */
    grievances: Record<number, number>;
    /** "originId:targetId" → successful intelligence missions (decaying; the spies in vote weights). */
    spies: Record<string, number>;
    /** "pirateId:memberId" → pirate attacks on a member (decaying; outlaw motions). */
    raids?: Record<string, number>;
    /** memberId → bombardments it suffered lately (decaying; bombardment bans). */
    bombarded?: Record<number, number>;
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
