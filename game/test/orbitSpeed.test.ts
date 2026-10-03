// Bug report: moons orbit far too fast with visible ~0.3s jumps of ~1/20 orbit each; planets appear not to orbit
// at all. Two independent root causes, both covered here:
//
// 1. Habitat.cs 924-935 OrbitDistance (and 986-998 OrbitSpeed) are C# PROPERTIES whose setters recompute
//    _AnglePerSecond from CalculateOrbitPathLength() / OrbitSpeed every time either is reassigned. Galaxy.5.cs 1689
//    constructs every moon with a PLACEHOLDER orbit distance (Rnd.Next(5, 32) — nothing to do with the real orbit),
//    then Galaxy.5.cs 1730 sets `habitat2.OrbitDistance = (short)num6;` to the real, much larger radius well after
//    construction — relying on the property setter to recompute _AnglePerSecond for the real radius. types.ts used
//    to expose orbitDistance/orbitSpeed as plain data fields, so that reassignment silently left _anglePerSecond
//    computed from the tiny placeholder radius applied to the real (much bigger) orbit — moons spun many times too
//    fast. Fixed by giving Habitat real accessor properties (orbitDistance / orbitSpeed) that recompute
//    _anglePerSecond exactly like the C# properties do.
//
// 2. Even with speeds correct, a habitat's committed orbitAngle only changes when the background round-robin tick
//    (scheduler.ts backgroundPass "GxHab", HABITAT_TICK_BATCH_SIZE habitats per sim frame) happens to reach it —
//    at big galaxy sizes that is seconds apart, so the committed angle jumps in big steps instead of advancing
//    smoothly. The original avoids this because Main.Part11.cs's camera LOD pass ticks every on-screen habitat
//    every rendered frame; our port makes that opt-in (`?simView=1`, off by default even in real play, for
//    command-log replay determinism — simLoop.ts). mainView.ts's renderOrbitAngle recovers smooth motion by
//    extrapolating from the last committed (orbitAngle, lastTouch) using the exact formula the next real touch will
//    apply, without writing back to sim state — covered in the second describe block below.
import { describe, expect, it } from 'vitest';
import { Habitat, HabitatCategoryType, HabitatType, GalaxyShape } from '../src/sim/types';
import { generateGalaxy } from '../src/sim/galaxy';
import type { GameData } from '../src/sim/data/gameData';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import { runGameSeconds } from '../src/sim/tick/harness';
import { renderOrbitAngle, habitatTouchClampSeconds } from '../src/render/mainView';
import { HABITAT_TICK_BATCH_SIZE, FRAMES_PER_SECOND } from '../src/sim/tick/scheduler';

describe('Habitat.orbitDistance / orbitSpeed recompute _anglePerSecond on reassignment (Habitat.cs 924-935 / 986-998)', () => {
    it('reassigning orbitDistance after construction updates anglePerSecond for the NEW distance', () => {
        const star = new Habitat(HabitatCategoryType.Star, HabitatType.MainSequence, 'S', 0, 0);
        // Mirrors Galaxy.5.cs 1689: ctor gets a placeholder orbit distance (here 20, inside the real Rnd.Next(5, 32)
        // range), orbit speed 6.
        const moon = new Habitat(HabitatCategoryType.Moon, HabitatType.Ice, 'M', star, 0, true, 20, 6, false);
        expect(moon.anglePerSecond).toBeCloseTo(6 / 20, 12); // orbitSpeed / orbitDistance = 2*pi / ((2*pi*d)/s)

        // Galaxy.5.cs 1730: habitat2.OrbitDistance = (short)num6 — the real orbit radius, set well after construction.
        moon.orbitDistance = 300;
        expect(moon.orbitDistance).toBe(300);
        expect(moon.anglePerSecond).toBeCloseTo(6 / 300, 12);

        // Observable behaviour, not just the internal getter: advancing 1 s moves the angle by the NEW rate.
        moon.advanceOrbit(1);
        expect(moon.orbitAngle).toBeCloseTo(6 / 300, 12);
    });

    it('reassigning orbitSpeed after construction also recomputes anglePerSecond', () => {
        const star = new Habitat(HabitatCategoryType.Star, HabitatType.MainSequence, 'S', 0, 0);
        const planet = new Habitat(HabitatCategoryType.Planet, HabitatType.Continental, 'P', star, 0, true, 5000, 3, false);
        expect(planet.anglePerSecond).toBeCloseTo(3 / 5000, 12);
        planet.orbitSpeed = 9;
        expect(planet.anglePerSecond).toBeCloseTo(9 / 5000, 12);
    });

    it('every generated moon has anglePerSecond consistent with its FINAL orbitDistance, not the construction-time placeholder', async () => {
        const gameData: GameData = await loadGameDataFs();
        const galaxy = generateGalaxy({ seed: 7, shape: GalaxyShape.Elliptical, starCount: 40, sectorWidth: 5, sectorHeight: 5, systemNames: [], gameData });
        const moons = galaxy.habitats.filter((h) => h.category === HabitatCategoryType.Moon);
        expect(moons.length).toBeGreaterThan(5);
        for (const m of moons) {
            // The bug: before the fix this was orbitSpeed / (a leftover Rnd.Next(5, 32) placeholder), which for the
            // real (>= 150) orbit distances generated for moons was many times too big.
            expect(m.anglePerSecond).toBeCloseTo(m.orbitSpeed / m.orbitDistance, 10);
            expect(m.orbitDistance).toBeGreaterThanOrEqual(150);
        }
    }, 60000);
});

describe('planet/moon orbitAngle advances over sim time (habitatTick.ts advanceOrbit); the renderer reads it live', () => {
    it("a planet's orbitAngle changes over 600 sim seconds, bounded by its own anglePerSecond (legitimately slow, not stuck)", async () => {
        const gameData: GameData = await loadGameDataFs();
        const galaxy = cachedTickGame(gameData).galaxy;
        const planet = galaxy.habitats.find((h) => h.category === HabitatCategoryType.Planet)!;
        expect(planet).toBeDefined();
        const angle0 = planet.orbitAngle;
        const perSecond = planet.anglePerSecond;
        runGameSeconds(galaxy, 600);
        const angle600 = planet.orbitAngle;
        expect(angle600).not.toBe(angle0);
        // Orbit period is typically years of game time (orbitSpeed 2-5 at thousands of distance units), so 600 s
        // moves it only a small fraction of a radian — bounded by anglePerSecond * 600, never more (advanceOrbit
        // never runs ahead of the true elapsed sim time).
        expect(Math.abs(angle600 - angle0)).toBeGreaterThan(0);
        expect(Math.abs(angle600 - angle0)).toBeLessThanOrEqual(perSecond * 600 + 1e-6);
    }, 120000);
});

describe('mainView.renderOrbitAngle (render-only orbit interpolation, no sim-state write)', () => {
    it('matches the committed angle exactly at zero elapsed time', () => {
        expect(renderOrbitAngle(1.2, 0.05, true, 1000, 1000, 10)).toBeCloseTo(1.2, 12);
    });

    it('extrapolates with the same formula Habitat.move() applies, forward and backward direction', () => {
        expect(renderOrbitAngle(0, 0.1, true, 0, 5000, 10)).toBeCloseTo(0.5, 12); // 5000 ms = 5 s elapsed
        expect(renderOrbitAngle(0, 0.1, false, 0, 5000, 10)).toBeCloseTo(-0.5, 12);
    });

    it('clamps extrapolation for a stale habitat (long-paused tab, huge galaxy) to clampSeconds', () => {
        expect(renderOrbitAngle(0, 0.1, true, 0, 1_000_000, 2)).toBeCloseTo(0.2, 12);
    });

    it('runs backward along the same orbit, clamped, when the presented instant is before lastTouch (PresentationClock delay)', () => {
        // 4 s before the touch at 0.1 rad/s: 0.7 − 0.4.
        expect(renderOrbitAngle(0.7, 0.1, true, 5000, 1000, 10)).toBeCloseTo(0.3, 12);
        // Clamped to clampSeconds (2 s back at most).
        expect(renderOrbitAngle(0.7, 0.1, true, 5000, 1000, 2)).toBeCloseTo(0.5, 12);
        // Counter-clockwise orbits run the other way.
        expect(renderOrbitAngle(0.7, 0.1, false, 5000, 1000, 10)).toBeCloseTo(1.1, 12);
    });

    it('is continuous with the real touch: interpolating right up to the moment of a touch matches what advanceOrbit would commit', () => {
        const star = new Habitat(HabitatCategoryType.Star, HabitatType.MainSequence, 'S', 0, 0);
        const moon = new Habitat(HabitatCategoryType.Moon, HabitatType.Ice, 'M', star, 0.3, true, 300, 6, false);
        const lastTouch = 10_000;
        moon.lastTouch = lastTouch;
        const nowMs = lastTouch + 4200;
        const interpolated = renderOrbitAngle(moon.orbitAngle, moon.anglePerSecond, moon.orbitDirection, moon.lastTouch, nowMs, 999);
        moon.advanceOrbit((nowMs - lastTouch) / 1000);
        expect(interpolated).toBeCloseTo(moon.orbitAngle, 9);
    });
});

describe('mainView.habitatTouchClampSeconds', () => {
    it('is zero for an empty galaxy and scales with habitat count / HABITAT_TICK_BATCH_SIZE at 4x game speed', () => {
        expect(habitatTouchClampSeconds(0)).toBe(0);
        const oneCycle = (HABITAT_TICK_BATCH_SIZE / HABITAT_TICK_BATCH_SIZE / FRAMES_PER_SECOND) * 4;
        expect(habitatTouchClampSeconds(HABITAT_TICK_BATCH_SIZE)).toBeCloseTo(oneCycle, 12);
        expect(habitatTouchClampSeconds(140_000)).toBeCloseTo((140_000 / HABITAT_TICK_BATCH_SIZE / FRAMES_PER_SECOND) * 4, 12);
    });
});
