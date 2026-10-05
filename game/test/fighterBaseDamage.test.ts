// Fighter vs base damage rate, pinned to the C# (Test5.dwusave report: 44 Tactical Interceptors barely dent a pirate
// space port's 4200 shields recharging at 14/s).
//
// The C# rules that set the rate, all ported 1:1 in src/sim/combat/fighters.ts:
// - fighters.txt row 2 Tactical Interceptor: beam, damage 5, range 200, energy 4, speed 430, damage loss 1 per 100,
//   fire rate 700 ms (Fighter.cs 187 ctor copies them onto the FighterWeapon).
// - BaconFighter.cs 458 PursueTarget (BuiltObject target): inside 100 the fighter veers off (TargetHeading ± 0.7 +
//   offset, top speed); it fires only at 100 <= distance < 200 and |Heading - angle| < 0.35 (1.4 in view), so a
//   strafing run crosses the 100-unit band in ~0.75 s at 135 speed and then loops back round.
// - BaconFighter.cs 704 FireWeaponsAtTarget: needs DistanceTravelled < 0 (the last beam reset), energy and
//   LastFired + FireRate; Fighter.cs 668 HandleWeaponsFiring: Power = RawDamage - DistanceTravelled / 100 × DamageLoss.
// - Fighter.cs 1257 InflictDamage: shields take hitPower as is (no reduction, no penetration).
// Result: about one shot per strafing pass — measured 0.17 shots/s (0.62 shield dmg/s) per interceptor out of view and
// 0.25 shots/s (0.72/s) in view, against a 1/0.7 s fire rate — two dozen interceptors on the port roughly match its 14/s recharge.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { BuiltObject } from '../src/sim/builtObject';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { ComponentCategoryType } from '../src/sim/data/policies';
import { updateIndexesForMovement, updatePosition } from '../src/sim/movement';
import { determineAngle } from '../src/sim/combat/attackAI';
import { Fighter, FighterMissionType, FighterType, assignAttackTarget, captainFightersBonus, fighterDoTasks, fightersOf, specificationOf } from '../src/sim/combat/fighters';
import { shipGroupOf } from '../src/sim/combat/threats';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

const FIGHTERS = 20;

interface StrafeResult {
    shots: number;
    hits: number[];
    shotDistances: number[];
    shotAngleErrors: number[];
    minShotGapMs: number;
    shieldLoss: number;
    seconds: number;
    /** Fighter.cs 1108-1114: hitPower × ParentBuiltObject.CaptainFightersBonus × ShipGroup.FightersBonus. */
    bonus: number;
}

/**
 * FIGHTERS Tactical Interceptors from the player's capital port strafe a pirate base 1200 units away for `seconds`,
 * each fighter's DoTasks run every `stepMs` (the base itself is not ticked: no regen, no return fire).
 */
function strafe(stepMs: number, inView: boolean, seconds: number): StrafeResult {
    const g: Galaxy = cachedTickGame(gameData).galaxy;
    const carrier = g.builtObjects.find((b): b is BuiltObject => b !== null && b.empire === g.playerEmpire && b.fighterCapacity > 0)!;
    const base = g.builtObjects.find((b): b is BuiltObject => b !== null && !b.hasBeenDestroyed && b.role === BuiltObjectRole.Base && b.empire !== null && b.empire.pirateEmpireBaseHabitat !== null)!;
    expect(carrier).toBeDefined();
    expect(base).toBeDefined();
    const ix = Math.trunc(Math.trunc(base.xpos) / 400000);
    const iy = Math.trunc(Math.trunc(base.ypos) / 400000);
    base.parentHabitat = null;
    base.xpos = carrier.xpos + 1200;
    base.ypos = carrier.ypos;
    updateIndexesForMovement(g, base, ix, iy, true);
    updatePosition(g, base);
    base.shieldsCapacity = 100000; // float32 shields: keep the value small enough that a hit keeps ~0.004 precision
    base.currentShields = 50000;
    carrier.threats = [base];
    carrier.threatLevels = [1000];
    carrier.currentTarget = null;
    const row = gameData.fighters.find((f) => f.fighterId === 2)!;
    const spec = specificationOf(row);
    expect(spec.name).toBe('Tactical Interceptor');
    for (const f of [...(fightersOf(carrier) ?? [])]) carrier.fighters!.splice(carrier.fighters!.indexOf(f), 1);
    const fighters: Fighter[] = [];
    for (let i = 0; i < FIGHTERS; i++) {
        const f = new Fighter(g, spec, carrier);
        f.health = 1;
        f.underConstruction = false;
        f.onboardCarrier = false;
        f.xpos = carrier.xpos + 300 + 10 * i;
        f.ypos = carrier.ypos + (i % 2 === 0 ? 40 : -40) * (1 + (i >> 1));
        f.heading = 0;
        f.targetHeading = 0;
        f.missionType = FighterMissionType.Attack;
        assignAttackTarget(f, base);
        fighters.push(f);
    }
    const r: StrafeResult = { shots: 0, hits: [], shotDistances: [], shotAngleErrors: [], minShotGapMs: Infinity, shieldLoss: 0, seconds, bonus: captainFightersBonus(carrier) * (shipGroupOf(carrier)?.fightersBonus ?? 1) };
    const shields0 = base.currentShields;
    let time = g.nowMs;
    for (const f of fighters) f.lastTouch = f.lastLongTouch = time;
    const steps = Math.round((seconds * 1000) / stepMs);
    for (let step = 0; step < steps; step++) {
        time += stepMs;
        g.nowMs = time;
        for (const f of fighters) {
            const w = f.weapons[0];
            const lastFired = w.lastFired;
            const before = base.currentShields;
            fighterDoTasks(g, f, time, inView);
            // BaconFighter.cs 53/60 CheckForLevelGain / GainFighterLevel: an ace may gain +1 damage or +10% range — compare
            // each hit with the fighter's own weapon (relative power) and each shot with its own range.
            if (base.currentShields < before) r.hits.push((before - base.currentShields) / w.rawDamage);
            if (w.lastFired !== lastFired) {
                r.shots++;
                if (lastFired > 0) r.minShotGapMs = Math.min(r.minShotGapMs, w.lastFired - lastFired);
                // DoMovement runs before PursueTarget, so the end-of-step position is where the shot was decided.
                r.shotDistances.push(g.calculateDistance(f.xpos, f.ypos, base.xpos, base.ypos) / f.specification.weaponRange);
                r.shotAngleErrors.push(Math.abs(f.heading - determineAngle(f.xpos, f.ypos, base.xpos, base.ypos)));
            }
        }
    }
    r.shieldLoss = shields0 - base.currentShields;
    expect(fighters.every((f) => f.currentTarget === base && f.missionType === FighterMissionType.Attack)).toBe(true);
    return r;
}

describe('fighter vs base damage (C# Fighter / BaconFighter rules)', () => {
    it('Tactical Interceptor weapon is fighters.txt row 2: beam, 5 damage, range 200, 700 ms, loss 1 per 100', () => {
        const spec = specificationOf(gameData.fighters.find((f) => f.fighterId === 2)!);
        expect(spec.type).toBe(FighterType.Interceptor);
        expect([spec.weaponDamage, spec.weaponRange, spec.weaponEnergyRequired, spec.weaponSpeed, spec.weaponDamageLoss, spec.weaponFireRate]).toEqual([5, 200, 4, 430, 1, 700]);
        expect([spec.topSpeed, spec.energyCapacity, spec.energyRechargeRate, spec.topSpeedEnergyConsumptionRate]).toEqual([135, 40, 10, 10]);
    });

    for (const [label, stepMs, inView, angleCone, shotsPerFighterSecond] of [
        // Out of view the carrier (and its fighters) is ticked by the background pass, ~every 200 ms on the save.
        ['out of view, 200 ms steps', 200, false, 0.35, [0.15, 0.22]],
        // In view: every frame, wider firing cone (PursueTarget num1 = 1.4).
        ['in view, 60 fps', 1000 / 60, true, 1.4, [0.2, 0.3]],
    ] as const) {
        it(`${label}: one shot per strafing pass, shields lose exactly the beam power`, () => {
            const r = strafe(stepMs, inView, 60);
            // PursueTarget: fires only at 100 <= distance < WeaponRange, within the heading cone.
            for (const d of r.shotDistances) {
                expect(d * 200).toBeGreaterThanOrEqual(100 * 0.99);
                expect(d).toBeLessThan(1);
            }
            for (const a of r.shotAngleErrors) expect(a).toBeLessThan(angleCone);
            // FireWeaponsAtTarget: LastFired + FireRate.
            expect(r.minShotGapMs).toBeGreaterThanOrEqual(700);
            // HandleWeaponsFiring Power = RawDamage - DistanceTravelled / 100 (a hit lands within ~range + one beam step);
            // InflictDamage takes it off the shields unreduced (only the captain / fleet fighter bonus multiplies it).
            for (const h of r.hits) {
                expect(h).toBeLessThanOrEqual(r.bonus + 0.002);
                expect(h).toBeGreaterThan(0.4 * r.bonus);
            }
            const perFighterShots = r.shots / FIGHTERS / r.seconds;
            const perFighterDps = r.shieldLoss / FIGHTERS / r.seconds;
            // Far below the 1/0.7 s fire rate: the strafing geometry limits it to ~1 shot per pass.
            expect(perFighterShots).toBeGreaterThan(shotsPerFighterSecond[0]);
            expect(perFighterShots).toBeLessThan(shotsPerFighterSecond[1]);
            expect(perFighterDps).toBeLessThan(5 * r.bonus * shotsPerFighterSecond[1]);
            // 23 interceptors on target (the save's average) vs a 14/s recharge: the same order.
            expect(perFighterDps * 23).toBeGreaterThan(5);
            expect(perFighterDps * 23).toBeLessThan(40);
        }, 300000);
    }

    it('fighter beam weapons are WeaponBeam category (no torpedo flag in FireWeaponsAtTarget)', () => {
        const g: Galaxy = cachedTickGame(gameData).galaxy;
        const carrier = g.builtObjects.find((b): b is BuiltObject => b !== null && b.empire === g.playerEmpire && b.fighterCapacity > 0)!;
        const f = new Fighter(g, specificationOf(gameData.fighters.find((x) => x.fighterId === 2)!), carrier);
        expect(f.weapons.length).toBe(1);
        expect(f.weapons[0].category).toBe(ComponentCategoryType.WeaponBeam);
        expect([f.weapons[0].rawDamage, f.weapons[0].range, f.weapons[0].fireRate]).toEqual([5, 200, 700]);
    });
});
