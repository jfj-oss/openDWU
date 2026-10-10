// [lockstep seam] The one hook the app's sim loop has into multiplayer (docs/MULTIPLAYER.md "Lockstep core"): while a
// stepper is set for a galaxy, src/simLoop.ts calls it instead of running its own frame budget. None is set unless a
// lockstep session exists (net/lockstepSim.ts SessionStepper), so single-player is unchanged.
//
// Kept free of session / sim imports, so the loop pulls in nothing else. Headless: no DOM / Pixi / Node APIs.

import type { Galaxy } from '../sim/galaxy';
import type { GalaxyTime } from '../sim/galaxyTime';

export interface LockstepStepper {
    /** One render frame with `realDtMs` of real time: run the lockstep frames that are due; returns sim frames run. */
    tick(realDtMs: number, time: GalaxyTime): number;
}

const steppers = new WeakMap<Galaxy, LockstepStepper>();

export function setLockstepStepper(galaxy: Galaxy, stepper: LockstepStepper | null): void {
    if (stepper === null) steppers.delete(galaxy);
    else steppers.set(galaxy, stepper);
}

export function lockstepStepper(galaxy: Galaxy): LockstepStepper | null {
    return steppers.get(galaxy) ?? null;
}
