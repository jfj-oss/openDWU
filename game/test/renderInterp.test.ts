// Render interpolation between fixed sim steps (src/render/renderInterp.ts): pure functions only, no Pixi, no sim
// state written.
import { describe, expect, it } from 'vitest';
import {
    MotionInterpolator,
    createRenderTime,
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
