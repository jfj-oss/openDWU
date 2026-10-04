// Render interpolation between fixed sim steps (render-only: nothing here writes sim state).
//
// The sim runs whole fixed steps of FRAME_REAL_MS real time (simLoop.ts SimFrameBudget, scheduler.ts SimDriver), so
// galaxy.nowMs and every object's xpos / ypos / heading only change when a step completes. At a render rate at or
// above the step rate — or when a slow frame runs several steps at once — anything drawn straight from that state
// stands still between steps and then jumps. This module supplies:
// - RenderTime: the fraction `alpha` of the next step already elapsed in real time (SimFrameBudget.backlogMs /
//   FRAME_REAL_MS) and the game-time instant to draw at, renderNowMs = galaxy.nowMs + alpha × stepGameMs, which the
//   orbit extrapolation (renderOrbitAngle) uses for planets, moons, asteroids and moon rings;
// - PresentationClock: turns that raw render time into an evenly advancing drawn instant (renderSerial) when steps land
//   unevenly — a late game whose step costs more than its frame, sim worker bursts — with a small adaptive delay
//   (about 0 when the sim keeps up);
// - MotionInterpolator: per-object step samples (the last few, in a WeakMap of reused records allocated once per
//   object) drawn between the two that bracket the drawn instant, snapping on teleports / hyperjump exits, on objects first seen or
//   not seen for a while, and on moves made outside a step. Objects parked relative to an orbiting habitat (ships
//   with a ParentHabitat offset, creatures holding station at a planet) are interpolated in the habitat's frame and
//   placed around the habitat's render-interpolated position, so they move with the drawn planet instead of with its
//   round-robin-committed xpos (which only changes when the background pass touches the habitat). Ships docked at or
//   parked by a base are likewise drawn around the drawn base (ship → base → planet), and a change of frame carries the
//   previous / current step positions into the new frame instead of snapping.
// - Objects the background round-robin moves only every few steps — ships in galaxies over 1000 built objects, their
//   fighters and shots (moved in their carrier / firer's DoTasks), habitat-fired shots, creatures (50 a step) — are
//   sampled where their next touch will put them (extrapolated from their LastTouch), so they glide instead of moving in
//   bursts. A fighter's extrapolation is kept on its out-of-view leash, a fighter on the leash is drawn round the drawn
//   carrier, and its position reset by the leash is eased out (soft snap) instead of popping.
// - Headings likewise: CalculateCurrentHeading turns an object by its turn rate × the whole time since its last touch,
//   so a ship the round-robin touches every ~11 steps held its heading and then swung by the whole turn. A ship the sim
//   turned at its latest touch is sampled at the heading its next touch turns it to (toward TargetHeading at
//   GetCurrentTurnRate: turnedAtLastTouch, untouchedHeading) and moved along it, as DoMovement moves it; fighters and
//   creatures turn the same way in extrapolateMover (turnHeading, the creature's unwrapped difference included). A heading
//   the next touch disagrees with (a turn begun or re-aimed there, a command that stops turning) is eased at
//   HEADING_EASE_FACTOR × the turn rate instead of turned in one step (MotionInterpolator.sample `turnLimit`).

import { FRAME_REAL_MS, FRAMES_PER_SECOND, HABITAT_TICK_BATCH_SIZE } from '../sim/tick/scheduler';
import { MIN_TIME, spanSeconds } from '../sim/tick/simTime';
import { BuiltObjectRole } from '../sim/data/designSpecifications';
import { MOVEMENT_IMPULSE_SPEED } from '../sim/movement';
import { captainBonuses } from '../sim/characters';
import type { BuiltObject } from '../sim/builtObject';

/** The render-time sample the main loop hands MainView each frame (one object, mutated in place). */
export interface RenderTime {
    /** Fraction of the next sim step already elapsed in real time, 0..1 (0 while paused). */
    alpha: number;
    /** Game ms one sim step advances at the current speed (SimDriver: nextFrameMs without its integer carry). */
    stepGameMs: number;
    /** galaxy.nowMs + alpha × stepGameMs: the game instant the frame is drawn at (presented: see PresentationClock). */
    renderNowMs: number;
    /** Sim steps completed so far (cumulative): a change tells the interpolator a new step landed. */
    stepSerial: number;
    /** galaxy.nowMs: the game instant of the committed (latest step's) state. */
    simNowMs: number;
    /** Whether the clock is paused (the loop's pause, or the sim worker's optimistic pause hold). */
    paused: boolean;
    /**
     * The presented instant in step units (cumulative serial, fractional): objects are drawn between the samples that
     * bracket it (MotionInterpolator). NaN: not presented — stepSerial − 1 + alpha, the latest two steps lerped by alpha.
     */
    renderSerial: number;
}

export function createRenderTime(): RenderTime {
    return { alpha: 0, stepGameMs: 0, renderNowMs: 0, stepSerial: 0, simNowMs: 0, paused: true, renderSerial: Number.NaN };
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
    rt.paused = paused;
    rt.stepSerial += stepsRun;
    return rt;
}

/** Copy every field of `src` into `out`. */
export function copyRenderTime(src: RenderTime, out: RenderTime): RenderTime {
    out.alpha = src.alpha;
    out.stepGameMs = src.stepGameMs;
    out.renderNowMs = src.renderNowMs;
    out.stepSerial = src.stepSerial;
    out.simNowMs = src.simNowMs;
    out.paused = src.paused;
    out.renderSerial = src.renderSerial;
    return out;
}

/** The presented position within the committed steps (step units): RenderTime.renderSerial, else stepSerial − 1 + alpha. */
export function renderSerialOf(rt: RenderTime): number {
    const s = rt.renderSerial;
    return s === s ? s : rt.stepSerial - 1 + rt.alpha;
}

/**
 * Presentation clock: the render-side playout buffer that turns committed sim steps, however unevenly they land, into
 * an evenly advancing drawn instant (render-only; the same in-thread and with the sim worker).
 *
 * The loops hand MainView a raw RenderTime: the latest committed step (stepSerial, simNowMs) and `alpha`, the real-time
 * fraction of the next step (in-thread: SimFrameBudget's backlog; worker: the message's backlog plus the time since it
 * was applied). While the sim keeps real time, raw = stepSerial − 1 + alpha advances evenly with the wall clock, and the
 * clock presents exactly that (no delay: the two latest steps lerped by alpha, as without it). When a step costs more
 * than its frame (late game), steps land several per frame and then none, or the worker's messages carry bursts: raw
 * becomes a staircase. The clock then
 * - advances its own position (`serial`, in step units) at the rate steps have been landing (over the last two seconds
 *   of arrivals: 1 step per FRAME_REAL_MS at real time, less when the sim falls behind, more while it catches up),
 * - a little faster or slower (bounded, filtered) to stay `delay` steps behind raw, where `delay` covers raw's
 *   irregularity over the same window (how far below its steady line it dips: about half a burst), grows at once when
 *   needed and shrinks slowly — about 0 when steps land evenly;
 * - never passes the latest committed step (it waits there, and the delay grows), never goes backwards, and eases a
 *   large lag (a catch-up burst, game time jumping ahead) out at up to 2.5× rate instead of snapping; only a lag over
 *   SNAP_STEPS (a tab coming back) jumps;
 * - stands still from the frame the game is paused (the picture stops at the press, also while the worker's pause
 *   ack is in flight and its last steps land), and resumes from there.
 * Objects are drawn between the samples that bracket `serial` (MotionInterpolator keeps a few per object), and
 * renderNowMs is the game instant one step after it (as raw's: renderNowMs = nowMs + alpha × stepGameMs), mapped through
 * the committed steps' own game times so a speed change never moves it backwards.
 */
export class PresentationClock {
    /** Real ms of arrivals the rate and the irregularity are measured over. */
    static readonly WINDOW_MS = 2000;
    /** Rate change per step of (filtered) error above / below the target (bounded by MAX_UP / MAX_DOWN). */
    static readonly GAIN_ABOVE = 0.03;
    static readonly GAIN_BELOW = 0.06;
    static readonly MAX_UP = 0.4;
    static readonly MAX_DOWN = 0.6;
    /** Lag beyond the target (steps) from which the catch-up grows past MAX_UP, up to MAX_CATCH_UP (2.5× rate). */
    static readonly CATCH_UP_FROM = 12;
    static readonly MAX_CATCH_UP = 1.5;
    /** Lag beyond the target (steps) that is jumped instead of eased (1 s of steps). */
    static readonly SNAP_STEPS = 60;
    /** Most steps the delay may hold. */
    static readonly MAX_DELAY = 12;
    /** Steps the delay grows by each time the clock has to wait at the latest step. */
    static readonly STARVED_BUMP = 0.5;
    /** Real ms over which the measured arrival rate is eased in. */
    static readonly RATE_EASE_MS = 300;
    /** Quantile of raw's dip the delay covers (the deepest dips only make the clock wait a moment). */
    static readonly LOW_QUANTILE = 0.01;
    /** Slack kept above the measured irregularity: a share of the dip, plus a fixed MARGIN (steps). */
    static readonly DIP_SLACK = 1;
    static readonly MARGIN = 0.05;
    /** The presented position (cumulative step serial, fractional); NaN until the first frame. */
    serial = Number.NaN;
    /** Steps the clock aims to stay behind raw. */
    delay = 0;
    /** Steps landing per FRAME_REAL_MS (1 at real time). */
    rate = 1;
    /** Frames the clock had to wait at the latest committed step (starved), since construction. */
    starved = 0;
    private lastReal = Number.NaN;
    private lastSerial = Number.NaN;
    /** Whether the clock is waiting at the latest step (starved). */
    private waiting = false;
    /** Filtered error (steps) and the mean real ms between arrivals (its filter span). */
    private err = 0;
    private interval = FRAME_REAL_MS;
    /** Frame samples (real ms, raw) over the window, as a ring of pairs; and the arrival corners (real ms, raw). */
    private frames = new Float64Array(2048);
    private fHead = 0;
    private fLen = 0;
    private corners = new Float64Array(1024);
    private cHead = 0;
    private cLen = 0;
    private scratch = new Float64Array(1024);
    /** Committed steps' game times: (serial, nowMs, stepGameMs) per arrival, a ring. */
    private map = new Float64Array(3 * 128);
    private mHead = 0;
    private mLen = 0;

    /** Forget everything (a new game): the next frame starts at raw. */
    reset(): void {
        this.serial = Number.NaN;
        this.delay = 0;
        this.rate = 1;
        this.err = 0;
        this.lastReal = Number.NaN;
        this.lastSerial = Number.NaN;
        this.fLen = this.cLen = this.mLen = 0;
    }

    /** The presented RenderTime for real time `realMs` (the frame's time): `src` is the loop's raw one; writes `out`. */
    present(src: RenderTime, realMs: number, out: RenderTime): RenderTime {
        copyRenderTime(src, out);
        const c = src.stepSerial;
        const alpha = src.alpha > 0 ? Math.min(1, src.alpha) : 0;
        const raw = c - 1 + alpha;
        if (!(this.serial === this.serial) || c < this.lastSerial || !Number.isFinite(realMs)) {
            this.reset();
            this.serial = raw;
            this.lastSerial = c;
            this.lastReal = realMs;
            this.note(c, src.simNowMs, src.stepGameMs);
            return this.output(out, c, src);
        }
        const dt = Math.min(250, Math.max(0, realMs - this.lastReal));
        this.lastReal = realMs;
        const arrived = c > this.lastSerial;
        if (arrived) this.note(c, src.simNowMs, src.stepGameMs);
        this.lastSerial = c;
        if (src.paused) {
            // The picture stops at the press: the position stands (never past the latest step); the measurements start
            // over when the steps resume (the pause gap is not jitter).
            if (this.serial > c) this.serial = c;
            this.fLen = this.cLen = 0;
            this.err = 0;
            return this.output(out, c, src);
        }
        this.measure(realMs, raw, arrived);
        let s = this.serial;
        const step = (dt / FRAME_REAL_MS) * this.rate;
        // Error against where the clock would be this frame at the plain rate.
        const e = raw - this.delay - (s + step);
        if (e > PresentationClock.SNAP_STEPS) {
            s = raw - this.delay;
            this.err = 0;
        } else {
            // Filter the error over about one arrival interval (a burst's staircase must not modulate the rate).
            const k = dt > 0 ? 1 - Math.exp(-dt / Math.min(200, Math.max(30, this.interval))) : 0;
            this.err += (e - this.err) * k;
            const f = this.err;
            let gain: number;
            if (f < 0) gain = Math.max(-PresentationClock.MAX_DOWN, f * PresentationClock.GAIN_BELOW);
            else if (f <= PresentationClock.CATCH_UP_FROM) gain = Math.min(PresentationClock.MAX_UP, f * PresentationClock.GAIN_ABOVE);
            else gain = Math.min(PresentationClock.MAX_CATCH_UP, PresentationClock.MAX_UP + (f - PresentationClock.CATCH_UP_FROM) * PresentationClock.GAIN_ABOVE * 2);
            s += step * (1 + gain);
        }
        if (s > c) {
            // Starved: the next step is later than the delay allowed for. Wait at the latest one; hold more next time
            // (once per wait: the window's measurement covers a long one).
            if (dt > 0) this.starved++;
            if (!this.waiting) this.delay = Math.min(PresentationClock.MAX_DELAY, this.delay + PresentationClock.STARVED_BUMP);
            this.waiting = true;
            s = c;
        } else this.waiting = false;
        if (s < this.serial) s = this.serial;
        this.serial = s;
        return this.output(out, c, src);
    }

    /** Steps the presented position is behind the latest committed step. */
    lagSteps(c: number): number {
        const l = c - this.serial;
        return l > 0 ? l : 0;
    }

    private output(out: RenderTime, c: number, src: RenderTime): RenderTime {
        const s = this.serial;
        out.renderSerial = s;
        const a = s - (c - 1);
        out.alpha = a < 0 ? 0 : a > 1 ? 1 : a;
        out.renderNowMs = this.msAt(s + 1, src);
        return out;
    }

    /** Record a committed step's game time (serial → nowMs, with the step size it ran at). */
    private note(serial: number, nowMs: number, stepGameMs: number): void {
        const m = this.map;
        const cap = m.length / 3;
        if (this.mLen > 0) {
            const li = ((this.mHead + this.mLen - 1) % cap) * 3;
            if (m[li] === serial) {
                m[li + 1] = nowMs;
                m[li + 2] = stepGameMs;
                return;
            }
        }
        const i = ((this.mHead + this.mLen) % cap) * 3;
        if (this.mLen < cap) this.mLen++;
        else this.mHead = (this.mHead + 1) % cap;
        m[i] = serial;
        m[i + 1] = nowMs;
        m[i + 2] = stepGameMs;
    }

    /** Game ms at fractional serial `x`: between the recorded steps' times, else stepping on from the nearest one. */
    private msAt(x: number, src: RenderTime): number {
        const m = this.map;
        const cap = m.length / 3;
        if (this.mLen === 0) return src.simNowMs + (x - src.stepSerial) * src.stepGameMs;
        let j = (this.mHead + this.mLen - 1) % cap;
        if (x >= m[j * 3]) return m[j * 3 + 1] + (x - m[j * 3]) * m[j * 3 + 2];
        for (let n = this.mLen - 1; n > 0; n--) {
            const i = (j - 1 + cap) % cap;
            const s0 = m[i * 3];
            if (x >= s0) {
                const s1 = m[j * 3];
                const t0 = m[i * 3 + 1];
                return t0 + ((m[j * 3 + 1] - t0) * (x - s0)) / (s1 - s0);
            }
            j = i;
        }
        return m[j * 3 + 1] - (m[j * 3] - x) * m[j * 3 + 2];
    }

    /** Window bookkeeping: the arrival rate (corner to corner) and raw's dip below its steady line (→ delay). */
    private measure(t: number, raw: number, arrived: boolean): void {
        const W = PresentationClock.WINDOW_MS;
        const f = this.frames;
        const fCap = f.length / 2;
        let i = ((this.fHead + this.fLen) % fCap) * 2;
        if (this.fLen < fCap) this.fLen++;
        else this.fHead = (this.fHead + 1) % fCap;
        f[i] = t;
        f[i + 1] = raw;
        while (this.fLen > 2 && t - f[this.fHead * 2] > W) {
            this.fHead = (this.fHead + 1) % fCap;
            this.fLen--;
        }
        if (!arrived) return;
        const cr = this.corners;
        const cCap = cr.length / 2;
        i = ((this.cHead + this.cLen) % cCap) * 2;
        if (this.cLen < cCap) this.cLen++;
        else this.cHead = (this.cHead + 1) % cCap;
        cr[i] = t;
        cr[i + 1] = raw;
        while (this.cLen > 2 && t - cr[this.cHead * 2] > W) {
            this.cHead = (this.cHead + 1) % cCap;
            this.cLen--;
        }
        if (this.cLen < 3) return;
        const t0 = cr[this.cHead * 2];
        const r0 = cr[this.cHead * 2 + 1];
        const span = t - t0;
        if (!(span > 4 * FRAME_REAL_MS)) return;
        // Corner to corner over the window, eased over ~0.3 s (one burst more or less must not step the speed).
        const inst = Math.min(8, Math.max(0.05, ((raw - r0) * FRAME_REAL_MS) / span));
        const pi = ((this.cHead + this.cLen - 2) % cCap) * 2;
        this.rate += (inst - this.rate) * (1 - Math.exp(-(t - cr[pi]) / PresentationClock.RATE_EASE_MS));
        this.interval = span / (this.cLen - 1);
        // Raw's dip below its steady line at that rate: the time-mean of (raw − rate · t) minus its LOW_QUANTILE quantile
        // (LOW_QUANTILE: one late spell must not hold a big delay for the whole window; the clock then only waits a moment).
        const perMs = inst / FRAME_REAL_MS;
        const n = this.fLen;
        const d = this.scratch.length >= n ? this.scratch : (this.scratch = new Float64Array(n * 2));
        let sum = 0;
        let wsum = 0;
        for (let k = 0; k < n; k++) {
            const q = ((this.fHead + k) % fCap) * 2;
            const v = f[q + 1] - perMs * (f[q] - t0);
            d[k] = v;
            // Time-weighted (frames are not evenly spaced).
            const w = k + 1 < n ? f[(((this.fHead + k + 1) % fCap) * 2)] - f[q] : 0;
            sum += v * w;
            wsum += w;
        }
        if (!(wsum > 0)) return;
        const mean = sum / wsum;
        const sorted = d.subarray(0, n).sort();
        const low = sorted[Math.floor(n * PresentationClock.LOW_QUANTILE)];
        // Plus slack for the clock's own wander around its target, which grows with the staircase's size.
        const dip = Math.max(0, mean - low);
        const want = Math.min(PresentationClock.MAX_DELAY, dip * (1 + PresentationClock.DIP_SLACK) + PresentationClock.MARGIN);
        this.delay += (want - this.delay) * (want > this.delay ? 0.5 : 0.1);
    }
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
// lands. `nowMs` is the instant drawn — RenderTime.renderNowMs (galaxy.nowMs plus the elapsed part of the next step,
// or the presentation clock's instant), so the angle also advances between sim steps; nothing here is written back.
export function renderOrbitAngle(orbitAngle: number, anglePerSecond: number, orbitDirection: boolean, lastTouch: number, nowMs: number, clampSeconds: number): number {
    // Both ways: the presented instant may lie before a habitat's latest touch (PresentationClock's delay), where the
    // same uniform orbit runs backwards from the committed pair.
    const c = Math.max(clampSeconds, 0);
    const elapsed = Math.min(Math.max(spanSeconds(nowMs, lastTouch), -c), c);
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
    return a + wrapAngle(b - a) * t;
}

/** `d` (radians) into −π..π: the shorter arc of a heading difference. */
export function wrapAngle(d: number): number {
    d %= TWO_PI;
    if (d > Math.PI) d -= TWO_PI;
    else if (d < -Math.PI) d += TWO_PI;
    return d;
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

/** An object drawn every frame may take this many steps in one sample (a slow sim's burst: several steps land in one
 * frame or one worker message) and still be interpolated across them; beyond it (2 s of steps) it snaps. */
export const MAX_BURST_STEPS = 120;
/** Samples kept per object: enough for the presented instant to lag a few arrivals behind the latest one
 * (PresentationClock's delay covers about half a burst plus the irregularity). */
export const MOTION_HISTORY = 8;

/** Largest acceleration (world units / game s²) of a soft snap's easing offset (sample's `softSnapMs`): a jump too long
 * to ease within `softSnapMs` under it takes longer, up to SOFT_SNAP_MAX_MS. */
export const SOFT_SNAP_MAX_ACCEL = 8000;
/** Longest a soft snap eases (game ms). */
export const SOFT_SNAP_MAX_MS = 1500;

/** What MotionInterpolator.advance did with a new sim position. */
const enum Advance {
    /** Lerping on (or nothing new). */
    Lerp,
    /** Snapped on a jump (isJump) within the interpolation window: a soft snap may ease it. */
    Jump,
    /** Snapped on a long gap or a move made without a step. */
    Snap,
}

/** One object's interpolation record (reused every frame). */
export interface MotionState {
    /** Estimated position / heading one step before `c*` (in `frame` coordinates): on the line between the samples. */
    px: number;
    py: number;
    ph: number;
    /** The sim's position / heading after the latest step seen. */
    cx: number;
    cy: number;
    ch: number;
    /** The habitat / parent built object whose frame the samples are in (null: galaxy coordinates). */
    frame: object | null;
    /** The frame's drawn origin at the last sample (galaxy coordinates; 0, 0 for the galaxy frame): converts the samples
     * into a new frame when the object changes frames. */
    ox: number;
    oy: number;
    /** RenderTime.stepSerial when `c*` was taken (the latest sample's serial). */
    serial: number;
    /** Caller's identity of the object's current life (a shot's LastFired): a change snaps (a new shot spawns). */
    epoch: number;
    /** Render frame of the last sample (drawn* is valid for that frame only). */
    renderFrame: number;
    /** The drawn result: galaxy coordinates and heading. */
    x: number;
    y: number;
    heading: number;
    /** Soft snap (sample's `softSnapMs`): the drawn position is the history track plus an offset that starts at
     * (ex, ey) with velocity (evx, evy) (galaxy units, per step) at presented serial `eStart` and comes to rest eLen
     * steps later (cubic Hermite, easeOffset). eLen 0: none. */
    ex: number;
    ey: number;
    evx: number;
    evy: number;
    eStart: number;
    eLen: number;
    /** The history track (without the offset) at the last sample, and its velocity there (per step; trackVelocity):
     * where the drawn object was heading, for a soft snap's start. Kept for soft-snapping objects only. */
    tx: number;
    ty: number;
    tvx: number;
    tvy: number;
    /** The presented serial the last sample was drawn at. */
    atSerial: number;
    /** The samples, oldest first: (serial, x, y, heading) × hn, in `frame` coordinates. */
    hs: Float64Array;
    hn: number;
    /** Turn evidence (sampleBuiltObject, turnedAtLastTouch): the LastTouch and committed heading of the latest touch
     * seen (NaN: none yet), whether that touch turned the object (its heading changed from the touch before), and,
     * taken at that touch: the speed its next touch moves it at (nextTouchSpeed), the rate that touch turns it at
     * (builtObjectTurnRate; 0 when not turning), the rate at that speed whether turning or not (for the next touch's
     * turnLimit) and its turnLimit. */
    tTouch: number;
    tHeading: number;
    tTurning: boolean;
    tSpeed: number;
    tRate: number;
    tRateAny: number;
    tLimit: number;
}

/** Scratch for easeOffset: the offset and its velocity (per step). */
const easeScratch = { x: 0, y: 0, vx: 0, vy: 0 };

/** `st`'s correction offset at presented serial `at` and its velocity (per step): the cubic Hermite from (ex, ey) with
 * velocity (evx, evy) at eStart to (0, 0) at rest eLen steps later — no position or velocity step at either end. */
function easeOffset(st: MotionState, at: number, out: { x: number; y: number; vx: number; vy: number }): { x: number; y: number; vx: number; vy: number } {
    const T = st.eLen;
    const u = T > 0 ? (at - st.eStart) / T : 1;
    if (!(u < 1)) {
        out.x = out.y = out.vx = out.vy = 0;
        return out;
    }
    const w = u > 0 ? u : 0;
    const h00 = 1 - w * w * (3 - 2 * w);
    const h10 = w * (1 - w) * (1 - w);
    const d00 = (6 * w * (w - 1)) / T;
    const d10 = 1 - w * (4 - 3 * w);
    out.x = h00 * st.ex + h10 * T * st.evx;
    out.y = h00 * st.ey + h10 * T * st.evy;
    out.vx = d00 * st.ex + d10 * st.evx;
    out.vy = d00 * st.ey + d10 * st.evy;
    return out;
}

/** Scratch pose for history reads. */
const poseScratch = { x: 0, y: 0, heading: 0 };

/** `st`'s samples at serial `at` (frame coordinates): between the two that bracket it, else the nearest end. */
function historyAt(st: MotionState, at: number, out: { x: number; y: number; heading: number }): { x: number; y: number; heading: number } {
    const h = st.hs;
    const n = st.hn;
    let j = (n - 1) * 4;
    if (n === 1 || !(at < h[j])) {
        out.x = h[j + 1];
        out.y = h[j + 2];
        out.heading = h[j + 3];
        return out;
    }
    if (!(at > h[0])) {
        out.x = h[1];
        out.y = h[2];
        out.heading = h[3];
        return out;
    }
    let i = j - 4;
    while (i > 0 && h[i] > at) {
        j = i;
        i -= 4;
    }
    const t = (at - h[i]) / (h[j] - h[i]);
    out.x = h[i + 1] + (h[j + 1] - h[i + 1]) * t;
    out.y = h[i + 2] + (h[j + 2] - h[i + 2]) * t;
    out.heading = lerpAngle(h[i + 3], h[j + 3], t);
    return out;
}

/** The velocity (frame units per step) of `st`'s history track at serial `at`: the segment `at` lies on (the later one at
 * a sample), the last one at or past the newest sample; 0 before the oldest (the track holds there) or with one sample. */
function trackVelocity(st: MotionState, at: number, out: { x: number; y: number }): { x: number; y: number } {
    const h = st.hs;
    const n = st.hn;
    out.x = 0;
    out.y = 0;
    if (n < 2 || at < h[0]) return out;
    let j = 4;
    while (j < (n - 1) * 4 && !(at < h[j])) j += 4;
    const i = j - 4;
    const ds = h[j] - h[i];
    if (ds > 0) {
        out.x = (h[j + 1] - h[i + 1]) / ds;
        out.y = (h[j + 2] - h[i + 2]) / ds;
    }
    return out;
}

/** Scratch for trackVelocity. */
const velScratch: Point = { x: 0, y: 0 };

/** Start `st`'s history over at one sample. */
function snapTo(st: MotionState, serial: number, x: number, y: number, heading: number): void {
    const h = st.hs;
    h[0] = serial;
    h[1] = x;
    h[2] = y;
    h[3] = heading;
    st.hn = 1;
    st.px = st.cx = x;
    st.py = st.cy = y;
    st.ph = st.ch = heading;
    st.serial = serial;
}

/** Append a sample and refresh c* / p*. When full, the oldest goes — unless the presented instant `at` still lies
 * before the second one (the oldest brackets it: a long lag over many small arrivals), then the second goes, so the
 * drawn object keeps its place on the line instead of jumping ahead. */
function pushSample(st: MotionState, serial: number, x: number, y: number, heading: number, at: number): void {
    const h = st.hs;
    if (st.hn === MOTION_HISTORY) {
        if (h[4] > at) h.copyWithin(4, 8, MOTION_HISTORY * 4);
        else h.copyWithin(0, 4, MOTION_HISTORY * 4);
        st.hn--;
    }
    const j = st.hn * 4;
    h[j] = serial;
    h[j + 1] = x;
    h[j + 2] = y;
    h[j + 3] = heading;
    st.hn++;
    st.cx = x;
    st.cy = y;
    st.ch = heading;
    st.serial = serial;
    // One step back on the line from the previous sample (several steps landed: exact for straight-line motion).
    const i = j - 4;
    const t = (serial - 1 - h[i]) / (serial - h[i]);
    st.px = h[i + 1] + (x - h[i + 1]) * t;
    st.py = h[i + 2] + (y - h[i + 2]) * t;
    st.ph = lerpAngle(h[i + 3], heading, t);
}

/**
 * Per-object step samples and the drawn interpolation. Call begin() once per render frame, then sample() each object
 * as it is drawn; layers drawn later in the frame read the same result with drawn() so selection rings, engine glows,
 * liveries, lines, pick tests etc. stay on the drawn sprite. Each object keeps its last few step samples (MOTION_HISTORY,
 * tagged with their step serial) and is drawn at the presented serial (RenderTime.renderSerial: the presentation
 * clock's instant, or stepSerial − 1 + alpha) between the two samples that bracket it — the latest two when the sim
 * keeps up; older ones while the clock trails a burst. O(objects sampled); allocates one record per object the first
 * time it is seen (WeakMap: released with the object).
 */
export class MotionInterpolator {
    private states = new WeakMap<object, MotionState>();
    /** Per fighter: leashWeight's state. */
    private leash = new WeakMap<object, { atMs: number; w: number }>();
    private renderFrame = 0;
    serial = 0;
    alpha = 0;
    /** The presented instant in step units (renderSerialOf the frame's RenderTime). */
    at = 0;
    /** Steps the presented instant trails the latest committed step (0 when drawing at it). */
    lagSteps = 0;
    stepSeconds = 0;
    renderNowMs = 0;
    /** galaxy.nowMs of the committed state (RenderTime.simNowMs). */
    simNowMs = 0;
    clampSeconds = 0;
    /** Longest a built object's position is extrapolated past its LastTouch (builtObjectTouchGapMs) — also the bound for
     * what moves when a built object is touched: its fighters and the shots it or its fighters fired. */
    untouchedMaxMs = 0;
    /** The mean game ms between two touches of a built object (count / 1000 steps, at least one): when its next touch
     * is expected (nextTouchSpeed). */
    touchGapMs = 0;
    /** Whether sample()'s turnLimit eases drawn headings (false: they follow the samples at once — A/B comparisons). */
    easeHeadings = true;
    /** Longest a creature's position is extrapolated past its LastTouch (one creature round-robin + a step). */
    creatureUntouchedMaxMs = 0;
    /** Longest a habitat-fired shot is extrapolated past the habitat's LastTouch (one habitat round-robin + a step). */
    habitatUntouchedMaxMs = 0;
    /** Scratch origin for frame-relative samples. */
    private origin: Point = { x: 0, y: 0 };
    /** Scratch for positionOf. */
    private posScratch: Point = { x: 0, y: 0 };
    /** peek()'s last lookup, which the next sample() of the same object reuses (one WeakMap lookup per object). */
    private peekObj: object | null = null;
    private peekState: MotionState | undefined = undefined;

    /** `obj`'s record (undefined before its first sample), for the sample about to be taken (sampleBuiltObject reads
     * and updates its turn evidence first). */
    peek(obj: object): MotionState | undefined {
        const st = this.states.get(obj);
        this.peekObj = obj;
        this.peekState = st;
        return st;
    }

    /** `obj`'s record, or undefined (not sampled yet), without peek()'s reuse: a carrier's turn evidence, read (and
     * taken in, once per touch) while one of its fighters is sampled. */
    stateOf(obj: object): MotionState | undefined {
        return this.states.get(obj);
    }

    /** `builtObjectCount` / `creatureCount` / `habitatCount`: galaxy.builtObjects / creatures / habitats .length, which set
     * how long each may go untouched by the background pass (the extrapolation bounds of sampleBuiltObject / sampleFighter
     * / sampleShot, sampleCreature, and sampleShot for habitat-fired shots). */
    begin(rt: RenderTime, clampSeconds: number, builtObjectCount = 0, creatureCount = 0, habitatCount = 0): void {
        this.renderFrame++;
        this.serial = rt.stepSerial;
        this.alpha = rt.alpha;
        const at = renderSerialOf(rt);
        this.at = at < rt.stepSerial ? at : rt.stepSerial;
        this.lagSteps = rt.stepSerial - this.at;
        this.stepSeconds = rt.stepGameMs / 1000;
        this.renderNowMs = rt.renderNowMs;
        this.simNowMs = rt.simNowMs;
        this.clampSeconds = clampSeconds;
        this.untouchedMaxMs = builtObjectTouchGapMs(builtObjectCount, rt.stepGameMs);
        this.touchGapMs = Math.max(1, builtObjectCount / BUILT_OBJECT_TICK_BATCH_SIZE) * (rt.stepGameMs > 0 ? rt.stepGameMs : 1000 / FRAMES_PER_SECOND);
        this.creatureUntouchedMaxMs = roundRobinTouchGapMs(creatureCount, CREATURE_TICK_BATCH_SIZE, rt.stepGameMs);
        this.habitatUntouchedMaxMs = roundRobinTouchGapMs(habitatCount, HABITAT_TICK_BATCH_SIZE, rt.stepGameMs);
    }

    /**
     * Sample `obj` at sim position (x, y) / heading this frame: in galaxy coordinates when `frame` is null, else as an
     * offset from `frame` (whose drawn position is `originX, originY`). Returns the object's record with x / y /
     * heading set to the drawn values.
     *
     * `softSnapMs` > 0: a jump (isJump) of an object drawn last frame is not shown as a pop but eased out over that many
     * game ms, with no step in the drawn position or velocity: the track goes on from the new position along
     * (`jumpVx`, `jumpVy`) per step — the object's own motion there, which its next samples follow (NaN: its last
     * step's) — and an offset that starts at the drawn-minus-new position, with the drawn-minus-new velocity, eases to
     * rest (easeOffset). Presented time: it holds while paused. First sight, a long gap, a new epoch and moves made
     * without a step still snap at once.
     *
     * `turnLimit` > 0 (radians per game second): the drawn heading of an object drawn last frame turns at most that
     * fast toward its samples' heading, so a heading the sim set at a touch that the samples before it did not lead
     * up to (a turn begun at that touch, an extrapolated turn the touch did not make, a heading set outright) is eased
     * out instead of turned in one step. Callers pass a multiple of the fastest the sim turns the object
     * (HEADING_EASE_FACTOR), which an ordinary turn never reaches. A snap, first sight or a new epoch takes the
     * heading at once.
     */
    sample(obj: object, x: number, y: number, heading: number, maxSpeed: number, frame: object | null = null, originX = 0, originY = 0, epoch = 0, softSnapMs = 0, jumpVx = Number.NaN, jumpVy = Number.NaN, turnLimit = 0): MotionState {
        let st: MotionState | undefined;
        if (obj === this.peekObj) {
            st = this.peekState;
            this.peekObj = null;
            this.peekState = undefined;
        } else st = this.states.get(obj);
        let jumped = false;
        /** Whether the drawn heading may be eased (turnLimit): drawn last frame and not snapped. */
        let easeHeading = false;
        if (st === undefined) {
            st = { px: x, py: y, ph: heading, cx: x, cy: y, ch: heading, frame, ox: originX, oy: originY, serial: this.serial, epoch, renderFrame: 0, x, y, heading, ex: 0, ey: 0, evx: 0, evy: 0, eStart: 0, eLen: 0, tx: x, ty: y, tvx: 0, tvy: 0, atSerial: this.at, hs: new Float64Array(MOTION_HISTORY * 4), hn: 0, tTouch: Number.NaN, tHeading: 0, tTurning: false, tSpeed: 0, tRate: 0, tRateAny: 0, tLimit: 0 };
            snapTo(st, this.serial, x, y, heading);
            this.states.set(obj, st);
        } else if (st.epoch !== epoch) {
            snapTo(st, this.serial, x, y, heading);
            st.eLen = 0;
            st.frame = frame;
            st.epoch = epoch;
        } else {
            if (st.frame !== frame) {
                // Entering / leaving a parent's frame (parking at or leaving a planet, docking at a base): carry the
                // samples over into the new frame (through galaxy coordinates, at the old frame's last drawn origin) and
                // go on lerping, so the drawn object neither jumps nor stands still for a step. The step logic below
                // still snaps a real jump (isJump) or a move made without a step.
                const dx = st.ox - originX;
                const dy = st.oy - originY;
                const h = st.hs;
                for (let j = 0; j < st.hn * 4; j += 4) {
                    h[j + 1] += dx;
                    h[j + 2] += dy;
                }
                st.px += dx;
                st.py += dy;
                st.cx += dx;
                st.cy += dy;
                st.tx += dx;
                st.ty += dy;
                st.frame = frame;
            }
            const drawnLastFrame = st.renderFrame === this.renderFrame - 1;
            // The object's own motion over its last step (frame coordinates): the fallback for the track after a jump.
            const vx = st.cx - st.px;
            const vy = st.cy - st.py;
            const vh = st.ch;
            const r = this.advance(st, x, y, heading, maxSpeed, drawnLastFrame);
            if (r === Advance.Jump && softSnapMs > 0 && drawnLastFrame) {
                // The track: on from the new position along its motion there — a sample one step back (or back to last
                // frame's presented instant, if that is earlier) on that line, the heading turning over the step.
                const jx = jumpVx === jumpVx ? jumpVx : vx;
                const jy = jumpVy === jumpVy ? jumpVy : vy;
                const s1 = this.serial;
                const s0 = Math.min(s1 - 1, Math.floor(st.atSerial));
                const back = s1 - s0;
                snapTo(st, s0, x - jx * back, y - jy * back, vh);
                pushSample(st, s1, x, y, heading, this.at);
                jumped = true;
            } else if (r !== Advance.Lerp) {
                st.eLen = 0;
            }
            easeHeading = drawnLastFrame && (r === Advance.Lerp || jumped);
        }
        const p = historyAt(st, this.at, poseScratch);
        if (p.heading !== st.heading && turnLimit > 0 && easeHeading && this.easeHeadings) {
            // At most turnLimit × the presented game time since last frame away from last frame's drawn heading.
            const stepS = this.stepSeconds > 0 ? this.stepSeconds : 1 / FRAMES_PER_SECOND;
            const dAt = this.at - st.atSerial;
            const maxD = turnLimit * stepS * (dAt > 0 ? dAt : 0);
            const d = wrapAngle(p.heading - st.heading);
            if (d > maxD) p.heading = st.heading + maxD;
            else if (d < -maxD) p.heading = st.heading - maxD;
        }
        if (softSnapMs > 0) {
            const v = trackVelocity(st, this.at, velScratch);
            if (jumped) this.easeJump(st, p, v, softSnapMs);
            st.tx = p.x;
            st.ty = p.y;
            st.tvx = v.x;
            st.tvy = v.y;
        }
        st.ox = originX;
        st.oy = originY;
        st.renderFrame = this.renderFrame;
        st.atSerial = this.at;
        st.x = originX + p.x;
        st.y = originY + p.y;
        st.heading = p.heading;
        if (st.eLen > 0) {
            if (st.eStart + st.eLen > this.at) {
                const e = easeOffset(st, this.at, easeScratch);
                st.x += e.x;
                st.y += e.y;
            } else {
                st.eLen = 0;
            }
        }
        return st;
    }

    /**
     * A soft snap's offset: the track this frame (`p`, velocity `v` per step, after the jump) against where last frame's
     * drawn object was heading — last frame's track (tx / ty, tvx / tvy) carried over the presented steps since, plus
     * the offset already easing (an ease running is restarted from where it is) — so the drawn object goes on exactly
     * as it was moving; the offset comes to rest `softSnapMs` game ms later, or later for a long jump.
     */
    private easeJump(st: MotionState, p: { x: number; y: number }, v: Point, softSnapMs: number): void {
        const dAt = this.at - st.atSerial;
        const e = st.eLen > 0 ? easeOffset(st, this.at, easeScratch) : null;
        st.ex = st.tx + st.tvx * dAt - p.x + (e !== null ? e.x : 0);
        st.ey = st.ty + st.tvy * dAt - p.y + (e !== null ? e.y : 0);
        st.evx = st.tvx - v.x + (e !== null ? e.vx : 0);
        st.evy = st.tvy - v.y + (e !== null ? e.vy : 0);
        st.eStart = this.at;
        // At least softSnapMs; longer for a long jump, so the offset's acceleration stays within SOFT_SNAP_MAX_ACCEL
        // (a cubic from rest offset e with velocity ev peaks at its start: (6 e + 4 T ev) / T²); at most SOFT_SNAP_MAX_MS.
        const stepS = this.stepSeconds > 0 ? this.stepSeconds : 1 / FRAMES_PER_SECOND;
        const a = SOFT_SNAP_MAX_ACCEL * stepS * stepS;
        const e0 = Math.hypot(st.ex, st.ey);
        const ev = Math.hypot(st.evx, st.evy);
        const need = (4 * ev + Math.sqrt(16 * ev * ev + 24 * a * e0)) / (2 * a);
        const lo = Math.max(1, softSnapMs / 1000 / stepS);
        const hi = Math.max(lo, SOFT_SNAP_MAX_MS / 1000 / stepS);
        st.eLen = need > lo ? (need < hi ? need : hi) : lo;
    }

    /** Take the sim's (x, y, heading) into `st` (same frame): a new step adds a sample, snapping on a jump, a long gap
     * (not drawn for MAX_INTERP_STEPS steps; MAX_BURST_STEPS when drawn last frame) or a move made without a step. */
    private advance(st: MotionState, x: number, y: number, heading: number, maxSpeed: number, drawnLastFrame: boolean): Advance {
        if (st.serial !== this.serial) {
            const k = this.serial - st.serial;
            if (k < 0 || (k > MAX_INTERP_STEPS && !(drawnLastFrame && k <= MAX_BURST_STEPS))) {
                snapTo(st, this.serial, x, y, heading);
                return Advance.Snap;
            }
            if (isJump(x - st.cx, y - st.cy, k, maxSpeed, this.stepSeconds)) {
                snapTo(st, this.serial, x, y, heading);
                return Advance.Jump;
            }
            pushSample(st, this.serial, x, y, heading, this.at);
        } else if (x !== st.cx || y !== st.cy || heading !== st.ch) {
            // Moved without a sim step (an order applied at the frame boundary, a load, an edit): no interpolation.
            snapTo(st, this.serial, x, y, heading);
            return Advance.Snap;
        }
        return Advance.Lerp;
    }

    /**
     * How far (0..1) a fighter is drawn as on its leash around the drawn carrier (sampleFighter): eased toward 1 while
     * `onLeash`, toward 0 while not, by the game time since its previous sample over FIGHTER_LEASH_EASE_MS — so coming
     * onto or off the leash never steps the drawn fighter by the carrier's drawn-minus-committed offset. `atMs`: the
     * game instant the sample stands for (LastTouch + the extrapolated time), which a step's frames share (the sample
     * stays the same through a step) and which does not move while the fighter stands untouched and unextrapolated.
     * First seen, or back in time: at once.
     */
    leashWeight(obj: object, atMs: number, onLeash: boolean): number {
        let r = this.leash.get(obj);
        if (r === undefined) {
            r = { atMs, w: onLeash ? 1 : 0 };
            this.leash.set(obj, r);
        } else if (r.atMs !== atMs) {
            const d = (atMs - r.atMs) / FIGHTER_LEASH_EASE_MS;
            if (!(d > 0)) r.w = onLeash ? 1 : 0;
            else r.w = onLeash ? Math.min(1, r.w + d) : Math.max(0, r.w - d);
            r.atMs = atMs;
        }
        return r.w;
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
    /** BuiltObject.Role: bases get the cosmetic pull toward their habitat (setStationPull); a base never turns. */
    role?: BuiltObjectRole;
    /** BuiltObject.TargetHeading and TurnRate (rad / game s), the fleet (its ShipManeuveringBonus) and the captain's
     * bonus (characters.ts captainBonuses): an untouched turning ship's heading is extrapolated (builtObjectTurnRate). */
    targetHeading?: number;
    turnRate?: number;
    shipGroup?: unknown;
    /** BuiltObject.TargetSpeed, AccelerationRate and HyperjumpPrepare: a ship preparing a hyperjump accelerates before
     * it turns and moves (nextTouchSpeed). */
    targetSpeed?: number;
    accelerationRate?: number;
    hyperjumpPrepare?: boolean;
}

// Cosmetic option (not in the original, off by default): draw a base at a planet / moon pulled in toward its centre.
// The sim keeps the faithful ParentOffset (a construction ship parks up to MovementPrecision short of a point inside the
// body, so a base can sit at or past a small moon's rim); only the drawn position moves. Docked ships and ships parked
// at the base follow, because they are drawn in the base's drawn frame.
/** Drawn offset = the committed offset × this, ... */
export const STATION_PULL_SCALE = 0.4;
/** ... and at most this fraction of the body's radius. */
export const STATION_PULL_MAX_RADIUS = 0.5;
let stationPull = false;
/** Turn the cosmetic station pull on or off (mainView.ts, from settings.pullStationsToCentre). */
export function setStationPull(on: boolean): void {
    stationPull = on;
}

/** The drawn parent offset of a base at habitat `h` with the station pull on (scratch point). */
export function pulledStationOffset(ox: number, oy: number, diameter: number, out: Point): Point {
    const len = Math.hypot(ox, oy);
    const target = Math.min(len * STATION_PULL_SCALE, (STATION_PULL_MAX_RADIUS * Math.max(0, diameter)) / 2);
    const k = len > 0 ? target / len : 0;
    out.x = ox * k;
    out.y = oy * k;
    return out;
}
const pullScratch: Point = { x: 0, y: 0 };

/** scheduler.ts backgroundPass "GxBO" int_43: built objects the background round-robin ticks per sim frame (multi-core
 * budget). With more objects than this, each one is touched only every ceil(count / 1000) steps. */
export const BUILT_OBJECT_TICK_BATCH_SIZE = 1000;

/**
 * Longest (game ms) a built object's drawn position is extrapolated past its LastTouch: one full background round-robin
 * (ceil(count / BUILT_OBJECT_TICK_BATCH_SIZE) steps) plus one step of slack. `stepGameMs` 0 (no sim loop) counts as
 * one step at 1x speed.
 */
export function builtObjectTouchGapMs(builtObjectCount: number, stepGameMs: number): number {
    return roundRobinTouchGapMs(builtObjectCount, BUILT_OBJECT_TICK_BATCH_SIZE, stepGameMs);
}

/** scheduler.ts backgroundPass "GxCr" int_44: creatures the background round-robin ticks per sim frame (multi-core
 * budget). With more creatures than this, each one moves only every ceil(count / 50) steps. */
export const CREATURE_TICK_BATCH_SIZE = 50;

/** Longest (game ms) between two touches of an object in a round-robin of `count` objects, `batch` per step: one full
 * cycle plus one step of slack (builtObjectTouchGapMs for any round-robin). */
export function roundRobinTouchGapMs(count: number, batch: number, stepGameMs: number): number {
    const steps = Math.max(1, Math.ceil(Math.max(0, count) / batch)) + 1;
    return steps * (stepGameMs > 0 ? stepGameMs : 1000 / FRAMES_PER_SECOND);
}

/** Result of extrapolateMover (a scratch record). */
export interface MoverPose {
    x: number;
    y: number;
    heading: number;
}

/**
 * The heading CalculateCurrentHeading leaves after a turn of `turn` radians toward `target` (BuiltObject.2.cs 7433,
 * Fighter.cs 1846, Creature.cs 685): the difference target − heading — wrapped once into ±π first (`wrapDiff`; the
 * creature's is not) — turns left (−) when in (−π, 0) or [π, 2π), else right (+); a turn longer than the difference
 * lands on the target; the result is brought back into −π..π (IncreaseAngle / ReduceAngle). Unwrapped (a creature
 * whose target lies across the ±π seam) the "longer than the difference" test reads the raw difference, so the turn
 * runs on past the target, as the sim's does. Render-only.
 */
export function turnHeading(heading: number, target: number, turn: number, wrapDiff = true): number {
    if (heading === target || !(turn > 0)) return heading;
    let d = target - heading;
    if (wrapDiff) {
        if (d > Math.PI) d -= TWO_PI;
        else if (d < -Math.PI) d += TWO_PI;
    }
    let h: number;
    if ((d < 0 && d > -Math.PI) || (d >= Math.PI && d < TWO_PI)) {
        h = Math.abs(d) < turn ? target : heading - turn;
        for (let i = 0; i < 20 && h <= -Math.PI; i++) h += TWO_PI;
    } else {
        h = Math.abs(d) < turn ? target : heading + turn;
        for (let i = 0; i < 20 && h >= Math.PI; i++) h -= TWO_PI;
    }
    return h;
}

/**
 * Where a self-propelled mover (fighter, creature) touched `dtSeconds` ago will be put by its next touch, if its orders
 * hold: the move both Fighter.cs 1783 DoMovement and Creature.cs 998 Move apply over the elapsed time — turn toward
 * TargetHeading by turnRate × dt (turnHeading: CalculateCurrentHeading; `wrapDiff` false for a creature's), accelerate
 * toward TargetSpeed (AccelerateToTargetSpeed: up by accelerationRate × dt, down by max(1, accelerationRate) × dt), then
 * step CurrentSpeed × dt along the new heading. Render-only: writes `out` and returns it.
 */
export function extrapolateMover(
    x: number, y: number, heading: number, targetHeading: number, turnRate: number, currentSpeed: number, targetSpeed: number, accelerationRate: number, dtSeconds: number, out: MoverPose, wrapDiff = true,
): MoverPose {
    out.x = x;
    out.y = y;
    out.heading = heading;
    if (!(dtSeconds > 0) || !Number.isFinite(dtSeconds)) return out;
    const h = turnRate > 0 ? turnHeading(heading, targetHeading, turnRate * dtSeconds, wrapDiff) : heading;
    let v = currentSpeed;
    if (targetSpeed > v) v = Math.min(targetSpeed, v + accelerationRate * dtSeconds);
    else if (targetSpeed < v) v = Math.max(targetSpeed, v - Math.max(1, accelerationRate) * dtSeconds);
    if (v < 0) v = 0;
    out.x = x + Math.cos(h) * v * dtSeconds;
    out.y = y + Math.sin(h) * v * dtSeconds;
    out.heading = h;
    return out;
}

const moverScratch: MoverPose = { x: 0, y: 0, heading: 0 };

/** Seconds since `lastTouchMs` at the committed instant, bounded by `maxMs` (0 when never touched / touched now). */
function untouchedSeconds(m: MotionInterpolator, lastTouchMs: number, maxMs: number): number {
    if (!(maxMs > 0) || !(lastTouchMs > MIN_TIME)) return 0;
    const dt = m.simNowMs - lastTouchMs;
    return dt > 0 && Number.isFinite(dt) ? Math.min(dt, maxMs) / 1000 : 0;
}

/**
 * Port of BuiltObject.2.cs 7372 GetCurrentTurnRate(speed) (movement.ts getCurrentTurnRate), radians per game second:
 * TurnRate × 3 at or below 2 × MovementImpulseSpeed, × 2.3 at or below 3 ×, × 1.6 at or below 4 ×; × the fleet's
 * ShipManeuveringBonus; × the captain's CaptainShipManeuveringBonus / 100. The rate CalculateCurrentHeading turns a
 * ship at over the time since its last touch (DoMovement turns before it accelerates: the committed CurrentSpeed's).
 * Render-only (reads the fields; 0 without a TurnRate).
 */
export function builtObjectTurnRate(bo: MovingBuiltObject, speed = bo.currentSpeed): number {
    let r = bo.turnRate ?? 0;
    if (!(r > 0)) return 0;
    if (speed <= MOVEMENT_IMPULSE_SPEED * 2) r *= 3.0;
    else if (speed <= MOVEMENT_IMPULSE_SPEED * 3) r *= 2.3;
    else if (speed <= MOVEMENT_IMPULSE_SPEED * 4) r *= 1.6;
    const sg = bo.shipGroup as { shipManeuveringBonus?: number } | null | undefined;
    if (sg != null) {
        const b = sg.shipManeuveringBonus;
        if (typeof b === 'number') r *= b;
    }
    return r * ((captainBonuses(bo as BuiltObject)?.shipManeuvering ?? 100) / 100.0);
}

/** The drawn heading of an object turns at most this many times the fastest the sim turns it (MotionInterpolator.sample
 * `turnLimit`): an ordinary turn (extrapolated) never reaches it; a heading the next touch disagrees with eases. */
export const HEADING_EASE_FACTOR = 2;

/**
 * The speed `bo`'s next touch moves it at, and turns it at the rate of (GetCurrentTurnRate reads CurrentSpeed): its
 * committed CurrentSpeed — DoMovement takes the move (CurrentSpeed × time) and turns before it accelerates — except
 * for a ship preparing a hyperjump, whose HyperTo leg (cmdMovement.ts, BuiltObject.2.cs HyperTo) accelerates first
 * (AccelerateToTargetSpeed over the expected time to that touch, MotionInterpolator.touchGapMs) and then turns and
 * moves at the new speed.
 */
function nextTouchSpeed(m: MotionInterpolator, bo: MovingBuiltObject): number {
    const v = bo.currentSpeed;
    if (bo.hyperjumpPrepare !== true || bo.targetSpeed === undefined) return v;
    const target = bo.targetSpeed;
    const a = bo.accelerationRate ?? 0;
    const dt = m.touchGapMs / 1000;
    let n = v;
    if (target > v) n = Math.min(target, v + a * dt);
    else if (target < v) n = Math.max(target, v - Math.max(1, a) * dt);
    return n > 0 ? n : 0;
}

/**
 * The rate (rad / game s) the sim is turning `bo` at, if it turned it at its latest touch, else 0. Turning: its
 * committed heading changed from the touch before (both seen by the interpolator, at most three round-robins apart),
 * and still differs from TargetHeading. Only then is its turn carried on between touches: a ship whose commands do not
 * turn it (waiting, docked, unloading — CalculateCurrentHeading runs only in DoMovement, the hyperjump legs and the
 * idle branch of ExecuteCommands, never for a base) can keep a TargetHeading it does not face. Updates `st`'s evidence
 * when a new touch is seen (once per touch, taken then: the next touch's speed, nextTouchSpeed, and turn rate at it,
 * builtObjectTurnRate; and the turnLimit — HEADING_EASE_FACTOR × the faster of that rate and the previous touch's,
 * which the samples being drawn may still turn at; none on a warp leg, whose heading the sim sets outright).
 */
function turnedAtLastTouch(m: MotionInterpolator, bo: MovingBuiltObject, st: MotionState | undefined): number {
    if (st === undefined) return 0;
    const t = bo.lastTouch;
    if (t === undefined) return 0;
    if (t !== st.tTouch) {
        const prev = st.tTouch;
        st.tTurning = prev === prev && t > prev && t - prev <= 3 * m.untouchedMaxMs && bo.heading !== st.tHeading && bo.role !== BuiltObjectRole.Base;
        st.tTouch = t;
        st.tHeading = bo.heading;
        const v = nextTouchSpeed(m, bo);
        const r = builtObjectTurnRate(bo, v);
        st.tSpeed = v;
        st.tRate = st.tTurning ? r : 0;
        st.tLimit = bo.currentSpeed > bo.topSpeed ? 0 : HEADING_EASE_FACTOR * Math.max(r, st.tRateAny);
        st.tRateAny = r;
    }
    return st.tTurning && bo.heading !== bo.targetHeading ? st.tRate : 0;
}

/**
 * The heading `bo`'s next touch gives it after `dtSeconds` untouched, if its orders hold: turned toward its
 * TargetHeading at `rate` (turnedAtLastTouch; 0: not turning) by turnHeading, else its committed heading.
 */
function untouchedHeading(bo: MovingBuiltObject, dtSeconds: number, rate: number): number {
    if (!(rate > 0) || !(dtSeconds > 0) || bo.targetHeading === undefined) return bo.heading;
    return turnHeading(bo.heading, bo.targetHeading, rate * dtSeconds);
}

/** sample()'s turnLimit for a built object not tracked by touch (no LastTouch): HEADING_EASE_FACTOR × the fastest it
 * turns (builtObjectTurnRate at rest). */
function builtObjectTurnLimit(bo: MovingBuiltObject): number {
    return HEADING_EASE_FACTOR * builtObjectTurnRate(bo, 0);
}

/**
 * Where a built object the background pass has not touched since `lastTouch` would be at `nowMs`: the committed
 * position carried on along `heading` at CurrentSpeed for the elapsed time (at most `maxMs`) — exactly the step
 * DoMovement / executeCommands.ts (BuiltObject.2.cs 4553-4560) applies when the object is next touched, if speed holds
 * and `heading` is the one that touch turns it to (the sim turns first, then moves along the new heading:
 * untouchedHeading).
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
 *
 * Its heading likewise: a ship the sim is turning (turnedAtLastTouch) is sampled at the heading its next touch turns
 * it to (untouchedHeading: toward TargetHeading at GetCurrentTurnRate), and moved along that heading as the touch
 * moves it, so it turns smoothly between touches instead of holding its heading and then swinging by the whole
 * round-robin's turn; a heading the next touch disagrees with is eased (sample's turnLimit, builtObjectTurnLimit).
 */
export function sampleBuiltObject(m: MotionInterpolator, bo: MovingBuiltObject, depth = 0): MotionState {
    const st0 = m.peek(bo);
    const rate = turnedAtLastTouch(m, bo, st0);
    const heading = rate > 0 ? untouchedHeading(bo, untouchedSeconds(m, bo.lastTouch!, m.untouchedMaxMs), rate) : bo.heading;
    // Taken at the latest touch (turnedAtLastTouch); none before the first sample, which snaps anyway.
    const tracked = st0 !== undefined && bo.lastTouch !== undefined;
    const limit = st0 === undefined ? 0 : tracked ? st0.tLimit : builtObjectTurnLimit(bo);
    // (A hyperjump leg's acceleration first, nextTouchSpeed; otherwise the committed speed as it stands.)
    const speed = tracked && bo.hyperjumpPrepare === true ? st0.tSpeed : bo.currentSpeed;
    const st = sampleBuiltObjectAs(m, bo, depth, heading, speed, limit);
    // First sight: its latest touch is the one the next is compared with (turnedAtLastTouch).
    if (st0 === undefined) turnedAtLastTouch(m, bo, st);
    return st;
}

/** sampleBuiltObject's placement (parent frames, extrapolated position) at drawn `heading`, extrapolation `speed`. */
function sampleBuiltObjectAs(m: MotionInterpolator, bo: MovingBuiltObject, depth: number, heading: number, speed: number, limit: number): MotionState {
    const maxSpeed = Math.max(bo.topSpeed, bo.warpSpeed, Math.abs(bo.currentSpeed));
    if (bo.parentOffsetX > PARENT_OFFSET_UNSET && bo.parentOffsetY > PARENT_OFFSET_UNSET) {
        const ox = bo.parentOffsetX;
        const oy = bo.parentOffsetY;
        // A ship flying relative to its parent (movement.ts moveToward: ParentOffset += heading × the distance) the
        // background pass has not touched this step: its offset carried on likewise (extrapolateUntouched), so it glides
        // instead of standing still and then jumping each round-robin touch.
        let fx = ox;
        let fy = oy;
        if (bo.lastTouch !== undefined && speed > 0) {
            const p = extrapolateUntouched(ox, oy, heading, speed, bo.lastTouch, m.simNowMs, m.untouchedMaxMs, extrapScratch);
            fx = p.x;
            fy = p.y;
        }
        // The sim's order (executeCommands.ts 413-444): relative to ParentBuiltObject, then ParentHabitat overrides it,
        // then DockedAt overrides both. Each is used only while the committed position really is parent + offset.
        const dock = bo.dockedAt ?? null;
        if (dock !== null && followsParent(bo, dock, ox, oy)) {
            if (isOrbitingBody(dock)) {
                if (dock.parent !== null) {
                    const o = m.habitatPos(dock);
                    return m.sample(bo, fx, fy, heading, maxSpeed, dock, o.x, o.y, 0, 0, Number.NaN, Number.NaN, limit);
                }
            } else if (isParentBuiltObject(bo, dock) && depth < MAX_PARENT_DEPTH) {
                return sampleInBuiltObjectFrame(m, bo, dock, fx, fy, heading, maxSpeed, limit, depth);
            }
        }
        const h = bo.parentHabitat;
        if (h !== null && h.parent !== null && !h.hasBeenDestroyed && followsParent(bo, h, ox, oy)) {
            const o = m.habitatPos(h);
            if (stationPull && bo.role === BuiltObjectRole.Base) {
                const d = (h as { diameter?: number }).diameter;
                if (typeof d === 'number') {
                    const q = pulledStationOffset(fx, fy, d, pullScratch);
                    fx = q.x;
                    fy = q.y;
                }
            }
            return m.sample(bo, fx, fy, heading, maxSpeed, h, o.x, o.y, 0, 0, Number.NaN, Number.NaN, limit);
        }
        const pb = bo.parentBuiltObject ?? null;
        if (pb !== null && isParentBuiltObject(bo, pb) && depth < MAX_PARENT_DEPTH && followsParent(bo, pb, ox, oy)) {
            return sampleInBuiltObjectFrame(m, bo, pb, fx, fy, heading, maxSpeed, limit, depth);
        }
    }
    if (bo.lastTouch !== undefined && speed > 0) {
        const p = extrapolateUntouched(bo.xpos, bo.ypos, heading, speed, bo.lastTouch, m.simNowMs, m.untouchedMaxMs, extrapScratch);
        return m.sample(bo, p.x, p.y, heading, maxSpeed, null, 0, 0, 0, 0, Number.NaN, Number.NaN, limit);
    }
    return m.sample(bo, bo.xpos, bo.ypos, heading, maxSpeed, null, 0, 0, 0, 0, Number.NaN, Number.NaN, limit);
}

/** Game seconds of one sim step at the fastest game speed (4×): stepSeconds bound for records taken at any speed. */
const MAX_STEP_SECONDS = 4 / FRAMES_PER_SECOND;

/**
 * Upper bound (world units) on how far `h`'s drawn position (renderHabitatPos) can be from its committed xpos / ypos:
 * for each orbiting level of its parent chain, the orbit angle is extrapolated by at most anglePerSecond × clampSeconds
 * (and a chord is never longer than the diameter), counted twice to cover the parent having moved since the child's
 * committed position was taken.
 */
export function habitatDrawnOffsetBound(h: OrbitingBody, clampSeconds: number): number {
    let b = 0;
    for (let n: OrbitingBody | null = h; n !== null && n.parent !== null; n = n.parent) {
        const r = Math.abs(n.orbitDistance);
        b += 2 * Math.min(2 * r, Math.abs(n.anglePerSecond) * Math.max(0, clampSeconds) * r);
    }
    return b;
}

/**
 * Upper bound (world units) on the distance between a built object's drawn position this frame (sampleBuiltObject /
 * drawnBuiltObjectPos) and its committed xpos / ypos, so callers can cull on the committed position before paying for
 * a sample: the step lerp (isJump keeps the previous step's estimate within SNAP_SPEED_FACTOR × speed × one step — at
 * 4× speed, for records taken at any speed — times the steps the presented instant trails the committed one,
 * MotionInterpolator.lagSteps, when more than one), the untouched extrapolation (currentSpeed × untouchedMaxMs — or
 * TargetSpeed for a ship preparing a hyperjump, which nextTouchSpeed accelerates toward it) and, when a
 * parent offset is set, the drift allowed by followsParent plus the parent's own bound (every candidate parent: dock,
 * ParentHabitat, ParentBuiltObject). Doubled for slack.
 */
export function builtObjectDrawnOffsetBound(m: MotionInterpolator, bo: MovingBuiltObject, depth = 0): number {
    const maxSpeed = Math.max(bo.topSpeed, bo.warpSpeed, Math.abs(bo.currentSpeed), SNAP_MIN_SPEED);
    const extrapSpeed = bo.hyperjumpPrepare === true ? Math.max(Math.abs(bo.currentSpeed), bo.targetSpeed ?? 0) : Math.abs(bo.currentSpeed);
    let b = SNAP_SPEED_FACTOR * maxSpeed * Math.max(MAX_STEP_SECONDS, m.stepSeconds) * Math.max(1, m.lagSteps) + (extrapSpeed * m.untouchedMaxMs) / 1000;
    if (bo.parentOffsetX > PARENT_OFFSET_UNSET && bo.parentOffsetY > PARENT_OFFSET_UNSET) {
        b += PARENT_FRAME_MAX_DRIFT + parentDrawnOffsetBound(m, bo.dockedAt, depth) + parentDrawnOffsetBound(m, bo.parentHabitat, depth) + parentDrawnOffsetBound(m, bo.parentBuiltObject, depth);
        // The cosmetic station pull moves a base by at most its whole offset.
        if (stationPull && bo.role === BuiltObjectRole.Base) b += Math.hypot(bo.parentOffsetX, bo.parentOffsetY);
    }
    return 2 * b;
}

function parentDrawnOffsetBound(m: MotionInterpolator, p: object | null | undefined, depth: number): number {
    if (p === null || p === undefined) return 0;
    if (isOrbitingBody(p)) return habitatDrawnOffsetBound(p, m.clampSeconds);
    if (depth < MAX_PARENT_DEPTH && typeof (p as MovingBuiltObject).parentOffsetX === 'number') return builtObjectDrawnOffsetBound(m, p as MovingBuiltObject, depth + 1);
    return 0;
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
function sampleInBuiltObjectFrame(m: MotionInterpolator, bo: MovingBuiltObject, parent: MovingBuiltObject, ox: number, oy: number, heading: number, maxSpeed: number, turnLimit: number, depth: number): MotionState {
    const d = m.drawn(parent) ?? sampleBuiltObject(m, parent, depth + 1);
    const px = d.x;
    const py = d.y;
    return m.sample(bo, ox, oy, heading, maxSpeed, parent, px, py, 0, 0, Number.NaN, Number.NaN, turnLimit);
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
    /** Creature._LastTouch (game SECONDS): when Move last advanced it. With the rest below: extrapolated between touches. */
    lastTouch?: number;
    targetHeading?: number;
    targetSpeed?: number;
    turnRate?: number;
    accelerationRate?: number;
    lungeAccelerationRate?: number;
}

/**
 * Sample a creature: relative to its orbiting ParentHabitat while it rests there (creature.ts move: TargetSpeed and
 * CurrentSpeed 0 ⇒ xpos = ParentHabitat.xpos + parentX), else in galaxy coordinates. The background pass moves only 50
 * creatures a step (scheduler.ts "GxCr" int_44), so with more creatures each one moves every ceil(n / 50) steps — a
 * burst of several steps' motion, then standing still. A moving creature is sampled where its next Move will put it
 * (extrapolateMover over the time since its LastTouch, bounded by one round-robin), so it glides between touches; in the
 * habitat's frame the offset is extrapolated (Move steps parentX / parentY along the heading).
 */
export function sampleCreature(m: MotionInterpolator, c: MovingCreature): MotionState {
    const maxSpeed = Math.max(Math.abs(c.currentSpeed), c.movementSpeed, c.hyperSpeed, c.lungeSpeed);
    const h = c.parentHabitat;
    // Creature.cs Move: only a creature at rest (TargetSpeed and CurrentSpeed 0) is placed at ParentHabitat + parentX —
    // it follows the (committed) planet. A moving one steps its galaxy position (parentX = xpos − parent.xpos is
    // recomputed from it each Move), so it does not follow the planet: drawn in the planet's frame its offset would jump
    // back by the planet's round-robin orbit step at each touch (a reversal), so it is drawn in galaxy coordinates.
    const moving = c.currentSpeed > 0 || (c.targetSpeed ?? 0) > 0;
    const inFrame = h !== null && h.parent !== null && !h.hasBeenDestroyed && !moving;
    let x = inFrame ? c.parentX : c.xpos;
    let y = inFrame ? c.parentY : c.ypos;
    let heading = c.currentHeading;
    if (c.lastTouch !== undefined && moving && c.currentSpeed <= Math.max(c.movementSpeed, c.lungeSpeed)) {
        // Sub-light only: a hyperspeed leg ends in a relocation to a hyperjump exit, never where the line points.
        const dt = untouchedSeconds(m, c.lastTouch * 1000, m.creatureUntouchedMaxMs);
        if (dt > 0) {
            const target = c.targetSpeed ?? c.currentSpeed;
            // A lunge (TargetSpeed = LungeSpeed above MovementSpeed) accelerates at LungeAccelerationRate (Creature.cs Move).
            const accel = target > c.movementSpeed && c.lungeSpeed > 0 ? (c.lungeAccelerationRate ?? c.accelerationRate ?? 0) : (c.accelerationRate ?? 0);
            // Creature.cs CalculateCurrentHeading does not wrap target − heading (turnHeading wrapDiff false).
            const p = extrapolateMover(x, y, heading, c.targetHeading ?? heading, c.turnRate ?? 0, c.currentSpeed, target, accel, dt, moverScratch, false);
            x = p.x;
            y = p.y;
            heading = p.heading;
        }
    }
    // The drawn heading turns at most HEADING_EASE_FACTOR × the creature's TurnRate (a touch it did not lead up to eases).
    const turnLimit = HEADING_EASE_FACTOR * (c.turnRate ?? 0);
    if (inFrame) {
        const o = m.habitatPos(h);
        return m.sample(c, x, y, heading, maxSpeed, h, o.x, o.y, 0, 0, Number.NaN, Number.NaN, turnLimit);
    }
    return m.sample(c, x, y, heading, maxSpeed, null, 0, 0, 0, 0, Number.NaN, Number.NaN, turnLimit);
}

/** Fighter fields read by sampleFighter. */
export interface MovingFighter {
    xpos: number;
    ypos: number;
    heading: number;
    targetHeading: number;
    currentSpeed: number;
    readonly targetSpeed: number;
    topSpeed: number;
    /** Fighter._LastTouch (game ms): when its carrier's DoTasks last ran Fighter.DoTasks → DoMovement. */
    lastTouch: number;
    onboardCarrier: boolean;
    readonly specification: { readonly turnRate: number; readonly accelerationRate: number };
    /** Fighter.InView of its last DoTasks (the leash below applies only off view). Absent: not in view. */
    inView?: boolean;
    /** Fighter.MissionType (FighterMissionType: 2 Patrol), which sets the leash radius. Absent: no leash. */
    missionType?: number;
    /** The carrier (Fighter.ParentBuiltObject): the leash centre. */
    parentBuiltObject?: MovingBuiltObject | null;
}

/** Fighter.cs 2069 GetCurrentTurnRate(speed): ×4 at or below 12 % of top speed, ×2.6 below 25 %, ×1.6 below 50 %. */
export function fighterTurnRate(turnRate: number, speed: number, topSpeed: number): number {
    let r = turnRate;
    if (speed <= topSpeed * 0.12) r *= 4;
    if (speed < topSpeed * 0.25) r *= 2.6;
    if (speed < topSpeed * 0.5) r *= 1.6;
    return r;
}

/**
 * Sample a fighter (galaxy coordinates). Fighters move only when their carrier's DoTasks runs (builtObjectTick.ts:
 * Fighter.DoTasks for each of bo.fighters), so in a galaxy with more than 1000 built objects a fighter moves every
 * ceil(n / 1000) steps like its carrier — several steps' motion in one, then standing still. It is sampled where its
 * next DoMovement will put it (extrapolateMover from its LastTouch, bounded like the carrier's extrapolation, then the
 * leash: fighterLeashOf), so it glides between touches and turns smoothly; a touched-this-step fighter is sampled at
 * its committed position. Its motion over the next step goes with the sample, for the track of a soft snap.
 */
export function sampleFighter(m: MotionInterpolator, f: MovingFighter): MotionState {
    const maxSpeed = Math.max(f.topSpeed, Math.abs(f.currentSpeed));
    if (f.onboardCarrier) return m.sample(f, f.xpos, f.ypos, f.heading, maxSpeed, null, 0, 0, 0, FIGHTER_SOFT_SNAP_MS);
    // The drawn heading turns at most HEADING_EASE_FACTOR × the fastest the fighter turns (GetCurrentTurnRate at rest).
    const turnLimit = HEADING_EASE_FACTOR * fighterTurnRate(f.specification.turnRate, 0, f.topSpeed);
    const dt = untouchedSeconds(m, f.lastTouch, m.untouchedMaxMs);
    const stepS = m.stepSeconds > 0 ? m.stepSeconds : 1 / FRAMES_PER_SECOND;
    // The game instant the sample stands for: its LastTouch + dt (the committed position is LastTouch's).
    const t0 = f.lastTouch > MIN_TIME ? f.lastTouch : m.simNowMs;
    const atMs = t0 + dt * 1000;
    const lp = fighterLeashOf(m, f, atMs, leashP);
    const p = fighterAt(f, dt, lp, fighterPoseA);
    const clamped = leashClamped;
    const lq = lp === null ? null : fighterLeashOf(m, f, t0 + (dt + stepS) * 1000, leashQ);
    const q = fighterAt(f, dt + stepS, lq, fighterPoseB);
    if (lp !== null && lq !== null && lp.framed) {
        // On the leash: where the next touch puts it (or, at its committed position, where its last touch did).
        const lw = m.leashWeight(f, atMs, dt > 0 ? clamped : onLeash(f, lp));
        // Smoothstep: no kink in the drawn motion where the weight starts or stops moving.
        const w = lw * lw * (3 - 2 * lw);
        toDrawnLeash(p, dt > 0 ? lp.nextX : lp.comX, dt > 0 ? lp.nextY : lp.comY, lp, w);
        toDrawnLeash(q, lq.nextX, lq.nextY, lq, w);
    }
    return m.sample(f, p.x, p.y, p.heading, maxSpeed, null, 0, 0, 0, FIGHTER_SOFT_SNAP_MS, q.x - p.x, q.y - p.y, turnLimit);
}

/** The leash a fighter's next DoMovement applies (fighterLeashOf; a scratch record). */
interface FighterLeash {
    /** Leash radius (Fighter.cs 1805-1829: 600 on patrol, else 1500). */
    r: number;
    /** The carrier's committed position: what the fighter's committed position was put on the circle around. */
    comX: number;
    comY: number;
    /** Where the carrier's next touch puts it (it moves before its fighters, in the same DoTasks), extrapolated to the
     * instant: the centre of the leash on an extrapolated fighter position. */
    nextX: number;
    nextY: number;
    /** Whether the carrier is placed relative to an orbiting habitat (carrierHabitat). */
    framed: boolean;
    /** The carrier as drawn at the instant: on its habitat's drawn orbit when framed, else `next`. The circle a fighter
     * on the leash is drawn on. */
    drawnX: number;
    drawnY: number;
}

const leashP: FighterLeash = { r: 0, comX: 0, comY: 0, nextX: 0, nextY: 0, framed: false, drawnX: 0, drawnY: 0 };
const leashQ: FighterLeash = { r: 0, comX: 0, comY: 0, nextX: 0, nextY: 0, framed: false, drawnX: 0, drawnY: 0 };
const fighterPoseA: MoverPose = { x: 0, y: 0, heading: 0 };
const fighterPoseB: MoverPose = { x: 0, y: 0, heading: 0 };
const leashHabitatScratch: Point = { x: 0, y: 0 };
/** Whether the last fighterAt call put its extrapolated position back on the leash. */
let leashClamped = false;

/** FighterMissionType.Patrol (sim/combat/fighters.ts; not imported: render reads it as a number). */
const FIGHTER_MISSION_PATROL = 2;
/** Fighter.cs 1805-1829 DoMovement leash radii: 600 on patrol, 1500 otherwise. */
const FIGHTER_LEASH_PATROL = 600;
const FIGHTER_LEASH_OTHER = 1500;
/** Game ms over which a fighter coming onto its leash (or leaving it) goes over to being drawn on the drawn carrier's
 * circle (or back to where it is): MotionInterpolator.leashWeight. */
export const FIGHTER_LEASH_EASE_MS = 500;

/**
 * The leash the next DoMovement applies to `f` (Fighter.cs 1805-1829: a fighter not in view that ends its move
 * outside the circle around its carrier is put on the circle, along the carrier → fighter line), its carrier taken
 * at game instant `tMs`; null when none applies (in view, on board, no carrier). Writes `out`.
 *
 * A carrier placed relative to an orbiting habitat (a base at its planet, a ship parked or docked there) has its
 * committed position moved only when it is touched after its habitat was (the habitat round-robin: every
 * ceil(habitats / 1000) steps), so it steps along the orbit — and with it every fighter on its leash, a few units in one
 * step — while the carrier itself is drawn on the habitat's interpolated orbit (sampleBuiltObject). `drawn` is that
 * smooth position, for toDrawnLeash to draw the fighters on the leash around.
 */
function fighterLeashOf(m: MotionInterpolator, f: MovingFighter, tMs: number, out: FighterLeash): FighterLeash | null {
    const c = f.parentBuiltObject;
    if (c == null || f.inView === true || f.missionType === undefined) return null;
    out.r = f.missionType === FIGHTER_MISSION_PATROL ? FIGHTER_LEASH_PATROL : FIGHTER_LEASH_OTHER;
    out.comX = c.xpos;
    out.comY = c.ypos;
    // The carrier moves as sampleBuiltObject extrapolates it: at its next touch's speed, along the heading that touch
    // turns it to.
    const cs = c.lastTouch !== undefined ? m.stateOf(c) : undefined;
    const rate = turnedAtLastTouch(m, c, cs);
    const cv = cs !== undefined && c.hyperjumpPrepare === true ? cs.tSpeed : c.currentSpeed;
    const moving = c.lastTouch !== undefined && cv > 0;
    const ch = moving && rate > 0 ? untouchedHeading(c, Math.max(0, Math.min(tMs - c.lastTouch!, m.untouchedMaxMs)) / 1000, rate) : c.heading;
    const h = carrierHabitat(c);
    out.framed = h !== null;
    if (h !== null) {
        let ox = c.parentOffsetX;
        let oy = c.parentOffsetY;
        if (moving) {
            const q = extrapolateUntouched(ox, oy, ch, cv, c.lastTouch!, tMs, m.untouchedMaxMs, extrapScratch);
            ox = q.x;
            oy = q.y;
        }
        out.nextX = h.xpos + ox;
        out.nextY = h.ypos + oy;
        const hp = renderHabitatPos(h, tMs, m.clampSeconds, leashHabitatScratch);
        out.drawnX = hp.x + ox;
        out.drawnY = hp.y + oy;
        return out;
    }
    if (moving) {
        const q = extrapolateUntouched(c.xpos, c.ypos, ch, cv, c.lastTouch!, tMs, m.untouchedMaxMs, extrapScratch);
        out.nextX = q.x;
        out.nextY = q.y;
    } else {
        out.nextX = c.xpos;
        out.nextY = c.ypos;
    }
    out.drawnX = out.nextX;
    out.drawnY = out.nextY;
    return out;
}

/** The orbiting habitat `bo`'s committed position follows (sampleBuiltObject's habitat frames: DockedAt, else
 * ParentHabitat, each + ParentOffset), or null. */
function carrierHabitat(bo: MovingBuiltObject): OrbitingBody | null {
    const ox = bo.parentOffsetX;
    const oy = bo.parentOffsetY;
    if (!(ox > PARENT_OFFSET_UNSET && oy > PARENT_OFFSET_UNSET)) return null;
    const dock = bo.dockedAt ?? null;
    if (dock !== null && isOrbitingBody(dock) && dock.parent !== null && followsParent(bo, dock, ox, oy)) return dock;
    const h = bo.parentHabitat;
    if (h !== null && h.parent !== null && !h.hasBeenDestroyed && followsParent(bo, h, ox, oy)) return h;
    return null;
}

/**
 * Where `f` will be `dt` game s after its LastTouch (0: its committed position): extrapolated (extrapolateMover) and
 * put back on the leash circle around where the carrier will be, as its next DoMovement will — the extrapolation would
 * otherwise carry a fighter flying outward past the circle between touches, and every touch pull it back: a small
 * reversal per touch while it slides round the circle. Sets leashClamped. Writes `out`.
 */
function fighterAt(f: MovingFighter, dt: number, leash: FighterLeash | null, out: MoverPose): MoverPose {
    leashClamped = false;
    if (!(dt > 0)) {
        out.x = f.xpos;
        out.y = f.ypos;
        out.heading = f.heading;
        return out;
    }
    const spec = f.specification;
    extrapolateMover(f.xpos, f.ypos, f.heading, f.targetHeading, fighterTurnRate(spec.turnRate, f.currentSpeed, f.topSpeed), f.currentSpeed, f.targetSpeed, spec.accelerationRate, dt, out);
    if (leash === null) return out;
    const r = leash.r;
    const dx = out.x - leash.nextX;
    const dy = out.y - leash.nextY;
    const d2 = dx * dx + dy * dy;
    if (d2 > r * r) {
        const k = r / Math.sqrt(d2);
        out.x = leash.nextX + dx * k;
        out.y = leash.nextY + dy * k;
        leashClamped = true;
    }
    return out;
}

/** Whether `f`'s committed position is on its leash circle around its committed carrier (put there by its last touch). */
function onLeash(f: MovingFighter, leash: FighterLeash): boolean {
    const d = Math.hypot(f.xpos - leash.comX, f.ypos - leash.comY);
    return d >= leash.r * (1 - 1e-9);
}

/**
 * Fighter position `p` drawn on the leash around the carrier as drawn (FighterLeash.drawn) rather than around its
 * committed position (the sim's circle around (cx, cy)), which steps:
 * - moved by weight `w` (0..1: on the leash) onto the drawn circle, along the drawn carrier → fighter line. To first
 *   order a step of the sim's centre moves the fighters on its circle only radially, which this takes out; and as it
 *   depends on `p` and the drawn carrier only, not on the sim's centre, a fighter the carrier steps away from (inside
 *   the new circle: let go) stays where it was drawn while `w` eases it off;
 * - then kept inside the drawn circle, as the sim keeps it inside its own at each touch: a fighter the drawn carrier
 *   moves away from is carried along as the circle reaches it, not pulled in at the carrier's next step.
 * One outside the sim's circle (a reset pending: its mission's leash just shrank) is moved as its point on that circle
 * would be, and not kept inside (its reset is shown when the sim makes it: a soft snap). Writes `p`.
 */
function toDrawnLeash(p: MoverPose, cx: number, cy: number, leash: FighterLeash, w: number): void {
    const r = leash.r;
    let bx = p.x;
    let by = p.y;
    const dx = bx - cx;
    const dy = by - cy;
    const d = Math.sqrt(dx * dx + dy * dy);
    const pending = d > r * (1 + 1e-9);
    if (pending) {
        bx = cx + (dx * r) / d;
        by = cy + (dy * r) / d;
    }
    let ex = bx - leash.drawnX;
    let ey = by - leash.drawnY;
    let e = Math.sqrt(ex * ex + ey * ey);
    if (!(e > 0)) return;
    if (w > 0) {
        p.x += (leash.drawnX + (ex * r) / e - bx) * w;
        p.y += (leash.drawnY + (ey * r) / e - by) * w;
    }
    if (pending) return;
    ex = p.x - leash.drawnX;
    ey = p.y - leash.drawnY;
    e = Math.sqrt(ex * ex + ey * ey);
    if (e > r) {
        p.x = leash.drawnX + (ex * r) / e;
        p.y = leash.drawnY + (ey * r) / e;
    }
}

/**
 * Game ms over which a fighter's position reset is eased out instead of popping (at least: a longer reset takes longer,
 * MotionInterpolator.easeJump). Fighter.cs 1805-1829 DoMovement: a fighter whose carrier is not in view (`!InView`) is
 * put back on a circle around its carrier — 600 units on patrol, 1500 on attack — whenever it strays outside it, so
 * when a fight ends (Attack → Patrol) every fighter beyond 600 is moved there in one step (200-340 units seen on the
 * 4000-star test galaxy: eased over 410-520 ms). The original only does this off screen (on-screen carriers are ticked
 * with InView, Main.Part11.cs ProcessMain); this port ticks every object as not in view unless `?simView=1`
 * (simLoop.ts), so on-screen fighters get the reset too. The sim stays as it is (the off-view tick is what replay
 * needs); the drawn fighter slides to its new place.
 */
export const FIGHTER_SOFT_SNAP_MS = 400;

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
 *
 * A shot moves only when its firer is touched (HandleWeaponsFiring in the ship's / habitat's DoTasks, Fighter.DoTasks
 * for a fighter's), by its speed × the time since that touch. Habitats are touched every ceil(n / 1000) steps (13 000
 * habitats on the seed-1 galaxy: every 14 steps), ships beyond 1000 built objects every ceil(n / 1000), so the committed
 * shot advances in bursts. Given the firer's LastTouch (game ms), the speed it flies at along its heading (`flightSpeed`,
 * world units / game s; 0 for shots that do not fly in a line: area rings, stretched beams, the launch step) and the
 * extrapolation bound (`maxMs`: one round-robin of the firer's kind), it is sampled where the next touch will put it.
 */
export function sampleShot(m: MotionInterpolator, w: MovingShot, firerLastTouchMs = Number.NaN, flightSpeed = 0, maxMs = m.untouchedMaxMs): MotionState {
    if (flightSpeed > 0) {
        const dt = untouchedSeconds(m, firerLastTouchMs, maxMs);
        if (dt > 0) {
            const d = flightSpeed * dt;
            return m.sample(w, w.x + Math.cos(w.heading) * d, w.y + Math.sin(w.heading) * d, w.heading, w.speed, null, 0, 0, w.lastFired);
        }
    }
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
