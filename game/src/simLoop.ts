// App frame driver: runs the real simulation scheduler (src/sim/tick/scheduler.ts) from the render loop
// (tasks/M4-plan.md §1.1 frame driver, §1.7 time model, §5.1 determinism contract).
//
// Every render frame accumulates the real ms elapsed and runs whole sim frames of `nextFrameMs(state, speed)` game
// ms (SimDriver, at most 4 per render frame) — so outcomes do not depend on the display refresh rate — and nothing
// while paused. The camera is the scheduler's optional in-view input (Main.Part11.cs 507 method_123 / 533
// ProcessMain level-of-detail pass, plan §0 "View LOD"): on by default in the app, `?simView=0` turns it off (tests
// and the headless harness always run without a view).
//
// The only clock is `galaxy.nowMs` (advanced by runSimFrame); the HUD's GalaxyTime is bound to it
// (GalaxyTime.bindGalaxy) and only supplies pause / speed.

import type { Camera } from './render/camera';
import type { Galaxy } from './sim/galaxy';
import type { GalaxyTime } from './sim/galaxyTime';
import { SimDriver, schedulerState, type SimView } from './sim/tick/scheduler';
import { showToast } from './ui/toast';

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
    /** Call once per render frame with the real ms since the previous one. Returns the sim frames run. */
    tick(realDtMs: number): number;
}

/** `?simView=0` disables the in-view LOD pass (default on in the app). */
export function simViewEnabledFromUrl(search: string): boolean {
    return new URLSearchParams(search).get('simView') !== '0';
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
    return {
        driver,
        stats,
        tick(realDtMs: number): number {
            // Pause / speed come from the HUD clock (buttons, keyboard, game menu, tutorial "Play This Game").
            driver.speed = time.speed;
            driver.paused = time.paused;
            driver.isPaused = () => time.paused;
            const t0 = performance.now();
            let frames = 0;
            try {
                frames = driver.advance(realDtMs, useView ? { view: simViewFromCamera(camera) } : {});
            } catch (err) {
                // Pixi's Ticker only schedules the next animation frame after update() returns, so an exception here
                // would freeze the sim, the view and rendering for good. Contain it: drop the half-drained tick queue
                // (as scripts/sim-run.mjs does), pause, and tell the player.
                console.error('Simulation error (paused):', err);
                schedulerState(galaxy).queue.length = 0;
                time.paused = true;
                showToast('Simulation error — game paused (see console)');
            }
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
