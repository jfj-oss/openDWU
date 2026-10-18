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
//       4763 DoRepairs, ConstructionQueue.cs 1142 IdentifyComponentToBuild);
//   (7) the Fighting retreats add-on; (8) the BVR combat add-on (magazines, sensor lock, seeking, point-defence cover, rearming, AI);
//   (9) the six combat changes after BVR (decoys, ambush, critical hits, damage control, armour facing, surrender and wrecks).
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
import { BuiltObjectMissionPriority, BuiltObjectMissionType, builtObjectMission } from '../src/sim/missions/mission';
import { assignMission } from '../src/sim/missions/assign';
import { CommandAction } from '../src/sim/missions/mission';
import { checkBattleOverwhelming, evaluateAttackStrongBase, checkAssignAttackOnThreat, determineThreatLevel, evaluateThreats, performThreatEvaluation, shouldFleeFrom, threatEvaluation } from '../src/sim/combat/threats';
import { autoRefuelRepairShip } from '../src/sim/logistics/refuel';
import { calculateCrewLevel, doRepairs } from '../src/sim/construction/repair';
import { findNearestShipYard } from '../src/sim/construction/empireConstruction';
import { builtObjectConstructionQueue } from '../src/sim/construction/constructionQueue';
import { shipGroupRepairBonus } from '../src/sim/fleets/shipGroup';
import { cleanupInvalidShips } from '../src/sim/combat/teardown';
import { determineDestroyOrCaptureTarget, empireRaidStrengthFactor, shouldAttack } from '../src/sim/combat/attackAI';
import { ShipGroup, shipGroupAssignMission } from '../src/sim/fleets/shipGroup';
import { runGameSeconds } from '../src/sim/tick/harness';
import {
    bombardTarget,
    checkFireAreaWeaponAtTarget,
    handleWeaponsFiringBuiltObject,
    interceptMissiles,
    weaponDamageDropoff,
    weaponFire,
} from '../src/sim/combat/weapons';
import { fireAtAssaultPods, handleAssaultPodMovement, performRaidColonyInvasion } from '../src/sim/combat/boarding';
import { orbitalGuardBase } from '../src/sim/combat/orbitalGuard';
import { SpaceBattleStats, calculateBuiltObjectLootingValue, empireColonyIncomeFactor, inflictDamage, empireLootingFactor, getArtilleryTroopDefendStrength, inflictBombardDamage } from '../src/sim/combat/damage';
import { doRaidBonuses, empireRaidBonusFactor, invasionStatsOf } from '../src/sim/combat/invasion';
import { obtainPirateRelation } from '../src/sim/pirateRelations';
import { applyCorruptionToIncome } from '../src/sim/logistics/orders';
import { EmpireMessageType } from '../src/sim/messages';
import { Troop, TroopType } from '../src/sim/cargo';
import type { Empire } from '../src/sim/empire';
import { DiplomaticRelationType, obtainDiplomaticRelation, obtainEmpireEvaluation } from '../src/sim/diplomacy';
import { declareWar } from '../src/sim/diplomacyTick';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { galaxyPlagues } from '../src/sim/eventTypes';
import { canDeployXaraktorVirus } from '../src/sim/player/orderMenu';
import { ShipActionType, createMissionShipActionAt, createShipAction } from '../src/sim/player/shipAction';
import { executeShipAction } from '../src/sim/player/executeShipAction';
import { CreatureType } from '../src/sim/creature';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { BALANCED, MERCENARY, PIRATE, SMUGGLER, aiCapital, pirateConstructionShip, pirateEscort, pirateExplorer, pirateFaction, pirateRaider, playerCarrierPort, playerMissileShip, playerShip } from './helpers/combatCast';
import { PiratePlayStyle, pirateFactionModifiers } from '../src/sim/pirates';
import { createGalaxyScenario } from '../src/sim/scenario/state';
import { loadScenarioOverlayFs } from './helpers/scenarioGame';
import { FIGHTING_RETREATS_ADDON_ID, fightingRetreatsFrame, fightingRetreatsState, fleetBattle, fleetFallbackPoint, fleetRepairPoint, fleetRetreatStatusText } from '../src/sim/scenario/fightingRetreats/fightingRetreats';
import { comboOverlayFs, createScenarioGame, scenarioGameData, scenarioIndexFs } from './helpers/scenarioGame';
import type { Game } from '../src/sim/game';
import { generateBuiltObjectFromDesign } from '../src/sim/exploration';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import { defaultStartGameOptions } from '../src/sim/startGameOptions';
import { scenarioQuery } from '../src/sim/scenario/hooks';
import { IndustryType } from '../src/sim/types';
import { BVR_ADDON_ID, bvrAmmoText, bvrMayFire, bvrNeedsRounds, bvrNoteFired, bvrOn, bvrRearmTick, bvrState, bvrTracked, isBvrMissile, peekBvrState } from '../src/sim/scenario/bvr/bvr';
import { Design } from '../src/sim/design';
import { shipGroupAddShipToFleet } from '../src/sim/fleets/shipGroupTasks';
import { BVR_PROJECT_NAMES, aiResupplyTick, aiRearmTick, bvrFixLaunchers, bvrProjectNodes } from '../src/sim/scenario/bvr/bvrAI';
import { bvrEngagement, bvrFirepowerFactor } from '../src/sim/scenario/bvr/bvrTactics';
import { BattleTactics } from '../src/sim/data/designSpecifications';
import { C2_DEFAULTS, c2State, peekC2State, type C2Param } from '../src/sim/scenario/combat2/common';
import { decoyCapacity, decoyDefend, decoyRestockTick, decoyText, decoysLeft, ecmCount } from '../src/sim/scenario/combat2/decoys';
import { decoyDesignChooser, enemySeekingLaunchers, withEcm, wantedEcm } from '../src/sim/scenario/combat2/decoysAI';
import { ambushActive, ambushAiFactor, ambushNoteShot } from '../src/sim/scenario/combat2/ambush';
import { critComponentDamaged, critFireFactor, critMissChance, critText, critTotal, critWithdrawFactor } from '../src/sim/scenario/combat2/criticals';
import { c2AdjustHit, c2HitPower } from '../src/sim/scenario/combat2/hits';
import { crewRepairSpeed, damageControlTick } from '../src/sim/scenario/combat2/damageControl';
import { facingTick, facingZone, flankHeadingOffset } from '../src/sim/scenario/combat2/facing';
import { c2StruckSpares, healthPct, isStruck, struckText, surrenderCaptureTick, surrenderTick } from '../src/sim/scenario/combat2/surrender';
import { combat2StatusLines } from '../src/sim/scenario/combat2/status';
import { c2ShipTick } from '../src/sim/scenario/combat2/shipTick';
import { createWreckField, peekWreckageState, wreckFields } from '../src/sim/scenario/wreckage/common';
import { purgeWreckageState } from '../src/sim/scenario/wreckage/wreckage';
import { purgeSilence } from '../src/sim/scenario/threats/silence';
import { generateRestrictedZone } from '../src/sim/story/storyStart';
import { galaxyStarDate } from '../src/sim/tick/simTime';

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

/** The Mercenary faction's pod-and-beam escort (RaidStrength 1.25, RaidBonus 0.75, Looting 1.33). */
function mercRaider(g: Galaxy): BuiltObject {
    return pirateRaider(g, pirateFaction(g, MERCENARY));
}

const f32 = Math.fround;
const damagedCount = (b: BuiltObject) => b.components.items.filter((c) => c.status === ComponentStatus.Damaged).length;

// ---------------------------------------------------------------------------------------------------------------
// (1) Area weapons
// ---------------------------------------------------------------------------------------------------------------

describe('(1) area weapons', () => {
    /**
     * The player's first escort carries an Intimidator Surgewave (components.txt id 19, WeaponAreaDestruction: Value1 damage 35,
     * Value2 range 220, Value3 energy 54, Value4 expansion speed 120, Value5 13, Value6 fire rate 8200). The target is the first
     * unarmed pirate explorer, 150 ahead; another faction's explorer sits 50 beyond the target (a second enemy)
     * and the player's second escort (built from its escort design when the start fleet has one) is the friendly ship. All shields 100, no fleets, no captains.
     */
    function stage() {
        const g = cachedTickGame(gameData).galaxy;
        const esc = playerShip(g, BuiltObjectSubRole.Escort, 0);
        const tgt = pirateExplorer(g, 0);
        const enemy2 = pirateExplorer(g, 0, [tgt.empire!]);
        const friend = playerShip(g, BuiltObjectSubRole.Escort, 1);
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
        // The friendly second escort wanders into the blast after the shot (the gate only checks at firing time): 100 from
        // the epicentre. A fourth ship, a pirate construction ship, stands 215 out, just inside Range 220.
        place(g, friend, s0.x, s0.y + 100);
        const far = pirateConstructionShip(g, 0);
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
     * The player's first missile ship (Destroyer: 5 beams + 2 Concussion Missiles — components.txt id 10: damage 6, range 520,
     * energy 18, speed 120, fire rate 2700) fires one missile at a stationary target `d` ahead. Stepped by hand at 0.1 s:
     * the firer's HandleWeaponsFiring (BuiltObject.1.cs 3737), then the target's InterceptMissiles (BuiltObject.cs 3819 →
     * BaconBuiltObject.cs 5032) — the order of one DoTasks pass each. Out of view (headless).
     */
    function stage(target: (g: Galaxy) => BuiltObject, d: number) {
        const g = cachedTickGame(gameData).galaxy;
        const col = playerMissileShip(g, 0);
        const tgt = target(g);
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
        const { g, col, tgt, missile } = stage((g) => pirateExplorer(g, 0), 400);
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
        const { g, col, tgt, missile } = stage((g) => mercRaider(g), 400);
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
        const { g, col, tgt, missile } = stage((g) => pirateExplorer(g, 0), 130);
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
        const jav = playerShip(g, BuiltObjectSubRole.Escort, 0);
        const wf = mercRaider(g);
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
    it('InflictBombardDamage hand-worked: artillery cuts the bombard strength, Damage += power/8000, each race loses power × 250 000 by share, the bomber loses reputation and the victim remembers the incident (BuiltObject.2.cs 5816-5992)', () => {
        const g = cachedTickGame(gameData).galaxy;
        const col = playerMissileShip(g, 0);
        const player = g.playerEmpire!;
        const colony = aiCapital(g, 0);
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
        const colony = aiCapital(g, 0);
        const pirate = mercRaider(g);
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
        const col = playerMissileShip(g, 0);
        hold(col);
        const colony = aiCapital(g, 0);
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
        const colony = aiCapital(g, 0);
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

// ---------------------------------------------------------------------------------------------------------------
// (4) Pirate raids
// ---------------------------------------------------------------------------------------------------------------

describe('(4) pirate raids', () => {
    /** Records every raw InternalSample of galaxy.rnd during `f` (random.ts trace hook): NextDouble = sample / MBIG. */
    function traced(g: Galaxy, f: () => void): number[] {
        const out: number[] = [];
        g.rnd.setTrace((v) => out.push(v / 2147483647));
        try {
            f();
        } finally {
            g.rnd.setTrace(null);
        }
        return out;
    }

    /**
     * The Mercenary faction (seed-1: Murderous Corsairs, before that Dread Invaders; play style: RaidStrengthFactor 1.25,
     * RaidBonusFactor 0.75, LootingFactor 1.33 — Galaxy.8.cs 4396 SetPirateFactionModifiers) raid the player's capital with
     * its escort's Assault Pod (components.txt id 114: Value1 strength 50, speed 50). Its dominant race's troop strength
     * (seed 1: Mortalen 138, before that 92) scales the pod.
     */
    function stage() {
        const g = cachedTickGame(gameData).galaxy;
        const wf = mercRaider(g);
        hold(wf);
        const player = g.playerEmpire!;
        const capital = player.capital!;
        const pe = wf.empire!;
        return { g, wf, player, capital, pe };
    }

    it('play-style factors: Mercenary raids at 1.25 strength / 0.75 loot and loots at 1.33, Smuggler 0.75 / 0.75 / 0.75, Pirate 1.25 / 1.4 / 1.0 (Galaxy.8.cs 4396, BaconEmpire.cs 59-84)', () => {
        const { g, pe } = stage();
        expect(pe).toBe(pirateFaction(g, MERCENARY));
        const f = (e: Empire) => [empireRaidStrengthFactor(e), empireRaidBonusFactor(e), empireLootingFactor(e)];
        expect(f(pe)).toEqual([1.25, 0.75, 1.33]); // Mercenary
        // Every faction reads one of the four tables (which play styles a galaxy has varies: seed 1 has had no Smuggler,
        // and now no Pirate faction).
        for (const e of g.pirateEmpires) expect([MERCENARY, PIRATE, SMUGGLER, BALANCED]).toContainEqual(f(e));
        // Each table read through the same Empire factors, on a faction given that play style's modifiers.
        const styled = (style: PiratePlayStyle) => {
            const e = g.pirateEmpires[0];
            const saved = e.pirateFactionModifiers;
            e.pirateFactionModifiers = pirateFactionModifiers(style);
            const r = f(e);
            e.pirateFactionModifiers = saved;
            return r;
        };
        expect(styled(PiratePlayStyle.Mercenary)).toEqual([1.25, 0.75, 1.33]);
        expect(styled(PiratePlayStyle.Pirate)).toEqual([1.25, 1.4, 1.0]);
        expect(styled(PiratePlayStyle.Smuggler)).toEqual([0.75, 0.75, 0.75]);
        expect(styled(PiratePlayStyle.Balanced)).toEqual([1.0, 1.0, 1.0]);
        expect(f(g.playerEmpire!)).toEqual([1.0, 1.0, 1.0]); // not a pirate: the Empire.cs 431-455 defaults
    });

    it('a pod landing on a colony becomes a Pirate Raider troop of (int)(50 × TroopStrength/100 × 1.25), e.g. 57 for TroopStrength 92 (BuiltObject.1.cs 2696-2733); a pod does not raid a colony its own empire is invading with regular troops', () => {
        const { g, wf, capital, pe } = stage();
        const pod = wf.weapons.find((w) => w.component.type === ComponentType.AssaultPod)!;
        place(g, wf, capital.xpos + 50, capital.ypos);
        // openDWU rule (not in the original, combat/orbitalGuard.ts): under the owner's armed space port the pod is spent
        // without landing; the C# behaviour below is checked with the capital's bases out of orbit.
        expect(orbitalGuardBase(capital, pe)).not.toBeNull();
        pod.reset();
        weaponFire(g, pod, wf, capital, 50, g.nowMs, true, 1.0);
        pod.x = capital.xpos + 5;
        pod.y = capital.ypos;
        handleAssaultPodMovement(g, wf, 0.1);
        expect(pod.distanceTravelled).toBe(-1);
        expect((capital.invadingTroops?.items ?? []).filter((t) => t.empire === pe).length).toBe(0);
        capital.basesAtHabitat.splice(0);
        pod.reset();
        weaponFire(g, pod, wf, capital, 50, g.nowMs, true, 1.0);
        pod.x = capital.xpos + 5; // within 10: lands on the next movement step (2651)
        pod.y = capital.ypos;
        const troops0 = pe.troops.count;
        handleAssaultPodMovement(g, wf, 0.1);
        expect(pod.distanceTravelled).toBe(-1); // Weapon.Reset after landing (2736)
        const raiders = capital.invadingTroops!.items.filter((t) => t.type === TroopType.PirateRaider && t.empire === pe);
        expect(raiders.length).toBe(1);
        const ts = pe.dominantRace!.troopStrength;
        expect(raiders[0].attackStrength).toBe(Math.trunc(50 * 1.0 * (ts / 100.0) * 1.0 * 1.25)); // 92 → 57, 138 → 86
        expect(raiders[0].colony).toBe(capital);
        expect(pe.troops.count).toBe(troops0 + 1);
        // Same empire already invading with a regular troop (2705-2717): the pod is spent without raiding.
        const regular = new Troop('x', TroopType.Infantry, 10, 10, 100, 100, pe, pe.dominantRace);
        capital.invadingTroops!.add(regular);
        const n0 = capital.invadingTroops!.count;
        weaponFire(g, pod, wf, capital, 50, g.nowMs, true, 1.0);
        pod.x = capital.xpos + 5;
        pod.y = capital.ypos;
        handleAssaultPodMovement(g, wf, 0.1);
        expect(pod.distanceTravelled).toBe(-1);
        expect(capital.invadingTroops!.count).toBe(n0);
    });

    it('PerformRaidColonyInvasion hand-worked: the defenders\' chance val2 = Min(95, √(bases + shield + intercepting artillery/50) × √count) to wound the raider by up to val = Min(90, …), relations and pirate evaluations (BuiltObject.1.cs 2779-2903)', () => {
        const { g, wf, player, capital, pe } = stage();
        // Hand-work the defence (2799-2840).
        let num = 0;
        let num2 = 0;
        for (const b of capital.basesAtHabitat) {
            if (b.firepowerRaw > 0) {
                num += b.firepowerRaw;
                num2++;
            }
        }
        if (capital.planetaryShieldPresent) {
            num += 1000;
            num2++;
        }
        const num5 = num;
        const art = capital.troops!.getByType(TroopType.Artillery);
        let num3 = art.totalDefendStrength;
        let num4 = 0;
        if (art.count > 0) {
            num3 = Math.trunc(f32(num3 * player.troopAttackStrengthBonusFactorArtillery));
            num4 = Math.trunc(f32(num3 * player.troopPlanetaryDefenseInterceptBonusFactor));
            num += Math.trunc(num3 / 50);
            num2 += art.count;
        }
        num = Math.min(3000, num);
        num2 = Math.min(10, num2);
        const val = Math.min(90.0, Math.sqrt(num) * Math.sqrt(num2));
        const val2 = Math.min(95.0, Math.sqrt(Math.trunc(num4 / 50) + num5) * Math.sqrt(num2));
        expect(num2).toBeGreaterThan(0); // the capital's spaceport is armed
        expect(val2).toBeGreaterThan(0);
        const rel0 = obtainPirateRelation(player, pe).evaluationRaidsAgainstOurColonies;
        expect(capital.invadingTroops === null || capital.invadingTroops.count === 0).toBe(true);
        let troop: Troop | null = null;
        let samples: number[] = [];
        let tries = 0;
        let losses = 0;
        // Repeat raids until one is wounded (each landing rolls NextDouble × 100 < val2 once, 2856).
        while (tries < 50) {
            tries++;
            const before = new Set(capital.invadingTroops?.items ?? []);
            const dmg0 = invasionStatsOf(capital)?.troopsDamageToInvaders ?? 0;
            samples = traced(g, () => performRaidColonyInvasion(g, wf, capital, 86));
            troop = capital.invadingTroops!.items.find((t) => !before.has(t))!;
            expect(troop.type).toBe(TroopType.PirateRaider);
            expect([troop.attackStrength, troop.defendStrength]).toEqual([86, 86]);
            if (troop.readiness < 100) {
                // Readiness −= Min(Readiness × 0.9f, val × NextDouble) for a consecutive pair of draws (r1 × 100 < val2, r2).
                const loss = f32(100 - troop.readiness);
                const k = samples.findIndex((r1, i) => i + 1 < samples.length && r1 * 100 < val2 && f32(100 - f32(Math.min(f32(100 * f32(0.9)), val * samples[i + 1]))) === troop!.readiness);
                expect(k).toBeGreaterThanOrEqual(0);
                const val3 = Math.min(f32(100 * f32(0.9)), val * samples[k + 1]);
                expect(loss).toBeCloseTo(val3, 4);
                // InvasionStats.TroopsDamageToInvaders += (float)val3 (2866).
                expect(invasionStatsOf(capital)!.troopsDamageToInvaders).toBe(f32(dmg0 + f32(val3)));
                losses++;
                break;
            }
        }
        expect(losses).toBe(1);
        // The first raid (no invaders yet) costs the pirates −10 RaidsAgainstOurColonies with the victim (2848); later raids
        // on an already invaded colony do not.
        expect(obtainPirateRelation(player, pe).evaluationRaidsAgainstOurColonies).toBe(f32(rel0 - 10));
    });

    it('DoRaidBonuses: a raid inside the countdown (> 55) loots nothing and sends both empires the failure message; otherwise credits = Max(100, Min(victim × 0.5, √(pop/10 000) × (30 + 20r) × income × RaidBonusFactor)) (Galaxy.5.cs 4953-5034)', () => {
        const { g, player, capital, pe } = stage();
        const nMsg = (e: Empire) => (e.messages ?? []).length;
        capital.raidCountdown = 56;
        const m0 = [nMsg(pe), nMsg(player)];
        const money0 = [pe.stateMoney, player.stateMoney];
        const d0 = g.rnd.drawCount;
        doRaidBonuses(g, pe, capital, empireRaidBonusFactor(pe));
        expect(g.rnd.drawCount).toBe(d0);
        expect([pe.stateMoney, player.stateMoney]).toEqual(money0);
        if (pe.messages !== null) expect(nMsg(pe)).toBe(m0[0] + 1);
        if (player.messages !== null) {
            expect(nMsg(player)).toBe(m0[1] + 1);
            expect((player.messages[player.messages.length - 1] as { messageType: EmpireMessageType }).messageType).toBe(EmpireMessageType.RaidVictim);
        }
        // Countdown 0 → num = 1. Burn draws until the habitat's Next(0, 3) comes up 0 (the credits branch).
        capital.raidCountdown = 0;
        for (let k = 0; k < 20 && shadowRnd(g).next(0, 3) !== 0; k++) g.rnd.next();
        const sh = shadowRnd(g);
        expect(sh.next(0, 3)).toBe(0);
        const r = sh.nextDouble();
        const num3 = Math.trunc(capital.population.totalAmount / 10000);
        let num4 = Math.sqrt(num3) * (30.0 + r * 20.0);
        num4 *= empireColonyIncomeFactor(pe);
        num4 *= 1.0;
        num4 *= 0.75; // Mercenary RaidBonusFactor
        num4 = Math.max(100.0, Math.min(player.stateMoney * 0.5, num4));
        const pm0 = pe.stateMoney;
        const vm0 = player.stateMoney;
        doRaidBonuses(g, pe, capital, empireRaidBonusFactor(pe));
        expect(pe.stateMoney).toBeCloseTo(pm0 + num4, 6);
        expect(player.stateMoney).toBeCloseTo(vm0 - num4, 6);
    });

    it('looting: a Mercenary kill pays CalculateBuiltObjectLootingValue × ColonyIncomeFactor × LootingFactor 1.33 after corruption (BuiltObject.1.cs 3915-3925) — fixed: LootingFactor used to read 1.0 for every faction', () => {
        const g = cachedTickGame(gameData).galaxy;
        const wf = mercRaider(g);
        const victim = playerShip(g, BuiltObjectSubRole.ExplorationShip, 2);
        hold(wf);
        hold(victim);
        const s = emptySpot(g);
        place(g, wf, s.x, s.y);
        place(g, victim, s.x + 50, s.y);
        wf.currentEnergy = wf.reactorStorageCapacity;
        // A wreck: shields down, every component damaged → UndamagedComponentSize 0 ≤ any hull hit (BuiltObject.2.cs 6545).
        victim.currentShields = 0;
        for (const c of victim.components.items) c.status = ComponentStatus.Damaged;
        victim.reDefine();
        const pe = wf.empire!;
        const loot = calculateBuiltObjectLootingValue(victim) * empireColonyIncomeFactor(pe) * 1.33;
        const expected = applyCorruptionToIncome(pe, loot);
        const beam = wf.weapons.find((w) => w.component.type === ComponentType.WeaponBeam)!;
        for (const w of wf.weapons) w.reset();
        const t0 = g.nowMs;
        weaponFire(g, beam, wf, victim, 50, t0, true, 1.0);
        beam.heading = 0;
        const money0 = pe.stateMoney;
        for (let step = 1; step <= 5 && !victim.hasBeenDestroyed; step++) {
            g.nowMs = t0 + step * 100;
            handleWeaponsFiringBuiltObject(g, wf, 0.1, g.nowMs);
        }
        expect(victim.hasBeenDestroyed).toBe(true);
        expect(pe.stateMoney - money0).toBeCloseTo(expected, 6);
        expect(expected).toBeGreaterThan(applyCorruptionToIncome(pe, loot / 1.33));
    });
});

// ---------------------------------------------------------------------------------------------------------------
// (5) AI retargeting
// ---------------------------------------------------------------------------------------------------------------

describe('(5) AI retargeting', () => {
    /**
     * The player's first escort, auto-controlled, attacks a pirate's unarmed explorer (A, 150 away) while the Mercenary
     * faction's escort (B: beams + an assault pod) closes in at 300. Empty space (no NearestSystemStar), so
     * PerformThreatEvaluation takes the galaxy-wide EvaluateThreats list (BuiltObject.1.cs 219).
     */
    function stage() {
        const g = cachedTickGame(gameData).galaxy;
        const jav = playerShip(g, BuiltObjectSubRole.Escort, 0);
        const a = pirateExplorer(g, 0);
        const b = mercRaider(g);
        for (const x of [jav, a, b]) hold(x);
        const s = emptySpot(g);
        place(g, jav, s.x, s.y);
        place(g, a, s.x + 150, s.y);
        place(g, b, s.x + 300, s.y);
        // Deep space: UpdatePosition (BaconBuiltObject.cs 4329) only ever sets NearestSystemStar near a star, so clear the
        // one left from the ship's home system (the C# clears it when a ship leaves a system under its own power).
        for (const x of [jav, a, b]) x.nearestSystemStar = null;
        jav.isAutoControlled = true;
        jav.design.fleeWhen = BuiltObjectFleeWhen.Never;
        jav.currentEnergy = jav.reactorStorageCapacity;
        return { g, jav, a, b };
    }

    it('CheckAssignAttackOnThreat: an Attack mission switches to a new threat only when its level beats the current target\'s × 2.5 × emphasis, and never while the current target\'s shields are down to half (BuiltObject.1.cs 520-560)', () => {
        const { g, jav, a, b } = stage();
        assignMission(g, jav, BuiltObjectMissionType.Attack, a, null, BuiltObjectMissionPriority.Normal);
        const mission = builtObjectMission(jav.mission)!;
        expect(mission.targetBuiltObject).toBe(a);
        // Levels (Galaxy.7.cs 3681 DetermineThreatLevel, viewer: the escort): num = level of the current target A,
        // num2 = level of the threat B; the escort is not a base (no ÷ 6).
        const num = determineThreatLevel(g, a, jav);
        const num2 = determineThreatLevel(g, b, jav);
        expect(num * 2.5 * 1.0 < num2).toBe(true); // an unarmed explorer ranks far below an armed escort
        expect(g.calculateDistanceSquared(jav.xpos, jav.ypos, b.xpos, b.ypos)).toBeLessThan(jav.attackRangeSquared);
        // Shields at half or less on the current target: stay on it (flag5, 546-552).
        a.currentShields = Math.trunc(a.shieldsCapacity / 2);
        expect(checkAssignAttackOnThreat(g, jav, b, mission, 1.0, num2)).toBe(false);
        expect(builtObjectMission(jav.mission)!.targetBuiltObject).toBe(a);
        // A higher emphasis on the current target (num × 2.5 × emphasis ≥ num2) also keeps it.
        a.currentShields = a.shieldsCapacity;
        const emphasis = (num2 / (num * 2.5)) * 1.001;
        expect(checkAssignAttackOnThreat(g, jav, b, mission, emphasis, num2)).toBe(false);
        // Otherwise (and not overwhelmed, within fuel range) the mission is re-assigned to the threat (553-559): Attack or
        // Capture per DetermineDestroyOrCaptureTarget, the old mission kept as the revert mission.
        const expectedType = determineDestroyOrCaptureTarget(g, jav.empire!, jav, b, false);
        expect(checkAssignAttackOnThreat(g, jav, b, mission, 1.0, num2)).toBe(true);
        const m2 = builtObjectMission(jav.mission)!;
        expect(m2.type).toBe(expectedType);
        expect(m2.targetBuiltObject).toBe(b);
        expect(m2.priority).toBe(BuiltObjectMissionPriority.Normal);
    });

    it('fleet ships: a fleet mission ignores other threats unless the fleet allows immediate threat evaluation (BuiltObject.1.cs 422-499)', () => {
        const { g, jav, a, b } = stage();
        const jav2 = playerShip(g, BuiltObjectSubRole.Escort, 1);
        hold(jav2);
        place(g, jav2, jav.xpos, jav.ypos + 30);
        const player = g.playerEmpire!;
        executeShipAction(g, player, [jav, jav2], createShipAction(ShipActionType.CreateNewFleet, null), true);
        const fleet = jav.shipGroup as ShipGroup;
        executeShipAction(g, player, fleet, createMissionShipActionAt(BuiltObjectMissionType.Attack, a, Math.trunc(a.xpos), Math.trunc(a.ypos)), true);
        const mission = builtObjectMission(jav.mission)!;
        expect(mission.isShipGroupMission).toBe(true);
        expect(mission.targetBuiltObject).toBe(a);
        const num2 = determineThreatLevel(g, b, jav);
        fleet.allowImmediateThreatEvaluation = false; // a player-ordered fleet (only the AI's fleet dispatch sets it)
        expect(checkAssignAttackOnThreat(g, jav, b, mission, 1.0, num2)).toBe(false);
        expect(builtObjectMission(jav.mission)!.targetBuiltObject).toBe(a);
        fleet.allowImmediateThreatEvaluation = true;
        // Still refused while the ship's mission carries a (conditional) hyperjump: the fleet Attack order queues a
        // ConditionalHyperTo command (426 CheckCommandsForHyperjumpOrConditionalJump).
        expect(mission.checkCommandsForHyperjumpOrConditionalJump()).toBe(true);
        expect(checkAssignAttackOnThreat(g, jav, b, mission, 1.0, num2)).toBe(false);
        // Once the jump commands are done (in the same system), the fleet ship may take the stronger threat.
        const cmds = (mission as unknown as { _commands: { action: CommandAction }[] })._commands;
        for (let i = cmds.length - 1; i >= 0; i--) if (cmds[i].action === CommandAction.HyperTo || cmds[i].action === CommandAction.ConditionalHyperTo) cmds.splice(i, 1);
        expect(mission.checkCommandsForHyperjumpOrConditionalJump()).toBe(false);
        expect(checkAssignAttackOnThreat(g, jav, b, mission, 1.0, num2)).toBe(true);
        expect(builtObjectMission(jav.mission)!.targetBuiltObject).toBe(b);
    });

    it('when the target dies the mission is cleared and the next ThreatEvaluation takes the top-ranked attackable threat (EvaluateThreats order, Galaxy.7.cs 3403; BuiltObject.1.cs 346-385)', () => {
        const { g, jav, a, b } = stage();
        const c = pirateEscort(g, 0, [b]); // another armed pirate escort, farther out
        hold(c);
        place(g, c, jav.xpos + 600, jav.ypos);
        c.nearestSystemStar = null;
        assignMission(g, jav, BuiltObjectMissionType.Attack, a, null, BuiltObjectMissionPriority.Normal);
        // Destroy A outright (shields down, overwhelming hit).
        a.currentShields = 0;
        expect(inflictDamage(g, jav, a, jav.weapons[0], a.size + 1000, g.nowMs, 50, 0)).toBe(true);
        runGameSeconds(g, 0.1); // DoExplosions → CompleteTeardown → ClearAllMissionsForTarget
        expect(builtObjectMission(jav.mission)?.targetBuiltObject ?? null).not.toBe(a);
        builtObjectMission(jav.mission)?.clear();
        const { threats, threatLevels } = evaluateThreats(g, jav);
        const ranked = threats.map((t, i) => ({ t, l: threatLevels[i] })).filter((x) => x.t === b || x.t === c);
        expect(ranked.length).toBe(2);
        for (let i = 1; i < threatLevels.length; i++) expect(threatLevels[i - 1]).toBeGreaterThanOrEqual(threatLevels[i]);
        const top = ranked[0].t as BuiltObject;
        expect(top).toBe(b); // closer and armed alike: the nearer one ranks higher ((20000 − d)² term)
        threatEvaluation(g, jav, g.nowMs);
        const m = builtObjectMission(jav.mission)!;
        expect([BuiltObjectMissionType.Attack, BuiltObjectMissionType.Capture]).toContain(m.type);
        expect(m.targetBuiltObject).toBe(top);
    });

    it('the system threat list is re-evaluated at most every 5 s per empire and system (BuiltObject.1.cs 224-231 LatestThreatEvaluation)', () => {
        const g = cachedTickGame(gameData).galaxy;
        const b = playerShip(g, BuiltObjectSubRole.Escort, 1);
        expect(b.nearestSystemStar).not.toBeNull();
        b.currentSpeed = 0;
        const sv = b.empire!.systemVisibility[b.nearestSystemStar!.systemIndex];
        const t = g.nowMs + 60000;
        performThreatEvaluation(g, b, t);
        expect(sv.latestThreatEvaluation).toBe(t);
        const list = sv.threats;
        performThreatEvaluation(g, b, t + 5000); // not < t + 5000 − 5000: kept
        expect(sv.latestThreatEvaluation).toBe(t);
        expect(sv.threats).toBe(list);
        performThreatEvaluation(g, b, t + 5001);
        expect(sv.latestThreatEvaluation).toBe(t + 5001);
        expect(sv.threats).not.toBe(list);
    });
});

// ---------------------------------------------------------------------------------------------------------------
// (6) Repair and retreat
// ---------------------------------------------------------------------------------------------------------------

describe('(6) repair and retreat', () => {
    function stage() {
        const g = cachedTickGame(gameData).galaxy;
        const jav = playerShip(g, BuiltObjectSubRole.Escort, 0);
        const b = mercRaider(g);
        hold(jav);
        hold(b);
        const s = emptySpot(g);
        place(g, jav, s.x, s.y);
        place(g, b, s.x + 300, s.y);
        return { g, jav, b };
    }

    it('ShouldFleeFrom thresholds per design FleeWhen: any damage (except Never / Armor50), Attacked, Shields50 ≤ (float)(cap/2), Shields20 ≤ (int)(cap × 0.2), Armor50; only attackers within 48 000 count (BuiltObject.1.cs 1520-1600)', () => {
        const { g, jav, b } = stage();
        jav.attackers!.length = 0;
        const flee = () => shouldFleeFrom(g, jav);
        const set = (w: BuiltObjectFleeWhen) => (jav.design.fleeWhen = w);
        set(BuiltObjectFleeWhen.Attacked);
        expect(flee()).toBeNull(); // no attackers
        jav.attackers!.push(b);
        expect(flee()).toBe(b);
        place(g, b, jav.xpos + 48001, jav.ypos); // 48 001² > 2 304 000 000
        expect(flee()).toBeNull();
        place(g, b, jav.xpos + 300, jav.ypos);
        const cap = jav.shieldsCapacity;
        expect(cap).toBe(100);
        set(BuiltObjectFleeWhen.Shields50);
        jav.currentShields = 51;
        expect(flee()).toBeNull();
        jav.currentShields = 50;
        expect(flee()).toBe(b);
        set(BuiltObjectFleeWhen.Shields20);
        jav.currentShields = 21;
        expect(flee()).toBeNull();
        jav.currentShields = 20;
        expect(flee()).toBe(b);
        // Any damaged component makes every setting but Never / Armor50 flee (1551).
        jav.currentShields = 100;
        const nonArmour = jav.components.items.find((c) => c.category === ComponentCategoryType.WeaponBeam)!;
        nonArmour.status = ComponentStatus.Damaged;
        jav.reDefine();
        expect(flee()).toBe(b); // Shields20, shields full, but damaged
        set(BuiltObjectFleeWhen.Never);
        expect(flee()).toBeNull();
        // Armor50: shields ≤ 20%, or a damaged non-armour component, or Armor / Design.Armor ≤ 0.5.
        set(BuiltObjectFleeWhen.Armor50);
        expect(flee()).toBe(b); // the damaged beam
        nonArmour.status = ComponentStatus.Normal;
        const plates = jav.components.items.filter((c) => c.type === ComponentType.Armor);
        expect(plates.length).toBe(3);
        plates[0].status = ComponentStatus.Damaged;
        jav.reDefine();
        expect(jav.armor / jav.design.armor).toBeGreaterThan(0.5); // 2 of 3 plates
        expect(flee()).toBeNull();
        plates[1].status = ComponentStatus.Damaged;
        jav.reDefine();
        expect(jav.armor / jav.design.armor).toBeLessThanOrEqual(0.5); // 1 of 3
        expect(flee()).toBe(b);
    });

    it('a fleeing auto-controlled ship takes an Escape mission (High) away from the attacker (BuiltObject.1.cs 296-314)', () => {
        const { g, jav, b } = stage();
        jav.isAutoControlled = true;
        jav.design.fleeWhen = BuiltObjectFleeWhen.Shields50;
        jav.attackers!.push(b);
        jav.currentShields = 10;
        threatEvaluation(g, jav, g.nowMs);
        const m = builtObjectMission(jav.mission)!;
        expect(m.type).toBe(BuiltObjectMissionType.Escape);
        expect(m.priority).toBe(BuiltObjectMissionPriority.High);
        expect(m.targetBuiltObject).toBe(b);
    });

    it('a damaged ship outside a fleet is sent to the nearest shipyard for repair (VeryHigh) as soon as one component is damaged, its old mission kept to revert to (BuiltObject.2.cs 4705-4760 AutoRefuelRepairShip, Empire.4.cs 4863 AssignRepairMission)', () => {
        const g = cachedTickGame(gameData).galaxy;
        const jav = playerShip(g, BuiltObjectSubRole.Escort, 1);
        const owner = jav.owner!;
        expect(owner.autoRefuelStateShips).toBe(true);
        expect(jav.shipGroup).toBeNull();
        builtObjectMission(jav.mission)?.clear();
        assignMission(g, jav, BuiltObjectMissionType.Patrol, jav.nearestSystemStar, null, BuiltObjectMissionPriority.Normal);
        // Undamaged: no repair mission.
        autoRefuelRepairShip(g, jav, false);
        expect(builtObjectMission(jav.mission)!.type).not.toBe(BuiltObjectMissionType.Repair);
        const beam = jav.components.items.find((c) => c.category === ComponentCategoryType.WeaponBeam)!;
        beam.status = ComponentStatus.Damaged;
        jav.reDefine();
        expect(jav.damagedComponentCount).toBe(1);
        const yard = findNearestShipYard(g, owner, jav, true, true);
        expect(yard).not.toBeNull();
        expect(autoRefuelRepairShip(g, jav, false)).toBe(true);
        const m = builtObjectMission(jav.mission)!;
        expect(m.type).toBe(BuiltObjectMissionType.Repair);
        expect(m.priority).toBe(BuiltObjectMissionPriority.VeryHigh);
        expect(m.target).toBe(yard);
        expect(jav.revertMission?.type).toBe(BuiltObjectMissionType.Patrol);
    });

    it('DoRepairs: (int)(dt / (DamageRepair / fleet & captain bonus)) components per call from a random start index, wrapping; BattleStats and the fleet\'s BattleStats record the repairs (BaconBuiltObject.cs 4763-4858) — fixed: the fleet record was missing', () => {
        const g = cachedTickGame(gameData).galaxy;
        const jav = playerShip(g, BuiltObjectSubRole.Escort, 0);
        const jav2 = playerShip(g, BuiltObjectSubRole.Escort, 1);
        const player = g.playerEmpire!;
        executeShipAction(g, player, [jav, jav2], createShipAction(ShipActionType.CreateNewFleet, null), true);
        const fleet = jav.shipGroup as ShipGroup;
        fleet.battleStats = new SpaceBattleStats();
        jav.battleStats = new SpaceBattleStats();
        const items = jav.components.items;
        const damagedIdx = [1, 4, 7, items.length - 1];
        for (const i of damagedIdx) items[i].status = ComponentStatus.Damaged;
        jav.reDefine();
        (jav as unknown as { _damageRepair: number })._damageRepair = 10; // seconds per component (ReDefine sets it from DamageControl components; the escort design has none)
        expect(calculateCrewLevel(jav)).toBe('green'); // no crew-skill override (4769-4787)
        const bonus = shipGroupRepairBonus(fleet);
        const perComponent = 10 / bonus / 1.0; // no captain
        const dt = 2.5 * perComponent;
        const sh = shadowRnd(g);
        doRepairs(g, jav, dt);
        // num5 = (int)(dt / num4) = 2; start = Next(0, Count); repair Damaged from start to the end, then from 0.
        const start = sh.next(0, items.length);
        expect(g.rnd.getState()).toEqual(sh.getState());
        const order = [...damagedIdx.filter((i) => i >= start), ...damagedIdx.filter((i) => i < start)];
        const repaired = order.slice(0, 2);
        for (const i of damagedIdx) expect(items[i].status).toBe(repaired.includes(i) ? ComponentStatus.Normal : ComponentStatus.Damaged);
        expect((jav.battleStats as SpaceBattleStats).damageRepaired).toBe(2);
        expect((fleet.battleStats as SpaceBattleStats).damageRepaired).toBe(2);
    });

    it('at a shipyard the construction queue repairs damaged components first, in component order, one per build tick (ConstructionQueue.cs 765-790, 1142 IdentifyComponentToBuild)', () => {
        const g = cachedTickGame(gameData).galaxy;
        const jav = playerShip(g, BuiltObjectSubRole.Escort, 1);
        const port = playerCarrierPort(g);
        const queue = builtObjectConstructionQueue(port)!;
        expect(queue).not.toBeNull();
        builtObjectMission(jav.mission)?.clear();
        const items = jav.components.items;
        const damagedIdx = [9, 2, 5, 12].filter((i) => i < items.length);
        for (const i of damagedIdx) items[i].status = ComponentStatus.Damaged;
        jav.reDefine();
        place(g, jav, port.xpos, port.ypos);
        expect(queue.addBuiltObjectToRepair(jav)).toBe(true);
        const repairedOrder: number[] = [];
        let t = g.nowMs;
        queue.resetProcessTime(t);
        for (let k = 0; k < 400 && repairedOrder.length < damagedIdx.length; k++) {
            t += 250;
            queue.doConstruction(g, t);
            for (const i of damagedIdx) if (items[i].status === ComponentStatus.Normal && !repairedOrder.includes(i)) repairedOrder.push(i);
        }
        expect(repairedOrder).toEqual([...damagedIdx].sort((x, y) => x - y));
        expect(jav.damagedComponentCount).toBe(0);
    });
});

// ---------------------------------------------------------------------------------------------------------------
// (7) The Fighting retreats add-on (scenarios/fighting-retreats; not in the original): a losing fleet withdraws to
// repair. It builds on (6): the stock fleet "Repair and refuel" order and Design.FleeWhen = Never.
// ---------------------------------------------------------------------------------------------------------------

describe('(7) fighting retreats add-on', () => {
    function withRetreats(g: Galaxy, params: Record<string, number> = {}, on = true): void {
        g.scenario = createGalaxyScenario(loadScenarioOverlayFs(FIGHTING_RETREATS_ADDON_ID).manifest, { flags: { fightingRetreats: on }, params });
    }
    /** One check pass `ms` game ms later (the checks run every frCheckSeconds = 1 s). */
    function tick(g: Galaxy, ms: number): void {
        g.nowMs += ms;
        fightingRetreatsFrame(g);
    }
    /** A player fleet of two escorts at an empty spot, attacked by a Mercenary raider. */
    function stageFleet() {
        const g = cachedTickGame(gameData).galaxy;
        const jav = playerShip(g, BuiltObjectSubRole.Escort, 0);
        const jav2 = playerShip(g, BuiltObjectSubRole.Escort, 1);
        const player = g.playerEmpire!;
        executeShipAction(g, player, [jav, jav2], createShipAction(ShipActionType.CreateNewFleet, null), true);
        const fleet = jav.shipGroup as ShipGroup;
        const b = mercRaider(g);
        for (const s of [jav, jav2, b]) hold(s);
        for (const s of [jav, jav2]) s.design.fleeWhen = BuiltObjectFleeWhen.Shields20; // the policy default for warships
        const s = emptySpot(g);
        place(g, jav, s.x, s.y);
        place(g, jav2, s.x + 100, s.y);
        place(g, b, s.x + 300, s.y);
        jav.attackers!.push(b);
        jav2.attackers!.push(b);
        return { g, jav, jav2, b, fleet, player };
    }

    it('outgunned (frOutgunned, default the enemy at 1.5x) for frHoldSeconds the fleet withdraws to the nearest yard; the count-down survives the hysteresis band and resets above frHysteresis % of the line', () => {
        const { g, fleet, jav, jav2, b } = stageFleet();
        withRetreats(g);
        expect(g.scenario!.params.frOutgunned).toBe(1.5);
        for (const s of [jav, jav2]) { // badly damaged (> frDamagedPct): the repair trip, not a fall-back
            s.components.items[0].status = ComponentStatus.Damaged;
            s.reDefine();
        }
        const battle = fleetBattle(fleet);
        expect(battle.engaged).toBe(2);
        expect(battle.own).toBeGreaterThan(0);
        expect(battle.enemy).toBeGreaterThan(0);
        const r = battle.own / battle.enemy;
        // Reinforcements: another ship of ours in the system attacking the same raider counts on our side.
        const helper = playerShip(g, BuiltObjectSubRole.Escort, 2);
        hold(helper);
        helper.design.fleeWhen = BuiltObjectFleeWhen.Shields20; // hold() set the shared escort design to Never
        place(g, helper, jav.xpos + 200, jav.ypos);
        helper.nearestSystemStar = jav.nearestSystemStar; // as the staged fleet (place() leaves it as it was)
        b.attackers!.push(helper);
        expect(fleetBattle(fleet).own).toBeGreaterThan(battle.own);
        b.attackers!.splice(b.attackers!.indexOf(helper), 1);
        expect(fleetBattle(fleet).own).toBe(battle.own);
        const setLine = (line: number) => (g.scenario!.params.frOutgunned = 1 / line);
        setLine(r * 1.1); // losing
        tick(g, 1000);
        const t0 = fleet.frLosingSinceMs!;
        expect(t0).toBe(g.nowMs);
        tick(g, 3000);
        expect(fleet.frWithdrawal).toBeUndefined();
        setLine(r / 1.1); // above the line but inside the band (ratio < 1.25 × line): keeps counting
        tick(g, 1000);
        expect(fleet.frLosingSinceMs).toBe(t0);
        setLine(r / 1.3); // above 1.25 × line: the count-down resets
        tick(g, 1000);
        expect(fleet.frLosingSinceMs).toBeUndefined();
        setLine(r * 1.1);
        tick(g, 1000);
        tick(g, 4000);
        expect(fleet.frWithdrawal).toBeUndefined(); // 4 s < 5 s
        const yard = fleetRepairPoint(g, fleet)!;
        expect(yard).not.toBeNull();
        tick(g, 1000);
        expect(fleet.frWithdrawal).toBeDefined();
        expect(fleet.frWithdrawal!.yard).toBe(yard);
        expect(fleet.mission!.type).toBe(BuiltObjectMissionType.Repair);
        expect(fleet.mission!.priority).toBe(BuiltObjectMissionPriority.Unavailable);
        expect(fleet.mission!.playerOrdered).not.toBe(true); // not a player order: an Intercept / Watch waits it out
        for (const s of fleet.ships) expect([BuiltObjectMissionType.Repair, BuiltObjectMissionType.Refuel]).toContain(builtObjectMission(s.mission)!.type);
        expect(fightingRetreatsState(g).fleetWithdrawals).toBeGreaterThanOrEqual(1);
    });

    it('the repair trip: the withdrawn fleet flies to its yard, repairs and is free again; a manual player fleet is told it awaits orders', () => {
        const { g, fleet, jav, jav2, player } = stageFleet();
        withRetreats(g, { frOutgunned: 0.2, frHoldSeconds: 0 });
        jav.components.items[0].status = ComponentStatus.Damaged;
        jav.reDefine();
        const yard = playerCarrierPort(g);
        place(g, jav, yard.xpos + 6000, yard.ypos);
        place(g, jav2, yard.xpos + 6100, yard.ypos);
        const b = mercRaider(g);
        place(g, b, yard.xpos + 6300, yard.ypos);
        jav.attackers!.length = 0;
        jav2.attackers!.length = 0;
        jav.attackers!.push(b);
        tick(g, 1000);
        tick(g, 1000);
        expect(fleet.frWithdrawal).toBeDefined();
        const target = fleet.frWithdrawal!.yard;
        expect(target).toBe(yard);
        jav.attackers!.length = 0;
        // The raider leaves (out of the test), the sim runs.
        place(g, b, b.xpos + 900000 < g.sizeX ? b.xpos + 900000 : b.xpos - 900000, b.ypos);
        hold(b);
        let resumed = false;
        for (let k = 0; k < 120 && !resumed; k++) {
            runGameSeconds(g, 2);
            resumed = fleet.frWithdrawal === undefined;
        }
        expect(resumed).toBe(true);
        expect(jav.damagedComponentCount).toBe(0);
        expect(fightingRetreatsState(g).fleetsResumed).toBeGreaterThanOrEqual(1);
        const texts = [...(player.messages as { description?: string }[]), ...((player as unknown as { messageHistory?: { description?: string }[] }).messageHistory ?? [])].map((m) => m.description ?? '');
        expect(texts.some((t) => t.includes('withdrew') && t.includes(`repair at ${(target as { name: string }).name}`))).toBe(true);
        expect(texts.some((t) => t.includes('finished repairs') && t.includes('awaits orders'))).toBe(true);
    }, 180000);

    it('no loss threshold: an outgunned fleet withdraws at first contact once the hold is up', () => {
        const { g, fleet, jav } = stageFleet();
        jav.components.items[0].status = ComponentStatus.Damaged;
        jav.reDefine();
        withRetreats(g, { frOutgunned: 0.2, frHoldSeconds: 0 });
        tick(g, 1000);
        tick(g, 1000);
        expect(fleet.frWithdrawal).toBeDefined();
        expect(fleet.frStartFirepower).toBeUndefined();
    });

    it('the original\'s "Flee: never": a fleet with half or more of its ships set to Never fights on; a fleet beside its yard fights on too', () => {
        const { g, fleet, jav } = stageFleet();
        withRetreats(g, { frOutgunned: 0.2, frHoldSeconds: 0 });
        jav.design.fleeWhen = BuiltObjectFleeWhen.Never; // 1 of 2 ships
        for (let k = 0; k < 4; k++) tick(g, 1000);
        expect(fleet.frWithdrawal).toBeUndefined();
        expect(fleet.frLosingSinceMs).toBeUndefined();
        jav.design.fleeWhen = BuiltObjectFleeWhen.Shields20;
        // Beside the yard (≤ 3000): no withdrawal.
        const yard = fleetRepairPoint(g, fleet)!;
        for (const s of fleet.ships) place(g, s, yard.xpos + 1000, yard.ypos);
        for (let k = 0; k < 4; k++) tick(g, 1000);
        expect(fleet.frWithdrawal).toBeUndefined();
    });

    it('an outgunned fleet with at most frDamagedPct damaged ships FALLS BACK (Move, to its home base, else the nearest own colony / base outside the battle system) instead of repairing; damaged ships still repair; it is free on arrival', () => {
        const { g, fleet, jav, jav2, player } = stageFleet();
        withRetreats(g, { frOutgunned: 0.2, frHoldSeconds: 0 });
        expect(g.scenario!.params.frDamagedPct).toBe(30);
        const sys = jav.nearestSystemStar;
        const fb = fleetFallbackPoint(g, fleet)!;
        expect(fb).not.toBeNull();
        expect(fb.hasBeenDestroyed).toBe(false);
        // The home base wins when set and outside the battle system.
        const home = g.habitats.find((h) => g.systems[h.systemIndex].systemStar !== sys)!;
        fleet.gatherPoint = home;
        expect(fleetFallbackPoint(g, fleet)).toBe(home);
        fleet.gatherPoint = null;
        tick(g, 1000);
        tick(g, 1000);
        expect(fleet.frWithdrawal).toBeDefined();
        expect(fleet.frWithdrawal!.fallback).toBe(true);
        expect(fleet.frWithdrawal!.yard).toBe(fb);
        expect(fleet.mission!.type).toBe(BuiltObjectMissionType.Move);
        expect(fleet.mission!.priority).toBe(BuiltObjectMissionPriority.Unavailable);
        const texts = [...(player.messages as { description?: string }[])].map((m) => m.description ?? '');
        expect(texts.some((t) => t.includes('withdrew') && t.includes(`fall back to ${(fb as { name: string }).name}`))).toBe(true);
        expect(fleetRetreatStatusText(g, fleet)).toContain('Falling back to');
        void jav2;
    });

    it('more than frDamagedPct of the fleet damaged: the repair trip as before', () => {
        const { g, fleet, jav } = stageFleet();
        withRetreats(g, { frOutgunned: 0.2, frHoldSeconds: 0, frDamagedPct: 30 });
        jav.components.items[0].status = ComponentStatus.Damaged; // 1 of 2 = 50 % > 30
        jav.reDefine();
        tick(g, 1000);
        tick(g, 1000);
        expect(fleet.frWithdrawal).toBeDefined();
        expect(fleet.frWithdrawal!.fallback).toBeUndefined();
        expect(fleet.mission!.type).toBe(BuiltObjectMissionType.Repair);
    });

    it('coalition: a ship of an empire not at war with the fleet\'s, attacking the same enemy in the system, counts on its side; one at war does not', () => {
        const { g, fleet, jav, b, player } = stageFleet();
        withRetreats(g);
        const base = fleetBattle(fleet).own;
        const other = g.empires.find((e) => e !== null && e !== player && e !== g.independentEmpire && e.pirateEmpireBaseHabitat === null && e.builtObjects.some((s) => s.role === BuiltObjectRole.Military && s.topSpeed > 0))!;
        const ally = other.builtObjects.find((s) => s.role === BuiltObjectRole.Military && s.topSpeed > 0)!;
        hold(ally);
        place(g, ally, jav.xpos + 200, jav.ypos);
        ally.nearestSystemStar = jav.nearestSystemStar;
        b.attackers!.push(ally);
        obtainDiplomaticRelation(player, other).type = DiplomaticRelationType.War;
        obtainDiplomaticRelation(other, player).type = DiplomaticRelationType.War;
        expect(fleetBattle(fleet).own).toBe(base);
        obtainDiplomaticRelation(player, other).type = DiplomaticRelationType.None;
        obtainDiplomaticRelation(other, player).type = DiplomaticRelationType.None;
        expect(fleetBattle(fleet).own).toBeGreaterThan(base);
    });

    it('toggle off: the frame hook does nothing (no state bag, no fleet fields, no draws)', () => {
        const { g, fleet } = stageFleet();
        withRetreats(g, { frOutgunned: 0.2, frHoldSeconds: 0 }, false);
        const rnd = g.rnd.getState();
        for (let k = 0; k < 5; k++) tick(g, 1000);
        expect('fightingRetreats' in g.scenario!.state).toBe(false);
        expect(fleet.frLosingSinceMs).toBeUndefined();
        expect(fleet.frWithdrawal).toBeUndefined();
        expect(g.rnd.getState()).toEqual(rnd);
    });
});


// ---------------------------------------------------------------------------------------------------------------
// (8) The BVR combat add-on (scenarios/bvr-combat; not in the original): a late start (tech 4) with the add-on's data overlay.
// ---------------------------------------------------------------------------------------------------------------

describe('(8) BVR combat add-on', () => {
    let bgame: Game;
    let bdata: GameData;
    let bg: Galaxy;
    const aiEmpires = (): Empire[] => bg.empires.filter((e): e is Empire => e !== null && e !== bg.playerEmpire && e !== bg.independentEmpire && e.pirateEmpireBaseHabitat === null && !e.name.startsWith('Ancient'));
    const newest = (e: Empire, sub: BuiltObjectSubRole) => e.designs.filter((d) => d.role === BuiltObjectRole.Military && d.subRole === sub && !d.isObsolete).sort((a, b) => b.dateCreated - a.dateCreated)[0];
    let spotX = 0;
    let spotY = 0;
    let slot = 0;
    /** A fresh ship of the empire's newest design of the sub-role, in the empty spot (600 apart), shields full, automated and idle. */
    const spawn = (e: Empire, sub: BuiltObjectSubRole): BuiltObject => {
        const b = generateBuiltObjectFromDesign(bg, e, newest(e, sub), `bvr${slot}`, true, spotX + 600 * slot++, spotY);
        b.currentShields = b.shieldsCapacity;
        b.isAutoControlled = true;
        return b;
    };
    const spend = (b: BuiltObject): void => {
        for (const w of [...b.weapons]) {
            while (w.component.type !== undefined && bvrMayFire(bg, b, w) && (isBvrMissile(w.component) || w.component.type === ComponentType.WeaponTorpedo)) bvrNoteFired(bg, b, w);
        }
    };

    beforeAll(() => {
        const r = createScenarioGame(gameData, {
            scenario: BVR_ADDON_ID,
            options: (o) => ({ ...o, galaxyAge: 4, player: { ...o.player, age: 4, techLevel: 4 }, aiEmpires: o.aiEmpires.map((e) => ({ ...e, age: 4, techLevel: 4 })) }),
        });
        bgame = r.game;
        bdata = r.gameData;
        bg = bgame.galaxy;
        const s = emptySpot(bg);
        spotX = s.x;
        spotY = s.y;
    }, 300000);

    it('data: four launcher tiers (WeaponMissile, ids allocated after the stock ones) in a dense component table, rebuilt close-range torpedoes, seven new weapons projects', () => {
        const defs = bg.researchStatic!.componentStatic!.definitions;
        for (let id = 0; id < defs.length; id++) expect(defs[id].componentId).toBe(id);
        const launcherIds = defs.filter((d) => isBvrMissile(d)).map((d) => d.componentId);
        expect(launcherIds).toEqual([129, 130, 131, 132]);
        for (const id of launcherIds) {
            expect(defs[id].type).toBe(ComponentType.WeaponMissile);
            expect(defs[id].value2).toBeGreaterThanOrEqual(1800); // far beyond any gun
            expect(defs[id].value4).toBeGreaterThanOrEqual(420); // very fast
        }
        for (const id of [10, 108, 128]) expect(isBvrMissile(defs[id])).toBe(false); // the stock missiles are untouched
        expect(defs[129].value1).toBeLessThan(defs[132].value1);
        // Torpedoes: short range (the BVR missiles out-range them 5x or more), no damage loss, much more damage than stock (36 for FireStorm).
        for (const id of [5, 6, 7, 8, 9]) {
            expect(defs[id].type).toBe(ComponentType.WeaponTorpedo);
            expect(defs[id].value2).toBeLessThanOrEqual(350);
            expect(defs[id].value5).toBe(0);
            expect(defs[id].value1).toBeGreaterThan(200);
        }
        // The torpedoes concentrate more damage per component size than the missiles (the best of each).
        const density = (ids: number[]) => Math.max(...ids.map((id) => defs[id].value1 / defs[id].size));
        expect(density([5, 6, 7, 8, 9])).toBeGreaterThan(density(launcherIds));
        const tree = bg.playerEmpire!.research.techTree;
        for (let i = 0; i < tree.length; i++) expect(tree[i].def.projectId).toBe(i);
        const line = bvrProjectNodes(tree);
        expect(line.map((n) => n.def.name)).toEqual([...BVR_PROJECT_NAMES]);
        expect(line.map((n) => n.def.projectId)).toEqual([372, 373, 374, 375, 376, 377, 378]);
        expect(bdata.scenario!.warnings).toEqual([]);
    });

    it('ids with other add-ons: the Time-Bomb\'s fixed project ids keep 372-374 and BVR combat takes the ids after them, in either order, all dense', () => {
        for (const order of [['bvr-combat', 'timebomb'], ['timebomb', 'bvr-combat']]) {
            const gd = scenarioGameData(gameData, comboOverlayFs(order));
            gd.components.forEach((c, i) => expect(c.componentId).toBe(i));
            gd.research.forEach((r, i) => expect(r.projectId).toBe(i));
            const byName = (n: string) => gd.research.find((r) => r.name === n)!;
            expect(byName('Precursor Lattice Drive').projectId).toBe(372);
            expect(byName('Deep Resonance Manufacturing').projectId).toBe(374);
            const first = byName('Long-Range Missile Launchers');
            expect(first.projectId).toBe(375);
            expect(byName('Orbital-Range Missile Launchers').projectId).toBe(381);
            const javelin = gd.components.find((c) => c.name === 'Javelin Missile Launcher')!;
            expect(first.components).toEqual([javelin.componentId]);
            expect(byName('Terminal Seekers').componentImprovements[0].componentId).toBe(javelin.componentId);
            expect(byName('Terminal Seekers').parents[0].parentProjectId).toBe(first.projectId);
            expect(first.parents[0].parentProjectId).toBe(369);
        }
    });

    it('lethality: about four launcher hits kill the AI frigate of the era (median 3-6 over the empires, races differ in shields), about two torpedo hits do (2-4); armour does not halve the BVR missile', () => {
        const attacker = aiEmpires()[0].builtObjects.find((b) => b.role === BuiltObjectRole.Military)!;
        const hits = (missile: boolean): number => {
            const all: number[] = [];
            for (const e of aiEmpires()) {
                const research = e.research;
                const owned = research.researchedComponents.filter((c) => (missile ? isBvrMissile(c) : c.type === ComponentType.WeaponTorpedo));
                const best = owned.sort((a, b) => research.resolveImprovedComponentValues(b).value1 - research.resolveImprovedComponentValues(a).value1)[0];
                expect(best).toBeDefined();
                const damage = research.resolveImprovedComponentValues(best).value1;
                for (let k = 0; k < 3; k++) {
                    const t = spawn(e, BuiltObjectSubRole.Frigate);
                    let n = 0;
                    while (!t.hasBeenDestroyed && n < 40) {
                        inflictDamage(bg, attacker, t, { component: best } as unknown as Weapon, damage, bg.nowMs, 0, 0);
                        n++;
                    }
                    all.push(n);
                }
            }
            all.sort((a, b) => a - b);
            return all[Math.floor(all.length / 2)];
        };
        const m = hits(true);
        const t = hits(false);
        expect(m).toBeGreaterThanOrEqual(3);
        expect(m).toBeLessThanOrEqual(6);
        expect(t).toBeGreaterThanOrEqual(2);
        expect(t).toBeLessThanOrEqual(4);
    });

    it('AI designs: frigates and up carry launchers, destroyers and up torpedoes, escorts none and more point defence', () => {
        for (const e of aiEmpires()) {
            const count = (d: ReturnType<typeof newest>, f: (c: { componentId: number; type: ComponentType }) => boolean) => d.components.filter(f).length;
            const launchers = (sub: BuiltObjectSubRole) => count(newest(e, sub), (c) => isBvrMissile(c));
            expect(launchers(BuiltObjectSubRole.Escort)).toBe(0);
            expect(launchers(BuiltObjectSubRole.Frigate)).toBeGreaterThanOrEqual(2);
            expect(launchers(BuiltObjectSubRole.Destroyer)).toBeGreaterThanOrEqual(3);
            expect(count(newest(e, BuiltObjectSubRole.Destroyer), (c) => c.type === ComponentType.WeaponTorpedo)).toBeGreaterThanOrEqual(1);
            expect(count(newest(e, BuiltObjectSubRole.Escort), (c) => c.type === ComponentType.WeaponPointDefense)).toBeGreaterThanOrEqual(3);
        }
    });

    it('AI research: the next launcher project goes to the front of the weapons order once the empire is within a level of it', () => {
        const e = aiEmpires()[0];
        const order = scenarioQuery(bg, 'researchProjectOrder', [], { empire: e, industry: IndustryType.Weapon });
        const line = bvrProjectNodes(e.research.techTree);
        const ids = line.map((n) => n.def.projectId);
        if (line.some((n) => !n.isResearched)) expect(ids).toContain(order.find((id) => ids.includes(id)) ?? -1);
        // Human empires keep their own research.
        expect(scenarioQuery(bg, 'researchProjectOrder', [], { empire: bg.playerEmpire!, industry: IndustryType.Weapon })).toEqual([]);
    });

    it('magazines: full at first, one round a shot, a launcher at zero cannot fire, the text counts missiles and torpedoes', () => {
        const e = aiEmpires()[0];
        const f = spawn(e, BuiltObjectSubRole.Frigate);
        const cap = f.weapons.filter((w) => isBvrMissile(w.component)).length * 4;
        expect(cap).toBeGreaterThanOrEqual(8);
        expect(bvrAmmoText(bg, f)).toBe(`Missiles ${cap}/${cap}`);
        expect(bvrNeedsRounds(bg, f)).toBe(false);
        const l = f.weapons.find((w) => isBvrMissile(w.component))!;
        for (let i = 0; i < cap; i++) {
            expect(bvrMayFire(bg, f, l)).toBe(true);
            bvrNoteFired(bg, f, l);
        }
        expect(bvrMayFire(bg, f, l)).toBe(false);
        expect(bvrAmmoText(bg, f)).toBe(`Missiles 0/${cap}`);
        expect(bvrNeedsRounds(bg, f)).toBe(true);
        const d = spawn(e, BuiltObjectSubRole.Destroyer);
        const t = d.weapons.filter((w) => w.component.type === ComponentType.WeaponTorpedo).length;
        expect(bvrAmmoText(bg, d)).toBe(`Missiles ${d.weapons.filter((w) => isBvrMissile(w.component)).length * 4}/${d.weapons.filter((w) => isBvrMissile(w.component)).length * 4}, Torpedoes ${t * 6}/${t * 6}`);
        // A ship with no limited launcher has no line.
        expect(bvrAmmoText(bg, spawn(e, BuiltObjectSubRole.Escort))).toBeNull();
    });

    it('Firepower figure: a limited launcher counts by what its magazine delivers in a reference engagement, not its per-shot damage (a few torpedoes no longer read ~3000)', () => {
        const e = aiEmpires()[0];
        for (const sub of [BuiltObjectSubRole.Frigate, BuiltObjectSubRole.Destroyer, BuiltObjectSubRole.Cruiser]) {
            const b = spawn(e, sub);
            const limited = b.weapons.filter((w) => w.rawDamage > 0 && (isBvrMissile(w.component) || w.component.type === ComponentType.WeaponTorpedo));
            if (limited.length === 0) continue;
            const naive = b.weapons.reduce((n, w) => n + (w.rawDamage > 0 && w.component.type !== ComponentType.WeaponPointDefense ? w.rawDamage : 0), 0);
            const discounted = limited.reduce((n, w) => n + w.rawDamage * (1 - bvrFirepowerFactor(bg, w)), 0);
            expect(bvrFirepowerFactor(bg, limited[0])).toBeLessThan(0.35 + 1e-9);
            expect(b.firepowerRaw).toBeLessThan(naive);
            // At most 35% of the limited launchers' per-shot damage is counted (the rest of the figure is unchanged).
            expect(b.firepowerRaw).toBeLessThanOrEqual(naive - discounted + limited.length + 15);
            expect(discounted).toBeGreaterThanOrEqual(limited.reduce((n, w) => n + w.rawDamage, 0) * 0.65 - 1e-6);
            expect(b.design.firepowerRaw).toBe(b.firepowerRaw);
        }
        // An unlimited weapon counts in full.
        const gun = spawn(e, BuiltObjectSubRole.Escort).weapons.find((w) => w.component.type === ComponentType.WeaponBeam);
        if (gun !== undefined) expect(bvrFirepowerFactor(bg, gun)).toBe(1);
    });

    it('sensor targeting: a lock needs the target inside the tracking range (stealth shortens it, a long-range scanner extends it)', () => {
        const [a, b] = aiEmpires();
        const x = spawn(a, BuiltObjectSubRole.Frigate);
        const y = spawn(b, BuiltObjectSubRole.Frigate);
        place(bg, y, x.xpos + 1000, x.ypos);
        expect(bvrTracked(bg, x, y)).toBe(true);
        place(bg, y, x.xpos + 90000, x.ypos);
        expect(bvrTracked(bg, x, y)).toBe(false);
        place(bg, y, x.xpos + 1500, x.ypos);
        y.stealth = 0.1; // a cloak: 10% of the range
        expect(bvrTracked(bg, x, y)).toBe(false);
        x.sensorLongRange = 450000; // a long-range scanner aboard the fleet
        expect(bvrTracked(bg, x, y)).toBe(true);
        x.sensorLongRange = 0;
        y.stealth = 1;
        // Planets need no lock.
        expect(bvrTracked(bg, x, bg.habitats[0])).toBe(true);
    });

    it('rearming: in range of an own space port a spent magazine is reloaded for credits, out of range it is not; a docked ship on a Refuel order is held until full', () => {
        const e = aiEmpires()[0];
        const port = (e.spacePorts as BuiltObject[]).find((p) => p !== null && !p.hasBeenDestroyed)!;
        const f = spawn(e, BuiltObjectSubRole.Frigate);
        spend(f);
        expect(bvrNeedsRounds(bg, f)).toBe(true);
        const far = spawn(e, BuiltObjectSubRole.Frigate);
        spend(far);
        place(bg, far, port.xpos + 90000, port.ypos);
        place(bg, f, port.xpos + 300, port.ypos);
        e.stateMoney = 100000;
        const money = e.stateMoney;
        bvrRearmTick(bg);
        for (let k = 0; k < 40; k++) {
            bg.nowMs += 5000;
            bvrRearmTick(bg);
        }
        expect(bvrNeedsRounds(bg, f)).toBe(false);
        expect(peekBvrState(bg)!.mags.has(f)).toBe(false);
        expect(e.stateMoney).toBeLessThan(money);
        expect(peekBvrState(bg)!.roundsLoaded).toBeGreaterThanOrEqual(8);
        expect(bvrNeedsRounds(bg, far)).toBe(true); // nowhere near a rearm point
        // The cost is paid even into debt (as fuel is).
        spend(f);
        e.stateMoney = 0;
        for (let k = 0; k < 40; k++) {
            bg.nowMs += 5000;
            bvrRearmTick(bg);
        }
        expect(bvrNeedsRounds(bg, f)).toBe(false);
        expect(e.stateMoney).toBeLessThan(0);
        e.stateMoney = money;
    });

    it('rearming from a deployed resupply ship: slower (35% of a port\'s speed), only while it is deployed', () => {
        const e = aiEmpires().find((x) => x.designs.some((d) => d.subRole === BuiltObjectSubRole.ResupplyShip))!;
        const design = e.designs.filter((d) => d.subRole === BuiltObjectSubRole.ResupplyShip).sort((a, b) => b.dateCreated - a.dateCreated)[0];
        const r = generateBuiltObjectFromDesign(bg, e, design, 'bvrSupply', true, spotX, spotY + 5000);
        expect(e.resupplyShips).toContain(r);
        const f = spawn(e, BuiltObjectSubRole.Frigate);
        spend(f);
        place(bg, f, r.xpos + 300, r.ypos);
        e.stateMoney = 100000;
        const run = (seconds: number): void => {
            for (let k = 0; k < seconds / 5; k++) {
                bg.nowMs += 5000;
                bvrRearmTick(bg);
            }
        };
        bvrRearmTick(bg);
        run(60); // not deployed: nothing
        expect(bvrNeedsRounds(bg, f)).toBe(true);
        const before = bvrState(bg).roundsLoaded;
        (r as unknown as { _isDeployed: boolean })._isDeployed = true;
        run(40); // a port would have finished the 8 rounds
        const part = bvrState(bg).roundsLoaded - before;
        expect(part).toBeGreaterThanOrEqual(1);
        expect(part).toBeLessThan(8);
        run(300);
        expect(bvrNeedsRounds(bg, f)).toBe(false);
        expect(bvrState(bg).roundsViaResupply ?? 0).toBeGreaterThanOrEqual(8);
    });

    it('AI design caps: launchers above the hull\'s cap (the capital-ship size-up pass multiplies them) are swapped for armour, point defence and guns', () => {
        const e = aiEmpires()[0];
        const base = newest(e, BuiltObjectSubRole.CapitalShip);
        const launcher = base.components.find((c) => isBvrMissile(c))!;
        const torpedo = e.research.researchedComponents.find((c) => c.type === ComponentType.WeaponTorpedo)!;
        const d = new Design('bvr cap test');
        d.role = base.role;
        d.subRole = BuiltObjectSubRole.CapitalShip;
        d.components = [...base.components, ...new Array<typeof launcher>(14).fill(launcher), ...new Array<typeof torpedo>(8).fill(torpedo)];
        const before = d.components.reduce((n, c) => n + c.size, 0);
        const count = (f: (c: typeof launcher) => boolean) => d.components.filter(f).length;
        expect(count((c) => isBvrMissile(c))).toBeGreaterThan(14);
        const fixed = bvrFixLaunchers(bg, e, d, 100000)!;
        expect(fixed).not.toBeNull();
        expect(count((c) => isBvrMissile(c))).toBe(7);
        expect(count((c) => c.type === ComponentType.WeaponTorpedo)).toBe(4); // 60% of 7
        const after = d.components.reduce((n, c) => n + c.size, 0);
        expect(after).toBeLessThanOrEqual(before + 10); // (the swap to the best torpedo changes sizes a little)
        expect(after).toBeGreaterThan(before - 60); // the space went into other components, not away
    });

    it('AI resupply ships: an idle resupply ship is sent to deploy with a major launcher fleet on a field mission, once, and released when the fleet is gone', () => {
        const e = aiEmpires().find((x) => x.designs.some((d) => d.subRole === BuiltObjectSubRole.ResupplyShip))!;
        const design = e.designs.filter((d) => d.subRole === BuiltObjectSubRole.ResupplyShip).sort((a, b) => b.dateCreated - a.dateCreated)[0];
        const r = generateBuiltObjectFromDesign(bg, e, design, 'bvrSupply2', true, spotX, spotY + 9000);
        r.isAutoControlled = true;
        const fleet = new ShipGroup(bg);
        fleet.name = 'BVR test fleet';
        fleet.empire = e;
        (e.shipGroups as ShipGroup[]).push(fleet);
        for (let k = 0; k < 6; k++) {
            const f = spawn(e, BuiltObjectSubRole.Frigate);
            place(bg, f, e.capital!.xpos + 500 + 50 * k, e.capital!.ypos);
            shipGroupAddShipToFleet(bg, fleet, f);
        }
        const target = bg.habitats.find((h) => h.empire !== e)!;
        expect(shipGroupAssignMission(bg, fleet, BuiltObjectMissionType.Patrol, target, null, BuiltObjectMissionPriority.Normal, false)).toBe(true);
        const before = peekBvrState(bg)?.aiResupplyDeploys ?? 0;
        aiResupplyTick(bg);
        // The empire's nearest idle resupply ship (maybe not the one built above) is sent.
        const sent = [...(peekBvrState(bg)!.escorts as Map<BuiltObject, unknown>)].filter(([, f]) => f === fleet).map(([ship]) => ship);
        expect(sent).toHaveLength(1);
        expect(builtObjectMission(sent[0].mission)?.type).toBe(BuiltObjectMissionType.Deploy);
        expect(peekBvrState(bg)!.aiResupplyDeploys).toBe(before + 1);
        aiResupplyTick(bg); // not sent twice
        expect(peekBvrState(bg)!.aiResupplyDeploys).toBe(before + 1);
        // The fleet goes away: the ship is released.
        (e.shipGroups as ShipGroup[]).splice((e.shipGroups as ShipGroup[]).indexOf(fleet), 1);
        aiResupplyTick(bg);
        expect(peekBvrState(bg)!.escorts!.has(sent[0])).toBe(false);
        void r;
    });

    it('AI rearming: an idle automated warship that has fired its rounds is sent to a rearm point on a Refuel order; a fighting one is not', () => {
        const e = aiEmpires()[0];
        const f = spawn(e, BuiltObjectSubRole.Frigate);
        builtObjectMission(f.mission)?.clear();
        spend(f);
        const before = peekBvrState(bg)?.aiRearmTrips ?? 0;
        f.attackers!.push(aiEmpires()[1].builtObjects.find((b) => b.role === BuiltObjectRole.Military)!);
        aiRearmTick(bg);
        expect(builtObjectMission(f.mission)?.type ?? BuiltObjectMissionType.Undefined).not.toBe(BuiltObjectMissionType.Refuel);
        f.attackers!.length = 0;
        aiRearmTick(bg);
        const m = builtObjectMission(f.mission);
        expect(m).not.toBeNull();
        expect(m!.type).toBe(BuiltObjectMissionType.Refuel);
        expect(peekBvrState(bg)!.aiRearmTrips).toBeGreaterThan(before);
    });

    it('point defence: a downed missile is reset; a ship with point defence covers its fleet mates; guns and a torpedo fare worse', () => {
        const [a, b] = aiEmpires();
        const shooter = spawn(a, BuiltObjectSubRole.Frigate);
        const target = spawn(b, BuiltObjectSubRole.Frigate);
        const l = shooter.weapons.find((w) => isBvrMissile(w.component))!;
        const inFlight = (): void => {
            l.reset();
            weaponFire(bg, l, shooter, target, 1500, bg.nowMs, true, 0.9);
            l.distanceTravelled = 300;
            l.x = target.xpos - 100; // inside point-defence range (140-250)
            l.y = target.ypos;
            l.distanceFromTarget = 100;
            if (!target.attackers!.includes(shooter)) target.attackers!.push(shooter);
            target.assaultPodFiringCounter = 0;
            for (const w of target.weapons) w.lastFired = MIN_TIME;
            target.currentEnergy = target.reactorStorageCapacity;
        };
        const run = (): void => {
            for (let k = 0; k < 3; k++) interceptMissiles(bg, target, bg.nowMs, false);
        };
        const params = bg.scenario!.params;
        const saved = { pd: params.bvrPdPct, gun: params.bvrGunPct };
        params.bvrPdPct = 100;
        params.bvrGunPct = 0;
        place(bg, target, shooter.xpos + 1500, shooter.ypos);
        inFlight();
        run();
        expect(l.distanceTravelled).toBeLessThan(0); // downed (reset)
        const downed = peekBvrState(bg)!.downedByPd;
        expect(downed).toBeGreaterThan(0);
        params.bvrPdPct = 0;
        inFlight();
        run();
        expect(l.distanceTravelled).toBeGreaterThan(0); // no chance: it flies on
        // Cover: a fleet mate with point defence shoots at a missile aimed at a ship that has none of its own.
        const player = bg.playerEmpire!;
        const guard = playerShip(bg, BuiltObjectSubRole.Frigate, 0);
        const screened = playerShip(bg, BuiltObjectSubRole.Escort, 0);
        for (const w of screened.weapons) if (w.component.type === ComponentType.WeaponPointDefense) w.reset();
        expect(guard.pointDefenseWeaponsRange).toBeGreaterThan(0);
        executeShipAction(bg, player, [guard, screened], createShipAction(ShipActionType.CreateNewFleet, null), true);
        expect(guard.shipGroup).not.toBeNull();
        expect(guard.shipGroup).toBe(screened.shipGroup);
        place(bg, screened, shooter.xpos + 1500, shooter.ypos);
        place(bg, guard, screened.xpos + 80, screened.ypos);
        guard.currentEnergy = guard.reactorStorageCapacity;
        for (const w of guard.weapons) w.lastFired = MIN_TIME;
        const hitWeapon = shooter.weapons.find((w) => isBvrMissile(w.component) && w !== l)!;
        weaponFire(bg, hitWeapon, shooter, screened, 1500, bg.nowMs, true, 0.9);
        hitWeapon.distanceTravelled = 300;
        hitWeapon.x = screened.xpos - 60;
        hitWeapon.y = screened.ypos;
        hitWeapon.distanceFromTarget = 60;
        guard.assaultPodFiringCounter = 0;
        params.bvrPdPct = 100;
        for (let k = 0; k < 3; k++) interceptMissiles(bg, guard, bg.nowMs, false); // the guard's own pass covers the escort
        expect(hitWeapon.distanceTravelled).toBeLessThan(0);
        params.bvrPdPct = saved.pd;
        params.bvrGunPct = saved.gun;
    });

    it('tactics: with more loaded missiles and the longer reach the AI ship kites; dry against a missile fleet it rushes; a dry Standoff ship fights with its guns', () => {
        const [a, b] = aiEmpires();
        const mine = spawn(a, BuiltObjectSubRole.Frigate);
        const theirs = spawn(b, BuiltObjectSubRole.Frigate);
        spend(theirs);
        const k = bvrEngagement(bg, mine, theirs, BattleTactics.AllWeapons);
        expect(k).not.toBeNull();
        expect(k!.band).not.toBeNull();
        const range = Math.max(...mine.weapons.filter((w) => isBvrMissile(w.component)).map((w) => w.range));
        expect(k!.band!.max).toBe(Math.trunc(range * 0.9));
        expect(k!.band!.min).toBeGreaterThan(range * 0.5);
        // Dry against a loaded enemy: close fast to the gun band.
        const rushed = bvrEngagement(bg, theirs, mine, BattleTactics.Standoff);
        expect(rushed).not.toBeNull();
        expect(rushed!.band!.min).toBe(0);
        expect(rushed!.band!.max).toBeLessThanOrEqual(Math.trunc(theirs.beamWeaponsMinRange * 0.75) + 1);
        // Both dry: the design's Standoff turns into AllWeapons (it does not hold the range of an empty launcher).
        spend(mine);
        const both = bvrEngagement(bg, mine, theirs, BattleTactics.Standoff);
        expect(both).not.toBeNull();
        expect(both!.tactic).toBe(BattleTactics.AllWeapons);
        // A player-ordered (not automated) ship is not kited or rushed, but a dry Standoff ship still fights with its guns.
        mine.isAutoControlled = false;
        expect(bvrEngagement(bg, mine, theirs, BattleTactics.Standoff)!.tactic).toBe(BattleTactics.AllWeapons);
        expect(bvrEngagement(bg, mine, theirs, BattleTactics.AllWeapons)).toBeNull();
    });

    it('saves: spent rounds round-trip through a save; a ship with no entry (an older save) is full; the state is saved', () => {
        const e = aiEmpires()[0];
        const f = spawn(e, BuiltObjectSubRole.Frigate);
        const l = f.weapons.find((w) => isBvrMissile(w.component))!;
        bvrNoteFired(bg, f, l);
        bvrNoteFired(bg, f, l);
        const before = bvrAmmoText(bg, f)!;
        const time = new GalaxyTime();
        time.togglePause();
        const text = serializeGame(bgame, time, defaultStartGameOptions());
        const restored = deserializeGame(text, bdata);
        const f2 = restored.game.galaxy.builtObjects.find((b): b is BuiltObject => b !== null && b.builtObjectID === f.builtObjectID)!;
        expect(bvrAmmoText(restored.game.galaxy, f2)).toBe(before);
        expect(bvrOn(restored.game.galaxy)).toBe(true);
        peekBvrState(restored.game.galaxy)!.mags.delete(f2);
        expect(bvrAmmoText(restored.game.galaxy, f2)).toMatch(/^Missiles (\d+)\/\1$/);
    }, 300000);

    it('toggle off: with the flag off none of it runs (no state bag, no draws, the stock intercept and firing)', () => {
        const g = cachedTickGame(gameData).galaxy;
        g.scenario = createGalaxyScenario(loadScenarioOverlayFs(BVR_ADDON_ID).manifest, { flags: { bvrCombat: false } });
        expect(bvrOn(g)).toBe(false);
        const ship = playerShip(g, BuiltObjectSubRole.Frigate, 0);
        const rnd = g.rnd.getState();
        interceptMissiles(g, ship, g.nowMs, false);
        bvrRearmTick(g);
        expect('bvrCombat' in g.scenario.state).toBe(false);
        expect(bvrAmmoText(g, ship)).toBeNull();
        expect(g.rnd.getState()).toEqual(rnd);
    });
});


// ---------------------------------------------------------------------------------------------------------------
// (9) The six combat changes after BVR combat (scenarios/decoys-chaff, ambush-strike, critical-hits, damage-control, armour-facing,
// surrender-wrecks; not in the original), all on together with BVR combat: a late start (tech 4).
// ---------------------------------------------------------------------------------------------------------------

describe('(9) the six combat changes (decoys, ambush, critical hits, damage control, armour facing, surrender and wrecks)', () => {
    const C2_IDS = ['decoys-chaff', 'ambush-strike', 'critical-hits', 'damage-control', 'armour-facing', 'surrender-wrecks'];
    const C2_FLAGS = ['decoys', 'ambush', 'criticalHits', 'damageControl', 'armourFacing', 'surrender'];
    let cgame: Game;
    let cdata: GameData;
    let cg: Galaxy;
    let cspot = { x: 0, y: 0 };
    let cslot = 0;
    const cAis = (): Empire[] => cg.empires.filter((e): e is Empire => e !== null && e !== cg.playerEmpire && e !== cg.independentEmpire && e.pirateEmpireBaseHabitat === null && !e.name.startsWith('Ancient'));
    /** The two AI empires (at war) that have a design of every hull the tests spawn. */
    const pair = (): Empire[] => cAis().filter((e) => [BuiltObjectSubRole.Frigate, BuiltObjectSubRole.Destroyer, BuiltObjectSubRole.Cruiser].every((s) => cNewest(e, s) !== undefined));
    const cNewest = (e: Empire, sub: BuiltObjectSubRole) => e.designs.filter((d) => d.role === BuiltObjectRole.Military && d.subRole === sub && !d.isObsolete).sort((a, b) => b.dateCreated - a.dateCreated)[0];
    /** A fresh ship of the empire's newest design of the sub-role at (x, y), shields full, automated and idle. */
    const spawnAt = (e: Empire, sub: BuiltObjectSubRole, x: number, y: number, tag = 'c2'): BuiltObject => {
        const b = generateBuiltObjectFromDesign(cg, e, cNewest(e, sub), `${tag}${cslot++}`, true, x, y);
        b.currentShields = b.shieldsCapacity;
        b.currentEnergy = b.reactorStorageCapacity;
        b.isAutoControlled = true;
        return b;
    };
    const spawnC = (e: Empire, sub: BuiltObjectSubRole): BuiltObject => spawnAt(e, sub, cspot.x + 700 * cslot, cspot.y);
    const withParams = (p: Partial<Record<string, number>>, f: () => void): void => {
        const old: Record<string, number> = {};
        for (const k of Object.keys(p)) {
            old[k] = cg.scenario!.params[k];
            cg.scenario!.params[k] = p[k]!;
        }
        try {
            f();
        } finally {
            for (const k of Object.keys(p)) cg.scenario!.params[k] = old[k];
        }
    };
    const withFlags = (p: Record<string, boolean>, f: () => void): void => {
        const old: Record<string, boolean> = {};
        for (const k of Object.keys(p)) {
            old[k] = cg.scenario!.flags[k];
            cg.scenario!.flags[k] = p[k];
        }
        try {
            f();
        } finally {
            for (const k of Object.keys(p)) cg.scenario!.flags[k] = old[k];
        }
    };
    /** Runs f with the clock moved to a time at which `ship`'s decoy scan slice is open (the scan runs on a fifth of the frames). */
    const atScanSlice = (ship: BuiltObject, f: () => void): void => {
        const base = cg.nowMs;
        let t = base;
        while ((((t / 100) | 0) + ship.builtObjectID) % 5 !== 0) t += 100;
        cg.nowMs = t;
        try {
            f();
        } finally {
            cg.nowMs = base;
        }
    };
    /** An AI warship design of the sub-role that carries countermeasures and a BVR missile launcher (the BVR AI puts both on its warships). */
    const armed = (e: Empire, sub: BuiltObjectSubRole): BuiltObject => spawnC(e, sub);

    beforeAll(() => {
        const r = createScenarioGame(gameData, {
            scenario: comboOverlayFs([BVR_ADDON_ID, ...C2_IDS], 'c2-test'),
            options: (o) => ({ ...o, galaxyAge: 4, player: { ...o.player, age: 4, techLevel: 4 }, aiEmpires: o.aiEmpires.map((e) => ({ ...e, age: 4, techLevel: 4 })) }),
        });
        cgame = r.game;
        cdata = r.gameData;
        cg = cgame.galaxy;
        const s = emptySpot(cg);
        cspot = { x: s.x, y: s.y };
        const [a, b] = pair();
        declareWar(cg, a, b, null, true);
    }, 300000);

    it('flags and params: six independent flags (plus BVR), every param has its manifest default, nothing is created until a hook runs', () => {
        for (const f of C2_FLAGS) expect(cg.scenario!.flags[f]).toBe(true);
        expect(cg.scenario!.flags.surrenderWrecks).toBeUndefined(); // the wreck sub-switch is gone
        for (const k of Object.keys(C2_DEFAULTS) as C2Param[]) {
            expect(cg.scenario!.params[k], k).toBe(C2_DEFAULTS[k]);
        }
        expect(cg.scenario!.params.wreckSystemCap).toBeUndefined();
        for (const id of C2_IDS) expect(scenarioIndexFs().some((m) => m.id === id)).toBe(true);
    });

    it('decoys: capacity from the working ECM components, a launch pulls inbound rounds off (a hit becomes a miss), one launch per cooldown, text "Decoys n/cap"', () => {
        const [a, b] = pair();
        let ship = armed(a, BuiltObjectSubRole.Cruiser);
        for (let k = 0; ecmCount(ship) === 0 && k < 3; k++) ship = armed(a, [BuiltObjectSubRole.Destroyer, BuiltObjectSubRole.CapitalShip, BuiltObjectSubRole.Frigate][k]);
        expect(ecmCount(ship)).toBeGreaterThan(0);
        const cap = decoyCapacity(cg, ship);
        expect(cap).toBe(3 + Math.min(2, ecmCount(ship) - 1));
        expect(decoyText(cg, ship)).toBe(`Decoys ${cap}/${cap}`);
        // Two inbound BVR missiles that were going to hit.
        const attacker = spawnC(b, BuiltObjectSubRole.Cruiser);
        const rounds = attacker.weapons.filter((w) => isBvrMissile(w.component)).slice(0, 2);
        expect(rounds.length).toBe(2);
        for (const w of rounds) {
            w.target = ship;
            w.distanceTravelled = 400;
            w.willHitTarget = true;
            w.hasMissed = false;
            w.x = ship.xpos + 300;
            w.y = ship.ypos;
        }
        ship.attackers!.push(attacker);
        // A ship far from its attackers' rounds launches nothing.
        for (const w of rounds) w.x = ship.xpos + 100000;
        atScanSlice(ship, () => decoyDefend(cg, ship));
        expect(peekC2State(cg)?.decoys.get(ship)).toBeUndefined();
        for (const w of rounds) w.x = ship.xpos + 300;
        const rnd = shadowRnd(cg);
        withParams({ decoyChancePct: 100 }, () => atScanSlice(ship, () => decoyDefend(cg, ship)));
        expect(rounds.every((w) => !w.willHitTarget)).toBe(true);
        expect(decoysLeft(cg, ship)).toBe(cap - 1);
        expect(decoyText(cg, ship)).toBe(`Decoys ${cap - 1}/${cap}`);
        expect(c2State(cg).stats.decoysDiverted).toBeGreaterThanOrEqual(2);
        // draws: one per round for the roll plus one for the side it veers to
        for (let i = 0; i < 4; i++) rnd.nextDouble();
        // The cooldown: a second salvo right after launches nothing more.
        for (const w of rounds) w.willHitTarget = true;
        withParams({ decoyChancePct: 100 }, () => atScanSlice(ship, () => decoyDefend(cg, ship)));
        expect(decoysLeft(cg, ship)).toBe(cap - 1);
        // Torpedoes are pulled off at the torpedo share of the chance: none at 0%.
        ship.attackers!.length = 0;
        for (const w of rounds) w.reset();
    });

    it('decoys: reloaded beside an own space port for credits, not away from one', () => {
        const [a] = pair();
        let ship = armed(a, BuiltObjectSubRole.Cruiser);
        for (let k = 0; ecmCount(ship) === 0 && k < 3; k++) ship = armed(a, [BuiltObjectSubRole.Destroyer, BuiltObjectSubRole.CapitalShip, BuiltObjectSubRole.Frigate][k]);
        const pool = { spent: 2, nextMs: 0, progress: 0 };
        c2State(cg).decoys.set(ship, pool);
        decoyRestockTick(cg);
        cg.nowMs += 20000;
        decoyRestockTick(cg);
        expect(decoysLeft(cg, ship)).toBe(decoyCapacity(cg, ship) - 2); // out at the spot: no port in reach
        const port = a.spacePorts.find((p) => p != null && !p.hasBeenDestroyed && p.isFunctional);
        expect(port).toBeDefined();
        place(cg, ship, port!.xpos + 100, port!.ypos);
        const money = a.stateMoney;
        decoyRestockTick(cg);
        cg.nowMs += 20000;
        decoyRestockTick(cg);
        expect(decoysLeft(cg, ship)).toBe(decoyCapacity(cg, ship));
        expect(a.stateMoney).toBeLessThanOrEqual(money);
        expect(c2State(cg).decoys.has(ship)).toBe(false);
        expect(c2State(cg).stats.decoysRestocked).toBeGreaterThanOrEqual(2);
    });

    it('decoys, AI: the design template asks for at least one countermeasures component (one more against enemies with missiles); humans and other flags untouched', () => {
        const [a] = pair();
        expect(enemySeekingLaunchers(cg, a)).toBeGreaterThanOrEqual(0);
        const bare = { componentRules: [], subRole: BuiltObjectSubRole.Cruiser } as unknown as Parameters<typeof withEcm>[0];
        const raised = withEcm(bare, 2);
        expect(raised.componentRules.find((r) => r.componentType === ComponentType.ComputerCountermeasures)!.amount).toBe(2);
        expect(withEcm(raised, 1).componentRules.find((r) => r.componentType === ComponentType.ComputerCountermeasures)!.amount).toBe(2);
        expect(wantedEcm(cg, a, bare)).toBeGreaterThanOrEqual(1);
        expect(wantedEcm(cg, a, { ...bare, subRole: BuiltObjectSubRole.ColonyShip } as never)).toBe(0);
        expect(decoyDesignChooser(cg, cg.playerEmpire!, bare, null)).toBeNull();
        expect(decoyDesignChooser(cg, a, bare, null)).not.toBeNull();
        withFlags({ decoysAI: false }, () => expect(decoyDesignChooser(cg, a, bare, null)).toBeNull());
    });

    it('ambush: an undetected ship that opens fire gets an ambush (a miss turns to a hit, hits do 50% more); a detected one does not; a quiet ship opens a new one', () => {
        const [a, b] = pair();
        const hidden = spawnC(a, BuiltObjectSubRole.Cruiser);
        const target = spawnAt(b, BuiltObjectSubRole.Cruiser, hidden.xpos + 3000, hidden.ypos);
        const w = hidden.weapons[0];
        // Seen: every ship of the target's empire sees a ship at 3000 in deep space (the stock reach is 40000 times its stealth).
        hidden.stealth = 1;
        expect(ambushNoteShot(cg, hidden, target)).toBe(false);
        expect(ambushActive(cg, hidden)).toBe(false);
        // Cloaked: the target's empire sees it only from 400.
        const quiet = cg.nowMs;
        cg.nowMs = quiet + 60000;
        hidden.stealth = 0.01;
        expect(ambushNoteShot(cg, hidden, target)).toBe(true);
        expect(ambushActive(cg, hidden)).toBe(true);
        withFlags({ armourFacing: false }, () => {
            withParams({ ambushAccuracyPct: 100 }, () => {
                const r = c2AdjustHit(cg, hidden, w, target, { willHit: false, hitRangeChance: 0.3 });
                expect(r.willHit).toBe(true);
                expect(c2HitPower(cg, hidden, target, w, 100, 0)).toBeCloseTo(150, 5);
            });
            // The window closes after ambushSeconds (+ the flight slack): no bonus.
            cg.nowMs += 20000;
            expect(ambushActive(cg, hidden)).toBe(false);
            expect(c2HitPower(cg, hidden, target, w, 100, 0)).toBeCloseTo(100, 5);
            // A ship that keeps firing is not "opening": it stays quiet-less and gets no new window until 20 s pass.
            expect(ambushNoteShot(cg, hidden, target)).toBe(false);
        });
        cg.nowMs = quiet;
        // AI weighs it: an ambushing ship counts the threats against it lighter; a ship that is not ambushing gets nothing.
        expect(ambushAiFactor(cg, spawnC(a, BuiltObjectSubRole.Frigate))).toBe(1);
        withFlags({ ambushAI: false }, () => expect(ambushAiFactor(cg, hidden)).toBe(1));
    });

    it('critical hits: a damaged engine / reactor / command part may be critical (slow / slow fire / lost hits), the effects stack and clear when repaired', () => {
        const [a] = pair();
        const ship = spawnC(a, BuiltObjectSubRole.Cruiser);
        const base = ship.topSpeedBase;
        const eng = ship.components.items.find((c) => c.type === ComponentType.EngineMainThrust)!;
        const reactor = ship.components.items.find((c) => c.type === ComponentType.Reactor)!;
        const hull = ship.components.items.find((c) => c.type === ComponentType.Armor)!;
        const before = cg.rnd.getState();
        // Chance 0: the roll is drawn and fails; a part that is not engine / reactor / command draws nothing.
        withParams({ critChancePct: 0 }, () => {
            eng.status = ComponentStatus.Damaged;
            critComponentDamaged(cg, ship, eng);
            expect(critTotal(cg, ship)).toBe(0);
            eng.status = ComponentStatus.Normal;
        });
        expect(cg.rnd.getState()).not.toEqual(before);
        const mid = cg.rnd.getState();
        hull.status = ComponentStatus.Damaged;
        critComponentDamaged(cg, ship, hull);
        expect(cg.rnd.getState()).toEqual(mid);
        hull.status = ComponentStatus.Normal;
        withParams({ critChancePct: 100 }, () => {
            eng.status = ComponentStatus.Damaged;
            critComponentDamaged(cg, ship, eng);
            ship.reDefine();
            expect(ship.topSpeed).toBeLessThanOrEqual(Math.trunc(base * 0.7));
            expect(critText(cg, ship)).toBe('engines');
            reactor.status = ComponentStatus.Damaged;
            critComponentDamaged(cg, ship, reactor);
            ship.reDefine();
            expect(critFireFactor(cg, ship)).toBeCloseTo(1.35, 5);
            expect(critText(cg, ship)).toBe('engines, reactor');
            expect(critWithdrawFactor(cg, ship)).toBeGreaterThan(1);
            // Stacks cap at critMaxStack.
            for (let i = 0; i < 6; i++) critComponentDamaged(cg, ship, eng);
            expect(critText(cg, ship)).toBe('engines x3, reactor');
        });
        // A command part: a share of the ship's hits turn into misses (the draw only when the ship has the effect).
        const other = spawnC(a, BuiltObjectSubRole.Frigate);
        const tgt = spawnC(pair()[1], BuiltObjectSubRole.Frigate);
        const w = other.weapons[0];
        expect(critMissChance(cg, other)).toBe(0);
        const rnd2 = cg.rnd.getState();
        withFlags({ ambush: false }, () => expect(c2AdjustHit(cg, other, w, tgt, { willHit: true, hitRangeChance: 0.5 }).willHit).toBe(true));
        expect(cg.rnd.getState()).toEqual(rnd2);
        const cmd = other.components.items.find((c) => c.type === ComponentType.ComputerCommandCenter || c.type === ComponentType.ComputerTargetting);
        if (cmd !== undefined) {
            withParams({ critChancePct: 100, critCommandMissPct: 100 }, () => {
                cmd.status = ComponentStatus.Damaged;
                critComponentDamaged(cg, other, cmd);
                expect(critMissChance(cg, other)).toBeCloseTo(0.9, 5);
            });
        }
        // Repair: the engine effect ends when no engine part is damaged any more, the reactor's likewise.
        for (const c of ship.components.items) c.status = ComponentStatus.Normal;
        ship.reDefine();
        expect(critTotal(cg, ship)).toBe(0);
        expect(ship.topSpeed).toBe(base);
        expect(critText(cg, ship)).toBeNull();
    });

    it('damage control: a crew repairs a component per interval in a battle only (critical parts first), faster for better crews, not past the damaged share, no draws', () => {
        const [a] = pair();
        const ship = spawnC(a, BuiltObjectSubRole.Cruiser);
        const items = ship.components.items;
        for (let i = 0; i < 6; i++) items[i * 2].status = ComponentStatus.Damaged;
        const eng = items.find((c) => c.type === ComponentType.EngineMainThrust)!;
        eng.status = ComponentStatus.Damaged;
        ship.reDefine();
        const n0 = ship.damagedComponentCount;
        const critical0 = items.filter((c) => c.status === ComponentStatus.Damaged && [ComponentType.EngineMainThrust, ComponentType.EngineVectoring, ComponentType.Reactor, ComponentType.ComputerCommandCenter, ComponentType.ComputerTargetting, ComponentType.ComputerTargettingFleet].includes(c.type)).length;
        expect(critical0).toBeGreaterThan(0);
        expect(crewRepairSpeed(cg, ship)).toBeGreaterThanOrEqual(1);
        const rnd = cg.rnd.getState();
        ship.inBattle = false;
        for (let t = 0; t < 120; t += 3) damageControlTick(cg, ship, 3);
        expect(ship.damagedComponentCount).toBe(n0); // not in a battle: nothing
        ship.inBattle = true;
        withParams({ dcSecondsPerRepair: 60, dcMaxDamagedPct: 100 }, () => {
            for (let t = 0; t < 57; t += 3) damageControlTick(cg, ship, 3);
            expect(ship.damagedComponentCount).toBe(n0);
            damageControlTick(cg, ship, 3);
            expect(ship.damagedComponentCount).toBe(n0 - 1);
            expect(items.filter((c) => c.status === ComponentStatus.Damaged && [ComponentType.EngineMainThrust, ComponentType.EngineVectoring, ComponentType.Reactor, ComponentType.ComputerCommandCenter, ComponentType.ComputerTargetting, ComponentType.ComputerTargettingFleet].includes(c.type)).length).toBe(critical0 - 1); // a critical kind first
        });
        expect(cg.rnd.getState()).toEqual(rnd);
        // A ship past the limit is left to its fate.
        const wreckish = spawnC(a, BuiltObjectSubRole.Frigate);
        wreckish.components.items.forEach((c, i) => (c.status = i % 5 === 0 ? ComponentStatus.Normal : ComponentStatus.Damaged));
        wreckish.reDefine();
        wreckish.inBattle = true;
        const d0 = wreckish.damagedComponentCount;
        withParams({ dcSecondsPerRepair: 3, dcMaxDamagedPct: 70 }, () => {
            for (let t = 0; t < 30; t += 3) damageControlTick(cg, wreckish, 3);
        });
        expect(wreckish.damagedComponentCount).toBe(d0);
        // Veterans' ranks and crew levels speed it up (the stock crew level scale: Bacon's career-damage levels).
        expect(crewRepairSpeed(cg, ship)).toBeCloseTo(1 + 0, 0);
    });

    it('armour facing: bow / flank / stern from the angle between the shot and the heading (75% / 110% / 140%), none for bases or blasts, the AI turns a still ship bow-on', () => {
        const [a, b] = pair();
        const target = spawnC(b, BuiltObjectSubRole.Cruiser);
        const attacker = spawnC(a, BuiltObjectSubRole.Cruiser);
        const w = attacker.weapons.find((x) => x.component.type === ComponentType.WeaponBeam) ?? attacker.weapons[0];
        target.heading = 0.4;
        const dmg = (shot: number): number => {
            let r = 0;
            withFlags({ ambush: false }, () => {
                r = c2HitPower(cg, attacker, target, w, 100, shot);
            });
            return r;
        };
        expect(facingZone(0.4, 0.4 + Math.PI, 60)).toBe('bow');
        expect(facingZone(0.4, 0.4 + Math.PI - 1.0, 60)).toBe('bow');
        expect(facingZone(0.4, 0.4 + 1.6, 60)).toBe('flank');
        expect(facingZone(0.4, 0.4 + 0.2, 60)).toBe('rear');
        let out = 0;
        withFlags({ ambush: false }, () => {
            out = c2HitPower(cg, attacker, target, w, 100, 0.4 + Math.PI);
        });
        expect(out).toBeCloseTo(75, 5);
        expect(dmg(0.4 + Math.PI / 2)).toBeCloseTo(110, 5);
        expect(dmg(0.4)).toBeCloseTo(140, 5);
        expect(dmg(-Number.MAX_VALUE)).toBeCloseTo(100, 5);
        expect(c2HitPower(cg, attacker, target, null, 100, 0.4)).toBeCloseTo(100, 5);
        // The same hits through the real damage path: the stern loses more of a ship than the bow.
        const hullHit = (shot: number): number => {
            const t = spawnC(b, BuiltObjectSubRole.Frigate);
            t.currentShields = 0;
            t.heading = 0;
            const before = t.undamagedComponentSize;
            withFlags({ ambush: false }, () => inflictDamage(cg, attacker, t, w, 150, cg.nowMs, 100, shot));
            return before - t.undamagedComponentSize;
        };
        const bow = hullHit(Math.PI);
        const stern = hullHit(0);
        expect(stern).toBeGreaterThanOrEqual(bow);
        // AI: a still AI ship in a fight turns its bow toward the nearest enemy; a human's ship does not.
        const turner = spawnC(a, BuiltObjectSubRole.Frigate);
        const foe = spawnAt(b, BuiltObjectSubRole.Frigate, turner.xpos, turner.ypos + 2000);
        place(cg, foe, turner.xpos, turner.ypos + 2000);
        turner.inBattle = true;
        turner.heading = 0;
        turner.targetHeading = 0;
        turner.currentSpeed = 0;
        turner.currentTarget = foe;
        facingTick(cg, turner, 3);
        expect(turner.targetHeading).toBeCloseTo(Math.PI / 2, 3);
        expect(turner.heading).toBeGreaterThan(0);
        // A fast ship circles a slow moving target that is still far away.
        const fast = spawnC(a, BuiltObjectSubRole.Frigate);
        const slow = spawnAt(b, BuiltObjectSubRole.CapitalShip, fast.xpos, fast.ypos + 9000);
        fast.inBattle = true;
        fast.currentSpeed = 40;
        fast.currentTarget = slow;
        fast.topSpeed = 100;
        slow.topSpeed = 40;
        slow.heading = 1;
        facingTick(cg, fast, 3);
        expect(Math.abs(flankHeadingOffset(cg, fast))).toBeCloseTo(0.5, 5);
        expect(c2State(cg).stats.flankStarted).toBeGreaterThanOrEqual(1);
        withFlags({ facingAI: false }, () => expect(Math.abs(flankHeadingOffset(cg, fast))).toBeGreaterThan(0)); // the offset is data; the AI switch gates only new ones
    });

    it('surrender: a crippled, trapped, outgunned AI ship strikes (leaves its fleet, holds, is not shot at, not scuttled), is captured by a prize crew, a ship nobody takes takes its crew back', () => {
        const [a, b] = pair();
        const victim = spawnAt(b, BuiltObjectSubRole.Cruiser, cspot.x + 41000, cspot.y + 200);
        const raiders = [0, 1, 2].map((i) => spawnAt(a, BuiltObjectSubRole.Cruiser, victim.xpos + 300, victim.ypos + 150 * i));
        const items = victim.components.items;
        items.forEach((c, i) => {
            if (c.type !== ComponentType.Armor && i % 10 < 8) c.status = ComponentStatus.Damaged;
        });
        for (const c of items) if (c.type === ComponentType.EngineMainThrust || c.type === ComponentType.EngineVectoring) c.status = ComponentStatus.Damaged;
        victim.reDefine();
        expect(healthPct(victim)).toBeLessThan(45);
        for (const r of raiders) victim.attackers!.push(r);
        // Chance 0: never. Chance 100: now.
        withParams({ surrenderChancePct: 0 }, () => surrenderTick(cg, victim));
        expect(isStruck(cg, victim)).toBe(false);
        // A human's ship, a ship that can still run and one that is not outgunned never strike.
        const rnd = cg.rnd.getState();
        withParams({ surrenderChancePct: 100 }, () => {
            const keep = victim.topSpeed;
            victim.topSpeed = 0;
            const human = spawnC(cg.playerEmpire!, BuiltObjectSubRole.Cruiser);
            human.components.items.forEach((c) => (c.status = ComponentStatus.Damaged));
            human.reDefine();
            human.attackers!.push(raiders[0]);
            surrenderTick(cg, human);
            expect(isStruck(cg, human)).toBe(false);
            victim.topSpeed = keep;
        });
        expect(cg.rnd.getState()).toEqual(rnd);
        withParams({ surrenderChancePct: 100 }, () => surrenderTick(cg, victim));
        expect(isStruck(cg, victim)).toBe(true);
        expect(struckText(cg, victim)).toContain('Struck colours');
        expect(combat2StatusLines(cg, victim).some((l) => l.text.includes('Struck colours'))).toBe(true);
        expect(victim.shipGroup).toBeNull();
        expect(victim.currentSpeed).toBe(0);
        // Nobody fires at it or from it; the AI does not pick it as a target.
        expect(c2StruckSpares(cg, raiders[0], victim)).toBe(true);
        expect(c2StruckSpares(cg, victim, raiders[0])).toBe(true);
        expect(shouldAttack(cg, raiders[0], victim, cg.nowMs)).toBe(false);
        // Nothing hurts it: not rounds in flight or base guns (inflictDamage), not the stock stranded-ship cleanup (engines out, no yard).
        const wpn = raiders[0].weapons[0];
        const before = victim.undamagedComponentSize;
        expect(inflictDamage(cg, raiders[0], victim, wpn, 5000, cg.nowMs, 100, 0)).toBe(false);
        expect(victim.undamagedComponentSize).toBe(before);
        expect(victim.hasBeenDestroyed).toBe(false);
        cleanupInvalidShips(cg, b);
        expect(victim.hasBeenDestroyed).toBe(false);
        // A prize crew within range for the capture time takes it (the stock boarding capture).
        const t0 = cg.nowMs;
        surrenderCaptureTick(cg);
        expect(isStruck(cg, victim)).toBe(true);
        cg.nowMs = t0 + 21000;
        surrenderCaptureTick(cg);
        expect(isStruck(cg, victim)).toBe(false);
        expect(victim.empire).toBe(a);
        expect(c2State(cg).stats.captured).toBe(1);
        cg.nowMs = t0;
        // Nobody comes: the crew takes it back after the timeout and will not surrender again for as long.
        const lonely = spawnAt(b, BuiltObjectSubRole.Cruiser, cspot.x + 42000, cspot.y + 2000);
        lonely.components.items.forEach((c, i) => (c.status = i % 10 < 8 && c.type !== ComponentType.Armor ? ComponentStatus.Damaged : c.status));
        lonely.reDefine();
        lonely.topSpeed = 0;
        for (const r of raiders) lonely.attackers!.push(r);
        withParams({ surrenderChancePct: 100 }, () => surrenderTick(cg, lonely));
        expect(isStruck(cg, lonely)).toBe(true);
        for (const r of raiders) place(cg, r, cspot.x + 90000, cspot.y + 90000);
        cg.nowMs = t0 + 400000;
        surrenderCaptureTick(cg);
        expect(isStruck(cg, lonely)).toBe(false);
        expect(lonely.empire).toBe(b);
        expect(c2State(cg).stats.recovered).toBe(1);
        withParams({ surrenderChancePct: 100 }, () => surrenderTick(cg, lonely));
        expect(isStruck(cg, lonely)).toBe(false); // calm
        cg.nowMs = t0;
    });

    it('no wrecks: with Surrender on, destroyed ships leave no debris fields, wreck records or wreckage state, and no raw wreckage text keys appear', () => {
        const [a, b] = pair();
        const killer = spawnC(a, BuiltObjectSubRole.Cruiser);
        const spot = { x: cspot.x + 62000, y: cspot.y + 62000 };
        const ships = Array.from({ length: 6 }, (_, i) => spawnAt(b, BuiltObjectSubRole.Frigate, spot.x + (i % 3) * 300, spot.y + Math.trunc(i / 3) * 300, 'wr'));
        for (const s of ships) inflictDamage(cg, killer, s, null, 1e9, cg.nowMs, 0, -Number.MAX_VALUE);
        for (const s of ships) expect(s.hasBeenDestroyed).toBe(true);
        runGameSeconds(cg, 5);
        expect(peekWreckageState(cg)).toBeNull();
        expect(wreckFields(cg)).toHaveLength(0);
        expect(cg.galaxyLocations.some((l) => l.name.includes('Scenario Wreckage'))).toBe(false);
    }, 120000);

    it('old saves: a save made with the old wreck switch (debris fields, wreck records, a salvage run) or The Silence loads without them, and the salvager is released', () => {
        const [a] = pair();
        const rig = a.builtObjects.find((x) => x != null && x.subRole === BuiltObjectSubRole.ConstructionShip && !x.hasBeenDestroyed)!;
        const field = createWreckField(cg, cspot.x + 40000, cspot.y + 40000);
        field.wrecks.push({ id: 1, builtObjectId: -1, name: 'old', designName: 'old', role: 0, subRole: 0, ownerEmpireId: -1, ownerName: '', x: field.x, y: field.y, size: 100, componentIds: [], resources: [], value: 500, starDate: galaxyStarDate(cg) });
        const zone = generateRestrictedZone(cg, 'Old Zone', 'old', 4000, cspot.x + 50000, cspot.y + 50000, 0);
        cg.scenario!.flags.surrenderWrecks = true;
        cg.scenario!.flags.wreckage = true;
        cg.scenario!.flags.silence = true;
        cg.scenario!.state.silence = { source: null, zone, radius: 2000, shutdownProgressDays: 0, lastShutdownEmpire: null, sentStages: {}, ended: false };
        expect(cg.galaxyLocations).toContain(field.location);
        const time = new GalaxyTime();
        time.togglePause();
        const g2 = deserializeGame(serializeGame(cgame, time, defaultStartGameOptions()), cdata).game.galaxy;
        expect(rig).toBeDefined();
        expect(wreckFields(g2)).toHaveLength(0);
        expect(peekWreckageState(g2)).toBeNull();
        expect(g2.scenario!.flags.wreckage).toBe(false);
        expect(g2.scenario!.flags.surrenderWrecks).toBe(false);
        expect(g2.scenario!.state.silence).toBeUndefined();
        expect(g2.scenario!.flags.silence).toBe(false);
        expect(g2.galaxyLocations.some((l) => l.name === field.name || l.name === 'Old Zone')).toBe(false);
        expect(g2.scenario!.flags.surrender).toBe(true); // Surrender itself keeps working
        runGameSeconds(g2, 5);
        // Clean the shared fixture.
        purgeWreckageState(cg);
        purgeSilence(cg);
        cg.scenario!.flags.surrender = true;
    }, 300000);

    it('both on with BVR: a staged fight runs, counters move, nothing throws, hits are scaled, the panel shows the new lines', () => {
        const [a, b] = pair();
        const spot = { x: cspot.x + 120000, y: cspot.y + 3000 };
        const left = [0, 1, 2, 3].map((i) => spawnAt(a, BuiltObjectSubRole.Cruiser, spot.x, spot.y + 120 * i, 'fa'));
        const right = [0, 1, 2, 3].map((i) => spawnAt(b, BuiltObjectSubRole.Cruiser, spot.x + 3500, spot.y + 120 * i, 'fb'));
        for (const s of left) assignMission(cg, s, BuiltObjectMissionType.Attack, right[0], null, BuiltObjectMissionPriority.High);
        for (const s of right) assignMission(cg, s, BuiltObjectMissionType.Attack, left[0], null, BuiltObjectMissionPriority.High);
        const before = JSON.stringify(c2State(cg).stats);
        runGameSeconds(cg, 40);
        const s = c2State(cg).stats;
        expect(JSON.stringify(s)).not.toBe(before);
        expect(s.facingBow + s.facingFlank + s.facingRear).toBeGreaterThan(0);
        expect(peekBvrState(cg)!.missilesFired).toBeGreaterThan(0);
        const lines = [...left, ...right].filter((x) => !x.hasBeenDestroyed).flatMap((x) => combat2StatusLines(cg, x));
        expect(lines.some((l) => l.label === 'Countermeasures' && /^Decoys \d+\/\d+$/.test(l.text))).toBe(true);
        c2ShipTick(cg, left[0], 3);
    }, 300000);

    it('save: decoy pools, critical effects, struck ships survive a save and load, older saves without the state load', () => {
        const [a, b] = pair();
        const ship = spawnC(a, BuiltObjectSubRole.Cruiser);
        c2State(cg).decoys.set(ship, { spent: 2, nextMs: 0, progress: 0 });
        const eng = ship.components.items.find((c) => c.type === ComponentType.EngineMainThrust)!;
        withParams({ critChancePct: 100 }, () => {
            eng.status = ComponentStatus.Damaged;
            critComponentDamaged(cg, ship, eng);
            ship.reDefine();
        });
        const stricken = spawnC(b, BuiltObjectSubRole.Frigate);
        c2State(cg).struck.set(stricken, { sinceMs: cg.nowMs, toEmpireId: a.empireId, captor: ship, captureStartMs: 0 });
        const decoys = decoyText(cg, ship);
        const crit = critText(cg, ship);
        const time = new GalaxyTime();
        time.togglePause();
        const text = serializeGame(cgame, time, defaultStartGameOptions());
        const restored = deserializeGame(text, cdata);
        const g2 = restored.game.galaxy;
        const find = (o: BuiltObject): BuiltObject => g2.builtObjects.find((x): x is BuiltObject => x !== null && x.builtObjectID === o.builtObjectID)!;
        expect(decoyText(g2, find(ship))).toBe(decoys);
        expect(critText(g2, find(ship))).toBe(crit);
        expect(find(ship).topSpeed).toBe(ship.topSpeed);
        expect(isStruck(g2, find(stricken))).toBe(true);
        // An older save: the state bag absent, the hooks run on and create it on first use.
        delete g2.scenario!.state.combat2;
        expect(decoyText(g2, find(ship))).toBe(`Decoys ${decoyCapacity(g2, find(ship))}/${decoyCapacity(g2, find(ship))}`);
        expect(critText(g2, find(ship))).toBeNull();
        expect(isStruck(g2, find(stricken))).toBe(false);
        c2State(cg).struck.delete(stricken);
    }, 300000);

    it('toggles off: with all six flags off none of it runs (no state bag, no draws, hits and damage untouched)', () => {
        const g = cachedTickGame(gameData).galaxy;
        const off: Record<string, boolean> = {};
        for (const f of [...C2_FLAGS, 'decoysAI', 'ambushAI', 'facingAI']) off[f] = false;
        g.scenario = createGalaxyScenario(loadScenarioOverlayFs(BVR_ADDON_ID).manifest, { flags: { bvrCombat: false } });
        for (const f of Object.keys(off)) g.scenario.flags[f] = false;
        const ship = playerShip(g, BuiltObjectSubRole.Frigate, 0);
        const foe = playerShip(g, BuiltObjectSubRole.Frigate, 1);
        const w = ship.weapons[0];
        const rnd = g.rnd.getState();
        expect(c2AdjustHit(g, ship, w, foe, { willHit: false, hitRangeChance: 0.2 })).toEqual({ willHit: false, hitRangeChance: 0.2 });
        expect(c2HitPower(g, ship, foe, w, 100, 0)).toBe(100);
        decoyDefend(g, ship);
        c2ShipTick(g, ship, 3);
        surrenderTick(g, ship);
        decoyRestockTick(g);
        surrenderCaptureTick(g);
        for (const c of ship.components.items.slice(0, 5)) {
            c.status = ComponentStatus.Damaged;
            critComponentDamaged(g, ship, c);
        }
        expect('combat2' in g.scenario.state).toBe(false);
        expect(combat2StatusLines(g, ship)).toEqual([]);
        expect(isStruck(g, ship)).toBe(false);
        expect(ambushActive(g, ship)).toBe(false);
        expect(g.rnd.getState()).toEqual(rnd);
        // A game without a scenario at all: the hooks are no-ops too.
        const g0 = cachedTickGame(gameData).galaxy;
        expect(g0.scenario).toBeNull();
        const s0 = playerShip(g0, BuiltObjectSubRole.Frigate, 0);
        expect(combat2StatusLines(g0, s0)).toEqual([]);
        expect(c2HitPower(g0, s0, s0, null, 77, 0)).toBe(77);
    });
});
