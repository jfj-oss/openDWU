// M4z5 — super pirates & planet-destroyer aftermath: Galaxy.9.cs 208/284 DoSuperPirateTasks, Habitat.cs 6399
// DoPlanetDestroyAsteroidField (+ Galaxy.9.cs 3463 GenerateAsteroidField, Galaxy.6.cs 3714 FindNearestSystemGasCloudAsteroid),
// the BuiltObject.1.cs 3490 DestroyHabitat → Habitat.cs 6341 DoExplosion → DoPlanetRemove chain, and a harness smoke test
// with a super-pirate faction in the galaxy. Expected values are worked by hand from the C#.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createTickGame } from './helpers/tickGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { BuiltObject } from '../src/sim/builtObject';
import { HabitatCategoryType, type Habitat } from '../src/sim/types';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { BuiltObjectMissionType } from '../src/sim/missions/mission';
import { FleetPosture } from '../src/sim/diplomacyTick';
import { empireShipGroups, type ShipGroup } from '../src/sim/fleets/shipGroup';
import { generateSuperPirateFaction } from '../src/sim/pirates';
import { doSuperPirateTasks, doSuperPirateTasksForFaction } from '../src/sim/pirates/pirateGalaxyTick';
import { identifyPirateBase } from '../src/sim/characters';
import { doPlanetDestroyAsteroidField, findNearestSystemGasCloudAsteroid } from '../src/sim/events';
import { destroyHabitat, doExplosionHabitat, type Explosion } from '../src/sim/combat/damage';
import { runGameSeconds } from '../src/sim/tick/harness';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

/** The createTickGame galaxy plus a super-pirate faction (tech 4) at an unowned fuel habitat, as superPirates.test.ts. */
function galaxyWithSuperPirates(): { g: Galaxy; p: Empire } {
    const g = createTickGame(gameData).galaxy;
    const fuel = g.resourceSystem.fuelResources[0].resourceId;
    const home = g.habitats.find(
        (x) => x.category !== HabitatCategoryType.GasCloud && x.category !== HabitatCategoryType.Star && x.empire === null && x.basesAtHabitat.length === 0 && x.resources.some((r) => r.resourceId === fuel),
    ) as Habitat;
    const p = generateSuperPirateFaction(g, { independentColonies: g.independentColonies, startingAge: g.startingAge, difficultyLevel: g.difficultyLevel }, home, 'Deadly Phantoms', null, 4);
    return { g, p };
}

/** Galaxy.9.cs 290-298: the ships DoSuperPirateTasks gathers. */
function eligible(p: Empire): BuiltObject[] {
    return p.builtObjects.filter((b) => b.role === BuiltObjectRole.Military && b.builtAt === null && b.shipGroup === null && b.topSpeed > 0 && b.damagedComponentCount === 0 && b.subRole !== BuiltObjectSubRole.Escort);
}

/** Galaxy.7.cs 1210 FindNearestBaseForPirateAttack by brute force: nearest base of another, non-independent empire. */
function nearestForeignBase(g: Galaxy, x: number, y: number, exclude: Empire): BuiltObject | null {
    let best: BuiltObject | null = null;
    let d = Number.MAX_VALUE;
    for (const b of g.builtObjects) {
        if (b == null || b.role !== BuiltObjectRole.Base || b.empire === exclude || b.empire === g.independentEmpire || b.empire === null) continue;
        const dd = g.calculateDistanceSquared(x, y, b.xpos, b.ypos);
        if (dd < d) {
            d = dd;
            best = b;
        }
    }
    return best;
}

function spyRnd(g: Galaxy): { k: string; v: number }[] {
    const log: { k: string; v: number }[] = [];
    const rnd = g.rnd as unknown as { next: (...a: number[]) => number; nextDouble: () => number };
    const next = rnd.next.bind(rnd);
    const nextDouble = rnd.nextDouble.bind(rnd);
    rnd.next = (...a: number[]) => {
        const v = next(...a);
        log.push({ k: 'n' + a.join(','), v });
        return v;
    };
    rnd.nextDouble = () => {
        const v = nextDouble();
        log.push({ k: 'd', v });
        return v;
    };
    return log;
}

describe('DoSuperPirateTasks (Galaxy.9.cs 208 / 284)', () => {
    it('forms one Phantom Fleet from every idle non-escort warship, on Attack posture, attacking the nearest foreign base', () => {
        const { g, p } = galaxyWithSuperPirates();
        expect(empireShipGroups(p).length).toBe(0);
        const ships = eligible(p);
        // GenerateSuperPirateFaction builds 20-29 warships; escorts are excluded by the C# filter.
        expect(ships.length).toBeGreaterThan(0);
        const escorts = p.builtObjects.filter((b) => b.role === BuiltObjectRole.Military && b.subRole === BuiltObjectSubRole.Escort);
        const base = identifyPirateBase(p)!;
        expect(base).not.toBeNull();
        doSuperPirateTasksForFaction(g, p);
        const groups = empireShipGroups(p) as ShipGroup[];
        expect(groups.length).toBe(1);
        const fleet = groups[0];
        expect(fleet.name).toBe('Phantom Fleet');
        expect(fleet.gatherPoint).toBe(base);
        expect(fleet.shipTargetAmount).toBe(2147483647);
        expect(fleet.troopTargetStrength).toBe(0);
        expect(fleet.posture).toBe(FleetPosture.Attack);
        expect(fleet.postureRangeSquared).toBe(Number.MAX_VALUE);
        // AddShipsToShipGroup(int.MaxValue): every eligible ship joins (all super-pirate hulls have hyperdrives).
        expect(new Set(fleet.ships)).toEqual(new Set(ships));
        for (const e of escorts) expect(fleet.ships).not.toContain(e);
        // 330-337: no mission yet → Attack the nearest base of another empire, from the pirate base.
        const target = nearestForeignBase(g, base.xpos, base.ypos, p);
        expect(target).not.toBeNull();
        expect(fleet.mission).not.toBeNull();
        expect(fleet.mission!.type).toBe(BuiltObjectMissionType.Attack);
        expect(fleet.mission!.targetBuiltObject).toBe(target);
    }, 120000);

    it('a second pass adds no fleet, keeps the mission and draws nothing when no new ship is idle', () => {
        const { g, p } = galaxyWithSuperPirates();
        doSuperPirateTasksForFaction(g, p);
        const fleet = (empireShipGroups(p) as ShipGroup[])[0];
        const mission = fleet.mission;
        const count = fleet.ships.length;
        const draws = g.rnd.drawCount;
        doSuperPirateTasks(g);
        expect(empireShipGroups(p).length).toBe(1);
        expect(fleet.ships.length).toBe(count);
        expect(fleet.mission).toBe(mission);
        expect(g.rnd.drawCount).toBe(draws);
    }, 120000);

    it('skips ordinary pirate factions', () => {
        const g = createTickGame(gameData).galaxy;
        expect(g.pirateEmpires.length).toBeGreaterThan(0);
        const before = g.pirateEmpires.map((e) => empireShipGroups(e).length);
        const draws = g.rnd.drawCount;
        doSuperPirateTasks(g);
        expect(g.pirateEmpires.map((e) => empireShipGroups(e).length)).toEqual(before);
        expect(g.rnd.drawCount).toBe(draws);
    }, 120000);
});

describe('FindNearestSystemGasCloudAsteroid (Galaxy.6.cs 3714)', () => {
    it('returns the nearest parentless habitat (ring search equals a brute-force scan)', () => {
        const g = createTickGame(gameData).galaxy;
        const pts = [
            [0, 0],
            [g.sizeX / 2, g.sizeY / 2],
            [g.sizeX - 1, 1234.5],
            [g.habitats[10].xpos + 3000, g.habitats[10].ypos - 1500],
        ];
        for (const [x, y] of pts) {
            let best: Habitat | null = null;
            let d = Number.MAX_VALUE;
            for (const h of g.habitats) {
                if (h.parent !== null) continue;
                const dd = g.calculateDistanceSquared(Math.trunc(x), Math.trunc(y), h.xpos, h.ypos);
                if (dd < d) {
                    d = dd;
                    best = h;
                }
            }
            expect(findNearestSystemGasCloudAsteroid(g, x, y)).toBe(best);
        }
    }, 120000);
});

describe('planet destroyer aftermath (DestroyHabitat → DoExplosion → DoPlanetDestroyAsteroidField / DoPlanetRemove)', () => {
    /** An uncolonised planet of diameter ≥ 200 with no moons (so DestroyHabitat does not recurse). */
    function targetPlanet(g: Galaxy): Habitat {
        return g.habitats.find(
            (h) => h.category === HabitatCategoryType.Planet && h.diameter >= 200 && h.empire === null && (h.population == null || h.population.totalAmount <= 0) && !g.habitats.some((m) => m.parent === h),
        ) as Habitat;
    }

    it('asteroid count = (⌊(⌊D/2⌋ + ⌊r·D·0.125⌋)/8⌋ + 1)·8, inserted after the star system; the planet is removed at the end', () => {
        const g = createTickGame(gameData).galaxy;
        const planet = targetPlanet(g);
        const star = g.determineHabitatSystemStar(planet);
        const shooter = g.empires[0].builtObjects.find((b) => b.role === BuiltObjectRole.Military) ?? g.empires[0].builtObjects[0];
        const D = planet.diameter;
        g.nowMs = 1_000_000;
        destroyHabitat(g, shooter, planet);
        const ex = planet.explosion as Explosion;
        expect(ex.explosionWillDestroy).toBe(true);
        expect(ex.explosionSize).toBe(D * 4);
        expect(planet.hasBeenDestroyed).toBe(true);
        // num2 = min(400, max(80, ExplosionSize/2)); progression = seconds × 50. D ≥ 200 → num2 = 400: the field appears at
        // progression ≥ 280 (5.6 s) and the planet goes at > 400 (8 s).
        const num2 = Math.min(400, Math.max(80, Math.trunc((D * 4) / 2)));
        expect(num2).toBe(400);
        const countBefore = g.habitats.length;
        g.nowMs = 1_000_000 + 5_500;
        doExplosionHabitat(g, planet);
        expect(planet.destroyedAsteroidFieldGenerated).toBe(false);
        expect(g.habitats.length).toBe(countBefore);
        const log = spyRnd(g);
        g.nowMs = 1_000_000 + 5_600;
        doExplosionHabitat(g, planet);
        expect(planet.destroyedAsteroidFieldGenerated).toBe(true);
        // First draw: NextDouble for the size; then GenerateAsteroidField's Next(10, 25) for the first asteroid.
        expect(log[0].k).toBe('d');
        expect(log[1].k).toBe('n10,25');
        const r = log[0].v;
        const n = (Math.trunc((Math.trunc(D / 2) + Math.trunc(r * D * 0.125)) / 8) + 1) * 8;
        expect(n % 8).toBe(0);
        expect(g.habitats.length).toBe(countBefore + n);
        const asteroids = g.habitats.filter((h) => h.name.endsWith(', Asteroid Field') && h.systemIndex === star.systemIndex && h.parent === findNearestSystemGasCloudAsteroid(g, planet.xpos, planet.ypos));
        expect(asteroids.length).toBeGreaterThanOrEqual(n - 1); // a 1/1300 treasure asteroid may replace one
        // AddAsteroidField: inserted before the next parentless habitat after the star, numbered in order.
        const starIdx = g.habitats.indexOf(star);
        for (let i = starIdx + 1; i < g.habitats.length && g.habitats[i].parent !== null; i++) expect(g.habitats[i].habitatIndex).toBe(i);
        for (let i = 0; i < g.habitats.length; i++) expect(g.habitats[i].habitatIndex).toBe(i);
        // The field orbits the parentless habitat nearest the planet (the system star here) in the planet's direction/speed.
        const inserted = g.habitats.slice(g.habitats.indexOf(asteroids[0]), g.habitats.indexOf(asteroids[0]) + n);
        for (const a of inserted) {
            expect(a.orbitDirection).toBe(planet.orbitDirection);
            expect(a.orbitSpeed).toBe(planet.orbitSpeed);
        }
        // A second DoExplosion before the end draws nothing and adds nothing.
        const len = g.habitats.length;
        const draws = g.rnd.drawCount;
        g.nowMs = 1_000_000 + 7_000;
        doExplosionHabitat(g, planet);
        expect(g.habitats.length).toBe(len);
        expect(g.rnd.drawCount).toBe(draws);
        // > 8 s: DoPlanetRemove → RemoveHabitat.
        g.nowMs = 1_000_000 + 8_100;
        doExplosionHabitat(g, planet);
        expect(planet.explosion).toBeNull();
        expect(g.habitats.includes(planet)).toBe(false);
        expect(g.habitats.length).toBe(len - 1);
        for (let i = 0; i < g.habitats.length; i++) expect(g.habitats[i].habitatIndex).toBe(i);
    }, 120000);

    it('an asteroid leaves no field and draws nothing', () => {
        const g = createTickGame(gameData).galaxy;
        const asteroid = g.habitats.find((h) => h.category === HabitatCategoryType.Asteroid)!;
        const len = g.habitats.length;
        const draws = g.rnd.drawCount;
        doPlanetDestroyAsteroidField(g, asteroid);
        expect(g.habitats.length).toBe(len);
        expect(g.rnd.drawCount).toBe(draws);
    }, 120000);
});

describe('harness smoke (super pirates in the galaxy)', () => {
    it('600 game-s with a super-pirate faction: the first fleet is driven on Attack posture, no stub throws', () => {
        const { g, p } = galaxyWithSuperPirates();
        const r = runGameSeconds(g, 600);
        expect(r.todoHits['M4s doSuperPirateTasks'] ?? 0).toBe(0);
        expect(r.todoHits['M4u doPlanetDestroyAsteroidField'] ?? 0).toBe(0);
        // The faction's own periodic MaintainShipGroups (Empire.1.cs 4179-4199, first at 30 s) forms "1st Fleet" before the
        // first galaxy long block (60 s), so DoSuperPirateTasks drives that ShipGroups[0] instead of forming a Phantom Fleet.
        const groups = empireShipGroups(p) as ShipGroup[];
        expect(groups.length).toBeGreaterThan(0);
        expect(groups[0].ships.length).toBeGreaterThan(0);
        expect(groups[0].posture).toBe(FleetPosture.Attack);
        expect(groups[0].postureRangeSquared).toBe(Number.MAX_VALUE);
    }, 300000);
});
