// Drawn headings of ships the background round-robin touches only every few steps (src/render/renderInterp.ts
// sampleBuiltObject: turnedAtLastTouch / untouchedHeading, MotionInterpolator.sample `turnLimit`).
//
// With more than 1000 built objects the background pass (scheduler.ts backgroundPass "GxBO") touches each ship every
// ceil(n / 1000) steps, and CalculateCurrentHeading (BuiltObject.2.cs 7433) turns it by GetCurrentTurnRate × the whole
// time since its last touch at once. Drawn from the committed heading, a turning ship held its heading for ~11 steps
// and then swung by the whole round-robin's turn (the user's "ships turning does not look smooth, it's jumpy" on a
// 4000-star late game). Now a ship the sim turned at its latest touch is sampled at the heading its next touch turns
// it to (toward TargetHeading at the C# turn rate, then moved along that heading as DoMovement moves it), and a
// heading the next touch disagrees with is eased instead of snapped (turnLimit: HEADING_EASE_FACTOR × its turn rate).
//
// Measured as scripts/perf-render.mjs --motion does in the browser (HeadingProbe below): the sim's continuous heading
// is its committed heading at each touch lerped between touches; on a steady turn (every touch interval around the
// drawn instant turned at one rate) q = the drawn heading's change per frame / the sim's, with stalls (q < 0.25),
// jumps (q > 2), reversals (q < 0) and jerk |Δq|; plus drawn turns of ships the sim does not turn, and pops (a
// frame's drawn change over twice the fastest rate around it). Both modes: in-thread (the late-game step pattern,
// several steps one frame and none the next, through the PresentationClock) and the sim worker (irregular bursts;
// end to end through SimHost / SimClientCore on the real galaxy).
import { beforeAll, describe, expect, it } from 'vitest';
import { appendFileSync } from 'node:fs';
import { createGame, type Game } from '../src/sim/game';
import type { Galaxy } from '../src/sim/galaxy';
import type { BuiltObject } from '../src/sim/builtObject';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { tickGameOptions } from './helpers/tickGame';
import { cachedTickGame } from './helpers/gameCache';
import type { GameData } from '../src/sim/data/gameData';
import { runGameSeconds } from '../src/sim/tick/harness';
import { FRAME_REAL_MS, runSimFrame } from '../src/sim/tick/scheduler';
import { accelerateToTargetSpeed, calculateCurrentHeading, getCurrentTurnRate } from '../src/sim/movement';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { buildNewFighters, fightersOf, fighterDoMovement } from '../src/sim/combat/fighters';
import { captainBonusMap } from '../src/sim/characters';
import { pirateEscort, playerCarrierPort } from './helpers/combatCast';
import { builtObjectMission } from '../src/sim/missions/mission';
import { BuiltObjectFleeWhen } from '../src/sim/data/designSpecifications';
import { ComponentCategoryType } from '../src/sim/data/policies';
import { ComponentStatus } from '../src/sim/builtObjectComponent';
import { updateIndexesForMovement, updatePosition } from '../src/sim/movement';
import { GalaxyTime } from '../src/sim/galaxyTime';
import type { StartGameOptions } from '../src/sim/startGameOptions';
import { SimHost } from '../src/simworker/simHost';
import { SimClientCore } from '../src/simworker/clientCore';
import { SimFrameBudget, type SteppableDriver } from '../src/simFrameBudget';
import {
    HEADING_EASE_FACTOR,
    MotionInterpolator,
    PresentationClock,
    builtObjectTurnRate,
    createRenderTime,
    fighterTurnRate,
    habitatTouchClampSeconds,
    sampleBuiltObject,
    turnHeading,
    updateRenderTime,
    wrapAngle,
    sampleCreature,
    sampleFighter,
    type MotionState,
    type MovingBuiltObject,
    type RenderTime,
} from '../src/render/renderInterp';

const TWO_PI = Math.PI * 2;

/** The measurements (console; also appended to the file HLOG names, if set). */
function log(msg: string): void {
    console.log(msg);
    if (process.env.HLOG) appendFileSync(process.env.HLOG, `${msg}\n`);
}

function rng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

// ---------------------------------------------------------------------------------------------------------- probe

interface Track {
    /** Touches: LastTouch (game ms) and the committed heading after it. */
    tau: number[];
    th: number[];
    /** Drawn frames: frame number, drawn instant (game ms), drawn heading, and the sample's context: 0 galaxy frame,
     * 1 a parent's frame, 2 snapped this frame (a teleport, first sight: the history starts over at one sample). */
    fN: number[];
    fT: number[];
    fH: number[];
    fF: number[];
}

/** HeadingProbe.note's context of a sample (MotionState). */
function ctxOf(st: MotionState): number {
    return st.hn === 1 ? 2 : st.frame !== null ? 1 : 0;
}

interface HeadingStats {
    objects: number;
    /** Frame pairs on a steady turn, and their stalls / jumps / reversals (counts). */
    steady: number;
    stall: number;
    jump: number;
    rev: number;
    qP50: number;
    jerkP95: number;
    /** Frame pairs in touch intervals the sim did not turn at all, and those drawn turning (> 0.003 rad). */
    still: number;
    falseTurn: number;
    /** Frame pairs just after a turn stopped, and those drawn turning away from where it stopped. */
    stop: number;
    stopAway: number;
    /** All frame pairs with known touch intervals, and those whose drawn change exceeds 2 × the fastest rate around. */
    pairs: number;
    pops: number;
    /** Largest drawn heading change in one frame (rad) over all pairs. */
    maxStep: number;
}

/** A frame turning more than this × the sim's turn is a jump (an eased catch-up runs at HEADING_EASE_FACTOR, 2). */
const JUMP_Q = 2.05;

/** scripts/perf-render.mjs --motion's heading analysis (headingSummary), on any objects. */
class HeadingProbe {
    private tracks = new Map<object, Track>();
    readonly debug: string[] = [];
    note(obj: object, touchMs: number, committedHeading: number, frame: number, drawnMs: number, drawnHeading: number, ctx: number): void {
        let t = this.tracks.get(obj);
        if (t === undefined) {
            t = { tau: [], th: [], fN: [], fT: [], fH: [], fF: [] };
            this.tracks.set(obj, t);
        }
        if (t.tau.length === 0 || t.tau[t.tau.length - 1] !== touchMs) {
            t.tau.push(touchMs);
            t.th.push(committedHeading);
        }
        t.fN.push(frame);
        t.fT.push(drawnMs);
        t.fH.push(drawnHeading);
        t.fF.push(ctx);
    }
    /** HDEBUG: a frame pair's context (touches and drawn frames around it). */
    private dump(why: string, tau: number[], th: number[], fT: number[], fH: number[], n: number, k0: number, k1: number, i: number, dh: number, dH: number): void {
        if (!process.env.HDEBUG || this.debug.length >= 30) return;
        const ts: string[] = [];
        for (let k = Math.max(0, k0 - 2); k <= Math.min(n - 1, k1 + 2); k++) ts.push(`${k === k0 ? '*' : ''}${tau[k].toFixed(0)}:${th[k].toFixed(4)}`);
        const fs: string[] = [];
        for (let j = Math.max(1, i - 5); j <= Math.min(fT.length - 1, i + 3); j++) fs.push(`${j === i ? '>' : ''}${fT[j].toFixed(1)}:${fH[j].toFixed(4)}`);
        this.debug.push(`${why} dh=${dh.toFixed(4)} dH=${dH.toFixed(4)}\n   touches ${ts.join(' ')}\n   frames ${fs.join(' ')}`);
    }
    summary(): HeadingStats {
        const s: HeadingStats = { objects: this.tracks.size, steady: 0, stall: 0, jump: 0, rev: 0, qP50: Number.NaN, jerkP95: Number.NaN, still: 0, falseTurn: 0, stop: 0, stopAway: 0, pairs: 0, pops: 0, maxStep: 0 };
        const qs: number[] = [];
        const jerk: number[] = [];
        for (const { tau, th, fN, fT, fH, fF } of this.tracks.values()) {
            const n = tau.length;
            if (n < 3) continue;
            const r: number[] = [];
            for (let k = 0; k + 1 < n; k++) r.push(tau[k + 1] > tau[k] ? wrapAngle(th[k + 1] - th[k]) / (tau[k + 1] - tau[k]) : Number.NaN);
            const at = (T: number): number => {
                if (!(T >= tau[0])) return -1;
                let lo = 0;
                let hi = n - 1;
                while (lo < hi) {
                    const mid = (lo + hi + 1) >> 1;
                    if (tau[mid] <= T) lo = mid;
                    else hi = mid - 1;
                }
                return lo;
            };
            let lastQ = Number.NaN;
            for (let i = 1; i < fN.length; i++) {
                if (fN[i] !== fN[i - 1] + 1 || fF[i] !== fF[i - 1] || fF[i] === 2) {
                    lastQ = Number.NaN;
                    continue;
                }
                const T0 = fT[i - 1];
                const T1 = fT[i];
                if (!(T1 > T0)) continue;
                const k0 = at(T0);
                const k1 = at(T1);
                if (k0 < 1 || k1 < 0 || k1 + 1 >= n) {
                    lastQ = Number.NaN;
                    continue;
                }
                let dH = 0;
                for (let k = k0; k <= k1; k++) dH += r[k] * (Math.min(T1, tau[k + 1]) - Math.max(T0, tau[k]));
                const dh = wrapAngle(fH[i] - fH[i - 1]);
                let rMin = Infinity;
                let rMax = -Infinity;
                let aMax = 0;
                let restStill = true;
                for (let k = k0 - 1; k <= k1; k++) {
                    rMin = Math.min(rMin, r[k]);
                    rMax = Math.max(rMax, r[k]);
                    aMax = Math.max(aMax, Math.abs(r[k]));
                    if (k >= k0 && r[k] !== 0) restStill = false;
                }
                if (!Number.isFinite(rMin) || !Number.isFinite(rMax)) {
                    lastQ = Number.NaN;
                    continue;
                }
                s.pairs++;
                s.maxStep = Math.max(s.maxStep, Math.abs(dh));
                if (Math.abs(dh) > 2 * aMax * (T1 - T0) + 0.01) s.pops++;
                if (rMin === 0 && rMax === 0) {
                    s.still++;
                    if (Math.abs(dh) > 0.003) s.falseTurn++;
                    lastQ = Number.NaN;
                    continue;
                }
                if (restStill) {
                    s.stop++;
                    if (Math.abs(dh) > 0.003 && Math.abs(wrapAngle(fH[i] - th[k0])) > Math.abs(wrapAngle(fH[i - 1] - th[k0])) + 1e-9) {
                        s.stopAway++;
                        this.dump('AWAY', tau, th, fT, fH, n, k0, k1, i, dh, dH);
                    }
                    lastQ = Number.NaN;
                    continue;
                }
                const lo = Math.min(Math.abs(rMin), Math.abs(rMax));
                const hi = Math.max(Math.abs(rMin), Math.abs(rMax));
                if (!(rMin * rMax > 0 && lo >= 1e-5 && hi <= 1.1 * lo) || Math.abs(dH) < 1e-6) {
                    lastQ = Number.NaN;
                    continue;
                }
                s.steady++;
                const q = dh / dH;
                if (q < 0.25 || q > JUMP_Q) this.dump(`q=${q.toFixed(3)}`, tau, th, fT, fH, n, k0, k1, i, dh, dH);
                qs.push(q);
                if (q < 0) s.rev++;
                else if (q < 0.25) s.stall++;
                else if (q > JUMP_Q) s.jump++;
                if (Number.isFinite(lastQ)) {
                    jerk.push(Math.abs(q - lastQ));
                    if (Math.abs(q - lastQ) > 0.3) this.dump(`JERK ${lastQ.toFixed(3)}→`, tau, th, fT, fH, n, k0, k1, i, dh, dH);
                }
                lastQ = q;
            }
        }
        const pct = (a: number[], f: number): number => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * f))] : Number.NaN);
        s.qP50 = pct(qs, 0.5);
        s.jerkP95 = pct(jerk, 0.95);
        return s;
    }
}

const pc = (x: number, n: number): string => (n ? ((100 * x) / n).toFixed(2) : '-');
const fmt = (s: HeadingStats): string =>
    `objects=${s.objects} steady=${s.steady} stall%=${pc(s.stall, s.steady)} jump%=${pc(s.jump, s.steady)} rev%=${pc(s.rev, s.steady)} q50=${s.qP50.toFixed(3)} jerkP95=${s.jerkP95.toFixed(3)} | still=${s.still} false%=${pc(s.falseTurn, s.still)} | stop=${s.stop} away%=${pc(s.stopAway, s.stop)} | pairs=${s.pairs} pops%=${pc(s.pops, s.pairs)} maxStep=${s.maxStep.toFixed(3)}`;

/**
 * Visible jumps (scripts/perf-render.mjs --motion's visibleJumps, online): each frame's drawn move and rotation (per
 * frame time) against the frame before and the frame after — how far the move lies off the segment between theirs, less
 * 5 % of its own length, and the rotation outside their range. Smooth motion (steady, turning, starting, stopping,
 * speeding up) stays on it; a pop, a one-frame stall or a surge does not. Counted over 50 world units (a pixel at system
 * zoom) and 1.5°; frames next to a snap (teleport, first sight) are left out.
 */
class VisibleJumps {
    private last = new Map<object, { n: number[]; t: number[]; x: number[]; y: number[]; h: number[]; snap: boolean[] }>();
    samples = 0;
    pos = 0;
    head = 0;
    note(obj: object, frame: number, t: number, x: number, y: number, h: number, snapped: boolean): void {
        let r = this.last.get(obj);
        if (r === undefined) this.last.set(obj, (r = { n: [], t: [], x: [], y: [], h: [], snap: [] }));
        r.n.push(frame);
        r.t.push(t);
        r.x.push(x);
        r.y.push(y);
        r.h.push(h);
        r.snap.push(snapped);
        if (r.n.length > 4) {
            r.n.shift();
            r.t.shift();
            r.x.shift();
            r.y.shift();
            r.h.shift();
            r.snap.shift();
        }
        if (r.n.length < 4 || r.n[3] - r.n[0] !== 3 || r.snap.some((v) => v)) return;
        const med = 1000 / 60;
        const mv = (j: number): [number, number, number] => {
            const dt = r!.t[j + 1] - r!.t[j];
            return [((r!.x[j + 1] - r!.x[j]) / dt) * med, ((r!.y[j + 1] - r!.y[j]) / dt) * med, (wrapAngle(r!.h[j + 1] - r!.h[j]) / dt) * med];
        };
        const w = mv(0);
        const u = mv(1);
        const v = mv(2);
        const sx = v[0] - w[0];
        const sy = v[1] - w[1];
        const L = sx * sx + sy * sy;
        const k = L > 0 ? Math.max(0, Math.min(1, ((u[0] - w[0]) * sx + (u[1] - w[1]) * sy) / L)) : 0;
        const pp = Math.hypot(u[0] - (w[0] + sx * k), u[1] - (w[1] + sy * k)) - 0.05 * Math.hypot(u[0], u[1]);
        const hh = (Math.max(0, u[2] - Math.max(w[2], v[2]), Math.min(w[2], v[2]) - u[2]) * 180) / Math.PI;
        this.samples++;
        if (pp > 50) this.pos++;
        if (hh > 1.5) this.head++;
    }
    summary(): string {
        const pc = (x: number): string => (this.samples ? ((100 * x) / this.samples).toFixed(4) : '-');
        return `visible jumps: frames ${this.samples}, position > 50 units ${this.pos} (${pc(this.pos)} %), heading > 1.5° ${this.head} (${pc(this.head)} %)`;
    }
}

// ---------------------------------------------------------------------------------------------- synthetic fleet

/** A ship as sampleBuiltObject reads it, turned and moved by the sim's own CalculateCurrentHeading (movement.ts). */
interface SimShip extends MovingBuiltObject {
    lastTouch: number;
    targetHeading: number;
    turnRate: number;
    shipGroup: null;
    role: BuiltObjectRole;
    /** What the ship's touches do: 'move' (DoMovement: turn, then move at the committed speed), 'wait' (no turn). */
    orders: (touch: number) => 'move' | 'wait';
    /** Sets TargetHeading at a touch (null: keep it). */
    aim: (touch: number, s: SimShip) => number | null;
    touches: number;
    offset: number;
}

/** BuiltObject.2.cs DoMovement's turn and move (calculateCurrentHeading then CurrentSpeed × time along the new heading). */
function touchShip(s: SimShip, nowMs: number): void {
    const dt = (nowMs - s.lastTouch) / 1000;
    const aim = s.aim(s.touches, s);
    if (aim !== null) s.targetHeading = aim;
    if (s.orders(s.touches) === 'move') {
        const d = s.currentSpeed * dt;
        calculateCurrentHeading(null as unknown as Galaxy, s as unknown as BuiltObject, dt);
        s.xpos += Math.cos(s.heading) * d;
        s.ypos += Math.sin(s.heading) * d;
    }
    s.lastTouch = nowMs;
    s.touches++;
}

function ship(o: Partial<SimShip> & { heading: number; targetHeading: number }): SimShip {
    return {
        xpos: 0,
        ypos: 0,
        topSpeed: 20,
        warpSpeed: 0,
        currentSpeed: 18,
        parentHabitat: null,
        parentOffsetX: -2000000001,
        parentOffsetY: -2000000001,
        lastTouch: 0,
        turnRate: 0.17,
        shipGroup: null,
        role: BuiltObjectRole.Military,
        orders: () => 'move',
        aim: () => null,
        touches: 0,
        offset: 0,
        ...o,
    };
}

/** Round-robin of GAP steps (an 11 000-object galaxy), 4× speed. */
const GAP = 11;
const COUNT = 10763;
const SPEED = 4;
const STEP_MS = (SPEED * 1000) / 60;

/** A fleet of ships turning to new aims every few touches, at turn rates across the GetCurrentTurnRate bands. */
function fleet(seed: number, n = 40): SimShip[] {
    const r = rng(seed);
    const out: SimShip[] = [];
    for (let i = 0; i < n; i++) {
        const every = 8 + Math.floor(r() * 12);
        out.push(
            ship({
                heading: (r() * 2 - 1) * Math.PI,
                targetHeading: (r() * 2 - 1) * Math.PI,
                currentSpeed: [3, 8, 11, 18][i % 4],
                turnRate: 0.1 + r() * 0.3,
                offset: i % GAP,
                // A new aim every few touches (a waypoint), anywhere around.
                aim: (k) => (k > 0 && k % every === 0 ? (r() * 2 - 1) * Math.PI : null),
            }),
        );
    }
    return out;
}

/** The view side: the presentation clock and two interpolators (on; and off, as before: no turn extrapolation — the
 * bounds at 0 — and no heading ease). */
class View {
    readonly clock = new PresentationClock();
    readonly on = new MotionInterpolator();
    readonly off = new MotionInterpolator();
    readonly probeOn = new HeadingProbe();
    readonly probeOff = new HeadingProbe();
    readonly out = createRenderTime();
    private frame = 0;
    /** Largest drawn turn rate (rad / game s) over its limit, of the `on` run (1: at the limit). */
    worstLimitRatio = 0;
    private lastDrawn = new Map<SimShip, { h: number; at: number }>();
    /** The drawn headings' range per ship (`on` run). */
    readonly extent = new Map<SimShip, { min: number; max: number }>();
    draw(raw: RenderTime, t: number, ships: readonly SimShip[]): void {
        const rt = this.clock.present(raw, t, this.out);
        this.frame++;
        const drawnMs = rt.renderNowMs - rt.stepGameMs;
        for (const [m, probe, extrapolate] of [[this.on, this.probeOn, true], [this.off, this.probeOff, false]] as const) {
            m.begin(rt, 10, COUNT);
            if (!extrapolate) {
                m.untouchedMaxMs = 0;
                m.easeHeadings = false;
            }
            for (const s of ships) {
                const st = sampleBuiltObject(m, s);
                probe.note(s, s.lastTouch, s.heading, this.frame, drawnMs, st.heading, ctxOf(st));
                if (extrapolate) {
                    const prev = this.lastDrawn.get(s);
                    const dAt = prev === undefined ? 0 : m.at - prev.at;
                    if (prev !== undefined && dAt > 0) {
                        const rate = Math.abs(wrapAngle(st.heading - prev.h)) / (dAt * m.stepSeconds);
                        // (The ships keep their speed: the limit is HEADING_EASE_FACTOR × their GetCurrentTurnRate.)
                        const limit = HEADING_EASE_FACTOR * Math.max(builtObjectTurnRate(s), 1e-9);
                        this.worstLimitRatio = Math.max(this.worstLimitRatio, rate / limit);
                    }
                    this.lastDrawn.set(s, { h: st.heading, at: m.at });
                    const e = this.extent.get(s);
                    if (e === undefined) this.extent.set(s, { min: st.heading, max: st.heading });
                    else {
                        e.min = Math.min(e.min, st.heading);
                        e.max = Math.max(e.max, st.heading);
                    }
                }
            }
        }
    }
}

/** The in-thread loop on a virtual clock (renderInterp-presentClock.test.ts runInThread): late-game steps of 4-20 ms
 * (12 on average: about real time) through the real SimFrameBudget, so a frame runs several steps and the next none. */
function runInThread(ships: SimShip[], seconds: number, hz: number, seed: number): View {
    const r = rng(seed);
    let now = 0;
    let serial = 0;
    let nowMs = 0;
    const driver: SteppableDriver = {
        maxFrames: 1,
        advance: () => {
            now += 4 + r() * 16;
            serial++;
            nowMs += STEP_MS;
            for (const s of ships) if ((serial + s.offset) % GAP === 0) touchShip(s, nowMs);
            return 1;
        },
    };
    const budget = new SimFrameBudget(() => now);
    const raw = createRenderTime();
    const view = new View();
    const vsync = 1000 / hz;
    let t = 0;
    let lastT = 0;
    while (t < seconds * 1000) {
        const before = serial;
        budget.run(driver, t - lastT, SPEED, false);
        lastT = t;
        updateRenderTime(raw, nowMs, budget.backlogMs, SPEED, false, serial - before);
        view.draw(raw, t, ships);
        now = Math.max(now, t) + 4;
        t = Math.max(t + vsync, Math.ceil(now / vsync - 1e-9) * vsync);
    }
    return view;
}

/** Worker mode: bursts of 1-6 steps landing at 30-110 ms, applied at the first frame after they land. */
function runWorker(ships: SimShip[], seconds: number, hz: number, seed: number): View {
    const r = rng(seed);
    const raw = createRenderTime();
    const view = new View();
    let serial = 0;
    let nowMs = 0;
    let nextAt = 0;
    let appliedAt = 0;
    for (let t = 0; t < seconds * 1000; t += 1000 / hz) {
        const before = serial;
        while (nextAt <= t) {
            const k = 1 + Math.floor(r() * 6);
            for (let i = 0; i < k; i++) {
                serial++;
                nowMs += STEP_MS;
                for (const s of ships) if ((serial + s.offset) % GAP === 0) touchShip(s, nowMs);
            }
            nextAt += ((30 + r() * 80) * k) / 3.5;
            appliedAt = t;
        }
        updateRenderTime(raw, nowMs, Math.min(FRAME_REAL_MS, t - appliedAt), SPEED, false, serial - before);
        view.draw(raw, t, ships);
    }
    return view;
}

describe('ship headings between round-robin touches: synthetic fleet (the sim’s own CalculateCurrentHeading)', () => {
    for (const [mode, run] of [['in-thread', runInThread], ['worker', runWorker]] as const) {
        for (const hz of [60, 144]) {
            it(`${mode}, ${hz} Hz: steady turns are drawn turning evenly (without: stand still, then swing)`, () => {
                const view = run(fleet(hz + mode.length), 14, hz, hz * 7 + mode.length);
                const on = view.probeOn.summary();
                const off = view.probeOff.summary();
                log(`[heading synthetic ${mode} ${hz} Hz]\n  on:  ${fmt(on)}\n  off: ${fmt(off)}\n  worst drawn rate / limit ${view.worstLimitRatio.toFixed(3)}`);
                if (process.env.HDEBUG) log(view.probeOn.debug.join('\n'));
                expect(on.steady).toBeGreaterThan(8000);
                // What is left: a new aim at a touch (the samples could not lead up to it) — the extrapolated turn
                // stops on the old target until that touch (a stall), the new turn is caught up at the ease limit.
                expect(on.rev).toBe(0);
                expect(on.stall).toBeLessThan(on.steady * 0.01);
                expect(on.jump).toBeLessThan(on.steady * 0.005);
                expect(on.qP50).toBeCloseTo(1, 2);
                expect(on.jerkP95).toBeLessThan(0.01);
                expect(on.falseTurn).toBe(0);
                expect(on.stopAway).toBeLessThan(on.stop * 0.001);
                expect(on.pops).toBeLessThan(Math.min(on.pairs * 0.005, off.pops / 5));
                // The ease bound holds on every frame: a new aim is turned at most HEADING_EASE_FACTOR × the turn rate.
                expect(view.worstLimitRatio).toBeLessThanOrEqual(1 + 1e-6);
                // As before: standing still between touches, then the whole turn in a step or two.
                expect(off.stall).toBeGreaterThan(off.steady * 0.4);
                expect(off.jump).toBeGreaterThan(off.steady * 0.05);
                expect(off.jerkP95).toBeGreaterThan(1);
            });
        }
    }

    it('a turn begun at a touch is eased in (no swing in one frame); a turn ends on its target, never past it', () => {
        // TargetHeading set at touch 3 (as a new MoveTo sets it): the turn of that touch had no lead-up in the samples.
        const s = ship({ heading: 0, targetHeading: 0, turnRate: 0.2, currentSpeed: 18, aim: (k) => (k === 3 ? 1.2 : null) });
        const view = runWorker([s], 12, 60, 5);
        const on = view.probeOn.summary();
        expect(view.worstLimitRatio).toBeLessThanOrEqual(1 + 1e-6);
        expect(on.pops).toBe(0);
        expect(on.stopAway).toBe(0);
        // Ends on the target (1.2), never drawn past it.
        const st = view.on.drawn(s);
        expect(st).not.toBeNull();
        expect(s.heading).toBe(1.2);
        expect(st!.heading).toBeCloseTo(1.2, 9);
        expect(view.extent.get(s)!.max).toBeLessThanOrEqual(1.2 + 1e-9);
        expect(view.extent.get(s)!.min).toBeGreaterThanOrEqual(0);
    });

    it('a ship whose commands do not turn it (waiting, heading ≠ target) is drawn as it stands; a base never turns', () => {
        const waiting = ship({ heading: 0.5, targetHeading: 2.5, orders: () => 'wait' });
        const base = ship({ heading: -1, targetHeading: 1, role: BuiltObjectRole.Base, currentSpeed: 0, offset: 4, orders: () => 'wait' });
        const view = runInThread([waiting, base], 6, 60, 9);
        const on = view.probeOn.summary();
        expect(on.still).toBeGreaterThan(300);
        expect(on.falseTurn).toBe(0);
        expect(view.on.drawn(waiting)!.heading).toBe(0.5);
        expect(view.on.drawn(base)!.heading).toBe(-1);
    });

    it('a turn the next touch does not make (the command changes) is carried on for at most one round-robin, then eased back', () => {
        // Turns at touches 1-3, then waits (a Dock waiting for its bay: CalculateCurrentHeading not run).
        const s = ship({ heading: 0, targetHeading: 3, turnRate: 0.17, orders: (k) => (k <= 3 ? 'move' : 'wait') });
        const view = runWorker([s], 8, 60, 13);
        expect(view.worstLimitRatio).toBeLessThanOrEqual(1 + 1e-6);
        const st = view.on.drawn(s)!;
        // Back where the sim stands, without a snap.
        expect(st.heading).toBeCloseTo(s.heading, 6);
        expect(view.probeOn.summary().pops).toBe(0);
    });

    it('across the ±π seam: turned along the shorter arc, no 2π swing', () => {
        // Heading 3.0 → target −3.0: the shorter way is +0.28 through π (CalculateCurrentHeading wraps the difference).
        const s = ship({ heading: 3.0, targetHeading: -3.0, turnRate: 0.05, currentSpeed: 18 });
        const view = runInThread([s], 10, 60, 17);
        expect(view.worstLimitRatio).toBeLessThanOrEqual(1 + 1e-6);
        const on = view.probeOn.summary();
        expect(on.maxStep).toBeLessThan(0.05);
        expect(on.rev).toBe(0);
        expect(on.stall).toBe(0);
        expect(Math.abs(wrapAngle(view.on.drawn(s)!.heading + 3.0))).toBeLessThan(1e-6);
    });
});

// --------------------------------------------------------------- the next touch lands where the extrapolation was

describe('the extrapolated heading and position are what the next touch makes (render-only, sim functions as reference)', () => {
    /** Sample `s` untouched at `dtMs` after its touch (a second touch seen first, for the turn evidence). */
    function extrapolated(s: SimShip, prevHeading: number, dtMs: number): { x: number; y: number; h: number } {
        const m = new MotionInterpolator();
        const rt = createRenderTime();
        rt.stepGameMs = STEP_MS;
        // The touch before (heading `prevHeading`), then this one: the evidence that the sim is turning it.
        const real = { heading: s.heading, lastTouch: s.lastTouch };
        s.heading = prevHeading;
        s.lastTouch = real.lastTouch - GAP * STEP_MS;
        rt.simNowMs = s.lastTouch;
        rt.stepSerial = 1;
        m.begin(rt, 10, COUNT);
        sampleBuiltObject(m, s);
        s.heading = real.heading;
        s.lastTouch = real.lastTouch;
        rt.simNowMs = s.lastTouch + dtMs;
        rt.stepSerial = 1 + Math.round(dtMs / STEP_MS) + GAP;
        m.begin(rt, 10, COUNT);
        const st = sampleBuiltObject(m, s);
        return { x: st.cx, y: st.cy, h: st.ch };
    }

    it('DoMovement: turns at GetCurrentTurnRate (committed speed), then moves at the committed speed along the new heading', () => {
        for (const v of [2, 7, 10, 18]) {
            const s = ship({ heading: 0.3, targetHeading: 2.0, currentSpeed: v, turnRate: 0.21, lastTouch: 100000 });
            const dtMs = GAP * STEP_MS;
            const e = extrapolated(s, 0.25, dtMs);
            touchShip(s, s.lastTouch + dtMs);
            expect(e.h).toBeCloseTo(s.heading, 5);
            expect(e.x).toBeCloseTo(s.xpos, 3);
            expect(e.y).toBeCloseTo(s.ypos, 3);
        }
    });

    it('preparing a hyperjump (HyperTo): accelerates first, then turns and moves at the new speed', () => {
        // From rest through the speed bands (×3 to 6, ×2.3 to 9, ×1.6 to 12): the turn rate is the accelerated speed's.
        const s = ship({ heading: 0.3, targetHeading: 2.5, currentSpeed: 4, turnRate: 0.2, lastTouch: 100000 });
        Object.assign(s, { hyperjumpPrepare: true, targetSpeed: 18, accelerationRate: 9 });
        const dtMs = (COUNT / 1000) * STEP_MS; // the expected gap (MotionInterpolator.touchGapMs)
        const e = extrapolated(s, 0.25, dtMs);
        // cmdMovement.ts HyperTo prepare: AccelerateToTargetSpeed, num8 = CurrentSpeed × t, CalculateCurrentHeading, move.
        const dt = dtMs / 1000;
        accelerateToTargetSpeed(null as unknown as Galaxy, s as unknown as BuiltObject, dt);
        const d = s.currentSpeed * dt;
        calculateCurrentHeading(null as unknown as Galaxy, s as unknown as BuiltObject, dt);
        expect(s.currentSpeed).toBeGreaterThan(9); // past a band: the committed speed's rate would be 2.3 / 1.6 = 44 % off
        expect(e.h).toBeCloseTo(s.heading, 4);
        expect(e.x).toBeCloseTo(Math.cos(s.heading) * d, 2);
        expect(e.y).toBeCloseTo(Math.sin(s.heading) * d, 2);
    });
});

// ------------------------------------------------------------------------- the ports against the sim's own code

describe('turnHeading / builtObjectTurnRate are the sim’s CalculateCurrentHeading / GetCurrentTurnRate', () => {
    let gameData: GameData;
    beforeAll(async () => {
        gameData = await loadGameDataFs();
    }, 300000);

    it('ships (fleets, captains, every speed band) and random headings, across the seam', () => {
        const g = cachedTickGame(gameData).galaxy;
        const r = rng(21);
        let n = 0;
        let fleets = 0;
        let captains = 0;
        for (const bo of g.builtObjects) {
            if (bo === null || bo.hasBeenDestroyed || !(bo.turnRate > 0)) continue;
            // Every third ship in a fleet with a maneuvering bonus (ShipGroup.ShipManeuveringBonus), every fifth with a
            // captain's (CaptainShipManeuveringBonus 100 + skill).
            if (bo.shipGroup === null && n % 3 === 0) bo.shipGroup = { shipManeuveringBonus: 1.15 + r() * 0.2 };
            if (bo.shipGroup !== null) fleets++;
            if (n % 5 === 0) {
                const b = captainBonusMap.get(bo);
                captainBonusMap.set(bo, { ...(b ?? { targeting: 100, countermeasures: 100, fighters: 100, shipEnergyUsage: 100, weaponsDamage: 100, weaponsRange: 100, shieldRechargeRate: 100, damageControl: 100, repair: 100, hyperjumpSpeed: 100 }), shipManeuvering: 100 + Math.floor(r() * 40) } as never);
                captains++;
            }
            for (const v of [0, 5, 6, 8, 9, 11, 12, 13, 40]) {
                bo.currentSpeed = v;
                expect(builtObjectTurnRate(bo)).toBe(getCurrentTurnRate(bo));
            }
            for (let k = 0; k < 4; k++) {
                const h = Math.fround((r() * 2 - 1) * Math.PI);
                const target = Math.fround((r() * 2 - 1) * Math.PI);
                const dt = r() * 1.5;
                bo.heading = h;
                bo.targetHeading = target;
                const want = turnHeading(h, target, builtObjectTurnRate(bo) * dt);
                calculateCurrentHeading(g, bo, dt);
                // (The sim rounds to float32.)
                expect(Math.abs(wrapAngle(bo.heading - want))).toBeLessThan(1e-6);
                n++;
            }
        }
        expect(n).toBeGreaterThan(400);
        expect(fleets).toBeGreaterThan(50);
        expect(captains).toBeGreaterThan(50);
    });

    it('creatures: the difference is not wrapped (Creature.cs 685), the turn runs past a target across the seam', () => {
        const g = cachedTickGame(gameData).galaxy;
        const r = rng(22);
        let n = 0;
        for (const c of g.creatures) {
            if (c === null || !(c.turnRate > 0)) continue;
            for (let k = 0; k < 4; k++) {
                const h = Math.fround((r() * 2 - 1) * Math.PI);
                const target = Math.fround((r() * 2 - 1) * Math.PI);
                const dt = r() * 3;
                c.currentHeading = h;
                c.targetHeading = target;
                const want = turnHeading(h, target, c.turnRate * dt, false);
                (c as unknown as { calculateCurrentHeading(t: number): void }).calculateCurrentHeading(dt);
                expect(Math.abs(wrapAngle(c.currentHeading - want))).toBeLessThan(1e-6);
                n++;
            }
        }
        expect(n).toBeGreaterThan(100);
        // The seam case itself: 3.0 → −3.0 is 0.28 to the right the short way, but the unwrapped −6.0 only lands on the
        // target once a turn exceeds 6.0: a 0.5 turn goes on past it.
        expect(turnHeading(3.0, -3.0, 0.5, false)).toBeCloseTo(3.5 - TWO_PI, 9);
        expect(turnHeading(3.0, -3.0, 0.5, true)).toBe(-3.0);
    });

    it('fighters: Fighter.cs CalculateCurrentHeading at GetCurrentTurnRate (fighterTurnRate)', () => {
        const g = cachedTickGame(gameData).galaxy;
        buildNewFighters(g, playerCarrierPort(g));
        const r = rng(23);
        let n = 0;
        for (const bo of g.builtObjects) {
            for (const f of (bo === null ? null : fightersOf(bo)) ?? []) {
                for (let k = 0; k < 3; k++) {
                    const h = Math.fround((r() * 2 - 1) * Math.PI);
                    const target = Math.fround((r() * 2 - 1) * Math.PI);
                    const dt = r() * 0.5;
                    f.heading = h;
                    f.targetHeading = target;
                    f.currentSpeed = f.topSpeed * r();
                    f.inView = true;
                    f.onboardCarrier = false;
                    const want = turnHeading(h, target, fighterTurnRate(f.specification.turnRate, f.currentSpeed, f.topSpeed) * dt);
                    fighterDoMovement(g, f, dt);
                    expect(Math.abs(wrapAngle(f.heading - want))).toBeLessThan(1e-5);
                    n++;
                }
                if (n > 300) break;
            }
            if (n > 300) break;
        }
        expect(n).toBeGreaterThan(30);
    });
});

// ------------------------------------------------------------------------------------- the real 4000-star galaxy

describe('ship headings on a real 4000-star galaxy (> 10 000 objects round-robin), both modes', () => {
    const STAR_COUNT = 4000;
    const LATE_OBJECTS = 10763;
    let game: Game;
    let gameData: GameData;
    beforeAll(async () => {
        gameData = await loadGameDataFs();
        const o = tickGameOptions(gameData);
        game = createGame({ ...o, starCount: STAR_COUNT, sectorWidth: 15, sectorHeight: 15, systemNames: Array.from({ length: STAR_COUNT }, (_, i) => `S${i}`) });
        runGameSeconds(game, 30);
        // As many objects as the reported late game (10 763: each touched every 10-11 steps): null holes between the
        // ships (Galaxy.BuiltObjects keeps the holes CompleteTeardown leaves, and the round-robin walks them), spread
        // evenly so about the same number of ships is touched every step.
        const list = game.galaxy.builtObjects;
        const live = list.slice();
        list.length = 0;
        const per = (LATE_OBJECTS - live.length) / live.length;
        let holes = 0;
        for (const bo of live) {
            list.push(bo);
            holes += per;
            for (; holes >= 1; holes--) list.push(null);
        }
        while (list.length < LATE_OBJECTS) list.push(null);
    }, 1_800_000);

    /** Draw `g`'s ships through two interpolators (extrapolation on / off) at the presented RenderTime. */
    class RealView {
        readonly clock = new PresentationClock();
        readonly on = new MotionInterpolator();
        readonly off = new MotionInterpolator();
        readonly probeOn = new HeadingProbe();
        readonly probeOff = new HeadingProbe();
        readonly visible = new VisibleJumps();
        private out = createRenderTime();
        private frame = 0;
        draw(g: Galaxy, raw: RenderTime, t: number): void {
            const rt = this.clock.present(raw, t, this.out);
            this.frame++;
            const drawnMs = rt.renderNowMs - rt.stepGameMs;
            for (const [m, probe, extrapolate] of [[this.on, this.probeOn, true], [this.off, this.probeOff, false]] as const) {
                m.begin(rt, habitatTouchClampSeconds(g.habitats.length), g.builtObjects.length, g.creatures.length, g.habitats.length);
                if (!extrapolate) {
                    m.untouchedMaxMs = 0;
                    m.easeHeadings = false;
                }
                for (const bo of g.builtObjects) {
                    if (bo === null || bo.hasBeenDestroyed) continue;
                    const st = sampleBuiltObject(m, bo);
                    probe.note(bo, bo.lastTouch, bo.heading, this.frame, drawnMs, st.heading, ctxOf(st));
                    if (extrapolate) this.visible.note(bo, this.frame, t, st.x, st.y, st.heading, st.hn === 1);
                }
            }
        }
    }

    function expectSmooth(label: string, v: RealView): void {
        const on = v.probeOn.summary();
        const off = v.probeOff.summary();
        log(`[heading 4000-star ${label}]\n  on:  ${fmt(on)}\n  off: ${fmt(off)}\n  ${v.visible.summary()}`);
        // Positions and headings with no visible jump — the hyperjump legs' entry, re-aim and exit included
        // (renderInterp-hyperjump.test.ts) — but a handful a run: a warp leg another object's tick cut short (its speed
        // dropped without its own touch: the ship stands at its committed position, which the extrapolation had passed).
        expect(v.visible.samples).toBeGreaterThan(100000);
        expect(v.visible.pos).toBeLessThan(v.visible.samples * 0.0002);
        expect(v.visible.head).toBeLessThan(v.visible.samples * 0.0005);
        if (process.env.HDEBUG) log(v.probeOn.debug.join('\n'));
        expect(on.steady).toBeGreaterThan(5000);
        // What remains is the sim deciding at a touch what the samples could not show before it — a turn begun there,
        // a target re-aimed, a new command whose first touch accelerates before it turns (HyperTo), a command that
        // does not turn the ship for a touch (SetParent between HyperTo and MoveTo, a Dock waiting for its bay):
        // eased, and rare.
        expect(on.stall).toBeLessThan(on.steady * 0.01);
        expect(on.jump).toBeLessThan(on.steady * 0.005);
        expect(on.rev).toBeLessThan(on.steady * 0.005);
        expect(on.qP50).toBeCloseTo(1, 2);
        expect(on.jerkP95).toBeLessThan(0.05);
        expect(on.falseTurn).toBeLessThan(on.still * 0.0005);
        expect(on.stopAway).toBeLessThan(Math.min(on.stop * 0.03, on.pairs * 0.0005));
        expect(on.pops).toBeLessThan(on.pairs * 0.001);
        // Before: still for most of the round-robin, then the whole turn at once.
        expect(off.stall).toBeGreaterThan(off.steady * 0.4);
        expect(off.jump).toBeGreaterThan(off.steady * 0.1);
        expect(off.jerkP95).toBeGreaterThan(20 * on.jerkP95);
    }

    it('in-thread, 4× speed, late-game steps (0-3 a frame through SimFrameBudget): drawn turns are even', () => {
        const g = game.galaxy;
        expect(g.builtObjects.length).toBeGreaterThanOrEqual(LATE_OBJECTS);
        // simLoop.ts tick on a virtual clock: each step costs 4-20 ms (about real time on average), so the budget runs
        // several in one frame and none in the next (runInThread above, with the real sim).
        const r = rng(31);
        let now = 0;
        let steps = 0;
        const stepMs = Math.round((SPEED * 1000) / 60);
        const driver: SteppableDriver = {
            maxFrames: 1,
            advance: () => {
                now += 4 + r() * 16;
                runSimFrame(g, stepMs);
                steps++;
                return 1;
            },
        };
        const budget = new SimFrameBudget(() => now);
        const view = new RealView();
        const raw = createRenderTime();
        let t = 0;
        let lastT = 0;
        while (steps < 700) {
            const before = steps;
            budget.run(driver, t - lastT, SPEED, false);
            lastT = t;
            updateRenderTime(raw, g.nowMs, budget.backlogMs, SPEED, false, steps - before);
            view.draw(g, raw, t);
            now = Math.max(now, t) + 4;
            t = Math.max(t + 1000 / 60, Math.ceil((now * 60) / 1000 - 1e-9) * (1000 / 60));
        }
        log(`  presented lag (steps) at the end: ${view.clock.lagSteps(raw.stepSerial).toFixed(2)}`);
        expectSmooth(`in-thread (${g.builtObjects.length} objects)`, view);
    }, 1_800_000);

    it('sim worker, end to end (SimHost → SimClientCore replica, bursts of 1-5 steps): drawn turns are even', () => {
        const g = game.galaxy;
        let wall = 0;
        const now = (): number => (wall += 0.001);
        const time = new GalaxyTime();
        time.paused = false;
        time.speed = SPEED;
        const host = new SimHost(game, time, {} as StartGameOptions, { now });
        const client = new SimClientCore(gameData, structuredClone(host.snapshot()), { post: () => undefined, now });
        try {
            const uiTime = new GalaxyTime();
            uiTime.bindGalaxy(client.galaxy);
            uiTime.paused = false;
            uiTime.speed = SPEED;
            const r = rng(32);
            const view = new RealView();
            let due = 0;
            for (let n = 0; n < 700; n++) {
                const t = (n * 1000) / 60;
                // A worker message every 1-5 frames, with all its steps (about real time on average).
                if (n >= due) {
                    const k = 1 + Math.floor(r() * 5);
                    for (let i = 0; i < k; i++) {
                        const m = host.tick(FRAME_REAL_MS);
                        if (m !== null) client.receive(structuredClone(m));
                    }
                    due = n + k;
                }
                client.frame(uiTime);
                view.draw(client.galaxy, client.renderTime, t);
            }
            // The replica's ships are the worker's (heading, TargetHeading, LastTouch at the step rate).
            expect(client.galaxy.nowMs).toBe(g.nowMs);
            expectSmooth(`worker (${client.galaxy.builtObjects.length} objects)`, view);
        } finally {
            client.dispose();
            host.dispose();
        }
    }, 1_800_000);

    it('fighters in a fight (the carrier port vs a pirate escort): drawn turns follow the sim’s (extrapolated as before), within the ease bound', () => {
        const g = game.galaxy;
        // renderInterp-fighters.test.ts's combat scenario: the player's carrier port with its fighters built, a pirate
        // escort with its engines out 670 away (inside the base's engage range and the fighter leash).
        const port = playerCarrierPort(g);
        buildNewFighters(g, port);
        for (const f of fightersOf(port)!) {
            f.health = 1;
            f.underConstruction = false;
        }
        const pir = pirateEscort(g, 0);
        builtObjectMission(pir.mission)?.clear();
        pir.isAutoControlled = false;
        pir.design.fleeWhen = BuiltObjectFleeWhen.Never;
        for (const c of pir.components.items) if (c.category === ComponentCategoryType.Engine) c.status = ComponentStatus.Damaged;
        pir.reDefine();
        const ix = Math.trunc(Math.trunc(pir.xpos) / 400000);
        const iy = Math.trunc(Math.trunc(pir.ypos) / 400000);
        pir.parentBuiltObject = null;
        pir.parentHabitat = null;
        pir.parentOffsetX = -2000000001.0;
        pir.parentOffsetY = -2000000001.0;
        pir.xpos = port.xpos + 600;
        pir.ypos = port.ypos + 300;
        updateIndexesForMovement(g, pir, ix, iy, true);
        updatePosition(g, pir);
        const runs = [new MotionInterpolator(), new MotionInterpolator()];
        runs[1].easeHeadings = false;
        const probes = [new HeadingProbe(), new HeadingProbe()];
        const worst = [0, 0];
        const last = [new Map<object, { h: number; at: number }>(), new Map<object, { h: number; at: number }>()];
        const rt = createRenderTime();
        const stepMs = Math.round((SPEED * 1000) / 60);
        rt.stepGameMs = stepMs;
        let frames = 0;
        for (let s2 = 0; s2 < 900; s2++) {
            runSimFrame(g, stepMs);
            for (let k = 0; k < 2; k++) {
                rt.alpha = k / 2;
                rt.stepSerial += k === 0 ? 1 : 0;
                rt.simNowMs = g.nowMs;
                rt.renderNowMs = g.nowMs + rt.alpha * stepMs;
                frames++;
                for (let j = 0; j < 2; j++) {
                    const m = runs[j];
                    m.begin(rt, habitatTouchClampSeconds(g.habitats.length), g.builtObjects.length, g.creatures.length, g.habitats.length);
                    sampleBuiltObject(m, port);
                    for (const f of fightersOf(port) ?? []) {
                        if (f.onboardCarrier || f.hasBeenDestroyed) continue;
                        const st = sampleFighter(m, f);
                        probes[j].note(f, f.lastTouch, f.heading, frames, rt.renderNowMs - stepMs, st.heading, ctxOf(st));
                        const p = last[j].get(f);
                        if (p !== undefined && m.at > p.at) {
                            // Drawn turn rate over the fastest the fighter turns (GetCurrentTurnRate at rest).
                            const rate = Math.abs(wrapAngle(st.heading - p.h)) / ((m.at - p.at) * m.stepSeconds);
                            worst[j] = Math.max(worst[j], rate / fighterTurnRate(f.specification.turnRate, 0, f.topSpeed));
                        }
                        last[j].set(f, { h: st.heading, at: m.at });
                    }
                }
            }
        }
        const on = probes[0].summary();
        const off = probes[1].summary();
        log(`[heading fighters]\n  on:  ${fmt(on)}\n  off: ${fmt(off)}\n  worst drawn rate / fastest turn rate: on ${worst[0].toFixed(3)} off ${worst[1].toFixed(3)}`);
        // Fighters moved with their carrier every ~11 steps, their turns extrapolated toward TargetHeading
        // (sampleFighter → extrapolateMover → turnHeading): even, with or without the ease.
        expect(on.objects).toBeGreaterThan(5);
        expect(on.steady).toBeGreaterThan(1000);
        expect(on.stall).toBeLessThan(on.steady * 0.01);
        expect(on.jump).toBeLessThan(on.steady * 0.005);
        expect(on.rev).toBeLessThan(on.steady * 0.005);
        expect(on.jerkP95).toBeLessThan(0.05);
        expect(worst[0]).toBeLessThanOrEqual(HEADING_EASE_FACTOR + 1e-6);
    }, 1_800_000);

    it('creatures (50 moved a step: every ~40 steps here): a turn their next Move makes at once (a new target, a flip) is eased, never swung in a frame', () => {
        const g = game.galaxy;
        expect(g.creatures.length).toBeGreaterThan(500);
        const runs = [new MotionInterpolator(), new MotionInterpolator()];
        runs[1].easeHeadings = false;
        const big = [0, 0];
        const worst = [0, 0];
        let moving = 0;
        const last = [new Map<object, { h: number; at: number }>(), new Map<object, { h: number; at: number }>()];
        const rt = createRenderTime();
        const stepMs = Math.round((SPEED * 1000) / 60);
        rt.stepGameMs = stepMs;
        for (let s2 = 0; s2 < 600; s2++) {
            runSimFrame(g, stepMs);
            for (let k = 0; k < 2; k++) {
                rt.alpha = k / 2;
                rt.stepSerial += k === 0 ? 1 : 0;
                rt.simNowMs = g.nowMs;
                rt.renderNowMs = g.nowMs + rt.alpha * stepMs;
                for (let j = 0; j < 2; j++) {
                    const m = runs[j];
                    m.begin(rt, habitatTouchClampSeconds(g.habitats.length), g.builtObjects.length, g.creatures.length, g.habitats.length);
                    for (const c of g.creatures) {
                        if (c === null || c.hasBeenDestroyed) continue;
                        const st = sampleCreature(m, c);
                        const p = last[j].get(c);
                        if (p !== undefined && m.at > p.at && st.hn > 1 && c.turnRate > 0) {
                            const dh = Math.abs(wrapAngle(st.heading - p.h));
                            if (dh > 0.3) big[j]++;
                            worst[j] = Math.max(worst[j], dh / ((m.at - p.at) * m.stepSeconds) / c.turnRate);
                            if (j === 0 && c.currentSpeed > 0) moving++;
                        }
                        last[j].set(c, { h: st.heading, at: m.at });
                    }
                }
            }
        }
        log(`[heading creatures] ${g.creatures.length} creatures, moving frames ${moving}: frames turned > 0.3 rad on ${big[0]} / off ${big[1]}; worst drawn rate / TurnRate on ${worst[0].toFixed(2)} / off ${worst[1].toFixed(2)}`);
        expect(moving).toBeGreaterThan(10000);
        expect(big[1]).toBeGreaterThan(0);
        expect(big[0]).toBe(0);
        expect(worst[0]).toBeLessThanOrEqual(HEADING_EASE_FACTOR + 1e-6);
    }, 1_800_000);
});
