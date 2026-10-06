// Defended colonies resist pirates (scenarios/colony-defence). Not a port: an opt-in rule on top of the original's pirate
// control (BaconHabitat.cs 1388 ReviewPirateControl, Empire.3.cs 254 PirateReviewColonyFacilities), where nothing an
// owner does in orbit stops a pirate faction's influence — any pirate ship within 1500 of the colony makes it grow, a
// repulsed raid leaves it untouched, and a faction can queue a new base as soon as its control is back at 0.5.
//
// With the flag on, for every empire's colonies (player and AI):
//   - a colony is DEFENDED while its owner has a space port or defensive base at it AND it repulsed a pirate raid, had
//     a pirate ship destroyed in its system, or destroyed a pirate facility within the last DEFENDED_WINDOW_YEARS;
//   - a defended colony gains no pirate control (no growth, no new faction, no raid gain), and no pirate facility can
//     be queued or make progress there;
//   - a repulsed raid or a destroyed facility multiplies that faction's control there by CONTROL_CUT_FACTOR and, when
//     the faction has no facility left there, caps it at NO_FACILITY_CONTROL_CAP (under the 0.5 base floor);
//   - after the colony's owner destroys a facility (the Attack path) the faction cannot queue a new one there for
//     REBUILD_COOLDOWN_YEARS.
// Rnd: none. State: scenario.state.colonyDefence (plain numbers keyed by habitat index).

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Habitat } from '../../types';
import type { BuiltObject } from '../../builtObject';
import { BuiltObjectSubRole } from '../../builtObjectTypes';
import { BuiltObjectRole } from '../../data/designSpecifications';
import { PlanetaryFacilityType } from '../../researchSystem';
import { YEAR_LENGTH } from '../../galaxyTime';
import { galaxyStarDate } from '../../tick/simTime';
import { scenarioState } from '../state';
import { registerScenarioEvent, registerScenarioQuery } from '../hooks';

export const COLONY_DEFENCE_FLAG = 'colonyDefence';
const STATE_KEY = 'colonyDefence';

/** Every threshold of the rule. */
export const COLONY_DEFENCE_RULES = {
    /** A repulse / pirate kill / destroyed facility keeps the colony defended this long (game years). */
    DEFENDED_WINDOW_YEARS: 1,
    /** A repulsed raid or destroyed facility multiplies the faction's control there by this. */
    CONTROL_CUT_FACTOR: 0.5,
    /** ...and caps it here when the faction has no pirate facility left there (the base floor is 0.5). */
    NO_FACILITY_CONTROL_CAP: 0.25,
    /** After the owner destroys a facility, the faction cannot queue a new one there for this long (game years). */
    REBUILD_COOLDOWN_YEARS: 2,
} as const;

interface ColonyDefenceState {
    /** habitatIndex → star date of the last pirate defeat at the colony. */
    lastDefeat: Record<string, number>;
    /** `${habitatIndex}:${pirateEmpireId}` → star date until which that faction cannot queue a facility there. */
    cooldownUntil: Record<string, number>;
}

function state(galaxy: Galaxy): ColonyDefenceState {
    return scenarioState<ColonyDefenceState>(galaxy, STATE_KEY, () => ({ lastDefeat: {}, cooldownUntil: {} }));
}

function isPirate(e: Empire | null): e is Empire {
    return e !== null && e.pirateEmpireBaseHabitat !== null;
}

function isPirateFacilityType(t: number): boolean {
    return t === PlanetaryFacilityType.PirateBase || t === PlanetaryFacilityType.PirateFortress || t === PlanetaryFacilityType.PirateCriminalNetwork;
}

/** The owner has a space port or defensive base at the colony (not destroyed). */
export function hasOwnerOrbitalDefence(habitat: Habitat): boolean {
    const owner = habitat.empire;
    if (owner === null || isPirate(owner)) return false;
    for (let i = 0; i < habitat.basesAtHabitat.length; i++) {
        const b: BuiltObject | null = habitat.basesAtHabitat[i];
        if (b === null || b.hasBeenDestroyed || b.empire !== owner || b.role !== BuiltObjectRole.Base) continue;
        const sr = b.subRole;
        if (sr === BuiltObjectSubRole.SmallSpacePort || sr === BuiltObjectSubRole.MediumSpacePort || sr === BuiltObjectSubRole.LargeSpacePort || sr === BuiltObjectSubRole.DefensiveBase) return true;
    }
    return false;
}

/** The colony is defended: owner's port / defensive base in orbit and a pirate defeat there within the window. */
export function colonyDefended(galaxy: Galaxy, habitat: Habitat): boolean {
    const last = state(galaxy).lastDefeat[habitat.habitatIndex];
    if (last === undefined || galaxyStarDate(galaxy) - last > COLONY_DEFENCE_RULES.DEFENDED_WINDOW_YEARS * YEAR_LENGTH) return false;
    return hasOwnerOrbitalDefence(habitat);
}

function markDefeat(galaxy: Galaxy, habitat: Habitat): void {
    state(galaxy).lastDefeat[habitat.habitatIndex] = galaxyStarDate(galaxy);
}

function factionHasFacilityThere(habitat: Habitat, pirate: Empire): boolean {
    const c = habitat.pirateColonyControl.getByFaction(pirate);
    if (c === null || !c.hasFacilityControl || habitat.facilities === null) return false;
    return habitat.facilities.some((f) => f !== null && isPirateFacilityType(f.type));
}

function cutControl(habitat: Habitat, pirate: Empire): void {
    const c = habitat.pirateColonyControl.getByFaction(pirate);
    if (c === null) return;
    let v = c.controlLevel * COLONY_DEFENCE_RULES.CONTROL_CUT_FACTOR;
    if (!factionHasFacilityThere(habitat, pirate)) v = Math.min(v, COLONY_DEFENCE_RULES.NO_FACILITY_CONTROL_CAP);
    // Keep the entry (ReviewPirateControl's decay removes it at 0, with the stock "lost control" message).
    c.controlLevel = Math.max(0.01, v);
}

registerScenarioEvent({
    id: 'colonyDefence.repulsed',
    flag: COLONY_DEFENCE_FLAG,
    event: 'pirateRaidRepulsed',
    run: (g, { habitat, invader }) => {
        if (!isPirate(invader) || habitat.empire === null || isPirate(habitat.empire)) return;
        cutControl(habitat, invader);
        markDefeat(g, habitat);
    },
});

registerScenarioEvent({
    id: 'colonyDefence.facilityDestroyed',
    flag: COLONY_DEFENCE_FLAG,
    event: 'pirateFacilityDestroyed',
    run: (g, { habitat, pirate, byOwner }) => {
        if (!isPirate(pirate) || habitat.empire === null || isPirate(habitat.empire)) return;
        cutControl(habitat, pirate);
        if (byOwner) {
            markDefeat(g, habitat);
            state(g).cooldownUntil[`${habitat.habitatIndex}:${pirate.empireId}`] = galaxyStarDate(g) + COLONY_DEFENCE_RULES.REBUILD_COOLDOWN_YEARS * YEAR_LENGTH;
        }
    },
});

// A pirate ship or base destroyed in a system marks that system's (non-pirate) colonies.
registerScenarioEvent({
    id: 'colonyDefence.pirateKilled',
    flag: COLONY_DEFENCE_FLAG,
    event: 'builtObjectDestroyed',
    run: (g, { builtObject }) => {
        if (!isPirate(builtObject.empire)) return;
        const star = builtObject.nearestSystemStar;
        if (star === null) return;
        const sys = g.systems[star.systemIndex];
        if (sys === undefined || sys.systemStar !== star) return;
        for (let i = 0; i < sys.habitats.length; i++) {
            const h = sys.habitats[i];
            if (h !== null && h.empire !== null && !isPirate(h.empire) && h.empire !== g.independentEmpire && h.population !== null && h.population.totalAmount > 0) markDefeat(g, h);
        }
    },
});

registerScenarioQuery({
    id: 'colonyDefence.controlGain',
    flag: COLONY_DEFENCE_FLAG,
    query: 'pirateControlGainBlocked',
    run: (g, v, { habitat }) => v || colonyDefended(g, habitat),
});

registerScenarioQuery({
    id: 'colonyDefence.facility',
    flag: COLONY_DEFENCE_FLAG,
    query: 'pirateFacilityBlocked',
    run: (g, v, { habitat, pirate }) => {
        if (v) return true;
        if (colonyDefended(g, habitat)) return true;
        if (pirate === null) return false;
        const until = state(g).cooldownUntil[`${habitat.habitatIndex}:${pirate.empireId}`];
        return until !== undefined && galaxyStarDate(g) < until;
    },
});
