// M4h — retrofit queues: BuiltObject.2.cs 6023 ReviewRetrofitConstructionQueue, and the Bacon private-sector
// build / refit investment BaconBuiltObject.cs 5106 PrivateSectorBuildOrRefitInvestInInfrastructure (with Empire.9.cs
// 2344 SelectRandomSpacePortColony), shared by case Build (missions/cmdConstruction.ts) and the retrofit missions
// (Empire.5.cs 173-353, M4i).

import type { Galaxy } from '../galaxy';
import type { BuiltObject } from '../builtObject';
import type { Empire } from '../empire';
import type { Habitat } from '../types';
import type { ConstructionQueue } from './constructionQueue';
import type { ManufacturingQueue } from '../manufacturingQueue';
import { manufacturingQueueDoManufacturing } from '../industry';

/**
 * BaconBuiltObject.cs 77 privateBuildCostToStateMoney = 1.0 (the class default; BaconSettings.txt sets 0.3, but the
 * port keeps the C# defaults for BaconMain.BaconInitialize settings, as builtObject.ts / colonyTick.ts do).
 * TODO(port): BaconSettings.txt overrides (BaconMain.cs 925). Intentionally not BaconSettings.txt line 156 (0.3).
 */
export const BACON_PRIVATE_BUILD_COST_TO_STATE_MONEY = 1.0;

/**
 * BuiltObject.2.cs 6023 ReviewRetrofitConstructionQueue(time, starDate): runs a colony-built base's retrofit queues
 * (RetrofitBaseManufacturingQueue, RetrofitBaseConstructionQueue) while they hold work, and drops them when empty.
 * Rnd: DoManufacturing's Next(0, manufacturers) (parent with cargo), then DoConstruction's Next(0, yards).
 */
export function reviewRetrofitConstructionQueue(galaxy: Galaxy, builtObject: BuiltObject, time: number, starDate: number): void {
    // 6025-6051: RetrofitBaseManufacturingQueue (set by Empire.5.cs AssignRetrofitMission, construction/empireConstruction.ts).
    const retrofitBaseManufacturingQueue = builtObject.retrofitBaseManufacturingQueue as ManufacturingQueue | null;
    if (retrofitBaseManufacturingQueue !== null) {
        let flag = false;
        if (retrofitBaseManufacturingQueue.componentWaitQueue !== null && retrofitBaseManufacturingQueue.componentWaitQueue.length > 0) {
            flag = true;
        }
        const manufacturers = retrofitBaseManufacturingQueue.manufacturers;
        if (manufacturers !== null && manufacturers.length > 0) {
            for (let i = 0; i < manufacturers.length; i++) {
                const manufacturer = manufacturers[i];
                if (manufacturer != null && manufacturer.component !== null) {
                    flag = true;
                }
            }
        }
        if (flag) {
            manufacturingQueueDoManufacturing(retrofitBaseManufacturingQueue, galaxy, time, starDate);
        } else {
            builtObject.retrofitBaseManufacturingQueue = null;
        }
    }
    const retrofitBaseConstructionQueue = builtObject.retrofitBaseConstructionQueue as ConstructionQueue | null;
    if (retrofitBaseConstructionQueue === null) {
        return;
    }
    let flag2 = false;
    if (retrofitBaseConstructionQueue.constructionWaitQueue !== null && retrofitBaseConstructionQueue.constructionWaitQueue.length > 0) {
        flag2 = true;
    }
    const yards = retrofitBaseConstructionQueue.constructionYards;
    if (yards !== null && yards.length > 0) {
        for (let j = 0; j < yards.length; j++) {
            const constructionYard = yards[j];
            if (constructionYard != null && constructionYard.shipUnderConstruction !== null) {
                flag2 = true;
            }
        }
    }
    if (flag2) {
        retrofitBaseConstructionQueue.doConstruction(galaxy, time);
    } else {
        builtObject.retrofitBaseConstructionQueue = null;
    }
}

/** Empire.9.cs 2344 SelectRandomSpacePortColony(coloniesToExclude). Rnd: Next(0, SpacePorts.Count). */
export function selectRandomSpacePortColony(galaxy: Galaxy, empire: Empire, coloniesToExclude: readonly (BuiltObject | Habitat)[]): Habitat | null {
    const spacePorts = empire.spacePorts;
    const num = galaxy.rnd.next(0, spacePorts.length);
    for (let i = num; i < spacePorts.length; i++) {
        const ph = spacePorts[i].parentHabitat;
        if (ph !== null && !coloniesToExclude.includes(ph)) return ph;
    }
    for (let j = 0; j < num; j++) {
        const ph = spacePorts[j].parentHabitat;
        if (ph !== null && !coloniesToExclude.includes(ph)) return ph;
    }
    return null;
}

/**
 * BaconBuiltObject.cs 5106 PrivateSectorBuildOrRefitInvestInInfrastructure(ship, cost): (1 − factor) × cost goes to the
 * "infrastructure" BaconValue of a random space-port colony, and factor × cost is returned (added to state money).
 * Space ports named "--…" are excluded. Rnd: SelectRandomSpacePortColony. (The try/catch and the debug pause are
 * UI-only.)
 */
export function privateSectorBuildOrRefitInvestInInfrastructure(galaxy: Galaxy, ship: BuiltObject, cost: number): number {
    const num1 = (1.0 - BACON_PRIVATE_BUILD_COST_TO_STATE_MONEY) * cost;
    const num2 = BACON_PRIVATE_BUILD_COST_TO_STATE_MONEY * cost;
    const actualEmpire = ship.actualEmpire!;
    const coloniesToExclude: BuiltObject[] = [];
    for (const spacePort of actualEmpire.spacePorts) {
        if (spacePort.name.startsWith('--')) coloniesToExclude.push(spacePort);
    }
    const habitat = selectRandomSpacePortColony(galaxy, actualEmpire, coloniesToExclude);
    if (habitat !== null) {
        if (habitat.baconValues === null) habitat.baconValues = new Map<string, unknown>();
        if (habitat.baconValues.has('infrastructure')) {
            const baconValue = habitat.baconValues.get('infrastructure') as number;
            habitat.baconValues.set('infrastructure', baconValue + Math.trunc(num1));
        } else {
            habitat.baconValues.set('infrastructure', Math.trunc(num1));
        }
    }
    return num2;
}
