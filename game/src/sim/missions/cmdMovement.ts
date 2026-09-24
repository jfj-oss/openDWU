// M4c — ExecuteCommands cases MoveTo / SprintTo / ImpulseTo / HyperTo / ConditionalHyperTo / HoldSyncFleet (BuiltObject.2.cs).
//
// Stub file created by M4b (tasks/M4-plan.md §3.2 / §6 "ExecuteCommands dispatcher"): each export is one `case` of
// the C# switch with the `CommandHandler` signature from executeCommands.ts — it receives the shared locals
// (`CommandContext`: bo, mission, command, timePassed/time/starDate, targetX/targetY = num/num2, indexX/indexY = x/y,
// parent-relative outputs) and returns the C# `result` (seconds left for the DoTasks loop). The stubs do NOT draw
// Galaxy.Rnd (`RND:` notes mark the skipped sites) and record a TODO hit; M4c replaces the bodies in place.

import { registerTodo, todo } from '../tick/todo';
import type { CommandHandler } from './executeCommands';

const T_cmdMoveTo = registerTodo('M4c', 'cmdMoveTo');
/** BuiltObject.2.cs 3596 case MoveTo. */
export const cmdMoveTo: CommandHandler = (ctx) => {
    /* TODO(port) M4c */ todo(T_cmdMoveTo);
    // Stub: the command stays at the head of the queue (the ship waits) and no time is consumed (result 0.0
    // ends the DoTasks command loop), so nothing downstream runs until the owner ports the case body.
    void ctx;
    return 0.0;
};

const T_cmdSprintTo = registerTodo('M4c', 'cmdSprintTo');
/** BuiltObject.2.cs 3627 case SprintTo. */
export const cmdSprintTo: CommandHandler = (ctx) => {
    /* TODO(port) M4c */ todo(T_cmdSprintTo);
    // Stub: the command stays at the head of the queue (the ship waits) and no time is consumed (result 0.0
    // ends the DoTasks command loop), so nothing downstream runs until the owner ports the case body.
    void ctx;
    return 0.0;
};

const T_cmdImpulseTo = registerTodo('M4c', 'cmdImpulseTo');
/** BuiltObject.2.cs 3224 case ImpulseTo. */
export const cmdImpulseTo: CommandHandler = (ctx) => {
    /* TODO(port) M4c */ todo(T_cmdImpulseTo);
    // Stub: the command stays at the head of the queue (the ship waits) and no time is consumed (result 0.0
    // ends the DoTasks command loop), so nothing downstream runs until the owner ports the case body.
    void ctx;
    return 0.0;
};

const T_cmdHyperTo = registerTodo('M4c', 'cmdHyperTo');
/** BuiltObject.2.cs 3020 case HyperTo. RND: hyperjump exit point (SelectHyperJumpExitPoint) — not drawn until M4c. */
export const cmdHyperTo: CommandHandler = (ctx) => {
    /* TODO(port) M4c */ todo(T_cmdHyperTo);
    // Stub: the command stays at the head of the queue (the ship waits) and no time is consumed (result 0.0
    // ends the DoTasks command loop), so nothing downstream runs until the owner ports the case body.
    void ctx;
    return 0.0;
};

const T_cmdConditionalHyperTo = registerTodo('M4c', 'cmdConditionalHyperTo');
/** BuiltObject.2.cs 2928 case ConditionalHyperTo (goto case HyperTo 2966 / MoveTo 3002 stay inside this module). RND: via HyperTo — not drawn until M4c. */
export const cmdConditionalHyperTo: CommandHandler = (ctx) => {
    /* TODO(port) M4c */ todo(T_cmdConditionalHyperTo);
    // Stub: the command stays at the head of the queue (the ship waits) and no time is consumed (result 0.0
    // ends the DoTasks command loop), so nothing downstream runs until the owner ports the case body.
    void ctx;
    return 0.0;
};

const T_cmdHoldSyncFleet = registerTodo('M4c', 'cmdHoldSyncFleet');
/** BuiltObject.2.cs 1159 case HoldSyncFleet. */
export const cmdHoldSyncFleet: CommandHandler = (ctx) => {
    /* TODO(port) M4c */ todo(T_cmdHoldSyncFleet);
    // Stub: the command stays at the head of the queue (the ship waits) and no time is consumed (result 0.0
    // ends the DoTasks command loop), so nothing downstream runs until the owner ports the case body.
    void ctx;
    return 0.0;
};
