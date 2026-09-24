// M4s (s1) — pirate mission marketplace (EmpireActivity): offers, bidding, mission reviews, relations.
//
// Stubs created by M4a (tasks/M4-plan.md §3.1): the tick skeletons in src/sim/tick/ call these entry points in C#
// order. Each is a no-op that does NOT draw Galaxy.Rnd (a `RND:` note marks C# draw sites that are skipped until the
// owning package ports the body) and records a TODO hit (tick/todo.ts). The owning package replaces the bodies in
// place, keeping the signatures (or adjusting the skeleton call in the same change).

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import { registerTodo, todo } from '../tick/todo';

const T_reviewPirateMissionsAndAssign = registerTodo('M4s', 'reviewPirateMissionsAndAssign');
/** Galaxy.9.cs 527 ReviewPirateMissionsAndAssign(starDate, timePassed). */
export function reviewPirateMissionsAndAssign(galaxy: Galaxy, starDate: number, timePassed: number): void {
    /* TODO(port) M4s */ todo(T_reviewPirateMissionsAndAssign);
}

const T_reviewPirateSmugglingMissions = registerTodo('M4s', 'reviewPirateSmugglingMissions');
/** Empire.2.cs 1358 ReviewPirateSmugglingMissions(starDate). */
export function reviewPirateSmugglingMissions(galaxy: Galaxy, empire: Empire, starDate: number): void {
    // RND: draws in callees (d≤3) — not drawn until M4s.
    /* TODO(port) M4s */ todo(T_reviewPirateSmugglingMissions);
}

const T_reviewPirateDefendMissions = registerTodo('M4s', 'reviewPirateDefendMissions');
/** Empire.2.cs 1313 ReviewPirateDefendMissions(starDate). */
export function reviewPirateDefendMissions(galaxy: Galaxy, empire: Empire, starDate: number): void {
    /* TODO(port) M4s */ todo(T_reviewPirateDefendMissions);
}

const T_independentColoniesMakeSmugglingOffersToPirates = registerTodo('M4s', 'independentColoniesMakeSmugglingOffersToPirates');
/** Galaxy.cs 3237 IndependentColoniesMakeSmugglingOffersToPirates(starDate). */
export function independentColoniesMakeSmugglingOffersToPirates(galaxy: Galaxy, starDate: number): void {
    // RND: 1 per colony — not drawn until M4s.
    /* TODO(port) M4s */ todo(T_independentColoniesMakeSmugglingOffersToPirates);
}

const T_independentColoniesMakeDefendOffersToPirates = registerTodo('M4s', 'independentColoniesMakeDefendOffersToPirates');
/** Galaxy.cs 3203 IndependentColoniesMakeDefendOffersToPirates(starDate). */
export function independentColoniesMakeDefendOffersToPirates(galaxy: Galaxy, starDate: number): void {
    // RND: 1 per colony — not drawn until M4s.
    /* TODO(port) M4s */ todo(T_independentColoniesMakeDefendOffersToPirates);
}

const T_reviewPirateRelations = registerTodo('M4s', 'reviewPirateRelations');
/** Empire.2.cs 2401 ReviewPirateRelations(starDate, timePassed). */
export function reviewPirateRelations(galaxy: Galaxy, empire: Empire, starDate: number, timePassed: number): void {
    // RND: 1 direct — not drawn until M4s.
    /* TODO(port) M4s */ todo(T_reviewPirateRelations);
}

const T_makeAttackOffersToPirates = registerTodo('M4s', 'makeAttackOffersToPirates');
/** Empire.2.cs 1719 MakeAttackOffersToPirates(starDate). */
export function makeAttackOffersToPirates(galaxy: Galaxy, empire: Empire, starDate: number): void {
    /* TODO(port) M4s */ todo(T_makeAttackOffersToPirates);
}

const T_makeDefendOffersToPirates = registerTodo('M4s', 'makeDefendOffersToPirates');
/** Empire.2.cs 1138 MakeDefendOffersToPirates(starDate). */
export function makeDefendOffersToPirates(galaxy: Galaxy, empire: Empire, starDate: number): void {
    /* TODO(port) M4s */ todo(T_makeDefendOffersToPirates);
}

const T_makeSmugglingOffersToPirates = registerTodo('M4s', 'makeSmugglingOffersToPirates');
/** Empire.2.cs 1426 MakeSmugglingOffersToPirates(starDate). */
export function makeSmugglingOffersToPirates(galaxy: Galaxy, empire: Empire, starDate: number): void {
    /* TODO(port) M4s */ todo(T_makeSmugglingOffersToPirates);
}

const T_pirateCheckMissionsOnOffer = registerTodo('M4s', 'pirateCheckMissionsOnOffer');
/** Empire.2.cs 1943 PirateCheckMissionsOnOffer(starDate). */
export function pirateCheckMissionsOnOffer(galaxy: Galaxy, empire: Empire, starDate: number): void {
    // RND: +clock×1 — not drawn until M4s.
    /* TODO(port) M4s */ todo(T_pirateCheckMissionsOnOffer);
}

const T_piratesMakeAttackOffers = registerTodo('M4s', 'piratesMakeAttackOffers');
/** Empire.2.cs 1847 PiratesMakeAttackOffers(starDate). */
export function piratesMakeAttackOffers(galaxy: Galaxy, empire: Empire, starDate: number): void {
    /* TODO(port) M4s */ todo(T_piratesMakeAttackOffers);
}
