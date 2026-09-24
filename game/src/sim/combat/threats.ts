// M4n — threat evaluation.
//
// Stubs created by M4a (tasks/M4-plan.md §3.1): the tick skeletons in src/sim/tick/ call these entry points in C#
// order. Each is a no-op that does NOT draw Galaxy.Rnd (a `RND:` note marks C# draw sites that are skipped until the
// owning package ports the body) and records a TODO hit (tick/todo.ts). The owning package replaces the bodies in
// place, keeping the signatures (or adjusting the skeleton call in the same change).

import type { Galaxy } from '../galaxy';
import type { BuiltObject } from '../builtObject';
import type { Empire } from '../empire';
import type { Habitat } from '../types';
import type { SystemVisibility } from '../visibility';
import { registerTodo, todo } from '../tick/todo';

const T_threatEvaluation = registerTodo('M4n', 'threatEvaluation');
/** BuiltObject.1.cs 243 ThreatEvaluation(galaxy, time). */
export function threatEvaluation(galaxy: Galaxy, builtObject: BuiltObject, time: number): void {
    // RND: draws in callees (d≤3) — not drawn until M4n.
    /* TODO(port) M4n */ todo(T_threatEvaluation);
}

const T_fleeFromHopelessBattle = registerTodo('M4n', 'fleeFromHopelessBattle');
/** BuiltObject.1.cs 642 FleeFromHopelessBattle. */
export function fleeFromHopelessBattle(galaxy: Galaxy, builtObject: BuiltObject): void {
    // RND: draws in callees (d≤3) — not drawn until M4n.
    /* TODO(port) M4n */ todo(T_fleeFromHopelessBattle);
}

// ---- stubs added by M4b (called from missions/*.ts) ----

const T_determineDefendingStrength = registerTodo('M4n', 'determineDefendingStrength');
/** Galaxy.6.cs 4674 / 4745 DetermineDefendingStrength(BuiltObject | Habitat, empire) — stub: 0. */
export function determineDefendingStrength(galaxy: Galaxy, target: BuiltObject | Habitat, empire: Empire): number {
    /* TODO(port) M4n */ todo(T_determineDefendingStrength);
    return 0;
}

const T_calculateAttackingFirepowerNearEmpireTargets = registerTodo('M4n', 'calculateAttackingFirepowerNearEmpireTargets');
/** SystemVisibility.Threats.CalculateAttackingFirepowerNearEmpireTargets(empire) (BuiltObjectList.cs 570; Threats is an M4n field) — stub: 0. */
export function calculateAttackingFirepowerNearEmpireTargets(galaxy: Galaxy, systemVisibility: SystemVisibility, empire: Empire): number {
    /* TODO(port) M4n */ todo(T_calculateAttackingFirepowerNearEmpireTargets);
    return 0;
}
