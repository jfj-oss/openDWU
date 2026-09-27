// 19d3 — Espionage consequences: exposed agents open diplomatic crises, stolen tech proliferates, false-flag missions
// set rivals against each other (tasks/19d3-espionage-consequences.md). Not a port: a scenario package on the mod layer
// (tasks/MODLAYER-DESIGN.md), gated by the scenario flag `espionageConsequences`.
//
// It builds on the ported espionage (espionage.ts: PerformIntelligenceMissions Empire.5.cs 5597, the outcome switch
// 5890-5990 with its `num17 = min(30, Difficulty / 8)` incident; CompleteIntelligenceMission Empire.6.cs 117 StealTechData;
// AssignAgentForSabotageMission Empire.6.cs 464), the diplomacy AI (diplomacyTick.ts StartTradeSanctions Empire.8.cs 1586,
// DeclareWar, DetermineRelativeStrength Empire.7.cs 4975) and trade (tradeItems.ts GiveTradeableItem Galaxy.4.cs 3857,
// ValueResearchProjectForEmpire 4551). Exposures mirror Empire.1.cs 1590 RandomEventUncoverPirateAttackFunding (incident,
// civility, a threat message to the offender).
//
// Rnd (tasks/19d1-internal-politics.md §S5): galaxy.rnd is drawn only in the yearly handler (leak roll, leak discovery)
// and inside the flagged hooks of the ported code (frame roll in the AI sabotage assignment, frame detection at the
// mission outcome). Every draw is marked `// RND(19d3)`. Recording hooks never draw.
//
// State: scenarioState(galaxy, 'espionage') — plain objects holding Empire / IntelligenceMission graph references.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Character, IntelligenceMission } from '../../characters';
import { CharacterRole, getEmpireCharacters } from '../../characters';
import type { TechNode } from '../../researchSystem';
import {
    IntelligenceMissionOutcome,
    IntelligenceMissionType,
    characterMission,
    resolveIntelligenceMissionDescription,
} from '../../espionage';
import {
    DiplomaticRelationType,
    empireEvaluationByEmpire,
    empireEvaluationsOf,
    obtainDiplomaticRelation,
    obtainEmpireEvaluation,
} from '../../diplomacy';
import {
    aggressionLevel,
    cautionLevel,
    declareWar,
    getAmbassadorsForEmpire,
    militaryPotency,
    startTradeSanctions,
} from '../../diplomacyTick';
import { TradeableItem, TradeableItemType, giveTradeableItem, techTreeGetEquivalent, valueResearchProjectForEmpire } from '../../tradeItems';
import { EmpireMessageType } from '../../messages';
import { YEAR_LENGTH } from '../../galaxyTime';
import { galaxyStarDate } from '../../tick/simTime';
import { registerScenarioYearly, gameYear } from '../hooks';
import { scenarioFlag, scenarioParam, scenarioState } from '../state';
import { mirrorPackageDiscovery, registerHiddenThing } from '../security/registry';
import { scenarioMessage, scenarioNews, scenarioText } from '../messages';
import { expireScenarioDecisions, raiseScenarioDecision, registerScenarioDecision, type ScenarioDecision } from '../decisions';
import { ESPIONAGE_FLAG, espionageHooks, type FalseFlagResult } from './espionageHooks';
import { complyApology, complyRecall, complyReparations, playerDeclareWar, playerImposeSanctions, refuseCrisis, resolveCrisis } from './espionageActions';


// ---------------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------------

export type CrisisStage = 'demand' | 'sanctions' | 'war' | 'resolved';
export type CrisisDemand = 'apology' | 'reparations' | 'recall';

export interface SpyCrisis {
    id: number;
    offender: Empire;
    victim: Empire;
    severity: number;
    /** "agent NAME captured while …" (the heaviest exposure). */
    cause: string;
    agentName: string;
    /** Star date the crisis opened. */
    opened: number;
    /** Star date of the current stage's deadline (UI); the logic uses deadlineYear. */
    deadline: number;
    /** Game year at whose yearly review the current stage is judged. */
    deadlineYear: number;
    stage: CrisisStage;
    demand: CrisisDemand;
    amount: number;
    /** The offender's answer to the demand. */
    response: 'pending' | 'complied' | 'refused';
    /** Whose decision the crisis waits for (player decisions); null = none. */
    awaiting: 'victim' | 'offender' | null;
    /** Game year of the pair's last exposure while the crisis was open (-1 = none). */
    lastExposureYear: number;
    /** Consecutive years at sanctions without a new exposure. */
    quietYears: number;
    /** How it ended (resolved crises). */
    resolution: string;
    resolvedStarDate: number;
}

/** One detected agent (§A1), counted once into the next yearly review. */
export interface SpyExposure {
    offender: Empire;
    victim: Empire;
    /** The incident applied (num17, × the false-flag factor). */
    incident: number;
    /** incident × type weight × capture weight (§A2). */
    weight: number;
    missionType: number;
    outcome: number;
    agentName: string;
    cause: string;
    starDate: number;
    year: number;
    counted: boolean;
}

export interface StolenTech {
    projectId: number;
    thief: Empire;
    victim: Empire;
    year: number;
    holders: Empire[];
}

export interface PendingLeak {
    tech: StolenTech;
    holder: Empire;
    year: number;
}

/** A false flag (§C9): the mission's acts are attributed to `framed`. */
export interface MissionFrame {
    mission: IntelligenceMission;
    framed: Empire;
    originator: Empire;
    since: number;
}

export interface EspionageState {
    crises: SpyCrisis[];
    frames: MissionFrame[];
    stolen: StolenTech[];
    pendingLeaks: PendingLeak[];
    exposures: SpyExposure[];
    /** empireId → star date it was last framed by an AI (rule §4.4: once per 5 years). */
    lastFramed: Record<number, number>;
    nextId: number;
}

export function espionageState(galaxy: Galaxy): EspionageState {
    return scenarioState<EspionageState>(galaxy, 'espionage', () => ({ crises: [], frames: [], stolen: [], pendingLeaks: [], exposures: [], lastFramed: {}, nextId: 1 }));
}

/** The state without creating it (UI / accessors on a game that has not used it). */
function peekState(galaxy: Galaxy): EspionageState | null {
    const s = galaxy.scenario;
    if (s === null || !('espionage' in s.state)) return null;
    return s.state.espionage as EspionageState;
}

// ---------------------------------------------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------------------------------------------

function isNormalEmpire(galaxy: Galaxy, e: Empire | null): e is Empire {
    return e !== null && e !== galaxy.independentEmpire && e.pirateEmpireBaseHabitat === null && e.active;
}

/** `a` has met `b` (a diplomatic relation other than NotMet), without creating a relation. */
export function knowsEmpire(a: Empire, b: Empire): boolean {
    if (a === b) return true;
    const r = a.diplomaticRelations?.byEmpire(b) ?? null;
    return r !== null && r.type !== DiplomaticRelationType.NotMet;
}

function relationType(a: Empire, b: Empire): DiplomaticRelationType {
    const r = a.diplomaticRelations?.byEmpire(b) ?? null;
    return r === null ? DiplomaticRelationType.NotMet : r.type;
}

/** a's overall attitude to b from an existing evaluation (0 when a has none; never creates one). */
export function attitudeOf(a: Empire, b: Empire): number {
    const ev = empireEvaluationByEmpire(empireEvaluationsOf(a), b);
    return ev === null ? 0 : ev.overallAttitude;
}

/** incident change on a's evaluation of b (as the ported `incidentEvaluation = incidentEvaluationRaw - x`). */
function addIncident(galaxy: Galaxy, a: Empire, b: Empire, delta: number): void {
    if (a.pirateEmpireBaseHabitat !== null || b.pirateEmpireBaseHabitat !== null) return;
    const ev = obtainEmpireEvaluation(galaxy, a, b);
    ev.incidentEvaluation = ev.incidentEvaluationRaw + delta;
}

/** The best counter-espionage skill (counterEspionageFactored) among the empire's agents on CounterIntelligence; 0 = none. */
export function bestCounterIntelligence(e: Empire): number {
    let best = 0;
    for (const c of getEmpireCharacters(e)) {
        if (c === null || c.role !== CharacterRole.IntelligenceAgent) continue;
        const m = characterMission(c);
        if (m !== null && m.type === IntelligenceMissionType.CounterIntelligence) best = Math.max(best, c.counterEspionageFactored);
    }
    return best;
}

/** §A2 type weight: AssassinateCharacter, DestroyBase, InciteRevolution 2; SabotageColony 1.5; others 1. */
export function exposureTypeWeight(missionType: number): number {
    switch (missionType) {
        case IntelligenceMissionType.AssassinateCharacter:
        case IntelligenceMissionType.DestroyBase:
        case IntelligenceMissionType.InciteRevolution:
            return 2;
        case IntelligenceMissionType.SabotageColony:
            return 1.5;
        default:
            return 1;
    }
}

/** §A2 exposure weight: incident × type weight, × 1.5 for a captured agent (proof). */
export function exposureWeight(incident: number, missionType: number, outcome: number): number {
    return incident * exposureTypeWeight(missionType) * (outcome === IntelligenceMissionOutcome.Capture ? 1.5 : 1);
}

/** §A2 demand by severity: recall (< 25), apology (< 40), else reparations of min(money × 0.2, severity × 1000). */
export function chooseDemand(severity: number, offenderMoney: number): { demand: CrisisDemand; amount: number } {
    if (severity < 25) return { demand: 'recall', amount: 0 };
    if (severity < 40) return { demand: 'apology', amount: 0 };
    return { demand: 'reparations', amount: Math.max(0, Math.floor(Math.min(offenderMoney * 0.2, severity * 1000))) };
}

/** militaryPotency(a) / militaryPotency(b) (both ≥ 1 — militaryPotency floors at 0, guarded here). */
export function strengthRatio(a: Empire, b: Empire): number {
    return Math.max(1, militaryPotency(a)) / Math.max(1, militaryPotency(b));
}

/** Whether the offender can meet the demand now (reparations need the money). */
export function canAffordDemand(c: SpyCrisis): boolean {
    return c.demand !== 'reparations' || c.offender.stateMoney >= c.amount;
}

/**
 * §4.1 AI comply rule: an AI offender complies when its attitude to the victim is positive or the victim is ≥ 1.5×
 * stronger, and it can afford the demand; otherwise it refuses.
 */
export function aiOffenderComplies(c: SpyCrisis): boolean {
    if (!canAffordDemand(c)) return false;
    return attitudeOf(c.offender, c.victim) > 0 || strengthRatio(c.victim, c.offender) >= 1.5;
}

/**
 * §A4 / §4.2 war gate: the victim declares war only when its AI would accept war now — attitude to the offender below
 * caution − aggression − 20, not weaker (strength ratio ≥ 0.8), and no mutual defence pact with it.
 */
export function victimWouldGoToWar(victim: Empire, offender: Empire): boolean {
    if (relationType(victim, offender) === DiplomaticRelationType.MutualDefensePact) return false;
    if (attitudeOf(victim, offender) >= cautionLevel(victim) - aggressionLevel(victim) - 20) return false;
    return strengthRatio(victim, offender) >= 0.8;
}

/** §C11 chance that the target sees through a frame: clamp(0.05, 0.95, 0.2 + CI/150 − concealment/200 + capture 0.4). */
export function falseFlagSeenThroughChance(targetCounterIntelligence: number, agentConcealment: number, outcome: number): number {
    const p = 0.2 + targetCounterIntelligence / 150 - agentConcealment / 200 + (outcome === IntelligenceMissionOutcome.Capture ? 0.4 : 0);
    return Math.min(0.95, Math.max(0.05, p));
}

// ---------------------------------------------------------------------------------------------------------------
// Public accessors (pure)
// ---------------------------------------------------------------------------------------------------------------

/** Crises involving `e` (as offender or victim), open first, by id. */
export function empireSpyCrises(galaxy: Galaxy, e: Empire): SpyCrisis[] {
    const st = peekState(galaxy);
    if (st === null) return [];
    return st.crises.filter((c) => c.offender === e || c.victim === e);
}

/** The open (not resolved) crisis of the ordered pair, or null. */
export function openCrisis(galaxy: Galaxy, offender: Empire, victim: Empire): SpyCrisis | null {
    const st = peekState(galaxy);
    if (st === null) return null;
    return st.crises.find((c) => c.stage !== 'resolved' && c.offender === offender && c.victim === victim) ?? null;
}

/** Stolen techs `e` stole, lost or holds. */
export function stolenTechsOf(galaxy: Galaxy, e: Empire): StolenTech[] {
    const st = peekState(galaxy);
    if (st === null) return [];
    return st.stolen.filter((s) => s.thief === e || s.victim === e || s.holders.includes(e));
}

/** The empire a mission is framed on, or null. */
export function missionFrame(galaxy: Galaxy, m: IntelligenceMission): Empire | null {
    const st = peekState(galaxy);
    if (st === null) return null;
    return st.frames.find((f) => f.mission === m)?.framed ?? null;
}

/** Exposures of the pair (either direction) since `sinceStarDate`. */
export function pairExposures(galaxy: Galaxy, a: Empire, b: Empire, sinceStarDate: number): SpyExposure[] {
    const st = peekState(galaxy);
    if (st === null) return [];
    return st.exposures.filter((x) => x.starDate >= sinceStarDate && ((x.offender === a && x.victim === b) || (x.offender === b && x.victim === a)));
}

// ---------------------------------------------------------------------------------------------------------------
// §A1 exposures
// ---------------------------------------------------------------------------------------------------------------

function exposureVerb(outcome: number): string {
    return outcome === IntelligenceMissionOutcome.Capture ? scenarioText('Emergent Exposure Captured') : outcome === IntelligenceMissionOutcome.SucceedDetect ? scenarioText('Emergent Exposure Detected After') : scenarioText('Emergent Exposure Detected');
}

/** §A1 hook (performIntelligenceMissions, after applyIncident). Pirates are ignored. No Rnd. */
export function recordExposure(galaxy: Galaxy, offender: Empire, victim: Empire, mission: IntelligenceMission, agent: Character, incident: number, outcome: number): void {
    if (!isNormalEmpire(galaxy, offender) || !isNormalEmpire(galaxy, victim) || offender === victim) return;
    const st = espionageState(galaxy);
    const now = galaxyStarDate(galaxy);
    const desc = resolveIntelligenceMissionDescription(mission, victim);
    st.exposures.push({
        offender,
        victim,
        incident,
        weight: exposureWeight(incident, mission.type, outcome),
        missionType: mission.type,
        outcome,
        agentName: agent.name,
        cause: scenarioText('Emergent Exposure Cause', agent.name, exposureVerb(outcome), desc),
        starDate: now,
        year: gameYear(now),
        counted: false,
    });
    // 19m (flag-gated): the exposed agent is also a confirmed lead of the victim's internal security.
    const thing = registerHiddenThing(galaxy, { kind: 'foreignAgent', concealment: agent.espionageFactored, empire: victim, target: agent, package: '19d3.espionage' });
    if (thing !== null) mirrorPackageDiscovery(galaxy, { target: agent, kind: 'foreignAgent' }, victim, 3, 'exposure');
}

/** An exposure without an agent (§B8 discovered leak): counted like a detected mission of `weight`. */
function recordSyntheticExposure(galaxy: Galaxy, offender: Empire, victim: Empire, weight: number, cause: string): void {
    const st = espionageState(galaxy);
    const now = galaxyStarDate(galaxy);
    st.exposures.push({ offender, victim, incident: weight, weight, missionType: IntelligenceMissionType.StealTechData, outcome: IntelligenceMissionOutcome.SucceedDetect, agentName: '', cause, starDate: now, year: gameYear(now), counted: false });
}

// ---------------------------------------------------------------------------------------------------------------
// §B stolen-tech provenance
// ---------------------------------------------------------------------------------------------------------------

/** §B5 hook (completeIntelligenceMission StealTechData). No Rnd. */
export function recordStolenTech(galaxy: Galaxy, thief: Empire, victim: Empire | null, node: TechNode): void {
    if (!isNormalEmpire(galaxy, thief) || !isNormalEmpire(galaxy, victim)) return;
    const st = espionageState(galaxy);
    const projectId = node.def.projectId;
    if (st.stolen.some((s) => s.projectId === projectId && s.thief === thief && s.victim === victim)) return;
    st.stolen.push({ projectId, thief, victim, year: gameYear(galaxyStarDate(galaxy)), holders: [thief] });
}

/** §B6 hook (giveTradeableItem ResearchProject): a stolen project held by the giver reaches a new holder. No Rnd. */
export function recordTechTransfer(galaxy: Galaxy, giver: Empire, receiver: Empire, node: TechNode): void {
    const st = peekState(galaxy);
    if (st === null) return;
    const year = gameYear(galaxyStarDate(galaxy));
    for (const s of st.stolen) {
        if (s.projectId !== node.def.projectId || !s.holders.includes(giver) || s.holders.includes(receiver) || receiver === s.victim) continue;
        s.holders.push(receiver);
        st.pendingLeaks.push({ tech: s, holder: receiver, year });
    }
}

// ---------------------------------------------------------------------------------------------------------------
// §C false flags
// ---------------------------------------------------------------------------------------------------------------

function frameable(type: number): boolean {
    return [IntelligenceMissionType.SabotageColony, IntelligenceMissionType.SabotageConstruction, IntelligenceMissionType.DestroyBase, IntelligenceMissionType.AssassinateCharacter, IntelligenceMissionType.InciteRevolution].includes(type);
}

/** Whether `framed` may be blamed for `mission` (§C9). */
export function canFrame(galaxy: Galaxy, mission: IntelligenceMission, framed: Empire | null): boolean {
    const origin = mission.originatingEmpire;
    const target = mission.targetEmpire;
    if (!frameable(mission.type) || !isNormalEmpire(galaxy, target) || !isNormalEmpire(galaxy, origin) || !isNormalEmpire(galaxy, framed)) return false;
    if (framed === origin || framed === target) return false;
    return knowsEmpire(target, framed);
}

/** §C9: frame `mission` on `framed` (false when not eligible). No Rnd. */
export function setMissionFrame(galaxy: Galaxy, mission: IntelligenceMission, framed: Empire | null): boolean {
    const st = espionageState(galaxy);
    st.frames = st.frames.filter((f) => f.mission !== mission);
    if (framed === null) return true;
    if (!canFrame(galaxy, mission, framed)) return false;
    st.frames.push({ mission, framed, originator: mission.originatingEmpire!, since: galaxyStarDate(galaxy) });
    return true;
}

/** §C9: the mission ended (cancelled / outcome) — its frame goes. No Rnd. */
export function clearMissionFrame(galaxy: Galaxy, mission: IntelligenceMission): void {
    const st = peekState(galaxy);
    if (st !== null && st.frames.length > 0) st.frames = st.frames.filter((f) => f.mission !== mission);
}



/**
 * §C10 / §4.4 AI frame candidates (pure): normal empires known to both with target → F and self → F attitudes < 0,
 * no treaty stronger than None between self and F, not framed in the last 5 years; best (lowest target → F attitude,
 * ties lower empireId) first.
 */
export function frameCandidates(galaxy: Galaxy, self: Empire, target: Empire): Empire[] {
    const st = peekState(galaxy);
    const now = galaxyStarDate(galaxy);
    const out: { e: Empire; att: number }[] = [];
    for (const f of galaxy.empires) {
        if (!isNormalEmpire(galaxy, f) || f === self || f === target) continue;
        if (!knowsEmpire(self, f) || !knowsEmpire(target, f)) continue;
        const rt = relationType(self, f);
        if (rt !== DiplomaticRelationType.None && rt !== DiplomaticRelationType.TradeSanctions && rt !== DiplomaticRelationType.War) continue;
        const last = st?.lastFramed[f.empireId];
        if (last !== undefined && now - last < 5 * YEAR_LENGTH) continue;
        const tAtt = attitudeOf(target, f);
        if (!(tAtt < 0) || !(attitudeOf(self, f) < 0)) continue;
        out.push({ e: f, att: tAtt });
    }
    out.sort((a, b) => a.att - b.att || a.e.empireId - b.e.empireId);
    return out.map((x) => x.e);
}

/** §C10 hook (assignAgentForSabotageMission): the AI may frame the best candidate. Rnd only when one exists. */
export function maybeFrame(galaxy: Galaxy, self: Empire, target: Empire, mission: IntelligenceMission): void {
    if (self === galaxy.playerEmpire || !frameable(mission.type) || !isNormalEmpire(galaxy, self) || !isNormalEmpire(galaxy, target)) return;
    const candidates = frameCandidates(galaxy, self, target).filter((f) => canFrame(galaxy, mission, f));
    if (candidates.length === 0) return;
    const chance = scenarioParam(galaxy, 'falseFlagAiChance', 0.3);
    if (galaxy.rnd.nextDouble() < chance) { // RND(19d3): frame roll
        if (setMissionFrame(galaxy, mission, candidates[0])) espionageState(galaxy).lastFramed[candidates[0].empireId] = galaxyStarDate(galaxy);
    }
}

/**
 * §C11 hook (performIntelligenceMissions, before the target's evaluation is obtained): null without a frame (no draw).
 * With a frame the mission's frame is consumed; for a detected outcome the target may see through it
 * (RND(19d3): frame detection).
 */
export function falseFlagAttribution(
    galaxy: Galaxy,
    self: Empire,
    target: Empire,
    mission: IntelligenceMission,
    agent: Character,
    outcome: number,
    rnd: { nextDouble(): number } = galaxy.rnd,
): FalseFlagResult | null {
    const st = peekState(galaxy);
    if (st === null) return null;
    const frame = st.frames.find((f) => f.mission === mission);
    if (frame === undefined) return null;
    clearMissionFrame(galaxy, mission);
    if (outcome !== IntelligenceMissionOutcome.Capture && outcome !== IntelligenceMissionOutcome.FailDetect && outcome !== IntelligenceMissionOutcome.SucceedDetect) return null;
    const framed = frame.framed;
    if (!isNormalEmpire(galaxy, framed) || framed === target || framed === self) return null;
    const p = falseFlagSeenThroughChance(bestCounterIntelligence(target), agent.concealmentFactored, outcome);
    const desc = resolveIntelligenceMissionDescription(mission, target);
    if (rnd.nextDouble() < p) { // RND(19d3): frame detection
        addIncident(galaxy, framed, self, -20);
        scenarioNews(galaxy, target, scenarioText('Emergent False Flag Exposed', target.name, self.name, framed.name));
        return { blamed: self, factor: 1, repeats: 2, civility: true };
    }
    if (bestCounterIntelligence(framed) > 0) {
        scenarioMessage(galaxy, framed, scenarioText('Emergent Framed Rumour Title'), scenarioText('Emergent Framed Rumour', target.name, desc), { type: EmpireMessageType.GeneralWarning, subject: target });
    }
    return { blamed: framed, factor: 1.5, repeats: 1, civility: false };
}

// ---------------------------------------------------------------------------------------------------------------
// §A crises
// ---------------------------------------------------------------------------------------------------------------

export function demandText(c: SpyCrisis): string {
    switch (c.demand) {
        case 'recall':
            return scenarioText('Emergent Demand Recall');
        case 'apology':
            return scenarioText('Emergent Demand Apology');
        case 'reparations':
            return scenarioText('Emergent Demand Reparations', c.amount.toLocaleString('en-US'));
    }
}

function recallAmbassadors(galaxy: Galaxy, victim: Empire, offender: Empire): void {
    if (victim.capital === null) return;
    for (const ch of getAmbassadorsForEmpire(getEmpireCharacters(victim), offender)) ch.completeLocationTransfer(victim.capital, galaxy);
}

/** Tells the offender (threat from the victim) and the victim that the crisis stands (§A2 texts). */
function announceDemand(galaxy: Galaxy, c: SpyCrisis): void {
    scenarioMessage(galaxy, c.offender, scenarioText('Emergent Spy Crisis Title', c.victim.name), scenarioText('Emergent Spy Crisis Demand', c.victim.name, c.cause, demandText(c)), {
        type: EmpireMessageType.GeneralWarning,
        subject: c.victim,
        sender: c.victim,
    });
    scenarioMessage(galaxy, c.victim, scenarioText('Emergent Spy Crisis Title', c.offender.name), scenarioText('Emergent Spy Crisis Opened', c.offender.name, c.cause, demandText(c)), {
        type: EmpireMessageType.GeneralWarning,
        subject: c.offender,
    });
}

/** The offender's side of a new demand: the player gets a decision, an AI answers by §4.1 at once. */
function askOffender(galaxy: Galaxy, c: SpyCrisis): void {
    if (c.offender === galaxy.playerEmpire) {
        c.awaiting = 'offender';
        const comply = c.demand === 'recall' ? scenarioText('Emergent Option Recall') : c.demand === 'apology' ? scenarioText('Emergent Option Apologise') : scenarioText('Emergent Option Pay', c.amount.toLocaleString('en-US'));
        const options = [{ id: 'comply', label: comply }, { id: 'refuse', label: scenarioText('Emergent Option Refuse') }];
        // Pay N credits is offered only when affordable (the decision API has no disabled options); resolve re-checks.
        if (!canAffordDemand(c)) options.shift();
        raiseScenarioDecision(galaxy, c.offender, {
            kind: 'espionage.demand',
            title: scenarioText('Emergent Spy Crisis Title', c.victim.name),
            text: scenarioText('Emergent Spy Crisis Demand', c.victim.name, c.cause, demandText(c)),
            options,
            defaultOption: 'refuse',
            expiresDays: 330,
            context: { crisisId: c.id },
        });
        return;
    }
    if (aiOffenderComplies(c)) applyCompliance(galaxy, c);
    else refuseCrisis(galaxy, c);
}

/** Runs the compliance matching the demand; false (and refuses) when it cannot be met. */
function applyCompliance(galaxy: Galaxy, c: SpyCrisis): boolean {
    const r = c.demand === 'recall' ? complyRecall(galaxy, c.offender, c) : c.demand === 'apology' ? complyApology(galaxy, c.offender, c) : complyReparations(galaxy, c.offender, c);
    if (!r.ok) refuseCrisis(galaxy, c);
    return r.ok;
}

function newCrisis(galaxy: Galaxy, st: EspionageState, offender: Empire, victim: Empire, severity: number, top: SpyExposure, year: number): SpyCrisis {
    const now = galaxyStarDate(galaxy);
    const d = chooseDemand(severity, offender.stateMoney);
    const c: SpyCrisis = {
        id: st.nextId++,
        offender,
        victim,
        severity: Math.round(severity * 10) / 10,
        cause: top.cause,
        agentName: top.agentName,
        opened: now,
        deadline: now + YEAR_LENGTH,
        deadlineYear: year + 1,
        stage: 'demand',
        demand: d.demand,
        amount: d.amount,
        response: 'pending',
        awaiting: null,
        lastExposureYear: -1,
        quietYears: 0,
        resolution: '',
        resolvedStarDate: 0,
    };
    st.crises.push(c);
    return c;
}

/** §A2: open the crisis (demand set) — ambassadors recalled, texts, news, then the offender's answer. */
function startDemand(galaxy: Galaxy, c: SpyCrisis): void {
    recallAmbassadors(galaxy, c.victim, c.offender);
    announceDemand(galaxy, c);
    if (c.severity >= 40) scenarioNews(galaxy, c.victim, scenarioText('Emergent Spy Crisis News', c.victim.name, c.offender.name, c.cause));
    askOffender(galaxy, c);
}

/** §A2 over the uncounted exposures of the last year. */
function openCrises(galaxy: Galaxy, st: EspionageState, year: number): void {
    const now = galaxyStarDate(galaxy);
    const threshold = scenarioParam(galaxy, 'crisisSeverityThreshold', 12);
    const pairs = new Map<string, { offender: Empire; victim: Empire; severity: number; top: SpyExposure }>();
    for (const x of st.exposures) {
        if (x.counted) continue;
        x.counted = true;
        if (now - x.starDate > YEAR_LENGTH * 1.05) continue;
        const open = openCrisis(galaxy, x.offender, x.victim);
        if (open !== null) {
            // A new exposure while the crisis is open counts as refusing (§A3).
            open.lastExposureYear = year;
            if (open.response === 'pending' && open.awaiting === null) open.response = 'refused';
            continue;
        }
        const key = `${x.offender.empireId}:${x.victim.empireId}`;
        const p = pairs.get(key);
        if (p === undefined) pairs.set(key, { offender: x.offender, victim: x.victim, severity: x.weight, top: x });
        else {
            p.severity += x.weight;
            if (x.weight > p.top.weight) p.top = x;
        }
    }
    const list = [...pairs.values()].sort((a, b) => a.offender.empireId - b.offender.empireId || a.victim.empireId - b.victim.empireId);
    for (const p of list) {
        if (!p.offender.active || !p.victim.active) continue;
        if (relationType(p.victim, p.offender) === DiplomaticRelationType.War) continue;
        if (p.severity < threshold) continue;
        const c = newCrisis(galaxy, st, p.offender, p.victim, p.severity, p.top, year);
        if (c.victim === galaxy.playerEmpire) {
            // §5 player as victim: choose the demand (or sanctions now / ignore).
            c.awaiting = 'victim';
            raiseScenarioDecision(galaxy, c.victim, {
                kind: 'espionage.response',
                title: scenarioText('Emergent Spy Crisis Title', c.offender.name),
                text: scenarioText('Emergent Spy Crisis Victim Question', c.offender.name, c.cause),
                options: [
                    { id: 'recall', label: scenarioText('Emergent Option Demand Recall') },
                    { id: 'apology', label: scenarioText('Emergent Option Demand Apology') },
                    { id: 'reparations', label: scenarioText('Emergent Option Demand Reparations', chooseDemand(99, c.offender.stateMoney).amount.toLocaleString('en-US')) },
                    { id: 'sanctions', label: scenarioText('Emergent Option Sanctions Now') },
                    { id: 'ignore', label: scenarioText('Emergent Option Ignore') },
                ],
                defaultOption: c.demand,
                expiresDays: 60,
                context: { crisisId: c.id },
            });
        } else {
            startDemand(galaxy, c);
        }
    }
    // Keep 3 years of exposures (the diplomacy screen's "recent exposures").
    st.exposures = st.exposures.filter((x) => now - x.starDate <= 3 * YEAR_LENGTH);
}

/** §A4 sanctions by the victim (AI path, rule §4.2) + the extra incident. */
function escalateToSanctions(galaxy: Galaxy, c: SpyCrisis, year: number): void {
    c.stage = 'sanctions';
    c.deadlineYear = year + 1;
    c.deadline = galaxyStarDate(galaxy) + YEAR_LENGTH;
    c.quietYears = 0;
    addIncident(galaxy, c.victim, c.offender, -c.severity / 2);
    const rt = relationType(c.victim, c.offender);
    if (c.victim !== galaxy.playerEmpire && rt !== DiplomaticRelationType.TradeSanctions && rt !== DiplomaticRelationType.War) startTradeSanctions(galaxy, c.victim, c.offender);
    const text = scenarioText('Emergent Spy Crisis Sanctions', c.victim.name, c.offender.name);
    scenarioMessage(galaxy, c.offender, scenarioText('Emergent Spy Crisis Title', c.victim.name), text, { type: EmpireMessageType.GeneralBadEvent, subject: c.victim, sender: c.victim });
    scenarioMessage(galaxy, c.victim, scenarioText('Emergent Spy Crisis Title', c.offender.name), text, { type: EmpireMessageType.GeneralBadEvent, subject: c.offender });
}

export function escalateToWar(galaxy: Galaxy, c: SpyCrisis): void {
    c.stage = 'war';
    if (relationType(c.victim, c.offender) !== DiplomaticRelationType.War) declareWar(galaxy, c.victim, c.offender);
    scenarioNews(galaxy, c.victim, scenarioText('Emergent Spy Crisis War', c.victim.name, c.offender.name));
}

/** Player victim at a refused deadline: sanctions / war / let it go (§5). */
function askVictimEscalation(galaxy: Galaxy, c: SpyCrisis): void {
    c.awaiting = 'victim';
    raiseScenarioDecision(galaxy, c.victim, {
        kind: 'espionage.escalate',
        title: scenarioText('Emergent Spy Crisis Title', c.offender.name),
        text: scenarioText('Emergent Spy Crisis Refused', c.offender.name, demandText(c)),
        options: [
            { id: 'sanctions', label: scenarioText('Emergent Option Sanctions') },
            { id: 'war', label: scenarioText('Emergent Option War') },
            { id: 'letgo', label: scenarioText('Emergent Option Let Go') },
        ],
        defaultOption: 'letgo',
        expiresDays: 60,
        context: { crisisId: c.id },
    });
}

/** §A4 escalation / decay of the open crises (by id). No Rnd. */
function escalateCrises(galaxy: Galaxy, st: EspionageState, year: number): void {
    for (const c of st.crises) {
        if (c.stage === 'resolved' || c.awaiting !== null) continue;
        if (!c.offender.active || !c.victim.active) {
            resolveCrisis(galaxy, c, scenarioText('Emergent Resolution Gone'), false);
            continue;
        }
        const atWar = relationType(c.victim, c.offender) === DiplomaticRelationType.War;
        if (c.stage === 'war') {
            if (!atWar) resolveCrisis(galaxy, c, scenarioText('Emergent Resolution Peace'), false);
            continue;
        }
        if (atWar) {
            c.stage = 'war';
            continue;
        }
        if (year < c.deadlineYear) continue;
        if (c.stage === 'demand') {
            if (c.victim === galaxy.playerEmpire) askVictimEscalation(galaxy, c);
            else escalateToSanctions(galaxy, c, year);
            continue;
        }
        // Sanctions: an AI offender may still give in; else the victim's AI weighs war, or the crisis fades.
        if (c.offender !== galaxy.playerEmpire && aiOffenderComplies(c) && applyCompliance(galaxy, c)) continue;
        c.quietYears = c.lastExposureYear === year ? 0 : c.quietYears + 1;
        c.deadlineYear = year + 1;
        c.deadline = galaxyStarDate(galaxy) + YEAR_LENGTH;
        if (c.victim !== galaxy.playerEmpire && victimWouldGoToWar(c.victim, c.offender)) {
            escalateToWar(galaxy, c);
            continue;
        }
        if (c.quietYears >= 3) resolveCrisis(galaxy, c, scenarioText('Emergent Resolution Faded'), true);
    }
    // Keep the last 50 resolved crises (history for the diplomacy screen).
    const resolved = st.crises.filter((c) => c.stage === 'resolved');
    if (resolved.length > 50) {
        const drop = new Set(resolved.slice(0, resolved.length - 50));
        st.crises = st.crises.filter((c) => !drop.has(c));
    }
}

// ---------------------------------------------------------------------------------------------------------------
// §B7 / §B8 black market and discovery
// ---------------------------------------------------------------------------------------------------------------

/** §B7 buyer (pure): known normal empire lacking the project, not at war with the thief, not the victim nor its allies. */
export function leakBuyer(galaxy: Galaxy, s: StolenTech): { buyer: Empire; value: number } | null {
    const thiefNode = s.thief.research.techTree[s.projectId];
    if (thiefNode === undefined || !thiefNode.isResearched) return null;
    let best: { buyer: Empire; value: number } | null = null;
    // TODO(19d3): pirate buyers — research projects are not offered to pirate factions by the ported trade AI
    // (resolveTradeableItemsResearchProjects is only called for normal empires), so pirates are skipped.
    for (const e of galaxy.empires) {
        if (!isNormalEmpire(galaxy, e) || e === s.thief || e === s.victim || s.holders.includes(e)) continue;
        if (!knowsEmpire(s.thief, e)) continue;
        if (relationType(s.thief, e) === DiplomaticRelationType.War) continue;
        if (relationType(s.victim, e) === DiplomaticRelationType.MutualDefensePact) continue; // §4.3
        const own = techTreeGetEquivalent(e.research.techTree, thiefNode);
        if (own === null || own.isResearched) continue;
        const value = valueResearchProjectForEmpire(galaxy, thiefNode, e);
        if (value <= 0 || e.stateMoney < value * 0.5) continue;
        if (best === null || value > best.value || (value === best.value && e.empireId < best.buyer.empireId)) best = { buyer: e, value };
    }
    return best;
}

function blackMarket(galaxy: Galaxy, st: EspionageState, year: number): void {
    const chance = scenarioParam(galaxy, 'techLeakChance', 0.25);
    for (const s of [...st.stolen]) {
        if (year - s.year >= 10 || s.thief === galaxy.playerEmpire || !s.thief.active) continue;
        const thiefNode = s.thief.research.techTree[s.projectId];
        if (thiefNode === undefined || !thiefNode.isResearched) continue;
        if (!(galaxy.rnd.nextDouble() < chance)) continue; // RND(19d3): leak roll
        const b = leakBuyer(galaxy, s);
        if (b === null) continue;
        const payment = Math.floor(b.value * 0.5);
        const items = [new TradeableItem(TradeableItemType.ResearchProject, thiefNode, b.value), new TradeableItem(TradeableItemType.Money, payment, payment)];
        giveTradeableItem(galaxy, s.thief, b.buyer, items[0], items);
        giveTradeableItem(galaxy, b.buyer, s.thief, items[1], items);
        // The hook in giveTradeableItem recorded the holder; make sure (flag gate is on here).
        if (!s.holders.includes(b.buyer)) recordTechTransfer(galaxy, s.thief, b.buyer, thiefNode);
    }
}

function discoverLeaks(galaxy: Galaxy, st: EspionageState): void {
    const leaks = st.pendingLeaks;
    st.pendingLeaks = [];
    for (const l of leaks) {
        const victim = l.tech.victim;
        const thief = l.tech.thief;
        if (!victim.active) continue;
        const p = 0.3 + bestCounterIntelligence(victim) / 200;
        if (!(galaxy.rnd.nextDouble() < p)) continue; // RND(19d3): leak discovery
        const node = victim.research.techTree[l.tech.projectId];
        const techName = node?.def.name ?? String(l.tech.projectId);
        if (l.holder !== thief) addIncident(galaxy, victim, l.holder, -10);
        addIncident(galaxy, victim, thief, -15);
        const text = scenarioText('Emergent Stolen Tech Spread', techName, thief.name, l.holder.name);
        const title = scenarioText('Emergent Stolen Tech Spread Title');
        scenarioMessage(galaxy, victim, title, text, { type: EmpireMessageType.GeneralBadEvent, subject: thief });
        const player = galaxy.playerEmpire;
        if (player !== null && player !== victim && (player === thief || player === l.holder)) scenarioMessage(galaxy, player, title, text, { type: EmpireMessageType.GeneralWarning, subject: victim });
        if (isNormalEmpire(galaxy, thief) && thief !== victim) recordSyntheticExposure(galaxy, thief, victim, 10, text);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// §13 yearly review
// ---------------------------------------------------------------------------------------------------------------

function pruneFrames(st: EspionageState): void {
    st.frames = st.frames.filter((f) => {
        const a = f.mission.agent;
        return a !== null && a.active && characterMission(a) === f.mission;
    });
}

/** §13 reviewEspionage: decisions expiry, frames, crises (open, escalate), black market, leak discovery. */
export function reviewEspionage(galaxy: Galaxy, year: number): void {
    expireScenarioDecisions(galaxy);
    const st = espionageState(galaxy);
    pruneFrames(st);
    openCrises(galaxy, st, year);
    escalateCrises(galaxy, st, year);
    blackMarket(galaxy, st, year);
    discoverLeaks(galaxy, st);
}

// ---------------------------------------------------------------------------------------------------------------
// Decisions (§5). Player answers arrive through answerScenarioDecision (scenario/decisions.ts), called directly by the
// message popup — NOT through the player command queue (player/playerOps.ts); that gap is owned by another package.
// ---------------------------------------------------------------------------------------------------------------

function crisisOf(galaxy: Galaxy, d: ScenarioDecision): SpyCrisis | null {
    const id = d.context.crisisId;
    return peekState(galaxy)?.crises.find((c) => c.id === id) ?? null;
}

function resolveDemandDecision(galaxy: Galaxy, d: ScenarioDecision, optionId: string): void {
    const c = crisisOf(galaxy, d);
    if (c === null || c.stage === 'resolved' || c.awaiting !== 'offender') return;
    c.awaiting = null;
    if (optionId === 'comply') applyCompliance(galaxy, c);
    else refuseCrisis(galaxy, c);
}

function resolveResponseDecision(galaxy: Galaxy, d: ScenarioDecision, optionId: string): void {
    const c = crisisOf(galaxy, d);
    if (c === null || c.stage === 'resolved' || c.awaiting !== 'victim') return;
    c.awaiting = null;
    const year = gameYear(galaxyStarDate(galaxy));
    switch (optionId) {
        case 'ignore':
            resolveCrisis(galaxy, c, scenarioText('Emergent Resolution Ignored'), false);
            return;
        case 'sanctions':
            c.stage = 'sanctions';
            c.deadlineYear = year + 1;
            c.deadline = galaxyStarDate(galaxy) + YEAR_LENGTH;
            c.response = 'refused';
            recallAmbassadors(galaxy, c.victim, c.offender);
            playerImposeSanctions(galaxy, c.victim, c.offender);
            return;
        case 'recall':
        case 'apology':
        case 'reparations': {
            c.demand = optionId;
            c.amount = optionId === 'reparations' ? chooseDemand(99, c.offender.stateMoney).amount : 0;
            startDemand(galaxy, c);
            return;
        }
    }
}

function resolveEscalateDecision(galaxy: Galaxy, d: ScenarioDecision, optionId: string): void {
    const c = crisisOf(galaxy, d);
    if (c === null || c.stage === 'resolved' || c.awaiting !== 'victim') return;
    c.awaiting = null;
    const year = gameYear(galaxyStarDate(galaxy));
    if (optionId === 'letgo') {
        resolveCrisis(galaxy, c, scenarioText('Emergent Resolution Let Go'), false);
    } else if (optionId === 'war') {
        c.stage = 'war';
        playerDeclareWar(galaxy, c.victim, c.offender);
    } else {
        c.stage = 'sanctions';
        c.deadlineYear = year + 1;
        c.deadline = galaxyStarDate(galaxy) + YEAR_LENGTH;
        c.quietYears = 0;
        addIncident(galaxy, c.victim, c.offender, -c.severity / 2);
        playerImposeSanctions(galaxy, c.victim, c.offender);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Registration (module load; imported from scenario/packages.ts)
// ---------------------------------------------------------------------------------------------------------------

registerScenarioYearly({ id: 'emergent.espionage', flag: ESPIONAGE_FLAG, order: 30, run: reviewEspionage });
registerScenarioDecision({ id: 'emergent.espionage.demand', kind: 'espionage.demand', flag: ESPIONAGE_FLAG, resolve: resolveDemandDecision, aiChoose: () => 'refuse' });
registerScenarioDecision({ id: 'emergent.espionage.response', kind: 'espionage.response', flag: ESPIONAGE_FLAG, resolve: resolveResponseDecision });
registerScenarioDecision({ id: 'emergent.espionage.escalate', kind: 'espionage.escalate', flag: ESPIONAGE_FLAG, resolve: resolveEscalateDecision });

espionageHooks.exposure = recordExposure;
espionageHooks.attribution = (galaxy, self, target, mission, agent, outcome) => falseFlagAttribution(galaxy, self, target, mission, agent, outcome);
espionageHooks.stolenTech = recordStolenTech;
espionageHooks.techTransfer = recordTechTransfer;
espionageHooks.sabotageAssigned = maybeFrame;
espionageHooks.missionEnded = clearMissionFrame;

/** True when the package is active in this game (UI gating). */
export function espionageConsequencesOn(galaxy: Galaxy | null): boolean {
    return galaxy !== null && scenarioFlag(galaxy, ESPIONAGE_FLAG);
}
