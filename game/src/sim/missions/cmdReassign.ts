// M4f — ExecuteCommands case ReassignMission (BuiltObject.2.cs 3999-4226).
//
// One `case` of the C# switch with the `CommandHandler` signature from executeCommands.ts: it receives the shared
// locals (`CommandContext`) and returns the C# `result` (seconds left for the DoTasks loop). Every Galaxy.Rnd draw is on
// `galaxy.rnd` in C# order (two NextDouble per black-hole target). The pirate branch calls the M4s2 stub
// pirateAssignShipMission (RND: the draws inside PirateAssignShipMission are not made until M4s2).

import type { CommandHandler } from './executeCommands';
import { BuiltObjectMissionType, Command, CommandAction, builtObjectMission } from './mission';
import { assignMission, assignQueuedMission, clearPreviousMissionRequirements, revertToPreviousMission } from './assign';
import { autoRefuelRepairShip } from '../logistics/refuel';
import { assignMissionToBuiltObject, fastFindNearestUnexploredHabitatInSector, findNearestUnexploredHabitatInSystem } from '../civilianAI';
import { pirateAssignShipMission } from '../pirates/pirateAI';
import { HabitatCategoryType, HabitatType, type Habitat } from '../types';
import { BuiltObjectSubRole } from '../builtObjectTypes';
import type { Galaxy } from '../galaxy';
import type { BuiltObject } from '../builtObject';

/** BuiltObject.2.cs 4009-4020 (and 4069-4079, 4118-4128, 4195-4205, 4211-4221): pick the next mission for an idle ship. */
function reassignFromEmpire(galaxy: Galaxy, bo: BuiltObject, starDate: number): void {
    const empire = bo.empire;
    if (empire === null) return;
    if (empire.pirateEmpireBaseHabitat === null) {
        assignMissionToBuiltObject(galaxy, empire, bo, false, null);
    } else {
        pirateAssignShipMission(galaxy, empire, bo, starDate);
    }
}

/** BuiltObject.2.cs 4024-4047 / 4085-4108: the explore command queue for the next habitat (black holes get a parking point). Rnd: NextDouble x2 for a black hole. */
function exploreCommandQueue(galaxy: Galaxy, habitat: Habitat): Command[] {
    const commandQueue: Command[] = [];
    commandQueue.push(new Command(CommandAction.ClearParent));
    if (habitat.type === HabitatType.BlackHole) {
        const num22 = galaxy.rnd.nextDouble() * Math.PI * 2.0;
        const num23 = habitat.diameter * 0.7 + galaxy.rnd.nextDouble() * 500.0;
        const x3 = habitat.xpos + num23 * Math.sin(num22);
        const y3 = habitat.ypos + num23 * Math.cos(num22);
        commandQueue.push(Command.at(CommandAction.ConditionalHyperTo, x3, y3));
        commandQueue.push(Command.at(CommandAction.MoveTo, x3, y3));
    } else {
        commandQueue.push(Command.forTarget(CommandAction.ConditionalHyperTo, habitat));
        commandQueue.push(Command.forTarget(CommandAction.SetParent, habitat));
        commandQueue.push(Command.forTarget(CommandAction.MoveTo, habitat));
    }
    commandQueue.push(new Command(CommandAction.ScanArea));
    commandQueue.push(new Command(CommandAction.ClearParent));
    commandQueue.push(new Command(CommandAction.ReassignMission));
    return commandQueue;
}

/** BuiltObject.2.cs 3999 case ReassignMission. */
export const cmdReassignMission: CommandHandler = (ctx) => {
    const { galaxy, bo, starDate, timePassed } = ctx;
    let result: number;
    if (!revertToPreviousMission(galaxy, bo)) {
        const mission = builtObjectMission(bo.mission);
        if (mission !== null && mission.targetSector !== null) {
            const habitat3 = fastFindNearestUnexploredHabitatInSector(galaxy, bo.xpos, bo.ypos, bo.actualEmpire!, mission.targetSector);
            if (habitat3 === null) {
                clearPreviousMissionRequirements(galaxy, bo);
                bo.firstExecutionOfCommand = true;
                if (!assignQueuedMission(galaxy, bo)) {
                    reassignFromEmpire(galaxy, bo, starDate);
                }
            } else {
                mission.replaceCommandStack(exploreCommandQueue(galaxy, habitat3));
            }
        } else if (mission !== null && mission.type === BuiltObjectMissionType.Explore && mission.targetHabitat !== null && mission.targetHabitat.category === HabitatCategoryType.Star) {
            const targetHabitat2 = mission.targetHabitat;
            let flag11 = false;
            if (bo.empire !== null) {
                const galaxyIndex2 = galaxy.resolveIndex(bo.xpos, bo.ypos);
                const cell = galaxy.builtObjectIndexGrid[galaxyIndex2.x][galaxyIndex2.y];
                if (cell.length > 0) {
                    for (let k = 0; k < cell.length; k++) {
                        const builtObject2 = cell[k];
                        const m2 = builtObject2 == null ? null : builtObjectMission(builtObject2.mission);
                        if (builtObject2 == null || builtObject2.subRole !== BuiltObjectSubRole.ExplorationShip || builtObject2.empire !== bo.empire || builtObject2 === bo || m2 === null || m2.type !== BuiltObjectMissionType.Explore || m2.targetHabitat === null) {
                            continue;
                        }
                        const habitat4 = galaxy.determineHabitatSystemStar(m2.targetHabitat);
                        if (habitat4 !== bo.nearestSystemStar) continue;
                        clearPreviousMissionRequirements(galaxy, bo);
                        bo.firstExecutionOfCommand = true;
                        if (!assignQueuedMission(galaxy, bo)) {
                            reassignFromEmpire(galaxy, bo, starDate);
                        }
                        flag11 = true;
                    }
                }
            }
            if (flag11) {
                result = 0.0;
                return result;
            }
            const habitat5 = findNearestUnexploredHabitatInSystem(galaxy, Math.trunc(targetHabitat2.xpos), Math.trunc(targetHabitat2.ypos), targetHabitat2, bo.actualEmpire!, true);
            if (habitat5 !== null) {
                mission.replaceCommandStack(exploreCommandQueue(galaxy, habitat5));
            } else {
                clearPreviousMissionRequirements(galaxy, bo);
                bo.firstExecutionOfCommand = true;
                if (!assignQueuedMission(galaxy, bo)) {
                    reassignFromEmpire(galaxy, bo, starDate);
                }
            }
        } else if (mission !== null && mission.type === BuiltObjectMissionType.Escort && !bo.isAutoControlled) {
            if (bo.subsequentMissions != null && bo.subsequentMissions.length > 0) {
                clearPreviousMissionRequirements(galaxy, bo);
                bo.firstExecutionOfCommand = true;
                if (assignQueuedMission(galaxy, bo)) {
                    // (empty in the C#)
                }
            } else if (!autoRefuelRepairShip(galaxy, bo, true)) {
                let flag12 = true;
                if (mission.targetBuiltObject !== null && mission.targetBuiltObject.hasBeenDestroyed) flag12 = false;
                if (!flag12) {
                    clearPreviousMissionRequirements(galaxy, bo);
                    bo.firstExecutionOfCommand = true;
                    result = 0.0;
                    return result;
                }
                assignMission(galaxy, bo, mission.type, mission.target, mission.secondaryTarget, mission.priority);
            }
        } else if (mission !== null && mission.type === BuiltObjectMissionType.Patrol && !bo.isAutoControlled) {
            if (bo.subsequentMissions != null && bo.subsequentMissions.length > 0) {
                clearPreviousMissionRequirements(galaxy, bo);
                bo.firstExecutionOfCommand = true;
                if (assignQueuedMission(galaxy, bo)) {
                    // (empty in the C#)
                }
            } else if (!autoRefuelRepairShip(galaxy, bo, true)) {
                let flag13 = true;
                if (mission.targetBuiltObject !== null && mission.targetBuiltObject.hasBeenDestroyed) flag13 = false;
                if (mission.targetHabitat !== null && mission.targetHabitat.hasBeenDestroyed) flag13 = false;
                if (mission.targetCreature !== null && mission.targetCreature.hasBeenDestroyed) flag13 = false;
                if (!flag13) {
                    clearPreviousMissionRequirements(galaxy, bo);
                    bo.firstExecutionOfCommand = true;
                    result = 0.0;
                    return result;
                }
                assignMission(galaxy, bo, mission.type, mission.target, mission.secondaryTarget, mission.priority);
            }
        } else if (bo.subsequentMissions != null && bo.subsequentMissions.length > 0) {
            if (!assignQueuedMission(galaxy, bo) && bo.empire !== null) {
                reassignFromEmpire(galaxy, bo, starDate);
            }
        } else if (!revertToPreviousMission(galaxy, bo)) {
            clearPreviousMissionRequirements(galaxy, bo);
            bo.firstExecutionOfCommand = true;
            if (bo.empire !== null) {
                reassignFromEmpire(galaxy, bo, starDate);
            }
        }
    }
    result = timePassed;
    return result;
};
