import { beforeAll, describe, expect, it } from 'vitest';
import { setGovernmentsStatic } from '../src/sim/empire';
import type { GameData } from '../src/sim/data/gameData';
import { generateGalaxy, generationHabitatDoTasks } from '../src/sim/galaxy';
import { GalaxyShape, Habitat, HabitatCategoryType, HabitatType } from '../src/sim/types';
import { MIN_TIME } from '../src/sim/tick/simTime';
import { loadGameDataFs } from './helpers/loadGameDataFs';

// Sweep 2: Habitat.DoTasks(galaxy.CurrentDateTime) on every generated planet / moon (Galaxy.8.cs 215-551, Galaxy.5.cs
// 1587 / 1731; Habitat.cs 1399).
let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
    setGovernmentsStatic(gameData.governments);
}, 60000);

const small = () => generateGalaxy({ seed: 7, shape: GalaxyShape.Elliptical, starCount: 20, sectorWidth: 4, sectorHeight: 4, systemNames: [], gameData });

describe('generation Habitat.DoTasks', () => {
    it('Habitat ctor with doInitialMove: LastTouch = now − 30 s (Habitat.cs 6297-6303)', () => {
        const star = new Habitat(HabitatCategoryType.Star, HabitatType.MainSequence, 'S', 1000, 2000);
        expect(star.lastTouch).toBe(0);
        const p = new Habitat(HabitatCategoryType.Planet, HabitatType.Continental, 'P', star, 0.5, true, 5000, 3);
        expect(p.lastTouch).toBe(-30000);
        expect(p.lastIntermediateTouch).toBe(MIN_TIME);
    });

    it('runs Move(30 s) and only the intermediate block, drawing no Galaxy.Rnd', () => {
        const galaxy = small();
        const star = galaxy.habitats.find((h) => h.parent === null && h.category === HabitatCategoryType.Star)!;
        const p = new Habitat(HabitatCategoryType.Planet, HabitatType.Continental, 'P', star, 0.5, true, 5000, 3);
        const angle0 = p.orbitAngle; // after the ctor's Move(30)
        const perSecond = (Math.PI * 2.0) / ((Math.PI * 5000 * 2.0) / 3);
        const before = galaxy.rnd.getState();
        generationHabitatDoTasks(galaxy, p);
        const probe = galaxy.rnd.next(0, 1000000);
        galaxy.rnd.setState(before);
        expect(galaxy.rnd.next(0, 1000000)).toBe(probe);
        expect(p.orbitAngle).toBeCloseTo(angle0 + perSecond * 30, 12);
        expect(p.xpos).toBeCloseTo(star.xpos + Math.cos(p.orbitAngle) * 5000, 6);
        expect(p.lastTouch).toBe(0);
        expect(p.lastIntermediateTouch).toBe(0);
        expect(p.lastPeriodicTouch).toBe(0);
        expect(p.lastLongTouch).toBe(0);
        expect(p.lastHugeTouch).toBe(0);
    });

    it('every generated planet and moon has been through DoTasks; asteroids / gas clouds have not', () => {
        const galaxy = small();
        const planets = galaxy.habitats.filter((h) => h.category === HabitatCategoryType.Planet || h.category === HabitatCategoryType.Moon);
        expect(planets.length).toBeGreaterThan(20);
        for (const h of planets) {
            expect(h.lastIntermediateTouch).toBe(0);
            expect(h.lastTouch).toBe(0);
        }
        const asteroids = galaxy.habitats.filter((h) => h.category === HabitatCategoryType.Asteroid);
        expect(asteroids.every((h) => h.lastIntermediateTouch === MIN_TIME)).toBe(true);
    });
});
