import { describe, expect, it } from 'vitest';
import {
    approvalMood,
    colonyRows,
    formatThousandsK,
    type ColonyMetrics,
} from '../src/ui/screens/coloniesList';
import type { Empire } from '../src/sim/empire';
import type { Habitat } from '../src/sim/types';

// The panel's DOM needs a browser (jsdom is not configured), so this tests
// only the pure row logic: sort order, the capital flag and missing
// populations.

/** A hand-built colony with a fixed population total (0 when omitted). */
function colony(name: string, pop?: number): Habitat {
    const h = {} as Habitat;
    h.name = name;
    if (pop !== undefined) {
        const p = {} as NonNullable<Habitat['population']>;
        p.totalAmount = pop;
        h.population = p;
    }
    return h;
}

function empire(capital: Habitat | null, colonies: Habitat[]): Empire {
    return { capital, colonies } as unknown as Empire;
}

describe('colonyRows (task 12m)', () => {
    it('sorts by population descending', () => {
        const a = colony('Alpha', 50_000);
        const b = colony('Beta', 2_000_000);
        const c = colony('Gamma', 350_000);
        const rows = colonyRows(empire(b, [a, c, b]));
        expect(rows.map((r) => r.name)).toEqual(['Beta', 'Gamma', 'Alpha']);
        expect(rows.map((r) => r.population)).toEqual(['2M', '350K', '50K']);
    });

    it('breaks ties by name', () => {
        const zeta = colony('Zeta', 1_000_000);
        const alpha = colony('Alpha', 1_000_000);
        const rows = colonyRows(empire(null, [zeta, alpha]));
        expect(rows.map((r) => r.name)).toEqual(['Alpha', 'Zeta']);
    });

    it('marks the capital row', () => {
        const home = colony('Home', 10_000_000);
        const other = colony('Outpost', 9_000_000);
        const rows = colonyRows(empire(home, [other, home]));
        expect(rows.find((r) => r.habitat === home)?.isCapital).toBe(true);
        expect(rows.find((r) => r.habitat === other)?.isCapital).toBe(false);
    });

    it('counts a missing population as 0 (it sorts last)', () => {
        const populated = colony('Populated', 1_000);
        const empty = colony('Empty'); // no population list at all
        const rows = colonyRows(empire(populated, [empty, populated]));
        expect(rows.map((r) => r.name)).toEqual(['Populated', 'Empty']);
        expect(rows[1].population).toBe('0');
    });

    it('without metrics: development/gdp are "—" and approval is null; tax/troops default to 0', () => {
        const h = colony('Home', 1_000_000);
        const rows = colonyRows(empire(h, [h]));
        expect(rows[0].development).toBe('—');
        expect(rows[0].approval).toBeNull();
        expect(rows[0].gdp).toBe('—');
        expect(rows[0].tax).toBe('0%');
        expect(rows[0].troops).toBe('0');
    });
});

describe('approvalMood / formatThousandsK (task 13b)', () => {
    it('maps ratings with the ItemListPanel.cs thresholds (>15 happy, >0 neutral, >-15 sad, else angry)', () => {
        expect(approvalMood(16)).toBe('happy');
        expect(approvalMood(15)).toBe('neutral');
        expect(approvalMood(0.1)).toBe('neutral');
        expect(approvalMood(0)).toBe('sad');
        expect(approvalMood(-14.9)).toBe('sad');
        expect(approvalMood(-15)).toBe('angry');
    });

    it('formats like C# .ToString("0,K")', () => {
        expect(formatThousandsK(1234567)).toBe('1235K');
        expect(formatThousandsK(0)).toBe('0K');
    });
});

describe('colonyRows with metrics (task 13b)', () => {
    it('fills development/approval/gdp from the metrics callback and tax/troops from the habitat', () => {
        const h = {} as Habitat;
        h.name = 'Home';
        const p = {} as NonNullable<Habitat['population']>;
        p.totalAmount = 1_000_000;
        h.population = p;
        h.taxRate = 0.25;
        h.troops = { count: 3 } as NonNullable<Habitat['troops']>;
        const metrics = (): ColonyMetrics => ({ development: 37.9, approval: 20, revenue: 45600 });
        const rows = colonyRows({ capital: h, colonies: [h] } as unknown as Empire, metrics);
        expect(rows[0].development).toBe('37%');
        expect(rows[0].approval).toBe('happy');
        expect(rows[0].gdp).toBe('46K');
        expect(rows[0].tax).toBe('25%');
        expect(rows[0].troops).toBe('3');
    });
});