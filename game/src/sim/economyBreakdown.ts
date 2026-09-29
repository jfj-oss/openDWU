// Read-only data for the Empire Summary "Economy" block: a port of
// EmpireSummaryEconomy.cs method_6 (State / Private columns). Every figure is computed without side effects:
// the Empire getters that mutate (ThisYearsSpacePortIncome ages the bases' yearly income and bumps
// ConsecutiveUnprofitableYears; AnnualPirateProtection adds pirate relations) are replaced by pure equivalents here.
// (The original's PurchaseStateFuel(0)/PurchasePrivateFuel(0) refresh calls are not made.)

import type { Empire } from './empire';
import type { Galaxy } from './galaxy';
import { REAL_SECONDS_IN_GALACTIC_YEAR, galaxyStarDate } from './tick/simTime';
import { DiplomaticRelationType } from './diplomacy';
import { PirateRelationType } from './pirateRelations';
import { baconSettings } from './data/baconSettings';
import {
    annualFacilityMaintenance,
    annualPrivateMaintenanceExcludingUnderConstruction,
    annualTaxRevenue,
    annualTroopMaintenance,
    privateAnnualRevenue,
} from './forceStructure';
import {
    annualStateMaintenanceExcludingUnderConstruction,
    thisYearsForeignTradeBonuses,
    thisYearsResortIncome as resortIncomeGetter,
} from './treasury';
import { thisYearsPrivateFuelCosts } from './logistics/refuel';

export interface EconomyLine {
    label: string;
    value: number;
}

export interface EconomyBreakdown {
    state: {
        cashOnHand: number;
        income: EconomyLine[];
        expenses: EconomyLine[];
        totalIncome: number;
        totalExpenses: number;
        /** Original: (tax + tribute income) - (expenses); bonus income is listed separately. */
        cashflow: number;
        bonusIncome: EconomyLine[];
        totalBonusIncome: number;
    };
    private: {
        cashOnHand: number;
        income: EconomyLine[];
        expenses: EconomyLine[];
        totalIncome: number;
        totalExpenses: number;
        cashflow: number;
    };
}

const sum = (lines: readonly EconomyLine[]): number => lines.reduce((a, l) => a + l.value, 0);

/** Empire.cs 2282 ThisYearsSpacePortIncome without the aging side effects: a base whose yearly income would be reset
 * by the aging pass contributes 0, exactly what the mutating getter would return. */
export function spacePortIncomeReadOnly(galaxy: Galaxy, empire: Empire): number {
    let num = 0.0;
    const currentStarDate = galaxyStarDate(galaxy);
    const num3 = currentStarDate - (currentStarDate % (REAL_SECONDS_IN_GALACTIC_YEAR * 1000));
    for (const list of [empire.spacePorts, empire.miningStations]) {
        if (list == null) continue;
        for (let i = 0; i < list.length; i++) {
            const b = list[i];
            if (b == null) continue;
            if (!empire.useAveragedVariableIncome && b.dateOfLastIncome < num3) continue;
            num += b.currentYearsIncome;
        }
    }
    return num;
}

/** Empire.cs 1775 AnnualPirateProtection without adding missing pirate relations (a new relation's fee is 0). */
export function pirateProtectionReadOnly(empire: Empire): number {
    let num = 0.0;
    if (empire.pirateRelations == null) return 0;
    for (let i = 0; i < empire.pirateRelations.count; i++) {
        const r = empire.pirateRelations.get(i);
        if (r != null && r.type === PirateRelationType.Protection && r.otherEmpire !== null) {
            const back = r.otherEmpire.pirateRelations?.getRelationByOtherEmpire(empire) ?? null;
            if (back != null) num += back.monthlyProtectionFeeToThisEmpire * 12.0;
        }
    }
    return num;
}

function tributeBase(galaxy: Galaxy, e: Empire): number {
    return annualTaxRevenue(galaxy, e) + thisYearsForeignTradeBonuses(e) + spacePortIncomeReadOnly(galaxy, e);
}

/** Empire.1.cs 1013 CalculateAnnualSubjugationTributeIncome, read-only. */
export function subjugationTributeIncomeReadOnly(galaxy: Galaxy, empire: Empire): number {
    let num = 0.0;
    for (let i = 0; i < empire.diplomaticRelations.count; i++) {
        const r = empire.diplomaticRelations.at(i);
        if (r.type === DiplomaticRelationType.SubjugatedDominion && r.initiator === empire) {
            if (r.otherEmpire === null) continue;
            num += tributeBase(galaxy, r.otherEmpire) * baconSettings.subjugationTributePercentage;
        }
    }
    return num;
}

/** Empire.cs 1756 AnnualSubjugationTribute, read-only. */
export function subjugationTributeReadOnly(galaxy: Galaxy, empire: Empire): number {
    let num = 0.0;
    const base = tributeBase(galaxy, empire);
    for (let i = 0; i < empire.diplomaticRelations.count; i++) {
        const r = empire.diplomaticRelations.at(i);
        if (r.type === DiplomaticRelationType.SubjugatedDominion && r.initiator !== empire) {
            num += base * baconSettings.subjugationTributePercentage;
        }
    }
    return num;
}

/** The Economy block of the Empire Summary (EmpireSummaryEconomy.cs method_6), in the original's line order. */
export function computeEconomyBreakdown(galaxy: Galaxy, empire: Empire): EconomyBreakdown {
    const tax = annualTaxRevenue(galaxy, empire);
    const stateIncome: EconomyLine[] = [
        { label: 'Colony Tax Revenue', value: tax },
        { label: 'Tribute From Others', value: subjugationTributeIncomeReadOnly(galaxy, empire) },
    ];
    const stateExpenses: EconomyLine[] = [
        { label: 'Ship & Base Maintenance', value: annualStateMaintenanceExcludingUnderConstruction(empire) },
        { label: 'Troop Maintenance', value: annualTroopMaintenance(empire) },
        { label: 'Facility Maintenance', value: annualFacilityMaintenance(empire) },
        { label: 'Fuel Costs', value: empire.thisYearsStateFuelCosts },
        { label: 'Subjugation Tribute', value: subjugationTributeReadOnly(galaxy, empire) },
        { label: 'Pirate Protection', value: pirateProtectionReadOnly(empire) },
    ];
    const bonus: EconomyLine[] = [
        { label: 'Space Port Income', value: spacePortIncomeReadOnly(galaxy, empire) },
        { label: 'Foreign Trade Bonuses', value: thisYearsForeignTradeBonuses(empire) },
        { label: 'Resort Income', value: resortIncomeGetter(galaxy, empire) },
    ];
    const privIncome: EconomyLine[] = [{ label: 'Colony Revenue', value: privateAnnualRevenue(galaxy, empire) }];
    const privExpenses: EconomyLine[] = [
        { label: 'Colony Taxes', value: tax },
        { label: 'Ship & Base Maintenance', value: annualPrivateMaintenanceExcludingUnderConstruction(empire) },
        { label: 'Fuel Costs', value: thisYearsPrivateFuelCosts(galaxy, empire) },
    ];
    const totalIncome = sum(stateIncome);
    const totalExpenses = sum(stateExpenses);
    const pIncome = sum(privIncome);
    const pExpenses = sum(privExpenses);
    return {
        state: {
            cashOnHand: empire.stateMoney,
            income: stateIncome,
            expenses: stateExpenses,
            totalIncome,
            totalExpenses,
            cashflow: totalIncome - totalExpenses,
            bonusIncome: bonus,
            totalBonusIncome: sum(bonus),
        },
        private: {
            cashOnHand: empire.privateMoney,
            income: privIncome,
            expenses: privExpenses,
            totalIncome: pIncome,
            totalExpenses: pExpenses,
            cashflow: pIncome - pExpenses,
        },
    };
}
