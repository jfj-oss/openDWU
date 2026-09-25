// M4o — weapons fire, shields, point defence, defensive fire, diplomacy from attacks.
//
// Ports (statement for statement, same Galaxy.Rnd draw order):
//   Weapon.cs 183 IsAvailable, 185 / 219 Fire, 253 FireInternal; WeaponList.cs 16 GetAllPlanetDestroyerWeapons,
//   27 CalculateRawDamageOfWeaponsAboveRange; BaconBuiltObject.cs 3049 WeaponRangeIncrementForDamageLoss, 3057
//   WeaponDamageDropoff, 5032 InterceptMissiles; BuiltObject.1.cs 1815 CheckForPlanetDestroyerWeaponFiringDelayOnHyperExit,
//   2225 RechargeShields, 3579 HandlePlanetDestroyerFiring, 3651 / 3661 DetermineTractorBeamShouldPull*, 3706
//   CheckFireAreaWeaponAtTarget, 3737 HandleWeaponsFiring, 4652 / 4657 / 4721 ModifyDiplomacyFromAttack, 4852
//   FirePlanetDestroyerAtHabitat, 4899 BombardTarget, 4954 CheckConventionalWeaponsAvailableToFireAtPassingThreats,
//   4988 / 4993 FireWeaponTypeAtTarget, 5007 FireWeaponSetAtTarget, 5084 / 5089 FireWeaponsAtTarget, 5202 / 5243
//   DetermineHitTarget; BuiltObject.cs 1930 CheckShieldAreaRechargeReset, 1947 CheckNearbyBuiltObjectsForShieldAreaRecharge,
//   4448 DefendShipFromAttackers, 4557 DefendBase; Habitat.cs 2225 CheckIonCannonReadyToFire, 2235 CheckTargetInRange,
//   2267 HandleWeaponsFiring, 2416 FireWeaponsAtTarget, 2431 DetermineHitTarget, 2640 AttackEnemyTargets, 2707 ShouldAttack;
//   Empire.4.cs 1527 CancelPirateMission.
//
// Time: `time` (= _tempNow) is game ms; Weapon.lastFired is game ms (MIN_TIME = never fired, the C# DateTime.MinValue).

import type { Galaxy } from '../galaxy';
import type { BuiltObject } from '../builtObject';
import type { Habitat } from '../types';
import { CreatureType, type Creature } from '../creature';
import type { Empire } from '../empire';
import type { Weapon } from '../weapon';
import { ComponentStatus } from '../builtObjectComponent';
import { ComponentType } from '../data/components';
import { BuiltObjectSubRole } from '../builtObjectTypes';
import { BattleTactics, BuiltObjectRole } from '../data/designSpecifications';
import { GalaxyLocationType } from '../galaxyLocation';
import { BuiltObjectMissionType, builtObjectMission, isBuiltObject, isCreature, isHabitat, type StellarObject } from '../missions/mission';
import { clearPreviousMissionRequirements } from '../missions/assign';
import { MIN_TIME, galaxyStarDate } from '../tick/simTime';
import { captainBonuses } from '../characters';
import { DiplomaticRelationType, obtainDiplomaticRelation, obtainEmpireEvaluation } from '../diplomacy';
import { PirateRelationEvaluationType, PirateRelationType, changePirateEvaluation, changePirateRelation, obtainPirateRelation } from '../pirateRelations';
import { EmpireActivityType, type EmpireActivity } from '../pirates/empireActivity';
import { PirateIncomeType } from '../pirates/pirateEconomy';
import { completePirateMission } from '../pirates/missionsMarket';
import { applyCorruptionToIncome } from '../logistics/orders';
import { totalMobileMilitaryFirepower } from '../forceStructure';
import { getBuiltObjectsAtLocation } from '../stationPlacement';
import { determineGalaxyLocationsInRangeAtPoint } from '../visibility';
import { EmpireMessageType, sendMessageToEmpire } from '../messages';
import { attackersContainsFighterOrBuiltObject, calculateAvailableAssaultPodAttackStrength, checkOurEmpireBoarding, checkOurEmpireOverwhelmingBoarding, determineAngle, determineDestroyOrCaptureTarget, determineTacticsAgainstTarget, shouldAttack } from './attackAI';
import { shipGroupOf, stellarAttackers, stellarCurrentSpeed, stellarEmpire } from './threats';
import { checkLaunchAssaultPodsAtTarget } from './boarding';
import { fighterAbandonAttackTarget, fireWeaponsAtFighter, launchAllFighters } from './fighters';
import {
    SpaceBattleStats,
    battleStatsOf,
    calculateBuiltObjectLootingValue,
    destroyHabitat,
    empireColonyIncomeFactor,
    empireLootingFactor,
    fearfulPirateFactionJoinsPlayer,
    habitatInflictIonDamage,
    inflictBombardDamage,
    inflictDamage,
    inflictIonDamage,
    provideBonusFromPirateBase,
    type FighterLike,
} from './damage';

// ---------------------------------------------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------------------------------------------

/** Galaxy.3.cs 5036 TorpedoWeaponHitRange. */
export const TORPEDO_WEAPON_HIT_RANGE = 25.0;
/** RaceEventType.cs: PredictiveHistory (member 28; 0 = Undefined). */
const RACE_EVENT_TYPE_PREDICTIVE_HISTORY = 28;
/** BaconBuiltObject.cs 74 pointDefenseAffectsMissiles (BaconMain.cs 916 reads the settings file; default true). */
const POINT_DEFENSE_AFFECTS_MISSILES = true;

// ---------------------------------------------------------------------------------------------------------------
// Typed views
// ---------------------------------------------------------------------------------------------------------------

/** A Fighter as a weapon target (Fighter.cs; M4p's class, duck-typed). */
export interface FighterTargetLike extends FighterLike {
    currentSpeed: number; // float
    onboardCarrier: boolean;
    specification: { countermeasureModifier: number };
}
/** Weapon.Target (`unknown` in weapon.ts) as a StellarObject or Fighter. */
export function weaponTarget(weapon: Weapon): StellarObject | FighterTargetLike | null {
    return weapon.target as StellarObject | FighterTargetLike | null;
}
function isFighterTarget(o: unknown): o is FighterTargetLike {
    return typeof o === 'object' && o !== null && !isBuiltObject(o) && !isHabitat(o) && !isCreature(o);
}
/** StellarObject.Size (a plain field: BuiltObject / Creature set it, Habitat leaves 0). */
function stellarSize(o: StellarObject | FighterTargetLike): number {
    if (isBuiltObject(o)) return o.size;
    if (isCreature(o)) return o.size;
    if (isHabitat(o)) return 0;
    return o.size;
}
function stellarHasBeenDestroyed(o: StellarObject | FighterTargetLike): boolean {
    return o.hasBeenDestroyed;
}
function targetCurrentSpeed(o: StellarObject | FighterTargetLike): number {
    if (isFighterTarget(o)) return o.currentSpeed;
    return stellarCurrentSpeed(o);
}

// BuiltObject._Captain*Bonus properties (100 / 100 until ReviewCaptainBonuses runs; characters.ts).
function captainWeaponsDamageBonus(bo: BuiltObject): number {
    const b = captainBonuses(bo);
    return (b !== null ? b.weaponsDamage : 100) / 100.0;
}
function captainWeaponsRangeBonus(bo: BuiltObject): number {
    const b = captainBonuses(bo);
    return (b !== null ? b.weaponsRange : 100) / 100.0;
}
function captainTargetingBonus(bo: BuiltObject): number {
    const b = captainBonuses(bo);
    return (b !== null ? b.targeting : 100) / 100.0;
}
function captainCountermeasuresBonus(bo: BuiltObject): number {
    const b = captainBonuses(bo);
    return (b !== null ? b.countermeasures : 100) / 100.0;
}
function captainShieldRechargeRateBonus(bo: BuiltObject): number {
    const b = captainBonuses(bo);
    return (b !== null ? b.shieldRechargeRate : 100) / 100.0;
}
function captainShipEnergyUsageBonus(bo: BuiltObject): number {
    const b = captainBonuses(bo);
    return (b !== null ? b.shipEnergyUsage : 100) / 100.0;
}

/** Habitat.GiantIonCannon typed (`unknown` in types.ts). */
function giantIonCannonOf(h: Habitat): Weapon | null {
    return h.giantIonCannon as Weapon | null;
}

// ---------------------------------------------------------------------------------------------------------------
// Weapon.cs / WeaponList.cs / BaconBuiltObject.cs weapon helpers
// ---------------------------------------------------------------------------------------------------------------

/** Weapon.cs 183 IsAvailable(firer, time). */
export function weaponIsAvailable(weapon: Weapon, firer: BuiltObject, time: number): boolean {
    return weapon.distanceTravelled < 0.0 && firer.currentEnergy >= weapon.energyRequired && weapon.lastFired + weapon.fireRate <= time;
}

/** WeaponList.cs 16 GetAllPlanetDestroyerWeapons. */
export function getAllPlanetDestroyerWeapons(weapons: Weapon[]): Weapon[] {
    const destroyerWeapons: Weapon[] = [];
    for (let index = 0; index < weapons.length; ++index) {
        const weapon = weapons[index];
        if (weapon != null && weapon.isPlanetDestroyer) destroyerWeapons.push(weapon);
    }
    return destroyerWeapons;
}

/** WeaponList.cs 27 CalculateRawDamageOfWeaponsAboveRange(range). */
export function calculateRawDamageOfWeaponsAboveRange(weapons: Weapon[], range: number): number {
    let weaponsAboveRange = 0;
    for (let index = 0; index < weapons.length; ++index) {
        const weapon = weapons[index];
        if (weapon != null && weapon.range >= range) weaponsAboveRange += weapon.rawDamage;
    }
    return weaponsAboveRange;
}

function nameContainsRomulan(empire: Empire | null): boolean {
    return empire !== null && empire.name.includes('Romulan');
}
function baconIsMyShip(ship: BuiltObject | null): boolean {
    return (ship !== null && nameContainsRomulan(ship.empire)) || (ship !== null && nameContainsRomulan(ship.actualEmpire)) || (ship !== null && nameContainsRomulan(ship.owner));
}

/** BaconBuiltObject.cs 3049 WeaponRangeIncrementForDamageLoss(firingShip) (float; computed but unused by HandleWeaponsFiring). */
export function weaponRangeIncrementForDamageLoss(firingShip: BuiltObject): number {
    let num = 100;
    if (baconIsMyShip(firingShip)) num = 200;
    return num;
}

/** BaconBuiltObject.cs 3057 WeaponDamageDropoff(firingShip, weapon, rawDamage) (float). */
export function weaponDamageDropoff(firingShip: BuiltObject, weapon: Weapon, rawDamage: number): number {
    const t = weapon.component.type;
    if (t === ComponentType.WeaponMissile || t === ComponentType.WeaponBombard || t === ComponentType.WeaponSuperMissile || t === ComponentType.WeaponPointDefense) return rawDamage;
    let num = Math.fround(Math.fround(weapon.distanceTravelled / Math.fround(weapon.range)) * rawDamage);
    if (firingShip.empire!.name.includes('Romulan')) num = Math.fround(num * 0.5);
    return Math.min(Math.max(0, Math.fround(rawDamage - num)), rawDamage);
}

/**
 * Weapon.cs 253 FireInternal(galaxy, firer, targetX, targetY, target, distanceToTarget, time, willHit, hitRangeChance).
 * Rnd: NextDouble, Next(0, 2).
 */
function weaponFireInternal(galaxy: Galaxy, weapon: Weapon, firer: BuiltObject | Habitat, targetX: number, targetY: number, target: StellarObject | FighterTargetLike | Weapon, willHit: boolean, hitRangeChance: number): void {
    if (willHit) {
        weapon.heading = Math.fround(determineAngle(firer.xpos, firer.ypos, targetX, targetY));
        let num = galaxy.rnd.nextDouble() * 0.15;
        if (galaxy.rnd.next(0, 2) === 0) num *= -1.0;
        weapon.heading = Math.fround(weapon.heading + Math.fround(num));
    } else {
        let num = (0.5 - hitRangeChance) * galaxy.rnd.nextDouble() * 0.4;
        if (num < 0.03) num += 0.03;
        if (galaxy.rnd.next(0, 2) === 0) num *= -1.0;
        if (weapon.component !== null && (weapon.component.type === ComponentType.WeaponPhaser || weapon.component.type === ComponentType.WeaponSuperPhaser)) num /= 1.5;
        weapon.headingMissFactor = Math.fround(num);
        weapon.heading = Math.fround(Math.fround(num) + Math.fround(determineAngle(firer.xpos, firer.ypos, targetX, targetY)));
    }
    if (!isBuiltObject(firer)) return;
    const builtObject1 = firer;
    let energyRequired = weapon.energyRequired;
    const shipGroup = shipGroupOf(builtObject1);
    if (shipGroup !== null) energyRequired /= shipGroup.shipEnergyUsageBonus;
    const num1 = energyRequired / captainShipEnergyUsageBonus(builtObject1);
    builtObject1.currentEnergy -= num1;
    if (isBuiltObject(target)) {
        const attackers = target.attackers!;
        if (!attackers.includes(firer)) attackers.push(firer);
    } else if (isCreature(target)) {
        // TODO(port) M4u: Creature.Attackers (not modelled on the TS Creature; combat/threats.ts stellarAttackers sees an empty list).
    }
}

/** Weapon.cs 185 Fire(galaxy, firer, target, distanceToTarget, time, willHit, hitRangeChance). */
export function weaponFire(galaxy: Galaxy, weapon: Weapon, firer: BuiltObject | Habitat, target: StellarObject | FighterTargetLike, distanceToTarget: number, time: number, willHit: boolean, hitRangeChance: number): void {
    weapon.lastFired = time;
    let flag = false;
    if (weapon.component !== null) {
        switch (weapon.component.type) {
            case ComponentType.WeaponIonPulse:
            case ComponentType.WeaponAreaDestruction:
            case ComponentType.WeaponSuperArea:
                flag = true;
                break;
        }
    }
    weapon.distanceTravelled = !flag ? 1 : 0;
    weapon.x = firer.xpos;
    weapon.y = firer.ypos;
    weapon.hasMissed = false;
    weapon.soundEffectPlayed = false;
    weapon.resetNext = false;
    weapon.distanceFromTarget = Math.fround(distanceToTarget);
    weapon.target = target;
    weapon.willHitTarget = willHit;
    weaponFireInternal(galaxy, weapon, firer, target.xpos, target.ypos, target, willHit, hitRangeChance);
}

/** Weapon.cs 219 Fire(galaxy, firer, targetWeaponBlast, distanceToTarget, time, willHit, hitRangeChance). */
export function weaponFireAtWeapon(galaxy: Galaxy, weapon: Weapon, firer: BuiltObject | Habitat, targetWeaponBlast: Weapon, distanceToTarget: number, time: number, willHit: boolean, hitRangeChance: number): void {
    weapon.lastFired = time;
    let flag = false;
    if (weapon.component !== null) {
        switch (weapon.component.type) {
            case ComponentType.WeaponIonPulse:
            case ComponentType.WeaponAreaDestruction:
            case ComponentType.WeaponSuperArea:
                flag = true;
                break;
        }
    }
    weapon.distanceTravelled = !flag ? 1 : 0;
    weapon.x = firer.xpos;
    weapon.y = firer.ypos;
    weapon.hasMissed = false;
    weapon.soundEffectPlayed = false;
    weapon.resetNext = false;
    weapon.distanceFromTarget = Math.fround(distanceToTarget);
    weapon.targetWeapon = targetWeaponBlast;
    weapon.willHitTarget = willHit;
    weaponFireInternal(galaxy, weapon, firer, targetWeaponBlast.x, targetWeaponBlast.y, targetWeaponBlast, willHit, hitRangeChance);
}

// ---------------------------------------------------------------------------------------------------------------
// BuiltObject.1.cs 5202 / 5243 DetermineHitTarget
// ---------------------------------------------------------------------------------------------------------------

/** BuiltObject.1.cs 5202 DetermineHitTarget(galaxy, weapon, targetWeaponBlast, distanceToTarget, out hitRangeChance). Rnd: NextDouble, Next(0, 15). */
export function determineHitTargetWeapon(galaxy: Galaxy, self: BuiltObject, weapon: Weapon, targetWeaponBlast: Weapon, distanceToTarget: number): { willHit: boolean; hitRangeChance: number } {
    let num = weapon.range;
    const shipGroup = shipGroupOf(self);
    if (shipGroup !== null) num *= shipGroup.weaponsRangeBonus;
    num *= captainWeaponsRangeBonus(self);
    const num2 = num - distanceToTarget;
    const hitRangeChance = 0.15 + Math.max(0.0, num2 / num);
    let val = 10.0 / Math.max(1.0, targetWeaponBlast.speed);
    val = Math.max(0.7, Math.min(val, 5.0));
    val *= 2.0;
    const num3 = 0.0;
    let num4 = self.targettingModifier + self.fleetTargettingBonus;
    if (self.empire !== null && self.empire.raceEventType === RACE_EVENT_TYPE_PREDICTIVE_HISTORY) num4 += 20.0;
    const num5 = (num4 - num3) / 100.0;
    let num6 = val * (hitRangeChance + galaxy.rnd.nextDouble() + num5);
    if (shipGroup !== null) num6 *= shipGroup.targetingBonus;
    num6 *= captainTargetingBonus(self);
    if (num6 > 0.5 && galaxy.rnd.next(0, 15) === 7) num6 = 0.0;
    else if (num6 <= 0.5 && num2 > 0.0 && galaxy.rnd.next(0, 15) === 7) num6 = 1.0;
    return { willHit: num6 > 0.5, hitRangeChance };
}

/** BuiltObject.1.cs 5243 DetermineHitTarget(galaxy, weapon, target, distanceToTarget, out hitRangeChance). Rnd: NextDouble, Next(0, 12). */
export function determineHitTarget(galaxy: Galaxy, self: BuiltObject, weapon: Weapon, target: StellarObject | FighterTargetLike, distanceToTarget: number): { willHit: boolean; hitRangeChance: number } {
    let num = weapon.range;
    const selfGroup = shipGroupOf(self);
    if (selfGroup !== null) num *= selfGroup.weaponsRangeBonus;
    num *= captainWeaponsRangeBonus(self);
    const num2 = num - distanceToTarget;
    const hitRangeChance = 0.15 + Math.max(0.0, num2 / num);
    let val = 10.0 / Math.max(1.0, targetCurrentSpeed(target));
    val = Math.max(0.7, Math.min(val, 5.0));
    if (isFighterTarget(target)) val = weapon.component.type !== ComponentType.WeaponPointDefense ? val / 1.1 : val * 2.0;
    let num3 = 0.0;
    let shipGroup = null;
    let num4 = 1.0;
    if (isBuiltObject(target)) {
        const builtObject = target;
        num3 = builtObject.countermeasureModifier + builtObject.fleetCountermeasureBonus;
        num4 = captainCountermeasuresBonus(builtObject);
        if (builtObject.empire !== null) {
            num3 += (builtObject.empire.countermeasuresFactor - 1.0) * 100.0;
            if (builtObject.empire.raceEventType === RACE_EVENT_TYPE_PREDICTIVE_HISTORY) num3 += 20.0;
        }
        shipGroup = shipGroupOf(builtObject);
    } else if (isFighterTarget(target)) {
        const fighter = target;
        num3 = fighter.specification.countermeasureModifier;
        if (fighter.parentBuiltObject !== null && !fighter.parentBuiltObject.hasBeenDestroyed) num3 += fighter.parentBuiltObject.fleetCountermeasureBonus;
        if (fighter.empire !== null) {
            num3 += (fighter.empire.countermeasuresFactor - 1.0) * 100.0;
            if (fighter.empire.raceEventType === RACE_EVENT_TYPE_PREDICTIVE_HISTORY) num3 += 20.0;
        }
    }
    let num5 = self.targettingModifier + self.fleetTargettingBonus;
    if (self.empire !== null) {
        num5 += (self.empire.targettingFactor - 1.0) * 100.0;
        if (self.empire.raceEventType === RACE_EVENT_TYPE_PREDICTIVE_HISTORY) num5 += 20.0;
    }
    switch (weapon.component.type) {
        case ComponentType.WeaponTractorBeam:
            num5 += 50.0;
            break;
        case ComponentType.WeaponPhaser:
        case ComponentType.WeaponSuperPhaser:
            num5 += 10.0;
            break;
        case ComponentType.WeaponRailGun:
        case ComponentType.WeaponSuperRailGun:
            num5 -= 10.0;
            break;
        case ComponentType.WeaponGravityBeam:
            num5 -= 10.0;
            break;
    }
    const num6 = (num5 - num3) / 100.0;
    let num7 = val * (hitRangeChance + galaxy.rnd.nextDouble() + num6);
    if (selfGroup !== null) num7 *= selfGroup.targetingBonus;
    num7 *= captainTargetingBonus(self);
    if (shipGroup !== null) num7 /= shipGroup.countermeasuresBonus;
    num7 /= num4;
    if (num7 > 0.5 && galaxy.rnd.next(0, 12) === 0) num7 = 0.0;
    else if (num7 <= 0.5 && num2 > 0.0 && galaxy.rnd.next(0, 12) === 0) num7 = 1.0;
    return { willHit: num7 > 0.5, hitRangeChance };
}

// ---------------------------------------------------------------------------------------------------------------
// BuiltObject.1.cs 4652-4850 ModifyDiplomacyFromAttack
// ---------------------------------------------------------------------------------------------------------------

/** Empire.4.cs 1527 CancelPirateMission(mission). */
export function cancelPirateMission(empire: Empire, mission: EmpireActivity | null): void {
    if (mission !== null) {
        empire.pirateMissions.removeEquivalent(mission);
        if (mission.requestingEmpire !== null && mission.requestingEmpire.pirateMissions != null) mission.requestingEmpire.pirateMissions.removeEquivalent(mission);
        if (mission.assignedEmpire !== null && mission.assignedEmpire.pirateMissions != null) mission.assignedEmpire.pirateMissions.removeEquivalent(mission);
    }
}

/** BuiltObject.1.cs 4721 ModifyDiplomacyFromAttack(targetEmpire, attackAffectsRelationship, attackAffectsReputation, evaluationImpact, reputationImpact). No Rnd. */
export function modifyDiplomacyFromAttack(galaxy: Galaxy, self: BuiltObject, targetEmpire: Empire | null, attackAffectsRelationship: boolean, attackAffectsReputation: boolean, evaluationImpact: number, reputationImpact: number): void {
    const empire = self.empire;
    if (targetEmpire !== null && galaxy.pirateEmpires.includes(targetEmpire)) {
        if (!attackAffectsRelationship || empire === null) return;
        const pirateRelation = obtainPirateRelation(targetEmpire, empire);
        if (pirateRelation.type !== PirateRelationType.None) changePirateRelation(targetEmpire, empire, PirateRelationType.None, galaxyStarDate(galaxy));
        changePirateEvaluation(targetEmpire, empire, -5, PirateRelationEvaluationType.ShipAttacks);
        const empireActivityList: EmpireActivity[] = [];
        for (let i = 0; i < targetEmpire.pirateMissions.count; i++) {
            const empireActivity = targetEmpire.pirateMissions.at(i);
            if (empireActivity !== null && empireActivity.requestingEmpire === empire && (empireActivity.type === EmpireActivityType.Attack || empireActivity.type === EmpireActivityType.Defend) && empireActivity.bidTimeRemaining <= 0) {
                empireActivityList.push(empireActivity);
            }
        }
        for (let j = 0; j < empireActivityList.length; j++) cancelPirateMission(targetEmpire, empireActivityList[j]);
    } else {
        if (targetEmpire === null || empire === targetEmpire) return;
        if (empire !== null && empire.pirateEmpireBaseHabitat !== null) {
            if (!attackAffectsRelationship) return;
            const pirateRelation2 = obtainPirateRelation(targetEmpire, empire);
            if (pirateRelation2.type !== PirateRelationType.None) changePirateRelation(targetEmpire, empire, PirateRelationType.None, galaxyStarDate(galaxy));
            changePirateEvaluation(targetEmpire, empire, -5, PirateRelationEvaluationType.ShipAttacks);
            if (empire.pirateMissions == null) return;
            const empireActivityList2: EmpireActivity[] = [];
            for (let k = 0; k < empire.pirateMissions.count; k++) {
                const empireActivity2 = empire.pirateMissions.at(k);
                if (empireActivity2 !== null && empireActivity2.requestingEmpire === targetEmpire && (empireActivity2.type === EmpireActivityType.Attack || empireActivity2.type === EmpireActivityType.Defend) && empireActivity2.bidTimeRemaining <= 0) {
                    empireActivityList2.push(empireActivity2);
                }
            }
            for (let l = 0; l < empireActivityList2.length; l++) cancelPirateMission(targetEmpire, empireActivityList2[l]);
            return;
        }
        // Empire.DiplomaticRelations[targetEmpire]?.Type ?? None (NRE in C# when Empire is null; the call sites guarantee it).
        const diplomaticRelationType = empire!.diplomaticRelations.byEmpire(targetEmpire)?.type ?? DiplomaticRelationType.None;
        if (diplomaticRelationType === DiplomaticRelationType.War) return;
        if (targetEmpire !== galaxy.independentEmpire && attackAffectsRelationship) {
            const outlaws = targetEmpire.outlaws as BuiltObject[];
            const num = outlaws.indexOf(self);
            if (num < 0) outlaws.push(self);
        }
        if (attackAffectsReputation) {
            if (reputationImpact > 0.0) {
                empire!.civilityRating -= reputationImpact;
            } else {
                switch (diplomaticRelationType) {
                    case DiplomaticRelationType.MutualDefensePact:
                    case DiplomaticRelationType.Protectorate:
                        empire!.civilityRating -= 5.0;
                        break;
                    case DiplomaticRelationType.FreeTradeAgreement:
                        empire!.civilityRating -= 3.0;
                        break;
                    case DiplomaticRelationType.Truce:
                        empire!.civilityRating -= 2.0;
                        break;
                    case DiplomaticRelationType.None:
                    case DiplomaticRelationType.SubjugatedDominion:
                        empire!.civilityRating -= 1.0;
                        break;
                    case DiplomaticRelationType.TradeSanctions:
                        empire!.civilityRating -= 0.3;
                        break;
                }
            }
        }
        if (!attackAffectsRelationship) return;
        if (targetEmpire !== null && targetEmpire !== galaxy.independentEmpire && empire !== null && empire.pirateEmpireBaseHabitat === null && empire !== galaxy.independentEmpire && !targetEmpire.recentAttackingEmpires.includes(empire)) {
            targetEmpire.recentAttackingEmpires.push(empire);
        }
        if (empire!.pirateEmpireBaseHabitat === null && empire !== galaxy.independentEmpire && targetEmpire !== galaxy.independentEmpire) {
            const empireEvaluation = obtainEmpireEvaluation(galaxy, targetEmpire, empire);
            if (evaluationImpact <= 0) empireEvaluation.incidentEvaluation = empireEvaluation.incidentEvaluationRaw - 10.0;
            else empireEvaluation.incidentEvaluation = empireEvaluation.incidentEvaluationRaw - evaluationImpact;
        }
    }
}

/** BuiltObject.1.cs 4652 ModifyDiplomacyFromAttack(targetEmpire, evaluationImpact) = (…, true, true, evaluationImpact, 0.0). */
export function modifyDiplomacyFromAttackEmpire(galaxy: Galaxy, builtObject: BuiltObject, targetEmpire: Empire | null, evaluationImpact: number): void {
    modifyDiplomacyFromAttack(galaxy, builtObject, targetEmpire, true, true, evaluationImpact, 0.0);
}

/** BuiltObject.1.cs 4657 ModifyDiplomacyFromAttack(targetBuiltObject). No Rnd. */
export function modifyDiplomacyFromAttackBuiltObject(galaxy: Galaxy, self: BuiltObject, targetBuiltObject: BuiltObject | null): void {
    if (targetBuiltObject === null) return;
    let flag = true;
    let attackAffectsReputation = true;
    if (attackersContainsFighterOrBuiltObject(stellarAttackers(targetBuiltObject), self)) {
        flag = false;
        attackAffectsReputation = false;
    } else if (attackersContainsFighterOrBuiltObject(stellarAttackers(self), targetBuiltObject)) {
        flag = false;
        attackAffectsReputation = false;
    } else {
        if (targetBuiltObject.role === BuiltObjectRole.Military && targetBuiltObject.nearestSystemStar !== null) {
            const systemInfo = galaxy.systems[targetBuiltObject.nearestSystemStar.systemIndex];
            if (systemInfo.dominantEmpire != null && systemInfo.dominantEmpire.empire === self.empire && targetBuiltObject.empire !== null) {
                if (targetBuiltObject.empire.pirateEmpireBaseHabitat !== null) {
                    if (targetBuiltObject.empire !== null) {
                        const pirateRelation = obtainPirateRelation(self.empire!, targetBuiltObject.empire);
                        if (pirateRelation.type !== PirateRelationType.Protection) attackAffectsReputation = false;
                    }
                } else {
                    const diplomaticRelation = obtainDiplomaticRelation(self.empire!, targetBuiltObject.empire);
                    if (diplomaticRelation.type !== DiplomaticRelationType.FreeTradeAgreement && diplomaticRelation.type !== DiplomaticRelationType.Protectorate && diplomaticRelation.type !== DiplomaticRelationType.MutualDefensePact) {
                        attackAffectsReputation = false;
                    }
                }
            }
        }
        flag = !(self.empire!.outlaws as BuiltObject[]).includes(targetBuiltObject);
    }
    let reputationImpact = 0.0;
    if (targetBuiltObject.subRole === BuiltObjectSubRole.PassengerShip) reputationImpact = 1.0;
    else if (targetBuiltObject.subRole === BuiltObjectSubRole.ResortBase) reputationImpact = 4.0;
    if (!flag) attackAffectsReputation = false;
    modifyDiplomacyFromAttack(galaxy, self, targetBuiltObject.empire, flag, attackAffectsReputation, 0, reputationImpact);
}

// ---------------------------------------------------------------------------------------------------------------
// BuiltObject.1.cs 3651-3736 tractor beam / area weapon checks
// ---------------------------------------------------------------------------------------------------------------

/** BuiltObject.1.cs 3651 DetermineTractorBeamShouldPullGeneral. */
export function determineTractorBeamShouldPullGeneral(self: BuiltObject): boolean {
    let result = true;
    const mission = builtObjectMission(self.mission);
    if (mission !== null && mission.type === BuiltObjectMissionType.Escape) result = false;
    return result;
}

/** BuiltObject.1.cs 3661 DetermineTractorBeamShouldPullTarget(target, ourLongRangeWeaponsDamage, distance). */
export function determineTractorBeamShouldPullTarget(self: BuiltObject, target: StellarObject | null, ourLongRangeWeaponsDamage: number, distance: number): boolean {
    let result = true;
    if (target !== null) {
        if (isBuiltObject(target)) {
            const builtObject = target;
            let num = self.optimalMaximumAttackRange;
            if (self.role === BuiltObjectRole.Base && builtObject.troopCapacity > 0 && self.parentHabitat !== null && self.parentHabitat.population !== null && self.parentHabitat.empire === self.empire && (self.subRole === BuiltObjectSubRole.SmallSpacePort || self.subRole === BuiltObjectSubRole.MediumSpacePort || self.subRole === BuiltObjectSubRole.LargeSpacePort)) {
                num = Math.max(Math.max(200.0, self.minimumWeaponsRange * 0.9), num);
            }
            switch (determineTacticsAgainstTarget(self, target)) {
                case BattleTactics.Standoff:
                case BattleTactics.AllWeapons:
                case BattleTactics.PointBlank:
                    result = distance > num ? true : false;
                    break;
                case BattleTactics.Evade:
                    result = false;
                    break;
            }
            if (builtObject.firepowerRaw > self.firepowerRaw) {
                const num2 = calculateRawDamageOfWeaponsAboveRange(builtObject.weapons, self.tractorBeamRange);
                if (ourLongRangeWeaponsDamage > num2) result = false;
            }
        } else if (isCreature(target)) {
            const creature = target;
            if (creature.currentTarget !== null && creature.currentTarget === self) result = false;
        }
    }
    return result;
}

/** BuiltObject.1.cs 3706 CheckFireAreaWeaponAtTarget(weapon, target): no friendly ship inside the blast. */
export function checkFireAreaWeaponAtTarget(galaxy: Galaxy, self: BuiltObject, weapon: Weapon | null, target: StellarObject | FighterTargetLike | null): boolean {
    if (target !== null && weapon !== null) {
        let num = 0.0;
        let flag = false;
        if (weapon.component !== null && weapon.component.type === ComponentType.WeaponAreaGravity) flag = true;
        num = !flag ? weapon.range * weapon.range : weapon.damageLoss * weapon.damageLoss;
        num *= 0.7;
        const galaxyIndex = galaxy.resolveIndex(target.xpos, target.ypos);
        const cell = galaxy.builtObjectIndexGrid[galaxyIndex.x][galaxyIndex.y];
        for (let i = 0; i < cell.length; i++) {
            const builtObject = cell[i];
            if (builtObject != null && !builtObject.hasBeenDestroyed && builtObject.empire !== null && builtObject.empire === self.empire && builtObject !== self) {
                const num2 = galaxy.calculateDistanceSquared(target.xpos, target.ypos, builtObject.xpos, builtObject.ypos);
                if (num2 < num) return false;
            }
        }
    }
    return true;
}

// ---------------------------------------------------------------------------------------------------------------
// BuiltObject.1.cs 4852-5200 firing
// ---------------------------------------------------------------------------------------------------------------

/** BuiltObject.1.cs 4852 FirePlanetDestroyerAtHabitat(distanceToTarget, target). No Rnd. */
export function firePlanetDestroyerAtHabitat(galaxy: Galaxy, builtObject: BuiltObject, distanceToTarget: number, target: Habitat): void {
    const self = builtObject;
    if (self._fuelHandicapped) return;
    const tempNow = galaxy.nowMs;
    const shipGroup = shipGroupOf(self);
    for (let i = 0; i < self.weapons.length; i++) {
        const w = self.weapons[i];
        if (!w.isPlanetDestroyer) continue;
        let num = w.range;
        if (shipGroup !== null) num *= shipGroup.weaponsRangeBonus;
        num *= captainWeaponsRangeBonus(self);
        if (num >= distanceToTarget && w.distanceTravelled < 0 && w.energyRequired <= self.currentEnergy && tempNow - w.lastFired >= w.fireRate) {
            if (target.empire !== null && target.empire !== galaxy.independentEmpire) {
                modifyDiplomacyFromAttack(galaxy, self, target.empire, true, true, 80, 0.0);
                const habitat = galaxy.determineHabitatSystemStar(target);
                const description = `The ${self.empire!.name} have destroyed your colony ${target.name} in the ${habitat.name} system`;
                sendMessageToEmpire(target.empire, target.empire, EmpireMessageType.ColonyDestroyed, target, description);
            }
            // _Galaxy.CheckTriggerEvent(target.GameEventId, ActualEmpire, EventTriggerType.Destroy, null): scripted game events, deferred.
            w.willHitTarget = true;
            w.heading = Math.fround(determineAngle(self.xpos, self.ypos, target.xpos, target.ypos));
            w.lastFired = tempNow;
            w.x = self.xpos;
            w.y = self.ypos;
            w.distanceTravelled = 1;
            w.distanceFromTarget = Math.fround(distanceToTarget);
            w.target = target;
            let num2 = w.energyRequired;
            if (shipGroup !== null) num2 /= shipGroup.shipEnergyUsageBonus;
            num2 /= captainShipEnergyUsageBonus(self);
            self.currentEnergy -= num2;
        }
    }
}

/** BuiltObject.1.cs 4899 BombardTarget(distanceToTarget, habitat). Rnd per eligible weapon: NextDouble; on firing NextDouble, Next(0, 2). */
export function bombardTarget(galaxy: Galaxy, builtObject: BuiltObject, distanceToTarget: number, habitat: Habitat): void {
    const self = builtObject;
    if (self._fuelHandicapped || habitat.hasBeenDestroyed) return;
    const tempNow = galaxy.nowMs;
    const shipGroup = shipGroupOf(self);
    for (let i = 0; i < self.weapons.length; i++) {
        const w = self.weapons[i];
        if (w.bombardDamage <= 0 || !(w.distanceTravelled < 0)) continue;
        let num = w.range;
        if (shipGroup !== null) num *= shipGroup.weaponsRangeBonus;
        num *= captainWeaponsRangeBonus(self);
        if (!(num >= distanceToTarget) || !(w.energyRequired <= self.currentEnergy) || w.component.type === ComponentType.HyperDeny || w.component.type === ComponentType.HyperStop) continue;
        const timeSpanMs = tempNow - w.lastFired;
        const num2 = galaxy.rnd.nextDouble() * 500.0 - 250.0;
        if (timeSpanMs >= w.fireRate + num2) {
            if (habitat.empire !== null && habitat.empire !== galaxy.independentEmpire && habitat.empire.pirateEmpireBaseHabitat === null) {
                modifyDiplomacyFromAttack(galaxy, self, habitat.empire, true, false, 1, 0.0);
            }
            w.willHitTarget = true;
            w.heading = Math.fround(determineAngle(self.xpos, self.ypos, habitat.xpos, habitat.ypos));
            let num3 = galaxy.rnd.nextDouble() * 0.2;
            if (galaxy.rnd.next(0, 2) === 0) num3 *= -1.0;
            w.heading = Math.fround(w.heading + Math.fround(num3));
            w.lastFired = tempNow;
            w.x = self.xpos;
            w.y = self.ypos;
            w.distanceTravelled = 1;
            w.distanceFromTarget = Math.fround(distanceToTarget);
            w.target = habitat;
            let num4 = w.energyRequired;
            if (shipGroup !== null) num4 /= shipGroup.shipEnergyUsageBonus;
            num4 /= captainShipEnergyUsageBonus(self);
            self.currentEnergy -= num4;
        }
    }
}

/** BuiltObject.1.cs 4954 CheckConventionalWeaponsAvailableToFireAtPassingThreats(time). */
export function checkConventionalWeaponsAvailableToFireAtPassingThreats(galaxy: Galaxy, self: BuiltObject, time: number): boolean {
    void time;
    let result = false;
    const tempNow = galaxy.nowMs;
    if (self.maximumWeaponsRange > 0 && self.currentEnergy > self.reactorStorageCapacity * 0.25) {
        for (let i = 0; i < self.weapons.length; i++) {
            const weapon = self.weapons[i];
            if (weapon != null && weapon.component !== null) {
                let flag = true;
                switch (weapon.component.type) {
                    case ComponentType.WeaponBombard:
                    case ComponentType.WeaponPointDefense:
                    case ComponentType.WeaponIonDefense:
                    case ComponentType.WeaponTractorBeam:
                    case ComponentType.AssaultPod:
                    case ComponentType.HyperDeny:
                    case ComponentType.HyperStop:
                        flag = false;
                        break;
                }
                if (flag && self.currentEnergy > weapon.energyRequired && tempNow - weapon.lastFired >= weapon.fireRate) {
                    result = true;
                    break;
                }
            }
        }
    }
    return result;
}

/** BuiltObject.1.cs 4993 FireWeaponTypeAtTarget(weaponType, distanceToTarget, target, time, mayModifyDiplomacy, maximumPortion = 1.0). */
export function fireWeaponTypeAtTarget(galaxy: Galaxy, self: BuiltObject, weaponType: ComponentType, distanceToTarget: number, target: StellarObject, time: number, mayModifyDiplomacy: boolean, maximumPortion = 1.0): void {
    const weaponList: Weapon[] = [];
    for (let i = 0; i < self.weapons.length; i++) {
        const weapon = self.weapons[i];
        if (weapon != null && weapon.component !== null && weapon.component.type === weaponType) weaponList.push(weapon);
    }
    fireWeaponSetAtTarget(galaxy, self, weaponList, distanceToTarget, target, time, mayModifyDiplomacy, maximumPortion);
}

/** BuiltObject.1.cs 5007 FireWeaponSetAtTarget(weapons, distanceToTarget, target, time, mayModifyDiplomacy, maximumPortion). Rnd per eligible weapon: NextDouble; then DetermineHitTarget + Fire draws. */
export function fireWeaponSetAtTarget(galaxy: Galaxy, self: BuiltObject, weapons: Weapon[], distanceToTarget: number, target: StellarObject, time: number, mayModifyDiplomacy: boolean, maximumPortion: number): void {
    if (self._fuelHandicapped || target.hasBeenDestroyed) return;
    const tempNow = galaxy.nowMs;
    const shipGroup = shipGroupOf(self);
    const num = Math.max(1, Math.trunc(weapons.length * maximumPortion + 0.5));
    let num2 = 0;
    for (let i = 0; i < weapons.length; i++) {
        const weapon = weapons[i];
        if (weapon != null && weapon.distanceTravelled < 0) {
            let num3 = weapon.range;
            if (shipGroup !== null) num3 *= shipGroup.weaponsRangeBonus;
            num3 *= captainWeaponsRangeBonus(self);
            if (num3 >= distanceToTarget && weapon.energyRequired <= self.currentEnergy) {
                const type = weapon.component.type;
                if (type !== ComponentType.HyperDeny && type !== ComponentType.HyperStop && type !== ComponentType.WeaponPointDefense && type !== ComponentType.AssaultPod) {
                    let flag = true;
                    if (self.isPlanetDestroyer && (type === ComponentType.WeaponSuperBeam || type === ComponentType.WeaponSuperTorpedo || type === ComponentType.WeaponSuperMissile || type === ComponentType.WeaponSuperRailGun || type === ComponentType.WeaponSuperPhaser) && self.colonyToAttack !== null) {
                        const num4 = galaxy.calculateDistance(self.xpos, self.ypos, self.colonyToAttack.xpos, self.colonyToAttack.ypos);
                        if (num4 <= num3 + 300.0) flag = false;
                    }
                    if (type === ComponentType.WeaponTractorBeam) {
                        if (isCreature(target)) {
                            // (empty branch in the C#)
                        } else if (isBuiltObject(target) && target.role === BuiltObjectRole.Base) {
                            flag = false;
                        }
                    }
                    if (type === ComponentType.WeaponIonPulse || type === ComponentType.WeaponAreaGravity || type === ComponentType.WeaponAreaDestruction) {
                        flag = checkFireAreaWeaponAtTarget(galaxy, self, weapon, target);
                    }
                    if (flag) {
                        const timeSpanMs = tempNow - weapon.lastFired;
                        const num5 = galaxy.rnd.nextDouble() * 800.0 - 400.0;
                        if (timeSpanMs >= weapon.fireRate + num5) {
                            if (mayModifyDiplomacy && isBuiltObject(target)) modifyDiplomacyFromAttackBuiltObject(galaxy, self, target);
                            const r = determineHitTarget(galaxy, self, weapon, target, distanceToTarget);
                            weaponFire(galaxy, weapon, self, target, distanceToTarget, time, r.willHit, r.hitRangeChance);
                            num2++;
                        }
                    }
                }
            }
        }
        if (num2 >= num) break;
    }
}

/**
 * BuiltObject.1.cs 5089 FireWeaponsAtTarget(distanceToTarget, target, time, mayModifyDiplomacy). Rnd per eligible weapon:
 * NextDouble (fire-rate jitter); when firing: DetermineHitTarget (NextDouble, Next(0, 12)) + Fire (NextDouble, Next(0, 2)).
 */
export function fireWeaponsAtTarget(galaxy: Galaxy, builtObject: BuiltObject, distanceToTarget: number, target: BuiltObject | Habitat | Creature, time: number, mayModifyDiplomacy: boolean): void {
    const self = builtObject;
    if (self._fuelHandicapped || target.hasBeenDestroyed) return;
    const tempNow = galaxy.nowMs;
    const shipGroup = shipGroupOf(self);
    let flag = false;
    if (self.ionWeaponPower > 0 && isCreature(target)) {
        const creature = target;
        if (creature.type === CreatureType.SilverMist) {
            flag = true;
            for (let i = 0; i < self.weapons.length; i++) {
                const weapon = self.weapons[i];
                if (weapon == null || weapon.component === null || (weapon.component.type !== ComponentType.WeaponIonCannon && weapon.component.type !== ComponentType.WeaponIonPulse) || !(weapon.distanceTravelled < 0)) continue;
                let num = weapon.range;
                if (shipGroup !== null) num *= shipGroup.weaponsRangeBonus;
                num *= captainWeaponsRangeBonus(self);
                if (num >= distanceToTarget && weapon.energyRequired <= self.currentEnergy) {
                    const timeSpanMs = tempNow - weapon.lastFired;
                    const num2 = galaxy.rnd.nextDouble() * 800.0 - 400.0;
                    if (timeSpanMs >= weapon.fireRate + num2) {
                        const r = determineHitTarget(galaxy, self, weapon, target, distanceToTarget);
                        weaponFire(galaxy, weapon, self, target, distanceToTarget, time, r.willHit, r.hitRangeChance);
                    }
                }
            }
        }
    }
    let num3 = 0;
    if (flag) num3 = Math.trunc(self.reactorStorageCapacity * 0.5);
    for (let j = 0; j < self.weapons.length; j++) {
        const weapon2 = self.weapons[j];
        if (weapon2 == null || !(weapon2.distanceTravelled < 0)) continue;
        let num4 = weapon2.range;
        if (shipGroup !== null) num4 *= shipGroup.weaponsRangeBonus;
        num4 *= captainWeaponsRangeBonus(self);
        if (!(num4 >= distanceToTarget) || !(weapon2.energyRequired + num3 <= self.currentEnergy)) continue;
        const type = weapon2.component.type;
        if (type === ComponentType.HyperDeny || type === ComponentType.HyperStop || type === ComponentType.WeaponPointDefense || type === ComponentType.AssaultPod) continue;
        let flag2 = true;
        if (self.isPlanetDestroyer && (type === ComponentType.WeaponSuperBeam || type === ComponentType.WeaponSuperTorpedo || type === ComponentType.WeaponSuperMissile || type === ComponentType.WeaponSuperRailGun || type === ComponentType.WeaponSuperPhaser) && self.colonyToAttack !== null) {
            const num5 = galaxy.calculateDistance(self.xpos, self.ypos, self.colonyToAttack.xpos, self.colonyToAttack.ypos);
            if (num5 <= num4 + 300.0) flag2 = false;
        }
        if (type === ComponentType.WeaponTractorBeam) {
            if (isCreature(target)) {
                // (empty branch in the C#)
            } else if (isBuiltObject(target) && target.role === BuiltObjectRole.Base) {
                flag2 = false;
            }
        }
        if (type === ComponentType.WeaponIonPulse || type === ComponentType.WeaponAreaGravity || type === ComponentType.WeaponAreaDestruction) {
            flag2 = checkFireAreaWeaponAtTarget(galaxy, self, weapon2, target);
        }
        if (!flag2) continue;
        const timeSpan2Ms = tempNow - weapon2.lastFired;
        const num6 = galaxy.rnd.nextDouble() * 800.0 - 400.0;
        if (timeSpan2Ms >= weapon2.fireRate + num6) {
            if (mayModifyDiplomacy && isBuiltObject(target)) modifyDiplomacyFromAttackBuiltObject(galaxy, self, target);
            const r = determineHitTarget(galaxy, self, weapon2, target, distanceToTarget);
            weaponFire(galaxy, weapon2, self, target, distanceToTarget, time, r.willHit, r.hitRangeChance);
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// BuiltObject.1.cs 3737 HandleWeaponsFiring
// ---------------------------------------------------------------------------------------------------------------

/** The "target destroyed" block repeated at BuiltObject.1.cs 3900-3931 / 4000-4031 / 4153-4184 / 4288-4319 / 4381-4412. Rnd: [Next(0, 4)] + ProvideBonusFromPirateBase. */
function onWeaponTargetDestroyed(galaxy: Galaxy, self: BuiltObject, builtObjectN: BuiltObject): void {
    const empire = self.empire;
    if (builtObjectN.empire !== null && builtObjectN.empire.pirateEmpireBaseHabitat !== null && empire !== null && empire.pirateEmpireBaseHabitat !== null && empire.pirateEmpireSuperPirates) {
        let flagN = false;
        switch (builtObjectN.subRole) {
            case BuiltObjectSubRole.SmallSpacePort:
            case BuiltObjectSubRole.MediumSpacePort:
            case BuiltObjectSubRole.LargeSpacePort:
                flagN = true;
                break;
        }
        if (flagN && galaxy.rnd.next(0, 4) === 1) fearfulPirateFactionJoinsPlayer(galaxy, empire, builtObjectN.empire);
    }
    provideBonusFromPirateBase(galaxy, self, empire, builtObjectN);
    if (empire !== null && empire.pirateEmpireBaseHabitat !== null && galaxy.pirateEmpires.includes(empire)) {
        let numN = calculateBuiltObjectLootingValue(builtObjectN);
        numN *= empireColonyIncomeFactor(empire);
        numN *= empireLootingFactor(empire);
        numN = applyCorruptionToIncome(empire, numN);
        empire.stateMoney += numN;
        empire.pirateEconomy.performIncome(numN, PirateIncomeType.Looting, galaxyStarDate(galaxy));
        const byAttackTarget = empire.pirateMissions.getByAttackTarget(builtObjectN, empire);
        if (byAttackTarget !== null) completePirateMission(galaxy, empire, byAttackTarget);
    }
}

/** BuiltObject.1.cs 3579 HandlePlanetDestroyerFiring(weapon, timePassed). No Rnd here (DestroyHabitat draws). */
export function handlePlanetDestroyerFiring(galaxy: Galaxy, self: BuiltObject, weapon: Weapon, timePassed: number): void {
    const target = weaponTarget(weapon);
    if (target === null) {
        weapon.resetNext = true;
    } else {
        if (!isHabitat(target)) return;
        if (target !== null && target.hasBeenDestroyed) {
            weapon.resetNext = true;
        } else {
            if (!(weapon.distanceTravelled >= 0.0) || self.hasBeenDestroyed || weapon.component.status !== ComponentStatus.Normal) return;
            const tempNow = galaxy.nowMs;
            let val = Math.fround((tempNow - weapon.lastFired) / 1000);
            val = Math.min(val, Math.fround(timePassed));
            let num = TORPEDO_WEAPON_HIT_RANGE * 2.0;
            if (self.inView) num = TORPEDO_WEAPON_HIT_RANGE;
            void num;
            const num2 = !(weapon.distanceTravelled <= 1) ? Math.fround(Math.fround(weapon.speed) * val) : 10;
            weapon.distanceTravelled = Math.fround(weapon.distanceTravelled + num2);
            const distanceFromTarget = weapon.distanceFromTarget;
            weapon.x += Math.cos(weapon.heading) * num2;
            weapon.y += Math.sin(weapon.heading) * num2;
            weapon.distanceFromTarget = Math.fround(galaxy.calculateDistance(weapon.x, weapon.y, target.xpos, target.ypos));
            let num3 = Math.fround(weapon.rawDamage);
            const shipGroup = shipGroupOf(self);
            if (shipGroup !== null) num3 = Math.fround(num3 * Math.fround(shipGroup.weaponsDamageBonus));
            num3 = Math.fround(num3 * Math.fround(captainWeaponsDamageBonus(self)));
            weapon.power = Math.fround(num3 - Math.fround(Math.fround(weapon.distanceTravelled / 100) * Math.fround(weapon.damageLoss)));
            if (weapon.willHitTarget) {
                let flag = false;
                if (distanceFromTarget < weapon.distanceFromTarget) flag = true;
                if (flag) {
                    const habitat = target;
                    habitat.teardownEmpire = self.actualEmpire;
                    destroyHabitat(galaxy, self, habitat);
                    weapon.target = null;
                    weapon.resetNext = true;
                }
            }
            let num4 = Math.fround(weapon.range);
            if (shipGroup !== null) num4 = Math.fround(num4 * Math.fround(shipGroup.weaponsRangeBonus));
            num4 = Math.fround(num4 * Math.fround(captainWeaponsRangeBonus(self)));
            if (weapon.distanceTravelled > num4) weapon.resetNext = true;
        }
    }
}

/**
 * BuiltObject.1.cs 3737 HandleWeaponsFiring(timePassed, time, galaxy): advance every weapon in flight, apply hits.
 * Rnd: gravity / tractor miss placement NextDouble ×2; per destroyed target [Next(0, 4)] + ProvideBonusFromPirateBase;
 * InflictDamage / InflictIonDamage / InflictBombardDamage draws.
 */
export function handleWeaponsFiringBuiltObject(galaxy: Galaxy, builtObject: BuiltObject, timePassed: number, time: number): void {
    const self = builtObject;
    const tempNow = galaxy.nowMs;
    const num = weaponRangeIncrementForDamageLoss(self);
    void num;
    let flag = true;
    let ourLongRangeWeaponsDamage = 0;
    if (self.tractorBeamRange > 0) {
        flag = determineTractorBeamShouldPullGeneral(self);
        ourLongRangeWeaponsDamage = calculateRawDamageOfWeaponsAboveRange(self.weapons, self.tractorBeamRange);
    }
    const shipGroup = shipGroupOf(self);
    const battleStats = battleStatsOf(self);
    const groupStats = shipGroup !== null ? battleStatsOf(shipGroup) : null;
    for (let i = 0; i < self.weapons.length && !self.hasBeenDestroyed; i++) {
        const weapon = self.weapons[i];
        if (weapon == null || (weapon.component !== null && weapon.component.type === ComponentType.AssaultPod)) continue;
        if (weapon.resetNext) {
            weapon.reset();
            continue;
        }
        let target = weaponTarget(weapon);
        if (weapon.isPlanetDestroyer) {
            if (target !== null && isHabitat(target)) {
                handlePlanetDestroyerFiring(galaxy, self, weapon, timePassed);
                continue;
            }
            if (target === null) {
                if (weapon.distanceTravelled > 0) weapon.resetNext = true;
                continue;
            }
        }
        if (target === null && weapon.targetWeapon === null) {
            weapon.resetNext = true;
            continue;
        }
        if (target !== null && stellarHasBeenDestroyed(target)) {
            weapon.resetNext = true;
            continue;
        }
        if (weapon.targetWeapon !== null && weapon.targetWeapon.distanceTravelled <= 0) {
            weapon.resetNext = true;
            continue;
        }
        let num2 = self.xpos;
        let num3 = self.ypos;
        let num4 = 0;
        if (target !== null) {
            num2 = target.xpos;
            num3 = target.ypos;
            num4 = stellarSize(target);
        } else if (weapon.targetWeapon !== null) {
            num2 = weapon.targetWeapon.x;
            num3 = weapon.targetWeapon.y;
            num4 = Math.trunc(weapon.targetWeapon.power);
        }
        if (!(weapon.distanceTravelled >= 0)) continue;
        let val = Math.fround((tempNow - weapon.lastFired) / 1000);
        val = Math.min(val, Math.fround(timePassed));
        let flag2 = false;
        let num5 = TORPEDO_WEAPON_HIT_RANGE * 3.0;
        if (self.inView) num5 = TORPEDO_WEAPON_HIT_RANGE;
        let num6 = Math.fround(weapon.rawDamage);
        let num7 = Math.fround(weapon.range);
        if (shipGroup !== null) {
            num6 = Math.fround(num6 * Math.fround(shipGroup.weaponsDamageBonus));
            num7 = Math.fround(num7 * Math.fround(shipGroup.weaponsRangeBonus));
        }
        num6 = Math.fround(num6 * Math.fround(captainWeaponsDamageBonus(self)));
        num7 = Math.fround(num7 * Math.fround(captainWeaponsRangeBonus(self)));
        if (self.sensorTraceScannerPower > 0) num6 = Math.fround(num6 * Math.fround(1 + Math.fround(Math.fround(self.sensorTraceScannerPower) / 100)));
        switch (weapon.component.type) {
            case ComponentType.WeaponBeam:
            case ComponentType.WeaponPointDefense:
            case ComponentType.WeaponIonCannon:
            case ComponentType.WeaponSuperBeam:
            case ComponentType.WeaponPhaser:
            case ComponentType.WeaponRailGun:
            case ComponentType.WeaponSuperPhaser:
            case ComponentType.WeaponSuperRailGun: {
                let num8: number;
                if (weapon.distanceTravelled <= 1) {
                    flag2 = true;
                    num8 = 2;
                } else {
                    num8 = Math.fround(Math.fround(weapon.speed) * val);
                }
                weapon.distanceTravelled = Math.fround(weapon.distanceTravelled + num8);
                const distanceFromTarget = weapon.distanceFromTarget;
                weapon.x += Math.cos(weapon.heading) * num8;
                weapon.y += Math.sin(weapon.heading) * num8;
                weapon.distanceFromTarget = Math.fround(galaxy.calculateDistance(weapon.x, weapon.y, num2, num3));
                weapon.power = weaponDamageDropoff(self, weapon, num6);
                if (weapon.willHitTarget && !flag2) {
                    let flag7 = false;
                    if (self.inView) {
                        if (weapon.distanceFromTarget <= num5) flag7 = true;
                    } else if (distanceFromTarget < weapon.distanceFromTarget) {
                        flag7 = true;
                    }
                    if (flag7) {
                        if (weapon.targetWeapon !== null) {
                            weapon.targetWeapon.power = Math.fround(3.4028234663852886e38);
                            weapon.targetWeapon.resetNext = true;
                        } else if (weapon.component.type === ComponentType.WeaponIonCannon) {
                            target = weaponTarget(weapon);
                            if (target !== null && stellarHasBeenDestroyed(target)) {
                                weapon.target = null;
                            } else {
                                inflictIonDamage(galaxy, self, target as StellarObject, weapon, weapon.power, time, weapon.heading);
                            }
                        } else if (isHabitat(target) && weapon.bombardDamage > 0) {
                            inflictBombardDamage(galaxy, self, target, weapon.bombardDamage);
                            weapon.target = null;
                        } else if (inflictDamage(galaxy, self, target!, weapon, weapon.power, time, weapon.distanceTravelled, weapon.heading)) {
                            target = weaponTarget(weapon);
                            if (target !== null && isBuiltObject(target)) onWeaponTargetDestroyed(galaxy, self, target);
                            weapon.target = null;
                        }
                        weapon.resetNext = true;
                    }
                }
                if (weapon.distanceTravelled > num7) {
                    if (battleStats !== null) battleStats.weaponMissEnemy();
                    if (groupStats !== null) groupStats.weaponMissEnemy();
                    weapon.resetNext = true;
                }
                break;
            }
            case ComponentType.WeaponGravityBeam: {
                let num8: number;
                if (weapon.distanceTravelled <= 1) {
                    flag2 = true;
                    num8 = 2;
                    if (!weapon.willHitTarget && !weapon.hasMissed && target !== null) {
                        let num35 = galaxy.calculateDistance(self.xpos, self.ypos, num2, num3);
                        num35 += 100.0 * (galaxy.rnd.nextDouble() - 0.5);
                        num35 = Math.min(num35, weapon.range);
                        let num36 = determineAngle(self.xpos, self.ypos, num2, num3);
                        num36 += 0.5 * (galaxy.rnd.nextDouble() - 0.5);
                        weapon.x = self.xpos + Math.cos(num36) * num35;
                        weapon.y = self.ypos + Math.sin(num36) * num35;
                        weapon.distanceFromTarget = Math.fround(galaxy.calculateDistance(weapon.x, weapon.y, num2, num3));
                        weapon.hasMissed = true;
                    }
                } else {
                    num8 = Math.fround(Math.fround(weapon.speed) * val);
                }
                weapon.distanceTravelled = Math.fround(weapon.distanceTravelled + num8);
                weapon.power = weaponDamageDropoff(self, weapon, num6);
                if (weapon.willHitTarget) {
                    weapon.x = num2;
                    weapon.y = num3;
                    const num37 = galaxy.calculateDistance(self.xpos, self.ypos, num2, num3);
                    const num38 = Math.min(1.0, Math.max(0.05, 1.0 - num37 / weapon.range));
                    const num39 = Math.min(60.0, Math.max(20.0, (weapon.rawDamage / (num4 / 1000.0)) * num38));
                    let num40 = Math.min(1.0, timePassed * num39);
                    if (target !== null) {
                        if (Math.trunc(time % 1000) % 100 < 50) num40 = 0.0 - num40;
                        target.xpos += num40;
                        target.ypos += num40;
                        weapon.distanceFromTarget = Math.fround(galaxy.calculateDistance(weapon.x, weapon.y, num2, num3));
                        const hitPower2 = Math.max(1.0, weapon.power * num38 * Math.max(0.05, 100.0 / num4));
                        if (flag2 && inflictDamage(galaxy, self, target, weapon, hitPower2, time, weapon.distanceTravelled, weapon.heading)) {
                            target = weaponTarget(weapon);
                            if (target !== null && isBuiltObject(target)) onWeaponTargetDestroyed(galaxy, self, target);
                            weapon.target = null;
                        }
                    }
                }
                const totalSeconds2 = (time - weapon.lastFired) / 1000;
                if (totalSeconds2 > 3.0) weapon.resetNext = true;
                break;
            }
            case ComponentType.WeaponTractorBeam: {
                if (weapon.distanceTravelled <= 1) {
                    flag2 = true;
                    if (!weapon.willHitTarget && !weapon.hasMissed && target !== null) {
                        let num29 = galaxy.calculateDistance(self.xpos, self.ypos, num2, num3);
                        num29 += 100.0 * (galaxy.rnd.nextDouble() - 0.5);
                        num29 = Math.min(num29, weapon.range);
                        let num30 = determineAngle(self.xpos, self.ypos, num2, num3);
                        num30 += 0.5 * (galaxy.rnd.nextDouble() - 0.5);
                        weapon.x = self.xpos + Math.cos(num30) * num29;
                        weapon.y = self.ypos + Math.sin(num30) * num29;
                        weapon.distanceFromTarget = Math.fround(galaxy.calculateDistance(weapon.x, weapon.y, num2, num3));
                        weapon.hasMissed = true;
                    }
                }
                if (weapon.willHitTarget) {
                    weapon.x = num2;
                    weapon.y = num3;
                    const num31 = galaxy.calculateDistance(self.xpos, self.ypos, num2, num3);
                    const num32 = Math.min(1.0, Math.max(0.01, 1.0 - num31 / weapon.range));
                    const num33 = timePassed * (weapon.rawDamage / (num4 / 1000.0)) * num32;
                    if (target !== null) {
                        const num34 = flag && determineTractorBeamShouldPullTarget(self, target as StellarObject, ourLongRangeWeaponsDamage, num31) ? determineAngle(num2, num3, self.xpos, self.ypos) : determineAngle(self.xpos, self.ypos, num2, num3);
                        target.xpos += Math.cos(num34) * num33;
                        target.ypos += Math.sin(num34) * num33;
                        weapon.distanceFromTarget = Math.fround(galaxy.calculateDistance(weapon.x, weapon.y, num2, num3));
                    }
                }
                const totalSeconds = (time - weapon.lastFired) / 1000;
                if (totalSeconds > 2.0) weapon.resetNext = true;
                break;
            }
            case ComponentType.WeaponTorpedo:
            case ComponentType.WeaponBombard:
            case ComponentType.WeaponMissile:
            case ComponentType.WeaponSuperTorpedo:
            case ComponentType.WeaponSuperMissile: {
                let num8: number;
                if (weapon.distanceTravelled <= 1) {
                    flag2 = true;
                    num8 = 10;
                } else if (weapon.component.type === ComponentType.WeaponMissile || weapon.component.type === ComponentType.WeaponSuperMissile) {
                    let num13 = Math.fround(weapon.speed);
                    const distanceTravelled = weapon.distanceTravelled;
                    if (distanceTravelled < 120) {
                        const num14 = Math.fround(distanceTravelled / 120);
                        num13 = Math.max(3, Math.fround(num13 * num14));
                    }
                    num8 = Math.fround(num13 * val);
                } else {
                    num8 = Math.fround(Math.fround(weapon.speed) * val);
                }
                const heading = weapon.heading;
                if (!weapon.hasMissed && !isHabitat(target)) {
                    weapon.heading = Math.fround(weapon.headingMissFactor + Math.fround(determineAngle(weapon.x, weapon.y, num2, num3)));
                }
                weapon.distanceTravelled = Math.fround(weapon.distanceTravelled + num8);
                const distanceFromTarget = weapon.distanceFromTarget;
                weapon.x += Math.cos(weapon.heading) * num8;
                weapon.y += Math.sin(weapon.heading) * num8;
                weapon.distanceFromTarget = Math.fround(galaxy.calculateDistance(weapon.x, weapon.y, num2, num3));
                weapon.power = weaponDamageDropoff(self, weapon, num6);
                if (weapon.willHitTarget) {
                    if (!flag2) {
                        let flag4 = false;
                        if (self.inView && weapon.distanceFromTarget <= num5) flag4 = true;
                        else if (distanceFromTarget < weapon.distanceFromTarget || num8 > distanceFromTarget) flag4 = true;
                        if (flag4 && target !== null) {
                            const t = target;
                            if (isHabitat(t) && weapon.bombardDamage > 0) {
                                inflictBombardDamage(galaxy, self, t, weapon.bombardDamage);
                                weapon.target = null;
                            } else if (inflictDamage(galaxy, self, t, weapon, weapon.power, time, weapon.distanceTravelled, weapon.heading)) {
                                target = weaponTarget(weapon);
                                if (isBuiltObject(target)) onWeaponTargetDestroyed(galaxy, self, target);
                                weapon.target = null;
                            }
                            weapon.resetNext = true;
                        }
                    }
                } else if (weapon.hasMissed) {
                    weapon.heading = heading;
                } else if (distanceFromTarget < weapon.distanceFromTarget || num8 > distanceFromTarget) {
                    weapon.hasMissed = true;
                    weapon.heading = heading;
                }
                if (weapon.distanceTravelled > num7) {
                    if (battleStats !== null) battleStats.weaponMissEnemy();
                    if (groupStats !== null) groupStats.weaponMissEnemy();
                    weapon.resetNext = true;
                }
                break;
            }
            case ComponentType.WeaponAreaGravity: {
                let num8: number;
                if (weapon.distanceTravelled <= 1) {
                    flag2 = true;
                    num8 = 2;
                    if (target !== null) {
                        weapon.x = target.xpos;
                        weapon.y = target.ypos;
                    }
                } else {
                    num8 = Math.fround(Math.fround(weapon.speed) * val);
                }
                weapon.distanceTravelled = Math.fround(weapon.distanceTravelled + num8);
                weapon.power = weaponDamageDropoff(self, weapon, num6);
                if (weapon.distanceTravelled > num7) weapon.resetNext = true;
                const num16 = (weapon.damageLoss * weapon.damageLoss) | 0;
                const num17 = (weapon.bombardDamage * weapon.bombardDamage) | 0;
                const galaxyIndex2 = galaxy.resolveIndex(self.xpos, self.ypos);
                const cell2 = galaxy.builtObjectIndexGrid[galaxyIndex2.x][galaxyIndex2.y];
                for (let m = 0; m < cell2.length; m++) {
                    const builtObject4 = cell2[m];
                    if (builtObject4 == null) continue;
                    const num18 = galaxy.calculateDistanceSquared(weapon.x, weapon.y, builtObject4.xpos, builtObject4.ypos);
                    if (num18 < num16 && builtObject4.role !== BuiltObjectRole.Base) {
                        const num19 = Math.min(1.0, Math.max(0.01, 1.0 - num18 / num16));
                        const num20 = timePassed * (weapon.rawDamage * (50.0 / builtObject4.size) * num19);
                        const num21 = determineAngle(builtObject4.xpos, builtObject4.ypos, weapon.x, weapon.y);
                        const num22 = Math.cos(num21) * num20;
                        const num23 = Math.sin(num21) * num20;
                        builtObject4.xpos += num22;
                        builtObject4.ypos += num23;
                        if (builtObject4.parentBuiltObject !== null || builtObject4.parentHabitat !== null) {
                            builtObject4.parentOffsetX += num22;
                            builtObject4.parentOffsetY += num23;
                        }
                    }
                    if (!(num18 < num17)) continue;
                    const num24 = Math.min(1.0, Math.max(0.01, 1.0 - num18 / num17));
                    const num25 = Math.min(60.0, Math.max(20.0, (weapon.rawDamage / (builtObject4.size / 1000.0)) * num24));
                    let num26 = Math.min(1.0, timePassed * num25);
                    if (Math.trunc(time % 1000) % 100 < 50) num26 = 0.0 - num26;
                    builtObject4.xpos += num26;
                    builtObject4.ypos += num26;
                    if (!weapon.resetNext) continue;
                    const hitPower = Math.max(1.0, weapon.rawDamage * num24 * Math.max(0.05, 10.0 / Math.sqrt(builtObject4.size)));
                    if (!inflictDamage(galaxy, self, builtObject4, weapon, hitPower, time, weapon.distanceTravelled, 0.0) || builtObject4 == null) continue;
                    onWeaponTargetDestroyed(galaxy, self, builtObject4);
                }
                break;
            }
            case ComponentType.WeaponIonPulse:
            case ComponentType.WeaponAreaDestruction:
            case ComponentType.WeaponSuperArea: {
                let num8: number;
                if (weapon.distanceTravelled <= 0) {
                    flag2 = true;
                    num8 = 1;
                    if (target !== null) {
                        weapon.x = target.xpos;
                        weapon.y = target.ypos;
                    } else {
                        weapon.x = self.xpos;
                        weapon.y = self.ypos;
                    }
                } else {
                    num8 = Math.fround(Math.fround(weapon.speed) * val);
                }
                if (weapon.distanceTravelled > num7) {
                    weapon.resetNext = true;
                    break;
                }
                const num9 = weapon.distanceTravelled;
                weapon.distanceTravelled = Math.fround(weapon.distanceTravelled + num8);
                weapon.power = weaponDamageDropoff(self, weapon, num6);
                const galaxyIndex = galaxy.resolveIndex(weapon.x, weapon.y);
                const cell = galaxy.builtObjectIndexGrid[galaxyIndex.x][galaxyIndex.y];
                for (let j = 0; j < cell.length; j++) {
                    const bo = cell[j];
                    if (bo == null || bo === self) continue;
                    const num10 = galaxy.calculateDistance(weapon.x, weapon.y, bo.xpos, bo.ypos);
                    if (!(num10 >= num9) || !(num10 < weapon.distanceTravelled)) continue;
                    const strikeAngle = determineAngle(weapon.x, weapon.y, bo.xpos, bo.ypos);
                    if (weapon.component.type === ComponentType.WeaponIonPulse) {
                        inflictIonDamage(galaxy, self, bo, weapon, weapon.power, time, weapon.heading);
                    } else {
                        if (!inflictDamage(galaxy, self, bo, weapon, weapon.power, time, weapon.distanceTravelled, strikeAngle)) continue;
                        const t2 = weaponTarget(weapon);
                        if (!isBuiltObject(t2)) continue;
                        onWeaponTargetDestroyed(galaxy, self, t2);
                    }
                }
                let creatureList: Creature[] | null = null;
                if (self.nearestSystemStar !== null) {
                    if (galaxy.systems.length > self.nearestSystemStar.systemIndex) creatureList = galaxy.systems[self.nearestSystemStar.systemIndex].creatures ?? null;
                } else {
                    const galaxyLocationList = determineGalaxyLocationsInRangeAtPoint(galaxy, self.xpos, self.ypos, self.maximumWeaponsRange, GalaxyLocationType.RestrictedArea);
                    if (galaxyLocationList !== null && galaxyLocationList.length > 0) {
                        creatureList = [];
                        // TODO(port) M4u: GalaxyLocation.RelatedCreatures (not modelled on the TS GalaxyLocation) — the list stays empty.
                    }
                }
                if (creatureList === null || creatureList.length <= 0) break;
                for (let l = 0; l < creatureList.length; l++) {
                    const creature = creatureList[l];
                    if (creature == null) continue;
                    const num12 = galaxy.calculateDistance(weapon.x, weapon.y, creature.xpos, creature.ypos);
                    if (!(num12 >= num9) || !(num12 < weapon.distanceTravelled)) continue;
                    const strikeAngle2 = determineAngle(weapon.x, weapon.y, creature.xpos, creature.ypos);
                    if (weapon.component.type === ComponentType.WeaponIonPulse) {
                        if (creature.type === CreatureType.SilverMist) inflictIonDamage(galaxy, self, creature, weapon, weapon.power, time, weapon.heading);
                    } else {
                        inflictDamage(galaxy, self, creature, weapon, weapon.power, time, weapon.distanceTravelled, strikeAngle2);
                    }
                }
                break;
            }
        }
        if (!self.hasBeenDestroyed && (weapon.component === null || weapon.component.status !== ComponentStatus.Damaged)) continue;
        break;
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Shields (BuiltObject.1.cs 2225, BuiltObject.cs 1930 / 1947)
// ---------------------------------------------------------------------------------------------------------------

/** BuiltObject.1.cs 2225 RechargeShields(timePassed). No Rnd. */
export function rechargeShields(galaxy: Galaxy, builtObject: BuiltObject, timePassed: number): void {
    void galaxy;
    const self = builtObject;
    if (self.currentShields < Math.fround(self.shieldsCapacity)) {
        let num = self.shieldRechargeRate;
        const shipGroup = shipGroupOf(self);
        if (shipGroup !== null) num *= shipGroup.shieldRechargeRateBonus;
        num *= captainShieldRechargeRateBonus(self);
        let num2 = Math.min(num * timePassed, self.shieldsCapacity - self.currentShields);
        if (num2 > self.currentEnergy) num2 = self.currentEnergy;
        if (num2 < 0.0) num2 = 0.0;
        let num3 = num2;
        if (shipGroup !== null) num3 /= shipGroup.shipEnergyUsageBonus;
        num3 /= captainShipEnergyUsageBonus(self);
        self.currentEnergy -= num3;
        self.currentShields = Math.fround(self.currentShields + Math.fround(num2));
    }
    if (self.currentShields < 0) self.currentShields = 0;
    if (self.currentShields > Math.fround(self.shieldsCapacity)) self.currentShields = Math.fround(self.shieldsCapacity);
}

/** BuiltObject.1.cs 1815 CheckForPlanetDestroyerWeaponFiringDelayOnHyperExit(time). No Rnd. */
export function checkForPlanetDestroyerWeaponFiringDelayOnHyperExit(galaxy: Galaxy, builtObject: BuiltObject, time: number): boolean {
    void galaxy;
    if (builtObject.isPlanetDestroyer && builtObject.weapons !== null) {
        const allPlanetDestroyerWeapons = getAllPlanetDestroyerWeapons(builtObject.weapons);
        for (let i = 0; i < allPlanetDestroyerWeapons.length; i++) {
            const weapon = allPlanetDestroyerWeapons[i];
            if (weapon != null) {
                const num = Math.trunc(weapon.fireRate / 1000);
                const seconds = num - 10;
                const dateTime = time - seconds * 1000;
                if (weapon.lastFired < dateTime) weapon.lastFired = dateTime;
            }
        }
        return true;
    }
    return false;
}

/** BuiltObject.cs 1930 CheckShieldAreaRechargeReset(time). No Rnd. */
export function checkShieldAreaRechargeReset(galaxy: Galaxy, builtObject: BuiltObject, time: number): void {
    void galaxy;
    const self = builtObject;
    if (self.shieldAreaRechargeRange > 0 && self.shieldAreaRechargeStartTime > MIN_TIME && self.shieldAreaRechargeTarget !== null) {
        if ((self.shieldAreaRechargeStartTime - time) / 1000 > 3.0) {
            self.shieldAreaRechargeStartTime = MIN_TIME;
            self.shieldAreaRechargeTarget = null;
        } else if (self.shieldAreaRechargeTarget !== null && self.shieldAreaRechargeTarget.currentSpeed >= Math.fround(self.shieldAreaRechargeTarget.warpSpeed) && self.shieldAreaRechargeTarget.warpSpeed > 0) {
            self.shieldAreaRechargeStartTime = MIN_TIME;
            self.shieldAreaRechargeTarget = null;
        }
    }
}

/** BuiltObject.cs 1947 CheckNearbyBuiltObjectsForShieldAreaRecharge(time). Rnd: Next(0, Count) once (the start index). */
export function checkNearbyBuiltObjectsForShieldAreaRecharge(galaxy: Galaxy, builtObject: BuiltObject, time: number): void {
    const self = builtObject;
    if (self.shieldAreaRechargeRange <= 0 || !self.isFunctional || !(self.currentEnergy > Math.trunc(self.reactorStorageCapacity / 3)) || !(self.currentEnergy > Math.trunc(self.shieldAreaRechargeEnergyRequired / 3))) return;
    self.shieldAreaRechargeTarget = null;
    const num = self.shieldAreaRechargeRange * self.shieldAreaRechargeRange;
    const builtObjectsAtLocation = getBuiltObjectsAtLocation(galaxy, self.xpos, self.ypos, self.shieldAreaRechargeRange);
    const num2 = galaxy.rnd.next(0, builtObjectsAtLocation.length);
    let flag = false;
    for (let i = num2; i < builtObjectsAtLocation.length; i++) {
        const bo = builtObjectsAtLocation[i];
        if (bo != null && bo.empire === self.empire && bo.currentShields < Math.fround(bo.shieldsCapacity * 0.67) && bo !== self && bo.currentSpeed < Math.fround(bo.warpSpeed)) {
            const num3 = galaxy.calculateDistanceSquared(self.xpos, self.ypos, bo.xpos, bo.ypos);
            if (num3 <= num) {
                let val = bo.shieldsCapacity - Math.trunc(bo.currentShields);
                val = Math.min(val, self.shieldAreaRechargeCapacity);
                const num4 = Math.trunc(val / self.shieldAreaRechargeCapacity);
                const num5 = self.shieldAreaRechargeEnergyRequired * num4;
                bo.currentShields = Math.fround(bo.currentShields + val);
                self.currentEnergy -= num5;
                self.shieldAreaRechargeTarget = bo;
                self.shieldAreaRechargeStartTime = time;
                flag = true;
                break;
            }
        }
    }
    if (flag) return;
    for (let j = 0; j < num2; j++) {
        const bo2 = builtObjectsAtLocation[j];
        if (bo2 != null && bo2.empire === self.empire && bo2.currentShields < Math.fround(Math.trunc(bo2.shieldsCapacity / 2)) && bo2 !== self) {
            const num6 = galaxy.calculateDistanceSquared(self.xpos, self.ypos, bo2.xpos, bo2.ypos);
            if (num6 <= num) {
                let val2 = bo2.shieldsCapacity - Math.trunc(bo2.currentShields);
                val2 = Math.min(val2, self.shieldAreaRechargeCapacity);
                const num7 = Math.trunc(val2 / self.shieldAreaRechargeCapacity);
                const num8 = self.shieldAreaRechargeEnergyRequired * num7;
                bo2.currentShields = Math.fround(bo2.currentShields + val2);
                self.currentEnergy -= num8;
                self.shieldAreaRechargeTarget = bo2;
                self.shieldAreaRechargeStartTime = time;
                flag = true;
                break;
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Defensive fire (BuiltObject.cs 4448 / 4557), BaconBuiltObject.cs 5032 InterceptMissiles
// ---------------------------------------------------------------------------------------------------------------

/** StellarObject.Attackers typed (BuiltObject / Habitat `attackers: unknown[]`). */
function attackersOf(o: BuiltObject): (StellarObject | FighterTargetLike)[] {
    return (o.attackers ?? []) as (StellarObject | FighterTargetLike)[];
}
function removeFromAttackers(o: BuiltObject, item: unknown): void {
    const attackers = o.attackers;
    if (attackers === null) return;
    const idx = attackers.indexOf(item);
    if (idx >= 0) attackers.splice(idx, 1);
}

/** BuiltObject.cs 4448 DefendShipFromAttackers(time). Rnd: FireWeaponsAtTarget draws. */
export function defendShipFromAttackers(galaxy: Galaxy, builtObject: BuiltObject, time: number): void {
    const self = builtObject;
    if (self.role === BuiltObjectRole.Base || (self.subRole === BuiltObjectSubRole.ResupplyShip && self.isDeployed) || self.firepowerRaw <= 0 || self.attackers === null || self.attackers.length <= 0) return;
    let allWeaponsAssigned = false;
    let num = self.pointDefenseWeaponsRange;
    if (num <= 0) num = self.beamWeaponsMinRange;
    const stellarObjectList: (StellarObject | FighterTargetLike)[] = [];
    const attackers = attackersOf(self);
    for (let i = 0; i < attackers.length; i++) {
        const stellarObject = attackers[i];
        if (stellarObject == null) continue;
        if (stellarObject.hasBeenDestroyed) {
            if (attackers.includes(stellarObject)) removeFromAttackers(self, stellarObject);
            stellarObjectList.push(stellarObject);
        } else if (isFighterTarget(stellarObject) && !allWeaponsAssigned) {
            if (!checkWithinDistancePotentialLocal(num, self.xpos, self.ypos, stellarObject.xpos, stellarObject.ypos)) continue;
            const num2 = galaxy.calculateDistance(self.xpos, self.ypos, stellarObject.xpos, stellarObject.ypos);
            if (!(num2 <= num)) continue;
            let flag = true;
            const fighter = stellarObject;
            if (fighter.empire === self.empire) {
                fighterAbandonAttackTarget(galaxy, fighter);
                flag = false;
            }
            if (flag) {
                const shipGroup = shipGroupOf(self);
                if (shipGroup !== null && shipGroup.battleStats === null) shipGroup.battleStats = new SpaceBattleStats();
                allWeaponsAssigned = fireWeaponsAtFighter(galaxy, self, fighter, time);
            }
        } else {
            if (isFighterTarget(stellarObject) || !checkWithinDistancePotentialLocal(self.maximumWeaponsRange, self.xpos, self.ypos, stellarObject.xpos, stellarObject.ypos)) continue;
            const num3 = galaxy.calculateDistance(self.xpos, self.ypos, stellarObject.xpos, stellarObject.ypos);
            if (!(num3 <= self.maximumWeaponsRange)) continue;
            let flag2 = true;
            if (isBuiltObject(stellarObject)) {
                const bo = stellarObject;
                const mission = builtObjectMission(self.mission);
                if (bo.empire === self.empire || (self.pirateEmpireId > 0 && bo.pirateEmpireId === self.pirateEmpireId)) {
                    clearPreviousMissionRequirements(galaxy, bo);
                    stellarObjectList.push(bo);
                    flag2 = false;
                } else if ((self.currentTarget === bo && mission !== null && (mission.type === BuiltObjectMissionType.Capture || mission.type === BuiltObjectMissionType.Raid)) || (bo.assaultAttackValue > 0 && bo.assaultAttackEmpireId === self.empire!.empireId)) {
                    flag2 = false;
                } else if (self.empire !== null) {
                    if (checkOurEmpireOverwhelmingBoarding(self.empire, bo)) flag2 = false;
                    else if (bo.currentShields < Math.fround(Math.max(15, self.assaultShieldPenetration)) && self.empire !== null && checkOurEmpireBoarding(self.empire, bo, self)) flag2 = false;
                }
            }
            if (flag2) {
                const shipGroup = shipGroupOf(self);
                if (shipGroup !== null && shipGroup.battleStats === null) shipGroup.battleStats = new SpaceBattleStats();
                fireWeaponsAtTarget(galaxy, self, num3, stellarObject as StellarObject, time, false);
            }
        }
    }
    for (let j = 0; j < stellarObjectList.length; j++) removeFromAttackers(self, stellarObjectList[j]);
}

/** Galaxy.cs CheckWithinDistancePotential (bounding box; combat/damage.ts exports the same). */
function checkWithinDistancePotentialLocal(distance: number, x1: number, y1: number, x2: number, y2: number): boolean {
    return Math.abs(x1 - x2) <= distance && Math.abs(y1 - y2) <= distance;
}

/** BuiltObject.cs 4557 DefendBase(time). Rnd: FireWeaponsAtTarget / assault pod / fighter draws. */
export function defendBase(galaxy: Galaxy, builtObject: BuiltObject, time: number): void {
    const self = builtObject;
    let hyperDenyActive = false;
    let flag = false;
    if (self.role !== BuiltObjectRole.Base && (self.subRole !== BuiltObjectSubRole.ResupplyShip || !self.isDeployed)) return;
    const threats = (self.threats ?? []) as (StellarObject | FighterTargetLike | null)[];
    if ((self.firepowerRaw > 0 || self.fighterCapacity > 0) && self.threats !== null && threats.length > 0) {
        let allWeaponsAssigned = false;
        let num = self.pointDefenseWeaponsRange;
        if (num <= 0) num = self.beamWeaponsMinRange;
        for (let i = 0; i < threats.length; i++) {
            const stellarObject = threats[i];
            if (stellarObject == null) continue;
            if (isFighterTarget(stellarObject) && !allWeaponsAssigned) {
                if (stellarObject.parentBuiltObject === null || !shouldAttack(galaxy, self, stellarObject.parentBuiltObject, time, false)) continue;
                flag = true;
                if (checkWithinDistancePotentialLocal(num, self.xpos, self.ypos, stellarObject.xpos, stellarObject.ypos)) {
                    const num2 = galaxy.calculateDistance(self.xpos, self.ypos, stellarObject.xpos, stellarObject.ypos);
                    if (num2 <= num) {
                        const fighter = stellarObject;
                        allWeaponsAssigned = fireWeaponsAtFighter(galaxy, self, fighter, time);
                    }
                }
            } else {
                if (isFighterTarget(stellarObject) || !shouldAttack(galaxy, self, stellarObject, time)) continue;
                hyperDenyActive = true;
                flag = true;
                let num3 = self.maximumWeaponsRange;
                let builtObjectMissionType = BuiltObjectMissionType.Attack;
                let bo: BuiltObject | null = null;
                if (isBuiltObject(stellarObject)) {
                    bo = stellarObject;
                    builtObjectMissionType = determineDestroyOrCaptureTarget(galaxy, self.empire!, self, bo, false);
                    if (builtObjectMissionType === BuiltObjectMissionType.Capture) num3 = Math.max(num3, self.assaultRange);
                }
                if (checkWithinDistancePotentialLocal(num3, self.xpos, self.ypos, stellarObject.xpos, stellarObject.ypos)) {
                    const num4 = galaxy.calculateDistance(self.xpos, self.ypos, stellarObject.xpos, stellarObject.ypos);
                    if (num4 <= num3) {
                        if (builtObjectMissionType === BuiltObjectMissionType.Capture) {
                            if (bo!.currentShields < Math.fround(self.assaultShieldPenetration)) {
                                const num5 = calculateAvailableAssaultPodAttackStrength(galaxy, self, time);
                                if (num5 > 0) {
                                    let num6 = 0;
                                    if (self.currentShields < Math.fround(Math.trunc(self.shieldsCapacity / 2)) && self.attackers !== null && self.attackers.length > 0) {
                                        num6 = totalMobileMilitaryFirepower(self.attackers);
                                    }
                                    if (num6 < Math.trunc(self.firepowerRaw / 2)) checkLaunchAssaultPodsAtTarget(galaxy, self, time, bo!);
                                }
                            } else {
                                fireWeaponsAtTarget(galaxy, self, num4, stellarObject, time, false);
                            }
                        } else {
                            fireWeaponsAtTarget(galaxy, self, num4, stellarObject, time, false);
                        }
                    }
                }
                if (!isBuiltObject(stellarObject) || allWeaponsAssigned) continue;
                bo = stellarObject;
                const fighters = bo.fighters as FighterTargetLike[] | null;
                if (fighters === null || fighters.length <= 0) continue;
                for (let j = 0; j < fighters.length; j++) {
                    const fighter2 = fighters[j];
                    if (!fighter2.onboardCarrier && !fighter2.hasBeenDestroyed && checkWithinDistancePotentialLocal(num, self.xpos, self.ypos, fighter2.xpos, fighter2.ypos)) {
                        const num7 = galaxy.calculateDistance(self.xpos, self.ypos, fighter2.xpos, fighter2.ypos);
                        if (num7 <= num) allWeaponsAssigned = fireWeaponsAtFighter(galaxy, self, fighter2, time);
                    }
                }
            }
        }
    }
    if (self.attackers !== null && self.attackers.length > 0) {
        const attackers = attackersOf(self);
        const stellarObjectList: (StellarObject | FighterTargetLike)[] = [];
        for (let k = 0; k < attackers.length; k++) {
            const a = attackers[k];
            const aEmpire = isFighterTarget(a) ? a.empire : stellarEmpire(a);
            if (a.hasBeenDestroyed || aEmpire === self.empire || (self.pirateEmpireId > 0 && isBuiltObject(a) && a.pirateEmpireId === self.pirateEmpireId)) stellarObjectList.push(a);
        }
        for (let l = 0; l < stellarObjectList.length; l++) removeFromAttackers(self, stellarObjectList[l]);
    }
    if (flag) launchAllFighters(galaxy, self);
    self.hyperDenyActive = hyperDenyActive;
}

/** BaconBuiltObject.cs 5032 InterceptMissiles(ship, time, inView). Rnd: Fire draws (NextDouble, Next(0, 2)) per interception. */
export function interceptMissiles(galaxy: Galaxy, builtObject: BuiltObject, time: number, inView: boolean): void {
    const ship = builtObject;
    if (!POINT_DEFENSE_AFFECTS_MISSILES) return;
    if (ship.assaultPodFiringCounter >= 32766) ship.assaultPodFiringCounter = 0;
    ++ship.assaultPodFiringCounter;
    if (inView && ship.assaultPodFiringCounter % 5 !== 0) return;
    const attackers = attackersOf(ship);
    for (let index1 = 0; index1 < attackers.length; ++index1) {
        const attacker = attackers[index1];
        if (attacker != null && isBuiltObject(attacker)) {
            const bo = attacker;
            if (bo.weapons !== null) {
                for (let index2 = 0; index2 < bo.weapons.length; ++index2) {
                    const weapon1 = bo.weapons[index2];
                    if (weapon1 != null && weapon1.component !== null && weapon1.component.type === ComponentType.WeaponMissile && weapon1.distanceTravelled >= 100.0 && weapon1.target !== null && weapon1.target === ship && ship.weapons !== null) {
                        for (let index3 = 0; index3 < ship.weapons.length; ++index3) {
                            const weapon2 = ship.weapons[index3];
                            if (
                                weapon2.component.type !== ComponentType.AssaultPod &&
                                weapon2 != null &&
                                weapon2.component !== null &&
                                (weapon2.component.type === ComponentType.WeaponPointDefense || weapon2.component.type === ComponentType.WeaponBeam || weapon2.component.type === ComponentType.WeaponPhaser || weapon2.component.type === ComponentType.WeaponRailGun) &&
                                weapon1.distanceFromTarget <= weapon2.range &&
                                weaponIsAvailable(weapon2, ship, time)
                            ) {
                                const hitRangeChance = 0.5;
                                const willHit = true;
                                weaponFireAtWeapon(galaxy, weapon2, ship, weapon1, weapon1.distanceFromTarget, time, willHit, hitRangeChance);
                                // (the intercept Animation is UI only)
                                weapon1.reset();
                                break;
                            }
                        }
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Habitat.cs 2225-2460 / 2640-2760: the giant ion cannon
// ---------------------------------------------------------------------------------------------------------------

/** Habitat.cs 2225 CheckIonCannonReadyToFire(time). */
export function checkIonCannonReadyToFire(habitat: Habitat, time: number): boolean {
    const giantIonCannon = giantIonCannonOf(habitat)!;
    const totalMilliseconds = time - giantIonCannon.lastFired;
    return totalMilliseconds >= giantIonCannon.fireRate;
}

/** Habitat.cs 2235 CheckTargetInRange(target, out distanceToTarget). */
export function checkTargetInRange(galaxy: Galaxy, habitat: Habitat, target: StellarObject): { inRange: boolean; distanceToTarget: number } {
    const giantIonCannon = giantIonCannonOf(habitat)!;
    const distanceToTarget = galaxy.calculateDistance(habitat.xpos, habitat.ypos, target.xpos, target.ypos);
    return { inRange: distanceToTarget <= giantIonCannon.range, distanceToTarget };
}

/** Habitat.cs 2431 DetermineHitTarget(galaxy, weapon, target, distanceToTarget, out hitRangeChance). Rnd: NextDouble. */
export function habitatDetermineHitTarget(galaxy: Galaxy, habitat: Habitat, weapon: Weapon, target: StellarObject | FighterTargetLike, distanceToTarget: number): { willHit: boolean; hitRangeChance: number } {
    void habitat;
    const hitRangeChance = Math.max(0.0, (weapon.range - distanceToTarget) / weapon.range);
    let val = 20.0 / Math.max(1.0, targetCurrentSpeed(target));
    val = Math.max(0.5, Math.min(val, 5.0));
    if (isFighterTarget(target)) val = weapon.component.type !== ComponentType.WeaponPointDefense ? val / 1.3 : val * 1.1;
    let num = 0.0;
    if (isBuiltObject(target)) {
        num = target.countermeasureModifier + target.fleetCountermeasureBonus;
    } else if (isFighterTarget(target)) {
        num = target.specification.countermeasureModifier;
        if (target.parentBuiltObject !== null && !target.parentBuiltObject.hasBeenDestroyed) num += target.parentBuiltObject.fleetCountermeasureBonus;
    }
    const num2 = num / 100.0;
    const num3 = val * (hitRangeChance + galaxy.rnd.nextDouble() + num2);
    return { willHit: num3 > 0.5, hitRangeChance };
}

/** Habitat.cs 2416 FireWeaponsAtTarget(distanceToTarget, target, time). Rnd: NextDouble (jitter); when firing DetermineHitTarget + Fire draws. */
export function habitatFireWeaponsAtTarget(galaxy: Galaxy, habitat: Habitat, distanceToTarget: number, target: StellarObject, time: number): void {
    const giantIonCannon = giantIonCannonOf(habitat);
    if (habitat.giantIonCannonPresent && giantIonCannon !== null && !target.hasBeenDestroyed && giantIonCannon.distanceTravelled < 0 && giantIonCannon.range >= distanceToTarget) {
        const timeSpanMs = galaxy.nowMs - giantIonCannon.lastFired;
        const num = galaxy.rnd.nextDouble() * 500.0 - 250.0;
        if (timeSpanMs >= giantIonCannon.fireRate + num) {
            const r = habitatDetermineHitTarget(galaxy, habitat, giantIonCannon, target, distanceToTarget);
            weaponFire(galaxy, giantIonCannon, habitat, target, distanceToTarget, time, r.willHit, r.hitRangeChance);
        }
    }
}

/** Habitat.cs 2707 ShouldAttack(target). */
export function habitatShouldAttack(habitat: Habitat, target: BuiltObject): boolean {
    const empire = habitat.empire;
    if (empire === null || habitat.population === null) return false;
    if (empire === target.empire || target.empire === null) return false;
    if (target.empire.pirateEmpireBaseHabitat !== null && obtainPirateRelation(target.empire, empire).type === PirateRelationType.Protection) return false;
    const outlaws = empire.outlaws as BuiltObject[];
    if (outlaws.includes(target)) {
        if (empire === target.empire) {
            outlaws.splice(outlaws.indexOf(target), 1);
            return false;
        }
        return true;
    }
    if (habitat.attackers !== null && habitat.attackers.includes(target)) return true;
    if (target.empire.pirateEmpireBaseHabitat !== null) return true;
    const diplomaticRelation = empire.diplomaticRelations.byEmpire(target.empire);
    if (diplomaticRelation !== null) {
        if (diplomaticRelation.type === DiplomaticRelationType.War) return true;
        return false;
    }
    return false;
}

/** Habitat.cs 2640 AttackEnemyTargets(time): the giant ion cannon picks the first threat / creature in range. */
export function attackEnemyTargets(galaxy: Galaxy, habitat: Habitat, time: number): void {
    if (!habitat.giantIonCannonPresent || giantIonCannonOf(habitat) === null || !checkIonCannonReadyToFire(habitat, time)) return;
    if (habitat.empire !== null && habitat.empire.systemVisibility !== null) {
        const threats = habitat.empire.systemVisibility[habitat.systemIndex].threats;
        if (threats !== null) {
            for (let i = 0; i < threats.length; i++) {
                const bo = threats[i];
                if (bo != null && habitatShouldAttack(habitat, bo)) {
                    const r = checkTargetInRange(galaxy, habitat, bo);
                    if (r.inRange) {
                        habitatFireWeaponsAtTarget(galaxy, habitat, r.distanceToTarget, bo, time);
                        break;
                    }
                }
            }
        }
    }
    const creatures = galaxy.systems[habitat.systemIndex].creatures ?? null;
    if (creatures === null || creatures.length <= 0) return;
    for (let j = 0; j < creatures.length; j++) {
        const creature = creatures[j];
        if (creature != null) {
            const r2 = checkTargetInRange(galaxy, habitat, creature);
            if (r2.inRange) {
                habitatFireWeaponsAtTarget(galaxy, habitat, r2.distanceToTarget, creature, time);
                break;
            }
        }
    }
}

/** Habitat.cs 2267 HandleWeaponsFiring(timePassed, time, galaxy): advance the giant ion cannon blast. No Rnd here (InflictIonDamage draws). */
export function handleWeaponsFiringHabitat(galaxy: Galaxy, habitat: Habitat, timePassed: number, time: number): void {
    const giantIonCannon = giantIonCannonOf(habitat);
    if (giantIonCannon === null) return;
    const target = weaponTarget(giantIonCannon);
    if (giantIonCannon.resetNext) {
        giantIonCannon.reset();
    } else if (target === null && giantIonCannon.targetWeapon === null) {
        giantIonCannon.resetNext = true;
    } else if (target !== null && stellarHasBeenDestroyed(target)) {
        giantIonCannon.resetNext = true;
    } else if (giantIonCannon.targetWeapon !== null && giantIonCannon.targetWeapon.distanceTravelled <= 0) {
        giantIonCannon.resetNext = true;
    } else {
        if (!(giantIonCannon.distanceTravelled >= 0)) return;
        let val = Math.fround((galaxy.nowMs - giantIonCannon.lastFired) / 1000);
        val = Math.min(val, Math.fround(timePassed));
        let flag = false;
        const type = giantIonCannon.component.type;
        if (type !== ComponentType.WeaponIonCannon) return;
        let num: number;
        if (giantIonCannon.distanceTravelled <= 1) {
            flag = true;
            num = 2;
        } else {
            num = Math.fround(Math.fround(giantIonCannon.speed) * val);
        }
        giantIonCannon.distanceTravelled = Math.fround(giantIonCannon.distanceTravelled + num);
        const distanceFromTarget = giantIonCannon.distanceFromTarget;
        giantIonCannon.x += Math.cos(giantIonCannon.heading) * num;
        giantIonCannon.y += Math.sin(giantIonCannon.heading) * num;
        giantIonCannon.distanceFromTarget = Math.fround(galaxy.calculateDistance(giantIonCannon.x, giantIonCannon.y, target!.xpos, target!.ypos));
        giantIonCannon.power = Math.fround(Math.fround(giantIonCannon.rawDamage) - Math.fround(Math.fround(giantIonCannon.distanceTravelled / 100) * Math.fround(giantIonCannon.damageLoss)));
        if (giantIonCannon.willHitTarget && !flag) {
            let flag2 = false;
            if (distanceFromTarget < giantIonCannon.distanceFromTarget) flag2 = true;
            if (flag2) {
                if (giantIonCannon.component.type === ComponentType.WeaponIonCannon) {
                    const t = weaponTarget(giantIonCannon);
                    if (t !== null && stellarHasBeenDestroyed(t)) giantIonCannon.target = null;
                    else habitatInflictIonDamage(galaxy, habitat, t as StellarObject, giantIonCannon.power, time, giantIonCannon.heading);
                }
                giantIonCannon.resetNext = true;
            }
        }
        if (giantIonCannon.distanceTravelled > Math.fround(giantIonCannon.range)) giantIonCannon.resetNext = true;
    }
}
