import { describe, expect, it } from 'vitest';
import { generateGalaxy } from '../src/sim/galaxy';
import { Random } from '../src/sim/random';
import { GalaxyShape, HabitatCategoryType, HabitatType, type Habitat } from '../src/sim/types';

// Task C2c-1 — GalaxyIndex grids, sorted system order, ring search.
const g = generateGalaxy({ seed: 3, shape: GalaxyShape.Spiral, starCount: 400, sectorWidth: 8, sectorHeight: 8, systemNames: Array.from({ length: 400 }, (_, i) => `S${i}`) });

describe('habitat/system order and index grids', () => {
    it('systems are sorted by first-habitat name (ICU collation) and include gas clouds', () => {
        const c = new Intl.Collator('en-US');
        for (let i = 1; i < g.systems.length; i++) {
            expect(c.compare(g.systems[i - 1].systemStar.name, g.systems[i].systemStar.name)).toBeLessThanOrEqual(0);
        }
        expect(g.systems.some((s) => s.systemStar.category === HabitatCategoryType.GasCloud)).toBe(true);
        g.habitats.forEach((h, i) => expect(h.habitatIndex).toBe(i));
        for (const s of g.systems) for (const h of s.habitats) expect(g.systems[h.systemIndex]).toBe(s);
    });

    it('every habitat sits in its system star cell; every system in SystemsIndex', () => {
        let count = 0;
        for (let x = 0; x < g.indexMaxX; x++) for (let y = 0; y < g.indexMaxY; y++) count += g.habitatIndexGrid[x][y].length;
        expect(count).toBe(g.habitats.length);
        for (const s of g.systems) {
            const c = g.resolveIndex(s.systemStar.xpos, s.systemStar.ypos);
            expect(g.systemsIndexGrid[c.x][c.y]).toContain(s);
            for (const h of s.habitats) expect(g.habitatIndexGrid[c.x][c.y]).toContain(h);
        }
    });
});

describe('ring search', () => {
    const rnd = new Random(77);
    const pts = Array.from({ length: 150 }, () => ({ x: rnd.nextDouble() * g.sizeX, y: rnd.nextDouble() * g.sizeY }));
    const d2 = (h: Habitat, p: { x: number; y: number }) => (h.xpos - Math.trunc(p.x)) ** 2 + (h.ypos - Math.trunc(p.y)) ** 2;

    it('fastFindNearestSystem finds the nearest star/gas-cloud system', () => {
        for (const p of pts) {
            const got = g.fastFindNearestSystem(p.x, p.y)!;
            const best = Math.min(...g.systems.map((s) => d2(s.systemStar, p)));
            expect(d2(got, p)).toBe(best);
        }
    });

    it('findNearestUncolonizedHabitat finds the nearest planet/moon of the type', () => {
        for (const p of pts) {
            const got = g.findNearestUncolonizedHabitat(p.x, p.y, HabitatType.Ocean);
            const cands = g.habitats.filter((h) => (h.category === HabitatCategoryType.Planet || h.category === HabitatCategoryType.Moon) && h.type === HabitatType.Ocean);
            const best = Math.min(...cands.map((h) => d2(h, p)));
            expect(got).not.toBeNull();
            expect(d2(got!, p)).toBe(best);
        }
    });

    it('fastFindNearestPlanetMoonOfTypesUnoccupiedSystem draws one Rnd per visited system with planets and is deterministic', () => {
        const run = () => {
            const g2 = generateGalaxy({ seed: 3, shape: GalaxyShape.Spiral, starCount: 400, sectorWidth: 8, sectorHeight: 8, systemNames: Array.from({ length: 400 }, (_, i) => `S${i}`) });
            const h = g2.fastFindNearestPlanetMoonOfTypesUnoccupiedSystem(g2.sizeX / 2, g2.sizeY / 2, null, [HabitatType.Desert]);
            return [h?.name, g2.rnd.next(0, 1 << 30)];
        };
        const a = run();
        expect(a[0]).toBeDefined();
        expect(run()).toEqual(a);
    });
});
