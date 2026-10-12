// Characters & Victory, part 2: the Interstellar Diet (docs/CHARACTERS_AND_VICTORY.md §7). Not a port. It extends
// the galactic-council add-on (emergent/council.ts) through registerCouncilExtension: the council keeps its founding,
// membership, chair, standing sanctions and blocs, while the Diet holds the sessions — every 2-3 years, 1-3 motions
// proposed by the members, at a host world (the strongest member's colony nearest the galaxy centre), with weighted
// votes cast only by delegates who travelled there in person (Part 1's VIP shuttles and governor duty).
//
// Every effect goes through ported code: trade sanctions / embargoes / condemnations / lifts / recognitions / threats
// through council.ts applyMotion (StartTradeSanctions, Empire.8.cs 1586, ...); a truce and galactic free trade through
// ChangeDiplomaticRelation (Empire.8.cs 2550) to Truce / FreeTradeAgreement; war through DeclareWar (Empire.7.cs 4868);
// the Bombard / WaitAndBombard missions and planet destroyers refused through the assignMissionAllowed query
// (BuiltObject.2.cs 7620 AssignMission); the host world's bonuses as a virtual wonder of the real WonderType kinds on
// the stock wonder paths (Habitat.cs 5124 / 638 / BaconConstructionQueue.cs 45) and visitors through the scenic factor
// (Habitat.cs 1116); attitude through applyReputation (reputation ledger or the stock IncidentEvaluation), reputation
// through the CivilityRating setter (Empire.cs 1430); the Emperor's countdown ends the game through victory.ts
// onGameEnd / humansGameEnd (Galaxy.cs 1274 OnGameEnd; multiplayer: the first human to win ends the game).
//
// Rnd: galaxy.rnd only inside the gated handlers (the 2-3 year session interval, the enforcers' spawn and station).

import type { Galaxy } from '../../../galaxy';
import type { Empire } from '../../../empire';
import type { Habitat } from '../../../types';
import { BuiltObject } from '../../../builtObject';
import { type Character, CharacterRole, isBuiltObjectLocation } from '../../../characters';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../../../diplomacy';
import { changeDiplomaticRelation, declareWar, setCivilityRating } from '../../../diplomacyTick';
import { EmpireMessageType } from '../../../messages';
import { WonderType } from '../../../researchSystem';
import { BuiltObjectMissionType, BuiltObjectMissionPriority } from '../../../missions/mission';
import { assignMission } from '../../../missions/assign';
import { leaveShipGroup } from '../../../fleets/shipGroup';
import { BuiltObjectRole } from '../../../data/designSpecifications';
import { BuiltObjectSubRole } from '../../../builtObjectTypes';
import { GameEndEventArgs, GameEndOutcome, humansGameEnd, onGameEnd } from '../../../victory';
import { identifyMechanoidEmpire } from '../../../fleets/militaryAI';
import { YEAR_LENGTH, resolveStarDateDescription } from '../../../galaxyTime';
import { galaxyStarDate } from '../../../tick/simTime';
import { humanEmpires, isHumanEmpire, isMultiHuman } from '../../../humanEmpires';
import { withinFuelRangeAndRefuel } from '../../../movement';
import { calculateEmpireScore } from '../../../achievements';
import { gameYear, registerScenarioEvent, registerScenarioPeriodic, registerScenarioQuery, registerScenarioYearly } from '../../hooks';
import { scenarioFlag } from '../../state';
import { scenarioMessage, scenarioNews, scenarioText } from '../../messages';
import { applyReputation } from '../../reputation/ledger';
import {
    applyMotion,
    councilState,
    electChair,
    motionText,
    peekCouncilState,
    recordLosses,
    registerCouncilExtension,
    scoreToVote,
    attitudeOf,
    blocOf,
    type Council,
} from '../../emergent/council';
import { endGovernorDuty, lockGovernorPost, mostImportantGovernor, setGovernorDuty, empireGovernors } from '../governorsCv';
import { assignEscorts, tripOfCharacter, tripOfShuttle, vipTripView } from '../vip';
import { sendVip } from '../index';
import {
    CV_DIET_VICTORY_FLAG,
    CV_FLAG,
    DIET_EMPEROR_DEFEAT_CODE,
    DIET_EMPEROR_VICTORY_CODE,
    DIET_NAME,
    DIET_TRIP_REASON,
    STOCK_KINDS,
    type DietDelegate,
    type DietLaw,
    type DietLawKind,
    type DietMotion,
    type DietMotionKind,
    type DietSession,
    type DietState,
    byId,
    dietMotionKindDef,
    dietOn,
    dietSeatExcluded,
    dietParam,
    dietState,
    lawInForce,
    peekDietState,
} from './dietState';
import { asCouncilMotion, atWar, dietMembership, inDiet, attacksDelegates, dietCandidates, dietVoteScore, emergencyCase, emperorBidBlock, joinsWarOnEmperor, memberScores, voteWeight } from './dietAi';
import { militaryPotency } from '../../../diplomacyTick';
import { aiDefiance, collectDues, enforcerFleetOf, enforcerUpkeep, ensureFaction, isEnforcerFaction, recallEnforcers, reviewEnforcers, spawnEnforcers } from './dietEnforcers';
import type { DietCandidate as Cand, DietCandidate } from './dietAi';

const DAY = YEAR_LENGTH / 360;
type Vote = 'yes' | 'no' | 'abstain';

// ---------------------------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------------------------

/** The Diet's council (the one it adopted; else the first). Null: none founded. */
export function dietCouncil(galaxy: Galaxy): Council | null {
    const cs = peekCouncilState(galaxy);
    if (cs === null || cs.councils.length === 0) return null;
    const st = peekDietState(galaxy);
    const id = st?.councilId ?? 0;
    return cs.councils.find((c) => c.id === id) ?? cs.councils[0];
}

function members(galaxy: Galaxy, c: Council, st: DietState): Empire[] {
    return dietMembership(galaxy, c).filter((m) => m.active && st.expelled[m.empireId] === undefined).sort(byId);
}

function humanMembers(galaxy: Galaxy, c: Council, st: DietState): Empire[] {
    return members(galaxy, c, st).filter((m) => isHumanEmpire(galaxy, m));
}

function tell(galaxy: Galaxy, to: readonly Empire[], titleTag: string, text: string, opts: { bad?: boolean; good?: boolean; popup?: boolean; subject?: unknown } = {}): void {
    const type = opts.bad ? EmpireMessageType.GeneralBadEvent : opts.good ? EmpireMessageType.GeneralGoodEvent : EmpireMessageType.GeneralNeutralEvent;
    for (const e of to) {
        if (!e.active || !isHumanEmpire(galaxy, e)) continue;
        scenarioMessage(galaxy, e, scenarioText(titleTag), text, { type, subject: opts.subject ?? null, popup: opts.popup ?? false, log: { category: 'council' } });
    }
}

/** A NewsNet line for everyone but the Diet's human members (they get their own message). */
function news(galaxy: Galaxy, source: Empire | null, text: string, subject: unknown): void {
    const c = dietCouncil(galaxy);
    scenarioNews(galaxy, source, text, (e) => !(isHumanEmpire(galaxy, e) && c !== null && inDiet(galaxy, c, e)), subject, { category: 'council' });
}

function nameOf(e: Empire | null): string {
    return e?.name ?? '';
}

/** Motion text: the council's own wording for its kinds, the Diet's for the rest. */
export function dietMotionText(galaxy: Galaxy, st: DietState, kind: DietMotionKind, target: Empire | null, other: Empire | null, colony: Habitat | null, resourceId: number): string {
    if (STOCK_KINDS.has(kind) && target !== null) return motionText(galaxy, kind as never, target, other, resourceId);
    switch (kind) {
        case 'truce':
            return scenarioText('Diet Motion Truce', nameOf(target), nameOf(other));
        case 'freeTrade':
            return scenarioText('Diet Motion FreeTrade');
        case 'banPlanetDestroyers':
            return scenarioText('Diet Motion BanPlanetDestroyers');
        case 'banBombard':
            return scenarioText('Diet Motion BanBombard');
        case 'outlawPirates':
            return scenarioText('Diet Motion Outlaw', nameOf(target));
        case 'protectIndependents':
            return scenarioText('Diet Motion Protect');
        case 'openIndependents':
            return scenarioText('Diet Motion Open');
        case 'claim':
            return scenarioText('Diet Motion Claim', nameOf(target === null ? null : target), colony?.name ?? '', nameOf(colony?.empire ?? null));
        case 'expel':
            return scenarioText('Diet Motion Expel', nameOf(target));
        case 'regent':
            return scenarioText('Diet Motion Regent', nameOf(target));
        case 'repeal': {
            const law = st.laws.find((l) => l.id === resourceId);
            return scenarioText('Diet Motion Repeal', law?.text ?? '');
        }
        default: {
            const def = dietMotionKindDef(kind);
            return def !== null ? def.text(galaxy, st, { target, other, colony, resourceId }) : kind;
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// The seat: host and host world
// ---------------------------------------------------------------------------------------------------------------

/** The strongest member by Galaxy.1.cs 2863 CalculateEmpireScore (ties by id). Pure. */
export function strongestMember(galaxy: Galaxy, ms: readonly Empire[]): Empire | null {
    let best: Empire | null = null;
    let bv = -Infinity;
    // The Ancient Guardians (the story's Mechanoids, Galaxy IdentifyMechanoidEmpire) are not Diet members and never host.
    const guardians = identifyMechanoidEmpire(galaxy);
    for (const e of ms) {
        if (e === guardians && ms.length > 1) continue;
        if (ms.length > 1 && dietSeatExcluded(galaxy, e)) continue;
        const s = calculateEmpireScore(galaxy, e).score;
        if (s > bv) {
            bv = s;
            best = e;
        }
    }
    return best;
}

/** The host's populated colony nearest the galaxy centre (ties by habitat index). Pure. */
export function hostWorldOf(galaxy: Galaxy, host: Empire): Habitat | null {
    const cx = galaxy.sizeX / 2;
    const cy = galaxy.sizeY / 2;
    let best: Habitat | null = null;
    let bd = Infinity;
    for (const h of host.colonies) {
        if (h.empire !== host || (h.population?.totalAmount ?? 0) <= 0) continue;
        const d = galaxy.calculateDistance(h.xpos, h.ypos, cx, cy);
        if (d < bd || (d === bd && best !== null && h.habitatIndex < best.habitatIndex)) {
            bd = d;
            best = h;
        }
    }
    return best;
}

/** Re-seats the Diet at a session call: the seat moves when the strongest member changed. */
function updateSeat(galaxy: Galaxy, st: DietState, c: Council): void {
    const ms = members(galaxy, c, st);
    const host = strongestMember(galaxy, ms);
    if (host === null) return;
    const world = hostWorldOf(galaxy, host);
    if (world === null) return;
    const moved = st.world !== null && (st.host !== host || st.world !== world);
    if (st.host !== host || st.world !== world || st.world === null) {
        st.host = host;
        st.world = world;
        if (moved) {
            st.counters.seatMoves++;
            news(galaxy, host, scenarioText('Diet Seat Moved News', world.name, host.name), world);
        }
    }
    if (st.faction !== null) st.faction.capital = world;
}

function hostingNow(st: DietState | null, h: Habitat): boolean {
    return st !== null && st.world === h && st.host !== null && h.empire === st.host;
}

// ---------------------------------------------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------------------------------------------

function scheduleNext(galaxy: Galaxy, st: DietState, from: number): void {
    const lo = dietParam(galaxy, 'dietSessionMinYears');
    const hi = Math.max(lo, dietParam(galaxy, 'dietSessionMaxYears'));
    const days = Math.round(lo * 360 + galaxy.rnd.nextDouble() * (hi - lo) * 360);
    st.nextSessionAt = from + days * DAY;
}

/** The delegate an empire sends: the player's choice when valid, else its most important governor (Part 1). */
function chooseDelegate(galaxy: Galaxy, st: DietState, e: Empire): { character: Character | null; lesser: boolean } {
    const best = mostImportantGovernor(galaxy, e);
    const pick = st.delegateChoice[e.empireId] ?? null;
    if (pick !== null && pick.active && pick.empire === e && pick.role === CharacterRole.ColonyGovernor && tripOfCharacter(galaxy, pick) === null && pick.location !== null && !isBuiltObjectLocation(pick.location)) {
        return { character: pick, lesser: best !== null && pick !== best };
    }
    return { character: best, lesser: false };
}

/** Sends a delegate to the host world (VIP shuttle; their post kept on duty; delegate trips count as important). */
function dispatch(galaxy: Galaxy, st: DietState, s: DietSession, d: DietDelegate): void {
    const ch = d.character;
    if (ch === null) return;
    if (ch.location === s.world) return;
    if (ch.location !== null && !isBuiltObjectLocation(ch.location)) (st.abroad ??= []).push({ character: ch, post: ch.location as Habitat, empire: d.empire });
    setGovernorDuty(galaxy, ch, DIET_TRIP_REASON);
    sendVip(galaxy, ch, s.world, DIET_TRIP_REASON);
    d.sent = true;
    st.counters.delegatesSent++;
    if (d.lesser) st.counters.lesserDelegates++;
    // Defend delegates sensibly: a delegate's trip counts as an important one for the escort rules (Part 1 §4.4).
    const t = tripOfCharacter(galaxy, ch);
    if (t !== null && t.importance < 5) {
        t.importance = 5;
        if (t.escorts.length === 0) assignEscorts(galaxy, t);
    }
}

function present(s: DietSession, d: DietDelegate): boolean {
    return d.character !== null && d.character.active && d.character.location === s.world && !d.lost;
}

/** The motion of one candidate (text and an empty vote). */
function makeMotion(galaxy: Galaxy, st: DietState, cand: Omit<DietCandidate, 'weight'>): DietMotion {
    st.counters.proposed[cand.kind] = (st.counters.proposed[cand.kind] ?? 0) + 1;
    return {
        id: st.nextId++,
        kind: cand.kind,
        proposer: cand.proposer,
        target: cand.target,
        other: cand.other,
        colony: cand.colony,
        resourceId: cand.resourceId,
        text: dietMotionText(galaxy, st, cand.kind, cand.target, cand.other, cand.colony, cand.resourceId),
        votes: [],
        status: 'voting',
        yes: 0,
        no: 0,
    };
}

function sameMotion(a: { kind: DietMotionKind; target: Empire | null; resourceId: number }, b: { kind: DietMotionKind; target: Empire | null; resourceId: number }): boolean {
    // One motion of a kind per session, except the targeted punishments (one per target).
    if (a.kind !== b.kind) return a.target !== null && a.target === b.target && (a.kind === 'sanction' || a.kind === 'embargo') && (b.kind === 'sanction' || b.kind === 'embargo');
    if (a.kind === 'sanction' || a.kind === 'embargo' || a.kind === 'condemn' || a.kind === 'expel') return a.target === b.target;
    return true;
}

/** The agenda: every human member's proposal, then the heaviest AI candidates (1-3 by how many carry weight ≥ 30). */
function agenda(galaxy: Galaxy, st: DietState, c: Council, year: number, first: Cand | null): DietMotion[] {
    const out: DietMotion[] = [];
    const take = (x: Omit<DietCandidate, 'weight'>): void => {
        if (out.some((m) => sameMotion(m, x) || (m.proposer === x.proposer && !isHumanEmpire(galaxy, x.proposer)))) return;
        out.push(makeMotion(galaxy, st, x));
    };
    if (first !== null) take(first);
    for (const h of humanMembers(galaxy, c, st)) {
        const p = st.proposals[h.empireId];
        if (p !== undefined) take({ ...p, proposer: h });
        delete st.proposals[h.empireId];
    }
    if (first !== null) return out;
    const cands = dietCandidates(galaxy, c, st, year);
    const heavy = cands.filter((x) => x.weight >= 30).length;
    const n = Math.max(1, Math.min(Math.trunc(dietParam(galaxy, 'dietMaxMotions')), heavy));
    for (const x of cands) {
        if (out.filter((m) => !isHumanEmpire(galaxy, m.proposer)).length >= n) break;
        take(x);
    }
    return out;
}

/** Calls a session: seat, delegates sent, agenda set. `first`: an emergency's one motion. */
export function callSession(galaxy: Galaxy, st: DietState, c: Council, emergency: boolean, caller: Empire | null, first: Cand | null): DietSession | null {
    if (st.session !== null) return null;
    updateSeat(galaxy, st, c);
    if (st.world === null || st.host === null) return null;
    const now = galaxyStarDate(galaxy);
    const gather = dietParam(galaxy, emergency ? 'dietEmergencyGatherDays' : 'dietGatherDays');
    const s: DietSession = {
        id: st.nextId++,
        emergency,
        calledBy: caller,
        called: now,
        opens: now + gather * DAY,
        closes: now + (gather + dietParam(galaxy, 'dietVoteDays')) * DAY,
        stage: 'gathering',
        host: st.host,
        world: st.world,
        delegates: [],
        motions: [],
        vetoUsed: false,
    };
    st.session = s;
    st.vetoMotionId = 0;
    s.motions = agenda(galaxy, st, c, gameYear(now), first);
    for (const e of members(galaxy, c, st)) {
        const pick = chooseDelegate(galaxy, st, e);
        const d: DietDelegate = { empire: e, character: pick.character, lesser: pick.lesser, sent: false, lost: false };
        s.delegates.push(d);
        dispatch(galaxy, st, s, d);
    }
    // The floor opens when the farthest delegate can be there (its shuttle's ETA + 15 days), within dietGatherDays
    // (at least) and 540 days (at most: early hyperdrives on a large map need over a year); an emergency session keeps
    // its short call.
    if (!emergency) {
        let eta = s.opens;
        for (const d of s.delegates) {
            if (!d.sent || d.character === null) continue;
            const v = vipTripView(galaxy, d.character);
            // The straight-line ETA misses jumps, acceleration and detours: × 1.35, + 20 days.
            if (v !== null) eta = Math.max(eta, now + (v.etaStarDate - now) * 1.35 + 20 * DAY);
        }
        s.opens = Math.min(now + 600 * DAY, eta);
        st.counters.gatherDaysTotal = (st.counters.gatherDaysTotal ?? 0) + Math.round((s.opens - now) / DAY);
        s.closes = s.opens + dietParam(galaxy, 'dietVoteDays') * DAY;
    }
    st.counters.sessions++;
    if (emergency) st.counters.emergencySessions++;
    const list = s.motions.map((m) => m.text).join('; ');
    news(galaxy, caller, scenarioText(emergency ? 'Diet Emergency Called News' : 'Diet Session Called News', s.world.name, s.host.name, list || scenarioText('Diet No Motions')), s.world);
    for (const h of humanMembers(galaxy, c, st)) {
        const d = s.delegates.find((x) => x.empire === h);
        const who = d?.character !== null && d?.character !== undefined ? d.character.name : scenarioText('Diet No Delegate');
        tell(galaxy, [h], emergency ? 'Diet Emergency Title' : 'Diet Session Title', scenarioText('Diet Session Called You', s.world.name, who, list || scenarioText('Diet No Motions')), { popup: true, subject: s.world });
    }
    return s;
}

/** The floor opens: the delegates present vote (AI now; humans until the close). */
function openFloor(galaxy: Galaxy, st: DietState, c: Council, s: DietSession): void {
    s.stage = 'voting';
    for (const d of s.delegates) {
        if (d.sent && d.character !== null && !d.lost && !present(s, d)) st.counters.delegatesAbsent++;
    }
    for (const m of s.motions) {
        for (const d of s.delegates) {
            if (isHumanEmpire(galaxy, d.empire) || !present(s, d)) continue;
            castAi(galaxy, st, c, m, d.empire);
        }
    }
    tell(galaxy, humanMembers(galaxy, c, st), 'Diet Session Title', scenarioText('Diet Floor Open', s.world.name), { subject: s.world });
}

function castAi(galaxy: Galaxy, st: DietState, c: Council, m: DietMotion, e: Empire): void {
    const score = dietVoteScore(galaxy, c, st, e, m);
    m.votes = m.votes.filter((v) => v.empire !== e);
    m.votes.push({ empire: e, vote: scoreToVote(galaxy, score), weight: 0, score });
}

/** The tally: present delegates' weighted votes; the Regent's veto; effects; delegates go home; next session. */
export function closeSession(galaxy: Galaxy, st: DietState, c: Council, s: DietSession): void {
    const ms = members(galaxy, c, st);
    const scores = memberScores(galaxy, ms);
    const now = galaxyStarDate(galaxy);
    const year = gameYear(now);
    // A delegate who arrived late (during the vote) still votes; one who left or died does not.
    for (const m of s.motions) {
        for (const d of s.delegates) {
            if (!isHumanEmpire(galaxy, d.empire) && present(s, d) && !m.votes.some((v) => v.empire === d.empire)) castAi(galaxy, st, c, m, d.empire);
        }
        m.votes = m.votes.filter((v) => {
            const d = s.delegates.find((x) => x.empire === v.empire);
            return d !== undefined && present(s, d) && ms.includes(v.empire);
        });
        for (const v of m.votes) {
            const d = s.delegates.find((x) => x.empire === v.empire)!;
            v.weight = voteWeight(galaxy, st, ms, scores, v.empire, d.lesser).weight;
        }
        m.yes = round1(m.votes.filter((v) => v.vote === 'yes').reduce((a, v) => a + v.weight, 0));
        m.no = round1(m.votes.filter((v) => v.vote === 'no').reduce((a, v) => a + v.weight, 0));
    }
    // The Regent's veto (one per session): the human's choice, or the AI Regent's worst passing motion it opposes (score ≤ −0.5).
    const regent = st.regent !== null && st.regent.active && ms.includes(st.regent) && now < st.regentUntil ? st.regent : null;
    if (regent !== null && !s.vetoUsed) {
        const regentDelegate = s.delegates.find((d) => d.empire === regent);
        if (regentDelegate !== undefined && present(s, regentDelegate)) {
            let veto: DietMotion | null = null;
            if (isHumanEmpire(galaxy, regent)) veto = s.motions.find((m) => m.id === (st.vetoMotionId ?? 0)) ?? null;
            else {
                let worst = -0.5; // a passing motion the Regent opposes (or one striking at its ally or friend)
                for (const m of s.motions) {
                    if (!(m.yes > m.no) || m.kind === 'regent') continue;
                    let sc = dietVoteScore(galaxy, c, st, regent, m);
                    const ally = m.target !== null && m.target !== regent && [DiplomaticRelationType.MutualDefensePact, DiplomaticRelationType.Protectorate, DiplomaticRelationType.SubjugatedDominion].includes(regent.diplomaticRelations.byEmpire(m.target)?.type ?? DiplomaticRelationType.NotMet);
                    const friend = m.target !== null && m.target !== regent && attitudeOf(regent, m.target) >= 20;
                    if ((ally || friend) && ['sanction', 'embargo', 'condemn', 'expel', 'threat'].includes(m.kind)) sc = Math.min(sc, -50);
                    if (sc <= worst) {
                        worst = sc;
                        veto = m;
                    }
                }
            }
            if (veto !== null) {
                veto.status = 'vetoed';
                s.vetoUsed = true;
                st.counters.vetoes++;
                news(galaxy, regent, scenarioText('Diet Veto News', regent.name, veto.text), null);
            }
        }
    }
    const lines: string[] = [];
    for (const m of s.motions) {
        if (m.status !== 'vetoed') m.status = m.yes > m.no ? 'passed' : 'failed';
        const passed = m.status === 'passed';
        st.history.push({ sessionId: s.id, starDate: now, kind: m.kind, text: m.text, result: m.status as 'passed' | 'failed' | 'vetoed', yes: m.yes, no: m.no, proposer: m.proposer });
        if (STOCK_KINDS.has(m.kind) && m.target !== null) {
            c.results.push({ motionId: m.id, year, kind: m.kind as never, text: m.text, passed, yes: m.votes.filter((v) => v.vote === 'yes').length, no: m.votes.filter((v) => v.vote === 'no').length, abstain: m.votes.filter((v) => v.vote === 'abstain').length, proposer: m.proposer, target: m.target });
            if (c.results.length > 20) c.results.splice(0, c.results.length - 20);
            recordLosses(galaxy, c, asCouncilMotion(m, year, now), passed, year);
        }
        lines.push(scenarioText('Diet Result Line', m.text, scenarioText(`Diet Result ${m.status}`), m.yes, m.no));
        if (passed) {
            st.counters.passed[m.kind] = (st.counters.passed[m.kind] ?? 0) + 1;
            applyDietMotion(galaxy, st, c, m, year);
        } else dietMotionKindDef(m.kind)?.failed?.(galaxy, st, m); // a registered kind's failed / vetoed motion (War Crimes)
    }
    if (st.history.length > 40) st.history.splice(0, st.history.length - 40);
    news(galaxy, null, scenarioText('Diet Session Closed News', s.world.name, lines.join(' ') || scenarioText('Diet No Motions')), s.world);
    tell(galaxy, humanMembers(galaxy, c, st), 'Diet Results Title', lines.join('\n') || scenarioText('Diet No Motions'), { popup: s.motions.length > 0, subject: s.world });
    // Delegates go home (the duty ends: Part 1 sends them back by VIP shuttle).
    for (const d of s.delegates) {
        const ch = d.character;
        if (ch === null) continue;
        endGovernorDuty(galaxy, ch);
        // The way home is still a delegate's trip (attacks on it are crimes; a death there locks the post).
        const back = (st.abroad ?? []).find((a) => a.character === ch);
        if (back !== undefined && ch.active && tripOfCharacter(galaxy, ch) !== null) sendVip(galaxy, ch, back.post, DIET_TRIP_REASON);
    }
    st.session = null;
    st.vetoMotionId = 0;
    // Sessions every 2-3 years from one call to the next (a long gathering does not stretch the rhythm), and at least
    // half a year after this one closed.
    if (!s.emergency || st.nextSessionAt < now) scheduleNext(galaxy, st, s.called);
    st.nextSessionAt = Math.max(st.nextSessionAt, now + 180 * DAY);
}

function round1(v: number): number {
    return Math.round(v * 10) / 10;
}

// ---------------------------------------------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------------------------------------------

function addLaw(st: DietState, kind: DietLawKind, empire: Empire | null, other: Empire | null, colony: Habitat | null, until: number, text: string, now: number): DietLaw {
    const law: DietLaw = { id: st.nextId++, kind, empire, other, colony, since: now, until, text };
    st.laws.push(law);
    return law;
}

function removeLaw(st: DietState, law: DietLaw): void {
    const i = st.laws.indexOf(law);
    if (i >= 0) st.laws.splice(i, 1);
}

/** Free trade between every pair of met members whose relation is plain None (ChangeDiplomaticRelation → FreeTradeAgreement). */
function applyFreeTrade(galaxy: Galaxy, c: Council, st: DietState): void {
    const ms = members(galaxy, c, st);
    for (let i = 0; i < ms.length; i++) {
        for (let j = i + 1; j < ms.length; j++) {
            const a = ms[i];
            const b = ms[j];
            const r = a.diplomaticRelations.byEmpire(b);
            if (r === null || r.type !== DiplomaticRelationType.None) continue;
            changeDiplomaticRelation(galaxy, a, obtainDiplomaticRelation(a, b), DiplomaticRelationType.FreeTradeAgreement);
        }
    }
}

function applyDietMotion(galaxy: Galaxy, st: DietState, c: Council, m: DietMotion, year: number): void {
    const now = galaxyStarDate(galaxy);
    if (STOCK_KINDS.has(m.kind) && m.target !== null) {
        applyMotion(galaxy, c, asCouncilMotion(m, year, now), year);
        if (m.kind === 'sanction') spawnEnforcers(galaxy, st, c, m.target);
        if (m.kind === 'lift') for (const f of st.enforcers.filter((x) => x.target === m.target)) recallEnforcers(galaxy, st, f, 'lifted');
        return;
    }
    switch (m.kind) {
        case 'truce': {
            const a = m.target!;
            const b = m.other!;
            if (atWar(a, b)) changeDiplomaticRelation(galaxy, a, obtainDiplomaticRelation(a, b), DiplomaticRelationType.Truce);
            addLaw(st, 'truce', a, b, null, now + dietParam(galaxy, 'dietTruceYears') * YEAR_LENGTH, m.text, now);
            break;
        }
        case 'freeTrade':
            addLaw(st, 'freeTrade', null, null, null, -1, m.text, now);
            applyFreeTrade(galaxy, c, st);
            break;
        case 'banPlanetDestroyers':
        case 'banBombard':
        case 'protectIndependents':
            if (m.kind === 'protectIndependents') for (const l of st.laws.filter((x) => x.kind === 'openIndependents')) removeLaw(st, l);
            addLaw(st, m.kind, null, null, null, -1, m.text, now);
            break;
        case 'openIndependents':
            for (const l of st.laws.filter((x) => x.kind === 'protectIndependents')) removeLaw(st, l);
            addLaw(st, 'openIndependents', null, null, null, -1, m.text, now);
            break;
        case 'outlawPirates':
            addLaw(st, 'outlawPirates', m.target, null, null, -1, m.text, now);
            break;
        case 'claim':
            if (m.colony !== null) addLaw(st, 'claim', m.proposer, m.colony.empire, m.colony, now + 10 * YEAR_LENGTH, m.text, now);
            break;
        case 'expel':
            if (m.target !== null) expel(galaxy, st, c, m.target, year);
            break;
        case 'regent':
            if (m.target !== null && !dietSeatExcluded(galaxy, m.target)) {
                st.regent = m.target;
                st.regentUntil = now + dietParam(galaxy, 'dietRegentYears') * YEAR_LENGTH;
                st.counters.regents++;
                news(galaxy, m.target, scenarioText('Diet Regent News', m.target.name), null);
                tell(galaxy, members(galaxy, c, st), 'Diet Regent Title', scenarioText('Diet Regent', m.target.name), { popup: true, good: isHumanEmpire(galaxy, m.target) });
            }
            break;
        case 'repeal': {
            const law = st.laws.find((l) => l.id === m.resourceId);
            if (law !== undefined) removeLaw(st, law);
            break;
        }
        default: {
            const def = dietMotionKindDef(m.kind);
            if (def !== null) def.apply(galaxy, st, m, (kind, empire, other, colony, until) => addLaw(st, kind, empire, other, colony, until, m.text, now));
            break;
        }
    }
}

/** A registered law's breach (The Voidbloom War's ban): the Diet's violation path. Exported for registered kinds. */
export function dietLawViolation(galaxy: Galaxy, offender: Empire, law: DietLaw): void {
    const st = peekDietState(galaxy);
    const c = dietCouncil(galaxy);
    if (st === null || c === null || !inDiet(galaxy, c, offender)) return;
    violation(galaxy, st, c, offender, law);
}

/** Expulsion: out of the council (and its blocs), no rejoining for dietExpelYears. */
function expel(galaxy: Galaxy, st: DietState, c: Council, e: Empire, year: number): void {
    const i = c.members.indexOf(e);
    if (i >= 0) c.members.splice(i, 1);
    for (const b of c.blocs) {
        const j = b.members.indexOf(e);
        if (j >= 0) b.members.splice(j, 1);
    }
    c.blocs = c.blocs.filter((b) => b.members.length >= 2);
    if (c.chair === e) electChair(c);
    st.expelled[e.empireId] = galaxyStarDate(galaxy);
    // The council's rejoin rule (councilRejoinYears after leaving) is pushed out to the expulsion's length.
    councilState(galaxy).leftYear[e.empireId] = year + Math.max(0, dietParam(galaxy, 'dietExpelYears') - 5);
    if (st.regent === e) st.regent = null;
    news(galaxy, e, scenarioText('Diet Expelled News', e.name), null);
    tell(galaxy, [e], 'Diet Expelled Title', scenarioText('Diet Expelled You'), { popup: true, bad: true });
}

/** Automatic sanctions (a broken truce): the council's sanction applied at once, with the enforcers. */
function automaticSanctions(galaxy: Galaxy, st: DietState, c: Council, offender: Empire, why: string): void {
    const year = gameYear(galaxyStarDate(galaxy));
    const m = makeMotion(galaxy, st, { kind: 'sanction', proposer: st.regent ?? st.host ?? offender, target: offender, other: null, colony: null, resourceId: -1 });
    m.status = 'passed';
    applyDietMotion(galaxy, st, c, m, year);
    news(galaxy, null, scenarioText('Diet Automatic Sanctions News', offender.name, why), null);
    tell(galaxy, [offender], 'Diet Enforcers Title', scenarioText('Diet Automatic Sanctions You', why), { popup: true, bad: true });
}

// ---------------------------------------------------------------------------------------------------------------
// Crimes, defiance, violations
// ---------------------------------------------------------------------------------------------------------------

/** A major crime against the Diet (attacking delegates, or the host during a session): every member resents it. */
function crime(galaxy: Galaxy, st: DietState, c: Council, offender: Empire, what: string): void {
    st.counters.crimes++;
    const pen = dietParam(galaxy, 'dietCrimePenalty');
    for (const m of members(galaxy, c, st)) {
        if (m === offender) continue;
        applyReputation(galaxy, m, offender, -pen, { cause: 'dietCrime', labelKey: 'Diet Reputation Crime', source: 'interstellarDiet' });
    }
    if (offender.pirateEmpireBaseHabitat === null) setCivilityRating(offender, offender.civilityRating - 3);
    st.grievances[offender.empireId] = (st.grievances[offender.empireId] ?? 0) + 60;
    news(galaxy, null, scenarioText('Diet Crime News', offender.name, what), null);
    tell(galaxy, members(galaxy, c, st).filter((m) => m !== offender), 'Diet Crime Title', scenarioText('Diet Crime', offender.name, what), { popup: true, bad: true });
}

function defiance(galaxy: Galaxy, st: DietState, c: Council, offender: Empire): void {
    st.counters.defiance++;
    const pen = dietParam(galaxy, 'dietDefiancePenalty');
    for (const m of members(galaxy, c, st)) {
        if (m === offender) continue;
        applyReputation(galaxy, m, offender, -pen, { cause: 'dietDefiance', labelKey: 'Diet Reputation Defiance', source: 'interstellarDiet' });
    }
    st.grievances[offender.empireId] = (st.grievances[offender.empireId] ?? 0) + 40;
    news(galaxy, offender, scenarioText('Diet Defiance News', offender.name), null);
    // Open defiance: an emergency case (expulsion of a member, else a declared threat).
    st.pendingEmergency = { kind: inDiet(galaxy, c, offender) ? 'expel' : 'threat', target: offender, other: null, at: galaxyStarDate(galaxy), why: 'defiance' };
}

function violation(galaxy: Galaxy, st: DietState, c: Council, offender: Empire, law: DietLaw): void {
    st.counters.banViolations++;
    for (const m of members(galaxy, c, st)) {
        if (m === offender) continue;
        applyReputation(galaxy, m, offender, -15, { cause: 'dietViolation', labelKey: 'Diet Reputation Violation', source: 'interstellarDiet' });
    }
    st.grievances[offender.empireId] = (st.grievances[offender.empireId] ?? 0) + 40;
    tell(galaxy, members(galaxy, c, st), 'Diet Violation Title', scenarioText('Diet Violation', offender.name, law.text), { bad: true });
}

// ---------------------------------------------------------------------------------------------------------------
// The Regent and the Emperor
// ---------------------------------------------------------------------------------------------------------------

function activeRegent(galaxy: Galaxy, st: DietState, c: Council): Empire | null {
    const r = st.regent;
    if (r === null || !r.active || !inDiet(galaxy, c, r) || galaxyStarDate(galaxy) >= st.regentUntil) return null;
    return r;
}

/** The Regent calls an emergency session (once every dietEmergencyYears). */
export function callEmergency(galaxy: Galaxy, empire: Empire, first: Cand | null): boolean {
    const st = peekDietState(galaxy);
    const c = dietCouncil(galaxy);
    if (st === null || c === null || st.session !== null || activeRegent(galaxy, st, c) !== empire) return false;
    const now = galaxyStarDate(galaxy);
    if (st.lastEmergency >= 0 && now - st.lastEmergency < dietParam(galaxy, 'dietEmergencyYears') * YEAR_LENGTH) return false;
    st.lastEmergency = now;
    callSession(galaxy, st, c, true, empire, first);
    return true;
}

/** The Regent declares themselves Emperor: a countdown in which everyone may make war on them. */
export function declareEmperor(galaxy: Galaxy, empire: Empire): boolean {
    const st = peekDietState(galaxy);
    const c = dietCouncil(galaxy);
    if (st === null || c === null || st.emperor !== null || activeRegent(galaxy, st, c) !== empire) return false;
    if (empire.capital === null || st.world === null) return false;
    const now = galaxyStarDate(galaxy);
    st.emperor = { empire, capital: empire.capital, world: st.world, since: now, until: now + dietParam(galaxy, 'dietEmperorYears') * YEAR_LENGTH };
    (st.emperor as { joined?: number[] }).joined = [];
    st.counters.emperorBids++;
    // A Regent who does not hold the host world goes to war for it (its holder may resist).
    const holder = st.world.empire;
    if (holder !== null && holder !== empire && !atWar(empire, holder) && holder.pirateEmpireBaseHabitat === null) declareWar(galaxy, empire, holder);
    scenarioNews(galaxy, empire, scenarioText('Diet Emperor News', empire.name, st.world.name, empire.capital.name, Math.round(dietParam(galaxy, 'dietEmperorYears'))), (e) => !isHumanEmpire(galaxy, e), st.world, { category: 'council' });
    for (const h of humanEmpires(galaxy)) {
        scenarioMessage(galaxy, h, scenarioText('Diet Emperor Title'), h === empire ? scenarioText('Diet Emperor You', st.world.name, empire.capital.name) : scenarioText('Diet Emperor Other', empire.name, st.world.name, empire.capital.name), { type: h === empire ? EmpireMessageType.GeneralGoodEvent : EmpireMessageType.GeneralBadEvent, subject: st.world, log: { category: 'council' } });
    }
    return true;
}

function emperorEnds(galaxy: Galaxy, st: DietState, c: Council | null, won: boolean): void {
    const em = st.emperor;
    if (em === null) return;
    st.emperor = null;
    const e = em.empire;
    if (won) {
        st.counters.emperorWins++;
        news(galaxy, e, scenarioText('Diet Emperor Won News', e.name), em.world);
        if (scenarioFlag(galaxy, CV_DIET_VICTORY_FLAG)) {
            const text = scenarioText('Diet Emperor Won Text', e.name);
            if (isMultiHuman(galaxy)) humansGameEnd(galaxy, e, isHumanEmpire(galaxy, e) ? [e] : [], text, DIET_EMPEROR_VICTORY_CODE);
            else {
                const playerWon = isHumanEmpire(galaxy, e); // one human: the player
                onGameEnd(galaxy, new GameEndEventArgs(e, playerWon ? GameEndOutcome.Victory : GameEndOutcome.Defeat, text, playerWon ? DIET_EMPEROR_VICTORY_CODE : DIET_EMPEROR_DEFEAT_CODE));
            }
        }
        return;
    }
    st.counters.emperorFails++;
    (st.emperorFailedAt ??= {})[e.empireId] = galaxyStarDate(galaxy);
    if (st.regent === e) st.regent = null;
    if (c !== null) for (const m of members(galaxy, c, st)) if (m !== e) applyReputation(galaxy, m, e, -20, { cause: 'dietUsurper', labelKey: 'Diet Reputation Usurper', source: 'interstellarDiet' });
    news(galaxy, e, scenarioText('Diet Emperor Failed News', e.name), null);
    for (const h of humanEmpires(galaxy)) scenarioMessage(galaxy, h, scenarioText('Diet Emperor Title'), scenarioText('Diet Emperor Failed', e.name), { type: h === e ? EmpireMessageType.GeneralBadEvent : EmpireMessageType.GeneralGoodEvent, log: { category: 'council' } });
}

function reviewEmperor(galaxy: Galaxy, st: DietState, c: Council | null): void {
    const em = st.emperor;
    if (em === null) return;
    const e = em.empire;
    const now = galaxyStarDate(galaxy);
    // The bid fails when the Emperor loses its capital, or the host world after having held it.
    if (!e.active || em.capital.empire !== e || (em.world.empire !== e && heldWorldOnce(em))) {
        emperorEnds(galaxy, st, c, false);
        return;
    }
    if (em.world.empire === e) (em as { heldWorld?: boolean }).heldWorld = true;
    if (now >= em.until) {
        emperorEnds(galaxy, st, c, em.capital.empire === e && em.world.empire === e);
        return;
    }
    // Everyone may go to war with the Emperor: the AI decides by attitude, aggression and the odds.
    const joined = ((em as { joined?: number[] }).joined ??= []);
    for (const x of galaxy.empires) {
        if (x === null || x === e || !x.active || x === galaxy.independentEmpire || x.pirateEmpireBaseHabitat !== null || x.dominantRace === null || isHumanEmpire(galaxy, x) || isEnforcerFaction(st, x)) continue;
        if (joined.includes(x.empireId) || atWar(x, e)) continue;
        const r = x.diplomaticRelations.byEmpire(e);
        if (r === null || r.type === DiplomaticRelationType.NotMet) continue;
        if (!joinsWarOnEmperor(galaxy, x, e)) continue;
        joined.push(x.empireId);
        declareWar(galaxy, x, e);
    }
}

/** The AI Regent answers a pressing event: not against itself, its bloc or an empire it likes more than the victim. */
function regentAnswers(galaxy: Galaxy, c: Council, st: DietState, regent: Empire, p: NonNullable<DietState['pendingEmergency']>): boolean {
    void st;
    const t = p.target;
    if (t === null || t === regent || !t.active) return false;
    if (blocOf(c, regent)?.members.includes(t)) return false;
    if (p.other !== null && p.other !== regent && attitudeOf(regent, t) > attitudeOf(regent, p.other) + 20) return false;
    void galaxy;
    return true;
}

function heldWorldOnce(em: NonNullable<DietState['emperor']>): boolean {
    return (em as { heldWorld?: boolean }).heldWorld === true;
}

// ---------------------------------------------------------------------------------------------------------------
// The periodic tick (every long block) and the yearly upkeep
// ---------------------------------------------------------------------------------------------------------------

let allowFactionWar = false;

export function dietTick(galaxy: Galaxy): void {
    if (!dietOn(galaxy)) return;
    const c = dietCouncil(galaxy);
    if (c === null) return;
    const st = dietState(galaxy);
    if (st.councilId !== c.id) st.councilId = c.id;
    const now = galaxyStarDate(galaxy);
    if (st.nextSessionAt < 0) {
        // The first session: called a few months after the founding (the members must seat delegates first).
        st.nextSessionAt = now + 120 * DAY;
    }
    if (st.host === null) updateSeat(galaxy, st, c);
    // Laws lapse; a fulfilled or stale claim ends.
    for (const l of [...st.laws]) {
        if (l.until >= 0 && now >= l.until) {
            st.laws.splice(st.laws.indexOf(l), 1);
            tell(galaxy, members(galaxy, c, st), 'Diet Law Lapsed Title', scenarioText('Diet Law Lapsed', l.text));
        } else if (l.kind === 'claim' && (l.colony === null || l.colony.empire === l.empire || l.empire === null || !l.empire.active)) st.laws.splice(st.laws.indexOf(l), 1);
        else if ((l.kind === 'outlawPirates' || l.kind === 'truce') && l.empire !== null && !l.empire.active) st.laws.splice(st.laws.indexOf(l), 1);
    }
    const s = st.session;
    if (s === null) {
        if (now >= st.nextSessionAt) {
            if (callSession(galaxy, st, c, false, null, null) === null) st.nextSessionAt = now + 180 * DAY;
        }
    } else {
        if (s.stage === 'gathering' && now >= s.opens) openFloor(galaxy, st, c, s);
        if (s.stage === 'voting' && now >= s.closes) closeSession(galaxy, st, c, s);
    }
    // The AI Regent: an emergency session for a pressing case, the Emperor's bid when it can hold.
    const regent = activeRegent(galaxy, st, c);
    if (regent !== null && !isHumanEmpire(galaxy, regent)) {
        const checked = (st as { emergencyChecked?: number }).emergencyChecked ?? -1;
        const cooled = st.lastEmergency < 0 || now - st.lastEmergency >= dietParam(galaxy, 'dietEmergencyYears') * YEAR_LENGTH;
        // A pressing event (a war started on a member, open defiance of the enforcers) is answered at once.
        const pend = st.pendingEmergency ?? null;
        if (pend !== null && now - pend.at > 1.5 * YEAR_LENGTH) st.pendingEmergency = null;
        // (The case waits, up to a year and a half, for the sitting session to close.)
        if (st.session === null && cooled && st.pendingEmergency != null) {
            const p = st.pendingEmergency;
            st.pendingEmergency = null;
            if (regentAnswers(galaxy, c, st, regent, p) && callEmergency(galaxy, regent, { kind: p.kind, proposer: regent, target: p.target, other: p.other, colony: null, resourceId: -1, weight: 100 })) {
                const why = ((st.counters as { emergencyCauses?: Record<string, number> }).emergencyCauses ??= {});
                why[p.why] = (why[p.why] ?? 0) + 1;
            }
        } else if (st.session === null && now - checked >= 90 * DAY && st.nextSessionAt - now > 300 * DAY && cooled) {
            (st as { emergencyChecked?: number }).emergencyChecked = now;
            const cand = emergencyCase(galaxy, c, st, regent, gameYear(now));
            if (cand !== null) callEmergency(galaxy, regent, cand);
        }
        // A Regent of at least a year's standing.
        const served = now - (st.regentUntil - dietParam(galaxy, 'dietRegentYears') * YEAR_LENGTH) >= YEAR_LENGTH;
        if (st.emperor === null && served) {
            const why = emperorBidBlock(galaxy, c, st, regent);
            const rec = ((st.counters as { bidBlocks?: Record<string, number> }).bidBlocks ??= {});
            rec[why === '' ? 'bid' : why] = (rec[why === '' ? 'bid' : why] ?? 0) + 1;
            if (why === '') declareEmperor(galaxy, regent);
        }
    }
    reviewEmperor(galaxy, st, c);
    reviewAbroad(galaxy, st);
    // AI members attack enemy delegates on the way (aggressive, careless of their reputation, at war with them).
    aiDelegateAttacks(galaxy, st);
    // Enforcers: losses, the sanction's end, stations; open defiance by an AI target.
    const sanctioned = (e: Empire): boolean => c.sanctions.some((x) => x.target === e && x.kind === 'sanction');
    reviewEnforcers(galaxy, st, c, sanctioned);
    for (const f of st.enforcers) {
        if (f.stage !== 'blockading') continue;
        if (aiDefiance(galaxy, st, f, (fn) => {
            allowFactionWar = true;
            try {
                fn();
            } finally {
                allowFactionWar = false;
            }
        })) {
            f.defied = true;
            defiance(galaxy, st, c, f.target);
        }
    }
}

/**
 * Delegates abroad: one who died (killed or captured on the way, attacked, assassinated at the host world) leaves a post
 * that takes 5-6 years to fill (no reserve posted, no local rise: governorsCv lockGovernorPost). Back home: done. Draws
 * (the lockout length).
 */
function reviewAbroad(galaxy: Galaxy, st: DietState): void {
    const list = st.abroad;
    if (list === undefined || list.length === 0) return;
    const now = galaxyStarDate(galaxy);
    for (const a of [...list]) {
        const c = a.character;
        if (c.active && c.location === a.post) {
            list.splice(list.indexOf(a), 1);
            continue;
        }
        if (c.active && c.empire === a.empire && (tripOfCharacter(galaxy, c) !== null || c.transferDestination !== null || st.session?.delegates.some((d) => d.character === c))) continue;
        list.splice(list.indexOf(a), 1);
        if (c.active || a.post.empire !== a.empire) continue; // moved on alive (a defection, a new post) or the post was lost
        // RND(diet): 5-6 years.
        const until = now + (5 * 360 + galaxy.rnd.next(0, 361)) * DAY;
        lockGovernorPost(galaxy, a.post, until);
        st.counters.lockouts = (st.counters.lockouts ?? 0) + 1;
        tell(galaxy, [a.empire], 'Diet Delegate Title', scenarioText('Diet Post Locked', c.name, a.post.name, resolveStarDateDescription(until)), { popup: true, bad: true, subject: a.post });
    }
}

/**
 * AI strikes on delegates (to or back from a session): an AI empire at war with the delegate's empire that is
 * aggressive and careless of its reputation, or desperate (losing that war: under 0.6 of the enemy's military),
 * sends its nearest warship within four sectors and fuel reach (leaving its fleet if need be) to attack the shuttle.
 * At most one order per attacker and victim empire every 120 days.
 */
function aiDelegateAttacks(galaxy: Galaxy, st: DietState): void {
    const list = st.abroad;
    if (list === undefined || list.length === 0) return;
    const now = galaxyStarDate(galaxy);
    const strikes = (st.strikes ??= {});
    for (const ab of list) {
        const ch = ab.character;
        if (!ch.active) continue;
        const t = tripOfCharacter(galaxy, ch);
        if (t === null || t.reason !== DIET_TRIP_REASON || t.waitUntil < 0) continue;
        const victim = ab.empire;
        for (const a of galaxy.empires) {
            if (a === null || a === victim || !a.active || a.pirateEmpireBaseHabitat !== null || a === galaxy.independentEmpire || a.dominantRace === null || isHumanEmpire(galaxy, a) || isEnforcerFaction(st, a)) continue;
            if (!atWar(a, victim)) continue;
            const key = `${a.empireId}:${victim.empireId}`;
            if (strikes[key] !== undefined && now - strikes[key] < 120 * DAY) continue;
            const desperate = militaryPotency(a) < 0.6 * Math.max(1, militaryPotency(victim));
            if (!desperate && !attacksDelegates(a)) continue;
            // A shuttle at warp cannot be fought: strike it where it is slow — still at its origin (waiting for its
            // escort, or close by), or by lying in wait at its destination, reached before it arrives.
            const dest = t.destination;
            const view = vipTripView(galaxy, ch);
            const eta = view !== null ? view.etaStarDate : now;
            let best: BuiltObject | null = null;
            let bd = galaxy.sectorSize * 4;
            let ambush = false;
            for (const b of a.builtObjects) {
                if (b === null || b.hasBeenDestroyed || b.role !== BuiltObjectRole.Military || b.firepowerRaw <= 0 || b.warpSpeed <= 0 || b.builtAt !== null || !b.isAutoControlled) continue;
                if (b.subRole === BuiltObjectSubRole.TroopTransport || b.subRole === BuiltObjectSubRole.ResupplyShip) continue;
                const near = galaxy.calculateDistance(b.xpos, b.ypos, t.shuttle.xpos, t.shuttle.ypos);
                if (near < bd && (t.waitUntil > now || near <= galaxy.sectorSize) && withinFuelRangeAndRefuel(galaxy, b, t.shuttle.xpos, t.shuttle.ypos, 0.1)) {
                    bd = near;
                    best = b;
                    ambush = false;
                    continue;
                }
                const toDest = galaxy.calculateDistance(b.xpos, b.ypos, dest.xpos, dest.ypos);
                const arrive = now + (toDest / Math.max(1, b.warpSpeed)) * 1000 + 15 * DAY;
                if (toDest < bd && arrive < eta && withinFuelRangeAndRefuel(galaxy, b, dest.xpos, dest.ypos, 0.1)) {
                    bd = toDest;
                    best = b;
                    ambush = true;
                }
            }
            if (best === null) continue;
            strikes[key] = now;
            // A fleet member leaves its fleet for the strike (as the VIP escorts do); the stock AI re-tasks it afterwards.
            if (best.shipGroup !== null) leaveShipGroup(galaxy, best);
            if (ambush) assignMission(galaxy, best, BuiltObjectMissionType.Move, dest, null, BuiltObjectMissionPriority.High);
            else assignMission(galaxy, best, BuiltObjectMissionType.Attack, t.shuttle, null, BuiltObjectMissionPriority.High);
            st.counters.delegateAttacks++;
        }
    }
}

export function dietYearly(galaxy: Galaxy): void {
    if (!dietOn(galaxy)) return;
    const st = peekDietState(galaxy);
    const c = dietCouncil(galaxy);
    if (st === null || c === null) return;
    enforcerUpkeep(galaxy, st, c);
    // Bounties on outlawed pirates: the members keep ten bounties in the fund.
    if (st.laws.some((l) => l.kind === 'outlawPirates')) {
        const want = 10 * dietParam(galaxy, 'dietBountyPerShip');
        if (st.fund < want) collectDues(galaxy, st, dietMembership(galaxy, c), null, want - st.fund);
    }
    if (lawInForce(st, 'freeTrade') !== null) applyFreeTrade(galaxy, c, st);
    // Grievances, spies, raids and bombardments fade.
    for (const k of Object.keys(st.grievances)) {
        st.grievances[Number(k)] = Math.trunc(st.grievances[Number(k)] * 0.6);
        if (st.grievances[Number(k)] <= 0) delete st.grievances[Number(k)];
    }
    for (const rec of [st.spies, st.raids ?? {}]) {
        for (const k of Object.keys(rec)) {
            rec[k] = Math.trunc(rec[k] * 0.5);
            if (rec[k] <= 0) delete rec[k];
        }
    }
    if (st.bombarded !== undefined) for (const k of Object.keys(st.bombarded)) if ((st.bombarded[Number(k)] = Math.trunc(st.bombarded[Number(k)] * 0.5)) <= 0) delete st.bombarded[Number(k)];
    if (st.regent !== null && galaxyStarDate(galaxy) >= st.regentUntil && st.emperor?.empire !== st.regent) st.regent = null;
}

// ---------------------------------------------------------------------------------------------------------------
// Player actions (journaled through player/playerOps.ts; each checks the Diet is on and the empire may act)
// ---------------------------------------------------------------------------------------------------------------

function dietFor(galaxy: Galaxy, e: Empire): { st: DietState; c: Council } | null {
    if (!dietOn(galaxy)) return null;
    const c = dietCouncil(galaxy);
    const st = peekDietState(galaxy);
    if (c === null || st === null || !members(galaxy, c, st).includes(e)) return null;
    return { st, c };
}

export function dietPlayerVote(galaxy: Galaxy, e: Empire, motionId: number, vote: string): boolean {
    const x = dietFor(galaxy, e);
    const s = x?.st.session ?? null;
    if (x === null || s === null) return false;
    const m = s.motions.find((y) => y.id === motionId);
    if (m === undefined || m.status !== 'voting') return false;
    const v: Vote = vote === 'yes' ? 'yes' : vote === 'no' ? 'no' : 'abstain';
    m.votes = m.votes.filter((y) => y.empire !== e);
    m.votes.push({ empire: e, vote: v, weight: 0, score: 0 });
    return true;
}

/** The Regent vetoes a motion of this session (applied at the tally; one per session; again to withdraw). */
export function dietPlayerVeto(galaxy: Galaxy, e: Empire, motionId: number): boolean {
    const x = dietFor(galaxy, e);
    const s = x?.st.session ?? null;
    if (x === null || s === null || activeRegent(galaxy, x.st, x.c) !== e || s.vetoUsed) return false;
    if (!s.motions.some((m) => m.id === motionId)) return false;
    x.st.vetoMotionId = x.st.vetoMotionId === motionId ? 0 : motionId;
    return true;
}

/** The player's delegate (a governor of theirs; null = the most important governor). During the gathering it is sent at once. */
export function dietSetDelegate(galaxy: Galaxy, e: Empire, character: Character | null): boolean {
    const x = dietFor(galaxy, e);
    if (x === null) return false;
    if (character !== null && (character.empire !== e || character.role !== CharacterRole.ColonyGovernor || !character.active)) return false;
    x.st.delegateChoice[e.empireId] = character;
    const s = x.st.session;
    if (s !== null && s.stage === 'gathering') {
        const d = s.delegates.find((y) => y.empire === e);
        if (d !== undefined && d.character !== character) {
            if (d.character !== null) endGovernorDuty(galaxy, d.character);
            const pick = chooseDelegate(galaxy, x.st, e);
            d.character = pick.character;
            d.lesser = pick.lesser;
            d.sent = false;
            d.lost = false;
            dispatch(galaxy, x.st, s, d);
        }
    }
    return true;
}

export interface DietProposal {
    kind: DietMotionKind;
    target: Empire | null;
    other: Empire | null;
    colony: Habitat | null;
    resourceId: number;
}

/** The player's motion: for the next session, or added to this one while delegates are still gathering. */
export function dietPropose(galaxy: Galaxy, e: Empire, p: DietProposal): boolean {
    const x = dietFor(galaxy, e);
    if (x === null) return false;
    const s = x.st.session;
    if (s !== null && s.stage === 'gathering') {
        if (s.motions.some((m) => m.proposer === e)) return false;
        s.motions.push(makeMotion(galaxy, x.st, { ...p, proposer: e }));
        return true;
    }
    x.st.proposals[e.empireId] = { kind: p.kind, target: p.target, other: p.other, colony: p.colony, resourceId: p.resourceId };
    return true;
}

export function dietPlayerEmergency(galaxy: Galaxy, e: Empire): boolean {
    const x = dietFor(galaxy, e);
    if (x === null) return false;
    const p = x.st.proposals[e.empireId];
    const first = p !== undefined ? ({ ...p, proposer: e, weight: 100 } as Cand) : null;
    if (p !== undefined) delete x.st.proposals[e.empireId];
    return callEmergency(galaxy, e, first);
}

export function dietPlayerDeclareEmperor(galaxy: Galaxy, e: Empire): boolean {
    return dietFor(galaxy, e) !== null && declareEmperor(galaxy, e);
}

// ---------------------------------------------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------------------------------------------

function delegateOf(st: DietState, ch: Character): DietDelegate | null {
    return st.session?.delegates.find((d) => d.character === ch) ?? null;
}

function sessionMember(galaxy: Galaxy): { st: DietState; c: Council } | null {
    if (!dietOn(galaxy)) return null;
    const st = peekDietState(galaxy);
    const c = dietCouncil(galaxy);
    return st === null || c === null ? null : { st, c };
}

function onTripArrived(galaxy: Galaxy, ev: { character: Character; reason: string }): void {
    if (ev.reason !== DIET_TRIP_REASON) return;
    const x = sessionMember(galaxy);
    if (x === null) return;
    const d = delegateOf(x.st, ev.character);
    if (d === null) return;
    x.st.counters.delegatesArrived++;
    tell(galaxy, [d.empire], 'Diet Delegate Title', scenarioText('Diet Delegate Arrived', ev.character.name, x.st.session!.world.name));
}

function onTripFailed(galaxy: Galaxy, ev: { character: Character; reason: string; cause: string }): void {
    if (ev.reason !== DIET_TRIP_REASON) return;
    const x = sessionMember(galaxy);
    if (x === null) return;
    reviewAbroad(galaxy, x.st);
    const d = delegateOf(x.st, ev.character);
    if (d === null) return;
    d.lost = true;
    x.st.counters.delegatesLost++;
    tell(galaxy, [d.empire], 'Diet Delegate Title', scenarioText('Diet Delegate Lost', ev.character.name), { popup: true, bad: true });
}

/** A delegate's shuttle (on the way to or from a session) attacked by `attacker`: a crime, once per shuttle. */
function delegateShuttleAttacked(galaxy: Galaxy, bo: BuiltObject, attacker: Empire | null): void {
    if (attacker === null) return;
    const t = tripOfShuttle(galaxy, bo);
    if (t === null || t.reason !== DIET_TRIP_REASON || attacker === t.empire) return;
    const x = sessionMember(galaxy);
    if (x === null || x.st.session === null) return;
    const seen = ((x.st.session as { crimes?: number[] }).crimes ??= []);
    if (seen.includes(bo.builtObjectID)) return;
    seen.push(bo.builtObjectID);
    crime(galaxy, x.st, x.c, attacker, scenarioText('Diet Crime Delegate', t.empire.name));
}

function onBuiltObjectAttacked(galaxy: Galaxy, ev: { builtObject: BuiltObject; attackingEmpire: Empire | null }): void {
    const x = sessionMember(galaxy);
    if (x === null) return;
    const bo = ev.builtObject;
    const a = ev.attackingEmpire;
    delegateShuttleAttacked(galaxy, bo, a);
    const f = enforcerFleetOf(x.st, bo);
    if (f !== null && a !== null && a !== x.st.faction && !f.defied) {
        f.defied = true;
        defiance(galaxy, x.st, x.c, a);
    }
    if (a !== null && a.pirateEmpireBaseHabitat !== null && bo.actualEmpire !== null && inDiet(galaxy, x.c, bo.actualEmpire)) {
        const raids = (x.st.raids ??= {});
        const k = `${a.empireId}:${bo.actualEmpire.empireId}`;
        raids[k] = Math.min(50, (raids[k] ?? 0) + 1);
    }
}

function onKilledBy(galaxy: Galaxy, ev: { builtObject: BuiltObject; destroyer: Empire | null }): void {
    const x = sessionMember(galaxy);
    if (x === null) return;
    delegateShuttleAttacked(galaxy, ev.builtObject, ev.destroyer);
    const killer = ev.destroyer;
    const owner = ev.builtObject.actualEmpire;
    // Bounties on an outlawed pirate faction's ships, from the Diet fund.
    if (killer !== null && owner !== null && inDiet(galaxy, x.c, killer) && lawInForce(x.st, 'outlawPirates', owner) !== null && ev.builtObject.role === BuiltObjectRole.Military) {
        const pay = Math.min(x.st.fund, dietParam(galaxy, 'dietBountyPerShip'));
        if (pay > 0) {
            x.st.fund -= pay;
            killer.stateMoney += pay;
            x.st.counters.bounties++;
            tell(galaxy, [killer], 'Diet Bounty Title', scenarioText('Diet Bounty', Math.round(pay), owner.name));
        }
    }
}

function onHabitatAttacked(galaxy: Galaxy, ev: { habitat: Habitat; attacker: unknown; attackingEmpire: Empire | null; bombarded: boolean }): void {
    const x = sessionMember(galaxy);
    if (x === null) return;
    const a = ev.attackingEmpire;
    if (a === null) return;
    const s = x.st.session;
    if (s !== null && ev.habitat === s.world && a !== s.host) {
        const seen = ((s as { hostCrimes?: number[] }).hostCrimes ??= []);
        if (!seen.includes(a.empireId)) {
            seen.push(a.empireId);
            crime(galaxy, x.st, x.c, a, scenarioText('Diet Crime Host', s.world.name));
        }
    }
    if (a.pirateEmpireBaseHabitat !== null && ev.habitat.empire !== null && inDiet(galaxy, x.c, ev.habitat.empire)) {
        const raids = (x.st.raids ??= {});
        const k = `${a.empireId}:${ev.habitat.empire.empireId}`;
        raids[k] = Math.min(50, (raids[k] ?? 0) + 2);
    }
    const ship = ev.attacker instanceof BuiltObject ? ev.attacker : null;
    const ban = lawInForce(x.st, 'banPlanetDestroyers');
    if (ban !== null && ship !== null && ship.isPlanetDestroyer && inDiet(galaxy, x.c, a)) {
        const seen = ((ban as { offenders?: number[] }).offenders ??= []);
        if (!seen.includes(a.empireId)) {
            seen.push(a.empireId);
            violation(galaxy, x.st, x.c, a, ban);
        }
    }
}

function onBombarded(galaxy: Galaxy, ev: { builtObject: BuiltObject; habitat: Habitat }): void {
    const x = sessionMember(galaxy);
    if (x === null) return;
    const a = ev.builtObject.actualEmpire;
    const victim = ev.habitat.empire;
    if (victim !== null && inDiet(galaxy, x.c, victim)) {
        const b = (x.st.bombarded ??= {});
        b[victim.empireId] = Math.min(20, (b[victim.empireId] ?? 0) + 1);
    }
    const ban = lawInForce(x.st, 'banBombard');
    if (ban !== null && a !== null && inDiet(galaxy, x.c, a)) {
        const yearKey = `${a.empireId}:${gameYear(galaxyStarDate(galaxy))}`;
        const seen = ((ban as { offenders?: string[] }).offenders ??= []);
        if (!seen.includes(yearKey)) {
            seen.push(yearKey);
            violation(galaxy, x.st, x.c, a, ban);
        }
    }
}

function onWarDeclared(galaxy: Galaxy, ev: { empire: Empire; target: Empire }): void {
    const x = sessionMember(galaxy);
    if (x === null) return;
    // A war started on a Diet member (not on the Emperor, not by the enforcers): an emergency case for the Regent.
    if (members(galaxy, x.c, x.st).includes(ev.target) && ev.empire !== x.st.faction && ev.target !== x.st.emperor?.empire && ev.empire.pirateEmpireBaseHabitat === null && ev.empire !== galaxy.independentEmpire) {
        const kind: DietMotionKind = inDiet(galaxy, x.c, ev.empire) ? 'condemn' : 'sanction';
        x.st.pendingEmergency ??= { kind, target: ev.empire, other: ev.target, at: galaxyStarDate(galaxy), why: 'war' };
    }
    for (const l of [...x.st.laws]) {
        if (l.kind !== 'truce') continue;
        const pair = (l.empire === ev.empire && l.other === ev.target) || (l.other === ev.empire && l.empire === ev.target);
        if (!pair) continue;
        x.st.laws.splice(x.st.laws.indexOf(l), 1);
        x.st.counters.truceBreaks++;
        automaticSanctions(galaxy, x.st, x.c, ev.empire, scenarioText('Diet Truce Broken', ev.target.name));
    }
}

function onIntel(galaxy: Galaxy, ev: { empire: Empire; mission: unknown; outcome: unknown }): void {
    const x = sessionMember(galaxy);
    if (x === null) return;
    const m = ev.mission as { targetEmpire: Empire | null } | null;
    const t = m?.targetEmpire ?? null;
    if (t === null || !inDiet(galaxy, x.c, t) || !inDiet(galaxy, x.c, ev.empire)) return;
    if (ev.outcome !== 1 && ev.outcome !== 2) return; // IntelligenceMissionOutcome.SucceedNotDetect / SucceedDetect
    const k = `${ev.empire.empireId}:${t.empireId}`;
    x.st.spies[k] = Math.min(10, (x.st.spies[k] ?? 0) + 1);
}

function onColonyOwnerChanged(galaxy: Galaxy, ev: { colony: Habitat; from: Empire | null; to: Empire | null }): void {
    const x = sessionMember(galaxy);
    if (x === null || ev.to === null || ev.from !== galaxy.independentEmpire) return;
    const law = lawInForce(x.st, 'protectIndependents');
    if (law !== null && inDiet(galaxy, x.c, ev.to)) violation(galaxy, x.st, x.c, ev.to, law);
}

// ---------------------------------------------------------------------------------------------------------------
// Queries (pure)
// ---------------------------------------------------------------------------------------------------------------

function wonderBonus(galaxy: Galaxy, v: number, a: { habitat: Habitat; wonderType: number }): number {
    const st = peekDietState(galaxy);
    if (!hostingNow(st, a.habitat) || !dietOn(galaxy)) return v;
    switch (a.wonderType) {
        case WonderType.ColonyIncome:
            return Math.max(v, dietParam(galaxy, 'dietHostIncomePct'));
        case WonderType.ColonyHappiness:
            return Math.max(v, dietParam(galaxy, 'dietHostHappinessPct'));
        case WonderType.ColonyPopulationGrowth:
            return Math.max(v, dietParam(galaxy, 'dietHostGrowthPct'));
        case WonderType.ColonyConstructionSpeed:
            return Math.max(v, dietParam(galaxy, 'dietHostConstructionPct'));
        default:
            return v;
    }
}

/** Visitor trade: the host world's tax revenue + dietVisitorTradePct per delegate present during a session. */
function visitorTrade(galaxy: Galaxy, v: number, a: { habitat: Habitat }): number {
    const st = peekDietState(galaxy);
    if (st === null || st.session === null || !hostingNow(st, a.habitat) || !dietOn(galaxy)) return v;
    const s = st.session;
    let n = 0;
    for (const d of s.delegates) if (d.empire !== s.host && present(s, d)) n++;
    return v * (1 + (n * dietParam(galaxy, 'dietVisitorTradePct')) / 100);
}

function factionShip(galaxy: Galaxy, bo: BuiltObject): boolean {
    const st = peekDietState(galaxy);
    return st !== null && st.faction !== null && bo.actualEmpire === st.faction;
}

function missionAllowed(galaxy: Galaxy, v: boolean, a: { builtObject: BuiltObject; missionType: number; target: unknown }): boolean {
    if (!v) return v;
    const st = peekDietState(galaxy);
    if (st === null || st.laws.length === 0 || !dietOn(galaxy)) return v;
    const e = a.builtObject.actualEmpire;
    if (e === null || isHumanEmpire(galaxy, e)) return v;
    const c = dietCouncil(galaxy);
    if (c === null || !inDiet(galaxy, c, e)) return v;
    const t = a.missionType;
    if ((t === BuiltObjectMissionType.Bombard || t === BuiltObjectMissionType.WaitAndBombard) && lawInForce(st, 'banBombard') !== null) return false;
    const target = a.target as { empire?: Empire | null } | null;
    const habitatTarget = target !== null && !(target instanceof BuiltObject) && target !== undefined && 'habitatIndex' in (target as object);
    if (t === BuiltObjectMissionType.Attack && habitatTarget && a.builtObject.isPlanetDestroyer && lawInForce(st, 'banPlanetDestroyers') !== null) return false;
    if (t === BuiltObjectMissionType.Attack && habitatTarget && (target as Habitat).empire === galaxy.independentEmpire && lawInForce(st, 'protectIndependents') !== null) return false;
    return v;
}

function warBlocked(galaxy: Galaxy, v: boolean, a: { empire: Empire; target: Empire }): boolean {
    const st = peekDietState(galaxy);
    if (st === null || !dietOn(galaxy)) return v;
    // The enforcers: no war with them except open defiance (the Diet's own call) or from the faction itself.
    if (st.faction !== null && (a.target === st.faction || a.empire === st.faction)) return allowFactionWar ? false : true;
    // Everyone may go to war with the Emperor during the countdown.
    if (st.emperor !== null && a.target === st.emperor.empire) return false;
    // An AI party to a Diet truce keeps it unless its aggression far outweighs its caution.
    if (!isHumanEmpire(galaxy, a.empire)) {
        for (const l of st.laws) {
            if (l.kind !== 'truce') continue;
            if (!((l.empire === a.empire && l.other === a.target) || (l.other === a.empire && l.empire === a.target))) continue;
            const r = a.empire.dominantRace;
            if (r !== null && r.aggression - r.caution < 30) return true;
        }
    }
    return v;
}

// ---------------------------------------------------------------------------------------------------------------
// Registration (module load; imported from scenario/packages.ts)
// ---------------------------------------------------------------------------------------------------------------

registerCouncilExtension({
    id: 'interstellarDiet',
    councilName: (g) => (dietOn(g) ? DIET_NAME : null),
    foundingText: (g, c, names) => (dietOn(g) ? scenarioText('Diet Founded', names) : (void c, null)),
    ownsSessions: (g) => dietOn(g),
    excluded: (g, e) => {
        const st = peekDietState(g);
        return st !== null && st.faction === e;
    },
});

registerScenarioPeriodic({ id: 'charactersVictory.diet', flag: CV_FLAG, periodDays: 10, order: 41, run: (g) => dietTick(g) });
registerScenarioYearly({ id: 'charactersVictory.dietYearly', flag: CV_FLAG, order: 41, run: (g) => dietYearly(g) });
registerScenarioEvent({ id: 'charactersVictory.dietArrived', flag: CV_FLAG, event: 'vipTripArrived', run: onTripArrived });
registerScenarioEvent({ id: 'charactersVictory.dietFailed', flag: CV_FLAG, event: 'vipTripFailed', run: onTripFailed });
registerScenarioEvent({ id: 'charactersVictory.dietAttacked', flag: CV_FLAG, event: 'builtObjectAttacked', run: onBuiltObjectAttacked });
registerScenarioEvent({ id: 'charactersVictory.dietKilled', flag: CV_FLAG, event: 'builtObjectKilledBy', run: onKilledBy });
registerScenarioEvent({ id: 'charactersVictory.dietHabitat', flag: CV_FLAG, event: 'habitatAttacked', run: onHabitatAttacked });
registerScenarioEvent({ id: 'charactersVictory.dietBombard', flag: CV_FLAG, event: 'habitatBombarded', run: onBombarded });
registerScenarioEvent({ id: 'charactersVictory.dietWar', flag: CV_FLAG, event: 'warDeclared', run: onWarDeclared });
registerScenarioEvent({ id: 'charactersVictory.dietIntel', flag: CV_FLAG, event: 'intelMissionCompleted', run: onIntel });
registerScenarioEvent({ id: 'charactersVictory.dietColony', flag: CV_FLAG, event: 'colonyOwnerChanged', run: onColonyOwnerChanged });
registerScenarioQuery({ id: 'charactersVictory.dietWonder', flag: CV_FLAG, query: 'colonyWonderBonus', run: wonderBonus });
registerScenarioQuery({
    id: 'charactersVictory.dietScenic',
    flag: CV_FLAG,
    query: 'colonyScenicFactor',
    run: (g, v, a) => (dietOn(g) && hostingNow(peekDietState(g), a.habitat) ? Math.max(v, dietParam(g, 'dietHostScenic')) : v),
});
registerScenarioQuery({ id: 'charactersVictory.dietVisitors', flag: CV_FLAG, order: 50, query: 'colonyTaxRevenue', run: visitorTrade });
registerScenarioQuery({
    id: 'charactersVictory.dietWelcome',
    flag: CV_FLAG,
    query: 'militaryShipWelcome',
    run: (g, v, a) => {
        if (v || !dietOn(g)) return v;
        const st = peekDietState(g);
        if (st === null || !st.laws.some((l) => l.kind === 'outlawPirates')) return v;
        const c = dietCouncil(g);
        return c !== null && inDiet(g, c, a.owner) && inDiet(g, c, a.empire);
    },
});
registerScenarioQuery({
    id: 'charactersVictory.dietClaim',
    flag: CV_FLAG,
    query: 'declareWarPenaltyWaived',
    run: (g, v, a) => v || (dietOn(g) && (peekDietState(g)?.laws.some((l) => l.kind === 'claim' && l.empire === a.self && l.colony !== null && l.colony.empire === a.target) ?? false)),
});
registerScenarioQuery({ id: 'charactersVictory.dietNoDocking', flag: CV_FLAG, query: 'blockadeEngagesDocking', run: (g, v, a) => (v && factionShip(g, a.builtObject) ? false : v) });
registerScenarioQuery({ id: 'charactersVictory.dietMissions', flag: CV_FLAG, query: 'assignMissionAllowed', run: missionAllowed });
registerScenarioQuery({ id: 'charactersVictory.dietWars', flag: CV_FLAG, order: 1000, query: 'declareWarBlocked', run: warBlocked });
registerScenarioQuery({ id: 'charactersVictory.dietFactionDormant', flag: CV_FLAG, query: 'stateAIDormant', run: (g, v, a) => v || isEnforcerFaction(peekDietState(g), a.empire) });

export { CV_FLAG, ensureFaction };
