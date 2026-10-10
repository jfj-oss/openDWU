// [improvements] "State ships first at shipyards" — a gameplay Improvement (ui/improvements.ts 'statePriorityShipyards';
// NOT in DW:U). PLAYER empire's construction queues only (space ports, construction ships, colony yards); AI empires
// are never touched.
//
// The switch reaches the sim as the journaled player command `setStatePriorityShipyards` (player/playerOps.ts), which
// the game view issues at start / load and whenever the Improvement is toggled (ui/statePriorityShipyards.ts). Only
// then is `empire.statePriorityShipyards` true; a harness / headless game never has it, and ConstructionQueue
// ProcessWaitQueue (constructionQueue.ts) then runs the original code unchanged.
//
// With it on, the player's ConstructionQueue.ProcessWaitQueue becomes:
//   1. State ships first: the wait queue is offered to the free berths (ConstructionYardList.AddBuiltObjectToConstruct,
//      unchanged) with the state ships (BuiltObject.owner != null) first, then the private ones (owner == null), each
//      group in its queue order. A private ship that is no longer bumpable (rule 3) counts with the state ships, so it
//      gets its berth by the original queue order.
//   2. Bumping: a state ship still waiting (every berth busy) takes the berth of the private ship under construction
//      with the least progress (built components / components; ties → the first yard). Only new builds and repairs
//      are bumped (never a scrap or a retrofit, whose yard holds its retrofit lists). The bumped ship is PAUSED: it
//      keeps its built components (they are its progress) and the yard's fractional progress (saved on the ship and
//      put back when it gets a berth again), and goes to the head of the wait queue — the place the original's
//      ConstructionQueue.Redefine (a destroyed yard) puts a ship it takes off a berth.
//   3. Anti-starvation: a private ship whose total time paused by this rule exceeds 6 game months is never bumped again.
//   4. Accounting: nothing is refunded or re-bought. A queued ship's money is paid and its components / resources are
//      reserved when it is queued (Empire ProcureConstructionComponents), not when it gets a berth, and a component is
//      taken from the cargo only when it is built; moving a ship between berth and wait queue touches none of that.
// Headless, deterministic, no Galaxy.Rnd.

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import type { BuiltObject } from '../builtObject';
import type { ConstructionYard } from './constructionYard';
import { ComponentStatus } from '../builtObjectComponent';
import { YEAR_LENGTH } from '../galaxyTime';
import { isHumanEmpire } from '../humanEmpires';

declare module '../empire' {
    interface Empire {
        /** [improvements] statePriorityShipyards on for this (player) empire; absent = off (the original). */
        statePriorityShipyards?: boolean;
    }
}

declare module '../builtObject' {
    interface BuiltObject {
        /** [improvements] statePriorityShipyards: total ms this private ship has spent paused (bumped); absent = never. */
        statePriorityPausedMs?: number;
        /** [improvements] galaxy.nowMs when it was last bumped off its berth; absent = not paused now. */
        statePriorityPausedAt?: number;
        /** [improvements] the yard's IncrementalProgress when it was bumped (restored with its next berth). */
        statePriorityProgress?: number;
    }
}

/** Improvement id (ui/improvements.ts, settings key). */
export const STATE_PRIORITY_IMPROVEMENT = 'statePriorityShipyards';

/** A private ship paused longer than this (6 game months, star-date ms) is no longer bumped. */
export const STATE_PRIORITY_MAX_PAUSE_MS = YEAR_LENGTH / 2;

/** Whether the rule applies to a queue of `empire`: the player empire with the flag set by the UI. */
export function statePriorityActive(galaxy: Galaxy, empire: Empire | null): boolean {
    return empire !== null && empire.statePriorityShipyards === true && isHumanEmpire(galaxy, empire);
}

/** The `setStatePriorityShipyards` player op: on sets the flag; off removes it (state identical to never set). */
export function setStatePriorityShipyards(galaxy: Galaxy, empire: Empire, on: boolean): boolean {
    if (!isHumanEmpire(galaxy, empire)) return false;
    if (on) empire.statePriorityShipyards = true;
    else delete empire.statePriorityShipyards;
    return true;
}

/** A state ship (hud.ts builtObjectRows "STATE"): owned by the empire, not a private citizen. */
export function isStateShip(ship: BuiltObject): boolean {
    return ship.owner != null;
}

/** Total time `ship` has been paused by this rule, including a pause still running. */
export function statePriorityPausedTotal(galaxy: Galaxy, ship: BuiltObject): number {
    let total = ship.statePriorityPausedMs ?? 0;
    if (ship.statePriorityPausedAt !== undefined) total += galaxy.nowMs - ship.statePriorityPausedAt;
    return total;
}

/** A private ship that may no longer be bumped (paused more than 6 game months in all). */
function bumpExempt(galaxy: Galaxy, ship: BuiltObject): boolean {
    return statePriorityPausedTotal(galaxy, ship) > STATE_PRIORITY_MAX_PAUSE_MS;
}

/** Share of the ship's components that are built (its construction progress, 0..1). */
export function constructionProgress(ship: BuiltObject): number {
    const items = ship.components?.items ?? [];
    if (items.length === 0) return 1;
    let built = 0;
    for (const c of items) if (c.status === ComponentStatus.Normal) built++;
    return built / items.length;
}

/** The yard whose private ship may be bumped with the least progress (null = none). */
function bumpCandidate(galaxy: Galaxy, yards: readonly ConstructionYard[]): ConstructionYard | null {
    let best: ConstructionYard | null = null;
    let bestProgress = Infinity;
    for (const yard of yards) {
        const ship = yard.shipUnderConstruction;
        if (ship === null || isStateShip(ship) || ship.scrap || ship.retrofitDesign !== null) continue;
        if (bumpExempt(galaxy, ship)) continue;
        const p = constructionProgress(ship);
        if (p < bestProgress) {
            best = yard;
            bestProgress = p;
        }
    }
    return best;
}

/** A ship just got a berth in `yard`: end its pause (if any) and give back the yard progress it had. */
function resumed(galaxy: Galaxy, yard: ConstructionYard | null, ship: BuiltObject): void {
    if (ship.statePriorityPausedAt !== undefined) {
        ship.statePriorityPausedMs = (ship.statePriorityPausedMs ?? 0) + (galaxy.nowMs - ship.statePriorityPausedAt);
        delete ship.statePriorityPausedAt;
    }
    if (ship.statePriorityProgress !== undefined) {
        if (yard !== null) yard.incrementalProgress = ship.statePriorityProgress;
        delete ship.statePriorityProgress;
    }
}

/**
 * ConstructionQueue.ProcessWaitQueue with the rule on. `assign` is ConstructionYardList.AddBuiltObjectToConstruct for
 * this queue (true = the ship took a free berth). Mutates `waitQueue` (and the yards) in place.
 */
export function processWaitQueueStatePriority(galaxy: Galaxy, yards: ConstructionYard[], waitQueue: BuiltObject[], assign: (ship: BuiltObject) => boolean): void {
    if (waitQueue.length <= 0) return;
    const yardOf = (ship: BuiltObject): ConstructionYard | null => yards.find((y) => y.shipUnderConstruction === ship) ?? null;
    // 1. Free berths: state ships (and private ships past the pause limit) first, each group in queue order.
    const first: BuiltObject[] = [];
    const rest: BuiltObject[] = [];
    for (const s of waitQueue) {
        if (s == null) continue;
        if (isStateShip(s) || bumpExempt(galaxy, s)) first.push(s);
        else rest.push(s);
    }
    const assigned: BuiltObject[] = [];
    for (const s of [...first, ...rest]) {
        if (assign(s)) {
            assigned.push(s);
            resumed(galaxy, yardOf(s), s);
        }
    }
    for (const s of assigned) {
        const i = waitQueue.indexOf(s);
        if (i >= 0) waitQueue.splice(i, 1);
    }
    // 2. Bumping: each state ship still waiting takes the berth of the least-progressed bumpable private ship.
    const waitingState = waitQueue.filter((s) => s != null && isStateShip(s));
    for (const s of waitingState) {
        const yard = bumpCandidate(galaxy, yards);
        if (yard === null) break;
        const bumped = yard.shipUnderConstruction!;
        bumped.statePriorityProgress = yard.incrementalProgress;
        bumped.statePriorityPausedAt = galaxy.nowMs;
        yard.shipUnderConstruction = null;
        yard.retrofitComponentsToBeBuilt = null;
        yard.retrofitComponentsToBeScrapped = null;
        yard.incrementalProgress = 0;
        if (!assign(s)) {
            // Cannot happen (the berth is free), but never lose the bumped ship.
            yard.shipUnderConstruction = bumped;
            resumed(galaxy, yard, bumped);
            break;
        }
        resumed(galaxy, yardOf(s), s);
        const i = waitQueue.indexOf(s);
        if (i >= 0) waitQueue.splice(i, 1);
        waitQueue.splice(0, 0, bumped);
    }
}
