// M4h — ExecuteCommands cases Build / Scrap / Retrofit / Repair (BuiltObject.2.cs).
//
// Stub file created by M4b (tasks/M4-plan.md §3.2 / §6 "ExecuteCommands dispatcher"): each export is one `case` of
// the C# switch with the `CommandHandler` signature from executeCommands.ts — it receives the shared locals
// (`CommandContext`: bo, mission, command, timePassed/time/starDate, targetX/targetY = num/num2, indexX/indexY = x/y,
// parent-relative outputs) and returns the C# `result` (seconds left for the DoTasks loop). The stubs do NOT draw
// Galaxy.Rnd (`RND:` notes mark the skipped sites) and record a TODO hit; M4h replaces the bodies in place.

import { registerTodo, todo } from '../tick/todo';
import type { CommandHandler } from './executeCommands';

const T_cmdBuild = registerTodo('M4h', 'cmdBuild');
/** BuiltObject.2.cs 1444 case Build. RND: draws in callees (new ship naming) — not drawn until M4h. */
export const cmdBuild: CommandHandler = (ctx) => {
    /* TODO(port) M4h */ todo(T_cmdBuild);
    // Stub: the command stays at the head of the queue (the ship waits) and no time is consumed (result 0.0
    // ends the DoTasks command loop), so nothing downstream runs until the owner ports the case body.
    void ctx;
    return 0.0;
};

const T_cmdScrap = registerTodo('M4h', 'cmdScrap');
/** BuiltObject.2.cs 1311 case Scrap. */
export const cmdScrap: CommandHandler = (ctx) => {
    /* TODO(port) M4h */ todo(T_cmdScrap);
    // Stub: the command stays at the head of the queue (the ship waits) and no time is consumed (result 0.0
    // ends the DoTasks command loop), so nothing downstream runs until the owner ports the case body.
    void ctx;
    return 0.0;
};

const T_cmdRetrofit = registerTodo('M4h', 'cmdRetrofit');
/** BuiltObject.2.cs 704 case Retrofit. */
export const cmdRetrofit: CommandHandler = (ctx) => {
    /* TODO(port) M4h */ todo(T_cmdRetrofit);
    // Stub: the command stays at the head of the queue (the ship waits) and no time is consumed (result 0.0
    // ends the DoTasks command loop), so nothing downstream runs until the owner ports the case body.
    void ctx;
    return 0.0;
};

const T_cmdRepair = registerTodo('M4h', 'cmdRepair');
/** BuiltObject.2.cs 620 case Repair. */
export const cmdRepair: CommandHandler = (ctx) => {
    /* TODO(port) M4h */ todo(T_cmdRepair);
    // Stub: the command stays at the head of the queue (the ship waits) and no time is consumed (result 0.0
    // ends the DoTasks command loop), so nothing downstream runs until the owner ports the case body.
    void ctx;
    return 0.0;
};
