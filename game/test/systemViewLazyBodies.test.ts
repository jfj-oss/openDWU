// Memory regression guard: a SystemView holds no per-body display objects (planet / moon sprites, dots, labels, moon
// rings, asteroid rocks) until its system is drawn close enough (ensureBodies), and gives them back when released. Built
// for every system up front they were ~40% of the page heap of a 100k-habitat galaxy.
import { describe, expect, it, vi } from 'vitest';
import { Container, Texture } from 'pixi.js';
import { HabitatCategoryType, HabitatType, type Habitat } from '../src/sim/types';
import type { SystemInfo } from '../src/sim/galaxy';

vi.mock('../src/render/assets', async (importOriginal) => {
    const real = await importOriginal<typeof import('../src/render/assets')>();
    // (No canvas in Node: the generated fallback textures.)
    return { ...real, makePlanetTexture: () => Texture.WHITE, makeGlowTexture: () => Texture.WHITE, makeDotTexture: () => Texture.WHITE };
});

const { SystemView } = await import('../src/render/mainView');

function habitat(category: HabitatCategoryType, extra: Partial<Habitat> = {}): Habitat {
    return { category, type: HabitatType.Continental, name: 'H', xpos: 0, ypos: 0, diameter: 100, orbitDistance: 5000, orbitAngle: 0, parent: null, pictureRef: 0, ...extra } as unknown as Habitat;
}

function countDescendants(c: Container): number {
    let n = 0;
    for (const ch of c.children) n += 1 + countDescendants(ch as Container);
    return n;
}

describe('SystemView: per-body display objects only while the system is drawn', () => {
    it('none at construction; ensureBodies builds them (in habitat order); releaseBodies destroys them', () => {
        const star = habitat(HabitatCategoryType.Star, { type: HabitatType.MainSequence, diameter: 1000 });
        const planet = habitat(HabitatCategoryType.Planet, { orbitDistance: 20000 });
        const moon = habitat(HabitatCategoryType.Moon, { parent: planet, orbitDistance: 2000 });
        const rock = habitat(HabitatCategoryType.Asteroid, { orbitDistance: 30000, diameter: 10 });
        const system = { systemStar: star, habitats: [star, planet, moon, rock] } as unknown as SystemInfo;
        const built = new Set<unknown>();
        const pictures: string[] = [];
        const view = {
            systemLayer: { add: () => undefined, set: () => undefined },
            bodiesBuilt: built,
            bodyPictures: (v: { habitat: Habitat }) => pictures.push(v.habitat === planet ? 'planet' : 'moon'),
            rockPicture: () => pictures.push('rock'),
        };
        const textures = { dots: new Map(), dot: Texture.WHITE, rock: Texture.WHITE, backdrop: Texture.WHITE };
        const sv = new SystemView(view as never, system, textures);
        const before = countDescendants(sv.root);
        // The data the pickers / fog / culling need is there without display objects.
        expect(sv.planetHabitats).toEqual([{ habitat: planet, moons: [moon] }]);
        expect(sv.rockHabitats).toEqual([rock]);
        expect(sv.drawRadius).toBeGreaterThanOrEqual(30010);
        expect(sv.planets.length).toBe(0);
        expect(sv.asteroids.length).toBe(0);
        expect(sv.bodiesBuilt).toBe(false);

        sv.ensureBodies(1000);
        expect(sv.bodiesBuilt).toBe(true);
        expect(built.has(sv)).toBe(true);
        expect(sv.planets.length).toBe(1);
        expect(sv.planets[0].moons.length).toBe(1);
        expect(sv.asteroids.length).toBe(1);
        expect(pictures).toEqual(['planet', 'moon', 'rock']);
        // Planet dot, sprite, label; moon dot, label; the rock — in habitat order — and the moon ring.
        expect(sv.bodies.children.length).toBe(6);
        expect(sv.bodies.children[5]).toBe(sv.asteroids[0]);
        // Again: nothing new, only the time.
        sv.ensureBodies(2000);
        expect(sv.bodiesNeededAt).toBe(2000);
        expect(sv.bodies.children.length).toBe(6);

        const sprite = sv.planets[0].sprite;
        sv.releaseBodies();
        expect(sv.bodiesBuilt).toBe(false);
        expect(built.has(sv)).toBe(false);
        expect(sv.planets.length).toBe(0);
        expect(sv.asteroids.length).toBe(0);
        expect(sv.bodies.children.length).toBe(0);
        expect(sprite.destroyed).toBe(true);
        expect(countDescendants(sv.root)).toBe(before);
    });
});
