import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { Random } from '../src/sim/random';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { ComponentCategoryType } from '../src/sim/data/policies';
import { parseDesignNames } from '../src/sim/data/designNames';
import { DesignNameState, DesignNameContext, generateDesignName, romanNumeral } from '../src/sim/designNames';
import type { Galaxy } from '../src/sim/galaxy';

const designNamesText = fs.readFileSync(
    path.join(__dirname, '../public/assets/dwu/designNames.txt'),
    'utf8',
);
const designNames = parseDesignNames(designNamesText);

// Minimal Galaxy stand-in: generateDesignName only reads `rnd` (and
// reassigns it in the wall-clock reseed fallback, never exercised here).
function makeGalaxy(seed: number): Galaxy {
    return { rnd: new Random(seed) } as unknown as Galaxy;
}

function makeCtx(overrides: Partial<DesignNameContext> = {}): DesignNameContext {
    return {
        designNamesIndex: 0,
        designNames,
        existingDesigns: [],
        latestReactorComponentId: 1,
        ...overrides,
    };
}

describe('parseDesignNames', () => {
    it('parses all 14 families from the shipped designNames.txt', () => {
        expect(designNames.length).toBe(14);
        expect(designNames[0][0]).toBe('Excelsior');
        expect(designNames[13][designNames[13].length - 1]).toBe('Sanggau');
    });

    it('skips comment and blank lines, trims tokens', () => {
        const families = parseDesignNames(
            "'comment\n\n  \nAlpha, Beta ,  Gamma\n'another comment\nDelta,Epsilon\n" +
            'F3,F4\nF5,F6\nF7,F8\nF9,F10\nF11,F12\nF13,F14\nF15,F16\nF17,F18\nF19,F20\nF21,F22\nF23,F24\nF25,F26\n',
        );
        expect(families[0]).toEqual(['Alpha', 'Beta', 'Gamma']);
        expect(families[1]).toEqual(['Delta', 'Epsilon']);
        expect(families.length).toBe(14);
    });

    it('throws if a non-comment line has no names', () => {
        expect(() => parseDesignNames(',  ,\nA,B\n')).toThrow(/No design names/);
    });

    it('throws if fewer than 14 families are present', () => {
        expect(() => parseDesignNames('A,B\nC,D\n')).toThrow(/at least 14/);
    });
});

describe('romanNumeral', () => {
    it.each([
        [1, 'I'],
        [2, 'II'],
        [3, 'III'],
        [4, 'IV'],
        [5, 'V'],
        [9, 'IX'],
        [14, 'XIV'],
        [40, 'XL'],
        [49, 'XLIX'],
        [90, 'XC'],
        [400, 'CD'],
        [944, 'CMXLIV'],
        [1994, 'MCMXCIV'],
        [3999, 'MMMCMXCIX'],
        [10000, 'MMMMMMMMMM'],
    ])('romanNumeral(%i) === %s', (n, expected) => {
        expect(romanNumeral(n)).toBe(expected);
    });

    it('returns "[.]" for out-of-range input', () => {
        expect(romanNumeral(-1)).toBe('[.]');
        expect(romanNumeral(10001)).toBe('[.]');
    });
});

describe('generateDesignName (Escort)', () => {
    it('first call (previousDesign null) is deterministic for a fixed seed', () => {
        // previousDesign === null => flag = true (Empire.cs:3213-3216), AND
        // the prefix starts empty, so BOTH the empty-prefix branch and the
        // flag branch fire: getNewProperDesignName is called twice
        // (Empire.cs:3232-3241), the second draw's outcome depending on
        // per-slot usage counts left by the first -- so re-deriving the
        // expected name requires running the same state machine, not just
        // replaying two blind Rnd draws. We instead assert determinism
        // (same seed -> same result, run twice independently) and that the
        // result is one of family 0's names.
        const run = () => {
            const galaxy = makeGalaxy(12345);
            const state = new DesignNameState();
            const ctx = makeCtx();
            const name = generateDesignName(galaxy, state, ctx, BuiltObjectSubRole.Escort, null);
            return { name, model: state.escortCurrentModelNumber };
        };
        const first = run();
        const second = run();
        expect(first.name).toBe(second.name);
        expect(designNames[0]).toContain(first.name);
        expect(first.model).toBe(1);
    });

    it('second call with the same reactor (no previousDesign change signal) yields "<prefix> II"', () => {
        const galaxy = makeGalaxy(999);
        const state = new DesignNameState();
        const ctx = makeCtx();
        const first = generateDesignName(galaxy, state, ctx, BuiltObjectSubRole.Escort, null);
        const previousDesign = {
            components: [{ componentId: 1, category: ComponentCategoryType.Reactor }],
        };
        const second = generateDesignName(galaxy, state, ctx, BuiltObjectSubRole.Escort, previousDesign);
        expect(second).toBe(first + ' II');
        expect(state.escortCurrentModelNumber).toBe(2);
    });

    it('a reactor change resets to a new prefix and model number 1', () => {
        const galaxy = makeGalaxy(999);
        const state = new DesignNameState();
        const ctx = makeCtx();
        generateDesignName(galaxy, state, ctx, BuiltObjectSubRole.Escort, null);
        const previousDesign = {
            components: [{ componentId: 1, category: ComponentCategoryType.Reactor }],
        };
        // Different componentId than ctx.latestReactorComponentId (1) => reactor changed.
        const changedCtx = makeCtx({ latestReactorComponentId: 2 });
        const afterChange = generateDesignName(galaxy, state, changedCtx, BuiltObjectSubRole.Escort, previousDesign);
        expect(state.escortCurrentModelNumber).toBe(1);
        expect(afterChange).toBe(state.escortPrefix);
        expect(afterChange.endsWith(' II')).toBe(false);
    });

    it('Rnd draw count: first call (previousDesign null) calls getNewProperDesignName twice (empty prefix + flag)', () => {
        const seed = 4242;
        const galaxyUnderTest = makeGalaxy(seed);
        const state = new DesignNameState();
        const ctx = makeCtx();
        generateDesignName(galaxyUnderTest, state, ctx, BuiltObjectSubRole.Escort, null);

        // Replay the expected draw sequence on an independently-seeded Random:
        // two calls to next(0, familyLength), one per getNewProperDesignName
        // invocation (empty-prefix branch, then flag branch).
        const replay = new Random(seed);
        const familyLength = designNames[ctx.designNamesIndex].length;
        replay.next(0, familyLength);
        replay.next(0, familyLength);

        // Both streams should now be positioned identically: the next draw
        // from each must agree.
        expect(galaxyUnderTest.rnd.next()).toBe(replay.next());
    });

    it('Rnd draw count: prefix-empty AND reactor-changed calls getNewProperDesignName twice', () => {
        const seed = 777;
        const galaxyUnderTest = makeGalaxy(seed);
        const state = new DesignNameState();
        const ctx = makeCtx();
        const previousDesign = {
            components: [{ componentId: 1, category: ComponentCategoryType.Reactor }],
        };
        // previousDesign is non-null and its reactor differs from
        // ctx.latestReactorComponentId (1 vs 2) => flag = true, AND
        // state.escortPrefix starts empty => both branches fire, so
        // getNewProperDesignName is called twice.
        const changedCtx = makeCtx({ latestReactorComponentId: 2 });
        generateDesignName(galaxyUnderTest, state, changedCtx, BuiltObjectSubRole.Escort, previousDesign);

        const replay = new Random(seed);
        const familyLength = designNames[ctx.designNamesIndex].length;
        replay.next(0, familyLength); // first GetNewProperDesignName call (empty-prefix branch)
        replay.next(0, familyLength); // second GetNewProperDesignName call (flag branch)

        expect(galaxyUnderTest.rnd.next()).toBe(replay.next());
        expect(state.escortCurrentModelNumber).toBe(1);
    });
});
