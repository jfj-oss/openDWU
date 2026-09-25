import { BuiltObjectMissionType, builtObjectMission } from '../src/sim/missions/mission';
import { beforeAll, describe, expect, it } from 'vitest';
import { createGame, type CreateGameOptions } from '../src/sim/game';
import { setGovernmentsStatic, type Empire } from '../src/sim/empire';
import { GalaxyShape } from '../src/sim/types';
import { BuiltObject } from '../src/sim/builtObject';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { TroopType } from '../src/sim/cargo';
import { createPrivateShips, createStateShips, fillShipsWithTroops, generateNewTroop } from '../src/sim/builtObjectPlacement';
import { MOVEMENT_DECELERATION_RANGE, type Galaxy } from '../src/sim/galaxy';
import { findNearestPirateFaction } from '../src/sim/pirates';
import { startStarDateForAge } from '../src/sim/galaxyTime';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import type { GameData } from '../src/sim/data/gameData';

// Task M3c — Galaxy.8.cs CreateStateShips / CreatePrivateShips / FillShipsWithTroops,
// Empire.7.cs AddBuiltObjectToGalaxy, Galaxy.4.cs GenerateBuiltObjectName, Galaxy.7.cs
// FindNearestBuiltObject. createGame runs them (Start.2.cs 1365-1375); the outcome tests read
// createGame's result, recording the pre-ship state through the test-only __phaseHook.
let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
    setGovernmentsStatic(gameData.governments);
}, 60000);

function opts(): CreateGameOptions {
    const s = (race: string) => ({ race, homeSystemFavourability: 'Normal' as const, proximityDistance: 'Random', startLocation: '(Random)', age: 1, techLevel: 0.5 });
    return {
        seed: 1, shape: GalaxyShape.Spiral, starCount: 300, sectorWidth: 8, sectorHeight: 8,
        systemNames: Array.from({ length: 300 }, (_, i) => `S${i}`), gameData,
        player: s('Human'), aiEmpires: [s('(Random)'), s('(Random)'), s('(Random)')],
    };
}

const S = BuiltObjectSubRole;

interface ShipRecord {
    state: number; // amounts C# builds: state as projected (StartingAge != 0)
    priv: number; // freighters * 0.6
    ships: BuiltObject[]; // the ships the 1365-1375 loop added for this empire
    stateProjectionsAfter: number;
    privateProjectionsAfter: number;
}

/** createGame with the starting ships (Start.2.cs 1365-1375) recorded per empire. */
function buildAll(): { g: Galaxy; expected: Map<Empire, ShipRecord>; ships: BuiltObject[] } {
    const expected = new Map<Empire, ShipRecord>();
    let before = 0;
    let shipsStartIndex = -1;
    let shipsEndIndex = -1;
    const g = createGame({
        ...opts(),
        __phaseHook: (phase, gal, e) => {
            if (phase === 'empireSetup') shipsStartIndex = gal.builtObjects.length;
            if (phase === 'startingShips') shipsEndIndex = gal.builtObjects.length;
            if (phase === 'ships:start') {
                const state = e!.stateForceStructureProjections!.items.reduce((n, p) => n + Math.max(0, p.amount), 0);
                const priv = e!.privateForceStructureProjections!.items.reduce((n, p) => {
                    const a = p.subRole === S.SmallFreighter || p.subRole === S.MediumFreighter || p.subRole === S.LargeFreighter ? Math.trunc(p.amount * 0.6) : p.amount;
                    return n + Math.max(0, a);
                }, 0);
                expected.set(e!, { state, priv, ships: [], stateProjectionsAfter: -1, privateProjectionsAfter: -1 });
                before = gal.builtObjects.length;
            }
            if (phase === 'ships:troops') {
                const rec = expected.get(e!)!;
                rec.ships = gal.builtObjects.slice(before);
                rec.stateProjectionsAfter = e!.stateForceStructureProjections!.count;
                rec.privateProjectionsAfter = e!.privateForceStructureProjections!.count;
            }
        },
    }).galaxy;
    return { g, expected, ships: g.builtObjects.slice(shipsStartIndex, shipsEndIndex) };
}

function summary(g: Galaxy) {
    // Unowned abandoned ships (gameStartTail, Start.2.cs 2011-2012) have no empire.
    return g.builtObjects.map((b) => [b.builtObjectID, b.empire?.name ?? null, S[b.subRole], b.name, b.xpos, b.ypos, b.heading, b.parentHabitat?.name ?? null, b.troops?.items.length ?? -1]);
}

describe('CreateStateShips / CreatePrivateShips at game start (tech 0.5, age 1)', () => {
    it('adds ships to the galaxy and empire lists, parked near a colony, then clears the projections', () => {
        const { g, expected, ships } = buildAll();
        let total = 0;
        for (const e of g.empires) {
            const exp = expected.get(e);
            if (exp === undefined) continue; // pirate factions: no starting ships here
            const own = exp.ships.filter((b) => e.builtObjects.includes(b));
            const priv = exp.ships.filter((b) => e.privateBuiltObjects.includes(b));
            expect(own.length).toBe(exp.state);
            expect(priv.length).toBe(exp.priv);
            expect(own.length + priv.length).toBe(exp.ships.length);
            total += exp.state + exp.priv;
            // State ships are owned; private ships are not.
            for (const b of own) expect(b.owner).toBe(e);
            for (const b of priv) expect(b.owner).toBeNull();
            for (const b of exp.ships) {
                expect(b.empire).toBe(e);
                // M4f: Start.2.cs 1373 AssignMissionsToBuiltObjectList runs right after placement; a ship that got a
                // mission with resolvable commands has its parent cleared (BuiltObjectMission.cs 531-538).
                if (builtObjectMission(b.mission) !== null && builtObjectMission(b.mission)!.type !== BuiltObjectMissionType.Undefined) continue;
                expect(e.colonies).toContain(b.parentHabitat);
                // SelectRelativeParkingPoint(): distance in [150, 300), truncated to int.
                expect(Number.isInteger(b.parentOffsetX) && Number.isInteger(b.parentOffsetY)).toBe(true);
                const d = Math.hypot(b.parentOffsetX, b.parentOffsetY);
                expect(d).toBeGreaterThanOrEqual(MOVEMENT_DECELERATION_RANGE - 2);
                expect(d).toBeLessThan(2 * MOVEMENT_DECELERATION_RANGE);
                expect(b.xpos).toBe(b.parentHabitat!.xpos + b.parentOffsetX);
                expect(b.ypos).toBe(b.parentHabitat!.ypos + b.parentOffsetY);
                expect(b.nearestSystemStar).toBe(g.determineHabitatSystemStar(b.parentHabitat!));
                expect(b.dateBuilt).toBe(startStarDateForAge(g.age));
                expect(b.currentFuel).toBe(b.fuelCapacity);
                expect(b.targetHeading).toBe(b.heading);
                const c = g.resolveIndex(b.xpos, b.ypos);
                expect(g.builtObjectIndexGrid[c.x][c.y]).toContain(b);
            }
            expect(exp.stateProjectionsAfter).toBe(0);
            expect(exp.privateProjectionsAfter).toBe(0);
        }
        expect(total).toBeGreaterThan(0);
        expect(ships.length).toBe(total);
        // Unique, sequential ids (GetNextBuiltObjectID): the ships loop builds nothing else.
        expect(ships.map((b) => b.builtObjectID)).toEqual(Array.from({ length: total }, (_, i) => ships[0].builtObjectID + i));
        // Design.BuildCount counts every ship/base built from the design (stations included).
        for (const e of g.empires) {
            if (!expected.has(e)) continue;
            for (const d of e.designs) {
                const n = [...e.builtObjects, ...e.privateBuiltObjects].filter((b) => b.design === d).length;
                expect(d.buildCount).toBe(n);
            }
        }
    }, 60000);

    it('names: explorers / construction ships / freighters get unique standard names; pinned for seed 1', () => {
        const { g, expected } = buildAll();
        const player = g.empires[0];
        // SelectRandomUniqueStandardShipName: "<adj> <noun>", "<star> <noun>" or "<noun> of <star>".
        for (const rec of expected.values()) {
            for (const b of rec.ships) {
                expect(b.name).toMatch(/^\S+ \S+$|^\S+ of \S+$/);
                expect(b.name).not.toMatch(/ \d{3}$/);
            }
        }
        const ships = expected.get(player)!.ships;
        const own = ships.filter((b) => player.builtObjects.includes(b));
        const priv = ships.filter((b) => player.privateBuiltObjects.includes(b));
        // Pinned for seed 1 (TS port; PINNED_NAMES below).
        expect(own.slice(0, 9).map((b) => [S[b.subRole], b.name])).toEqual(PINNED_NAMES);
        expect(own.map((b) => S[b.subRole])).toEqual([...Array(7).fill('ExplorationShip'), ...Array(3).fill('ConstructionShip')]);
        expect(priv.map((b) => S[b.subRole])).toEqual(['SmallFreighter', 'GasMiningShip', 'GasMiningShip', 'MiningShip', 'MiningShip']);
    }, 60000);

    it('is deterministic', () => {
        expect(summary(buildAll().g)).toEqual(summary(buildAll().g));
    }, 120000);

    it('Rnd sequence per ship: name, heading, parking point, colony, name (Galaxy.8.cs 939-953)', () => {
        // State just before the player's CreateStateShips (Start.2.cs 1369).
        const g = createGame({ ...opts(), __phaseHook: (phase) => (phase === 'ships:start' ? 'stop' : undefined) }).galaxy;
        const e = g.empires[0];
        const calls: string[] = [];
        const next = g.rnd.next.bind(g.rnd) as (...a: number[]) => number;
        const nextDouble = g.rnd.nextDouble.bind(g.rnd);
        g.rnd.next = (...a: number[]) => { calls.push(`next(${a.join(',')})`); return next(...a); };
        g.rnd.nextDouble = () => { calls.push('nextDouble'); return nextDouble(); };
        createStateShips(g, e);
        expect(calls.slice(0, 11)).toEqual([
            'next(0,127)', 'next(0,125)', 'next(0,7)', // GenerateBuiltObjectName(design) — standard ship name
            'nextDouble', // SelectRandomHeading
            'nextDouble', 'next(0,2)', 'nextDouble', // SelectRelativeParkingPoint
            'next(0,1)', // SelectRandomColony
            'next(0,127)', 'next(0,125)', 'next(0,7)', // GenerateBuiltObjectName(design, habitat)
        ]);
    }, 60000);
});

describe('GenerateBuiltObjectName formats (Galaxy.4.cs 2371)', () => {
    it('escort / frigate / destroyer / troop transport: "<design> 001"; first cruiser: design name', () => {
        const g = createGame(opts()).galaxy;
        const e = g.empires[0];
        let checked = 0;
        for (const sr of [S.Escort, S.Frigate, S.Destroyer, S.TroopTransport]) {
            const d = e.designs.find((x) => x.subRole === sr);
            if (!d) continue;
            checked++;
            d.buildCount = 1;
            expect(g.generateBuiltObjectName(d)).toBe(`${d.name} 001`);
            d.buildCount = 12;
            expect(g.generateBuiltObjectName(d)).toBe(`${d.name} 012`);
            // uniqueNamesForSmallMilitaryShips → SelectRandomUniqueMilitaryShipName.
            expect(g.generateBuiltObjectName(d, null, true)).toMatch(/^\S+ \S+$/);
        }
        expect(checked).toBeGreaterThan(0);
        const cruiser = e.designs.find((x) => x.subRole === S.Cruiser);
        if (cruiser) {
            cruiser.buildCount = 1;
            expect(g.generateBuiltObjectName(cruiser)).toBe(cruiser.name);
            cruiser.buildCount = 2;
            expect(g.generateBuiltObjectName(cruiser)).not.toBe(cruiser.name);
        }
    }, 60000);
});

describe('FillShipsWithTroops / GenerateNewTroop', () => {
    it('fills a troop transport with infantry named "<n>th <TroopName>"', () => {
        const g = createGame(opts()).galaxy;
        const e = g.empires[0];
        const d = e.designs.find((x) => x.subRole === S.TroopTransport)!;
        expect(d).toBeTruthy();
        const bo = new BuiltObject(d, 'T', g, true);
        bo.reDefine();
        e.addBuiltObjectToGalaxy(bo, e.colonies[0], false, true, 200, 0, false);
        expect(bo.troopCapacity).toBeGreaterThan(0);
        expect(bo.parentOffsetX).toBe(200);
        // Force the transport's Rnd.Next(1, 9) to 1 (num = 100) so it is filled completely;
        // the other ships' draws pass through.
        const next = g.rnd.next.bind(g.rnd) as (...a: number[]) => number;
        let draw = -1;
        g.rnd.next = (...a: number[]) => {
            const v = next(...a);
            if (a[0] === 1 && a[1] === 9) { draw = v; return 1; }
            return v;
        };
        // Re-pinned by M4j: GenerateEmpire's Empire.DoTasks now runs EvaluateColonyVariables with recruitment, which
        // can queue troops (and advance the empire's troop-name counter) before the transport is filled.
        const before = e.troopCount;
        const ord = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th'}`;
        fillShipsWithTroops(g, e);
        expect(draw).toBeGreaterThanOrEqual(1);
        const troops = bo.troops!.items;
        // While TroopCapacityRemaining >= 100 (max 50 iterations): one 100-size troop each.
        expect(troops.length).toBe(Math.min(50, Math.trunc(bo.troopCapacity / 100)));
        expect(bo.troops!.totalSize).toBeLessThanOrEqual(bo.troopCapacity);
        expect(troops[0].name).toBe(`${ord(before + 1)} ${e.dominantRace!.troopName}`);
        if (troops.length > 1) expect(troops[1].name).toBe(`${ord(before + 2)} ${e.dominantRace!.troopName}`);
        for (const t of troops) {
            expect(t.type).toBe(TroopType.Infantry);
            expect(t.builtObject).toBe(bo);
            expect(t.atColony).toBe(false);
            expect(t.size).toBe(100);
            expect(e.troops.items).toContain(t);
        }
    }, 60000);

    it('GenerateNewTroop strengths / sizes per type (no bonus factors)', () => {
        const armored = generateNewTroop('a', TroopType.Armored, 100, null, null);
        expect([armored.attackStrength, armored.defendStrength, armored.size, armored.maintenanceMultiplier]).toEqual([300, 150, 200, 2]);
        const art = generateNewTroop('b', TroopType.Artillery, 100, null, null);
        expect([art.attackStrength, art.defendStrength, art.size, art.maintenanceMultiplier]).toEqual([50, 75, 400, 4]);
        const sf = generateNewTroop('c', TroopType.SpecialForces, 100, null, null);
        expect([sf.attackStrength, sf.defendStrength, sf.size, sf.maintenanceMultiplier]).toEqual([200, 100, 100, 2]);
    });
});

describe('FindNearestBuiltObject / FindNearestPirateFaction', () => {
    it('ring search over BuiltObjectIndex', () => {
        const { g, ships } = buildAll();
        const b = ships[5];
        const dist = (o: BuiltObject, x: number, y: number) => Math.hypot(o.xpos - x, o.ypos - y);
        const bruteNearest = (x: number, y: number, pred: (o: BuiltObject) => boolean) => {
            let best: BuiltObject | null = null;
            for (const o of g.builtObjects) if (pred(o) && (best === null || dist(o, x, y) < dist(best, x, y))) best = o;
            return best;
        };
        expect(g.findNearestBuiltObject(b.xpos, b.ypos)).toBe(b);
        // Bases (space ports / research / mining stations) exist after the per-empire setup.
        expect(g.findNearestBuiltObject(b.xpos, b.ypos, BuiltObjectRole.Base)).toBe(bruteNearest(b.xpos, b.ypos, (o) => o.role === BuiltObjectRole.Base));
        expect(g.findNearestBuiltObjectOfEmpire(b.xpos, b.ypos, b.empire)).toBe(b);
        expect(g.findNearestBuiltObjectOfSubRole(b.xpos, b.ypos, b.subRole, true)).toBe(b);
        expect(g.findNearestBuiltObjectOfEmpireSubRole(b.xpos, b.ypos, b.empire, b.subRole, true)).toBe(b);
        // Brute-force check from a far point.
        const x = 1000, y = 1000;
        expect(g.findNearestBuiltObject(x, y)).toBe(bruteNearest(x, y, () => true));
    }, 60000);

    it('pirate faction needs a base BuiltObject', () => {
        const { g } = buildAll();
        expect(findNearestPirateFaction(g, 0, 0, null, true)).toBeNull();
    }, 60000);
});

// Pinned for seed 1 (TS port). (re-pinned: createGame now runs the price reviews, the first
// galaxy tick (independent traders) and the per-empire station/tax setup before the player's
// CreateStateShips, so the name draws come later in the Rnd stream.)
// (re-pinned M4k: the game-start Empire.DoTasks now runs PerformResearch — SelectNextResearchProject draws
// Rnd (SelectRandomLowestProject) and research events draw Next(0, num4) per industry — so later game-start
// Rnd draws shift.)
// Re-pinned M4s1: ReviewPirateRelations (Empire.2.cs 2427) draws one Rnd.NextDouble in every Empire long block,
// including the game-start Empire.DoTasks of each generated empire, and the Galaxy long block's independent-colony
// pirate offers draw per colony, so the stream reaching CreateStateShips moved.
// (re-pinned after M4s1 (ReviewPirateRelations NextDouble per Empire long block; independent-colony pirate offers) and the SelectCreatures population gating fix (Galaxy.5.cs 1648/1785))
// Re-pinned by M4u: the game-start Empire.DoTasks now runs the character reviews (ReviewCharacterTraits Rnd) and
// ReviewEmpireEvents (DoRaceEvent Rnd), moving every later draw.
// (re-pinned M4q: InvadeUnwillingColonizationTargets draws Rnd.NextDouble in each game-start Empire.DoTasks)
const PINNED_NAMES: unknown[] = [
    [
        "ExplorationShip",
        "Ranger of Sol"
    ],
    [
        "ExplorationShip",
        "Humble Starseeker"
    ],
    [
        "ExplorationShip",
        "Noble Pathway"
    ],
    [
        "ExplorationShip",
        "Sol Orbit"
    ],
    [
        "ExplorationShip",
        "Adamant Decoy"
    ],
    [
        "ExplorationShip",
        "Renegade of Sol"
    ],
    [
        "ExplorationShip",
        "Cheerful Bargain"
    ],
    [
        "ConstructionShip",
        "Lively Echo"
    ],
    [
        "ConstructionShip",
        "Sol Rogue"
    ]
];
