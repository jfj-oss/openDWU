// M4q — boarding, assault pods, tractor beams, prisoners.
//
// Stubs created by M4a (tasks/M4-plan.md §3.1): the tick skeletons in src/sim/tick/ call these entry points in C#
// order. Each is a no-op that does NOT draw Galaxy.Rnd (a `RND:` note marks C# draw sites that are skipped until the
// owning package ports the body) and records a TODO hit (tick/todo.ts). The owning package replaces the bodies in
// place, keeping the signatures (or adjusting the skeleton call in the same change).

import type { Galaxy } from '../galaxy';
import type { BuiltObject } from '../builtObject';
import type { Habitat } from '../types';
import type { Creature } from '../creature';
import type { ShipGroup } from '../fleets/shipGroup';
import { registerTodo, todo } from '../tick/todo';

const T_processBoardingAssault = registerTodo('M4q', 'processBoardingAssault');
/** BuiltObject.1.cs 2954 ProcessBoardingAssault(time, timePassed). */
export function processBoardingAssault(galaxy: Galaxy, builtObject: BuiltObject, time: number, timePassed: number): void {
    // RND: 5 direct, +clock×3 — not drawn until M4q.
    /* TODO(port) M4q */ todo(T_processBoardingAssault);
}

const T_handleAssaultPodMovement = registerTodo('M4q', 'handleAssaultPodMovement');
/** BuiltObject.1.cs 2626 HandleAssaultPodMovement(timePassed). */
export function handleAssaultPodMovement(galaxy: Galaxy, builtObject: BuiltObject, timePassed: number): void {
    // RND: draws in callees (d≤3) — not drawn until M4q.
    /* TODO(port) M4q */ todo(T_handleAssaultPodMovement);
}

const T_fireAtAssaultPods = registerTodo('M4q', 'fireAtAssaultPods');
/** BuiltObject.1.cs 2905 FireAtAssaultPods(time, inView). */
export function fireAtAssaultPods(galaxy: Galaxy, builtObject: BuiltObject, time: number, inView: boolean): void {
    // RND: draws in callees (d≤3) — not drawn until M4q.
    /* TODO(port) M4q */ todo(T_fireAtAssaultPods);
}

const T_resetAssaultPods = registerTodo('M4q', 'resetAssaultPods');
/** BaconBuiltObject.cs 777 ResetAssaultPods(ship). */
export function resetAssaultPods(galaxy: Galaxy, builtObject: BuiltObject): void {
    /* TODO(port) M4q */ todo(T_resetAssaultPods);
}

const T_fireTractorBeamsAtInvadingTroopTransports = registerTodo('M4q', 'fireTractorBeamsAtInvadingTroopTransports');
/** BuiltObject.cs 4191 FireTractorBeamsAtInvadingTroopTransports(time, inView). */
export function fireTractorBeamsAtInvadingTroopTransports(galaxy: Galaxy, builtObject: BuiltObject, time: number, inView: boolean): void {
    // RND: draws in callees (d≤3) — not drawn until M4q.
    /* TODO(port) M4q */ todo(T_fireTractorBeamsAtInvadingTroopTransports);
}

const T_baconBuiltObjectHugeProcessingSpanActions = registerTodo('M4q', 'baconBuiltObjectHugeProcessingSpanActions');
/** BaconBuiltObject.cs 4083 HugeProcessingSpanActions(ship) — AssignNearestSystemStarIfNull + prisoners. */
export function baconBuiltObjectHugeProcessingSpanActions(galaxy: Galaxy, builtObject: BuiltObject): void {
    // RND: clock×1 (new Random().NextDouble() > 0.25) — not drawn until M4q.
    /* TODO(port) M4q */ todo(T_baconBuiltObjectHugeProcessingSpanActions);
}

// ---- stubs added by M4n (called from missions/cmdAttack.ts) ----

const T_checkLaunchAssaultPodsAtTarget = registerTodo('M4q', 'checkLaunchAssaultPodsAtTarget');
/** BuiltObject.1.cs 2531 / 2567 CheckLaunchAssaultPodsAtTarget(time, Habitat | BuiltObject target) — stub. */
export function checkLaunchAssaultPodsAtTarget(galaxy: Galaxy, builtObject: BuiltObject, time: number, target: BuiltObject | Habitat): void {
    /* TODO(port) M4q */ todo(T_checkLaunchAssaultPodsAtTarget);
}

const T_shipGroupTotalAvailableBoardingAssaultStrengthCapturingTarget = registerTodo('M4q', 'shipGroupTotalAvailableBoardingAssaultStrengthCapturingTarget');
/** ShipGroup.cs 3165 TotalAvailableBoardingAssaultStrengthCapturingTarget(time, target) — stub: 0. */
export function shipGroupTotalAvailableBoardingAssaultStrengthCapturingTarget(galaxy: Galaxy, shipGroup: ShipGroup, time: number, target: BuiltObject | Habitat | Creature | null): number {
    /* TODO(port) M4q */ todo(T_shipGroupTotalAvailableBoardingAssaultStrengthCapturingTarget);
    return 0;
}
