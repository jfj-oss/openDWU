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
    bombardTarget,
    checkFireAreaWeaponAtTarget,
    handleWeaponsFiringBuiltObject,
    interceptMissiles,
    weaponDamageDropoff,
    weaponFire,
} from '../src/sim/combat/weapons';
import { fireAtAssaultPods, handleAssaultPodMovement } from '../src/sim/combat/boarding';
import { getArtilleryTroopDefendStrength, inflictBombardDamage } from '../src/sim/combat/damage';
import { obtainEmpireEvaluation } from '../src/sim/diplomacy';
import { galaxyPlagues } from '../src/sim/eventTypes';
import { canDeployXaraktorVirus } from '../src/sim/player/orderMenu';
import { ShipActionType, createShipAction } from '../src/sim/player/shipAction';
import { executeShipAction } from '../src/sim/player/executeShipAction';
import { CreatureType } from '../src/sim/creature';
import type { Habitat } from '../src/sim/types';

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

// ---------------------------------------------------------------------------------------------------------------
// (2) Missiles and point defence
// ---------------------------------------------------------------------------------------------------------------

describe('(2) missiles and point defence', () => {
    /**
     * The player's Colossia 001 (Destroyer: 5 beams + 2 Concussion Missiles — components.txt id 10: damage 6, range 520,
     * energy 18, speed 120, fire rate 2700) fires one missile at a stationary target `d` ahead. Stepped by hand at 0.1 s:
     * the firer's HandleWeaponsFiring (BuiltObject.1.cs 3737), then the target's InterceptMissiles (BuiltObject.cs 3819 →
     * BaconBuiltObject.cs 5032) — the order of one DoTasks pass each. Out of view (headless).
     */
    function stage(targetName: string, d: number) {
        const g = cachedTickGame(gameData).galaxy;
        const col = ship(g, 'Colossia 001');
        const tgt = ship(g, targetName);
        hold(col);
        hold(tgt);
        const s = emptySpot(g);
        place(g, col, s.x, s.y);
        place(g, tgt, s.x + d, s.y);
        col.currentEnergy = col.reactorStorageCapacity;
        tgt.currentEnergy = tgt.reactorStorageCapacity;
        tgt.currentShields = tgt.shieldsCapacity;
        const missile = col.weapons.find((w) => w.component.type === ComponentType.WeaponMissile)!;
        for (const w of [...col.weapons, ...tgt.weapons]) {
            w.reset();
            w.lastFired = MIN_TIME;
        }
        return { g, col, tgt, missile };
    }

    /** The hand-worked missile run-up (4091-4111): DistanceTravelled 1 → +10 on launch, then (float)Max(3, Speed × DT/120) × dt below 120, Speed × dt above. */
    function missileSteps(speed: number, n: number): { dt: number; num8: number }[] {
        const out: { dt: number; num8: number }[] = [];
        let dt = 1;
        for (let k = 0; k < n; k++) {
            let num8: number;
            if (dt <= 1) num8 = 10;
            else {
                let num13 = f32(speed);
                if (dt < 120) num13 = Math.max(3, f32(num13 * f32(dt / 120)));
                num8 = f32(num13 * f32(0.1));
            }
            dt = f32(dt + num8);
            out.push({ dt, num8 });
        }
        return out;
    }

    it('missile flight: launch +10, ramp to full speed over the first 120, home on the target, strike at full power when it overshoots (BuiltObject.1.cs 4091-4198); reload is FireRate, no ammunition', () => {
        const { g, col, tgt, missile } = stage('Hidden Aspiration', 400);
        expect([missile.component.componentId, missile.rawDamage, missile.range, missile.energyRequired, missile.speed, missile.fireRate]).toEqual([10, 6, 520, 18, 120, 2700]);
        expect(col.shipGroup).toBeNull();
        expect(tgt.firepowerRaw).toBe(0); // unarmed: nothing intercepts
        const t0 = g.nowMs;
        weaponFire(g, missile, col, tgt, 400, t0, true, 1.0);
        expect(missile.distanceTravelled).toBe(1);
        expect(missile.headingMissFactor).toBe(0); // a sure hit keeps HeadingMissFactor 0: it homes straight in (4116)
        const plan = missileSteps(120, 60);
        // The missile flies straight at the target (re-aimed every step), so before a step its distance to the target is
        // 400 − (DT − 1); it strikes on the first step whose num8 is larger than that (out of view, 4137 `num8 > distanceFromTarget`).
        let hitStep = -1;
        for (let k = 1; k < plan.length; k++) {
            if (plan[k].num8 > 400 - (plan[k - 1].dt - 1)) {
                hitStep = k + 1;
                break;
            }
        }
        expect(hitStep).toBeGreaterThan(0);
        let step = 0;
        let struckAt = -1;
        while (step < 60 && missile.distanceTravelled >= 0 && !missile.resetNext) {
            step++;
            g.nowMs = t0 + step * 100;
            handleWeaponsFiringBuiltObject(g, col, 0.1, g.nowMs);
            if (!missile.resetNext) expect(missile.distanceTravelled).toBe(plan[step - 1].dt);
            if (struckAt < 0 && tgt.currentShields < tgt.shieldsCapacity) struckAt = step;
        }
        expect(struckAt).toBe(hitStep);
        // Missiles do not lose power with distance (BaconBuiltObject.cs 3059): the full 6 comes off the shields.
        expect(tgt.currentShields).toBe(tgt.shieldsCapacity - 6);
        expect(missile.power).toBe(6);
        // Reload: the launcher is available again FireRate 2700 ms after the launch (Weapon.cs 183 IsAvailable) — there is no
        // ammunition count on ship weapons in the C# (only fighters run out, BaconFighter.cs 186 CheckOutOfAmmo).
        g.nowMs = t0 + 2700;
        handleWeaponsFiringBuiltObject(g, col, 0.1, g.nowMs); // clears ResetNext
        expect(missile.distanceTravelled).toBe(-1);
        expect(missile.lastFired + missile.fireRate <= t0 + 2700).toBe(true);
        expect(missile.lastFired + missile.fireRate <= t0 + 2699).toBe(false);
    });

    it('Bacon intercept by beams: once the missile is within the defender\'s beam range (and has flown ≥ 100) the first available beam fires at it with a sure hit and the missile is gone (BaconBuiltObject.cs 5032-5080)', () => {
        const { g, col, tgt, missile } = stage('Worthy Firelance', 400);
        const beams = tgt.weapons.filter((w) => w.component.type === ComponentType.WeaponBeam);
        expect(beams.map((w) => w.range)).toEqual([190, 190, 190, 190]);
        const t0 = g.nowMs;
        weaponFire(g, missile, col, tgt, 400, t0, true, 1.0);
        expect(tgt.attackers).toContain(col); // FireInternal adds the firer: InterceptMissiles walks the target's Attackers
        const counter0 = tgt.assaultPodFiringCounter;
        let step = 0;
        let intercepted = -1;
        while (step < 60 && intercepted < 0) {
            step++;
            g.nowMs = t0 + step * 100;
            handleWeaponsFiringBuiltObject(g, col, 0.1, g.nowMs);
            const dist = missile.distanceFromTarget;
            const flown = missile.distanceTravelled;
            const sh = shadowRnd(g);
            interceptMissiles(g, tgt, g.nowMs, false);
            expect(tgt.assaultPodFiringCounter).toBe(counter0 + step); // shared with FireAtAssaultPods (++ every call)
            if (missile.distanceTravelled < 0) {
                intercepted = step;
                // Conditions at the intercept: flown ≥ 100 and within the beam's Range 190 (5062-5070).
                expect(flown).toBeGreaterThanOrEqual(100);
                expect(dist).toBeLessThanOrEqual(190);
                // The first beam fires at the missile: Weapon.Fire(weaponBlast) with willHit true (NextDouble × 0.15, Next(0, 2)).
                expect(beams[0].targetWeapon).toBe(missile);
                expect(beams[0].lastFired).toBe(g.nowMs);
                expect(beams[0].willHitTarget).toBe(true);
                sh.nextDouble();
                sh.next(0, 2);
                expect(g.rnd.getState()).toEqual(sh.getState());
                // Weapon.Reset on the missile (5077): no target, power 0.
                expect(missile.target).toBeNull();
                expect(missile.power).toBe(0);
            } else {
                // Not yet in range (or flown < 100): nothing fires, no draws.
                expect(dist > 190 || flown < 100).toBe(true);
                expect(g.rnd.getState()).toEqual(sh.getState());
            }
        }
        expect(intercepted).toBeGreaterThan(0);
        // The target is never struck.
        for (let k = 1; k <= 20; k++) handleWeaponsFiringBuiltObject(g, col, 0.1, (g.nowMs += 100));
        expect(tgt.currentShields).toBe(tgt.shieldsCapacity);
    });

    it('point defence only engages a missile that has flown 100: a Point Defense Cannon (id 13, range 140) on the target waits, then shoots it down', () => {
        const { g, col, tgt, missile } = stage('Hidden Aspiration', 130);
        const pd = newWeapon(13);
        expect([ComponentType[pd.component.type], pd.rawDamage, pd.range, pd.energyRequired, pd.speed, pd.fireRate]).toEqual(['WeaponPointDefense', 3, 140, 4, 430, 540]);
        tgt.weapons.push(pd);
        const t0 = g.nowMs;
        weaponFire(g, missile, col, tgt, 130, t0, true, 1.0);
        const plan = missileSteps(120, 60);
        const firstFlown100 = plan.findIndex((p) => p.dt >= 100) + 1;
        let step = 0;
        let intercepted = -1;
        let struck = false;
        while (step < 60 && intercepted < 0 && !struck) {
            step++;
            g.nowMs = t0 + step * 100;
            handleWeaponsFiringBuiltObject(g, col, 0.1, g.nowMs);
            struck = tgt.currentShields < tgt.shieldsCapacity;
            interceptMissiles(g, tgt, g.nowMs, false);
            if (missile.distanceTravelled < 0 && !struck) intercepted = step;
        }
        // Within PD range from the start (130 < 140) but only intercepted on the first step with DistanceTravelled ≥ 100.
        expect(struck).toBe(false);
        expect(intercepted).toBe(firstFlown100);
        expect(pd.targetWeapon).toBe(missile);
    });

    it('point defence against an assault pod: DetermineHitTarget(weaponBlast) draw for draw; a PD hit marks the pod Power = float.MaxValue / ResetNext — which the C# never acts on: the pod still lands (BuiltObject.1.cs 2905, 5202, 3873, 2626)', () => {
        const g = cachedTickGame(gameData).galaxy;
        const jav = ship(g, 'Javelin 001');
        const wf = ship(g, 'Worthy Firelance');
        hold(jav);
        hold(wf);
        const s = emptySpot(g);
        place(g, jav, s.x, s.y);
        place(g, wf, s.x + 100, s.y);
        jav.currentEnergy = jav.reactorStorageCapacity;
        const pd = newWeapon(13);
        jav.weapons.push(pd);
        jav.pointDefenseWeaponsRange = 140; // ReDefine's Max PD range (BuiltObject.cs 2800) for the one PD component added here
        const pod = wf.weapons.find((w) => w.component.type === ComponentType.AssaultPod)!;
        expect([pod.rawDamage, pod.range, pod.speed]).toEqual([50, 140, 50]);
        expect(wf.assaultStrength).toBeGreaterThan(0);
        const t0 = g.nowMs;
        pod.reset();
        weaponFire(g, pod, wf, jav, 100, t0, true, 1.0);
        const sh = shadowRnd(g);
        fireAtAssaultPods(g, jav, t0, false);
        // Hand-worked (5202-5241): num = Range 140, num2 = 140 − 100 = 40, hitRangeChance = 0.15 + 40/140 = 0.4357;
        // val = 10 / Max(1, pod Speed 50) = 0.2 → clamped 0.7 → × 2 = 1.4; no targeting modifiers: num6 = 1.4 × (0.4357 + r),
        // always > 0.5 — a hit unless Next(0, 15) == 7.
        const hrc = 0.15 + 40 / 140;
        const r = sh.nextDouble();
        let num6 = 1.4 * (hrc + r);
        expect(num6 > 0.5).toBe(true);
        if (sh.next(0, 15) === 7) num6 = 0;
        const willHit = num6 > 0.5;
        if (willHit) {
            sh.nextDouble();
            sh.next(0, 2);
        } else {
            sh.nextDouble();
            sh.next(0, 2);
        }
        expect(g.rnd.getState()).toEqual(sh.getState());
        expect(pd.targetWeapon).toBe(pod);
        expect(pd.willHitTarget).toBe(willHit);
        // Follow a hit to the pod (forced when the roll missed): the PD bolt flies at 430 and, out of view, strikes when its
        // distance to the pod starts growing (3818-3826); the struck pod gets Power = float.MaxValue and ResetNext (3876).
        pd.willHitTarget = true;
        pd.heading = f32(Math.atan2(pod.y - jav.ypos, pod.x - jav.xpos));
        let step = 0;
        while (step < 10 && !pod.resetNext) {
            step++;
            g.nowMs = t0 + step * 100;
            handleWeaponsFiringBuiltObject(g, jav, 0.1, g.nowMs);
        }
        expect(pod.resetNext).toBe(true);
        expect(pod.power).toBe(f32(3.4028234663852886e38));
        // HandleWeaponsFiring skips assault pods before its ResetNext check (3751) and HandleAssaultPodMovement reads neither
        // ResetNext nor Power: the "shot-down" pod flies on and lands. Faithful C# (PD against pods is cosmetic).
        const attack0 = jav.assaultAttackValue;
        g.nowMs = t0 + 1000;
        handleWeaponsFiringBuiltObject(g, wf, 0.1, g.nowMs);
        expect(pod.distanceTravelled).toBeGreaterThanOrEqual(0);
        for (let k = 0; k < 40 && pod.distanceTravelled >= 0; k++) handleAssaultPodMovement(g, wf, 0.1);
        expect(pod.distanceTravelled).toBe(-1);
        expect(jav.assaultAttackValue).toBeGreaterThan(attack0);
    });
});

// ---------------------------------------------------------------------------------------------------------------
// (3) Planetary bombardment and the Xaraktor virus
// ---------------------------------------------------------------------------------------------------------------

describe('(3) planetary bombardment', () => {
    function capitalOf(g: Galaxy, name: string): Habitat {
        const e = g.empires.find((x) => x.name === name);
        if (e === undefined || e.capital === null) throw new Error(`no capital for ${name}`);
        return e.capital;
    }

    it('InflictBombardDamage hand-worked: artillery cuts the bombard strength, Damage += power/8000, each race loses power × 250 000 by share, the bomber loses reputation and the victim remembers the incident (BuiltObject.2.cs 5816-5992)', () => {
        const g = cachedTickGame(gameData).galaxy;
        const col = ship(g, 'Colossia 001');
        const player = g.playerEmpire!;
        const colony = capitalOf(g, 'S285 Empire');
        const victim = colony.empire!;
        expect(colony.planetaryShieldPresent).toBe(false);
        for (const bp of [3, 40]) {
            // Strength (5822-5836): artillery → num = √(Σ artillery defend × InterceptBonusFactor / 7500) + 0.5, ≥ 1; power / num.
            let art = getArtilleryTroopDefendStrength(colony.troops!);
            let power = bp;
            if (art > 0) {
                art *= f32(victim.troopPlanetaryDefenseInterceptBonusFactor);
                const num = Math.max(1.0, 0.5 + Math.sqrt(art / 7500.0));
                power = Math.max(1, Math.trunc(bp / num));
            }
            const damage0 = colony.damage;
            const pops0 = colony.population.items.map((p) => [p, p.amount] as const);
            const total0 = colony.population.totalAmount;
            const civ0 = player.civilityRating;
            const civVictim = victim.civilityRating;
            const ev = obtainEmpireEvaluation(g, victim, player);
            const inc0 = ev.incidentEvaluationRaw;
            inflictBombardDamage(g, col, colony, bp);
            expect(colony.damage).toBe(Math.min(1, f32(damage0 + f32(f32(power) / 8000))));
            // Population (5920-5935): num4 = power × 250 000 split by each race's share (truncated per race).
            const num4 = power * 250000;
            for (const [p, a0] of pops0) expect(p.amount).toBe(a0 - Math.trunc(num4 * (a0 / total0)));
            // Reputation (5962-5989): num7 = num4 / 5e7, × (1 + civility/30) for a reputable victim (else × Max(0.01, 1 + civility/50)).
            let num7 = num4 / 50000000.0;
            num7 *= civVictim > 0.0 ? 1.0 + civVictim / 30.0 : Math.max(0.01, 1.0 + civVictim / 50.0);
            expect(player.civilityRating).toBeCloseTo(civ0 - Math.max(num7, 0.0), 10);
            // The victim's IncidentEvaluation of the bomber = raw − power (clamped to [-150, 80]).
            expect(ev.incidentEvaluationRaw).toBeCloseTo(Math.max(-150, inc0 - power), 10);
        }
    });

    it('a pirate or independent bomber costs no reputation; a planetary shield blocks everything but the explosion (5818, 5962)', () => {
        const g = cachedTickGame(gameData).galaxy;
        const colony = capitalOf(g, 'S285 Empire');
        const pirate = ship(g, 'Worthy Firelance');
        const pe = pirate.empire!;
        const civ0 = pe.civilityRating;
        const amt0 = colony.population.totalAmount;
        inflictBombardDamage(g, pirate, colony, 3);
        expect(pe.civilityRating).toBe(civ0);
        expect(colony.population.totalAmount).toBeLessThan(amt0);
        // Planetary shield: nothing but the explosion (5 draws: Next(0, 10), Next(0, d), Next(0, 2), Next(0, d), Next(0, 2)).
        const shield = colony as unknown as { planetaryShieldPresent: boolean };
        Object.defineProperty(colony, 'planetaryShieldPresent', { value: true, configurable: true });
        expect(shield.planetaryShieldPresent).toBe(true);
        const d0 = colony.damage;
        const amt1 = colony.population.totalAmount;
        const sh = shadowRnd(g);
        inflictBombardDamage(g, pirate, colony, 40);
        const dd = Math.trunc(colony.diameter * 0.15);
        sh.next(0, 10);
        sh.next(0, dd);
        sh.next(0, 2);
        sh.next(0, dd);
        sh.next(0, 2);
        expect(g.rnd.getState()).toEqual(sh.getState());
        expect(colony.damage).toBe(d0);
        expect(colony.population.totalAmount).toBe(amt1);
    });

    it('BombardTarget fires a bombard weapon at the colony (jitter ±250 ms, heading ±0.2), the shell flies unguided and InflictBombardDamage lands with the weapon\'s BombardDamage (BuiltObject.1.cs 4899, 4113-4150)', () => {
        const g = cachedTickGame(gameData).galaxy;
        const col = ship(g, 'Colossia 001');
        hold(col);
        const colony = capitalOf(g, 'S285 Empire');
        const nd = newWeapon(11); // Nuclear Devastator: WeaponBombard, range 210, energy 15, speed 50, fire rate 6000, bombard 3
        expect([ComponentType[nd.component.type], nd.range, nd.energyRequired, nd.speed, nd.fireRate, nd.bombardDamage]).toEqual(['WeaponBombard', 210, 15, 50, 6000, 3]);
        col.weapons.length = 0;
        col.weapons.push(nd);
        place(g, col, colony.xpos - 200, colony.ypos);
        col.currentEnergy = col.reactorStorageCapacity;
        const e0 = col.currentEnergy;
        const t0 = g.nowMs;
        bombardTarget(g, col, 200, colony);
        expect(nd.lastFired).toBe(t0);
        expect(nd.target).toBe(colony);
        expect(nd.willHitTarget).toBe(true);
        expect(nd.distanceTravelled).toBe(1);
        expect(Math.abs(nd.heading - 0)).toBeLessThanOrEqual(0.2 + 1e-6); // DetermineAngle(→ +x) = 0, ± NextDouble × 0.2
        expect(col.currentEnergy).toBe(e0 - 15);
        // Out of range (> 210): no shot.
        nd.reset();
        nd.lastFired = MIN_TIME;
        bombardTarget(g, col, 211, colony);
        expect(nd.distanceTravelled).toBe(-1);
        bombardTarget(g, col, 200, colony);
        const heading = nd.heading;
        const damage0 = colony.damage;
        let step = 0;
        while (step < 80 && !nd.resetNext) {
            step++;
            g.nowMs = t0 + step * 100;
            handleWeaponsFiringBuiltObject(g, col, 0.1, g.nowMs);
            expect(nd.heading).toBe(heading); // a Habitat target is never re-aimed (4116)
        }
        expect(nd.resetNext).toBe(true);
        expect(nd.target).toBeNull(); // 4145 weapon.Target = null after InflictBombardDamage
        expect(colony.damage).toBeGreaterThan(damage0);
        // Launch 10, then 50 × 0.1 = 5 per step (a bombard shell has no missile ramp): the closest approach is reached after
        // (200 − 11) / 5 ≈ 38 steps, give or take the ±0.2 heading.
        expect(step).toBeGreaterThanOrEqual(37);
        expect(step).toBeLessThanOrEqual(41);
    });

    it('the Xaraktor virus: CanDeployXaraktorVirus needs the researched plague and a Race Achievement wonder (Empire.10.cs 4518); DeployVirus infects the colony, spawns Next(15, 20) Kaltors and stamps LastXaraktorVirusDeploy (Main.Part7.cs 1020-1043)', () => {
        const g = cachedTickGame(gameData).galaxy;
        const player = g.playerEmpire!;
        const colony = capitalOf(g, 'S285 Empire');
        // The stock plagues.txt has no SpecialFunctionCode 1 entry (the header documents it: "1=Xaraktor virus"); a mod
        // adds one. Stand one in: Dekara Virus (id 1) flagged as the Xaraktor virus.
        expect(galaxyPlagues(g).some((p) => p.specialFunctionCode === 1)).toBe(false);
        const xar = { ...galaxyPlagues(g)[1], specialFunctionCode: 1 };
        // Not researched: no virus, no reason.
        expect(canDeployXaraktorVirus(g, player)).toEqual({ result: false, virus: null, reason: '' });
        player.research!.enabledPlagues.push(xar);
        const r = canDeployXaraktorVirus(g, player);
        expect(r.virus).toBe(xar);
        expect(r.result).toBe(false); // no Race Achievement wonder (Value2 2) at any colony
        expect(r.reason).toMatch(/Xaraktor Virus - no /); // TextResolver 'Cannot Deploy Xaraktor Virus - no facility'
        // DeployVirus (the player's order; the menu greys it out when CanDeploy is false, the order itself does not check).
        const kaltors0 = g.creatures.filter((c) => c.type === CreatureType.Kaltor).length;
        const sh = shadowRnd(g);
        const action = createShipAction(ShipActionType.DeployVirus, colony);
        action.target2 = xar;
        executeShipAction(g, player, colony, action, true);
        // InflictWithPlague: PlagueTimeRemaining = Duration + (NextDouble − 0.5) × Duration × 0.3 (float).
        expect(colony.plagueId).toBe(xar.plagueId);
        const r1 = sh.nextDouble();
        expect(colony.plagueTimeRemaining).toBe(f32(f32(xar.duration) + f32((r1 - 0.5) * (f32(xar.duration) * 0.3))));
        const n = g.creatures.filter((c) => c.type === CreatureType.Kaltor).length - kaltors0;
        expect(n).toBeGreaterThanOrEqual(15);
        expect(n).toBeLessThan(20);
        expect(player.lastXaraktorVirusDeploy).toBe(g.nowMs);
    });
});
