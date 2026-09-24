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
    const val2 = 0;
    if (h.ruin !== null) val = Math.trunc(h.ruin.developmentBonus * 100.0);
    // TODO(port): WonderForDevelopment (PlanetaryFacility model) — null at game start.
    let num = Math.max(val, val2);
    // TODO(port): _RestrictedResourcesPresent (set by EvaluateColonyVariables) — false at game start.
    const restrictedResourcesPresent = false;
    if (restrictedResourcesPresent) num += 30;
    num += Math.trunc(resourceBonusTotalByEffectType(h, ColonyResourceEffect.Development));
    // TODO(port): RaceEventType (TodashGalacticChampionships / PredictiveHistory +5) — Undefined at game start.
    // TODO(port): BaconHabitat.GetDevelopmentLevel (infrastructure spending) — BaconValues null → 0.
    const bacon = 0;
    return (h.developmentLevelBaseline + h.developmentLevel + num + bacon) | 0;
}
