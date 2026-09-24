// M4j — colony growth, happiness, migration factor, terraforming, damage regeneration, colony variables.
//
// Stubs created by M4a (tasks/M4-plan.md §3.1): the tick skeletons in src/sim/tick/ call these entry points in C#
// order. Each is a no-op that does NOT draw Galaxy.Rnd (a `RND:` note marks C# draw sites that are skipped until the
// owning package ports the body) and records a TODO hit (tick/todo.ts). The owning package replaces the bodies in
// place, keeping the signatures (or adjusting the skeleton call in the same change).

import type { Galaxy } from './galaxy';
import type { Empire } from './empire';
import type { Habitat } from './types';
import { registerTodo, todo } from './tick/todo';

const T_evaluateColonyVariables = registerTodo('M4j', 'evaluateColonyVariables');
/**
 * Empire.4.cs 2943 EvaluateColonyVariables(galaxy, timePassed). Only its _TotalPopulation write is ported
 * (Empire.4.cs 2945/3174/3182/3306: sum of Population.Amount over the non-destroyed colonies, both growth
 * branches) — the slice the old game-start stand-in ran, moved here so the real Empire tick
 * reproduces it. TODO(port) M4j: the rest (development level drift, growth rates, resource orders,
 * RecalculateAnnualTaxRevenue, ProcessColonyTroops with recruitment).
 */
export function evaluateColonyVariables(galaxy: Galaxy, empire: Empire, timePassed: number): void {
    // RND: draws in callees (d≤3) — not drawn until M4j.
    let num = 0;
    for (let j = 0; j < empire.colonies.length; j++) {
        const habitat = empire.colonies[j];
        if (habitat.hasBeenDestroyed) continue;
        for (const population of habitat.population.items) num += population.amount;
    }
    empire.totalPopulation = num;
    /* TODO(port) M4j */ todo(T_evaluateColonyVariables);
}

const T_evaluateColonyVariablesPirate = registerTodo('M4j', 'evaluateColonyVariablesPirate');
/** Empire.4.cs 2579 EvaluateColonyVariablesPirate(galaxy, timePassed). */
export function evaluateColonyVariablesPirate(galaxy: Galaxy, empire: Empire, timePassed: number): void {
    // RND: draws in callees (d≤3) — not drawn until M4j.
    /* TODO(port) M4j */ todo(T_evaluateColonyVariablesPirate);
}

const T_reviewColonyPopulationPolicy = registerTodo('M4j', 'reviewColonyPopulationPolicy');
/** Empire.2.cs 3198 ReviewColonyPopulationPolicy(timePassed). */
export function reviewColonyPopulationPolicy(galaxy: Galaxy, empire: Empire, timePassed: number): void {
    /* TODO(port) M4j */ todo(T_reviewColonyPopulationPolicy);
}

const T_reviewRacePeriodicChanges = registerTodo('M4j', 'reviewRacePeriodicChanges');
/** Galaxy.cs 3425 ReviewRacePeriodicChanges. */
export function reviewRacePeriodicChanges(galaxy: Galaxy): void {
    /* TODO(port) M4j */ todo(T_reviewRacePeriodicChanges);
}

const T_reviewColonyFillFactor = registerTodo('M4j', 'reviewColonyFillFactor');
/** Galaxy.cs 3020 ReviewColonyFillFactor. */
export function reviewColonyFillFactor(galaxy: Galaxy): void {
    /* TODO(port) M4j */ todo(T_reviewColonyFillFactor);
}

const T_calculateWarWithOurRace = registerTodo('M4j', 'calculateWarWithOurRace');
/** Habitat.cs 5694 CalculateWarWithOurRace. */
export function calculateWarWithOurRace(galaxy: Galaxy, habitat: Habitat): void {
    /* TODO(port) M4j */ todo(T_calculateWarWithOurRace);
}

const T_growPopulation = registerTodo('M4j', 'growPopulation');
/** Habitat.cs 5172 GrowPopulation(TimeSpan timePassed) — the span in seconds. */
export function growPopulation(galaxy: Galaxy, habitat: Habitat, timePassedSeconds: number): void {
    /* TODO(port) M4j */ todo(T_growPopulation);
}

const T_regenerateDamage = registerTodo('M4j', 'regenerateDamage');
/** Habitat.cs 2485 RegenerateDamage(timePassed). */
export function regenerateDamage(galaxy: Galaxy, habitat: Habitat, timePassed: number): void {
    /* TODO(port) M4j */ todo(T_regenerateDamage);
}

const T_terraformColony = registerTodo('M4j', 'terraformColony');
/** Habitat.cs 7211 / BaconHabitat.cs 243 TerraformColony(timePassed). */
export function terraformColony(galaxy: Galaxy, habitat: Habitat, timePassed: number): void {
    /* TODO(port) M4j */ todo(T_terraformColony);
}

const T_checkSatisfaction = registerTodo('M4j', 'checkSatisfaction');
/** Habitat.cs 5992 CheckSatisfaction. */
export function checkSatisfaction(galaxy: Galaxy, habitat: Habitat): void {
    // RND: 1 direct — not drawn until M4j.
    /* TODO(port) M4j */ todo(T_checkSatisfaction);
}

const T_updateConqueredFactor = registerTodo('M4j', 'updateConqueredFactor');
/** Habitat.cs 1599 UpdateConqueredFactor(timePassed). */
export function updateConqueredFactor(galaxy: Galaxy, habitat: Habitat, timePassed: number): void {
    /* TODO(port) M4j */ todo(T_updateConqueredFactor);
}

const T_calculateMigrationFactor = registerTodo('M4j', 'calculateMigrationFactor');
/** Habitat.cs 1162 CalculateMigrationFactor. */
export function calculateMigrationFactor(galaxy: Galaxy, habitat: Habitat): void {
    /* TODO(port) M4j */ todo(T_calculateMigrationFactor);
}

const T_baconHabitatHugeProcessingSpanActions = registerTodo('M4j', 'baconHabitatHugeProcessingSpanActions');
/**
 * BaconHabitat.cs 434 HugeProcessingSpanActions(planet): prisoners, AI infrastructure investment, market prices / cash,
 * infrastructure and pirate-base decay. (Prisoner handling is M4q's; economy parts M4j's.)
 */
export function baconHabitatHugeProcessingSpanActions(galaxy: Galaxy, habitat: Habitat): void {
    // RND: clock×5 (new Random(), e.g. 447 market-price update chance) — derive draw-free from the galaxy seed when ported (plan §0).
    /* TODO(port) M4j */ todo(T_baconHabitatHugeProcessingSpanActions);
}
