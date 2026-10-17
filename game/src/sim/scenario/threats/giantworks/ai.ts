// Giantworks: Smarter AI decisions about a Great Work (flag smarterAI; AI empires only, never the player). Not a port.
// Every `giantworksAiDecideDays` an AI empire that suspects a work reviews it and picks ONE plan, from what it knows:
//   - its shortlist's expected menace and value (common lore about the candidates, never the secret answer: KIND_MENACE / KIND_VALUE),
//   - its personality (aggression, caution, friendliness) and its reach (a colony within range of the site),
//   - whether destroying would be a war crime (War crimes on, no Diet authorisation): a cautious empire then only destroys
//     what it is nearly sure is a menace.
//   destroy  - a strike fleet is sent to attack the scaffold (stock mission Attack: no war needed), strong enough for its guards;
//   sabotage - a free attack agent gets a DestroyBase / SabotageConstruction mission on the scaffold (stock difficulty rules), at
//              most one a year per empire;
//   protect  - one idle fleet patrols the site (earning the Compact's regard);
//   none     - waits.
// A finished wonder that turned hostile is attacked by whoever can (menace is certain; no crime). Rnd: the stock mission assignment only.

import type { Galaxy } from '../../../galaxy';
import type { Empire } from '../../../empire';
import type { BuiltObject } from '../../../builtObject';
import { CharacterRole, getEmpireCharacters, type Character, type IntelligenceMission } from '../../../characters';
import { calculateOverallStrengthFactor } from '../../../combat/threats';
import { aggressionLevel, cautionLevel, friendlinessLevel, FleetPosture } from '../../../diplomacyTick';
import { IntelligenceMissionType, calculateIntelligenceMissionSkill, cascadeTimeLength, characterMission, checkWhetherTargetOfIntelligenceMission, intelligenceMissionDifficulty, newIntelligenceMissionAgainstBuiltObject } from '../../../espionage';
import { csInt } from '../../../builtObjectComponent';
import { findNearestAvailableFleet } from '../../../fleets/militaryAI';
import { empireShipGroups } from '../../../fleets/shipGroup';
import { determineDestroyOrCaptureTargetForFleet, shipGroupAssignMission, shipGroupCheckFleetTargetWithinFuelRangeAndRefuel } from '../../../fleets/shipGroupTasks';
import { BuiltObjectMissionPriority, BuiltObjectMissionType } from '../../../missions/mission';
import { isAiControlled } from '../../../missions/playerOrder';
import { YEAR_LENGTH } from '../../../galaxyTime';
import { isHumanEmpire } from '../../../humanEmpires';
import { galaxyStarDate } from '../../../tick/simTime';
import { GAME_DAY_LENGTH } from '../../hooks';
import { scenarioFlag } from '../../state';
import { WAR_CRIMES_FLAG } from '../../charactersVictory/diet/warCrimes';
import { SMARTER_AI_FLAG, isSmarterAIStrategist } from '../../smarterAI/common';
import { formStrikeFleet } from '../../smarterAI/pirates';
import { KNOWLEDGE_SUSPECTED } from '../framework';
import { demolitionAuthorised } from './actions';
import { expectedMenace, expectedValue, workLevel } from './knowledge';
import { greatWorkKind } from './registry';
import { compactFaction, greatWorks, gwParam, logGw, ordinaryEmpires, type GreatWorkRecord } from './state';

export type AiAction = 'destroy' | 'sabotage' | 'protect' | 'none';

/** Spies reach a site within this many sectors of one of its colonies; fleets only within giantworksAiReachSectors (their fuel range). */
const SPY_REACH_SECTORS = 14;

export function personality(e: Empire): { aggression: number; caution: number; friendly: number } {
    return { aggression: (aggressionLevel(e) - 100) / 50, caution: (cautionLevel(e) - 100) / 50, friendly: (friendlinessLevel(e) - 100) / 50 };
}

function nearestColonyDistance(galaxy: Galaxy, e: Empire, x: number, y: number): number {
    let best = Number.MAX_VALUE;
    for (const h of e.colonies) if (h !== null && h.empire === e) best = Math.min(best, galaxy.calculateDistance(h.xpos, h.ypos, x, y));
    return best;
}

/**
 * What an AI strike goes for and what defends it: the wonder's own base and the Compact's guards, unless the wonder has a garrison
 * of its own that holds the site while it is hostile (kind.aiStrike: the casino's smugglers, whose bases are struck instead of the resort). Pure.
 */
export function strikeTarget(galaxy: Galaxy, work: GreatWorkRecord): { target: BuiltObject; defenders: BuiltObject[]; marginPct?: number } | null {
    if (work.phase === 'complete' && work.hostile) {
        const own = greatWorkKind(work.wonder)?.aiStrike?.(galaxy, work) ?? null;
        if (own !== null) return own;
    }
    const base = work.base;
    if (base === null || base.hasBeenDestroyed) return null;
    return { target: base, defenders: work.guards.filter((g) => !g.hasBeenDestroyed) };
}

/** What the empire would do about the work now (pure; no orders). */
export function aiChoice(galaxy: Galaxy, work: GreatWorkRecord, e: Empire): AiAction {
    const strike = strikeTarget(galaxy, work);
    if (strike === null) return 'none';
    const base = strike.target;
    const away = nearestColonyDistance(galaxy, e, base.xpos, base.ypos) / galaxy.sectorSize;
    if (away > SPY_REACH_SECTORS) return 'none';
    const fleetsReach = away <= gwParam(galaxy, 'giantworksAiReachSectors');
    const pr = personality(e);
    const hostile = work.phase === 'complete' && work.hostile;
    const menace = hostile ? 1 : expectedMenace(galaxy, work, e);
    const value = hostile ? 0 : expectedValue(galaxy, work, e);
    const destroyAt = gwParam(galaxy, 'giantworksAiDestroyMenacePct') / 100;
    const sabotageAt = gwParam(galaxy, 'giantworksAiSabotageMenacePct') / 100;
    const protectAt = gwParam(galaxy, 'giantworksAiProtectValuePct') / 100;
    const crime = !hostile && scenarioFlag(galaxy, WAR_CRIMES_FLAG) && !demolitionAuthorised(galaxy);
    const needMenace = destroyAt + (crime ? 0.1 + 0.15 * Math.max(0, pr.caution) : 0) - 0.08 * pr.aggression;
    if (fleetsReach && menace >= needMenace && (hostile || pr.aggression > -0.3 || menace >= 0.8)) return 'destroy';
    if (work.phase === 'building' && menace >= sabotageAt - 0.05 * pr.aggression) return 'sabotage';
    if (fleetsReach && work.phase === 'building' && value >= protectAt && menace < sabotageAt && pr.friendly > -0.4) return 'protect';
    return 'none';
}

function strengthNeeded(galaxy: Galaxy, strike: { target: BuiltObject; defenders: BuiltObject[]; marginPct?: number }): number {
    let s = calculateOverallStrengthFactor(strike.target);
    for (const g of strike.defenders) if (!g.hasBeenDestroyed) s += calculateOverallStrengthFactor(g);
    return Math.trunc((s * (strike.marginPct ?? gwParam(galaxy, 'giantworksAiStrikeMarginPct'))) / 100);
}

export function sendStrike(galaxy: Galaxy, work: GreatWorkRecord, e: Empire, marginPct?: number): boolean {
    const strike = strikeTarget(galaxy, work);
    if (strike === null) return false;
    const base = strike.target;
    const need = strengthNeeded(galaxy, marginPct === undefined ? strike : { ...strike, marginPct });
    let fleet = findNearestAvailableFleet(galaxy, e, base.xpos, base.ypos, BuiltObjectMissionPriority.Low, need, FleetPosture.Attack, true, 0.1, false, false, false, true);
    if (fleet === null) fleet = formStrikeFleet(galaxy, e, base.xpos, base.ypos, need);
    if (fleet === null || fleet.leadShip === null || !isAiControlled(fleet.leadShip)) return false;
    if (!shipGroupCheckFleetTargetWithinFuelRangeAndRefuel(galaxy, fleet, base.xpos, base.ypos, 0.1)) return false;
    return shipGroupAssignMission(galaxy, fleet, determineDestroyOrCaptureTargetForFleet(galaxy, e, fleet, base), base, null, BuiltObjectMissionPriority.High, true);
}

function freeAgents(e: Empire): Character[] {
    return getEmpireCharacters(e).filter((c) => {
        if (c === null || !c.active || c.role !== CharacterRole.IntelligenceAgent) return false;
        const m = characterMission(c);
        return m === null || m.type === IntelligenceMissionType.Undefined || m.type === IntelligenceMissionType.CounterIntelligence;
    });
}

function sendSpy(galaxy: Galaxy, work: GreatWorkRecord, e: Empire, menace: number): boolean {
    const compact = compactFaction(galaxy);
    const base = work.base!;
    const p = e.policy;
    if (compact === null || p == null) return false;
    const type = menace >= 0.6 && p.intelligenceAllowMissionDestroyBase ? IntelligenceMissionType.DestroyBase : p.intelligenceAllowMissionSabotageConstruction ? IntelligenceMissionType.SabotageConstruction : null;
    if (type === null || checkWhetherTargetOfIntelligenceMission(e, compact, base, type)) return false;
    const now = galaxyStarDate(galaxy);
    let best: { agent: Character; mission: IntelligenceMission; margin: number } | null = null;
    // An empire with a single agent keeps it on counter-intelligence; with more, the free ones go.
    const free = freeAgents(e);
    if (free.length < 1 || getEmpireCharacters(e).filter((c) => c.active && c.role === CharacterRole.IntelligenceAgent).length < 2) return false;
    for (const a of free) {
        const d = calculateIntelligenceMissionSkill(e, a, type, compact);
        const m = newIntelligenceMissionAgainstBuiltObject(e, null, type, now, base);
        const margin = csInt(d.oneYearDifficulty) - intelligenceMissionDifficulty(m);
        if (margin < 0) continue;
        if (best === null || margin > best.margin) best = { agent: a, mission: cascadeTimeLength(m, d), margin };
    }
    if (best === null) return false;
    best.mission.agent = best.agent;
    best.agent.mission = best.mission;
    return true;
}

function sendPatrol(galaxy: Galaxy, work: GreatWorkRecord, e: Empire): boolean {
    const base = work.base!;
    // One patrol fleet per empire, and never the last of its fleets: it keeps its home defence.
    const groups = empireShipGroups(e).filter((x) => x !== null);
    if (groups.length < 3) return false;
    for (const g of groups) {
        const m = g.mission;
        if (m !== null && m.type === BuiltObjectMissionType.Patrol && m.targetBuiltObject === base) return true;
    }
    const fleet = findNearestAvailableFleet(galaxy, e, base.xpos, base.ypos, BuiltObjectMissionPriority.Low, 0, FleetPosture.Defend, true, 0.1, false, true, false, false);
    if (fleet === null || fleet.leadShip === null || !isAiControlled(fleet.leadShip)) return false;
    if (!shipGroupCheckFleetTargetWithinFuelRangeAndRefuel(galaxy, fleet, base.xpos, base.ypos, 0.1)) return false;
    return shipGroupAssignMission(galaxy, fleet, BuiltObjectMissionType.Patrol, base, null, BuiltObjectMissionPriority.Normal, true);
}

/** One review of one work by one AI empire. Returns the plan taken. */
export function aiReview(galaxy: Galaxy, work: GreatWorkRecord, e: Empire): AiAction {
    const now = galaxyStarDate(galaxy);
    const action = aiChoice(galaxy, work, e);
    const prev = work.aiPlan[e.empireId];
    if (action === 'none') {
        if (prev !== undefined && prev.action !== 'none') work.aiPlan[e.empireId] = { action: 'none', since: now };
        return action;
    }
    let ok = false;
    if (action === 'destroy') ok = sendStrike(galaxy, work, e);
    else if (action === 'sabotage') {
        const lastSpy = prev !== undefined && prev.action === 'sabotage' ? prev.since : -1;
        if (lastSpy < 0 || now - lastSpy >= YEAR_LENGTH) ok = sendSpy(galaxy, work, e, expectedMenace(galaxy, work, e));
        else ok = true;
    } else ok = sendPatrol(galaxy, work, e);
    if (ok && (prev === undefined || prev.action !== action || action === 'sabotage')) {
        if (prev === undefined || prev.action !== action) logGw(galaxy, now, `${e.name} chooses to ${action} work ${work.id}`);
        work.aiPlan[e.empireId] = { action, since: prev !== undefined && prev.action === action && action !== 'sabotage' ? prev.since : now };
    }
    return ok ? action : 'none';
}

/** Periodic: every AI empire that suspects the work reviews it on its own schedule. */
export function aiStep(galaxy: Galaxy): void {
    if (!scenarioFlag(galaxy, SMARTER_AI_FLAG)) return;
    const now = galaxyStarDate(galaxy);
    const every = gwParam(galaxy, 'giantworksAiDecideDays') * GAME_DAY_LENGTH;
    for (const w of greatWorks(galaxy)) {
        const live = w.phase === 'building' || (w.phase === 'complete' && w.hostile);
        if (!live || w.base === null) continue;
        for (const e of ordinaryEmpires(galaxy)) {
            if (isHumanEmpire(galaxy, e) || !isSmarterAIStrategist(galaxy, e)) continue;
            if (w.phase === 'building' && workLevel(w, e) < KNOWLEDGE_SUSPECTED) continue;
            const next = w.aiNext[e.empireId];
            if (next !== undefined && next > now) continue;
            w.aiNext[e.empireId] = now + every + (e.empireId % 7) * GAME_DAY_LENGTH;
            aiReview(galaxy, w, e);
        }
    }
}
