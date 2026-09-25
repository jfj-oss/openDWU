// M4m — ExecuteCommands cases Blockade / Escort (BuiltObject.2.cs 540 / 804).
//
// Each export is one `case` of the C# switch with the `CommandHandler` signature from executeCommands.ts: it receives the
// shared locals (`CommandContext`: bo, mission, command, timePassed/time/starDate, targetX/targetY = num/num2,
// indexX/indexY = x/y) and returns the C# `result` (seconds left for the DoTasks loop). No direct Rnd; Escort calls
// DoMovement and ThreatEvaluation (their own draws).

import type { CommandHandler } from './executeCommands';
import type { BuiltObject } from '../builtObject';
import { BuiltObjectMissionType, Command, CommandAction, builtObjectMission } from './mission';
import { accelerateToTargetSpeed, baconMovementSettings, doMovement } from '../movement';
import { detectShipsDockingAtHabitat, detectShipsDockingAtSpacePort } from '../logistics/docking';
import { evaluateAdequateAttackers, threatEvaluation } from '../combat/threats';
import { setupBlockadeBuiltObject, setupBlockadeColony } from '../fleets/blockades';

/** Galaxy.ParentRelativeRange (Galaxy.3.cs 4988) / EscortRange (4977). */
const PARENT_RELATIVE_RANGE = 700;
const ESCORT_RANGE = 200;

/** BuiltObject.2.cs 540 case Blockade. */
export const cmdBlockade: CommandHandler = (ctx) => {
    const { galaxy, bo, mission, command, timePassed } = ctx;
    if (bo.firstExecutionOfCommand) {
        const num26 = galaxy.calculateDistance(bo.xpos, bo.ypos, ctx.targetX, ctx.targetY);
        if (num26 > PARENT_RELATIVE_RANGE * 2) {
            mission.completeCommand();
            bo.firstExecutionOfCommand = true;
            return timePassed;
        }
        if (bo.empire !== null) {
            if (command.targetHabitat !== null) {
                setupBlockadeColony(galaxy, bo.empire, command.targetHabitat);
            } else if (command.targetBuiltObject !== null) {
                setupBlockadeBuiltObject(galaxy, bo.empire, command.targetBuiltObject);
            }
        }
        bo.preferredSpeed = 0;
        bo.targetSpeed = 0;
        bo.firstExecutionOfCommand = false;
    }
    let builtObjectList: BuiltObject[] | null = null;
    if (command.targetHabitat !== null) {
        const targetHabitat4 = command.targetHabitat;
        builtObjectList = detectShipsDockingAtHabitat(targetHabitat4);
        let builtObjectList2: BuiltObject[] | null = null;
        if (targetHabitat4.empire !== null && targetHabitat4.basesAtHabitat !== null) {
            for (let l = 0; l < targetHabitat4.basesAtHabitat.length; l++) {
                const builtObject3 = targetHabitat4.basesAtHabitat[l];
                if (builtObject3 != null && builtObject3.parentHabitat === targetHabitat4) builtObjectList2 = detectShipsDockingAtSpacePort(builtObject3);
            }
        }
        if (builtObjectList2 !== null && builtObjectList2.length > 0) builtObjectList.push(...builtObjectList2);
    } else if (command.targetBuiltObject !== null) {
        builtObjectList = detectShipsDockingAtSpacePort(command.targetBuiltObject);
    }
    // C# dereferences the list unguarded (a Blockade command without a target would throw here).
    if (builtObjectList!.length > 0) {
        for (const item of builtObjectList!) {
            if (item.empire !== bo.empire && !evaluateAdequateAttackers(galaxy, bo, item).adequate) {
                const command2 = Command.forTarget(CommandAction.Attack, item);
                mission.insertCommandAtTop(command2);
                bo.firstExecutionOfCommand = true;
                // C# sets `result = timePassed` here, then overwrites it with 0.0 after the movement below.
                break;
            }
        }
    }
    accelerateToTargetSpeed(galaxy, bo, timePassed);
    if (bo.currentSpeed > 0) {
        const num27 = bo.currentSpeed * timePassed;
        bo.xpos += Math.cos(bo.heading) * num27;
        bo.ypos += Math.sin(bo.heading) * num27;
    }
    return 0.0;
};

/** BuiltObject.2.cs 804 case Escort. */
export const cmdEscort: CommandHandler = (ctx) => {
    const { galaxy, bo, mission, command, timePassed } = ctx;
    let result = 0.0;
    if (bo.firstExecutionOfCommand) {
        if (command.targetBuiltObject === null) {
            mission.completeCommand();
            bo.firstExecutionOfCommand = true;
            return timePassed;
        }
        bo.firstExecutionOfCommand = false;
    }
    const targetBuiltObject5 = command.targetBuiltObject;
    if (targetBuiltObject5 === null || targetBuiltObject5.hasBeenDestroyed) {
        mission.completeCommand();
        bo.firstExecutionOfCommand = true;
        return result;
    }
    const num39 = galaxy.calculateDistance(bo.xpos, bo.ypos, targetBuiltObject5.xpos, targetBuiltObject5.ypos);
    if (num39 > baconMovementSettings.hyperJumpThreshhold && bo.warpSpeed > 0) {
        const mission2 = builtObjectMission(targetBuiltObject5.mission);
        let command3: Command | null = null;
        if (mission2 !== null) command3 = mission2.showCurrentCommand();
        if (mission2 !== null && mission2.type !== BuiltObjectMissionType.Undefined && command3 !== null && command3.action === CommandAction.HyperTo) {
            let num40 = targetBuiltObject5.xpos;
            let num41 = targetBuiltObject5.ypos;
            if (command3.targetHabitat !== null) {
                num40 = command3.targetHabitat.xpos;
                num41 = command3.targetHabitat.ypos;
            } else if (command3.targetBuiltObject !== null) {
                num40 = command3.targetBuiltObject.xpos;
                num41 = command3.targetBuiltObject.ypos;
            } else if (command3.targetCreature !== null) {
                num40 = command3.targetCreature.xpos;
                num41 = command3.targetCreature.ypos;
            } else if (command3.targetShipGroup !== null) {
                num40 = command3.targetShipGroup.ships[0].xpos;
                num41 = command3.targetShipGroup.ships[0].ypos;
            }
            if (command3.xpos > -2e9 && command3.ypos > -2e9) {
                num40 = command3.xpos;
                num41 = command3.ypos;
            }
            const num42 = galaxy.calculateDistance(bo.xpos, bo.ypos, num40, num41);
            if (num42 > baconMovementSettings.hyperJumpThreshhold && bo.warpSpeed > 0) {
                const command4 = Command.at(CommandAction.ConditionalHyperTo, num40, num41);
                mission.insertCommandAtTop(command4);
                bo.firstExecutionOfCommand = true;
                result = timePassed;
            }
        } else {
            const command5 = Command.forTarget(CommandAction.ConditionalHyperTo, targetBuiltObject5);
            mission.insertCommandAtTop(command5);
            bo.firstExecutionOfCommand = true;
            result = timePassed;
        }
        return result;
    }
    if (num39 > ESCORT_RANGE) {
        bo.preferredSpeed = bo.topSpeed;
        doMovement(galaxy, bo, timePassed, targetBuiltObject5.xpos, targetBuiltObject5.ypos, ctx.indexX, ctx.indexY, command.targetRelativeXpos, command.targetRelativeYpos, false, true, false);
        bo.parentBuiltObject = null;
        bo.parentHabitat = null;
        bo.parentOffsetX = -2000000001.0;
        bo.parentOffsetY = -2000000001.0;
    } else {
        if (targetBuiltObject5.parentHabitat !== null && bo.parentHabitat === null) {
            bo.parentHabitat = targetBuiltObject5.parentHabitat;
            bo.parentBuiltObject = null;
            bo.parentOffsetX = bo.xpos - targetBuiltObject5.parentHabitat.xpos;
            bo.parentOffsetY = bo.ypos - targetBuiltObject5.parentHabitat.ypos;
        }
        if (targetBuiltObject5.parentBuiltObject !== null && bo.parentBuiltObject === null) {
            bo.parentBuiltObject = targetBuiltObject5.parentBuiltObject;
            bo.parentHabitat = null;
            bo.parentOffsetX = bo.xpos - targetBuiltObject5.parentBuiltObject.xpos;
            bo.parentOffsetY = bo.ypos - targetBuiltObject5.parentBuiltObject.ypos;
        }
        if (targetBuiltObject5.parentBuiltObject === null && targetBuiltObject5.parentHabitat === null) {
            bo.parentBuiltObject = null;
            bo.parentHabitat = null;
            bo.parentOffsetX = -2000000001.0;
            bo.parentOffsetY = -2000000001.0;
        }
        if (bo.topSpeed >= Math.trunc(targetBuiltObject5.currentSpeed)) bo.preferredSpeed = Math.trunc(targetBuiltObject5.currentSpeed);
        else bo.preferredSpeed = bo.topSpeed;
        bo.targetHeading = targetBuiltObject5.heading;
        doMovement(galaxy, bo, timePassed, targetBuiltObject5.xpos, targetBuiltObject5.ypos, ctx.indexX, ctx.indexY, command.targetRelativeXpos, command.targetRelativeYpos, false, false, false);
        threatEvaluation(galaxy, bo, ctx.time);
    }
    const targetMission = builtObjectMission(targetBuiltObject5.mission);
    if (targetMission === null || targetMission.type === BuiltObjectMissionType.Undefined) {
        mission.completeCommand();
        bo.firstExecutionOfCommand = true;
    }
    result = 0.0;
    return result;
};
