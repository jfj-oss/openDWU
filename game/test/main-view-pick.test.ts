import { describe, expect, it } from 'vitest';
import { hitTestHabitats, moonDotPx, planetSpritePx, starSpritePx } from '../src/render/mainView';
import { Habitat, HabitatCategoryType, HabitatType } from '../src/sim/types';

// Task 08g: pure hit-test helper. Each object's drawn rect is the square
// centred on its (xpos, ypos) with side sizeFn(habitat, zoom) px; among
// several matches the smaller object wins; empty space returns null.

const Z = 0.05; // system-zoom-ish level for these cases

/** A top-level habitat at a fixed world position (stars use the x/y ctor). */
function makeStar(x: number, y: number, diameter: number): Habitat {
    const h = new Habitat(HabitatCategoryType.Star, HabitatType.MainSequence, 'star', x, y);
    h.diameter = diameter;
    return h;
}

/** A planet orbiting a star (parent given so the orbit ctor applies). */
function makePlanet(parent: Habitat, angle: number, distance: number, diameter: number): Habitat {
    const h = new Habitat(HabitatCategoryType.Planet, HabitatType.Continental, 'planet', parent, angle, true, distance, 10);
    h.diameter = diameter;
    return h;
}

describe('hitTestHabitats (task 08g)', () => {
    it('returns the object whose drawn rect contains the point', () => {
        const star = makeStar(0, 0, 1000);
        const planet = makePlanet(star, 0, 20_000, 100);
        // At z = 0.05: planet sprite = max(100*0.05*0.38, 14) = 14 px -> half 7.
        const p = planet;
        const list = [star, p];
        const hit = hitTestHabitats(list, p.xpos + 3, p.ypos - 3, (h, z) =>
            h.category === HabitatCategoryType.Planet ? planetSpritePx(h.diameter, z) : starSpritePx(h.diameter, z),
            Z,
        );
        expect(hit).toBe(p);
    });

    it('prefers the smaller object when both rects contain the point', () => {
        const star = makeStar(0, 0, 1000);
        const planet = makePlanet(star, 0, 20_000, 100);
        // Point exactly on the planet centre: both the planet (14 px) and the
        // star (40 px min) could claim it if they overlapped; here they are
        // far apart, so verify the tie-break rule directly with overlapping
        // positions instead.
        const big = makeStar(planet.xpos, planet.ypos, 1000); // same spot as planet
        const hit = hitTestHabitats([big, planet], planet.xpos, planet.ypos, (h, z) =>
            h.category === HabitatCategoryType.Planet ? planetSpritePx(h.diameter, z) : starSpritePx(h.diameter, z),
            Z,
        );
        // Planet (14 px) is smaller than the star (40 px) -> the planet wins.
        expect(hit).toBe(planet);
    });

    it('moon beats planet, planet beats star, in order of drawn size', () => {
        const star = makeStar(0, 0, 1000);
        const planet = makePlanet(star, 0, 20_000, 100);
        const moon = new Habitat(HabitatCategoryType.Moon, HabitatType.Ice, 'moon', planet, 0, true, 1000, 20);
        moon.diameter = 100;
        // Stack all three at the same world point.
        star.xpos = planet.xpos;
        star.ypos = planet.ypos;
        moon.xpos = planet.xpos;
        moon.ypos = planet.ypos;
        const sizeFn = (h: Habitat, z: number): number => {
            if (h.category === HabitatCategoryType.Moon) return moonDotPx(h.diameter, z);
            if (h.category === HabitatCategoryType.Planet) return planetSpritePx(h.diameter, z);
            return starSpritePx(h.diameter, z);
        };
        const hit = hitTestHabitats([star, planet, moon], planet.xpos, planet.ypos, sizeFn, Z);
        // Sizes at z=0.05: moon 7 px < planet 14 px < star 40 px -> moon wins.
        expect(hit).toBe(moon);
    });

    it('returns null for empty space', () => {
        const star = makeStar(0, 0, 1000);
        const planet = makePlanet(star, 0, 20_000, 100);
        const hit = hitTestHabitats([star, planet], 1e9, 1e9, (h, z) =>
            h.category === HabitatCategoryType.Planet ? planetSpritePx(h.diameter, z) : starSpritePx(h.diameter, z),
            Z,
        );
        expect(hit).toBeNull();
    });

    it('ignores objects with a non-positive drawn size', () => {
        const star = makeStar(0, 0, 1000);
        const hit = hitTestHabitats([star], 0, 0, () => 0, Z);
        expect(hit).toBeNull();
    });
});