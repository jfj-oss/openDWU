// 19i "Rim atmosphere" data/wiring: the one per-system rim-weight array both the item-11 name overrides
// (rimNames.ts) and the item-12 message-key remap (rimMessages.ts) read. Installed once, at game start, by
// src/render/rimAtmosphereWiring.ts — the only place sim code and the render layer's rim curve
// (rimGeometry/rimFraction/rimWeight/rimParams, src/render/rimAtmosphereLayer.ts) meet, since that module imports
// pixi.js and src/sim must stay DOM/Pixi-free (game/CLAUDE.md). Never touches galaxy.rnd, so installing this (or not,
// off the flag) moves no pin and no digest field.

import type { Galaxy } from '../galaxy';
import { RIM_FLAG_NAME } from './rimShared';
import { scenarioState } from './state';

export const RIM_WEIGHTS_STATE_KEY = 'rimAtmosphere.weights';

/** Minimal shape the readers need: the real Galaxy and any duck-typed stand-in (hud.ts's camera-label param) both
 *  satisfy this. */
export interface RimWeightHost {
    scenario: { flags: Record<string, boolean>; state: Record<string, unknown> } | null;
}

/**
 * Installs the per-system rim weight array (galaxy.systems order; 0 = inside `rimInner`) in scenario state.
 * Idempotent (a second call keeps the first array). No-op with the flag off, so a game without this scenario (or
 * with it off) never allocates or reads this state.
 */
export function installRimWeights(galaxy: Galaxy, rimWeights: readonly number[]): void {
    const s = galaxy.scenario;
    if (s === null || s.flags[RIM_FLAG_NAME] !== true) return;
    scenarioState(galaxy, RIM_WEIGHTS_STATE_KEY, () => [...rimWeights]);
}

/** The installed rim weight for `systemIndex`: 0 with the flag off, no scenario, nothing installed yet, or an
 *  out-of-range index — the same "off = untouched" value rimWeight() itself returns inside `rimInner`. */
export function rimWeightOfSystem(galaxy: RimWeightHost, systemIndex: number): number {
    const s = galaxy.scenario;
    if (s === null || s.flags[RIM_FLAG_NAME] !== true) return 0;
    const weights = s.state[RIM_WEIGHTS_STATE_KEY] as number[] | undefined;
    return weights?.[systemIndex] ?? 0;
}
