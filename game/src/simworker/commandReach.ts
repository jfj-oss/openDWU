// Sim worker: what a command's reply must carry beyond its arguments, result and issuing empire (docs/sim-worker.md
// §4.3 "Fresh replies"). The host compares those (compareNow, compareReach: 3 levels, 3000 objects) in the delta of the
// tick that applied the command, so a screen that re-renders in onApplied sees the change. Ops that name what they
// change by a number (a fleet template id, a construction job id) change objects that none of those reach in time: a
// template's rows are empire → fleetDesigns → templates → template → entries → entry, past the reach, and on a big
// empire the reach's 3000 objects are spent on the empire's own lists first. The Fleet Designs tab then redrew from the
// replica as it was before the order (a row added by Add Design did not show until the next reply). These are the
// roots to compare for them, read after the executor ran (the book may have been created by the command).
// No DOM / Pixi imports.

import type { Empire } from '../sim/empire';

/** Objects to compare (compareReach roots) after `op` was applied for `empire`: the books its numeric ids point into. */
export function commandFreshRoots(op: string, empire: Empire): object[] {
    if (op.startsWith('fleetTemplate')) {
        const book = empire.fleetDesigns;
        if (book === undefined) return [];
        // Each template whole (its entries and their rows, 3 levels down), each build order (its pending ships) and
        // each fleet's template link (player/fleetRefill.ts).
        const links = book.links ?? [];
        return [book, book.templates, ...book.templates, book.orders, ...book.orders, ...(book.links !== undefined ? [book.links, ...links] : [])];
    }
    if (op.startsWith('constructionJob')) {
        const board = empire.constructionBoard as object | undefined | null;
        if (board == null) return [];
        const jobs = (board as { jobs?: unknown }).jobs;
        return Array.isArray(jobs) ? [board, jobs, ...jobs.filter((j): j is object => j !== null && typeof j === 'object')] : [board];
    }
    return [];
}
