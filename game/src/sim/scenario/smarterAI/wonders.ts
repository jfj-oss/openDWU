// Smarter AI add-on: pursue wonders (scenarios/smarter-ai, flag smarterAIWonders). Not a port.
//
// Stock AI builds any wonder it happens to have researched once it costs under money / 1.5
// (construction/wonders.ts reviewColonyWonders, Empire.3.cs 114); the policy's PrioritizeBuildWonderId (full money for
// one wonder) is never set by any policy file. For AI empires this package:
//   - picks one wonder that fits the empire: research / economy / growth wonders for peaceful empires, defence /
//     weapons research / construction for aggressive ones (race tendency Aggressive, or at war), the race's own
//     achievement wonder first; never one built, or being built by another empire; ties: the least research left;
//   - puts the unresearched path to its project at the front of each research order (query researchProjectOrder,
//     after the optimised order of research.ts) and crash-researches path projects at the head of a research queue
//     when that costs at most a quarter of the treasury;
//   - builds it through the stock path with the whole treasury as its budget (the dead PrioritizeBuildWonderId rule),
//     and keeps other wonders from spending the money it needs once its project is researched (query wonderBudget).
// The plan is kept while valid; it is re-picked when the wonder is built / taken or the empire's stance changes. No Rnd.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Facility } from '../../data/facilities';
import type { TechNode } from '../../researchSystem';
import { PlanetaryFacilityType, WonderType, facilityType, getCurrentPath } from '../../researchSystem';
import { calculateCrashResearchProgramCost, initiateCrashResearchProgram, resolveEmpireRaceTendency } from '../../researchTick';
import { determineEmpiresAtWarWith } from '../../treasury';
import { calculatePlanetaryFacilityCost, planetaryFacilityDefinitionsStatic } from '../../construction/facilities';
import { checkWonderBuiltDef } from '../../construction/wonders';
import { registerScenarioPeriodic, registerScenarioQuery } from '../hooks';
import { SMARTER_AI_FLAG, isSmarterAIStrategist, smarterAIOn } from './common';
import { SMARTER_AI_WONDERS_FLAG, statecraftState, type SmarterWonderPlan } from './statecraft';

/** Crash research a wonder path project when it costs at most this share of the treasury. */
export const WONDER_CRASH_SHARE = 0.25;

function on(galaxy: Galaxy, empire: Empire | null): empire is Empire {
    return smarterAIOn(galaxy, SMARTER_AI_WONDERS_FLAG) && isSmarterAIStrategist(galaxy, empire);
}

/** How well a wonder type fits a peaceful / an aggressive empire (0 = not wanted). RaceAchievement is scored by the caller. */
export function wonderFit(type: WonderType, aggressive: boolean): number {
    const W = WonderType;
    if (aggressive) {
        switch (type) {
            case W.ColonyDefense: case W.EmpireResearchWeapons: return 5;
            case W.ColonyConstructionSpeed: return 4;
            case W.EmpireIncome: case W.ColonyIncome: return 3;
            case W.EmpireResearchEnergy: case W.EmpireResearchHighTech: return 2;
            case W.EmpirePopulationGrowth: case W.ColonyPopulationGrowth: case W.EmpireHappiness: case W.ColonyHappiness: return 1;
            default: return 0;
        }
    }
    switch (type) {
        case W.EmpireResearchWeapons: case W.EmpireResearchEnergy: case W.EmpireResearchHighTech: case W.EmpireIncome: return 5;
        case W.ColonyIncome: return 4;
        case W.EmpirePopulationGrowth: case W.ColonyPopulationGrowth: return 3;
        case W.EmpireHappiness: case W.ColonyHappiness: case W.ColonyConstructionSpeed: return 2;
        case W.ColonyDefense: return 1;
        default: return 0;
    }
}

/** Aggressive: an Aggressive race tendency (resolveEmpireRaceTendency 3) or at war. */
export function isAggressiveEmpire(galaxy: Galaxy, empire: Empire): boolean {
    if (empire.dominantRace !== null && resolveEmpireRaceTendency(galaxy, empire.dominantRace) === 3) return true;
    return determineEmpiresAtWarWith(galaxy, empire).empires.length > 0;
}

/** The unresearched projects to `node`, `node` last (empty when researched). */
export function wonderPath(empire: Empire, node: TechNode): TechNode[] {
    if (node.isResearched) return [];
    const path = getCurrentPath(empire.research, node, empire.dominantRace).filter((n): n is TechNode => n !== null && !n.isResearched);
    if (!path.includes(node)) path.push(node);
    return path;
}

function remainingCost(path: readonly TechNode[]): number {
    let c = 0;
    for (const n of path) c += Math.max(0, n.cost - n.progress);
    return c;
}

/** The empire's cheapest project that unlocks `wonder` and its race may research (null: none). */
export function wonderProject(empire: Empire, wonder: Facility): TechNode | null {
    const rs = empire.research;
    let best: TechNode | null = null;
    for (const n of rs.techTree) {
        if (rs.planetaryFacilityOf(n)?.facilityId !== wonder.facilityId) continue;
        if (empire.dominantRace !== null && !rs.raceMayResearch(n, empire.dominantRace)) continue;
        if (n.isResearched) return n;
        if (best === null || n.cost < best.cost) best = n;
    }
    return best;
}

/** Some colony has `wonder` (under construction or built); `owner` = whose. */
function wonderSites(galaxy: Galaxy, wonder: Facility): Empire[] {
    const out: Empire[] = [];
    for (const e of galaxy.empires) {
        if (e === null || !e.active) continue;
        for (const h of e.colonies) {
            if (h === null || h.facilities === null) continue;
            if (h.facilities.some((f) => f !== null && f.planetaryFacilityDefinitionId === wonder.facilityId)) out.push(e);
        }
    }
    return out;
}

/** The wonder the empire should pursue now (null: none fits). */
export function pickWonder(galaxy: Galaxy, empire: Empire, aggressive: boolean): SmarterWonderPlan | null {
    let best: { plan: SmarterWonderPlan; fit: number; cost: number } | null = null;
    for (const w of planetaryFacilityDefinitionsStatic(galaxy)) {
        if (w === null || facilityType(w) !== PlanetaryFacilityType.Wonder || checkWonderBuiltDef(galaxy, w)) continue;
        const node = wonderProject(empire, w);
        if (node === null) continue;
        const fit = (w.wonderType as WonderType) === WonderType.RaceAchievement ? 6 : wonderFit(w.wonderType as WonderType, aggressive);
        if (fit <= 0) continue;
        const sites = wonderSites(galaxy, w);
        if (sites.some((e) => e !== empire)) continue;
        if (sites.includes(empire)) continue; // already building it: the stock completes it
        const cost = remainingCost(wonderPath(empire, node));
        if (best === null || fit > best.fit || (fit === best.fit && cost < best.cost)) best = { plan: { facilityId: w.facilityId, projectId: node.def.projectId, aggressive }, fit, cost };
    }
    return best?.plan ?? null;
}

function wonderById(galaxy: Galaxy, id: number): Facility | null {
    return planetaryFacilityDefinitionsStatic(galaxy).find((f) => f !== null && f.facilityId === id) ?? null;
}

/** The empire's current plan, re-picked when its wonder is built / taken / started or the stance changed. */
export function ensureWonderPlan(galaxy: Galaxy, empire: Empire): SmarterWonderPlan | null {
    const st = statecraftState(galaxy);
    const key = String(empire.empireId);
    const aggressive = isAggressiveEmpire(galaxy, empire);
    const cur = st.wonders[key];
    if (cur !== undefined && cur !== null && cur.aggressive === aggressive) {
        const w = wonderById(galaxy, cur.facilityId);
        if (w !== null && !checkWonderBuiltDef(galaxy, w) && wonderSites(galaxy, w).length === 0) return cur;
    }
    const plan = pickWonder(galaxy, empire, aggressive);
    st.wonders[key] = plan;
    return plan;
}

function planNode(empire: Empire, plan: SmarterWonderPlan): TechNode | null {
    return empire.research.techTree.find((n) => n.def.projectId === plan.projectId) ?? null;
}

/** The research order with the wonder path's projects of `industry` first. */
export function withWonderPath(order: readonly number[] | null, path: readonly TechNode[], industry: number): readonly number[] | null {
    const front = path.filter((n) => n.def.industry === industry).map((n) => n.def.projectId);
    if (front.length === 0) return order;
    return [...front, ...(order ?? []).filter((id) => !front.includes(id))];
}

/** Crash-researches a wonder path project at the head of a research queue when cheap enough. */
export function crashWonderResearch(galaxy: Galaxy, empire: Empire, plan: SmarterWonderPlan): void {
    const node = planNode(empire, plan);
    if (node === null || !empire.initiateConstruction) return;
    const path = wonderPath(empire, node);
    if (path.length === 0) return;
    const rs = empire.research;
    for (const q of [rs.researchQueueWeapons, rs.researchQueueEnergy, rs.researchQueueHighTech]) {
        const head = q.length > 0 ? q[0] : null;
        if (head === null || head.isRushing || !path.includes(head)) continue;
        const cost = calculateCrashResearchProgramCost(empire, head);
        if (cost <= WONDER_CRASH_SHARE * empire.stateMoney) initiateCrashResearchProgram(galaxy, empire, head, cost);
    }
}

registerScenarioPeriodic({
    id: 'smarterAI.wonders',
    flag: SMARTER_AI_FLAG,
    periodDays: 30,
    run: (galaxy) => {
        if (!smarterAIOn(galaxy, SMARTER_AI_WONDERS_FLAG)) return;
        for (const e of galaxy.empires) {
            if (!on(galaxy, e)) continue;
            const plan = ensureWonderPlan(galaxy, e);
            if (plan !== null) crashWonderResearch(galaxy, e, plan);
        }
    },
});

registerScenarioQuery({
    id: 'smarterAI.wonderResearch',
    query: 'researchProjectOrder',
    flag: SMARTER_AI_FLAG,
    run: (galaxy, value, { empire, industry }) => {
        if (!on(galaxy, empire)) return value;
        const plan = statecraftState(galaxy).wonders[String(empire.empireId)];
        if (plan === undefined || plan === null) return value;
        const node = planNode(empire, plan);
        if (node === null) return value;
        return withWonderPath(value, wonderPath(empire, node), industry) as readonly number[];
    },
});

registerScenarioQuery({
    id: 'smarterAI.wonderBudget',
    query: 'wonderBudget',
    flag: SMARTER_AI_FLAG,
    run: (galaxy, value, { empire, wonder }) => {
        if (!on(galaxy, empire)) return value;
        const plan = statecraftState(galaxy).wonders[String(empire.empireId)];
        if (plan === undefined || plan === null) return value;
        if (wonder.facilityId === plan.facilityId) return empire.stateMoney;
        const node = planNode(empire, plan);
        const target = wonderById(galaxy, plan.facilityId);
        if (node === null || target === null || !node.isResearched) return value;
        // Saving for the target: another wonder only if the target stays affordable after it.
        const left = empire.stateMoney - calculatePlanetaryFacilityCost(wonder, empire);
        return left >= calculatePlanetaryFacilityCost(target, empire) ? value : 0;
    },
});
