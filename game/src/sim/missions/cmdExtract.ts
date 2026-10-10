// M4g — ExecuteCommands case ExtractResources (BuiltObject.2.cs 1227-1309) with BaconBuiltObject.
// CommandActionExtractResources (BaconBuiltObject.cs 3567) and BaconHabitat.CheckIfShouldBuildAsteroidColony
// (BaconHabitat.cs 378).
//
// The case itself extracts nothing: it stops the ship on its first execution and completes the command when the hold
// is full, when the target has nothing this ship can extract, or when the target became owned by a real empire. The
// extraction happens in BuiltObject.IndustrialProcessing (industry.ts) while the ship sits still at its parent habitat.
// The case never sets `result`, so it always returns 0.0 (ExecuteCommands 399 `double result = 0.0`).
// Rnd: none on Galaxy.Rnd. With allowAsteroidColonies on (BaconSettings.txt), the Bacon asteroid-colony check draws its
// clock-seeded `new Random().NextDouble()` on galaxy.baconHabitatClockRnd (colonyTick.ts baconClockRnd, plan §0).

import { isAiControlled } from './playerOrder';
import type { BuiltObject } from '../builtObject';
import type { Galaxy } from '../galaxy';
import { BuiltObjectSubRole } from '../builtObjectTypes';
import { HabitatCategoryType, type Habitat } from '../types';
import { Cargo, CargoList, ResourceRef, Troop, TroopList, TroopType } from '../cargo';
import { preWarpProgressEventOccurred } from '../empireEvents';
import { PreWarpProgressEventType } from '../exploration';
import { Population } from '../population';
import { baconClockRnd } from '../colonyTick';
import { baconSettings } from '../data/baconSettings';
import { ResourceGroup, resourceGroupOf } from '../resourceSystem';
import { builtObjectMission, type BuiltObjectMission } from './mission';
import type { CommandHandler } from './executeCommands';
import { humanEmpires, isHumanEmpire } from '../humanEmpires';

/** BaconHabitat.cs 378 CheckIfShouldBuildAsteroidColony(bom). BaconBuiltObject.myMain is set in any running game. */
function checkIfShouldBuildAsteroidColony(galaxy: Galaxy, bom: BuiltObjectMission | null): void {
    if (!baconSettings.allowAsteroidColonies) return;
    const builtObject = bom?._builtObject ?? null;
    const targetHabitat = bom?.targetHabitat ?? null;
    if (builtObject === null || targetHabitat === null || targetHabitat.category !== HabitatCategoryType.Asteroid) return;
    const actualEmpire = builtObject.actualEmpire;
    // 386-388
    if (actualEmpire === null || actualEmpire === galaxy.independentEmpire || actualEmpire.pirateEmpireBaseHabitat !== null || isHumanEmpire(galaxy, actualEmpire) || !preWarpProgressEventOccurred(actualEmpire, PreWarpProgressEventType.FirstHyperjump)) return;
    // 389-392: non-asteroid / asteroid colony counts.
    let num1 = 0;
    let num2 = 0;
    for (const x of actualEmpire.colonies) {
        if (x.category !== HabitatCategoryType.Asteroid) num1++;
        else num2++;
    }
    if (num1 > 0 && num2 >= num1) return;
    // 393-395: float num3 = (float)(1.0 / ((double)(num1 + num2) * (double)asteroidColonyPrevalenceDivisor)); clock Random.
    const num3 = Math.fround(1.0 / ((num1 + num2) * baconSettings.asteroidColonyPrevalenceDivisor));
    if (baconClockRnd(galaxy).nextDouble() >= num3) return;
    deployAsteroidColony(galaxy, builtObject, targetHabitat);
}

/** BaconHabitat.cs 298 DeployAsteroidColony(ship, asteroid): the body runs in a try with an empty catch. */
function deployAsteroidColony(galaxy: Galaxy, ship: BuiltObject, asteroid: Habitat): void {
    try {
        if (asteroid.population !== null && asteroid.population.totalAmount > 0) return;
        const empire = ship.empire!;
        empire.stateMoney -= baconSettings.asteroidColonyCost;
        empire.takeOwnershipOfColony(asteroid, empire);
        // PopulationList.Add does not update TotalAmount (see population.ts).
        asteroid.population.add(new Population(ship.nativeRace !== null ? ship.nativeRace : ship.actualEmpire!.dominantRace!, 30000, galaxy));
        // The C#'s PlayerEmpire: every human empire (humanEmpires.ts).
        for (const human of humanEmpires(galaxy)) {
            if (ship.empire !== human && human.resourceMap.checkResourcesKnown(asteroid)) human.resourceMap.setResourcesKnown(asteroid, false);
        }
        if (asteroid.troops === null) asteroid.troops = new TroopList();
        const owner = asteroid.empire!;
        const troop1 = new Troop('asteroid cops', TroopType.Infantry, 100, 1000, 100, Math.fround(100), owner, owner.dominantRace);
        const troop2 = new Troop('asteroid cops', TroopType.Infantry, 100, 1000, 100, Math.fround(100), owner, owner.dominantRace);
        troop1.colony = asteroid;
        troop2.colony = asteroid;
        asteroid.troops.add(troop1);
        asteroid.troops.add(troop2);
        if (asteroid.cargo === null) asteroid.cargo = new CargoList();
        if (asteroid.facilities === null) asteroid.facilities = [];
        asteroid.cargo.clear();
        giveAllStrategicResourcesCargoToPlanet(galaxy, asteroid, 250);
        if (asteroid.baseQuality >= 1.0) return;
        asteroid.baseQuality = Math.fround(1);
    } catch {
        // C# catch (Exception) { } — ignored.
    }
}

/** BaconHabitat.cs 360 GiveAllStrategicResourcesCargoToPlanet(planet, amount). */
function giveAllStrategicResourcesCargoToPlanet(galaxy: Galaxy, planet: Habitat, amount: number): void {
    for (const resourceDefinition of [...galaxy.resourceSystem.strategicResources]) {
        planet.cargo!.add(new Cargo(new ResourceRef(resourceDefinition.resourceId), amount, planet.empire));
    }
}

/** BaconBuiltObject.cs 3567 CommandActionExtractResources(ship). */
function commandActionExtractResources(galaxy: Galaxy, ship: BuiltObject): void {
    if (!ship.firstExecutionOfCommand) return;
    const shipMission = builtObjectMission(ship.mission);
    checkIfShouldBuildAsteroidColony(galaxy, shipMission);
    let flag = false;
    if (ship.baconValues !== null) {
        if (ship.baconValues.has('cash') && !isAiControlled(ship)) flag = true;
        if (ship.baconValues.has('ShipNote') && (ship.baconValues.get('ShipNote') as string).startsWith('nodump')) flag = true;
    }
    if (flag) {
        // Keep only the current command: the (player) ship mines until full and then stops, without the trip home.
        const command = shipMission!.fastPeekCurrentCommand()!.clone();
        shipMission!.replaceCommandStack([command]);
    }
}

/** BuiltObject.2.cs 1227 case ExtractResources. */
export const cmdExtractResources: CommandHandler = (ctx) => {
    const { galaxy, bo, mission, command } = ctx;
    commandActionExtractResources(galaxy, bo);
    if (bo.firstExecutionOfCommand) {
        bo.preferredSpeed = 0;
        bo.currentSpeed = 0;
        bo.firstExecutionOfCommand = false;
    }
    let num30 = 0;
    if (bo.cargo !== null) {
        for (const item3 of bo.cargo.items) num30 = (num30 + item3.amount) | 0;
    }
    if (num30 >= bo.cargoCapacity) {
        mission.completeCommand();
        bo.firstExecutionOfCommand = true;
    } else {
        if (command.targetHabitat === null) return 0.0;
        const targetHabitat5 = command.targetHabitat;
        // targetHabitat5.Resources.Clone(): only the groups are read below.
        const groups = targetHabitat5.resources.map((r) => resourceGroupOf(galaxy.resourceSystem.byId.get(r.resourceId)!));
        const containsGroup = (group: ResourceGroup): boolean => groups.includes(group);
        let flag15 = false;
        switch (bo.subRole) {
            case BuiltObjectSubRole.GasMiningShip:
                if (containsGroup(ResourceGroup.Gas)) flag15 = true;
                break;
            case BuiltObjectSubRole.MiningShip:
                if (containsGroup(ResourceGroup.Mineral)) flag15 = true;
                break;
            default:
                if (bo.extractionMine > 0 && containsGroup(ResourceGroup.Mineral)) flag15 = true;
                if (bo.extractionGas > 0 && containsGroup(ResourceGroup.Gas)) flag15 = true;
                break;
        }
        if (bo.extractionLuxury > 0) {
            // foreach HabitatResource: if (IsLuxuryResource) { flag15 = true; break; }
            if (containsGroup(ResourceGroup.Luxury)) flag15 = true;
        }
        if (!flag15) {
            mission.completeCommand();
            bo.firstExecutionOfCommand = true;
        } else if (targetHabitat5.empire !== null && targetHabitat5.empire !== galaxy.independentEmpire) {
            mission.completeCommand();
            bo.firstExecutionOfCommand = true;
        }
    }
    return 0.0;
};
