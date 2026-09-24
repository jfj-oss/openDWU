// Colonies at game start (task C2a / M2b). Ports of
//   Galaxy.8.cs MakeHabitatIntoColony (line 639)
//   Galaxy.8.cs SetColonyResources   (line 699)
// Every Galaxy.Rnd call is kept in the C# order. Callees that don't draw Rnd
// and whose systems aren't ported yet are TODO(port) notes in place.

import { generateColonyStartingTroops } from './troops';
import type { Galaxy } from './galaxy';
import type { Empire } from './empire';
import { COLONY_ANNUAL_LUXURY_RESOURCE_CONSUMPTION_RATE, COLONY_ANNUAL_RESOURCE_CONSUMPTION_RATE, MINIMUM_LUXURY_RESOURCE_REORDER_AMOUNT } from './empire';
import type { Race } from './data/races';
import type { Habitat } from './types';
import { Population } from './population';
import { Cargo, ResourceRef } from './cargo';
// taxes.ts also registers empire.ts's TakeOwnershipOfColony hooks (SetColonyTaxRate etc.).
import { recalculateCriticalResourceSupplyBonuses } from './taxes';
import { recalculateDevelopmentLevelBaseline } from './developmentLevel';
import { recalculateAnnualTaxRevenue } from './forceStructure';
import { RuinType } from './ruins';

// Port of Galaxy.8.cs MakeHabitatIntoColony(galaxy, habitat, empire, age, race,
// homeSystemFactor, hasSpacePort).
export function makeHabitatIntoColony(
    galaxy: Galaxy,
    habitat: Habitat,
    empire: Empire,
    age: number,
    race: Race,
    homeSystemFactor: number,
    hasSpacePort: boolean,
): void {
    // Galaxy.8.cs 641-648 (the Ruin feeds the DevelopmentLevel property).
    if (habitat.ruin !== null && (habitat.ruin.type === RuinType.Standard || habitat.ruin.type === RuinType.CreatureSwarm || habitat.ruin.type === RuinType.PirateAmbush)) {
        habitat.ruin = null;
        const i = galaxy.ruinsHabitats.indexOf(habitat);
        if (i >= 0) galaxy.ruinsHabitats.splice(i, 1);
    }
    empire.takeOwnershipOfColony(habitat, empire);
    if (habitat.quality < 0.5) {
        habitat.baseQuality = Math.fround(0.5 + Math.fround(galaxy.rnd.nextDouble() * 0.1));
    }
    habitat.isRefuellingDepot = true;
    if (galaxy.colonyNames !== null && empire !== galaxy.independentEmpire && empire === galaxy.playerEmpire && galaxy.colonyNames.length > galaxy.colonyNameIndex) {
        habitat.name = galaxy.colonyNames[galaxy.colonyNameIndex];
        galaxy.colonyNameIndex++;
    }
    let num = habitat.quality;
    if (habitat.type === race.nativeHabitatType) {
        num *= 2.0;
    }
    let num2 = Math.trunc(homeSystemFactor * num * 300000000.0 + homeSystemFactor * num * galaxy.rnd.nextDouble() * 400000000.0);
    if (age > 0) {
        num2 = Math.trunc(num2 * Math.pow(1.7, age));
    }
    const population = new Population(race, num2);
    habitat.population.add(population);
    habitat.population.totalAmount += num2;
    // TODO(port): Habitat.GrowPopulation(TimeSpan.Zero) — no Rnd; growth model not ported.
    const num3 = setColonyResources(galaxy, habitat, empire, hasSpacePort);
    habitat.setDevelopmentLevel(Math.min(50, Math.max(0, num3 * 5 + galaxy.rnd.next(0, 5))));
    // Galaxy.8.cs 677-679.
    recalculateCriticalResourceSupplyBonuses(galaxy, habitat);
    recalculateDevelopmentLevelBaseline(habitat);
    recalculateAnnualTaxRevenue(galaxy, habitat);
    // TODO(port): Habitat.DoTasks (680; a no-op at game start: all touch
    // spans are ~0), ConstructionQueue.ReviewConstructionSpeed (683) — no Rnd.
    // Galaxy.8.cs 685-696: starting garrison (one NextDouble).
    generateColonyStartingTroops(galaxy, habitat, empire, race, galaxy.difficultyLevel);
    empire.resolveSystemVisibility(habitat.xpos, habitat.ypos);
}

// Port of Galaxy.8.cs SetColonyResources(galaxy, habitat, empire, hasSpacePort).
export function setColonyResources(galaxy: Galaxy, habitat: Habitat, empire: Empire | null, hasSpacePort: boolean): number {
    let val = 1 + Math.trunc(habitat.population.totalAmount / 250000000);
    val = Math.min(10, val);
    const num = 500.0;
    const dominant = habitat.population.dominantRace;
    // C#: (double)(DominantRace.CautionLevel / 100) — integer division.
    let num2 = COLONY_ANNUAL_RESOURCE_CONSUMPTION_RATE * (habitat.population.totalAmount / 20.0) * Math.trunc((dominant?.caution ?? 0) / 100);
    if (num2 < 1.0) {
        num2 = 1.0;
    } else if (num2 > 4.0) {
        num2 = 4.0;
    }
    const rs = galaxy.resourceSystem;
    if (habitat.cargo !== null) {
        habitat.cargo.clear();
        for (const def of rs.strategicResourcesOrderedByRelativeImportance) {
            if (def.colonyGrowthResourceLevel > 0) {
                const imp = rs.relativeImportance.get(def.resourceId) ?? 0;
                habitat.cargo.add(new Cargo(new ResourceRef(def.resourceId), Math.trunc(Math.fround(imp * 6000) * num2), empire));
            }
        }
        if (hasSpacePort) {
            for (const def of rs.strategicResourcesOrderedByRelativeImportance) {
                if (def.colonyGrowthResourceLevel <= 0) {
                    const imp = rs.relativeImportance.get(def.resourceId) ?? 0;
                    habitat.cargo.add(new Cargo(new ResourceRef(def.resourceId), Math.trunc(Math.fround(imp * 1500) * num2), empire));
                }
            }
        }
        const num3 = Math.max(500000000, habitat.population.totalAmount);
        let num4 = Math.trunc(COLONY_ANNUAL_LUXURY_RESOURCE_CONSUMPTION_RATE * num3 * ((dominant?.caution ?? 0) / 100.0) * 5.0);
        num4 = Math.max(num4 * 3, MINIMUM_LUXURY_RESOURCE_REORDER_AMOUNT);
        num4 = Math.max(400, num4);
        num4 = Math.trunc(num4 * 1.5);
        void num4; // computed but unused in the C#
        for (let k = 0; k < 4; k++) {
            const index = galaxy.rnd.next(0, rs.strategicResources.length);
            habitat.cargo.add(new Cargo(new ResourceRef(rs.strategicResources[index].resourceId), 400, empire));
        }
        if (empire !== null && empire.dominantRace !== null) {
            for (const bonus of empire.dominantRace.criticalResources) {
                const amount = galaxy.rnd.next(300, 500);
                habitat.cargo.add(new Cargo(new ResourceRef(bonus.resourceId), amount, empire));
            }
        }
        for (const hr of habitat.resources) {
            habitat.cargo.add(new Cargo(new ResourceRef(hr.resourceId), Math.trunc(num * num2), empire));
        }
    }
    return val;
}
