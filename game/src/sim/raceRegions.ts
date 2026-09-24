// Port of Galaxy.SetupAlienRacePopulations (Galaxy.6.cs 1055-1199) plus its
// helpers DetermineAggressiveRaces (Galaxy.6.cs 1021), DetermineRaceRegion
// (Galaxy.6.cs 1200), CheckDistanceFromLocation (Galaxy.6.cs 1050),
// CheckLocationOverlap (Galaxy.6.cs 977), and EmpireStartList.TotalColoniesForRace
// / TotalColonyAmount (EmpireStartList.cs 47). Creates race-region
// GalaxyLocations for each empire start's resolved race, then populates the
// habitat-race lists (_ContinentalRaces etc.).

import { GalaxyLocation, GalaxyLocationType } from './galaxyLocation';
import type { Race } from './data/races';
import type { Galaxy } from './galaxy';

// Port of EmpireStartList.EmpireStart (the fields SetupAlienRacePopulations
// reads: ResolvedRace, ProjectedColonyAmount). The full EmpireStart model
// (race resolution, expansion, government picks — EmpireStartList.cs
// ResolveRace/SelectRandomUnusedRace/DetermineEmpireExpansion) is out of
// scope; callers supply already-resolved starts.
export interface EmpireStart {
    resolvedRace: Race;
    projectedColonyAmount: number;
}

// Port of EmpireStartList.cs TotalColoniesForRace + TotalColonyAmount.
export function totalColoniesForRace(empireStarts: EmpireStart[], race: Race): number {
    let num = 0;
    for (const empireStart of empireStarts) {
        if (empireStart.resolvedRace === race) {
            num += empireStart.projectedColonyAmount;
        }
    }
    return num;
}

export function totalColonyAmount(empireStarts: EmpireStart[]): number {
    let totalColonyAmount = 0;
    for (const empireStart of empireStarts) {
        totalColonyAmount += empireStart.projectedColonyAmount;
    }
    return totalColonyAmount;
}

// Port of Galaxy.6.cs DetermineAggressiveRaces(races, aggressionLevel,
// intelligenceLevel). C# Array.Sort(keys, array) sorts `array` by the keys
// ascending, then Array.Reverse(array) yields descending order; ties keep
// their original relative order (stable sort, matching Array.Sort's
// stable behavior on equal keys).
export function determineAggressiveRaces(races: Race[], aggressionLevel: number, intelligenceLevel: number): Race[] {
    const playable = races.filter((r) => r.playable);
    const sorted = [...playable].sort((a, b) => a.aggression - b.aggression);
    sorted.reverse();
    const result: Race[] = [];
    for (const race of sorted) {
        if (race.aggression >= aggressionLevel && race.intelligence >= intelligenceLevel) {
            result.push(race);
        }
    }
    return result;
}

// Port of Galaxy.6.cs CheckDistanceFromLocation(location, x, y)
function checkDistanceFromLocation(galaxy: Galaxy, location: GalaxyLocation | null, x: number, y: number): number {
    // location is non-null at every call site (guarded by i > 0).
    const loc = location!;
    return galaxy.calculateDistance(x, y, loc.xpos + loc.width / 2.0, loc.ypos + loc.height / 2.0);
}

// Port of Galaxy.6.cs CheckLocationOverlap(location, type). C# Rectangle
// coordinates are int (truncation toward zero via the (int) casts);
// IntersectsWith compares against the *other* rectangle, so the test is
// inclusive on both sides.
function checkLocationOverlap(galaxy: Galaxy, location: GalaxyLocation, type: GalaxyLocationType): boolean {
    const num = 10000.0;
    const rectX = Math.trunc(location.xpos / num);
    const rectY = Math.trunc(location.ypos / num);
    const rectW = Math.trunc(location.width / num);
    const rectH = Math.trunc(location.height / num);
    for (const other of galaxy.galaxyLocations) {
        if (other.type !== type) {
            continue;
        }
        const ox = Math.trunc(other.xpos / num);
        const oy = Math.trunc(other.ypos / num);
        const ow = Math.trunc(other.width / num);
        const oh = Math.trunc(other.height / num);
        // C#: this.IntersectsWith(rect) — true when the two rectangles
        // overlap or touch (>= / <= comparisons).
        if (rectX < ox + ow && rectX + rectW > ox && rectY < oy + oh && rectY + rectH > oy) {
            return true;
        }
    }
    return false;
}

// Port of Galaxy.6.cs DetermineRaceRegion(race)
export function determineRaceRegion(galaxy: Galaxy, race: Race): GalaxyLocation | null {
    for (const location of galaxy.galaxyLocations) {
        if (location.type === GalaxyLocationType.RaceRegion && location.relatedRace === race) {
            return location;
        }
    }
    return null;
}

// Port of Galaxy.6.cs SetupAlienRacePopulations(empireStarts,
// aggressiveRacesRequired). Every Rnd call goes through galaxy.rnd in the
// same order as the source (ObtainRandomGalaxyCoordinates consumes
// NextDouble x2 per call).
export function setupAlienRacePopulations(galaxy: Galaxy, empireStarts: EmpireStart[], aggressiveRacesRequired: number): void {
    const raceList = determineAggressiveRaces(galaxy.races, 115, 85);
    let num = 0;
    const num2 = galaxy.sectorSize * 2.0;
    let flag = false;
    let val = Math.sqrt(1400.0) / Math.sqrt(galaxy.starCount);
    val = Math.max(1.0, Math.min(val, 3.0));
    const num3 = 0.85 * (galaxy.sizeX / Math.sqrt(empireStarts.length));
    const radiusFromCenterMaximum = 1.0;
    let location: GalaxyLocation | null = null;
    const totalColonyAmount_ = totalColonyAmount(empireStarts);
    const num4 = totalColonyAmount_ / empireStarts.length;
    let val2 = galaxy.sectorSize * (20.0 / empireStarts.length) * val;
    const num5 = galaxy.sectorSize * 1.0;
    val2 = Math.min(val2, galaxy.sectorSize * 4.5);
    for (let i = 0; i < empireStarts.length; i++) {
        const resolvedRace = empireStarts[i].resolvedRace;
        const existing = determineRaceRegion(galaxy, resolvedRace);
        if (existing !== null) {
            continue;
        }
        const d = totalColoniesForRace(empireStarts, resolvedRace) / num4;
        const num6 = empireStarts[i].projectedColonyAmount / num4;
        let val3 = num5 + val2 * num6;
        val3 = Math.min(val3, galaxy.sectorSize * 6.5);
        let num7 = num3 * Math.sqrt(Math.sqrt(d));
        let { x, y } = galaxy.obtainRandomGalaxyCoordinatesInRadius(0.0, radiusFromCenterMaximum);
        x -= num7 / 2.0;
        y -= num7 / 2.0;
        if (i > 0 && raceList.length > 1 && empireStarts.length > 4 && aggressiveRacesRequired > 0 && num < aggressiveRacesRequired && raceList.includes(resolvedRace)) {
            let num8 = checkDistanceFromLocation(galaxy, location, x, y);
            let num9 = 0;
            flag = true;
            while (num8 > num2 && num9 < 50) {
                ({ x, y } = galaxy.obtainRandomGalaxyCoordinatesInRadius(0.0, radiusFromCenterMaximum));
                x -= num7 / 2.0;
                y -= num7 / 2.0;
                num8 = checkDistanceFromLocation(galaxy, location, x, y);
                num9++;
            }
            if (num9 >= 50) {
                flag = false;
            }
        }
        let galaxyLocation2 = new GalaxyLocation(resolvedRace.name + ' Region', GalaxyLocationType.RaceRegion, x, y, num7, num7, -1);
        let num10 = 0;
        let num11 = 0;
        while (checkLocationOverlap(galaxy, galaxyLocation2, GalaxyLocationType.RaceRegion) && num11 < 20) {
            ({ x, y } = galaxy.obtainRandomGalaxyCoordinatesInRadius(0.0, radiusFromCenterMaximum));
            x -= num7 / 2.0;
            y -= num7 / 2.0;
            if (i > 0 && raceList.length > 1 && empireStarts.length > 4 && aggressiveRacesRequired > 0 && num < aggressiveRacesRequired && raceList.includes(resolvedRace)) {
                let num12 = checkDistanceFromLocation(galaxy, location, x, y);
                let num13 = 0;
                flag = true;
                while (num12 > num2 && num13 < 50) {
                    ({ x, y } = galaxy.obtainRandomGalaxyCoordinatesInRadius(0.0, radiusFromCenterMaximum));
                    x -= num7 / 2.0;
                    y -= num7 / 2.0;
                    num12 = checkDistanceFromLocation(galaxy, location, x, y);
                    num13++;
                }
                if (num13 >= 50) {
                    flag = false;
                }
            }
            galaxyLocation2 = new GalaxyLocation(resolvedRace.name + ' Region', GalaxyLocationType.RaceRegion, x, y, num7, num7, -1);
            num10++;
            if (num10 > 50) {
                num11++;
                num7 *= 0.9;
                num7 = Math.max(num7, 300000.0);
                num10 = 0;
            }
        }
        galaxyLocation2.showName = false;
        galaxyLocation2.relatedRace = resolvedRace;
        galaxy.galaxyLocations.push(galaxyLocation2);
        galaxy.addGalaxyLocationIndex(galaxyLocation2);
        if (flag) {
            num++;
            flag = false;
        }
        if (i === 0) {
            location = galaxyLocation2;
        }
    }
    // Habitat-race lists (Galaxy.6.cs 1125-1167). Races are indexed by
    // position in GameData.races (the default load order matches the
    // original races.txt ordering); missing indices are skipped.
    const add = (list: Race[], index: number) => {
        const race = galaxy.races[index];
        if (race !== undefined) {
            list.push(race);
        }
    };
    const continentalRaces: Race[] = [];
    for (const index of [0, 1, 3, 4, 6, 8, 9, 19, 10, 16, 17]) {
        add(continentalRaces, index);
    }
    galaxy.continentalRaces = continentalRaces;
    const marshySwampRaces: Race[] = [];
    for (const index of [0, 1, 3, 4, 6, 8, 10, 16, 17]) {
        add(marshySwampRaces, index);
    }
    galaxy.marshySwampRaces = marshySwampRaces;
    const desertRaces: Race[] = [];
    for (const index of [2, 3, 4, 6, 11, 13, 18]) {
        add(desertRaces, index);
    }
    galaxy.desertRaces = desertRaces;
    const oceanRaces: Race[] = [];
    for (const index of [5, 7, 12]) {
        add(oceanRaces, index);
    }
    galaxy.oceanRaces = oceanRaces;
    const iceRaces: Race[] = [];
    for (const index of [15, 9]) {
        add(iceRaces, index);
    }
    galaxy.iceRaces = iceRaces;
    const volcanicRaces: Race[] = [];
    for (const index of [2, 13, 14]) {
        add(volcanicRaces, index);
    }
    galaxy.volcanicRaces = volcanicRaces;
    galaxy.barrenRockRaces = [];
}