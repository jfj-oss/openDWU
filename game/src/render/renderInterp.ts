// Render interpolation between fixed sim steps (render-only: nothing here writes sim state).
//
// The sim runs whole fixed steps of FRAME_REAL_MS real time (simLoop.ts SimFrameBudget, scheduler.ts SimDriver), so
// galaxy.nowMs and every object's xpos / ypos / heading only change when a step completes. At a render rate at or
// above the step rate — or when a slow frame runs several steps at once — anything drawn straight from that state
// stands still between steps and then jumps. This module supplies:
// - RenderTime: the fraction `alpha` of the next step already elapsed in real time (SimFrameBudget.backlogMs /
//   FRAME_REAL_MS) and the game-time instant to draw at, renderNowMs = galaxy.nowMs + alpha × stepGameMs, which the
//   orbit extrapolation (renderOrbitAngle) uses for planets, moons, asteroids and moon rings;
// - MotionInterpolator: per-object previous / current step positions (a WeakMap of reused records, allocated once
//   per object) drawn at lerp(prev, curr, alpha), snapping on teleports / hyperjump exits, on objects first seen or
//   not seen for a while, and on moves made outside a step. Objects parked relative to an orbiting habitat (ships
//   with a ParentHabitat offset, creatures holding station at a planet) are interpolated in the habitat's frame and
//   placed around the habitat's render-interpolated position, so they move with the drawn planet instead of with its
//   round-robin-committed xpos (which only changes when the background pass touches the habitat).

import { FRAME_REAL_MS, FRAMES_PER_SECOND, HABITAT_TICK_BATCH_SIZE } from '../sim/tick/scheduler';
import { spanSeconds } from '../sim/tick/simTime';

/** The render-time sample the main loop hands MainView each frame (one object, mutated in place). */
export interface RenderTime {
    /** Fraction of the next sim step already elapsed in real time, 0..1 (0 while paused). */
    alpha: number;
    /** Game ms one sim step advances at the current speed (SimDriver: nextFrameMs without its integer carry). */
    stepGameMs: number;
    /** galaxy.nowMs + alpha × stepGameMs: the game instant the frame is drawn at. */
    renderNowMs: number;
    /** Sim steps completed so far (cumulative): a change tells the interpolator a new step landed. */
    stepSerial: number;
}

export function createRenderTime(): RenderTime {
    return { alpha: 0, stepGameMs: 0, renderNowMs: 0, stepSerial: 0 };
}

/** Fraction into the next fixed step: backlogMs / FRAME_REAL_MS clamped to 0..1, and 0 while paused. */
export function simStepAlpha(backlogMs: number, paused: boolean): number {
    if (paused || !(backlogMs > 0)) return 0;
    const a = backlogMs / FRAME_REAL_MS;
    return a >= 1 ? 1 : a;
}

/** Game ms per sim step at `speed`: the mean of scheduler.ts nextFrameMs (floor((carry + 1000·speed) / 60)). */
export function stepGameMsAt(speed: number): number {
    return Math.round(speed * 1000) / FRAMES_PER_SECOND;
}

/** Fill `rt` for this render frame (no allocation). */
export function updateRenderTime(rt: RenderTime, nowMs: number, backlogMs: number, speed: number, paused: boolean, stepsRun: number): RenderTime {
    rt.alpha = simStepAlpha(backlogMs, paused);
    rt.stepGameMs = stepGameMsAt(speed);
    rt.renderNowMs = nowMs + rt.alpha * rt.stepGameMs;
    rt.stepSerial += stepsRun;
    return rt;
}

// Render-only orbit interpolation (no sim-state write). The original ticks every on-screen habitat's Move every
// single rendered frame (Main.Part11.cs 507/533 ProcessMain's camera LOD pass, always on), so what it draws is
// continuous. Our port makes that pass opt-in (`?simView=1`, simLoop.ts) and off by default even in real play — the
// camera isn't journaled, so turning it on would make command-log replay diverge — so a habitat's committed
// orbitAngle/xpos/ypos only change when the background round-robin (scheduler.ts backgroundPass "GxHab") happens to
// touch it, which is at most HABITAT_TICK_BATCH_SIZE habitats per sim frame: at big galaxy sizes each habitat is
// touched only once every ceil(habitats.length / HABITAT_TICK_BATCH_SIZE) sim frames, so its angle jumps by a big
// step (several degrees) instead of advancing smoothly — the reported "moons jump ~1/20 orbit every 0.3s". This
// recomputes the drawn angle from the last COMMITTED (orbitAngle, lastTouch) pair with the exact formula
// habitatTick.ts's `move()` will next apply, so the two never disagree and there is no snap when the real touch
// lands. `nowMs` is the instant drawn — RenderTime.renderNowMs (galaxy.nowMs plus the elapsed part of the next step),
// so the angle also advances between sim steps; nothing here is written back to the habitat.
export function renderOrbitAngle(orbitAngle: number, anglePerSecond: number, orbitDirection: boolean, lastTouch: number, nowMs: number, clampSeconds: number): number {
    const elapsed = Math.min(Math.max(spanSeconds(nowMs, lastTouch), 0), Math.max(clampSeconds, 0));
    return orbitDirection ? orbitAngle + anglePerSecond * elapsed : orbitAngle - anglePerSecond * elapsed;
}

// Safety bound (sim seconds) on renderOrbitAngle's extrapolation: one background-pass round-robin cycle
// (habitatCount / HABITAT_TICK_BATCH_SIZE sim frames — scheduler.ts backgroundPass) at the fastest game speed (4x,
// the documented top of Galaxy TimeSpeed). This is a generous upper bound on the real gap between touches at any
// speed, so it only bites for a habitat that has gone stranger-than-expected stale (a long-paused tab, a very large
// galaxy) — the common case never reaches it, since the real gap is normally much smaller.
export function habitatTouchClampSeconds(habitatCount: number): number {
    const MAX_GAME_SPEED = 4;
    const cycleFrames = Math.max(0, habitatCount) / HABITAT_TICK_BATCH_SIZE;
    return (cycleFrames / FRAMES_PER_SECOND) * MAX_GAME_SPEED;
}

/** The orbit fields renderHabitatPos reads (Habitat). */
export interface OrbitingBody {
    parent: OrbitingBody | null;
    xpos: number;
    ypos: number;
    orbitAngle: number;
    readonly anglePerSecond: number;
    orbitDirection: boolean;
    orbitDistance: number;
    lastTouch: number;
}

/** Scratch point (written by renderHabitatPos / MotionInterpolator; read before the next call). */
export interface Point {
    x: number;
    y: number;
}

/**
 * The drawn position of a habitat at `nowMs`: its parent's drawn position plus the render-interpolated orbit
 * (renderOrbitAngle) — the same placement mainView.ts SystemView.updateBodies gives planets, moons and asteroids
 * (a star, parent null, sits at its committed xpos / ypos). Writes `out` and returns it.
 */
export function renderHabitatPos(h: OrbitingBody, nowMs: number, clampSeconds: number, out: Point): Point {
    const p = h.parent;
    if (p === null) {
        out.x = h.xpos;
        out.y = h.ypos;
        return out;
    }
    renderHabitatPos(p, nowMs, clampSeconds, out);
    const a = renderOrbitAngle(h.orbitAngle, h.anglePerSecond, h.orbitDirection, h.lastTouch, nowMs, clampSeconds);
    out.x += Math.cos(a) * h.orbitDistance;
    out.y += Math.sin(a) * h.orbitDistance;
    return out;
}

const TWO_PI = Math.PI * 2;

/** a → b by t along the shorter arc (radians; the result is not normalised). */
export function lerpAngle(a: number, b: number, t: number): number {
    let d = (b - a) % TWO_PI;
    if (d > Math.PI) d -= TWO_PI;
    else if (d < -Math.PI) d += TWO_PI;
    return a + d * t;
}

/** A move of (dx, dy) over `steps` sim steps of `stepSeconds` game s is a jump (teleport / hyperjump exit) when it is
 * longer than SNAP_SPEED_FACTOR × maxSpeed × the time. */
export const SNAP_SPEED_FACTOR = 3;
/** Floor on the speed used by the snap test (world units / game s), so slow or speedless objects (bases, parked
 * ships carried by a moving parent) still interpolate ordinary motion. */
export const SNAP_MIN_SPEED = 600;
/** An object not sampled for more than this many steps (culled, hidden) snaps to its current position. */
export const MAX_INTERP_STEPS = 8;

export function isJump(dx: number, dy: number, steps: number, maxSpeed: number, stepSeconds: number): boolean {
    const limit = SNAP_SPEED_FACTOR * Math.max(maxSpeed, SNAP_MIN_SPEED) * stepSeconds * Math.max(1, steps);
    return dx * dx + dy * dy > limit * limit;
}

/** One object's interpolation record (reused every frame). */
export interface MotionState {
    /** Estimated position / heading one step before `c*` (in `frame` coordinates). */
    px: number;
    py: number;
    ph: number;
    /** The sim's position / heading after the latest step seen. */
    cx: number;
    cy: number;
    ch: number;
    /** The habitat whose frame px/py/cx/cy are in (null: galaxy coordinates). */
    frame: object | null;
    /** RenderTime.stepSerial when `c*` was taken. */
    serial: number;
    /** Render frame of the last sample (drawn* is valid for that frame only). */
    renderFrame: number;
    /** The drawn result: galaxy coordinates and heading. */
    x: number;
    y: number;
    heading: number;
}

/**
 * Per-object previous / current step state and the drawn lerp. Call begin() once per render frame, then sample()
 * each object as it is drawn; layers drawn later in the frame read the same result with drawn() so selection rings,
 * engine glows, liveries, lines, etc. stay on the drawn sprite. O(objects sampled); allocates one record per object
 * the first time it is seen (WeakMap: released with the object).
 */
export class MotionInterpolator {
    private states = new WeakMap<object, MotionState>();
    private renderFrame = 0;
    serial = 0;
    alpha = 0;
    stepSeconds = 0;
    renderNowMs = 0;
    clampSeconds = 0;
    /** Scratch origin for frame-relative samples. */
    private origin: Point = { x: 0, y: 0 };

    begin(rt: RenderTime, clampSeconds: number): void {
        this.renderFrame++;
        this.serial = rt.stepSerial;
        this.alpha = rt.alpha;
        this.stepSeconds = rt.stepGameMs / 1000;
        this.renderNowMs = rt.renderNowMs;
        this.clampSeconds = clampSeconds;
    }

    /**
     * Sample `obj` at sim position (x, y) / heading this frame: in galaxy coordinates when `frame` is null, else as an
     * offset from `frame` (whose drawn position is `originX, originY`). Returns the object's record with x / y /
     * heading set to the drawn values.
     */
    sample(obj: object, x: number, y: number, heading: number, maxSpeed: number, frame: object | null = null, originX = 0, originY = 0): MotionState {
        let st = this.states.get(obj);
        if (st === undefined) {
            st = { px: x, py: y, ph: heading, cx: x, cy: y, ch: heading, frame, serial: this.serial, renderFrame: 0, x, y, heading };
            this.states.set(obj, st);
        } else if (st.frame !== frame) {
            snapTo(st, x, y, heading);
            st.frame = frame;
        } else if (st.serial !== this.serial) {
            const k = this.serial - st.serial;
            if (k < 0 || k > MAX_INTERP_STEPS || isJump(x - st.cx, y - st.cy, k, maxSpeed, this.stepSeconds)) {
                snapTo(st, x, y, heading);
            } else {
                // Linear estimate of where the object was one step before now (k > 1: several steps landed since the
                // last sample; exact for straight-line motion).
                const t = (k - 1) / k;
                st.px = st.cx + (x - st.cx) * t;
                st.py = st.cy + (y - st.cy) * t;
                st.ph = lerpAngle(st.ch, heading, t);
                st.cx = x;
                st.cy = y;
                st.ch = heading;
            }
        } else if (x !== st.cx || y !== st.cy || heading !== st.ch) {
            // Moved without a sim step (an order applied at the frame boundary, a load, an edit): no interpolation.
            snapTo(st, x, y, heading);
        }
        st.serial = this.serial;
        st.renderFrame = this.renderFrame;
        const a = this.alpha;
        st.x = originX + st.px + (st.cx - st.px) * a;
        st.y = originY + st.py + (st.cy - st.py) * a;
        st.heading = lerpAngle(st.ph, st.ch, a);
        return st;
    }

    /** The record sampled for `obj` this render frame, or null (not drawn yet this frame: use its sim position). */
    drawn(obj: object): MotionState | null {
        const st = this.states.get(obj);
        return st !== undefined && st.renderFrame === this.renderFrame ? st : null;
    }

    /** The drawn position of a habitat this frame (renderHabitatPos at renderNowMs). The returned point is scratch. */
    habitatPos(h: OrbitingBody): Point {
        return renderHabitatPos(h, this.renderNowMs, this.clampSeconds, this.origin);
    }
}

function snapTo(st: MotionState, x: number, y: number, heading: number): void {
    st.px = st.cx = x;
    st.py = st.cy = y;
    st.ph = st.ch = heading;
}

/** BuiltObject fields read by sampleBuiltObject. */
export interface MovingBuiltObject {
    xpos: number;
    ypos: number;
    heading: number;
    topSpeed: number;
    warpSpeed: number;
    currentSpeed: number;
    parentHabitat: (OrbitingBody & { hasBeenDestroyed: boolean }) | null;
    parentOffsetX: number;
    parentOffsetY: number;
}

/** executeCommands.ts evaluateRelativeToParent: an offset at or below this is "unset". */
const PARENT_OFFSET_UNSET = -2000000001.0;
/** executeCommands.ts PARENT_RELATIVE_RANGE_SQUARED (700²) with slack: farther offsets are not drawn relative. */
const PARENT_FRAME_MAX_OFFSET_SQ = 1000 * 1000;
/** Most the committed xpos may differ from ParentHabitat.xpos + ParentOffset and still be drawn relative (the habitat
 * was touched by the round-robin after the ship's last move); beyond it the ship is not following the habitat. */
const PARENT_FRAME_MAX_DRIFT = 500;

/**
 * Sample a ship / base: relative to an orbiting ParentHabitat when the sim moves it by parent offset
 * (executeCommands.ts evaluateRelativeToParent: ParentHabitat set and ParentOffset set), else in galaxy coordinates.
 */
export function sampleBuiltObject(m: MotionInterpolator, bo: MovingBuiltObject): MotionState {
    const maxSpeed = Math.max(bo.topSpeed, bo.warpSpeed, Math.abs(bo.currentSpeed));
    const h = bo.parentHabitat;
    if (h !== null && h.parent !== null && !h.hasBeenDestroyed && bo.parentOffsetX > PARENT_OFFSET_UNSET && bo.parentOffsetY > PARENT_OFFSET_UNSET) {
        const ox = bo.parentOffsetX;
        const oy = bo.parentOffsetY;
        if (ox * ox + oy * oy <= PARENT_FRAME_MAX_OFFSET_SQ && Math.abs(bo.xpos - h.xpos - ox) <= PARENT_FRAME_MAX_DRIFT && Math.abs(bo.ypos - h.ypos - oy) <= PARENT_FRAME_MAX_DRIFT) {
            const o = m.habitatPos(h);
            return m.sample(bo, ox, oy, bo.heading, maxSpeed, h, o.x, o.y);
        }
    }
    return m.sample(bo, bo.xpos, bo.ypos, bo.heading, maxSpeed);
}

/** Creature fields read by sampleCreature. */
export interface MovingCreature {
    xpos: number;
    ypos: number;
    currentHeading: number;
    currentSpeed: number;
    movementSpeed: number;
    hyperSpeed: number;
    lungeSpeed: number;
    currentTarget: unknown;
    parentHabitat: (OrbitingBody & { hasBeenDestroyed: boolean }) | null;
    parentX: number;
    parentY: number;
}

/** Sample a creature: relative to its orbiting ParentHabitat while it holds station there (creature.ts move: no
 * CurrentTarget ⇒ xpos = ParentHabitat.xpos + parentX), else in galaxy coordinates. */
export function sampleCreature(m: MotionInterpolator, c: MovingCreature): MotionState {
    const maxSpeed = Math.max(Math.abs(c.currentSpeed), c.movementSpeed, c.hyperSpeed, c.lungeSpeed);
    const h = c.parentHabitat;
    if (h !== null && h.parent !== null && !h.hasBeenDestroyed && c.currentTarget === null) {
        const o = m.habitatPos(h);
        return m.sample(c, c.parentX, c.parentY, c.currentHeading, maxSpeed, h, o.x, o.y);
    }
    return m.sample(c, c.xpos, c.ypos, c.currentHeading, maxSpeed);
}
