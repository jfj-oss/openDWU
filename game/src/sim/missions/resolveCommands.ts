// M4b — BaconBuiltObjectMission.cs: ResolveCommandsForMission (141-1246, the mod's replacement of
// BuiltObjectMission.ResolveCommandsForMission — mission type → command queue) and LoadMoreCargo (17-135, the mod's
// post-processing of Transport missions). Statement-for-statement in C# order.
//
// Rnd sites (all through galaxy.rnd, in C# order):
//   Explore/Move to a black hole: NextDouble ×2 (238-239, 1134-1135); Move to a star (reprocessing): NextDouble ×2
//   (1153, 1157); Patrol (non-star): Next(11, 14) (615 / 673); Escape: NextDouble (778), independent-empire branch
//   SelectRandomHeading + NextDouble + ObtainCoordinatesFromPoint (Next(0,2) ×2) (817-821); every GenerateParkCommand
//   / SelectRelativeParkingPoint: NextDouble, Next(0,2), NextDouble.
// C# wraps the whole switch in try/catch: an ApplicationException thrown for an invalid target ends the resolution
// with the commands queued so far (and pauses the game, UI only). `MissionResolveError` reproduces that.

import type { BuiltObject } from '../builtObject';
import type { Habitat } from '../types';
import { HabitatCategoryType, HabitatType } from '../types';
import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import { BuiltObjectRole } from '../data/designSpecifications';
import { BuiltObjectSubRole } from '../builtObjectTypes';
import { ComponentStatus } from '../builtObjectComponent';
import { ComponentType, type Component } from '../data/components';
import { Cargo, CargoList, ResourceRef } from '../cargo';
import { conditionCheckLimit } from '../tick/builtObjectTick';
import { determineAngle } from '../creature';
import { fastFindNearestSpacePort, resolveRetrofitResourcesForBase } from '../stationPlacement';
import { withinFuelRange } from '../movement';
import { calculateAttackingFirepowerNearEmpireTargets } from '../combat/threats';
import { determineActualFleetLocation } from '../fleets/shipGroup';
import { Contract } from '../logistics/contracts';
import {
    BuiltObjectMission,
    BuiltObjectMissionType,
    Command,
    CommandAction,
    cloneCargoList,
    clonePopulationList,
    isBuiltObject,
    isHabitat,
    type StellarObject,
} from './mission';

/** Galaxy.3.cs 4976 PatrolOrbitDistance = 400. */
export const PATROL_ORBIT_DISTANCE = 400;
/** Galaxy.3.cs 4991 EscapeHyperDistance = 200000. */
export const ESCAPE_HYPER_DISTANCE = 200000;

/** The C# ApplicationException thrown inside ResolveCommandsForMission (caught by its own try/catch). */
class MissionResolveError extends Error {}

export interface ResolvedCommands {
    /** null only for Build/BuildRepair on a non-shipyard (262). */
    commands: Command[] | null;
    couldResolveCommands: boolean;
}

/** Empire.5.cs 3939 ObtainCoordinatesFromPoint — Rnd: Next(0,2) ×2. */
export function obtainCoordinatesFromPoint(galaxy: Galaxy, angle: number, startX: number, startY: number, distance: number): { x: number; y: number } {
    let num = Math.cos(angle) * distance;
    let num2 = Math.sin(angle) * distance;
    if (galaxy.rnd.next(0, 2) === 1) {
        num *= -1.0;
    }
    if (galaxy.rnd.next(0, 2) === 1) {
        num2 *= -1.0;
    }
    return { x: startX + num, y: startY + num2 };
}

/** Galaxy.3.cs 1591 FastFindNearestColonyNotInSystem. TODO(port): Habitat.StrategicValue (threshold 0 ⇒ every colony passes). */
export function fastFindNearestColonyNotInSystem(galaxy: Galaxy, x: number, y: number, empire: Empire, strategicValueThreshhold: number, colonyToExclude: Habitat | null): Habitat | null {
    let num = Number.MAX_VALUE;
    let result: Habitat | null = null;
    const habitat = colonyToExclude !== null ? galaxy.determineHabitatSystemStar(colonyToExclude) : null;
    for (let i = 0; i < empire.colonies.length; i++) {
        if (0 < strategicValueThreshhold) {
            continue;
        }
        const habitat2 = galaxy.determineHabitatSystemStar(empire.colonies[i]);
        if (colonyToExclude === null || habitat2 !== habitat) {
            const num2 = galaxy.calculateDistanceSquared(x, y, empire.colonies[i].xpos, empire.colonies[i].ypos);
            if (num2 < num) {
                result = empire.colonies[i];
                num = num2;
            }
        }
    }
    return result;
}

/**
 * Empire.5.cs 455 FindNearestSpaceportWithCargo. The decompiled body never assigns `cargo2` (the GetCargo results
 * are discarded), so no spaceport ever satisfies the "has all cargo" test and the result is simply the nearest
 * spaceport whose Cargo list is non-null. Ported as it runs.
 */
export function findNearestSpaceportWithCargo(galaxy: Galaxy, empire: Empire, x: number, y: number, cargoItems: CargoList | null): BuiltObject | null {
    let builtObject: BuiltObject | null = null;
    let builtObject2: BuiltObject | null = null;
    let num = Number.MAX_VALUE;
    let num2 = Number.MAX_VALUE;
    if (cargoItems !== null && empire.spacePorts !== null) {
        for (let i = 0; i < empire.spacePorts.length; i++) {
            const builtObject3 = empire.spacePorts[i];
            if (builtObject3 == null || builtObject3.cargo === null) {
                continue;
            }
            const num3 = galaxy.calculateDistanceSquared(x, y, builtObject3.xpos, builtObject3.ypos);
            if (!(num3 < num2)) {
                continue;
            }
            let flag = true;
            for (let j = 0; j < cargoItems.items.length; j++) {
                const cargo = cargoItems.items[j];
                if (cargo == null) {
                    continue;
                }
                const flag2 = false; // cargo2 is never assigned in the C# (decompiled dead store)
                if (!flag2) {
                    flag = false;
                    break;
                }
            }
            if (flag) {
                // only reached with an empty cargoItems list (flag is always false otherwise)
                if (num3 < num2) {
                    builtObject2 = builtObject3;
                    num2 = num3;
                }
            } else if (num3 < num) {
                builtObject = builtObject3;
                num = num3;
            }
        }
    }
    return builtObject2 ?? builtObject;
}

/** A `Command` targeting `target` by its runtime type (Command(action, BuiltObject|Habitat|Creature|ShipGroup)). */
function cmd(action: CommandAction, target: StellarObject | import('../fleets/shipGroup').ShipGroup | null): Command {
    return Command.forTarget(action, target);
}

/** BaconBuiltObjectMission.cs 141 ResolveCommandsForMission(theThis, mission, allowReprocessing, specifiedAsFleetMission, out couldResolveCommands). */
export function resolveCommandsForMission(theThis: BuiltObjectMission, mission: BuiltObjectMission, allowReprocessing: boolean, specifiedAsFleetMission: boolean): ResolvedCommands {
    let couldResolveCommands = true;
    const commandQueue: Command[] = [];
    const galaxy = theThis._galaxy;
    const ship = theThis._builtObject;
    const enqueue = (c: Command): void => {
        commandQueue.push(c);
    };
    try {
        // 152-153 (`_BuiltObject.Xpos` on a null ship → NullReferenceException → caught → empty queue)
        const point = theThis.resolveTargetCoordinates(mission);
        if (ship === null) throw new MissionResolveError('NullReferenceException: _BuiltObject');
        galaxy.calculateDistance(ship.xpos, ship.ypos, point.x, point.y);
        // 154-227: the per-target command templates.
        let command1: Command | null = null;
        let command2: Command;
        let command3: Command;
        let command4: Command;
        let command5: Command;
        let command6: Command;
        let command7: Command;
        let command8: Command;
        let command9: Command;
        let command10: Command;
        let command11: Command;
        let command12: Command;
        let command13: Command;
        const t: StellarObject | import('../fleets/shipGroup').ShipGroup | null =
            mission.targetBuiltObject !== null ? mission.targetBuiltObject : mission.targetHabitat !== null ? mission.targetHabitat : mission.targetCreature !== null ? mission.targetCreature : mission.targetShipGroup;
        command2 = cmd(CommandAction.ConditionalHyperTo, t);
        command3 = cmd(CommandAction.SetParent, t);
        command4 = cmd(CommandAction.MoveTo, t);
        command5 = cmd(CommandAction.Dock, t);
        command6 = cmd(CommandAction.Undock, t);
        command7 = cmd(CommandAction.Attack, t);
        if (mission.targetBuiltObject === null && mission.targetHabitat !== null) {
            command1 = cmd(CommandAction.Bombard, mission.targetHabitat);
        }
        command8 = cmd(CommandAction.ExtractResources, t);
        command9 = cmd(CommandAction.ImpulseTo, t);
        command10 = cmd(CommandAction.Blockade, t);
        command11 = cmd(CommandAction.Escort, t);
        command12 = cmd(CommandAction.SprintTo, t);
        command13 = cmd(CommandAction.SelectTargetToAttack, t);
        switch (mission.type) {
            case BuiltObjectMissionType.Explore: {
                // 231-258
                const targetHabitat1 = mission.targetHabitat;
                if (targetHabitat1 !== null) {
                    enqueue(new Command(CommandAction.ClearParent));
                    if (targetHabitat1.type === HabitatType.BlackHole) {
                        const num1 = galaxy.rnd.nextDouble() * Math.PI * 2.0;
                        const num2 = targetHabitat1.diameter * 0.7 + galaxy.rnd.nextDouble() * 500.0;
                        const x = targetHabitat1.xpos + num2 * Math.sin(num1);
                        const y = targetHabitat1.ypos + num2 * Math.cos(num1);
                        enqueue(Command.at(CommandAction.ConditionalHyperTo, x, y));
                        enqueue(Command.at(CommandAction.MoveTo, x, y));
                    } else {
                        enqueue(cmd(CommandAction.ConditionalHyperTo, targetHabitat1));
                        enqueue(cmd(CommandAction.SetParent, targetHabitat1));
                        enqueue(cmd(CommandAction.MoveTo, targetHabitat1));
                    }
                    enqueue(new Command(CommandAction.ScanArea));
                    enqueue(new Command(CommandAction.ClearParent));
                    enqueue(new Command(CommandAction.ReassignMission));
                    return { commands: commandQueue, couldResolveCommands };
                }
                enqueue(new Command(CommandAction.ClearParent));
                enqueue(new Command(CommandAction.ReassignMission));
                return { commands: commandQueue, couldResolveCommands };
            }
            case BuiltObjectMissionType.Build:
            case BuiltObjectMissionType.BuildRepair: {
                // 259-499
                if (!ship!.isShipYard) {
                    return { commands: null, couldResolveCommands };
                }
                let x1: number;
                let y1: number;
                if (mission.targetBuiltObject !== null) {
                    x1 = mission.targetBuiltObject.xpos;
                    y1 = mission.targetBuiltObject.ypos;
                } else if (mission.targetHabitat !== null) {
                    x1 = mission.targetHabitat.xpos;
                    y1 = mission.targetHabitat.ypos;
                } else {
                    if (mission.targetCreature !== null) throw new MissionResolveError('Invalid build commmand location');
                    if (mission.targetShipGroup !== null) throw new MissionResolveError('Invalid build commmand location');
                    x1 = mission.x;
                    y1 = mission.y;
                }
                if (ship!.subRole === BuiltObjectSubRole.ConstructionShip && ship!.cargo !== null) {
                    for (const cargo of ship!.cargo.items) {
                        cargo.reserved = 0;
                    }
                }
                const cargoItems = new CargoList();
                const componentList: Component[] = [];
                let cargoList1: CargoList | null = null;
                if (mission.secondaryTargetBuiltObject !== null) {
                    if (ship!.cargo !== null) {
                        cargoList1 = cloneCargoList(ship!.cargo);
                    }
                    for (const component of mission.secondaryTargetBuiltObject.components.items) {
                        if (component.status === ComponentStatus.Unbuilt) {
                            let flag = true;
                            if (cargoList1 !== null) {
                                // BaconBuiltObjectMission.cs 301: cargoList1.IndexOf((Component) component, ActualEmpire) — a
                                // prefabricated component in the ship's cargo (clone) is used instead of building it.
                                const index = cargoList1.indexOfComponent(component.componentId, ship!.actualEmpire);
                                if (index >= 0 && cargoList1.items[index].amount > 0) {
                                    flag = false;
                                    --cargoList1.items[index].amount;
                                }
                            }
                            if (flag) componentList.push(component.def);
                        }
                    }
                } else if (mission.design !== null) {
                    // Design.Components.Clone(): a copy of the list (the same definitions).
                    componentList.push(...mission.design.components.slice());
                }
                if (componentList.length > 0) {
                    for (const component of componentList) {
                        for (const requiredResource of component.resourceRequirements) {
                            const cargo = new Cargo(new ResourceRef(requiredResource.resourceId), Math.trunc(requiredResource.amount), ship!.actualEmpire);
                            cargoItems.add(cargo);
                        }
                    }
                }
                if ((mission.targetHabitat === null || mission.targetHabitat.empire !== ship!.actualEmpire) && mission.design !== null && mission.design.role === BuiltObjectRole.Base) {
                    const cargoList2 = resolveRetrofitResourcesForBase(galaxy, ship!.empire!);
                    for (let index = 0; index < cargoList2.items.length; ++index) {
                        cargoItems.add(cargoList2.items[index]);
                    }
                }
                const cargoList3: Cargo[] = [];
                for (let index1 = 0; index1 < cargoItems.items.length; ++index1) {
                    const cargo = cargoItems.items[index1];
                    if (cargo.commodity != null) {
                        const commodityResource = cargo.commodity;
                        let index2 = -1;
                        if (ship!.cargo !== null) {
                            index2 = ship!.cargo.indexOf(commodityResource, ship!.actualEmpire);
                        }
                        if (index2 >= 0) {
                            cargo.amount -= ship!.cargo!.items[index2].amount;
                            if (cargo.amount <= 0) cargoList3.push(cargo);
                        }
                    }
                }
                for (const cargo of cargoList3) {
                    cargoItems.remove(cargo);
                }
                if (cargoItems.items.length > 0) {
                    const spaceportWithCargo = findNearestSpaceportWithCargo(galaxy, ship!.actualEmpire!, x1, y1, cargoItems);
                    if (spaceportWithCargo !== null) {
                        const cargoList4 = new CargoList();
                        for (const cargo1 of cargoItems.items) {
                            const commodityResource = cargo1.commodity;
                            let index = -1;
                            if (spaceportWithCargo.cargo !== null) {
                                index = spaceportWithCargo.cargo.indexOf(commodityResource, ship!.actualEmpire);
                            }
                            if (index >= 0) {
                                const spaceportCargo = spaceportWithCargo.cargo!.items[index];
                                // Cargo.Available => Amount - Reserved.
                                const num = Math.min(cargo1.amount, spaceportCargo.amount - spaceportCargo.reserved);
                                if (num > 0) {
                                    const cargo2 = new Cargo(commodityResource, num, ship!.actualEmpire, num);
                                    cargoList4.add(cargo2);
                                    spaceportCargo.reserved += num;
                                    // new Contract(spaceportWithCargo, num, resourceId, -1, ActualEmpire.EmpireId); ContractsToFulfill.Add(contract)
                                    const contract = new Contract(spaceportWithCargo, num, commodityResource.resourceId, -1, ship!.actualEmpire!.empireId);
                                    ship!.contractsToFulfill.push(contract);
                                }
                            }
                        }
                        if (cargoList4.items.length > 0) {
                            enqueue(new Command(CommandAction.ClearParent));
                            enqueue(cmd(CommandAction.ConditionalHyperTo, spaceportWithCargo));
                            enqueue(cmd(CommandAction.SetParent, spaceportWithCargo));
                            enqueue(cmd(CommandAction.MoveTo, spaceportWithCargo));
                            enqueue(cmd(CommandAction.Dock, spaceportWithCargo));
                            enqueue(new Command(CommandAction.Refuel));
                            enqueue(Command.withCargo(CommandAction.Load, cargoList4));
                            enqueue(cmd(CommandAction.Undock, spaceportWithCargo));
                        }
                    }
                }
                if (mission.targetBuiltObject !== null || mission.targetHabitat !== null) {
                    enqueue(new Command(CommandAction.ClearParent));
                    const command14 = command2.clone();
                    if (mission.x > -2000000000.0 && mission.y > -2000000000.0) {
                        command14.targetRelativeXpos = mission.x;
                        command14.targetRelativeYpos = mission.y;
                    }
                    enqueue(command14);
                    enqueue(command3.clone());
                    if (mission.x > -2000000000.0 && mission.y > -2000000000.0) {
                        const command15 = new Command(CommandAction.MoveTo);
                        if (mission.targetBuiltObject !== null) command15.targetBuiltObject = mission.targetBuiltObject;
                        else if (mission.targetHabitat !== null) command15.targetHabitat = mission.targetHabitat;
                        else command15.targetShipGroup = mission.targetShipGroup;
                        command15.targetRelativeXpos = mission.x;
                        command15.targetRelativeYpos = mission.y;
                        enqueue(command15);
                        const command16 = new Command(CommandAction.ImpulseTo);
                        if (mission.targetBuiltObject !== null) command16.targetBuiltObject = mission.targetBuiltObject;
                        else if (mission.targetHabitat !== null) command16.targetHabitat = mission.targetHabitat;
                        else command16.targetShipGroup = mission.targetShipGroup;
                        command16.targetRelativeXpos = mission.x;
                        command16.targetRelativeYpos = mission.y;
                        enqueue(command16);
                    } else {
                        const command17 = new Command(CommandAction.MoveTo);
                        if (mission.targetBuiltObject !== null) command17.targetBuiltObject = mission.targetBuiltObject;
                        else if (mission.targetHabitat !== null) command17.targetHabitat = mission.targetHabitat;
                        else if (mission.targetCreature !== null) command17.targetCreature = mission.targetCreature;
                        else command17.targetShipGroup = mission.targetShipGroup;
                        command17.targetRelativeXpos = 0.0;
                        command17.targetRelativeYpos = 0.0;
                        enqueue(command17);
                        const command18 = new Command(CommandAction.ImpulseTo);
                        if (mission.targetBuiltObject !== null) command18.targetBuiltObject = mission.targetBuiltObject;
                        else if (mission.targetHabitat !== null) command18.targetHabitat = mission.targetHabitat;
                        else if (mission.targetCreature !== null) command18.targetCreature = mission.targetCreature;
                        else command18.targetShipGroup = mission.targetShipGroup;
                        command18.targetRelativeXpos = 0.0;
                        command18.targetRelativeYpos = 0.0;
                        enqueue(command18);
                    }
                } else if (mission.secondaryTargetBuiltObject !== null) {
                    enqueue(new Command(CommandAction.ClearParent));
                    enqueue(cmd(CommandAction.ConditionalHyperTo, mission.secondaryTargetBuiltObject));
                    if (mission.secondaryTargetBuiltObject.parentHabitat !== null) enqueue(cmd(CommandAction.SetParent, mission.secondaryTargetBuiltObject));
                    enqueue(cmd(CommandAction.MoveTo, mission.secondaryTargetBuiltObject));
                    enqueue(cmd(CommandAction.ImpulseTo, mission.secondaryTargetBuiltObject));
                    if (mission.secondaryTargetBuiltObject.parentHabitat !== null) enqueue(cmd(CommandAction.SetParent, mission.secondaryTargetBuiltObject.parentHabitat));
                } else {
                    galaxy.calculateDistance(ship!.xpos, ship!.ypos, mission.x, mission.y);
                    enqueue(new Command(CommandAction.ClearParent));
                    enqueue(Command.at(CommandAction.ConditionalHyperTo, mission.x, mission.y));
                    enqueue(Command.at(CommandAction.MoveTo, mission.x, mission.y));
                    enqueue(Command.at(CommandAction.ImpulseTo, mission.x, mission.y));
                }
                if (mission.secondaryTargetBuiltObject !== null || mission.secondaryTargetHabitat !== null || mission.secondaryTargetCreature !== null || mission.secondaryTargetShipGroup !== null) {
                    if (mission.secondaryTargetBuiltObject !== null) {
                        enqueue(cmd(CommandAction.Build, mission.secondaryTargetBuiltObject));
                        return { commands: commandQueue, couldResolveCommands };
                    }
                    if (mission.secondaryTargetHabitat !== null) {
                        enqueue(cmd(CommandAction.Build, mission.secondaryTargetHabitat));
                        return { commands: commandQueue, couldResolveCommands };
                    }
                    if (mission.secondaryTargetCreature !== null) {
                        enqueue(cmd(CommandAction.Build, mission.secondaryTargetCreature));
                        return { commands: commandQueue, couldResolveCommands };
                    }
                    enqueue(cmd(CommandAction.Build, mission.secondaryTargetShipGroup));
                    return { commands: commandQueue, couldResolveCommands };
                }
                if (mission.design !== null) {
                    enqueue(Command.withDesign(CommandAction.Build, mission.design));
                    // 494: `(TargetBuiltObject != null || TargetHabitat != null) && (TargetHabitat == null || Category != Star) && TargetHabitat.Category != GasCloud`
                    // — the last term dereferences a null TargetHabitat (NullReferenceException → caught → queue as is).
                    if ((mission.targetBuiltObject !== null || mission.targetHabitat !== null) && (mission.targetHabitat === null || mission.targetHabitat.category !== HabitatCategoryType.Star)) {
                        if (mission.targetHabitat === null) throw new MissionResolveError('NullReferenceException: TargetHabitat.Category');
                        if (mission.targetHabitat.category !== HabitatCategoryType.GasCloud) enqueue(theThis.generateParkCommand());
                    }
                    return { commands: commandQueue, couldResolveCommands };
                }
                couldResolveCommands = false;
                return { commands: commandQueue, couldResolveCommands };
            }
            case BuiltObjectMissionType.Transport: {
                // 500-549
                enqueue(new Command(CommandAction.ClearParent));
                enqueue(command2.clone());
                enqueue(command3.clone());
                enqueue(command4.clone());
                enqueue(command5.clone());
                enqueue(new Command(CommandAction.Refuel));
                if (mission.cargo === null || mission.cargo.items.length <= 0) {
                    if (mission.population !== null && mission.population.items.length > 0) enqueue(Command.withPopulation(CommandAction.Load, clonePopulationList(mission.population)));
                } else {
                    enqueue(Command.withCargo(CommandAction.Load, cloneCargoList(mission.cargo)));
                }
                enqueue(command6.clone());
                if (mission.secondaryTargetHabitat !== null) {
                    const secondaryTargetHabitat = mission.secondaryTargetHabitat;
                    galaxy.calculateDistance(secondaryTargetHabitat.xpos, secondaryTargetHabitat.ypos, point.x, point.y);
                    enqueue(cmd(CommandAction.ConditionalHyperTo, secondaryTargetHabitat));
                    enqueue(cmd(CommandAction.SetParent, secondaryTargetHabitat));
                    enqueue(cmd(CommandAction.MoveTo, secondaryTargetHabitat));
                    enqueue(cmd(CommandAction.Dock, secondaryTargetHabitat));
                    if (mission.cargo !== null && mission.cargo.items.length > 0) enqueue(Command.withCargo(CommandAction.Unload, cloneCargoList(mission.cargo)));
                    else if (mission.population !== null && mission.population.items.length > 0) enqueue(Command.withPopulation(CommandAction.Unload, clonePopulationList(mission.population)));
                    enqueue(new Command(CommandAction.Refuel));
                    enqueue(cmd(CommandAction.Undock, secondaryTargetHabitat));
                    enqueue(cmd(CommandAction.SetParent, secondaryTargetHabitat));
                } else {
                    if (mission.secondaryTargetBuiltObject === null) throw new MissionResolveError('Invalid mission target type');
                    const target = mission.secondaryTargetBuiltObject;
                    galaxy.calculateDistance(target.xpos, target.ypos, point.x, point.y);
                    enqueue(cmd(CommandAction.ConditionalHyperTo, target));
                    enqueue(cmd(CommandAction.SetParent, target));
                    enqueue(cmd(CommandAction.MoveTo, target));
                    enqueue(cmd(CommandAction.Dock, target));
                    if (mission.cargo !== null && mission.cargo.items.length > 0) enqueue(Command.withCargo(CommandAction.Unload, cloneCargoList(mission.cargo)));
                    else if (mission.population !== null && mission.population.items.length > 0) enqueue(Command.withPopulation(CommandAction.Unload, clonePopulationList(mission.population)));
                    enqueue(new Command(CommandAction.Refuel));
                    enqueue(cmd(CommandAction.Undock, target));
                    if (target.role === BuiltObjectRole.Base) enqueue(cmd(CommandAction.SetParent, target));
                }
                enqueue(theThis.generateParkCommand());
                return { commands: commandQueue, couldResolveCommands };
            }
            case BuiltObjectMissionType.Patrol: {
                // 550-682
                enqueue(new Command(CommandAction.ClearParent));
                enqueue(command2.clone());
                enqueue(command3.clone());
                if (mission.targetBuiltObject === null) {
                    if (mission.targetHabitat === null) throw new MissionResolveError('Invalid mission target type');
                    const habitat1 = mission.targetHabitat;
                    if (habitat1.category === HabitatCategoryType.Star) {
                        let index = galaxy.habitats.indexOf(habitat1) + 1;
                        // Habitats[index] past the end → ArgumentOutOfRangeException → caught → queue so far.
                        if (index >= galaxy.habitats.length) throw new MissionResolveError('ArgumentOutOfRangeException: Habitats[index]');
                        let habitat2 = galaxy.habitats[index];
                        const iterationCount = { count: 0 };
                        for (; conditionCheckLimit(habitat2.parent !== null, 500, iterationCount); habitat2 = galaxy.habitats[index]) {
                            if (habitat2.owner === ship!.empire) enqueue(cmd(CommandAction.MoveTo, habitat2));
                            ++index;
                            if (index >= galaxy.habitats.length) return { commands: commandQueue, couldResolveCommands };
                        }
                        return { commands: commandQueue, couldResolveCommands };
                    }
                    const commandList: Command[] = [];
                    const num3 = Math.PI / 3.0;
                    const num4 = 0.0;
                    const num5 = -PATROL_ORBIT_DISTANCE;
                    const num6 = 0.0 + PATROL_ORBIT_DISTANCE * Math.sin(num3);
                    const num7 = 0.0 + PATROL_ORBIT_DISTANCE * Math.cos(num3);
                    const num8 = 0.0 - PATROL_ORBIT_DISTANCE * Math.sin(num3);
                    const num9 = num7;
                    const command19 = new Command(CommandAction.MoveTo);
                    command19.targetRelativeXpos = num4;
                    command19.targetRelativeYpos = num5;
                    if (mission.targetBuiltObject !== null) command19.targetBuiltObject = mission.targetBuiltObject;
                    else if (mission.targetHabitat !== null) command19.targetHabitat = mission.targetHabitat;
                    else {
                        if (mission.targetShipGroup === null) throw new MissionResolveError('Invalid patrol target');
                        command19.targetShipGroup = mission.targetShipGroup;
                    }
                    commandList.push(command19);
                    const command20 = new Command(CommandAction.MoveTo);
                    command20.targetRelativeXpos = num6;
                    command20.targetRelativeYpos = num7;
                    if (mission.targetBuiltObject !== null) command20.targetBuiltObject = mission.targetBuiltObject;
                    else if (mission.targetHabitat !== null) command20.targetHabitat = mission.targetHabitat;
                    else if (mission.targetShipGroup !== null) command20.targetShipGroup = mission.targetShipGroup;
                    commandList.push(command20);
                    const command21 = new Command(CommandAction.MoveTo);
                    command21.targetRelativeXpos = num8;
                    command21.targetRelativeYpos = num9;
                    if (mission.targetBuiltObject !== null) command21.targetBuiltObject = mission.targetBuiltObject;
                    else if (mission.targetHabitat !== null) command21.targetHabitat = mission.targetHabitat;
                    else if (mission.targetShipGroup !== null) command21.targetShipGroup = mission.targetShipGroup;
                    commandList.push(command21);
                    const num10 = galaxy.rnd.next(11, 14);
                    for (let index = 0; index < num10; ++index) {
                        enqueue(commandList[0]);
                        enqueue(commandList[1]);
                        enqueue(commandList[2]);
                    }
                    enqueue(new Command(CommandAction.ClearParent));
                    enqueue(new Command(CommandAction.ReassignMission));
                    return { commands: commandQueue, couldResolveCommands };
                }
                const commandList1: Command[] = [];
                const num11 = Math.PI / 3.0;
                const num12 = 0.0;
                const num13 = -PATROL_ORBIT_DISTANCE;
                const num14 = 0.0 + PATROL_ORBIT_DISTANCE * Math.sin(num11);
                const num15 = 0.0 + PATROL_ORBIT_DISTANCE * Math.cos(num11);
                const num16 = 0.0 - PATROL_ORBIT_DISTANCE * Math.sin(num11);
                const num17 = num15;
                const command22 = new Command(CommandAction.MoveTo);
                command22.targetRelativeXpos = num12;
                command22.targetRelativeYpos = num13;
                if (mission.targetBuiltObject === null) {
                    if (mission.targetHabitat !== null) command22.targetHabitat = mission.targetHabitat;
                    else {
                        if (mission.targetShipGroup === null) throw new MissionResolveError('Invalid patrol target');
                        command22.targetShipGroup = mission.targetShipGroup;
                    }
                } else {
                    command22.targetBuiltObject = mission.targetBuiltObject;
                }
                commandList1.push(command22);
                const command23 = new Command(CommandAction.MoveTo);
                command23.targetRelativeXpos = num14;
                command23.targetRelativeYpos = num15;
                if (mission.targetBuiltObject !== null) command23.targetBuiltObject = mission.targetBuiltObject;
                else if (mission.targetHabitat !== null) command23.targetHabitat = mission.targetHabitat;
                else if (mission.targetShipGroup !== null) command23.targetShipGroup = mission.targetShipGroup;
                commandList1.push(command23);
                const command24 = new Command(CommandAction.MoveTo);
                command24.targetRelativeXpos = num16;
                command24.targetRelativeYpos = num17;
                if (mission.targetBuiltObject !== null) command24.targetBuiltObject = mission.targetBuiltObject;
                else if (mission.targetHabitat !== null) command24.targetHabitat = mission.targetHabitat;
                else if (mission.targetShipGroup !== null) command24.targetShipGroup = mission.targetShipGroup;
                commandList1.push(command24);
                const num18 = galaxy.rnd.next(11, 14);
                for (let index = 0; index < num18; ++index) {
                    enqueue(commandList1[0]);
                    enqueue(commandList1[1]);
                    enqueue(commandList1[2]);
                }
                enqueue(new Command(CommandAction.ClearParent));
                enqueue(new Command(CommandAction.ReassignMission));
                return { commands: commandQueue, couldResolveCommands };
            }
            case BuiltObjectMissionType.Escort:
                // 683-689
                if (mission.targetHabitat !== null) throw new MissionResolveError('Invalid escort mission target type');
                enqueue(new Command(CommandAction.ClearParent));
                enqueue(command2.clone());
                enqueue(command11.clone());
                return { commands: commandQueue, couldResolveCommands };
            case BuiltObjectMissionType.Rescue:
                // 690-695
                enqueue(new Command(CommandAction.ClearParent));
                enqueue(command2.clone());
                enqueue(command12.clone());
                enqueue(command13.clone());
                return { commands: commandQueue, couldResolveCommands };
            case BuiltObjectMissionType.Blockade:
                // 696-702
                enqueue(new Command(CommandAction.ClearParent));
                enqueue(command2.clone());
                enqueue(command3.clone());
                enqueue(theThis.generateParkCommand());
                enqueue(command10.clone());
                return { commands: commandQueue, couldResolveCommands };
            case BuiltObjectMissionType.Attack: {
                // 703-723
                enqueue(new Command(CommandAction.ClearParent));
                let x2 = -1.0;
                let y2 = -1.0;
                if (mission.targetBuiltObject !== null) {
                    const targetBuiltObject = mission.targetBuiltObject;
                    const targetMission = targetBuiltObject.mission as BuiltObjectMission | null;
                    if (targetMission !== null && targetMission.checkCommandsForHyperjumpOrConditionalJump()) {
                        x2 = targetBuiltObject.xpos;
                        y2 = targetBuiltObject.ypos;
                    }
                }
                if (x2 >= 0.0 && y2 >= 0.0) enqueue(Command.at(CommandAction.ConditionalHyperTo, x2, y2));
                else enqueue(command2.clone());
                enqueue(command7.clone());
                enqueue(new Command(CommandAction.EvaluateThreats));
                enqueue(new Command(CommandAction.ReassignMission));
                return { commands: commandQueue, couldResolveCommands };
            }
            case BuiltObjectMissionType.Escape: {
                // 724-835
                if (ship!.dockedAt !== null) enqueue(new Command(CommandAction.Undock));
                let num19 = 0.0;
                let num20: number;
                const attackers = ship!.attackers as StellarObject[];
                if (attackers.length <= 0) {
                    if (mission.targetBuiltObject === null && mission.targetCreature === null) return { commands: commandQueue, couldResolveCommands };
                    let stellarObject: StellarObject | null = null;
                    if (mission.targetBuiltObject !== null) stellarObject = mission.targetBuiltObject;
                    if (mission.targetCreature !== null) stellarObject = mission.targetCreature;
                    if (stellarObject !== null) num19 = determineAngle(ship!.xpos, ship!.ypos, stellarObject.xpos, stellarObject.ypos);
                    num20 = num19 + Math.PI;
                } else {
                    for (let index = 0; index < attackers.length; ++index) {
                        num19 += determineAngle(ship!.xpos, ship!.ypos, attackers[index].xpos, attackers[index].ypos);
                    }
                    num20 = num19 / attackers.length + Math.PI;
                }
                enqueue(new Command(CommandAction.ClearParent));
                let flag1 = true;
                let num21 = ESCAPE_HYPER_DISTANCE;
                if (ship!.empire !== null && ship!.empire.research !== null) {
                    const latestComponent = ship!.empire.research.getLatestComponent(ComponentType.HyperDrive);
                    if ((latestComponent === null || latestComponent.value1 < 3000) && ship!.warpSpeed <= 3000) {
                        if (ship!.warpSpeed <= 0) {
                            num21 = 600.0;
                        } else {
                            num21 = 20000.0;
                            const nearestSpacePort = fastFindNearestSpacePort(galaxy, ship!.xpos, ship!.ypos, ship!.actualEmpire!);
                            if (nearestSpacePort !== null && (nearestSpacePort.attackers as unknown[]).length <= 0 && nearestSpacePort.nearestSystemStar === ship!.nearestSystemStar && galaxy.calculateDistance(nearestSpacePort.xpos, nearestSpacePort.ypos, ship!.xpos, ship!.ypos) > 3000.0) {
                                enqueue(cmd(CommandAction.ConditionalHyperTo, nearestSpacePort));
                                enqueue(cmd(CommandAction.SetParent, nearestSpacePort));
                                enqueue(theThis.generateParkCommand());
                                flag1 = false;
                            }
                        }
                    } else if (ship!.warpSpeed <= 0) {
                        num21 = 600.0;
                    }
                }
                if (flag1) {
                    const num22 = num21 * 0.75 + num21 * (galaxy.rnd.nextDouble() / 2.0);
                    let x3 = ship!.xpos + Math.cos(num20) * num22;
                    let y3 = ship!.ypos + Math.sin(num20) * num22;
                    const p3 = theThis.ensureCoordsInGalaxy(x3, y3);
                    x3 = p3.x;
                    y3 = p3.y;
                    if (num21 > 2000.0) enqueue(Command.at(CommandAction.HyperTo, x3, y3));
                    else enqueue(Command.at(CommandAction.SprintTo, x3, y3));
                    enqueue(new Command(CommandAction.ClearAttackers));
                    if (ship!.role === BuiltObjectRole.Freight || ship!.role === BuiltObjectRole.Colony) {
                        if (ship!.warpSpeed > 0) {
                            if (ship!.actualEmpire !== null) {
                                const colonyNotInSystem = fastFindNearestColonyNotInSystem(galaxy, Math.trunc(ship!.xpos), Math.trunc(ship!.ypos), ship!.actualEmpire, 0, ship!.nearestSystemStar);
                                if (colonyNotInSystem !== null) {
                                    const distance = galaxy.calculateDistance(colonyNotInSystem.xpos, colonyNotInSystem.ypos, ship!.xpos, ship!.ypos);
                                    if (distance <= galaxy.maxSolarSystemSize * 2.1 || distance >= galaxy.sectorSize * 3.0 || !withinFuelRange(galaxy, ship!, colonyNotInSystem.xpos, colonyNotInSystem.ypos, 0.0)) {
                                        return { commands: commandQueue, couldResolveCommands };
                                    }
                                    let num23 = 0;
                                    if (ship!.empire !== null && ship!.empire.systemVisibility !== null && ship!.empire.systemVisibility.length > colonyNotInSystem.systemIndex) {
                                        const systemVisibility = ship!.empire.systemVisibility[colonyNotInSystem.systemIndex];
                                        if (systemVisibility != null) {
                                            // SystemVisibility.Threats.CalculateAttackingFirepowerNearEmpireTargets(Empire) (M4n).
                                            num23 = calculateAttackingFirepowerNearEmpireTargets(galaxy, systemVisibility, ship!.empire);
                                        }
                                    }
                                    if (num23 <= 0) {
                                        enqueue(cmd(CommandAction.ConditionalHyperTo, colonyNotInSystem));
                                        enqueue(cmd(CommandAction.SetParent, colonyNotInSystem));
                                        enqueue(theThis.generateParkCommand());
                                    }
                                }
                                return { commands: commandQueue, couldResolveCommands };
                            }
                            if (ship!.empire === galaxy.independentEmpire) {
                                // (unreachable when Empire == IndependentEmpire: ActualEmpire is then non-null; kept as in C#)
                                const angle = galaxy.selectRandomHeading();
                                const distance = 2000000.0 + galaxy.rnd.nextDouble() * 2000000.0;
                                const p4 = obtainCoordinatesFromPoint(galaxy, angle, ship!.xpos, ship!.ypos, distance);
                                const nearestColony = galaxy.findNearestColony(p4.x, p4.y, null, true);
                                if (nearestColony !== null) {
                                    enqueue(cmd(CommandAction.ConditionalHyperTo, nearestColony));
                                    enqueue(cmd(CommandAction.SetParent, nearestColony));
                                    enqueue(theThis.generateParkCommand());
                                }
                            }
                        }
                        return { commands: commandQueue, couldResolveCommands };
                    }
                    enqueue(new Command(CommandAction.ReassignMission));
                }
                return { commands: commandQueue, couldResolveCommands };
            }
            case BuiltObjectMissionType.Retire:
                // 836-848
                if (ship!.role !== BuiltObjectRole.Base) {
                    enqueue(new Command(CommandAction.ClearParent));
                    enqueue(command2.clone());
                    enqueue(command3.clone());
                    enqueue(command4.clone());
                    enqueue(command5.clone());
                    enqueue(new Command(CommandAction.Scrap));
                    return { commands: commandQueue, couldResolveCommands };
                }
                enqueue(new Command(CommandAction.Scrap));
                return { commands: commandQueue, couldResolveCommands };
            case BuiltObjectMissionType.Retrofit:
                // 849-875
                if (mission.design === null && !specifiedAsFleetMission) {
                    couldResolveCommands = false;
                    commandQueue.length = 0;
                    return { commands: commandQueue, couldResolveCommands };
                } else {
                    if (ship!.role === BuiltObjectRole.Base) {
                        enqueue(new Command(CommandAction.Retrofit));
                        return { commands: commandQueue, couldResolveCommands };
                    }
                    enqueue(new Command(CommandAction.ClearParent));
                    enqueue(command2.clone());
                    enqueue(command3.clone());
                    enqueue(command4.clone());
                    enqueue(command5.clone());
                    enqueue(Command.withDesign(CommandAction.Retrofit, mission.design));
                    enqueue(command3.clone());
                    enqueue(theThis.generateParkCommand());
                    return { commands: commandQueue, couldResolveCommands };
                }
            case BuiltObjectMissionType.Colonize:
                // 876-883
                enqueue(new Command(CommandAction.ClearParent));
                enqueue(command2.clone());
                enqueue(command3.clone());
                enqueue(command4.clone());
                enqueue(command9.clone());
                enqueue(cmd(CommandAction.Colonize, mission.targetHabitat));
                return { commands: commandQueue, couldResolveCommands };
            case BuiltObjectMissionType.Waypoint:
                // 884-906
                enqueue(new Command(CommandAction.ClearParent));
                if (mission.targetBuiltObject === null && mission.targetHabitat === null && mission.targetShipGroup === null) {
                    if (mission.x > 0.0 && mission.y > 0.0) {
                        enqueue(Command.at(CommandAction.ConditionalHyperTo, mission.x, mission.y));
                    } else {
                        couldResolveCommands = false;
                        commandQueue.length = 0;
                        return { commands: commandQueue, couldResolveCommands };
                    }
                } else {
                    enqueue(command2.clone());
                }
                enqueue(command3.clone());
                enqueue(theThis.generateParkCommand());
                return { commands: commandQueue, couldResolveCommands };
            case BuiltObjectMissionType.Hold:
                // 907-909
                enqueue(Command.withStarDate(CommandAction.Hold, theThis.starDate));
                return { commands: commandQueue, couldResolveCommands };
            case BuiltObjectMissionType.WaitAndAttack:
            case BuiltObjectMissionType.WaitAndBombard:
                // 910-974
                enqueue(new Command(CommandAction.ClearParent));
                if (mission.secondaryTargetBuiltObject === null) {
                    if (mission.secondaryTargetHabitat !== null) {
                        enqueue(cmd(CommandAction.ConditionalHyperTo, mission.secondaryTargetHabitat));
                        enqueue(cmd(CommandAction.SetParent, mission.secondaryTargetHabitat));
                        enqueue(cmd(CommandAction.MoveTo, mission.secondaryTargetHabitat));
                        enqueue(cmd(CommandAction.Dock, mission.secondaryTargetHabitat));
                        enqueue(new Command(CommandAction.Refuel));
                        enqueue(cmd(CommandAction.Undock, mission.secondaryTargetHabitat));
                        enqueue(cmd(CommandAction.SetParent, mission.secondaryTargetHabitat));
                        enqueue(theThis.generateParkCommand());
                    } else if (mission.secondaryTargetCreature !== null) {
                        enqueue(cmd(CommandAction.ConditionalHyperTo, mission.secondaryTargetCreature));
                        enqueue(cmd(CommandAction.SetParent, mission.secondaryTargetCreature));
                    } else if (mission.secondaryTargetShipGroup !== null) {
                        enqueue(cmd(CommandAction.ConditionalHyperTo, mission.secondaryTargetShipGroup));
                        enqueue(cmd(CommandAction.SetParent, mission.secondaryTargetShipGroup));
                    } else {
                        enqueue(Command.at(CommandAction.ConditionalHyperTo, mission.x, mission.y));
                        const p5 = galaxy.selectRelativeParkingPoint(200.0);
                        enqueue(Command.at(CommandAction.MoveTo, mission.x + p5.x, mission.y + p5.y));
                    }
                } else {
                    enqueue(cmd(CommandAction.ConditionalHyperTo, mission.secondaryTargetBuiltObject));
                    enqueue(cmd(CommandAction.SetParent, mission.secondaryTargetBuiltObject));
                    if (mission.secondaryTargetBuiltObject.isRefuellingDepot) {
                        enqueue(cmd(CommandAction.MoveTo, mission.secondaryTargetBuiltObject));
                        enqueue(cmd(CommandAction.Dock, mission.secondaryTargetBuiltObject));
                        enqueue(new Command(CommandAction.Refuel));
                        enqueue(cmd(CommandAction.Undock, mission.secondaryTargetBuiltObject));
                        enqueue(cmd(CommandAction.SetParent, mission.secondaryTargetBuiltObject));
                    }
                    enqueue(theThis.generateParkCommand());
                }
                enqueue(Command.withStarDate(CommandAction.HoldSyncFleet, theThis.starDate));
                enqueue(new Command(CommandAction.ClearParent));
                if (mission.targetShipGroup !== null) {
                    const actualFleetLocation = determineActualFleetLocation(galaxy, mission.targetShipGroup);
                    enqueue(Command.at(CommandAction.ConditionalHyperTo, actualFleetLocation.x, actualFleetLocation.y));
                } else {
                    enqueue(command2.clone());
                }
                const waitType = mission.type as BuiltObjectMissionType;
                if (waitType === BuiltObjectMissionType.Attack || waitType === BuiltObjectMissionType.WaitAndAttack) enqueue(command7.clone());
                else if (waitType === BuiltObjectMissionType.Bombard || waitType === BuiltObjectMissionType.WaitAndBombard) enqueue(command1!.clone());
                enqueue(new Command(CommandAction.EvaluateThreats));
                enqueue(new Command(CommandAction.ReassignMission));
                break;
            case BuiltObjectMissionType.MoveAndWait:
                // 975-998
                if (mission.targetBuiltObject === null && mission.targetHabitat === null && mission.targetShipGroup === null && mission.targetCreature === null && mission.x < 0.0 && mission.y < 0.0) {
                    throw new MissionResolveError('Mission target cannot be null');
                }
                if (mission.x > 0.0 && mission.y > 0.0) {
                    enqueue(new Command(CommandAction.ClearParent));
                    enqueue(Command.at(CommandAction.ConditionalHyperTo, mission.x, mission.y));
                    enqueue(Command.at(CommandAction.MoveTo, mission.x, mission.y));
                    enqueue(Command.withStarDate(CommandAction.Hold, theThis.starDate));
                    return { commands: commandQueue, couldResolveCommands };
                }
                enqueue(new Command(CommandAction.ClearParent));
                enqueue(command2.clone());
                if (mission.targetBuiltObject !== null && mission.targetBuiltObject.role !== BuiltObjectRole.Base) {
                    enqueue(cmd(CommandAction.MoveTo, mission.targetBuiltObject));
                } else {
                    enqueue(command3.clone());
                    enqueue(theThis.generateParkCommand());
                }
                enqueue(Command.withStarDate(CommandAction.Hold, theThis.starDate));
                return { commands: commandQueue, couldResolveCommands };
            case BuiltObjectMissionType.Refuel:
                // 999-1009
                enqueue(new Command(CommandAction.ClearParent));
                enqueue(command2.clone());
                enqueue(command3.clone());
                enqueue(command4.clone());
                enqueue(command5.clone());
                enqueue(new Command(CommandAction.Refuel));
                enqueue(command6.clone());
                enqueue(command3.clone());
                enqueue(theThis.generateParkCommand());
                return { commands: commandQueue, couldResolveCommands };
            case BuiltObjectMissionType.ExtractResources: {
                // 1010-1063
                if (mission.targetHabitat !== null) {
                    enqueue(new Command(CommandAction.ClearParent));
                    enqueue(command2.clone());
                    enqueue(command3.clone());
                    enqueue(command4.clone());
                    enqueue(command9.clone());
                    enqueue(command8.clone());
                    enqueue(new Command(CommandAction.ClearParent));
                    let target: BuiltObject | null = null;
                    let num24 = 536870911.0;
                    if (ship !== null) {
                        const actualEmpire = ship.actualEmpire;
                        if (actualEmpire !== null && actualEmpire.spacePorts !== null) {
                            for (const spacePort of actualEmpire.spacePorts) {
                                if (spacePort != null && spacePort.isSpacePort) {
                                    const distance = galaxy.calculateDistance(spacePort.xpos, spacePort.ypos, point.x, point.y);
                                    if (distance < num24) {
                                        target = spacePort;
                                        num24 = distance;
                                    }
                                }
                            }
                        }
                    }
                    if (target === null) {
                        couldResolveCommands = false;
                        commandQueue.length = 0;
                        return { commands: commandQueue, couldResolveCommands };
                    } else {
                        enqueue(cmd(CommandAction.ConditionalHyperTo, target));
                        enqueue(cmd(CommandAction.SetParent, target));
                        enqueue(cmd(CommandAction.MoveTo, target));
                        enqueue(cmd(CommandAction.Dock, target));
                        enqueue(new Command(CommandAction.Unload));
                        enqueue(new Command(CommandAction.Refuel));
                        enqueue(cmd(CommandAction.Undock, target));
                        enqueue(cmd(CommandAction.SetParent, target));
                        enqueue(theThis.generateParkCommand());
                    }
                }
                return { commands: commandQueue, couldResolveCommands };
            }
            case BuiltObjectMissionType.LoadTroops:
                // 1064-1075
                enqueue(new Command(CommandAction.ClearParent));
                enqueue(command2.clone());
                enqueue(command3.clone());
                enqueue(command4.clone());
                enqueue(command5.clone());
                enqueue(Command.withTroops(CommandAction.Load, mission.troops));
                enqueue(new Command(CommandAction.Refuel));
                enqueue(command6.clone());
                enqueue(command3.clone());
                enqueue(theThis.generateParkCommand());
                return { commands: commandQueue, couldResolveCommands };
            case BuiltObjectMissionType.UnloadTroops:
                // 1076-1087
                enqueue(new Command(CommandAction.ClearParent));
                enqueue(command2.clone());
                enqueue(command3.clone());
                enqueue(command4.clone());
                enqueue(command5.clone());
                enqueue(Command.withTroops(CommandAction.Unload, mission.troops));
                enqueue(new Command(CommandAction.Refuel));
                enqueue(command6.clone());
                enqueue(command3.clone());
                enqueue(theThis.generateParkCommand());
                return { commands: commandQueue, couldResolveCommands };
            case BuiltObjectMissionType.Deploy: {
                // 1088-1100
                enqueue(new Command(CommandAction.ClearParent));
                enqueue(command2.clone());
                enqueue(command3.clone());
                const command25 = command4.clone();
                if (mission.x > -2000000000.0 && mission.y > -2000000000.0) {
                    command25.targetRelativeXpos = mission.x;
                    command25.targetRelativeYpos = mission.y;
                }
                enqueue(command25);
                enqueue(new Command(CommandAction.Deploy));
                return { commands: commandQueue, couldResolveCommands };
            }
            case BuiltObjectMissionType.Undeploy:
                // 1101-1103
                enqueue(new Command(CommandAction.Undeploy));
                return { commands: commandQueue, couldResolveCommands };
            case BuiltObjectMissionType.Repair:
                // 1104-1118
                if (ship!.role !== BuiltObjectRole.Base) {
                    enqueue(new Command(CommandAction.ClearParent));
                    enqueue(command2.clone());
                    enqueue(command3.clone());
                    enqueue(command4.clone());
                    enqueue(command5.clone());
                    enqueue(new Command(CommandAction.Repair));
                    enqueue(command3.clone());
                    enqueue(theThis.generateParkCommand());
                    return { commands: commandQueue, couldResolveCommands };
                }
                enqueue(new Command(CommandAction.Repair));
                return { commands: commandQueue, couldResolveCommands };
            case BuiltObjectMissionType.Move: {
                // 1119-1183
                if (mission.targetBuiltObject !== null || mission.targetHabitat !== null || mission.targetCreature !== null || mission.targetShipGroup !== null) {
                    enqueue(new Command(CommandAction.ClearParent));
                    if (mission.targetHabitat !== null && mission.targetHabitat.type === HabitatType.BlackHole) {
                        const targetHabitat2 = mission.targetHabitat;
                        if (mission.x > -2000000000.0 && mission.y > -2000000000.0) {
                            const x6 = targetHabitat2.xpos + mission.x;
                            const y6 = targetHabitat2.ypos + mission.y;
                            enqueue(Command.at(CommandAction.ConditionalHyperTo, x6, y6));
                            enqueue(Command.at(CommandAction.MoveTo, x6, y6));
                            return { commands: commandQueue, couldResolveCommands };
                        }
                        const num25 = galaxy.rnd.nextDouble() * Math.PI * 2.0;
                        const num26 = targetHabitat2.diameter * 0.7 + galaxy.rnd.nextDouble() * 500.0;
                        const x7 = targetHabitat2.xpos + num26 * Math.sin(num25);
                        const y7 = targetHabitat2.ypos + num26 * Math.cos(num25);
                        enqueue(Command.at(CommandAction.ConditionalHyperTo, x7, y7));
                        enqueue(Command.at(CommandAction.MoveTo, x7, y7));
                        return { commands: commandQueue, couldResolveCommands };
                    }
                    if (allowReprocessing && mission.targetHabitat !== null && mission.targetHabitat.category === HabitatCategoryType.Star) {
                        const targetHabitat3 = mission.targetHabitat;
                        if (mission.x > -2000000000.0 && mission.y > -2000000000.0) {
                            const x8 = targetHabitat3.xpos + mission.x;
                            const y8 = targetHabitat3.ypos + mission.y;
                            enqueue(Command.at(CommandAction.ConditionalHyperTo, x8, y8));
                            enqueue(Command.at(CommandAction.MoveTo, x8, y8));
                            return { commands: commandQueue, couldResolveCommands };
                        }
                        const num27 = galaxy.rnd.nextDouble() * Math.PI * 2.0;
                        let num28 = Math.trunc(targetHabitat3.diameter);
                        if (targetHabitat3.type === HabitatType.SuperNova) num28 = Math.trunc(Math.trunc(targetHabitat3.diameter) / 50);
                        const num29 = num28 * 0.63 + galaxy.rnd.nextDouble() * 300.0;
                        const x9 = targetHabitat3.xpos + num29 * Math.sin(num27);
                        const y9 = targetHabitat3.ypos + num29 * Math.cos(num27);
                        enqueue(Command.at(CommandAction.ConditionalHyperTo, x9, y9));
                        enqueue(Command.at(CommandAction.MoveTo, x9, y9));
                        return { commands: commandQueue, couldResolveCommands };
                    }
                    enqueue(command2.clone());
                    if (mission.targetBuiltObject !== null && mission.targetBuiltObject.role !== BuiltObjectRole.Base) {
                        enqueue(cmd(CommandAction.MoveTo, mission.targetBuiltObject));
                        return { commands: commandQueue, couldResolveCommands };
                    }
                    enqueue(command3.clone());
                    const command26 = command4.clone();
                    if (mission.x > -2000000000.0 && mission.y > -2000000000.0) {
                        command26.targetRelativeXpos = mission.x;
                        command26.targetRelativeYpos = mission.y;
                    }
                    enqueue(command26);
                    return { commands: commandQueue, couldResolveCommands };
                }
                enqueue(new Command(CommandAction.ClearParent));
                enqueue(Command.at(CommandAction.ConditionalHyperTo, point.x, point.y));
                enqueue(Command.at(CommandAction.MoveTo, point.x, point.y));
                return { commands: commandQueue, couldResolveCommands };
            }
            case BuiltObjectMissionType.Bombard:
                // 1184-1190 (command1 is null unless the target is a habitat → NullReferenceException → caught)
                enqueue(new Command(CommandAction.ClearParent));
                enqueue(command2.clone());
                if (command1 === null) throw new MissionResolveError('NullReferenceException: Bombard without a habitat target');
                enqueue(command1.clone());
                enqueue(new Command(CommandAction.EvaluateThreats));
                enqueue(new Command(CommandAction.ReassignMission));
                return { commands: commandQueue, couldResolveCommands };
            case BuiltObjectMissionType.Capture: {
                // 1191-1211
                enqueue(new Command(CommandAction.ClearParent));
                let x10 = -1.0;
                let y10 = -1.0;
                if (mission.targetBuiltObject !== null) {
                    const targetBuiltObject = mission.targetBuiltObject;
                    const targetMission = targetBuiltObject.mission as BuiltObjectMission | null;
                    if (targetMission !== null && targetMission.checkCommandsForHyperjumpOrConditionalJump()) {
                        x10 = targetBuiltObject.xpos;
                        y10 = targetBuiltObject.ypos;
                    }
                    if (x10 >= 0.0 && y10 >= 0.0) enqueue(Command.at(CommandAction.ConditionalHyperTo, x10, y10));
                    else enqueue(command2.clone());
                    enqueue(cmd(CommandAction.Capture, targetBuiltObject));
                    enqueue(new Command(CommandAction.EvaluateThreats));
                    enqueue(new Command(CommandAction.ReassignMission));
                }
                return { commands: commandQueue, couldResolveCommands };
            }
            case BuiltObjectMissionType.Reinforce:
                // 1212-1213
                return { commands: commandQueue, couldResolveCommands };
            case BuiltObjectMissionType.Raid: {
                // 1214-1234
                enqueue(new Command(CommandAction.ClearParent));
                let target1: StellarObject | null = null;
                if (mission.targetBuiltObject === null) {
                    if (mission.targetHabitat !== null && mission.targetHabitat.population != null && mission.targetHabitat.population.items.length > 0 && mission.targetHabitat.empire !== ship!.empire) {
                        target1 = mission.targetHabitat;
                    }
                } else if (mission.targetBuiltObject.role === BuiltObjectRole.Base && mission.targetBuiltObject.empire !== ship!.empire) {
                    target1 = mission.targetBuiltObject;
                }
                if (target1 !== null) {
                    enqueue(command2.clone());
                    if (isBuiltObject(target1)) enqueue(cmd(CommandAction.Raid, target1));
                    else if (isHabitat(target1)) enqueue(cmd(CommandAction.Raid, target1));
                    enqueue(new Command(CommandAction.EvaluateThreats));
                    enqueue(new Command(CommandAction.ReassignMission));
                }
                return { commands: commandQueue, couldResolveCommands };
            }
            default:
                return { commands: commandQueue, couldResolveCommands };
        }
    } catch (ex) {
        if (!(ex instanceof MissionResolveError)) throw ex;
        // 1239-1244: `if (myMain != null) myMain._Game.Galaxy.Pause(); return commandQueue;` (UI pause only).
        return { commands: commandQueue, couldResolveCommands };
    }
    return { commands: commandQueue, couldResolveCommands };
}

/**
 * BaconBuiltObjectMission.cs 17 LoadMoreCargo(mission, ship): for a Transport mission with a Cargo list, rebuilds the
 * command queue (via reflection on _Commands) so every cargo entry loads CargoCapacity / Count units. Only applies
 * with a BuiltObject or Habitat primary target (other targets throw inside the try → nothing changes).
 * Rnd: GenerateParkCommand (3 draws) at the end of a successful rebuild.
 */
export function loadMoreCargo(mission: BuiltObjectMission, ship: BuiltObject | null): void {
    if (mission.type !== BuiltObjectMissionType.Transport || mission.cargo === null) return;
    try {
        const commandQueue: Command[] = [];
        const point = mission.resolveTargetCoordinates(mission);
        let command1: Command | null = null;
        let command2: Command | null = null;
        let command3: Command | null = null;
        let command4: Command | null = null;
        let command5: Command | null = null;
        const cargo1 = mission.cargo;
        const count = mission.cargo.items.length;
        // `ship.CargoCapacity` — a null ship throws (NullReferenceException) → caught → no change.
        if (ship === null) throw new MissionResolveError('NullReferenceException: ship');
        const cargoCapacity = ship.cargoCapacity;
        if (mission.targetBuiltObject !== null) {
            command1 = cmd(CommandAction.ConditionalHyperTo, mission.targetBuiltObject);
            command2 = cmd(CommandAction.SetParent, mission.targetBuiltObject);
            command3 = cmd(CommandAction.MoveTo, mission.targetBuiltObject);
            command4 = cmd(CommandAction.Dock, mission.targetBuiltObject);
            command5 = cmd(CommandAction.Undock, mission.targetBuiltObject);
        } else if (mission.targetHabitat !== null) {
            command1 = cmd(CommandAction.ConditionalHyperTo, mission.targetHabitat);
            command2 = cmd(CommandAction.SetParent, mission.targetHabitat);
            command3 = cmd(CommandAction.MoveTo, mission.targetHabitat);
            command4 = cmd(CommandAction.Dock, mission.targetHabitat);
            command5 = cmd(CommandAction.Undock, mission.targetHabitat);
        }
        commandQueue.push(new Command(CommandAction.ClearParent));
        // command1.Clone() with command1 == null → NullReferenceException → caught → no change.
        if (command1 === null || command2 === null || command3 === null || command4 === null || command5 === null) throw new MissionResolveError('NullReferenceException: command1');
        commandQueue.push(command1.clone());
        commandQueue.push(command2.clone());
        commandQueue.push(command3.clone());
        commandQueue.push(command4.clone());
        commandQueue.push(new Command(CommandAction.Refuel));
        if (mission.cargo === null || mission.cargo.items.length <= 0) {
            if (mission.population !== null && mission.population.items.length > 0) commandQueue.push(Command.withPopulation(CommandAction.Load, clonePopulationList(mission.population)));
        } else {
            const st = mission.secondaryTargetBuiltObject;
            if (
                st === null ||
                (st !== null &&
                    st.subRole !== BuiltObjectSubRole.GasMiningStation &&
                    st.subRole !== BuiltObjectSubRole.MiningStation &&
                    st.subRole !== BuiltObjectSubRole.ConstructionShip &&
                    st.subRole !== BuiltObjectSubRole.DefensiveBase &&
                    st.subRole !== BuiltObjectSubRole.ResortBase &&
                    st.subRole !== BuiltObjectSubRole.EnergyResearchStation &&
                    st.subRole !== BuiltObjectSubRole.HighTechResearchStation &&
                    st.subRole !== BuiltObjectSubRole.WeaponsResearchStation &&
                    st.subRole !== BuiltObjectSubRole.MonitoringStation) // (C# repeats `!= GasMiningStation` here)
            ) {
                for (const cargo2 of cargo1.items) {
                    cargo2.amount = Math.trunc(cargoCapacity / count);
                }
            }
            commandQueue.push(Command.withCargo(CommandAction.Load, cloneCargoList(mission.cargo)));
        }
        commandQueue.push(command5.clone());
        if (mission.secondaryTargetHabitat !== null) {
            const secondaryTargetHabitat = mission.secondaryTargetHabitat;
            // Galaxy.CalculateDistanceStatic(...) — value unused.
            commandQueue.push(cmd(CommandAction.ConditionalHyperTo, secondaryTargetHabitat));
            commandQueue.push(cmd(CommandAction.SetParent, secondaryTargetHabitat));
            commandQueue.push(cmd(CommandAction.MoveTo, secondaryTargetHabitat));
            commandQueue.push(cmd(CommandAction.Dock, secondaryTargetHabitat));
            if (mission.cargo !== null && mission.cargo.items.length > 0) commandQueue.push(Command.withCargo(CommandAction.Unload, cloneCargoList(mission.cargo)));
            else if (mission.population !== null && mission.population.items.length > 0) commandQueue.push(Command.withPopulation(CommandAction.Unload, clonePopulationList(mission.population)));
            commandQueue.push(new Command(CommandAction.Refuel));
            commandQueue.push(cmd(CommandAction.Undock, secondaryTargetHabitat));
            commandQueue.push(cmd(CommandAction.SetParent, secondaryTargetHabitat));
        } else {
            if (mission.secondaryTargetBuiltObject === null) throw new MissionResolveError('Invalid mission target type');
            const target = mission.secondaryTargetBuiltObject;
            void point;
            commandQueue.push(cmd(CommandAction.ConditionalHyperTo, target));
            commandQueue.push(cmd(CommandAction.SetParent, target));
            commandQueue.push(cmd(CommandAction.MoveTo, target));
            commandQueue.push(cmd(CommandAction.Dock, target));
            if (mission.cargo !== null && mission.cargo.items.length > 0) commandQueue.push(Command.withCargo(CommandAction.Unload, cloneCargoList(mission.cargo)));
            else if (mission.population !== null && mission.population.items.length > 0) commandQueue.push(Command.withPopulation(CommandAction.Unload, clonePopulationList(mission.population)));
            commandQueue.push(new Command(CommandAction.Refuel));
            commandQueue.push(cmd(CommandAction.Undock, target));
            if (target.role === BuiltObjectRole.Base) commandQueue.push(cmd(CommandAction.SetParent, target));
        }
        commandQueue.push(mission.generateParkCommand());
        // FieldInfo "_Commands" SetValue → replace the queue.
        mission.replaceCommandStack(commandQueue);
    } catch (ex) {
        if (!(ex instanceof MissionResolveError)) throw ex;
        // 132-134: catch (Exception) {} — the mission keeps its resolved queue.
    }
}

/** BaconBuiltObjectMission.cs 137 LoadMoreCargoConstructionShip — empty in the mod. */
export function loadMoreCargoConstructionShip(mission: BuiltObjectMission, ship: BuiltObject | null): void {
    void mission;
    void ship;
}
