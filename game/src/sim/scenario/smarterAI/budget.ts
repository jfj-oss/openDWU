// Smarter AI add-on, part 3: cut costs when broke (scenarios/smarter-ai, flag smarterAIBudget). Not a port.
//
// The stock RetireOldBuiltObjects (construction/empireConstruction.ts, Empire.6.cs 587) only walks PRIVATE ships, so an
// AI empire in debt keeps paying for its obsolete state fleet. Every REVIEW_DAYS game days, per AI empire:
//   - "In debt" is the growth-tax test (taxes.ts debtWithHysteresis) on the current cashflow, with its own hysteresis
//     memory. In debt:
//       * the oldest obsolete state ships and bases (a newer design of the sub-role is buildable, or the design is
//         obsolete) are sent to scrap (assignScrapMission), oldest design first, at most MAX_RETIRE_PER_REVIEW per
//         review and only until their upkeep covers the shortfall. Space ports, ship yards, resource extractors,
//         construction and colony ships are kept, and so is every armed object in the system of a threatened colony
//         (an enemy threat or a creature in the system: checkSafeToBuildAtLocation, the stock threat test);
//       * new low-value state builds (exploration ships while one exists, resupply ships, research / monitoring /
//         resort / generic bases, extra space ports) are skipped (stateBuildSkipped).
//   - With a large surplus (cash above SURPLUS_YEARS of upkeep, not in debt): colony ships are built regardless of the
//     freighter / military ratio check, defensive bases aim for DEFENCE_SURPLUS_FACTOR × the firepower, colonies take
//     up to SURPLUS_RESEARCH_STATIONS research stations, and the wonder gate StateMoney / 1.5 becomes
//     StateMoney / SURPLUS_WONDER_DIVISOR.
// The player, pirates and the independents are never touched. No Rnd here (scrapping a base inflicts damage, which
// is the stock AssignScrapMission path).

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { BuiltObject } from '../../builtObject';
import type { Habitat } from '../../types';
import { BuiltObjectSubRole } from '../../builtObjectTypes';
import { BuiltObjectRole } from '../../data/designSpecifications';
import { BuiltObjectMissionType, builtObjectMission } from '../../missions/mission';
import { isAiControlled } from '../../missions/playerOrder';
import { findNewestCanBuildFullEvaluate } from '../../designGeneration';
import { assignScrapMission, checkSafeToBuildAtLocation } from '../../construction/empireConstruction';
import { calculateAnnualCashflow } from '../../treasury';
import { registerScenarioPeriodic, registerScenarioQuery } from '../hooks';
import { scenarioState } from '../state';
import { SMARTER_AI_FLAG, isSmarterAIEmpire, smarterAIOn } from './common';
import { DEBT_TARGET_UPKEEP_YEARS, debtWithHysteresis, stateUpkeep } from './taxes';

export const SMARTER_AI_BUDGET_FLAG = 'smarterAIBudget';
export const SMARTER_AI_ECONOMY_STATE_KEY = 'smarterAIEconomy';
/** Game days between budget reviews. */
export const REVIEW_DAYS = 30;
/** State ships / bases sent to scrap per review at most. */
export const MAX_RETIRE_PER_REVIEW = 3;
/** Surplus: cash above this many years of upkeep. */
export const SURPLUS_YEARS = 5;
export const DEFENCE_SURPLUS_FACTOR = 1.5;
export const SURPLUS_RESEARCH_STATIONS = 3;
export const SURPLUS_WONDER_DIVISOR = 1.2;

/** galaxy.scenario.state.smarterAIEconomy (plain data, saved with the game). Keys are empire ids. */
export interface SmarterEconomyState {
    /** In debt (hysteresis memory). */
    debt: Record<string, boolean>;
    /** Cash above SURPLUS_YEARS of upkeep at the last review. */
    surplus: Record<string, boolean>;
}

export function smarterEconomyState(galaxy: Galaxy): SmarterEconomyState {
    return scenarioState<SmarterEconomyState>(galaxy, SMARTER_AI_ECONOMY_STATE_KEY, () => ({ debt: {}, surplus: {} }));
}

export interface EconomyReview {
    inDebt: boolean;
    surplus: boolean;
    upkeep: number;
    cashflow: number;
    /** The cashflow still needed (debt repaid within a year plus a quarter year of upkeep), as in growth taxes. */
    shortfall: number;
}

/** Re-evaluates and stores `empire`'s debt / surplus state. Shared with the retrofit package. */
export function reviewEconomy(galaxy: Galaxy, empire: Empire): EconomyReview {
    const st = smarterEconomyState(galaxy);
    const key = String(empire.empireId);
    const upkeep = stateUpkeep(empire);
    const money = empire.stateMoney;
    const cashflow = calculateAnnualCashflow(galaxy, empire);
    const inDebt = debtWithHysteresis(st.debt[key] === true, money, cashflow, upkeep);
    const surplus = !inDebt && money > 0 && money >= SURPLUS_YEARS * upkeep;
    if (inDebt) st.debt[key] = true;
    else delete st.debt[key];
    if (surplus) st.surplus[key] = true;
    else delete st.surplus[key];
    const shortfall = Math.max(0, -money) + DEBT_TARGET_UPKEEP_YEARS * upkeep - cashflow;
    return { inDebt, surplus, upkeep, cashflow, shortfall };
}

const KEPT_SUB_ROLES: ReadonlySet<BuiltObjectSubRole> = new Set([
    BuiltObjectSubRole.SmallSpacePort,
    BuiltObjectSubRole.MediumSpacePort,
    BuiltObjectSubRole.LargeSpacePort,
    BuiltObjectSubRole.ConstructionShip,
    BuiltObjectSubRole.ColonyShip,
]);

/** The sub-roles of new state builds skipped in debt. */
const LOW_VALUE_SUB_ROLES: ReadonlySet<number> = new Set([
    BuiltObjectSubRole.ExplorationShip,
    BuiltObjectSubRole.ResupplyShip,
    BuiltObjectSubRole.EnergyResearchStation,
    BuiltObjectSubRole.WeaponsResearchStation,
    BuiltObjectSubRole.HighTechResearchStation,
    BuiltObjectSubRole.MonitoringStation,
    BuiltObjectSubRole.ResortBase,
    BuiltObjectSubRole.GenericBase,
]);
const SPACE_PORT_SUB_ROLES: ReadonlySet<number> = new Set([BuiltObjectSubRole.SmallSpacePort, BuiltObjectSubRole.MediumSpacePort, BuiltObjectSubRole.LargeSpacePort]);

/** A new state build of `subRole` is skipped while `empire` is in debt. */
export function lowValueBuild(empire: Empire, subRole: number): boolean {
    if (SPACE_PORT_SUB_ROLES.has(subRole)) return empire.spacePorts.length > 0;
    if (subRole === BuiltObjectSubRole.ExplorationShip) return (empire.builtObjects as BuiltObject[]).some((b) => b.subRole === BuiltObjectSubRole.ExplorationShip && b.builtAt === null);
    return LOW_VALUE_SUB_ROLES.has(subRole);
}

/** The ship / base has a newer buildable design of its sub-role (or its design is marked obsolete). */
export function isObsoleteBuiltObject(empire: Empire, bo: BuiltObject): boolean {
    const own = bo.design;
    if (own === null) return false;
    if (own.isObsolete) return true;
    const newest = findNewestCanBuildFullEvaluate(empire.designs, bo.subRole, bo.parentHabitat);
    return newest !== null && newest !== own && newest.dateCreated > own.dateCreated;
}

const armed = (bo: BuiltObject): boolean => bo.firepowerRaw > 0 || bo.fighterCapacity > 0;

/** The systems (system stars) of `empire`'s threatened colonies, by the stock threat test. */
export function threatenedSystems(galaxy: Galaxy, empire: Empire): Set<Habitat> {
    const out = new Set<Habitat>();
    for (const h of empire.colonies) {
        if (h === null || h.empire !== empire || checkSafeToBuildAtLocation(galaxy, empire, h)) continue;
        const star = galaxy.determineHabitatSystemStar(h);
        out.add(star ?? h);
    }
    return out;
}

/** Retirement candidates, oldest design first (then oldest built; ties keep the list order). */
export function retirementCandidates(galaxy: Galaxy, empire: Empire): BuiltObject[] {
    const threatened = threatenedSystems(galaxy, empire);
    const out: BuiltObject[] = [];
    for (const bo of empire.builtObjects as BuiltObject[]) {
        if (bo === null || bo.design === null || bo.hasBeenDestroyed || !isAiControlled(bo) || bo.retireForNextMission || bo.scrap || bo.builtAt !== null || bo.unbuiltComponentCount > 0) continue;
        if (KEPT_SUB_ROLES.has(bo.subRole) || bo.isShipYard || bo.isResourceExtractor) continue;
        const m = builtObjectMission(bo.mission);
        if (m !== null && (m.type === BuiltObjectMissionType.Retire || m.type === BuiltObjectMissionType.Retrofit)) continue;
        if (bo.retrofitDesign !== null) continue;
        if (!isObsoleteBuiltObject(empire, bo)) continue;
        // The defenders of a threatened colony stay.
        if (armed(bo)) {
            const at = bo.parentHabitat !== null ? (galaxy.determineHabitatSystemStar(bo.parentHabitat) ?? bo.parentHabitat) : bo.nearestSystemStar;
            if (at !== null && threatened.has(at)) continue;
        }
        out.push(bo);
    }
    const idx = new Map(out.map((b, i) => [b, i]));
    out.sort((a, b) => a.design!.dateCreated - b.design!.dateCreated || a.dateBuilt - b.dateBuilt || idx.get(a)! - idx.get(b)!);
    return out;
}

/** In debt: sends the oldest obsolete state objects to scrap until their upkeep covers `shortfall`. Returns them. */
export function retireForBudget(galaxy: Galaxy, empire: Empire, shortfall: number): BuiltObject[] {
    const out: BuiltObject[] = [];
    if (!(shortfall > 0)) return out;
    let saved = 0;
    for (const bo of retirementCandidates(galaxy, empire)) {
        if (out.length >= MAX_RETIRE_PER_REVIEW || saved >= shortfall) break;
        const cost = Math.max(0, bo.annualSupportCost);
        if (assignScrapMission(galaxy, empire, bo)) {
            out.push(bo);
            saved += cost;
        }
    }
    return out;
}

/** One empire's budget review (see the file comment). */
export function reviewBudget(galaxy: Galaxy, empire: Empire): EconomyReview {
    const r = reviewEconomy(galaxy, empire);
    if (r.inDebt) retireForBudget(galaxy, empire, r.shortfall);
    return r;
}

const budgetOn = (galaxy: Galaxy, empire: Empire): boolean => smarterAIOn(galaxy, SMARTER_AI_BUDGET_FLAG) && isSmarterAIEmpire(galaxy, empire);

registerScenarioPeriodic({
    id: 'smarterAI.budget',
    flag: SMARTER_AI_FLAG,
    periodDays: REVIEW_DAYS,
    run: (galaxy) => {
        if (!smarterAIOn(galaxy, SMARTER_AI_BUDGET_FLAG)) return;
        for (const e of galaxy.empires) if (isSmarterAIEmpire(galaxy, e)) reviewBudget(galaxy, e);
    },
});

registerScenarioQuery({
    id: 'smarterAI.budget.skip',
    query: 'stateBuildSkipped',
    flag: SMARTER_AI_FLAG,
    run: (galaxy, value, { empire, subRole }) => {
        if (value || !budgetOn(galaxy, empire)) return value;
        return smarterEconomyState(galaxy).debt[String(empire.empireId)] === true && lowValueBuild(empire, subRole);
    },
});

registerScenarioQuery({
    id: 'smarterAI.budget.colonize',
    query: 'colonizationBuildAllowed',
    flag: SMARTER_AI_FLAG,
    run: (galaxy, value, { empire }) => {
        if (value || !budgetOn(galaxy, empire)) return value;
        return smarterEconomyState(galaxy).surplus[String(empire.empireId)] === true;
    },
});

registerScenarioQuery({
    id: 'smarterAI.budget.targets',
    query: 'aiBuildTarget',
    flag: SMARTER_AI_FLAG,
    run: (galaxy, value, { empire, kind }) => {
        if (!budgetOn(galaxy, empire) || smarterEconomyState(galaxy).surplus[String(empire.empireId)] !== true) return value;
        switch (kind) {
            case 'defensiveForce':
                return Math.trunc(value * DEFENCE_SURPLUS_FACTOR);
            case 'researchStationsPerColony':
                return Math.max(value, SURPLUS_RESEARCH_STATIONS);
            case 'wonderMoneyDivisor':
                return Math.min(value, SURPLUS_WONDER_DIVISOR);
        }
        return value;
    },
});
