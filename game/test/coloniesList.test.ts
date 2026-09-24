import { describe, expect, it } from 'vitest';
import { colonyRows } from '../src/ui/screens/coloniesList';
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
});