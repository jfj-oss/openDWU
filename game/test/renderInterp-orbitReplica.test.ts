// Drawn orbits of planets and moons on a very large galaxy, in-thread and through the sim worker's replica, at 1× and
// 4× — "planets and moons that are jumping and not smooth moving … at a regular interval in test 3 (Etea, Dobrelleun 2,
// Draifar in the Dobrelleun system)" (2026-10-04).
//
// test3.dwusave has 101 652 habitats, so the background round-robin (scheduler.ts backgroundPass "GxHab", 1000 a step)
// touches each one every 102 steps (6.8 sim s at 4×), and the view extrapolates the orbit from the last committed
// (orbitAngle, lastTouch) pair (renderInterp.ts renderOrbitAngle) up to habitatTouchClampSeconds. In-thread the pair is
// at most one round-robin gap old. With the worker the pair reaches the replica in the cold cycle (Habitat is a cold
// class, replicaGalaxy.ts mixedStreamFields), which adds up to a cold cycle of real time: on test3 the replica's pairs
// aged to 14.7 sim s at 4× against a bound of 13.9 s, so thousands of planets and moons (Dobrelleun 2 and its moon
// Draifar; Etea, a moon of Dobrelleun 1) stopped for a few frames once per cold cycle and then jumped forward (up to
// 6.9× their per-frame move) when the pair landed. The bound now allows for the replica's lag.
//
// Here: the seed-1 harness galaxy (11 697 habitats: touched every 12 steps, a bound of 2.0 sim s before the fix), and
// in worker mode a long cold cycle (coldMaxSets 1: a minimal slice a step, 3.6-6.7 s of real time per cycle), as a large
// save on a busy main thread gives — the replica's pairs age to 5.8 sim s at 1× and 29 s at 4×. Every planet and moon
// is drawn each 60 Hz frame through the presentation clock (renderHabitatPos, the placement mainView.ts
// SystemView.updateBodies gives them), in its parent's drawn frame. A visible jump is a frame whose move is off the
// mean of its neighbours' by more than half the body's median per-frame move; a stall, a frame it barely moves.
// Before the fix (worker): 1× 338 538 jumps and 12.2 M stalled frames, 4× most bodies frozen outright; after: 0 / 0.
import { describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { Galaxy } from '../src/sim/galaxy';
import type { Habitat } from '../src/sim/types';
import type { StartGameOptions } from '../src/sim/startGameOptions';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { FRAME_REAL_MS, FRAMES_PER_SECOND, HABITAT_TICK_BATCH_SIZE, nextFrameMs, runSimFrame, schedulerState } from '../src/sim/tick/scheduler';
import { SimHost } from '../src/simworker/simHost';
import { SimClientCore } from '../src/simworker/clientCore';
import type { ToWorker } from '../src/simworker/protocol';
import { PresentationClock, createRenderTime, habitatTouchClampSeconds, renderHabitatPos, updateRenderTime, type RenderTime } from '../src/render/renderInterp';

const FRAMES = 60 * 40;

function fakeClock(): () => number {
    let t = 0;
    return () => (t += 0.001);
}

interface Jumps {
    bodies: number;
    frames: number;
    jumps: number;
    /** Worst frame's deviation, in median per-frame moves. */
    worst: number;
    /** Frames a moving body was drawn standing still. */
    stalls: number;
}

/** Visible jumps of the drawn tracks (x, y per frame) of each body. */
function jumpsOf(tracks: Float64Array[]): Jumps {
    const r: Jumps = { bodies: tracks.length, frames: 0, jumps: 0, worst: 0, stalls: 0 };
    for (const t of tracks) {
        const n = t.length / 2;
        const steps: number[] = [];
        for (let j = 1; j < n; j++) steps.push(Math.hypot(t[2 * j] - t[2 * j - 2], t[2 * j + 1] - t[2 * j - 1]));
        const med = [...steps].sort((a, b) => a - b)[steps.length >> 1];
        if (!(med > 1e-4)) continue;
        // (From the second second: the presentation clock holds the first frames while it settles.)
        for (let j = 60; j < steps.length; j++) if (steps[j] < med * 0.05) r.stalls++;
        for (let j = 1; j + 1 < n; j++) {
            const dev = Math.hypot((t[2 * j + 2] + t[2 * j - 2]) / 2 - t[2 * j], (t[2 * j + 3] + t[2 * j - 1]) / 2 - t[2 * j + 1]) / med;
            r.frames++;
            if (dev > 0.5) r.jumps++;
            if (dev > r.worst) r.worst = dev;
        }
    }
    return r;
}

/** Draw every planet and moon of `view` for FRAMES 60 Hz frames, `step` running one sim frame and returning the raw
 * render time. */
function drawOrbits(view: Galaxy, step: () => RenderTime): Jumps {
    const bodies = view.habitats.filter((h): h is Habitat => h != null && h.parent !== null);
    const tracks = bodies.map(() => new Float64Array(FRAMES * 2));
    const clock = new PresentationClock();
    const out = createRenderTime();
    const p = { x: 0, y: 0 };
    const q = { x: 0, y: 0 };
    for (let f = 0; f < FRAMES; f++) {
        const rt = clock.present(step(), (f * 1000) / 60, out);
        const clamp = habitatTouchClampSeconds(view.habitats.length);
        for (let i = 0; i < bodies.length; i++) {
            // In its parent's drawn frame (a moon's own orbit: the planet's is the planet's track), where a body moves
            // uniformly — drawn absolute, a moon whose orbit runs against its planet's slows to a near halt at times.
            renderHabitatPos(bodies[i], rt.renderNowMs, clamp, p);
            renderHabitatPos(bodies[i].parent!, rt.renderNowMs, clamp, q);
            tracks[i][2 * f] = p.x - q.x;
            tracks[i][2 * f + 1] = p.y - q.y;
        }
    }
    return jumpsOf(tracks);
}

const fmt = (j: Jumps): string => `${j.bodies} bodies, ${j.frames} frames: jumps ${j.jumps} (worst ${j.worst.toFixed(2)}× the median move), stalls ${j.stalls}`;

describe('planets and moons drawn between their round-robin touches, in-thread and on the worker replica', () => {
    for (const speed of [1, 4]) {
        it(`in-thread at ${speed}×: no visible jumps`, async () => {
            const gameData = await loadGameDataFs();
            const g = cachedTickGame(gameData, { seconds: 60 }).galaxy;
            const raw = createRenderTime();
            const j = drawOrbits(g, () => {
                runSimFrame(g, nextFrameMs(schedulerState(g), speed));
                return updateRenderTime(raw, g.nowMs, 0, speed, false, 1);
            });
            console.log(`[orbits in-thread ${speed}×] ${fmt(j)}`);
            expect(j.frames).toBeGreaterThan(100_000);
            expect(j.jumps).toBe(0);
            expect(j.stalls).toBe(0);
        }, 600_000);

        it(`through the worker replica at ${speed}× (a long cold cycle): no visible jumps`, async () => {
            const gameData = await loadGameDataFs();
            const game = cachedTickGame(gameData, { seconds: 60 });
            const time = new GalaxyTime();
            time.paused = false;
            time.speed = speed;
            const host = new SimHost(game, time, {} as StartGameOptions, { now: fakeClock(), sync: { coldMaxSets: 1, coldBudgetMs: Infinity } });
            const toHost = (m: ToWorker): void => {
                const c = structuredClone(m);
                if (c.type === 'command') host.command(c);
                else if (c.type === 'clock') host.clock(c);
                else if (c.type === 'refresh') host.refresh(c);
            };
            const client = new SimClientCore(gameData, structuredClone(host.snapshot()), { post: toHost, now: fakeClock() });
            const ui = new GalaxyTime();
            ui.bindGalaxy(client.galaxy);
            ui.speed = speed;
            ui.paused = false;
            client.bindClock(ui);
            const cycles0 = host.sync.encoder.cycleCount;
            let maxAge = 0;
            const j = drawOrbits(client.galaxy, () => {
                const m = host.tick(FRAME_REAL_MS);
                if (m !== null) client.receive(structuredClone(m));
                client.frame(ui);
                const now = client.renderTime.renderNowMs;
                for (const h of client.galaxy.habitats) if (h != null && h.parent !== null) maxAge = Math.max(maxAge, (now - h.lastTouch) / 1000);
                return client.renderTime;
            });
            const cycles = host.sync.encoder.cycleCount - cycles0;
            console.log(`[orbits worker ${speed}×] ${fmt(j)}; ${cycles} cold cycles, oldest replica pair ${maxAge.toFixed(1)} sim s (bound ${habitatTouchClampSeconds(game.galaxy.habitats.length).toFixed(1)} s)`);
            client.dispose();
            host.dispose();
            expect(cycles).toBeGreaterThan(0);
            // The cadence reproduced: the replica's pairs age past twice the round-robin gap at 4× (the old bound).
            expect(maxAge).toBeGreaterThan(((2 * (Math.ceil(game.galaxy.habitats.length / HABITAT_TICK_BATCH_SIZE) + 2)) / FRAMES_PER_SECOND) * 4);
            expect(j.frames).toBeGreaterThan(100_000);
            expect(j.jumps).toBe(0);
            expect(j.stalls).toBe(0);
        }, 600_000);
    }
});
