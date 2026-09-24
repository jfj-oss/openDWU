// M4a skeleton: ShipGroup.DoTasks (ShipGroup.cs 97-122). Called from the Empire short block (Empire.1.cs 3508),
// DoTasksPirates (4166), Galaxy.ProcessPirateFleets (Galaxy.cs 3278) and the frame driver's "GxFlt" pass
// (Main.Part12.cs 3598-3622). Intervals are TimeSpan `>=` tests; touches are updated after each block.

import type { Galaxy } from '../galaxy';
import { INTERMEDIATE_PROCESSING_SPAN_MS, MIN_TIME, PERIODIC_PROCESSING_SPAN_MS } from './simTime';
import {
    type ShipGroup,
    checkForCompletedBattle,
    checkForMissionCompletion,
    checkRefuelManual,
    checkRefuelRepairAttack,
    checkSendForAttack,
    reviewCharacterLocationBonuses,
} from '../fleets/shipGroup';
import { checkAssignUnloadTroopsAtColonyNeedingThemMission, loadTroopsIfNecessaryAndPossible } from '../combat/troopsRuntime';

/** ShipGroup.cs 97 DoTasks(DateTime time); `time` in game ms. */
export function shipGroupDoTasks(galaxy: Galaxy, shipGroup: ShipGroup, time: number): void {
    // 99-100
    if (shipGroup.lastTouch === MIN_TIME) {
        shipGroup.lastTouch = time;
    }
    // 101-106
    if (time - shipGroup.lastTouch >= INTERMEDIATE_PROCESSING_SPAN_MS) {
        checkForMissionCompletion(galaxy, shipGroup);
        checkForCompletedBattle(galaxy, shipGroup);
        shipGroup.lastTouch = time;
    }
    // 107-108
    if (!(time - shipGroup.lastPeriodicTouch >= PERIODIC_PROCESSING_SPAN_MS)) {
        return;
    }
    // 109-112
    checkRefuelManual(galaxy, shipGroup);
    checkRefuelRepairAttack(galaxy, shipGroup, false, null);
    checkSendForAttack(galaxy, shipGroup);
    reviewCharacterLocationBonuses(galaxy, shipGroup);
    // 113-120
    if (shipGroup.leadShip !== null && shipGroup.leadShip.isAutoControlled) {
        let flag = false;
        if (shipGroup.empire !== null) {
            flag = checkAssignUnloadTroopsAtColonyNeedingThemMission(galaxy, shipGroup.empire, shipGroup);
        }
        if (!flag) {
            // RND: LoadTroopsIfNecessaryAndPossible draws Next(0, 2) per eligible ship (ShipGroup.cs 132).
            loadTroopsIfNecessaryAndPossible(galaxy, shipGroup);
        }
    }
    // 121
    shipGroup.lastPeriodicTouch = time;
}
