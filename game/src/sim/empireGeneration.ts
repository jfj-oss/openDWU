// Empire generation at game start (task C2b / M2c). Port of Galaxy.7.cs
// GenerateEmpire (5078-5377) in C# order, every Galaxy.Rnd call kept.
//
// RND PARITY: the stream matches the C# up to `empire.DoTasks()` (Galaxy.7.cs
// ~5341). The Empire ctor backdates its touch timestamps, so the first
// DoTasks runs the full empire AI tick, which draws Rnd and isn't ported. Every
// Rnd draw after the first GenerateEmpire therefore diverges from the
// original until Empire.DoTasks exists. Other unported callees here don't
// draw Rnd (checked): LoadEmpirePolicy, TakeOwnershipOfColony,
// GenerateDesignSpecifications, Research.Update, LoadOptimizedDesigns,
// GrowPopulation, Habitat.DoTasks at game start, EstimatedDefensiveForceRequired,
// GenerateNewTroop; SetTechTreeLevel draws only for fractional tech levels.

import { loadEmpirePolicy } from './researchSystem';
import type { Galaxy } from './galaxy';
import { Galaxy as GalaxyClass } from './galaxy';
import { Empire, COLONY_MAXIMUM_TROOP_STRENGTH } from './empire';
import type { Race } from './data/races';
import type { Habitat } from './types';
import { Population } from './population';
import { setEmpireExplorationAmount } from './visibility';

export interface GenerateEmpireResult {
    empire: Empire;
    expansion: number;
    actualTechLevel: number;
}

// Port of Galaxy.7.cs GenerateEmpire(galaxy, isPlayerEmpire, empireName, capital,
// race, designPictureFamilyIndex, governmentId, homeSystemFactor,
// homeSystemDescription, age, techLevel, corruptionMultiplier, out expansion,
// gameOptions, globalVictoryConditions, out actualTechLevel, raceNameOverride).
export function generateEmpire(
    galaxy: Galaxy,
    isPlayerEmpire: boolean,
    empireName: string,
    capital: Habitat,
    race: Race,
    designPictureFamilyIndex: number,
    governmentId: number,
    homeSystemFactor: number,
    homeSystemDescription: string,
    age: number,
    techLevel: number,
    corruptionMultiplier: number,
    enableStoryEventsShadows = false,
): GenerateEmpireResult {
    const rnd = galaxy.rnd;
    let actualTechLevel = 1.0;
    // Galaxy.7.cs 5092: LoadEmpirePolicy(race, isPirate: false) (no Rnd).
    // TODO(port): player ImplementEnslavementWithPenalColonies = false (field not ported).
    const empirePolicy = loadEmpirePolicy(galaxy.researchStatic, race, false);
    const empire = new Empire(galaxy, empireName, capital, race, governmentId, corruptionMultiplier, empirePolicy, isPlayerEmpire);
    empire.playerEmpire = isPlayerEmpire;
    if (techLevel < 0.0) {
        const [num, num2] = [
            [0.0, 0.0],
            [0.5, 0.99],
            [0.5, 1.99],
            [1.0, 2.99],
            [2.0, 3.99],
            [3.0, 4.99],
            [4.0, 5.99],
        ][galaxy.age] ?? [0.5, 5.99];
        techLevel = num + rnd.nextDouble() * (num2 - num);
    }
    actualTechLevel = techLevel;
    if (age < 0) {
        const [minValue, num3] = [
            [0, 0],
            [1, 2],
            [1, 2],
            [2, 3],
            [3, 4],
            [3, 5],
            [4, 6],
        ][galaxy.age] ?? [0, 6];
        age = rnd.next(minValue, num3 + 1);
        age = Math.max(0, Math.min(6, age));
    }
    if (designPictureFamilyIndex >= 0) {
        empire.designPictureFamilyIndex = designPictureFamilyIndex;
    }
    // TODO(port): capital.Ruin cleared for Standard/CreatureSwarm/PirateAmbush ruins.
    empire.takeOwnershipOfColony(capital, empire);
    if (techLevel > 0.0 || !enableStoryEventsShadows) {
        empire.preWarpProgressEventsOccurred = true; // the 13 PreWarpProgressEventOccurred* flags
    }
    let minimumResourceCount = 5;
    let minimumCriticalResourceCount = 3;
    const num4 = rnd.next(0, 8);
    const table: Record<string, [number, number, number, number, number]> = {
        // desc: [minRes, minCrit, diameterBase, qualityBase, qualitySpread]
        Harsh: [3, 1, 260, 0.65, 0.06],
        Trying: [4, 2, 275, 0.73, 0.06],
        Normal: [5, 3, 290, 0.82, 0.06],
        Agreeable: [5, 3, 305, 0.9, 0.05],
        Excellent: [5, 3, 320, 0.97, 0.03],
    };
    const row = table[homeSystemDescription];
    if (row !== undefined) {
        minimumResourceCount = row[0];
        minimumCriticalResourceCount = row[1];
        capital.diameter = row[2] + num4;
        capital.baseQuality = Math.fround(row[3] + rnd.nextDouble() * row[4]);
    }
    capital.isRefuellingDepot = true;
    let num5 = Math.trunc(homeSystemFactor * 2200000000.0 + homeSystemFactor * rnd.nextDouble() * 500000000.0);
    if (age > 0) {
        num5 = Math.trunc(num5 * Math.pow(1.7, age));
    }
    let val = Math.trunc(homeSystemFactor * 10000000000.0 + homeSystemFactor * rnd.nextDouble() * 1000000000.0);
    if (age === 0) {
        val = Math.trunc(homeSystemFactor * 2200000000.0 + homeSystemFactor * rnd.nextDouble() * 500000000.0);
    }
    num5 = Math.max(num5, val);
    capital.population.add(new Population(race, num5));
    capital.population.totalAmount = num5;
    // TODO(port): capital.GrowPopulation(TimeSpan.Zero) — no Rnd.
    // (Control* automation flags are re-set here in the C#; the ctor already
    // set the same values.)
    galaxy.empires.push(empire);
    empire.resolveSystemVisibility(capital.xpos, capital.ypos);
    const expansion = GalaxyClass.determineEmpireExpansion(rnd, age);
    empire.expansion = expansion;
    empire.privateMoney = 40000.0 + (expansion + 2.0) * 3000.0;
    empire.stateMoney = 15000.0 + (expansion + 2.0) * 1500.0;
    empire.generateDesignSpecifications(galaxy, race, false, race.name);
    // ResearchNodeDefinitionsStatic.SetTechTreeLevel(techLevel) (draws Rnd only
    // for fractional levels) + Research.Update.
    if (galaxy.researchStatic !== null) empire.research.setTechTreeLevel(rnd, race, techLevel, false);
    empire.research.update();
    // TODO(port): LoadOptimizedDesignsForEmpire (designs).
    empire.reviewResearchAbilities();
    empire.reviewDesignsBuiltObjectsImprovedComponents();
    empire.reviewTroopTypes();
    empire.setStartupColonyResourceCargo(capital);
    capital.setDevelopmentLevel(10);
    // capital.DoTasks(CurrentDateTime): no-op at game start (see colony.ts).
    // TODO(port): EstimatedDefensiveForceRequired — 0 until ported (no Rnd).
    let num6 = 0 * 2;
    if (num6 > COLONY_MAXIMUM_TROOP_STRENGTH / 100) num6 = COLONY_MAXIMUM_TROOP_STRENGTH / 100;
    const num7 = Math.trunc(num6 * rnd.nextDouble());
    let num8 = Math.trunc(num7 / 100);
    if (techLevel === 0.0) num8 = Math.min(1, num8);
    // TODO(port): TroopCanRecruitInfantry → num8 × GenerateNewTroop(Infantry, race.TroopStrength).
    void num8;
    for (const h of galaxy.habitats) {
        if (h.parent === null) empire.resourceMap.setResourcesKnown(h, false);
    }
    let val2 = Math.trunc(expansion * 3.5);
    val2 = Math.min(val2, Math.trunc(galaxy.starCount * 0.85));
    if (val2 > galaxy.starCount) val2 = galaxy.starCount;
    if (age === 0) {
        val2 = 0;
        for (const h of galaxy.systemHabitatsOf(capital.systemIndex)) {
            empire.resourceMap.setResourcesKnown(h, false);
        }
    }
    setEmpireExplorationAmount(galaxy, empire.visibility, empire.capital!, val2);
    empire.resourceMap.setResourcesKnown(capital, true);
    empire.initiateConstruction = false;
    // TODO(port): empire.DoTasks() — the full empire AI tick. RND DIVERGENCE POINT (see header).
    empire.initiateConstruction = true;
    galaxy.setupHomeSystem(capital, race, homeSystemDescription, minimumResourceCount, minimumCriticalResourceCount);
    return { empire, expansion, actualTechLevel };
}
