// Ours: the Adaptive off-screen update rate's controller (sim/tick/offscreenUpdate.ts). DOM-free: the in-thread loop
// (simLoop.ts) and the sim worker's client (simworker/clientCore.ts) feed it the wall time their sim steps took.
//
// It runs outside the sim and never touches it directly: every batch size it settles on goes to the game as the journaled
// setOffscreenUpdateRate command (applied at the next frame boundary), so the sim stays a function of its command log —
// a replay or a reloaded game runs the same batches at the same frames, whatever machine it runs on. In a lockstep
// session it does nothing (each peer would pick its own batch); the batch then stays where it was.
//
// The rule: the sim has FRAME_REAL_MS of real time per step (60 steps per real second at any game speed). Over each
// window of real time it compares the mean wall ms per step with a target share of that and scales the batch towards it
// (bounded per window, in ADAPTIVE_BATCH_STEP steps, between the original 1000 and ADAPTIVE_MAX_BATCH), backing off as soon
// as the sim falls behind (its backlog grows).

import type { Galaxy } from './sim/galaxy';
import type { Empire } from './sim/empire';
import { FRAME_REAL_MS } from './sim/tick/scheduler';
import { ADAPTIVE_BATCH_STEP, ADAPTIVE_MAX_BATCH, ADAPTIVE_MIN_BATCH, clampOffscreenBatch, offscreenUpdateBatch, offscreenUpdateMode } from './sim/tick/offscreenUpdate';
import { issuePlayerCommand } from './sim/player/playerCommands';
import { lockstepStepper } from './net/lockstepSeam';

/** Real ms between two decisions. */
export const ADAPTIVE_WINDOW_MS = 2000;
/** Share of a step's real time the sim may use: in-thread it shares the frame with rendering, a worker has its own core. */
export const ADAPTIVE_SHARE_IN_THREAD = 0.45;
export const ADAPTIVE_SHARE_WORKER = 0.65;

export class OffscreenAdaptiveController {
    private windowStart = -1;
    private steps = 0;
    private wallMs = 0;
    private backlogAtStart = 0;
    /** A command is in flight (wait for it before deciding again). */
    private pending = false;

    constructor(readonly share: number) {}

    /**
     * One render frame's sim work: `steps` steps took `wallMs` of wall time, `backlogMs` of real time is still owed to
     * the sim. Called outside sim frames (it may issue a command).
     */
    observe(galaxy: Galaxy, steps: number, wallMs: number, backlogMs: number, nowMs: number): void {
        if (offscreenUpdateMode(galaxy) !== 'adaptive' || lockstepStepper(galaxy) !== null || galaxy.playerEmpire === null) {
            this.windowStart = -1;
            return;
        }
        if (this.windowStart < 0) {
            this.windowStart = nowMs;
            this.steps = 0;
            this.wallMs = 0;
            this.backlogAtStart = backlogMs;
        }
        this.steps += steps;
        this.wallMs += wallMs;
        if (nowMs - this.windowStart < ADAPTIVE_WINDOW_MS) return;
        const meanStepMs = this.steps > 0 ? this.wallMs / this.steps : 0;
        const fallingBehind = backlogMs > this.backlogAtStart + 4 * FRAME_REAL_MS;
        this.windowStart = -1;
        if (this.pending || this.steps === 0) return;
        const batch = offscreenUpdateBatch(galaxy);
        const next = nextAdaptiveBatch(batch, meanStepMs, this.share * FRAME_REAL_MS, fallingBehind);
        if (next === batch) return;
        this.pending = true;
        const done = (): void => {
            this.pending = false;
        };
        issuePlayerCommand(galaxy, galaxy.playerEmpire as Empire, 'setOffscreenUpdateRate', ['adaptive', next], done, done);
    }
}

/**
 * The next batch from the current one, the mean wall ms per step and the target ms per step: shrink at once when the
 * sim falls behind or is over target, grow when well under it (at most ×1.5 / ÷1.5 per window; quantised).
 */
export function nextAdaptiveBatch(batch: number, meanStepMs: number, targetMs: number, fallingBehind: boolean): number {
    if (fallingBehind || meanStepMs > targetMs) {
        const f = fallingBehind ? 1 / 1.5 : Math.max(1 / 1.5, targetMs / Math.max(meanStepMs, 1e-6));
        return clampOffscreenBatch(Math.min(batch - ADAPTIVE_BATCH_STEP, batch * f));
    }
    if (meanStepMs < 0.75 * targetMs && batch < ADAPTIVE_MAX_BATCH) {
        const f = Math.min(1.5, (0.9 * targetMs) / Math.max(meanStepMs, 1e-6));
        return clampOffscreenBatch(Math.max(batch + ADAPTIVE_BATCH_STEP, batch * f));
    }
    return Math.max(ADAPTIVE_MIN_BATCH, batch);
}
