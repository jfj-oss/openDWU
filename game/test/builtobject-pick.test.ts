// Task 13d: unit tests for the built-object pick helpers
// (src/render/builtObjectLayer.ts). No jsdom — fakes are cast to the sim types.
import { describe, expect, it } from 'vitest';
import {
    builtObjectHiddenFromPick,
    builtObjectPickRadiusPx,
    pickBuiltObjectBySize,
    pickNearestBuiltObject,
    warEmpires,
} from '../src/render/builtObjectLayer';
import type { BuiltObject } from '../src/sim/builtObject';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { DiplomaticRelationType } from '../src/sim/diplomacy';
import type { Empire } from '../src/sim/empire';
import type { SystemInfo } from '../src/sim/types';

describe('builtObjectPickRadiusPx', () => {
    it('matches the original num2 formula (num2 * f, num2 = 10 scaled by f)', () => {
        // f < 400: num2 = trunc(10 * sqrt(400/f)); f > 4000: num2 = trunc(num2 / (f/4000)); clamp >= 6.
        expect(builtObjectPickRadiusPx(1)).toBe(200); // num2 = trunc(10*20) = 200 -> 200*1
        expect(builtObjectPickRadiusPx(100)).toBe(2000); // num2 = trunc(10*2) = 20 -> 20*100
        expect(builtObjectPickRadiusPx(300)).toBe(3300); // num2 = trunc(10*sqrt(400/300)) = 11 -> 11*300
        expect(builtObjectPickRadiusPx(400)).toBe(4000); // num2 = 10 -> 10*400
        expect(builtObjectPickRadiusPx(2000)).toBe(20000); // num2 = 10 -> 10*2000
        expect(builtObjectPickRadiusPx(5000)).toBe(40000); // f > 4000: num2 = trunc(10 / (5000/4000)) = 8 -> 8*5000
        expect(builtObjectPickRadiusPx(8000)).toBe(48000); // num2 = trunc(10/2) = 5 -> clamped to 6 -> 6*8000
    });
});

describe('pickBuiltObjectBySize', () => {
    const big = { xpos: 1000, ypos: 1000, size: 500 } as unknown as BuiltObject;
    const small = { xpos: 1000, ypos: 1000, size: 100 } as unknown as BuiltObject;
    const ghost = { xpos: 1000, ypos: 1000, size: 1 } as unknown as BuiltObject;
    const sizePx = (b: BuiltObject): number => (b === big ? 40 : b === small ? 10 : 0);
    const list = [big, small, ghost];

    it('the smallest drawn object whose rect contains the point wins', () => {
        // Both rects contain (1005, 1000); ghost (px 0) is skipped.
        expect(pickBuiltObjectBySize(list, 1005, 1000, 2, sizePx)).toBe(small);
    });

    it('outside the small rect but inside the big one picks the big', () => {
        // big: w = trunc(40*2) = 80, half = 40, pad = 2 -> 958..1042.
        // small: w = 20, half = 10 -> 988..1012.
        expect(pickBuiltObjectBySize(list, 1030, 1000, 2, sizePx)).toBe(big);
    });

    it('just outside every rect picks nothing', () => {
        expect(pickBuiltObjectBySize(list, 1043, 1000, 2, sizePx)).toBeNull();
        expect(pickBuiltObjectBySize(list, 1100, 1000, 2, sizePx)).toBeNull();
    });
});

describe('pickNearestBuiltObject', () => {
    const a = { xpos: 1500, ypos: 0 } as unknown as BuiltObject;
    const b = { xpos: 1900, ypos: 0 } as unknown as BuiltObject;
    const c = { xpos: 2500, ypos: 0 } as unknown as BuiltObject;

    it('picks the nearest within the radius (f = 200, limit 2000)', () => {
        expect(pickNearestBuiltObject([a, b], 0, 0, 200, () => false)).toBe(a);
    });

    it('skips hidden objects', () => {
        expect(pickNearestBuiltObject([a, b], 0, 0, 200, (bo) => bo === a)).toBe(b);
    });

    it('returns null when nothing is in range', () => {
        expect(pickNearestBuiltObject([c], 0, 0, 200, () => false)).toBeNull();
    });
});

describe('warEmpires', () => {
    it('collects the other empire of every War relation', () => {
        const A = {} as Empire;
        const B = {} as Empire;
        const relations = [
            { type: DiplomaticRelationType.War, otherEmpire: A },
            { type: DiplomaticRelationType.None, otherEmpire: B },
            { type: DiplomaticRelationType.War, otherEmpire: null },
        ];
        expect(warEmpires(relations)).toEqual([A]);
    });
});

describe('builtObjectHiddenFromPick', () => {
    const D = {} as Empire;
    const E = {} as Empire;
    const systems = [
        { dominantEmpire: { empire: D, colonyCount: 1, totalStrategicValue: 1 } } as unknown as SystemInfo,
        { dominantEmpire: null } as unknown as SystemInfo,
    ];
    const freighter = {
        subRole: BuiltObjectSubRole.SmallFreighter,
        empire: E,
        nearestSystemStar: { systemIndex: 0 } as never,
    } as unknown as BuiltObject;

    it('hides a ship in a colonized system unless pirate/war/spaceport', () => {
        expect(builtObjectHiddenFromPick(freighter, systems, [], [])).toBe(true);
        expect(builtObjectHiddenFromPick(freighter, systems, [], [E])).toBe(false);
        expect(builtObjectHiddenFromPick(freighter, systems, [E], [])).toBe(false);
    });

    it('never hides space ports', () => {
        const port = { ...freighter, subRole: BuiltObjectSubRole.SmallSpacePort } as unknown as BuiltObject;
        expect(builtObjectHiddenFromPick(port, systems, [], [])).toBe(false);
    });

    it('only hides ships in colonized systems', () => {
        const uncolonized = { ...freighter, nearestSystemStar: { systemIndex: 1 } as never } as unknown as BuiltObject;
        expect(builtObjectHiddenFromPick(uncolonized, systems, [], [])).toBe(false);
        const noStar = { ...freighter, nearestSystemStar: null } as unknown as BuiltObject;
        expect(builtObjectHiddenFromPick(noStar, systems, [], [])).toBe(false);
    });
});