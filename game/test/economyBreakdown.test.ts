import { describe, expect, it } from 'vitest';
import { computeEconomyBreakdown } from '../src/sim/economyBreakdown';
import { economyBlockRows } from '../src/ui/screens/empireSummary';
import { cachedTickGame } from './helpers/gameCache';
import { loadGameDataFs } from './helpers/loadGameDataFs';

describe('economy breakdown', async () => {
    const gameData = await loadGameDataFs();
    const galaxy = cachedTickGame(gameData, { seconds: 30 }).galaxy;
    const empire = galaxy.playerEmpire!;

    it('lines sum to the totals and cashflow = income - expenses', () => {
        const b = computeEconomyBreakdown(galaxy, empire);
        const s = (a: { value: number }[]) => a.reduce((x, l) => x + l.value, 0);
        expect(b.state.totalIncome).toBeCloseTo(s(b.state.income));
        expect(b.state.totalExpenses).toBeCloseTo(s(b.state.expenses));
        expect(b.state.cashflow).toBeCloseTo(b.state.totalIncome - b.state.totalExpenses);
        expect(b.private.cashflow).toBeCloseTo(s(b.private.income) - s(b.private.expenses));
        expect(b.state.income.map((l) => l.label)).toEqual(['Colony Tax Revenue', 'Tribute From Others']);
        expect(b.state.expenses.map((l) => l.label)).toEqual(['Ship & Base Maintenance', 'Troop Maintenance', 'Facility Maintenance', 'Fuel Costs', 'Subjugation Tribute', 'Pirate Protection']);
        expect(b.private.expenses.map((l) => l.label)).toEqual(['Colony Taxes', 'Ship & Base Maintenance', 'Fuel Costs']);
        expect(economyBlockRows(b).length).toBeGreaterThan(15);
    });

    it('does not change sim state', () => {
        const snap = () =>
            JSON.stringify({
                m: [empire.stateMoney, empire.privateMoney, empire.useAveragedVariableIncome, empire.lastResortIncomeAddDate, empire.thisYearsResortIncomeValue],
                b: [...empire.spacePorts, ...empire.miningStations].map((b) => [b.currentYearsIncome, b.consecutiveUnprofitableYears, b.dateOfLastIncome]),
                p: empire.pirateRelations?.count ?? 0,
            });
        const before = snap();
        computeEconomyBreakdown(galaxy, empire);
        computeEconomyBreakdown(galaxy, empire);
        expect(snap()).toBe(before);
    });
});
