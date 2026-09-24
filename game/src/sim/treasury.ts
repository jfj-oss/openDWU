// M4j — money flow, maintenance, government, ability bonuses, difficulty factors.
//
// Stubs created by M4a (tasks/M4-plan.md §3.1): the tick skeletons in src/sim/tick/ call these entry points in C#
// order. Each is a no-op that does NOT draw Galaxy.Rnd (a `RND:` note marks C# draw sites that are skipped until the
// owning package ports the body) and records a TODO hit (tick/todo.ts). The owning package replaces the bodies in
// place, keeping the signatures (or adjusting the skeleton call in the same change).

import type { Galaxy } from './galaxy';
import type { Empire } from './empire';
import { registerTodo, todo } from './tick/todo';

const T_countersProcessColonyRevenue = registerTodo('M4j', 'countersProcessColonyRevenue');
/** EmpireCounters.ProcessColonyRevenue(amount) (called from Empire.1.cs 3590). */
export function countersProcessColonyRevenue(galaxy: Galaxy, empire: Empire, amount: number): void {
    /* TODO(port) M4j */ todo(T_countersProcessColonyRevenue);
}

const T_processSubjugationTribute = registerTodo('M4j', 'processSubjugationTribute');
/** Empire.1.cs 996 ProcessSubjugationTribute(timePassed). */
export function processSubjugationTribute(galaxy: Galaxy, empire: Empire, timePassed: number): void {
    /* TODO(port) M4j */ todo(T_processSubjugationTribute);
}

const T_reviewEmpireAbilityBonuses = registerTodo('M4j', 'reviewEmpireAbilityBonuses');
/** Empire.cs 2891 ReviewEmpireAbilityBonuses. */
export function reviewEmpireAbilityBonuses(galaxy: Galaxy, empire: Empire): void {
    /* TODO(port) M4j */ todo(T_reviewEmpireAbilityBonuses);
}

const T_reviewGovernmentEffects = registerTodo('M4j', 'reviewGovernmentEffects');
/** Empire.10.cs 55 ReviewGovernmentEffects(timePassed). */
export function reviewGovernmentEffects(galaxy: Galaxy, empire: Empire, timePassed: number): void {
    /* TODO(port) M4j */ todo(T_reviewGovernmentEffects);
}

const T_checkChangeGovernment = registerTodo('M4j', 'checkChangeGovernment');
/** Empire.10.cs 86 CheckChangeGovernment. */
export function checkChangeGovernment(galaxy: Galaxy, empire: Empire): void {
    // RND: draws in callees (d≤3) — not drawn until M4j.
    /* TODO(port) M4j */ todo(T_checkChangeGovernment);
}

const T_reviewSpecialBonusesRuinsWonders = registerTodo('M4j', 'reviewSpecialBonusesRuinsWonders');
/** Empire.3.cs 939 ReviewSpecialBonusesRuinsWonders. */
export function reviewSpecialBonusesRuinsWonders(galaxy: Galaxy, empire: Empire): void {
    /* TODO(port) M4j */ todo(T_reviewSpecialBonusesRuinsWonders);
}

const T_payMaintenanceForBuiltObjects = registerTodo('M4j', 'payMaintenanceForBuiltObjects');
/** Empire.4.cs 1743 PayMaintenanceForBuiltObjects(timePassed). */
export function payMaintenanceForBuiltObjects(galaxy: Galaxy, empire: Empire, timePassed: number): void {
    /* TODO(port) M4j */ todo(T_payMaintenanceForBuiltObjects);
}

const T_payForTroops = registerTodo('M4j', 'payForTroops');
/** Empire.2.cs 4010 PayForTroops(timePassed). */
export function payForTroops(galaxy: Galaxy, empire: Empire, timePassed: number): void {
    /* TODO(port) M4j */ todo(T_payForTroops);
}

const T_payForPlanetaryFacilities = registerTodo('M4j', 'payForPlanetaryFacilities');
/** Empire.2.cs 4004 PayForPlanetaryFacilities(timePassed). */
export function payForPlanetaryFacilities(galaxy: Galaxy, empire: Empire, timePassed: number): void {
    /* TODO(port) M4j */ todo(T_payForPlanetaryFacilities);
}

const T_reviewEmpireDifficultyFactors = registerTodo('M4j', 'reviewEmpireDifficultyFactors');
/** Galaxy.cs 1452 ReviewEmpireDifficultyFactors. */
export function reviewEmpireDifficultyFactors(galaxy: Galaxy): void {
    /* TODO(port) M4j */ todo(T_reviewEmpireDifficultyFactors);
}

// Added by M4d (DiplomaticRelation.PerformTradeTransaction, logistics/contracts.ts).
const T_countersProcessTradeBonus = registerTodo('M4j', 'countersProcessTradeBonus');
/** EmpireCounters.cs 224 ProcessTradeBonus(relation, amount): TradeIncomeTotalVolume += amount; TradeIncomeStateBonus += relation.TradeBonus * amount. No Rnd. */
export function countersProcessTradeBonus(galaxy: Galaxy, empire: Empire, relation: unknown, amount: number): void {
    /* TODO(port) M4j */ todo(T_countersProcessTradeBonus);
}
