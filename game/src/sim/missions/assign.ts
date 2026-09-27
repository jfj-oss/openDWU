// M4b — mission assignment on a BuiltObject: AssignMission (BuiltObject.2.cs 7555-7732), ClearPreviousMissionRequirements
// (BuiltObject.1.cs 1356-1518), CheckCancelContracts (BuiltObject.2.cs 5149), InitiateUndeploy (BuiltObject.cs 1758),
// RecordRevertMission / RevertToPreviousMission (BuiltObject.2.cs 4581-4704), AssignQueuedMission
// (BaconBuiltObject.cs 4007, replacing BuiltObject.2.cs 4940) + CheckAndAssignRepeatingMission (3976),
// BaconBuiltObject.ClearCargo (4278). Free functions, C# `this` first (plan §3.1 rule 2).
// Rnd: none directly; the BuiltObjectMission constructor draws through ResolveCommandsForMission (resolveCommands.ts).

import type { Galaxy } from '../galaxy';
import { registerTodo, todo } from '../tick/todo';
import type { BuiltObject, DockingBay } from '../builtObject';
import type { CargoList, TroopList } from '../cargo';
import type { PopulationList } from '../population';
import type { Design } from '../design';
import { BuiltObjectRole } from '../data/designSpecifications';
import { BuiltObjectSubRole } from '../builtObjectTypes';
import { empireShipGroups, forceCompleteMission } from '../fleets/shipGroup';
import { withinFuelRange, withinFuelRangeAndRefuel, updatePosition } from '../movement';
import { autoRefuelRepairShip, checkCancelRefuelData, initiateRefuelData } from '../logistics/refuel';
import { cancelContract, type Contract } from '../logistics/contracts';
import { startNewBattleStats } from '../combat/damage';
import { implementBlockade } from '../fleets/militaryAI';
import { assignRetrofitMission, determineHabitatsBeingMinedIncludingBuildingMiningStations, determineHabitatsWithBasesIncludingBuilding } from '../construction/empireConstruction';
import { checkForPlanetDestroyerWeaponFiringDelayOnHyperExit } from '../combat/weapons';
import { isFighter } from '../combat/fighters';
import {
    BuiltObjectMission,
    BuiltObjectMissionPriority,
    BuiltObjectMissionType,
    CommandAction,
    COORD_UNSET_DOUBLE,
    builtObjectMission,
    builtObjectSubsequentMissions,
    isBuiltObject,
    isCreature,
    isHabitat,
    type MissionTarget,
    type StellarObject,
} from './mission';
import { scenarioQuery } from '../scenario/hooks';

/** Optional arguments of the 13-argument AssignMission (BuiltObject.2.cs 7620); every overload is a subset. */
export interface AssignMissionArgs {
    cargo?: CargoList | null;
    troops?: TroopList | null;
    population?: PopulationList | null;
    design?: Design | null;
    x?: number;
    y?: number;
    starDate?: number;
    /** C# overloads without the flag pass `allowReprocessing: true`. */
    allowReprocessing?: boolean;
    manuallyAssigned?: boolean;
}

/** BuiltObject._DeployProgress / _IsDeployed are private in builtObject.ts (M3a); the C# writes them from here. */
interface DeployFields {
    _deployProgress: number;
    _isDeployed: boolean;
}
function deployFields(bo: BuiltObject): DeployFields {
    return bo as unknown as DeployFields;
}

/** StellarObject members read by ClearPreviousMissionRequirements / ClearParent on a `builtAt` / `dockedAt` (typed `unknown` in builtObject.ts). */
export interface DockHost {
    dockingBayWaitQueue: BuiltObject[] | null;
    dockingBays: DockingBay[] | null;
    constructionQueue: unknown;
}
/** ConstructionQueue members read here (M4h owns the class; duck-typed until it lands). */
export interface ConstructionQueueLike {
    constructionYards: { shipUnderConstruction: BuiltObject | null; incrementalProgress: number }[] | null;
    constructionWaitQueue: BuiltObject[] | null;
    clear(): void;
}
export function dockHost(o: unknown): DockHost | null {
    return (o as DockHost | null) ?? null;
}
export function constructionQueueOf(o: unknown): ConstructionQueueLike | null {
    return (o as ConstructionQueueLike | null) ?? null;
}

/** BaconBuiltObject.cs 3528 AssignMissionCheckPreconditions: false only with a "sleep" BaconValue (player UI feature). */
export function assignMissionCheckPreconditions(ship: BuiltObject): boolean {
    // TODO(port): BaconValues["sleep"] (player-only mod feature; never set for AI ships) — always true.
    void ship;
    return true;
}

/**
 * BuiltObject.2.cs 7620 AssignMission(missionType, target, target2, cargo, troops, population, design, x, y, starDate,
 * priority, allowReprocessing, manuallyAssigned). The 12 overloads (7555-7618) map onto `args` defaults:
 * null lists/design, x/y -2000000001.0, starDate -1, allowReprocessing true, manuallyAssigned false.
 */
export function assignMission(galaxy: Galaxy, bo: BuiltObject, missionType: BuiltObjectMissionType, target: MissionTarget | null, target2: MissionTarget | null, priority: BuiltObjectMissionPriority, args: AssignMissionArgs = {}): void {
    const cargo = args.cargo ?? null;
    const troops = args.troops ?? null;
    const population = args.population ?? null;
    const design = args.design ?? null;
    const x = args.x ?? COORD_UNSET_DOUBLE;
    const y = args.y ?? COORD_UNSET_DOUBLE;
    const starDate = args.starDate ?? -1;
    const allowReprocessing = args.allowReprocessing ?? true;
    const manuallyAssigned = args.manuallyAssigned ?? false;
    // 7622-7625
    if (bo.role === BuiltObjectRole.Base || !assignMissionCheckPreconditions(bo)) {
        return;
    }
    // Mod layer: a scenario may refuse the mission (e.g. 19g-3 demilitarised systems); no scenario = no call.
    if (galaxy.scenario !== null && !scenarioQuery(galaxy, 'assignMissionAllowed', true, { builtObject: bo, missionType, target, x, y })) return;
    // 7626-7634
    if (manuallyAssigned) {
        bo.revertMission = null;
    }
    bo.missionCompleteMessageSent = false;
    bo.hyperEnterStartAnimation = false;
    bo.hyperExitStartAnimation = false;
    bo.hyperjumpAboutToEnter = false;
    bo.hyperjumpPrepare = false;
    // 7635-7646
    switch (missionType) {
        case BuiltObjectMissionType.Attack:
        case BuiltObjectMissionType.WaitAndAttack:
        case BuiltObjectMissionType.WaitAndBombard:
        case BuiltObjectMissionType.Bombard:
        case BuiltObjectMissionType.Capture:
        case BuiltObjectMissionType.Raid:
            // BaconSpaceBattleStats.AddLatestCombatStats(this, BattleStats); BattleStats = new SpaceBattleStats();
            startNewBattleStats(galaxy, bo);
            break;
    }
    // 7647-7658
    const mission = builtObjectMission(bo.mission);
    if (mission !== null && (mission.type === BuiltObjectMissionType.Attack || mission.type === BuiltObjectMissionType.Capture || mission.type === BuiltObjectMissionType.Raid)) {
        if (mission.targetBuiltObject !== null) {
            removePursuer(mission.targetBuiltObject, bo);
        }
        if (mission.targetCreature !== null) {
            removePursuer(mission.targetCreature, bo);
        }
        bo.colonyToAttack = null;
    }
    // 7659-7662
    if (bo.isDeployed) {
        initiateUndeploy(galaxy, bo);
    }
    // 7663-7689
    if (missionType === BuiltObjectMissionType.Attack || missionType === BuiltObjectMissionType.Capture || missionType === BuiltObjectMissionType.Raid) {
        if (isBuiltObject(target)) {
            const pursuers = target.pursuers as BuiltObject[] | null;
            if (pursuers !== null && !pursuers.includes(bo)) {
                pursuers.push(bo);
            }
        } else if (isCreature(target)) {
            const pursuers = creaturePursuers(target);
            if (pursuers !== null && !pursuers.includes(bo)) {
                pursuers.push(bo);
            }
        } else if (isFighter(target)) {
            // 7681-7688 (M4p): a Fighter target (only a player order can make one a mission target).
            const pursuers = target.pursuers;
            if (!pursuers.includes(bo)) pursuers.push(bo);
        }
    }
    // 7690-7693
    if (missionType === BuiltObjectMissionType.Refuel && target !== null && (isBuiltObject(target) || isHabitat(target) || isCreature(target) || isFighter(target))) {
        // `target is StellarObject` (BuiltObject | Habitat | Creature | Fighter).
        initiateRefuelData(galaxy, bo, target);
    }
    // 7694-7698
    const builtObjectMissionNew = new BuiltObjectMission(galaxy, bo, missionType, target, target2, priority, { cargo, troops, population, design, x, y, starDate, allowReprocessing });
    builtObjectMissionNew.manuallyAssigned = manuallyAssigned;
    bo.mission = builtObjectMissionNew;
    bo.firstExecutionOfCommand = true;
    // 7699-7731
    if (bo.empire !== null) {
        let num = bo.empire.attackRangePatrol;
        let num2 = bo.empire.attackRangeEscort;
        let num3 = bo.empire.attackRangeAttack;
        let num4 = bo.empire.attackRangeOther;
        if (!bo.isAutoControlled || manuallyAssigned) {
            num = bo.empire.attackRangePatrolManual;
            num2 = bo.empire.attackRangeEscortManual;
            num3 = bo.empire.attackRangeAttackManual;
            num4 = bo.empire.attackRangeOtherManual;
        }
        if (missionType === BuiltObjectMissionType.Patrol && num >= 0) {
            bo.attackRangeSquared = Math.fround(Math.fround(num) * Math.fround(num));
        } else if (missionType === BuiltObjectMissionType.Escort && num2 >= 0) {
            bo.attackRangeSquared = Math.fround(Math.fround(num2) * Math.fround(num2));
        } else if (
            (missionType === BuiltObjectMissionType.Attack ||
                missionType === BuiltObjectMissionType.Bombard ||
                missionType === BuiltObjectMissionType.WaitAndAttack ||
                missionType === BuiltObjectMissionType.WaitAndBombard ||
                missionType === BuiltObjectMissionType.Capture ||
                missionType === BuiltObjectMissionType.Raid) &&
            num3 >= 0
        ) {
            bo.attackRangeSquared = Math.fround(Math.fround(num3) * Math.fround(num3));
        } else if (num4 >= 0) {
            bo.attackRangeSquared = Math.fround(Math.fround(num4) * Math.fround(num4));
        } else if (bo.attackRangeSquared < 0 && bo.isAutoControlled) {
            bo.attackRangeSquared = Math.fround(2.304e9);
        }
    }
}

/** `list.Remove(item)` on a StellarObjectList (first occurrence). */
function removeFromList(list: unknown[] | null, item: unknown): void {
    if (list === null) return;
    const index = list.indexOf(item);
    if (index >= 0) list.splice(index, 1);
}

/** Creature.Pursuers — TODO(port) M4n/M4u: creature.ts has no Pursuers list yet (null ⇒ the C# null checks skip). */
function creaturePursuers(creature: unknown): BuiltObject[] | null {
    return (creature as { pursuers?: BuiltObject[] | null }).pursuers ?? null;
}

function removePursuer(target: StellarObject, bo: BuiltObject): void {
    if (isBuiltObject(target)) {
        removeFromList(target.pursuers, bo);
    } else if (isCreature(target)) {
        removeFromList(creaturePursuers(target), bo);
    }
}

/** BaconBuiltObject.cs 4278 ClearCargo(ship): auto-controlled ships drop their cargo. */
export function baconClearCargo(ship: BuiltObject): void {
    if (!ship.isAutoControlled) return;
    ship.cargo!.clear();
}

/** BuiltObject.2.cs 5149 CheckCancelContracts. */
export function checkCancelContracts(galaxy: Galaxy, bo: BuiltObject): void {
    const contracts = bo.contractsToFulfill;
    if (contracts === null || contracts.length <= 0) {
        return;
    }
    for (let i = 0; i < contracts.length; i++) {
        const contract = contracts[i];
        if (contract != null) {
            cancelContract(galaxy, contract as Contract);
        }
    }
    contracts.length = 0;
}

/** BuiltObject.cs 1758 InitiateUndeploy. */
export function initiateUndeploy(galaxy: Galaxy, bo: BuiltObject): void {
    if (bo.subRole === BuiltObjectSubRole.ResupplyShip && bo.empire !== null) {
        const shipGroups = empireShipGroups(bo.empire);
        if (shipGroups !== null) {
            for (let i = 0; i < shipGroups.length; i++) {
                const shipGroup = shipGroups[i]!;
                if (shipGroup.mission !== null && (shipGroup.mission.targetBuiltObject === bo || shipGroup.mission.secondaryTargetBuiltObject === bo)) {
                    forceCompleteMission(galaxy, shipGroup);
                }
            }
        }
        for (let j = 0; j < bo.empire.builtObjects.length; j++) {
            const builtObject = bo.empire.builtObjects[j];
            const m = builtObjectMission(builtObject.mission);
            if (m !== null && (m.targetBuiltObject === bo || m.secondaryTargetBuiltObject === bo)) {
                clearPreviousMissionRequirements(galaxy, builtObject);
            }
        }
    }
    const d = deployFields(bo);
    d._isDeployed = false;
    d._deployProgress = Math.fround(-0.01);
}

/** BuiltObject.1.cs 1356/1361 ClearPreviousMissionRequirements([manuallyAssigned]). */
export function clearPreviousMissionRequirements(galaxy: Galaxy, bo: BuiltObject, manuallyAssigned = false): void {
    const mission = builtObjectMission(bo.mission);
    if (mission !== null) {
        // 1365-1368
        const targetBuiltObject = mission.targetBuiltObject;
        const targetCreature = mission.targetCreature;
        const troops = mission.troops;
        // 1369-1399
        switch (mission.type) {
            case BuiltObjectMissionType.Patrol:
            case BuiltObjectMissionType.Escort:
            case BuiltObjectMissionType.Attack:
            case BuiltObjectMissionType.WaitAndAttack:
            case BuiltObjectMissionType.WaitAndBombard:
            case BuiltObjectMissionType.Bombard:
            case BuiltObjectMissionType.Capture:
            case BuiltObjectMissionType.Raid:
                if (targetBuiltObject !== null && targetBuiltObject.pursuers !== null) {
                    removeFromList(targetBuiltObject.pursuers, bo);
                }
                if (targetCreature !== null && creaturePursuers(targetCreature) !== null) {
                    removeFromList(creaturePursuers(targetCreature), bo);
                }
                bo.colonyToAttack = null;
                break;
            case BuiltObjectMissionType.LoadTroops:
                // 1389-1394: an empty loop over the troops.
                if (troops !== null && troops.count > 0) {
                    for (let i = 0; i < troops.count; i++) {
                        // (empty)
                    }
                }
                break;
            case BuiltObjectMissionType.Refuel:
                checkCancelRefuelData(galaxy, bo);
                break;
        }
        // 1400-1407
        if (bo.role === BuiltObjectRole.Freight || bo.subRole === BuiltObjectSubRole.ConstructionShip) {
            checkCancelContracts(galaxy, bo);
            if (bo.role === BuiltObjectRole.Freight && bo.cargo !== null) {
                baconClearCargo(bo);
            }
        }
        // 1408-1436
        let stellarObject: DockHost | null = null;
        const command = mission.fastPeekCurrentCommand();
        if (command !== null && command.action === CommandAction.Dock) {
            if (command.targetBuiltObject !== null) {
                stellarObject = command.targetBuiltObject;
            } else if (command.targetHabitat !== null) {
                stellarObject = command.targetHabitat;
            }
        }
        if (stellarObject === null) {
            if (bo.parentBuiltObject !== null) {
                stellarObject = bo.parentBuiltObject;
            } else if (bo.parentHabitat !== null) {
                stellarObject = bo.parentHabitat;
            }
        }
        if (stellarObject !== null && stellarObject.dockingBayWaitQueue !== null) {
            while (stellarObject.dockingBayWaitQueue.includes(bo)) {
                removeFromList(stellarObject.dockingBayWaitQueue, bo);
            }
        }
    }
    // 1438-1448
    if (bo.role !== BuiltObjectRole.Base) {
        const manufacturingQueue = bo.manufacturingQueue as { clear(): void } | null;
        if (manufacturingQueue !== null) {
            manufacturingQueue.clear();
        }
        const constructionQueue = constructionQueueOf(bo.constructionQueue);
        if (constructionQueue !== null) {
            constructionQueue.clear();
        }
    }
    // 1449-1455
    if (bo.role !== BuiltObjectRole.Base || bo.parentHabitat === null) {
        bo.parentOffsetX = -2000000001.0;
        bo.parentOffsetY = -2000000001.0;
        bo.parentBuiltObject = null;
        bo.parentHabitat = null;
    }
    // 1456-1476
    const dockedAt = dockHost(bo.dockedAt);
    if (dockedAt !== null) {
        if (dockedAt.dockingBayWaitQueue !== null && dockedAt.dockingBayWaitQueue.includes(bo)) {
            removeFromList(dockedAt.dockingBayWaitQueue, bo);
        }
        const dockingBays = dockedAt.dockingBays;
        if (dockingBays !== null) {
            for (let j = 0; j < dockingBays.length; j++) {
                const dockingBay = dockingBays[j];
                if (dockingBay != null && dockingBay.dockedShip === bo) {
                    dockingBay.dockedShip = null;
                }
            }
        }
    }
    bo.dockedAt = null;
    // 1477-1501
    const builtAt = dockHost(bo.builtAt);
    if (builtAt === null && bo.retrofitDesign !== null) {
        bo.retrofitDesign = null;
    }
    if (builtAt !== null) {
        const constructionQueue = constructionQueueOf(builtAt.constructionQueue);
        if (constructionQueue !== null) {
            const constructionYards = constructionQueue.constructionYards;
            if (constructionYards !== null) {
                for (let k = 0; k < constructionYards.length; k++) {
                    const constructionYard = constructionYards[k];
                    if (constructionYard != null && constructionYard.shipUnderConstruction === bo) {
                        constructionYard.shipUnderConstruction = null;
                    }
                }
            }
        }
    }
    bo.builtAt = null;
    // 1502-1517
    if (manuallyAssigned) {
        bo.revertMission = null;
    }
    mission?.clear();
    bo.firstExecutionOfCommand = true;
    if (bo.currentSpeed > Math.fround(bo.topSpeed)) {
        bo.currentSpeed = bo.cruiseSpeed;
        bo.targetSpeed = bo.cruiseSpeed;
        updatePosition(galaxy, bo);
        checkForPlanetDestroyerWeaponFiringDelayOnHyperExit(galaxy, bo, galaxy.nowMs);
    }
}

/** BuiltObject.2.cs 4581/4586 RecordRevertMission(newMissionType[, evenWhenAutomated]). */
export function recordRevertMission(galaxy: Galaxy, bo: BuiltObject, newMissionType: BuiltObjectMissionType, evenWhenAutomated = false): void {
    if (!evenWhenAutomated && bo.isAutoControlled) {
        return;
    }
    let builtObjectMissionClone: BuiltObjectMission | null = null;
    const mission = builtObjectMission(bo.mission);
    if (mission === null) {
        return;
    }
    builtObjectMissionClone = mission.clone();
    switch (newMissionType) {
        case BuiltObjectMissionType.Attack:
        case BuiltObjectMissionType.Escape:
        case BuiltObjectMissionType.Retrofit:
        case BuiltObjectMissionType.Refuel:
        case BuiltObjectMissionType.Repair:
        case BuiltObjectMissionType.Capture:
            if (bo.revertMission === null) {
                if (builtObjectMissionClone.type === BuiltObjectMissionType.WaitAndAttack) {
                    builtObjectMissionClone = new BuiltObjectMission(galaxy, bo, BuiltObjectMissionType.Attack, builtObjectMissionClone.target, null, BuiltObjectMissionPriority.High);
                } else if (builtObjectMissionClone.type === BuiltObjectMissionType.WaitAndBombard) {
                    builtObjectMissionClone = new BuiltObjectMission(galaxy, bo, BuiltObjectMissionType.Bombard, builtObjectMissionClone.target, null, BuiltObjectMissionPriority.High);
                }
                bo.revertMission = builtObjectMissionClone;
            }
            break;
    }
}

/** BuiltObject.2.cs 4622 RevertToPreviousMission. */
export function revertToPreviousMission(galaxy: Galaxy, bo: BuiltObject): boolean {
    if (autoRefuelRepairShip(galaxy, bo, true)) {
        return true;
    }
    const revertMission = bo.revertMission;
    if (revertMission !== null) {
        // 4631: `!(X <= -2.00000013E+09f)` — X is a BuiltObjectMission float (unset = -2.00001E+09f, which IS <= that).
        const commandUnset = Math.fround(-2.00000013e9);
        if (revertMission.type === BuiltObjectMissionType.Explore || revertMission.target !== null || revertMission.secondaryTarget !== null || !(revertMission.x <= commandUnset) || !(revertMission.y <= commandUnset)) {
            let flag = true;
            if (revertMission.type === BuiltObjectMissionType.Explore) {
                if (revertMission.targetHabitat !== null && bo.empire !== null && bo.empire.resourceMap != null && bo.empire.resourceMap.checkResourcesKnown(revertMission.targetHabitat)) {
                    flag = false;
                }
            } else if (revertMission.type === BuiltObjectMissionType.Build && revertMission.targetHabitat !== null && bo.empire !== null && revertMission.design !== null) {
                switch (revertMission.design.subRole) {
                    case BuiltObjectSubRole.GasMiningStation:
                    case BuiltObjectSubRole.MiningStation: {
                        const habitatList4 = determineHabitatsBeingMinedIncludingBuildingMiningStations(galaxy, bo.empire, false);
                        if (habitatList4.includes(revertMission.targetHabitat)) {
                            flag = false;
                        }
                        break;
                    }
                    case BuiltObjectSubRole.EnergyResearchStation:
                    case BuiltObjectSubRole.WeaponsResearchStation:
                    case BuiltObjectSubRole.HighTechResearchStation: {
                        const habitatList2 = determineHabitatsWithBasesIncludingBuilding(galaxy, bo.empire, [BuiltObjectSubRole.EnergyResearchStation, BuiltObjectSubRole.HighTechResearchStation, BuiltObjectSubRole.WeaponsResearchStation]);
                        if (habitatList2.includes(revertMission.targetHabitat)) {
                            flag = false;
                        }
                        break;
                    }
                    case BuiltObjectSubRole.MonitoringStation: {
                        const habitatList3 = determineHabitatsWithBasesIncludingBuilding(galaxy, bo.empire, [BuiltObjectSubRole.MonitoringStation]);
                        if (habitatList3.includes(revertMission.targetHabitat)) {
                            flag = false;
                        }
                        break;
                    }
                    case BuiltObjectSubRole.ResortBase: {
                        const habitatList = determineHabitatsWithBasesIncludingBuilding(galaxy, bo.empire, [BuiltObjectSubRole.ResortBase]);
                        if (habitatList.includes(revertMission.targetHabitat)) {
                            flag = false;
                        }
                        break;
                    }
                }
            }
            if (flag) {
                assignMission(galaxy, bo, revertMission.type, revertMission.target, revertMission.secondaryTarget, revertMission.priority, {
                    cargo: revertMission.cargo,
                    troops: revertMission.troops,
                    population: revertMission.population,
                    design: revertMission.design,
                    x: revertMission.x,
                    y: revertMission.y,
                    starDate: revertMission.starDate,
                    allowReprocessing: false,
                });
                const mission = builtObjectMission(bo.mission);
                if (mission !== null && revertMission.targetSector !== null) {
                    mission.setTargetSector(revertMission.targetSector);
                }
            }
        }
        bo.revertMission = null;
        return true;
    }
    return false;
}

/** BaconBuiltObject.cs 3976 CheckAndAssignRepeatingMission: BaconValues-driven player features (ShipNote, RepeatingMission). */
export function checkAndAssignRepeatingMission(galaxy: Galaxy, ship: BuiltObject): boolean {
    // TODO(port): BaconValues dictionary (player-only "ShipNote" message box and "RepeatingMission" cargo/passenger
    // re-assignment) — BaconValues is null for every ship the simulation creates, so the C# returns false here.
    void galaxy;
    void ship;
    return false;
}

/** BaconBuiltObject.cs 4007 AssignQueuedMission(ship, allowReprocessing) (BuiltObject.2.cs 4940 delegates here). */
export function assignQueuedMission(galaxy: Galaxy, ship: BuiltObject, allowReprocessing = true): boolean {
    const subsequentMissions = builtObjectSubsequentMissions(ship);
    if (subsequentMissions === null || subsequentMissions.length <= 0) {
        return checkAndAssignRepeatingMission(galaxy, ship);
    }
    const subsequentMission = subsequentMissions[0];
    if (subsequentMission.type === BuiltObjectMissionType.Blockade) {
        if (subsequentMission.targetBuiltObject !== null) {
            const t = subsequentMission.targetBuiltObject;
            if (!subsequentMission.manuallyAssigned ? withinFuelRangeAndRefuel(galaxy, ship, t.xpos, t.ypos, 0.0) : withinFuelRange(galaxy, ship, t.xpos, t.ypos, 0.0)) {
                implementBlockade(galaxy, ship.empire!, t, false, false);
                clearPreviousMissionRequirements(galaxy, ship);
                assignMission(galaxy, ship, BuiltObjectMissionType.Blockade, t, null, BuiltObjectMissionPriority.Normal);
            }
        } else if (subsequentMission.targetHabitat !== null) {
            const t = subsequentMission.targetHabitat;
            if (!subsequentMission.manuallyAssigned ? withinFuelRangeAndRefuel(galaxy, ship, t.xpos, t.ypos, 0.0) : withinFuelRange(galaxy, ship, t.xpos, t.ypos, 0.0)) {
                implementBlockade(galaxy, ship.empire!, t, false, false);
                clearPreviousMissionRequirements(galaxy, ship);
                assignMission(galaxy, ship, BuiltObjectMissionType.Blockade, t, null, BuiltObjectMissionPriority.Normal);
            }
        }
    } else if (subsequentMission.type === BuiltObjectMissionType.Refuel) {
        clearPreviousMissionRequirements(galaxy, ship);
        assignMission(galaxy, ship, subsequentMission.type, subsequentMission.target, subsequentMission.secondaryTarget, subsequentMission.priority, {
            cargo: subsequentMission.cargo,
            troops: subsequentMission.troops,
            population: subsequentMission.population,
            design: subsequentMission.design,
            x: subsequentMission.x,
            y: subsequentMission.y,
            starDate: subsequentMission.starDate,
            allowReprocessing,
        });
    } else if (subsequentMission.type === BuiltObjectMissionType.Retrofit) {
        if (ship.empire !== null) {
            clearPreviousMissionRequirements(galaxy, ship);
            assignRetrofitMission(galaxy, ship.empire, ship);
        }
    } else {
        const point = subsequentMission.resolveTargetCoordinates(subsequentMission);
        if (!subsequentMission.manuallyAssigned ? withinFuelRangeAndRefuel(galaxy, ship, point.x, point.y, 0.0) : withinFuelRange(galaxy, ship, point.x, point.y, 0.0)) {
            clearPreviousMissionRequirements(galaxy, ship);
            assignMission(galaxy, ship, subsequentMission.type, subsequentMission.target, subsequentMission.secondaryTarget, subsequentMission.priority, {
                cargo: subsequentMission.cargo,
                troops: subsequentMission.troops,
                population: subsequentMission.population,
                design: subsequentMission.design,
                x: subsequentMission.x,
                y: subsequentMission.y,
                starDate: subsequentMission.starDate,
                allowReprocessing,
            });
        }
    }
    if (subsequentMissions.length > 0) {
        subsequentMissions.splice(0, 1);
    }
    return true;
}

// ---- stub added by M4u (Habitat.cs 7685 CompleteTeardown) ----

/**
 * BuiltObject.2.cs 5751 ClearAllMissionsForTarget(builtObject, Habitat target, missionType, dropOutOfHyperspace) (5746:
 * Undefined, false). Ported by M4q (invasion / ownership transfer cancels attacks on a colony). No Rnd. `bo` is the C#
 * `this` (the hyper-exit check runs on it, as in the C#).
 */
export function clearAllMissionsForTargetHabitat(galaxy: Galaxy, bo: BuiltObject, builtObject: BuiltObject | null, target: import('../types').Habitat, missionType: BuiltObjectMissionType, dropOutOfHyperspace: boolean): void {
    if (builtObject === null) {
        return;
    }
    const mission = builtObject.mission as BuiltObjectMission | null;
    if (mission !== null && (missionType === BuiltObjectMissionType.Undefined || mission.type === missionType)) {
        if (mission.targetHabitat !== null && mission.targetHabitat === target) {
            clearPreviousMissionRequirements(galaxy, builtObject);
            if (dropOutOfHyperspace && builtObject.currentSpeed > Math.fround(builtObject.topSpeed)) {
                builtObject.currentSpeed = builtObject.cruiseSpeed;
                builtObject.targetSpeed = builtObject.cruiseSpeed;
                checkForPlanetDestroyerWeaponFiringDelayOnHyperExit(galaxy, bo, galaxy.nowMs);
            }
        }
        if (mission.secondaryTargetHabitat !== null && mission.secondaryTargetHabitat === target) {
            clearPreviousMissionRequirements(galaxy, builtObject);
            if (dropOutOfHyperspace && builtObject.currentSpeed > Math.fround(builtObject.topSpeed)) {
                builtObject.currentSpeed = builtObject.cruiseSpeed;
                builtObject.targetSpeed = builtObject.cruiseSpeed;
                checkForPlanetDestroyerWeaponFiringDelayOnHyperExit(galaxy, bo, galaxy.nowMs);
            }
        }
    }
    const subsequentMissions = builtObject.subsequentMissions as BuiltObjectMission[];
    let builtObjectMissionList: BuiltObjectMission[] | null = null;
    for (let i = 0; i < subsequentMissions.length; i++) {
        const m = subsequentMissions[i];
        if (m == null || (missionType !== BuiltObjectMissionType.Undefined && m.type !== missionType)) {
            continue;
        }
        if (m.targetHabitat !== null && m.targetHabitat === target) {
            if (builtObjectMissionList === null) builtObjectMissionList = [];
            builtObjectMissionList.push(m);
        }
        if (m.secondaryTargetHabitat !== null && m.secondaryTargetHabitat === target) {
            if (builtObjectMissionList === null) builtObjectMissionList = [];
            builtObjectMissionList.push(m);
        }
    }
    if (builtObjectMissionList !== null) {
        for (let j = 0; j < builtObjectMissionList.length; j++) {
            const idx = subsequentMissions.indexOf(builtObjectMissionList[j]);
            if (idx >= 0) subsequentMissions.splice(idx, 1);
        }
    }
}

/**
 * BuiltObject.2.cs 7506-7548 QueueMission overloads, all through the 11-argument one (7541): non-bases get a
 * BuiltObjectMission (allowReprocessing true, allowBuiltObjectChanges false) appended to _SubsequentMissions. The
 * overloads map onto `args` defaults (null lists / design, x/y -2000000001.0, starDate -1). No Rnd.
 */
export function queueMission(
    galaxy: Galaxy,
    bo: BuiltObject,
    missionType: BuiltObjectMissionType,
    target: MissionTarget | null,
    target2: MissionTarget | null,
    priority: BuiltObjectMissionPriority,
    args: Omit<AssignMissionArgs, 'allowReprocessing' | 'manuallyAssigned'> = {},
): void {
    if (bo.role !== BuiltObjectRole.Base) {
        const item = new BuiltObjectMission(galaxy, bo, missionType, target, target2, priority, {
            cargo: args.cargo ?? null,
            troops: args.troops ?? null,
            population: args.population ?? null,
            design: args.design ?? null,
            x: args.x ?? COORD_UNSET_DOUBLE,
            y: args.y ?? COORD_UNSET_DOUBLE,
            starDate: args.starDate ?? -1,
            allowReprocessing: true,
            allowBuiltObjectChanges: false,
        });
        (bo.subsequentMissions as BuiltObjectMission[]).push(item);
    }
}
