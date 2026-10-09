import { describe, expect, it } from 'vitest';
import { Container } from 'pixi.js';
import { addRingBelowBodies } from '../src/render/mainView';
import { selectedTravelVectorFor } from '../src/render/overlayLayer';
import type { BuiltObject } from '../src/sim/builtObject';
import type { Empire } from '../src/sim/empire';
import type { ShipGroup } from '../src/sim/fleets/shipGroup';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';

describe('orbit rings under bodies', () => {
    it('moon rings added after the bodies container still sit below it (and after the planet ring)', () => {
        const root = new Container();
        const ring = new Container();
        const bodies = new Container();
        root.addChild(ring);
        root.addChild(bodies);
        const m1 = new Container();
        const m2 = new Container();
        addRingBelowBodies(root, m1, bodies);
        addRingBelowBodies(root, m2, bodies);
        const idx = (c: Container): number => root.getChildIndex(c);
        expect(idx(ring)).toBeLessThan(idx(bodies));
        expect(idx(m1)).toBeLessThan(idx(bodies));
        expect(idx(m2)).toBeLessThan(idx(bodies));
        expect(idx(bodies)).toBe(root.children.length - 1);
    });
});

const player = {} as unknown as Empire;
function ship(extra: Record<string, unknown> = {}): BuiltObject {
    return {
        xpos: 0, ypos: 0, hasBeenDestroyed: false, role: BuiltObjectRole.Military, topSpeed: 20, warpSpeed: 3000,
        currentSpeed: 3000, hyperjumpPrepare: false, owner: player, actualEmpire: player, shipGroup: null,
        parentBuiltObject: null, parentHabitat: null,
        mission: { type: 1, fastPeekCurrentCommand: () => null, resolveTargetCoordinatesCurrentCommand: () => ({ x: 50000, y: 0 }) },
        ...extra,
    } as unknown as BuiltObject;
}

describe('selectedTravelVectorFor (MainView.2.cs method_250 selected block)', () => {
    it('a moving selected ship of the player has a vector', () => {
        expect(selectedTravelVectorFor({ builtObject: ship() }, player, 100)).toMatchObject({ x2: 50000 });
    });
    it('a selected fleet uses its lead ship', () => {
        const lead = ship();
        expect(selectedTravelVectorFor({ shipGroup: { leadShip: lead } as unknown as ShipGroup }, player, 100)?.builtObject).toBe(lead);
    });
    it.each([
        ['nothing selected', null],
        ['another empire', { builtObject: ship({ actualEmpire: {} }) }],
        ['a base', { builtObject: ship({ role: BuiltObjectRole.Base }) }],
        ['a parked ship', { builtObject: ship({ currentSpeed: 10 }) }],
        ['no mission', { builtObject: ship({ mission: null }) }],
    ])('no vector for %s', (_n, sel) => {
        expect(selectedTravelVectorFor(sel as never, player, 100)).toBeNull();
    });
    it('only above zoom factor 0.9 and past the length gate', () => {
        expect(selectedTravelVectorFor({ builtObject: ship() }, player, 0.9)).toBeNull();
        expect(selectedTravelVectorFor({ builtObject: ship({ mission: { type: 1, fastPeekCurrentCommand: () => null, resolveTargetCoordinatesCurrentCommand: () => ({ x: 5, y: 0 }) } }) }, player, 100)).toBeNull();
    });
});
