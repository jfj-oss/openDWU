// M4n — ship attack AI and attack ranges.
//
// Stubs created by M4a (tasks/M4-plan.md §3.1): the tick skeletons in src/sim/tick/ call these entry points in C#
// order. Each is a no-op that does NOT draw Galaxy.Rnd (a `RND:` note marks C# draw sites that are skipped until the
// owning package ports the body) and records a TODO hit (tick/todo.ts). The owning package replaces the bodies in
// place, keeping the signatures (or adjusting the skeleton call in the same change).

import type { Galaxy } from '../galaxy';
import type { BuiltObject } from '../builtObject';
import { registerTodo, todo } from '../tick/todo';

const T_checkNearTarget = registerTodo('M4n', 'checkNearTarget');
/** BaconBuiltObject.cs 2578 CheckNearTarget(ship). */
export function checkNearTarget(galaxy: Galaxy, builtObject: BuiltObject): void {
    /* TODO(port) M4n */ todo(T_checkNearTarget);
}

const T_setAttackRangeWhenNoMission = registerTodo('M4n', 'setAttackRangeWhenNoMission');
/** BuiltObject.2.cs 7734 SetAttackRangeWhenNoMission. */
export function setAttackRangeWhenNoMission(galaxy: Galaxy, builtObject: BuiltObject): void {
    /* TODO(port) M4n */ todo(T_setAttackRangeWhenNoMission);
}

const T_modifyAttackRangeByTargetSpeed = registerTodo('M4n', 'modifyAttackRangeByTargetSpeed');
/** BuiltObject.2.cs 197 ModifyAttackRangeByTargetSpeed. */
export function modifyAttackRangeByTargetSpeed(galaxy: Galaxy, builtObject: BuiltObject): void {
    /* TODO(port) M4n */ todo(T_modifyAttackRangeByTargetSpeed);
}

const T_checkForAttack = registerTodo('M4n', 'checkForAttack');
/** BuiltObject.1.cs 1185 CheckForAttack(galaxy). */
export function checkForAttack(galaxy: Galaxy, builtObject: BuiltObject): void {
    /* TODO(port) M4n */ todo(T_checkForAttack);
}

const T_checkForRandomAttackTargets = registerTodo('M4n', 'checkForRandomAttackTargets');
/** BuiltObject.1.cs 1852 CheckForRandomAttackTargets. */
export function checkForRandomAttackTargets(galaxy: Galaxy, builtObject: BuiltObject): void {
    /* TODO(port) M4n */ todo(T_checkForRandomAttackTargets);
}
