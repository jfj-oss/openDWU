// M4n — ExecuteCommands cases Attack / Bombard / Capture / Raid (one shared case body, 1698-2730) (BuiltObject.2.cs).
//
// Stub file created by M4b (tasks/M4-plan.md §3.2 / §6 "ExecuteCommands dispatcher"): each export is one `case` of
// the C# switch with the `CommandHandler` signature from executeCommands.ts — it receives the shared locals
// (`CommandContext`: bo, mission, command, timePassed/time/starDate, targetX/targetY = num/num2, indexX/indexY = x/y,
// parent-relative outputs) and returns the C# `result` (seconds left for the DoTasks loop). The stubs do NOT draw
// Galaxy.Rnd (`RND:` notes mark the skipped sites) and record a TODO hit; M4n replaces the bodies in place.

import { registerTodo, todo } from '../tick/todo';
import type { CommandHandler } from './executeCommands';

const T_cmdAttackBombardCaptureRaid = registerTodo('M4n', 'cmdAttackBombardCaptureRaid');
/** BuiltObject.2.cs 1698 case Attack / Bombard / Capture / Raid. RND: draws in the attack body — not drawn until M4n. */
export const cmdAttackBombardCaptureRaid: CommandHandler = (ctx) => {
    /* TODO(port) M4n */ todo(T_cmdAttackBombardCaptureRaid);
    // Stub: the command stays at the head of the queue (the ship waits) and no time is consumed (result 0.0
    // ends the DoTasks command loop), so nothing downstream runs until the owner ports the case body.
    void ctx;
    return 0.0;
};
