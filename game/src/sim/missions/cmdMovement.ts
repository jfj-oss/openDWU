// M4c — ExecuteCommands cases MoveTo 3596 / SprintTo 3627 / ImpulseTo 3224 / HyperTo 3020 / ConditionalHyperTo 2928 /
// HoldSyncFleet 1159 (BuiltObject.2.cs).
//
// Each export is one `case` of the C# switch with the `CommandHandler` signature from executeCommands.ts: it receives
// the shared locals (`CommandContext`: bo, mission, command, timePassed/time/starDate, targetX/targetY = num/num2,
// indexX/indexY = x/y) and returns the C# `result` (seconds left for the DoTasks loop). ConditionalHyperTo's
// `goto case HyperTo` (2966) / `goto case MoveTo` (3002) stay in this module: the handler updates ctx.mission /
// ctx.command (the C# reassigns the `mission` / `command` locals first) and calls the other case.
//
// Rnd: HyperTo's first execution draws Rnd.Next(0, 2000) (3027) then SelectHyperJumpExitPoint (NextDouble, Next(0, 2),
// NextDouble; 3030).

import type { BuiltObject } from '../builtObject';
import { shipGroupWarpSpeed, type ShipGroup } from '../fleets/shipGroup';
import { shipGroupCruiseSpeed, shipGroupRemoveShipsWithoutHyperdrive, shipGroupTopSpeed } from '../fleets/shipGroupTasks';
import type { CommandHandler } from './executeCommands';
import { BuiltObjectMissionType, CommandAction, Command, builtObjectMission } from './mission';
import { clearPreviousMissionRequirements } from './assign';
import { determineAngle } from '../creature';
import { galaxyStarDate } from '../tick/simTime';
import { checkForPlanetDestroyerWeaponFiringDelayOnHyperExit } from '../combat/weapons';
import { checkClearDocking, checkMissionStillValid } from '../logistics/docking';
import { checkSendPreWarpProgressEventMessage } from '../events';
import { PreWarpProgressEventType } from '../exploration';
import { scenarioQuery } from '../scenario/hooks';
import {
    MAX_SOLAR_SYSTEM_SIZE,
    MOVEMENT_IMPULSE_SPEED,
    accelerateToTargetSpeed,
    baconMovementSettings,
    calculateCurrentHeading,
    checkFightersOnboardAndRetrieve,
    checkForHyperExitGravityWell,
    checkForHyperExitGravityWells,
    checkFuelHandicap,
    checkShouldExplore,
    checkWhetherArrived,
    consumeFuel,
    detectHyperDeny,
    doHyperjumpExitCharacterEvent,
    doMovement,
    returnLaunchedFighters,
    sendShipTowardsEdgeOfGravityWell,
    shouldSendShipTowardEdgeOfGravityWell,
    updateIndexesForMovement,
    updatePosition,
    warpSpeedWithBonuses,
    withinFuelRange,
} from '../movement';

const f = Math.fround;

function shipGroupOf(bo: BuiltObject): ShipGroup | null {
    return bo.shipGroup as ShipGroup | null;
}

/** BuiltObject.2.cs 3596 case MoveTo. */
export const cmdMoveTo: CommandHandler = (ctx) => {
    const { galaxy, bo, mission, command, timePassed } = ctx;
    const num = ctx.targetX;
    const num2 = ctx.targetY;
    let result = 0.0;
    if (bo.firstExecutionOfCommand) {
        const shipGroup = shipGroupOf(bo);
        if (bo.executingShipGroupCommand && shipGroup !== null) {
            bo.preferredSpeed = f(shipGroupCruiseSpeed(shipGroup));
        } else {
            bo.preferredSpeed = bo.cruiseSpeed;
        }
        bo.firstExecutionOfCommand = false;
    }
    const threshold = baconMovementSettings.hyperJumpThreshhold;
    if (bo.warpSpeed > 0 && num > -1.0 && num2 > -1.0 && Math.abs(bo.xpos - num) > threshold && !shouldSendShipTowardEdgeOfGravityWell(galaxy, bo) && Math.abs(bo.ypos - num2) > threshold) {
        const command12 = Command.at(CommandAction.ConditionalHyperTo, num, num2);
        builtObjectMission(bo.mission)!.insertCommandAtTop(command12);
        bo.firstExecutionOfCommand = true;
        result = timePassed;
    }
    // (the C# carries on with this MoveTo command below even after queueing the jump; `result` is overwritten)
    if (mission !== null && mission.type === BuiltObjectMissionType.Explore && bo.empire !== null && command.targetHabitat !== null && !checkShouldExplore(galaxy, bo.empire, command.targetHabitat)) {
        mission.completeCommand(true);
        bo.firstExecutionOfCommand = true;
        result = timePassed;
    } else {
        result = doMovement(galaxy, bo, timePassed, num, num2, ctx.indexX, ctx.indexY, command.targetRelativeXpos, command.targetRelativeYpos, true, true, true);
    }
    return result;
};

/** BuiltObject.2.cs 3627 case SprintTo. */
export const cmdSprintTo: CommandHandler = (ctx) => {
    const { galaxy, bo, command, timePassed } = ctx;
    if (bo.firstExecutionOfCommand) {
        const shipGroup = shipGroupOf(bo);
        if (bo.executingShipGroupCommand && shipGroup !== null) {
            bo.preferredSpeed = f(shipGroupTopSpeed(shipGroup));
        } else {
            bo.preferredSpeed = bo.topSpeed;
        }
        bo.firstExecutionOfCommand = false;
    }
    return doMovement(galaxy, bo, timePassed, ctx.targetX, ctx.targetY, ctx.indexX, ctx.indexY, command.targetRelativeXpos, command.targetRelativeYpos, true, true, true);
};

/** BuiltObject.2.cs 3224 case ImpulseTo. */
export const cmdImpulseTo: CommandHandler = (ctx) => {
    const { galaxy, bo, command, timePassed } = ctx;
    if (bo.firstExecutionOfCommand) {
        bo.preferredSpeed = MOVEMENT_IMPULSE_SPEED;
        bo.firstExecutionOfCommand = false;
    }
    return doMovement(galaxy, bo, timePassed, ctx.targetX, ctx.targetY, ctx.indexX, ctx.indexY, command.targetRelativeXpos, command.targetRelativeYpos, true, true, true);
};

/** The three hyperjump-state resets ConditionalHyperTo repeats (2947-2949, 2970-2972, 3006-3008, 3013-3015). */
function clearHyperjumpStart(bo: BuiltObject): void {
    bo.hyperEnterStartAnimation = false;
    bo.hyperjumpAboutToEnter = false;
    bo.hyperjumpPrepare = false;
}

/** BuiltObject.2.cs 2928 case ConditionalHyperTo (with its `goto case HyperTo` / `goto case MoveTo`). */
export const cmdConditionalHyperTo: CommandHandler = (ctx) => {
    const { galaxy, bo, timePassed } = ctx;
    const num = ctx.targetX;
    const num2 = ctx.targetY;
    let mission = ctx.mission;
    let command = ctx.command;
    const num96 = galaxy.calculateDistance(num, num2, bo.xpos, bo.ypos);
    if (num96 > baconMovementSettings.hyperJumpThreshhold) {
        if (bo.warpSpeed > 0) {
            let flag27 = false;
            const builtObject14 = checkForHyperExitGravityWell(galaxy, bo, num, num2);
            if (builtObject14 !== null) {
                const num97 = galaxy.calculateDistance(bo.xpos, bo.ypos, builtObject14.xpos, builtObject14.ypos);
                const num98 = num97 / builtObject14.hyperStopRange;
                if (num98 < 1.5) {
                    flag27 = true;
                }
            }
            if (flag27) {
                clearHyperjumpStart(bo);
                mission.completeCommand();
                bo.firstExecutionOfCommand = true;
                return 0.0;
            }
            if (!sendShipTowardsEdgeOfGravityWell(galaxy, bo)) {
                const command9 = command.clone();
                command9.action = CommandAction.HyperTo;
                const m = builtObjectMission(bo.mission)!;
                m.completeCommand();
                m.insertCommandAtTop(command9);
                mission = m;
                command = m.fastPeekCurrentCommand()!;
                bo.firstExecutionOfCommand = true;
            }
            // goto case HyperTo
            ctx.mission = mission;
            ctx.command = command;
            return cmdHyperTo(ctx);
        }
        if (withinFuelRange(galaxy, bo, num, num2, 0.0) || mission.manuallyAssigned) {
            clearHyperjumpStart(bo);
            const command10 = command.clone();
            let flag28 = false;
            if (mission !== null) {
                switch (mission.type) {
                    case BuiltObjectMissionType.Attack:
                    case BuiltObjectMissionType.Bombard:
                    case BuiltObjectMissionType.Capture:
                    case BuiltObjectMissionType.Raid:
                        flag28 = true;
                        break;
                }
            }
            const m = builtObjectMission(bo.mission)!;
            m.completeCommand();
            let flag29 = false;
            if (!flag28 && !m.checkCommandsForAction(CommandAction.MoveTo, 2)) {
                command10.action = CommandAction.MoveTo;
                m.insertCommandAtTop(command10);
                flag29 = true;
            }
            mission = m;
            const next = m.fastPeekCurrentCommand();
            bo.firstExecutionOfCommand = true;
            if (flag28 || !flag29) {
                return 0.0;
            }
            // goto case MoveTo (the command is the MoveTo clone just inserted)
            ctx.mission = mission;
            ctx.command = next!;
            return cmdMoveTo(ctx);
        }
        clearHyperjumpStart(bo);
        mission.completeCommand();
        bo.firstExecutionOfCommand = true;
        return timePassed;
    }
    clearHyperjumpStart(bo);
    mission.completeCommand();
    bo.firstExecutionOfCommand = true;
    return timePassed;
};

const hyperExit = { x: 0.0, y: 0.0 };

/** BuiltObject.2.cs 3020 case HyperTo. Rnd: first execution — Next(0, 2000), then SelectHyperJumpExitPoint. */
export const cmdHyperTo: CommandHandler = (ctx) => {
    const { galaxy, bo, mission, timePassed, time, starDate } = ctx;
    const num = ctx.targetX;
    const num2 = ctx.targetY;
    const x = ctx.indexX;
    const y = ctx.indexY;
    const result = 0.0;
    if (bo.firstExecutionOfCommand) {
        bo.hyperjumpAboutToEnterSoundPlayed = false;
        bo.hyperEnterStartAnimation = true;
        bo.lastHyperjumpDistance = 0;
        // long num7 = Math.Max(0L, HyperjumpInitiate * 1000 + (Galaxy.Rnd.Next(0, 2000) - 1000));
        const num7 = Math.max(0, bo.hyperjumpInitiate * 1000 + (galaxy.rnd.next(0, 2000) - 1000));
        bo.hyperjumpCountdown = galaxyStarDate(galaxy) + num7;
        const baseHyperJumpAccuracy = baconMovementSettings.baseHyperJumpAccuracy;
        const exitPoint = galaxy.selectHyperJumpExitPoint(baseHyperJumpAccuracy);
        bo.hyperjumpX = exitPoint.x;
        bo.hyperjumpY = exitPoint.y;
        bo.lastHyperDistance = 536870911.0;
        bo.lastPositionX = bo.xpos;
        bo.lastPositionY = bo.ypos;
        bo.angle = f(determineAngle(bo.xpos, bo.ypos, num + bo.hyperjumpX, num2 + bo.hyperjumpY));
        const shipGroup = shipGroupOf(bo);
        if (mission.isShipGroupMission && shipGroup !== null) {
            bo.preferredSpeed = f(Math.min(shipGroupCruiseSpeed(shipGroup), bo.cruiseSpeed));
            bo.targetSpeed = Math.min(shipGroupCruiseSpeed(shipGroup), bo.cruiseSpeed);
        } else {
            bo.preferredSpeed = bo.cruiseSpeed;
            bo.targetSpeed = bo.cruiseSpeed;
        }
        if (bo.currentSpeed > bo.topSpeed) {
            bo.currentSpeed = f(bo.targetSpeed);
            updatePosition(galaxy, bo);
            checkForPlanetDestroyerWeaponFiringDelayOnHyperExit(galaxy, bo, time);
        }
        returnLaunchedFighters(galaxy, bo);
        bo.targetHeading = bo.angle;
        bo.firstExecutionOfCommand = false;
        bo.firstHyperjumpExecution = true;
    }
    if (bo.warpSpeed <= 0) {
        clearPreviousMissionRequirements(galaxy, bo);
        return result;
    }
    let num8: number;
    if (starDate >= bo.hyperjumpCountdown && bo.canHyperJump && bo.warpSpeed > 0 && checkFightersOnboardAndRetrieve(galaxy, bo)) {
        bo.hyperjumpPrepare = false;
        bo.hyperEnterStartAnimation = false;
        if (bo.firstHyperjumpExecution) {
            if (detectHyperDeny(galaxy, bo)) {
                bo.canHyperJump = false;
                return 0.0;
            }
            bo.canHyperJump = true;
            const actualEmpire = bo.actualEmpire;
            if (actualEmpire !== null) {
                actualEmpire.visibility.resolveSystemVisibilityForUnit(bo, true);
            }
            bo.attackers!.length = 0;
            bo.firstHyperjumpExecution = false;
            checkClearDocking(galaxy, bo, true);
            if (bo.empire !== null) {
                checkSendPreWarpProgressEventMessage(galaxy, bo.empire, PreWarpProgressEventType.FirstHyperjump, bo);
            }
        }
        const shipGroup = shipGroupOf(bo);
        if (mission.isShipGroupMission && shipGroup !== null) {
            shipGroupRemoveShipsWithoutHyperdrive(galaxy, shipGroup);
            if (shipGroupWarpSpeed(shipGroup) > 0) {
                bo.preferredSpeed = f(Math.min(warpSpeedWithBonuses(bo), shipGroupWarpSpeed(shipGroup)));
            } else {
                bo.preferredSpeed = f(warpSpeedWithBonuses(bo));
            }
            bo.currentSpeed = bo.preferredSpeed;
        } else if (mission.type === BuiltObjectMissionType.Escort && mission.targetBuiltObject !== null) {
            if (warpSpeedWithBonuses(mission.targetBuiltObject) > 0) {
                bo.preferredSpeed = f(Math.min(warpSpeedWithBonuses(bo), warpSpeedWithBonuses(mission.targetBuiltObject)));
            } else {
                bo.preferredSpeed = f(warpSpeedWithBonuses(bo));
            }
            bo.currentSpeed = bo.preferredSpeed;
        } else {
            bo.preferredSpeed = f(warpSpeedWithBonuses(bo));
            bo.currentSpeed = f(warpSpeedWithBonuses(bo));
        }
        bo.nearestSystemStar = null;
        bo.angle = f(determineAngle(bo.xpos, bo.ypos, num + bo.hyperjumpX, num2 + bo.hyperjumpY));
        bo.targetHeading = bo.angle;
        const heading = bo.heading;
        bo.heading = bo.targetHeading;
        num8 = bo.currentSpeed * timePassed;
        hyperExit.x = num + bo.hyperjumpX;
        hyperExit.y = num2 + bo.hyperjumpY;
        // (3107: a CalculateDistance whose result is discarded)
        bo.lastHyperjumpDistance = f(bo.lastHyperjumpDistance + f(num8));
        bo.lastHyperDistance = galaxy.calculateDistance(bo.xpos, bo.ypos, hyperExit.x, hyperExit.y);
        consumeFuel(galaxy, bo, timePassed);
        const fromX = bo.xpos;
        const fromY = bo.ypos;
        bo.xpos += Math.cos(bo.heading) * num8;
        bo.ypos += Math.sin(bo.heading) * num8;
        checkFuelHandicap(galaxy, bo);
        // Mod layer (19h gravity shoals, not a port): a scenario feature on this step's path ends the jump early at its
        // edge; the HyperTo command then restarts from there (new countdown and exit roll) instead of completing.
        let scenarioStop = false;
        if (galaxy.scenario !== null) {
            const stop = scenarioQuery(galaxy, 'hyperjumpStop', null, { ship: bo, fromX, fromY, toX: bo.xpos, toY: bo.ypos, exitX: hyperExit.x, exitY: hyperExit.y });
            if (stop !== null) {
                hyperExit.x = stop.x;
                hyperExit.y = stop.y;
                scenarioStop = true;
            }
        }
        if (scenarioStop || checkWhetherArrived(galaxy, bo, bo.xpos, bo.ypos, hyperExit.x, hyperExit.y, 0.0)) {
            bo.hyperjumpJustExited = true;
            bo.hyperExitStartAnimation = true;
            bo.hyperjumpPrepare = false;
            bo.hyperEnterStartAnimation = false;
            checkForHyperExitGravityWells(galaxy, bo, hyperExit);
            checkForPlanetDestroyerWeaponFiringDelayOnHyperExit(galaxy, bo, time);
            bo.xpos = hyperExit.x;
            bo.ypos = hyperExit.y;
            if (bo.parentHabitat !== null) {
                bo.parentOffsetX = bo.xpos - bo.parentHabitat.xpos;
                bo.parentOffsetY = bo.ypos - bo.parentHabitat.ypos;
            } else if (bo.parentBuiltObject !== null) {
                bo.parentOffsetX = bo.xpos - bo.parentBuiltObject.xpos;
                bo.parentOffsetY = bo.ypos - bo.parentBuiltObject.ypos;
            }
            bo.lastPositionX = bo.xpos;
            bo.lastPositionY = bo.ypos;
            doHyperjumpExitCharacterEvent(galaxy, bo);
            bo.heading = heading;
            const habitat = galaxy.fastFindNearestSystem(bo.xpos, bo.ypos);
            if (habitat !== null) {
                const num9 = galaxy.calculateDistance(bo.xpos, bo.ypos, habitat.xpos, habitat.ypos);
                if (num9 < MAX_SOLAR_SYSTEM_SIZE + 1000.0) {
                    bo.nearestSystemStar = habitat;
                }
            }
            if (!scenarioStop) mission.completeCommand();
            bo.firstExecutionOfCommand = true;
            const shipGroup2 = shipGroupOf(bo);
            if (mission.isShipGroupMission && shipGroup2 !== null) {
                bo.currentSpeed = f(shipGroupCruiseSpeed(shipGroup2));
            } else {
                bo.currentSpeed = bo.cruiseSpeed;
            }
            const actualEmpire2 = bo.actualEmpire;
            if (actualEmpire2 !== null) {
                actualEmpire2.visibility.resolveSystemVisibilityForUnit(bo, false);
            }
            checkMissionStillValid(galaxy, bo, time);
        }
        updateIndexesForMovement(galaxy, bo, x, y, true);
        return result;
    }
    bo.hyperjumpPrepare = true;
    bo.firstExecutionOfCommand = false;
    if (starDate + 300 > bo.hyperjumpCountdown && bo.canHyperJump) {
        if (detectHyperDeny(galaxy, bo)) {
            bo.canHyperJump = false;
            return 0.0;
        }
        bo.canHyperJump = true;
        bo.hyperjumpAboutToEnter = true;
    }
    accelerateToTargetSpeed(galaxy, bo, timePassed);
    num8 = bo.currentSpeed * timePassed;
    bo.angle = f(determineAngle(bo.xpos, bo.ypos, num, num2));
    bo.targetHeading = bo.angle;
    calculateCurrentHeading(galaxy, bo, timePassed);
    bo.xpos += Math.cos(bo.heading) * num8;
    bo.ypos += Math.sin(bo.heading) * num8;
    updateIndexesForMovement(galaxy, bo, x, y, false);
    return result;
};

/** BuiltObject.2.cs 1159 case HoldSyncFleet. */
export const cmdHoldSyncFleet: CommandHandler = (ctx) => {
    const { bo, mission } = ctx;
    const shipGroup = shipGroupOf(bo);
    if (shipGroup !== null && shipGroup.ships !== null) {
        let flag30 = true;
        for (let num99 = 0; num99 < shipGroup.ships.length; num99++) {
            const builtObject15: BuiltObject = shipGroup.ships[num99];
            if (builtObject15 == null || builtObject15.hasBeenDestroyed || builtObject15.shipGroup !== shipGroup) {
                continue;
            }
            const mission3 = builtObjectMission(builtObject15.mission);
            if (mission3 !== null) {
                const command11 = mission3.fastPeekCurrentCommand();
                if (command11 !== null && command11.action !== CommandAction.HoldSyncFleet && mission3.checkCommandsForAction(CommandAction.HoldSyncFleet)) {
                    flag30 = false;
                    break;
                }
            }
        }
        if (flag30) {
            for (let num100 = 0; num100 < shipGroup.ships.length; num100++) {
                const builtObject16: BuiltObject = shipGroup.ships[num100];
                if (builtObject16 != null && !builtObject16.hasBeenDestroyed && builtObject16.shipGroup === shipGroup) {
                    const mission4 = builtObjectMission(builtObject16.mission);
                    if (mission4 !== null && mission4.completeCommandIfMatchesAction(CommandAction.HoldSyncFleet)) {
                        builtObject16.firstExecutionOfCommand = true;
                    }
                }
            }
        }
    } else {
        mission.completeCommand();
        bo.firstExecutionOfCommand = true;
    }
    return 0.0;
};
