import { describe, expect, it } from 'vitest';
import { generateGalaxy } from '../src/sim/galaxy';
import { fitNewPlanetOrbit, orbitClearance, spaceMoonOrbits, spaceSystemOrbits } from '../src/sim/orbitSpacing';
import { GalaxyShape, Habitat, HabitatCategoryType, HabitatType } from '../src/sim/types';
import { moonDotPx, planetSpritePx } from '../src/render/mainView';

// Orbit-spacing deviation (src/sim/orbitSpacing.ts): generated planets and moons never overlap — neither in true sim
// size (Diameter / 2) nor at their drawn size in the system view while drawn to scale (the main view draws planets up
// to 1.25x / moons 1.1x true size when zoomed out). Beyond ~f=50 the 4 px minimum sprite floor dominates; not checked.

type Radius = (h: Habitat) => number;

function overlaps(galaxy: ReturnType<typeof generateGalaxy>, rad: Radius): string[] {
    const out: string[] = [];
    for (const sys of galaxy.systems) {
        const star = sys.systemStar;
        const planets = sys.habitats.filter((h) => h.category === HabitatCategoryType.Planet && h.parent === star);
        const moonsOf = (p: Habitat) => sys.habitats.filter((h) => h.category === HabitatCategoryType.Moon && h.parent === p);
        const extent = (p: Habitat) => Math.max(rad(p), ...moonsOf(p).map((m) => m.orbitDistance + rad(m)));
        for (let i = 0; i < planets.length; i++) {
            const p = planets[i];
            if (p.orbitDistance < star.diameter / 2 + extent(p)) out.push(`${p.name} inside star ${star.name}`);
            for (let j = i + 1; j < planets.length; j++) {
                const q = planets[j];
                // Planet systems (planet + moons) must not reach each other's orbit band.
                if (Math.abs(p.orbitDistance - q.orbitDistance) < extent(p) + extent(q)) out.push(`${p.name} / ${q.name}`);
            }
            const ms = moonsOf(p);
            for (let a = 0; a < ms.length; a++) {
                if (ms[a].orbitDistance < rad(p) + rad(ms[a])) out.push(`moon ${ms[a].name} inside ${p.name}`);
                for (let b = a + 1; b < ms.length; b++) {
                    if (Math.abs(ms[a].orbitDistance - ms[b].orbitDistance) < rad(ms[a]) + rad(ms[b])) out.push(`moons ${ms[a].name} / ${ms[b].name}`);
                }
            }
        }
    }
    return out;
}

const CASES = [
    [1, 300],
    [2, 300],
    [7, 700],
    [11, 1400],
] as const;

describe('generated orbits leave room for the bodies (orbit-spacing deviation)', () => {
    for (const [seed, starCount] of CASES) {
        it(`seed ${seed}, ${starCount} stars`, () => {
            const galaxy = generateGalaxy({
                seed,
                shape: GalaxyShape.Spiral,
                starCount,
                sectorWidth: 10,
                sectorHeight: 10,
                systemNames: Array.from({ length: 2000 }, (_, i) => `S${i}`),
            });
            expect(galaxy.systems.some((s) => s.habitats.some((h) => h.category === HabitatCategoryType.Moon))).toBe(true);
            expect(overlaps(galaxy, (h) => h.diameter / 2)).toEqual([]);
            for (const f of [1, 5, 10, 20]) {
                const z = 1 / f;
                const drawn: Radius = (h) =>
                    h.category === HabitatCategoryType.Moon ? moonDotPx(h.diameter, z) / 2 / z : h.category === HabitatCategoryType.Planet ? planetSpritePx(h.diameter, z) / 2 / z : h.diameter / 2;
                expect(overlaps(galaxy, drawn), `drawn at f=${f}`).toEqual([]);
            }
        }, 300000);
    }
});

describe('orbitSpacing helpers', () => {
    const star = new Habitat(HabitatCategoryType.Star, HabitatType.MainSequence, 'Sun', 0, 0);
    star.diameter = 400;
    const body = (cat: HabitatCategoryType, parent: Habitat, d: number, diameter: number): Habitat => {
        const h = new Habitat(cat, HabitatType.BarrenRock, 'b', parent, 0, true, d, 3);
        h.diameter = diameter;
        return h;
    };

    it('pushes overlapping moons outward, innermost first, without reordering', () => {
        const planet = body(HabitatCategoryType.Planet, star, 8000, 400);
        const m1 = body(HabitatCategoryType.Moon, planet, 300, 100);
        const m2 = body(HabitatCategoryType.Moon, planet, 310, 60);
        expect(spaceMoonOrbits(planet, [m2, m1])).toBe(true);
        expect(m1.orbitDistance).toBeGreaterThanOrEqual(orbitClearance(400) + orbitClearance(100));
        expect(m2.orbitDistance - m1.orbitDistance).toBeGreaterThanOrEqual(orbitClearance(100) + orbitClearance(60));
        expect(spaceMoonOrbits(planet, [m1, m2])).toBe(false); // idempotent
    });

    it('spaces planets by their whole moon systems and never moves a clear system', () => {
        const p1 = body(HabitatCategoryType.Planet, star, 5000, 600);
        const moon = body(HabitatCategoryType.Moon, p1, 1500, 100);
        const p2 = body(HabitatCategoryType.Planet, star, 5400, 300);
        const moons = new Map<Habitat, Habitat[]>([[p1, [moon]]]);
        expect(spaceSystemOrbits(star, [p2, p1], (p) => moons.get(p) ?? [])).toBe(true);
        expect(p1.orbitDistance).toBe(5000);
        expect(p2.orbitDistance - p1.orbitDistance).toBeGreaterThanOrEqual(1500 + orbitClearance(100) + orbitClearance(300));
        expect(spaceSystemOrbits(star, [p1, p2], (p) => moons.get(p) ?? [])).toBe(false);
    });

    it('fits a later-added planet into the first free band at or beyond its drawn orbit', () => {
        const p1 = body(HabitatCategoryType.Planet, star, 5000, 600);
        const p2 = body(HabitatCategoryType.Planet, star, 7000, 400);
        const none = () => [];
        expect(fitNewPlanetOrbit(star, 3000, 200, [p1, p2], none)).toBe(3000);
        const d = fitNewPlanetOrbit(star, 5100, 1000, [p1, p2], none);
        expect(d - 7000).toBeGreaterThanOrEqual(orbitClearance(400) + orbitClearance(1000));
    });
});
