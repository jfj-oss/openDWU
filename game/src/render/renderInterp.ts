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
//   round-robin-committed xpos (which only changes when the background pass touches the habitat). Ships docked at or
//   parked by a base are likewise drawn around the drawn base (ship → base → planet), and a change of frame carries the
//   previous / current step positions into the new frame instead of snapping.

import { FRAME_REAL_MS, FRAMES_PER_SECOND, HABITAT_TICK_BATCH_SIZE } from '../sim/tick/scheduler';
import { MIN_TIME, spanSeconds } from '../sim/tick/simTime';

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
    /** galaxy.nowMs: the game instant of the committed (latest step's) state. */
    simNowMs: number;
}

export function createRenderTime(): RenderTime {
    return { alpha: 0, stepGameMs: 0, renderNowMs: 0, stepSerial: 0, simNowMs: 0 };
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
    rt.simNowMs = nowMs;
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
    /** The habitat / parent built object whose frame px/py/cx/cy are in (null: galaxy coordinates). */
    frame: object | null;
    /** The frame's drawn origin at the last sample (galaxy coordinates; 0, 0 for the galaxy frame): converts px/py/cx/cy
     * into a new frame when the object changes frames. */
    ox: number;
    oy: number;
    /** RenderTime.stepSerial when `c*` was taken. */
    serial: number;
    /** Caller's identity of the object's current life (a shot's LastFired): a change snaps (a new shot spawns). */
    epoch: number;
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
    /** galaxy.nowMs of the committed state (RenderTime.simNowMs). */
    simNowMs = 0;
    clampSeconds = 0;
    /** Longest a built object's position is extrapolated past its LastTouch (builtObjectTouchGapMs). */
    untouchedMaxMs = 0;
    /** Scratch origin for frame-relative samples. */
    private origin: Point = { x: 0, y: 0 };
    /** Scratch for positionOf. */
    private posScratch: Point = { x: 0, y: 0 };

    /** `builtObjectCount`: galaxy.builtObjects.length, which sets how long a ship may go untouched by the background
     * pass (sampleBuiltObject's extrapolation bound). */
    begin(rt: RenderTime, clampSeconds: number, builtObjectCount = 0): void {
        this.renderFrame++;
        this.serial = rt.stepSerial;
        this.alpha = rt.alpha;
        this.stepSeconds = rt.stepGameMs / 1000;
        this.renderNowMs = rt.renderNowMs;
        this.simNowMs = rt.simNowMs;
        this.clampSeconds = clampSeconds;
        this.untouchedMaxMs = builtObjectTouchGapMs(builtObjectCount, rt.stepGameMs);
    }

    /**
     * Sample `obj` at sim position (x, y) / heading this frame: in galaxy coordinates when `frame` is null, else as an
     * offset from `frame` (whose drawn position is `originX, originY`). Returns the object's record with x / y /
     * heading set to the drawn values.
     */
    sample(obj: object, x: number, y: number, heading: number, maxSpeed: number, frame: object | null = null, originX = 0, originY = 0, epoch = 0): MotionState {
        let st = this.states.get(obj);
        if (st === undefined) {
            st = { px: x, py: y, ph: heading, cx: x, cy: y, ch: heading, frame, ox: originX, oy: originY, serial: this.serial, epoch, renderFrame: 0, x, y, heading };
            this.states.set(obj, st);
        } else if (st.epoch !== epoch) {
            snapTo(st, x, y, heading);
            st.frame = frame;
            st.epoch = epoch;
        } else {
            if (st.frame !== frame) {
                // Entering / leaving a parent's frame (parking at or leaving a planet, docking at a base): carry the
                // previous / current step positions over into the new frame (through galaxy coordinates, at the old
                // frame's last drawn origin) and go on lerping, so the drawn object neither jumps nor stands still for
                // a step. The step logic below still snaps a real jump (isJump) or a move made without a step.
                const dx = st.ox - originX;
                const dy = st.oy - originY;
                st.px += dx;
                st.py += dy;
                st.cx += dx;
                st.cy += dy;
                st.frame = frame;
            }
            this.advance(st, x, y, heading, maxSpeed);
        }
        st.ox = originX;
        st.oy = originY;
        st.serial = this.serial;
        st.renderFrame = this.renderFrame;
        const a = this.alpha;
        st.x = originX + st.px + (st.cx - st.px) * a;
        st.y = originY + st.py + (st.cy - st.py) * a;
        st.heading = lerpAngle(st.ph, st.ch, a);
        return st;
    }

    /** Take the sim's (x, y, heading) into `st` (same frame): a new step shifts curr → prev and lerps on, snapping on a
     * jump, a long gap or a move made without a step. */
    private advance(st: MotionState, x: number, y: number, heading: number, maxSpeed: number): void {
        if (st.serial !== this.serial) {
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

    /**
     * Where `o` is drawn this frame, for layers that decorate an object they do not draw themselves (leader lines,
     * league pennants, pick tests): its sample this frame when one was taken (ship, fighter, creature, shot), else the
     * render-interpolated orbit for a habitat (anything with an orbit: renderHabitatPos), else its committed
     * xpos / ypos. The returned point is scratch (read it before the next call).
     */
    positionOf(o: { xpos: number; ypos: number }): Point {
        const out = this.posScratch;
        const d = this.drawn(o);
        if (d !== null) {
            out.x = d.x;
            out.y = d.y;
        } else if (isOrbitingBody(o)) {
            const p = this.habitatPos(o);
            out.x = p.x;
            out.y = p.y;
        } else {
            out.x = o.xpos;
            out.y = o.ypos;
        }
        return out;
    }
}

/** Whether `o` carries the orbit fields renderHabitatPos reads (a Habitat). */
export function isOrbitingBody(o: object): o is OrbitingBody {
    const h = o as Partial<OrbitingBody>;
    return typeof h.orbitAngle === 'number' && typeof h.orbitDistance === 'number' && typeof h.lastTouch === 'number' && h.parent !== undefined;
}

/** Drawn position of `o` when an interpolator is running, else its committed position (writes and returns `out`). */
export function drawnPositionOf(m: MotionInterpolator | null, o: { xpos: number; ypos: number }, out: Point): Point {
    if (m === null) {
        out.x = o.xpos;
        out.y = o.ypos;
        return out;
    }
    const p = m.positionOf(o);
    out.x = p.x;
    out.y = p.y;
    return out;
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
    /** BuiltObject._LastTouch (game ms): the instant xpos / ypos were last advanced by a DoTasks move. */
    lastTouch?: number;
    /** BuiltObject.DockedAt (a base / ship or a habitat): a docked object sits at DockedAt + ParentOffset. */
    dockedAt?: object | null;
    /** BuiltObject.ParentBuiltObject: an object near a base is moved at ParentBuiltObject + ParentOffset. */
    parentBuiltObject?: MovingBuiltObject | null;
    hasBeenDestroyed?: boolean;
}

/** scheduler.ts backgroundPass "GxBO" int_43: built objects the background round-robin ticks per sim frame (multi-core
 * budget). With more objects than this, each one is touched only every ceil(count / 1000) steps. */
export const BUILT_OBJECT_TICK_BATCH_SIZE = 1000;

/**
 * Longest (game ms) a built object's drawn position is extrapolated past its LastTouch: one full background round-robin
 * (ceil(count / BUILT_OBJECT_TICK_BATCH_SIZE) steps) plus one step of slack. `stepGameMs` 0 (no sim loop) counts as
 * one step at 1x speed.
 */
export function builtObjectTouchGapMs(builtObjectCount: number, stepGameMs: number): number {
    const steps = Math.max(1, Math.ceil(Math.max(0, builtObjectCount) / BUILT_OBJECT_TICK_BATCH_SIZE)) + 1;
    return steps * (stepGameMs > 0 ? stepGameMs : 1000 / FRAMES_PER_SECOND);
}

/**
 * Where a built object the background pass has not touched since `lastTouch` would be at `nowMs`: the committed
 * position carried on along its heading at CurrentSpeed for the elapsed time (at most `maxMs`) — exactly the step
 * executeCommands.ts (BuiltObject.2.cs 4553-4560) applies when the object is next touched, if heading and speed hold.
 * Objects touched this step (lastTouch = nowMs), stopped or never touched stay at their committed position. Writes
 * `out` and returns it. Render-only: nothing is written to the object.
 */
export function extrapolateUntouched(xpos: number, ypos: number, heading: number, currentSpeed: number, lastTouch: number, nowMs: number, maxMs: number, out: Point): Point {
    out.x = xpos;
    out.y = ypos;
    if (!(currentSpeed > 0) || !(maxMs > 0) || lastTouch <= MIN_TIME) return out;
    const dt = nowMs - lastTouch;
    if (!(dt > 0) || !Number.isFinite(dt)) return out;
    const d = (currentSpeed * Math.min(dt, maxMs)) / 1000;
    out.x += Math.cos(heading) * d;
    out.y += Math.sin(heading) * d;
    return out;
}

const extrapScratch: Point = { x: 0, y: 0 };

/** executeCommands.ts evaluateRelativeToParent: an offset at or below this is "unset". */
const PARENT_OFFSET_UNSET = -2000000001.0;
/** Most the committed xpos may differ from ParentHabitat.xpos + ParentOffset and still be drawn relative (the habitat
 * was touched by the round-robin after the ship's last move); beyond it the ship is not following the habitat. */
const PARENT_FRAME_MAX_DRIFT = 500;

/**
 * Sample a ship / base: relative to its parent when the sim places it by parent offset (executeCommands.ts 413-444:
 * DockedAt, else an orbiting ParentHabitat, else a ParentBuiltObject — each + ParentOffset), drawn around that parent's
 * drawn position (a base's own sample, which may itself sit around its planet's interpolated orbit), else in galaxy
 * coordinates —
 * there, a moving object the background pass has not touched this step (large galaxies: more than 1000 built objects)
 * is sampled at its extrapolated position (extrapolateUntouched), so it glides between touches instead of standing
 * still and then jumping; the next touch lands where the extrapolation was heading, and the usual snap rules
 * (isJump, MAX_INTERP_STEPS) still apply to the extrapolated positions.
 */
export function sampleBuiltObject(m: MotionInterpolator, bo: MovingBuiltObject, depth = 0): MotionState {
    const maxSpeed = Math.max(bo.topSpeed, bo.warpSpeed, Math.abs(bo.currentSpeed));
    if (bo.parentOffsetX > PARENT_OFFSET_UNSET && bo.parentOffsetY > PARENT_OFFSET_UNSET) {
        const ox = bo.parentOffsetX;
        const oy = bo.parentOffsetY;
        // The sim's order (executeCommands.ts 413-444): relative to ParentBuiltObject, then ParentHabitat overrides it,
        // then DockedAt overrides both. Each is used only while the committed position really is parent + offset.
        const dock = bo.dockedAt ?? null;
        if (dock !== null && followsParent(bo, dock, ox, oy)) {
            if (isOrbitingBody(dock)) {
                if (dock.parent !== null) {
                    const o = m.habitatPos(dock);
                    return m.sample(bo, ox, oy, bo.heading, maxSpeed, dock, o.x, o.y);
                }
            } else if (isParentBuiltObject(bo, dock) && depth < MAX_PARENT_DEPTH) {
                return sampleInBuiltObjectFrame(m, bo, dock, ox, oy, maxSpeed, depth);
            }
        }
        const h = bo.parentHabitat;
        if (h !== null && h.parent !== null && !h.hasBeenDestroyed && followsParent(bo, h, ox, oy)) {
            const o = m.habitatPos(h);
            return m.sample(bo, ox, oy, bo.heading, maxSpeed, h, o.x, o.y);
        }
        const pb = bo.parentBuiltObject ?? null;
        if (pb !== null && isParentBuiltObject(bo, pb) && depth < MAX_PARENT_DEPTH && followsParent(bo, pb, ox, oy)) {
            return sampleInBuiltObjectFrame(m, bo, pb, ox, oy, maxSpeed, depth);
        }
    }
    if (bo.lastTouch !== undefined && bo.currentSpeed > 0) {
        const p = extrapolateUntouched(bo.xpos, bo.ypos, bo.heading, bo.currentSpeed, bo.lastTouch, m.simNowMs, m.untouchedMaxMs, extrapScratch);
        return m.sample(bo, p.x, p.y, bo.heading, maxSpeed);
    }
    return m.sample(bo, bo.xpos, bo.ypos, bo.heading, maxSpeed);
}

/** Longest parent chain followed (ship → base → …); the planet at the end is placed by renderHabitatPos. */
const MAX_PARENT_DEPTH = 3;

/** Whether `bo`'s committed position is its parent's committed position plus the offset (within the drift bound). The
 * offset's length does not matter: once a parent and an offset are set, the sim keeps moving the ship by offset from
 * the parent at any distance (executeCommands.ts evaluateRelativeToParent: no range test on a set offset; movement.ts
 * moveToward: xpos = parent + ParentOffset) — a ship dropping out of hyperspace ~1300 units from its target planet, or
 * flying on past the planet it was parked at. Its committed galaxy position then jumps with the planet's round-robin
 * touches, so drawing it in galaxy coordinates beyond some offset cap (formerly 1000) shook it once per touch cycle
 * until the offset came back under the cap; drawn around the planet's interpolated orbit it is smooth at any offset. */
function followsParent(bo: MovingBuiltObject, parent: object, ox: number, oy: number): boolean {
    const p = parent as { xpos: number; ypos: number };
    return Math.abs(bo.xpos - p.xpos - ox) <= PARENT_FRAME_MAX_DRIFT && Math.abs(bo.ypos - p.ypos - oy) <= PARENT_FRAME_MAX_DRIFT;
}

/** A live parent built object that is not itself parked on `bo` (evaluateRelativeToParent's cycle test). */
function isParentBuiltObject(bo: MovingBuiltObject, p: object): p is MovingBuiltObject {
    const pb = p as MovingBuiltObject;
    if (typeof pb.parentOffsetX !== 'number' || pb.hasBeenDestroyed === true) return false;
    return pb.dockedAt !== bo && pb.parentBuiltObject !== bo;
}

/**
 * `bo` drawn at its offset from the drawn parent built object (itself sampled first: a base parked at an orbiting
 * planet is drawn around the planet's interpolated orbit), so a ship docked at / parked by a base moves with the drawn
 * base instead of with its round-robin-committed xpos.
 */
function sampleInBuiltObjectFrame(m: MotionInterpolator, bo: MovingBuiltObject, parent: MovingBuiltObject, ox: number, oy: number, maxSpeed: number, depth: number): MotionState {
    const d = m.drawn(parent) ?? sampleBuiltObject(m, parent, depth + 1);
    const px = d.x;
    const py = d.y;
    return m.sample(bo, ox, oy, bo.heading, maxSpeed, parent, px, py);
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

/** Weapon / FighterWeapon fields read by sampleShot. */
export interface MovingShot {
    x: number;
    y: number;
    heading: number;
    readonly speed: number;
    /** LastFired (game ms): a new value is a new shot, which snaps to its launch point. */
    lastFired: number;
}

/**
 * Sample a shot in flight (torpedo, missile, bolt, area ring centre): its (x, y) lerped between the last two steps like
 * a ship's, snapping on spawn (first sight, or a new LastFired: the weapon's record is reused shot after shot) and on
 * a jump (isJump at the shot's speed: the impact snap to the target, a reset). Galaxy coordinates.
 */
export function sampleShot(m: MotionInterpolator, w: MovingShot): MotionState {
    return m.sample(w, w.x, w.y, w.heading, w.speed, null, 0, 0, w.lastFired);
}

/**
 * A built object's drawn position this frame: its sample when BuiltObjectLayer drew it, else a sample taken now
 * (sampleBuiltObject: galaxy / sector zoom markers, where the ship art is not drawn), so symbols, fleet icons and their
 * pick boxes move smoothly too. The returned record is the object's own (read it before the object is sampled again).
 */
export function drawnBuiltObjectPos(m: MotionInterpolator, bo: MovingBuiltObject): { x: number; y: number } {
    return m.drawn(bo) ?? sampleBuiltObject(m, bo);
}
