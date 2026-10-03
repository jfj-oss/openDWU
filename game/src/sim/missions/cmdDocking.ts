// M4e — ExecuteCommands cases Dock 2731 / Undock 3642 / Load 3232 / Unload 3698 / Refuel 4226 (BuiltObject.2.cs).
//
// Each export is one `case` of the C# switch with the `CommandHandler` signature from executeCommands.ts: it receives
// the shared locals (`CommandContext`: bo, mission, command, timePassed/time/starDate, targetX/targetY = num/num2,
// indexX/indexY = x/y) and returns the C# `result` (seconds left for the DoTasks loop; 0.0 when the case breaks
// without setting it).
// Also here: BuiltObject.2.cs 350 FinalizeContractsNotPresentAtLoad, and ContractList.cs 14/37
// GetContractForCargoWithRemaining{Pickup,Delivery} with their component branch (logistics/contracts.ts has the
// resource-only versions).
// Ported elsewhere: the Load `command.Troops` branch (3363-3540: troop loadout picks, TroopList.Sort, invading
// characters) is combat/troopsRuntime.ts cmdLoadTroops; ProcessTourists (4825, tourism income) is civilianAI.ts
// processTourists.
//
// Rnd: Dock's first execution draws Rnd.NextDouble() for the smuggler-detection roll (2811) when a pirate smuggler
// docks at a colony whose bases out-scan its jamming; Dock → CheckMissionStillValid (logistics/docking.ts, its draw is
// unreachable). Character events (SmugglingDetection 2819, SmugglingSuccess 3960) draw inside M4u.

import { recordSmuggleDelivery } from '../scenario/emergent/crisesCore';
import type { Galaxy } from '../galaxy';
import type { BuiltObject } from '../builtObject';
import type { Habitat } from '../types';
import type { Empire } from '../empire';
import type { Character } from '../characters';
import { CharacterEventType, CharacterSkillType, getHighestSkillLevel } from '../characters';
import { Cargo, CargoList, ResourceRef } from '../cargo';
import { Population } from '../population';
import { BuiltObjectRole } from '../data/designSpecifications';
import { BuiltObjectSubRole } from '../builtObjectTypes';
import { galaxyComponentCurrentPrices, galaxyResourceCurrentPrices } from '../design';
import { EmpireMessageType, sendMessageToEmpire } from '../messages';
import { gameText } from '../colonyTick';
import { doCharacterEventRuntime } from '../events';
import { performPrivateTransaction } from '../treasury';
import { PirateRelationType } from '../pirateRelations';
import { EmpireActivityType } from '../pirates/empireActivity';
import { PirateExpenseType, PirateIncomeType } from '../pirates/pirateEconomy';
import { MOVEMENT_IMPULSE_SPEED, doMovement } from '../movement';
import { applyCorruptionToIncome, cargoEmpireId, cargoGetCargoById, cargoIndexOfById } from '../logistics/orders';
import { builtObjectContracts, type Contract } from '../logistics/contracts';
import { checkClearDocking, checkMissionStillValid, dockingBayIndexOfShip, removeFirst } from '../logistics/docking';
import { REFUEL_RATE, checkCancelRefuelData, checkForNegativeRefueling, getCargoIndex, purchasePrivateFuel, purchaseStateFuel } from '../logistics/refuel';
import { cmdLoadTroops } from '../combat/troopsRuntime';
import { processTourists } from '../civilianAI';
import { checkCancelContracts, clearPreviousMissionRequirements, assignMission } from './assign';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, CommandAction, isBuiltObject, isHabitat } from './mission';
import type { CommandHandler } from './executeCommands';
import { refugeeConvoySkipLoad, settleRefugeeConvoyArrival } from '../scenario/emergent/demographics';

const f = Math.fround;

/** Galaxy.3.cs 4985 UndockRange = 30. */
export const UNDOCK_RANGE = 30;

type Dock = BuiltObject | Habitat;

/** StellarObject.CargoSpace (Habitat.cs 293: 536870911). */
function dockCargoSpace(o: Dock): number {
    return isHabitat(o) ? 536870911 : o.cargoSpace;
}

/** StellarObject.TroopCapacityRemaining (Habitat.cs 295: 536870911). */
function dockTroopCapacityRemaining(o: Dock): number {
    return isHabitat(o) ? 536870911 : o.troopCapacityRemaining;
}

/** StellarObject.Characters. */
function characterList(o: BuiltObject): Character[] | null {
    return o.characters as Character[] | null;
}

/** CargoList.GetCargo(Component, int empireId) (CargoList.cs 771): -1 empire ids never match. */
function cargoGetCargoComponentById(list: CargoList, componentId: number, empireId: number): Cargo | null {
    if (empireId < 0) return null;
    for (let i = 0; i < list.items.length; i++) {
        const c = list.items[i];
        const cc = c.commodityComponent;
        if (cc !== null && cc.componentId === componentId && cargoEmpireId(c) === empireId) return c;
    }
    return null;
}

/** CargoList.GetCargo(cargo.CommodityResource | cargo.CommodityComponent, empireId) as the Load / Unload cases do. */
function cargoGetMatching(list: CargoList, cargo: Cargo, empireId: number): Cargo | null {
    if (cargo.commodityComponent === null) return cargoGetCargoById(list, cargo.commodity.resourceId, empireId);
    return cargoGetCargoComponentById(list, cargo.commodityComponent.componentId, empireId);
}

/** CargoList.Remove(Cargo) (CargoList.cs 227): located through IndexOf(resource | component, cargo.EmpireId) first. */
function cargoListRemove(list: CargoList, cargo: Cargo): void {
    const empireId = cargoEmpireId(cargo);
    const found = cargo.commodityComponent === null ? cargoIndexOfById(list, cargo.commodity.resourceId, empireId) >= 0 : cargoGetCargoComponentById(list, cargo.commodityComponent.componentId, empireId) !== null;
    if (!found) return;
    list.remove(cargo);
}

/** `new Cargo(cargo.CommodityResource | cargo.CommodityComponent, amount, cargo.EmpireId)`. */
function newCargoLike(cargo: Cargo, amount: number): Cargo {
    if (cargo.commodityComponent === null) return new Cargo(new ResourceRef(cargo.commodity.resourceId), amount, cargo.empire);
    return Cargo.ofComponent(cargo.commodityComponent, amount, cargo.empire);
}

/** ContractList.cs 14 GetContractForCargoWithRemainingPickup(cargo). */
function getContractForCargoWithRemainingPickup(contracts: readonly (Contract | null)[], cargo: Cargo | null): Contract | null {
    if (cargo !== null) {
        const empireId = cargoEmpireId(cargo);
        for (let index = 0; index < contracts.length; ++index) {
            const c = contracts[index];
            if (c != null && c.buyerEmpireId === empireId && c.amountToFulfill - c.amountPickedUp > 0) {
                if (cargo.commodityIsResource) {
                    if (c.resourceId === cargo.commodity.resourceId) return c;
                } else if (cargo.commodityIsComponent && c.componentId === cargo.commodityComponent!.componentId) {
                    return c;
                }
            }
        }
    }
    return null;
}

/** ContractList.cs 37 GetContractForCargoWithRemainingDelivery(cargo). */
function getContractForCargoWithRemainingDelivery(contracts: readonly (Contract | null)[], cargo: Cargo | null): Contract | null {
    if (cargo !== null) {
        const empireId = cargoEmpireId(cargo);
        for (let index = 0; index < contracts.length; ++index) {
            const c = contracts[index];
            if (c != null && c.buyerEmpireId === empireId && c.amountToFulfill - c.amountDelivered > 0) {
                if (cargo.commodityIsResource) {
                    if (c.resourceId === cargo.commodity.resourceId) return c;
                } else if (cargo.commodityIsComponent && c.componentId === cargo.commodityComponent!.componentId) {
                    return c;
                }
            }
        }
    }
    return null;
}

/** BuiltObject.2.cs 350 FinalizeContractsNotPresentAtLoad(dockedAt). */
export function finalizeContractsNotPresentAtLoad(bo: BuiltObject, dockedAt: Dock | null): void {
    const contractsToFulfill = builtObjectContracts(bo);
    if (dockedAt !== null && dockedAt.cargo !== null && contractsToFulfill !== null) {
        for (let i = 0; i < contractsToFulfill.length; i++) {
            const contract = contractsToFulfill[i];
            if (contract == null) {
                continue;
            }
            const num = contract.amountToFulfill - contract.amountPickedUp;
            if (num <= 0) {
                continue;
            }
            if (contract.resourceId >= 0) {
                const cargo = cargoGetCargoById(dockedAt.cargo, contract.resourceId & 0xff, contract.buyerEmpireId);
                if (cargo !== null) {
                    cargo.reserved -= num;
                }
            } else if (contract.componentId >= 0) {
                const cargo2 = cargoGetCargoComponentById(dockedAt.cargo, contract.componentId, contract.buyerEmpireId);
                if (cargo2 !== null) {
                    cargo2.reserved -= num;
                }
            }
            contract.amountToFulfill -= num;
            contract.amountPickedUp = contract.amountToFulfill;
        }
    }
    if (bo.subRole === BuiltObjectSubRole.ConstructionShip && bo.contractsToFulfill !== null) {
        bo.contractsToFulfill.length = 0;
    }
}

/** EmpireList.GetByEmpireId (Galaxy.PirateEmpires): the first empire with that id. */
export function pirateEmpireById(galaxy: Galaxy, empireId: number): Empire | null {
    for (let i = 0; i < galaxy.pirateEmpires.length; i++) {
        const e = galaxy.pirateEmpires[i];
        if (e != null && e.empireId === empireId) return e;
    }
    return null;
}

/** Empire.ColonyIncomeFactor (Empire.cs 425; SetEmpireDifficultyFactors) and SmugglingIncomeFactor (Empire.cs 428, 1.0). */
export function colonyIncomeFactor(empire: Empire): number {
    return empire.difficultyFactors?.colonyIncomeFactor ?? 1.0;
}
export function smugglingIncomeFactor(empire: Empire): number {
    return empire.pirateFactionModifiers !== null ? empire.pirateFactionModifiers.smugglingIncomeFactor : 1.0;
}

/** Galaxy.cs 1775 CalculateCurrentCargoValue(cargo, amount). */
function calculateCurrentCargoValue(galaxy: Galaxy, cargo: Cargo, amount: number): number {
    let num = 0.0;
    if (cargo.commodityComponent === null) {
        num = galaxyResourceCurrentPrices(galaxy)[cargo.commodity.resourceId];
    } else {
        num = galaxyComponentCurrentPrices(galaxy)[cargo.commodityComponent.componentId];
    }
    return num * amount;
}


/** BuiltObject.2.cs 2731 case Dock. */
export const cmdDock: CommandHandler = (ctx) => {
    const { galaxy, bo, mission, command, timePassed, time } = ctx;
    let result = 0.0;
    if (!checkMissionStillValid(galaxy, bo, time)) {
        return result;
    }
    let dockingBayList = null;
    let builtObjectList3: BuiltObject[] | null = null;
    let stellarObject2: Dock | null = null;
    let flag17 = false;
    let num43 = 0;
    if (command.targetBuiltObject !== null) {
        stellarObject2 = command.targetBuiltObject;
        dockingBayList = stellarObject2.dockingBays;
        builtObjectList3 = stellarObject2.dockingBayWaitQueue;
        num43 = command.targetBuiltObject.sensorTraceScannerPower;
    } else {
        if (command.targetHabitat === null) {
            throw new Error('Docking target type is invalid');
        }
        stellarObject2 = command.targetHabitat;
        dockingBayList = stellarObject2.dockingBays;
        builtObjectList3 = stellarObject2.dockingBayWaitQueue;
        const basesAtHabitat = command.targetHabitat.basesAtHabitat;
        if (basesAtHabitat !== null) {
            for (let m = 0; m < basesAtHabitat.length; m++) {
                const builtObject5 = basesAtHabitat[m];
                if (builtObject5 != null && !builtObject5.hasBeenDestroyed && builtObject5.empire === command.targetHabitat.empire && builtObject5.sensorTraceScannerPower > num43) {
                    num43 = builtObject5.sensorTraceScannerPower;
                    flag17 = true;
                }
            }
        }
    }
    if (bo.firstExecutionOfCommand) {
        if (dockingBayList === null || builtObjectList3 === null) {
            mission.completeCommand(true);
            bo.firstExecutionOfCommand = true;
            result = timePassed;
            return result;
        }
        if (bo.dockedAt !== null) {
            mission.completeCommand(true);
            bo.firstExecutionOfCommand = true;
            result = timePassed;
            return result;
        }
        if (command.targetBuiltObject !== null) {
            bo.parentHabitat = null;
            bo.parentBuiltObject = command.targetBuiltObject;
            bo.parentOffsetX = bo.xpos - bo.parentBuiltObject.xpos;
            bo.parentOffsetY = bo.ypos - bo.parentBuiltObject.ypos;
        } else if (command.targetHabitat !== null) {
            bo.parentBuiltObject = null;
            bo.parentHabitat = command.targetHabitat;
            bo.parentOffsetX = bo.xpos - bo.parentHabitat.xpos;
            bo.parentOffsetY = bo.ypos - bo.parentHabitat.ypos;
        }
        bo.preferredSpeed = 0;
        bo.lastDockDistance = 536870911.0;
        const soEmpire = stellarObject2 !== null ? stellarObject2.empire : null;
        if (bo.pirateEmpireId > 0 && bo.owner === null && stellarObject2 !== null && soEmpire !== null && soEmpire.pirateEmpireBaseHabitat === null && soEmpire !== galaxy.independentEmpire && flag17 && soEmpire.pirateRelations !== null) {
            const relationByOtherEmpireId = soEmpire.pirateRelations.getRelationByOtherEmpireId(bo.pirateEmpireId);
            const characters = characterList(bo);
            if (relationByOtherEmpireId !== null && relationByOtherEmpireId.type === PirateRelationType.None && num43 >= bo.sensorTraceScannerJamming && characters !== null) {
                let flag18 = false;
                const actualEmpire = bo.actualEmpire;
                if (bo.role === BuiltObjectRole.Freight && actualEmpire !== null && actualEmpire.pirateMissions !== null && actualEmpire.pirateMissions.containsEquivalentTarget(stellarObject2, EmpireActivityType.Smuggle)) {
                    flag18 = true;
                }
                if (!flag18) {
                    let num44 = 0.2;
                    const d = 0.01 * getHighestSkillLevel(characters, CharacterSkillType.SmugglingEvasion);
                    num44 -= num44 * Math.sqrt(d);
                    num44 = Math.max(0.01, num44);
                    if (galaxy.rnd.nextDouble() < num44) {
                        const otherEmpire = relationByOtherEmpireId.otherEmpire!;
                        bo.empire = otherEmpire;
                        const description = gameText('Pirate Smuggler Detected Ours', bo.name, soEmpire.name, stellarObject2.name);
                        sendMessageToEmpire(otherEmpire, otherEmpire, EmpireMessageType.PirateSmugglerDetected, bo, description);
                        const description2 = gameText('Pirate Smuggler Detected Other', bo.name, otherEmpire.name, stellarObject2.name);
                        sendMessageToEmpire(soEmpire, soEmpire, EmpireMessageType.PirateSmugglerDetected, bo, description2);
                        doCharacterEventRuntime(galaxy, CharacterEventType.SmugglingDetection, stellarObject2, characters, false, null);
                        clearPreviousMissionRequirements(galaxy, bo);
                        assignMission(galaxy, bo, BuiltObjectMissionType.Escape, stellarObject2, null, BuiltObjectMissionPriority.High);
                        result = timePassed;
                        return result;
                    }
                }
            }
        }
        bo.firstExecutionOfCommand = false;
    }
    if ((dockingBayList === null || dockingBayList.length <= 0) && stellarObject2 !== null && isBuiltObject(stellarObject2)) {
        const builtObject6 = stellarObject2;
        const ph = builtObject6.parentHabitat;
        if (ph !== null && ph.population !== null && ph.population.totalAmount > 0 && ph.empire !== null) {
            checkClearDocking(galaxy, bo, true);
            stellarObject2 = ph;
            dockingBayList = stellarObject2.dockingBays;
            builtObjectList3 = stellarObject2.dockingBayWaitQueue;
            bo.parentHabitat = ph;
            bo.parentBuiltObject = null;
            bo.parentOffsetX = bo.xpos - bo.parentHabitat.xpos;
            bo.parentOffsetY = bo.ypos - bo.parentHabitat.ypos;
            bo.preferredSpeed = 0;
            bo.lastDockDistance = 536870911.0;
        }
    }
    if (bo.dockedAt === null) {
        bo.preferredSpeed = 0;
        // (a null wait queue / bay list here throws in the C#, as below)
        if (builtObjectList3!.indexOf(bo) < 0) {
            builtObjectList3!.push(bo);
        }
        for (let n = 0; n < dockingBayList!.length; n++) {
            if (dockingBayList![n].dockedShip === null) {
                if (builtObjectList3!.length <= 0) {
                    dockingBayList![n].dockedShip = bo;
                    bo.dockedAt = stellarObject2;
                    bo.preferredSpeed = bo.cruiseSpeed;
                    break;
                }
                if (builtObjectList3![0] === bo) {
                    dockingBayList![n].dockedShip = bo;
                    bo.dockedAt = stellarObject2;
                    removeFirst(builtObjectList3!, bo);
                    bo.preferredSpeed = bo.cruiseSpeed;
                    break;
                }
            }
        }
        return result;
    }
    let num45 = -1.0;
    let num46 = -1.0;
    if (command.targetBuiltObject !== null) {
        const targetBuiltObject7 = command.targetBuiltObject;
        num45 = targetBuiltObject7.xpos;
        num46 = targetBuiltObject7.ypos;
    } else if (command.targetHabitat !== null) {
        const targetHabitat7 = command.targetHabitat;
        num45 = targetHabitat7.xpos;
        num46 = targetHabitat7.ypos;
    }
    const cruise1 = Math.max(1, bo.cruiseSpeed);
    const num47 = (cruise1 / bo.accelerationRate) * (cruise1 * 0.5) + bo.currentSpeed;
    const num48 = galaxy.calculateDistance(num45, num46, bo.xpos, bo.ypos);
    if (num48 < num47) {
        bo.preferredSpeed = f(Math.max(MOVEMENT_IMPULSE_SPEED, Math.trunc(bo.cruiseSpeed * (num48 / num47) - MOVEMENT_IMPULSE_SPEED)));
    } else {
        bo.preferredSpeed = bo.cruiseSpeed;
    }
    const out = { arrived: false };
    if (bo.dockedAt === null) {
        doMovement(galaxy, bo, timePassed, num45, num46, ctx.indexX, ctx.indexY, command.targetRelativeXpos, command.targetRelativeYpos, false, true, true, out);
    } else {
        doMovement(galaxy, bo, timePassed, num45, num46, ctx.indexX, ctx.indexY, command.targetRelativeXpos, command.targetRelativeYpos, true, true, true, out);
    }
    const num49 = galaxy.calculateDistance(num45, num46, bo.xpos, bo.ypos);
    if (out.arrived) {
        result = !(bo.lastDockDistance < num49) || !(bo.currentSpeed > 0) ? 0.0 : (num49 - bo.lastDockDistance) / bo.currentSpeed;
        bo.preferredSpeed = 0;
        bo.currentSpeed = 0;
    }
    bo.lastDockDistance = num48;
    return result;
};

/** BuiltObject.2.cs 3642 case Undock. */
export const cmdUndock: CommandHandler = (ctx) => {
    const { galaxy, bo, mission, timePassed } = ctx;
    let command = ctx.command;
    let result = 0.0;
    if (bo.dockedAt === null) {
        mission.completeCommand(true);
        bo.firstExecutionOfCommand = true;
        result = timePassed;
        return result;
    }
    if (bo.firstExecutionOfCommand) {
        const dockedAt = bo.dockedAt;
        if (isBuiltObject(dockedAt)) {
            bo.parentBuiltObject = dockedAt;
        } else if (isHabitat(dockedAt)) {
            bo.parentHabitat = dockedAt;
        }
        bo.parentOffsetX = bo.xpos - dockedAt.xpos;
        bo.parentOffsetY = bo.ypos - dockedAt.ypos;
        command.targetRelativeXpos = f(Math.cos(bo.heading) * UNDOCK_RANGE);
        command.targetRelativeYpos = f(Math.sin(bo.heading) * UNDOCK_RANGE);
        bo.currentSpeed = MOVEMENT_IMPULSE_SPEED;
        bo.preferredSpeed = MOVEMENT_IMPULSE_SPEED;
        bo.firstExecutionOfCommand = false;
    }
    doMovement(galaxy, bo, timePassed, ctx.targetX, ctx.targetY, ctx.indexX, ctx.indexY, command.targetRelativeXpos, command.targetRelativeYpos, false, true, true);
    const num58 = galaxy.calculateDistance(bo.dockedAt.xpos, bo.dockedAt.ypos, bo.xpos, bo.ypos);
    if (num58 >= UNDOCK_RANGE) {
        let num59 = -1;
        if (bo.dockedAt.dockingBays !== null) {
            num59 = dockingBayIndexOfShip(bo.dockedAt.dockingBays, bo);
        }
        if (num59 >= 0) {
            bo.dockedAt.dockingBays![num59].dockedShip = null;
        }
        bo.dockedAt = null;
        command = mission.showNextCommand()!;
        if (command !== null && (command.action === CommandAction.MoveTo || command.action === CommandAction.SprintTo || command.action === CommandAction.HyperTo)) {
            bo.preferredSpeed = bo.cruiseSpeed;
        }
        bo.parentBuiltObject = null;
        bo.parentHabitat = null;
        bo.parentOffsetX = -2000000001.0;
        bo.parentOffsetY = -2000000001.0;
        mission.completeCommand();
        result = !(bo.currentSpeed > 0) ? 0.0 : (num58 - UNDOCK_RANGE) / bo.currentSpeed;
        bo.firstExecutionOfCommand = true;
    }
    return result;
};

/** BuiltObject.2.cs 3232 case Load. */
export const cmdLoad: CommandHandler = (ctx) => {
    const { galaxy, bo, mission, command, timePassed } = ctx;
    let result = 0.0;
    // mod layer (19d4 §2.5): a refugee convoy is pre-loaded (its population already left the origin when its flow
    // spawned) — skip the pickup leg instead of wiping and re-pulling it from the origin's live colony population.
    if (galaxy.scenario !== null && refugeeConvoySkipLoad(galaxy, bo)) {
        mission.completeCommand();
        bo.firstExecutionOfCommand = true;
        return timePassed;
    }
    const dockedAt = bo.dockedAt;
    if (dockedAt === null) {
        checkCancelContracts(galaxy, bo);
        mission.completeCommand(true);
        bo.firstExecutionOfCommand = true;
        result = timePassed;
        return result;
    }
    if (bo.firstExecutionOfCommand) {
        bo.firstExecutionOfCommand = false;
    }
    const commodities = command.commodities;
    const troops = command.troops;
    const population = command.population;
    if (commodities !== null && commodities.items.length > 0) {
        const cargo6 = commodities.items[0];
        let cargo7: Cargo | null = null;
        let contractForCargoWithRemainingPickup = getContractForCargoWithRemainingPickup(builtObjectContracts(bo), cargo6);
        if (dockedAt.cargo !== null) {
            // 3249-3264: GetCargo(CommodityResource | CommodityComponent, cargo6.EmpireId).
            cargo7 = cargoGetMatching(dockedAt.cargo, cargo6, cargoEmpireId(cargo6));
        }
        if (cargo7 !== null) {
            if (cargo7.amount < 0 || cargo7.amount > 1073741823) {
                cargo7.amount = 0;
            }
            if (cargo6.amount < 0 || cargo6.amount > 1073741823) {
                cargoListRemove(commodities, cargo6);
                result = timePassed;
                return result;
            }
            let num50 = -1;
            if (dockedAt.dockingBays !== null) {
                num50 = dockingBayIndexOfShip(dockedAt.dockingBays, bo);
            }
            if (num50 >= 0) {
                const capacity2 = dockedAt.dockingBays![num50]._capacity;
                let num51 = Math.trunc(capacity2 * timePassed);
                if (num51 < 1) {
                    num51 = 1;
                }
                if (num51 > cargo7.amount) {
                    num51 = cargo7.amount;
                }
                if (num51 > cargo6.amount) {
                    num51 = cargo6.amount;
                }
                if (num51 > bo.cargoSpace) {
                    num51 = bo.cargoSpace;
                    cargo6.amount = 0;
                }
                num51 = Math.max(0, Math.min(num51, cargo6.amount));
                cargo6.amount -= num51;
                if (num51 <= 0 && cargo7.amount <= 0) {
                    num51 = 0;
                    cargo7.amount = 0;
                    cargo6.amount = 0;
                }
                if (contractForCargoWithRemainingPickup !== null) {
                    const num52 = contractForCargoWithRemainingPickup.amountToFulfill - contractForCargoWithRemainingPickup.amountPickedUp;
                    const num53 = Math.min(num52, num51);
                    contractForCargoWithRemainingPickup.amountPickedUp += num53;
                    if (num51 > num52) {
                        contractForCargoWithRemainingPickup = getContractForCargoWithRemainingPickup(builtObjectContracts(bo), cargo6);
                        if (contractForCargoWithRemainingPickup !== null) {
                            contractForCargoWithRemainingPickup.amountPickedUp += num51 - num52;
                        }
                    }
                    cargo7.reserved -= num51;
                    cargo7.reserved = Math.max(0, cargo7.reserved);
                }
                cargo7.amount -= num51;
                if (cargo7.amount <= 0 && cargo7.reserved <= 0) {
                    cargoListRemove(dockedAt.cargo!, cargo7);
                }
                if (cargo6.amount <= 0) {
                    cargo6.amount = 0;
                    cargoListRemove(commodities, cargo6);
                }
                // 3334-3351: new Cargo(CommodityResource | CommodityComponent, num51, cargo6.EmpireId) into our Cargo.
                const cargo8 = newCargoLike(cargo6, num51);
                if (bo.cargo !== null) {
                    bo.cargo.add(cargo8);
                }
                result = Math.max(0.0, (capacity2 * timePassed - num51) / capacity2);
            } else {
                finalizeContractsNotPresentAtLoad(bo, dockedAt);
                mission.completeCommand(true);
                bo.firstExecutionOfCommand = true;
                result = timePassed;
            }
        } else {
            cargoListRemove(commodities, cargo6);
            result = timePassed;
        }
    } else if (troops !== null && troops.count > 0) {
        // 3363-3540: the troop-loading branch (docked-bay check, loadout picks, invading characters).
        result = cmdLoadTroops(ctx);
    } else if (population !== null && population.items.length > 0) {
        let num57 = -1;
        if (dockedAt.dockingBays !== null) {
            num57 = dockingBayIndexOfShip(dockedAt.dockingBays, bo);
        }
        if (num57 < 0) {
            return result;
        }
        if (bo.population !== null) {
            bo.population.items.length = 0;
            bo.population.recalculateTotalAmount();
        }
        if (bo.populationCapacityRemaining - population.totalAmount >= 0) {
            for (const item6 of population.items) {
                const dockPopulation = dockedAt.population;
                if (dockPopulation !== null && dockPopulation.items.length > 0 && bo.population !== null) {
                    if (dockPopulation.totalAmount > 30000000 + item6.amount) {
                        const byRace = populationByRace(dockPopulation.items, item6);
                        if (byRace !== null && byRace.amount >= item6.amount) {
                            bo.population.add(new Population(item6.race, item6.amount));
                            populationByRace(dockPopulation.items, item6)!.amount -= item6.amount;
                            dockPopulation.recalculateTotalAmount();
                        }
                        continue;
                    }
                    population.items.length = 0;
                    mission.completeCommand();
                    bo.firstExecutionOfCommand = true;
                    result = timePassed;
                    break;
                }
                population.items.length = 0;
                mission.completeCommand();
                bo.firstExecutionOfCommand = true;
                result = timePassed;
                break;
            }
            // (after a `break` above the C# falls through here too: the command is completed a second time)
            if (bo.population !== null) {
                bo.population.recalculateTotalAmount();
            }
            population.items.length = 0;
            mission.completeCommand();
            bo.firstExecutionOfCommand = true;
            result = timePassed;
        } else {
            mission.completeCommand();
            bo.firstExecutionOfCommand = true;
            result = timePassed;
        }
    } else {
        finalizeContractsNotPresentAtLoad(bo, dockedAt);
        mission.completeCommand();
        bo.firstExecutionOfCommand = true;
        result = timePassed;
    }
    return result;
};

/** PopulationList[Race] (PopulationList.cs 25): the first population of that race. */
function populationByRace(items: readonly Population[], like: Population): Population | null {
    for (let index = 0; index < items.length; index++) {
        if (items[index].race === like.race) return items[index];
    }
    return null;
}

/** BuiltObject.2.cs 3698 case Unload. */
export const cmdUnload: CommandHandler = (ctx) => {
    const { galaxy, bo, mission, command, timePassed, starDate } = ctx;
    let result = 0.0;
    const dockedAt = bo.dockedAt;
    if (dockedAt === null) {
        checkCancelContracts(galaxy, bo);
        mission.completeCommand(true);
        bo.firstExecutionOfCommand = true;
        result = timePassed;
        return result;
    }
    if (dockCargoSpace(dockedAt) <= 0 && command.commodities !== null && command.commodities.items.length > 0) {
        checkCancelContracts(galaxy, bo);
        if (bo.role === BuiltObjectRole.Freight && bo.cargo !== null && bo.cargo.items.length > 0) {
            bo.cargo.clear();
        }
        mission.completeCommand(true);
        bo.firstExecutionOfCommand = true;
        result = timePassed;
        return result;
    }
    if (bo.firstExecutionOfCommand) {
        if (mission.type === BuiltObjectMissionType.ExtractResources && bo.cargo !== null) {
            if (command.commodities === null) {
                command.commodities = new CargoList();
            }
            // 3727-3730: the ship's own Cargo objects are added (CargoList.Add merges same empire + commodity).
            for (const item7 of bo.cargo.items.slice()) {
                command.commodities.add(item7);
            }
        }
        bo.firstExecutionOfCommand = false;
    }
    const commodities = command.commodities;
    if (commodities !== null && commodities.items.length > 0) {
        const cargo = commodities.items[0];
        let cargo2: Cargo | null = null;
        const contractForCargoWithRemainingDelivery = getContractForCargoWithRemainingDelivery(builtObjectContracts(bo), cargo);
        if (bo.cargo !== null) {
            // 3738-3753: GetCargo(CommodityResource | CommodityComponent, cargo.EmpireId).
            cargo2 = cargoGetMatching(bo.cargo, cargo, cargoEmpireId(cargo));
        }
        if (cargo2 !== null) {
            if (cargo2.amount < 0 || cargo2.amount > 1073741823) {
                cargo2.amount = 0;
            }
            if (cargo.amount < 0 || cargo.amount > 1073741823) {
                cargoListRemove(commodities, cargo);
                result = timePassed;
                if (bo.role === BuiltObjectRole.Freight && cargo2 !== null && cargo2.amount > 0) {
                    cargo2.amount = 0;
                    cargoListRemove(bo.cargo!, cargo2);
                }
                return result;
            }
            let num12 = -1;
            if (dockedAt.dockingBays !== null) {
                num12 = dockingBayIndexOfShip(dockedAt.dockingBays, bo);
            }
            if (num12 >= 0) {
                const capacity = dockedAt.dockingBays![num12]._capacity;
                let num13 = Math.trunc(capacity * timePassed);
                if (num13 < 1) {
                    num13 = 1;
                }
                if (num13 > cargo2.amount) {
                    num13 = cargo2.amount;
                }
                if (num13 > cargo.amount) {
                    num13 = cargo.amount;
                }
                if (num13 > dockCargoSpace(dockedAt)) {
                    num13 = dockCargoSpace(dockedAt);
                    cargo.amount = 0;
                }
                cargo.amount -= num13;
                if (contractForCargoWithRemainingDelivery !== null) {
                    contractForCargoWithRemainingDelivery.amountDelivered += num13;
                }
                if (cargo.amount <= 0) {
                    cargoListRemove(commodities, cargo);
                    if (bo.role === BuiltObjectRole.Freight && cargo2 !== null) {
                        cargo2.amount = 0;
                    }
                }
                // 3794-3809: new Cargo(CommodityResource | CommodityComponent, num13, cargo.EmpireId) into the dock's Cargo.
                const cargo3 = newCargoLike(cargo, num13);
                if (dockedAt.cargo !== null) {
                    dockedAt.cargo.add(cargo3);
                }
                cargo2.amount -= num13;
                let stellarObject: Dock = dockedAt;
                // StellarObject.ParentHabitat: never assigned on a Habitat in the C# (null), so only a base redirects.
                const dockParentHabitat = isBuiltObject(dockedAt) ? dockedAt.parentHabitat : null;
                if (dockParentHabitat !== null) {
                    stellarObject = dockParentHabitat;
                }
                let num14 = 0.0;
                const soEmpire = stellarObject.empire;
                if (stellarObject !== null && soEmpire !== null && soEmpire.pirateMissions !== null && soEmpire.pirateMissions.count > 0) {
                    const firstByTargetAndType = soEmpire.pirateMissions.getFirstByTargetAndType(stellarObject, EmpireActivityType.Smuggle);
                    if (firstByTargetAndType !== null && firstByTargetAndType.requestingEmpire !== bo.actualEmpire && cargo2.commodityIsResource && (firstByTargetAndType.resourceId === 255 || firstByTargetAndType.resourceId === cargo2.commodity.resourceId)) {
                        num14 = firstByTargetAndType.price * num13;
                        if (soEmpire === galaxy.playerEmpire || dockedAt.empire === galaxy.playerEmpire || bo.actualEmpire === galaxy.playerEmpire) {
                            firstByTargetAndType.playerAmountDelivered += num13;
                            firstByTargetAndType.playerIncomeEarned += num14;
                        }
                        performPrivateTransaction(soEmpire, 0.0 - num14);
                        if (galaxy.scenario !== null) recordSmuggleDelivery(galaxy, stellarObject, num13); // 19d2 black-market line (no Rnd)
                    }
                }
                let flag9 = false;
                if (bo.pirateEmpireId > 0 && cargoEmpireId(cargo) !== bo.pirateEmpireId) {
                    const byEmpireId = pirateEmpireById(galaxy, bo.pirateEmpireId);
                    if (byEmpireId !== null) {
                        let num15 = 1.0;
                        const characters = characterList(bo);
                        if (characters !== null && characters.length > 0) {
                            num15 += 0.01 * getHighestSkillLevel(characters, CharacterSkillType.SmugglingIncome);
                        }
                        const num16 = calculateCurrentCargoValue(galaxy, cargo2, num13);
                        const num17 = num16 * 0.25 * colonyIncomeFactor(byEmpireId) * smugglingIncomeFactor(byEmpireId);
                        let num18 = num14 + num17;
                        num18 *= num15;
                        num18 = applyCorruptionToIncome(byEmpireId, num18);
                        byEmpireId.stateMoney += num18;
                        byEmpireId.pirateEconomy.performIncome(num18, PirateIncomeType.Smuggling, starDate);
                        byEmpireId.counters.pirateSmugglingIncome += num18;
                        flag9 = true;
                    }
                }
                if (flag9 && cargo.amount <= 0) {
                    doCharacterEventRuntime(galaxy, CharacterEventType.SmugglingSuccess, dockedAt, characterList(bo), false, null);
                }
                if (cargo2.amount <= 0) {
                    cargoListRemove(bo.cargo!, cargo2);
                }
                result = Math.max(0.0, (capacity * timePassed - num13) / capacity);
            } else {
                checkCancelContracts(galaxy, bo);
                mission.completeCommand(true);
                bo.firstExecutionOfCommand = true;
                result = timePassed;
            }
        } else {
            cargoListRemove(commodities, cargo);
            result = timePassed;
        }
    } else if (command.troops !== null && command.troops.count > 0) {
        const troops = command.troops;
        let num19 = -1;
        if (dockedAt.dockingBays !== null) {
            num19 = dockingBayIndexOfShip(dockedAt.dockingBays, bo);
        }
        if (num19 < 0) {
            return result;
        }
        let troopList = dockedAt.troops;
        // 3927 `_ = DockedAt.Characters;`
        if (dockedAt.empire === bo.empire && isHabitat(dockedAt)) {
            const habitat2 = dockedAt;
            const invadingTroops = habitat2.invadingTroops;
            if (invadingTroops !== null && invadingTroops.count > 0 && invadingTroops.items[0].empire === bo.empire) {
                troopList = invadingTroops;
            }
        }
        if (troopList === null || bo.troops === null || dockTroopCapacityRemaining(dockedAt) - troops.totalSize < 0) {
            return result;
        }
        const troopList2: typeof troops.items = [];
        for (const troop9 of troops.items) {
            const num20 = bo.troops.items.indexOf(troop9);
            if (num20 >= 0) {
                troopList2.push(troop9);
            }
            if (isBuiltObject(dockedAt)) {
                troop9.builtObject = dockedAt;
            } else if (isHabitat(dockedAt)) {
                troop9.colony = dockedAt;
            }
            troopList.add(troop9);
        }
        for (const item8 of troopList2) {
            bo.troops.remove(item8);
        }
        troops.clear();
        mission.completeCommand();
        bo.firstExecutionOfCommand = true;
        result = timePassed;
    } else if (command.population !== null && command.population.items.length > 0) {
        let num21 = -1;
        if (dockedAt.dockingBays !== null) {
            num21 = dockingBayIndexOfShip(dockedAt.dockingBays, bo);
        }
        if (num21 >= 0) {
            const dockPopulation = dockedAt.population;
            if (dockPopulation !== null && bo.population !== null) {
                for (const item9 of bo.population.items.slice()) {
                    if (isBuiltObject(dockedAt) || item9.amount >= 1000000) {
                        let flag10 = true;
                        if (isHabitat(dockedAt) && (dockPopulation.items.length <= 0 || dockPopulation.totalAmount <= 0)) {
                            flag10 = false;
                        }
                        if (flag10) {
                            dockPopulation.add(item9);
                            dockPopulation.recalculateTotalAmount();
                        }
                    }
                    processTourists(galaxy, bo, item9);
                }
            }
            // mod layer (19d4 §2.6): refugee convoys settle here — before bo.population is wiped below, so the hook
            // still sees the arrived items (and can found an independent colony when dockedAt had none, which the
            // stock code above silently drops).
            if (galaxy.scenario !== null) settleRefugeeConvoyArrival(galaxy, bo, dockedAt);
            if (bo.population !== null) {
                bo.population.items.length = 0;
                bo.population.recalculateTotalAmount();
            }
        }
        command.population.items.length = 0;
        mission.completeCommand();
        bo.firstExecutionOfCommand = true;
        result = timePassed;
    } else {
        checkCancelContracts(galaxy, bo);
        if (bo.role === BuiltObjectRole.Freight && bo.cargo !== null && bo.cargo.items.length > 0) {
            bo.cargo.clear();
        }
        mission.completeCommand();
        bo.firstExecutionOfCommand = true;
        result = timePassed;
    }
    return result;
};

/** BuiltObject.2.cs 4226 case Refuel. */
export const cmdRefuel: CommandHandler = (ctx) => {
    const { galaxy, bo, mission, timePassed, starDate } = ctx;
    let result = 0.0;
    const dockedAt = bo.dockedAt;
    if (dockedAt !== null) {
        if (dockedAt.isRefuellingDepot) {
            let num31 = -1;
            if (dockedAt.cargo !== null) {
                num31 = getCargoIndex(bo);
            }
            if (num31 >= 0) {
                const dockCargo = dockedAt.cargo!;
                let flag16 = false;
                let num32 = 0;
                let refuelAmount = dockCargo.items[num31].amount - dockCargo.items[num31].reserved;
                if (bo.refuelAmount > 0) {
                    refuelAmount = dockCargo.items[num31].amount;
                }
                refuelAmount = checkForNegativeRefueling(bo, refuelAmount);
                num32 = Math.max(1, Math.trunc(REFUEL_RATE * timePassed));
                if (refuelAmount < num32) {
                    num32 = refuelAmount;
                    flag16 = true;
                }
                const num33 = bo.fuelCapacity - Math.trunc(bo.currentFuel);
                if (num33 < num32) {
                    num32 = Math.trunc(num33);
                    flag16 = true;
                }
                let num34 = 1.0;
                if (bo.fuelType !== null) {
                    num34 = galaxyResourceCurrentPrices(galaxy)[bo.fuelType.resourceId];
                }
                const num35 = Math.trunc(num32 * num34);
                dockCargo.items[num31].amount -= num32;
                if (bo.refuelAmount > 0) {
                    if (bo.refuelLocationIsBuiltObject && isBuiltObject(dockedAt)) {
                        const builtObject4 = dockedAt;
                        const c = dockCargo.items[num31];
                        if (builtObject4 !== null && builtObject4.builtObjectID === bo.refuelLocationId && c.commodityIsResource && c.commodity.resourceId === bo.refuelResourceId) {
                            const num36 = Math.min(c.reserved, Math.min(bo.refuelAmount, num32));
                            c.reserved -= num36;
                            bo.refuelAmount = ((bo.refuelAmount - num36) << 16) >> 16;
                        }
                    } else if (isHabitat(dockedAt)) {
                        const habitat7 = dockedAt;
                        const c = dockCargo.items[num31];
                        if (habitat7 !== null && habitat7.habitatIndex === bo.refuelLocationId && c.commodityIsResource && c.commodity.resourceId === bo.refuelResourceId) {
                            const num37 = Math.min(c.reserved, Math.min(bo.refuelAmount, num32));
                            c.reserved -= num37;
                            bo.refuelAmount = ((bo.refuelAmount - num37) << 16) >> 16;
                        }
                    }
                }
                bo.currentFuel += num32;
                bo.currentEnergy = Math.max(bo.currentEnergy, 0.0);
                const num38 = num35 * 1.0;
                const empire = bo.empire;
                const owner = bo.owner;
                if (empire !== null && empire.pirateEmpireBaseHabitat !== null) {
                    if (owner !== null) {
                        owner.stateMoney -= num38;
                        owner.pirateEconomy.performExpense(num38, PirateExpenseType.Fuel, starDate);
                        purchaseStateFuel(galaxy, owner, num38);
                    } else {
                        purchasePrivateFuel(galaxy, empire, num38);
                    }
                } else if (owner !== null) {
                    owner.stateMoney -= num38;
                    purchaseStateFuel(galaxy, owner, num38);
                } else {
                    performPrivateTransaction(empire!, 0.0 - num38);
                    purchasePrivateFuel(galaxy, empire!, num38);
                }
                performPrivateTransaction(dockedAt.empire!, num38);
                if (flag16) {
                    checkCancelRefuelData(galaxy, bo);
                    result = Math.max(0.0, (REFUEL_RATE * timePassed - num32) / REFUEL_RATE);
                    if (bo._fuelHandicapped) {
                        bo.reDefine();
                        bo._fuelHandicapped = false;
                    }
                    mission.completeCommand();
                    bo.firstExecutionOfCommand = true;
                }
            } else {
                checkCancelRefuelData(galaxy, bo);
                mission.completeCommand();
                bo.firstExecutionOfCommand = true;
                result = timePassed;
            }
        } else {
            checkCancelRefuelData(galaxy, bo);
            mission.completeCommand(true);
            bo.firstExecutionOfCommand = true;
            result = timePassed;
        }
    } else {
        checkCancelRefuelData(galaxy, bo);
        mission.completeCommand(true);
        bo.firstExecutionOfCommand = true;
        result = timePassed;
    }
    return result;
};

