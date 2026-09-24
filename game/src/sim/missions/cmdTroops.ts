// M4q — ExecuteCommands cases Colonize (colonise / invade) (BuiltObject.2.cs).
//
// Stub file created by M4b (tasks/M4-plan.md §3.2 / §6 "ExecuteCommands dispatcher"): each export is one `case` of
// the C# switch with the `CommandHandler` signature from executeCommands.ts — it receives the shared locals
// (`CommandContext`: bo, mission, command, timePassed/time/starDate, targetX/targetY = num/num2, indexX/indexY = x/y,
// parent-relative outputs) and returns the C# `result` (seconds left for the DoTasks loop). The stubs do NOT draw
// Galaxy.Rnd (`RND:` notes mark the skipped sites) and record a TODO hit; M4q replaces the bodies in place.

import { registerTodo, todo } from '../tick/todo';
import type { CommandHandler } from './executeCommands';

const T_cmdColonize = registerTodo('M4q', 'cmdColonize');
/** BuiltObject.2.cs 936 case Colonize. RND: draws in colonisation / invasion callees — not drawn until M4q. */
export const cmdColonize: CommandHandler = (ctx) => {
    /* TODO(port) M4q */ todo(T_cmdColonize);
    // Stub: the command stays at the head of the queue (the ship waits) and no time is consumed (result 0.0
    // ends the DoTasks command loop), so nothing downstream runs until the owner ports the case body.
    void ctx;
    return 0.0;
};
