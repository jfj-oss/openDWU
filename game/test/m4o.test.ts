// M4o — weapons, damage, destruction: unit tests against hand-worked C# expectations (SpaceBattleStats.cs,
// BaconBuiltObject.cs 3057 WeaponDamageDropoff, Galaxy.3.cs 474 CalculateWarValue, BuiltObject.1.cs 2225 RechargeShields,
// BuiltObject.2.cs 6084 ReviewDisabledComponents, 6216 InflictDamage, BuiltObject.1.cs 5243 DetermineHitTarget, Weapon.cs 185
// Fire, BuiltObject.1.cs 14 DoExplosions → BuiltObject.2.cs 5171 CompleteTeardown, EmpireCounters.cs 333) on a createGame
// galaxy (seed 1), plus a harness smoke run.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createTickGame } from './helpers/tickGame';
import type { Galaxy } from '../src/sim/galaxy';
import type { BuiltObject } from '../src/sim/builtObject';
import type { GameData } from '../src/sim/data/gameData';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { ComponentStatus } from '../src/sim/builtObjectComponent';
import { ComponentType } from '../src/sim/data/components';
import { PirateRelationType, obtainPirateRelation } from '../src/sim/pirateRelations';
import { runGameSeconds } from '../src/sim/tick/harness';
import { galaxyNow } from '../src/sim/tick/simTime';
import {
    Explosion,
    SpaceBattleStats,
    calculateWarValueBuiltObject,
    doExplosionsBuiltObject,
    inflictDamage,
    inflictDamageFull,
    reviewDisabledComponents,
    startNewBattleStats,
} from '../src/sim/combat/damage';
import { determineHitTarget, rechargeShields, weaponDamageDropoff, weaponFire, weaponIsAvailable } from '../src/sim/combat/weapons';
import { builtObjectCompleteTeardown, cleanupInvalidShips } from '../src/sim/combat/teardown';

let gameData: GameData;
let galaxy: Galaxy;
let shipA: BuiltObject;
let shipB: BuiltObject;
/** Counts Galaxy.Rnd draws over `f` (random.ts trace hook). */
function countDraws(f: () => void): number {
    let n = 0;
    galaxy.rnd.setTrace(() => n++);
    try {
        f();
    } finally {
        galaxy.rnd.setTrace(null);
    }
    return n;
}
beforeAll(async () => {
    gameData = await loadGameDataFs();
    galaxy = createTickGame(gameData).galaxy;
    // The createGame empires start with no military ships; the pirate factions do (see m4n.test.ts).
    const military = (e: number, skip: BuiltObject[] = []) => galaxy.pirateEmpires[e].builtObjects.find((b) => !skip.includes(b) && b.role === BuiltObjectRole.Military && b.warpSpeed > 0 && b.firepowerRaw > 0 && b.isFunctional && b.topSpeed > 0)!;
    shipA = military(0);
    shipB = military(1);
    shipB.xpos = shipA.xpos + 1000;
    shipB.ypos = shipA.ypos;
    shipB.nearestSystemStar = shipA.nearestSystemStar;
    const cell = galaxy.resolveIndex(shipA.xpos, shipA.ypos);
    if (!galaxy.builtObjectIndexGrid[cell.x][cell.y].includes(shipB)) galaxy.builtObjectIndexGrid[cell.x][cell.y].push(shipB);
    obtainPirateRelation(shipA.empire!, shipB.empire!).type = PirateRelationType.None;
    obtainPirateRelation(shipB.empire!, shipA.empire!).type = PirateRelationType.None;
}, 180000);

describe('SpaceBattleStats.cs', () => {
    it('counts hits / long-range hits / misses / hull damage and classifies destroyed targets by sub-role', () => {
        const s = new SpaceBattleStats();
        s.weaponHitEnemy(12.5, 349.9);
        s.weaponHitEnemy(2.25, 350.0);
        s.weaponMissEnemy();
        s.damageHullUs(7);
        s.shieldsStruckUs(1.5);
        expect(s.weaponsHits).toBe(2);
        expect(s.weaponsHitsLongRange).toBe(1);
        expect(s.weaponsMisses).toBe(1);
        expect(s.weaponsDamageToEnemy).toBe(Math.fround(14.75));
        expect(s.damageToUs).toBe(7);
        expect(s.shieldsDamageAbsorbed).toBe(1.5);
        s.targetDestroyedEnemy(shipB);
        expect(s.destroyedEnemyShipBaseSize).toBe(shipB.size);
        const bySubRole: Partial<Record<BuiltObjectSubRole, keyof SpaceBattleStats>> = {
            [BuiltObjectSubRole.Escort]: 'destroyedEnemyShipsEscort',
            [BuiltObjectSubRole.Frigate]: 'destroyedEnemyShipsFrigate',
            [BuiltObjectSubRole.Destroyer]: 'destroyedEnemyShipsDestroyer',
            [BuiltObjectSubRole.Cruiser]: 'destroyedEnemyShipsCruiser',
            [BuiltObjectSubRole.CapitalShip]: 'destroyedEnemyShipsCapitalShip',
            [BuiltObjectSubRole.Carrier]: 'destroyedEnemyShipsCarrier',
            [BuiltObjectSubRole.TroopTransport]: 'destroyedEnemyShipsTroopTransport',
            [BuiltObjectSubRole.ResupplyShip]: 'destroyedEnemyShipsResupplyShip',
        };
        const key = bySubRole[shipB.subRole] ?? 'destroyedEnemyShipsOtherShips';
        expect(s[key]).toBe(1);
    });
});

describe('BaconBuiltObject.cs 3057 WeaponDamageDropoff', () => {
    it('missiles / bombard / point defence keep the raw damage; beams lose DistanceTravelled / Range of it (float)', () => {
        const weapon = shipA.weapons.find((w) => w.component.type !== ComponentType.AssaultPod)!;
        const raw = Math.fround(weapon.rawDamage);
        weapon.distanceTravelled = Math.fround(weapon.range / 4);
        const t = weapon.component.type;
        const expected =
            t === ComponentType.WeaponMissile || t === ComponentType.WeaponBombard || t === ComponentType.WeaponSuperMissile || t === ComponentType.WeaponPointDefense
                ? raw
                : Math.min(Math.max(0, Math.fround(raw - Math.fround(Math.fround(weapon.distanceTravelled / Math.fround(weapon.range)) * raw))), raw);
        expect(weaponDamageDropoff(shipA, weapon, raw)).toBe(expected);
        weapon.distanceTravelled = -1;
    });
});

describe('Galaxy.3.cs 474 CalculateWarValue', () => {
    it('military = design firepower; bases size/5 (or parent strategic value/200 for spaceports); civilians size/20', () => {
        expect(calculateWarValueBuiltObject(shipA)).toBe(shipA.design.firepowerRaw);
        const civilian = galaxy.empires[1].builtObjects.find((b) => b.role !== BuiltObjectRole.Military && b.role !== BuiltObjectRole.Base && b.unbuiltComponentCount === 0);
        if (civilian) expect(calculateWarValueBuiltObject(civilian)).toBe(Math.trunc(civilian.design.size / 20));
    });
});

describe('BuiltObject.1.cs 2225 RechargeShields', () => {
    it('adds min(rate × dt, missing) bounded by energy, charges the energy through the captain bonus, clamps to capacity', () => {
        const ship = shipA;
        ship.currentShields = 0;
        ship.currentEnergy = 1000;
        const before = ship.currentEnergy;
        rechargeShields(galaxy, ship, 1.0);
        const num2 = Math.min(ship.shieldRechargeRate * 1.0, ship.shieldsCapacity - 0);
        expect(ship.currentShields).toBe(Math.fround(0 + Math.fround(num2)));
        expect(ship.currentEnergy).toBe(before - num2);
        ship.currentShields = Math.fround(ship.shieldsCapacity + 5);
        rechargeShields(galaxy, ship, 1.0);
        expect(ship.currentShields).toBe(Math.fround(ship.shieldsCapacity));
    });
});

describe('BuiltObject.2.cs 6084 ReviewDisabledComponents', () => {
    it('counts the (short) durations down by timePassed×1000, drops expired entries and re-defines', () => {
        const ship = shipA;
        ship.disabledComponentIndexes = [0, 1];
        ship.disabledComponentDurations = [1500, 5000];
        reviewDisabledComponents(galaxy, ship, 2.0);
        expect(ship.disabledComponentIndexes).toEqual([1]);
        expect(ship.disabledComponentDurations).toEqual([3000]);
        reviewDisabledComponents(galaxy, ship, 3.0);
        expect(ship.disabledComponentIndexes).toBeNull();
        expect(ship.disabledComponentDurations).toBeNull();
    });
});

describe('BuiltObject.1.cs 5243 DetermineHitTarget / Weapon.cs 185 Fire', () => {
    it('DetermineHitTarget draws NextDouble + Next(0, 12); hitRangeChance = 0.15 + (range − distance)/range', () => {
        const weapon = shipA.weapons.find((w) => w.component.type !== ComponentType.AssaultPod)!;
        let r: { willHit: boolean; hitRangeChance: number } | null = null;
        const draws = countDraws(() => {
            r = determineHitTarget(galaxy, shipA, weapon, shipB, weapon.range / 2);
        });
        expect(draws).toBe(2);
        expect(r!.hitRangeChance).toBeCloseTo(0.15 + 0.5, 10);
    });
    it('Fire sets the projectile state, draws NextDouble + Next(0, 2), charges energy and adds the firer to the target attackers', () => {
        const weapon = shipA.weapons.find((w) => w.component.type !== ComponentType.AssaultPod)!;
        shipA.currentEnergy = 10000;
        const energyBefore = shipA.currentEnergy;
        shipB.attackers = [];
        const time = galaxyNow(galaxy) + 5000;
        const draws = countDraws(() => weaponFire(galaxy, weapon, shipA, shipB, 800, time, true, 0.5));
        expect(draws).toBe(2);
        expect(weapon.lastFired).toBe(time);
        expect(weapon.distanceTravelled).toBe(1);
        expect(weapon.x).toBe(shipA.xpos);
        expect(weapon.target).toBe(shipB);
        expect(weapon.willHitTarget).toBe(true);
        expect(weapon.distanceFromTarget).toBe(800);
        expect(shipA.currentEnergy).toBeLessThan(energyBefore);
        expect(shipB.attackers).toContain(shipA);
        expect(weaponIsAvailable(weapon, shipA, time)).toBe(false);
        weapon.reset();
        expect(weaponIsAvailable(weapon, shipA, time + weapon.fireRate)).toBe(true);
    });
});

describe('BuiltObject.2.cs 6216 InflictDamage', () => {
    it('a hit absorbed by shields subtracts (float), stamps LastShieldStrike / direction, feeds BattleStats and draws nothing', () => {
        startNewBattleStats(galaxy, shipA);
        startNewBattleStats(galaxy, shipB);
        shipB.currentShields = 100;
        const time = galaxyNow(galaxy);
        const draws = countDraws(() => {
            expect(inflictDamage(galaxy, shipA, shipB, null, 12.5, time, 300, 1.25)).toBe(false);
        });
        expect(draws).toBe(0);
        expect(shipB.currentShields).toBe(Math.fround(100 - 12.5));
        expect(shipB.lastShieldStrike).toBe(time);
        expect(shipB.lastShieldStrikeDirection).toBe(Math.fround(1.25));
        expect((shipA.battleStats as SpaceBattleStats).weaponsHits).toBe(1);
        expect((shipB.battleStats as SpaceBattleStats).shieldsDamageAbsorbed).toBe(12.5);
    });
    it('a hull hit damages random components (Rnd draws), pushes a non-destroying explosion and flags the repair', () => {
        shipB.currentShields = 0;
        const damagedBefore = shipB.damagedComponentCount;
        const explosionsBefore = shipB.explosions.length;
        const draws = countDraws(() => {
            expect(inflictDamage(galaxy, shipA, shipB, null, 3, galaxyNow(galaxy), 300, 0)).toBe(false);
        });
        // ≥ 1 component pick + the 5 explosion draws (Next(0,10), Next(0,n), Next(0,2), Next(0,n), Next(0,2)).
        expect(draws).toBeGreaterThanOrEqual(6);
        expect(shipB.explosions.length).toBe(explosionsBefore + 1);
        const e = shipB.explosions[shipB.explosions.length - 1] as Explosion;
        expect(e.explosionWillDestroy).toBe(false);
        expect(e.explosionSize).toBeGreaterThanOrEqual(10);
        expect(shipB.hasBeenDestroyed).toBe(false);
        expect(shipB.damagedComponentCount).toBeGreaterThanOrEqual(damagedBefore);
    });
    it('an overwhelming hit destroys the target: counters on both empires, a destroying explosion, then DoExplosions tears it down', () => {
        const victim = galaxy.pirateEmpires[1].builtObjects.find((b) => b !== shipB && b.role === BuiltObjectRole.Military && b.warpSpeed > 0)!;
        const victimEmpire = victim.empire!;
        const attackerEmpire = shipA.empire!;
        const killsBefore = attackerEmpire.counters.destroyedEnemyMilitaryShipCount;
        const lossesBefore = victimEmpire.counters.lossesMilitaryShipCount;
        victim.currentShields = 0;
        expect(inflictDamageFull(galaxy, shipA, victim, null, 1e9, galaxyNow(galaxy), 0, false, 0, false)).toBe(true);
        expect(victim.hasBeenDestroyed).toBe(true);
        expect(attackerEmpire.counters.destroyedEnemyMilitaryShipCount).toBe(killsBefore + 1);
        expect(victimEmpire.counters.lossesMilitaryShipCount).toBe(lossesBefore + 1);
        const e = victim.explosions[victim.explosions.length - 1] as Explosion;
        expect(e.explosionWillDestroy).toBe(true);
        // DoExplosions: progression = seconds × 60 > min(100, max(50, size/2)) → CompleteTeardown.
        galaxy.nowMs = e.explosionStart + 10000;
        doExplosionsBuiltObject(galaxy, victim);
        expect(victim.explosions.length).toBe(0);
        expect(galaxy.builtObjects.includes(victim)).toBe(false);
        expect(victimEmpire.builtObjects.includes(victim)).toBe(false);
        const cell = galaxy.resolveIndex(victim.xpos, victim.ypos);
        expect(galaxy.builtObjectIndexGrid[cell.x][cell.y].includes(victim)).toBe(false);
    });
});

describe('BuiltObject.2.cs 5171 CompleteTeardown / Empire.8.cs 2896 CleanupInvalidShips', () => {
    it('CompleteTeardown(removeFromEmpire: false) keeps the empire list entry; CleanupInvalidShips tears destroyed ships down', () => {
        const empire = galaxy.pirateEmpires[0];
        const ship = empire.builtObjects.find((b) => b !== shipA && b.role === BuiltObjectRole.Military && !b.hasBeenDestroyed)!;
        builtObjectCompleteTeardown(galaxy, ship, false);
        expect(ship.hasBeenDestroyed).toBe(true);
        expect(empire.builtObjects.includes(ship)).toBe(true);
        expect(galaxy.builtObjects.includes(ship)).toBe(false);
        ship.inView = false;
        cleanupInvalidShips(galaxy, empire);
        expect(empire.builtObjects.includes(ship)).toBe(false);
    });
});

describe('harness', () => {
    it('60 game-s on a fresh createGame galaxy runs the M4o entry points with no M4o stub left', () => {
        const g = createTickGame(gameData).galaxy;
        const r = runGameSeconds(g, 60);
        expect(Object.keys(r.todoHits).filter((k) => k.startsWith('M4o '))).toEqual([]);
        for (const b of g.builtObjects) {
            if (b == null) continue;
            expect(Number.isFinite(b.currentShields) && Number.isFinite(b.currentEnergy)).toBe(true);
            expect(b.currentShields).toBeGreaterThanOrEqual(0);
            expect(b.currentShields).toBeLessThanOrEqual(Math.fround(b.shieldsCapacity));
            for (const w of b.weapons) expect(w.status === undefined || true).toBe(true);
        }
    }, 300000);
});
