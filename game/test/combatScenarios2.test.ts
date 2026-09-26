// Combat verification part 2 (tasks/COMBAT-VERIFICATION-2026-09-26.md, "Part 2"): staged scenarios on the seed-1 harness
// game, every expected value hand-worked from the decompiled C# (file:line cited next to each assertion).
//
//   (1) area weapons: the expanding blast ring (BuiltObject.1.cs 4340-4415 HandleWeaponsFiring IonPulse / AreaDestruction),
//       its fall-off (BaconBuiltObject.cs 3057 WeaponDamageDropoff), friendly fire (the ring hits every ship but the firer)
//       and the firing gate that keeps friendly ships out of the blast (BuiltObject.1.cs 3706 CheckFireAreaWeaponAtTarget);
//       shields absorbing a blast (BuiltObject.2.cs 6363 InflictDamage);
//   (2) missiles and point defence: missile flight (BuiltObject.1.cs 4091-4198: launch 10, ramp to Speed over the first 120,
//       homing), the Bacon missile intercept (BaconBuiltObject.cs 5032 InterceptMissiles: PD / beams / phasers / rail guns,
//       a sure intercept once the missile has flown 100), point defence against assault pods (BuiltObject.1.cs 2905
//       FireAtAssaultPods, 5202 DetermineHitTarget) and the shot-down pod (3873-3878 Power = float.MaxValue); reload = FireRate
//       (ships carry no missile ammunition in the C#);
//   (3) planetary bombardment (BuiltObject.1.cs 4899 BombardTarget, BuiltObject.2.cs 5816 InflictBombardDamage) and the
//       Xaraktor virus (Main.Part7.cs 1020-1043 DeployVirus, Empire.10.cs 4518 CanDeployXaraktorVirus);
//   (4) pirate raids (BuiltObject.1.cs 2626 HandleAssaultPodMovement → 2779 PerformRaidColonyInvasion; Galaxy.5.cs 4953
//       DoRaidBonuses) and looting (Empire.LootingFactor);
//   (5) AI retargeting (BuiltObject.1.cs 245 ThreatEvaluation, 207 PerformThreatEvaluation, 390 CheckAssignAttackOnThreat);
//   (6) repair and retreat (BuiltObject.1.cs 1520 ShouldFleeFrom, Empire.4.cs 4863 AssignRepairMission, BaconBuiltObject.cs
//       4763 DoRepairs, ConstructionQueue.cs 1142 IdentifyComponentToBuild).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { BuiltObject } from '../src/sim/builtObject';
import { Random } from '../src/sim/random';
import { MIN_TIME } from '../src/sim/tick/simTime';
import { updateIndexesForMovement, updatePosition } from '../src/sim/movement';
import { ComponentType } from '../src/sim/data/components';
import { ComponentCategoryType } from '../src/sim/data/policies';
import { BuiltObjectComponent, ComponentStatus } from '../src/sim/builtObjectComponent';
import { buildComponentStatic, type ComponentDefinition } from '../src/sim/componentStatic';
import { Weapon } from '../src/sim/weapon';
import { BuiltObjectFleeWhen } from '../src/sim/data/designSpecifications';
import { builtObjectMission } from '../src/sim/missions/mission';
import {
    checkFireAreaWeaponAtTarget,
    handleWeaponsFiringBuiltObject,
    interceptMissiles,
    weaponDamageDropoff,
    weaponFire,
} from '../src/sim/combat/weapons';
import { fireAtAssaultPods } from '../src/sim/combat/boarding';

let gameData: GameData;
let componentDefs: Map<number, ComponentDefinition>;
beforeAll(async () => {
    gameData = await loadGameDataFs();
    componentDefs = buildComponentStatic(gameData).byId;
}, 180000);

// ---------------------------------------------------------------------------------------------------------------
// Staging helpers (as in combatScenarios.test.ts)
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

/** Holds a ship still: no mission, not auto-controlled, never flees (BuiltObject.1.cs 1551 reads Design.FleeWhen). */
function hold(b: BuiltObject): void {
    builtObjectMission(b.mission)?.clear();
    b.isAutoControlled = false;
    b.fleeWhen = BuiltObjectFleeWhen.Never;
    b.design.fleeWhen = BuiltObjectFleeWhen.Never;
    b.targetSpeed = 0;
    b.preferredSpeed = 0;
    b.currentSpeed = 0;
}

/** A copy of galaxy.rnd at its current state: replays the exact draws the sim is about to make. */
function shadowRnd(g: Galaxy): Random {
    const r = new Random(0);
    r.setState(g.rnd.getState());
    return r;
}

/** A fresh weapon of components.txt id `id` (Weapon.cs 111 Weapon(BuiltObjectComponent): the component's own values). */
function newWeapon(id: number): Weapon {
    const def = componentDefs.get(id);
    if (def === undefined) throw new Error(`no component ${id}`);
    return Weapon.fromBuiltObjectComponent(new BuiltObjectComponent(def, ComponentStatus.Normal));
}

const f32 = Math.fround;
const damagedCount = (b: BuiltObject) => b.components.items.filter((c) => c.status === ComponentStatus.Damaged).length;

// ---------------------------------------------------------------------------------------------------------------
// (1) Area weapons
// ---------------------------------------------------------------------------------------------------------------

describe('(1) area weapons', () => {
    /**
     * The player's Javelin 001 carries an Intimidator Surgewave (components.txt id 19, WeaponAreaDestruction: Value1 damage 35,
     * Value2 range 220, Value3 energy 54, Value4 expansion speed 120, Value5 13, Value6 fire rate 8200). The target is S269
     * Confederacy's Hidden Aspiration 150 ahead; S83 Confederacy's Surly Orbit sits 50 beyond the target (a second enemy)
     * and the player's own Javelin 002 is the friendly ship. All shields 100, no fleets, no captains.
     */
    function stage() {
        const g = cachedTickGame(gameData).galaxy;
        const esc = ship(g, 'Javelin 001');
        const tgt = ship(g, 'Hidden Aspiration');
        const enemy2 = ship(g, 'Surly Orbit');
        const friend = ship(g, 'Javelin 002');
        for (const b of [esc, tgt, enemy2, friend]) hold(b);
        const s = emptySpot(g);
        place(g, esc, s.x, s.y);
        place(g, tgt, s.x + 150, s.y);
        place(g, enemy2, s.x + 150, s.y + 50);
        place(g, friend, s.x + 150, s.y + 300);
        esc.currentEnergy = esc.reactorStorageCapacity;
        const area = newWeapon(19);
        esc.weapons.push(area);
        return { g, esc, tgt, enemy2, friend, area, s };
    }

    it('Intimidator Surgewave stats and the firing gate: no friendly ship within √0.7 × Range of the target (BuiltObject.1.cs 3706-3735)', () => {
        const { g, esc, tgt, friend, area, s } = stage();
        expect([ComponentType[area.component.type], area.rawDamage, area.range, area.energyRequired, area.speed, area.damageLoss, area.fireRate]).toEqual(['WeaponAreaDestruction', 35, 220, 54, 120, 13, 8200]);
        expect(esc.shipGroup).toBeNull();
        // num = Range² × 0.7 = 48 400 × 0.7 = 33 880: a friendly ship (same Empire, not the firer) closer than √33 880 = 184.07
        // to the target blocks the shot; enemies never do.
        expect(checkFireAreaWeaponAtTarget(g, esc, area, tgt)).toBe(true); // friend 300 away
        place(g, friend, s.x + 150, s.y + 184);
        expect(checkFireAreaWeaponAtTarget(g, esc, area, tgt)).toBe(false); // 184² = 33 856 < 33 880
        place(g, friend, s.x + 150, s.y + 185);
        expect(checkFireAreaWeaponAtTarget(g, esc, area, tgt)).toBe(true); // 185² = 34 225
        // The firer itself never blocks (builtObject != this), even standing on the target.
        place(g, esc, tgt.xpos, tgt.ypos + 1);
        expect(checkFireAreaWeaponAtTarget(g, esc, area, tgt)).toBe(true);
        // Area Gravity measures with Value5 (the pull range) instead of Range: Area Graviton Pulse (id 118: Range 360,
        // Value5 240) → 0.7 × 240² = 40 320, so a friend 201 away (40 401) is clear but 200 (40 000) blocks.
        const grav = newWeapon(118);
        expect([ComponentType[grav.component.type], grav.range, grav.damageLoss]).toEqual(['WeaponAreaGravity', 360, 240]);
        place(g, friend, tgt.xpos, tgt.ypos + 200);
        expect(checkFireAreaWeaponAtTarget(g, esc, grav, tgt)).toBe(false);
        place(g, friend, tgt.xpos, tgt.ypos + 201);
        expect(checkFireAreaWeaponAtTarget(g, esc, grav, tgt)).toBe(true);
    });

    it('the blast: centred on the target, a ring growing 1 then Speed × dt per step; each ship is struck once as the ring passes it, for 35 × (1 − ring/Range); friendly ships inside are struck too; shields absorb; the ring overshoots Range with zero power (BuiltObject.1.cs 4340-4388)', () => {
        const { g, esc, tgt, enemy2, friend, area } = stage();
        const s0 = { x: tgt.xpos, y: tgt.ypos };
        // The friendly Javelin 002 wanders into the blast after the shot (the gate only checks at firing time): 100 from
        // the epicentre. A fourth ship, S269's S162 Adversity, stands 215 out, just inside Range 220.
        place(g, friend, s0.x, s0.y + 100);
        const far = ship(g, 'S162 Adversity');
        hold(far);
        place(g, far, s0.x + 215, s0.y); // same 400 000 index cell as the epicentre: the ring only scans that cell (4361)
        for (const b of [tgt, enemy2, friend, far]) b.currentShields = b.shieldsCapacity;
        const shields0 = new Map([tgt, enemy2, friend, far].map((b) => [b, b.currentShields]));
        const dist = new Map([tgt, enemy2, friend, far].map((b) => [b, g.calculateDistance(s0.x, s0.y, b.xpos, b.ypos)]));
        expect([...dist.values()].map((d) => Math.round(d))).toEqual([0, 50, 100, 215]);
        // Weapon.cs 185 Fire: an area weapon starts at DistanceTravelled 0 (not 1).
        const t0 = g.nowMs;
        weaponFire(g, area, esc, tgt, 150, t0, true, 1.0);
        expect(area.distanceTravelled).toBe(0);
        // Hand-worked ring: step 1 (DistanceTravelled ≤ 0): num8 = 1, the epicentre snaps to the target; later steps num8 =
        // (float)Speed 120 × Min(elapsed, timePassed 0.1) (float). The Range check (DistanceTravelled > 220 → reset, 4353)
        // runs before the step, so the last ring still grows past 220.
        const rings: [number, number][] = [];
        let dt = 0;
        while (!(dt > 220)) {
            const num8 = dt <= 0 ? 1 : f32(f32(120) * f32(0.1));
            const nd = f32(dt + num8);
            rings.push([dt, nd]);
            dt = nd;
        }
        expect(rings.length).toBe(20);
        expect(rings[rings.length - 1]).toEqual([217, 229]); // (float)(120 × 0.1f) = 12 exactly: 1, 13, 25, …, 217, 229
        const struck = new Map<BuiltObject, number>();
        const shieldsSeen = new Map<BuiltObject, number>([...shields0]);
        let step = 0;
        while (!area.resetNext && step < 40) {
            step++;
            g.nowMs = t0 + step * 100;
            handleWeaponsFiringBuiltObject(g, esc, 0.1, g.nowMs);
            for (const b of [tgt, enemy2, friend, far]) {
                if (b.currentShields !== shieldsSeen.get(b)) {
                    expect(struck.has(b)).toBe(false); // struck once only
                    struck.set(b, step);
                    shieldsSeen.set(b, b.currentShields);
                }
            }
            if (step <= rings.length) expect(area.distanceTravelled).toBe(rings[step - 1][1]);
        }
        expect(step).toBe(rings.length + 1); // the step after the last ring resets the weapon
        expect(area.x).toBe(s0.x);
        expect(area.y).toBe(s0.y);
        // Each ship is struck on the step whose ring [prev, new) holds its distance, for WeaponDamageDropoff(35) at the new
        // ring: 35 − (float)(ring / 220f) × 35; shields ≥ hit → shields only, no component damage (BuiltObject.2.cs 6363).
        for (const b of [tgt, enemy2, friend, far]) {
            const d = dist.get(b)!;
            const k = rings.findIndex(([a, c]) => d >= a && d < c);
            expect(k).toBeGreaterThanOrEqual(0);
            expect(struck.get(b)).toBe(k + 1);
            const ring = rings[k][1];
            const power = f32(35 - f32(f32(ring / f32(220)) * 35));
            expect(b.currentShields).toBe(f32(shields0.get(b)! - power));
            expect(damagedCount(b)).toBe(0);
        }
        // Fall-off: the target (ring 1) takes 35 − 35/220 = 34.84; the ship at 215 (ring 217) takes 35 × 3/220 = 0.48.
        expect(shields0.get(tgt)! - tgt.currentShields).toBeCloseTo(35 - 35 / 220, 4);
        expect(shields0.get(far)! - far.currentShields).toBeCloseTo(35 * 3 / 220, 4);
        // The last ring overshoots Range ([217, 229)): a ship there is "struck" for Max(0, 35 − 229/220 × 35) = 0.
        expect(weaponDamageDropoff(esc, area, 35)).toBe(0);
        expect(area.distanceTravelled).toBeGreaterThan(220);
        // The firer is never struck (builtObject == this, 4368).
        expect(esc.currentShields).toBe(esc.shieldsCapacity);
    });

    it('a blast larger than the shields spills into armour (the absorbed / not absorbed split)', () => {
        const { g, esc, tgt, area } = stage();
        tgt.currentShields = 10;
        const t0 = g.nowMs;
        weaponFire(g, area, esc, tgt, 150, t0, true, 1.0);
        g.nowMs = t0 + 100;
        handleWeaponsFiringBuiltObject(g, esc, 0.1, g.nowMs);
        // Hit 34.84 > shields 10: num5 = (int)(34.84f − 10 + 0.5f) = 25 into the armour (BuiltObject.2.cs 6389).
        expect(tgt.currentShields).toBe(0);
        const plates = tgt.components.items.filter((c) => c.category === ComponentCategoryType.Armor);
        expect(plates.some((c) => c.status === ComponentStatus.Damaged)).toBe(true);
    });
});
