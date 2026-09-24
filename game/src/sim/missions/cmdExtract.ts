// M4g — ExecuteCommands case ExtractResources (BuiltObject.2.cs 1227-1309) with BaconBuiltObject.
// CommandActionExtractResources (BaconBuiltObject.cs 3567) and BaconHabitat.CheckIfShouldBuildAsteroidColony
// (BaconHabitat.cs 378).
//
// The case itself extracts nothing: it stops the ship on its first execution and completes the command when the hold
// is full, when the target has nothing this ship can extract, or when the target became owned by a real empire. The
// extraction happens in BuiltObject.IndustrialProcessing (industry.ts) while the ship sits still at its parent habitat.
// The case never sets `result`, so it always returns 0.0 (ExecuteCommands 399 `double result = 0.0`).
// Rnd: none (the Bacon asteroid-colony check draws a clock-seeded `new Random()` only with allowAsteroidColonies on).

import type { BuiltObject } from '../builtObject';
import type { Galaxy } from '../galaxy';
import { BuiltObjectSubRole } from '../builtObjectTypes';
import { HabitatCategoryType } from '../types';
import { ResourceGroup, resourceGroupOf } from '../resourceSystem';
import { builtObjectMission, type BuiltObjectMission } from './mission';
import type { CommandHandler } from './executeCommands';

/** BaconHabitat.cs 23 allowAsteroidColonies = false (BaconMain.cs 738 reads an override from BaconSettings.txt). */
const BACON_ALLOW_ASTEROID_COLONIES = false;

/** BaconHabitat.cs 378 CheckIfShouldBuildAsteroidColony(bom). */
function checkIfShouldBuildAsteroidColony(galaxy: Galaxy, bom: BuiltObjectMission | null): void {
    if (!BACON_ALLOW_ASTEROID_COLONIES) return;
    const builtObject = bom?._builtObject ?? null;
    const targetHabitat = bom?.targetHabitat ?? null;
    if (builtObject === null || targetHabitat === null || targetHabitat.category !== HabitatCategoryType.Asteroid) return;
    void galaxy;
    // TODO(port) M4g: BaconHabitat.cs 386-396 (player/pirate/independent/pre-warp gates, the colony-count ratio, the
    // clock-seeded `new Random().NextDouble() < 1 / ((n1 + n2) * asteroidColonyPrevalenceDivisor)` roll) and
    // DeployAsteroidColony (298-330: StateMoney -= asteroidColonyCost, TakeOwnershipOfColony, 30000 population, two
    // troop units, 250 of every strategic resource). Unreachable while allowAsteroidColonies is false (the default).
    throw new Error('TODO(port) M4g: BaconHabitat.CheckIfShouldBuildAsteroidColony with allowAsteroidColonies');
}

/** BaconBuiltObject.cs 3567 CommandActionExtractResources(ship). */
function commandActionExtractResources(galaxy: Galaxy, ship: BuiltObject): void {
    if (!ship.firstExecutionOfCommand) return;
    const shipMission = builtObjectMission(ship.mission);
    checkIfShouldBuildAsteroidColony(galaxy, shipMission);
    let flag = false;
    if (ship.baconValues !== null) {
        if (ship.baconValues.has('cash') && !ship.isAutoControlled) flag = true;
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
