// What the Empires / Diplomacy screen shows about another empire: the "known strengths" block of the original
// EmpireDetailView. Pure (no DOM) so the known / unknown split is testable.
// Port of DistantWorlds.Controls/Controls/EmpireDetailView.cs:DrawEmpireDetail, non-pirate branch (lines 395-500):
// Capital (only when the player has explored that system, else "(Unknown)"), Government (red / gold for the special
// availabilities), Reputation (CivilityDescription), Colonies, Population (millions), Tax Revenue, Annual GDP,
// Strategic Value (thousands), Military Strength (MilitaryPotency) and the dominant race block (name, family, portrait).
// The original applies no other intelligence gate: every met empire's figures are shown as is.
// Military Ships / firepower come from the pirate block (line 313) applied to non-pirates: the mobile military firepower.

import type { Empire } from '../../sim/empire';
import { getGovernmentsStatic } from '../../sim/empire';
import { BuiltObjectRole } from '../../sim/data/designSpecifications';
import { annualTaxRevenue, privateAnnualRevenue, totalColonyStrategicValue, totalMobileMilitaryFirepower } from '../../sim/forceStructure';
import { militaryPotency } from '../../sim/treasury';
import { civilityDescription } from '../../sim/empireRelationshipFactors';
import { DiplomaticRelationType } from '../../sim/diplomacy';

export interface EmpireIntel {
    /** Capital name and its system, or null when the player has not explored that system (original: "(Unknown)"). */
    capital: string | null;
    government: string;
    /** GovernmentAttributes.Availability: 3 = red, 2 = gold in the original. */
    governmentAvailability: number;
    reputation: string;
    colonies: number;
    /** Millions, as the original prints it ("###,###,##0M"). */
    populationMillions: number;
    taxRevenueK: number;
    gdpK: number;
    strategicValueK: number;
    militaryStrength: number;
    militaryShips: number;
    /** TotalMobileMilitaryFirepower. */
    firepower: number;
    raceName: string;
    raceFamily: string;
    /** races images/units/races/race_<PictureIndex>.png. */
    racePictureIndex: number | null;
}

/** Galaxy.2.cs:2074 ResolveRaceFamilyDescription. */
export function raceFamilyName(empire: Empire): string {
    const family = empire.galaxy?.raceFamilies?.[empire.dominantRace?.raceFamily ?? -1];
    return family?.name ?? '';
}

export function empireIntel(player: Empire, other: Empire): EmpireIntel {
    const galaxy = other.galaxy;
    const cap = other.capital;
    let capital: string | null = null;
    if (cap != null && player.visibility?.checkSystemExplored(cap.systemIndex)) {
        const star = galaxy?.systems?.[cap.systemIndex]?.systemStar ?? null;
        capital = star !== null && star !== undefined ? `${cap.name} (${star.name} system)` : cap.name;
    }
    const gov = getGovernmentsStatic()[other.governmentId] ?? null;
    const ships = other.builtObjects ?? [];
    return {
        capital,
        government: gov?.name ?? '',
        governmentAvailability: gov?.availability ?? 0,
        reputation: civilityDescription(other.civilityRating),
        colonies: other.colonies.length,
        populationMillions: other.totalPopulation / 1000000,
        taxRevenueK: Math.trunc(annualTaxRevenue(galaxy, other) / 1000),
        gdpK: Math.trunc(privateAnnualRevenue(galaxy, other) / 1000),
        strategicValueK: Math.trunc(totalColonyStrategicValue(other) / 1000),
        militaryStrength: militaryPotency(galaxy, other),
        militaryShips: ships.filter((b) => b != null && b.role === BuiltObjectRole.Military).length,
        firepower: totalMobileMilitaryFirepower(ships),
        raceName: other.dominantRace?.name ?? '',
        raceFamily: raceFamilyName(other),
        racePictureIndex: other.dominantRace?.pictureIndex ?? null,
    };
}

/** Empires the player has not met are never listed; this is the same test the screen's rows use. */
export function isMet(player: Empire, other: Empire): boolean {
    const rel = player.diplomaticRelations.byEmpire(other);
    return rel !== null && rel.type !== DiplomaticRelationType.NotMet;
}

/** C# "###,###,##0" + "M". */
export function formatMillions(m: number): string {
    return `${Math.round(m).toLocaleString('en-US')}M`;
}
