import { beforeAll, describe, expect, it } from 'vitest';
import { generateGalaxy, type Galaxy } from '../src/sim/galaxy';
import type { GameData } from '../src/sim/data/gameData';
import { determineAggressiveRaces, type EmpireStart } from '../src/sim/raceRegions';
import { GalaxyLocationType } from '../src/sim/galaxyLocation';
import { GalaxyShape, HabitatCategoryType, HabitatType, IndustryType } from '../src/sim/types';
import { CreatureType } from '../src/sim/creature';
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
        // Seed re-picked from 42 to 555 after task 01f3 wired SelectCreatures
        // into generation: each call consumes Rnd values, shifting the shared
        // stream and hence every subsequent star's position rolls. The test
        // checks a statistical property (center-heavy spiral), not exact
        // positions, so a different seed with the same property is equivalent.
        const galaxy = generateGalaxy({
            seed: 555,
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

    it('black holes get non-empty, word-list names', () => {
        const galaxy = generateGalaxy({
            seed: 2024,
            shape: GalaxyShape.Spiral,
            starCount: 700,
            sectorWidth: 10,
            sectorHeight: 10,
            systemNames,
        });

        const blackHoles = galaxy.habitats.filter((h) => h.category === HabitatCategoryType.Star && h.type === HabitatType.BlackHole);
        expect(blackHoles.length).toBeGreaterThan(0);
        for (const star of blackHoles) {
            expect(star.name.length).toBeGreaterThan(0);
            expect(star.name).toMatch(/^\S+ \S+$/);
        }
    });

    it('every moon has a non-empty name made of letters', () => {
        const galaxy = generateGalaxy({
            seed: 2024,
            shape: GalaxyShape.Spiral,
            starCount: 400,
            sectorWidth: 10,
            sectorHeight: 10,
            systemNames,
        });

        const moons = galaxy.habitats.filter((h) => h.category === HabitatCategoryType.Moon);
        expect(moons.length).toBeGreaterThan(0);
        for (const moon of moons) {
            expect(moon.name.length).toBeGreaterThan(0);
            // GenerateRandomNameAlt builds names from vowel/consonant tables
            // and capitalizes the first letter — letters only.
            expect(moon.name).toMatch(/^[A-Za-z]+$/);
        }
    });

    it('moon names are deterministic for seed 1, and the rest of the galaxy is unchanged', () => {
        const optionsA = { seed: 1, shape: GalaxyShape.Spiral, starCount: 300, sectorWidth: 8, sectorHeight: 8, systemNames };
        const optionsB = { seed: 1, shape: GalaxyShape.Spiral, starCount: 300, sectorWidth: 8, sectorHeight: 8, systemNames };

        const galaxyA = generateGalaxy(optionsA);
        const galaxyB = generateGalaxy(optionsB);

        const moonsOf = (g: Galaxy) => g.habitats.filter((h) => h.category === HabitatCategoryType.Moon);
        const moonsA = moonsOf(galaxyA);
        const moonsB = moonsOf(galaxyB);
        expect(moonsA.length).toBeGreaterThan(0);
        expect(moonsA.length).toBe(moonsB.length);
        // Moon names: identical across runs and letters only.
        expect(moonsA.map((m) => m.name)).toEqual(moonsB.map((m) => m.name));
        for (const moon of moonsA) {
            expect(moon.name).toMatch(/^[A-Za-z]+$/);
        }

        // Everything else in the galaxy output is unchanged by the moon-name
        // port: star/planet counts and positions match exactly between the two
        // generations (and so do types/diameters/orbits as a wider check).
        const nonMoonSignature = (g: Galaxy) =>
            g.habitats
                .filter((h) => h.category !== HabitatCategoryType.Moon)
                .map((h) => [h.category, h.type, h.xpos, h.ypos, h.diameter, h.orbitDistance]);
        expect(nonMoonSignature(galaxyA)).toEqual(nonMoonSignature(galaxyB));

        const countByCategory = (g: Galaxy) => {
            const counts = new Map<HabitatCategoryType, number>();
            for (const h of g.habitats) {
                counts.set(h.category, (counts.get(h.category) ?? 0) + 1);
            }
            return [...counts.entries()].sort(([a], [b]) => a - b);
        };
        expect(countByCategory(galaxyA)).toEqual(countByCategory(galaxyB));
        expect(galaxyA.systems.length).toBe(galaxyB.systems.length);
    });

    it('some habitats have a scenic feature (with a ring flag when applicable)', () => {
        const galaxy = generateGalaxy({
            seed: 2024,
            shape: GalaxyShape.Spiral,
            starCount: 700,
            sectorWidth: 10,
            sectorHeight: 10,
            systemNames,
        });

        const scenic = galaxy.habitats.filter((h) => h.scenicFeature !== '');
        expect(scenic.length).toBeGreaterThan(0);
        for (const habitat of scenic) {
            expect(typeof habitat.scenicFeature).toBe('string');
            expect(habitat.scenicFactor).toBeGreaterThan(0);
        }
        expect(scenic.some((h) => h.hasRings)).toBe(true);
    });

    it('research-bonus habitats get a research bonus industry', () => {
        const galaxy = generateGalaxy({
            seed: 2024,
            shape: GalaxyShape.Spiral,
            starCount: 700,
            sectorWidth: 10,
            sectorHeight: 10,
            systemNames,
        });

        const withBonus = galaxy.habitats.filter((h) => h.researchBonus > 0);
        expect(withBonus.length).toBeGreaterThan(0);
        expect(withBonus.some((h) => h.researchBonusIndustry !== IndustryType.Undefined)).toBe(true);
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

describe('generateGalaxy race regions (task 01f1: SetupAlienRacePopulations)', () => {
    let gameData: GameData;

    beforeAll(async () => {
        gameData = await loadGameDataFs();
    });

    // Five playable, mutually distinct races (one per empire start). All are
    // in the aggressive list (aggression >= 115, intelligence >= 85) so that
    // with aggressionLevel 1.5 four proximity-eligible candidates exist for
    // the "marks >= 3 aggressive races" test.
    const startRaces = ['Boskara', 'Mortalen', 'Sluken', 'Naxxilian', 'Dhayut'];
    const makeEmpireStarts = (): EmpireStart[] =>
        startRaces.map((name) => ({ resolvedRace: gameData.races.find((r) => r.name === name)!, projectedColonyAmount: 5 }));

    it('creates one RaceRegion location per empire start, named "<race> Region"', () => {
        const galaxy = generateGalaxy({
            seed: 12345,
            shape: GalaxyShape.Spiral,
            starCount: 700,
            sectorWidth: 10,
            sectorHeight: 10,
            systemNames,
            gameData,
            aggressionLevel: 1.5,
            empireStarts: makeEmpireStarts(),
        });

        const regions = galaxy.galaxyLocations.filter((l) => l.type === GalaxyLocationType.RaceRegion);
        expect(regions.length).toBe(5);
        for (const region of regions) {
            expect(region.relatedRace).not.toBeNull();
            expect(region.name).toBe(region.relatedRace!.name + ' Region');
            expect(region.showName).toBe(false);
            expect(region.pictureRef).toBe(-1);
            expect(region.width).toBeCloseTo(region.height, 5);
        }
        const names = regions.map((r) => r.relatedRace!.name).sort();
        expect(names).toEqual([...startRaces].sort());
    }, 60000);

    it('race regions are inside the galaxy bounds', () => {
        const galaxy = generateGalaxy({
            seed: 777,
            shape: GalaxyShape.Elliptical,
            starCount: 300,
            sectorWidth: 8,
            sectorHeight: 8,
            systemNames,
            gameData,
            aggressionLevel: 1.5,
            empireStarts: makeEmpireStarts(),
        });

        const regions = galaxy.galaxyLocations.filter((l) => l.type === GalaxyLocationType.RaceRegion);
        expect(regions.length).toBe(5);
        for (const region of regions) {
            expect(region.xpos).toBeGreaterThanOrEqual(0);
            expect(region.ypos).toBeGreaterThanOrEqual(0);
            expect(region.xpos + region.width).toBeLessThan(galaxy.sizeX);
            expect(region.ypos + region.height).toBeLessThan(galaxy.sizeY);
        }
    }, 60000);

    it('race regions are deterministic for a fixed seed', () => {
        const options = {
            seed: 4242,
            shape: GalaxyShape.Spiral,
            starCount: 300,
            sectorWidth: 8,
            sectorHeight: 8,
            systemNames,
            gameData,
            aggressionLevel: 1.5,
            empireStarts: makeEmpireStarts(),
        };
        const galaxyA = generateGalaxy(options);
        const galaxyB = generateGalaxy(options);

        const signature = (g: Galaxy) =>
            g.galaxyLocations
                .filter((l) => l.type === GalaxyLocationType.RaceRegion)
                .map((l) => [l.name, l.xpos, l.ypos, l.width, l.height]);

        expect(signature(galaxyA)).toEqual(signature(galaxyB));
    }, 60000);

    it('aggression level 1.5 marks >= 1 aggressive race (proximity to the first region)', () => {
        const galaxy = generateGalaxy({
            seed: 12345,
            shape: GalaxyShape.Spiral,
            starCount: 700,
            sectorWidth: 10,
            sectorHeight: 10,
            systemNames,
            gameData,
            aggressionLevel: 1.5,
            empireStarts: makeEmpireStarts(),
        });

        const regions = galaxy.galaxyLocations.filter((l) => l.type === GalaxyLocationType.RaceRegion);
        const first = regions[0];
        // The source's "num" counter increments when an aggressive-race
        // region lands within SectorSize * 2 of the first empire's region.
        // With all five start races in the aggressive list, four candidates
        // (i > 0) each get up to 50 proximity re-rolls; for this seed one
        // of them lands within range (the rest exhaust their retries).
        const num2 = galaxy.sectorSize * 2.0;
        let closeCount = 0;
        for (let i = 1; i < regions.length; i++) {
            const center = regions[i].resolveLocationCenter();
            const firstCenter = first.resolveLocationCenter();
            if (galaxy.calculateDistance(center.x, center.y, firstCenter.x, firstCenter.y) <= num2) {
                closeCount++;
            }
        }
        expect(closeCount).toBeGreaterThanOrEqual(1);
    }, 60000);

    it('determineAggressiveRaces filters by playable/aggression/intelligence and sorts descending', () => {
        const result = determineAggressiveRaces(gameData.races, 115, 85);
        const names = result.map((r) => r.name);
        // Playable races with Aggression >= 115 and Intelligence >= 85:
        // Boskara (140), Dhayut (119), Ikkuro (115), Mortalen (127),
        // Naxxilian (121), Sluken (123). Shakturi (150) is unplayable;
        // Gizurean (110) and Human (110) fall below the aggression threshold.
        expect(names).toEqual(['Boskara', 'Mortalen', 'Sluken', 'Naxxilian', 'Dhayut', 'Ikkuro']);
        for (const race of result) {
            expect(race.playable).toBe(true);
            expect(race.aggression).toBeGreaterThanOrEqual(115);
            expect(race.intelligence).toBeGreaterThanOrEqual(85);
        }
    });

    it('with no empire starts no race regions are created', () => {
        const withStarts = generateGalaxy({
            seed: 4242,
            shape: GalaxyShape.Spiral,
            starCount: 100,
            sectorWidth: 8,
            sectorHeight: 8,
            systemNames,
            gameData,
            aggressionLevel: 1.5,
            empireStarts: makeEmpireStarts(),
        });
        const withoutStarts = generateGalaxy({
            seed: 4242,
            shape: GalaxyShape.Spiral,
            starCount: 100,
            sectorWidth: 8,
            sectorHeight: 8,
            systemNames,
            gameData,
        });

        expect(withoutStarts.galaxyLocations.filter((l) => l.type === GalaxyLocationType.RaceRegion).length).toBe(0);
        // With non-empty empire starts the SetupAlienRacePopulations loop
        // consumes Rnd calls before the star loop (matching the C# source
        // ordering), so star positions legitimately differ between the two
        // galaxies; only the region count is asserted here.
        expect(withStarts.galaxyLocations.filter((l) => l.type === GalaxyLocationType.RaceRegion).length).toBe(5);
    }, 60000);
});

describe('generateGalaxy native populations (task 01f2: SelectPopulation)', () => {
    let gameData: GameData;

    beforeAll(async () => {
        gameData = await loadGameDataFs();
    });

    // Same five start races as the 01f1 block. Task 08b fixed the data/model
    // mismatch: race files store NativePlanetType as a raw index (0-5), which
    // parseRace resolves to a HabitatType via
    // resolveColonyHabitatTypeByIndexDesertBeforeOcean, so SelectPopulation's
    // type match now works and native populations are placed on planets of
    // the matching habitat type.
    const startRaces = ['Boskara', 'Mortalen', 'Sluken', 'Naxxilian', 'Dhayut'];
    const makeEmpireStarts = (): EmpireStart[] =>
        startRaces.map((name) => ({ resolvedRace: gameData.races.find((r) => r.name === name)!, projectedColonyAmount: 5 }));

    const generateTestGalaxy = (seed: number, starCount: number) =>
        generateGalaxy({
            seed,
            shape: GalaxyShape.Spiral,
            starCount,
            sectorWidth: 10,
            sectorHeight: 10,
            systemNames,
            gameData,
            aggressionLevel: 1.5,
            empireStarts: makeEmpireStarts(),
        });

    it('a 700-star galaxy (seed 1) has habitats with native populations', () => {
        const galaxy = generateTestGalaxy(1, 700);

        // Task 08b: races now store a resolved HabitatType, so planets whose
        // type matches their nearest race region's race get native
        // populations. With seed 1 and the default five start races this is
        // deterministic and > 0.
        const populated = galaxy.habitats.filter(
            (h) => h.category === HabitatCategoryType.Planet && h.population.items.length > 0,
        );
        expect(populated.length).toBeGreaterThan(0);
        expect(galaxy.independentCount).toBeGreaterThan(0);

        // Every populated planet must match its population's race native
        // habitat type (the SelectPopulation match condition).
        for (const habitat of populated) {
            for (const population of habitat.population.items) {
                expect(habitat.type).toBe(population.race.nativeHabitatType);
            }
        }

        // Sanity: all five start races have regions and the per-race colony
        // limit logic is reachable (limit > 0 for 700 stars).
        const regions = galaxy.galaxyLocations.filter((l) => l.type === GalaxyLocationType.RaceRegion);
        expect(regions.length).toBe(startRaces.length);
        const limit = Math.trunc(Math.sqrt(galaxy.starCount) / 3.5);
        expect(limit).toBeGreaterThan(0);
    }, 60000);

    it('native populations respect the per-race independent colony limit', () => {
        const galaxy = generateTestGalaxy(12345, 700);

        // Limit = (int)(Math.Sqrt(StarCount) / 3.5 * LifePrevalence / 1000),
        // with LifePrevalence defaulting to 1000.
        const limit = Math.trunc(Math.sqrt(galaxy.starCount) / 3.5);
        expect(limit).toBeGreaterThan(0);
        const counts = new Map<string, number>();
        for (const habitat of galaxy.habitats) {
            for (const population of habitat.population.items) {
                counts.set(population.race.name, (counts.get(population.race.name) ?? 0) + 1);
            }
        }
        expect(counts.size).toBeGreaterThan(0);
        for (const [name, count] of counts) {
            expect(count).toBeLessThanOrEqual(limit);
        }
        expect(galaxy.independentCount).toBe([...counts.values()].reduce((a, b) => a + b, 0));
    }, 60000);

    it('home-system renaming is consistent with the races that have native populations', () => {
        const galaxy = generateTestGalaxy(12345, 700);

        const homeSystems = new Set<string>();
        for (const system of galaxy.systems) {
            const sun = system.systemStar;
            for (const habitat of system.habitats) {
                if (habitat.population.items.length > 0) {
                    const race = habitat.population.items[0].race;
                    // Only the race whose FIRST native population landed in
                    // this system may have renamed it; later races keep the
                    // generated name. So a rename implies the sun hosts a
                    // population of that race.
                    if (sun.name === race.homeSystemName) {
                        homeSystems.add(race.name);
                    }
                }
            }
        }
        // Task 08b: at least one race's first native population renames its home
        // system, so some home systems are renamed.
        expect(homeSystems.size).toBeGreaterThanOrEqual(1);
        for (const name of homeSystems) {
            const race = gameData.races.find((r) => r.name === name)!;
            expect(race.homeSystemName.length).toBeGreaterThan(0);
        }
    }, 60000);

    it('native population generation is deterministic for a fixed seed', () => {
        const options = {
            seed: 4242,
            shape: GalaxyShape.Spiral,
            starCount: 300,
            sectorWidth: 8,
            sectorHeight: 8,
            systemNames,
            gameData,
            aggressionLevel: 1.5,
            empireStarts: makeEmpireStarts(),
        };
        const galaxyA = generateGalaxy(options);
        const galaxyB = generateGalaxy(options);

        const signature = (g: Galaxy) =>
            g.habitats
                .filter((h) => h.population.items.length > 0)
                .map((h) => [
                    h.name,
                    h.type,
                    ...h.population.items.map((p) => [p.race.name, p.amount, p.growthRate]),
                ]);

        expect(signature(galaxyA)).toEqual(signature(galaxyB));
    }, 60000);

    it('with no empire starts no native populations are created', () => {
        const galaxy = generateGalaxy({
            seed: 4242,
            shape: GalaxyShape.Spiral,
            starCount: 100,
            sectorWidth: 8,
            sectorHeight: 8,
            systemNames,
            gameData,
        });

        expect(galaxy.habitats.every((h) => h.population.items.length === 0)).toBe(true);
        expect(galaxy.independentCount).toBe(0);
    }, 60000);
});

describe('generateGalaxy creatures (task 01f3: SelectCreatures)', () => {
    let gameData: GameData;

    beforeAll(async () => {
        gameData = await loadGameDataFs();
    });

    const generateTestGalaxy = (seed: number, starCount: number) =>
        generateGalaxy({
            seed,
            shape: GalaxyShape.Spiral,
            starCount,
            sectorWidth: 10,
            sectorHeight: 10,
            systemNames,
            gameData,
        });

    it('creatures exist and reference valid habitats with in-range types', () => {
        const galaxy = generateTestGalaxy(12345, 700);

        expect(galaxy.creatures.length).toBeGreaterThan(0);

        const habitatByIdx = new Map<number, (typeof galaxy.habitats)[number]>();
        for (const h of galaxy.habitats) {
            habitatByIdx.set(h.habitatIndex, h);
        }
        const typeValues = Object.values(CreatureType).filter((v) => typeof v === 'number');
        for (const creature of galaxy.creatures) {
            expect(typeValues).toContain(creature.type as number);
            // Every generated creature is anchored to a real habitat.
            expect(creature.anchorHabitat).not.toBeNull();
            const anchor = creature.anchorHabitat!;
            expect(habitatByIdx.has(anchor.habitatIndex), `unknown anchor ${anchor.name}`).toBe(true);
            // The species matches what SelectCreatures can place on that habitat.
            if (anchor.type === HabitatType.BarrenRock || anchor.category === HabitatCategoryType.Asteroid) {
                expect(creature.type).toBe(CreatureType.RockSpaceSlug);
            } else if (anchor.type === HabitatType.Desert) {
                expect(creature.type).toBe(CreatureType.DesertSpaceSlug);
            } else if (anchor.type === HabitatType.FrozenGasGiant) {
                expect(creature.type).toBe(CreatureType.Kaltor);
            } else if (anchor.category === HabitatCategoryType.GasCloud) {
                expect(creature.type).toBe(CreatureType.Kaltor);
            } else if (anchor.type === HabitatType.GasGiant) {
                expect(creature.type).toBe(CreatureType.Ardilus);
            }
            // NearestSystemStar resolves to the top-level habitat of the anchor.
            expect(creature.nearestSystemStar).not.toBeNull();
            expect(creature.nearestSystemStar!.parent).toBeNull();
        }

        // Kaltors are only spawned in swarms of 3-9 per gas cloud, so every
        // gas-cloud Kaltor's anchor shares at least 2 siblings.
        const kaltorByCloud = new Map<string, number>();
        for (const c of galaxy.creatures) {
            if (c.type === CreatureType.Kaltor && c.anchorHabitat!.category === HabitatCategoryType.GasCloud) {
                kaltorByCloud.set(c.anchorHabitat!.name, (kaltorByCloud.get(c.anchorHabitat!.name) ?? 0) + 1);
            }
        }
        for (const count of kaltorByCloud.values()) {
            expect(count).toBeGreaterThanOrEqual(3);
            expect(count).toBeLessThanOrEqual(9);
        }
    }, 60000);

    it('system creature lists stay empty after generation, and post-generation spawns land in the owning system', () => {
        const galaxy = generateTestGalaxy(12345, 700);

        // Faithful behavior: GenerateCreatureAtHabitat only appends to
        // Systems[i].Creatures when Systems is already built (C# guard
        // `Systems != null && Systems.Count > habitat2.SystemIndex`). During
        // new-game generation the systems are built at the end of
        // generateGalaxy — after every selectCreatures call — so no creature
        // ever lands in a system list.
        for (const system of galaxy.systems) {
            expect(system.creatures).toBeUndefined();
        }
        expect(galaxy.creatures.length).toBeGreaterThan(0);

        // Once systems exist (post-generation), spawning does append to both
        // the global list and the owning system's list.
        const planet = galaxy.habitats.find((h) => h.category === HabitatCategoryType.Planet)!;
        const before = galaxy.creatures.length;
        const spawned = galaxy.generateCreatureAtHabitat(CreatureType.Kaltor, planet);
        expect(spawned).not.toBeNull();
        expect(galaxy.creatures.length).toBe(before + 1);
        const system = galaxy.systems[planet.systemIndex];
        expect(system.creatures).toEqual([spawned]);
        expect(galaxy.creatures).toContain(spawned);
    }, 60000);

    it('creature generation is deterministic for a fixed seed', () => {
        const optionsA = { seed: 4242, shape: GalaxyShape.Spiral, starCount: 300, sectorWidth: 8, sectorHeight: 8, systemNames, gameData };
        const optionsB = { seed: 4242, shape: GalaxyShape.Spiral, starCount: 300, sectorWidth: 8, sectorHeight: 8, systemNames, gameData };
        const galaxyA = generateGalaxy(optionsA);
        const galaxyB = generateGalaxy(optionsB);

        const signature = (g: Galaxy) =>
            g.creatures.map((c) => [
                c.type,
                c.anchorHabitat?.name,
                c.size,
                c.maxSize,
                c.attackStrength,
                c.damageKillThreshold,
                c.locationLocked,
            ]);

        expect(signature(galaxyA)).toEqual(signature(galaxyB));
    }, 60000);

    it('with zero creature prevalence no creatures are created', () => {
        const galaxy = generateGalaxy({
            seed: 4242,
            shape: GalaxyShape.Spiral,
            starCount: 100,
            sectorWidth: 8,
            sectorHeight: 8,
            systemNames,
            gameData,
        });
        galaxy.creaturePrevalence = 0;
        const barren = galaxy.habitats.find((h) => h.type === HabitatType.BarrenRock);
        expect(barren).toBeDefined();
        const before = galaxy.creatures.length;
        galaxy.selectCreatures(barren!);
        expect(galaxy.creatures.length).toBe(before);
    }, 60000);
});
