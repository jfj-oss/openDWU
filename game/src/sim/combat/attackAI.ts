// M4n — ship attack AI and attack ranges (tasks/M4-plan.md §3.3 row M4n).
//
// Ports, in this file:
// - BuiltObject.1.cs 951/956 ShouldAttack, 1185 CheckForAttack, 1689 ShouldCounterAttack, 1772 CheckForHyperExitGravityWell,
//   1852 CheckForRandomAttackTargets, 795 DetermineTacticsAgainstTarget, 3314 CalculateAvailableAssaultPodAttackStrength,
//   3394/3399 CalculateBoardingDefenseValue;
// - BuiltObject.2.cs 103 DetermineTargetSpeed, 117 SetOptimalAttackRangesBoarding, 126/131 SetOptimalAttackRanges,
//   197/205 ModifyAttackRangeByTargetSpeed, 314 CheckColonyShipMissionCancelled, 7734 SetAttackRangeWhenNoMission;
// - BaconBuiltObject.cs 2578 CheckNearTarget;
// - Empire.2.cs 16/37 DetermineDestroyOrCaptureTarget, 142 CheckOurEmpireOverwhelmingBoarding, 155/160 CheckOurEmpireBoarding
//   (shared helpers no other package owns; C# `this` = the empire, first argument);
// - Galaxy.7.cs 2942 CheckForMatchingSignalSameTargetType, 2987/3058 NotifyOfAttack, 295 DetermineSpacePortAtColony,
//   4308 DetermineAngle; Galaxy.4.cs 1797 ResolveTechBonusFactor; Galaxy.8.cs 2572 CanDestroyHabitat;
//   Weapon.cs 181 IsAvailableWithoutEnergyConsideration (a pure predicate; Weapon.Fire itself is M4o).
// Galaxy.Rnd: none in this file.

import type { Galaxy } from '../galaxy';
import type { BuiltObject } from '../builtObject';
import type { Empire } from '../empire';
import type { Habitat } from '../types';
import { HabitatCategoryType } from '../types';
import type { Weapon } from '../weapon';
import { CreatureType, resolveCreatureDescription } from '../creature';
import { gameText } from '../colonyTick';
import { BattleTactics, BuiltObjectRole } from '../data/designSpecifications';
import { BuiltObjectSubRole } from '../builtObjectTypes';
import { BuiltObjectStance } from '../design';
import { ComponentType } from '../data/components';
import { ComponentCategoryType } from '../data/policies';
import { ComponentStatus } from '../builtObjectComponent';
import { researchComponentTechPoints, resolveSubRoleDescription } from '../designGeneration';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../diplomacy';
import { PirateRelationType, obtainPirateRelation } from '../pirateRelations';
import { checkSystemOwnership } from '../stationPlacement';
import { EmpireMessageType, sendMessageToEmpire } from '../messages';
import { galaxyStarDate } from '../tick/simTime';
import { PreWarpProgressEventType } from '../exploration';
import { checkSendPreWarpProgressEventMessage } from '../events';
import { DISTRESS_SIGNAL_DATE_RANGE, DistressSignal, DistressSignalType, empireDistressSignals } from '../missions/distress';
import { BuiltObjectMission, BuiltObjectMissionPriority, BuiltObjectMissionType, CommandAction, builtObjectMission, isBuiltObject, isCreature, isHabitat, isShipGroup, type StellarObject } from '../missions/mission';
import { assignMission, clearPreviousMissionRequirements, recordRevertMission } from '../missions/assign';
import { baconMovementSettings, withinFuelRangeAndRefuel } from '../movement';
import { isFighter } from './fighters';
import { shipGroupOf, stellarAttackers, stellarCurrentSpeed, stellarCurrentTarget, stellarFirepowerRaw, stellarTopSpeed, builtObjectThreats, calculateOverallStrengthFactor, evaluateThreats, getBuiltObjectsAtLocationByArrays, shouldFleeFrom, type Threat } from './threats';

// ---------------------------------------------------------------------------------------------------------------
// Galaxy constants (Galaxy.3.cs static ctor)
// ---------------------------------------------------------------------------------------------------------------

/** Galaxy.InvasionDropoffRange = 15 / MovementDecelerationRangeInvasion = 50 / MovementImpulseSpeed = 3 (4981-4984). */
export const INVASION_DROPOFF_RANGE = 15;
export const MOVEMENT_DECELERATION_RANGE_INVASION = 50;
export const MOVEMENT_IMPULSE_SPEED = 3;
/** Galaxy.PointBlankWeaponsRange = 50 (5055). */
export const POINT_BLANK_WEAPONS_RANGE = 50;
/** Galaxy.DistressSignalLocationOverlapRangeSquared = 1000000.0 (5048). */
export const DISTRESS_SIGNAL_LOCATION_OVERLAP_RANGE_SQUARED = 1000000.0;

/** Galaxy.7.cs 4308 static DetermineAngle(x1, y1, x2, y2). */
export function determineAngle(x1: number, y1: number, x2: number, y2: number): number {
    let num = Math.atan2(y2 - y1, x2 - x1);
    if (Number.isNaN(num)) {
        num = 0.0;
    }
    return num;
}

/** Galaxy.8.cs 2572 CanDestroyHabitat(builtObject, habitat). */
export function canDestroyHabitat(galaxy: Galaxy, builtObject: BuiltObject, habitat: Habitat): boolean {
    void galaxy;
    switch (habitat.category) {
        case HabitatCategoryType.Star:
        case HabitatCategoryType.GasCloud:
            return false;
        case HabitatCategoryType.Planet:
        case HabitatCategoryType.Moon:
        case HabitatCategoryType.Asteroid:
            if (builtObject.isPlanetDestroyer && habitat.diameter <= 400) {
                return true;
            }
            break;
    }
    return false;
}

/** Galaxy.7.cs 295 DetermineSpacePortAtColony(colony). */
export function determineSpacePortAtColony(galaxy: Galaxy, colony: Habitat): BuiltObject | null {
    if (colony.empire !== null && colony.empire !== galaxy.independentEmpire) {
        for (let i = 0; i < colony.empire.spacePorts.length; i++) {
            const builtObject = colony.empire.spacePorts[i];
            if (builtObject != null && builtObject.parentHabitat === colony) {
                return builtObject;
            }
        }
    }
    return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Boarding values (BuiltObject.1.cs 3314-3470, Empire.2.cs 16-200)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Weapon.cs 181 IsAvailableWithoutEnergyConsideration(time): DistanceTravelled < 0 && LastFired + FireRate ms <= time.
 * Weapon.lastFired is kept in game ms by the M4o firing code (MIN_TIME = never fired: DateTime.MinValue + FireRate <= any time).
 */
export function weaponIsAvailableWithoutEnergyConsideration(weapon: Weapon, time: number): boolean {
    return weapon.distanceTravelled < 0.0 && weapon.lastFired + weapon.fireRate <= time;
}

/** Empire.RaidStrengthFactor (Empire.cs 431, default 1.0; TODO(port) M4s: pirate faction modifiers set it). */
function empireRaidStrengthFactor(empire: Empire): number {
    return (empire as Empire & { raidStrengthFactor?: number }).raidStrengthFactor ?? 1.0;
}

/** BuiltObject.1.cs 3314 CalculateAvailableAssaultPodAttackStrength(time). */
export function calculateAvailableAssaultPodAttackStrength(galaxy: Galaxy, bo: BuiltObject, time: number): number {
    void galaxy;
    let num = 0;
    if (bo.assaultRange > 0 && bo.assaultStrength > 0 && bo.weapons !== null) {
        let num2 = 1.0;
        let num3 = 1.0;
        if (bo.empire !== null) {
            num3 = bo.empire.boardingAttackFactor;
            num3 *= empireRaidStrengthFactor(bo.empire);
            if (bo.empire.dominantRace !== null) {
                num2 = bo.empire.dominantRace.troopStrength / 100.0;
            }
        }
        for (let i = 0; i < bo.weapons.length; i++) {
            const weapon = bo.weapons[i];
            if (weapon != null && weapon.component != null && weapon.component.type === ComponentType.AssaultPod && weaponIsAvailableWithoutEnergyConsideration(weapon, time)) {
                num += Math.trunc(weapon.rawDamage * num2 * num3);
            }
        }
    }
    return num;
}

/** BuiltObject.1.cs 3394/3399 CalculateBoardingDefenseValue(time[, includeAllAssaultPods], out fixedDefenseValue). */
export function calculateBoardingDefenseValue(galaxy: Galaxy, bo: BuiltObject, time: number, includeAllAssaultPods = false): { value: number; fixedDefenseValue: number } {
    void galaxy;
    let num = 0;
    let fixedDefenseValue = 0;
    let num2 = 1.0;
    let num3 = 1.0;
    if (bo.empire !== null) {
        num3 = bo.empire.boardingDefenseFactor;
        num3 *= empireRaidStrengthFactor(bo.empire);
        if (bo.empire.dominantRace !== null) {
            num2 = bo.empire.dominantRace.troopStrength / 100.0;
        }
    }
    if (bo.components !== null) {
        for (let i = 0; i < bo.components.count; i++) {
            const builtObjectComponent = bo.components.items[i];
            if (builtObjectComponent == null) {
                continue;
            }
            const type = builtObjectComponent.type;
            if (type === ComponentType.HabitationHabModule) {
                const num4 = Math.trunc(20.0 * num2 * num3);
                if (builtObjectComponent.status === ComponentStatus.Normal) {
                    num += num4;
                }
                fixedDefenseValue += num4;
            }
        }
    }
    if (bo.weapons !== null) {
        for (let j = 0; j < bo.weapons.length; j++) {
            const weapon = bo.weapons[j];
            if (weapon != null && weapon.component != null && weapon.component.type === ComponentType.AssaultPod && (includeAllAssaultPods || weaponIsAvailableWithoutEnergyConsideration(weapon, time))) {
                num += Math.trunc(weapon.rawDamage * num2 * num3);
            }
        }
    }
    if (bo.troops !== null) {
        for (let k = 0; k < bo.troops.count; k++) {
            const troop = bo.troops.items[k];
            if (troop != null) {
                const num5 = Math.trunc((troop.overallDefendStrength / 100.0) * num3);
                num += num5;
                fixedDefenseValue += num5;
            }
        }
    }
    return { value: num, fixedDefenseValue };
}

/** Empire.2.cs 142 CheckOurEmpireOverwhelmingBoarding(target). */
export function checkOurEmpireOverwhelmingBoarding(empire: Empire, target: BuiltObject | null): boolean {
    if (target !== null && target.assaultAttackValue > 0 && target.assaultAttackEmpireId === empire.empireId) {
        const num = Math.fround(Math.fround(target.assaultAttackValue) / Math.fround(target.assaultDefenseValue));
        if (num > 2) {
            return true;
        }
    }
    return false;
}

/** Empire.2.cs 155/160 CheckOurEmpireBoarding(target[, builtObjectToExclude]). */
export function checkOurEmpireBoarding(empire: Empire, target: BuiltObject, builtObjectToExclude: BuiltObject | null = null): boolean {
    if (target !== null && target.assaultAttackValue > 0 && target.assaultAttackEmpireId === empire.empireId) {
        return true;
    }
    const threats = target.threats;
    if (threats !== null && threats.length > 0) {
        for (let i = 0; i < threats.length; i++) {
            const stellarObject = threats[i];
            if (stellarObject === null || !isBuiltObject(stellarObject)) {
                continue;
            }
            const builtObject = stellarObject;
            if (builtObject === null || builtObject.hasBeenDestroyed || builtObject.empire !== empire) {
                continue;
            }
            if (builtObjectToExclude === null || builtObject !== builtObjectToExclude) {
                const mission = builtObjectMission(builtObject.mission);
                if (mission !== null && mission.type === BuiltObjectMissionType.Capture && mission.targetBuiltObject === target) {
                    return true;
                }
            }
            if (builtObject.assaultStrength <= 0 || builtObject.assaultRange <= 0 || builtObject.weapons === null) {
                continue;
            }
            for (let j = 0; j < builtObject.weapons.length; j++) {
                const weapon = builtObject.weapons[j];
                if (weapon != null && weapon.component != null && weapon.component.type === ComponentType.AssaultPod && weapon.target !== null && weapon.target === target) {
                    return true;
                }
            }
        }
    }
    return false;
}

/**
 * Galaxy.4.cs 1797 static ResolveTechBonusFactor(empire, galaxy, builtObject); 1805 num3 = galaxy.BaseTechCost.
 */
export function resolveTechBonusFactor(empire: Empire | null, galaxy: Galaxy, builtObject: BuiltObject): number {
    let result = 1.0;
    let num = 0;
    let num2 = 0.0;
    const minTable = researchComponentTechPoints(galaxy).min;
    for (let i = 0; i < builtObject.components.count; i++) {
        const component = builtObject.components.items[i];
        // ResearchSystem.GetMinTechPoints(component): ComponentMinTechPoints[ComponentID] or 0.
        const minTechPoints = minTable.length > component.def.componentId ? minTable[component.def.componentId] : 0;
        let num3 = galaxy.baseTechCost;
        if (empire !== null && empire.research !== null && empire.research.checkComponentResearched(component.def)) {
            num3 = minTechPoints;
        }
        let val = minTechPoints / num3;
        val = Math.max(1.0, val);
        val -= 1.0;
        if (val > 0.0) {
            num2 += component.size * val;
            num += component.size;
        }
    }
    if (num2 > 0.0) {
        result = 1.0 + num2 / num;
    }
    return result;
}

/** Galaxy.CheckSystemOwnershipId(systemStar) (Galaxy.cs 3597): owner empire id, or -1. */
export function checkSystemOwnershipId(galaxy: Galaxy, systemStar: Habitat | null): number {
    if (systemStar !== null) {
        const own = checkSystemOwnership(galaxy, systemStar);
        return own.empire !== null ? own.empire.empireId : -1;
    }
    return -1;
}

/** Empire.2.cs 37 DetermineDestroyOrCaptureTarget(assaultStrength, attackingOverallStrength, attackingEmpire, target, attackingAsGroup, builtObjectToExclude). */
export function determineDestroyOrCaptureTargetCore(galaxy: Galaxy, empire: Empire, assaultStrength: number, attackingOverallStrength: number, attackingEmpire: Empire | null, target: BuiltObject | null, attackingAsGroup: boolean, builtObjectToExclude: BuiltObject | null): BuiltObjectMissionType {
    void attackingOverallStrength;
    if (target !== null && attackingEmpire !== null) {
        if (assaultStrength > 0) {
            let flag = false;
            const num = calculateBoardingDefenseValue(galaxy, target, galaxy.nowMs).value;
            if (num <= assaultStrength || attackingAsGroup) {
                flag = true;
            }
            if (target.role === BuiltObjectRole.Base) {
                const num2 = checkSystemOwnershipId(galaxy, target.nearestSystemStar);
                if ((target.subRole === BuiltObjectSubRole.SmallSpacePort || target.subRole === BuiltObjectSubRole.MediumSpacePort || target.subRole === BuiltObjectSubRole.LargeSpacePort || target.subRole === BuiltObjectSubRole.DefensiveBase || target.subRole === BuiltObjectSubRole.EnergyResearchStation || target.subRole === BuiltObjectSubRole.HighTechResearchStation || target.subRole === BuiltObjectSubRole.WeaponsResearchStation) && target.parentHabitat !== null && target.parentHabitat.empire !== null) {
                    return BuiltObjectMissionType.Attack;
                }
                if (checkOurEmpireBoarding(empire, target, builtObjectToExclude)) {
                    return BuiltObjectMissionType.Capture;
                }
                if (empire !== galaxy.playerEmpire && target.unbuiltComponentCount > 0) {
                    const num3 = target.unbuiltComponentCount / target.components.count;
                    if (num3 > 0.25) {
                        return BuiltObjectMissionType.Attack;
                    }
                }
                switch (empire.policy!.captureTargetConditionBase) {
                    case 0:
                        return BuiltObjectMissionType.Attack;
                    case 1:
                        if (flag && num2 === attackingEmpire.empireId) {
                            return BuiltObjectMissionType.Capture;
                        }
                        break;
                    case 2:
                        if (flag && (num2 === attackingEmpire.empireId || num2 < 0)) {
                            return BuiltObjectMissionType.Capture;
                        }
                        break;
                    case 3:
                        if (flag) {
                            return BuiltObjectMissionType.Capture;
                        }
                        break;
                    case 4:
                        return BuiltObjectMissionType.Capture;
                }
            } else {
                if (checkOurEmpireBoarding(empire, target, builtObjectToExclude)) {
                    return BuiltObjectMissionType.Capture;
                }
                if (builtObjectToExclude !== null && builtObjectToExclude.role === BuiltObjectRole.Base) {
                    const num4 = galaxy.calculateDistanceSquared(builtObjectToExclude.xpos, builtObjectToExclude.ypos, target.xpos, target.ypos);
                    if (num4 > builtObjectToExclude.assaultRange * builtObjectToExclude.assaultRange) {
                        return BuiltObjectMissionType.Attack;
                    }
                }
                if (target.warpSpeed <= 0 && empire.policy!.captureTargetConditionShip < 2) {
                    return BuiltObjectMissionType.Attack;
                }
                switch (empire.policy!.captureTargetConditionShip) {
                    case 0:
                        return BuiltObjectMissionType.Attack;
                    case 1:
                        if (flag && (target.size > empire.maximumConstructionSize(target.subRole) || resolveTechBonusFactor(empire, galaxy, target) > 1.0)) {
                            return BuiltObjectMissionType.Capture;
                        }
                        break;
                    case 2:
                        if (flag) {
                            return BuiltObjectMissionType.Capture;
                        }
                        break;
                    case 3:
                        return BuiltObjectMissionType.Capture;
                }
            }
        } else if (checkOurEmpireBoarding(empire, target, builtObjectToExclude)) {
            return BuiltObjectMissionType.Capture;
        }
    }
    return BuiltObjectMissionType.Attack;
}

/** Empire.2.cs 16 DetermineDestroyOrCaptureTarget(attacker, target, attackingAsGroup). */
export function determineDestroyOrCaptureTarget(galaxy: Galaxy, empire: Empire, attacker: BuiltObject | null, target: BuiltObject, attackingAsGroup: boolean): BuiltObjectMissionType {
    if (attacker !== null) {
        return determineDestroyOrCaptureTargetCore(galaxy, empire, calculateAvailableAssaultPodAttackStrength(galaxy, attacker, galaxy.nowMs), calculateOverallStrengthFactor(attacker), attacker.empire, target, attackingAsGroup, attacker);
    }
    return BuiltObjectMissionType.Attack;
}

// ---------------------------------------------------------------------------------------------------------------
// Distress signals from attacks (Galaxy.7.cs 2942 / 2987 / 3058)
// ---------------------------------------------------------------------------------------------------------------

/** Galaxy.7.cs 2942 CheckForMatchingSignalSameTargetType(targetEmpire, attacker, target, type). */
export function checkForMatchingSignalSameTargetType(galaxy: Galaxy, targetEmpire: Empire | null, attacker: Empire | null, target: BuiltObject | Habitat | null, type: DistressSignalType): DistressSignal | null {
    const currentStarDate = galaxyStarDate(galaxy);
    if (target !== null && targetEmpire !== null && targetEmpire.distressSignals !== null) {
        const signals = empireDistressSignals(targetEmpire);
        for (let i = 0; i < signals.length; i++) {
            const distressSignal = signals[i];
            if (distressSignal == null || distressSignal.type !== type || distressSignal.attacker !== attacker || distressSignal.date <= currentStarDate - DISTRESS_SIGNAL_DATE_RANGE) {
                continue;
            }
            let flag = false;
            let x = 0.0;
            let y = 0.0;
            const source = distressSignal.source;
            if (isBuiltObject(target)) {
                if (source !== null && isBuiltObject(source)) {
                    x = source.xpos;
                    y = source.ypos;
                    flag = true;
                }
            } else if (isHabitat(target) && source !== null && isHabitat(source)) {
                x = source.xpos;
                y = source.ypos;
                flag = true;
            }
            if (flag) {
                const num = galaxy.calculateDistanceSquared(target.xpos, target.ypos, x, y);
                if (num < DISTRESS_SIGNAL_LOCATION_OVERLAP_RANGE_SQUARED) {
                    return distressSignal;
                }
            }
        }
    }
    return null;
}

/** DistressSignal.AttackStrength from the attacker (2998-3011 / 3046-3055 / 3071-3084 / 3121-3134). */
function attackerStrength(attacker: StellarObject): number {
    if (isBuiltObject(attacker)) return calculateOverallStrengthFactor(attacker);
    if (isCreature(attacker)) return attacker.attackStrength * 5;
    return stellarFirepowerRaw(attacker);
}

/** Galaxy.7.cs 2987 NotifyOfAttack(attacker, attackingEmpire, builtObjectUnderAttack, isNewAttack). */
export function notifyOfAttackBuiltObject(galaxy: Galaxy, attacker: StellarObject | null, attackingEmpire: Empire | null, builtObjectUnderAttack: BuiltObject | null, isNewAttack: boolean): void {
    if (builtObjectUnderAttack === null || builtObjectUnderAttack.empire === null || attacker === null) {
        return;
    }
    const distressSignal = checkForMatchingSignalSameTargetType(galaxy, builtObjectUnderAttack.empire, attackingEmpire, builtObjectUnderAttack, DistressSignalType.UnderAttack);
    if (distressSignal === null) {
        const distressSignal2 = new DistressSignal(builtObjectUnderAttack, DistressSignalType.UnderAttack, galaxyStarDate(galaxy));
        distressSignal2.attacker = attackingEmpire;
        distressSignal2.attackStrength = attackerStrength(attacker);
        empireDistressSignals(builtObjectUnderAttack.empire).push(distressSignal2);
        // 3012-3038: attacker description text (GetText("Pirate").ToLower() + ResolveDescription(SubRole).ToLower(), or
        // ResolveDescription(CreatureType)); the message stays a gameText() tag + arguments (resolved for display).
        let text = '';
        if (isBuiltObject(attacker)) {
            if (attacker.empire!.pirateEmpireBaseHabitat !== null) {
                text = text + 'pirate ';
            }
            text += resolveSubRoleDescription(attacker.subRole).toLowerCase();
            text = text + ' (' + attacker.name + ')';
        } else if (isCreature(attacker)) {
            distressSignal2.attackStrength = attacker.attackStrength * 5;
            text += resolveCreatureDescription(attacker.type);
            if (attacker.type === CreatureType.Kaltor) {
                checkSendPreWarpProgressEventMessage(galaxy, builtObjectUnderAttack.empire, PreWarpProgressEventType.EncounterFirstKaltor, attacker);
            }
        }
        const description = builtObjectUnderAttack.role !== BuiltObjectRole.Base ? gameText('X Y is under attack from ATTACKER', resolveSubRoleDescription(builtObjectUnderAttack.subRole), builtObjectUnderAttack.name, text) : gameText('X is under attack from ATTACKER', builtObjectUnderAttack.name, text);
        sendMessageToEmpire(builtObjectUnderAttack.empire, builtObjectUnderAttack.empire, EmpireMessageType.BattleUnderAttack, builtObjectUnderAttack, description);
    } else if (isNewAttack) {
        distressSignal.attackStrength += attackerStrength(attacker);
    }
}

/** Galaxy.7.cs 3058 NotifyOfAttack(attacker, attackingEmpire, habitatUnderAttack, bombarded, isNewAttack, notifyIndependent). */
export function notifyOfAttackHabitat(galaxy: Galaxy, attacker: StellarObject | null, attackingEmpire: Empire | null, habitatUnderAttack: Habitat | null, bombarded: boolean, isNewAttack: boolean, notifyIndependent: boolean): void {
    void notifyIndependent; // unused by the C# body
    if (habitatUnderAttack !== null && habitatUnderAttack.empire !== null && habitatUnderAttack.empire !== galaxy.independentEmpire && attackingEmpire !== null && attackingEmpire.dominantRace !== null && attacker !== null) {
        let distressSignalType = DistressSignalType.UnderAttack;
        if (bombarded) {
            distressSignalType = DistressSignalType.ColonyBombarded;
        }
        const distressSignal = checkForMatchingSignalSameTargetType(galaxy, habitatUnderAttack.empire, attackingEmpire, habitatUnderAttack, distressSignalType);
        if (distressSignal === null || (distressSignal.source !== null && isBuiltObject(distressSignal.source))) {
            const distressSignal2 = new DistressSignal(habitatUnderAttack, distressSignalType, galaxyStarDate(galaxy));
            distressSignal2.attacker = attackingEmpire;
            distressSignal2.attackStrength = attackerStrength(attacker);
            empireDistressSignals(habitatUnderAttack.empire).push(distressSignal2);
            // 3085-3112: message texts (TODO(port) M9 TextResolver / ResolveDescription).
            let description = '';
            if (distressSignalType === DistressSignalType.ColonyBombarded) {
                description = `Colony Bombardment|${attackingEmpire.dominantRace.name}|${attackingEmpire.name}|${habitatUnderAttack.name}`;
            } else {
                let text = '';
                if (isBuiltObject(attacker)) {
                    if (attacker.empire!.pirateEmpireBaseHabitat !== null) {
                        text = text + 'Pirate ';
                    }
                    text += `${attacker.subRole}`;
                    text = text + ' (' + attacker.name + ')';
                } else if (isCreature(attacker)) {
                    text += `${attacker.type}`;
                    if (attacker.type === CreatureType.Kaltor) {
                        checkSendPreWarpProgressEventMessage(galaxy, habitatUnderAttack.empire, PreWarpProgressEventType.EncounterFirstKaltor, attacker);
                    }
                }
                description = `X is under attack from ATTACKER|${habitatUnderAttack.name}|${text}`;
            }
            sendMessageToEmpire(habitatUnderAttack.empire, habitatUnderAttack.empire, EmpireMessageType.BattleUnderAttack, habitatUnderAttack, description);
            const description2 = distressSignalType !== DistressSignalType.ColonyBombarded ? `Our forces are invading COLONY of EMPIRE|${habitatUnderAttack.name}|${habitatUnderAttack.empire.name}` : `Our forces are bombarding COLONY of EMPIRE|${habitatUnderAttack.name}|${habitatUnderAttack.empire.name}`;
            sendMessageToEmpire(attackingEmpire, attackingEmpire, EmpireMessageType.BattleUnderAttack, habitatUnderAttack, description2);
        } else if (distressSignalType === DistressSignalType.UnderAttack && isNewAttack) {
            distressSignal.attackStrength += attackerStrength(attacker);
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Attack ranges (BuiltObject.2.cs 103-307, 7734) and tactics (BuiltObject.1.cs 795)
// ---------------------------------------------------------------------------------------------------------------

/** BuiltObject.1.cs 795 DetermineTacticsAgainstTarget(abstractTarget). */
export function determineTacticsAgainstTarget(bo: BuiltObject, abstractTarget: StellarObject): BattleTactics {
    let battleTactics = BattleTactics.Undefined;
    if (isCreature(abstractTarget)) {
        const creature = abstractTarget;
        const num = (creature.attackStrength * 5) / bo.firepowerRaw;
        battleTactics = !(num > 1.3) ? bo.design.tacticsWeakerShips : bo.design.tacticsStrongerShips;
    } else if (isHabitat(abstractTarget)) {
        battleTactics = bo.design.tacticsWeakerShips;
    } else {
        const builtObject = abstractTarget;
        const num2 = builtObject.firepowerRaw / bo.firepowerRaw;
        battleTactics = !(num2 > 1.3) ? bo.design.tacticsWeakerShips : bo.design.tacticsStrongerShips;
    }
    if (battleTactics === BattleTactics.PointBlank && bo.firepowerRaw <= 0) {
        battleTactics = BattleTactics.Evade;
    }
    if (battleTactics === BattleTactics.Standoff && bo.standoffWeaponsMaxRange <= 0) {
        battleTactics = bo.beamWeaponsMinRange <= 0 ? BattleTactics.Evade : BattleTactics.AllWeapons;
    }
    if (battleTactics === BattleTactics.AllWeapons && bo.beamWeaponsMinRange <= 0) {
        battleTactics = BattleTactics.Standoff;
    }
    return battleTactics;
}

/** StellarObject.ParentHabitat / ParentBuiltObject across the TS classes. */
function stellarParentHabitat(o: StellarObject): Habitat | null {
    if (isBuiltObject(o) || isCreature(o)) return o.parentHabitat;
    return null;
}
export function stellarParentBuiltObject(o: StellarObject): BuiltObject | null {
    if (isBuiltObject(o)) return o.parentBuiltObject;
    return null;
}

/** BuiltObject.2.cs 103 DetermineTargetSpeed(target) (float). */
export function determineTargetSpeed(target: StellarObject): number {
    let num = Math.fround(stellarCurrentSpeed(target));
    const parentHabitat = stellarParentHabitat(target);
    const parentBuiltObject = stellarParentBuiltObject(target);
    if (parentHabitat !== null) {
        num = parentHabitat.parent === null ? Math.fround(num + Math.fround(Math.trunc(parentHabitat.orbitSpeed))) : Math.fround(num + Math.fround(Math.fround(Math.trunc(parentHabitat.orbitSpeed)) + Math.fround(Math.trunc(parentHabitat.parent.orbitSpeed))));
    } else if (parentBuiltObject !== null) {
        const ph = parentBuiltObject.parentHabitat;
        if (ph === null) {
            num = Math.fround(num + parentBuiltObject.currentSpeed);
        } else if (ph.parent === null) {
            num = Math.fround(num + Math.fround(parentBuiltObject.currentSpeed + Math.fround(Math.trunc(ph.orbitSpeed))));
        } else {
            num = Math.fround(num + Math.fround(Math.fround(parentBuiltObject.currentSpeed + Math.fround(Math.trunc(ph.orbitSpeed))) + Math.fround(Math.trunc(ph.parent.orbitSpeed))));
        }
    }
    return num;
}

/** BuiltObject.2.cs 117 SetOptimalAttackRangesBoarding. */
export function setOptimalAttackRangesBoarding(bo: BuiltObject): void {
    if (bo.assaultRange > 0) {
        bo.optimalMaximumAttackRange = bo.assaultRange;
        bo.optimalMinimumAttackRange = bo.assaultRange * 0.7;
    }
}

/** BuiltObject.2.cs 126/131 SetOptimalAttackRanges(target[, actionType]). */
export function setOptimalAttackRanges(galaxy: Galaxy, bo: BuiltObject, target: StellarObject | null, actionType: CommandAction = CommandAction.Attack): void {
    if (target === null) {
        return;
    }
    const battleTactics = determineTacticsAgainstTarget(bo, target);
    let flag = false;
    if ((actionType === CommandAction.Capture || actionType === CommandAction.Raid) && bo.assaultStrength > 0) {
        if (isBuiltObject(target)) {
            if (target.currentShields < Math.fround(bo.assaultShieldPenetration) && calculateAvailableAssaultPodAttackStrength(galaxy, bo, galaxy.nowMs) > 0) {
                flag = true;
            }
        } else if (isHabitat(target)) {
            if (!habitatPlanetaryShieldPresent(target) && calculateAvailableAssaultPodAttackStrength(galaxy, bo, galaxy.nowMs) > 0) {
                flag = true;
            }
        }
    }
    if (flag) {
        setOptimalAttackRangesBoarding(bo);
    } else {
        switch (battleTactics) {
            case BattleTactics.Evade: {
                let num = 200;
                if (isBuiltObject(target)) {
                    num = target.maximumWeaponsRange;
                }
                bo.optimalMinimumAttackRange = Math.trunc(num * 1.4);
                bo.optimalMaximumAttackRange = Math.trunc(num * 1.8);
                break;
            }
            case BattleTactics.Standoff:
                bo.optimalMinimumAttackRange = Math.trunc(bo.standoffWeaponsMaxRange * 0.65);
                bo.optimalMaximumAttackRange = Math.trunc(bo.standoffWeaponsMaxRange * 0.9);
                break;
            case BattleTactics.AllWeapons:
                bo.optimalMinimumAttackRange = Math.trunc(bo.beamWeaponsMinRange * 0.65);
                bo.optimalMaximumAttackRange = Math.trunc(bo.beamWeaponsMinRange * 0.9);
                break;
            case BattleTactics.PointBlank:
                bo.optimalMinimumAttackRange = Math.trunc(POINT_BLANK_WEAPONS_RANGE * 0.7);
                bo.optimalMaximumAttackRange = POINT_BLANK_WEAPONS_RANGE;
                break;
        }
    }
    const num2 = determineTargetSpeed(target);
    bo.optimalMaximumAttackRange -= num2;
    bo.optimalMaximumAttackRange = Math.max(POINT_BLANK_WEAPONS_RANGE, Math.max(bo.optimalMaximumAttackRange, bo.optimalMinimumAttackRange));
    bo.optimalMinimumAttackRange = Math.max(0.0, Math.min(bo.optimalMaximumAttackRange - 10.0, bo.optimalMinimumAttackRange));
}

/** Habitat.PlanetaryShieldPresent (set by ReviewPlanetaryFacilities, construction/facilities.ts). */
export function habitatPlanetaryShieldPresent(habitat: Habitat): boolean {
    return habitat.planetaryShieldPresent;
}

/** ShipGroup.WeaponsRangeBonus (ShipGroup.cs 79): base + extra. */
function shipGroupWeaponsRangeBonus(bo: BuiltObject): number {
    const shipGroup = shipGroupOf(bo);
    return shipGroup !== null ? shipGroup.weaponsRangeBonusBase + shipGroup.weaponsRangeBonusExtra : 1.0;
}

/** BuiltObject.CaptainWeaponsRangeBonus (BuiltObject.cs 600): (int)_CaptainWeaponsRangeBonus / 100.0 (byte, default 100). */
function captainWeaponsRangeBonus(bo: BuiltObject): number {
    const raw = (bo as BuiltObject & { _captainWeaponsRangeBonus?: number })._captainWeaponsRangeBonus ?? 100;
    return Math.trunc(raw) / 100.0;
}

/** BuiltObject.2.cs 205 ModifyAttackRangeByTargetSpeed(target). */
export function modifyAttackRangeByTargetSpeedFor(galaxy: Galaxy, bo: BuiltObject, target: StellarObject): void {
    let num = 0.0;
    if (!(stellarCurrentSpeed(target) > 0) || !isBuiltObject(target)) {
        return;
    }
    const builtObject = target;
    const num2 = determineAngle(builtObject.xpos, builtObject.ypos, bo.xpos, bo.ypos);
    const num3 = Math.abs(builtObject.heading - num2);
    if (num3 > Math.PI / 2.0) {
        const battleTactics = determineTacticsAgainstTarget(bo, target);
        let weapon: Weapon | null = null;
        switch (battleTactics) {
            case BattleTactics.Standoff: {
                if (bo.weapons === null) {
                    break;
                }
                for (let k = 0; k < bo.weapons.length; k++) {
                    if (bo.weapons[k].component !== null && bo.weapons[k].component.category === ComponentCategoryType.WeaponTorpedo) {
                        weapon = bo.weapons[k];
                        break;
                    }
                }
                if (weapon !== null) {
                    break;
                }
                for (let l = 0; l < bo.weapons.length; l++) {
                    if (bo.weapons[l].component !== null && bo.weapons[l].component.category === ComponentCategoryType.WeaponBeam) {
                        weapon = bo.weapons[l];
                        break;
                    }
                }
                break;
            }
            case BattleTactics.AllWeapons: {
                if (bo.weapons === null) {
                    break;
                }
                for (let i = 0; i < bo.weapons.length; i++) {
                    if (bo.weapons[i].component !== null && bo.weapons[i].component.category === ComponentCategoryType.WeaponBeam) {
                        weapon = bo.weapons[i];
                        break;
                    }
                }
                if (weapon !== null) {
                    break;
                }
                for (let j = 0; j < bo.weapons.length; j++) {
                    if (bo.weapons[j].component !== null && bo.weapons[j].component.category === ComponentCategoryType.WeaponTorpedo) {
                        weapon = bo.weapons[j];
                        break;
                    }
                }
                break;
            }
        }
        if (weapon !== null) {
            let num4 = weapon.range;
            if (shipGroupOf(bo) !== null) {
                num4 *= shipGroupWeaponsRangeBonus(bo);
            }
            num4 *= captainWeaponsRangeBonus(bo);
            const num5 = num4 / weapon.speed;
            const num6 = weapon.speed - stellarCurrentSpeed(target);
            num = num6 * num5;
        }
        if (num > 0.0) {
            if (bo.optimalMaximumAttackRange > num) {
                bo.optimalMinimumAttackRange = Math.trunc(num * 0.65);
                bo.optimalMaximumAttackRange = Math.trunc(num * 0.9);
            }
        } else {
            setOptimalAttackRanges(galaxy, bo, target);
        }
    } else {
        setOptimalAttackRanges(galaxy, bo, target);
    }
}

/** BuiltObject.2.cs 197 ModifyAttackRangeByTargetSpeed(). */
export function modifyAttackRangeByTargetSpeed(galaxy: Galaxy, builtObject: BuiltObject): void {
    const currentTarget = builtObject.currentTarget as StellarObject | null;
    if (currentTarget !== null) {
        modifyAttackRangeByTargetSpeedFor(galaxy, builtObject, currentTarget);
    }
}

/** BuiltObject.2.cs 7734 SetAttackRangeWhenNoMission. */
export function setAttackRangeWhenNoMission(galaxy: Galaxy, builtObject: BuiltObject): void {
    void galaxy;
    const bo = builtObject;
    const mission = builtObjectMission(bo.mission);
    if ((mission === null || mission.type === BuiltObjectMissionType.Undefined) && bo.empire !== null) {
        let num = bo.empire.attackRangeOther;
        if (!bo.isAutoControlled) {
            num = bo.empire.attackRangeOtherManual;
        }
        if (num >= 0) {
            bo.attackRangeSquared = Math.fround(Math.fround(num) * Math.fround(num));
        } else if (bo.attackRangeSquared < 0 && bo.isAutoControlled) {
            bo.attackRangeSquared = Math.fround(2.304e9);
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// BuiltObject.1.cs 951 ShouldAttack / 1689 ShouldCounterAttack / 1185 CheckForAttack / 1852 CheckForRandomAttackTargets
// ---------------------------------------------------------------------------------------------------------------

/** StellarObjectList.ContainsFighterOrBuiltObject(builtObject) (StellarObjectList.cs 98). */
export function attackersContainsFighterOrBuiltObject(attackers: readonly StellarObject[], builtObject: BuiltObject): boolean {
    for (let index = 0; index < attackers.length; ++index) {
        const a = attackers[index];
        if (isBuiltObject(a)) {
            if (a === builtObject) return true;
        } else if (isFighter(a) && a.parentBuiltObject === builtObject) {
            return true;
        }
    }
    return false;
}

/** BuiltObject.1.cs 956 ShouldAttack(potentialTarget, time, includeBoardingCheck) (951: includeBoardingCheck = true). */
export function shouldAttack(galaxy: Galaxy, bo: BuiltObject, potentialTarget: StellarObject, time: number, includeBoardingCheck = true): boolean {
    if (bo.empire === null) {
        return false;
    }
    const mission = builtObjectMission(bo.mission);
    if (mission !== null && mission.type === BuiltObjectMissionType.Refuel) {
        if (mission.checkCommandsForUndock()) {
            return false;
        }
    } else if (mission !== null && (mission.type === BuiltObjectMissionType.Retire || mission.type === BuiltObjectMissionType.Retrofit || mission.type === BuiltObjectMissionType.Repair || mission.type === BuiltObjectMissionType.Escape)) {
        return false;
    }
    let flag = true;
    if (bo.warpSpeed <= 0) {
        const num = galaxy.calculateDistanceSquared(bo.xpos, bo.ypos, potentialTarget.xpos, potentialTarget.ypos);
        if (num > 9000000.0) {
            flag = false;
        }
    }
    if (flag) {
        if (isCreature(potentialTarget)) {
            const creature = potentialTarget;
            if (creature.isVisible) {
                if ((bo.firepowerRaw > 0 || bo.fighterCapacity > 0) && bo.isFunctional) {
                    let flag2 = false;
                    switch (bo.design.stance) {
                        case BuiltObjectStance.DoNotAttack:
                            flag2 = false;
                            break;
                        case BuiltObjectStance.AttackIfAttacked:
                            flag2 = stellarAttackers(bo).includes(potentialTarget) ? true : false;
                            break;
                        case BuiltObjectStance.AttackUnallied:
                        case BuiltObjectStance.AttackEnemies:
                            flag2 = true;
                            break;
                    }
                    if (flag2) {
                        if (bo.role === BuiltObjectRole.Base) {
                            return true;
                        }
                        if (bo.topSpeed > 0) {
                            let flag3 = true;
                            const shipGroup = shipGroupOf(bo);
                            if (bo.isPlanetDestroyer) {
                                flag3 = false;
                            } else if (shipGroup !== null) {
                                if (shipGroup.mission !== null && shipGroup.mission.type !== BuiltObjectMissionType.Undefined && shipGroup.mission.type !== BuiltObjectMissionType.Patrol && shipGroup.mission.type !== BuiltObjectMissionType.MoveAndWait && shipGroup.mission.priority !== BuiltObjectMissionPriority.Low) {
                                    flag3 = false;
                                }
                                if (!flag3 && (mission === null || mission.type === BuiltObjectMissionType.Undefined)) {
                                    flag3 = true;
                                }
                            }
                            if (flag3) {
                                return true;
                            }
                            const creatureTarget = creature.currentTarget as StellarObject | null;
                            if (creatureTarget !== null && isBuiltObject(creatureTarget) && creatureTarget === bo) {
                                return true;
                            }
                            return false;
                        }
                        return false;
                    }
                    return false;
                }
                return false;
            }
            return false;
        }
        if (isBuiltObject(potentialTarget)) {
            const builtObject = potentialTarget;
            if (bo.empire === builtObject.empire || builtObject.empire === null) {
                return false;
            }
            if (builtObject.empire === galaxy.independentEmpire) {
                return false;
            }
            if (builtObject.pirateEmpireId > 0 && builtObject.pirateEmpireId === bo.pirateEmpireId) {
                return false;
            }
            if (bo.firepowerRaw <= 0 && bo.fighterCapacity <= 0) {
                return false;
            }
            if (!bo.isFunctional || (bo.topSpeed <= 0 && bo.role !== BuiltObjectRole.Base)) {
                return false;
            }
            if (builtObject.nearestSystemStar !== bo.nearestSystemStar) {
                return false;
            }
            if (builtObject.empire.pirateEmpireBaseHabitat !== null && bo.empire !== null && obtainPirateRelation(builtObject.empire, bo.empire).type === PirateRelationType.Protection) {
                return false;
            }
            if (bo.empire.pirateEmpireBaseHabitat !== null && builtObject.empire !== null && obtainPirateRelation(bo.empire, builtObject.empire).type === PirateRelationType.Protection) {
                return false;
            }
            if (includeBoardingCheck) {
                if (checkOurEmpireOverwhelmingBoarding(bo.empire, builtObject)) {
                    return false;
                }
                if (builtObject.currentShields < Math.fround(Math.max(15, Math.trunc(bo.assaultShieldPenetration))) && calculateAvailableAssaultPodAttackStrength(galaxy, bo, time) <= 0 && checkOurEmpireBoarding(bo.empire, builtObject, bo)) {
                    return false;
                }
            }
            let flag4 = false;
            const outlaws = bo.empire.outlaws as BuiltObject[];
            if (outlaws.includes(builtObject)) {
                if (bo.empire === builtObject.empire) {
                    outlaws.splice(outlaws.indexOf(builtObject), 1);
                    return false;
                }
                flag4 = true;
            }
            const attackers = stellarAttackers(bo);
            switch (bo.design.stance) {
                case BuiltObjectStance.DoNotAttack:
                    return false;
                case BuiltObjectStance.AttackIfAttacked:
                    if (attackersContainsFighterOrBuiltObject(attackers, builtObject)) {
                        return true;
                    }
                    return false;
                case BuiltObjectStance.AttackUnallied: {
                    if (attackersContainsFighterOrBuiltObject(attackers, builtObject)) {
                        return true;
                    }
                    const diplomaticRelation = bo.empire.diplomaticRelations.byEmpire(builtObject.empire);
                    if (diplomaticRelation !== null) {
                        if (diplomaticRelation.type === DiplomaticRelationType.FreeTradeAgreement || diplomaticRelation.type === DiplomaticRelationType.MutualDefensePact || diplomaticRelation.type === DiplomaticRelationType.Protectorate || diplomaticRelation.type === DiplomaticRelationType.SubjugatedDominion || diplomaticRelation.type === DiplomaticRelationType.Truce) {
                            return false;
                        }
                        return true;
                    }
                    return true;
                }
                case BuiltObjectStance.AttackEnemies: {
                    if (attackersContainsFighterOrBuiltObject(attackers, builtObject)) {
                        return true;
                    }
                    if ((bo.empire !== null && bo.empire.pirateEmpireBaseHabitat !== null) || (builtObject.empire !== null && builtObject.empire.pirateEmpireBaseHabitat !== null)) {
                        let pirateRelation = null;
                        if (builtObject.empire !== null) {
                            pirateRelation = obtainPirateRelation(bo.empire, builtObject.empire);
                        }
                        if (pirateRelation!.type !== PirateRelationType.Protection) {
                            return true;
                        }
                        if (flag4) {
                            return true;
                        }
                        return false;
                    }
                    const diplomaticRelation = bo.empire.diplomaticRelations.byEmpire(builtObject.empire);
                    if (builtObject.empire.pirateEmpireBaseHabitat !== null) {
                        return true;
                    }
                    if (bo.empire.pirateEmpireBaseHabitat !== null && builtObject.empire !== bo.empire) {
                        return true;
                    }
                    if (flag4) {
                        return true;
                    }
                    if (diplomaticRelation !== null) {
                        if (diplomaticRelation.type === DiplomaticRelationType.War) {
                            return true;
                        }
                        if (mission !== null && (mission.type === BuiltObjectMissionType.Attack || mission.type === BuiltObjectMissionType.Bombard || mission.type === BuiltObjectMissionType.WaitAndAttack || mission.type === BuiltObjectMissionType.WaitAndBombard)) {
                            const empire = BuiltObjectMission.resolveMissionTargetEmpire(mission);
                            if (potentialTarget.empire === empire) {
                                return true;
                            }
                        }
                        return false;
                    }
                    return false;
                }
            }
        }
    }
    return false;
}

/** BuiltObject.1.cs 1689 ShouldCounterAttack. */
export function shouldCounterAttack(bo: BuiltObject): boolean {
    if (bo.firepowerRaw <= 0 && bo.fighterCapacity <= 0) {
        return false;
    }
    if (!bo.isFunctional || bo.topSpeed <= 0) {
        return false;
    }
    switch (bo.design.stance) {
        case BuiltObjectStance.DoNotAttack:
            return false;
        case BuiltObjectStance.AttackUnallied:
        case BuiltObjectStance.AttackEnemies:
        case BuiltObjectStance.AttackIfAttacked:
            if (stellarAttackers(bo).length > 0) {
                return true;
            }
            return false;
        default:
            return false;
    }
}

/**
 * BuiltObject.2.cs 314 CheckColonyShipMissionCancelled(cancelReasonCode) → 338 SendMessageCannotColonize. The C# only
 * composes a message (TODO(port) M9 TextResolver "Colony Failure …" texts); the message is queued with the code as text.
 */
export function checkColonyShipMissionCancelled(galaxy: Galaxy, bo: BuiltObject, cancelReasonCode: number): void {
    const mission = builtObjectMission(bo.mission);
    if (bo.subRole === BuiltObjectSubRole.ColonyShip && mission !== null && mission.type === BuiltObjectMissionType.Colonize && mission.targetHabitat !== null) {
        let failureReason = '';
        switch (cancelReasonCode) {
            case 0:
                failureReason = 'Colony Failure Under Attack';
                break;
            case 1:
                failureReason = `Colony Failure Already Colonized|${mission.targetHabitat.category}`;
                break;
            case 2:
                failureReason = `Colony Failure Cannot Colonize|${mission.targetHabitat.category}`;
                break;
            case 3:
                failureReason = `Colony Failure Colony Destroyed|${mission.targetHabitat.category}`;
                break;
        }
        const colonizationTarget = mission.targetHabitat;
        if (colonizationTarget !== null && bo.empire !== null) {
            const habitat = galaxy.determineHabitatSystemStar(colonizationTarget);
            let empty = `Colony Failure Message|${bo.name}|${colonizationTarget.type}|${colonizationTarget.category}|${colonizationTarget.name}|${habitat.name}`;
            empty = empty + '. ' + failureReason;
            sendMessageToEmpire(bo.empire, bo.empire, EmpireMessageType.ColonyShipMissionCancelled, bo, empty, { x: Math.trunc(colonizationTarget.xpos), y: Math.trunc(colonizationTarget.ypos) }, '');
        }
    }
}

/** BuiltObject.1.cs 1185 CheckForAttack(galaxy). */
export function checkForAttack(galaxy: Galaxy, builtObject: BuiltObject): void {
    const bo = builtObject;
    const attackers = stellarAttackers(bo);
    if (attackers.length <= 0 || bo.role === BuiltObjectRole.Base) {
        return;
    }
    const mission = builtObjectMission(bo.mission);
    let flag = true;
    if (!bo.isAutoControlled && mission !== null && mission.type === BuiltObjectMissionType.Move) {
        flag = false;
    }
    if (mission !== null && (mission.type === BuiltObjectMissionType.Escape || mission.type === BuiltObjectMissionType.Attack || mission.type === BuiltObjectMissionType.Bombard || mission.type === BuiltObjectMissionType.Refuel || mission.type === BuiltObjectMissionType.Repair)) {
        flag = false;
    }
    if (mission !== null && (mission.priority === BuiltObjectMissionPriority.High || mission.priority === BuiltObjectMissionPriority.VeryHigh)) {
        flag = false;
    }
    if (bo.subRole === BuiltObjectSubRole.ResupplyShip && bo.isDeployed) {
        flag = false;
    }
    if (flag) {
        if (!shouldCounterAttack(bo) || !(bo.currentFuel > 0.0) || !(bo.currentEnergy > 0.0) || bo.builtAt !== null) {
            return;
        }
        const num = bo.sensorProximityArrayRange * bo.sensorProximityArrayRange;
        let stellarObject: Threat | null = null;
        const threats = builtObjectThreats(bo);
        for (let i = 0; i < threats.length; i++) {
            const t = threats[i];
            if (t === null || attackers.indexOf(t) < 0) {
                continue;
            }
            stellarObject = t;
            if (stellarObject === null || stellarObject.hasBeenDestroyed || stellarObject === bo.currentTarget) {
                continue;
            }
            const num2 = galaxy.calculateDistanceSquared(bo.xpos, bo.ypos, stellarObject.xpos, stellarObject.ypos);
            if (!(num2 <= num) || !withinFuelRangeAndRefuel(galaxy, bo, stellarObject.xpos, stellarObject.ypos, 0.0)) {
                continue;
            }
            let flag2 = true;
            if (isBuiltObject(stellarObject)) {
                if (stellarObject.nearestSystemStar !== bo.nearestSystemStar || (stellarObject.warpSpeed > 0 && stellarObject.currentSpeed > Math.fround(stellarObject.topSpeed))) {
                    flag2 = false;
                }
            }
            if (flag2) {
                let builtObjectMissionType = BuiltObjectMissionType.Attack;
                if (bo.empire !== null && isBuiltObject(stellarObject)) {
                    builtObjectMissionType = determineDestroyOrCaptureTarget(galaxy, bo.empire, bo, stellarObject, false);
                }
                recordRevertMission(galaxy, bo, builtObjectMissionType, true);
                clearPreviousMissionRequirements(galaxy, bo);
                assignMission(galaxy, bo, builtObjectMissionType, stellarObject, null, BuiltObjectMissionPriority.Normal);
                break;
            }
        }
        return;
    }
    const stellarObject2 = shouldFleeFrom(galaxy, bo);
    if (stellarObject2 === null || bo.builtAt !== null || (mission !== null && (mission.type === BuiltObjectMissionType.Escape || bo.hyperjumpPrepare))) {
        return;
    }
    checkColonyShipMissionCancelled(galaxy, bo, 0);
    recordRevertMission(galaxy, bo, BuiltObjectMissionType.Escape);
    clearPreviousMissionRequirements(galaxy, bo);
    // 1262-1269: a Fighter flee target is replaced by its (live) parent ship — Fighters are not threats in the TS port (M4p).
    assignMission(galaxy, bo, BuiltObjectMissionType.Escape, stellarObject2, null, BuiltObjectMissionPriority.High);
}

/** BuiltObject.1.cs 1852 CheckForRandomAttackTargets. */
export function checkForRandomAttackTargets(galaxy: Galaxy, builtObject: BuiltObject): void {
    const bo = builtObject;
    if (bo.empire === null || bo.subRole === BuiltObjectSubRole.ResupplyShip || bo.empire.empiresToAttack === null || bo.empire.empiresToAttack.length <= 0 || bo.builtAt !== null || (bo.firepowerRaw <= 0 && bo.fighterCapacity <= 0)) {
        return;
    }
    const num = galaxy.maxSolarSystemSize * 2.0 + 500.0;
    const num2 = num * num;
    const idx = galaxy.resolveIndex(bo.xpos, bo.ypos);
    const array = galaxy.builtObjectIndexGrid[idx.x][idx.y].slice();
    const num3 = Math.trunc(bo.xpos) - galaxy.maxSolarSystemSize * 2 + 500;
    const num4 = Math.trunc(bo.xpos) + galaxy.maxSolarSystemSize * 2 + 500;
    const num5 = Math.trunc(bo.ypos) - galaxy.maxSolarSystemSize * 2 + 500;
    const num6 = Math.trunc(bo.ypos) + galaxy.maxSolarSystemSize * 2 + 500;
    const mission = builtObjectMission(bo.mission);
    for (const builtObject2 of array) {
        if (builtObject2 == null || !(builtObject2.xpos >= num3) || !(builtObject2.xpos <= num4) || !(builtObject2.ypos >= num5) || !(builtObject2.ypos <= num6) || builtObject2.role === BuiltObjectRole.Military || !bo.empire.empiresToAttack.includes(builtObject2.empire as Empire)) {
            continue;
        }
        const num7 = galaxy.calculateDistanceSquared(builtObject2.xpos, builtObject2.ypos, bo.xpos, bo.ypos);
        if (num7 <= num2 && (mission === null || (mission !== null && (mission.priority === BuiltObjectMissionPriority.Undefined || mission.priority === BuiltObjectMissionPriority.Low))) && withinFuelRangeAndRefuel(galaxy, bo, builtObject2.xpos, builtObject2.ypos, 0.1)) {
            let missionType = BuiltObjectMissionType.Attack;
            if (bo.empire !== null) {
                missionType = determineDestroyOrCaptureTarget(galaxy, bo.empire, bo, builtObject2, false);
            }
            assignMission(galaxy, bo, missionType, builtObject2, null, BuiltObjectMissionPriority.Normal);
            const k = bo.empire.empiresToAttack.indexOf(builtObject2.empire as Empire);
            if (k >= 0) bo.empire.empiresToAttack.splice(k, 1);
            break;
        }
    }
}

/** BuiltObject.1.cs 1772 CheckForHyperExitGravityWell(x, y). */
export function checkForHyperExitGravityWell(galaxy: Galaxy, bo: BuiltObject, x: number, y: number): BuiltObject | null {
    const builtObjectsAtLocationByArrays = getBuiltObjectsAtLocationByArrays(galaxy, x, y, 4000);
    for (let i = 0; i < builtObjectsAtLocationByArrays.length; i++) {
        const num = builtObjectsAtLocationByArrays[i].length;
        for (let j = 0; j < num; j++) {
            const builtObject = builtObjectsAtLocationByArrays[i][j];
            if (builtObject == null || builtObject.hyperStopRange <= 0 || builtObject.empire === null || builtObject.empire === bo.empire) {
                continue;
            }
            let flag = false;
            if (builtObject.empire.pirateEmpireBaseHabitat !== null) {
                const pirateRelation = obtainPirateRelation(bo.empire!, builtObject.empire);
                if (pirateRelation.type === PirateRelationType.None) {
                    flag = true;
                }
            } else {
                const diplomaticRelation = obtainDiplomaticRelation(bo.empire!, builtObject.empire);
                if (diplomaticRelation.type === DiplomaticRelationType.War) {
                    flag = true;
                }
            }
            if (flag || (bo.empire !== null && bo.empire.pirateEmpireBaseHabitat !== null)) {
                const num2 = galaxy.calculateDistance(builtObject.xpos, builtObject.ypos, x, y);
                if (num2 < builtObject.hyperStopRange) {
                    return builtObject;
                }
            }
        }
    }
    return null;
}

// ---------------------------------------------------------------------------------------------------------------
// BaconBuiltObject.cs 2578 CheckNearTarget
// ---------------------------------------------------------------------------------------------------------------

/**
 * BaconBuiltObject.cs 2578 CheckNearTarget(ship): on a HyperTo command, re-aim the jump at the (moved) mission target and
 * complete the jump when within HyperJumpThreshhold. The `"???"` name pause (2581) is a debugging hook (UI Pause) — omitted.
 * The C# body is wrapped in a swallowing try/catch; the null dereferences it guards (e.g. `ship.Mission.TargetBuiltObject.Name`
 * on a ship-group target) are made explicit here and take the same "do nothing" path.
 */
export function checkNearTarget(galaxy: Galaxy, builtObject: BuiltObject): void {
    const ship = builtObject;
    const mission = builtObjectMission(ship.mission);
    if (ship === null || mission === null || mission.fastPeekCurrentCommand() === null || mission.fastPeekCurrentCommand()!.action !== CommandAction.HyperTo) return;
    if (mission.type === BuiltObjectMissionType.Escape) return;
    let x2 = 0.0;
    let y2 = 0.0;
    const target = mission.target;
    const secondaryTarget = mission.secondaryTarget;
    const cmd = mission.fastPeekCurrentCommand()!;
    let stellarObject: StellarObject | null = cmd.targetHabitat ?? cmd.targetBuiltObject ?? cmd.targetCreature;
    if (stellarObject === null && target !== null) {
        if (!isShipGroup(target)) {
            stellarObject = target;
        } else {
            // (StellarObject)((ShipGroup)target).Ships[0] — throws (caught) on an empty fleet.
            if (target.ships.length === 0) return;
            stellarObject = target.ships[0];
        }
    }
    if (target !== null && stellarObject !== null) {
        const name = stellarObject.name;
        if (isBuiltObject(target) && name === mission.targetBuiltObject?.name) {
            x2 = target.xpos;
            y2 = target.ypos;
        } else if (isHabitat(target) && name === mission.targetHabitat?.name) {
            x2 = target.xpos;
            y2 = target.ypos;
        } else if (isCreature(target) && name === mission.targetCreature?.name) {
            x2 = target.xpos;
            y2 = target.ypos;
        } else if (secondaryTarget !== null && isBuiltObject(secondaryTarget) && name === mission.secondaryTargetBuiltObject?.name) {
            x2 = secondaryTarget.xpos;
            y2 = secondaryTarget.ypos;
        } else if (secondaryTarget !== null && isHabitat(secondaryTarget) && name === mission.secondaryTargetHabitat?.name) {
            x2 = secondaryTarget.xpos;
            y2 = secondaryTarget.ypos;
        } else if (secondaryTarget !== null && isCreature(secondaryTarget) && name === mission.secondaryTargetCreature?.name) {
            x2 = secondaryTarget.xpos;
            y2 = secondaryTarget.ypos;
        }
    }
    if (Math.abs(x2) < 0.01 && Math.abs(y2) < 0.01) {
        if (stellarObject !== null) {
            x2 = stellarObject.xpos;
            y2 = stellarObject.ypos;
        } else {
            x2 = mission.x;
            y2 = mission.y;
        }
    }
    if (Math.abs(cmd.xpos - Math.fround(x2)) > 10.0 || Math.abs(cmd.ypos - Math.fround(y2)) > 10.0) {
        if (!mission.manuallyAssigned && stellarObject !== null && isBuiltObject(stellarObject) && stellarObject.currentSpeed > stellarObject.topSpeed && stellarObject.actualEmpire !== ship.actualEmpire) {
            mission.clear();
        } else {
            cmd.xpos = Math.fround(x2);
            cmd.ypos = Math.fround(y2);
        }
    }
    const mission2 = builtObjectMission(ship.mission);
    if (mission2 !== null && galaxy.calculateDistanceSquared(ship.xpos, ship.ypos, x2, y2) <= baconMovementSettings.hyperJumpThreshhold * baconMovementSettings.hyperJumpThreshhold) {
        mission2.completeCommand();
        const mission3 = builtObjectMission(ship.mission);
        if (mission3 !== null && mission3.target !== null && mission3.fastPeekCurrentCommand()?.action === CommandAction.MoveTo && mission3.showNextCommand()?.action === CommandAction.ConditionalHyperTo) mission3.completeCommand();
        if (ship.currentSpeed > ship.topSpeed) ship.currentSpeed = Math.fround(ship.cruiseSpeed);
    }
    if (ship.nearestSystemStar === null || ship.actualEmpire === null || ship.currentSpeed > ship.topSpeed) return;
    ship.actualEmpire.visibility.resolveSystemVisibilityForUnit(ship, false);
}

/** Re-export for cmdAttack.ts: the target's current-target / top-speed views. */
export { stellarCurrentTarget, stellarTopSpeed, evaluateThreats };
