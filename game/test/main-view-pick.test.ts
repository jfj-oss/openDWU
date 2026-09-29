import { describe, expect, it } from 'vitest';
import { hitTestHabitats, moonDotPx, planetSpritePx, starDrawnPx, starSpritePx } from '../src/render/mainView';
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
describe('hitTestHabitats on drawn positions (render interpolation)', () => {
    it('hits a planet where its interpolated orbit draws it, not at its committed xpos', () => {
        const star = makeStar(0, 0, 1000);
        const planet = makePlanet(star, 0, 20_000, 100);
        const drawn = { x: planet.xpos, y: planet.ypos + 400 }; // orbit advanced since the last touch
        const posOf = (h: Habitat): { x: number; y: number } => (h === planet ? drawn : { x: h.xpos, y: h.ypos });
        const size = (): number => 14; // half 7 px = 140 world units at Z
        expect(hitTestHabitats([planet], drawn.x, drawn.y, size, Z, posOf)).toBe(planet);
        expect(hitTestHabitats([planet], planet.xpos, planet.ypos, size, Z, posOf)).toBeNull();
        // Without a position function: the committed position (old behaviour).
        expect(hitTestHabitats([planet], planet.xpos, planet.ypos, size, Z)).toBe(planet);
    });
});

describe('hitTestHabitats hit area equals drawn art (click anywhere on it)', () => {
    const sizeFn = (h: Habitat, z: number): number => {
        if (h.category === HabitatCategoryType.Moon) return moonDotPx(h.diameter, z);
        if (h.category === HabitatCategoryType.Planet) return planetSpritePx(h.diameter, z);
        return starDrawnPx(h, z);
    };
    const z = 1; // f = 1: a planet of diameter 200 is drawn ~ 200 px wide

    it('selects a large planet near its edge, not just outside it', () => {
        const star = makeStar(0, 0, 1000);
        const planet = makePlanet(star, 0, 20_000, 400);
        const px = planetSpritePx(planet.diameter, z);
        expect(px).toBeGreaterThan(50);
        const r = px / 2 / z;
        expect(hitTestHabitats([star, planet], planet.xpos + r - 2, planet.ypos, sizeFn, z)).toBe(planet);
        expect(hitTestHabitats([star, planet], planet.xpos, planet.ypos - (r - 2), sizeFn, z)).toBe(planet);
        expect(hitTestHabitats([star, planet], planet.xpos + r + 3, planet.ypos, sizeFn, z)).toBeNull();
    });

    it('selects a large star near its edge, not just outside it', () => {
        const star = makeStar(0, 0, 4000);
        const px = starDrawnPx(star, z);
        expect(px).toBeGreaterThan(50);
        const r = px / 2 / z;
        expect(hitTestHabitats([star], r - 2, 0, sizeFn, z)).toBe(star);
        expect(hitTestHabitats([star], r + 3, 0, sizeFn, z)).toBeNull();
    });

    it('the moon in front of a planet wins over the planet', () => {
        const star = makeStar(0, 0, 1000);
        const planet = makePlanet(star, 0, 20_000, 400);
        const moon = new Habitat(HabitatCategoryType.Moon, HabitatType.Ice, 'moon', planet, 0, true, 1000, 20);
        moon.diameter = 60;
        moon.xpos = planet.xpos + 20;
        moon.ypos = planet.ypos;
        expect(hitTestHabitats([planet, moon], moon.xpos, moon.ypos, sizeFn, z)).toBe(moon);
        expect(hitTestHabitats([planet, moon], planet.xpos - 60, planet.ypos, sizeFn, z)).toBe(planet);
    });

    it('tiny objects stay clickable through the minimum radius', () => {
        const star = makeStar(0, 0, 1000);
        const planet = makePlanet(star, 0, 20_000, 1);
        const zz = 0.001; // drawn at the 4 px floor
        expect(hitTestHabitats([planet], planet.xpos + 5 / zz, planet.ypos, sizeFn, zz)).toBe(planet);
        expect(hitTestHabitats([planet], planet.xpos + 8 / zz, planet.ypos, sizeFn, zz)).toBeNull();
    });
});
