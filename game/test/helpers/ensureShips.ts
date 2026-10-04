// Ships a test needs that the empire's game-start fleet may not include. How many ships of each sub-role an empire starts
// with comes from its force-structure projection (Galaxy.8.cs CreateStateShips), which follows its capital and income, so
// it moves whenever galaxy generation changes (seed 1's player went from two Escorts / Frigates / Destroyers and two
// construction ships to one of each). Tests that need "a second escort" take it from here instead of assuming the start
// gave one: missing ships are built from the empire's own design of that sub-role — the one its existing ships use, else
// its newest — through Empire.cs 4341 GenerateBuiltObjectFromDesign (every component Normal, state-owned, ReDefine'd, so
// the empire's ship lists pick it up), next to the first such ship or the capital. No galaxy.rnd draws (only a colony
// ship would draw, SelectRandomRace).
import type { Galaxy } from '../../src/sim/galaxy';
import type { Empire } from '../../src/sim/empire';
import type { BuiltObject } from '../../src/sim/builtObject';
import { BuiltObjectSubRole } from '../../src/sim/builtObjectTypes';
import { findNewest } from '../../src/sim/design';
import { generateBuiltObjectFromDesign } from '../../src/sim/exploration';

function liveOfSubRole(empire: Empire, subRole: BuiltObjectSubRole): BuiltObject[] {
    return (empire.builtObjects as (BuiltObject | null)[]).filter((b): b is BuiltObject => b !== null && !b.hasBeenDestroyed && b.subRole === subRole);
}

/**
 * The empire's live state ships of `subRole` (empire list order), at least `count` of them: the start fleet's first, then
 * ships built for the test from the empire's design of that sub-role. Throws when the empire has no such design.
 */
export function ensureShips(galaxy: Galaxy, empire: Empire, subRole: BuiltObjectSubRole, count: number): BuiltObject[] {
    const have = liveOfSubRole(empire, subRole);
    if (have.length >= count) return have;
    const design = have[0]?.design ?? findNewest(empire.designs, subRole);
    if (design === null || design === undefined) throw new Error(`ensureShips: ${empire.name} has no ${BuiltObjectSubRole[subRole]} design`);
    const anchor: { xpos: number; ypos: number } | null = have[0] ?? empire.capital;
    if (anchor === null) throw new Error(`ensureShips: ${empire.name} has neither a ${BuiltObjectSubRole[subRole]} nor a capital`);
    for (let k = have.length; k < count; k++) {
        generateBuiltObjectFromDesign(galaxy, empire, design, `${design.name} (test ${k + 1})`, true, anchor.xpos + 600 * k, anchor.ypos + 600);
    }
    return liveOfSubRole(empire, subRole);
}
