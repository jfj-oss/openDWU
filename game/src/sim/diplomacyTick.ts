// M4r — diplomacy runtime (messages, treaties, politics, wars).
//
// Stubs created by M4a (tasks/M4-plan.md §3.1): the tick skeletons in src/sim/tick/ call these entry points in C#
// order. Each is a no-op that does NOT draw Galaxy.Rnd (a `RND:` note marks C# draw sites that are skipped until the
// owning package ports the body) and records a TODO hit (tick/todo.ts). The owning package replaces the bodies in
// place, keeping the signatures (or adjusting the skeleton call in the same change).

import type { Galaxy } from './galaxy';
import type { Empire } from './empire';
import { registerTodo, todo } from './tick/todo';
import type { DiplomaticRelation, DiplomaticRelationType } from './diplomacy';

const T_calculateRelativeEmpireSize = registerTodo('M4r', 'calculateRelativeEmpireSize');
/** Empire.7.cs 4135 CalculateRelativeEmpireSize; the stub returns the current value. */
export function calculateRelativeEmpireSize(galaxy: Galaxy, empire: Empire): number {
    /* TODO(port) M4r */ todo(T_calculateRelativeEmpireSize);
    return empire.relativeEmpireSize;
}

const T_removeDefeatedEmpireRelations = registerTodo('M4r', 'removeDefeatedEmpireRelations');
/** Empire.1.cs 3322 RemoveDefeatedEmpireRelations. */
export function removeDefeatedEmpireRelations(galaxy: Galaxy, empire: Empire): void {
    /* TODO(port) M4r */ todo(T_removeDefeatedEmpireRelations);
}

const T_processMessages = registerTodo('M4r', 'processMessages');
/** Empire.3.cs 4240 ProcessMessages. */
export function processMessages(galaxy: Galaxy, empire: Empire): void {
    // RND: 13 direct — not drawn until M4r.
    /* TODO(port) M4r */ todo(T_processMessages);
}

const T_considerTreatyProposals = registerTodo('M4r', 'considerTreatyProposals');
/** Empire.3.cs 3606 ConsiderTreatyProposals. */
export function considerTreatyProposals(galaxy: Galaxy, empire: Empire): void {
    // RND: draws in callees (d≤3) — not drawn until M4r.
    /* TODO(port) M4r */ todo(T_considerTreatyProposals);
}

const T_clearInvalidDiplomaticRelations = registerTodo('M4r', 'clearInvalidDiplomaticRelations');
/** Empire.8.cs 1875 ClearInvalidDiplomaticRelations. */
export function clearInvalidDiplomaticRelations(galaxy: Galaxy, empire: Empire): void {
    /* TODO(port) M4r */ todo(T_clearInvalidDiplomaticRelations);
}

const T_evaluatePoliticalSituation = registerTodo('M4r', 'evaluatePoliticalSituation');
/** Empire.8.cs 1905 EvaluatePoliticalSituation(TimeSpan timePassed) — the span in game ms. */
export function evaluatePoliticalSituation(galaxy: Galaxy, empire: Empire, timePassedMs: number): void {
    // RND: 4 direct — not drawn until M4r.
    /* TODO(port) M4r */ todo(T_evaluatePoliticalSituation);
}

const T_reviewDiplomaticStrategies = registerTodo('M4r', 'reviewDiplomaticStrategies');
/** Empire.8.cs 66 ReviewDiplomaticStrategies. */
export function reviewDiplomaticStrategies(galaxy: Galaxy, empire: Empire): void {
    // RND: draws in callees (d≤3) — not drawn until M4r.
    /* TODO(port) M4r */ todo(T_reviewDiplomaticStrategies);
}

const T_reviewDiplomaticSituations = registerTodo('M4r', 'reviewDiplomaticSituations');
/** Empire.8.cs 742 ReviewDiplomaticSituations. */
export function reviewDiplomaticSituations(galaxy: Galaxy, empire: Empire): void {
    // RND: draws in callees (d≤3) — not drawn until M4r.
    /* TODO(port) M4r */ todo(T_reviewDiplomaticSituations);
}

const T_reviewEmpireEndsAllWars = registerTodo('M4r', 'reviewEmpireEndsAllWars');
/** Empire.1.cs 3961 ReviewEmpireEndsAllWars(starDate). */
export function reviewEmpireEndsAllWars(galaxy: Galaxy, empire: Empire, starDate: number): void {
    /* TODO(port) M4r */ todo(T_reviewEmpireEndsAllWars);
}

const T_reviewEnemyHelpEnlistment = registerTodo('M4r', 'reviewEnemyHelpEnlistment');
/** Empire.7.cs 2060 ReviewEnemyHelpEnlistment. */
export function reviewEnemyHelpEnlistment(galaxy: Galaxy, empire: Empire): void {
    /* TODO(port) M4r */ todo(T_reviewEnemyHelpEnlistment);
}

const T_reviewDisputedTerritory = registerTodo('M4r', 'reviewDisputedTerritory');
/** Empire.7.cs 2205 ReviewDisputedTerritory. */
export function reviewDisputedTerritory(galaxy: Galaxy, empire: Empire): void {
    // RND: 2 direct — not drawn until M4r.
    /* TODO(port) M4r */ todo(T_reviewDisputedTerritory);
}

const T_changeDiplomaticRelation = registerTodo('M4r', 'changeDiplomaticRelation');
/**
 * Empire.8.cs 2568 ChangeDiplomaticRelation(relation, newType). Stub added by M4t (Galaxy.4.cs 3700 MergeGalaxyMap
 * "Empire Contact From Galaxy Map" calls it with DiplomaticRelationType.None on a NotMet relation).
 */
export function changeDiplomaticRelation(galaxy: Galaxy, empire: Empire, relation: DiplomaticRelation, newType: DiplomaticRelationType): void {
    // RND: 1 direct — not drawn until M4r.
    /* TODO(port) M4r */ todo(T_changeDiplomaticRelation);
}
