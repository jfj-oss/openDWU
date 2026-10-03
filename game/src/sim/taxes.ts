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
// - Empire.Leader / Habitat.Characters: read through characters.ts (none before Start.2.cs 1483).
// - Empire._WarWeariness 0, _CivilityRating 0, _LeaderChangeInfluence 0,
//   _SpecialBonusHappiness 0 (ReviewSpecialBonusesRuinsWonders — TODO(port)).
// - Habitat: _WarWithOurRace 0f (no wars), _CulturalDistressFactor 0f, ConqueredFactor 0f,
//   RaceEventType Undefined, PlagueId -1, RaidCountdown 0, SlaveryBonusFactor 1f,
//   _RestrictedResourcesPresent false, WonderForDevelopment null (no facilities),
//   BaconValues null.
// - DiplomaticRelations empty → CheckAtWar false; no pirate colony control.

import { RaceEventType, getPlagueUnhappinessFactorWithPlague } from './eventTypes';
import { processColonyTroops } from './troops';
import { CharacterSkillType, colonyCharactersHighestSkillExcludeLeaders, resolveColonyWarWearinessDivisors, resolveEmpireLeaderWarWearinessDivisor, resolveLeaderColonyHappiness } from './characters';
import type { Galaxy } from './galaxy';
import type { Habitat } from './types';
import { checkColonyRevenueFromPirateControl } from './pirates/pirateColonyControl';
import type { Race } from './data/races';
import { raceAggressionLevel, raceFriendlinessLevel } from './racePeriodic';
import { resolveStandardRaceBias } from './raceBias';
import { Empire, empireGovernmentAttributes, registerTakeOwnershipOfColonyHooks } from './empire';
import { BuiltObjectSubRole } from './builtObjectTypes';
import { ResourceRef } from './cargo';
import { checkAtWar, recalculateAnnualTaxRevenue, recalculateDistanceFactor } from './forceStructure';
import { ColonyResourceEffect, habitatDevelopmentLevel, resourceBonusTotalByEffectType } from './developmentLevel';
import { PlanetaryFacilityType, WonderType } from './researchSystem';

export { recalculateColonyTaxRevenues } from './forceStructure';
export { ColonyResourceEffect, habitatDevelopmentLevel, recalculateDevelopmentLevelBaseline, resourceBonusTotalByEffectType } from './developmentLevel';

const f32 = Math.fround;

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

// ColonyResourceEffect, GetBonusTotalByEffectType, RecalculateDevelopmentLevelBaseline and
// the DevelopmentLevel property live in developmentLevel.ts (cycle-free; used by
// empire.ts / colony.ts / territory.ts) and are re-exported here.

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
        let num3v = num3;
        let num4v = num4;
        // Completed ColonyIncome / ColonyPopulationGrowth wonders (Habitat.cs 5132-5149; facility model: M4i).
        if (h.facilities !== null && h.facilities.length > 0) {
            for (let i = 0; i < h.facilities.length; i++) {
                const planetaryFacility = h.facilities[i];
                if (planetaryFacility !== null && planetaryFacility.constructionProgress >= 1 && planetaryFacility.type === PlanetaryFacilityType.Wonder) {
                    switch (planetaryFacility.wonderType) {
                        case WonderType.ColonyIncome:
                            num3v = Math.max(num3v, 1.0 + planetaryFacility.value2 / 100.0);
                            break;
                        case WonderType.ColonyPopulationGrowth:
                            num4v = Math.max(num4v, 1.0 + planetaryFacility.value2 / 100.0);
                            break;
                    }
                }
            }
        }
        num *= num4v;
        num2 *= num3v;
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

// Empire.Leader.ColonyHappiness (Habitat.cs 621-624 / 5805-5808; characters.ts).
const leaderColonyHappiness = (empire: Empire): number => resolveLeaderColonyHappiness(empire);
// Habitat.cs 617-620 / 5801-5804: Characters.GetHighestSkillLevelExcludeLeaders(ColonyHappiness) when
// Characters non-empty, else 0.
const colonyCharactersHighestSkill = (h: Habitat): number => colonyCharactersHighestSkillExcludeLeaders(h, CharacterSkillType.ColonyHappiness);
// Empire._SpecialBonusHappiness (ReviewSpecialBonusesRuinsWonders, Empire.3.cs 939; treasury.ts).
const specialBonusHappiness = (empire: Empire): number => empire.specialBonusHappiness;

// Empire.cs WarWeariness (1405).
export function empireWarWeariness(empire: Empire): number {
    // Empire.cs 580 _WarWeariness (EvaluatePoliticalSituation, diplomacyTick.ts).
    const warWearinessRaw = empire.warWearinessRaw;
    // Empire.cs 1409-1413: if (Leader != null) num = 1.0 + Leader.WarWeariness / 100.0.
    const num = resolveEmpireLeaderWarWearinessDivisor(empire);
    return warWearinessRaw / num;
}

// Empire.cs CivilityRatingApprovalRaw (1450).
export function empireCivilityRatingApprovalRaw(galaxy: Galaxy, empire: Empire): number {
    let num = 0.0;
    // Empire.cs 578 _CivilityRating (reputation model, diplomacyTick.ts).
    const civilityRating = empire.civilityRating;
    if (empire !== galaxy.independentEmpire) num = civilityRating / 5.0;
    const gov = empireGovernmentAttributes(empire);
    if (gov !== null && num < 0.0) num *= gov.concernForOwnReputation;
    return num;
}

// Empire.cs CalculateRacialReputationConcern (3104). Race.AggressionLevel / FriendlinessLevel are the periodic levels
// while the race's change period is active (Race.cs 350-400).
export function calculateRacialReputationConcern(galaxy: Galaxy, race: Race | null): number {
    let result = 1.0;
    if (race != null) {
        result = raceAggressionLevel(galaxy, race) / raceFriendlinessLevel(galaxy, race);
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

// EmpireEvaluation.cs / Empire.4.cs ObtainEmpireEvaluation (106): the full model lives in diplomacy.ts (M4r).
import { obtainEmpireEvaluation } from './diplomacy';
import { scenarioApprovalRating } from './scenario/stability';
export { EmpireEvaluation, obtainEmpireEvaluation } from './diplomacy';

// Empire.2.cs DetermineEmpiresWithDominantRace (3460).
export function determineEmpiresWithDominantRace(galaxy: Galaxy, race: Race | null): Empire[] {
    const empireList: Empire[] = [];
    for (let i = 0; i < galaxy.empires.length; i++) {
        const empire = galaxy.empires[i];
        if (empire != null && empire.dominantRace === race) empireList.push(empire);
    }
    return empireList;
}

// Habitat.cs RacialHappiness (495).
export function habitatRacialHappiness(galaxy: Galaxy, h: Habitat): number {
    const empire = h.empire;
    if (empire !== null && empire !== galaxy.independentEmpire && h.population != null && h.population.items.length > 0) {
        const dominantRace = h.population.dominantRace;
        if (dominantRace !== null && empire.dominantRace !== dominantRace) {
            let num = 0.0;
            const empireList = determineEmpiresWithDominantRace(galaxy, dominantRace);
            if (empireList != null && empireList.length > 0) {
                const empireEvaluation = obtainEmpireEvaluation(galaxy, empire, empireList[0]);
                num = empireEvaluation.racialOffense + empireEvaluation.slaveryOffense;
            }
            let colonyPopulationPolicy = h.colonyPopulationPolicy;
            // C# dereferences Empire.DominantRace unguarded here.
            if (dominantRace.raceFamily === empire.dominantRace!.raceFamily) colonyPopulationPolicy = h.colonyPopulationPolicyRaceFamily;
            switch (colonyPopulationPolicy) {
                case POLICY_ENSLAVE:
                    num = Math.min(num, -25.0);
                    break;
                case POLICY_EXTERMINATE:
                    num = Math.min(num, -50.0);
                    break;
            }
            const num2 = resolveStandardRaceBias(dominantRace, empire.dominantRace);
            return Math.min(num2 * 0.5, num * 0.5);
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
        // Habitat.SlaveryBonusFactor (float; ReviewColonyPopulationPolicy, colonyTick.ts).
        const slaveryBonusFactor = f32(h.slaveryBonusFactor);
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

// Habitat.cs RaidEconomyDamageFactor (891); Habitat.RaidCountdown (byte) is set by pirate raids (pirates/pirateAI.ts).
export function raidEconomyDamageFactor(h: Habitat): number {
    const raidCountdown = h.raidCountdown;
    if (raidCountdown > 0) {
        let num = 1.0 - raidCountdown / 60.0;
        num *= 0.5;
        num += 0.5;
        num = Math.min(1.0, Math.max(0.5, num));
        return 1.0 - num;
    }
    return 0.0;
}

// Habitat.cs GetPlagueUnhappinessFactor (1869) — events.ts (M4u).
export function getPlagueUnhappinessFactor(galaxy: Galaxy, _h: Habitat): number {
    return getPlagueUnhappinessFactorWithPlague(galaxy, _h).result;
}

// Habitat.cs EmpireApprovalRating (534). Mod layer: the scenario stability terms (scenario/stability.ts) follow the stock value.
export function empireApprovalRating(galaxy: Galaxy, h: Habitat): number {
    const v = empireApprovalRatingStock(galaxy, h);
    return galaxy.scenario !== null ? scenarioApprovalRating(galaxy, v, h) : v;
}

/** Habitat.cs EmpireApprovalRating (534) without the mod layer's terms (the 19m stability ledger's "base" entry). */
export function empireApprovalRatingStock(galaxy: Galaxy, h: Habitat): number {
    const empire = h.empire;
    const taxApproval = habitatTaxApproval(h);
    let inputValue = 0.0;
    // Empire.LeaderChangeInfluence (Empire.6.cs 5084 ProcessLeaderChangeInfluence; characterRuntime.ts).
    if (empire !== null && empire.leaderChangeInfluence !== 0.0) inputValue = empire.leaderChangeInfluence * 20.0;
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
        if (h.raceEventType === RaceEventType.TodashGalacticChampionships) num *= 0.9;
        // Habitat.cs 567-578: Empire.Leader.WarWeariness, then Characters (excluding leaders) WarWeariness.
        const wwDivisors = resolveColonyWarWearinessDivisors(h);
        if (wwDivisors.leaderDivisor !== null) num /= wwDivisors.leaderDivisor;
        if (wwDivisors.charactersDivisor !== null) num /= wwDivisors.charactersDivisor;
        inputValue2 = empireCivilityRatingApprovalRaw(galaxy, empire);
        let num7 = 1.0;
        if (dominantRace !== null) num7 = calculateRacialReputationConcern(galaxy, dominantRace);
        inputValue2 /= num7;
        num2 = calculatePopulationPolicyConcern(h);
    }
    const racialHappiness = habitatRacialHappiness(galaxy, h);
    // Habitat._WarWithOurRace (float, CalculateWarWithOurRace 5694; colonyTick.ts).
    const warWithOurRace = f32(h.warWithOurRace);
    const inputValue3 = f32(h.damage) * -20.0;
    // Habitat._CulturalDistressFactor (float; written by ExertCulturalInfluence, exploration.ts — 0f at game start).
    const culturalDistressFactor = f32(h.culturalDistressFactor);
    // Habitat.ConqueredFactor (float, UpdateConqueredFactor; colonyTick.ts).
    const conqueredFactor = f32(h.conqueredFactor);
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
    const plagueUnhappinessFactor = getPlagueUnhappinessFactor(galaxy, h);
    const num21 = modifyApprovalValueByEmpireAttributes(galaxy, h, plagueUnhappinessFactor);
    let num22 = num8 + num12 + num9 + num13 + num10 + num11 + num14 + num2 + num15 + num16 + num17 + num18 + num19 + num20 + num21;
    num22 += resourceBonusTotalByEffectType(h, ColonyResourceEffect.Happiness);
    if (h.raceEventType === RaceEventType.NepthysWineVintage) num22 += 5.0;
    let num23 = 0;
    num23 += colonyCharactersHighestSkill(h);
    if (empire !== null) num23 += leaderColonyHappiness(empire);
    const num24 = 1.0 + num23 / 100.0;
    num22 = !(num22 > 0.0) ? num22 / num24 : num22 * num24;
    if (empire !== null && empire !== galaxy.independentEmpire && specialBonusHappiness(empire) > 0.0) {
        if (num22 > 0.0) num22 *= 1.0 + specialBonusHappiness(empire);
        else if (num22 < 0.0) num22 /= 1.0 + specialBonusHappiness(empire);
    }
    // Habitat.cs 638-660: ColonyHappiness wonder (completed PlanetaryFacility; facility model: M4i).
    const num25 = colonyHappinessWonderFactor(h);
    if (num25 > 0.0) {
        if (num22 > 0.0) num22 *= 1.0 + num25;
        else if (num22 < 0.0) num22 /= 1.0 + num25;
    }
    return num22;
}

/** Habitat.cs 638-649 / 5822-5832: Value2 / 100 of the last completed ColonyHappiness wonder (0 when none). */
function colonyHappinessWonderFactor(h: Habitat): number {
    let num = 0.0;
    if (h.facilities !== null && h.facilities.length > 0) {
        for (let i = 0; i < h.facilities.length; i++) {
            const planetaryFacility = h.facilities[i];
            if (planetaryFacility !== null && planetaryFacility.constructionProgress >= 1 && planetaryFacility.type === PlanetaryFacilityType.Wonder && planetaryFacility.wonderType === WonderType.ColonyHappiness) {
                num = planetaryFacility.value2 / 100.0;
            }
        }
    }
    return num;
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
    // Habitat.cs 5822-5843: ColonyHappiness wonder (facility model: M4i).
    const num3 = colonyHappinessWonderFactor(h);
    if (num3 > 0.0) {
        if (value > 0.0) value /= 1.0 + num3;
        else if (value < 0.0) value *= 1.0 + num3;
    }
    if (subtractAdditives) {
        value -= resourceBonusTotalByEffectType(h, ColonyResourceEffect.Happiness);
        if (h.raceEventType === RaceEventType.NepthysWineVintage) value -= 5.0;
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
        num += (1.0 - (raceFriendlinessLevel(galaxy, empire.dominantRace) + empire.dominantRace.intelligence) / 200.0) / 2.0; // Race.FriendlinessLevel (periodic)
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
            // Start.2.cs 1326-1328 → Empire.4.cs ProcessColonyTroops (troops.ts).
            processColonyTroops(galaxy, empire, colony, null, 0.0, 100.0, 100.0, galaxy.difficultyLevel);
            processColonyTroops(galaxy, empire, colony, null, 0.0, 300.0, 300.0, galaxy.difficultyLevel);
            processColonyTroops(galaxy, empire, colony, null, 0.0, 300.0, 300.0, galaxy.difficultyLevel);
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

// Empire.1.cs TakeOwnershipOfColony 240/241/269 callees (see empire.ts
// registerTakeOwnershipOfColonyHooks; registered here to avoid an import cycle).
registerTakeOwnershipOfColonyHooks({
    recalculateDistanceFactor: (galaxy, colony) => recalculateDistanceFactor(galaxy, colony),
    setColonyTaxRate: (galaxy, empire, colony, atWar) => setColonyTaxRate(galaxy, empire, colony, atWar),
    recalculateAnnualTaxRevenue: (galaxy, colony) => recalculateAnnualTaxRevenue(galaxy, colony),
});
