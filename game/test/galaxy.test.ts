import { describe, expect, it } from 'vitest';
import { generateGalaxy } from '../src/sim/galaxy';
import { GalaxyShape, HabitatCategoryType, HabitatType } from '../src/sim/types';

const systemNames = Array.from({ length: 200 }, (_, i) => `Test System ${i}`);

const shapes = [
    GalaxyShape.Spiral,
    GalaxyShape.Elliptical,
    GalaxyShape.Irregular,
    GalaxyShape.Ring,
    GalaxyShape.ClustersEven,
    GalaxyShape.ClustersVaried,
];

describe('generateGalaxy', () => {
    for (const shape of shapes) {
        it(`shape ${GalaxyShape[shape]}: produces starCount systems and gas clouds in range`, () => {
            const galaxy = generateGalaxy({
                seed: 12345,
                shape,
                starCount: 700,
                sectorWidth: 10,
                sectorHeight: 10,
                systemNames,
            });

            expect(galaxy.systems.length).toBe(700);

            const gasClouds = galaxy.habitats.filter((h) => h.category === HabitatCategoryType.GasCloud);
            expect(gasClouds.length).toBeGreaterThanOrEqual(140);
            expect(gasClouds.length).toBeLessThan(350);
        });

        it(`shape ${GalaxyShape[shape]}: all habitat coordinates are within galaxy bounds`, () => {
            const galaxy = generateGalaxy({
                seed: 777,
                shape,
                starCount: 200,
                sectorWidth: 8,
                sectorHeight: 8,
                systemNames,
            });

            for (const habitat of galaxy.habitats) {
                expect(habitat.xpos).toBeGreaterThanOrEqual(0);
                expect(habitat.xpos).toBeLessThan(galaxy.sizeX);
                expect(habitat.ypos).toBeGreaterThanOrEqual(0);
                expect(habitat.ypos).toBeLessThan(galaxy.sizeY);
            }
        });

        it(`shape ${GalaxyShape[shape]}: generation is deterministic for a fixed seed`, () => {
            const optionsA = { seed: 999, shape, starCount: 150, sectorWidth: 8, sectorHeight: 8, systemNames };
            const optionsB = { seed: 999, shape, starCount: 150, sectorWidth: 8, sectorHeight: 8, systemNames };

            const galaxyA = generateGalaxy(optionsA);
            const galaxyB = generateGalaxy(optionsB);

            expect(galaxyA.habitats.map((h) => [h.name, h.type, h.xpos, h.ypos, h.diameter])).toEqual(
                galaxyB.habitats.map((h) => [h.name, h.type, h.xpos, h.ypos, h.diameter]),
            );
        });
    }

    it('Spiral shape: star density is higher near the galaxy center than near the rim', () => {
        const galaxy = generateGalaxy({
            seed: 42,
            shape: GalaxyShape.Spiral,
            starCount: 700,
            sectorWidth: 10,
            sectorHeight: 10,
            systemNames,
        });

        const centerX = galaxy.sizeX / 2;
        const centerY = galaxy.sizeY / 2;
        const maxRadius = Math.min(galaxy.sizeX, galaxy.sizeY) / 2;

        let innerCount = 0;
        let outerCount = 0;
        for (const system of galaxy.systems) {
            const star = system.systemStar;
            const distance = Math.sqrt((star.xpos - centerX) ** 2 + (star.ypos - centerY) ** 2);
            const normalized = distance / maxRadius;
            if (normalized < 0.3) {
                innerCount++;
            } else if (normalized >= 0.7 && normalized < 1.0) {
                outerCount++;
            }
        }

        expect(innerCount).toBeGreaterThan(outerCount);
    });

    it('planets and moons are parented correctly, and orbit distances/counts obey source tables', () => {
        const galaxy = generateGalaxy({
            seed: 2024,
            shape: GalaxyShape.Spiral,
            starCount: 400,
            sectorWidth: 10,
            sectorHeight: 10,
            systemNames,
        });

        let sawPlanet = false;
        let sawMoon = false;

        for (const system of galaxy.systems) {
            const star = system.systemStar;
            const planets = system.habitats.filter((h) => h.category === HabitatCategoryType.Planet);
            const moons = system.habitats.filter((h) => h.category === HabitatCategoryType.Moon);

            for (const planet of planets) {
                sawPlanet = true;
                expect(planet.parent).toBe(star);
            }
            for (const moon of moons) {
                sawMoon = true;
                expect(moon.parent).toBeDefined();
                expect(moon.parent?.category).toBe(HabitatCategoryType.Planet);
                expect(planets).toContain(moon.parent);
            }

            switch (star.type) {
                case HabitatType.MainSequence:
                case HabitatType.RedGiant:
                case HabitatType.SuperGiant:
                    expect(planets.length).toBeLessThanOrEqual(15);
                    break;
                case HabitatType.WhiteDwarf:
                    expect(planets.length).toBeLessThanOrEqual(2);
                    break;
                case HabitatType.Neutron:
                    expect(planets.length).toBeLessThanOrEqual(1);
                    break;
                case HabitatType.SuperNova:
                    expect(planets.length).toBe(0);
                    break;
            }
        }

        expect(sawPlanet).toBe(true);
        expect(sawMoon).toBe(true);
    });

    it('generateGalaxy with planets/moons/asteroids is deterministic for a fixed seed', () => {
        const optionsA = { seed: 4242, shape: GalaxyShape.Spiral, starCount: 300, sectorWidth: 8, sectorHeight: 8, systemNames };
        const optionsB = { seed: 4242, shape: GalaxyShape.Spiral, starCount: 300, sectorWidth: 8, sectorHeight: 8, systemNames };

        const galaxyA = generateGalaxy(optionsA);
        const galaxyB = generateGalaxy(optionsB);

        expect(galaxyA.habitats.map((h) => [h.category, h.name, h.type, h.xpos, h.ypos, h.diameter, h.orbitDistance])).toEqual(
            galaxyB.habitats.map((h) => [h.category, h.name, h.type, h.xpos, h.ypos, h.diameter, h.orbitDistance]),
        );
    });
});
