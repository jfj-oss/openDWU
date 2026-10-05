// The selection panel's retrofit percentage (selectionInfo.ts retrofitProgressPercent; not in the original).
import { describe, expect, it } from 'vitest';
import { retrofitProgressPercent } from '../src/ui/selectionInfo';
import type { BuiltObject } from '../src/sim/builtObject';

const comp = (id: number) => ({ componentId: id }) as never;

function ship(yardLists: { build: unknown[] | null; scrap: unknown[] | null } | null): BuiltObject {
    const bo = {
        design: { components: [comp(1), comp(2), comp(3)] },
        retrofitDesign: { name: 'Mk2', components: [comp(1), comp(4), comp(5)] },
        builtAt: null as unknown,
    };
    const yard = yardLists === null ? null : { shipUnderConstruction: bo, retrofitComponentsToBeBuilt: yardLists.build, retrofitComponentsToBeScrapped: yardLists.scrap };
    bo.builtAt = { constructionQueue: { constructionYards: yard === null ? [] : [yard] } };
    return bo as unknown as BuiltObject;
}

describe('retrofitProgressPercent', () => {
    it('is -1 while waiting for a yard, 0 before the yard starts, and counts built then scrapped components', () => {
        // Old 1,2,3 -> new 1,4,5: build 4 and 5, scrap 2 and 3 (4 steps).
        expect(retrofitProgressPercent(ship(null))).toBe(-1);
        expect(retrofitProgressPercent(ship({ build: null, scrap: null }))).toBe(0);
        expect(retrofitProgressPercent(ship({ build: [comp(5)], scrap: [comp(2), comp(3)] }))).toBe(25);
        expect(retrofitProgressPercent(ship({ build: [], scrap: [comp(3)] }))).toBe(75);
        expect(retrofitProgressPercent(ship({ build: [], scrap: [] }))).toBe(100);
    });
});
