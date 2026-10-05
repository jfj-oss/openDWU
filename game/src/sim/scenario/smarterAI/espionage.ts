// Smarter AI add-on: use spies well (scenarios/smarter-ai, flag smarterAIEspionage). Not a port.
//
// Stock AI spies only on empires its diplomatic strategy marks as targets (espionage.ts assignSpecialMissions,
// Empire.5.cs 5401), picks targets at random and keeps a fixed policy share of its agents on counter-intelligence. For AI
// empires this package (existing mission types only, the stock difficulty rules):
//   - every 30 days gives its free attack agents (beyond the counter-intelligence share and the missions already
//     running) DestroyBase missions against known pirate bases near its colonies (nearest first), then StealTechData
//     against the non-friendly rival whose research is furthest ahead of its own (that rival's most expensive project),
//     each with the agent most likely to succeed (the mission's difficulty within the agent's one-year skill);
//   - raises the counter-intelligence share while hostile agents are active against it: missions against it exposed in
//     the last year (intelMissionExposed) or empires recently caught spying (Empire.RecentSpyingEmpires)
//     (query counterIntelligenceProportion).
// The policy's mission permissions are respected. No Rnd.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { BuiltObject } from '../../builtObject';
import type { TechNode } from '../../researchSystem';
import { CharacterRole, getEmpireCharacters, type Character, type IntelligenceMission } from '../../characters';
import {
    IntelligenceMissionType,
    calculateIntelligenceMissionSkill,
    cascadeTimeLength,
    characterMission,
    checkForIntelligenceMissionsOfTypeAgainstEmpire,
    checkWhetherTargetOfIntelligenceMission,
    countAgentsAssigned,
    intelligenceMissionDifficulty,
    newIntelligenceMissionAgainstBuiltObject,
    newIntelligenceMissionStealTechData,
    resolveKnownBases,
    resolveMoreAdvancedProjectsIncludeSpecial,
} from '../../espionage';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../../diplomacy';
import { PirateRelationType, galaxyCurrentStarDate, obtainPirateRelation } from '../../pirateRelations';
import { csInt } from '../../builtObjectComponent';
import { YEAR_LENGTH } from '../../galaxyTime';
import { registerScenarioEvent, registerScenarioPeriodic, registerScenarioQuery } from '../hooks';
import { SMARTER_AI_FLAG, isSmarterAIEmpire, smarterAIOn } from './common';
import { SMARTER_AI_ESPIONAGE_FLAG, statecraftState } from './statecraft';

const T = IntelligenceMissionType;

/** Pirate bases within this many sectors of a colony are sabotage targets. */
export const PIRATE_BASE_SECTORS = 2;
/** Counter-intelligence share under hostile spying: base + per hostile signal, capped. */
export const COUNTER_INTEL_BASE = 0.35;
export const COUNTER_INTEL_PER_SIGNAL = 0.15;
export const COUNTER_INTEL_MAX = 0.75;

function on(galaxy: Galaxy, empire: Empire | null): empire is Empire {
    return smarterAIOn(galaxy, SMARTER_AI_ESPIONAGE_FLAG) && isSmarterAIEmpire(galaxy, empire);
}

/** Hostile spying signals: exposures against the empire in the last year plus empires recently caught spying. */
export function hostileSpySignals(galaxy: Galaxy, empire: Empire): number {
    const now = galaxyCurrentStarDate(galaxy);
    const dates = statecraftState(galaxy).spiedOn[String(empire.empireId)] ?? [];
    return dates.filter((d) => now - d <= YEAR_LENGTH).length + empire.recentSpyingEmpires.length;
}

/** The counter-intelligence share for `signals` hostile signals (never below the policy's share). */
export function counterIntelShare(policyShare: number, signals: number): number {
    if (signals <= 0) return policyShare;
    return Math.max(policyShare, Math.min(COUNTER_INTEL_MAX, COUNTER_INTEL_BASE + COUNTER_INTEL_PER_SIGNAL * signals));
}

function agents(empire: Empire): Character[] {
    return getEmpireCharacters(empire).filter((c) => c !== null && c.active && c.role === CharacterRole.IntelligenceAgent);
}

function isFree(c: Character): boolean {
    const m = characterMission(c);
    return m === null || m.type === T.Undefined || m.type === T.CounterIntelligence;
}

/** The free agent most likely to pull off `make()`'s mission (its difficulty within the agent's one-year skill). */
function bestAgentFor(self: Empire, free: readonly Character[], type: IntelligenceMissionType, target: Empire, make: () => IntelligenceMission): { agent: Character; mission: IntelligenceMission } | null {
    let best: { agent: Character; mission: IntelligenceMission; margin: number } | null = null;
    for (const a of free) {
        const d = calculateIntelligenceMissionSkill(self, a, type, target);
        const m = make();
        const margin = csInt(d.oneYearDifficulty) - intelligenceMissionDifficulty(m);
        if (margin < 0) continue;
        if (best === null || margin > best.margin) best = { agent: a, mission: cascadeTimeLength(m, d), margin };
    }
    return best;
}

function assign(agent: Character, mission: IntelligenceMission): void {
    mission.agent = agent;
    agent.mission = mission;
}

/** Known pirate bases within PIRATE_BASE_SECTORS of the empire's colonies, nearest first (pirates it does not pay). */
export function pirateBasesNearColonies(galaxy: Galaxy, self: Empire): { base: BuiltObject; pirate: Empire; distance: number }[] {
    const range = PIRATE_BASE_SECTORS * galaxy.sectorSize;
    const out: { base: BuiltObject; pirate: Empire; distance: number }[] = [];
    for (const p of galaxy.pirateEmpires) {
        if (p === null || !p.active || p === self || obtainPirateRelation(self, p).type !== PirateRelationType.None) continue;
        for (const b of resolveKnownBases(galaxy, self, p)) {
            if (b.hasBeenDestroyed) continue;
            let d = Infinity;
            for (const h of self.colonies) if (h !== null) d = Math.min(d, galaxy.calculateDistance(h.xpos, h.ypos, b.xpos, b.ypos));
            if (d <= range) out.push({ base: b, pirate: p, distance: d });
        }
    }
    out.sort((a, b) => a.distance - b.distance);
    return out;
}

/** A rival the empire may steal from: met, not at peace-treaty level or a subject. */
function stealable(self: Empire, other: Empire): boolean {
    if (other === self || !other.active || other.pirateEmpireBaseHabitat !== null) return false;
    const r = obtainDiplomaticRelation(self, other);
    switch (r.type) {
        case DiplomaticRelationType.NotMet:
        case DiplomaticRelationType.FreeTradeAgreement:
        case DiplomaticRelationType.MutualDefensePact:
        case DiplomaticRelationType.Protectorate:
        case DiplomaticRelationType.SubjugatedDominion:
            return false;
        default:
            return true;
    }
}

/** The rival whose research is furthest ahead (summed cost of the projects it has that we could research next) and its best project. */
export function bestTechTarget(galaxy: Galaxy, self: Empire): { rival: Empire; project: TechNode } | null {
    let best: { rival: Empire; project: TechNode; value: number } | null = null;
    for (const e of galaxy.empires) {
        if (e === null || !stealable(self, e) || checkForIntelligenceMissionsOfTypeAgainstEmpire(self, e, T.StealTechData)) continue;
        const projects = resolveMoreAdvancedProjectsIncludeSpecial(self, e, false);
        if (projects.length === 0) continue;
        let value = 0;
        let top = projects[0];
        for (const p of projects) {
            value += p.cost;
            if (p.cost > top.cost) top = p;
        }
        if (best === null || value > best.value) best = { rival: e, project: top, value };
    }
    return best === null ? null : { rival: best.rival, project: best.project };
}

/** Gives the empire's free attack agents the pirate-base and tech missions (see the file comment). Returns missions assigned. */
export function steerAgents(galaxy: Galaxy, self: Empire): number {
    const p = self.policy;
    if (p == null) return 0;
    const all = agents(self);
    if (all.length === 0) return 0;
    const share = counterIntelShare(Math.fround(p.intelligenceCounterIntelligenceProportion / 100), hostileSpySignals(galaxy, self));
    const counter = Math.trunc(Math.max(1, all.length * share));
    let budget = all.length - counter - countAgentsAssigned(self).attackAgentsOnAssignment;
    const free = all.filter(isFree);
    const now = galaxyCurrentStarDate(galaxy);
    let n = 0;
    const take = (a: Character): void => {
        free.splice(free.indexOf(a), 1);
        budget--;
        n++;
    };
    if (p.intelligenceAllowMissionDestroyBase) {
        for (const { base, pirate } of pirateBasesNearColonies(galaxy, self)) {
            if (budget <= 0 || free.length === 0) break;
            if (checkWhetherTargetOfIntelligenceMission(self, pirate, base, T.DestroyBase)) continue;
            const pick = bestAgentFor(self, free, T.DestroyBase, pirate, () => newIntelligenceMissionAgainstBuiltObject(self, null, T.DestroyBase, now, base));
            if (pick === null) continue;
            assign(pick.agent, pick.mission);
            take(pick.agent);
        }
    }
    if (p.intelligenceAllowMissionStealTechData) {
        while (budget > 0 && free.length > 0) {
            const t = bestTechTarget(galaxy, self);
            if (t === null) break;
            const pick = bestAgentFor(self, free, T.StealTechData, t.rival, () => newIntelligenceMissionStealTechData(self, null, now, t.rival, t.project));
            if (pick === null) break;
            assign(pick.agent, pick.mission);
            take(pick.agent);
        }
    }
    return n;
}

registerScenarioPeriodic({
    id: 'smarterAI.espionage',
    flag: SMARTER_AI_FLAG,
    periodDays: 30,
    run: (galaxy) => {
        if (!smarterAIOn(galaxy, SMARTER_AI_ESPIONAGE_FLAG)) return;
        const st = statecraftState(galaxy);
        const now = galaxyCurrentStarDate(galaxy);
        for (const key of Object.keys(st.spiedOn)) {
            st.spiedOn[key] = st.spiedOn[key].filter((d) => now - d <= YEAR_LENGTH);
            if (st.spiedOn[key].length === 0) delete st.spiedOn[key];
        }
        for (const e of galaxy.empires) if (on(galaxy, e)) steerAgents(galaxy, e);
    },
});

registerScenarioEvent({
    id: 'smarterAI.spiedOn',
    event: 'intelMissionExposed',
    flag: SMARTER_AI_FLAG,
    run: (galaxy, { empire, target }) => {
        if (target === empire || !on(galaxy, target)) return;
        const st = statecraftState(galaxy);
        (st.spiedOn[String(target.empireId)] ??= []).push(galaxyCurrentStarDate(galaxy));
    },
});

registerScenarioQuery({
    id: 'smarterAI.counterIntelligence',
    query: 'counterIntelligenceProportion',
    flag: SMARTER_AI_FLAG,
    run: (galaxy, value, { empire }) => (on(galaxy, empire) ? counterIntelShare(value, hostileSpySignals(galaxy, empire)) : value),
});
