// M4h — ExecuteCommands cases Build / Scrap / Retrofit / Repair (BuiltObject.2.cs 1444 / 1311 / 704 / 620), with the
// Galaxy helpers only these cases use (Galaxy.7.cs 367 CheckForeignBaseAtHabitat, 383 CheckAlreadyHaveMiningStationAtHabitat,
// Galaxy.5.cs 3397 GeneratePlanetDestroyerName).
//
// Each export has the `CommandHandler` signature (executeCommands.ts) and returns the C# `result` (0.0 unless a case
// assigns timePassed).
// Rnd: case Build draws in the name generators (GenerateBuiltObjectName / SelectUniqueBuiltObjectName /
// GeneratePirateBaseName / GeneratePlanetDestroyerName), SelectRandomHeading (bases, planet destroyers) and
// PrivateSectorBuildOrRefitInvestInInfrastructure (SelectRandomSpacePortColony); the other cases draw none.

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import { BuiltObject } from '../builtObject';
import { HabitatCategoryType, type Habitat } from '../types';
import { BuiltObjectSubRole } from '../builtObjectTypes';
import { BuiltObjectRole } from '../data/designSpecifications';
import { csInt } from '../builtObjectComponent';
import { Cargo } from '../cargo';
import { GalaxyLocation, GalaxyLocationType } from '../galaxyLocation';
import { generatePirateBaseName } from '../pirates';
import { checkEmpireTerritoryCanBuildAtHabitat, determineMiningStationAtHabitat, determineMiningStationAtHabitatForEmpire } from '../resourceTargets';
import { checkResearchStationAtLocation } from '../stationPlacement';
import { performPrivateTransaction } from '../treasury';
import { pirateEconomyPerformExpense } from '../pirates/pirateAI';
import { obtainBuildResourcesForConstructionShip } from '../construction/empireConstruction';
import { privateSectorBuildOrRefitInvestInInfrastructure } from '../construction/retrofit';
import type { ConstructionQueue } from '../construction/constructionQueue';
import { clearPreviousMissionRequirements } from './assign';
import { isBuiltObject, isHabitat } from './mission';
import type { CommandContext, CommandHandler } from './executeCommands';

/** PirateExpenseType.Construction (PirateExpenseType.cs). */
const PIRATE_EXPENSE_CONSTRUCTION = 2;

/** StellarObject.ConstructionQueue (typed `unknown` on BuiltObject / Habitat). */
function queueOf(o: BuiltObject | Habitat): ConstructionQueue | null {
    return o.constructionQueue as ConstructionQueue | null;
}

/** StellarObject.CargoSpace: BuiltObject.CargoSpace / Habitat.CargoSpace = 536870911 (Habitat.cs 293). */
function cargoSpaceOf(o: BuiltObject | Habitat): number {
    return isBuiltObject(o) ? o.cargoSpace : 536870911;
}

/** DockingBayList.IndexOf(BuiltObject): the bay holding the ship. */
function dockingBayIndexOf(bays: { dockedShip: BuiltObject | null }[], ship: BuiltObject): number {
    for (let i = 0; i < bays.length; i++) {
        if (bays[i].dockedShip === ship) return i;
    }
    return -1;
}

/** Galaxy.7.cs 367 CheckForeignBaseAtHabitat(habitat, empire). */
export function checkForeignBaseAtHabitat(habitat: Habitat | null, empire: Empire | null): boolean {
    if (habitat !== null && habitat.basesAtHabitat !== null && empire !== null) {
        for (let i = 0; i < habitat.basesAtHabitat.length; i++) {
            const builtObject = habitat.basesAtHabitat[i];
            if (builtObject != null && builtObject.empire !== null && builtObject.empire !== empire) return true;
        }
    }
    return false;
}

/** Galaxy.7.cs 383 CheckAlreadyHaveMiningStationAtHabitat(habitat, empire). */
export function checkAlreadyHaveMiningStationAtHabitat(habitat: Habitat | null, empire: Empire): boolean {
    if (habitat !== null) {
        if (habitat.category === HabitatCategoryType.GasCloud) {
            return determineMiningStationAtHabitatForEmpire(habitat, empire) != null;
        }
        return determineMiningStationAtHabitat(habitat) != null;
    }
    return false;
}

/** Galaxy.5.cs 3397 GeneratePlanetDestroyerName. Rnd: Next(0, 4). */
export function generatePlanetDestroyerName(galaxy: Galaxy): string {
    const array = ['World Destroyer', 'Devastation Moon', 'Desolation Moon', 'World Annihilator'];
    return array[galaxy.rnd.next(0, array.length)];
}

/**
 * The shared tail of cases Repair / Retrofit / Scrap once the ship is queued at its dock (BuiltObject.2.cs 674-700,
 * 758-790, 1403-1440): parent to the dock, BuiltAt = dock, stop, and leave the docking bay / its wait queue.
 * `clearOtherParent`: Retrofit / Scrap also clear the other parent reference; Repair does not.
 */
function moveFromDockIntoYard(bo: BuiltObject, clearOtherParent: boolean): void {
    const dockedAt = bo.dockedAt!;
    if (isBuiltObject(dockedAt)) {
        bo.parentBuiltObject = dockedAt;
        if (clearOtherParent) bo.parentHabitat = null;
        bo.parentOffsetX = bo.xpos - bo.parentBuiltObject.xpos;
        bo.parentOffsetY = bo.ypos - bo.parentBuiltObject.ypos;
    } else if (isHabitat(dockedAt)) {
        bo.parentHabitat = dockedAt;
        if (clearOtherParent) bo.parentBuiltObject = null;
        bo.parentOffsetX = bo.xpos - bo.parentHabitat.xpos;
        bo.parentOffsetY = bo.ypos - bo.parentHabitat.ypos;
    }
    bo.builtAt = dockedAt;
    bo.preferredSpeed = 0;
    bo.currentSpeed = 0;
    if (dockedAt.dockingBayWaitQueue !== null && dockedAt.dockingBayWaitQueue.includes(bo)) {
        dockedAt.dockingBayWaitQueue.splice(dockedAt.dockingBayWaitQueue.indexOf(bo), 1);
    }
    if (dockedAt.dockingBays !== null) {
        const num = dockingBayIndexOf(dockedAt.dockingBays, bo);
        if (num >= 0) dockedAt.dockingBays[num].dockedShip = null;
    }
    bo.dockedAt = null;
}

/** BuiltObject.2.cs 620 case Repair. */
export const cmdRepair: CommandHandler = (ctx) => {
    const { galaxy, bo } = ctx;
    let result = 0.0;
    if (!bo.firstExecutionOfCommand) return result;
    let flag31 = false;
    if (bo.damagedComponentCount === 0 && bo.unbuiltComponentCount === 0) {
        clearPreviousMissionRequirements(galaxy, bo);
        result = ctx.timePassed;
        return result;
    }
    if (bo.role === BuiltObjectRole.Base) {
        const ph = bo.parentHabitat;
        if (ph === null || queueOf(ph) === null) {
            clearPreviousMissionRequirements(galaxy, bo);
            return result;
        }
        if (!queueOf(ph)!.addBuiltObjectToConstruct(bo)) {
            clearPreviousMissionRequirements(galaxy, bo);
            return result;
        }
        flag31 = true;
        bo.firstExecutionOfCommand = false;
    } else if (bo.dockedAt !== null) {
        const dockedAt = bo.dockedAt;
        if (!dockedAt.isShipYard || queueOf(dockedAt) === null) {
            clearPreviousMissionRequirements(galaxy, bo);
            return result;
        }
        if (!queueOf(dockedAt)!.addBuiltObjectToRepair(bo)) {
            clearPreviousMissionRequirements(galaxy, bo);
            return result;
        }
        flag31 = true;
        bo.firstExecutionOfCommand = false;
    }
    if (bo.role !== BuiltObjectRole.Base && bo.dockedAt === null) {
        clearPreviousMissionRequirements(galaxy, bo);
    } else {
        if (!flag31) return result;
        // A base (never docked) would dereference a null DockedAt here in the C# too; unreachable — AssignMission
        // (BuiltObject.2.cs 7622) gives bases no missions.
        moveFromDockIntoYard(bo, false);
    }
    return result;
};

/** BuiltObject.2.cs 704 case Retrofit. */
export const cmdRetrofit: CommandHandler = (ctx) => {
    const { galaxy, bo, mission } = ctx;
    let result = 0.0;
    if (!bo.firstExecutionOfCommand) return result;
    let flag = false;
    const design = mission.design;
    if (design === null) {
        clearPreviousMissionRequirements(galaxy, bo);
        result = ctx.timePassed;
        return result;
    }
    if (bo.role === BuiltObjectRole.Base) {
        const ph = bo.parentHabitat;
        if (ph === null || queueOf(ph) === null) {
            clearPreviousMissionRequirements(galaxy, bo);
            return result;
        }
        if (!queueOf(ph)!.addBuiltObjectToRetrofit(bo, design)) {
            clearPreviousMissionRequirements(galaxy, bo);
            return result;
        }
        flag = true;
        design.buildCount++;
        bo.firstExecutionOfCommand = false;
    } else if (bo.dockedAt !== null) {
        const dockedAt = bo.dockedAt;
        if (!dockedAt.isShipYard || queueOf(dockedAt) === null) {
            clearPreviousMissionRequirements(galaxy, bo);
            return result;
        }
        if (!queueOf(dockedAt)!.addBuiltObjectToRetrofit(bo, design)) {
            clearPreviousMissionRequirements(galaxy, bo);
            return result;
        }
        flag = true;
        design.buildCount++;
        bo.firstExecutionOfCommand = false;
    }
    if (bo.role !== BuiltObjectRole.Base && bo.dockedAt === null) {
        clearPreviousMissionRequirements(galaxy, bo);
    } else {
        if (!flag) return result;
        moveFromDockIntoYard(bo, true);
    }
    return result;
};

/** BuiltObject.2.cs 1311 case Scrap. */
export const cmdScrap: CommandHandler = (ctx) => {
    const { galaxy, bo } = ctx;
    const result = 0.0;
    if (!bo.firstExecutionOfCommand) return result;
    let flag14 = false;
    if (bo.role === BuiltObjectRole.Base) {
        const ph = bo.parentHabitat;
        if (ph === null || queueOf(ph) === null) {
            clearPreviousMissionRequirements(galaxy, bo);
            return result;
        }
        if (!queueOf(ph)!.addBuiltObjectToScrap(bo)) {
            clearPreviousMissionRequirements(galaxy, bo);
            return result;
        }
        flag14 = true;
        bo.firstExecutionOfCommand = false;
    } else if (bo.dockedAt !== null) {
        const dockedAt = bo.dockedAt;
        if (!dockedAt.isShipYard || queueOf(dockedAt) === null) {
            clearPreviousMissionRequirements(galaxy, bo);
            return result;
        }
        if (!queueOf(dockedAt)!.addBuiltObjectToScrap(bo)) {
            clearPreviousMissionRequirements(galaxy, bo);
            return result;
        }
        flag14 = true;
        bo.scrap = true;
        bo.firstExecutionOfCommand = false;
    }
    if (bo.dockedAt === null) {
        clearPreviousMissionRequirements(galaxy, bo);
        return result;
    }
    const dockedAt = bo.dockedAt;
    // 1353-1380: unload the cargo into the dock (as far as it has room).
    if (bo.role !== BuiltObjectRole.Base && bo.cargo !== null && bo.cargo.items.length > 0 && cargoSpaceOf(dockedAt) > 0) {
        for (const item5 of bo.cargo.items) {
            let num28 = item5.amount;
            if (num28 > cargoSpaceOf(dockedAt)) num28 = cargoSpaceOf(dockedAt);
            let cargo5: Cargo | null = null;
            if (item5.commodityComponent !== null) {
                cargo5 = Cargo.ofComponent(item5.commodityComponent, num28, item5.empire);
            } else if (item5.commodity !== null) {
                cargo5 = new Cargo(item5.commodity, num28, item5.empire);
            }
            if (dockedAt.cargo !== null) dockedAt.cargo.add(cargo5!);
            if (cargoSpaceOf(dockedAt) <= 0) break;
        }
        bo.cargo.clear();
    }
    // 1381-1402: troops aboard go to the dock's colony.
    if (bo.troops !== null && bo.troops.items.length > 0) {
        let habitat6: Habitat | null = null;
        if (isBuiltObject(dockedAt)) {
            if (dockedAt.parentHabitat !== null) habitat6 = dockedAt.parentHabitat;
        } else if (isHabitat(dockedAt)) {
            habitat6 = dockedAt;
        }
        if (bo.troops !== null && bo.troops.items.length > 0 && habitat6 !== null && habitat6.troops !== null) {
            for (const troop6 of bo.troops.items) {
                troop6.builtObject = null;
                troop6.colony = habitat6;
                habitat6.troops.add(troop6);
            }
            bo.troops.clear();
        }
    }
    if (!flag14) return result;
    moveFromDockIntoYard(bo, true);
    return result;
};

/** BuiltObject.2.cs 1444 case Build (a construction ship building / repairing a base or ship at its location). */
export const cmdBuild: CommandHandler = (ctx) => {
    const { galaxy, bo, mission } = ctx;
    let result = 0.0;
    let flag2 = true;
    const constructionQueue = queueOf(bo);
    if (constructionQueue !== null) {
        if (bo.firstExecutionOfCommand) {
            const design = mission.design;
            if (design !== null) {
                const empire = bo.empire!;
                // 1453-1493: mining stations / resort bases need a free habitat inside buildable territory.
                if ((design.subRole === BuiltObjectSubRole.GasMiningStation || design.subRole === BuiltObjectSubRole.MiningStation || design.subRole === BuiltObjectSubRole.ResortBase) && bo.parentHabitat !== null) {
                    const ph = bo.parentHabitat;
                    let flag3 = true;
                    if (design.subRole === BuiltObjectSubRole.GasMiningStation || design.subRole === BuiltObjectSubRole.MiningStation) {
                        if (ph.owner !== null && ph.owner !== galaxy.independentEmpire) flag3 = false;
                    } else if (design.subRole === BuiltObjectSubRole.ResortBase && ph.owner !== null && ph.owner !== galaxy.independentEmpire && ph.owner !== empire) {
                        flag3 = false;
                    }
                    let flag4 = false;
                    if (design.subRole === BuiltObjectSubRole.GasMiningStation || design.subRole === BuiltObjectSubRole.MiningStation) {
                        flag4 = checkAlreadyHaveMiningStationAtHabitat(ph, empire);
                    }
                    const flag5 = checkForeignBaseAtHabitat(ph, empire);
                    if (flag4 || flag5) flag3 = false;
                    if (bo.actualEmpire!.pirateEmpireBaseHabitat === null && !checkEmpireTerritoryCanBuildAtHabitat(galaxy, empire, ph)) flag3 = false;
                    if (!flag3) {
                        bo.parentOffsetX = -2000000001.0;
                        bo.parentOffsetY = -2000000001.0;
                        mission.completeCommand();
                        bo.firstExecutionOfCommand = true;
                        result = ctx.timePassed;
                        // C# `break` (1487): leaves the switch, skipping the queue check at the end of the case.
                        return result;
                    }
                }
                // 1494-1501: one research station per system.
                if ((design.subRole === BuiltObjectSubRole.WeaponsResearchStation || design.subRole === BuiltObjectSubRole.EnergyResearchStation || design.subRole === BuiltObjectSubRole.HighTechResearchStation) && mission.targetHabitat !== null && checkResearchStationAtLocation(galaxy, mission.targetHabitat)) {
                    bo.parentOffsetX = -2000000001.0;
                    bo.parentOffsetY = -2000000001.0;
                    mission.completeCommand();
                    bo.firstExecutionOfCommand = true;
                    result = ctx.timePassed;
                    // C# `break` (1500).
                    return result;
                }
                // 1502-1520: name the new object.
                let flag6 = false;
                design.buildCount++;
                let empty = '';
                // Precedence as in the C#: (pirate && Small) || Medium || Large.
                if ((bo.empire !== null && bo.empire.pirateEmpireBaseHabitat !== null && design.subRole === BuiltObjectSubRole.SmallSpacePort) || design.subRole === BuiltObjectSubRole.MediumSpacePort || design.subRole === BuiltObjectSubRole.LargeSpacePort) {
                    empty = bo.parentHabitat === null ? galaxy.generateBuiltObjectName(design) : generatePirateBaseName(galaxy, bo.parentHabitat);
                } else if (
                    design.subRole === BuiltObjectSubRole.GasMiningStation ||
                    design.subRole === BuiltObjectSubRole.MiningStation ||
                    design.subRole === BuiltObjectSubRole.ResortBase ||
                    design.subRole === BuiltObjectSubRole.EnergyResearchStation ||
                    design.subRole === BuiltObjectSubRole.WeaponsResearchStation ||
                    design.subRole === BuiltObjectSubRole.HighTechResearchStation ||
                    design.subRole === BuiltObjectSubRole.MonitoringStation ||
                    design.subRole === BuiltObjectSubRole.DefensiveBase ||
                    design.subRole === BuiltObjectSubRole.GenericBase
                ) {
                    empty = bo.parentHabitat === null ? galaxy.generateBuiltObjectName(design) : galaxy.selectUniqueBuiltObjectName(design, bo.parentHabitat);
                } else if (design.role !== BuiltObjectRole.Base && design.isPlanetDestroyer) {
                    empty = generatePlanetDestroyerName(galaxy);
                    flag6 = true;
                } else {
                    empty = galaxy.generateBuiltObjectName(design);
                }
                // 1521-1535
                const builtObject = new BuiltObject(design, empty, galaxy);
                builtObject.purchasePrice = design.calculateCurrentPurchasePrice(galaxy);
                builtObject.parentBuiltObject = bo.parentBuiltObject;
                builtObject.parentHabitat = bo.parentHabitat;
                builtObject.parentOffsetX = bo.parentOffsetX;
                builtObject.parentOffsetY = bo.parentOffsetY;
                builtObject.builtAt = bo;
                builtObject.xpos = bo.xpos;
                builtObject.ypos = bo.ypos;
                if (builtObject.role === BuiltObjectRole.Base || flag6) builtObject.heading = galaxy.selectRandomHeading();
                builtObject.targetHeading = builtObject.heading;
                mission.secondaryTargetBuiltObject = builtObject;
                bo.preferredSpeed = 0;
                bo.currentSpeed = 0;
                if (constructionQueue.addBuiltObjectToConstruct(builtObject)) {
                    let parent: BuiltObject | Habitat | null = null;
                    if (bo.parentHabitat !== null) parent = bo.parentHabitat;
                    else if (bo.parentBuiltObject !== null) parent = bo.parentBuiltObject;
                    let flag7 = false;
                    let flag8 = false;
                    switch (builtObject.subRole) {
                        case BuiltObjectSubRole.SmallSpacePort:
                        case BuiltObjectSubRole.MediumSpacePort:
                        case BuiltObjectSubRole.LargeSpacePort:
                        case BuiltObjectSubRole.GenericBase:
                        case BuiltObjectSubRole.EnergyResearchStation:
                        case BuiltObjectSubRole.WeaponsResearchStation:
                        case BuiltObjectSubRole.HighTechResearchStation:
                        case BuiltObjectSubRole.MonitoringStation:
                        case BuiltObjectSubRole.DefensiveBase:
                            flag7 = true;
                            break;
                        case BuiltObjectSubRole.ResortBase:
                            flag7 = true;
                            if (bo.actualEmpire!.pirateEmpireBaseHabitat !== null) flag8 = true;
                            break;
                    }
                    if (flag6) flag7 = true;
                    empire.addBuiltObjectToGalaxy(builtObject, parent, false, flag7, csInt(bo.parentOffsetX), csInt(bo.parentOffsetY));
                    if (flag8) {
                        builtObject.empire = galaxy.independentEmpire;
                        if (!galaxy.independentEmpire!.privateBuiltObjects.includes(builtObject)) galaxy.independentEmpire!.privateBuiltObjects.push(builtObject);
                    }
                    const num11 = design.calculateCurrentPurchasePrice(galaxy);
                    if (bo.empire !== null && bo.empire.pirateEmpireBaseHabitat !== null) {
                        bo.empire.stateMoney -= num11;
                        pirateEconomyPerformExpense(galaxy, bo.empire, num11, PIRATE_EXPENSE_CONSTRUCTION, ctx.starDate);
                    } else if (!flag7) {
                        performPrivateTransaction(builtObject.empire!, 0.0 - num11);
                        bo.empire!.stateMoney += privateSectorBuildOrRefitInvestInInfrastructure(galaxy, bo, num11);
                    }
                    obtainBuildResourcesForConstructionShip(galaxy, bo.empire!, bo, builtObject);
                    if (flag6) {
                        // 1597-1608: the planet destroyer project location.
                        const x2 = bo.xpos - 600.0;
                        const y2 = bo.ypos - 600.0;
                        const name = `${builtObject.name} Project`; // TextResolver "X Project"
                        const galaxyLocation = new GalaxyLocation(name, GalaxyLocationType.PlanetDestroyer, x2, y2, 1200.0, 1200.0, -1);
                        galaxyLocation.relatedBuiltObject = builtObject;
                        galaxyLocation.showName = true;
                        galaxy.galaxyLocations.push(galaxyLocation);
                        galaxy.addGalaxyLocationIndex(galaxyLocation);
                        bo.empire!.visibility.knownGalaxyLocations.push(galaxyLocation);
                    }
                    bo.firstExecutionOfCommand = false;
                } else {
                    bo.parentOffsetX = -2000000001.0;
                    bo.parentOffsetY = -2000000001.0;
                    mission.completeCommand();
                    result = ctx.timePassed;
                    bo.firstExecutionOfCommand = true;
                }
            } else if (mission.secondaryTargetBuiltObject !== null) {
                // 1622-1669: repair a damaged base / ship in place.
                const secondaryTargetBuiltObject = mission.secondaryTargetBuiltObject;
                if (secondaryTargetBuiltObject.builtAt !== null) {
                    clearPreviousMissionRequirements(galaxy, bo);
                    result = ctx.timePassed;
                } else {
                    bo.preferredSpeed = 0;
                    bo.currentSpeed = 0;
                    secondaryTargetBuiltObject.preferredSpeed = 0;
                    secondaryTargetBuiltObject.currentSpeed = 0;
                    if (secondaryTargetBuiltObject.role !== BuiltObjectRole.Base && secondaryTargetBuiltObject.parentHabitat !== null) {
                        if (bo.parentHabitat === secondaryTargetBuiltObject.parentHabitat) {
                            bo.parentOffsetX = -2000000001.0;
                            bo.parentOffsetY = -2000000001.0;
                            bo.parentHabitat = null;
                        }
                        secondaryTargetBuiltObject.parentOffsetX = -2000000001.0;
                        secondaryTargetBuiltObject.parentOffsetY = -2000000001.0;
                        secondaryTargetBuiltObject.parentHabitat = null;
                    }
                    if (secondaryTargetBuiltObject.parentHabitat !== null) {
                        bo.parentHabitat = secondaryTargetBuiltObject.parentHabitat;
                        bo.parentOffsetX = secondaryTargetBuiltObject.parentOffsetX;
                        bo.parentOffsetY = secondaryTargetBuiltObject.parentOffsetY;
                    }
                    if (constructionQueue.addBuiltObjectToRepair(secondaryTargetBuiltObject)) {
                        if (secondaryTargetBuiltObject.role !== BuiltObjectRole.Base) {
                            clearPreviousMissionRequirements(galaxy, secondaryTargetBuiltObject);
                            secondaryTargetBuiltObject.revertMission = null;
                        }
                        secondaryTargetBuiltObject.builtAt = bo;
                        obtainBuildResourcesForConstructionShip(galaxy, bo.empire!, bo, secondaryTargetBuiltObject);
                        bo.firstExecutionOfCommand = false;
                    } else {
                        clearPreviousMissionRequirements(galaxy, bo);
                        result = ctx.timePassed;
                    }
                }
            } else {
                clearPreviousMissionRequirements(galaxy, bo);
                result = ctx.timePassed;
            }
        }
        return buildTail(ctx, constructionQueue, flag2, result);
    }
    flag2 = true;
    if (flag2) {
        mission.completeCommand();
        bo.firstExecutionOfCommand = true;
    }
    return result;
};

/** The end of case Build (1677-1694): the command completes once the construction ship's queue is empty. */
function buildTail(ctx: CommandContext, constructionQueue: ConstructionQueue, flag2: boolean, result: number): number {
    if (constructionQueue.constructionWaitQueue!.length > 0) flag2 = false;
    const yards = constructionQueue.constructionYards!;
    for (let j = 0; j < yards.length; j++) {
        if (yards[j].shipUnderConstruction !== null) flag2 = false;
    }
    if (flag2) {
        ctx.mission.completeCommand();
        ctx.bo.firstExecutionOfCommand = true;
    }
    return result;
}
