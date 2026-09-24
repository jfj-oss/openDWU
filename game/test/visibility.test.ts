import { describe, expect, it } from 'vitest';
import { generateGalaxy, type Galaxy } from '../src/sim/galaxy';
import { GalaxyShape, HabitatCategoryType, type Habitat } from '../src/sim/types';
import {
    EmpireVisibility,
    GalaxyResourceMap,
    NULL_VISIBILITY_OWNER,
    SystemVisibilityStatus,
    countExploredSystems,
    determineGalaxyLocationsInRangeAtPoint,
    findNearestUnexploredHabitat,
    mergeGalaxyMap,
    setEmpireExplorationAmount,
    setSystemHabitatsExploration,
    type VisibilityOwner,
    type VisibilityUnit,
} from '../src/sim/visibility';
import { GalaxyLocationType } from '../src/sim/galaxyLocation';

// Task C1 — system visibility / fog of war.
const systemNames = Array.from({ length: 200 }, (_, i) => `S${i}`);
function makeGalaxy(): Galaxy {
    return generateGalaxy({ seed: 1, shape: GalaxyShape.Spiral, starCount: 200, sectorWidth: 6, sectorHeight: 6, systemNames });
}
// Star systems with at least one planet/moon (gas clouds are systems too, C2c-1).
function starSystemIdx(g: Galaxy, n: number): number {
    return g.systems.map((s, i) => [s, i] as const).filter(([s]) => s.systemStar.category === HabitatCategoryType.Star && g.systemHabitatsOf(s.systemStar.systemIndex).length > 0)[n][1];
}
function owner(over: Partial<VisibilityOwner>): VisibilityOwner {
    return { ...NULL_VISIBILITY_OWNER, ...over };
}

describe('GalaxyResourceMap', () => {
    it('sets, clears and merges bits', () => {
        const g = makeGalaxy();
        const a = new GalaxyResourceMap();
        const b = new GalaxyResourceMap();
        a.initializeFlags(20, g);
        b.initializeFlags(20, g);
        expect(a.resourcesKnown.length).toBe(3);
        a.setResourcesKnownRaw(9, true);
        expect(a.checkResourcesKnownRaw(9)).toBe(true);
        a.setResourcesKnownRaw(9, true); // idempotent (C# XOR only when changed)
        expect(a.checkResourcesKnownRaw(9)).toBe(true);
        b.setResourcesKnownRaw(3, true);
        a.mergeMap(b.resourcesKnown);
        expect(a.checkResourcesKnownRaw(3)).toBe(true);
        a.setResourcesKnownRaw(9, false);
        expect(a.checkResourcesKnownRaw(9)).toBe(false);
        const c = new GalaxyResourceMap();
        c.initializeFlags(100, g);
        expect(() => a.mergeMap(c.resourcesKnown)).toThrow();
    });
});

describe('EmpireVisibility', () => {
    it('starts with every system Unexplored', () => {
        const g = makeGalaxy();
        const v = new EmpireVisibility(g);
        expect(v.systemVisibility.length).toBe(g.systems.length);
        expect(v.systemVisibility.every((s) => s.status === SystemVisibilityStatus.Unexplored)).toBe(true);
        expect(countExploredSystems(v.systemVisibility)).toBe(0);
    });

    it('owned colony makes its system Visible; losing it drops to Explored', () => {
        const g = makeGalaxy();
        const sys = g.systems[starSystemIdx(g, 3)];
        const planet = g.systemHabitatsOf(starSystemIdx(g, 3))[0];
        let owns = true;
        const v = new EmpireVisibility(g, owner({ controlsHabitat: (h) => owns && h === planet }));
        v.resolveSystemVisibilityAt(planet.xpos, planet.ypos);
        expect(v.systemVisibility[starSystemIdx(g, 3)].status).toBe(SystemVisibilityStatus.Visible);
        expect(v.systemsVisible).toContain(sys.systemStar);
        expect(v.checkSystemVisible(starSystemIdx(g, 3))).toBe(true);
        owns = false;
        v.resolveSystemVisibilityAt(planet.xpos, planet.ypos);
        expect(v.systemVisibility[starSystemIdx(g, 3)].status).toBe(SystemVisibilityStatus.Explored);
        expect(v.systemsVisible).not.toContain(sys.systemStar);
        expect(v.checkSystemExplored(starSystemIdx(g, 3))).toBe(true);
        expect(v.checkSystemVisible(starSystemIdx(g, 3))).toBe(false);
    });

    it('excludeHabitat / excludeUnit are ignored when resolving', () => {
        const g = makeGalaxy();
        const star = g.systems[starSystemIdx(g, 4)].systemStar;
        const planet = g.systemHabitatsOf(starSystemIdx(g, 4))[0];
        const ship: VisibilityUnit = { xpos: star.xpos, ypos: star.ypos, nearestSystemStar: star };
        const v = new EmpireVisibility(g, owner({
            controlsHabitat: (h) => h === planet,
            hasUnitInSystem: (s, ex) => s === star && ex !== ship,
        }));
        expect(v.checkSystemVisibleExcluding(star, null, planet)).toBe(SystemVisibilityStatus.Visible); // ship
        expect(v.checkSystemVisibleExcluding(star, ship, planet)).toBe(SystemVisibilityStatus.Unexplored);
        v.resolveSystemVisibilityForUnit(ship, false);
        expect(v.systemVisibility[starSystemIdx(g, 4)].status).toBe(SystemVisibilityStatus.Visible);
    });

    it('far from any system: ResolveSystemVisibility(x, y) does nothing', () => {
        const g = makeGalaxy();
        const v = new EmpireVisibility(g, owner({ controlsHabitat: () => true }));
        // Find a point > MaxSolarSystemSize + 500 from every star.
        let p = { x: 0, y: 0 };
        for (let x = 0; x < g.sizeX; x += 50000) {
            for (let y = 0; y < g.sizeY; y += 50000) {
                const s = g.fastFindNearestSystem(x, y)!;
                if (g.calculateDistance(x, y, s.xpos, s.ypos) > 30000) p = { x, y };
            }
        }
        v.resolveSystemVisibilityAt(p.x, p.y);
        expect(countExploredSystems(v.systemVisibility)).toBe(0);
    });

    it('independent empire never resolves from units', () => {
        const g = makeGalaxy();
        const star = g.systems[2].systemStar;
        const v = new EmpireVisibility(g, owner({ isIndependent: true, hasUnitInSystem: () => true }));
        v.resolveSystemVisibilityForUnit({ xpos: 0, ypos: 0, nearestSystemStar: star }, false);
        expect(v.systemVisibility[2].status).toBe(SystemVisibilityStatus.Unexplored);
    });

    it('shared visibility: checks see the partner, and the map merges as Explored', () => {
        const g = makeGalaxy();
        const a = new EmpireVisibility(g);
        const b = new EmpireVisibility(g);
        a.setSystemVisibility(g.systems[1].systemStar, SystemVisibilityStatus.Visible);
        a.setSystemVisibility(g.systems[2].systemStar, SystemVisibilityStatus.Explored);
        a.resourceMap.setResourcesKnown(g.habitats[5], true);
        const contacts: number[] = [];
        b.setEmpireSharedVisibility(a, (_r, sys) => contacts.push(sys.systemStar.systemIndex));
        expect(b.checkSystemVisible(1)).toBe(true); // via partner
        expect(b.checkSystemVisibilityStatus(1)).toBe(SystemVisibilityStatus.Visible);
        expect(b.systemVisibility[1].status).toBe(SystemVisibilityStatus.Explored); // own copy merged
        expect(b.systemVisibility[2].status).toBe(SystemVisibilityStatus.Explored);
        expect(b.resourceMap.checkResourcesKnown(g.habitats[5])).toBe(true);
        expect(contacts).toEqual([1, 2]);
        b.clearEmpireSharedVisibility(a);
        expect(b.checkSystemVisible(1)).toBe(false);
        expect(b.checkSystemExplored(1)).toBe(true);
    });

    it('mergeGalaxyMap never downgrades the receiver', () => {
        const g = makeGalaxy();
        const a = new EmpireVisibility(g);
        const b = new EmpireVisibility(g);
        a.setSystemVisibility(g.systems[1].systemStar, SystemVisibilityStatus.Explored);
        b.setSystemVisibility(g.systems[1].systemStar, SystemVisibilityStatus.Visible);
        mergeGalaxyMap(g, a, b);
        expect(b.systemVisibility[1].status).toBe(SystemVisibilityStatus.Visible);
    });

    it('creature visibility needs IsVisible and a visible system or a scanner', () => {
        const g = makeGalaxy();
        const c = g.creatures.find((x) => x.nearestSystemStar !== null)!;
        const v = new EmpireVisibility(g);
        c.isVisible = true;
        expect(v.isCreatureVisible(c)).toBe(false);
        v.setSystemVisibility(c.nearestSystemStar!, SystemVisibilityStatus.Visible);
        expect(v.isCreatureVisible(c)).toBe(true);
        c.isVisible = false;
        expect(v.isCreatureVisible(c)).toBe(false);
        c.isVisible = true;
        const v2 = new EmpireVisibility(g, owner({ longRangeScanners: () => [{ xpos: c.xpos + 100, ypos: c.ypos, sensorLongRange: 150 }] }));
        expect(v2.isCreatureVisible(c)).toBe(true);
    });
});

describe('game-start exploration (SetEmpireExplorationAmount)', () => {
    it('explores the N systems nearest the capital, and knows every star', () => {
        const g = makeGalaxy();
        const v = new EmpireVisibility(g);
        const capital = g.systemHabitatsOf(starSystemIdx(g, 10)).find((h) => h.category === HabitatCategoryType.Planet) ?? g.systems[starSystemIdx(g, 10)].systemStar;
        setEmpireExplorationAmount(g, v, capital, 5);
        // 5 star systems explored; nearer gas clouds are also marked Explored
        // but don't count (C# j--).
        const byDist = [...g.systems].filter((s) => s.systemStar.category !== HabitatCategoryType.GasCloud).sort(
            (a, b) => g.calculateDistance(capital.xpos, capital.ypos, a.systemStar.xpos, a.systemStar.ypos) -
                g.calculateDistance(capital.xpos, capital.ypos, b.systemStar.xpos, b.systemStar.ypos),
        );
        for (const s of byDist.slice(0, 5)) {
            expect(v.systemVisibility[s.systemStar.systemIndex].status).toBe(SystemVisibilityStatus.Explored);
            for (const h of g.systemHabitatsOf(s.systemStar.systemIndex)) expect(v.resourceMap.checkResourcesKnown(h)).toBe(true);
        }
        // Galaxy.7.cs 4998: every top-level habitat except gas clouds becomes known.
        for (const s of g.systems) if (s.systemStar.category !== HabitatCategoryType.GasCloud) expect(v.resourceMap.checkResourcesKnown(s.systemStar)).toBe(true);
    });

    it('amount 0 explores nothing', () => {
        const g = makeGalaxy();
        const v = new EmpireVisibility(g);
        setEmpireExplorationAmount(g, v, g.systems[0].systemStar, 0);
        expect(countExploredSystems(v.systemVisibility)).toBe(0);
    });

    it('does not consume galaxy Rnd', () => {
        const g = makeGalaxy();
        const before = g.rnd.next(0, 1 << 30);
        const g2 = makeGalaxy();
        const v = new EmpireVisibility(g2);
        setEmpireExplorationAmount(g2, v, g2.systems[0].systemStar, 20);
        expect(g2.rnd.next(0, 1 << 30)).toBe(before);
    });

    it('findNearestUnexploredHabitat skips known habitats', () => {
        const g = makeGalaxy();
        const v = new EmpireVisibility(g);
        const star = g.systems[0].systemStar;
        expect(findNearestUnexploredHabitat(g, star.xpos, star.ypos, v, true)).toBe(star);
        v.resourceMap.setResourcesKnown(star, true);
        expect(findNearestUnexploredHabitat(g, star.xpos, star.ypos, v, true)).not.toBe(star);
    });

    it('setSystemHabitatsExploration only teaches empires that explored the system', () => {
        const g = makeGalaxy();
        const a = new EmpireVisibility(g);
        const b = new EmpireVisibility(g);
        const star = g.systems[starSystemIdx(g, 6)].systemStar;
        const hs: Habitat[] = g.systemHabitatsOf(starSystemIdx(g, 6));
        a.setSystemVisibility(star, SystemVisibilityStatus.Explored);
        setSystemHabitatsExploration([a, b], hs, star);
        for (const h of hs) {
            expect(a.resourceMap.checkResourcesKnown(h)).toBe(true);
            expect(b.resourceMap.checkResourcesKnown(h)).toBe(false);
        }
    });
});

describe('KnownGalaxyLocations discovery', () => {
    it('a ship next to a nebula learns it once', () => {
        const g = makeGalaxy();
        const loc = g.galaxyLocations.find((l) => l.type === GalaxyLocationType.NebulaCloud)!;
        const cx = loc.xpos + loc.width / 2;
        const cy = loc.ypos + loc.height / 2;
        expect(determineGalaxyLocationsInRangeAtPoint(g, cx, cy, 500, GalaxyLocationType.Undefined)).toContain(loc);
        const v = new EmpireVisibility(g);
        const ship = { xpos: cx, ypos: cy, nearestSystemStar: null, currentSpeed: 0, topSpeed: 100, sensorProximityArrayRange: 0, sensorLongRange: 0 };
        expect(v.discoverGalaxyLocations(ship)).toContain(loc);
        expect(v.discoverGalaxyLocations(ship)).not.toContain(loc);
        expect(v.knownGalaxyLocations).toContain(loc);
    });
});
