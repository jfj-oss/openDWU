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
import type { ShipGroup } from '../src/sim/fleets/shipGroup';
import type { Habitat } from '../src/sim/types';
import type { Empire } from '../src/sim/empire';
import { Troop, TroopList, TroopType } from '../src/sim/cargo';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { generateBuiltObjectFromDesign } from '../src/sim/exploration';
import { calculateForceStrengths, calculatePopulationStrength, resolveInvasionBattles } from '../src/sim/combat/invasion';
import { Random } from '../src/sim/random';
import { runGameSeconds } from '../src/sim/tick/harness';
import { MIN_TIME } from '../src/sim/tick/simTime';
import { updateIndexesForMovement, updatePosition } from '../src/sim/movement';
import { ComponentType } from '../src/sim/data/components';
import { ComponentCategoryType } from '../src/sim/data/policies';
import { ComponentStatus } from '../src/sim/builtObjectComponent';
import { BattleTactics, BuiltObjectFleeWhen } from '../src/sim/data/designSpecifications';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, builtObjectMission } from '../src/sim/missions/mission';
import { ShipActionType, createMissionShipActionAt, createShipAction } from '../src/sim/player/shipAction';
import { executeShipAction } from '../src/sim/player/executeShipAction';
import { captainBonuses } from '../src/sim/characters';
import { fireWeaponsAtTarget, handleWeaponsFiringBuiltObject, rechargeShields, weaponDamageDropoff, weaponFire } from '../src/sim/combat/weapons';
import { evaluateThreats } from '../src/sim/combat/threats';
import { calculateAvailableAssaultPodAttackStrength, calculateBoardingDefenseValue, shouldAttack } from '../src/sim/combat/attackAI';
import { empireRaidStrengthFactor, handleAssaultPodMovement, processBoardingAssault } from '../src/sim/combat/boarding';
import { assignMission } from '../src/sim/missions/assign';
import { inflictDamage } from '../src/sim/combat/damage';
import { Fighter, FighterMissionType, buildNewFighters, calculateMaximumTargetRange, fighterDoTasks, fightersOf, launchAllFighters } from '../src/sim/combat/fighters';
import { baconSettings } from '../src/sim/data/baconSettings';

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

// ---------------------------------------------------------------------------------------------------------------
// (2) A 4-ship fleet against a pirate base
// ---------------------------------------------------------------------------------------------------------------

describe('(2) a 4-ship fleet ordered to attack a pirate base', () => {
    /**
     * S83 Prowlers' S66 Outpost (SmallSpacePort: 8 Missile [6 / 520], 24 Rail Gun [6 / 120], 4 Assault Pod, 1 Tractor Beam;
     * shields 1800) and the player's Enforcer 001/002 (Frigate, size 207) and Colossia 001/002 (Destroyer, size 227), put in
     * a new fleet and staged at 450 / 500 / 400 / 480 from the base (inside Missile range 520).
     */
    function stage(): { g: Galaxy; base: BuiltObject; fleetShips: BuiltObject[] } {
        const g = cachedTickGame(gameData).galaxy;
        const base = ship(g, 'S66 Outpost');
        const names = ['Enforcer 001', 'Enforcer 002', 'Colossia 001', 'Colossia 002'];
        const offsets = [450, 500, 400, 480];
        const fleetShips = names.map((n) => ship(g, n));
        fleetShips.forEach((s, i) => {
            builtObjectMission(s.mission)?.clear();
            place(g, s, base.xpos - offsets[i], base.ypos);
            s.currentEnergy = s.reactorStorageCapacity;
        });
        return { g, base, fleetShips };
    }

    /** Galaxy.7.cs 3681 DetermineThreatLevel for a player ship seen by the pirate base (pirate viewer: num5 = 50, NotMet). */
    function handThreatLevel(g: Galaxy, base: BuiltObject, s: BuiltObject): number {
        const tx = Math.trunc(base.xpos);
        const ty = Math.trunc(base.ypos);
        const dist = Math.sqrt(g.calculateDistanceSquared(s.xpos, s.ypos, tx, ty));
        let num4 = Math.max(1.0, 40000 / 2.0 - dist); // ThreatRange 40000 (Galaxy.3.cs 4974)
        num4 = (num4 * num4) / 1000000.0;
        const num5 = 50; // viewer is a pirate empire (3717-3721), relation not Protection
        const num6 = Math.max(10, Math.trunc(s.size / 10)); // armed (3800)
        return Math.max(1, Math.trunc(num4 * num5 * num6));
    }

    it('the base ranks the fleet by DetermineThreatLevel (closeness² × 50 × Size/10) and DefendBase fires at the top threat first', () => {
        const { g, base, fleetShips } = stage();
        const [e1, e2, c1, c2] = fleetShips;
        expect(fleetShips.map((s) => s.size)).toEqual([207, 207, 227, 227]);
        // Hand-worked: Colossia 001 at 400: (20000 − 400)² / 1e6 × 50 × 22 = 384.16 × 1100 = 422 576;
        // Colossia 002 at 480: 381.0304 × 1100 = 419 133; Enforcer 001 at 450: 382.2025 × 50 × 20 = 382 202;
        // Enforcer 002 at 500: 380.25 × 1000 = 380 250 (the base's coordinates are truncated to int, 3446-3447, which moves these by < 50).
        expect(handThreatLevel(g, base, c1)).toBeCloseTo(422576, -2);
        expect(handThreatLevel(g, base, c2)).toBeCloseTo(419133, -2);
        expect(handThreatLevel(g, base, e1)).toBeCloseTo(382202, -2);
        expect(handThreatLevel(g, base, e2)).toBeCloseTo(380250, -2);
        const { threats, threatLevels } = evaluateThreats(g, base);
        const ours = threats.map((t, i) => ({ t, l: threatLevels[i] })).filter((x) => fleetShips.includes(x.t as BuiltObject));
        // EvaluateThreats (Galaxy.7.cs 3403-3406): sorted by level, descending.
        expect(ours.map((x) => (x.t as BuiltObject).name)).toEqual(['Colossia 001', 'Colossia 002', 'Enforcer 001', 'Enforcer 002']);
        for (const x of ours) expect(x.l).toBe(handThreatLevel(g, base, x.t as BuiltObject));
        for (let i = 1; i < threatLevels.length; i++) expect(threatLevels[i - 1]).toBeGreaterThanOrEqual(threatLevels[i]);
    });

    it('RechargeShields adds Min(ShieldRechargeRate × dt, room, energy) and spends the same energy (BuiltObject.1.cs 2225)', () => {
        const { g, base } = stage();
        // ShieldRechargeRate = Σ (float)Value2 / 10f over the Shields components (BuiltObject.cs 2296 / 3069).
        let rate = 0;
        for (const c of base.components.items) if (c.category === ComponentCategoryType.Shields && c.status === ComponentStatus.Normal) rate = f32(rate + f32(f32(c.value2) / 10));
        expect(base.shieldRechargeRate).toBe(rate);
        expect(rate).toBeCloseTo(5.4, 5); // float sum of the shield components' Value2 / 10
        expect(base.shieldsCapacity).toBe(1800);
        base.currentShields = 1000;
        base.currentEnergy = 600;
        rechargeShields(g, base, 0.5);
        expect(base.currentShields).toBe(f32(1000 + f32(rate * 0.5)));
        expect(base.currentEnergy).toBe(600 - rate * 0.5);
        // Energy-limited: 1 energy → +1 shield.
        base.currentShields = 1000;
        base.currentEnergy = 1;
        rechargeShields(g, base, 0.5);
        expect(base.currentShields).toBe(1001);
        expect(base.currentEnergy).toBe(0);
        // Room-limited: 1799 → 1800 for 1 energy.
        base.currentShields = 1799;
        base.currentEnergy = 600;
        rechargeShields(g, base, 10);
        expect(base.currentShields).toBe(1800);
        expect(base.currentEnergy).toBe(599);
    });

    it('on the harness: the fleet engages the base, the base fires back at its top threat, the fleet keeps the base as its target, and shields recharge per DoTasks at the C# rate', () => {
        const { g, base, fleetShips } = stage();
        const player = g.playerEmpire!;
        executeShipAction(g, player, fleetShips, createShipAction(ShipActionType.CreateNewFleet, null), true);
        const fleet = fleetShips[0].shipGroup as ShipGroup;
        expect(fleet.ships).toEqual(fleetShips);
        const r = executeShipAction(g, player, fleet, createMissionShipActionAt(BuiltObjectMissionType.Attack, base, Math.trunc(base.xpos), Math.trunc(base.ypos)), true);
        expect(r.ok).toBe(true);
        // ShipGroup.AssignMission: every ship gets the fleet's Attack on the base.
        for (const s of fleetShips) {
            expect(builtObjectMission(s.mission)!.type).toBe(BuiltObjectMissionType.Attack);
            expect(builtObjectMission(s.mission)!.targetBuiltObject).toBe(base);
        }
        const expectedFirst = [...fleetShips].sort((a, b) => handThreatLevel(g, base, b) - handThreatLevel(g, base, a))[0];
        expect(expectedFirst.name).toBe('Colossia 001');
        const baseLast = base.weapons.map((w) => w.lastFired);
        const fleetLast = fleetShips.map((s) => s.weapons.map((w) => w.lastFired));
        let firstBaseShot: { frame: number; target: unknown; type: ComponentType } | null = null;
        let fleetShotsAtBase = 0;
        let switched = 0;
        let rechargeChecks = 0;
        let frame = 0;
        let prev = { touch: base.lastTouch, strike: base.lastShieldStrike, shields: base.currentShields, energy: base.currentEnergy };
        runGameSeconds(g, 45, {
            onFrame: () => {
                frame++;
                base.weapons.forEach((w, i) => {
                    if (w.lastFired !== baseLast[i]) {
                        baseLast[i] = w.lastFired;
                        if (firstBaseShot === null && w.target !== null) firstBaseShot = { frame, target: w.target, type: w.component.type };
                    }
                });
                fleetShips.forEach((s, k) =>
                    s.weapons.forEach((w, i) => {
                        if (w.lastFired !== fleetLast[k][i]) {
                            fleetLast[k][i] = w.lastFired;
                            if (w.target === base) fleetShotsAtBase++;
                        }
                    }),
                );
                // The fleet's target choice: while a ship holds the fleet's Attack mission its target stays the base —
                // CheckAssignAttackOnThreat (BuiltObject.1.cs 422) refuses any other threat for a fleet mission unless the
                // fleet allows immediate threat evaluation (false for a player-ordered fleet).
                for (const s of fleetShips) {
                    const m = builtObjectMission(s.mission);
                    if (!s.hasBeenDestroyed && m !== null && m.type === BuiltObjectMissionType.Attack && m.targetBuiltObject !== base) switched++;
                }
                // Per-DoTasks recharge on frames the base was touched and not struck: +Min(rate × dt, room, energy).
                if (base.lastTouch !== prev.touch && base.lastShieldStrike === prev.strike && prev.shields < 1800) {
                    const dt = (base.lastTouch - prev.touch) / 1000;
                    const expected = f32(prev.shields + f32(Math.min(base.shieldRechargeRate * dt, 1800 - prev.shields, prev.energy)));
                    expect(base.currentShields).toBeCloseTo(expected, 3);
                    rechargeChecks++;
                }
                prev = { touch: base.lastTouch, strike: base.lastShieldStrike, shields: base.currentShields, energy: base.currentEnergy };
            },
        });
        expect(fleet.allowImmediateThreatEvaluation).toBe(false);
        // DefendBase (BuiltObject.cs 4557) walks Threats in order: the first base shot is a Missile (the only weapon that
        // reaches 400-500) at the top threat, Colossia 001.
        expect(firstBaseShot).not.toBeNull();
        expect(firstBaseShot!.frame).toBeLessThanOrEqual(60);
        expect(firstBaseShot!.type).toBe(ComponentType.WeaponMissile);
        expect(firstBaseShot!.target).toBe(expectedFirst);
        expect(fleetShotsAtBase).toBeGreaterThan(0);
        expect(base.attackers!.some((a) => fleetShips.includes(a as BuiltObject))).toBe(true);
        expect(switched).toBe(0);
        expect(rechargeChecks).toBeGreaterThan(10);
    }, 300000);
});

// ---------------------------------------------------------------------------------------------------------------
// (3) Carrier fighters: launch, engage, return
// ---------------------------------------------------------------------------------------------------------------

describe('(3) fighters launched by a carrier engage and return per the C# rules', () => {
    /** The player's Sol 2 Space Port (FighterCapacity 160 → 16 Standard Fighters) with its fighters built and ready. */
    function stage(): { g: Galaxy; port: BuiltObject; fighters: Fighter[] } {
        const g = cachedTickGame(gameData).galaxy;
        const port = ship(g, 'Sol 2 Space Port');
        expect(port.fighterCapacity).toBe(160);
        buildNewFighters(g, port);
        const fighters = fightersOf(port)!;
        for (const f of fighters) {
            f.health = 1;
            f.underConstruction = false;
        }
        return { g, port, fighters };
    }

    it('CalculateMaximumTargetRange = 225 × fighterRangeMultiple × TopSpeed² (× 2 for a base carrier) (BaconFighter.cs 30)', () => {
        const { fighters } = stage();
        const f = fighters[0];
        expect(f.specification.name).toBe('Standard Fighter');
        expect(f.topSpeed).toBe(105);
        // BaconSettings.txt fighterRangeMultiple=30 (BaconFighter.cs 19 default 1.0), maximumTargetDistanceSquared 225,
        // starbaseFighterRangeMultiplier 2: 225 × 30 × 105² × 2 = 148 837 500 (≈ 12 200²).
        expect(baconSettings.fighterRangeMultiple).toBe(30);
        expect(calculateMaximumTargetRange(f)).toBe(148837500);
    });

    it('return rules on the intermediate pass (BaconFighter.cs 153 DoTasks): damage (Fighter.cs 502), range (BaconFighter.cs 131), out of ammo (BaconFighter.cs 218)', () => {
        const { g, port, fighters } = stage();
        port.threats = [];
        launchAllFighters(g, port);
        const [hurt, far, dry, fine] = fighters;
        for (const f of [hurt, far, dry, fine]) {
            f.missionType = FighterMissionType.Patrol;
            f.currentTarget = null;
            f.xpos = port.xpos + 500;
            f.ypos = port.ypos;
        }
        // Damage: Health 0.9 < 1 and Standard Fighter DamageRepairRate 0 → ReturnToCarrier (no self-repair exemption,
        // which needs DamageRepairRate > 0 and Health > 0.75).
        expect(hurt.specification.damageRepairRate).toBe(0);
        hurt.health = f32(0.9);
        // Range: 13 000 from the base carrier (≥ 12 685 after this pass's 3 s of movement at ≤ TopSpeed 105): > √148 837 500 ≈ 12 200.
        far.xpos = port.xpos + 13000;
        // Out of ammo: a '*' name mark (CheckOutOfAmmo) with weapon 0 not in flight.
        dry.name += '*';
        const t = g.nowMs + 3000; // ≥ IntermediateProcessingSpan since LastLongTouch (launch time)
        for (const f of [hurt, far, dry, fine]) {
            f.lastLongTouch = g.nowMs;
            f.lastTouch = g.nowMs;
        }
        g.nowMs = t;
        // Out of view a fighter is leashed to its carrier (Fighter.cs 1805-1829: Patrol beyond 600 is put back at 600,
        // other missions at 1500), so the range rule can only bite in view: `far` is processed in view.
        for (const f of [hurt, dry, fine]) fighterDoTasks(g, f, t, false);
        fighterDoTasks(g, far, t, true);
        expect(g.calculateDistance(fine.xpos, fine.ypos, port.xpos, port.ypos)).toBeLessThanOrEqual(600 + 1e-6);
        expect(hurt.missionType).toBe(FighterMissionType.ReturnToCarrier);
        expect(far.missionType).toBe(FighterMissionType.ReturnToCarrier);
        expect(dry.missionType).toBe(FighterMissionType.ReturnToCarrier);
        expect(dry.name.includes('*')).toBe(false);
        expect(fine.missionType).not.toBe(FighterMissionType.ReturnToCarrier);
        // ReturnToCarrier (Fighter.cs 1919): heading to the carrier at TopSpeed.
        expect(hurt.targetSpeed).toBe(hurt.topSpeed);
        // Just inside the range (≤ 12 100: 146 410 000 ≤ 148 837 500) a patrolling, healthy fighter stays out.
        const { g: g2, port: port2, fighters: f2 } = stage();
        port2.threats = [];
        launchAllFighters(g2, port2);
        const inside = f2[0];
        inside.missionType = FighterMissionType.Patrol;
        inside.xpos = port2.xpos + 11800; // ≤ 12 100 after 3 s at ≤ 105
        inside.ypos = port2.ypos;
        inside.lastLongTouch = g2.nowMs;
        inside.lastTouch = g2.nowMs;
        g2.nowMs += 3000;
        fighterDoTasks(g2, inside, g2.nowMs, true);
        expect(inside.missionType).not.toBe(FighterMissionType.ReturnToCarrier);
        // Standard Fighters carry a beam: CheckOutOfAmmo (BaconFighter.cs 186) only marks missile / torpedo craft.
        expect(inside.weapons.some((w) => w.type === ComponentType.WeaponMissile || w.type === ComponentType.WeaponTorpedo)).toBe(false);
    });

    it('on the harness: the base launches its fighters at a pirate within 3000 (ShouldAttack, BuiltObject.1.cs 956), they attack it, fire and wear it down', () => {
        const { g, port, fighters } = stage();
        const pir = ship(g, 'Elite Scorpion');
        builtObjectMission(pir.mission)?.clear();
        pir.isAutoControlled = false;
        pir.design.fleeWhen = BuiltObjectFleeWhen.Never;
        for (const c of pir.components.items) if (c.category === ComponentCategoryType.Engine) c.status = ComponentStatus.Damaged;
        pir.reDefine(); // engines out: it holds position (see (1))
        place(g, pir, port.xpos + 1500, port.ypos + 500);
        // A base (WarpSpeed 0) only engages within 3000 (9 000 000 squared, BuiltObject.1.cs 973).
        expect(g.calculateDistanceSquared(port.xpos, port.ypos, pir.xpos, pir.ypos)).toBeLessThan(9000000);
        expect(shouldAttack(g, port, pir, g.nowMs)).toBe(true);
        const shields0 = pir.currentShields;
        let launchedFrame = -1;
        let fired = 0;
        let frame = 0;
        let pursued = false;
        runGameSeconds(g, 40, {
            onFrame: () => {
                frame++;
                if (launchedFrame < 0 && fighters.some((f) => !f.onboardCarrier)) launchedFrame = frame;
                for (const f of fighters) if (f.weapons[0].distanceTravelled > 0) fired++;
                if ((pir.pursuers ?? []).some((p) => fighters.includes(p as Fighter))) pursued = true;
            },
        });
        // DefendBase (BuiltObject.cs 4557) → LaunchAllFighters once a threat ShouldAttack says yes.
        expect(launchedFrame).toBeGreaterThan(0);
        expect(launchedFrame).toBeLessThanOrEqual(300);
        expect(fighters.every((f) => !f.onboardCarrier)).toBe(true);
        expect(pursued).toBe(true);
        expect(fired).toBeGreaterThan(0);
        expect(pir.hasBeenDestroyed || pir.currentShields < shields0 || damagedCount(pir) > 0).toBe(true);
    }, 300000);
});

// ---------------------------------------------------------------------------------------------------------------
// (4) Boarding a disabled ship
// ---------------------------------------------------------------------------------------------------------------

describe('(4) boarding: an assault-pod ship boards and captures a disabled ship', () => {
    /**
     * Black Pillagers' Worthy Firelance (1 Assault Pod: RawDamage 50, Range 140; empire BoardingAttackFactor 1, dominant
     * race TroopStrength 138, pirate RaidStrengthFactor 1.25) against the player's Sol Starseeker (3 Hab Modules, no troops;
     * BoardingDefenseFactor 1, TroopStrength 121) with its shields down and engines knocked out, 100 apart.
     */
    function stage(): { g: Galaxy; att: BuiltObject; tgt: BuiltObject } {
        const g = cachedTickGame(gameData).galaxy;
        const att = ship(g, 'Worthy Firelance');
        const tgt = ship(g, 'Sol Starseeker');
        builtObjectMission(tgt.mission)?.clear();
        tgt.isAutoControlled = false;
        for (const c of tgt.components.items) if (c.category === ComponentCategoryType.Engine) c.status = ComponentStatus.Damaged;
        tgt.reDefine();
        tgt.currentShields = 0;
        const s = emptySpot(g);
        place(g, tgt, s.x, s.y);
        place(g, att, s.x + 100, s.y);
        return { g, att, tgt };
    }

    it('assault strength vs defence, hand-worked (BuiltObject.1.cs 2626 HandleAssaultPodMovement, 3314 / 3399)', () => {
        const { g, att, tgt } = stage();
        const pe = att.empire!;
        expect([pe.boardingAttackFactor, pe.dominantRace!.troopStrength, empireRaidStrengthFactor(pe)]).toEqual([1, 138, 1.25]);
        const pod = att.weapons.find((w) => w.component.type === ComponentType.AssaultPod)!;
        expect([pod.rawDamage, pod.range]).toEqual([50, 140]);
        // Attack per pod: (short)(RawDamage 50 × TroopStrength/100 1.38 × BoardingAttackFactor 1 × AssaultPodStrengthMultiplier 1
        // × RaidStrengthFactor 1.25) = (short)86.25 = 86.
        expect(calculateAvailableAssaultPodAttackStrength(g, att, g.nowMs)).toBe(86);
        // Defence: per Normal Hab Module (int)(20 × 1.21 × BoardingDefenseFactor 1 × RaidStrengthFactor 1) = 24; 3 modules, no
        // troops, no pods: 72.
        expect(tgt.components.items.filter((c) => c.type === ComponentType.HabitationHabModule).length).toBe(3);
        expect(tgt.empire!.dominantRace!.troopStrength).toBe(121);
        expect(calculateBoardingDefenseValue(g, tgt, g.nowMs)).toEqual({ value: 72, fixedDefenseValue: 72 });
        // A pod that reaches its target adds its strength to AssaultAttackValue and marks the boarding empire.
        weaponFire(g, pod, att, tgt, 100, g.nowMs, true, 1.0);
        pod.x = tgt.xpos + 5;
        pod.y = tgt.ypos;
        pod.distanceFromTarget = f32(5);
        handleAssaultPodMovement(g, att, 0.01);
        expect(tgt.assaultAttackValue).toBe(86);
        expect(tgt.assaultAttackEmpireId).toBe(pe.empireId);
        expect(pod.distanceTravelled).toBe(-1); // Reset on arrival
    });

    it('one ProcessBoardingAssault step, draw for draw (BuiltObject.1.cs 2954)', () => {
        const { g, tgt, att } = stage();
        tgt.assaultAttackValue = 86;
        tgt.assaultAttackEmpireId = att.empire!.empireId;
        tgt.assaultDefenseValue = 0; // → CalculateBoardingDefenseValue = 72 first
        const sh = shadowRnd(g);
        const tp = 3;
        processBoardingAssault(g, tgt, g.nowMs, tp);
        const num = Math.max(0.5, Math.min(2.0, 86 / 72));
        const num2 = (tp * (2.0 + sh.nextDouble() * 2.0)) / num;
        const num3 = tp * (2.0 + sh.nextDouble() * 2.0) * num;
        expect(tgt.assaultAttackValue).toBe(Math.max(0, Math.trunc(86 - num2)));
        expect(tgt.assaultDefenseValue).toBe(Math.max(0, Math.trunc(72 - num3)));
        if (num2 + num3 > sh.nextDouble() * 10.0 * tp) {
            sh.next(20000, 30000);
            expect(tgt.disabledComponentIndexes!.length).toBe(1); // DisableRandomComponent (3462)
        }
        expect(g.rnd.getState()).toEqual(sh.getState());
        expect(tgt.empire).toBe(g.playerEmpire);
        // Defence exhausted while attackers remain → captured by AssaultAttackEmpireId (3004 onwards).
        tgt.assaultAttackValue = 40;
        tgt.assaultDefenseValue = 1;
        processBoardingAssault(g, tgt, g.nowMs, tp); // num3 ≥ 3 × 2 × 0.5 > 1 → defence 0
        expect(tgt.assaultDefenseValue === 0 || tgt.empire === att.empire).toBe(true);
        expect(tgt.empire === att.empire || tgt.hasBeenDestroyed).toBe(true);
    });

    it('on the harness: a Capture mission launches the pod, the boarding fight runs down both sides and the ship changes owner', () => {
        const { g, att, tgt } = stage();
        const player = g.playerEmpire!;
        assignMission(g, att, BuiltObjectMissionType.Capture, tgt, null, BuiltObjectMissionPriority.High);
        let firstAttack = -1;
        let captured = -1;
        let frame = 0;
        const defence: number[] = [];
        runGameSeconds(g, 40, {
            onFrame: () => {
                frame++;
                if (firstAttack < 0 && tgt.assaultAttackValue > 0) {
                    firstAttack = frame;
                    expect(tgt.assaultAttackValue).toBe(86); // one pod
                }
                if (tgt.assaultAttackValue > 0) defence.push(tgt.assaultDefenseValue);
                if (captured < 0 && tgt.empire === att.empire) captured = frame;
            },
        });
        expect(firstAttack).toBeGreaterThan(0);
        expect(firstAttack).toBeLessThanOrEqual(120);
        expect(defence[0]).toBe(72);
        for (let i = 1; i < defence.length; i++) expect(defence[i]).toBeLessThanOrEqual(defence[i - 1]);
        expect(captured).toBeGreaterThan(firstAttack);
        expect(tgt.empire).toBe(att.empire);
        expect(att.empire!.builtObjects).toContain(tgt);
        expect(player.builtObjects).not.toContain(tgt);
        expect(tgt.assaultAttackValue).toBe(0);
    }, 300000);
});

// ---------------------------------------------------------------------------------------------------------------
// (5) Invasion of an independent colony
// ---------------------------------------------------------------------------------------------------------------

describe('(5) troop transports invade an independent colony', () => {
    /** Seed-1: Dhayu 3 (independent, 567 345 080 Dhayut, no troops yet); the player's Sabre troop-transport design. */
    function stage(): { g: Galaxy; colony: Habitat; transport: BuiltObject } {
        const g = cachedTickGame(gameData).galaxy;
        const p = g.playerEmpire!;
        const colony = g.independentColonies.find((h) => h.name === 'Dhayu 3')!;
        expect(colony.empire).toBe(g.independentEmpire);
        const design = p.designs.find((d) => d.name === 'Sabre')!;
        // Empire.cs 4341 GenerateBuiltObjectFromDesign: every component Normal (4346) — a working transport.
        const transport = generateBuiltObjectFromDesign(g, p, design, 'Trooper 1', true, colony.xpos + 800, colony.ypos);
        expect(transport.subRole).toBe(BuiltObjectSubRole.TroopTransport);
        expect(transport.troopCapacity).toBe(300);
        expect(transport.topSpeed).toBeGreaterThan(0);
        // Six of the capital's infantry (Attack 121, readiness 100, size 100) board it.
        transport.troops = new TroopList();
        const cap = p.capital!;
        for (const tr of cap.troops!.items.slice(0, 6)) {
            cap.troops!.remove(tr);
            tr.builtObject = transport;
            transport.troops.add(tr);
        }
        return { g, colony, transport };
    }

    function troop(g: Galaxy, empire: Empire, attack: number, defend: number, readiness = 100): Troop {
        return new Troop('t', TroopType.Infantry, attack, defend, 100, readiness, empire, empire.dominantRace);
    }

    it('one ResolveInvasionBattles round, hand-worked (Habitat.cs 3365-3470; InflictTroopLosses 4978)', () => {
        const { g, colony } = stage();
        const p = g.playerEmpire!;
        const ind = g.independentEmpire!;
        colony.troops = new TroopList();
        colony.invadingTroops = new TroopList();
        colony.invasionStats = null;
        const defenders = [troop(g, ind, 50, 300), troop(g, ind, 50, 300)];
        const invaders = [troop(g, p, 121, 100), troop(g, p, 121, 100), troop(g, p, 121, 100)];
        for (const d of defenders) {
            d.colony = colony;
            colony.troops.add(d);
        }
        for (const a of invaders) {
            a.colony = colony;
            colony.invadingTroops.add(a);
            p.troops.add(a);
        }
        // Strengths: CalculateForceStrengths (BaconHabitat.cs 1188) = (int)((1 + Σ modifiers) × TotalStrength);
        // TotalDefendStrength 2 × 300 × 100 = 60 000, TotalAttackStrength 3 × 121 × 100 = 36 300.
        expect(colony.troops.totalDefendStrength).toBe(60000);
        expect(colony.invadingTroops.totalAttackStrength).toBe(36300);
        const fs = calculateForceStrengths(g, colony, ind, p, colony.troops, null, colony.invadingTroops, null);
        let { attackingStrength, defendingStrength } = fs;
        // CalculatePopulationStrength (Habitat.cs 4336): an independent colony defends (isDefending) with
        // Population / 5 000 000 × aggression; added to the defence because it has troops (3431-3434).
        const ps = calculatePopulationStrength(g, colony, p, ind);
        expect(ps.isDefending).toBe(true);
        expect(ps.result % Math.trunc(colony.population.totalAmount / 5000000)).toBe(0); // 113 × the race's aggression level
        defendingStrength += ps.result;
        const sh = shadowRnd(g);
        const tp = 10;
        resolveInvasionBattles(g, colony, tp);
        // 3441-3467:
        const num2 = Math.min(2.0, Math.max(0.5, defendingStrength / (attackingStrength + 1.0)));
        const num3 = Math.min(2.0, Math.max(0.5, attackingStrength / (defendingStrength + 1.0)));
        const num4 = Math.max(0.5, Math.sqrt((attackingStrength + defendingStrength) / 10000.0) / 2.0);
        let num6 = (0.8 + sh.nextDouble() * 0.4) * num2 * num4 * tp; // invader losses
        let num8 = (0.8 + sh.nextDouble() * 0.4) * num3 * num4 * tp; // defender losses
        const num9 = attackingStrength - num6;
        const num10 = defendingStrength - num8;
        if (num9 > num10) {
            if (num10 <= 0) num6 = Math.min(attackingStrength * 0.9, Math.max(0, num6 + num10));
            else if (num9 / num10 >= 10) num6 = Math.min(attackingStrength * 0.9, Math.max(0, num6 - num10));
        } else if (num9 <= 0) num8 = Math.max(0, num8 + num9);
        // InflictTroopLosses: the whole loss lands on one random troop (Next(0, Count)) while its readiness covers it.
        const hitInv = sh.next(0, 3);
        const hitDef = sh.next(0, 2);
        expect(num6).toBeLessThan(100);
        expect(num8).toBeLessThan(100);
        invaders.forEach((t, i) => expect(t.readiness).toBe(i === hitInv ? f32(100 - f32(num6)) : 100));
        defenders.forEach((t, i) => expect(t.readiness).toBe(i === hitDef ? f32(100 - f32(num8)) : 100));
        // Population casualties (3470-3498): one NextDouble.
        sh.nextDouble();
        expect(g.rnd.getState()).toEqual(sh.getState());
        // Not yet won: attack / defence < 20 (3771).
        expect(attackingStrength / defendingStrength).toBeLessThan(20);
        expect(colony.empire).toBe(ind);
    });

    it('success needs attack / defence ≥ 20 (Habitat.cs 3771); an undefended colony falls on the first round', () => {
        const { g, colony } = stage();
        const p = g.playerEmpire!;
        colony.troops = new TroopList();
        colony.invadingTroops = new TroopList();
        colony.invasionStats = null;
        const a = troop(g, p, 121, 100);
        a.colony = colony;
        colony.invadingTroops.add(a);
        p.troops.add(a);
        // No defending troops: population strength is not added to the defence (3431 needs Troops.Count > 0), so
        // defendingStrength 0 and num21 = attack / 0 = +∞ ≥ 20.
        const before = g.invasionSuccesses;
        resolveInvasionBattles(g, colony, 10);
        expect(g.invasionSuccesses).toBe(before + 1);
        expect(colony.empire).toBe(p);
        expect(p.colonies).toContain(colony);
    });

    it('on the harness: an Attack order sends the transport in, the troops land and take the colony', () => {
        const { g, colony, transport } = stage();
        const p = g.playerEmpire!;
        const troops = transport.troops!.items.slice();
        const r = executeShipAction(g, p, transport, createMissionShipActionAt(BuiltObjectMissionType.Attack, colony, Math.trunc(colony.xpos), Math.trunc(colony.ypos)), true);
        expect(r.ok).toBe(true);
        expect(builtObjectMission(transport.mission)!.type).toBe(BuiltObjectMissionType.Attack);
        let landed = -1;
        let taken = -1;
        let frame = 0;
        const successes0 = g.invasionSuccesses;
        runGameSeconds(g, 70, {
            onFrame: () => {
                frame++;
                if (landed < 0 && colony.invadingTroops !== null && troops.some((t) => colony.invadingTroops!.contains(t))) landed = frame;
                if (taken < 0 && colony.empire === p) taken = frame;
            },
        });
        expect(landed).toBeGreaterThan(0);
        expect(taken).toBeGreaterThanOrEqual(landed);
        expect(g.invasionSuccesses).toBeGreaterThan(successes0);
        expect(p.colonies).toContain(colony);
        expect(g.independentEmpire!.colonies).not.toContain(colony);
        // The invaders became the garrison (3771 onwards: InvadingTroops → Troops).
        expect(troops.some((t) => colony.troops!.contains(t))).toBe(true);
    }, 300000);
});
