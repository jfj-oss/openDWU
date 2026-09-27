// M4j — colony growth, happiness, migration factor, terraforming, damage regeneration, colony variables.
//
// Ports (C# file:line above each function):
//   Habitat.cs  GrowPopulation 5172, GetPolicyForPopulation 5158, CalculateWarWithOurRace 5694, UpdateConqueredFactor
//               1599, CalculateMigrationFactor 1162, CheckSatisfaction 5992, RegenerateDamage 2485
//   BaconHabitat.cs  TerraformColony 243, HugeProcessingSpanActions 434 (economy parts: UpdatePlanetMarketCash 455,
//               UpdatePlanetResourcePrices 497, CreatePlanetResourcePriceList 520, CalculateResourcePriceEnvironmental-
//               Factors 538, ChechAIShouldInvestInInfrastructure 887, InvestInInfastructure 920, DecayInfrastructure 964,
//               DecayPirateBase 984)
//   Empire.4.cs EvaluateColonyVariables 2943, EvaluateColonyVariablesPirate 2579, CalculateColonyGrowthRateMultiplier 3308
//   Empire.2.cs ReviewColonyPopulationPolicy 3198, IdentifyBestNewPenalColonies 3439
//   Galaxy.cs   ReviewColonyFillFactor 3020, ReviewRacePeriodicChanges 3425
//
// Rnd: CheckSatisfaction draws Galaxy.Rnd.Next(0, 3) (Habitat.cs 6027); ProcessColonyTroops (troops.ts, recruitment on)
// draws per recruit. The Bacon market-price noise uses clock-seeded `new Random()` in C# — here
// galaxy.baconHabitatClockRnd (derived from the galaxy seed, plan §0; never touches Galaxy.Rnd).

import { RaceEventType } from './eventTypes';
import type { Galaxy } from './galaxy';
import { galaxyRace } from './galaxy';
import type { Empire } from './empire';
import { Habitat, HabitatType, recalculateMaximumPopulation } from './types';
import type { Race } from './data/races';
import type { BuiltObject } from './builtObject';
import { Population } from './population';
import { Random } from './random';
import { REAL_SECONDS_IN_GALACTIC_YEAR, galaxyStarDate } from './tick/simTime';
import { DiplomaticRelationType } from './diplomacy';
import { ColonyPopulationPolicy } from './data/policies';
import { ResourceGroup, resourceGroupOf } from './resourceSystem';
import {
    calculateStrategicResourceSupplyGrowthFactor,
    determineEmpiresWithDominantRace,
    empireApprovalRating,
    habitatTaxApproval,
    obtainEmpireEvaluation,
    recalculateCriticalResourceSupplyBonuses,
} from './taxes';
import { ColonyResourceEffect, convertToInt32, resourceBonusTotalByEffectType } from './developmentLevel';
import { empireGovernmentAttributes } from './empire';
import {
    annualFacilityMaintenance,
    annualPirateProtection,
    annualStateMaintenance,
    annualSubjugationTribute,
    calculateAccurateAnnualIncome,
    checkAtWar,
    habitatAnnualRevenue,
    recalculateAnnualTaxRevenue,
} from './forceStructure';
import { generateNewTroop, identifyStrongestRaceAttackTroop, minimumShipSpending, processColonyTroopsFull } from './troops';
import { TroopType, type Troop } from './cargo';
import { CharacterEventType, CharacterRole, getCharactersByRole, resolveLocationsToDefend, stellarObjectCharacters, type Character } from './characters';
import { EmpireMessageType, sendMessageToEmpire, sendMessageToEmpireWithTitle } from './messages';
import { doCharacterEventRuntime, doPlanetRemove, leaveEmpire } from './events';
import { clearColony } from './combat/invasion';
import { baconHabitatHandlePrisoners } from './combat/troopsRuntime';
import { countResourceSupplyLocations } from './logistics/orders';
import {
    calculateMaximumOrderFulfillmentDistanceForHabitat,
    maintainColonyCriticalResourceLevels,
    maintainColonyResourceLevels,
    orderColonyLuxuryResources,
    calculateMinimumLuxuryResourceLevel,
    calculateMinimumLuxuryResourceLevelRestricted,
    prepareColonyLuxuryResourceLists,
} from './logistics/colonySupply';
import { netSort } from './netSort';
import { PlanetaryFacilityType } from './researchSystem';
import { facilitiesFindBestPirateFacility } from './construction/facilities';
import { baconSettings } from './data/baconSettings';
import { formatGameTextNow } from './textResolver';
import { scenarioQuery } from './scenario/hooks';

const f32 = Math.fround;

// ---------------------------------------------------------------------------
// Constants (Galaxy.3.cs InitializeStatics)
// ---------------------------------------------------------------------------

/** Galaxy.3.cs 5020 MinimumHabitatPopulationAmount = 1000000L. */
export const MINIMUM_HABITAT_POPULATION_AMOUNT = 1000000;
/** Galaxy.3.cs 5094 ColonyDevelopmentLevelMaximumAnnualChange = 25. */
export const COLONY_DEVELOPMENT_LEVEL_MAXIMUM_ANNUAL_CHANGE = 25;
/** Galaxy.3.cs 5121 HabitatDamageAnnualRegeneration = 0.02. */
export const HABITAT_DAMAGE_ANNUAL_REGENERATION = 0.02;
/** Galaxy.3.cs 5012-5014 TroopStrengthAnnualNeutralizationAmount / TroopSizeAnnualRegenerationAmount / TroopAnnualRecruitmentAmount. */
const TROOP_STRENGTH_ANNUAL_NEUTRALIZATION_AMOUNT = 1;
const TROOP_SIZE_ANNUAL_REGENERATION_AMOUNT = 50;
const TROOP_ANNUAL_RECRUITMENT_AMOUNT = 150;

/** TextResolver.GetText + string.Format stand-in: GameText key and format args (M9 localizes). */
export function gameText(key: string, ...args: unknown[]): string {
    return args.length > 0 ? `${key}|${args.map((a) => String(a)).join('|')}` : key;
}

// ---------------------------------------------------------------------------
// Race properties the TS Race data does not model (Race.cs)
// ---------------------------------------------------------------------------

/** Race.cs 1649 ParseDoubleValue (double.Parse, invariant culture). */
function raceExtraDouble(race: Race, key: string, fallback: number): number {
    const raw = race.extra?.[key];
    if (raw === undefined) return fallback;
    return Number(raw.trim());
}

/** Race.cs ParseIntValue for keys kept in Race.extra (fallback when absent / unparsable). */
function raceExtraInt(race: Race, key: string, fallback: number): number {
    const raw = race.extra?.[key];
    if (raw === undefined) return fallback;
    const n = parseInt(raw.trim(), 10);
    return Number.isNaN(n) ? fallback : n;
}

/** Race.cs 222 MigrationFactor = 1.0 (file value clamped to [0.2, 5.0], Race.cs 1588). */
export function raceMigrationFactor(race: Race): number {
    if (race.extra?.['MigrationFactor'] === undefined) return 1.0;
    return Math.min(5.0, Math.max(0.2, raceExtraDouble(race, 'MigrationFactor', 1.0)));
}

/** Race.cs 210 ColonyPopulationPolicyGrowthFactorExterminate = 1.0 (clamped to [0.2, 5.0], Race.cs 1573). */
export function raceColonyPopulationPolicyGrowthFactorExterminate(race: Race): number {
    if (race.extra?.['ColonyPopulationPolicyGrowthFactorExterminate'] === undefined) return 1.0;
    return Math.min(5.0, Math.max(0.2, raceExtraDouble(race, 'ColonyPopulationPolicyGrowthFactorExterminate', 1.0)));
}

/** Race.cs 121 ChangePeriodYearsInterval ("PeriodicChangeInterval", Race.cs 1343). */
export function raceChangePeriodYearsInterval(race: Race): number {
    return raceExtraInt(race, 'PeriodicChangeInterval', 0);
}

/** Race.cs 123 ChangePeriodYearsLength ("PeriodicChangeLength", Race.cs 1346). */
export function raceChangePeriodYearsLength(race: Race): number {
    return raceExtraInt(race, 'PeriodicChangeLength', 0);
}

/** Race.cs 306 ChangePeriodActive (per galaxy, see Galaxy.raceChangePeriodActive). */
export function raceChangePeriodActive(galaxy: Galaxy, race: Race): boolean {
    return galaxy.raceChangePeriodActive.has(race);
}

/** Race.cs 111 PeriodicGrowthRate = 1.0 (file value clamped to [1.0, 2.0], Race.cs 1349). */
function racePeriodicGrowthRate(race: Race): number {
    if (race.extra?.['PeriodicFactorsGrowth'] === undefined) return 1.0;
    return Math.max(1.0, Math.min(raceExtraDouble(race, 'PeriodicFactorsGrowth', 1.0), 2.0));
}

/** Race.cs 113-117 PeriodicAggression/Caution/FriendlinessLevel = 100 (file values clamped to [50, 200]). */
function racePeriodicLevel(race: Race, key: string): number {
    if (race.extra?.[key] === undefined) return 100;
    return Math.max(50, Math.min(raceExtraInt(race, key, 100), 200));
}

/**
 * Race.cs 320 ReproductiveRate: PeriodicGrowthRate while ChangePeriodActive, else _ReproductiveRate.
 * TODO(port) M4j: the other ChangePeriodActive-dependent Race properties (CautionLevel, FriendlinessLevel —
 * Race.cs 366-400) are still read directly from the race data elsewhere in src/sim.
 */
export function raceReproductiveRate(galaxy: Galaxy, race: Race): number {
    return raceChangePeriodActive(galaxy, race) ? racePeriodicGrowthRate(race) : race.reproductionRate;
}

/** Race.cs 348 AggressionLevel (PeriodicAggressionLevel while ChangePeriodActive). */
export function raceAggressionLevel(galaxy: Galaxy, race: Race): number {
    return raceChangePeriodActive(galaxy, race) ? racePeriodicLevel(race, 'PeriodicFactorsAggression') : race.aggression;
}

/** Race.cs 368 CautionLevel (PeriodicCautionLevel while ChangePeriodActive). */
export function raceCautionLevel(galaxy: Galaxy, race: Race): number {
    return raceChangePeriodActive(galaxy, race) ? racePeriodicLevel(race, 'PeriodicFactorsCaution') : race.caution;
}

/** Race.cs 384 FriendlinessLevel (PeriodicFriendlinessLevel while ChangePeriodActive). */
export function raceFriendlinessLevel(galaxy: Galaxy, race: Race): number {
    return raceChangePeriodActive(galaxy, race) ? racePeriodicLevel(race, 'PeriodicFactorsFriendliness') : race.friendliness;
}

/**
 * Race.cs 119 PeriodicRaceEvent (RaceEventType, default Undefined): races.txt "PeriodicChangeCycleEvent", kept only
 * when Enum.IsDefined(typeof(RaceEventType), (byte)value) (Race.cs 1360-1367).
 */
export function racePeriodicRaceEvent(race: Race): RaceEventType {
    const b11 = raceExtraInt(race, 'PeriodicChangeCycleEvent', 0) & 0xff;
    return RaceEventType[b11] !== undefined ? (b11 as RaceEventType) : RaceEventType.Undefined;
}

// ---------------------------------------------------------------------------
// Habitat helpers
// ---------------------------------------------------------------------------

/** Habitat.cs 5158 GetPolicyForPopulation(race, empireDominantRace). */
export function getPolicyForPopulation(habitat: Habitat, race: Race | null, empireDominantRace: Race | null): ColonyPopulationPolicy {
    let result = ColonyPopulationPolicy.Assimilate;
    if (race !== empireDominantRace && race !== null && empireDominantRace !== null) {
        result = habitat.colonyPopulationPolicy;
        if (race.raceFamily === empireDominantRace.raceFamily) {
            result = habitat.colonyPopulationPolicyRaceFamily;
        }
    }
    return result;
}

/** Habitat.RecalculateQuality — the TS Quality is a live getter (types.ts); kept as a no-op to mirror the call order. */
function recalculateQuality(_habitat: Habitat): void {}

// ---------------------------------------------------------------------------
// Habitat.DoTasks entry points (tick/habitatTick.ts)
// ---------------------------------------------------------------------------

/**
 * Galaxy.cs 944 ColonyFillFactor (_ColonyFillFactor, default 1.0; maintained by reviewColonyFillFactor). Added by M4r
 * (CalculateNextAllowableProposalDate reads it).
 */
export function galaxyColonyFillFactor(galaxy: Galaxy): number {
    return galaxy.colonyFillFactor;
}

/** Habitat.cs 5694 CalculateWarWithOurRace. */
export function calculateWarWithOurRace(galaxy: Galaxy, habitat: Habitat): void {
    habitat.warWithOurRace = 0;
    const empire = habitat.empire;
    const dominantRace = habitat.population != null ? habitat.population.dominantRace : null;
    if (empire === null || habitat.population == null || dominantRace === null || empire === galaxy.independentEmpire) {
        return;
    }
    let num = (dominantRace.loyalty + raceAggressionLevel(galaxy, dominantRace)) / 200.0;
    num *= num;
    num *= 10.0;
    let num2 = 1.0;
    for (let i = 0; i < empire.diplomaticRelations.count; i++) {
        const diplomaticRelation = empire.diplomaticRelations.at(i);
        if (diplomaticRelation.type === DiplomaticRelationType.War && diplomaticRelation.otherEmpire!.dominantRace === dominantRace) {
            const civility = diplomaticRelation.otherEmpire!.civilityRating;
            num2 = 1.0 + (Math.sqrt(Math.abs(civility)) / 10.0) * Math.sign(civility);
            num2 = Math.max(0.1, Math.min(1.5, num2));
            habitat.warWithOurRace = f32(habitat.warWithOurRace - f32(num * num2));
            break;
        }
    }
}

/** Habitat.cs 5172 GrowPopulation(TimeSpan timePassed) — the span in seconds. */
export function growPopulation(galaxy: Galaxy, habitat: Habitat, timePassedSeconds: number): void {
    if (habitat.plagueId >= 0 || !(habitat.plagueTimeRemaining <= 0)) {
        return;
    }
    const items = habitat.population.items;
    let num = 0;
    for (let i = 0; i < items.length; i++) {
        num += items[i].amount;
    }
    if (num < habitat.maxPopulation) {
        for (let j = 0; j < items.length; j++) {
            const population2 = items[j];
            if (habitat.empire === galaxy.independentEmpire && population2.race != null) {
                // 1f + ((float)Race.ReproductiveRate - 1f) / 3f
                population2.growthRate = f32(1 + f32(f32(f32(raceReproductiveRate(galaxy, population2.race)) - 1) / 3));
            }
            let num2 = population2.growthRate - 1.0;
            if (num2 < 0.0) {
                num2 = 0.0;
            }
            const num3 = Math.trunc(population2.amount * (num2 * (timePassedSeconds / REAL_SECONDS_IN_GALACTIC_YEAR)));
            population2.amount += num3;
            if (population2.amount < MINIMUM_HABITAT_POPULATION_AMOUNT) {
                let empireDominantRace: Race | null = null;
                if (habitat.empire !== null && habitat.empire !== galaxy.independentEmpire) {
                    empireDominantRace = habitat.empire.dominantRace;
                }
                const policy = getPolicyForPopulation(habitat, population2.race, empireDominantRace);
                if (policy === ColonyPopulationPolicy.Resettle || policy === ColonyPopulationPolicy.Exterminate) {
                    continue;
                }
                population2.amount = MINIMUM_HABITAT_POPULATION_AMOUNT;
            }
        }
        habitat.population.recalculateTotalAmount();
    }
    if (num > habitat.maxPopulation) {
        const num4 = habitat.maxPopulation / num;
        for (let k = 0; k < items.length; k++) {
            const population3 = items[k];
            population3.amount = Math.trunc(population3.amount * num4);
        }
        habitat.population.recalculateTotalAmount();
    }
}

/** Habitat.cs 2485 RegenerateDamage(timePassed). */
export function regenerateDamage(galaxy: Galaxy, habitat: Habitat, timePassed: number): void {
    if (habitat.damage > 0) {
        let num = HABITAT_DAMAGE_ANNUAL_REGENERATION * (timePassed / REAL_SECONDS_IN_GALACTIC_YEAR);
        if (habitat.population != null && habitat.population.items.length > 0 && habitat.population.totalAmount > 0) {
            const num2 = Math.min(1.0, habitat.population.totalAmount / 1000000000.0);
            let val = 1.0 + num2 * 3.0;
            val = Math.min(3.0, Math.max(val, 1.0));
            num *= val;
        }
        habitat.damage = f32(habitat.damage - f32(num));
        habitat.damage = Math.max(0, habitat.damage);
        recalculateQuality(habitat);
        recalculateMaximumPopulation(habitat);
    }
}

/**
 * BaconHabitat.cs 243 TerraformColony(habitat, timePassed) (via Habitat.cs 7211). Reads the completed
 * TerraformingFacility's Value1/2/3 (facility model: construction/facilities.ts, M4i).
 */
export function terraformColony(galaxy: Galaxy, habitat: Habitat, timePassed: number): void {
    let num1 = f32(0);
    let num2 = f32(0);
    let num3 = f32(0);
    if (habitat.facilities !== null) {
        for (let index = 0; index < habitat.facilities.length; ++index) {
            if (habitat.facilities[index].constructionProgress >= 1.0 && habitat.facilities[index].type === PlanetaryFacilityType.TerraformingFacility) {
                num1 = f32(f32(habitat.facilities[index].value1) / 1000);
                num2 = f32(f32(habitat.facilities[index].value2) / 1000);
                num3 = f32(habitat.facilities[index].value3);
                break;
            }
        }
    }
    if (num1 > 0.0) {
        const num4 = f32(f32(f32(timePassed) / REAL_SECONDS_IN_GALACTIC_YEAR) * num1);
        habitat.damage = f32(habitat.damage - num4);
        if (habitat.damage < 0.0) habitat.damage = 0;
    }
    if (num3 > habitat.baseQuality * 100.0 && num2 > 0.0) {
        if (num3 > 100.0) num3 = f32(100);
        const num5 = f32(f32(timePassed) / REAL_SECONDS_IN_GALACTIC_YEAR);
        const num6 = Math.pow(num3 / (num3 + habitat.baseQuality * 100.0), 4.0);
        habitat.baseQuality = f32(habitat.baseQuality + f32(f32(num5 * f32(num6)) * num2));
        if (habitat.baseQuality > num3) habitat.baseQuality = num3;
    }
    recalculateQuality(habitat);
    recalculateMaximumPopulation(habitat);
}

/** Habitat.cs 5992 CheckSatisfaction. */
export function checkSatisfaction(galaxy: Galaxy, habitat: Habitat): void {
    const owner = habitat.owner;
    if (owner === null || owner === galaxy.independentEmpire) {
        return;
    }
    let num = 0;
    const troops = habitat.troops;
    if (troops !== null && troops.count > 0 && troops.totalDefendStrength > 0 && habitat.population != null && habitat.population.totalAmount > 0) {
        const num2 = Math.trunc(habitat.population.totalAmount / 50000);
        if (num2 > 0) {
            num = Math.trunc(troops.totalDefendStrength / num2);
        }
    }
    // (int)(-1.0 * Math.Sqrt(Math.Sqrt(Math.Sqrt(Population.TotalAmount))))
    const num3 = Math.trunc(-1.0 * Math.sqrt(Math.sqrt(Math.sqrt(habitat.population.totalAmount))));
    const num4 = num3 * 3;
    const num5 = num4 - num;
    const num6 = Math.trunc(num3 / 2);
    const num7 = num6 - num;
    let approval = empireApprovalRating(galaxy, habitat);
    // mod layer (19m): the revolt reads the colony's stability ledger (martial law holds it at the leave threshold).
    if (galaxy.scenario !== null) approval = scenarioQuery(galaxy, 'colonyRevoltApproval', approval, { habitat, leaveThreshold: num5 });
    if (approval < num5 && habitat.rebelling) {
        if (troops === null || troops.count <= 0) {
            leaveEmpire(galaxy, habitat);
        }
    } else if (approval < num7) {
        if (habitat.rebelling || (habitat.invadingTroops !== null && habitat.invadingTroops.count > 0)) {
            return;
        }
        let flag = false;
        const dominantRace = habitat.population != null ? habitat.population.dominantRace : null;
        // Galaxy.ShakturiActualRace (set by the story's GenerateShakturi; null otherwise).
        const shakturiActualRace: Race | null = galaxy.shakturiActualRace;
        if (habitat.population != null && dominantRace !== null && dominantRace !== shakturiActualRace && ((troops !== null && troops.count > 0 && galaxy.rnd.next(0, 3) > 0) || habitat.warWithOurRace !== 0)) {
            let num8 = 1;
            const totalAmount = habitat.population.totalAmount;
            num8 = totalAmount < 100000000
                ? Math.max(1, Math.trunc(totalAmount / 40000000))
                : totalAmount < 1000000000
                    ? Math.max(2, Math.trunc(totalAmount / 150000000))
                    : totalAmount >= 5000000000
                        ? Math.max(10, Math.trunc(totalAmount / 600000000))
                        : Math.max(5, Math.trunc(totalAmount / 400000000));
            if (habitat.warWithOurRace !== 0) {
                num8 = Math.trunc(num8 * 1.6);
            }
            const troopList: Troop[] = [];
            for (let i = 0; i < num8; i++) {
                let num9 = dominantRace.troopStrength;
                if (habitat.ruin !== null) {
                    num9 = Math.trunc(num9 * (1.0 + habitat.ruin.bonusDefensive));
                }
                num9 *= 0.7;
                const num10 = f32(num9);
                const troop = generateNewTroop(gameText('RACENAME Militia', dominantRace.name), TroopType.Infantry, Math.trunc(num10), galaxy.independentEmpire, dominantRace);
                troop.colony = habitat;
                troopList.push(troop);
            }
            if (troopList.length > 0) {
                flag = true;
                for (const t of troopList) habitat.invadingTroops!.add(t);
            }
        }
        let description = gameText('Colony Rebelling', habitat.name);
        if (flag) {
            description = gameText('Colony Rebelling Militia', habitat.name);
        }
        sendMessageToEmpire(owner, owner, EmpireMessageType.ColonyRebelling, habitat, description);
        habitat.rebelling = true;
    } else {
        habitat.rebelling = false;
    }
}

/** Habitat.cs 1599 UpdateConqueredFactor(timePassed). */
export function updateConqueredFactor(galaxy: Galaxy, habitat: Habitat, timePassed: number): void {
    if (habitat.conqueredFactor < 0) {
        const num = f32(20.0 * (timePassed / REAL_SECONDS_IN_GALACTIC_YEAR));
        habitat.conqueredFactor = Math.min(0, f32(habitat.conqueredFactor + num));
    }
}

/** Habitat.cs 1162 CalculateMigrationFactor. */
export function calculateMigrationFactor(galaxy: Galaxy, habitat: Habitat): void {
    if (habitat.population != null && habitat.population.totalAmount > 0) {
        let num = 0.0;
        if (habitat.empire !== null && habitat.empire !== galaxy.independentEmpire) {
            num = empireApprovalRating(galaxy, habitat) / 100.0;
        }
        // (double)(3000000000u - Population.TotalAmount): uint − long is long arithmetic.
        const num2 = Math.min(1.0, Math.max(-1.0, (3000000000 - habitat.population.totalAmount) / 5000000000.0));
        const num3 = (habitat.quality - 0.5) / 5.0 + habitat.scenicFactor * 0.5;
        let num4 = 0.0;
        if (habitat.taxRate < 0.15) {
            num4 = f32((0.15 - habitat.taxRate) * Math.max(0.0, num2) * 2.0);
        }
        habitat.migrationFactor = f32(num4 + num + num2 + num3);
        if (habitat.empire !== null && habitat.empire.dominantRace !== null) {
            habitat.migrationFactor = f32(habitat.migrationFactor * raceMigrationFactor(habitat.empire.dominantRace));
        }
        if (habitat.migrationFactor < 0 && habitat.population.totalAmount < 1000000000) {
            habitat.migrationFactor = 0;
        }
    } else {
        habitat.migrationFactor = 0;
    }
}

// ---------------------------------------------------------------------------
// BaconHabitat.HugeProcessingSpanActions (economy parts)
// ---------------------------------------------------------------------------

// BaconHabitat.cs 24 allowInfrastructureImprovements, 27-29 infrastructureSpendingPerDevelopmentLevel /
// maxInfrastructureInvestmentAllowed / infrasetuctureDurability, 31 marketPriceUpdateChance; BaconMain.cs 102
// quartersOfCashAvailable: BaconSettings.txt statics (BaconMain.cs 823-863), read from `baconSettings`.
/** BaconHabitat.cs 30. */
const BACON_COLONY_INFRASTRUCTURE_SPENDING_POPULATION_FACTOR = 300000000;

/** The clock-seeded `new Random()` stand-in (plan §0): one stream per galaxy, seeded from the galaxy seed. */
export function baconClockRnd(galaxy: Galaxy): Random {
    if (galaxy.baconHabitatClockRnd === null) galaxy.baconHabitatClockRnd = new Random((galaxy.randomSeed ^ 0x0b4c0434) | 0);
    return galaxy.baconHabitatClockRnd;
}

/**
 * BaconHabitat.cs 434 HugeProcessingSpanActions(planet). BaconBuiltObject.myMain (the UI Main) is set in any running
 * game, so its null early-outs are taken as not null.
 */
export function baconHabitatHugeProcessingSpanActions(galaxy: Galaxy, planet: Habitat): void {
    if (planet.empire !== null && planet.empire === galaxy.playerEmpire) {
        // BaconHabitat.HandlePlayerPrisoners (575) — M4q.
        baconHabitatHandlePrisoners(galaxy, planet, true);
    } else if (planet.empire !== null && planet.empire !== galaxy.independentEmpire) {
        // BaconHabitat.HandleAIPrisoners (608) — M4q (clock Randoms only, no Galaxy.Rnd).
        baconHabitatHandlePrisoners(galaxy, planet, false);
        chechAIShouldInvestInInfrastructure(galaxy, planet);
    }
    if (planet.empire !== null) {
        // `new Random().NextDouble() < marketPriceUpdateChance` (clock Random).
        if (baconClockRnd(galaxy).nextDouble() < baconSettings.marketPriceUpdateChance) {
            updatePlanetResourcePrices(galaxy, planet);
        }
        updatePlanetMarketCash(galaxy, planet);
    }
    decayInfrastructure(galaxy, planet);
    decayPirateBase(galaxy, planet);
}

/** BaconHabitat.cs 455 UpdatePlanetMarketCash(planet). */
export function updatePlanetMarketCash(galaxy: Galaxy, planet: Habitat): void {
    if (planet.baconValues === null) planet.baconValues = new Map();
    if (!planet.baconValues.has('marketcash')) {
        planet.baconValues.set('marketcash', 10000);
    }
    const baconValue = planet.baconValues.get('marketcash') as number;
    const empire = planet.empire;
    if (empire === null) return;
    let num1 = 0;
    for (const p of planet.population.items) num1 += p.amount;
    let num2: number;
    let num3: number;
    if (empire === galaxy.independentEmpire || galaxy.pirateEmpires.includes(empire)) {
        num2 = num1;
        num3 = habitatAnnualRevenue(galaxy, planet);
        if (num3 < 2500.0) num3 = 2500.0;
    } else {
        if (empire.totalPopulation === 0) {
            recalculateEmpirePopulationLocal(empire);
        }
        num2 = empire.totalPopulation;
        const gov = empireGovernmentAttributes(empire);
        num3 = empire.pirateEmpireBaseHabitat === null && (gov === null || gov.specialFunctionCode !== 1) ? empire.privateMoney : empire.stateMoney;
    }
    let num4 = Math.max(0.01, num1 / num2) * num3 * 0.25;
    if (num4 < 0.0) num4 = 0.0;
    let val2 = baconValue + num4;
    if (val2 > num4 * baconSettings.quartersOfCashAvailable) val2 = val2 * 0.8;
    planet.baconValues.set('marketcash', convertToInt32(Math.min(2147483647, val2)));
}

/** Empire.4.cs 3448 RecalculateEmpirePopulation (same as taxes.ts recalculateEmpirePopulation). */
function recalculateEmpirePopulationLocal(empire: Empire): void {
    let num = 0;
    for (let i = 0; i < empire.colonies.length; i++) {
        const habitat = empire.colonies[i];
        for (let j = 0; j < habitat.population.items.length; j++) num += habitat.population.items[j].amount;
    }
    empire.totalPopulation = num;
}

/** BaconHabitat.cs 497 UpdatePlanetResourcePrices(planet). */
export function updatePlanetResourcePrices(galaxy: Galaxy, planet: Habitat): void {
    if (planet.baconValues === null) planet.baconValues = new Map();
    if (!planet.baconValues.has('resourcePriceList')) {
        const resourcePriceList = createPlanetResourcePriceList(galaxy);
        if (resourcePriceList.size === 0) return;
        planet.baconValues.set('resourcePriceList', resourcePriceList);
    }
    const baconValue = planet.baconValues.get('resourcePriceList') as Map<string, number>;
    const dictionary = new Map<string, number>();
    // `new Random()` (clock) — the galaxy-seeded stand-in.
    const random = baconClockRnd(galaxy);
    let resourceID = 0;
    for (const [key, value] of baconValue) {
        const num1 = (1.0 - value) / 2.0;
        let num2 = random.nextDouble() - 0.5 + num1;
        if (num2 < 0.02) num2 = 0.02;
        const environmentalFactors = calculateResourcePriceEnvironmentalFactors(galaxy, planet, resourceID);
        const num3 = num2 * environmentalFactors;
        dictionary.set(key, value + num3 / 2.0);
        ++resourceID;
    }
    planet.baconValues.set('resourcePriceList', dictionary);
}

/** BaconHabitat.cs 520 CreatePlanetResourcePriceList(planet). */
function createPlanetResourcePriceList(galaxy: Galaxy): Map<string, number> {
    const resourcePriceList = new Map<string, number>();
    const resources = galaxy.resourceSystem.resources;
    for (let index = 0; index < resources.length; ++index) {
        // Dictionary.Add throws on a duplicate key.
        if (resourcePriceList.has(resources[index].name)) throw new Error('ArgumentException: An item with the same key has already been added.');
        resourcePriceList.set(resources[index].name, 1.0);
    }
    return resourcePriceList;
}

/** BaconHabitat.cs 538 CalculateResourcePriceEnvironmentalFactors(planet, resourceID). */
function calculateResourcePriceEnvironmentalFactors(galaxy: Galaxy, planet: Habitat, resourceID: number): number {
    let environmentalFactors = 1.0;
    const resource = galaxy.resourceSystem.resources[resourceID];
    const empire = planet.empire;
    if (empire !== null && empire !== galaxy.independentEmpire) {
        // TODO(port) M4d: Empire.CountResourceSupplyLocations(resource.ResourceID, false) — supply locations of the
        // resource (mining stations / colonies). Not ported: 0 (→ +0.2), what the C# gives an empire with none.
        const num1 = countResourceSupplyLocations(galaxy, empire, resource.resourceId, false);
        if (num1 === 0) environmentalFactors += 0.2;
        else if (num1 > 10) environmentalFactors -= 0.1;
        let num2 = 0;
        let num5 = 0;
        for (const r of empire.diplomaticRelations) {
            if (r.type === DiplomaticRelationType.War) num2++;
            if (r.type === DiplomaticRelationType.TradeSanctions) num5++;
        }
        let num3 = 1.0;
        for (let index = 0; index < num2; ++index) num3 *= 1.2;
        const num4 = environmentalFactors * num3;
        let num6 = 1.0;
        for (let index = 0; index < num5; ++index) num6 *= 1.1;
        environmentalFactors = num4 * num6;
    }
    return environmentalFactors;
}

/** BaconHabitat.cs 887 ChechAIShouldInvestInInfrastructure(planet). */
function chechAIShouldInvestInInfrastructure(galaxy: Galaxy, planet: Habitat): void {
    const empire = planet.empire!;
    if (!baconSettings.allowInfrastructureImprovements || empire.privateMoney < baconSettings.infrastructureSpendingPerDevelopmentLevel * 5 || planet.annualTaxRevenue < 30000.0) return;
    const random = baconClockRnd(galaxy);
    const num1 = empire.privateMoney / baconSettings.infrastructureSpendingPerDevelopmentLevel;
    const num2 = random.nextDouble() * 100.0;
    if (num2 >= num1) return;
    const num3 = Math.min(empire.privateMoney * 0.8, Math.max(empire.privateMoney * 0.1, empire.privateMoney * (num1 - num2)));
    investInInfrastructure(galaxy, 'Invest ' + convertToInt32(num3).toString(), false, planet);
}

/** BaconHabitat.cs 920 InvestInInfastructure(main, input, useStateFunds, planetParameter) — the AI path (planet given). */
function investInInfrastructure(galaxy: Galaxy, input: string, useStateFunds: boolean, habitat: Habitat): void {
    if (!baconSettings.allowInfrastructureImprovements) return;
    let flag = false;
    let result = 1000000;
    const strArray = input.split(' ');
    if (strArray.length > 1) {
        const n = /^\s*[+-]?\d+\s*$/.test(strArray[1]) ? parseInt(strArray[1], 10) : NaN;
        flag = !Number.isNaN(n) && n >= -2147483648 && n <= 2147483647;
        result = flag ? n : 0;
    }
    if (!flag) result = 1000000;
    const empire = habitat.empire!;
    const num1 = !useStateFunds ? empire.privateMoney : empire.stateMoney;
    if (result > num1) result = convertToInt32(num1);
    if (result <= 0) return;
    if (habitat.baconValues === null) habitat.baconValues = new Map();
    let num2 = 0;
    if (habitat.baconValues.has('infrastructure')) num2 += habitat.baconValues.get('infrastructure') as number;
    if (num2 + result > baconSettings.maxInfrastructureInvestmentAllowed) {
        // (the player message box is UI; AI path)
        if (!empire.name.includes('Romulan')) result = baconSettings.maxInfrastructureInvestmentAllowed - num2;
    }
    if (useStateFunds) empire.stateMoney -= result;
    else empire.privateMoney -= result;
    if (habitat.baconValues.has('infrastructure')) result += habitat.baconValues.get('infrastructure') as number;
    habitat.baconValues.set('infrastructure', result);
}

/** BaconHabitat.cs 964 DecayInfrastructure(planet). */
function decayInfrastructure(galaxy: Galaxy, planet: Habitat): void {
    if (planet.baconValues === null || !planet.baconValues.has('infrastructure') || !baconSettings.allowInfrastructureImprovements) return;
    let val1 = planet.baconValues.get('infrastructure') as number;
    let num1 = 1;
    if (planet.population != null && planet.population.totalAmount > 0) num1 = planet.population.totalAmount;
    const f = BACON_COLONY_INFRASTRUCTURE_SPENDING_POPULATION_FACTOR;
    const num2 = (num1 + f) / (num1 + f / 3.0);
    const num3 = baconSettings.infrasetuctureDurability + num2 / 90.0;
    try {
        val1 = Math.min(val1, convertToInt32(val1 * num3));
    } catch {
        // C# swallows the overflow.
    }
    planet.baconValues.set('infrastructure', val1);
}

/** BaconHabitat.cs 984 DecayPirateBase(planet). */
function decayPirateBase(galaxy: Galaxy, planet: Habitat): void {
    if (planet.baconValues === null || !planet.baconValues.has('piratebase') || planet.facilities === null) return;
    if (facilitiesFindBestPirateFacility(planet.facilities, true) === null) {
        planet.baconValues.delete('piratebase');
    } else {
        const baconValue = Math.trunc(planet.baconValues.get('piratebase') as number);
        planet.baconValues.set('piratebase', Math.trunc(baconValue * 0.89999997615814209));
    }
}

// ---------------------------------------------------------------------------
// Empire.EvaluateColonyVariables (Empire periodic block) / EvaluateColonyVariablesPirate
// ---------------------------------------------------------------------------

/** Empire.4.cs 3308 CalculateColonyGrowthRateMultiplier(race, colony). */
export function calculateColonyGrowthRateMultiplier(empire: Empire, race: Race, colony: Habitat): number {
    let result = 1;
    switch (colony.type) {
        case HabitatType.Continental:
            result = empire.colonyGrowthRateContinental;
            break;
        case HabitatType.MarshySwamp:
            result = empire.colonyGrowthRateMarshySwamp;
            break;
        case HabitatType.Desert:
            result = empire.colonyGrowthRateDesert;
            break;
        case HabitatType.Ocean:
            result = empire.colonyGrowthRateOcean;
            break;
        case HabitatType.Ice:
            result = empire.colonyGrowthRateIce;
            break;
        case HabitatType.Volcanic:
            result = empire.colonyGrowthRateVolcanic;
            break;
    }
    if (race.nativeHabitatType === colony.type) {
        result = 1;
    }
    return result;
}

/** CargoList.cs 619 ResourceGroupCount(Luxury, empire) / 636 RestrictedResourceCount(empire). */
function cargoResourceCounts(galaxy: Galaxy, habitat: Habitat, empire: Empire | null): { luxury: number; restricted: number } {
    let luxury = 0;
    let restricted = 0;
    if (empire !== null && habitat.cargo !== null) {
        for (const c of habitat.cargo.items) {
            const r = galaxy.resourceSystem.byId.get(c.commodity.resourceId);
            if (r === undefined || c.empire !== empire || !(c.amount > 0)) continue;
            if (resourceGroupOf(r) === ResourceGroup.Luxury) luxury++;
            // Resource.cs 34 IsRestrictedResource => SuperLuxuryBonusAmount > 0.
            if (r.superLuxuryBonusAmount > 0) restricted++;
        }
    }
    return { luxury, restricted };
}

/** CharacterList.cs 125 FindCharactersAtLocationNotTransferring(location, role). */
function findCharactersAtLocationNotTransferringRole(list: Character[], location: unknown, role: CharacterRole): Character[] {
    const result: Character[] = [];
    for (let index = 0; index < list.length; ++index) {
        const character = list[index];
        if (character != null && character.role === role && character.location === location && character.transferDestination === null) result.push(character);
    }
    return result;
}

/**
 * Empire.4.cs 2943 EvaluateColonyVariables(galaxy, timePassed) and 2579 EvaluateColonyVariablesPirate — the same body;
 * the pirate differences are marked `pirate`.
 */
function evaluateColonyVariablesCore(galaxy: Galaxy, empire: Empire, timePassed: number, pirate: boolean): void {
    let num = 0;
    // 2946-2947 CheckAtWar() / ResolveLocationsToDefend(includeBases: false) (pirate: atWar false, null list).
    const atWar = pirate ? false : checkAtWar(empire);
    const defendColonies = pirate ? null : (resolveLocationsToDefend(galaxy, empire, false) as Habitat[]);
    const troopStrengthNeutralizationAmount = TROOP_STRENGTH_ANNUAL_NEUTRALIZATION_AMOUNT * (timePassed / REAL_SECONDS_IN_GALACTIC_YEAR);
    const troopSizeRegenerationAmount = TROOP_SIZE_ANNUAL_REGENERATION_AMOUNT * (timePassed / REAL_SECONDS_IN_GALACTIC_YEAR);
    const troopRecruitmentAmount = TROOP_ANNUAL_RECRUITMENT_AMOUNT * (timePassed / REAL_SECONDS_IN_GALACTIC_YEAR);
    const strongestEmpireTroop = identifyStrongestRaceAttackTroop(empire);
    const totalIncome = calculateAccurateAnnualIncome(galaxy, empire);
    const annualStateMaintenanceValue = annualStateMaintenance(empire);
    const annualPirateProtectionValue = pirate ? 0.0 : annualPirateProtection(empire);
    const tribute = pirate ? 0.0 : annualSubjugationTribute(galaxy, empire) + annualPirateProtection(empire);
    const annualFacilityMaintenanceValue = annualFacilityMaintenance(empire);
    // Empire.cs 2185 MinimumIntelligenceAgentSpending => 0.0 (pirate: the literal 0.0).
    const minimumIntelligenceAgentSpending = 0.0;
    const minimumShipSpendingValue = minimumShipSpending(galaxy, empire);
    // 2958-2982: luxury / restricted resource lists (M4d).
    const lists = prepareColonyLuxuryResourceLists(galaxy, empire);
    const colonies = empire.colonies;
    for (let j = 0; j < colonies.length; j++) {
        const habitat = colonies[j];
        if (pirate && !(habitat != null && habitat.owner === empire)) {
            // Pirate: the whole body (incl. `_TotalPopulation = num`) sits inside `if (habitat != null && Owner == this)`.
            continue;
        }
        if (habitat.hasBeenDestroyed) {
            if (habitat.explosion !== null) {
                continue;
            }
            if (galaxy.habitats.includes(habitat)) {
                if (!habitat.doingRemove) {
                    doPlanetRemove(galaxy, habitat);
                }
            } else {
                // Colonies.Remove(habitat) inside the index loop (the next colony is skipped, as in C#).
                const idx = colonies.indexOf(habitat);
                if (idx >= 0) colonies.splice(idx, 1);
            }
            continue;
        }
        const num3 = Math.max(0.2, (15.0 + habitatTaxApproval(habitat)) / 30.0);
        let builtObject: BuiltObject | null = null;
        for (let k = 0; k < empire.spacePorts.length; k++) {
            const builtObject2 = empire.spacePorts[k];
            if (builtObject2.parentHabitat === habitat && builtObject2.isSpacePort) {
                builtObject = builtObject2;
                break;
            }
        }
        const flag = true;
        if (empire.controlColonyStockLevels) {
            maintainColonyCriticalResourceLevels(galaxy, empire, builtObject, habitat);
            maintainColonyResourceLevels(galaxy, empire, builtObject, habitat);
        }
        recalculateCriticalResourceSupplyBonuses(galaxy, habitat);
        let num4 = 0;
        let num5 = 0;
        if (habitat.cargo !== null) {
            const counts = cargoResourceCounts(galaxy, habitat, habitat.owner);
            num4 = counts.luxury;
            num5 = counts.restricted;
        }
        let dominantRace = habitat.population.dominantRace;
        if (dominantRace === null) {
            dominantRace = empire.dominantRace;
        }
        calculateMaximumOrderFulfillmentDistanceForHabitat(galaxy, habitat);
        // Empire.4.cs 3036-3038: num6 / num7 / val feed only the luxury orders (below).
        const num6 = calculateMinimumLuxuryResourceLevel(habitat);
        const num7 = calculateMinimumLuxuryResourceLevelRestricted(habitat);
        const val = Math.trunc(num7 * 1.5);
        const num8 = calculateStrategicResourceSupplyGrowthFactor(galaxy, habitat);
        if (num8 > 0.0) {
            let num9 = (timePassed / REAL_SECONDS_IN_GALACTIC_YEAR) * COLONY_DEVELOPMENT_LEVEL_MAXIMUM_ANNUAL_CHANGE;
            num9 *= empire.economyEfficiency;
            num9 *= num8;
            const num10 = Math.trunc(habitat.developmentLevel / 5);
            const num11 = num4 - num10;
            if (num5 > 0) {
                habitat.restrictedResourcesPresent = true;
            } else {
                habitat.restrictedResourcesPresent = false;
            }
            let num12 = 0.0;
            num12 = num11 === 0.0 ? 0.0 : !(num11 < 0.0) ? Math.min(num9, num11) : Math.max(num9, num11);
            if (empire.economyEfficiency < 0.9) {
                num12 = -1.0;
            }
            const developmentLevel = Math.max(0, habitat.developmentLevel + Math.trunc(num12));
            habitat.setDevelopmentLevel(developmentLevel);
            if (Math.trunc(num12) >= 1) {
                doCharacterEventRuntime(galaxy, CharacterEventType.ColonyDevelopmentIncrease, habitat, stellarObjectCharacters(habitat), true, empire);
            } else if (Math.trunc(num12) <= -1) {
                doCharacterEventRuntime(galaxy, CharacterEventType.ColonyDevelopmentDecrease, habitat, stellarObjectCharacters(habitat), true, empire);
            }
        }
        const num13 = 1.0 + empireApprovalRating(galaxy, habitat) / 200.0;
        if (num8 > 0.0 && flag) {
            let num14 = 1.0;
            const characters = empire.characters as Character[] | null;
            if (characters != null) {
                const characterList = findCharactersAtLocationNotTransferringRole(characters, habitat, CharacterRole.ColonyGovernor);
                let num15 = -100;
                for (let l = 0; l < characterList.length; l++) {
                    num15 = Math.max(num15, characterList[l].populationGrowth);
                }
                if (num15 <= -100) {
                    num15 = 0;
                }
                num14 *= 1.0 + num15 / 100.0;
                const charactersByRole = getCharactersByRole(characters, CharacterRole.Leader);
                let num16 = -100;
                for (let m = 0; m < charactersByRole.length; m++) {
                    const location = charactersByRole[m].location;
                    if (!pirate) {
                        // `Location is Habitat && Capitals.Contains((Habitat)Location)`.
                        if (location != null && location instanceof Habitat && empire.capitals.includes(location)) {
                            num16 = Math.max(num16, charactersByRole[m].populationGrowth);
                        }
                    } else if (location != null && !(location instanceof Habitat) && (location as BuiltObject).parentHabitat != null && (location as BuiltObject).parentHabitat === empire.pirateEmpireBaseHabitat) {
                        // `Location is BuiltObject && ((BuiltObject)Location).ParentHabitat == PirateEmpireBaseHabitat`.
                        num16 = Math.max(num16, charactersByRole[m].populationGrowth);
                    }
                }
                if (num16 <= -100) {
                    num16 = 0;
                }
                num14 *= 1.0 + num16 / 100.0;
            }
            const gov = empireGovernmentAttributes(empire);
            // Empire.cs 413 PopulationGrowthRate (BaconGalaxy.cs 135/147: PopulationGrowthRateDefault / DifficultyLevel).
            const populationGrowthRate = empire.difficultyFactors?.populationGrowthRate ?? 1.0;
            for (let n = 0; n < habitat.population.items.length; n++) {
                const population = habitat.population.items[n];
                let num17 = (Math.min(5, Math.max(1, num4)) / 5.0) * num3 * (raceReproductiveRate(galaxy, population.race) - 1.0) * num13 * habitat.quality;
                const num18 = calculateColonyGrowthRateMultiplier(empire, population.race, habitat);
                num17 *= num18;
                num17 *= habitat.growthFactor;
                if (gov !== null) {
                    num17 *= gov.populationGrowth;
                }
                num17 *= empire.economyEfficiency;
                num17 *= populationGrowthRate;
                num17 = Math.min(1.0, Math.max(num17, 0.01));
                if (habitat.population.totalAmount < 500000000) {
                    num17 += num17 * 0.5;
                }
                if (empire.specialBonusPopulationGrowth > 0.0) {
                    num17 *= 1.0 + empire.specialBonusPopulationGrowth;
                }
                const bonusTotalByEffectType = resourceBonusTotalByEffectType(habitat, ColonyResourceEffect.PopulationGrowthRate);
                const num19 = 1.0 + bonusTotalByEffectType / 100.0;
                num17 *= num19;
                const exterminateFactor = raceColonyPopulationPolicyGrowthFactorExterminate(dominantRace!);
                if (habitat.population != null && exterminateFactor !== 1.0) {
                    let flag2 = false;
                    for (let num20 = 0; num20 < habitat.population.items.length; num20++) {
                        const population2 = habitat.population.items[num20];
                        if (population2 != null && population2.race != null) {
                            if (habitat.colonyPopulationPolicyRaceFamily === ColonyPopulationPolicy.Exterminate && population2.race !== dominantRace && population2.race.raceFamily === dominantRace!.raceFamily) {
                                flag2 = true;
                                break;
                            }
                            if (habitat.colonyPopulationPolicy === ColonyPopulationPolicy.Exterminate && population2.race !== dominantRace && population2.race.raceFamily !== dominantRace!.raceFamily) {
                                flag2 = true;
                                break;
                            }
                        }
                    }
                    if (flag2) {
                        num17 *= exterminateFactor;
                    }
                }
                num17 *= num14;
                num17 *= num8;
                let colonyPopulationPolicy = ColonyPopulationPolicy.Assimilate;
                if (empire.dominantRace !== null && population.race !== empire.dominantRace) {
                    colonyPopulationPolicy = habitat.colonyPopulationPolicy;
                    if (population.race.raceFamily === empire.dominantRace.raceFamily) {
                        colonyPopulationPolicy = habitat.colonyPopulationPolicyRaceFamily;
                    }
                }
                switch (colonyPopulationPolicy) {
                    case ColonyPopulationPolicy.Resettle:
                    case ColonyPopulationPolicy.Enslave:
                    case ColonyPopulationPolicy.Exterminate:
                        num17 = 0.0;
                        break;
                }
                population.growthRate = f32(1 + f32(num17));
                num += population.amount;
            }
        } else {
            for (const item of habitat.population.items) {
                item.growthRate = 1;
                num += item.amount;
            }
        }
        habitat.population.recalculateTotalAmount();
        // 3183-3301 (pirate 2814-2932): orders for luxury / restricted resources (M4d).
        orderColonyLuxuryResources(galaxy, empire, habitat, builtObject, lists, num6, num7, val);
        recalculateAnnualTaxRevenue(galaxy, habitat);
        processColonyTroopsFull(
            galaxy, empire, habitat, strongestEmpireTroop, troopStrengthNeutralizationAmount, troopSizeRegenerationAmount, troopRecruitmentAmount,
            totalIncome, annualStateMaintenanceValue, tribute, annualFacilityMaintenanceValue, annualPirateProtectionValue,
            minimumIntelligenceAgentSpending, minimumShipSpendingValue, atWar, defendColonies, true, galaxy.difficultyLevel,
        );
        if (pirate) {
            // Empire.4.cs 2938: `_TotalPopulation = num;` sits inside the pirate loop body.
            empire.totalPopulation = num;
        }
    }
    if (!pirate) {
        // Empire.4.cs 3306.
        empire.totalPopulation = num;
    }
}

/** Empire.4.cs 2943 EvaluateColonyVariables(galaxy, timePassed). */
export function evaluateColonyVariables(galaxy: Galaxy, empire: Empire, timePassed: number): void {
    evaluateColonyVariablesCore(galaxy, empire, timePassed, false);
}

/** Empire.4.cs 2579 EvaluateColonyVariablesPirate(galaxy, timePassed). */
export function evaluateColonyVariablesPirate(galaxy: Galaxy, empire: Empire, timePassed: number): void {
    evaluateColonyVariablesCore(galaxy, empire, timePassed, true);
}

// ---------------------------------------------------------------------------
// Empire.ReviewColonyPopulationPolicy (Empire intermediate block)
// ---------------------------------------------------------------------------

/** EmpireEvaluation.SetSlaveryOffense(value): assigns _SlaveryOffense. */
function setSlaveryOffense(evaluation: { setSlaveryOffense(value: number): void }, value: number): void {
    evaluation.setSlaveryOffense(value);
}

/** PopulationList.cs Add: merges a population of a race already present (TotalAmount untouched). */
function addPopulationMerged(list: Population[], population: Population): void {
    for (const p of list) {
        if (p.race === population.race) {
            p.amount += population.amount;
            return;
        }
    }
    list.push(population);
}

/** Empire.2.cs 3198 ReviewColonyPopulationPolicy(timePassed). */
export function reviewColonyPopulationPolicy(galaxy: Galaxy, empire: Empire, timePassed: number): void {
    const dominantRace = empire.dominantRace;
    if (dominantRace === null) {
        return;
    }
    const num = Math.trunc((timePassed / REAL_SECONDS_IN_GALACTIC_YEAR) * 500000000.0);
    const populationList: Population[] = [];
    const populationList2: Population[] = [];
    const habitatList: Habitat[] = [];
    for (let i = 0; i < empire.colonies.length; i++) {
        const habitat = empire.colonies[i];
        const totalAmount = habitat.population.totalAmount;
        let num2 = 0;
        const populationList3: Population[] = [];
        for (let j = 0; j < habitat.population.items.length; j++) {
            const population = habitat.population.items[j];
            let colonyPopulationPolicy = ColonyPopulationPolicy.Assimilate;
            if (population.race !== dominantRace) {
                colonyPopulationPolicy = habitat.colonyPopulationPolicy;
                if (population.race.raceFamily === dominantRace.raceFamily) {
                    colonyPopulationPolicy = habitat.colonyPopulationPolicyRaceFamily;
                }
            }
            switch (colonyPopulationPolicy) {
                case ColonyPopulationPolicy.Enslave:
                    population.growthRate = 1;
                    num2 += population.amount;
                    addPopulationMerged(populationList, new Population(population.race, population.amount));
                    break;
                case ColonyPopulationPolicy.Exterminate:
                    if (totalAmount > 30000000) {
                        const num3 = Math.min(population.amount, num);
                        const num4 = Math.max(0, population.amount - num3);
                        addPopulationMerged(populationList2, new Population(population.race, num));
                        if (num4 <= 0) {
                            populationList3.push(population);
                        } else {
                            population.amount = num4;
                        }
                    }
                    break;
            }
        }
        for (let k = 0; k < populationList3.length; k++) {
            habitat.population.remove(populationList3[k]);
        }
        habitat.population.recalculateTotalAmount();
        if (num2 > 0) {
            const num5 = num2 / habitat.population.totalAmount;
            habitat.slaveryBonusFactor = f32(1.0 + num5 * 0.5);
        } else {
            habitat.slaveryBonusFactor = 1;
        }
        if (habitat.population.items.length === 0 || habitat.population.totalAmount <= 0) {
            habitatList.push(habitat);
        }
    }
    for (let l = 0; l < habitatList.length; l++) {
        clearColony(galaxy, habitatList[l], null);
    }
    const evaluations = empire.empireEvaluations as { racialOffense: number }[];
    for (let m = 0; m < evaluations.length; m++) {
        const empireEvaluation = evaluations[m];
        if (empireEvaluation != null && empireEvaluation.racialOffense < 0.0) {
            const num6 = (timePassed / REAL_SECONDS_IN_GALACTIC_YEAR) * 3.0;
            empireEvaluation.racialOffense += num6;
            if (empireEvaluation.racialOffense > 0.0) {
                empireEvaluation.racialOffense = 0.0;
            }
        }
    }
    for (let n = 0; n < galaxy.empires.length; n++) {
        const other = galaxy.empires[n];
        if (other != null && other.active && other !== empire && other !== galaxy.independentEmpire) {
            const empireEvaluation2 = obtainEmpireEvaluation(galaxy, other, empire);
            setSlaveryOffense(empireEvaluation2, 0.0);
        }
    }
    for (let num7 = 0; num7 < populationList.length; num7++) {
        const population2 = populationList[num7];
        const empireList = determineEmpiresWithDominantRace(galaxy, population2.race);
        for (let num8 = 0; num8 < empireList.length; num8++) {
            const empire2 = empireList[num8];
            if (empire2 != null) {
                const empireEvaluation3 = obtainEmpireEvaluation(galaxy, empire2, empire);
                const slaveryOffense = Math.sqrt(Math.sqrt(population2.amount / 600000.0)) * -1.0;
                setSlaveryOffense(empireEvaluation3, slaveryOffense);
                if (empireEvaluation3.slaveryOffense < -30.0) {
                    setSlaveryOffense(empireEvaluation3, -30.0);
                }
                if (empireEvaluation3.slaveryOffense > 0.0) {
                    setSlaveryOffense(empireEvaluation3, 0.0);
                }
            }
        }
    }
    for (let num9 = 0; num9 < populationList2.length; num9++) {
        const population3 = populationList2[num9];
        empire.counters.processExterminatedPopulation(population3.amount);
        const empireList2 = determineEmpiresWithDominantRace(galaxy, population3.race);
        let num10 = 0.0;
        for (let num11 = 0; num11 < empireList2.length; num11++) {
            const empire3 = empireList2[num11];
            if (empire3 != null) {
                const empireEvaluation4 = obtainEmpireEvaluation(galaxy, empire3, empire);
                const num12 = Math.sqrt(population3.amount / 2000000.0) * -1.0;
                empireEvaluation4.racialOffense += num12;
                if (empireEvaluation4.racialOffense < -50.0) {
                    empireEvaluation4.racialOffense = -50.0;
                }
                num10 += empire3.civilityRating;
            }
        }
        let num13 = population3.amount / 500000000.0;
        if (empireList2 != null && empireList2.length > 0) {
            num10 /= empireList2.length;
        }
        if (num10 > 0.0) {
            const num14 = 1.0 + num10 / 30.0;
            num13 *= num14;
        } else {
            let val = 1.0 + num10 / 50.0;
            val = Math.max(0.01, val);
            num13 *= val;
        }
        empire.civilityRating -= num13;
    }
    if (!empire.controlPopulationPolicy) {
        return;
    }
    const habitatList2: Habitat[] = [];
    for (let num15 = 0; num15 < empire.penalColonies.length; num15++) {
        const habitat2 = empire.penalColonies[num15];
        if (habitat2.colonyPopulationPolicy !== ColonyPopulationPolicy.Enslave && habitat2.colonyPopulationPolicyRaceFamily !== ColonyPopulationPolicy.Enslave) {
            habitatList2.push(habitat2);
        }
    }
    for (let num16 = 0; num16 < habitatList2.length; num16++) {
        const idx = empire.penalColonies.indexOf(habitatList2[num16]);
        if (idx >= 0) empire.penalColonies.splice(idx, 1);
    }
    if (!empire.policy!.implementEnslavementWithPenalColonies) {
        return;
    }
    const habitatList3 = identifyBestNewPenalColonies(galaxy, empire);
    const habitatList4: Habitat[] = [];
    let num17 = 0;
    for (let num18 = 0; num18 < empire.penalColonies.length; num18++) {
        const habitat3 = empire.penalColonies[num18];
        if (habitat3 != null && habitat3.population != null) {
            const num19 = habitat3.population.totalAmount / habitat3.maxPopulation;
            if (num19 < 0.8) {
                num17++;
            }
        }
    }
    if (empire.penalColonies.length >= 5) {
        num17 = 1;
    }
    if (num17 <= 0 && habitatList3.length > 0) {
        habitatList4.push(habitatList3[0]);
    }
    let num20 = 0;
    for (let num21 = 0; num21 < empire.colonies.length; num21++) {
        const habitat4 = empire.colonies[num21];
        if (habitat4 == null || (habitat4.colonyPopulationPolicy !== ColonyPopulationPolicy.Enslave && habitat4.colonyPopulationPolicyRaceFamily !== ColonyPopulationPolicy.Enslave)) {
            continue;
        }
        num20++;
        if (!empire.penalColonies.includes(habitat4) && !habitatList4.includes(habitat4) && habitat4.raceEventType !== RaceEventType.AntiXenoRiotsExterminate && habitat4.raceEventType !== RaceEventType.DeathCultExterminate) {
            if (habitat4.colonyPopulationPolicy === ColonyPopulationPolicy.Enslave) {
                habitat4.colonyPopulationPolicy = ColonyPopulationPolicy.Resettle;
            }
            if (habitat4.colonyPopulationPolicyRaceFamily === ColonyPopulationPolicy.Enslave) {
                habitat4.colonyPopulationPolicyRaceFamily = ColonyPopulationPolicy.Resettle;
            }
        }
    }
    if (num20 <= 0) {
        return;
    }
    for (let num22 = 0; num22 < habitatList4.length; num22++) {
        const habitat5 = habitatList4[num22];
        if (!empire.penalColonies.includes(habitat5)) {
            const habitat6 = galaxy.determineHabitatSystemStar(habitat5);
            habitat5.name = formatGameTextNow('SYSTEM Penal Colony', [habitat6 !== null ? habitat6.name : '']); // Empire.2.cs 3434: a name, formatted now
            empire.penalColonies.push(habitat5);
        }
    }
}

/** Habitat.cs 5607 CalculatePenalColonyValue. */
export function calculatePenalColonyValue(galaxy: Galaxy, habitat: Habitat): number {
    const empire = habitat.empire;
    if (empire !== null && empire.capital !== null && empire.capital !== habitat) {
        const num = galaxy.calculateDistance(empire.capital.xpos, empire.capital.ypos, habitat.xpos, habitat.ypos);
        let factor = 1.0;
        switch (habitat.type) {
            case HabitatType.Ice:
                factor = 1000.0;
                break;
            case HabitatType.Volcanic:
                factor = 100.0;
                break;
            case HabitatType.Desert:
                factor = 10.0;
                break;
        }
        return num * factor;
    }
    return 0.0;
}

/** Empire.2.cs 3439 IdentifyBestNewPenalColonies. */
function identifyBestNewPenalColonies(galaxy: Galaxy, empire: Empire): Habitat[] {
    const habitatList: { h: Habitat; sortTag: number }[] = [];
    for (let i = 0; i < empire.colonies.length; i++) {
        const habitat = empire.colonies[i];
        if (habitat != null && !empire.penalColonies.includes(habitat)) {
            const sortTag = calculatePenalColonyValue(galaxy, habitat);
            if (sortTag > 0.0) {
                habitatList.push({ h: habitat, sortTag });
            }
        }
    }
    netSort(habitatList, (a, b) => (a.sortTag < b.sortTag ? -1 : a.sortTag > b.sortTag ? 1 : 0));
    habitatList.reverse();
    return habitatList.map((e) => e.h);
}

// ---------------------------------------------------------------------------
// Galaxy long block
// ---------------------------------------------------------------------------

/** Galaxy.cs 3425 ReviewRacePeriodicChanges. */
export function reviewRacePeriodicChanges(galaxy: Galaxy): void {
    const currentStarDate = galaxyStarDate(galaxy);
    // Galaxy.cs 1094 ActualStartDate => _StartStarDate.
    const actualStartDate = currentStarDate - galaxy.nowMs;
    const playerEmpire = galaxy.playerEmpire;
    for (let i = 0; i < galaxy.races.length; i++) {
        const race = galaxyRace(galaxy, galaxy.races[i]);
        const interval = raceChangePeriodYearsInterval(race);
        const length = raceChangePeriodYearsLength(race);
        if (interval <= 0 || length <= 0) {
            continue;
        }
        const num = Math.trunc((currentStarDate - actualStartDate) / (REAL_SECONDS_IN_GALACTIC_YEAR * 1000));
        // C# `%` keeps the dividend's sign, like JS.
        if ((num - interval) % (interval + length) === 0) {
            if (raceChangePeriodActive(galaxy, race)) {
                continue;
            }
            if (playerEmpire !== null) {
                if (playerEmpire.dominantRace === race) {
                    const description = gameText('Race Periodic Change Begin', race.name, interval.toString(), length.toString(), resolveRaceChangeQualitiesDescription(race));
                    sendMessageToEmpireWithTitle(playerEmpire, playerEmpire, EmpireMessageType.GeneralNeutralEvent, race, description, gameText('Race Periodic Change Begin Title', race.name));
                } else {
                    for (let j = 0; j < playerEmpire.diplomaticRelations.count; j++) {
                        const diplomaticRelation = playerEmpire.diplomaticRelations.at(j);
                        if (diplomaticRelation.type !== DiplomaticRelationType.NotMet && diplomaticRelation.otherEmpire != null && diplomaticRelation.otherEmpire.dominantRace === race) {
                            const description2 = gameText('Race Periodic Change Begin Other', race.name, interval.toString(), length.toString(), resolveRaceChangeQualitiesDescription(race));
                            sendMessageToEmpireWithTitle(playerEmpire, playerEmpire, EmpireMessageType.GeneralNeutralEvent, race, description2, gameText('Race Periodic Change Begin Title', race.name));
                            break;
                        }
                    }
                }
            }
            galaxy.raceChangePeriodActive.add(race);
        } else {
            if (num % (interval + length) !== 0 || !raceChangePeriodActive(galaxy, race)) {
                continue;
            }
            galaxy.raceChangePeriodActive.delete(race);
            if (playerEmpire === null) {
                continue;
            }
            if (playerEmpire.dominantRace === race) {
                const description3 = gameText('Race Periodic Change End', race.name, interval.toString());
                sendMessageToEmpireWithTitle(playerEmpire, playerEmpire, EmpireMessageType.GeneralNeutralEvent, race, description3, gameText('Race Periodic Change End Title', race.name));
                continue;
            }
            for (let k = 0; k < playerEmpire.diplomaticRelations.count; k++) {
                const diplomaticRelation2 = playerEmpire.diplomaticRelations.at(k);
                if (diplomaticRelation2.type !== DiplomaticRelationType.NotMet && diplomaticRelation2.otherEmpire != null && diplomaticRelation2.otherEmpire.dominantRace === race) {
                    const description4 = gameText('Race Periodic Change End Other', race.name, interval.toString());
                    sendMessageToEmpireWithTitle(playerEmpire, playerEmpire, EmpireMessageType.GeneralNeutralEvent, race, description4, gameText('Race Periodic Change End Title', race.name));
                    break;
                }
            }
        }
    }
}

/** Galaxy.cs 3497 ResolveRaceChangeQualitiesDescription(race) (GameText keys joined by ", "; M9 localizes). */
function resolveRaceChangeQualitiesDescription(race: Race): string {
    const parts: string[] = [];
    const pa = racePeriodicLevel(race, 'PeriodicFactorsAggression');
    const pc = racePeriodicLevel(race, 'PeriodicFactorsCaution');
    const pf = racePeriodicLevel(race, 'PeriodicFactorsFriendliness');
    const pg = racePeriodicGrowthRate(race);
    if (pa > race.aggression) parts.push('increased aggression');
    else if (pa < race.aggression) parts.push('decreased aggression');
    if (pc > race.caution) parts.push('increased caution');
    else if (pc < race.caution) parts.push('decreased caution');
    if (pf > race.friendliness) parts.push('increased friendliness');
    else if (pf < race.friendliness) parts.push('decreased friendliness');
    if (pg > race.reproductionRate) parts.push('increased population growth');
    else if (pg < race.reproductionRate) parts.push('decreased population growth');
    return parts.join(', ');
}

/** Galaxy.cs 3020 ReviewColonyFillFactor. */
export function reviewColonyFillFactor(galaxy: Galaxy): void {
    let num = 0;
    for (let i = 0; i < galaxy.empires.length; i++) {
        const empire = galaxy.empires[i];
        num += empire.colonies.length;
    }
    const num2 = Math.min(700, galaxy.starCount);
    galaxy.colonyFillFactor = 10.0 * (num / num2);
    galaxy.colonyFillFactor = Math.min(2.5, Math.max(0.7, galaxy.colonyFillFactor));
}
