// M4f — civilian mission AI (src/sim/civilianAI.ts, missions/cmdReassign.ts). Unit checks of the ported C# helpers
// against hand-worked expectations, the game-start AssignMissionsToBuiltObjectList (Start.2.cs 1373) on a createGame
// galaxy (seed 1), and a harness smoke run.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createTickGame } from './helpers/tickGame';
import type { Galaxy } from '../src/sim/galaxy';
import type { GameData } from '../src/sim/data/gameData';
import { HabitatCategoryType, HabitatType, Habitat } from '../src/sim/types';
import { BuiltObjectMissionType, builtObjectMission } from '../src/sim/missions/mission';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { runGameSeconds } from '../src/sim/tick/harness';
import { SECTOR_SIZE } from '../src/sim/logistics/orders';
import type { BuiltObject } from '../src/sim/builtObject';
import {
    PrioritizedTarget,
    acceptsPopulation,
    assignMissionToBuiltObject,
    determineFuelRequired,
    fastFindNearestUnexploredHabitat,
    habitatCompareTo,
    hasPopulationToResettle,
    prioritizedTargetListAdd,
    resolveSector,
    sortPrioritizedTargets,
} from '../src/sim/civilianAI';

let gameData: GameData;
let galaxy: Galaxy;

beforeAll(async () => {
    gameData = await loadGameDataFs();
    galaxy = createTickGame(gameData).galaxy;
}, 300000);

function missionType(bo: BuiltObject): BuiltObjectMissionType {
    const m = builtObjectMission(bo.mission);
    return m === null ? BuiltObjectMissionType.Undefined : m.type;
}

describe('PrioritizedTarget (PrioritizedTarget.cs / PrioritizedTargetList.cs)', () => {
    it('weighted priority follows Priority / LocationStrength (int division) and the distance factor', () => {
        const h = new Habitat(HabitatCategoryType.Planet, HabitatType.Continental, 'p', 10, 20);
        const t = new PrioritizedTarget(h, 7);
        expect(t.target).toBe(h);
        expect(t.weightedPriority).toBe(7);
        expect(t.resolveTargetCoordinates()).toEqual({ x: 10, y: 20 });
        // LocationStrength setter: CalculateWeightedPriority = Max(1, (int)(7 / (Max(1e9, 100000^1.8) / 1e9))) — the
        // distance factor is 1 up to floating-point (Math.Pow(100000, 1.8) is 1e9 + 1 ulp), so the value is 6 or 7.
        t.locationStrength = 3;
        expect(t.weightedPriority).toBe(Math.max(1, Math.trunc(7 / (Math.max(1e9, Math.pow(100000, 1.8)) / 1e9))));
        // Priority setter with LocationStrength > 0: 8 / 3 = 2 (int division).
        t.priority = 8;
        expect(t.weightedPriority).toBe(2);
        // DistanceFromAttackingEmpire setter: 200000^1.8 / 1e9 = 3.4657...; (int)(8 / 3.4657) = 2.
        t.distanceFromAttackingEmpire = 200000.0;
        expect(t.weightedPriority).toBe(2);
        t.distanceFromAttackingEmpire = 1000000.0; // 1e6^1.8 / 1e9 = 63.09 → (int)(8/63.09) = 0 → Max(1, 0) = 1
        expect(t.weightedPriority).toBe(1);
    });

    it('Add skips a duplicate Target; Sort orders by WeightedPriority ascending', () => {
        const a = new Habitat(HabitatCategoryType.Planet, HabitatType.Ocean, 'a', 0, 0);
        const b = new Habitat(HabitatCategoryType.Planet, HabitatType.Desert, 'b', 0, 0);
        const list: PrioritizedTarget[] = [];
        prioritizedTargetListAdd(list, new PrioritizedTarget(a, 5));
        prioritizedTargetListAdd(list, new PrioritizedTarget(b, 9));
        prioritizedTargetListAdd(list, new PrioritizedTarget(a, 1));
        expect(list.length).toBe(2);
        sortPrioritizedTargets(list);
        expect(list.map((t) => t.priority)).toEqual([5, 9]);
        list.reverse();
        expect(list[0].target).toBe(b);
    });
});

describe('helpers', () => {
    it('resolveSector: (int)(x / SectorSize) clamped to the sector grid (Galaxy.7.cs 1532 + CorrectSectorCoords)', () => {
        expect(resolveSector(galaxy, SECTOR_SIZE * 2.5, SECTOR_SIZE * 1.999)).toEqual({ x: 2, y: 1 });
        expect(resolveSector(galaxy, -5, -5)).toEqual({ x: 0, y: 0 });
        const far = resolveSector(galaxy, SECTOR_SIZE * 1000, SECTOR_SIZE * 1000);
        expect(far).toEqual({ x: galaxy.sectorWidth - 1, y: galaxy.sectorHeight - 1 });
    });

    it('habitatCompareTo: StrategicValue first, then TotalAmount only when both are populated (Habitat.cs 8023)', () => {
        const a = new Habitat(HabitatCategoryType.Planet, HabitatType.Continental, 'a', 0, 0);
        const b = new Habitat(HabitatCategoryType.Planet, HabitatType.Continental, 'b', 0, 0);
        expect(habitatCompareTo(a, b)).toBe(0);
        const capital = galaxy.empires[0].capital!;
        const other = galaxy.empires[1].capital!;
        // Two colonies of the same strategic value compare by population; the ordering is antisymmetric.
        expect(habitatCompareTo(capital, other)).toBe(-habitatCompareTo(other, capital));
    });

    it('acceptsPopulation / hasPopulationToResettle (Habitat.cs 5624 / 5658)', () => {
        const empire = galaxy.empires[0];
        const race = empire.dominantRace!;
        const h = new Habitat(HabitatCategoryType.Planet, HabitatType.Continental, 'h', 0, 0);
        expect(acceptsPopulation(galaxy, h, empire, race)).toBe(false); // Empire == null
        h.empire = galaxy.independentEmpire;
        expect(acceptsPopulation(galaxy, h, empire, race)).toBe(true); // independent colonies accept everyone
        h.empire = empire;
        expect(acceptsPopulation(galaxy, h, empire, race)).toBe(true); // same race as the owner's dominant race
        expect(acceptsPopulation(galaxy, h, null, race)).toBe(false);
        // No Resettle policy → nothing to resettle.
        expect(hasPopulationToResettle(empire.capital!).result).toBe(false);
    });

    it('determineFuelRequired returns the ship fuel type with SortTag 1 (BuiltObject.cs 4893, setFuelLevelToZero)', () => {
        const ship = galaxy.empires[0].builtObjects.find((b) => b.fuelType !== null)!;
        expect(determineFuelRequired(ship)).toEqual([{ resourceId: ship.fuelType!.resourceId, sortTag: 1 }]);
    });

    it('assignMissionToBuiltObject returns before any Rnd draw for an ineligible ship (Empire.5.cs 1373)', () => {
        const empire = galaxy.empires[0];
        const before = galaxy.rnd.drawCount;
        assignMissionToBuiltObject(galaxy, empire, null, false, null);
        const busy = empire.builtObjects.find((b) => missionType(b) !== BuiltObjectMissionType.Undefined)!;
        assignMissionToBuiltObject(galaxy, empire, busy, false, null);
        expect(galaxy.rnd.drawCount).toBe(before);
    });

    it('fastFindNearestUnexploredHabitat finds a target for a fresh empire and marks fully known systems (Galaxy.6.cs 4360)', () => {
        const empire = galaxy.empires[0];
        const capital = empire.capital!;
        const h = fastFindNearestUnexploredHabitat(galaxy, capital.xpos, capital.ypos, empire);
        expect(h).not.toBeNull();
        // The returned habitat is not yet resource-known (or a ruin of benefit) for the empire.
        expect(empire.resourceMap.checkResourcesKnown(h!) && h!.ruin === null).toBe(false);
    });
});

describe('game start (Start.2.cs 1373-1374 AssignMissionsToBuiltObjectList) and harness', () => {
    it('createGame assigns missions to idle state and private ships', () => {
        let assigned = 0;
        let explorers = 0;
        for (const empire of galaxy.empires) {
            for (const bo of [...empire.builtObjects, ...empire.privateBuiltObjects]) {
                const t = missionType(bo);
                if (t !== BuiltObjectMissionType.Undefined) assigned++;
                if (bo.subRole === BuiltObjectSubRole.ExplorationShip && (t === BuiltObjectMissionType.Explore || t === BuiltObjectMissionType.Move)) explorers++;
            }
        }
        expect(assigned).toBeGreaterThan(0);
        expect(explorers).toBeGreaterThan(0);
    });

    it('600 game-s: no M4f stub is reached and missions keep being assigned', () => {
        const g = createTickGame(gameData).galaxy;
        const r = runGameSeconds(g, 600);
        expect(Object.keys(r.todoHits).filter((k) => k.startsWith('M4f '))).toEqual([]);
        const types = new Set<BuiltObjectMissionType>();
        for (const empire of g.empires) {
            for (const bo of [...empire.builtObjects, ...empire.privateBuiltObjects]) types.add(missionType(bo));
        }
        types.delete(BuiltObjectMissionType.Undefined);
        expect(types.size).toBeGreaterThan(1);
    }, 300000);
});
