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
import { SimDriver, schedulerState, type SimView } from './sim/tick/scheduler';
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

// [fix6ui] SimFrameBudget and its constants live in simFrameBudget.ts (DOM-free: the sim worker uses them too).
import { SimFrameBudget } from './simFrameBudget';
export { MAX_CATCH_UP_REAL_MS, SIM_BUDGET_MS_AT_1X, SIM_SHARE_OF_FRAME_TIME, SimFrameBudget, type SteppableDriver } from './simFrameBudget';

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
