// M4s (s2) — pirate faction AI (missions, fleets, economy, construction, raids, control).
//
// Stubs created by M4a (tasks/M4-plan.md §3.1): the tick skeletons in src/sim/tick/ call these entry points in C#
// order. Each is a no-op that does NOT draw Galaxy.Rnd (a `RND:` note marks C# draw sites that are skipped until the
// owning package ports the body) and records a TODO hit (tick/todo.ts). The owning package replaces the bodies in
// place, keeping the signatures (or adjusting the skeleton call in the same change).

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import type { BuiltObject } from '../builtObject';
import type { Habitat } from '../types';
import { registerTodo, todo } from '../tick/todo';

const T_checkSendPirateRaid = registerTodo('M4s', 'checkSendPirateRaid');
/** Empire.1.cs 4065 CheckSendPirateRaid. */
export function checkSendPirateRaid(galaxy: Galaxy, empire: Empire): void {
    /* TODO(port) M4s */ todo(T_checkSendPirateRaid);
}

const T_pirateRecalculateEmpireCorruption = registerTodo('M4s', 'pirateRecalculateEmpireCorruption');
/** Empire.4.cs 3406 / BaconEmpire.cs 1253 PirateRecalculateEmpireCorruption. */
export function pirateRecalculateEmpireCorruption(galaxy: Galaxy, empire: Empire): void {
    // RND: 1 direct — not drawn until M4s.
    /* TODO(port) M4s */ todo(T_pirateRecalculateEmpireCorruption);
}

const T_pirateAssignShipMissions = registerTodo('M4s', 'pirateAssignShipMissions');
/** Empire.1.cs 4385 PirateAssignShipMissions(starDate). */
export function pirateAssignShipMissions(galaxy: Galaxy, empire: Empire, starDate: number): void {
    // RND: draws in callees (d≤3) — not drawn until M4s.
    /* TODO(port) M4s */ todo(T_pirateAssignShipMissions);
}

const T_pirateTaskFleets = registerTodo('M4s', 'pirateTaskFleets');
/** Empire.9.cs 904 PirateTaskFleets. */
export function pirateTaskFleets(galaxy: Galaxy, empire: Empire): void {
    /* TODO(port) M4s */ todo(T_pirateTaskFleets);
}

const T_pirateCollectIncomeFromControlledColonies = registerTodo('M4s', 'pirateCollectIncomeFromControlledColonies');
/** Empire.2.cs 2895 PirateCollectIncomeFromControlledColonies(timePassed). */
export function pirateCollectIncomeFromControlledColonies(galaxy: Galaxy, empire: Empire, timePassed: number): void {
    /* TODO(port) M4s */ todo(T_pirateCollectIncomeFromControlledColonies);
}

const T_pirateReviewSystemThreats = registerTodo('M4s', 'pirateReviewSystemThreats');
/** Empire.9.cs 4139 PirateReviewSystemThreats. */
export function pirateReviewSystemThreats(galaxy: Galaxy, empire: Empire): void {
    /* TODO(port) M4s */ todo(T_pirateReviewSystemThreats);
}

const T_pirateGenerateSellInfoOffers = registerTodo('M4s', 'pirateGenerateSellInfoOffers');
/** Empire.1.cs 4359 PirateGenerateSellInfoOffers. */
export function pirateGenerateSellInfoOffers(galaxy: Galaxy, empire: Empire): void {
    // RND: 1 direct — not drawn until M4s.
    /* TODO(port) M4s */ todo(T_pirateGenerateSellInfoOffers);
}

const T_reviewPirateSystemInfluence = registerTodo('M4s', 'reviewPirateSystemInfluence');
/** Empire.7.cs 2180 ReviewPirateSystemInfluence. */
export function reviewPirateSystemInfluence(galaxy: Galaxy, empire: Empire): void {
    /* TODO(port) M4s */ todo(T_reviewPirateSystemInfluence);
}

const T_doTaskPiratesLongInterval = registerTodo('M4s', 'doTaskPiratesLongInterval');
/** BaconEmpire.cs 1099 DoTaskPiratesLongInterval(empire). */
export function doTaskPiratesLongInterval(galaxy: Galaxy, empire: Empire): void {
    // RND: +clock×2 — not drawn until M4s.
    /* TODO(port) M4s */ todo(T_doTaskPiratesLongInterval);
}

const T_maintainPirateSpaceportResourceLevels = registerTodo('M4s', 'maintainPirateSpaceportResourceLevels');
/** Empire.4.cs 2399 MaintainPirateSpaceportResourceLevels. */
export function maintainPirateSpaceportResourceLevels(galaxy: Galaxy, empire: Empire): void {
    /* TODO(port) M4s */ todo(T_maintainPirateSpaceportResourceLevels);
}

const T_pirateReviewEmpireRelations = registerTodo('M4s', 'pirateReviewEmpireRelations');
/** Empire.2.cs 2510 PirateReviewEmpireRelations(starDate, timePassed). */
export function pirateReviewEmpireRelations(galaxy: Galaxy, empire: Empire, starDate: number, timePassed: number): void {
    /* TODO(port) M4s */ todo(T_pirateReviewEmpireRelations);
}

const T_pirateProjectForces = registerTodo('M4s', 'pirateProjectForces');
/** Empire.2.cs 766 PirateProjectForces(starDate). */
export function pirateProjectForces(galaxy: Galaxy, empire: Empire, starDate: number): void {
    /* TODO(port) M4s */ todo(T_pirateProjectForces);
}

const T_pirateDoConstruction = registerTodo('M4s', 'pirateDoConstruction');
/** Empire.2.cs 219 PirateDoConstruction. */
export function pirateDoConstruction(galaxy: Galaxy, empire: Empire): void {
    // RND: draws in callees (d≤3) — not drawn until M4s.
    /* TODO(port) M4s */ todo(T_pirateDoConstruction);
}

const T_pirateResetCivilianShipEmpireToIndependent = registerTodo('M4s', 'pirateResetCivilianShipEmpireToIndependent');
/** Empire.1.cs 4333 PirateResetCivilianShipEmpireToIndependent. */
export function pirateResetCivilianShipEmpireToIndependent(galaxy: Galaxy, empire: Empire): void {
    /* TODO(port) M4s */ todo(T_pirateResetCivilianShipEmpireToIndependent);
}

const T_pirateTradeItems = registerTodo('M4s', 'pirateTradeItems');
/** Empire.7.cs 2666 PirateTradeItems. */
export function pirateTradeItems(galaxy: Galaxy, empire: Empire): void {
    // RND: 2 direct — not drawn until M4s.
    /* TODO(port) M4s */ todo(T_pirateTradeItems);
}

const T_checkColoniesForPirateFacilitiesAndAttack = registerTodo('M4s', 'checkColoniesForPirateFacilitiesAndAttack');
/** Empire.1.cs 4328 / BaconEmpire.cs 1499 CheckColoniesForPirateFacilitiesAndAttack. */
export function checkColoniesForPirateFacilitiesAndAttack(galaxy: Galaxy, empire: Empire): void {
    // RND: draws in callees (d≤3) — not drawn until M4s.
    /* TODO(port) M4s */ todo(T_checkColoniesForPirateFacilitiesAndAttack);
}

const T_reviewPirateControl = registerTodo('M4s', 'reviewPirateControl');
/** BaconHabitat.cs 1388 ReviewPirateControl(timePassed). */
export function reviewPirateControl(galaxy: Galaxy, habitat: Habitat, timePassed: number): void {
    /* TODO(port) M4s */ todo(T_reviewPirateControl);
}

const T_pirateBaseDiscovery = registerTodo('M4s', 'pirateBaseDiscovery');
/** BuiltObject.1.cs 1889 PirateBaseDiscovery. */
export function pirateBaseDiscovery(galaxy: Galaxy, builtObject: BuiltObject): void {
    /* TODO(port) M4s */ todo(T_pirateBaseDiscovery);
}

const T_updateRaidCountdownBuiltObject = registerTodo('M4s', 'updateRaidCountdownBuiltObject');
/** BuiltObject.1.cs 2894 UpdateRaidCountdown(timePassed). */
export function updateRaidCountdownBuiltObject(galaxy: Galaxy, builtObject: BuiltObject, timePassed: number): void {
    /* TODO(port) M4s */ todo(T_updateRaidCountdownBuiltObject);
}

const T_updateRaidCountdownHabitat = registerTodo('M4s', 'updateRaidCountdownHabitat');
/** Habitat.cs 1608 UpdateRaidCountdown(timePassed). */
export function updateRaidCountdownHabitat(galaxy: Galaxy, habitat: Habitat, timePassed: number): void {
    /* TODO(port) M4s */ todo(T_updateRaidCountdownHabitat);
}

const T_pirateEconomyPerformExpense = registerTodo('M4s', 'pirateEconomyPerformExpense');
/** PirateEconomy.PerformExpense(amount, type, starDate) (PirateEconomy.cs; added by M4j: Pay* in treasury.ts). */
export function pirateEconomyPerformExpense(galaxy: Galaxy, empire: Empire, amount: number, expenseType: number): void {
    /* TODO(port) M4s */ todo(T_pirateEconomyPerformExpense);
}
