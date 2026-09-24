import { describe, expect, it } from 'vitest';

import { GalaxyShape, HabitatCategoryType, Habitat } from '../src/sim/types';
import { generateGalaxy } from '../src/sim/galaxy';
import {
    REAL_SECONDS_IN_GALACTIC_YEAR,
    SPEED_MAX,
    SPEED_MIN,
    START_STAR_DATE,
    YEAR_LENGTH,
    GalaxyTime,
    resolveStarDateDescription,
    startStarDateForAge,
} from '../src/sim/galaxyTime';

describe('constants', () => {
    it('match the C# InitializeStatics values', () => {
        // Port of Galaxy.3.cs InitializeStatics.
        expect(REAL_SECONDS_IN_GALACTIC_YEAR).toBe(600);
        expect(YEAR_LENGTH).toBe(600_000);
        expect(START_STAR_DATE).toBe(1_260_000_000);
        expect(SPEED_MIN).toBe(0.25);
        expect(SPEED_MAX).toBe(4);
    });
});

describe('resolveStarDateDescription', () => {
    it('year 2100 start date is 2100.01.01', () => {
        expect(resolveStarDateDescription(1_260_000_000)).toBe('2100.01.01');
    });

    it('one game year later is 2101.01.01', () => {
        expect(resolveStarDateDescription(1_260_000_000 + 600_000)).toBe('2101.01.01');
    });

    it('one month later is 2100.02.01', () => {
        // One game month = YEAR_LENGTH / 12 = 50_000 ms.
        expect(resolveStarDateDescription(1_260_000_000 + 50_000)).toBe('2100.02.01');
    });

    it('5 days + 1 ms later is 2100.01.06', () => {
        // One game day = YEAR_LENGTH / 360 = 1_666.67 ms; 5 days + 1 ms = 8_334 ms.
        expect(resolveStarDateDescription(1_260_000_000 + 8_334)).toBe('2100.01.06');
    });

    it('supports a custom separator', () => {
        expect(resolveStarDateDescription(1_260_000_000, '-')).toBe('2100-01-01');
    });
});

describe('startStarDateForAge', () => {
    it('adds 50 game years per age step (Start.2.cs)', () => {
        expect(startStarDateForAge(0)).toBe(START_STAR_DATE);
        expect(startStarDateForAge(1)).toBe(START_STAR_DATE + 30_000_000);
        expect(startStarDateForAge(2)).toBe(START_STAR_DATE + 60_000_000);
    });
});

describe('GalaxyTime', () => {
    it('starts paused at the start star date with speed 1', () => {
        const time = new GalaxyTime();
        expect(time.paused).toBe(true);
        expect(time.speed).toBe(1);
        expect(time.currentStarDate).toBe(START_STAR_DATE);
    });

    it('advance returns 0 while paused and does not advance time', () => {
        const time = new GalaxyTime();
        expect(time.advance(10_000)).toBe(0);
        expect(time.elapsedMs).toBe(0);
        expect(time.currentStarDate).toBe(START_STAR_DATE);
    });

    it('advance scales real dt by speed once unpaused', () => {
        const time = new GalaxyTime();
        time.togglePause();
        expect(time.advance(1_000)).toBe(1_000);
        expect(time.currentStarDate).toBe(START_STAR_DATE + 1_000);
        time.faster(); // speed 2
        expect(time.advance(1_000)).toBe(2_000);
        expect(time.currentStarDate).toBe(START_STAR_DATE + 3_000);
    });

    it('faster doubles speed up to the max (stays 4)', () => {
        const time = new GalaxyTime();
        time.faster();
        expect(time.speed).toBe(2);
        time.faster();
        expect(time.speed).toBe(4);
        time.faster();
        expect(time.speed).toBe(SPEED_MAX);
    });

    it('slower halves speed down to the min (stays 0.25)', () => {
        const time = new GalaxyTime();
        time.slower();
        expect(time.speed).toBe(0.5);
        time.slower();
        expect(time.speed).toBe(0.25);
        time.slower();
        expect(time.speed).toBe(SPEED_MIN);
    });

    it('togglePause flips the paused flag', () => {
        const time = new GalaxyTime();
        expect(time.paused).toBe(true);
        time.togglePause();
        expect(time.paused).toBe(false);
        time.togglePause();
        expect(time.paused).toBe(true);
    });
});

describe('Galaxy.step orbital motion', () => {
    function makeSystem(): { galaxy: import('../src/sim/galaxy').Galaxy; star: Habitat; planet: Habitat; moon: Habitat } {
        const galaxy = generateGalaxy({
            seed: 42,
            shape: GalaxyShape.Irregular,
            starCount: 5,
            sectorWidth: 4,
            sectorHeight: 4,
            systemNames: ['Alpha', 'Beta'],
        });
        // Find a system that has both a planet and a moon so all three
        // assertions below are exercised.
        for (const system of galaxy.systems) {
            const planets = system.habitats.filter((h) => h.category === HabitatCategoryType.Planet && h.parent !== null);
            for (const planet of planets) {
                const moons = system.habitats.filter((h) => h.category === HabitatCategoryType.Moon && h.parent === planet);
                if (moons.length > 0) {
                    return { galaxy, star: system.systemStar, planet, moon: moons[0] };
                }
            }
        }
        throw new Error('test galaxy had no planet-with-moon system');
    }

    it('moves planets and moons along their orbits, preserving orbit distances', () => {
        const { galaxy, star, planet, moon } = makeSystem();

        const planetX0 = planet.xpos;
        const planetY0 = planet.ypos;
        const moonX0 = moon.xpos;
        const moonY0 = moon.ypos;
        const starX0 = star.xpos;
        const starY0 = star.ypos;

        const distToParent = (h: Habitat): number => {
            const p = h.parent!;
            const dx = h.xpos - p.xpos;
            const dy = h.ypos - p.ypos;
            return Math.sqrt(dx * dx + dy * dy);
        };

        galaxy.step(10_000); // 10 game seconds

        // The planet moved away from its starting position.
        const planetMoved = Math.abs(planet.xpos - planetX0) + Math.abs(planet.ypos - planetY0);
        expect(planetMoved).toBeGreaterThan(0);

        // Distance from the star is unchanged (within float tolerance).
        expect(Math.abs(distToParent(planet) - planet.orbitDistance)).toBeLessThan(1e-6);

        // The moon moved too and stays at its orbit distance from its planet.
        const moonMoved = Math.abs(moon.xpos - moonX0) + Math.abs(moon.ypos - moonY0);
        expect(moonMoved).toBeGreaterThan(0);
        expect(Math.abs(distToParent(moon) - moon.orbitDistance)).toBeLessThan(1e-6);

        // The star itself did not move (no parent).
        expect(star.xpos).toBeCloseTo(starX0, 6);
        expect(star.ypos).toBeCloseTo(starY0, 6);
    });

    it('step(0) preserves orbit distances', () => {
        const { galaxy, planet, moon } = makeSystem();

        const distToParent = (h: Habitat): number => {
            const p = h.parent!;
            const dx = h.xpos - p.xpos;
            const dy = h.ypos - p.ypos;
            return Math.sqrt(dx * dx + dy * dy);
        };

        galaxy.step(0);

        // No time advanced: every orbiting habitat stays at its orbit distance
        // from its parent (absolute positions may shift because a parent's
        // position is recomputed even for a zero-length step).
        expect(Math.abs(distToParent(planet) - planet.orbitDistance)).toBeLessThan(1e-6);
        expect(Math.abs(distToParent(moon) - moon.orbitDistance)).toBeLessThan(1e-6);
    });
});