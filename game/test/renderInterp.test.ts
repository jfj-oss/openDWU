// Render interpolation between fixed sim steps (src/render/renderInterp.ts): pure functions only, no Pixi, no sim
// state written.
import { describe, expect, it } from 'vitest';
import {
    BUILT_OBJECT_TICK_BATCH_SIZE,
    MotionInterpolator,
    builtObjectTouchGapMs,
    createRenderTime,
    drawnBuiltObjectPos,
    drawnPositionOf,
    extrapolateUntouched,
    isOrbitingBody,
    sampleShot,
    type MovingShot,
    isJump,
    lerpAngle,
    renderHabitatPos,
    renderOrbitAngle,
    sampleBuiltObject,
    sampleCreature,
    simStepAlpha,
    stepGameMsAt,
    updateRenderTime,
    type MovingBuiltObject,
    type MovingCreature,
    type OrbitingBody,
    type RenderTime,
} from '../src/render/renderInterp';
import { SimFrameBudget, type SteppableDriver } from '../src/simLoop';
import { FRAME_REAL_MS } from '../src/sim/tick/scheduler';

describe('simStepAlpha / stepGameMsAt / updateRenderTime', () => {
    it('is the fraction of the next fixed step already owed, clamped to 0..1, and 0 while paused', () => {
        expect(simStepAlpha(0, false)).toBe(0);
        expect(simStepAlpha(FRAME_REAL_MS / 2, false)).toBeCloseTo(0.5, 12);
        expect(simStepAlpha(FRAME_REAL_MS * 0.25, false)).toBeCloseTo(0.25, 12);
        expect(simStepAlpha(FRAME_REAL_MS * 3, false)).toBe(1); // budget ran out: backlog of several steps
        expect(simStepAlpha(-5, false)).toBe(0);
        expect(simStepAlpha(Number.NaN, false)).toBe(0);
        expect(simStepAlpha(FRAME_REAL_MS / 2, true)).toBe(0);
    });

    it('game ms per step is 1000 × speed / 60 (the mean of nextFrameMs)', () => {
        expect(FRAME_REAL_MS).toBeCloseTo(16.667, 3);
        expect(stepGameMsAt(1)).toBeCloseTo(1000 / 60, 12);
        expect(stepGameMsAt(4)).toBeCloseTo(4000 / 60, 12);
        expect(stepGameMsAt(0.25)).toBeCloseTo(250 / 60, 12);
    });

    it('renderNowMs = nowMs + alpha × stepGameMs; stepSerial accumulates the steps run', () => {
        const rt = createRenderTime();
        updateRenderTime(rt, 10_000, FRAME_REAL_MS / 2, 4, false, 3);
        expect(rt.alpha).toBeCloseTo(0.5, 12);
        expect(rt.stepGameMs).toBeCloseTo(4000 / 60, 12);
        expect(rt.renderNowMs).toBeCloseTo(10_000 + 2000 / 60, 9);
        expect(rt.stepSerial).toBe(3);
        const same = updateRenderTime(rt, 10_000, FRAME_REAL_MS / 2, 4, true, 0);
        expect(same).toBe(rt); // mutated in place
        expect(rt.alpha).toBe(0);
        expect(rt.renderNowMs).toBe(10_000);
        expect(rt.stepSerial).toBe(3);
    });

    it('SimFrameBudget leaves the sub-step remainder as backlog: alpha follows real time between steps', () => {
        const budget = new SimFrameBudget(() => 0);
        let steps = 0;
        const driver: SteppableDriver = {
            maxFrames: 4,
            advance: () => {
                steps++;
                return 1;
            },
        };
        // 60 Hz render of a 60 Hz sim offset by 40 %: every frame runs one step and keeps 0.4 of the next.
        budget.run(driver, FRAME_REAL_MS * 1.4, 1, false);
        expect(steps).toBe(1);
        expect(simStepAlpha(budget.backlogMs, false)).toBeCloseTo(0.4, 9);
        // A 144 Hz render: no step this frame, alpha advances by 60/144.
        budget.run(driver, 1000 / 144, 1, false);
        expect(steps).toBe(1);
        expect(simStepAlpha(budget.backlogMs, false)).toBeCloseTo(0.4 + 60 / 144, 9);
        budget.run(driver, 1000 / 144, 1, true);
        expect(simStepAlpha(budget.backlogMs, true)).toBe(0);
    });
});

describe('renderOrbitAngle at renderNowMs', () => {
    it('advances the drawn angle between sim steps (galaxy.nowMs frozen, alpha rising)', () => {
        const rt = createRenderTime();
        const nowMs = 60_000;
        const angles: number[] = [];
        for (const a of [0, 0.25, 0.5, 0.75]) {
            updateRenderTime(rt, nowMs, a * FRAME_REAL_MS, 1, false, 0);
            angles.push(renderOrbitAngle(1, 0.3, true, 59_000, rt.renderNowMs, 100));
        }
        for (let i = 1; i < angles.length; i++) expect(angles[i]).toBeGreaterThan(angles[i - 1]);
        // At alpha 1 it meets the next step's committed extrapolation exactly.
        updateRenderTime(rt, nowMs, FRAME_REAL_MS, 1, false, 0);
        const atEnd = renderOrbitAngle(1, 0.3, true, 59_000, rt.renderNowMs, 100);
        expect(atEnd).toBeCloseTo(renderOrbitAngle(1, 0.3, true, 59_000, nowMs + 1000 / 60, 100), 12);
        // Clockwise orbits go the other way.
        expect(renderOrbitAngle(1, 0.3, false, 59_000, rt.renderNowMs, 100)).toBeLessThan(renderOrbitAngle(1, 0.3, false, 59_000, nowMs, 100));
    });

    it('renderHabitatPos chains parent orbits (moon around planet around star) like SystemView.updateBodies', () => {
        const star: OrbitingBody = { parent: null, xpos: 1000, ypos: 2000, orbitAngle: 0, anglePerSecond: 0, orbitDirection: true, orbitDistance: 0, lastTouch: 0 };
        const planet: OrbitingBody = { parent: star, xpos: 0, ypos: 0, orbitAngle: 0, anglePerSecond: Math.PI / 2, orbitDirection: true, orbitDistance: 100, lastTouch: 0 };
        const moon: OrbitingBody = { parent: planet, xpos: 0, ypos: 0, orbitAngle: Math.PI, anglePerSecond: 0, orbitDirection: true, orbitDistance: 10, lastTouch: 0 };
        const out = { x: 0, y: 0 };
        renderHabitatPos(moon, 1000, 100, out); // planet a quarter turn on (π/2 after 1 s)
        expect(out.x).toBeCloseTo(1000 + 0 - 10, 9);
        expect(out.y).toBeCloseTo(2000 + 100, 9);
        expect(renderHabitatPos(star, 1000, 100, out)).toEqual({ x: 1000, y: 2000 });
    });
});

describe('lerpAngle', () => {
    it('interpolates along the shorter arc', () => {
        expect(lerpAngle(0, 1, 0.5)).toBeCloseTo(0.5, 12);
        // 350° → 10°: through 0°, not back through 180°.
        const a = (350 * Math.PI) / 180;
        const b = (10 * Math.PI) / 180;
        const mid = lerpAngle(a, b, 0.5);
        expect(Math.cos(mid)).toBeCloseTo(1, 9);
        expect(Math.sin(mid)).toBeCloseTo(0, 9);
        expect(lerpAngle(-3, 3, 0)).toBe(-3);
        const end = lerpAngle(-3, 3, 1);
        expect(Math.cos(end)).toBeCloseTo(Math.cos(3), 9);
        expect(Math.sin(end)).toBeCloseTo(Math.sin(3), 9);
    });
});

describe('MotionInterpolator (lerp with snap)', () => {
    function frame(m: MotionInterpolator, rt: RenderTime, alpha: number, stepsRun: number): void {
        rt.alpha = alpha;
        rt.stepGameMs = 1000 / 60;
        rt.stepSerial += stepsRun;
        m.begin(rt, 10);
    }

    it('draws a new object at its sim position, then lerps prev → curr by alpha after each step', () => {
        const m = new MotionInterpolator();
        const rt = createRenderTime();
        const obj = {};
        frame(m, rt, 0.3, 0);
        let st = m.sample(obj, 100, 0, 0, 600);
        expect(st.x).toBe(100); // first sight: snapped
        frame(m, rt, 0, 1);
        st = m.sample(obj, 105, 0, 0, 600);
        expect(st.x).toBeCloseTo(100, 12);
        frame(m, rt, 0.5, 0); // no step this frame: same pair, alpha moved on
        st = m.sample(obj, 105, 0, 0, 600);
        expect(st.x).toBeCloseTo(102.5, 12);
        frame(m, rt, 0.99, 0);
        expect(m.sample(obj, 105, 0, 0, 600).x).toBeCloseTo(104.95, 9);
        // Next step: continuous across the step boundary (alpha wraps to ~0 as curr becomes prev).
        frame(m, rt, 0.01, 1);
        expect(m.sample(obj, 110, 0, 0, 600).x).toBeCloseTo(105.05, 9);
    });

    it('with several steps in one render frame, prev is the linear estimate one step back', () => {
        const m = new MotionInterpolator();
        const rt = createRenderTime();
        const obj = {};
        frame(m, rt, 0, 0);
        m.sample(obj, 0, 0, 0, 600);
        frame(m, rt, 0.5, 4); // four steps of 2 units each landed
        const st = m.sample(obj, 8, 0, 0, 600);
        expect(st.px).toBeCloseTo(6, 12);
        expect(st.x).toBeCloseTo(7, 12);
    });

    it('snaps on a teleport / hyperjump exit (> 3 × max speed × step time)', () => {
        expect(isJump(29, 0, 1, 600, 1 / 60)).toBe(false);
        expect(isJump(31, 0, 1, 600, 1 / 60)).toBe(true);
        expect(isJump(31, 0, 2, 600, 1 / 60)).toBe(false); // two steps allow twice the distance
        expect(isJump(1000, 0, 1, 30_000, 1 / 60)).toBe(false); // warp speed
        const m = new MotionInterpolator();
        const rt = createRenderTime();
        const ship = {};
        frame(m, rt, 0, 0);
        m.sample(ship, 0, 0, 0, 100);
        frame(m, rt, 0.5, 1);
        const st = m.sample(ship, 50_000, 0, 1, 100);
        expect(st.x).toBe(50_000);
        expect(st.heading).toBe(1);
    });

    it('snaps after a long gap (culled / hidden) and on a move made without a step', () => {
        const m = new MotionInterpolator();
        const rt = createRenderTime();
        const obj = {};
        frame(m, rt, 0, 0);
        m.sample(obj, 0, 0, 0, 600);
        frame(m, rt, 0.5, 20); // not sampled for 20 steps
        expect(m.sample(obj, 100, 0, 0, 600).x).toBe(100);
        frame(m, rt, 0.5, 0); // no step, but the sim position changed (order at the frame boundary)
        expect(m.sample(obj, 104, 0, 0, 600).x).toBe(104);
    });

    it('interpolates heading along the shortest arc', () => {
        const m = new MotionInterpolator();
        const rt = createRenderTime();
        const obj = {};
        frame(m, rt, 0, 0);
        m.sample(obj, 0, 0, Math.PI - 0.1, 600);
        frame(m, rt, 0.5, 1);
        const st = m.sample(obj, 1, 0, -Math.PI + 0.1, 600);
        expect(Math.cos(st.heading)).toBeCloseTo(-1, 9);
    });

    it('drawn() returns this frame\'s sample only', () => {
        const m = new MotionInterpolator();
        const rt = createRenderTime();
        const obj = {};
        frame(m, rt, 0, 0);
        expect(m.drawn(obj)).toBeNull();
        m.sample(obj, 3, 4, 0, 600);
        expect(m.drawn(obj)?.x).toBe(3);
        frame(m, rt, 0, 0);
        expect(m.drawn(obj)).toBeNull();
    });

    it('a ship parked at an orbiting planet is drawn at the planet\'s render position plus its lerped offset', () => {
        const star: OrbitingBody & { hasBeenDestroyed: boolean } = { parent: null, xpos: 0, ypos: 0, orbitAngle: 0, anglePerSecond: 0, orbitDirection: true, orbitDistance: 0, lastTouch: 0, hasBeenDestroyed: false };
        const planet = { parent: star, xpos: 1000, ypos: 0, orbitAngle: 0, anglePerSecond: 0.01, orbitDirection: true, orbitDistance: 1000, lastTouch: 0, hasBeenDestroyed: false };
        const bo: MovingBuiltObject = { xpos: 1050, ypos: 0, heading: 0, topSpeed: 0, warpSpeed: 0, currentSpeed: 0, parentHabitat: planet, parentOffsetX: 50, parentOffsetY: 0 };
        const m = new MotionInterpolator();
        const rt = createRenderTime();
        rt.stepGameMs = 1000 / 60;
        rt.renderNowMs = 5000; // planet 5 s past its committed touch: drawn 0.05 rad further on
        m.begin(rt, 100);
        const st = sampleBuiltObject(m, bo);
        expect(st.x).toBeCloseTo(Math.cos(0.05) * 1000 + 50, 9);
        expect(st.y).toBeCloseTo(Math.sin(0.05) * 1000, 9);
        // Unset offset: galaxy coordinates.
        const free: MovingBuiltObject = { ...bo, parentOffsetX: -2000000001.0, parentOffsetY: -2000000001.0 };
        const st2 = sampleBuiltObject(m, free);
        expect(st2.x).toBe(1050);
        // A creature holding station (no target) at the planet likewise.
        const c: MovingCreature = { xpos: 1020, ypos: 0, currentHeading: 0, currentSpeed: 0, movementSpeed: 30, hyperSpeed: 0, lungeSpeed: 0, currentTarget: null, parentHabitat: planet, parentX: 20, parentY: 0 };
        expect(sampleCreature(m, c).x).toBeCloseTo(Math.cos(0.05) * 1000 + 20, 9);
        // Nothing written back to the sim objects.
        expect(bo.xpos).toBe(1050);
        expect(planet.xpos).toBe(1000);
        expect(c.xpos).toBe(1020);
    });
});

describe('interpolation gaps: shots, untouched ships, drawn positions', () => {
    function frame(m: MotionInterpolator, rt: RenderTime, alpha: number, stepsRun: number, count = 0): void {
        rt.alpha = alpha;
        rt.stepGameMs = 1000 / 60;
        rt.stepSerial += stepsRun;
        rt.simNowMs += stepsRun * rt.stepGameMs;
        m.begin(rt, 10, count);
    }

    it('sampleShot: snaps on spawn, lerps in flight, snaps again when the weapon record fires a new shot', () => {
        const m = new MotionInterpolator();
        const rt = createRenderTime();
        const w: MovingShot = { x: 0, y: 0, heading: 0, speed: 1200, lastFired: 1000 };
        frame(m, rt, 0.5, 0);
        expect(sampleShot(m, w).x).toBe(0); // spawn: at the launch point
        w.x = 20;
        frame(m, rt, 0.5, 1);
        expect(sampleShot(m, w).x).toBeCloseTo(10, 12); // in flight: halfway between the steps
        // The same record fires again from a point only 5 units away: a new LastFired snaps (no lerp back).
        w.x = 15;
        w.lastFired = 2000;
        frame(m, rt, 0.5, 1);
        expect(sampleShot(m, w).x).toBe(15);
        // Impact: the shot snaps onto a far target (isJump at its speed).
        w.x = 50_000;
        frame(m, rt, 0.5, 1);
        expect(sampleShot(m, w).x).toBe(50_000);
    });

    it('builtObjectTouchGapMs: one round-robin of the background pass plus a step', () => {
        expect(BUILT_OBJECT_TICK_BATCH_SIZE).toBe(1000);
        expect(builtObjectTouchGapMs(500, 1000 / 60)).toBeCloseTo((2 * 1000) / 60, 9);
        expect(builtObjectTouchGapMs(4500, 1000 / 60)).toBeCloseTo((6 * 1000) / 60, 9);
        expect(builtObjectTouchGapMs(4500, 0)).toBeCloseTo((6 * 1000) / 60, 9); // no loop: 1x step
    });

    it('extrapolateUntouched carries a moving object along its heading from LastTouch, clamped, never stopped / fresh ones', () => {
        const out = { x: 0, y: 0 };
        extrapolateUntouched(100, 0, 0, 600, 1000, 1100, 1000, out);
        expect(out.x).toBeCloseTo(160, 9);
        extrapolateUntouched(0, 0, Math.PI / 2, 600, 1000, 1100, 1000, out);
        expect(out.y).toBeCloseTo(60, 9);
        extrapolateUntouched(100, 0, 0, 600, 1000, 5000, 200, out);
        expect(out.x).toBeCloseTo(220, 9); // clamped to 200 ms
        extrapolateUntouched(100, 0, 0, 600, 1100, 1100, 1000, out);
        expect(out.x).toBe(100); // touched this step
        extrapolateUntouched(100, 0, 0, 0, 1000, 1100, 1000, out);
        expect(out.x).toBe(100); // stopped
        extrapolateUntouched(100, 0, 0, 600, -(2 ** 52), 1100, 1000, out);
        expect(out.x).toBe(100); // never touched
    });

    it('a ship touched only every 4th step glides at a constant per-frame rate (no stand-still then jump)', () => {
        const m = new MotionInterpolator();
        const rt = createRenderTime();
        const speed = 300; // units / s
        const step = 1000 / 60;
        const bo: MovingBuiltObject = { xpos: 0, ypos: 0, heading: 0, topSpeed: speed, warpSpeed: 0, currentSpeed: speed, parentHabitat: null, parentOffsetX: -2000000001.0, parentOffsetY: -2000000001.0, lastTouch: 0 };
        const xs: number[] = [];
        for (let s = 0; s < 40; s++) {
            if (s > 0 && s % 4 === 0) {
                // The background pass touches it: the whole elapsed span is applied at once.
                const now = s * step;
                bo.xpos += (speed * (now - (bo.lastTouch ?? 0))) / 1000;
                bo.lastTouch = now;
            }
            for (const a of [0, 0.25, 0.5, 0.75]) {
                frame(m, rt, a, a === 0 && s > 0 ? 1 : 0, 4000);
                xs.push(sampleBuiltObject(m, bo).x);
            }
        }
        const perFrame = (speed * step) / 1000 / 4;
        for (let i = 9; i < xs.length; i++) {
            expect(Math.abs(xs[i] - xs[i - 1])).toBeLessThanOrEqual(perFrame * 1.5 + 1e-9);
            expect(xs[i] - xs[i - 1]).toBeGreaterThan(0);
        }
        expect(bo.xpos).toBeCloseTo((speed * 36 * step) / 1000, 6); // nothing written back
    });

    it('positionOf / drawnPositionOf: this frame\'s sample, else a habitat\'s interpolated orbit, else the sim position', () => {
        const star = { parent: null, xpos: 0, ypos: 0, orbitAngle: 0, anglePerSecond: 0, orbitDirection: true, orbitDistance: 0, lastTouch: 0 };
        const planet = { parent: star, xpos: 1000, ypos: 0, orbitAngle: 0, anglePerSecond: 0.01, orbitDirection: true, orbitDistance: 1000, lastTouch: 0 };
        expect(isOrbitingBody(planet)).toBe(true);
        expect(isOrbitingBody({ xpos: 1, ypos: 2 })).toBe(false);
        const m = new MotionInterpolator();
        const rt = createRenderTime();
        rt.renderNowMs = 5000;
        m.begin(rt, 100);
        const out = { x: 0, y: 0 };
        drawnPositionOf(m, planet, out);
        expect(out.x).toBeCloseTo(Math.cos(0.05) * 1000, 9);
        const ship = { xpos: 7, ypos: 8 };
        expect(drawnPositionOf(m, ship, out)).toEqual({ x: 7, y: 8 });
        m.sample(ship, 9, 10, 0, 600);
        ship.xpos = 9;
        expect(drawnPositionOf(m, ship, out)).toEqual({ x: 9, y: 10 });
        expect(drawnPositionOf(null, planet, out)).toEqual({ x: 1000, y: 0 });
    });

    it('drawnBuiltObjectPos samples a ship the ship layer did not draw (galaxy-zoom markers)', () => {
        const m = new MotionInterpolator();
        const rt = createRenderTime();
        const bo: MovingBuiltObject = { xpos: 0, ypos: 0, heading: 0, topSpeed: 600, warpSpeed: 0, currentSpeed: 0, parentHabitat: null, parentOffsetX: -2000000001.0, parentOffsetY: -2000000001.0 };
        frame(m, rt, 0, 0);
        expect(m.drawn(bo)).toBeNull();
        drawnBuiltObjectPos(m, bo);
        bo.xpos = 10;
        frame(m, rt, 0.5, 1);
        expect(drawnBuiltObjectPos(m, bo).x).toBeCloseTo(5, 12);
        expect(m.drawn(bo)?.x).toBeCloseTo(5, 12);
    });
});

describe('parent chains and frame changes', () => {
    const UNSET = -2000000001.0;
    function frame(m: MotionInterpolator, rt: RenderTime, alpha: number, stepsRun: number, renderNowMs: number): void {
        rt.alpha = alpha;
        rt.stepGameMs = 1000 / 60;
        rt.stepSerial += stepsRun;
        rt.renderNowMs = renderNowMs;
        m.begin(rt, 1000);
    }

    it('a ship docked at a base parked at an orbiting planet is drawn around the drawn base (ship → base → planet)', () => {
        const star = { parent: null, xpos: 0, ypos: 0, orbitAngle: 0, anglePerSecond: 0, orbitDirection: true, orbitDistance: 0, lastTouch: 0, hasBeenDestroyed: false };
        const planet = { parent: star, xpos: 1000, ypos: 0, orbitAngle: 0, anglePerSecond: 0.01, orbitDirection: true, orbitDistance: 1000, lastTouch: 0, hasBeenDestroyed: false };
        const base: MovingBuiltObject = { xpos: 1100, ypos: 0, heading: 0, topSpeed: 0, warpSpeed: 0, currentSpeed: 0, parentHabitat: planet, parentOffsetX: 100, parentOffsetY: 0, dockedAt: null, parentBuiltObject: null, hasBeenDestroyed: false };
        const ship: MovingBuiltObject = { xpos: 1120, ypos: 5, heading: 0, topSpeed: 20, warpSpeed: 0, currentSpeed: 0, parentHabitat: null, parentOffsetX: 20, parentOffsetY: 5, dockedAt: base, parentBuiltObject: base, hasBeenDestroyed: false };
        const m = new MotionInterpolator();
        const rt = createRenderTime();
        // 5 s after the planet's committed touch: planet drawn 0.05 rad on, the base with it, the ship with the base,
        // while both committed xpos still sit where the planet was.
        frame(m, rt, 0, 0, 5000);
        const st = sampleBuiltObject(m, ship);
        expect(st.frame).toBe(base);
        expect(st.x).toBeCloseTo(Math.cos(0.05) * 1000 + 120, 9);
        expect(st.y).toBeCloseTo(Math.sin(0.05) * 1000 + 5, 9);
        // The base was sampled on the way (its own record, in the planet's frame).
        expect(m.drawn(base)?.x).toBeCloseTo(Math.cos(0.05) * 1000 + 100, 9);
        // The round-robin now touches the planet and the base: committed positions jump to the orbit; the drawn ship
        // does not move with that jump (the planet's drawn orbit already had it there).
        planet.orbitAngle = 0.05;
        planet.lastTouch = 5000;
        planet.xpos = Math.cos(0.05) * 1000;
        planet.ypos = Math.sin(0.05) * 1000;
        base.xpos = planet.xpos + 100;
        base.ypos = planet.ypos;
        ship.xpos = base.xpos + 20;
        ship.ypos = base.ypos + 5;
        frame(m, rt, 0, 1, 5000);
        const st2 = sampleBuiltObject(m, ship);
        expect(st2.x).toBeCloseTo(st.x, 9);
        expect(st2.y).toBeCloseTo(st.y, 9);
        // Nothing written back.
        expect(ship.parentOffsetX).toBe(20);
    });

    it('a docked ship whose committed position is not dock + offset is drawn in galaxy coordinates', () => {
        const base: MovingBuiltObject = { xpos: 0, ypos: 0, heading: 0, topSpeed: 0, warpSpeed: 0, currentSpeed: 0, parentHabitat: null, parentOffsetX: UNSET, parentOffsetY: UNSET, dockedAt: null, parentBuiltObject: null };
        const ship: MovingBuiltObject = { xpos: 5000, ypos: 0, heading: 0, topSpeed: 20, warpSpeed: 0, currentSpeed: 0, parentHabitat: null, parentOffsetX: 20, parentOffsetY: 0, dockedAt: base, parentBuiltObject: null };
        const m = new MotionInterpolator();
        frame(m, createRenderTime(), 0, 0, 0);
        const st = sampleBuiltObject(m, ship);
        expect(st.frame).toBeNull();
        expect(st.x).toBe(5000);
    });

    it('entering / leaving a parent frame blends over one step instead of snapping', () => {
        const star = { parent: null, xpos: 0, ypos: 0, orbitAngle: 0, anglePerSecond: 0, orbitDirection: true, orbitDistance: 0, lastTouch: 0, hasBeenDestroyed: false };
        // A planet whose drawn position runs 2 units ahead of its committed one (orbit extrapolated past its touch).
        const planet = { parent: star, xpos: 1000, ypos: 0, orbitAngle: 0, anglePerSecond: 0.002, orbitDirection: true, orbitDistance: 1000, lastTouch: 0, hasBeenDestroyed: false };
        const now = 1000; // 1 s: 0.002 rad ≈ 2 units along the orbit
        const ship: MovingBuiltObject = { xpos: 1060, ypos: -10, heading: Math.PI / 2, topSpeed: 60, warpSpeed: 0, currentSpeed: 0, parentHabitat: planet, parentOffsetX: UNSET, parentOffsetY: UNSET };
        const m = new MotionInterpolator();
        const rt = createRenderTime();
        const drawn: number[][] = [];
        const draw = (steps: number, alpha: number): void => {
            frame(m, rt, alpha, steps, now);
            const st = sampleBuiltObject(m, ship);
            drawn.push([st.x, st.y]);
        };
        // Two steps flying in galaxy coordinates (+1 unit / step in y).
        draw(0, 0);
        for (const a of [0.25, 0.5, 0.75]) draw(0, a);
        ship.ypos += 1;
        draw(1, 0);
        for (const a of [0.25, 0.5, 0.75]) draw(0, a);
        // Parks: the sim now moves it by offset from the planet's committed position.
        ship.ypos += 1;
        ship.parentOffsetX = ship.xpos - planet.xpos;
        ship.parentOffsetY = ship.ypos - planet.ypos;
        draw(1, 0);
        const inFrame = m.drawn(ship)!;
        expect(inFrame.frame).toBe(planet);
        for (const a of [0.25, 0.5, 0.75]) draw(0, a);
        ship.parentOffsetY += 1;
        ship.ypos += 1;
        draw(1, 0);
        for (const a of [0.25, 0.5, 0.75]) draw(0, a);
        // Leaves again.
        ship.parentOffsetX = UNSET;
        ship.parentOffsetY = UNSET;
        ship.ypos += 1;
        draw(1, 0);
        expect(m.drawn(ship)!.frame).toBeNull();
        for (const a of [0.25, 0.5, 0.75]) draw(0, a);
        ship.ypos += 1;
        draw(1, 0);
        // Every frame moves: no snap (a jump of the planet's ~2-unit drawn / committed gap in one frame) and no still frame.
        const moves = drawn.slice(1).map((p, i) => Math.hypot(p[0] - drawn[i][0], p[1] - drawn[i][1]));
        for (const d of moves.slice(4)) {
            expect(d).toBeGreaterThan(0.05);
            expect(d).toBeLessThan(1.0);
        }
    });
});
