// M4a: headless harness (tasks/M4-plan.md §5.2) — runs the real frame driver with no renderer and no view.

import type { Galaxy } from '../galaxy';
import { nextFrameMs, runSimFrame, schedulerState, setTickProfile, type SimView, type TickProfile } from './scheduler';
import { resetTodoCounts, setStopOnTodo, todoHits } from './todo';

export interface RunGameSecondsOptions {
    /** Fixed game ms per frame (integer). Default: 60 fps × `speed`, quantised with an exact carry. */
    frameMs?: number;
    /** Galaxy TimeSpeed for the default frame length (0.25 … 4). Default 1. */
    speed?: number;
    /** Camera for the in-view LOD pass (default none: headless/tests). */
    view?: SimView;
    /** method_86 multi-core budgets (default true). */
    multiCore?: boolean;
    /** Called after every frame. */
    onFrame?: (galaxy: Galaxy, frame: number) => void;
    /** Throw on the first TODO(port) stub reached (CI); default false (soak runs count them). */
    stopOnTodo?: boolean;
    /** Wall clock for per-pass timings (e.g. `performance.now`); omitted ⇒ no timings. */
    profileClock?: () => number;
    /** With `profileClock`: the accumulator the per-pass timings are added to (default a fresh one), e.g. to read them per frame from `onFrame`. */
    timings?: TickProfile;
}

export interface RunGameSecondsResult {
    /** Frames run by this call. */
    frames: number;
    /** Galaxy.Rnd draws (InternalSample calls) during this call. */
    rndDraws: number;
    /** Game ms at the end. */
    nowMs: number;
    /** Wall ms per frame-driver pass (only with `profileClock`). */
    timings: TickProfile;
    /** TODO(port) stubs reached during this call: `{ "<package> <name>": hits }`. */
    todoHits: Record<string, number>;
}

/**
 * Runs the simulation for `seconds` game seconds from the galaxy's current time (frames until
 * `galaxy.nowMs >= start + seconds × 1000`). Scheduler cursors and the frame carry live on the galaxy, so
 * runGameSeconds(g, 60) twice equals runGameSeconds(g, 120) when 60 s is a frame boundary (it is at 60 fps).
 */
export function runGameSeconds(target: Galaxy | { galaxy: Galaxy }, seconds: number, opts: RunGameSecondsOptions = {}): RunGameSecondsResult {
    const galaxy = 'galaxy' in target ? target.galaxy : target;
    const state = schedulerState(galaxy);
    const endMs = galaxy.nowMs + Math.round(seconds * 1000);
    const drawsBefore = galaxy.rnd.drawCount;
    const timings: TickProfile = opts.timings ?? {};
    resetTodoCounts();
    setStopOnTodo(opts.stopOnTodo ?? false);
    if (opts.profileClock !== undefined) setTickProfile(timings, opts.profileClock);
    let frames = 0;
    try {
        while (galaxy.nowMs < endMs) {
            const frameMs = opts.frameMs ?? nextFrameMs(state, opts.speed ?? 1.0);
            runSimFrame(galaxy, frameMs, { view: opts.view, multiCore: opts.multiCore });
            frames++;
            opts.onFrame?.(galaxy, frames);
        }
    } finally {
        setStopOnTodo(false);
        setTickProfile(null);
    }
    return { frames, rndDraws: galaxy.rnd.drawCount - drawsBefore, nowMs: galaxy.nowMs, timings, todoHits: todoHits() };
}
