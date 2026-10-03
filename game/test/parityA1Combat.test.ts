// Parity A1 (docs/parity/ships-combat-fleets.md, galaxy-world-events.md): creature combat bookkeeping, threat warp
// bonus, captain range bonus, flee-from-fighter redirect. Hand-worked C# expectations on the seed-1 age-0 tick game.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { Galaxy } from '../src/sim/galaxy';
import type { BuiltObject } from '../src/sim/builtObject';
import type { Habitat } from '../src/sim/types';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { BuiltObjectComponent, ComponentStatus } from '../src/sim/builtObjectComponent';
import { ComponentType } from '../src/sim/data/components';
import { Weapon } from '../src/sim/weapon';
import { Creature, CreatureType } from '../src/sim/creature';
import { galaxyNow } from '../src/sim/tick/simTime';
import { baconInflictDamageMultiplier, habitatInflictIonDamage, inflictDamageFull, inflictIonDamage } from '../src/sim/combat/damage';

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
