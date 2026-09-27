// Force-structure projections (task M3b). Port of Empire.9.cs
// ProjectForceStructure (4990) and ProjectPrivateForceStructure (4767) plus
// everything they call: CalculateStateExpenditureBalance (4938),
// CalculateSpareAnnualRevenue (5345), CalculateSupportabilityFactor (5358),
// CalculateSupportCost / EstimateForceStructureSupportCost* (5385-5446),
// Empire.10.cs CurrentState/PrivateForceStructure (178/200),
// DetermineLargestColonyInEachSystem (222), CanBuildBuiltObject (559), the
// Empire.cs economy properties (AnnualTaxRevenue, PrivateAnnualRevenue,
// AnnualStateMaintenance, troop/facility maintenance, tribute, pirate
// protection) and the Habitat.cs colony revenue they read (AnnualRevenue,
// Corruption, RecalculateAnnualTaxRevenue, RecalculateDistanceFactor).
//
// Rnd: none of this draws Galaxy.Rnd (checked: the C# BuiltObject ctor used by
// ProjectPrivateForceStructure's CanBuildBuiltObject probe does not either).
//
// Unported subsystems read here, with the value the C# sees at game start
// (the first Empire.DoTasks inside Galaxy.GenerateEmpire):
// - BuiltObjects / PrivateBuiltObjects / MiningStations / ResortBases: empty
//   (read through BuiltObjectView until src/sim/builtObject.ts lands).
// - DiplomaticRelations: diplomacy.ts (empty until Start.2.cs 1376 meetEmpiresAtStart;
//   game-start relations are None / Strategy Undefined);
//   PirateRelations: empty (pirate factions are generated after the empires).
// - Galaxy.Orders: no orders exist yet (count 0).
// - Troops: the TS GenerateEmpire creates none yet (Troop model TODO).
// - Characters / Leader: none; RaidCountdown 0; no pirate colony control.
// - Tax: Habitat.TaxRate / TaxComplianceRate come from taxes.ts (SetColonyTaxRate).

import { scenarioQuery } from './scenario/hooks';
import type { Galaxy } from './galaxy';
import type { Habitat } from './types';
import { checkColonyRevenueFromPirateControl } from './pirates/pirateColonyControl';
import { calculatePirateIncome, thisYearsForeignTradeBonuses, thisYearsSpacePortIncome } from './treasury';
import { Empire, empireGovernmentAttributes } from './empire';
import { BuiltObjectSubRole } from './builtObjectTypes';
import { BuiltObjectRole } from './data/designSpecifications';
import { ComponentType } from './data/components';
import { findNewest, galaxyResourceCurrentPrices, type Design } from './design';
import { baconSettings } from './data/baconSettings';
import { canBuildDesign, findNewestCanBuild } from './designGeneration';
import { ForceStructureProjection, ForceStructureProjectionList } from './forceStructureProjection';
import { facilitiesCalculateAnnualMaintenance, facilitiesFindBestPirateFacility, identifyEmpireCapitalsWithRegional } from './construction/facilities';
import { HabitatType } from './types';
import { obtainEmpireEvaluation, raidEconomyDamageFactor as habitatRaidEconomyDamageFactor, recalculateCriticalResourceSupplyBonuses, taxComplianceRate } from './taxes';
import { ColonyResourceEffect, habitatDevelopmentLevel, resourceBonusTotalByEffectType } from './developmentLevel';
import { DiplomaticRelationType, DiplomaticStrategy, type DiplomaticRelation } from './diplomacy';
import { resolveCharacterColonyCorruptionBonus, resolveCharacterColonyIncomeBonus } from './characters';
import { PirateRelationType, obtainPirateRelation, type PirateRelation } from './pirateRelations';

export { ForceStructureProjection, ForceStructureProjectionList } from './forceStructureProjection';

// --- Galaxy statics (Galaxy.3.cs InitializeStatics / Galaxy.cs) ---
export const ALLOWABLE_YEARS_MAINTENANCE_FROM_CASH_ON_HAND = 3.0; // Galaxy.3.cs 5050
// ShipMaintenanceCostPerSizeUnit (5084), SubjugationTributePercentage (5068): BaconSettings.txt statics (BaconMain.cs
// 766 / 814), read from `baconSettings`.
export const COLONY_STATE_SUPPORT_COST = 1000.0; // 5087
export const COLONY_REVENUE_DIVISOR = 3500000.0; // 5088
export const REVENUE_DROPOFF_POPULATION_THRESHHOLD_MIN = 20000000000; // 5089 (long)
export const REVENUE_DROPOFF_POPULATION_THRESHHOLD_MAX = 200000000000; // 5090 (long)
export const REVENUE_DROPOFF_RATE = 0.5; // 5091
export const COLONY_CORRUPTION_POPULATION_THRESHHOLD = 100000000; // 5097 (long)
export const SPENDING_TROOP_PERCENTAGE = 0.3; // 5103
export const TROOP_ANNUAL_MAINTENANCE = 1000.0; // 5040
const COLONY_CORRUPTION_FACTOR_DEFAULT = 1.0; // Galaxy.3.cs 5129
const COLONY_INCOME_FACTOR_DEFAULT = 1.0; // Galaxy.3.cs 5137

const INT_MIN = -2147483648;

/**
 * C# `(int)doubleValue` (conv.i4, unchecked). Finite in-range values truncate
 * toward zero; NaN / ±Infinity / out-of-range give int.MinValue (the x86/x64
 * cvttsd2si "integer indefinite" result the net48/net7 runtimes produce).
 * ProjectForceStructure hits this at game start: with no ships its military
 * amounts are NaN (0/0 in num2 / AnnualStateMaintenance).
 */
export function csToInt32(value: number): number {
    if (!(value > -2147483649.0 && value < 2147483648.0)) return INT_MIN;
    return Math.trunc(value) | 0;
}

// C# `(double)floatValue` for policy/race float fields that may be stored unrounded.
const f32 = Math.fround;

// Port of the C# enums read here (member order exact).
// DiplomaticRelationType.cs / DiplomaticStrategy.cs: canonical enums in diplomacy.ts.
export { DiplomaticRelationType, DiplomaticStrategy };
// PirateRelationType.cs: canonical enum in pirateRelations.ts.
export { PirateRelationType };

/** The BuiltObject members this module reads (the lists it walks are typed loosely by some callers). */
export interface BuiltObjectView {
    role: BuiltObjectRole;
    subRole: BuiltObjectSubRole;
    hasBeenDestroyed: boolean;
    unbuiltComponentCount: number;
    topSpeed: number;
    firepowerRaw: number;
    builtAt: unknown;
    empire: Empire | null;
    annualSupportCost: number; // C#: float
}

/** DiplomaticRelation (diplomacy.ts). OtherEmpire is never null on a relation held in Empire.DiplomaticRelations. */
type DiplomaticRelationView = DiplomaticRelation & { otherEmpire: Empire };


const builtObjectsOf = (list: unknown[]): BuiltObjectView[] => list as BuiltObjectView[];
const diplomaticRelationsOf = (empire: Empire): DiplomaticRelationView[] => empire.diplomaticRelations.toArray() as DiplomaticRelationView[];
// Empire.PirateRelations (PirateRelationList, Empire.cs 493; pirateRelations.ts), iterated by index
// (C# `for (i = 0; i < PirateRelations.Count; i++) PirateRelations[i]`).
const pirateRelationsOf = (empire: Empire): PirateRelation[] => empire.pirateRelations.toArray();

// Empire._ShipMaintenanceSavings (Empire.cs 2991; set by ReviewEmpireAbilityBonuses, treasury.ts).
const shipMaintenanceSavings = (empire: Empire): number => empire.shipMaintenanceSavings;

// Empire.ColonyCorruptionFactor / ColonyIncomeFactor (Empire.cs 409/425), set by
// Galaxy.SetEmpireDifficultyFactors (pirates.ts) — Galaxy.*Default until then.
export const colonyCorruptionFactor = (empire: Empire): number => empire.difficultyFactors?.colonyCorruptionFactor ?? COLONY_CORRUPTION_FACTOR_DEFAULT;
export const colonyIncomeFactor = (empire: Empire): number => empire.difficultyFactors?.colonyIncomeFactor ?? COLONY_INCOME_FACTOR_DEFAULT;


// ---------------------------------------------------------------------------
// BuiltObjectList.cs helpers
// ---------------------------------------------------------------------------

// BuiltObjectList.cs TotalMobileMilitaryFirepower(empire = null) (132).
export function totalMobileMilitaryFirepower(list: unknown[], empire: Empire | null = null): number {
    let num = 0;
    for (const builtObject of builtObjectsOf(list)) {
        if (builtObject != null && !builtObject.hasBeenDestroyed && builtObject.role === BuiltObjectRole.Military && builtObject.unbuiltComponentCount <= 0 && builtObject.topSpeed > 0 && (empire === null || builtObject.empire === empire)) {
            num = (num + builtObject.firepowerRaw) | 0;
        }
    }
    return num;
}

// BuiltObjectList.cs CountBySubRole (190).
export function countBySubRole(list: unknown[], subRole: BuiltObjectSubRole): number {
    let num = 0;
    for (const builtObject of builtObjectsOf(list)) {
        if (builtObject != null && builtObject.subRole === subRole) num++;
    }
    return num;
}

// BuiltObjectList.cs CountCompletedBySubRole (204).
export function countCompletedBySubRole(list: unknown[], subRole: BuiltObjectSubRole): number {
    let num = 0;
    for (const builtObject of builtObjectsOf(list)) {
        if (builtObject != null && builtObject.subRole === subRole && builtObject.builtAt == null && builtObject.unbuiltComponentCount <= 0 && !builtObject.hasBeenDestroyed) num++;
    }
    return num;
}

// ---------------------------------------------------------------------------
// Prices (Galaxy.ComponentCurrentPrices) and Design helpers
// ---------------------------------------------------------------------------

/**
 * Galaxy.ResourceCurrentPrices[resourceId] (Galaxy.cs; initialised from ResourceDefinition.BasePrice, Galaxy.4.cs 2175,
 * then moved by Galaxy.ReviewResourcePrices — market.ts, Start.2.cs 1103 and every long Galaxy.DoTasks). The shared
 * per-galaxy array lives in design.ts (galaxyResourceCurrentPrices).
 * (Galaxy.ComponentCurrentPrices / Design.CalculateCurrentPurchasePrice /
 * Design.MaintenanceSavings / ExtractionLuxury come from design.ts, task M3a.)
 */
export function resourceCurrentPrice(galaxy: Galaxy, resourceId: number): number {
    return galaxyResourceCurrentPrices(galaxy)[resourceId];
}

// DesignList.cs FindNewestCanBuild(subRole) (140): the empire is the first design's owner.
export function designsFindNewestCanBuild(designs: Design[], subRole: BuiltObjectSubRole): Design | null {
    let empire: Empire | null = null;
    if (designs.length > 0 && designs[0] != null) empire = designs[0].empire as Empire | null;
    return findNewestCanBuild(designs, subRole, empire);
}

/**
 * Empire.10.cs CanBuildBuiltObject(builtObject, colony = null) (554/559), for the
 * probe `new BuiltObject(design, string.Empty, _Galaxy)` ProjectPrivateForceStructure
 * builds: the BuiltObject ctor (BuiltObject.cs 1560) copies Role / SubRole /
 * Design from the design and draws no Rnd, so the design stands in for it.
 */
export function canBuildBuiltObject(empire: Empire, design: Design, colony: Habitat | null = null): boolean {
    const S = BuiltObjectSubRole;
    const role = design.role;
    const subRole = design.subRole;
    if (colony !== null) {
        if (role === BuiltObjectRole.Base) return true;
        if (subRole === S.ColonyShip) {
            if (design.size <= empire.maximumConstructionSizeBase(design.subRole)) {
                // Galaxy.BuildColonyShipPopulationRequirement = 500000000 (Galaxy.3.cs 5001).
                return colony.population != null && colony.population.totalAmount >= 500000000;
            }
            return false;
        }
        if (subRole === S.ConstructionShip || subRole === S.ResupplyShip) {
            return design.size <= empire.maximumConstructionSizeBase(design.subRole);
        }
        return false;
    }
    if (subRole === S.ColonyShip || subRole === S.ConstructionShip || subRole === S.ResupplyShip) return false;
    if (empire.pirateEmpireBaseHabitat === null && (subRole === S.SmallSpacePort || subRole === S.MediumSpacePort || subRole === S.LargeSpacePort)) return false;
    let num = 0;
    if (role !== BuiltObjectRole.Base) {
        num = !design.isPlanetDestroyer ? empire.maximumConstructionSize(subRole) : empire.maximumConstructionSizeBase();
    } else {
        num = empire.maximumConstructionSizeBase(subRole);
        if (empire.pirateEmpireBaseHabitat !== null && (subRole === S.SmallSpacePort || subRole === S.MediumSpacePort || subRole === S.LargeSpacePort)) num = 2147483647;
    }
    if (design.size <= num) {
        if (subRole === S.Carrier) return empire.canBuildCarriers;
        // (Unreachable in C# too: ResupplyShip returned false above.)
        if ((subRole as BuiltObjectSubRole) === S.ResupplyShip) return empire.canBuildResupplyShips;
        return true;
    }
    return false;
}

// ---------------------------------------------------------------------------
// Empire tech / colony helpers
// ---------------------------------------------------------------------------

// Empire.3.cs CheckEmpireHasHyperDriveTech (3593).
export function checkEmpireHasHyperDriveTech(empire: Empire | null): boolean {
    return empire !== null && empire.research.getLatestComponent(ComponentType.HyperDrive) !== null;
}

// Empire.3.cs CheckEmpireHasColonizationTech (3544).
export function checkEmpireHasColonizationTech(empire: Empire | null): boolean {
    return empire !== null && empire.research.getLatestComponent(ComponentType.HabitationColonization) !== null;
}

/**
 * Empire.TroopCanRecruitInfantry / Armored / Artillery / SpecialForces (Empire.cs), the flags Empire.3.cs
 * ReviewTroopTypes (2299-2454, empire.ts reviewTroopTypes) writes — read directly by
 * CalculateStateExpenditureBalance (Empire.9.cs 4944).
 */
export function troopCanRecruitFlags(empire: Empire): { infantry: boolean; armored: boolean; artillery: boolean; specialForces: boolean } {
    return {
        infantry: empire.troopCanRecruitInfantry,
        armored: empire.troopCanRecruitArmored,
        artillery: empire.troopCanRecruitArtillery,
        specialForces: empire.troopCanRecruitSpecialForces,
    };
}

// Empire.cs TotalColonyStrategicValue (1543) / Habitat.cs StrategicValue (309).
export function totalColonyStrategicValue(empire: Empire): number {
    let num = 0;
    for (const habitat of empire.colonies) {
        // Habitat.cs 313 reads the DevelopmentLevel property (447), not _DevelopmentLevel.
        // (int)(long / 1000000): unchecked long→int wraps (| 0).
        const val = Math.imul(habitatDevelopmentLevel(habitat), Math.trunc(habitat.population.totalAmount / 1000000) | 0);
        num = (num + Math.max(10000, val)) | 0;
    }
    return num;
}

// Empire.7.cs DetermineEmpireSystems(empire, mustOwnColonies = false) (2844).
export function determineEmpireSystems(galaxy: Galaxy, empire: Empire, mustOwnColonies = false): Habitat[] {
    const habitatList: Habitat[] = [];
    for (const habitat of empire.colonies) {
        if (!mustOwnColonies || habitat.owner === empire) {
            const habitat2 = galaxy.determineHabitatSystemStar(habitat);
            if (habitat2 != null && habitatList.indexOf(habitat2) < 0) habitatList.push(habitat2);
        }
    }
    return habitatList;
}

// Empire.10.cs DetermineLargestColonyInEachSystem (222).
export function determineLargestColonyInEachSystem(galaxy: Galaxy, empire: Empire): Habitat[] {
    const habitatList: Habitat[] = [];
    const habitatList2 = determineEmpireSystems(galaxy, empire);
    for (const habitat of habitatList2) {
        const habitatList3: Habitat[] = [];
        for (const habitat2 of empire.colonies) {
            if (habitat2.systemIndex === habitat.systemIndex) habitatList3.push(habitat2);
        }
        if (habitatList3.length <= 0) continue;
        let habitat3 = habitatList3[0];
        for (const item of habitatList3) {
            if (item.population.totalAmount > habitat3.population.totalAmount) habitat3 = item;
        }
        habitatList.push(habitat3);
    }
    return habitatList;
}

// HabitatList.cs CountMigrationFactorBelow (553): (double)habitat.MigrationFactor < (double)migrationFactor, both
// float (Habitat._MigrationFactor is written by CalculateMigrationFactor, Habitat.cs 1162, colonyTick.ts).
function countMigrationFactorBelow(colonies: Habitat[], migrationFactor: number): number {
    let num = 0;
    for (const habitat of colonies) {
        if (habitat != null && !habitat.hasBeenDestroyed && f32(habitat.migrationFactor) < f32(migrationFactor)) num++;
    }
    return num;
}

// HabitatList.cs CountPopulationAbove (565).
function countPopulationAbove(colonies: Habitat[], populationAmount: number): number {
    let num = 0;
    for (const habitat of colonies) {
        if (habitat != null && !habitat.hasBeenDestroyed && habitat.population != null && habitat.population.totalAmount > populationAmount) num++;
    }
    return num;
}

// Empire.9.cs CheckAtWar (1375).
export function checkAtWar(empire: Empire): boolean {
    for (const diplomaticRelation of diplomaticRelationsOf(empire)) {
        if (diplomaticRelation.type === DiplomaticRelationType.War) return true;
    }
    return false;
}

// ---------------------------------------------------------------------------
// Colony revenue (Habitat.cs)
// ---------------------------------------------------------------------------

// Empire.4.cs IdentifyEmpireCapitals (3340): construction/facilities.ts (M4i, with the regional capitals).
export function identifyEmpireCapitals(empire: Empire): Habitat[] {
    return identifyEmpireCapitalsWithRegional(empire);
}

// Habitat.cs RecalculateDistanceFactor() (6121) / (empireCapitals) (6127).
export function recalculateDistanceFactor(galaxy: Galaxy, h: Habitat): void {
    // C#: Empire.IdentifyEmpireCapitals() (NullReferenceException without an owner; callers pass colonies).
    const empireCapitals = h.empire !== null ? identifyEmpireCapitals(h.empire) : null;
    recalculateDistanceFactorWithCapitals(galaxy, h, empireCapitals);
}

// Habitat.cs RecalculateDistanceFactor(empireCapitals) (6127).
export function recalculateDistanceFactorWithCapitals(galaxy: Galaxy, h: Habitat, empireCapitals: Habitat[] | null): void {
    if (h.empire !== null && empireCapitals !== null && empireCapitals.length > 0) {
        let num = Number.MAX_VALUE;
        for (const cap of empireCapitals) {
            const num2 = galaxy.calculateDistance(h.xpos, h.ypos, cap.xpos, cap.ypos);
            if (num2 < num) num = num2;
        }
        const num3 = galaxy.sizeX * 0.6;
        h.distanceFactor = f32(Math.max(0.0, Math.min(1.0, num / num3)));
    } else if (h.empire !== null && h.empire.pirateEmpireBaseHabitat !== null) {
        const b = h.empire.pirateEmpireBaseHabitat;
        const num4 = galaxy.calculateDistance(h.xpos, h.ypos, b.xpos, b.ypos);
        const num5 = galaxy.sizeX * 0.6;
        h.distanceFactor = f32(Math.max(0.0, Math.min(1.0, num4 / num5)));
    } else {
        h.distanceFactor = 0;
    }
}

// Habitat.cs Corruption (765).
export function habitatCorruption(galaxy: Galaxy, h: Habitat): number {
    let val = 0.0;
    const empire = h.empire;
    if (empire !== null && h.population != null) {
        let num = COLONY_CORRUPTION_POPULATION_THRESHHOLD;
        if (empire.pirateEmpireBaseHabitat !== null) num = 0;
        let num2 = 0.0;
        const totalAmount = h.population.totalAmount;
        if (empire !== galaxy.independentEmpire && totalAmount > num) {
            num2 = totalAmount / 200000000.0 / 100.0;
            if (empire.pirateEmpireBaseHabitat !== null) num2 = totalAmount / 50000000.0 / 100.0;
            num2 = Math.max(0.0, Math.min(num2, 0.7));
            const gov = empireGovernmentAttributes(empire);
            if (gov !== null) num2 *= gov.corruption;
            num2 *= colonyCorruptionFactor(empire);
        }
        // Empire.Corruption (Empire.cs 70), the cache written by RecalculateEmpireCorruption
        // (Empire.4.cs 3411; taxes.ts): 0.0 until first written (the periodic block of
        // GenerateEmpire's DoTasks, Empire.1.cs 3533 — empireGeneration.ts).
        const empireCorruption = empire.corruption;
        val = num2 * (1.0 + empireCorruption) * Math.sqrt(h.distanceFactor);
        // Habitat.cs 792-809 _PirateColonyControl bonus (ported by M4s2).
        if (h.pirateColonyControl != null && h.pirateColonyControl.count > 0) {
            let num3 = 0.0;
            const highestControl = h.pirateColonyControl.getHighestControl();
            if (highestControl !== null) num3 = Math.fround(highestControl.controlLevel / Math.fround(10));
            if (h.facilities != null) {
                const planetaryFacility = facilitiesFindBestPirateFacility(h.facilities, true, true);
                if (planetaryFacility !== null) num3 += planetaryFacility.value3 / 100.0;
            }
            val += num3;
        }
        // Habitat.cs 810-818: colony characters (excluding leaders) + Empire.Leader.ColonyCorruption.
        const num4 = resolveCharacterColonyCorruptionBonus(h);
        const num5 = 1.0 - num4 / 100.0;
        val *= num5;
        val *= empire.corruptionMultiplier;
        val = Math.min(0.8, val);
    }
    return Math.min(1.0, Math.max(0.0, val));
}

// Habitat.cs AnnualRevenue (830).
export function habitatAnnualRevenue(galaxy: Galaxy, h: Habitat): number {
    let num = 0.0;
    let num2 = 0;
    if (h.population != null) num2 = h.population.totalAmount;
    let divisor = COLONY_REVENUE_DIVISOR;
    const empire = h.empire;
    if (empire !== null && empire !== galaxy.independentEmpire && empire.pirateEmpireBaseHabitat === null) {
        // Empire.ColonyRevenueDivisor (Empire.cs 72) = Galaxy.ColonyRevenueDivisor;
        // only Bacon custom-difficulty settings change it (not ported).
        divisor = COLONY_REVENUE_DIVISOR;
    }
    const quality = h.quality;
    const num3 = (quality - 0.5) * 2.0;
    // Habitat.cs 848/852 read the DevelopmentLevel property (447), not _DevelopmentLevel.
    if (quality < 0.5) {
        num = (((num2 * num3 * (100.0 - habitatDevelopmentLevel(h) / 2.0)) * (0.5 + habitatCorruption(galaxy, h))) / divisor);
    } else {
        num = (((num2 * habitatDevelopmentLevel(h)) * (1.0 - habitatCorruption(galaxy, h))) * num3) / divisor;
        // Habitat._IncomeFactor (RecalculateCriticalResourceSupplyFactors, taxes.ts).
        num *= h.incomeFactor;
        if (empire !== null && empire !== galaxy.independentEmpire) {
            // Empire.TradeBonus (ReviewEmpireAbilityBonuses, treasury.ts).
            num *= 1.0 + empire.tradeBonus;
            const gov = empireGovernmentAttributes(empire);
            if (gov !== null) num *= gov.tradeBonus;
            // Habitat.SlaveryBonusFactor (float; ReviewColonyPopulationPolicy, colonyTick.ts).
            num *= h.slaveryBonusFactor;
            // Empire.SpecialBonusWealth (ReviewSpecialBonusesRuinsWonders, treasury.ts).
            num *= 1.0 + empire.specialBonusWealth;
            // Habitat._ResourceBonuses (RecalculateCriticalResourceSupplyBonuses, taxes.ts).
            const num4 = 1.0 + resourceBonusTotalByEffectType(h, ColonyResourceEffect.IncomeBoost) / 100.0;
            num *= num4;
        }
    }
    // Habitat.cs 867-875: colony characters (excluding leaders) + Empire.Leader.ColonyIncome.
    const num5 = resolveCharacterColonyIncomeBonus(h);
    const num6 = 1.0 + num5 / 100.0;
    num *= num6;
    // Habitat.cs 878-882: a raided colony loses RaidEconomyDamageFactor of its revenue.
    if (h.raidCountdown > 0) {
        const raidEconomyDamageFactor = habitatRaidEconomyDamageFactor(h);
        num *= 1.0 - raidEconomyDamageFactor;
    }
    if (empire !== null) num *= colonyIncomeFactor(empire);
    return num;
}

/**
 * Habitat.cs RecalculateAnnualTaxRevenue (6083): writes the Habitat
 * _AnnualTaxRevenue snapshot. C# calls it from TakeOwnershipOfColony
 * (Empire.1.cs 269) and from the DoTasks tax steps (ReviewTaxes,
 * RecalculateColonyTaxRevenues — skipped here, see empireGeneration.ts).
 * Habitat.TaxRate is written by Empire.SetColonyTaxRate (taxes.ts);
 * TaxComplianceRate and RecalculateCriticalResourceSupplyBonuses are in taxes.ts.
 */
export function recalculateAnnualTaxRevenue(galaxy: Galaxy, h: Habitat): void {
    if (h.empire !== null) {
        recalculateCriticalResourceSupplyBonuses(galaxy, h);
        // Mod layer (19g-5): a scenario may replace the rate (a frontier sector's local override); stock = TaxRate.
        const taxRate = galaxy.scenario !== null ? scenarioQuery(galaxy, 'colonyTaxRate', f32(h.taxRate), { habitat: h, empire: h.empire }) : f32(h.taxRate);
        h.annualTaxRevenue = habitatAnnualRevenue(galaxy, h) * taxRate * taxComplianceRate(galaxy, h);
        if (galaxy.scenario !== null) h.annualTaxRevenue = scenarioQuery(galaxy, 'colonyTaxRevenue', h.annualTaxRevenue, { habitat: h, empire: h.empire }); // mod layer
        h.annualTaxRevenue = Math.max(0.0, h.annualTaxRevenue);
        let num = COLONY_STATE_SUPPORT_COST;
        if (h.population != null) {
            const num2 = 100000000.0;
            const num3 = h.population.totalAmount;
            if (num3 < num2) {
                let flag = false;
                if (h.empire !== null && h.empire.capital !== null && h.empire.capital === h) flag = true;
                if (!flag) {
                    const num4 = 1.0 + (num2 - num3) / 30000000.0;
                    num *= num4;
                }
            }
        }
        h.annualTaxRevenue -= num;
    } else {
        h.annualTaxRevenue = 0.0;
    }
}

// Empire.10.cs RecalculateColonyTaxRevenues (43).
export function recalculateColonyTaxRevenues(galaxy: Galaxy, empire: Empire): void {
    for (const habitat of empire.colonies) {
        if (habitat != null && habitat.empire === empire) recalculateAnnualTaxRevenue(galaxy, habitat);
    }
}

// ---------------------------------------------------------------------------
// Empire economy (Empire.cs properties)
// ---------------------------------------------------------------------------

// Habitat.Rebelling (Empire.cs 1683 AnnualTaxRevenue skips a rebelling colony's revenue).
const habitatRebelling = (h: Habitat): boolean => h.rebelling;

function revenueDropoff(num: number, totalPopulation: number, empire: Empire): number {
    if (totalPopulation > REVENUE_DROPOFF_POPULATION_THRESHHOLD_MIN) {
        const num3 = totalPopulation - REVENUE_DROPOFF_POPULATION_THRESHHOLD_MIN;
        const num4 = Math.min(num3, REVENUE_DROPOFF_POPULATION_THRESHHOLD_MAX - REVENUE_DROPOFF_POPULATION_THRESHHOLD_MIN);
        const num5 = num4 / (REVENUE_DROPOFF_POPULATION_THRESHHOLD_MAX - REVENUE_DROPOFF_POPULATION_THRESHHOLD_MIN);
        const num6 = num5 * REVENUE_DROPOFF_RATE;
        let num7 = (num3 / totalPopulation) * num6;
        const gov = empireGovernmentAttributes(empire);
        if (gov !== null) num7 *= gov.corruption;
        const num8 = num * num7;
        num -= num8;
    }
    if (num < 0.0) num = 0.0;
    return num;
}

// Empire.cs AnnualTaxRevenue (1651).
export function annualTaxRevenue(galaxy: Galaxy, empire: Empire): number {
    let num = 0.0;
    let num2 = 0;
    for (const habitat of empire.colonies) {
        if (habitat == null || habitat.empire !== empire || (empire.pirateEmpireBaseHabitat !== null && checkColonyRevenueFromPirateControl(habitat, empire)) || habitat.population == null) continue;
        num2 += habitat.population.totalAmount;
        if (!habitatRebelling(habitat)) {
            if (Number.isNaN(habitatAnnualRevenue(galaxy, habitat))) recalculateAnnualTaxRevenue(galaxy, habitat);
            num += habitat.annualTaxRevenue;
        }
    }
    return revenueDropoff(num, num2, empire);
}

// Empire.cs PrivateAnnualRevenueUnadjusted (1622).
export function privateAnnualRevenueUnadjusted(galaxy: Galaxy, empire: Empire): number {
    let num = 0.0;
    for (const habitat of empire.colonies) {
        if (habitat != null && habitat.empire === empire && (empire.pirateEmpireBaseHabitat === null || !checkColonyRevenueFromPirateControl(habitat, empire))) {
            num += habitatAnnualRevenue(galaxy, habitat);
        }
    }
    return num;
}

// Empire.cs PrivateAnnualRevenue (1639).
export function privateAnnualRevenue(galaxy: Galaxy, empire: Empire): number {
    const num = privateAnnualRevenueUnadjusted(galaxy, empire);
    // Empire._TotalPopulation (Empire.cs 509/2216), the cache written by
    // EvaluateColonyVariables (Empire.4.cs 3306) / RecalculateEmpirePopulation (3460):
    // at GenerateEmpire's DoTasks the periodic block has just written it (Empire.1.cs
    // 3531, empireGeneration.ts) before the long block's projections read it.
    const totalPopulation = empire.totalPopulation;
    return revenueDropoff(num, totalPopulation, empire);
}

// Empire.6.cs GetPrivateAnnualRevenue (547).
export function getPrivateAnnualRevenue(galaxy: Galaxy, empire: Empire): number {
    const gov = empireGovernmentAttributes(empire);
    if (gov !== null && gov.specialFunctionCode === 1) return annualTaxRevenue(galaxy, empire);
    return privateAnnualRevenue(galaxy, empire);
}

// Empire.4.cs GetPrivateFunds (1757).
export function getPrivateFunds(empire: Empire): number {
    const gov = empireGovernmentAttributes(empire);
    if (gov !== null && gov.specialFunctionCode === 1) return empire.stateMoney;
    return empire.privateMoney;
}

// Empire.cs AnnualStateMaintenance (1991).
export function annualStateMaintenance(empire: Empire): number {
    let num = 0.0;
    for (const builtObject of builtObjectsOf(empire.builtObjects)) num += builtObject.annualSupportCost;
    const num2 = num * shipMaintenanceSavings(empire);
    return num - num2;
}

// Empire.cs AnnualPrivateMaintenance (2116) (added by M4i: CalculateAccurateAnnualCashflowIncludingUnderConstruction).
export function annualPrivateMaintenance(empire: Empire): number {
    let num = 0.0;
    for (const builtObject of builtObjectsOf(empire.privateBuiltObjects)) num += builtObject.annualSupportCost;
    const num2 = num * shipMaintenanceSavings(empire);
    return num - num2;
}

// Empire.cs AnnualPrivateMaintenanceExcludingUnderConstruction (2138).
export function annualPrivateMaintenanceExcludingUnderConstruction(empire: Empire): number {
    let num = 0.0;
    for (const builtObject of builtObjectsOf(empire.privateBuiltObjects)) {
        if (builtObject.unbuiltComponentCount <= 0) num += builtObject.annualSupportCost;
    }
    const num2 = num * shipMaintenanceSavings(empire);
    return num - num2;
}

// Empire.cs AnnualTroopMaintenance (2025) / AnnualTroopMaintenanceIncludeRecruiting (2070): ported in troops.ts.
import { annualTroopMaintenance, annualTroopMaintenanceIncludeRecruiting } from './troops';
export { annualTroopMaintenance, annualTroopMaintenanceIncludeRecruiting };

// Empire.cs MinimumTroopSpending (2187).
function minimumTroopSpending(galaxy: Galaxy, empire: Empire): number {
    const num2 = calculateAccurateAnnualIncome(galaxy, empire);
    let num3 = num2 * SPENDING_TROOP_PERCENTAGE;
    if (num3 < TROOP_ANNUAL_MAINTENANCE) num3 = 0.0;
    const val = annualTroopMaintenance(empire) * 1.05;
    return Math.min(val, num3);
}

// Empire.1.cs CalculateAnnualSubjugationTributeIncome (1013).
export function calculateAnnualSubjugationTributeIncome(galaxy: Galaxy, empire: Empire): number {
    let num = 0.0;
    for (const diplomaticRelation of diplomaticRelationsOf(empire)) {
        if (diplomaticRelation.type === DiplomaticRelationType.SubjugatedDominion && diplomaticRelation.initiator === empire) {
            const otherEmpire = diplomaticRelation.otherEmpire;
            // Empire.1.cs 1021: otherEmpire.AnnualTaxRevenue + ThisYearsForeignTradeBonuses + ThisYearsSpacePortIncome.
            const num2 = annualTaxRevenue(galaxy, otherEmpire) + thisYearsForeignTradeBonuses(otherEmpire) + thisYearsSpacePortIncome(galaxy, otherEmpire);
            num += num2 * baconSettings.subjugationTributePercentage;
        }
    }
    return num;
}

// Empire.cs AnnualSubjugationTribute (1756).
export function annualSubjugationTribute(galaxy: Galaxy, empire: Empire): number {
    let num = 0.0;
    // Empire.cs 1761: AnnualTaxRevenue + ThisYearsForeignTradeBonuses + ThisYearsSpacePortIncome.
    const num2 = annualTaxRevenue(galaxy, empire) + thisYearsForeignTradeBonuses(empire) + thisYearsSpacePortIncome(galaxy, empire);
    for (const diplomaticRelation of diplomaticRelationsOf(empire)) {
        if (diplomaticRelation.type === DiplomaticRelationType.SubjugatedDominion && diplomaticRelation.initiator !== empire) {
            const num3 = num2 * baconSettings.subjugationTributePercentage;
            num += num3;
        }
    }
    return num;
}

// Empire.cs AnnualPirateProtection (1775).
export function annualPirateProtection(empire: Empire): number {
    let num = 0.0;
    if (empire.pirateRelations != null) {
        for (let i = 0; i < empire.pirateRelations.count; i++) {
            const pirateRelation = empire.pirateRelations.get(i);
            if (pirateRelation != null && pirateRelation.type === PirateRelationType.Protection && pirateRelation.otherEmpire !== null) {
                // Empire.cs 1787: OtherEmpire.ObtainPirateRelation(this) (may add the relation).
                const pirateRelation2 = obtainPirateRelation(pirateRelation.otherEmpire, empire);
                if (pirateRelation2 != null) {
                    num += pirateRelation2.monthlyProtectionFeeToThisEmpire * 12.0;
                }
            }
        }
    }
    return num;
}

// Empire.cs AnnualFacilityMaintenance (1739).
export function annualFacilityMaintenance(empire: Empire): number {
    let num = 0.0;
    for (const habitat of empire.colonies) {
        if (habitat != null && habitat.owner === empire && habitat.facilities !== null) {
            num += facilitiesCalculateAnnualMaintenance(habitat.facilities);
        }
    }
    return num;
}

// Empire.3.cs CalculateAccurateAnnualIncome (4199).
export function calculateAccurateAnnualIncome(galaxy: Galaxy, empire: Empire): number {
    if (empire.pirateEmpireBaseHabitat !== null) {
        // Empire.3.cs 4203 CalculatePirateIncome (treasury.ts; reached from EvaluateColonyVariablesPirate).
        return calculatePirateIncome(galaxy, empire);
    }
    let num = annualTaxRevenue(galaxy, empire) + calculateAnnualSubjugationTributeIncome(galaxy, empire);
    const gov = empireGovernmentAttributes(empire);
    if (gov !== null && gov.specialFunctionCode === 1) num -= annualPrivateMaintenanceExcludingUnderConstruction(empire);
    return num;
}

// Empire.9.cs CalculateSpareAnnualRevenue(newCosts) (5345).
export function calculateSpareAnnualRevenue(galaxy: Galaxy, empire: Empire, newCosts: number): number {
    let num = calculateAccurateAnnualIncome(galaxy, empire);
    num -= Math.max(annualTroopMaintenanceIncludeRecruiting(empire), minimumTroopSpending(galaxy, empire));
    num -= annualSubjugationTribute(galaxy, empire);
    num -= annualPirateProtection(empire);
    // Empire.9.cs 5351: ThisYearsStateFuelCosts (written by the refuelling code, logistics/refuel.ts).
    num -= empire.thisYearsStateFuelCosts;
    num -= annualFacilityMaintenance(empire);
    return num - newCosts;
}

// Empire.9.cs CalculateStateExpenditureBalance(annualIncome, out ...) (4944).
export function calculateStateExpenditureBalance(empire: Empire, annualIncome: number): { shipMaintenancePortion: number; troopMaintenancePortion: number; facilityMaintenancePortion: number } {
    const policy = empire.policy!;
    let shipMaintenancePortion = 0.63;
    let troopMaintenancePortion = 0.25;
    let facilityMaintenancePortion = 0.12;
    shipMaintenancePortion *= Math.sqrt(Math.sqrt(0.5 * (1.0 + policy.constructionMilitary)));
    let num = 0.0;
    let num2 = 0;
    const num3 = Math.sqrt(policy.invasionOverkillFactor);
    const troops = troopCanRecruitFlags(empire);
    if (troops.infantry) {
        num += policy.troopRecruitInfantryLevel;
        num2++;
    }
    if (troops.armored) {
        num += policy.troopRecruitArmorLevel * num3;
        num2++;
    }
    if (troops.artillery) {
        num += policy.troopRecruitArtilleryLevel;
        num2++;
    }
    if (troops.specialForces) {
        num += policy.troopRecruitSpecialForcesLevel * num3;
        num2++;
    }
    num /= num2;
    troopMaintenancePortion *= Math.sqrt(num);
    troopMaintenancePortion *= Math.sqrt(0.5 * (1.0 + policy.troopGarrisonLevel));
    shipMaintenancePortion = Math.min(0.7, Math.max(0.55, shipMaintenancePortion));
    troopMaintenancePortion = Math.min(0.3, Math.max(0.2, troopMaintenancePortion));
    facilityMaintenancePortion = Math.min(0.15, Math.max(0.08, facilityMaintenancePortion));
    let num4 = 0.17;
    if (annualIncome > 100000.0) {
        const num5 = Math.min(1.0, (annualIncome - 100000.0) / 200000.0);
        num4 -= num5 * 0.07;
    }
    num4 *= Math.sqrt(policy.researchPriority);
    num4 = Math.min(0.2, Math.max(0.06, num4));
    const num6 = 1.0 - num4;
    const num7 = shipMaintenancePortion + troopMaintenancePortion + facilityMaintenancePortion;
    shipMaintenancePortion *= num6 / num7;
    troopMaintenancePortion *= num6 / num7;
    facilityMaintenancePortion *= num6 / num7;
    return { shipMaintenancePortion, troopMaintenancePortion, facilityMaintenancePortion };
}

// Empire.10.cs CurrentStateForceStructure(out annualSupportCosts) (200) /
// CurrentPrivateForceStructure (178).
function currentForceStructure(empire: Empire, list: unknown[], currentStarDate: number): { projections: ForceStructureProjectionList; annualSupportCosts: number } {
    const forceStructureProjectionList = new ForceStructureProjectionList();
    let annualSupportCosts = 0.0;
    for (const builtObject of builtObjectsOf(list)) {
        let p = forceStructureProjectionList.getBySubRole(builtObject.subRole);
        if (p === null) {
            p = new ForceStructureProjection(builtObject.subRole, 0, currentStarDate);
            forceStructureProjectionList.add(p);
        }
        p.amount = p.amount + 1;
        annualSupportCosts += builtObject.annualSupportCost;
    }
    const num = annualSupportCosts * shipMaintenanceSavings(empire);
    annualSupportCosts -= num;
    return { projections: forceStructureProjectionList, annualSupportCosts };
}
export const currentStateForceStructure = (empire: Empire, currentStarDate: number) => currentForceStructure(empire, empire.builtObjects, currentStarDate);
export const currentPrivateForceStructure = (empire: Empire, currentStarDate: number) => currentForceStructure(empire, empire.privateBuiltObjects, currentStarDate);

// Empire.9.cs CalculateSupportCost(design) (5391).
export function calculateSupportCost(galaxy: Galaxy, empire: Empire, design: Design | null): number {
    let result = 0.0;
    if (design !== null) {
        const num = design.calculateCurrentPurchasePrice(galaxy) / baconSettings.shipMarkupFactor + 1.0;
        const num2 = baconSettings.shipMaintenanceCostPerSizeUnit * design.size;
        const num3 = num + num2;
        const num4 = design.maintenanceSavings * num3;
        let num5 = 1.0;
        const gov = empireGovernmentAttributes(empire);
        if (gov !== null) num5 = gov.maintenanceCosts;
        if (empire.pirateEmpireBaseHabitat !== null) {
            // Empire.2.cs 3612 (double)_Galaxy.BaseTechCost / 120000.0.
            let d = galaxy.baseTechCost / 120000.0;
            d = Math.sqrt(d);
            num5 *= galaxy.pirateShipMaintenanceFactor * d;
            switch (design.subRole) {
                case BuiltObjectSubRole.SmallFreighter:
                case BuiltObjectSubRole.MediumFreighter:
                case BuiltObjectSubRole.LargeFreighter:
                case BuiltObjectSubRole.PassengerShip:
                case BuiltObjectSubRole.GasMiningShip:
                case BuiltObjectSubRole.MiningShip:
                    num5 = 0.0;
                    break;
            }
        }
        result = (num3 - num4) * num5;
    }
    return result;
}

// Empire.9.cs EstimateForceStructureSupportCostSingleItem (5427).
function estimateForceStructureSupportCostSingleItem(galaxy: Galaxy, empire: Empire, projection: ForceStructureProjection): number {
    let result = 0.0;
    const design = designsFindNewestCanBuild(empire.designs, projection.subRole);
    if (design !== null) result = calculateSupportCost(galaxy, empire, design);
    return result;
}

// Empire.9.cs EstimateForceStructureSupportCost(projection) (5385) / (list) (5438).
export function estimateForceStructureSupportCost(galaxy: Galaxy, empire: Empire, forceStructure: ForceStructureProjectionList): number {
    let num = 0.0;
    for (const item of forceStructure) {
        const num1 = estimateForceStructureSupportCostSingleItem(galaxy, empire, item);
        num += item.amount * num1;
    }
    return num;
}

// Empire.9.cs CalculateSupportabilityFactor (5358).
function calculateSupportabilityFactor(galaxy: Galaxy, empire: Empire, forceProjections: ForceStructureProjectionList, currentStarDate: number): number {
    let num = calculateSpareAnnualRevenue(galaxy, empire, 0.0);
    const current = currentStateForceStructure(empire, currentStarDate);
    const forceStructure = forceProjections.diff(current.projections);
    const num2 = estimateForceStructureSupportCost(galaxy, empire, forceStructure);
    const num3 = current.annualSupportCosts + num2;
    const num4 = empire.stateMoney / num3;
    let num5 = 1.0;
    let num6 = ALLOWABLE_YEARS_MAINTENANCE_FROM_CASH_ON_HAND;
    if (checkAtWar(empire)) num6 = 2.0;
    if (num4 < num6) {
        num *= 0.95;
        num5 = num / num3;
    }
    if (empire.buildFactor <= 0.0) empire.buildFactor = 1.0;
    return num5 * empire.buildFactor;
}

export interface ForceStructureContext {
    /** Galaxy.CurrentStarDate (not tracked on the TS Galaxy yet). */
    currentStarDate: number;
    /** Galaxy.DifficultyLevel (game option; not kept on the TS Galaxy yet). */
    difficultyLevel: number;
}

// ---------------------------------------------------------------------------
// Empire.9.cs ProjectPrivateForceStructure (4767)
// ---------------------------------------------------------------------------

export function projectPrivateForceStructure(galaxy: Galaxy, empire: Empire, ctx: ForceStructureContext): void {
    const projections = new ForceStructureProjectionList();
    empire.privateForceStructureProjections = projections;
    const currentStarDate = ctx.currentStarDate;
    const habitatList = determineLargestColonyInEachSystem(galaxy, empire);
    // Empire.9.cs 4772: OrderList orders = _Galaxy.Orders.GetOrders(this) (OrderList.cs 217).
    const ordersCount = galaxy.orders.getOrdersForEmpire(empire).count;
    let num = 1 + csToInt32(ordersCount * 0.45 * 0.85);
    let num2 = 1 + csToInt32(ordersCount * 0.35 * 0.85);
    let num3 = 1 + csToInt32(ordersCount * 0.2 * 0.85);
    const colonies = empire.colonies;
    const num4 = Math.max(colonies.length, empire.miningStations.length / 7.0);
    let num5 = csToInt32(num4 * 10.0);
    let num6 = csToInt32(num4 * 8.0);
    let num7 = csToInt32(num4 * 5.0);
    if (colonies.length === 1) {
        num5 = csToInt32(num5 * 1.5);
        num6 = csToInt32(num6 * 1.5);
        num7 = csToInt32(num7 * 1.5);
        if (!checkEmpireHasHyperDriveTech(empire)) {
            num = (num * 2) | 0;
            num2 = (num2 * 2) | 0;
            num3 = (num3 * 2) | 0;
        }
    } else if (colonies.length < 4) {
        num5 = csToInt32(num4 * 14.0);
        num6 = csToInt32(num4 * 11.0);
        num7 = csToInt32(num4 * 7.0);
    }
    let num8 = 0;
    // (MiningStations is never null.)
    num8 = empire.miningStations.length;
    if (num8 < 5) {
        const num9 = 5 - num8;
        num5 = csToInt32(num5 / num9);
        num6 = csToInt32(num6 / num9);
        num7 = csToInt32(num7 / num9);
    }
    if (empire.dominantRace !== null && empire.dominantRace.expanding) {
        num = Math.max(num, csToInt32(colonies.length * 2.0));
        num2 = Math.max(num2, csToInt32(colonies.length * 1.7));
        num3 = Math.max(num3, csToInt32(colonies.length * 1.3));
    }
    let num10 = 3.0;
    if (colonies.length < 2 && empire.resortBases.length <= 0) num10 = 0.0;
    const num11 = countMigrationFactorBelow(colonies, 0);
    const num12 = countPopulationAbove(colonies, 8000000000);
    const num13 = 0.2;
    // C#: `_ = (double)num11 / Math.Max(1.0, Colonies.Count);` (discarded).
    const num14 = 0.1;
    const num15 = num12 / Math.max(1.0, colonies.length);
    if (num15 < num14) num10 /= 2.0;
    if (num11 < num13) num10 /= 1.5;
    const num16 = csToInt32(colonies.length * num10);
    let design = designsFindNewestCanBuild(empire.designs, BuiltObjectSubRole.LargeFreighter);
    if (design === null || !canBuildBuiltObject(empire, design)) {
        num = (num + num3) | 0;
        num5 = (num5 + num7) | 0;
        num3 = 0;
        num7 = 0;
    }
    design = designsFindNewestCanBuild(empire.designs, BuiltObjectSubRole.MediumFreighter);
    if (design === null || !canBuildBuiltObject(empire, design)) {
        num = (num + num2) | 0;
        num5 = (num5 + num6) | 0;
        num2 = 0;
        num6 = 0;
    }
    num = Math.min(num, num5);
    num2 = Math.min(num2, num6);
    num3 = Math.min(num3, num7);
    let flag = true;
    if (empire.capital !== null) {
        const habitat = galaxy.findNearestHabitatOfType(empire.capital.xpos, empire.capital.ypos, HabitatType.Undefined, empire.capital);
        if (habitat !== null && !empire.resourceMap.checkResourcesKnown(habitat)) flag = false;
    }
    if (num8 > 0) flag = true;
    if (flag) {
        if (num > 0) projections.add(new ForceStructureProjection(BuiltObjectSubRole.SmallFreighter, num, currentStarDate));
        if (num2 > 0) projections.add(new ForceStructureProjection(BuiltObjectSubRole.MediumFreighter, num2, currentStarDate));
        if (num3 > 0) projections.add(new ForceStructureProjection(BuiltObjectSubRole.LargeFreighter, num3, currentStarDate));
        if (num16 > 0) projections.add(new ForceStructureProjection(BuiltObjectSubRole.PassengerShip, num16, currentStarDate));
    }
    let num17 = Math.max(1, csToInt32(habitatList.length * 1.5));
    if (colonies.length === 1) {
        num17 = (num17 * 2) | 0;
        if (!checkEmpireHasHyperDriveTech(empire)) num17 = (num17 * 2) | 0;
    }
    num17 = Math.min(num17, 40);
    if (flag) {
        projections.add(new ForceStructureProjection(BuiltObjectSubRole.GasMiningShip, num17, currentStarDate));
        projections.add(new ForceStructureProjection(BuiltObjectSubRole.MiningShip, num17, currentStarDate));
    }
    let privateAnnualRevenue = getPrivateAnnualRevenue(galaxy, empire);
    const current = currentPrivateForceStructure(empire, currentStarDate);
    const annualSupportCosts = current.annualSupportCosts;
    const forceStructure = projections.diff(current.projections);
    let num18 = estimateForceStructureSupportCost(galaxy, empire, forceStructure);
    if (num18 < 0.0) num18 = 0.0;
    const num19 = annualSupportCosts + num18;
    const num20 = getPrivateFunds(empire) / num19;
    let num21 = 1.0;
    if (num20 < ALLOWABLE_YEARS_MAINTENANCE_FROM_CASH_ON_HAND) {
        privateAnnualRevenue *= 0.8;
        num21 = (privateAnnualRevenue - annualSupportCosts) / num18;
        num21 = Math.max(0.0, num21);
    }
    if (!(num21 < 1.0)) return;
    for (const p of projections) {
        let amount = p.amount;
        if (amount > 0) {
            amount = p.amount = Math.max(1, csToInt32(amount * num21));
        }
    }
}

// ---------------------------------------------------------------------------
// Empire.9.cs ProjectForceStructure (4990)
// ---------------------------------------------------------------------------

export function projectForceStructure(galaxy: Galaxy, empire: Empire, ctx: ForceStructureContext): void {
    const policy = empire.policy!;
    const num = calculateAccurateAnnualIncome(galaxy, empire);
    const { shipMaintenancePortion } = calculateStateExpenditureBalance(empire, num);
    const annualStateMaintenanceValue = annualStateMaintenance(empire);
    const num2 = num * shipMaintenancePortion;
    const num3 = Math.max(1.0, num2 / annualStateMaintenanceValue);
    const projections = new ForceStructureProjectionList();
    empire.stateForceStructureProjections = projections;
    const currentStarDate = ctx.currentStarDate;
    // C#: `_ = _Galaxy.IntoleranceLevel;` (discarded).
    const num4 = totalMobileMilitaryFirepower(empire.builtObjects);
    let num5 = 0;
    let num6 = 1.0;
    for (const diplomaticRelation of diplomaticRelationsOf(empire)) {
        if (diplomaticRelation.otherEmpire === galaxy.independentEmpire || diplomaticRelation.otherEmpire.pirateEmpireBaseHabitat !== null) continue;
        // Empire.9.cs 5010: ObtainEmpireEvaluation(OtherEmpire) (taxes.ts; may add to
        // Empire.EmpireEvaluations); only its .Empire (== OtherEmpire) is read.
        const evaluationEmpire = obtainEmpireEvaluation(galaxy, empire, diplomaticRelation.otherEmpire).empire!;
        if (diplomaticRelation.type === DiplomaticRelationType.War) {
            const num7 = totalMobileMilitaryFirepower(evaluationEmpire.builtObjects);
            num5 = (num5 + num7) | 0;
            num6 += (num7 / num4) * 0.6;
            continue;
        }
        let flag = false;
        switch (diplomaticRelation.strategy) {
            case DiplomaticStrategy.Conquer:
            case DiplomaticStrategy.Defend:
            case DiplomaticStrategy.DefendPlacate:
            case DiplomaticStrategy.DefendUndermine:
                flag = true;
                break;
        }
        if (flag) {
            const num8 = totalMobileMilitaryFirepower(evaluationEmpire.builtObjects);
            num5 = (num5 + num8) | 0;
            num6 += (num8 / num4) * 0.4;
        }
    }
    if (!checkEmpireHasHyperDriveTech(empire)) {
        for (const pirateRelation of pirateRelationsOf(empire)) {
            if (pirateRelation.otherEmpire !== galaxy.independentEmpire && pirateRelation.type === PirateRelationType.None) {
                let num9 = 1;
                if (pirateRelation.otherEmpire !== null && pirateRelation.otherEmpire.builtObjects != null) {
                    num9 = totalMobileMilitaryFirepower(pirateRelation.otherEmpire.builtObjects);
                }
                num5 = (num5 + num9) | 0;
                num6 += (num9 / num4) * 0.6;
            }
        }
    }
    let num10 = Math.max(1, num5) / Math.max(1, num4);
    if (num10 < 1.0) num10 = 1.0;
    num10 = Math.max(num10, num6);
    num10 = Math.min(4.0, Math.max(1.0, num10));
    const habitatList = determineLargestColonyInEachSystem(galaxy, empire);
    const colonyCount = empire.colonies.length;
    let num11 = 80000.0;
    let num12 = 5.0;
    switch (policy.constructionMilitary) {
        case 0:
            if (colonyCount < 3) [num11, num12] = [70000.0, 10.0];
            else if (colonyCount < 5) [num11, num12] = [80000.0, 8.0];
            else if (colonyCount < 10) [num11, num12] = [90000.0, 6.5];
            else if (colonyCount < 20) [num11, num12] = [100000.0, 5.5];
            else [num11, num12] = [110000.0, 4.5];
            break;
        case 1:
            if (colonyCount < 3) [num11, num12] = [50000.0, 11.0];
            else if (colonyCount < 5) [num11, num12] = [57000.0, 9.5];
            else if (colonyCount < 10) [num11, num12] = [65000.0, 8.0];
            else if (colonyCount < 20) [num11, num12] = [70000.0, 7.0];
            else [num11, num12] = [80000.0, 6.0];
            break;
        case 2:
            if (colonyCount < 3) [num11, num12] = [25000.0, 14.0];
            else if (colonyCount < 5) [num11, num12] = [30000.0, 11.5];
            else if (colonyCount < 10) [num11, num12] = [40000.0, 10.0];
            else if (colonyCount < 20) [num11, num12] = [50000.0, 9.0];
            else [num11, num12] = [60000.0, 8.0];
            break;
    }
    if (colonyCount === 1 && (!checkEmpireHasHyperDriveTech(empire) || !checkEmpireHasColonizationTech(empire))) num12 *= 1.5;
    let num13 = Math.max(1.0, (totalColonyStrategicValue(empire) / num11) * num10 * num3);
    let num14 = 0;
    num14 += countBySubRole(empire.builtObjects, BuiltObjectSubRole.Escort);
    num14 += countBySubRole(empire.builtObjects, BuiltObjectSubRole.Frigate);
    num14 += countBySubRole(empire.builtObjects, BuiltObjectSubRole.Destroyer);
    num14 += countBySubRole(empire.builtObjects, BuiltObjectSubRole.Cruiser);
    num14 += countBySubRole(empire.builtObjects, BuiltObjectSubRole.CapitalShip);
    num14 += countBySubRole(empire.builtObjects, BuiltObjectSubRole.Carrier);
    num14 += countBySubRole(empire.builtObjects, BuiltObjectSubRole.TroopTransport);
    let val = colonyCount * num12 * num10;
    val = Math.max(val, num14 * num3);
    if (empire.dominantRace !== null && empire.dominantRace.expanding) num13 = Math.min(num13, val);
    // float num15 = Escort + Frigate + Destroyer + Cruiser + CapitalShip + TroopTransport (float adds).
    let num15 = f32(policy.constructionMilitaryEscort);
    num15 = f32(num15 + f32(policy.constructionMilitaryFrigate));
    num15 = f32(num15 + f32(policy.constructionMilitaryDestroyer));
    num15 = f32(num15 + f32(policy.constructionMilitaryCruiser));
    num15 = f32(num15 + f32(policy.constructionMilitaryCapitalShip));
    num15 = f32(num15 + f32(policy.constructionMilitaryTroopTransport));
    const num16 = (1.0 / num15) * 100.0;
    const share = (v: number) => f32(f32(v) / 100);
    let num17 = Math.max(1.0, num13 * share(policy.constructionMilitaryEscort) * num16);
    let num18 = Math.max(0.0, num13 * share(policy.constructionMilitaryFrigate) * num16);
    let num19 = Math.max(0.0, num13 * share(policy.constructionMilitaryDestroyer) * num16);
    let num20 = Math.max(0.0, num13 * share(policy.constructionMilitaryCruiser) * num16);
    let num21 = Math.max(0.0, num13 * share(policy.constructionMilitaryCapitalShip) * num16);
    let num22 = Math.max(0.0, num13 * share(policy.constructionMilitaryTroopTransport) * num16);
    let num23 = Math.max(0.0, num13 * share(policy.constructionMilitaryCarrier) * num16);
    let val2 = Math.max(0.0, num13 / 30.0);
    if (colonyCount < 5) val2 = 0.0;
    val2 = Math.min(val2, 20.0);
    let design = findNewest(empire.designs, BuiltObjectSubRole.ResupplyShip);
    if (design !== null && empire.capital !== null && !canBuildDesign(empire, design)) val2 = 0.0;
    design = findNewest(empire.designs, BuiltObjectSubRole.CapitalShip);
    if (design !== null && !canBuildDesign(empire, design)) {
        num17 += num21 / 3.0;
        num18 += num21 / 3.0;
        num19 += num21 / 3.0;
        num21 = 0.0;
    }
    design = findNewest(empire.designs, BuiltObjectSubRole.Cruiser);
    if (design !== null && !canBuildDesign(empire, design)) {
        num17 += num20 / 3.0;
        num18 += num20 / 3.0;
        num19 += num20 / 3.0;
        num20 = 0.0;
    }
    design = findNewest(empire.designs, BuiltObjectSubRole.Carrier);
    if (design !== null && !canBuildDesign(empire, design)) {
        num17 += num23 / 3.0;
        num18 += num23 / 3.0;
        num19 += num23 / 3.0;
        num23 = 0.0;
    }
    design = findNewest(empire.designs, BuiltObjectSubRole.Destroyer);
    if (design !== null && !canBuildDesign(empire, design)) {
        num17 += num19 / 2.0;
        num18 += num19 / 2.0;
        num19 = 0.0;
    }
    design = findNewest(empire.designs, BuiltObjectSubRole.TroopTransport);
    if (design !== null && !canBuildDesign(empire, design)) num22 = 0.0;
    if (!checkEmpireHasHyperDriveTech(empire)) {
        const num24 = countCompletedBySubRole(empire.builtObjects, BuiltObjectSubRole.ExplorationShip);
        const num25 = countCompletedBySubRole(empire.builtObjects, BuiltObjectSubRole.ConstructionShip);
        if (num24 <= 0 || num25 <= 0) {
            num17 = 0.0;
            num18 = 0.0;
            num19 = 0.0;
            num20 = 0.0;
            num21 = 0.0;
            num22 = 0.0;
            num23 = 0.0;
            val2 = 0.0;
        }
    }
    const num26 = 1.0;
    const num27 = 1.0;
    if (val2 > 0.0) projections.add(new ForceStructureProjection(BuiltObjectSubRole.ResupplyShip, csToInt32(val2), currentStarDate));
    let num28 = csToInt32(num17 * num26);
    if (num28 > 0) projections.add(new ForceStructureProjection(BuiltObjectSubRole.Escort, num28, currentStarDate));
    num28 = csToInt32(num18 * num26);
    if (num28 > 0) projections.add(new ForceStructureProjection(BuiltObjectSubRole.Frigate, num28, currentStarDate));
    num28 = csToInt32(num19 * Math.max(num26, num27));
    if (num28 > 0) projections.add(new ForceStructureProjection(BuiltObjectSubRole.Destroyer, num28, currentStarDate));
    num28 = csToInt32(num23 * Math.max(num26, num27));
    if (num28 > 0) projections.add(new ForceStructureProjection(BuiltObjectSubRole.Carrier, num28, currentStarDate));
    num28 = csToInt32(num20 * num27);
    if (num28 > 0) projections.add(new ForceStructureProjection(BuiltObjectSubRole.Cruiser, num28, currentStarDate));
    num28 = habitatList.length >= 3 ? csToInt32(num21 * num27) : 0;
    if (num28 > 0) projections.add(new ForceStructureProjection(BuiltObjectSubRole.CapitalShip, num28, currentStarDate));
    num28 = csToInt32(num22 * num27);
    if (num28 > 0) projections.add(new ForceStructureProjection(BuiltObjectSubRole.TroopTransport, num28, currentStarDate));
    num28 = colonyCount > 1 ? colonyCount + 6 : !checkEmpireHasHyperDriveTech(empire) ? 2 : 7;
    if (num28 < 1) num28 = 1;
    if (num28 > 12) num28 = 12;
    num28 = csToInt32(num28 * policy.explorationPriority);
    if (annualStateMaintenanceValue < num2 * 0.95 && empire !== galaxy.playerEmpire && ctx.difficultyLevel > 1.0 && checkEmpireHasHyperDriveTech(empire)) {
        num28 = csToInt32(num28 * ctx.difficultyLevel);
    }
    projections.add(new ForceStructureProjection(BuiltObjectSubRole.ExplorationShip, num28, currentStarDate));
    num28 = csToInt32(colonyCount / 0.9);
    if (colonyCount > 1 && colonyCount <= 2) num28 = 4;
    else if (colonyCount > 2 && colonyCount <= 5) num28 = 6;
    if (num28 < 3) num28 = 3;
    if (colonyCount < 2 && !checkEmpireHasHyperDriveTech(empire)) num28 = 2;
    num28 = Math.min(num28, 12);
    if (annualStateMaintenanceValue < num2 * 0.95 && empire !== galaxy.playerEmpire && ctx.difficultyLevel > 1.0 && checkEmpireHasHyperDriveTech(empire)) {
        num28 = csToInt32(num28 * ctx.difficultyLevel);
    }
    projections.add(new ForceStructureProjection(BuiltObjectSubRole.ConstructionShip, num28, currentStarDate));
    const num29 = calculateSupportabilityFactor(galaxy, empire, projections, currentStarDate);
    if (!(num29 < 1.0)) return;
    let num30 = 0;
    for (let k = 0; k < projections.count; k++) {
        const p = projections.get(k);
        const subRole = p.subRole;
        if (subRole === BuiltObjectSubRole.ExplorationShip || subRole === BuiltObjectSubRole.ConstructionShip) {
            if (empire.buildFactor < 1.0) {
                num30 = p.amount;
                num30 = p.amount = Math.max(1, csToInt32(num30 * num29));
            }
        } else {
            num30 = p.amount;
            num30 = p.amount = Math.max(1, csToInt32(num30 * num29));
        }
    }
    void num30;
}
