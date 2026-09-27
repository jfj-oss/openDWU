// 19i "Rim atmosphere" data/wiring package: turns the render layer's rim curve (rimGeometry / rimFraction /
// rimWeight / rimParams — consumed only; src/render/rimAtmosphereLayer.ts itself is not edited here) into the
// per-system rim weight array the sim-safe item-11 name overrides (src/sim/scenario/rimNames.ts) and item-12
// message-key remap (src/sim/scenario/rimMessages.ts, src/sim/scenario/rimState.ts) read. This is the one file where
// the render layer and those sim modules meet: src/sim stays Pixi/DOM-free (game/CLAUDE.md), and
// rimAtmosphereLayer.ts stays untouched.
//
// mainView.ts calls installRimAtmosphereData(galaxy) once, right beside the render layer's own mount() (see the
// "[rimatmo-wiring]" marker there). No-op with the scenario flag off or no scenario: computeRimWeightsPerSystem
// returns [] whenever rimParams(galaxy) is null, and every install function below no-ops on an empty/absent weight
// array — nothing is read from or written to GalaxyScenario.state.

import type { Galaxy } from '../sim/galaxy';
import { installRimNameOverrides } from '../sim/scenario/rimNames';
import { installRimWeights } from '../sim/scenario/rimState';
import { rimFraction, rimGeometry, rimParams, rimWeight } from './rimAtmosphereLayer';

/**
 * Per-system rim weight, in galaxy.systems order (so index i lines up with systems[i].systemStar.systemIndex === i,
 * the convention galaxy.ts's own systemIndex fields use). [] when the scenario/flag is off (rimParams(galaxy) ===
 * null), matching every other 19i hook's "flag off = untouched" contract.
 */
export function computeRimWeightsPerSystem(galaxy: Galaxy): number[] {
    const params = rimParams(galaxy);
    if (params === null) return [];
    const stars = galaxy.systems.map((s) => s.systemStar ?? null);
    const geo = rimGeometry(
        galaxy.sizeX,
        galaxy.sizeY,
        stars.filter((s): s is NonNullable<typeof s> => s !== null),
    );
    return stars.map((s) => (s === null ? 0 : rimWeight(rimFraction(geo, s.xpos, s.ypos), params.rimInner)));
}

/**
 * Installs the item-11/item-12 scenario state once per game (idempotent). Called from mainView.ts beside the render
 * layer's mount(); safe to call more than once (installRimWeights / installRimNameOverrides both keep the first
 * result) and safe to call with no scenario or the flag off (a no-op).
 */
export function installRimAtmosphereData(galaxy: Galaxy): void {
    const weights = computeRimWeightsPerSystem(galaxy);
    if (weights.length === 0) return;
    installRimWeights(galaxy, weights);
    installRimNameOverrides(galaxy, weights);
}
