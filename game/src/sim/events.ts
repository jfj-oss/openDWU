// M4u — events, disasters, location effects, rebellion, plague, creatures, character runtime. Also the
// DEFERRED stubs (not M4, tasks/M4-plan.md §3.3 "Deferred"): story events, scripted game events,
// espionage, achievements / victory. They stay no-ops that count as TODO hits.
//
// Stubs created by M4a (tasks/M4-plan.md §3.1): the tick skeletons in src/sim/tick/ call these entry points in C#
// order. Each is a no-op that does NOT draw Galaxy.Rnd (a `RND:` note marks C# draw sites that are skipped until the
// owning package ports the body) and records a TODO hit (tick/todo.ts). The owning package replaces the bodies in
// place, keeping the signatures (or adjusting the skeleton call in the same change).

import type { Galaxy } from './galaxy';
import type { Empire } from './empire';
import type { BuiltObject } from './builtObject';
import type { Habitat } from './types';
import { registerTodo, todo } from './tick/todo';

const T_clearEmptyDebrisFields = registerTodo('M4u', 'clearEmptyDebrisFields');
/** Galaxy.5.cs 2893 ClearEmptyDebrisFields. */
export function clearEmptyDebrisFields(galaxy: Galaxy): void {
    /* TODO(port) M4u */ todo(T_clearEmptyDebrisFields);
}

const T_processCharacters = registerTodo('M4u', 'processCharacters');
/** Empire.6.cs 3941 ProcessCharacters(timePassed) → Character.cs 4277 DoTasks(galaxy) → ProcessTransfer. */
export function processCharacters(galaxy: Galaxy, empire: Empire, timePassed: number): void {
    /* TODO(port) M4u */ todo(T_processCharacters);
}

const T_checkReviewSpecialPirateEvents = registerTodo('M4u', 'checkReviewSpecialPirateEvents');
/** Empire.7.cs 3408 CheckReviewSpecialPirateEvents. */
export function checkReviewSpecialPirateEvents(galaxy: Galaxy, empire: Empire): void {
    // RND: draws in callees (d≤3) — not drawn until M4u.
    /* TODO(port) M4u */ todo(T_checkReviewSpecialPirateEvents);
}

const T_checkForCharacterAppearance = registerTodo('M4u', 'checkForCharacterAppearance');
/** Empire.6.cs 3990 CheckForCharacterAppearance. */
export function checkForCharacterAppearance(galaxy: Galaxy, empire: Empire): void {
    // RND: 2 direct, +clock×1 — not drawn until M4u.
    /* TODO(port) M4u */ todo(T_checkForCharacterAppearance);
}

const T_reviewCharacterLeaderChange = registerTodo('M4u', 'reviewCharacterLeaderChange');
/** Empire.6.cs 4769 ReviewCharacterLeaderChange(timePassed). */
export function reviewCharacterLeaderChange(galaxy: Galaxy, empire: Empire, timePassed: number): void {
    // RND: 1 direct, +clock×1 — not drawn until M4u.
    /* TODO(port) M4u */ todo(T_reviewCharacterLeaderChange);
}

const T_processLeaderChangeInfluence = registerTodo('M4u', 'processLeaderChangeInfluence');
/** Empire.6.cs 5084 ProcessLeaderChangeInfluence(timePassed). */
export function processLeaderChangeInfluence(galaxy: Galaxy, empire: Empire, timePassed: number): void {
    // RND: 4 direct, +clock×1 — not drawn until M4u.
    /* TODO(port) M4u */ todo(T_processLeaderChangeInfluence);
}

const T_reviewCharacterBonusesKnown = registerTodo('M4u', 'reviewCharacterBonusesKnown');
/** Empire.6.cs 4716 ReviewCharacterBonusesKnown. */
export function reviewCharacterBonusesKnown(galaxy: Galaxy, empire: Empire): void {
    /* TODO(port) M4u */ todo(T_reviewCharacterBonusesKnown);
}

const T_reviewCharacterTraits = registerTodo('M4u', 'reviewCharacterTraits');
/** Empire.7.cs 16 ReviewCharacterTraits. */
export function reviewCharacterTraits(galaxy: Galaxy, empire: Empire): void {
    // RND: 3 direct — not drawn until M4u.
    /* TODO(port) M4u */ todo(T_reviewCharacterTraits);
}

const T_reviewDemoralizingCharacters = registerTodo('M4u', 'reviewDemoralizingCharacters');
/** Empire.7.cs 319 ReviewDemoralizingCharacters. */
export function reviewDemoralizingCharacters(galaxy: Galaxy, empire: Empire): void {
    // RND: 1 direct, +clock×1 — not drawn until M4u.
    /* TODO(port) M4u */ todo(T_reviewDemoralizingCharacters);
}

const T_reviewCharacterLocations = registerTodo('M4u', 'reviewCharacterLocations');
/** Empire.7.cs 348 ReviewCharacterLocations (per character = characters.ts reviewCharacterLocation). */
export function reviewCharacterLocations(galaxy: Galaxy, empire: Empire): void {
    // RND: draws in callees (d≤3) — not drawn until M4u.
    /* TODO(port) M4u */ todo(T_reviewCharacterLocations);
}

const T_resetRaceEvents = registerTodo('M4u', 'resetRaceEvents');
/** Empire.1.cs 2094 ResetRaceEvents. */
export function resetRaceEvents(galaxy: Galaxy, empire: Empire): void {
    /* TODO(port) M4u */ todo(T_resetRaceEvents);
}

const T_reviewRandomEvents = registerTodo('M4u', 'reviewRandomEvents');
/** Empire.1.cs 1758 ReviewRandomEvents. */
export function reviewRandomEvents(galaxy: Galaxy, empire: Empire): void {
    // RND: 5 direct — not drawn until M4u.
    /* TODO(port) M4u */ todo(T_reviewRandomEvents);
}

const T_reviewEmpireEvents = registerTodo('M4u', 'reviewEmpireEvents');
/** Empire.1.cs 2811 ReviewEmpireEvents. */
export function reviewEmpireEvents(galaxy: Galaxy, empire: Empire): void {
    // RND: 8 direct, +clock×1 — not drawn until M4u.
    /* TODO(port) M4u */ todo(T_reviewEmpireEvents);
}

const T_pirateReviewRandomEvents = registerTodo('M4u', 'pirateReviewRandomEvents');
/** Empire.1.cs 1731 PirateReviewRandomEvents. */
export function pirateReviewRandomEvents(galaxy: Galaxy, empire: Empire): void {
    // RND: 4 direct — not drawn until M4u.
    /* TODO(port) M4u */ todo(T_pirateReviewRandomEvents);
}

const T_doLocationEffects = registerTodo('M4u', 'doLocationEffects');
/** BuiltObject.cs 3448 DoLocationEffects(timePassed, time). */
export function doLocationEffects(galaxy: Galaxy, builtObject: BuiltObject, timePassed: number, time: number): void {
    // RND: +clock×2 — not drawn until M4u.
    /* TODO(port) M4u */ todo(T_doLocationEffects);
}

const T_applyLocationEffects = registerTodo('M4u', 'applyLocationEffects');
/** BuiltObject.cs 3934 ApplyLocationEffects(timePassed, time). */
export function applyLocationEffects(galaxy: Galaxy, builtObject: BuiltObject, timePassed: number, time: number): void {
    // RND: 4 direct, +clock×2 — not drawn until M4u.
    /* TODO(port) M4u */ todo(T_applyLocationEffects);
}

const T_processPlague = registerTodo('M4u', 'processPlague');
/** Habitat.cs 1678 ProcessPlague(timePassed). */
export function processPlague(galaxy: Galaxy, habitat: Habitat, timePassed: number): void {
    // RND: 2 direct, +clock×1 — not drawn until M4u.
    /* TODO(port) M4u */ todo(T_processPlague);
}

const T_checkHabitatIsEmpire = registerTodo('M4u', 'checkHabitatIsEmpire');
/** Habitat.cs 5230 CheckHabitatIsEmpire(galaxy). */
export function checkHabitatIsEmpire(galaxy: Galaxy, habitat: Habitat): void {
    // RND: 1 direct, +clock×2 — not drawn until M4u.
    /* TODO(port) M4u */ todo(T_checkHabitatIsEmpire);
}

const T_chanceColonyGovernorPromotion = registerTodo('M4u', 'chanceColonyGovernorPromotion');
/** Galaxy.2.cs 4784 ChanceColonyGovernorPromotion(empire, colony). */
export function chanceColonyGovernorPromotion(galaxy: Galaxy, empire: Empire, habitat: Habitat): void {
    // RND: 2 direct — not drawn until M4u.
    /* TODO(port) M4u */ todo(T_chanceColonyGovernorPromotion);
}

const T_spawnCreatures = registerTodo('M4u', 'spawnCreatures');
/** Habitat.cs 1619 SpawnCreatures. */
export function spawnCreatures(galaxy: Galaxy, habitat: Habitat): void {
    // RND: draws in callees (d≤3) — not drawn until M4u.
    /* TODO(port) M4u */ todo(T_spawnCreatures);
}

const T_doPlanetRemove = registerTodo('M4u', 'doPlanetRemove');
/** Habitat.cs 6379 DoPlanetRemove (a new Thread in C#, synchronous in TS). */
export function doPlanetRemove(galaxy: Galaxy, habitat: Habitat): void {
    /* TODO(port) M4u */ todo(T_doPlanetRemove);
}

const T_clearCompletedPlanetDestroyerProjects = registerTodo('M4u', 'clearCompletedPlanetDestroyerProjects');
/** Galaxy.5.cs 2867 ClearCompletedPlanetDestroyerProjects (planet destroyer runtime: deferred). */
export function clearCompletedPlanetDestroyerProjects(galaxy: Galaxy): void {
    /* TODO(port) M4u */ todo(T_clearCompletedPlanetDestroyerProjects);
}

const T_processDelayedEventActions = registerTodo('deferred', 'processDelayedEventActions');
/** Galaxy.9.cs 1474 ProcessDelayedEventActions(starDate) — scripted game events (DelayedActions is empty in a normal game). */
export function processDelayedEventActions(galaxy: Galaxy, starDate: number): void {
    // RND: draws in callees (d≤3), +clock×6 — not drawn until ported.
    /* TODO(port) deferred (not M4) */ todo(T_processDelayedEventActions);
}

const T_shakturiSendConvoy = registerTodo('deferred', 'shakturiSendConvoy');
/** Empire.2.cs 3487 ShakturiSendConvoy (story). */
export function shakturiSendConvoy(galaxy: Galaxy, empire: Empire): void {
    // RND: 1 direct — not drawn until ported.
    /* TODO(port) deferred (not M4) */ todo(T_shakturiSendConvoy);
}

const T_checkOfferStoryHint = registerTodo('deferred', 'checkOfferStoryHint');
/** Empire.2.cs 3508 CheckOfferStoryHint (story). */
export function checkOfferStoryHint(galaxy: Galaxy, empire: Empire): void {
    // RND: 1 direct — not drawn until ported.
    /* TODO(port) deferred (not M4) */ todo(T_checkOfferStoryHint);
}

const T_checkSendShipConvoysViaGateway = registerTodo('deferred', 'checkSendShipConvoysViaGateway');
/** Empire.1.cs 3899 CheckSendShipConvoysViaGateway(timePassed) (story). */
export function checkSendShipConvoysViaGateway(galaxy: Galaxy, empire: Empire, timePassed: number): void {
    // RND: 4 direct — not drawn until ported.
    /* TODO(port) deferred (not M4) */ todo(T_checkSendShipConvoysViaGateway);
}

const T_assignSpecialMissions = registerTodo('deferred', 'assignSpecialMissions');
/** Empire.5.cs 5401 AssignSpecialMissions (espionage). */
export function assignSpecialMissions(galaxy: Galaxy, empire: Empire): void {
    // RND: 3 direct — not drawn until ported.
    /* TODO(port) deferred (not M4) */ todo(T_assignSpecialMissions);
}

const T_performIntelligenceMissions = registerTodo('deferred', 'performIntelligenceMissions');
/** Empire.5.cs 5597 PerformIntelligenceMissions (espionage). */
export function performIntelligenceMissions(galaxy: Galaxy, empire: Empire): void {
    // RND: 6 direct, +clock×3 — not drawn until ported.
    /* TODO(port) deferred (not M4) */ todo(T_performIntelligenceMissions);
}

const T_reviewAchievements = registerTodo('deferred', 'reviewAchievements');
/** Galaxy.1.cs 2935 ReviewAchievements. */
export function reviewAchievements(galaxy: Galaxy): void {
    /* TODO(port) deferred (not M4) */ todo(T_reviewAchievements);
}

const T_checkVictoryConditions = registerTodo('deferred', 'checkVictoryConditions');
/** Galaxy.1.cs 88 CheckVictoryConditions(playerEmpire, globalVictoryConditions, playerConditionsToAchieve, playerConditionsToPrevent). */
export function checkVictoryConditions(galaxy: Galaxy, playerEmpire: Empire | null): void {
    // RND: draws in callees (d≤3) — not drawn until ported.
    /* TODO(port) deferred (not M4) */ todo(T_checkVictoryConditions);
}

const T_updateAchievements = registerTodo('deferred', 'updateAchievements');
/** Empire.1.cs 3969 UpdateAchievements. */
export function updateAchievements(galaxy: Galaxy, empire: Empire): void {
    /* TODO(port) deferred (not M4) */ todo(T_updateAchievements);
}
