import { describe, expect, it } from 'vitest';
import { generateGalaxy, type Galaxy } from '../src/sim/galaxy';
import { Creature, CreatureType } from '../src/sim/creature';
import { GalaxyShape, HabitatCategoryType } from '../src/sim/types';

// Task 08h — Creature ctor (Creature.cs 297-491) and movement/AI tick.
const systemNames = Array.from({ length: 200 }, (_, i) => `S${i}`);
function makeGalaxy(seed = 12345): Galaxy {
    return generateGalaxy({ seed, shape: GalaxyShape.Spiral, starCount: 400, sectorWidth: 8, sectorHeight: 8, systemNames });
}

describe('Creature ctor (task 08h)', () => {
    it('per-species stats follow the C# switch', () => {
        const g = makeGalaxy();
        expect(g.creatures.length).toBeGreaterThan(0);
        for (const c of g.creatures) {
            switch (c.type) {
                case CreatureType.Kaltor:
                    expect(c.size).toBeGreaterThanOrEqual(80);
                    expect(c.size).toBeLessThan(190);
                    expect(c.movementSpeed).toBe(34);
                    expect(c.pictureRef).toBe(2);
                    expect(c.name.startsWith('Giant Kaltor of ')).toBe(true);
                    break;
                case CreatureType.RockSpaceSlug:
                    // 120-179, or the giant roll 300-399 (GenerateCreatureAtHabitat).
                    expect((c.size >= 120 && c.size < 180) || (c.size >= 300 && c.size < 400)).toBe(true);
                    expect(c.canHide).toBe(true);
                    expect(c.pictureRef).toBe(0);
                    break;
                case CreatureType.DesertSpaceSlug:
                    expect(c.size).toBeGreaterThanOrEqual(150);
                    expect(c.size).toBeLessThan(220);
                    expect(c.maxSize).toBe(550);
                    expect(c.pictureRef).toBe(1);
                    expect(c.name.startsWith('Sand Slug of ')).toBe(true);
                    break;
                case CreatureType.Ardilus:
                    expect(c.hyperSpeed).toBe(10000);
                    expect(c.pictureRef).toBe(3);
                    break;
            }
            expect(c.creatureId).toBeGreaterThan(0);
            expect(c.parentHabitat).toBe(c.anchorHabitat);
        }
        const ids = new Set(g.creatures.map((c) => c.creatureId));
        expect(ids.size).toBe(g.creatures.length);
    });

    it('RockSpaceSlug on an asteroid is named after the asteroid field', () => {
        const g = makeGalaxy();
        const asteroid = g.habitats.find((h) => h.category === HabitatCategoryType.Asteroid)!;
        const c = new Creature(g, CreatureType.RockSpaceSlug, asteroid);
        expect(c.name).toBe(`Space Slug of ${g.determineHabitatSystemStar(asteroid).name} Asteroid Field`);
        expect(c.anchorRange).toBe(400);
    });
});

describe('Creature movement tick (task 08h)', () => {
    it('creatures move when the galaxy steps and stay in bounds', () => {
        const g = makeGalaxy();
        const start = g.creatures.map((c) => [c.xpos, c.ypos]);
        for (let i = 0; i < 600; i++) g.step(1000); // 10 game minutes
        const moved = g.creatures.slice(0, start.length).filter((c, i) => c.xpos !== start[i][0] || c.ypos !== start[i][1]);
        expect(moved.length).toBeGreaterThan(0);
        for (const c of g.creatures) {
            expect(Number.isFinite(c.xpos) && Number.isFinite(c.ypos)).toBe(true);
            expect(c.xpos).toBeGreaterThan(-g.sizeX * 0.1);
            expect(c.xpos).toBeLessThan(g.sizeX * 1.1);
            expect(c.ypos).toBeGreaterThan(-g.sizeY * 0.1);
            expect(c.ypos).toBeLessThan(g.sizeY * 1.1);
        }
    });

    it('is deterministic', () => {
        const run = () => {
            const g = makeGalaxy(99);
            for (let i = 0; i < 200; i++) g.step(1000);
            return JSON.stringify(g.creatures.map((c) => [c.creatureId, Math.round(c.xpos), Math.round(c.ypos), c.isVisible]));
        };
        expect(run()).toBe(run());
    });

    it('SilverMist splits when large enough', () => {
        const g = makeGalaxy();
        const planet = g.habitats.find((h) => h.category === HabitatCategoryType.Planet)!;
        const mist = new Creature(g, CreatureType.SilverMist, planet);
        g.creatures.push(mist);
        mist.size = 1000; // > Rnd.Next(400, 550)
        const before = g.creatures.length;
        mist.split();
        expect(g.creatures.length).toBe(before + 1);
        expect(mist.size).toBe(500);
        expect(g.creatures[g.creatures.length - 1].size).toBe(500);
        expect(g.silverMistCreatureCount).toBe(1);
    });

    it('Kaltor reproduces 1-2 young after its counter passes 100', () => {
        const g = makeGalaxy();
        g.creatures = [];
        const cloud = g.habitats.find((h) => h.category === HabitatCategoryType.Planet)!;
        const k = new Creature(g, CreatureType.Kaltor, cloud);
        k.nearestSystemStar = g.determineHabitatSystemStar(cloud);
        g.creatures.push(k);
        k.reproduce(1001); // counter += 100.1
        expect(g.creatures.length).toBeGreaterThanOrEqual(2);
        expect(g.creatures.length).toBeLessThanOrEqual(3);
        expect(k.reproductionCounter).toBe(0);
    });
});
