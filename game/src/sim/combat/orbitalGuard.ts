// openDWU rule (not in the original): no troop landing on a colony while its owner keeps a functioning armed base in
// orbit. In Distant Worlds: Universe raiders (assault pods) and invasion troops land under a live space port; here the
// attackers must first destroy (or disarm) the colony owner's space port / defensive base at that habitat. Ships can
// still attack the bases and bombard the planet as before. Applies to every empire: pirates raiding, empires invading.
// No Rnd.

import type { BuiltObject } from '../builtObject';
import type { Empire } from '../empire';
import type { Habitat } from '../types';
import { BuiltObjectSubRole } from '../builtObjectTypes';
import { BuiltObjectRole } from '../data/designSpecifications';

/** The reason the order menus show for a landing the rule refuses. */
export const ORBITAL_GUARD_REASON = 'Destroy the space port first';

function isGuardSubRole(sr: BuiltObjectSubRole): boolean {
    return sr === BuiltObjectSubRole.SmallSpacePort || sr === BuiltObjectSubRole.MediumSpacePort || sr === BuiltObjectSubRole.LargeSpacePort || sr === BuiltObjectSubRole.DefensiveBase;
}

/**
 * openDWU rule (not in the original): the colony owner's base that stops `landingEmpire` landing troops on `habitat`
 * — a space port or defensive base of the owner at the habitat, not destroyed, fully built, and armed (firepower) or a
 * defensive base — or null when troops may land. The owner itself (e.g. its Attack on a pirate facility) is never
 * stopped.
 */
export function orbitalGuardBase(habitat: Habitat | null, landingEmpire: Empire | null): BuiltObject | null {
    if (habitat === null) return null;
    const owner = habitat.empire;
    if (owner === null || owner === landingEmpire) return null;
    const bases = habitat.basesAtHabitat;
    if (bases === null) return null;
    for (let i = 0; i < bases.length; i++) {
        const b = bases[i];
        if (b == null || b.hasBeenDestroyed || b.empire !== owner || b.role !== BuiltObjectRole.Base || !isGuardSubRole(b.subRole)) continue;
        if (b.builtAt !== null || b.unbuiltComponentCount > 0) continue;
        if (b.firepowerRaw > 0 || b.subRole === BuiltObjectSubRole.DefensiveBase) return b;
    }
    return null;
}
