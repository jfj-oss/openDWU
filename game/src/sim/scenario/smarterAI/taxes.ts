// Smarter AI add-on, part 2: growth taxes (scenarios/smarter-ai, flag smarterAIGrowthTax). Not a port.
//
// Colony growth is multiplied by (1 + approval / 200) (colonyTick.ts, Habitat.cs population growth) and tax lowers
// approval, so an AI empire leaves its growing colonies untaxed. Runs on the `taxesReviewed` event at the end of
// taxes.ts reviewTaxes (Empire.10.cs 158 ReviewTaxes), after the stock SetColonyTaxRate pass set every colony's rate:
//   - a colony at or above the threshold share of its maximum population (Habitat.MaxPopulation) keeps the stock rate;
//   - a colony below it gets 0% —
//   - unless the empire is in debt: state money below 0, or its cashflow without those taxes negative while its cash
//     covers less than ALLOWABLE_YEARS_MAINTENANCE_FROM_CASH_ON_HAND years of upkeep. Then the growing colonies are
//     taxed at the stock rate, fullest first, until their revenue covers the shortfall (the cashflow needed to repay the
//     debt within a year plus a quarter year of upkeep).
//   - after a pre-warp opening that ended at its population share (opening.ts) the capital is never a growing colony;
//   - Hysteresis: the debt override ends only when money is back at or above 0 and either the untaxed cashflow is not
//     negative or the cash covers 1.5 × ALLOWABLE_YEARS of upkeep.
// The player, pirates and nationalised (special function 1) governments are never touched. No Rnd.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import { empireGovernmentAttributes } from '../../empire';
import type { Habitat } from '../../types';
import { ALLOWABLE_YEARS_MAINTENANCE_FROM_CASH_ON_HAND, annualTroopMaintenance, recalculateAnnualTaxRevenue } from '../../forceStructure';
import { annualStateMaintenanceExcludingUnderConstruction, calculateAnnualCashflow } from '../../treasury';
import { registerScenarioEvent } from '../hooks';
import { scenarioParam } from '../state';
import { SMARTER_AI_FLAG, SMARTER_AI_GROWTH_TAX_FLAG, SMARTER_AI_GROWTH_TAX_THRESHOLD_DEFAULT, SMARTER_AI_GROWTH_TAX_THRESHOLD_PARAM, isSmarterAIEmpire, smarterAIOn, smarterAIState, smarterOpeningRecord } from './common';

/** The debt-override exit margin, in multiples of the ALLOWABLE_YEARS cash-on-hand rule. */
export const DEBT_RECOVERED_FACTOR = 1.5;
/** The positive cashflow the override aims for beyond repaying the debt (years of upkeep). */
export const DEBT_TARGET_UPKEEP_YEARS = 0.25;

export interface GrowthTaxCandidate {
    /** Population / maximum population. */
    fullness: number;
    /** Annual revenue the colony brings at its stock rate over 0%. */
    contribution: number;
}

/**
 * Debt override: which growing colonies are taxed (indexes into `colonies`), fullest first, until their contributions
 * cover `shortfall` (none when the shortfall is not positive). Ties keep the colony order.
 */
export function planGrowthTaxes(colonies: readonly GrowthTaxCandidate[], shortfall: number): number[] {
    const out: number[] = [];
    if (!(shortfall > 0)) return out;
    const order = colonies.map((_, i) => i).sort((a, b) => colonies[b].fullness - colonies[a].fullness || a - b);
    let covered = 0;
    for (const i of order) {
        if (covered >= shortfall) break;
        out.push(i);
        covered += Math.max(0, colonies[i].contribution);
    }
    return out;
}

/** The colony's population share of its maximum (1 when it has no maximum). */
export function colonyFullness(h: Habitat): number {
    const pop = h.population?.totalAmount ?? 0;
    return h.maxPopulation > 0 ? pop / h.maxPopulation : 1;
}

/**
 * The add-on's "in debt" test (shared with the budget package): money below 0, or a negative cashflow with less than
 * ALLOWABLE_YEARS of `upkeep` in cash; once in debt, out only when money is at or above 0 and either the cashflow is not
 * negative or the cash covers DEBT_RECOVERED_FACTOR × ALLOWABLE_YEARS of upkeep. Pure.
 */
export function debtWithHysteresis(wasInDebt: boolean, money: number, cashflow: number, upkeep: number): boolean {
    const margin = ALLOWABLE_YEARS_MAINTENANCE_FROM_CASH_ON_HAND * upkeep;
    return wasInDebt ? !(money >= 0 && (cashflow >= 0 || money >= DEBT_RECOVERED_FACTOR * margin)) : money < 0 || (cashflow < 0 && money < margin);
}

/** The state upkeep the debt test weighs (ships and bases not under construction, plus troops). */
export function stateUpkeep(empire: Empire): number {
    return Math.max(0, annualStateMaintenanceExcludingUnderConstruction(empire) + annualTroopMaintenance(empire));
}

/** Applies growth taxes to `empire`'s colonies after the stock review (see the file comment). */
export function applyGrowthTaxes(galaxy: Galaxy, empire: Empire): void {
    const gov = empireGovernmentAttributes(empire);
    if (gov !== null && gov.specialFunctionCode === 1) return;
    const threshold = scenarioParam(galaxy, SMARTER_AI_GROWTH_TAX_THRESHOLD_PARAM, SMARTER_AI_GROWTH_TAX_THRESHOLD_DEFAULT) / 100;
    const growing: Habitat[] = [];
    // After a pre-warp opening that ended at its population share the capital keeps the stock rate (the hand-over set it
    // to the highest rate keeping approval at the minimum; growth taxes must not push it back to 0%).
    const keepCapital = smarterOpeningRecord(galaxy, empire)?.endedAtShare === true;
    for (const h of empire.colonies) if (h !== null && h.empire === empire && colonyFullness(h) < threshold && !(keepCapital && h === empire.capital)) growing.push(h);
    if (growing.length === 0) return;
    // The stock rates and revenues, then every growing colony at 0%.
    const stockRates = growing.map((h) => h.taxRate);
    const stockRevenue = growing.map((h) => h.annualTaxRevenue);
    const candidates: GrowthTaxCandidate[] = [];
    for (let i = 0; i < growing.length; i++) {
        const h = growing[i];
        h.taxRate = 0;
        recalculateAnnualTaxRevenue(galaxy, h);
        candidates.push({ fullness: colonyFullness(h), contribution: stockRevenue[i] - h.annualTaxRevenue });
    }
    // Debt override (with hysteresis).
    const st = smarterAIState(galaxy);
    const key = String(empire.empireId);
    const upkeep = stateUpkeep(empire);
    const money = empire.stateMoney;
    const cashflow = calculateAnnualCashflow(galaxy, empire);
    const inDebt = debtWithHysteresis(st.debt[key] === true, money, cashflow, upkeep);
    if (inDebt) st.debt[key] = true;
    else delete st.debt[key];
    if (!inDebt) return;
    const target = Math.max(0, -money) + DEBT_TARGET_UPKEEP_YEARS * upkeep;
    for (const i of planGrowthTaxes(candidates, target - cashflow)) {
        growing[i].taxRate = stockRates[i];
        recalculateAnnualTaxRevenue(galaxy, growing[i]);
    }
}

registerScenarioEvent({
    id: 'smarterAI.growthTaxes',
    event: 'taxesReviewed',
    flag: SMARTER_AI_FLAG,
    run: (galaxy, { empire }) => {
        if (!smarterAIOn(galaxy, SMARTER_AI_GROWTH_TAX_FLAG) || !isSmarterAIEmpire(galaxy, empire)) return;
        applyGrowthTaxes(galaxy, empire);
    },
});
