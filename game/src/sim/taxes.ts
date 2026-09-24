// Colony approval / tax model at game start. Ports of
//   Habitat.cs: DevelopmentLevel (447), TaxApproval (474), RacialHappiness (491),
//     EmpireApprovalRating (534), TaxComplianceRate (701), RaidEconomyDamageFactor (891),
//     GetPlagueUnhappinessFactor (1869), CheckForSpacePortFacilities (2729),
//     RecalculateCriticalResourceSupplyBonuses / ...Factors (5087 / 5124),
//     RecalculateDevelopmentLevelBaseline (5575), CalculateExterminationConcern (5714),
//     CalculatePopulationPolicyConcern (5759), CalculateUnmodifiedApproval (5793/5798),
//     ModifyApprovalValueByEmpireAttributes (5858),
//     CalculateStrategicResourceSupplyGrowthFactor (7268)
//   Empire.cs: WarWeariness (1405), CivilityRatingApprovalRaw (1450),
//     CalculateRacialReputationConcern (3104)
//   Empire.9.cs SetColonyTaxRate (5448); Empire.10.cs ReviewTaxes (158),
//     RecalculateColonyTaxRevenues (43, in forceStructure.ts, re-exported)
//   Empire.4.cs CheckColoniesForBaseFacilities (2570), RecalculateEmpireCorruption (3411),
//     RecalculateEmpirePopulation (3448)
//   Galaxy.7.cs DetermineColonyBaseInfo (257); ResourceBonusList.GetBonusTotalByEffectType.
//
// Rnd: nothing here draws Galaxy.Rnd.
//
// Unported state read here, with the value C# sees at game start (Start.2.cs
// 1110-1339; characters are generated later, at Start.2.cs 1483):
// - Empire.Leader / Habitat.Characters: none → ColonyHappiness / WarWeariness skills 0.
// - Empire._WarWeariness 0, _CivilityRating 0, _LeaderChangeInfluence 0,
//   _SpecialBonusHappiness 0 (ReviewSpecialBonusesRuinsWonders — TODO(port)).
// - Habitat: _WarWithOurRace 0f (no wars), _CulturalDistressFactor 0f, ConqueredFactor 0f,
//   RaceEventType Undefined, PlagueId -1, RaidCountdown 0, SlaveryBonusFactor 1f,
//   _RestrictedResourcesPresent false, WonderForDevelopment null (no facilities),
//   BaconValues null.
// - DiplomaticRelations empty → CheckAtWar false; no pirate colony control.

import type { Galaxy } from './galaxy';
import type { Habitat } from './types';
import { Empire, empireGovernmentAttributes } from './empire';
import { BuiltObjectSubRole } from './builtObjectTypes';
import { ResourceRef } from './cargo';
import { checkAtWar, recalculateAnnualTaxRevenue } from './forceStructure';

export { recalculateColonyTaxRevenues } from './forceStructure';

const f32 = Math.fround;

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

// ColonyPopulationPolicy.cs (byte enum) — same values as data/policies.ts.
const POLICY_ENSLAVE = 3;
const POLICY_EXTERMINATE = 4;

// .NET Framework Math.Round(double, int digits): value * 10^digits, Math.Round
// (MidpointRounding.ToEven), / 10^digits (InternalRound, |value| < 1e16).
export function netRound(value: number, digits: number): number {
    const power10 = Math.pow(10, digits);
    if (Math.abs(value) < 1e16) {
        const v = value * power10;
        const fl = Math.floor(v);
        const diff = v - fl;
        let r: number;
        if (diff > 0.5) r = fl + 1;
        else if (diff < 0.5) r = fl;
        else r = fl % 2 === 0 ? fl : fl + 1;
        return r / power10;
    }
    return value;
}

// ResourceBonusList.cs GetBonusTotalByEffectType (15).
export function resourceBonusTotalByEffectType(h: Habitat, effectType: ColonyResourceEffect): number {
    let total = 0.0;
    for (const resourceBonus of h.resourceBonuses) {
        if (resourceBonus != null && resourceBonus.effect === effectType) total += resourceBonus.value;
    }
    return total;
}

// ---------------------------------------------------------------------------
// Development level
// ---------------------------------------------------------------------------

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
    return h.developmentLevelBaseline + h.developmentLevel + num + bacon;
}

// ---------------------------------------------------------------------------
// Critical resource bonuses (Habitat.cs 5087 / 5124)
// ---------------------------------------------------------------------------

// Habitat.cs RecalculateCriticalResourceSupplyFactors (5124).
export function recalculateCriticalResourceSupplyFactors(galaxy: Galaxy, h: Habitat): void {
    let num = 1.0;
    let num2 = 1.0;
    if (h.population != null && h.population.totalAmount > 0 && h.population.dominantRace !== null && h.empire !== null && h.empire !== galaxy.independentEmpire) {
        const num3 = 1.0;
        const num4 = 1.0;
        // TODO(port): completed ColonyIncome / ColonyPopulationGrowth wonders (PlanetaryFacility
        // model) — no facilities at game start.
        if (h.facilities !== null && h.facilities.length > 0) throw new Error('TODO(port): PlanetaryFacility model (Habitat.RecalculateCriticalResourceSupplyFactors)');
        num *= num4;
        num2 *= num3;
    }
    h.growthFactor = num;
    h.incomeFactor = num2;
}

// Habitat.cs RecalculateCriticalResourceSupplyBonuses (5087).
export function recalculateCriticalResourceSupplyBonuses(galaxy: Galaxy, h: Habitat): void {
    recalculateCriticalResourceSupplyFactors(galaxy, h);
    const resourceBonusList: Habitat['resourceBonuses'] = [];
    const dominantRace = h.population != null ? h.population.dominantRace : null;
    if (h.population != null && h.population.totalAmount > 0 && dominantRace !== null && h.empire !== null && h.empire !== galaxy.independentEmpire) {
        for (const resourceBonus of dominantRace.criticalResources) {
            if (resourceBonus.appliesOnlyToSources) {
                if (h.resources != null) {
                    // HabitatResourceList.IndexOf(resourceId, 0).
                    const num = h.resources.findIndex((r) => r.resourceId === resourceBonus.resourceId);
                    if (num >= 0) {
                        resourceBonusList.push({ resourceId: resourceBonus.resourceId, effect: resourceBonus.effect, value: resourceBonus.value, appliesOnlyToSources: resourceBonus.appliesOnlyToSources });
                    }
                }
                continue;
            }
            let num2 = 0;
            if (h.cargo !== null) {
                // CargoList.GetTotalResourceAvailable(resource, empireId) (541): Available = Amount - Reserved.
                const index = h.cargo.indexOf(new ResourceRef(resourceBonus.resourceId), h.empire);
                num2 = index >= 0 ? h.cargo.items[index].amount - h.cargo.items[index].reserved : 0;
            }
            if (num2 > 0) {
                resourceBonusList.push({ resourceId: resourceBonus.resourceId, effect: resourceBonus.effect, value: resourceBonus.value, appliesOnlyToSources: resourceBonus.appliesOnlyToSources });
            }
        }
    }
    h.resourceBonuses = resourceBonusList;
}

// Habitat.cs CalculateStrategicResourceSupplyGrowthFactor (7268).
export function calculateStrategicResourceSupplyGrowthFactor(galaxy: Galaxy, h: Habitat): number {
    let result = 1.0;
    if (h.cargo !== null && h.empire !== null) {
        let num = 0;
        let num2 = 0;
        for (const resourceDefinition of galaxy.resourceSystem.strategicResourcesOrderedByRelativeImportance) {
            if (resourceDefinition != null && resourceDefinition.colonyGrowthResourceLevel > 0) {
                num++;
                const index = h.cargo.indexOf(new ResourceRef(resourceDefinition.resourceId), h.empire);
                const cargo = index >= 0 ? h.cargo.items[index] : null;
                if (cargo !== null && cargo.amount - cargo.reserved > 0) num2++;
            }
        }
        result = num2 / num;
    }
    return result;
}

// ---------------------------------------------------------------------------
// Empire reputation / war weariness inputs (Empire.cs)
// ---------------------------------------------------------------------------

// TODO(port): Empire.Leader (Character) — none at game start (characters are generated at
// Start.2.cs 1483); Leader.ColonyHappiness / WarWeariness read as 0.
const leaderColonyHappiness = (_empire: Empire): number => 0;
// TODO(port): Habitat.Characters (CharacterList) GetHighestSkillLevelExcludeLeaders — none at game start.
const colonyCharactersHighestSkill = (_h: Habitat): number => 0;
// TODO(port): Empire._SpecialBonusHappiness (ReviewSpecialBonusesRuinsWonders, Empire.3.cs 939)
// — 0.0 until then (happiness ruins/wonders).
const specialBonusHappiness = (_empire: Empire): number => 0.0;

// Empire.cs WarWeariness (1405).
export function empireWarWeariness(empire: Empire): number {
    // TODO(port): Empire._WarWeariness (war model) — 0.0 at game start.
    const warWearinessRaw = 0.0;
    // C#: if (Leader != null) num = 1.0 + Leader.WarWeariness / 100.0 — Leader null at game start.
    const num = 1.0;
    void empire;
    return warWearinessRaw / num;
}

// Empire.cs CivilityRatingApprovalRaw (1450).
export function empireCivilityRatingApprovalRaw(galaxy: Galaxy, empire: Empire): number {
    let num = 0.0;
    // TODO(port): Empire._CivilityRating (Empire.8.cs reputation model) — 0.0 at game start.
    const civilityRating = 0.0;
    if (empire !== galaxy.independentEmpire) num = civilityRating / 5.0;
    const gov = empireGovernmentAttributes(empire);
    if (gov !== null && num < 0.0) num *= gov.concernForOwnReputation;
    return num;
}

// Empire.cs CalculateRacialReputationConcern (3104).
export function calculateRacialReputationConcern(race: { aggression: number; friendliness: number } | null): number {
    let result = 1.0;
    if (race != null) {
        result = race.aggression / race.friendliness;
        result = result * result * result * result * result;
        result = Math.max(1.0, result);
    }
    return result;
}

// ---------------------------------------------------------------------------
// Colony approval (Habitat.cs)
// ---------------------------------------------------------------------------

// Habitat.cs TaxApproval (474).
export function habitatTaxApproval(h: Habitat): number {
    let num = (0.15 - f32(h.taxRate)) * 100.0;
    if (num > 0.0) num *= 0.5;
    if (h.empire !== null) {
        const gov = empireGovernmentAttributes(h.empire);
        if (gov !== null && gov.specialFunctionCode === 1) num = -5.0;
    }
    return num;
}

// Habitat.cs RacialHappiness (491).
export function habitatRacialHappiness(galaxy: Galaxy, h: Habitat): number {
    const empire = h.empire;
    if (empire !== null && empire !== galaxy.independentEmpire && h.population != null && h.population.items.length > 0) {
        const dominantRace = h.population.dominantRace;
        if (dominantRace !== null && empire.dominantRace !== dominantRace) {
            // TODO(port): Empire.DetermineEmpiresWithDominantRace + ObtainEmpireEvaluation
            // (RacialOffense + SlaveryOffense), the Enslave/Exterminate policy caps and
            // Galaxy.ResolveStandardRaceBias — every game-start colony is of its empire's
            // dominant race, so this branch is not reached.
            throw new Error('TODO(port): Habitat.RacialHappiness for a foreign dominant race (EmpireEvaluation)');
        }
    }
    return 0.0;
}

// Habitat.cs CalculateExterminationConcern (5714).
export function calculateExterminationConcern(h: Habitat): number {
    let num = 0.0;
    if (h.population != null && h.population.items.length > 0) {
        let race = null;
        if (h.empire !== null && h.empire.dominantRace !== null) race = h.empire.dominantRace;
        if (race !== null) {
            for (const population of h.population.items) {
                if (population == null || population.race == null) continue;
                let colonyPopulationPolicy = 0; // Assimilate
                if (population.race !== race) {
                    colonyPopulationPolicy = h.colonyPopulationPolicy;
                    if (population.race.raceFamily === race.raceFamily) colonyPopulationPolicy = h.colonyPopulationPolicyRaceFamily;
                }
                if (colonyPopulationPolicy === POLICY_EXTERMINATE) {
                    const num2 = population.amount / 10000000.0;
                    num -= num2;
                }
            }
        }
        num = Math.min(0.0, Math.max(-20.0, num));
    }
    return num;
}

// Habitat.cs CalculatePopulationPolicyConcern(out, out) (5766).
export function calculatePopulationPolicyConcern(h: Habitat): number {
    let num = 0.0;
    if (h.empire !== null) {
        const exterminationConcern = calculateExterminationConcern(h);
        // TODO(port): Habitat.SlaveryBonusFactor (float, default 1f; slavery model).
        const slaveryBonusFactor = f32(1);
        let slaveryConcern = -1.0 * ((slaveryBonusFactor - 1.0) * 20.0);
        if (slaveryConcern < 0.0) slaveryConcern = Math.min(-5.0, Math.max(-20.0, slaveryConcern));
        num += exterminationConcern;
        num += slaveryConcern;
        num = Math.min(0.0, Math.max(-30.0, num));
    }
    return num;
}

// Habitat.cs ModifyApprovalValueByEmpireAttributes (5858).
export function modifyApprovalValueByEmpireAttributes(galaxy: Galaxy, h: Habitat, inputValue: number): number {
    let num = inputValue;
    const empire = h.empire;
    if (empire !== null && empire !== galaxy.independentEmpire) {
        let num2 = 0.0;
        const dominantRace = h.population != null ? h.population.dominantRace : null;
        // Race.SatisfactionModifier is an int in C#.
        if (dominantRace !== null) num2 = Math.trunc(dominantRace.satisfactionModifier) / 100.0;
        const gov = empireGovernmentAttributes(empire);
        if (num < 0.0) {
            if (gov !== null) num /= gov.approvalRating;
            num /= 1.0 + num2;
        } else {
            if (gov !== null) num *= gov.approvalRating;
            num *= 1.0 + num2;
        }
    }
    return num;
}

// Habitat.cs RaidEconomyDamageFactor (891).
export function raidEconomyDamageFactor(_h: Habitat): number {
    // TODO(port): Habitat.RaidCountdown (byte, pirate raids) — 0 at game start.
    const raidCountdown = 0;
    if (raidCountdown > 0) {
        let num = 1.0 - raidCountdown / 60.0;
        num *= 0.5;
        num += 0.5;
        num = Math.min(1.0, Math.max(0.5, num));
        return 1.0 - num;
    }
    return 0.0;
}

// Habitat.cs GetPlagueUnhappinessFactor (1869).
export function getPlagueUnhappinessFactor(_h: Habitat): number {
    // TODO(port): Habitat.PlagueId (short, default -1) / Galaxy.PlaguesStatic — no plague at game start.
    const plagueId = -1;
    if (plagueId >= 0) throw new Error('TODO(port): plagues (Habitat.GetPlagueUnhappinessFactor)');
    return 0.0;
}

// Habitat.cs EmpireApprovalRating (534).
export function empireApprovalRating(galaxy: Galaxy, h: Habitat): number {
    const empire = h.empire;
    const taxApproval = habitatTaxApproval(h);
    let inputValue = 0.0;
    // TODO(port): Empire._LeaderChangeInfluence (Empire.6.cs leader change) — 0.0 at game start.
    const leaderChangeInfluence = 0.0;
    if (empire !== null && leaderChangeInfluence !== 0.0) inputValue = leaderChangeInfluence * 20.0;
    let num = 0.0;
    let inputValue2 = 0.0;
    let num2 = 0.0;
    const dominantRace = h.population != null ? h.population.dominantRace : null;
    if (empire !== null && empire !== galaxy.independentEmpire) {
        num = empireWarWeariness(empire);
        const gov = empireGovernmentAttributes(empire);
        if (gov !== null && gov.warWeariness !== 0.0) num *= gov.warWeariness;
        // Race.WarWearinessAttenuation is an int in C#.
        if (dominantRace !== null && Math.trunc(dominantRace.warWearinessAttenuation) > 0) {
            const num3 = Math.trunc(dominantRace.warWearinessAttenuation) / 100.0;
            num *= 1.0 - num3;
        }
        const num4 = resourceBonusTotalByEffectType(h, ColonyResourceEffect.WarWearinessReduction) / 100.0;
        if (num4 > 0.0) num /= 1.0 + num4;
        // TODO(port): RaceEventType.TodashGalacticChampionships (*0.9) — no race event at game start.
        // Empire.Leader / Characters WarWeariness skill: none at game start (num /= 1.0).
        inputValue2 = empireCivilityRatingApprovalRaw(galaxy, empire);
        let num7 = 1.0;
        if (dominantRace !== null) num7 = calculateRacialReputationConcern(dominantRace);
        inputValue2 /= num7;
        num2 = calculatePopulationPolicyConcern(h);
    }
    const racialHappiness = habitatRacialHappiness(galaxy, h);
    // TODO(port): Habitat._WarWithOurRace (float, CalculateWarWithOurRace 5694) — 0f: no wars at game start.
    const warWithOurRace = f32(0);
    const inputValue3 = f32(h.damage) * -20.0;
    // TODO(port): Habitat._CulturalDistressFactor (float) — 0f at game start.
    const culturalDistressFactor = f32(0);
    // TODO(port): Habitat.ConqueredFactor (float, UpdateConqueredFactor) — 0f at game start.
    const conqueredFactor = f32(0);
    const num8 = modifyApprovalValueByEmpireAttributes(galaxy, h, inputValue);
    const num9 = modifyApprovalValueByEmpireAttributes(galaxy, h, habitatDevelopmentLevel(h) / 5.0);
    const num10 = modifyApprovalValueByEmpireAttributes(galaxy, h, taxApproval);
    const num11 = modifyApprovalValueByEmpireAttributes(galaxy, h, num * -0.3);
    const num12 = modifyApprovalValueByEmpireAttributes(galaxy, h, culturalDistressFactor * -1.0);
    const num13 = modifyApprovalValueByEmpireAttributes(galaxy, h, f32(h.happinessModifier));
    const num14 = modifyApprovalValueByEmpireAttributes(galaxy, h, inputValue2);
    const num15 = modifyApprovalValueByEmpireAttributes(galaxy, h, racialHappiness);
    const num16 = modifyApprovalValueByEmpireAttributes(galaxy, h, warWithOurRace);
    const num17 = modifyApprovalValueByEmpireAttributes(galaxy, h, inputValue3);
    const num18 = modifyApprovalValueByEmpireAttributes(galaxy, h, conqueredFactor);
    const inputValue4 = -15.0 * (1.0 - calculateStrategicResourceSupplyGrowthFactor(galaxy, h));
    const num19 = modifyApprovalValueByEmpireAttributes(galaxy, h, inputValue4);
    const inputValue5 = raidEconomyDamageFactor(h) * -20.0;
    const num20 = modifyApprovalValueByEmpireAttributes(galaxy, h, inputValue5);
    const plagueUnhappinessFactor = getPlagueUnhappinessFactor(h);
    const num21 = modifyApprovalValueByEmpireAttributes(galaxy, h, plagueUnhappinessFactor);
    let num22 = num8 + num12 + num9 + num13 + num10 + num11 + num14 + num2 + num15 + num16 + num17 + num18 + num19 + num20 + num21;
    num22 += resourceBonusTotalByEffectType(h, ColonyResourceEffect.Happiness);
    // TODO(port): RaceEventType.NepthysWineVintage (+5) — no race event at game start.
    let num23 = 0;
    num23 += colonyCharactersHighestSkill(h);
    if (empire !== null) num23 += leaderColonyHappiness(empire);
    const num24 = 1.0 + num23 / 100.0;
    num22 = !(num22 > 0.0) ? num22 / num24 : num22 * num24;
    if (empire !== null && empire !== galaxy.independentEmpire && specialBonusHappiness(empire) > 0.0) {
        if (num22 > 0.0) num22 *= 1.0 + specialBonusHappiness(empire);
        else if (num22 < 0.0) num22 /= 1.0 + specialBonusHappiness(empire);
    }
    // ColonyHappiness wonder (completed PlanetaryFacility) — TODO(port): facility model;
    // no facilities at game start (num25 = 0).
    if (h.facilities !== null && h.facilities.length > 0) throw new Error('TODO(port): PlanetaryFacility model (Habitat.EmpireApprovalRating)');
    return num22;
}

// Habitat.cs CalculateUnmodifiedApproval(value, subtractAdditives) (5798).
export function calculateUnmodifiedApproval(galaxy: Galaxy, h: Habitat, value: number, subtractAdditives = true): number {
    let num = 0;
    num += colonyCharactersHighestSkill(h);
    if (h.empire !== null) num += leaderColonyHappiness(h.empire);
    const num2 = 1.0 + num / 100.0;
    value = !(value > 0.0) ? value * num2 : value / num2;
    if (h.empire !== null && h.empire !== galaxy.independentEmpire && specialBonusHappiness(h.empire) > 0.0) {
        if (value > 0.0) value /= 1.0 + specialBonusHappiness(h.empire);
        else if (value < 0.0) value *= 1.0 + specialBonusHappiness(h.empire);
    }
    // ColonyHappiness wonder — TODO(port): facility model; none at game start (num3 = 0).
    if (h.facilities !== null && h.facilities.length > 0) throw new Error('TODO(port): PlanetaryFacility model (Habitat.CalculateUnmodifiedApproval)');
    if (subtractAdditives) {
        value -= resourceBonusTotalByEffectType(h, ColonyResourceEffect.Happiness);
        // TODO(port): RaceEventType.NepthysWineVintage (-5) — no race event at game start.
    }
    const num4 = modifyApprovalValueByEmpireAttributes(galaxy, h, value);
    value = num4;
    return value;
}

// Habitat.cs TaxComplianceRate (701).
export function taxComplianceRate(galaxy: Galaxy, h: Habitat): number {
    let num = (empireApprovalRating(galaxy, h) + 83.0) / 100.0;
    if (h.empire !== null && h.empire.pirateEmpireBaseHabitat !== null) num *= 0.75;
    return Math.max(0.0, Math.min(1.0, num));
}

// ---------------------------------------------------------------------------
// Empire tax / colony steps
// ---------------------------------------------------------------------------

// Empire.9.cs SetColonyTaxRate (5448).
export function setColonyTaxRate(galaxy: Galaxy, empire: Empire, colony: Habitat, atWar: boolean): void {
    const policy = empire.policy!; // C# dereferences Policy unguarded (NRE if null).
    let num = 1.0;
    if (empire.dominantRace !== null) {
        num += (1.0 - (empire.dominantRace.friendliness + empire.dominantRace.intelligence) / 200.0) / 2.0;
    }
    const num2 = 0.15;
    let num3 = f32(colony.taxRate);
    if (num3 <= 0.0) num3 = num2 * num;
    let num4 = 16.0;
    let num5 = 1;
    if (colony.population != null) {
        num5 = colony.population.totalAmount > 2000000000 ? policy.colonyTaxRateLargeColony : colony.population.totalAmount <= 200000000 ? policy.colonyTaxRateSmallColony : policy.colonyTaxRateMediumColony;
    }
    let num6 = -1.0;
    switch (num5) {
        case 0:
            num6 = 0.0;
            break;
        case 1:
            num4 = 25.0;
            break;
        case 2:
            num4 = 16.0;
            break;
        case 3:
            num4 = 10.0;
            break;
    }
    if (atWar && policy.colonyTaxRateIncreaseWhenAtWar && colony.population.totalAmount > 500000000) num4 = 8.0;
    // num7 (ColonyHappiness skill of colony characters + leader) is computed and discarded in C#.
    if (colony.population != null) {
        const approval = empireApprovalRating(galaxy, colony);
        if (approval < num4 && f32(colony.taxRate) <= 0) {
            num3 = 0.0;
        } else if (approval > num4 || f32(colony.taxRate) > 0) {
            const num8 = approval - num4;
            // num9 = -(TaxApproval - num8) is computed and discarded in C#.
            void habitatTaxApproval(colony);
            const num10 = calculateUnmodifiedApproval(galaxy, colony, num8, false);
            num3 = f32(colony.taxRate) + num10 / 100.0;
        }
        if (num6 >= 0.0) num3 = num6;
        // C#: `_ = colony.EmpireApprovalRating;` (discarded, side-effect free).
        const gov = empireGovernmentAttributes(empire);
        if (gov !== null && gov.specialFunctionCode === 1) num3 = 1.0;
    }
    const gov2 = empireGovernmentAttributes(empire);
    num3 = gov2 === null || gov2.specialFunctionCode !== 1 ? Math.max(0.0, Math.min(0.5, num3)) : Math.max(0.0, num3);
    num3 = netRound(num3, 2);
    if (Number.isNaN(num3)) num3 = 0.0;
    colony.taxRate = f32(num3);
    recalculateAnnualTaxRevenue(galaxy, colony);
}

// TODO(port): Habitat.CheckColonyRevenueFromPirateControl (pirate colony control) — none at game start.
const checkColonyRevenueFromPirateControl = (_h: Habitat, _empire: Empire): boolean => false;

// Empire.10.cs ReviewTaxes (158).
export function reviewTaxes(galaxy: Galaxy, empire: Empire): void {
    const atWar = checkAtWar(empire);
    for (let i = 0; i < empire.colonies.length; i++) {
        const habitat = empire.colonies[i];
        if (habitat != null && habitat.empire === empire) {
            if (empire.pirateEmpireBaseHabitat !== null && checkColonyRevenueFromPirateControl(habitat, empire)) {
                habitat.taxRate = 0;
            } else {
                setColonyTaxRate(galaxy, empire, habitat, atWar);
            }
        }
    }
}

// Empire.4.cs RecalculateEmpirePopulation (3448).
export function recalculateEmpirePopulation(empire: Empire): void {
    let num = 0;
    for (let i = 0; i < empire.colonies.length; i++) {
        const habitat = empire.colonies[i];
        if (habitat.population != null) habitat.population.recalculateTotalAmount();
        num += habitat.population.totalAmount;
    }
    empire.totalPopulation = num;
}

// Empire.4.cs RecalculateEmpireCorruption (3411).
export function recalculateEmpireCorruption(empire: Empire): void {
    let num = 0.0;
    const totalPopulation = empire.totalPopulation;
    let num2 = 10000000000;
    if (empire.pirateEmpireBaseHabitat !== null) num2 = 0;
    if (totalPopulation > num2) {
        const num3 = 300000000000;
        let num4 = 0.5;
        if (empire.pirateEmpireBaseHabitat !== null) num4 = 0.65;
        const num5 = totalPopulation - num2;
        const num6 = num3 - num2;
        let val = num5 / num6;
        val = Math.max(0.0, Math.min(1.0, val));
        let val2 = num4 * val;
        val2 = Math.min(num4, Math.max(0.0, val2));
        const num7 = num2 * 1.0 + num5 * (1.0 - val2);
        num = num7 / totalPopulation;
        num = 1.0 - num;
        // Empire.ColonyCorruptionFactor (Empire.cs 409) = Galaxy.ColonyCorruptionFactorDefault
        // (1.0) unless a difficulty setting changes it (same lookup as forceStructure.ts).
        num *= empire.difficultyFactors?.colonyCorruptionFactor ?? 1.0;
        num = Math.min(1.0, Math.max(0.0, num));
    }
    if (empire.economyEfficiency < 1.0) {
        num += 1.0 - empire.economyEfficiency;
        num = Math.min(1.0, Math.max(0.0, num));
    }
    empire.corruption = num;
}

// Galaxy.7.cs DetermineColonyBaseInfo (257).
export function determineColonyBaseInfo(colony: Habitat): { hasSpacePort: boolean; happinessModifier: number } {
    let hasSpacePort = false;
    let happinessModifier = 0.0;
    if (colony.basesAtHabitat == null || colony.basesAtHabitat.length <= 0) return { hasSpacePort, happinessModifier };
    for (const builtObject of colony.basesAtHabitat) {
        if (builtObject != null) {
            // (double)(int + int) / 30.0
            happinessModifier = Math.max(happinessModifier, ((builtObject.medicalCapacity + builtObject.recreationCapacity) | 0) / 30.0);
            if (isSpacePortSubRole(builtObject.subRole)) hasSpacePort = true;
        }
    }
    return { hasSpacePort, happinessModifier };
}

function isSpacePortSubRole(subRole: BuiltObjectSubRole): boolean {
    return subRole === BuiltObjectSubRole.SmallSpacePort || subRole === BuiltObjectSubRole.MediumSpacePort || subRole === BuiltObjectSubRole.LargeSpacePort;
}

// Habitat.cs CheckForSpacePortFacilities (2729).
export function checkForSpacePortFacilities(h: Habitat): void {
    h.hasSpacePort = false;
    if (h.population.totalAmount > 0) {
        const info = determineColonyBaseInfo(h);
        h.hasSpacePort = info.hasSpacePort;
        h.happinessModifier = f32(info.happinessModifier);
    } else {
        h.happinessModifier = 0;
    }
    if (h.basesAtHabitat == null || h.basesAtHabitat.length <= 0) return;
    for (const builtObject of h.basesAtHabitat) {
        if (builtObject != null && !builtObject.hasBeenDestroyed && isSpacePortSubRole(builtObject.subRole)) h.hasSpacePort = true;
    }
}

// Empire.4.cs CheckColoniesForBaseFacilities (2570).
export function checkColoniesForBaseFacilities(empire: Empire): void {
    for (let i = 0; i < empire.colonies.length; i++) {
        checkForSpacePortFacilities(empire.colonies[i]);
    }
}

// ---------------------------------------------------------------------------
// Game-start sequences (Start.2.cs), for wiring into createGame.
// ---------------------------------------------------------------------------

// Start.2.cs 1109-1115 (per empire, inside the empireList loop after galaxy.DoTasks).
export function gameStartColonyRecalc(galaxy: Galaxy, empire: Empire): void {
    recalculateEmpirePopulation(empire);
    checkColoniesForBaseFacilities(empire);
    recalculateEmpireCorruption(empire);
    recalculateColonyTaxRevenuesLocal(galaxy, empire);
}

// Start.2.cs 1318-1339 (per empire, after SetLuxuryResourcesAtColonies).
// galaxyAge: C# int_5 (CreateGameFromSettings' galaxy age parameter).
export function gameStartReviewTaxes(galaxy: Galaxy, empire: Empire, galaxyAge: number): void {
    for (let num33 = 0; num33 < 1; num33++) {
        reviewTaxes(galaxy, empire);
        recalculateColonyTaxRevenuesLocal(galaxy, empire);
    }
    recalculateEmpirePopulation(empire);
    for (const colony of empire.colonies) {
        if (galaxyAge > 0) {
            // TODO(port): Empire.ProcessColonyTroops(colony, null, 0.0, 100.0, 100.0) and twice
            // (…, 300.0, 300.0) (Empire.4.cs 3462) — troop model; ported separately.
        }
        recalculateAnnualTaxRevenue(galaxy, colony);
    }
    reviewTaxes(galaxy, empire);
    for (const colony2 of empire.colonies) recalculateAnnualTaxRevenue(galaxy, colony2);
}

// Empire.10.cs RecalculateColonyTaxRevenues (43) (same as forceStructure.ts's; local to
// avoid depending on re-export initialization order).
function recalculateColonyTaxRevenuesLocal(galaxy: Galaxy, empire: Empire): void {
    for (let i = 0; i < empire.colonies.length; i++) {
        const habitat = empire.colonies[i];
        if (habitat != null && habitat.empire === empire) recalculateAnnualTaxRevenue(galaxy, habitat);
    }
}
