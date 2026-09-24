import { describe, expect, it } from 'vitest';
import { empireSummaryRows, type EmpireSummarySource } from '../src/ui/screens/empireSummary';
import type { Empire } from '../src/sim/empire';
import type { Habitat } from '../src/sim/types';

// The panel's DOM needs a browser (jsdom is not configured), so this tests
// only the pure row logic: order, labels, population sum and missing values.

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

describe('empireSummaryRows (task 12j)', () => {
    it('returns the rows in the original order with matching labels', () => {
        const src: EmpireSummarySource = {
            empire: {
                name: 'The Republic',
                dominantRace: { name: 'Human' },
                capital: colony('Home'),
                colonies: [colony('Home', 1_000_000)],
                stateMoney: 641_607,
            } as unknown as Empire,
            governmentName: 'Democracy',
        };
        const rows = empireSummaryRows(src);
        expect(rows.map((r) => r.label)).toEqual([
            'Empire',
            'Race',
            'Government',
            'Capital',
            'Colonies',
            'Population',
            'Treasury',
        ]);
        expect(rows.map((r) => r.value)).toEqual([
            'The Republic',
            'Human',
            'Democracy',
            'Home',
            '1',
            '1M',
            '641,607',
        ]);
    });

    it('sums colony populations (missing population counts as 0)', () => {
        const src: EmpireSummarySource = {
            empire: {
                name: 'X',
                dominantRace: null,
                capital: null,
                colonies: [colony('A', 350_000_000), colony('B'), colony('C', 50_000_000)],
                stateMoney: 0,
            } as unknown as Empire,
            governmentName: null,
        };
        const rows = empireSummaryRows(src);
        expect(rows.find((r) => r.label === 'Population')?.value).toBe('400M');
    });

    it("shows '—' for a missing race, government and capital", () => {
        const src: EmpireSummarySource = {
            empire: {
                name: 'Nomads',
                dominantRace: null,
                capital: null,
                colonies: [],
                stateMoney: 0,
            } as unknown as Empire,
            governmentName: null,
        };
        const rows = empireSummaryRows(src);
        expect(rows.find((r) => r.label === 'Race')?.value).toBe('—');
        expect(rows.find((r) => r.label === 'Government')?.value).toBe('—');
        expect(rows.find((r) => r.label === 'Capital')?.value).toBe('—');
    });
});