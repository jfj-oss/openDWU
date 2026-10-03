// DEVIATION from the original (user request: "orbits for planets that are big enough that they overlap each other").
//
// Galaxy.5.cs SetupSolarSystem picks each planet's / moon's orbit with up to 50 re-draws against the orbits already
// placed (CheckOrbitOverlap) and keeps the last draw when all 50 collide, so in the original two planets — or two moons
// of one planet — can share an orbit band and their bodies overlap. Moon systems are also never checked against the
// planet's neighbours. Galaxy.8.cs GeneratePlanetaryOrbitDistance (planets added to a system later) only keeps 150
// units between orbit radii, whatever the bodies' sizes.
//
// These helpers run AFTER the original's random draws and adjust the chosen distances deterministically (no Rnd calls),
// so the random-number sequence of generation is unchanged; only the resulting orbit radii (and the positions derived
// from them) move outward where they would overlap.
//
// Clearance: a body's clearance radius is its true radius (Diameter / 2) times ORBIT_DRAW_SCALE, because the main
// view draws planets up to 1.25x true size when zoomed out (Main.Part11.cs CalculatePlanetZoomFactor: f / 1.25;
// moons f / 1.1, render/mainView.ts planetSpritePx / moonDotPx). Spacing for the drawn size keeps the bodies apart in
// the sim AND on screen at every zoom where they are drawn at scale.

import type { Habitat } from './types';

/** Largest drawn/true size ratio in the system view (planets: CalculatePlanetZoomFactor divides f by 1.25). */
export const ORBIT_DRAW_SCALE = 1.25;
/** Free space kept between neighbouring planets' outermost extents (world units). */
export const PLANET_ORBIT_GAP = 100;
/** Free space kept between neighbouring moons, and between the innermost moon and its planet (world units). */
export const MOON_ORBIT_GAP = 10;

/** Clearance radius of a body: half its diameter, scaled to its largest drawn size. */
export function orbitClearance(diameter: number): number {
    return Math.ceil((diameter / 2) * ORBIT_DRAW_SCALE);
}

/** How far a planet and its moons reach from the planet's centre (clearance radius of the planet or its outermost moon). */
export function planetSystemExtent(planet: Habitat, moons: readonly Habitat[]): number {
    let extent = orbitClearance(planet.diameter);
    for (const m of moons) extent = Math.max(extent, m.orbitDistance + orbitClearance(m.diameter));
    return extent;
}

/**
 * Pushes moon orbits outward (innermost first) so that every moon clears its planet and the moon inside it.
 * Mutates orbitDistance through the setter (which also refreshes the angular speed, as the C# property does).
 * Returns true when any orbit changed.
 */
export function spaceMoonOrbits(planet: Habitat, moons: readonly Habitat[]): boolean {
    let changed = false;
    // Stable sort: equal draws keep their generation order.
    const sorted = moons.map((m, i) => ({ m, i })).sort((a, b) => a.m.orbitDistance - b.m.orbitDistance || a.i - b.i);
    let innerReach = orbitClearance(planet.diameter);
    for (const { m } of sorted) {
        const need = innerReach + orbitClearance(m.diameter) + MOON_ORBIT_GAP;
        if (m.orbitDistance < need) {
            m.orbitDistance = need;
            changed = true;
        }
        innerReach = m.orbitDistance + orbitClearance(m.diameter);
    }
    return changed;
}

/**
 * Spaces a whole system: first each planet's moons, then the planets (innermost first) so each planet's extent
 * (its moons included) clears the star and the planet system inside it. Distances only ever grow.
 * Returns true when any orbit changed.
 */
export function spaceSystemOrbits(star: Habitat, planets: readonly Habitat[], moonsOf: (planet: Habitat) => readonly Habitat[]): boolean {
    let changed = false;
    for (const p of planets) {
        if (spaceMoonOrbits(p, moonsOf(p))) changed = true;
    }
    const sorted = planets.map((p, i) => ({ p, i })).sort((a, b) => a.p.orbitDistance - b.p.orbitDistance || a.i - b.i);
    let innerReach = Math.ceil(star.diameter / 2);
    for (const { p } of sorted) {
        const extent = planetSystemExtent(p, moonsOf(p));
        const need = innerReach + extent + PLANET_ORBIT_GAP;
        if (p.orbitDistance < need) {
            p.orbitDistance = need;
            changed = true;
        }
        innerReach = p.orbitDistance + extent;
    }
    return changed;
}

/**
 * For a planet added to an existing system later (Galaxy.8.cs Generate*Planet): the smallest orbit radius >= `drawn`
 * at which a body of `diameter` (no moons yet) clears the star and every existing planet system around `star`.
 */
export function fitNewPlanetOrbit(
    star: Habitat,
    drawn: number,
    diameter: number,
    planets: readonly Habitat[],
    moonsOf: (planet: Habitat) => readonly Habitat[],
): number {
    const own = orbitClearance(diameter);
    // Blocked bands of orbit radius for the new planet's centre.
    const bands: [number, number][] = [[-Infinity, Math.ceil(star.diameter / 2) + own + PLANET_ORBIT_GAP]];
    for (const p of planets) {
        const reach = planetSystemExtent(p, moonsOf(p)) + own + PLANET_ORBIT_GAP;
        bands.push([p.orbitDistance - reach, p.orbitDistance + reach]);
    }
    bands.sort((a, b) => a[0] - b[0]);
    let d = drawn;
    for (const [lo, hi] of bands) {
        if (d > lo && d < hi) d = Math.ceil(hi);
    }
    return d;
}
