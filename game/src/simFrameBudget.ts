// The sim's wall-clock step budget (SimFrameBudget), shared by the in-thread loop (simLoop.ts) and the sim worker
// (simworker/simHost.ts). DOM-free (the worker imports it). Moved out of simLoop.ts unchanged.

import { FRAME_REAL_MS, type FrameOptions, type SimView } from './sim/tick/scheduler';

// [fix6ui] begin — sim/render decoupling (playtest 2026-09-25-b release blocker).
/** Wall ms of sim work allowed per render frame at 1× (scaled by the game speed above 1×). */
export const SIM_BUDGET_MS_AT_1X = 50;
/** When frames are slow, the sim may also use this share of the real time since the last frame (so at 0.7 fps it can
 * spend up to ~1 s per 1.4 s frame catching up, i.e. up to 3× the render time, instead of a fixed 50 ms). */
export const SIM_SHARE_OF_FRAME_TIME = 0.75;
/** Most real time owed to the sim at once (tabbing back must not freeze the page catching up). */
export const MAX_CATCH_UP_REAL_MS = 2000;

/** The part of SimDriver the budget drives: its pause state and one-step advance. */
export interface SteppableDriver {
    maxFrames: number;
    advance(realDtMs: number, opts?: FrameOptions): number;
}

/**
 * Runs the SimDriver's fixed steps by real elapsed time under a wall-clock budget. Each render frame adds the real ms
 * since the last one to a backlog (capped at MAX_CATCH_UP_REAL_MS) and runs one fixed step (driver.advance of exactly
 * FRAME_REAL_MS with maxFrames 1, so the driver's own accounting, pause probe and step order are unchanged) per
 * FRAME_REAL_MS owed, until the backlog is paid or the frame's wall budget is used (budgetMs: SIM_BUDGET_MS_AT_1X ×
 * max(1, speed), or SIM_SHARE_OF_FRAME_TIME of a slow frame's real time) — at least one step whenever one is due. A frame that runs out of budget carries the rest over. Determinism: the same fixed
 * steps in the same order; only how many run per real second depends on the machine.
 */
export class SimFrameBudget {
    /** Real ms owed to the sim (whole steps of FRAME_REAL_MS are run from it). */
    backlogMs = 0;
    constructor(
        readonly now: () => number = () => performance.now(),
        readonly budgetMsAt1x = SIM_BUDGET_MS_AT_1X,
        readonly maxCatchUpMs = MAX_CATCH_UP_REAL_MS,
    ) {}

    /** Wall-clock budget of one render frame at `speed` after `realDtMs` of real time: the larger of the fixed
     * per-frame budget (× speed above 1×) and SIM_SHARE_OF_FRAME_TIME of the (capped) real frame time. */
    budgetMs(speed: number, realDtMs = 0): number {
        return Math.max(this.budgetMsAt1x * Math.max(1, speed), SIM_SHARE_OF_FRAME_TIME * Math.min(Math.max(0, realDtMs), this.maxCatchUpMs));
    }

    /** Advance by `realDtMs` of real time; returns the steps run. `paused` drops the backlog (the driver ignores
     * paused time too). */
    run(driver: SteppableDriver, realDtMs: number, speed: number, paused: boolean, opts: FrameOptions = {}): number {
        if (paused) {
            this.backlogMs = 0;
            return 0;
        }
        this.backlogMs = Math.min(this.backlogMs + Math.max(0, realDtMs), this.maxCatchUpMs);
        const budget = this.budgetMs(speed, realDtMs);
        const t0 = this.now();
        let steps = 0;
        const savedMax = driver.maxFrames;
        driver.maxFrames = 1;
        try {
            while (this.backlogMs >= FRAME_REAL_MS) {
                if (steps > 0 && this.now() - t0 >= budget) break;
                const ran = driver.advance(FRAME_REAL_MS, opts);
                if (ran === 0) {
                    // The live pause probe stopped it (e.g. DoGameEnd paused from inside a tick).
                    this.backlogMs = 0;
                    break;
                }
                this.backlogMs -= FRAME_REAL_MS;
                steps += ran;
            }
        } finally {
            driver.maxFrames = savedMax;
        }
        return steps;
    }
}
// [fix6ui] end

/** Shortest real time between two cameras handed to the sim (each is a command-log 'view' entry). */
export const SIM_VIEW_MIN_INTERVAL_MS = 250;

/**
 * Rate-limits the camera handed to the sim's level-of-detail pass (scheduler.ts processMain): a camera that differs from
 * the last one handed over is due once SIM_VIEW_MIN_INTERVAL_MS has passed since then (switching the pass on / off is
 * due at once). Called every render frame, so a camera that stops moving inside the interval still lands next time.
 */
export class SimViewThrottle {
    private last: SimView | null | undefined = undefined;
    private lastAt = -Infinity;

    /** Whether `view` should be handed to the sim now (and, if so, remember it as handed over). */
    due(view: SimView | null, nowMs: number): boolean {
        const last = this.last;
        if (last !== undefined) {
            if (view === null && last === null) return false;
            if (view !== null && last !== null) {
                if (view.x === last.x && view.y === last.y && view.viewWidth === last.viewWidth && view.viewHeight === last.viewHeight && view.clientWidth === last.clientWidth && view.zoomFactor === last.zoomFactor) return false;
                if (nowMs - this.lastAt < SIM_VIEW_MIN_INTERVAL_MS) return false;
            }
        }
        this.last = view === null ? null : { ...view };
        this.lastAt = nowMs;
        return true;
    }

    /** Forget what was handed over (the next camera is due at once). */
    reset(): void {
        this.last = undefined;
        this.lastAt = -Infinity;
    }
}
