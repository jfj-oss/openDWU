// Parity A1 (docs/parity/ships-combat-fleets.md, galaxy-world-events.md): creature combat bookkeeping, threat warp
// bonus, captain range bonus, flee-from-fighter redirect. Hand-worked C# expectations on the seed-1 age-0 tick game.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { Galaxy } from '../src/sim/galaxy';
import type { BuiltObject } from '../src/sim/builtObject';
import type { Habitat } from '../src/sim/types';
import { BattleTactics, BuiltObjectFleeWhen, BuiltObjectRole } from '../src/sim/data/designSpecifications';
import type { GameData } from '../src/sim/data/gameData';
import { BuiltObjectComponent, ComponentStatus } from '../src/sim/builtObjectComponent';
import { ComponentType } from '../src/sim/data/components';
import { Weapon } from '../src/sim/weapon';
import { Creature, CreatureType } from '../src/sim/creature';
import { galaxyNow } from '../src/sim/tick/simTime';
import { weaponFire } from '../src/sim/combat/weapons';
import { escapeTargetForFleeFrom, performThreatEvaluation, shipGroupOf, threatEvaluation } from '../src/sim/combat/threats';
import { Fighter, identifyLatestFighterSpecification } from '../src/sim/combat/fighters';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, builtObjectMission, type StellarObject } from '../src/sim/missions/mission';
import { assignMission } from '../src/sim/missions/assign';
import { warpSpeedWithBonuses } from '../src/sim/movement';
import { captainBonusMap } from '../src/sim/characters';
import { checkForAttack, determineAngle, modifyAttackRangeByTargetSpeedFor } from '../src/sim/combat/attackAI';
import { creatureCheckForAttackers } from '../src/sim/events';
import { baconInflictDamageMultiplier, habitatInflictIonDamage, inflictDamageFull, inflictIonDamage } from '../src/sim/combat/damage';

let gameDataRef: GameData;
let galaxy: Galaxy;
let ship: BuiltObject;
let colony: Habitat;

function weaponOfType(type: ComponentType): Weapon {
    const def = galaxy.researchStatic!.componentStatic!.definitions.find((d) => d.type === type)!;
    expect(def).toBeDefined();
    return Weapon.fromBuiltObjectComponent(new BuiltObjectComponent(def, ComponentStatus.Normal));
}
function newCreature(type: CreatureType): Creature {
    const c = new Creature(galaxy, type, colony);
    c.damage = 0;
    c.damageKillThreshold = 1e9;
    return c;
}

beforeAll(async () => {
    const gameData = await loadGameDataFs();
    gameDataRef = gameData;
    galaxy = cachedTickGame(gameData, { age: 0 }).galaxy;
    ship = galaxy.builtObjects.find((b): b is BuiltObject => b !== null && b.empire !== null && b.role === BuiltObjectRole.Military && b.firepowerRaw > 0 && b.isFunctional)!;
    expect(ship).toBeDefined();
    colony = galaxy.habitats.find((h) => h.empire !== null && h.population !== null && h.population.items.length > 0)!;
    expect(colony).toBeDefined();
});

describe('Creature.cs 926 DamageCreature(damager, damage, weapon): Silver Mist and ion weapons', () => {
    it('divides by 10 (min 1) without a weapon or with a non-ion weapon', () => {
        const mist = newCreature(CreatureType.SilverMist);
        mist.damageCreature(null, 105, null);
        expect(mist.damage).toBe(10);
        mist.damageCreature(ship, 105, weaponOfType(ComponentType.WeaponBeam));
        expect(mist.damage).toBe(20);
        mist.damageCreature(null, 3, null);
        expect(mist.damage).toBe(21);
    });

    it('takes full damage from an ion cannon or ion pulse', () => {
        const mist = newCreature(CreatureType.SilverMist);
        mist.damageCreature(ship, 105, weaponOfType(ComponentType.WeaponIonCannon));
        expect(mist.damage).toBe(105);
        mist.damageCreature(ship, 50, weaponOfType(ComponentType.WeaponIonPulse));
        expect(mist.damage).toBe(155);
    });

    it('other creatures always take full damage', () => {
        const kaltor = newCreature(CreatureType.Kaltor);
        kaltor.damageCreature(null, 105, null);
        expect(kaltor.damage).toBe(105);
    });

    it('BuiltObject.2.cs 6133 InflictIonDamage passes its weapon (full damage)', () => {
        const mist = newCreature(CreatureType.SilverMist);
        const hit = Math.trunc(200 * baconInflictDamageMultiplier(ship));
        inflictIonDamage(galaxy, ship, mist, weaponOfType(ComponentType.WeaponIonCannon), 200, galaxyNow(galaxy), 0);
        expect(mist.damage).toBe(hit);
    });

    it('BuiltObject.2.cs 6227 InflictDamage passes its weapon (beam: a tenth)', () => {
        const mist = newCreature(CreatureType.SilverMist);
        const hit = Math.trunc(200 * baconInflictDamageMultiplier(ship));
        inflictDamageFull(galaxy, ship, mist, weaponOfType(ComponentType.WeaponBeam), 200, galaxyNow(galaxy), 0, true, 0, false);
        expect(mist.damage).toBe(Math.max(1, Math.trunc(hit / 10)));
    });

    it("Habitat.cs 2355 InflictIonDamage passes the colony's Giant Ion Cannon (full damage)", () => {
        const mist = newCreature(CreatureType.SilverMist);
        const saved = colony.giantIonCannon;
        colony.giantIonCannon = weaponOfType(ComponentType.WeaponIonCannon);
        try {
            habitatInflictIonDamage(galaxy, colony, mist, 300, galaxyNow(galaxy), 0);
        } finally {
            colony.giantIonCannon = saved;
        }
        expect(mist.damage).toBe(300);
    });
});

describe('Creature.cs 933 → EmpireCounters.cs 481 ProcessCreatureDeath on a kill', () => {
    it("advances the damager empire's creature counter", () => {
        const counters = ship.empire!.counters;
        const before = counters.destroyedCreatureCountKaltor;
        const kaltor = newCreature(CreatureType.Kaltor);
        kaltor.damageKillThreshold = 50;
        expect(kaltor.damageCreature(ship, 40, null)).toBe(false);
        expect(counters.destroyedCreatureCountKaltor).toBe(before);
        expect(kaltor.damageCreature(ship, 40, null)).toBe(true);
        expect(counters.destroyedCreatureCountKaltor).toBe(before + 1);
    });

    it('a ship kill through InflictDamage counts (Silver Mist)', () => {
        const counters = ship.empire!.counters;
        const before = counters.destroyedCreatureCountSilverMist;
        const mist = newCreature(CreatureType.SilverMist);
        mist.damageKillThreshold = 1;
        expect(inflictDamageFull(galaxy, ship, mist, null, 1000, galaxyNow(galaxy), 0, true, 0, false)).toBe(true);
        expect(counters.destroyedCreatureCountSilverMist).toBe(before + 1);
    });

    it('no damager (location / creature damage) counts nothing', () => {
        const counters = ship.empire!.counters;
        const before = counters.destroyedCreatureCountArdilus;
        const ardilus = newCreature(CreatureType.Ardilus);
        ardilus.damageKillThreshold = 1;
        expect(ardilus.damageCreature(null, 100, null)).toBe(true);
        expect(counters.destroyedCreatureCountArdilus).toBe(before);
    });
});

describe('Weapon.cs 299-305 FireInternal adds a firing BuiltObject to Creature.Attackers', () => {
    it('ship fire registers the ship once; Creature.cs 1196 CheckForAttackers then targets it', () => {
        const kaltor = newCreature(CreatureType.Kaltor);
        kaltor.xpos = ship.xpos + 500;
        kaltor.ypos = ship.ypos;
        const weapon = ship.weapons![0];
        weaponFire(galaxy, weapon, ship, kaltor, 500, galaxyNow(galaxy), true, 1);
        weaponFire(galaxy, weapon, ship, kaltor, 500, galaxyNow(galaxy), true, 1);
        expect(kaltor.attackers).toEqual([ship]);
        creatureCheckForAttackers(galaxy, kaltor);
        expect(kaltor.currentTarget).toBe(ship);
        expect(ship.pursuers).toContain(kaltor);
    });

    it('a colony (Habitat) firer is not registered (FireInternal returns before the switch)', () => {
        const kaltor = newCreature(CreatureType.Kaltor);
        weaponFire(galaxy, weaponOfType(ComponentType.WeaponIonCannon), colony, kaltor, 500, galaxyNow(galaxy), true, 1);
        expect(kaltor.attackers).toEqual([]);
    });
});

describe('BuiltObject.1.cs 208 PerformThreatEvaluation reads BuiltObject.cs 572 WarpSpeedWithBonuses', () => {
    it('skips evaluation while moving at the captain-boosted warp speed', () => {
        expect(ship.warpSpeed).toBeGreaterThan(0);
        const savedSpeed = ship.currentSpeed;
        const savedThreats = ship.threats;
        const savedBonuses = captainBonusMap.get(ship);
        const bonuses = { targeting: 100, countermeasures: 100, shipManeuvering: 100, fighters: 100, shipEnergyUsage: 100, weaponsDamage: 100, weaponsRange: 100, shieldRechargeRate: 100, damageControl: 100, repair: 100, hyperjumpSpeed: 150 };
        captainBonusMap.set(ship, bonuses);
        try {
            const boosted = warpSpeedWithBonuses(ship);
            expect(boosted).toBe(Math.trunc(ship.warpSpeed * (shipGroupOf(ship)?.hyperjumpSpeedBonus ?? 1) * 1.5));
            expect(boosted).not.toBe(ship.warpSpeed);
            const sentinel: BuiltObject['threats'] = [];
            ship.threats = sentinel;
            ship.currentSpeed = Math.fround(boosted);
            performThreatEvaluation(galaxy, ship, galaxyNow(galaxy));
            expect(ship.threats).toBe(sentinel); // early return: at full (boosted) warp
            ship.currentSpeed = Math.fround(ship.warpSpeed);
            performThreatEvaluation(galaxy, ship, galaxyNow(galaxy));
            expect(ship.threats).not.toBe(sentinel); // the unboosted warp speed is not "full warp"
        } finally {
            ship.currentSpeed = savedSpeed;
            ship.threats = savedThreats;
            if (savedBonuses === undefined) captainBonusMap.delete(ship);
            else captainBonusMap.set(ship, savedBonuses);
        }
    });
});

describe('BuiltObject.2.cs 205 ModifyAttackRangeByTargetSpeed applies CaptainWeaponsRangeBonus (BuiltObject.cs 600)', () => {
    it('a 150% captain range bonus scales the chase range by 1.5', () => {
        const target = galaxy.builtObjects.find((b): b is BuiltObject => b !== null && b !== ship && b.topSpeed > 0 && !b.hasBeenDestroyed)!;
        const saved = { x: target.xpos, y: target.ypos, heading: target.heading, speed: target.currentSpeed, stronger: ship.design.tacticsStrongerShips, weaker: ship.design.tacticsWeakerShips, bonuses: captainBonusMap.get(ship), min: ship.optimalMinimumAttackRange, max: ship.optimalMaximumAttackRange };
        try {
            ship.design.tacticsStrongerShips = BattleTactics.AllWeapons;
            ship.design.tacticsWeakerShips = BattleTactics.AllWeapons;
            target.xpos = ship.xpos + 1000;
            target.ypos = ship.ypos;
            target.currentSpeed = 1;
            target.heading = Math.fround(determineAngle(target.xpos, target.ypos, ship.xpos, ship.ypos) + Math.PI); // fleeing
            const chaseRange = (rangeBonus: number): number => {
                captainBonusMap.set(ship, { targeting: 100, countermeasures: 100, shipManeuvering: 100, fighters: 100, shipEnergyUsage: 100, weaponsDamage: 100, weaponsRange: rangeBonus, shieldRechargeRate: 100, damageControl: 100, repair: 100, hyperjumpSpeed: 100 });
                ship.optimalMaximumAttackRange = 1e9;
                modifyAttackRangeByTargetSpeedFor(galaxy, ship, target);
                return ship.optimalMaximumAttackRange;
            };
            const base = chaseRange(100);
            const boosted = chaseRange(150);
            expect(base).toBeGreaterThan(0);
            expect(base).toBeLessThan(1e9);
            expect(boosted / base).toBeCloseTo(1.5, 2);
        } finally {
            target.xpos = saved.x;
            target.ypos = saved.y;
            target.heading = saved.heading;
            target.currentSpeed = saved.speed;
            ship.design.tacticsStrongerShips = saved.stronger;
            ship.design.tacticsWeakerShips = saved.weaker;
            ship.optimalMinimumAttackRange = saved.min;
            ship.optimalMaximumAttackRange = saved.max;
            if (saved.bonuses === undefined) captainBonusMap.delete(ship);
            else captainBonusMap.set(ship, saved.bonuses);
        }
    });
});

describe('BuiltObject.1.cs 305-312 / 1264-1271: escaping from a fighter targets its carrier', () => {
    function setup() {
        const g = cachedTickGame(gameDataRef, { age: 0 }).galaxy;
        const victim = g.builtObjects.find((b): b is BuiltObject => b !== null && b.empire !== null && b.role === BuiltObjectRole.Military && b.isFunctional && b.topSpeed > 0 && b.builtAt === null)!;
        const carrier = g.builtObjects.find((b): b is BuiltObject => b !== null && b !== victim && b.empire !== null && b.empire !== victim.empire && !b.hasBeenDestroyed)!;
        if (carrier.fighters === null) carrier.fighters = [];
        const spec = identifyLatestFighterSpecification(g.playerEmpire!)!;
        const fighter = new Fighter(g, spec, carrier);
        fighter.empire = carrier.empire;
        fighter.xpos = victim.xpos + 1000;
        fighter.ypos = victim.ypos;
        victim.design.fleeWhen = BuiltObjectFleeWhen.Attacked;
        victim.attackers = [fighter];
        victim.mission = null;
        victim.hyperjumpPrepare = false;
        return { g, victim, carrier, fighter };
    }

    it('escapeTargetForFleeFrom: the live carrier; the fighter itself once the carrier is destroyed', () => {
        const { carrier, fighter } = setup();
        expect(escapeTargetForFleeFrom(fighter as unknown as StellarObject)).toBe(carrier);
        carrier.hasBeenDestroyed = true;
        expect(escapeTargetForFleeFrom(fighter as unknown as StellarObject)).toBe(fighter);
        expect(escapeTargetForFleeFrom(carrier)).toBe(carrier);
    });

    it('ThreatEvaluation assigns an Escape mission from the carrier', () => {
        const { g, victim, carrier } = setup();
        threatEvaluation(g, victim, galaxyNow(g));
        const m = builtObjectMission(victim.mission);
        expect(m?.type).toBe(BuiltObjectMissionType.Escape);
        expect(m?.targetBuiltObject).toBe(carrier);
    });

    it('CheckForAttack assigns an Escape mission from the carrier', () => {
        const { g, victim, carrier } = setup();
        // CheckForAttack only flees when it would not counter-attack: here a high-priority Move mission (1196-1200).
        assignMission(g, victim, BuiltObjectMissionType.Move, g.habitats[0], null, BuiltObjectMissionPriority.High);
        expect(builtObjectMission(victim.mission)?.type).toBe(BuiltObjectMissionType.Move);
        checkForAttack(g, victim);
        const m = builtObjectMission(victim.mission);
        expect(m?.type).toBe(BuiltObjectMissionType.Escape);
        expect(m?.targetBuiltObject).toBe(carrier);
    });
});
