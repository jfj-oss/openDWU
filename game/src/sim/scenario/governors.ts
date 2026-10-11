// Shared governor helpers for the scenario packages (docs/CHARACTERS_AND_VICTORY.md §3.1). Not a port. One place for
// "the governor of this colony" (formerly written in security.ts, frontier.ts and politics.ts with these exact
// semantics) and for spawning a governor for a colony, which the Characters & Victory add-on routes through its
// birthplace + VIP trip when it runs. Pure lookups; spawnGovernorFor draws as the stock generator does.

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import type { Habitat } from '../types';
import { type Character, CharacterRole, generateNewCharacter, isBuiltObjectLocation, stellarObjectCharacters } from '../characters';

/** The ColonyGovernor located at `h` that belongs to `h`'s empire (the first in the colony's list), or null. */
export function colonyGovernor(h: Habitat): Character | null {
    const chars = stellarObjectCharacters(h);
    if (chars === null) return null;
    for (const c of chars) if (c.active && c.role === CharacterRole.ColonyGovernor && c.empire === h.empire) return c;
    return null;
}

/** The colony `c` governs: its location when it is a ColonyGovernor at a colony of its own empire, else null. */
export function governedColony(c: Character): Habitat | null {
    if (c.role !== CharacterRole.ColonyGovernor) return null;
    const loc = c.location;
    if (loc === null || isBuiltObjectLocation(loc)) return null;
    const h = loc as Habitat;
    return h.empire !== null && h.empire === c.empire ? h : null;
}

/** A package that takes over governor spawning (Characters & Victory); returns null to fall back to the stock call. */
export type GovernorSpawner = (galaxy: Galaxy, empire: Empire, colony: Habitat) => Character | null;

// eslint-disable-next-line no-var
var spawner: GovernorSpawner | null | undefined;

export function registerGovernorSpawner(fn: GovernorSpawner | null): void {
    spawner = fn;
}

/**
 * A new governor for `colony`. Without a registered spawner (or when it declines: its package is off) this is exactly
 * generateNewCharacter(galaxy, empire, ColonyGovernor, colony) — the call frontier-autonomy and corporatecoup made.
 */
export function spawnGovernorFor(galaxy: Galaxy, empire: Empire, colony: Habitat): Character {
    const c = spawner != null ? spawner(galaxy, empire, colony) : null;
    return c ?? generateNewCharacter(galaxy, empire, CharacterRole.ColonyGovernor, colony).character;
}

// ---------------------------------------------------------------------------------------------------------------
// Governor neglect and bribe scale (provided by Characters & Victory; inert without it)
// ---------------------------------------------------------------------------------------------------------------

/** 0..1: how neglected a colony is for want of a governor (Characters & Victory's vacancy decline). */
export type ColonyNeglectProvider = (galaxy: Galaxy, colony: Habitat) => number;
/** Factor on a per-governor bribe chance so the expected bribes stay those of the stock governor count. */
export type GovernorBribeScale = (galaxy: Galaxy, empire: Empire, governorsAtColonies: number) => number;

// eslint-disable-next-line no-var
var neglectProvider: ColonyNeglectProvider | null | undefined;
// eslint-disable-next-line no-var
var bribeScaleProvider: GovernorBribeScale | null | undefined;

export function registerColonyNeglect(fn: ColonyNeglectProvider | null): void {
    neglectProvider = fn;
}
export function registerGovernorBribeScale(fn: GovernorBribeScale | null): void {
    bribeScaleProvider = fn;
}

/** The colony's neglect (0 when no package provides one, or its package is off). Pure. */
export function colonyNeglectOf(galaxy: Galaxy, colony: Habitat): number {
    return neglectProvider != null ? neglectProvider(galaxy, colony) : 0;
}

/** The bribe-chance factor for `empire` (1 when no package provides one, or its package is off). Pure. */
export function governorBribeScale(galaxy: Galaxy, empire: Empire, governorsAtColonies: number): number {
    return bribeScaleProvider != null ? bribeScaleProvider(galaxy, empire, governorsAtColonies) : 1;
}
