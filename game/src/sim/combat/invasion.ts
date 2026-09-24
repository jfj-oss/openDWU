// M4q — ground invasion, colony capture, ownership scans.
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

const T_calculateSpaceControlStrengths = registerTodo('M4q', 'calculateSpaceControlStrengths');
/** Habitat.cs 4423 / BaconHabitat.cs 1162 CalculateSpaceControlStrengths(defender, invader, out defenders, out attackers); the stub leaves the -1 initial values. */
export function calculateSpaceControlStrengths(galaxy: Galaxy, habitat: Habitat, defender: Empire | null, invader: Empire | null): { defenders: number; attackers: number } {
    /* TODO(port) M4q */ todo(T_calculateSpaceControlStrengths);
    return { defenders: -1, attackers: -1 };
}

const T_resolveInvasionBattles = registerTodo('M4q', 'resolveInvasionBattles');
/** Habitat.cs 3365 ResolveInvasionBattles(timeSpan, galaxy). */
export function resolveInvasionBattles(galaxy: Galaxy, habitat: Habitat, timeSpanSeconds: number): void {
    // RND: 13 direct, +clock×2 — not drawn until M4q.
    /* TODO(port) M4q */ todo(T_resolveInvasionBattles);
}

const T_invadeUnwillingColonizationTargets = registerTodo('M4q', 'invadeUnwillingColonizationTargets');
/** Empire.4.cs 4449 InvadeUnwillingColonizationTargets(galaxy). */
export function invadeUnwillingColonizationTargets(galaxy: Galaxy, empire: Empire): void {
    // RND: 1 direct — not drawn until M4q.
    /* TODO(port) M4q */ todo(T_invadeUnwillingColonizationTargets);
}

const T_scanForNewOwnerHabitat = registerTodo('M4q', 'scanForNewOwnerHabitat');
/** Habitat.cs 2571 ScanForNewOwner. */
export function scanForNewOwnerHabitat(galaxy: Galaxy, habitat: Habitat): void {
    // RND: draws in callees (d≤3) — not drawn until M4q.
    /* TODO(port) M4q */ todo(T_scanForNewOwnerHabitat);
}

const T_scanForNewOwnerBuiltObject = registerTodo('M4q', 'scanForNewOwnerBuiltObject');
/** BuiltObject.1.cs 65 ScanForNewOwner. */
export function scanForNewOwnerBuiltObject(galaxy: Galaxy, builtObject: BuiltObject): void {
    // RND: draws in callees (d≤3), +clock×2 — not drawn until M4q.
    /* TODO(port) M4q */ todo(T_scanForNewOwnerBuiltObject);
}

const T_clearColony = registerTodo('M4q', 'clearColony');
/** Habitat.cs 7450 ClearColony(newOwner) (added by M4j: ReviewColonyPopulationPolicy clears emptied colonies). */
export function clearColony(galaxy: Galaxy, habitat: Habitat, newOwner: Empire | null): void {
    /* TODO(port) M4q */ todo(T_clearColony);
}
