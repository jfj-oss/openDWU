// Colony development level (cycle-free: type-only imports, so empire.ts,
// colony.ts, territory.ts and forceStructure.ts can all use it). Ports of
//   Habitat.cs DevelopmentLevel (447), RecalculateDevelopmentLevelBaseline (5575);
//   ResourceBonusList.cs GetBonusTotalByEffectType (15); ColonyResourceEffect.cs.
// Re-exported from taxes.ts. No Galaxy.Rnd.
//
// Field vs property: Habitat.developmentLevel is the C# field _DevelopmentLevel
// (SetDevelopmentLevel / GetDevelopmentLevel); the C# DevelopmentLevel property is
// habitatDevelopmentLevel(h) below.

import type { Habitat } from './types';

// ColonyResourceEffect.cs (byte enum, member order exact).
export enum ColonyResourceEffect {
    Undefined,
    Happiness,
    Development,
    ConstructionSpeed,
    RecruitedTroopStrength,
    ResearchWeapons,
    ResearchEnergy,
    ResearchHighTech,
    PopulationGrowthRate,
    WarWearinessReduction,
    IncomeBoost,
    BaseMaintenanceReduction,
}

// ResourceBonusList.cs GetBonusTotalByEffectType (15).
export function resourceBonusTotalByEffectType(h: Habitat, effectType: ColonyResourceEffect): number {
    let total = 0.0;
    for (const resourceBonus of h.resourceBonuses) {
        if (resourceBonus != null && resourceBonus.effect === effectType) total += resourceBonus.value;
    }
    return total;
}

// Habitat.cs RecalculateDevelopmentLevelBaseline (5575).
export function recalculateDevelopmentLevelBaseline(h: Habitat): void {
    let developmentLevelBaseline = 0;
    if (h.population != null && h.population.items.length > 0) {
        h.population.recalculateTotalAmount();
        const totalAmount = h.population.totalAmount;
        let val = totalAmount / 500000000.0;
        val = Math.min(1.0, Math.max(0.0, val));
        developmentLevelBaseline = Math.trunc(50.0 * val);
    }
    h.developmentLevelBaseline = developmentLevelBaseline;
}

// Habitat.cs DevelopmentLevel (447) — the property (baseline + _DevelopmentLevel + bonuses).
export function habitatDevelopmentLevel(h: Habitat): number {
    let val = 0;
    let val2 = 0;
    if (h.ruin !== null) val = Math.trunc(h.ruin.developmentBonus * 100.0);
    // WonderForDevelopment (set by ReviewPlanetaryFacilities, construction/facilities.ts).
    if (h.wonderForDevelopment !== null) val2 = h.wonderForDevelopment.value1;
    let num = Math.max(val, val2);
    // _RestrictedResourcesPresent (set by EvaluateColonyVariables, colonyTick.ts).
    if (h.restrictedResourcesPresent) num += 30;
    num += Math.trunc(resourceBonusTotalByEffectType(h, ColonyResourceEffect.Development));
    // TODO(port): RaceEventType (TodashGalacticChampionships / PredictiveHistory +5) — Undefined at game start.
    // BaconHabitat.cs 879 GetDevelopmentLevel (infrastructure spending; 0 while BaconValues is null).
    const bacon = baconGetDevelopmentLevel(h);
    return (h.developmentLevelBaseline + h.developmentLevel + num + bacon) | 0;
}

/**
 * System.Convert.ToInt32(double) (M4j): round half to even; OverflowException outside Int32 (after rounding).
 */
export function convertToInt32(value: number): number {
    let r = Math.round(value);
    if (Math.abs(value - Math.trunc(value)) === 0.5) r = 2 * Math.round(value / 2);
    if (!(r >= -2147483648 && r <= 2147483647)) throw new Error('OverflowException: Value was either too large or too small for an Int32.');
    return r;
}

/** BaconHabitat.cs 29-30 infrasetuctureDurability = 0.9f / colonyInfrastructureSpendingPopulationFactor = 300000000L. */
export const BACON_INFRASTRUCTURE_DURABILITY = Math.fround(0.9);
export const BACON_COLONY_INFRASTRUCTURE_SPENDING_POPULATION_FACTOR = 300000000;
/** BaconHabitat.cs 27 infrastructureSpendingPerDevelopmentLevel = 50000. */
export const BACON_INFRASTRUCTURE_SPENDING_PER_DEVELOPMENT_LEVEL = 50000;

/** BaconHabitat.cs 879 GetDevelopmentLevel(planet). */
export function baconGetDevelopmentLevel(planet: Habitat): number {
    let developmentLevel = 0;
    if (planet.baconValues !== null) developmentLevel = determineDevelopmentLevelBonusFromInfrastructureSpending(planet);
    return developmentLevel;
}

/** BaconHabitat.cs 905 DetermineDevelopmentLevelBonusFromInfrastructureSpending(planet). */
export function determineDevelopmentLevelBonusFromInfrastructureSpending(planet: Habitat): number {
    let infrastructureSpending = 0;
    if (planet.baconValues !== null && planet.baconValues.has('infrastructure')) {
        const baconValue = planet.baconValues.get('infrastructure') as number;
        let num1 = 1;
        if (planet.population != null && planet.population.totalAmount > 0) num1 = planet.population.totalAmount;
        const f = BACON_COLONY_INFRASTRUCTURE_SPENDING_POPULATION_FACTOR;
        const num2 = (num1 + f) / (num1 + f / 3.0);
        infrastructureSpending = convertToInt32((baconValue * num2) / BACON_INFRASTRUCTURE_SPENDING_PER_DEVELOPMENT_LEVEL);
    }
    return infrastructureSpending;
}
