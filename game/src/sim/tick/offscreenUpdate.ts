// Ours (not in the C#): the off-screen update rate — how many built objects the background pass updates per sim frame.
//
// The original updates the built objects outside the view 1,000 per frame, round-robin (Main.Part12.cs 3517 method_86,
// int_43 = 1000 with multi-core; scheduler.ts backgroundPass). In a late-game galaxy of tens of thousands of objects each
// one is then updated only every few dozen frames, so off-screen beam combat barely works: a beam's hit registers only
// on the update after it has passed its target (BuiltObject.1.cs HandleWeaponsFiring, `distanceFromTarget <
// weapon.DistanceFromTarget` when not in view), by when it has flown far past and the range falloff leaves ~0 damage.
//
// The setting is a sim input, so it lives in the game state (Galaxy.offscreenUpdate, saved) and only changes through the
// journaled setOffscreenUpdateRate player command (a replay or a lockstep peer applies the same values at the same frame
// boundaries). Adaptive mode is decided outside the sim (offscreenAdaptive.ts, from the spare wall time per frame) and
// reaches it the same way: every batch size it picks is a journaled command. Original — the default, and every game that
// never changed it — has no Galaxy field at all, so it runs and saves byte-identically to before.

import type { Galaxy } from '../galaxy';

export type OffscreenUpdateMode = 'original' | 'higher' | 'adaptive';

/** Galaxy.offscreenUpdate: present only when the mode is not Original. */
export interface OffscreenUpdateSetting {
    mode: 'higher' | 'adaptive';
    /** Built objects per sim frame (multi-core budget, replaces int_43 = 1000). */
    batch: number;
}

/** method_86 int_43 (multi-core). */
export const ORIGINAL_OFFSCREEN_BATCH = 1000;
/** Higher: twice the original (four times costs ~3x the step time in a 25k-ship galaxy, more than a 60 fps frame). */
export const HIGHER_OFFSCREEN_BATCH = 2000;
/** Adaptive: the batch sizes the controller picks from (multiples of the step). */
export const ADAPTIVE_MIN_BATCH = 1000;
export const ADAPTIVE_MAX_BATCH = 8000;
export const ADAPTIVE_BATCH_STEP = 250;

/** The mode this game runs with. */
export function offscreenUpdateMode(galaxy: Galaxy): OffscreenUpdateMode {
    return galaxy.offscreenUpdate?.mode ?? 'original';
}

/** Built objects the background pass updates per frame (multi-core budget). */
export function offscreenUpdateBatch(galaxy: Galaxy): number {
    const s = galaxy.offscreenUpdate;
    return s === undefined ? ORIGINAL_OFFSCREEN_BATCH : s.batch;
}

/** A batch size the setting can hold: an integer in the adaptive range (Higher's is fixed). */
export function clampOffscreenBatch(batch: number): number {
    if (!Number.isFinite(batch)) return ORIGINAL_OFFSCREEN_BATCH;
    const q = Math.round(batch / ADAPTIVE_BATCH_STEP) * ADAPTIVE_BATCH_STEP;
    return Math.max(ADAPTIVE_MIN_BATCH, Math.min(ADAPTIVE_MAX_BATCH, q));
}

/**
 * The setOffscreenUpdateRate command: Original removes the field (the game is then exactly an original one again),
 * Higher sets the fixed batch, Adaptive the given batch (clamped; the current one, or the original's, when absent).
 * Returns the batch now in effect.
 */
export function applyOffscreenUpdateCommand(galaxy: Galaxy, mode: OffscreenUpdateMode, batch?: number): number {
    if (mode === 'higher') galaxy.offscreenUpdate = { mode, batch: HIGHER_OFFSCREEN_BATCH };
    else if (mode === 'adaptive') galaxy.offscreenUpdate = { mode, batch: clampOffscreenBatch(batch ?? offscreenUpdateBatch(galaxy)) };
    else delete galaxy.offscreenUpdate;
    return offscreenUpdateBatch(galaxy);
}
