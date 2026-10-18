// Mutual non-aggression between two empires that a scenario layer declares "spared" (the Purifier and the Ancient Guardians: the
// Purifier was destroyed by the Guardians, so neither ever attacks, blockades or targets the other). The stock combat code asks
// here before it picks a target, fires, or applies damage. No scenario = false; never draws Rnd.
import type { Empire } from '../empire';
import type { Galaxy } from '../galaxy';
import { scenarioQuery } from '../scenario/hooks';

interface OwnedLike {
    actualEmpire?: Empire | null;
    empire?: Empire | null;
    parentBuiltObject?: { actualEmpire?: Empire | null; empire?: Empire | null } | null;
}

/** The empire an object (ship, base, colony, fighter) fights for; null for a creature or nothing. */
export function sparedOwnerOf(o: unknown): Empire | null {
    if (o === null || o === undefined || typeof o !== 'object') return null;
    const x = o as OwnedLike;
    if (x.actualEmpire !== undefined && x.actualEmpire !== null) return x.actualEmpire;
    if (x.empire !== undefined && x.empire !== null) return x.empire;
    const p = x.parentBuiltObject;
    if (p !== undefined && p !== null) return p.actualEmpire ?? p.empire ?? null;
    return null;
}

/** True when the two empires are declared never to fight each other. */
export function sparedEmpires(galaxy: Galaxy, a: Empire | null, b: Empire | null): boolean {
    if (galaxy.scenario === null || a === null || b === null || a === b) return false;
    return scenarioQuery(galaxy, 'empiresSpared', false, { a, b });
}

/** The same for two objects (ship, base, colony, fighter); a creature is never spared. */
export function sparedObjects(galaxy: Galaxy, a: unknown, b: unknown): boolean {
    if (galaxy.scenario === null) return false;
    return sparedEmpires(galaxy, sparedOwnerOf(a), sparedOwnerOf(b));
}
