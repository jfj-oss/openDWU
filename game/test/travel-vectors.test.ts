// Task 14c — Travel Vectors (State / Private) overlay pure helpers.

import { describe, expect, it } from 'vitest';
import type { BuiltObject } from '../src/sim/builtObject';
import type { Empire } from '../src/sim/empire';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import {
    SELECTED_TRAVEL_VECTOR_COLOR,
    TRAVEL_VECTOR_COLOR,
    checkShipTravellingToDestination,
    dashSegments,
    fleetTravelVector,
    incomingAttackLine,
    selectedStellarObject,
    shipsMovingToDestination,
    travelVectorFor,
    travelVectorLongEnough,
    travelVectorsFor,
    travelVectorWidthPx,
    TRAVEL_VECTOR_DASH_PX,
    type TravelVector,
} from '../src/render/overlayLayer';
import type { ShipGroup } from '../src/sim/fleets/shipGroup';
import { BuiltObjectMissionType, CommandAction } from '../src/sim/missions/mission';

const player = {} as unknown as Empire;
const other = {} as unknown as Empire;

function ship(extra: Record<string, unknown> = {}): BuiltObject {
    return {
        xpos: 0,
        ypos: 0,
        hasBeenDestroyed: false,
        role: BuiltObjectRole.Military,
        topSpeed: 20,
        warpSpeed: 3000,
        currentSpeed: 3000,
        hyperjumpPrepare: false,
        owner: player,
        actualEmpire: player,
        shipGroup: null,
        parentBuiltObject: null,
        parentHabitat: null,
        mission: { type: 1, fastPeekCurrentCommand: () => null, resolveTargetCoordinatesCurrentCommand: () => ({ x: 50000, y: 0 }) },
        ...extra,
    } as unknown as BuiltObject;
}

const emptyMission = { type: 1, fastPeekCurrentCommand: () => null, resolveTargetCoordinatesCurrentCommand: () => ({ x: 0, y: 0 }) };

function vec(x1: number, y1: number, x2: number, y2: number): TravelVector {
    return { builtObject: ship(), x1, y1, x2, y2 };
}

describe('travelVectorFor', () => {
    it('returns the vector to the current command target', () => {
        expect(travelVectorFor(ship())).toMatchObject({ x1: 0, y1: 0, x2: 50000, y2: 0 });
    });

    it.each([
        ['destroyed', { hasBeenDestroyed: true }],
        ['base', { role: BuiltObjectRole.Base }],
        ['no top speed', { topSpeed: 0 }],
        ['no warp speed', { warpSpeed: 0 }],
        ['not above top speed', { currentSpeed: 20 }],
        ['no mission', { mission: null }],
        ['undefined mission', { mission: { type: 0, fastPeekCurrentCommand: () => null, resolveTargetCoordinatesCurrentCommand: () => ({ x: 50000, y: 0 }) } }],
    ])('returns null when %s', (_name, extra) => {
        expect(travelVectorFor(ship(extra))).toBeNull();
    });

    it('draws while preparing a hyperjump', () => {
        const preparing = { type: 1, fastPeekCurrentCommand: () => ({ action: CommandAction.HyperTo }), resolveTargetCoordinatesCurrentCommand: () => ({ x: 50000, y: 0 }) };
        expect(travelVectorFor(ship({ currentSpeed: 10, hyperjumpPrepare: true, mission: preparing }))).not.toBeNull();
        // A HyperjumpPrepare left over (a jump a Bacon gravity well held back) while the ship holds: not travelling.
        const holding = { ...preparing, fastPeekCurrentCommand: () => ({ action: CommandAction.Hold }) };
        expect(travelVectorFor(ship({ currentSpeed: 10, hyperjumpPrepare: true, mission: holding }))).toBeNull();
    });

    it('falls back to the parent built object, then parent habitat, else draws nothing (not a line to (0, 0))', () => {
        expect(travelVectorFor(ship({ mission: emptyMission, parentBuiltObject: { xpos: 10.9, ypos: 20.2 } }))).toMatchObject({ x2: 10, y2: 20 });
        expect(travelVectorFor(ship({ mission: emptyMission, parentHabitat: { xpos: 7.5, ypos: 8.5 } }))).toMatchObject({ x2: 7, y2: 8 });
        expect(travelVectorFor(ship({ mission: emptyMission }))).toBeNull();
    });
});

describe('travelVectorsFor', () => {
    const a = ship({ owner: player });
    const b = ship({ owner: null });
    const c = ship({ actualEmpire: other, owner: other });
    const d = ship({ currentSpeed: 5 });
    const galaxy = { builtObjects: [a, b, c, d] };
    const objs = (vs: TravelVector[]) => vs.map((v) => v.builtObject);

    it('filters state / private ships of the player', () => {
        expect(objs(travelVectorsFor(galaxy, player, 'state'))).toEqual([a]);
        expect(objs(travelVectorsFor(galaxy, player, 'private'))).toEqual([b]);
        expect(travelVectorsFor(galaxy, null, 'state')).toEqual([]);
    });

    it('leaves fleet ships to the fleet pass (method_258)', () => {
        const grp: { leadShip: BuiltObject | null; empire: Empire } = { leadShip: null, empire: player };
        const lead = ship({ shipGroup: grp });
        const member = ship({ shipGroup: grp });
        grp.leadShip = lead;
        const g = { builtObjects: [lead, member] };
        expect(objs(travelVectorsFor(g, player, 'state'))).toEqual([]);
        expect(objs(travelVectorsFor(g, player, 'private'))).toEqual([]);
    });
});

describe('fleet pass (method_258)', () => {
    it('the lead ship vector, yellow for the selected fleet', () => {
        const lead = ship();
        const sg = { leadShip: lead } as unknown as ShipGroup;
        expect(fleetTravelVector(sg, false)).toMatchObject({ color: TRAVEL_VECTOR_COLOR, v: { builtObject: lead, x2: 50000 } });
        expect(fleetTravelVector(sg, true)?.color).toBe(SELECTED_TRAVEL_VECTOR_COLOR);
        expect(fleetTravelVector({ leadShip: null } as unknown as ShipGroup, false)).toBeNull();
        expect(fleetTravelVector({ leadShip: ship({ currentSpeed: 1 }) } as unknown as ShipGroup, false)).toBeNull();
    });
    it('the incoming-attack line: listed, attacking the viewer', () => {
        const viewer = { incomingEnemyFleetsAndPlanetDestroyers: [] as unknown[] } as unknown as Empire;
        const target = { empire: viewer, xpos: 0, ypos: 0 };
        const mission = { type: BuiltObjectMissionType.Attack, targetBuiltObject: target, targetHabitat: null, targetShipGroup: null, resolveTargetCoordinates: () => ({ x: 7, y: 8 }) };
        const sg = { leadShip: ship(), mission } as unknown as ShipGroup;
        expect(incomingAttackLine(sg, viewer)).toBeNull();
        (viewer.incomingEnemyFleetsAndPlanetDestroyers as unknown[]).push({ fleet: sg });
        expect(incomingAttackLine(sg, viewer)).toEqual({ x: 7, y: 8 });
        mission.type = BuiltObjectMissionType.Move;
        expect(incomingAttackLine(sg, viewer)).toBeNull();
        mission.type = BuiltObjectMissionType.Bombard;
        target.empire = other;
        expect(incomingAttackLine(sg, viewer)).toBeNull();
    });
});

describe('SpecialHighlightBuiltObjects (Empire.6.cs 1165)', () => {
    const dest = { hasBeenDestroyed: false };
    const m = (type: BuiltObjectMissionType, target: unknown, secondaryTarget: unknown = null) => ({ type, target, secondaryTarget });
    it('ships whose mission target (secondary target for Transport) is the destination', () => {
        const a = ship({ mission: m(BuiltObjectMissionType.Move, dest) });
        const b = ship({ mission: m(BuiltObjectMissionType.Transport, dest) });
        const c = ship({ mission: m(BuiltObjectMissionType.Transport, null, dest) });
        const d = ship({ mission: m(BuiltObjectMissionType.Move, null, dest) });
        expect(checkShipTravellingToDestination(a, dest)).toBe(true);
        expect(checkShipTravellingToDestination(b, dest)).toBe(false);
        expect(checkShipTravellingToDestination(c, dest)).toBe(true);
        expect(checkShipTravellingToDestination(d, dest)).toBe(false);
        expect(checkShipTravellingToDestination(a, { hasBeenDestroyed: true })).toBe(false);
        expect([...shipsMovingToDestination({ builtObjects: [a, b], privateBuiltObjects: [c, d] } as never, dest)]).toEqual([a, c]);
    });
    it('only a selected ship / habitat counts as the destination', () => {
        const h = { hasBeenDestroyed: false } as never;
        const bo = ship();
        expect(selectedStellarObject({ habitat: h })).toBe(h);
        expect(selectedStellarObject({ habitat: h, builtObject: bo })).toBe(bo);
        expect(selectedStellarObject({ habitat: h, systemInfo: true })).toBeNull();
        expect(selectedStellarObject({ habitat: h, shipGroup: {} as never })).toBeNull();
        expect(selectedStellarObject({ habitat: h, builtObjects: [bo] })).toBeNull();
        expect(selectedStellarObject(null)).toBeNull();
    });
});

describe('travelVectorLongEnough', () => {
    it('uses the C# 40000 threshold scaled by 1500 / f', () => {
        expect(travelVectorLongEnough(vec(0, 0, 40000, 0), 1500)).toBe(false);
        expect(travelVectorLongEnough(vec(0, 0, 40000, 0), 1000)).toBe(true);
        expect(travelVectorLongEnough(vec(0, 0, 100, 0), 1)).toBe(true);
        expect(travelVectorLongEnough(vec(0, 0, 20, 0), 1)).toBe(false);
    });
});

describe('dashSegments', () => {
    it('splits a line into dashes', () => {
        expect(dashSegments(0, 0, 10, 0, 3, 2)).toEqual([
            [0, 0, 3, 0],
            [5, 0, 8, 0],
        ]);
        expect(dashSegments(0, 0, 9, 0, 3, 2)).toEqual([
            [0, 0, 3, 0],
            [5, 0, 8, 0],
        ]);
        expect(dashSegments(0, 0, 7, 0, 3, 2)).toEqual([
            [0, 0, 3, 0],
            [5, 0, 7, 0],
        ]);
    });

    it('returns nothing for a zero-length line', () => {
        expect(dashSegments(5, 5, 5, 5, 3, 2)).toEqual([]);
    });

    it('caps the dash count', () => {
        const segs = dashSegments(0, 0, 100000, 0, 1, 1, 200);
        expect(segs.length).toBeLessThanOrEqual(200);
        expect(segs.length).toBeGreaterThan(0);
        expect(segs[0][0]).toBe(0);
    });
});

describe('travel vectors within one system (BaconMainView.cs method_253)', () => {
    // A ship warping between two planets of the same system: 60 000 units apart, well inside MaxSolarSystemSize.
    const inSystem = (extra: Record<string, unknown> = {}) =>
        ship({ xpos: 1_000_000, ypos: 1_000_000, mission: { type: 1, fastPeekCurrentCommand: () => null, resolveTargetCoordinatesCurrentCommand: () => ({ x: 1_060_000, y: 1_000_000 }) }, ...extra });
    it('draws the vector for an in-system move at warp speed, at system and sector zoom', () => {
        const v = travelVectorFor(inSystem());
        expect(v).toMatchObject({ x1: 1_000_000, y1: 1_000_000, x2: 1_060_000, y2: 1_000_000 });
        expect(travelVectorLongEnough(v!, 1)).toBe(true);
        expect(travelVectorLongEnough(v!, 100)).toBe(true);
    });
    it('draws none for a sublight in-system move (the original gates on CurrentSpeed > TopSpeed)', () => {
        expect(travelVectorFor(inSystem({ currentSpeed: 20 }))).toBeNull();
    });
    it('is cut once the hop is under ~27 screen px of Manhattan length (the 40000 * f / 1500 gate)', () => {
        expect(travelVectorLongEnough(travelVectorFor(inSystem())!, 2500)).toBe(false);
    });
});

describe('travel vector style (method_252 / XnaDrawingHelper.DrawLine)', () => {
    it('is one device pixel wide with 6 px dashes and gaps', () => {
        expect(travelVectorWidthPx(1)).toBe(1);
        expect(travelVectorWidthPx(2)).toBe(0.5);
        expect(TRAVEL_VECTOR_DASH_PX).toBe(6);
    });
});

import { arrowheadPlacement } from '../src/render/overlayLayer';

describe('travel vector arrowhead (XnaDrawingHelper.cs 587-596)', () => {
    it('sits at the end, pulled back half its height, rotated angle + 90 deg, 9 px wide for a 1 px line', () => {
        const a = arrowheadPlacement(0, 0, 1000, 0, 101, 115, 1, 10);
        expect(a.scale).toBeCloseTo(9 / 101);
        const h = 115 * (9 / 101);
        expect(a.x).toBeCloseTo(1000 - (h / 2) * 10);
        expect(a.y).toBeCloseTo(0);
        expect(a.rotation).toBeCloseTo(Math.PI / 2);
    });
});
