// Sim worker render pacing (src/render/renderInterp.ts PresentationClock, run by MainView over the worker's raw render
// time; docs/sim-worker.md §9 chunk 2): step messages arrive 10-30 ms after their step, unevenly (the worker's step +
// diff time varies, the main thread's message event waits for the frame in progress), and several steps at once when
// the worker falls behind real time. Every message is applied at the next frame (SimClientCore.frame), and the drawn
// game time must still advance smoothly. Simulated here without a game: worker ticks, jittered arrivals, frames at
// 240 Hz, the raw alpha SimClientCore.frame computes (the message's backlog plus the time since it was applied).
import { describe, expect, it } from 'vitest';
import { PresentationClock, createRenderTime, renderSerialOf, updateRenderTime } from '../src/render/renderInterp';
import { FRAME_REAL_MS } from '../src/sim/tick/scheduler';

function rng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

interface Arrival {
    at: number;
    steps: number;
    serial: number;
    /** The worker budget's backlog after the tick (≥ one step when it is behind real time). */
    backlogMs: number;
}

/** Worker ticks: every `tickMs` (± jitter) it runs `steps` steps and posts; the message lands 12-26 ms later. */
function arrivals(seed: number, ticks: number, tickMs: number, steps: number, spikes: boolean): Arrival[] {
    const r = rng(seed);
    const out: Arrival[] = [];
    let serial = 0;
    let t = 0;
    for (let i = 0; i < ticks; i++) {
        t += tickMs * (0.85 + r() * 0.3);
        serial += steps;
        let delay = 12 + r() * 14;
        if (spikes && r() < 0.02) delay += 20; // a GC pause or a big diff now and then
        out.push({ at: t + delay, steps, serial, backlogMs: steps > 1 ? 2 * FRAME_REAL_MS : r() * 2 });
    }
    // Messages keep their order (one channel): a later serial never lands first (a late one holds those after it).
    for (let i = 1; i < out.length; i++) if (out[i].at < out[i - 1].at) out[i].at = out[i - 1].at;
    return out;
}

/** Per render frame: wall ms since the last frame and the drawn time's advance (real ms of sim steps). Paced: through
 *  PresentationClock; else the raw render time (stepSerial − 1 + alpha). */
function play(list: Arrival[], paced: boolean, frameMs = 1000 / 240): [number, number][] {
    const clock = new PresentationClock();
    const raw = createRenderTime();
    const out = createRenderTime();
    let next = 0;
    let applied = 0;
    let backlog = 0;
    let appliedAt = 0;
    let lastDrawn = Number.NaN;
    let lastT = 0;
    const frames: [number, number][] = [];
    const end = list[list.length - 1].at;
    for (let t = 0; t < end; t += frameMs) {
        let steps = 0;
        while (next < list.length && list[next].at <= t) {
            steps += list[next].serial - applied;
            applied = list[next].serial;
            backlog = list[next].backlogMs;
            appliedAt = t;
            next++;
        }
        updateRenderTime(raw, applied * FRAME_REAL_MS, Math.min(FRAME_REAL_MS, backlog + (t - appliedAt)), 1, false, steps);
        const drawnSteps = paced ? renderSerialOf(clock.present(raw, t, out)) : renderSerialOf(raw);
        const drawnMs = drawnSteps * FRAME_REAL_MS;
        if (applied > 0 && !Number.isNaN(lastDrawn)) frames.push([t - lastT, drawnMs - lastDrawn]);
        if (applied > 0) lastDrawn = drawnMs;
        lastT = t;
    }
    return frames;
}

const p95 = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)];
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('sim worker: render pacing', () => {
    it('worker at real time, jittered arrivals: the drawn time follows the wall clock, never backwards', () => {
        for (const seed of [1, 2, 3]) {
            const frames = play(arrivals(seed, 900, FRAME_REAL_MS, 1, true), true).slice(400);
            expect(frames.every(([, d]) => d >= 0)).toBe(true);
            const err = frames.map(([w, d]) => Math.abs(d - w));
            expect(p95(err)).toBeLessThan(0.6);
            expect(mean(err)).toBeLessThan(0.3);
        }
    });

    it('applying each message as it lands (alpha from the time since) stalls and jumps by the jitter', () => {
        const list = arrivals(7, 900, FRAME_REAL_MS, 1, true);
        const err = (paced: boolean): number[] => play(list, paced).slice(400).map(([w, d]) => Math.abs(d - w));
        expect(p95(err(false))).toBeGreaterThan(3);
        expect(p95(err(true))).toBeLessThan(p95(err(false)) / 4);
    });

    it('worker behind real time (3 steps per 68 ms tick): smooth at the rate steps arrive', () => {
        const list = arrivals(11, 300, 68, 3, false);
        const paced = play(list, true).slice(300);
        const naive = play(list, false).slice(300);
        // Average rate: 3 steps per 68 ms of wall time (the drawn time cannot outrun the worker).
        const rate = (fr: [number, number][]): number => fr.reduce((a, [, d]) => a + d, 0) / fr.reduce((a, [w]) => a + w, 0);
        expect(rate(paced)).toBeGreaterThan(0.6);
        expect(rate(paced)).toBeLessThan(0.9);
        // Smooth: each frame advances by about the average (not 0, then 3 steps).
        const dev = (fr: [number, number][]): number[] => {
            const r = rate(fr);
            return fr.map(([w, d]) => Math.abs(d - r * w));
        };
        expect(p95(dev(paced))).toBeLessThan(1);
        expect(p95(dev(naive))).toBeGreaterThan(5 * p95(dev(paced)));
        expect(paced.every(([, d]) => d >= 0)).toBe(true);
    });

    it('bursty catch-up (4-6 steps per 60-90 ms, as on a loaded machine): smooth, no long stalls', () => {
        const r = rng(5);
        const list: Arrival[] = [];
        let serial = 0;
        let t = 0;
        for (let i = 0; i < 200; i++) {
            t += 60 + r() * 30;
            const k = 4 + Math.floor(r() * 3);
            serial += k;
            list.push({ at: t + 10 + r() * 10, steps: k, serial, backlogMs: 2 * FRAME_REAL_MS });
        }
        for (let i = 1; i < list.length; i++) if (list[i].at < list[i - 1].at) list[i].at = list[i - 1].at;
        const paced = play(list, true, 1000 / 60).slice(120);
        const naive = play(list, false, 1000 / 60).slice(120);
        const rate = (fr: [number, number][]): number => fr.reduce((a, [, d]) => a + d, 0) / fr.reduce((a, [w]) => a + w, 0);
        const dev = (fr: [number, number][]): number[] => {
            const k = rate(fr);
            return fr.map(([w, d]) => Math.abs(d - k * w));
        };
        expect(paced.every(([, d]) => d >= 0)).toBe(true);
        // Frames that do not advance at all (stalls) are rare.
        expect(paced.filter(([, d]) => d === 0).length).toBeLessThan(paced.length * 0.02);
        expect(p95(dev(paced))).toBeLessThan(p95(dev(naive)) / 4);
    });

    it('a stall then a burst: the drawn position eases to a bounded lag; paused, it stands where the pause found it', () => {
        const clock = new PresentationClock();
        const raw = createRenderTime();
        const out = createRenderTime();
        let t = 0;
        for (let i = 0; i < 120; i++) {
            t += FRAME_REAL_MS;
            updateRenderTime(raw, 0, 0.5 * FRAME_REAL_MS, 1, false, 1);
            clock.present(raw, t, out);
        }
        // 600 ms of nothing (raw alpha pinned at 1), then 36 steps at once.
        let last = clock.serial;
        for (let i = 0; i < 36; i++) {
            t += FRAME_REAL_MS;
            updateRenderTime(raw, 0, FRAME_REAL_MS, 1, false, 0);
            clock.present(raw, t, out);
            expect(clock.serial).toBeGreaterThanOrEqual(last);
            expect(clock.serial).toBeLessThanOrEqual(raw.stepSerial);
            last = clock.serial;
        }
        const before = clock.serial;
        updateRenderTime(raw, 0, FRAME_REAL_MS, 1, false, 36);
        t += FRAME_REAL_MS;
        clock.present(raw, t, out);
        // No snap: one frame's advance stays below 2.5 × the rate.
        expect(clock.serial - before).toBeLessThan(2.6);
        // The lag closes within about a second, at a bounded rate.
        for (let i = 0; i < 90; i++) {
            t += FRAME_REAL_MS;
            updateRenderTime(raw, 0, 0.5 * FRAME_REAL_MS, 1, false, 1);
            clock.present(raw, t, out);
        }
        expect(raw.stepSerial - clock.serial).toBeLessThanOrEqual(clock.delay + 2.5);
        expect(raw.stepSerial - clock.serial).toBeLessThanOrEqual(PresentationClock.MAX_DELAY + 2.5);
        expect(clock.delay).toBeLessThanOrEqual(PresentationClock.MAX_DELAY);
        // Paused: stands still, also while late steps land; never past the latest step.
        const at = clock.serial;
        for (let i = 0; i < 10; i++) {
            t += FRAME_REAL_MS;
            updateRenderTime(raw, 0, 0, 1, true, i < 2 ? 1 : 0);
            clock.present(raw, t, out);
            expect(clock.serial).toBe(at);
        }
    });
});
