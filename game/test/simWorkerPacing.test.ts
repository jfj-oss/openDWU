// Sim worker render pacing (src/simworker/clientCore.ts StepPacer; docs/sim-worker.md §9 chunk 2): step messages
// arrive 10-30 ms after their step, unevenly (the worker's step + diff time varies, the main thread's message event
// waits for the frame in progress), and several steps at once when the worker falls behind real time. The drawn game
// time must still advance smoothly. Simulated here without a game: worker ticks, jittered arrivals, frames at 240 Hz,
// the same apply / alpha rule as SimClientCore.frame.
import { describe, expect, it } from 'vitest';
import { StepPacer } from '../src/simworker/clientCore';
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
        out.push({ at: t + delay, steps, serial });
    }
    out.sort((a, b) => a.at - b.at || a.serial - b.serial);
    // Messages keep their order (one channel): a later serial never lands first.
    for (let i = 1; i < out.length; i++) if (out[i].at < out[i - 1].at) out[i].at = out[i - 1].at;
    return out;
}

/** Per render frame: wall ms since the last frame and the drawn time's advance (real ms of sim steps). */
function play(list: Arrival[], paced: boolean, frameMs = 1000 / 240): [number, number][] {
    const pacer = new StepPacer();
    const inbox: Arrival[] = [];
    let next = 0;
    let applied = 0;
    let lastSteps = 1;
    let appliedAt = 0;
    let lastDrawn = Number.NaN;
    let lastT = 0;
    const out: [number, number][] = [];
    const end = list[list.length - 1].at;
    for (let t = 0; t < end; t += frameMs) {
        while (next < list.length && list[next].at <= t) {
            inbox.push(list[next]);
            pacer.arrived(list[next].steps, list[next].serial, list[next].at);
            next++;
        }
        let alpha: number;
        if (paced) {
            const drawn = pacer.advance(t, applied);
            let frameSteps = 0;
            while (inbox.length > 0 && applied < drawn) {
                const m = inbox.shift()!;
                applied = m.serial;
                frameSteps += m.steps;
            }
            if (frameSteps > 0) lastSteps = frameSteps;
            alpha = Math.max(-Math.min(StepPacer.MAX_TARGET + StepPacer.MAX_LAG, lastSteps - 1), Math.min(1, drawn - (applied - 1)));
        } else {
            if (inbox.length > 0) {
                applied = inbox[inbox.length - 1].serial;
                inbox.length = 0;
                appliedAt = t;
            }
            alpha = Math.min(1, (t - appliedAt) / FRAME_REAL_MS);
        }
        const drawnMs = (applied - 1 + alpha) * FRAME_REAL_MS;
        if (applied > 0 && !Number.isNaN(lastDrawn)) out.push([t - lastT, drawnMs - lastDrawn]);
        if (applied > 0) lastDrawn = drawnMs;
        lastT = t;
    }
    return out;
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
            list.push({ at: t + 10 + r() * 10, steps: k, serial });
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

    it('a stall then a burst: the drawn position skips ahead to a bounded lag', () => {
        const p = new StepPacer();
        let serial = 0;
        let t = 0;
        for (let i = 0; i < 120; i++) {
            t += FRAME_REAL_MS;
            serial++;
            p.arrived(1, serial, t + 15);
            p.advance(t + 15, serial);
        }
        // 600 ms of nothing, then 36 steps at once.
        t += 600;
        serial += 36;
        p.arrived(36, serial, t);
        const drawn = p.advance(t, serial - 36);
        expect(serial - drawn).toBeLessThanOrEqual(p.target + StepPacer.MAX_LAG);
        // The buffer grew after starving, within its bounds; holding while paused restarts from the committed state.
        expect(p.target).toBeGreaterThan(1);
        expect(p.target).toBeLessThanOrEqual(StepPacer.MAX_TARGET);
        // Holding (paused) keeps the drawn position where the pause found it (never past the latest step).
        const at = p.drawn;
        expect(p.hold(serial, t)).toBe(at);
        expect(p.hold(serial - 40, t)).toBe(serial - 40);
    });
});
