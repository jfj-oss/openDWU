// M4s (s2) — galaxy-level pirate steps (terminate / merge / eliminate factions, new pirate ships, super pirates).
//
// Stubs created by M4a (tasks/M4-plan.md §3.1): the tick skeletons in src/sim/tick/ call these entry points in C#
// order. Each is a no-op that does NOT draw Galaxy.Rnd (a `RND:` note marks C# draw sites that are skipped until the
// owning package ports the body) and records a TODO hit (tick/todo.ts). The owning package replaces the bodies in
// place, keeping the signatures (or adjusting the skeleton call in the same change).

import type { Galaxy } from '../galaxy';
import { registerTodo, todo } from '../tick/todo';

const T_checkForTerminatedPirateEmpires = registerTodo('M4s', 'checkForTerminatedPirateEmpires');
/** Galaxy.8.cs 3268 CheckForTerminatedPirateEmpires. */
export function checkForTerminatedPirateEmpires(galaxy: Galaxy): void {
    // RND: 1 direct, +clock×3 — not drawn until M4s.
    /* TODO(port) M4s */ todo(T_checkForTerminatedPirateEmpires);
}

const T_generateNewPirateShips = registerTodo('M4s', 'generateNewPirateShips');
/** Galaxy.8.cs 2774 GenerateNewPirateShips. */
export function generateNewPirateShips(galaxy: Galaxy): void {
    /* TODO(port) M4s */ todo(T_generateNewPirateShips);
}

const T_doSuperPirateTasks = registerTodo('M4s', 'doSuperPirateTasks');
/** Galaxy.9.cs 208 DoSuperPirateTasks. */
export function doSuperPirateTasks(galaxy: Galaxy): void {
    // RND: draws in callees (d≤3) — not drawn until M4s.
    /* TODO(port) M4s */ todo(T_doSuperPirateTasks);
}

const T_checkMergePirateFactions = registerTodo('M4s', 'checkMergePirateFactions');
/** Galaxy.8.cs 2907 CheckMergePirateFactions. */
export function checkMergePirateFactions(galaxy: Galaxy): void {
    // RND: draws in callees (d≤3) — not drawn until M4s.
    /* TODO(port) M4s */ todo(T_checkMergePirateFactions);
}

const T_reviewPirateEmpireActivities = registerTodo('M4s', 'reviewPirateEmpireActivities');
/** Galaxy.8.cs 3398 ReviewPirateEmpireActivities. */
export function reviewPirateEmpireActivities(galaxy: Galaxy): void {
    /* TODO(port) M4s */ todo(T_reviewPirateEmpireActivities);
}
