// Smarter AI add-on: smarter research stations (scenarios/smarter-ai, flag smarterAIResearchStations). Not a port.
//
// The original counts only one station per field: the station with the best location bonus plus its scientists
// (researchTick.ts reviewResearchStationBonuses, Empire.3.cs 2732). Stock AI builds a station at every research-bonus
// location it knows (stationPlacement.ts determineResearchStationLocation, Empire.5.cs 3580) and, without them, plain
// stations at its colonies up to 125% of its research potential. For AI empires this package:
//   - keeps only the bonus locations that beat the field's best station (built or being built), best first, so each
//     field gets one station at the best location known (query researchStationLocations);
//   - picks the field with the largest bonus gain for the next station, and builds no plain (no-bonus) stations once
//     the stations' research potential reaches the empire's research cap (AnnualResearchPotential vs the summed
//     Research*Potential the cap scales down in CalculateResearchTotal) (query researchStationDesign);
//   - moves its best scientists to each field's best station: a greedy assignment by skill / rank, the rank weight of
//     TotalDiminishingResearchBonuses (query scientistStation).
// No Rnd.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { BuiltObject } from '../../builtObject';
import type { Design } from '../../design';
import type { Character } from '../../characters';
import { CharacterRole, CharacterTraitType, checkLocationSafeForDemoralizingCharacter, getEmpireCharacters } from '../../characters';
import { HabitatCategoryType, IndustryType, type Habitat } from '../../types';
import { BuiltObjectRole } from '../../data/designSpecifications';
import { BuiltObjectSubRole } from '../../builtObjectTypes';
import { BuiltObjectMissionType, builtObjectMission } from '../../missions/mission';
import { annualResearchPotential, researchPotential } from '../../researchTick';
import { registerScenarioQuery } from '../hooks';
import { SMARTER_AI_FLAG, isSmarterAIEmpire, smarterAIOn } from './common';
import { SMARTER_AI_RESEARCH_STATIONS_FLAG } from './statecraft';

export const RESEARCH_FIELDS: readonly IndustryType[] = [IndustryType.Weapon, IndustryType.Energy, IndustryType.HighTech];

function on(galaxy: Galaxy, empire: Empire | null): empire is Empire {
    return smarterAIOn(galaxy, SMARTER_AI_RESEARCH_STATIONS_FLAG) && isSmarterAIEmpire(galaxy, empire);
}

/** A location's research bonus fraction for `industry` (0 when it has none for that field). */
export function locationBonus(h: Habitat | null, industry: IndustryType): number {
    if (h === null || h.researchBonusIndustry !== industry || !(h.researchBonus > 0)) return 0;
    return Math.trunc(h.researchBonus) / 100;
}

/** A station's location bonus (its parent habitat, else its system star), as stationLocationResearchBonus. */
export function stationBonus(b: BuiltObject, industry: IndustryType): number {
    const a = locationBonus(b.parentHabitat, industry);
    return a > 0 ? a : locationBonus(b.nearestSystemStar, industry);
}

function stationResearch(b: { researchWeapons: number; researchEnergy: number; researchHighTech: number }, industry: IndustryType): number {
    switch (industry) {
        case IndustryType.Weapon: return b.researchWeapons;
        case IndustryType.Energy: return b.researchEnergy;
        default: return b.researchHighTech;
    }
}

function isResearchStationDesign(d: Design | null | undefined): d is Design {
    return d != null && (d.subRole === BuiltObjectSubRole.EnergyResearchStation || d.subRole === BuiltObjectSubRole.WeaponsResearchStation || d.subRole === BuiltObjectSubRole.HighTechResearchStation);
}

/** The empire's research stations (built bases with research). */
export function researchStations(empire: Empire): BuiltObject[] {
    const out: BuiltObject[] = [];
    for (const b of empire.builtObjects) {
        if (b === null || b.hasBeenDestroyed || b.role !== BuiltObjectRole.Base) continue;
        if (b.researchWeapons > 0 || b.researchEnergy > 0 || b.researchHighTech > 0) out.push(b);
    }
    return out;
}

/** Per field: the best location bonus among the empire's stations and the stations its construction ships are building. */
export function bestKnownBonus(galaxy: Galaxy, empire: Empire): Map<IndustryType, number> {
    const best = new Map<IndustryType, number>(RESEARCH_FIELDS.map((f) => [f, 0]));
    for (const b of researchStations(empire)) {
        for (const f of RESEARCH_FIELDS) if (stationResearch(b, f) > 0) best.set(f, Math.max(best.get(f)!, stationBonus(b, f)));
    }
    for (const ship of empire.constructionShips as BuiltObject[]) {
        const m = builtObjectMission(ship.mission);
        if (m === null || m.type !== BuiltObjectMissionType.Build || !isResearchStationDesign(m.design)) continue;
        const h = m.targetHabitat;
        if (h === null) continue;
        const star = h.category === HabitatCategoryType.Star ? h : (galaxy.systems[h.systemIndex]?.systemStar ?? null);
        for (const f of RESEARCH_FIELDS) {
            if (stationResearch(m.design, f) <= 0) continue;
            const v = Math.max(locationBonus(h, f), locationBonus(star, f));
            best.set(f, Math.max(best.get(f)!, v));
        }
    }
    return best;
}

/** The bonus locations that beat their field's best station, best bonus first (ties keep the stock order). */
export function improvingLocations(locations: readonly Habitat[], best: ReadonlyMap<IndustryType, number>): Habitat[] {
    const keep = locations
        .map((h, i) => ({ h, i, v: locationBonus(h, h.researchBonusIndustry) }))
        .filter((x) => x.v > 0 && x.v > (best.get(x.h.researchBonusIndustry) ?? Infinity));
    keep.sort((a, b) => b.v - a.v || a.i - b.i);
    return keep.map((x) => x.h);
}

/** The stations' summed research potential has reached the empire's research cap (more plain stations add nothing). */
export function atResearchCap(empire: Empire): boolean {
    const total = researchPotential(empire, IndustryType.Weapon) + researchPotential(empire, IndustryType.Energy) + researchPotential(empire, IndustryType.HighTech);
    return total >= annualResearchPotential(empire);
}

/** The field whose best improving location gains the most over its best station (null when none improves). */
export function bestGainField(locations: readonly Habitat[], best: ReadonlyMap<IndustryType, number>): IndustryType | null {
    let field: IndustryType | null = null;
    let gain = 0;
    for (const h of improvingLocations(locations, best)) {
        const g = locationBonus(h, h.researchBonusIndustry) - (best.get(h.researchBonusIndustry) ?? 0);
        if (g > gain) {
            gain = g;
            field = h.researchBonusIndustry;
        }
    }
    return field;
}

/** Per field: the station scientists gather at (best location bonus, then most research, then the list order). */
export function fieldStations(empire: Empire): Map<IndustryType, BuiltObject> {
    const out = new Map<IndustryType, BuiltObject>();
    const stations = researchStations(empire);
    for (const f of RESEARCH_FIELDS) {
        let pick: BuiltObject | null = null;
        for (const b of stations) {
            if (stationResearch(b, f) <= 0) continue;
            if (pick === null || stationBonus(b, f) > stationBonus(pick, f) || (stationBonus(b, f) === stationBonus(pick, f) && stationResearch(b, f) > stationResearch(pick, f))) pick = b;
        }
        if (pick !== null) out.set(f, pick);
    }
    return out;
}

function skillIn(c: Character, f: IndustryType): number {
    switch (f) {
        case IndustryType.Weapon: return c.researchWeapons;
        case IndustryType.Energy: return c.researchEnergy;
        default: return c.researchHighTech;
    }
}

/**
 * Greedy scientist assignment: repeatedly the (scientist, field) pair with the largest skill / (scientists already in
 * the field + 1) — the weight TotalDiminishingResearchBonuses gives the next-best scientist — among the fields with a
 * station. Ties keep the scientist order and the field order. Returns the field per scientist index (absent = none).
 */
export function assignScientists(skills: readonly (readonly number[])[], fieldsOpen: readonly boolean[]): Map<number, number> {
    const out = new Map<number, number>();
    const count = fieldsOpen.map(() => 0);
    for (;;) {
        let bi = -1;
        let bf = -1;
        let bv = 0;
        for (let i = 0; i < skills.length; i++) {
            if (out.has(i)) continue;
            for (let f = 0; f < fieldsOpen.length; f++) {
                if (!fieldsOpen[f]) continue;
                const v = skills[i][f] / (count[f] + 1);
                if (v > bv) {
                    bv = v;
                    bi = i;
                    bf = f;
                }
            }
        }
        if (bi < 0) return out;
        out.set(bi, bf);
        count[bf]++;
    }
}

/** The station `character` should work at under the greedy assignment (null: no station / no research skill). */
export function scientistTarget(empire: Empire, character: Character): BuiltObject | null {
    const stations = fieldStations(empire);
    if (stations.size === 0) return null;
    const scientists = getEmpireCharacters(empire).filter((c) => c !== null && c.active && c.role === CharacterRole.Scientist);
    const idx = scientists.indexOf(character);
    if (idx < 0) return null;
    const plan = assignScientists(
        scientists.map((c) => RESEARCH_FIELDS.map((f) => skillIn(c, f))),
        RESEARCH_FIELDS.map((f) => stations.has(f)),
    );
    const f = plan.get(idx);
    return f === undefined ? null : stations.get(RESEARCH_FIELDS[f])!;
}

registerScenarioQuery({
    id: 'smarterAI.researchStationLocations',
    query: 'researchStationLocations',
    flag: SMARTER_AI_FLAG,
    run: (galaxy, value, { empire }) => (on(galaxy, empire) ? improvingLocations(value, bestKnownBonus(galaxy, empire)) : value),
});

registerScenarioQuery({
    id: 'smarterAI.researchStationDesign',
    query: 'researchStationDesign',
    flag: SMARTER_AI_FLAG,
    run: (galaxy, value, { empire, weapons, energy, highTech }) => {
        if (value === null || !on(galaxy, empire)) return value;
        const field = bestGainField(empire.researchHabitats, bestKnownBonus(galaxy, empire));
        const design = field === IndustryType.Weapon ? weapons : field === IndustryType.Energy ? energy : field === IndustryType.HighTech ? highTech : null;
        if (design !== null) return design;
        return atResearchCap(empire) ? null : value;
    },
});

registerScenarioQuery({
    id: 'smarterAI.scientistStation',
    query: 'scientistStation',
    flag: SMARTER_AI_FLAG,
    run: (galaxy, value, { empire, character }) => {
        if (!on(galaxy, empire)) return value;
        const target = scientistTarget(empire, character);
        if (target === null) return value;
        const demoralizing = character.traits.includes(CharacterTraitType.Demoralizing);
        return checkLocationSafeForDemoralizingCharacter(empire, demoralizing, target, character) ? target : value;
    },
});
