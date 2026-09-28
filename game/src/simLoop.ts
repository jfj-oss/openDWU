// App frame driver: runs the real simulation scheduler (src/sim/tick/scheduler.ts) from the render loop
// (tasks/M4-plan.md §1.1 frame driver, §1.7 time model, §5.1 determinism contract).
//
// Every render frame accumulates the real ms elapsed and runs whole sim frames of `nextFrameMs(state, speed)` game
// ms (SimDriver, one fixed step per FRAME_REAL_MS of real time) — so outcomes do not depend on the display refresh
// rate — and nothing while paused. [fix6ui] How many steps run per render frame is set by a wall-clock budget
// (SimFrameBudget below), not a frame count: a slow renderer (0.7 fps in playtest 2026-09-25-b) no longer slows the
// game clock, which follows real time × TimeSpeed as the C# stopwatch clock does (Galaxy.cs 1098 CurrentStarDate from
// _StopWatch, 1102 TimeSpeed; Galaxy.3.cs 5138 RealSecondsInGalacticYear = 600, so 1 game day = 600,000 / 360 ms
// ≈ 1,667 real ms at 1× — 36 game days per real minute). The camera is the scheduler's optional in-view input (Main.Part11.cs 507 method_123 / 533
// ProcessMain level-of-detail pass, plan §0 "View LOD"): opt-in with `?simView=1` (off by default: the camera would be
// an unjournaled sim input and break command-log replay; when on, the log records it — 'view' entries) (tests
// and the headless harness always run without a view).
//
// The only clock is `galaxy.nowMs` (advanced by runSimFrame); the HUD's GalaxyTime is bound to it
// (GalaxyTime.bindGalaxy) and only supplies pause / speed.

import type { Camera } from './render/camera';
import type { Galaxy } from './sim/galaxy';
import type { GalaxyTime } from './sim/galaxyTime';
import { FRAME_REAL_MS, SimDriver, schedulerState, type FrameOptions, type SimView } from './sim/tick/scheduler';
import { drainCommandBoundary } from './sim/tick/commandBoundary';
import { noteSimSpeed, noteSimView } from './sim/player/playerCommands';
import { showToast } from './ui/toast';
import { createRenderTime, updateRenderTime, type RenderTime } from './render/renderInterp';

/** Main.Part11.cs 507 method_123 inputs from the Pixi camera: int_13/int_14 = view centre (galaxy units),
 * mainView.Width/Height = base.ClientRectangle size (px, Main.Part12.cs 1712), double_0 = galaxy units per px. */
export function simViewFromCamera(camera: Camera): SimView {
    return {
        x: Math.trunc(camera.x),
        y: Math.trunc(camera.y),
        viewWidth: Math.trunc(camera.width),
        viewHeight: Math.trunc(camera.height),
        clientWidth: Math.trunc(camera.width),
        zoomFactor: 1 / camera.zoom,
    };
}

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

/** Wall-clock stats of the sim work done in render frames (exposed as window.__dwu.simStats). */
export interface SimLoopStats {
    /** Render frames seen / sim frames run. */
    renderFrames: number;
    simFrames: number;
    /** Wall ms spent in runSimFrame in total, and an exponential moving average per render frame. */
    simWallMs: number;
    avgSimMsPerRenderFrame: number;
    /** Worst single render frame's sim wall ms since the last reset. */
    maxSimMsPerRenderFrame: number;
    reset(): void;
}

export interface SimLoop {
    driver: SimDriver;
    stats: SimLoopStats;
    /** [fix6ui] The wall-clock step budget (window.__dwu.simBudget). */
    budget: SimFrameBudget;
    /** Render interpolation input, refreshed by every tick (one object, mutated in place): the fraction into the
     * next fixed step (budget.backlogMs / FRAME_REAL_MS, 0 while paused), the game ms per step at the current speed,
     * renderNowMs = galaxy.nowMs + alpha × stepGameMs, and the cumulative step count. Render-only. */
    renderTime: RenderTime;
    /** Call once per render frame with the real ms since the previous one. Returns the sim frames run. */
    tick(realDtMs: number): number;
}

/** `?simView=1` enables the in-view LOD pass (default off: see the file header, command log). */
export function simViewEnabledFromUrl(search: string): boolean {
    return new URLSearchParams(search).get('simView') === '1';
}

export function createSimLoop(galaxy: Galaxy, time: GalaxyTime, camera: Camera, useView: boolean): SimLoop {
    time.bindGalaxy(galaxy);
    const driver = new SimDriver(galaxy, time.speed, time.paused);
    const stats: SimLoopStats = {
        renderFrames: 0,
        simFrames: 0,
        simWallMs: 0,
        avgSimMsPerRenderFrame: 0,
        maxSimMsPerRenderFrame: 0,
        reset() {
            this.renderFrames = 0;
            this.simFrames = 0;
            this.simWallMs = 0;
            this.avgSimMsPerRenderFrame = 0;
            this.maxSimMsPerRenderFrame = 0;
        },
    };
    const budget = new SimFrameBudget();
    const renderTime = updateRenderTime(createRenderTime(), galaxy.nowMs, 0, time.speed, true, 0);
    return {
        driver,
        stats,
        budget,
        renderTime,
        tick(realDtMs: number): number {
            // Pause / speed come from the HUD clock (buttons, keyboard, game menu, tutorial "Play This Game").
            driver.speed = time.speed;
            driver.paused = time.paused;
            driver.isPaused = () => time.paused;
            const t0 = performance.now();
            let frames = 0;
            try {
                // Command log: player orders queued since the last render frame apply now, at this frame boundary
                // (also while paused, and even when the budget runs no step), so they land within one frame.
                drainCommandBoundary(galaxy);
                // The frame length is a sim input: journal speed changes at this boundary (replay runs the same frames).
                if (!time.paused) {
                    noteSimSpeed(galaxy, time.speed);
                    noteSimView(galaxy, useView);
                }
                // [fix6ui] steps by real time under a wall-clock budget (was driver.advance, at most 4 per frame).
                frames = budget.run(driver, realDtMs, time.speed, time.paused, useView ? { view: simViewFromCamera(camera) } : {});
            } catch (err) {
                // Pixi's Ticker only schedules the next animation frame after update() returns, so an exception here
                // would freeze the sim, the view and rendering for good. Contain it: drop the half-drained tick queue
                // (as scripts/sim-run.mjs does), pause, and tell the player.
                console.error('Simulation error (paused):', err);
                schedulerState(galaxy).queue.length = 0;
                budget.backlogMs = 0;
                time.paused = true;
                showToast('Simulation error — game paused (see console)');
            }
            updateRenderTime(renderTime, galaxy.nowMs, budget.backlogMs, time.speed, time.paused, frames);
            const dt = performance.now() - t0;
            stats.renderFrames++;
            stats.simFrames += frames;
            stats.simWallMs += dt;
            stats.avgSimMsPerRenderFrame += (dt - stats.avgSimMsPerRenderFrame) * 0.05;
            if (dt > stats.maxSimMsPerRenderFrame) stats.maxSimMsPerRenderFrame = dt;
            return frames;
        },
    };
}
