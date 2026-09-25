// M4j — money flow, maintenance, government, ability bonuses, difficulty factors.
//
// Ports (C# file:line above each function):
//   EmpireCounters.cs ProcessColonyRevenue 220 (empire.ts EmpireCounters)
//   Empire.1.cs  ProcessSubjugationTribute 996
//   Empire.cs    ReviewEmpireAbilityBonuses 2897, ThisYearsForeignTradeBonuses 2252, ThisYearsResortIncome 2267,
//                ThisYearsSpacePortIncome 2282, MilitaryPotency 1576
//   Empire.10.cs ReviewGovernmentEffects 55, CheckChangeGovernment 86, ChangeGovernment 4377, SelectSuitableGovernment
//                4404, HaveRevolution 4457
//   Empire.3.cs  ReviewSpecialBonusesRuinsWonders 939, CalculateAnnualCashflow 4091, CalculatePirateIncome 4161
//   Empire.4.cs  PayMaintenanceForBuiltObjects 1743, PerformPrivateTransaction 1766
//   Empire.2.cs  PayForPlanetaryFacilities 4004, PayForTroops 4010
//   Empire.7.cs  DetermineEmpiresAtWarWith 4442
//   BaconEmpire.cs AnnualStateMaintenanceExcludingUnderConstruction 608, PayAnnualMaintenanceCostForFreeTraders 621
//   Galaxy.cs    ReviewEmpireDifficultyFactors 1452
//
// Rnd: HaveRevolution (SelectSuitableGovernment, per-colony damage, disruption) draws Galaxy.Rnd; nothing else here does.

import type { Galaxy } from './galaxy';
import type { Empire } from './empire';
import type { Habitat } from './types';
import type { Race } from './data/races';
import type { Government } from './data/governments';
import { empireGovernmentAttributes, getGovernmentsStatic } from './empire';
import { REAL_SECONDS_IN_GALACTIC_YEAR, galaxyStarDate } from './tick/simTime';
import { DiplomaticRelationType } from './diplomacy';
import { PirateRelationType } from './pirateRelations';
import {
    SUBJUGATION_TRIBUTE_PERCENTAGE,
    annualFacilityMaintenance,
    annualPirateProtection,
    annualPrivateMaintenanceExcludingUnderConstruction,
    annualSubjugationTribute,
    annualTaxRevenue,
    calculateAnnualSubjugationTributeIncome,
    recalculateAnnualTaxRevenue,
} from './forceStructure';
import { annualTroopMaintenance } from './troops';
import { obtainEmpireEvaluation, reviewTaxes } from './taxes';
import { setEmpireDifficultyFactors } from './pirates';
import { determineMostSuitableGovernmentTypes } from './game';
import { CharacterEventType, stellarObjectCharacters } from './characters';
import { doCharacterEventRuntime, leaveEmpire } from './events';
import { calculateOverallStrengthFactorWithoutShields } from './combat/threats';
import { pirateEconomyPerformExpense } from './pirates/pirateAI';
import { PlanetaryFacilityType, WonderType } from './researchSystem';

// ---------------------------------------------------------------------------
// Money (Empire intermediate / long blocks)
// ---------------------------------------------------------------------------

/** EmpireCounters.cs 220 ProcessColonyRevenue(amount) (called from Empire.1.cs 3590). */
export function countersProcessColonyRevenue(galaxy: Galaxy, empire: Empire, amount: number): void {
    empire.counters.processColonyRevenue(amount);
}

/** Empire.cs 2252 ThisYearsForeignTradeBonuses. */
export function thisYearsForeignTradeBonuses(empire: Empire): number {
    let num = 0.0;
    for (let i = 0; i < empire.diplomaticRelations.count; i++) {
        const diplomaticRelation = empire.diplomaticRelations.at(i);
        const annualTradeBonus = diplomaticRelation.annualTradeBonus;
        num += annualTradeBonus;
    }
    return num;
}

/** Empire.cs 2267 ThisYearsResortIncome (resets the running total at a new galactic year). */
export function thisYearsResortIncome(galaxy: Galaxy, empire: Empire): number {
    const currentStarDate = galaxyStarDate(galaxy);
    const num = currentStarDate % (REAL_SECONDS_IN_GALACTIC_YEAR * 1000);
    const num2 = currentStarDate - num;
    if (empire.lastResortIncomeAddDate < num2) {
        empire.thisYearsResortIncomeValue = 0.0;
    }
    return empire.thisYearsResortIncomeValue;
}

/** Empire.cs 2282 ThisYearsSpacePortIncome (ages CurrentYearsIncome of space ports / mining stations at a new year). */
export function thisYearsSpacePortIncome(galaxy: Galaxy, empire: Empire): number {
    let num = 0.0;
    const currentStarDate = galaxyStarDate(galaxy);
    const num2 = currentStarDate % (REAL_SECONDS_IN_GALACTIC_YEAR * 1000);
    const num3 = currentStarDate - num2;
    for (const list of [empire.spacePorts, empire.miningStations]) {
        if (list == null) continue;
        for (let i = 0; i < list.length; i++) {
            const builtObject = list[i];
            if (builtObject == null) {
                continue;
            }
            if (!empire.useAveragedVariableIncome && builtObject.dateOfLastIncome < num3) {
                if (builtObject.currentYearsIncome < builtObject.annualSupportCost * 2) {
                    builtObject.consecutiveUnprofitableYears++;
                }
                builtObject.currentYearsIncome = 0.0;
            }
            num += builtObject.currentYearsIncome;
        }
    }
    return num;
}

/** Empire.1.cs 996 ProcessSubjugationTribute(timePassed). */
export function processSubjugationTribute(galaxy: Galaxy, empire: Empire, timePassed: number): void {
    for (let i = 0; i < empire.diplomaticRelations.count; i++) {
        const diplomaticRelation = empire.diplomaticRelations.at(i);
        if (diplomaticRelation.type === DiplomaticRelationType.SubjugatedDominion && diplomaticRelation.initiator !== empire) {
            const num = annualTaxRevenue(galaxy, empire) + thisYearsForeignTradeBonuses(empire) + thisYearsSpacePortIncome(galaxy, empire);
            const num2 = num * SUBJUGATION_TRIBUTE_PERCENTAGE;
            const num3 = timePassed / REAL_SECONDS_IN_GALACTIC_YEAR;
            const num4 = num2 * num3;
            diplomaticRelation.initiator!.stateMoney += num4;
            empire.stateMoney -= num4;
        }
    }
}

/** Empire.4.cs 1766 PerformPrivateTransaction(transactionAmount). */
export function performPrivateTransaction(empire: Empire, transactionAmount: number): number {
    const gov = empireGovernmentAttributes(empire);
    if (gov !== null && gov.specialFunctionCode === 1) {
        empire.stateMoney += transactionAmount;
        return empire.stateMoney;
    }
    if (empire.pirateEmpireBaseHabitat !== null) {
        empire.stateMoney += transactionAmount;
        return empire.stateMoney;
    }
    empire.counters.processColonyRevenue(transactionAmount);
    empire.privateMoney += transactionAmount;
    return empire.privateMoney;
}

/** BuiltObject.BaconValues "cash" (free traders, BaconBuiltObject) — not modelled on the TS BuiltObject yet. */
function builtObjectHasBaconCash(_builtObject: unknown): boolean {
    // TODO(port) M4f: BuiltObject.BaconValues ("cash", "tradeHistory") for player free traders — no BuiltObject has them.
    return false;
}

/** BaconEmpire.cs 608 AnnualStateMaintenanceExcludingUnderConstruction(empire) (Empire.cs 2006). */
export function annualStateMaintenanceExcludingUnderConstruction(empire: Empire): number {
    let num1 = 0.0;
    for (let index = 0; index < empire.builtObjects.length; ++index) {
        const builtObject = empire.builtObjects[index];
        if (builtObject.unbuiltComponentCount <= 0 && (!builtObjectHasBaconCash(builtObject) || builtObject.isAutoControlled)) {
            num1 += builtObject.annualSupportCost;
        }
    }
    const num2 = num1 * empire.shipMaintenanceSavings;
    return num1 - num2;
}

/** BaconEmpire.cs 621 PayAnnualMaintenanceCostForFreeTraders(empire, timePassed). */
function payAnnualMaintenanceCostForFreeTraders(galaxy: Galaxy, empire: Empire, timePassed: number): void {
    const num1 = timePassed / REAL_SECONDS_IN_GALACTIC_YEAR;
    void num1;
    for (let index = 0; index < empire.builtObjects.length; ++index) {
        const builtObject = empire.builtObjects[index];
        if (builtObject.unbuiltComponentCount <= 0 && builtObjectHasBaconCash(builtObject) && !builtObject.isAutoControlled) {
            // Unreachable until BuiltObject.BaconValues exist (see builtObjectHasBaconCash).
            throw new Error('TODO(port) M4f: BaconEmpire.PayAnnualMaintenanceCostForFreeTraders (BuiltObject.BaconValues "cash")');
        }
    }
}


/** Empire.4.cs 1743 PayMaintenanceForBuiltObjects(timePassed). */
export function payMaintenanceForBuiltObjects(galaxy: Galaxy, empire: Empire, timePassed: number): void {
    const num = timePassed / REAL_SECONDS_IN_GALACTIC_YEAR;
    const num2 = annualStateMaintenanceExcludingUnderConstruction(empire) * num;
    empire.stateMoney -= num2;
    pirateEconomyPerformExpense(galaxy, empire, num2, 1, galaxyStarDate(galaxy)); // PirateExpenseType.ShipMaintenance (M4s)
    if (empire.pirateEmpireBaseHabitat === null) {
        const num3 = annualPrivateMaintenanceExcludingUnderConstruction(empire) * num;
        performPrivateTransaction(empire, 0.0 - num3);
    }
    payAnnualMaintenanceCostForFreeTraders(galaxy, empire, timePassed);
}

/** Empire.2.cs 4010 PayForTroops(timePassed). */
export function payForTroops(galaxy: Galaxy, empire: Empire, timePassed: number): void {
    const num = annualTroopMaintenance(empire) * (timePassed / REAL_SECONDS_IN_GALACTIC_YEAR);
    empire.stateMoney -= num;
    pirateEconomyPerformExpense(galaxy, empire, num, 0, galaxyStarDate(galaxy)); // PirateExpenseType.Undefined (M4s)
}

/** Empire.2.cs 4004 PayForPlanetaryFacilities(timePassed). */
export function payForPlanetaryFacilities(galaxy: Galaxy, empire: Empire, timePassed: number): void {
    const num = annualFacilityMaintenance(empire) * (timePassed / REAL_SECONDS_IN_GALACTIC_YEAR);
    empire.stateMoney -= num;
}

/**
 * Empire.3.cs 4161 CalculatePirateIncome (Empire.3.cs 4201: CalculateAccurateAnnualIncome for pirate factions).
 * TODO(port) M4s2: Habitat.GetPirateControl().GetByFaction (PirateColonyControl) — pirate factions own no colonies yet
 * (a colony throws). The PirateEconomy term is ported (M4s1).
 */
export function calculatePirateIncome(galaxy: Galaxy, empire: Empire): number {
    let num = 0.0;
    for (let i = 0; i < empire.colonies.length; i++) {
        const habitat = empire.colonies[i];
        if (habitat != null && !habitat.hasBeenDestroyed) {
            throw new Error('TODO(port) M4s: Empire.CalculatePirateIncome pirate colony control (Habitat.GetPirateControl)');
        }
    }
    for (let j = 0; j < empire.pirateRelations.count; j++) {
        const pirateRelation = empire.pirateRelations.get(j);
        if (pirateRelation != null && pirateRelation.type === PirateRelationType.Protection) {
            num += pirateRelation.monthlyProtectionFeeToThisEmpire * 12.0;
        }
    }
    // Empire.3.cs 4185-4195 (PirateEconomy is never null in the TS model).
    const pirateEconomy = empire.pirateEconomy;
    let num3 = (pirateEconomy.thisYear.totalIncome - pirateEconomy.thisYear.stableIncome) / 2.0;
    if (pirateEconomy.lastYear !== null) {
        const num4 = pirateEconomy.lastYear.totalIncome - pirateEconomy.lastYear.stableIncome;
        num3 += num4 / 2.0;
        num3 /= 2.0;
    }
    num += num3;
    return num;
}

/** Empire.3.cs 4091 CalculateAnnualCashflow (normal empires; pirates → CalculatePirateCashflow). */
export function calculateAnnualCashflow(galaxy: Galaxy, empire: Empire): number {
    if (empire.pirateEmpireBaseHabitat !== null) {
        throw new Error('TODO(port) M4s: Empire.CalculatePirateCashflow');
    }
    let num = annualStateMaintenanceExcludingUnderConstruction(empire) + empire.thisYearsStateFuelCosts + annualTroopMaintenance(empire) + annualSubjugationTribute(galaxy, empire) + annualPirateProtection(empire);
    const num2 = annualTaxRevenue(galaxy, empire) + thisYearsForeignTradeBonuses(empire) + thisYearsSpacePortIncome(galaxy, empire) + thisYearsResortIncome(galaxy, empire) + calculateAnnualSubjugationTributeIncome(galaxy, empire);
    const gov = empireGovernmentAttributes(empire);
    if (gov !== null && gov.specialFunctionCode === 1) {
        num += annualPrivateMaintenanceExcludingUnderConstruction(empire);
    }
    return num2 - num;
}

// ---------------------------------------------------------------------------
// Government (Empire long block)
// ---------------------------------------------------------------------------

/** Empire.10.cs 55 ReviewGovernmentEffects(timePassed). */
export function reviewGovernmentEffects(galaxy: Galaxy, empire: Empire, timePassed: number): void {
    const gov = empireGovernmentAttributes(empire);
    if (gov !== null && gov.specialFunctionCode === 1) {
        const num = (timePassed / REAL_SECONDS_IN_GALACTIC_YEAR) * 0.075;
        const val = empire.economyEfficiency - num;
        empire.economyEfficiency = Math.max(0.35, Math.min(1.0, val));
        for (let i = 0; i < empire.colonies.length; i++) {
            const habitat = empire.colonies[i];
            recalculateAnnualTaxRevenue(galaxy, habitat);
        }
    } else if (empire.economyEfficiency !== 1.0) {
        let val2 = (timePassed / REAL_SECONDS_IN_GALACTIC_YEAR) * 0.25;
        val2 = Math.min(val2, Math.abs(empire.economyEfficiency - 1.0));
        if (empire.economyEfficiency > 1.0) {
            val2 *= -1.0;
        }
        const val3 = empire.economyEfficiency + val2;
        empire.economyEfficiency = Math.max(0.5, Math.min(2.0, val3));
        for (let j = 0; j < empire.colonies.length; j++) {
            const habitat2 = empire.colonies[j];
            recalculateAnnualTaxRevenue(galaxy, habitat2);
        }
    }
}

/** GovernmentAttributesList.GetBySpecialFunctionCode(code) over Galaxy.Governments. */
function governmentsBySpecialFunctionCode(code: number): Government[] {
    const list: Government[] = [];
    for (const g of getGovernmentsStatic()) {
        if (g !== null && g.specialFunctionCode === code) list.push(g);
    }
    return list;
}

/** Empire.cs 1576 MilitaryPotency. */
export function militaryPotency(galaxy: Galaxy, empire: Empire): number {
    let num = 0;
    for (let i = 0; i < empire.builtObjects.length; i++) {
        const builtObject = empire.builtObjects[i];
        if (builtObject != null) {
            num += calculateOverallStrengthFactorWithoutShields(galaxy, builtObject);
        }
    }
    return num;
}

/** Empire.7.cs 4442 DetermineEmpiresAtWarWith(out militaryStrength). */
export function determineEmpiresAtWarWith(galaxy: Galaxy, empire: Empire): { empires: Empire[]; militaryStrength: number } {
    const empireList: Empire[] = [];
    let militaryStrength = 0;
    if (empire.diplomaticRelations != null) {
        for (let i = 0; i < empire.diplomaticRelations.count; i++) {
            const diplomaticRelation = empire.diplomaticRelations.at(i);
            if (diplomaticRelation.type === DiplomaticRelationType.War && !empireList.includes(diplomaticRelation.otherEmpire!)) {
                empireList.push(diplomaticRelation.otherEmpire!);
                militaryStrength += militaryPotency(galaxy, diplomaticRelation.otherEmpire!);
            }
        }
    }
    return { empires: empireList, militaryStrength };
}

/** Empire.10.cs 86 CheckChangeGovernment. */
export function checkChangeGovernment(galaxy: Galaxy, empire: Empire): void {
    if (empire === galaxy.playerEmpire) {
        return;
    }
    const bySpecialFunctionCode = governmentsBySpecialFunctionCode(1);
    const list: number[] = [];
    for (let i = 0; i < bySpecialFunctionCode.length; i++) {
        list.push(bySpecialFunctionCode[i].governmentId);
    }
    let num = -1;
    for (let j = 0; j < list.length; j++) {
        if (empire.allowableGovernmentTypes.includes(list[j])) {
            num = list[j];
            break;
        }
    }
    const gov = empireGovernmentAttributes(empire);
    if (empire.economyEfficiency < 0.9) {
        if (gov === null || gov.specialFunctionCode !== 1) {
            return;
        }
        let num2 = 1.0;
        if (empire.dominantRace !== null) {
            num2 = empire.dominantRace.intelligence / 100.0;
            num2 *= num2;
        }
        const num3 = num2 * 0.8;
        if (!(empire.economyEfficiency < num3)) {
            return;
        }
        let num4 = -1;
        const governmentAttributesList = determineMostSuitableGovernmentTypes(empire.dominantRace!, empire.allowableGovernmentTypes);
        for (let k = 0; k < governmentAttributesList.length; k++) {
            if (!list.includes(num4) && num4 >= 0) {
                break;
            }
            num4 = governmentAttributesList[k].governmentId;
        }
        let val = 1.0 / empire.economyEfficiency;
        val = Math.max(1.0, Math.min(3.0, val));
        haveRevolution(galaxy, empire, empire.dominantRace, num4, val);
        reviewTaxes(galaxy, empire);
    } else {
        if (gov === null || gov.specialFunctionCode === 1 || num < 0 || !(empire.economyEfficiency >= 1.0)) {
            return;
        }
        const { empires: empireList, militaryStrength } = determineEmpiresAtWarWith(galaxy, empire);
        if (empireList.length > 0 && militaryStrength > militaryPotency(galaxy, empire)) {
            const num5 = calculateAnnualCashflow(galaxy, empire);
            if (num5 < 5000.0 && empire.stateMoney < 50000.0) {
                haveRevolution(galaxy, empire, empire.dominantRace, num, 1.0);
            }
        }
    }
}

/** Empire.10.cs 4404 SelectSuitableGovernment(race, excludeId, allowableGovernmentTypes). */
export function selectSuitableGovernment(galaxy: Galaxy, race: Race, excludeId: number, allowableGovernmentTypes: number[]): number {
    const governmentAttributesList = determineMostSuitableGovernmentTypes(race, allowableGovernmentTypes);
    let result = -1;
    if (governmentAttributesList.length > 0) {
        result = governmentAttributesList[0].governmentId;
        let num = -1;
        for (let i = 0; i < governmentAttributesList.length; i++) {
            if (governmentAttributesList[i].availability === 1) {
                num = i;
                break;
            }
        }
        let num2 = 0;
        if (num >= 0) {
            num2 = num;
        }
        let num3 = galaxy.rnd.next(0, governmentAttributesList.length + 1);
        if (num3 === governmentAttributesList.length) {
            num3 = num2;
        }
        if (excludeId >= 0) {
            // Galaxy.ConditionCheckLimit(cond, 20, ref iterationCount): at most 20 extra draws.
            let iterationCount = 0;
            while (iterationCount < 20 && governmentAttributesList[num3].governmentId === excludeId) {
                iterationCount++;
                num3 = galaxy.rnd.next(0, 4);
                if (num3 === 3) {
                    num3 = num2;
                }
            }
        }
        result = governmentAttributesList[num3].governmentId;
    }
    return result;
}

/** Empire.10.cs 4377 ChangeGovernment(governmentId) — the full C# body (empire.ts changeGovernment stores the id). */
export function changeGovernment(galaxy: Galaxy, empire: Empire, governmentId: number): void {
    const governmentAttributes2 = empireGovernmentAttributes(empire);
    let flag = false;
    if (governmentAttributes2!.specialFunctionCode === 1) {
        flag = true;
    }
    empire.changeGovernment(governmentId);
    for (let i = 0; i < galaxy.empires.length; i++) {
        const other = galaxy.empires[i];
        if (other != null && other.active && other !== empire && other !== galaxy.independentEmpire && other.pirateEmpireBaseHabitat === null) {
            // TODO(port) M4r: EmpireEvaluation.GovernmentStyleAffinity / GovernmentStyleAffinityCumulative are not in the
            // TS EmpireEvaluation model yet; set as plain properties.
            const empireEvaluation = obtainEmpireEvaluation(galaxy, other, empire) as unknown as { governmentStyleAffinity: number; governmentStyleAffinityCumulative: number };
            empireEvaluation.governmentStyleAffinity = 0;
            empireEvaluation.governmentStyleAffinityCumulative = 0.0;
        }
    }
    if (flag) {
        reviewTaxes(galaxy, empire);
    }
}

/** Empire.10.cs 4457 HaveRevolution(dominantRace, governmentId, damageFactor). */
export function haveRevolution(galaxy: Galaxy, empire: Empire, dominantRace: Race | null, governmentId: number, damageFactor: number): number {
    const governmentId2 = empire.governmentId;
    if (governmentId === -1) {
        governmentId = selectSuitableGovernment(galaxy, dominantRace!, empire.governmentId, empire.allowableGovernmentTypes);
        if (governmentId >= 0) {
            let iterationCount = 0;
            while (iterationCount < 20 && governmentId === governmentId2) {
                iterationCount++;
                governmentId = selectSuitableGovernment(galaxy, dominantRace!, empire.governmentId, empire.allowableGovernmentTypes);
            }
        }
    }
    if (governmentId >= 0) {
        for (let i = 0; i < empire.colonies.length; i++) {
            const habitat = empire.colonies[i];
            let num = galaxy.rnd.next(0, 25);
            num = Math.trunc(num * damageFactor);
            num = Math.min(num, habitat.developmentLevel);
            let num2 = Math.trunc(habitat.population.totalAmount / 10);
            num2 = Math.trunc(num2 * damageFactor);
            if (num2 > 2000000000) {
                num2 = 2000000000;
            }
            let num3 = galaxy.rnd.next(0, num2);
            num3 = Math.min(num3, habitat.population.items[0].amount);
            habitat.setDevelopmentLevel(habitat.developmentLevel - num);
            habitat.population.items[0].amount -= num3;
            if (habitat.population.items[0].amount < 10000000) {
                habitat.population.items[0].amount = 10000000;
            }
            habitat.population.recalculateTotalAmount();
            doCharacterEventRuntime(galaxy, CharacterEventType.ColonyDevelopmentDecrease, habitat, stellarObjectCharacters(habitat), true, habitat.empire);
        }
        const governmentAttributes = getGovernmentsStatic()[governmentId]!;
        const num4 = governmentAttributes.leaderReplacementDisruptionLevel;
        if (num4 > 0.0) {
            const num5 = 0.7 + galaxy.rnd.nextDouble() * 0.3;
            const num6 = Math.trunc(num5 * num4 * (empire.colonies.length * 0.1));
            for (let j = 0; j < num6; j++) {
                const index = galaxy.rnd.next(0, empire.colonies.length);
                if (empire.capital !== empire.colonies[index]) {
                    leaveEmpire(galaxy, empire.colonies[index]);
                }
            }
        }
        changeGovernment(galaxy, empire, governmentId);
    }
    return governmentId;
}

// ---------------------------------------------------------------------------
// Ability / special bonuses (Empire long block)
// ---------------------------------------------------------------------------

/**
 * Empire.cs 2897 ReviewEmpireAbilityBonuses(out newAbilityRaces, out raceChanged) — returns the description list
 * (Galaxy.ResolveEmpireAbilityBonusDescription* → GameText keys) and the out values.
 */
export function reviewEmpireAbilityBonusesFull(galaxy: Galaxy, empire: Empire): { descriptions: string[]; newAbilityRaces: Race[]; raceChanged: Race | null } {
    const newAbilityRaces: Race[] = [];
    let raceChanged: Race | null = null;
    if (empire === galaxy.independentEmpire) {
        return { descriptions: [], newAbilityRaces, raceChanged };
    }
    let num = 0.0;
    let num2 = 0.0;
    let num3 = 0.0;
    let num4 = 0.0;
    let num5 = 0.0;
    let race: Race | null = null;
    let race2: Race | null = null;
    let race3: Race | null = null;
    let race4: Race | null = null;
    let race5: Race | null = null;
    const raceList: (Race | null)[] = [];
    const list: number[] = [];
    raceList.push(empire.dominantRace);
    list.push(0.0);
    let num6 = 0.0;
    for (let i = 0; i < empire.colonies.length; i++) {
        const habitat = empire.colonies[i];
        for (let j = 0; j < habitat.population.items.length; j++) {
            const population = habitat.population.items[j];
            const num7 = raceList.indexOf(population.race);
            if (num7 >= 0) {
                list[num7] += population.amount / 1000000.0;
            } else {
                raceList.push(population.race);
                list.push(population.amount / 1000000.0);
            }
            num6 += population.amount / 1000000.0;
        }
    }
    for (let k = 0; k < raceList.length; k++) {
        let val = 0.0;
        if (list[k] >= 10.0) {
            val = list[k] / (num6 / 5.0);
            val = Math.max(0.1, val);
        } else if (list[k] > 0.0) {
            val = 0.0;
        }
        val = Math.min(1.0, val);
        const r = raceList[k]!; // C# dereferences raceList[k] (NRE for a null DominantRace).
        const num8 = Math.trunc(r.shipMaintenanceSavings) / 100.0;
        const num9 = Math.trunc(r.resourceExtractionBonus) / 100.0;
        const num10 = Math.trunc(r.researchBonus) / 100.0;
        const num11 = Math.trunc(r.espionageBonus) / 100.0;
        const num12 = Math.trunc(r.tradeBonus) / 100.0;
        if (num8 * val > num) {
            num = num8 * val;
            race = r;
        }
        if (num9 * val > num2) {
            num2 = num9 * val;
            race2 = r;
        }
        if (num10 * val > num3) {
            num3 = num10 * val;
            race3 = r;
        }
        if (num11 * val > num4) {
            num4 = num11 * val;
            race4 = r;
        }
        if (num12 * val > num5) {
            num5 = num12 * val;
            race5 = r;
        }
    }
    const list2: string[] = [];
    if (num > empire.shipMaintenanceSavings) {
        if (race !== empire.shipMaintenanceSavingsRace) raceChanged = race;
        empire.shipMaintenanceSavings = num;
        empire.shipMaintenanceSavingsRace = race;
        list2.push(`EmpireAbilityBonusShipMaintenance|${num}`);
        newAbilityRaces.push(race!);
    } else if (num <= 0.0) {
        empire.shipMaintenanceSavings = 0.0;
        empire.shipMaintenanceSavingsRace = null;
    }
    if (num2 > empire.resourceExtractionBonus) {
        if (race2 !== empire.resourceExtractionBonusRace) raceChanged = race2;
        empire.resourceExtractionBonus = num2;
        empire.resourceExtractionBonusRace = race2;
        list2.push(`EmpireAbilityBonusResourceExtraction|${num2}`);
        newAbilityRaces.push(race2!);
    } else if (num2 <= 0.0) {
        empire.resourceExtractionBonus = 0.0;
        empire.resourceExtractionBonusRace = null;
    }
    if (num3 > empire.researchBonus) {
        if (race3 !== empire.researchBonusRace) raceChanged = race3;
        empire.researchBonus = num3;
        empire.researchBonusRace = race3;
        list2.push(`EmpireAbilityBonusResearch|${num3}`);
        newAbilityRaces.push(race3!);
    } else if (num3 <= 0.0) {
        empire.researchBonus = 0.0;
        empire.researchBonusRace = null;
    }
    if (num4 > empire.espionageBonus) {
        if (race4 !== empire.espionageBonusRace) raceChanged = race4;
        empire.espionageBonus = num4;
        empire.espionageBonusRace = race4;
        list2.push(`EmpireAbilityBonusEspionage|${num4}`);
        newAbilityRaces.push(race4!);
    } else if (num4 <= 0.0) {
        empire.espionageBonus = 0.0;
        empire.espionageBonusRace = null;
    }
    if (num5 > empire.tradeBonus) {
        if (race5 !== empire.tradeBonusRace) raceChanged = race5;
        empire.tradeBonus = num5;
        empire.tradeBonusRace = race5;
        list2.push(`EmpireAbilityBonusTrade|${num5}`);
        newAbilityRaces.push(race5!);
    } else if (num5 <= 0.0) {
        empire.tradeBonus = 0.0;
        empire.tradeBonusRace = null;
    }
    return { descriptions: list2, newAbilityRaces, raceChanged };
}

/** Empire.cs 2891 ReviewEmpireAbilityBonuses (Empire.1.cs 3659 discards the result). */
export function reviewEmpireAbilityBonuses(galaxy: Galaxy, empire: Empire): void {
    reviewEmpireAbilityBonusesFull(galaxy, empire);
}

/**
 * Empire.3.cs 939 ReviewSpecialBonusesRuinsWonders.
 */
export function reviewSpecialBonusesRuinsWonders(galaxy: Galaxy, empire: Empire): void {
    let num = 0.0;
    let num2 = 0.0;
    let num3 = 0.0;
    let num4 = 0.0;
    let num5 = 0.0;
    let num6 = 0.0;
    let num7 = 0.0;
    let specialBonusResearchEnergyRuin = null;
    let specialBonusResearchHighTechRuin = null;
    let specialBonusResearchWeaponsRuin = null;
    let specialBonusWealthRuin = null;
    let specialBonusHappinessRuin = null;
    let specialBonusDiplomacyRuin = null;
    let specialBonusResearchEnergyWonder: unknown = null;
    let specialBonusResearchHighTechWonder: unknown = null;
    let specialBonusResearchWeaponsWonder: unknown = null;
    let specialBonusWealthWonder: unknown = null;
    let specialBonusHappinessWonder: unknown = null;
    let specialBonusPopulationGrowthWonder: unknown = null;
    for (let i = 0; i < empire.colonies.length; i++) {
        const habitat: Habitat = empire.colonies[i];
        const ruin = habitat.ruin;
        if (ruin !== null) {
            if (ruin.bonusDiplomacy > num6) {
                num6 = ruin.bonusDiplomacy;
                specialBonusDiplomacyRuin = ruin;
            }
            if (ruin.bonusWealth > num4) {
                num4 = ruin.bonusWealth;
                specialBonusWealthRuin = ruin;
                specialBonusWealthWonder = null;
            }
            if (ruin.bonusHappiness > num5) {
                num5 = ruin.bonusHappiness;
                specialBonusHappinessRuin = ruin;
                specialBonusHappinessWonder = null;
            }
            if (ruin.bonusResearchWeapons > num3) {
                num3 = ruin.bonusResearchWeapons;
                specialBonusResearchWeaponsRuin = ruin;
                specialBonusResearchWeaponsWonder = null;
            }
            if (ruin.bonusResearchEnergy > num) {
                num = ruin.bonusResearchEnergy;
                specialBonusResearchEnergyRuin = ruin;
                specialBonusResearchEnergyWonder = null;
            }
            if (ruin.bonusResearchHighTech > num2) {
                num2 = ruin.bonusResearchHighTech;
                specialBonusResearchHighTechRuin = ruin;
                specialBonusResearchHighTechWonder = null;
            }
        }
        if (habitat.facilities === null || habitat.facilities.length <= 0) {
            continue;
        }
        // Empire.3.cs 994-1092: completed wonders (facility model: construction/facilities.ts, M4i).
        for (let j = 0; j < habitat.facilities.length; j++) {
            const planetaryFacility = habitat.facilities[j];
            if (planetaryFacility === null || planetaryFacility.type !== PlanetaryFacilityType.Wonder || !(planetaryFacility.constructionProgress >= 1)) continue;
            switch (planetaryFacility.wonderType) {
                case WonderType.EmpireResearchWeapons: {
                    const num14 = planetaryFacility.value2 / 100.0;
                    if (num14 > num3) {
                        num3 = num14;
                        specialBonusResearchWeaponsWonder = planetaryFacility;
                        specialBonusResearchWeaponsRuin = null;
                    }
                    break;
                }
                case WonderType.EmpireResearchEnergy: {
                    const num10 = planetaryFacility.value2 / 100.0;
                    if (num10 > num) {
                        num = num10;
                        specialBonusResearchEnergyWonder = planetaryFacility;
                        specialBonusResearchEnergyRuin = null;
                    }
                    break;
                }
                case WonderType.EmpireResearchHighTech: {
                    const num12 = planetaryFacility.value2 / 100.0;
                    if (num12 > num2) {
                        num2 = num12;
                        specialBonusResearchHighTechWonder = planetaryFacility;
                        specialBonusResearchHighTechRuin = null;
                    }
                    break;
                }
                case WonderType.EmpireHappiness: {
                    const num9 = planetaryFacility.value2 / 100.0;
                    if (num9 > num5) {
                        num5 = num9;
                        specialBonusHappinessWonder = planetaryFacility;
                        specialBonusHappinessRuin = null;
                    }
                    break;
                }
                case WonderType.EmpireIncome: {
                    const num13 = planetaryFacility.value2 / 100.0;
                    if (num13 > num4) {
                        num4 = num13;
                        specialBonusWealthWonder = planetaryFacility;
                        specialBonusWealthRuin = null;
                    }
                    break;
                }
                case WonderType.EmpirePopulationGrowth: {
                    const num11 = planetaryFacility.value2 / 100.0;
                    if (num11 > num7) {
                        num7 = num11;
                        specialBonusPopulationGrowthWonder = planetaryFacility;
                    }
                    break;
                }
                case WonderType.RaceAchievement:
                    if (planetaryFacility.value2 === 1) {
                        const num8 = 0.75;
                        if (num8 > num2) {
                            num2 = num8;
                            specialBonusResearchHighTechWonder = planetaryFacility;
                            specialBonusResearchHighTechRuin = null;
                        }
                    }
                    break;
            }
        }
    }
    empire.specialBonusResearchEnergy = num;
    empire.specialBonusResearchHighTech = num2;
    empire.specialBonusResearchWeapons = num3;
    empire.specialBonusWealth = num4;
    empire.specialBonusHappiness = num5;
    empire.specialBonusDiplomacy = num6;
    empire.specialBonusPopulationGrowth = num7;
    empire.specialBonusResearchEnergyRuin = specialBonusResearchEnergyRuin;
    empire.specialBonusResearchHighTechRuin = specialBonusResearchHighTechRuin;
    empire.specialBonusResearchWeaponsRuin = specialBonusResearchWeaponsRuin;
    empire.specialBonusWealthRuin = specialBonusWealthRuin;
    empire.specialBonusHappinessRuin = specialBonusHappinessRuin;
    empire.specialBonusDiplomacyRuin = specialBonusDiplomacyRuin;
    empire.specialBonusHappinessWonder = specialBonusHappinessWonder;
    empire.specialBonusPopulationGrowthWonder = specialBonusPopulationGrowthWonder;
    empire.specialBonusResearchEnergyWonder = specialBonusResearchEnergyWonder;
    empire.specialBonusResearchHighTechWonder = specialBonusResearchHighTechWonder;
    empire.specialBonusResearchWeaponsWonder = specialBonusResearchWeaponsWonder;
    empire.specialBonusWealthWonder = specialBonusWealthWonder;
}

// ---------------------------------------------------------------------------
// Galaxy long block
// ---------------------------------------------------------------------------

/**
 * Galaxy.cs 1452 ReviewEmpireDifficultyFactors → SetEmpireDifficultyFactors(empire, conditionProgresses) (pirates.ts).
 * TODO(port) deferred (victory): GenerateVictoryConditionProgresses(this, GlobalVictoryConditions, true) — only read by
 * the player branch when DifficultyLevelScalesAsPlayerApproachesVictory (see pirates.ts setEmpireDifficultyFactors).
 */
export function reviewEmpireDifficultyFactors(galaxy: Galaxy): void {
    for (let i = 0; i < galaxy.empires.length; i++) {
        const empire = galaxy.empires[i];
        if (empire != null && empire.active) {
            setEmpireDifficultyFactors(galaxy, empire, galaxy.difficultyLevel);
        }
    }
    for (let j = 0; j < galaxy.pirateEmpires.length; j++) {
        const empire2 = galaxy.pirateEmpires[j];
        if (empire2 != null && empire2.active) {
            setEmpireDifficultyFactors(galaxy, empire2, galaxy.difficultyLevel);
        }
    }
}

// Added by M4d (DiplomaticRelation.PerformTradeTransaction, logistics/contracts.ts).
/** EmpireCounters.cs 224 ProcessTradeBonus(relation, amount) — empire.ts EmpireCounters.processTradeBonus. No Rnd. */
export function countersProcessTradeBonus(galaxy: Galaxy, empire: Empire, relation: unknown, amount: number): void {
    void galaxy;
    empire.counters.processTradeBonus(relation as { tradeBonus: number } | null, amount);
}
