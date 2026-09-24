import { describe, expect, it } from 'vitest';
import { generateGalaxy, type Galaxy } from '../src/sim/galaxy';
import { GalaxyNebulaeGenerator } from '../src/sim/galaxyNebulaeGenerator';
import { GalaxyLocationEffectType, GalaxyLocationType } from '../src/sim/galaxyLocation';
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

describe('galaxy locations (task 01e: nebulae / GalaxyLocations)', () => {
    for (const shape of shapes) {
        it(`shape ${GalaxyShape[shape]}: nebula clouds are generated and within bounds`, () => {
            const galaxy = generateGalaxy({
                seed: 12345,
                shape,
                starCount: 700,
                sectorWidth: 10,
                sectorHeight: 10,
                systemNames,
            });

            const nebulae = galaxy.galaxyLocations.filter((l) => l.type === GalaxyLocationType.NebulaCloud);
            expect(nebulae.length).toBeGreaterThan(0);
            for (const loc of nebulae) {
                expect(loc.xpos).toBeGreaterThanOrEqual(0);
                expect(loc.ypos).toBeGreaterThanOrEqual(0);
                expect(loc.xpos + loc.width).toBeLessThanOrEqual(galaxy.sizeX);
                expect(loc.ypos + loc.height).toBeLessThanOrEqual(galaxy.sizeY);
            }
        });

        it(`shape ${GalaxyShape[shape]}: galaxy locations are deterministic for a fixed seed`, () => {
            const options = { seed: 999, shape, starCount: 150, sectorWidth: 8, sectorHeight: 8, systemNames };
            const galaxyA = generateGalaxy(options);
            const galaxyB = generateGalaxy(options);

            const signature = (g: Galaxy) =>
                g.galaxyLocations.map((l) => [l.name, l.type, l.xpos, l.ypos, l.width, l.height, l.pictureRef, l.effect, l.shape, l.showName]);

            expect(signature(galaxyA)).toEqual(signature(galaxyB));
        });
    }

    it('Spiral and Elliptical shapes have spiral-arm nebulae; other shapes do not', () => {
        for (const shape of shapes) {
            const galaxy = generateGalaxy({
                seed: 12345,
                shape,
                starCount: 700,
                sectorWidth: 10,
                sectorHeight: 10,
                systemNames,
            });
            const hasArm = galaxy.galaxyLocations.some((l) => l.type === GalaxyLocationType.NebulaCloud && l.name.endsWith(' Arm'));
            const expectArm = shape === GalaxyShape.Spiral || shape === GalaxyShape.Elliptical;
            expect(hasArm).toBe(expectArm);
        }
    }, 60000);

    it('black-hole and supernova locations are centered on their star', () => {
        const galaxy = generateGalaxy({
            seed: 12345,
            shape: GalaxyShape.Spiral,
            starCount: 700,
            sectorWidth: 10,
            sectorHeight: 10,
            systemNames,
        });

        const special = galaxy.galaxyLocations.filter((l) => l.type === GalaxyLocationType.BlackHole || l.type === GalaxyLocationType.SuperNova);
        expect(special.length).toBeGreaterThan(0);
        const stars = galaxy.habitats.filter((h) => h.category === HabitatCategoryType.Star);
        for (const loc of special) {
            const cx = loc.xpos + loc.width / 2.0;
            const cy = loc.ypos + loc.height / 2.0;
            let best = Number.MAX_VALUE;
            for (const s of stars) {
                const d = Math.hypot(s.xpos - cx, s.ypos - cy);
                if (d < best) {
                    best = d;
                }
            }
            // float32 storage of the location center loses ~2 units at
            // galaxy scale (sizeX > 2^24).
            expect(best).toBeLessThan(4.0);
        }
    }, 60000);

    it('stars inside LightningDamage nebulae are not MainSequence/RedGiant/SuperGiant', () => {
        const galaxy = generateGalaxy({
            seed: 12345,
            shape: GalaxyShape.Spiral,
            starCount: 700,
            sectorWidth: 10,
            sectorHeight: 10,
            systemNames,
        });

        const lightning = galaxy.galaxyLocations.filter((l) => l.type === GalaxyLocationType.NebulaCloud && l.effect === GalaxyLocationEffectType.LightningDamage);
        expect(lightning.length).toBeGreaterThan(0);

        const stars = galaxy.systems.map((s) => s.systemStar);
        for (const star of stars) {
            for (const loc of lightning) {
                const r = loc.width / 2.0;
                const dx = star.xpos - (loc.xpos + loc.width / 2.0);
                const dy = star.ypos - (loc.ypos + loc.height / 2.0);
                if (dx * dx + dy * dy < r * r) {
                    expect(
                        [HabitatType.MainSequence, HabitatType.RedGiant, HabitatType.SuperGiant].includes(star.type),
                        `star ${star.name} (${HabitatType[star.type]}) inside LightningDamage nebula ${loc.name}`,
                    ).toBe(false);
                }
            }
        }
    }, 60000);

    // Task 01h: pin the first 3 generated locations' (type, x, y, size) for
    // seed 1, spiral, 700 stars to freeze the ported RNG stream against the
    // C# source (values computed from the verified port; see the probe run in
    // the worker report). Exercises the generator directly so the pin is
    // independent of the rest of galaxy generation.
    it('pins first 3 nebula locations (type, x, y, size) for seed 1 spiral 700 stars', () => {
        // 10x10 sectors -> sizeX = sizeY = 20_000_000, matching the other
        // tests in this file.
        const sizeX = 10 * 2_000_000;
        const sizeY = 10 * 2_000_000;
        const gen = new GalaxyNebulaeGenerator(40, systemNames);
        const locs = gen.generateGalaxyNebulae(1, 700, GalaxyShape.Spiral, sizeX, sizeY);
        expect(locs.length).toBeGreaterThanOrEqual(3);
        const pinned = [
            { type: GalaxyLocationType.NebulaCloud, x: 9385432, y: 8411493, size: 1817283 },
            { type: GalaxyLocationType.NebulaCloud, x: 8491573, y: 8597370, size: 1713964 },
            { type: GalaxyLocationType.NebulaCloud, x: 7976225, y: 9348316, size: 1723910 },
        ];
        for (let i = 0; i < 3; i++) {
            const l = locs[i];
            expect(l.type).toBe(pinned[i].type);
            expect(l.xpos).toBe(pinned[i].x);
            expect(l.ypos).toBe(pinned[i].y);
            expect(l.width).toBe(pinned[i].size);
            expect(l.height).toBe(pinned[i].size);
        }
    });
});