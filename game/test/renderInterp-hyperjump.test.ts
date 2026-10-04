// Hyperjump legs of ships the background round-robin touches only every few steps (src/render/renderInterp.ts
// sampleBuiltObject: turnedAtLastTouch's warp bookkeeping, MotionInterpolator.jumpNext / easeWarp).
//
// cmdMovement.ts HyperTo: the touch that starts the jump sets CurrentSpeed to the warp speed and then moves the ship at
// it for the whole time since its last touch — on a 10 000-object galaxy at 4× some 14 000 units in one touch. Drawn as
// sampled, the ship stood at cruise and then teleported (isJump: a snap) or, over a burst's samples, surged at several
// times the warp speed. Each warp touch measures the distance to its exit point before it moves (LastHyperDistance) and
// the touch that reaches it puts the ship there: extrapolated at warp past it, the drawn ship overshot the exit and came
// back. A leg re-aimed at every touch (a moving target) went the whole time since the touch before along the new
// heading: a corner some 3 000 units sideways. A short jump entered and left warp in one touch: a teleport.
// Now the first warp touch, a re-aim and a one-touch jump are eased (soft snap), and the extrapolation stops at the exit.
//
// Measured on the drawn position each frame, both loop modes (in-thread SimFrameBudget, worker bursts through the
// PresentationClock), the warp easing on and off (easeWarp, the previous behaviour): reversals (a frame's move pointing
// back against the one before), visible jumps (a frame's move off the segment between its neighbours' — in velocity
// space, less 5 % of its own length — by over 50 units: a pixel at system zoom), and the fastest frame against the warp
// speed.
import { describe, expect, it } from 'vitest';
import { appendFileSync } from 'node:fs';
import { FRAME_REAL_MS } from '../src/sim/tick/scheduler';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { SimFrameBudget, type SteppableDriver } from '../src/simFrameBudget';
import { alwaysHotFields } from '../src/simworker/replicaGalaxy';
import { MotionInterpolator, PresentationClock, createRenderTime, sampleBuiltObject, updateRenderTime, type MovingBuiltObject, type RenderTime } from '../src/render/renderInterp';

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

const SPEED = 4;
const STEP_MS = (SPEED * 1000) / 60;
/** An 11 000-object galaxy: each ship touched every 11 steps. */
const GAP = 11;
const COUNT = 10763;
const CRUISE = 18;
const WARP = 18750;

/** A ship on a HyperTo: cruising (preparing), then a warp leg to `exit`, then cruising again. */
interface Jumper extends MovingBuiltObject {
    lastTouch: number;
    heading: number;
    targetHeading: number;
    turnRate: number;
    shipGroup: null;
    role: BuiltObjectRole;
    hyperjumpPrepare: boolean;
    hyperjumpJustExited: boolean;
    lastHyperDistance: number;
    touches: number;
    /** Touch that starts the warp leg; the exit point (moved by `exitDrift` per touch: a moving target). */
    startAt: number;
    exitX: number;
    exitY: number;
    exitDrift: number;
    phase: 'prep' | 'warp' | 'after';
    exits: number;
}

function jumper(o: Partial<Jumper>): Jumper {
    return {
        xpos: 0,
        ypos: 0,
        heading: 0,
        targetHeading: 0,
        topSpeed: 20,
        warpSpeed: WARP,
        currentSpeed: CRUISE,
        parentHabitat: null,
        parentOffsetX: -2000000001,
        parentOffsetY: -2000000001,
        lastTouch: 0,
        turnRate: 0.17,
        shipGroup: null,
        role: BuiltObjectRole.Military,
        hyperjumpPrepare: true,
        hyperjumpJustExited: false,
        lastHyperDistance: 536870911,
        targetSpeed: CRUISE,
        accelerationRate: 9,
        touches: 0,
        startAt: 3,
        exitX: 200000,
        exitY: 0,
        exitDrift: 0,
        phase: 'prep',
        exits: 0,
        ...o,
    };
}

/** One touch, as cmdMovement.ts HyperTo moves the ship (the exit test as checkWhetherArrived: passing it arrives). */
function touch(s: Jumper, nowMs: number): void {
    const dt = (nowMs - s.lastTouch) / 1000;
    s.hyperjumpJustExited = false;
    if (s.phase === 'prep' && s.touches >= s.startAt) s.phase = 'warp';
    if (s.phase === 'warp') {
        s.exitY += s.exitDrift;
        s.currentSpeed = WARP;
        s.hyperjumpPrepare = false;
        s.heading = s.targetHeading = Math.atan2(s.exitY - s.ypos, s.exitX - s.xpos);
        const dist = Math.hypot(s.exitX - s.xpos, s.exitY - s.ypos);
        s.lastHyperDistance = dist;
        const d = WARP * dt;
        if (d >= dist) {
            s.xpos = s.exitX;
            s.ypos = s.exitY;
            s.currentSpeed = CRUISE;
            s.hyperjumpJustExited = true;
            s.phase = 'after';
            s.exits++;
        } else {
            s.xpos += Math.cos(s.heading) * d;
            s.ypos += Math.sin(s.heading) * d;
        }
    } else {
        s.xpos += Math.cos(s.heading) * s.currentSpeed * dt;
        s.ypos += Math.sin(s.heading) * s.currentSpeed * dt;
        if (s.phase === 'after') s.hyperjumpPrepare = false;
    }
    s.lastTouch = nowMs;
    s.touches++;
}

interface Track {
    t: number[];
    x: number[];
    y: number[];
}

/** Draws the ships through two interpolators (warp easing on / off) at the presented RenderTime. */
class View {
    readonly clock = new PresentationClock();
    readonly runs = [new MotionInterpolator(), new MotionInterpolator()];
    readonly tracks = [new Map<Jumper, Track>(), new Map<Jumper, Track>()];
    private out = createRenderTime();
    constructor() {
        this.runs[1].easeWarp = false;
    }
    draw(raw: RenderTime, t: number, ships: readonly Jumper[]): void {
        const rt = this.clock.present(raw, t, this.out);
        for (let j = 0; j < 2; j++) {
            const m = this.runs[j];
            m.begin(rt, 10, COUNT);
            for (const s of ships) {
                const st = sampleBuiltObject(m, s);
                let tr = this.tracks[j].get(s);
                if (tr === undefined) this.tracks[j].set(s, (tr = { t: [], x: [], y: [] }));
                tr.t.push(t);
                tr.x.push(st.x);
                tr.y.push(st.y);
            }
        }
    }
}

function runInThread(ships: Jumper[], seconds: number, seed: number): View {
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
            for (const s of ships) if (serial % GAP === 0) touch(s, nowMs);
            return 1;
        },
    };
    const budget = new SimFrameBudget(() => now);
    const raw = createRenderTime();
    const view = new View();
    let t = 0;
    let lastT = 0;
    while (t < seconds * 1000) {
        const before = serial;
        budget.run(driver, t - lastT, SPEED, false);
        lastT = t;
        updateRenderTime(raw, nowMs, budget.backlogMs, SPEED, false, serial - before);
        view.draw(raw, t, ships);
        now = Math.max(now, t) + 4;
        t = Math.max(t + 1000 / 60, Math.ceil((now * 60) / 1000 - 1e-9) * (1000 / 60));
    }
    return view;
}

function runWorker(ships: Jumper[], seconds: number, seed: number): View {
    const r = rng(seed);
    const raw = createRenderTime();
    const view = new View();
    let serial = 0;
    let nowMs = 0;
    let nextAt = 0;
    let appliedAt = 0;
    for (let t = 0; t < seconds * 1000; t += 1000 / 60) {
        const before = serial;
        while (nextAt <= t) {
            const k = 1 + Math.floor(r() * 6);
            for (let i = 0; i < k; i++) {
                serial++;
                nowMs += STEP_MS;
                for (const s of ships) if (serial % GAP === 0) touch(s, nowMs);
            }
            nextAt += ((30 + r() * 80) * k) / 3.5;
            appliedAt = t;
        }
        updateRenderTime(raw, nowMs, Math.min(FRAME_REAL_MS, t - appliedAt), SPEED, false, serial - before);
        view.draw(raw, t, ships);
    }
    return view;
}

interface Motion {
    frames: number;
    reversals: number;
    jumps: number;
    /** The fastest frame's move over the warp speed's move in that frame. */
    maxOverWarp: number;
}

function motion(tr: Track): Motion {
    const out: Motion = { frames: 0, reversals: 0, jumps: 0, maxOverWarp: 0 };
    const med = 1000 / 60;
    for (let i = 2; i + 1 < tr.t.length; i++) {
        const mv = (j: number): [number, number] => {
            const dt = tr.t[j + 1] - tr.t[j];
            return [((tr.x[j + 1] - tr.x[j]) / dt) * med, ((tr.y[j + 1] - tr.y[j]) / dt) * med];
        };
        const w = mv(i - 2);
        const u = mv(i - 1);
        const v = mv(i);
        out.frames++;
        const lu = Math.hypot(u[0], u[1]);
        const lw = Math.hypot(w[0], w[1]);
        if (u[0] * w[0] + u[1] * w[1] < 0 && lu > 1 && lw > 1) out.reversals++;
        const sx = v[0] - w[0];
        const sy = v[1] - w[1];
        const L = sx * sx + sy * sy;
        const k = L > 0 ? Math.max(0, Math.min(1, ((u[0] - w[0]) * sx + (u[1] - w[1]) * sy) / L)) : 0;
        const off = Math.hypot(u[0] - (w[0] + sx * k), u[1] - (w[1] + sy * k)) - 0.05 * lu;
        if (off > 50) out.jumps++;
        out.maxOverWarp = Math.max(out.maxOverWarp, lu / ((WARP * SPEED * med) / 1000));
    }
    return out;
}

const SCENARIOS: [string, () => Jumper[]][] = [
    // A long leg (about ten touches at warp), from several starting phases of the round-robin.
    ['a long jump', () => [0, 1, 2, 3].map((i) => jumper({ startAt: 25 + i, exitX: 150000 + 20000 * i, exitY: 30000 * i }))],
    // Shorter than one touch's warp move (13 750 units at 4×): enters and leaves warp in the same touch.
    ['a one-touch jump', () => [0, 1, 2].map((i) => jumper({ startAt: 25 + i, exitX: 6000 + 2500 * i, exitY: 0 }))],
    // A moving exit point: the leg is re-aimed at every touch (about 0.25 rad).
    ['a jump re-aimed every touch', () => [0, 1].map((i) => jumper({ startAt: 25 + i, exitX: 150000, exitY: 0, exitDrift: 4000 }))],
];

describe('hyperjump legs drawn without pops, surges or reversals (sampleBuiltObject: warp entry / re-aim / exit)', () => {
    for (const [mode, run] of [['in-thread', runInThread], ['worker', runWorker]] as const) {
        for (const [name, make] of SCENARIOS) {
            it(`${mode}: ${name}`, () => {
                const ships = make();
                // (The jumps start after the presentation clock has settled: about 4.5 s in.)
                const view = run(ships, 14, name.length * 7 + mode.length);
                for (const s of ships) expect(s.exits).toBe(1);
                const on = [...view.tracks[0].values()].map(motion);
                const off = [...view.tracks[1].values()].map(motion);
                const sum = (a: Motion[], k: keyof Motion): number => a.reduce((x, m) => x + m[k], 0);
                const max = (a: Motion[], k: keyof Motion): number => Math.max(...a.map((m) => m[k]));
                log(`[hyperjump ${mode}: ${name}] on: reversals ${sum(on, 'reversals')} jumps ${sum(on, 'jumps')} max/warp ${max(on, 'maxOverWarp').toFixed(2)} | off: reversals ${sum(off, 'reversals')} jumps ${sum(off, 'jumps')} max/warp ${max(off, 'maxOverWarp').toFixed(2)}`);
                expect(sum(on, 'reversals')).toBe(0);
                expect(sum(on, 'jumps')).toBe(0);
                // Catching up a leg that began a round-robin earlier takes a little more than the warp speed, briefly.
                expect(max(on, 'maxOverWarp')).toBeLessThan(2.2);
                // Before: a teleport or surge at the entry, an overshoot and return at the exit, a sideways step per re-aim.
                expect(sum(off, 'jumps') + sum(off, 'reversals') > 0 || max(off, 'maxOverWarp') > 1.3 * max(on, 'maxOverWarp')).toBe(true);
            });
        }
    }

    it('worker mode: LastHyperDistance (where the exit lies) travels with the ship’s touch', () => {
        expect(alwaysHotFields().has('BuiltObject.lastHyperDistance')).toBe(true);
    });
});
