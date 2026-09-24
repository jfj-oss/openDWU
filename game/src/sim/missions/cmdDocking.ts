// M4e — ExecuteCommands cases Dock / Undock / Load / Unload / Refuel (BuiltObject.2.cs).
//
// Stub file created by M4b (tasks/M4-plan.md §3.2 / §6 "ExecuteCommands dispatcher"): each export is one `case` of
// the C# switch with the `CommandHandler` signature from executeCommands.ts — it receives the shared locals
// (`CommandContext`: bo, mission, command, timePassed/time/starDate, targetX/targetY = num/num2, indexX/indexY = x/y,
// parent-relative outputs) and returns the C# `result` (seconds left for the DoTasks loop). The stubs do NOT draw
// Galaxy.Rnd (`RND:` notes mark the skipped sites) and record a TODO hit; M4e replaces the bodies in place.

import { registerTodo, todo } from '../tick/todo';
import type { CommandHandler } from './executeCommands';

const T_cmdDock = registerTodo('M4e', 'cmdDock');
/** BuiltObject.2.cs 2731 case Dock. */
export const cmdDock: CommandHandler = (ctx) => {
    /* TODO(port) M4e */ todo(T_cmdDock);
    // Stub: the command stays at the head of the queue (the ship waits) and no time is consumed (result 0.0
    // ends the DoTasks command loop), so nothing downstream runs until the owner ports the case body.
    void ctx;
    return 0.0;
};

const T_cmdUndock = registerTodo('M4e', 'cmdUndock');
/** BuiltObject.2.cs 3642 case Undock. */
export const cmdUndock: CommandHandler = (ctx) => {
    /* TODO(port) M4e */ todo(T_cmdUndock);
    // Stub: the command stays at the head of the queue (the ship waits) and no time is consumed (result 0.0
    // ends the DoTasks command loop), so nothing downstream runs until the owner ports the case body.
    void ctx;
    return 0.0;
};

const T_cmdLoad = registerTodo('M4e', 'cmdLoad');
/** BuiltObject.2.cs 3232 case Load. */
export const cmdLoad: CommandHandler = (ctx) => {
    /* TODO(port) M4e */ todo(T_cmdLoad);
    // Stub: the command stays at the head of the queue (the ship waits) and no time is consumed (result 0.0
    // ends the DoTasks command loop), so nothing downstream runs until the owner ports the case body.
    void ctx;
    return 0.0;
};

const T_cmdUnload = registerTodo('M4e', 'cmdUnload');
/** BuiltObject.2.cs 3698 case Unload. */
export const cmdUnload: CommandHandler = (ctx) => {
    /* TODO(port) M4e */ todo(T_cmdUnload);
    // Stub: the command stays at the head of the queue (the ship waits) and no time is consumed (result 0.0
    // ends the DoTasks command loop), so nothing downstream runs until the owner ports the case body.
    void ctx;
    return 0.0;
};

const T_cmdRefuel = registerTodo('M4e', 'cmdRefuel');
/** BuiltObject.2.cs 4226 case Refuel. */
export const cmdRefuel: CommandHandler = (ctx) => {
    /* TODO(port) M4e */ todo(T_cmdRefuel);
    // Stub: the command stays at the head of the queue (the ship waits) and no time is consumed (result 0.0
    // ends the DoTasks command loop), so nothing downstream runs until the owner ports the case body.
    void ctx;
    return 0.0;
};
