// The Harvest Cycle, Age 2: the corrupted empire (core). Not a port. In the Preparation (galaxy age 2, flag gwHarvestCycle) the Watchers
// secretly take control of ONE AI empire. This file holds what every part of it shares: the choice, the state, the leader's hidden thing (the
// Internal Security lead a human confirms), the pattern the other empires can notice, how the corruption ends, and the Knowledge rows.
//   - the choice (pickCorrupted): an AI empire, never a human (in any game), not a threat faction (the Reclaimers, the stranded Watchers, the
//     Compact, a holdout), with a capital and at least corruptMinColonies colonies, not at war with most of the galaxy, a Diet member when the
//     Diet runs, from the middle half by colony count, then a seeded pick (age2Random). Made once: the first day of the Preparation with an
//     eligible empire. Nothing tells anyone who it is.
//   - the pattern: each act (a Diet vote against a preparation motion, a war on a Scar holder or a Severance builder, a raid on a Severance
//     freighter) is recorded here; every human who has met the empire is suspicious after corruptSuspectActs of them, and the Knowledge page
//     shows that suspicion.
//   - the leader's hidden thing (kind 'corruption', package giantworks.corrupted): an Internal Security lead on the leader (security.ts rolls
//     it: corruptedAi.ts leadRolls, on its own stream). A CONFIRMED lead held by a human lets that human propose the exposure motion
//     (corruptedDiet.ts). With the internalSecurity flag off there are no leads: exposure is then not possible.
//   - the endings (endCorruption): exposed (the Diet), assassinated (the leader, by an agent's mission), captured (its capital taken). Each
//     ends the corruption for good: the empire is a normal AI again, with a reputation scar (the ledger, decaying slowly).
// Rnd: none on galaxy.rnd. The choice and the rolls draw from age2Random streams seeded from the galaxy seed (salts below).

import type { Galaxy } from '../../../galaxy';
import type { Empire } from '../../../empire';
import type { Habitat } from '../../../types';
import type { Character } from '../../../characters';
import { CharacterRole, getEmpireCharacters } from '../../../characters';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../../../diplomacy';
import { EmpireMessageType } from '../../../messages';
import { humanEmpires, isHumanEmpire } from '../../../humanEmpires';
import { galaxyStarDate } from '../../../tick/simTime';
import { scenarioFlag, scenarioParam, scenarioState } from '../../state';
import { scenarioMessage, scenarioText as T } from '../../messages';
import { applyReputation } from '../../reputation/ledger';
import { dietCouncil } from '../../charactersVictory/diet/diet';
import { dietMembership } from '../../charactersVictory/diet/dietAi';
import { dietOn } from '../../charactersVictory/diet/dietState';
import { detectionChance, empireSecurityStrength, onLeadChanged } from '../../security/security';
import { openLead, peekSecurityState, registerHiddenThing, retireHiddenThing, securityOn, type HiddenThing, type Lead } from '../../security/registry';
import { compactFaction } from './state';
import { peekBeaconState } from './beaconState';
import { peekStranded } from './age2Watchers';
import { peekHoldouts } from './age2Holdouts';
import { age2Random } from './age2World';
import { AGE_PREPARATION, HARVEST_CYCLE_FLAG, galaxyAgeOf } from './longNightState';

export const CORRUPT_KEY = 'corruptedEmpire';
/** The hidden thing's package: the leader's Internal Security lead. */
export const CORRUPT_PACKAGE = 'giantworks.corrupted';
/** Salts of the module's own streams (age2Random): the choice and the rolls. */
export const CORRUPT_CHOICE_SALT = 0x434f5241;
const CORRUPT_ROLL_SALT = 0x434f5252;
const LOG_LIMIT = 20;

/** Tunables (scenario params; the fallbacks are the design's). */
export const CORRUPT_P = {
    minColonies: (g: Galaxy) => scenarioParam(g, 'corruptMinColonies', 3),
    concealment: (g: Galaxy) => scenarioParam(g, 'corruptConcealment', 60),
    suspectActs: (g: Galaxy) => scenarioParam(g, 'corruptSuspectActs', 2),
    reputationScar: (g: Galaxy) => scenarioParam(g, 'corruptReputationScar', 40),
    reviewDays: (g: Galaxy) => scenarioParam(g, 'corruptReviewDays', 30),
    parkDays: (g: Galaxy) => scenarioParam(g, 'corruptParkDays', 10),
    rollDays: (g: Galaxy) => scenarioParam(g, 'corruptRollDays', 90),
};

export interface CorruptedWar {
    target: number;
    date: number;
    reason: string;
}

export interface CorruptedVote {
    date: number;
    kind: string;
    text: string;
}

export interface CorruptedState {
    /** The corrupted empire (null until one is chosen). */
    empireId: number | null;
    /** Chosen once: a broken corruption is never chosen again. */
    chosen: boolean;
    /** Star date of the choice. */
    since: number;
    /** How it ended ('' while it is corrupt): exposed by the Diet, its leader assassinated, its capital captured, or the empire gone. */
    ended: '' | 'exposed' | 'assassinated' | 'captured' | 'gone';
    endDate: number;
    /** The human empire whose motion exposed it (-1: none). */
    exposedBy: number;
    /** Pattern acts so far (all empires see them). */
    acts: number;
    /** Human empire id -> the pattern acts it has seen. */
    suspect: Record<string, number>;
    /** Human empire ids told of their suspicion (once each). */
    warned: number[];
    /** Wars it declared on the pattern (capped). */
    wars: CorruptedWar[];
    /** Diet votes against a preparation motion (capped). */
    votes: CorruptedVote[];
    raids: number;
    parks: number;
    /** Star dates of the next review, park and lead roll. */
    nextReview: number;
    nextPark: number;
    nextRoll: number;
    /** Draws of the module's stream (one per roll). */
    rolls: number;
}

// eslint-disable-next-line no-var
var preparationKinds: Set<string> | undefined;
/** The Diet motion kinds the corrupted empire votes against (the Severance's; a later preparation motion registers itself). */
export function registerPreparationMotion(kind: string): void {
    (preparationKinds ??= new Set()).add(kind);
}
export function isPreparationMotion(kind: string): boolean {
    return preparationKinds?.has(kind) ?? false;
}

/** The Harvest Cycle's Preparation runs: the flag is on and the galaxy is age 2 or later. Pure. */
export function corruptionOn(galaxy: Galaxy): boolean {
    return scenarioFlag(galaxy, HARVEST_CYCLE_FLAG) && galaxyAgeOf(galaxy) >= AGE_PREPARATION;
}

export function peekCorrupted(galaxy: Galaxy): CorruptedState | null {
    const s = galaxy.scenario?.state[CORRUPT_KEY];
    return s === undefined || s === null ? null : (s as CorruptedState);
}

/** The state, created on first use (a scenario game only). */
export function corruptedState(galaxy: Galaxy): CorruptedState {
    return scenarioState<CorruptedState>(galaxy, CORRUPT_KEY, () => ({
        empireId: null,
        chosen: false,
        since: 0,
        ended: '',
        endDate: 0,
        exposedBy: -1,
        acts: 0,
        suspect: {},
        warned: [],
        wars: [],
        votes: [],
        raids: 0,
        parks: 0,
        nextReview: 0,
        nextPark: 0,
        nextRoll: 0,
        rolls: 0,
    }));
}

/** The module's next draw in [0, 1) on its own stream. */
export function corruptRoll(galaxy: Galaxy, st: CorruptedState, salt = CORRUPT_ROLL_SALT): number {
    st.rolls++;
    return age2Random(galaxy.randomSeed ^ salt, st.rolls)();
}

/** A normal AI empire: alive, not the independents, not a pirate, not a human. Pure. */
export function isAiEmpire(galaxy: Galaxy, e: Empire | null | undefined): e is Empire {
    return e !== null && e !== undefined && e.active && e !== galaxy.independentEmpire && e.pirateEmpireBaseHabitat === null && !isHumanEmpire(galaxy, e);
}

/** The empires the Watchers never pick: the Reclaimers, the stranded Watchers, the Compact and the holdouts. Pure. */
export function threatEmpireIds(galaxy: Galaxy): Set<number> {
    const ids = new Set<number>();
    const add = (e: Empire | null | undefined): void => {
        if (e !== null && e !== undefined) ids.add(e.empireId);
    };
    add(peekBeaconState(galaxy)?.faction ?? null);
    add(peekStranded(galaxy)?.faction ?? null);
    add(compactFaction(galaxy));
    for (const h of peekHoldouts(galaxy)?.holdouts ?? []) add(h.empire);
    return ids;
}

/** The corrupted empire, while it is corrupt (null: none chosen, or the corruption has ended). Pure. */
export function activeCorrupted(galaxy: Galaxy): Empire | null {
    const st = peekCorrupted(galaxy);
    if (st === null || st.empireId === null || st.ended !== '') return null;
    const e = galaxy.empires.find((x): x is Empire => x !== null && x.empireId === st.empireId) ?? null;
    return e !== null && e.active ? e : null;
}

export function isCorrupted(galaxy: Galaxy, e: Empire | null | undefined): boolean {
    return e !== null && e !== undefined && activeCorrupted(galaxy) === e;
}

/** The empire's leader character (the one the Watchers' hidden thing is on), or null. Pure. */
export function leaderOf(e: Empire): Character | null {
    return getEmpireCharacters(e).find((c) => c.active && c.role === CharacterRole.Leader) ?? null;
}

/** The corruption's hidden thing (the leader's), while it is live. Pure. */
export function corruptionThing(galaxy: Galaxy, e: Empire): HiddenThing | undefined {
    return peekSecurityState(galaxy)?.things.find((t) => !t.retired && t.package === CORRUPT_PACKAGE && t.empire === e);
}

/** Registers the hidden thing on the leader (idempotent; nothing with Internal Security off). */
export function registerCorruptionThing(galaxy: Galaxy, e: Empire): HiddenThing | null {
    const leader = leaderOf(e);
    if (leader === null || !securityOn(galaxy)) return null;
    return registerHiddenThing(galaxy, { kind: 'corruption', concealment: CORRUPT_P.concealment(galaxy), empire: e, target: leader, package: CORRUPT_PACKAGE });
}

/** Keeps the thing on the current leader (a succession moves it; its old leads close). */
export function upkeepCorruptionThing(galaxy: Galaxy, e: Empire): void {
    if (!securityOn(galaxy)) return;
    const leader = leaderOf(e);
    const t = corruptionThing(galaxy, e);
    if (t !== undefined && t.target !== leader) retireHiddenThing(galaxy, t, 'succession');
    if (leader !== null && corruptionThing(galaxy, e) === undefined) registerCorruptionThing(galaxy, e);
}

/** The lead a human holds CONFIRMED on the corrupted leader (null: none). Pure. */
export function confirmedLeadOf(galaxy: Galaxy, human: Empire): Lead | null {
    const e = activeCorrupted(galaxy);
    const sec = peekSecurityState(galaxy);
    if (e === null || sec === null || !isHumanEmpire(galaxy, human)) return null;
    const t = corruptionThing(galaxy, e);
    if (t === undefined) return null;
    const lead = openLead(sec, t, human);
    return lead !== undefined && lead.level === 'confirmed' ? lead : null;
}

// ---------------------------------------------------------------------------------------------------------------
// The choice
// ---------------------------------------------------------------------------------------------------------------

/**
 * The AI empire the Watchers would take: eligible ones (see the header) by colony count, the middle half of the list, then a seeded pick (the
 * seed and the choice salt alone decide it). Pure.
 */
export function pickCorrupted(galaxy: Galaxy): Empire | null {
    const all = galaxy.empires.filter((e): e is Empire => e !== null && e !== galaxy.independentEmpire && e.pirateEmpireBaseHabitat === null && e.active);
    const threats = threatEmpireIds(galaxy);
    const council = dietOn(galaxy) ? dietCouncil(galaxy) : null;
    const members = council === null ? null : dietMembership(galaxy, council);
    const eligible: Empire[] = [];
    for (const e of all) {
        if (!isAiEmpire(galaxy, e) || threats.has(e.empireId)) continue;
        if (e.capital === null || e.colonies.length < CORRUPT_P.minColonies(galaxy)) continue;
        if (members !== null && !members.includes(e)) continue;
        const wars = all.filter((x) => x !== e && obtainDiplomaticRelation(e, x).type === DiplomaticRelationType.War).length;
        if (wars * 2 >= all.length - 1) continue; // at war with most of the galaxy: not one to take
        eligible.push(e);
    }
    if (eligible.length === 0) return null;
    eligible.sort((a, b) => a.colonies.length - b.colonies.length || a.empireId - b.empireId);
    const n = eligible.length;
    const lo = n >= 4 ? Math.floor(n / 4) : 0;
    const band = eligible.slice(lo, n - lo);
    const r = age2Random(galaxy.randomSeed, CORRUPT_CHOICE_SALT)();
    return band[Math.min(band.length - 1, Math.floor(r * band.length))];
}

/** Picks the corrupted empire once (the first day of the Preparation with an eligible empire). True when it chose. */
export function chooseCorrupted(galaxy: Galaxy): boolean {
    const st = corruptedState(galaxy);
    if (st.chosen) return false;
    const e = pickCorrupted(galaxy);
    if (e === null) return false;
    st.empireId = e.empireId;
    st.chosen = true;
    st.since = galaxyStarDate(galaxy);
    registerCorruptionThing(galaxy, e);
    return true;
}

// ---------------------------------------------------------------------------------------------------------------
// The pattern
// ---------------------------------------------------------------------------------------------------------------

function metBy(galaxy: Galaxy, human: Empire, other: Empire): boolean {
    void galaxy;
    return (human.diplomaticRelations?.byEmpire(other)?.type ?? DiplomaticRelationType.NotMet) !== DiplomaticRelationType.NotMet;
}

/**
 * One act of the pattern (by the corrupted empire): every human who has met it counts it; at corruptSuspectActs the human is told (once) that
 * something in the galaxy's politics is wrong, and the Knowledge page shows the suspicion from then on.
 */
export function recordAct(galaxy: Galaxy, st: CorruptedState, actor: Empire, what: string): void {
    st.acts++;
    for (const h of humanEmpires(galaxy)) {
        if (!metBy(galaxy, h, actor)) continue;
        const n = (st.suspect[String(h.empireId)] ?? 0) + 1;
        st.suspect[String(h.empireId)] = n;
        if (n >= CORRUPT_P.suspectActs(galaxy) && !st.warned.includes(h.empireId)) {
            st.warned.push(h.empireId);
            scenarioMessage(galaxy, h, T('Corrupt Pattern Title'), T('Corrupt Pattern Body', actor.name, what), { type: EmpireMessageType.GeneralWarning, popupMode: 'quiet' });
        }
    }
}

/** A Diet session closed a motion: the corrupted empire voted against a preparation motion (a 'no' on it) and that is an act. Read-only on the motion. */
export function corruptedTallyObserver(galaxy: Galaxy, m: { kind: string; text: string; votes: { empire: Empire; vote: string }[] }): void {
    if (!corruptionOn(galaxy) || !isPreparationMotion(m.kind)) return;
    const e = activeCorrupted(galaxy);
    const st = peekCorrupted(galaxy);
    if (e === null || st === null) return;
    if (!m.votes.some((v) => v.empire === e && v.vote === 'no')) return;
    st.votes.push({ date: galaxyStarDate(galaxy), kind: m.kind, text: m.text });
    if (st.votes.length > LOG_LIMIT) st.votes.splice(0, st.votes.length - LOG_LIMIT);
    recordAct(galaxy, st, e, T('Corrupt Pattern Vote', e.name, m.text));
}

// ---------------------------------------------------------------------------------------------------------------
// The endings
// ---------------------------------------------------------------------------------------------------------------

/**
 * The corruption ends for good: the empire is a normal AI again, its leader's hidden thing closes (its leads with it), every other empire's
 * regard for it takes a reputation scar, and the humans who knew of it (met it, or saw its pattern) are told. False when it was not corrupt.
 */
export function endCorruption(galaxy: Galaxy, cause: 'exposed' | 'assassinated' | 'captured' | 'gone', by: Empire | null = null): boolean {
    const st = peekCorrupted(galaxy);
    const e = activeCorrupted(galaxy);
    if (st === null || e === null) return false;
    const now = galaxyStarDate(galaxy);
    st.ended = cause;
    st.endDate = now;
    st.exposedBy = by !== null ? by.empireId : -1;
    // The humans who knew (saw the pattern, held a confirmed lead, or exposed it) hear how it ended; nobody else learns it existed.
    const knew = humanEmpires(galaxy).filter((h) => (st.suspect[String(h.empireId)] ?? 0) > 0 || h.empireId === st.exposedBy || confirmedLeadOf(galaxy, h) !== null);
    const t = corruptionThing(galaxy, e);
    if (t !== undefined) retireHiddenThing(galaxy, t, cause);
    if (cause !== 'gone') {
        for (const x of galaxy.empires) {
            if (x === null || x === e || !x.active || x === galaxy.independentEmpire) continue;
            applyReputation(galaxy, x, e, -CORRUPT_P.reputationScar(galaxy), { cause: 'giantworks.corrupted', labelKey: 'Reputation Cause giantworks.corrupted', source: 'gwCorrupt', decayPerYear: 2 });
        }
        for (const h of knew) {
            scenarioMessage(galaxy, h, T('Corrupt Ended Title'), T('Corrupt Ended Body', e.name, T(`Corrupt Cause ${cause}`)), { type: EmpireMessageType.GeneralGoodEvent, popupMode: 'force', subject: e.capital ?? undefined });
        }
    }
    return true;
}

// ---------------------------------------------------------------------------------------------------------------
// The Knowledge page
// ---------------------------------------------------------------------------------------------------------------

export interface CorruptedRow {
    key: string;
    what: string;
    where: string;
    status: string;
    point: { x: number; y: number } | null;
    goTo: Habitat | null;
}

function systemNameOf(galaxy: Galaxy, h: Habitat): string {
    return galaxy.systems[h.systemIndex]?.systemStar?.name ?? h.name;
}

/**
 * What `viewer` knows of the corrupted empire: nothing until it has seen the pattern (corruptSuspectActs acts) or holds a confirmed lead on its
 * leader or exposed it; then a suspect row; after an ending, the row says how it ended (for those who knew). Pure.
 */
export function corruptedRowsOf(galaxy: Galaxy, viewer: Empire): CorruptedRow[] {
    const st = peekCorrupted(galaxy);
    if (st === null || !st.chosen || st.empireId === null || !isHumanEmpire(galaxy, viewer)) return [];
    const e = galaxy.empires.find((x): x is Empire => x !== null && x.empireId === st.empireId) ?? null;
    if (e === null || e.capital === null) return [];
    const seen = st.suspect[String(viewer.empireId)] ?? 0;
    const confirmed = confirmedLeadOf(galaxy, viewer) !== null || (st.ended === 'exposed' && st.exposedBy === viewer.empireId);
    // Before an ending: suspicion needs the pattern seen often enough; after one, only those who knew still see the row.
    if (st.ended === '' ? seen < CORRUPT_P.suspectActs(galaxy) && !confirmed : seen === 0 && !confirmed) return [];
    const status = st.ended !== '' ? T('Corrupt Row Ended', T(`Corrupt Cause ${st.ended}`)) : confirmed ? T('Corrupt Row Confirmed') : T('Corrupt Row Suspected');
    return [{ key: `corrupted:${e.empireId}`, what: T('Corrupt Row Name', e.name), where: systemNameOf(galaxy, e.capital), status, point: { x: e.capital.xpos, y: e.capital.ypos }, goTo: e.capital }];
}
