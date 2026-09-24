import { describe, expect, it } from 'vitest';
import { generateGalaxy, type Galaxy } from '../src/sim/galaxy';
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
});