// Combat verification scenarios (tasks/COMBAT-VERIFICATION-2026-09-26.md): staged battles on the seed-1 harness game,
// every expected value hand-worked from the decompiled C# (file:line cited next to each assertion).
//
//   (1) a player escort ordered to Attack a pirate ship (Main.Part7.cs method_347 → AssignMission Attack): weapon fire
//       gating (BuiltObject.1.cs 5089 FireWeaponsAtTarget: range, energy, FireRate ± 400 ms jitter), the hit roll
//       (BuiltObject.1.cs 5243 DetermineHitTarget), beam travel / impact / damage fall-off (BuiltObject.1.cs 3737
//       HandleWeaponsFiring, BaconBuiltObject.cs 3057 WeaponDamageDropoff), shields → armour → components
//       (BuiltObject.2.cs 6221 InflictDamage) and the destroyed ship's null slot (BuiltObject.2.cs 5171 CompleteTeardown);
//   (2) a 4-ship fleet against a pirate base: the base fires back (BuiltObject.cs 4557 DefendBase over the threat list
//       sorted by Galaxy.7.cs 3253 EvaluateThreats / 3681 DetermineThreatLevel), shield recharge (BuiltObject.1.cs 2225
//       RechargeShields), the fleet's target choice (Galaxy/BuiltObject CheckAssignAttackOnThreat);
//   (3) carrier fighters launch, engage and return (Fighter.cs / BaconFighter.cs);
//   (4) boarding a disabled ship (BuiltObject.1.cs 2954 ProcessBoardingAssault, 3314 CalculateAvailableAssaultPodAttackStrength,
//       3399 CalculateBoardingDefenseValue);
//   (5) troop transports invading an independent colony (Habitat.cs 3365 ResolveInvasionBattles, BaconHabitat.cs 1188
//       CalculateForceStrengths);
//   (6) a 30-game-minute headless run reports battles, ships destroyed and SpaceBattleStats.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { BuiltObject } from '../src/sim/builtObject';
import { Random } from '../src/sim/random';
import { runGameSeconds } from '../src/sim/tick/harness';
import { MIN_TIME } from '../src/sim/tick/simTime';
import { updateIndexesForMovement, updatePosition } from '../src/sim/movement';
import { ComponentType } from '../src/sim/data/components';
import { ComponentCategoryType } from '../src/sim/data/policies';
import { ComponentStatus } from '../src/sim/builtObjectComponent';
import { BattleTactics, BuiltObjectFleeWhen } from '../src/sim/data/designSpecifications';
import { BuiltObjectMissionType, builtObjectMission } from '../src/sim/missions/mission';
import { createMissionShipActionAt } from '../src/sim/player/shipAction';
import { executeShipAction } from '../src/sim/player/executeShipAction';
import { captainBonuses } from '../src/sim/characters';
import { fireWeaponsAtTarget, handleWeaponsFiringBuiltObject, weaponDamageDropoff } from '../src/sim/combat/weapons';
import { inflictDamage } from '../src/sim/combat/damage';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 180000);

// ---------------------------------------------------------------------------------------------------------------
// Staging helpers
// ---------------------------------------------------------------------------------------------------------------

/** A point ≥ 300 000 from every habitat and ship (no base, planet or third party joins the staged fight). */
function emptySpot(g: Galaxy): { x: number; y: number } {
    for (let x = 200000; x < g.sizeX; x += 100000) {
        for (let y = 200000; y < g.sizeY; y += 100000) {
            if (g.habitats.every((h) => Math.hypot(h.xpos - x, h.ypos - y) > 300000) && g.builtObjects.every((b) => b === null || Math.hypot(b.xpos - x, b.ypos - y) > 300000)) return { x, y };
        }
    }
    throw new Error('no empty spot');
}

/** Moves a ship (re-indexing it, Galaxy.6.cs UpdateIndexesForMovement) and detaches it from any parent offset. */
function place(g: Galaxy, b: BuiltObject, x: number, y: number): void {
    const ix = Math.trunc(Math.trunc(b.xpos) / 400000);
    const iy = Math.trunc(Math.trunc(b.ypos) / 400000);
    b.parentBuiltObject = null;
    b.parentHabitat = null;
    b.parentOffsetX = -2000000001.0;
    b.parentOffsetY = -2000000001.0;
    b.xpos = x;
    b.ypos = y;
    updateIndexesForMovement(g, b, ix, iy, true);
    updatePosition(g, b);
}

function ship(g: Galaxy, name: string): BuiltObject {
    const b = g.builtObjects.find((x): x is BuiltObject => x !== null && x.name === name);
    if (b === undefined) throw new Error(`no ship ${name}`);
    return b;
}

/** A copy of galaxy.rnd at its current state: replays the exact draws the sim is about to make. */
function shadowRnd(g: Galaxy): Random {
    const r = new Random(0);
    r.setState(g.rnd.getState());
    return r;
}

const armorPlates = (b: BuiltObject) => b.components.items.filter((c) => c.category === ComponentCategoryType.Armor);
const damagedCount = (b: BuiltObject) => b.components.items.filter((c) => c.status === ComponentStatus.Damaged).length;
const f32 = Math.fround;

// ---------------------------------------------------------------------------------------------------------------
// (1) One escort vs one pirate ship
// ---------------------------------------------------------------------------------------------------------------

describe('(1) a player escort ordered to Attack a pirate ship', () => {
    /**
     * Seed-1 cast: the player's Javelin 001 (Escort: 2 × Standard Beam — RawDamage 5, Range 190, Energy 12, Speed 360,
     * FireRate 1240 ms; 3 armour plates) and S269 Confederacy's Hidden Aspiration (pirate explorer: unarmed, shields 100,
     * 4 armour plates Value1 10 / Value2 2, 37 components), staged 60 apart in empty space. The target's design flee rule is
     * set to Never and it is not auto-controlled, so it holds still (its stock FleeWhen would make it Escape at 50% shields,
     * BuiltObject.1.cs 1520 ShouldFleeFrom — a behaviour, not what is being measured here).
     */
    function stage(distance: number, disableEngines = false): { g: Galaxy; esc: BuiltObject; pir: BuiltObject } {
        const g = cachedTickGame(gameData).galaxy;
        const esc = ship(g, 'Javelin 001');
        const pir = ship(g, 'Hidden Aspiration');
        expect(pir.empire!.pirateEmpireBaseHabitat).not.toBeNull();
        const s = emptySpot(g);
        builtObjectMission(pir.mission)?.clear();
        pir.isAutoControlled = false;
        pir.fleeWhen = BuiltObjectFleeWhen.Never;
        pir.design.fleeWhen = BuiltObjectFleeWhen.Never; // ShouldFleeFrom (BuiltObject.1.cs 1551) reads Design.FleeWhen
        pir.targetSpeed = 0;
        pir.preferredSpeed = 0;
        pir.currentSpeed = 0;
        if (disableEngines) {
            // Engines knocked out: TopSpeed 0, so neither ShouldFleeFrom (BuiltObject.1.cs 1522) nor AssignRepairMission
            // (Empire.4.cs 4866) moves it; not auto-controlled, so CleanupInvalidShips (Empire.8.cs 2903) keeps it.
            for (const c of pir.components.items) if (c.category === ComponentCategoryType.Engine) c.status = ComponentStatus.Damaged;
            pir.reDefine();
            expect(pir.topSpeed).toBe(0);
        }
        place(g, esc, s.x, s.y);
        place(g, pir, s.x + distance, s.y);
        esc.currentEnergy = esc.reactorStorageCapacity;
        // The Javelin design's tactics are AllWeapons: SetOptimalAttackRanges (BuiltObject.2.cs 131) holds it at
        // [BeamWeaponsMinRange × 0.65, × 0.9] = [123, 171], where the Bacon fall-off leaves a 5-damage beam < 1 — a hull
        // hit of (int)(0.67 + 0.5) = 1 never beats an armour plate's Value2 2 (BuiltObject.2.cs 6437), so a lone Javelin
        // can empty the shields but never destroy anything (faithful). Point Blank tactics (a design setting) hold it at
        // [PointBlankWeaponsRange 50 × 0.7, 50] where a beam hits for ~3.7.
        esc.design.tacticsWeakerShips = BattleTactics.PointBlank;
        esc.design.tacticsStrongerShips = BattleTactics.PointBlank;
        return { g, esc, pir };
    }

    it('weapon and target stats are the seed-1 designs the hand-worked values below use', () => {
        const { esc, pir } = stage(60);
        expect(esc.weapons.map((w) => [ComponentType[w.component.type], w.rawDamage, w.range, w.energyRequired, w.speed, w.fireRate])).toEqual([
            ['WeaponBeam', 5, 190, 12, 360, 1240],
            ['WeaponBeam', 5, 190, 12, 360, 1240],
        ]);
        expect(pir.firepowerRaw).toBe(0);
        expect(pir.shieldsCapacity).toBe(100);
        expect(armorPlates(pir).map((c) => [c.value1, c.value2])).toEqual([[10, 2], [10, 2], [10, 2], [10, 2]]);
        expect(pir.armorReinforcingFactor).toBe(0);
        expect(pir.damageReduction).toBe(0);
        // No modifiers in the hit roll: TargettingModifier / CountermeasureModifier 0, empire factors 1.0, no captains.
        expect([esc.targettingModifier, esc.fleetTargettingBonus, pir.countermeasureModifier, pir.fleetCountermeasureBonus]).toEqual([0, 0, 0, 0]);
        expect([esc.empire!.targettingFactor, pir.empire!.countermeasuresFactor]).toEqual([1, 1]);
        expect(captainBonuses(esc)?.targeting ?? 100).toBe(100);
        expect(captainBonuses(pir)?.countermeasures ?? 100).toBe(100);
    });

    it('one shot, hand-worked: FireWeaponsAtTarget jitter + DetermineHitTarget + Fire, draw for draw (BuiltObject.1.cs 5089 / 5243, Weapon.cs 185 / 253)', () => {
        const { g, esc, pir } = stage(150);
        pir.currentSpeed = 50; // a moving target
        for (const w of esc.weapons) {
            w.reset();
            w.lastFired = MIN_TIME;
        }
        const now = g.nowMs;
        const energy0 = esc.currentEnergy;
        const sh = shadowRnd(g);
        const before = g.rnd.drawCount;
        fireWeaponsAtTarget(g, esc, 150, pir, now, false);
        // Hand-worked per weapon (BuiltObject.1.cs 5194-5198, 5243-5340):
        //   jitter  = NextDouble × 800 − 400; fires when (now − LastFired) ≥ 1240 + jitter (never fired: always);
        //   num     = Range 190 (no fleet / captain range bonus); num2 = 190 − 150 = 40; hitRangeChance = 0.15 + 40/190;
        //   val     = 10 / Max(1, CurrentSpeed 50) = 0.2 → clamped to [0.7, 5] = 0.7 (target not a Fighter);
        //   num3    = CountermeasureModifier 0 + FleetCountermeasureBonus 0 + (CountermeasuresFactor 1 − 1) × 100 = 0;
        //   num5    = TargettingModifier 0 + FleetTargettingBonus 0 + (TargettingFactor 1 − 1) × 100 = 0 (Beam: no ±10);
        //   num7    = 0.7 × (hitRangeChance + NextDouble + 0) — hits when > 0.5, i.e. NextDouble > 0.5/0.7 − 0.3605 = 0.3537;
        //   then Next(0, 12) == 0 flips it (a sure hit misses; a miss inside range hits);
        //   Fire (Weapon.cs 253): hit → heading = angle + (±NextDouble × 0.15) with Next(0, 2) == 0 → negative;
        //                         miss → num = (0.5 − hitRangeChance) × NextDouble × 0.4 (min 0.03), Next(0, 2) sign.
        const hitRangeChance = 0.15 + 40 / 190;
        expect(hitRangeChance).toBeCloseTo(0.36052631578947, 12);
        for (const w of esc.weapons) {
            const jitter = sh.nextDouble() * 800.0 - 400.0;
            expect(now - MIN_TIME >= 1240 + jitter).toBe(true);
            const r = sh.nextDouble();
            let num7 = 0.7 * (hitRangeChance + r + 0);
            expect(num7 > 0.5).toBe(r > 0.5 / 0.7 - hitRangeChance);
            if (num7 > 0.5 && sh.next(0, 12) === 0) num7 = 0;
            else if (num7 <= 0.5 && sh.next(0, 12) === 0) num7 = 1; // num2 = 40 > 0
            const willHit = num7 > 0.5;
            expect(w.willHitTarget).toBe(willHit);
            expect(w.lastFired).toBe(now);
            expect(w.distanceTravelled).toBe(1); // Weapon.cs 199: DistanceTravelled = 1 (not an area weapon)
            expect(w.distanceFromTarget).toBe(f32(150));
            expect(w.target).toBe(pir);
            let heading: number;
            if (willHit) {
                let num = sh.nextDouble() * 0.15;
                if (sh.next(0, 2) === 0) num *= -1.0;
                heading = f32(f32(0) + f32(num)); // DetermineAngle(firer → target on the +x axis) = 0
            } else {
                let num = (0.5 - hitRangeChance) * sh.nextDouble() * 0.4;
                if (num < 0.03) num += 0.03;
                if (sh.next(0, 2) === 0) num *= -1.0;
                heading = f32(f32(num) + f32(0));
            }
            expect(w.heading).toBe(heading);
        }
        expect(g.rnd.getState()).toEqual(sh.getState());
        expect(g.rnd.drawCount - before).toBeGreaterThanOrEqual(2 * 5); // jitter, hit roll, flip roll, 2 Fire draws each
        // Weapon.cs 272-283: each shot costs EnergyRequired (no fleet / captain energy bonus); the firer joins Attackers.
        expect(esc.currentEnergy).toBe(energy0 - 24);
        expect(pir.attackers).toContain(esc);

        // Fire-rate gate: 400 ms later both beams are still cooling (400 < 1240 − 400); jitter draws only, no shot.
        for (const w of esc.weapons) w.reset();
        const sh2 = shadowRnd(g);
        g.nowMs = now + 400;
        fireWeaponsAtTarget(g, esc, 150, pir, g.nowMs, false);
        for (const w of esc.weapons) {
            expect(400 >= 1240 + (sh2.nextDouble() * 800.0 - 400.0)).toBe(false);
            expect(w.lastFired).toBe(now);
            expect(w.distanceTravelled).toBe(-1);
        }
        expect(g.rnd.getState()).toEqual(sh2.getState());
        // Range gate: at 191 (> Range 190) nothing is even rolled (BuiltObject.1.cs 5162 `num4 >= distanceToTarget`).
        const d0 = g.rnd.drawCount;
        g.nowMs = now + 5000;
        fireWeaponsAtTarget(g, esc, 191, pir, g.nowMs, false);
        expect(g.rnd.drawCount).toBe(d0);
        expect(esc.weapons.every((w) => w.distanceTravelled === -1)).toBe(true);
        // Energy gate: 11 < EnergyRequired 12.
        esc.currentEnergy = 11;
        fireWeaponsAtTarget(g, esc, 150, pir, g.nowMs, false);
        expect(g.rnd.drawCount).toBe(d0);
    });

    it('beam travel and impact: 2 on the launch step, then Speed × dt; hits when the range to target starts growing; power falls off with distance (BuiltObject.1.cs 3737, BaconBuiltObject.cs 3057)', () => {
        const { g, esc, pir } = stage(150);
        pir.currentSpeed = 0;
        const w = esc.weapons[0];
        esc.weapons[1].reset();
        w.reset();
        w.lastFired = MIN_TIME;
        esc.weapons[1].lastFired = g.nowMs; // keep the second beam out of this shot
        // Force a sure hit straight at the target (heading 0) to follow one beam exactly.
        fireWeaponsAtTarget(g, esc, 150, pir, g.nowMs, false);
        w.willHitTarget = true;
        w.heading = 0;
        const t0 = w.lastFired;
        const shields0 = pir.currentShields;
        expect(esc.inView).toBe(false);
        const travelled: number[] = [];
        for (let step = 1; step <= 10 && w.distanceTravelled >= 0 && !w.resetNext; step++) {
            g.nowMs = t0 + step * 100;
            handleWeaponsFiringBuiltObject(g, esc, 0.1, g.nowMs);
            travelled.push(w.distanceTravelled);
        }
        // Step 1: DistanceTravelled ≤ 1 → +2 (flag2: no hit test). Then num8 = (float)Speed 360 × Min(elapsed, timePassed 0.1) = 36.
        // Positions 3, 39, 75, 111, 147 approach the target at 150; at 183 the distance grows (3 → 33) → out of view that is
        // the hit (3818-3826). 183 < Range 190 so it is not a miss (3931).
        expect(travelled).toEqual([3, 39, 75, 111, 147, 183]);
        // Power = WeaponDamageDropoff(5): num = (float)(183 / 190f) × 5; power = Min(Max(0, 5 − num), 5).
        const expectedPower = f32(5 - f32(f32(183 / f32(190)) * 5));
        expect(expectedPower).toBeCloseTo(0.1842105, 6);
        expect(w.power).toBe(expectedPower);
        expect(weaponDamageDropoff(esc, w, 5)).toBe(expectedPower);
        // InflictDamage: CurrentShields 100 ≥ hitPower → shields only (BuiltObject.2.cs 6370-6384).
        expect(pir.currentShields).toBe(f32(shields0 - expectedPower));
        expect(damagedCount(pir)).toBe(0);
        expect(w.resetNext).toBe(true);
    });

    it('damage order: shields, then armour plates (Value2 absorbs, Value1 break roll), then random components (BuiltObject.2.cs 6363-6720)', () => {
        const { g, esc, pir } = stage(60);
        const plates = armorPlates(pir);
        const n = pir.components.items.length;
        // (a) hitPower 40 ≤ shields 100: shields 60, no draws.
        let d = g.rnd.drawCount;
        expect(inflictDamage(g, esc, pir, esc.weapons[0], 40, g.nowMs, 50, 0)).toBe(false);
        expect(pir.currentShields).toBe(60);
        expect(g.rnd.drawCount).toBe(d);
        // (b) hitPower 64.4 > shields 60: num5 = (int)(64.4f − 60 + 0.5f) = 4; shields → 0; first Normal plate: 4 > Value2 2 →
        //     num5 = 2; break roll NextDouble < Max(0.1, 2/10) → plate Damaged; num5 = 2 − 10 = −8; next plate: loop ends
        //     (num5 ≤ 0). DamageReduction 0: num5 = (int)(−8 + 0.49) = −7 → no hull damage, no component draws; then the
        //     explosion: Next(0, 10), Next(0, (int)(√Size × 0.7)), Next(0, 2), Next(0, …), Next(0, 2).
        let sh = shadowRnd(g);
        expect(inflictDamage(g, esc, pir, esc.weapons[0], 64.4, g.nowMs, 50, 0)).toBe(false);
        expect(pir.currentShields).toBe(0);
        const broke = sh.nextDouble() < 0.2;
        expect(plates[0].status).toBe(broke ? ComponentStatus.Damaged : ComponentStatus.Normal);
        expect(plates.slice(1).every((c) => c.status === ComponentStatus.Normal)).toBe(true);
        expect(damagedCount(pir)).toBe(broke ? 1 : 0);
        const m = Math.trunc(Math.sqrt(pir.size) * 0.7);
        sh.next(0, 10);
        sh.next(0, m);
        sh.next(0, 2);
        sh.next(0, m);
        sh.next(0, 2);
        expect(g.rnd.getState()).toEqual(sh.getState());
        // (c) Shields 0, hitPower 60: num5 = 60. Each Normal plate: num5 −= 2, break roll < num5/10 (≥ 1: sure), num5 −= 10.
        //     4 plates (or the 3 left): 60 → 48 → 36 → 24 → 12 (→ 0 if all four were Normal). The remaining hull damage
        //     picks components with Next(0, Count), re-drawing up to 30× while the pick is Damaged, until num5 ≤ 0.
        for (const c of plates) c.status = ComponentStatus.Normal;
        pir.reDefine();
        pir.currentShields = 0;
        sh = shadowRnd(g);
        const undamaged0 = pir.undamagedComponentSize;
        inflictDamage(g, esc, pir, esc.weapons[0], 60, g.nowMs, 50, 0);
        let num5 = 60;
        for (let i = 0; i < 4 && num5 > 0; i++) {
            num5 -= 2;
            expect(sh.nextDouble() < Math.max(0.1, num5 / 10)).toBe(true);
            num5 -= 10;
        }
        expect(num5).toBe(12);
        expect(plates.every((c) => c.status === ComponentStatus.Damaged)).toBe(true);
        num5 = Math.trunc(num5 + 0.49); // DamageReduction 0 (6509-6516)
        const hit: number[] = [];
        const status = pir.components.items.map((c) => c.category === ComponentCategoryType.Armor);
        while (num5 > 0) {
            let k = 0;
            let tries = 0;
            do {
                k = sh.next(0, n);
                tries++;
            } while (tries <= 30 && status[k]);
            status[k] = true;
            hit.push(k);
            num5 -= pir.components.items[k].size;
        }
        for (const k of hit) expect(pir.components.items[k].status).toBe(ComponentStatus.Damaged);
        expect(damagedCount(pir)).toBe(4 + new Set(hit).size);
        expect(pir.undamagedComponentSize).toBeLessThan(undamaged0);
        expect(pir.hasBeenDestroyed).toBe(false);
        // (d) Destruction: UndamagedComponentSize ≤ num5 (6545) → HasBeenDestroyed, Next(10, 20) explosion, ReDefine.
        pir.currentShields = 0;
        expect(inflictDamage(g, esc, pir, esc.weapons[0], pir.size + 1000, g.nowMs, 50, 0)).toBe(true);
        expect(pir.hasBeenDestroyed).toBe(true);
    });

    it('on the harness: the Attack order fires within a second, gated by range and fire rate; shields drop first, armour before components; the target is destroyed and leaves a null slot', () => {
        const { g, esc, pir } = stage(60, true);
        const player = g.playerEmpire!;
        const engines = new Set(pir.components.items.filter((c) => c.status === ComponentStatus.Damaged));
        const r = executeShipAction(g, player, esc, createMissionShipActionAt(BuiltObjectMissionType.Attack, pir, Math.trunc(pir.xpos), Math.trunc(pir.ypos)), true);
        expect(r.ok).toBe(true);
        expect(builtObjectMission(esc.mission)!.type).toBe(BuiltObjectMissionType.Attack);
        expect(builtObjectMission(esc.mission)!.targetBuiltObject).toBe(pir);
        const slot = g.builtObjects.indexOf(pir);
        expect(slot).toBeGreaterThanOrEqual(0);
        const plates = armorPlates(pir);
        const fires: { frame: number; t: number; w: number; dist: number }[] = [];
        const last = esc.weapons.map((w) => w.lastFired);
        let firstArmourHit = -1;
        let allPlatesGone = -1;
        let firstComponentHit = -1;
        let shieldsAtFirstArmourHit = -1;
        let destroyedFrame = -1;
        let frame = 0;
        const t0 = g.nowMs;
        runGameSeconds(g, 90, {
            onFrame: (gg) => {
                frame++;
                esc.weapons.forEach((w, i) => {
                    if (w.lastFired !== last[i]) {
                        last[i] = w.lastFired;
                        fires.push({ frame, t: w.lastFired, w: i, dist: gg.calculateDistance(esc.xpos, esc.ypos, pir.xpos, pir.ypos) });
                    }
                });
                if (firstArmourHit < 0 && plates.some((c) => c.status === ComponentStatus.Damaged)) {
                    firstArmourHit = frame;
                    shieldsAtFirstArmourHit = pir.currentShields;
                }
                if (allPlatesGone < 0 && plates.every((c) => c.status === ComponentStatus.Damaged)) allPlatesGone = frame;
                if (firstComponentHit < 0 && pir.components.items.some((c) => c.category !== ComponentCategoryType.Armor && !engines.has(c) && c.status === ComponentStatus.Damaged)) firstComponentHit = frame;
                if (destroyedFrame < 0 && pir.hasBeenDestroyed) destroyedFrame = frame;
            },
        });
        // Fires within N = 60 frames (1 s): both beams are ready (never fired) and 60 < 190.
        expect(fires.length).toBeGreaterThan(0);
        expect(fires[0].frame).toBeLessThanOrEqual(60);
        expect(fires[0].t - t0).toBeLessThan(1000);
        // Range gate (5162): every shot from within Range 190 (+ this frame's movement).
        for (const f of fires) expect(f.dist).toBeLessThanOrEqual(190 + 2);
        // Fire-rate gate (5194): consecutive shots of one beam ≥ FireRate 1240 − 400 ms apart.
        for (let i = 0; i < 2; i++) {
            const ts = fires.filter((f) => f.w === i).map((f) => f.t);
            for (let k = 1; k < ts.length; k++) expect(ts[k] - ts[k - 1]).toBeGreaterThanOrEqual(1240 - 400);
        }
        // Order (6363-6545): no plate breaks while the shields can take a whole hit (hits here are ≤ 5 < 100: armour is
        // only reached on the hit that empties the shields); a beam hit (≤ 5 after the shields: ≤ 5 − 2 − 10 < 0 per
        // Normal plate) can reach the components only once every plate is Damaged.
        expect(firstArmourHit).toBeGreaterThan(0);
        expect(shieldsAtFirstArmourHit).toBeLessThan(5);
        expect(allPlatesGone).toBeGreaterThan(0);
        expect(firstComponentHit).toBeGreaterThanOrEqual(allPlatesGone);
        // Destroyed, and CompleteTeardown nulls its galaxy slot (BuiltObject.2.cs 5480 `BuiltObjects[index] = null`).
        expect(destroyedFrame).toBeGreaterThan(firstComponentHit);
        expect(pir.hasBeenDestroyed).toBe(true);
        expect(g.builtObjects[slot]).toBeNull();
        expect(g.builtObjects.includes(pir)).toBe(false);
        expect(pir.empire!.builtObjects.includes(pir)).toBe(false);
        // The attacker's mission to a destroyed target is cleared (ClearAllMissionsForTarget, BuiltObject.2.cs 5640).
        expect(builtObjectMission(esc.mission)?.targetBuiltObject ?? null).not.toBe(pir);
        expect(esc.hasBeenDestroyed).toBe(false);
    }, 300000);
});
