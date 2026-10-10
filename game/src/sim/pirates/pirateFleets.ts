// M4s (s2) — pirate fleet tasking: Empire.9.cs 904 PirateTaskFleets, Empire.2.cs 4175 IdentifyDesiredEnemyMiningStations,
// 4265 IdentifyRaidableColonies, Empire.9.cs 2401 IsShipGroupAvailable(shipGroup, maximumPriorityToInclude, minimumTroopLevel),
// Empire.8.cs 1364 CalculateDefendingStrength (Habitat target).
//
// The fleet search / refuelling / base-defence helpers (FindNearestAvailableFleet, AssignFleetRefuellingExcludeGatheringShips,
// EnsureBaseDefendedByFleet) are M4m's and are called through their stubs in fleets/militaryAI.ts.
// Free functions, C# `this` first (plan §3.1).

import { isAiControlled } from '../missions/playerOrder';
import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import { AutomationLevel } from '../empire';
import type { BuiltObject } from '../builtObject';
import { planetsOf, type Habitat } from '../types';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, type MissionTarget } from '../missions/mission';
import { empireShipGroups, shipGroupAssignMission, shipGroupWarpSpeed, type ShipGroup } from '../fleets/shipGroup';
import {
    determineDestroyOrCaptureTargetForFleet,
    shipGroupCalculateRefuellingPortion,
    shipGroupCalculateRequiredFuel,
    shipGroupCheckFleetTargetWithinFuelRangeAndRefuel,
    shipGroupCheckShipsRequiringRefuelling,
    shipGroupListResolveFleetsWithAttackTarget,
    shipGroupListResolveFleetsWithWaitTarget,
    shipGroupTotalTroopAttackStrengthNearby,
} from '../fleets/shipGroupTasks';
import { assignFleetRefuellingExcludeGatheringShips, calculateDefendingStrength, ensureBaseDefendedByFleet, findNearestAvailableFleet, generateAutomationMessageAttackEnemyColony, isShipGroupAvailable } from '../fleets/militaryAI';
import { generateAutomationMessageInvadeIndependent } from '../combat/invasion';
import { formatGameTextNow } from '../textResolver';
import { FleetPosture, AdvisorMessageType, checkTaskAuthorized, type RefCount } from '../diplomacyTick';
import { DiplomaticRelationType, DiplomaticStrategy, obtainDiplomaticRelation } from '../diplomacy';
import { PirateRelationType, obtainPirateRelation } from '../pirateRelations';
import { PiratePlayStyle } from '../pirates';
import { isObjectVisibleToThisEmpire } from '../independentTraders';
import { identifyDeficientEmpireResources } from '../industry';
import { fastFindNearestSpacePort } from '../stationPlacement';
import { determineMiningStationAtHabitat, HabitatPrioritization } from '../resourceTargets';
import { determineBaseStrengthAtHabitat, determineDefendingStrength } from '../combat/threats';
import { estimatedDefensiveForceRequired, troopLevelRequired } from '../troops';
import { netSort } from '../netSort';
import { EmpireActivityType, type EmpireActivity } from './empireActivity';
import { calculateOverallStrengthFactor } from './missionsMarket';
import { findNearestKnownBaseForPirateAttackOwn } from './pirateShipMissions';
import { isHumanEmpire } from '../humanEmpires';

const f = Math.fround;

/** FindNearestAvailableFleet's trailing arguments as PirateTaskFleets passes them (mustBeWithinFuelRange: true, 0.1, false, false, false, true, troops, boarding). */
function fleetArgs(minimumTroopStrength: number, minimumBoardingStrength = 0): [boolean, number, boolean, boolean, boolean, boolean, number, number] {
    return [true, 0.1, false, false, false, true, minimumTroopStrength, minimumBoardingStrength];
}

/** The "is this empire friendly" check shared by 4175 / 4265 (DiplomaticStrategy / relation types, or pirate Protection). */
function isRaidAllowedAgainst(empire: Empire, actualEmpire: Empire | null): boolean {
    let flag2 = true;
    if (empire.pirateEmpireBaseHabitat === null && actualEmpire !== null && actualEmpire.pirateEmpireBaseHabitat === null) {
        const diplomaticRelation = obtainDiplomaticRelation(empire, actualEmpire);
        if (
            diplomaticRelation.strategy === DiplomaticStrategy.Ally ||
            diplomaticRelation.strategy === DiplomaticStrategy.Befriend ||
            diplomaticRelation.strategy === DiplomaticStrategy.DefendPlacate ||
            diplomaticRelation.strategy === DiplomaticStrategy.Placate ||
            diplomaticRelation.type === DiplomaticRelationType.FreeTradeAgreement ||
            diplomaticRelation.type === DiplomaticRelationType.MutualDefensePact ||
            diplomaticRelation.type === DiplomaticRelationType.Protectorate
        ) {
            flag2 = false;
        }
    } else if (actualEmpire !== null) {
        const pirateRelation = obtainPirateRelation(empire, actualEmpire);
        if (pirateRelation.type === PirateRelationType.Protection) flag2 = false;
    }
    return flag2;
}

/** HabitatPrioritizationList.Sort() + Reverse() (Priority, unstable introsort). */
function sortDescending(list: HabitatPrioritization[]): void {
    netSort(list, (a, b) => a.compareTo(b));
    list.reverse();
}

/** Empire.2.cs 4175 IdentifyDesiredEnemyMiningStations(topResourceCount, excludeRecentRaids, valueThreshold). No Rnd. */
export function identifyDesiredEnemyMiningStations(galaxy: Galaxy, empire: Empire, topResourceCount: number, excludeRecentRaids: boolean, valueThreshold: number): HabitatPrioritization[] {
    const habitatPrioritizationList: HabitatPrioritization[] = [];
    const resourceList = identifyDeficientEmpireResources(galaxy, empire, false, 0.0);
    const svs = empire.visibility.systemVisibility;
    for (let i = 0; i < svs.length; i++) {
        if (!empire.visibility.checkSystemExplored(i)) continue;
        const builtObject = fastFindNearestSpacePort(galaxy, svs[i].systemStar.xpos, svs[i].systemStar.ypos, empire);
        const habitats = planetsOf(galaxy.systems[svs[i].systemStar.systemIndex]); // Empire.2.cs 4186 Systems[].Habitats: no star
        for (let j = 0; j < habitats.length; j++) {
            const habitat = habitats[j];
            if (habitat.resources.length <= 0 || !empire.resourceMap.checkResourcesKnown(habitat)) continue;
            const builtObject2 = determineMiningStationAtHabitat(habitat) as BuiltObject | null;
            if (builtObject2 == null) continue;
            const actualEmpire = builtObject2.actualEmpire;
            if (actualEmpire === empire) continue;
            let flag = true;
            if (isHumanEmpire(galaxy, empire)) flag = isObjectVisibleToThisEmpire(galaxy, empire, builtObject2, true, false);
            if (!flag) continue;
            const flag2 = isRaidAllowedAgainst(empire, actualEmpire);
            if (!flag2 || (excludeRecentRaids && builtObject2.raidCountdown > 0)) continue;
            let num = 0.0;
            for (let k = 0; k < topResourceCount; k++) {
                // resourceList[k] (the C# indexer throws past the end; IdentifyDeficientEmpireResources lists every resource).
                if (resourceList[k].sortTag > 0.1 && habitat.resources.some((r) => r.resourceId === resourceList[k].resourceId)) num += 1000.0;
            }
            if (num > 0.0) {
                if (builtObject !== null) num /= Math.sqrt(Math.sqrt(galaxy.calculateDistance(builtObject.xpos, builtObject.ypos, habitat.xpos, habitat.ypos)));
                else if (empire.capital !== null) num /= Math.sqrt(Math.sqrt(galaxy.calculateDistance(empire.capital.xpos, empire.capital.ypos, habitat.xpos, habitat.ypos)));
                if (num >= valueThreshold) {
                    num = Math.max(1.0, num);
                    habitatPrioritizationList.push(new HabitatPrioritization(habitat, Math.trunc(num) | 0));
                }
            }
        }
    }
    sortDescending(habitatPrioritizationList);
    return habitatPrioritizationList;
}

/** Empire.2.cs 4265 IdentifyRaidableColonies(maximumDefenseStrength, valueThreshold). No Rnd. */
export function identifyRaidableColonies(galaxy: Galaxy, empire: Empire, maximumDefenseStrength: number, valueThreshold: number): HabitatPrioritization[] {
    const habitatPrioritizationList: HabitatPrioritization[] = [];
    const svs = empire.visibility.systemVisibility;
    for (let i = 0; i < svs.length; i++) {
        if (!empire.visibility.checkSystemExplored(i) || galaxy.systems == null || galaxy.systems.length <= i) continue;
        const systemInfo = galaxy.systems[i];
        if (systemInfo == null || ((systemInfo.dominantEmpire == null || systemInfo.dominantEmpire.empire == null) && (systemInfo.independentColonyCount ?? 0) <= 0)) continue;
        const habitats = planetsOf(galaxy.systems[i]); // Empire.2.cs 4279 Systems[i].Habitats: no star
        if (habitats == null) continue;
        for (let j = 0; j < habitats.length; j++) {
            const habitat = habitats[j];
            if (habitat == null || habitat.population == null || habitat.population.items.length <= 0) continue;
            const other = habitat.empire;
            if (other === null || other === empire || habitat.raidCountdown > 0) continue;
            let flag = true;
            const byFaction = habitat.pirateColonyControl.getByFaction(empire);
            if (byFaction !== null && (byFaction.hasFacilityControl || byFaction.controlLevel >= f(0.5))) flag = false;
            if (!flag) continue;
            let num = 0;
            if (empire.visibility.checkSystemVisible(i)) {
                if (habitat.troops !== null) num = habitat.troops.totalDefendStrength;
            } else {
                num = estimatedDefensiveForceRequired(galaxy, habitat, false, galaxy.difficultyLevel);
            }
            if (num > maximumDefenseStrength) continue;
            const builtObject = fastFindNearestSpacePort(galaxy, habitat.xpos, habitat.ypos, empire);
            if (!isRaidAllowedAgainst(empire, other)) continue;
            let num2 = 0.0;
            if (habitat.population != null) num2 = habitat.population.totalAmount / 1000.0;
            if (num2 > 0.0) {
                if (builtObject !== null) num2 /= Math.sqrt(Math.sqrt(galaxy.calculateDistance(builtObject.xpos, builtObject.ypos, habitat.xpos, habitat.ypos)));
                else if (empire.capital !== null) num2 /= Math.sqrt(Math.sqrt(galaxy.calculateDistance(empire.capital.xpos, empire.capital.ypos, habitat.xpos, habitat.ypos)));
                if (num2 >= valueThreshold) {
                    num2 = Math.max(1.0, num2);
                    habitatPrioritizationList.push(new HabitatPrioritization(habitat, Math.trunc(num2) | 0));
                }
            }
        }
    }
    sortDescending(habitatPrioritizationList);
    return habitatPrioritizationList;
}

// Empire.10.cs GenerateAutomationMessage* for the pirate tasks (advisor texts for the player), resolved now
// (formatGameTextNow, the C#'s string.Format(TextResolver.GetText(...), ...)).

/** `target.ParentHabitat` → DetermineHabitatSystemStar(...).Name, or "" (StellarObject.ParentHabitat). */
function parentSystemName(galaxy: Galaxy, target: unknown): string {
    const parent = (target as { parentHabitat?: Habitat | null } | null)?.parentHabitat ?? null;
    return parent !== null ? galaxy.determineHabitatSystemStar(parent).name : '';
}

/** Empire.10.cs 3926 / 3946 GenerateAutomationMessagePiratesAttackMission / PiratesDefendMission(mission, fleet). */
export function generateAutomationMessagePiratesMission(galaxy: Galaxy, tag: 'Automation Pirate Attack Mission' | 'Automation Pirate Defend Mission', mission: EmpireActivity, fleet: ShipGroup): string {
    let text = '';
    let text2 = '';
    let text3 = '';
    let text4 = '';
    if (mission.targetEmpire !== null && mission.requestingEmpire !== null && mission.target !== null) {
        text4 = mission.targetEmpire.name;
        text = mission.target.name;
        text3 = mission.requestingEmpire.name;
        text2 = parentSystemName(galaxy, mission.target);
    }
    return formatGameTextNow(tag, [text3, text, text4, text2, fleet.name]);
}

/** Empire.10.cs 3915 GenerateAutomationMessagePiratesAttackPirates(attackTarget, attackFleet). */
export function generateAutomationMessagePiratesAttackPirates(galaxy: Galaxy, attackTarget: BuiltObject, attackFleet: ShipGroup): string {
    return formatGameTextNow('Automation Pirate Attack Pirate', [attackTarget.empire!.name, attackTarget.name, parentSystemName(galaxy, attackTarget), attackFleet.name]);
}

/** Empire.10.cs 3861 GenerateAutomationMessageRaidBase(target, attackFleet). */
export function generateAutomationMessageRaidBase(galaxy: Galaxy, target: BuiltObject, attackFleet: ShipGroup): string {
    return formatGameTextNow('Automation Raid Base', [target.name, target.empire !== null ? target.empire.name : '', parentSystemName(galaxy, target), attackFleet.name]);
}

/** Empire.10.cs 3876 GenerateAutomationMessageRaidColony(target, attackFleet). */
export function generateAutomationMessageRaidColony(galaxy: Galaxy, target: Habitat, attackFleet: ShipGroup): string {
    const name = galaxy.determineHabitatSystemStar(target).name;
    if (target.empire === galaxy.independentEmpire) return formatGameTextNow('Automation Raid Independent Colony', [target.name, name, attackFleet.name]);
    return formatGameTextNow('Automation Raid Colony', [target.name, target.empire !== null ? target.empire.name : '', name, attackFleet.name]);
}

/** Empire.9.cs 904 PirateTaskFleets. Rnd: in callees only (FindNearestAvailableFleet — M4m; ShipGroup.AssignMission's). */
export function pirateTaskFleetsCore(galaxy: Galaxy, empire: Empire): void {
    const refusalCount: RefCount = { value: 0 };
    const shipGroups = empireShipGroups(empire).filter((g): g is ShipGroup => g !== null) as ShipGroup[];
    if (empire.shipGroups == null) return;
    // 911-929: fleets short of fuel.
    for (let i = 0; i < empire.shipGroups.length; i++) {
        const shipGroup = empire.shipGroups[i] as ShipGroup | null;
        if (shipGroup != null && isShipGroupAvailable(galaxy, shipGroup, BuiltObjectMissionPriority.Low, 0) && shipGroup.leadShip !== null && isAiControlled(shipGroup.leadShip) && (shipGroupWarpSpeed(shipGroup) <= 0 || shipGroup.leadShip.currentSpeed < f(shipGroupWarpSpeed(shipGroup)))) {
            let num = shipGroupCalculateRefuellingPortion(galaxy, shipGroup);
            if (shipGroup.leadShip.parentHabitat !== null && shipGroup.leadShip.parentHabitat === shipGroup.gatherPoint) num = Math.max(num, 0.7);
            const r = shipGroupCheckShipsRequiringRefuelling(shipGroup, num);
            const num2 = r.count;
            if (num2 > Math.trunc(shipGroup.ships.length * 0.0)) {
                const requiredFuel = shipGroupCalculateRequiredFuel(shipGroup);
                assignFleetRefuellingExcludeGatheringShips(galaxy, empire, shipGroup, requiredFuel);
            }
        }
    }
    // 930-998: accepted pirate missions.
    if (empire.pirateMissions != null && empire.pirateMissions.count > 0) {
        for (let j = 0; j < empire.pirateMissions.count; j++) {
            const empireActivity = empire.pirateMissions.at(j);
            if (empireActivity === null || empireActivity.assignedEmpire !== empire || empireActivity.target === null) continue;
            const target = empireActivity.target;
            switch (empireActivity.type) {
                case EmpireActivityType.Attack: {
                    const shipGroupList = shipGroupListResolveFleetsWithAttackTarget(shipGroups, target as MissionTarget).fleets;
                    if (shipGroupList.length > 0) break;
                    let overallStrength = (target as { firepowerRaw?: number }).firepowerRaw ?? 0;
                    const targetIsBuiltObject = !('population' in target);
                    if (targetIsBuiltObject) overallStrength = calculateOverallStrengthFactor(target as BuiltObject);
                    const shipGroup3 = findNearestAvailableFleet(galaxy, empire, target.xpos, target.ypos, BuiltObjectMissionPriority.Normal, overallStrength, FleetPosture.Attack, ...fleetArgs(0));
                    if (shipGroup3 !== null && shipGroup3.leadShip !== null) {
                        let missionType2 = BuiltObjectMissionType.Attack;
                        if (targetIsBuiltObject) missionType2 = determineDestroyOrCaptureTargetForFleet(galaxy, empire, shipGroup3, target as BuiltObject);
                        if ((isAiControlled(shipGroup3.leadShip) || empire.controlMilitaryAttacks === AutomationLevel.PartiallyAutomated) && checkTaskAuthorized(galaxy, empire, empire.controlMilitaryAttacks, refusalCount, generateAutomationMessagePiratesMission(galaxy, 'Automation Pirate Attack Mission', empireActivity, shipGroup3), target, AdvisorMessageType.EnemyAttack, null, shipGroup3, null)) {
                            shipGroupAssignMission(galaxy, shipGroup3, missionType2, target as MissionTarget, null, BuiltObjectMissionPriority.High, false);
                        }
                    }
                    break;
                }
                case EmpireActivityType.Defend: {
                    const shipGroupList = shipGroupListResolveFleetsWithWaitTarget(shipGroups, target);
                    if (shipGroupList.length > 0) break;
                    let shipGroup2 = findNearestAvailableFleet(galaxy, empire, target.xpos, target.ypos, BuiltObjectMissionPriority.Normal, 1, FleetPosture.Defend, ...fleetArgs(0));
                    if (shipGroup2 === null) shipGroup2 = findNearestAvailableFleet(galaxy, empire, target.xpos, target.ypos, BuiltObjectMissionPriority.Normal, 1, FleetPosture.Attack, ...fleetArgs(0));
                    if (shipGroup2 !== null && shipGroup2.leadShip !== null) {
                        const missionType = BuiltObjectMissionType.MoveAndWait;
                        if (isAiControlled(shipGroup2.leadShip) && empire.controlMilitaryFleets) {
                            const expiryDate = empireActivity.expiryDate;
                            shipGroupAssignMission(galaxy, shipGroup2, missionType, target as MissionTarget, null, BuiltObjectMissionPriority.High, false, null, expiryDate);
                        } else if (checkTaskAuthorized(galaxy, empire, AutomationLevel.PartiallyAutomated, refusalCount, generateAutomationMessagePiratesMission(galaxy, 'Automation Pirate Defend Mission', empireActivity, shipGroup2), target, AdvisorMessageType.DefendTarget, null, shipGroup2, null)) {
                            const expiryDate2 = empireActivity.expiryDate;
                            shipGroupAssignMission(galaxy, shipGroup2, missionType, target as MissionTarget, null, BuiltObjectMissionPriority.High, false, null, expiryDate2);
                        }
                    }
                    break;
                }
            }
        }
    }
    // 999-1044: colonies to control.
    if (empire.troops.count > 0 && empire.colonizationTargets != null && empire.colonizationTargets.length > 0) {
        for (let k = 0; k < empire.colonizationTargets.length; k++) {
            const habitat = empire.colonizationTargets[k].habitat;
            if (habitat == null || habitat.hasBeenDestroyed) continue;
            let flag = true;
            const byFaction = habitat.pirateColonyControl.getByFaction(empire);
            const byFacilityControl = habitat.pirateColonyControl.getByFacilityControl();
            if (byFaction !== null && (byFaction.hasFacilityControl || byFacilityControl === null)) flag = false;
            if (habitat.empire === empire) flag = false;
            if (habitat.empire !== empire && habitat.empire !== galaxy.independentEmpire && habitat.empire !== null) {
                const pirateRelation = obtainPirateRelation(empire, habitat.empire);
                if (pirateRelation.type === PirateRelationType.Protection) flag = false;
            }
            if (!flag) continue;
            const shipGroup4 = findNearestAvailableFleet(galaxy, empire, habitat.xpos, habitat.ypos, BuiltObjectMissionPriority.Normal, 0, FleetPosture.Attack, ...fleetArgs(troopLevelRequired(galaxy, habitat, galaxy.difficultyLevel) * 100));
            if (shipGroup4 !== null && (isAiControlled(shipGroup4.leadShip!) || empire.controlMilitaryAttacks === AutomationLevel.PartiallyAutomated)) {
                const taskDescription = habitat.empire !== galaxy.independentEmpire ? generateAutomationMessageAttackEnemyColony(galaxy, habitat, false, shipGroup4) : generateAutomationMessageInvadeIndependent(galaxy, habitat, shipGroup4); // Empire.9.cs 1037
                if (checkTaskAuthorized(galaxy, empire, empire.controlMilitaryAttacks, refusalCount, taskDescription, habitat, AdvisorMessageType.EnemyAttack, null, shipGroup4, null)) {
                    shipGroupAssignMission(galaxy, shipGroup4, BuiltObjectMissionType.Attack, habitat, null, BuiltObjectMissionPriority.High, false);
                }
            }
        }
    }
    // 1045-1088: raid enemy mining stations.
    let valueThreshold = 1.0;
    let maximumDefenseStrength = 40000;
    switch (empire.piratePlayStyle) {
        case PiratePlayStyle.Mercenary:
            valueThreshold = 0.0;
            maximumDefenseStrength = 120000;
            break;
        case PiratePlayStyle.Pirate:
            valueThreshold = 0.5;
            maximumDefenseStrength = 80000;
            break;
    }
    const habitatPrioritizationList = identifyDesiredEnemyMiningStations(galaxy, empire, 5, true, valueThreshold);
    if (habitatPrioritizationList.length > 0) {
        for (let l = 0; l < habitatPrioritizationList.length; l++) {
            const habitatPrioritization = habitatPrioritizationList[l];
            if (habitatPrioritization == null || habitatPrioritization.habitat === null) continue;
            const builtObject2 = determineMiningStationAtHabitat(habitatPrioritization.habitat) as BuiltObject | null;
            if (builtObject2 == null) continue;
            const overallStrength2 = calculateDefendingStrength(galaxy, empire, builtObject2).strength;
            const shipGroup5 = findNearestAvailableFleet(galaxy, empire, builtObject2.xpos, builtObject2.ypos, BuiltObjectMissionPriority.Normal, overallStrength2, FleetPosture.Attack, ...fleetArgs(0));
            if (shipGroup5 === null || !shipGroupCheckFleetTargetWithinFuelRangeAndRefuel(galaxy, shipGroup5, builtObject2.xpos, builtObject2.ypos, 0.1) || (!isAiControlled(shipGroup5.leadShip!) && empire.controlMilitaryAttacks !== AutomationLevel.PartiallyAutomated)) continue;
            const firstByTargetAndType = empire.pirateMissions.getFirstByTargetAndType(builtObject2, EmpireActivityType.Defend);
            if (firstByTargetAndType === null) {
                if (checkTaskAuthorized(galaxy, empire, empire.controlMilitaryAttacks, refusalCount, generateAutomationMessageRaidBase(galaxy, builtObject2, shipGroup5), builtObject2, AdvisorMessageType.PirateRaid, null, shipGroup5, null)) {
                    shipGroupAssignMission(galaxy, shipGroup5, BuiltObjectMissionType.Raid, builtObject2, null, BuiltObjectMissionPriority.High, false);
                }
                break;
            }
        }
    }
    // 1089-1116: raid colonies.
    const habitatPrioritizationList2 = identifyRaidableColonies(galaxy, empire, maximumDefenseStrength, valueThreshold);
    if (habitatPrioritizationList2.length > 0) {
        for (let m = 0; m < habitatPrioritizationList2.length; m++) {
            const habitatPrioritization2 = habitatPrioritizationList2[m];
            if (habitatPrioritization2 == null || habitatPrioritization2.habitat === null) continue;
            const h2 = habitatPrioritization2.habitat;
            const ds = calculateDefendingStrength(galaxy, empire, h2);
            const overallStrength3 = ds.strength;
            const troopStrength = ds.troopStrength;
            const shipGroup6 = findNearestAvailableFleet(galaxy, empire, h2.xpos, h2.ypos, BuiltObjectMissionPriority.Normal, overallStrength3, FleetPosture.Attack, ...fleetArgs(0, Math.trunc(troopStrength * 0.5)));
            if (shipGroup6 === null || !shipGroupCheckFleetTargetWithinFuelRangeAndRefuel(galaxy, shipGroup6, h2.xpos, h2.ypos, 0.1) || (!isAiControlled(shipGroup6.leadShip!) && empire.controlMilitaryAttacks !== AutomationLevel.PartiallyAutomated)) continue;
            const firstByTargetAndType2 = empire.pirateMissions.getFirstByTargetAndType(h2, EmpireActivityType.Defend);
            if (firstByTargetAndType2 === null) {
                if (checkTaskAuthorized(galaxy, empire, empire.controlMilitaryAttacks, refusalCount, generateAutomationMessageRaidColony(galaxy, h2, shipGroup6), h2, AdvisorMessageType.PirateRaid, null, shipGroup6, null)) {
                    shipGroupAssignMission(galaxy, shipGroup6, BuiltObjectMissionType.Raid, h2, null, BuiltObjectMissionPriority.High, false);
                }
                break;
            }
        }
    }
    // 1117-1140: attack the pirate relation with the lowest evaluation.
    const relationWithLowestEvaluation = empire.pirateRelations.getRelationWithLowestEvaluation();
    if (relationWithLowestEvaluation !== null && relationWithLowestEvaluation.type === PirateRelationType.None && relationWithLowestEvaluation.evaluation < f(-15) && relationWithLowestEvaluation.otherEmpire !== null) {
        const other = relationWithLowestEvaluation.otherEmpire;
        let builtObject3: BuiltObject | null = null;
        if (other.pirateEmpireBaseHabitat !== null) builtObject3 = findNearestKnownBaseForPirateAttackOwn(galaxy, empire, other.pirateEmpireBaseHabitat.xpos, other.pirateEmpireBaseHabitat.ypos);
        else if (other.capital !== null) builtObject3 = findNearestKnownBaseForPirateAttackOwn(galaxy, empire, other.capital.xpos, other.capital.ypos);
        if (builtObject3 !== null && !builtObject3.hasBeenDestroyed) {
            const overallStrength4 = calculateDefendingStrength(galaxy, empire, builtObject3).strength;
            const shipGroup7 = findNearestAvailableFleet(galaxy, empire, builtObject3.xpos, builtObject3.ypos, BuiltObjectMissionPriority.Normal, overallStrength4, FleetPosture.Attack, ...fleetArgs(0));
            if (shipGroup7 !== null && shipGroup7.leadShip !== null) {
                const missionType3 = determineDestroyOrCaptureTargetForFleet(galaxy, empire, shipGroup7, builtObject3);
                if ((isAiControlled(shipGroup7.leadShip) || empire.controlMilitaryAttacks === AutomationLevel.PartiallyAutomated) && checkTaskAuthorized(galaxy, empire, empire.controlMilitaryAttacks, refusalCount, generateAutomationMessagePiratesAttackPirates(galaxy, builtObject3, shipGroup7), builtObject3, AdvisorMessageType.EnemyAttack, null, shipGroup7, null)) {
                    shipGroupAssignMission(galaxy, shipGroup7, missionType3, builtObject3, null, BuiltObjectMissionPriority.High, false);
                }
            }
        }
    }
    // 1141-1159: keep the first spaceports defended.
    if (empire.spacePorts == null) return;
    const num3 = Math.max(1, Math.trunc(empire.shipGroups.length * 0.2));
    for (let n = 0; n < empire.spacePorts.length; n++) {
        const builtObject4 = empire.spacePorts[n];
        if (builtObject4 != null && !builtObject4.hasBeenDestroyed && builtObject4.empire === empire) {
            if (n >= num3) break;
            ensureBaseDefendedByFleet(galaxy, empire, builtObject4);
        }
    }
}
