// Mothballing (scenarios/mothballing; not in the original) — the per-ship state and the cheap readers the base-game
// call sites use (intercept candidates, weapons firing). No imports but types, so any sim module can read the field
// without pulling the package in. The rules live in mothballing.ts.

import type { BuiltObject } from '../../builtObject';
import type { ShipGroup } from '../../fleets/shipGroup';
import type { BuiltObjectMission } from '../../missions/mission';

/** Flying to the port (full upkeep, moves and fights normally). */
export const MOTHBALL_TRAVEL = 0;
/** In reserve at the port: reduced upkeep, immobile, weapons cold. */
export const MOTHBALL_RESERVE = 1;
/** Reactivating: full upkeep, immobile, weapons manned (fights back from where it sits). */
export const MOTHBALL_REACTIVATING = 2;

export interface MothballState {
    phase: 0 | 1 | 2;
    /** The space port (a base of the ship's empire). */
    port: BuiltObject;
    /** The fleet the trip was ordered for (null: a lone warship). */
    fleet: ShipGroup | null;
    /** Star date the trip started (travel) / the reserve began (reserve) / the reactivation started (reactivating). */
    since: number;
    /** Reactivating: star date the ship is ready again. */
    readyAt: number;
    /** Travel: the move mission this package gave (another one = someone else gave an order). */
    mission: BuiltObjectMission | null;
    /** Reserve / reactivating: the ship's IsAutoControlled before the reserve (automation is off while mothballed, so
     *  the AI's fleet upkeep — Empire.8.cs MaintainShipGroups top-ups and disbands — leaves it alone); restored when ready. */
    auto?: boolean;
    /** Reserve / reactivating: the parking slot around the port (rings outward; mothballing.ts parkingSlotPoint). */
    slot?: number;
}

declare module '../../builtObject' {
    interface BuiltObject {
        /** Mothballing (scenarios/mothballing): absent unless the ship is on its way to / in / leaving reserve. */
        mothball?: MothballState;
    }
}

/** Any mothball phase (travel, reserve, reactivating): not available to Intercept / Defend / Watch or AI picks. */
export function isMothballed(bo: BuiltObject): boolean {
    return bo.mothball !== undefined;
}

/** In reserve proper (weapons cold). */
export function inReserve(bo: BuiltObject): boolean {
    return bo.mothball !== undefined && bo.mothball.phase === MOTHBALL_RESERVE;
}

/** Any ship of the fleet in a mothball phase. */
export function fleetMothballed(g: ShipGroup): boolean {
    for (const b of g.ships) if (b.mothball !== undefined) return true;
    return false;
}
