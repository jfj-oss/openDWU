// Presentation clock (src/render/renderInterp.ts PresentationClock + MotionInterpolator's per-object step samples):
// smooth drawn motion when sim steps land unevenly — a late game whose step costs more than its frame (in-thread: the
// budget runs several steps in one frame and none in the next), worker messages carrying bursts of steps, a hiccup
// after which the budget catches up many steps at once — and no added latency when the sim keeps up. Deterministic:
// a virtual wall clock, the real SimFrameBudget driving a fake step, frames at vsync (60-240 Hz), and a ship flying
// at a constant speed (10 units per step) drawn through MotionInterpolator each frame.
import { describe, expect, it } from 'vitest';
import { MotionInterpolator, PresentationClock, createRenderTime, renderSerialOf, updateRenderTime, type RenderTime } from '../src/render/renderInterp';
import { SimFrameBudget, type SteppableDriver } from '../src/simFrameBudget';
import { FRAME_REAL_MS } from '../src/sim/tick/scheduler';

function rng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

/** Units per step the test ship flies (straight along x). */
const V = 10;

interface Frame {
    /** Frame (rAF) time, real ms. */
    t: number;
    /** Drawn x of the ship. */
    x: number;
    /** Raw (loop) and presented positions, in steps. */
    raw: number;
    at: number;
    delay: number;
    renderNowMs: number;
    paused: boolean;
}

/** The view side of one frame: present the loop's render time (or not), then draw the ship. */
class View {
    readonly clock = new PresentationClock();
    readonly motion = new MotionInterpolator();
    readonly rt = createRenderTime();
    readonly ship = {};
    readonly frames: Frame[] = [];
    constructor(readonly useClock: boolean) {}
    draw(raw: RenderTime, t: number, shipX: number): void {
        const rt = this.useClock ? this.clock.present(raw, t, this.rt) : raw;
        this.motion.begin(rt, 10);
        const st = this.motion.sample(this.ship, shipX, 0, 0, 600);
        this.frames.push({ t, x: st.x, raw: raw.stepSerial - 1 + raw.alpha, at: renderSerialOf(rt), delay: this.clock.delay, renderNowMs: rt.renderNowMs, paused: raw.paused });
    }
}

interface InThreadOptions {
    hz: number;
    seconds: number;
    /** Wall ms of sim step number i. */
    stepCost: (i: number) => number;
    /** Wall ms of render work per frame. */
    renderMs?: number;
    speed?: number;
    /** Extra wall ms stalled before frame number n (a GC pause, a long task). */
    hiccup?: (n: number) => number;
    paused?: (t: number) => boolean;
    clock?: boolean;
}

/** The in-thread loop (simLoop.ts tick → MainView.update) on a virtual clock. */
function runInThread(o: InThreadOptions): Frame[] {
    let now = 0;
    let serial = 0;
    const driver: SteppableDriver = {
        maxFrames: 1,
        advance: () => {
            now += o.stepCost(serial);
            serial++;
            return 1;
        },
    };
    const budget = new SimFrameBudget(() => now);
    const speed = o.speed ?? 1;
    const stepGameMs = (speed * 1000) / 60;
    const raw = createRenderTime();
    const view = new View(o.clock ?? true);
    const vsync = 1000 / o.hz;
    let t = 0;
    let lastT = 0;
    for (let n = 0; t < o.seconds * 1000; n++) {
        const paused = o.paused?.(t) ?? false;
        const before = serial;
        budget.run(driver, t - lastT, speed, paused);
        lastT = t;
        updateRenderTime(raw, serial * stepGameMs, budget.backlogMs, speed, paused, serial - before);
        view.draw(raw, t, serial * V);
        now = Math.max(now, t) + (o.renderMs ?? 3) + (o.hiccup?.(n) ?? 0);
        // The next frame starts at the first vsync after this one's work.
        t = Math.max(t + vsync, Math.ceil(now / vsync - 1e-9) * vsync);
    }
    return view.frames;
}

interface Burst {
    at: number;
    steps: number;
    backlogMs: number;
}

/** Worker mode: messages (each `steps` steps) applied at the first frame after they land (SimClientCore.frame). */
function runWorker(bursts: Burst[], hz: number, clock = true): Frame[] {
    const raw = createRenderTime();
    const view = new View(clock);
    const vsync = 1000 / hz;
    let next = 0;
    let serial = 0;
    let lastBacklog = 0;
    let appliedAt = 0;
    const end = bursts[bursts.length - 1].at;
    for (let t = 0; t < end; t += vsync) {
        const before = serial;
        while (next < bursts.length && bursts[next].at <= t) {
            serial += bursts[next].steps;
            lastBacklog = bursts[next].backlogMs;
            appliedAt = t;
            next++;
        }
        updateRenderTime(raw, serial * (1000 / 60), Math.min(FRAME_REAL_MS, lastBacklog + (t - appliedAt)), 1, false, serial - before);
        view.draw(raw, t, serial * V);
    }
    return view.frames;
}

/**
 * The sim worker's own loop (worker.ts loop → SimHost.tick: SimFrameBudget steps, then the replica diff; next tick when
 * the next step is due) on a virtual clock, its messages landing `latency` ms later; the main thread applies each at
 * its next frame. Returns the arrivals for runWorker.
 */
function workerArrivals(seconds: number, stepCost: (i: number) => number, diffCost: () => number, latency: () => number): Burst[] {
    let now = 0;
    let serial = 0;
    const driver: SteppableDriver = {
        maxFrames: 1,
        advance: () => {
            now += stepCost(serial);
            serial++;
            return 1;
        },
    };
    const budget = new SimFrameBudget(() => now);
    const out: Burst[] = [];
    let last = 0;
    let lastAt = 0;
    while (now < seconds * 1000) {
        const before = serial;
        budget.run(driver, now - last, 1, false);
        last = now;
        now += diffCost();
        const at = Math.max(lastAt, now + latency());
        if (serial > before) out.push({ at, steps: serial - before, backlogMs: budget.backlogMs });
        lastAt = at;
        now += Math.max(0, FRAME_REAL_MS - budget.backlogMs);
    }
    return out;
}

interface Smoothness {
    frames: number;
    /** Mean drawn speed (units per real ms) and per-frame speed / mean. */
    speed: number;
    reversals: number;
    stalls: number;
    /** Frame-to-frame change of q (speed / mean speed): jerk. */
    jerkP95: number;
    jerkMax: number;
    qMax: number;
    qP95: number;
}

function smoothness(frames: Frame[], fromMs: number, toMs = Infinity): Smoothness {
    const f = frames.filter((x) => x.t >= fromMs && x.t <= toMs && !x.paused);
    const u: number[] = [];
    for (let i = 1; i < f.length; i++) u.push((f[i].x - f[i - 1].x) / (f[i].t - f[i - 1].t));
    const mean = (f[f.length - 1].x - f[0].x) / (f[f.length - 1].t - f[0].t);
    const q = u.map((v) => v / mean);
    const jerk: number[] = [];
    for (let i = 1; i < q.length; i++) jerk.push(Math.abs(q[i] - q[i - 1]));
    const sorted = (a: number[]): number[] => [...a].sort((x, y) => x - y);
    const p95 = (a: number[]): number => sorted(a)[Math.floor(a.length * 0.95)];
    return {
        frames: f.length,
        speed: mean,
        reversals: u.filter((v) => v < 0).length,
        stalls: q.filter((v) => v < 0.1).length,
        jerkP95: p95(jerk),
        jerkMax: Math.max(...jerk),
        qMax: Math.max(...q),
        qP95: p95(q),
    };
}

describe('PresentationClock: the sim keeps up (no added latency)', () => {
    for (const hz of [60, 144, 240]) {
        it(`${hz} Hz, regular steps: presents raw (delay → ~0) and moves evenly`, () => {
            const frames = runInThread({ hz, seconds: 6, stepCost: () => 2 });
            const late = frames.filter((f) => f.t > 3000);
            // Latency added over the raw render time: under 0.1 step (1.7 ms) on every frame, the delay about 0.
            for (const f of late) {
                expect(f.raw - f.at).toBeLessThan(0.1);
                expect(f.at).toBeLessThanOrEqual(f.raw + 1e-9);
                expect(f.delay).toBeLessThan(0.1);
            }
            const s = smoothness(frames, 3000);
            expect(s.reversals).toBe(0);
            expect(s.stalls).toBe(0);
            expect(s.jerkMax).toBeLessThan(0.05);
            // The full rate: 10 units per 1000/60 ms.
            expect(s.speed).toBeCloseTo(V / FRAME_REAL_MS, 2);
        });
    }

    it('4× speed: the same (the clock runs in steps; game ms per step do not matter)', () => {
        const frames = runInThread({ hz: 144, seconds: 5, stepCost: () => 3, speed: 4 });
        const s = smoothness(frames, 3000);
        expect(s.reversals).toBe(0);
        expect(s.jerkMax).toBeLessThan(0.05);
        for (const f of frames.filter((x) => x.t > 3000)) expect(f.raw - f.at).toBeLessThan(0.1);
    });
});

describe('PresentationClock: late game, steps cost more than a frame (in-thread)', () => {
    for (const hz of [60, 144, 240]) {
        it(`${hz} Hz, steps of 14-30 ms: no reversals or stalls, bounded jerk (raw: stalls and jumps)`, () => {
            const r = rng(hz);
            const costs: number[] = [];
            const stepCost = (i: number): number => {
                while (costs.length <= i) costs.push(14 + r() * 16);
                return costs[i];
            };
            const paced = smoothness(runInThread({ hz, seconds: 12, stepCost, renderMs: 4 }), 4000);
            costs.length = 0;
            const r2 = rng(hz);
            const stepCost2 = (i: number): number => {
                while (costs.length <= i) costs.push(14 + r2() * 16);
                return costs[i];
            };
            const naive = smoothness(runInThread({ hz, seconds: 12, stepCost: stepCost2, renderMs: 4, clock: false }), 4000);
            expect(paced.reversals).toBe(0);
            expect(paced.stalls).toBe(0);
            expect(paced.jerkP95).toBeLessThan(0.1);
            expect(paced.jerkMax).toBeLessThan(0.35);
            expect(paced.qMax).toBeLessThan(1.5);
            // Without the clock the same run stalls and jumps.
            expect(naive.jerkP95).toBeGreaterThan(5 * paced.jerkP95);
        });
    }

    it('a 400 ms hiccup, then the budget catching up many steps at once: eased (no snap, no reversal)', () => {
        const frames = runInThread({ hz: 144, seconds: 10, stepCost: () => 9, renderMs: 3, hiccup: (n) => (n === 600 ? 400 : 0) });
        const at = frames.findIndex((f, i) => i > 0 && f.t - frames[i - 1].t > 300);
        expect(at).toBeGreaterThan(0);
        const s = smoothness(frames, 1500);
        expect(s.reversals).toBe(0);
        // After the gap: never more than 2.5 × the steady speed per frame, then back to even motion.
        const v = V / FRAME_REAL_MS;
        for (let i = at + 1; i < frames.length; i++) {
            const u = (frames[i].x - frames[i - 1].x) / (frames[i].t - frames[i - 1].t);
            expect(u).toBeLessThanOrEqual(2.6 * v);
            expect(u).toBeGreaterThanOrEqual(0);
        }
        const settled = smoothness(frames, frames[at].t + 3000);
        expect(settled.jerkMax).toBeLessThan(0.1);
    });
});

describe('PresentationClock: sim worker bursts', () => {
    for (const hz of [60, 144, 240]) {
        it(`${hz} Hz, a worker falling behind (steps 20-35 ms + diff 5-15 ms: bursts of 1-4 steps): smooth (raw: stalls and jumps)`, () => {
            const r = rng(hz + 1);
            const bursts = workerArrivals(14, () => 20 + r() * 15, () => 5 + r() * 10, () => 1 + r() * 3);
            const paced = smoothness(runWorker(bursts, hz), 4000);
            const naive = smoothness(runWorker(bursts, hz, false), 4000);
            expect(paced.reversals).toBe(0);
            expect(paced.stalls).toBe(0);
            expect(paced.jerkP95).toBeLessThan(0.05);
            expect(paced.jerkMax).toBeLessThan(0.2);
            expect(paced.qMax).toBeLessThan(1.3);
            expect(naive.stalls).toBeGreaterThan(naive.frames * 0.1);
            expect(naive.jerkP95).toBeGreaterThan(10 * paced.jerkP95);
        });
    }

    it('random bursts of 1-8 steps at 30-130 ms (a harsh pattern): no reversals, rare stalls, far smoother than raw', () => {
        for (const hz of [60, 240]) {
            const r = rng(9 + hz);
            const bursts: Burst[] = [];
            let t = 0;
            for (let i = 0; i < 160; i++) {
                const k = 1 + Math.floor(r() * 8);
                t += 30 + r() * 100;
                bursts.push({ at: t, steps: k, backlogMs: 2 * FRAME_REAL_MS });
            }
            const paced = smoothness(runWorker(bursts, hz), 4000);
            const naive = smoothness(runWorker(bursts, hz, false), 4000);
            expect(paced.reversals).toBe(0);
            expect(paced.stalls).toBeLessThan(paced.frames * 0.02);
            expect(paced.jerkP95).toBeLessThan(0.1);
            expect(naive.jerkP95).toBeGreaterThan(20 * paced.jerkP95);
        }
    });

    it('steps dropped then delivered at once (game time jumps 40 steps): eased, never backwards', () => {
        const bursts: Burst[] = [];
        let t = 0;
        for (let i = 0; i < 200; i++) bursts.push({ at: (t += FRAME_REAL_MS), steps: 1, backlogMs: 1 });
        bursts.push({ at: (t += 600), steps: 40, backlogMs: 2 * FRAME_REAL_MS });
        for (let i = 0; i < 300; i++) bursts.push({ at: (t += FRAME_REAL_MS), steps: 1, backlogMs: 1 });
        const frames = runWorker(bursts, 120);
        const v = V / FRAME_REAL_MS;
        for (let i = 1; i < frames.length; i++) {
            const u = (frames[i].x - frames[i - 1].x) / (frames[i].t - frames[i - 1].t);
            expect(u).toBeGreaterThanOrEqual(0);
            expect(u).toBeLessThanOrEqual(2.6 * v);
        }
        // Back to even motion and a small delay within a few seconds.
        const end = frames[frames.length - 1].t;
        const settled = smoothness(frames, end - 1000);
        expect(settled.jerkMax).toBeLessThan(0.1);
        expect(frames[frames.length - 1].delay).toBeLessThan(2);
    });
});

describe('PresentationClock: pause, speed and the drawn instant', () => {
    it('pause is instant: the drawn ship stands still from the frame the pause lands, and resumes without a jump', () => {
        const r = rng(3);
        const costs: number[] = [];
        const stepCost = (i: number): number => {
            while (costs.length <= i) costs.push(14 + r() * 16);
            return costs[i];
        };
        const frames = runInThread({ hz: 144, seconds: 8, stepCost, paused: (t) => t >= 4000 && t < 5000 });
        const i0 = frames.findIndex((f) => f.paused);
        const i1 = frames.findIndex((f, i) => i > i0 && !f.paused);
        for (let i = i0; i < i1; i++) expect(frames[i].x).toBe(frames[i0 - 1].x);
        const s = smoothness(frames, 5000);
        expect(s.reversals).toBe(0);
        // Resuming: no frame moves more than 1.5 × the steady speed.
        expect(s.qMax).toBeLessThan(1.6);
    });

    it('renderNowMs never goes backwards (speed changes while trailing a burst) and is the step after the drawn one', () => {
        const clock = new PresentationClock();
        const raw = createRenderTime();
        const out = createRenderTime();
        let nowMs = 0;
        let last = -Infinity;
        let t = 0;
        const r = rng(4);
        for (let i = 0; i < 600; i++) {
            t += 1000 / 144;
            const speed = i < 200 ? 4 : i < 400 ? 1 : 2;
            const k = r() < 0.2 ? 1 + Math.floor(r() * 5) : 0;
            nowMs += (k * speed * 1000) / 60;
            updateRenderTime(raw, nowMs, FRAME_REAL_MS, speed, false, k);
            clock.present(raw, t, out);
            expect(out.renderNowMs).toBeGreaterThanOrEqual(last - 1e-9);
            expect(out.renderNowMs).toBeLessThanOrEqual(nowMs + out.stepGameMs + 1e-9);
            last = out.renderNowMs;
        }
    });

    it('selection reads the drawn position: drawn() / positionOf() return the presented sample', () => {
        const clock = new PresentationClock();
        const m = new MotionInterpolator();
        const raw = createRenderTime();
        const out = createRenderTime();
        const ship = { xpos: 0, ypos: 0 };
        let t = 0;
        for (let i = 0; i < 120; i++) {
            t += 1000 / 60;
            const k = i % 3 === 0 ? 3 : 0;
            ship.xpos += k * V;
            updateRenderTime(raw, 0, FRAME_REAL_MS, 1, false, k);
            clock.present(raw, t, out);
            m.begin(out, 10);
            const st = m.sample(ship, ship.xpos, 0, 0, 600);
            expect(m.drawn(ship)).toBe(st);
            expect(m.positionOf(ship).x).toBe(st.x);
            // Drawn on the line between the committed samples, at the presented step.
            if (i > 30) expect(st.x).toBeCloseTo(m.at * V, 6);
        }
    });
});
