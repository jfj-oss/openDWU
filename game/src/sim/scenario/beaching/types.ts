// Beached ships (scenarios/beaching; not in the original) — the per-ship state and the cheap readers the base-game call
// sites use (builtObjectTick's weapons step, the troop garrison review, the colony transfer). No imports but types, so any
// sim module can read the fields without pulling the package in. The rules live in beaching.ts.

import type { BuiltObject } from '../../builtObject';
import type { Habitat } from '../../types';
import type { Troop } from '../../cargo';

/** A warship beached on one of its empire's colonies (BuiltObject.beached). */
export interface BeachedState {
    /** The colony it lies on. */
    colony: Habitat;
    /** Star date it crash-landed. */
    since: number;
    /** Its place around the planet (0..3). */
    slot: number;
    /** Its crew, joined to the colony's garrison (null once killed / removed). */
    crew: Troop | null;
    /** What the beaching cost the colony: base-quality units. */
    lossUnits: number;
    /** IsAutoControlled before the beaching (automation is off while beached). */
    auto: boolean;
}

declare module '../../builtObject' {
    interface BuiltObject {
        /** Beached ships (scenarios/beaching): absent unless the ship is a grounded fortress. */
        beached?: BeachedState;
    }
}

declare module '../../cargo' {
    interface Troop {
        /** Beached ships (scenarios/beaching): this unit is a beached ship's crew (never picked up, transferred or released). */
        beached?: boolean;
    }
}

/** A beached ship. */
export function isBeached(bo: BuiltObject): boolean {
    return bo.beached !== undefined;
}

/** True while troops fight on the colony's surface (the stock invasion state: landed enemy troops). */
export function groundBattleOn(h: Habitat): boolean {
    return h.invadingTroops !== null && h.invadingTroops.count > 0;
}

/**
 * Hot path (builtObjectTick's weapons step): may this ship fire? A beached ship's crew fights on the ground while a
 * ground battle runs on its colony, so its guns stay cold until the battle is over; any other ship may.
 */
export function beachedMayFire(bo: BuiltObject): boolean {
    const b = bo.beached;
    return b === undefined || !groundBattleOn(b.colony);
}
