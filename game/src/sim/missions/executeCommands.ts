// M4b — BuiltObject.ExecuteCommands (BuiltObject.2.cs 399-4579): the per-tick command step. This file holds the
// shared prologue (399-538: parent-relative position, docked position, index snapshot, destroyed-target checks,
// target coordinates), the CommandAction dispatch table, the M4b-owned cases (EvaluateThreats 792, ScanArea 798,
// Hold 1207, Deploy 4352, RepeatSubsequentCommands 4361, SetParent 4367, Undeploy 4390, ClearParent 4406,
// ClearAttackers 4487), the no-command epilogue (4494-4574: battle stats, queued/revert missions, mission-complete
// message, idle drift) and the InView clamp (4575). Every other case is ported in its owner's cmd*.ts module with the
// `CommandHandler` signature; ConditionalHyperTo's `goto case HyperTo/MoveTo` (2966/3002) stays inside cmdMovement.ts.
// EvaluateRelativeToParent (6784) is ported here (only ExecuteCommands and DoMovement call it).
// Rnd: none in the frame; cases draw inside their owners.

import { isAiControlled } from './playerOrder';
import type { Galaxy } from '../galaxy';
import type { BuiltObject } from '../builtObject';
import type { Habitat } from '../types';
import { HabitatCategoryType, HabitatType } from '../types';
import { BuiltObjectRole } from '../data/designSpecifications';
import { spanSeconds } from '../tick/simTime';
import { habitatDoTasks } from '../tick/habitatTick';
import { EmpireMessageType, sendMessageToEmpire } from '../messages';
import { threatEvaluation } from '../combat/threats';
import { scanArea } from '../exploration';
import { accelerateToTargetSpeed, calculateCurrentHeading, updateIndexesForMovement } from '../movement';
import { finalizeBattleStats } from '../combat/damage';
import { BuiltObjectMission, BuiltObjectMissionType, Command, CommandAction, builtObjectMission, type StellarObject } from './mission';
import { assignQueuedMission, checkCancelContracts, constructionQueueOf, dockHost, initiateUndeploy, revertToPreviousMission } from './assign';
import { cmdConditionalHyperTo, cmdHoldSyncFleet, cmdHyperTo, cmdImpulseTo, cmdMoveTo, cmdSprintTo } from './cmdMovement';
import { cmdDock, cmdLoad, cmdRefuel, cmdUndock, cmdUnload } from './cmdDocking';
import { cmdBuild, cmdRepair, cmdRetrofit, cmdScrap } from './cmdConstruction';
import { cmdExtractResources } from './cmdExtract';
import { cmdAttackBombardCaptureRaid } from './cmdAttack';
import { cmdReassignMission } from './cmdReassign';
import { cmdBlockade, cmdEscort } from './cmdMilitary';
import { cmdColonize } from './cmdTroops';
import { gameText } from '../colonyTick';
import { resolveSubRoleDescription } from '../designGeneration';

/** Galaxy.3.cs 4988-4989 ParentRelativeRange = 700 / ParentRelativeRangeSquared = 490000. */
export const PARENT_RELATIVE_RANGE = 700;
export const PARENT_RELATIVE_RANGE_SQUARED = 490000;

/**
 * The locals of ExecuteCommands that the switch cases share (BuiltObject.2.cs 399-538). A case handler reads them
 * and returns the C# `result` (seconds of `timePassed` left over: > 0 makes the DoTasks loop run another command).
 */
export interface CommandContext {
    galaxy: Galaxy;
    /** C# `this`. */
    bo: BuiltObject;
    mission: BuiltObjectMission;
    command: Command;
    /** `timePassed` (seconds). */
    timePassed: number;
    /** `time` (game ms, Galaxy.CurrentDateTime). */
    time: number;
    /** `starDate` (Galaxy.CurrentStarDate). */
    starDate: number;
    /** `num` / `num2`: the command's target coordinates (target position + relative offset, or explicit Xpos/Ypos), or -2000000001. */
    targetX: number;
    targetY: number;
    /** `x` / `y`: the galaxy index cell of the position at the start of the call. */
    indexX: number;
    indexY: number;
    /** `xpos` / `ypos`: position snapshot at the start of the call (after parent/dock adjustment). */
    xpos: number;
    ypos: number;
    /** EvaluateRelativeToParent outputs. */
    parentXPos: number;
    parentYPos: number;
    targetArrivalDistance: number;
}

export type CommandHandler = (ctx: CommandContext) => number;

/** BuiltObject.2.cs 6784 EvaluateRelativeToParent(ref parentXPos, ref parentYPos, out targetArrivalDistance, galaxy). */
export function evaluateRelativeToParent(galaxy: Galaxy, bo: BuiltObject, io: { parentXPos: number; parentYPos: number; targetArrivalDistance: number }): boolean {
    let result = false;
    io.targetArrivalDistance = 0.0;
    const parentBuiltObject = bo.parentBuiltObject;
    if (parentBuiltObject !== null && !parentBuiltObject.hasBeenDestroyed) {
        if (parentBuiltObject.dockedAt === bo || parentBuiltObject.builtAt === bo || parentBuiltObject.parentBuiltObject === bo) {
            return false;
        }
        if (bo.parentOffsetX <= -2000000001.0 && bo.parentOffsetY <= -2000000001.0) {
            if (galaxy.calculateDistanceSquared(bo.xpos, bo.ypos, parentBuiltObject.xpos, parentBuiltObject.ypos) <= PARENT_RELATIVE_RANGE_SQUARED && parentBuiltObject.empire === bo.empire) {
                bo.parentOffsetX = bo.xpos - parentBuiltObject.xpos;
                bo.parentOffsetY = bo.ypos - parentBuiltObject.ypos;
                result = true;
                io.parentXPos = parentBuiltObject.xpos;
                io.parentYPos = parentBuiltObject.ypos;
            }
        } else {
            result = true;
            io.parentXPos = parentBuiltObject.xpos;
            io.parentYPos = parentBuiltObject.ypos;
        }
    }
    const parentHabitat = bo.parentHabitat;
    if (parentHabitat !== null) {
        if (bo.parentOffsetX <= -2000000001.0 && bo.parentOffsetY <= -2000000001.0) {
            if (galaxy.calculateDistanceSquared(bo.xpos, bo.ypos, parentHabitat.xpos, parentHabitat.ypos) <= PARENT_RELATIVE_RANGE_SQUARED) {
                bo.parentOffsetX = bo.xpos - parentHabitat.xpos;
                bo.parentOffsetY = bo.ypos - parentHabitat.ypos;
                result = true;
                io.parentXPos = parentHabitat.xpos;
                io.parentYPos = parentHabitat.ypos;
            }
        } else {
            if (parentHabitat.type === HabitatType.BlackHole) {
                io.targetArrivalDistance = parentHabitat.diameter * 3;
            } else if (parentHabitat.category === HabitatCategoryType.GasCloud) {
                io.targetArrivalDistance = Math.trunc(parentHabitat.diameter / 3);
            }
            result = true;
            io.parentXPos = parentHabitat.xpos;
            io.parentYPos = parentHabitat.ypos;
        }
    }
    return result;
}

// ---------------------------------------------------------------------------------------------------------------
// M4b-owned cases
// ---------------------------------------------------------------------------------------------------------------

/** BuiltObject.2.cs 792 case EvaluateThreats. */
export const cmdEvaluateThreats: CommandHandler = (ctx) => {
    ctx.mission.completeCommand();
    ctx.bo.firstExecutionOfCommand = true;
    const result = 0.0;
    threatEvaluation(ctx.galaxy, ctx.bo, ctx.time);
    return result;
};

/** BuiltObject.2.cs 798 case ScanArea. */
export const cmdScanArea: CommandHandler = (ctx) => {
    scanArea(ctx.galaxy, ctx.bo);
    ctx.mission.completeCommand();
    ctx.bo.firstExecutionOfCommand = true;
    return 0.0;
};

/** BuiltObject.2.cs 1207 case Hold. */
export const cmdHold: CommandHandler = (ctx) => {
    const { bo, command, mission, starDate, timePassed } = ctx;
    let result = 0.0;
    if (starDate >= command.starDate) {
        const num102 = starDate - command.starDate;
        result = num102 / 1000.0;
        if (command.starDate < 0) {
            result = 0.0;
        }
        mission.completeCommand();
        bo.firstExecutionOfCommand = true;
    }
    accelerateToTargetSpeed(ctx.galaxy, bo, timePassed);
    if (bo.currentSpeed > 0) {
        const num103 = bo.currentSpeed * timePassed;
        bo.xpos += Math.cos(bo.heading) * num103;
        bo.ypos += Math.sin(bo.heading) * num103;
    }
    return result;
};

/** BuiltObject._DeployProgress (private in builtObject.ts). */
function deployProgressField(bo: BuiltObject): { _deployProgress: number } {
    return bo as unknown as { _deployProgress: number };
}

/** BuiltObject.2.cs 4352 case Deploy. */
export const cmdDeploy: CommandHandler = (ctx) => {
    const { bo, mission } = ctx;
    if (bo.parentHabitat !== null) {
        deployProgressField(bo)._deployProgress = Math.fround(0.01);
    }
    mission.completeCommand();
    bo.firstExecutionOfCommand = true;
    return ctx.timePassed;
};

/** BuiltObject.2.cs 4361 case RepeatSubsequentCommands. */
export const cmdRepeatSubsequentCommands: CommandHandler = (ctx) => {
    ctx.mission.repeatCommands = true;
    ctx.mission.completeCommand(true);
    ctx.bo.firstExecutionOfCommand = true;
    return ctx.timePassed;
};

/** BuiltObject.2.cs 4367 case SetParent. */
export const cmdSetParent: CommandHandler = (ctx) => {
    const { bo, command, mission } = ctx;
    if (command.targetHabitat !== null) {
        bo.parentHabitat = command.targetHabitat;
        bo.parentBuiltObject = null;
        bo.parentOffsetX = bo.xpos - bo.parentHabitat.xpos;
        bo.parentOffsetY = bo.ypos - bo.parentHabitat.ypos;
    } else if (command.targetBuiltObject !== null) {
        const targetBuiltObject2 = command.targetBuiltObject;
        if (!targetBuiltObject2.hasBeenDestroyed) {
            bo.parentBuiltObject = targetBuiltObject2;
            bo.parentHabitat = null;
            bo.parentOffsetX = bo.xpos - bo.parentBuiltObject.xpos;
            bo.parentOffsetY = bo.ypos - bo.parentBuiltObject.ypos;
        }
    }
    mission.completeCommand();
    bo.firstExecutionOfCommand = true;
    return ctx.timePassed;
};

/** BuiltObject.2.cs 4390 case Undeploy. */
export const cmdUndeploy: CommandHandler = (ctx) => {
    const { bo, mission } = ctx;
    let result: number;
    if (bo.isDeployed || bo.deployProgress < 0.0) {
        if (bo.deployProgress === 0) {
            initiateUndeploy(ctx.galaxy, bo);
        }
        result = 0.0;
    } else {
        mission.completeCommand();
        bo.firstExecutionOfCommand = true;
        result = ctx.timePassed;
    }
    return result;
};

/** `DockingBayList.IndexOf(BuiltObject)` (DockingBayList.cs): index of the bay holding the ship. */
function dockingBaysIndexOfShip(bays: { dockedShip: BuiltObject | null }[], ship: BuiltObject): number {
    for (let i = 0; i < bays.length; i++) {
        if (bays[i].dockedShip === ship) return i;
    }
    return -1;
}

/** `ConstructionYardList.IndexOf(BuiltObject)`: index of the yard building the ship. */
function constructionYardsIndexOfShip(yards: { shipUnderConstruction: BuiltObject | null }[], ship: BuiltObject): number {
    for (let i = 0; i < yards.length; i++) {
        if (yards[i].shipUnderConstruction === ship) return i;
    }
    return -1;
}

function removeAll(list: BuiltObject[], item: BuiltObject): void {
    while (list.includes(item)) {
        list.splice(list.indexOf(item), 1);
    }
}

/** BuiltObject.2.cs 4406 case ClearParent. */
export const cmdClearParent: CommandHandler = (ctx) => {
    const { bo, mission } = ctx;
    let result: number;
    const dockedAt = dockHost(bo.dockedAt);
    const builtAt = dockHost(bo.builtAt);
    if (dockedAt !== null || builtAt !== null) {
        if (dockedAt !== null) {
            if (dockedAt.dockingBayWaitQueue !== null) {
                removeAll(dockedAt.dockingBayWaitQueue, bo);
            }
            if (dockedAt.dockingBays !== null) {
                for (let num3 = dockingBaysIndexOfShip(dockedAt.dockingBays, bo); num3 >= 0; num3 = dockingBaysIndexOfShip(dockedAt.dockingBays, bo)) {
                    dockedAt.dockingBays[num3].dockedShip = null;
                }
            }
        }
        if (builtAt !== null) {
            if (builtAt.dockingBayWaitQueue !== null) {
                removeAll(builtAt.dockingBayWaitQueue, bo);
            }
            if (builtAt.dockingBays !== null) {
                for (let num4 = dockingBaysIndexOfShip(builtAt.dockingBays, bo); num4 >= 0; num4 = dockingBaysIndexOfShip(builtAt.dockingBays, bo)) {
                    builtAt.dockingBays[num4].dockedShip = null;
                }
            }
            const constructionQueue = constructionQueueOf(builtAt.constructionQueue);
            if (constructionQueue !== null) {
                if (constructionQueue.constructionWaitQueue !== null) {
                    removeAll(constructionQueue.constructionWaitQueue, bo);
                }
                if (constructionQueue.constructionYards !== null) {
                    const yards = constructionQueue.constructionYards;
                    for (let num5 = constructionYardsIndexOfShip(yards, bo); num5 >= 0; num5 = constructionYardsIndexOfShip(yards, bo)) {
                        yards[num5].shipUnderConstruction = null;
                        yards[num5].incrementalProgress = 0;
                    }
                }
            }
        }
        bo.dockedAt = null;
        bo.builtAt = null;
    }
    if (bo.deployProgress > 0.0) {
        initiateUndeploy(ctx.galaxy, bo);
    }
    if (bo.isDeployed || bo.deployProgress < 0.0) {
        if (bo.deployProgress === 0) {
            initiateUndeploy(ctx.galaxy, bo);
        }
        result = 0.0;
    } else {
        bo.parentHabitat = null;
        bo.parentBuiltObject = null;
        bo.parentOffsetX = -2000000001.0;
        bo.parentOffsetY = -2000000001.0;
        mission.completeCommand();
        bo.firstExecutionOfCommand = true;
        result = ctx.timePassed;
    }
    return result;
};

/** BuiltObject.2.cs 4487 case ClearAttackers. */
export const cmdClearAttackers: CommandHandler = (ctx) => {
    ctx.bo.attackers!.length = 0;
    ctx.mission.completeCommand();
    ctx.bo.firstExecutionOfCommand = true;
    return ctx.timePassed;
};

/**
 * The `switch (command.Action)` (BuiltObject.2.cs 539-4493). Actions without a case in the C# (SelfDestruct,
 * SelectTargetToAttack) fall through with `result` = 0.0. Built on first use: mission.ts ↔ executeCommands.ts sit in an
 * import cycle (mission → resolveCommands → tick/builtObjectTick → executeCommands), so the enum may not be
 * initialised yet at module-evaluation time.
 */
let handlersTable: Partial<Record<CommandAction, CommandHandler>> | null = null;
function handlers(): Partial<Record<CommandAction, CommandHandler>> {
    if (handlersTable !== null) return handlersTable;
    handlersTable = {
    [CommandAction.Blockade]: cmdBlockade, // 540  M4m
    [CommandAction.Repair]: cmdRepair, // 620  M4h
    [CommandAction.Retrofit]: cmdRetrofit, // 704  M4h
    [CommandAction.EvaluateThreats]: cmdEvaluateThreats, // 792
    [CommandAction.ScanArea]: cmdScanArea, // 798
    [CommandAction.Escort]: cmdEscort, // 804  M4m
    [CommandAction.Colonize]: cmdColonize, // 936  M4q
    [CommandAction.HoldSyncFleet]: cmdHoldSyncFleet, // 1159 M4c
    [CommandAction.Hold]: cmdHold, // 1207
    [CommandAction.ExtractResources]: cmdExtractResources, // 1227 M4g
    [CommandAction.Scrap]: cmdScrap, // 1311 M4h
    [CommandAction.Build]: cmdBuild, // 1444 M4h
    [CommandAction.Attack]: cmdAttackBombardCaptureRaid, // 1698 M4n
    [CommandAction.Bombard]: cmdAttackBombardCaptureRaid, // 1699 M4n
    [CommandAction.Capture]: cmdAttackBombardCaptureRaid, // 1700 M4n
    [CommandAction.Raid]: cmdAttackBombardCaptureRaid, // 1701 M4n
    [CommandAction.Dock]: cmdDock, // 2731 M4e
    [CommandAction.ConditionalHyperTo]: cmdConditionalHyperTo, // 2928 M4c
    [CommandAction.HyperTo]: cmdHyperTo, // 3020 M4c
    [CommandAction.ImpulseTo]: cmdImpulseTo, // 3224 M4c
    [CommandAction.Load]: cmdLoad, // 3232 M4e
    [CommandAction.MoveTo]: cmdMoveTo, // 3596 M4c
    [CommandAction.SprintTo]: cmdSprintTo, // 3627 M4c
    [CommandAction.Undock]: cmdUndock, // 3642 M4e
    [CommandAction.Unload]: cmdUnload, // 3698 M4e
    [CommandAction.ReassignMission]: cmdReassignMission, // 3999 M4f
    [CommandAction.Refuel]: cmdRefuel, // 4226 M4e
    [CommandAction.Deploy]: cmdDeploy, // 4352
    [CommandAction.RepeatSubsequentCommands]: cmdRepeatSubsequentCommands, // 4361
    [CommandAction.SetParent]: cmdSetParent, // 4367
    [CommandAction.Undeploy]: cmdUndeploy, // 4390
    [CommandAction.ClearParent]: cmdClearParent, // 4406
    [CommandAction.ClearAttackers]: cmdClearAttackers, // 4487
    };
    return handlersTable;
}

/** The handler the dispatcher uses for `action` (tests / other packages can inspect the table). */
export function commandHandler(action: CommandAction): CommandHandler | null {
    return handlers()[action] ?? null;
}

/** BuiltObject.2.cs 399 ExecuteCommands(galaxy, timePassed, time, starDate) → seconds left (`result`). */
export function executeCommands(galaxy: Galaxy, builtObject: BuiltObject, timePassed: number, time: number, starDate: number): number {
    const bo = builtObject;
    let result = 0.0;
    // 401-407
    const mission = builtObjectMission(bo.mission);
    let command: Command | null = null;
    if (mission !== null) {
        command = mission.fastPeekCurrentCommand();
    }
    bo.executingShipGroupCommand = false;
    // 409-412
    if (command === null || command.action !== CommandAction.Attack) {
        bo.hyperDenyActive = false;
    }
    // 413-431
    const rel = { parentXPos: -2000000001.0, parentYPos: -2000000001.0, targetArrivalDistance: 0.0 };
    if (evaluateRelativeToParent(galaxy, bo, rel)) {
        if (command !== null) {
            if (
                command.action !== CommandAction.ImpulseTo &&
                command.action !== CommandAction.MoveTo &&
                command.action !== CommandAction.SprintTo &&
                command.action !== CommandAction.Escort &&
                command.action !== CommandAction.ConditionalHyperTo &&
                command.action !== CommandAction.HyperTo
            ) {
                bo.xpos = rel.parentXPos + bo.parentOffsetX;
                bo.ypos = rel.parentYPos + bo.parentOffsetY;
            }
        } else {
            bo.xpos = rel.parentXPos + bo.parentOffsetX;
            bo.ypos = rel.parentYPos + bo.parentOffsetY;
        }
    }
    // 432-444
    const dockedAt = bo.dockedAt;
    if (command !== null) {
        if (dockedAt !== null && command.action !== CommandAction.Dock && bo.parentOffsetX > -2000000001.0 && bo.parentOffsetY > -2000000001.0) {
            bo.xpos = dockedAt.xpos + bo.parentOffsetX;
            bo.ypos = dockedAt.ypos + bo.parentOffsetY;
        }
    } else if (dockedAt !== null && bo.parentOffsetX > -2000000001.0 && bo.parentOffsetY > -2000000001.0) {
        bo.xpos = dockedAt.xpos + bo.parentOffsetX;
        bo.ypos = dockedAt.ypos + bo.parentOffsetY;
    }
    // 445-453
    const xpos = bo.xpos;
    const ypos = bo.ypos;
    const x = galaxy.resolveIndexX(xpos);
    const y = galaxy.resolveIndexY(ypos);
    if (bo.empire === null) {
        return 0.0;
    }
    // 454-459
    const builtAt = bo.builtAt as StellarObject | null;
    if (builtAt !== null && (bo.role !== BuiltObjectRole.Base || bo.parentHabitat === null)) {
        bo.xpos = builtAt.xpos;
        bo.ypos = builtAt.ypos;
        updateIndexesForMovement(galaxy, bo, x, y, false);
    } else if (command !== null) {
        // 460-538
        let num = -2000000001.0;
        let num2 = -2000000001.0;
        if (command.targetBuiltObject !== null || command.targetHabitat !== null || command.targetShipGroup !== null || command.targetCreature !== null) {
            if (command.targetBuiltObject !== null) {
                const targetBuiltObject = command.targetBuiltObject;
                if (targetBuiltObject.hasBeenDestroyed) {
                    removeCurrentTargetFromAttackers(bo);
                    bo.currentTarget = null;
                    mission!.completeCommand();
                    bo.firstExecutionOfCommand = true;
                    return timePassed;
                }
                num = targetBuiltObject.xpos;
                num2 = targetBuiltObject.ypos;
            } else if (command.targetCreature !== null) {
                const targetCreature = command.targetCreature;
                if (targetCreature.hasBeenDestroyed) {
                    removeCurrentTargetFromAttackers(bo);
                    bo.currentTarget = null;
                    mission!.completeCommand();
                    bo.firstExecutionOfCommand = true;
                    return timePassed;
                }
                num = targetCreature.xpos;
                num2 = targetCreature.ypos;
            } else if (command.targetHabitat !== null) {
                const targetHabitat: Habitat = command.targetHabitat;
                if (targetHabitat.category === HabitatCategoryType.Moon && targetHabitat.parent !== null) {
                    habitatDoTasks(galaxy, targetHabitat.parent, time);
                }
                num = targetHabitat.xpos;
                num2 = targetHabitat.ypos;
            } else if (command.targetShipGroup !== null) {
                const targetShipGroup = command.targetShipGroup;
                if (targetShipGroup.ships.length > 0) {
                    num = targetShipGroup.leadShip!.xpos;
                    num2 = targetShipGroup.leadShip!.ypos;
                } else if (!bo.executingShipGroupCommand) {
                    bo.currentTarget = null;
                    mission!.completeCommand();
                    bo.firstExecutionOfCommand = true;
                    return timePassed;
                }
            }
            if (command.targetRelativeXpos > -2e9 && command.targetRelativeYpos > -2e9 && command.targetRelativeXpos !== 0 && command.targetRelativeYpos !== 0) {
                num += command.targetRelativeXpos;
                num2 += command.targetRelativeYpos;
            }
        }
        if (command.xpos > -2e9 && command.ypos > -2e9) {
            num = command.xpos;
            num2 = command.ypos;
        }
        bo.hyperDenyActive = false;
        const ctx: CommandContext = {
            galaxy,
            bo,
            mission: mission!,
            command,
            timePassed,
            time,
            starDate,
            targetX: num,
            targetY: num2,
            indexX: x,
            indexY: y,
            xpos,
            ypos,
            parentXPos: rel.parentXPos,
            parentYPos: rel.parentYPos,
            targetArrivalDistance: rel.targetArrivalDistance,
        };
        const handler = handlers()[command.action];
        if (handler !== undefined) {
            result = handler(ctx);
        }
    } else {
        // 4494-4574: no current command.
        if (
            mission !== null &&
            (mission.type === BuiltObjectMissionType.Attack ||
                mission.type === BuiltObjectMissionType.WaitAndAttack ||
                mission.type === BuiltObjectMissionType.Bombard ||
                mission.type === BuiltObjectMissionType.WaitAndBombard ||
                mission.type === BuiltObjectMissionType.Capture ||
                mission.type === BuiltObjectMissionType.Raid ||
                mission.previousType === BuiltObjectMissionType.Attack ||
                mission.previousType === BuiltObjectMissionType.WaitAndAttack ||
                mission.previousType === BuiltObjectMissionType.Bombard ||
                mission.previousType === BuiltObjectMissionType.WaitAndBombard ||
                mission.previousType === BuiltObjectMissionType.Capture ||
                mission.previousType === BuiltObjectMissionType.Raid) &&
            mission.target !== null &&
            bo.battleStats !== null
        ) {
            let attackedTarget: StellarObject | null = null;
            if (mission.targetBuiltObject !== null) {
                attackedTarget = mission.targetBuiltObject;
            } else if (mission.targetHabitat !== null) {
                attackedTarget = mission.targetHabitat;
            } else if (mission.targetCreature !== null) {
                attackedTarget = mission.targetCreature;
            }
            // AddLatestCombatStats + ResolveNearestLocation + DoCharacterEvent(SpaceBattle) (4517-4522).
            finalizeBattleStats(galaxy, bo, attackedTarget);
            bo.battleStats = null;
        }
        if (bo.battleStats !== null) {
            finalizeBattleStats(galaxy, bo, null);
        }
        bo.battleStats = null;
        checkCancelContracts(galaxy, bo);
        if (assignQueuedMission(galaxy, bo)) {
            result = timePassed;
        } else if (revertToPreviousMission(galaxy, bo)) {
            result = timePassed;
        } else {
            if (!isAiControlled(bo) && bo.empire !== null && bo.empire !== galaxy.independentEmpire && bo.empire.pirateEmpireBaseHabitat === null && bo.role !== BuiltObjectRole.Base && bo.shipGroup === null && !bo.missionCompleteMessageSent) {
                // string.Format(TextResolver.GetText("SHIPTYPE NAME has completed its mission"), ResolveDescription(SubRole), Name).
                const description3 = gameText('SHIPTYPE NAME has completed its mission', resolveSubRoleDescription(bo.subRole), bo.name);
                sendMessageToEmpire(bo.empire, bo.empire, EmpireMessageType.ShipMissionComplete, bo, description3);
                bo.missionCompleteMessageSent = true;
            }
            if (bo.shipPullAmountLocation <= 0) {
                bo.preferredSpeed = 0;
                bo.targetSpeed = 0;
            }
            // 4553: (double)_tempNow.Subtract(_LastTouch).Ticks / 10000000.0
            const num111 = spanSeconds(time, bo.lastTouch);
            accelerateToTargetSpeed(galaxy, bo, num111);
            if (bo.role !== BuiltObjectRole.Base) {
                calculateCurrentHeading(galaxy, bo, num111);
            }
            // (C# resolves the index before and again inside the speed test; both are pure reads of the same position.)
            if (bo.currentSpeed > 0) {
                const indexX3 = galaxy.resolveIndexX(bo.xpos);
                const indexY3 = galaxy.resolveIndexY(bo.ypos);
                const num112 = bo.currentSpeed * num111;
                bo.xpos += Math.cos(bo.heading) * num112;
                bo.ypos += Math.sin(bo.heading) * num112;
                if (num112 > 1000.0) {
                    updateIndexesForMovement(galaxy, bo, indexX3, indexY3, true);
                } else {
                    updateIndexesForMovement(galaxy, bo, indexX3, indexY3, false);
                }
            }
        }
    }
    // 4575-4578
    if (bo.inView) {
        result = 0.0;
    }
    return result;
}

/** BuiltObject.2.cs 474-477 / 493-496: `if (Attackers.Contains(CurrentTarget)) Attackers.Remove(CurrentTarget)`. */
function removeCurrentTargetFromAttackers(bo: BuiltObject): void {
    const attackers = bo.attackers;
    if (attackers === null) return;
    const index = attackers.indexOf(bo.currentTarget);
    if (index >= 0) {
        attackers.splice(index, 1);
    }
}
