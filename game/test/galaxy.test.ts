import { beforeAll, describe, expect, it } from 'vitest';
import { generateGalaxy, type Galaxy } from '../src/sim/galaxy';
import type { GameData } from '../src/sim/data/gameData';
import { GalaxyShape, HabitatCategoryType, HabitatType } from '../src/sim/types';
import { loadGameDataFs } from './helpers/loadGameDataFs';

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

describe('generateGalaxy with gameData (task 01d: supernovae, resources, treasure asteroids)', () => {
    let gameData: GameData;

    beforeAll(async () => {
        gameData = await loadGameDataFs();
    });

    // Mirror of Galaxy.resolveHabitatTypeByIndexIncludeGasClouds
    // (resources.txt SubType is a compact index, not the HabitatType value).
    function resolveHabitatTypeByIndex(index: number): HabitatType {
        switch (index) {
            case 0:
                return HabitatType.Continental;
            case 1:
                return HabitatType.MarshySwamp;
            case 2:
                return HabitatType.Ocean;
            case 3:
                return HabitatType.Desert;
            case 4:
                return HabitatType.Ice;
            case 5:
                return HabitatType.Volcanic;
            case 6:
                return HabitatType.BarrenRock;
            case 7:
                return HabitatType.GasGiant;
            case 8:
                return HabitatType.FrozenGasGiant;
            case 9:
                return HabitatType.Metal;
            case 10:
                return HabitatType.Ammonia;
            case 11:
                return HabitatType.Argon;
            case 12:
                return HabitatType.CarbonDioxide;
            case 13:
                return HabitatType.Chlorine;
            case 14:
                return HabitatType.Helium;
            case 15:
                return HabitatType.Hydrogen;
            case 16:
                return HabitatType.NitrogenOxygen;
            case 17:
                return HabitatType.Oxygen;
            default:
                return HabitatType.Continental;
        }
    }

    // Mirror of Galaxy.checkPrevalenceValidForHabitat.
    function checkPrevalenceValid(habitat: Galaxy['habitats'][number], dist: GameData['resources'][number]['distributions'][number]): boolean {
        if (resolveHabitatTypeByIndex(dist.subType) !== habitat.type) {
            return false;
        }
        switch (habitat.category) {
            case HabitatCategoryType.Planet:
            case HabitatCategoryType.Moon:
                return dist.type !== 1 && dist.type !== 2;
            case HabitatCategoryType.Asteroid:
                return dist.type === 1;
            case HabitatCategoryType.GasCloud:
                return dist.type === 2;
        }
        return false;
    }

    it('supernovae have nova fields in the source ranges', () => {
        const galaxy = generateGalaxy({
            seed: 12345,
            shape: GalaxyShape.Spiral,
            starCount: 700,
            sectorWidth: 10,
            sectorHeight: 10,
            systemNames,
            gameData,
        });

        const novas = galaxy.habitats.filter((h) => h.type === HabitatType.SuperNova);
        expect(novas.length).toBeGreaterThan(0);
        for (const nova of novas) {
            expect(nova.name.startsWith('Super Nova ')).toBe(true);
            // NovaProgression = 30000 + Rnd.NextDouble() * 60000
            expect(nova.novaProgression).toBeGreaterThanOrEqual(30000);
            expect(nova.novaProgression).toBeLessThan(90000);
            expect(nova.novaImageIndexMajor).toBeGreaterThanOrEqual(0);
            expect(nova.novaImageIndexMajor).toBeLessThan(20);
            expect(nova.novaImageIndexMinor).toBeGreaterThanOrEqual(0);
            expect(nova.novaImageIndexMinor).toBeLessThan(56);
            expect(nova.diameter).toBe(Math.trunc(Math.trunc(nova.novaProgression * 2.0) / 10));
        }
    }, 60000);

    it('habitat resources use valid ids, abundances and prevalence entries', () => {
        const galaxy = generateGalaxy({
            seed: 12345,
            shape: GalaxyShape.Spiral,
            starCount: 700,
            sectorWidth: 10,
            sectorHeight: 10,
            systemNames,
            gameData,
        });

        const byId = new Map(gameData.resources.map((r) => [r.resourceId, r]));

        let checked = 0;
        for (const habitat of galaxy.habitats) {
            if (habitat.resources.length === 0) {
                continue;
            }
            // Treasure asteroids push their resource directly (C# does the
            // same; e.g. Dilithium Crystal has no asteroid distribution).
            if (habitat.pictureRef >= 649 && habitat.pictureRef <= 664) {
                continue;
            }
            expect(habitat.resources.length).toBeLessThanOrEqual(5);
            const seen = new Set<number>();
            for (const res of habitat.resources) {
                expect(seen.has(res.resourceId), `duplicate ${res.resourceId} on ${habitat.name}`).toBe(false);
                seen.add(res.resourceId);
                const def = byId.get(res.resourceId);
                expect(def, `unknown resource id ${res.resourceId} on ${habitat.name}`).toBeDefined();
                expect(res.abundance).toBeGreaterThanOrEqual(0);
                expect(res.abundance).toBeLessThanOrEqual(1000);
                const valid = def!.distributions.some((d) => checkPrevalenceValid(habitat, d));
                expect(valid, `${habitat.name} (${HabitatType[habitat.type]}) has ${def!.name} with no valid prevalence entry`).toBe(true);
                checked++;
            }
        }
        expect(checked).toBeGreaterThan(0);

        const planetsWithRes = galaxy.habitats.filter((h) => h.category === HabitatCategoryType.Planet && h.resources.length > 0);
        expect(planetsWithRes.length).toBeGreaterThan(0);
        const asteroidsWithRes = galaxy.habitats.filter((h) => h.category === HabitatCategoryType.Asteroid && h.resources.length > 0);
        expect(asteroidsWithRes.length).toBeGreaterThan(0);
    }, 60000);

    it('gas giants only get gas resources matching their own type', () => {
        const galaxy = generateGalaxy({
            seed: 12345,
            shape: GalaxyShape.Spiral,
            starCount: 700,
            sectorWidth: 10,
            sectorHeight: 10,
            systemNames,
            gameData,
        });

        const byId = new Map(gameData.resources.map((r) => [r.resourceId, r]));
        const gasGiants = galaxy.habitats.filter((h) => h.type === HabitatType.GasGiant || h.type === HabitatType.FrozenGasGiant);
        expect(gasGiants.length).toBeGreaterThan(0);
        const withRes = gasGiants.filter((h) => h.resources.length > 0);
        expect(withRes.length).toBeGreaterThan(0);
        for (const gg of withRes) {
            for (const res of gg.resources) {
                const def = byId.get(res.resourceId)!;
                // Gas giant planets (category Planet) only match
                // Planet/Moon (type 0) distributions of their own type.
                const valid = def.distributions.some((d) => d.type === 0 && resolveHabitatTypeByIndex(d.subType) === gg.type);
                expect(valid, `${gg.name} (${HabitatType[gg.type]}) has ${def.name} with no matching gas distribution`).toBe(true);
            }
        }
    }, 60000);

    it('treasure asteroids carry Gold or Dilithium Crystal at high abundance', () => {
        const galaxy = generateGalaxy({
            seed: 12345,
            shape: GalaxyShape.Spiral,
            starCount: 700,
            sectorWidth: 10,
            sectorHeight: 10,
            systemNames,
            gameData,
        });

        const gold = gameData.resources.find((r) => r.name === 'Gold');
        const crystal = gameData.resources.find((r) => r.name === 'Dilithium Crystal');
        expect(gold).toBeDefined();
        expect(crystal).toBeDefined();

        const treasures = galaxy.habitats.filter(
            (h) => h.category === HabitatCategoryType.Asteroid && h.type === HabitatType.Metal && h.pictureRef >= 649 && h.pictureRef <= 664,
        );
        expect(treasures.length).toBeGreaterThan(0);
        for (const t of treasures) {
            expect(t.diameter).toBeGreaterThanOrEqual(35);
            expect(t.diameter).toBeLessThan(50);
            expect(t.parent).not.toBeNull();
            expect(t.parent!.category).toBe(HabitatCategoryType.Star);
            expect(t.resources.length).toBe(1);
            const res = t.resources[0];
            expect(res.abundance).toBeGreaterThanOrEqual(800);
            expect(res.abundance).toBeLessThan(1000);
            if (t.pictureRef <= 656) {
                expect(res.resourceId).toBe(gold!.resourceId);
            } else {
                expect(res.resourceId).toBe(crystal!.resourceId);
            }
        }
    }, 60000);

    it('generation with gameData is deterministic for a fixed seed', () => {
        const options = { seed: 4242, shape: GalaxyShape.Spiral, starCount: 300, sectorWidth: 8, sectorHeight: 8, systemNames, gameData };
        const galaxyA = generateGalaxy(options);
        const galaxyB = generateGalaxy(options);

        const signature = (g: Galaxy) =>
            g.habitats.map((h) => [h.category, h.name, h.type, h.xpos, h.ypos, h.diameter, h.resources.map((r) => [r.resourceId, r.abundance])]);

        expect(signature(galaxyA)).toEqual(signature(galaxyB));
    }, 60000);
});
